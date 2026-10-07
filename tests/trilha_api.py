#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova da TRILHA DA TEMPORADA (07/10, servidor/trilha.py), com o juiz de verdade.

    python tests/trilha_api.py

Sobe o juiz e a API como tests/autoridade_api.py e prova:
  - a temporada é a da Brasa (época 24/08/2026 UTC, 42 dias): temporada_de na época = 1, 42 dias depois = 2;
  - GET /api/trilha nasce zerada, com 20 degraus de 150 e os prêmios de cada um (vinténs em todos, pedras do
    elemento da temporada nos pares, Sabedoria no 5 e no 15, Insígnia no 10, Reescrita no 20) — nunca selo,
    título, estrela ou peça;
  - a sala VENCIDA dá 10 pontos (a resposta do fechar traz `trilha`), a perdida nada;
  - o resgate: sem pontos 409 'faltam-pontos'; com pontos, enfileira os prêmios (origem 'trilha', preço 0) e
    os ENTREGA na hora (os vinténs entram na carteira do estado do servidor); resgatar de novo 409
    'ja-resgatado'; degrau torto 400; e o pedido é idempotente (um `idem` por prêmio);
  - a missão reivindicada pela op dá 5 pontos.
"""
import json
import os
import sys
import time
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), 'servidor'))
import autoridade_api as A  # noqa: E402
import trilha as TR         # noqa: E402  (as funções puras: a temporada e os prêmios)


class ProvaDaTrilha(A.ProvaDaAutoridade):

    def trilha(self, c):
        status, r = c.pede('GET', '/api/trilha')
        self.assertEqual(status, 200, r)
        return r

    def test_01_a_temporada_e_os_degraus(self):
        self.assertEqual(TR.temporada_de(TR.EPOCA), 1)
        self.assertEqual(TR.temporada_de(TR.EPOCA + 42 * 86400 - 1), 1)
        self.assertEqual(TR.temporada_de(TR.EPOCA + 42 * 86400), 2)
        self.assertEqual(TR.elemento_da_temporada(1), 'fogo')
        self.assertEqual(TR.elemento_da_temporada(5), 'fogo')
        c = self.novo('Trilha Zero')
        self.poe_estado(c)
        t = self.trilha(c)
        self.assertEqual((t['pontos'], t['passo'], len(t['degraus'])), (0, 150, 20), t)
        self.assertEqual(t['temporada'], TR.temporada_de(time.time()))
        tipos = set()
        for d in t['degraus']:
            self.assertEqual(d['pontos'], d['n'] * 150)
            self.assertFalse(d['resgatado'] or d['alcancado'])
            self.assertTrue(any(p['tipo'] == 'vintens' for p in d['premios']), d)
            for p in d['premios']:
                tipos.add(p['tipo'])
                self.assertIn(p['tipo'], ('vintens', 'pedras', 'pergaminho', 'insignias'), 'nada de selo, título, estrela ou peça: %r' % p)
        self.assertEqual(tipos, {'vintens', 'pedras', 'pergaminho', 'insignias'})
        por_n = {d['n']: d['premios'] for d in t['degraus']}
        self.assertTrue(any(p['tipo'] == 'pergaminho' and p['alvo'] == 'xp' for p in por_n[5]))
        self.assertTrue(any(p['tipo'] == 'insignias' for p in por_n[10]))
        self.assertTrue(any(p['tipo'] == 'pergaminho' and p['alvo'] == 'elemento' for p in por_n[20]))
        self.assertTrue(any(p['tipo'] == 'pedras' and p['alvo'] == TR.PEDRA[t['elemento']] for p in por_n[2]))

    def test_02_a_sala_vencida_da_pontos_e_a_perdida_nao(self):
        c = self.novo('Trilha Sala')
        self.poe_estado(c)
        b = self.abre(c)
        jogo = self.joga(c, b['bilhete'])
        status, r = self.fecha(c, b['bilhete'], jogo)
        self.assertEqual(status, 200, r)
        self.assertEqual(r.get('fase'), 'won')
        self.assertEqual((r['trilha']['ganhou'], r['trilha']['pontos'], r['trilha']['motivo']), (10, 10, 'sala'), r['trilha'])
        self.assertEqual(self.trilha(c)['pontos'], 10)
        self.fecha_lutas(c)
        b2 = self.abre(c)
        status, r2 = c.pede('POST', '/api/sala/fechar', {'bilhete': b2['bilhete'], 'lances': [], 'hashFinal': None})
        self.assertEqual(status, 200, r2)
        self.assertNotEqual(r2.get('fase'), 'won')
        self.assertEqual(self.trilha(c)['pontos'], 10)

    def test_03_o_resgate_entrega_na_hora_e_uma_vez_so(self):
        c = self.novo('Trilha Resgate')
        self.poe_estado(c)
        status, r = c.pede('POST', '/api/trilha/resgatar', {'degrau': 1})
        self.assertEqual((status, r.get('motivo')), (409, 'faltam-pontos'), r)
        self.assertEqual(c.pede('POST', '/api/trilha/resgatar', {'degrau': 0})[0], 400)
        self.assertEqual(c.pede('POST', '/api/trilha/resgatar', {'degrau': 'x'})[0], 400)
        # 300 pontos à mão: os degraus 1 e 2 ao alcance
        self.sql("INSERT INTO trilha(conta_id, temporada, pontos) VALUES (?, ?, 300)", c.conta['id'], TR.temporada_de(time.time()))
        t = self.trilha(c)
        self.assertEqual([d['n'] for d in t['degraus'] if d['alcancado']], [1, 2])
        moedas_antes = self.save(c)['db']['carteira']['moedas']
        status, r = c.pede('POST', '/api/trilha/resgatar', {'degrau': 2})
        self.assertEqual(status, 200, r)
        self.assertEqual(r['degrau'], 2)
        self.assertTrue([d for d in r['degraus'] if d['n'] == 2][0]['resgatado'])
        premios = TR.premios_do_degrau(2, t['temporada'])
        self.assertEqual(len(r['pedidos']), len(premios))
        linhas = self.sql("SELECT sku, entrega, estado, preco FROM loja_pedidos WHERE conta_id = ? ORDER BY id", c.conta['id'])
        self.assertEqual(len(linhas), len(premios))
        for ln in linhas:
            self.assertEqual((ln['sku'], ln['preco']), ('trilha', 0))
            self.assertEqual(json.loads(ln['entrega']).get('origem'), 'trilha')
        self.assertTrue(all(ln['estado'] == 'entregue' for ln in linhas), 'entregue na hora: %r' % [ln['estado'] for ln in linhas])
        vintens = sum(p['qtd'] for p in premios if p['tipo'] == 'vintens')
        depois = self.save(c)
        self.assertEqual(depois['db']['carteira']['moedas'], moedas_antes + vintens)
        pedra = [p for p in premios if p['tipo'] == 'pedras'][0]
        self.assertEqual(depois['progress']['stones'].get(pedra['alvo']), pedra['qtd'])
        # de novo: já resgatado, e nada entra duas vezes
        status, r2 = c.pede('POST', '/api/trilha/resgatar', {'degrau': 2})
        self.assertEqual((status, r2.get('motivo')), (409, 'ja-resgatado'), r2)
        self.assertEqual(len(self.sql("SELECT id FROM loja_pedidos WHERE conta_id = ?", c.conta['id'])), len(premios))
        # o degrau 3 ainda não
        status, r3 = c.pede('POST', '/api/trilha/resgatar', {'degrau': 3})
        self.assertEqual((status, r3.get('motivo')), (409, 'faltam-pontos'))

    def test_04_a_missao_reivindicada_da_pontos(self):
        if not self.tem_op:
            self.skipTest('o juiz sem /op')
        c = self.novo('Trilha Missao')
        progress, db = self.estado_de_partida()
        # uma missão de hoje já cumprida e não paga, no estado do servidor
        hoje = time.strftime('%Y-%m-%d', time.gmtime(time.time() - 3 * 3600))
        db['missoes'] = {'dia': hoje, 'lista': [{'id': 'd-vitorias', 'prog': 3, 'pago': False}]}
        self.poe_estado(c, progress, db)
        s = self.save(c)
        status, r = c.pede('POST', '/api/op', {'hashAntes': s['hash'], 'ops': [{'nome': 'reivindicarMissao', 'args': {'id': 'd-vitorias'}}],
                                               'hashDepois': None})
        self.assertEqual(status, 200, r)
        self.assertTrue(r['resultados'][0].get('ok'), r['resultados'])
        self.assertEqual(self.trilha(c)['pontos'], 5)


if __name__ == '__main__':
    unittest.main(verbosity=2)
