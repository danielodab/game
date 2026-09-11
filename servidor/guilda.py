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
  sair       com empréstimo ativo, não; com peça sua no banco, também não
             (retire antes); o último a sair dissolve; se o líder sai, o
             membro mais antigo herda
Os tempos vão ao cliente em milissegundos (o relógio dele); aqui, segundos.
A autoridade é a mesma do saque (o topo do api.py): o XP da oferenda e do
dízimo o cliente calcula; o teto por pedido segura erro, não trapaça.
"""
import logging
import re
import sqlite3

import nomes
from comum import Recusa, agora, limita

log = logging.getLogger('api')

NOME_MAX = 24
EMBLEMA_MAX = 64
DIZIMO_MAX = 25                   # espelha JOGO.Guilda.DIZIMO_MAX
CUSTO_BONUS = 25                  # espelha JOGO.Guilda.CUSTO_BONUS
BONUS_S = 24 * 3600               # espelha JOGO.Guilda.BONUS_MS (em segundos)
XP_TREINO = 6                     # espelha JOGO.Guilda.XP_TREINO
MOEDA_TREINO = 1                  # espelha JOGO.Guilda.MOEDA_TREINO
TREINO_INTERVALO = 20             # segundos entre dois treinos que pagam, por conta
DOAR_MAX = 50000                  # XP numa oferenda só (o dízimo de uma sala é bem menos)
CONVITES_MAX = 50                 # convites em aberto por guilda (os mais velhos saem)
CONVITE_VALIDADE = 7 * 86400
BANCO_MAX = 200                   # peças no banco de uma guilda
LISTA_MAX = 100
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
"""


