#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova das BARRAS DE OURO (13/09; servidor/loja.py, pagamento.py e mestre.py), pela API de verdade.

    python tests/barras_api.py

Pedido do dono: "outro tipo de moeda.. esse será barras de ouro, sendo possível
comprar pela loja do site.. lá o jogador poderá comprar vinténs para o jogo, mas
pelos vinténs será possível também comprar barras de ouro, mas será muito mais
caro... assim fica possível para todos sem ser um jogo pay to win".

Sobe, tudo descartável e em prioridade abaixo do normal (a máquina é dividida
com quem joga): o Mercado Pago DE MENTIRA (tests/mp_falso.py, numa thread), o
JUIZ em Node (servidor/juiz/juiz.js), uma API COM a autoridade (--juiz, e com as
variáveis de pagamento inventadas aqui) e uma API SEM juiz, com banco próprio (o
caminho antigo: o jogo aplica e o PUT do save confirma).

O que se prova:
  - o pacote aprovado credita as barras NA HORA, uma vez só (o aviso repetido, dez
    em paralelo e a conferência não duplicam), sem pedido nem jogo no meio;
  - o estorno tira as barras que houver; a contestação com as barras já gastas
    tira o que dá e o alerta diz quanto faltou;
  - comprar em barras debita na hora; cancelar devolve (uma vez); sem barras, 409
    e nenhum pedido;
  - a recusa do jogo (o juiz: classe já liberada) devolve as barras;
  - duas compras quase juntas com saldo para uma só: uma passa, o saldo nunca fica
    negativo (e o banco recusa saldo negativo e movimento zero por si);
  - barras → vinténs: os vinténs chegam ao estado do servidor pela entrega do juiz;
  - vinténs → barras: as barras só entram quando a entrega tira os vinténs (nunca
    antes, nunca duas vezes); sem vinténs no estado, o juiz recusa e nada entra; sem
    vinténs no saldo do site, a compra é recusada; no caminho antigo, o PUT que
    confirma a entrega credita (e a mesma anotação de novo, não);
  - o pagamento de um pacote ANTIGO de vinténs, aprovado depois do deploy, ainda
    credita os vinténs que vendeu (e o pacote antigo não se pede mais);
  - o presente de barras do Mestre (idem, tetos, conta banida, a trilha, a ficha) e
    que conta não-Mestre não presenteia.
