#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O MERCADINHO ENTRE CONTAS, com propostas (13/09, pedido do dono).

"se eu coloco um item por valor X outro usuário pode dar a proposta de comprar
pelo valor Y. se eu aceitar, e o outro jogador tiver saldo no saco ou no banco
(ou saco+banco) desconta de lá e o item vai para ele (...) ao aceitar a
proposta, o jogador que deu a proposta aparece na tela se ele realmente quer
(...) caso já esteja vendido antes dele aceitar, aí ele perdeu essa negociação.
e a taxa do mercadinho é descontada de acordo com o preço final."

POR QUE MORA AQUI: até 13/09 as ofertas moravam em `db.mercado.ofertas` do
PRÓPRIO jogador — com a autoridade, o juiz rodava o anúncio no estado da conta,
e ninguém via o anúncio de ninguém. Agora o balcão é do servidor: o anúncio é
uma linha de `mercado_anuncios`, e a peça anunciada fica EM CUSTÓDIA (fora do
estado de qualquer conta, como a peça guardada no banco da guilda). A série
continua 'vivo' no registro `itens`, com o vendedor como dono, até vender (vai
para o comprador, origem 'mercador') ou voltar (retirar).

Entra no cartório como mixin (`class Api(..., MercadoMixin)` no api.py), com a
mesma conexão e a mesma tranca. Importa só de comum.py (a armadilha do
__main__). Toda mudança de estado de conta passa pelo JUIZ, com as ops
INTERNAS mercadoTira / mercadoPoe / mercadoPaga / mercadoRecebe /
mercadoLegadoTira (servidor/juiz/economia.js), e grava com _estado_grava
(salas.py): versão, hash e registro de séries, como a troca. Sem juiz, 503.

AS REGRAS:
  anunciar   a peça sai do saco do vendedor pela série; preço 1..PRECO_MAX;
             no máximo ANUNCIOS_MAX abertos por conta
  comprar    pelo preço X: debita PRIMEIRO do saco e o que faltar do banco;
             o vendedor recebe X − taxa no saco, mesmo fora do jogo (o estado
             dele no servidor muda; o cliente dele adota depois)
  propor     Y entre 1 e X−1; o comprador precisa ter Y (saco + banco) NA
             HORA, sem reservar; uma proposta viva por comprador por anúncio
             (a nova cancela a antiga); PROPOSTAS_POR_HORA por conta
  responder  o vendedor aceita (o anúncio CONTINUA aberto: outro pode comprar
             antes) ou recusa; pode aceitar mais de uma — quem confirmar
             primeiro leva
  confirmar  o comprador confirma a aceita: vende por Y, com a taxa sobre Y;
             se o anúncio já saiu, a proposta é 'perdida'; sem saldo, a
             proposta segue 'aceita'. Negar = 'desistiu'
  retirar    a peça volta ao saco do vendedor; as propostas vivas caem
  a taxa     TAXA_PCT do preço FINAL (o de venda ou o negociado), mínimo 1 — o
             ralo da economia (js/core/mercado.js tem a mesma conta)
  o legado   as ofertas antigas que ainda estão em db.mercado.ofertas viram
             anúncios na primeira chamada de mercado da conta, com a série

