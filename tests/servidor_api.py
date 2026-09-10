#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova da API de contas (servidor/api.py).

    python tests/servidor_api.py

Sobe a API DE VERDADE num subprocesso — porta livre, banco descartável numa
pasta temporária — e conversa com ela por HTTP como o site e o jogo fariam.
Sem dependências: só unittest e urllib. Cada teste cria as contas de que
precisa (nomes únicos), então a ordem em que rodam não importa.

O que se prova aqui é o contrato do cartório: conta, sessão, versão do save,
e sobretudo o ANTI-DUPLICAÇÃO — o mesmo iid duas vezes, iid de outra conta,
iid consumido que volta, iid que nunca nasceu; e a troca espelhada que muda
a posse de verdade.

Desde 10/09, também os EVENTOS DO MUNDO (/api/eventos: só o Mestre liga, todo
mundo lê, os tetos e a regra "vale o maior"), o calendário semanal no relógio
de Brasília, o RANKING POR CLASSE e a migração de um banco de antes disso.
Os eventos são do mundo, não de uma conta: quem conta o que está no ar chama
`limpa_agenda()` antes, e a ordem dos testes continua não importando.
"""
import json
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

AQUI = os.path.dirname(os.path.abspath(__file__))
API = os.path.join(AQUI, '..', 'servidor', 'api.py')
# as funções puras do cartório (expande_regra, herois_por_classe…) sem subir
# servidor; sem .pyc, para não deixar lixo em servidor/
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(AQUI, '..', 'servidor'))
import api as cartorio  # noqa: E402

# o formato de um item de ativos/proximos e de uma regra (seção 1.3 do plano)
CHAVES_EVENTO = {'id', 'origem', 'regra', 'tipo', 'multiplicador', 'calabouco', 'titulo', 'texto', 'inicio', 'fim'}
CHAVES_REGRA = {'id', 'tipo', 'multiplicador', 'calabouco', 'titulo', 'texto', 'dias', 'hora', 'duracaoMin',
                'vigenteDe', 'vigenteAte'}
TODOS_OS_DIAS = [0, 1, 2, 3, 4, 5, 6]

# O esquema de ANTES de 10/09, copiado à mão: é o banco que já está no ar e em
# que a API nova vai subir (sem agenda, sem resumos_classe, sem migracoes).
ESQUEMA_ANTIGO = """
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


def porta_livre():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    porta = s.getsockname()[1]
    s.close()
    return porta


def espera_api(base, proc=None, segundos=15):
    """Espera a API atender /api/saude; False se o processo cair ou o tempo acabar."""
    limite = time.time() + segundos
    while time.time() < limite:
        if proc is not None and proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(base + '/api/saude', timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.15)
    return False


class Cliente:
    """Um jogador falando com a API: guarda o token e manda JSON."""

    def __init__(self, base):
        self.base = base
        self.token = None
        self.conta = None

    def pede(self, metodo, rota, corpo=None, token='sessao'):
        dados = None if corpo is None else json.dumps(corpo).encode('utf-8')
        req = urllib.request.Request(self.base + rota, data=dados, method=metodo)
        req.add_header('Content-Type', 'application/json')
        tk = self.token if token == 'sessao' else token
        if tk:
            req.add_header('Authorization', 'Bearer ' + tk)
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return r.status, json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode('utf-8'))

    def cadastra(self, nome, email=None, senha='segredo-bom-8'):
        status, r = self.pede('POST', '/api/cadastro',
                              {'nome': nome, 'email': email or (nome.replace(' ', '') + '@soterra.test'),
                               'senha': senha})
        if r.get('ok'):
            self.token, self.conta = r['token'], r['conta']
        return status, r

    def salva(self, versao, progress=None, db=None, nascimentos=None):
        return self.pede('PUT', '/api/save', {'versao': versao, 'progress': progress, 'db': db,
                                              'nascimentos': nascimentos or []})


def save_com(iids_no_saco, herois=None, db_extra=None):
    """Um save mínimo com iids no saco (`inventory`) e heróis com xp/level."""
    progress = {'version': 22,
                'inventory': [{'itemId': 'it-%d' % i, 'level': 1, 'stars': 0, 'iid': iid}
                              for i, iid in enumerate(iids_no_saco)],
                'heroes': herois or {'barbaro': {'xp': 100, 'level': 3, 'items': {}, 'itemVar': {}}}}
    db = {'versao': 1, 'jogador': {'nome': None, 'brasa': {'pts': 1000, 'partidas': 0}},
          'banco': {'moedas': 0, 'itens': []}, 'mercado': None}
    if db_extra:
        db.update(db_extra)
    return progress, db


def nasce(*iids, origem='saque'):
    return [{'iid': iid, 'itemId': 'it-x', 'origem': origem} for iid in iids]


