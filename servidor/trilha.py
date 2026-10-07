# -*- coding: utf-8 -*-
"""A TRILHA DA TEMPORADA (07/10) — a trilha GRATUITA de recompensas por jogar (servidor/trilha.py).

O dono: "quero um jogo que o jogador tenha motivo para voltar" e "o jogador comum tem direito a crescer igual
quem paga". A trilha é o gancho de retorno mais comprovado do gênero, e aqui ela NÃO vende poder: é uma só,
grátis para todo mundo, presa às temporadas de 42 dias da Brasa (js/core/brasa.js B.EPOCA — a mesma época
em UTC). Uma trilha paga, se vier, é só aparência (docs/LOJA_SUGESTOES.md).

OS PONTOS são do SERVIDOR: nascem onde ele já confere o que aconteceu —
  sala vencida (solo ou em grupo)  +10   (+5 desafio cumprido, +5 no difícil, +5 com afixo)
  duelo ranqueado fechado          +15   (+10 para quem venceu)
  tentativa do Eco conferida       +20
  missão diária reivindicada        +5   (a op reivindicarMissao que o juiz aceitou)
Nada vem do cliente. A guerra de guilda fica de fora por ora (o fechamento dela tem quatro desfechos; entra
quando for medida).

OS DEGRAUS: 20, a cada 150 pontos (3.000 na temporada — quem desce três salas por dia chega perto do 9; quem
joga muito fecha em três semanas). Os prêmios são a economia de sempre, entregues pela MESMA fila da loja que
o Eco usa (loja_pedidos, preço 0, origem 'trilha'; `_loja_na_hora` aplica na hora): vinténs em todo degrau,
pedras do elemento da temporada nos pares, o Pergaminho da Sabedoria no 5 e no 15, uma Insígnia no 10 e a
Reescrita no 20. Nunca selo, título, estrela ou peça: o que se ganha de chefe continua só de chefe.

ROTAS: GET /api/trilha (a conta: pontos, degraus, resgatados) e POST /api/trilha/resgatar {degrau}.
"""
import calendar
import json
import logging

from comum import Recusa, agora

log = logging.getLogger('api')

TEMPORADA_S = 42 * 86400
EPOCA = calendar.timegm((2026, 8, 24, 0, 0, 0))     # js/core/brasa.js: B.EPOCA = Date.UTC(2026, 7, 24)
PASSO = 150                                          # pontos por degrau
DEGRAUS = 20
PONTOS = {'sala': 10, 'desafio': 5, 'dificil': 5, 'afixo': 5, 'duelo': 15, 'duelo-venceu': 10, 'eco': 20, 'missao': 5}
ELEMENTOS = ('fogo', 'agua', 'terra', 'ar')
PEDRA = {'fogo': 'stone-ember', 'agua': 'stone-tear', 'terra': 'stone-root', 'ar': 'stone-breath'}
SKU = 'trilha'

ESQUEMA_TRILHA = """
-- A TRILHA DA TEMPORADA (07/10, servidor/trilha.py): os pontos da conta na temporada e os degraus já
-- resgatados (lista JSON). Tabela nova, nunca ALTER
CREATE TABLE IF NOT EXISTS trilha(
  conta_id    INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  temporada   INTEGER NOT NULL,
  pontos      INTEGER NOT NULL DEFAULT 0,
  resgatados  TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (conta_id, temporada)
);
"""

ROTAS_TRILHA = {
    ('GET',  '/api/trilha'):          ('trilha_ler', True),
    ('POST', '/api/trilha/resgatar'): ('trilha_resgatar', True),
}


