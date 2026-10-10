#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A guilda no servidor (11/09, pedido do dono: "Guilda no servidor").

Até aqui a guilda morava no navegador de cada máquina (js/core/guilda.js, a
chave 'soterra-guilda-v1' do localStorage): o convite entre duas máquinas
nunca tinha como funcionar — na máquina de quem era convidado a guilda nem
existia. Agora o registro mora aqui, e o jogo com sessão fala com estas rotas;
sem sessão (em casa, nas bancadas) o registro local segue como antes.

Entra no cartório como mixin (`class Api(..., GuildaMixin)` no api.py), com a
mesma conexão e a mesma tranca.

AS REGRAS (as mesmas do guilda.js, que tem a cópia dos números):
  fundar     o cliente cobra as insígnias depois do "sim" daqui; o nome é
             único (sem caixa) e a lei dos nomes vale (nomes.py), menos para
             o Mestre
  a porta    'aberta' (entrar direto) ou 'convite' (entra quem foi
             convidado; o resto pede, e líder ou oficial decide)
  o convite  líder e oficiais convidam a CONTA (a que o relé conferiu na
             praça, o `nuvem` da presença); o convidado entra mesmo com a
             porta fechada, por CONVITE_VALIDADE
  cargos     líder (guildas.lider_id), oficial e membro; o líder promove e
             rebaixa; líder e oficiais aceitam pedidos, convidam e gastam o
             cofre
  o dízimo   0 a DIZIMO_MAX % do XP de cada sala (o cliente desconta e doa)
  o cofre    as marcas nascem do treino (XP_TREINO de XP e MOEDA_TREINO
             marca, um treino pago a cada TREINO_INTERVALO por conta);
             CUSTO_BONUS marcas = 24 h de +15% de saque ou de XP para todos
             (comprar de novo estende)
  o banco    a peça depositada fica aqui; a série dela (se tiver) deixa de
             ser varrida pelo save do dono enquanto estiver guardada (o
             salvar do api.py pula o que está em guilda_banco). O dono
             retira de vez; os outros pegam EMPRESTADO, um por conta, e o
             jogo dá a eles uma cópia nova (origem 'banco'); devolver solta
             a vaga
  a volta    04/10 (dono: "caso o usuário exclua a conta ou fique mais de 3
             dias sem entrar, a peça volta automaticamente para o cofre da
             guilda"): a peça emprestada volta SOZINHA ao banco, livre e
             ainda do dono dela, quando quem pegou fica mais de
             EMPRESTIMO_AUSENCIA_DIAS sem entrar (contas_visto) ou exclui a
             conta (privacidade.py). A cópia sai do estado dele pelo juiz
             (op interna 'bancoGuildaRecolhe': do saco, do herói ou do cofre),
             mesmo com ele fora; guilda_avisos guarda o recado para a volta.
             Confere-se ao abrir o banco (GET /api/guilda/minha) e num passo
             de hora em hora (despacha, api.py) — nunca a cada pedido
  sair       com empréstimo ativo, não; com peça sua no banco, também não
             (retire antes); o último a sair dissolve; se o líder sai, o
             membro mais antigo herda
  desfazer   04/10 (dono: "exclua a guilda Game Over do jogo.. vou refazer para sair os
             bugs"): a EQUIPE desfaz uma guilda inteira (POST /api/mestre/guilda/desfazer,
             ou `admin desfazer-guilda` no Terminal). Os empréstimos são recolhidos de quem
             pegou; cada peça do banco vira uma DEVOLUÇÃO ao dono (guilda_devolucoes), que
             o juiz entrega no saco dele, ou no cofre do Acampamento com o saco cheio; sem
             o juiz é o jogo do dono que a põe no saco ao ler a devolução, e a série não é
             varrida enquanto espera. Membros, pedidos, convites, mural, dízimos,
             contribuições e a inscrição na guerra saem na MESMA transação; cada membro
             recebe uma carta da Equipe; o nome fica livre. Repetir não quebra
Os tempos vão ao cliente em milissegundos (o relógio dele); aqui, segundos.
A autoridade é a mesma do saque (o topo do api.py): o XP do dízimo o cliente
calcula; o teto por pedido segura erro, não trapaça. 04/10 (dono: "dinheiro não
dará mais XP para guild; somente % de XP doada de batalha OU guerra de guild"):
a oferenda em vinténs acabou — POST /api/guilda/doar só aceita o dízimo
(`origem: 'dizimo'`) e recusa o resto.
"""
import calendar
import json
import logging
import os
import re
import sqlite3

import nomes
from comum import NOME_PUBLICO_SQL, EstadoMudou, Recusa, agora, iid_valido, limita

log = logging.getLogger('api')

NOME_MAX = 24
EMBLEMA_MAX = 64
DIZIMO_MAX = 25                   # espelha JOGO.Guilda.DIZIMO_MAX
CUSTO_BONUS = 25                  # espelha JOGO.Guilda.CUSTO_BONUS
BONUS_S = 24 * 3600               # espelha JOGO.Guilda.BONUS_MS (em segundos)
XP_TREINO = 6                     # espelha JOGO.Guilda.XP_TREINO
# A META DA SEMANA (07/10; o dono: "quero um jogo que o jogador tenha motivo para voltar"). As salas que os
# membros vencem (solo ou em grupo) enchem uma barra da guilda, por semana de Brasília (segunda a domingo, a
# mesma semana do Eco). Cheia, a guilda ganha XP e o bônus de +15% de XP E de saque para todos até o fim da
# semana (o mesmo bonus_xp/bonus_drop que o cofre compra — estende o que houver). GUILDA_META_SALAS no
# ambiente troca o alvo (as provas o baixam)
def _meta_do_ambiente():
    v = os.environ.get('GUILDA_META_SALAS')
    try:
        n = int(v) if v is not None and v.strip() else 60
    except ValueError:
        n = 60
    return n if n >= 1 else 60
META_SALAS = _meta_do_ambiente()
XP_META = 150                     # o XP de guilda ao cumprir (a guerra dá 120)
# a semana de Brasília: espelha supremo.py (que importa salas.py, que importa este arquivo — por isso a cópia)
META_FUSO_S = -3 * 3600
META_SEMANA_S = 7 * 86400
META_EPOCA = calendar.timegm((2026, 1, 5, 0, 0, 0))   # uma SEGUNDA-feira, 00:00 de Brasília


def semana_da_meta(t):
    return (int(t) + META_FUSO_S - META_EPOCA) // META_SEMANA_S


def fim_da_semana(semana):
    """O instante (epoch) em que a semana `semana` acaba: a segunda seguinte, 00:00 de Brasília."""
    return META_EPOCA + (int(semana) + 1) * META_SEMANA_S - META_FUSO_S
MOEDA_TREINO = 1                  # espelha JOGO.Guilda.MOEDA_TREINO
TREINO_INTERVALO = 20             # segundos entre dois treinos que pagam, por conta
DOAR_MAX = 50000                  # XP num dízimo só (o de uma sala é bem menos)
SEM_OFERENDA = 'a guilda não recebe mais doação em dinheiro: o XP dela vem do dízimo das batalhas e da guerra de guilda'
CONVITES_MAX = 50                 # convites em aberto por guilda (os mais velhos saem)
CONVITE_VALIDADE = 7 * 86400
BANCO_MAX = 200                   # peças no banco de uma guilda
# 04/10: quem pegou emprestado e fica mais que isto sem entrar perde o empréstimo (a peça volta
# ao banco). O espelho do jogo local é JOGO.Guilda.EMPRESTIMO_AUSENCIA_DIAS; a Política de
# Privacidade cita o número (data-regua EMPRESTIMO_DIAS, conferido em tests/privacidade_api.py)
EMPRESTIMO_AUSENCIA_DIAS = 3
EMPRESTIMO_AUSENCIA_S = EMPRESTIMO_AUSENCIA_DIAS * 86400
RECOLHE_INTERVALO = 3600          # o passo periódico: no máximo uma vez por hora por processo
RECOLHE_LOTE = 20                 # empréstimos vencidos tratados de cada vez (o resto fica para o próximo passo)
AVISOS_MAX = 20                   # recados de devolução entregues de uma vez
LISTA_MAX = 100
MESTRE_GUILDAS_MAX = 500          # a lista do painel do Mestre (todas, até a da equipe)
MESTRE_MEMBROS_MAX = 60           # nomes de membros que cada linha do painel leva
DESFAZER_POR_HORA = 20            # guildas que um Mestre desfaz por hora (freio de dedo, não de abuso)
DEVOLUCAO_GRACA = 10 * 60         # a série devolvida não é varrida por isto depois de entregue (como a troca, api.py)
DEVOLUCOES_MAX = 50               # devoluções entregues ao jogo de uma vez (sem o juiz)
FRASE_DESFEITA = 'A guilda %s foi desfeita pela equipe.'
MURAL_MAX = 500                   # espelha JOGO.Guilda.MURAL_MAX
NOME_RESERVADO = 'esse nome é reservado à equipe do jogo'
RE_ITEM = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
RE_IID = re.compile(r'^[\x21-\x7e]{1,64}$')     # o mesmo do api.py

ESQUEMA_GUILDA = """
CREATE TABLE IF NOT EXISTS guildas(
  id          INTEGER PRIMARY KEY,
  nome        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  emblema     TEXT NOT NULL,
  lider_id    INTEGER NOT NULL REFERENCES contas(id),
  porta       TEXT NOT NULL DEFAULT 'aberta' CHECK (porta IN ('aberta', 'convite')),
  dizimo      INTEGER NOT NULL DEFAULT 0,
  xp          INTEGER NOT NULL DEFAULT 0,
  moedas      INTEGER NOT NULL DEFAULT 0,
  bonus_drop  INTEGER NOT NULL DEFAULT 0,
  bonus_xp    INTEGER NOT NULL DEFAULT 0,
  treinos     INTEGER NOT NULL DEFAULT 0,
  criada_em   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS guilda_membros(
  conta_id    INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  guilda_id   INTEGER NOT NULL REFERENCES guildas(id) ON DELETE CASCADE,
  cargo       TEXT NOT NULL DEFAULT 'membro' CHECK (cargo IN ('membro', 'oficial')),
  entrou_em   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS guilda_membros_g ON guilda_membros(guilda_id, entrou_em);
CREATE TABLE IF NOT EXISTS guilda_pedidos(
  guilda_id   INTEGER NOT NULL REFERENCES guildas(id) ON DELETE CASCADE,
  conta_id    INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  em          INTEGER NOT NULL,
  PRIMARY KEY (guilda_id, conta_id)
);
CREATE TABLE IF NOT EXISTS guilda_convites(
  guilda_id   INTEGER NOT NULL REFERENCES guildas(id) ON DELETE CASCADE,
  conta_id    INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  por_id      INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  em          INTEGER NOT NULL,
  PRIMARY KEY (guilda_id, conta_id)
);
CREATE TABLE IF NOT EXISTS guilda_banco(
  id              INTEGER PRIMARY KEY,
  guilda_id       INTEGER NOT NULL REFERENCES guildas(id) ON DELETE CASCADE,
  item_id         TEXT NOT NULL,
  nivel           INTEGER NOT NULL DEFAULT 0,
  estrelas        INTEGER NOT NULL DEFAULT 0,
  iid             TEXT,
  dono_id         INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  emprestado_para INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  em              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS guilda_banco_g ON guilda_banco(guilda_id, id);
CREATE INDEX IF NOT EXISTS guilda_banco_iid ON guilda_banco(iid);
-- 13/09 (a autoridade): a série da CÓPIA que o empréstimo pôs no estado de quem pegou.
-- Devolver tira do estado dele essa série; sem isto, pegar e devolver cunhava peças.
-- Tabela nova, e não coluna em guilda_banco: nada de ALTER no rolling update
CREATE TABLE IF NOT EXISTS guilda_emprestimos(
  banco_id    INTEGER PRIMARY KEY REFERENCES guilda_banco(id) ON DELETE CASCADE,
  conta_id    INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  iid         TEXT NOT NULL,
  em          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS guilda_emprestimos_iid ON guilda_emprestimos(iid);
-- 04/10 (a peça emprestada volta sozinha): a última vez que a conta ENTROU. A sessão não serve
-- de régua: ela some no sair, no login em outro aparelho e na faxina, e a conta pareceria nunca
-- ter vindo. Gravado junto com o ultimo_uso da sessão (no máximo 1 escrita por minuto por conta)
CREATE TABLE IF NOT EXISTS contas_visto(
  conta_id INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  em       INTEGER NOT NULL
);
-- o recado para quem perdeu o empréstimo sem estar aqui: o jogo mostra na volta e confirma
-- (POST /api/guilda/avisos/visto); só então a linha sai. `iid` é a série da cópia, quando há
CREATE TABLE IF NOT EXISTS guilda_avisos(
  id       INTEGER PRIMARY KEY,
  conta_id INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  item_id  TEXT NOT NULL,
  nivel    INTEGER NOT NULL DEFAULT 0,
  estrelas INTEGER NOT NULL DEFAULT 0,
  iid      TEXT,
  motivo   TEXT NOT NULL,
  em       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS guilda_avisos_conta ON guilda_avisos(conta_id, id);
-- 04/10 (a guilda desfeita pela Equipe): a peça que estava no banco e ESPERA voltar ao dono. Enquanto a
-- linha existe a série dela não é varrida pelo save do dono (api.py, salvar) — a guilda sumiu, a peça não.
-- Com o juiz a linha sai na mesma transação que põe a peça no estado dele; sem o juiz o jogo do dono a põe
-- no saco e confirma (`entregue_em`), e a linha ainda segura a varredura por DEVOLUCAO_GRACA
CREATE TABLE IF NOT EXISTS guilda_devolucoes(
  id          INTEGER PRIMARY KEY,
  conta_id    INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL,
  nivel       INTEGER NOT NULL DEFAULT 0,
  estrelas    INTEGER NOT NULL DEFAULT 0,
  iid         TEXT,
  guilda      TEXT NOT NULL,
  em          INTEGER NOT NULL,
  entregue_em INTEGER
);
CREATE INDEX IF NOT EXISTS guilda_devolucoes_conta ON guilda_devolucoes(conta_id, id);
CREATE INDEX IF NOT EXISTS guilda_devolucoes_iid ON guilda_devolucoes(iid);
-- 13/09 (pedido do dono: a grade de membros, o dízimo de cada um e a mensagem da guilda).
-- Tabelas novas, nada de ALTER: o XP que cada membro já doou (dízimo, treino, guerra; até 04/10 a oferenda),
-- o dízimo PRÓPRIO de um membro (sem linha = o padrão guildas.dizimo) e o mural
CREATE TABLE IF NOT EXISTS guilda_contrib(
  guilda_id   INTEGER NOT NULL REFERENCES guildas(id) ON DELETE CASCADE,
  conta_id    INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  xp          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guilda_id, conta_id)
);
-- 07/10: A META DA SEMANA — as salas vencidas pelos membros, por semana de Brasília; `cumprida_em` marca a
-- semana em que a barra encheu (o prêmio sai uma vez). Tabela nova, nunca ALTER
CREATE TABLE IF NOT EXISTS guilda_meta(
  guilda_id   INTEGER NOT NULL REFERENCES guildas(id) ON DELETE CASCADE,
  semana      INTEGER NOT NULL,
  salas       INTEGER NOT NULL DEFAULT 0,
  cumprida_em INTEGER,
  PRIMARY KEY (guilda_id, semana)
);
CREATE TABLE IF NOT EXISTS guilda_dizimo_membro(
  conta_id    INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  guilda_id   INTEGER NOT NULL REFERENCES guildas(id) ON DELETE CASCADE,
  pct         INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS guilda_mural(
  guilda_id   INTEGER PRIMARY KEY REFERENCES guildas(id) ON DELETE CASCADE,
  texto       TEXT NOT NULL,
  autor_id    INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  em          INTEGER NOT NULL
);
-- 13/09 (dono: "no site só aparece a guild Game Over, no jogo só a STAFF"): as guildas de
-- ANTES do servidor, que só existiam no navegador e ficaram no save como nome e emblema.
-- Uma FOTO tirada uma vez (migração 'guildas-antigas'): quem aparece aqui pode trazer a
-- guilda para o servidor sem pagar as insígnias — o primeiro vira líder e os outros da
-- mesma foto voltam para ela. Congelada no deploy: um save forjado depois não entra
CREATE TABLE IF NOT EXISTS guildas_antigas(
  conta_id    INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL COLLATE NOCASE,
  emblema     TEXT,
  trazida_em  INTEGER
);
-- 08/10 à noite: os PERGAMINHOS DA GUILDA (loja.py, tipo 'guilda': Novo Nome e Brasão), vendidos só na loja do
-- site. A posse é o pedido 'entregue'; cada USO consome um pedido (uma linha aqui, única por pedido). A guilda
-- em que foi usado fica como número solto, sem chave: a faxina de uma guilda desfeita não pode devolver
-- o pergaminho gasto (a prova `orfas_da_guilda` varre toda referência a guildas)
CREATE TABLE IF NOT EXISTS guilda_pergaminhos_usados(
  id          INTEGER PRIMARY KEY,
  pedido_id   INTEGER NOT NULL UNIQUE REFERENCES loja_pedidos(id),
  conta_id    INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('nome', 'brasao')),
  onde        INTEGER NOT NULL,
  antes       TEXT,
  usado_em    INTEGER NOT NULL
);
"""
ORDEM_CARGO = {'lider': 0, 'oficial': 1, 'membro': 2}
RE_CONTROLE = re.compile(r'[\x00-\x09\x0b-\x1f\x7f]')


def soma_contrib(con, cid, xp):
    """13/09: o XP que a conta doou à guilda em que está AGORA (a ordem da grade de membros).
    Dentro da tranca de quem chama; sem guilda, nada."""
    if isinstance(xp, int) and xp > 0:
        con.execute("INSERT INTO guilda_contrib(guilda_id, conta_id, xp) "
                    "SELECT guilda_id, conta_id, ? FROM guilda_membros WHERE conta_id = ? "
                    "ON CONFLICT(guilda_id, conta_id) DO UPDATE SET xp = xp + excluded.xp", (xp, cid))


def meta_de(con, gid, t):
    """A META DA SEMANA da guilda `gid` no instante t: {semana, salas, alvo, cumprida, fim} (fim em ms)."""
    semana = semana_da_meta(t)
    r = con.execute("SELECT salas, cumprida_em FROM guilda_meta WHERE guilda_id = ? AND semana = ?",
                    (gid, semana)).fetchone()
    salas = r['salas'] if r is not None else 0
    return {'semana': semana, 'salas': salas, 'alvo': META_SALAS,
            'cumprida': bool(r is not None and r['cumprida_em']), 'fim': fim_da_semana(semana) * 1000}


def soma_meta(con, cid, t):
    """07/10: uma sala vencida pela conta `cid` (solo ou em grupo) entra na meta da semana da guilda em que ela
    está AGORA. Dentro da tranca de quem chama; sem guilda, None. Ao encher pela primeira vez na semana: XP_META
    para a guilda e os dois bônus (+15% de XP e de saque) estendidos até o fim da semana. Devolve a meta de
    depois, com `cumpriuAgora` quando foi esta sala que a encheu."""
    m = con.execute("SELECT guilda_id FROM guilda_membros WHERE conta_id = ?", (cid,)).fetchone()
    if m is None:
        return None
    gid, semana = m['guilda_id'], semana_da_meta(t)
    con.execute("INSERT INTO guilda_meta(guilda_id, semana, salas) VALUES (?, ?, 1) "
                "ON CONFLICT(guilda_id, semana) DO UPDATE SET salas = salas + 1", (gid, semana))
    r = con.execute("SELECT salas, cumprida_em FROM guilda_meta WHERE guilda_id = ? AND semana = ?",
                    (gid, semana)).fetchone()
    cumpriu_agora = False
    if r['salas'] >= META_SALAS and not r['cumprida_em']:
        fim = fim_da_semana(semana)
        con.execute("UPDATE guilda_meta SET cumprida_em = ? WHERE guilda_id = ? AND semana = ?", (int(t), gid, semana))
        con.execute("UPDATE guildas SET xp = xp + ?, bonus_xp = MAX(bonus_xp, ?), bonus_drop = MAX(bonus_drop, ?) "
                    "WHERE id = ?", (XP_META, fim, fim, gid))
        cumpriu_agora = True
        log.info("meta da semana cumprida: guilda #%d, semana %d (%d salas)", gid, semana, r['salas'])
    meta = meta_de(con, gid, t)
    meta['cumpriuAgora'] = cumpriu_agora
    return meta


NIVEL_MAX = 30                    # 08/10 à noite: a escada para no 30 (espelha JOGO.Guilda.NIVEL_MAX)
# AS VAGAS POR NÍVEL (08/10 à noite; o dono: "a guilda deve ter limite de membro por nível: nv 1 até 10
# membros, nv 2 15, e assim em diante; nv máximo 30 para 200 membros"). +5 por nível no começo, curvando até
# 200 no 30: vaga(n) = 10 + 5(n−1) + (n−1)²·45/841, arredondada — a tabela fica escrita para os dois lados
# (JOGO.Guilda.VAGAS é a mesma) lerem o mesmo número, sem conta de ponto flutuante.
VAGAS = [10, 15, 20, 25, 31, 36, 42, 48, 53, 59, 65, 71, 78, 84, 90, 97, 104, 110, 117, 124, 131, 139, 146, 153, 161, 168, 176, 184, 192, 200]
def vagas_de(nivel):
    n = nivel if isinstance(nivel, int) else 1
    return VAGAS[max(1, min(NIVEL_MAX, n)) - 1]
def nivel_de(xp):
    """A escada da guilda (a mesma do JOGO.Guilda.nivelDe): limiar(n) = 60·n·(n+1)/2, até NIVEL_MAX."""
    xp = xp if isinstance(xp, int) and xp > 0 else 0
    n = 1
    while n < NIVEL_MAX and xp >= 60 * n * (n + 1) // 2:
        n += 1
    return n


def _id_positivo(v, campo):
    if isinstance(v, bool) or not isinstance(v, int) or v < 1:
        raise Recusa(400, '%s precisa ser um id' % campo)
    return v


class GuildaMixin:
    """As rotas /api/guilda/* (ver ROTAS no api.py). Toda escrita dentro da
    tranca, com commit no fim; toda resposta de sucesso que muda a guilda leva
    a ficha nova (`guilda`), para o cliente não precisar de um GET a mais."""

    # -- miudezas ------------------------------------------------------------------
    def _g_membro(self, cid):
        """(a linha da guilda, o cargo resolvido) de uma conta, ou (None, None)."""
        r = self.con.execute("SELECT g.*, m.cargo AS m_cargo FROM guilda_membros m "
                             "JOIN guildas g ON g.id = m.guilda_id WHERE m.conta_id = ?", (cid,)).fetchone()
        if r is None:
            return None, None
        return r, ('lider' if r['lider_id'] == cid else r['m_cargo'])

    def _g_da_conta(self, conta):
        g, cargo = self._g_membro(conta['id'])
        if g is None:
            raise Recusa(409, 'sem guilda')
        return g, cargo

    def _g_nomes(self, ids):
        """id da conta → o nome do jogo (o do save, pelo resumo) ou o da conta."""
        ids = sorted({i for i in ids if isinstance(i, int)})
        if not ids:
            return {}
        q = ("SELECT c.id, " + NOME_PUBLICO_SQL + " AS nome FROM contas c "
             "LEFT JOIN resumos r ON r.conta_id = c.id WHERE c.id IN (%s)" % ','.join('?' * len(ids)))
        return {r['id']: r['nome'] for r in self.con.execute(q, ids)}

    def _g_foto(self, gid, eu):
        """A ficha no formato do guilda.js local (a HUD não sabe de onde veio)."""
        g = self.con.execute("SELECT * FROM guildas WHERE id = ?", (gid,)).fetchone()
        if g is None:
            return None
        ms = self.con.execute("SELECT conta_id, cargo FROM guilda_membros WHERE guilda_id = ? "
                              "ORDER BY entrou_em, conta_id", (gid,)).fetchall()
        ps = self.con.execute("SELECT conta_id, em FROM guilda_pedidos WHERE guilda_id = ? ORDER BY em, conta_id",
                              (gid,)).fetchall()
        bs = self.con.execute("SELECT * FROM guilda_banco WHERE guilda_id = ? ORDER BY id", (gid,)).fetchall()
        # 13/09: o XP que cada um doou, o dízimo próprio de cada um e a mensagem da guilda
        doado = {r['conta_id']: r['xp'] for r in self.con.execute(
            "SELECT conta_id, xp FROM guilda_contrib WHERE guilda_id = ?", (gid,))}
        proprio = {r['conta_id']: r['pct'] for r in self.con.execute(
            "SELECT conta_id, pct FROM guilda_dizimo_membro WHERE guilda_id = ?", (gid,))}
        mu = self.con.execute("SELECT texto, autor_id, em FROM guilda_mural WHERE guilda_id = ?", (gid,)).fetchone()
        nm = self._g_nomes([m['conta_id'] for m in ms] + [p['conta_id'] for p in ps] +
                           [b['dono_id'] for b in bs] + [b['emprestado_para'] for b in bs] +
                           ([mu['autor_id']] if mu is not None else []))
        membros = [{'id': m['conta_id'], 'nome': nm.get(m['conta_id'], '?'),
                    'cargo': 'lider' if m['conta_id'] == g['lider_id'] else m['cargo'],
                    'xpDoado': doado.get(m['conta_id'], 0),
                    'dizimo': proprio.get(m['conta_id'], g['dizimo']),
                    'dizimoProprio': m['conta_id'] in proprio} for m in ms]
        # a ordem da grade: o cargo, depois quem mais doou
        membros.sort(key=lambda m: (ORDEM_CARGO.get(m['cargo'], 2), -m['xpDoado'], str(m['nome']).lower()))
        cargo = next((m['cargo'] for m in membros if m['id'] == eu), None)
        return {
            'id': g['id'], 'nome': g['nome'], 'emblema': g['emblema'], 'liderId': g['lider_id'],
            'membros': membros, 'xp': g['xp'], 'nivel': nivel_de(g['xp']), 'moedas': g['moedas'],
            'vagas': None if self._g_da_equipe(g) else vagas_de(nivel_de(g['xp'])),   # 08/10 à noite: o teto do nível (a da equipe não tem)
            'nivelMax': NIVEL_MAX,
            'bonus': {'drop': g['bonus_drop'] * 1000, 'xp': g['bonus_xp'] * 1000},
            'banco': [{'id': b['id'], 'itemId': b['item_id'], 'level': b['nivel'], 'stars': b['estrelas'],
                       'iid': b['iid'], 'dono': b['dono_id'], 'donoNome': nm.get(b['dono_id'], '?'),
                       'emprestadoPara': b['emprestado_para'],
                       'tomadorNome': nm.get(b['emprestado_para']) if b['emprestado_para'] else None}
                      for b in bs],
            'treinos': g['treinos'], 'criadaEm': g['criada_em'] * 1000, 'porta': g['porta'],
            'dizimo': g['dizimo'],
            'mural': ({'texto': mu['texto'], 'autorNome': nm.get(mu['autor_id']) if mu['autor_id'] else None,
                       'em': mu['em'] * 1000} if mu is not None else None),
            'pedidos': [{'id': p['conta_id'], 'nome': nm.get(p['conta_id'], '?'), 'em': p['em'] * 1000} for p in ps],
            'souLider': g['lider_id'] == eu, 'meuCargo': cargo, 'eu': eu,
            'meta': meta_de(self.con, gid, agora()),      # 07/10: a meta da semana (salas vencidas pelos membros)
            # 10/10, o Torneio da Arena (torneio.py): {campea, titulos (as marcas, até 5), fatorXp (2 enquanto o XP em
            # dobro da campeã valer; senão 1), xpDobroAteMs} — o cliente mostra a placa e avisa do XP em dobro
            'torneio': (self._torneio_da_guilda(gid, agora()) if hasattr(self, '_torneio_da_guilda')
                        else {'campea': False, 'titulos': 0, 'fatorXp': 1, 'xpDobroAteMs': 0}),
            'pergaminhos': self._g_pergaminhos(eu),       # 08/10 à noite: os da loja do site que ESTA conta ainda tem
        }

    # -- os pergaminhos da guilda (08/10 à noite) ---------------------------------------
    PERGAMINHOS_GUILDA = {'nome': 'pergaminho-guilda-nome', 'brasao': 'pergaminho-guilda-brasao'}

    def _g_pergaminhos_livres(self, cid, tipo):
        """Os pedidos 'entregue' do pergaminho deste tipo que ainda não foram gastos, do mais antigo."""
        return [r['id'] for r in self.con.execute(
            "SELECT p.id FROM loja_pedidos p LEFT JOIN guilda_pergaminhos_usados u ON u.pedido_id = p.id "
            "WHERE p.conta_id = ? AND p.sku = ? AND p.estado = 'entregue' AND u.pedido_id IS NULL ORDER BY p.id",
            (cid, self.PERGAMINHOS_GUILDA[tipo]))]

    def _g_pergaminhos(self, cid):
        return {tipo: len(self._g_pergaminhos_livres(cid, tipo)) for tipo in self.PERGAMINHOS_GUILDA}

    def _g_gasta_pergaminho(self, cid, tipo, gid, antes, t):
        """Dentro da tranca: o pergaminho mais antigo deste tipo vira usado. Sem nenhum, recusa."""
        livres = self._g_pergaminhos_livres(cid, tipo)
        if not livres:
            raise Recusa(409, 'sem Pergaminho do Novo Nome: ele se vende na loja do site, na seção Guilda' if tipo == 'nome'
                         else 'sem Pergaminho do Brasão: ele se vende na loja do site, na seção Guilda')
        self.con.execute("INSERT INTO guilda_pergaminhos_usados(pedido_id, conta_id, tipo, onde, antes, usado_em) "
                         "VALUES (?, ?, ?, ?, ?, ?)", (livres[0], cid, tipo, gid, antes, t))
        return livres[0]

    def _g_minha_como_lider(self, cid, o_que):
        g, _ = self._g_membro(cid)
        if g is None:
            raise Recusa(404, 'você não tem guilda')
        if g['lider_id'] != cid:
            raise Recusa(403, o_que)
        return g

    def guilda_renomear(self, conta, corpo):
        """POST /api/guilda/renomear {nome}: o líder gasta um Pergaminho do Novo Nome. A mesma lei dos
        nomes da fundação (reservado, único sem caixa)."""
        nome = corpo.get('nome')
        nome = nome.strip()[:NOME_MAX].strip() if isinstance(nome, str) else ''
        if not nome:
            raise Recusa(400, 'diga um nome')
        if not conta['gm'] and nomes.reservado(nome):
            raise Recusa(400, NOME_RESERVADO)
        cid, t = conta['id'], agora()
        with self.tranca:
            g = self._g_minha_como_lider(cid, 'só o líder renomeia a guilda')
            if g['nome'] == nome:
                raise Recusa(409, 'a guilda já se chama assim')
            outra = self.con.execute("SELECT id FROM guildas WHERE nome = ? AND id != ?", (nome, g['id'])).fetchone()
            if outra is not None:
                raise Recusa(409, 'já existe uma guilda com esse nome')
            pid = self._g_gasta_pergaminho(cid, 'nome', g['id'], g['nome'], t)
            try:
                self.con.execute("UPDATE guildas SET nome = ? WHERE id = ?", (nome, g['id']))
            except sqlite3.IntegrityError:
                self.con.rollback()
                raise Recusa(409, 'já existe uma guilda com esse nome')
            self._evento(cid, 'guilda', {'acao': 'renomear', 'gid': g['id'], 'de': g['nome'], 'para': nome, 'pedido': pid})
            foto = self._g_ficha(g['id'], cid)
        log.info("guilda #%d renomeada por #%d: %r -> %r (pedido #%d)", g['id'], cid, g['nome'], nome, pid)
        return 200, {'ok': True, 'guilda': foto}

    def guilda_brasao(self, conta, corpo):
        """POST /api/guilda/brasao {emblema}: o líder gasta um Pergaminho do Brasão."""
        emblema = corpo.get('emblema')
        emblema = emblema.strip()[:EMBLEMA_MAX] if isinstance(emblema, str) and emblema.strip() else ''
        if not emblema:
            raise Recusa(400, 'diga um brasão')
        cid, t = conta['id'], agora()
        with self.tranca:
            g = self._g_minha_como_lider(cid, 'só o líder troca o brasão')
            if g['emblema'] == emblema:
                raise Recusa(409, 'o brasão já é esse')
            pid = self._g_gasta_pergaminho(cid, 'brasao', g['id'], g['emblema'], t)
            self.con.execute("UPDATE guildas SET emblema = ? WHERE id = ?", (emblema, g['id']))
            self._evento(cid, 'guilda', {'acao': 'brasao', 'gid': g['id'], 'pedido': pid})
            foto = self._g_ficha(g['id'], cid)
        log.info("guilda #%d trocou o brasão por #%d (pedido #%d)", g['id'], cid, pid)
        return 200, {'ok': True, 'guilda': foto}

    def _g_existe(self, gid):
        g = self.con.execute("SELECT * FROM guildas WHERE id = ?", (gid,)).fetchone()
        if g is None:
            raise Recusa(404, 'essa guilda não existe mais')
        return g

    def _g_da_equipe(self, g):
        """04/10 (dono: "guild staff não deve aparecer nem na lista de guild.. só o adm possui"):
        a guilda da EQUIPE é a que um Mestre lidera (contas.gm = 1 no líder). Ela não sai em
        lista nem em ranking para quem não é da equipe, e jogador comum não entra nela por
        conta própria — para ele é como se não existisse."""
        r = self.con.execute("SELECT gm FROM contas WHERE id = ?", (g['lider_id'],)).fetchone()
        return bool(r is not None and r['gm'])

    def _g_existe_para(self, gid, conta, t):
        """A guilda `gid` como ESTA conta a enxerga: a da equipe só existe para o Mestre e
        para quem o Mestre convidou (o convite ainda válido); o resto recebe o mesmo 404 da
        guilda que não existe — a recusa não confirma que ela está lá."""
        g = self._g_existe(gid)
        if not conta['gm'] and self._g_da_equipe(g):
            cv = self.con.execute("SELECT em FROM guilda_convites WHERE guilda_id = ? AND conta_id = ?",
                                  (gid, conta['id'])).fetchone()
            if cv is None or cv['em'] < t - CONVITE_VALIDADE:
                raise Recusa(404, 'essa guilda não existe mais')
        return g

    def _g_cheia(self, g):
        """08/10 à noite: a guilda está nas vagas do nível dela? A da EQUIPE (líder Mestre) não tem teto."""
        if self._g_da_equipe(g):
            return False
        n = self.con.execute("SELECT COUNT(*) AS n FROM guilda_membros WHERE guilda_id = ?", (g['id'],)).fetchone()['n']
        return n >= vagas_de(nivel_de(g['xp']))

    def _g_entra(self, cid, gid, t):
        """Põe a conta na guilda; a fila e os convites dela, em qualquer guilda, saem. 08/10 à noite: só se
        há vaga no nível dela (toda porta passa por aqui: entrar, pedido aceito, convite, trazer)."""
        g = self.con.execute("SELECT * FROM guildas WHERE id = ?", (gid,)).fetchone()
        if g is not None and self._g_cheia(g):
            raise Recusa(409, 'a guilda está cheia — ela abre mais vagas ao subir de nível')
        self.con.execute("INSERT INTO guilda_membros(conta_id, guilda_id, cargo, entrou_em) VALUES (?, ?, 'membro', ?)",
                         (cid, gid, t))
        self.con.execute("DELETE FROM guilda_pedidos WHERE conta_id = ?", (cid,))
        self.con.execute("DELETE FROM guilda_convites WHERE conta_id = ?", (cid,))

    def _g_ficha(self, gid, cid):
        self.con.commit()
        return self._g_foto(gid, cid)

    # -- as guildas de antes (13/09) ---------------------------------------------------
    def _migra_guildas_antigas(self):
        """A foto das guildas de antes do servidor, uma vez por banco (o marcador
        sai na mesma transação; no rolling update o segundo processo espera a
        trava e acha o marcador). Entra quem tem nome de guilda no resumo do
        save, não está em guilda do servidor e cuja guilda NÃO existe no
        servidor com esse nome; conta banida fica de fora."""
        with self._escrita():
            if self.con.execute("SELECT 1 FROM migracoes WHERE nome = 'guildas-antigas'").fetchone():
                return
            n = self.con.execute(
                "INSERT OR IGNORE INTO guildas_antigas(conta_id, nome, emblema) "
                "SELECT r.conta_id, TRIM(r.guilda_nome), r.guilda_emblema FROM resumos r "
                "JOIN contas c ON c.id = r.conta_id "
                "WHERE c.banido = 0 AND r.guilda_nome IS NOT NULL AND TRIM(r.guilda_nome) != '' "
                "  AND r.conta_id NOT IN (SELECT conta_id FROM guilda_membros) "
                "  AND TRIM(r.guilda_nome) NOT IN (SELECT nome FROM guildas)").rowcount
            self.con.execute("INSERT INTO migracoes(nome, feita_em) VALUES ('guildas-antigas', ?)", (agora(),))
        log.info("migração guildas-antigas: %d conta(s) com guilda de antes para trazer", max(0, n))

    def _g_antiga(self, cid):
        """A guilda de antes que esta conta ainda pode trazer: {nome, emblema,
        existe} (existe = alguém da mesma foto já a trouxe: é só voltar), ou None."""
        a = self.con.execute("SELECT nome, emblema FROM guildas_antigas WHERE conta_id = ? AND trazida_em IS NULL",
                             (cid,)).fetchone()
        if a is None:
            return None
        g = self.con.execute("SELECT id FROM guildas WHERE nome = ?", (a['nome'],)).fetchone()
        veio = g is not None and self.con.execute(
            "SELECT 1 FROM guildas_antigas WHERE nome = ? AND trazida_em IS NOT NULL", (a['nome'],)).fetchone()
        if g is not None and not veio:
            return None                       # o nome foi fundado por outra gente: não há o que trazer
        return {'nome': a['nome'], 'emblema': a['emblema'] or '⚑', 'existe': g is not None}

    # -- ler ------------------------------------------------------------------------
    def guilda_minha(self, conta, corpo):
        with self.tranca:
            g, _ = self._g_membro(conta['id'])
        if g is not None:
            # 04/10: abrir o banco é a hora barata de conferir os empréstimos DESTA guilda (uma
            # consulta pelo índice; o juiz só é chamado se houver vencido)
            self._g_recolhe_ausentes(g['id'])
        # 04/10: a peça que voltou de uma guilda desfeita e ainda não entrou (o juiz estava fora, a
        # conta não tinha estado): tenta de novo aqui. Uma consulta pelo índice quando não há nada
        self._g_entrega_devolucoes(conta['id'])
        with self.tranca:
            g, _ = self._g_membro(conta['id'])
            avisos = self._g_avisos(conta['id'])
            resposta = {'ok': True, 'avisos': avisos, 'devolucoes': self._g_devolucoes(conta['id'])}
            if g is not None:
                resposta['guilda'] = self._g_foto(g['id'], conta['id'])
            else:
                resposta.update(guilda=None, antiga=self._g_antiga(conta['id']))
            return 200, resposta

    # -- a peça emprestada que volta sozinha (04/10) -------------------------------------
    def _g_visto(self, cid, t):
        """Dentro da transação de quem chama: a conta entrou agora."""
        self.con.execute("INSERT OR REPLACE INTO contas_visto(conta_id, em) VALUES (?, ?)", (cid, t))

    def _g_avisos(self, cid):
        return [{'id': r['id'], 'itemId': r['item_id'], 'level': r['nivel'], 'stars': r['estrelas'],
                 'iid': r['iid'], 'motivo': r['motivo'], 'dias': EMPRESTIMO_AUSENCIA_DIAS}
                for r in self.con.execute("SELECT * FROM guilda_avisos WHERE conta_id = ? ORDER BY id LIMIT ?",
                                          (cid, AVISOS_MAX))]

    def guilda_avisos_visto(self, conta, corpo):
        """O jogo mostrou os recados até `ate`: saem. Confirmado, e não apagado na leitura: sem
        a autoridade é o jogo que tira a cópia do saco ao ler o recado, e uma resposta perdida
        no caminho deixaria a cópia com ele e a original no banco."""
        ate = _id_positivo(corpo.get('ate'), 'ate')
        with self._escrita():
            self.con.execute("DELETE FROM guilda_avisos WHERE conta_id = ? AND id <= ?", (conta['id'], ate))
        return 200, {'ok': True}

    def _g_solta_emprestimo(self, b, motivo, t, iid=None, avisa=True):
        """Dentro de _escrita: a vaga `b` fica livre e quem pegou ganha o recado."""
        tomador = b['emprestado_para']
        self.con.execute("UPDATE guilda_banco SET emprestado_para = NULL WHERE id = ?", (b['id'],))
        self.con.execute("DELETE FROM guilda_emprestimos WHERE banco_id = ?", (b['id'],))
        if avisa and tomador is not None:
            self.con.execute("INSERT INTO guilda_avisos(conta_id, item_id, nivel, estrelas, iid, motivo, em) "
                             "VALUES (?, ?, ?, ?, ?, ?, ?)",
                             (tomador, b['item_id'], b['nivel'], b['estrelas'], iid, motivo, t))
            self._evento(tomador, 'guilda', {'acao': 'recolhida', 'gid': b['guilda_id'], 'banco': b['id'],
                                             'iid': iid, 'motivo': motivo})

    def _g_recolhe_prepara(self, bid):
        """FORA da tranca: lê o empréstimo da vaga e, com a autoridade, pede ao juiz o estado
        de quem pegou SEM a cópia. Devolve None (a vaga não está emprestada) ou o preparo que
        o _g_recolhe_aplica confere e grava. O juiz fora do ar levanta Recusa (503)."""
        with self.tranca:
            b = self.con.execute("SELECT * FROM guilda_banco WHERE id = ?", (bid,)).fetchone()
            if b is None or b['emprestado_para'] is None:
                return None
            tomador = b['emprestado_para']
            emp = self.con.execute("SELECT iid FROM guilda_emprestimos WHERE banco_id = ? AND conta_id = ?",
                                   (bid, tomador)).fetchone()
            conta_t = self.con.execute("SELECT * FROM contas WHERE id = ?", (tomador,)).fetchone()
            # sem a autoridade o saco mora no navegador de quem pegou: o servidor só solta a vaga
            # e o jogo dele tira a cópia ao ler o recado. Empréstimo de antes da autoridade não
            # tem série anotada: também só solta a vaga, como a devolução comum
            estado = self._estado_ler(tomador) if (emp is not None and conta_t is not None
                                                   and self._g_autoridade()) else None
        saida = None
        if estado is not None:
            saida = self._juiz_op(dict(conta_t), estado,
                                  [{'nome': 'bancoGuildaRecolhe', 'args': {'iid': emp['iid']}}], interno=True)
        return {'bid': bid, 'tomador': tomador, 'iid': emp['iid'] if emp is not None else None,
                'conta': dict(conta_t) if conta_t is not None else None, 'estado': estado, 'saida': saida}

    def _g_recolhe_aplica(self, p, motivo, t, limite=None):
        """Dentro de _escrita: grava o que o preparo calculou, se a vaga ainda é o MESMO
        empréstimo (senão EstadoMudou: quem chama prepara de novo). Com `limite`, só recolhe
        se quem pegou continua ausente — ele pode ter entrado enquanto o juiz respondia.
        True se a peça voltou ao banco."""
        b = self.con.execute("SELECT * FROM guilda_banco WHERE id = ?", (p['bid'],)).fetchone()
        if b is None or b['emprestado_para'] is None:
            return False
        emp = self.con.execute("SELECT iid FROM guilda_emprestimos WHERE banco_id = ? AND conta_id = ?",
                               (b['id'], b['emprestado_para'])).fetchone()
        if b['emprestado_para'] != p['tomador'] or (emp['iid'] if emp is not None else None) != p['iid']:
            raise EstadoMudou()
        if limite is not None and not self.con.execute(
                "SELECT 1 FROM contas_visto WHERE conta_id = ? AND em < ?", (p['tomador'], limite)).fetchone():
            return False
        if p['saida'] is not None:
            # a cópia sai do estado dele e a série dela vira 'fora' (não duplica nem some: a
            # original nunca saiu do banco)
            self._estado_grava(p['conta'], p['estado'], p['saida'], t)
        self._g_solta_emprestimo(b, motivo, t, iid=p['iid'])
        return True

    def _g_recolhe_ausentes(self, gid=None):
        """FORA da tranca. As peças emprestadas a quem está há mais de EMPRESTIMO_AUSENCIA_DIAS
        sem entrar voltam ao banco (de uma guilda, ou de todas no passo periódico). Barato
        quando não há nada: uma consulta. Nunca derruba quem chamou: o que falhar fica para a
        próxima vez. Devolve quantas voltaram."""
        try:
            limite = agora() - EMPRESTIMO_AUSENCIA_S
            with self.tranca:
                q = ("SELECT b.id FROM guilda_banco b JOIN contas_visto v ON v.conta_id = b.emprestado_para "
                     "WHERE v.em < ?%s ORDER BY v.em LIMIT ?" % (" AND b.guilda_id = ?" if gid is not None else ""))
                args = (limite,) + ((gid,) if gid is not None else ()) + (RECOLHE_LOTE,)
                vencidos = [r[0] for r in self.con.execute(q, args)]
            voltaram = 0
            for bid in vencidos:
                for _ in range(3):
                    try:
                        p = self._g_recolhe_prepara(bid)
                        if p is None:
                            break
                        with self._escrita():
                            voltaram += 1 if self._g_recolhe_aplica(p, 'ausencia', agora(), limite) else 0
                        break
                    except EstadoMudou:
                        continue
                    except Recusa as e:      # o juiz fora do ar, o estado torto: esta fica para depois
                        log.warning("banco da guilda: a vaga #%d não pôde ser recolhida agora (%s)", bid, e)
                        break
            if voltaram:
                log.info("banco da guilda: %d peça(s) emprestada(s) voltaram (mais de %d dias sem entrar)",
                         voltaram, EMPRESTIMO_AUSENCIA_DIAS)
            return voltaram
        except Exception:                    # o passo é faxina: nunca pode custar o pedido de quem passou
            log.exception("banco da guilda: o passo que recolhe os empréstimos vencidos falhou")
            return 0

    def _g_passo_emprestimos(self):
        """O passo periódico (o despacha do api.py chama ANTES de reconhecer a conta do
        pedido: quem volta depois do prazo é conferido antes de contar como presente). Um
        número comparado por pedido; o trabalho, no máximo uma vez por RECOLHE_INTERVALO."""
        t = agora()
        if t - getattr(self, '_g_recolhe_em', 0) < RECOLHE_INTERVALO:
            return
        self._g_recolhe_em = t
        try:
            with self._escrita():
                # o empréstimo de antes desta regra não tem "visto por último": o prazo dele
                # começa a contar do último uso de uma sessão viva, ou de agora
                self.con.execute(
                    "INSERT OR IGNORE INTO contas_visto(conta_id, em) "
                    "SELECT DISTINCT b.emprestado_para, COALESCE((SELECT MAX(s.ultimo_uso) FROM sessoes s "
                    "WHERE s.conta_id = b.emprestado_para), ?) FROM guilda_banco b "
                    "WHERE b.emprestado_para IS NOT NULL "
                    "AND b.emprestado_para NOT IN (SELECT conta_id FROM contas_visto)", (t,))
        except sqlite3.Error:
            log.exception("banco da guilda: não deu para datar os empréstimos antigos")
        self._g_recolhe_ausentes()

    # -- excluir a conta com peça emprestada (privacidade.py chama) -------------------------
    def _g_recolhas_do_dono(self, cid):
        """FORA da tranca: o preparo de cada peça DESTA conta que está emprestada a alguém."""
        with self.tranca:
            ids = [r[0] for r in self.con.execute(
                "SELECT id FROM guilda_banco WHERE dono_id = ? AND emprestado_para IS NOT NULL", (cid,))]
        preparos = {}
        for bid in ids:
            try:
                p = self._g_recolhe_prepara(bid)
            except Recusa as e:
                # excluir a conta é direito de quem pede e não espera o juiz: sem ele, a cópia
                # fica com quem pegou (a original some com a conta: não é duplicação)
                log.warning("excluir conta #%d: a cópia da vaga #%d fica com quem pegou (%s)", cid, bid, e)
                p = None
            if p is not None:
                preparos[bid] = p
        return preparos

    def _g_excluir_emprestimos(self, cid, preparos, t, ultima):
        """Dentro da transação da exclusão. (1) O que a conta PEGOU volta ao banco, livre e do
        dono (o estado dela some com a conta: nada a tirar). (2) O que ela EMPRESTOU é recolhido
        de quem pegou — a peça é dela e sai do jogo com ela, como o resto dos itens; deixar a
        cópia com quem pegou seria dar de presente uma peça emprestada. Se o empréstimo mudou
        desde o preparo, EstadoMudou (quem chama prepara de novo); na `ultima` tentativa a
        cópia fica com quem pegou em vez de segurar a exclusão."""
        for b in self.con.execute("SELECT * FROM guilda_banco WHERE emprestado_para = ?", (cid,)).fetchall():
            self._g_solta_emprestimo(b, 'conta-excluida', t, avisa=False)
        self.con.execute("DELETE FROM guilda_emprestimos WHERE conta_id = ?", (cid,))
        for b in self.con.execute("SELECT * FROM guilda_banco WHERE dono_id = ? AND emprestado_para IS NOT NULL",
                                  (cid,)).fetchall():
            p = preparos.get(b['id'])
            try:
                if p is None:
                    raise EstadoMudou()
                self._g_recolhe_aplica(p, 'dono-excluiu', t)
            except EstadoMudou:
                if not ultima:
                    raise
                log.warning("excluir conta #%d: a cópia da vaga #%d ficou com quem pegou", cid, b['id'])

    def guilda_trazer(self, conta, corpo):
        """Traz a guilda de antes (13/09): a primeira conta da foto a funda sem
        insígnias e vira líder; as outras voltam direto para ela, sem convite e
        sem olhar a porta — já eram da guilda."""
        cid, t = conta['id'], agora()
        with self.tranca:
            if self._g_membro(cid)[0] is not None:
                raise Recusa(409, 'você já tem guilda')
            a = self._g_antiga(cid)
            if a is None:
                raise Recusa(404, 'não há guilda de antes para trazer')
            if not conta['gm'] and nomes.reservado(a['nome']):
                raise Recusa(400, NOME_RESERVADO)
            if a['existe']:
                gid = self.con.execute("SELECT id FROM guildas WHERE nome = ?", (a['nome'],)).fetchone()['id']
                self._g_entra(cid, gid, t)
                como = 'voltou'
            else:
                try:
                    gid = self.con.execute(
                        "INSERT INTO guildas(nome, emblema, lider_id, criada_em) VALUES (?, ?, ?, ?)",
                        (a['nome'][:NOME_MAX], a['emblema'][:EMBLEMA_MAX], cid, t)).lastrowid
                except sqlite3.IntegrityError:
                    self.con.rollback()
                    raise Recusa(409, 'já existe uma guilda com esse nome')
                self._g_entra(cid, gid, t)
                como = 'fundou'
            self.con.execute("UPDATE guildas_antigas SET trazida_em = ? WHERE conta_id = ?", (t, cid))
            self._evento(cid, 'guilda-trazida', {'guilda': gid, 'nome': a['nome'], 'como': como})
            return 200, {'ok': True, 'como': como, 'guilda': self._g_ficha(gid, cid)}

    def guilda_lista(self, conta, corpo):
        with self.tranca:
            rs = self.con.execute(
                "SELECT g.id, g.nome, g.emblema, g.xp, g.porta, COUNT(m.conta_id) AS membros FROM guildas g "
                "LEFT JOIN guilda_membros m ON m.guilda_id = g.id "
                # 04/10: a guilda da equipe (líder Mestre) só sai na lista do próprio Mestre — a lista é o
                # ranking da ficha E a porta de entrada de quem não tem guilda (ver _g_da_equipe)
                "WHERE (? = 1 OR NOT EXISTS (SELECT 1 FROM contas l WHERE l.id = g.lider_id AND l.gm = 1) "
                # 04/10 (dono: "a da minha conta teste sumiu"): quem É membro de uma guilda da equipe (entrou
                # pelo convite do Mestre) continua vendo a PRÓPRIA guilda no ranking da ficha — escondê-la
                # dele fazia a guilda parecer ter sumido justo para quem está dentro
                "  OR g.id = (SELECT guilda_id FROM guilda_membros WHERE conta_id = ?)) "
                "GROUP BY g.id ORDER BY g.xp DESC, g.id LIMIT ?",
                (1 if conta['gm'] else 0, conta['id'], LISTA_MAX)).fetchall()
        return 200, {'ok': True, 'guildas': [
            {'id': r['id'], 'nome': r['nome'], 'emblema': r['emblema'], 'xp': r['xp'], 'nivel': nivel_de(r['xp']),
             'membros': r['membros'], 'porta': r['porta'],
             'vagas': vagas_de(nivel_de(r['xp']))} for r in rs]}     # 08/10 à noite: a lista diz quantas cabem

    # -- a vida da guilda -----------------------------------------------------------
    def guilda_criar(self, conta, corpo):
        nome = corpo.get('nome')
        nome = nome.strip()[:NOME_MAX].strip() if isinstance(nome, str) else ''
        if not nome:
            raise Recusa(400, 'diga um nome')
        if not conta['gm'] and nomes.reservado(nome):
            raise Recusa(400, NOME_RESERVADO)
        emblema = corpo.get('emblema')
        emblema = emblema.strip()[:EMBLEMA_MAX] if isinstance(emblema, str) and emblema.strip() else '⚑'
        cid, t = conta['id'], agora()
        with self.tranca:
            if self._g_membro(cid)[0] is not None:
                raise Recusa(409, 'você já tem guilda')
            try:
                gid = self.con.execute("INSERT INTO guildas(nome, emblema, lider_id, criada_em) VALUES (?, ?, ?, ?)",
                                       (nome, emblema, cid, t)).lastrowid
            except sqlite3.IntegrityError:
                self.con.rollback()
                raise Recusa(409, 'já existe uma guilda com esse nome')
            self._g_entra(cid, gid, t)
            self._evento(cid, 'guilda', {'acao': 'criar', 'gid': gid})
            foto = self._g_ficha(gid, cid)
        log.info("guilda fundada: #%d por #%d", gid, cid)
        return 200, {'ok': True, 'guilda': foto}

    def guilda_entrar(self, conta, corpo):
        gid, cid, t = _id_positivo(corpo.get('gid'), 'gid'), conta['id'], agora()
        with self.tranca:
            if self._g_membro(cid)[0] is not None:
                raise Recusa(409, 'você já tem guilda')
            g = self._g_existe_para(gid, conta, t)
            if g['porta'] == 'convite':
                cv = self.con.execute("SELECT em FROM guilda_convites WHERE guilda_id = ? AND conta_id = ?",
                                      (gid, cid)).fetchone()
                if cv is None or cv['em'] < t - CONVITE_VALIDADE:
                    raise Recusa(403, 'a guilda é por convite — peça para entrar')
            self._g_entra(cid, gid, t)
            self._evento(cid, 'guilda', {'acao': 'entrar', 'gid': gid})
            foto = self._g_ficha(gid, cid)
        return 200, {'ok': True, 'entrou': True, 'guilda': foto}

    def guilda_pedir(self, conta, corpo):
        gid, cid, t = _id_positivo(corpo.get('gid'), 'gid'), conta['id'], agora()
        with self.tranca:
            if self._g_membro(cid)[0] is not None:
                raise Recusa(409, 'você já tem guilda')
            g = self._g_existe_para(gid, conta, t)
            if g['porta'] == 'aberta':                    # porta aberta não tem fila: pedir É entrar
                self._g_entra(cid, gid, t)
                return 200, {'ok': True, 'entrou': True, 'guilda': self._g_ficha(gid, cid)}
            if self.con.execute("SELECT 1 FROM guilda_pedidos WHERE guilda_id = ? AND conta_id = ?",
                                (gid, cid)).fetchone():
                raise Recusa(409, 'seu pedido já está na fila')
            self.con.execute("INSERT INTO guilda_pedidos(guilda_id, conta_id, em) VALUES (?, ?, ?)", (gid, cid, t))
            self.con.commit()
        return 200, {'ok': True, 'entrou': False, 'pedidoFeito': True}

    def guilda_pedido(self, conta, corpo):
        alvo, cid, t = _id_positivo(corpo.get('conta'), 'conta'), conta['id'], agora()
        aceitar = corpo.get('aceitar') is True
        with self.tranca:
            g, cargo = self._g_da_conta(conta)
            if cargo not in ('lider', 'oficial'):
                raise Recusa(403, 'só líder e oficiais ' + ('aceitam' if aceitar else 'recusam') + ' pedidos')
            if not self.con.execute("SELECT 1 FROM guilda_pedidos WHERE guilda_id = ? AND conta_id = ?",
                                    (g['id'], alvo)).fetchone():
                raise Recusa(404, 'pedido não está mais na fila')
            self.con.execute("DELETE FROM guilda_pedidos WHERE guilda_id = ? AND conta_id = ?", (g['id'], alvo))
            if aceitar:
                if self._g_membro(alvo)[0] is not None:
                    self.con.commit()                    # o pedido sai da fila de qualquer jeito
                    raise Recusa(409, 'essa conta já entrou noutra guilda')
                self._g_entra(alvo, g['id'], t)
            foto = self._g_ficha(g['id'], cid)
            membro = {'id': alvo, 'nome': self._g_nomes([alvo]).get(alvo, '?')} if aceitar else None
        return 200, {'ok': True, 'membro': membro, 'guilda': foto}

    def guilda_convidar(self, conta, corpo):
        alvo, cid, t = _id_positivo(corpo.get('conta'), 'conta'), conta['id'], agora()
        if alvo == cid:
            raise Recusa(400, 'você já está na sua guilda')
        with self.tranca:
            g, cargo = self._g_da_conta(conta)
            if cargo not in ('lider', 'oficial'):
                raise Recusa(403, 'só líder e oficiais convidam')
            outro = self.con.execute("SELECT id, banido FROM contas WHERE id = ?", (alvo,)).fetchone()
            if outro is None or outro['banido']:
                raise Recusa(404, 'conta não encontrada')
            if self._g_membro(alvo)[0] is not None:
                raise Recusa(409, 'essa pessoa já tem guilda')
            self.con.execute("DELETE FROM guilda_convites WHERE em < ?", (t - CONVITE_VALIDADE,))
            self.con.execute("INSERT OR REPLACE INTO guilda_convites(guilda_id, conta_id, por_id, em) VALUES (?, ?, ?, ?)",
                             (g['id'], alvo, cid, t))
            sobra = self.con.execute("SELECT conta_id FROM guilda_convites WHERE guilda_id = ? "
                                     "ORDER BY em DESC, conta_id LIMIT -1 OFFSET ?", (g['id'], CONVITES_MAX)).fetchall()
            self.con.executemany("DELETE FROM guilda_convites WHERE guilda_id = ? AND conta_id = ?",
                                 [(g['id'], r['conta_id']) for r in sobra])
            self.con.commit()
        return 200, {'ok': True, 'gid': g['id'], 'nome': g['nome'], 'emblema': g['emblema']}

    def guilda_porta(self, conta, corpo):
        modo = corpo.get('modo')
        if modo not in ('aberta', 'convite'):
            raise Recusa(400, 'modo desconhecido')
        with self.tranca:
            g, cargo = self._g_da_conta(conta)
            if cargo != 'lider':
                raise Recusa(403, 'só o líder mexe na porta')
            self.con.execute("UPDATE guildas SET porta = ? WHERE id = ?", (modo, g['id']))
            foto = self._g_ficha(g['id'], conta['id'])
        return 200, {'ok': True, 'porta': modo, 'guilda': foto}

    def guilda_cargo(self, conta, corpo):
        alvo, cid = _id_positivo(corpo.get('conta'), 'conta'), conta['id']
        novo = corpo.get('cargo')
        if novo not in ('oficial', 'membro'):
            raise Recusa(400, "o cargo é 'oficial' ou 'membro'")
        with self.tranca:
            g, cargo = self._g_da_conta(conta)
            if cargo != 'lider':
                raise Recusa(403, 'só o líder promove' if novo == 'oficial' else 'só o líder rebaixa')
            if alvo == cid:
                raise Recusa(400, 'você já lidera')
            m = self.con.execute("SELECT cargo FROM guilda_membros WHERE conta_id = ? AND guilda_id = ?",
                                 (alvo, g['id'])).fetchone()
            if m is None:
                raise Recusa(404, 'não é membro')
            if m['cargo'] == novo:
                raise Recusa(409, 'já é oficial' if novo == 'oficial' else 'já é membro raso')
            self.con.execute("UPDATE guilda_membros SET cargo = ? WHERE conta_id = ?", (novo, alvo))
            foto = self._g_ficha(g['id'], cid)
        return 200, {'ok': True, 'cargo': novo, 'guilda': foto}

    def guilda_dizimo(self, conta, corpo):
        """Sem `conta`: o dízimo PADRÃO (quem não tem um próprio); com `todos: true`, o padrão
        passa a valer para todo mundo (os próprios somem). Com `conta`: o dízimo daquele
        membro (13/09, "o líder define quantos % cada um vai doar"); `pct: null` o devolve
        ao padrão."""
        pct, alvo, todos = corpo.get('pct'), corpo.get('conta'), corpo.get('todos') is True
        if alvo is not None:
            alvo = _id_positivo(alvo, 'conta')
        if not (alvo is not None and pct is None):
            if isinstance(pct, bool) or not isinstance(pct, int) or pct < 0 or pct > DIZIMO_MAX:
                raise Recusa(400, 'o dízimo vai de 0 a %d%%' % DIZIMO_MAX)
        with self.tranca:
            g, cargo = self._g_da_conta(conta)
            # 08/10 à noite (o dono: "o chefe e o vice-líder podem mexer nos XP doados"): o dízimo de UM membro é do
            # líder e dos oficiais; o padrão (e o "aplicar a todos") segue do líder
            if alvo is None and cargo != 'lider':
                raise Recusa(403, 'só o líder define o dízimo')
            if alvo is not None and cargo not in ('lider', 'oficial'):
                raise Recusa(403, 'só o líder e os oficiais mudam o dízimo de um membro')
            if alvo is None:
                self.con.execute("UPDATE guildas SET dizimo = ? WHERE id = ?", (pct, g['id']))
                if todos:
                    self.con.execute("DELETE FROM guilda_dizimo_membro WHERE guilda_id = ?", (g['id'],))
            else:
                if not self.con.execute("SELECT 1 FROM guilda_membros WHERE conta_id = ? AND guilda_id = ?",
                                        (alvo, g['id'])).fetchone():
                    raise Recusa(404, 'não é membro')
                if pct is None:
                    self.con.execute("DELETE FROM guilda_dizimo_membro WHERE conta_id = ?", (alvo,))
                else:
                    self.con.execute("INSERT OR REPLACE INTO guilda_dizimo_membro(conta_id, guilda_id, pct) "
                                     "VALUES (?, ?, ?)", (alvo, g['id'], pct))
            foto = self._g_ficha(g['id'], conta['id'])
        return 200, {'ok': True, 'dizimo': pct, 'conta': alvo, 'guilda': foto}

    def guilda_mural(self, conta, corpo):
        """A mensagem da guilda (13/09): boas-vindas e orientações que todo membro lê na
        ficha. Líder e oficiais escrevem; texto vazio apaga."""
        texto = corpo.get('texto')
        if not isinstance(texto, str):
            raise Recusa(400, 'texto precisa ser uma string')
        texto = RE_CONTROLE.sub('', texto.replace('\r\n', '\n').replace('\r', '\n')).strip()[:MURAL_MAX].strip()
        cid = conta['id']
        with self.tranca:
            g, cargo = self._g_da_conta(conta)
            if cargo not in ('lider', 'oficial'):
                raise Recusa(403, 'só líder e oficiais escrevem a mensagem da guilda')
            if texto:
                self.con.execute("INSERT OR REPLACE INTO guilda_mural(guilda_id, texto, autor_id, em) VALUES (?, ?, ?, ?)",
                                 (g['id'], texto, cid, agora()))
            else:
                self.con.execute("DELETE FROM guilda_mural WHERE guilda_id = ?", (g['id'],))
            self._evento(cid, 'guilda', {'acao': 'mural', 'gid': g['id'], 'tamanho': len(texto)})
            foto = self._g_ficha(g['id'], cid)
        return 200, {'ok': True, 'guilda': foto}

    # -- o XP, o cofre e o treino ------------------------------------------------------
    def _g_autoridade(self):
        return getattr(self, '_autoridade_ligada', lambda: False)()

    def guilda_doar(self, conta, corpo):
        # 13/09: com a autoridade ligada o XP do dízimo chega pelo POST /api/sala/fechar
        # (salas.py: o juiz anota o que o jogo doa e o servidor credita); a oferenda
        # do cliente seria XP inventado
        if self._g_autoridade():
            raise Recusa(403, 'o dízimo é creditado pelo servidor ao fechar a sala')
        # 04/10: a oferenda em vinténs acabou (dono: "dinheiro não dará mais XP para guild"). Sem a
        # autoridade esta rota fica só para o dízimo, que o jogo manda com a origem dita; o pedido sem
        # ela é o da oferenda de antes (ou de um jogo velho na memória do navegador) e é recusado
        if corpo.get('origem') != 'dizimo':
            raise Recusa(403, SEM_OFERENDA)
        xp = corpo.get('xp')
        if isinstance(xp, bool) or not isinstance(xp, int) or xp < 1 or xp > DOAR_MAX:
            raise Recusa(400, 'quantia inválida')
        with self.tranca:
            g, _ = self._g_da_conta(conta)
            self.con.execute("UPDATE guildas SET xp = xp + ? WHERE id = ?", (xp, g['id']))
            soma_contrib(self.con, conta['id'], xp)
            self.con.commit()
        return 200, {'ok': True, 'xp': g['xp'] + xp, 'nivel': nivel_de(g['xp'] + xp)}

    def guilda_bonus(self, conta, corpo):
        tipo = corpo.get('tipo')
        if tipo not in ('drop', 'xp'):
            raise Recusa(400, 'bônus desconhecido')
        col = 'bonus_' + tipo                             # só 'bonus_drop' ou 'bonus_xp' (a lista acima)
        t = agora()
        with self.tranca:
            g, cargo = self._g_da_conta(conta)
            if cargo not in ('lider', 'oficial'):
                raise Recusa(403, 'só líder e oficiais gastam o cofre')
            if g['moedas'] < CUSTO_BONUS:
                raise Recusa(409, 'cofre insuficiente')
            ate = max(t, g[col]) + BONUS_S               # comprar de novo ESTENDE
            self.con.execute("UPDATE guildas SET moedas = moedas - ?, %s = ? WHERE id = ?" % col,
                             (CUSTO_BONUS, ate, g['id']))
            foto = self._g_ficha(g['id'], conta['id'])
        return 200, {'ok': True, 'ate': ate * 1000, 'moedas': g['moedas'] - CUSTO_BONUS, 'guilda': foto}

    def guilda_treino(self, conta, corpo):
        cid, t = conta['id'], agora()
        vistos = self.__dict__.setdefault('_g_treinos', {})   # conta → o último treino que pagou (em memória)
        with self.tranca:
            g, _ = self._g_da_conta(conta)
            if t - vistos.get(cid, 0) < TREINO_INTERVALO:
                return 200, {'ok': True, 'pago': False, 'xp': g['xp'], 'moedas': g['moedas']}
            vistos[cid] = t
            self.con.execute("UPDATE guildas SET xp = xp + ?, moedas = moedas + ?, treinos = treinos + 1 WHERE id = ?",
                             (XP_TREINO, MOEDA_TREINO, g['id']))
            soma_contrib(self.con, cid, XP_TREINO)
            self.con.commit()
        return 200, {'ok': True, 'pago': True, 'xp': g['xp'] + XP_TREINO, 'moedas': g['moedas'] + MOEDA_TREINO}

    def guilda_sair(self, conta, corpo):
        cid = conta['id']
        with self.tranca:
            g, _ = self._g_da_conta(conta)
            if self.con.execute("SELECT 1 FROM guilda_banco WHERE guilda_id = ? AND emprestado_para = ?",
                                (g['id'], cid)).fetchone():
                raise Recusa(409, 'devolva o item emprestado antes de sair')
            if self.con.execute("SELECT 1 FROM guilda_banco WHERE guilda_id = ? AND dono_id = ?",
                                (g['id'], cid)).fetchone():
                raise Recusa(409, 'retire as suas peças do banco da guilda antes de sair')
            self.con.execute("DELETE FROM guilda_membros WHERE conta_id = ?", (cid,))
            self.con.execute("DELETE FROM guilda_dizimo_membro WHERE conta_id = ?", (cid,))   # o dízimo próprio fica aqui
            resto = self.con.execute("SELECT conta_id FROM guilda_membros WHERE guilda_id = ? "
                                     "ORDER BY entrou_em, conta_id", (g['id'],)).fetchall()
            if not resto:
                for tabela in ('guilda_contrib', 'guilda_dizimo_membro', 'guilda_mural'):
                    self.con.execute("DELETE FROM %s WHERE guilda_id = ?" % tabela, (g['id'],))
                self.con.execute("DELETE FROM guildas WHERE id = ?", (g['id'],))     # o último apaga a luz
            elif g['lider_id'] == cid:
                self.con.execute("UPDATE guildas SET lider_id = ? WHERE id = ?", (resto[0]['conta_id'], g['id']))
            self._evento(cid, 'guilda', {'acao': 'sair', 'gid': g['id'], 'dissolveu': not resto})
            self.con.commit()
        return 200, {'ok': True, 'dissolveu': not resto}

    # -- a guilda desfeita pela Equipe (04/10) ---------------------------------------------
    def _g_devolucoes(self, cid):
        """Dentro da tranca: as peças que esperam voltar a esta conta (o jogo sem o juiz as põe no saco)."""
        return [{'id': r['id'], 'itemId': r['item_id'], 'level': r['nivel'], 'stars': r['estrelas'],
                 'iid': r['iid'], 'guilda': r['guilda']}
                for r in self.con.execute("SELECT * FROM guilda_devolucoes WHERE conta_id = ? AND entregue_em IS NULL "
                                          "ORDER BY id LIMIT ?", (cid, DEVOLUCOES_MAX))]

    def guilda_devolucoes_visto(self, conta, corpo):
        """Sem o juiz: o jogo pôs no saco as devoluções até `ate` e confirma. A linha fica mais
        DEVOLUCAO_GRACA segurando a varredura (um PUT que já estava a caminho, sem a peça, a
        marcaria 'fora' e ela não voltaria nunca mais) e sai na faxina da confirmação seguinte."""
        ate, t = _id_positivo(corpo.get('ate'), 'ate'), agora()
        with self._escrita():
            self.con.execute("DELETE FROM guilda_devolucoes WHERE conta_id = ? AND entregue_em IS NOT NULL "
                             "AND entregue_em < ?", (conta['id'], t - DEVOLUCAO_GRACA))
            n = self.con.execute("UPDATE guilda_devolucoes SET entregue_em = ? WHERE conta_id = ? AND id <= ? "
                                 "AND entregue_em IS NULL", (t, conta['id'], ate)).rowcount
        return 200, {'ok': True, 'marcadas': n}

    def _g_entrega_devolucoes(self, cid):
        """FORA da tranca, e só com a autoridade: o juiz põe no estado do dono cada peça que
        espera por ele (op interna 'bancoGuildaVolta': no saco, ou no cofre do Acampamento se o
        saco está cheio) e a linha sai na MESMA transação que grava o estado — nem some nem
        duplica. Nunca derruba quem chamou: o que falhar (o juiz fora, a conta ainda sem estado)
        continua esperando, com a série protegida. Devolve quantas entraram."""
        if not self._g_autoridade():
            return 0
        entraram = 0
        try:
            with self.tranca:
                ids = [r[0] for r in self.con.execute(
                    "SELECT id FROM guilda_devolucoes WHERE conta_id = ? AND entregue_em IS NULL ORDER BY id LIMIT ?",
                    (cid, BANCO_MAX))]
            for did in ids:
                for _ in range(3):
                    t = agora()
                    with self.tranca:
                        d = self.con.execute("SELECT * FROM guilda_devolucoes WHERE id = ? AND entregue_em IS NULL",
                                             (did,)).fetchone()
                        dono = self.con.execute("SELECT * FROM contas WHERE id = ?", (cid,)).fetchone()
                        estado = self._estado_ler(cid) if d is not None and dono is not None else None
                    if estado is None:
                        break
                    dono = dict(dono)
                    args = {'item': {'itemId': d['item_id'], 'level': d['nivel'], 'stars': d['estrelas']}}
                    if d['iid']:
                        args['iid'] = d['iid']
                    saida = self._juiz_op(dono, estado, [{'nome': 'bancoGuildaVolta', 'args': args}], interno=True)
                    res = (saida.get('resultados') or [None])[0]
                    serie = res.get('iid') if isinstance(res, dict) else None
                    onde = res.get('onde') if isinstance(res, dict) else None
                    if not iid_valido(serie) or ('iid' in args and serie != args['iid']) or onde not in ('saco', 'cofre'):
                        raise Recusa(503, 'o juiz respondeu torto — a peça segue esperando')
                    try:
                        with self._escrita():
                            if self.con.execute("SELECT 1 FROM guilda_devolucoes WHERE id = ? AND entregue_em IS NULL",
                                                (did,)).fetchone() is None:
                                break                                   # outro pedido já a entregou
                            nova, _ = self._estado_grava(dono, estado, saida, t,
                                                         poupar=[args['iid']] if 'iid' in args else [])
                            self.con.execute("DELETE FROM guilda_devolucoes WHERE id = ?", (did,))
                            # o recado para a volta do dono: o jogo mostra e adota o estado daqui
                            self.con.execute("INSERT INTO guilda_avisos(conta_id, item_id, nivel, estrelas, iid, motivo, em) "
                                             "VALUES (?, ?, ?, ?, ?, ?, ?)",
                                             (cid, d['item_id'], d['nivel'], d['estrelas'], serie, 'devolvida-' + onde, t))
                            self._evento(cid, 'guilda', {'acao': 'devolvida', 'guilda': d['guilda'], 'iid': serie,
                                                         'onde': onde, 'versao': nova})
                        entraram += 1
                        break
                    except EstadoMudou:
                        continue
        except Recusa as e:
            log.warning("guilda desfeita: a devolução a #%d fica esperando (%s)", cid, e)
        except Exception:
            log.exception("guilda desfeita: a devolução a #%d falhou e fica esperando", cid)
        return entraram

    def _g_desfaz_grava(self, gid, por, origem, t):
        """Dentro de _escrita: a guilda `gid` sai inteira. EstadoMudou se alguém pegou uma peça
        emprestada depois do recolhimento (quem chama recolhe de novo); None se ela já não existe."""
        g = self.con.execute("SELECT * FROM guildas WHERE id = ?", (gid,)).fetchone()
        if g is None:
            return None
        if self.con.execute("SELECT 1 FROM guilda_banco WHERE guilda_id = ? AND emprestado_para IS NOT NULL",
                            (gid,)).fetchone():
            raise EstadoMudou()
        membros = [r[0] for r in self.con.execute("SELECT conta_id FROM guilda_membros WHERE guilda_id = ? "
                                                  "ORDER BY entrou_em, conta_id", (gid,))]
        pecas = self.con.execute("SELECT * FROM guilda_banco WHERE guilda_id = ? ORDER BY id", (gid,)).fetchall()
        for b in pecas:
            # a peça muda de gaveta ANTES de a guilda sair: a série nunca fica um instante sem proteção
            self.con.execute("INSERT INTO guilda_devolucoes(conta_id, item_id, nivel, estrelas, iid, guilda, em) "
                             "VALUES (?, ?, ?, ?, ?, ?, ?)",
                             (b['dono_id'], b['item_id'], b['nivel'], b['estrelas'], b['iid'], g['nome'], t))
        donos = sorted({b['dono_id'] for b in pecas})
        # a guerra: a inscrição em aberto sai; a partida que ainda não começou cai e o OUTRO lado
        # volta à fila com o lugar dele. A que já está lutando segue até o fim (o XP da guilda que
        # não existe mais não vai a lugar nenhum) e o histórico das guerras fechadas fica: é também
        # do adversário
        try:
            self.con.execute("DELETE FROM guerra_inscricoes WHERE guilda_id = ?", (gid,))
            for p in self.con.execute("SELECT * FROM guerra_partidas WHERE (a_guilda = ? OR b_guilda = ?) "
                                      "AND (estado = 'casada' OR (estado = 'pronta' AND ata IS NULL))",
                                      (gid, gid)).fetchall():
                volta = [lado for lado, dela in (('A', p['a_guilda']), ('B', p['b_guilda'])) if dela != gid]
                if p['estado'] == 'casada':
                    self._guerra_cai(p, t * 1000, volta, 'guilda-desfeita')
                else:
                    self._guerra_pronta_cai(p, t * 1000, 'guilda-desfeita', volta)
        except (sqlite3.OperationalError, AttributeError):       # um banco sem a guerra: nada a limpar
            pass
        # tudo o que aponta para a guilda, lido do próprio banco: uma tabela nova da guilda entra
        # sozinha nesta faxina (as de CASCADE sairiam com ela; as outras deixariam linha órfã)
        for tabela in [r[0] for r in self.con.execute("SELECT name FROM sqlite_master WHERE type = 'table' "
                                                      "AND name NOT LIKE 'sqlite_%'").fetchall()]:
            for fk in self.con.execute('PRAGMA foreign_key_list("%s")' % tabela).fetchall():
                if fk[2] == 'guildas':
                    self.con.execute('DELETE FROM "%s" WHERE "%s" = ?' % (tabela, fk[3]), (gid,))
        self.con.execute("DELETE FROM guildas WHERE id = ?", (gid,))
        # a foto das guildas de antes do servidor com este nome: sem isto quem ainda não a "trouxe"
        # a fundaria de novo de graça, por cima de quem for refazê-la
        self.con.execute("DELETE FROM guildas_antigas WHERE nome = ?", (g['nome'],))
        texto = FRASE_DESFEITA % g['nome']
        for cid in membros:
            extra = (' As suas peças que estavam no banco dela voltam para você: para o saco ou, com o saco cheio, '
                     'para o cofre do Acampamento.') if cid in donos else ''
            try:
                self.con.execute("INSERT INTO moderacao_cartas(conta_id, assunto, texto, criado_em) VALUES (?, ?, ?, ?)",
                                 (cid, 'A sua guilda foi desfeita', texto + extra, t))
            except sqlite3.OperationalError:                      # um banco de antes do correio da Equipe
                pass
            self._evento(cid, 'guilda', {'acao': 'desfeita', 'gid': gid, 'nome': g['nome'], 'origem': origem})
        resumo = {'id': gid, 'nome': g['nome'], 'membros': len(membros), 'pecas': len(pecas), 'donos': donos}
        dados = {'guilda': gid, 'nome': g['nome'], 'lider': g['lider_id'], 'membros': membros, 'pecas': len(pecas),
                 'xp': g['xp'], 'origem': origem}
        try:
            if isinstance(por, dict):
                self._audita(por, 'guilda-desfazer', g['lider_id'], dados, t=t)
            else:                                                 # o Terminal: sem conta de Mestre por trás
                self.con.execute("INSERT INTO moderacao_auditoria(mestre_id, mestre_nome, acao, alvo_id, dados, criado_em) "
                                 "VALUES (NULL, ?, 'guilda-desfazer', ?, ?, ?)",
                                 ('Terminal (admin desfazer-guilda)', g['lider_id'],
                                  json.dumps(dados, ensure_ascii=False, sort_keys=True), t))
        except (sqlite3.OperationalError, AttributeError):
            log.warning("guilda desfeita: sem a tabela da auditoria neste banco")
        return resumo

    def _g_desfaz(self, gid, por=None, origem='painel'):
        """FORA da tranca: desfaz a guilda `gid` (ver o topo). (1) recolhe de quem pegou cada
        empréstimo, pelo mesmo caminho da ausência; o juiz fora do ar levanta Recusa (503) ANTES
        de qualquer coisa ser destruída. (2) uma transação só: as peças viram devoluções aos
        donos e a guilda sai com tudo o que pende dela. (3) o juiz entrega as devoluções.
        Devolve o resumo, ou None se a guilda já não existe (repetir não quebra)."""
        resumo, recolhidos = None, 0
        for _ in range(5):
            with self.tranca:
                if self.con.execute("SELECT 1 FROM guildas WHERE id = ?", (gid,)).fetchone() is None:
                    return None
                emprestadas = [r[0] for r in self.con.execute(
                    "SELECT id FROM guilda_banco WHERE guilda_id = ? AND emprestado_para IS NOT NULL ORDER BY id", (gid,))]
            for bid in emprestadas:
                for _ in range(3):
                    p = self._g_recolhe_prepara(bid)
                    if p is None:
                        break
                    try:
                        with self._escrita():
                            recolhidos += 1 if self._g_recolhe_aplica(p, 'guilda-desfeita', agora()) else 0
                        break
                    except EstadoMudou:
                        continue
            try:
                with self._escrita():
                    resumo = self._g_desfaz_grava(gid, por, origem, agora())
                break
            except EstadoMudou:
                continue
        else:
            raise Recusa(409, 'o banco da guilda não parou de mudar — tente de novo')
        if resumo is None:
            return None
        resumo['recolhidos'] = recolhidos
        resumo['entregues'] = sum(self._g_entrega_devolucoes(cid) for cid in resumo.pop('donos'))
        log.info("guilda desfeita: #%d (%d membro(s), %d peça(s) devolvida(s), %d empréstimo(s) recolhido(s)) por %s",
                 gid, resumo['membros'], resumo['pecas'], recolhidos,
                 ('#%d' % por['id']) if isinstance(por, dict) else origem)
        return resumo

    # GET /api/mestre/guildas — TODAS, até a da equipe: o painel do Mestre é onde se vê quem está em qual
    def mestre_guildas(self, conta, corpo):
        with self.tranca:
            gs = self.con.execute(
                "SELECT g.*, (SELECT gm FROM contas l WHERE l.id = g.lider_id) AS lider_gm, "
                "(SELECT COUNT(*) FROM guilda_banco b WHERE b.guilda_id = g.id) AS pecas, "
                "(SELECT COUNT(*) FROM guilda_banco b WHERE b.guilda_id = g.id AND b.emprestado_para IS NOT NULL) AS emprestadas "
                "FROM guildas g ORDER BY g.xp DESC, g.id LIMIT ?", (MESTRE_GUILDAS_MAX,)).fetchall()
            ms = self.con.execute("SELECT guilda_id, conta_id, cargo FROM guilda_membros ORDER BY entrou_em, conta_id").fetchall()
            nm = self._g_nomes([m['conta_id'] for m in ms] + [g['lider_id'] for g in gs])
        por_guilda = {}
        for m in ms:
            por_guilda.setdefault(m['guilda_id'], []).append(m)
        fora = []
        for g in gs:
            dela = por_guilda.get(g['id'], [])
            fora.append({
                'id': g['id'], 'nome': g['nome'], 'emblema': g['emblema'], 'xp': g['xp'], 'nivel': nivel_de(g['xp']),
                'porta': g['porta'], 'criadaEm': g['criada_em'] * 1000, 'daEquipe': bool(g['lider_gm']),
                'lider': {'id': g['lider_id'], 'nome': nm.get(g['lider_id'], '?')},
                'totalMembros': len(dela), 'pecas': g['pecas'], 'emprestadas': g['emprestadas'],
                'membros': [{'id': m['conta_id'], 'nome': nm.get(m['conta_id'], '?'),
                             'cargo': 'lider' if m['conta_id'] == g['lider_id'] else m['cargo']}
                            for m in dela[:MESTRE_MEMBROS_MAX]]})
        return 200, {'ok': True, 'guildas': fora}

    # POST /api/mestre/guilda/desfazer {gid, nome} — `nome` é a confirmação digitada no painel
    def mestre_guilda_desfazer(self, conta, corpo):
        gid = _id_positivo(corpo.get('gid'), 'gid')
        nome = corpo.get('nome')
        if not isinstance(nome, str) or not nome.strip():
            raise Recusa(400, 'digite o nome da guilda para confirmar')
        with self.tranca:
            g = self.con.execute("SELECT nome FROM guildas WHERE id = ?", (gid,)).fetchone()
        if g is None:                                            # o segundo clique, ou outro Mestre chegou antes
            return 200, {'ok': True, 'jaDesfeita': True}
        if nome.strip() != g['nome']:
            raise Recusa(400, 'o nome digitado não confere com o da guilda', motivo='nome-nao-confere')
        freio = getattr(self, '_mestre_freio', None)
        if freio is not None:
            freio(conta, 'guilda-desfazer', DESFAZER_POR_HORA, 'guildas demais desfeitas nesta hora; espere um pouco')
        resumo = self._g_desfaz(gid, por=conta, origem='painel')
        if resumo is None:
            return 200, {'ok': True, 'jaDesfeita': True}
        return 200, {'ok': True, 'desfeita': resumo}

    # -- o banco de empréstimos ----------------------------------------------------------
    def guilda_banco_depositar(self, conta, corpo):
        it = corpo.get('item')
        if not isinstance(it, dict):
            raise Recusa(400, 'item precisa ser um objeto')
        item_id = it.get('itemId')
        if not isinstance(item_id, str) or not RE_ITEM.match(item_id):
            raise Recusa(400, 'itemId inválido')
        nivel, estrelas = limita(it.get('level'), 0, 99), limita(it.get('stars'), 0, 9)
        iid = it.get('iid')
        if iid is not None and (not isinstance(iid, str) or not RE_IID.match(iid)):
            raise Recusa(400, 'iid inválido')
        if self._g_autoridade():
            # peça sem série não sai do estado do servidor por série nenhuma: guardá-la
            # seria criar cópia. Com a autoridade, só peça com série vai ao banco
            if not iid:
                raise Recusa(400, 'só peça com número de série vai ao banco da guilda')
            return self._g_depositar_no_servidor(conta, iid)
        cid, t = conta['id'], agora()
        with self.tranca:
            g, _ = self._g_da_conta(conta)
            n = self.con.execute("SELECT COUNT(*) FROM guilda_banco WHERE guilda_id = ?", (g['id'],)).fetchone()[0]
            if n >= BANCO_MAX:
                raise Recusa(409, 'o banco da guilda está cheio')
            if iid:
                r = self.con.execute("SELECT conta_id, estado FROM itens WHERE iid = ?", (iid,)).fetchone()
                if r is None:
                    raise Recusa(409, 'essa peça ainda não chegou ao servidor — espere o jogo salvar e tente de novo')
                if r['conta_id'] != cid or r['estado'] != 'vivo':
                    raise Recusa(409, 'você não tem a instância %s' % iid)
                if self.con.execute("SELECT 1 FROM guilda_banco WHERE iid = ?", (iid,)).fetchone():
                    raise Recusa(409, 'essa peça já está no banco da guilda')
            self.con.execute("INSERT INTO guilda_banco(guilda_id, item_id, nivel, estrelas, iid, dono_id, em) "
                             "VALUES (?, ?, ?, ?, ?, ?, ?)", (g['id'], item_id, nivel, estrelas, iid, cid, t))
            foto = self._g_ficha(g['id'], cid)
        return 200, {'ok': True, 'total': n + 1, 'guilda': foto}

    # -- o banco com a autoridade ligada (13/09): a peça sai e entra no estado do servidor ---------
    def _g_pode_depositar(self, g, cid, iid):
        n = self.con.execute("SELECT COUNT(*) FROM guilda_banco WHERE guilda_id = ?", (g['id'],)).fetchone()[0]
        if n >= BANCO_MAX:
            raise Recusa(409, 'o banco da guilda está cheio')
        r = self.con.execute("SELECT conta_id, estado FROM itens WHERE iid = ?", (iid,)).fetchone()
        if r is None:
            raise Recusa(409, 'essa peça ainda não chegou ao servidor — espere o jogo salvar e tente de novo')
        if r['conta_id'] != cid or r['estado'] != 'vivo':
            raise Recusa(409, 'você não tem a instância %s' % iid)
        if self.con.execute("SELECT 1 FROM guilda_banco WHERE iid = ?", (iid,)).fetchone():
            raise Recusa(409, 'essa peça já está no banco da guilda')
        if self.con.execute("SELECT 1 FROM guilda_emprestimos WHERE iid = ?", (iid,)).fetchone():
            raise Recusa(409, 'peça emprestada não vai ao banco: devolva')
        return n

    def _g_resposta_estado(self, resposta, nova, saida, db):
        resposta.update(versao=nova, hash=saida['hash'], progress=saida['progress'], db=db)
        return 200, resposta

    def _g_depositar_no_servidor(self, conta, iid):
        """O juiz tira a peça do saco do estado do servidor (op interna 'bancoGuildaTira')
        e ela entra no banco na MESMA transação que grava o estado; o nível e as
        estrelas guardados são os do estado, não os que o cliente mandou."""
        cid = conta['id']
        for _ in range(3):
            t = agora()
            with self.tranca:
                g, _ = self._g_da_conta(conta)
                self._g_pode_depositar(g, cid, iid)
                estado = self._estado_exige(cid)
            saida = self._juiz_op(conta, estado, [{'nome': 'bancoGuildaTira', 'args': {'iid': iid}}], interno=True)
            res = (saida.get('resultados') or [None])[0]
            item = res.get('item') if isinstance(res, dict) else None
            if (not isinstance(item, dict) or item.get('iid') != iid or not isinstance(item.get('itemId'), str)
                    or not RE_ITEM.match(item['itemId'])):
                raise Recusa(503, 'o juiz respondeu torto — nada foi guardado')
            try:
                with self._escrita():
                    g2, _ = self._g_da_conta(conta)
                    if g2['id'] != g['id']:
                        raise Recusa(409, 'a sua guilda mudou no meio')
                    n = self._g_pode_depositar(g2, cid, iid)
                    nova, db = self._estado_grava(conta, estado, saida, t, poupar=[iid])   # a série segue viva, guardada
                    self.con.execute("INSERT INTO guilda_banco(guilda_id, item_id, nivel, estrelas, iid, dono_id, em) "
                                     "VALUES (?, ?, ?, ?, ?, ?, ?)",
                                     (g['id'], item['itemId'], limita(item.get('level'), 0, 99),
                                      limita(item.get('stars'), 0, 9), iid, cid, t))
                    self._evento(cid, 'guilda', {'acao': 'depositar', 'gid': g['id'], 'iid': iid, 'versao': nova})
            except EstadoMudou:
                continue
            with self.tranca:
                foto = self._g_foto(g['id'], cid)
            return self._g_resposta_estado({'ok': True, 'total': n + 1, 'guilda': foto}, nova, saida, db)
        raise Recusa(409, 'o estado da conta mudou no meio — tente de novo')

    def _g_pode_pegar(self, g, b, cid):
        if b['emprestado_para'] is not None:
            raise Recusa(409, 'já está emprestada')
        if b['dono_id'] != cid and self.con.execute(
                "SELECT 1 FROM guilda_banco WHERE guilda_id = ? AND emprestado_para = ?", (g['id'], cid)).fetchone():
            raise Recusa(409, 'devolva o empréstimo atual primeiro')

    def _g_pegar_no_servidor(self, conta, corpo):
        """O juiz põe a peça no saco do estado de quem pega ('bancoGuildaPoe'): o dono
        recebe a MESMA série; quem pega emprestado, uma cópia com série nova cunhada no
        servidor (origem 'banco'), anotada em guilda_emprestimos para a devolução."""
        cid = conta['id']
        for _ in range(3):
            t = agora()
            with self.tranca:
                g, _ = self._g_da_conta(conta)
                b = self._g_vaga(g, corpo)
                self._g_pode_pegar(g, b, cid)
                estado = self._estado_exige(cid)
            proprio = b['dono_id'] == cid
            args = {'item': {'itemId': b['item_id'], 'level': b['nivel'], 'stars': b['estrelas']}, 'origem': 'banco'}
            if proprio and b['iid']:
                args['iid'] = b['iid']
            saida = self._juiz_op(conta, estado, [{'nome': 'bancoGuildaPoe', 'args': args}], interno=True)
            res = (saida.get('resultados') or [None])[0]
            serie = res.get('iid') if isinstance(res, dict) else None
            if not iid_valido(serie) or ('iid' in args and serie != args['iid']):
                raise Recusa(503, 'o juiz respondeu torto — nada saiu do banco')
            try:
                with self._escrita():
                    g2, _ = self._g_da_conta(conta)
                    b2 = self._g_vaga(g2, corpo)
                    if dict(b2) != dict(b):
                        raise EstadoMudou()
                    self._g_pode_pegar(g2, b2, cid)
                    nova, db = self._estado_grava(conta, estado, saida, t, poupar=[args['iid']] if 'iid' in args else [])
                    if proprio:
                        self.con.execute("DELETE FROM guilda_banco WHERE id = ?", (b['id'],))
                    else:
                        self.con.execute("UPDATE guilda_banco SET emprestado_para = ? WHERE id = ?", (cid, b['id']))
                        self.con.execute("INSERT OR REPLACE INTO guilda_emprestimos(banco_id, conta_id, iid, em) "
                                         "VALUES (?, ?, ?, ?)", (b['id'], cid, serie, t))
                        self._g_visto(cid, t)       # 04/10: quem pega está aqui — o prazo da ausência parte de agora
                    self._evento(cid, 'guilda', {'acao': 'pegar' if proprio else 'emprestimo', 'gid': g['id'],
                                                 'banco': b['id'], 'iid': serie, 'versao': nova})
            except EstadoMudou:
                continue
            with self.tranca:
                foto = self._g_foto(g['id'], cid)
            item = {'itemId': b['item_id'], 'level': b['nivel'], 'stars': b['estrelas'], 'iid': serie}
            return self._g_resposta_estado({'ok': True, 'item': item, 'definitivo': proprio, 'guilda': foto},
                                           nova, saida, db)
        raise Recusa(409, 'o estado da conta mudou no meio — tente de novo')

    def _g_devolver_no_servidor(self, conta, corpo):
        """A cópia emprestada sai do saco do estado de quem pegou ('bancoGuildaTira' pela
        série anotada) e a série vira 'fora'. Empréstimo de antes da autoridade não tem
        série anotada: só solta a vaga, como antes."""
        cid = conta['id']
        for _ in range(3):
            t = agora()
            with self.tranca:
                g, _ = self._g_da_conta(conta)
                b = self._g_vaga(g, corpo)
                if b['emprestado_para'] != cid:
                    raise Recusa(409, 'não foi você que pegou')
                emp = self.con.execute("SELECT iid FROM guilda_emprestimos WHERE banco_id = ? AND conta_id = ?",
                                       (b['id'], cid)).fetchone()
                if emp is None:
                    self.con.execute("UPDATE guilda_banco SET emprestado_para = NULL WHERE id = ?", (b['id'],))
                    return 200, {'ok': True, 'guilda': self._g_ficha(g['id'], cid)}
                estado = self._estado_exige(cid)
            saida = self._juiz_op(conta, estado, [{'nome': 'bancoGuildaTira', 'args': {'iid': emp['iid']}}], interno=True)
            try:
                with self._escrita():
                    b2 = self._g_vaga(g, corpo)
                    emp2 = self.con.execute("SELECT iid FROM guilda_emprestimos WHERE banco_id = ? AND conta_id = ?",
                                            (b['id'], cid)).fetchone()
                    if b2['emprestado_para'] != cid or emp2 is None or emp2['iid'] != emp['iid']:
                        raise EstadoMudou()
                    nova, db = self._estado_grava(conta, estado, saida, t)       # a série da cópia vira 'fora'
                    self.con.execute("UPDATE guilda_banco SET emprestado_para = NULL WHERE id = ?", (b['id'],))
                    self.con.execute("DELETE FROM guilda_emprestimos WHERE banco_id = ?", (b['id'],))
                    self._evento(cid, 'guilda', {'acao': 'devolver', 'gid': g['id'], 'banco': b['id'],
                                                 'iid': emp['iid'], 'versao': nova})
            except EstadoMudou:
                continue
            with self.tranca:
                foto = self._g_foto(g['id'], cid)
            return self._g_resposta_estado({'ok': True, 'guilda': foto}, nova, saida, db)
        raise Recusa(409, 'o estado da conta mudou no meio — tente de novo')

    def _g_vaga(self, g, corpo):
        bid = _id_positivo(corpo.get('id'), 'id')
        b = self.con.execute("SELECT * FROM guilda_banco WHERE id = ? AND guilda_id = ?", (bid, g['id'])).fetchone()
        if b is None:
            raise Recusa(404, 'essa peça já saiu')
        return b

    def guilda_banco_pegar(self, conta, corpo):
        if self._g_autoridade():
            return self._g_pegar_no_servidor(conta, corpo)
        cid = conta['id']
        with self.tranca:
            g, _ = self._g_da_conta(conta)
            b = self._g_vaga(g, corpo)
            if b['emprestado_para'] is not None:
                raise Recusa(409, 'já está emprestada')
            item = {'itemId': b['item_id'], 'level': b['nivel'], 'stars': b['estrelas'], 'iid': b['iid']}
            if b['dono_id'] == cid:                       # o dono retira de vez
                self.con.execute("DELETE FROM guilda_banco WHERE id = ?", (b['id'],))
                return 200, {'ok': True, 'item': item, 'definitivo': True, 'guilda': self._g_ficha(g['id'], cid)}
            if self.con.execute("SELECT 1 FROM guilda_banco WHERE guilda_id = ? AND emprestado_para = ?",
                                (g['id'], cid)).fetchone():
                raise Recusa(409, 'devolva o empréstimo atual primeiro')
            self.con.execute("UPDATE guilda_banco SET emprestado_para = ? WHERE id = ?", (cid, b['id']))
            self._g_visto(cid, agora())             # 04/10: o prazo da ausência parte de agora
            foto = self._g_ficha(g['id'], cid)
        return 200, {'ok': True, 'item': item, 'definitivo': False, 'guilda': foto}

    def guilda_banco_devolver(self, conta, corpo):
        if self._g_autoridade():
            return self._g_devolver_no_servidor(conta, corpo)
        cid = conta['id']
        with self.tranca:
            g, _ = self._g_da_conta(conta)
            b = self._g_vaga(g, corpo)
            if b['emprestado_para'] != cid:
                raise Recusa(409, 'não foi você que pegou')
            self.con.execute("UPDATE guilda_banco SET emprestado_para = NULL WHERE id = ?", (b['id'],))
            foto = self._g_ficha(g['id'], cid)
        return 200, {'ok': True, 'guilda': foto}


# ---- o Terminal do servidor (servidor/coolify/admin.sh: `admin desfazer-guilda "NOME"`) ---------
def _terminal():
    """Desfaz uma guilda pelo MESMO caminho do painel do Mestre (o juiz devolve as peças), de
    dentro do contêiner, para quando o painel não serve. Pede o nome de novo, digitado."""
    import argparse
    import sys
    ap = argparse.ArgumentParser(description="Desfaz uma guilda inteira (as peças do banco voltam aos donos)")
    ap.add_argument('--banco', required=True)
    ap.add_argument('--juiz', default=None, help="o endereço do juiz (o mesmo da API); sem ele, sem a autoridade")
    ap.add_argument('--desfazer', metavar='NOME', required=True)
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stdin.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    from api import Api
    from juiz_ponte import Juiz
    api = Api(args.banco, juiz=Juiz(args.juiz))
    g = api.con.execute("SELECT g.id, g.nome, g.xp, (SELECT nome FROM contas c WHERE c.id = g.lider_id) AS lider, "
                        "(SELECT COUNT(*) FROM guilda_membros m WHERE m.guilda_id = g.id) AS membros, "
                        "(SELECT COUNT(*) FROM guilda_banco b WHERE b.guilda_id = g.id) AS pecas "
                        "FROM guildas g WHERE g.nome = ?", (args.desfazer,)).fetchone()
    if g is None:
        print('não há guilda chamada "%s" (já foi desfeita? confira com: admin guildas)' % args.desfazer)
        return 0
    print('A guilda "%s" (nº %d): líder %s, %d membro(s), nível %d, %d peça(s) no banco.'
          % (g['nome'], g['id'], g['lider'] or '?', g['membros'], nivel_de(g['xp']), g['pecas']))
    print('Ela sai do jogo inteira: as peças do banco voltam aos donos e cada membro recebe uma carta.')
    print('Digite o nome da guilda para confirmar (ou Enter para desistir): ', end='', flush=True)
    try:
        digitado = sys.stdin.readline().strip()
    except (EOFError, KeyboardInterrupt):
        digitado = ''
    if digitado != g['nome']:
        print('\nnão confere: nada foi mexido.')
        return 1
    try:
        r = api._g_desfaz(g['id'], por=None, origem='terminal')
    except Recusa as e:
        print('não deu: %s (nada foi apagado; tente de novo)' % e)
        return 1
    if r is None:
        print('ela já não existia: nada a fazer.')
        return 0
    espera = r['pecas'] - r['entregues']
    print('"%s" foi desfeita: %d membro(s) avisado(s), %d empréstimo(s) recolhido(s), %d peça(s) devolvida(s)%s. '
          'O nome está livre.' % (r['nome'], r['membros'], r['recolhidos'], r['pecas'],
                                  (' (%d esperam o dono entrar no jogo)' % espera) if espera else ''))
    return 0


if __name__ == '__main__':
    raise SystemExit(_terminal())
