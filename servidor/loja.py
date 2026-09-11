#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A loja de vinténs (Fase C): o site vende, o jogo entrega, o save confirma.

Entra no cartório como mixin (`class Api(ContaMixin, LojaMixin)` no api.py).

O CAMINHO DE UM PEDIDO:
  1. o site compra (POST /api/loja/comprar): o servidor confere o saldo que o
     ÚLTIMO SAVE mostrou (só o bolso, `db.carteira.moedas`; o cofre não conta)
     menos a RESERVA (os pedidos pendentes e retirados), e o pedido nasce
     'pendente' com a entrega congelada;
  2. o jogo busca (POST /api/loja/retirar): 'pendente' vira 'retirado';
  3. o jogo desconta os vinténs, entrega e anota o id em `db.loja.aplicadas`
     (ou em `db.loja.recusadas`, com o motivo);
  4. o PUT /api/save que traz a anotação confirma, NA MESMA TRANSAÇÃO do save
     (`_loja_confirma`): 'entregue' ou 'estornado'. Uma confirmação separada
     podia marcar 'entregue' e o save seguinte levar 409 de outra máquina — o
     save vencedor não teria o item, e ele se perderia.

Os preços moram SÓ aqui (CATALOGO): o site e o jogo nunca repetem um número.
Rever o catálogo a cada portal aberto: a renda por hora pode dobrar.
"""
import json
import logging
import re

from comum import CLASSE_RENOMEADA, XP_MAX, Recusa, agora, classe_do_heroi, inteiro, limita

log = logging.getLogger('api')

LOJA_VERSAO = 1
# espelha JOGO.DATA.pergaminhos.xp (progression.js); tests/loja_api.py confere
PERGAMINHO_XP = {'fator': 1.5, 'salas': 9}
ABERTOS_MAX = 5                  # pedidos pendentes + retirados por conta
COMPRAS_POR_HORA = 10            # pendente, retirado e entregue: cancelar e estornar devolvem a vaga
PEDIDOS_POR_HORA = 30            # LINHAS criadas por hora, em qualquer estado, o Mestre inclusive (segura o disco)
RETIRADO_PRESO = 24 * 3600       # retirado há mais que isso e não entregue: o site deixa cancelar
PEDIDOS_LISTA = 30
ANOTACAO_MAX = 200               # ids em db.loja.aplicadas / recusadas que o save pode trazer
MOTIVOS = ('sem-saldo', 'classe-ja-liberada', 'item-invalido', 'erro-local')
RE_IDEM = re.compile(r'^[A-Za-z0-9_-]{8,64}$')
CARTEIRA_TETO = 10 ** 12
ELEMENTAIS = ('fogo', 'agua', 'terra', 'ar')

ESQUEMA_LOJA = """
CREATE TABLE IF NOT EXISTS loja_pedidos(
  id          INTEGER PRIMARY KEY,
  conta_id    INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  sku         TEXT NOT NULL,
  entrega     TEXT NOT NULL,
  preco       INTEGER NOT NULL CHECK (preco >= 0),
  estado      TEXT NOT NULL DEFAULT 'pendente'
    CHECK (estado IN ('pendente', 'retirado', 'entregue', 'estornado', 'cancelado')),
  idem        TEXT,
  motivo      TEXT,
  criado_em   INTEGER NOT NULL,
  retirado_em INTEGER,
  fechado_em  INTEGER,
  versao_save INTEGER
);
CREATE INDEX IF NOT EXISTS loja_pedidos_conta ON loja_pedidos(conta_id, estado);
CREATE UNIQUE INDEX IF NOT EXISTS loja_pedidos_idem ON loja_pedidos(conta_id, idem) WHERE idem IS NOT NULL;
"""


# ---- o catálogo ---------------------------------------------------------------------
def _pergaminho_xp():
    fator, salas = PERGAMINHO_XP['fator'], PERGAMINHO_XP['salas']
    return {'sku': 'pergaminho-xp', 'secao': 'pergaminhos', 'tipo': 'pergaminho', 'alvo': 'xp', 'qtd': 1,
            'nome': 'Pergaminho da Sabedoria',
            'descricao': ('+%d%% de experiência para o grupo nas próximas %d salas vencidas. Com um evento de XP '
                          'no ar, os dois juntos param em ×2.' % (round((fator - 1) * 100), salas)),
            'preco': 1500, 'limite': {'grupo': 'pergaminho-xp', 'max': 1, 'dias': 7}}


def _pedras(elemento, alvo, nome, de, preco):
    if elemento == 'neutro':
        descricao = 'Dez %s, a pedra neutra da forja. Sobem as peças neutras, que aceitam qualquer pedra.' % nome[3:]
    else:
        descricao = ('Dez pedras de forja %s: sobem as peças %s (as peças neutras aceitam qualquer pedra).'
                     % (de[0], de[1]))
    return {'sku': 'pedras-' + elemento, 'secao': 'pedras', 'tipo': 'pedras', 'alvo': alvo, 'qtd': 10,
            'elemento': elemento, 'nome': nome, 'descricao': descricao, 'preco': preco,
            'limite': {'grupo': 'pedras', 'max': 5, 'dias': 7}}


def _classe(cid, nome, raridade, cartas, preco):
    return {'sku': 'classe-' + cid, 'secao': 'personagens', 'tipo': 'classe', 'alvo': cid, 'qtd': 1,
            'nome': nome, 'raridade': raridade, 'cartas': cartas,
            'descricao': ('Libera o %s na hora: chegam as cartas que faltam para as %d do desbloqueio (as que '
                          'você já tem contam). Chega no nível 1.' % (nome, cartas)),
            'preco': preco, 'limite': {'grupo': 'classe-' + cid, 'max': 1, 'dias': None}}


# Fora, de propósito: a Âncora de Forja (é o +10, o "item bom" que tem de ser
# MUITO difícil), equipamento, cartas avulsas, estrelas, selos, giros, pets,
# sorte de saque, bônus de guilda, XP direto e multiplicador de vinténs. As
# classes que já nascem liberadas (sumo, curandeiro) e o gm nunca entram.
CATALOGO = (
    _pergaminho_xp(),
    {'sku': 'pergaminho-elemento', 'secao': 'pergaminhos', 'tipo': 'pergaminho', 'alvo': 'elemento', 'qtd': 1,
     'nome': 'Pergaminho da Reescrita',
     'descricao': ('Troca um caminho elemental de um herói por outro que a classe tenha, sem mexer em nível, '
                   'itens e estrelas. Alternar entre os caminhos que ele já tem continua grátis.'),
     'preco': 5000, 'limite': {'grupo': 'pergaminho-elemento', 'max': 1, 'dias': 30}},
    _pedras('agua', 'stone-tear', '10 Lágrimas de Cisterna', ('da água', 'de água'), 300),
    _pedras('terra', 'stone-root', '10 Grãos de Rocha-Mãe', ('da terra', 'de terra'), 300),
    _pedras('ar', 'stone-breath', '10 Sopros Engarrafados', ('do ar', 'de ar'), 450),
    _pedras('fogo', 'stone-ember', '10 Brasas Coaguladas', ('do fogo', 'de fogo'), 450),
    _pedras('neutro', 'stone-slate', '10 Lascas da Lousa', None, 450),
    _classe('invocador', 'Xamã', 'raro', 10, 8000),
    _classe('bruxo', 'Bruxo', 'raro', 10, 8000),
    _classe('espadachim', 'Ladino', 'epico', 20, 20000),
    _classe('arqueiro', 'Caçador', 'epico', 25, 25000),
    _classe('minotauro', 'Minotauro', 'epico', 30, 30000),
)
POR_SKU = {i['sku']: i for i in CATALOGO}
GRUPOS = {}
for _i in CATALOGO:
    _g = GRUPOS.setdefault(_i['limite']['grupo'], {'max': _i['limite']['max'], 'dias': _i['limite']['dias'],
                                                   'skus': set()})
    _g['skus'].add(_i['sku'])
del _i, _g


def entrega_de(item):
    """O que o jogo recebe, congelado no pedido: {tipo, alvo, qtd}."""
    return {'tipo': item['tipo'], 'alvo': item['alvo'], 'qtd': item['qtd']}


def _json(texto):
    try:
        v = json.loads(texto) if texto else None
    except (TypeError, ValueError):
        return None
    return v if isinstance(v, dict) else None


def _id_valido(v):
    return isinstance(v, int) and not isinstance(v, bool) and 0 < v < 2 ** 53


def le_anotacao(db):
    """`db.loja` do save, conferido: (aplicadas, recusadas). Ids inteiros > 0,
    no máximo os 200 mais novos (o fim da lista) de cada; o motivo fora da
    lista vira 'recusado'. Nunca levanta: o save não pode cair por causa disto."""
    loja = db.get('loja') if isinstance(db, dict) else None
    if not isinstance(loja, dict):
        return [], []
    aplicadas, vistos = [], set()
    brutas = loja.get('aplicadas')
    for v in (brutas[-ANOTACAO_MAX:] if isinstance(brutas, list) else []):
        if _id_valido(v) and v not in vistos:
            vistos.add(v)
            aplicadas.append(v)
    recusadas, vistos = [], set()
    brutas = loja.get('recusadas')
    for v in (brutas[-ANOTACAO_MAX:] if isinstance(brutas, list) else []):
        pid = v.get('id') if isinstance(v, dict) else None
        if _id_valido(pid) and pid not in vistos:
            vistos.add(pid)
            motivo = v.get('motivo')
            recusadas.append((pid, motivo if motivo in MOTIVOS else 'recusado'))
    return aplicadas, recusadas


def _liberadas(progress):
    lista = progress.get('unlockedClasses') if isinstance(progress, dict) else None
    if not isinstance(lista, list):
        return set()
    return {CLASSE_RENOMEADA.get(c, c) for c in lista if isinstance(c, str)}


def _herois(progress):
    """[(heroi_id, ficha)] das fichas de classe do jogo (o gm e as tortas ficam de fora)."""
    herois = progress.get('heroes') if isinstance(progress, dict) else None
    if not isinstance(herois, dict):
        return []
    return [(hid, h) for hid, h in herois.items() if isinstance(h, dict) and classe_do_heroi(hid, h) is not None]


def _escolheu_caminho(h):
    if h.get('element') in ELEMENTAIS:
        return True
    lista = h.get('elements')
    return isinstance(lista, list) and any(e in ELEMENTAIS for e in lista)


# ---- o mixin --------------------------------------------------------------------------
class LojaMixin:

    # -- leituras (sempre dentro da tranca; na compra, dentro de _escrita) -----------------
    def _loja_save(self, cid):
        r = self.con.execute("SELECT progress, db, versao, atualizado_em FROM saves WHERE conta_id = ?",
                             (cid,)).fetchone()
        if r is None:
            return None
        return {'progress': _json(r['progress']), 'db': _json(r['db']), 'versao': r['versao'],
                'em': r['atualizado_em']}

    def _loja_saldo(self, cid, conta, save):
        """Carteira do último save (só o bolso), reserva e disponível."""
        reservado = self.con.execute(
            "SELECT COALESCE(SUM(preco), 0) FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado')",
            (cid,)).fetchone()[0]
        db = save['db'] if save else None
        cart = db.get('carteira') if isinstance(db, dict) else None
        carteira = limita(cart.get('moedas'), 0, CARTEIRA_TETO) if isinstance(cart, dict) else 0
        return {'carteira': carteira, 'reservado': reservado, 'disponivel': carteira - reservado,
                'semFundo': bool(conta['gm']), 'saveVersao': save['versao'] if save else 0,
                'saveEm': save['em'] if save else None}

    def _loja_limites(self, cid, t):
        """{grupo: {usados, max, dias, liberaEm}}. Contam pendente, retirado e
        entregue; cancelado e estornado não. liberaEm: SÓ com o grupo cheio, o
        instante em que a compra que destrava sai da janela; com vaga livre (ou
        sem janela) é null — o campo é contrato público, e uma data com 4 vagas
        livres viraria "limite atingido" em quem o lesse."""
        linhas = self.con.execute(
            "SELECT sku, criado_em FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado', 'entregue') "
            "ORDER BY criado_em", (cid,)).fetchall()
        saida = {}
        for grupo, g in GRUPOS.items():
            janela = g['dias'] * 86400 if g['dias'] else None
            em = [r['criado_em'] for r in linhas if r['sku'] in g['skus'] and (janela is None or r['criado_em'] > t - janela)]
            libera = em[len(em) - g['max']] + janela if janela and len(em) >= g['max'] else None
            saida[grupo] = {'usados': len(em), 'max': g['max'], 'dias': g['dias'], 'liberaEm': libera}
        return saida

    @staticmethod
    def _loja_classes(progress):
        """{classe à venda: {liberada, cartas}} — o site mostra "você tem 6 de 10 cartas"."""
        liberadas = _liberadas(progress)
        cartas = progress.get('cards') if isinstance(progress, dict) else None
        cartas = cartas if isinstance(cartas, dict) else {}
        return {i['alvo']: {'liberada': i['alvo'] in liberadas, 'cartas': max(0, inteiro(cartas.get(i['alvo'])))}
                for i in CATALOGO if i['tipo'] == 'classe'}

    @staticmethod
    def _loja_cancelavel(r, t):
        return r['estado'] == 'pendente' or (r['estado'] == 'retirado' and r['retirado_em'] is not None
                                             and r['retirado_em'] <= t - RETIRADO_PRESO)

    def _loja_pedido(self, r, t):
        item = POR_SKU.get(r['sku'])
        return {'id': r['id'], 'sku': r['sku'], 'nome': item['nome'] if item else r['sku'], 'preco': r['preco'],
                'estado': r['estado'], 'motivo': r['motivo'], 'criadoEm': r['criado_em'],
                'retiradoEm': r['retirado_em'], 'fechadoEm': r['fechado_em'],
                'cancelavel': self._loja_cancelavel(r, t)}

    # -- GET /api/loja/catalogo (público) ---------------------------------------------------
    def loja_catalogo(self, conta, corpo):
        return 200, {'ok': True, 'versao': LOJA_VERSAO,
                     'itens': [dict(i, limite=dict(i['limite'])) for i in CATALOGO]}

    # -- GET /api/loja/minha ------------------------------------------------------------------
    def loja_minha(self, conta, corpo):
        cid, t = conta['id'], agora()
        with self.tranca:
            save = self._loja_save(cid)
            saldo = self._loja_saldo(cid, conta, save)
            limites = self._loja_limites(cid, t)
            pedidos = self.con.execute("SELECT * FROM loja_pedidos WHERE conta_id = ? ORDER BY id DESC LIMIT ?",
                                       (cid, PEDIDOS_LISTA)).fetchall()
        return 200, {'ok': True, 'saldo': saldo, 'limites': limites,
                     'classes': self._loja_classes(save['progress'] if save else None),
                     'pedidos': [self._loja_pedido(r, t) for r in pedidos]}

    # -- POST /api/loja/comprar ------------------------------------------------------------------
    def _loja_confere_item(self, cid, item, progress):
        """O que torna o produto inútil ou repetido — vale também para o Mestre."""
        if item['tipo'] == 'classe':
            if item['alvo'] in _liberadas(progress):
                raise Recusa(409, 'essa classe já está liberada')
            estados = {r[0] for r in self.con.execute(
                "SELECT estado FROM loja_pedidos WHERE conta_id = ? AND sku = ? AND estado IN ('pendente', 'retirado', 'entregue')",
                (cid, item['sku']))}
            if estados & {'pendente', 'retirado'}:
                raise Recusa(409, 'já há um pedido dessa classe a caminho')
            if 'entregue' in estados:
                raise Recusa(409, 'essa classe já foi comprada')
        elif item['tipo'] == 'pergaminho' and item['alvo'] == 'elemento':
            if not any(_escolheu_caminho(h) for _, h in _herois(progress)):
                raise Recusa(409, 'nenhum herói escolheu caminho elemental ainda')
        elif item['tipo'] == 'pergaminho' and item['alvo'] == 'xp':
            xps = [limita(h.get('xp'), 0, XP_MAX) for _, h in _herois(progress)]
            if xps and all(x >= XP_MAX for x in xps):
                raise Recusa(409, 'todos os heróis já estão no nível 30')

    def _loja_confere_limites(self, cid, item, t):
        lim = self._loja_limites(cid, t)[item['limite']['grupo']]
        if lim['usados'] >= lim['max']:
            if lim['dias']:
                raise Recusa(429, 'limite deste produto: %d a cada %d dias' % (lim['max'], lim['dias']),
                             liberaEm=lim['liberaEm'])
            raise Recusa(429, 'limite deste produto: %d por conta' % lim['max'])
        abertos = self.con.execute(
            "SELECT COUNT(*) FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado')",
            (cid,)).fetchone()[0]
        if abertos >= ABERTOS_MAX:
            raise Recusa(429, 'pedidos abertos demais (%d)' % ABERTOS_MAX)
        na_hora = [r[0] for r in self.con.execute(
            "SELECT criado_em FROM loja_pedidos WHERE conta_id = ? AND criado_em > ? "
            "AND estado IN ('pendente', 'retirado', 'entregue') ORDER BY criado_em", (cid, t - 3600))]
        if len(na_hora) >= COMPRAS_POR_HORA:
            raise Recusa(429, 'compras demais na última hora (%d)' % COMPRAS_POR_HORA,
                         liberaEm=na_hora[len(na_hora) - COMPRAS_POR_HORA] + 3600)

    def _loja_confere_teto(self, cid, t):
        """O teto de LINHAS: PEDIDOS_POR_HORA pedidos criados na última hora,
        em QUALQUER estado — cancelado e estornado inclusive — e para o Mestre
        também. COMPRAS_POR_HORA devolve a vaga de propósito quando o pedido é
        cancelado ou estornado (o jogador não perdeu nada), mas cada ciclo
        grava uma linha em loja_pedidos e duas em eventos, que ninguém poda: um
        laço de comprar-e-cancelar enchia o disco a 1 GB por dia por conta. O
        dono não compra 30 vezes por hora, e um token de Mestre roubado não
        pode encher o disco."""
        criados = [r[0] for r in self.con.execute(
            "SELECT criado_em FROM loja_pedidos WHERE conta_id = ? AND criado_em > ? ORDER BY criado_em",
            (cid, t - 3600))]
        if len(criados) >= PEDIDOS_POR_HORA:
            raise Recusa(429, 'pedidos demais na última hora (%d)' % PEDIDOS_POR_HORA,
                         liberaEm=criados[len(criados) - PEDIDOS_POR_HORA] + 3600)

    def loja_comprar(self, conta, corpo):
        sku, idem = corpo.get('sku'), corpo.get('idem')
        item = POR_SKU.get(sku) if isinstance(sku, str) else None
        if item is None:
            raise Recusa(400, 'produto desconhecido')
        if not isinstance(idem, str) or not RE_IDEM.match(idem):
            raise Recusa(400, 'idem inválido (8 a 64 letras, dígitos, _ ou -)')
        cid, t, mestre = conta['id'], agora(), bool(conta['gm'])
        # tudo numa transação de escrita: saldo, reserva e limites lidos com a
        # trava entre processos pega — duas compras (até em dois contêineres)
        # não gastam o mesmo vintém
        with self._escrita():
            save = self._loja_save(cid)
            ja = self.con.execute("SELECT * FROM loja_pedidos WHERE conta_id = ? AND idem = ?", (cid, idem)).fetchone()
            if ja is not None:                          # o mesmo clique chegando de novo
                if ja['sku'] != sku:
                    raise Recusa(409, 'idem já usado em outro produto')
                return 200, {'ok': True, 'pedido': self._loja_pedido(ja, t), 'saldo': self._loja_saldo(cid, conta, save)}
            if save is None and not mestre:
                raise Recusa(409, 'o servidor ainda não viu seus vinténs: abra o jogo logado nesta conta '
                                  '(na conta Principal)')
            self._loja_confere_teto(cid, t)             # o teto de linhas vale para todo mundo, Mestre inclusive
            self._loja_confere_item(cid, item, save['progress'] if save else None)
            if not mestre:                              # o Mestre pula o saldo e os limites (bolsoSemFundo)
                self._loja_confere_limites(cid, item, t)
                saldo = self._loja_saldo(cid, conta, save)
                if saldo['disponivel'] < item['preco']:
                    raise Recusa(409, 'vinténs insuficientes', saldo=saldo)
            preco = 0 if mestre else item['preco']
            cur = self.con.execute(
                "INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, idem, criado_em) "
                "VALUES (?, ?, ?, ?, 'pendente', ?, ?)",
                (cid, sku, json.dumps(entrega_de(item), ensure_ascii=False), preco, idem, t))
            r = self.con.execute("SELECT * FROM loja_pedidos WHERE id = ?", (cur.lastrowid,)).fetchone()
            self._evento(cid, 'loja-compra', {'id': r['id'], 'sku': sku, 'preco': preco})
            saldo = self._loja_saldo(cid, conta, save)
        log.info("loja: #%d comprou %s por %d (pedido %d)", cid, sku, preco, r['id'])
        return 201, {'ok': True, 'pedido': self._loja_pedido(r, t), 'saldo': saldo}

    # -- POST /api/loja/cancelar ------------------------------------------------------------------
    def loja_cancelar(self, conta, corpo):
        pid = corpo.get('id')
        if not _id_valido(pid):
            raise Recusa(400, 'id precisa ser o número do pedido')
        cid, t = conta['id'], agora()
        with self._escrita():
            r = self.con.execute("SELECT * FROM loja_pedidos WHERE id = ? AND conta_id = ?", (pid, cid)).fetchone()
            if r is None:                               # inclusive o de outra conta
                raise Recusa(404, 'pedido não encontrado')
            if r['estado'] in ('entregue', 'estornado', 'cancelado'):
                raise Recusa(409, 'pedido já fechado')
            if not self._loja_cancelavel(r, t):
                raise Recusa(409, 'já está a caminho do jogo; espere a entrega ou 24 h')
            self.con.execute("UPDATE loja_pedidos SET estado = 'cancelado', fechado_em = ? WHERE id = ?", (t, pid))
            self._evento(cid, 'loja-cancela', {'id': pid, 'sku': r['sku'], 'de': r['estado']})
            r = self.con.execute("SELECT * FROM loja_pedidos WHERE id = ?", (pid,)).fetchone()
            saldo = self._loja_saldo(cid, conta, self._loja_save(cid))
        return 200, {'ok': True, 'pedido': self._loja_pedido(r, t), 'saldo': saldo}

    # -- POST /api/loja/retirar (o jogo) -------------------------------------------------------------
    def loja_retirar(self, conta, corpo):
        cid, t = conta['id'], agora()
        with self._escrita():
            linhas = self.con.execute(
                "SELECT id, sku, preco, entrega FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado') "
                "ORDER BY id", (cid,)).fetchall()
            self.con.execute("UPDATE loja_pedidos SET estado = 'retirado', retirado_em = ? "
                             "WHERE conta_id = ? AND estado = 'pendente'", (t, cid))
        pedidos = []
        for r in linhas:
            item = POR_SKU.get(r['sku'])
            pedidos.append({'id': r['id'], 'sku': r['sku'], 'nome': item['nome'] if item else r['sku'],
                            'preco': r['preco'], 'entrega': _json(r['entrega']) or {}})
        return 200, {'ok': True, 'pedidos': pedidos}

    # -- dentro do salvar (PUT /api/save) -------------------------------------------------------------
    def _loja_confirma(self, cid, db, nova, t):
        """Chamada no trecho "só escrita" do salvar, na mesma transação do
        save: o que o save diz que aplicou vira 'entregue'; o que recusou,
        'estornado'. NUNCA recusa um save. Id de outra conta não casa com o
        filtro conta_id; pedido já fechado fica como está."""
        aplicadas, recusadas = le_anotacao(db)
        entregues, estornados = [], []
        if aplicadas:
            achados = self.con.execute(
                "SELECT id, estado FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado', 'cancelado') "
                "AND id IN (%s)" % ','.join('?' * len(aplicadas)), [cid] + aplicadas).fetchall()
            if achados:
                entregues = sorted(r['id'] for r in achados)
                self.con.execute(
                    "UPDATE loja_pedidos SET estado = 'entregue', fechado_em = ?, versao_save = ? "
                    "WHERE conta_id = ? AND id IN (%s)" % ','.join('?' * len(entregues)), [t, nova, cid] + entregues)
                self._evento(cid, 'loja-entregue', {'ids': entregues, 'versao': nova})
                for r in achados:
                    if r['estado'] == 'cancelado':      # o jogo aplicou antes de saber do cancelamento
                        self._evento(cid, 'loja-cancelamento-tardio', {'id': r['id'], 'versao': nova})
        aplicada = set(aplicadas)
        for pid, motivo in recusadas:
            if pid in aplicada:                         # nas duas listas: vale a entrega
                continue
            n = self.con.execute(
                "UPDATE loja_pedidos SET estado = 'estornado', motivo = ?, fechado_em = ?, versao_save = ? "
                "WHERE conta_id = ? AND id = ? AND estado IN ('pendente', 'retirado')",
                (motivo, t, nova, cid, pid)).rowcount
            if n:
                estornados.append(pid)
        if estornados:
            self._evento(cid, 'loja-estorno', {'ids': estornados, 'versao': nova})
        return {'entregues': entregues, 'estornados': estornados}