class ProvaDaApi(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.mkdtemp(prefix='soterra-api-')
        cls.porta = porta_livre()
        cls.base = 'http://127.0.0.1:%d' % cls.porta
        cls.log = open(os.path.join(cls.pasta, 'api.log'), 'w', encoding='utf-8')
        cls.proc = subprocess.Popen(
            [sys.executable, API, '--porta', str(cls.porta), '--banco', os.path.join(cls.pasta, 'dados', 'soterra.db')],
            stdout=cls.log, stderr=subprocess.STDOUT)
        # espera a API atender /api/saude (até ~15 s; num PC lento o boot demora)
        limite = time.time() + 15
        while time.time() < limite:
            if cls.proc.poll() is not None:
                break
            try:
                with urllib.request.urlopen(cls.base + '/api/saude', timeout=1) as r:
                    if r.status == 200:
                        return
            except Exception:
                time.sleep(0.15)
        cls.tearDownClass()
        raise RuntimeError('a API não subiu; veja o log em ' + cls.pasta)

    @classmethod
    def tearDownClass(cls):
        if cls.proc.poll() is None:
            cls.proc.terminate()
            try:
                cls.proc.wait(5)
            except subprocess.TimeoutExpired:
                cls.proc.kill()
        cls.log.close()
        shutil.rmtree(cls.pasta, ignore_errors=True)

    def novo(self, apelido, **kw):
        """Um cliente já cadastrado com nome único (o contador evita colisão entre testes)."""
        ProvaDaApi._n += 1
        c = Cliente(self.base)
        status, r = c.cadastra('%s %d' % (apelido, ProvaDaApi._n), **kw)
        self.assertEqual(status, 201, r)
        return c

    def banco(self):
        """O sqlite do servidor, direto — é assim que o dono mexe no VPS."""
        return sqlite3.connect(os.path.join(self.pasta, 'dados', 'soterra.db'))

    def marca(self, c, coluna):
        """Liga uma marca da conta (gm ou banido) como o `admin` faz."""
        b = self.banco()
        b.execute("UPDATE contas SET %s = 1 WHERE id = ?" % coluna, (c.conta['id'],))
        b.commit()
        b.close()

    def mestre(self, apelido):
        """Uma conta com a marca de Mestre (contas.gm = 1), como no teste da caixa."""
        c = self.novo(apelido)
        self.marca(c, 'gm')
        return c

    def limpa_agenda(self):
        """Cancela tudo o que está marcado (cancelar não apaga: a trilha fica)."""
        b = self.banco()
        b.execute("UPDATE agenda_eventos SET cancelado_em = 1 WHERE cancelado_em IS NULL")
        b.execute("UPDATE agenda_regras SET cancelado_em = 1 WHERE cancelado_em IS NULL")
        b.commit()
        b.close()

    def agenda(self):
        status, r = Cliente(self.base).pede('GET', '/api/eventos')
        self.assertEqual(status, 200, r)
        return r

    def ranking(self):
        status, r = Cliente(self.base).pede('GET', '/api/ranking')
        self.assertEqual(status, 200, r)
        return r

    @staticmethod
    def hora_brasilia(desloca_min):
        """'HH:MM' de agora mais `desloca_min`, no relógio de Brasília."""
        return (datetime.now(cartorio.FUSO) + timedelta(minutes=desloca_min)).strftime('%H:%M')

    # -- conta ------------------------------------------------------------------
    def test_saude(self):
        status, r = Cliente(self.base).pede('GET', '/api/saude')
        self.assertEqual(status, 200)
        self.assertTrue(r['ok'])
        self.assertIn('contas', r)
        self.assertIn('agora', r)

    def test_cadastro(self):
        c = Cliente(self.base)
        status, r = c.cadastra('Ana Cadastro', 'ana.cadastro@soterra.test')
        self.assertEqual(status, 201)
        self.assertTrue(r['ok'])
        self.assertEqual(len(r['token']), 64)
        self.assertEqual(r['conta']['nome'], 'Ana Cadastro')
        # nome repetido — e sem diferenciar maiúsculas
        status, r = Cliente(self.base).cadastra('ANA CADASTRO', 'outro@soterra.test')
        self.assertEqual(status, 409)
        self.assertFalse(r['ok'])
        # e-mail repetido
        status, r = Cliente(self.base).cadastra('Ana Outra', 'ana.cadastro@soterra.test')
        self.assertEqual(status, 409)
        # senha curta
        status, r = Cliente(self.base).cadastra('Ana Curta', senha='1234567')
        self.assertEqual(status, 400)
        self.assertIn('8', r['erro'])
        # nome torto: curto, com espaço na ponta, com símbolo
        for nome in ['Ab', ' Ana', 'Ana!', 'a' * 21]:
            status, r = Cliente(self.base).cadastra(nome, 'x%d@soterra.test' % len(nome))
            self.assertEqual(status, 400, nome)
        # e-mail sem @
        status, r = Cliente(self.base).cadastra('Ana Email', 'sem-arroba')
        self.assertEqual(status, 400)

    def test_login(self):
        c = self.novo('Beto Login')
        nome = c.conta['nome']
        email = nome.replace(' ', '') + '@soterra.test'
        # por nome
        status, r = Cliente(self.base).pede('POST', '/api/login', {'login': nome, 'senha': 'segredo-bom-8'})
        self.assertEqual(status, 200, r)
        self.assertTrue(r['ok'])
        self.assertEqual(r['conta']['id'], c.conta['id'])
        self.assertIs(r['conta']['gm'], False)
        # por e-mail (e com maiúsculas)
        status, r = Cliente(self.base).pede('POST', '/api/login', {'login': email.upper(), 'senha': 'segredo-bom-8'})
        self.assertEqual(status, 200, r)
        # senha errada
        status, r = Cliente(self.base).pede('POST', '/api/login', {'login': nome, 'senha': 'segredo-ruim-8'})
        self.assertEqual(status, 401)
        self.assertFalse(r['ok'])
        # conta que não existe: a MESMA resposta (não entrega quem existe)
        status, r2 = Cliente(self.base).pede('POST', '/api/login', {'login': 'ninguem', 'senha': 'segredo-bom-8'})
        self.assertEqual(status, 401)
        self.assertEqual(r['erro'], r2['erro'])

    def test_limite_de_tentativas(self):
        c = self.novo('Cida Teimosa')
        nome = c.conta['nome']
        for _ in range(10):
            status, r = Cliente(self.base).pede('POST', '/api/login', {'login': nome, 'senha': 'errada-errada'})
            self.assertEqual(status, 401)
        status, r = Cliente(self.base).pede('POST', '/api/login', {'login': nome, 'senha': 'errada-errada'})
        self.assertEqual(status, 429)
        # até a senha certa espera
        status, r = Cliente(self.base).pede('POST', '/api/login', {'login': nome, 'senha': 'segredo-bom-8'})
        self.assertEqual(status, 429)

    def test_eu(self):
        c = self.novo('Dora Eu')
        status, r = Cliente(self.base).pede('GET', '/api/eu')
        self.assertEqual(status, 401)
        status, r = Cliente(self.base).pede('GET', '/api/eu', token='0' * 64)
        self.assertEqual(status, 401)
        status, r = c.pede('GET', '/api/eu')
        self.assertEqual(status, 200)
        self.assertEqual(r['conta']['id'], c.conta['id'])
        self.assertEqual(r['conta']['nome'], c.conta['nome'])
        self.assertIn('@', r['conta']['email'])
        self.assertIn('criadoEm', r['conta'])
        self.assertIs(r['conta']['gm'], False)

    def test_logout(self):
        c = self.novo('Edu Sair')
        status, r = c.pede('POST', '/api/logout')
        self.assertEqual(status, 200)
        status, r = c.pede('GET', '/api/eu')
        self.assertEqual(status, 401)

    def test_rota_desconhecida_e_json_torto(self):
        status, r = Cliente(self.base).pede('GET', '/api/nada')
        self.assertEqual(status, 404)
        req = urllib.request.Request(self.base + '/api/login', data=b'{isso nao e json', method='POST')
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(cm.exception.code, 400)

    # -- save e versão ------------------------------------------------------------
    def test_save_primeira_vez_e_versao(self):
        c = self.novo('Fabi Save')
        status, r = c.pede('GET', '/api/save')
        self.assertEqual(status, 200)
        self.assertEqual(r['versao'], 0)
        self.assertIsNone(r['progress'])
        self.assertIsNone(r['db'])

        progress, db = save_com(['f-1', 'f-2'])
        progress['heroes']['barbaro']['itemVar'] = {'arma': {'level': 2, 'stars': 1, 'iid': 'f-3'}}
        db['banco']['itens'] = [{'itemId': 'it-b', 'iid': 'f-4'}]
        db['mercado'] = {'dia': '2026-09-10', 'ofertas': [
            {'id': 'o1', 'vendedor': 'jogador', 'iid': 'f-5'},
            {'id': 'o2', 'vendedor': 'mercador', 'iid': 'nao-e-minha'}]}     # banca do fantasma: ignorada
        status, r = c.salva(0, progress, db, nasce('f-1', 'f-2', 'f-3', 'f-4', 'f-5'))
        self.assertEqual(status, 200, r)
        self.assertEqual(r['versao'], 1)
        self.assertEqual(r['registrados'], 5)

        status, r = c.pede('GET', '/api/save')
        self.assertEqual(status, 200)
        self.assertEqual(r['versao'], 1)
        self.assertEqual(r['progress'], progress)
        self.assertEqual(r['db'], db)

        # versão velha → 409 trazendo o save atual para fundir
        progress2, db2 = save_com(['f-1'])
        status, r = c.salva(0, progress2, db2)
        self.assertEqual(status, 409, r)
        self.assertFalse(r['ok'])
        self.assertEqual(r['versao'], 1)
        self.assertEqual(r['progress'], progress)
        self.assertEqual(r['db'], db)
        # com a versão certa passa (os outros 4 viram 'fora')
        status, r = c.salva(1, progress2, db2)
        self.assertEqual(status, 200, r)
        self.assertEqual(r['versao'], 2)
        self.assertEqual(r['registrados'], 0)

    def test_save_recusa_nascimento_torto(self):
        c = self.novo('Gil Torto')
        progress, db = save_com(['g-1'])
        status, r = c.salva(0, progress, db, [{'iid': 'g-1', 'itemId': 'x', 'origem': 'magia'}])
        self.assertEqual(status, 400)
        status, r = c.salva(0, progress, db, [{'iid': 'com espaço', 'itemId': 'x', 'origem': 'saque'}])
        self.assertEqual(status, 400)
        status, r = c.salva('0', progress, db, nasce('g-1'))
        self.assertEqual(status, 400)

    def test_save_limite_de_nascimentos_por_put(self):
        c = self.novo('Hugo Farto')
        iids = ['h-%d' % i for i in range(201)]
        progress, db = save_com(iids)
        status, r = c.salva(0, progress, db, nasce(*iids))
        self.assertEqual(status, 429)

    # -- anti-duplicação -------------------------------------------------------------
    def test_dup_mesmo_iid_duas_vezes(self):
        c = self.novo('Ivo Dobro')
        progress, db = save_com(['i-1'])
        progress['heroes']['barbaro']['itemVar'] = {'arma': {'level': 1, 'stars': 0, 'iid': 'i-1'}}
        status, r = c.salva(0, progress, db, nasce('i-1'))
        self.assertEqual(status, 409, r)
        self.assertIn('duplicada', r['erro'])
        # e nem no saco duas vezes
        progress, db = save_com(['i-2', 'i-2'])
        status, r = c.salva(0, progress, db, nasce('i-2'))
        self.assertEqual(status, 409)

    def test_dup_iid_de_outra_conta(self):
        a = self.novo('Juca Dono')
        b = self.novo('Kiko Ladrao')
        progress, db = save_com(['j-1'])
        status, r = a.salva(0, progress, db, nasce('j-1'))
        self.assertEqual(status, 200, r)
        # B tenta pôr no save a instância de A — mesmo dizendo que "nasceu"
        status, r = b.salva(0, *save_com(['j-1']))
        self.assertEqual(status, 403, r)
        status, r = b.salva(0, *save_com(['j-1']), nascimentos=nasce('j-1'))
        self.assertEqual(status, 403, r)
        # A continua dona
        status, r = a.salva(1, progress, db)
        self.assertEqual(status, 200, r)

    def test_dup_consumida_nao_volta(self):
        c = self.novo('Lia Fundiu')
        status, r = c.salva(0, *save_com(['l-1', 'l-2']), nascimentos=nasce('l-1', 'l-2'))
        self.assertEqual(status, 200, r)
        # l-2 saiu do save (fundida/vendida) → vira 'fora'
        status, r = c.salva(1, *save_com(['l-1']))
        self.assertEqual(status, 200, r)
        # ...e o save "de antes", com l-2 de volta, é recusado
        status, r = c.salva(2, *save_com(['l-1', 'l-2']))
        self.assertEqual(status, 409, r)
        self.assertIn('consumida', r['erro'])
        # nascer de novo com o mesmo iid também não cola
        status, r = c.salva(2, *save_com(['l-1', 'l-2']), nascimentos=nasce('l-2'))
        self.assertEqual(status, 409, r)
        self.assertIn('consumida', r['erro'])
        # nascimento que nem entrou no save nasce já consumido
        status, r = c.salva(2, *save_com(['l-1']), nascimentos=nasce('l-3'))
        self.assertEqual(status, 200, r)
        self.assertEqual(r['registrados'], 1)
        status, r = c.salva(3, *save_com(['l-1', 'l-3']))
        self.assertEqual(status, 409, r)
        self.assertIn('consumida', r['erro'])

    def test_dup_iid_desconhecido(self):
        c = self.novo('Mia Inventa')
        status, r = c.salva(0, *save_com(['m-1']))
        self.assertEqual(status, 409, r)
        self.assertIn('desconhecida', r['erro'])
        # com o nascimento declarado, passa
        status, r = c.salva(0, *save_com(['m-1']), nascimentos=nasce('m-1', origem='roleta'))
        self.assertEqual(status, 200, r)

    def test_caixa_so_do_mestre(self):
        """No ar, a chave do modo Mestre é pública (js/core/gm.js é servido a
        todo mundo): peça de origem 'caixa' só nasce na conta marcada gm=1."""
        c = self.novo('Curioso Caixa')
        status, r = c.salva(0, *save_com(['cx-1']), nascimentos=nasce('cx-1', origem='caixa'))
        self.assertEqual(status, 403, r)
        self.assertIn('Caixa do Mestre', r['erro'])
        # a marca é do servidor (o sqlite no VPS): com ela, a mesma subida passa
        banco = sqlite3.connect(os.path.join(self.pasta, 'dados', 'soterra.db'))
        banco.execute("UPDATE contas SET gm = 1 WHERE id = ?", (c.conta['id'],))
        banco.commit()
        banco.close()
        status, r = c.salva(0, *save_com(['cx-1']), nascimentos=nasce('cx-1', origem='caixa'))
        self.assertEqual(status, 200, r)

    def test_dois_processos_no_mesmo_banco(self):
        """No deploy do Coolify o contêiner velho e o novo usam o MESMO banco por
        alguns segundos. Dois PUTs com a mesma versão, um em cada processo, ao
        mesmo tempo: só um pode passar; o outro leva 409 (antes, os dois
        passavam e um save sumia)."""
        porta2 = porta_livre()
        log2 = open(os.path.join(self.pasta, 'api2.log'), 'w', encoding='utf-8')
        proc2 = subprocess.Popen([sys.executable, API, '--porta', str(porta2),
                                  '--banco', os.path.join(self.pasta, 'dados', 'soterra.db')],
                                 stdout=log2, stderr=subprocess.STDOUT)
        try:
            base2 = 'http://127.0.0.1:%d' % porta2
            limite = time.time() + 15
            while time.time() < limite:
                try:
                    with urllib.request.urlopen(base2 + '/api/saude', timeout=1) as r:
                        if r.status == 200:
                            break
                except Exception:
                    time.sleep(0.15)
            c = self.novo('Dupla Via')
            c2 = Cliente(base2)
            c2.token, c2.conta = c.token, c.conta
            status, r = c.salva(0, *save_com(['dv-0']), nascimentos=nasce('dv-0'))
            self.assertEqual(status, 200, r)
            versao = r['versao']
            for rodada in range(8):
                res = []

                def vai(cli, iid):
                    res.append(cli.salva(versao, *save_com(['dv-0', iid]), nascimentos=nasce(iid))[0])

                t1 = threading.Thread(target=vai, args=(c, 'dv-a%d' % rodada))
                t2 = threading.Thread(target=vai, args=(c2, 'dv-b%d' % rodada))
                t1.start(); t2.start(); t1.join(); t2.join()
                self.assertEqual(sorted(res), [200, 409], 'rodada %d: %r' % (rodada, res))
                status, r = c.pede('GET', '/api/save')
                self.assertEqual(status, 200, r)
                self.assertEqual(r['versao'], versao + 1, 'rodada %d' % rodada)
                versao = r['versao']
        finally:
            proc2.terminate()
            try:
                proc2.wait(5)
            except subprocess.TimeoutExpired:
                proc2.kill()
            log2.close()

    # -- troca -------------------------------------------------------------------------
    def test_troca_espelhada(self):
        a = self.novo('Nina Troca')
        b = self.novo('Otto Troca')
        status, r = a.salva(0, *save_com(['n-1', 'n-2']), nascimentos=nasce('n-1', 'n-2'))
        self.assertEqual(status, 200, r)
        status, r = b.salva(0, *save_com(['o-1']), nascimentos=nasce('o-1'))
        self.assertEqual(status, 200, r)

        # A registra; B ainda não → aguardando
        status, r = a.pede('POST', '/api/troca', {'com': b.conta['id'], 'dou': ['n-1'], 'recebo': ['o-1']})
        self.assertEqual(status, 200, r)
        self.assertTrue(r['ok'])
        self.assertFalse(r['feita'])
        self.assertTrue(r['aguardando'])
        # B registra algo que NÃO espelha (quer n-2 também) → ainda aguardando
        status, r = b.pede('POST', '/api/troca', {'com': a.conta['id'], 'dou': ['o-1'], 'recebo': ['n-1', 'n-2']})
        self.assertEqual(status, 200, r)
        self.assertFalse(r['feita'])
        # B registra o espelho exato → feita
        status, r = b.pede('POST', '/api/troca', {'com': a.conta['id'], 'dou': ['o-1'], 'recebo': ['n-1']})
        self.assertEqual(status, 200, r)
        self.assertTrue(r['feita'])

        # o save seguinte de cada uma aceita o que recebeu...
        status, r = a.salva(1, *save_com(['n-2', 'o-1']))
        self.assertEqual(status, 200, r)
        status, r = b.salva(1, *save_com(['n-1']))
        self.assertEqual(status, 200, r)
        # ...e recusa o que deu (agora é da outra)
        status, r = a.salva(2, *save_com(['n-2', 'o-1', 'n-1']))
        self.assertEqual(status, 403, r)
        # dar o que não se tem: recusa na hora
        status, r = a.pede('POST', '/api/troca', {'com': b.conta['id'], 'dou': ['n-1'], 'recebo': []})
        self.assertEqual(status, 409, r)
        # trocar consigo mesmo ou com conta que não existe
        status, r = a.pede('POST', '/api/troca', {'com': a.conta['id'], 'dou': ['n-2'], 'recebo': []})
        self.assertEqual(status, 400, r)
        status, r = a.pede('POST', '/api/troca', {'com': 999999, 'dou': ['n-2'], 'recebo': []})
        self.assertEqual(status, 404, r)

    # -- ranking -------------------------------------------------------------------------
    def test_ranking(self):
        a = self.novo('Pia Forte')
        b = self.novo('Quim Fraco')
        herois_a = {'barbaro': {'xp': 5000, 'level': 12}, 'bruxo': {'xp': 2000, 'level': 8}}
        herois_b = {'ladino': {'xp': 300, 'level': 4}}
        pa, da = save_com([], herois_a, {'jogador': {'nome': 'Pia, a Forte',
                                                     'brasa': {'pts': 1200, 'partidas': 5},
                                                     'guilda': {'nome': 'Os Soterrados', 'emblema': '⚒'}}})
        pb, dbb = save_com([], herois_b, {'jogador': {'nome': None, 'brasa': {'pts': 1500, 'partidas': 0},
                                                      'guilda': {'nome': 'os soterrados', 'emblema': '⚒'}}})
        self.assertEqual(a.salva(0, pa, da)[0], 200)
        self.assertEqual(b.salva(0, pb, dbb)[0], 200)

        status, r = Cliente(self.base).pede('GET', '/api/ranking')       # sem autenticação
        self.assertEqual(status, 200)
        self.assertTrue(r['ok'])
        nomes = [j['nome'] for j in r['jogadores']]
        self.assertIn('Pia, a Forte', nomes)
        self.assertIn(b.conta['nome'], nomes)                            # sem nome no DB: o da conta
        self.assertLess(nomes.index('Pia, a Forte'), nomes.index(b.conta['nome']))
        pia = [j for j in r['jogadores'] if j['nome'] == 'Pia, a Forte'][0]
        self.assertEqual(pia, {'nome': 'Pia, a Forte', 'xpTotal': 7000, 'nivelMax': 12, 'classes': 2,
                               'avatar': None, 'classe': 'bruxo'})
        # PvP: só quem já jogou (Quim tem 1500 pts mas 0 partidas)
        pvp = [p['nome'] for p in r['pvp']]
        self.assertIn('Pia, a Forte', pvp)
        self.assertNotIn(b.conta['nome'], pvp)
        # guildas: agrupa sem diferenciar maiúsculas
        g = [g for g in r['guildas'] if g['nome'].lower() == 'os soterrados']
        self.assertEqual(len(g), 1)
        self.assertEqual(g[0]['membros'], 2)
        self.assertEqual(g[0]['xpTotal'], 7300)
        self.assertEqual(g[0]['emblema'], '⚒')

    def test_ranking_por_classe(self):
        """O melhor de cada classe: uma linha por conta (a melhor ficha), sem o
        Mestre do Fundo, com os números presos nas réguas do jogo."""
        a = self.novo('Rita Classe')
        herois = {
            'sumo': {'classId': 'sumo', 'xp': 5000, 'level': 12, 'element': 'fogo'},
            'sumo#2': {'classId': 'sumo', 'xp': 9000, 'level': 16, 'element': 'lava'},
            'gm': {'classId': 'gm', 'xp': 28180, 'level': 30, 'element': 'fogo'},
            'curandeira': {'xp': 700, 'level': 5, 'element': 'agua'},            # save antigo: sem classId
            'arqueiro': {'classId': 'arqueiro', 'xp': 10 ** 12, 'level': 99, 'element': 'ar'},
            'barbaro': {'xp': 50, 'level': 2},                                     # nome visível, não é id
        }
        pa, da = save_com([], herois, {'jogador': {'nome': 'Rita, a Rara', 'avatar': 'fus:sumo+bruxo'}})
        self.assertEqual(a.salva(0, pa, da)[0], 200)
        # empate com a Rita no sumo (9000, nível 16): desempata o nome; mais nível vem antes
        b = self.novo('Abel Classe')
        self.assertEqual(b.salva(0, *save_com([], {'sumo': {'classId': 'sumo', 'xp': 9000, 'level': 16,
                                                            'element': 'terra'}},
                                              {'jogador': {'nome': 'abel, o Primeiro'}}))[0], 200)
        c = self.novo('Caio Classe')
        self.assertEqual(c.salva(0, *save_com([], {'sumo#3': {'classId': 'sumo', 'xp': 9000, 'level': 17}},
                                              {'jogador': {'nome': 'Caio, o Alto'}}))[0], 200)
        z = self.novo('Zeca Classe')
        self.assertEqual(z.salva(0, *save_com([], {'sumo': {'classId': 'sumo', 'xp': 20000, 'level': 25}},
                                              {'jogador': {'nome': 'Zeca, o Banido'}}))[0], 200)

        r = self.ranking()
        self.assertEqual(r['classes'], ['sumo', 'arqueiro', 'bruxo', 'espadachim', 'curandeiro', 'invocador',
                                        'minotauro'])
        self.assertEqual(sorted(r['porClasse']), sorted(r['classes']))       # as 7 chaves, sempre
        self.assertTrue(all(isinstance(v, list) for v in r['porClasse'].values()))
        nossos = ('Rita, a Rara', 'abel, o Primeiro', 'Caio, o Alto', 'Zeca, o Banido')
        sumo = [linha for linha in r['porClasse']['sumo'] if linha['nome'] in nossos]
        self.assertEqual([linha['nome'] for linha in sumo],
                         ['Zeca, o Banido', 'Caio, o Alto', 'abel, o Primeiro', 'Rita, a Rara'])
        # a Rita aparece UMA vez, com a ficha sumo#2 (9000); 'lava' não é elemento
        self.assertEqual(sumo[3], {'nome': 'Rita, a Rara', 'nivel': 16, 'xp': 9000, 'elemento': 'neutro'})

        def da_rita(classe):
            return [linha for linha in r['porClasse'][classe] if linha['nome'] == 'Rita, a Rara']
        self.assertEqual(da_rita('curandeiro'), [{'nome': 'Rita, a Rara', 'nivel': 5, 'xp': 700, 'elemento': 'agua'}])
        self.assertEqual(da_rita('arqueiro'), [{'nome': 'Rita, a Rara', 'nivel': 30, 'xp': 28180, 'elemento': 'ar'}])
        self.assertEqual(da_rita('bruxo'), [])
        self.assertNotIn('gm', r['porClasse'])
        self.assertNotIn('gm', cartorio.herois_por_classe({'heroes': herois}))
        rita = [j for j in r['jogadores'] if j['nome'] == 'Rita, a Rara'][0]
        self.assertEqual((rita['avatar'], rita['classe']), ('fus:bruxo+sumo', 'arqueiro'))

        # conta banida sai do ranking inteiro
        self.marca(z, 'banido')
        r = self.ranking()
        self.assertNotIn('Zeca, o Banido', [linha['nome'] for linha in r['porClasse']['sumo']])
        self.assertNotIn('Zeca, o Banido', [j['nome'] for j in r['jogadores']])
        # um save sem a curandeira apaga a linha dela; avatar torto vira null
        del herois['curandeira']
        pa, da = save_com([], herois, {'jogador': {'nome': 'Rita, a Rara', 'avatar': 'fus:gm+sumo'}})
        self.assertEqual(a.salva(1, pa, da)[0], 200)
        r = self.ranking()
        self.assertEqual(da_rita('curandeiro'), [])
        self.assertEqual(len(da_rita('sumo')), 1)
        rita = [j for j in r['jogadores'] if j['nome'] == 'Rita, a Rara'][0]
        self.assertEqual((rita['avatar'], rita['classe']), (None, 'arqueiro'))

        # as funções puras, nos cantos
        casos = {'fus:sumo+bruxo': 'fus:bruxo+sumo', 'fus:bruxo+sumo': 'fus:bruxo+sumo', 'fus:sumo+sumo': None,
                 'fus:gm+sumo': None, 'fus:curandeira+sumo': 'fus:curandeiro+sumo', 'fus:sumo': None,
                 'fus:sumo+bruxo+arqueiro': None, 'fus:lua+sumo': None, 'sumo': None, None: None, 7: None}
        for avatar, esperado in casos.items():
            self.assertEqual(cartorio.avatar_publico({'jogador': {'avatar': avatar}}), esperado, avatar)
        self.assertIsNone(cartorio.avatar_publico(None))
        self.assertIsNone(cartorio.avatar_publico({'jogador': 'x'}))
        tortos = cartorio.herois_por_classe({'heroes': {
            'sumo': {'xp': float('nan'), 'level': True},                 # sem classId: vale a chave
            'bruxo#4': {'xp': -5, 'level': 0, 'element': ['fogo']},
            'espadachim': {'classId': 'curandeira', 'xp': '300', 'level': '9'},
            'invocador': 'isto não é ficha',
            'minotauro': {'classId': 'lua', 'xp': 100}}})
        self.assertEqual(tortos, {'sumo': ('sumo', 1, 0, 'neutro'), 'bruxo': ('bruxo#4', 1, 0, 'neutro'),
                                  'curandeiro': ('espadachim', 1, 0, 'neutro')})
        self.assertEqual(cartorio.herois_por_classe(None), {})
        self.assertEqual(cartorio.herois_por_classe({'heroes': []}), {})

    # -- os eventos do mundo (10/09) --------------------------------------------------------
    def test_evento_distante_aparece(self):
        """Um evento marcado para daqui a 30 dias (o limite é 180) aparece no GET:
        é por lá que o painel do Mestre o lista e o cancela."""
        m = self.mestre('Mestre Longe')
        ini = int(time.time()) + 30 * 86400
        status, r = m.pede('POST', '/api/eventos', {'tipo': 'xp', 'multiplicador': 1.5, 'calabouco': None,
                                                     'titulo': 'Festa distante', 'texto': '',
                                                     'inicio': ini, 'fim': ini + 3600})
        self.assertEqual(status, 201, r)
        eid = r['evento']['id']
        status, r = Cliente(self.base).pede('GET', '/api/eventos', token=None)
        self.assertEqual(status, 200, r)
        self.assertIn(eid, [e['id'] for e in r['proximos']])
        status, r = m.pede('POST', '/api/eventos/cancelar', {'alvo': 'evento', 'id': eid})
        self.assertEqual(status, 200, r)
        status, r = Cliente(self.base).pede('GET', '/api/eventos', token=None)
        self.assertNotIn(eid, [e['id'] for e in r['proximos']])

    def test_eventos_publico_vazio(self):
        self.limpa_agenda()
        status, r = Cliente(self.base).pede('GET', '/api/eventos', token=None)       # sem token nenhum
        self.assertEqual(status, 200, r)
        self.assertTrue(r['ok'])
        self.assertEqual((r['ativos'], r['proximos'], r['regras']), ([], [], []))
        self.assertEqual(r['tetos'], {'xp': 2.0, 'vintem': 1.5, 'pedras': 2.0, 'saque': 1.5, 'aviso': 1.0})
        self.assertEqual(r['fatores'], {'geral': {}, 'porCalabouco': {}})
        self.assertEqual((r['fusoMin'], r['janelaDias']), (-180, 14))
        self.assertLessEqual(abs(r['agora'] - time.time()), 5)

    def test_eventos_so_do_mestre(self):
        self.limpa_agenda()
        t = int(time.time())
        corpo = {'tipo': 'xp', 'multiplicador': 2, 'calabouco': None, 'titulo': 'Quinta do XP',
                 'texto': 'Toda sala paga o dobro de experiência.', 'inicio': t - 30, 'fim': t + 3600}
        regra = {'tipo': 'saque', 'multiplicador': 1.5, 'calabouco': 'cistern', 'titulo': 'Maré da Cisterna',
                 'dias': [6], 'hora': '10:00', 'duracaoMin': 720}
        status, r = Cliente(self.base).pede('POST', '/api/eventos', corpo)
        self.assertEqual(status, 401, r)
        # conta comum: 403 nas três rotas de escrita, antes de olhar o corpo
        comum = self.novo('Curioso Evento')
        for rota, c in (('/api/eventos', corpo), ('/api/eventos/regras', regra),
                        ('/api/eventos/cancelar', {'alvo': 'evento', 'id': 1})):
            status, r = comum.pede('POST', rota, c)
            self.assertEqual(status, 403, (rota, r))
            self.assertEqual(r['erro'], 'só o Mestre do Fundo mexe nos eventos do mundo')

        m = self.mestre('Mestre Evento')
        status, r = m.pede('POST', '/api/eventos', corpo)
        self.assertEqual(status, 201, r)
        ev = r['evento']
        self.assertEqual(set(ev), CHAVES_EVENTO)
        self.assertRegex(ev['id'], r'^e\d+$')
        self.assertEqual(ev, {'id': ev['id'], 'origem': 'pontual', 'regra': None, 'tipo': 'xp', 'multiplicador': 2.0,
                              'calabouco': None, 'titulo': 'Quinta do XP',
                              'texto': 'Toda sala paga o dobro de experiência.', 'inicio': t - 30, 'fim': t + 3600})
        status, r2 = m.pede('POST', '/api/eventos', dict(corpo, tipo='saque', multiplicador=1.5, calabouco='cistern',
                                                        titulo='Sábado do Saque', inicio=t + 7200, fim=t + 9000))
        self.assertEqual(status, 201, r2)
        # sem inicio: liga agora; o aviso não multiplica
        status, r3 = m.pede('POST', '/api/eventos', {'tipo': 'aviso', 'titulo': 'Manutenção às 22h', 'fim': t + 600})
        self.assertEqual(status, 201, r3)
        self.assertLessEqual(abs(r3['evento']['inicio'] - t), 5)
        self.assertEqual((r3['evento']['multiplicador'], r3['evento']['texto']), (1.0, ''))

        g = self.agenda()
        self.assertEqual([e['id'] for e in g['ativos']], [r3['evento']['id'], ev['id']])     # em ordem de fim
        self.assertEqual([e['id'] for e in g['proximos']], [r2['evento']['id']])
        self.assertEqual(g['fatores'], {'geral': {'xp': 2.0}, 'porCalabouco': {}})
        # quem criou e quando nunca sai, nem na resposta do POST
        for resposta in (r, r2, r3, g):
            texto = json.dumps(resposta)
            for segredo in ('criado_por', 'criado_em', 'cancelado', 'criadoPor'):
                self.assertNotIn(segredo, texto)
        # Mestre banido perde tudo
        self.marca(m, 'banido')
        status, r = m.pede('POST', '/api/eventos', corpo)
        self.assertEqual((status, r['erro']), (403, 'conta banida'))

    def test_eventos_validacao(self):
        m = self.mestre('Mestre Exigente')
        t = int(time.time())
        base = {'tipo': 'xp', 'multiplicador': 2, 'calabouco': None, 'titulo': 'Evento de prova', 'texto': '',
                'inicio': t + 60, 'fim': t + 3600}
        tortos = [
            ('fim igual ao início', {'fim': t + 60}),
            ('fim antes do início', {'fim': t}),
            ('mais de 7 dias', {'fim': t + 60 + 7 * 86400 + 1}),
            ('início a mais de 180 dias', {'inicio': t + 181 * 86400, 'fim': t + 181 * 86400 + 3600}),
            ('início no passado', {'inicio': t - 3600}),
            ('sem fim', {'fim': None}),
            ('fim em texto', {'fim': str(t + 3600)}),
            ('multiplicador 0,5', {'multiplicador': 0.5}),
            ('multiplicador 1', {'multiplicador': 1}),
            ('multiplicador True', {'multiplicador': True}),
            ('multiplicador "2"', {'multiplicador': '2'}),
            ('multiplicador acima do teto do xp', {'multiplicador': 2.5}),
            ('multiplicador gigante', {'multiplicador': 10 ** 400}),
            ('vintém acima do teto', {'tipo': 'vintem', 'multiplicador': 1.6}),
            ('saque acima do teto', {'tipo': 'saque', 'multiplicador': 2}),
            ('sem multiplicador', {'multiplicador': None}),
            ('aviso com multiplicador 2', {'tipo': 'aviso', 'multiplicador': 2}),
            ('tipo drop', {'tipo': 'drop'}),
            ('tipo em lista', {'tipo': ['xp']}),
            ('calabouço lua', {'calabouco': 'lua'}),
            ('título de 2', {'titulo': 'ab'}),
            ('título de 61', {'titulo': 'x' * 61}),
            ('título só de espaço', {'titulo': '      '}),
            ('título que não é texto', {'titulo': 12345}),
            ('texto de 281', {'texto': 'y' * 281}),
            ('texto que não é texto', {'texto': ['a']}),
        ]
        for nome, muda in tortos:
            status, r = m.pede('POST', '/api/eventos', dict(base, **muda))
            self.assertEqual(status, 400, (nome, r))
            self.assertFalse(r['ok'])
            self.assertTrue(isinstance(r['erro'], str) and r['erro'], nome)
        # as fronteiras passam
        bons = [{'titulo': 'abc'}, {'titulo': 'x' * 60}, {'texto': 'y' * 280}, {'tipo': 'aviso', 'multiplicador': None},
                {'tipo': 'aviso', 'multiplicador': 1}, {'tipo': 'vintem', 'multiplicador': 1.5},
                {'tipo': 'pedras', 'multiplicador': 2}, {'calabouco': 'poco'}, {'inicio': t - 30},
                {'fim': t + 60 + 7 * 86400}, {'inicio': t + 180 * 86400 - 60, 'fim': t + 180 * 86400}]
        for muda in bons:
            status, r = m.pede('POST', '/api/eventos', dict(base, **muda))
            self.assertEqual(status, 201, (muda, r))
        status, r = m.pede('POST', '/api/eventos', dict(base, multiplicador=1.999))       # arredonda a 2 casas
        self.assertEqual((status, r['evento']['multiplicador']), (201, 2.0))
        # no máximo 50 pontuais marcados (que ainda não acabaram)
        self.limpa_agenda()
        b = self.banco()
        b.executemany("INSERT INTO agenda_eventos(tipo, multiplicador, titulo, inicio, fim, criado_em) "
                      "VALUES ('xp', 1.5, 'Enchente', ?, ?, ?)", [(t + 100 + i, t + 200 + i, t) for i in range(50)])
        b.commit()
        b.close()
        status, r = m.pede('POST', '/api/eventos', base)
        self.assertEqual(status, 400, r)
        self.assertIn('50', r['erro'])
        self.limpa_agenda()
        status, r = m.pede('POST', '/api/eventos', base)
        self.assertEqual(status, 201, r)
        self.limpa_agenda()

    def test_expande_regra(self):
        """Função pura (importada do api.py, sem HTTP): a regra semanal vira
        ocorrências no relógio de Brasília, UTC−3 fixo."""
        fuso = cartorio.FUSO

        def regra(**muda):
            corpo = dict({'tipo': 'saque', 'multiplicador': 1.5, 'calabouco': 'cistern', 'titulo': 'Maré da Cisterna',
                          'texto': '', 'dias': [6], 'hora': '10:00', 'duracaoMin': 720}, **muda)
            return dict(cartorio.valida_regra(corpo), id=3)

        def em(*data):
            return int(datetime(*data, tzinfo=fuso).timestamp())

        quarta = em(2026, 9, 9)                      # qua 09/09/2026 00:00 de Brasília
        catorze = quarta + 14 * 86400
        occ = cartorio.expande_regra(regra(), quarta, catorze)
        self.assertEqual(len(occ), 2)                # sábados 12/09 e 19/09
        for o in occ:
            utc = datetime.fromtimestamp(o['inicio'], timezone.utc)
            self.assertEqual((utc.weekday(), utc.hour, utc.minute), (5, 13, 0))
            self.assertEqual(o['fim'] - o['inicio'], 720 * 60)
            self.assertEqual(o['id'], 'r3@%d' % o['inicio'])
            self.assertEqual(set(o), CHAVES_EVENTO)
            self.assertEqual((o['origem'], o['regra']), ('calendario', 3))
        # o exemplo da seção 1.3: agora = qui 10/09 09:00 → a primeira é sáb 12/09 10:00–22:00
        occ = cartorio.expande_regra(regra(), 1789041600, 1789041600 + 14 * 86400)
        self.assertEqual((occ[0]['id'], occ[0]['inicio'], occ[0]['fim']), ('r3@1789218000', 1789218000, 1789261200))
        # sexta 22:00 + 240 min atravessa a meia-noite: no ar no sábado à 01:00 de Brasília
        sexta = regra(dias=[5], hora='22:00', duracaoMin=240, tipo='xp', multiplicador=2, calabouco=None)
        sab_1h = em(2026, 9, 12, 1, 0)
        occ = cartorio.expande_regra(sexta, sab_1h, sab_1h + 1)
        self.assertEqual([(o['inicio'], o['fim']) for o in occ], [(em(2026, 9, 11, 22, 0), em(2026, 9, 12, 2, 0))])
        self.assertEqual(cartorio.resolve_fatores(occ, sab_1h)['geral'], {'xp': 2.0})
        self.assertEqual(cartorio.expande_regra(sexta, sab_1h + 3600, sab_1h + 3601), [])      # às 02:00 acabou
        # vigente_ate corta: até a meia-noite de sáb 19 sobra só o dia 12...
        occ = cartorio.expande_regra(regra(vigenteAte=em(2026, 9, 19)), quarta, catorze)
        self.assertEqual([o['inicio'] for o in occ], [em(2026, 9, 12, 10, 0)])
        # ...e no meio da ocorrência, ela termina ali
        occ = cartorio.expande_regra(regra(vigenteAte=em(2026, 9, 19, 16, 0)), quarta, catorze)
        self.assertEqual([(o['inicio'], o['fim']) for o in occ],
                         [(em(2026, 9, 12, 10, 0), em(2026, 9, 12, 22, 0)), (em(2026, 9, 19, 10, 0), em(2026, 9, 19, 16, 0))])
        # vigente_de: nada antes dele
        occ = cartorio.expande_regra(regra(vigenteDe=em(2026, 9, 15)), quarta, catorze)
        self.assertEqual([o['inicio'] for o in occ], [em(2026, 9, 19, 10, 0)])
        # domingo (0) funciona, e dois dias saem em ordem
        occ = cartorio.expande_regra(regra(dias=[0]), quarta, catorze)
        self.assertEqual([datetime.fromtimestamp(o['inicio'], fuso).strftime('%a %d %H:%M') for o in occ],
                         ['Sun 13 10:00', 'Sun 20 10:00'])
        occ = cartorio.expande_regra(regra(dias=[6, 0]), quarta, catorze)
        self.assertEqual([datetime.fromtimestamp(o['inicio'], fuso).day for o in occ], [12, 13, 19, 20])
        # o dia inteiro (1440 min) e o fim da janela: começa antes de `ate` = entra
        occ = cartorio.expande_regra(regra(dias=TODOS_OS_DIAS, hora='00:00', duracaoMin=1440), quarta, quarta + 86400)
        self.assertEqual([(o['inicio'], o['fim']) for o in occ], [(quarta, quarta + 86400)])

    def test_regra_http(self):
        self.limpa_agenda()
        m = self.mestre('Mestre Calendario')
        hora = self.hora_brasilia(120)             # todo dia, daqui a 2 h, por 1 h: tudo em proximos
        corpo = {'tipo': 'saque', 'multiplicador': 1.5, 'calabouco': 'cistern', 'titulo': 'Maré da Cisterna',
                 'texto': '', 'dias': TODOS_OS_DIAS, 'hora': hora, 'duracaoMin': 60, 'vigenteDe': None,
                 'vigenteAte': None}
        status, r = m.pede('POST', '/api/eventos/regras', corpo)
        self.assertEqual(status, 201, r)
        rg = r['regra']
        self.assertEqual(set(rg), CHAVES_REGRA)
        self.assertEqual(rg, {'id': rg['id'], 'tipo': 'saque', 'multiplicador': 1.5, 'calabouco': 'cistern',
                              'titulo': 'Maré da Cisterna', 'texto': '', 'dias': TODOS_OS_DIAS, 'hora': hora,
                              'duracaoMin': 60, 'vigenteDe': None, 'vigenteAte': None})
        self.assertEqual(len(r['proximas']), 3)
        g = self.agenda()
        self.assertEqual(g['regras'], [rg])
        self.assertEqual(g['ativos'], [])
        ocorr = [e for e in g['proximos'] if e['regra'] == rg['id']]
        self.assertEqual(len(ocorr), 14)            # 14 dias, uma por dia
        self.assertEqual(r['proximas'], ocorr[:3])
        for e in ocorr:
            self.assertEqual(set(e), CHAVES_EVENTO)
            self.assertEqual(e['id'], 'r%d@%d' % (rg['id'], e['inicio']))
            self.assertEqual((e['origem'], e['tipo'], e['multiplicador'], e['calabouco'], e['titulo'], e['texto']),
                             ('calendario', 'saque', 1.5, 'cistern', 'Maré da Cisterna', ''))
            self.assertEqual(e['fim'] - e['inicio'], 3600)
            self.assertEqual(datetime.fromtimestamp(e['inicio'], cartorio.FUSO).strftime('%H:%M'), hora)
        self.assertEqual([d['inicio'] - c['inicio'] for c, d in zip(ocorr, ocorr[1:])], [86400] * 13)
        self.assertEqual(g['fatores'], {'geral': {}, 'porCalabouco': {}})       # nada no ar ainda
        # a regra com vigência devolve os instantes como vieram (epoch)
        status, r = m.pede('POST', '/api/eventos/regras', dict(corpo, dias=[6], vigenteDe=1789000000,
                                                               vigenteAte=1799000000))
        self.assertEqual(status, 201, r)
        self.assertEqual((r['regra']['vigenteDe'], r['regra']['vigenteAte'], r['regra']['dias']),
                         (1789000000, 1799000000, [6]))
        # corpo torto: 400
        tortos = [{'dias': []}, {'dias': [7]}, {'dias': [-1]}, {'dias': [1, 1]}, {'dias': ['1']}, {'dias': [True]},
                  {'dias': 6}, {'hora': '24:00'}, {'hora': '10:60'}, {'hora': '10h'}, {'hora': 600}, {'hora': None},
                  {'duracaoMin': 14}, {'duracaoMin': 1441}, {'duracaoMin': True}, {'duracaoMin': 90.5},
                  {'duracaoMin': '60'}, {'vigenteDe': 2000, 'vigenteAte': 1000}, {'vigenteAte': 'amanhã'},
                  {'tipo': 'drop'}, {'multiplicador': 1.6}, {'calabouco': 'lua'}, {'titulo': 'ab'}]
        for muda in tortos:
            status, r = m.pede('POST', '/api/eventos/regras', dict(corpo, **muda))
            self.assertEqual(status, 400, (muda, r))
        # no máximo 20 regras vigentes
        self.limpa_agenda()
        b = self.banco()
        b.executemany("INSERT INTO agenda_regras(tipo, multiplicador, titulo, dias, hora_min, duracao_min, criado_em) "
                      "VALUES ('xp', 1.5, 'Regra de enchente', '6', 600, 60, ?)", [(int(time.time()),)] * 20)
        b.commit()
        b.close()
        status, r = m.pede('POST', '/api/eventos/regras', corpo)
        self.assertEqual(status, 400, r)
        self.assertIn('20', r['erro'])
        self.limpa_agenda()

    def test_cancelar(self):
        self.limpa_agenda()
        m = self.mestre('Mestre Cancela')
        comum = self.novo('Comum Cancela')
        t = int(time.time())
        status, r = m.pede('POST', '/api/eventos', {'tipo': 'xp', 'multiplicador': 1.5, 'titulo': 'Hora do XP',
                                                    'fim': t + 3600})
        self.assertEqual(status, 201, r)
        ev = r['evento']
        num = int(ev['id'][1:])
        # todo dia, começou há 1 h e vai por 3 h: a ocorrência de hoje está no ar
        status, r = m.pede('POST', '/api/eventos/regras', {'tipo': 'vintem', 'multiplicador': 1.5,
                                                           'titulo': 'Feira do Vintém', 'dias': TODOS_OS_DIAS,
                                                           'hora': self.hora_brasilia(-60), 'duracaoMin': 180})
        self.assertEqual(status, 201, r)
        rg = r['regra']
        g = self.agenda()
        self.assertIn(ev['id'], [e['id'] for e in g['ativos']])
        no_ar = [e for e in g['ativos'] if e['regra'] == rg['id']]
        self.assertEqual(len(no_ar), 1)
        self.assertEqual(g['fatores']['geral'], {'xp': 1.5, 'vintem': 1.5})
        # conta comum: 403
        status, r = comum.pede('POST', '/api/eventos/cancelar', {'alvo': 'evento', 'id': num})
        self.assertEqual(status, 403, r)
        # "encerrar agora" o pontual
        status, r = m.pede('POST', '/api/eventos/cancelar', {'alvo': 'evento', 'id': num})
        self.assertEqual((status, r), (200, {'ok': True, 'cancelado': True}))
        g = self.agenda()
        self.assertNotIn(ev['id'], [e['id'] for e in g['ativos'] + g['proximos']])
        # cancelar a regra derruba a ocorrência que está no ar (o id público também serve)
        status, r = m.pede('POST', '/api/eventos/cancelar', {'alvo': 'regra', 'id': no_ar[0]['id']})
        self.assertEqual((status, r), (200, {'ok': True, 'cancelado': True}))
        g = self.agenda()
        self.assertEqual((g['ativos'], g['proximos'], g['regras']), ([], [], []))
        self.assertEqual(g['fatores'], {'geral': {}, 'porCalabouco': {}})
        # de novo: 200 com cancelado false
        for alvo, i in (('evento', ev['id']), ('regra', rg['id'])):
            status, r = m.pede('POST', '/api/eventos/cancelar', {'alvo': alvo, 'id': i})
            self.assertEqual((status, r), (200, {'ok': True, 'cancelado': False}))
        # id que não existe: 404
        for alvo in ('evento', 'regra'):
            status, r = m.pede('POST', '/api/eventos/cancelar', {'alvo': alvo, 'id': 999999})
            self.assertEqual(status, 404, r)
        # corpo torto: 400
        for corpo in ({'alvo': 'tudo', 'id': num}, {'alvo': 'evento'}, {'alvo': 'evento', 'id': True},
                      {'alvo': 'evento', 'id': 0}, {'alvo': 'evento', 'id': 'r%d' % rg['id']},
                      {'alvo': 'evento', 'id': no_ar[0]['id']}, {'alvo': ['evento'], 'id': num}, {}):
            status, r = m.pede('POST', '/api/eventos/cancelar', corpo)
            self.assertEqual(status, 400, (corpo, r))

    def test_fatores(self):
        self.limpa_agenda()
        m = self.mestre('Mestre Fatores')
        t = int(time.time())

        def liga(**muda):
            corpo = dict({'tipo': 'xp', 'multiplicador': 1.5, 'titulo': 'Fator de prova', 'fim': t + 3600}, **muda)
            status, r = m.pede('POST', '/api/eventos', corpo)
            self.assertEqual(status, 201, r)
            return r['evento']

        liga(multiplicador=1.5)
        dois = liga(multiplicador=2)
        self.assertEqual(self.agenda()['fatores'], {'geral': {'xp': 2.0}, 'porCalabouco': {}})     # 2, não 3
        self.assertEqual(m.pede('POST', '/api/eventos/cancelar', {'alvo': 'evento', 'id': dois['id']})[0], 200)
        liga(multiplicador=2, calabouco='cistern')
        liga(multiplicador=1.25, calabouco='greenhouse')
        liga(tipo='saque', multiplicador=1.5, calabouco='cistern')
        liga(tipo='aviso', multiplicador=None, titulo='Só um recado')
        liga(multiplicador=2, inicio=t + 600, fim=t + 4000)                    # ainda não começou
        f = self.agenda()['fatores']
        self.assertEqual(f['geral'], {'xp': 1.5})
        self.assertEqual(f['porCalabouco']['cistern'], {'xp': 2.0, 'saque': 1.5})
        self.assertEqual(f['porCalabouco']['greenhouse'], {'xp': 1.5})         # o geral vence o 1,25 próprio
        self.assertEqual(set(f['porCalabouco']), {'cistern', 'greenhouse'})    # nada vaza para os outros
        # o teto vale também na leitura: uma linha mexida à mão no sqlite (xp ×9,
        # tipo que não existe) não vira "XP ×9" no site nem quebra o GET
        b = self.banco()
        b.execute("INSERT INTO agenda_eventos(tipo, multiplicador, titulo, inicio, fim, criado_em) "
                  "VALUES ('xp', 9, 'Digitado errado', ?, ?, ?)", (t - 10, t + 3600, t))
        b.execute("INSERT INTO agenda_eventos(tipo, multiplicador, titulo, inicio, fim, criado_em) "
                  "VALUES ('drop', 5, 'Tipo que não existe', ?, ?, ?)", (t - 10, t + 3600, t))
        b.commit()
        b.close()
        g = self.agenda()
        self.assertEqual(g['fatores']['geral'], {'xp': 2.0})
        self.assertEqual(g['fatores']['porCalabouco']['cistern'], {'xp': 2.0, 'saque': 1.5})
        self.assertTrue(all(1 <= e['multiplicador'] <= g['tetos'][e['tipo']] for e in g['ativos'] + g['proximos']))
        self.assertNotIn('drop', [e['tipo'] for e in g['ativos']])
        # a função pura: abaixo de 1 some, tipo desconhecido é ignorado, [inicio, fim)
        resolve = cartorio.resolve_fatores

        def ev(**muda):
            return dict({'tipo': 'xp', 'multiplicador': 1.5, 'calabouco': None, 'inicio': 100, 'fim': 200}, **muda)
        self.assertEqual(resolve([ev(multiplicador=0.5)], 150), {'geral': {}, 'porCalabouco': {}})
        self.assertEqual(resolve([ev(tipo='drop', multiplicador=5), ev(tipo=None)], 150)['geral'], {})
        self.assertEqual(resolve([ev()], 100)['geral'], {'xp': 1.5})         # o início entra
        self.assertEqual(resolve([ev()], 200)['geral'], {})                   # o fim não
        self.assertEqual(resolve([ev(multiplicador=9), ev(tipo='saque', multiplicador=9)], 150)['geral'],
                         {'xp': 2.0, 'saque': 1.5})
        self.assertEqual(resolve([ev(calabouco='cistern', multiplicador=2), ev(multiplicador=1.5)], 150),
                         {'geral': {'xp': 1.5}, 'porCalabouco': {'cistern': {'xp': 2.0}}})
        self.limpa_agenda()

    def test_auditoria_agenda(self):
        """Quem ligou, marcou e cancelou fica na trilha (a do `admin eventos`)."""
        m = self.mestre('Mestre Trilha')
        t = int(time.time())
        status, r = m.pede('POST', '/api/eventos', {'tipo': 'pedras', 'multiplicador': 2, 'titulo': 'Chuva de Pedras',
                                                    'inicio': t + 600, 'fim': t + 4200})
        self.assertEqual(status, 201, r)
        ev = r['evento']
        status, r = m.pede('POST', '/api/eventos/regras', {'tipo': 'xp', 'multiplicador': 1.25,
                                                           'titulo': 'Domingo Sereno', 'dias': [0], 'hora': '09:00',
                                                           'duracaoMin': 240})
        self.assertEqual(status, 201, r)
        rid = r['regra']['id']
        self.assertEqual(m.pede('POST', '/api/eventos/cancelar', {'alvo': 'evento', 'id': ev['id']})[0], 200)
        self.assertEqual(m.pede('POST', '/api/eventos/cancelar', {'alvo': 'regra', 'id': rid})[0], 200)
        # o que foi recusado não entra na trilha como criação
        self.assertEqual(m.pede('POST', '/api/eventos', {'tipo': 'drop', 'titulo': 'Torto', 'fim': t + 60})[0], 400)
        b = self.banco()
        linhas = b.execute("SELECT tipo, dados FROM eventos WHERE conta_id = ? AND tipo LIKE 'agenda-%' ORDER BY id",
                           (m.conta['id'],)).fetchall()
        b.close()
        self.assertEqual([linha[0] for linha in linhas], ['agenda-evento', 'agenda-regra', 'agenda-cancela',
                                                          'agenda-cancela'])
        dados = [json.loads(linha[1]) for linha in linhas]
        self.assertEqual((dados[0]['titulo'], dados[0]['tipo'], dados[0]['multiplicador']),
                         ('Chuva de Pedras', 'pedras', 2.0))
        self.assertEqual((dados[1]['dias'], dados[1]['hora'], dados[1]['duracaoMin']), ([0], '09:00', 240))
        self.assertEqual(dados[2], {'alvo': 'evento', 'id': int(ev['id'][1:]), 'titulo': 'Chuva de Pedras'})
        self.assertEqual(dados[3], {'alvo': 'regra', 'id': rid, 'titulo': 'Domingo Sereno'})

    def test_migracao_banco_antigo(self):
        """O banco que está no ar hoje (esquema de antes de 10/09, com contas e
        saves): a API nova sobe em cima dele e o ranking por classe já sai
        preenchido. Dois processos sobem JUNTOS no mesmo banco (o rolling update
        do Coolify): nenhum cai e a migração roda uma vez só."""
        pasta = tempfile.mkdtemp(prefix='antigo-', dir=self.pasta)
        caminho = os.path.join(pasta, 'soterra.db')
        b = sqlite3.connect(caminho)
        b.execute("PRAGMA journal_mode=WAL")          # como a API velha deixou
        b.executescript(ESQUEMA_ANTIGO)
        t = int(time.time())
        for i in range(40):
            nome = 'Antiga %02d' % i
            cid = b.execute("INSERT INTO contas(nome, email, senha_hash, sal, criado_em) VALUES (?, ?, 'x', 'y', ?)",
                            (nome, 'antiga%d@soterra.test' % i, t)).lastrowid
            progress = {'version': 22, 'heroes': {
                'sumo': {'classId': 'sumo', 'xp': 100 * (i + 1), 'level': 3, 'element': 'terra'},
                'bruxo#2': {'classId': 'bruxo', 'xp': 50, 'level': 2},
                'curandeira': {'xp': 10, 'level': 1}}}
            db = {'jogador': {'nome': None, 'avatar': 'fus:sumo+bruxo'}}
            b.execute("INSERT INTO saves(conta_id, progress, db, versao, atualizado_em) VALUES (?, ?, ?, 3, ?)",
                      (cid, json.dumps(progress), json.dumps(db), t - 3600))
            b.execute("INSERT INTO resumos(conta_id, nome, xp_total, nivel_max, classes, atualizado_em) "
                      "VALUES (?, ?, ?, 3, 3, ?)", (cid, nome, 100 * (i + 1) + 60, t - 3600))
        # um save torto (JSON quebrado) não derruba o boot
        cid = b.execute("INSERT INTO contas(nome, email, senha_hash, sal, criado_em) "
                        "VALUES ('Antiga Torta', 'torta@soterra.test', 'x', 'y', ?)", (t,)).lastrowid
        b.execute("INSERT INTO saves(conta_id, progress, db, versao, atualizado_em) VALUES (?, '{isso nao e json', "
                  "NULL, 1, ?)", (cid, t))
        b.execute("UPDATE contas SET banido = 1 WHERE nome = 'Antiga 00'")
        b.commit()
        b.close()

        procs = []
        try:
            for k in range(2):                        # os dois de uma vez, sem esperar o primeiro
                porta = porta_livre()
                log = open(os.path.join(pasta, 'api%d.log' % k), 'w', encoding='utf-8')
                procs.append((subprocess.Popen([sys.executable, API, '--porta', str(porta), '--banco', caminho],
                                               stdout=log, stderr=subprocess.STDOUT),
                              log, 'http://127.0.0.1:%d' % porta))
            for proc, _, base in procs:
                self.assertTrue(espera_api(base, proc), 'um dos processos não subiu; veja ' + pasta)
            for proc, _, base in procs:
                self.assertIsNone(proc.poll(), 'um dos processos caiu')
                status, r = Cliente(base).pede('GET', '/api/ranking')
                self.assertEqual(status, 200, r)
                sumo = [linha['nome'] for linha in r['porClasse']['sumo']]
                self.assertEqual(len(sumo), 39)                        # 40 menos a banida
                self.assertEqual(sumo[0], 'Antiga 39')                 # quem tem mais xp vem primeiro
                self.assertNotIn('Antiga 00', sumo)
                self.assertEqual(len(r['porClasse']['bruxo']), 39)
                self.assertEqual(len(r['porClasse']['curandeiro']), 39)
                self.assertEqual(r['porClasse']['sumo'][0], {'nome': 'Antiga 39', 'nivel': 3, 'xp': 4000,
                                                             'elemento': 'terra'})
                antiga = [j for j in r['jogadores'] if j['nome'] == 'Antiga 39'][0]
                self.assertEqual((antiga['avatar'], antiga['classe'], antiga['xpTotal']), ('fus:bruxo+sumo', 'sumo', 4060))
                self.assertNotIn('Antiga Torta', [j['nome'] for j in r['jogadores']])
            b = sqlite3.connect(caminho)
            self.assertEqual(b.execute("SELECT nome FROM migracoes").fetchall(), [('resumos-v2',)])
            b.close()
        finally:
            for proc, log, _ in procs:
                if proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                log.close()
        # e só um dos dois fez o trabalho (o outro achou o marcador)
        feitas = 0
        for k in range(2):
            with open(os.path.join(pasta, 'api%d.log' % k), encoding='utf-8', errors='replace') as f:
                feitas += 'contas no ranking por classe' in f.read()
        self.assertEqual(feitas, 1)

    def test_xp_max_espelha_tabela(self):
        """As réguas do servidor copiam dados do jogo: se o jogo mudar, isto grita
        (a xpTable, as classes, os calabouços e os elementos)."""
        def le(rel):
            with open(os.path.join(AQUI, '..', rel), 'rb') as f:
                return f.read().decode('utf-8', errors='replace')
        prog = le('js/core/data/progression.js')
        tabela = [int(n) for n in re.findall(r'\d+', re.search(r'xpTable\s*:\s*\[([^\]]*)\]', prog).group(1))]
        self.assertEqual(tabela[-1], cartorio.XP_MAX)
        self.assertEqual(len(tabela), cartorio.NIVEL_MAX)
        self.assertEqual(int(re.search(r'maxLevel\s*:\s*(\d+)', prog).group(1)), cartorio.NIVEL_MAX)
        classes = re.findall(r'^  ([a-z_]+): \{', le('js/core/data/classes.js'), re.M)
        self.assertEqual(tuple(classes), cartorio.CLASSES_RANK)
        calaboucos = re.findall(r"^    id: '([a-z]+)',", le('js/core/data/dungeons.js'), re.M)
        self.assertEqual(tuple(calaboucos) + ('poco',), cartorio.CALABOUCOS)
        elem = le('js/core/data/elements.js')
        bloco = elem[elem.index('DATA.elementInfo = {'):]
        bloco = bloco[:bloco.index('\n  };')]
        self.assertEqual(tuple(re.findall(r'^    ([a-z]+): \{', bloco, re.M)), cartorio.ELEMENTOS)


if __name__ == '__main__':
    unittest.main(verbosity=2)
