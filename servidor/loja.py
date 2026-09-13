#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A loja de vinténs: o site vende, o jogo entrega, o save confirma.

Entra no cartório como mixin (`class Api(ContaMixin, LojaMixin, MestreMixin,
PagamentoMixin)` no api.py).

O CAMINHO DE UM PEDIDO:
  1. o site compra (POST /api/loja/comprar): o servidor confere o saldo que o
     ÚLTIMO SAVE mostrou (só o bolso, `db.carteira.moedas`; o cofre não conta)
     mais o que está A CAMINHO (créditos ainda não entregues) menos a RESERVA
     (os pedidos pendentes e retirados), e o pedido nasce 'pendente' com a
     entrega congelada;
  2. o jogo busca (POST /api/loja/retirar): 'pendente' vira 'retirado';
  3. o jogo desconta os vinténs, entrega e anota o id em `db.loja.aplicadas`
     (ou em `db.loja.recusadas`, com o motivo);
  4. o PUT /api/save que traz a anotação confirma, NA MESMA TRANSAÇÃO do save
     (`_loja_confirma`): 'entregue' ou 'estornado'. Uma confirmação separada
     podia marcar 'entregue' e o save seguinte levar 409 de outra máquina — o
     save vencedor não teria o item, e ele se perderia.

OS CRÉDITOS DE VINTÉNS (Loja 2, 10/09): um pacote pago no Mercado Pago
(pagamento.py) ou um presente de vinténs do Mestre (mestre.py) é um pedido de
preço 0 cuja entrega é {tipo:'vintens', alvo:'carteira', qtd:N}, com uma linha
em `loja_creditos` que diz quanto vale e de onde veio. Anda pelo MESMO caminho:
o jogo soma na carteira dentro do save e o PUT fecha. Enquanto não chega, conta
no saldo do site (`aCaminho`): o jogador já pode gastar. O retirar sai em ordem
de id, então o crédito chega ao jogo antes de qualquer compra feita com ele.
Crédito de pacote não se cancela pelo site; recusado pelo jogo, é reemitido
(até 3 vezes; ver pagamento.py).

OS PRESENTES DO MESTRE (10/09, mestre.py): o pedido de preço 0 marcado em
`loja_presentes`. Fica fora dos limites do jogador (nem conta, nem gasta), vale
a mesma regra do produto (classe já liberada ou a caminho = recusa) e anda pelo
mesmo caminho de entrega. Só o Mestre cancela.

OS PREÇOS (a régua de 10/09, medida nos dados do jogo): uma descida completa da
Cisterna no normal paga ~31 vinténs, ~89 por hora (21 min por descida); a
semana típica (1 h por dia de Cisterna + as missões diárias) dá ~1.316, a
puxada (2 h por dia no difícil com desafio) ~3.087. Personagem = 1.000 por
carta do desbloqueio (um raro custa ~7,6 semanas típicas); 7 dias de bônus de
XP = 7.900 (~6 semanas típicas); pedras a ~34× o que o drop dá na mesma hora.
O preço é o freio: pedras, bônus e insígnias não têm janela de limite; ficam
os tetos contra abuso (5 abertos, 10 compras por hora, 30 linhas por hora). Ou
o jogador dropa, ou compra um pacote para adiantar. Rever a cada portal
aberto: o Fecho paga ~1,7× a Cisterna por xp, e um portal novo pode quase
dobrar a hora de referência.

