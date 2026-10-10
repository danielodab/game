#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""O QUADRO DA ARENA — o PvP ranqueado por inscrição (14/09).

O pedido do dono: "na inscrição de pvp onde ele se inscreve na arena para esperar que alguém aceite o desafio...
esse ele pré-seleciona as duas classes já e quem vai desafiar consegue ver.. essa inscrição dá ranking na coroa
também". Não é casamento automático: é um QUADRO DE INSCRITOS, e quem desafia escolhe quem.

Entra no cartório como mixin (`class Api(..., ArenaMixin)` no api.py) e usa as peças do SalasMixin (o estado do
servidor, a vida de cada herói). Importa só de comum.py e grupo.py — nunca do api.py.

AS ROTAS
  POST /api/arena/inscrever {herois: [2 ids, em ordem]}  a inscrição PÚBLICA (1 herói só se a conta só tem 1 que
        pode lutar). Os heróis são da conta, nenhum a 0 PV agora (409 vida-zero); o nível é o do herói MAIS FORTE
        no estado do servidor. Uma inscrição por conta: inscrever de novo troca os heróis sem perder o lugar.
  GET  /api/arena/quadro    {ok, agoraMs, paridade, inscritos: [{conta, nome, nivel, brasa, classes: [{classId,
        nivel}], desdeMs, eu}]} — os inscritos livres, do mais antigo ao mais novo (QUADRO_MAX)
  POST /api/arena/desafiar {alvo: conta, herois: [2]}    quem desafia escolhe um inscrito: a paridade (até
        ARENA_PARIDADE entre os mais fortes) e a vida dos dois lados conferidas aqui; o inscrito sai do quadro e a
        partida fica 'casada' — as classes de quem desafia aparecem para o inscrito
  POST /api/arena/confirmar   "vou" — os dois confirmados em ARENA_CONFIRMA_MS = 'pronta' com o did
  POST /api/arena/recusar     a partida casada cai: o inscrito volta ao quadro com o lugar de antes, quem desafiou
                              fica livre (o mesmo quando o prazo passa)
  POST /api/arena/sair        sai da inscrição (ou desfaz a partida casada/pronta)
  GET  /api/arena/estado      {ok, agoraMs, fase: livre | inscrito | casada | pronta, ...}
       inscrito  {desdeMs, herois, classes, nivel}
       casada    {papel: inscrito|desafiante, lado, prazoMs, confirmei, eleConfirmou, herois, classes, nivel,
                  adversario: {conta, nome, nivel, brasa, herois, classes}}
       pronta    {did, papel, lado, herois, classes, nivel, adversario[, torneio: id — 10/10, a luta de um
                  torneio (torneio.py): nasce pronta, sem quadro nem confirmação, e fica até a luta fechar]}
  O inscrito consulta o estado a cada 2-3 s; a consulta é também o "ainda estou aqui" (sem ela há ARENA_VISTO_MS,
  a inscrição sai do quadro: a aba fechada não fica esperando desafio).

