#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A GUERRA DE GUILDA 2×2 NA SEDE (15/09).

O pedido do dono: "a guerra de guild que é 2x2 de cada guild é na sede de guild, isso dá pontos de experiência
para guild". As decisões dele: cada jogador leva a DUPLA (2 heróis → 8 heróis na mesa); a guerra começa por FILA NA
SEDE — uma dupla de jogadores da mesma guilda se inscreve, o jogo casa com a dupla de outra guilda e os QUATRO
confirmam; e "quando for pras arenas, pvp, guerra de guild etc.. pede para ele selecionar os dois que ele quer ir
para a batalha".

Entra no cartório como mixin (`class Api(..., GuerraMixin)` no api.py) e usa as peças do SalasMixin (o estado, a
vida de cada herói), do GuildaMixin (a guilda da conta, os nomes) e do ArenaMixin (a conferência da dupla). Importa
só de comum.py, grupo.py e guilda.py — nunca do api.py.

AS ROTAS (todas com conta; sem juiz, 503)
  POST /api/guerra/inscrever {parceiro: conta, herois: [2], dono}   quem lidera o grupo põe a dupla dele e diz com
        quem vai (a conta do parceiro, da MESMA guilda). A inscrição fica 'aguardando' até o parceiro se juntar
        (GUERRA_JUNTAR_MS); inscrever de novo troca os heróis e zera a vez do parceiro.
  POST /api/guerra/juntar {herois: [2], dono}   o parceiro põe a dupla dele: a inscrição vale (entra na fila com o
        nível do herói mais forte dos QUATRO) e o casamento é tentado na hora.
  POST /api/guerra/confirmar   "vou" — os quatro confirmados em GUERRA_CONFIRMA_MS = 'pronta' (gid e semente do
        servidor; a ata com os oito heróis sai do juiz logo depois)
  POST /api/guerra/recusar     a partida casada cai: o lado de quem recusou sai, o outro volta à fila com o lugar
  POST /api/guerra/sair        sai da inscrição (a dupla de jogadores inteira) ou recusa a casada
  GET  /api/guerra/estado      {ok, agoraMs, fase: livre | aguardando | convite | inscrito | casada | pronta, ...}
       aguardando  (quem lidera) {parceiro: {conta, nome}, herois, prazoMs}
       convite     (o parceiro)  {lider: {conta, nome}, prazoMs}
       inscrito    {desdeMs, nivel, herois, parceiro | lider}
       casada      {prazoMs, lado, herois, confirmei, guildas: {A, B}, aliados: [{conta, nome, confirmou, eu}],
                    adversarios: [{conta, nome, confirmou}]} — as DUPLAS dos adversários ficam OCULTAS
       pronta      {gid, lado, herois, semente, guildas, jogadores: [{conta, nome, dono, lado, ordem}], ata | null}
  POST /api/guerra/fechar {gid, lances, hashFinal, fotografada}   qualquer um dos quatro fecha; idempotente por gid
       → {ok, gid, fase, venc, lado, venceu, xp, guilda, motivo, guildas, vida}
  Quem espera consulta o estado a cada 2-3 s; a consulta é o "ainda estou aqui" (GUERRA_VISTO_MS).

AS DECISÕES (15/09)
  - A PARIDADE (decisão do coordenador): até GUERRA_PARIDADE níveis entre o herói MAIS FORTE de cada guilda-dupla
    (os quatro heróis de cada lado), lidos nos estados do SERVIDOR. Casa a inscrição mais antiga com a mais antiga
    de OUTRA guilda que caiba.
  - SURPRESA: no 'casada' cada um vê a guilda e os NOMES dos adversários, nunca os heróis; as duplas só aparecem na
    ata, com a partida pronta (os quatro já confirmaram).
  - O PRAZO: quem não confirmou sai; o lado que confirmou inteiro volta à fila com o lugar de antes.
  - A ATA É DO SERVIDOR: os oito payloads saem do juiz (Progress.battleParty no estado de cada conta) e a vida de
    cada herói da linha da conta dele — o cliente não escolhe com quanto entra nem com que números luta.
  - O XP (decisão do coordenador): GUERRA_XP (40) para a guilda vencedora, dividido na contribuição dos dois que
    lutaram por ela; a perdedora não perde; empate, W.O. e desistência não rendem. A COROA NÃO MUDA (a Brasa é do PvP
    individual). Tetos contra combinação: GUERRAS_XP_POR_PAR com XP entre as mesmas duas guildas e
    GUERRAS_XP_POR_GUILDA por guilda em 24 h; acima, a guerra vale sem XP e o motivo fica guardado.
  - A VIDA dos oito heróis grava na conta de cada um em qualquer fim refeito (vitória, empate, W.O.).
  - Registro fotografado (o jogo sincronizou por foto) não refaz: espera GUERRA_ESPERA s um registro limpo de outro
    dos quatro; sem ele, 'nao-conferida' (sem XP e sem vida).
  - RISCO ACEITO (o mesmo do duelo): o primeiro registro limpo que o juiz refaz vale — um cliente mexido pode
    escrever lances do adversário que ele não fez. O tempo mínimo (0,35 s por turno de gente) e os tetos seguram o
    farm; o XP é da guilda e não vira moeda.
