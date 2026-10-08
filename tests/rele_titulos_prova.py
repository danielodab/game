#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova do TÍTULO QUE ACOMPANHA A POSIÇÃO e da MOLDURA no relé (08/10, servidor/rele_ident.py).

    python tests/rele_titulos_prova.py

Sem relé e sem banco: as funções puras `titulo_do_podio` e `carimba`, com a conta já lida.
  - o título de pódio sai com a posição de AGORA ('Top 1 Pvp' → 'Top 2 Pvp' quando a conta caiu para o
    2º; '' quando saiu do pódio); PVM e os pódios de classe idem; título de chefe e do Eco passam como vieram;
    pódio desconhecido (banco de antes) não mexe em nada;
  - `carimba` troca o título do envelope de perfil ('oi'/'eco') pelo que vale, e a moldura: a do banco sai,
    uma premium que o cliente inventou vira 'auto', e 'auto' passa;
  - `podio_de` lê o pódio de um banco de prova com as tabelas do ranking.
"""
import os
import sqlite3
import sys
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), 'servidor'))
import rele_ident as RI   # noqa: E402


class ProvaDosTitulos(unittest.TestCase):

    def test_titulo_do_podio(self):
        podio = {'pvm': 2, 'pvp': None, 'classes': {'invocador': 1}}
        self.assertEqual(RI.titulo_do_podio('Top 1 PVM', podio), 'Top 2 PVM')
        self.assertEqual(RI.titulo_do_podio('Top 3 PVM', podio), 'Top 2 PVM')
        self.assertEqual(RI.titulo_do_podio('Top 1 Pvp', podio), '')
        self.assertEqual(RI.titulo_do_podio('Top 2 Xamã', podio), 'Top 1 Xamã')
        self.assertEqual(RI.titulo_do_podio('Top 1 Bárbaro', podio), '')
        self.assertEqual(RI.titulo_do_podio('o Podador da Viúva', podio), 'o Podador da Viúva')
        self.assertEqual(RI.titulo_do_podio('Voz do Eco', podio), 'Voz do Eco')
        self.assertEqual(RI.titulo_do_podio('Top 1 Pvp', None), 'Top 1 Pvp')      # pódio desconhecido: fica
        self.assertEqual(RI.titulo_do_podio('', podio), '')
        self.assertEqual(RI.titulo_do_podio(None, podio), None)

    def test_carimba_troca_o_titulo_e_a_moldura(self):
        conta = {'id': 7, 'nome': 'Ana', 'gm': False, 'podio': {'pvm': None, 'pvp': 2, 'classes': {}}, 'moldura': 'rubi'}
        m = {'t': 'oi', 'de': 'x1', 'nome': 'Ana', 'titulo': 'Top 1 Pvp', 'moldura': 'ouro', 'nuvem': 7}
        saida = RI.carimba(dict(m), conta, so_cache=False)
        self.assertIsNotNone(saida)
        self.assertEqual(saida['titulo'], 'Top 2 Pvp')
        self.assertEqual(saida['moldura'], 'rubi', 'a moldura é a do banco, nunca a do cliente')
        # saiu do pódio: o título some
        conta2 = dict(conta, podio={'pvm': None, 'pvp': None, 'classes': {}})
        saida2 = RI.carimba({'t': 'eco', 'de': 'x1', 'nome': 'Ana', 'titulo': 'Top 1 Pvp', 'nuvem': 7}, conta2, so_cache=False)
        self.assertEqual(saida2['titulo'], '')
        # sem moldura no banco: a premium inventada vira 'auto'; 'auto' passa como veio
        conta3 = {'id': 7, 'nome': 'Ana', 'gm': False, 'podio': {'pvm': 1, 'pvp': None, 'classes': {}}}
        saida3 = RI.carimba({'t': 'oi', 'de': 'x1', 'nome': 'Ana', 'titulo': 'Top 1 PVM', 'moldura': 'esmeralda', 'nuvem': 7}, conta3, so_cache=False)
        self.assertEqual((saida3['moldura'], saida3['titulo']), ('auto', 'Top 1 PVM'))
        saida4 = RI.carimba({'t': 'oi', 'de': 'x1', 'nome': 'Ana', 'titulo': 'o Rompe-Salmoura', 'moldura': 'auto', 'nuvem': 7}, conta3, so_cache=False)
        self.assertIsNone(saida4, 'nada a mudar: o relé repassa o envelope como veio')
        # o chat não é perfil: o título não entra
        self.assertIsNone(RI.carimba({'t': 'chat', 'de': 'x1', 'nome': 'Ana', 'texto': 'oi'}, conta, so_cache=False))

    def test_podio_de_num_banco_de_prova(self):
        con = sqlite3.connect(':memory:')
        con.executescript("""
            CREATE TABLE contas(id INTEGER PRIMARY KEY, banido INTEGER DEFAULT 0, gm INTEGER DEFAULT 0);
            CREATE TABLE resumos(conta_id INTEGER PRIMARY KEY, nome TEXT, xp_total INTEGER, nivel_max INTEGER,
                                 brasa_pts INTEGER, brasa_partidas INTEGER);
            CREATE TABLE resumos_classe(conta_id INTEGER, classe TEXT, xp INTEGER, nivel INTEGER);
            INSERT INTO contas(id) VALUES (1), (2), (3), (4);
            INSERT INTO contas(id, gm) VALUES (9, 1);
            INSERT INTO resumos VALUES (1, 'A', 900, 20, 1200, 3), (2, 'B', 800, 18, 1500, 2), (3, 'C', 700, 15, 1000, 0),
                                       (4, 'D', 100, 2, 1800, 5), (9, 'GM', 9999, 30, 9999, 9);
            INSERT INTO resumos_classe VALUES (1, 'invocador', 500, 12), (2, 'invocador', 600, 13), (3, 'sumo', 700, 15);
        """)
        self.assertEqual(RI.podio_de(con, 1), {'pvm': 1, 'pvp': 3, 'classes': {'invocador': 2}})
        self.assertEqual(RI.podio_de(con, 2), {'pvm': 2, 'pvp': 2, 'classes': {'invocador': 1}})
        self.assertEqual(RI.podio_de(con, 3), {'pvm': 3, 'pvp': None, 'classes': {'sumo': 1}})   # sem partida, fora do PvP
        self.assertEqual(RI.podio_de(con, 4)['pvp'], 1)
        self.assertEqual(RI.podio_de(con, 9), {'pvm': None, 'pvp': None, 'classes': {}})          # o Mestre fica fora
        vazio = sqlite3.connect(':memory:')
        self.assertIsNone(RI.podio_de(vazio, 1), 'sem as tabelas: pódio desconhecido, nada se mexe')


if __name__ == '__main__':
    unittest.main(verbosity=2)
