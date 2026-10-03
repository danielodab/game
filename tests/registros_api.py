#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova do registro de erros (servidor/registros.py) — 02/10, antes do lançamento.

    python tests/registros_api.py

Duas metades:
  - pela API DE VERDADE (subprocesso, porta livre, banco descartável): o lote do
    cliente com e sem login, a chave de repetição e o contador, as listas de versões,
    a limpeza (e-mail, IP, token, o domínio e a consulta da URL não chegam ao banco),
    os cortes por campo e por lote, o freio por endereço (cada teste num endereço
    público próprio, pelo X-Forwarded-For), os 30 dias, e o painel do Mestre (403 de
    quem não é; a lista; o "resolvido");
  - no MESMO processo (o Api e o Atendente direto): a exceção não tratada de uma rota
    vira linha 'api' com a pilha só de arquivo:linha e a mensagem limpa, e o teto de
    erros distintos tira o mais quieto.
"""
import json
import logging
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402  (põe servidor/ no sys.path)
import api as cartorio  # noqa: E402
import registros  # noqa: E402


class Navegador(Cliente):
    """O Cliente com um X-Forwarded-For próprio: o freio do registro é por endereço."""

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


class ProvaDoRegistro(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.mkdtemp(prefix='soterra-erros-')
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
        ProvaDoRegistro._n += 1
        return Navegador(self.base, '189.40.%d.%d' % (ProvaDoRegistro._n // 200, ProvaDoRegistro._n % 200 + 1))

    def conta(self, apelido):
        c = self.navegador()
        st, r = c.cadastra('%s %d' % (apelido, ProvaDoRegistro._n))
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

    def linha(self, mensagem):
        r = self.sql("SELECT * FROM erros_registro WHERE mensagem = ?", mensagem)
        return r[0] if r else None

    def manda(self, c, erros, **ctx):
        corpo = {'erros': erros, 'versao': ctx.get('versao', 'v-prova'), 'tela': ctx.get('tela', 'hub'),
                 'navegador': ctx.get('navegador', 'Chrome 120 · Windows')}
        return c.pede('POST', '/api/registro/erros', corpo)

    # -------------------------------------------------------------------------------------
    def test_sem_conta_repetido_soma_na_mesma_linha(self):
        c = self.navegador()
        msg = 'TypeError: a sala não tem mapa (prova 1)'
        st, r = self.manda(c, [{'tipo': 'erro', 'mensagem': msg, 'pilha': 'at monta (http://localhost:8137/js/main.js?v=aaa1:10:5)',
                                'onde': 'http://localhost:8137/js/main.js?v=aaa1:10:5', 'vezes': 3}], versao='v1')
        self.assertEqual((st, r['aceitos']), (200, 1), r)
        # o mesmo erro, noutro deploy (o ?v= mudou) e noutra tela: a mesma linha
        st, r = self.manda(c, [{'tipo': 'erro', 'mensagem': msg, 'pilha': 'at monta (https://soterra.prova/js/main.js?v=bbb2:10:5)',
                                'onde': 'https://soterra.prova/js/main.js?v=bbb2:10:5', 'vezes': 2}], versao='v2', tela='sala')
        self.assertEqual(st, 200, r)
        linhas = self.sql("SELECT * FROM erros_registro WHERE mensagem = ?", msg)
        self.assertEqual(len(linhas), 1, 'a chave de repetição não depende do domínio nem do ?v=')
        e = linhas[0]
        self.assertEqual((e['origem'], e['tipo'], e['contagem']), ('cliente', 'erro', 5))
        self.assertEqual(json.loads(e['versoes']), ['v1', 'v2'])
        self.assertEqual(json.loads(e['telas']), ['hub', 'sala'])
        self.assertEqual(e['onde'], '/js/main.js:10:5')
        self.assertEqual(e['pilha'], 'at monta (/js/main.js:10:5)')
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM erros_registro_contas WHERE chave = ?", e['chave'])[0]['n'], 0)

    def test_nada_de_dado_pessoal_no_banco(self):
        c = self.navegador()
        msg = ('falhou para ana.silva@exemplo.com.br em 189.34.12.7 e 2804:14c:abcd:1234::7 com o token '
               '4f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a (prova 2)')
        st, r = self.manda(c, [{'mensagem': msg, 'pilha': 'at x (http://127.0.0.1:8300/js/core/sessao.js?api=http://a.b:1&t=9:3:1)'}],
                           navegador='N' * 500)
        self.assertEqual(st, 200, r)
        tudo = json.dumps([dict(x) for x in self.sql("SELECT * FROM erros_registro")], ensure_ascii=False)
        for vazado in ('ana.silva', 'exemplo.com.br', '189.34.12.7', '2804:14c', '4f9a8b7c6d5e4f3a2b1c', '?api=', '127.0.0.1'):
            self.assertNotIn(vazado, tudo, vazado)
        e = self.sql("SELECT * FROM erros_registro WHERE mensagem LIKE '%(prova 2)'")[0]
        self.assertIn('<email>', e['mensagem'])
        self.assertIn('<ip>', e['mensagem'])
        self.assertIn('<token>', e['mensagem'])
        self.assertEqual(len(json.loads(e['navegadores'])[0]), registros.CAMPO_MAX)

    def test_cortes_lote_e_campos(self):
        c = self.navegador()
        lote = [{'mensagem': 'lote %d (prova 3)' % i} for i in range(registros.LOTE_MAX + 5)]
        lote.insert(0, {'mensagem': ''})                    # sem mensagem: descartado
        lote.insert(1, 'nem é objeto')
        st, r = self.manda(c, lote)
        self.assertEqual(st, 200, r)
        self.assertEqual(r['aceitos'], registros.LOTE_MAX - 2, r)
        n = self.sql("SELECT COUNT(*) AS n FROM erros_registro WHERE mensagem LIKE 'lote % (prova 3)'")[0]['n']
        self.assertEqual(n, registros.LOTE_MAX - 2)
        st, r = self.manda(c, [{'mensagem': 'M' * 5000 + ' (prova 3b)', 'pilha': '\n'.join('at f%d (a.js:%d:1)' % (i, i)
                                                                                           for i in range(50)),
                                'vezes': 10 ** 9}])
        self.assertEqual(st, 200, r)
        e = self.sql("SELECT * FROM erros_registro WHERE mensagem LIKE 'MMMM%'")[0]
        self.assertEqual(len(e['mensagem']), registros.MENSAGEM_MAX)
        self.assertEqual(len(e['pilha'].splitlines()), registros.PILHA_LINHAS)
        self.assertEqual(e['contagem'], 1, 'um "vezes" absurdo vale 1')
        for torto in ({}, {'erros': []}, {'erros': 'x'}):
            self.assertEqual(c.pede('POST', '/api/registro/erros', torto)[0], 400, torto)

    def test_com_conta_e_token_morto(self):
        a, b = self.conta('Viu Erro'), self.conta('Viu Tambem')
        msg = 'RangeError: estourou (prova 4)'
        self.assertEqual(self.manda(a, [{'mensagem': msg}])[0], 200)
        self.assertEqual(self.manda(b, [{'mensagem': msg}])[0], 200)
        morto = self.navegador()
        morto.token = 'f' * 64
        self.assertEqual(self.manda(morto, [{'mensagem': msg}])[0], 200, 'token morto não é 401 aqui')
        e = self.linha(msg)
        self.assertEqual(e['contagem'], 3)
        contas = {r['conta_id'] for r in self.sql("SELECT conta_id FROM erros_registro_contas WHERE chave = ?", e['chave'])}
        self.assertEqual(contas, {a.conta['id'], b.conta['id']})
        # a conta vem do TOKEN: um conta_id no corpo não vale nada
        st, r = a.pede('POST', '/api/registro/erros', {'erros': [{'mensagem': msg}], 'conta': b.conta['id'] + 999})
        self.assertEqual(st, 200)
        self.assertEqual(len(self.sql("SELECT * FROM erros_registro_contas WHERE chave = ?", e['chave'])), 2)

    def test_freio_por_endereco(self):
        c = self.navegador()
        for i in range(registros.POSTS_POR_MINUTO):
            st, r = self.manda(c, [{'mensagem': 'freio %d (prova 5)' % i}])
            self.assertEqual(st, 200, r)
        st, r = self.manda(c, [{'mensagem': 'freio demais (prova 5)'}])
        self.assertEqual(st, 429, r)
        self.assertIsNone(self.linha('freio demais (prova 5)'))
        outro = self.navegador()
        self.assertEqual(self.manda(outro, [{'mensagem': 'outro endereço (prova 5)'}])[0], 200)

    def test_painel_do_mestre_e_os_30_dias(self):
        m, comum = self.conta('Guia Erros'), self.conta('Sem Marca')
        self.sql("UPDATE contas SET gm = 1 WHERE id = ?", m.conta['id'])
        st, r = comum.pede('GET', '/api/mestre/erros')
        self.assertEqual(st, 403, r)
        self.assertEqual(self.manda(comum, [{'mensagem': 'para o painel (prova 6)', 'pilha': 'at p (a.js:1:1)'}])[0], 200)
        # um erro quieto há mais de 30 dias: a faxina do painel o leva
        velho = int(time.time()) - registros.RETENCAO_DIAS * 86400 - 60
        self.sql("INSERT INTO erros_registro(chave, origem, tipo, mensagem, contagem, primeira_em, ultima_em) "
                 "VALUES ('%s', 'cliente', 'erro', 'velho demais (prova 6)', 4, ?, ?)" % ('0' * 32), velho, velho)
        st, r = m.pede('GET', '/api/mestre/erros')
        self.assertEqual(st, 200, r)
        self.assertEqual(r['retencaoDias'], registros.RETENCAO_DIAS)
        msgs = [e['mensagem'] for e in r['erros']]
        self.assertIn('para o painel (prova 6)', msgs)
        self.assertNotIn('velho demais (prova 6)', msgs)
        self.assertIsNone(self.linha('velho demais (prova 6)'))
        e = next(x for x in r['erros'] if x['mensagem'] == 'para o painel (prova 6)')
        self.assertEqual((e['contas'], e['origem'], e['pilha'], e['versoes']), (1, 'cliente', 'at p (a.js:1:1)', ['v-prova']))
        ultimos = [x['ultimaEm'] for x in r['erros']]
        self.assertEqual(ultimos, sorted(ultimos, reverse=True), 'o mais recente primeiro')
        self.assertNotIn('email', json.dumps(r).lower().replace('<email>', ''), 'o painel não tem e-mail de ninguém')
        # resolvido: o grupo sai
        self.assertEqual(m.pede('POST', '/api/mestre/erros/apagar', {'chave': 'nada'})[0], 400)
        self.assertEqual(comum.pede('POST', '/api/mestre/erros/apagar', {'chave': e['chave']})[0], 403)
        st, r = m.pede('POST', '/api/mestre/erros/apagar', {'chave': e['chave']})
        self.assertEqual((st, r['apagados']), (200, 1), r)
        self.assertIsNone(self.linha('para o painel (prova 6)'))
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM erros_registro_contas WHERE chave = ?", e['chave'])[0]['n'], 0)


class ProvaDentroDoProcesso(unittest.TestCase):
    """O Api e o Atendente no mesmo processo: a exceção não tratada e o teto de chaves."""

    def setUp(self):
        self.pasta = tempfile.mkdtemp(prefix='soterra-erros-dentro-')
        self.api = cartorio.Api(os.path.join(self.pasta, 'soterra.db'))
        # o log.exception do Atendente (o journal, em produção) sujaria a saída da prova
        self.nivel = logging.getLogger('api').level
        logging.getLogger('api').setLevel(logging.CRITICAL)

    def tearDown(self):
        logging.getLogger('api').setLevel(self.nivel)
        self.api.con.close()
        shutil.rmtree(self.pasta, ignore_errors=True)

    def test_excecao_da_api_vira_linha_api(self):
        def explode(api_self, conta, corpo):
            raise ValueError('quebrou ao ler ana@exemplo.com da conta')
        cartorio.Api.prova_explode = explode
        cartorio.ROTAS[('GET', '/api/prova/explode')] = ('prova_explode', False)
        cartorio.Atendente.api = self.api
        srv = ThreadingHTTPServer(('127.0.0.1', 0), cartorio.Atendente)
        th = threading.Thread(target=srv.serve_forever, daemon=True)
        th.start()
        try:
            url = 'http://127.0.0.1:%d/api/prova/explode' % srv.server_address[1]
            for _ in range(2):
                try:
                    urllib.request.urlopen(url, timeout=10)
                    self.fail('a rota tinha de estourar')
                except urllib.error.HTTPError as e:
                    self.assertEqual(e.code, 500)
                    self.assertEqual(json.loads(e.read().decode('utf-8'))['erro'], 'erro interno do servidor')
        finally:
            srv.shutdown()
            srv.server_close()
            del cartorio.ROTAS[('GET', '/api/prova/explode')]
            del cartorio.Api.prova_explode
        linhas = self.api.con.execute("SELECT * FROM erros_registro WHERE origem = 'api'").fetchall()
        self.assertEqual(len(linhas), 1, 'a mesma exceção duas vezes: uma linha')
        e = linhas[0]
        self.assertEqual((e['tipo'], e['contagem'], e['onde']), ('excecao', 2, 'GET /api/prova/explode'))
        self.assertTrue(e['mensagem'].startswith('ValueError: '), e['mensagem'])
        self.assertIn('<email>', e['mensagem'])
        self.assertNotIn('ana@', e['mensagem'])
        primeira = e['pilha'].splitlines()[0]
        self.assertRegex(primeira, r'^registros_api\.py:\d+ em explode$', 'só arquivo:linha em função, do quadro mais fundo')

    def test_teto_de_erros_distintos_tira_o_mais_quieto(self):
        velho = registros.CHAVES_MAX
        registros.CHAVES_MAX = 3
        try:
            t = int(time.time())
            for i in range(4):
                ent = registros.le_entrada({'mensagem': 'teto %d' % i})
                with self.api._escrita():
                    self.api._registro_grava('cliente', ent, {}, None, t + i)
            msgs = sorted(r[0] for r in self.api.con.execute("SELECT mensagem FROM erros_registro"))
            self.assertEqual(msgs, ['teto 1', 'teto 2', 'teto 3'])
        finally:
            registros.CHAVES_MAX = velho

    def test_teto_o_do_cliente_nao_despeja_o_da_api(self):
        """03/10 (revisão): um endereço só enchia o teto e apagava as exceções da API."""
        velho = registros.CHAVES_MAX
        registros.CHAVES_MAX = 3
        try:
            with self.api._escrita():
                self.api.con.execute("DELETE FROM erros_registro")
            t = int(time.time()) - 1000
            with self.api._escrita():
                for i, origem in enumerate(('api', 'api', 'cliente')):
                    self.api._registro_grava(origem, registros.le_entrada({'mensagem': 'base %d' % i}), {}, None, t + i)
            for i in range(3):
                with self.api._escrita():
                    self.api._registro_grava('cliente', registros.le_entrada({'mensagem': 'enche %d' % i}), {}, None,
                                             t + 10 + i)
            linhas = sorted((r[0], r[1]) for r in self.api.con.execute("SELECT origem, mensagem FROM erros_registro"))
            self.assertEqual(linhas, [('api', 'base 0'), ('api', 'base 1'), ('cliente', 'enche 2')])
            # a da API ainda despeja a do cliente
            with self.api._escrita():
                self.api._registro_grava('api', registros.le_entrada({'mensagem': 'api nova'}), {}, None, t + 20)
            self.assertEqual(sorted(r[0] for r in self.api.con.execute("SELECT origem FROM erros_registro")),
                             ['api', 'api', 'api'])
            # só há da API: o do cliente fica de fora
            with self.api._escrita():
                fora = self.api._registro_grava('cliente', registros.le_entrada({'mensagem': 'sem lugar'}), {}, None,
                                                t + 30)
            self.assertIsNone(fora)
            self.assertEqual(self.api.con.execute("SELECT COUNT(*) FROM erros_registro").fetchone()[0], 3)
        finally:
            registros.CHAVES_MAX = velho
            with self.api._escrita():
                self.api.con.execute("DELETE FROM erros_registro")

    def test_sem_conta_abre_poucas_linhas_novas_por_hora(self):
        velho = registros.NOVAS_SEM_CONTA_HORA
        registros.NOVAS_SEM_CONTA_HORA = 2
        try:
            corpo = lambda msgs, vezes=1: {'_ip': '198.51.100.77', 'erros': [  # noqa: E731
                {'mensagem': m, 'vezes': vezes} for m in msgs]}
            st, r = self.api.registro_erros(None, corpo(['anon a', 'anon b', 'anon c']))
            self.assertEqual((st, r['aceitos'], r['descartados']), (200, 2, 1), r)
            # repetir um que já existe segue valendo; e o "vezes" de quem não tem conta tem teto
            st, r = self.api.registro_erros(None, corpo(['anon a'], vezes=1000))
            self.assertEqual(r['aceitos'], 1, r)
            n = self.api.con.execute("SELECT contagem FROM erros_registro WHERE mensagem = 'anon a'").fetchone()[0]
            self.assertEqual(n, 1 + registros.VEZES_SEM_CONTA)
            # outro endereço tem a própria cota
            st, r = self.api.registro_erros(None, dict(corpo(['anon d']), _ip='198.51.100.78'))
            self.assertEqual(r['aceitos'], 1, r)
        finally:
            registros.NOVAS_SEM_CONTA_HORA = velho

    def test_limpa(self):
        self.assertEqual(registros.limpa('ok? sim', 50), 'ok? sim', 'o "?" de frase fica')
        self.assertEqual(registros.limpa("Unexpected token '?'", 50), "Unexpected token '?'")
        self.assertEqual(registros.limpa('at f (https://soterra.viidoo.io/js/hud.js?v=3fa2b1c9d0e1:12:5)', 80),
                         'at f (/js/hud.js:12:5)')
        self.assertEqual(registros.limpa('desenhaAlgumaCoisaMuitoCompridaDemais', 80),
                         'desenhaAlgumaCoisaMuitoCompridaDemais', 'nome de função sem número não é token')


if __name__ == '__main__':
    unittest.main(verbosity=2)
