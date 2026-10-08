#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O ECO PRIMORDIAL — a tentativa contra o chefe supremo e o ranking semanal de dano (02/10).

O pedido do dono, na lista de antes de divulgar o jogo: "um mapa BEM difícil com chefe supremo e
placar de quem tirou mais dano". O chefe e as regras dele moram em js/core/data/eco.js e no motor
(engine.js, "O ECO PRIMORDIAL"); a arena é a Câmara do Eco (js/core/data/arenas.js). Aqui mora o que
é do SERVIDOR: a tentativa, o placar conferido e a semana.

Entra no cartório como mixin (`class Api(..., SupremoMixin)` no api.py), com a mesma conexão e a
mesma tranca. Importa só de comum.py e de salas.py (as réguas de tempo e o formato do bilhete).

AS ROTAS:
  GET  /api/supremo           público — a semana (início, fim, agora), o ranking (os 20 primeiros),
                              as faixas de prêmio; com token, a parte da conta (tentativas de hoje,
                              o melhor da semana e a posição)
  GET  /api/supremo/ranking   público — o ranking de uma semana (?semana=N; sem, a de agora), 100 linhas
  POST /api/supremo/abrir     {herois, versaoRegras} → {tentativa, semente, restantes}: a SEMENTE é do
                              servidor, como a do bilhete da sala (salas.py) — e só decide a colocação e
                              a rodada 1
  POST /api/supremo/sal       {tentativa, rodada, caminho} → {rodada, sal}: o sorteio da rodada 2 a 12,
                              dado só contra o CAMINHO (o hash dos lances até a virada) e TRAVADO nele
  POST /api/supremo/fechar    {tentativa, lances, hashFinal} → o juiz refaz a tentativa
                              (servidor/juiz/supremo.js) e o placar é o DANO DO REPLAY — o número que o
                              navegador mostrou não entra em conta nenhuma; replay que diverge não pontua

O SAL DE CADA RODADA (03/10, o dono: "dificulte"). Até aqui a semente inteira saía no abrir e valia 2 h: um
programa refazia a Câmara fora do jogo, procurava a sequência que tirava mais dano e mandava só ela. Agora a
rodada R (2 a 12) só começa com o sal dela (engine.js, "O SORTEIO RODADA A RODADA"), e o sal sai daqui:
  - o jogo manda o caminho (SHA-256 dos lances até a virada: Engine.ecoCaminho) e recebe
    sal = HMAC(chave da tentativa, "R:caminho") — a chave é HMAC(segredo do servidor, "eco-sal:" + tentativa)
    e nunca sai daqui, a não ser para o juiz;
  - UM caminho por rodada por tentativa (supremo_sais, chave (tentativa, rodada)): o mesmo caminho de novo
    devolve o mesmo sal (a rede caiu no meio da resposta); outro caminho é 409 'caminho-preso' — saber a sorte
    de dois futuros é exatamente o ensaio; e só a rodada seguinte à última travada (409 'rodada-fora');
  - o juiz recalcula o caminho de cada lance de sal e o sal com a chave: outro caminho jogado com o sal de um,
    sal inventado ou rodada pulada derrubam a tentativa (422, 'recusada').
Ensaiar continua possível só DENTRO da rodada de agora, com a sorte dela na mão — que é o que jogar já é.

AS RÉGUAS:
  - TENTATIVAS_POR_DIA por conta, no dia de BRASÍLIA (o mesmo das missões). Abrir conta como usada:
    a tentativa largada no meio (a aba fechada) não volta. Abrir outra com uma aberta vence a de antes.
    A única que devolve a vez é a vencida por 'regras-mudaram' (o deploy no meio dela: USADAS_HOJE).
  - a SEMANA vai de segunda 00:00 a domingo 23:59:59 de Brasília (UTC−3, sem horário de verão desde
    2019). A tentativa é da semana em que ABRIU.
  - o RANKING é por conta: a melhor tentativa conferida da semana (pontos = dano + o bônus de quem
    derruba); empate fica com quem chegou primeiro. A equipe (contas.gm) e quem está banido não entram
    — jogam, mas não disputam. O herói da classe do Mestre não abre tentativa.
  - o FECHAMENTO DA SEMANA acontece sozinho, preguiçoso: a primeira rota do Eco (ou o retirar da loja,
    que o jogo chama a cada 5 min) depois de domingo 23:59 + FOLGA_FECHO fecha as semanas que faltam.
    A folga é a validade da tentativa: quem abriu no domingo às 23:50 ainda fecha a dela e entra.
  - os PRÊMIOS saem pela FILA DE ENTREGAS da loja (loja.py) — o mesmo caminho do presente do Mestre:
    um pedido de preço 0 com os vinténs e outro com os selos e o título, entregues pelo juiz no estado
    da conta (op 'lojaEntregar'). UMA VEZ SÓ: a linha de supremo_semanas é a porta (o fechamento todo
    numa transação), supremo_premios tem chave (semana, conta) e o pedido tem `idem` único por conta.
    Nada é comprável: nem tentativa a mais, nem prêmio, nem título.
