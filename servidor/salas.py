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
CARRY_JANELA = 2 * 3600           # o PV atravessa para a sala seguinte da descida por 2 h
# 13/09 (dono): "carrega 1 pv a cada 2 segundos" — na sala de espera, contado de quando a sala fechou.
# O MESMO número de js/core/data/consumiveis.js (DATA.vidaEntreSalas.msPorPv); a janela de 2 h enche
# qualquer herói bem antes de acabar
VIDA_MS_POR_PV = 2000
REGRAS_CACHE = 300                # segundos que o GET /regras do juiz fica guardado (muda só no deploy)
OPS_POR_PEDIDO = 40               # o OPS_MAX do juiz (servidor/juiz/economia.js)
OPS_POR_MINUTO = 600
LANCES_MAX = 6000                 # o LANCES_MAX do juiz (servidor/juiz/sala.js)
TENTATIVAS = 3                    # quantas vezes refazer quando o estado muda no meio
DIFICULDADES = ('facil', 'normal', 'dificil')
# as ops que só o servidor pede (o juiz também exige contexto.interno): a loja, a troca e o banco da guilda
OPS_INTERNAS = frozenset({'lojaEntregar', 'trocaTira', 'trocaPoe', 'bancoGuildaTira', 'bancoGuildaPoe',
                          # 13/09: o mercadinho entre contas (mercado.py)
                          'mercadoTira', 'mercadoPoe', 'mercadoPaga', 'mercadoRecebe', 'mercadoLegadoTira',
                          # 13/09: a poção bebida na sala de espera (sala_pocao / grupo_pocao)
                          'beberPocao'})
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
-- o último hash da economia que o juiz devolveu para a conta (o cliente compara com o dele)
CREATE TABLE IF NOT EXISTS autoridade(
  conta_id      INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  hash          TEXT,
  atualizado_em INTEGER NOT NULL
);
"""


# ---- miudezas puras -------------------------------------------------------------------
def _objeto(texto):
    try:
        v = json.loads(texto) if texto else None
    except (TypeError, ValueError):
        return None
    return v if isinstance(v, dict) else None


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

    # -- A VIDA ENTRE AS SALAS (13/09) ------------------------------------------------------------
    # O dono: "quando acaba a luta o jogador fica com a vida que terminou a última luta.. carrega 1 pv
    # a cada 2 segundos. se um personagem morre ele vem com a vida zerada aumentando 1 pv a cada 2 s
    # também. aí a poção seria para curar a vida e não precisar esperar para ir para a próxima sala".
    # O relógio é o do SERVIDOR: a sala de espera começa no instante em que a sala vencida fechou.
    def _vida_grava(self, ref, carry, vida_max, fechou_ms, conta_de):
        """Dentro de _escrita: o registro da sala de espera — uma linha por herói do carry.
        `conta_de` = {chave: conta_id}. Sem o máximo (um juiz de antes de 13/09) vale o próprio
        PV do fim: a vida não sobe além do que o herói tinha, e a poção diz 'cheio'."""
        maximos = vida_max if isinstance(vida_max, dict) else {}
        for chave, hp in carry.items():
            conta_id = conta_de.get(chave)
            if not isinstance(chave, str) or conta_id is None or not _inteiro_puro(hp):
                continue
            mx = maximos.get(chave)
            mx = mx if _inteiro_puro(mx) and mx >= 1 else max(1, hp)
            self.con.execute("INSERT OR REPLACE INTO vida_espera(ref, chave, conta_id, hp_fim, hp_max, fechou_ms, cura) "
                             "VALUES (?, ?, ?, ?, ?, ?, 0)", (ref, chave, conta_id, max(0, min(hp, mx)), mx, fechou_ms))

    def _vida_na_porta(self, ref, carry_saida, fechada_em, agora_ms):
        """Dentro da tranca: {chave: {hp, max, conta, fechou_ms}} — a vida de cada herói AGORA:
        min(máximo, PV do fim + tempo desde o fechamento / VIDA_MS_POR_PV + poções bebidas).
        A sala paga de antes do registro (sem linha) sobe só pelo tempo, sem teto (o juiz prende
        no PV máximo da sala nova)."""
        linhas = {r['chave']: r for r in self.con.execute("SELECT * FROM vida_espera WHERE ref = ?", (ref,))}
        vida = {}
        for chave, hp_fim in (carry_saida or {}).items():
            if not isinstance(chave, str) or not isinstance(hp_fim, (int, float)) or isinstance(hp_fim, bool):
                continue
            r = linhas.get(chave)
            fechou = r['fechou_ms'] if r is not None else int(fechada_em or 0) * 1000
            base = (r['hp_fim'] + r['cura']) if r is not None else max(0, int(hp_fim))
            mx = r['hp_max'] if r is not None else None
            hp = base + max(0, agora_ms - fechou) // VIDA_MS_POR_PV
            if mx is not None:
                hp = min(mx, hp)
            vida[chave] = {'hp': int(hp), 'max': mx, 'conta': r['conta_id'] if r is not None else None,
                           'fechou_ms': fechou}
        return vida

    @staticmethod
    def _vida_zerada(vida, agora_ms):
        """(chave, segundos até 1 PV) do primeiro herói ainda a 0, ou None. A 0 só fica quem terminou
        caído, não bebeu e ainda não passou o primeiro intervalo."""
        for chave in sorted(vida):
            v = vida[chave]
            if v['hp'] < 1:
                falta = VIDA_MS_POR_PV - (max(0, agora_ms - v['fechou_ms']) % VIDA_MS_POR_PV)
                return chave, max(1, -(-falta // 1000))
        return None

    def _pocao_na_espera(self, conta, pocao, chave, ler):
        """A POÇÃO NA SALA DE ESPERA (sala_pocao e grupo_pocao). `ler(agora_ms)` roda dentro da
        tranca, confere a descida viva e o herói e devolve {ref, carry, fechada_em} (ou levanta
        Recusa). O juiz tira UMA poção do estado (op interna beberPocao, tudo ou nada) e a cura
        entra no registro da vida do herói na MESMA transação que grava o estado. Recusa: a vida
        já cheia (antes de gastar), sem a poção (o juiz), a descida que acabou (ler)."""
        cid = conta['id']
        if not isinstance(pocao, str) or not RE_NOME_OP.match(pocao.replace('-', '_')):
            raise Recusa(400, 'pocaoId precisa ser o id de uma poção')
        for _ in range(TENTATIVAS):
            with self.tranca:
                agora_ms = int(time.time() * 1000)
                d = ler(agora_ms)
                v = self._vida_na_porta(d['ref'], d['carry'], d['fechada_em'], agora_ms).get(chave)
                if v is None or v['max'] is None:
                    raise Recusa(409, 'essa sala é de antes da vida entre as salas: entre na próxima para beber',
                                 motivo='sem-registro')
                if v['hp'] >= v['max']:
                    raise Recusa(409, 'a vida desse herói já está cheia', motivo='cheio', hp=v['hp'], hpMax=v['max'])
                estado = self._estado_exige(cid)
            saida = self._juiz_op(conta, estado, [{'nome': 'beberPocao', 'args': {'id': pocao}}], interno=True)
            res = (saida.get('resultados') or [None])[0]
            cura = res.get('cura') if isinstance(res, dict) else None
            if not _inteiro_puro(cura) or cura < 1:
                raise Recusa(503, 'o juiz respondeu torto — tente de novo em instantes')
            t = agora()
            try:
                with self._escrita():
                    agora_ms = int(time.time() * 1000)
                    d = ler(agora_ms)                        # a descida ainda viva na hora de gravar
                    v = self._vida_na_porta(d['ref'], d['carry'], d['fechada_em'], agora_ms).get(chave)
                    if v is None or v['max'] is None or v['hp'] >= v['max']:
                        raise Recusa(409, 'a vida desse herói já está cheia', motivo='cheio')
                    nova, db = self._estado_grava(conta, estado, saida, t)
                    self.con.execute("UPDATE vida_espera SET cura = cura + ? WHERE ref = ? AND chave = ?",
                                     (cura, d['ref'], chave))
                    self._evento(cid, 'pocao-espera', {'ref': d['ref'], 'heroi': chave, 'pocao': pocao, 'cura': cura,
                                                       'versao': nova})
            except EstadoMudou:
                continue
            return 200, {'ok': True, 'heroi': chave, 'pocaoId': pocao, 'cura': cura,
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

    def sala_abrir(self, conta, corpo):
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
        t = agora()
        with self._escrita():
            estado = self._estado_exige(cid)
            self._confere_herois(conta, estado['progress'], herois)
            self._confere_teto_salas(cid, t)
            carry = None
            if sala > 0:
                r = self.con.execute(
                    "SELECT bilhete, carry_saida, fechada_em FROM salas WHERE conta_id = ? AND dungeon = ? AND sala = ? "
                    "AND estado = 'paga' AND fechada_em > ? ORDER BY fechada_em DESC LIMIT 1",
                    (cid, dungeon, sala - 1, t - CARRY_JANELA)).fetchone()
                anterior = _objeto(r['carry_saida']) if r is not None else None
                if anterior is not None:
                    # 13/09: a vida da PORTA — o PV do fim, o tempo na sala de espera e as poções bebidas
                    agora_ms = int(time.time() * 1000)
                    vida = self._vida_na_porta(r['bilhete'], anterior, r['fechada_em'], agora_ms)
                    zerado = self._vida_zerada(vida, agora_ms)
                    if zerado:
                        raise Recusa(409, 'o herói %s ainda está sem vida: %d s até recuperar 1 PV (ou beba uma poção)'
                                     % (zerado[0][:64], zerado[1]), motivo='vida-zero', heroi=zerado[0], esperaS=zerado[1])
                    carry = {k: v['hp'] for k, v in vida.items()}
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
                            'carry': _objeto(s['carry'])},
                'lances': lances, 'hashFinal': hash_final,
                'progress': estado['progress'], 'db': estado['db'],
                'contexto': {'agoraMs': int(instante * 1000), 'fatores': fatores, 'guilda': guilda}}
            try:
                saida = self.juiz.pede('POST', '/sala/fecha', pedido)
            except Recusa as e:
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
            if saida['fase'] != 'won':
                # derrota ou sala largada no meio: nada muda no estado (13/09: a poção saiu da batalha,
                # e com ela o desconto das poções bebidas na sala que não venceu)
                with self._escrita():
                    n = self.con.execute("UPDATE salas SET estado = 'perdida', fechada_em = ?, turnos = ? "
                                         "WHERE bilhete = ? AND estado = 'aberta'", (t, turnos, bilhete)).rowcount
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
                    # 13/09: a sala de espera começa AGORA — o PV do fim e o máximo de cada herói
                    if carry is not None:
                        self._vida_grava(bilhete, carry, saida.get('vidaMax'), int(time.time() * 1000), {k: cid for k in carry})
                    self._evento(cid, 'sala-paga', {'bilhete': bilhete, 'dungeon': s['dungeon'], 'sala': s['sala'],
                                                    'versao': nova, 'turnos': turnos,
                                                    'novos': [n['iid'] for n in saida['iids']['novos']],
                                                    'guildaXp': saida['guildaXp']})
            except EstadoMudou:
                continue                                        # a mesma semente refaz a mesma sala no estado novo
            return 200, {'ok': True, 'fase': 'won', 'recompensa': saida.get('recompensa'), 'versao': nova,
                         'hash': saida['hash'], 'progress': saida['progress'], 'db': db, 'carry': carry}
        raise Recusa(409, MUDOU_NO_MEIO, **self._estado_publico(cid))

    # -- POST /api/sala/pocao (13/09, a poção na sala de espera) -------------------------------------
    def sala_pocao(self, conta, corpo):
        """Corpo {bilhete, heroId, pocaoId}. O bilhete é o da sala VENCIDA que abriu a sala de espera
        (a descida solo). A descida está viva enquanto essa sala é a última que a conta abriu, a
        janela do carry não passou e o calabouço tem sala seguinte."""
        cid = conta['id']
        bilhete, heroi, pocao = corpo.get('bilhete'), corpo.get('heroId'), corpo.get('pocaoId')
        if not isinstance(bilhete, str) or not RE_BILHETE.match(bilhete):
            raise Recusa(400, 'bilhete inválido')
        if not isinstance(heroi, str) or not 0 < len(heroi) <= 64:
            raise Recusa(400, 'heroId precisa ser o id de um herói')
        calaboucos = self._regras()['calaboucos']               # sem juiz: 503 (e nunca dentro da tranca)

        def ler(agora_ms):
            s = self.con.execute("SELECT * FROM salas WHERE bilhete = ?", (bilhete,)).fetchone()
            if s is None or s['conta_id'] != cid:                # o de outra conta: a mesma resposta
                raise Recusa(404, 'sala não encontrada')
            if s['estado'] != 'paga' or s['fechada_em'] is None:
                raise Recusa(409, 'essa sala não abriu uma sala de espera', motivo='sem-descida')
            n = calaboucos.get(s['dungeon'])
            if (agora_ms // 1000 - s['fechada_em'] > CARRY_JANELA or not _inteiro_puro(n) or s['sala'] + 1 >= n
                    or self.con.execute("SELECT 1 FROM salas WHERE conta_id = ? AND bilhete != ? AND aberta_em >= ? LIMIT 1",
                                        (cid, bilhete, s['fechada_em'])).fetchone() is not None):
                raise Recusa(409, 'a descida acabou: a poção só se bebe na sala de espera entre as salas',
                             motivo='sem-descida')
            carry = _objeto(s['carry_saida']) or {}
            if heroi not in carry:
                raise Recusa(400, 'o herói %s não desceu nessa sala' % heroi[:64], motivo='heroi')
            return {'ref': bilhete, 'carry': carry, 'fechada_em': s['fechada_em']}

        return self._pocao_na_espera(conta, pocao, heroi, ler)

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
        with self._escrita():
            estado = self._estado_exige(cid)
            if estado['hash'] is not None and hash_antes != estado['hash']:
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
        except EstadoMudou:
            raise Recusa(409, MUDOU_NO_MEIO, **self._estado_publico(cid))
        resposta = {'ok': True, 'versao': nova, 'hash': saida['hash'], 'resultados': saida.get('resultados') or []}
        if hash_depois is None or hash_depois != saida['hash']:
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
