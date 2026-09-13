#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova das POÇÕES DE VIDA na API de verdade, com o JUIZ de verdade.

    python tests/pocoes_api.py

O pedido do dono (13/09): "no mercadinho do jogo deve ter poções à venda por vinténs.
poções que carregam a vida vão para consumíveis no inventário". Sobe o juiz e a API
como tests/autoridade_api.py (herda a montagem e os ajudantes de lá; só as provas
`prova_*` daqui rodam) e cobra:
  - a compra pela /api/op (comprarPocao): debita o saco e soma o contador no estado do
    servidor; recusa acima do teto de 20 e sem vinténs no saco (o banco não conta);
  - a sala vencida bebendo poção: o /api/sala/fechar paga e DESCONTA as poções bebidas;
  - a sala largada depois do gole: não paga, mas a poção sai do estado (sala 'perdida');
  - a sala que bebeu mais do que a conta tinha: 422 'pocoes', sala 'recusada', nada gravado.
As salas são jogadas por tests/juiz_jogador.js com `pocoes` (o herói ferido bebe no começo
da vez). Os processos rodam com prioridade abaixo do normal (a máquina é dividida).
"""
import os
import sys
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
import autoridade_api as A  # noqa: E402  (a montagem do juiz e da API e os ajudantes)

PEQ, MED, GRA = 'pocao-pequena', 'pocao-media', 'pocao-grande'


class ProvaDasPocoes(A.ProvaDaAutoridade):
    """Só os métodos `prova_*` rodam (o carregador abaixo): os `test_*` herdados são da outra prova."""

    def joga_bebendo(self, c, bilhete, pocoes, corta=None):
        s = self.save(c)
        linha = self.sala(bilhete)
        pedido = {'progress': s['progress'], 'db': s['db'], 'dungeonId': linha['dungeon'], 'roomIndex': linha['sala'],
                  'semente': linha['semente'], 'dificuldade': linha['dificuldade'],
                  'herois': A.json.loads(linha['herois']),
                  'carry': None, 'pocoes': pocoes}
        if corta is not None:
            pedido['cortaEm'] = corta
        return A.roda_node([A.JOGADOR], pedido)

    def conta_com(self, apelido, pocoes=None, carteira=0):
        c = self.novo(apelido)
        p, d = self.estado_de_partida(carteira=carteira)
        if pocoes:
            p['consumiveis'] = dict(pocoes)
        self.poe_estado(c, p, d)
        return c

    # -- a banca pela /api/op ----------------------------------------------------------------
    def prova_01_compra_pela_op(self):
        self.precisa_op()
        c = self.conta_com('Boticaria', carteira=2000)
        status, r = c.pede('POST', '/api/op', {'ops': [{'nome': 'comprarPocao', 'args': {'id': MED, 'qtd': 3}}]})
        self.assertEqual(status, 200, r)
        self.assertTrue(r['resultados'][0]['ok'], r['resultados'])
        s = self.save(c)
        self.assertEqual(s['db']['carteira']['moedas'], 2000 - 3 * 110, 'os vinténs saem do saco NO SERVIDOR')
        self.assertEqual(s['progress'].get('consumiveis'), {MED: 3})
        self.assertEqual(s['hash'], r['hash'])
        # 20 Pequenas cabem; a 21ª não (e não cobra); 4 Grandes não cabem no saco que sobrou
        status, r2 = c.pede('POST', '/api/op', {'hashAntes': r['hash'], 'ops': [
            {'nome': 'comprarPocao', 'args': {'id': PEQ, 'qtd': 20}},
            {'nome': 'comprarPocao', 'args': {'id': PEQ, 'qtd': 1}},
            {'nome': 'comprarPocao', 'args': {'id': GRA, 'qtd': 4}}]})
        self.assertEqual(status, 200, r2)
        oks = [x.get('ok') for x in r2['resultados']]
        self.assertEqual(oks, [True, False, False], r2['resultados'])
        self.assertTrue(r2['resultados'][1].get('cheio'), 'a 21ª Pequena passa do teto')
        self.assertTrue(r2['resultados'][2].get('semVintem'), '4 Grandes custam 1040 e o saco tem 870')
        s2 = self.save(c)
        self.assertEqual(s2['db']['carteira']['moedas'], 2000 - 330 - 800)
        self.assertEqual(s2['progress']['consumiveis'], {MED: 3, PEQ: 20})
        # o banco não conta: 800 guardados e 70 no saco não compram uma Grande de 260
        status, r3 = c.pede('POST', '/api/op', {'hashAntes': r2['hash'], 'ops': [
            {'nome': 'depositarMoedas', 'args': {'n': 800}}, {'nome': 'comprarPocao', 'args': {'id': GRA, 'qtd': 1}}]})
        self.assertEqual(status, 200, r3)
        self.assertFalse(r3['resultados'][1]['ok'], r3['resultados'])
        s3 = self.save(c)
        self.assertEqual((s3['db']['carteira']['moedas'], s3['db']['banco']['moedas']), (70, 800))
        self.assertNotIn(GRA, s3['progress']['consumiveis'])
        # quantidade torta derruba o pedido inteiro
        status, r4 = c.pede('POST', '/api/op', {'hashAntes': r3['hash'], 'ops': [{'nome': 'comprarPocao', 'args': {'id': PEQ, 'qtd': 0}}]})
        self.assertEqual(status, 422, r4)
        self.assertEqual(self.save(c)['versao'], s3['versao'])

    # -- a sala ---------------------------------------------------------------------------------
    def prova_02_vitoria_bebendo_desconta(self):
        c = self.conta_com('Sedento', {PEQ: 20})
        b = self.abre(c)
        jogo = self.joga_bebendo(c, b['bilhete'], {PEQ: 20})
        self.assertEqual(jogo['fase'], 'won', 'a sala da prova precisa ser vencida pela IA bebendo')
        n = jogo['bebidas'].get(PEQ, 0)
        self.assertGreater(n, 0, 'o herói ferido bebeu')
        status, r = self.fecha(c, b['bilhete'], jogo)
        self.assertEqual(status, 200, r)
        self.assertEqual(r['fase'], 'won')
        self.assertIsInstance(r['recompensa'], dict)
        s = self.save(c)
        self.assertEqual((s['progress'].get('consumiveis') or {}).get(PEQ, 0), 20 - n,
                         'as poções bebidas saem do estado do servidor')
        self.assertEqual(s['hash'], r['hash'])
        self.assertEqual(self.sala(b['bilhete'])['estado'], 'paga')

    def prova_03_sala_largada_desconta_sem_pagar(self):
        c = self.conta_com('Largou Bebendo', {PEQ: 20})
        antes = self.save(c)
        b = self.abre(c)
        jogo = self.joga_bebendo(c, b['bilhete'], {PEQ: 20}, corta=2)        # a colocação e o gole
        self.assertEqual(jogo['fase'], 'playing')
        self.assertEqual([l['a'] for l in jogo['lances']], ['p', 'po'], jogo['lances'])
        self.assertTrue(jogo['lances'][1]['ok'])
        status, r = self.fecha(c, b['bilhete'], jogo)
        self.assertEqual(status, 200, r)
        self.assertEqual((r['fase'], r['recompensa']), ('playing', None))
        s = self.save(c)
        self.assertEqual(s['versao'], antes['versao'] + 1, 'o gole grava o estado')
        self.assertEqual(s['progress']['consumiveis'], {PEQ: 19})
        self.assertEqual(s['db']['carteira'], antes['db']['carteira'], 'e nada de recompensa')
        self.assertEqual(self.sala(b['bilhete'])['estado'], 'perdida')

    def prova_04_bebeu_mais_do_que_tinha(self):
        c = self.conta_com('Sem Frasco', {PEQ: 2})
        antes = self.save(c)
        b = self.abre(c)
        jogo = self.joga_bebendo(c, b['bilhete'], {PEQ: 20})
        self.assertGreater(jogo['bebidas'].get(PEQ, 0), 2, 'a prova precisa de mais de 2 goles')
        status, r = self.fecha(c, b['bilhete'], jogo)
        self.assertEqual(status, 422, r)
        self.assertEqual(r.get('motivo'), 'pocoes')
        self.assertEqual(self.sala(b['bilhete'])['estado'], 'recusada')
        self.assertEqual(self.save(c), antes, 'nada muda no estado')


if __name__ == '__main__':
    carregador = unittest.TestLoader()
    carregador.testMethodPrefix = 'prova_'
    resultado = unittest.TextTestRunner(verbosity=2).run(carregador.loadTestsFromTestCase(ProvaDasPocoes))
    sys.exit(0 if resultado.wasSuccessful() else 1)