"""
import calendar
import hashlib
import hmac
import json
import logging
import re
import secrets
import time

from comum import Recusa, agora, classe_do_heroi


def _classe_entra(hid, ficha):
    """08/10 à noite: a ficha entra na Câmara se tem uma classe do jogo — inclusive a do Mestre do Fundo
    ('gm'), que antes ficava de fora. O ranking segue sem a equipe (contas.gm) por outra régua."""
    if classe_do_heroi(hid, ficha) is not None:
        return True
    c = ficha.get('classId') if isinstance(ficha, dict) else None
    if not isinstance(c, str) or not c:
        c = hid.split('#', 1)[0] if isinstance(hid, str) else ''
    return c == 'gm'
import moderacao
from salas import LANCES_MAX, RE_BILHETE, SALA_MIN_S, SALA_S_POR_TURNO, _inteiro_puro
from trilha import soma_trilha    # 07/10: a tentativa conferida dá pontos na trilha da temporada

log = logging.getLogger('api')

TENTATIVAS_POR_DIA = 3            # o espelho mora em js/core/data/eco.js (DATA.eco.tentativasPorDia)
RODADAS = 12                      # o espelho mora em js/core/data/eco.js (DATA.eco.rodadas): o sal vai da 2 a esta
# A VALIDADE (revista em 03/10, com o sal por rodada). Antes as 2 h eram também a janela do ensaio: a semente
# inteira na mão, 2 h para buscar fora do jogo. Com o sal por rodada não há o que buscar além da rodada de agora,
# e encurtar o prazo não fecharia nada — só puniria quem pausa, joga no celular devagar ou fica sem rede no meio
# (sem o sal a tentativa ESPERA). As 2 h ficam como conforto: 12 rodadas jogadas sem pressa cabem com folga.
VALIDADE_S = 2 * 3600
FOLGA_FECHO = VALIDADE_S          # a semana fecha 2 h depois do domingo 23:59:59
RE_CAMINHO = re.compile(r'^[0-9a-f]{64}$')    # o SHA-256 dos lances (Engine.ecoCaminho), em hexadecimal minúsculo
SAL_MAX = 0x7fffffff              # o sal tem 31 bits, como a semente (Engine.SAL_MAX)
FUSO_S = -3 * 3600                # Brasília
SEMANA_S = 7 * 86400
EPOCA = calendar.timegm((2026, 1, 5, 0, 0, 0))   # uma SEGUNDA-feira, 00:00 no relógio de Brasília
RANKING_JOGO = 20                 # as linhas que a ficha do jogo mostra
RANKING_SITE = 100                # e as que o site mostra
TITULO_ECO = 'Voz do Eco'         # o espelho mora em js/core/titulos.js (T.ECO); tests/supremo_api.py confere
ELEMENTOS_SELO = ('fogo', 'agua', 'terra', 'ar')
# AS FAIXAS DE PRÊMIO (o dono troca aqui). A régua de vinténs de loja.py: a semana típica rende ~1.316
# vinténs. 06/10 (o dono: "muito alto o primeiro, 5k de vinténs; isso desequilibra o jogo"): o pódio levava
# quase quatro semanas disso (5.000 / 2.500 / 1.000 / 150); passa a levar pouco mais de UMA, e as outras
# faixas caem na mesma proporção. Os selos são os de chefe (a roleta do Colecionador
# gira com 10 de qualquer elemento) — o Eco é chefe, e o selo dele é coerente com o que os chefes dão.
# `ate` None = todo o resto que pontuou (a participação: pelo menos 1 de dano numa tentativa conferida).
FAIXAS = (
    {'id': 'podio', 'de': 1, 'ate': 3, 'nome': '1º ao 3º', 'vintens': 1500, 'selos': 20, 'titulo': TITULO_ECO},
    {'id': 'elite', 'de': 4, 'ate': 10, 'nome': '4º ao 10º', 'vintens': 750, 'selos': 10, 'titulo': None},
    {'id': 'cem', 'de': 11, 'ate': 100, 'nome': '11º ao 100º', 'vintens': 300, 'selos': 4, 'titulo': None},
    {'id': 'participacao', 'de': 101, 'ate': None, 'nome': 'participação', 'vintens': 50, 'selos': 0, 'titulo': None},
)
SKU_VINTENS = 'eco-vintens'       # loja.py reconhece o prefixo 'eco-' (a origem 'eco' e o nome do pedido)
SKU_PREMIO = 'eco-premio'

ESQUEMA_SUPREMO = """
-- O ECO PRIMORDIAL (02/10, supremo.py). Tabelas NOVAS, nunca ALTER: no rolling update do Coolify o
-- contêiner velho e o novo sobem juntos no mesmo banco
CREATE TABLE IF NOT EXISTS supremo_tentativas(
  id          TEXT PRIMARY KEY,
  conta_id    INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  semana      INTEGER NOT NULL,
  dia         INTEGER NOT NULL,
  semente     INTEGER NOT NULL,
  herois      TEXT NOT NULL,
  regras      INTEGER,
  aberta_ms   INTEGER NOT NULL,
  fechada_em  INTEGER,
  estado      TEXT NOT NULL DEFAULT 'aberta'
    CHECK (estado IN ('aberta', 'conferida', 'recusada', 'vencida')),
  dano        INTEGER,
  pontos      INTEGER,
  derrubou    INTEGER,
  rodada      INTEGER,
  turnos      INTEGER,
  motivo      TEXT
);
CREATE INDEX IF NOT EXISTS supremo_tentativas_conta ON supremo_tentativas(conta_id, dia);
CREATE INDEX IF NOT EXISTS supremo_tentativas_semana ON supremo_tentativas(semana, estado, pontos);
-- 03/10 (revisão): o estado da conta NA ABERTURA da tentativa. O juiz refaz o grupo com ele, e não com o de
-- quando o fechar chega: uma peça equipada na praça entre o fim e o fechar refeito (sem rede) mudava o grupo e a
-- tentativa legítima caía como 'divergiu'. Sai quando a tentativa fecha; a que vence sai no próximo abrir
CREATE TABLE IF NOT EXISTS supremo_estados(
  tentativa  TEXT PRIMARY KEY REFERENCES supremo_tentativas(id) ON DELETE CASCADE,
  progress   TEXT NOT NULL,
  db         TEXT
);
-- 03/10: o SAL de cada rodada, travado no caminho (o hash dos lances até a virada) — UMA linha por rodada por
-- tentativa: a chave primária é a trava. O juiz recebe estas linhas no fechar e confere cada lance de sal
CREATE TABLE IF NOT EXISTS supremo_sais(
  tentativa  TEXT NOT NULL REFERENCES supremo_tentativas(id) ON DELETE CASCADE,
  rodada     INTEGER NOT NULL,
  caminho    TEXT NOT NULL,
  sal        INTEGER NOT NULL,
  pedido_ms  INTEGER NOT NULL,
  PRIMARY KEY (tentativa, rodada)
);
-- a semana fechada: a PORTA dos prêmios (uma linha por semana, gravada na mesma transação que eles)
CREATE TABLE IF NOT EXISTS supremo_semanas(
  semana     INTEGER PRIMARY KEY,
  fechada_em INTEGER NOT NULL,
  contas     INTEGER NOT NULL
);
-- 07/10: A TENTATIVA EM DUPLA ("descida em grupo com tudo que o solo tem"). A Câmara do Eco abre pela sala do grupo
-- (grupo.py, POST /api/grupo/abrir no dungeonId da arena): o gid liga DUAS tentativas, uma por conta, com a MESMA
-- semente (a da sala do grupo); o sal é pedido com a tentativa de quem lidera (a que vai na ata) por qualquer
-- dos dois; o fechar vem pelo /api/grupo/fechar com o registro do lockstep, o juiz refaz a Câmara como a sala em
-- grupo e o placar é UM para as duas contas (as duas entram no ranking, cada uma gasta a vez do dia)
CREATE TABLE IF NOT EXISTS supremo_grupos(
  gid            TEXT PRIMARY KEY,
  tentativa      TEXT NOT NULL REFERENCES supremo_tentativas(id) ON DELETE CASCADE,
  tentativa_par  TEXT NOT NULL REFERENCES supremo_tentativas(id) ON DELETE CASCADE,
  lider_id       INTEGER NOT NULL,
  membro_id      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS supremo_grupos_tentativa ON supremo_grupos(tentativa);
CREATE TABLE IF NOT EXISTS supremo_premios(
  semana     INTEGER NOT NULL,
  conta_id   INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  posicao    INTEGER NOT NULL,
  faixa      TEXT NOT NULL,
  pontos     INTEGER NOT NULL,
  vintens    INTEGER NOT NULL,
  selos      TEXT NOT NULL,
  titulo     TEXT,
  pedidos    TEXT NOT NULL,
  criado_em  INTEGER NOT NULL,
  PRIMARY KEY (semana, conta_id)
);
"""


# ---- o relógio de Brasília ------------------------------------------------------------------
def semana_de(t):
    """O número da semana (segunda a domingo, Brasília) do instante t (epoch em segundos)."""
    return (int(t) + FUSO_S - EPOCA) // SEMANA_S


def inicio_da_semana(semana):
    """O instante (epoch) da segunda 00:00 de Brasília que abre a semana."""
    return EPOCA + int(semana) * SEMANA_S - FUSO_S


def dia_de(t):
    """O dia de Brasília (o mesmo das missões e do Calabouço do Dia)."""
    return (int(t) + FUSO_S) // 86400


def semana_publica(semana):
    ini = inicio_da_semana(semana)
    return {'id': semana, 'inicio': ini, 'fim': ini + SEMANA_S - 1}


def faixa_de(posicao):
    for f in FAIXAS:
        if posicao >= f['de'] and (f['ate'] is None or posicao <= f['ate']):
            return f
    return None


def selos_da_faixa(n):
    """Os `n` selos repartidos pelos quatro elementos, na ordem fogo → água → terra → ar (a das fases)."""
    base, resto = divmod(max(0, int(n)), len(ELEMENTOS_SELO))
    fora = {}
    for i, el in enumerate(ELEMENTOS_SELO):
        q = base + (1 if i < resto else 0)
        if q:
            fora[el] = q
    return fora


def faixas_publicas():
    return [{'id': f['id'], 'de': f['de'], 'ate': f['ate'], 'nome': f['nome'], 'vintens': f['vintens'],
             'selos': f['selos'], 'titulo': f['titulo']} for f in FAIXAS]


# ---- o sal de cada rodada (03/10) -----------------------------------------------------------
def chave_da_tentativa(segredo, tid):
    """A chave do sorteio de UMA tentativa: HMAC(segredo do servidor, 'eco-sal:' + id). Derivada, não guardada:
    os dois contêineres do rolling update leem o mesmo segredo (/dados/segredo) e chegam à mesma. O juiz recebe
    esta (que só vale para esta tentativa), nunca o segredo."""
    s = segredo if isinstance(segredo, bytes) else str(segredo).encode('utf-8')
    return hmac.new(s, ('eco-sal:' + tid).encode('utf-8'), hashlib.sha256).digest()


def sal_da_rodada(chave, rodada, caminho):
    """O sal da rodada: HMAC-SHA-256(chave, 'R:caminho'), os 31 bits de cima do começo — a MESMA conta do juiz
    (servidor/juiz/supremo.js, salDe; tests/supremo_api.py, test_14, confere as duas)."""
    h = hmac.new(chave, ('%d:%s' % (rodada, caminho)).encode('utf-8'), hashlib.sha256).hexdigest()
    return int(h[:8], 16) & SAL_MAX


# a conta banida AGORA (03/10, revisão): o 0/1 de contas.banido só volta a 0 no próximo pedido da própria conta
# (moderacao._ban_atual), então o banimento com prazo que já venceu ainda tirava a conta do ranking — e no
# fechamento ela perdia o prêmio para sempre. A mesma regra do moderacao.banimento_lido: banida = o 0/1 em 1 E
# (uma linha aberta em vigor OU nenhuma linha aberta — o banimento de antes da tabela, e a lápide). O `?` é o agora.
BANIDA_AGORA = (
    "(c.banido = 1 AND (NOT EXISTS (SELECT 1 FROM moderacao_banimentos b WHERE b.conta_id = c.id "
    "AND b.encerrado_em IS NULL) OR EXISTS (SELECT 1 FROM moderacao_banimentos b WHERE b.conta_id = c.id "
    "AND b.encerrado_em IS NULL AND (b.fim IS NULL OR b.fim > ?))))")

# o melhor de cada conta numa semana: pontos, depois quem chegou primeiro, depois o id (determinístico).
# Parâmetros: (semana, agora)
MELHORES = """
SELECT conta_id, pontos, dano, derrubou, rodada, fechada_em, nome FROM (
  SELECT t.conta_id, t.pontos, t.dano, t.derrubou, t.rodada, t.fechada_em,
         COALESCE(r.nome, c.nome) AS nome,
         ROW_NUMBER() OVER (PARTITION BY t.conta_id ORDER BY t.pontos DESC, t.fechada_em ASC, t.id) AS ordem
  FROM supremo_tentativas t JOIN contas c ON c.id = t.conta_id LEFT JOIN resumos r ON r.conta_id = t.conta_id
  WHERE t.semana = ? AND t.estado = 'conferida' AND NOT """ + BANIDA_AGORA + """ AND c.gm = 0
) WHERE ordem = 1
ORDER BY pontos DESC, fechada_em ASC, conta_id ASC
"""


# as tentativas que GASTAM a vez do dia: toda aberta conta, menos a que venceu porque o deploy trocou as regras no
# meio dela ('regras-mudaram') — essa não é culpa do jogador, e o 410 dela promete que a vez volta (03/10, a
# revisão pegou a promessa sem a conta: a tentativa sumia do dia do mesmo jeito)
USADAS_HOJE = ("SELECT COUNT(*) FROM supremo_tentativas WHERE conta_id = ? AND dia = ? "
               "AND NOT (estado = 'vencida' AND motivo IS 'regras-mudaram')")


def _linha_publica(r, pos):
    return {'posicao': pos, 'nome': r['nome'] or '—', 'pontos': r['pontos'] or 0, 'dano': r['dano'] or 0,
            'derrubou': bool(r['derrubou']), 'rodada': r['rodada']}


class SupremoMixin:

    # -- o fechamento da semana ---------------------------------------------------------------
    def _supremo_ranking(self, semana, limite=None, t=None):
        """Dentro da tranca: as linhas do ranking da semana, em ordem (sem limite = todas). `t`: o agora
        em que se lê o prazo dos banimentos."""
        sql = MELHORES + (" LIMIT %d" % int(limite) if limite else "")
        return self.con.execute(sql, (semana, agora() if t is None else t)).fetchall()

    def _supremo_fecha_vencidas(self, t=None):
        """Fecha toda semana que já acabou (mais a folga) e ainda não tem linha em supremo_semanas. Barato
        quando não há nada: uma consulta. Nunca derruba quem chamou — o fechamento tenta de novo na próxima."""
        t = agora() if t is None else t
        ultima_fechavel = semana_de(t - FOLGA_FECHO) - 1   # a semana W fecha quando t ≥ fim(W) + folga
        try:
            with self.tranca:
                pendentes = [r[0] for r in self.con.execute(
                    "SELECT DISTINCT semana FROM supremo_tentativas WHERE semana <= ? "
                    "AND semana NOT IN (SELECT semana FROM supremo_semanas) ORDER BY semana", (ultima_fechavel,))]
        except Exception:
            log.exception("supremo: não consegui listar as semanas a fechar")
            return
        for w in pendentes:
            try:
                self._supremo_fecha_semana(w, t)
            except Exception:
                log.exception("supremo: o fechamento da semana %d falhou (tenta de novo no próximo pedido)", w)

    def _supremo_fecha_semana(self, semana, t):
        """Numa transação: a semana fecha, as tentativas abertas dela vencem e cada conta do ranking recebe o
        prêmio da faixa pela fila da loja. A linha de supremo_semanas é a porta — duas chamadas juntas, só uma
        passa; e o prêmio tem chave (semana, conta) e idem único por conta, então não sai duas vezes."""
        with self._escrita():
            if self.con.execute("SELECT 1 FROM supremo_semanas WHERE semana = ?", (semana,)).fetchone():
                return 0
            self.con.execute("UPDATE supremo_tentativas SET estado = 'vencida', fechada_em = ?, motivo = 'semana-fechou' "
                             "WHERE semana = ? AND estado = 'aberta'", (t, semana))
            lista = self._supremo_ranking(semana, t=t)
            dados = 0
            for pos, r in enumerate(lista, 1):
                f = faixa_de(pos)
                if f is None or not (r['pontos'] or 0) > 0:
                    continue
                cid, pedidos = r['conta_id'], []
                if f['vintens'] > 0:
                    pedidos.append(self._supremo_pedido(cid, SKU_VINTENS, {'tipo': 'vintens', 'alvo': 'carteira',
                                                                            'qtd': f['vintens']},
                                                        'eco-%d-v' % semana, t))
                selos = selos_da_faixa(f['selos'])
                if selos or f['titulo']:
                    pedidos.append(self._supremo_pedido(cid, SKU_PREMIO, {
                        'tipo': 'premio-eco', 'alvo': 'eco', 'qtd': 1, 'semana': semana, 'posicao': pos,
                        'selos': selos, 'titulo': f['titulo']}, 'eco-%d-p' % semana, t))
                self.con.execute(
                    "INSERT INTO supremo_premios(semana, conta_id, posicao, faixa, pontos, vintens, selos, titulo, "
                    "pedidos, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (semana, cid, pos, f['id'], r['pontos'], f['vintens'], json.dumps(selos), f['titulo'],
                     json.dumps(pedidos), t))
                self._evento(cid, 'supremo-premio', {'semana': semana, 'posicao': pos, 'faixa': f['id'],
                                                     'pontos': r['pontos'], 'pedidos': pedidos})
                dados += 1
            self.con.execute("INSERT INTO supremo_semanas(semana, fechada_em, contas) VALUES (?, ?, ?)",
                             (semana, t, len(lista)))
        log.info("supremo: a semana %d fechou — %d contas no ranking, %d premiadas", semana, len(lista), dados)
        return dados

    def _supremo_pedido(self, cid, sku, entrega, idem, t):
        """Dentro da _escrita: um pedido de preço 0 na fila de entregas da loja (loja.py). O `idem` é único por
        conta: o mesmo prêmio não nasce duas vezes nem se o fechamento for chamado de novo."""
        ja = self.con.execute("SELECT id FROM loja_pedidos WHERE conta_id = ? AND idem = ?", (cid, idem)).fetchone()
        if ja is not None:
            return ja['id']
        cur = self.con.execute("INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, idem, criado_em) "
                               "VALUES (?, ?, ?, 0, 'pendente', ?, ?)", (cid, sku, json.dumps(entrega), idem, t))
        return cur.lastrowid

    # -- a parte de uma conta -------------------------------------------------------------------
    def _supremo_minha(self, cid, t):
        """Dentro da tranca: as tentativas de hoje, o melhor da semana e a posição."""
        semana, dia = semana_de(t), dia_de(t)
        usadas = self.con.execute(USADAS_HOJE, (cid, dia)).fetchone()[0]
        melhor = self.con.execute(
            "SELECT pontos, dano, derrubou, fechada_em, id FROM supremo_tentativas WHERE conta_id = ? AND semana = ? "
            "AND estado = 'conferida' ORDER BY pontos DESC, fechada_em ASC, id LIMIT 1", (cid, semana)).fetchone()
        conta = self.con.execute("SELECT gm, banido FROM contas WHERE id = ?", (cid,)).fetchone()
        fora = bool(conta and (conta['gm'] or moderacao.banimento_lido(self.con, cid, conta['banido'], t) is not None))
        posicao = None
        if melhor is not None and not fora:
            posicao = 1 + self.con.execute(
                "SELECT COUNT(*) FROM (" + MELHORES + ") WHERE pontos > ? OR (pontos = ? AND "
                "(fechada_em < ? OR (fechada_em = ? AND conta_id < ?)))",
                (semana, t, melhor['pontos'], melhor['pontos'], melhor['fechada_em'], melhor['fechada_em'], cid)).fetchone()[0]
        premios = [{'semana': r['semana'], 'posicao': r['posicao'], 'faixa': r['faixa'], 'pontos': r['pontos'],
                    'vintens': r['vintens'], 'selos': json.loads(r['selos'] or '{}'), 'titulo': r['titulo']}
                   for r in self.con.execute("SELECT * FROM supremo_premios WHERE conta_id = ? "
                                             "ORDER BY semana DESC LIMIT 5", (cid,))]
        return {'tentativasHoje': usadas, 'restantes': max(0, TENTATIVAS_POR_DIA - usadas),
                'melhor': ({'pontos': melhor['pontos'], 'dano': melhor['dano'], 'derrubou': bool(melhor['derrubou'])}
                           if melhor is not None else None),
                'posicao': posicao,
                # a equipe joga mas não disputa: a ficha diz isso em vez de mostrar uma posição que não existe
                'foraDoRanking': fora,
                'premios': premios,
                'amanhaEm': (dia + 1) * 86400 - FUSO_S}

    # -- GET /api/supremo -----------------------------------------------------------------------
    def supremo_ler(self, conta, corpo):
        t = agora()
        self._supremo_fecha_vencidas(t)
        token = corpo.get('_token')
        eu = self.conta_do_token(token) if token else None
        semana = semana_de(t)
        with self.tranca:
            linhas = self._supremo_ranking(semana, RANKING_JOGO)
            minha = self._supremo_minha(eu['id'], t) if eu is not None else None
        return 200, {'ok': True, 'agora': t, 'semana': semana_publica(semana),
                     'tentativasPorDia': TENTATIVAS_POR_DIA, 'faixas': faixas_publicas(),
                     'ranking': [_linha_publica(r, i) for i, r in enumerate(linhas, 1)],
                     'eu': minha}

    # -- GET /api/supremo/ranking ---------------------------------------------------------------
    def supremo_ranking(self, conta, corpo):
        t = agora()
        self._supremo_fecha_vencidas(t)
        q = (corpo.get('_query') or {}).get('semana')
        atual = semana_de(t)
        if q in (None, ''):
            semana = atual
        else:
            try:
                semana = int(q)
            except (TypeError, ValueError):
                raise Recusa(400, 'semana precisa ser um número')
            if not -10000 < semana <= atual:
                raise Recusa(400, 'essa semana não existe ainda')
        with self.tranca:
            linhas = self._supremo_ranking(semana, RANKING_SITE)
            fechada = self.con.execute("SELECT fechada_em FROM supremo_semanas WHERE semana = ?", (semana,)).fetchone()
            semanas = [r[0] for r in self.con.execute(
                "SELECT semana FROM supremo_semanas ORDER BY semana DESC LIMIT 12")]
        return 200, {'ok': True, 'agora': t, 'semana': semana_publica(semana), 'atual': atual,
                     'fechada': fechada is not None, 'semanasFechadas': semanas, 'faixas': faixas_publicas(),
                     'ranking': [_linha_publica(r, i) for i, r in enumerate(linhas, 1)]}

    # -- POST /api/supremo/abrir ----------------------------------------------------------------
    def supremo_abrir(self, conta, corpo):
        cid = conta['id']
        herois = corpo.get('herois')
        if (not isinstance(herois, list) or not 1 <= len(herois) <= 2
                or any(not isinstance(h, str) or not 0 < len(h) <= 64 for h in herois) or len(set(herois)) != len(herois)):
            raise Recusa(400, 'herois precisa ser uma lista de 1 ou 2 heróis diferentes')
        self._supremo_fecha_vencidas()
        # a versão das regras da página contra a do juiz, como na sala (salas.py, §4.1 de docs/SEGURANCA.md):
        # página velha refaria a tentativa com outro resultado e cairia como 'divergiu'
        regras = self._confere_versao_cliente(corpo, self._regras())
        regras_juiz = regras.get('regras')
        instante = time.time()
        t = int(instante)
        semana, dia = semana_de(t), dia_de(t)
        with self._escrita():
            estado = self._estado_exige(cid)
            self._confere_herois(conta, estado['progress'], herois)
            fichas = estado['progress'].get('heroes') if isinstance(estado['progress'], dict) else {}
            for hid in herois:
                # 08/10 à noite (o dono: "o Mestre também deve enfrentar o Eco; preciso testar"): a classe gm
                # entra na Câmara — a conta da equipe já fica fora do ranking (_supremo_minha / MELHORES)
                if not _classe_entra(hid, (fichas or {}).get(hid) or {}):
                    raise Recusa(400, 'essa ficha não tem classe que enfrente o Eco', motivo='classe')
            # a aberta de antes vence (já contou como usada ao abrir)
            self.con.execute("UPDATE supremo_tentativas SET estado = 'vencida', fechada_em = ?, motivo = 'outra-aberta' "
                             "WHERE conta_id = ? AND estado = 'aberta'", (t, cid))
            usadas = self.con.execute(USADAS_HOJE, (cid, dia)).fetchone()[0]
            if usadas >= TENTATIVAS_POR_DIA:
                raise Recusa(429, 'as %d tentativas de hoje acabaram — o Eco volta a ouvir amanhã' % TENTATIVAS_POR_DIA,
                             motivo='sem-tentativas', liberaEm=(dia + 1) * 86400 - FUSO_S)
            semente = secrets.randbits(31)
            tid = secrets.token_urlsafe(18)
            self.con.execute(
                "INSERT INTO supremo_tentativas(id, conta_id, semana, dia, semente, herois, regras, aberta_ms, estado) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberta')",
                (tid, cid, semana, dia, semente, json.dumps(herois),
                 regras_juiz if _inteiro_puro(regras_juiz) else None, int(instante * 1000)))
            # o estado da abertura (03/10): o das tentativas que já fecharam ou venceram sai
            self.con.execute("DELETE FROM supremo_estados WHERE tentativa IN (SELECT id FROM supremo_tentativas "
                             "WHERE conta_id = ? AND estado != 'aberta')", (cid,))
            self.con.execute("INSERT INTO supremo_estados(tentativa, progress, db) VALUES (?, ?, ?)",
                             (tid, estado['progress_txt'], json.dumps(estado['db'])))
            self._evento(cid, 'supremo-abre', {'tentativa': tid, 'semana': semana, 'herois': herois})
        return 200, {'ok': True, 'tentativa': tid, 'semente': semente, 'restantes': TENTATIVAS_POR_DIA - usadas - 1,
                     'semana': semana_publica(semana)}

    # -- A TENTATIVA EM DUPLA (07/10) -----------------------------------------------------------------
    def _supremo_dupla_por_gid(self, gid):
        """Dentro da tranca: a linha de supremo_grupos do gid (dict), ou None (uma sala em grupo de sempre)."""
        try:
            r = self.con.execute("SELECT * FROM supremo_grupos WHERE gid = ?", (gid,)).fetchone()
        except Exception:
            return None
        return dict(r) if r is not None else None

    def _supremo_dupla_por_tentativa(self, tid):
        """Dentro da tranca: a dupla de que a tentativa faz parte (a de quem lidera OU a do parceiro), ou None."""
        r = self.con.execute("SELECT * FROM supremo_grupos WHERE tentativa = ? OR tentativa_par = ?", (tid, tid)).fetchone()
        return dict(r) if r is not None else None

    def _supremo_abre_dupla(self, gid, lider, membro, herois_l, herois_m, semente, regras_juiz, instante, estados):
        """Dentro da _escrita de _grupo_abrir (grupo.py), com a sala do grupo já inserida: as DUAS tentativas (uma por
        conta, a mesma semente da sala do grupo), o estado de cada conta na abertura e a linha da dupla. As duas
        contas gastam a vez do dia; sem vez numa delas, 429 com `quem` (a porta diz quem precisa esperar amanhã).
        `estados` = {conta_id: estado} já lidos pelo chamador. Devolve {tentativa, restantes, restantesPar}."""
        t = int(instante)
        semana, dia = semana_de(t), dia_de(t)
        for conta, hs in ((lider, herois_l), (membro, herois_m)):
            prog = estados[conta['id']]['progress']
            fichas = prog.get('heroes') if isinstance(prog, dict) else {}
            for hid in hs:
                if not _classe_entra(hid, (fichas or {}).get(hid) or {}):
                    raise Recusa(400, 'essa ficha não tem classe que enfrente o Eco', motivo='classe')
        # a aberta de antes de CADA um vence (já contou como usada ao abrir)
        for conta in (lider, membro):
            self.con.execute("UPDATE supremo_tentativas SET estado = 'vencida', fechada_em = ?, motivo = 'outra-aberta' "
                             "WHERE conta_id = ? AND estado = 'aberta'", (t, conta['id']))
        usadas, fora = {}, []
        for conta in (lider, membro):
            usadas[conta['id']] = self.con.execute(USADAS_HOJE, (conta['id'], dia)).fetchone()[0]
            if usadas[conta['id']] >= TENTATIVAS_POR_DIA:
                fora.append(conta['id'])
        if fora:
            raise Recusa(429, 'as %d tentativas de hoje acabaram — o Eco volta a ouvir amanhã' % TENTATIVAS_POR_DIA,
                         motivo='sem-tentativas', liberaEm=(dia + 1) * 86400 - FUSO_S,
                         quem='os-dois' if len(fora) == 2 else ('parceiro' if fora == [membro['id']] else 'eu'))
        tids = {}
        for conta, hs in ((lider, herois_l), (membro, herois_m)):
            tid = secrets.token_urlsafe(18)
            tids[conta['id']] = tid
            self.con.execute(
                "INSERT INTO supremo_tentativas(id, conta_id, semana, dia, semente, herois, regras, aberta_ms, estado) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberta')",
                (tid, conta['id'], semana, dia, semente, json.dumps(hs),
                 regras_juiz if _inteiro_puro(regras_juiz) else None, int(instante * 1000)))
            self.con.execute("DELETE FROM supremo_estados WHERE tentativa IN (SELECT id FROM supremo_tentativas "
                             "WHERE conta_id = ? AND estado != 'aberta')", (conta['id'],))
            self.con.execute("INSERT INTO supremo_estados(tentativa, progress, db) VALUES (?, ?, ?)",
                             (tid, estados[conta['id']]['progress_txt'], json.dumps(estados[conta['id']]['db'])))
            self._evento(conta['id'], 'supremo-abre', {'tentativa': tid, 'semana': semana, 'herois': hs, 'gid': gid,
                                                        'dupla': True})
        self.con.execute("INSERT INTO supremo_grupos(gid, tentativa, tentativa_par, lider_id, membro_id) VALUES (?, ?, ?, ?, ?)",
                         (gid, tids[lider['id']], tids[membro['id']], lider['id'], membro['id']))
        return {'tentativa': tids[lider['id']], 'restantes': TENTATIVAS_POR_DIA - usadas[lider['id']] - 1,
                'restantesPar': TENTATIVAS_POR_DIA - usadas[membro['id']] - 1}

    def _supremo_dupla_vence(self, dupla, gid, motivo, t):
        """Dentro da _escrita: as duas tentativas e a sala do grupo vencem (o deploy no meio, o prazo, a semana)."""
        for tid in (dupla['tentativa'], dupla['tentativa_par']):
            self.con.execute("UPDATE supremo_tentativas SET estado = 'vencida', motivo = ?, fechada_em = ? "
                             "WHERE id = ? AND estado = 'aberta'", (motivo, t, tid))
            self.con.execute("DELETE FROM supremo_estados WHERE tentativa = ?", (tid,))
        self.con.execute("UPDATE salas_grupo SET estado = 'vencida', motivo = ?, fechada_em = ? WHERE gid = ? "
                         "AND estado = 'aberta'", (motivo, t, gid))

    def _supremo_marca_dentro(self, tid, estado, motivo, t):
        """Dentro da _escrita: a tentativa aberta muda de estado (o mesmo que _supremo_marca, sem abrir transação)."""
        n = self.con.execute("UPDATE supremo_tentativas SET estado = ?, motivo = ?, fechada_em = ? "
                             "WHERE id = ? AND estado = 'aberta'", (estado, motivo, t, tid)).rowcount
        self.con.execute("DELETE FROM supremo_estados WHERE tentativa = ?", (tid,))
        if n:
            r = self.con.execute("SELECT conta_id FROM supremo_tentativas WHERE id = ?", (tid,)).fetchone()
            self._evento(r['conta_id'], 'supremo-' + estado, {'tentativa': tid, 'motivo': motivo})
        return n

    def _grupo_fecha_eco(self, cid, g, gid, dupla, lances, hash_final, instante, t):
        """O fechar da TENTATIVA EM DUPLA, chamado por grupo_fechar (grupo.py) quando o gid é de uma dupla do Eco —
        depois das réguas de sempre da sala em grupo (a fotografada espera o registro limpo; rápido demais recusa).
        O juiz refaz a Câmara no modo da sala em grupo (servidor/juiz/supremo.js, `membros`) com o estado de cada
        conta NA ABERTURA e os sais travados; o placar é um só e as duas tentativas fecham conferidas. O recibo de
        cada conta fica em salas_grupo_pago (o outro membro que fechar depois recebe o dele por _grupo_fechada)."""
        vencida, membros, sais, regras_t = None, [], [], 1
        with self._escrita():
            s = self.con.execute("SELECT * FROM supremo_tentativas WHERE id = ?", (dupla['tentativa'],)).fetchone()
            s2 = self.con.execute("SELECT * FROM supremo_tentativas WHERE id = ?", (dupla['tentativa_par'],)).fetchone()
            if s is None or s2 is None:
                raise Recusa(404, 'tentativa em dupla não encontrada')
            if s['estado'] != 'aberta' or s2['estado'] != 'aberta':
                vencida = 'outra-aberta'          # um dos dois abriu outra tentativa: a dupla venceu
            else:
                vencida = self._supremo_venceu(s, instante)
            if vencida:
                self._supremo_dupla_vence(dupla, gid, vencida, t)
            else:
                for p in json.loads(g['party']):
                    linha = self.con.execute("SELECT id, gm FROM contas WHERE id = ?", (p['conta'],)).fetchone()
                    tid_m = dupla['tentativa'] if p['conta'] == dupla['lider_id'] else dupla['tentativa_par']
                    foto = self.con.execute("SELECT progress, db FROM supremo_estados WHERE tentativa = ?", (tid_m,)).fetchone()
                    if linha is None or foto is None:
                        raise Recusa(409, 'uma das contas da dupla não existe mais')
                    membros.append({'conta': {'id': linha['id'], 'gm': bool(linha['gm'])}, 'dono': p['dono'], 'herois': p['herois'],
                                    'progress': json.loads(foto['progress']), 'db': json.loads(foto['db'] or '{}')})
                sais = [{'rodada': r['rodada'], 'caminho': r['caminho'], 'sal': r['sal']} for r in self.con.execute(
                    "SELECT rodada, caminho, sal FROM supremo_sais WHERE tentativa = ? ORDER BY rodada", (dupla['tentativa'],))]
                regras_t = s['regras'] if _inteiro_puro(s['regras']) else 1
        if vencida:
            raise Recusa(410, 'a tentativa em dupla venceu (%s)' % vencida, motivo='vencida')
        pedido = {'membros': membros,
                  'tentativa': {'semente': g['semente'], 'regras': regras_t,
                                'chaveSal': chave_da_tentativa(self.segredo, dupla['tentativa']).hex(), 'sais': sais},
                  'lances': lances, 'hashFinal': hash_final, 'contexto': {'agoraMs': int(instante * 1000)}}
        try:
            saida = self.juiz.pede('POST', '/supremo/fecha', pedido)
        except Recusa as e:
            if e.status == 422 and e.extra.get('motivo') == 'regras-mudaram':
                self._regras_esquece()
                with self._escrita():
                    self._supremo_dupla_vence(dupla, gid, 'regras-mudaram', t)
                raise Recusa(410, 'as regras do jogo mudaram no meio da tentativa — ela não conta, e a vez de hoje '
                                  'volta para vocês', motivo='regras-mudaram')
            if e.status == 422:
                motivo = e.extra.get('motivo') or 'juiz'
                with self._escrita():
                    for tid in (dupla['tentativa'], dupla['tentativa_par']):
                        self._supremo_marca_dentro(tid, 'recusada', motivo, t)
                self._grupo_marca(gid, 'recusada', motivo, t, 'grupo-recusada')
            raise
        placar = saida.get('placar') if isinstance(saida, dict) else None
        if (not isinstance(saida, dict) or saida.get('ok') is not True or not isinstance(placar, dict)
                or not all(_inteiro_puro(placar.get(k)) and placar.get(k) >= 0 for k in ('dano', 'pontos', 'rodada'))):
            raise Recusa(503, 'o juiz respondeu torto — tente de novo em instantes')
        turnos = saida.get('turnosJogador') if _inteiro_puro(saida.get('turnosJogador')) else 0
        minimo = max(SALA_MIN_S, SALA_S_POR_TURNO * turnos)
        if instante - g['aberta_em'] < minimo:
            with self._escrita():
                for tid in (dupla['tentativa'], dupla['tentativa_par']):
                    self._supremo_marca_dentro(tid, 'recusada', 'rapido-demais', t)
            self._grupo_marca(gid, 'recusada', 'rapido-demais', t, 'grupo-recusada')
            raise Recusa(422, 'a tentativa fechou rápido demais para ser de verdade', motivo='rapido-demais')
        meu = None
        with self._escrita():
            agora_g = self.con.execute("SELECT estado FROM salas_grupo WHERE gid = ?", (gid,)).fetchone()
            if agora_g is None or agora_g['estado'] != 'aberta':
                return self._grupo_fechada(cid, gid)             # o outro membro fechou junto: o recibo dele
            for conta_id, tid in ((dupla['lider_id'], dupla['tentativa']), (dupla['membro_id'], dupla['tentativa_par'])):
                n = self.con.execute(
                    "UPDATE supremo_tentativas SET estado = 'conferida', fechada_em = ?, dano = ?, pontos = ?, derrubou = ?, "
                    "rodada = ?, turnos = ? WHERE id = ? AND estado = 'aberta'",
                    (t, placar['dano'], placar['pontos'], 1 if placar.get('derrubou') else 0, placar['rodada'], turnos,
                     tid)).rowcount
                if not n:
                    raise Recusa(409, 'essa tentativa já foi fechada')
                self.con.execute("DELETE FROM supremo_estados WHERE tentativa = ?", (tid,))
                self._evento(conta_id, 'supremo-conferida', {'tentativa': tid, 'dano': placar['dano'], 'pontos': placar['pontos'],
                                                              'derrubou': bool(placar.get('derrubou')), 'turnos': turnos,
                                                              'gid': gid, 'dupla': True})
                soma_trilha(self.con, conta_id, t, 'eco')        # a tentativa conferida dá pontos na trilha dos dois
                recibo = {'ok': True, 'fase': 'eco', 'eco': True, 'dupla': True, 'gid': gid, 'tentativa': tid,
                          'dano': placar['dano'], 'pontos': placar['pontos'], 'derrubou': bool(placar.get('derrubou')),
                          'bonus': placar.get('bonus') or 0, 'rodada': placar['rodada'],
                          'eu': self._supremo_minha(conta_id, t), 'semana': semana_publica(semana_de(t))}
                self.con.execute("INSERT INTO salas_grupo_pago(gid, conta_id, recompensa) VALUES (?, ?, ?)",
                                 (gid, conta_id, json.dumps(recibo, ensure_ascii=False)))
                if conta_id == cid:
                    meu = recibo
            self.con.execute("UPDATE salas_grupo SET estado = 'paga', fechada_em = ? WHERE gid = ?", (t, gid))
        log.info("supremo em dupla: #%d e #%d tiraram %d do Eco (%d pontos)", dupla['lider_id'], dupla['membro_id'],
                 placar['dano'], placar['pontos'])
        return 200, meu

    # -- POST /api/supremo/sal ------------------------------------------------------------------
    def _supremo_venceu(self, s, instante):
        """Dentro da _escrita: o motivo de a tentativa aberta `s` já ter vencido (a semana dela fechou, o prazo
        passou), ou None. O fechar e o sal leem a mesma régua."""
        if self.con.execute("SELECT 1 FROM supremo_semanas WHERE semana = ?", (s['semana'],)).fetchone():
            return 'semana-fechou'
        if instante - s['aberta_ms'] / 1000.0 > VALIDADE_S:
            return 'prazo'
        return None

    def supremo_sal(self, conta, corpo):
        """O sal da rodada R, contra o caminho dos lances até a virada dela. A trava: uma linha por (tentativa,
        rodada); o mesmo caminho repetido devolve o mesmo sal (a resposta que a rede perdeu), outro caminho é
        recusado — e a tentativa segue no caminho que travou."""
        cid = conta['id']
        tid, rodada, caminho = corpo.get('tentativa'), corpo.get('rodada'), corpo.get('caminho')
        if not isinstance(tid, str) or not RE_BILHETE.match(tid):
            raise Recusa(400, 'tentativa inválida')
        if not _inteiro_puro(rodada) or not 2 <= rodada <= RODADAS:
            raise Recusa(400, 'rodada precisa ser um inteiro de 2 a %d (a 1 é da semente)' % RODADAS)
        if not isinstance(caminho, str) or not RE_CAMINHO.match(caminho):
            raise Recusa(400, 'caminho precisa ser o SHA-256 dos lances, em hexadecimal')
        self._supremo_fecha_vencidas()
        instante = time.time()
        t = int(instante)
        recusa = None
        with self._escrita():
            s = self.con.execute("SELECT * FROM supremo_tentativas WHERE id = ?", (tid,)).fetchone()
            if s is not None:
                # 07/10: a tentativa em dupla — qualquer dos dois pede (a autoridade do lockstep pode ser o parceiro),
                # mas SEMPRE com a tentativa de quem lidera (a que vai na ata): os sais moram nela
                dupla = self._supremo_dupla_por_tentativa(tid)
                if dupla is not None:
                    if cid not in (dupla['lider_id'], dupla['membro_id']):
                        s = None
                    elif tid != dupla['tentativa']:
                        raise Recusa(409, 'na dupla o sorteio é pedido com a tentativa de quem lidera', motivo='tentativa-da-dupla')
                elif s['conta_id'] != cid:
                    s = None
            if s is None:                                     # a de outra conta: a mesma resposta
                raise Recusa(404, 'tentativa não encontrada')
            if s['estado'] == 'vencida':
                raise Recusa(410, 'essa tentativa venceu (%s)' % (s['motivo'] or 'prazo'), motivo='vencida')
            if s['estado'] != 'aberta':
                raise Recusa(409, 'essa tentativa já foi fechada (%s)' % s['estado'], motivo='fechada')
            vencida = self._supremo_venceu(s, instante)
            if vencida:
                self.con.execute("UPDATE supremo_tentativas SET estado = 'vencida', motivo = ?, fechada_em = ? "
                                 "WHERE id = ?", (vencida, t, tid))
                recusa = Recusa(410, 'essa tentativa venceu (%s)' % vencida, motivo='vencida')
            else:
                ja = self.con.execute("SELECT caminho, sal FROM supremo_sais WHERE tentativa = ? AND rodada = ?",
                                      (tid, rodada)).fetchone()
                if ja is not None:
                    if ja['caminho'] == caminho:
                        return 200, {'ok': True, 'rodada': rodada, 'sal': ja['sal']}
                    # o ensaio: a sorte de outro futuro para a mesma rodada. Fica no registro da conta
                    self._evento(cid, 'supremo-ensaio', {'tentativa': tid, 'rodada': rodada, 'motivo': 'caminho-preso'})
                    recusa = Recusa(409, 'a rodada %d já tem o sorteio dela, preso aos lances que você mandou antes — '
                                         'outro caminho não ganha outra sorte' % rodada, motivo='caminho-preso')
                else:
                    ultima = self.con.execute("SELECT MAX(rodada) FROM supremo_sais WHERE tentativa = ?",
                                              (tid,)).fetchone()[0]
                    esperada = (ultima or 1) + 1
                    if rodada != esperada:
                        self._evento(cid, 'supremo-ensaio', {'tentativa': tid, 'rodada': rodada, 'motivo': 'rodada-fora'})
                        recusa = Recusa(409, 'a rodada %d não é a próxima desta tentativa (a próxima é a %d)'
                                        % (rodada, esperada), motivo='rodada-fora', esperada=esperada)
                    else:
                        sal = sal_da_rodada(chave_da_tentativa(self.segredo, tid), rodada, caminho)
                        self.con.execute("INSERT INTO supremo_sais(tentativa, rodada, caminho, sal, pedido_ms) "
                                         "VALUES (?, ?, ?, ?, ?)", (tid, rodada, caminho, sal, int(instante * 1000)))
                        return 200, {'ok': True, 'rodada': rodada, 'sal': sal}
        # fora da transação: o que ela gravou (a tentativa vencida, o evento do ensaio) já está gravado
        raise recusa

    # -- POST /api/supremo/fechar ---------------------------------------------------------------
    def _supremo_marca(self, tid, estado, motivo, t):
        with self._escrita():
            n = self.con.execute("UPDATE supremo_tentativas SET estado = ?, motivo = ?, fechada_em = ? "
                                 "WHERE id = ? AND estado = 'aberta'", (estado, motivo, t, tid)).rowcount
            self.con.execute("DELETE FROM supremo_estados WHERE tentativa = ?", (tid,))
            if n:
                r = self.con.execute("SELECT conta_id FROM supremo_tentativas WHERE id = ?", (tid,)).fetchone()
                self._evento(r['conta_id'], 'supremo-' + estado, {'tentativa': tid, 'motivo': motivo})
        return n

    def supremo_fechar(self, conta, corpo):
        cid = conta['id']
        tid, lances, hash_final = corpo.get('tentativa'), corpo.get('lances'), corpo.get('hashFinal')
        if not isinstance(tid, str) or not RE_BILHETE.match(tid):
            raise Recusa(400, 'tentativa inválida')
        if not isinstance(lances, list) or len(lances) > LANCES_MAX:
            raise Recusa(400, 'lances precisa ser uma lista de até %d lances' % LANCES_MAX)
        if hash_final is not None and not _inteiro_puro(hash_final):
            raise Recusa(400, 'hashFinal precisa ser um inteiro ou null')
        self._supremo_fecha_vencidas()
        instante = time.time()
        t = int(instante)
        vencida = None
        with self._escrita():
            s = self.con.execute("SELECT * FROM supremo_tentativas WHERE id = ?", (tid,)).fetchone()
            if s is None or s['conta_id'] != cid:            # a de outra conta: a mesma resposta
                raise Recusa(404, 'tentativa não encontrada')
            if s['estado'] == 'vencida':
                raise Recusa(410, 'essa tentativa venceu (%s)' % (s['motivo'] or 'prazo'), motivo='vencida')
            if s['estado'] != 'aberta':
                raise Recusa(409, 'essa tentativa já foi fechada (%s)' % s['estado'])
            decorrido = instante - s['aberta_ms'] / 1000.0
            vencida = self._supremo_venceu(s, instante)
            if vencida:
                self.con.execute("UPDATE supremo_tentativas SET estado = 'vencida', motivo = ?, fechada_em = ? "
                                 "WHERE id = ?", (vencida, t, tid))
            else:
                estado = self._estado_exige(cid)
                # 03/10: o grupo é o da ABERTURA (supremo_estados); a tentativa de antes da tabela usa o de agora
                foto = self.con.execute("SELECT progress, db FROM supremo_estados WHERE tentativa = ?", (tid,)).fetchone()
                if foto is not None:
                    try:
                        estado = {'progress': json.loads(foto['progress']), 'db': json.loads(foto['db'] or '{}')}
                    except (TypeError, ValueError):
                        pass
                # 03/10: os caminhos travados rodada a rodada — o juiz confere cada lance de sal contra eles
                sais = [{'rodada': r['rodada'], 'caminho': r['caminho'], 'sal': r['sal']} for r in self.con.execute(
                    "SELECT rodada, caminho, sal FROM supremo_sais WHERE tentativa = ? ORDER BY rodada", (tid,))]
        if vencida:
            raise Recusa(410, 'essa tentativa venceu (%s)' % vencida, motivo='vencida')
        if decorrido < SALA_MIN_S:
            self._supremo_marca(tid, 'recusada', 'rapido-demais', t)
            raise Recusa(422, 'a tentativa fechou rápido demais para ser de verdade', motivo='rapido-demais')
        pedido = {'conta': {'id': cid, 'gm': bool(conta['gm'])},
                  'tentativa': {'semente': s['semente'], 'herois': json.loads(s['herois']),
                                # a versão das regras com que abriu: o juiz confere contra a dele
                                'regras': s['regras'] if _inteiro_puro(s['regras']) else 1,
                                # a chave DESTA tentativa (não o segredo) e os sais que saíram daqui
                                'chaveSal': chave_da_tentativa(self.segredo, tid).hex(), 'sais': sais},
                  'lances': lances, 'hashFinal': hash_final,
                  'progress': estado['progress'], 'db': estado['db'],
                  'contexto': {'agoraMs': int(instante * 1000)}}
        try:
            saida = self.juiz.pede('POST', '/supremo/fecha', pedido)
        except Recusa as e:
            if e.status == 422 and e.extra.get('motivo') == 'regras-mudaram':
                self._regras_esquece()
                self._supremo_marca(tid, 'vencida', 'regras-mudaram', t)
                raise Recusa(410, 'as regras do jogo mudaram no meio da tentativa — ela não conta, e a vez de hoje '
                                  'volta para você', motivo='regras-mudaram')
            if e.status == 422:                              # o replay não fecha: não pontua
                self._supremo_marca(tid, 'recusada', e.extra.get('motivo') or 'juiz', t)
            raise
        placar = saida.get('placar') if isinstance(saida, dict) else None
        if (not isinstance(saida, dict) or saida.get('ok') is not True or not isinstance(placar, dict)
                or not all(_inteiro_puro(placar.get(k)) and placar.get(k) >= 0 for k in ('dano', 'pontos', 'rodada'))):
            raise Recusa(503, 'o juiz respondeu torto — tente de novo em instantes')
        turnos = saida.get('turnosJogador') if _inteiro_puro(saida.get('turnosJogador')) else 0
        minimo = max(SALA_MIN_S, SALA_S_POR_TURNO * turnos)
        if decorrido < minimo:
            self._supremo_marca(tid, 'recusada', 'rapido-demais', t)
            raise Recusa(422, 'a tentativa fechou rápido demais para ser de verdade', motivo='rapido-demais')
        with self._escrita():
            n = self.con.execute(
                "UPDATE supremo_tentativas SET estado = 'conferida', fechada_em = ?, dano = ?, pontos = ?, derrubou = ?, "
                "rodada = ?, turnos = ? WHERE id = ? AND estado = 'aberta'",
                (t, placar['dano'], placar['pontos'], 1 if placar.get('derrubou') else 0, placar['rodada'], turnos,
                 tid)).rowcount
            if not n:                                        # dois fechar juntos: só um conta
                raise Recusa(409, 'essa tentativa já foi fechada')
            self.con.execute("DELETE FROM supremo_estados WHERE tentativa = ?", (tid,))
            self._evento(cid, 'supremo-conferida', {'tentativa': tid, 'dano': placar['dano'], 'pontos': placar['pontos'],
                                                    'derrubou': bool(placar.get('derrubou')), 'turnos': turnos})
            soma_trilha(self.con, cid, t, 'eco')               # 07/10: a tentativa conferida dá pontos na trilha
            minha = self._supremo_minha(cid, t)
        log.info("supremo: #%d tirou %d do Eco (%d pontos)", cid, placar['dano'], placar['pontos'])
        return 200, {'ok': True, 'dano': placar['dano'], 'pontos': placar['pontos'],
                     'derrubou': bool(placar.get('derrubou')), 'bonus': placar.get('bonus') or 0,
                     'rodada': placar['rodada'], 'fase': saida.get('fase'), 'eu': minha,
                     'semana': semana_publica(semana_de(t))}

    # -- o evento da semana na agenda do mundo (GET /api/eventos, api.py) ------------------------
    def _supremo_eventos(self, t):
        """O Eco como EVENTO DO MUNDO: a semana de agora (no ar, com a contagem regressiva que a faixa do jogo
        e o site já mostram) e a próxima. Tipo 'aviso' (fator 1: não mexe em recompensa nenhuma) e id 'eco-N',
        que não é de agenda_eventos — ninguém cancela (o painel do Mestre não o lista para cancelar)."""
        fora = []
        for w in (semana_de(t), semana_de(t) + 1):
            ini = inicio_da_semana(w)
            fora.append({'id': 'eco-%d' % w, 'origem': 'supremo', 'regra': None, 'tipo': 'aviso', 'multiplicador': 1,
                         'calabouco': None, 'titulo': 'O Eco Primordial',
                         'texto': 'O chefe supremo da semana: 3 tentativas por dia, placar de dano conferido pelo '
                                  'servidor e prêmios para o ranking no fechamento (domingo, 23:59).',
                         'inicio': ini, 'fim': ini + SEMANA_S})
        return fora