def nivel_de(xp):
    """A escada da guilda (a mesma do JOGO.Guilda.nivelDe): limiar(n) = 60·n·(n+1)/2."""
    xp = xp if isinstance(xp, int) and xp > 0 else 0
    n = 1
    while xp >= 60 * n * (n + 1) // 2:
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
        q = ("SELECT c.id, COALESCE(NULLIF(r.nome, ''), c.nome) AS nome FROM contas c "
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
        nm = self._g_nomes([m['conta_id'] for m in ms] + [p['conta_id'] for p in ps] +
                           [b['dono_id'] for b in bs] + [b['emprestado_para'] for b in bs])
        membros = [{'id': m['conta_id'], 'nome': nm.get(m['conta_id'], '?'),
                    'cargo': 'lider' if m['conta_id'] == g['lider_id'] else m['cargo']} for m in ms]
        cargo = next((m['cargo'] for m in membros if m['id'] == eu), None)
        return {
            'id': g['id'], 'nome': g['nome'], 'emblema': g['emblema'], 'liderId': g['lider_id'],
            'membros': membros, 'xp': g['xp'], 'nivel': nivel_de(g['xp']), 'moedas': g['moedas'],
            'bonus': {'drop': g['bonus_drop'] * 1000, 'xp': g['bonus_xp'] * 1000},
            'banco': [{'id': b['id'], 'itemId': b['item_id'], 'level': b['nivel'], 'stars': b['estrelas'],
                       'iid': b['iid'], 'dono': b['dono_id'], 'donoNome': nm.get(b['dono_id'], '?'),
                       'emprestadoPara': b['emprestado_para'],
                       'tomadorNome': nm.get(b['emprestado_para']) if b['emprestado_para'] else None}
                      for b in bs],
            'treinos': g['treinos'], 'criadaEm': g['criada_em'] * 1000, 'porta': g['porta'],
            'dizimo': g['dizimo'],
            'pedidos': [{'id': p['conta_id'], 'nome': nm.get(p['conta_id'], '?'), 'em': p['em'] * 1000} for p in ps],
            'souLider': g['lider_id'] == eu, 'meuCargo': cargo, 'eu': eu,
        }

    def _g_existe(self, gid):
        g = self.con.execute("SELECT * FROM guildas WHERE id = ?", (gid,)).fetchone()
        if g is None:
            raise Recusa(404, 'essa guilda não existe mais')
        return g

    def _g_entra(self, cid, gid, t):
        """Põe a conta na guilda; a fila e os convites dela, em qualquer guilda, saem."""
        self.con.execute("INSERT INTO guilda_membros(conta_id, guilda_id, cargo, entrou_em) VALUES (?, ?, 'membro', ?)",
                         (cid, gid, t))
        self.con.execute("DELETE FROM guilda_pedidos WHERE conta_id = ?", (cid,))
        self.con.execute("DELETE FROM guilda_convites WHERE conta_id = ?", (cid,))

    def _g_ficha(self, gid, cid):
        self.con.commit()
        return self._g_foto(gid, cid)

    # -- ler ------------------------------------------------------------------------
    def guilda_minha(self, conta, corpo):
        with self.tranca:
            g, _ = self._g_membro(conta['id'])
            return 200, {'ok': True, 'guilda': self._g_foto(g['id'], conta['id']) if g is not None else None}

    def guilda_lista(self, conta, corpo):
        with self.tranca:
            rs = self.con.execute(
                "SELECT g.id, g.nome, g.emblema, g.xp, g.porta, COUNT(m.conta_id) AS membros FROM guildas g "
                "LEFT JOIN guilda_membros m ON m.guilda_id = g.id GROUP BY g.id ORDER BY g.xp DESC, g.id LIMIT ?",
                (LISTA_MAX,)).fetchall()
        return 200, {'ok': True, 'guildas': [
            {'id': r['id'], 'nome': r['nome'], 'emblema': r['emblema'], 'xp': r['xp'], 'nivel': nivel_de(r['xp']),
             'membros': r['membros'], 'porta': r['porta']} for r in rs]}

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
            g = self._g_existe(gid)
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
            g = self._g_existe(gid)
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
        pct = corpo.get('pct')
        if isinstance(pct, bool) or not isinstance(pct, int) or pct < 0 or pct > DIZIMO_MAX:
            raise Recusa(400, 'o dízimo vai de 0 a %d%%' % DIZIMO_MAX)
        with self.tranca:
            g, cargo = self._g_da_conta(conta)
            if cargo != 'lider':
                raise Recusa(403, 'só o líder define o dízimo')
            self.con.execute("UPDATE guildas SET dizimo = ? WHERE id = ?", (pct, g['id']))
            foto = self._g_ficha(g['id'], conta['id'])
        return 200, {'ok': True, 'dizimo': pct, 'guilda': foto}

    # -- o XP, o cofre e o treino ------------------------------------------------------
    def guilda_doar(self, conta, corpo):
        xp = corpo.get('xp')
        if isinstance(xp, bool) or not isinstance(xp, int) or xp < 1 or xp > DOAR_MAX:
            raise Recusa(400, 'quantia inválida')
        with self.tranca:
            g, _ = self._g_da_conta(conta)
            self.con.execute("UPDATE guildas SET xp = xp + ? WHERE id = ?", (xp, g['id']))
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
            resto = self.con.execute("SELECT conta_id FROM guilda_membros WHERE guilda_id = ? "
                                     "ORDER BY entrou_em, conta_id", (g['id'],)).fetchall()
            if not resto:
                self.con.execute("DELETE FROM guildas WHERE id = ?", (g['id'],))     # o último apaga a luz
            elif g['lider_id'] == cid:
                self.con.execute("UPDATE guildas SET lider_id = ? WHERE id = ?", (resto[0]['conta_id'], g['id']))
            self._evento(cid, 'guilda', {'acao': 'sair', 'gid': g['id'], 'dissolveu': not resto})
            self.con.commit()
        return 200, {'ok': True, 'dissolveu': not resto}

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

    def _g_vaga(self, g, corpo):
        bid = _id_positivo(corpo.get('id'), 'id')
        b = self.con.execute("SELECT * FROM guilda_banco WHERE id = ? AND guilda_id = ?", (bid, g['id'])).fetchone()
        if b is None:
            raise Recusa(404, 'essa peça já saiu')
        return b

    def guilda_banco_pegar(self, conta, corpo):
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
            foto = self._g_ficha(g['id'], cid)
        return 200, {'ok': True, 'item': item, 'definitivo': False, 'guilda': foto}

    def guilda_banco_devolver(self, conta, corpo):
        cid = conta['id']
        with self.tranca:
            g, _ = self._g_da_conta(conta)
            b = self._g_vaga(g, corpo)
            if b['emprestado_para'] != cid:
                raise Recusa(409, 'não foi você que pegou')
            self.con.execute("UPDATE guilda_banco SET emprestado_para = NULL WHERE id = ?", (b['id'],))
            foto = self._g_ficha(g['id'], cid)
        return 200, {'ok': True, 'guilda': foto}
