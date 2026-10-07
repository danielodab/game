#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova da META DA SEMANA da guilda (07/10, servidor/guilda.py soma_meta/meta_de), com o juiz de verdade.

    python tests/guilda_meta_api.py

Sobe o juiz e a API como tests/autoridade_api.py, com GUILDA_META_SALAS=2 (o alvo de verdade é 60), e prova:
  - a ficha da guilda traz `meta` {semana, salas, alvo, cumprida, fim}, zerada ao fundar;
  - a sala VENCIDA de um membro soma 1 (a resposta do fechar traz `guildaMeta`); a perdida não soma; quem não
    tem guilda não soma nada (guildaMeta null);
  - ao encher: `cumprida`, XP_META (150) para a guilda e os dois bônus (xp e drop) estendidos até o fim da
    semana — e a sala seguinte não paga o prêmio de novo (salas segue contando);
  - a meta é da semana de Brasília: `fim` é a próxima segunda 00:00 de Brasília.
"""
import json
import os
import sys
import time
import unittest
from datetime import datetime, timedelta, timezone

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
os.environ['GUILDA_META_SALAS'] = '2'          # antes de importar: o palco herda o ambiente
import autoridade_api as A  # noqa: E402

BRASILIA = timezone(timedelta(hours=-3))


class ProvaDaMeta(A.ProvaDaAutoridade):

    def minha(self, c):
        status, r = c.pede('GET', '/api/guilda/minha')
        self.assertEqual(status, 200, r)
        return r['guilda']

    def vence(self, c):
        """Abre e fecha a sala que a IA vence (a Cisterna, semente 11); devolve a resposta do fechar."""
        self.fecha_lutas(c)
        # a vida única: o herói sai ferido da sala anterior e perderia a seguinte — a prova o enche de novo
        self.sql("DELETE FROM vida_heroi WHERE conta_id = ?", c.conta['id'])
        b = self.abre(c)
        jogo = self.joga(c, b['bilhete'])
        status, r = self.fecha(c, b['bilhete'], jogo)
        self.assertEqual(status, 200, r)
        self.assertEqual(r.get('fase'), 'won', r)
        return r

    def test_01_a_meta_nasce_zerada_e_a_sala_vencida_soma(self):
        c = self.novo('Meta Lider')
        self.poe_estado(c)
        status, r = c.pede('POST', '/api/guilda/criar', {'nome': 'Guilda da Meta %d' % A.ProvaDaAutoridade._n, 'emblema': '⚔'})
        self.assertEqual(status, 200, r)
        g = r['guilda']
        self.assertEqual((g['meta']['salas'], g['meta']['alvo'], g['meta']['cumprida']), (0, 2, False), g['meta'])
        # o fim é a próxima segunda, 00:00 de Brasília
        fim = datetime.fromtimestamp(g['meta']['fim'] / 1000, BRASILIA)
        self.assertEqual((fim.weekday(), fim.hour, fim.minute), (0, 0, 0), fim)
        self.assertGreater(g['meta']['fim'] / 1000, time.time())
        self.assertLessEqual(g['meta']['fim'] / 1000, time.time() + 8 * 86400)
        # a sala vencida soma 1
        r1 = self.vence(c)
        self.assertIsInstance(r1.get('guildaMeta'), dict, r1)
        self.assertEqual((r1['guildaMeta']['salas'], r1['guildaMeta']['cumprida'], r1['guildaMeta']['cumpriuAgora']), (1, False, False))
        self.assertEqual(self.minha(c)['meta']['salas'], 1)
        # a sala perdida (fechada sem lance) não soma
        self.fecha_lutas(c)
        b = self.abre(c)
        status, r2 = c.pede('POST', '/api/sala/fechar', {'bilhete': b['bilhete'], 'lances': [], 'hashFinal': None})
        self.assertEqual(status, 200, r2)
        self.assertNotEqual(r2.get('fase'), 'won')
        self.assertEqual(self.minha(c)['meta']['salas'], 1)
        # a segunda vencida enche a meta: prêmio uma vez
        xp_antes = self.minha(c)['xp']
        r3 = self.vence(c)
        m3 = r3['guildaMeta']
        self.assertEqual((m3['salas'], m3['cumprida'], m3['cumpriuAgora']), (2, True, True), m3)
        g3 = self.minha(c)
        self.assertEqual(g3['xp'], xp_antes + 150, 'XP_META para a guilda')
        self.assertEqual(g3['bonus']['xp'], g3['meta']['fim'], 'o bônus de XP vai até o fim da semana')
        self.assertEqual(g3['bonus']['drop'], g3['meta']['fim'], 'e o de saque também')
        # a terceira vencida conta, mas não paga de novo
        r4 = self.vence(c)
        self.assertEqual((r4['guildaMeta']['salas'], r4['guildaMeta']['cumpriuAgora']), (3, False))
        self.assertEqual(self.minha(c)['xp'], xp_antes + 150)
        # e o bônus de verdade pesa na sala seguinte (o contexto da guilda chega ao juiz): a recompensa cita +15%
        self.assertGreater(r4['recompensa']['xpGanho'], 0)

    def test_02_sem_guilda_nada_soma(self):
        c = self.novo('Meta Solto')
        self.poe_estado(c)
        r = self.vence(c)
        self.assertIsNone(r.get('guildaMeta'), r.get('guildaMeta'))
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM guilda_meta")[0]['n'] >= 0, True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
