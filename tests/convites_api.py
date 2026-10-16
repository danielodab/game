#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova do convite (servidor/convites.py) — 15/10, pela API de verdade com o juiz (tests/autoridade_api.py).

    python tests/convites_api.py

O código nasce na primeira leitura e não muda; o cadastro com o código anota quem convidou (código
inválido ou próprio: ignorado, o cadastro não falha); a vitória confirmada paga os DOIS pela fila da
loja, uma vez só (a segunda vitória não paga de novo); as duas contas no mesmo endereço não pagam; a
tabela não guarda endereço; e o convidante vê a contagem.
"""
import json
import os
import sys
import unittest
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
import autoridade_api as A  # noqa: E402
import convites as CV       # noqa: E402
import privacidade          # noqa: E402
from servidor_api import Cliente  # noqa: E402


class Navegador(Cliente):
    """O Cliente com um endereço público próprio (X-Forwarded-For): o convite compara endereços."""

    def __init__(self, base, ip):
        super().__init__(base)
        self.ip = ip

    def pede(self, metodo, rota, corpo=None, token='sessao'):
        # a página NOVA manda a versão das regras em toda abertura (servidor_api.Cliente): o mesmo aqui
        if (Cliente.REGRAS is not None and metodo == 'POST' and rota in Cliente.ABERTURAS
                and isinstance(corpo, dict) and 'versaoRegras' not in corpo):
            corpo = dict(corpo, versaoRegras=Cliente.REGRAS)
        dados = None if corpo is None else json.dumps(corpo).encode('utf-8')
        req = urllib.request.Request(self.base + rota, data=dados, method=metodo)
        req.add_header('Content-Type', 'application/json')
        req.add_header('X-Forwarded-For', self.ip)
        tk = self.token if token == 'sessao' else token
        if tk:
            req.add_header('Authorization', 'Bearer ' + tk)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode('utf-8'))


class ProvaDoConvite(A.ProvaDaAutoridade):
    _n = 0

    def conta_em(self, apelido, ip, convite=None):
        ProvaDoConvite._n += 1
        c = Navegador(self.base, ip)
        corpo = {'nome': '%s %d' % (apelido, ProvaDoConvite._n), 'email': 'c%d-%d@prova.local' % (ProvaDoConvite._n, os.getpid()),
                 'senha': 'senha-de-prova-123', 'aceiteTermos': privacidade.VERSAO_TERMOS}
        if convite is not None:
            corpo['convite'] = convite
        st, r = c.pede('POST', '/api/cadastro', corpo, token=None)
        self.assertEqual(st, 201, r)
        c.token, c.conta = r['token'], r['conta']
        return c

    def convite(self, c):
        st, r = c.pede('GET', '/api/convite')
        self.assertEqual(st, 200, r)
        return r

    def vence(self, c, primeira=True):
        if primeira:
            self.poe_estado(c)          # o primeiro save da conta (versão 1); a segunda vitória já tem save
        b = self.abre(c)
        jogo = self.joga(c, b['bilhete'])
        st, r = self.fecha(c, b['bilhete'], jogo)
        self.assertEqual(st, 200, r)
        self.assertEqual(r.get('fase'), 'won', r)
        return r

    def creditos(self, c, sku=CV.SKU):
        return self.sql("SELECT entrega, estado FROM loja_pedidos WHERE conta_id = ? AND sku = ?", c.conta['id'], sku)

    # ------------------------------------------------------------------------------------------
    def test_01_o_codigo_nasce_e_nao_muda(self):
        a = self.conta_em('Anfitriao', '200.10.1.1')
        r1 = self.convite(a)
        r2 = self.convite(a)
        self.assertEqual(r1['codigo'], r2['codigo'])
        self.assertRegex(r1['codigo'], r'^[A-Z2-9]{8}$')
        self.assertIn('?convite=' + r1['codigo'], r1['link'])
        self.assertEqual((r1['convidados'], r1['pagos'], r1['premio']), (0, 0, CV.VINTENS_CONVIDANTE))

    def test_02_o_cadastro_pelo_link_e_a_vitoria_pagam_os_dois_uma_vez(self):
        a = self.conta_em('Quem Chama', '200.10.2.1')
        cod = self.convite(a)['codigo']
        b = self.conta_em('Quem Veio', '200.10.2.2', convite=cod.lower())     # minúsculas: o servidor limpa
        linha = self.sql("SELECT * FROM convidados WHERE conta_id = ?", b.conta['id'])
        self.assertEqual(len(linha), 1)
        self.assertEqual(linha[0]['convidou_id'], a.conta['id'])
        self.assertNotIn('ip', set(linha[0].keys()), 'a tabela não guarda endereço')
        self.assertEqual(self.convite(a)['convidados'], 1)
        self.assertEqual(self.creditos(b), [], 'antes da vitória, nada')
        self.vence(b)
        cb, ca = self.creditos(b), self.creditos(a)
        self.assertEqual(len(cb), 1, cb)
        self.assertEqual(len(ca), 1, ca)
        self.assertEqual(json.loads(cb[0]['entrega'])['qtd'], CV.VINTENS_CONVIDADO)
        self.assertEqual(json.loads(ca[0]['entrega'])['qtd'], CV.VINTENS_CONVIDANTE)
        r = self.convite(a)
        self.assertEqual((r['convidados'], r['pagos']), (1, 1))
        self.assertTrue(self.convite(b)['convidadoPago'])
        # e não paga de novo: o registro ficou com pago_em (o pagamento só olha pago_em IS NULL) e o
        # crédito tem idem único por convidado (loja_pedidos(conta_id, idem) é índice único)
        linha = self.sql("SELECT pago_em, motivo FROM convidados WHERE conta_id = ?", b.conta['id'])[0]
        self.assertTrue(linha['pago_em'] and not linha['motivo'], dict(linha))
        self.assertEqual(len(self.eventos(b, 'convite-pago')), 1)
        self.assertEqual(self.save(b)['db']['carteira']['moedas'] >= CV.VINTENS_CONVIDADO, True, 'o convidado recebeu na hora')

    def test_03_codigo_invalido_ou_proprio_nao_falha_nem_anota(self):
        a = self.conta_em('Sozinho', '200.10.3.1')
        cod = self.convite(a)['codigo']
        b = self.conta_em('Codigo Torto', '200.10.3.2', convite='NAOEXISTE')
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM convidados WHERE conta_id = ?", b.conta['id'])[0]['n'], 0)
        c = self.conta_em('Lixo', '200.10.3.3', convite={'x': 1})
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM convidados WHERE conta_id = ?", c.conta['id'])[0]['n'], 0)
        self.assertEqual(self.convite(a)['convidados'], 0)
        self.assertTrue(cod)

    def test_04_mesmo_endereco_nao_paga(self):
        a = self.conta_em('Mesmo Celular', '200.10.4.1')
        cod = self.convite(a)['codigo']
        b = self.conta_em('Segunda Conta', '200.10.4.1', convite=cod)
        self.vence(b)
        self.assertEqual(self.creditos(b), [])
        self.assertEqual(self.creditos(a), [])
        linha = self.sql("SELECT motivo FROM convidados WHERE conta_id = ?", b.conta['id'])
        self.assertEqual(linha[0]['motivo'], 'mesmo-endereco')
        self.assertEqual(self.convite(a)['pagos'], 0)

    def test_05_a_vitoria_sem_convite_nao_cria_nada(self):
        a = self.conta_em('Ninguem Chamou', '200.10.5.1')
        self.vence(a)
        self.assertEqual(self.creditos(a), [])
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM convidados WHERE conta_id = ?", a.conta['id'])[0]['n'], 0)


# só as provas DESTE arquivo: as da bancada-mãe (autoridade_api) já rodam lá
for _n in [n for n in dir(A.ProvaDaAutoridade) if n.startswith('test_')]:
    setattr(ProvaDoConvite, _n, None)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    unittest.main(verbosity=2)
