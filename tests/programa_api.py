#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova da SEMANA DO SOTERRA (07/10, servidor/api.py PROGRAMA_SEMANAL), com o juiz de verdade.

    python tests/programa_api.py

Sobe o juiz e a API como tests/autoridade_api.py e prova:
  - GET /api/eventos traz `programa` (os sete dias, 0 = domingo … 6 = sábado, um de cada) e, em `semanais`,
    um evento do programa por dia de Brasília da janela de 14 dias (origem 'programa', id semana-<tipo>-<dia>),
    cada um das 00:00 às 24:00 de Brasília, com o tipo e o multiplicador do dia da semana;
  - a sexta ("Sexta do Dia") aponta para o Calabouço do Dia daquela sexta — o mesmo que o juiz diz em POST /dia;
  - o de hoje está no ar e entra em `fatores` (o servidor paga por ele: _fatores_no_ar usa a mesma lista);
  - o id é estável (duas leituras, os mesmos ids) e ninguém o cancela (não é de agenda_eventos: 404/400).
"""
import json
import os
import sys
import time
import unittest
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
# a bateria base sobe a API com o programa DESLIGADO (servidor_api.py); esta prova é do programa: liga antes de importar
os.environ['PROGRAMA_SEMANAL'] = '1'
import autoridade_api as A  # noqa: E402

FUSO_S = -3 * 3600


def _juiz(base, rota, corpo=None):
    dados = None if corpo is None else json.dumps(corpo).encode('utf-8')
    req = urllib.request.Request(base + rota, data=dados, method='POST' if corpo is not None else 'GET',
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode('utf-8'))


def dia_de(t):
    return (int(t) + FUSO_S) // 86400


class ProvaDaSemana(A.ProvaDaAutoridade):

    def le_eventos(self):
        c = A.Cliente(self.base)
        status, r = c.pede('GET', '/api/eventos')
        self.assertEqual(status, 200, r)
        return r

    def test_01_o_programa_tem_os_sete_dias(self):
        r = self.le_eventos()
        prog = r.get('programa')
        self.assertIsInstance(prog, list, r)
        self.assertEqual(sorted(p['dia'] for p in prog), [0, 1, 2, 3, 4, 5, 6], prog)
        for p in prog:
            self.assertIn(p['tipo'], ('xp', 'vintem', 'pedras', 'saque'), p)
            self.assertGreater(p['multiplicador'], 1, p)
            self.assertLessEqual(p['multiplicador'], 2, 'o programa é modesto de propósito: %r' % p)
            self.assertTrue(p['titulo'] and p['texto'], p)

    def test_02_um_evento_por_dia_na_janela(self):
        r = self.le_eventos()
        t = r['agora']
        por_dia = {p['dia']: p for p in r['programa']}
        do_programa = [e for e in r['semanais'] if e.get('origem') == 'programa']
        dias = sorted(set(dia_de(e['inicio']) for e in do_programa))
        self.assertEqual(dias[0], dia_de(t), 'começa hoje')
        self.assertGreaterEqual(len(dias), 14, 'cobre a janela de 14 dias: %r' % dias)
        self.assertEqual(len(dias), len(do_programa), 'um por dia, sem repetir')
        for e in do_programa:
            d = dia_de(e['inicio'])
            self.assertEqual(e['inicio'], d * 86400 - FUSO_S, 'começa às 00:00 de Brasília')
            self.assertEqual(e['fim'], e['inicio'] + 86400, 'dura o dia inteiro')
            p = por_dia[(d + 4) % 7]
            self.assertEqual((e['tipo'], e['multiplicador'], e['titulo']), (p['tipo'], p['multiplicador'], p['titulo']), e)
            self.assertEqual(e['id'], 'semana-%s-%d' % (p['tipo'], d))
            if p['calabouco'] == 'dia':
                dia = _juiz(self.juiz, '/dia', {'ms': (e['inicio'] + 43200) * 1000})
                self.assertEqual(e['calabouco'], dia['dungeonId'], 'a sexta aponta para o Calabouço do Dia daquela sexta')
            else:
                self.assertEqual(e['calabouco'], p['calabouco'], e)

    def test_03_o_de_hoje_esta_no_ar_e_pesa_nos_fatores(self):
        r = self.le_eventos()
        t = r['agora']
        hoje = [e for e in r['semanais'] if e.get('origem') == 'programa' and e['inicio'] <= t < e['fim']]
        self.assertEqual(len(hoje), 1, hoje)
        e = hoje[0]
        f = r['fatores']
        if e['calabouco'] is None:
            self.assertGreaterEqual(f['geral'].get(e['tipo'], 1), e['multiplicador'], f)
        else:
            self.assertGreaterEqual(f['porCalabouco'].get(e['calabouco'], {}).get(e['tipo'], 1), e['multiplicador'], f)

    def test_04_o_id_e_estavel_e_ninguem_cancela(self):
        a = [e['id'] for e in self.le_eventos()['semanais'] if e.get('origem') == 'programa']
        time.sleep(0.2)
        b = [e['id'] for e in self.le_eventos()['semanais'] if e.get('origem') == 'programa']
        self.assertEqual(a, b)
        # o cancelamento do Mestre só conhece agenda_eventos: o id do programa não é número e não passa na porta
        c = self.novo('Cancela Programa')
        status, r = c.pede('POST', '/api/eventos/cancelar', {'alvo': 'evento', 'id': a[0]})
        self.assertIn(status, (400, 401, 403, 404), r)


if __name__ == '__main__':
    unittest.main(verbosity=2)
