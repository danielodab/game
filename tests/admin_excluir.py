#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova do `admin excluir "NOME"` (servidor/privacidade.py, _terminal) — 25/10.

    python tests/admin_excluir.py

O dono, antes da produção: "remova todas essas contas que foram somente de teste". Sobe a API de VERDADE com um
banco descartável, cria as contas pelo cadastro de sempre e roda o comando do Terminal contra o mesmo banco, COM a
API no ar (como no Coolify):
  - acha a conta pelo nome da conta e pelo nome do RANKING (resumos.nome);
  - a conta do Mestre, o nome que não existe e o nome de duas contas não saem, e o comando diz por quê;
  - sem EXCLUIR digitado, nada sai; com EXCLUIR, sai;
  - a conta excluída vira lápide (contas_excluidas), a sessão dela morre (401) e o nome fica livre;
  - as outras contas seguem: entram e jogam como antes.
"""
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402

PRIVACIDADE = os.path.join(AQUI, '..', 'servidor', 'privacidade.py')


class ProvaDoAdminExcluir(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.mkdtemp(prefix='soterra-admin-excluir-')
        cls.banco = os.path.join(cls.pasta, 'dados', 'soterra.db')
        cls.porta = porta_livre()
        cls.base = 'http://127.0.0.1:%d' % cls.porta
        env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
        cls.log = open(os.path.join(cls.pasta, 'api.log'), 'w', encoding='utf-8')
        cls.proc = subprocess.Popen([sys.executable, API, '--porta', str(cls.porta), '--banco', cls.banco],
                                    stdout=cls.log, stderr=subprocess.STDOUT, env=env)
        if not espera_api(cls.base, cls.proc):
            raise RuntimeError('a API não subiu; veja ' + cls.pasta)
        cls.c = {}
        for nome in ('Teste Um', 'Teste Dois', 'Teste Tres', 'Real Fica', 'Chefe Fica', 'Duplo A', 'Duplo B'):
            cl = Cliente(cls.base)
            st, r = cl.cadastra(nome)
            assert r.get('ok'), (nome, r)
            cls.c[nome] = cl
        con = sqlite3.connect(cls.banco)
        con.execute("UPDATE contas SET gm = 1 WHERE nome = 'Chefe Fica'")
        # o nome do RANKING (o do jogo) diferente do da conta, e um nome de ranking repetido em duas contas
        for nome, publico in (('Teste Dois', 'Chuva'), ('Duplo A', 'Gêmeo'), ('Duplo B', 'Gêmeo')):
            cid = con.execute("SELECT id FROM contas WHERE nome = ?", (nome,)).fetchone()[0]
            con.execute("INSERT OR REPLACE INTO resumos(conta_id, nome, atualizado_em) VALUES (?, ?, 1)", (cid, publico))
        con.commit()
        con.close()

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=5)
        except Exception:
            cls.proc.kill()
        cls.log.close()
        shutil.rmtree(cls.pasta, ignore_errors=True)

    def roda(self, nomes, sim=False, entrada=''):
        cmd = [sys.executable, PRIVACIDADE, '--banco', self.banco, '--excluir'] + list(nomes) + (['--sim'] if sim else [])
        env = dict(os.environ, PYTHONIOENCODING='utf-8')
        r = subprocess.run(cmd, input=entrada, capture_output=True, text=True, encoding='utf-8', env=env, timeout=60,
                           cwd=os.path.join(AQUI, '..', 'servidor'))
        return r.returncode, r.stdout + r.stderr

    def viva(self, nome):
        con = sqlite3.connect(self.banco)
        try:
            return con.execute("SELECT id FROM contas WHERE nome = ? AND id NOT IN (SELECT conta_id FROM contas_excluidas)",
                               (nome,)).fetchone() is not None
        finally:
            con.close()

    def test_1_sem_EXCLUIR_digitado_nada_sai(self):
        code, out = self.roda(['Teste Um'], entrada='sim\n')
        self.assertEqual(code, 1, out)
        self.assertIn('nada foi apagado', out)
        self.assertTrue(self.viva('Teste Um'))

    def test_2_o_que_nao_pode_sair_nao_sai(self):
        code, out = self.roda(['Chefe Fica', 'Ninguém Aqui', 'Gêmeo'], sim=True)
        self.assertEqual(code, 1, out)
        self.assertIn('é a conta do Mestre', out)
        self.assertIn('não achei conta viva', out)
        self.assertIn('mais de uma conta tem esse nome', out)
        self.assertIn('nada a excluir', out)
        for n in ('Chefe Fica', 'Duplo A', 'Duplo B'):
            self.assertTrue(self.viva(n), n)

    def test_3_exclui_pelo_nome_da_conta_e_pelo_do_ranking(self):
        token_um = self.c['Teste Um'].token
        st, _ = Cliente(self.base).pede('GET', '/api/eu', token=token_um)
        self.assertEqual(st, 200)
        code, out = self.roda(['Teste Um', 'Chuva'], entrada='EXCLUIR\n')
        self.assertEqual(code, 0, out)
        self.assertIn('Vão ser EXCLUÍDAS', out)
        self.assertIn('(no jogo: Chuva)', out)
        self.assertEqual(out.count(': excluída'), 2, out)
        self.assertFalse(self.viva('Teste Um'))
        self.assertFalse(self.viva('Teste Dois'))
        con = sqlite3.connect(self.banco)
        excl = con.execute("SELECT COUNT(*) FROM contas_excluidas").fetchone()[0]
        con.close()
        self.assertEqual(excl, 2)
        # a sessão da conta excluída morre na API que está no ar
        st, _ = Cliente(self.base).pede('GET', '/api/eu', token=token_um)
        self.assertEqual(st, 401)
        # o nome fica livre: dá para criar outra conta com ele
        st, r = Cliente(self.base).cadastra('Teste Um', email='outro-teste-um@soterra.test')
        self.assertTrue(r.get('ok'), r)

    def test_4_as_outras_contas_seguem(self):
        self.roda(['Teste Tres'], sim=True)
        for n in ('Real Fica', 'Chefe Fica', 'Duplo A', 'Duplo B'):
            self.assertTrue(self.viva(n), n)
        st, r = Cliente(self.base).pede('POST', '/api/login', {'login': 'Real Fica', 'senha': 'segredo-bom-8'})
        self.assertEqual(st, 200, r)
        self.assertTrue(r.get('ok'), r)

    def test_5_excluir_de_novo_nao_acha(self):
        code, out = self.roda(['Teste Tres'], sim=True)
        self.assertEqual(code, 1, out)
        self.assertIn('não achei conta viva', out)


if __name__ == '__main__':
    unittest.main(verbosity=2)
