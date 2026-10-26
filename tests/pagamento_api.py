#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova dos pacotes de vinténs pagos (servidor/pagamento.py), pela API de verdade
e com o Mercado Pago DE MENTIRA (tests/mp_falso.py).

    python tests/pagamento_api.py

Sobe o Mercado Pago falso numa thread e servidor/api.py em subprocessos (banco
descartável; SOTERRA_MP_TOKEN, SOTERRA_MP_SEGREDO e SOTERRA_ENDERECO inventados,
só no ambiente do subprocesso; `--mp-api` apontando o falso). Nenhuma credencial
de verdade, nenhuma conversa com o Mercado Pago de verdade.

O que se prova: desligado (sem as variáveis) os pacotes aparecem "em breve", as
três rotas dão 503 e o histórico continua; ligado, a preferência (o corpo que o
Mercado Pago recebe: preço em reais, BRL, external_reference, back_urls, sem
payer, sem notification_url, sem boleto e lotérica) e o endereço; o idem; os
freios (10 por hora, R$ 400 em 24 h); o Mercado Pago fora; o AVISO assinado que
credita UMA vez (repetido, dez em paralelo, nos dois processos do rolling
update); a assinatura ruim ou ausente (401, e nenhuma consulta ao Mercado
Pago); o tipo que não é pagamento; o pagamento que o Mercado Pago não conhece;
a referência de outro sistema; o valor diferente (sem crédito, com alerta); o
live_mode trocado; pendente e depois aprovado; dois pagamentos na mesma
preferência; o estorno antes e depois da entrega; a contestação; a volta do
navegador (conferir), idempotente com o aviso; o crédito recusado pelo jogo que
volta; o modo de teste (sandbox); e que o log não tem o token nem o segredo.
O conserto (11/09): o estorno com o crédito RETIRADO e ainda não confirmado
cancela; a disputa aberta (in_mediation) só alerta; a leitura velha não faz o
estado voltar; o teto de 24 h vale no que credita (o link pago N vezes) e na
intenção nova; o modo trocado responde 503 (o Mercado Pago reenvia); e o botão
"conferir no Mercado Pago" do Mestre.
13/09, as barras de ouro: os pacotes À VENDA são de barras (a preferência, o idem,
os freios e o "em breve" provam com eles); os pacotes de vinténs saíram da venda,
e as provas do crédito de vinténs usam a intenção ANTIGA semeada no banco (criada
antes do deploy, aprovada depois: ainda credita os vinténs que vendeu). As provas
próprias das barras (o crédito na hora, o estorno que tira barras) moram em
tests/barras_api.py.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402  (põe servidor/ no sys.path)
from mp_falso import MercadoPagoFalso  # noqa: E402
import pagamento as pag_mod  # noqa: E402
import loja as loja_mod  # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ENDERECO = 'https://soterra.prova'
RE_REF = re.compile(r'^sot-(\d+)-[0-9a-f]{16}$')


def idem():
    return secrets.token_hex(8)


def sobe_api(pasta, nome, banco, env_extra=None, mp_api=None):
    porta = porta_livre()
    log_arq = os.path.join(pasta, nome + '.log')
    log = open(log_arq, 'w', encoding='utf-8')
    env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
    env.update(env_extra or {})
    args = [sys.executable, API, '--porta', str(porta), '--banco', banco]
    if mp_api:
        args += ['--mp-api', mp_api]
    proc = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT, env=env)
    base = 'http://127.0.0.1:%d' % porta
    if not espera_api(base, proc):
        para(proc, log)
        raise RuntimeError('a API %s não subiu; veja %s' % (nome, log_arq))
    return proc, log, base, log_arq


def para(proc, log):
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()
    log.close()


