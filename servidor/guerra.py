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
  POST /api/guerra/sair {gid?} sai da inscrição (a dupla de jogadores inteira) ou recusa a casada; com o `gid` da
       partida PRONTA (19/09) a conta declara que SAIU da guerra: os heróis dela a 0 na hora (guerra_saidas) — é a
       prova que o juiz exige para a marca `morte` daquela conta. Se os DOIS de um lado saíram, a partida fecha
       para o outro lado como vitória assim que qualquer um fechar.
  GET  /api/guerra/estado      {ok, agoraMs, fase: livre | aguardando | convite | inscrito | casada | pronta |
                                em-luta | fechada, ...}
       aguardando  (quem lidera) {parceiro: {conta, nome}, herois, prazoMs}
       convite     (o parceiro)  {lider: {conta, nome}, prazoMs}
       inscrito    {desdeMs, nivel, herois, parceiro | lider}
       casada      {prazoMs, lado, herois, confirmei, semXp, guildas: {A, B}, aliados: [{conta, nome, confirmou, eu}],
                    adversarios: [{conta, nome, confirmou}]} — as DUPLAS dos adversários ficam OCULTAS
       pronta      {gid, lado, herois, semente, semXp, guildas, jogadores: [{conta, nome, dono, lado, ordem}], ata | null}
       em-luta     (19/09) a mesma pronta, mas esta conta JÁ fechou a parte dela (o registro sem fim, o recusado, o
                   fotografado ou o W.O. ainda sem prova) e espera o fim dos outros: {…, esperaAte, esperaMs} — o jogo não abre a guerra de
                   novo, nem outra luta (abrir outra luta com ela pendente larga a guerra: heróis a 0)
       fechada     (19/09) a última guerra da conta, fechada há menos de GUERRA_FECHADA_MS: {gid, venc, lado, venceu,
                   xp, guilda, guildas, motivo, fim} — para quem perdeu a resposta do fechar; não prende ninguém
  POST /api/guerra/fechar {gid, lances, hashFinal, fotografada, desistiu?, wo?}   qualquer um dos quatro fecha
       → final: {ok, gid, fase, venc, lado, venceu, xp, guilda, motivo, fim, guildas, vida, fechada: true}
       → espera: {ok, gid, fase: 'aguardando', motivo, esperaAte (ms do servidor), esperaMs}
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
  - O XP (decisão do coordenador): GUERRA_XP (120; eram 40 até 04/10) para a guilda vencedora, dividido na contribuição dos dois que
    lutaram por ela; a perdedora não perde; empate não rende. A COROA NÃO MUDA (a Brasa é do PvP individual).
    Tetos contra combinação: GUERRAS_XP_POR_PAR com XP entre as mesmas duas guildas e GUERRAS_XP_POR_GUILDA por
    guilda em 24 h; acima, a guerra vale sem XP e o motivo fica guardado — e o estado casada/pronta já avisa
    (`semXp`) antes de os quatro confirmarem (19/09).
  - A VIDA dos oito heróis grava na conta de cada um em qualquer fim refeito (vitória, empate, W.O.).
  - RISCO ACEITO (o mesmo do duelo): o primeiro registro limpo COM FIM que o juiz refaz vale — um cliente mexido
    pode escrever lances do adversário que ele não fez. O tempo mínimo (0,35 s por turno de gente) e os tetos
    seguram o farm; o XP é da guilda e não vira moeda.

A REVISÃO DE 19/09 (o dono: "dê uma revisada na guerra de guild do meu jogo e ajuste o que for necessário"). O que
estava errado: qualquer um dos quatro fechava a guerra com lances=[] e o servidor guardava 'sem-fim' como final —
o lado que perdia anulava a guerra do console; o primeiro registro recusado (422) também fechava tudo; sair ou cair
não custava nada (sem prova de queda, sem desistência, sem luta aberta); a pronta sumia do estado em 3 min; quem
trocava de guilda seguia na fila; e o juiz aceitava marcas `morte`/`ia` forjadas contra o adversário. O CONTRATO
SERVIDOR↔JOGO que os dois lados implementam:
  1. Fechamento SEM fim (fase 'playing' no juiz, hashFinal null) NUNCA é final na hora: vai para guerra_espera
     (a tabela nova), responde {fase: 'aguardando', esperaAte} e grava a vida SÓ dos heróis de quem fechou; um
     registro COM fim (venc A/B/empate) de qualquer dos quatro dentro de GUERRA_ESPERA (120 s) vence; passado o
     prazo sem fim → 'sem-fim' (a vida do ponto do replay mais longo para todos, sem XP). Registro recusado pelo
     juiz (422) e o rápido demais também NÃO são finais: a mesma espera, e o limpo de outro vence. O jogo que
     recebe 'aguardando' pergunta de novo até 'fechada' — e é o FECHAR repetido que encerra a espera vencida, também
     para o recusado (2ª rodada da revisão: o 422 seguia 'aguardando' com esperaMs 0 para sempre, e o jogo nunca
     consulta o estado na tela de fim). O fechamento sem fim NÃO fecha a luta aberta de quem fechou (2ª rodada:
     fechava, e quem perdia fechava vazio, saía com a vida do começo e abria outra luta): a luta aberta da guerra só
     fecha no resultado final ou pela saída declarada — quem abre outra luta antes do fim é largado.
     `desistiu: true` só vale da própria conta (403 'desistencia-alheia' se o `lado` não é o dela): os dois heróis
     dela a 0 na hora (guerra_saidas), e a guerra segue para os outros. `wo: true` = o lado que ficou declara que os
     DOIS adversários sumiram: o servidor confere presenca.prova_de_queda dos dois desde a CASADA (criada_ms —
     'caiu' sem 'voltou' em 60 s; 3ª rodada: contava da pronta, e a queda de quem confirmou pelo HTTP com o Relé
     já caído ficava de fora) → W.O. confirmado (o lado ausente a 0, venc do outro, XP dentro dos tetos — decisão
     do coordenador: sem consequência para quem some, o W.O. vira a saída barata de quem perde); queda anotada há
     menos de 60 s, ou nenhuma ainda → o registro vai ao juiz e fica na ESPERA com motivo 'wo' ('aguardando' até a
     prova madurar; os 60 s contam do PRIMEIRO pedido de W.O. da partida, guerra_wo — não do primeiro_fecho de
     outro), e a prova madura fecha o W.O. também pela CONSULTA de qualquer um dos quatro (_guerra_wo_provado, 3ª
     rodada: o pedido não ficava em lugar nenhum e quem declarou e foi embora deixava a partida pronta para sempre);
     sem prova → só a vida do replay e 'wo-sem-prova' (na espera). O fim FORÇADO (os dois de um lado fora, o W.O.
     provado) é fato do servidor: vale também para quem foi restaurado por foto (3ª rodada: o juiz recebe o
     registro vazio com `perdeu` — o ramo do fotografado o engolia) e no fim da espera (_guerra_encerra_espera).
  2. POST /api/guerra/sair {gid}: a saída declarada (acima). Os dois de um lado fora → o outro vence com XP. Na
     pronta cuja ata ainda não saiu não há de onde sair: a guerra (que não começou) cai para os quatro, sem custo —
     o mesmo quando a conta abre outra luta com a pronta sem ata (3ª rodada: a linha da luta aberta ficava 'fechada'
     sem derrubar nada, e a guerra começava com a conta noutra luta, sem a régua da largada).
  3. As marcas de rede {a:'x', ev:'ia'|'morte', u}: o juiz só aceita a marca `morte` sobre herói de conta X se X
     está no MESMO lado da conta que fecha, ou há a saída declarada de X (guerra_saidas, a API passa {saidas});
     sem prova, 422 'marca-sem-prova'. A marca `ia` passa de quem for (2ª rodada: o parceiro marca também por
     PRAZO, sem queda no Relé, e a voz entra nos quatro registros — exigir prova recusava o registro limpo do
     adversário e o lado que perdia vetava a guerra; marcar `ia` só passa a vez, como o lance {a:'e'} já aceito).
  4. A partida viva da conta é a 'pronta' SEM linha em guerra_resultados e sem saída dela (não expira em 3 min;
     teto largo de LARGADA_JANELA_MS, 2 h). A pronta cuja ata nunca saiu cai depois de GUERRA_PRONTA_MS.
  5. A guerra pronta entra na régua de luta aberta (luta_aberta_guerra): abrir sala/grupo/duelo/arena/guerra com
     uma guerra pronta pendente = 'largada' (os heróis daquela conta a 0, evento, e a resposta leva largada).
  6. Toda recusa 4xx leva `motivo` curto (sem-guilda, outra-guilda, dois, vida-zero, casada, sem-estado-parceiro,
     sem-estado-lider, mesmo-dono, parceiro, sem-partida, desistencia-alheia, marca-sem-prova, wo-sem-prova,
     paridade, teto, rapido-demais…); a HUD tem a tabela de textos.