A PARTIDA PRONTA: lado A = o inscrito, lado B = quem desafiou, e as DUPLAS JÁ SÃO PÚBLICAS (sem escolha às cegas).
Os dois clientes seguem o duelo pela Rede com o did daqui e o modo 'arena'; o POST /api/duelo/fechar só ranqueia
com a partida pronta desse did entre essas duas contas, com ESSES heróis de cada lado, e na paridade (grupo.py).
DECISÃO: o inimigo marcado (amigos.py) aparece no quadro e pode desafiar — no ranqueado, esconder alguém seria um
jeito de fugir de quem se teme.
"""
import json
import logging
import secrets
import time

from comum import Recusa, agora, classe_do_heroi, liberadas
from grupo import PARIDADE, _herois, _nivel_forte

log = logging.getLogger('api')

ARENA_PARIDADE = PARIDADE['arena']   # 3 níveis entre os mais fortes (o dono, 03/10; eram 5)
ARENA_CONFIRMA_MS = 30000            # o tempo de os dois confirmarem
ARENA_VISTO_MS = 20000               # o inscrito que não consulta há tanto sai do quadro
ARENA_PRONTA_MS = 180000             # a partida pronta aparece no estado por tanto (a luta já começou bem antes)
ARENA_PEDIDOS_POR_HORA = 120         # inscrições e desafios por conta, por hora (limites)
QUADRO_MAX = 50

ESQUEMA_ARENA = """
-- o quadro da Arena (14/09). Tabelas NOVAS, nunca ALTER (o rolling update divide o banco). Tempos em ms.
CREATE TABLE IF NOT EXISTS arena_inscritos(
  conta_id   INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  herois     TEXT NOT NULL,
  classes    TEXT NOT NULL,
  nivel      INTEGER NOT NULL,
  desde_ms   INTEGER NOT NULL,
  visto_ms   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS arena_inscritos_desde ON arena_inscritos(desde_ms);
-- a = o inscrito (lado A), b = quem desafiou (lado B)
CREATE TABLE IF NOT EXISTS arena_partidas(
  did         TEXT PRIMARY KEY,
  a_id        INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  b_id        INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  a_herois    TEXT NOT NULL,
  b_herois    TEXT NOT NULL,
  a_classes   TEXT NOT NULL,
  b_classes   TEXT NOT NULL,
  a_nivel     INTEGER NOT NULL,
  b_nivel     INTEGER NOT NULL,
  a_desde_ms  INTEGER NOT NULL,
  a_ok        INTEGER NOT NULL DEFAULT 0,
  b_ok        INTEGER NOT NULL DEFAULT 0,
  criada_ms   INTEGER NOT NULL,
  prazo_ms    INTEGER NOT NULL,
  pronta_ms   INTEGER,
  estado      TEXT NOT NULL DEFAULT 'casada' CHECK (estado IN ('casada', 'pronta', 'caiu', 'jogada'))
);
CREATE INDEX IF NOT EXISTS arena_partidas_a ON arena_partidas(a_id, estado);
CREATE INDEX IF NOT EXISTS arena_partidas_b ON arena_partidas(b_id, estado);
"""


def _ms():
    return int(time.time() * 1000)


def herois_usaveis(progress):
    """Os heróis da conta que podem ir à Arena: a classe conhecida e liberada, e nunca o Mestre do Fundo."""
    fichas = progress.get('heroes') if isinstance(progress, dict) else None
    fichas = fichas if isinstance(fichas, dict) else {}
    lib = liberadas(progress)
    return [hid for hid, h in fichas.items()
            if isinstance(h, dict) and classe_do_heroi(hid, h) not in (None, 'gm') and classe_do_heroi(hid, h) in lib]


def classes_de(progress, herois):
    """[{classId, nivel}] dos heróis, na ordem da escolha — o que o quadro mostra de cada lado."""
    fichas = progress.get('heroes') if isinstance(progress, dict) else {}
    out = []
    for h in herois:
        f = fichas.get(h) if isinstance(fichas, dict) else None
        lv = f.get('level') if isinstance(f, dict) else None
        out.append({'classId': classe_do_heroi(h, f) if isinstance(f, dict) else None,
                    'nivel': lv if isinstance(lv, int) and not isinstance(lv, bool) and lv >= 1 else 1})
    return out


class ArenaMixin:

    # -- as peças (todas dentro de _escrita) -----------------------------------------------------------
    def _arena_confere_dupla(self, conta, corpo, agora_ms):
        """Os heróis do pedido: da conta, nenhum Mestre, os DOIS quando a conta tem dois, nenhum a 0 PV.
        Devolve (herois, progress)."""
        herois = _herois(corpo.get('herois'), 'herois')
        estado = self._estado_exige(conta['id'])
        self._confere_herois(conta, estado['progress'], herois)
        usaveis = herois_usaveis(estado['progress'])
        if any(h not in usaveis for h in herois):
            raise Recusa(400, 'o Mestre do Fundo não entra na Arena', motivo='mestre')
        # 14/09 (o dono): "esse ele pré-seleciona as duas classes já"
        if len(herois) < 2 and len(usaveis) >= 2:
            raise Recusa(400, 'escolha os dois heróis que vão lutar', motivo='dois')
        self._vida_recusa_zero(self._vida_de(conta['id'], herois, agora_ms))
        return herois, estado['progress']

    def _arena_limite(self, cid):
        t, chave = agora(), 'arena:%d' % cid
        em = [x[0] for x in self.con.execute("SELECT em FROM limites WHERE chave = ? AND em > ? ORDER BY em",
                                             (chave, t - 3600))]
        if len(em) >= ARENA_PEDIDOS_POR_HORA:
            raise Recusa(429, 'pedidos demais à Arena na última hora (máximo %d)' % ARENA_PEDIDOS_POR_HORA,
                         liberaEm=em[len(em) - ARENA_PEDIDOS_POR_HORA] + 3600)
        self.con.execute("INSERT INTO limites(chave, em) VALUES (?, ?)", (chave, t))
        self.con.execute("DELETE FROM limites WHERE chave = ? AND em < ?", (chave, t - 3600))

    def _arena_volta_ao_quadro(self, p, agora_ms):
        """A partida casada caiu: o inscrito volta ao quadro com o lugar de antes (se não estiver noutra)."""
        if self._arena_partida_de(p['a_id'], agora_ms) is not None:
            return
        self.con.execute("INSERT OR IGNORE INTO arena_inscritos(conta_id, herois, classes, nivel, desde_ms, visto_ms) "
                         "VALUES (?, ?, ?, ?, ?, ?)",
                         (p['a_id'], p['a_herois'], p['a_classes'], p['a_nivel'], p['a_desde_ms'], agora_ms))

    def _arena_arruma(self, agora_ms):
        vencidas = self.con.execute("SELECT * FROM arena_partidas WHERE estado = 'casada' AND prazo_ms < ?",
                                    (agora_ms,)).fetchall()
        for p in vencidas:
            self.con.execute("UPDATE arena_partidas SET estado = 'caiu' WHERE did = ?", (p['did'],))
            self._arena_volta_ao_quadro(p, agora_ms)
        self.con.execute("DELETE FROM arena_inscritos WHERE visto_ms < ?", (agora_ms - ARENA_VISTO_MS,))

    def _arena_partida_de(self, cid, agora_ms):
        """A partida viva da conta (dos dois lados): a casada, ou a pronta de há pouco (ARENA_PRONTA_MS).
        10/10, o Torneio da Arena (torneio.py): a partida pronta que o torneio abriu aparece até a luta FECHAR —
        ela não tem a janela de 180 s (a luta de torneio pode durar 30 min e o cliente que recarrega a página
        precisa reencontrá-la) — e passa na frente da partida do quadro."""
        return self.con.execute(
            "SELECT * FROM arena_partidas WHERE (a_id = ? OR b_id = ?) AND (estado = 'casada' OR "
            "(estado = 'pronta' AND (pronta_ms >= ? OR did IN (SELECT did FROM torneio_lutas WHERE estado = 'luta')))) "
            "ORDER BY (did IN (SELECT did FROM torneio_lutas WHERE estado = 'luta')) DESC, criada_ms DESC LIMIT 1",
            (cid, cid, agora_ms - ARENA_PRONTA_MS)).fetchone()

    def _arena_brasa(self, cid):
        estado = self._estado_ler(cid)
        db = (estado or {}).get('db') if estado else None
        b = ((db or {}).get('jogador') or {}).get('brasa') if isinstance(db, dict) else None
        pts = b.get('pts') if isinstance(b, dict) else None
        return int(pts) if isinstance(pts, (int, float)) and not isinstance(pts, bool) else 1000

    def _arena_nome(self, cid):
        linha = self.con.execute("SELECT nome FROM contas WHERE id = ?", (cid,)).fetchone()
        return linha['nome'] if linha is not None else '?'

    def _arena_estado(self, cid, agora_ms):
        p = self._arena_partida_de(cid, agora_ms)
        if p is not None:
            lado = 'A' if p['a_id'] == cid else 'B'
            eu, ele = ('a', 'b') if lado == 'A' else ('b', 'a')
            r = {'ok': True, 'agoraMs': agora_ms, 'fase': p['estado'], 'lado': lado,
                 'papel': 'inscrito' if lado == 'A' else 'desafiante',
                 'herois': json.loads(p[eu + '_herois']), 'classes': json.loads(p[eu + '_classes']),
                 'nivel': p[eu + '_nivel'],
                 'adversario': {'conta': p[ele + '_id'], 'nome': self._arena_nome(p[ele + '_id']),
                                'nivel': p[ele + '_nivel'], 'brasa': self._arena_brasa(p[ele + '_id']),
                                'herois': json.loads(p[ele + '_herois']), 'classes': json.loads(p[ele + '_classes'])}}
            if p['estado'] == 'casada':
                r.update(prazoMs=p['prazo_ms'], confirmei=bool(p[eu + '_ok']), eleConfirmou=bool(p[ele + '_ok']))
            else:
                r['did'] = p['did']
                # 10/10: a partida pronta de um TORNEIO leva o id dele (docs/TORNEIO.md §2) — é por aqui que o
                # cliente entrega a luta ao Duelo sabendo que ela não mexe na coroa nem na vida
                achar = getattr(self, '_torneio_do_did', None)
                torneio = achar(p['did']) if achar is not None else None
                if torneio is not None:
                    r['torneio'] = torneio
            return r
        f = self.con.execute("SELECT * FROM arena_inscritos WHERE conta_id = ?", (cid,)).fetchone()
        if f is not None:
            self.con.execute("UPDATE arena_inscritos SET visto_ms = ? WHERE conta_id = ?", (agora_ms, cid))
            return {'ok': True, 'agoraMs': agora_ms, 'fase': 'inscrito', 'desdeMs': f['desde_ms'],
                    'herois': json.loads(f['herois']), 'classes': json.loads(f['classes']), 'nivel': f['nivel']}
        return {'ok': True, 'agoraMs': agora_ms, 'fase': 'livre'}

    # -- para o grupo.py (o duelo_fechar) ---------------------------------------------------------------
    def _arena_partida(self, did, a_id, b_id):
        """Dentro da tranca: a partida pronta (ou jogada) desse did entre essas duas contas, como
        {conta: [heróis]}, ou None."""
        p = self.con.execute(
            "SELECT * FROM arena_partidas WHERE did = ? AND estado IN ('pronta', 'jogada') "
            "AND ((a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?))", (did, a_id, b_id, b_id, a_id)).fetchone()
        if p is None:
            return None
        return {p['a_id']: json.loads(p['a_herois']), p['b_id']: json.loads(p['b_herois'])}

    def _arena_jogada(self, did):
        self.con.execute("UPDATE arena_partidas SET estado = 'jogada' WHERE did = ? AND estado = 'pronta'", (did,))

    # -- POST /api/arena/inscrever ------------------------------------------------------------------------
    def arena_inscrever(self, conta, corpo):
        # 15/09: a luta que a conta deixou aberta no servidor fica largada antes (salas.py, _com_largada)
        return self._com_largada(conta, lambda: self._arena_inscrever(conta, corpo))

    def _arena_inscrever(self, conta, corpo):
        cid = conta['id']
        if not self._autoridade_ligada():
            raise Recusa(503, 'o juiz do servidor não está configurado: a Arena ranqueada não abre')
        agora_ms = _ms()
        with self._escrita():
            herois, progress = self._arena_confere_dupla(conta, corpo, agora_ms)
            self._arena_limite(cid)
            self._arena_arruma(agora_ms)
            if self._arena_partida_de(cid, agora_ms) is not None:
                raise Recusa(409, 'você já tem uma partida da Arena em andamento', motivo='casada')
            antes = self.con.execute("SELECT desde_ms FROM arena_inscritos WHERE conta_id = ?", (cid,)).fetchone()
            self.con.execute(
                "INSERT OR REPLACE INTO arena_inscritos(conta_id, herois, classes, nivel, desde_ms, visto_ms) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (cid, json.dumps(herois), json.dumps(classes_de(progress, herois)), _nivel_forte(progress, herois),
                 antes['desde_ms'] if antes is not None else agora_ms, agora_ms))
            return 200, self._arena_estado(cid, agora_ms)

    # -- GET /api/arena/quadro --------------------------------------------------------------------------------
    def arena_quadro(self, conta, corpo):
        cid, agora_ms = conta['id'], _ms()
        with self._escrita():
            self._arena_arruma(agora_ms)
            linhas = self.con.execute("SELECT * FROM arena_inscritos ORDER BY desde_ms, conta_id LIMIT ?",
                                      (QUADRO_MAX,)).fetchall()
            inscritos = [{'conta': f['conta_id'], 'nome': self._arena_nome(f['conta_id']), 'nivel': f['nivel'],
                          'brasa': self._arena_brasa(f['conta_id']), 'classes': json.loads(f['classes']),
                          'desdeMs': f['desde_ms'], 'eu': f['conta_id'] == cid} for f in linhas]
        return 200, {'ok': True, 'agoraMs': agora_ms, 'paridade': ARENA_PARIDADE, 'inscritos': inscritos}

    # -- POST /api/arena/desafiar ------------------------------------------------------------------------------
    def arena_desafiar(self, conta, corpo):
        return self._com_largada(conta, lambda: self._arena_desafiar(conta, corpo))   # 15/09: a largada antes

    def _arena_desafiar(self, conta, corpo):
        cid = conta['id']
        alvo = corpo.get('alvo')
        if not isinstance(alvo, int) or isinstance(alvo, bool) or alvo < 1:
            raise Recusa(400, 'alvo precisa ser a conta de um inscrito')
        if alvo == cid:
            raise Recusa(400, 'não dá para desafiar a própria inscrição')
        if not self._autoridade_ligada():
            raise Recusa(503, 'o juiz do servidor não está configurado: a Arena ranqueada não abre')
        agora_ms = _ms()
        with self._escrita():
            herois, progress = self._arena_confere_dupla(conta, corpo, agora_ms)
            self._arena_limite(cid)
            self._arena_arruma(agora_ms)
            if self._arena_partida_de(cid, agora_ms) is not None:
                raise Recusa(409, 'você já tem uma partida da Arena em andamento', motivo='casada')
            if self.con.execute("SELECT 1 FROM arena_inscritos WHERE conta_id = ?", (cid,)).fetchone():
                raise Recusa(409, 'saia da sua inscrição antes de desafiar outra', motivo='inscrito')
            f = self.con.execute("SELECT * FROM arena_inscritos WHERE conta_id = ?", (alvo,)).fetchone()
            if f is None:
                raise Recusa(409, 'essa inscrição não está mais no quadro', motivo='sem-inscricao')
            nivel = _nivel_forte(progress, herois)
            if abs(nivel - f['nivel']) > ARENA_PARIDADE:
                raise Recusa(409, 'a diferença de nível entre os heróis mais fortes passa de %d' % ARENA_PARIDADE,
                             motivo='paridade', nivel=nivel, nivelDele=f['nivel'])
            herois_alvo = json.loads(f['herois'])
            zerados = [h for h, v in self._vida_de(alvo, herois_alvo, agora_ms).items() if v['hp'] < 1]
            if zerados:
                raise Recusa(409, 'um herói dessa inscrição está sem vida agora', motivo='vida-zero-alvo')
            did = 'arena-' + secrets.token_hex(10)
            self.con.execute(
                "INSERT INTO arena_partidas(did, a_id, b_id, a_herois, b_herois, a_classes, b_classes, a_nivel, b_nivel, "
                "a_desde_ms, criada_ms, prazo_ms, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'casada')",
                (did, alvo, cid, f['herois'], json.dumps(herois), f['classes'], json.dumps(classes_de(progress, herois)),
                 f['nivel'], nivel, f['desde_ms'], agora_ms, agora_ms + ARENA_CONFIRMA_MS))
            self.con.execute("DELETE FROM arena_inscritos WHERE conta_id = ?", (alvo,))
            self._evento(alvo, 'arena-desafiado', {'did': did, 'por': cid})
            return 200, self._arena_estado(cid, agora_ms)

    # -- POST /api/arena/confirmar -------------------------------------------------------------------------
    def arena_confirmar(self, conta, corpo):
        cid, agora_ms = conta['id'], _ms()
        with self._escrita():
            self._arena_arruma(agora_ms)
            p = self._arena_partida_de(cid, agora_ms)
            if p is None:
                raise Recusa(409, 'não há partida para confirmar (o prazo pode ter passado)', motivo='sem-partida')
            if p['estado'] == 'casada':
                eu = 'a' if p['a_id'] == cid else 'b'
                outro_ok = p[('b' if eu == 'a' else 'a') + '_ok']
                self.con.execute("UPDATE arena_partidas SET %s_ok = 1 WHERE did = ?" % eu, (p['did'],))
                if outro_ok:
                    self.con.execute("UPDATE arena_partidas SET estado = 'pronta', pronta_ms = ? WHERE did = ?",
                                     (agora_ms, p['did']))
                    for quem in (p['a_id'], p['b_id']):
                        self._evento(quem, 'arena-pronta', {'did': p['did']})
            return 200, self._arena_estado(cid, agora_ms)

    # -- POST /api/arena/recusar -----------------------------------------------------------------------------
    def arena_recusar(self, conta, corpo):
        cid, agora_ms = conta['id'], _ms()
        with self._escrita():
            self._arena_arruma(agora_ms)
            p = self._arena_partida_de(cid, agora_ms)
            if p is not None and p['estado'] == 'casada':
                self.con.execute("UPDATE arena_partidas SET estado = 'caiu' WHERE did = ?", (p['did'],))
                self._arena_volta_ao_quadro(p, agora_ms)
            return 200, self._arena_estado(cid, agora_ms)

    # -- POST /api/arena/sair --------------------------------------------------------------------------------
    def arena_sair(self, conta, corpo):
        cid, agora_ms = conta['id'], _ms()
        with self._escrita():
            self._arena_arruma(agora_ms)
            self.con.execute("DELETE FROM arena_inscritos WHERE conta_id = ?", (cid,))
            p = self._arena_partida_de(cid, agora_ms)
            # 10/10: a partida de um torneio não se desfaz por aqui (sair do torneio é POST /api/torneio/sair, e
            # vale como W.O.) — sair do quadro no meio da luta do torneio não some com a luta
            do_torneio = getattr(self, '_torneio_do_did', None)
            if p is not None and do_torneio is not None and do_torneio(p['did']) is not None:
                return 200, self._arena_estado(cid, agora_ms)
            if p is not None:
                self.con.execute("UPDATE arena_partidas SET estado = 'caiu' WHERE did = ?", (p['did'],))
                if p['estado'] == 'casada' and p['b_id'] == cid:
                    self._arena_volta_ao_quadro(p, agora_ms)   # quem desafiou desistiu: o inscrito volta ao quadro
        return 200, {'ok': True, 'agoraMs': agora_ms, 'fase': 'livre'}

    # -- GET /api/arena/estado ------------------------------------------------------------------------------
    def arena_estado(self, conta, corpo):
        cid, agora_ms = conta['id'], _ms()
        with self._escrita():
            self._arena_arruma(agora_ms)
            return 200, self._arena_estado(cid, agora_ms)