Os preços moram SÓ aqui (CATALOGO e PACOTES): o site e o jogo nunca repetem um
número (o jogo espelha só o que precisa para agir: DATA.bonusXp.fator e
DATA.insignias.porGuilda; tests/loja_api.py confere).
"""
import json
import logging
import re

from comum import (CLASSE_RENOMEADA, XP_MAX, EstadoMudou, Recusa, agora, classe_do_heroi, inteiro,  # noqa: F401
                   liberadas, limita)

log = logging.getLogger('api')

LOJA_VERSAO = 2
# espelha JOGO.DATA.pergaminhos.xp (progression.js). O Pergaminho da Sabedoria
# saiu da venda em 10/09 (o bônus por tempo o substitui); o jogo segue lendo o
# que já foi comprado, e pedido antigo ainda aberto é entregue normalmente
PERGAMINHO_XP = {'fator': 1.5, 'salas': 9}
# espelha JOGO.DATA.bonusXp (progression.js); tests/loja_api.py confere
BONUS_XP = {'fator': 1.5}
# espelha JOGO.DATA.insignias.porGuilda (items_selos.js); tests/loja_api.py confere
INSIGNIAS_POR_GUILDA = 10
ABERTOS_MAX = 5                  # pedidos pendentes + retirados por conta (créditos e presentes fora)
COMPRAS_POR_HORA = 10            # pendente, retirado e entregue: cancelar e estornar devolvem a vaga
PEDIDOS_POR_HORA = 30            # LINHAS criadas por hora, em qualquer estado, o Mestre inclusive (segura o disco)
RETIRADO_PRESO = 24 * 3600       # retirado há mais que isso e não entregue: o site deixa cancelar
PEDIDOS_LISTA = 30
ANOTACAO_MAX = 200               # ids em db.loja.aplicadas / recusadas que o save pode trazer
OPS_LOJA = 40                    # pedidos por entrega no servidor (o OPS_MAX do juiz); o resto sai no retirar seguinte
MOTIVOS = ('sem-saldo', 'classe-ja-liberada', 'item-invalido', 'erro-local')
RE_IDEM = re.compile(r'^[A-Za-z0-9_-]{8,64}$')
CARTEIRA_TETO = 10 ** 12
ELEMENTAIS = ('fogo', 'agua', 'terra', 'ar')
SKU_PRESENTE_VINTENS = 'presente-vintens'    # o presente de vinténs do Mestre (mestre.py)

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
-- os presentes do Mestre (10/09, mestre.py): o pedido é o de loja_pedidos (preço 0); esta linha só diz que é
-- presente. Tabela nova, e não coluna: no rolling update o contêiner velho e o novo usam o mesmo banco
CREATE TABLE IF NOT EXISTS loja_presentes(
  pedido_id     INTEGER PRIMARY KEY REFERENCES loja_pedidos(id) ON DELETE CASCADE,
  por           INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  criado_em     INTEGER NOT NULL,
  cancelado_por INTEGER REFERENCES contas(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS loja_presentes_por ON loja_presentes(por, criado_em);
-- os créditos de vinténs (10/09): pacote pago (pagamento.py) ou presente de vinténs do Mestre. O pedido é o de
-- loja_pedidos (preço 0); esta linha diz quanto vale, para o saldo do site contar o que ainda não chegou ao jogo
CREATE TABLE IF NOT EXISTS loja_creditos(
  pedido_id INTEGER PRIMARY KEY REFERENCES loja_pedidos(id) ON DELETE CASCADE,
  vintens   INTEGER NOT NULL CHECK (vintens > 0),
  origem    TEXT NOT NULL CHECK (origem IN ('pagamento', 'presente')),
  mp_id     TEXT,
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS loja_creditos_mp ON loja_creditos(mp_id);
"""

# os filtros dos limites do JOGADOR: créditos (pacote pago, presente de vinténs)
# e presentes do Mestre não contam nos abertos, nas compras por hora, nas
# linhas por hora nem nas janelas — cada um tem o teto dele
SEM_EXTRA = ("id NOT IN (SELECT pedido_id FROM loja_presentes) "
             "AND id NOT IN (SELECT pedido_id FROM loja_creditos)")
# um pedido com as marcas de presente e de crédito (para _loja_pedido e o retirar)
COLUNAS_PEDIDO = ("p.*, (pr.pedido_id IS NOT NULL) AS presente, cr.vintens AS credito_vintens, "
                  "cr.origem AS credito_origem")
DE_PEDIDOS = ("loja_pedidos p LEFT JOIN loja_presentes pr ON pr.pedido_id = p.id "
              "LEFT JOIN loja_creditos cr ON cr.pedido_id = p.id")


# ---- números para gente ---------------------------------------------------------------
def milhar(n):
    """12000 → '12.000'."""
    return '{:,}'.format(int(n)).replace(',', '.')


def reais(centavos):
    """1990 → 'R$ 19,90' (o site mostra como vem: nenhum número de dinheiro mora no site)."""
    inteiros, cent = divmod(int(centavos), 100)
    return 'R$ %s,%02d' % (milhar(inteiros), cent)


# ---- o catálogo ---------------------------------------------------------------------
def _classe(cid, nome, raridade, cartas, preco):
    return {'sku': 'classe-' + cid, 'secao': 'personagens', 'tipo': 'classe', 'alvo': cid, 'qtd': 1,
            'nome': nome, 'raridade': raridade, 'cartas': cartas,
            'descricao': ('Libera o %s na hora: chegam as cartas que faltam para as %d do desbloqueio (as que '
                          'você já tem contam). Chega no nível 1.' % (nome, cartas)),
            'preco': preco, 'limite': {'grupo': 'classe-' + cid, 'max': 1, 'dias': None}}


def _bonus(dias, preco):
    plural = '' if dias == 1 else 's'
    return {'sku': 'bonus-xp-%d' % dias, 'secao': 'bonus', 'tipo': 'bonus-xp', 'alvo': 'xp', 'qtd': dias,
            'dias': dias, 'nome': 'Bônus de XP — %d dia%s' % (dias, plural),
            'descricao': ('+%d%% de experiência para o grupo por %d dia%s, contados no relógio do servidor a partir '
                          'da entrega no jogo. Comprar de novo soma os dias. Não se multiplica com outro bônus de XP '
                          '(nem com o Pergaminho da Sabedoria), e com um evento de XP no ar os dois juntos param em ×2.'
                          % (round((BONUS_XP['fator'] - 1) * 100), dias, plural)),
            'preco': preco, 'limite': None}