"""
import json
import logging
import re
import secrets
import time

from comum import EstadoMudou, Recusa, agora, inteiro
from grupo import _dono, _lances, _nivel_forte
from salas import SALA_MIN_S, SALA_S_POR_TURNO, TENTATIVAS, _inteiro_puro, _objeto

log = logging.getLogger('api')

GUERRA_XP = 40                      # XP da guerra vencida para a guilda (decisão do coordenador, 15/09)
GUERRA_PARIDADE = 10                # níveis entre o herói mais forte de cada guilda-dupla (idem)
GUERRA_CONFIRMA_MS = 30000          # o tempo de os quatro confirmarem
GUERRA_JUNTAR_MS = 60000            # o tempo de o parceiro pôr a dupla dele
GUERRA_VISTO_MS = 20000             # quem não consulta há tanto sai da fila (a aba fechada não espera guerra)
GUERRA_PRONTA_MS = 180000           # a partida pronta aparece no estado por tanto
GUERRA_ESPERA = 120                 # segundos que um fechamento fotografado espera um registro limpo
GUERRAS_XP_POR_PAR = 3              # guerras com XP entre as mesmas duas guildas, em 24 h
GUERRAS_XP_POR_GUILDA = 10          # guerras com XP de uma guilda (vencendo ou perdendo), em 24 h
GUERRA_JANELA = 24 * 3600
GUERRA_PEDIDOS_POR_HORA = 120       # inscrever + juntar por conta, por hora
MAPA_GUERRA = 'sede'                # js/core/data/arenas.js: 4 P a oeste (lado A), 4 letras a leste (lado B)
RE_GID_GUERRA = re.compile(r'^guerra-[0-9a-f]{20}$')

ESQUEMA_GUERRA = """
-- a guerra de guilda 2x2 (15/09). Tabelas NOVAS, nunca ALTER (o rolling update divide o banco). Tempos em ms,
-- menos guerra_resultados.criado_em e guerra_partidas.primeiro_fecho (segundos, como duelos e salas_grupo)
CREATE TABLE IF NOT EXISTS guerra_inscricoes(
  lider_id          INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  parceiro_id       INTEGER NOT NULL UNIQUE REFERENCES contas(id) ON DELETE CASCADE,
  guilda_id         INTEGER NOT NULL,
  lider_herois      TEXT NOT NULL,
  lider_dono        TEXT NOT NULL,
  parceiro_herois   TEXT,
  parceiro_dono     TEXT,
  nivel             INTEGER NOT NULL DEFAULT 1,
  criada_ms         INTEGER NOT NULL,
  desde_ms          INTEGER,
  lider_visto_ms    INTEGER NOT NULL,
  parceiro_visto_ms INTEGER
);
CREATE INDEX IF NOT EXISTS guerra_inscricoes_desde ON guerra_inscricoes(desde_ms);
CREATE TABLE IF NOT EXISTS guerra_partidas(
  gid             TEXT PRIMARY KEY,
  a_guilda        INTEGER NOT NULL,
  b_guilda        INTEGER NOT NULL,
  criada_ms       INTEGER NOT NULL,
  prazo_ms        INTEGER NOT NULL,
  pronta_ms       INTEGER,
  semente         INTEGER,
  ata             TEXT,
  primeiro_fecho  INTEGER,
  fotografadas    TEXT,
  estado          TEXT NOT NULL DEFAULT 'casada' CHECK (estado IN ('casada', 'pronta', 'caiu', 'fechada'))
);
CREATE INDEX IF NOT EXISTS guerra_partidas_estado ON guerra_partidas(estado, prazo_ms);
-- os quatro de cada partida: ordem 0 = quem inscreveu, 1 = quem se juntou; desde_ms = o lugar na fila
CREATE TABLE IF NOT EXISTS guerra_jogadores(
  gid        TEXT NOT NULL REFERENCES guerra_partidas(gid) ON DELETE CASCADE,
  conta_id   INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  lado       TEXT NOT NULL CHECK (lado IN ('A', 'B')),
  ordem      INTEGER NOT NULL,
  guilda_id  INTEGER NOT NULL,
  dono       TEXT NOT NULL,
  herois     TEXT NOT NULL,
  nivel      INTEGER NOT NULL,
  desde_ms   INTEGER NOT NULL,
  ok         INTEGER NOT NULL DEFAULT 0,
  carry      TEXT,
  PRIMARY KEY (gid, conta_id)
);
CREATE INDEX IF NOT EXISTS guerra_jogadores_conta ON guerra_jogadores(conta_id);
-- o resultado guardado (idempotente por gid); xp > 0 é o que os tetos contam
CREATE TABLE IF NOT EXISTS guerra_resultados(
  gid        TEXT PRIMARY KEY,
  fase       TEXT NOT NULL,
  venc       TEXT,
  xp         INTEGER NOT NULL DEFAULT 0,
  guilda_xp  INTEGER,
  a_guilda   INTEGER NOT NULL,
  b_guilda   INTEGER NOT NULL,
  criado_em  INTEGER NOT NULL,
  resultado  TEXT
);
CREATE INDEX IF NOT EXISTS guerra_resultados_a ON guerra_resultados(a_guilda, criado_em);
CREATE INDEX IF NOT EXISTS guerra_resultados_b ON guerra_resultados(b_guilda, criado_em);
"""


def _ms():
    return int(time.time() * 1000)


class GuerraMixin:

    # -- as peças (todas dentro de _escrita) -----------------------------------------------------------
    def _guerra_limite(self, cid):
        t, chave = agora(), 'guerra:%d' % cid
        em = [x[0] for x in self.con.execute("SELECT em FROM limites WHERE chave = ? AND em > ? ORDER BY em",
                                             (chave, t - 3600))]
        if len(em) >= GUERRA_PEDIDOS_POR_HORA:
            raise Recusa(429, 'pedidos demais à guerra na última hora (máximo %d)' % GUERRA_PEDIDOS_POR_HORA,
                         liberaEm=em[len(em) - GUERRA_PEDIDOS_POR_HORA] + 3600)
        self.con.execute("INSERT INTO limites(chave, em) VALUES (?, ?)", (chave, t))
        self.con.execute("DELETE FROM limites WHERE chave = ? AND em < ?", (chave, t - 3600))

    def _guerra_guilda_id(self, cid):
        g, _ = self._g_membro(cid)
        return g['id'] if g is not None else None

    def _guerra_guilda_info(self, gid):
        g = self.con.execute("SELECT id, nome, emblema FROM guildas WHERE id = ?", (gid,)).fetchone()
        if g is None:
            return {'id': gid, 'nome': '?', 'emblema': '⚑'}
        return {'id': g['id'], 'nome': g['nome'], 'emblema': g['emblema']}

    def _guerra_partida_de(self, cid, agora_ms):
        """A partida viva da conta: a casada, ou a pronta de há pouco (GUERRA_PRONTA_MS) ainda sem resultado."""
        return self.con.execute(
            "SELECT p.* FROM guerra_partidas p JOIN guerra_jogadores j ON j.gid = p.gid WHERE j.conta_id = ? "
            "AND (p.estado = 'casada' OR (p.estado = 'pronta' AND p.pronta_ms >= ?)) ORDER BY p.criada_ms DESC LIMIT 1",
            (cid, agora_ms - GUERRA_PRONTA_MS)).fetchone()

    def _guerra_jogadores(self, gid):
        return self.con.execute("SELECT * FROM guerra_jogadores WHERE gid = ? ORDER BY lado, ordem", (gid,)).fetchall()

    def _guerra_inscricao_de(self, cid):
        return self.con.execute("SELECT * FROM guerra_inscricoes WHERE lider_id = ? OR parceiro_id = ?",
                                (cid, cid)).fetchone()

    def _guerra_volta_a_fila(self, lado_js, agora_ms):
        """Um lado inteiro de uma partida que caiu volta à fila com o lugar de antes (se nenhum dos dois está
        noutra partida ou inscrição)."""
        if len(lado_js) != 2:
            return
        for j in lado_js:
            if self._guerra_partida_de(j['conta_id'], agora_ms) is not None or self._guerra_inscricao_de(j['conta_id']):
                return
        l, p = sorted(lado_js, key=lambda j: j['ordem'])
        self.con.execute(
            "INSERT OR IGNORE INTO guerra_inscricoes(lider_id, parceiro_id, guilda_id, lider_herois, lider_dono, "
            "parceiro_herois, parceiro_dono, nivel, criada_ms, desde_ms, lider_visto_ms, parceiro_visto_ms) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (l['conta_id'], p['conta_id'], l['guilda_id'], l['herois'], l['dono'], p['herois'], p['dono'], l['nivel'],
             l['desde_ms'], l['desde_ms'], agora_ms, agora_ms))

    def _guerra_cai(self, p, agora_ms, volta):
        """A partida casada cai; os lados em `volta` ('A', 'B') voltam à fila."""
        self.con.execute("UPDATE guerra_partidas SET estado = 'caiu' WHERE gid = ? AND estado = 'casada'", (p['gid'],))
        js = self._guerra_jogadores(p['gid'])
        for lado in volta:
            self._guerra_volta_a_fila([j for j in js if j['lado'] == lado], agora_ms)
        for j in js:
            self._evento(j['conta_id'], 'guerra-caiu', {'gid': p['gid']})

    def _guerra_arruma(self, agora_ms):
        # o prazo da confirmação: quem não confirmou sai, o lado que confirmou inteiro volta à fila
        for p in self.con.execute("SELECT * FROM guerra_partidas WHERE estado = 'casada' AND prazo_ms < ?",
                                  (agora_ms,)).fetchall():
            js = self._guerra_jogadores(p['gid'])
            inteiros = [lado for lado in ('A', 'B') if all(j['ok'] for j in js if j['lado'] == lado)]
            self._guerra_cai(p, agora_ms, inteiros)
        self.con.execute("DELETE FROM guerra_inscricoes WHERE parceiro_herois IS NULL AND criada_ms < ?",
                         (agora_ms - GUERRA_JUNTAR_MS,))
        self.con.execute("DELETE FROM guerra_inscricoes WHERE lider_visto_ms < ? OR "
                         "(parceiro_visto_ms IS NOT NULL AND parceiro_visto_ms < ?)",
                         (agora_ms - GUERRA_VISTO_MS, agora_ms - GUERRA_VISTO_MS))
        self._guerra_casa(agora_ms)

    def _guerra_casa(self, agora_ms):
        """O casamento: a inscrição completa mais antiga com a mais antiga de OUTRA guilda dentro da paridade."""
        fila = self.con.execute("SELECT * FROM guerra_inscricoes WHERE desde_ms IS NOT NULL "
                                "ORDER BY desde_ms, lider_id").fetchall()
        usados = set()
        for i, a in enumerate(fila):
            if a['lider_id'] in usados:
                continue
            for b in fila[i + 1:]:
                if b['lider_id'] in usados or b['guilda_id'] == a['guilda_id']:
                    continue
                if abs(a['nivel'] - b['nivel']) > GUERRA_PARIDADE:
                    continue
                self._guerra_cria(a, b, agora_ms)
                usados.update((a['lider_id'], b['lider_id']))
                break

    def _guerra_cria(self, a, b, agora_ms):
        gid = 'guerra-' + secrets.token_hex(10)
        self.con.execute("INSERT INTO guerra_partidas(gid, a_guilda, b_guilda, criada_ms, prazo_ms, estado) "
                         "VALUES (?, ?, ?, ?, ?, 'casada')",
                         (gid, a['guilda_id'], b['guilda_id'], agora_ms, agora_ms + GUERRA_CONFIRMA_MS))
        for lado, f in (('A', a), ('B', b)):
            for ordem, (cid, herois, dono) in enumerate(((f['lider_id'], f['lider_herois'], f['lider_dono']),
                                                         (f['parceiro_id'], f['parceiro_herois'], f['parceiro_dono']))):
                self.con.execute(
                    "INSERT INTO guerra_jogadores(gid, conta_id, lado, ordem, guilda_id, dono, herois, nivel, desde_ms) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (gid, cid, lado, ordem, f['guilda_id'], dono, herois, f['nivel'], f['desde_ms']))
                self._evento(cid, 'guerra-casada', {'gid': gid, 'lado': lado})
            self.con.execute("DELETE FROM guerra_inscricoes WHERE lider_id = ?", (f['lider_id'],))

    def _guerra_estado(self, cid, agora_ms):
        p = self._guerra_partida_de(cid, agora_ms)
        if p is not None:
            js = self._guerra_jogadores(p['gid'])
            nomes = self._g_nomes([j['conta_id'] for j in js])
            eu = next(j for j in js if j['conta_id'] == cid)
            guildas = {'A': self._guerra_guilda_info(p['a_guilda']), 'B': self._guerra_guilda_info(p['b_guilda'])}
            r = {'ok': True, 'agoraMs': agora_ms, 'fase': p['estado'], 'lado': eu['lado'],
                 'herois': json.loads(eu['herois']), 'guildas': guildas,
                 'aliados': [{'conta': j['conta_id'], 'nome': nomes.get(j['conta_id'], '?'), 'confirmou': bool(j['ok']),
                              'eu': j['conta_id'] == cid} for j in js if j['lado'] == eu['lado']],
                 # 15/09, a surpresa: dos adversários, só a guilda e os nomes (as duplas aparecem na ata)
                 'adversarios': [{'conta': j['conta_id'], 'nome': nomes.get(j['conta_id'], '?'),
                                  'confirmou': bool(j['ok'])} for j in js if j['lado'] != eu['lado']]}
            if p['estado'] == 'casada':
                r.update(prazoMs=p['prazo_ms'], confirmei=bool(eu['ok']))
            else:
                r.update(gid=p['gid'], semente=p['semente'], ata=_objeto(p['ata']),
                         jogadores=[{'conta': j['conta_id'], 'nome': nomes.get(j['conta_id'], '?'), 'dono': j['dono'],
                                     'lado': j['lado'], 'ordem': j['ordem']} for j in js])
            return r
        f = self._guerra_inscricao_de(cid)
        if f is None:
            return {'ok': True, 'agoraMs': agora_ms, 'fase': 'livre'}
        sou_lider = f['lider_id'] == cid
        self.con.execute("UPDATE guerra_inscricoes SET %s = ? WHERE lider_id = ?"
                         % ('lider_visto_ms' if sou_lider else 'parceiro_visto_ms'), (agora_ms, f['lider_id']))
        nomes = self._g_nomes([f['lider_id'], f['parceiro_id']])
        completa = f['parceiro_herois'] is not None
        r = {'ok': True, 'agoraMs': agora_ms, 'nivel': f['nivel']}
        if sou_lider:
            r.update(parceiro={'conta': f['parceiro_id'], 'nome': nomes.get(f['parceiro_id'], '?')},
                     herois=json.loads(f['lider_herois']))
        else:
            r.update(lider={'conta': f['lider_id'], 'nome': nomes.get(f['lider_id'], '?')},
                     herois=json.loads(f['parceiro_herois']) if completa else None)
        if completa:
            r.update(fase='inscrito', desdeMs=f['desde_ms'])
        else:
            r.update(fase='aguardando' if sou_lider else 'convite', prazoMs=f['criada_ms'] + GUERRA_JUNTAR_MS)
        return r

    def _guerra_ocupado(self, cid, agora_ms, menos_lider=None):
        """409 se a conta já está numa partida, ou numa inscrição que não é a de `menos_lider`."""
        if self._guerra_partida_de(cid, agora_ms) is not None:
            raise Recusa(409, 'já há uma guerra em andamento para essa conta', motivo='casada')
        f = self._guerra_inscricao_de(cid)
        if f is not None and f['lider_id'] != menos_lider:
            raise Recusa(409, 'essa conta já está numa inscrição da guerra', motivo='inscrito')

    # -- POST /api/guerra/inscrever ------------------------------------------------------------------------
    def guerra_inscrever(self, conta, corpo):
        cid = conta['id']
        pid = corpo.get('parceiro')
        if not _inteiro_puro(pid) or pid < 1:
            raise Recusa(400, 'parceiro precisa ser a conta de quem vai com você')
        if pid == cid:
            raise Recusa(400, 'o parceiro precisa ser outra conta')
        dono = _dono(corpo.get('dono'), 'dono')
        if not self._autoridade_ligada():
            raise Recusa(503, 'o juiz do servidor não está configurado: a guerra de guilda não abre')
        agora_ms = _ms()
        with self._escrita():
            herois, progress = self._arena_confere_dupla(conta, corpo, agora_ms)
            self._guerra_limite(cid)
            self._guerra_arruma(agora_ms)
            gid = self._guerra_guilda_id(cid)
            if gid is None:
                raise Recusa(409, 'a guerra é de guilda: entre numa guilda antes', motivo='sem-guilda')
            if self._conta_viva(pid) is None:
                raise Recusa(404, 'conta do parceiro não encontrada')
            if self._guerra_guilda_id(pid) != gid:
                raise Recusa(409, 'o parceiro precisa ser da mesma guilda', motivo='outra-guilda')
            if self._estado_ler(pid) is None:
                raise Recusa(409, 'o parceiro ainda não tem o estado no servidor: ele precisa abrir o jogo logado')
            self._guerra_ocupado(cid, agora_ms, menos_lider=cid)
            self._guerra_ocupado(pid, agora_ms, menos_lider=cid)
            self.con.execute("DELETE FROM guerra_inscricoes WHERE lider_id = ?", (cid,))
            self.con.execute(
                "INSERT INTO guerra_inscricoes(lider_id, parceiro_id, guilda_id, lider_herois, lider_dono, nivel, "
                "criada_ms, lider_visto_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (cid, pid, gid, json.dumps(herois), dono, _nivel_forte(progress, herois), agora_ms, agora_ms))
            self._evento(pid, 'guerra-convite', {'lider': cid})
            return 200, self._guerra_estado(cid, agora_ms)

    # -- POST /api/guerra/juntar ----------------------------------------------------------------------------
    def guerra_juntar(self, conta, corpo):
        cid = conta['id']
        dono = _dono(corpo.get('dono'), 'dono')
        if not self._autoridade_ligada():
            raise Recusa(503, 'o juiz do servidor não está configurado: a guerra de guilda não abre')
        agora_ms = _ms()
        with self._escrita():
            herois, progress = self._arena_confere_dupla(conta, corpo, agora_ms)
            self._guerra_limite(cid)
            self._guerra_arruma(agora_ms)
            f = self.con.execute("SELECT * FROM guerra_inscricoes WHERE parceiro_id = ?", (cid,)).fetchone()
            if f is None:
                raise Recusa(409, 'ninguém inscreveu você na guerra (ou o prazo passou)', motivo='sem-convite')
            if dono == f['lider_dono']:
                raise Recusa(400, 'os dois jogadores com o mesmo dono')
            if self._guerra_guilda_id(cid) != f['guilda_id'] or self._guerra_guilda_id(f['lider_id']) != f['guilda_id']:
                self.con.execute("DELETE FROM guerra_inscricoes WHERE lider_id = ?", (f['lider_id'],))
                raise Recusa(409, 'os dois precisam ser da mesma guilda', motivo='outra-guilda')
            dele = self._estado_exige(f['lider_id'])
            nivel = max(_nivel_forte(dele['progress'], json.loads(f['lider_herois'])), _nivel_forte(progress, herois))
            self.con.execute(
                "UPDATE guerra_inscricoes SET parceiro_herois = ?, parceiro_dono = ?, nivel = ?, "
                "desde_ms = COALESCE(desde_ms, ?), parceiro_visto_ms = ?, lider_visto_ms = MAX(lider_visto_ms, ?) "
                "WHERE lider_id = ?",
                (json.dumps(herois), dono, nivel, agora_ms, agora_ms, agora_ms - GUERRA_VISTO_MS // 2, f['lider_id']))
            self._guerra_casa(agora_ms)
            return 200, self._guerra_estado(cid, agora_ms)

    # -- POST /api/guerra/confirmar ---------------------------------------------------------------------------
    def guerra_confirmar(self, conta, corpo):
        cid, agora_ms = conta['id'], _ms()
        pronta = None
        with self._escrita():
            self._guerra_arruma(agora_ms)
            p = self._guerra_partida_de(cid, agora_ms)
            if p is None:
                raise Recusa(409, 'não há guerra para confirmar (o prazo pode ter passado)', motivo='sem-partida')
            if p['estado'] == 'casada':
                eu = self.con.execute("SELECT * FROM guerra_jogadores WHERE gid = ? AND conta_id = ?",
                                      (p['gid'], cid)).fetchone()
                self._vida_recusa_zero(self._vida_de(cid, json.loads(eu['herois']), agora_ms))
                self.con.execute("UPDATE guerra_jogadores SET ok = 1 WHERE gid = ? AND conta_id = ?", (p['gid'], cid))
                js = self._guerra_jogadores(p['gid'])
                if all(j['ok'] for j in js):
                    # os quatro: a partida fica pronta com a semente do servidor e a vida de cada jogador guardada
                    for j in js:
                        vidas = self._vida_ferida(j['conta_id'], json.loads(j['herois']), agora_ms)
                        carry = {h: v['hp'] for h, v in vidas.items()} or None
                        self.con.execute("UPDATE guerra_jogadores SET carry = ? WHERE gid = ? AND conta_id = ?",
                                         (json.dumps(carry) if carry else None, p['gid'], j['conta_id']))
                    self.con.execute("UPDATE guerra_partidas SET estado = 'pronta', pronta_ms = ?, semente = ? "
                                     "WHERE gid = ?", (agora_ms, secrets.randbits(31), p['gid']))
                    for j in js:
                        self._evento(j['conta_id'], 'guerra-pronta', {'gid': p['gid']})
                    pronta = p['gid']
            elif p['ata'] is None:
                pronta = p['gid']
        if pronta:
            self._guerra_ata(pronta)
        with self._escrita():
            return 200, self._guerra_estado(cid, _ms())

    def _guerra_ata(self, gid):
        """A ata da partida pronta: os oito payloads saem do juiz (o estado do SERVIDOR de cada conta), a vida de
        cada herói da linha guardada no confirmar. Falha do juiz: fica sem ata e a consulta seguinte tenta de novo;
        herói que sumiu da conta (422): a partida cai."""
        with self._escrita():
            p = self.con.execute("SELECT * FROM guerra_partidas WHERE gid = ?", (gid,)).fetchone()
            if p is None or p['estado'] != 'pronta' or p['ata'] is not None:
                return
            js = self._guerra_jogadores(gid)
            jogadores, carry = [], {}
            for j in js:
                c = self._conta_viva(j['conta_id'])
                estado = self._estado_ler(j['conta_id'])
                if c is None or estado is None:
                    self.con.execute("UPDATE guerra_partidas SET estado = 'caiu' WHERE gid = ?", (gid,))
                    return
                jogadores.append({'conta': {'id': c['id'], 'gm': bool(c['gm'])}, 'dono': j['dono'], 'lado': j['lado'],
                                  'herois': json.loads(j['herois']), 'progress': estado['progress'], 'db': estado['db']})
                for h, v in (_objeto(j['carry']) or {}).items():
                    carry[j['dono'] + ':' + h] = v
        try:
            saida = self.juiz.pede('POST', '/guerra/ata', {'jogadores': jogadores})
        except Recusa as e:
            if e.status == 422:
                with self._escrita():
                    self.con.execute("UPDATE guerra_partidas SET estado = 'caiu' WHERE gid = ? AND ata IS NULL", (gid,))
                    for j in js:
                        self._evento(j['conta_id'], 'guerra-caiu', {'gid': gid, 'motivo': e.extra.get('motivo')})
            return
        if (not isinstance(saida, dict) or saida.get('ok') is not True or not isinstance(saida.get('A'), list)
                or not isinstance(saida.get('B'), list)):
            return
        ata = {'mapa': MAPA_GUERRA, 'sala': 0, 'semente': p['semente'], 'A': saida['A'], 'B': saida['B'],
               'carry': carry or None}
        with self._escrita():
            self.con.execute("UPDATE guerra_partidas SET ata = ? WHERE gid = ? AND ata IS NULL",
                             (json.dumps(ata, ensure_ascii=False), gid))

    # -- POST /api/guerra/recusar e /api/guerra/sair ---------------------------------------------------------
    def guerra_recusar(self, conta, corpo):
        cid, agora_ms = conta['id'], _ms()
        with self._escrita():
            self._guerra_arruma(agora_ms)
            p = self._guerra_partida_de(cid, agora_ms)
            if p is not None and p['estado'] == 'casada':
                eu = self.con.execute("SELECT lado FROM guerra_jogadores WHERE gid = ? AND conta_id = ?",
                                      (p['gid'], cid)).fetchone()
                self._guerra_cai(p, agora_ms, ['B' if eu['lado'] == 'A' else 'A'])
            return 200, self._guerra_estado(cid, agora_ms)

    def guerra_sair(self, conta, corpo):
        cid, agora_ms = conta['id'], _ms()
        with self._escrita():
            self._guerra_arruma(agora_ms)
            f = self._guerra_inscricao_de(cid)
            if f is not None:
                self.con.execute("DELETE FROM guerra_inscricoes WHERE lider_id = ?", (f['lider_id'],))
                outro = f['parceiro_id'] if f['lider_id'] == cid else f['lider_id']
                self._evento(outro, 'guerra-saiu', {'por': cid})
        return self.guerra_recusar(conta, corpo)

    # -- GET /api/guerra/estado ---------------------------------------------------------------------------------
    def guerra_estado(self, conta, corpo):
        cid, agora_ms = conta['id'], _ms()
        faz_ata = None
        with self._escrita():
            self._guerra_arruma(agora_ms)
            p = self._guerra_partida_de(cid, agora_ms)
            if p is not None and p['estado'] == 'pronta' and p['ata'] is None:
                faz_ata = p['gid']
        if faz_ata and self._autoridade_ligada():
            self._guerra_ata(faz_ata)
        with self._escrita():
            return 200, self._guerra_estado(cid, _ms())

    # -- POST /api/guerra/fechar -----------------------------------------------------------------------------
    def _guerra_teto(self, a, b, t):
        """Dentro da tranca: 'teto' se a guerra já não rende XP (24 h), ou None."""
        de = t - GUERRA_JANELA
        par = self.con.execute(
            "SELECT COUNT(*) FROM guerra_resultados WHERE xp > 0 AND criado_em > ? AND "
            "((a_guilda = ? AND b_guilda = ?) OR (a_guilda = ? AND b_guilda = ?))", (de, a, b, b, a)).fetchone()[0]
        if par >= GUERRAS_XP_POR_PAR:
            return 'teto'
        for g in (a, b):
            n = self.con.execute("SELECT COUNT(*) FROM guerra_resultados WHERE xp > 0 AND criado_em > ? "
                                 "AND (a_guilda = ? OR b_guilda = ?)", (de, g, g)).fetchone()[0]
            if n >= GUERRAS_XP_POR_GUILDA:
                return 'teto'
        return None

    def _guerra_guarda(self, p, resultado, t, xp=0, guilda_xp=None):
        """Dentro de _escrita: o resultado (falha de chave = outro dos quatro guardou antes)."""
        self.con.execute("INSERT INTO guerra_resultados(gid, fase, venc, xp, guilda_xp, a_guilda, b_guilda, criado_em, "
                         "resultado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                         (p['gid'], resultado['fase'], resultado.get('venc'), xp, guilda_xp, p['a_guilda'],
                          p['b_guilda'], t, json.dumps(resultado, ensure_ascii=False)))
        self.con.execute("UPDATE guerra_partidas SET estado = 'fechada' WHERE gid = ?", (p['gid'],))

    def _guerra_resposta(self, cid, gid):
        with self.tranca:
            r = self.con.execute("SELECT * FROM guerra_resultados WHERE gid = ?", (gid,)).fetchone()
            eu = self.con.execute("SELECT * FROM guerra_jogadores WHERE gid = ? AND conta_id = ?", (gid, cid)).fetchone()
            if r is None or eu is None:
                return None
            res = _objeto(r['resultado']) or {}
            herois = json.loads(eu['herois'])
            vida = {h: v['hp'] for h, v in self._vida_de(cid, herois, _ms()).items()}
            guildas = {'A': self._guerra_guilda_info(r['a_guilda']), 'B': self._guerra_guilda_info(r['b_guilda'])}
        venc = r['venc']
        resposta = {'ok': True, 'gid': gid, 'fase': r['fase'], 'venc': venc, 'lado': eu['lado'],
                    'venceu': (venc == eu['lado']) if venc in ('A', 'B') else None, 'xp': r['xp'],
                    'guilda': guildas.get(venc) if venc in ('A', 'B') else None, 'guildas': guildas, 'vida': vida}
        if res.get('motivo'):
            resposta['motivo'] = res['motivo']
        return 200, resposta

    def guerra_fechar(self, conta, corpo):
        """Corpo {gid, lances, hashFinal, fotografada}. O juiz refaz a guerra com a ATA guardada (os oito payloads e
        a vida de cada um) e devolve o fim e a vida por dono; a vitória paga GUERRA_XP à guilda vencedora (dentro dos
        tetos), e a vida dos oito grava na conta de cada um — tudo numa transação."""
        cid = conta['id']
        gid = corpo.get('gid')
        if not isinstance(gid, str) or not RE_GID_GUERRA.match(gid):
            raise Recusa(400, 'gid inválido')
        lances, hash_final = _lances(corpo)
        fotografada = corpo.get('fotografada') is True
        for _ in range(TENTATIVAS):
            instante = time.time()
            t = int(instante)
            with self._escrita():
                p = self.con.execute("SELECT * FROM guerra_partidas WHERE gid = ?", (gid,)).fetchone()
                eu = self.con.execute("SELECT 1 FROM guerra_jogadores WHERE gid = ? AND conta_id = ?",
                                      (gid, cid)).fetchone() if p is not None else None
                if p is None or eu is None:
                    raise Recusa(404, 'guerra não encontrada')
                fotos = json.loads(p['fotografadas']) if p['fotografadas'] else []
                if self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?", (gid,)).fetchone():
                    acao = 'guardado'
                elif p['estado'] not in ('pronta', 'fechada') or p['ata'] is None:
                    raise Recusa(409, 'essa guerra não chegou a começar', motivo='sem-partida')
                elif fotos and p['primeiro_fecho'] is not None and t >= p['primeiro_fecho'] + GUERRA_ESPERA:
                    self._guerra_guarda(p, {'fase': 'nao-conferida', 'venc': None, 'motivo': 'fotografada'}, t)
                    acao = 'guardado'
                elif fotografada:
                    if cid not in fotos:
                        fotos.append(cid)
                    primeiro = p['primeiro_fecho'] if p['primeiro_fecho'] is not None else t
                    self.con.execute("UPDATE guerra_partidas SET fotografadas = ?, primeiro_fecho = ? WHERE gid = ?",
                                     (json.dumps(fotos), primeiro, gid))
                    return 200, {'ok': True, 'gid': gid, 'fase': 'aguardando', 'esperaAte': primeiro + GUERRA_ESPERA}
                else:
                    if p['primeiro_fecho'] is None:
                        self.con.execute("UPDATE guerra_partidas SET primeiro_fecho = ? WHERE gid = ?", (t, gid))
                    js = self._guerra_jogadores(gid)
                    acao = 'juiz'
            if acao == 'guardado':
                return self._guerra_resposta(cid, gid)
            ata = json.loads(p['ata'])
            try:
                saida = self.juiz.pede('POST', '/guerra/fecha', {'ata': ata, 'lances': lances, 'hashFinal': hash_final})
            except Recusa as e:
                if e.status == 422:
                    with self._escrita():
                        if not self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?", (gid,)).fetchone():
                            self._guerra_guarda(p, {'fase': 'recusada', 'venc': None,
                                                    'motivo': e.extra.get('motivo') or 'juiz'}, t)
                            for j in js:
                                self._evento(j['conta_id'], 'guerra-recusada', {'gid': gid, 'motivo': e.extra.get('motivo')})
                raise
            if (not isinstance(saida, dict) or saida.get('ok') is not True or not isinstance(saida.get('fase'), str)
                    or not isinstance(saida.get('vida'), dict)):
                raise Recusa(503, 'o juiz respondeu torto — tente de novo em instantes')
            turnos = max(0, inteiro(saida.get('turnosJogador')))
            minimo = max(SALA_MIN_S, SALA_S_POR_TURNO * turnos)
            if instante - p['pronta_ms'] / 1000.0 < minimo:
                with self._escrita():
                    if not self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?", (gid,)).fetchone():
                        self._guerra_guarda(p, {'fase': 'recusada', 'venc': None, 'motivo': 'rapido-demais'}, t)
                raise Recusa(422, 'a guerra fechou rápido demais para ser de verdade', motivo='rapido-demais')
            venc = saida.get('venc') if saida.get('venc') in ('A', 'B', 'empate') else None
            try:
                with self._escrita():
                    if self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?", (gid,)).fetchone():
                        raise EstadoMudou()                  # outro dos quatro fechou junto: a volta lê o guardado
                    xp, guilda_xp, motivo = 0, None, None
                    if venc in ('A', 'B'):
                        guilda_xp = p['a_guilda'] if venc == 'A' else p['b_guilda']
                        motivo = self._guerra_teto(p['a_guilda'], p['b_guilda'], t)
                        if motivo is None and self.con.execute("SELECT 1 FROM guildas WHERE id = ?",
                                                               (guilda_xp,)).fetchone() is None:
                            motivo = 'sem-guilda'
                        if motivo is None:
                            xp = GUERRA_XP
                            self.con.execute("UPDATE guildas SET xp = xp + ? WHERE id = ?", (xp, guilda_xp))
                            # a contribuição dos dois que lutaram por ela (quem ainda é da guilda)
                            vencedores = [j for j in js if j['lado'] == venc]
                            parte, resto = divmod(xp, max(1, len(vencedores)))
                            for i, j in enumerate(vencedores):
                                self.con.execute(
                                    "INSERT INTO guilda_contrib(guilda_id, conta_id, xp) SELECT ?, ?, ? WHERE EXISTS "
                                    "(SELECT 1 FROM guilda_membros WHERE conta_id = ? AND guilda_id = ?) "
                                    "ON CONFLICT(guilda_id, conta_id) DO UPDATE SET xp = xp + excluded.xp",
                                    (guilda_xp, j['conta_id'], parte + (resto if i == 0 else 0), j['conta_id'], guilda_xp))
                    elif venc == 'empate':
                        motivo = 'empate'
                    else:
                        motivo = 'sem-fim'                   # W.O. ou desistência: o replay não termina
                    # a vida dos oito, cada herói na conta de quem o levou (a chave do juiz é o dono)
                    agora_ms = _ms()
                    maximos = saida.get('vidaMax') if isinstance(saida.get('vidaMax'), dict) else {}
                    for j in js:
                        fim = saida['vida'].get(j['dono'])
                        fim = fim if isinstance(fim, dict) else {}
                        hs = json.loads(j['herois'])
                        self._vida_grava_fim(j['conta_id'], {h: fim[h] for h in hs if h in fim},
                                             maximos.get(j['dono']), agora_ms)
                    resultado = {'fase': saida['fase'], 'venc': venc, 'turnos': turnos}
                    if motivo:
                        resultado['motivo'] = motivo
                    self._guerra_guarda(p, resultado, t, xp, guilda_xp)
                    for j in js:
                        self._evento(j['conta_id'], 'guerra-fim', {'gid': gid, 'venc': venc, 'lado': j['lado'], 'xp': xp,
                                                                   'guilda': guilda_xp, 'motivo': motivo, 'por': cid})
            except EstadoMudou:
                continue
            log.info("guerra fechada: %s venc=%s xp=%d", gid, venc, xp)
            return self._guerra_resposta(cid, gid)
        raise Recusa(409, 'a guerra mudou no meio — tente de novo')
