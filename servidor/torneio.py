#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O TORNEIO DA ARENA (10/10) — o servidor. O CONTRATO é docs/TORNEIO.md: o cliente, o site e o painel do
Mestre são escritos contra ele, e o que diverge está anotado lá, na seção 4.

O pedido do dono: "a arena é o maior item do mapa e tem que ir além de procurar desafios, deve ter torneio;
todo sábado terá torneio de PvP e todo domingo torneio de guilda (ou quando o adm marcar)".

Entra no cartório como mixin (`class Api(..., TorneioMixin)` no api.py) e usa as peças dos outros: o estado do
servidor e os heróis (salas.py), a partida pronta da Arena (arena.py — o torneio cria a linha JÁ 'pronta' com
o did dele, e os clientes seguem o duelo de sempre pelo modo 'arena'), o duelo conferido pelo juiz (grupo.py —
que chama `_torneio_resultado` em TODO desfecho guardado), as barras e a fila de entrega da loja (loja.py) e a
guilda (guilda.py). Importa só de comum.py, grupo.py, arena.py e anuncio.py — nunca do api.py.

O RELÓGIO. O torneio é dirigido pelo tempo, e o tempo é o do SERVIDOR (ms): `_torneio_passo` é idempotente —
cria os torneios da semana, fecha as inscrições e sorteia, chama as lutas, vence os prazos de presença, abre
a rodada seguinte e paga — e roda em toda rota do torneio E num laço de TORNEIO_PASSO_S segundos (`liga_torneios`,
uma thread do próprio servidor, como a varredura da Google Play). Tudo o que ele decide está no banco: os dois
contêineres do rolling update dão o mesmo passo sem se atropelar (a escrita é BEGIN IMMEDIATE, e a chave
semanal é UNIQUE). As durações saem do ambiente (SOTERRA_TORNEIO_…) para as provas não esperarem 3 minutos.

O QUE O SERVIDOR NÃO ACREDITA DO CLIENTE (docs/SEGURANCA.md §4.10): o nível da dupla (lido do estado do
servidor na inscrição E de novo no fechamento), a presença (só o POST da própria conta, dentro do prazo), o
vencedor (só o juiz, pelo replay dos lances — o gancho só aceita o resultado que o duelo_fechar carimbou com o
id do torneio: o did certo, as duas contas da luta, os heróis inscritos, o modo 'arena'), o sorteio (secrets)
e o prêmio (uma linha por torneio em torneio_pagos, e cada peça com o idem dela).

