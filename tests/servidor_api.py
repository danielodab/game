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
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
API = os.path.join(AQUI, '..', 'servidor', 'api.py')


def porta_livre():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    porta = s.getsockname()[1]
    s.close()
    return porta


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
        self.assertEqual(pia, {'nome': 'Pia, a Forte', 'xpTotal': 7000, 'nivelMax': 12, 'classes': 2})
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


if __name__ == '__main__':
    unittest.main(verbosity=2)
