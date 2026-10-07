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

A VIDA ÚNICA (14/09): as duas portas (grupo/abrir e duelo/abrir) leem a vida de agora de cada herói na linha
  da conta dele (vida_heroi, salas.py), e todo fim refeito pelo juiz grava a vida do fim de volta.

O DUELO RANQUEADO (POST /api/duelo/abrir e /api/duelo/fechar)
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

import presenca                   # 15/09: a queda e a volta de cada conta, que o Relé grava (a prova do W.O.)
from comum import EstadoMudou, Recusa, agora, inteiro
from guilda import soma_meta      # 07/10: a sala em grupo vencida entra na meta da semana da guilda de cada membro
from salas import (DIFICULDADES, LANCES_MAX, RE_BILHETE, RE_CALABOUCO, SALA_MIN_S, SALA_S_POR_TURNO, SALA_VALIDADE,
                   SEM_ESTADO, TENTATIVAS, _inteiro_puro, _lista, _objeto)

log = logging.getLogger('api')

GRUPO_ESPERA = 120                # segundos que um fechamento fotografado espera um registro limpo
# 15/09, AS FALHAS CONHECIDAS (o dono: "arrume as falhas conhecidas" — desistir ou sumir do duelo não custava nada):
# o fechamento do lado que RECEBEU a desistência (o replay sem fim, sem declaração) grava a vida do replay dos dois e
# espera tanto a declaração do desistente; passado o prazo, fica assim, sem coroa
DUELO_ESPERA_MS = 120 * 1000
# o W.O. sem nenhuma queda anotada ainda espera tanto desde o primeiro pedido: o relé só vê a conexão morta quando o
# ping dela vence (até ~40 s), e o cliente que ficou declara o W.O. 60 s depois do último sinal
WO_ESPERA_MS = 60 * 1000
DUELOS_POR_PAR = 3                # duelos ranqueados entre as mesmas duas contas, em 24 h
DUELOS_POR_CONTA = 20             # duelos ranqueados de uma conta, em 24 h
DUELO_JANELA = 24 * 3600
# 14/09: aberturas NOVAS de duelo (POST /api/duelo/abrir) por conta, por hora — no espírito do SALAS_POR_HORA:
# guardar a vida é barato, mas não é porta para encher o banco
DUELO_ABERTURAS_POR_HORA = 60
TETO = {'fase': 'teto', 'venc': None, 'ranqueado': False, 'motivo': 'teto'}
# 14/09, AS TRÊS FORMAS DE DUELO (o dono: "tem duas formas de desafio: um normal, ou um pvp, ou a inscrição na
# arena e espera um adversário"; e "o duelo deve ocorrer no mapa da praça. Mapas aleatórios é para pvp de inscrição
# na arena ou pvp comum no mapa pvp"). O `modo` viaja no corpo do fechar:
#   desafio  o amistoso da praça, no mapa FIXO 'praca' (js/core/data/arenas.js): nunca ranqueia, nem conta nos tetos
#   arena    a fila da Arena (servidor/arena.py): ranqueia só com a partida pronta desse did entre essas duas contas
#   campo    o Campo de PvP: ranqueia com a paridade larga
# A PARIDADE é a diferença de nível entre o herói MAIS FORTE de cada lado, lida nos estados do SERVIDOR (o dono: até
# 3 na Arena, 10 no Campo). Sem `modo` (a página de antes do deploy) o duelo vale como amistoso.
# 03/10, O DONO BAIXOU A ARENA DE 5 PARA 3: a bancada do equilíbrio (docs/EQUILIBRIO.md §6.3) mediu o lado 5 níveis
# acima vencendo 65–80% — cinco níveis decidiam a coroa antes da luta. O Campo (10, regra dele: lá se ataca sem
# aviso quem passa) e a guerra de guilda (GUERRA_PARIDADE, 10) ficam como estão.
MODOS_DUELO = ('desafio', 'arena', 'campo')
MAPA_DESAFIO = 'praca'
PARIDADE = {'arena': 3, 'campo': 10}
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
-- 19/09: a versão das regras (Engine.VERSAO_REGRAS, a que o juiz anuncia em GET /regras) com que a sala em grupo
-- abriu e com que o duelo abriu (o primeiro duelo/abrir do did), mais o hash dos dados do juiz. O fechamento manda
-- o número na ata/pedido e o juiz confere ANTES de refazer (servidor/juiz/sala.js): sob outra versão a luta VENCE
-- ('regras-mudaram') em vez de cair como fraude ('divergiu'). Linha ausente com a luta aberta = de antes do
-- número = versão 1 (docs/SEGURANCA.md §4.1). Tabelas novas, nunca ALTER
CREATE TABLE IF NOT EXISTS salas_grupo_regras(
  gid       TEXT PRIMARY KEY REFERENCES salas_grupo(gid) ON DELETE CASCADE,
  regras    INTEGER NOT NULL,
  versao    TEXT
);
-- 07/10: o afixo com que a sala em grupo abriu (o mesmo desenho de salas_afixo, salas.py)
CREATE TABLE IF NOT EXISTS salas_grupo_afixo(
  gid       TEXT PRIMARY KEY REFERENCES salas_grupo(gid) ON DELETE CASCADE,
  afixo     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS duelos_regras(
  did       TEXT PRIMARY KEY,
  regras    INTEGER NOT NULL,
  versao    TEXT
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
-- 14/09, a vida única: a vida com que cada lado entra no duelo, guardada no POST /api/duelo/abrir (carry
-- {heroId: PV} dos heróis feridos, ou NULL = cheio). O fechamento refaz o duelo com ela
CREATE TABLE IF NOT EXISTS duelo_vida(
  did        TEXT NOT NULL,
  conta_id   INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  herois     TEXT NOT NULL,
  carry      TEXT,
  criado_em  INTEGER NOT NULL,
  PRIMARY KEY (did, conta_id)
);
-- 15/09, as falhas conhecidas: o fechamento do duelo que ESPERA, uma linha por did. 'sem-fim' = o lado que recebeu a
-- desistência fechou primeiro (a vida do replay dos dois já gravada; `resultado` guarda a fase) e espera a declaração
-- do desistente; 'wo' = o W.O. declarado espera a prova de queda do relé (servidor/presenca.py)
CREATE TABLE IF NOT EXISTS duelo_espera(
  did          TEXT PRIMARY KEY,
  conta_id     INTEGER NOT NULL,
  motivo       TEXT NOT NULL,
  primeiro_ms  INTEGER NOT NULL,
  resultado    TEXT
);
"""


def _herois(v, campo):
    if (not isinstance(v, list) or not 1 <= len(v) <= 2 or any(not isinstance(h, str) or not 0 < len(h) <= 64 for h in v)
            or len(set(v)) != len(v)):
        raise Recusa(400, '%s precisa ser uma lista de 1 ou 2 heróis diferentes' % campo)
    return list(v)


def _nivel_forte(progress, herois):
    """14/09: o nível do herói MAIS FORTE da lista, no estado do servidor (a régua da paridade). Sem ficha, 1."""
    fichas = progress.get('heroes') if isinstance(progress, dict) else None
    fichas = fichas if isinstance(fichas, dict) else {}
    melhor = 1
    for h in herois or ():
        f = fichas.get(h) if isinstance(h, str) else None
        lv = f.get('level') if isinstance(f, dict) else None
        if _inteiro_puro(lv) and lv > melhor:
            melhor = lv
    return melhor


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


class GrupoMixin:

    # -- POST /api/grupo/pocao (13/09; 14/09: a rota de antes da vida única) ---------------------------
    def grupo_pocao(self, conta, corpo):
        """Corpo {gid, heroId, pocaoId}. A página velha aberta durante o deploy continua bebendo: do gid só se
        confere o formato, e o resto é o POST /api/vida/pocao com o heroId do corpo. Cada jogador segue curando
        só os PRÓPRIOS heróis, com as próprias poções: a linha e o estado são os da conta que pede."""
        gid = corpo.get('gid')
        if not isinstance(gid, str) or not RE_BILHETE.match(gid):
            raise Recusa(400, 'gid inválido')
        return self.vida_pocao(conta, corpo)

    def _grupo_vida_grava(self, party, carry, vida_max, gid=None, so_conta=None):
        """Dentro de _escrita (14/09, a vida única): a vida do fim de cada herói da sala em grupo, na linha da
        conta que o levou. A chave do juiz é dono:heroId; a conta e o heroId saem da party guardada (e não
        cortando a chave no ':', porque o id de rede do dono pode ter ':'). 15/09: a conta que já saiu desta sala
        (largou, ou fechou a parte dela pelo registro — luta_aberta) não é regravada pelo fechamento do parceiro;
        `so_conta` grava só os heróis daquela conta."""
        carry = carry if isinstance(carry, dict) else {}
        maximos = vida_max if isinstance(vida_max, dict) else {}
        agora_ms = int(time.time() * 1000)
        saiu = set()
        if gid:
            saiu = {r[0] for r in self.con.execute("SELECT conta_id FROM luta_aberta WHERE tipo = 'grupo' AND ref = ? "
                                                   "AND estado IN ('registro', 'largada')", (gid,))}
        for p in party if isinstance(party, list) else []:
            if (not isinstance(p, dict) or not _inteiro_puro(p.get('conta')) or not isinstance(p.get('dono'), str)
                    or not isinstance(p.get('herois'), list)):
                continue
            if p['conta'] in saiu or (so_conta is not None and p['conta'] != so_conta):
                continue
            fim, mx = {}, {}
            for h in p['herois']:
                chave = p['dono'] + ':' + h if isinstance(h, str) else None
                if chave in carry:
                    fim[h], mx[h] = carry[chave], maximos.get(chave)
            self._vida_grava_fim(p['conta'], fim, mx, agora_ms)

    def _conta_viva(self, cid):
        """Dentro da tranca: a linha da conta (dict), ou None se não existe ou foi banida."""
        r = self.con.execute("SELECT * FROM contas WHERE id = ?", (cid,)).fetchone()
        return dict(r) if r is not None and not r['banido'] else None

    # -- POST /api/grupo/abrir ------------------------------------------------------------------
    def grupo_abrir(self, conta, corpo):
        # 15/09: a luta que a conta de quem lidera deixou aberta no servidor fica largada antes (salas.py, _com_largada)
        return self._com_largada(conta, lambda: self._grupo_abrir(conta, corpo))

    def _grupo_abrir(self, conta, corpo):
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
        # 19/09 (a 2ª rodada de conserto): a versão das regras da página de quem lidera contra a do juiz — a página
        # de antes do deploy não abre a sala em grupo para os dois caírem como fraude no fim (salas.py)
        regras = self._confere_versao_cliente(corpo, regras)
        n = regras['calaboucos'].get(dungeon)
        if not _inteiro_puro(n):
            raise Recusa(400, 'calabouço desconhecido ou fechado')
        if sala >= n:
            raise Recusa(400, 'essa sala não existe nesse calabouço (são %d)' % n)
        t = agora()
        afixo = self._afixo_da_abertura(corpo, dungeon, t, regras)    # 07/10: o afixo do Calabouço do Dia (salas.py)
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
            # 14/09, a vida única: em QUALQUER sala, cada herói com a vida de agora pela linha da conta DELE
            # (as poções de cada um entram na dele); os cheios ficam fora. A sala só abre com todos de pé — o
            # botão de quem lidera espera o mesmo
            agora_ms = int(time.time() * 1000)
            vidas = {}
            for conta_id, d, hs in ((cid, dono, herois), (pid, dono_p, herois_p)):
                for h, v in self._vida_ferida(conta_id, hs, agora_ms).items():
                    vidas[d + ':' + h] = v
            self._vida_recusa_zero(vidas)
            carry = {k: v['hp'] for k, v in vidas.items()} or None
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
            # 19/09: a versão das regras com que a sala abriu (o juiz confere ao fechar; sob outra, a sala vence)
            if _inteiro_puro(regras.get('regras')):
                self.con.execute("INSERT OR REPLACE INTO salas_grupo_regras(gid, regras, versao) VALUES (?, ?, ?)",
                                 (gid, regras['regras'], regras.get('versao') if isinstance(regras.get('versao'), str) else None))
            if afixo:       # 07/10: o afixo com que a sala abriu (o juiz refaz com ele; a ata o leva aos dois)
                self.con.execute("INSERT OR REPLACE INTO salas_grupo_afixo(gid, afixo) VALUES (?, ?)", (gid, afixo))
            # 15/09: a luta aberta de CADA conta, com os heróis dela (a largada zera só os de quem largou)
            for conta_id, hs in ((cid, herois), (pid, herois_p)):
                self.con.execute("INSERT OR REPLACE INTO luta_aberta(tipo, ref, conta_id, herois, aberta_ms, estado) "
                                 "VALUES ('grupo', ?, ?, ?, ?, 'aberta')", (gid, conta_id, json.dumps(hs), agora_ms))
        return 200, {'ok': True, 'gid': gid, 'semente': semente, 'carry': carry, 'afixo': afixo}

    # -- POST /api/grupo/fechar ------------------------------------------------------------------
    def _regras_da_luta(self, tabela, coluna, ref):
        """Dentro da tranca (19/09): o número das regras guardado na abertura da luta, ou 1 — a linha ausente é a
        luta aberta antes de existir o número (a versão implícita do engine.js), e o juiz a vence em vez de a
        recusar como fraude (o mesmo que salas.py faz com o bilhete)."""
        r = self.con.execute("SELECT regras FROM %s WHERE %s = ?" % (tabela, coluna), (ref,)).fetchone()
        return r['regras'] if r is not None and _inteiro_puro(r['regras']) else 1

    def _grupo_vence_por_regras(self, gid, t, erro):
        """19/09: o deploy trocou uma regra no meio da sala em grupo — a sala VENCE para os dois (não é fraude: o
        juiz novo refaria a sala de antes com outro fim), a trilha diz o porquê, e cada um abre de novo."""
        self._regras_esquece()                                  # o juiz é outro: o /regras guardado pode ser velho
        self._grupo_marca(gid, 'vencida', 'regras-mudaram', t, 'grupo-vencida')
        log.info("sala em grupo vencida por regras novas: %s — %.200s", gid, erro)
        raise Recusa(410, 'as regras do jogo mudaram no meio da sala — abram a sala de novo', motivo='regras-mudaram')

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
        if corpo.get('largou') is True:
            return self._grupo_largou(conta, corpo, gid, lances)        # 15/09: só a parte de quem saiu
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
                    regras_ata = self._regras_da_luta('salas_grupo_regras', 'gid', gid)   # 19/09
                    afixo_ata = self._afixo_guardado('salas_grupo_afixo', 'gid', gid)     # 07/10
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
                        'semente': g['semente'], 'carry': _objeto(g['carry']),
                        'regras': regras_ata,                   # 19/09: o juiz confere contra a versão dele
                        'afixo': afixo_ata},                    # 07/10: a sala se refaz com o afixo com que abriu
                'lances': lances, 'hashFinal': hash_final,
                'contexto': {'agoraMs': int(instante * 1000), 'fatores': fatores}}
            try:
                saida = self.juiz.pede('POST', '/grupo/fecha', pedido)
            except Recusa as e:
                if e.status == 422 and e.extra.get('motivo') == 'regras-mudaram':
                    self._grupo_vence_por_regras(gid, t, e.erro)            # 19/09: vence, não é fraude (410)
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
                # derrota: nada muda nos estados da economia (13/09: a poção saiu da batalha, e com ela o
                # desconto). 14/09, a vida única: a vida do fim de cada herói fica, na conta dele
                with self._escrita():
                    n = self.con.execute("UPDATE salas_grupo SET estado = 'perdida', motivo = NULL, fechada_em = ? "
                                         "WHERE gid = ? AND estado = 'aberta'", (t, gid)).rowcount
                    if n:
                        self._grupo_vida_grava(json.loads(g['party']), saida.get('carry'), saida.get('vidaMax'), gid)
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
                        soma_meta(self.con, m['conta']['id'], t)      # 07/10: a meta da semana da guilda de cada um
                        self.con.execute("INSERT INTO salas_grupo_pago(gid, conta_id, recompensa) VALUES (?, ?, ?)",
                                         (gid, m['conta']['id'], json.dumps(s.get('recompensa'), ensure_ascii=False)))
                        self._evento(m['conta']['id'], 'grupo-paga', {
                            'gid': gid, 'dungeon': g['dungeon'], 'sala': g['sala'], 'versao': nova, 'turnos': turnos,
                            'novos': [n['iid'] for n in s['iids']['novos']], 'guildaXp': s['guildaXp'],
                            'por': cid})
                    self.con.execute("UPDATE salas_grupo SET estado = 'paga', fechada_em = ?, carry_saida = ? WHERE gid = ?",
                                     (t, json.dumps(carry) if carry is not None else None, gid))
                    # a espera começa agora; cada herói na linha da conta dele (14/09, a vida única)
                    self._grupo_vida_grava(json.loads(g['party']), carry, saida.get('vidaMax'), gid)
            except EstadoMudou:
                continue
            log.info("sala em grupo paga: %s (#%d e #%d)", gid, g['lider_id'], g['membro_id'])
            return self._grupo_fechada(cid, gid)
        raise Recusa(409, 'o estado de uma das contas mudou no meio — tente de novo')

    def _grupo_largou(self, conta, corpo, gid, lances):
        """15/09, A SALA EM GRUPO LARGADA PELO REGISTRO: quem saiu da sala em grupo sem terminar (fechou a aba,
        recarregou, abandonou) fecha só a PARTE DELE, com o registro que o jogo guardou — o parceiro segue na sala e
        ainda fecha a dele. O juiz refaz os lances até ali; a vida dos heróis DESTA conta grava no ponto em que o
        replay parou e a conta fica 'registro' em luta_aberta (o fechamento do parceiro não a regrava, e a abertura
        seguinte não a larga). A sala não muda de estado nem paga ninguém. O registro que chega a um fim de verdade
        (a vitória cujo recibo a página não viu) é o fechamento de sempre."""
        cid = conta['id']
        with self.tranca:
            g = self.con.execute("SELECT * FROM salas_grupo WHERE gid = ?", (gid,)).fetchone()
            if g is None or cid not in (g['lider_id'], g['membro_id']):
                raise Recusa(404, 'sala em grupo não encontrada')
            if g['estado'] != 'aberta':
                acao = 'fechada'
            else:
                saiu = self.con.execute("SELECT estado FROM luta_aberta WHERE tipo = 'grupo' AND ref = ? AND conta_id = ?",
                                        (gid, cid)).fetchone()
                acao = 'ja' if saiu is not None and saiu['estado'] in ('registro', 'largada') else 'juiz'
            if acao == 'juiz':
                party = json.loads(g['party'])
                membros = []
                for p in party:
                    linha = self.con.execute("SELECT * FROM contas WHERE id = ?", (p['conta'],)).fetchone()
                    if linha is None:
                        raise Recusa(409, 'uma das contas do grupo não existe mais')
                    membros.append({'conta': {'id': linha['id'], 'gm': bool(linha['gm'])}, 'dono': p['dono'],
                                    'herois': p['herois'], 'progress': self._estado_exige(p['conta'])['progress'],
                                    'db': self._estado_exige(p['conta'])['db'],
                                    'guilda': self._guilda_contexto(p['conta'], agora())})
        if acao == 'fechada':
            return self._grupo_fechada(cid, gid)
        if acao == 'ja':
            return 200, {'ok': True, 'fase': 'largou', 'recompensa': None}
        with self.tranca:
            regras_ata = self._regras_da_luta('salas_grupo_regras', 'gid', gid)   # 19/09
            afixo_ata = self._afixo_guardado('salas_grupo_afixo', 'gid', gid)     # 07/10
        pedido = {'membros': membros,
                  'ata': {'dungeonId': g['dungeon'], 'roomIndex': g['sala'], 'dificuldade': g['dificuldade'],
                          'semente': g['semente'], 'carry': _objeto(g['carry']),
                          'regras': regras_ata,                 # 19/09: o juiz confere contra a versão dele
                          'afixo': afixo_ata},                  # 07/10: a sala se refaz com o afixo com que abriu
                  'lances': lances, 'hashFinal': None,
                  'contexto': {'agoraMs': int(time.time() * 1000), 'fatores': {}}}
        try:
            saida = self.juiz.pede('POST', '/grupo/fecha', pedido)     # 422: nada gravado (a largada ainda vale depois)
        except Recusa as e:
            if e.status == 422 and e.extra.get('motivo') == 'regras-mudaram':
                self._grupo_vence_por_regras(gid, agora(), e.erro)     # 19/09: a sala de antes do deploy vence (410)
            raise
        if not isinstance(saida, dict) or saida.get('ok') is not True or not isinstance(saida.get('fase'), str):
            raise Recusa(503, 'o juiz respondeu torto — tente de novo em instantes')
        if saida['fase'] in ('won', 'lost'):
            return self.grupo_fechar(conta, dict(corpo, largou=False, hashFinal=None))
        with self._escrita():
            agora_g = self.con.execute("SELECT estado FROM salas_grupo WHERE gid = ?", (gid,)).fetchone()
            if agora_g is None or agora_g['estado'] != 'aberta':
                acao = 'fechada'
            else:
                self._grupo_vida_grava(json.loads(g['party']), saida.get('carry'), saida.get('vidaMax'), gid, so_conta=cid)
                herois = next((p['herois'] for p in json.loads(g['party']) if p.get('conta') == cid), [])
                n = self.con.execute("UPDATE luta_aberta SET estado = 'registro' WHERE tipo = 'grupo' AND ref = ? "
                                     "AND conta_id = ? AND estado = 'aberta'", (gid, cid)).rowcount
                if not n:
                    self.con.execute("INSERT OR IGNORE INTO luta_aberta(tipo, ref, conta_id, herois, aberta_ms, estado) "
                                     "VALUES ('grupo', ?, ?, ?, ?, 'registro')",
                                     (gid, cid, json.dumps(herois), int(time.time() * 1000)))
                self._evento(cid, 'grupo-largou', {'gid': gid, 'turnos': max(0, inteiro(saida.get('turnosJogador')))})
        if acao == 'fechada':
            return self._grupo_fechada(cid, gid)
        return 200, {'ok': True, 'fase': 'largou', 'recompensa': None}

    # -- POST /api/duelo/abrir (14/09, a vida única) ----------------------------------------------------
    def duelo_abrir(self, conta, corpo):
        # 15/09: a luta que a conta deixou aberta no servidor fica largada antes (salas.py, _com_largada)
        return self._com_largada(conta, lambda: self._duelo_abrir(conta, corpo))

    def _duelo_abrir(self, conta, corpo):
        """Corpo {did, herois: [1 ou 2 ids]}. Cada lado chama antes da arena (o dono: "se o jogador estiver com
        a vida na metade e começar uma batalha sendo pvp… a vida vai começar onde estava"): o servidor guarda
        a vida de agora dos heróis em duelo_vida e o fechamento refaz o duelo com ELA — o cliente não escolhe
        com quanto entra. Idempotente pelo (did, conta): a segunda chamada devolve o guardado. Herói a 0 PV:
        409 vida-zero. Teto de DUELO_ABERTURAS_POR_HORA aberturas novas por conta (429)."""
        cid = conta['id']
        did = corpo.get('did')
        if not isinstance(did, str) or not RE_DID.match(did):
            raise Recusa(400, 'did inválido')
        herois = _herois(corpo.get('herois'), 'herois')
        if not self._autoridade_ligada():
            raise Recusa(503, 'o juiz do servidor não está configurado')
        regras = self._regras()                                   # 19/09: a versão das regras do juiz (sem juiz: 503)
        # 19/09 (a 2ª rodada de conserto): a versão das regras desta página contra a do juiz — a página de antes do
        # deploy não abre o duelo para os dois lados caírem como fraude no fim (salas.py, _confere_versao_cliente)
        regras = self._confere_versao_cliente(corpo, regras)
        t = agora()
        chave = 'duelo-abrir:%d' % cid
        with self._escrita():
            r = self.con.execute("SELECT carry FROM duelo_vida WHERE did = ? AND conta_id = ?", (did, cid)).fetchone()
            if r is not None:
                return 200, {'ok': True, 'carry': _objeto(r['carry'])}
            estado = self._estado_exige(cid)
            self._confere_herois(conta, estado['progress'], herois)
            em = [x[0] for x in self.con.execute("SELECT em FROM limites WHERE chave = ? AND em > ? ORDER BY em",
                                                 (chave, t - 3600))]
            if len(em) >= DUELO_ABERTURAS_POR_HORA:
                raise Recusa(429, 'duelos demais na última hora (máximo %d)' % DUELO_ABERTURAS_POR_HORA,
                             liberaEm=em[len(em) - DUELO_ABERTURAS_POR_HORA] + 3600)
            vidas = self._vida_ferida(cid, herois, int(time.time() * 1000))
            self._vida_recusa_zero(vidas)
            carry = {h: v['hp'] for h, v in vidas.items()} or None
            self.con.execute("INSERT INTO limites(chave, em) VALUES (?, ?)", (chave, t))
            self.con.execute("DELETE FROM limites WHERE chave = ? AND em < ?", (chave, t - 3600))
            self.con.execute("INSERT INTO duelo_vida(did, conta_id, herois, carry, criado_em) VALUES (?, ?, ?, ?, ?)",
                             (did, cid, json.dumps(herois), json.dumps(carry) if carry is not None else None, t))
            # 19/09: a versão das regras com que o duelo abriu — a do PRIMEIRO lado a abrir (o juiz confere ao fechar)
            if _inteiro_puro(regras.get('regras')):
                self.con.execute("INSERT OR IGNORE INTO duelos_regras(did, regras, versao) VALUES (?, ?, ?)",
                                 (did, regras['regras'], regras.get('versao') if isinstance(regras.get('versao'), str) else None))
        return 200, {'ok': True, 'carry': carry}

    def _duelo_regras(self, did):
        """Dentro da tranca (19/09): o número das regras da abertura do duelo (duelos_regras); 1 quando a abertura
        (duelo_vida) existe sem número — o duelo aberto antes de existir o número —; None sem abertura nenhuma (a
        página de antes do duelo/abrir, as provas que só fecham): aí não há o que conferir."""
        r = self.con.execute("SELECT regras FROM duelos_regras WHERE did = ?", (did,)).fetchone()
        if r is not None and _inteiro_puro(r['regras']):
            return r['regras']
        return 1 if self.con.execute("SELECT 1 FROM duelo_vida WHERE did = ?", (did,)).fetchone() else None

    def _duelo_vida_guardada(self, did, lado):
        """Dentro da tranca: {heroId: PV} que o lado guardou no duelo/abrir, só dos heróis dele. Sem linha (a
        página de antes, ou todos cheios) = None = o lado entra cheio."""
        r = self.con.execute("SELECT carry FROM duelo_vida WHERE did = ? AND conta_id = ?",
                             (did, lado['conta'])).fetchone()
        carry = _objeto(r['carry']) if r is not None else None
        if not carry:
            return None
        return {h: carry[h] for h in lado['herois'] if _inteiro_puro(carry.get(h))} or None

    # -- POST /api/duelo/fechar ---------------------------------------------------------------------
    def _duelo_resposta(self, cid, linha_ou_resultado):
        res = linha_ou_resultado
        pub = self._estado_publico(cid)
        delta = (res.get('delta') or {}).get(str(cid), 0)
        resposta = {'ok': True, 'fase': res.get('fase'), 'venc': res.get('venc'), 'ranqueado': bool(res.get('ranqueado')),
                    'delta': delta}
        if res.get('motivo'):
            resposta['motivo'] = res['motivo']
        if res.get('modo'):
            resposta['modo'] = res['modo']
        if res.get('fim'):
            resposta['fim'] = res['fim']            # 15/09: desistencia | wo | wo-sem-prova | sem-confirmacao
        resposta.update(pub)
        # 14/09, a vida única: a vida de AGORA dos heróis de quem pede ({heroId: PV}; sem linha = cheio, fora)
        herois = (res.get('herois') or {}).get(str(cid)) if isinstance(res.get('herois'), dict) else None
        vida = {}
        if isinstance(herois, list):
            with self.tranca:
                vida = {h: v['hp'] for h, v in self._vida_de(cid, herois, int(time.time() * 1000)).items()}
        resposta['vida'] = vida
        return 200, resposta

    def _duelo_guardado(self, cid, did):
        with self.tranca:
            r = self.con.execute("SELECT * FROM duelos WHERE did = ?", (did,)).fetchone()
        if r is None:
            return None
        if cid not in (r['a_id'], r['b_id']):
            raise Recusa(404, 'duelo não encontrado')
        return self._duelo_resposta(cid, _objeto(r['resultado']) or {'fase': r['fase'], 'venc': r['venc']})

    def _duelo_guarda(self, did, a_id, b_id, resultado, t, herois=None):
        """Dentro de _escrita: a linha do duelo (falha de chave = o outro lado guardou antes). `herois` =
        {conta: [heroId]} vai junto no resultado (14/09: a resposta devolve a vida deles)."""
        if herois:
            resultado = dict(resultado, herois=herois)
        # 14/09: a coluna `venc` é o que os TETOS contam — só o ranqueado a preenche. O amistoso (o desafio da praça, o
        # campo sem paridade) guarda o vencedor no resultado, e não gasta a cota de ninguém
        self.con.execute("INSERT INTO duelos(did, a_id, b_id, fase, venc, criado_em, resultado) VALUES (?, ?, ?, ?, ?, ?, ?)",
                         (did, a_id, b_id, resultado['fase'], resultado.get('venc') if resultado.get('ranqueado') else None,
                          t, json.dumps(resultado, ensure_ascii=False)))

    def _duelo_amistoso(self, did, modo, dungeon, lados):
        """Dentro da tranca (14/09): o motivo de o duelo valer como AMISTOSO antes de olhar os estados, ou None.
        'modo' (sem modo: a página de antes), 'amistoso' (o desafio da praça), 'mapa' (arena ou campo no mapa do
        desafio), 'sem-partida' (a arena sem a partida pronta desse did entre essas duas contas) e 'dupla' (os
        heróis que lutaram não são os que o quadro da Arena mostrou)."""
        if modo is None:
            return 'modo'
        if modo == 'desafio':
            return 'amistoso'
        if dungeon == MAPA_DESAFIO:
            return 'mapa'
        if modo == 'arena':
            achar = getattr(self, '_arena_partida', None)
            partida = achar(did, lados['A']['conta'], lados['B']['conta']) if achar is not None else None
            if partida is None:
                return 'sem-partida'
            if any(sorted(partida.get(lados[k]['conta']) or []) != sorted(lados[k]['herois']) for k in lados):
                return 'dupla'
        return None

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

    def _duelo_guarda_teto(self, did, a_id, b_id, t, herois):
        """Dentro de _escrita: o duelo acima dos tetos vale como amistoso, e isso fica guardado."""
        self._duelo_guarda(did, a_id, b_id, dict(TETO), t, herois)
        for quem in (a_id, b_id):
            self._evento(quem, 'duelo-teto', {'did': did, 'a': a_id, 'b': b_id})

    # -- 15/09: o duelo que espera (a desistência declarada, a prova de queda do W.O.) --------------------------------
    def _duelo_aguarda(self, cid, ate_ms, agora_ms, herois_de, motivo):
        """A resposta de quem fechou e ESPERA: {fase: 'aguardando', motivo: 'desistencia' | 'wo', esperaAte (ms do
        servidor), esperaMs (quanto falta)} — o cliente pergunta de novo depois disso (js/core/autoridade.js)."""
        status, r = self._duelo_resposta(cid, {'fase': 'aguardando', 'venc': None, 'ranqueado': False, 'motivo': motivo,
                                               'herois': herois_de})
        r['esperaAte'] = int(ate_ms)
        r['esperaMs'] = max(0, int(ate_ms) - int(agora_ms))
        return status, r

    def _duelo_prova_wo(self, did, ausente, agora_ms):
        """Dentro da tranca: o veredito da queda da conta ausente desde que o duelo abriu (servidor/presenca.py:
        'provada' | 'cedo' | 'sem' | 'nada', e o ms). Sem a abertura guardada (a página de antes do duelo/abrir) não há
        de quando contar: 'sem'."""
        r = self.con.execute("SELECT MIN(criado_em) FROM duelo_vida WHERE did = ?", (did,)).fetchone()
        if r is None or r[0] is None:
            return 'sem', None
        return presenca.prova_de_queda(self.con, ausente, int(r[0]) * 1000, agora_ms)

    def _duelo_encerra_espera(self, did, a_id, b_id, espera, t, herois_de):
        """Dentro de _escrita: a espera do replay sem fim acabou sem a declaração do desistente. O duelo fica como o
        replay parou (a vida dos dois já foi gravada no primeiro fechamento), sem vencedor e sem coroa."""
        resultado = _objeto(espera.get('resultado')) or {'fase': 'playing'}
        resultado.update(venc=None, ranqueado=False, motivo='sem-confirmacao', fim='sem-confirmacao')
        resultado.pop('delta', None)
        self.con.execute("DELETE FROM duelo_espera WHERE did = ?", (did,))
        self._duelo_guarda(did, a_id, b_id, resultado, t, herois_de)

    def duelo_fechar(self, conta, corpo):
        """Corpo {did, modo, dungeonId, roomIndex, semente, A:{conta, dono, herois}, B:{…}, lances, hashFinal,
        fotografada, desistiu?, lado?, wo?}. Ranqueado = o juiz viu um fim (venc não nulo) E o modo deixa (14/09:
        _duelo_amistoso e a PARIDADE); só esse conta nos tetos. O amistoso também vai ao juiz: a vida grava, a Brasa
        não muda. 14/09, a vida única: o juiz refaz com a vida que cada lado guardou no duelo/abrir e devolve a vida
        do fim. Fotografado não refaz e não grava; o replay que diverge (422) também não.

        15/09, AS FALHAS CONHECIDAS (o dono: "arrume as falhas conhecidas" — desistir ou sumir do duelo não custava
        nada: nem a vida da luta, nem a coroa). Três fechamentos novos, e o replay segue sendo o juiz dos lances:
          desistiu: true   a DECLARAÇÃO do desistente, e só vale da conta dele (o lado sai da conta que pede; um
                           `lado` que não é o dela = 403). O juiz refaz os lances até ali (confere o hashFinal, o
                           do estado antes do encerra) com `perdeu` = esse lado: TODOS os heróis dele a 0 e, onde o
                           modo ranqueia, a derrota na Brasa (o Elo de sempre). O desafio amistoso: a vida, sem coroa.
          wo: true         o cliente que ficou declara o W.O. — e não se acredita nele: o relé prova a queda
                           (servidor/presenca.py). 'caiu' da conta ausente depois de o duelo abrir e nenhum 'voltou'
                           em 60 s = W.O. CONFIRMADO (perdeu = a ausente, como a desistência). Queda anotada há menos
                           de 60 s, ou nenhuma ainda (o relé vê a conexão morta com atraso) = 'aguardando'. Sem prova
                           = a vida do replay dos dois, sem coroa, motivo 'wo-sem-prova'.
          sem declaração   um replay SEM fim (quem recebeu a desistência pela Rede) grava a vida do replay dos dois
                           e fica 'aguardando' DUELO_ESPERA_MS pela declaração do desistente: se ela chega, só o lado
                           dele é regravado (a 0) e a coroa muda; se não, fica a vida do replay, sem coroa
                           ('sem-confirmacao'). Quem recebe a desistência nunca zera ninguém."""
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
        # 14/09: desafio | arena | campo (ver MODOS_DUELO); o resto é 400, e sem modo o duelo é amistoso
        modo = corpo.get('modo')
        if modo is not None and modo not in MODOS_DUELO:
            raise Recusa(400, 'modo precisa ser desafio, arena ou campo')
        # 15/09: a desistência é a declaração de quem desiste; o W.O., a de quem ficou
        desistiu, wo = corpo.get('desistiu') is True, corpo.get('wo') is True
        if desistiu and wo:
            raise Recusa(400, 'desistiu e wo não andam juntos')
        meu = 'A' if cid == a_id else 'B'
        outro = 'B' if meu == 'A' else 'A'
        if desistiu and corpo.get('lado') is not None and corpo.get('lado') != meu:
            raise Recusa(403, 'a desistência só vale da conta de quem desiste', motivo='desistencia-alheia')
        fotografada = corpo.get('fotografada') is True
        herois_de = {str(lados[k]['conta']): lados[k]['herois'] for k in lados}
        for _ in range(TENTATIVAS):
            t = agora()
            agora_ms = int(time.time() * 1000)
            teto = amistoso = perdeu = fim = espera = espera_ate = motivo_espera = None
            acao = None
            with self._escrita():
                if self.con.execute("SELECT 1 FROM duelos WHERE did = ?", (did,)).fetchone():
                    acao = 'guardado'
                else:
                    contas = {k: self._conta_viva(lados[k]['conta']) for k in lados}
                    if any(c is None for c in contas.values()):
                        raise Recusa(404, 'conta do duelo não encontrada')
                    linha = self.con.execute("SELECT * FROM duelo_espera WHERE did = ?", (did,)).fetchone()
                    espera = dict(linha) if linha is not None else None
                    sem_fim = espera is not None and espera['motivo'] == 'sem-fim'
                    if fotografada:
                        # sincronizado por foto: o registro não refaz o duelo; vale como amistoso (e a vida não muda)
                        self._duelo_guarda(did, a_id, b_id, {'fase': 'nao-conferido', 'venc': None, 'ranqueado': False,
                                                             'motivo': 'fotografada', 'modo': modo}, t, herois_de)
                        self.con.execute("DELETE FROM duelo_espera WHERE did = ?", (did,))
                        acao = 'guardado'
                    elif sem_fim and agora_ms >= espera['primeiro_ms'] + DUELO_ESPERA_MS:
                        self._duelo_encerra_espera(did, a_id, b_id, espera, t, herois_de)   # a declaração não veio
                        acao = 'guardado'
                    elif sem_fim and not desistiu and not wo:
                        acao, espera_ate, motivo_espera = 'aguarda', espera['primeiro_ms'] + DUELO_ESPERA_MS, 'desistencia'
                    else:
                        if desistiu:
                            perdeu, fim = meu, 'desistencia'
                        elif wo:
                            prova, quando = self._duelo_prova_wo(did, lados[outro]['conta'], agora_ms)
                            primeiro = espera['primeiro_ms'] if espera is not None else agora_ms
                            if prova == 'provada':
                                perdeu, fim = outro, 'wo'
                            elif prova == 'cedo' or (prova == 'nada' and agora_ms < primeiro + WO_ESPERA_MS):
                                if espera is None:
                                    self.con.execute("INSERT INTO duelo_espera(did, conta_id, motivo, primeiro_ms) "
                                                     "VALUES (?, ?, 'wo', ?)", (did, cid, agora_ms))
                                acao, motivo_espera = 'aguarda', 'wo'
                                espera_ate = quando if prova == 'cedo' else primeiro + WO_ESPERA_MS
                            else:
                                fim = 'wo-sem-prova'
                        if acao is None:
                            # 14/09: o amistoso (desafio, mapa trocado, arena sem partida) nem olha os tetos
                            amistoso = self._duelo_amistoso(did, modo, dungeon, lados)
                            teto = None if amistoso else self._duelo_teto(a_id, b_id, t)
                            estados = {k: self._estado_ler(lados[k]['conta']) for k in lados}
                            faltando = [k for k in lados if estados[k] is None]
                            if faltando and teto:
                                # sem o estado de um lado o juiz não refaz: o teto vale como antes, sem a vida
                                self._duelo_guarda_teto(did, a_id, b_id, t, herois_de)
                                acao = 'guardado'
                            elif faltando:
                                raise Recusa(409, SEM_ESTADO if lados[faltando[0]]['conta'] == cid
                                             else 'a outra conta ainda não tem o estado no servidor')
                            else:
                                # 14/09, a PARIDADE: o herói mais forte de cada lado, nos estados do servidor
                                if not amistoso and modo in PARIDADE:
                                    niveis = [_nivel_forte(estados[k]['progress'], lados[k]['herois']) for k in ('A', 'B')]
                                    if abs(niveis[0] - niveis[1]) > PARIDADE[modo]:
                                        amistoso, teto = 'paridade', None
                                vidas = {k: self._duelo_vida_guardada(did, lados[k]) for k in lados}
                                regras_duelo = self._duelo_regras(did)          # 19/09
                                acao = 'juiz'
            if acao == 'guardado':
                return self._duelo_guardado(cid, did)
            if acao == 'aguarda':
                return self._duelo_aguarda(cid, espera_ate, agora_ms, herois_de, motivo_espera)
            pedido = {k: {'conta': {'id': lados[k]['conta'], 'gm': bool(contas[k]['gm'])}, 'dono': lados[k]['dono'],
                          'herois': lados[k]['herois'], 'progress': estados[k]['progress'], 'db': estados[k]['db'],
                          'vida': vidas[k]}
                      for k in lados}
            pedido.update(dungeonId=dungeon, roomIndex=sala, semente=semente, lances=lances, hashFinal=hash_final,
                          contexto={'agoraMs': int(time.time() * 1000)},
                          regras=regras_duelo)              # 19/09: o juiz confere contra a versão dele (None: não confere)
            if perdeu:
                pedido['perdeu'] = perdeu                   # 15/09: quem desistiu, ou quem sumiu com a queda provada
            try:
                saida = self.juiz.pede('POST', '/duelo/fecha', pedido)
            except Recusa as e:
                if e.status == 422 and e.extra.get('motivo') == 'regras-mudaram':
                    # 19/09: o deploy trocou uma regra no meio do duelo — ele VENCE (não é fraude): sem vida gravada,
                    # sem coroa, e a trilha dos dois diz o porquê. Os dois lados leem o mesmo guardado (fase 'vencido')
                    self._regras_esquece()                  # o juiz é outro: o /regras guardado pode ser velho
                    with self._escrita():
                        if not self.con.execute("SELECT 1 FROM duelos WHERE did = ?", (did,)).fetchone():
                            self.con.execute("DELETE FROM duelo_espera WHERE did = ?", (did,))
                            self._duelo_guarda(did, a_id, b_id, {'fase': 'vencido', 'venc': None, 'ranqueado': False,
                                                                 'motivo': 'regras-mudaram', 'modo': modo}, t, herois_de)
                            for quem in (a_id, b_id):
                                self._evento(quem, 'duelo-vencido', {'did': did, 'motivo': 'regras-mudaram', 'erro': e.erro})
                    log.info("duelo vencido por regras novas: %s — %.200s", did, e.erro)
                    return self._duelo_guardado(cid, did)
                if e.status == 422:
                    with self._escrita():
                        if not self.con.execute("SELECT 1 FROM duelos WHERE did = ?", (did,)).fetchone():
                            self.con.execute("DELETE FROM duelo_espera WHERE did = ?", (did,))
                            if teto:
                                # acima do teto o duelo já não ranqueava: segue 'teto', como antes de o teto chamar
                                # o juiz (a vida não é gravada: o replay divergiu)
                                self._duelo_guarda_teto(did, a_id, b_id, t, herois_de)
                            else:
                                self._duelo_guarda(did, a_id, b_id, {'fase': 'recusado', 'venc': None, 'ranqueado': False,
                                                                     'motivo': e.extra.get('motivo') or 'juiz'}, t, herois_de)
                                for quem in (a_id, b_id):
                                    self._evento(quem, 'duelo-recusado', {'did': did, 'motivo': e.extra.get('motivo'),
                                                                          'erro': e.erro})
                    if teto:
                        return self._duelo_guardado(cid, did)
                raise
            if not isinstance(saida, dict) or saida.get('ok') is not True or not isinstance(saida.get('fase'), str):
                raise Recusa(503, 'o juiz respondeu torto — tente de novo em instantes')
            venc = saida.get('venc') if saida.get('venc') in ('A', 'B', 'empate') else None
            if perdeu and not saida.get('forcado'):
                perdeu = None                               # o replay acabou de verdade: vale o fim dele
                if venc is not None:
                    fim = None
            ranqueado = bool(saida.get('ranqueado')) and venc is not None and not teto and not amistoso
            fins, lado_saida = {}, {}
            for k in lados:
                s = saida.get(k)
                if ranqueado and not isinstance(s, dict):
                    raise Recusa(503, 'o juiz respondeu torto — tente de novo em instantes')
                s = s if isinstance(s, dict) else {}
                fins[k] = (s.get('vidaFim') if isinstance(s.get('vidaFim'), dict) else {}, s.get('vidaMax'))
                if ranqueado:
                    lado_saida[k] = self._confere_saida({'ok': True, 'progress': s.get('progress'), 'db': s.get('db'),
                                                         'hash': s.get('hash'), 'iids': {'novos': [], 'fora': []},
                                                         'guildaXp': 0})
            if venc is None and fim is None:
                # 15/09: o replay parou SEM fim e ninguém declarou nada — o outro lado desistiu (a declaração dele vem
                # aí) ou sumiu: a vida do replay dos dois grava AGORA e o duelo espera DUELO_ESPERA_MS
                em_espera = {'fase': saida['fase'], 'venc': None, 'ranqueado': False, 'modo': modo}
                try:
                    with self._escrita():
                        if self.con.execute("SELECT 1 FROM duelos WHERE did = ?", (did,)).fetchone():
                            raise EstadoMudou()
                        linha = self.con.execute("SELECT * FROM duelo_espera WHERE did = ?", (did,)).fetchone()
                        if linha is None:
                            primeiro, grava = agora_ms, True
                            self.con.execute("INSERT INTO duelo_espera(did, conta_id, motivo, primeiro_ms, resultado) "
                                             "VALUES (?, ?, 'sem-fim', ?, ?)",
                                             (did, cid, agora_ms, json.dumps(em_espera, ensure_ascii=False)))
                        else:
                            primeiro, grava = linha['primeiro_ms'], linha['motivo'] != 'sem-fim'
                            if grava:                        # o W.O. que esperava a prova: agora é a desistência que espera
                                self.con.execute("UPDATE duelo_espera SET motivo = 'sem-fim', resultado = ? WHERE did = ?",
                                                 (json.dumps(em_espera, ensure_ascii=False), did))
                        if grava:
                            for k in lados:
                                vida_fim, maximos = fins[k]
                                self._vida_grava_fim(lados[k]['conta'],
                                                     {h: vida_fim[h] for h in lados[k]['herois'] if h in vida_fim},
                                                     maximos, agora_ms)
                except EstadoMudou:
                    continue
                return self._duelo_aguarda(cid, primeiro + DUELO_ESPERA_MS, agora_ms, herois_de, 'desistencia')
            if teto:
                resultado = dict(TETO)
            elif amistoso:
                # 14/09: refeito pelo juiz (a vida grava), mas a Brasa não muda — e o porquê fica guardado
                resultado = {'fase': saida['fase'], 'venc': venc, 'ranqueado': False, 'motivo': amistoso}
            elif fim == 'wo-sem-prova':
                resultado = {'fase': saida['fase'], 'venc': None, 'ranqueado': False, 'motivo': 'wo-sem-prova'}
            else:
                resultado = {'fase': saida['fase'], 'venc': venc, 'ranqueado': ranqueado, 'delta': {}}
                for k in lados:
                    if ranqueado:
                        resultado['delta'][str(lados[k]['conta'])] = inteiro((saida.get(k) or {}).get('delta'))
            resultado['modo'] = modo
            if fim:
                resultado['fim'] = fim
            try:
                with self._escrita():
                    if self.con.execute("SELECT 1 FROM duelos WHERE did = ?", (did,)).fetchone():
                        raise EstadoMudou()                 # o outro lado fechou junto: a volta seguinte lê o guardado
                    if ranqueado and self._duelo_teto(a_id, b_id, t):
                        resultado = dict(TETO, modo=modo, **({'fim': fim} if fim else {}))
                    elif ranqueado:
                        if modo == 'arena' and getattr(self, '_arena_jogada', None):
                            self._arena_jogada(did)          # 14/09: a partida da fila foi jogada
                        for k in lados:
                            nova, _ = self._estado_grava(contas[k], estados[k], lado_saida[k], t)
                            self._evento(lados[k]['conta'], 'duelo-ranqueado', {
                                'did': did, 'venc': venc, 'lado': k, 'versao': nova,
                                'delta': resultado['delta'][str(lados[k]['conta'])],
                                'contra': lados['B' if k == 'A' else 'A']['conta'], 'fim': fim})
                    if teto:
                        for quem in (a_id, b_id):
                            self._evento(quem, 'duelo-teto', {'did': did, 'a': a_id, 'b': b_id})
                    # 14/09, a vida única: os dois lados saem com a vida do fim do replay, cada um na linha da própria
                    # conta. 15/09: quem desistiu (ou sumiu com a queda provada) sai a 0 — o juiz já zerou o lado dele;
                    # se o lado que recebeu a desistência fechou antes (a espera 'sem-fim'), a vida dos dois já está
                    # gravada e só o lado de quem perdeu assim é regravado
                    ja_gravada = self.con.execute("SELECT 1 FROM duelo_espera WHERE did = ? AND motivo = 'sem-fim'",
                                                  (did,)).fetchone() is not None
                    agora_ms = int(time.time() * 1000)
                    for k in lados:
                        if ja_gravada and k != perdeu:
                            continue
                        vida_fim, maximos = fins[k]
                        self._vida_grava_fim(lados[k]['conta'], {h: vida_fim[h] for h in lados[k]['herois'] if h in vida_fim},
                                             maximos, agora_ms)
                    if fim in ('desistencia', 'wo'):
                        self._evento(lados[perdeu]['conta'], 'duelo-' + fim, {'did': did, 'modo': modo,
                                                                             'ranqueado': resultado.get('ranqueado')})
                    self.con.execute("DELETE FROM duelo_espera WHERE did = ?", (did,))
                    self._duelo_guarda(did, a_id, b_id, resultado, t, herois_de)
            except EstadoMudou:
                continue
            # os heróis de cada conta vão junto, como no guardado: a resposta traz a vida de quem pede
            return self._duelo_resposta(cid, dict(resultado, herois=herois_de))
        raise Recusa(409, 'o estado de uma das contas mudou no meio — tente de novo')
