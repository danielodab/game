#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova das barras de ouro compradas pela APPLE no aplicativo de iPhone
(servidor/pagamento_apple.py) — 26/10 — pela API de verdade e com a Apple DE
MENTIRA (tests/apple_falsa.py: uma cadeia de certificados inventada, no formato da
de verdade).

    python tests/pagamento_apple_api.py

Sobe servidor/api.py em subprocessos (banco descartável; SOTERRA_APPLE=1 e
`--apple-raiz` com a raiz de mentira). Nenhuma conversa com a Apple de verdade — e
nenhuma é preciso: o servidor confere a ASSINATURA.

O que se prova: desligada, as rotas dão 503, o catálogo e a vitrine dizem
`apple: false` e a loja segue; ligada, `apple: true`, os quatro produtos e o UUID
da conta; a compra assinada credita UMA vez (repetida, dez em paralelo, nos dois
processos do rolling update) e manda encerrar; a assinatura torta (o conteúdo
mexido, outra raiz, a folha sem a marca da Apple, a folha vencida, alg none, sem a
cadeia) não credita; outro aplicativo, outro produto e o ambiente do Xcode não
creditam; o Sandbox credita marcado como teste (e não conta no teto), e com
SOTERRA_APPLE_SANDBOX=0 não; a compra de outra conta do jogo não credita; a
revogada não credita e tira o que creditou; o teto de R$ 400 em 24 h segura e
não manda encerrar; a conta banida não recebe; O AVISO DA APPLE: a compra avulsa
(ONE_TIME_CHARGE) credita pela conta do UUID sem o aplicativo mandar, e o
aplicativo mandando depois não credita de novo; o reembolso (REFUND) tira as
barras, alerta o Mestre do que já foi gasto e não tira duas vezes; o reembolso de
uma compra que nunca chegou deixa a lápide; aviso com assinatura torta leva 401,
de outro aplicativo e de tipo que não interessa levam 200 sem efeito; o extrato e
os dados da conta mostram a compra; e a raiz da Apple de verdade, gravada no
código, é a Apple Root CA - G3.
"""
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402  (põe servidor/ no sys.path)
from apple_falsa import AppleFalsa  # noqa: E402
import pagamento_apple as apple_mod  # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROTA = '/api/pagamento/apple'
AVISO = '/api/pagamento/apple/aviso'


def sobe_api(pasta, nome, banco, env_extra=None, raiz=None):
    porta = porta_livre()
    log_arq = os.path.join(pasta, nome + '.log')
    log = open(log_arq, 'w', encoding='utf-8')
    env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
    env.update(env_extra or {})
    args = [sys.executable, API, '--porta', str(porta), '--banco', banco]
    if raiz:
        args += ['--apple-raiz', raiz]
    proc = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT, env=env)
    base = 'http://127.0.0.1:%d' % porta
    if not espera_api(base, proc):
        proc.kill()
        log.close()
        raise RuntimeError('a API %s não subiu; veja %s' % (nome, log_arq))
    return proc, log, base, log_arq


class ProvaDaApple(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.mkdtemp(prefix='soterra-apple-')
        cls.a = AppleFalsa()
        cls.raiz = cls.a.grava_raiz(os.path.join(cls.pasta, 'raiz.pem'))
        cls.banco_arq = os.path.join(cls.pasta, 'dados', 'soterra.db')
        cls.env = {'SOTERRA_APPLE': '1'}
        cls.procs = []
        try:
            p, lg, cls.base, cls.log_arq = sobe_api(cls.pasta, 'api', cls.banco_arq, cls.env, cls.raiz)
            cls.procs.append((p, lg))
            # o segundo contêiner do rolling update: o MESMO banco
            p, lg, cls.base2, _ = sobe_api(cls.pasta, 'api2', cls.banco_arq, cls.env, cls.raiz)
            cls.procs.append((p, lg))
            # sem SOTERRA_APPLE (banco próprio)
            p, lg, cls.base_off, _ = sobe_api(cls.pasta, 'api-off', os.path.join(cls.pasta, 'off', 'soterra.db'),
                                              None, cls.raiz)
            cls.procs.append((p, lg))
            # ligada, mas sem aceitar o Sandbox (banco próprio)
            p, lg, cls.base_sem_sandbox, _ = sobe_api(cls.pasta, 'api-sem-sandbox',
                                                      os.path.join(cls.pasta, 'semsb', 'soterra.db'),
                                                      {'SOTERRA_APPLE': '1', 'SOTERRA_APPLE_SANDBOX': '0'}, cls.raiz)
            cls.procs.append((p, lg))
        except Exception:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        for proc, log in cls.procs:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(5)
                except subprocess.TimeoutExpired:
                    proc.kill()
            log.close()
        shutil.rmtree(cls.pasta, ignore_errors=True)

    # -- ajudantes ------------------------------------------------------------------
    def novo(self, apelido, base=None):
        ProvaDaApple._n += 1
        c = Cliente(base or self.base)
        status, r = c.cadastra('%s %d' % (apelido, ProvaDaApple._n))
        self.assertEqual(status, 201, r)
        return c

    def sql(self, consulta, *args):
        b = sqlite3.connect(self.banco_arq)
        b.row_factory = sqlite3.Row
        try:
            linhas = b.execute(consulta, args).fetchall()
            b.commit()
            return linhas
        finally:
            b.close()

    def barras(self, c):
        status, r = c.pede('GET', '/api/loja/minha')
        self.assertEqual(status, 200, r)
        return r['barras']['saldo']

    def uuid_de(self, c):
        status, r = c.pede('GET', ROTA)
        self.assertEqual(status, 200, r)
        return r['conta']

    def manda(self, c, jws):
        return c.pede('POST', ROTA, {'jws': jws})

    def aviso(self, payload, base=None):
        return Cliente(base or self.base).pede('POST', AVISO, {'signedPayload': payload})

    # -- as provas ------------------------------------------------------------------
    def test_01_desligada_503_e_o_resto_segue(self):
        c = self.novo('Sem Apple', self.base_off)
        st, r = c.pede('GET', ROTA)
        self.assertEqual((st, r.get('apple')), (503, False), r)
        self.assertEqual(c.pede('POST', ROTA, {'jws': self.a.transacao('barras_50')})[0], 503)
        self.assertEqual(Cliente(self.base_off).pede('POST', AVISO, {'signedPayload': 'x.y.z'})[0], 503)
        self.assertIs(Cliente(self.base_off).pede('GET', '/api/loja/catalogo')[1]['apple'], False)
        self.assertIs(c.pede('GET', '/api/loja/vitrine')[1]['apple'], False)
        self.assertEqual(c.pede('GET', '/api/loja/minha')[0], 200)        # a loja segue

    def test_02_ligada_produtos_e_o_uuid_da_conta(self):
        self.assertIs(Cliente(self.base).pede('GET', '/api/loja/catalogo')[1]['apple'], True)
        c = self.novo('Com Apple')
        self.assertIs(c.pede('GET', '/api/loja/vitrine')[1]['apple'], True)
        st, r = c.pede('GET', ROTA)
        self.assertEqual(st, 200, r)
        self.assertTrue(re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', r['conta']), r)
        self.assertEqual([p['produto'] for p in r['pacotes']], ['barras_50', 'barras_280', 'barras_600', 'barras_1250'])
        self.assertTrue(all(p['cabe'] for p in r['pacotes']))
        self.assertTrue(r['teste'])                     # aceita o Sandbox (o revisor da Apple compra nele)
        self.assertEqual(self.uuid_de(c), r['conta'])   # sempre o mesmo para a conta
        d = self.novo('Outra Apple')
        self.assertNotEqual(self.uuid_de(d), r['conta'])
        with open(self.log_arq, encoding='utf-8', errors='replace') as f:
            self.assertIn('pagamento: App Store ligada (br.com.soterra.jogo, aceita Sandbox, raiz de MENTIRA)', f.read())

    def test_03_credita_uma_vez_e_manda_encerrar(self):
        c = self.novo('Compra Apple')
        jws = self.a.transacao('barras_280', self.uuid_de(c))
        st, r = self.manda(c, jws)
        self.assertEqual((st, r['creditado'], r['encerrar'], r['estado']), (201, True, True, 'creditada'), r)
        self.assertEqual((r['compra']['pacote'], r['compra']['barras'], r['barras']['saldo']), ('barras-280', 280, 280))
        # de novo, e no outro contêiner: não credita, e manda encerrar (o aplicativo fechou antes de encerrar)
        st, r = self.manda(c, jws)
        self.assertEqual((st, r['creditado'], r.get('repetido'), r['encerrar']), (200, False, True, True), r)
        outro = Cliente(self.base2)
        outro.token, outro.conta = c.token, c.conta
        self.assertEqual(self.manda(outro, jws)[1].get('repetido'), True)
        # dez em paralelo, uma transação nova: um crédito só
        jws2 = self.a.transacao('barras_50', self.uuid_de(c))
        res = []

        def vai(i):
            cl = Cliente(self.base if i % 2 else self.base2)
            cl.token, cl.conta = c.token, c.conta
            res.append(self.manda(cl, jws2)[1].get('creditado'))
        ths = [threading.Thread(target=vai, args=(i,)) for i in range(10)]
        [t.start() for t in ths]
        [t.join() for t in ths]
        self.assertEqual(res.count(True), 1, res)
        self.assertEqual(self.barras(c), 330)
        # o extrato diz de onde vieram, e os dados da conta mostram as compras (sem o transactionId)
        mov = c.pede('GET', '/api/loja/minha')[1]['barras']['movimentos']
        self.assertIn('Bolsa de 50 barras de ouro (App Store)', [m['nome'] for m in mov], mov)
        st, dados = c.pede('GET', '/api/conta/meus-dados')
        self.assertEqual(st, 200, dados)
        compras = dados['dados']['compras_app_store']
        self.assertEqual([x['pacote'] for x in compras['itens']], ['barras-50', 'barras-280'], compras)
        self.assertNotIn(jws.split('.')[2], json.dumps(dados))

    def test_04_assinatura_torta_nao_credita(self):
        c = self.novo('Torta Apple')
        u = self.uuid_de(c)
        for torta in ('conteudo', 'outra-raiz', 'sem-marca', 'vencida', 'alg-none', 'sem-cadeia'):
            st, r = self.manda(c, self.a.transacao('barras_600', u, torta=torta))
            self.assertEqual((st, r.get('estado'), r.get('encerrar')), (400, 'desconhecida', False), (torta, r))
        for lixo in ('', 'abc', 'a.b', 'a.b.c', 'x' * 30000):
            self.assertEqual(self.manda(c, lixo)[0], 400, lixo[:10])
        self.assertEqual(self.barras(c), 0)

    def test_05_outro_app_produto_ambiente(self):
        c = self.novo('Ambiente Apple')
        u = self.uuid_de(c)
        st, r = self.manda(c, self.a.transacao('barras_50', u, bundleId='com.outro.jogo'))
        self.assertEqual((st, r.get('estado')), (400, 'desconhecida'), r)
        st, r = self.manda(c, self.a.transacao('moedas_999', u))
        self.assertEqual(st, 400, r)
        st, r = self.manda(c, self.a.transacao('barras_50', u, environment='Xcode'))
        self.assertEqual((st, r.get('estado')), (409, 'teste'), r)
        # o Sandbox (o revisor da Apple, o TestFlight): credita, marcado como teste
        st, r = self.manda(c, self.a.transacao('barras_50', u, environment='Sandbox'))
        self.assertEqual((st, r.get('creditado')), (201, True), r)
        self.assertEqual(self.sql("SELECT teste FROM pagamentos_apple WHERE conta_id = ?", c.conta['id'])[0][0], 1)
        # … e com SOTERRA_APPLE_SANDBOX=0, não
        d = self.novo('Sem Sandbox', self.base_sem_sandbox)
        ud = self.uuid_de(d)
        st, r = self.manda(d, self.a.transacao('barras_50', ud, environment='Sandbox'))
        self.assertEqual((st, r.get('estado'), r.get('encerrar')), (409, 'teste', False), r)
        self.assertEqual(self.manda(d, self.a.transacao('barras_50', ud))[0], 201)   # a de verdade, sim

    def test_06_outra_conta_nao_credita(self):
        a, b = self.novo('Dona Apple'), self.novo('Intrusa Apple')
        jws = self.a.transacao('barras_50', self.uuid_de(a))
        st, r = self.manda(b, jws)
        self.assertEqual((st, r.get('estado'), r.get('encerrar')), (403, 'outra-conta', False), r)
        self.assertEqual(self.manda(a, jws)[0], 201)
        # já creditada na dona: a outra continua sem receber
        self.assertEqual(self.manda(b, jws)[0], 403)
        # sem o UUID (uma compra sem a conta, como um código de oferta): credita em quem manda
        self.assertEqual(self.manda(b, self.a.transacao('barras_50'))[0], 201)
        self.assertEqual((self.barras(a), self.barras(b)), (50, 50))

    def test_07_revogada(self):
        c = self.novo('Revoga Apple')
        u = self.uuid_de(c)
        st, r = self.manda(c, self.a.transacao('barras_50', u, revocationDate=1792900000000, revocationReason=1))
        self.assertEqual((st, r.get('creditado'), r.get('estado'), r.get('encerrar')), (200, False, 'cancelada', True), r)
        # creditada e depois revogada (a mesma transação, assinada de novo pela Apple com a revocationDate)
        jws = self.a.transacao('barras_280', u, transactionId='7700000000000001')
        self.assertEqual(self.manda(c, jws)[0], 201)
        st, r = self.manda(c, self.a.transacao('barras_280', u, transactionId='7700000000000001',
                                                revocationDate=1792900000000))
        self.assertEqual((st, r.get('estado')), (200, 'cancelada'), r)
        self.assertEqual(self.barras(c), 0)
        st, r = self.manda(c, jws)                      # a original de novo: nunca mais credita
        self.assertEqual((st, r.get('estado')), (409, 'cancelada'), r)

    def test_08_teto_e_banida(self):
        c = self.novo('Teto Apple')
        u = self.uuid_de(c)
        self.assertEqual(self.manda(c, self.a.transacao('barras_1250', u, quantity=5))[0], 201)    # R$ 399,50
        st, r = self.manda(c, self.a.transacao('barras_50', u))
        self.assertEqual((st, r.get('creditado'), r.get('encerrar'), r.get('estado')), (200, False, False, 'teto'), r)
        self.assertEqual(self.barras(c), 6250)
        self.assertTrue(any(not p['cabe'] for p in c.pede('GET', ROTA)[1]['pacotes']))
        self.assertEqual(self.sql("SELECT COUNT(*) FROM contas_alertas WHERE conta_id = ? AND tipo = 'teto-diario'",
                                  c.conta['id'])[0][0], 1)
        # o Sandbox não conta no teto e não esbarra nele (não entrou dinheiro)
        self.assertEqual(self.manda(c, self.a.transacao('barras_50', u, environment='Sandbox'))[0], 201)
        # a quantidade que o jogo não aceita
        st, r = self.manda(c, self.a.transacao('barras_50', u, quantity=11))
        self.assertEqual((st, r.get('estado')), (409, 'quantidade'), r)
        # banida
        d = self.novo('Banida Apple')
        ud = self.uuid_de(d)
        self.sql("UPDATE contas SET banido = 1 WHERE id = ?", d.conta['id'])
        st, r = self.manda(d, self.a.transacao('barras_50', ud))
        self.assertIn(st, (401, 403), r)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM pagamentos_apple WHERE conta_id = ? AND creditado_em IS NOT NULL",
                                  d.conta['id'])[0][0], 0)

    def test_09_o_aviso_da_apple_credita_sem_o_aplicativo(self):
        c = self.novo('Aviso Apple')
        u = self.uuid_de(c)                             # o aplicativo pediu os pacotes: o UUID fica conhecido
        jws = self.a.transacao('barras_600', u)
        st, r = self.aviso(self.a.aviso('ONE_TIME_CHARGE', jws))
        self.assertEqual((st, r.get('creditado')), (200, True), r)
        self.assertEqual(self.barras(c), 600)
        # o aviso repetido (a Apple reenvia) e no outro contêiner: nada a mais
        self.assertEqual(self.aviso(self.a.aviso('ONE_TIME_CHARGE', jws), self.base2)[1].get('creditado'), False)
        # o aplicativo mandando depois: não credita de novo, e manda encerrar
        st, r = self.manda(c, jws)
        self.assertEqual((st, r.get('repetido'), r.get('encerrar')), (200, True, True), r)
        self.assertEqual(self.barras(c), 600)
        # o UUID que o servidor não conhece: 200 sem crédito (o aplicativo a manda quando abrir)
        st, r = self.aviso(self.a.aviso('ONE_TIME_CHARGE', self.a.transacao('barras_50', '9b2f0d3e-1c4a-4b5d-8e6f-0a1b2c3d4e5f')))
        self.assertEqual((st, r.get('ignorado')), (200, 'conta desconhecida'), r)

    def test_10_reembolso_pelo_aviso(self):
        c = self.novo('Reembolso Apple')
        u = self.uuid_de(c)
        cheio, gasto = self.a.transacao('barras_280', u), self.a.transacao('barras_50', u)
        self.assertEqual(self.manda(c, cheio)[0], 201)
        st, r = self.aviso(self.a.aviso('REFUND', cheio))
        self.assertEqual((st, r.get('estado')), (200, 'estornada'), r)
        self.assertEqual(self.barras(c), 0)
        self.assertEqual(self.aviso(self.a.aviso('REFUND', cheio), self.base2)[1].get('estado'), 'ja-estornada')
        self.assertEqual(self.manda(c, cheio)[1].get('estado'), 'cancelada')
        # barras já gastas: tira o que houver e alerta o Mestre do que faltou
        self.assertEqual(self.manda(c, gasto)[0], 201)
        self.sql("UPDATE barras_saldo SET saldo = 20 WHERE conta_id = ?", c.conta['id'])
        self.assertEqual(self.aviso(self.a.aviso('REVOKE', gasto))[1].get('estado'), 'estornada')
        self.assertEqual(self.barras(c), 0)
        alertas = [json.loads(a['dados']) for a in self.sql(
            "SELECT dados FROM contas_alertas WHERE conta_id = ? AND tipo = 'estorno' ORDER BY id", c.conta['id'])]
        self.assertEqual([(a['tirado'], a['faltou']) for a in alertas], [(280, 0), (20, 30)], alertas)
        # reembolso de uma compra que o servidor nunca viu: a lápide, e ela não credita depois
        nunca = self.a.transacao('barras_600', u)
        self.assertEqual(self.aviso(self.a.aviso('REFUND', nunca))[1].get('estado'), 'lapide')
        st, r = self.manda(c, nunca)
        self.assertEqual((st, r.get('estado')), (409, 'cancelada'), r)

    def test_11_avisos_que_nao_valem(self):
        jws = self.a.transacao('barras_50')
        for torta in ('conteudo', 'outra-raiz', 'sem-marca', 'alg-none'):
            self.assertEqual(self.aviso(self.a.aviso('ONE_TIME_CHARGE', jws, torta=torta))[0], 401, torta)
        self.assertEqual(Cliente(self.base).pede('POST', AVISO, {})[0], 401)
        st, r = self.aviso(self.a.aviso('REFUND', jws, bundle='com.outro.jogo'))
        self.assertEqual((st, r.get('ignorado')), (200, 'outro aplicativo'), r)
        st, r = self.aviso(self.a.aviso('REFUND', jws, app_id=111))
        self.assertEqual((st, r.get('ignorado')), (200, 'outro aplicativo'), r)
        for tipo in ('TEST', 'CONSUMPTION_REQUEST', 'REFUND_DECLINED'):
            st, r = self.aviso(self.a.aviso(tipo, jws))
            self.assertEqual((st, r.get('ignorado')), (200, 'tipo'), (tipo, r))
        # o Sandbox no servidor que não aceita: 200 (a Apple não insiste), nada feito
        st, r = self.aviso(self.a.aviso('ONE_TIME_CHARGE', jws, ambiente='Sandbox'), self.base_sem_sandbox)
        self.assertEqual((st, r.get('ignorado')), (200, 'sandbox'), r)

    def test_12_a_raiz_da_apple_de_verdade(self):
        from cryptography import x509
        from cryptography.hazmat.primitives import serialization
        cert = x509.load_pem_x509_certificate(apple_mod.APPLE_RAIZ_G3.encode('ascii'))
        der = cert.public_bytes(serialization.Encoding.DER)
        self.assertEqual(hashlib.sha256(der).hexdigest(), apple_mod.APPLE_RAIZ_G3_SHA256)
        self.assertIn('CN=Apple Root CA - G3', cert.subject.rfc4514_string())
        self.assertTrue(apple_mod.LojaApple(ligado=True).ligado)
        # a transação de mentira NÃO passa na raiz de verdade
        with self.assertRaises(ValueError):
            apple_mod.LojaApple(ligado=True).transacao(self.a.transacao('barras_50'))
        # e o log de boot não tem nada de segredo (não há segredo: só a descrição)
        self.assertEqual(apple_mod.LojaApple().descricao(), 'App Store desligada (falta SOTERRA_APPLE=1)')


if __name__ == '__main__':
    unittest.main(verbosity=2)
