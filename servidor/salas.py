#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A AUTORIDADE: o servidor manda na economia e confere a batalha (13/09).

A lei é docs/SEGURANCA.md (§3, §4, §5 e §8). Entra no cartório como mixin
(`class Api(..., SalasMixin)` no api.py), com a mesma conexão e a mesma tranca.
Importa só de comum.py (a armadilha do __main__: ver o topo de lá).

O QUE MORA AQUI:
  POST /api/sala/abrir   o bilhete de uma sala: a semente é do servidor
  POST /api/sala/fechar  o juiz refaz a sala dos lances e, se venceu, paga no
                         estado que o SERVIDOR guarda (saves), numa transação só
  GET  /api/vida         14/09, a vida única: a vida de agora dos heróis feridos da conta
  POST /api/vida/pocao   a poção fora da batalha, em qualquer lugar (as rotas de antes caem aqui)
  POST /api/op           as operações de economia (equipar, forjar, roleta…)
                         rodadas pelo juiz no estado do servidor
  o PUT /api/save cosmético (o salvar do api.py chama _salvar_cosmetico) e as
  peças que a loja, a troca e a guilda usam: ler o estado, pedir ao juiz fora
  da tranca e gravar conferindo que ninguém mexeu no meio.

AUTORIDADE LIGADA = a API subiu com --juiz. Sem juiz configurado (em casa, as
provas antigas) o cartório segue o de antes — o save do cliente vale inteiro —,
e as rotas daqui respondem 503. É uma escolha do SERVIDOR (linha de comando),
nunca do cliente; o boot avisa no journal quando está desligada.