def _pedras(elemento, alvo, nome, de, preco, qtd):
    palavra = {10: 'Dez', 50: 'Cinquenta'}[qtd]
    nome = '%d %s' % (qtd, nome)
    if elemento == 'neutro':
        descricao = ('%s %s, a pedra neutra da forja. Sobem as peças neutras, que aceitam qualquer pedra.'
                     % (palavra, nome[3:]))
    else:
        descricao = ('%s pedras de forja %s: sobem as peças %s (as peças neutras aceitam qualquer pedra).'
                     % (palavra, de[0], de[1]))
    return {'sku': 'pedras-' + elemento + ('' if qtd == 10 else '-%d' % qtd), 'secao': 'pedras', 'tipo': 'pedras',
            'alvo': alvo, 'qtd': qtd, 'elemento': elemento, 'nome': nome, 'descricao': descricao, 'preco': preco,
            'limite': None}


# (elemento, pedra, nome, (da/de), preço de 10, preço de 50: 10% de desconto). Água e terra caem na Cisterna;
# ar, fogo e a neutra valem mais (fogo e neutra não caem em portal aberto: só a loja as dá)
_PEDRAS = (('agua', 'stone-tear', 'Lágrimas de Cisterna', ('da água', 'de água'), 500, 2250),
           ('terra', 'stone-root', 'Grãos de Rocha-Mãe', ('da terra', 'de terra'), 500, 2250),
           ('ar', 'stone-breath', 'Sopros Engarrafados', ('do ar', 'de ar'), 800, 3600),
           ('fogo', 'stone-ember', 'Brasas Coaguladas', ('do fogo', 'de fogo'), 800, 3600),
           ('neutro', 'stone-slate', 'Lascas da Lousa', None, 800, 3600))

# Fora, de propósito: a Âncora de Forja (é o +10, o "item bom" que tem de ser
# MUITO difícil), equipamento, cartas avulsas, estrelas, selos, giros, pets,
# sorte de saque, bônus de guilda, XP direto e multiplicador de vinténs. As
# classes que já nascem liberadas (sumo, curandeiro) e o gm nunca entram.
# Seções na ordem da página: personagens · bonus · pedras · guilda · pergaminhos.
CATALOGO = (
    _classe('invocador', 'Xamã', 'raro', 10, 10000),
    _classe('bruxo', 'Bruxo', 'raro', 10, 10000),
    _classe('espadachim', 'Ladino', 'epico', 20, 20000),
    _classe('arqueiro', 'Caçador', 'epico', 25, 25000),
    _classe('minotauro', 'Minotauro', 'epico', 30, 30000),
    _bonus(1, 1500),
    _bonus(3, 3900),
    _bonus(7, 7900),
) + tuple(_pedras(e, a, n, d, p10, 10) for e, a, n, d, p10, _ in _PEDRAS) + tuple(
    _pedras(e, a, n, d, p50, 50) for e, a, n, d, _, p50 in _PEDRAS) + (
    # "pedras de guilda" = as Insígnias de Fundação (10 fundam uma guilda; só chefe derruba, 50%)
    {'sku': 'insignia-1', 'secao': 'guilda', 'tipo': 'insignias', 'alvo': 'fundacao', 'qtd': 1,
     'nome': '1 Insígnia de Fundação',
     'descricao': 'Uma Insígnia de Fundação, a que só os chefes derrubam. Dez fundam uma guilda.',
     'preco': 500, 'limite': None},
    {'sku': 'insignias-10', 'secao': 'guilda', 'tipo': 'insignias', 'alvo': 'fundacao', 'qtd': INSIGNIAS_POR_GUILDA,
     'nome': '10 Insígnias de Fundação',
     'descricao': 'Dez Insígnias de Fundação, as que só os chefes derrubam: o bastante para fundar uma guilda.',
     'preco': 4500, 'limite': None},
    # a janela da Reescrita é regra de desenho (um caminho por mês), não freio de preço: fica
    {'sku': 'pergaminho-elemento', 'secao': 'pergaminhos', 'tipo': 'pergaminho', 'alvo': 'elemento', 'qtd': 1,
     'nome': 'Pergaminho da Reescrita',
     'descricao': ('Troca um caminho elemental de um herói por outro que a classe tenha, sem mexer em nível, '
                   'itens e estrelas. Alternar entre os caminhos que ele já tem continua grátis.'),
     'preco': 5000, 'limite': {'grupo': 'pergaminho-elemento', 'max': 1, 'dias': 30}},
)
POR_SKU = {i['sku']: i for i in CATALOGO}
# fora da venda: só o nome, para o pedido antigo ainda aberto sair com o nome certo
RETIRADOS = {'pergaminho-xp': {'sku': 'pergaminho-xp', 'nome': 'Pergaminho da Sabedoria', 'tipo': 'pergaminho',
                               'alvo': 'xp', 'qtd': 1}}
GRUPOS = {}
for _i in CATALOGO:
    if _i['limite'] is None:
        continue
    _g = GRUPOS.setdefault(_i['limite']['grupo'], {'max': _i['limite']['max'], 'dias': _i['limite']['dias'],
                                                   'skus': set()})
    _g['skus'].add(_i['sku'])
