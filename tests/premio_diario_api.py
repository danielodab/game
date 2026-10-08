#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova do PRÊMIO DIÁRIO DE RESGATE (08/10, servidor/premio_diario.py), com o juiz de verdade.

    python tests/premio_diario_api.py

Sobe o juiz e a API como tests/autoridade_api.py e prova:
  - o calendário é o MÊS de Brasília (28 a 31 posições): vinténs em todos (100, +20 por dia), fragmentos no 3
    e no 7 de cada dezena, 5 Lascas no 5, UMA barra no 10 e no 20, DUAS barras + 10 fragmentos no 30; na
    virada do mês a contagem recomeça do 1º;
  - GET /api/diario nasce no dia 1, sem resgate, com `zeraEm` no futuro;
  - o resgate entrega NA HORA (os vinténs entram na carteira do estado do servidor), a linha da conta
    grava o dia e a sequência 1, o segundo toque no mesmo dia é 409 'ja-resgatado' e nada entra duas vezes;
  - a ordem anda só pelos resgates: "ontem" (ultimo_dia - 1 no banco) → hoje é o dia 2; "anteontem"
    (- 2, um dia pulado) → hoje é o dia 3, nada volta ao 1 (o dono: quem some 9 dias colhe o 2, não a barra);
  - o 10º dia seguido paga a barra de ouro (o saldo de barras sobe 1, com a ref 'diario:<dia>' no extrato);
  - o nome do pedido no extrato da loja.