"""
import json
import logging
import re
import secrets
import sqlite3
import threading
import time

import presenca                    # 19/09: a queda anotada pelo Relé — a prova do W.O.
from comum import EstadoMudou, Recusa, agora, inteiro
from grupo import WO_ESPERA_MS, _dono, _lances, _nivel_forte
from salas import LARGADA_JANELA_MS, SALA_MIN_S, SALA_S_POR_TURNO, TENTATIVAS, _inteiro_puro, _objeto

log = logging.getLogger('api')

GUERRA_XP = 120                     # XP da guerra vencida para a guilda (15/09: 40; 04/10, dono: sem a doação em
                                    # dinheiro a guilda sobe pelo dízimo e pela guerra, "que o XP será maior")
GUERRA_PARIDADE = 10                # níveis entre o herói mais forte de cada guilda-dupla (idem)
GUERRA_CONFIRMA_MS = 30000          # o tempo de os quatro confirmarem
GUERRA_JUNTAR_MS = 60000            # o tempo de o parceiro pôr a dupla dele
GUERRA_VISTO_MS = 20000             # quem não consulta há tanto sai da fila (a aba fechada não espera guerra)
GUERRA_VISTO_ESCREVE_MS = 5000      # 19/09: o "ainda estou aqui" só grava a cada tanto (a consulta era escrita)
GUERRA_PRONTA_MS = 180000           # 19/09: o prazo da ATA — a pronta que ficou sem ata por tanto cai
GUERRA_ESPERA = 120                 # segundos que um fechamento sem fim (ou fotografado, ou recusado) espera um com fim
GUERRA_FECHADA_MS = 60000           # 19/09: a guerra recém-fechada aparece no estado ('fechada') por tanto
GUERRAS_XP_POR_PAR = 3              # guerras com XP entre as mesmas duas guildas, em 24 h
GUERRAS_XP_POR_GUILDA = 10          # guerras com XP de uma guilda (vencendo ou perdendo), em 24 h
GUERRA_JANELA = 24 * 3600
GUERRA_PEDIDOS_POR_HORA = 120       # inscrever + juntar por conta, por hora
MAPA_GUERRA = 'sede'                # js/core/data/arenas.js: 4 P a oeste (lado A), 4 letras a leste (lado B)
RE_GID_GUERRA = re.compile(r'^guerra-[0-9a-f]{20}$')

# 19/09: as atas em curso neste processo — o quarto a confirmar e as consultas dos quatro pediam a mesma ata ao
# juiz ao mesmo tempo (até cinco vezes); a segunda chamada com o gid em curso só devolve o estado
_atas_em_curso = set()
_atas_tranca = threading.Lock()

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
-- 19/09: o fechamento que ESPERA (o registro sem fim, o recusado pelo juiz, o rápido demais): uma linha por conta,
-- com o registro e o que o juiz devolveu dele (a vida do ponto do replay, por dono) — no fim da espera sem um
-- registro com fim, a guerra fecha 'sem-fim' com a vida do replay mais longo. Tabela NOVA, nunca ALTER
CREATE TABLE IF NOT EXISTS guerra_espera(
  gid          TEXT NOT NULL REFERENCES guerra_partidas(gid) ON DELETE CASCADE,
  conta_id     INTEGER NOT NULL,
  lances       TEXT,
  primeiro_ms  INTEGER NOT NULL,
  motivo       TEXT,
  turnos       INTEGER NOT NULL DEFAULT 0,
  resultado    TEXT,
  PRIMARY KEY (gid, conta_id)
);
-- 19/09: quem SAIU da guerra pronta (declarou pelo sair, desistiu no fechar, ou largou abrindo outra luta): os
-- heróis dele a 0 na hora; a linha é a prova que o juiz exige para a marca `morte` daquela conta
CREATE TABLE IF NOT EXISTS guerra_saidas(
  gid       TEXT NOT NULL REFERENCES guerra_partidas(gid) ON DELETE CASCADE,
  conta_id  INTEGER NOT NULL,
  em_ms     INTEGER NOT NULL,
  motivo    TEXT NOT NULL DEFAULT 'saiu',
  PRIMARY KEY (gid, conta_id)
);
-- 19/09: a LUTA ABERTA da guerra (o CHECK da luta_aberta velha só aceita sala/grupo): uma linha por conta desde
-- a pronta; quem abre outra luta com ela 'aberta' larga a guerra (salas.py, _larga_pendentes → _guerra_larga)
CREATE TABLE IF NOT EXISTS luta_aberta_guerra(
  conta_id  INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  gid       TEXT NOT NULL,
  desde_ms  INTEGER NOT NULL,
  estado    TEXT NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta', 'fechada', 'largada')),
  PRIMARY KEY (conta_id, gid)
);
CREATE INDEX IF NOT EXISTS luta_aberta_guerra_conta ON luta_aberta_guerra(conta_id, estado);
-- 19/09 (2ª rodada da revisão): o instante do PRIMEIRO pedido de W.O. da partida — os 60 s que dão tempo ao Relé de
-- anotar a queda contam daqui (contavam do primeiro_fecho, que o vazio de outro punha minutos antes). Tabela NOVA
CREATE TABLE IF NOT EXISTS guerra_wo(
  gid        TEXT PRIMARY KEY REFERENCES guerra_partidas(gid) ON DELETE CASCADE,
  pedido_ms  INTEGER NOT NULL
);
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
        """A partida viva da conta: a casada, ou a pronta SEM resultado e sem a saída desta conta (19/09: era a
        pronta de há menos de 3 min — a luta de oito heróis dura mais, e a conta ficava livre com a guerra em
        curso). O teto de LARGADA_JANELA_MS é só para nunca prender para sempre."""
        return self.con.execute(
            "SELECT p.* FROM guerra_partidas p JOIN guerra_jogadores j ON j.gid = p.gid WHERE j.conta_id = ? "
            "AND (p.estado = 'casada' OR (p.estado = 'pronta' AND p.pronta_ms >= ? "
            "AND NOT EXISTS (SELECT 1 FROM guerra_resultados r WHERE r.gid = p.gid) "
            "AND NOT EXISTS (SELECT 1 FROM guerra_saidas s WHERE s.gid = p.gid AND s.conta_id = j.conta_id))) "
            "ORDER BY p.criada_ms DESC LIMIT 1",
            (cid, agora_ms - LARGADA_JANELA_MS)).fetchone()

    def _guerra_saidas(self, gid):
        """Dentro da tranca: {conta_id: em_ms} de quem saiu da partida pronta (sair, desistiu, largada)."""
        return {r['conta_id']: r['em_ms'] for r in
                self.con.execute("SELECT conta_id, em_ms FROM guerra_saidas WHERE gid = ?", (gid,))}

    def _guerra_espera_de(self, gid):
        """Dentro da tranca: as linhas de guerra_espera da partida, a do replay mais longo primeiro."""
        return [dict(r) for r in self.con.execute(
            "SELECT * FROM guerra_espera WHERE gid = ? ORDER BY turnos DESC, primeiro_ms", (gid,))]

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

    def _guerra_cai(self, p, agora_ms, volta, motivo=None):
        """A partida casada cai; os lados em `volta` ('A', 'B') voltam à fila."""
        self.con.execute("UPDATE guerra_partidas SET estado = 'caiu' WHERE gid = ? AND estado = 'casada'", (p['gid'],))
        js = self._guerra_jogadores(p['gid'])
        for lado in volta:
            self._guerra_volta_a_fila([j for j in js if j['lado'] == lado], agora_ms)
        for j in js:
            self._evento(j['conta_id'], 'guerra-caiu', {'gid': p['gid'], 'motivo': motivo})

    def _guerra_pronta_cai(self, p, agora_ms, motivo, volta=()):
        """Dentro de _escrita (19/09): a partida PRONTA cuja ata nunca saiu cai para os quatro — a guerra não começou,
        ninguém perde nada: a luta aberta dos quatro fecha, os lados em `volta` voltam à fila com o lugar, e o evento
        'guerra-caiu' leva o `motivo` (ata | estado | saiu | o do juiz). False se a partida já não é a pronta sem ata."""
        n = self.con.execute("UPDATE guerra_partidas SET estado = 'caiu' WHERE gid = ? AND estado = 'pronta' AND ata IS NULL",
                             (p['gid'],)).rowcount
        if not n:
            return False
        self.con.execute("UPDATE luta_aberta_guerra SET estado = 'fechada' WHERE gid = ? AND estado = 'aberta'", (p['gid'],))
        js = self._guerra_jogadores(p['gid'])
        for lado in volta:
            self._guerra_volta_a_fila([j for j in js if j['lado'] == lado], agora_ms)
        for j in js:
            self._evento(j['conta_id'], 'guerra-caiu', {'gid': p['gid'], 'motivo': motivo})
        return True

    # 19/09: a inscrição de quem trocou de guilda no meio da fila cai (provado a1 lutando pelo lado A contra a
    # guilda em que acabou de entrar — e um oficial expulso seguia lutando pela guilda)
    _SEM_GUILDA = ("SELECT * FROM guerra_inscricoes f WHERE NOT EXISTS (SELECT 1 FROM guilda_membros m "
                   "WHERE m.conta_id = f.lider_id AND m.guilda_id = f.guilda_id) OR NOT EXISTS "
                   "(SELECT 1 FROM guilda_membros m WHERE m.conta_id = f.parceiro_id AND m.guilda_id = f.guilda_id)")

    def _guerra_precisa_arrumar(self, agora_ms):
        """Dentro da tranca, SÓ leitura: há algo para _guerra_arruma fazer? (19/09: a consulta do estado era uma
        transação de escrita com a varredura da fila a cada 2,5 s por jogador; agora só escreve quando é preciso.
        O casamento não entra aqui: só juntar e a volta à fila criam pares novos, e os dois já casam na hora.)"""
        t = agora()
        for consulta, args in (
                ("SELECT 1 FROM guerra_partidas WHERE estado = 'casada' AND prazo_ms < ? LIMIT 1", (agora_ms,)),
                ("SELECT 1 FROM guerra_inscricoes WHERE (parceiro_herois IS NULL AND criada_ms < ?) OR lider_visto_ms < ? "
                 "OR (parceiro_visto_ms IS NOT NULL AND parceiro_visto_ms < ?) LIMIT 1",
                 (agora_ms - GUERRA_JUNTAR_MS, agora_ms - GUERRA_VISTO_MS, agora_ms - GUERRA_VISTO_MS)),
                (self._SEM_GUILDA + " LIMIT 1", ()),
                ("SELECT 1 FROM guerra_partidas WHERE estado = 'pronta' AND ata IS NULL AND pronta_ms < ? LIMIT 1",
                 (agora_ms - GUERRA_PRONTA_MS,)),
                ("SELECT 1 FROM guerra_partidas p WHERE p.estado = 'pronta' AND p.primeiro_fecho IS NOT NULL "
                 "AND p.primeiro_fecho + ? <= ? AND NOT EXISTS (SELECT 1 FROM guerra_resultados r WHERE r.gid = p.gid) "
                 "LIMIT 1", (GUERRA_ESPERA, t))):
            if self.con.execute(consulta, args).fetchone() is not None:
                return True
        # 3ª rodada da revisão: o W.O. pedido (guerra_wo) cuja prova madurou no Relé — quem declarou pode ter ido embora
        for p in self._guerra_com_wo():
            if self._guerra_wo_provado(p, agora_ms) is not None:
                return True
        return False

    def _guerra_com_wo(self):
        """Dentro da tranca: as partidas prontas com um pedido de W.O. (guerra_wo) e ainda sem resultado."""
        return self.con.execute(
            "SELECT p.* FROM guerra_partidas p JOIN guerra_wo w ON w.gid = p.gid WHERE p.estado = 'pronta' "
            "AND NOT EXISTS (SELECT 1 FROM guerra_resultados r WHERE r.gid = p.gid)").fetchall()

    def _guerra_wo_provado(self, p, agora_ms):
        """Dentro da tranca, SÓ leitura (3ª rodada da revisão): o W.O. pedido nesta partida pronta (guerra_wo) já tem a
        prova do Relé? Para cada linha de guerra_espera com motivo 'wo' (quem declarou, com o replay dele guardado): os
        adversários dele que não saíram, todos com a queda provada desde a casada → (a linha, o lado que perde); senão
        None. É a régua que resolve o W.O. de quem declarou e foi embora (a página caiu): antes só o fechar repetido
        lia a prova, o estado de quem declarou era 'pronta', a partida ficava pronta para sempre e quem ficou e
        declarou era largado a 0 ao abrir outra luta (provado pelo revisor)."""
        gid = p['gid']
        if self.con.execute("SELECT 1 FROM guerra_wo WHERE gid = ?", (gid,)).fetchone() is None \
                or self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?", (gid,)).fetchone():
            return None
        js = self._guerra_jogadores(gid)
        saidas = self._guerra_saidas(gid)
        # a linha 'wo-sem-prova' também é um pedido de W.O.: a queda de verdade pode vir depois da volta que o anulou
        for e in self.con.execute("SELECT * FROM guerra_espera WHERE gid = ? AND motivo IN ('wo', 'wo-sem-prova') "
                                  "AND resultado IS NOT NULL ORDER BY turnos DESC, primeiro_ms", (gid,)).fetchall():
            eu = next((j for j in js if j['conta_id'] == e['conta_id']), None)
            if eu is None:
                continue
            outro = 'B' if eu['lado'] == 'A' else 'A'
            ausentes = [j for j in js if j['lado'] == outro and j['conta_id'] not in saidas]
            if ausentes and all(presenca.prova_de_queda(self.con, j['conta_id'], p['criada_ms'], agora_ms)[0] == 'provada'
                                for j in ausentes):
                return dict(e), outro
        return None

    def _guerra_arruma(self, agora_ms):
        # o prazo da confirmação: quem não confirmou sai, o lado que confirmou inteiro volta à fila
        for p in self.con.execute("SELECT * FROM guerra_partidas WHERE estado = 'casada' AND prazo_ms < ?",
                                  (agora_ms,)).fetchall():
            js = self._guerra_jogadores(p['gid'])
            inteiros = [lado for lado in ('A', 'B') if all(j['ok'] for j in js if j['lado'] == lado)]
            self._guerra_cai(p, agora_ms, inteiros, 'prazo')
        # 19/09: quem saiu da guilda (ou foi expulso) não fica na fila pela guilda velha
        for f in self.con.execute(self._SEM_GUILDA).fetchall():
            self._guerra_desfaz_inscricao(f, None, 'guilda')
        self.con.execute("DELETE FROM guerra_inscricoes WHERE parceiro_herois IS NULL AND criada_ms < ?",
                         (agora_ms - GUERRA_JUNTAR_MS,))
        self.con.execute("DELETE FROM guerra_inscricoes WHERE lider_visto_ms < ? OR "
                         "(parceiro_visto_ms IS NOT NULL AND parceiro_visto_ms < ?)",
                         (agora_ms - GUERRA_VISTO_MS, agora_ms - GUERRA_VISTO_MS))
        # 19/09: a pronta cuja ata nunca saiu (os quatro fecharam a aba antes da primeira consulta, o juiz fora
        # do ar por minutos) não fica 'pronta' para sempre
        for p in self.con.execute("SELECT * FROM guerra_partidas WHERE estado = 'pronta' AND ata IS NULL AND pronta_ms < ?",
                                  (agora_ms - GUERRA_PRONTA_MS,)).fetchall():
            self._guerra_pronta_cai(p, agora_ms, 'ata')
        t = agora()
        # 3ª rodada da revisão: o W.O. cuja prova madurou no Relé fecha pela consulta também (quem declarou o W.O. e foi
        # embora — a página caiu — deixava a partida 'pronta' para sempre: só o fechar repetido lia a prova)
        for p in self._guerra_com_wo():
            wo = self._guerra_wo_provado(p, agora_ms)
            if wo is not None:
                self._guerra_fecha_forcado(p, self._guerra_jogadores(p['gid']), wo[1], 'wo', t)
        # 19/09: a espera de um fim que não veio acabou — a guerra fecha 'sem-fim' (ou 'nao-conferida') por aqui
        # também, para quem só consulta o estado
        for p in self.con.execute(
                "SELECT p.* FROM guerra_partidas p WHERE p.estado = 'pronta' AND p.primeiro_fecho IS NOT NULL "
                "AND p.primeiro_fecho + ? <= ? AND NOT EXISTS (SELECT 1 FROM guerra_resultados r WHERE r.gid = p.gid)",
                (GUERRA_ESPERA, t)).fetchall():
            self._guerra_encerra_espera(p, t)
        self._guerra_casa(agora_ms)

    def _guerra_desfaz_inscricao(self, f, por, motivo):
        """Dentro de _escrita: a inscrição cai e os dois (menos `por`) ficam sabendo."""
        self.con.execute("DELETE FROM guerra_inscricoes WHERE lider_id = ?", (f['lider_id'],))
        for cid in (f['lider_id'], f['parceiro_id']):
            if cid != por:
                self._evento(cid, 'guerra-saiu', {'por': por, 'motivo': motivo})

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
                # 19/09: o `dono` (o id de rede) é palavra do cliente e a colisão entre as duas duplas só estourava na
                # ata, derrubando a partida sem devolver ninguém à fila — o par com um dono repetido não casa
                if len({a['lider_dono'], a['parceiro_dono'], b['lider_dono'], b['parceiro_dono']}) < 4:
                    continue
                # 19/09: os quatro ainda são das guildas da inscrição (a troca entre juntar e casar)
                if not self._guerra_ainda_da_guilda(a) or not self._guerra_ainda_da_guilda(b):
                    continue
                self._guerra_cria(a, b, agora_ms)
                usados.update((a['lider_id'], b['lider_id']))
                break

    def _guerra_ainda_da_guilda(self, f):
        return all(self._guerra_guilda_id(cid) == f['guilda_id'] for cid in (f['lider_id'], f['parceiro_id']))

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

    def _guerra_estado(self, cid, agora_ms, grava_visto=True):
        p = self._guerra_partida_de(cid, agora_ms)
        if p is not None:
            js = self._guerra_jogadores(p['gid'])
            nomes = self._g_nomes([j['conta_id'] for j in js])
            eu = next(j for j in js if j['conta_id'] == cid)
            guildas = {'A': self._guerra_guilda_info(p['a_guilda']), 'B': self._guerra_guilda_info(p['b_guilda'])}
            r = {'ok': True, 'agoraMs': agora_ms, 'fase': p['estado'], 'lado': eu['lado'],
                 'herois': json.loads(eu['herois']), 'guildas': guildas,
                 # 19/09: os tetos já estouraram — a HUD avisa ANTES de confirmar que esta guerra não rende XP
                 'semXp': self._guerra_teto(p['a_guilda'], p['b_guilda'], agora()) is not None,
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
                # 19/09: esta conta já fechou a parte dela (o registro sem fim, o recusado, ou o fotografado — 2ª rodada:
                # o fotografado ficava 'pronta', o jogo abria outra luta e a largada o zerava para sempre) e espera os
                # outros — o jogo que reabre não entra na guerra de novo
                fotos = json.loads(p['fotografadas']) if p['fotografadas'] else []
                if cid in fotos or self.con.execute("SELECT 1 FROM guerra_espera WHERE gid = ? AND conta_id = ?",
                                                    (p['gid'], cid)).fetchone():
                    ate = (p['primeiro_fecho'] + GUERRA_ESPERA) * 1000 if p['primeiro_fecho'] else agora_ms + GUERRA_ESPERA * 1000
                    r.update(fase='em-luta', esperaAte=ate, esperaMs=max(0, ate - agora_ms))
            return r
        f = self._guerra_inscricao_de(cid)
        if f is None:
            return self._guerra_estado_fechada(cid, agora_ms) or {'ok': True, 'agoraMs': agora_ms, 'fase': 'livre'}
        sou_lider = f['lider_id'] == cid
        visto = f['lider_visto_ms'] if sou_lider else f['parceiro_visto_ms']
        if grava_visto and (visto is None or agora_ms - visto >= GUERRA_VISTO_ESCREVE_MS):
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

    def _guerra_estado_fechada(self, cid, agora_ms):
        """19/09: a última guerra da conta fechada há menos de GUERRA_FECHADA_MS — quem perdeu a resposta do fechar
        (o servidor fora por instantes, a aba fechada) lê o resultado por aqui. Não prende ninguém."""
        r = self.con.execute(
            "SELECT r.*, j.lado FROM guerra_resultados r JOIN guerra_jogadores j ON j.gid = r.gid WHERE j.conta_id = ? "
            "AND r.criado_em * 1000 >= ? ORDER BY r.criado_em DESC LIMIT 1", (cid, agora_ms - GUERRA_FECHADA_MS)).fetchone()
        if r is None:
            return None
        res = _objeto(r['resultado']) or {}
        venc = r['venc']
        guildas = {'A': self._guerra_guilda_info(r['a_guilda']), 'B': self._guerra_guilda_info(r['b_guilda'])}
        saida = {'ok': True, 'agoraMs': agora_ms, 'fase': 'fechada', 'gid': r['gid'], 'resultado': r['fase'], 'venc': venc,
                 'lado': r['lado'], 'venceu': (venc == r['lado']) if venc in ('A', 'B') else None, 'xp': r['xp'],
                 'guilda': guildas.get(venc) if venc in ('A', 'B') else None, 'guildas': guildas,
                 'motivo': res.get('motivo'), 'fim': res.get('fim')}
        return saida

    def _guerra_ocupado(self, cid, agora_ms, menos_lider=None):
        """409 se a conta já está numa partida, ou numa inscrição que não é a de `menos_lider`."""
        if self._guerra_partida_de(cid, agora_ms) is not None:
            raise Recusa(409, 'já há uma guerra em andamento para essa conta', motivo='casada')
        f = self._guerra_inscricao_de(cid)
        if f is not None and f['lider_id'] != menos_lider:
            raise Recusa(409, 'essa conta já está numa inscrição da guerra', motivo='inscrito')

    # -- POST /api/guerra/inscrever ------------------------------------------------------------------------
    def guerra_inscrever(self, conta, corpo):
        # 15/09: a luta que a conta deixou aberta no servidor fica largada antes (salas.py, _com_largada)
        return self._com_largada(conta, lambda: self._guerra_inscrever(conta, corpo))

    def _guerra_inscrever(self, conta, corpo):
        cid = conta['id']
        pid = corpo.get('parceiro')
        if not _inteiro_puro(pid) or pid < 1:
            raise Recusa(400, 'parceiro precisa ser a conta de quem vai com você', motivo='parceiro')
        if pid == cid:
            raise Recusa(400, 'o parceiro precisa ser outra conta', motivo='parceiro')
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
                raise Recusa(404, 'conta do parceiro não encontrada', motivo='parceiro')
            if self._guerra_guilda_id(pid) != gid:
                raise Recusa(409, 'o parceiro precisa ser da mesma guilda', motivo='outra-guilda')
            if self._estado_ler(pid) is None:
                raise Recusa(409, 'o parceiro ainda não tem o estado no servidor: ele precisa abrir o jogo logado',
                             motivo='sem-estado-parceiro')
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
        return self._com_largada(conta, lambda: self._guerra_juntar(conta, corpo))   # 15/09: a largada antes

    def _guerra_juntar(self, conta, corpo):
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
                raise Recusa(400, 'os dois jogadores com o mesmo dono', motivo='mesmo-dono')
            if self._guerra_guilda_id(cid) != f['guilda_id'] or self._guerra_guilda_id(f['lider_id']) != f['guilda_id']:
                self.con.execute("DELETE FROM guerra_inscricoes WHERE lider_id = ?", (f['lider_id'],))
                raise Recusa(409, 'os dois precisam ser da mesma guilda', motivo='outra-guilda')
            dele = self._estado_ler(f['lider_id'])
            if dele is None:
                # 19/09: quem não tem estado aqui é o LÍDER — a frase de antes mandava o parceiro recarregar à toa
                raise Recusa(409, 'quem inscreveu ainda não tem o estado no servidor: ele precisa abrir o jogo logado',
                             motivo='sem-estado-lider')
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
        return self._com_largada(conta, lambda: self._guerra_confirmar(conta, corpo))   # 15/09: a largada antes

    def _guerra_confirmar(self, conta, corpo):
        # 19/09 (a 2ª rodada de conserto): a versão das regras da página contra a do juiz ANTES de confirmar — a
        # página de antes do deploy (ou de antes do número) não entra na guerra para os quatro caírem como fraude no
        # fim; o 409 'regras-velhas' diz para recarregar (salas.py, _confere_versao_cliente; sem juiz: 503)
        self._confere_versao_cliente(corpo, self._regras())
        cid, agora_ms = conta['id'], _ms()
        pronta = outra_guilda = None
        with self._escrita():
            self._guerra_arruma(agora_ms)
            p = self._guerra_partida_de(cid, agora_ms)
            if p is None:
                raise Recusa(409, 'não há guerra para confirmar (o prazo pode ter passado)', motivo='sem-partida')
            if p['estado'] == 'casada':
                eu = self.con.execute("SELECT * FROM guerra_jogadores WHERE gid = ? AND conta_id = ?",
                                      (p['gid'], cid)).fetchone()
                if self._guerra_guilda_id(cid) != eu['guilda_id']:
                    # 19/09: saiu da guilda (ou foi expulso) com a partida casada — não luta por ela: a partida cai
                    # e o OUTRO lado volta à fila com o lugar (a Recusa dentro de _escrita desfaria tudo: sai depois)
                    self._guerra_cai(p, agora_ms, ['B' if eu['lado'] == 'A' else 'A'], 'guilda')
                    self._guerra_casa(agora_ms)
                    outra_guilda = True
                else:
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
                            # 19/09: a luta aberta da guerra — quem abrir outra luta com esta pendente a larga
                            self.con.execute("INSERT OR REPLACE INTO luta_aberta_guerra(conta_id, gid, desde_ms, estado) "
                                             "VALUES (?, ?, ?, 'aberta')", (j['conta_id'], p['gid'], agora_ms))
                        self.con.execute("UPDATE guerra_partidas SET estado = 'pronta', pronta_ms = ?, semente = ? "
                                         "WHERE gid = ?", (agora_ms, secrets.randbits(31), p['gid']))
                        for j in js:
                            self._evento(j['conta_id'], 'guerra-pronta', {'gid': p['gid']})
                        pronta = p['gid']
            elif p['ata'] is None:
                pronta = p['gid']
        if outra_guilda:
            raise Recusa(409, 'você já não é da guilda pela qual essa guerra casou', motivo='outra-guilda')
        if pronta:
            self._guerra_ata(pronta)
        with self._escrita():
            return 200, self._guerra_estado(cid, _ms())

    def _guerra_ata(self, gid):
        """A ata da partida pronta: os oito payloads saem do juiz (o estado do SERVIDOR de cada conta), a vida de
        cada herói da linha guardada no confirmar. Falha do juiz: fica sem ata e a consulta seguinte tenta de novo;
        herói que sumiu da conta (422): a partida cai. 19/09: uma ata por gid de cada vez neste processo."""
        with _atas_tranca:
            if gid in _atas_em_curso:
                return
            _atas_em_curso.add(gid)
        try:
            self._guerra_ata_de_verdade(gid)
        finally:
            with _atas_tranca:
                _atas_em_curso.discard(gid)

    def _guerra_ata_de_verdade(self, gid):
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
                    self._guerra_pronta_cai(p, _ms(), 'estado')
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
                    self._guerra_pronta_cai(p, _ms(), e.extra.get('motivo'))
            return
        if (not isinstance(saida, dict) or saida.get('ok') is not True or not isinstance(saida.get('A'), list)
                or not isinstance(saida.get('B'), list)):
            return
        ata = {'mapa': MAPA_GUERRA, 'sala': 0, 'semente': p['semente'], 'A': saida['A'], 'B': saida['B'],
               'carry': carry or None}
        # 19/09: a versão das regras (Engine.VERSAO_REGRAS do juiz) com que a guerra abriu, na própria ata — o juiz
        # confere ao fechar (guerra.js → sala.js) e, sob outra versão, a guerra vence em vez de cair como fraude.
        # A 2ª rodada de conserto: o número vem na PRÓPRIA resposta do /guerra/ata (o juiz que montou a ata é o que
        # a refaz — sem segunda chamada, sem o /regras guardado de um juiz de antes do deploy); só a resposta de
        # um juiz que não o manda cai na consulta guardada
        regras = saida.get('regras')
        if not _inteiro_puro(regras):
            try:
                regras = self._regras().get('regras')
            except Recusa:
                regras = None
        if not _inteiro_puro(regras):
            # 3ª rodada da revisão: sem o número a ata NÃO grava — a consulta seguinte refaz a ata (e o /regras). A ata
            # gravada sem a chave era lida no fechar como a versão 1 ("chave ausente = de antes do número") e o juiz
            # vencia a guerra inteira dos quatro no fim, sem XP e sem vida (provado pelo revisor)
            log.info("guerra %s: a ata ficou sem a versão das regras — fica para a consulta seguinte", gid)
            return
        ata['regras'] = regras
        with self._escrita():
            # só na pronta: alguém pode ter saído dela enquanto o juiz montava a ata (guerra_sair a derruba)
            self.con.execute("UPDATE guerra_partidas SET ata = ? WHERE gid = ? AND ata IS NULL AND estado = 'pronta'",
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
                self._guerra_cai(p, agora_ms, ['B' if eu['lado'] == 'A' else 'A'], 'recusa')
                self._guerra_casa(agora_ms)           # 19/09: o lado que voltou à fila casa na hora, se der
            return 200, self._guerra_estado(cid, agora_ms)

    def guerra_sair(self, conta, corpo):
        cid, agora_ms = conta['id'], _ms()
        # 19/09: com o gid da partida PRONTA, a conta declara que saiu da guerra — os heróis dela a 0 na hora
        gid = corpo.get('gid') if isinstance(corpo, dict) else None
        if isinstance(gid, str) and RE_GID_GUERRA.match(gid):
            if self._guerra_declara_saida(conta, gid, 'saiu'):
                with self._escrita():
                    return 200, self._guerra_estado(cid, _ms())
            with self._escrita():
                # 2ª rodada da revisão: sair da pronta cuja ata ainda não saiu (o juiz lento, ou fora do ar por minutos)
                # — a guerra não começou: cai para os quatro sem custo, e o outro lado volta à fila com o lugar (como a
                # recusa da casada). Antes respondia 'pronta' e o jogador ficava preso até a ata cair sozinha em 3 min
                p = self.con.execute("SELECT * FROM guerra_partidas WHERE gid = ? AND estado = 'pronta' AND ata IS NULL",
                                     (gid,)).fetchone()
                eu = self.con.execute("SELECT lado FROM guerra_jogadores WHERE gid = ? AND conta_id = ?",
                                      (gid, cid)).fetchone() if p is not None else None
                if eu is not None and self._guerra_pronta_cai(p, agora_ms, 'saiu', ['B' if eu['lado'] == 'A' else 'A']):
                    self._guerra_casa(agora_ms)
                    return 200, self._guerra_estado(cid, agora_ms)
        with self._escrita():
            self._guerra_arruma(agora_ms)
            f = self._guerra_inscricao_de(cid)
            if f is not None:
                self._guerra_desfaz_inscricao(f, cid, 'saiu')
        return self.guerra_recusar(conta, corpo)

    def _guerra_declara_saida(self, conta, gid, motivo, lado_pedido=None):
        """A SAÍDA declarada da guerra pronta (19/09): a linha em guerra_saidas, os heróis da conta a 0 com o PV
        máximo que o juiz dá, a luta aberta dela fechada e os outros três avisados. True se a conta está nessa
        partida pronta (já ter saído também conta); False se a partida não é dela, não está pronta ou a ata ainda
        não saiu (a guerra não começou: guerra_sair a derruba). `lado_pedido` (o `lado` do desistiu) que não é o
        dela = 403 'desistencia-alheia'."""
        cid = conta['id']
        with self.tranca:
            p = self.con.execute("SELECT * FROM guerra_partidas WHERE gid = ?", (gid,)).fetchone()
            eu = self.con.execute("SELECT * FROM guerra_jogadores WHERE gid = ? AND conta_id = ?", (gid, cid)).fetchone() \
                if p is not None else None
            if eu is None:
                return False
            if lado_pedido is not None and lado_pedido != eu['lado']:
                raise Recusa(403, 'a desistência só vale da conta de quem desiste', motivo='desistencia-alheia')
            if p['estado'] == 'pronta' and p['ata'] is None:
                # 2ª rodada da revisão: a guerra não começou (a ata não saiu) — não há de onde sair; respondia 'pronta'
                # sem declarar nada, e o jogo repetia o pedido achando que declarou. guerra_sair a derruba
                return False
            if p['estado'] != 'pronta' or cid in self._guerra_saidas(gid) \
                    or self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?", (gid,)).fetchone():
                return p['estado'] in ('pronta', 'fechada')
        maximos = self._guerra_maximos(conta, p, eu)             # o juiz, fora da tranca
        agora_ms = _ms()
        with self._escrita():
            if self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?", (gid,)).fetchone():
                return True
            self._guerra_saida(p, eu, motivo, maximos, agora_ms)
        log.info("guerra %s: conta #%d saiu (%s), heróis a 0", gid, cid, motivo)
        return True

    def _guerra_saida(self, p, eu, motivo, maximos, agora_ms):
        """Dentro de _escrita: a saída de `eu` (uma linha de guerra_jogadores) da partida `p`. Idempotente."""
        n = self.con.execute("INSERT OR IGNORE INTO guerra_saidas(gid, conta_id, em_ms, motivo) VALUES (?, ?, ?, ?)",
                             (p['gid'], eu['conta_id'], agora_ms, motivo)).rowcount
        if not n:
            return False
        hs = json.loads(eu['herois'])
        self._vida_grava_fim(eu['conta_id'], {h: 0 for h in hs}, maximos, agora_ms)
        self.con.execute("UPDATE luta_aberta_guerra SET estado = ? WHERE conta_id = ? AND gid = ? AND estado = 'aberta'",
                         ('largada' if motivo == 'largada' else 'fechada', eu['conta_id'], p['gid']))
        for j in self._guerra_jogadores(p['gid']):
            if j['conta_id'] != eu['conta_id']:
                self._evento(j['conta_id'], 'guerra-saiu', {'gid': p['gid'], 'por': eu['conta_id'], 'motivo': motivo})
        return True

    def _guerra_maximos(self, conta, p, eu):
        """FORA da tranca: {heroId: PV máximo} dos heróis da conta nesta guerra — o juiz refaz a guerra SEM lance
        (a sala nasce e para) e devolve o máximo de cada herói por dono, o mesmo do fechar (como salas.py,
        _larga_maximos). Juiz que recusa: o máximo da linha que o herói já tem; sem linha, a vida volta cheia em
        2 s (a falha não pune). Juiz fora do ar: 503 (a saída espera)."""
        hs = json.loads(eu['herois'])
        with self.tranca:
            reserva = {h: v['max'] for h, v in self._vida_de(eu['conta_id'], hs, _ms()).items()}
        try:
            saida = self.juiz.pede('POST', '/guerra/fecha', {'ata': json.loads(p['ata']), 'lances': [], 'hashFinal': None})
        except Recusa as e:
            if e.status == 422:
                return reserva
            raise
        mx = saida.get('vidaMax') if isinstance(saida, dict) and isinstance(saida.get('vidaMax'), dict) else {}
        mx = mx.get(eu['dono']) if isinstance(mx.get(eu['dono']), dict) else {}
        fora = dict(reserva)
        for h in hs:
            if _inteiro_puro(mx.get(h)) and mx[h] >= 1:
                fora[h] = mx[h]
        return fora

    def _guerra_larga(self, conta):
        """19/09, chamado por salas.py (_larga_pendentes): as guerras prontas que a conta deixou abertas e agora
        larga abrindo outra luta — os heróis dela a 0 (a saída declarada por ela, com o motivo 'largada') e o
        evento 'luta-largada'. Devolve a lista dos heróis largados (pode ser vazia). A pronta com resultado, a que
        ela já saiu, ou a de mais de LARGADA_JANELA_MS só fica 'fechada'."""
        cid = conta['id']
        agora_ms = _ms()
        largar, velhas, sem_ata = [], [], []
        with self.tranca:
            try:
                linhas = [dict(r) for r in self.con.execute(
                    "SELECT * FROM luta_aberta_guerra WHERE conta_id = ? AND estado = 'aberta'", (cid,))]
            except sqlite3.Error:
                return []
            for r in linhas:
                p = self.con.execute("SELECT * FROM guerra_partidas WHERE gid = ?", (r['gid'],)).fetchone()
                eu = self.con.execute("SELECT * FROM guerra_jogadores WHERE gid = ? AND conta_id = ?",
                                      (r['gid'], cid)).fetchone() if p is not None else None
                comigo = (p is not None and eu is not None and p['estado'] == 'pronta'
                          and cid not in self._guerra_saidas(r['gid'])
                          and self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?", (r['gid'],)).fetchone() is None)
                if comigo and p['ata'] is None:
                    sem_ata.append((r, p, eu))                  # 3ª rodada: a pronta cuja ata ainda não saiu
                elif comigo and agora_ms - r['desde_ms'] <= LARGADA_JANELA_MS:
                    largar.append((r, p, eu))
                else:
                    velhas.append((r, p, eu))
        if not largar and not velhas and not sem_ata:
            return []
        maximos = {r['gid']: self._guerra_maximos(conta, p, eu) for r, p, eu in largar}     # o juiz, fora da tranca
        herois = []
        with self._escrita():
            for r, _, _ in velhas:
                self.con.execute("UPDATE luta_aberta_guerra SET estado = 'fechada' WHERE conta_id = ? AND gid = ? "
                                 "AND estado = 'aberta'", (cid, r['gid']))
            # 3ª rodada da revisão: a pronta cuja ata ainda não saiu (o juiz lento, ou fora do ar) não é "velha" — a
            # linha ficava 'fechada' sem derrubar nada, a sala abria e, quando a ata saía, a conta lutava em duas frentes
            # sem a régua da largada (provado pelo revisor). Abrir outra luta antes de a guerra começar = sair dela: a
            # guerra cai para os quatro sem custo e o outro lado volta à fila com o lugar (o mesmo de guerra_sair {gid})
            for r, p, eu in sem_ata:
                if self._guerra_pronta_cai(p, agora_ms, 'saiu', ['B' if eu['lado'] == 'A' else 'A']):
                    self._guerra_casa(agora_ms)
                else:
                    # a ata saiu nesse meio: a guerra começou com a conta dentro — a abertura não passa agora (a Recusa
                    # desfaz a escrita; o pedido repetido larga a guerra como qualquer pronta com ata)
                    raise Recusa(409, 'a guerra começou nesse meio — tente de novo', motivo='mudou')
            for r, p, eu in largar:
                if self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?", (r['gid'],)).fetchone():
                    self.con.execute("UPDATE luta_aberta_guerra SET estado = 'fechada' WHERE conta_id = ? AND gid = ? "
                                     "AND estado = 'aberta'", (cid, r['gid']))
                    continue                                    # fechou no meio
                if not self._guerra_saida(p, eu, 'largada', maximos.get(r['gid']) or {}, agora_ms):
                    continue
                hs = json.loads(eu['herois'])
                self._evento(cid, 'luta-largada', {'tipo': 'guerra', 'ref': r['gid'], 'herois': hs})
                herois.extend(h for h in hs if h not in herois)
        if herois:
            log.info("guerra largada: conta #%d, heróis %s a 0", cid, ', '.join(herois))
        return herois

    # -- GET /api/guerra/estado ---------------------------------------------------------------------------------
    def guerra_estado(self, conta, corpo):
        """19/09: a consulta só ESCREVE quando há o que arrumar (o prazo de uma casada, uma inscrição velha, a
        troca de guilda, a pronta sem ata, a espera vencida) ou quando o "ainda estou aqui" precisa gravar
        (GUERRA_VISTO_ESCREVE_MS); no resto é leitura com a tranca — a fila de um sábado não vira 16 transações
        de escrita por segundo."""
        cid, agora_ms = conta['id'], _ms()
        faz_ata = None
        with self.tranca:
            escreve = self._guerra_precisa_arrumar(agora_ms)
            if not escreve:
                f = self._guerra_inscricao_de(cid)
                if f is not None:
                    visto = f['lider_visto_ms'] if f['lider_id'] == cid else f['parceiro_visto_ms']
                    escreve = visto is None or agora_ms - visto >= GUERRA_VISTO_ESCREVE_MS
        if escreve:
            with self._escrita():
                self._guerra_arruma(agora_ms)
        with self.tranca:
            p = self._guerra_partida_de(cid, agora_ms)
            if p is not None and p['estado'] == 'pronta' and p['ata'] is None:
                faz_ata = p['gid']
        if faz_ata and self._autoridade_ligada():
            self._guerra_ata(faz_ata)
        if escreve:
            with self._escrita():
                return 200, self._guerra_estado(cid, _ms())
        with self.tranca:
            return 200, self._guerra_estado(cid, _ms(), grava_visto=False)

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
        """Dentro de _escrita: o resultado (falha de chave = outro dos quatro guardou antes). A luta aberta dos
        quatro fecha e a espera da partida some (19/09)."""
        self.con.execute("INSERT INTO guerra_resultados(gid, fase, venc, xp, guilda_xp, a_guilda, b_guilda, criado_em, "
                         "resultado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                         (p['gid'], resultado['fase'], resultado.get('venc'), xp, guilda_xp, p['a_guilda'],
                          p['b_guilda'], t, json.dumps(resultado, ensure_ascii=False)))
        self.con.execute("UPDATE guerra_partidas SET estado = 'fechada' WHERE gid = ?", (p['gid'],))
        self.con.execute("UPDATE luta_aberta_guerra SET estado = 'fechada' WHERE gid = ? AND estado = 'aberta'", (p['gid'],))
        self.con.execute("DELETE FROM guerra_espera WHERE gid = ?", (p['gid'],))
        self.con.execute("DELETE FROM guerra_wo WHERE gid = ?", (p['gid'],))

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
                    'guilda': guildas.get(venc) if venc in ('A', 'B') else None, 'guildas': guildas, 'vida': vida,
                    'fechada': True}
        if res.get('motivo'):
            resposta['motivo'] = res['motivo']
        if res.get('fim'):
            resposta['fim'] = res['fim']          # 19/09: 'wo' (a queda provada) | 'saida' (os dois de um lado saíram)
        return 200, resposta

    # -- 19/09: a ESPERA de um fim (o fechamento sem fim, o recusado, o rápido demais, o fotografado) ----------------
    def _guerra_aguarda(self, gid, motivo, espera_ate_ms, agora_ms):
        """A resposta de quem fechou e ESPERA: {fase: 'aguardando', motivo, esperaAte (ms do servidor), esperaMs} —
        o jogo pergunta de novo (a cada 5 s) até 'fechada'."""
        return 200, {'ok': True, 'gid': gid, 'fase': 'aguardando', 'motivo': motivo, 'esperaAte': int(espera_ate_ms),
                     'esperaMs': max(0, int(espera_ate_ms) - int(agora_ms))}

    def _guerra_espera_grava(self, p, cid, lances, motivo, turnos, resultado, t):
        """Dentro de _escrita: a linha de guerra_espera desta conta (o registro mais longo dela fica; o recusado
        nunca cobre um refeito) e o começo da espera da partida (primeiro_fecho, se ainda não havia). Devolve
        (primeiro_fecho em s, lido do banco depois de gravar — o `p` de quem chama pode ser velho —, e se a conta
        já tinha uma linha esperando). A luta aberta da conta NÃO fecha aqui (2ª rodada da revisão): só o resultado
        final (_guerra_guarda) ou a saída declarada a fecham — quem fechou vazio e abre outra luta é largado."""
        havia = self.con.execute("SELECT 1 FROM guerra_espera WHERE gid = ? AND conta_id = ?", (p['gid'], cid)).fetchone()
        self.con.execute("UPDATE guerra_partidas SET primeiro_fecho = COALESCE(primeiro_fecho, ?) WHERE gid = ?", (t, p['gid']))
        self.con.execute(
            "INSERT INTO guerra_espera(gid, conta_id, lances, primeiro_ms, motivo, turnos, resultado) VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(gid, conta_id) DO UPDATE SET lances = excluded.lances, motivo = excluded.motivo, "
            "turnos = excluded.turnos, resultado = excluded.resultado "
            "WHERE guerra_espera.resultado IS NULL OR (excluded.resultado IS NOT NULL AND excluded.turnos >= guerra_espera.turnos)",
            (p['gid'], cid, json.dumps(lances) if lances is not None else None, t * 1000, motivo, int(turnos or 0),
             json.dumps(resultado, ensure_ascii=False) if resultado is not None else None))
        primeiro = self.con.execute("SELECT primeiro_fecho FROM guerra_partidas WHERE gid = ?", (p['gid'],)).fetchone()[0]
        return (primeiro if primeiro is not None else t), havia is not None

    def _guerra_espera_venceu(self, gid, primeiro, t):
        """Dentro de _escrita (2ª rodada da revisão): a espera da partida acabou — encerra por aqui (o registro
        recusado, o rápido demais e o sem fim repetidos pelo jogo a cada 5 s eram quem mais precisava disto: o 422
        seguia 'aguardando' com esperaMs 0 para sempre). True se a partida ficou guardada."""
        if t < primeiro + GUERRA_ESPERA:
            return False
        p2 = self.con.execute("SELECT * FROM guerra_partidas WHERE gid = ?", (gid,)).fetchone()
        self._guerra_encerra_espera(p2, t)
        return self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?", (gid,)).fetchone() is not None

    def _guerra_grava_vida(self, j, vida, maximos, agora_ms, zerada=False):
        """Dentro de _escrita: a vida dos heróis de UM jogador, da saída do juiz ({dono: {heroId: PV}})."""
        hs = json.loads(j['herois'])
        fim = vida.get(j['dono']) if isinstance(vida, dict) else None
        fim = fim if isinstance(fim, dict) else {}
        mx = maximos.get(j['dono']) if isinstance(maximos, dict) else None
        self._vida_grava_fim(j['conta_id'], {h: 0 for h in hs} if zerada else {h: fim[h] for h in hs if h in fim}, mx, agora_ms)

    def _guerra_encerra_espera(self, p, t):
        """Dentro de _escrita: a espera acabou sem um registro com fim. O fim FORÇADO que é fato do servidor vale
        primeiro (3ª rodada da revisão): os dois de um lado fora, ou o W.O. provado pelo Relé de quem o declarou — com
        a vida do replay mais longo guardado na espera e XP nos tetos. Senão, com algum registro refeito, 'sem-fim'
        (ou 'wo-sem-prova', se o melhor registro era um W.O. sem prova) com a vida do ponto do replay mais LONGO para
        todos (menos quem saiu: já está a 0); só recusados, 'recusada'; só fotografados, 'nao-conferida'. Sem XP em
        todos. Nada esperando (o juiz fora do ar no meio): a régua volta a zero e a partida segue pronta."""
        gid = p['gid']
        if self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?", (gid,)).fetchone():
            return
        esperas = self._guerra_espera_de(gid)
        fotos = json.loads(p['fotografadas']) if p['fotografadas'] else []
        if not esperas and not fotos:
            self.con.execute("UPDATE guerra_partidas SET primeiro_fecho = NULL WHERE gid = ?", (gid,))
            return
        js = self._guerra_jogadores(gid)
        melhor = next((e for e in esperas if e['resultado']), None)
        if melhor is not None:
            saidas, agora_ms = self._guerra_saidas(gid), _ms()
            foram = {k: all(j['conta_id'] in saidas for j in js if j['lado'] == k) for k in ('A', 'B')}
            if foram['A'] != foram['B'] and self._guerra_fecha_forcado(p, js, 'A' if foram['A'] else 'B', 'saida', t):
                return
            wo = self._guerra_wo_provado(p, agora_ms)
            if wo is not None and self._guerra_fecha_forcado(p, js, wo[1], 'wo', t):
                return
            res = _objeto(melhor['resultado']) or {}
            for j in js:
                if j['conta_id'] not in saidas:
                    self._guerra_grava_vida(j, res.get('vida') or {}, res.get('vidaMax') or {}, agora_ms)
            # o porquê fica (3ª rodada): quem declarou W.O. sem prova lê 'wo-sem-prova' na tela de fim, não 'sem-fim'
            motivo = 'wo-sem-prova' if melhor['motivo'] in ('wo', 'wo-sem-prova') else 'sem-fim'
            resultado = {'fase': res.get('fase') or 'playing', 'venc': None, 'turnos': melhor['turnos'], 'motivo': motivo}
        elif esperas:
            resultado = {'fase': 'recusada', 'venc': None, 'motivo': esperas[0]['motivo'] or 'juiz'}
        else:
            resultado = {'fase': 'nao-conferida', 'venc': None, 'motivo': 'fotografada'}
        self._guerra_guarda(p, resultado, t)
        for j in js:
            self._evento(j['conta_id'], 'guerra-fim', {'gid': gid, 'venc': None, 'lado': j['lado'], 'xp': 0, 'guilda': None,
                                                       'motivo': resultado['motivo'], 'por': None})
        log.info("guerra %s: a espera acabou sem fim (%s)", gid, resultado['motivo'])

    def _guerra_paga(self, p, js, venc, t):
        """Dentro de _escrita: o XP da vitória (dentro dos tetos) — (xp, guilda_xp, motivo)."""
        xp, guilda_xp, motivo = 0, None, None
        if venc in ('A', 'B'):
            guilda_xp = p['a_guilda'] if venc == 'A' else p['b_guilda']
            motivo = self._guerra_teto(p['a_guilda'], p['b_guilda'], t)
            if motivo is None and self.con.execute("SELECT 1 FROM guildas WHERE id = ?", (guilda_xp,)).fetchone() is None:
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
            motivo = 'sem-fim'
        return xp, guilda_xp, motivo

    def _guerra_fecha_com_fim(self, p, js, por, fase, venc, vida, maximos, turnos, perdeu, fim, t):
        """Dentro de _escrita: a guerra fecha COM FIM (do replay, ou forçado pela saída/W.O.) — o XP da vitória nos
        tetos, a vida dos oito (cada herói na conta de quem o levou: a chave do juiz é o dono; quem saiu já está a 0
        pela saída e não é regravado; o lado que perdeu por W.O./saída sai a 0), o resultado guardado e o evento
        'guerra-fim' aos quatro (`por` = quem fechou, ou None pela régua). Quem chama já viu que não há resultado."""
        gid = p['gid']
        xp, guilda_xp, motivo = self._guerra_paga(p, js, venc, t)
        saidas, agora_ms = self._guerra_saidas(gid), _ms()
        for j in js:
            if j['conta_id'] in saidas:
                continue
            self._guerra_grava_vida(j, vida, maximos, agora_ms, zerada=(perdeu == j['lado']))
        resultado = {'fase': fase, 'venc': venc, 'turnos': turnos}
        if motivo:
            resultado['motivo'] = motivo
        if fim:
            resultado['fim'] = fim
        self._guerra_guarda(p, resultado, t, xp, guilda_xp)
        for j in js:
            self._evento(j['conta_id'], 'guerra-fim', {'gid': gid, 'venc': venc, 'lado': j['lado'], 'xp': xp,
                                                       'guilda': guilda_xp, 'motivo': motivo, 'fim': fim, 'por': por})
        log.info("guerra fechada: %s venc=%s xp=%d%s", gid, venc, xp, (' (' + fim + ')') if fim else '')

    def _guerra_fecha_forcado(self, p, js, perdeu, fim, t):
        """Dentro de _escrita (3ª rodada da revisão): o fim FORÇADO pela régua — os dois de um lado fora ('saida'), ou
        o W.O. provado pelo Relé ('wo') — a partir do replay mais LONGO guardado na espera: o lado `perdeu` a 0, os
        outros com a vida desse replay, venc do outro lado com XP nos tetos; o mesmo que o juiz faz com `perdeu`
        (forcado), sem ir ao juiz. False se não há registro refeito na espera (só recusados ou fotografados: não há
        de onde tirar a vida)."""
        melhor = next((e for e in self._guerra_espera_de(p['gid']) if e['resultado']), None)
        if melhor is None:
            return False
        res = _objeto(melhor['resultado']) or {}
        venc = 'B' if perdeu == 'A' else 'A'
        self._guerra_fecha_com_fim(p, js, None, 'won' if venc == 'A' else 'lost', venc, res.get('vida') or {},
                                   res.get('vidaMax') or {}, melhor['turnos'], perdeu, fim, t)
        return True

    def guerra_fechar(self, conta, corpo):
        """Corpo {gid, lances, hashFinal, fotografada, desistiu?, lado?, wo?}. O juiz refaz a guerra com a ATA
        guardada (os oito payloads e a vida de cada um) e devolve o fim e a vida por dono; a vitória paga GUERRA_XP
        à guilda vencedora (dentro dos tetos), e a vida dos oito grava na conta de cada um — tudo numa transação.

        19/09 (a revisão): só um registro COM FIM (venc A/B/empate no replay) — ou o fim forçado pela saída dos
        dois de um lado, ou pelo W.O. provado — fecha a guerra na hora. Tudo o mais ESPERA (guerra_espera,
        GUERRA_ESPERA s desde o primeiro): o registro sem fim (grava a vida só de quem fechou), o recusado pelo
        juiz (422, nada gravado), o rápido demais, o fotografado e o W.O. cuja prova ainda não madurou (3ª rodada:
        com o replay guardado, para a consulta fechar o W.O. quando a prova vier). Um registro com fim de qualquer
        dos quatro dentro da espera vence; passado o prazo, 'sem-fim' com a vida do replay mais longo (sem XP). O
        fim forçado é fato do servidor: vale para o fotografado (o juiz recebe o registro vazio com `perdeu`) e para
        o registro recusado (idem)."""
        cid = conta['id']
        gid = corpo.get('gid')
        if not isinstance(gid, str) or not RE_GID_GUERRA.match(gid):
            raise Recusa(400, 'gid inválido', motivo='gid')
        lances, hash_final = _lances(corpo)
        fotografada = corpo.get('fotografada') is True
        desistiu, wo = corpo.get('desistiu') is True, corpo.get('wo') is True
        if desistiu and wo:
            raise Recusa(400, 'desistiu e wo não andam juntos', motivo='desistiu-e-wo')
        if desistiu:
            # a desistência é a saída declarada da própria conta: os dois heróis dela a 0 na hora; a guerra segue
            # para os outros (o registro dela entra na espera como qualquer outro sem fim)
            self._guerra_declara_saida(conta, gid, 'desistiu', corpo.get('lado'))
        so_vazio = False           # 3ª rodada: o fim forçado vai ao juiz com o registro VAZIO quando o de quem fecha não serve
        for _ in range(TENTATIVAS):
            instante = time.time()
            t, agora_ms = int(instante), int(instante * 1000)
            acao = perdeu = fim = motivo_espera = espera_ate = None
            js = saidas = None
            vazio = False
            with self._escrita():
                p = self.con.execute("SELECT * FROM guerra_partidas WHERE gid = ?", (gid,)).fetchone()
                eu = self.con.execute("SELECT * FROM guerra_jogadores WHERE gid = ? AND conta_id = ?",
                                      (gid, cid)).fetchone() if p is not None else None
                if p is None or eu is None:
                    raise Recusa(404, 'guerra não encontrada', motivo='sem-partida')
                if self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?", (gid,)).fetchone():
                    acao = 'guardado'
                elif p['estado'] not in ('pronta', 'fechada') or p['ata'] is None:
                    raise Recusa(409, 'essa guerra não chegou a começar', motivo='sem-partida')
                else:
                    js = self._guerra_jogadores(gid)
                    saidas = self._guerra_saidas(gid)
                    lados = {k: [j for j in js if j['lado'] == k] for k in ('A', 'B')}
                    foram = {k: all(j['conta_id'] in saidas for j in lados[k]) for k in lados}
                    outro = 'B' if eu['lado'] == 'A' else 'A'
                    # 3ª rodada da revisão: o fim FORÇADO (os dois de um lado fora, o W.O. provado) é fato do servidor e
                    # vale também para quem foi restaurado por foto — o ramo do fotografado vinha antes e o engolia:
                    # 'aguardando fotografada' e, 120 s depois, 'nao-conferida' por cima da prova (provado pelo revisor)
                    if foram['A'] and foram['B']:
                        pass                                    # os quatro saíram: sem fim, sem XP (todos já a 0)
                    elif foram[outro] or foram[eu['lado']]:
                        # os dois de um lado saíram (sair, desistiu, largada): o outro lado vence, com XP nos tetos
                        perdeu, fim = (outro if foram[outro] else eu['lado']), 'saida'
                    elif wo:
                        # o W.O. declarado por quem ficou: a prova é do Relé (presenca.py), para os DOIS adversários
                        # que não saíram, desde a CASADA (criada_ms — 3ª rodada: contava da pronta, e a queda de quem
                        # confirmou pelo HTTP com o Relé já caído e nunca voltou ficava 'nada'; o 'voltou' dentro da
                        # janela já anula a queda velha); 'nada' espera WO_ESPERA_MS do PRIMEIRO pedido de W.O. da
                        # partida (guerra_wo — 2ª rodada: contava do primeiro_fecho, e o vazio de outro dos quatro
                        # dois minutos antes pulava a espera que dá tempo ao Relé de anotar a queda)
                        pedido_wo = self.con.execute("SELECT pedido_ms FROM guerra_wo WHERE gid = ?", (gid,)).fetchone()
                        primeiro_ms = pedido_wo[0] if pedido_wo is not None else agora_ms
                        provas = [presenca.prova_de_queda(self.con, j['conta_id'], p['criada_ms'], agora_ms)
                                  for j in lados[outro] if j['conta_id'] not in saidas]
                        if all(v == 'provada' for v, _ in provas):
                            perdeu, fim = outro, 'wo'
                        elif any(v == 'sem' for v, _ in provas) or any(
                                v == 'nada' and agora_ms >= primeiro_ms + WO_ESPERA_MS for v, _ in provas):
                            fim = 'wo-sem-prova'                # sem prova: o replay vale como um fechamento sem fim
                        else:
                            # a prova ainda não madurou: o registro vai ao juiz e fica na ESPERA com motivo 'wo' (3ª
                            # rodada — o pedido não ficava em lugar nenhum: o estado de quem declarou era 'pronta', a
                            # consulta nunca lia a prova madura, a partida ficava pronta para sempre e quem ficou e
                            # declarou era largado a 0 ao abrir outra luta); a prova madura fecha o W.O. também pela
                            # consulta de qualquer um dos quatro (_guerra_wo_provado)
                            self.con.execute("INSERT OR IGNORE INTO guerra_wo(gid, pedido_ms) VALUES (?, ?)", (gid, agora_ms))
                            fim = 'wo'
                            espera_ate = max([q for v, q in provas if v == 'cedo'] +
                                             [primeiro_ms + WO_ESPERA_MS for v, _ in provas if v == 'nada'])
                    if fotografada and (perdeu is not None or fim == 'wo'):
                        # o fotografado não refaz nada: o juiz recebe o registro VAZIO — com `perdeu`, o fim forçado (o
                        # lado ausente a 0, o presente com a vida do começo); com o W.O. pendente, a espera com a vida
                        # do começo (e a prova madura fecha o W.O. pela consulta)
                        vazio = True
                    elif fotografada:
                        # sincronizado por foto: não refaz; espera um registro com fim de outro dos quatro. Passado o
                        # prazo, a espera acaba por aqui (o registro limpo tardio de outro ainda vale: não passa por aqui)
                        if p['primeiro_fecho'] is not None and t >= p['primeiro_fecho'] + GUERRA_ESPERA:
                            self._guerra_encerra_espera(p, t)
                            acao = 'guardado' if self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?",
                                                                  (gid,)).fetchone() else None
                        if acao is None:
                            fotos = json.loads(p['fotografadas']) if p['fotografadas'] else []
                            if cid not in fotos:
                                fotos.append(cid)
                            primeiro = p['primeiro_fecho'] if p['primeiro_fecho'] is not None else t
                            self.con.execute("UPDATE guerra_partidas SET fotografadas = ?, primeiro_fecho = ? WHERE gid = ?",
                                             (json.dumps(fotos), primeiro, gid))
                            acao, motivo_espera, espera_ate = 'aguarda', fim or 'fotografada', (primeiro + GUERRA_ESPERA) * 1000
                    if acao is None:
                        acao = 'juiz'
            if acao == 'guardado':
                return self._guerra_resposta(cid, gid)
            if acao == 'aguarda':
                return self._guerra_aguarda(gid, motivo_espera, espera_ate, agora_ms)
            # o juiz: a ata, o registro, quem fecha e a prova da marca `morte` de rede (as saídas declaradas)
            ata = json.loads(p['ata'])
            if not _inteiro_puro(ata.get('regras')):
                ata['regras'] = 1               # 19/09: a ata sem número é de antes do número — a versão 1 do engine.js
            if perdeu is not None and so_vazio:
                vazio = True
            pedido = {'ata': ata, 'lances': [] if vazio else lances, 'hashFinal': None if vazio else hash_final,
                      'fechou': {'conta': cid, 'dono': eu['dono'], 'lado': eu['lado']},
                      'contas': {j['dono']: j['conta_id'] for j in js},
                      'saidas': {str(c): ms for c, ms in saidas.items()}}
            if perdeu:
                pedido['perdeu'] = perdeu
            try:
                saida = self.juiz.pede('POST', '/guerra/fecha', pedido)
            except Recusa as e:
                if e.status == 422 and e.extra.get('motivo') == 'regras-mudaram':
                    # 19/09: o deploy trocou uma regra no meio da guerra — ela VENCE para os quatro na hora (não é
                    # fraude, e não há registro de ninguém que o juiz novo refaça igual): sem XP, sem vida gravada, sem
                    # os 120 s de espera, e a trilha dos quatro diz o porquê
                    self._regras_esquece()                  # o juiz é outro: o /regras guardado pode ser velho
                    with self._escrita():
                        if not self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?", (gid,)).fetchone():
                            self._guerra_guarda(p, {'fase': 'vencida', 'venc': None, 'motivo': 'regras-mudaram'}, t)
                            for j in js:
                                self._evento(j['conta_id'], 'guerra-fim', {'gid': gid, 'venc': None, 'lado': j['lado'], 'xp': 0,
                                                                           'guilda': None, 'motivo': 'regras-mudaram', 'por': None})
                    log.info("guerra %s vencida por regras novas — %.200s", gid, e.erro)
                    return self._guerra_resposta(cid, gid)
                if e.status == 422 and perdeu is not None and not vazio:
                    # 3ª rodada: o fim forçado é fato do servidor e não depende do registro de ninguém — o de quem fecha
                    # não serve (recusado): a volta vai ao juiz com o vazio (o presente com a vida do começo)
                    so_vazio = True
                    continue
                if e.status == 422:
                    # 19/09: o registro recusado NÃO fecha a guerra (era 'recusada' na hora, e um veto de graça para
                    # qualquer perdedor): entra na espera sem gravar nada; o limpo de outro dos quatro vence
                    motivo = e.extra.get('motivo') or 'juiz'
                    with self._escrita():
                        if self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?", (gid,)).fetchone():
                            return self._guerra_resposta(cid, gid)
                        primeiro, havia = self._guerra_espera_grava(p, cid, None, motivo, 0, None, t)
                        if not havia:
                            self._evento(cid, 'guerra-recusada', {'gid': gid, 'motivo': motivo})
                        # 2ª rodada: passada a espera, o recusado repetido encerra por aqui ('recusada', ou o sem-fim
                        # de outro) — o jogo repete o fechar a cada 5 s e não consulta o estado na tela de fim
                        if self._guerra_espera_venceu(gid, primeiro, t):
                            acao = 'guardado'
                    if acao == 'guardado':
                        return self._guerra_resposta(cid, gid)
                    ate = (primeiro + GUERRA_ESPERA) * 1000
                    raise Recusa(422, e.erro, motivo=motivo, fase='aguardando', esperaAte=ate, esperaMs=max(0, ate - agora_ms))
                raise
            if (not isinstance(saida, dict) or saida.get('ok') is not True or not isinstance(saida.get('fase'), str)
                    or not isinstance(saida.get('vida'), dict)):
                raise Recusa(503, 'o juiz respondeu torto — tente de novo em instantes')
            turnos = max(0, inteiro(saida.get('turnosJogador')))
            minimo = max(SALA_MIN_S, SALA_S_POR_TURNO * turnos)
            if instante - p['pronta_ms'] / 1000.0 < minimo:
                with self._escrita():
                    if self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?", (gid,)).fetchone():
                        return self._guerra_resposta(cid, gid)
                    primeiro, _ = self._guerra_espera_grava(p, cid, None, 'rapido-demais', 0, None, t)
                    if self._guerra_espera_venceu(gid, primeiro, t):           # 2ª rodada: encerra pelo fechar também
                        acao = 'guardado'
                if acao == 'guardado':
                    return self._guerra_resposta(cid, gid)
                ate = (primeiro + GUERRA_ESPERA) * 1000
                raise Recusa(422, 'a guerra fechou rápido demais para ser de verdade', motivo='rapido-demais',
                             fase='aguardando', esperaAte=ate, esperaMs=max(0, ate - agora_ms))
            venc = saida.get('venc') if saida.get('venc') in ('A', 'B', 'empate') else None
            if venc is not None and not saida.get('forcado'):
                perdeu = fim = None                             # o replay acabou de verdade: vale o fim dele
            vida = saida['vida']
            maximos = saida.get('vidaMax') if isinstance(saida.get('vidaMax'), dict) else {}
            if venc is None:
                # SEM FIM (a guerra largada no meio, o W.O. sem prova ou ainda sem a prova madura, o registro vazio):
                # nunca é final na hora — a vida SÓ dos heróis de quem fechou, e a espera por um registro com fim de
                # outro dos quatro. A luta aberta dela segue ABERTA (2ª rodada: fechava, e quem perdia fechava vazio
                # do console, saía com a vida do começo e abria outra luta no meio da guerra): quem abre outra luta
                # antes do fim é largado
                motivo_espera = fim or 'sem-fim'
                try:
                    with self._escrita():
                        if self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?", (gid,)).fetchone():
                            raise EstadoMudou()
                        primeiro, _ = self._guerra_espera_grava(
                            p, cid, pedido['lances'], motivo_espera, turnos,
                            {'fase': saida['fase'], 'vida': vida, 'vidaMax': maximos}, t)
                        # 3ª rodada da revisão: as saídas relidas AQUI, dentro da escrita — o `saidas` de antes do juiz
                        # deixava o sair {gid} (ou a largada de outra aba) que entrou nesse meio ser sobrescrito pela
                        # vida do replay (com lances=[] a do começo): a conta ficava 'livre', com a saída declarada e a
                        # vida cheia, e nunca era regravada (provado em 2 de 3 corridas). A regra do arquivo: nenhuma
                        # escrita de vida_heroi decide com uma leitura de antes da ida ao juiz
                        if cid not in self._guerra_saidas(gid):
                            self._guerra_grava_vida(eu, vida, maximos, _ms())
                        if self._guerra_espera_venceu(gid, primeiro, t):
                            acao = 'guardado'
                except EstadoMudou:
                    continue
                if acao == 'guardado':
                    return self._guerra_resposta(cid, gid)
                return self._guerra_aguarda(gid, motivo_espera, espera_ate or (primeiro + GUERRA_ESPERA) * 1000, agora_ms)
            # COM FIM (do replay, ou forçado pela saída/W.O.): a guerra fecha — o XP e a vida dos oito
            try:
                with self._escrita():
                    if self.con.execute("SELECT 1 FROM guerra_resultados WHERE gid = ?", (gid,)).fetchone():
                        raise EstadoMudou()                  # outro dos quatro fechou junto: a volta lê o guardado
                    self._guerra_fecha_com_fim(p, js, cid, saida['fase'], venc, vida, maximos, turnos, perdeu, fim, t)
            except EstadoMudou:
                continue
            return self._guerra_resposta(cid, gid)
        raise Recusa(409, 'a guerra mudou no meio — tente de novo', motivo='mudou')