POR QUE O JUIZ É CHAMADO FORA DA TRANCA: refazer uma sala leva centenas de
milissegundos, e a tranca serializa a API inteira. O estado é lido (com a
versão), o juiz trabalha, e a gravação confere, já com BEGIN IMMEDIATE, se a
economia continua a mesma que foi lida (_estado_confere). Um PUT cosmético no
meio não conta (só mexe no nome, no placar…); qualquer outra mudança levanta
EstadoMudou, e quem chamou refaz (a sala: a mesma semente dá a mesma sala) ou
devolve 409 com o estado para o cliente adotar (a op).
"""
import json
import logging
import os
import re
import secrets
import sqlite3                    # 14/09: o _juiz_op pega sqlite3.Error e o nome não estava importado
import time

from guilda import soma_contrib   # 13/09: o XP doado por membro (a grade da guilda)

from comum import (ORIGENS, EstadoMudou, Recusa, agora, classe_do_heroi, iid_valido, inteiro, liberadas,
                   limita)

log = logging.getLogger('api')


def _do_ambiente(nome, padrao, tipo):
    """Um número do ambiente do servidor (as provas afrouxam as réguas por aqui);
    ausente ou torto, o padrão. Lido uma vez, no boot."""
    v = os.environ.get(nome)
    if v is None or v.strip() == '':
        return padrao
    try:
        n = tipo(v)
    except ValueError:
        return padrao
    return n if n >= 0 else padrao


# ---- as réguas ------------------------------------------------------------------------
SALAS_POR_HORA = _do_ambiente('SOTERRA_SALAS_POR_HORA', 240, int)     # bilhetes abertos por conta, por hora
SALA_MIN_S = _do_ambiente('SOTERRA_SALA_MIN_S', 4.0, float)           # nenhuma sala fecha em menos que isto...
SALA_S_POR_TURNO = _do_ambiente('SOTERRA_SALA_S_POR_TURNO', 0.35, float)   # ...nem em menos que isto por vez do jogador
SALA_VALIDADE = 6 * 3600          # o bilhete aberto vale 6 h
# 15/09, A LUTA LARGADA: a luta que a conta deixou aberta no servidor e abandonou há mais que isto não zera ninguém
# (a vida já teria voltado inteira pela espera; e a sala em grupo cuja ata falhou com a aba de quem lidera fechada não
# pune o parceiro para sempre) — só fica 'fechada'
LARGADA_JANELA_MS = 2 * 3600 * 1000
# 13/09 (dono): "carrega 1 pv a cada 2 segundos" — contado de quando a luta fechou. O MESMO número de
# js/core/data/consumiveis.js (DATA.vidaEntreSalas.msPorPv). 14/09: a vida é única por herói da conta
# (vida_heroi) e a janela de 2 h da descida (CARRY_JANELA) saiu — a vida enche sozinha, sem prazo
VIDA_MS_POR_PV = 2000
REGRAS_CACHE = 300                # segundos que o GET /regras do juiz fica guardado (muda só no deploy)
OPS_POR_PEDIDO = 40               # o OPS_MAX do juiz (servidor/juiz/economia.js)
OPS_POR_MINUTO = 600
LANCES_MAX = 6000                 # o LANCES_MAX do juiz (servidor/juiz/sala.js)
TENTATIVAS = 3                    # quantas vezes refazer quando o estado muda no meio
DIFICULDADES = ('facil', 'normal', 'dificil')
# as ops que só o servidor pede (o juiz também exige contexto.interno): a loja, a troca e o banco da guilda
OPS_INTERNAS = frozenset({'lojaEntregar', 'trocaTira', 'trocaPoe', 'bancoGuildaTira', 'bancoGuildaPoe',
                          # 04/10: a devolução forçada do empréstimo (guilda.py: conta excluída ou ausente)
                          'bancoGuildaRecolhe',
                          # 13/09: o mercadinho entre contas (mercado.py)
                          'mercadoTira', 'mercadoPoe', 'mercadoPaga', 'mercadoRecebe', 'mercadoLegadoTira',
                          # 22/09: o lote de pedras de forja no mercadinho (mercado.py)
                          'mercadoTiraPedras', 'mercadoPoePedras',
                          # 13/09: a poção bebida fora da batalha (14/09: vida_pocao, em qualquer lugar)
                          'beberPocao',
                          # 02/10: o "pôr no inventário" do painel do Mestre no jogo (moderacao.py, /api/mestre/dar)
                          'mestreDarItem', 'mestreDarSelos',
                          # 03/10: o painel único do Mestre entrega de tudo a qualquer conta
                          'mestreDarSet', 'mestreDarPet', 'mestreDarPedras', 'mestreDarInsignias', 'mestreDarCartas',
                          'mestreDarPergaminho', 'mestreDarBonusXp'})
# os campos de dono CLIENTE do db (§3; a mesma lista de js/core/economia.js: DB_CLIENTE e JOGADOR_CLIENTE)
DB_CLIENTE = ('mutados', 'placar', 'pvp', 'trocas')
JOGADOR_CLIENTE = ('id', 'nome', 'avatar', 'dupla', 'coroaOculta', 'criadoEm')
RE_NOME_OP = re.compile(r'^[A-Za-z][A-Za-z0-9_]{0,63}$')
RE_BILHETE = re.compile(r'^[A-Za-z0-9_-]{16,64}$')
RE_CALABOUCO = re.compile(r'^[A-Za-z0-9_-]{1,40}$')
RE_PET = re.compile(r'^[A-Za-z0-9_#:-]{1,64}$')
TROCA_PETS_MAX = 6                # o teto do juiz (trocaTira)
MOEDAS_TETO = 10 ** 12
SEM_ESTADO = ('o servidor ainda não tem o estado desta conta: abra o jogo logado nela e deixe salvar uma vez')
MUDOU_NO_MEIO = 'o estado da conta mudou no meio — adote o do servidor e tente de novo'

ESQUEMA_SALAS = """
-- os bilhetes das salas (13/09, docs/SEGURANCA.md §4.1). Tabelas NOVAS, nunca ALTER: no
-- rolling update do Coolify o contêiner velho e o novo sobem juntos no mesmo banco
CREATE TABLE IF NOT EXISTS salas(
  bilhete      TEXT PRIMARY KEY,
  conta_id     INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  dungeon      TEXT NOT NULL,
  sala         INTEGER NOT NULL,
  dificuldade  TEXT NOT NULL,
  semente      INTEGER NOT NULL,
  herois       TEXT NOT NULL,
  carry        TEXT,
  aberta_em    INTEGER NOT NULL,
  fechada_em   INTEGER,
  estado       TEXT NOT NULL DEFAULT 'aberta'
    CHECK (estado IN ('aberta', 'paga', 'perdida', 'recusada', 'vencida')),
  turnos       INTEGER,
  carry_saida  TEXT
);
CREATE INDEX IF NOT EXISTS salas_conta ON salas(conta_id, aberta_em);
CREATE INDEX IF NOT EXISTS salas_estado ON salas(conta_id, estado);
-- A VERSÃO DAS REGRAS DO BILHETE (19/09, docs/SEGURANCA.md §4.1). Tabela nova (nunca ALTER): o
-- número que o juiz anunciou ao abrir (Engine.VERSAO_REGRAS, GET /regras) e o hash dos dados dele.
-- Ao fechar, o juiz confere o número contra o seu: um deploy que mudou uma regra no meio da sala
-- vence o bilhete ('regras-mudaram') em vez de recusar o jogador honesto como fraude ('divergiu')
CREATE TABLE IF NOT EXISTS salas_regras(
  bilhete   TEXT PRIMARY KEY REFERENCES salas(bilhete) ON DELETE CASCADE,
  regras    INTEGER NOT NULL,
  versao    TEXT
);
-- A VIDA ENTRE AS SALAS (13/09, pedido do dono: "quando acaba a luta o jogador fica com a vida que
-- terminou a última luta.. carrega 1 pv a cada 2 segundos"). Uma linha por herói da sala VENCIDA
-- (a solo pelo bilhete, a em grupo pelo gid, em `ref`), com a chave do carry (heroId, ou dono:heroId
-- em grupo), a conta dona do herói, o PV do fim e o máximo, o instante do fechamento em ms e a soma
-- das poções bebidas na sala de espera. A sala seguinte nasce com min(máximo, fim + tempo/2 s + cura)
CREATE TABLE IF NOT EXISTS vida_espera(
  ref        TEXT NOT NULL,
  chave      TEXT NOT NULL,
  conta_id   INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  hp_fim     INTEGER NOT NULL,
  hp_max     INTEGER NOT NULL,
  fechou_ms  INTEGER NOT NULL,
  cura       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ref, chave)
);
CREATE INDEX IF NOT EXISTS vida_espera_conta ON vida_espera(conta_id, fechou_ms);
-- 14/09: vida_espera fica criada (o contêiner velho do rolling update ainda escreve nela) e deixou de ser lida.
-- A VIDA ÚNICA DO HERÓI (14/09, o dono: "isso vale para quando terminar calabouço (na praça), depois de um
-- pvp e assim por diante"): UMA linha por herói da conta, gravada no fim de QUALQUER luta refeita pelo juiz
-- (sala solo, em grupo, duelo; vitória, derrota ou largada). PV agora = min(hp_max, hp_fim + cura +
-- floor((agora − desde_ms) / 2000)). Sem linha, ou já no máximo = cheio (o motor dá o PV máximo de hoje)
CREATE TABLE IF NOT EXISTS vida_heroi(
  conta_id   INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  heroi      TEXT NOT NULL,
  hp_fim     INTEGER NOT NULL,
  hp_max     INTEGER NOT NULL,
  desde_ms   INTEGER NOT NULL,
  cura       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conta_id, heroi)
);
-- o último hash da economia que o juiz devolveu para a conta (o cliente compara com o dele)
CREATE TABLE IF NOT EXISTS autoridade(
  conta_id      INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  hash          TEXT,
  atualizado_em INTEGER NOT NULL
);
-- 15/09, AS FALHAS CONHECIDAS (o dono: "arrume as falhas conhecidas" — fechar a aba no meio de uma derrota fugia da vida
-- zerada): a LUTA ABERTA de cada conta, uma linha por conta (a sala solo pelo bilhete, a em grupo pelo gid, com os
-- heróis DELA). 'aberta' até a luta fechar; quem abre outra luta com uma dela ainda aberta no servidor LARGOU a de
-- antes ('largada': os heróis dela a 0 desde agora); 'registro' = a conta fechou a parte dela na sala em grupo pelo
-- registro que o jogo guardou (a vida do ponto em que o replay parou). O bilhete de antes do deploy não tem linha:
-- nunca é largado. Tabela NOVA, nunca ALTER (a coluna estado de salas tem CHECK e não aceitaria 'largada')
CREATE TABLE IF NOT EXISTS luta_aberta(
  tipo       TEXT NOT NULL CHECK (tipo IN ('sala', 'grupo')),
  ref        TEXT NOT NULL,
  conta_id   INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  herois     TEXT NOT NULL,
  aberta_ms  INTEGER NOT NULL,
  estado     TEXT NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta', 'fechada', 'registro', 'largada')),
  PRIMARY KEY (tipo, ref, conta_id)
);
CREATE INDEX IF NOT EXISTS luta_aberta_conta ON luta_aberta(conta_id, estado);
"""


# ---- miudezas puras -------------------------------------------------------------------
def _objeto(texto):
    try:
        v = json.loads(texto) if texto else None
    except (TypeError, ValueError):
        return None
    return v if isinstance(v, dict) else None


def _lista(texto):
    try:
        v = json.loads(texto) if texto else None
    except (TypeError, ValueError):
        return []
    return v if isinstance(v, list) else []


def _copia(v):
    return json.loads(json.dumps(v))


def sem_cosmetico(db):
    """O db sem os campos de dono cliente: o que se compara para saber se a
    ECONOMIA mudou (um PUT cosmético no meio de uma op não conta)."""
    d = dict(db) if isinstance(db, dict) else {}
    for k in DB_CLIENTE:
        d.pop(k, None)
    jog = d.get('jogador')
    if isinstance(jog, dict):
        d['jogador'] = {k: v for k, v in jog.items() if k not in JOGADOR_CLIENTE}
    return d


def junta_cosmetico(db_servidor, db_cliente):
    """O db do servidor com os campos cosméticos do outro por cima — o
    Economia.junta do js/core/economia.js. Só entra o que o outro TEM."""
    s = _copia(db_servidor) if isinstance(db_servidor, dict) else {}
    c = db_cliente if isinstance(db_cliente, dict) else {}
    for k in DB_CLIENTE:
        if k in c:
            s[k] = _copia(c[k])
    if isinstance(c.get('jogador'), dict):
        if not isinstance(s.get('jogador'), dict):
            s['jogador'] = {}
        for k in JOGADOR_CLIENTE:
            if k in c['jogador']:
                s['jogador'][k] = _copia(c['jogador'][k])
    return s


def _inteiro_puro(v):
    return isinstance(v, int) and not isinstance(v, bool)


def vida_da_linha(r, agora_ms):
    """A vida de AGORA de uma linha de vida_heroi (14/09): {hp, max, cheioEmMs, ate1Ms}.
    hp = min(máximo, PV do fim + curas + floor((agora − desde) / VIDA_MS_POR_PV)); cheioEmMs e ate1Ms
    são quanto falta, em ms a partir de agora, para encher e para ter 1 PV (0 = já chegou)."""
    mx = max(1, int(r['hp_max']))
    base = max(0, int(r['hp_fim'])) + max(0, int(r['cura']))
    desde = int(r['desde_ms'])
    hp = min(mx, base + max(0, agora_ms - desde) // VIDA_MS_POR_PV)
    return {'hp': hp, 'max': mx,
            'cheioEmMs': max(0, desde + max(0, mx - base) * VIDA_MS_POR_PV - agora_ms),
            'ate1Ms': 0 if base >= 1 else max(0, desde + VIDA_MS_POR_PV - agora_ms)}


def lado_da_troca(v, campo):
    """Um lado da intenção de troca: a lista de iids (o formato antigo: só peças)
    ou {iids, pets, moedas}. Devolve {'iids': [...], 'pets': [...], 'moedas': n}."""
    if v is None or isinstance(v, list):
        bruto = {'iids': v}
    elif isinstance(v, dict):
        bruto = v
    else:
        raise Recusa(400, '%s precisa ser uma lista de iids ou {iids, pets, moedas}' % campo)
    iids = bruto.get('iids')
    if iids is None:
        iids = []
    if not isinstance(iids, list) or len(iids) > 50:
        raise Recusa(400, '%s precisa ser uma lista de até 50 iids' % campo)
    lista = []
    for iid in iids:
        if not iid_valido(iid):
            raise Recusa(400, 'iid inválido em %s' % campo)
        if iid not in lista:
            lista.append(iid)
    pets = bruto.get('pets')
    if pets is None:
        pets = []
    if not isinstance(pets, list) or len(pets) > TROCA_PETS_MAX:
        raise Recusa(400, '%s.pets precisa ser uma lista de até %d bichos' % (campo, TROCA_PETS_MAX))
    bichos = []
    for p in pets:
        if not isinstance(p, str) or not RE_PET.match(p):
            raise Recusa(400, 'bicho inválido em %s' % campo)
        if p not in bichos:
            bichos.append(p)
    moedas = bruto.get('moedas')
    if moedas is None:
        moedas = 0
    if not _inteiro_puro(moedas) or not 0 <= moedas <= MOEDAS_TETO:
        raise Recusa(400, '%s.moedas precisa ser um inteiro de 0 a %d' % (campo, MOEDAS_TETO))
    return {'iids': lista, 'pets': bichos, 'moedas': moedas}


def chave_do_lado(lado):
    return (frozenset(lado['iids']), frozenset(lado['pets']), lado['moedas'])


def lado_vazio(lado):
    return not lado['iids'] and not lado['pets'] and not lado['moedas']


# ---- o mixin --------------------------------------------------------------------------------
class SalasMixin:

    # -- a autoridade e o estado da conta ---------------------------------------------------
    def _autoridade_ligada(self):
        juiz = getattr(self, 'juiz', None)
        return bool(juiz is not None and juiz.ligado())

    def _estado_ler(self, cid):
        """Dentro da tranca: o estado econômico que o servidor guarda, ou None se a
        conta ainda não tem progress (nunca salvou, ou o save está torto)."""
        r = self.con.execute(
            "SELECT s.versao, s.progress, s.db, a.hash FROM saves s LEFT JOIN autoridade a ON a.conta_id = s.conta_id "
            "WHERE s.conta_id = ?", (cid,)).fetchone()
        if r is None or not r['progress']:
            return None
        progress = _objeto(r['progress'])
        if progress is None:
            return None
        return {'versao': r['versao'], 'progress': progress, 'db': _objeto(r['db']) or {}, 'hash': r['hash'],
                'progress_txt': r['progress']}

    def _estado_exige(self, cid):
        estado = self._estado_ler(cid)
        if estado is None:
            raise Recusa(409, SEM_ESTADO)
        return estado

    def _estado_confere(self, cid, lido):
        """Dentro de _escrita: o estado de agora, se a ECONOMIA é a mesma que foi lida
        (a versão igual, ou só o cosmético mudou por um PUT); senão EstadoMudou."""
        atual = self._estado_ler(cid)
        if atual is None:
            raise EstadoMudou()
        if atual['versao'] == lido['versao']:
            return atual
        if atual['progress_txt'] == lido['progress_txt'] and sem_cosmetico(atual['db']) == sem_cosmetico(lido['db']):
            return atual
        raise EstadoMudou()

    def _estado_publico(self, cid):
        """Para o 409 que manda o cliente adotar: {versao, hash, progress, db}."""
        with self.tranca:
            e = self._estado_ler(cid)
            if e is None:
                r = self.con.execute("SELECT versao FROM saves WHERE conta_id = ?", (cid,)).fetchone()
                return {'versao': r['versao'] if r else 0, 'hash': None, 'progress': None, 'db': None}
        return {'versao': e['versao'], 'hash': e['hash'], 'progress': e['progress'], 'db': e['db']}

    def _posicoes(self, cid):
        """Dentro da tranca: (pvm, pvp) = a posição da conta (1 a 3, ou None) no ranking
        público — a mesma ordem do GET /api/ranking, sem banidas nem a equipe. O título
        do pódio (definirTitulo no juiz) confere por aqui. Casado pelo id da conta, e
        não pelo nome público: dois saves com o mesmo nome não dividem a coroa."""
        pvm = [r[0] for r in self.con.execute(
            "SELECT r.conta_id FROM resumos r JOIN contas c ON c.id = r.conta_id WHERE c.banido = 0 AND c.gm = 0 "
            "ORDER BY r.xp_total DESC, r.nivel_max DESC, r.nome COLLATE NOCASE LIMIT 3")]
        pvp = [r[0] for r in self.con.execute(
            "SELECT r.conta_id FROM resumos r JOIN contas c ON c.id = r.conta_id "
            "WHERE c.banido = 0 AND c.gm = 0 AND r.brasa_partidas > 0 "
            "ORDER BY r.brasa_pts DESC, r.nome COLLATE NOCASE LIMIT 3")]
        return (pvm.index(cid) + 1 if cid in pvm else None, pvp.index(cid) + 1 if cid in pvp else None)

    def _posicoes_classe(self, cid):
        """Dentro da tranca: {classe: 1|2|3} — a posição da conta no pódio de cada classe do
        ranking público (a mesma ordem do GET /api/ranking: xp, nível, nome; sem banidas nem a
        equipe). 13/09: os títulos "Top N <classe>" (definirTitulo no juiz) conferem por aqui,
        casados pelo id da conta."""
        from comum import CLASSES_RANK
        fora = {}
        for classe in CLASSES_RANK:
            topo = [r[0] for r in self.con.execute(
                "SELECT rc.conta_id FROM resumos_classe rc JOIN resumos r ON r.conta_id = rc.conta_id "
                "JOIN contas c ON c.id = rc.conta_id WHERE c.banido = 0 AND c.gm = 0 AND rc.classe = ? "
                "ORDER BY rc.xp DESC, rc.nivel DESC, r.nome COLLATE NOCASE LIMIT 3", (classe,))]
            if cid in topo:
                fora[classe] = topo.index(cid) + 1
        return fora

    def _guilda_contexto(self, cid, t):
        """Dentro da tranca: o bônus e o dízimo da guilda da conta, lidos do banco."""
        # 13/09: o dízimo PRÓPRIO do membro (guilda_dizimo_membro) vence o padrão da guilda
        g = self.con.execute("SELECT g.bonus_xp, g.bonus_drop, COALESCE(d.pct, g.dizimo) AS dizimo FROM guilda_membros m "
                             "JOIN guildas g ON g.id = m.guilda_id "
                             "LEFT JOIN guilda_dizimo_membro d ON d.conta_id = m.conta_id AND d.guilda_id = m.guilda_id "
                             "WHERE m.conta_id = ?", (cid,)).fetchone()
        if g is None:
            return {'bonusXp': False, 'bonusDrop': False, 'dizimo': 0}
        return {'bonusXp': g['bonus_xp'] > t, 'bonusDrop': g['bonus_drop'] > t, 'dizimo': limita(g['dizimo'], 0, 100)}

    # -- o juiz --------------------------------------------------------------------------------
    @staticmethod
    def _confere_saida(saida):
        """O que o juiz devolveu tem a forma certa? Série ou origem torta é defeito
        do juiz, não do jogador: 503 (nada é pago) e o journal avisa."""
        if (not isinstance(saida, dict) or saida.get('ok') is not True or not isinstance(saida.get('progress'), dict)
                or not isinstance(saida.get('db'), dict)):
            raise Recusa(503, 'o juiz respondeu torto — tente de novo em instantes')
        iids = saida.get('iids') if isinstance(saida.get('iids'), dict) else {}
        novos, fora = iids.get('novos') or [], iids.get('fora') or []
        if not isinstance(novos, list) or not isinstance(fora, list):
            raise Recusa(503, 'o juiz respondeu torto — tente de novo em instantes')
        limpos = []
        for n in novos:
            item_id = n.get('itemId') if isinstance(n, dict) else None
            item_id = item_id if isinstance(item_id, str) else ''
            if not isinstance(n, dict) or not iid_valido(n.get('iid')) or n.get('origem') not in ORIGENS or len(item_id) > 64:
                log.error("juiz: nascimento torto %.200r", n)
                raise Recusa(503, 'o juiz devolveu uma série inválida — nada foi pago')
            limpos.append({'iid': n['iid'], 'itemId': item_id, 'origem': n['origem']})
        if not all(iid_valido(i) for i in fora):
            log.error("juiz: série fora torta %.200r", fora)
            raise Recusa(503, 'o juiz devolveu uma série inválida — nada foi pago')
        saida['iids'] = {'novos': limpos, 'fora': list(fora)}
        saida['guildaXp'] = max(0, inteiro(saida.get('guildaXp')))
        if not isinstance(saida.get('hash'), str):
            saida['hash'] = None
        return saida

    def _juiz_op(self, conta, estado, ops, interno=False):
        """FORA da tranca: o POST /op do juiz no estado dado. A semente é nova a cada
        pedido (secrets): quem repete o pedido não escolhe o sorteio."""
        with self.tranca:
            pvm, pvp = self._posicoes(conta['id'])
            por_classe = self._posicoes_classe(conta['id'])
            # 13/09: as cópias emprestadas do banco da guilda que estão com esta conta — o juiz
            # recusa op do jogador que as faça sumir do estado (a fusão consumiria a cópia)
            try:
                bloqueados = [r[0] for r in self.con.execute(
                    "SELECT iid FROM guilda_emprestimos WHERE conta_id = ? AND iid IS NOT NULL", (conta['id'],))]
            except sqlite3.Error:
                bloqueados = []
        corpo = {'conta': {'id': conta['id'], 'gm': bool(conta['gm'])},
                 'progress': estado['progress'], 'db': estado['db'], 'ops': ops,
                 'semente': secrets.randbits(31),
                 'contexto': {'agoraMs': int(time.time() * 1000), 'pvm': pvm, 'pvp': pvp, 'interno': bool(interno),
                              'bloqueados': bloqueados, 'porClasse': por_classe}}
        return self._confere_saida(self.juiz.pede('POST', '/op', corpo))

    def _estado_grava(self, conta, lido, saida, t, poupar=()):
        """Dentro de _escrita: grava o estado que o juiz devolveu (versao+1), com o
        cosmético de AGORA por cima; registra as séries novas, marca as que saíram,
        credita o XP do dízimo na guilda, guarda o hash e refaz a foto do ranking.
        `poupar`: séries que quem chama move à mão (a troca, o banco da guilda).
        Devolve (versao nova, db gravado)."""
        cid = conta['id']
        atual = self._estado_confere(cid, lido)
        progress = saida['progress']
        db = junta_cosmetico(saida['db'], atual['db'])
        poupar = set(poupar)
        novos = [n for n in saida['iids']['novos'] if n['iid'] not in poupar]
        if novos:
            conhecidos = {}
            lote = [n['iid'] for n in novos]
            for i in range(0, len(lote), 400):
                parte = lote[i:i + 400]
                for r in self.con.execute("SELECT iid, conta_id, estado FROM itens WHERE iid IN (%s)"
                                          % ','.join('?' * len(parte)), parte):
                    conhecidos[r['iid']] = (r['conta_id'], r['estado'])
            registrar = []
            for n in novos:
                dono = conhecidos.get(n['iid'])
                if dono is None:
                    registrar.append((n['iid'], cid, n['itemId'], n['origem'], t))
                elif dono != (cid, 'vivo'):
                    # uma série que já existe noutro dono, ou que já saiu do jogo: o juiz nunca
                    # cunha uma assim — é defeito, e pagar seria duplicar
                    log.error("autoridade: o juiz devolveu a série %s, que já é %r (conta #%d)", n['iid'], dono, cid)
                    raise Recusa(503, 'o juiz devolveu uma série que já existe — nada foi pago')
            self.con.executemany("INSERT INTO itens(iid, conta_id, item_id, origem, criado_em, estado) "
                                 "VALUES (?, ?, ?, ?, ?, 'vivo')", registrar)
        fora = [iid for iid in saida['iids']['fora'] if iid not in poupar]
        if fora:
            guardadas = {r[0] for r in self.con.execute(
                "SELECT iid FROM guilda_banco WHERE iid IS NOT NULL AND dono_id = ?", (cid,))}
            # 13/09: a peça anunciada no mercadinho está em custódia (mercado.py): saiu do estado, não do jogo
            guardadas |= {r[0] for r in self.con.execute(
                "SELECT iid FROM mercado_anuncios WHERE iid IS NOT NULL AND vendedor_id = ? AND estado = 'aberto'", (cid,))}
            self.con.executemany("UPDATE itens SET estado = 'fora' WHERE iid = ? AND conta_id = ? AND estado = 'vivo'",
                                 [(iid, cid) for iid in fora if iid not in guardadas])
        nova = atual['versao'] + 1
        self.con.execute("UPDATE saves SET progress = ?, db = ?, versao = ?, atualizado_em = ? WHERE conta_id = ?",
                         (json.dumps(progress, ensure_ascii=False), json.dumps(db, ensure_ascii=False), nova, t, cid))
        if saida['guildaXp'] > 0:
            # o dízimo que o juiz anotou (Guilda.doarXp dentro do computeRewards): na guilda
            # em que a conta está AGORA; sem guilda, não vai a lugar nenhum
            self.con.execute("UPDATE guildas SET xp = xp + ? WHERE id = (SELECT guilda_id FROM guilda_membros "
                             "WHERE conta_id = ?)", (saida['guildaXp'], cid))
            soma_contrib(self.con, cid, saida['guildaXp'])      # 13/09: a grade de membros ordena por isto
        self.con.execute("INSERT OR REPLACE INTO autoridade(conta_id, hash, atualizado_em) VALUES (?, ?, ?)",
                         (cid, saida['hash'], t))
        self._resumo(cid, conta, progress, db, t)
        return nova, db

    # -- PUT /api/save com a autoridade ligada (§4.4; o salvar do api.py chama) ---------------------
    def _salvar_cosmetico(self, conta, db_cliente):
        """A conta que já tem estado no servidor: o progress e os nascimentos do corpo
        são ignorados, e do db só entram os campos de dono cliente. Sem 409 por
        versão (o cosmético é "último vence"), sem varrer séries, sem confirmar a
        loja. None se a conta ainda não tem estado (o salvar segue o caminho antigo:
        o primeiro save vira o estado inicial)."""
        cid, t = conta['id'], agora()
        with self._escrita():
            estado = self._estado_ler(cid)
            if estado is None:
                return None
            db = junta_cosmetico(estado['db'], db_cliente)
            nova = estado['versao'] + 1
            self.con.execute("UPDATE saves SET db = ?, versao = ?, atualizado_em = ? WHERE conta_id = ?",
                             (json.dumps(db, ensure_ascii=False), nova, t, cid))
            self._resumo(cid, conta, estado['progress'], db, t)
        return {'ok': True, 'versao': nova, 'hash': estado['hash'], 'autoridade': True}

    # -- A VIDA ÚNICA DO HERÓI (14/09) ----------------------------------------------------------------
    # O dono, 13/09: "quando acaba a luta o jogador fica com a vida que terminou a última luta.. carrega 1 pv
    # a cada 2 segundos"; e 14/09: "hoje nas salas de espera a vida vai recuperando aos poucos até encher ou
    # o jogador usa pote; isso vale para quando terminar calabouço (na praça), depois de um pvp e assim por
    # diante; e se o jogador estiver com a vida na metade e começar uma batalha sendo pvp, poço, desafio ou
    # outro calabouço, a vida vai começar onde estava, na metade". Era uma vida por DESCIDA (vida_espera, por
    # bilhete/gid, que zerava na praça); virou uma vida por HERÓI DA CONTA (vida_heroi), contínua entre
    # qualquer luta. O relógio é o do SERVIDOR: a espera começa no instante em que a luta fechou.
    def _vida_de(self, cid, herois, agora_ms):
        """Dentro da tranca: {heroId: vida_da_linha} dos heróis da lista que TÊM linha (os cheios inclusive)."""
        herois = [h for h in herois if isinstance(h, str)]
        if not herois:
            return {}
        linhas = self.con.execute("SELECT * FROM vida_heroi WHERE conta_id = ? AND heroi IN (%s)"
                                  % ','.join('?' * len(herois)), [cid] + herois).fetchall()
        return {r['heroi']: vida_da_linha(r, agora_ms) for r in linhas}

    def _vida_ferida(self, cid, herois, agora_ms):
        """Dentro da tranca: só os heróis NÃO cheios. Sem linha, ou com o PV de agora no máximo da linha, o
        herói está cheio e fica FORA do carry: o motor dá o PV máximo de hoje — o nível que subiu e a peça
        trocada depois da luta entram sozinhos."""
        return {h: v for h, v in self._vida_de(cid, herois, agora_ms).items() if v['hp'] < v['max']}

    @staticmethod
    def _vida_recusa_zero(vidas):
        """`vidas` = {chave: vida}: o primeiro herói ainda a 0 PV derruba a abertura (409 vida-zero, com os
        segundos até 1 PV). A 0 só fica quem terminou caído, não bebeu e ainda não passou o primeiro intervalo."""
        for chave in sorted(vidas):
            v = vidas[chave]
            if v['hp'] < 1:
                espera = max(1, -(-v['ate1Ms'] // 1000))
                raise Recusa(409, 'o herói %s ainda está sem vida: %d s até recuperar 1 PV (ou beba uma poção)'
                             % (chave[:64], espera), motivo='vida-zero', heroi=chave, esperaS=espera)

    def _vida_grava_fim(self, cid, fim, maximos, agora_ms):
        """Dentro de _escrita: o fim de uma luta — uma linha por herói da conta, com o PV do fim, o máximo, o
        instante e as curas zeradas. `fim` e `maximos` = {heroId: PV}. Sem o máximo (um juiz de antes de 13/09)
        vale o próprio PV do fim: a linha nasce cheia e não prende ninguém."""
        maximos = maximos if isinstance(maximos, dict) else {}
        for heroi, hp in (fim if isinstance(fim, dict) else {}).items():
            if (not isinstance(heroi, str) or not 0 < len(heroi) <= 64 or isinstance(hp, bool)
                    or not isinstance(hp, (int, float))):
                continue
            hp = max(0, int(hp))
            mx = maximos.get(heroi)
            mx = int(mx) if isinstance(mx, (int, float)) and not isinstance(mx, bool) and mx >= 1 else max(1, hp)
            self.con.execute("INSERT OR REPLACE INTO vida_heroi(conta_id, heroi, hp_fim, hp_max, desde_ms, cura) "
                             "VALUES (?, ?, ?, ?, ?, 0)", (cid, heroi, min(hp, mx), mx, agora_ms))

    def _vida_confere_ferido(self, cid, heroi):
        """Dentro da tranca: a vida de agora do herói, ou 409 'cheio' (sem linha, ou já no máximo)."""
        v = self._vida_de(cid, [heroi], int(time.time() * 1000)).get(heroi)
        if v is None or v['hp'] >= v['max']:
            extra = {'hp': v['hp'], 'hpMax': v['max']} if v is not None else {}
            raise Recusa(409, 'a vida desse herói já está cheia', motivo='cheio', **extra)
        return v

    # -- GET /api/vida (14/09) ---------------------------------------------------------------------------
    def vida_lista(self, conta, corpo):
        """A vida dos heróis FERIDOS da conta, no relógio do servidor; os cheios não vêm (o cliente usa o PV
        máximo que ele mesmo calcula). {heroId: {hp, max, cheioEmMs, ate1Ms}}: os dois últimos são quanto
        falta, em ms a partir de agoraMs, para encher e para ter 1 PV (0 = já chegou)."""
        with self.tranca:
            agora_ms = int(time.time() * 1000)
            linhas = self.con.execute("SELECT * FROM vida_heroi WHERE conta_id = ?", (conta['id'],)).fetchall()
        herois = {}
        for r in linhas:
            v = vida_da_linha(r, agora_ms)
            if v['hp'] < v['max']:
                herois[r['heroi']] = v
        return 200, {'ok': True, 'agoraMs': agora_ms, 'msPorPv': VIDA_MS_POR_PV, 'herois': herois}

    # -- POST /api/vida/pocao (14/09; as rotas de antes, /api/sala/pocao e /api/grupo/pocao, caem aqui) ----------
    def vida_pocao(self, conta, corpo):
        """Corpo {heroId, pocaoId}. A poção FORA da batalha, em qualquer lugar (a praça, a antessala, depois do
        duelo): o juiz tira UMA poção do estado (op interna beberPocao, tudo ou nada) e a cura entra na linha do
        herói na MESMA transação que grava o estado. Recusa: herói que não é da conta (400 heroi), vida cheia
        (409 cheio, ANTES de gastar), sem a poção (o juiz: 422 sem-pocao). A poção nunca passa do máximo: a
        cura soma na linha, e a vida de agora é presa no máximo dela."""
        cid = conta['id']
        heroi, pocao = corpo.get('heroId'), corpo.get('pocaoId')
        if not isinstance(heroi, str) or not 0 < len(heroi) <= 64:
            raise Recusa(400, 'heroId precisa ser o id de um herói')
        if not isinstance(pocao, str) or not RE_NOME_OP.match(pocao.replace('-', '_')):
            raise Recusa(400, 'pocaoId precisa ser o id de uma poção')
        for _ in range(TENTATIVAS):
            with self.tranca:
                estado = self._estado_exige(cid)
                fichas = estado['progress'].get('heroes')
                if not isinstance(fichas, dict) or not isinstance(fichas.get(heroi), dict):
                    raise Recusa(400, 'o herói %s não é desta conta' % heroi[:64], motivo='heroi')
                self._vida_confere_ferido(cid, heroi)
            saida = self._juiz_op(conta, estado, [{'nome': 'beberPocao', 'args': {'id': pocao}}], interno=True)
            res = (saida.get('resultados') or [None])[0]
            cura = res.get('cura') if isinstance(res, dict) else None
            if not _inteiro_puro(cura) or cura < 1:
                raise Recusa(503, 'o juiz respondeu torto — tente de novo em instantes')
            t = agora()
            try:
                with self._escrita():
                    v = self._vida_confere_ferido(cid, heroi)          # ainda ferido na hora de gravar
                    nova, db = self._estado_grava(conta, estado, saida, t)
                    self.con.execute("UPDATE vida_heroi SET cura = cura + ? WHERE conta_id = ? AND heroi = ?",
                                     (cura, cid, heroi))
                    self._evento(cid, 'pocao-vida', {'heroi': heroi, 'pocao': pocao, 'cura': cura, 'hp': v['hp'],
                                                     'versao': nova})
            except EstadoMudou:
                continue
            return 200, {'ok': True, 'heroi': heroi, 'pocaoId': pocao, 'cura': cura,
                         'hp': min(v['max'], v['hp'] + cura), 'hpMax': v['max'],
                         'versao': nova, 'hash': saida['hash'], 'progress': saida['progress'], 'db': db}
        raise Recusa(409, MUDOU_NO_MEIO, **self._estado_publico(cid))

    # -- POST /api/sala/abrir (§4.1) ------------------------------------------------------------
    def _regras(self):
        guardadas = self.__dict__.get('_regras_guardadas')
        if guardadas is not None and time.monotonic() < guardadas[0]:
            return guardadas[1]
        r = self.juiz.pede('GET', '/regras', tempo=5.0)
        cal = r.get('calaboucos') if isinstance(r, dict) else None
        if not isinstance(cal, dict):
            raise Recusa(503, 'o juiz não disse as regras — tente de novo em instantes')
        self._regras_guardadas = (time.monotonic() + REGRAS_CACHE, r)
        return r

    def _regras_esquece(self):
        """19/09 (a 2ª rodada de conserto): o GET /regras fica guardado REGRAS_CACHE s, e a API pode ter subido
        ANTES do juiz novo — o número guardado seria o velho por até 5 min: bilhetes abertos com ele venceriam ao
        fechar, e a página nova, recarregada, levaria 409 sem ter culpa. Quem vê um sinal de que o juiz é outro (o
        422 'regras-mudaram' no fechamento; a página que manda um número diferente do guardado) esquece o guardado,
        e a consulta seguinte pergunta de novo. Barato: o juiz responde /regras de um cache dele."""
        self._regras_guardadas = None

    def _confere_versao_cliente(self, corpo, regras):
        """19/09 (a 2ª rodada de conserto): a VERSÃO DAS REGRAS da página contra a do juiz, em TODA abertura (a sala
        solo, a sala em grupo, o duelo, a confirmação da guerra). `versaoRegras` AUSENTE = versão 1: a única página
        que não manda o campo é a de antes do número (18/09), que joga com o engine.js e o ai.js da versão 1 — a
        revisão mediu 22% das salas dela caindo como 'divergiu' (fraude) quando o juiz novo as refazia. Só passa sem
        o campo quando o juiz também não anuncia número (juiz velho). Diferentes: antes do 409 a API pergunta ao
        juiz de novo (o guardado pode ser de antes do deploy) e só recusa se ele confirmar. Devolve as regras (as
        guardadas ou as reconferidas). Chamar FORA da tranca: fala com o juiz."""
        cliente = corpo.get('versaoRegras')
        if cliente is not None and not _inteiro_puro(cliente):
            raise Recusa(400, 'versaoRegras precisa ser um inteiro')
        if cliente is None:
            cliente = 1
        juiz = regras.get('regras')
        if _inteiro_puro(juiz) and cliente != juiz:
            # o guardado pode estar velho: confere de novo — no máximo uma vez a cada 2 s, para quem manda um
            # número errado de propósito não fazer a API martelar o juiz
            if time.monotonic() - self.__dict__.get('_regras_reconferida', 0.0) > 2.0:
                self._regras_reconferida = time.monotonic()
                self._regras_esquece()
                regras = self._regras()
                juiz = regras.get('regras')
        if _inteiro_puro(juiz) and cliente != juiz:
            raise Recusa(409, 'as regras do jogo mudaram: recarregue a página para jogar com as de agora',
                         motivo='regras-velhas', regras=juiz)
        return regras

    @staticmethod
    def _confere_herois(conta, progress, herois, de_quem=''):
        """Os heróis existem no estado do servidor da conta e a classe deles está liberada
        (o Mestre do Fundo só na conta com a marca). `de_quem` entra na frase do erro."""
        fichas = progress.get('heroes') if isinstance(progress, dict) else None
        fichas = fichas if isinstance(fichas, dict) else {}
        lib = liberadas(progress)
        for hid in herois:
            h = fichas.get(hid)
            if not isinstance(h, dict):
                raise Recusa(400, 'o herói %s não é %s' % (hid[:64], de_quem or 'desta conta'))
            classe = classe_do_heroi(hid, h)
            if classe is None:
                bruta = h.get('classId') if isinstance(h.get('classId'), str) else hid.split('#', 1)[0]
                if not (bruta == 'gm' and conta['gm']):
                    raise Recusa(400, 'o herói %s não pode descer' % hid[:64])
            elif classe not in lib:
                raise Recusa(400, 'a classe do herói %s ainda não foi liberada' % hid[:64])

    def _confere_teto_salas(self, cid, t):
        """Dentro da tranca: o teto de SALAS_POR_HORA vale para as salas solo e as em grupo
        juntas (as em grupo contam para o líder e para o membro)."""
        na_hora = sorted([r[0] for r in self.con.execute(
            "SELECT aberta_em FROM salas WHERE conta_id = ? AND aberta_em > ?", (cid, t - 3600))] + [
            r[0] for r in self.con.execute(
                "SELECT aberta_em FROM salas_grupo WHERE (lider_id = ? OR membro_id = ?) AND aberta_em > ?",
                (cid, cid, t - 3600))])
        if len(na_hora) >= SALAS_POR_HORA:
            raise Recusa(429, 'salas demais na última hora (máximo %d)' % SALAS_POR_HORA,
                         liberaEm=na_hora[len(na_hora) - SALAS_POR_HORA] + 3600)

    # -- A LUTA LARGADA (15/09) ----------------------------------------------------------------------------------
    # O dono: "arrume as falhas conhecidas". Fechar a aba no meio de uma derrota (sala solo, Poço, sala em grupo)
    # fugia da vida zerada: o servidor nunca recebia o fechar e a vida_heroi ficava a de antes da luta. O jogo agora
    # guarda o registro da luta aberta e a fecha antes de abrir qualquer outra (js/core/autoridade.js); o servidor
    # cobre quem não fecha — outro aparelho, a memória do navegador limpa, o cliente mexido: a conta que ABRE uma
    # luta nova (sala, grupo, duelo, Arena, guerra) com uma luta dela ainda aberta no servidor largou a de antes, e os
    # heróis DELA naquela luta ficam a 0 desde agora (luta_aberta).
    def _com_largada(self, conta, abre):
        """A abertura `abre()` (que devolve (status, resposta)) depois de largar as lutas pendentes da conta. A
        resposta — e também a recusa, como o 409 vida-zero que a própria largada provoca — leva `largada: {herois}`."""
        largada = self._larga_pendentes(conta) if self._autoridade_ligada() else None
        try:
            status, resposta = abre()
        except Recusa as e:
            if largada:
                e.extra['largada'] = largada
            raise
        if largada and isinstance(resposta, dict):
            resposta['largada'] = largada
        return status, resposta

    def _larga_salas_pendentes(self, conta):
        """As SALAS da conta que seguem abertas no servidor: a que já fechou (ou abandonada há mais de
        LARGADA_JANELA_MS) só fica 'fechada'; a que segue aberta é LARGADA — os heróis da conta nela a 0 (com o
        máximo que o juiz dá), a sala solo 'perdida' (a em grupo segue aberta: o parceiro ainda fecha a dele).
        Devolve {'herois': [...]} ou None. (19/09: a guerra pronta entra por _larga_pendentes, abaixo.)"""
        cid = conta['id']
        agora_ms = int(time.time() * 1000)
        largar, velhas = [], []
        with self.tranca:
            try:
                linhas = [dict(r) for r in self.con.execute(
                    "SELECT * FROM luta_aberta WHERE conta_id = ? AND estado = 'aberta'", (cid,))]
            except sqlite3.Error:
                return None
            for r in linhas:
                if r['tipo'] == 'sala':
                    s = self.con.execute("SELECT * FROM salas WHERE bilhete = ?", (r['ref'],)).fetchone()
                else:
                    s = self.con.execute("SELECT * FROM salas_grupo WHERE gid = ?", (r['ref'],)).fetchone()
                if s is None or s['estado'] != 'aberta' or agora_ms - r['aberta_ms'] > LARGADA_JANELA_MS:
                    velhas.append(r)
                else:
                    largar.append((r, dict(s)))
        if not largar and not velhas:
            return None
        maximos = {(r['tipo'], r['ref']): self._larga_maximos(conta, r, s) for r, s in largar}   # o juiz, fora da tranca
        herois = []
        with self._escrita():
            for r in velhas:
                self.con.execute("UPDATE luta_aberta SET estado = 'fechada' WHERE tipo = ? AND ref = ? AND conta_id = ? "
                                 "AND estado = 'aberta'", (r['tipo'], r['ref'], cid))
            t = agora()
            for r, _ in largar:
                tabela, chave = ('salas', 'bilhete') if r['tipo'] == 'sala' else ('salas_grupo', 'gid')
                ainda = self.con.execute("SELECT estado FROM %s WHERE %s = ?" % (tabela, chave), (r['ref'],)).fetchone()
                aberta = ainda is not None and ainda['estado'] == 'aberta'
                n = self.con.execute("UPDATE luta_aberta SET estado = ? WHERE tipo = ? AND ref = ? AND conta_id = ? "
                                     "AND estado = 'aberta'", ('largada' if aberta else 'fechada', r['tipo'], r['ref'],
                                                               cid)).rowcount
                if not n or not aberta:
                    continue                                    # fechou no meio (o outro membro, outra aba)
                hs = [h for h in _lista(r['herois']) if isinstance(h, str)]
                self._vida_grava_fim(cid, {h: 0 for h in hs}, maximos.get((r['tipo'], r['ref'])) or {}, agora_ms)
                if r['tipo'] == 'sala':
                    self.con.execute("UPDATE salas SET estado = 'perdida', fechada_em = ? WHERE bilhete = ? "
                                     "AND estado = 'aberta'", (t, r['ref']))
                self._evento(cid, 'luta-largada', {'tipo': r['tipo'], 'ref': r['ref'], 'herois': hs})
                herois.extend(h for h in hs if h not in herois)
        if herois:
            log.info("luta largada: conta #%d, heróis %s a 0", cid, ', '.join(herois))
        return {'herois': herois} if herois else None

    def _larga_pendentes(self, conta):
        """A luta largada de qualquer tipo: as salas (acima) e, 19/09, a GUERRA pronta que a conta deixou aberta
        (guerra.py, _guerra_larga: a tabela luta_aberta_guerra — o CHECK da luta_aberta só aceita sala/grupo).
        Devolve {'herois': [...]} ou None."""
        r = self._larga_salas_pendentes(conta)
        larga_guerra = getattr(self, '_guerra_larga', None)
        herois = list(r['herois']) if r else []
        for h in (larga_guerra(conta) if larga_guerra is not None else []):
            if h not in herois:
                herois.append(h)
        return {'herois': herois} if herois else None

    def _larga_maximos(self, conta, r, s):
        """FORA da tranca: {heroId: PV máximo} dos heróis da conta naquela luta. O juiz refaz a luta SEM lance nenhum
        (a sala nasce e para) e devolve o máximo de cada herói — o mesmo do fechar. Juiz fora do ar: 503 (a abertura
        espera). Juiz que recusa (o herói saiu da conta, a regra mudou): o máximo da linha que o herói já tem; sem
        linha, a vida volta cheia em 2 s (a falha não pune)."""
        cid = conta['id']
        hs = [h for h in _lista(r['herois']) if isinstance(h, str)]
        agora_ms = int(time.time() * 1000)
        pedido, dono = None, None
        with self.tranca:
            reserva = {h: v['max'] for h, v in self._vida_de(cid, hs, agora_ms).items()}
            if r['tipo'] == 'sala':
                estado = self._estado_ler(cid)
                if estado is not None:
                    pedido = {'conta': {'id': cid, 'gm': bool(conta['gm'])},
                              'bilhete': {'dungeonId': s['dungeon'], 'roomIndex': s['sala'], 'dificuldade': s['dificuldade'],
                                          'semente': s['semente'], 'herois': _lista(s['herois']),
                                          'carry': _objeto(s['carry'])},
                              'lances': [], 'hashFinal': None, 'progress': estado['progress'], 'db': estado['db'],
                              'contexto': {'agoraMs': agora_ms, 'fatores': {},
                                           'guilda': {'bonusXp': False, 'bonusDrop': False, 'dizimo': 0}}}
            else:
                membros = []
                for p in _lista(s['party']):
                    c = self.con.execute("SELECT * FROM contas WHERE id = ?", (p.get('conta'),)).fetchone() \
                        if isinstance(p, dict) else None
                    e = self._estado_ler(c['id']) if c is not None else None
                    if c is None or e is None:
                        membros = None
                        break
                    if c['id'] == cid:
                        dono = p.get('dono')
                    membros.append({'conta': {'id': c['id'], 'gm': bool(c['gm'])}, 'dono': p.get('dono'),
                                    'herois': p.get('herois'), 'progress': e['progress'], 'db': e['db'],
                                    'guilda': {'bonusXp': False, 'bonusDrop': False, 'dizimo': 0}})
                if membros and dono:
                    pedido = {'membros': membros,
                              'ata': {'dungeonId': s['dungeon'], 'roomIndex': s['sala'], 'dificuldade': s['dificuldade'],
                                      'semente': s['semente'], 'carry': _objeto(s['carry'])},
                              'lances': [], 'hashFinal': None, 'contexto': {'agoraMs': agora_ms, 'fatores': {}}}
        if pedido is None:
            return reserva
        try:
            saida = self.juiz.pede('POST', '/sala/fecha' if r['tipo'] == 'sala' else '/grupo/fecha', pedido)
        except Recusa as e:
            if e.status == 422:
                return reserva
            raise
        mx = saida.get('vidaMax') if isinstance(saida, dict) and isinstance(saida.get('vidaMax'), dict) else {}
        fora = dict(reserva)
        for h in hs:
            v = mx.get(h if r['tipo'] == 'sala' else '%s:%s' % (dono, h))
            if _inteiro_puro(v) and v >= 1:
                fora[h] = v
        return fora

    def sala_abrir(self, conta, corpo):
        # 15/09: a luta que a conta deixou aberta no servidor fica largada antes (_com_largada)
        return self._com_largada(conta, lambda: self._sala_abrir(conta, corpo))

    def _sala_abrir(self, conta, corpo):
        cid = conta['id']
        dungeon, sala = corpo.get('dungeonId'), corpo.get('roomIndex')
        dificuldade, herois = corpo.get('dificuldade'), corpo.get('herois')
        if not isinstance(dungeon, str) or not RE_CALABOUCO.match(dungeon):
            raise Recusa(400, 'dungeonId precisa ser o id de um calabouço')
        if not _inteiro_puro(sala) or sala < 0:
            raise Recusa(400, 'roomIndex precisa ser um inteiro a partir de 0')
        if dificuldade is None:
            dificuldade = 'normal'
        if dificuldade not in DIFICULDADES:
            raise Recusa(400, 'dificuldade precisa ser facil, normal ou dificil')
        if (not isinstance(herois, list) or not 1 <= len(herois) <= 2
                or any(not isinstance(h, str) or not 0 < len(h) <= 64 for h in herois) or len(set(herois)) != len(herois)):
            raise Recusa(400, 'herois precisa ser uma lista de 1 ou 2 heróis diferentes')
        regras = self._regras()                              # sem juiz: 503
        n = regras['calaboucos'].get(dungeon)
        if not _inteiro_puro(n):
            raise Recusa(400, 'calabouço desconhecido ou fechado')
        if sala >= n:
            raise Recusa(400, 'essa sala não existe nesse calabouço (são %d)' % n)
        # 19/09, A VERSÃO DAS REGRAS (docs/SEGURANCA.md §4.1): o juiz anuncia o Engine.VERSAO_REGRAS dele e a
        # página manda o seu em versaoRegras. Diferentes (e a AUSÊNCIA é a versão 1: só a página de antes do
        # número não manda — a 2ª rodada de conserto): a página está com um engine.js de antes do deploy e
        # refaria a sala com outro resultado — 409 para recarregar, em vez de jogar e cair como fraude
        regras = self._confere_versao_cliente(corpo, regras)
        regras_juiz = regras.get('regras')
        t = agora()
        with self._escrita():
            estado = self._estado_exige(cid)
            self._confere_herois(conta, estado['progress'], herois)
            self._confere_teto_salas(cid, t)
            # 14/09, a vida única: em QUALQUER sala (a 0 da descida e o Poço inclusive) o herói entra com a vida
            # de agora — o fim da última luta, a espera e as poções. Os cheios ficam fora; todos cheios, sem carry
            vidas = self._vida_ferida(cid, herois, int(time.time() * 1000))
            self._vida_recusa_zero(vidas)
            carry = {h: v['hp'] for h, v in vidas.items()} or None
            # um bilhete aberto por conta: abrir outro vence o anterior
            self.con.execute("UPDATE salas SET estado = 'vencida', fechada_em = ? WHERE conta_id = ? AND estado = 'aberta'",
                             (t, cid))
            semente = secrets.randbits(31)
            bilhete = secrets.token_urlsafe(18)
            self.con.execute(
                "INSERT INTO salas(bilhete, conta_id, dungeon, sala, dificuldade, semente, herois, carry, aberta_em, estado) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberta')",
                (bilhete, cid, dungeon, sala, dificuldade, semente, json.dumps(herois),
                 json.dumps(carry) if carry is not None else None, t))
            # 19/09: a versão das regras com que o bilhete abriu (o juiz confere ao fechar)
            if _inteiro_puro(regras_juiz):
                self.con.execute("INSERT OR REPLACE INTO salas_regras(bilhete, regras, versao) VALUES (?, ?, ?)",
                                 (bilhete, regras_juiz, regras.get('versao') if isinstance(regras.get('versao'), str) else None))
            # 15/09: a luta aberta da conta — quem abrir outra sem fechar esta a larga (_larga_pendentes)
            self.con.execute("INSERT OR REPLACE INTO luta_aberta(tipo, ref, conta_id, herois, aberta_ms, estado) "
                             "VALUES ('sala', ?, ?, ?, ?, 'aberta')",
                             (bilhete, cid, json.dumps(herois), int(time.time() * 1000)))
        return 200, {'ok': True, 'bilhete': bilhete, 'semente': semente, 'carry': carry}

    # -- POST /api/sala/fechar (§4.2) -----------------------------------------------------------
    def _sala_recusa(self, cid, bilhete, motivo, erro):
        """A sala não paga e fica 'recusada', com o porquê na trilha."""
        with self._escrita():
            n = self.con.execute("UPDATE salas SET estado = 'recusada', fechada_em = ? WHERE bilhete = ? AND estado = 'aberta'",
                                 (agora(), bilhete)).rowcount
            if n:
                self._evento(cid, 'sala-recusada', {'bilhete': bilhete, 'motivo': motivo, 'erro': erro})
        log.info("sala recusada: #%d (%s) — %.200s", cid, motivo, erro)

    def sala_fechar(self, conta, corpo):
        """Sem conferência de versão (o bilhete basta): o estado é o que o servidor tem
        na hora de fechar. Se ele muda enquanto o juiz refaz, refaz de novo."""
        cid = conta['id']
        bilhete, lances, hash_final = corpo.get('bilhete'), corpo.get('lances'), corpo.get('hashFinal')
        if not isinstance(bilhete, str) or not RE_BILHETE.match(bilhete):
            raise Recusa(400, 'bilhete inválido')
        if not isinstance(lances, list) or len(lances) > LANCES_MAX:
            raise Recusa(400, 'lances precisa ser uma lista de até %d lances' % LANCES_MAX)
        if hash_final is not None and not _inteiro_puro(hash_final):
            raise Recusa(400, 'hashFinal precisa ser um inteiro ou null')
        for _ in range(TENTATIVAS):
            instante = time.time()
            t = int(instante)
            vencido = rapido = False
            with self._escrita():
                s = self.con.execute("SELECT * FROM salas WHERE bilhete = ?", (bilhete,)).fetchone()
                if s is None or s['conta_id'] != cid:           # o de outra conta: a mesma resposta
                    raise Recusa(404, 'bilhete não encontrado')
                # 19/09: a versão das regras com que o bilhete abriu. LINHA AUSENTE = bilhete de ANTES do número (aberto
                # antes do deploy que trouxe a tabela) = versão 1, a implícita do engine.js: a revisão mediu 12 de 54
                # salas de antes caindo como 'divergiu' (fraude) quando o juiz novo as refazia sem conferir nada
                rg = self.con.execute("SELECT regras FROM salas_regras WHERE bilhete = ?", (bilhete,)).fetchone()
                regras_bilhete = rg['regras'] if rg is not None and _inteiro_puro(rg['regras']) else 1
                if s['estado'] == 'vencida':
                    raise Recusa(410, 'bilhete vencido: abra a sala de novo')
                if s['estado'] != 'aberta':
                    raise Recusa(409, 'esse bilhete já foi fechado (%s)' % s['estado'])
                if t - s['aberta_em'] > SALA_VALIDADE:
                    self.con.execute("UPDATE salas SET estado = 'vencida', fechada_em = ? WHERE bilhete = ?", (t, bilhete))
                    vencido = True
                elif instante - s['aberta_em'] < SALA_MIN_S:
                    rapido = True                               # nem pede ao juiz
                else:
                    estado = self._estado_exige(cid)
                    fatores = self._fatores_no_ar(t)
                    guilda = self._guilda_contexto(cid, t)
            if vencido:
                raise Recusa(410, 'bilhete vencido: abra a sala de novo')
            if rapido:
                self._sala_recusa(cid, bilhete, 'rapido-demais', 'fechou em %.1f s' % (instante - s['aberta_em']))
                raise Recusa(422, 'a sala fechou rápido demais para ser de verdade', motivo='rapido-demais')
            pedido = {
                'conta': {'id': cid, 'gm': bool(conta['gm'])},
                'bilhete': {'dungeonId': s['dungeon'], 'roomIndex': s['sala'], 'dificuldade': s['dificuldade'],
                            'semente': s['semente'], 'herois': json.loads(s['herois']),
                            'carry': _objeto(s['carry']),
                            'regras': regras_bilhete},           # 19/09: o juiz confere contra a versão dele
                'lances': lances, 'hashFinal': hash_final,
                'progress': estado['progress'], 'db': estado['db'],
                'contexto': {'agoraMs': int(instante * 1000), 'fatores': fatores, 'guilda': guilda}}
            try:
                saida = self.juiz.pede('POST', '/sala/fecha', pedido)
            except Recusa as e:
                if e.status == 422 and e.extra.get('motivo') == 'regras-mudaram':
                    # 19/09: o deploy trocou uma regra no meio da sala — o bilhete VENCE (não é fraude), com a
                    # trilha dizendo o porquê; o jogo abre a sala de novo com as regras de agora
                    self._regras_esquece()                      # o juiz é outro: o /regras guardado pode ser velho
                    with self._escrita():
                        n = self.con.execute("UPDATE salas SET estado = 'vencida', fechada_em = ? "
                                             "WHERE bilhete = ? AND estado = 'aberta'", (agora(), bilhete)).rowcount
                        if n:
                            self._evento(cid, 'sala-vencida', {'bilhete': bilhete, 'motivo': 'regras-mudaram',
                                                               'erro': e.erro, 'regras': regras_bilhete})
                    log.info("sala vencida por regras novas: #%d — %.200s", cid, e.erro)
                    raise Recusa(410, 'as regras do jogo mudaram no meio da sala — abra a sala de novo',
                                 motivo='regras-mudaram')
                if e.status == 422:                             # o replay não fecha: a sala não paga
                    self._sala_recusa(cid, bilhete, e.extra.get('motivo') or 'juiz', e.erro)
                raise
            if not isinstance(saida, dict) or saida.get('ok') is not True or not isinstance(saida.get('fase'), str):
                raise Recusa(503, 'o juiz respondeu torto — tente de novo em instantes')
            turnos = max(0, inteiro(saida.get('turnosJogador')))
            minimo = max(SALA_MIN_S, SALA_S_POR_TURNO * turnos)
            if instante - s['aberta_em'] < minimo:
                self._sala_recusa(cid, bilhete, 'rapido-demais',
                                  '%d vezes em %.1f s (mínimo %.1f s)' % (turnos, instante - s['aberta_em'], minimo))
                raise Recusa(422, 'a sala fechou rápido demais para ser de verdade', motivo='rapido-demais')
            # 14/09, a vida única: o PV do fim de cada herói do bilhete, em qualquer fim refeito
            fim = saida.get('carry') if isinstance(saida.get('carry'), dict) else {}
            fim = {h: fim[h] for h in json.loads(s['herois']) if h in fim}
            if saida['fase'] != 'won':
                # derrota ou sala largada no meio: nada muda no estado da economia (13/09: a poção saiu da
                # batalha, e com ela o desconto). 14/09: mas a vida do fim fica — quem caiu sai a 0 e espera
                with self._escrita():
                    n = self.con.execute("UPDATE salas SET estado = 'perdida', fechada_em = ?, turnos = ? "
                                         "WHERE bilhete = ? AND estado = 'aberta'", (t, turnos, bilhete)).rowcount
                    if n:
                        self._vida_grava_fim(cid, fim, saida.get('vidaMax'), int(time.time() * 1000))
                if not n:
                    raise Recusa(409, 'esse bilhete já foi fechado')
                pub = self._estado_publico(cid)
                return 200, {'ok': True, 'fase': saida['fase'], 'recompensa': None, 'versao': pub['versao'],
                             'hash': pub['hash'], 'progress': pub['progress'], 'db': pub['db'], 'carry': None}
            self._confere_saida(saida)
            carry = saida.get('carry') if isinstance(saida.get('carry'), dict) else None
            try:
                with self._escrita():
                    agora_s = self.con.execute("SELECT estado FROM salas WHERE bilhete = ?", (bilhete,)).fetchone()
                    if agora_s is None or agora_s['estado'] != 'aberta':    # dois fechar juntos: só um paga
                        raise Recusa(409, 'esse bilhete já foi fechado')
                    nova, db = self._estado_grava(conta, estado, saida, t)
                    self.con.execute("UPDATE salas SET estado = 'paga', fechada_em = ?, turnos = ?, carry_saida = ? "
                                     "WHERE bilhete = ?", (t, turnos, json.dumps(carry) if carry is not None else None,
                                                           bilhete))
                    # a espera começa AGORA — o PV do fim e o máximo de cada herói (14/09: na linha do herói)
                    self._vida_grava_fim(cid, fim, saida.get('vidaMax'), int(time.time() * 1000))
                    self._evento(cid, 'sala-paga', {'bilhete': bilhete, 'dungeon': s['dungeon'], 'sala': s['sala'],
                                                    'versao': nova, 'turnos': turnos,
                                                    'novos': [n['iid'] for n in saida['iids']['novos']],
                                                    'guildaXp': saida['guildaXp']})
            except EstadoMudou:
                continue                                        # a mesma semente refaz a mesma sala no estado novo
            return 200, {'ok': True, 'fase': 'won', 'recompensa': saida.get('recompensa'), 'versao': nova,
                         'hash': saida['hash'], 'progress': saida['progress'], 'db': db, 'carry': carry}
        raise Recusa(409, MUDOU_NO_MEIO, **self._estado_publico(cid))

    # -- POST /api/sala/pocao (13/09; 14/09: a rota de antes da vida única) -----------------------------------
    def sala_pocao(self, conta, corpo):
        """Corpo {bilhete, heroId, pocaoId}. A página velha aberta durante o deploy continua bebendo: do
        bilhete só se confere o formato, e o resto é o POST /api/vida/pocao com o heroId do corpo."""
        bilhete = corpo.get('bilhete')
        if not isinstance(bilhete, str) or not RE_BILHETE.match(bilhete):
            raise Recusa(400, 'bilhete inválido')
        return self.vida_pocao(conta, corpo)

    # -- POST /api/op (§4.3) ------------------------------------------------------------------------
    def economia_op(self, conta, corpo):
        """Corpo {hashAntes, ops, hashDepois}. O cliente não manda versão (o PUT
        cosmético também sobe a versão, e uma op que corresse com ele se perderia):
        com um hash guardado para a conta, hashAntes diferente dele é 409 com o
        estado para adotar; sem hash guardado (a última escrita foi o primeiro
        PUT), não há o que comparar."""
        cid = conta['id']
        ops = corpo.get('ops')
        if not isinstance(ops, list) or not 1 <= len(ops) <= OPS_POR_PEDIDO:
            raise Recusa(400, 'ops precisa ser uma lista de 1 a %d operações' % OPS_POR_PEDIDO)
        limpas = []
        for op in ops:
            nome = op.get('nome') if isinstance(op, dict) else None
            if not isinstance(nome, str) or not RE_NOME_OP.match(nome):
                raise Recusa(400, 'op sem nome válido')
            if nome in OPS_INTERNAS:
                raise Recusa(403, 'a operação %s é só do servidor' % nome)
            args = op.get('args')
            if args is None:
                args = {}
            if not isinstance(args, dict):
                raise Recusa(400, 'args da op %s precisa ser um objeto' % nome)
            limpas.append({'nome': nome, 'args': args})
        hash_antes, hash_depois = corpo.get('hashAntes'), corpo.get('hashDepois')
        if hash_antes is not None and not isinstance(hash_antes, str):
            raise Recusa(400, 'hashAntes precisa ser um texto')
        t = agora()
        chave = 'op:%d' % cid
        rebase = False
        with self._escrita():
            estado = self._estado_exige(cid)
            if estado['hash'] is not None and hash_antes != estado['hash']:
                # 03/10: o Mestre pôs algo nesta conta enquanto a op do jogador viajava (moderacao.py,
                # /api/mestre/dar). Se a diferença for só isso, a op sobe por cima da entrega — o jogador não
                # perde o que fez; a resposta leva o estado com as duas coisas (o hashDepois não bate)
                rebase = hasattr(self, '_rebase_entregas') and self._rebase_entregas(cid, hash_antes, estado['hash'])
                if not rebase:
                    raise Recusa(409, 'estado desatualizado: adote o do servidor', versao=estado['versao'],
                                 hash=estado['hash'], progress=estado['progress'], db=estado['db'])
            em = [r[0] for r in self.con.execute("SELECT em FROM limites WHERE chave = ? AND em > ? ORDER BY em",
                                                 (chave, t - 60))]
            if len(em) + len(limpas) > OPS_POR_MINUTO:
                libera = (em[0] if em else t) + 60
                raise Recusa(429, 'operações demais no último minuto (máximo %d)' % OPS_POR_MINUTO, liberaEm=libera)
            # o balde conta as TENTATIVAS (a recusada do juiz também gasta), como os freios da conta.py
            self.con.executemany("INSERT INTO limites(chave, em) VALUES (?, ?)", [(chave, t)] * len(limpas))
            self.con.execute("DELETE FROM limites WHERE chave = ? AND em < ?", (chave, t - 3600))
        nomes_ops = [o['nome'] for o in limpas]
        try:
            saida = self._juiz_op(conta, estado, limpas)
        except Recusa as e:
            if e.status == 422:                                 # a trilha de quem manda op impossível
                with self._escrita():
                    self._evento(cid, 'op-recusada', {'ops': nomes_ops, 'motivo': e.extra.get('motivo'),
                                                      'indice': e.extra.get('indice'), 'erro': e.erro})
            raise
        try:
            with self._escrita():
                nova, db = self._estado_grava(conta, estado, saida, t)
                self._evento(cid, 'op', {'versao': nova, 'ops': nomes_ops,
                                         'novos': [n['iid'] for n in saida['iids']['novos']]})
                # 02/10: a Caixa e as ferramentas do Mestre (as ops gm*) também vão à auditoria (moderacao.py)
                if conta['gm'] and any(n.startswith('gm') for n in nomes_ops) and hasattr(self, '_audita'):
                    self._audita(conta, 'op', cid, {'ops': limpas, 'versao': nova}, t=t)
        except EstadoMudou:
            raise Recusa(409, MUDOU_NO_MEIO, **self._estado_publico(cid))
        resposta = {'ok': True, 'versao': nova, 'hash': saida['hash'], 'resultados': saida.get('resultados') or []}
        if rebase:
            resposta['rebase'] = True          # o jogo guarda a fila que fez enquanto isto viajava (autoridade.js)
        if rebase or hash_depois is None or hash_depois != saida['hash']:
            resposta.update(progress=saida['progress'], db=db)
        return 200, resposta

    # -- a troca com a autoridade ligada (§4.6; o troca do api.py chama) --------------------------------
    def _troca_passo(self, conta, estado, nome, args):
        """Uma op de troca no juiz; devolve (estado depois, resultado, saída)."""
        saida = self._juiz_op(conta, estado, [{'nome': nome, 'args': args}], interno=True)
        res = (saida.get('resultados') or [None])[0]
        return {'progress': saida['progress'], 'db': saida['db']}, res, saida

    def _troca_autoridade(self, conta, com, dou, recebo):
        """As duas intenções já se espelham. O juiz tira do estado de quem dá e põe
        no de quem recebe (quatro pedidos, nenhum dentro da tranca); a gravação dos
        DOIS estados, das séries e da trilha é uma transação só. Um 422 do juiz
        recusa a troca inteira e nada é gravado."""
        cid = conta['id']
        vazio = {'itens': [], 'pets': [], 'moedas': 0}
        for _ in range(TENTATIVAS):
            t = agora()
            with self.tranca:
                outra = self.con.execute("SELECT * FROM contas WHERE id = ?", (com,)).fetchone()
                ea, eb = self._estado_ler(cid), self._estado_ler(com)
                if outra is None or ea is None or eb is None:
                    self.intencoes.pop((cid, com), None)
                    self.intencoes.pop((com, cid), None)
                    raise Recusa(409, 'as duas contas precisam ter o estado no servidor (abrir o jogo logado)')
                outra = dict(outra)
            try:
                trilha = []

                def tira(quem, estado, lado):
                    if lado_vazio(lado):
                        return estado, dict(vazio)
                    depois, res, saida = self._troca_passo(quem, estado, 'trocaTira', lado)
                    trilha.append((quem['id'], saida))
                    if (not isinstance(res, dict) or not isinstance(res.get('itens'), list)
                            or sorted(e.get('iid') for e in res['itens'] if isinstance(e, dict)) != sorted(lado['iids'])
                            or not isinstance(res.get('pets'), list) or len(res['pets']) != len(lado['pets'])
                            or res.get('moedas') != lado['moedas']):
                        raise Recusa(503, 'o juiz respondeu torto na troca — nada foi trocado')
                    return depois, {'itens': res['itens'], 'pets': res['pets'], 'moedas': res['moedas']}

                def poe(quem, estado, veio):
                    if not veio['itens'] and not veio['pets'] and not veio['moedas']:
                        return estado
                    depois, _, saida = self._troca_passo(quem, estado, 'trocaPoe', veio)
                    trilha.append((quem['id'], saida))
                    return depois

                a1, de_a = tira(conta, ea, dou)
                b1, de_b = tira(outra, eb, recebo)
                a2 = poe(conta, a1, de_b)
                b2 = poe(outra, b1, de_a)
            except Recusa as e:
                if e.status == 422:
                    with self._escrita():
                        self.intencoes.pop((cid, com), None)
                        self.intencoes.pop((com, cid), None)
                        dados = {'com': com, 'motivo': e.extra.get('motivo'), 'erro': e.erro}
                        self._evento(cid, 'troca-recusada', dados)
                        self._evento(com, 'troca-recusada', dict(dados, com=cid))
                raise

            movidas = set(dou['iids']) | set(recebo['iids'])

            def saida_de(conta_id, final, lido):
                """As séries novas e as que saíram, somadas dos passos da conta."""
                novos, fora = [], []
                for dono, s in trilha:
                    if dono == conta_id:
                        novos.extend(s['iids']['novos'])
                        fora.extend(s['iids']['fora'])
                passos = [s for dono, s in trilha if dono == conta_id]
                return {'progress': final['progress'], 'db': final['db'], 'guildaXp': 0,
                        'hash': passos[-1]['hash'] if passos else lido['hash'],
                        'iids': {'novos': novos, 'fora': fora}}

            sa, sb = saida_de(cid, a2, ea), saida_de(com, b2, eb)
            try:
                with self._escrita():
                    for iid in dou['iids']:
                        r = self.con.execute("SELECT conta_id, estado FROM itens WHERE iid = ?", (iid,)).fetchone()
                        if r is None or r['conta_id'] != cid or r['estado'] != 'vivo':
                            raise Recusa(409, 'você não tem a instância %s' % iid)
                    for iid in recebo['iids']:
                        r = self.con.execute("SELECT conta_id, estado FROM itens WHERE iid = ?", (iid,)).fetchone()
                        if r is None or r['conta_id'] != com or r['estado'] != 'vivo':
                            raise Recusa(409, 'a outra conta não tem a instância %s' % iid)
                    mia, dele = self.intencoes.get((cid, com)), self.intencoes.get((com, cid))
                    if (mia is None or dele is None or mia['dou'] != chave_do_lado(dou)
                            or dele['dou'] != chave_do_lado(recebo)):
                        raise Recusa(409, 'a troca mudou no meio — registrem de novo')
                    na, dba = self._estado_grava(conta, ea, sa, t, poupar=movidas)
                    nb, _ = self._estado_grava(outra, eb, sb, t, poupar=movidas)
                    self.con.executemany(
                        "UPDATE itens SET conta_id = ?, origem = 'troca', criado_em = ? WHERE iid = ? AND conta_id = ? "
                        "AND estado = 'vivo'",
                        [(com, t, iid, cid) for iid in dou['iids']] + [(cid, t, iid, com) for iid in recebo['iids']])
                    self._evento(cid, 'troca', {'com': com, 'dou': dou, 'recebo': recebo, 'versao': na})
                    self._evento(com, 'troca', {'com': cid, 'dou': recebo, 'recebo': dou, 'versao': nb})
                    self.intencoes.pop((cid, com), None)
                    self.intencoes.pop((com, cid), None)
            except EstadoMudou:
                continue
            log.info("troca feita no servidor: #%d ⇄ #%d (%d/%d peças)", cid, com, len(dou['iids']), len(recebo['iids']))
            return 200, {'ok': True, 'feita': True, 'versao': na, 'hash': sa['hash'], 'progress': sa['progress'],
                         'db': dba}
        raise Recusa(409, MUDOU_NO_MEIO, **self._estado_publico(cid))
