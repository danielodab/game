#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A SALA EM GRUPO e o DUELO RANQUEADO conferidos no servidor (13/09, a autoridade).

Entra no cartório como mixin (`class Api(..., SalasMixin, GrupoMixin)` no api.py) e
usa as peças do SalasMixin (ler o estado, gravar conferindo, o juiz). Importa só de
comum.py e salas.py — nunca do api.py (a armadilha do __main__: ver o topo de comum.py).

A SALA EM GRUPO (POST /api/grupo/abrir e /api/grupo/fechar)
  O líder abre com a dupla toda (a dele e a do parceiro, cada uma conferida no estado
  da própria conta) e o servidor sorteia a semente. Qualquer membro fecha. Com um
  registro LIMPO de lances, o juiz refaz a sala uma vez e paga cada membro no mundo
  dele (POST /grupo/fecha); os DOIS estados, as séries, o dízimo de cada guilda e o
  recibo de cada um são gravados numa transação só. O segundo membro que fecha recebe
  o recibo guardado dele. Registro "fotografado" (o jogo sincronizou por foto, e o
  registro não refaz a sala): não é refeito; se nenhum membro mandar um limpo em
  GRUPO_ESPERA segundos desde o primeiro fechamento, a sala fica 'nao-conferida' e
  não paga ninguém.

O DUELO RANQUEADO (POST /api/duelo/fechar)
  Qualquer um dos dois fecha; o `did` torna o fechamento idempotente (o segundo recebe
  o resultado guardado). Antes do juiz, os tetos contra combinar resultado entre contas
  (DUELOS_POR_PAR e DUELOS_POR_CONTA em 24 h); acima, o duelo vale como amistoso e
  isso fica guardado. Ranqueado, a Brasa muda nos DOIS estados numa transação só, e o
  _resumo leva os pontos ao ranking da arena.
