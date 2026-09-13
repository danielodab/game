#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova dos amigos e inimigos no servidor (servidor/amigos.py), pela API de verdade.

    python tests/amigos_api.py

Sobe servidor/api.py num subprocesso (banco descartável numa pasta temporária)
e faz o que a ficha "Amigos" do jogo faria (13/09, pedido do dono: "lista de
amigos e inimigos"): adicionar pela conta (o toque na praça) e pelo nome, o
amigo que vira inimigo (uma relação por par), tirar, a lista que é só de quem
marcou, e as recusas. O online e o bloqueio entre inimigos são do relé
(tests/rele_amigos_prova.py). As contas são sintéticas.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402  (põe servidor/ no sys.path)

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


class ProvaDosAmigos(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.mkdtemp(prefix='soterra-amigos-')
        cls.porta = porta_livre()
        cls.base = 'http://127.0.0.1:%d' % cls.porta
        cls.log = open(os.path.join(cls.pasta, 'api.log'), 'w', encoding='utf-8')
        env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
        cls.proc = subprocess.Popen([sys.executable, API, '--porta', str(cls.porta),
                                     '--banco', os.path.join(cls.pasta, 'dados', 'soterra.db')],
                                    stdout=cls.log, stderr=subprocess.STDOUT, env=env)
        if not espera_api(cls.base, cls.proc):
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

    def novo(self, apelido):
        ProvaDosAmigos._n += 1
        c = Cliente(self.base)
        status, r = c.cadastra('%s %d' % (apelido, ProvaDosAmigos._n))
        self.assertEqual(status, 201, r)
        return c

    def lista(self, c):
        status, r = c.pede('GET', '/api/amigos', None)
        self.assertEqual(status, 200, r)
        return r

    def define(self, c, corpo, esperado=200):
        status, r = c.pede('POST', '/api/amigos/definir', corpo)
        self.assertEqual(status, esperado, (corpo, r))
        return r

    def test_01_adicionar_trocar_e_tirar(self):
        a, b, c = self.novo('Amiga'), self.novo('Rival'), self.novo('Outro')
        r = self.define(a, {'conta': b.conta['id'], 'tipo': 'amigo'})
        self.assertEqual([x['conta'] for x in r['amigos']], [b.conta['id']])
        self.assertEqual(r['inimigos'], [])
        self.assertTrue(r['amigos'][0]['nome'])
        # pelo NOME, sem caixa (o nome de c vem da lista de outra conta, como a ficha mostraria)
        nome_c = self.define(b, {'conta': c.conta['id'], 'tipo': 'amigo'})['amigos'][0]['nome']
        r = self.define(a, {'nome': '  ' + nome_c.upper() + ' ', 'tipo': 'inimigo'})
        self.assertEqual([x['conta'] for x in r['inimigos']], [c.conta['id']])
        # uma relação por par: o amigo que vira inimigo sai dos amigos
        r = self.define(a, {'conta': b.conta['id'], 'tipo': 'inimigo'})
        self.assertEqual(r['amigos'], [])
        self.assertEqual(sorted(x['conta'] for x in r['inimigos']), sorted([b.conta['id'], c.conta['id']]))
        # null tira
        r = self.define(a, {'conta': b.conta['id'], 'tipo': None})
        self.assertEqual([x['conta'] for x in r['inimigos']], [c.conta['id']])
        self.assertEqual(self.lista(a)['inimigos'][0]['conta'], c.conta['id'])
        # a lista é de quem marcou: c não ganhou ninguém por ter sido marcado
        self.assertEqual(self.lista(c), {'ok': True, 'amigos': [], 'inimigos': []})

    def test_02_recusas(self):
        a, b = self.novo('Chata'), self.novo('Alvo')
        self.define(a, {'conta': a.conta['id'], 'tipo': 'amigo'}, 400)          # a própria conta
        self.define(a, {'conta': 99999999, 'tipo': 'amigo'}, 404)
        self.define(a, {'nome': 'Ninguém Com Este Nome 4242', 'tipo': 'amigo'}, 404)
        self.define(a, {'conta': b.conta['id'], 'tipo': 'rei'}, 400)
        self.define(a, {'conta': 'b', 'tipo': 'amigo'}, 400)
        self.define(a, {'tipo': 'amigo'}, 400)
        status, _ = Cliente(self.base).pede('GET', '/api/amigos', None)
        self.assertEqual(status, 401, 'sem conta não há lista')


if __name__ == '__main__':
    unittest.main(verbosity=2)