class ProvaDoPagamento(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.mkdtemp(prefix='soterra-pag-')
        cls.token = 'TEST-%s-prova' % secrets.token_hex(12)
        cls.segredo = 'segredo-%s' % secrets.token_hex(16)
        cls.mp = MercadoPagoFalso(cls.token, cls.segredo)
        cls.banco_arq = os.path.join(cls.pasta, 'dados', 'soterra.db')
        cls.env = {'SOTERRA_MP_TOKEN': cls.token, 'SOTERRA_MP_SEGREDO': cls.segredo, 'SOTERRA_ENDERECO': ENDERECO}
        cls.procs = []
        try:
            cls.proc, cls.log, cls.base, cls.log_arq = sobe_api(cls.pasta, 'api', cls.banco_arq, cls.env, cls.mp.base)
            cls.procs.append((cls.proc, cls.log))
            # uma API sem as variáveis (banco próprio): os pacotes "em breve"
            p, lg, cls.base_off, cls.log_off = sobe_api(cls.pasta, 'api-off', os.path.join(cls.pasta, 'off', 'soterra.db'))
            cls.procs.append((p, lg))
        except Exception:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        for proc, log in cls.procs:
            para(proc, log)
        cls.mp.parar()
        shutil.rmtree(cls.pasta, ignore_errors=True)

    # -- ajudantes ------------------------------------------------------------------
    def novo(self, apelido, base=None):
        ProvaDoPagamento._n += 1
        c = Cliente(base or self.base)
        status, r = c.cadastra('%s %d' % (apelido, ProvaDoPagamento._n))
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

    def pede_pacote(self, c, pacote='pacote-5500', chave=None):
        """13/09: o pacote de barras vai pela API; o de VINTÉNS saiu da venda (a API responde 'pacote
        desconhecido'), e a intenção antiga — criada antes do deploy — nasce no banco como o servidor de
        antes a gravaria (aberta, com a referência)."""
        if pacote.startswith('pacote-'):
            p = loja_mod.POR_PACOTE[pacote]
            t = int(time.time())
            b = sqlite3.connect(self.banco_arq)
            try:
                pid = b.execute("INSERT INTO pagamentos(conta_id, pacote, vintens, centavos, estado, idem, criado_em, "
                                "atualizado_em) VALUES (?, ?, ?, ?, 'aberto', ?, ?, ?)",
                                (c.conta['id'], pacote, p['vintens'], p['centavos'], chave or idem(), t, t)).lastrowid
                b.execute("UPDATE pagamentos SET referencia = ? WHERE id = ?", ('sot-%d-%s' % (pid, secrets.token_hex(8)), pid))
                b.commit()
            finally:
                b.close()
            return {'pagamento': {'id': pid}}
        status, r = c.pede('POST', '/api/pagamento/pacote', {'pacote': pacote, 'idem': chave or idem()})
        self.assertEqual(status, 201, r)
        return r

    def referencia(self, pid):
        return self.sql("SELECT referencia FROM pagamentos WHERE id = ?", pid)[0][0]

    def paga(self, pid_ou_ref, **kw):
        """Paga no falso. A intenção semeada não tem preferência no falso: o valor vem do banco."""
        campo = 'id' if isinstance(pid_ou_ref, int) else 'referencia'
        linha = self.sql("SELECT referencia, centavos FROM pagamentos WHERE %s = ?" % campo, pid_ou_ref)[0]
        kw.setdefault('centavos', linha['centavos'])
        return self.mp.pagar(linha['referencia'], **kw)

    def pago(self, c, pacote='pacote-5500', status='approved', **kw):
        """Pede o pacote, paga no falso e manda o aviso assinado: (id do pagamento, mp_id, resposta do aviso)."""
        r = self.pede_pacote(c, pacote)
        pid = r['pagamento']['id']
        mp_id = self.paga(pid, status=status, **kw)
        st, corpo = self.mp.avisar(mp_id, self.base)
        self.assertEqual(st, 200, corpo)
        return pid, mp_id, corpo

    def minha(self, c):
        status, r = c.pede('GET', '/api/loja/minha')
        self.assertEqual(status, 200, r)
        return r

    def meus(self, c):
        status, r = c.pede('GET', '/api/pagamento/meus')
        self.assertEqual(status, 200, r)
        return r

    def meu(self, c, pid):
        return [p for p in self.meus(c)['pagamentos'] if p['id'] == pid][0]

    def creditos(self, mp_id):
        return self.sql("SELECT p.id, p.estado, c.vintens FROM loja_creditos c JOIN loja_pedidos p ON p.id = c.pedido_id "
                        "WHERE c.mp_id = ? ORDER BY p.id", mp_id)

    def alertas(self, c):
        return [(a['tipo'], json.loads(a['dados'])) for a in
                self.sql("SELECT tipo, dados FROM contas_alertas WHERE conta_id = ? ORDER BY id", c.conta['id'])]

    def salva_anotacao(self, c, aplicadas=(), recusadas=(), carteira=0):
        versao = c.pede('GET', '/api/save')[1]['versao']
        db = {'versao': 1, 'jogador': {'nome': None}, 'carteira': {'moedas': carteira},
              'loja': {'aplicadas': list(aplicadas), 'recusadas': list(recusadas)}}
        status, r = c.salva(versao, {'version': 22, 'unlockedClasses': ['sumo', 'curandeiro'], 'heroes': {}}, db)
        self.assertEqual(status, 200, r)
        return r

    # -- desligado ------------------------------------------------------------------------
    def test_desligado_em_breve(self):
        r = Cliente(self.base_off).pede('GET', '/api/loja/catalogo')[1]
        self.assertEqual(r['pagamento'], {'ligado': False, 'teste': False})
        self.assertEqual([p['preco'] for p in r['pacotes']], ['R$ 4,90', 'R$ 19,90', 'R$ 39,90', 'R$ 79,90'])
        c = self.novo('Off Line', self.base_off)
        status, r = c.pede('POST', '/api/pagamento/pacote', {'pacote': 'barras-50', 'idem': idem()})
        self.assertEqual((status, r), (503, {'ok': False, 'erro': 'os pacotes de barras de ouro chegam em breve',
                                             'pagamento': False}))
        status, r = c.pede('POST', '/api/pagamento/conferir', {'id': 1})
        self.assertEqual((status, r['erro'], r['pagamento']), (503, 'os pacotes de barras de ouro chegam em breve', False))
        status, r = Cliente(self.base_off).pede('POST', '/api/pagamento/aviso?data.id=1&type=payment', {})
        self.assertEqual((status, r['erro']), (503, 'pagamentos desligados'))
        self.assertEqual(c.pede('GET', '/api/pagamento/meus'), (200, {'ok': True, 'ligado': False, 'pagamentos': []}))
        with open(self.log_off, encoding='utf-8', errors='replace') as f:
            self.assertIn('pagamento: DESLIGADO (falta SOTERRA_MP_TOKEN, SOTERRA_MP_SEGREDO, SOTERRA_ENDERECO)', f.read())
        # e a loja de vinténs segue igual
        self.assertEqual(Cliente(self.base_off).pede('GET', '/api/loja/catalogo')[0], 200)

    def test_mp_api_so_local(self):
        for torto in ('https://api.mercadopago.com', 'http://exemplo.com:8080', 'http://127.0.0.1', 'ftp://127.0.0.1:21',
                      'http://127.0.0.1:80/caminho'):
            r = subprocess.run([sys.executable, API, '--porta', '1', '--mp-api', torto], capture_output=True, text=True,
                               encoding='utf-8', errors='replace', timeout=30)
            self.assertEqual(r.returncode, 2, (torto, r.stderr[-300:]))
            self.assertIn('--mp-api aceita só http://127.0.0.1:PORTA', r.stderr)
        self.assertEqual(pag_mod.base_de_prova('http://localhost:8123/'), 'http://localhost:8123')

    # -- ligado ---------------------------------------------------------------------------
    def test_ligado_no_catalogo_e_no_log(self):
        r = Cliente(self.base).pede('GET', '/api/loja/catalogo')[1]
        self.assertEqual(r['pagamento'], {'ligado': True, 'teste': False})
        with open(self.log_arq, encoding='utf-8', errors='replace') as f:
            self.assertIn('pagamento: Mercado Pago (produção), volta em %s — API DE PROVA em %s' % (ENDERECO, self.mp.base),
                          f.read())

    def test_preferencia(self):
        c = self.novo('Pref Erencia')
        self.assertEqual(Cliente(self.base).pede('POST', '/api/pagamento/pacote', {'pacote': 'barras-280', 'idem': idem()})[0], 401)
        for corpo, erro in (({'pacote': 'pacote-9', 'idem': idem()}, 'pacote desconhecido'),
                            ({'pacote': None, 'idem': idem()}, 'pacote desconhecido'),
                            ({'pacote': 'pacote-5500', 'idem': idem()}, 'pacote desconhecido'),     # 13/09: fora da venda
                            ({'pacote': 'barras-280'}, 'idem inválido (8 a 64 letras, dígitos, _ ou -)'),
                            ({'pacote': 'barras-280', 'idem': 'x y z w v'}, 'idem inválido (8 a 64 letras, dígitos, _ ou -)')):
            status, r = c.pede('POST', '/api/pagamento/pacote', corpo)
            self.assertEqual((status, r['erro']), (400, erro), corpo)
        antes = len(self.mp.estado()['preferencias'])
        chave = idem()
        t0 = int(time.time())
        r = self.pede_pacote(c, 'barras-280', chave)
        pg = r['pagamento']
        self.assertTrue(r['endereco'].startswith('https://www.mercadopago.com.br/checkout/'), r['endereco'])
        self.assertEqual({k: pg[k] for k in ('pacote', 'nome', 'moeda', 'barras', 'vintens', 'centavos', 'preco', 'estado',
                                              'creditado', 'pedido')},
                         {'pacote': 'barras-280', 'nome': 'Saco de 280 barras de ouro', 'moeda': 'barras', 'barras': 280,
                          'vintens': 0, 'centavos': 1990, 'preco': 'R$ 19,90', 'estado': 'aberto', 'creditado': False,
                          'pedido': None})
        self.assertEqual(self.sql("SELECT vintens FROM pagamentos WHERE id = ?", pg['id'])[0][0], 280)   # a quantidade
        est = self.mp.estado()
        self.assertEqual(len(est['preferencias']), antes + 1)
        corpo = est['preferencias'][-1]
        self.assertEqual(corpo['items'], [{'id': 'barras-280', 'title': 'SOTERRA: Saco de 280 barras de ouro', 'quantity': 1,
                                           'currency_id': 'BRL', 'unit_price': 19.9}])
        casou = RE_REF.match(corpo['external_reference'])
        self.assertTrue(casou, corpo['external_reference'])
        self.assertEqual(int(casou.group(1)), pg['id'])
        self.assertEqual(self.mp.chaves[-1], corpo['external_reference'])       # X-Idempotency-Key
        volta = '%s/site/loja.html?pagamento=%d&volta=' % (ENDERECO, pg['id'])
        self.assertEqual(corpo['back_urls'], {'success': volta + 'aprovado', 'pending': volta + 'pendente',
                                              'failure': volta + 'falhou'})
        self.assertEqual(corpo['auto_return'], 'approved')
        self.assertEqual(corpo['statement_descriptor'], 'SOTERRA')
        self.assertEqual(corpo['payment_methods'], {'excluded_payment_types': [{'id': 'ticket'}, {'id': 'atm'}],
                                                    'installments': 1})
        self.assertNotIn('payer', corpo)                          # nenhum dado pessoal vai ao Mercado Pago
        self.assertNotIn('notification_url', corpo)               # o aviso é o do painel dele
        self.assertNotIn('@', json.dumps(corpo))
        self.assertNotIn(c.conta['nome'], json.dumps(corpo, ensure_ascii=False))
        self.assertEqual(corpo['metadata'], {'pagamento': pg['id']})
        self.assertIs(corpo['expires'], True)
        self.assertTrue(corpo['expiration_date_from'].endswith('-03:00'), corpo['expiration_date_from'])
        self.assertTrue(corpo['expiration_date_to'].endswith('-03:00'))
        self.assertLessEqual(abs(pag_mod.datetime.fromisoformat(corpo['expiration_date_from']).timestamp() - t0), 5)
        self.assertEqual(pag_mod.PREFERENCIA_VALIDADE, 2 * 3600)          # o link vale 2 h (aceita N pagamentos)
        self.assertEqual(pag_mod.datetime.fromisoformat(corpo['expiration_date_to']).timestamp()
                         - pag_mod.datetime.fromisoformat(corpo['expiration_date_from']).timestamp(), 2 * 3600)
        # o mesmo clique de novo: o mesmo pagamento, o mesmo endereço, nenhuma preferência nova
        status, r2 = c.pede('POST', '/api/pagamento/pacote', {'pacote': 'barras-280', 'idem': chave})
        self.assertEqual((status, r2['repetido'], r2['endereco'], r2['pagamento']['id']), (200, True, r['endereco'], pg['id']))
        self.assertEqual(len(self.mp.estado()['preferencias']), antes + 1)
        status, r3 = c.pede('POST', '/api/pagamento/pacote', {'pacote': 'barras-50', 'idem': chave})
        self.assertEqual((status, r3['erro']), (409, 'idem já usado em outro pacote'))
        # os meus: o pagamento aberto; o evento na trilha
        self.assertEqual([p['id'] for p in self.meus(c)['pagamentos']], [pg['id']])
        self.assertTrue(self.meus(c)['ligado'])
        ev = self.sql("SELECT dados FROM eventos WHERE conta_id = ? AND tipo = 'pagamento-criado'", c.conta['id'])
        self.assertEqual([json.loads(e[0]) for e in ev], [{'id': pg['id'], 'pacote': 'barras-280', 'centavos': 1990}])

    def test_freios(self):
        c = self.novo('Fre Ios')
        t = int(time.time())
        b = sqlite3.connect(self.banco_arq)
        b.executemany("INSERT INTO limites(chave, em) VALUES (?, ?)", [('pagamento:%d' % c.conta['id'], t - 30)] * 10)
        b.commit()
        b.close()
        status, r = c.pede('POST', '/api/pagamento/pacote', {'pacote': 'barras-50', 'idem': idem()})
        self.assertEqual((status, r['erro'], r['liberaEm']), (429, 'pedidos de pacote demais nesta hora (10)', t - 30 + 3600))
        # R$ 400,00 em 24 h (as intenções que falharam não contam)
        d = self.novo('Teto Dia')
        b = sqlite3.connect(self.banco_arq)
        b.execute("INSERT INTO pagamentos(conta_id, pacote, vintens, centavos, estado, criado_em, atualizado_em) "
                  "VALUES (?, 'pacote-25000', 25000, 39500, 'aberto', ?, ?)", (d.conta['id'], t - 500, t - 500))
        b.execute("INSERT INTO pagamentos(conta_id, pacote, vintens, centavos, estado, criado_em, atualizado_em) "
                  "VALUES (?, 'pacote-25000', 25000, 7990, 'falhou', ?, ?)", (d.conta['id'], t - 400, t - 400))
        b.execute("INSERT INTO pagamentos(conta_id, pacote, vintens, centavos, estado, criado_em, atualizado_em) "
                  "VALUES (?, 'pacote-25000', 25000, 7990, 'aberto', ?, ?)", (d.conta['id'], t - 90000, t - 90000))
        b.commit()
        b.close()
        self.pede_pacote(d, 'barras-50')                             # 39.500 + 490 = 39.990: cabe
        status, r = d.pede('POST', '/api/pagamento/pacote', {'pacote': 'barras-50', 'idem': idem()})
        self.assertEqual((status, r['erro'], r['liberaEm']), (429, 'o teto de pacotes é R$ 400,00 por dia', t - 500 + 86400))

    def test_mercado_pago_fora(self):
        c = self.novo('Fora Do Ar')
        self.mp.falhar('preferencias', 1)
        chave = idem()
        status, r = c.pede('POST', '/api/pagamento/pacote', {'pacote': 'barras-50', 'idem': chave})
        self.assertEqual((status, r['erro']), (502, 'o Mercado Pago não respondeu; tente de novo em instantes'))
        self.assertEqual([p['estado'] for p in self.meus(c)['pagamentos']], ['falhou'])
        status, r = c.pede('POST', '/api/pagamento/pacote', {'pacote': 'barras-50', 'idem': chave})
        self.assertEqual((status, r['erro']), (409, 'esse pedido falhou; tente de novo'))
        self.pede_pacote(c, 'barras-50')                              # chave nova: passa

    # -- o aviso ----------------------------------------------------------------------------
    def test_aviso_credita_uma_vez(self):
        c = self.novo('Uma Vez')
        pid, mp_id, corpo = self.pago(c, 'pacote-5500')
        self.assertEqual(corpo, {'ok': True, 'estado': 'aprovado'})
        m = self.minha(c)
        self.assertEqual((m['saldo']['aCaminho'], m['saldo']['disponivel']), (5500, 5500))
        linha = [p for p in m['pedidos'] if p.get('origem') == 'pagamento'][0]
        self.assertEqual({k: linha[k] for k in ('sku', 'nome', 'preco', 'estado', 'cancelavel', 'vintens')},
                         {'sku': 'pacote-5500', 'nome': 'Saco de 5.500 vinténs', 'preco': 0, 'estado': 'pendente',
                          'cancelavel': False, 'vintens': 5500})
        # o mesmo aviso de novo, e dez em paralelo: um crédito só
        self.assertEqual(self.mp.avisar(mp_id, self.base), (200, {'ok': True, 'estado': 'aprovado'}))
        res = []
        fios = [threading.Thread(target=lambda: res.append(self.mp.avisar(mp_id, self.base))) for _ in range(10)]
        for f in fios:
            f.start()
        for f in fios:
            f.join()
        self.assertEqual([s for s, _ in res], [200] * 10)
        self.assertEqual(len(self.creditos(mp_id)), 1)
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 5500)
        p = self.meu(c, pid)
        self.assertEqual((p['estado'], p['creditado'], p['vintens'], p['pedido']),
                         ('aprovado', True, 5500, {'id': linha['id'], 'estado': 'pendente'}))
        ev = self.sql("SELECT dados FROM eventos WHERE conta_id = ? AND tipo = 'pagamento-credito'", c.conta['id'])
        self.assertEqual([json.loads(e[0]) for e in ev], [{'pagamento': pid, 'mp': mp_id, 'vintens': 5500,
                                                           'pedido': linha['id']}])
        self.assertEqual(self.sql("SELECT idem FROM loja_pedidos WHERE id = ?", linha['id'])[0][0], 'mp:' + mp_id)

    def test_aviso_nos_dois_processos(self):
        """O rolling update: o aviso chega nos DOIS contêineres (mesmo banco) ao mesmo tempo."""
        proc2, log2, base2, _ = sobe_api(self.pasta, 'api2', self.banco_arq, self.env, self.mp.base)
        try:
            for rodada in range(4):
                c = self.novo('Dois Proc')
                r = self.pede_pacote(c, 'pacote-1000')
                mp_id = self.paga((r['pagamento']['id']))
                res = []
                fios = [threading.Thread(target=lambda b=b: res.append(self.mp.avisar(mp_id, b)))
                        for b in (self.base, base2, self.base, base2)]
                for f in fios:
                    f.start()
                for f in fios:
                    f.join()
                self.assertEqual(sorted(s for s, _ in res), [200] * 4, res)
                self.assertEqual(len(self.creditos(mp_id)), 1, 'rodada %d' % rodada)
                self.assertEqual(self.minha(c)['saldo']['aCaminho'], 1000)
        finally:
            para(proc2, log2)

    def test_assinatura_ruim_ou_ausente(self):
        c = self.novo('Forja Aviso')
        r = self.pede_pacote(c, 'pacote-12000')
        mp_id = self.paga((r['pagamento']['id']))
        antes = self.mp.estado()['consultas']
        for modo in ('ruim', 'sem'):
            status, corpo = self.mp.avisar(mp_id, self.base, assinatura=modo)
            self.assertEqual((status, corpo), (401, {'ok': False, 'erro': 'assinatura inválida'}), modo)
        # a assinatura boa de OUTRO pagamento, pendurada neste: também não
        ts, rid = str(int(time.time() * 1000)), 'req-%s' % secrets.token_hex(4)
        v1 = hmac.new(self.segredo.encode(), ('id:%s;request-id:%s;ts:%s;' % ('999', rid, ts)).encode(),
                      hashlib.sha256).hexdigest()
        status, corpo = self._aviso_cru(mp_id, rid, 'ts=%s,v1=%s' % (ts, v1))
        self.assertEqual(status, 401, corpo)
        self.assertEqual(self.mp.estado()['consultas'], antes)       # o forjado não gerou consulta nenhuma
        self.assertEqual(self.creditos(mp_id), [])
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 0)
        # sem data.id: 400
        status, corpo = self._aviso_cru(None, rid, 'ts=%s,v1=%s' % (ts, v1))
        self.assertEqual((status, corpo['erro']), (400, 'aviso sem data.id'))

    def _aviso_cru(self, data_id, request_id, assinatura, tipo='payment'):
        import urllib.error
        import urllib.parse
        import urllib.request
        q = {'type': tipo}
        if data_id is not None:
            q['data.id'] = data_id
        req = urllib.request.Request(self.base + '/api/pagamento/aviso?' + urllib.parse.urlencode(q),
                                     data=json.dumps({'type': tipo, 'data': {'id': data_id}}).encode(), method='POST')
        req.add_header('Content-Type', 'application/json')
        req.add_header('x-request-id', request_id)
        req.add_header('x-signature', assinatura)
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return r.status, json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode('utf-8'))

    def _assina(self, data_id, rid):
        ts = str(int(time.time() * 1000))
        v1 = hmac.new(self.segredo.encode(), ('id:%s;request-id:%s;ts:%s;' % (str(data_id).lower(), rid, ts)).encode(),
                      hashlib.sha256).hexdigest()
        return 'ts=%s,v1=%s' % (ts, v1)

    def test_tipo_desconhecido_e_id_torto(self):
        status, corpo = self.mp.avisar('123', self.base, tipo='merchant_order')
        self.assertEqual((status, corpo), (200, {'ok': True, 'ignorado': 'tipo'}))
        status, corpo = self.mp.avisar('555000111', self.base)           # o Mercado Pago não o conhece (a simulação)
        self.assertEqual((status, corpo), (200, {'ok': True, 'ignorado': 'pagamento desconhecido'}))
        rid = 'req-torto'
        status, corpo = self._aviso_cru('ABC-12', rid, self._assina('ABC-12', rid))     # assinado, mas não é número
        self.assertEqual((status, corpo['erro']), (400, 'data.id precisa ser o número do pagamento'))

    def test_referencia_de_outro_sistema(self):
        for ref in ('outra-loja-77', 'sot-99999999-0123456789abcdef'):
            mp_id = self.mp.pagar(ref, centavos=490)
            self.assertEqual(self.mp.avisar(mp_id, self.base), (200, {'ok': True, 'ignorado': 'referência desconhecida'}))
            self.assertEqual(self.sql("SELECT COUNT(*) FROM pagamentos_mp WHERE mp_id = ?", mp_id)[0][0], 0)

    def test_valor_diferente(self):
        c = self.novo('Valor Torto')
        pid, mp_id, corpo = self.pago(c, 'pacote-5500', centavos=100)
        self.assertEqual(corpo, {'ok': True, 'estado': 'pendente'})         # aprovado sem crédito: em análise
        self.assertEqual(self.creditos(mp_id), [])
        self.assertEqual(self.mp.avisar(mp_id, self.base)[0], 200)            # de novo: um alerta só
        self.assertEqual(self.alertas(c), [('valor-diferente', {'pagamento': pid, 'mp': mp_id, 'esperado': 1990,
                                                                'recebido': 100, 'moeda': 'BRL'})])
        _, mp2, _ = self.pago(c, 'pacote-1000', moeda='USD')                 # o valor certo, a moeda não
        self.assertEqual(self.creditos(mp2), [])
        self.assertEqual([a[0] for a in self.alertas(c)], ['valor-diferente', 'valor-diferente'])
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 0)

    def test_live_mode_trocado(self):
        """Modo trocado é configuração errada: 503 (o Mercado Pago avisa de novo), nunca 200 sem crédito."""
        c = self.novo('Modo Teste')
        r = self.pede_pacote(c, 'pacote-1000')
        pid = r['pagamento']['id']
        mp_id = self.paga((pid), live=False)             # o servidor está em produção
        st, corpo = self.mp.avisar(mp_id, self.base)
        self.assertEqual((st, corpo.get('erro')), (503, pag_mod.FRASE_MODO_TROCADO), corpo)
        self.assertEqual((self.creditos(mp_id), self.meu(c, pid)['estado']), ([], 'aberto'))
        with open(self.log_arq, encoding='utf-8', errors='replace') as f:
            self.assertIn('pagamento %d (mp %s): live_mode=False, e o servidor está em modo produção: não credita'
                          % (pid, mp_id), f.read())
        # 26/10: SOTERRA_MP_TESTE=1 esquecido junto com o token de produção. Antes, o pagamento de verdade que
        # chegava ao servidor em modo teste levava 503 e ficava sem crédito; com o modelo novo de teste do Mercado
        # Pago (o teste corre em produção, live_mode=true) a regra mudou: em modo teste, credita — quem pagou de
        # verdade recebe o que pagou. E o aviso repetido no servidor de produção não credita de novo
        proc, lg, base_t, _ = sobe_api(self.pasta, 'api-trocada', self.banco_arq, dict(self.env, SOTERRA_MP_TESTE='1'),
                                       self.mp.base)
        try:
            d = self.novo('Esqueceu Teste')
            pid2 = self.pede_pacote(d, 'pacote-5500')['pagamento']['id']
            real = self.paga((pid2))                     # live_mode=true
            self.assertEqual(self.mp.avisar(real, base_t), (200, {'ok': True, 'estado': 'aprovado'}))
            self.assertEqual(len(self.creditos(real)), 1)
        finally:
            para(proc, lg)
        self.assertEqual(self.mp.avisar(real, self.base), (200, {'ok': True, 'estado': 'aprovado'}))   # o reenvio
        self.assertEqual(len(self.creditos(real)), 1)                                                   # uma vez só
        self.assertEqual(self.minha(d)['saldo']['aCaminho'], 5500)

    def test_pendente_depois_aprovado(self):
        c = self.novo('Pix Pendente')
        pid, mp_id, corpo = self.pago(c, 'pacote-5500', status='pending')
        self.assertEqual(corpo, {'ok': True, 'estado': 'pendente'})
        self.assertEqual((self.creditos(mp_id), self.meu(c, pid)['estado']), ([], 'pendente'))
        self.mp.status(mp_id, 'approved')
        self.assertEqual(self.mp.avisar(mp_id, self.base), (200, {'ok': True, 'estado': 'aprovado'}))
        self.assertEqual(len(self.creditos(mp_id)), 1)
        # recusado não credita nada
        pid2, mp2, corpo = self.pago(c, 'pacote-1000', status='rejected')
        self.assertEqual((corpo['estado'], self.creditos(mp2)), ('recusado', []))

    def test_dois_pagamentos_na_mesma_preferencia(self):
        c = self.novo('Pagou Duas')
        r = self.pede_pacote(c, 'pacote-1000')
        pid, ref = r['pagamento']['id'], self.referencia(r['pagamento']['id'])
        m1, m2 = self.paga(ref), self.paga(ref)
        for m in (m1, m2, m1):
            self.assertEqual(self.mp.avisar(m, self.base)[0], 200)
        self.assertEqual((len(self.creditos(m1)), len(self.creditos(m2))), (1, 1))
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 2000)
        p = self.meu(c, pid)
        self.assertEqual((p['estado'], p['vintens'], p['creditado']), ('aprovado', 2000, True))

    def test_estorno_antes_da_entrega(self):
        c = self.novo('Estorno Cedo')
        pid, mp_id, _ = self.pago(c, 'pacote-5500')
        credito = self.creditos(mp_id)[0]['id']
        self.mp.status(mp_id, 'refunded')
        self.assertEqual(self.mp.avisar(mp_id, self.base), (200, {'ok': True, 'estado': 'estornado'}))
        self.assertEqual(self.creditos(mp_id)[0]['estado'], 'cancelado')
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 0)
        self.assertEqual(self.alertas(c), [('estorno-antes-da-entrega',
                                            {'pagamento': pid, 'mp': mp_id, 'vintens': 5500, 'pedido': credito,
                                             'estadoPedido': 'pendente', 'status': 'refunded', 'cancelado': True})])
        self.assertEqual(self.mp.avisar(mp_id, self.base)[0], 200)            # de novo: nada muda
        self.assertEqual(len(self.alertas(c)), 1)
        self.assertEqual(self.meu(c, pid)['estado'], 'estornado')
        # o jogo, que não soube, recebe mesmo assim e aplica: vira entregue, com alerta de estorno tardio
        self.salva_anotacao(c, aplicadas=[credito], carteira=5500)
        self.assertEqual(self.creditos(mp_id)[0]['estado'], 'entregue')
        self.assertEqual([a[0] for a in self.alertas(c)], ['estorno-antes-da-entrega', 'estorno'])
        self.assertTrue(self.alertas(c)[1][1]['tardio'])

    def test_estorno_e_contestacao_depois_da_entrega(self):
        c = self.novo('Estorno Tarde')
        pid, mp_id, _ = self.pago(c, 'pacote-1000')
        credito = self.creditos(mp_id)[0]['id']
        r = c.pede('POST', '/api/loja/retirar', {})[1]
        self.assertEqual([p['id'] for p in r['pedidos']], [credito])
        self.salva_anotacao(c, aplicadas=[credito], carteira=1000)
        self.assertEqual(self.creditos(mp_id)[0]['estado'], 'entregue')
        self.mp.status(mp_id, 'refunded')
        self.assertEqual(self.mp.avisar(mp_id, self.base)[0], 200)
        self.assertEqual(self.creditos(mp_id)[0]['estado'], 'entregue')       # o servidor não tira vinténs do save
        self.assertEqual(self.alertas(c), [('estorno', {'pagamento': pid, 'mp': mp_id, 'vintens': 1000, 'pedido': credito,
                                                        'estadoPedido': 'entregue', 'status': 'refunded'})])
        ev = self.sql("SELECT COUNT(*) FROM eventos WHERE conta_id = ? AND tipo = 'pagamento-estorno'", c.conta['id'])
        self.assertEqual(ev[0][0], 1)
        # a contestação (chargeback) de outro pagamento RETIRADO e ainda não confirmado pelo save (a aba fechou
        # no meio): o crédito é CANCELADO — sai do "a caminho" e não volta na próxima retirada
        pid2, mp2, _ = self.pago(c, 'pacote-1000')
        credito2 = self.creditos(mp2)[0]['id']
        c.pede('POST', '/api/loja/retirar', {})
        self.mp.status(mp2, 'charged_back')
        self.assertEqual(self.mp.avisar(mp2, self.base)[0], 200)
        self.assertEqual(self.creditos(mp2)[0]['estado'], 'cancelado')
        self.assertEqual(self.alertas(c)[-1], ('estorno-antes-da-entrega',
                                               {'pagamento': pid2, 'mp': mp2, 'vintens': 1000, 'pedido': credito2,
                                                'estadoPedido': 'retirado', 'status': 'charged_back', 'cancelado': True}))
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 0)
        self.assertEqual(c.pede('POST', '/api/loja/retirar', {})[1]['pedidos'], [])
        # o jogo já o tinha aplicado: o save seguinte o fecha 'entregue', com o alerta de contestação tardia
        self.salva_anotacao(c, aplicadas=[credito2], carteira=2000)
        self.assertEqual(self.creditos(mp2)[0]['estado'], 'entregue')
        self.assertEqual(self.alertas(c)[-1][0], 'contestacao')
        self.assertTrue(self.alertas(c)[-1][1]['tardio'])

    # -- o conserto (11/09): a disputa, a leitura velha e o teto no crédito ------------------------
    def test_disputa_aberta(self):
        """in_mediation é reclamação ABERTA: alerta, e o crédito fica; o desfecho vem depois."""
        c = self.novo('Disputa Viva')
        pid, mp_id, _ = self.pago(c, 'pacote-5500')
        credito = self.creditos(mp_id)[0]['id']
        self.mp.status(mp_id, 'in_mediation')
        self.assertEqual(self.mp.avisar(mp_id, self.base), (200, {'ok': True, 'estado': 'pendente'}))
        self.assertEqual([(x['id'], x['estado']) for x in self.creditos(mp_id)], [(credito, 'pendente')])   # não cancela
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 5500)
        self.assertEqual(self.alertas(c), [('contestacao', {'pagamento': pid, 'mp': mp_id, 'vintens': 5500, 'pedido': credito,
                                                            'estadoPedido': 'pendente', 'status': 'in_mediation',
                                                            'aberta': True})])
        self.assertEqual(self.mp.avisar(mp_id, self.base)[0], 200)            # de novo: um alerta só
        self.assertEqual(len(self.alertas(c)), 1)
        # a disputa acaba a favor do vendedor: o pagamento volta a aprovado, e nada muda no crédito
        self.mp.status(mp_id, 'approved')
        self.assertEqual(self.mp.avisar(mp_id, self.base), (200, {'ok': True, 'estado': 'aprovado'}))
        self.assertEqual([(x['id'], x['estado']) for x in self.creditos(mp_id)], [(credito, 'pendente')])
        self.assertEqual((len(self.alertas(c)), self.meu(c, pid)['creditado']), (1, True))
        # outra disputa, com o crédito já no jogo, que acaba em estorno: aí sim o alerta de estorno
        pid2, mp2, _ = self.pago(c, 'pacote-1000')
        cred2 = self.creditos(mp2)[0]['id']
        c.pede('POST', '/api/loja/retirar', {})
        self.salva_anotacao(c, aplicadas=[credito, cred2], carteira=6500)
        self.mp.status(mp2, 'in_mediation')
        self.assertEqual(self.mp.avisar(mp2, self.base), (200, {'ok': True, 'estado': 'pendente'}))
        self.mp.status(mp2, 'refunded')
        self.assertEqual(self.mp.avisar(mp2, self.base), (200, {'ok': True, 'estado': 'estornado'}))
        self.assertEqual([a[0] for a in self.alertas(c)], ['contestacao', 'contestacao', 'estorno'])
        self.assertEqual((self.alertas(c)[1][1]['estadoPedido'], self.alertas(c)[1][1]['aberta']), ('entregue', True))
        self.assertEqual(self.alertas(c)[2][1], {'pagamento': pid2, 'mp': mp2, 'vintens': 1000, 'pedido': cred2,
                                                 'estadoPedido': 'entregue', 'status': 'refunded'})
        self.assertEqual(self.creditos(mp2)[0]['estado'], 'entregue')           # o servidor não tira vinténs do save

    def test_leitura_velha(self):
        """Duas leituras em voo gravam fora de ordem: a que faria o estado VOLTAR é ignorada."""
        c = self.novo('Leitura Velha')
        # o estorno grava antes do 'approved' que ainda estava em voo: nada credita, nada de alerta
        pid = self.pede_pacote(c, 'pacote-1000')['pagamento']['id']
        mp_id = self.paga((pid), status='refunded')
        self.assertEqual(self.mp.avisar(mp_id, self.base), (200, {'ok': True, 'estado': 'estornado'}))
        self.mp.status(mp_id, 'approved')                                    # a leitura velha, gravada depois
        self.assertEqual(self.mp.avisar(mp_id, self.base), (200, {'ok': True, 'estado': 'estornado'}))
        self.assertEqual((self.creditos(mp_id), self.alertas(c)), ([], []))
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 0)
        self.assertEqual(self.sql("SELECT status FROM pagamentos_mp WHERE mp_id = ?", mp_id)[0][0], 'refunded')
        with open(self.log_arq, encoding='utf-8', errors='replace') as f:
            self.assertIn('pagamento %d (mp %s): leitura velha (approved depois de refunded); ignorada' % (pid, mp_id), f.read())
        # o 'pending' velho depois do 'approved' não põe "em análise" num pacote já creditado
        pid2, mp2, _ = self.pago(c, 'pacote-1000')
        self.mp.status(mp2, 'pending')
        self.assertEqual(self.mp.avisar(mp2, self.base), (200, {'ok': True, 'estado': 'aprovado'}))
        p = self.meu(c, pid2)
        self.assertEqual((p['estado'], p['creditado'], len(self.creditos(mp2))), ('aprovado', True, 1))

    def test_teto_no_credito_e_o_conferir_do_mestre(self):
        """Uma preferência aceita vários pagamentos: o teto de 24 h vale também no que credita."""
        c = self.novo('Link Repetido')
        pid = self.pede_pacote(c, 'pacote-25000')['pagamento']['id']
        ref = self.referencia(pid)
        ids = [self.paga(ref) for _ in range(6)]
        for m in ids:
            self.assertEqual(self.mp.avisar(m, self.base)[0], 200)
        self.assertEqual([len(self.creditos(m)) for m in ids], [1, 1, 1, 1, 1, 0])      # 5 × R$ 79,90 = R$ 399,50
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 125000)
        self.assertEqual(self.alertas(c), [('teto-diario', {'pagamento': pid, 'mp': ids[5], 'vintens': 25000,
                                                            'centavos': 7990, 'pagoEm24h': 39950})])
        self.assertEqual(self.mp.avisar(ids[5], self.base)[0], 200)          # o aviso repetido: sem crédito, sem alerta novo
        self.assertEqual((len(self.creditos(ids[5])), len(self.alertas(c))), (0, 1))
        p = self.meu(c, pid)
        self.assertEqual((p['estado'], p['vintens']), ('aprovado', 125000))
        # a conta não abre intenção nova que o teto não deixaria creditar (o creditado conta na intenção)
        status, r = c.pede('POST', '/api/pagamento/pacote', {'pacote': 'barras-50', 'idem': idem()})
        self.assertEqual((status, r['erro']), (429, 'o teto de pacotes é R$ 400,00 por dia'), r)
        primeiro = self.sql("SELECT MIN(creditado_em) FROM pagamentos_mp WHERE pagamento_id = ?", pid)[0][0]
        self.assertEqual(r['liberaEm'], primeiro + 86400)
        # o botão do Mestre: só o Mestre; id torto 400; id que não existe 404
        self.assertEqual(c.pede('POST', '/api/mestre/pagamento/conferir', {'id': pid})[0], 403)
        m = self.novo('Pia Confere')       # 'Mestre' no nome é reservado à equipe
        self.sql("UPDATE contas SET gm = 1 WHERE id = ?", m.conta['id'])
        self.assertEqual(m.pede('POST', '/api/mestre/pagamento/conferir', {'id': 'x'})[0], 400)
        self.assertEqual(m.pede('POST', '/api/mestre/pagamento/conferir', {'id': 999999})[0], 404)
        # antes das 24 h, conferir não credita (o teto segue valendo) nem repete o alerta
        st, r = m.pede('POST', '/api/mestre/pagamento/conferir', {'id': pid})
        self.assertEqual((st, r['achados'], r['ignorados'], len(self.creditos(ids[5]))), (200, 6, [], 0), r)
        self.assertEqual(len(self.alertas(c)), 1)
        # passadas as 24 h (os créditos "envelhecem" no banco), o conferir do Mestre credita o 6º
        self.sql("UPDATE pagamentos_mp SET creditado_em = creditado_em - 90000 WHERE pagamento_id = ? "
                 "AND creditado_em IS NOT NULL", pid)
        st, r = m.pede('POST', '/api/mestre/pagamento/conferir', {'id': pid})
        self.assertEqual(st, 200, r)
        self.assertEqual((len(self.creditos(ids[5])), r['pagamento']['vintens'], r['pagamento']['estado']),
                         (1, 150000, 'aprovado'))
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 150000)
        with open(self.log_arq, encoding='utf-8', errors='replace') as f:
            self.assertIn('mestre: #%d conferiu o pagamento %d no Mercado Pago (6 achado(s))' % (m.conta['id'], pid), f.read())

    # -- a volta do navegador -------------------------------------------------------------------
    def test_conferir(self):
        c = self.novo('Volta Nave')
        r = self.pede_pacote(c, 'pacote-12000')
        pid = r['pagamento']['id']
        # voltou antes de pagar: aberto
        status, r = c.pede('POST', '/api/pagamento/conferir', {'id': pid})
        self.assertEqual((status, r['pagamento']['estado']), (200, 'aberto'))
        mp_id = self.paga((pid))                          # pagou; o aviso "se perdeu"
        buscas = self.mp.estado()['buscas']
        status, r = c.pede('POST', '/api/pagamento/conferir', {'id': pid})
        self.assertEqual(status, 200, r)
        self.assertEqual((r['pagamento']['estado'], r['pagamento']['creditado']), ('aprovado', True))
        self.assertEqual(self.mp.estado()['buscas'], buscas + 1)
        self.assertEqual(len(self.creditos(mp_id)), 1)
        # o aviso atrasado e outra conferência: nada a mais
        self.assertEqual(self.mp.avisar(mp_id, self.base)[0], 200)
        self.assertEqual(c.pede('POST', '/api/pagamento/conferir', {'id': pid})[0], 200)
        self.assertEqual(len(self.creditos(mp_id)), 1)
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 12000)
        # de outra conta, torto, e o freio
        d = self.novo('Volta Outra')
        self.assertEqual(d.pede('POST', '/api/pagamento/conferir', {'id': pid}),
                         (404, {'ok': False, 'erro': 'pagamento não encontrado'}))
        for torto in ({}, {'id': 'x'}, {'id': True}, {'id': 0}):
            self.assertEqual(c.pede('POST', '/api/pagamento/conferir', torto)[1].get('erro'),
                             'id precisa ser o número do pagamento', torto)
        t = int(time.time())
        b = sqlite3.connect(self.banco_arq)
        b.executemany("INSERT INTO limites(chave, em) VALUES (?, ?)", [('pag-conferir:%d' % d.conta['id'], t - 10)] * 30)
        b.commit()
        b.close()
        status, r = d.pede('POST', '/api/pagamento/conferir', {'id': pid})
        self.assertEqual((status, r['erro'], r['liberaEm']), (429, 'conferências demais nesta hora (30)', t - 10 + 3600))

    def test_credito_recusado_pelo_jogo_volta(self):
        c = self.novo('Jogo Velho')
        pid, mp_id, _ = self.pago(c, 'pacote-1000')
        credito = self.creditos(mp_id)[0]['id']
        c.pede('POST', '/api/loja/retirar', {})
        r = self.salva_anotacao(c, recusadas=[{'id': credito, 'motivo': 'item-invalido'}])
        self.assertEqual(r['loja']['estornados'], [credito])
        novo = r['loja']['reemitidos'][0]
        self.assertEqual([(x['id'], x['estado']) for x in self.creditos(mp_id)], [(credito, 'estornado'), (novo, 'pendente')])
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 1000)
        self.assertEqual(self.meu(c, pid)['pedido'], {'id': novo, 'estado': 'pendente'})

    def test_modo_teste_sandbox(self):
        env = dict(self.env, SOTERRA_MP_TESTE='1')
        proc, log, base, log_arq = sobe_api(self.pasta, 'api-teste', os.path.join(self.pasta, 'teste', 'soterra.db'),
                                            env, self.mp.base)
        try:
            self.assertEqual(Cliente(base).pede('GET', '/api/loja/catalogo')[1]['pagamento'], {'ligado': True, 'teste': True})
            c = self.novo('Sand Box', base)
            status, r = c.pede('POST', '/api/pagamento/pacote', {'pacote': 'barras-50', 'idem': idem()})
            self.assertEqual(status, 201, r)
            self.assertTrue(r['endereco'].startswith('https://sandbox.mercadopago.com.br/'), r['endereco'])
            b = sqlite3.connect(os.path.join(self.pasta, 'teste', 'soterra.db'))
            ref = b.execute("SELECT referencia FROM pagamentos WHERE id = ?", (r['pagamento']['id'],)).fetchone()[0]
            b.close()
            # 26/10: o modelo NOVO de teste do Mercado Pago (o vendedor e o comprador de teste) corre em produção:
            # o pagamento aprovado chega com live_mode=true — e credita, em modo teste
            novo = self.mp.pagar(ref, live=True)
            self.assertEqual(self.mp.avisar(novo, base), (200, {'ok': True, 'estado': 'aprovado'}))
            self.assertEqual(c.pede('GET', '/api/loja/minha')[1]['barras']['saldo'], 50)     # 13/09: barras, na hora
            # o modelo ANTIGO (o token TEST-, live_mode=false) segue creditando
            de_teste = self.mp.pagar(ref, live=False)
            self.assertEqual(self.mp.avisar(de_teste, base), (200, {'ok': True, 'estado': 'aprovado'}))
            self.assertEqual(c.pede('GET', '/api/loja/minha')[1]['barras']['saldo'], 100)
            with open(log_arq, encoding='utf-8', errors='replace') as f:
                texto = f.read()
            self.assertIn('pagamento: Mercado Pago (teste), volta em ' + ENDERECO, texto)
            self.assertIn('live_mode=True com o servidor em modo teste', texto)
        finally:
            para(proc, log)

    # -- o log e as funções puras ---------------------------------------------------------------
    def test_log_sem_token_nem_segredo(self):
        self.pago(self.novo('Log Limpo'), 'pacote-1000')
        self.mp.avisar('1', self.base, assinatura='ruim')
        for arq in (self.log_arq, self.log_off):
            with open(arq, encoding='utf-8', errors='replace') as f:
                texto = f.read()
            self.assertNotIn(self.token, texto)
            self.assertNotIn(self.segredo, texto)
            self.assertNotIn(self.token[5:20], texto)
        self.assertNotIn(self.token, repr(pag_mod.MercadoPago(token=self.token, segredo=self.segredo, endereco=ENDERECO)))

    def test_assinatura_funcao_pura(self):
        """A regra da documentação de webhooks do Mercado Pago, dos dois lados."""
        segredo, rid, ts = 'segredo-de-exemplo', 'bb56a2f1-6aae-46ac-982e-9dcd3581d08e', '1742505638683'
        esperado = hmac.new(segredo.encode(), ('id:123456;request-id:%s;ts:%s;' % (rid, ts)).encode(),
                            hashlib.sha256).hexdigest()
        self.assertEqual(pag_mod.assina(segredo, '123456', rid, ts), esperado)
        self.assertTrue(pag_mod.assinatura_confere(segredo, 'ts=%s,v1=%s' % (ts, esperado), rid, '123456'))
        self.assertTrue(pag_mod.assinatura_confere(segredo, ' ts = %s , v1 = %s ' % (ts, esperado), rid, '123456'))
        self.assertFalse(pag_mod.assinatura_confere(segredo, 'ts=%s,v1=%s' % (ts, esperado), rid, '123457'))
        self.assertFalse(pag_mod.assinatura_confere('outro', 'ts=%s,v1=%s' % (ts, esperado), rid, '123456'))
        self.assertFalse(pag_mod.assinatura_confere(segredo, 'ts=%s' % ts, rid, '123456'))
        self.assertFalse(pag_mod.assinatura_confere(segredo, None, rid, '123456'))
        self.assertFalse(pag_mod.assinatura_confere(segredo, 'ts=%s,v1=çãõ' % ts, rid, '123456'))   # sem exceção
        self.assertFalse(pag_mod.assinatura_confere(None, 'ts=%s,v1=%s' % (ts, esperado), rid, '123456'))
        # o data.id alfanumérico entra em minúsculas; o valor que falta sai do manifesto
        self.assertEqual(pag_mod.manifesto('ORD01JQ4S4KY8', rid, ts), 'id:ord01jq4s4ky8;request-id:%s;ts:%s;' % (rid, ts))
        self.assertEqual(pag_mod.manifesto('77', None, ts), 'id:77;ts:%s;' % ts)
        self.assertEqual(pag_mod.manifesto(None, rid, ts), 'request-id:%s;ts:%s;' % (rid, ts))
        sem_rid = hmac.new(segredo.encode(), ('id:77;ts:%s;' % ts).encode(), hashlib.sha256).hexdigest()
        self.assertTrue(pag_mod.assinatura_confere(segredo, 'ts=%s,v1=%s' % (ts, sem_rid), None, '77'))
        # o falso (tests/mp_falso.py) assina pela mesma regra, escrita de novo lá
        import mp_falso
        self.assertEqual(mp_falso.assina_aviso(segredo, 'ORD01X', rid, ts), pag_mod.assina(segredo, 'ORD01X', rid, ts))
        self.assertTrue(pag_mod.endereco_do_mp('https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=1'))
        self.assertTrue(pag_mod.endereco_do_mp('https://sandbox.mercadopago.com.br/x'))
        for torto in ('http://www.mercadopago.com.br/x', 'https://mercadopago.com.br.golpe.com/x',
                      'https://golpemercadopago.com.br/x', None, 7):
            self.assertFalse(pag_mod.endereco_do_mp(torto), torto)


if __name__ == '__main__':
    unittest.main(verbosity=2)