def temporada_de(t):
    """A temporada (1, 2, 3…) do instante t — a mesma conta de JOGO.Brasa.temporadaDe."""
    return 1 + max(0, (int(t) - EPOCA) // TEMPORADA_S)


def fim_da_temporada(n):
    return EPOCA + int(n) * TEMPORADA_S


def elemento_da_temporada(n):
    return ELEMENTOS[(int(n) - 1) % len(ELEMENTOS)]


def premios_do_degrau(n, temporada):
    """As entregas (no formato da fila da loja) do degrau n (1..DEGRAUS) na temporada."""
    pedra = PEDRA[elemento_da_temporada(temporada)]
    fora = []
    if n == DEGRAUS:
        fora.append({'tipo': 'vintens', 'alvo': 'carteira', 'qtd': 2000})
        fora.append({'tipo': 'pergaminho', 'alvo': 'elemento', 'qtd': 1})
        fora.append({'tipo': 'pedras', 'alvo': pedra, 'qtd': 20})
    elif n % 5 == 0:
        fora.append({'tipo': 'vintens', 'alvo': 'carteira', 'qtd': 400 if n == 5 else (800 if n == 10 else 1200)})
        if n == 10:
            fora.append({'tipo': 'insignias', 'alvo': 'fundacao', 'qtd': 1})
        else:
            fora.append({'tipo': 'pergaminho', 'alvo': 'xp', 'qtd': 1})
        fora.append({'tipo': 'pedras', 'alvo': pedra, 'qtd': 10})
    else:
        fora.append({'tipo': 'vintens', 'alvo': 'carteira', 'qtd': 100 + 25 * n})
        if n % 2 == 0:
            fora.append({'tipo': 'pedras', 'alvo': pedra, 'qtd': 5})
    return fora


def pontos_de(motivo, extra=None):
    """Quantos pontos um acontecimento vale."""
    extra = extra or {}
    n = PONTOS.get(motivo, 0)
    if motivo == 'sala':
        if extra.get('desafio'):
            n += PONTOS['desafio']
        if extra.get('dificil'):
            n += PONTOS['dificil']
        if extra.get('afixo'):
            n += PONTOS['afixo']
    elif motivo == 'duelo' and extra.get('venceu'):
        n += PONTOS['duelo-venceu']
    return n


def soma_trilha(con, cid, t, motivo, extra=None):
    """Dentro da tranca de quem chama: soma os pontos do acontecimento na temporada de agora. Devolve
    {temporada, pontos, ganhou} (ou None sem pontos)."""
    ganhou = pontos_de(motivo, extra)
    if ganhou <= 0:
        return None
    temporada = temporada_de(t)
    con.execute("INSERT INTO trilha(conta_id, temporada, pontos) VALUES (?, ?, ?) "
                "ON CONFLICT(conta_id, temporada) DO UPDATE SET pontos = pontos + excluded.pontos",
                (cid, temporada, ganhou))
    r = con.execute("SELECT pontos FROM trilha WHERE conta_id = ? AND temporada = ?", (cid, temporada)).fetchone()
    return {'temporada': temporada, 'pontos': r['pontos'], 'ganhou': ganhou, 'motivo': motivo}


def trilha_de(con, cid, t):
    """A trilha da conta na temporada de agora, inteira, para a tela."""
    temporada = temporada_de(t)
    r = con.execute("SELECT pontos, resgatados FROM trilha WHERE conta_id = ? AND temporada = ?",
                    (cid, temporada)).fetchone()
    pontos = r['pontos'] if r is not None else 0
    try:
        resgatados = set(int(x) for x in json.loads(r['resgatados'])) if r is not None else set()
    except (TypeError, ValueError):
        resgatados = set()
    degraus = []
    for n in range(1, DEGRAUS + 1):
        degraus.append({'n': n, 'pontos': n * PASSO, 'premios': premios_do_degrau(n, temporada),
                        'resgatado': n in resgatados, 'alcancado': pontos >= n * PASSO})
    return {'temporada': temporada, 'pontos': pontos, 'passo': PASSO, 'degraus': degraus,
            'elemento': elemento_da_temporada(temporada), 'fim': fim_da_temporada(temporada) * 1000,
            'valores': dict(PONTOS)}


class TrilhaMixin:
    """As rotas /api/trilha/* (ver ROTAS_TRILHA). A soma dos pontos mora nos lugares que conferem o
    acontecimento (salas.py, grupo.py, supremo.py); aqui só a leitura e o resgate."""

    def trilha_ler(self, conta, corpo):
        with self.tranca:
            return 200, dict(trilha_de(self.con, conta['id'], agora()), ok=True)

    def trilha_resgatar(self, conta, corpo):
        n = corpo.get('degrau')
        if isinstance(n, bool) or not isinstance(n, int) or not 1 <= n <= DEGRAUS:
            raise Recusa(400, 'degrau precisa ser um inteiro de 1 a %d' % DEGRAUS)
        cid, t = conta['id'], agora()
        temporada = temporada_de(t)
        with self._escrita():
            r = self.con.execute("SELECT pontos, resgatados FROM trilha WHERE conta_id = ? AND temporada = ?",
                                 (cid, temporada)).fetchone()
            pontos = r['pontos'] if r is not None else 0
            try:
                resgatados = [int(x) for x in json.loads(r['resgatados'])] if r is not None else []
            except (TypeError, ValueError):
                resgatados = []
            if pontos < n * PASSO:
                raise Recusa(409, 'faltam pontos: o degrau %d pede %d e você tem %d' % (n, n * PASSO, pontos),
                             motivo='faltam-pontos')
            if n in resgatados:
                raise Recusa(409, 'esse degrau já foi resgatado', motivo='ja-resgatado')
            resgatados.append(n)
            self.con.execute("INSERT INTO trilha(conta_id, temporada, pontos, resgatados) VALUES (?, ?, ?, ?) "
                             "ON CONFLICT(conta_id, temporada) DO UPDATE SET resgatados = excluded.resgatados",
                             (cid, temporada, pontos, json.dumps(resgatados)))
            pedidos = []
            for k, entrega in enumerate(premios_do_degrau(n, temporada)):
                idem = 'trilha-%d-%d-%d' % (temporada, n, k)
                ja = self.con.execute("SELECT id FROM loja_pedidos WHERE conta_id = ? AND idem = ?", (cid, idem)).fetchone()
                if ja is not None:
                    pedidos.append(ja['id'])
                    continue
                cur = self.con.execute("INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, idem, criado_em) "
                                       "VALUES (?, ?, ?, 0, 'pendente', ?, ?)",
                                       (cid, SKU, json.dumps(dict(entrega, origem='trilha')), idem, t))
                pedidos.append(cur.lastrowid)
            self._evento(cid, 'trilha-resgate', {'temporada': temporada, 'degrau': n, 'pedidos': pedidos})
        # a entrega NA HORA pelo mesmo caminho da loja (fora da tranca; sem juiz, fica na fila e o jogo busca)
        entregue = self._loja_na_hora(conta) if hasattr(self, '_loja_na_hora') else None
        with self.tranca:
            trilha = trilha_de(self.con, cid, t)
        log.info("trilha: #%d resgatou o degrau %d da temporada %d", cid, n, temporada)
        return 200, dict(trilha, ok=True, degrau=n, pedidos=pedidos,
                         entregue=(entregue if isinstance(entregue, dict) and not entregue.get('falhou') else None))
