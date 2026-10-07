#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova do AFIXO no bilhete (07/10, js/core/afixos.js; docs/SEGURANCA.md §4.1), com o juiz de verdade.

    python tests/afixos_api.py

Sobe o juiz e a API como tests/autoridade_api.py (banco descartável, portas livres, prioridade
abaixo do normal) e prova o lado do servidor do Calabouço do Dia com afixo:
  - GET /regras do juiz anuncia os `afixos` que a API aceita; POST /dia diz o Calabouço do Dia e o
    afixo dele no instante pedido, e vira junto com o dia de Brasília;
  - POST /api/sala/abrir no portal DO DIA devolve o afixo do dia e o guarda em salas_afixo; em outro
    portal devolve null e não guarda nada; a proposta da página só serve para cair como 400 quando
    está fora do catálogo — no portal que não é o do dia ela é ignorada (a meia-noite);
  - a sala em grupo (POST /api/grupo/abrir) segue a mesma regra (salas_grupo_afixo);
  - POST /api/sala/fechar: a sala jogada com o afixo do bilhete fecha (200) e, vencida, o recibo diz o
    afixo; a mesma sala jogada SEM o afixo cai como 'divergiu' — o juiz refaz com o afixo com que abriu.
"""
import json
import os
import sys
import unittest
import urllib.request
from datetime import datetime, timedelta, timezone

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
import autoridade_api as A  # noqa: E402  (o palco: juiz + API num banco descartável)

BRASILIA = timezone(timedelta(hours=-3))


def _juiz(base, rota, corpo=None):
    dados = None if corpo is None else json.dumps(corpo).encode('utf-8')
    req = urllib.request.Request(base + rota, data=dados, method='POST' if corpo is not None else 'GET',
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode('utf-8'))


class ProvaDoAfixo(A.ProvaDaAutoridade):

    def dia(self):
        import time
        return _juiz(self.juiz, '/dia', {'ms': int(time.time() * 1000)})

    def outro_portal(self, dungeon_do_dia):
        regras = _juiz(self.juiz, '/regras')
        for d in regras['calaboucos']:
            if d != dungeon_do_dia and d != 'poco' and regras['calaboucos'][d] >= 1:
                return d
        self.fail('sem outro portal nas regras: %r' % regras)

    def test_01_o_juiz_anuncia_os_afixos_e_o_dia(self):
        regras = _juiz(self.juiz, '/regras')
        self.assertIsInstance(regras.get('afixos'), list, regras)
        self.assertGreaterEqual(len(regras['afixos']), 6, regras['afixos'])
        self.assertEqual(len(set(regras['afixos'])), len(regras['afixos']))
        dia = self.dia()
        self.assertTrue(dia.get('ok'), dia)
        self.assertIn(dia.get('dungeonId'), regras['calaboucos'], dia)
        self.assertIn(dia.get('afixo'), regras['afixos'], dia)
        self.assertNotEqual(dia.get('dungeonId'), 'poco')
        # o dia vira às 00:00 de Brasília: 23:59 e 00:01 do mesmo dia civil de Brasília dão chaves vizinhas
        meio = datetime(2026, 10, 7, 12, 0, tzinfo=BRASILIA)
        antes = _juiz(self.juiz, '/dia', {'ms': int((meio.replace(hour=23, minute=59)).timestamp() * 1000)})
        depois = _juiz(self.juiz, '/dia', {'ms': int((meio + timedelta(days=1)).replace(hour=0, minute=1).timestamp() * 1000)})
        self.assertEqual((antes['chave'], depois['chave']), (20261007, 20261008), (antes, depois))
        # e o mesmo dia dá sempre a mesma resposta
        self.assertEqual(_juiz(self.juiz, '/dia', {'ms': int(meio.timestamp() * 1000)}),
                         _juiz(self.juiz, '/dia', {'ms': int((meio + timedelta(hours=3)).timestamp() * 1000)}))

    def test_02_abrir_no_portal_do_dia_leva_o_afixo_do_dia(self):
        c = self.novo('Afixo Dia')
        self.poe_estado(c)
        dia = self.dia()
        # sem proposta nenhuma: o servidor decide
        status, r = c.pede('POST', '/api/sala/abrir', {'dungeonId': dia['dungeonId'], 'roomIndex': 0, 'herois': ['sumo']})
        self.assertEqual(status, 200, r)
        self.assertEqual(r.get('afixo'), dia['afixo'], r)
        linha = self.sql("SELECT afixo FROM salas_afixo WHERE bilhete = ?", r['bilhete'])
        self.assertEqual([x['afixo'] for x in linha], [dia['afixo']])
        self.fecha_lutas(c)
        # com a proposta certa: o mesmo; com uma proposta de OUTRO afixo do catálogo: o do dia manda
        outro = [a for a in _juiz(self.juiz, '/regras')['afixos'] if a != dia['afixo']][0]
        status, r2 = c.pede('POST', '/api/sala/abrir', {'dungeonId': dia['dungeonId'], 'roomIndex': 0, 'herois': ['sumo'],
                                                       'afixo': outro})
        self.assertEqual(status, 200, r2)
        self.assertEqual(r2.get('afixo'), dia['afixo'], 'o servidor decide, não a página')
        self.fecha_lutas(c)
        # fora do catálogo: 400 na porta (uma página mexida), nada abre
        n = self.sql("SELECT COUNT(*) AS n FROM salas WHERE conta_id = ?", c.conta['id'])[0]['n']
        status, r3 = c.pede('POST', '/api/sala/abrir', {'dungeonId': dia['dungeonId'], 'roomIndex': 0, 'herois': ['sumo'],
                                                       'afixo': 'lua'})
        self.assertEqual(status, 400, r3)
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM salas WHERE conta_id = ?", c.conta['id'])[0]['n'], n)
        self.assertEqual(c.pede('POST', '/api/sala/abrir', {'dungeonId': dia['dungeonId'], 'roomIndex': 0, 'herois': ['sumo'],
                                                           'afixo': 7})[0], 400)

    def test_03_outro_portal_nao_leva_afixo(self):
        c = self.novo('Afixo Outro')
        self.poe_estado(c)
        dia = self.dia()
        outro = self.outro_portal(dia['dungeonId'])
        status, r = c.pede('POST', '/api/sala/abrir', {'dungeonId': outro, 'roomIndex': 0, 'herois': ['sumo']})
        self.assertEqual(status, 200, r)
        self.assertIsNone(r.get('afixo'), r)
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM salas_afixo WHERE bilhete = ?", r['bilhete'])[0]['n'], 0)
        self.fecha_lutas(c)
        # a proposta da página num portal que não é o do dia é IGNORADA (a página um dia atrás à meia-noite)
        status, r2 = c.pede('POST', '/api/sala/abrir', {'dungeonId': outro, 'roomIndex': 0, 'herois': ['sumo'],
                                                       'afixo': dia['afixo']})
        self.assertEqual(status, 200, r2)
        self.assertIsNone(r2.get('afixo'), r2)
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM salas_afixo WHERE bilhete = ?", r2['bilhete'])[0]['n'], 0)

    def test_04_fechar_refaz_com_o_afixo_do_bilhete(self):
        c = self.novo('Afixo Fecha')
        progress, db = self.estado_de_partida(nivel=30)
        self.poe_estado(c, progress, db)
        dia = self.dia()
        # a sala do dia, com uma semente fixa (a IA do "jogador" pode vencer ou não: o que se prova é a conferência)
        b = self.abre(c, semente=11, dungeonId=dia['dungeonId'])
        self.assertEqual(b.get('afixo'), dia['afixo'])
        # jogada SEM o afixo (a página que ignorasse o bilhete): o juiz refaz com o afixo e o fim diverge
        sem = self.joga(c, b['bilhete'], afixo=False)
        status, r = self.fecha(c, b['bilhete'], sem)
        self.assertEqual(status, 422, r)
        self.assertEqual(r.get('motivo'), 'divergiu', r)
        self.assertEqual(self.sala(b['bilhete'])['estado'], 'recusada')
        # jogada COM o afixo do bilhete: fecha; vencida, o recibo diz o afixo e pagou
        self.fecha_lutas(c)
        b2 = self.abre(c, semente=11, dungeonId=dia['dungeonId'])
        com = self.joga(c, b2['bilhete'])          # o afixo do bilhete, como a página honesta
        status, r2 = self.fecha(c, b2['bilhete'], com)
        self.assertEqual(status, 200, r2)
        self.assertIn(r2.get('fase'), ('won', 'lost', 'playing'), r2)
        if r2.get('fase') == 'won':
            self.assertEqual((r2.get('recompensa') or {}).get('afixo', {}).get('id'), dia['afixo'], r2.get('recompensa'))
            self.assertGreater(r2['recompensa']['xpGanho'], 0)

    def test_05_a_sala_em_grupo_segue_a_mesma_regra(self):
        a, b = self.novo('Afixo Lider'), self.novo('Afixo Parceiro')
        self.poe_estado(a)
        self.poe_estado(b)
        dia = self.dia()
        corpo = {'dungeonId': dia['dungeonId'], 'roomIndex': 0, 'dificuldade': 'normal', 'herois': ['sumo'], 'dono': 'L1',
                 'parceiro': {'conta': b.conta['id'], 'dono': 'P1', 'herois': ['sumo']}}
        status, r = a.pede('POST', '/api/grupo/abrir', corpo)
        self.assertEqual(status, 200, r)
        self.assertEqual(r.get('afixo'), dia['afixo'], r)
        self.assertEqual([x['afixo'] for x in self.sql("SELECT afixo FROM salas_grupo_afixo WHERE gid = ?", r['gid'])],
                         [dia['afixo']])
        self.fecha_lutas(a)
        self.fecha_lutas(b)
        outro = self.outro_portal(dia['dungeonId'])
        status, r2 = a.pede('POST', '/api/grupo/abrir', dict(corpo, dungeonId=outro, afixo='lua'))
        self.assertEqual(status, 400, r2)
        status, r3 = a.pede('POST', '/api/grupo/abrir', dict(corpo, dungeonId=outro))
        self.assertEqual(status, 200, r3)
        self.assertIsNone(r3.get('afixo'), r3)

    def test_06_o_caminho_escuro_sorteia_um_afixo_da_segunda_sala_em_diante(self):
        """07/10: `escuro: true` pede um afixo sorteado (do catálogo) num portal que não é o do dia — da sala 1 em
        diante; a sala 0 ignora; torto cai 400; o afixo fica no bilhete e a sala em grupo segue a mesma regra."""
        c = self.novo('Escuro')
        self.poe_estado(c)
        dia = self.dia()
        outro = self.outro_portal(dia['dungeonId'])
        lista = _juiz(self.juiz, '/regras')['afixos']
        # a primeira sala nunca
        status, r0 = c.pede('POST', '/api/sala/abrir', {'dungeonId': outro, 'roomIndex': 0, 'herois': ['sumo'], 'escuro': True})
        self.assertEqual(status, 200, r0)
        self.assertIsNone(r0.get('afixo'), r0)
        self.fecha_lutas(c)
        # da segunda em diante: um afixo do catálogo, guardado no bilhete
        status, r1 = c.pede('POST', '/api/sala/abrir', {'dungeonId': outro, 'roomIndex': 1, 'herois': ['sumo'], 'escuro': True})
        self.assertEqual(status, 200, r1)
        self.assertIn(r1.get('afixo'), lista, r1)
        self.assertEqual([x['afixo'] for x in self.sql("SELECT afixo FROM salas_afixo WHERE bilhete = ?", r1['bilhete'])], [r1['afixo']])
        self.fecha_lutas(c)
        # sem pedir: nada
        status, r2 = c.pede('POST', '/api/sala/abrir', {'dungeonId': outro, 'roomIndex': 1, 'herois': ['sumo'], 'escuro': False})
        self.assertEqual(status, 200, r2)
        self.assertIsNone(r2.get('afixo'), r2)
        self.fecha_lutas(c)
        # torto
        self.assertEqual(c.pede('POST', '/api/sala/abrir', {'dungeonId': outro, 'roomIndex': 1, 'herois': ['sumo'], 'escuro': 'sim'})[0], 400)
        # no portal do dia o do dia manda, escuro ou não
        status, r3 = c.pede('POST', '/api/sala/abrir', {'dungeonId': dia['dungeonId'], 'roomIndex': 1, 'herois': ['sumo'], 'escuro': True})
        self.assertEqual(status, 200, r3)
        self.assertEqual(r3.get('afixo'), dia['afixo'])
        self.fecha_lutas(c)
        # a sala em grupo
        b = self.novo('Escuro Parceiro')
        self.poe_estado(b)
        corpo = {'dungeonId': outro, 'roomIndex': 1, 'dificuldade': 'normal', 'herois': ['sumo'], 'dono': 'L9',
                 'parceiro': {'conta': b.conta['id'], 'dono': 'P9', 'herois': ['sumo']}, 'escuro': True}
        status, r4 = c.pede('POST', '/api/grupo/abrir', corpo)
        self.assertEqual(status, 200, r4)
        self.assertIn(r4.get('afixo'), lista, r4)
        self.assertEqual([x['afixo'] for x in self.sql("SELECT afixo FROM salas_grupo_afixo WHERE gid = ?", r4['gid'])], [r4['afixo']])



if __name__ == '__main__':
    unittest.main(verbosity=2)