"""
import json
import os
import sys
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), 'servidor'))
import autoridade_api as A   # noqa: E402
import premio_diario as PD   # noqa: E402  (as funções puras)


class ProvaDoDiario(A.ProvaDaAutoridade):

    def diario(self, c):
        status, r = c.pede('GET', '/api/diario')
        self.assertEqual(status, 200, r)
        return r

    def test_01_o_calendario(self):
        self.assertEqual(PD.dias_no_mes(202610), 31)
        self.assertEqual(PD.dias_no_mes(202602), 28)
        self.assertEqual(PD.mes_de(1791500000), 202610)      # 08/10/2026 em Brasília
        for k in range(1, 32):
            ps = PD.premios_do_dia(k)
            self.assertEqual(ps[0], {'tipo': 'vintens', 'alvo': 'carteira', 'qtd': 100 + 20 * (k - 1)}, k)
            tipos = [p['tipo'] for p in ps]
            if k % 10 == 0:
                self.assertIn('barras', tipos, k)
            if k % 10 in (3, 7):
                self.assertTrue(any(p['alvo'] == PD.FRAGMENTO for p in ps), k)
            if k % 10 == 5:
                self.assertTrue(any(p['alvo'] == PD.PEDRA_NEUTRA and p['qtd'] == 5 for p in ps), k)
        self.assertEqual([p for p in PD.premios_do_dia(10) if p['tipo'] == 'barras'][0]['qtd'], 1)
        self.assertEqual([p for p in PD.premios_do_dia(30) if p['tipo'] == 'barras'][0]['qtd'], 2)
        self.assertEqual(sum(p['qtd'] for p in PD.premios_do_dia(30) if p['alvo'] == PD.FRAGMENTO), 10)
        self.assertEqual(PD.posicao(31), 31)
        self.assertEqual(PD.posicao(32), 1)

    def test_02_nasce_no_dia_1_e_o_resgate_entrega_na_hora_uma_vez_so(self):
        c = self.novo('Diario Um')
        self.poe_estado(c)
        d = self.diario(c)
        self.assertEqual((d['hoje']['dia'], d['hoje']['resgatado'], d['sequencia'], d['total']), (1, False, 0, 0), d)
        self.assertEqual(len(d['calendario']), PD.dias_no_mes(d['mes']))
        self.assertEqual(d['ciclo'], len(d['calendario']))
        self.assertGreater(d['zeraEm'], d['agora'])
        self.assertTrue(d['calendario'][0]['hoje'] and not d['calendario'][0]['feito'])
        moedas_antes = self.save(c)['db']['carteira']['moedas']
        status, r = c.pede('POST', '/api/diario/resgatar', {})
        self.assertEqual(status, 200, r)
        self.assertEqual((r['resgatou'], r['hoje']['resgatado'], r['sequencia'], r['total']), (1, True, 1, 1), r)
        self.assertEqual(r['premios'], PD.premios_do_dia(1))
        self.assertTrue(r['calendario'][0]['feito'])
        depois = self.save(c)
        self.assertEqual(depois['db']['carteira']['moedas'], moedas_antes + 100, 'os vinténs do dia 1 entram na hora')
        linhas = self.sql("SELECT sku, estado, preco FROM loja_pedidos WHERE conta_id = ? ORDER BY id", c.conta['id'])
        self.assertEqual([(ln['sku'], ln['estado'], ln['preco']) for ln in linhas], [('diario-vintens', 'entregue', 0)])
        linha = self.sql("SELECT ultimo_dia, sequencia, total FROM premio_diario WHERE conta_id = ?", c.conta['id'])[0]
        self.assertEqual((linha['sequencia'], linha['total']), (1, 1))
        self.assertEqual(linha['ultimo_dia'], PD.dia_de(r['agora']))
        # de novo no mesmo dia: 409 e nada entra
        status, r2 = c.pede('POST', '/api/diario/resgatar', {})
        self.assertEqual((status, r2.get('motivo')), (409, 'ja-resgatado'), r2)
        self.assertEqual(self.save(c)['db']['carteira']['moedas'], moedas_antes + 100)
        self.assertEqual(len(self.sql("SELECT id FROM loja_pedidos WHERE conta_id = ?", c.conta['id'])), 1)
        self.assertEqual(len(self.eventos(c, 'diario-resgate')), 1)

    def test_03_a_ordem_anda_so_pelos_resgates(self):
        c = self.novo('Diario Seq')
        self.poe_estado(c)
        self.assertEqual(c.pede('POST', '/api/diario/resgatar', {})[0], 200)
        # "ontem": o último dia volta um; hoje é o 2º seguido
        self.sql("UPDATE premio_diario SET ultimo_dia = ultimo_dia - 1 WHERE conta_id = ?", c.conta['id'])
        self.sql("UPDATE premio_diario_resgates SET dia = dia - 1 WHERE conta_id = ?", c.conta['id'])
        d = self.diario(c)
        self.assertEqual((d['hoje']['dia'], d['hoje']['resgatado'], d['sequencia']), (2, False, 1), d)
        status, r = c.pede('POST', '/api/diario/resgatar', {})
        self.assertEqual((status, r['resgatou'], r['sequencia']), (200, 2, 2), r)
        self.assertEqual(r['premios'][0]['qtd'], 120)
        # "anteontem": pulou um dia — a ordem NÃO volta: hoje é o 3º resgate
        self.sql("UPDATE premio_diario SET ultimo_dia = ultimo_dia - 2 WHERE conta_id = ?", c.conta['id'])
        self.sql("UPDATE premio_diario_resgates SET dia = dia - 2 WHERE conta_id = ?", c.conta['id'])
        d2 = self.diario(c)
        self.assertEqual((d2['hoje']['dia'], d2['sequencia'], d2['total']), (3, 2, 2), d2)
        status, r3 = c.pede('POST', '/api/diario/resgatar', {})
        self.assertEqual((status, r3['resgatou'], r3['sequencia'], r3['total']), (200, 3, 3, 3), r3)
        self.assertTrue(any(p['alvo'] == PD.FRAGMENTO and p['qtd'] == 3 for p in r3['premios']), r3['premios'])
        # quem some 9 dias depois do 1º resgate colhe o 2º, não a barra do 10º
        self.sql("UPDATE premio_diario SET ultimo_dia = ultimo_dia - 9, sequencia = 1, total = 1 WHERE conta_id = ?", c.conta['id'])
        self.sql("UPDATE premio_diario_resgates SET dia = dia - 9 WHERE conta_id = ?", c.conta['id'])
        self.assertEqual(self.diario(c)['hoje']['dia'], 2)
        # virou o mês: a contagem recomeça do 1º (o total da vida fica)
        self.sql("UPDATE premio_diario SET mes = mes - 1, sequencia = 17 WHERE conta_id = ?", c.conta['id'])
        d3 = self.diario(c)
        self.assertEqual((d3['hoje']['dia'], d3['sequencia'], d3['total']), (1, 0, 1), d3)
        status, r4 = c.pede('POST', '/api/diario/resgatar', {})
        self.assertEqual((status, r4['resgatou'], r4['sequencia'], r4['total']), (200, 1, 1, 2), r4)

    def test_04_o_decimo_dia_seguido_paga_a_barra(self):
        c = self.novo('Diario Barra')
        self.poe_estado(c)
        hoje = PD.dia_de(self.diario(c)['agora'])
        # nove resgates já feitos, o último ontem
        self.sql("INSERT INTO premio_diario(conta_id, ultimo_dia, mes, sequencia, total) VALUES (?, ?, ?, 9, 9)", c.conta['id'], hoje - 1,
                 PD.mes_de(self.diario(c)['agora']))
        d = self.diario(c)
        self.assertEqual((d['hoje']['dia'], d['sequencia']), (10, 9), d)
        self.assertTrue(any(p['tipo'] == 'barras' and p['qtd'] == 1 for p in d['hoje']['premios']))
        status, r = c.pede('POST', '/api/diario/resgatar', {})
        self.assertEqual((status, r['resgatou'], r['sequencia']), (200, 10, 10), r)
        status, m = c.pede('GET', '/api/loja/minha')
        self.assertEqual(status, 200, m)
        self.assertEqual(m['barras']['saldo'], 1, m['barras'])
        mov = [x for x in m['barras']['movimentos'] if x.get('motivo') == 'diario']
        self.assertEqual(len(mov), 1, m['barras']['movimentos'])
        self.assertEqual(mov[0]['nome'], 'Prêmio diário')
        # e o pedido dos vinténs leva o nome do prêmio diário
        nomes = [p['nome'] for p in m['pedidos']]
        self.assertTrue(any('prêmio diário' in n for n in nomes), nomes)


if __name__ == '__main__':
    unittest.main(verbosity=2)
