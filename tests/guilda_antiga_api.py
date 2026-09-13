#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova das guildas de antes do servidor e do ranking de guildas do site.

    python tests/guilda_antiga_api.py

13/09 (dono: "no site só aparece a guild Game Over, no jogo só a STAFF"). O
ranking do site lia o nome de guilda que ficou no SAVE (de quando a guilda
morava no navegador) e escondia a guilda cujos membros eram todos da equipe.
Aqui: a foto das guildas de antes (migração 'guildas-antigas') só vale para o
que já estava no banco no boot; o primeiro traz e vira líder, o segundo volta;
nome fundado por outra gente não se traz; o ranking mostra só guildas do
servidor, e a guilda só da equipe fica fora dele (regra de 10/09). Sobe a API duas vezes no mesmo banco
descartável (a segunda com a foto por tirar). Contas sintéticas.
"""
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


class ProvaDasGuildasDeAntes(unittest.TestCase):

    def sobe(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
        self.proc = subprocess.Popen([sys.executable, API, '--porta', str(self.porta), '--banco', self.banco_arq],
                                     stdout=self.log, stderr=subprocess.STDOUT, env=env)
        self.assertTrue(espera_api(self.base, self.proc), 'a API não subiu; log em ' + self.pasta)

    def desce(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except subprocess.TimeoutExpired:
                self.proc.kill()

    def sql(self, consulta, *args):
        b = sqlite3.connect(self.banco_arq)
        b.row_factory = sqlite3.Row
        try:
            linhas = b.execute(consulta, args).fetchall()
            b.commit()
            return linhas
        finally:
            b.close()

    def setUp(self):
        self.pasta = tempfile.mkdtemp(prefix='soterra-guilda-antiga-')
        self.porta = porta_livre()
        self.base = 'http://127.0.0.1:%d' % self.porta
        self.banco_arq = os.path.join(self.pasta, 'dados', 'soterra.db')
        self.log = open(os.path.join(self.pasta, 'api.log'), 'w', encoding='utf-8')
        self.sobe()

    def tearDown(self):
        self.desce()
        self.log.close()
        shutil.rmtree(self.pasta, ignore_errors=True)

    def conta(self, nome):
        c = Cliente(self.base)
        status, r = c.cadastra(nome)
        self.assertEqual(status, 201, r)
        return c

    def resumo(self, c, guilda, xp=100):
        colunas = [r['name'] for r in self.sql("PRAGMA table_info(resumos)")]
        valores = {'conta_id': c.conta['id'], 'nome': c.conta['nome'], 'xp_total': xp, 'nivel_max': 1,
                   'classes': 1, 'guilda_nome': guilda, 'guilda_emblema': '💀', 'atualizado_em': int(time.time())}
        valores = {k: v for k, v in valores.items() if k in colunas}
        self.sql("INSERT OR REPLACE INTO resumos(%s) VALUES (%s)" % (', '.join(valores), ', '.join('?' * len(valores))),
                 *valores.values())

    def test_guildas_de_antes_e_o_ranking(self):
        oda, bueno, livre, alheio, dono, staff, tarde = (
            self.conta(n) for n in ('Oda Prova', 'Bueno Prova', 'Livre Prova', 'Alheio Prova', 'Pedro Prova',
                                    'Cuidador Prova', 'Tarde Prova'))
        # uma guilda fundada no servidor com um nome que outra gente ainda tem no save
        s, r = dono.pede('POST', '/api/guilda/criar', {'nome': 'Tomada Z', 'emblema': '⚔'})
        self.assertEqual(s, 200, r)
        # a guilda da equipe: o único membro é gm
        self.sql("UPDATE contas SET gm = 1 WHERE id = ?", staff.conta['id'])
        s, r = staff.pede('POST', '/api/guilda/criar', {'nome': 'Guarda W', 'emblema': '🛡'})
        self.assertEqual(s, 200, r)
        self.resumo(oda, 'Velha X', 1130)
        self.resumo(bueno, 'Velha X', 38)
        self.resumo(livre, 'Nome Livre Y', 5)
        self.resumo(alheio, 'Tomada Z', 7)
        self.resumo(dono, None, 50)
        self.resumo(staff, 'Guarda W', 9999)

        # a foto é tirada no boot seguinte (o 1º boot já marcou a migração num banco vazio)
        self.desce()
        self.sql("DELETE FROM migracoes WHERE nome = 'guildas-antigas'")
        self.sobe()
        # save forjado DEPOIS da foto não ganha guilda de graça
        self.resumo(tarde, 'Velha X', 1)

        s, r = oda.pede('GET', '/api/guilda/minha')
        self.assertEqual(s, 200, r)
        self.assertIsNone(r['guilda'])
        self.assertEqual(r['antiga'], {'nome': 'Velha X', 'emblema': '💀', 'existe': False})
        self.assertIsNone(tarde.pede('GET', '/api/guilda/minha')[1]['antiga'], 'save forjado depois da foto')
        self.assertIsNone(alheio.pede('GET', '/api/guilda/minha')[1]['antiga'], 'nome fundado por outra gente')
        s, r = alheio.pede('POST', '/api/guilda/trazer', {})
        self.assertEqual(s, 404, r)

        # o primeiro traz e vira líder, sem insígnia nenhuma
        s, r = oda.pede('POST', '/api/guilda/trazer', {})
        self.assertEqual(s, 200, r)
        self.assertEqual(r['como'], 'fundou')
        self.assertEqual(r['guilda']['nome'], 'Velha X')
        self.assertEqual(r['guilda']['liderId'], oda.conta['id'])
        s, r = oda.pede('POST', '/api/guilda/trazer', {})
        self.assertEqual(s, 409, r)

        # o segundo da mesma foto VOLTA (sem convite, mesmo com a porta fechada)
        s, r = oda.pede('POST', '/api/guilda/porta', {'modo': 'convite'})
        self.assertEqual(s, 200, r)
        self.assertEqual(bueno.pede('GET', '/api/guilda/minha')[1]['antiga']['existe'], True)
        s, r = bueno.pede('POST', '/api/guilda/trazer', {})
        self.assertEqual(s, 200, r)
        self.assertEqual(r['como'], 'voltou')
        self.assertEqual(sorted(m['id'] for m in r['guilda']['membros']),
                         sorted([oda.conta['id'], bueno.conta['id']]))
        self.assertIsNone(bueno.pede('GET', '/api/guilda/minha')[1].get('antiga'))

        # o jogo lista as guildas do servidor
        nomes_jogo = sorted(g['nome'] for g in oda.pede('GET', '/api/guilda/lista')[1]['guildas'])
        self.assertEqual(nomes_jogo, ['Guarda W', 'Tomada Z', 'Velha X'])

        # o site: as guildas do servidor; a só da equipe fica fora (regra de 10/09); nome só de save não
        s, r = Cliente(self.base).pede('GET', '/api/ranking', token=None)
        self.assertEqual(s, 200, r)
        por_nome = {g['nome']: g for g in r['guildas']}
        self.assertEqual(sorted(por_nome), ['Tomada Z', 'Velha X'])
        self.assertEqual(por_nome['Velha X']['membros'], 2)
        self.assertEqual(por_nome['Velha X']['xpTotal'], 1168)
        self.assertNotIn('Nome Livre Y', por_nome)


if __name__ == '__main__':
    unittest.main(verbosity=2)
