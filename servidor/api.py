#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A API — o cartório do SOTERRA (fase 3 da vida online: a conta no servidor).

    python api.py [--host 127.0.0.1] [--porta 8300] [--banco dados/soterra.db]

O QUE ELA É: guarda a conta (nome, e-mail, senha picada), o save (o Progress e
o DB local do cliente, como JSON OPACO — o servidor não entende de feitiços) e,
o mais importante, o REGISTRO DE INSTÂNCIAS: cada cópia de item que nasce no
jogo tem um iid, e o servidor sabe de quem é e se ainda existe. É isso que
impede o truque clássico de "copiar o save e ficar com dois": o mesmo iid não
pode estar em dois lugares, o que foi consumido (fundido, vendido, forjado)
não volta, e o que é de outra conta só chega pela rota de troca.

O QUE ELA NÃO É: não valida o saque — nesta fase é o CLIENTE quem sorteia e
manda `nascimentos`; o servidor só garante que o que nasceu uma vez não vira
dois. Regras de sorteio no servidor são a fase seguinte.

NO VPS ela fica atrás do Caddy (https://<dominio>/api/* → 127.0.0.1:8300; ver
Caddyfile e soterra-api.service ao lado), irmã do Relé. Em casa, roda direto e
o site aponta com `?api=http://127.0.0.1:8300`.