Tabelas NOVAS, nunca ALTER (o rolling update divide o banco). Tempos em ms, salvo `criado_em`/`dobro_ate` (s).
"""
import datetime
import json
import logging
import os
import secrets
import threading
import time

from anuncio import FUSO_S, dia_de
from arena import classes_de, herois_usaveis
from comum import Recusa, agora
from grupo import _herois, _nivel_forte

log = logging.getLogger('api')


def _do_ambiente(nome, padrao):
    """Segundos do ambiente (as provas encurtam os prazos por aqui); ausente ou torto, o padrão."""
    v = os.environ.get(nome)
    try:
        n = float(v) if v is not None and v.strip() != '' else None
    except ValueError:
        n = None
    return n if n is not None and n >= 0 else padrao


# ---- as réguas (docs/TORNEIO.md §1) ----------------------------------------------------------------------------
TORNEIO_FECHA_MS = int(_do_ambiente('SOTERRA_TORNEIO_FECHA_S', 600) * 1000)       # as inscrições fecham 10 min antes
TORNEIO_CHAMADA_MS = int(_do_ambiente('SOTERRA_TORNEIO_CHAMADA_S', 180) * 1000)   # 3 min para dizer "estou aqui"
TORNEIO_ENTRE_MS = int(_do_ambiente('SOTERRA_TORNEIO_ENTRE_S', 120) * 1000)       # a rodada seguinte, 2 min depois
TORNEIO_LUTA_MAX_MS = int(_do_ambiente('SOTERRA_TORNEIO_LUTA_MAX_S', 1800) * 1000)  # a luta que passa de 30 min: sorteio
TORNEIO_PREVISAO_MS = int(_do_ambiente('SOTERRA_TORNEIO_PREVISAO_S', 1200) * 1000)  # a previsão pública: 20 min por rodada
TORNEIO_DOBRO_S = int(_do_ambiente('SOTERRA_TORNEIO_DOBRO_S', 7 * 86400))         # o XP em dobro da guilda campeã
TORNEIO_PASSO_S = _do_ambiente('SOTERRA_TORNEIO_PASSO_S', 5)                      # o laço do relógio
# as LEITURAS (as duas públicas, o /meu e a lista do Mestre) dão o passo no máximo uma vez a cada tanto por
# processo: o passo é uma transação de escrita, e uma rota sem conta não pode virar um jeito de segurar a
# trava do banco. As rotas que AGEM (inscrever, presente, sair…) dão o passo sempre
TORNEIO_PASSO_MIN_S = _do_ambiente('SOTERRA_TORNEIO_PASSO_MIN_S', 1.0)
TORNEIO_INTERVALO_MS = 6 * 86400 * 1000      # o semanal seguinte nunca a menos de 6 dias do anterior
TORNEIO_HORA = 14                            # 14:00 de Brasília
TORNEIO_ANTECEDENCIA_MS = 180 * 86400 * 1000  # o Mestre marca até 180 dias à frente
TORNEIO_MARCADOS_MAX = 30                    # torneios do Mestre que ainda não acabaram
VAGAS = (2, 4, 8, 16)
VAGAS_MAX = 16
FAIXAS = {'20-25': (20, 25), '25-30': (25, 30)}
FAIXA_GUILDA = (20, 30)
# os da semana: (tipo, faixa, dia da semana de Brasília — segunda = 0)
SEMANAIS = (('pvp', '20-25', 5), ('pvp', '25-30', 5), ('guilda', None, 6))
ATIVOS = ('inscricoes', 'sorteado', 'andamento')
ULTIMOS_ENCERRADOS = 4
TITULO_LIMITES = (3, 60)
# o prêmio do campeão pelo tamanho da chave SORTEADA
PREMIOS = {
    16: {'barras': 20, 'vintens': 5000, 'gemas': 2, 'conquista': True, 'moldura': True, 'xpGuilda': 600},
    8:  {'barras': 10, 'vintens': 2500, 'gemas': 1, 'conquista': True, 'moldura': True, 'xpGuilda': 300},
    4:  {'barras': 5, 'vintens': 1250, 'gemas': 0, 'conquista': True, 'moldura': False, 'xpGuilda': 150},
    2:  {'barras': 2, 'vintens': 600, 'gemas': 0, 'conquista': False, 'moldura': False, 'xpGuilda': 60},
}
GEMA = 'stone-gem'                 # js/core/data/items.js, DATA.gema.id — a Gema Enterrada inteira
SKU_VINTENS = 'torneio-vintens'    # o pedido de preço 0 dos vinténs (loja.py dá o nome e a origem 'torneio')
SKU_GEMAS = 'torneio'              # o pedido de preço 0 das gemas
REF_BARRAS = 'torneio:'            # a ref do movimento de barras (o motivo no banco é 'presente': o CHECK não se altera)
# a moldura "Campeão da Arena": o grau sai das conquistas (1-2: I, 3-4: II, 5+: III) e as marcas vão até 5
MOLDURA_ARENA = 'arena'
MOLDURA_ARENA_NOME = 'Campeão da Arena'
MARCAS_MAX = 5

ESQUEMA_TORNEIO = """
-- O TORNEIO DA ARENA (10/10, torneio.py; o contrato é docs/TORNEIO.md). Tabelas NOVAS, nunca ALTER.
CREATE TABLE IF NOT EXISTS torneios(
  id                 INTEGER PRIMARY KEY,
  tipo               TEXT NOT NULL CHECK (tipo IN ('pvp', 'guilda')),
  faixa              TEXT,
  nivel_min          INTEGER NOT NULL,
  nivel_max          INTEGER NOT NULL,
  titulo             TEXT NOT NULL,
  origem             TEXT NOT NULL CHECK (origem IN ('semanal', 'mestre')),
  chave_semanal      TEXT UNIQUE,          -- 'pvp:20-25:<inicio_ms>': os dois contêineres criam o mesmo, uma vez
  inicio_ms          INTEGER NOT NULL,
  inscricao_ate_ms   INTEGER NOT NULL,
  estado             TEXT NOT NULL DEFAULT 'inscricoes'
    CHECK (estado IN ('inscricoes', 'sorteado', 'andamento', 'encerrado', 'cancelado')),
  tamanho            INTEGER,              -- 2, 4, 8 ou 16, depois do sorteio
  rodada             INTEGER NOT NULL DEFAULT 0,
  rodada_ms          INTEGER,              -- quando a rodada em curso começou de fato
  rodada_decidida_ms INTEGER,              -- quando a rodada em curso ficou inteira decidida (a seguinte: +2 min)
  campeao_id         INTEGER,
  campeao_guilda     INTEGER,
  motivo             TEXT,                 -- do cancelamento: 'poucos' | 'mestre'
  criado_por         INTEGER,
  criado_ms          INTEGER NOT NULL,
  encerrado_ms       INTEGER
);
CREATE INDEX IF NOT EXISTS torneios_estado ON torneios(estado, inicio_ms);
-- a dupla inscrita (no de guilda: o REPRESENTANTE, posto aqui no fechamento, com a guilda dele)
CREATE TABLE IF NOT EXISTS torneio_inscritos(
  torneio_id INTEGER NOT NULL REFERENCES torneios(id) ON DELETE CASCADE,
  conta_id   INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  herois     TEXT NOT NULL,
  classes    TEXT NOT NULL,
  nivel      INTEGER NOT NULL,
  guilda_id  INTEGER,
  desde_ms   INTEGER NOT NULL,
  PRIMARY KEY (torneio_id, conta_id)
);
CREATE INDEX IF NOT EXISTS torneio_inscritos_conta ON torneio_inscritos(conta_id);
-- o torneio de guilda: quem se voluntariou (com a dupla) e quem o líder/oficial escolheu
CREATE TABLE IF NOT EXISTS torneio_voluntarios(
  torneio_id INTEGER NOT NULL REFERENCES torneios(id) ON DELETE CASCADE,
  conta_id   INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  guilda_id  INTEGER NOT NULL,
  herois     TEXT NOT NULL,
  classes    TEXT NOT NULL,
  nivel      INTEGER NOT NULL,
  desde_ms   INTEGER NOT NULL,
  PRIMARY KEY (torneio_id, conta_id)
);
CREATE INDEX IF NOT EXISTS torneio_voluntarios_g ON torneio_voluntarios(torneio_id, guilda_id);
CREATE TABLE IF NOT EXISTS torneio_representantes(
  torneio_id INTEGER NOT NULL REFERENCES torneios(id) ON DELETE CASCADE,
  guilda_id  INTEGER NOT NULL,
  conta_id   INTEGER NOT NULL,
  por_id     INTEGER,
  em_ms      INTEGER NOT NULL,
  PRIMARY KEY (torneio_id, guilda_id)
);
-- a chave: uma linha por luta de cada rodada (a = o de cima). b nulo na rodada 0 = passe livre
CREATE TABLE IF NOT EXISTS torneio_lutas(
  torneio_id  INTEGER NOT NULL REFERENCES torneios(id) ON DELETE CASCADE,
  rodada      INTEGER NOT NULL,
  pos         INTEGER NOT NULL,
  a_id        INTEGER,
  b_id        INTEGER,
  estado      TEXT NOT NULL DEFAULT 'aguarda' CHECK (estado IN ('aguarda', 'chamada', 'luta', 'decidida')),
  vencedor    TEXT CHECK (vencedor IN ('a', 'b')),
  como        TEXT CHECK (como IN ('luta', 'wo', 'bye', 'sorteio', 'desistencia')),
  previsto_ms INTEGER NOT NULL,
  prazo_ms    INTEGER,                    -- até quando vale o "estou aqui" da chamada em curso
  a_presente  INTEGER NOT NULL DEFAULT 0,
  b_presente  INTEGER NOT NULL DEFAULT 0,
  did         TEXT,                       -- o duelo em curso (a partida pronta da Arena)
  luta_ms     INTEGER,                    -- quando esse duelo nasceu (o teto de 30 min conta daqui)
  revanche    INTEGER NOT NULL DEFAULT 0,
  decidida_ms INTEGER,
  PRIMARY KEY (torneio_id, rodada, pos)
);
CREATE INDEX IF NOT EXISTS torneio_lutas_did ON torneio_lutas(did);
-- todo did que o torneio já abriu (o da luta e o da revanche): por aqui o duelo sabe que é de torneio
CREATE TABLE IF NOT EXISTS torneio_dids(
  did        TEXT PRIMARY KEY,
  torneio_id INTEGER NOT NULL REFERENCES torneios(id) ON DELETE CASCADE,
  rodada     INTEGER NOT NULL,
  pos        INTEGER NOT NULL,
  revanche   INTEGER NOT NULL DEFAULT 0,
  criado_ms  INTEGER NOT NULL
);
-- quem saiu depois do fechamento: perde por W.O. toda luta que ainda tiver
CREATE TABLE IF NOT EXISTS torneio_desistentes(
  torneio_id INTEGER NOT NULL REFERENCES torneios(id) ON DELETE CASCADE,
  conta_id   INTEGER NOT NULL,
  em_ms      INTEGER NOT NULL,
  PRIMARY KEY (torneio_id, conta_id)
);
-- o prêmio pago: UMA linha por torneio (a trava do "nada se paga duas vezes"); sobrevive à conta
CREATE TABLE IF NOT EXISTS torneio_pagos(
  torneio_id INTEGER PRIMARY KEY,
  conta_id   INTEGER,
  guilda_id  INTEGER,
  tamanho    INTEGER NOT NULL,
  premio     TEXT NOT NULL,
  pedidos    TEXT,
  criado_em  INTEGER NOT NULL
);
-- as CONQUISTAS (para sempre): um torneio vencido com chave de 4 ou mais. O Relé lê daqui (rele_ident.py)
CREATE TABLE IF NOT EXISTS torneio_conquistas(
  id         INTEGER PRIMARY KEY,
  conta_id   INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL CHECK (tipo IN ('pvp', 'guilda')),
  torneio_id INTEGER NOT NULL,
  tamanho    INTEGER NOT NULL,
  faixa      TEXT,
  criado_em  INTEGER NOT NULL,
  UNIQUE (torneio_id, conta_id)
);
CREATE INDEX IF NOT EXISTS torneio_conquistas_conta ON torneio_conquistas(conta_id, tipo);
-- cada torneio de guilda vencido: o XP da guilda, até quando o XP dos membros dobra e se conta como TÍTULO
-- (chave de 4 ou mais: a marca permanente na placa)
CREATE TABLE IF NOT EXISTS torneio_guilda_titulos(
  torneio_id INTEGER PRIMARY KEY,
  guilda_id  INTEGER NOT NULL,
  conta_id   INTEGER,
  tamanho    INTEGER NOT NULL,
  xp         INTEGER NOT NULL DEFAULT 0,
  dobro_ate  INTEGER NOT NULL DEFAULT 0,
  titulo     INTEGER NOT NULL DEFAULT 0,
  criado_em  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS torneio_guilda_titulos_g ON torneio_guilda_titulos(guilda_id);
-- o campeão VIGENTE de cada faixa ('pvp:20-25', 'pvp:25-30', 'guilda'): o do último torneio encerrado dela
CREATE TABLE IF NOT EXISTS torneio_vigentes(
  chave      TEXT PRIMARY KEY,
  torneio_id INTEGER NOT NULL,
  conta_id   INTEGER,
  guilda_id  INTEGER,
  desde      INTEGER NOT NULL
);
"""

ROTAS_TORNEIO = {
    # públicas (o site as lê)
    ('GET',  '/api/torneios'):                  ('torneios_ler', False),
    ('GET',  '/api/torneio'):                   ('torneio_ler', False),
    # com conta
    ('GET',  '/api/torneio/meu'):               ('torneio_meu', True),
    ('POST', '/api/torneio/inscrever'):         ('torneio_inscrever', True),
    ('POST', '/api/torneio/sair'):              ('torneio_sair', True),
    ('POST', '/api/torneio/presente'):          ('torneio_presente', True),
    ('POST', '/api/torneio/voluntariar'):       ('torneio_voluntariar', True),
    ('POST', '/api/torneio/desvoluntariar'):    ('torneio_desvoluntariar', True),
    ('POST', '/api/torneio/representante'):     ('torneio_representante', True),
}
# as do Mestre levam a FRASE_SO_MESTRE, que mora em mestre.py: o api.py as soma (ROTAS_TORNEIO_MESTRE)
ROTAS_TORNEIO_MESTRE = {
    ('GET',  '/api/mestre/torneios'):           'mestre_torneios',
    ('POST', '/api/mestre/torneio/marcar'):     'mestre_torneio_marcar',
    ('POST', '/api/mestre/torneio/cancelar'):   'mestre_torneio_cancelar',
}


def _ms():
    return int(time.time() * 1000)


def _json(texto, padrao):
    try:
        v = json.loads(texto) if texto else padrao
    except (TypeError, ValueError):
        return padrao
    return v


def vagas_de(n):
    """As vagas abrem aos pares: 2 → 4 → 8 → 16 (o teto). Encheu, dobra."""
    for v in VAGAS:
        if n < v:
            return v
    return VAGAS_MAX


def tamanho_de(n):
    """A menor potência de 2 que cabe os inscritos (no mínimo 2, no máximo 16)."""
    for v in VAGAS:
        if n <= v:
            return v
    return VAGAS_MAX


def premio_de(tipo, tamanho):
    """O prêmio do tamanho `tamanho`, no formato público. O XP da guilda só existe no torneio de guilda, e a
    moldura "Campeão da Arena" só no de PvP."""
    p = dict(PREMIOS[tamanho if tamanho in PREMIOS else 2])
    if tipo != 'guilda':
        p['xpGuilda'] = 0
    else:
        p['moldura'] = False
    return p


def grau_da_moldura(n):
    """O grau da moldura "Campeão da Arena" pelas conquistas de PvP: 1-2 = I, 3-4 = II, 5 ou mais = III."""
    return 3 if n >= 5 else 2 if n >= 3 else 1 if n >= 1 else 0


def proximo_semanal(dia_semana, agora_ms, depois_de_ms=None):
    """O próximo `dia_semana` (segunda = 0) às 14:00 de Brasília cujas inscrições ainda estão abertas — e, com
    `depois_de_ms` (o início do semanal anterior), nunca a menos de 6 dias dele."""
    d = datetime.datetime.fromtimestamp(agora_ms / 1000.0 + FUSO_S, datetime.timezone.utc)
    alvo = d.replace(hour=TORNEIO_HORA, minute=0, second=0, microsecond=0) + datetime.timedelta(
        days=(dia_semana - d.weekday()) % 7)
    inicio = int(alvo.timestamp() - FUSO_S) * 1000
    semana = 7 * 86400 * 1000
    while inicio - TORNEIO_FECHA_MS <= agora_ms or (depois_de_ms is not None and inicio < depois_de_ms + TORNEIO_INTERVALO_MS):
        inicio += semana
    return inicio


def titulo_padrao(tipo, faixa):
    if tipo == 'guilda':
        return 'Torneio das Guildas'
    lo, hi = FAIXAS[faixa]
    return 'Torneio da Arena — níveis %d a %d' % (lo, hi)


def sorteia_chave(contas, rng=None):
    """O sorteio: as posições e os passes livres. Devolve (tamanho, [(a, b)]) da PRIMEIRA rodada — b None é o
    passe. Como os inscritos passam da metade da chave, os passes são menos que as lutas: cada um cai numa luta
    diferente, e nunca dois passes se enfrentam."""
    rng = rng or secrets.SystemRandom()
    contas = list(contas)
    rng.shuffle(contas)
    tamanho = tamanho_de(len(contas))
    lutas = tamanho // 2
    passes = set(rng.sample(range(lutas), tamanho - len(contas)))
    pares, i = [], 0
    for k in range(lutas):
        if k in passes:
            pares.append((contas[i], None))
            i += 1
        else:
            pares.append((contas[i], contas[i + 1]))
            i += 2
    return tamanho, pares


def rodadas_de(tamanho):
    n = 0
    while (1 << n) < tamanho:
        n += 1
    return n


class TorneioMixin:

    # ================================================================================================
    #  as leituras (dentro da tranca)
    # ================================================================================================
    def _t_linha(self, tid):
        return self.con.execute("SELECT * FROM torneios WHERE id = ?", (tid,)).fetchone()

    def _t_exige(self, corpo, campo='torneio'):
        tid = corpo.get(campo)
        if isinstance(tid, bool) or not isinstance(tid, int) or tid < 1:
            raise Recusa(400, 'torneio precisa ser o id de um torneio')
        t = self._t_linha(tid)
        if t is None:
            raise Recusa(404, 'torneio não encontrado')
        return t

    def _t_guildas(self, gids):
        """{id: {id, nome, emblema}} das guildas que ainda existem — a da equipe não aparece."""
        gids = sorted({g for g in gids if isinstance(g, int)})
        if not gids:
            return {}
        fora = {}
        for g in self.con.execute("SELECT g.id, g.nome, g.emblema, c.gm FROM guildas g LEFT JOIN contas c ON c.id = g.lider_id "
                                  "WHERE g.id IN (%s)" % ','.join('?' * len(gids)), gids):
            if not g['gm']:
                fora[g['id']] = {'id': g['id'], 'nome': g['nome'], 'emblema': g['emblema']}
        return fora

    def _t_guilda_das_contas(self, cids):
        """{conta: guilda_id} das contas que estão numa guilda AGORA."""
        cids = sorted({c for c in cids if isinstance(c, int)})
        if not cids:
            return {}
        return {r['conta_id']: r['guilda_id'] for r in self.con.execute(
            "SELECT conta_id, guilda_id FROM guilda_membros WHERE conta_id IN (%s)" % ','.join('?' * len(cids)), cids)}

    def _t_voluntarios(self, tid, gid=None):
        """Os voluntários que AINDA são membros da guilda pela qual se voluntariaram, do mais antigo ao mais novo."""
        q = ("SELECT v.* FROM torneio_voluntarios v JOIN guilda_membros m ON m.conta_id = v.conta_id "
             "AND m.guilda_id = v.guilda_id WHERE v.torneio_id = ?")
        args = [tid]
        if gid is not None:
            q += " AND v.guilda_id = ?"
            args.append(gid)
        return self.con.execute(q + " ORDER BY v.desde_ms, v.conta_id", args).fetchall()

    def _t_representantes(self, tid):
        """{guilda: a linha do voluntário que vai} — o escolhido pelo líder/oficial, se ainda é voluntário; senão
        o de MAIOR nível (empate: quem se voluntariou primeiro). A guilda da equipe e a que não existe mais ficam
        de fora. A ordem das guildas é a do primeiro voluntário de cada uma."""
        por_guilda = {}
        for v in self._t_voluntarios(tid):
            por_guilda.setdefault(v['guilda_id'], []).append(v)
        vivas = self._t_guildas(por_guilda.keys())
        escolhidos = {r['guilda_id']: r['conta_id'] for r in self.con.execute(
            "SELECT guilda_id, conta_id FROM torneio_representantes WHERE torneio_id = ?", (tid,))}
        fora = {}
        for gid, vs in por_guilda.items():
            if gid not in vivas:
                continue
            achado = next((v for v in vs if v['conta_id'] == escolhidos.get(gid)), None)
            if achado is None:
                achado = sorted(vs, key=lambda v: (-v['nivel'], v['desde_ms'], v['conta_id']))[0]
            fora[gid] = achado
        return fora

    def _t_inscritos(self, t):
        """As linhas dos inscritos como o público as vê: no PvP, quem se inscreveu; no de guilda antes do
        fechamento, o representante de AGORA de cada guilda com voluntário (é o que conta nas vagas)."""
        if t['tipo'] == 'guilda' and t['estado'] == 'inscricoes':
            reps = self._t_representantes(t['id'])
            return [dict(v, guilda_id=gid) for gid, v in reps.items()]
        return [dict(r) for r in self.con.execute(
            "SELECT * FROM torneio_inscritos WHERE torneio_id = ? ORDER BY desde_ms, conta_id", (t['id'],))]

    def _t_publico(self, t):
        """O torneio `T` do contrato (docs/TORNEIO.md §2)."""
        inscritos = self._t_inscritos(t)
        lutas = self.con.execute("SELECT * FROM torneio_lutas WHERE torneio_id = ? ORDER BY rodada, pos",
                                 (t['id'],)).fetchall()
        cids = [i['conta_id'] for i in inscritos] + [l[k] for l in lutas for k in ('a_id', 'b_id')] + [t['campeao_id']]
        nomes = self._g_nomes([c for c in cids if c is not None])
        if t['tipo'] == 'guilda':
            g_de = {i['conta_id']: i['guilda_id'] for i in inscritos}
            if t['campeao_id'] is not None and t['campeao_guilda'] is not None:
                g_de.setdefault(t['campeao_id'], t['campeao_guilda'])
        else:
            g_de = self._t_guilda_das_contas([c for c in cids if c is not None])
        guildas = self._t_guildas(g_de.values())

        def pessoa(cid):
            if cid is None:
                return None
            return {'conta': cid, 'nome': nomes.get(cid, '?'), 'guilda': guildas.get(g_de.get(cid))}

        chave = None
        if t['tamanho']:
            rodadas = [[] for _ in range(rodadas_de(t['tamanho']))]
            for l in lutas:
                if l['rodada'] < len(rodadas):
                    rodadas[l['rodada']].append({
                        'pos': l['pos'], 'a': pessoa(l['a_id']), 'b': pessoa(l['b_id']), 'estado': l['estado'],
                        'vencedor': l['vencedor'], 'como': l['como'], 'previstoMs': l['previsto_ms']})
            chave = {'tamanho': t['tamanho'], 'rodada': t['rodada'], 'rodadas': rodadas}
        n = len(inscritos)
        tamanho = t['tamanho'] or tamanho_de(max(2, n))
        return {
            'id': t['id'], 'tipo': t['tipo'], 'faixa': t['faixa'], 'nivelMin': t['nivel_min'], 'nivelMax': t['nivel_max'],
            'titulo': t['titulo'], 'origem': t['origem'], 'inicioMs': t['inicio_ms'], 'inscricaoAteMs': t['inscricao_ate_ms'],
            'estado': t['estado'], 'vagas': t['tamanho'] or vagas_de(n),
            'inscritos': [{'conta': i['conta_id'], 'nome': nomes.get(i['conta_id'], '?'), 'nivel': i['nivel'],
                           'classes': _json(i['classes'], []), 'guilda': guildas.get(g_de.get(i['conta_id']))}
                          for i in inscritos],
            'chave': chave, 'campeao': pessoa(t['campeao_id']), 'premio': premio_de(t['tipo'], tamanho)}

    def _torneio_conquistas(self, cid):
        """{pvp, guilda}: as conquistas da conta (o juiz as lê em contexto.arena; a régua é js/core/titulos.js)."""
        fora = {'pvp': 0, 'guilda': 0}
        try:
            for r in self.con.execute("SELECT tipo, COUNT(*) AS n FROM torneio_conquistas WHERE conta_id = ? GROUP BY tipo",
                                      (cid,)):
                if r['tipo'] in fora:
                    fora[r['tipo']] = r['n']
        except Exception:                               # o banco de antes do torneio (uma prova que abre só a loja)
            pass
        return fora

    def _torneio_tem_moldura(self, cid):
        """A moldura "Campeão da Arena" é da conta para sempre desde a primeira conquista de PvP em chave de 8 ou 16."""
        try:
            return self.con.execute("SELECT 1 FROM torneio_conquistas WHERE conta_id = ? AND tipo = 'pvp' AND tamanho >= 8 "
                                    "LIMIT 1", (cid,)).fetchone() is not None
        except Exception:
            return False

    def _torneio_vigente(self, cid):
        try:
            return self.con.execute("SELECT 1 FROM torneio_vigentes WHERE conta_id = ? AND chave LIKE 'pvp:%' LIMIT 1",
                                    (cid,)).fetchone() is not None
        except Exception:
            return False

    def _torneio_da_guilda(self, gid, t):
        """O que a guilda `gid` carrega do torneio: {campea, titulos, fatorXp, xpDobroAteMs} — `t` em segundos."""
        try:
            titulos = self.con.execute("SELECT COUNT(*) FROM torneio_guilda_titulos WHERE guilda_id = ? AND titulo = 1",
                                       (gid,)).fetchone()[0]
            ate = self.con.execute("SELECT MAX(dobro_ate) FROM torneio_guilda_titulos WHERE guilda_id = ?",
                                   (gid,)).fetchone()[0] or 0
            campea = self.con.execute("SELECT 1 FROM torneio_vigentes WHERE chave = 'guilda' AND guilda_id = ?",
                                      (gid,)).fetchone() is not None
        except Exception:
            return {'campea': False, 'titulos': 0, 'fatorXp': 1, 'xpDobroAteMs': 0}
        return {'campea': campea, 'titulos': min(MARCAS_MAX, titulos), 'fatorXp': 2 if ate > t else 1,
                'xpDobroAteMs': ate * 1000 if ate > t else 0}

    def _torneio_fator_xp(self, cid, t):
        """Dentro da tranca: 2 enquanto a guilda da conta for a campeã com o XP em dobro valendo; senão 1. O juiz
        o lê em contexto.guilda.fatorXp e o põe no lugar do +15% do cofre (servidor/juiz/estado.js)."""
        try:
            r = self.con.execute(
                "SELECT 1 FROM guilda_membros m JOIN torneio_guilda_titulos g ON g.guilda_id = m.guilda_id "
                "WHERE m.conta_id = ? AND g.dobro_ate > ? LIMIT 1", (cid, t)).fetchone()
        except Exception:
            return 1
        return 2 if r is not None else 1

    # ================================================================================================
    #  o relógio
    # ================================================================================================
    def _torneio_passo(self, agora_ms=None, leitura=False):
        """FORA da tranca: um passo do relógio, idempotente, e a entrega "na hora" do que ele pagou. Erro de
        banco vai para o log — o passo seguinte tenta de novo, e nenhuma rota do torneio vira 500 por causa dele.
        `leitura`: quem chama só vai LER — o passo é pulado se este processo deu um há menos de
        TORNEIO_PASSO_MIN_S (o laço de fundo e as rotas que agem não pulam)."""
        agora_ms = _ms() if agora_ms is None else agora_ms
        relogio = time.monotonic()
        if leitura and relogio - getattr(self, '_torneio_passo_em', -1e9) < TORNEIO_PASSO_MIN_S:
            return
        self._torneio_passo_em = relogio
        try:
            with self._escrita():
                self._torneio_passo_dentro(agora_ms)
        except Recusa:
            raise
        except Exception:
            log.exception("torneio: o passo do relógio quebrou")
        self._torneio_entrega()

    def _torneio_passo_dentro(self, agora_ms):
        """Dentro de _escrita: cria os da semana, fecha e sorteia, e anda cada torneio vivo até onde o relógio deixa."""
        self._torneio_semanais(agora_ms)
        for t in self.con.execute("SELECT id FROM torneios WHERE estado IN ('inscricoes', 'sorteado', 'andamento') "
                                  "ORDER BY inicio_ms, id").fetchall():
            self._torneio_anda(t['id'], agora_ms)

    def _torneio_entrega(self):
        """FORA da tranca: a entrega NA HORA (o juiz, pelo caminho da loja) do prêmio de quem acabou de ser pago.
        Sem o juiz o pedido fica na fila e o jogo o busca — nada se perde."""
        with self.tranca:
            pend, self._torneio_pendentes = list(getattr(self, '_torneio_pendentes', [])), []
        for cid in pend:
            try:
                with self.tranca:
                    conta = self.con.execute("SELECT * FROM contas WHERE id = ?", (cid,)).fetchone()
                if conta is not None and hasattr(self, '_loja_na_hora'):
                    self._loja_na_hora(dict(conta))
            except Exception:
                log.exception("torneio: a entrega na hora do prêmio de #%s ficou para a próxima busca", cid)

    def _torneio_semanais(self, agora_ms):
        """Os torneios da semana: um por vaga da tabela (PvP 20-25, PvP 25-30, guilda), criado assim que o
        anterior da mesma vaga acaba (ou é cancelado) — e nunca a menos de 6 dias dele."""
        for tipo, faixa, dia in SEMANAIS:
            vivo = self.con.execute(
                "SELECT 1 FROM torneios WHERE origem = 'semanal' AND tipo = ? AND faixa IS ? AND estado IN "
                "('inscricoes', 'sorteado', 'andamento')", (tipo, faixa)).fetchone()
            if vivo is not None:
                continue
            ultimo = self.con.execute("SELECT MAX(inicio_ms) FROM torneios WHERE origem = 'semanal' AND tipo = ? AND faixa IS ?",
                                      (tipo, faixa)).fetchone()[0]
            inicio = proximo_semanal(dia, agora_ms, ultimo)
            lo, hi = FAIXAS[faixa] if faixa else FAIXA_GUILDA
            self.con.execute(
                "INSERT OR IGNORE INTO torneios(tipo, faixa, nivel_min, nivel_max, titulo, origem, chave_semanal, inicio_ms, "
                "inscricao_ate_ms, estado, criado_ms) VALUES (?, ?, ?, ?, ?, 'semanal', ?, ?, ?, 'inscricoes', ?)",
                (tipo, faixa, lo, hi, titulo_padrao(tipo, faixa), '%s:%s:%d' % (tipo, faixa or '-', inicio), inicio,
                 inicio - TORNEIO_FECHA_MS, agora_ms))

    def _torneio_anda(self, tid, agora_ms):
        """Dentro de _escrita: anda UM torneio até onde o relógio deixa (cada volta faz uma coisa e relê)."""
        for _ in range(64):
            t = self._t_linha(tid)
            if t is None:
                return
            if t['estado'] == 'inscricoes':
                if agora_ms < t['inscricao_ate_ms']:
                    return
                self._torneio_fecha_inscricoes(t, agora_ms)
                continue
            if t['estado'] == 'sorteado':
                if agora_ms < t['inicio_ms']:
                    return
                self.con.execute("UPDATE torneios SET estado = 'andamento', rodada = 0, rodada_ms = ?, rodada_decidida_ms = NULL "
                                 "WHERE id = ?", (agora_ms, tid))
                self._torneio_chama(t, 0, agora_ms)
                continue
            if t['estado'] != 'andamento':
                return
            mexeu = False
            lutas = self.con.execute("SELECT * FROM torneio_lutas WHERE torneio_id = ? AND rodada = ? ORDER BY pos",
                                     (tid, t['rodada'])).fetchall()
            for l in lutas:
                if l['estado'] == 'aguarda' and l['a_id'] is not None and l['b_id'] is not None:
                    self._torneio_chama(t, t['rodada'], agora_ms)
                    mexeu = True
                    break
                if l['estado'] == 'chamada':
                    fora = {k: self._torneio_desistiu(tid, l[k + '_id']) for k in ('a', 'b')}
                    if fora['a'] or fora['b']:
                        lado = self._sorteia_lado() if fora['a'] and fora['b'] else ('b' if fora['a'] else 'a')
                        self._torneio_decide(t, l, lado, 'sorteio' if fora['a'] and fora['b'] else 'wo', agora_ms)
                    elif l['a_presente'] and l['b_presente']:
                        self._torneio_abre_luta(t, l, agora_ms)
                    elif agora_ms >= (l['prazo_ms'] or 0):
                        if l['a_presente'] or l['b_presente']:
                            self._torneio_decide(t, l, 'a' if l['a_presente'] else 'b', 'wo', agora_ms)
                        else:
                            self._torneio_decide(t, l, self._sorteia_lado(), 'sorteio', agora_ms)   # a chave não para
                    else:
                        continue
                    mexeu = True
                elif l['estado'] == 'luta' and agora_ms >= (l['luta_ms'] or 0) + TORNEIO_LUTA_MAX_MS:
                    self._torneio_decide(t, l, self._sorteia_lado(), 'sorteio', agora_ms)
                    mexeu = True
            if mexeu:
                continue
            if any(l['estado'] != 'decidida' for l in lutas):
                return
            ultima = rodadas_de(t['tamanho']) - 1
            if t['rodada'] >= ultima:
                self._torneio_encerra(t, lutas[0], agora_ms)
                return
            if t['rodada_decidida_ms'] is None:
                self.con.execute("UPDATE torneios SET rodada_decidida_ms = ? WHERE id = ?", (agora_ms, tid))
                continue
            if agora_ms < t['rodada_decidida_ms'] + TORNEIO_ENTRE_MS:
                return
            self.con.execute("UPDATE torneios SET rodada = rodada + 1, rodada_ms = ?, rodada_decidida_ms = NULL WHERE id = ?",
                             (agora_ms, tid))
            self._torneio_chama(t, t['rodada'] + 1, agora_ms)

    @staticmethod
    def _sorteia_lado():
        return secrets.choice(('a', 'b'))

    def _torneio_desistiu(self, tid, cid):
        return cid is not None and self.con.execute("SELECT 1 FROM torneio_desistentes WHERE torneio_id = ? AND conta_id = ?",
                                                    (tid, cid)).fetchone() is not None

    # -- o fechamento das inscrições e o sorteio --------------------------------------------------------------
    def _torneio_fecha_inscricoes(self, t, agora_ms):
        tid = t['id']
        if t['tipo'] == 'guilda':
            # o representante de cada guilda vira o inscrito dela (o escolhido, ou o voluntário de maior nível)
            for gid, v in self._t_representantes(tid).items():
                self.con.execute(
                    "INSERT OR REPLACE INTO torneio_inscritos(torneio_id, conta_id, herois, classes, nivel, guilda_id, desde_ms) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)", (tid, v['conta_id'], v['herois'], v['classes'], v['nivel'], gid, v['desde_ms']))
        else:
            # o nível vale no estado do SERVIDOR: quem saiu da faixa entre a inscrição e o fechamento não entra
            for i in self.con.execute("SELECT * FROM torneio_inscritos WHERE torneio_id = ?", (tid,)).fetchall():
                estado = self._estado_ler(i['conta_id'])
                herois = _json(i['herois'], [])
                nivel = _nivel_forte(estado['progress'], herois) if estado is not None else i['nivel']
                if not t['nivel_min'] <= nivel <= t['nivel_max']:
                    self.con.execute("DELETE FROM torneio_inscritos WHERE torneio_id = ? AND conta_id = ?", (tid, i['conta_id']))
                    self._evento(i['conta_id'], 'torneio-fora', {'torneio': tid, 'porque': 'nivel', 'nivel': nivel})
                elif nivel != i['nivel'] and estado is not None:
                    self.con.execute("UPDATE torneio_inscritos SET nivel = ?, classes = ? WHERE torneio_id = ? AND conta_id = ?",
                                     (nivel, json.dumps(classes_de(estado['progress'], herois)), tid, i['conta_id']))
        contas = [r['conta_id'] for r in self.con.execute(
            "SELECT conta_id FROM torneio_inscritos WHERE torneio_id = ? ORDER BY desde_ms, conta_id LIMIT ?", (tid, VAGAS_MAX))]
        if len(contas) < 2:
            self.con.execute("UPDATE torneios SET estado = 'cancelado', motivo = 'poucos', encerrado_ms = ? WHERE id = ?",
                             (agora_ms, tid))
            for c in contas:
                self._evento(c, 'torneio-cancelado', {'torneio': tid, 'porque': 'poucos'})
            log.info("torneio #%d cancelado: %d inscrito(s)", tid, len(contas))
            return
        tamanho, pares = sorteia_chave(contas)
        rodadas = rodadas_de(tamanho)
        for r in range(rodadas):
            for pos in range(tamanho >> (r + 1)):
                a, b = pares[pos] if r == 0 else (None, None)
                self.con.execute("INSERT INTO torneio_lutas(torneio_id, rodada, pos, a_id, b_id, previsto_ms) VALUES (?, ?, ?, ?, ?, ?)",
                                 (tid, r, pos, a, b, t['inicio_ms'] + r * TORNEIO_PREVISAO_MS))
        self.con.execute("UPDATE torneios SET estado = 'sorteado', tamanho = ?, rodada = 0 WHERE id = ?", (tamanho, tid))
        t = self._t_linha(tid)
        for l in self.con.execute("SELECT * FROM torneio_lutas WHERE torneio_id = ? AND rodada = 0 AND b_id IS NULL", (tid,)).fetchall():
            self._torneio_decide(t, l, 'a', 'bye', agora_ms)                 # o passe livre já passa
        for c in contas:
            self._evento(c, 'torneio-sorteado', {'torneio': tid, 'tamanho': tamanho})
        log.info("torneio #%d sorteado: %d inscritos, chave de %d", tid, len(contas), tamanho)

    # -- a chamada, a luta, a decisão ---------------------------------------------------------------------------
    def _torneio_chama(self, t, rodada, agora_ms):
        """A rodada `rodada` começa AGORA: as lutas dela são chamadas (3 min para o "estou aqui") e a previsão
        pública desta e das seguintes é corrigida."""
        tid = t['id']
        self.con.execute("UPDATE torneio_lutas SET previsto_ms = ? + (rodada - ?) * ? WHERE torneio_id = ? AND rodada >= ? "
                         "AND estado != 'decidida'", (agora_ms, rodada, TORNEIO_PREVISAO_MS, tid, rodada))
        for l in self.con.execute("SELECT * FROM torneio_lutas WHERE torneio_id = ? AND rodada = ? AND estado = 'aguarda' "
                                  "AND a_id IS NOT NULL AND b_id IS NOT NULL", (tid, rodada)).fetchall():
            self.con.execute("UPDATE torneio_lutas SET estado = 'chamada', prazo_ms = ?, a_presente = 0, b_presente = 0 "
                             "WHERE torneio_id = ? AND rodada = ? AND pos = ?", (agora_ms + TORNEIO_CHAMADA_MS, tid, rodada, l['pos']))
            for quem in (l['a_id'], l['b_id']):
                self._evento(quem, 'torneio-chamada', {'torneio': tid, 'rodada': rodada, 'pos': l['pos'],
                                                       'prazoMs': agora_ms + TORNEIO_CHAMADA_MS})

    def _torneio_abre_luta(self, t, l, agora_ms):
        """Os dois presentes: a partida nasce PRONTA na Arena (arena_partidas, com o did do torneio) — o lado A é
        o de cima da chave — e os clientes seguem o duelo de sempre pelo modo 'arena'."""
        tid = t['id']
        ins = {r['conta_id']: r for r in self.con.execute(
            "SELECT * FROM torneio_inscritos WHERE torneio_id = ? AND conta_id IN (?, ?)", (tid, l['a_id'], l['b_id']))}
        a, b = ins.get(l['a_id']), ins.get(l['b_id'])
        if a is None or b is None:                      # a conta sumiu do banco no meio: o outro passa
            self._torneio_decide(t, l, 'b' if a is None else 'a', 'wo', agora_ms)
            return
        did = 'torneio-' + secrets.token_hex(10)
        # o que os dois tinham no quadro da Arena sai da frente: a inscrição e a partida ainda por confirmar
        for quem in (l['a_id'], l['b_id']):
            self.con.execute("DELETE FROM arena_inscritos WHERE conta_id = ?", (quem,))
            for p in self.con.execute("SELECT * FROM arena_partidas WHERE (a_id = ? OR b_id = ?) AND estado = 'casada'",
                                      (quem, quem)).fetchall():
                self.con.execute("UPDATE arena_partidas SET estado = 'caiu' WHERE did = ?", (p['did'],))
                if p['a_id'] not in (l['a_id'], l['b_id']):
                    self._arena_volta_ao_quadro(p, agora_ms)
        self.con.execute(
            "INSERT INTO arena_partidas(did, a_id, b_id, a_herois, b_herois, a_classes, b_classes, a_nivel, b_nivel, "
            "a_desde_ms, a_ok, b_ok, criada_ms, prazo_ms, pronta_ms, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, 'pronta')",
            (did, l['a_id'], l['b_id'], a['herois'], b['herois'], a['classes'], b['classes'], a['nivel'], b['nivel'],
             agora_ms, agora_ms, agora_ms, agora_ms))
        self.con.execute("INSERT INTO torneio_dids(did, torneio_id, rodada, pos, revanche, criado_ms) VALUES (?, ?, ?, ?, ?, ?)",
                         (did, tid, l['rodada'], l['pos'], l['revanche'], agora_ms))
        self.con.execute("UPDATE torneio_lutas SET estado = 'luta', did = ?, luta_ms = ? WHERE torneio_id = ? AND rodada = ? AND pos = ?",
                         (did, agora_ms, tid, l['rodada'], l['pos']))
        for quem in (l['a_id'], l['b_id']):
            self._evento(quem, 'arena-pronta', {'did': did, 'torneio': tid})

    def _torneio_decide(self, t, l, lado, como, agora_ms):
        """A luta `l` está decidida: o vencedor sobe para a rodada seguinte (pos // 2; par = em cima)."""
        tid = t['id']
        venc = l[lado + '_id']
        self.con.execute("UPDATE torneio_lutas SET estado = 'decidida', vencedor = ?, como = ?, decidida_ms = ? "
                         "WHERE torneio_id = ? AND rodada = ? AND pos = ?", (lado, como, agora_ms, tid, l['rodada'], l['pos']))
        if l['did']:
            self.con.execute("UPDATE arena_partidas SET estado = 'jogada' WHERE did = ? AND estado = 'pronta'", (l['did'],))
        tamanho = t['tamanho'] or self._t_linha(tid)['tamanho']
        if l['rodada'] < rodadas_de(tamanho) - 1:
            self.con.execute("UPDATE torneio_lutas SET %s_id = ? WHERE torneio_id = ? AND rodada = ? AND pos = ?"
                             % ('a' if l['pos'] % 2 == 0 else 'b'), (venc, tid, l['rodada'] + 1, l['pos'] // 2))
        if como != 'bye':
            for k in ('a', 'b'):
                if l[k + '_id'] is not None:
                    self._evento(l[k + '_id'], 'torneio-luta', {'torneio': tid, 'rodada': l['rodada'], 'pos': l['pos'],
                                                                'venceu': k == lado, 'como': como})

    def _torneio_revanche(self, t, l, agora_ms, por=None, causa=None):
        """O duelo fechou SEM vencedor. Na primeira vez: UMA revanche (um did novo, mais 3 min de chamada); a
        revanche sem vencedor decide por sorteio. Fica na trilha quem fechou sem vencedor e por quê."""
        tid = t['id']
        if l['did']:
            self.con.execute("UPDATE arena_partidas SET estado = 'jogada' WHERE did = ? AND estado = 'pronta'", (l['did'],))
        for quem in (l['a_id'], l['b_id']):
            self._evento(quem, 'torneio-sem-vencedor', {'torneio': tid, 'rodada': l['rodada'], 'pos': l['pos'], 'did': l['did'],
                                                         'revanche': bool(l['revanche']), 'por': por, 'porque': causa})
        if l['revanche']:
            self._torneio_decide(t, l, self._sorteia_lado(), 'sorteio', agora_ms)
            return
        self.con.execute("UPDATE torneio_lutas SET estado = 'chamada', revanche = 1, did = NULL, luta_ms = NULL, a_presente = 0, "
                         "b_presente = 0, prazo_ms = ? WHERE torneio_id = ? AND rodada = ? AND pos = ?",
                         (agora_ms + TORNEIO_CHAMADA_MS, tid, l['rodada'], l['pos']))
        for quem in (l['a_id'], l['b_id']):
            self._evento(quem, 'torneio-chamada', {'torneio': tid, 'rodada': l['rodada'], 'pos': l['pos'], 'revanche': True,
                                                   'prazoMs': agora_ms + TORNEIO_CHAMADA_MS})

    # -- o fim: o campeão e o prêmio ------------------------------------------------------------------------------
    def _torneio_encerra(self, t, final, agora_ms):
        tid = t['id']
        campeao = final[(final['vencedor'] or 'a') + '_id']
        ins = self.con.execute("SELECT guilda_id FROM torneio_inscritos WHERE torneio_id = ? AND conta_id = ?",
                               (tid, campeao)).fetchone()
        gid = ins['guilda_id'] if ins is not None and t['tipo'] == 'guilda' else None
        self.con.execute("UPDATE torneios SET estado = 'encerrado', campeao_id = ?, campeao_guilda = ?, encerrado_ms = ? WHERE id = ?",
                         (campeao, gid, agora_ms, tid))
        self._torneio_paga(dict(t, campeao_id=campeao, campeao_guilda=gid), agora_ms)
        log.info("torneio #%d encerrado: campeão #%s (chave de %d)", tid, campeao, t['tamanho'])

    def _torneio_paga(self, t, agora_ms):
        """Dentro de _escrita, na mesma transação do encerramento: o prêmio do campeão pelo tamanho da chave
        SORTEADA, UMA vez (a linha em torneio_pagos é a trava; cada peça ainda leva o idem dela). As barras por
        barras_move (a ref 'torneio:<id>' é o que o extrato mostra), os vinténs e as gemas pela fila da loja."""
        tid, cid, tamanho, seg = t['id'], t['campeao_id'], t['tamanho'], agora()
        if cid is None or self.con.execute("SELECT 1 FROM torneio_pagos WHERE torneio_id = ?", (tid,)).fetchone():
            return
        premio = premio_de(t['tipo'], tamanho)
        gid = t['campeao_guilda'] if t['tipo'] == 'guilda' else None
        pedidos = []
        viva = self.con.execute("SELECT 1 FROM contas WHERE id = ?", (cid,)).fetchone() is not None
        if viva:
            try:
                self.barras_move(cid, premio['barras'], 'presente', '%s%d' % (REF_BARRAS, tid), 'torneio-%d-b' % tid, seg)
            except Recusa as e:                          # o teto do saldo: o resto do prêmio segue, e o log diz
                log.error("torneio #%d: as barras do campeão #%d não entraram — %s", tid, cid, e.erro)
            pedidos.append(self.credita(cid, SKU_VINTENS, premio['vintens'], 'presente', 'torneio-%d-v' % tid, None, seg))
            if premio['gemas'] > 0:
                cur = self.con.execute(
                    "INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, idem, criado_em) VALUES (?, ?, ?, 0, 'pendente', ?, ?)",
                    (cid, SKU_GEMAS, json.dumps({'tipo': 'pedras', 'alvo': GEMA, 'qtd': premio['gemas'], 'origem': 'torneio'}),
                     'torneio-%d-g' % tid, seg))
                pedidos.append(cur.lastrowid)
            if premio['conquista']:
                self.con.execute("INSERT OR IGNORE INTO torneio_conquistas(conta_id, tipo, torneio_id, tamanho, faixa, criado_em) "
                                 "VALUES (?, ?, ?, ?, ?, ?)", (cid, t['tipo'], tid, tamanho, t['faixa'], seg))
        nome_guilda = None
        if gid is not None:
            g = self.con.execute("SELECT nome FROM guildas WHERE id = ?", (gid,)).fetchone()
            if g is not None:
                nome_guilda = g['nome']
                self.con.execute("UPDATE guildas SET xp = xp + ? WHERE id = ?", (premio['xpGuilda'], gid))
                self.con.execute(
                    "INSERT OR IGNORE INTO torneio_guilda_titulos(torneio_id, guilda_id, conta_id, tamanho, xp, dobro_ate, titulo, "
                    "criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (tid, gid, cid, tamanho, premio['xpGuilda'], seg + TORNEIO_DOBRO_S, 1 if premio['conquista'] else 0, seg))
        self.con.execute("INSERT OR REPLACE INTO torneio_vigentes(chave, torneio_id, conta_id, guilda_id, desde) VALUES (?, ?, ?, ?, ?)",
                         ('guilda' if t['tipo'] == 'guilda' else 'pvp:%s' % t['faixa'], tid, cid, gid, seg))
        self.con.execute("INSERT INTO torneio_pagos(torneio_id, conta_id, guilda_id, tamanho, premio, pedidos, criado_em) "
                         "VALUES (?, ?, ?, ?, ?, ?, ?)", (tid, cid, gid, tamanho, json.dumps(premio), json.dumps(pedidos), seg))
        if viva:
            self._evento(cid, 'torneio-campeao', {'torneio': tid, 'tipo': t['tipo'], 'faixa': t['faixa'], 'tamanho': tamanho,
                                                  'premio': premio, 'pedidos': pedidos, 'guilda': gid})
            # a plateia: o campeão anunciado no chat de todos (o relé lê a tabela; nome da equipe não sai)
            self._plateia(cid, 'torneio', {'torneio': tid, 'tipo': t['tipo'], 'faixa': t['faixa'], 'tamanho': tamanho,
                                           'titulo': t['titulo'], 'guilda': nome_guilda})
            if not hasattr(self, '_torneio_pendentes'):
                self._torneio_pendentes = []
            self._torneio_pendentes.append(cid)

    # ================================================================================================
    #  para o duelo (grupo.py) e a Arena (arena.py)
    # ================================================================================================
    def _torneio_do_did(self, did):
        """Dentro da tranca: o id do torneio que abriu esse did (o da luta ou o da revanche), ou None."""
        try:
            r = self.con.execute("SELECT torneio_id FROM torneio_dids WHERE did = ?", (did,)).fetchone()
        except Exception:
            return None
        return r['torneio_id'] if r is not None else None

    def _torneio_luta_do_did(self, did, cid=None):
        """Dentro da tranca: a luta EM CURSO desse did (estado 'luta'), ou None — com `cid`, só se a conta luta nela."""
        try:
            l = self.con.execute("SELECT * FROM torneio_lutas WHERE did = ? AND estado = 'luta'", (did,)).fetchone()
        except Exception:
            return None
        if l is None or (cid is not None and cid not in (l['a_id'], l['b_id'])):
            return None
        return l

    def _torneio_do_duelo(self, did, a_id, b_id):
        """Dentro da tranca, para o duelo_fechar: {'id': torneio} quando esse did é a luta em curso de um torneio
        entre ESSAS duas contas; senão None. Sem teto, sem paridade, sem coroa e sem gravar a vida do fim."""
        l = self._torneio_luta_do_did(did)
        if l is None or {l['a_id'], l['b_id']} != {a_id, b_id}:
            return None
        return {'id': l['torneio_id'], 'rodada': l['rodada'], 'pos': l['pos']}

    def _torneio_resultado(self, did, a_id, b_id, resultado, por=None):
        """O GANCHO (grupo.py, _duelo_guarda — dentro de _escrita): TODO desfecho guardado de um duelo passa aqui.
        Vale como vitória só o resultado que o duelo_fechar carimbou com o id do torneio (o juiz refez os lances
        do did certo, entre as duas contas da luta, com os heróis inscritos) e que tem vencedor A ou B. O resto —
        foto, regras que mudaram, replay recusado, sem prova, empate — abre a revanche (ou sorteia, depois dela)."""
        l = self._torneio_luta_do_did(did)
        if l is None or {l['a_id'], l['b_id']} != {a_id, b_id}:
            return
        t = self._t_linha(l['torneio_id'])
        if t is None or t['estado'] != 'andamento':
            return
        agora_ms = _ms()
        venc = resultado.get('venc') if isinstance(resultado, dict) else None
        if venc in ('A', 'B') and resultado.get('torneio') == t['id'] and not resultado.get('motivo'):
            vencedor = a_id if venc == 'A' else b_id
            como = resultado.get('fim') if resultado.get('fim') in ('desistencia', 'wo') else 'luta'
            self._torneio_decide(t, l, 'a' if vencedor == l['a_id'] else 'b', como, agora_ms)
        else:
            self._torneio_revanche(t, l, agora_ms, por=por,
                                   causa=(resultado.get('motivo') or resultado.get('fase')) if isinstance(resultado, dict) else None)
        self._torneio_anda(t['id'], agora_ms)

    # ================================================================================================
    #  as rotas públicas
    # ================================================================================================
    def torneios_ler(self, conta, corpo):
        agora_ms = _ms()
        self._torneio_passo(agora_ms, leitura=True)
        with self.tranca:
            vivos = self.con.execute("SELECT * FROM torneios WHERE estado IN ('inscricoes', 'sorteado', 'andamento') "
                                     "ORDER BY (estado != 'andamento'), inicio_ms, id").fetchall()
            velhos = self.con.execute("SELECT * FROM torneios WHERE estado = 'encerrado' ORDER BY encerrado_ms DESC, id DESC LIMIT ?",
                                      (ULTIMOS_ENCERRADOS,)).fetchall()
            return 200, {'ok': True, 'agoraMs': agora_ms, 'torneios': [self._t_publico(t) for t in list(vivos) + list(velhos)]}

    def torneio_ler(self, conta, corpo):
        bruto = (corpo.get('_query') or {}).get('id')
        try:
            tid = int(bruto)
        except (TypeError, ValueError):
            raise Recusa(400, 'torneio precisa ser o id de um torneio')
        agora_ms = _ms()
        self._torneio_passo(agora_ms, leitura=True)
        with self.tranca:
            t = self._t_linha(tid)
            if t is None:
                raise Recusa(404, 'torneio não encontrado')
            return 200, {'ok': True, 'agoraMs': agora_ms, 'torneio': self._t_publico(t)}

    # ================================================================================================
    #  as rotas com conta
    # ================================================================================================
    def _t_meu(self, conta, agora_ms, tid_guilda=None):
        """Dentro da tranca: o corpo de GET /api/torneio/meu. O bloco `guilda` fala de UM torneio de guilda: o
        `tid_guilda` (o do pedido, nas rotas do voluntário e do representante, e o `?torneio=` do GET), ou o
        torneio de guilda vivo mais próximo (o da semana, quando o Mestre não marcou outro antes)."""
        cid = conta['id']
        inscricoes = [{'torneio': r['torneio_id'], 'herois': _json(r['herois'], []), 'classes': _json(r['classes'], []),
                       'nivel': r['nivel']}
                      for r in self.con.execute(
                          "SELECT i.* FROM torneio_inscritos i JOIN torneios t ON t.id = i.torneio_id "
                          "WHERE i.conta_id = ? AND t.estado IN ('inscricoes', 'sorteado', 'andamento') ORDER BY t.inicio_ms, t.id",
                          (cid,))]
        luta = None
        l = self.con.execute(
            "SELECT l.* FROM torneio_lutas l JOIN torneios t ON t.id = l.torneio_id WHERE t.estado = 'andamento' "
            "AND l.estado IN ('chamada', 'luta') AND (l.a_id = ? OR l.b_id = ?) ORDER BY t.inicio_ms, t.id LIMIT 1",
            (cid, cid)).fetchone()
        if l is not None:
            eu, ele = ('a', 'b') if l['a_id'] == cid else ('b', 'a')
            adv = self.con.execute("SELECT * FROM torneio_inscritos WHERE torneio_id = ? AND conta_id = ?",
                                   (l['torneio_id'], l[ele + '_id'])).fetchone()
            luta = {'torneio': l['torneio_id'], 'rodada': l['rodada'], 'pos': l['pos'], 'lado': eu.upper(),
                    'adversario': {'conta': l[ele + '_id'], 'nome': self._g_nomes([l[ele + '_id']]).get(l[ele + '_id'], '?'),
                                   'nivel': adv['nivel'] if adv is not None else 1,
                                   'classes': _json(adv['classes'], []) if adv is not None else []},
                    'prazoMs': l['prazo_ms'] if l['estado'] == 'chamada' else (l['luta_ms'] or agora_ms) + TORNEIO_LUTA_MAX_MS,
                    'presente': bool(l[eu + '_presente']), 'elePresente': bool(l[ele + '_presente']),
                    'revanche': bool(l['revanche'])}
            if l['estado'] == 'luta':
                luta['did'] = l['did']
        guilda = None
        g, cargo = self._g_membro(cid)
        if g is not None and not self._g_da_equipe(g):
            tg = None
            if tid_guilda is not None:
                tg = self.con.execute("SELECT * FROM torneios WHERE id = ? AND tipo = 'guilda'", (tid_guilda,)).fetchone()
            if tg is None:
                tg = self.con.execute("SELECT * FROM torneios WHERE tipo = 'guilda' AND estado IN ('inscricoes', 'sorteado', "
                                      "'andamento') ORDER BY inicio_ms, id LIMIT 1").fetchone()
            if tg is not None:
                vs = self._t_voluntarios(tg['id'], g['id'])
                nomes = self._g_nomes([v['conta_id'] for v in vs])
                if tg['estado'] == 'inscricoes':
                    esc = self.con.execute("SELECT conta_id FROM torneio_representantes WHERE torneio_id = ? AND guilda_id = ?",
                                           (tg['id'], g['id'])).fetchone()
                    rep = esc['conta_id'] if esc is not None and any(v['conta_id'] == esc['conta_id'] for v in vs) else None
                else:
                    ins = self.con.execute("SELECT conta_id FROM torneio_inscritos WHERE torneio_id = ? AND guilda_id = ?",
                                           (tg['id'], g['id'])).fetchone()
                    rep = ins['conta_id'] if ins is not None else None
                guilda = {'torneio': tg['id'],
                          'voluntarios': [{'conta': v['conta_id'], 'nome': nomes.get(v['conta_id'], '?'), 'nivel': v['nivel'],
                                           'classes': _json(v['classes'], []), 'desdeMs': v['desde_ms']} for v in vs],
                          'representante': rep, 'souVoluntario': any(v['conta_id'] == cid for v in vs),
                          'possoEscolher': cargo in ('lider', 'oficial')}
        return {'ok': True, 'agoraMs': agora_ms, 'inscricoes': inscricoes, 'luta': luta,
                'conquistas': self._torneio_conquistas(cid), 'moldura': self._torneio_tem_moldura(cid),
                'vigente': self._torneio_vigente(cid), 'guilda': guilda}

    def torneio_meu(self, conta, corpo):
        agora_ms = _ms()
        self._torneio_passo(agora_ms, leitura=True)
        bruto = (corpo.get('_query') or {}).get('torneio')
        tid_guilda = int(bruto) if isinstance(bruto, str) and bruto.isdigit() else None
        with self.tranca:
            return 200, self._t_meu(conta, agora_ms, tid_guilda)

    def _t_dupla(self, conta, corpo):
        """Dentro de _escrita: os heróis do pedido — da conta, nenhum Mestre do Fundo, os DOIS quando a conta tem
        dois que podem lutar. A vida de agora NÃO barra (a luta do torneio começa com a vida cheia).
        Devolve (herois, classes, nivel) no estado do SERVIDOR."""
        herois = _herois(corpo.get('herois'), 'herois')
        estado = self._estado_exige(conta['id'])
        self._confere_herois(conta, estado['progress'], herois)
        usaveis = herois_usaveis(estado['progress'])
        if any(h not in usaveis for h in herois):
            raise Recusa(400, 'o Mestre do Fundo não entra na Arena', motivo='mestre')
        if len(herois) < 2 and len(usaveis) >= 2:
            raise Recusa(400, 'escolha os dois heróis que vão lutar', motivo='dois')
        return herois, classes_de(estado['progress'], herois), _nivel_forte(estado['progress'], herois)

    def _t_aberto(self, t, agora_ms, tipo):
        if t['tipo'] != tipo:
            raise Recusa(400, 'este torneio é de outro tipo', motivo='tipo')
        if t['estado'] != 'inscricoes' or agora_ms >= t['inscricao_ate_ms']:
            raise Recusa(409, 'as inscrições deste torneio estão fechadas', motivo='fechado')

    def _t_faixa(self, t, nivel):
        if not t['nivel_min'] <= nivel <= t['nivel_max']:
            raise Recusa(409, 'o nível do seu herói mais forte (%d) está fora da faixa do torneio (%d a %d)'
                         % (nivel, t['nivel_min'], t['nivel_max']), motivo='nivel', nivel=nivel,
                         nivelMin=t['nivel_min'], nivelMax=t['nivel_max'])

    # -- POST /api/torneio/inscrever {torneio, herois} --------------------------------------------------------
    def torneio_inscrever(self, conta, corpo):
        cid, agora_ms = conta['id'], _ms()
        if conta['gm']:
            raise Recusa(403, 'a conta do Mestre não entra no torneio', motivo='mestre')
        if not self._autoridade_ligada():
            raise Recusa(503, 'o juiz do servidor não está configurado: a Arena ranqueada não abre')
        self._torneio_passo(agora_ms)
        with self._escrita():
            t = self._t_exige(corpo)
            self._t_aberto(t, agora_ms, 'pvp')
            herois, classes, nivel = self._t_dupla(conta, corpo)
            self._arena_limite(cid)
            self._t_faixa(t, nivel)
            # uma conta, uma chave por dia de torneio (o nível 25 escolhe UMA das duas do sábado)
            dia = dia_de(t['inicio_ms'] // 1000)
            for o in self.con.execute(
                    "SELECT t.id, t.inicio_ms FROM torneio_inscritos i JOIN torneios t ON t.id = i.torneio_id "
                    "WHERE i.conta_id = ? AND t.id != ? AND t.tipo = 'pvp' AND t.estado IN ('inscricoes', 'sorteado', 'andamento')",
                    (cid, t['id'])).fetchall():
                if dia_de(o['inicio_ms'] // 1000) == dia:
                    raise Recusa(409, 'você já está em outra chave do torneio deste dia', motivo='outra-chave', torneio=o['id'])
            antes = self.con.execute("SELECT desde_ms FROM torneio_inscritos WHERE torneio_id = ? AND conta_id = ?",
                                     (t['id'], cid)).fetchone()
            if antes is None:
                n = self.con.execute("SELECT COUNT(*) FROM torneio_inscritos WHERE torneio_id = ?", (t['id'],)).fetchone()[0]
                if n >= VAGAS_MAX:
                    raise Recusa(409, 'o torneio está cheio', motivo='cheio')
            self.con.execute(
                "INSERT OR REPLACE INTO torneio_inscritos(torneio_id, conta_id, herois, classes, nivel, guilda_id, desde_ms) "
                "VALUES (?, ?, ?, ?, ?, NULL, ?)",
                (t['id'], cid, json.dumps(herois), json.dumps(classes), nivel, antes['desde_ms'] if antes is not None else agora_ms))
            if antes is None:
                self._evento(cid, 'torneio-inscrito', {'torneio': t['id'], 'herois': herois, 'nivel': nivel})
            return 200, {'ok': True, 'torneio': self._t_publico(self._t_linha(t['id']))}

    # -- POST /api/torneio/sair {torneio} ---------------------------------------------------------------------
    def torneio_sair(self, conta, corpo):
        """Até o fechamento, a inscrição sai. Depois é DESISTÊNCIA: a luta em curso (ou a chamada) vai para o
        adversário por W.O., e toda luta que a conta ainda tivesse também."""
        cid, agora_ms = conta['id'], _ms()
        self._torneio_passo(agora_ms)
        with self._escrita():
            t = self._t_exige(corpo)
            if t['estado'] == 'inscricoes':
                if t['tipo'] != 'pvp':
                    raise Recusa(400, 'este torneio é de outro tipo', motivo='tipo')
                n = self.con.execute("DELETE FROM torneio_inscritos WHERE torneio_id = ? AND conta_id = ?", (t['id'], cid)).rowcount
                if not n:
                    raise Recusa(409, 'você não está inscrito neste torneio', motivo='sem-inscricao')
                self._evento(cid, 'torneio-saiu', {'torneio': t['id']})
            elif t['estado'] in ('sorteado', 'andamento'):
                if not self.con.execute("SELECT 1 FROM torneio_inscritos WHERE torneio_id = ? AND conta_id = ?",
                                        (t['id'], cid)).fetchone():
                    raise Recusa(409, 'você não está inscrito neste torneio', motivo='sem-inscricao')
                self.con.execute("INSERT OR IGNORE INTO torneio_desistentes(torneio_id, conta_id, em_ms) VALUES (?, ?, ?)",
                                 (t['id'], cid, agora_ms))
                l = self.con.execute("SELECT * FROM torneio_lutas WHERE torneio_id = ? AND estado IN ('chamada', 'luta') "
                                     "AND (a_id = ? OR b_id = ?)", (t['id'], cid, cid)).fetchone()
                if l is not None:
                    self._torneio_decide(t, l, 'b' if l['a_id'] == cid else 'a', 'wo', agora_ms)
                self._evento(cid, 'torneio-desistiu', {'torneio': t['id']})
                self._torneio_anda(t['id'], agora_ms)
            else:
                raise Recusa(409, 'as inscrições deste torneio estão fechadas', motivo='fechado')
            resposta = {'ok': True, 'torneio': self._t_publico(self._t_linha(t['id']))}
        self._torneio_entrega()
        return 200, resposta

    # -- POST /api/torneio/presente {torneio} -----------------------------------------------------------------
    def torneio_presente(self, conta, corpo):
        """"Estou aqui": vale na chamada em curso da conta, dentro do prazo. Os dois presentes = a partida pronta
        na hora. Fora de chamada não é erro: devolve o corpo de /api/torneio/meu como está."""
        cid, agora_ms = conta['id'], _ms()
        self._torneio_passo(agora_ms)
        with self._escrita():
            t = self._t_exige(corpo)
            l = self.con.execute("SELECT * FROM torneio_lutas WHERE torneio_id = ? AND estado = 'chamada' AND (a_id = ? OR b_id = ?)",
                                 (t['id'], cid, cid)).fetchone()
            if l is not None and t['estado'] == 'andamento' and agora_ms < (l['prazo_ms'] or 0):
                self.con.execute("UPDATE torneio_lutas SET %s_presente = 1 WHERE torneio_id = ? AND rodada = ? AND pos = ?"
                                 % ('a' if l['a_id'] == cid else 'b'), (t['id'], l['rodada'], l['pos']))
                self._torneio_anda(t['id'], agora_ms)
            resposta = self._t_meu(conta, agora_ms)
        self._torneio_entrega()
        return 200, resposta

    # -- o torneio de guilda: voluntariar, desvoluntariar, representante --------------------------------------
    def _t_resposta_guilda(self, conta, t, agora_ms):
        return dict(self._t_meu(conta, agora_ms, t['id']), torneio=self._t_publico(self._t_linha(t['id'])))

    def torneio_voluntariar(self, conta, corpo):
        cid, agora_ms = conta['id'], _ms()
        if conta['gm']:
            raise Recusa(403, 'a conta do Mestre não entra no torneio', motivo='mestre')
        if not self._autoridade_ligada():
            raise Recusa(503, 'o juiz do servidor não está configurado: a Arena ranqueada não abre')
        self._torneio_passo(agora_ms)
        with self._escrita():
            t = self._t_exige(corpo)
            self._t_aberto(t, agora_ms, 'guilda')
            g, _cargo = self._g_membro(cid)
            if g is None:
                raise Recusa(409, 'entre numa guilda para se voluntariar', motivo='sem-guilda')
            if self._g_da_equipe(g):
                raise Recusa(403, 'a guilda da equipe não entra no torneio', motivo='equipe')
            herois, classes, nivel = self._t_dupla(conta, corpo)
            self._arena_limite(cid)
            self._t_faixa(t, nivel)
            antes = self.con.execute("SELECT desde_ms, guilda_id FROM torneio_voluntarios WHERE torneio_id = ? AND conta_id = ?",
                                     (t['id'], cid)).fetchone()
            reps = self._t_representantes(t['id'])
            if g['id'] not in reps and len(reps) >= VAGAS_MAX:      # uma vaga por guilda: a 17ª não entra
                raise Recusa(409, 'o torneio está cheio', motivo='cheio')
            mesmo = antes is not None and antes['guilda_id'] == g['id']
            self.con.execute(
                "INSERT OR REPLACE INTO torneio_voluntarios(torneio_id, conta_id, guilda_id, herois, classes, nivel, desde_ms) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (t['id'], cid, g['id'], json.dumps(herois), json.dumps(classes), nivel, antes['desde_ms'] if mesmo else agora_ms))
            if not mesmo:
                self._evento(cid, 'torneio-voluntario', {'torneio': t['id'], 'guilda': g['id'], 'herois': herois, 'nivel': nivel})
            return 200, self._t_resposta_guilda(conta, t, agora_ms)

    def torneio_desvoluntariar(self, conta, corpo):
        cid, agora_ms = conta['id'], _ms()
        self._torneio_passo(agora_ms)
        with self._escrita():
            t = self._t_exige(corpo)
            self._t_aberto(t, agora_ms, 'guilda')
            self.con.execute("DELETE FROM torneio_voluntarios WHERE torneio_id = ? AND conta_id = ?", (t['id'], cid))
            self.con.execute("DELETE FROM torneio_representantes WHERE torneio_id = ? AND conta_id = ?", (t['id'], cid))
            return 200, self._t_resposta_guilda(conta, t, agora_ms)

    def torneio_representante(self, conta, corpo):
        """O líder ou um oficial escolhe o representante entre os voluntários da guilda (`conta: null` desfaz)."""
        cid, agora_ms = conta['id'], _ms()
        alvo = corpo.get('conta')
        if alvo is not None and (isinstance(alvo, bool) or not isinstance(alvo, int) or alvo < 1):
            raise Recusa(400, 'conta precisa ser a conta de um voluntário, ou null')
        self._torneio_passo(agora_ms)
        with self._escrita():
            t = self._t_exige(corpo)
            self._t_aberto(t, agora_ms, 'guilda')
            g, cargo = self._g_membro(cid)
            if g is None:
                raise Recusa(409, 'entre numa guilda para se voluntariar', motivo='sem-guilda')
            if cargo not in ('lider', 'oficial'):
                raise Recusa(403, 'só o líder ou um oficial escolhe o representante', motivo='cargo')
            if alvo is None:
                self.con.execute("DELETE FROM torneio_representantes WHERE torneio_id = ? AND guilda_id = ?", (t['id'], g['id']))
            else:
                if not any(v['conta_id'] == alvo for v in self._t_voluntarios(t['id'], g['id'])):
                    raise Recusa(409, 'essa conta não se voluntariou pela sua guilda', motivo='sem-voluntario')
                self.con.execute("INSERT OR REPLACE INTO torneio_representantes(torneio_id, guilda_id, conta_id, por_id, em_ms) "
                                 "VALUES (?, ?, ?, ?, ?)", (t['id'], g['id'], alvo, cid, agora_ms))
                self._evento(alvo, 'torneio-representante', {'torneio': t['id'], 'guilda': g['id'], 'por': cid})
            return 200, self._t_resposta_guilda(conta, t, agora_ms)

    # ================================================================================================
    #  as rotas do Mestre
    # ================================================================================================
    def _t_do_mestre(self, t):
        """O `T` como o Mestre o vê: o público, mais o porquê do cancelamento ('poucos' | 'mestre' | None)."""
        fora = self._t_publico(t)
        fora['motivo'] = t['motivo']
        return fora

    def mestre_torneios(self, conta, corpo):
        agora_ms = _ms()
        self._torneio_passo(agora_ms, leitura=True)
        with self.tranca:
            linhas = self.con.execute("SELECT * FROM torneios ORDER BY inicio_ms DESC, id DESC LIMIT 100").fetchall()
            return 200, {'ok': True, 'agoraMs': agora_ms, 'torneios': [self._t_do_mestre(t) for t in linhas]}

    def mestre_torneio_marcar(self, conta, corpo):
        tipo, faixa, inicio, titulo = corpo.get('tipo'), corpo.get('faixa'), corpo.get('inicioMs'), corpo.get('titulo')
        if tipo not in ('pvp', 'guilda'):
            raise Recusa(400, 'tipo precisa ser pvp ou guilda')
        if tipo == 'pvp':
            if faixa not in FAIXAS:
                raise Recusa(400, 'faixa precisa ser 20-25 ou 25-30')
            lo, hi = FAIXAS[faixa]
        else:
            faixa = None
            lo, hi = FAIXA_GUILDA
        agora_ms = _ms()
        if (isinstance(inicio, bool) or not isinstance(inicio, int) or inicio - TORNEIO_FECHA_MS <= agora_ms
                or inicio > agora_ms + TORNEIO_ANTECEDENCIA_MS):
            raise Recusa(400, 'inicioMs precisa ser um instante futuro, depois do fechamento das inscrições')
        if titulo is None or (isinstance(titulo, str) and not titulo.strip()):
            titulo = titulo_padrao(tipo, faixa)
        if not isinstance(titulo, str) or not TITULO_LIMITES[0] <= len(titulo.strip()) <= TITULO_LIMITES[1] or '\n' in titulo:
            raise Recusa(400, 'o título precisa ter de 3 a 60 caracteres')
        self._torneio_passo(agora_ms)
        with self._escrita():
            n = self.con.execute("SELECT COUNT(*) FROM torneios WHERE origem = 'mestre' AND estado IN ('inscricoes', 'sorteado', 'andamento')"
                                 ).fetchone()[0]
            if n >= TORNEIO_MARCADOS_MAX:
                raise Recusa(409, 'torneios marcados demais: cancele um antes de marcar outro')
            cur = self.con.execute(
                "INSERT INTO torneios(tipo, faixa, nivel_min, nivel_max, titulo, origem, inicio_ms, inscricao_ate_ms, estado, "
                "criado_por, criado_ms) VALUES (?, ?, ?, ?, ?, 'mestre', ?, ?, 'inscricoes', ?, ?)",
                (tipo, faixa, lo, hi, titulo.strip(), inicio, inicio - TORNEIO_FECHA_MS, conta['id'], agora_ms))
            self._evento(conta['id'], 'torneio-marcado', {'torneio': cur.lastrowid, 'tipo': tipo, 'faixa': faixa, 'inicioMs': inicio})
            return 200, {'ok': True, 'torneio': self._t_publico(self._t_linha(cur.lastrowid))}

    def mestre_torneio_cancelar(self, conta, corpo):
        agora_ms = _ms()
        self._torneio_passo(agora_ms)
        with self._escrita():
            t = self._t_exige(corpo)
            if t['estado'] not in ('inscricoes', 'sorteado'):
                raise Recusa(409, 'esse torneio já começou ou acabou: não dá para cancelar')
            self.con.execute("UPDATE torneios SET estado = 'cancelado', motivo = 'mestre', encerrado_ms = ? WHERE id = ?",
                             (agora_ms, t['id']))
            for r in self.con.execute("SELECT conta_id FROM torneio_inscritos WHERE torneio_id = ?", (t['id'],)).fetchall():
                self._evento(r['conta_id'], 'torneio-cancelado', {'torneio': t['id'], 'porque': 'mestre'})
            self._evento(conta['id'], 'torneio-cancelou', {'torneio': t['id']})
            t = self._t_linha(t['id'])
            return 200, {'ok': True, 'torneio': self._t_do_mestre(t)}


def liga_torneios(api, intervalo=None):
    """O laço do relógio do torneio, numa thread do próprio servidor (não há agendador no contêiner): a cada
    TORNEIO_PASSO_S segundos, um `_torneio_passo`. Erro só vai para o log: a volta seguinte tenta de novo."""
    intervalo = TORNEIO_PASSO_S if intervalo is None else intervalo
    if not intervalo or intervalo <= 0:
        return None

    def volta():
        while True:
            time.sleep(intervalo)
            try:
                api._torneio_passo()
            except Exception:
                log.exception("torneio: o laço do relógio quebrou")

    th = threading.Thread(target=volta, name='torneio-relogio', daemon=True)
    th.start()
    return th


__all__ = ['ESQUEMA_TORNEIO', 'ROTAS_TORNEIO', 'ROTAS_TORNEIO_MESTRE', 'TorneioMixin', 'liga_torneios', 'PREMIOS',
           'MOLDURA_ARENA', 'MOLDURA_ARENA_NOME', 'grau_da_moldura', 'sorteia_chave', 'vagas_de', 'tamanho_de',
           'proximo_semanal', 'premio_de']