del _i, _g

# Os PACOTES DE VINTÉNS (dinheiro de verdade, pagamento.py): a tabela em reais mora SÓ aqui.
# R$ por mil: 4,90 · 3,62 · 3,33 · 3,20. O Caçador é exatamente o Tesouro; um raro sai por uma Arca
# com 2.000 de troco. A taxa do Mercado Pago sai do bruto (Pix ~1%, cartão ~5%).
PACOTES = (
    {'id': 'pacote-1000', 'nome': 'Bolsa de 1.000 vinténs', 'vintens': 1000, 'centavos': 490},
    {'id': 'pacote-5500', 'nome': 'Saco de 5.500 vinténs', 'vintens': 5500, 'centavos': 1990},
    {'id': 'pacote-12000', 'nome': 'Arca de 12.000 vinténs', 'vintens': 12000, 'centavos': 3990},
    {'id': 'pacote-25000', 'nome': 'Tesouro de 25.000 vinténs', 'vintens': 25000, 'centavos': 7990},
)
POR_PACOTE = {p['id']: p for p in PACOTES}


def pacote_publico(p):
    return {'id': p['id'], 'nome': p['nome'], 'vintens': p['vintens'], 'centavos': p['centavos'],
            'preco': reais(p['centavos'])}


def entrega_de(item):
    """O que o jogo recebe, congelado no pedido: {tipo, alvo, qtd}."""
    return {'tipo': item['tipo'], 'alvo': item['alvo'], 'qtd': item['qtd']}


def nome_do_pedido(sku, entrega=None, vintens=None):
    """O nome de um pedido: o do catálogo, o de um produto que saiu da venda, o
    de um pacote, '<N> vinténs' no presente de vinténs; senão, o próprio sku."""
    item = POR_SKU.get(sku) or RETIRADOS.get(sku) or POR_PACOTE.get(sku)
    if item is not None:
        return item['nome']
    if sku == SKU_PRESENTE_VINTENS:
        n = vintens if vintens else (entrega.get('qtd') if isinstance(entrega, dict) else None)
        if isinstance(n, int) and not isinstance(n, bool) and n > 0:
            return '%s vinténs' % milhar(n)
    return sku


def _json(texto):
    try:
        v = json.loads(texto) if texto else None
    except (TypeError, ValueError):
        return None
    return v if isinstance(v, dict) else None


le_json = _json


def _id_valido(v):
    return isinstance(v, int) and not isinstance(v, bool) and 0 < v < 2 ** 53


id_valido = _id_valido
_liberadas = liberadas               # (comum.py) as classes liberadas no progress, com o nome antigo corrigido