"""
import json
import logging
import re
import secrets
import time

from comum import EstadoMudou, Recusa, agora, inteiro
from salas import (CARRY_JANELA, DIFICULDADES, LANCES_MAX, RE_BILHETE, RE_CALABOUCO, SALA_MIN_S, SALA_S_POR_TURNO,
                   SALA_VALIDADE, TENTATIVAS, _inteiro_puro, _objeto)

log = logging.getLogger('api')

GRUPO_ESPERA = 120                # segundos que um fechamento fotografado espera um registro limpo
DUELOS_POR_PAR = 3                # duelos ranqueados entre as mesmas duas contas, em 24 h
DUELOS_POR_CONTA = 20             # duelos ranqueados de uma conta, em 24 h
DUELO_JANELA = 24 * 3600
RE_DONO = re.compile(r'^[\x21-\x7e]{1,64}$')
RE_DID = re.compile(r'^[A-Za-z0-9_:-]{8,64}$')
NAO_CONFERIDA = 'a sala em grupo teve uma sincronização por foto e não pôde ser conferida'

ESQUEMA_GRUPO = """
-- a sala em grupo (13/09). Além das colunas do contrato: motivo (o porquê de recusada ou
-- nao-conferida), primeiro_fecho e fotografadas (quem fechou por foto) para a espera.
-- Tabelas NOVAS, nunca ALTER (o rolling update divide o banco)
CREATE TABLE IF NOT EXISTS salas_grupo(
  gid            TEXT PRIMARY KEY,
  lider_id       INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  membro_id      INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  dungeon        TEXT NOT NULL,
  sala           INTEGER NOT NULL,
  dificuldade    TEXT NOT NULL,
  semente        INTEGER NOT NULL,
  party          TEXT NOT NULL,
  carry          TEXT,
  aberta_em      INTEGER NOT NULL,
  fechada_em     INTEGER,
  estado         TEXT NOT NULL DEFAULT 'aberta'
    CHECK (estado IN ('aberta', 'paga', 'perdida', 'recusada', 'vencida', 'nao-conferida')),
  carry_saida    TEXT,
  motivo         TEXT,
  primeiro_fecho INTEGER,
  fotografadas   TEXT
);
CREATE INDEX IF NOT EXISTS salas_grupo_lider ON salas_grupo(lider_id, aberta_em);
CREATE INDEX IF NOT EXISTS salas_grupo_membro ON salas_grupo(membro_id, aberta_em);
CREATE TABLE IF NOT EXISTS salas_grupo_pago(
  gid         TEXT NOT NULL REFERENCES salas_grupo(gid) ON DELETE CASCADE,
  conta_id    INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  recompensa  TEXT,
  PRIMARY KEY (gid, conta_id)
);
-- o duelo ranqueado (13/09): uma linha por did, com o resultado guardado (idempotente)
CREATE TABLE IF NOT EXISTS duelos(
  did        TEXT PRIMARY KEY,
  a_id       INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  b_id       INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  fase       TEXT NOT NULL,
  venc       TEXT,
  criado_em  INTEGER NOT NULL,
  resultado  TEXT
);
CREATE INDEX IF NOT EXISTS duelos_a ON duelos(a_id, criado_em);
CREATE INDEX IF NOT EXISTS duelos_b ON duelos(b_id, criado_em);
"""


def _herois(v, campo):
    if (not isinstance(v, list) or not 1 <= len(v) <= 2 or any(not isinstance(h, str) or not 0 < len(h) <= 64 for h in v)
            or len(set(v)) != len(v)):
        raise Recusa(400, '%s precisa ser uma lista de 1 ou 2 heróis diferentes' % campo)
    return list(v)


def _dono(v, campo):
    if not isinstance(v, str) or not RE_DONO.match(v):
        raise Recusa(400, '%s precisa ser o id de rede do jogador' % campo)
    return v


def _lances(corpo):
    lances, hash_final = corpo.get('lances'), corpo.get('hashFinal')
    if lances is None:
        lances = []
    if not isinstance(lances, list) or len(lances) > LANCES_MAX:
        raise Recusa(400, 'lances precisa ser uma lista de até %d lances' % LANCES_MAX)
    if hash_final is not None and not _inteiro_puro(hash_final):
        raise Recusa(400, 'hashFinal precisa ser um inteiro ou null')
    return lances, hash_final


def _conta_da_chave(party):
    """{dono:heroId: conta} da party guardada da sala em grupo — a chave do carry de cada herói
    com a conta que o levou. Montada da party (e não cortando a chave no ':'), porque o id de
    rede do dono pode ter ':'."""
    fora = {}
    for p in party if isinstance(party, list) else []:
        if isinstance(p, dict) and isinstance(p.get('dono'), str) and isinstance(p.get('herois'), list):
            for h in p['herois']:
                if isinstance(h, str):
                    fora[p['dono'] + ':' + h] = p.get('conta')
    return fora


class GrupoMixin:

    # -- POST /api/grupo/pocao (13/09, a poção na sala de espera do grupo) ---------------------------
    def grupo_pocao(self, conta, corpo):
        """Corpo {gid, heroId, pocaoId}. O gid é o da sala em grupo VENCIDA que abriu a sala de espera.
        Cada jogador cura só os PRÓPRIOS heróis, com as próprias poções: a chave é dono:heroId do
        membro que pede, e a poção sai do estado dele."""
        cid = conta['id']
        gid, heroi, pocao = corpo.get('gid'), corpo.get('heroId'), corpo.get('pocaoId')
        if not isinstance(gid, str) or not RE_BILHETE.match(gid):
            raise Recusa(400, 'gid inválido')
        if not isinstance(heroi, str) or not 0 < len(heroi) <= 64:
            raise Recusa(400, 'heroId precisa ser o id de um herói')
        calaboucos = self._regras()['calaboucos']               # sem juiz: 503 (e nunca dentro da tranca)
        achada = {}

        def ler(agora_ms):
            g = self.con.execute("SELECT * FROM salas_grupo WHERE gid = ?", (gid,)).fetchone()
            if g is None or cid not in (g['lider_id'], g['membro_id']):
                raise Recusa(404, 'sala em grupo não encontrada')
            if g['estado'] != 'paga' or g['fechada_em'] is None:
                raise Recusa(409, 'essa sala não abriu uma sala de espera', motivo='sem-descida')
            n = calaboucos.get(g['dungeon'])
            depois = (self.con.execute("SELECT 1 FROM salas_grupo WHERE gid != ? AND aberta_em >= ? "
                                       "AND (lider_id = ? OR membro_id = ?) LIMIT 1",
                                       (gid, g['fechada_em'], cid, cid)).fetchone() is not None
                      or self.con.execute("SELECT 1 FROM salas WHERE conta_id = ? AND aberta_em >= ? LIMIT 1",
                                          (cid, g['fechada_em'])).fetchone() is not None)
            if agora_ms // 1000 - g['fechada_em'] > CARRY_JANELA or not _inteiro_puro(n) or g['sala'] + 1 >= n or depois:
                raise Recusa(409, 'a descida acabou: a poção só se bebe na sala de espera entre as salas',
                             motivo='sem-descida')
            dono = next((p.get('dono') for p in json.loads(g['party']) if isinstance(p, dict) and p.get('conta') == cid
                         and heroi in (p.get('herois') or [])), None)
            carry = _objeto(g['carry_saida']) or {}
            if not isinstance(dono, str) or (dono + ':' + heroi) not in carry:
                raise Recusa(400, 'o herói %s não é seu nessa sala: cada um cura os próprios' % heroi[:64], motivo='heroi')
            achada['chave'] = dono + ':' + heroi
            return {'ref': gid, 'carry': carry, 'fechada_em': g['fechada_em']}

        # a chave (dono:heroId) só se sabe lendo a sala: uma leitura antes, dentro da tranca
        with self.tranca:
            ler(int(time.time() * 1000))
        return self._pocao_na_espera(conta, pocao, achada['chave'], ler)

    def _conta_viva(self, cid):
        """Dentro da tranca: a linha da conta (dict), ou None se não existe ou foi banida."""
        r = self.con.execute("SELECT * FROM contas WHERE id = ?", (cid,)).fetchone()
        return dict(r) if r is not None and not r['banido'] else None

    # -- POST /api/grupo/abrir ------------------------------------------------------------------
    def grupo_abrir(self, conta, corpo):
        cid = conta['id']
        dungeon, sala, dificuldade = corpo.get('dungeonId'), corpo.get('roomIndex'), corpo.get('dificuldade')
        if not isinstance(dungeon, str) or not RE_CALABOUCO.match(dungeon):
            raise Recusa(400, 'dungeonId precisa ser o id de um calabouço')
        if not _inteiro_puro(sala) or sala < 0:
            raise Recusa(400, 'roomIndex precisa ser um inteiro a partir de 0')
        dificuldade = 'normal' if dificuldade is None else dificuldade
        if dificuldade not in DIFICULDADES:
            raise Recusa(400, 'dificuldade precisa ser facil, normal ou dificil')
        herois, dono = _herois(corpo.get('herois'), 'herois'), _dono(corpo.get('dono'), 'dono')
        parc = corpo.get('parceiro')
        if not isinstance(parc, dict):
            raise Recusa(400, 'parceiro precisa ser {conta, dono, herois}')
        pid = parc.get('conta')
        if not _inteiro_puro(pid) or pid < 1:
            raise Recusa(400, 'parceiro.conta precisa ser o id de uma conta')
        if pid == cid:
            raise Recusa(400, 'o parceiro precisa ser outra conta')
        herois_p, dono_p = _herois(parc.get('herois'), 'parceiro.herois'), _dono(parc.get('dono'), 'parceiro.dono')
        if dono_p == dono:
            raise Recusa(400, 'os dois membros com o mesmo dono')
        regras = self._regras()                                   # sem juiz: 503
        n = regras['calaboucos'].get(dungeon)
        if not _inteiro_puro(n):
            raise Recusa(400, 'calabouço desconhecido ou fechado')
        if sala >= n:
            raise Recusa(400, 'essa sala não existe nesse calabouço (são %d)' % n)
        t = agora()
        with self._escrita():
            parceiro = self._conta_viva(pid)
            if parceiro is None:
                raise Recusa(404, 'conta do parceiro não encontrada')
            meu = self._estado_exige(cid)
            dele = self._estado_ler(pid)
            if dele is None:
                raise Recusa(409, 'o parceiro ainda não tem o estado no servidor: ele precisa abrir o jogo logado')
            self._confere_herois(conta, meu['progress'], herois)
            self._confere_herois(parceiro, dele['progress'], herois_p, 'da conta do parceiro')
            self._confere_teto_salas(cid, t)
            carry = None
            if sala > 0:
                r = self.con.execute(
                    "SELECT gid, carry_saida, fechada_em FROM salas_grupo WHERE estado = 'paga' AND dungeon = ? AND sala = ? "
                    "AND fechada_em > ? AND ((lider_id = ? AND membro_id = ?) OR (lider_id = ? AND membro_id = ?)) "
                    "ORDER BY fechada_em DESC LIMIT 1", (dungeon, sala - 1, t - CARRY_JANELA, cid, pid, pid, cid)).fetchone()
                anterior = _objeto(r['carry_saida']) if r is not None else None
                if anterior is not None:
                    # 13/09: a vida da porta de CADA herói do grupo (as poções de cada um entram na dele);
                    # a sala só abre com todos de pé — o botão de quem lidera espera o mesmo
                    agora_ms = int(time.time() * 1000)
                    vida = self._vida_na_porta(r['gid'], anterior, r['fechada_em'], agora_ms)
                    zerado = self._vida_zerada(vida, agora_ms)
                    if zerado:
                        raise Recusa(409, 'o herói %s ainda está sem vida: %d s até recuperar 1 PV (ou beba uma poção)'
                                     % (zerado[0][:64], zerado[1]), motivo='vida-zero', heroi=zerado[0], esperaS=zerado[1])
                    carry = {k: v['hp'] for k, v in vida.items()}
            # uma sala em grupo aberta por dupla: abrir outra vence a anterior
            self.con.execute("UPDATE salas_grupo SET estado = 'vencida', fechada_em = ? WHERE estado = 'aberta' "
                             "AND ((lider_id = ? AND membro_id = ?) OR (lider_id = ? AND membro_id = ?))",
                             (t, cid, pid, pid, cid))
            gid, semente = secrets.token_urlsafe(18), secrets.randbits(31)
            party = [{'conta': cid, 'dono': dono, 'herois': herois}, {'conta': pid, 'dono': dono_p, 'herois': herois_p}]
            self.con.execute(
                "INSERT INTO salas_grupo(gid, lider_id, membro_id, dungeon, sala, dificuldade, semente, party, carry, "
                "aberta_em, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberta')",
                (gid, cid, pid, dungeon, sala, dificuldade, semente, json.dumps(party),
                 json.dumps(carry) if carry is not None else None, t))
        return 200, {'ok': True, 'gid': gid, 'semente': semente, 'carry': carry}

    # -- POST /api/grupo/fechar ------------------------------------------------------------------
    def _grupo_marca(self, gid, estado, motivo, t, evento=None):
        with self._escrita():
            linha = self.con.execute("SELECT lider_id, membro_id FROM salas_grupo WHERE gid = ?", (gid,)).fetchone()
            n = self.con.execute("UPDATE salas_grupo SET estado = ?, motivo = ?, fechada_em = ? WHERE gid = ? "
                                 "AND estado = 'aberta'", (estado, motivo, t, gid)).rowcount
            if n and evento and linha is not None:
                for quem in (linha['lider_id'], linha['membro_id']):
                    self._evento(quem, evento, {'gid': gid, 'motivo': motivo})
        return n

    def _grupo_fechada(self, cid, gid):
        """A resposta de uma sala que já fechou: o recibo guardado de quem pede (paga) ou o porquê."""
        with self.tranca:
            g = self.con.execute("SELECT estado, motivo, carry_saida FROM salas_grupo WHERE gid = ?", (gid,)).fetchone()
            pago = self.con.execute("SELECT recompensa FROM salas_grupo_pago WHERE gid = ? AND conta_id = ?",
                                    (gid, cid)).fetchone()
        if g['estado'] == 'vencida':
            raise Recusa(410, 'sala em grupo vencida: abram de novo')
        if g['estado'] == 'paga':
            pub = self._estado_publico(cid)
            return 200, dict({'ok': True, 'fase': 'won', 'recompensa': json.loads(pago['recompensa']) if pago else None,
                              'carry': _objeto(g['carry_saida'])}, **pub)
        resposta = {'ok': True, 'fase': g['estado'], 'recompensa': None, 'motivo': g['motivo']}
        if g['estado'] == 'nao-conferida':
            resposta['erro'] = NAO_CONFERIDA
        return 200, resposta

    def grupo_fechar(self, conta, corpo):
        """Corpo {gid, lances, hashFinal, fotografada, autoridade}. `autoridade` (o cliente
        dizendo se está com a autoridade ligada) é aceito e ignorado: quem decide é o servidor."""
        cid = conta['id']
        gid = corpo.get('gid')
        if not isinstance(gid, str) or not RE_BILHETE.match(gid):
            raise Recusa(400, 'gid inválido')
        lances, hash_final = _lances(corpo)
        fotografada = corpo.get('fotografada') is True
        for _ in range(TENTATIVAS):
            instante = time.time()
            t = int(instante)
            acao = None
            with self._escrita():
                g = self.con.execute("SELECT * FROM salas_grupo WHERE gid = ?", (gid,)).fetchone()
                if g is None or cid not in (g['lider_id'], g['membro_id']):
                    raise Recusa(404, 'sala em grupo não encontrada')
                fotos = json.loads(g['fotografadas']) if g['fotografadas'] else []
                if g['estado'] != 'aberta':
                    acao = 'fechada'
                elif t - g['aberta_em'] > SALA_VALIDADE:
                    self.con.execute("UPDATE salas_grupo SET estado = 'vencida', fechada_em = ? WHERE gid = ?", (t, gid))
                    acao = 'fechada'
                elif fotos and g['primeiro_fecho'] is not None and t >= g['primeiro_fecho'] + GRUPO_ESPERA:
                    acao = 'nao-conferida'                  # a espera pelo registro limpo acabou
                elif fotografada:
                    if cid not in fotos:
                        fotos.append(cid)
                    primeiro = g['primeiro_fecho'] if g['primeiro_fecho'] is not None else t
                    self.con.execute("UPDATE salas_grupo SET fotografadas = ?, primeiro_fecho = ? WHERE gid = ?",
                                     (json.dumps(fotos), primeiro, gid))
                    acao = 'aguarda'
                elif instante - g['aberta_em'] < SALA_MIN_S:
                    acao = 'rapido'
                else:
                    if g['primeiro_fecho'] is None:
                        self.con.execute("UPDATE salas_grupo SET primeiro_fecho = ? WHERE gid = ?", (t, gid))
                    party = json.loads(g['party'])
                    membros = []
                    for p in party:
                        linha = self.con.execute("SELECT * FROM contas WHERE id = ?", (p['conta'],)).fetchone()
                        if linha is None:
                            raise Recusa(409, 'uma das contas do grupo não existe mais')
                        membros.append({'p': p, 'conta': dict(linha), 'estado': self._estado_exige(p['conta']),
                                        'guilda': self._guilda_contexto(p['conta'], t)})
                    fatores = self._fatores_no_ar(t)
                    acao = 'juiz'
            if acao == 'fechada':
                return self._grupo_fechada(cid, gid)
            if acao == 'nao-conferida':
                self._grupo_marca(gid, 'nao-conferida', 'fotografada', t, 'grupo-nao-conferida')
                return self._grupo_fechada(cid, gid)
            if acao == 'aguarda':
                return 200, {'ok': True, 'fase': 'aguardando', 'recompensa': None,
                             'esperaAte': (g['primeiro_fecho'] or t) + GRUPO_ESPERA}
            if acao == 'rapido':
                self._grupo_marca(gid, 'recusada', 'rapido-demais', t, 'grupo-recusada')
                raise Recusa(422, 'a sala fechou rápido demais para ser de verdade', motivo='rapido-demais')
            pedido = {
                'membros': [{'conta': {'id': m['conta']['id'], 'gm': bool(m['conta']['gm'])}, 'dono': m['p']['dono'],
                             'herois': m['p']['herois'], 'progress': m['estado']['progress'], 'db': m['estado']['db'],
                             'guilda': m['guilda']} for m in membros],
                'ata': {'dungeonId': g['dungeon'], 'roomIndex': g['sala'], 'dificuldade': g['dificuldade'],
                        'semente': g['semente'], 'carry': _objeto(g['carry'])},
                'lances': lances, 'hashFinal': hash_final,
                'contexto': {'agoraMs': int(instante * 1000), 'fatores': fatores}}
            try:
                saida = self.juiz.pede('POST', '/grupo/fecha', pedido)
            except Recusa as e:
                if e.status == 422:
                    self._grupo_marca(gid, 'recusada', e.extra.get('motivo') or 'juiz', t, 'grupo-recusada')
                raise
            if (not isinstance(saida, dict) or saida.get('ok') is not True or not isinstance(saida.get('fase'), str)
                    or not isinstance(saida.get('membros'), list)):
                raise Recusa(503, 'o juiz respondeu torto — tente de novo em instantes')
            turnos = max(0, inteiro(saida.get('turnosJogador')))
            minimo = max(SALA_MIN_S, SALA_S_POR_TURNO * turnos)
            if instante - g['aberta_em'] < minimo:
                self._grupo_marca(gid, 'recusada', 'rapido-demais', t, 'grupo-recusada')
                raise Recusa(422, 'a sala fechou rápido demais para ser de verdade', motivo='rapido-demais')
            if saida['fase'] != 'won':
                # derrota: nada muda nos estados (13/09: a poção saiu da batalha, e com ela o desconto)
                self._grupo_marca(gid, 'perdida', None, t)
                return self._grupo_fechada(cid, gid)
            por_conta = {m.get('contaId'): m for m in saida['membros'] if isinstance(m, dict)}
            pagos = []
            for m in membros:
                s = por_conta.get(m['conta']['id'])
                if s is None:
                    raise Recusa(503, 'o juiz respondeu torto — tente de novo em instantes')
                pagos.append((m, self._confere_saida(dict(s, ok=True))))
            carry = saida.get('carry') if isinstance(saida.get('carry'), dict) else None
            try:
                with self._escrita():
                    agora_g = self.con.execute("SELECT estado FROM salas_grupo WHERE gid = ?", (gid,)).fetchone()
                    if agora_g['estado'] != 'aberta':
                        raise EstadoMudou()                 # o outro membro fechou junto: a volta seguinte lê o recibo
                    for m, s in pagos:
                        nova, _ = self._estado_grava(m['conta'], m['estado'], s, t)
                        self.con.execute("INSERT INTO salas_grupo_pago(gid, conta_id, recompensa) VALUES (?, ?, ?)",
                                         (gid, m['conta']['id'], json.dumps(s.get('recompensa'), ensure_ascii=False)))
                        self._evento(m['conta']['id'], 'grupo-paga', {
                            'gid': gid, 'dungeon': g['dungeon'], 'sala': g['sala'], 'versao': nova, 'turnos': turnos,
                            'novos': [n['iid'] for n in s['iids']['novos']], 'guildaXp': s['guildaXp'],
                            'por': cid})
                    self.con.execute("UPDATE salas_grupo SET estado = 'paga', fechada_em = ?, carry_saida = ? WHERE gid = ?",
                                     (t, json.dumps(carry) if carry is not None else None, gid))
                    # 13/09: a sala de espera do grupo começa agora; cada herói com a conta do dono dele
                    if carry is not None:
                        self._vida_grava(gid, carry, saida.get('vidaMax'), int(time.time() * 1000),
                                         _conta_da_chave(json.loads(g['party'])))
            except EstadoMudou:
                continue
            log.info("sala em grupo paga: %s (#%d e #%d)", gid, g['lider_id'], g['membro_id'])
            return self._grupo_fechada(cid, gid)
        raise Recusa(409, 'o estado de uma das contas mudou no meio — tente de novo')

    # -- POST /api/duelo/fechar ---------------------------------------------------------------------
    def _duelo_resposta(self, cid, linha_ou_resultado):
        res = linha_ou_resultado
        pub = self._estado_publico(cid)
        delta = (res.get('delta') or {}).get(str(cid), 0)
        resposta = {'ok': True, 'fase': res.get('fase'), 'venc': res.get('venc'), 'ranqueado': bool(res.get('ranqueado')),
                    'delta': delta}
        if res.get('motivo'):
            resposta['motivo'] = res['motivo']
        resposta.update(pub)
        return 200, resposta

    def _duelo_guardado(self, cid, did):
        with self.tranca:
            r = self.con.execute("SELECT * FROM duelos WHERE did = ?", (did,)).fetchone()
        if r is None:
            return None
        if cid not in (r['a_id'], r['b_id']):
            raise Recusa(404, 'duelo não encontrado')
        return self._duelo_resposta(cid, _objeto(r['resultado']) or {'fase': r['fase'], 'venc': r['venc']})

    def _duelo_guarda(self, did, a_id, b_id, resultado, t):
        """Dentro de _escrita: a linha do duelo (falha de chave = o outro lado guardou antes)."""
        self.con.execute("INSERT INTO duelos(did, a_id, b_id, fase, venc, criado_em, resultado) VALUES (?, ?, ?, ?, ?, ?, ?)",
                         (did, a_id, b_id, resultado['fase'], resultado.get('venc'), t,
                          json.dumps(resultado, ensure_ascii=False)))

    def _duelo_teto(self, a_id, b_id, t):
        """Dentro da tranca: o motivo de NÃO ranquear (os tetos de 24 h), ou None."""
        de = t - DUELO_JANELA
        par = self.con.execute(
            "SELECT COUNT(*) FROM duelos WHERE venc IS NOT NULL AND criado_em > ? "
            "AND ((a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?))", (de, a_id, b_id, b_id, a_id)).fetchone()[0]
        if par >= DUELOS_POR_PAR:
            return 'teto'
        for quem in (a_id, b_id):
            n = self.con.execute("SELECT COUNT(*) FROM duelos WHERE venc IS NOT NULL AND criado_em > ? "
                                 "AND (a_id = ? OR b_id = ?)", (de, quem, quem)).fetchone()[0]
            if n >= DUELOS_POR_CONTA:
                return 'teto'
        return None

    def duelo_fechar(self, conta, corpo):
        """Corpo {did, dungeonId, roomIndex, semente, A:{conta, dono, herois}, B:{…}, lances, hashFinal,
        fotografada}. Ranqueado = o juiz viu um fim (venc não nulo); só esse conta nos tetos."""
        cid = conta['id']
        did = corpo.get('did')
        if not isinstance(did, str) or not RE_DID.match(did):
            raise Recusa(400, 'did inválido')
        guardado = self._duelo_guardado(cid, did)
        if guardado is not None:
            return guardado
        dungeon, sala, semente = corpo.get('dungeonId'), corpo.get('roomIndex'), corpo.get('semente')
        if not isinstance(dungeon, str) or not RE_CALABOUCO.match(dungeon):
            raise Recusa(400, 'dungeonId precisa ser o id de um calabouço')
        if not _inteiro_puro(sala) or sala < 0:
            raise Recusa(400, 'roomIndex precisa ser um inteiro a partir de 0')
        if not _inteiro_puro(semente) or not 0 <= semente < 2 ** 32:
            raise Recusa(400, 'semente precisa ser um inteiro de 32 bits')
        lados = {}
        for k in ('A', 'B'):
            v = corpo.get(k)
            if not isinstance(v, dict) or not _inteiro_puro(v.get('conta')) or v['conta'] < 1:
                raise Recusa(400, '%s precisa ser {conta, dono, herois}' % k)
            lados[k] = {'conta': v['conta'], 'dono': _dono(v.get('dono'), k + '.dono'),
                        'herois': _herois(v.get('herois'), k + '.herois')}
        a_id, b_id = lados['A']['conta'], lados['B']['conta']
        if a_id == b_id:
            raise Recusa(400, 'duelo contra a própria conta não vale')
        if cid not in (a_id, b_id):
            raise Recusa(403, 'só quem duelou fecha o duelo')
        lances, hash_final = _lances(corpo)
        for _ in range(TENTATIVAS):
            t = agora()
            with self._escrita():
                if self.con.execute("SELECT 1 FROM duelos WHERE did = ?", (did,)).fetchone():
                    acao = 'guardado'
                else:
                    contas = {k: self._conta_viva(lados[k]['conta']) for k in lados}
                    if any(c is None for c in contas.values()):
                        raise Recusa(404, 'conta do duelo não encontrada')
                    if corpo.get('fotografada') is True:
                        # sincronizado por foto: o registro não refaz o duelo; vale como amistoso
                        self._duelo_guarda(did, a_id, b_id, {'fase': 'nao-conferido', 'venc': None, 'ranqueado': False,
                                                             'motivo': 'fotografada'}, t)
                        acao = 'guardado'
                    elif self._duelo_teto(a_id, b_id, t):
                        self._duelo_guarda(did, a_id, b_id, {'fase': 'teto', 'venc': None, 'ranqueado': False,
                                                             'motivo': 'teto'}, t)
                        for quem in (a_id, b_id):
                            self._evento(quem, 'duelo-teto', {'did': did, 'a': a_id, 'b': b_id})
                        acao = 'guardado'
                    else:
                        estados = {'A': self._estado_exige(a_id), 'B': self._estado_ler(b_id)}
                        if estados['B'] is None:
                            raise Recusa(409, 'a outra conta ainda não tem o estado no servidor')
                        if cid == b_id:
                            estados['A'] = self._estado_ler(a_id)
                        acao = 'juiz'
            if acao == 'guardado':
                return self._duelo_guardado(cid, did)
            pedido = {k: {'conta': {'id': lados[k]['conta'], 'gm': bool(contas[k]['gm'])}, 'dono': lados[k]['dono'],
                          'herois': lados[k]['herois'], 'progress': estados[k]['progress'], 'db': estados[k]['db']}
                      for k in lados}
            pedido.update(dungeonId=dungeon, roomIndex=sala, semente=semente, lances=lances, hashFinal=hash_final,
                          contexto={'agoraMs': int(time.time() * 1000)})
            try:
                saida = self.juiz.pede('POST', '/duelo/fecha', pedido)
            except Recusa as e:
                if e.status == 422:
                    with self._escrita():
                        if not self.con.execute("SELECT 1 FROM duelos WHERE did = ?", (did,)).fetchone():
                            self._duelo_guarda(did, a_id, b_id, {'fase': 'recusado', 'venc': None, 'ranqueado': False,
                                                                 'motivo': e.extra.get('motivo') or 'juiz'}, t)
                            for quem in (a_id, b_id):
                                self._evento(quem, 'duelo-recusado', {'did': did, 'motivo': e.extra.get('motivo'),
                                                                      'erro': e.erro})
                raise
            if not isinstance(saida, dict) or saida.get('ok') is not True or not isinstance(saida.get('fase'), str):
                raise Recusa(503, 'o juiz respondeu torto — tente de novo em instantes')
            venc = saida.get('venc') if saida.get('venc') in ('A', 'B', 'empate') else None
            ranqueado = bool(saida.get('ranqueado')) and venc is not None
            resultado = {'fase': saida['fase'], 'venc': venc, 'ranqueado': ranqueado, 'delta': {}}
            if ranqueado:
                lado_saida = {}
                for k in lados:
                    s = saida.get(k)
                    if not isinstance(s, dict):
                        raise Recusa(503, 'o juiz respondeu torto — tente de novo em instantes')
                    lado_saida[k] = self._confere_saida({'ok': True, 'progress': s.get('progress'), 'db': s.get('db'),
                                                         'hash': s.get('hash'), 'iids': {'novos': [], 'fora': []},
                                                         'guildaXp': 0})
                    resultado['delta'][str(lados[k]['conta'])] = inteiro(s.get('delta'))
            try:
                with self._escrita():
                    if self.con.execute("SELECT 1 FROM duelos WHERE did = ?", (did,)).fetchone():
                        raise EstadoMudou()                 # o outro lado fechou junto: a volta seguinte lê o guardado
                    if ranqueado and self._duelo_teto(a_id, b_id, t):
                        resultado = {'fase': 'teto', 'venc': None, 'ranqueado': False, 'motivo': 'teto'}
                    elif ranqueado:
                        for k in lados:
                            nova, _ = self._estado_grava(contas[k], estados[k], lado_saida[k], t)
                            self._evento(lados[k]['conta'], 'duelo-ranqueado', {
                                'did': did, 'venc': venc, 'lado': k, 'versao': nova,
                                'delta': resultado['delta'][str(lados[k]['conta'])],
                                'contra': lados['B' if k == 'A' else 'A']['conta']})
                    self._duelo_guarda(did, a_id, b_id, resultado, t)
            except EstadoMudou:
                continue
            return self._duelo_resposta(cid, resultado)
        raise Recusa(409, 'o estado de uma das contas mudou no meio — tente de novo')