Só biblioteca padrão de propósito: http.server, sqlite3, hashlib, secrets,
hmac, json. Nada para instalar no VPS além do python3.
"""
import argparse
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

log = logging.getLogger("api")

# ---- as réguas -------------------------------------------------------------
LIMITE_CORPO = 2 * 1024 * 1024   # um save tem dezenas de KB; 2 MB é folga, acima é abuso
SESSAO_DIAS = 30                 # token sem uso por 30 dias morre
LOGIN_TENTATIVAS = 10            # erros de senha por conta...
LOGIN_JANELA = 10 * 60           # ...dentro de 10 minutos, e a conta espera
NASC_POR_PUT = 200               # instâncias novas num save só
NASC_POR_HORA = 2000             # e por hora, por conta (ninguém saqueia tanto)
TROCA_VALIDADE = 120             # a intenção de troca espera o parceiro por 2 min
TROCA_GRACA = 10 * 60            # item recém-recebido não é varrido por 10 min (ver salvar)
PBKDF2_VOLTAS = 200_000
ORIGENS = {'saque', 'roleta', 'mercador', 'caixa', 'forja', 'troca', 'banco', 'legado'}
RE_IID = re.compile(r'^[\x21-\x7e]{1,64}$')    # ASCII visível, sem espaço — o cliente gera 'j' + base36

ESQUEMA = """
CREATE TABLE IF NOT EXISTS contas(
  id         INTEGER PRIMARY KEY,
  nome       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  sal        TEXT NOT NULL,
  criado_em  INTEGER NOT NULL,
  gm         INTEGER NOT NULL DEFAULT 0,
  banido     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessoes(
  token      TEXT PRIMARY KEY,
  conta_id   INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  criado_em  INTEGER NOT NULL,
  ultimo_uso INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessoes_conta ON sessoes(conta_id);
CREATE TABLE IF NOT EXISTS saves(
  conta_id      INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  progress      TEXT,
  db            TEXT,
  versao        INTEGER NOT NULL DEFAULT 0,
  atualizado_em INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS itens(
  iid       TEXT PRIMARY KEY,
  conta_id  INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  item_id   TEXT NOT NULL DEFAULT '',
  origem    TEXT NOT NULL,
  criado_em INTEGER NOT NULL,
  estado    TEXT NOT NULL DEFAULT 'vivo' CHECK (estado IN ('vivo', 'fora'))
);
CREATE INDEX IF NOT EXISTS itens_conta ON itens(conta_id, estado);
CREATE INDEX IF NOT EXISTS itens_nascidos ON itens(conta_id, criado_em);
CREATE TABLE IF NOT EXISTS resumos(
  conta_id       INTEGER PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  nome           TEXT,
  xp_total       INTEGER NOT NULL DEFAULT 0,
  nivel_max      INTEGER NOT NULL DEFAULT 0,
  classes        INTEGER NOT NULL DEFAULT 0,
  brasa_pts      INTEGER NOT NULL DEFAULT 0,
  brasa_partidas INTEGER NOT NULL DEFAULT 0,
  guilda_nome    TEXT,
  guilda_emblema TEXT,
  atualizado_em  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS eventos(
  id        INTEGER PRIMARY KEY,
  conta_id  INTEGER REFERENCES contas(id) ON DELETE SET NULL,
  tipo      TEXT NOT NULL,
  dados     TEXT,
  criado_em INTEGER NOT NULL
);
"""

# rota → (método da Api, precisa de conta?)
ROTAS = {
    ('POST', '/api/cadastro'): ('cadastro', False),
    ('POST', '/api/login'):    ('login', False),
    ('POST', '/api/logout'):   ('logout', True),
    ('GET',  '/api/eu'):       ('eu', True),
    ('GET',  '/api/save'):     ('save_ler', True),
    ('PUT',  '/api/save'):     ('salvar', True),
    ('POST', '/api/troca'):    ('troca', True),
    ('GET',  '/api/ranking'):  ('ranking', False),
    ('GET',  '/api/saude'):    ('saude', False),
}


def agora():
    return int(time.time())


class Recusa(Exception):
    """Uma resposta de erro com status e texto em português. `extra` entra no
    JSON ao lado de ok/erro (o 409 de versão devolve o save atual por aqui)."""

    def __init__(self, status, erro, **extra):
        super().__init__(erro)
        self.status = status
        self.erro = erro
        self.extra = extra


# ---- validações miúdas ------------------------------------------------------
def nome_valido(nome):
    if not isinstance(nome, str) or nome != nome.strip():
        return False
    if not 3 <= len(nome) <= 20:
        return False
    return all(c.isalnum() or c in ' _-' for c in nome)


def email_valido(email):
    return (isinstance(email, str) and 3 <= len(email) <= 120 and '@' in email
            and email == email.strip() and not any(c.isspace() for c in email))


def senha_valida(senha):
    return isinstance(senha, str) and 8 <= len(senha) <= 200


def iid_valido(iid):
    return isinstance(iid, str) and RE_IID.match(iid) is not None


def inteiro(v):
    """Número do save vira inteiro; qualquer outra coisa (bool, texto, nulo) é 0."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return 0
    return int(v)


def texto_ou_nulo(v, tam=40):
    return v.strip()[:tam] if isinstance(v, str) and v.strip() else None


def pica_senha(senha, sal):
    # pbkdf2 com 200 mil voltas: ~0,1 s por tentativa — barato para quem entra,
    # caro para quem chuta. O sal é por conta, então tabelas prontas não servem.
    return hashlib.pbkdf2_hmac('sha256', senha.encode('utf-8'), sal.encode('utf-8'), PBKDF2_VOLTAS).hex()


def colhe_iids(progress, db):
    """Varre o save e devolve [(iid, onde)] — cada lugar em que o cliente
    guarda uma INSTÂNCIA de item. Entradas sem iid são ignoradas: é o modelo
    antigo (`hero.items[slot]` = só o id do item) ou um saco ainda sem carimbo,
    e o cliente as registra como origem 'legado' quando carimbar."""
    achados = []

    def anota(lista, onde):
        if not isinstance(lista, list):
            return
        for i, e in enumerate(lista):
            if isinstance(e, dict) and isinstance(e.get('iid'), str) and e['iid']:
                achados.append((e['iid'], '%s[%d]' % (onde, i)))

    if isinstance(progress, dict):
        anota(progress.get('inventory'), 'inventory')
        herois = progress.get('heroes')
        if isinstance(herois, dict):
            for hid, h in herois.items():
                iv = h.get('itemVar') if isinstance(h, dict) else None
                if not isinstance(iv, dict):
                    continue
                for slot, v in iv.items():
                    if isinstance(v, dict) and isinstance(v.get('iid'), str) and v['iid']:
                        achados.append((v['iid'], 'heroes.%s.itemVar.%s' % (hid, slot)))
    if isinstance(db, dict):
        banco = db.get('banco')
        if isinstance(banco, dict):
            anota(banco.get('itens'), 'banco.itens')
        mercado = db.get('mercado')
        ofertas = mercado.get('ofertas') if isinstance(mercado, dict) else None
        if isinstance(ofertas, list):
            for i, o in enumerate(ofertas):
                # só o que o JOGADOR pendurou é instância dele; a banca do
                # mercador-fantasma é semeada pela data e não tem dono
                if (isinstance(o, dict) and o.get('vendedor') == 'jogador'
                        and isinstance(o.get('iid'), str) and o['iid']):
                    achados.append((o['iid'], 'mercado.ofertas[%d]' % i))
    return achados


def lista_de_iids(v, campo):
    if v is None:
        return []
    if not isinstance(v, list) or len(v) > 50:
        raise Recusa(400, '%s precisa ser uma lista de até 50 iids' % campo)
    saida = []
    for iid in v:
        if not iid_valido(iid):
            raise Recusa(400, 'iid inválido em %s' % campo)
        if iid not in saida:
            saida.append(iid)
    return saida


# ---- o cartório -------------------------------------------------------------
class Api:
    """Uma conexão SQLite só, guardada por uma tranca. O SQLite serializa as
    escritas de qualquer jeito, e a tranca dá de graça o que o anti-duplicação
    precisa: dois PUT do mesmo save nunca se entrelaçam — o segundo vê a
    versão que o primeiro gravou e leva 409."""

    def __init__(self, caminho_banco):
        pasta = os.path.dirname(os.path.abspath(caminho_banco))
        os.makedirs(pasta, exist_ok=True)
        self.con = sqlite3.connect(caminho_banco, check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        self.con.execute("PRAGMA journal_mode=WAL")
        self.con.execute("PRAGMA foreign_keys=ON")
        self.con.executescript(ESQUEMA)
        self.tranca = threading.RLock()
        self.tentativas = {}     # conta_id → [instantes de senha errada]   (em memória basta)
        self.intencoes = {}      # (de, para) → {dou, recebo, em}            (idem: expira em 120 s)

    # -- miudezas -------------------------------------------------------------
    def _evento(self, conta_id, tipo, dados):
        self.con.execute("INSERT INTO eventos(conta_id, tipo, dados, criado_em) VALUES (?, ?, ?, ?)",
                         (conta_id, tipo, json.dumps(dados, ensure_ascii=False) if dados is not None else None,
                          agora()))

    def _abre_sessao(self, conta_id):
        token = secrets.token_hex(32)
        t = agora()
        self.con.execute("INSERT INTO sessoes(token, conta_id, criado_em, ultimo_uso) VALUES (?, ?, ?, ?)",
                         (token, conta_id, t, t))
        return token

    def conta_do_token(self, token):
        if not token:
            return None
        with self.tranca:
            r = self.con.execute(
                "SELECT s.ultimo_uso AS sessao_uso, c.* FROM sessoes s JOIN contas c ON c.id = s.conta_id "
                "WHERE s.token = ?", (token,)).fetchone()
            if r is None:
                return None
            t = agora()
            if r['sessao_uso'] < t - SESSAO_DIAS * 86400:
                self.con.execute("DELETE FROM sessoes WHERE token = ?", (token,))
                self.con.commit()
                return None
            if t - r['sessao_uso'] > 60:          # não escrever a cada pedido
                self.con.execute("UPDATE sessoes SET ultimo_uso = ? WHERE token = ?", (t, token))
                self.con.commit()
            return dict(r)

    def despacha(self, metodo, caminho, token, corpo):
        rota = ROTAS.get((metodo, caminho))
        if rota is None:
            raise Recusa(404, 'rota desconhecida')
        nome, precisa_conta = rota
        conta = None
        if precisa_conta:
            conta = self.conta_do_token(token)
            if conta is None:
                raise Recusa(401, 'faça login (token ausente ou vencido)')
            if conta['banido']:
                raise Recusa(403, 'conta banida')
        return getattr(self, nome)(conta, corpo)

    # -- conta ------------------------------------------------------------------
    def cadastro(self, conta, corpo):
        nome, email, senha = corpo.get('nome'), corpo.get('email'), corpo.get('senha')
        if not nome_valido(nome):
            raise Recusa(400, 'nome inválido: 3 a 20 caracteres (letras, dígitos, espaço, _ ou -), sem espaço nas pontas')
        if not email_valido(email):
            raise Recusa(400, 'e-mail inválido')
        if not senha_valida(senha):
            raise Recusa(400, 'a senha precisa ter pelo menos 8 caracteres')
        sal = secrets.token_hex(16)
        picada = pica_senha(senha, sal)          # fora da tranca: leva ~0,1 s
        with self.tranca:
            if self.con.execute("SELECT 1 FROM contas WHERE nome = ?", (nome,)).fetchone():
                raise Recusa(409, 'esse nome já tem dono')
            if self.con.execute("SELECT 1 FROM contas WHERE email = ?", (email,)).fetchone():
                raise Recusa(409, 'esse e-mail já tem conta')
            try:
                cur = self.con.execute(
                    "INSERT INTO contas(nome, email, senha_hash, sal, criado_em) VALUES (?, ?, ?, ?, ?)",
                    (nome, email, picada, sal, agora()))
            except sqlite3.IntegrityError:
                self.con.rollback()
                raise Recusa(409, 'nome ou e-mail já usado')
            cid = cur.lastrowid
            token = self._abre_sessao(cid)
            self._evento(cid, 'cadastro', {'nome': nome})
            self.con.commit()
        log.info("cadastro: %s (#%d)", nome, cid)
        return 201, {'ok': True, 'token': token, 'conta': {'id': cid, 'nome': nome}}

    def _tentativas_estouradas(self, conta_id):
        t = agora()
        lista = [x for x in self.tentativas.get(conta_id, []) if x > t - LOGIN_JANELA]
        self.tentativas[conta_id] = lista
        return len(lista) >= LOGIN_TENTATIVAS

    def login(self, conta, corpo):
        login, senha = corpo.get('login'), corpo.get('senha')
        if not isinstance(login, str) or not isinstance(senha, str):
            raise Recusa(400, 'informe login (nome ou e-mail) e senha')
        login = login.strip()
        with self.tranca:
            c = self.con.execute("SELECT * FROM contas WHERE nome = ? OR email = ?", (login, login)).fetchone()
            if c is None:
                raise Recusa(401, 'login ou senha errados')      # mesma frase: não entrega quem existe
            if self._tentativas_estouradas(c['id']):
                raise Recusa(429, 'muitas tentativas; espere 10 minutos')
        bateu = hmac.compare_digest(pica_senha(senha, c['sal']), c['senha_hash'])
        with self.tranca:
            if not bateu:
                self.tentativas.setdefault(c['id'], []).append(agora())
                self._evento(c['id'], 'login-recusado', None)
                self.con.commit()
                raise Recusa(401, 'login ou senha errados')
            if c['banido']:
                raise Recusa(403, 'conta banida')
            self.tentativas.pop(c['id'], None)
            token = self._abre_sessao(c['id'])
            # faxina de passagem: sessões desta conta vencidas há mais de 30 dias
            self.con.execute("DELETE FROM sessoes WHERE conta_id = ? AND ultimo_uso < ?",
                             (c['id'], agora() - SESSAO_DIAS * 86400))
            self._evento(c['id'], 'login', None)
            self.con.commit()
        return 200, {'ok': True, 'token': token,
                     'conta': {'id': c['id'], 'nome': c['nome'], 'gm': bool(c['gm'])}}

    def logout(self, conta, corpo):
        with self.tranca:
            self.con.execute("DELETE FROM sessoes WHERE token = ?", (corpo['_token'],))
            self.con.commit()
        return 200, {'ok': True}

    def eu(self, conta, corpo):
        return 200, {'ok': True, 'conta': {'id': conta['id'], 'nome': conta['nome'], 'email': conta['email'],
                                           'criadoEm': conta['criado_em'], 'gm': bool(conta['gm'])}}

    # -- o save e o registro de instâncias ----------------------------------------
    def save_ler(self, conta, corpo):
        with self.tranca:
            r = self.con.execute("SELECT versao, progress, db FROM saves WHERE conta_id = ?",
                                 (conta['id'],)).fetchone()
        if r is None:
            return 200, {'ok': True, 'versao': 0, 'progress': None, 'db': None}
        return 200, {'ok': True, 'versao': r['versao'],
                     'progress': json.loads(r['progress']) if r['progress'] else None,
                     'db': json.loads(r['db']) if r['db'] else None}

    def _recusa_save(self, conta_id, status, erro, **extra):
        """Toda recusa de save vira evento — é a trilha para achar quem tenta
        duplicar (e para o dono depurar um cliente que ficou torto)."""
        with self.tranca:
            self._evento(conta_id, 'save-recusado', {'status': status, 'erro': erro})
            self.con.commit()
        # também no journal (journalctl -u soterra-api): é onde o dono olha primeiro
        log.info("save recusado: #%d HTTP %d — %.300s", conta_id, status, erro)
        raise Recusa(status, erro, **extra)

    def salvar(self, conta, corpo):
        cid = conta['id']
        versao = corpo.get('versao')
        if isinstance(versao, bool) or not isinstance(versao, int) or versao < 0:
            raise Recusa(400, 'versao precisa ser um inteiro (0 na primeira gravação)')
        progress, db = corpo.get('progress'), corpo.get('db')
        if progress is not None and not isinstance(progress, dict):
            raise Recusa(400, 'progress precisa ser um objeto JSON ou null')
        if db is not None and not isinstance(db, dict):
            raise Recusa(400, 'db precisa ser um objeto JSON ou null')
        brutos = corpo.get('nascimentos') or []
        if not isinstance(brutos, list):
            raise Recusa(400, 'nascimentos precisa ser uma lista')
        if len(brutos) > NASC_POR_PUT:
            self._recusa_save(cid, 429, 'nascimentos demais num save só (máximo %d)' % NASC_POR_PUT)

        # o que o cliente diz que nasceu agora: iid → (item_id, origem)
        nascimentos = {}
        for n in brutos:
            if not isinstance(n, dict) or not iid_valido(n.get('iid')):
                raise Recusa(400, 'nascimento sem iid válido')
            if n.get('origem') not in ORIGENS:
                raise Recusa(400, 'origem desconhecida em nascimento: %r' % (n.get('origem'),))
            item_id = n.get('itemId', '')
            if not isinstance(item_id, str) or len(item_id) > 64:
                raise Recusa(400, 'itemId inválido em nascimento')
            nascimentos.setdefault(n['iid'], (item_id, n['origem']))

        # (a') A CAIXA DO MESTRE (10/09): peça de origem 'caixa' só nasce na conta
        # que o servidor marcou (contas.gm = 1). A chave do modo Mestre mora no
        # js/core/gm.js, que é servido a todo mundo: quem a achar não registra nada.
        if not conta['gm'] and any(o == 'caixa' for _, o in nascimentos.values()):
            self._recusa_save(cid, 403, 'a Caixa do Mestre é só da conta do Mestre '
                                        '(peça de origem caixa numa conta sem a marca)')

        # (b) o mesmo iid não pode estar em dois lugares do save
        no_save = {}
        for iid, onde in colhe_iids(progress, db):
            if not iid_valido(iid):
                raise Recusa(400, 'iid inválido em %s' % onde)
            if iid in no_save:
                self._recusa_save(cid, 409, 'instância duplicada no save: %s está em %s e em %s'
                                  % (iid, no_save[iid], onde))
            no_save[iid] = onde

        with self.tranca:
            atual = self.con.execute("SELECT versao, progress, db FROM saves WHERE conta_id = ?", (cid,)).fetchone()
            versao_atual = atual['versao'] if atual else 0
            # (a) só grava por cima da versão que o cliente viu; senão devolve
            # a atual para ele fundir e tentar de novo
            if versao != versao_atual:
                self._recusa_save(cid, 409, 'save desatualizado: o servidor está na versão %d' % versao_atual,
                                  versao=versao_atual,
                                  progress=json.loads(atual['progress']) if atual and atual['progress'] else None,
                                  db=json.loads(atual['db']) if atual and atual['db'] else None)

            # (c) o registro: o que o servidor já sabe de cada iid citado
            conhecidos = {}
            todos = list(set(no_save) | set(nascimentos))
            for i in range(0, len(todos), 400):                 # lotes: o SQLite limita variáveis por consulta
                lote = todos[i:i + 400]
                for r in self.con.execute("SELECT iid, conta_id, estado FROM itens WHERE iid IN (%s)"
                                          % ','.join('?' * len(lote)), lote):
                    conhecidos[r['iid']] = (r['conta_id'], r['estado'])

            registrar = []
            for iid, onde in no_save.items():
                dono = conhecidos.get(iid)
                if dono is None:
                    if iid not in nascimentos:
                        self._recusa_save(cid, 409, 'instância desconhecida: %s (%s) não nasceu neste servidor'
                                          % (iid, onde))
                    item_id, origem = nascimentos[iid]
                    registrar.append((iid, item_id, origem))
                elif dono[0] != cid:
                    self._recusa_save(cid, 403, 'instância de outra conta: %s (%s) — troca só pela rota de troca'
                                      % (iid, onde))
                elif dono[1] == 'fora':
                    self._recusa_save(cid, 409, 'instância já consumida: %s (%s) saiu do jogo e não volta'
                                      % (iid, onde))
            # nascimento que NEM está no save: nasceu e morreu antes de salvar
            # (vendido ao mercador na mesma sessão). Registra mesmo assim — a
            # varredura abaixo o marca 'fora' e ele não pode voltar depois.
            for iid, (item_id, origem) in nascimentos.items():
                if iid in no_save:
                    continue
                dono = conhecidos.get(iid)
                if dono is None:
                    registrar.append((iid, item_id, origem))
                elif dono[0] != cid:
                    self._recusa_save(cid, 403, 'instância de outra conta: %s' % iid)

            t = agora()
            na_hora = self.con.execute("SELECT COUNT(*) FROM itens WHERE conta_id = ? AND criado_em > ?",
                                       (cid, t - 3600)).fetchone()[0]
            if na_hora + len(registrar) > NASC_POR_HORA:
                self._recusa_save(cid, 429, 'instâncias demais na última hora (máximo %d)' % NASC_POR_HORA)

            # daqui para baixo só escrita — nenhuma recusa depois disso
            self.con.executemany(
                "INSERT INTO itens(iid, conta_id, item_id, origem, criado_em, estado) VALUES (?, ?, ?, ?, ?, 'vivo')",
                [(iid, cid, item_id, origem, t) for iid, item_id, origem in registrar])
            # varredura: instância viva desta conta que sumiu do save foi
            # consumida (fundida, vendida, forjada). Exceção: o que chegou por
            # troca há pouco — o cliente pode ainda não ter posto no save
            # (um PUT que já estava a caminho), e marcar 'fora' o apagaria.
            vivos = self.con.execute(
                "SELECT iid FROM itens WHERE conta_id = ? AND estado = 'vivo' "
                "AND NOT (origem = 'troca' AND criado_em > ?)", (cid, t - TROCA_GRACA)).fetchall()
            consumidos = [(r['iid'],) for r in vivos if r['iid'] not in no_save]
            self.con.executemany("UPDATE itens SET estado = 'fora' WHERE iid = ?", consumidos)

            nova = versao_atual + 1
            self.con.execute(
                "INSERT OR REPLACE INTO saves(conta_id, progress, db, versao, atualizado_em) VALUES (?, ?, ?, ?, ?)",
                (cid, json.dumps(progress, ensure_ascii=False) if progress is not None else None,
                 json.dumps(db, ensure_ascii=False) if db is not None else None, nova, t))
            self._resumo(cid, conta, progress, db, t)
            if registrar:
                self._evento(cid, 'nascimentos', {'versao': nova, 'iids': [r[0] for r in registrar]})
            self.con.commit()
        return 200, {'ok': True, 'versao': nova, 'registrados': len(registrar)}

    def _resumo(self, cid, conta, progress, db, t):
        """(d) a foto pública da conta, para o ranking — recalculada a cada save."""
        xp_total = nivel_max = classes = 0
        herois = progress.get('heroes') if isinstance(progress, dict) else None
        if isinstance(herois, dict):
            for h in herois.values():
                if not isinstance(h, dict):
                    continue
                classes += 1
                xp_total += inteiro(h.get('xp'))
                nivel_max = max(nivel_max, inteiro(h.get('level')))
        jog = db.get('jogador') if isinstance(db, dict) else None
        jog = jog if isinstance(jog, dict) else {}
        brasa = jog.get('brasa') if isinstance(jog.get('brasa'), dict) else {}
        guilda = jog.get('guilda') if isinstance(jog.get('guilda'), dict) else {}
        nome = texto_ou_nulo(jog.get('nome')) or conta['nome']
        self.con.execute(
            "INSERT OR REPLACE INTO resumos(conta_id, nome, xp_total, nivel_max, classes, brasa_pts, brasa_partidas, "
            "guilda_nome, guilda_emblema, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (cid, nome, xp_total, nivel_max, classes, inteiro(brasa.get('pts')), inteiro(brasa.get('partidas')),
             texto_ou_nulo(guilda.get('nome')), texto_ou_nulo(guilda.get('emblema'), 16), t))

    # -- troca entre contas ----------------------------------------------------------
    def troca(self, conta, corpo):
        """Cada lado registra a intenção; quando as duas se espelham (A dá X e
        recebe Y; B dá Y e recebe X) dentro de 120 s, a posse muda de mãos numa
        transação só. O item trocado ganha origem 'troca' e criado_em = agora —
        é como `salvar` sabe não varrê-lo enquanto o cliente o encaixa no save."""
        cid = conta['id']
        com = corpo.get('com')
        if isinstance(com, bool) or not isinstance(com, int) or com == cid:
            raise Recusa(400, 'com precisa ser o id de outra conta')
        dou = lista_de_iids(corpo.get('dou'), 'dou')
        recebo = lista_de_iids(corpo.get('recebo'), 'recebo')
        if not dou and not recebo:
            raise Recusa(400, 'troca vazia: informe dou e/ou recebo')
        if set(dou) & set(recebo):
            raise Recusa(400, 'o mesmo iid não pode estar em dou e em recebo')
        with self.tranca:
            outro = self.con.execute("SELECT id, banido FROM contas WHERE id = ?", (com,)).fetchone()
            if outro is None or outro['banido']:
                raise Recusa(404, 'conta não encontrada')
            for iid in dou:
                r = self.con.execute("SELECT conta_id, estado FROM itens WHERE iid = ?", (iid,)).fetchone()
                if r is None or r['conta_id'] != cid or r['estado'] != 'vivo':
                    raise Recusa(409, 'você não tem a instância %s' % iid)
            for iid in recebo:
                r = self.con.execute("SELECT conta_id, estado FROM itens WHERE iid = ?", (iid,)).fetchone()
                if r is None or r['conta_id'] != com or r['estado'] != 'vivo':
                    raise Recusa(409, 'a outra conta não tem a instância %s' % iid)
            t = agora()
            for chave in [k for k, v in self.intencoes.items() if v['em'] < t - TROCA_VALIDADE]:
                del self.intencoes[chave]
            self.intencoes[(cid, com)] = {'dou': frozenset(dou), 'recebo': frozenset(recebo), 'em': t}
            espelho = self.intencoes.get((com, cid))
            if not (espelho and espelho['dou'] == frozenset(recebo) and espelho['recebo'] == frozenset(dou)):
                return 200, {'ok': True, 'feita': False, 'aguardando': True}
            self.con.executemany(
                "UPDATE itens SET conta_id = ?, origem = 'troca', criado_em = ? WHERE iid = ? AND conta_id = ? AND estado = 'vivo'",
                [(com, t, iid, cid) for iid in dou] + [(cid, t, iid, com) for iid in recebo])
            del self.intencoes[(cid, com)]
            del self.intencoes[(com, cid)]
            self._evento(cid, 'troca', {'com': com, 'dou': dou, 'recebo': recebo})
            self._evento(com, 'troca', {'com': cid, 'dou': recebo, 'recebo': dou})
            self.con.commit()
        log.info("troca feita: #%d ⇄ #%d (%d/%d itens)", cid, com, len(dou), len(recebo))
        return 200, {'ok': True, 'feita': True}

    # -- público ------------------------------------------------------------------------
    def ranking(self, conta, corpo):
        with self.tranca:
            jogadores = self.con.execute(
                "SELECT r.nome, r.xp_total, r.nivel_max, r.classes FROM resumos r JOIN contas c ON c.id = r.conta_id "
                "WHERE c.banido = 0 ORDER BY r.xp_total DESC, r.nivel_max DESC, r.nome COLLATE NOCASE LIMIT 50").fetchall()
            pvp = self.con.execute(
                "SELECT r.nome, r.brasa_pts, r.brasa_partidas FROM resumos r JOIN contas c ON c.id = r.conta_id "
                "WHERE c.banido = 0 AND r.brasa_partidas > 0 ORDER BY r.brasa_pts DESC, r.nome COLLATE NOCASE LIMIT 50").fetchall()
            guildas = self.con.execute(
                "SELECT r.guilda_nome AS nome, MAX(r.guilda_emblema) AS emblema, COUNT(*) AS membros, "
                "SUM(r.xp_total) AS xp FROM resumos r JOIN contas c ON c.id = r.conta_id "
                "WHERE c.banido = 0 AND r.guilda_nome IS NOT NULL AND r.guilda_nome != '' "
                "GROUP BY r.guilda_nome COLLATE NOCASE ORDER BY xp DESC, membros DESC LIMIT 50").fetchall()
        return 200, {
            'ok': True,
            'jogadores': [{'nome': r['nome'], 'xpTotal': r['xp_total'], 'nivelMax': r['nivel_max'],
                           'classes': r['classes']} for r in jogadores],
            'pvp': [{'nome': r['nome'], 'brasa': r['brasa_pts'], 'partidas': r['brasa_partidas']} for r in pvp],
            'guildas': [{'nome': r['nome'], 'emblema': r['emblema'], 'membros': r['membros'],
                         'xpTotal': r['xp']} for r in guildas],
        }

    def saude(self, conta, corpo):
        with self.tranca:
            n = self.con.execute("SELECT COUNT(*) FROM contas").fetchone()[0]
        return 200, {'ok': True, 'contas': n, 'agora': agora()}


# ---- o atendente HTTP ----------------------------------------------------------------
class Atendente(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'     # keep-alive: o Caddy reaproveita a conexão
    server_version = 'SOTERRA-API/1'
    api = None                         # preenchido no boot

    def log_message(self, fmt, *args):
        log.debug("%s %s", self.address_string(), fmt % args)

    def _cors(self):
        # o site e o jogo moram no mesmo domínio; o `*` é para o jogo aberto
        # em file:// ou num servidor local falar com a API sem cerimônia.
        # Não há cookie — a sessão vai no header Authorization —, então
        # liberar a origem não abre nada.
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        self.send_header('Access-Control-Max-Age', '86400')

    def _responde(self, status, obj):
        corpo = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(corpo)))
        self.send_header('Cache-Control', 'no-store')
        self._cors()
        self.end_headers()
        self.wfile.write(corpo)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        self._atende('GET')

    def do_POST(self):
        self._atende('POST')

    def do_PUT(self):
        self._atende('PUT')

    def do_DELETE(self):
        self._atende('DELETE')

    def _token(self):
        cab = self.headers.get('Authorization', '')
        partes = cab.split(None, 1)
        if len(partes) == 2 and partes[0].lower() == 'bearer' and partes[1].strip():
            return partes[1].strip()
        return None

    def _le_corpo(self, metodo):
        if metodo not in ('POST', 'PUT'):
            return {}
        try:
            tamanho = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            raise Recusa(400, 'Content-Length inválido')
        if tamanho > LIMITE_CORPO:
            self.close_connection = True          # não vamos ler isso; a conexão morre junto
            raise Recusa(413, 'corpo grande demais (máximo 2 MB)')
        if tamanho <= 0:
            return {}
        bruto = self.rfile.read(tamanho)
        try:
            corpo = json.loads(bruto.decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise Recusa(400, 'JSON inválido')
        if not isinstance(corpo, dict):
            raise Recusa(400, 'o corpo precisa ser um objeto JSON')
        return corpo

    def _atende(self, metodo):
        caminho = urlsplit(self.path).path
        try:
            corpo = self._le_corpo(metodo)
            token = self._token()
            corpo['_token'] = token                 # o logout precisa saber qual sessão apagar
            status, resposta = self.api.despacha(metodo, caminho, token, corpo)
        except Recusa as r:
            status, resposta = r.status, {'ok': False, 'erro': r.erro}
            resposta.update(r.extra)
        except Exception:
            log.exception("erro em %s %s", metodo, caminho)
            status, resposta = 500, {'ok': False, 'erro': 'erro interno do servidor'}
        self._responde(status, resposta)


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description="A API de contas do SOTERRA")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--porta", type=int, default=8300)
    ap.add_argument("--banco", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "dados", "soterra.db"))
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    Atendente.api = Api(args.banco)
    servidor = ThreadingHTTPServer((args.host, args.porta), Atendente)
    log.info("a API escuta em http://%s:%d — banco em %s", args.host, args.porta, os.path.abspath(args.banco))
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