def origem_do_pedido(r):
    """'presente' (linha em loja_presentes), 'pagamento' (crédito de pacote) ou
    None (compra da loja). `r` vem de uma consulta com COLUNAS_PEDIDO."""
    chaves = r.keys()
    if 'presente' in chaves and r['presente']:
        return 'presente'
    if 'credito_origem' in chaves and r['credito_origem'] == 'pagamento':
        return 'pagamento'
    return None


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

    def _loja_a_caminho(self, cid):
        """Os vinténs dos créditos (pacote pago, presente de vinténs) que o jogo ainda não recebeu."""
        return self.con.execute(
            "SELECT COALESCE(SUM(cr.vintens), 0) FROM loja_creditos cr JOIN loja_pedidos p ON p.id = cr.pedido_id "
            "WHERE p.conta_id = ? AND p.estado IN ('pendente', 'retirado')", (cid,)).fetchone()[0]

    def _loja_saldo(self, cid, conta, save):
        """Carteira do último save (só o bolso), o que está a caminho, a reserva e o disponível."""
        reservado = self.con.execute(
            "SELECT COALESCE(SUM(preco), 0) FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado')",
            (cid,)).fetchone()[0]
        a_caminho = self._loja_a_caminho(cid)
        db = save['db'] if save else None
        cart = db.get('carteira') if isinstance(db, dict) else None
        carteira = limita(cart.get('moedas'), 0, CARTEIRA_TETO) if isinstance(cart, dict) else 0
        return {'carteira': carteira, 'reservado': reservado, 'aCaminho': a_caminho,
                'disponivel': carteira + a_caminho - reservado,
                'semFundo': bool(conta['gm']), 'saveVersao': save['versao'] if save else 0,
                'saveEm': save['em'] if save else None}

    def _loja_limites(self, cid, t):
        """{grupo: {usados, max, dias, liberaEm}} — só os grupos que existem (as
        classes e a Reescrita). Contam pendente, retirado e entregue; cancelado,
        estornado, presente e crédito não. liberaEm: SÓ com o grupo cheio, o
        instante em que a compra que destrava sai da janela; com vaga livre (ou
        sem janela) é null — o campo é contrato público, e uma data com vaga
        livre viraria "limite atingido" em quem o lesse."""
        linhas = self.con.execute(
            "SELECT sku, criado_em FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado', 'entregue') "
            "AND " + SEM_EXTRA + " ORDER BY criado_em", (cid,)).fetchall()
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
        lib = liberadas(progress)
        cartas = progress.get('cards') if isinstance(progress, dict) else None
        cartas = cartas if isinstance(cartas, dict) else {}
        return {i['alvo']: {'liberada': i['alvo'] in lib, 'cartas': max(0, inteiro(cartas.get(i['alvo'])))}
                for i in CATALOGO if i['tipo'] == 'classe'}

    @staticmethod
    def _loja_cancelavel(r, t):
        return r['estado'] == 'pendente' or (r['estado'] == 'retirado' and r['retirado_em'] is not None
                                             and r['retirado_em'] <= t - RETIRADO_PRESO)

    def _loja_pedido(self, r, t):
        """Um pedido como o site vê. Presente e crédito de pacote ganham `origem`
        e não se cancelam pelo site; os créditos, `vintens`. Sem as colunas de
        COLUNAS_PEDIDO, igual a antes."""
        vintens = r['credito_vintens'] if 'credito_vintens' in r.keys() else None
        saida = {'id': r['id'], 'sku': r['sku'], 'nome': nome_do_pedido(r['sku'], _json(r['entrega']), vintens),
                 'preco': r['preco'], 'estado': r['estado'], 'motivo': r['motivo'], 'criadoEm': r['criado_em'],
                 'retiradoEm': r['retirado_em'], 'fechadoEm': r['fechado_em'],
                 'cancelavel': self._loja_cancelavel(r, t)}
        origem = origem_do_pedido(r)
        if origem is not None:
            saida['origem'] = origem
            saida['cancelavel'] = False
        if vintens:
            saida['vintens'] = vintens
        return saida

    def _loja_pedido_por_id(self, pid):
        return self.con.execute("SELECT %s FROM %s WHERE p.id = ?" % (COLUNAS_PEDIDO, DE_PEDIDOS), (pid,)).fetchone()

    # -- GET /api/loja/catalogo (público) ---------------------------------------------------
    def loja_catalogo(self, conta, corpo):
        mp = getattr(self, 'mp', None)
        ligado = bool(mp is not None and mp.ligado)
        return 200, {'ok': True, 'versao': LOJA_VERSAO,
                     'itens': [dict(i, limite=dict(i['limite']) if i['limite'] else None) for i in CATALOGO],
                     'pacotes': [pacote_publico(p) for p in PACOTES],
                     'pagamento': {'ligado': ligado, 'teste': bool(ligado and mp.teste)}}

    # -- GET /api/loja/minha ------------------------------------------------------------------
    def loja_minha(self, conta, corpo):
        cid, t = conta['id'], agora()
        with self.tranca:
            save = self._loja_save(cid)
            saldo = self._loja_saldo(cid, conta, save)
            limites = self._loja_limites(cid, t)
            pedidos = self.con.execute("SELECT %s FROM %s WHERE p.conta_id = ? ORDER BY p.id DESC LIMIT ?"
                                       % (COLUNAS_PEDIDO, DE_PEDIDOS), (cid, PEDIDOS_LISTA)).fetchall()
            pedidos = [self._loja_pedido(r, t) for r in pedidos]
        return 200, {'ok': True, 'saldo': saldo, 'limites': limites,
                     'classes': self._loja_classes(save['progress'] if save else None),
                     'pedidos': pedidos}

    # -- POST /api/loja/comprar ------------------------------------------------------------------
    def _loja_confere_item(self, cid, item, progress):
        """O que torna o produto inútil ou repetido — vale também para o Mestre
        (e para o presente dele: a classe a caminho, comprada OU presenteada, barra as duas)."""
        if item['tipo'] == 'classe':
            if item['alvo'] in liberadas(progress):
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
            # só o Sabedoria (fora da venda desde a loja 2; fica para o dono que o puser de volta): ele tem
            # carga a poupar. O bônus de XP por tempo NÃO é recusado com todos no nível 30 — no jogo ele
            # ainda rende a fatia do pet e o dízimo da guilda; o preço é o freio
            xps = [limita(h.get('xp'), 0, XP_MAX) for _, h in _herois(progress)]
            if xps and all(x >= XP_MAX for x in xps):
                raise Recusa(409, 'todos os heróis já estão no nível 30')

    def _loja_confere_limites(self, cid, item, t):
        if item['limite'] is not None:                  # sem janela (pedras, bônus, insígnias): o preço é o freio
            lim = self._loja_limites(cid, t)[item['limite']['grupo']]
            if lim['usados'] >= lim['max']:
                if lim['dias']:
                    raise Recusa(429, 'limite deste produto: %d a cada %d dias' % (lim['max'], lim['dias']),
                                 liberaEm=lim['liberaEm'])
                raise Recusa(429, 'limite deste produto: %d por conta' % lim['max'])
        abertos = self.con.execute(
            "SELECT COUNT(*) FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado') AND "
            + SEM_EXTRA, (cid,)).fetchone()[0]
        if abertos >= ABERTOS_MAX:
            raise Recusa(429, 'pedidos abertos demais (%d)' % ABERTOS_MAX)
        na_hora = [r[0] for r in self.con.execute(
            "SELECT criado_em FROM loja_pedidos WHERE conta_id = ? AND criado_em > ? "
            "AND estado IN ('pendente', 'retirado', 'entregue') AND " + SEM_EXTRA + " ORDER BY criado_em",
            (cid, t - 3600))]
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
        pode encher o disco. Presentes e créditos ficam fora: têm os tetos
        deles (por Mestre, mestre.py; por conta e por pagamento, pagamento.py)."""
        criados = [r[0] for r in self.con.execute(
            "SELECT criado_em FROM loja_pedidos WHERE conta_id = ? AND criado_em > ? AND " + SEM_EXTRA
            + " ORDER BY criado_em", (cid, t - 3600))]
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
            ja = self.con.execute("SELECT %s FROM %s WHERE p.conta_id = ? AND p.idem = ?" % (COLUNAS_PEDIDO, DE_PEDIDOS),
                                  (cid, idem)).fetchone()
            if ja is not None:                          # o mesmo clique chegando de novo
                if ja['sku'] != sku or origem_do_pedido(ja) is not None:
                    raise Recusa(409, 'idem já usado em outro produto')
                return 200, {'ok': True, 'pedido': self._loja_pedido(ja, t), 'saldo': self._loja_saldo(cid, conta, save)}
            # sem save o servidor não sabe da carteira; com um crédito a caminho
            # (pacote pago, presente de vinténs), sabe de pelo menos isso
            if save is None and not mestre and self._loja_a_caminho(cid) == 0:
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
            r = self._loja_pedido_por_id(cur.lastrowid)
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
            r = self.con.execute("SELECT %s FROM %s WHERE p.id = ? AND p.conta_id = ?" % (COLUNAS_PEDIDO, DE_PEDIDOS),
                                 (pid, cid)).fetchone()
            if r is None:                               # inclusive o de outra conta
                raise Recusa(404, 'pedido não encontrado')
            origem = origem_do_pedido(r)
            if origem == 'pagamento':
                raise Recusa(409, 'vinténs de pacote não se cancelam: eles chegam quando o jogo abrir')
            if origem == 'presente':
                raise Recusa(409, 'presente do Mestre: só o Mestre cancela')
            if r['estado'] in ('entregue', 'estornado', 'cancelado'):
                raise Recusa(409, 'pedido já fechado')
            if not self._loja_cancelavel(r, t):
                raise Recusa(409, 'já está a caminho do jogo; espere a entrega ou 24 h')
            self.con.execute("UPDATE loja_pedidos SET estado = 'cancelado', fechado_em = ? WHERE id = ?", (t, pid))
            self._evento(cid, 'loja-cancela', {'id': pid, 'sku': r['sku'], 'de': r['estado']})
            r = self._loja_pedido_por_id(pid)
            saldo = self._loja_saldo(cid, conta, self._loja_save(cid))
        return 200, {'ok': True, 'pedido': self._loja_pedido(r, t), 'saldo': saldo}

    # -- POST /api/loja/retirar (o jogo) -------------------------------------------------------------
    def loja_retirar(self, conta, corpo):
        """Os pedidos abertos, em ordem de id (o crédito, que nasce na aprovação,
        chega antes de qualquer compra feita com ele). `origem` só no presente e
        no crédito de pacote; `entrega.agora` (o relógio do SERVIDOR) só no bônus
        de XP: o prazo conta da entrega. Pedido retirado que volta numa retirada
        seguinte leva o `agora` novo (o jogo aplica uma vez só: anota o id).

        13/09 (docs/SEGURANCA.md §4.5): com a autoridade ligada, o servidor ENTREGA
        aqui mesmo (_loja_retirar_no_servidor) e o PUT não confirma mais nada."""
        if getattr(self, '_autoridade_ligada', lambda: False)():
            return self._loja_retirar_no_servidor(conta)
        cid, t = conta['id'], agora()
        with self._escrita():
            linhas = self.con.execute(
                "SELECT %s FROM %s WHERE p.conta_id = ? AND p.estado IN ('pendente', 'retirado') ORDER BY p.id"
                % (COLUNAS_PEDIDO, DE_PEDIDOS), (cid,)).fetchall()
            self.con.execute("UPDATE loja_pedidos SET estado = 'retirado', retirado_em = ? "
                             "WHERE conta_id = ? AND estado = 'pendente'", (t, cid))
        pedidos = []
        for r in linhas:
            entrega = _json(r['entrega']) or {}
            if entrega.get('tipo') == 'bonus-xp':
                entrega['agora'] = t
            p = {'id': r['id'], 'sku': r['sku'], 'nome': nome_do_pedido(r['sku'], entrega, r['credito_vintens']),
                 'preco': r['preco'], 'entrega': entrega}
            origem = origem_do_pedido(r)
            if origem is not None:
                p['origem'] = origem
            pedidos.append(p)
        return 200, {'ok': True, 'pedidos': pedidos}

    # -- a entrega no servidor (13/09, a autoridade) ------------------------------------------------------
    def _loja_estorna(self, cid, pid, motivo, versao, t):
        """Dentro de _escrita: o pedido aberto que o juiz recusou vira 'estornado' (a vaga e
        a reserva voltam); crédito de pacote pago é reemitido como antes (pagamento.py).
        Devolve (estornou?, id do crédito reemitido ou None)."""
        n = self.con.execute(
            "UPDATE loja_pedidos SET estado = 'estornado', motivo = ?, fechado_em = ?, versao_save = ? "
            "WHERE conta_id = ? AND id = ? AND estado IN ('pendente', 'retirado')", (motivo, t, versao, cid, pid)).rowcount
        if not n:
            return False, None
        self._evento(cid, 'loja-estorno', {'ids': [pid], 'versao': versao, 'motivo': motivo})
        reemite = getattr(self, '_pagamento_credito_recusado', None)
        return True, (reemite(cid, pid, motivo, versao, t) if reemite is not None else None)

    def _loja_retirar_no_servidor(self, conta):
        """Os pedidos abertos, em ordem de id, entregues pelo juiz (op interna
        'lojaEntregar', com a entrega e o preço CONGELADOS no banco — nada do
        cliente) no estado que o servidor guarda; 'entregue' na mesma transação
        que grava o estado. O que o juiz recusa vira 'estornado' com o motivo:
        a recusa de regra (422) sai do lote e o resto é pedido de novo; a
        recusa que volta como resultado ({ok:false, motivo}) fecha junto com as
        entregas. Sem estado no servidor ainda, nada sai: os pedidos esperam o
        primeiro save da conta."""
        cid = conta['id']
        estornados, reemitidos = [], []
        for _ in range(OPS_LOJA + 3):       # cada volta entrega, estorna uma recusada ou refaz um estado que mudou
            t = agora()
            with self.tranca:
                estado = self._estado_ler(cid)
                if estado is None:
                    return 200, {'ok': True, 'pedidos': [], 'entregues': [], 'estornados': estornados,
                                 'semEstado': True, 'versao': 0, 'hash': None, 'progress': None, 'db': None}
                linhas = self.con.execute(
                    "SELECT %s FROM %s WHERE p.conta_id = ? AND p.estado IN ('pendente', 'retirado') ORDER BY p.id LIMIT ?"
                    % (COLUNAS_PEDIDO, DE_PEDIDOS), (cid, OPS_LOJA)).fetchall()
            if not linhas:
                return 200, {'ok': True, 'pedidos': [], 'entregues': [], 'estornados': estornados,
                             'reemitidos': reemitidos, 'versao': estado['versao'], 'hash': estado['hash'],
                             'progress': estado['progress'], 'db': estado['db']}
            entregas = []
            for r in linhas:
                entrega = _json(r['entrega']) or {}
                if entrega.get('tipo') == 'bonus-xp':
                    entrega['agora'] = t                # o prazo do bônus conta da entrega, no relógio do servidor
                entregas.append(entrega)
            ops = [{'nome': 'lojaEntregar', 'args': {'pedido': {'id': r['id'], 'entrega': e, 'preco': r['preco']}}}
                   for r, e in zip(linhas, entregas)]
            try:
                saida = self._juiz_op(conta, estado, ops, interno=True)
            except Recusa as e:
                i = e.extra.get('indice')
                if e.status != 422 or not isinstance(i, int) or not 0 <= i < len(linhas):
                    raise
                motivo = e.extra.get('motivo')
                with self._escrita():
                    feito, novo = self._loja_estorna(cid, linhas[i]['id'], motivo if motivo in MOTIVOS else 'recusado',
                                                     estado['versao'], t)
                if feito:
                    estornados.append(linhas[i]['id'])
                    if novo is not None:
                        reemitidos.append(novo)
                continue
            aplicadas = set(le_anotacao(saida['db'])[0])
            entregues, recusados = [], []
            for r, e, res in zip(linhas, entregas, saida.get('resultados') or []):
                motivo = res.get('motivo') if isinstance(res, dict) else None
                if isinstance(res, dict) and res.get('ok') is True:
                    entregues.append((r, e))
                elif motivo == 'ja':                    # o estado já tinha aplicado (a anistia do corte)
                    if r['id'] in aplicadas:
                        entregues.append((r, e))
                    else:
                        recusados.append((r, 'recusado'))
                elif motivo in ('sem-jogo', 'recarregando'):
                    raise Recusa(503, 'o juiz não conseguiu entregar agora — tente de novo em instantes')
                else:
                    recusados.append((r, motivo if motivo in MOTIVOS else 'recusado'))
            if len(entregues) + len(recusados) != len(linhas):
                raise Recusa(503, 'o juiz respondeu torto na entrega — tente de novo em instantes')
            ids = [r['id'] for r in linhas]
            try:
                with self._escrita():
                    abertos = {x[0] for x in self.con.execute(
                        "SELECT id FROM loja_pedidos WHERE conta_id = ? AND estado IN ('pendente', 'retirado') AND id IN (%s)"
                        % ','.join('?' * len(ids)), [cid] + ids)}
                    if abertos != set(ids):             # um cancelamento (ou o estorno do pagamento) no meio
                        raise EstadoMudou()
                    nova, db = self._estado_grava(conta, estado, saida, t)
                    if entregues:
                        feitos = [r['id'] for r, _ in entregues]
                        self.con.execute(
                            "UPDATE loja_pedidos SET estado = 'entregue', retirado_em = COALESCE(retirado_em, ?), "
                            "fechado_em = ?, versao_save = ? WHERE conta_id = ? AND id IN (%s)"
                            % ','.join('?' * len(feitos)), [t, t, nova, cid] + feitos)
                        self._evento(cid, 'loja-entregue', {'ids': feitos, 'versao': nova, 'servidor': True})
                    for r, motivo in recusados:
                        feito, novo = self._loja_estorna(cid, r['id'], motivo, nova, t)
                        if feito:
                            estornados.append(r['id'])
                            if novo is not None:
                                reemitidos.append(novo)
            except EstadoMudou:
                continue
            pedidos = []
            for r, e in entregues:
                p = {'id': r['id'], 'sku': r['sku'], 'nome': nome_do_pedido(r['sku'], e, r['credito_vintens']),
                     'preco': r['preco'], 'entrega': e}
                origem = origem_do_pedido(r)
                if origem is not None:
                    p['origem'] = origem
                pedidos.append(p)
            log.info("loja: #%d — %d pedidos entregues no servidor, %d estornados", cid, len(pedidos), len(estornados))
            # `pedidos` são os JÁ ENTREGUES (aplicado=true): o cliente adota progress/db, não aplica de novo
            return 200, {'ok': True, 'aplicado': True, 'pedidos': pedidos, 'entregues': [p['id'] for p in pedidos],
                         'estornados': estornados, 'reemitidos': reemitidos, 'versao': nova, 'hash': saida['hash'],
                         'progress': saida['progress'], 'db': db}
        raise Recusa(409, 'o estado da conta mudou no meio — tente de novo')

    # -- os créditos de vinténs (pagamento.py e mestre.py chamam) ----------------------------------------
    def credita(self, cid, sku, vintens, origem, idem, mp_id, t):
        """Dentro da _escrita de quem chama: um crédito de `vintens` para a conta —
        o pedido de preço 0 (entrega {tipo:'vintens', alvo:'carteira', qtd}) e a
        linha em loja_creditos. Devolve o id do pedido."""
        cur = self.con.execute(
            "INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, idem, criado_em) "
            "VALUES (?, ?, ?, 0, 'pendente', ?, ?)",
            (cid, sku, json.dumps({'tipo': 'vintens', 'alvo': 'carteira', 'qtd': vintens}), idem, t))
        self.con.execute("INSERT INTO loja_creditos(pedido_id, vintens, origem, mp_id, criado_em) VALUES (?, ?, ?, ?, ?)",
                         (cur.lastrowid, vintens, origem, mp_id, t))
        return cur.lastrowid

    # -- dentro do salvar (PUT /api/save) -------------------------------------------------------------
    def _loja_confirma(self, cid, db, nova, t):
        """Chamada no trecho "só escrita" do salvar, na mesma transação do
        save: o que o save diz que aplicou vira 'entregue'; o que recusou,
        'estornado'. NUNCA recusa um save. Id de outra conta não casa com o
        filtro conta_id; pedido já fechado fica como está. Crédito de PACOTE
        recusado é reemitido (pagamento.py: até 3 vezes, depois vira alerta)."""
        aplicadas, recusadas = le_anotacao(db)
        entregues, estornados, reemitidos = [], [], []
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
                        tardio = getattr(self, '_pagamento_entregue_tardio', None)
                        if tardio is not None:
                            tardio(cid, r['id'], nova, t)
        aplicada = set(aplicadas)
        reemite = getattr(self, '_pagamento_credito_recusado', None)
        for pid, motivo in recusadas:
            if pid in aplicada:                         # nas duas listas: vale a entrega
                continue
            n = self.con.execute(
                "UPDATE loja_pedidos SET estado = 'estornado', motivo = ?, fechado_em = ?, versao_save = ? "
                "WHERE conta_id = ? AND id = ? AND estado IN ('pendente', 'retirado')",
                (motivo, t, nova, cid, pid)).rowcount
            if n:
                estornados.append(pid)
                if reemite is not None:
                    novo = reemite(cid, pid, motivo, nova, t)
                    if novo is not None:
                        reemitidos.append(novo)
        if estornados:
            self._evento(cid, 'loja-estorno', {'ids': estornados, 'versao': nova})
        saida = {'entregues': entregues, 'estornados': estornados}
        if reemitidos:                                  # só quando houve: o contrato antigo segue igual
            saida['reemitidos'] = reemitidos
        return saida
