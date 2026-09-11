#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova da conta no site (servidor/conta.py e servidor/correio.py), pela API de verdade.

    python tests/conta_api.py

Sobe servidor/api.py num subprocesso com --emails-prova: cada e-mail vira uma
linha JSON num arquivo da pasta temporária e nada sai da máquina. O código de
6 dígitos é lido desse arquivo, como a pessoa o leria na caixa de entrada.
Contas, senhas e e-mails são sintéticos, gerados aqui; o banco é descartável.

O que se prova: trocar a senha (e as outras sessões morrem), trocar o e-mail
com código (que vai ao e-mail ATUAL, e o aviso ao ANTIGO), o "esqueci a senha"
(a mesma resposta, no mesmo tempo, para conta que existe e que não existe), as
sessões, os limites (por conta, por IP lido do X-Forwarded-For da direita para
a esquerda, e o global), 401 só para token morto, o servidor sem correio e
com o SMTP caído, e que o código nunca vai para o log.

E o login que não conta quem tem conta (a mesma frase, o mesmo PBKDF2, o mesmo
tempo e a mesma 11ª para o nome que não existe); os freios por IP que contam só
as senhas ERRADAS, cada rota com senha no seu balde (40 logins certos do mesmo
IP na hora passam); os tetos dos acertos, por conta; e o IPv6 contado pelo /64.
"""
import http.client
import ipaddress
import json
import os
import re
import secrets
import shutil
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402  (põe servidor/ no sys.path)
import comum  # noqa: E402
import conta as conta_mod  # noqa: E402
import correio as correio_mod  # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

SENHA = 'segredo-bom-8'
TROCA = 'SOTERRA: código para trocar o e-mail da conta'
ESQUECI = 'SOTERRA: código para redefinir a senha'
SENHA_TROCADA = 'SOTERRA: sua senha foi trocada'
EMAIL_TROCADO = 'SOTERRA: o e-mail da conta mudou'
FRASE = conta_mod.FRASE_ESQUECI
RE_CODIGO = re.compile(r'\b(\d{6})\b')
RE_ID = re.compile(r'^[0-9a-f]{12}$')


def ambiente_limpo(**extra):
    """O ambiente do teste sem nenhuma SOTERRA_* da máquina (nada de SMTP de verdade)."""
    env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
    env['PYTHONIOENCODING'] = 'utf-8'           # o log em UTF-8 também no Windows (senão sai em cp1252)
    env.update(extra)
    return env


def sobe_api(pasta, nome, *extra, env=None):
    """Um processo da API num banco próprio da pasta; devolve (proc, log, base, caminho_do_log)."""
    porta = porta_livre()
    caminho_log = os.path.join(pasta, nome + '.log')
    log = open(caminho_log, 'w', encoding='utf-8')
    proc = subprocess.Popen([sys.executable, API, '--porta', str(porta), '--banco',
                             os.path.join(pasta, nome, 'soterra.db')] + list(extra),
                            stdout=log, stderr=subprocess.STDOUT, env=env or ambiente_limpo())
    base = 'http://127.0.0.1:%d' % porta
    if not espera_api(base, proc):
        para(proc, log)
        raise RuntimeError('a API %s não subiu; veja %s' % (nome, caminho_log))
    return proc, log, base, caminho_log


def para(proc, log):
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()
    log.close()


def le(caminho):
    with open(caminho, encoding='utf-8', errors='replace') as f:
        return f.read()


def pede_cru(base, metodo, rota, corpo, cabecalhos):
    """Um pedido com cabeçalhos REPETIDOS (dois X-Forwarded-For): o urllib
    guarda os cabeçalhos num dicionário e perderia o segundo."""
    host, porta = base.replace('http://', '').split(':')
    dados = json.dumps(corpo).encode('utf-8')
    con = http.client.HTTPConnection(host, int(porta), timeout=30)
    try:
        con.putrequest(metodo, rota)
        con.putheader('Content-Type', 'application/json')
        con.putheader('Content-Length', str(len(dados)))
        for nome, valor in cabecalhos:
            con.putheader(nome, valor)
        con.endheaders(dados)
        r = con.getresponse()
        return r.status, json.loads(r.read().decode('utf-8'))
    finally:
        con.close()


class Jogador(Cliente):
    """O Cliente do servidor_api, com User-Agent e X-Forwarded-For escolhidos."""

    def __init__(self, base, agente=None, xff=None):
        super().__init__(base)
        self.agente, self.xff, self.email, self.senha = agente, xff, None, SENHA

    def pede(self, metodo, rota, corpo=None, token='sessao'):
        dados = None if corpo is None else json.dumps(corpo).encode('utf-8')
        req = urllib.request.Request(self.base + rota, data=dados, method=metodo)
        req.add_header('Content-Type', 'application/json')
        if self.agente:
            req.add_header('User-Agent', self.agente)
        if self.xff:
            req.add_header('X-Forwarded-For', self.xff)
        tk = self.token if token == 'sessao' else token
        if tk:
            req.add_header('Authorization', 'Bearer ' + tk)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode('utf-8'))


class ProvaDaConta(unittest.TestCase):
    _n = 0
    codigos = []            # todo código lido nos e-mails: nenhum pode aparecer no log

    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.mkdtemp(prefix='soterra-conta-')
        cls.emails_arq = os.path.join(cls.pasta, 'emails.jsonl')
        cls.proc, cls.log, cls.base, cls.log_arq = sobe_api(cls.pasta, 'api', '--emails-prova', cls.emails_arq)

    @classmethod
    def tearDownClass(cls):
        para(cls.proc, cls.log)
        shutil.rmtree(cls.pasta, ignore_errors=True)

    # -- ajudantes ------------------------------------------------------------------
    def novo(self, apelido, base=None, **kw):
        ProvaDaConta._n += 1
        nome = '%s %d' % (apelido, ProvaDaConta._n)
        c = Jogador(base or self.base, **kw)
        c.email = '%s@soterra.test' % nome.replace(' ', '').lower()
        status, r = c.cadastra(nome, c.email, SENHA)
        self.assertEqual(status, 201, r)
        return c

    def entra(self, c, senha=None, **kw):
        """Uma sessão nova da mesma conta (outro navegador, outra máquina)."""
        outro = Jogador(c.base, **kw)
        status, r = outro.pede('POST', '/api/login', {'login': c.conta['nome'], 'senha': senha or c.senha})
        self.assertEqual(status, 200, r)
        outro.token, outro.conta, outro.email, outro.senha = r['token'], r['conta'], c.email, senha or c.senha
        return outro

    def banco(self, pasta=None):
        b = sqlite3.connect(os.path.join(pasta or self.pasta, 'api', 'soterra.db'))
        b.row_factory = sqlite3.Row
        return b

    def sql(self, consulta, *args):
        b = self.banco()
        try:
            linhas = b.execute(consulta, args).fetchall()
            b.commit()
            return linhas
        finally:
            b.close()

    def enche(self, chave, quantas, em=None):
        """`quantas` linhas no balde `chave` (a tabela limites), como se tivessem chegado agora."""
        b = self.banco()
        try:
            b.executemany("INSERT INTO limites(chave, em) VALUES (?, ?)", [(chave, em or int(time.time()))] * quantas)
            b.commit()
        finally:
            b.close()

    def emails(self, para=None, assunto=None):
        if not os.path.exists(self.emails_arq):
            return []
        saida = []
        with open(self.emails_arq, encoding='utf-8') as f:
            for linha in f:
                if not linha.endswith('\n'):
                    continue                    # a thread do servidor ainda escrevendo
                m = json.loads(linha)
                if (para is None or m['para'].lower() == para.lower()) and (assunto is None or m['assunto'] == assunto):
                    saida.append(m)
        return saida

    def espera_email(self, para, assunto, ja=0, segundos=8):
        """O (ja+1)-ésimo e-mail com esse assunto para esse endereço."""
        limite = time.time() + segundos
        while time.time() < limite:
            lista = self.emails(para, assunto)
            if len(lista) > ja:
                return lista[ja]
            time.sleep(0.1)
        self.fail('não chegou "%s" para %s' % (assunto, para))

    def codigo(self, msg):
        m = RE_CODIGO.search(msg['texto'])
        self.assertIsNotNone(m, msg['texto'])
        ProvaDaConta.codigos.append(m.group(1))
        return m.group(1)

    @staticmethod
    def errado(codigo):
        return '%06d' % ((int(codigo) + 1) % 10 ** 6)

    # -- os contratos gerais ----------------------------------------------------------
    def test_saude_traz_correio(self):
        status, r = Cliente(self.base).pede('GET', '/api/saude')
        self.assertEqual(status, 200, r)
        self.assertIs(r['correio'], True)
        self.assertIn('correio: PROVA em ' + self.emails_arq, le(self.log_arq))

    def test_401_so_para_token_morto(self):
        for rota, metodo, corpo in (('/api/conta', 'GET', None), ('/api/conta/senha', 'POST', {}),
                                    ('/api/conta/email/pedir', 'POST', {}), ('/api/conta/email/confirmar', 'POST', {}),
                                    ('/api/conta/sessoes/encerrar', 'POST', {'outras': True})):
            self.assertEqual(Cliente(self.base).pede(metodo, rota, corpo)[0], 401, rota)
            self.assertEqual(Cliente(self.base).pede(metodo, rota, corpo, token='0' * 64)[0], 401, rota)
        c = self.novo('Dino Token')
        # senha atual errada, código errado, pedido torto: 400, nunca 401 (o jogo
        # desligaria a Nuvem num 401)
        self.assertEqual(c.pede('POST', '/api/conta/senha', {'atual': 'errada-errada', 'nova': 'nova-senha-9'})[0], 400)
        self.assertEqual(c.pede('POST', '/api/conta/email/pedir', {'senha': 'errada-errada',
                                                                    'novoEmail': 'dino.x@soterra.test'})[0], 400)
        self.assertEqual(c.pede('POST', '/api/conta/email/confirmar', {'codigo': '123456'})[0], 400)
        self.assertEqual(c.pede('POST', '/api/conta/sessoes/encerrar', {})[0], 400)
        self.assertEqual(c.pede('GET', '/api/eu')[0], 200)          # a sessão continua viva

    def test_recusa_dos_modulos_vira_400_pelo_http(self):
        """A armadilha do __main__: a Recusa levantada em conta.py e em loja.py
        tem de ser a MESMA classe que o atendente pega — 400, não 500."""
        c = self.novo('Rui Recusa')
        status, r = c.pede('POST', '/api/conta/senha', {})
        self.assertEqual((status, r), (400, {'ok': False, 'erro': 'informe a senha atual e a nova'}))
        status, r = c.pede('POST', '/api/loja/comprar', {'sku': 'nada', 'idem': 'abcdefgh'})
        self.assertEqual((status, r), (400, {'ok': False, 'erro': 'produto desconhecido'}))
        self.assertNotIn('erro em ', le(self.log_arq))

    def test_conta_dados(self):
        c = self.novo('Clara Dados')
        status, r = c.pede('GET', '/api/conta')
        self.assertEqual(status, 200, r)
        self.assertEqual(set(r), {'ok', 'conta', 'correio', 'sessoes', 'atividade', 'trocaEmail'})
        self.assertEqual(r['conta'], {'id': c.conta['id'], 'nome': c.conta['nome'], 'email': c.email,
                                      'criadoEm': r['conta']['criadoEm'], 'gm': False})
        self.assertLessEqual(abs(r['conta']['criadoEm'] - time.time()), 10)
        self.assertIs(r['correio'], True)
        self.assertIsNone(r['trocaEmail'])
        self.assertEqual([a['tipo'] for a in r['atividade']], ['cadastro'])
        self.assertEqual(set(r['atividade'][0]), {'tipo', 'em'})
        self.assertEqual(len(r['sessoes']), 1)
        self.assertNotIn(c.token, json.dumps(r))                    # o token nunca sai do servidor
        # o /api/eu não mudou (o jogo depende dele)
        status, eu = c.pede('GET', '/api/eu')
        self.assertEqual(set(eu['conta']), {'id', 'nome', 'email', 'criadoEm', 'gm'})

    def test_sessoes(self):
        chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36'
        iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'
        c = self.novo('Sofia Sessao', agente=chrome, xff='45.160.3.7')
        c2 = self.entra(c, agente=iphone, xff='10.0.0.9, 187.20.30.40')      # o público mais à direita
        c3 = self.entra(c, agente='Firefox/131.0 ' + 'x' * 300)
        c4 = self.entra(c)
        status, r = c.pede('GET', '/api/conta')
        self.assertEqual(status, 200, r)
        s = r['sessoes']
        self.assertEqual(len(s), 4)
        self.assertTrue(all(RE_ID.match(x['id']) for x in s))
        self.assertEqual(len({x['id'] for x in s}), 4)
        self.assertEqual([x['estaAqui'] for x in s].count(True), 1)
        aqui = [x for x in s if x['estaAqui']][0]
        self.assertEqual((aqui['agente'], aqui['ip']), (chrome, '45.160.*.*'))
        self.assertEqual(set(aqui), {'id', 'criadoEm', 'ultimoUso', 'agente', 'ip', 'estaAqui'})
        por_agente = {x['agente']: x for x in s}
        self.assertEqual(por_agente[iphone]['ip'], '187.20.*.*')
        self.assertEqual(len([x for x in s if (x['agente'] or '').startswith('Firefox/131.0')][0]['agente']), 160)
        self.assertIn('127.0.*.*', [x['ip'] for x in s])
        texto = json.dumps(r)
        for tk in (c.token, c2.token, c3.token, c4.token):
            self.assertNotIn(tk, texto)
        self.assertNotIn('45.160.3.7', texto)
        self.assertEqual([a['tipo'] for a in r['atividade']], ['login', 'login', 'login', 'cadastro'])
        # uma, pelo id
        id3 = [x['id'] for x in s if (x['agente'] or '').startswith('Firefox/131.0')][0]
        status, r = c.pede('POST', '/api/conta/sessoes/encerrar', {'id': id3})
        self.assertEqual((status, r), (200, {'ok': True, 'encerradas': 1, 'estaEncerrada': False}))
        self.assertEqual(c3.pede('GET', '/api/eu')[0], 401)
        self.assertEqual(c.pede('POST', '/api/conta/sessoes/encerrar', {'id': id3})[0], 404)
        self.assertEqual(c.pede('POST', '/api/conta/sessoes/encerrar', {'id': '0' * 12})[0], 404)
        # sessão de OUTRA conta não se encerra por aqui
        outro = self.novo('Outro Sessao')
        id_outro = outro.pede('GET', '/api/conta')[1]['sessoes'][0]['id']
        self.assertEqual(c.pede('POST', '/api/conta/sessoes/encerrar', {'id': id_outro})[0], 404)
        self.assertEqual(outro.pede('GET', '/api/eu')[0], 200)
        for torto in ({}, {'id': 5}, {'outras': True, 'todas': True}, {'outras': 1}, {'todas': 'sim'},
                      {'outras': True, 'id': id3}):
            status, r = c.pede('POST', '/api/conta/sessoes/encerrar', torto)
            self.assertEqual((status, r.get('erro')), (400, 'diga o que encerrar: outras, id ou todas'), torto)
        # as outras
        status, r = c.pede('POST', '/api/conta/sessoes/encerrar', {'outras': True})
        self.assertEqual((status, r), (200, {'ok': True, 'encerradas': 2, 'estaEncerrada': False}))
        self.assertEqual((c2.pede('GET', '/api/eu')[0], c4.pede('GET', '/api/eu')[0], c.pede('GET', '/api/eu')[0]),
                         (401, 401, 200))
        # todas, inclusive esta
        c5 = self.entra(c)
        status, r = c5.pede('POST', '/api/conta/sessoes/encerrar', {'todas': True})
        self.assertEqual((status, r), (200, {'ok': True, 'encerradas': 2, 'estaEncerrada': True}))
        self.assertEqual((c.pede('GET', '/api/eu')[0], c5.pede('GET', '/api/eu')[0]), (401, 401))
        c6 = self.entra(c)
        tipos = [a['tipo'] for a in c6.pede('GET', '/api/conta')[1]['atividade']]
        self.assertEqual(tipos[:4], ['login', 'sessoes-encerradas', 'login', 'sessoes-encerradas'])
        # sessoes_extra morre junto com a sessão (ON DELETE CASCADE)
        orfas = self.sql("SELECT COUNT(*) FROM sessoes_extra x LEFT JOIN sessoes s ON s.token = x.token "
                         "WHERE s.token IS NULL")[0][0]
        self.assertEqual(orfas, 0)

    # -- trocar a senha ----------------------------------------------------------------
    def test_trocar_senha(self):
        c = self.novo('Tito Senha')
        c2, c3 = self.entra(c), self.entra(c)
        casos = [({}, 'informe a senha atual e a nova'), ({'atual': SENHA}, 'informe a senha atual e a nova'),
                 ({'atual': SENHA, 'nova': 'curta'}, 'a senha nova precisa ter pelo menos 8 caracteres'),
                 ({'atual': SENHA, 'nova': SENHA}, 'a senha nova é igual à atual'),
                 ({'atual': 'errada-errada', 'nova': 'outra-senha-9'}, 'senha atual errada')]
        for corpo, erro in casos:
            status, r = c.pede('POST', '/api/conta/senha', corpo)
            self.assertEqual((status, r.get('erro')), (400, erro), corpo)
        status, r = c.pede('POST', '/api/conta/senha', {'atual': SENHA, 'nova': 'outra-senha-9'})
        self.assertEqual((status, r), (200, {'ok': True, 'sessoesEncerradas': 2}))
        self.assertEqual((c.pede('GET', '/api/eu')[0], c2.pede('GET', '/api/eu')[0], c3.pede('GET', '/api/eu')[0]),
                         (200, 401, 401))
        nome = c.conta['nome']
        self.assertEqual(Cliente(self.base).pede('POST', '/api/login', {'login': nome, 'senha': 'outra-senha-9'})[0], 200)
        self.assertEqual(Cliente(self.base).pede('POST', '/api/login', {'login': nome, 'senha': SENHA})[0], 401)
        aviso = self.espera_email(c.email, SENHA_TROCADA)
        self.assertIn('esqueci a senha', aviso['texto'])
        self.assertIsNone(RE_CODIGO.search(aviso['texto']))
        tipos = [a['tipo'] for a in c.pede('GET', '/api/conta')[1]['atividade']]
        self.assertIn('senha-trocada', tipos)
        self.assertIn('senha-recusada', tipos)

    # -- trocar o e-mail -----------------------------------------------------------------
    def test_pedido_com_senha_errada_soma_no_login(self):
        """Senha errada no pedido de e-mail soma na contagem do login (um token
        roubado não vira máquina de chutar); mas a tranca só barra quem ERRA:
        com a conta trancada, a senha certa passa no pedido, na troca de senha e
        no login — é a saída que antes não existia."""
        c = self.novo('Teimoso Email')
        novo = 'teimoso.novo.%d@soterra.test' % ProvaDaConta._n
        for i in range(10):
            status, r = c.pede('POST', '/api/conta/email/pedir', {'senha': 'errada-%d-x' % i, 'novoEmail': novo})
            self.assertEqual((status, r.get('erro')), (400, 'senha errada'), i)
        # a 11ª errada: 429, com liberaEm, sem gravar tentativa nova
        status, r = c.pede('POST', '/api/conta/email/pedir', {'senha': 'errada-11-x', 'novoEmail': novo})
        self.assertEqual((status, r.get('erro')), (429, 'muitas tentativas; espere 10 minutos'), r)
        self.assertTrue(isinstance(r.get('liberaEm'), int) and r['liberaEm'] > time.time(), r)
        # a MESMA contagem do login: quem chuta para lá também
        status, r = Cliente(self.base).pede('POST', '/api/login', {'login': c.conta['nome'], 'senha': 'errada-12-x'})
        self.assertEqual(status, 429, r)
        self.assertIn('liberaEm', r)
        self.assertEqual(self.emails(c.email), [])
        atividade = [a['tipo'] for a in c.pede('GET', '/api/conta')[1]['atividade']]
        self.assertEqual(atividade.count('senha-recusada'), 10)
        # quem SABE a senha nunca é trancado: o pedido passa (e o código sai)...
        status, r = c.pede('POST', '/api/conta/email/pedir', {'senha': SENHA, 'novoEmail': novo})
        self.assertEqual(status, 200, r)
        self.codigo(self.espera_email(c.email, TROCA))
        # ...sem destrancar para quem chuta...
        status, r = c.pede('POST', '/api/conta/senha', {'atual': 'errada-13-x', 'nova': 'escapei-da-tranca-9'})
        self.assertEqual(status, 429, r)
        # ...e a troca de senha com a atual certa é a saída: entra, e zera a contagem
        status, r = c.pede('POST', '/api/conta/senha', {'atual': SENHA, 'nova': 'escapei-da-tranca-9'})
        self.assertEqual((status, r), (200, {'ok': True, 'sessoesEncerradas': 0}))
        status, r = Cliente(self.base).pede('POST', '/api/login', {'login': c.conta['nome'], 'senha': 'escapei-da-tranca-9'})
        self.assertEqual(status, 200, r)
        status, r = Cliente(self.base).pede('POST', '/api/login', {'login': c.conta['nome'], 'senha': SENHA})
        self.assertEqual(status, 401, r)                  # a velha já não vale, e a contagem recomeçou do zero

    def test_pedir_email_usado_gasta_a_cota(self):
        """O 409 "esse e-mail já tem conta" vem DEPOIS da cota e a gasta: sondar
        quem tem conta custa o mesmo que pedir um código (3 por hora, 1 por
        minuto) — o esqueci esconde isso de propósito, e esta rota entregava de
        graça. O código aberto sobrevive à sondagem."""
        c = self.novo('Sonda Email')
        alvo = self.novo('Sonda Alvo')
        livre = 'sonda.livre.%d@soterra.test' % ProvaDaConta._n

        def pedir(email):
            return c.pede('POST', '/api/conta/email/pedir', {'senha': SENHA, 'novoEmail': email})

        def recua():
            self.sql("UPDATE codigos SET criado_em = criado_em - 120 WHERE conta_id = ?", c.conta['id'])

        self.assertEqual(pedir(livre)[0], 200)                       # um pedido de verdade: código aberto
        codigo = self.codigo(self.espera_email(c.email, TROCA))
        recua()
        status, r = pedir(alvo.email)
        self.assertEqual((status, r['erro']), (409, 'esse e-mail já tem conta'))
        # a sondagem contou: o pedido seguinte espera o minuto — para qualquer endereço
        for email in (alvo.email, livre):
            status, r = pedir(email)
            self.assertEqual((status, r['erro']), (429, 'espere 1 minuto para pedir outro código'), email)
            self.assertLessEqual(abs(r['liberaEm'] - (time.time() + 60)), 5)
        # a troca pedida continua de pé; nada foi ao endereço sondado; sem evento de pedido a mais
        self.assertEqual(c.pede('GET', '/api/conta')[1]['trocaEmail']['para'], livre)
        self.assertEqual(self.emails(alvo.email), [])
        self.assertEqual([a['tipo'] for a in c.pede('GET', '/api/conta')[1]['atividade']].count('email-pedido'), 1)
        recua()
        self.assertEqual(pedir(alvo.email)[0], 409)                  # a 2ª sondagem: 3 pedidos na hora
        recua()
        for email in (alvo.email, livre):                            # a 3ª: 429, exista o endereço ou não
            status, r = pedir(email)
            self.assertEqual((status, r['erro']), (429, 'pedidos demais: são 3 códigos por hora; espere'), email)
            mais_velho = self.sql("SELECT MIN(criado_em) FROM codigos WHERE conta_id = ?", c.conta['id'])[0][0]
            self.assertEqual(r['liberaEm'], mais_velho + 3600)
        # o código aberto ainda confirma
        status, r = c.pede('POST', '/api/conta/email/confirmar', {'codigo': codigo})
        self.assertEqual((status, r['conta']['email']), (200, livre), r)
        self.assertEqual(alvo.pede('GET', '/api/eu')[1]['conta']['email'], alvo.email)

    def test_troca_de_email_completa(self):
        c = self.novo('Lara Troca')
        velho, novo = c.email, 'lara.nova.%d@soterra.test' % ProvaDaConta._n
        # (o 409 do e-mail já usado fica em test_pedir_email_usado_gasta_a_cota: ele gasta a cota)
        casos = [({'senha': SENHA}, 400, 'informe a senha e o e-mail novo'),
                 ({'senha': SENHA, 'novoEmail': 'sem-arroba'}, 400, 'e-mail inválido'),
                 ({'senha': SENHA, 'novoEmail': 'a@b'}, 400, 'e-mail inválido'),
                 ({'senha': SENHA, 'novoEmail': novo + ',vitima@soterra.test'}, 400, 'e-mail inválido'),
                 ({'senha': SENHA, 'novoEmail': velho.upper()}, 400, 'esse já é o e-mail da conta')]
        for corpo, st, erro in casos:
            status, r = c.pede('POST', '/api/conta/email/pedir', corpo)
            self.assertEqual((status, r.get('erro')), (st, erro), corpo)
        t = time.time()
        status, r = c.pede('POST', '/api/conta/email/pedir', {'senha': SENHA, 'novoEmail': novo})
        self.assertEqual(status, 200, r)
        self.assertEqual(r['enviadoPara'], conta_mod.mascara_email(velho))
        self.assertTrue(r['enviadoPara'].startswith(velho[:2] + '***@'))
        self.assertLessEqual(abs(r['expiraEm'] - (t + 900)), 5)
        self.assertLessEqual(abs(r['reenviarEm'] - (t + 60)), 5)
        # o código vai ao e-mail ATUAL, cita o novo e o alerta de quem sabia a senha
        msg = self.espera_email(velho, TROCA)
        self.assertIn(novo, msg['texto'])
        self.assertIn('troque a senha agora', msg['texto'])
        codigo = self.codigo(msg)
        self.assertEqual(self.emails(novo), [])                     # nada vai ao endereço novo
        status, r = c.pede('GET', '/api/conta')
        self.assertEqual(r['trocaEmail'], {'para': novo, 'enviadoPara': conta_mod.mascara_email(velho),
                                           'expiraEm': r['trocaEmail']['expiraEm'],
                                           'reenviarEm': r['trocaEmail']['reenviarEm']})
        self.assertEqual(c.pede('POST', '/api/conta/email/confirmar', {'codigo': 'abc'})[1]['erro'], 'o código tem 6 dígitos')
        self.assertEqual(c.pede('POST', '/api/conta/email/confirmar', {'codigo': 123456})[0], 400)
        status, r = c.pede('POST', '/api/conta/email/confirmar', {'codigo': codigo})
        self.assertEqual(status, 200, r)
        self.assertEqual(r['conta'], {'id': c.conta['id'], 'nome': c.conta['nome'], 'email': novo,
                                      'criadoEm': r['conta']['criadoEm'], 'gm': False})
        self.assertEqual(c.pede('GET', '/api/eu')[1]['conta']['email'], novo)
        self.assertEqual(Cliente(self.base).pede('POST', '/api/login', {'login': novo, 'senha': SENHA})[0], 200)
        # o aviso vai ao ANTIGO, com o novo mascarado
        aviso = self.espera_email(velho, EMAIL_TROCADO)
        self.assertIn(conta_mod.mascara_email(novo), aviso['texto'])
        self.assertNotIn(novo, aviso['texto'])
        r = c.pede('GET', '/api/conta')[1]
        self.assertIsNone(r['trocaEmail'])
        self.assertEqual([a['tipo'] for a in r['atividade']][:3], ['login', 'email-trocado', 'email-pedido'])
        status, r = c.pede('POST', '/api/conta/email/confirmar', {'codigo': codigo})
        self.assertEqual((status, r['erro']), (400, 'não há troca de e-mail pedida, ou o código venceu; peça outro'))
        dados = [json.loads(x['dados']) for x in self.sql("SELECT dados FROM eventos WHERE conta_id = ? AND "
                                                          "tipo = 'email-trocado'", c.conta['id'])]
        self.assertEqual(dados, [{'de': velho, 'para': novo}])

    def test_codigo_queima_na_quinta(self):
        c = self.novo('Quinta Queima')
        self.assertEqual(c.pede('POST', '/api/conta/email/pedir', {'senha': SENHA,
                                                                    'novoEmail': 'quinta.nova@soterra.test'})[0], 200)
        codigo = self.codigo(self.espera_email(c.email, TROCA))
        for restam in (4, 3, 2, 1):
            status, r = c.pede('POST', '/api/conta/email/confirmar', {'codigo': self.errado(codigo)})
            self.assertEqual((status, r), (400, {'ok': False, 'erro': 'código errado', 'restam': restam}))
        status, r = c.pede('POST', '/api/conta/email/confirmar', {'codigo': self.errado(codigo)})
        self.assertEqual((status, r['erro']), (400, 'código errado vezes demais; peça outro'))
        status, r = c.pede('POST', '/api/conta/email/confirmar', {'codigo': codigo})       # o certo, tarde demais
        self.assertEqual((status, r['erro']), (400, 'não há troca de e-mail pedida, ou o código venceu; peça outro'))
        self.assertEqual(c.pede('GET', '/api/eu')[1]['conta']['email'], c.email)
        linha = self.sql("SELECT tentativas, usado, hash FROM codigos WHERE conta_id = ?", c.conta['id'])[0]
        self.assertEqual((linha['tentativas'], linha['usado']), (5, 1))
        self.assertNotIn(codigo, linha['hash'])                     # no banco, só o hmac
        self.assertEqual(len(linha['hash']), 64)

    def test_limite_de_pedidos(self):
        c = self.novo('Lima Pedidos')
        corpo = {'senha': SENHA, 'novoEmail': 'lima.nova@soterra.test'}

        def recua():
            self.sql("UPDATE codigos SET criado_em = criado_em - 120 WHERE conta_id = ?", c.conta['id'])

        self.assertEqual(c.pede('POST', '/api/conta/email/pedir', corpo)[0], 200)
        c1 = self.codigo(self.espera_email(c.email, TROCA, 0))
        status, r = c.pede('POST', '/api/conta/email/pedir', corpo)      # menos de 1 minuto depois
        self.assertEqual((status, r['erro']), (429, 'espere 1 minuto para pedir outro código'))
        self.assertLessEqual(abs(r['liberaEm'] - (time.time() + 60)), 5)
        recua()
        self.assertEqual(c.pede('POST', '/api/conta/email/pedir', corpo)[0], 200)
        recua()
        self.assertEqual(c.pede('POST', '/api/conta/email/pedir', corpo)[0], 200)
        c3 = self.codigo(self.espera_email(c.email, TROCA, 2))
        recua()
        status, r = c.pede('POST', '/api/conta/email/pedir', corpo)      # o 4º na mesma hora
        self.assertEqual((status, r['erro']), (429, 'pedidos demais: são 3 códigos por hora; espere'))
        mais_velho = self.sql("SELECT MIN(criado_em) FROM codigos WHERE conta_id = ?", c.conta['id'])[0][0]
        self.assertEqual(r['liberaEm'], mais_velho + 3600)
        # um aberto por vez: o código do 1º pedido morreu quando o 2º chegou
        if c1 != c3:
            status, r = c.pede('POST', '/api/conta/email/confirmar', {'codigo': c1})
            self.assertEqual((status, r['erro']), (400, 'código errado'))
        self.assertEqual(c.pede('POST', '/api/conta/email/confirmar', {'codigo': c3})[0], 200)

    def test_codigo_vencido(self):
        c = self.novo('Vera Vencida')
        self.assertEqual(c.pede('POST', '/api/conta/email/pedir', {'senha': SENHA,
                                                                    'novoEmail': 'vera.nova@soterra.test'})[0], 200)
        codigo = self.codigo(self.espera_email(c.email, TROCA))
        self.sql("UPDATE codigos SET expira_em = ? WHERE conta_id = ?", int(time.time()) - 1, c.conta['id'])
        status, r = c.pede('POST', '/api/conta/email/confirmar', {'codigo': codigo})
        self.assertEqual((status, r['erro']), (400, 'não há troca de e-mail pedida, ou o código venceu; peça outro'))
        self.assertIsNone(c.pede('GET', '/api/conta')[1]['trocaEmail'])
        self.assertEqual(c.pede('GET', '/api/eu')[1]['conta']['email'], c.email)

    # -- o esqueci ---------------------------------------------------------------------------
    def test_esqueci_mesma_resposta_no_mesmo_tempo(self):
        existem = [self.novo('Ester Existe') for _ in range(3)]
        faltam = ['ninguem.%d.%s@soterra.test' % (i, secrets.token_hex(3)) for i in range(3)]
        tempos = {'existe': [], 'falta': []}
        respostas = []
        for c, email in zip(existem, faltam):
            for grupo, alvo in (('existe', c.email), ('falta', email)):
                t0 = time.perf_counter()
                status, r = Cliente(self.base).pede('POST', '/api/esqueci', {'email': alvo})
                tempos[grupo].append(time.perf_counter() - t0)
                respostas.append((status, r))
        self.assertTrue(all(x == (200, {'ok': True, 'mensagem': FRASE}) for x in respostas), respostas)
        diferenca = abs(statistics.mean(tempos['existe']) - statistics.mean(tempos['falta']))
        self.assertLess(diferenca, 0.25, tempos)
        for c in existem:
            msg = self.espera_email(c.email, ESQUECI)
            self.codigo(msg)
            self.assertIn('ignore este e-mail', msg['texto'])
        time.sleep(0.5)
        for email in faltam:
            self.assertEqual(self.emails(email), [])
        self.assertEqual(Cliente(self.base).pede('POST', '/api/esqueci', {'email': 'sem-arroba'})[0], 400)

    def test_esqueci_banida_e_limite_da_conta_calados(self):
        b = self.novo('Bia Banida')
        self.sql("UPDATE contas SET banido = 1 WHERE id = ?", b.conta['id'])
        self.assertEqual(Cliente(self.base).pede('POST', '/api/esqueci', {'email': b.email}),
                         (200, {'ok': True, 'mensagem': FRASE}))
        # o limite da conta é calado: a mesma frase, e nada sai
        d = self.novo('Davi Pressa')
        for _ in range(3):
            self.assertEqual(Cliente(self.base).pede('POST', '/api/esqueci', {'email': d.email}),
                             (200, {'ok': True, 'mensagem': FRASE}))
        self.codigo(self.espera_email(d.email, ESQUECI))
        time.sleep(1.0)
        self.assertEqual(self.emails(b.email), [])
        self.assertEqual(len(self.emails(d.email, ESQUECI)), 1)
        status, r = Cliente(self.base).pede('POST', '/api/esqueci/confirmar', {'email': b.email, 'codigo': '000000',
                                                                                'nova': 'nova-senha-9'})
        self.assertEqual((status, r['erro']), (400, 'código errado ou vencido'))

    def test_esqueci_confirmar(self):
        c = self.novo('Edu Esqueceu')
        c2 = self.entra(c)
        nome = c.conta['nome']
        for _ in range(10):
            Cliente(self.base).pede('POST', '/api/login', {'login': nome, 'senha': 'chute-errado'})
        self.assertEqual(Cliente(self.base).pede('POST', '/api/login', {'login': nome, 'senha': 'chute-errado'})[0], 429)
        self.assertEqual(Cliente(self.base).pede('POST', '/api/esqueci', {'email': c.email.upper()})[0], 200)
        codigo = self.codigo(self.espera_email(c.email, ESQUECI))

        def confirma(**muda):
            corpo = dict({'email': c.email, 'codigo': codigo, 'nova': 'redefinida-9'}, **muda)
            return Cliente(self.base).pede('POST', '/api/esqueci/confirmar', corpo)

        def tentativas():
            return self.sql("SELECT tentativas FROM codigos WHERE conta_id = ? AND finalidade = 'senha' "
                            "ORDER BY id DESC LIMIT 1", c.conta['id'])[0][0]

        # a senha nova é conferida ANTES do código: o erro de digitação não gasta a vez
        status, r = confirma(nova='curta')
        self.assertEqual((status, r['erro']), (400, 'a senha nova precisa ter pelo menos 8 caracteres'))
        self.assertEqual(confirma(codigo='12ab56')[1]['erro'], 'o código tem 6 dígitos')
        self.assertEqual(tentativas(), 0)
        status, r = confirma(codigo=self.errado(codigo))
        self.assertEqual((status, r), (400, {'ok': False, 'erro': 'código errado ou vencido'}))   # sem "restam"
        self.assertEqual(tentativas(), 1)
        self.assertEqual(confirma(email='ninguem.aqui@soterra.test'), (400, {'ok': False, 'erro': 'código errado ou vencido'}))
        status, r = confirma()
        self.assertEqual(status, 200, r)
        self.assertEqual(set(r), {'ok', 'token', 'conta'})
        self.assertRegex(r['token'], r'^[0-9a-f]{64}$')
        self.assertEqual(r['conta'], {'id': c.conta['id'], 'nome': nome, 'gm': False})
        # todas as sessões antigas morreram; a nova vale
        self.assertEqual((c.pede('GET', '/api/eu')[0], c2.pede('GET', '/api/eu')[0]), (401, 401))
        self.assertEqual(Cliente(self.base).pede('GET', '/api/eu', token=r['token'])[0], 200)
        # as tentativas de senha da conta foram limpas: a senha nova entra na hora
        self.assertEqual(Cliente(self.base).pede('POST', '/api/login', {'login': nome, 'senha': 'redefinida-9'})[0], 200)
        self.assertEqual(Cliente(self.base).pede('POST', '/api/login', {'login': nome, 'senha': SENHA})[0], 401)
        self.assertEqual(confirma()[1]['erro'], 'código errado ou vencido')          # não vale duas vezes
        self.espera_email(c.email, SENHA_TROCADA)
        tipos = [a['tipo'] for a in Cliente(self.base).pede('GET', '/api/conta', token=r['token'])[1]['atividade']]
        self.assertIn('senha-redefinida', tipos)
        self.assertIn('esqueci-pedido', tipos)

    def test_limites_por_ip_e_global(self):
        ip = '45.161.%d.%d' % (secrets.randbelow(200) + 1, secrets.randbelow(200) + 1)
        ip2 = '45.162.%d.%d' % (secrets.randbelow(200) + 1, secrets.randbelow(200) + 1)

        def esqueci(xff, email=None):
            j = Jogador(self.base, xff=xff)
            return j.pede('POST', '/api/esqueci', {'email': email or 'ip.%s@soterra.test' % secrets.token_hex(4)})

        for _ in range(10):
            self.assertEqual(esqueci(ip)[0], 200)
        status, r = esqueci(ip)
        self.assertEqual((status, r['erro']), (429, 'pedidos demais deste endereço; tente de novo mais tarde'))
        self.assertTrue(r['liberaEm'] > time.time())
        # outro IP público segue livre; forjar à ESQUERDA não adianta, à direita vale o último proxy
        self.assertEqual(esqueci(ip2)[0], 200)
        self.assertEqual(esqueci(ip + ', 187.44.1.2')[0], 200)
        self.assertEqual(esqueci('187.44.1.2, ' + ip)[0], 429)
        # IP privado (proxy mal configurado, ou em casa): o limite por IP não vale
        for _ in range(12):
            self.assertEqual(esqueci('10.9.8.7')[0], 200)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM limites WHERE chave LIKE 'esqueci-ip:10.%'")[0][0], 0)
        # confirmar: 30 por IP por hora
        agora = int(time.time())
        b = self.banco()
        b.executemany("INSERT INTO limites(chave, em) VALUES (?, ?)", [('esqueci-conf-ip:' + ip2, agora)] * 30)
        b.commit()
        b.close()
        corpo = {'email': 'x.%s@soterra.test' % secrets.token_hex(3), 'codigo': '123456', 'nova': 'nova-senha-9'}
        status, r = Jogador(self.base, xff=ip2).pede('POST', '/api/esqueci/confirmar', corpo)
        self.assertEqual(status, 429, r)
        self.assertEqual(Jogador(self.base).pede('POST', '/api/esqueci/confirmar', corpo)[0], 400)
        # o teto global (60 e-mails por hora no servidor todo): 429 para todo mundo, exista a conta ou não
        c = self.novo('Gil Global')
        b = self.banco()
        ids = [b.execute("INSERT INTO limites(chave, em) VALUES ('esqueci-global', ?)", (agora,)).lastrowid
               for _ in range(60)]
        b.commit()
        b.close()
        try:
            for email in (c.email, 'nao.existe.%s@soterra.test' % secrets.token_hex(3)):
                status, r = Cliente(self.base).pede('POST', '/api/esqueci', {'email': email})
                self.assertEqual((status, r['erro']), (429, 'o correio está ocupado; tente em alguns minutos'))
                self.assertIn('liberaEm', r)
        finally:
            self.sql("DELETE FROM limites WHERE id BETWEEN ? AND ?", min(ids), max(ids))
        self.assertEqual(Cliente(self.base).pede('POST', '/api/esqueci', {'email': c.email})[0], 200)
        self.codigo(self.espera_email(c.email, ESQUECI))

    def test_freio_por_ip_no_login_e_no_cadastro(self):
        """Login e cadastro gastam um PBKDF2 (~0,1 s de processador) cada, e não
        tinham freio nenhum por IP: 11 pedidos por segundo de um endereço só
        saturavam o núcleo — e o save de todo mundo. O freio: 30 senhas ERRADAS
        por hora por IP público no login (a senha certa devolve a vaga: ver
        test_login_certo_nao_gasta_o_balde_do_ip), cada rota com senha no SEU
        balde (trocar senha, pedir e-mail), e 10 cadastros — que também fecham
        o oráculo do 409 "esse e-mail já tem conta". IP privado (em casa, proxy
        torto) segue sem freio."""
        ip = '45.163.%d.%d' % (secrets.randbelow(200) + 1, secrets.randbelow(200) + 1)
        ip2 = '45.164.%d.%d' % (secrets.randbelow(200) + 1, secrets.randbelow(200) + 1)
        c = self.novo('Freio Login')                                   # de 127.0.0.1: sem freio

        def login(xff, senha=SENHA, quem=None):
            return Jogador(self.base, xff=xff).pede('POST', '/api/login', {'login': quem or c.conta['nome'], 'senha': senha})

        frase = 'tentativas demais deste endereço; tente de novo mais tarde'
        self.enche('login-ip:' + ip, 29)
        self.assertEqual(login(ip)[0], 200)                            # a senha certa não gasta o balde...
        self.assertEqual(login(ip, 'chute-errado')[0], 401)            # ...e a 30ª errada da hora ainda é conferida
        for senha, quem in ((SENHA, None), ('chute-errado', None), (SENHA, 'ninguem.daqui')):
            status, r = login(ip, senha, quem)                         # 30 erradas: 429 antes de olhar conta ou senha
            self.assertEqual((status, r['erro']), (429, frase), (senha, quem))
            self.assertTrue(r['liberaEm'] > time.time(), r)
        # cada rota com senha tem o SEU balde: o do login cheio não tranca a
        # troca de senha nem o pedido de e-mail — e cada um enche no seu
        c_ip = self.entra(c, xff=ip2)
        c_ip.xff = ip
        status, r = c_ip.pede('POST', '/api/conta/senha', {'atual': 'chute-errado', 'nova': 'outra-senha-9'})
        self.assertEqual((status, r['erro']), (400, 'senha atual errada'))
        self.enche('senha-ip:' + ip, 29)                               # com a de cima, 30 erradas na troca de senha
        status, r = c_ip.pede('POST', '/api/conta/senha', {'atual': SENHA, 'nova': 'outra-senha-9'})
        self.assertEqual((status, r['erro']), (429, frase))
        status, r = c_ip.pede('POST', '/api/conta/email/pedir', {'senha': 'chute-errado', 'novoEmail': 'freio.x@soterra.test'})
        self.assertEqual((status, r['erro']), (400, 'senha errada'))
        self.enche('email-ip:' + ip, 29)
        status, r = c_ip.pede('POST', '/api/conta/email/pedir', {'senha': SENHA, 'novoEmail': 'freio.x@soterra.test'})
        self.assertEqual((status, r['erro']), (429, frase))
        self.assertEqual(c_ip.pede('GET', '/api/eu')[0], 200)         # a sessão continua viva: 429 não é 401
        # outro IP público segue livre; forjar à ESQUERDA não adianta (o da direita é o do proxy)
        self.assertEqual(login(ip2)[0], 200)
        self.assertEqual(login(ip2 + ', ' + ip)[0], 429)
        self.assertEqual(login(ip + ', ' + ip2)[0], 200)
        # IP privado: sem freio, e sem linha no banco (nem das erradas)
        for _ in range(3):
            self.assertEqual(login('10.9.8.7', 'chute-errado')[0], 401)
        self.assertEqual(login('10.9.8.7')[0], 200)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM limites WHERE chave LIKE '%-ip:10.%'")[0][0], 0)
        # cadastro: 10 por hora por IP, e o 429 vem ANTES do 409 — o oráculo fecha
        self.enche('cadastro-ip:' + ip2, 9)
        ProvaDaConta._n += 1
        nome = 'Freio Cadastro %d' % ProvaDaConta._n
        status, r = Jogador(self.base, xff=ip2).cadastra(nome, nome.replace(' ', '').lower() + '@soterra.test', SENHA)
        self.assertEqual(status, 201, r)                               # o 10º da hora ainda entra
        frase = 'cadastros demais deste endereço; tente de novo mais tarde'
        for email in ('freio.novo.%s@soterra.test' % secrets.token_hex(3), c.email):   # livre e já usado: igual
            status, r = Jogador(self.base, xff=ip2).cadastra('Freio Sonda', email, SENHA)
            self.assertEqual((status, r['erro']), (429, frase), email)
            self.assertTrue(r['liberaEm'] > time.time(), r)
        # de outro endereço, a resposta de sempre (o 409 continua existindo para quem digita o e-mail errado)
        status, r = Jogador(self.base, xff=ip).cadastra('Freio Sonda', c.email, SENHA)
        self.assertEqual((status, r['erro']), (409, 'esse e-mail já tem conta'))
        self.assertEqual(Jogador(self.base).cadastra('Freio Sonda', c.email, SENHA)[0], 409)

    def test_xff_dobrado_nao_engana(self):
        """Dois cabeçalhos X-Forwarded-For na mesma requisição: o .get() do
        http.server devolvia só o PRIMEIRO — o que o cliente forjou — e jogava
        fora o que o proxy escreveu. Agora todos são juntados por vírgula (RFC
        7230) e o IP continua sendo o primeiro público da direita para a esquerda."""
        ProvaDaConta._n += 1
        nome = 'Xff Dobrado %d' % ProvaDaConta._n
        email = nome.replace(' ', '').lower() + '@soterra.test'
        dobrado = [('X-Forwarded-For', '8.8.8.8'), ('X-Forwarded-For', '189.34.12.7, 172.18.0.5')]
        status, r = pede_cru(self.base, 'POST', '/api/cadastro', {'nome': nome, 'email': email, 'senha': SENHA}, dobrado)
        self.assertEqual(status, 201, r)
        c = Jogador(self.base)
        c.token, c.conta, c.email = r['token'], r['conta'], email
        status, r = pede_cru(self.base, 'POST', '/api/login', {'login': nome, 'senha': SENHA}, dobrado)
        self.assertEqual(status, 200, r)
        ips = [s['ip'] for s in c.pede('GET', '/api/conta')[1]['sessoes']]
        self.assertEqual(ips, ['189.34.*.*', '189.34.*.*'])
        # e os limites por IP contam no endereço do proxy, não no forjado: o
        # cadastro conta sempre; o login, só a senha errada (a certa devolve a vaga)
        def chaves():
            return sorted(x[0] for x in self.sql("SELECT chave FROM limites WHERE chave LIKE '%189.34.12.7' "
                                                 "OR chave LIKE '%8.8.8.8'"))
        self.assertEqual(chaves(), ['cadastro-ip:189.34.12.7'])
        status, r = pede_cru(self.base, 'POST', '/api/login', {'login': nome, 'senha': 'chute-errado'}, dobrado)
        self.assertEqual(status, 401, r)
        self.assertEqual(chaves(), ['cadastro-ip:189.34.12.7', 'login-ip:189.34.12.7'])
        # um cabeçalho só, dobrado por vírgula (o que o Caddy de dentro manda): o mesmo resultado
        status, r = pede_cru(self.base, 'POST', '/api/login', {'login': nome, 'senha': SENHA},
                             [('X-Forwarded-For', '8.8.8.8, 189.34.12.7, 172.18.0.5')])
        self.assertEqual(status, 200, r)
        self.assertEqual([s['ip'] for s in c.pede('GET', '/api/conta')[1]['sessoes']], ['189.34.*.*'] * 3)

    # -- o login não conta quem tem conta; os freios contam só as erradas --------------------------
    def test_login_inexistente_igual_a_senha_errada(self):
        """O 401 do login já tinha a mesma frase para quem não existe e para a
        senha errada, mas o relógio contava: o nome que não existe voltava sem
        PBKDF2 (15 ms), o que existe pagava o PBKDF2 (138 ms) — e 30 chutes por
        hora por IP bastavam para varrer os nomes do ranking e os e-mails. Agora
        o nome que não existe paga o MESMO PBKDF2, contra um sal de fachada, e
        segue o mesmo caminho até a mesma resposta. E a 11ª errada em 10
        minutos tranca o nome que não existe como tranca a conta (com as
        maiúsculas dobradas como o banco dobra), senão a tranca era o oráculo."""
        existem = [self.novo('Relogio Existe') for _ in range(3)]
        xff = '45.166.%d.%d' % (secrets.randbelow(200) + 1, secrets.randbelow(200) + 1)   # o caminho do ar, com o freio
        tempos = {'existe': [], 'falta': []}
        for _ in range(3):
            for c in existem:
                for grupo, quem in (('existe', c.conta['nome']), ('falta', 'Fantasma %s' % secrets.token_hex(4))):
                    t0 = time.perf_counter()
                    status, r = Jogador(self.base, xff=xff).pede('POST', '/api/login',
                                                                 {'login': quem, 'senha': 'chute-errado-9'})
                    tempos[grupo].append(time.perf_counter() - t0)
                    self.assertEqual((status, r), (401, {'ok': False, 'erro': 'login ou senha errados'}), (grupo, quem))
        existe, falta = statistics.median(tempos['existe']), statistics.median(tempos['falta'])
        print('\n    login errado, mediana: conta que existe %.1f ms, nome que não existe %.1f ms'
              % (existe * 1000, falta * 1000), flush=True)
        self.assertLess(abs(existe - falta), max(0.04, 0.3 * max(existe, falta)),
                        'o relógio conta quem existe: %.0f ms contra %.0f ms' % (existe * 1000, falta * 1000))
        # a 11ª errada: o mesmo 429, exista a conta ou não ('Ana', 'ana' e 'ANA' são o mesmo nome)
        fantasma = 'Fantasma Teimoso %s' % secrets.token_hex(3)
        real = self.novo('Real Teimoso')
        respostas = {}
        for quem in (fantasma, real.conta['nome']):
            for i in range(10):
                status, r = Cliente(self.base).pede('POST', '/api/login', {'login': quem if i % 2 else quem.lower(),
                                                                           'senha': 'chute-errado-9'})
                self.assertEqual(status, 401, (quem, i, r))
            status, r = Cliente(self.base).pede('POST', '/api/login', {'login': quem.upper(), 'senha': 'chute-errado-9'})
            self.assertEqual((status, r.get('erro')), (429, 'muitas tentativas; espere 10 minutos'), quem)
            self.assertTrue(isinstance(r.get('liberaEm'), int) and 590 <= r['liberaEm'] - time.time() <= 610, r)
            respostas[quem] = sorted(r)
        self.assertEqual(respostas[fantasma], respostas[real.conta['nome']])
        # e a senha certa da conta de verdade continua entrando, trancada ou não
        self.assertEqual(Cliente(self.base).pede('POST', '/api/login', {'login': real.conta['nome'], 'senha': SENHA})[0], 200)

    def test_login_certo_nao_gasta_o_balde_do_ip(self):
        """CGNAT de operadora, escola, a casa inteira atrás do mesmo roteador: o
        balde de 30 por hora por IP contava também o login CERTO (e a troca de
        senha e o pedido de e-mail, no mesmo balde), e o 31º login da hora levava
        429 — ninguém mais daquele endereço entrava por até uma hora, sem
        atacante nenhum. Agora o balde conta só as senhas erradas: 40 logins
        certos do mesmo IP na mesma hora passam, e o balde fica vazio."""
        ip = '45.167.%d.%d' % (secrets.randbelow(200) + 1, secrets.randbelow(200) + 1)
        c = self.novo('Cgnat Certo')
        for i in range(40):
            status, r = Jogador(self.base, xff=ip).pede('POST', '/api/login', {'login': c.conta['nome'], 'senha': SENHA})
            self.assertEqual(status, 200, (i + 1, r))

        def no_balde():
            return self.sql("SELECT COUNT(*) FROM limites WHERE chave IN (?, ?, ?)",
                            'login-ip:' + ip, 'senha-ip:' + ip, 'email-ip:' + ip)[0][0]

        self.assertEqual(no_balde(), 0)
        # trocar a senha e pedir e-mail com a senha certa, do mesmo endereço, também não gastam
        c.xff = ip
        status, r = c.pede('POST', '/api/conta/senha', {'atual': SENHA, 'nova': 'cgnat-nova-9'})
        self.assertEqual(status, 200, r)
        c.senha = 'cgnat-nova-9'
        status, r = c.pede('POST', '/api/conta/email/pedir', {'senha': c.senha,
                                                               'novoEmail': 'cgnat.%s@soterra.test' % secrets.token_hex(3)})
        self.assertEqual(status, 200, r)
        self.codigo(self.espera_email(c.email, TROCA))
        self.assertEqual(no_balde(), 0)
        # a senha errada continua contando
        status, r = Jogador(self.base, xff=ip).pede('POST', '/api/login', {'login': c.conta['nome'], 'senha': 'chute-errado'})
        self.assertEqual(status, 401, r)
        self.assertEqual(no_balde(), 1)

    def test_tetos_dos_acertos_por_conta(self):
        """O balde do IP não conta mais o acerto — então o acerto tem o balde
        dele, POR CONTA: só quem sabe a senha o enche, e ele não é de mais
        ninguém (não tranca o vizinho de CGNAT). 60 logins certos por hora
        (cada um é um PBKDF2 e uma sessão nova), 10 trocas de senha (dois
        PBKDF2 e um e-mail de aviso cada), e a cota de códigos do pedido de
        e-mail conferida ANTES da senha. Sem eles, quem tem uma conta faria
        login certo em laço e saturaria o processador — o que o freio antigo
        segurava."""
        c, vizinho = self.novo('Teto Acerto'), self.novo('Teto Vizinho')
        ip = '45.168.%d.%d' % (secrets.randbelow(200) + 1, secrets.randbelow(200) + 1)

        def login(quem, senha=SENHA):
            return Jogador(self.base, xff=ip).pede('POST', '/api/login', {'login': quem.conta['nome'], 'senha': senha})

        self.enche('login-ok:%d' % c.conta['id'], 59)
        self.assertEqual(login(c)[0], 200)                              # o 60º da hora
        for senha in (SENHA, 'chute-errado'):
            status, r = login(c, senha)                                 # o 61º: 429 antes do PBKDF2, certo ou errado
            self.assertEqual((status, r['erro']), (429, 'logins demais nesta conta; tente de novo mais tarde'), senha)
            self.assertTrue(r['liberaEm'] > time.time(), r)
        self.assertEqual(login(vizinho)[0], 200)                        # do mesmo endereço, a outra conta entra
        # trocas de senha
        self.enche('senha-ok:%d' % c.conta['id'], 10)
        status, r = c.pede('POST', '/api/conta/senha', {'atual': SENHA, 'nova': 'teto-nova-9'})
        self.assertEqual((status, r['erro']), (429, 'trocas de senha demais nesta hora; tente de novo mais tarde'))
        self.assertTrue(r['liberaEm'] > time.time(), r)
        self.assertEqual(vizinho.pede('POST', '/api/conta/senha', {'atual': SENHA, 'nova': 'teto-nova-9'})[0], 200)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM limites WHERE chave = ?", 'senha-ok:%d' % vizinho.conta['id'])[0][0], 1)
        # a cota de códigos vem antes da senha: estourada, a senha nem é conferida (nem conta tentativa)
        vizinho.senha = 'teto-nova-9'
        status, r = vizinho.pede('POST', '/api/conta/email/pedir', {'senha': vizinho.senha,
                                                                     'novoEmail': 'teto.%s@soterra.test' % secrets.token_hex(3)})
        self.assertEqual(status, 200, r)
        self.codigo(self.espera_email(vizinho.email, TROCA))
        status, r = vizinho.pede('POST', '/api/conta/email/pedir', {'senha': 'chute-errado',
                                                                     'novoEmail': 'teto.%s@soterra.test' % secrets.token_hex(3)})
        self.assertEqual((status, r['erro']), (429, 'espere 1 minuto para pedir outro código'))
        self.assertNotIn('senha-recusada', [a['tipo'] for a in vizinho.pede('GET', '/api/conta')[1]['atividade']])

    def test_ipv6_conta_pelo_prefixo_64(self):
        """O provedor entrega a cada casa (e a cada celular) um /64 inteiro de
        IPv6 — 2^64 endereços — e o aparelho troca de endereço dentro dele
        quando quer. Com a chave no endereço inteiro, cada pedido caía num balde
        novo e nenhum freio por IP freava. Agora a chave do IPv6 é o /64, em
        todos: login, trocar senha, pedir e-mail, cadastro, esqueci e a
        confirmação do esqueci. O IPv4 continua pelo endereço inteiro."""
        g = [secrets.randbelow(0xfff0) + 1 for _ in range(3)]
        rede = '2804:%x:%x:%x' % tuple(g)
        a, b = rede + '::1', rede + ':ffff:ffff:ffff:fffe'
        vizinha = '2804:%x:%x:%x::1' % (g[0], g[1], g[2] + 1)
        prefixo = str(ipaddress.ip_network(a + '/64', strict=False))
        self.assertEqual(prefixo, rede + '::/64')
        c = self.novo('Seis Quatro')

        def login(xff, senha=SENHA):
            return Jogador(self.base, xff=xff).pede('POST', '/api/login', {'login': c.conta['nome'], 'senha': senha})

        self.enche('login-ip:' + prefixo, 29)
        self.assertEqual(login(a, 'chute-errado')[0], 401)             # a 30ª errada do /64
        status, r = login(b)                                           # outro endereço do MESMO /64: o mesmo balde
        self.assertEqual((status, r['erro']), (429, 'tentativas demais deste endereço; tente de novo mais tarde'))
        self.assertEqual(login('[%s]:443' % b)[0], 429)                # com colchetes e porta, o mesmo
        self.assertEqual(login(vizinha)[0], 200)                       # o /64 vizinho é outra casa
        # as outras chaves também são do /64
        c6 = self.entra(c, xff=vizinha)
        c6.xff = b
        self.assertEqual(c6.pede('POST', '/api/conta/senha', {'atual': 'chute-errado', 'nova': 'seis-nova-9'})[0], 400)
        self.assertEqual(c6.pede('POST', '/api/conta/email/pedir', {'senha': 'chute-errado',
                                                                     'novoEmail': 'seis.x@soterra.test'})[0], 400)
        ProvaDaConta._n += 1
        nome = 'Seis Cadastro %d' % ProvaDaConta._n
        self.assertEqual(Jogador(self.base, xff=a).cadastra(nome, nome.replace(' ', '').lower() + '@soterra.test', SENHA)[0], 201)
        self.assertEqual(Jogador(self.base, xff=b).pede('POST', '/api/esqueci',
                                                        {'email': 'seis.%s@soterra.test' % secrets.token_hex(3)})[0], 200)
        self.assertEqual(Jogador(self.base, xff=a).pede('POST', '/api/esqueci/confirmar',
                                                        {'email': 'seis.y@soterra.test', 'codigo': '123456',
                                                         'nova': 'seis-nova-9'})[0], 400)
        chaves = {x[0] for x in self.sql("SELECT chave FROM limites WHERE chave LIKE ?", '%' + rede + '%')}
        self.assertEqual(chaves, {k + '-ip:' + prefixo for k in ('login', 'senha', 'email', 'cadastro', 'esqueci', 'esqueci-conf')})
        # o cadastro enche pelo /64: trocar de endereço dentro dele não abre balde novo
        self.enche('cadastro-ip:' + prefixo, 9)
        status, r = Jogador(self.base, xff=rede + ':1:2:3:4').cadastra('Seis Sonda', 'seis.sonda.%s@soterra.test'
                                                                      % secrets.token_hex(3), SENHA)
        self.assertEqual((status, r['erro']), (429, 'cadastros demais deste endereço; tente de novo mais tarde'))

    def test_rajada_paralela_nao_passa_do_teto(self):
        """A vaga do freio é reservada ANTES do PBKDF2, na mesma transação que
        conta, e só volta para quem acerta: uma rajada de senhas erradas
        disparadas JUNTAS do mesmo IP não passa do teto. Anotar só depois do
        PBKDF2, no ramo da senha errada, deixaria a rajada inteira ser
        conferida antes da primeira anotação. Cinco de cada vez (a fila de
        conexões do http.server é 5); nomes que não existem, para a tranca
        da conta não se misturar."""
        from concurrent.futures import ThreadPoolExecutor
        ip = '45.169.%d.%d' % (secrets.randbelow(200) + 1, secrets.randbelow(200) + 1)
        self.enche('login-ip:' + ip, 27)
        sufixo = secrets.token_hex(3)

        def chuta(i):
            return Jogador(self.base, xff=ip).pede('POST', '/api/login', {'login': 'Rajada %d %s' % (i, sufixo),
                                                                          'senha': 'chute-errado'})

        with ThreadPoolExecutor(max_workers=5) as ex:
            respostas = list(ex.map(chuta, range(10)))
        codigos = [s for s, _ in respostas]
        self.assertEqual((codigos.count(401), codigos.count(429)), (3, 7), codigos)
        self.assertTrue(all(r['erro'] == 'tentativas demais deste endereço; tente de novo mais tarde'
                            for s, r in respostas if s == 429), respostas)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM limites WHERE chave = ?", 'login-ip:' + ip)[0][0], 30)

    def test_fantasmas_nao_crescem_sem_fim(self):
        """A contagem das senhas erradas mora em memória, e agora conta também
        os nomes que não existem — que quem chuta inventa sem fim. Com
        TENTATIVAS_CHAVES chaves guardadas, um fantasma NOVO passa antes a
        faxina (sai quem não errou nos últimos 10 minutos); se nem assim
        couber, fica sem anotar. A conta de verdade e o fantasma que já estava
        contando sempre anotam. A chave do fantasma é cortada (nome e e-mail
        cabem em 120) e dobra as maiúsculas ASCII como o COLLATE NOCASE."""
        teto = conta_mod.TENTATIVAS_CHAVES
        falso = type('Falso', (conta_mod.ContaMixin,), {})()
        t = int(time.time())
        falso.tentativas = {('?', 'f%d' % i): [t] for i in range(teto)}
        falso._anota_tentativa(('?', 'novo'), t)
        self.assertEqual(len(falso.tentativas), teto)
        self.assertNotIn(('?', 'novo'), falso.tentativas)
        falso._anota_tentativa(('?', 'f7'), t)                            # o que já estava contando anota
        self.assertEqual(falso.tentativas[('?', 'f7')], [t, t])
        falso._anota_tentativa(4242, t)                                   # a conta de verdade sempre anota
        self.assertEqual(falso.tentativas[4242], [t])
        for i in range(0, teto, 2):                                       # metade errou há mais de 10 minutos
            falso.tentativas[('?', 'f%d' % i)] = [t - comum.LOGIN_JANELA - 1]
        falso._anota_tentativa(('?', 'novo'), t)
        self.assertEqual(falso.tentativas[('?', 'novo')], [t])
        self.assertLessEqual(len(falso.tentativas), teto // 2 + 3)
        chave = conta_mod.ContaMixin._chave_tentativas
        self.assertEqual(chave(None, 'Ana.SILVA@X.com'), ('?', 'ana.silva@x.com'))
        self.assertEqual(chave(None, 'Élida'), ('?', 'Élida'))            # o NOCASE só dobra o ASCII
        self.assertEqual(len(chave(None, 'x' * 5000)[1]), 121)
        self.assertEqual(chave({'id': 7}, 'qualquer'), 7)

    # -- sem correio e com o SMTP caído (processos à parte) -------------------------------------
    def test_sem_correio(self):
        pasta = tempfile.mkdtemp(prefix='sem-correio-', dir=self.pasta)
        proc, log, base, caminho_log = sobe_api(pasta, 'api')
        try:
            self.assertIs(Cliente(base).pede('GET', '/api/saude')[1]['correio'], False)
            c = self.novo('Sem Correio', base=base)
            self.assertIs(c.pede('GET', '/api/conta')[1]['correio'], False)
            erro = 'o envio de e-mails ainda não foi ligado neste servidor'
            status, r = c.pede('POST', '/api/conta/email/pedir', {'senha': SENHA, 'novoEmail': 'sc.nova@soterra.test'})
            self.assertEqual((status, r), (503, {'ok': False, 'erro': erro, 'correio': False}))
            status, r = Cliente(base).pede('POST', '/api/esqueci', {'email': c.email})
            self.assertEqual((status, r), (503, {'ok': False, 'erro': erro, 'correio': False}))
            # o resto funciona igual
            status, r = c.pede('POST', '/api/conta/senha', {'atual': SENHA, 'nova': 'sem-correio-9'})
            self.assertEqual((status, r), (200, {'ok': True, 'sessoesEncerradas': 0}))
            self.assertIn('correio: DESLIGADO', le(caminho_log))
        finally:
            para(proc, log)

    def test_smtp_caido(self):
        """SMTP apontado para uma porta fechada: o pedido de troca responde 503
        com correio:true e apaga o código (não gasta a cota da hora); o esqueci
        responde a frase de sempre e apaga o código na thread. O log conta a
        falha sem endereço e sem senha."""
        pasta = tempfile.mkdtemp(prefix='smtp-caido-', dir=self.pasta)
        senha_smtp = 'prova-' + secrets.token_urlsafe(12)
        porta = porta_livre()
        env = ambiente_limpo(SOTERRA_SMTP_HOST='127.0.0.1', SOTERRA_SMTP_PORTA=str(porta),
                             SOTERRA_SMTP_USUARIO='prova-smtp@soterra.test', SOTERRA_SMTP_SENHA=senha_smtp)
        proc, log, base, caminho_log = sobe_api(pasta, 'api', env=env)
        try:
            self.assertIs(Cliente(base).pede('GET', '/api/saude')[1]['correio'], True)
            c = self.novo('Smtp Caido', base=base)
            erro = 'o correio do servidor falhou agora; tente de novo em alguns minutos'
            for _ in range(2):                          # o 2º não leva 429: o 1º não contou
                status, r = c.pede('POST', '/api/conta/email/pedir', {'senha': SENHA,
                                                                       'novoEmail': 'caido.nova@soterra.test'})
                self.assertEqual((status, r), (503, {'ok': False, 'erro': erro, 'correio': True}))
            b = sqlite3.connect(os.path.join(pasta, 'api', 'soterra.db'))
            self.assertEqual(b.execute("SELECT COUNT(*) FROM codigos").fetchone()[0], 0)
            self.assertEqual(Cliente(base).pede('POST', '/api/esqueci', {'email': c.email}),
                             (200, {'ok': True, 'mensagem': FRASE}))
            limite = time.time() + 40
            while time.time() < limite and ('esqueci-a-senha' not in le(caminho_log)
                                            or b.execute("SELECT COUNT(*) FROM codigos").fetchone()[0]):
                time.sleep(0.2)
            self.assertEqual(b.execute("SELECT COUNT(*) FROM codigos").fetchone()[0], 0)
            b.close()
            texto = le(caminho_log)
            self.assertIn('correio: 127.0.0.1:%d starttls como prova-smtp@soterra.test' % porta, texto)
            self.assertIn('não saiu', texto)
            self.assertNotIn(senha_smtp, texto)
            self.assertNotIn(c.email, texto)
        finally:
            para(proc, log)

    # -- funções puras ------------------------------------------------------------------------
    def test_ip_do_pedido(self):
        casos = [((None, '127.0.0.1'), '127.0.0.1'),
                 (('45.160.3.7', '127.0.0.1'), '45.160.3.7'),
                 (('1.2.3.4, 45.160.3.7', '127.0.0.1'), '45.160.3.7'),         # o da direita manda
                 (('45.160.3.7, 10.0.0.2, 172.18.0.5', '127.0.0.1'), '45.160.3.7'),
                 (('10.0.0.2', '127.0.0.1'), '127.0.0.1'),
                 (('lixo, , 999.1.1.1', '127.0.0.1'), '127.0.0.1'),
                 (('[2804:14c::1]:443', '127.0.0.1'), '2804:14c::1'),
                 (('::ffff:45.160.3.7', '127.0.0.1'), '45.160.3.7'),
                 (('45.160.3.7:5678', '127.0.0.1'), '45.160.3.7'),
                 (('203.0.113.9', '::1'), '::1'),                                  # rede de documentação
                 (('', ''), '')]
        for (xff, sock), esperado in casos:
            self.assertEqual(comum.ip_do_pedido(xff, sock), esperado, (xff, sock))
        # a chave dos freios: o IPv4 inteiro; do IPv6, o /64 (a casa, não o aparelho)
        for texto, esperado in (('189.34.12.7', '189.34.12.7'), ('::ffff:45.160.3.7', '45.160.3.7'),
                                ('2804:14c:abcd:1234:5678:9abc:def0:1', '2804:14c:abcd:1234::/64'),
                                ('2804:14c:abcd:1234::1', '2804:14c:abcd:1234::/64'),
                                ('[2804:14c::9]:443', '2804:14c::/64'), ('lixo', None), ('', None), (None, None)):
            self.assertEqual(comum.chave_do_ip(texto), esperado, texto)
        self.assertEqual(conta_mod.mascara_email('daniel@exemplo.com'), 'da***@exemplo.com')
        self.assertEqual(conta_mod.mascara_email('ab@x.com'), 'a***@x.com')
        self.assertEqual(conta_mod.mascara_ip('189.34.12.7'), '189.34.*.*')
        self.assertEqual(conta_mod.mascara_ip('2804:14c::1'), '2804:14c:*')
        self.assertIsNone(conta_mod.mascara_ip(None))
        for bom in ('a@b.com', 'nome.sobrenome+jogo@sub.dominio.com.br', "o'neil@x.io"):
            self.assertTrue(comum.email_novo_valido(bom), bom)
        for torto in ('a@b', 'a@b.com,c@d.com', 'a b@c.com', '@b.com', 'a@@b.com', 'a@.com', 'a@b..com', 'a@b.com.',
                      '<a@b.com>', 'a@b.com;x', None, 5, 'x' * 120 + '@b.com'):
            self.assertFalse(comum.email_novo_valido(torto), torto)

    def test_correio_por_dentro(self):
        C = correio_mod.Correio
        self.assertFalse(C().ligado)
        self.assertEqual(C.do_ambiente(env={}).descricao(), 'DESLIGADO')
        senha = 'app-' + secrets.token_hex(8)
        gmail = {'SOTERRA_SMTP_HOST': 'smtp.gmail.com', 'SOTERRA_SMTP_USUARIO': 'system@viidoo.io',
                 'SOTERRA_SMTP_SENHA': senha}
        c = C.do_ambiente(env=gmail)
        self.assertTrue(c.ligado)
        self.assertEqual(c.descricao(), 'smtp.gmail.com:587 starttls como system@viidoo.io')
        self.assertNotIn(senha, repr(c) + c.descricao())
        self.assertEqual(C.do_ambiente(env=dict(gmail, SOTERRA_SMTP_PORTA='465')).descricao(),
                         'smtp.gmail.com:465 ssl como system@viidoo.io')
        self.assertEqual(C.do_ambiente(env=dict(gmail, SOTERRA_SMTP_REMETENTE='outro@viidoo.io')).descricao(),
                         'smtp.gmail.com:587 starttls como outro@viidoo.io')
        for torto in ({'SOTERRA_SMTP_PORTA': 'abc'}, {'SOTERRA_SMTP_SEGURANCA': 'tls'}):
            t = C.do_ambiente(env=dict(gmail, **torto))
            self.assertFalse(t.ligado)
            self.assertTrue(t.descricao().startswith('DESLIGADO ('), t.descricao())
        faltando = C.do_ambiente(env={'SOTERRA_SMTP_HOST': 'smtp.gmail.com', 'SOTERRA_SMTP_USUARIO': 'system@viidoo.io'})
        self.assertEqual(faltando.descricao(), 'DESLIGADO (falta SOTERRA_SMTP_SENHA)')
        # a mensagem: From com nome, Message-ID do domínio do remetente, texto simples UTF-8
        msg = c._monta('pessoa@soterra.test', 'SOTERRA: teste', 'Olá, código é: 000000')
        self.assertEqual(msg['From'], 'SOTERRA <system@viidoo.io>')
        self.assertTrue(msg['Message-ID'].endswith('@viidoo.io>'), msg['Message-ID'])
        self.assertEqual(msg['Auto-Submitted'], 'auto-generated')
        self.assertEqual(msg.get_content_type(), 'text/plain')
        self.assertIn('Olá', msg.get_content())
        # o modo de prova escreve uma linha; um To com dois destinatários é recusado
        arq = os.path.join(self.pasta, 'prova-por-dentro.jsonl')
        p = C.do_ambiente(env={'SOTERRA_EMAIL_PROVA': arq, 'SOTERRA_ENDERECO': 'https://soterra.viidoo.io/'})
        self.assertEqual((p.ligado, p.descricao(), p.endereco), (True, 'PROVA em ' + arq, 'https://soterra.viidoo.io'))
        p.envia('pessoa@soterra.test', 'SOTERRA: teste', 'corpo')
        with open(arq, encoding='utf-8') as f:
            linha = json.loads(f.readline())
        self.assertEqual((linha['para'], linha['assunto'], linha['texto']), ('pessoa@soterra.test', 'SOTERRA: teste', 'corpo'))
        for torto in ('a@b.com, c@d.com', 'a@b.com\r\nBcc: c@d.com', 'sem-arroba', None):
            with self.assertRaises(correio_mod.CorreioFalhou):
                p.envia(torto, 'x', 'y')
        # o link do fim do e-mail, sem token, quando SOTERRA_ENDERECO existe
        falso = type('Falso', (conta_mod.ContaMixin,), {})()
        falso.correio = p
        assunto, texto = falso._textos('codigo-senha', 'Ana', codigo='012345')
        self.assertIn('https://soterra.viidoo.io/site/conta.html', texto)
        self.assertEqual(RE_CODIGO.findall(texto), ['012345'])

    def test_zz_codigo_nunca_no_log(self):
        """Roda por último (ordem alfabética): nenhum código lido nos e-mails
        aparece no log da API, e nenhum e-mail das contas de prova também."""
        self.assertEqual(Cliente(self.base).pede('POST', '/api/esqueci', {'email': self.novo('Zeca Ultimo').email})[0], 200)
        time.sleep(0.5)
        linhas = [linha for linha in le(self.log_arq).splitlines() if 'PROVA em' not in linha and 'banco em' not in linha]
        texto = '\n'.join(linhas)
        self.assertTrue(ProvaDaConta.codigos, 'nenhum código foi lido: a prova não provou nada')
        for codigo in ProvaDaConta.codigos:
            self.assertIsNone(re.search(r'(?<!\d)%s(?!\d)' % codigo, texto), codigo)
        self.assertNotIn('@soterra.test', texto)


if __name__ == '__main__':
    unittest.main(verbosity=2)
