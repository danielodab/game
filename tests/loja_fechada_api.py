#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova da LOJA FECHADA (servidor/loja.py, SOTERRA_LOJA=0) — 25/10, pela API de verdade.

    python tests/loja_fechada_api.py

O dono: "quero colocar meu jogo em produção, mas a loja por enquanto não pode estar disponível". Sobem DUAS APIs,
cada uma com o seu banco descartável: uma com SOTERRA_LOJA=0 e outra sem a variável. Na fechada:
  - o catálogo (público) e a vitrine (do jogo) respondem VAZIOS, com `fechada: true`, sem ofertas nem Pacote de
    Boas-Vindas, e com os pagamentos desligados;
  - comprar, presentear, começar o pacote do Mercado Pago e pedir os pacotes da Google Play respondem 503 com
    `fechada` e a frase "a loja abre em breve";
  - o que já está em andamento SEGUE: a fila de entregas (retirar) e o saldo (minha) respondem;
  - o log de abertura diz que a loja está FECHADA.
Na aberta (sem a variável), tudo como sempre: o catálogo cheio e sem `fechada`.
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
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402
import loja  # noqa: E402  (servidor/loja.py: o servidor_api já pôs a pasta no caminho)


def sobe(pasta, fechada):
    porta = porta_livre()
    env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
    if fechada:
        env['SOTERRA_LOJA'] = '0'
    env['PYTHONIOENCODING'] = 'utf-8'
    log = open(os.path.join(pasta, 'api.log'), 'w', encoding='utf-8')
    proc = subprocess.Popen([sys.executable, API, '--porta', str(porta), '--banco', os.path.join(pasta, 'dados', 'soterra.db')],
                            stdout=log, stderr=subprocess.STDOUT, env=env)
    base = 'http://127.0.0.1:%d' % porta
    if not espera_api(base, proc):
        proc.kill()
        log.close()
        raise RuntimeError('a API não subiu; veja o log em ' + pasta)
    return proc, log, base


class ProvaDaRegra(unittest.TestCase):
    def test_o_ambiente(self):
        self.assertTrue(loja.loja_aberta_do_ambiente({}))
        self.assertTrue(loja.loja_aberta_do_ambiente({'SOTERRA_LOJA': ''}))
        self.assertTrue(loja.loja_aberta_do_ambiente({'SOTERRA_LOJA': '1'}))
        self.assertFalse(loja.loja_aberta_do_ambiente({'SOTERRA_LOJA': '0'}))
        self.assertFalse(loja.loja_aberta_do_ambiente({'SOTERRA_LOJA': ' 0 '}))
        self.assertEqual(loja.ROTAS_DA_LOJA_FECHADA,
                         frozenset(('loja_comprar', 'loja_presentear', 'pagamento_pacote', 'play_ver')))


class ProvaDaLojaFechada(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.mkdtemp(prefix='soterra-loja-fechada-')
        cls.pasta_aberta = tempfile.mkdtemp(prefix='soterra-loja-aberta-')
        cls.proc, cls.log, cls.base = sobe(cls.pasta, True)
        cls.proc2, cls.log2, cls.base2 = sobe(cls.pasta_aberta, False)
        cls.jog = Cliente(cls.base)
        st, r = cls.jog.cadastra('Fechada Um')
        assert st in (200, 201) and r.get('ok'), r
        cls.amigo = Cliente(cls.base)
        cls.amigo.cadastra('Fechada Dois')

    @classmethod
    def tearDownClass(cls):
        for p, lg in ((cls.proc, cls.log), (cls.proc2, cls.log2)):
            p.terminate()
            try:
                p.wait(timeout=5)
            except Exception:
                p.kill()
            lg.close()
        shutil.rmtree(cls.pasta, ignore_errors=True)
        shutil.rmtree(cls.pasta_aberta, ignore_errors=True)

    def test_catalogo_vazio_e_fechado(self):
        st, r = Cliente(self.base).pede('GET', '/api/loja/catalogo', token=None)
        self.assertEqual(st, 200)
        self.assertIs(r.get('fechada'), True)
        self.assertEqual(r['itens'], [])
        self.assertEqual(r['pacotes'], [])
        self.assertEqual(r['ofertas']['itens'], [])
        self.assertIs(r['pagamento']['ligado'], False)

    def test_vitrine_sem_oferta_nem_boas_vindas(self):
        st, r = self.jog.pede('GET', '/api/loja/vitrine')
        self.assertEqual(st, 200, r)
        self.assertIs(r.get('fechada'), True)
        self.assertEqual(r['ofertas']['itens'], [])
        self.assertIs(r['boasVindas']['disponivel'], False)
        self.assertIn('auras', r)                         # a aura que a conta já tem segue vestível
        self.assertIn('molduras', r)

    def _fechada(self, st, r):
        self.assertEqual(st, 503, r)
        self.assertIs(r.get('fechada'), True, r)
        self.assertEqual(r.get('erro'), loja.FRASE_LOJA_FECHADA)

    def test_comprar_recusa(self):
        self._fechada(*self.jog.pede('POST', '/api/loja/comprar', {'sku': 'bonus-xp-1', 'idem': 'a' * 16}))

    def test_presentear_recusa(self):
        self._fechada(*self.jog.pede('POST', '/api/loja/presentear', {'sku': 'bonus-xp-1', 'nome': 'Fechada Dois', 'idem': 'b' * 16}))

    def test_pacote_do_mercado_pago_recusa(self):
        self._fechada(*self.jog.pede('POST', '/api/pagamento/pacote', {'pacote': 'barras-50', 'idem': 'c' * 16}))

    def test_pacotes_da_google_play_recusam(self):
        self._fechada(*self.jog.pede('GET', '/api/pagamento/play'))

    def test_o_que_esta_em_andamento_segue(self):
        st, r = self.jog.pede('POST', '/api/loja/retirar', {})
        self.assertEqual(st, 200, r)
        self.assertTrue(r.get('ok'), r)
        st, r = self.jog.pede('GET', '/api/loja/minha')
        self.assertEqual(st, 200, r)
        self.assertTrue(r.get('ok'), r)
        st, r = self.jog.pede('GET', '/api/pagamento/meus')
        self.assertNotEqual(r.get('fechada'), True, r)

    def test_o_log_diz_fechada(self):
        self.log.flush()
        with open(os.path.join(self.pasta, 'api.log'), encoding='utf-8') as f:
            texto = f.read()
        self.assertIn('loja: FECHADA (SOTERRA_LOJA=0)', texto)

    def test_sem_a_variavel_a_loja_segue_aberta(self):
        st, r = Cliente(self.base2).pede('GET', '/api/loja/catalogo', token=None)
        self.assertEqual(st, 200)
        self.assertNotIn('fechada', r)
        self.assertTrue(len(r['itens']) > 0)
        self.assertTrue(len(r['pacotes']) > 0)
        with open(os.path.join(self.pasta_aberta, 'api.log'), encoding='utf-8') as f:
            self.assertIn('loja: aberta', f.read())


if __name__ == '__main__':
    unittest.main(verbosity=2)