O LOTE DE PEDRAS DE FORJA (22/09, pedido do dono: vender pedra uma a uma ou em
lotes de 10, 50 e 100). O lote é um anúncio como a peça — mesma linha em
`mercado_anuncios`, com item_id = a pedra, level/stars 0 e iid NULL — mais uma
linha em `mercado_lotes` com o tamanho (tabela NOVA: o anúncio de antes nunca
ganha coluna). Tudo o que vale para a peça vale para o lote: teto de anúncios,
compra saco-depois-banco, a taxa sobre o preço final, a proposta, o aceite, a
confirmação e a retirada. O que muda: as pedras saem do estoque do vendedor
(op interna mercadoTiraPedras) e entram no de quem leva (mercadoPoePedras) —
sem série, sem registro de itens e sem saco cheio (pedra não ocupa o saco).
Nas leituras, o resumo separa `itens` (só peças) de `pedras` (agregado por
pedra, com o menor preço por unidade), e todo objeto com cara de anúncio leva
`tipo` ('peca' | 'pedra') e `qtd` (1 na peça).
"""
import json
import logging
import re

from comum import NOME_PUBLICO_SQL, EstadoMudou, Recusa, agora, iid_valido, inteiro, limita

log = logging.getLogger('api')

# ---- as réguas (js/core/mercado.js espelha PRECO_MAX e a taxa) ----------------------------
PRECO_MAX = 9999                  # JOGO.Mercado.PRECO_MAX
TAXA_PCT = 5                      # JOGO.Mercado.TAXA (5%, mínimo 1)
ANUNCIOS_MAX = 30                 # anúncios abertos por conta
PROPOSTAS_POR_HORA = 60           # propostas feitas por conta, por hora (o freio de quem espalha oferta)
LISTA_MAX = 200                   # anúncios de um item numa leitura
RECENTES = 20                     # vendas e propostas recentes nas leituras
TENTATIVAS = 3                    # quantas vezes refazer quando o estado de uma conta muda no meio
TENTATIVAS_VENDA = 5              # a venda mexe em DOIS estados, e o vendedor pode estar jogando
RE_ITEM = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
LOTES_PEDRA = (1, 10, 50, 100)    # JOGO.Mercado.LOTES_PEDRA e o juiz (lotePedra) espelham; o CHECK da tabela também
VIVAS = ('aberta', 'aceita')
SEM_JUIZ = 'o mercadinho precisa do servidor conferindo — tente de novo em instantes'
MUDOU = 'o estado de uma das contas mudou no meio — tente de novo'

ESQUEMA_MERCADO = """
-- o mercadinho entre contas (13/09). Tabelas NOVAS, nunca ALTER: no rolling update do
-- Coolify o contêiner velho e o novo sobem juntos no mesmo banco
CREATE TABLE IF NOT EXISTS mercado_anuncios(
  id             INTEGER PRIMARY KEY,
  vendedor_id    INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  iid            TEXT,
  item_id        TEXT NOT NULL,
  level          INTEGER NOT NULL DEFAULT 0,
  stars          INTEGER NOT NULL DEFAULT 0,
  preco          INTEGER NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto', 'vendido', 'retirado')),
  criado_em      INTEGER NOT NULL,
  comprador_id   INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  valor_final    INTEGER,
  taxa           INTEGER,
  fechado_em     INTEGER,
  proposta_id    INTEGER,
  visto_vendedor INTEGER NOT NULL DEFAULT 0,
  legado         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mercado_anuncios_item ON mercado_anuncios(estado, item_id, preco);
CREATE INDEX IF NOT EXISTS mercado_anuncios_vendedor ON mercado_anuncios(vendedor_id, estado);
-- uma série só pode estar num anúncio aberto
CREATE UNIQUE INDEX IF NOT EXISTS mercado_anuncios_iid ON mercado_anuncios(iid)
  WHERE estado = 'aberto' AND iid IS NOT NULL;
CREATE TABLE IF NOT EXISTS mercado_propostas(
  id             INTEGER PRIMARY KEY,
  anuncio_id     INTEGER NOT NULL REFERENCES mercado_anuncios(id) ON DELETE CASCADE,
  comprador_id   INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  valor          INTEGER NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'aberta'
    CHECK (estado IN ('aberta', 'aceita', 'recusada', 'concluida', 'desistiu', 'perdida', 'cancelada')),
  criado_em      INTEGER NOT NULL,
  aceita_em      INTEGER,
  resolvida_em   INTEGER,
  visto          INTEGER NOT NULL DEFAULT 0,     -- o comprador já viu o desfecho
  visto_vendedor INTEGER NOT NULL DEFAULT 0      -- o vendedor já viu que ela chegou
);
CREATE INDEX IF NOT EXISTS mercado_propostas_anuncio ON mercado_propostas(anuncio_id, estado);
CREATE INDEX IF NOT EXISTS mercado_propostas_comprador ON mercado_propostas(comprador_id, estado);
-- 22/09: o LOTE de pedras de forja. O anúncio é a linha de mercado_anuncios (item_id = a pedra,
-- level/stars 0, iid NULL); o tamanho mora aqui, numa tabela NOVA (nunca ALTER, pelo mesmo motivo).
-- O contêiner velho que ainda não conhece a tabela vê o lote como uma peça que o juiz dele não
-- aceita (mercadoPoe: 'peça inválida'): a compra e a retirada lá caem sem mexer em nada
CREATE TABLE IF NOT EXISTS mercado_lotes(
  anuncio_id     INTEGER PRIMARY KEY REFERENCES mercado_anuncios(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL CHECK (tipo IN ('pedra')),
  qtd            INTEGER NOT NULL CHECK (qtd IN (1, 10, 50, 100))
);
"""


def taxa_de(valor):
    """A taxa do mercadinho sobre o preço FINAL: TAXA_PCT %, arredondada para cima, mínimo 1.
    Conta inteira (sem ponto flutuante): JOGO.Mercado.taxaDe faz a mesma."""
    return max(1, (valor * TAXA_PCT + 99) // 100)


def _inteiro_puro(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _id(corpo, nome):
    v = corpo.get(nome)
    if isinstance(v, str) and v.isdigit() and len(v) <= 15:
        v = int(v)
    if not _inteiro_puro(v) or not 0 < v < 2 ** 53:
        raise Recusa(400, '%s precisa ser um id' % nome)
    return v


def _saldo(db):
    """(saco, banco) do db do estado do servidor."""
    d = db if isinstance(db, dict) else {}
    cart = d.get('carteira') if isinstance(d.get('carteira'), dict) else {}
    banco = d.get('banco') if isinstance(d.get('banco'), dict) else {}
    return max(0, inteiro(cart.get('moedas'))), max(0, inteiro(banco.get('moedas')))


def ofertas_legadas(db):
    """As ofertas do JOGADOR que ainda moram no db (o mercadinho de antes de 13/09)."""
    mc = db.get('mercado') if isinstance(db, dict) else None
    ofertas = mc.get('ofertas') if isinstance(mc, dict) else None
    if not isinstance(ofertas, list):
        return []
    return [o for o in ofertas if isinstance(o, dict) and o.get('vendedor') == 'jogador']


def _peca(res):
    """A peça que o juiz devolveu (mercadoTira), conferida."""
    item = res.get('item') if isinstance(res, dict) else None
    if not isinstance(item, dict) or not isinstance(item.get('itemId'), str) or not RE_ITEM.match(item['itemId']):
        raise Recusa(503, 'o juiz respondeu torto — nada foi mexido')
    return item


# ---- o lote de pedras (22/09) --------------------------------------------------------------
# As leituras juntam `mercado_lotes` com LEFT JOIN e o apelido `lote_qtd`: NULL = peça.
LOTE_JUNTA = "LEFT JOIN mercado_lotes l ON l.anuncio_id = a.id "


def _tipo_qtd(qtd_lote):
    """{'tipo', 'qtd'} de um anúncio: o lote diz o tamanho; a peça é 1."""
    if qtd_lote is None:
        return {'tipo': 'peca', 'qtd': 1}
    return {'tipo': 'pedra', 'qtd': qtd_lote}


def _duas_casas(x):
    """Um preço por pedra com 2 casas; inteiro quando fecha (3.0 vira 3 no JSON)."""
    u = round(x, 2)
    return int(u) if u == int(u) else u


def _unitario(preco, qtd):
    """O preço por pedra do anúncio; a peça (qtd 1) fica igual ao preço."""
    return _duas_casas(preco / max(1, qtd))


def _pedras_no_estado(progress, stone_id):
    """Quantas pedras `stone_id` a conta tem no estado do servidor (o Progress.stoneCount)."""
    st = progress.get('stones') if isinstance(progress, dict) else None
    return max(0, inteiro(st.get(stone_id))) if isinstance(st, dict) else 0


def _item_do_lote(stone_id, qtd):
    """O `item` das respostas de venda e retirada do lote: a forma da peça, com tipo e qtd."""
    return {'itemId': stone_id, 'level': 0, 'stars': 0, 'qtd': qtd, 'tipo': 'pedra'}


class MercadoMixin:

    # -- miudezas ------------------------------------------------------------------------------
    def _mc_liga(self):
        if not self._autoridade_ligada():
            raise Recusa(503, SEM_JUIZ)

    def _mc_nomes(self, ids):
        """{conta_id: nome público} — o nome do jogo (a foto do ranking, que já passou pela lei
        dos nomes) e, sem ela, o da conta."""
        ids = [i for i in set(ids) if i is not None]
        if not ids:
            return {}
        saida = {}
        for i in range(0, len(ids), 400):
            parte = ids[i:i + 400]
            for r in self.con.execute(
                    "SELECT c.id, " + NOME_PUBLICO_SQL + " AS nome FROM contas c "
                    "LEFT JOIN resumos r ON r.conta_id = c.id WHERE c.id IN (%s)" % ','.join('?' * len(parte)), parte):
                saida[r['id']] = r['nome']
        return saida

    @staticmethod
    def _mc_estado_resposta(resposta, nova, saida, db):
        """O estado novo da conta que pediu, para o cliente adotar sem recarregar."""
        resposta.update(versao=nova, hash=saida['hash'], progress=saida['progress'], db=db)
        return resposta

    def _mc_anuncio(self, aid):
        a = self.con.execute("SELECT * FROM mercado_anuncios WHERE id = ?", (aid,)).fetchone()
        if a is None:
            raise Recusa(404, 'esse anúncio não existe')
        return a

    def _mc_lote(self, aid):
        """Dentro da tranca: o tamanho do lote de pedras do anúncio `aid`, ou None (é peça)."""
        r = self.con.execute("SELECT qtd FROM mercado_lotes WHERE anuncio_id = ? AND tipo = 'pedra'", (aid,)).fetchone()
        return r['qtd'] if r is not None else None

    # -- a migração do mercadinho de antes (as ofertas no db da conta) --------------------------------
    def _mc_migra(self, conta):
        """Na primeira chamada de mercado da conta: as ofertas do jogador que ainda estão em
        db.mercado.ofertas saem do estado (op interna 'mercadoLegadoTira') e viram anúncios
        abertos, com a MESMA série e o mesmo preço. Nenhuma peça se perde: a série segue
        'vivo' com o vendedor, e a oferta sem série vira anúncio sem série (a venda cunha
        uma cópia nova, como o banco da guilda). Devolve o estado novo (para a resposta)
        ou None. O marcador em `migracoes` faz isto rodar uma vez por conta."""
        cid = conta['id']
        marca = 'mercado-legado:%d' % cid
        for _ in range(TENTATIVAS):
            with self.tranca:
                if self.con.execute("SELECT 1 FROM migracoes WHERE nome = ?", (marca,)).fetchone():
                    return None
                estado = self._estado_ler(cid)
            if estado is None:
                return None           # conta sem estado: o primeiro save ainda pode trazer ofertas; não marca
            if not ofertas_legadas(estado['db']):
                with self._escrita():
                    self.con.execute("INSERT OR IGNORE INTO migracoes(nome, feita_em) VALUES (?, ?)", (marca, agora()))
                return None
            saida = self._juiz_op(conta, estado, [{'nome': 'mercadoLegadoTira', 'args': {}}], interno=True)
            res = (saida.get('resultados') or [None])[0]
            ofertas = res.get('ofertas') if isinstance(res, dict) else None
            if not isinstance(ofertas, list):
                raise Recusa(503, 'o juiz respondeu torto — nada foi mexido')
            # 22/09: o lote de pedras local não vira anúncio — o juiz já pôs as pedras de volta no
            # estoque do vendedor (o estado gravado abaixo as leva); aqui só entra na trilha
            pedras = res.get('pedras') if isinstance(res.get('pedras'), list) else []
            t = agora()
            try:
                with self._escrita():
                    if self.con.execute("SELECT 1 FROM migracoes WHERE nome = ?", (marca,)).fetchone():
                        return None
                    vistos, lote, poupar = set(), [], []
                    for o in ofertas:
                        if not isinstance(o, dict) or not isinstance(o.get('itemId'), str) or not RE_ITEM.match(o['itemId']):
                            log.error("mercado: oferta legada torta da conta #%d: %.200r", cid, o)
                            continue
                        iid = o.get('iid') if iid_valido(o.get('iid')) else None
                        if iid is not None:
                            if iid in vistos:
                                iid = None             # a mesma série duas vezes no save: a segunda não leva série
                            else:
                                r = self.con.execute("SELECT conta_id, estado FROM itens WHERE iid = ?", (iid,)).fetchone()
                                if r is None:
                                    self.con.execute("INSERT INTO itens(iid, conta_id, item_id, origem, criado_em, estado) "
                                                     "VALUES (?, ?, ?, 'legado', ?, 'vivo')", (iid, cid, o['itemId'], t))
                                elif r['conta_id'] != cid or r['estado'] != 'vivo':
                                    # a série é de outra conta ou já saiu do jogo: anunciar seria duplicar
                                    log.error("mercado: oferta legada da conta #%d com a série %s, que é %r — fica de fora",
                                              cid, iid, tuple(r))
                                    continue
                                vistos.add(iid)
                                poupar.append(iid)
                        lote.append((cid, iid, o['itemId'], limita(o.get('level'), 0, 99), limita(o.get('stars'), 0, 9),
                                     limita(o.get('preco'), 1, PRECO_MAX), t))
                    nova, db = self._estado_grava(conta, estado, saida, t, poupar=poupar)
                    self.con.executemany(
                        "INSERT INTO mercado_anuncios(vendedor_id, iid, item_id, level, stars, preco, estado, criado_em, legado) "
                        "VALUES (?, ?, ?, ?, ?, ?, 'aberto', ?, 1)", lote)
                    self.con.execute("INSERT INTO migracoes(nome, feita_em) VALUES (?, ?)", (marca, t))
                    self._evento(cid, 'mercado-legado', {'anuncios': len(lote), 'lotesDevolvidos': pedras[:50],
                                                         'versao': nova})
            except EstadoMudou:
                continue
            log.info("mercado: %d ofertas antigas da conta #%d viraram anúncios (%d lotes de pedra devolvidos)",
                     len(lote), cid, len(pedras))
            return {'versao': nova, 'hash': saida['hash'], 'progress': saida['progress'], 'db': db}
        raise Recusa(409, MUDOU)

    def _mc_abre(self, conta):
        """A porta de toda rota: o juiz ligado e o legado da conta já migrado."""
        self._mc_liga()
        return self._mc_migra(conta)

    @staticmethod
    def _mc_com_migracao(resposta, migrado):
        if migrado and 'progress' not in resposta:
            resposta.update(migrado)
        return resposta

    # -- POST /api/mercado/anunciar ----------------------------------------------------------------
    def mercado_anunciar(self, conta, corpo):
        migrado = self._mc_abre(conta)
        cid = conta['id']
        tipo = corpo.get('tipo')
        if tipo == 'pedra':
            return self._mc_anuncia_lote(conta, corpo)
        if tipo is not None and tipo != 'peca':
            raise Recusa(400, "tipo precisa ser 'peca' ou 'pedra'")
        preco = corpo.get('preco')
        if not _inteiro_puro(preco) or not 1 <= preco <= PRECO_MAX:
            raise Recusa(400, 'o preço vai de 1 a %d vinténs' % PRECO_MAX)
        iid, inv = corpo.get('iid'), corpo.get('invIndex')
        if iid is not None and not iid_valido(iid):
            raise Recusa(400, 'iid inválido')
        if iid is None and (not _inteiro_puro(inv) or not 0 <= inv < 10000):
            raise Recusa(400, 'informe a peça: iid ou invIndex')
        for _ in range(TENTATIVAS):
            t = agora()
            with self.tranca:
                estado = self._estado_exige(cid)
                serie = self._mc_serie_do_saco(estado, iid, inv)
                self._mc_pode_anunciar(cid, serie)
            saida = self._juiz_op(conta, estado, [{'nome': 'mercadoTira', 'args': {'iid': serie}}], interno=True)
            item = _peca((saida.get('resultados') or [None])[0])
            if item.get('iid') != serie:
                raise Recusa(503, 'o juiz respondeu torto — nada foi anunciado')
            try:
                with self._escrita():
                    self._mc_pode_anunciar(cid, serie)
                    nova, db = self._estado_grava(conta, estado, saida, t, poupar=[serie])   # a série segue viva, em custódia
                    cur = self.con.execute(
                        "INSERT INTO mercado_anuncios(vendedor_id, iid, item_id, level, stars, preco, estado, criado_em) "
                        "VALUES (?, ?, ?, ?, ?, ?, 'aberto', ?)",
                        (cid, serie, item['itemId'], limita(item.get('level'), 0, 99), limita(item.get('stars'), 0, 9),
                         preco, t))
                    aid = cur.lastrowid
                    self._evento(cid, 'mercado-anuncio', {'id': aid, 'iid': serie, 'itemId': item['itemId'],
                                                          'preco': preco, 'versao': nova})
            except EstadoMudou:
                continue
            anuncio = {'id': aid, 'itemId': item['itemId'], 'level': limita(item.get('level'), 0, 99),
                       'stars': limita(item.get('stars'), 0, 9), 'preco': preco, 'taxa': taxa_de(preco)}
            return 200, self._mc_estado_resposta({'ok': True, 'anuncio': anuncio}, nova, saida, db)
        raise Recusa(409, MUDOU, **self._estado_publico(cid))

    @staticmethod
    def _mc_serie_do_saco(estado, iid, inv):
        saco = estado['progress'].get('inventory')
        saco = saco if isinstance(saco, list) else []
        if iid is not None:
            if any(isinstance(e, dict) and e.get('iid') == iid for e in saco):
                return iid
            raise Recusa(409, 'essa peça não está no seu saco')
        e = saco[inv] if inv < len(saco) else None
        if not isinstance(e, dict):
            raise Recusa(409, 'essa peça não está no seu saco')
        if not iid_valido(e.get('iid')):
            raise Recusa(409, 'essa peça ainda não tem número de série: espere o jogo salvar e tente de novo')
        return e['iid']

    def _mc_teto(self, cid):
        """O teto de anúncios abertos por conta — peça e lote de pedras contam juntos."""
        n = self.con.execute("SELECT COUNT(*) FROM mercado_anuncios WHERE vendedor_id = ? AND estado = 'aberto'",
                             (cid,)).fetchone()[0]
        if n >= ANUNCIOS_MAX:
            raise Recusa(409, 'você já tem %d anúncios abertos (o máximo): retire algum antes' % ANUNCIOS_MAX)

    def _mc_anuncia_lote(self, conta, corpo):
        """O LOTE de pedras (22/09): {tipo: 'pedra', stoneId, qtd, preco}. As pedras saem do
        estado do vendedor pelo juiz (mercadoTiraPedras, tudo ou nada) e ficam em custódia na
        linha do anúncio; o anúncio e o lote entram na MESMA transação que grava o estado."""
        cid = conta['id']
        stone_id, qtd, preco = corpo.get('stoneId'), corpo.get('qtd'), corpo.get('preco')
        if not isinstance(stone_id, str) or not RE_ITEM.match(stone_id):
            raise Recusa(400, 'informe a pedra: stoneId')
        if not _inteiro_puro(qtd) or qtd not in LOTES_PEDRA:
            raise Recusa(400, 'o lote é de %s pedras' % ', '.join(str(n) for n in LOTES_PEDRA))
        if not _inteiro_puro(preco) or not 1 <= preco <= PRECO_MAX:
            raise Recusa(400, 'o preço vai de 1 a %d vinténs' % PRECO_MAX)
        for _ in range(TENTATIVAS):
            t = agora()
            with self.tranca:
                estado = self._estado_exige(cid)
                self._mc_teto(cid)
            # quem decide é o juiz (a pedra existe? o estoque cobre?); a API só traduz a recusa
            try:
                saida = self._juiz_op(conta, estado, [{'nome': 'mercadoTiraPedras',
                                                       'args': {'stoneId': stone_id, 'qtd': qtd}}], interno=True)
            except Recusa as e:
                if e.status == 422 and e.extra.get('motivo') == 'falta':
                    tem = min(_pedras_no_estado(estado['progress'], stone_id), qtd - 1)
                    raise Recusa(409, 'pedras insuficientes: o lote pede %d e você tem %d' % (qtd, tem),
                                 motivo='pedras', tem=tem, faltam=qtd - tem)
                if e.status == 422 and e.extra.get('motivo') == 'argumento':
                    raise Recusa(400, e.erro, motivo='argumento')         # a pedra que o dado não conhece
                raise
            res = (saida.get('resultados') or [None])[0]
            if not isinstance(res, dict) or res.get('stoneId') != stone_id or res.get('qtd') != qtd:
                raise Recusa(503, 'o juiz respondeu torto — nada foi anunciado')
            try:
                with self._escrita():
                    self._mc_teto(cid)
                    nova, db = self._estado_grava(conta, estado, saida, t)
                    cur = self.con.execute(
                        "INSERT INTO mercado_anuncios(vendedor_id, iid, item_id, level, stars, preco, estado, criado_em) "
                        "VALUES (?, NULL, ?, 0, 0, ?, 'aberto', ?)", (cid, stone_id, preco, t))
                    aid = cur.lastrowid
                    self.con.execute("INSERT INTO mercado_lotes(anuncio_id, tipo, qtd) VALUES (?, 'pedra', ?)", (aid, qtd))
                    self._evento(cid, 'mercado-anuncio', {'id': aid, 'tipo': 'pedra', 'itemId': stone_id, 'qtd': qtd,
                                                          'preco': preco, 'versao': nova})
            except EstadoMudou:
                continue
            anuncio = {'id': aid, 'tipo': 'pedra', 'itemId': stone_id, 'stoneId': stone_id, 'qtd': qtd,
                       'preco': preco, 'taxa': taxa_de(preco)}
            return 200, self._mc_estado_resposta({'ok': True, 'anuncio': anuncio}, nova, saida, db)
        raise Recusa(409, MUDOU, **self._estado_publico(cid))

    def _mc_pode_anunciar(self, cid, iid):
        self._mc_teto(cid)
        r = self.con.execute("SELECT conta_id, estado FROM itens WHERE iid = ?", (iid,)).fetchone()
        if r is None:
            raise Recusa(409, 'essa peça ainda não chegou ao servidor — espere o jogo salvar e tente de novo')
        if r['conta_id'] != cid or r['estado'] != 'vivo':
            raise Recusa(409, 'você não tem a instância %s' % iid)
        if self.con.execute("SELECT 1 FROM guilda_emprestimos WHERE iid = ?", (iid,)).fetchone():
            raise Recusa(409, 'peça emprestada do banco da guilda não vai ao mercadinho: devolva')
        if self.con.execute("SELECT 1 FROM mercado_anuncios WHERE iid = ? AND estado = 'aberto'", (iid,)).fetchone():
            raise Recusa(409, 'essa peça já está anunciada')

    # -- a venda (comprar pelo preço e confirmar a proposta aceita) -------------------------------------
    def _mc_vende(self, conta, aid, proposta_id=None):
        """Vende o anúncio aberto `aid` para `conta`: pelo preço, ou pelo valor da proposta
        aceita `proposta_id`. O juiz debita o comprador (saco, depois banco) e põe a peça no
        saco dele; credita o vendedor (valor − taxa); a gravação dos DOIS estados, da série,
        do anúncio e das propostas é uma transação só. Um anúncio que já saiu levanta
        Recusa 409 com motivo 'perdeu' (a proposta, se houver, vira 'perdida').
        22/09: o LOTE de pedras vende igual, mas as pedras entram no estoque do comprador
        (mercadoPoePedras) — sem série a conferir nem registro de itens a mudar de dono."""
        cid = conta['id']
        for _ in range(TENTATIVAS_VENDA):
            t = agora()
            with self.tranca:
                a = self._mc_anuncio(aid)
                qtd_lote = self._mc_lote(aid)
                p = None
                if proposta_id is not None:
                    p = self.con.execute("SELECT * FROM mercado_propostas WHERE id = ?", (proposta_id,)).fetchone()
                    if p is None or p['comprador_id'] != cid or p['anuncio_id'] != aid:
                        raise Recusa(404, 'essa proposta não existe')
                if a['estado'] != 'aberto':
                    perdeu = True
                else:
                    perdeu = False
                    if a['vendedor_id'] == cid:
                        raise Recusa(400, 'esse anúncio é seu')
                    if p is not None and p['estado'] != 'aceita':
                        raise Recusa(409, 'essa proposta não está esperando a sua confirmação (%s)' % p['estado'])
                    valor = p['valor'] if p is not None else a['preco']
                    vendedor = self.con.execute("SELECT * FROM contas WHERE id = ?", (a['vendedor_id'],)).fetchone()
                    eb = self._estado_exige(cid)
                    ev = self._estado_ler(a['vendedor_id']) if vendedor is not None else None
                    if ev is None:
                        raise Recusa(409, 'o vendedor não está com o estado no servidor — tente mais tarde')
                    vendedor = dict(vendedor)
                    saco, banco = _saldo(eb['db'])
                    if saco + banco < valor:
                        raise Recusa(409, 'vinténs insuficientes: faltam %d (somando saco e banco)' % (valor - saco - banco),
                                     motivo='saldo', faltam=valor - saco - banco)
            if perdeu:
                self._mc_perdeu(p, t)
            item = {'itemId': a['item_id'], 'level': a['level'], 'stars': a['stars']}
            if a['iid']:
                item['iid'] = a['iid']
            taxa = taxa_de(valor)
            repasse = valor - taxa
            if qtd_lote is not None:
                poe = {'nome': 'mercadoPoePedras', 'args': {'stoneId': a['item_id'], 'qtd': qtd_lote}}
            else:
                poe = {'nome': 'mercadoPoe', 'args': {'item': item}}
            try:
                sb = self._juiz_op(conta, eb, [{'nome': 'mercadoPaga', 'args': {'valor': valor}}, poe], interno=True)
            except Recusa as e:
                if e.status == 422 and e.extra.get('motivo') == 'saco':
                    raise Recusa(409, 'o seu saco está cheio — abra espaço e tente de novo', motivo='saco')
                if e.status == 422 and e.extra.get('motivo') == 'moedas':
                    raise Recusa(409, 'vinténs insuficientes (somando saco e banco)', motivo='saldo')
                raise
            res = sb.get('resultados') or []
            pago = res[0] if len(res) > 0 and isinstance(res[0], dict) else {}
            posto = res[1] if len(res) > 1 and isinstance(res[1], dict) else {}
            serie = posto.get('iid')
            if qtd_lote is not None:
                posto_ok = posto.get('ok') is True and posto.get('stoneId') == a['item_id'] and posto.get('qtd') == qtd_lote
            else:
                posto_ok = iid_valido(serie) and not (a['iid'] and serie != a['iid'])
            if not pago.get('ok') or inteiro(pago.get('deCarteira')) + inteiro(pago.get('deBanco')) != valor or not posto_ok:
                raise Recusa(503, 'o juiz respondeu torto — nada foi vendido')
            sv = None
            if repasse > 0:
                sv = self._juiz_op(vendedor, ev, [{'nome': 'mercadoRecebe', 'args': {'valor': repasse}}], interno=True)
            try:
                with self._escrita():
                    a2 = self.con.execute("SELECT * FROM mercado_anuncios WHERE id = ?", (aid,)).fetchone()
                    if a2 is None or a2['estado'] != 'aberto':
                        perdeu = True
                        raise EstadoMudou()
                    if dict(a2) != dict(a):
                        raise EstadoMudou()
                    if p is not None:
                        p2 = self.con.execute("SELECT estado, valor FROM mercado_propostas WHERE id = ?", (p['id'],)).fetchone()
                        if p2 is None or p2['estado'] != 'aceita' or p2['valor'] != valor:
                            raise Recusa(409, 'a proposta mudou no meio — confira de novo')
                    poupar = [a['iid']] if a['iid'] else []
                    nb, dbb = self._estado_grava(conta, eb, sb, t, poupar=poupar)
                    if sv is not None:
                        self._estado_grava(vendedor, ev, sv, t)
                    if a['iid']:
                        n = self.con.execute("UPDATE itens SET conta_id = ?, origem = 'mercador', criado_em = ? "
                                             "WHERE iid = ? AND conta_id = ? AND estado = 'vivo'",
                                             (cid, t, a['iid'], a['vendedor_id'])).rowcount
                        if not n:
                            log.error("mercado: a série %s do anúncio #%d não estava viva com o vendedor #%d",
                                      a['iid'], aid, a['vendedor_id'])
                            raise Recusa(409, 'a peça desse anúncio não confere no registro — nada foi vendido')
                    self.con.execute("UPDATE mercado_anuncios SET estado = 'vendido', comprador_id = ?, valor_final = ?, "
                                     "taxa = ?, fechado_em = ?, proposta_id = ?, visto_vendedor = 0 WHERE id = ?",
                                     (cid, valor, taxa, t, p['id'] if p is not None else None, aid))
                    # quem mais tinha proposta viva perdeu a negociação (e fica sabendo pelo aviso)
                    self.con.execute("UPDATE mercado_propostas SET estado = 'perdida', resolvida_em = ?, visto = 0 "
                                     "WHERE anuncio_id = ? AND estado IN ('aberta', 'aceita') AND id IS NOT ?",
                                     (t, aid, p['id'] if p is not None else None))
                    if p is not None:
                        self.con.execute("UPDATE mercado_propostas SET estado = 'concluida', resolvida_em = ?, visto = 1 "
                                         "WHERE id = ?", (t, p['id']))
                    dados = {'anuncio': aid, 'iid': serie, 'itemId': a['item_id'], 'valor': valor, 'taxa': taxa,
                             'proposta': p['id'] if p is not None else None}
                    if qtd_lote is not None:
                        dados.update(tipo='pedra', qtd=qtd_lote)
                    self._evento(cid, 'mercado-compra', dict(dados, vendedor=a['vendedor_id'], versao=nb))
                    self._evento(a['vendedor_id'], 'mercado-venda', dict(dados, comprador=cid))
            except EstadoMudou:
                if perdeu:
                    self._mc_perdeu(p, t)
                continue
            log.info("mercado: anúncio #%d vendido #%d → #%d por %d (taxa %d)", aid, a['vendedor_id'], cid, valor, taxa)
            resposta = {'ok': True, 'comprou': True, 'anuncio': aid, 'valor': valor, 'preco': a['preco'],
                        'deCarteira': inteiro(pago.get('deCarteira')), 'deBanco': inteiro(pago.get('deBanco'))}
            if qtd_lote is not None:
                resposta.update(tipo='pedra', qtd=qtd_lote, pedras={'stoneId': a['item_id'], 'qtd': qtd_lote},
                                item=_item_do_lote(a['item_id'], qtd_lote))
            else:
                resposta.update(tipo='peca', qtd=1,
                                item={'itemId': a['item_id'], 'level': a['level'], 'stars': a['stars'], 'iid': serie})
            return 200, self._mc_estado_resposta(resposta, nb, sb, dbb)
        raise Recusa(409, MUDOU, **self._estado_publico(cid))

    def _mc_perdeu(self, p, t):
        """O anúncio já saiu: a proposta (se houver) vira 'perdida' e o comprador fica sabendo
        agora (visto = 1: a resposta é o aviso). Levanta a Recusa 409 'perdeu'."""
        if p is not None:
            with self._escrita():
                self.con.execute("UPDATE mercado_propostas SET estado = 'perdida', resolvida_em = ?, visto = 1 "
                                 "WHERE id = ? AND estado IN ('aberta', 'aceita', 'perdida')", (t, p['id']))
        raise Recusa(409, 'esse item já foi vendido — você perdeu essa negociação', motivo='perdeu')

    def mercado_comprar(self, conta, corpo):
        self._mc_abre(conta)
        return self._mc_vende(conta, _id(corpo, 'anuncioId'))

    # -- as propostas ----------------------------------------------------------------------------------
    def mercado_propor(self, conta, corpo):
        migrado = self._mc_abre(conta)
        cid = conta['id']
        aid = _id(corpo, 'anuncioId')
        valor = corpo.get('valor')
        if not _inteiro_puro(valor) or valor < 1:
            raise Recusa(400, 'a proposta precisa ser de pelo menos 1 vintém')
        t = agora()
        chave = 'mc-proposta:%d' % cid
        with self._escrita():
            a = self._mc_anuncio(aid)
            if a['estado'] != 'aberto':
                raise Recusa(409, 'esse anúncio já saiu do balcão', motivo='fechado')
            if a['vendedor_id'] == cid:
                raise Recusa(400, 'esse anúncio é seu')
            if valor >= a['preco']:
                raise Recusa(400, 'a proposta precisa ser menor que o preço (%d) — para pagar o preço, compre' % a['preco'])
            estado = self._estado_exige(cid)
            saco, banco = _saldo(estado['db'])
            if saco + banco < valor:
                raise Recusa(409, 'vinténs insuficientes para essa proposta: faltam %d (somando saco e banco)'
                             % (valor - saco - banco), motivo='saldo', faltam=valor - saco - banco)
            em = [r[0] for r in self.con.execute("SELECT em FROM limites WHERE chave = ? AND em > ? ORDER BY em",
                                                 (chave, t - 3600))]
            if len(em) >= PROPOSTAS_POR_HORA:
                raise Recusa(429, 'propostas demais na última hora (máximo %d)' % PROPOSTAS_POR_HORA,
                             liberaEm=em[len(em) - PROPOSTAS_POR_HORA] + 3600)
            self.con.execute("INSERT INTO limites(chave, em) VALUES (?, ?)", (chave, t))
            self.con.execute("DELETE FROM limites WHERE chave = ? AND em < ?", (chave, t - 3600))
            # uma proposta viva por comprador por anúncio: a nova cancela a antiga
            self.con.execute("UPDATE mercado_propostas SET estado = 'cancelada', resolvida_em = ?, visto = 1 "
                             "WHERE anuncio_id = ? AND comprador_id = ? AND estado IN ('aberta', 'aceita')", (t, aid, cid))
            cur = self.con.execute("INSERT INTO mercado_propostas(anuncio_id, comprador_id, valor, estado, criado_em) "
                                   "VALUES (?, ?, ?, 'aberta', ?)", (aid, cid, valor, t))
            pid = cur.lastrowid
            self._evento(cid, 'mercado-proposta', {'id': pid, 'anuncio': aid, 'valor': valor})
        return 200, self._mc_com_migracao({'ok': True, 'proposta': {'id': pid, 'anuncioId': aid, 'valor': valor,
                                                                    'estado': 'aberta'}}, migrado)

    def mercado_cancelar(self, conta, corpo):
        migrado = self._mc_abre(conta)
        cid, pid, t = conta['id'], _id(corpo, 'propostaId'), agora()
        with self._escrita():
            p = self.con.execute("SELECT * FROM mercado_propostas WHERE id = ?", (pid,)).fetchone()
            if p is None or p['comprador_id'] != cid:
                raise Recusa(404, 'essa proposta não existe')
            if p['estado'] not in VIVAS:
                raise Recusa(409, 'essa proposta já foi resolvida (%s)' % p['estado'])
            self.con.execute("UPDATE mercado_propostas SET estado = 'cancelada', resolvida_em = ?, visto = 1 WHERE id = ?",
                             (t, pid))
        return 200, self._mc_com_migracao({'ok': True, 'estado': 'cancelada'}, migrado)

    def mercado_responder(self, conta, corpo):
        """O vendedor aceita ou recusa uma proposta 'aberta' do seu anúncio aberto."""
        migrado = self._mc_abre(conta)
        cid, pid, t = conta['id'], _id(corpo, 'propostaId'), agora()
        aceitar = corpo.get('aceitar')
        if not isinstance(aceitar, bool):
            raise Recusa(400, 'aceitar precisa ser true ou false')
        with self._escrita():
            p = self.con.execute("SELECT * FROM mercado_propostas WHERE id = ?", (pid,)).fetchone()
            a = self.con.execute("SELECT * FROM mercado_anuncios WHERE id = ?", (p['anuncio_id'],)).fetchone() if p else None
            if p is None or a is None or a['vendedor_id'] != cid:
                raise Recusa(404, 'essa proposta não existe')
            if a['estado'] != 'aberto':
                raise Recusa(409, 'esse anúncio já saiu do balcão')
            if p['estado'] != 'aberta':
                raise Recusa(409, 'essa proposta já foi respondida (%s)' % p['estado'])
            if aceitar:
                self.con.execute("UPDATE mercado_propostas SET estado = 'aceita', aceita_em = ?, visto = 0, "
                                 "visto_vendedor = 1 WHERE id = ?", (t, pid))
            else:
                self.con.execute("UPDATE mercado_propostas SET estado = 'recusada', resolvida_em = ?, visto = 0, "
                                 "visto_vendedor = 1 WHERE id = ?", (t, pid))
            self._evento(cid, 'mercado-resposta', {'proposta': pid, 'anuncio': a['id'], 'aceitou': aceitar})
        return 200, self._mc_com_migracao({'ok': True, 'estado': 'aceita' if aceitar else 'recusada'}, migrado)

    def mercado_confirmar(self, conta, corpo):
        """O comprador confirma (ou nega) a proposta que o vendedor aceitou."""
        self._mc_abre(conta)
        cid, pid = conta['id'], _id(corpo, 'propostaId')
        aceitar = corpo.get('aceitar')
        if not isinstance(aceitar, bool):
            raise Recusa(400, 'aceitar precisa ser true ou false')
        with self.tranca:
            p = self.con.execute("SELECT * FROM mercado_propostas WHERE id = ?", (pid,)).fetchone()
            if p is None or p['comprador_id'] != cid:
                raise Recusa(404, 'essa proposta não existe')
            p = dict(p)
        if not aceitar:
            t = agora()
            with self._escrita():
                n = self.con.execute("UPDATE mercado_propostas SET estado = 'desistiu', resolvida_em = ?, visto = 1 "
                                     "WHERE id = ? AND estado = 'aceita'", (t, pid)).rowcount
                if not n:
                    raise Recusa(409, 'essa proposta não está esperando a sua confirmação')
            return 200, {'ok': True, 'estado': 'desistiu'}
        if p['estado'] == 'perdida':
            raise Recusa(409, 'esse item já foi vendido — você perdeu essa negociação', motivo='perdeu')
        return self._mc_vende(conta, p['anuncio_id'], proposta_id=pid)

    # -- POST /api/mercado/retirar -------------------------------------------------------------------
    def mercado_retirar(self, conta, corpo):
        self._mc_abre(conta)
        cid, aid = conta['id'], _id(corpo, 'anuncioId')
        for _ in range(TENTATIVAS):
            t = agora()
            with self.tranca:
                a = self._mc_anuncio(aid)
                if a['vendedor_id'] != cid:
                    raise Recusa(404, 'esse anúncio não existe')
                if a['estado'] != 'aberto':
                    raise Recusa(409, 'esse anúncio já saiu do balcão (%s)' % a['estado'])
                estado = self._estado_exige(cid)
                qtd_lote = self._mc_lote(aid)
            item = {'itemId': a['item_id'], 'level': a['level'], 'stars': a['stars']}
            if a['iid']:
                item['iid'] = a['iid']
            if qtd_lote is not None:
                # 22/09: o lote de pedras volta ao estoque do vendedor (sem série, sem saco cheio)
                op = {'nome': 'mercadoPoePedras', 'args': {'stoneId': a['item_id'], 'qtd': qtd_lote}}
            else:
                op = {'nome': 'mercadoPoe', 'args': {'item': item}}
            try:
                saida = self._juiz_op(conta, estado, [op], interno=True)
            except Recusa as e:
                if e.status == 422 and e.extra.get('motivo') == 'saco':
                    raise Recusa(409, 'o seu saco está cheio — abra espaço e tente de novo', motivo='saco')
                raise
            res = (saida.get('resultados') or [None])[0]
            serie = res.get('iid') if isinstance(res, dict) else None
            if qtd_lote is not None:
                if (not isinstance(res, dict) or res.get('ok') is not True or res.get('stoneId') != a['item_id']
                        or res.get('qtd') != qtd_lote):
                    raise Recusa(503, 'o juiz respondeu torto — nada foi retirado')
            elif not iid_valido(serie) or (a['iid'] and serie != a['iid']):
                raise Recusa(503, 'o juiz respondeu torto — nada foi retirado')
            try:
                with self._escrita():
                    a2 = self.con.execute("SELECT * FROM mercado_anuncios WHERE id = ?", (aid,)).fetchone()
                    if a2 is None or dict(a2) != dict(a):
                        raise EstadoMudou()
                    nova, db = self._estado_grava(conta, estado, saida, t, poupar=[a['iid']] if a['iid'] else [])
                    self.con.execute("UPDATE mercado_anuncios SET estado = 'retirado', fechado_em = ?, visto_vendedor = 1 "
                                     "WHERE id = ?", (t, aid))
                    self.con.execute("UPDATE mercado_propostas SET estado = 'cancelada', resolvida_em = ?, visto = 0 "
                                     "WHERE anuncio_id = ? AND estado IN ('aberta', 'aceita')", (t, aid))
                    trilha = {'anuncio': aid, 'iid': serie, 'versao': nova}
                    if qtd_lote is not None:
                        trilha.update(tipo='pedra', itemId=a['item_id'], qtd=qtd_lote)
                    self._evento(cid, 'mercado-retira', trilha)
            except EstadoMudou:
                continue
            if qtd_lote is not None:
                resposta = {'ok': True, 'tipo': 'pedra', 'pedras': {'stoneId': a['item_id'], 'qtd': qtd_lote},
                            'item': _item_do_lote(a['item_id'], qtd_lote)}
            else:
                resposta = {'ok': True, 'tipo': 'peca', 'item': dict(item, iid=serie)}
            return 200, self._mc_estado_resposta(resposta, nova, saida, db)
        raise Recusa(409, MUDOU, **self._estado_publico(cid))

    # -- as leituras -----------------------------------------------------------------------------------
    def mercado_resumo(self, conta, corpo):
        """Por item à venda: quantos, o menor preço e quantos são meus. O cliente separa por tipo
        (o espaço da peça) e busca pelo nome com os dados do jogo (JOGO.DATA) — nenhum número
        das peças é copiado para cá.
        22/09: `itens` é só de PEÇAS (o `qtd` dali é quantos anúncios); os lotes de pedra vêm em
        `pedras`, um por pedra: quantos lotes, quantas pedras somadas, o menor preço de lote, o
        menor preço POR PEDRA (2 casas) e quantos lotes são meus."""
        migrado = self._mc_abre(conta)
        with self.tranca:
            linhas = self.con.execute(
                "SELECT item_id, COUNT(*) AS qtd, MIN(preco) AS menor, SUM(vendedor_id = ?) AS meus "
                "FROM mercado_anuncios a WHERE estado = 'aberto' "
                "AND NOT EXISTS (SELECT 1 FROM mercado_lotes l WHERE l.anuncio_id = a.id) "
                "GROUP BY item_id ORDER BY item_id", (conta['id'],)).fetchall()
            lotes = self.con.execute(
                "SELECT a.item_id, COUNT(*) AS lotes, SUM(l.qtd) AS pedras, MIN(a.preco) AS menor, "
                "MIN(a.preco * 1.0 / l.qtd) AS menor_unit, SUM(a.vendedor_id = ?) AS meus "
                "FROM mercado_anuncios a JOIN mercado_lotes l ON l.anuncio_id = a.id "
                "WHERE a.estado = 'aberto' AND l.tipo = 'pedra' GROUP BY a.item_id ORDER BY a.item_id",
                (conta['id'],)).fetchall()
        itens = [{'itemId': r['item_id'], 'qtd': r['qtd'], 'menor': r['menor'], 'meus': r['meus'] or 0} for r in linhas]
        pedras = [{'stoneId': r['item_id'], 'lotes': r['lotes'], 'pedras': r['pedras'], 'menor': r['menor'],
                   'menorUnit': _duas_casas(r['menor_unit']), 'meus': r['meus'] or 0} for r in lotes]
        return 200, self._mc_com_migracao({'ok': True, 'itens': itens, 'pedras': pedras, 'taxaPct': TAXA_PCT,
                                           'precoMax': PRECO_MAX, 'lotesPedra': list(LOTES_PEDRA)}, migrado)

    def mercado_item(self, conta, corpo):
        """TODOS os anúncios abertos de um item (o mesmo item pode estar à venda por vários
        jogadores), do mais barato ao mais caro, com quem vende e a minha proposta viva.
        22/09: o mesmo `?id=` serve à pedra (o id da pedra): cada anúncio leva `tipo`, `qtd` e
        `unit` (o preço por pedra; na peça, o próprio preço), e a ordem é pelo preço POR PEDRA e
        depois pelo preço do lote — para a peça (qtd 1) é a ordem de sempre."""
        migrado = self._mc_abre(conta)
        item_id = (corpo.get('_query') or {}).get('id')
        if not isinstance(item_id, str) or not RE_ITEM.match(item_id):
            raise Recusa(400, 'informe o item: ?id=<itemId>')
        cid = conta['id']
        with self.tranca:
            linhas = self.con.execute(
                "SELECT a.*, l.qtd AS lote_qtd FROM mercado_anuncios a " + LOTE_JUNTA +
                "WHERE a.estado = 'aberto' AND a.item_id = ? ORDER BY (a.preco * 1.0 / COALESCE(l.qtd, 1)), a.preco, "
                "a.level DESC, a.stars DESC, a.criado_em LIMIT ?", (item_id, LISTA_MAX)).fetchall()
            ids = [r['id'] for r in linhas]
            minhas = {}
            for i in range(0, len(ids), 400):
                parte = ids[i:i + 400]
                for p in self.con.execute(
                        "SELECT id, anuncio_id, valor, estado FROM mercado_propostas WHERE comprador_id = ? "
                        "AND estado IN ('aberta', 'aceita') AND anuncio_id IN (%s)" % ','.join('?' * len(parte)),
                        [cid] + parte):
                    minhas[p['anuncio_id']] = {'id': p['id'], 'valor': p['valor'], 'estado': p['estado']}
            nomes = self._mc_nomes(r['vendedor_id'] for r in linhas)
        anuncios = []
        for r in linhas:
            tq = _tipo_qtd(r['lote_qtd'])
            anuncios.append(dict(tq, id=r['id'], vendedor=nomes.get(r['vendedor_id']), level=r['level'], stars=r['stars'],
                                 preco=r['preco'], unit=_unitario(r['preco'], tq['qtd']), meu=r['vendedor_id'] == cid,
                                 minhaProposta=minhas.get(r['id']), criadoEm=r['criado_em']))
        return 200, self._mc_com_migracao({'ok': True, 'itemId': item_id, 'anuncios': anuncios}, migrado)

    def mercado_meus(self, conta, corpo):
        """Os meus anúncios abertos com as propostas recebidas, e as minhas vendas recentes."""
        migrado = self._mc_abre(conta)
        cid = conta['id']
        with self.tranca:
            abertos = self.con.execute("SELECT a.*, l.qtd AS lote_qtd FROM mercado_anuncios a " + LOTE_JUNTA +
                                       "WHERE a.vendedor_id = ? AND a.estado = 'aberto' "
                                       "ORDER BY a.criado_em DESC", (cid,)).fetchall()
            ids = [r['id'] for r in abertos]
            props = self.con.execute(
                "SELECT * FROM mercado_propostas WHERE anuncio_id IN (%s) ORDER BY valor DESC, criado_em"
                % ','.join('?' * len(ids)), ids).fetchall() if ids else []
            vendas = self.con.execute("SELECT a.*, l.qtd AS lote_qtd FROM mercado_anuncios a " + LOTE_JUNTA +
                                      "WHERE a.vendedor_id = ? AND a.estado = 'vendido' "
                                      "ORDER BY a.fechado_em DESC LIMIT ?", (cid, RECENTES)).fetchall()
            nomes = self._mc_nomes([p['comprador_id'] for p in props] + [v['comprador_id'] for v in vendas])
        por_anuncio = {}
        for p in props:
            # as resolvidas há mais de 3 dias saem da lista (a de hoje ainda conta a história)
            if p['estado'] not in VIVAS and (p['resolvida_em'] or 0) < agora() - 3 * 86400:
                continue
            por_anuncio.setdefault(p['anuncio_id'], []).append({
                'id': p['id'], 'comprador': nomes.get(p['comprador_id']), 'valor': p['valor'], 'estado': p['estado'],
                'taxa': taxa_de(p['valor']), 'vistoVendedor': bool(p['visto_vendedor']), 'criadoEm': p['criado_em']})
        anuncios = [dict(_tipo_qtd(a['lote_qtd']), id=a['id'], itemId=a['item_id'], level=a['level'], stars=a['stars'],
                         preco=a['preco'], taxa=taxa_de(a['preco']), criadoEm=a['criado_em'],
                         propostas=por_anuncio.get(a['id'], []))
                    for a in abertos]
        recentes = [dict(_tipo_qtd(v['lote_qtd']), id=v['id'], itemId=v['item_id'], level=v['level'], stars=v['stars'],
                         preco=v['preco'], valor=v['valor_final'], taxa=v['taxa'],
                         recebeu=(v['valor_final'] or 0) - (v['taxa'] or 0), comprador=nomes.get(v['comprador_id']),
                         viaProposta=v['proposta_id'] is not None, fechadoEm=v['fechado_em'])
                    for v in vendas]
        return 200, self._mc_com_migracao({'ok': True, 'anuncios': anuncios, 'vendas': recentes,
                                           'max': ANUNCIOS_MAX}, migrado)

    def mercado_propostas(self, conta, corpo):
        """As minhas propostas (as vivas primeiro), com o item, o preço, o valor e quem vende."""
        migrado = self._mc_abre(conta)
        cid = conta['id']
        with self.tranca:
            linhas = self.con.execute(
                "SELECT p.*, a.item_id, a.level, a.stars, a.preco, a.vendedor_id, a.estado AS anuncio_estado, "
                "l.qtd AS lote_qtd FROM mercado_propostas p JOIN mercado_anuncios a ON a.id = p.anuncio_id " + LOTE_JUNTA +
                "WHERE p.comprador_id = ? ORDER BY (p.estado IN ('aberta', 'aceita')) DESC, p.criado_em DESC LIMIT ?", (cid, RECENTES * 2)).fetchall()
            nomes = self._mc_nomes(r['vendedor_id'] for r in linhas)
        return 200, self._mc_com_migracao({'ok': True, 'propostas': [self._mc_proposta_publica(r, nomes) for r in linhas]},
                                          migrado)

    @staticmethod
    def _mc_proposta_publica(r, nomes):
        # a linha vem com `lote_qtd` (LOTE_JUNTA): o lote de pedras diz tipo 'pedra' e o tamanho
        return dict(_tipo_qtd(r['lote_qtd']), id=r['id'], anuncioId=r['anuncio_id'], itemId=r['item_id'],
                    level=r['level'], stars=r['stars'], preco=r['preco'], valor=r['valor'], estado=r['estado'],
                    vendedor=nomes.get(r['vendedor_id']), anuncioAberto=r['anuncio_estado'] == 'aberto',
                    criadoEm=r['criado_em'], aceitaEm=r['aceita_em'], resolvidaEm=r['resolvida_em'])

    def mercado_avisos(self, conta, corpo):
        """O que o cliente precisa mostrar agora:
          confirmar  as minhas propostas que o vendedor aceitou (a tela "deseja aceitar?")
          desfechos  as minhas propostas recusadas, perdidas ou canceladas que eu ainda não vi
          vendas     os meus anúncios vendidos que eu ainda não vi (com o valor e a taxa)
          recebidas  as propostas novas nos meus anúncios abertos
        O POST /api/mercado/visto marca."""
        migrado = self._mc_abre(conta)
        cid = conta['id']
        base = ("SELECT p.*, a.item_id, a.level, a.stars, a.preco, a.vendedor_id, a.estado AS anuncio_estado, "
                "l.qtd AS lote_qtd FROM mercado_propostas p JOIN mercado_anuncios a ON a.id = p.anuncio_id " + LOTE_JUNTA)
        with self.tranca:
            confirmar = self.con.execute(base + "WHERE p.comprador_id = ? AND p.estado = 'aceita' AND a.estado = 'aberto' "
                                         "ORDER BY p.aceita_em LIMIT ?", (cid, RECENTES)).fetchall()
            desfechos = self.con.execute(base + "WHERE p.comprador_id = ? AND p.visto = 0 "
                                         "AND p.estado IN ('recusada', 'perdida', 'cancelada') "
                                         "ORDER BY p.resolvida_em LIMIT ?", (cid, RECENTES)).fetchall()
            recebidas = self.con.execute(
                "SELECT p.*, a.item_id, a.level, a.stars, a.preco, l.qtd AS lote_qtd FROM mercado_propostas p "
                "JOIN mercado_anuncios a ON a.id = p.anuncio_id " + LOTE_JUNTA +
                "WHERE a.vendedor_id = ? AND a.estado = 'aberto' "
                "AND p.estado = 'aberta' AND p.visto_vendedor = 0 ORDER BY p.criado_em LIMIT ?", (cid, RECENTES)).fetchall()
            vendas = self.con.execute("SELECT a.*, l.qtd AS lote_qtd FROM mercado_anuncios a " + LOTE_JUNTA +
                                      "WHERE a.vendedor_id = ? AND a.estado = 'vendido' "
                                      "AND a.visto_vendedor = 0 ORDER BY a.fechado_em LIMIT ?", (cid, RECENTES)).fetchall()
            nomes = self._mc_nomes([r['vendedor_id'] for r in confirmar] + [r['vendedor_id'] for r in desfechos]
                                   + [r['comprador_id'] for r in recebidas] + [v['comprador_id'] for v in vendas])
        resposta = {
            'ok': True,
            'confirmar': [self._mc_proposta_publica(r, nomes) for r in confirmar],
            'desfechos': [self._mc_proposta_publica(r, nomes) for r in desfechos],
            'recebidas': [dict(_tipo_qtd(r['lote_qtd']), id=r['id'], anuncioId=r['anuncio_id'], itemId=r['item_id'],
                               level=r['level'], stars=r['stars'], preco=r['preco'], valor=r['valor'],
                               comprador=nomes.get(r['comprador_id'])) for r in recebidas],
            'vendas': [dict(_tipo_qtd(v['lote_qtd']), id=v['id'], itemId=v['item_id'], level=v['level'], stars=v['stars'],
                            preco=v['preco'], valor=v['valor_final'], taxa=v['taxa'],
                            recebeu=(v['valor_final'] or 0) - (v['taxa'] or 0), comprador=nomes.get(v['comprador_id']),
                            viaProposta=v['proposta_id'] is not None) for v in vendas],
        }
        return 200, self._mc_com_migracao(resposta, migrado)

    def mercado_visto(self, conta, corpo):
        """Marca como vistos: {desfechos: [ids de proposta], vendas: [ids de anúncio],
        recebidas: [ids de proposta]}. Só o que é da conta muda."""
        self._mc_liga()
        cid = conta['id']

        def ids(nome):
            v = corpo.get(nome)
            if v is None:
                return []
            if not isinstance(v, list) or len(v) > 200 or not all(_inteiro_puro(x) and 0 < x < 2 ** 53 for x in v):
                raise Recusa(400, '%s precisa ser uma lista de até 200 ids' % nome)
            return list(set(v))
        desf, vendas, receb = ids('desfechos'), ids('vendas'), ids('recebidas')
        with self._escrita():
            if desf:
                self.con.executemany("UPDATE mercado_propostas SET visto = 1 WHERE id = ? AND comprador_id = ?",
                                     [(i, cid) for i in desf])
            if vendas:
                self.con.executemany("UPDATE mercado_anuncios SET visto_vendedor = 1 WHERE id = ? AND vendedor_id = ?",
                                     [(i, cid) for i in vendas])
            if receb:
                self.con.executemany(
                    "UPDATE mercado_propostas SET visto_vendedor = 1 WHERE id = ? AND anuncio_id IN "
                    "(SELECT id FROM mercado_anuncios WHERE vendedor_id = ?)", [(i, cid) for i in receb])
        return 200, {'ok': True}
