#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova do registro de eventos de uso (servidor/eventos_uso.py) — 15/10.

    python tests/eventos_uso_api.py

Pela API de verdade (subprocesso, porta livre, banco descartável): o lote sem conta e com conta soma
na mesma linha do dia; nome inválido cai e o resto entra; a plataforma fora da lista vira vazio; o
freio por endereço (429); o painel do Mestre (403 de quem não é; a soma por nome e por dia); a
tabela não tem coluna de conta nem de endereço; e a retenção apaga o que é de antes.
"""
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402
import eventos_uso  # noqa: E402


class Navegador(Cliente):
    def __init__(self, base, ip):
        super().__init__(base)
        self.ip = ip

    def pede(self, metodo, rota, corpo=None, token='sessao'):
        dados = None if corpo is None else json.dumps(corpo).encode('utf-8')
        req = urllib.request.Request(self.base + rota, data=dados, method=metodo)
        req.add_header('Content-Type', 'application/json')
        req.add_header('X-Forwarded-For', self.ip)
        tk = self.token if token == 'sessao' else token
        if tk:
            req.add_header('Authorization', 'Bearer ' + tk)
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return r.status, json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode('utf-8'))


class ProvaDosEventos(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.mkdtemp(prefix='soterra-eventos-')
        cls.banco = os.path.join(cls.pasta, 'dados', 'soterra.db')
        porta = porta_livre()
        cls.base = 'http://127.0.0.1:%d' % porta
        cls.log = open(os.path.join(cls.pasta, 'api.log'), 'w', encoding='utf-8')
        env = dict(os.environ, PYTHONIOENCODING='utf-8')
        cls.proc = subprocess.Popen([sys.executable, API, '--porta', str(porta), '--banco', cls.banco],
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

    def navegador(self):
        ProvaDosEventos._n += 1
        return Navegador(self.base, '189.41.%d.%d' % (ProvaDosEventos._n // 200, ProvaDosEventos._n % 200 + 1))

    def conta(self, apelido):
        c = self.navegador()
        st, r = c.cadastra('%s %d' % (apelido, ProvaDosEventos._n))
        self.assertEqual(st, 201, r)
        return c

    def sql(self, q, *args):
        con = sqlite3.connect(self.banco, timeout=10)
        con.row_factory = sqlite3.Row
        try:
            linhas = con.execute(q, args).fetchall()
            con.commit()
            return linhas
        finally:
            con.close()

    def manda(self, c, eventos, token='sessao', **ctx):
        corpo = {'eventos': eventos, 'versao': ctx.get('versao', 'v-prova'), 'plataforma': ctx.get('plataforma', 'pc'),
                 'tela': ctx.get('tela', 'hub')}
        return c.pede('POST', '/api/registro/eventos', corpo, token=token)

    def soma(self, nome):
        r = self.sql("SELECT COALESCE(SUM(contagem), 0) AS s FROM eventos_uso WHERE nome = ?", nome)
        return r[0]['s']

    # -------------------------------------------------------------------------------------
    def test_sem_conta_e_com_conta_somam_na_mesma_linha(self):
        a = self.navegador()
        st, r = self.manda(a, [{'nome': 'boot'}, {'nome': 'tela:hub', 'n': 2}], token=None)
        self.assertEqual(st, 200, r)
        self.assertEqual(r['aceitos'], 2)
        b = self.conta('Funil')
        st, r = self.manda(b, [{'nome': 'boot', 'n': 3}])
        self.assertEqual(st, 200, r)
        self.assertEqual(self.soma('boot'), 4)
        self.assertEqual(self.soma('tela:hub'), 2)
        linhas = self.sql("SELECT * FROM eventos_uso WHERE nome = 'boot'")
        self.assertEqual(len(linhas), 1, 'uma linha só por dia × nome × versão × plataforma')
        colunas = set(linhas[0].keys())
        self.assertFalse(colunas & {'conta_id', 'ip', 'endereco', 'token'}, colunas)

    def test_nome_invalido_cai_e_o_resto_entra(self):
        c = self.navegador()
        st, r = self.manda(c, [{'nome': 'tela do hub'}, {'nome': 'vitória'}, {'nome': 'ok_1'}, {'nome': 'x' * 41}, 'lixo'], token=None)
        self.assertEqual(st, 200, r)
        self.assertEqual(r['aceitos'], 1)
        self.assertEqual(r['descartados'], 4)
        self.assertEqual(self.soma('ok_1'), 1)

    def test_n_grande_e_plataforma_fora_da_lista(self):
        c = self.navegador()
        st, r = self.manda(c, [{'nome': 'n_grande', 'n': 9999}], token=None, plataforma='geladeira')
        self.assertEqual(st, 200, r)
        self.assertEqual(self.soma('n_grande'), eventos_uso.N_MAX)
        linha = self.sql("SELECT plataforma FROM eventos_uso WHERE nome = 'n_grande'")[0]
        self.assertEqual(linha['plataforma'], '')

    def test_lote_vazio_e_corpo_errado(self):
        c = self.navegador()
        st, r = c.pede('POST', '/api/registro/eventos', {'eventos': []}, token=None)
        self.assertEqual(st, 400, r)
        st, r = c.pede('POST', '/api/registro/eventos', {'eventos': 'boot'}, token=None)
        self.assertEqual(st, 400, r)

    def test_freio_por_endereco(self):
        c = self.navegador()
        ultimo = None
        for _ in range(eventos_uso.POSTS_POR_MINUTO + 2):
            ultimo = self.manda(c, [{'nome': 'freio'}], token=None)
        self.assertEqual(ultimo[0], 429, ultimo)

    def test_painel_do_mestre(self):
        comum = self.conta('Comum')
        st, r = comum.pede('GET', '/api/mestre/eventos')
        self.assertEqual(st, 403, r)
        self.manda(comum, [{'nome': 'tela:battle', 'n': 5}])
        mestre = self.conta('Guia Funil')
        self.sql("UPDATE contas SET gm = 1 WHERE id = ?", mestre.conta['id'])
        st, r = mestre.pede('GET', '/api/mestre/eventos?dias=7')
        self.assertEqual(st, 200, r)
        self.assertEqual(r['dias'], 7)
        self.assertGreaterEqual(r['porNome'].get('tela:battle', 0), 5)
        hoje = eventos_uso.dia_de(__import__('time').time())
        self.assertIn(hoje, r['porDia'])
        self.assertGreaterEqual(r['porDia'][hoje].get('tela:battle', 0), 5)
        st, r = mestre.pede('GET', '/api/mestre/eventos?dias=9999')
        self.assertEqual(r['dias'], eventos_uso.DIAS_MAX)

    def test_retencao_apaga_o_de_antes(self):
        velho = eventos_uso.dia_de(__import__('time').time() - (eventos_uso.RETENCAO_DIAS + 5) * 86400)
        self.sql("INSERT INTO eventos_uso(dia, nome, versao, plataforma, contagem) VALUES (?, 'velho', '', '', 7)", velho)
        # a faxina roda no próximo lote, mas só a cada FAXINA_S por processo — forço pelo banco mesmo
        # abrindo outro Api não dá (o freio é em memória); então confiro a regra pela função:
        import api as cartorio
        a = cartorio.Api(self.banco)
        with a._escrita():
            a._eventos_faxina(__import__('time').time(), forcar=True)
        self.assertEqual(self.soma('velho'), 0)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    unittest.main(verbosity=2)