"""
import copy
import json
import os
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, '..'))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402  (põe servidor/ no sys.path)
from mp_falso import MercadoPagoFalso  # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

JUIZ = os.path.join(RAIZ, 'servidor', 'juiz', 'juiz.js')
ESTADO_JS = os.path.join(RAIZ, 'servidor', 'juiz', 'estado.js').replace('\\', '/')
BAIXA = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)
ENDERECO = 'https://soterra.prova'


def idem():
    return secrets.token_hex(8)


def acha_node():
    for c in (shutil.which('node'), r'C:\Program Files\nodejs\node.exe'):
        if c and os.path.exists(c):
            return c
    return None


NODE = acha_node()


def espera_url(url, proc, segundos=60):
    limite = time.time() + segundos
    while time.time() < limite:
        if proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.2)
    return False


class ProvaDasBarras(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls):
        if NODE is None:
            raise unittest.SkipTest('sem node nesta máquina: o juiz não sobe')
        cls.pasta = tempfile.mkdtemp(prefix='soterra-barras-')
        cls.banco_arq = os.path.join(cls.pasta, 'dados', 'soterra.db')
        cls.banco_leg = os.path.join(cls.pasta, 'legado', 'soterra.db')
        cls.procs, cls.logs = [], []
        cls.mp = None
        try:
            cls.token = 'TEST-%s-prova' % secrets.token_hex(12)
            cls.segredo = 'segredo-%s' % secrets.token_hex(16)
            cls.mp = MercadoPagoFalso(cls.token, cls.segredo)
            porta_juiz = porta_livre()
            cls.juiz = 'http://127.0.0.1:%d' % porta_juiz
            pj = cls._processo('juiz', [NODE, JUIZ, '--porta', str(porta_juiz)])
            if not espera_url(cls.juiz + '/saude', pj):
                raise RuntimeError('o juiz não subiu; veja ' + cls.pasta)
            codigo = ("const est = require(process.argv[1]); const w = est.mundoEconomico({}); est.poeEstado(w, null, null);"
                      "const s = est.tiraEstado(w); process.stdout.write(JSON.stringify({progress: s.progress, db: s.db}));")
            r = subprocess.run([NODE, '-e', codigo, ESTADO_JS], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               timeout=120, creationflags=BAIXA)
            cls.inicial = json.loads(r.stdout.decode('utf-8'))
            env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
            env_mp = dict(env, SOTERRA_MP_TOKEN=cls.token, SOTERRA_MP_SEGREDO=cls.segredo, SOTERRA_ENDERECO=ENDERECO)
            cls.base = cls._api('api', env_mp, cls.banco_arq, ['--juiz', cls.juiz, '--mp-api', cls.mp.base])
            cls.base_leg = cls._api('api-legado', env, cls.banco_leg, [])
        except BaseException:
            cls.tearDownClass()
            raise

    @classmethod
    def _processo(cls, nome, args, env=None):
        log = open(os.path.join(cls.pasta, nome + '.log'), 'w', encoding='utf-8')
        cls.logs.append(log)
        p = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT, env=env, creationflags=BAIXA)
        cls.procs.append(p)
        return p

    @classmethod
    def _api(cls, nome, env, banco, extra):
        porta = porta_livre()
        p = cls._processo(nome, [sys.executable, API, '--porta', str(porta), '--banco', banco] + extra, env)
        base = 'http://127.0.0.1:%d' % porta
        if not espera_api(base, p, 30):
            raise RuntimeError('a API %s não subiu; veja %s' % (nome, cls.pasta))
        return base

    @classmethod
    def tearDownClass(cls):
        for p in getattr(cls, 'procs', []):         # só os processos que esta prova subiu
            if p.poll() is None:
                p.terminate()
                try:
                    p.wait(5)
                except subprocess.TimeoutExpired:
                    p.kill()
        for log in getattr(cls, 'logs', []):
            log.close()
        if getattr(cls, 'mp', None) is not None:
            cls.mp.parar()
        shutil.rmtree(getattr(cls, 'pasta', ''), ignore_errors=True)

    # -- ajudantes ------------------------------------------------------------------------
    def novo(self, apelido, base=None):
        ProvaDasBarras._n += 1
        c = Cliente(base or self.base)
        status, r = c.cadastra('%s %d' % (apelido, ProvaDasBarras._n))
        self.assertEqual(status, 201, r)
        return c

    def sql(self, consulta, *args, banco=None):
        b = sqlite3.connect(banco or self.banco_arq)
        b.row_factory = sqlite3.Row
        try:
            linhas = [dict(r) for r in b.execute(consulta, args).fetchall()]
            b.commit()
            return linhas
        finally:
            b.close()

    def da_barras(self, c, n, banco=None):
        """Barras na conta como um 'ajuste' do dono (o saldo e o extrato juntos)."""
        t = int(time.time())
        self.sql("INSERT INTO barras_saldo(conta_id, saldo, atualizado_em) VALUES (?, ?, ?) "
                 "ON CONFLICT(conta_id) DO UPDATE SET saldo = saldo + excluded.saldo", c.conta['id'], n, t, banco=banco)
        self.sql("INSERT INTO barras_movimentos(conta_id, delta, motivo, ref, saldo_depois, criado_em) "
                 "VALUES (?, ?, 'ajuste', 'prova', (SELECT saldo FROM barras_saldo WHERE conta_id = ?), ?)",
                 c.conta['id'], n, c.conta['id'], t, banco=banco)

    def minha(self, c):
        status, r = c.pede('GET', '/api/loja/minha')
        self.assertEqual(status, 200, r)
        return r

    def barras(self, c):
        return self.minha(c)['barras']['saldo']

    def compra(self, c, sku, chave=None):
        return c.pede('POST', '/api/loja/comprar', {'sku': sku, 'idem': chave or idem()})

    def comprou(self, c, sku):
        status, r = self.compra(c, sku)
        self.assertEqual(status, 201, (sku, r))
        return r['pedido']

    def poe_estado(self, c, carteira=0, classes=None):
        """O primeiro PUT da conta (aceito inteiro): vira o estado do servidor."""
        p = copy.deepcopy(self.inicial['progress'])
        d = copy.deepcopy(self.inicial['db'])
        d['carteira'] = {'moedas': carteira}
        if classes is not None:
            p['unlockedClasses'] = list(classes)
        status, r = c.salva(0, p, d)
        self.assertEqual(status, 200, r)
        return r

    def save(self, c):
        status, r = c.pede('GET', '/api/save')
        self.assertEqual(status, 200, r)
        return r

    def mexe_estado(self, c, progress=None, carteira=None):
        """Troca o estado do servidor por baixo (só no banco da prova): o jogo "mudou" entre a compra e a entrega."""
        linha = self.sql("SELECT progress, db FROM saves WHERE conta_id = ?", c.conta['id'])[0]
        p, d = json.loads(linha['progress']), json.loads(linha['db'])
        if progress is not None:
            progress(p)
        if carteira is not None:
            d['carteira']['moedas'] = carteira
        self.sql("UPDATE saves SET progress = ?, db = ? WHERE conta_id = ?", json.dumps(p), json.dumps(d), c.conta['id'])

    def retira(self, c):
        status, r = c.pede('POST', '/api/loja/retirar', {})
        self.assertEqual(status, 200, r)
        return r

    def movimentos(self, c, motivo=None, banco=None):
        q = "SELECT delta, motivo, ref, idem FROM barras_movimentos WHERE conta_id = ?"
        args = [c.conta['id']]
        if motivo:
            q += " AND motivo = ?"
            args.append(motivo)
        return self.sql(q + " ORDER BY id", *args, banco=banco)

    def alertas(self, c):
        return [(a['tipo'], json.loads(a['dados'])) for a in
                self.sql("SELECT tipo, dados FROM contas_alertas WHERE conta_id = ? ORDER BY id", c.conta['id'])]

    def pede_pacote(self, c, pacote):
        status, r = c.pede('POST', '/api/pagamento/pacote', {'pacote': pacote, 'idem': idem()})
        self.assertEqual(status, 201, r)
        return r['pagamento']['id']

    def referencia(self, pid):
        return self.sql("SELECT referencia FROM pagamentos WHERE id = ?", pid)[0]['referencia']

    def pago(self, c, pacote):
        pid = self.pede_pacote(c, pacote)
        mp_id = self.mp.pagar(self.referencia(pid))
        self.assertEqual(self.mp.avisar(mp_id, self.base), (200, {'ok': True, 'estado': 'aprovado'}))
        return pid, mp_id

    def mestre(self, apelido):
        m = self.novo(apelido)
        self.sql("UPDATE contas SET gm = 1 WHERE id = ?", m.conta['id'])
        return m

    # -- 1. o pacote em reais --------------------------------------------------------------
    def test_01_pacote_aprovado_credita_barras_uma_vez(self):
        c = self.novo('Bolsa Cheia')
        self.assertEqual(self.barras(c), 0)
        pid, mp_id = self.pago(c, 'barras-280')
        self.assertEqual(self.barras(c), 280, 'as barras entram na hora, sem o jogo')
        # o mesmo aviso de novo, dez em paralelo e a volta do navegador: nada a mais
        res = []
        fios = [threading.Thread(target=lambda: res.append(self.mp.avisar(mp_id, self.base))) for _ in range(10)]
        for f in fios:
            f.start()
        for f in fios:
            f.join()
        self.assertEqual([s for s, _ in res], [200] * 10)
        self.assertEqual(c.pede('POST', '/api/pagamento/conferir', {'id': pid})[0], 200)
        m = self.minha(c)
        self.assertEqual(m['barras']['saldo'], 280)
        self.assertEqual([(x['motivo'], x['delta'], x['saldo'], x['nome']) for x in m['barras']['movimentos']],
                         [('pacote', 280, 280, 'Saco de 280 barras de ouro')])
        self.assertEqual(self.movimentos(c), [{'delta': 280, 'motivo': 'pacote', 'ref': 'pagamento:%d' % pid,
                                               'idem': 'mp:' + mp_id}])
        self.assertEqual((m['pedidos'], m['saldo']['aCaminho']), ([], 0))          # nenhum pedido, nenhum vintém
        pag = c.pede('GET', '/api/pagamento/meus')[1]['pagamentos'][0]
        self.assertEqual({k: pag[k] for k in ('pacote', 'nome', 'moeda', 'barras', 'vintens', 'estado', 'creditado',
                                              'pedido', 'preco')},
                         {'pacote': 'barras-280', 'nome': 'Saco de 280 barras de ouro', 'moeda': 'barras', 'barras': 280,
                          'vintens': 0, 'estado': 'aprovado', 'creditado': True, 'pedido': None, 'preco': 'R$ 19,90'})
        ev = self.sql("SELECT dados FROM eventos WHERE conta_id = ? AND tipo = 'pagamento-credito'", c.conta['id'])
        self.assertEqual([json.loads(e['dados']) for e in ev], [{'pagamento': pid, 'mp': mp_id, 'barras': 280, 'pedido': None}])
        # a preferência leva o nome do pacote de barras
        self.assertEqual(self.mp.estado()['preferencias'][-1]['items'][0]['title'], 'SOTERRA: Saco de 280 barras de ouro')

    def test_02_estorno_tira_barras_e_alerta_quando_ja_gastas(self):
        c = self.novo('Estorno Barra')
        pid, mp_id = self.pago(c, 'barras-50')
        self.mp.status(mp_id, 'refunded')
        self.assertEqual(self.mp.avisar(mp_id, self.base), (200, {'ok': True, 'estado': 'estornado'}))
        self.assertEqual(self.barras(c), 0)
        self.assertEqual(self.alertas(c), [('estorno', {'pagamento': pid, 'mp': mp_id, 'barras': 50, 'tirado': 50,
                                                        'faltou': 0, 'status': 'refunded'})])
        # a Arca paga, 500 gastas num Xamã (sem save: o item em barras não precisa), e a contestação no cartão
        pid2, mp2 = self.pago(c, 'barras-600')
        self.comprou(c, 'classe-invocador')
        self.assertEqual(self.barras(c), 100)
        self.mp.status(mp2, 'charged_back')
        self.assertEqual(self.mp.avisar(mp2, self.base)[0], 200)
        self.assertEqual(self.mp.avisar(mp2, self.base)[0], 200)                  # de novo: nada muda
        self.assertEqual(self.barras(c), 0, 'o saldo nunca fica negativo')
        self.assertEqual(self.alertas(c)[1:], [('contestacao', {'pagamento': pid2, 'mp': mp2, 'barras': 600, 'tirado': 100,
                                                                'faltou': 500, 'status': 'charged_back'})])
        self.assertEqual([(x['motivo'], x['delta']) for x in self.movimentos(c)],
                         [('pacote', 50), ('estorno-pagamento', -50), ('pacote', 600), ('loja', -500),
                          ('estorno-pagamento', -100)])
        self.assertEqual(c.pede('GET', '/api/pagamento/meus')[1]['pagamentos'][0]['estado'], 'estornado')

    # -- 2. a loja em barras ---------------------------------------------------------------
    def test_03_comprar_debita_e_cancelar_devolve(self):
        c = self.novo('Compra Barra')
        self.da_barras(c, 300)
        status, r = self.compra(c, 'classe-minotauro')                          # 1.500: não cabe
        self.assertEqual((status, r['erro'], r['barras']), (409, 'barras de ouro insuficientes', {'saldo': 300}))
        self.assertEqual(self.minha(c)['pedidos'], [])
        p = self.comprou(c, 'pedras-agua')
        self.assertEqual((p['moeda'], p['barras'], p['preco'], p['estado']), ('barras', 25, 0, 'pendente'))
        self.assertEqual(self.barras(c), 275, 'debita na hora da compra')
        status, r = c.pede('POST', '/api/loja/cancelar', {'id': p['id']})
        self.assertEqual((status, r['barras']['saldo'], r['pedido']['estado']), (200, 300, 'cancelado'))
        self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': p['id']})[1]['erro'], 'pedido já fechado')
        self.assertEqual(self.barras(c), 300, 'devolve uma vez só')
        self.assertEqual([(x['motivo'], x['delta'], x['idem']) for x in self.movimentos(c)],
                         [('ajuste', 300, None), ('loja', -25, 'pedido:%d:custo' % p['id']),
                          ('estorno-loja', 25, 'pedido:%d:estorno' % p['id'])])
        ev = self.sql("SELECT dados FROM eventos WHERE conta_id = ? AND tipo = 'loja-compra'", c.conta['id'])
        self.assertEqual(json.loads(ev[0]['dados']), {'id': p['id'], 'sku': 'pedras-agua', 'preco': 0, 'barras': 25})

    def test_04_recusa_do_juiz_devolve_as_barras(self):
        c = self.novo('Juiz Recusa')
        self.poe_estado(c)
        self.da_barras(c, 1000)
        xama, pedras = self.comprou(c, 'classe-invocador'), self.comprou(c, 'pedras-terra')
        self.assertEqual(self.barras(c), 475)
        # o Xamã foi liberado por outro caminho entre a compra e a entrega
        self.mexe_estado(c, progress=lambda p: p['unlockedClasses'].append('invocador'))
        r = self.retira(c)
        self.assertEqual((r['entregues'], r['estornados']), ([pedras['id']], [xama['id']]))
        self.assertEqual(self.barras(c), 975, 'as 500 do Xamã recusado voltaram')
        self.assertEqual(self.sql("SELECT estado, motivo FROM loja_pedidos WHERE id = ?", xama['id']),
                         [{'estado': 'estornado', 'motivo': 'classe-ja-liberada'}])
        self.assertEqual(self.save(c)['db']['carteira']['moedas'], 0, 'o pedido em barras não mexe nos vinténs')
        self.retira(c)
        self.assertEqual(len(self.movimentos(c, 'estorno-loja')), 1)

    def test_05_duas_compras_quase_juntas(self):
        c = self.novo('Pressa Dupla')
        self.da_barras(c, 500)
        res = []
        fios = [threading.Thread(target=lambda s=s: res.append(self.compra(c, s)))
                for s in ('classe-invocador', 'classe-bruxo')]
        for f in fios:
            f.start()
        for f in fios:
            f.join()
        self.assertEqual(sorted(s for s, _ in res), [201, 409], res)
        self.assertEqual(self.barras(c), 0)
        # oito cliques de 40 com 100 na conta: dois passam, e o saldo para em 20
        d = self.novo('Pressa Oito')
        self.da_barras(d, 100)
        res = []
        fios = [threading.Thread(target=lambda: res.append(self.compra(d, 'pedras-ar'))) for _ in range(8)]
        for f in fios:
            f.start()
        for f in fios:
            f.join()
        self.assertEqual(sorted(s for s, _ in res), [201, 201] + [409] * 6, res)
        self.assertEqual(self.barras(d), 20)
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM loja_pedidos WHERE conta_id = ?", d.conta['id']), [{'n': 2}])
        # e o banco segura sozinho: saldo negativo e movimento zero não entram
        with self.assertRaises(sqlite3.IntegrityError):
            self.sql("UPDATE barras_saldo SET saldo = -1 WHERE conta_id = ?", d.conta['id'])
        with self.assertRaises(sqlite3.IntegrityError):
            self.sql("INSERT INTO barras_movimentos(conta_id, delta, motivo, criado_em) VALUES (?, 0, 'ajuste', 1)",
                     d.conta['id'])
        with self.assertRaises(sqlite3.IntegrityError):
            self.sql("INSERT INTO barras_movimentos(conta_id, delta, motivo, criado_em) VALUES (?, 5, 'inventado', 1)",
                     d.conta['id'])

    # -- 3. as trocas ---------------------------------------------------------------------
    def test_06_barras_viram_vintens_no_estado_do_servidor(self):
        c = self.novo('Troca Barra')
        self.poe_estado(c, carteira=100)
        self.da_barras(c, 300)
        p = self.comprou(c, 'vintens-5000')
        self.assertEqual((p['nome'], p['barras'], p['preco']), ('5.000 vinténs', 250, 0))
        m = self.minha(c)
        self.assertEqual((m['barras']['saldo'], m['saldo']['aCaminho'], m['saldo']['disponivel']), (50, 5000, 5100))
        self.assertEqual(self.movimentos(c, 'troca-vintens'), [{'delta': -250, 'motivo': 'troca-vintens',
                                                                'ref': 'pedido:%d' % p['id'],
                                                                'idem': 'pedido:%d:custo' % p['id']}])
        r = self.retira(c)
        self.assertEqual((r['entregues'], r['pedidos'][0]['entrega']), ([p['id']], {'tipo': 'vintens', 'alvo': 'carteira',
                                                                                    'qtd': 5000}))
        self.assertEqual(self.save(c)['db']['carteira']['moedas'], 5100)
        m = self.minha(c)
        self.assertEqual((m['barras']['saldo'], m['saldo']['aCaminho']), (50, 0))
        # o pendente cancela e devolve as barras
        q = self.comprou(c, 'vintens-1000')
        self.assertEqual(self.barras(c), 0)
        self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': q['id']})[1]['barras'], {'saldo': 50})

    def test_07_vintens_viram_barras_so_depois_da_entrega(self):
        c = self.novo('Farma Muito')
        self.poe_estado(c, carteira=5000)
        p = self.comprou(c, 'barras-por-vintens-50')
        self.assertEqual((p['preco'], p['moeda'], p['ganhaBarras']), (4000, 'vintens', 50))
        m = self.minha(c)
        self.assertEqual((m['barras']['saldo'], m['saldo']['reservado'], m['saldo']['disponivel']), (0, 4000, 1000))
        self.assertEqual(self.movimentos(c), [], 'nada de barra antes de os vinténs saírem')
        status, r = self.compra(c, 'barras-por-vintens-50')                    # 4.000 de novo: só há 1.000 livres
        self.assertEqual((status, r['erro']), (409, 'vinténs insuficientes'))
        r = self.retira(c)
        self.assertEqual(r['entregues'], [p['id']])
        self.assertEqual(self.save(c)['db']['carteira']['moedas'], 1000, 'os vinténs saíram do estado do servidor')
        self.assertEqual(self.barras(c), 50)
        self.retira(c)
        self.assertEqual(self.movimentos(c), [{'delta': 50, 'motivo': 'troca-vintens', 'ref': 'pedido:%d' % p['id'],
                                               'idem': 'pedido:%d:ganho' % p['id']}], 'uma vez só')
        # comprado com 1.000 no bolso, mas o estado perdeu os vinténs antes da entrega: o juiz recusa, nada entra
        q = self.comprou(c, 'barras-por-vintens-10')
        self.mexe_estado(c, carteira=300)
        r = self.retira(c)
        self.assertEqual((r['entregues'], r['estornados']), ([], [q['id']]))
        self.assertEqual(self.sql("SELECT estado, motivo FROM loja_pedidos WHERE id = ?", q['id']),
                         [{'estado': 'estornado', 'motivo': 'sem-saldo'}])
        self.assertEqual((self.barras(c), self.save(c)['db']['carteira']['moedas']), (50, 300))

    def test_08_vintens_viram_barras_no_caminho_antigo(self):
        """Sem juiz: o jogo aplica (desconta os vinténs) e o PUT que confirma credita as barras."""
        c = self.novo('Save Antigo', self.base_leg)
        progress = {'version': 22, 'unlockedClasses': ['sumo', 'curandeiro'], 'heroes': {}, 'inventory': []}
        db = {'versao': 1, 'jogador': {'nome': None}, 'carteira': {'moedas': 1000}}
        self.assertEqual(c.salva(0, progress, db)[0], 200)
        p, q = self.comprou(c, 'barras-por-vintens-10'), None
        c.pede('POST', '/api/loja/retirar', {})
        self.assertEqual(self.barras(c), 0)
        db = dict(db, carteira={'moedas': 200}, loja={'aplicadas': [p['id']], 'recusadas': []})
        versao = c.pede('GET', '/api/save')[1]['versao']
        status, r = c.salva(versao, progress, db)
        self.assertEqual((status, r['loja']['entregues']), (200, [p['id']]))
        self.assertEqual(self.barras(c), 10)
        status, r = c.salva(r['versao'], progress, db)                         # a mesma anotação de novo
        self.assertEqual((status, self.barras(c)), (200, 10))
        # recusado pelo jogo (sem saldo): estornado, e nenhuma barra. O save de outra máquina mostrou 1.000 no
        # bolso (o site deixa comprar), mas o jogo que retira não tem os vinténs
        status, r = c.salva(r['versao'], progress, dict(db, carteira={'moedas': 1000}))
        self.assertEqual(status, 200, r)
        q = self.comprou(c, 'barras-por-vintens-10')
        c.pede('POST', '/api/loja/retirar', {})
        db = dict(db, loja={'aplicadas': [p['id']], 'recusadas': [{'id': q['id'], 'motivo': 'sem-saldo'}]})
        status, r = c.salva(r['versao'], progress, db)
        self.assertEqual((status, r['loja']['estornados'], self.barras(c)), (200, [q['id']], 10))
        self.assertEqual(len(self.movimentos(c, banco=self.banco_leg)), 1)

    # -- 4. o pagamento antigo --------------------------------------------------------------
    def test_09_pagamento_de_pacote_antigo_ainda_credita_vintens(self):
        c = self.novo('Pagou Antes')
        self.assertEqual(c.pede('POST', '/api/pagamento/pacote', {'pacote': 'pacote-1000', 'idem': idem()}),
                         (400, {'ok': False, 'erro': 'pacote desconhecido'}))
        t = int(time.time())
        ref = 'sot-%d-%s' % (900000 + ProvaDasBarras._n, secrets.token_hex(8))
        pid = self.sql("INSERT INTO pagamentos(conta_id, pacote, vintens, centavos, referencia, estado, criado_em, "
                       "atualizado_em) VALUES (?, 'pacote-1000', 1000, 490, ?, 'aberto', ?, ?) RETURNING id",
                       c.conta['id'], ref, t - 600, t - 600)[0]['id']
        mp_id = self.mp.pagar(ref, centavos=490)
        self.assertEqual(self.mp.avisar(mp_id, self.base), (200, {'ok': True, 'estado': 'aprovado'}))
        m = self.minha(c)
        self.assertEqual((m['saldo']['aCaminho'], m['barras']['saldo']), (1000, 0))
        self.assertEqual([(x['nome'], x['vintens'], x['origem']) for x in m['pedidos']],
                         [('Bolsa de 1.000 vinténs', 1000, 'pagamento')])
        pag = [x for x in c.pede('GET', '/api/pagamento/meus')[1]['pagamentos'] if x['id'] == pid][0]
        self.assertEqual((pag['moeda'], pag['vintens'], pag['barras'], pag['nome']), ('vintens', 1000, 0,
                                                                                     'Bolsa de 1.000 vinténs'))

    # -- 5. o Mestre ---------------------------------------------------------------------------
    def test_10_presente_de_barras_do_mestre(self):
        m = self.mestre('Guia Barras')
        c = self.novo('Ganha Barras')
        chave = idem()
        status, r = m.pede('POST', '/api/mestre/barras', {'conta': c.conta['id'], 'barras': 1234, 'idem': chave})
        self.assertEqual(status, 201, r)
        self.assertEqual((r['presente']['barras'], r['presente']['conta']['id'], r['barras']), (1234, c.conta['id'],
                                                                                              {'saldo': 1234}))
        mov = self.minha(c)['barras']['movimentos'][0]
        self.assertEqual((mov['motivo'], mov['delta'], mov['por']['id']), ('presente', 1234, m.conta['id']))
        # o mesmo clique de novo: o mesmo presente; outra quantia com a mesma chave: 409
        status, r = m.pede('POST', '/api/mestre/barras', {'conta': c.conta['id'], 'barras': 1234, 'idem': chave})
        self.assertEqual((status, r['repetido'], r['barras']), (200, True, {'saldo': 1234}))
        status, r = m.pede('POST', '/api/mestre/barras', {'conta': c.conta['id'], 'barras': 99, 'idem': chave})
        self.assertEqual((status, r['erro']), (409, 'idem já usado em outro presente'))
        for corpo, erro in (({'barras': 0}, 'barras precisa ser um inteiro de 1 a 5.000'),
                            ({'barras': 5001}, 'barras precisa ser um inteiro de 1 a 5.000'),
                            ({'barras': '10'}, 'barras precisa ser um inteiro de 1 a 5.000'),
                            ({'barras': True}, 'barras precisa ser um inteiro de 1 a 5.000'),
                            ({'barras': 10, 'conta': 'x'}, 'conta precisa ser o número da conta'),
                            ({'barras': 10, 'idem': 'curto'}, 'idem inválido (8 a 64 letras, dígitos, _ ou -)')):
            status, r = m.pede('POST', '/api/mestre/barras', dict({'conta': c.conta['id'], 'idem': idem()}, **corpo))
            self.assertEqual((status, r.get('erro')), (400, erro), corpo)
        self.assertEqual(m.pede('POST', '/api/mestre/barras', {'conta': 99999999, 'barras': 1, 'idem': idem()})[0], 404)
        self.assertEqual(self.barras(c), 1234)
        # a trilha e a ficha
        ev = self.sql("SELECT dados FROM eventos WHERE conta_id = ? AND tipo = 'presente-admin'", c.conta['id'])
        self.assertEqual([json.loads(e['dados']) for e in ev],
                         [{'movimento': mov['id'], 'para': c.conta['id'], 'por': m.conta['id'], 'barras': 1234}])
        status, ficha = m.pede('GET', '/api/mestre/conta?id=%d' % c.conta['id'])
        self.assertEqual(status, 200, ficha)
        self.assertEqual((ficha['barras']['saldo'], [x['motivo'] for x in ficha['barras']['movimentos']]),
                         (1234, ['presente']))
        self.assertFalse([i for i in ficha['catalogo'] if i['tipo'] in ('vintens', 'barras')],
                         'a troca de moedas não é presente')
        self.assertEqual(m.pede('POST', '/api/mestre/presentear', {'conta': c.conta['id'], 'sku': 'vintens-1000',
                                                                   'idem': idem()})[1]['erro'], 'produto desconhecido')
        # conta banida não recebe
        b = self.novo('Banida Barra')
        self.sql("UPDATE contas SET banido = 1 WHERE id = ?", b.conta['id'])
        status, r = m.pede('POST', '/api/mestre/barras', {'conta': b.conta['id'], 'barras': 5, 'idem': idem()})
        self.assertEqual((status, r['erro']), (409, 'essa conta está banida: o presente não entra'))
        # o teto de 24 h por Mestre (25.000): já deu 1.234; semeia o resto até 24.999
        t = int(time.time())
        self.sql("INSERT INTO barras_movimentos(conta_id, delta, motivo, ref, saldo_depois, por, criado_em) "
                 "VALUES (?, ?, 'presente', 'prova', 0, ?, ?)", c.conta['id'], 25000 - 1 - 1234, m.conta['id'], t - 100)
        self.assertEqual(m.pede('POST', '/api/mestre/barras', {'conta': c.conta['id'], 'barras': 1, 'idem': idem()})[0], 201)
        status, r = m.pede('POST', '/api/mestre/barras', {'conta': c.conta['id'], 'barras': 1, 'idem': idem()})
        self.assertEqual((status, r['erro']), (429, 'barras de presente demais nas últimas 24 h (25.000)'))
        # o log
        with open(os.path.join(self.pasta, 'api.log'), encoding='utf-8', errors='replace') as f:
            self.assertIn('mestre: #%d deu 1234 barras de ouro a #%d' % (m.conta['id'], c.conta['id']), f.read())

    def test_11_conta_que_nao_e_mestre_nao_presenteia(self):
        c = self.novo('Quer Dar')
        d = self.novo('Quer Ganhar')
        status, r = c.pede('POST', '/api/mestre/barras', {'conta': d.conta['id'], 'barras': 100, 'idem': idem()})
        self.assertEqual(status, 403, r)
        status, _ = Cliente(self.base).pede('POST', '/api/mestre/barras', {'conta': d.conta['id'], 'barras': 100,
                                                                           'idem': idem()})
        self.assertEqual(status, 401)
        self.assertEqual((self.barras(d), self.barras(c)), (0, 0))
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM barras_movimentos WHERE conta_id IN (?, ?)",
                                  c.conta['id'], d.conta['id']), [{'n': 0}])


if __name__ == '__main__':
    unittest.main(verbosity=2)
