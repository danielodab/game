#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova da guilda no servidor (servidor/guilda.py), pela API de verdade.

    python tests/guilda_api.py

Sobe servidor/api.py num subprocesso (banco descartável numa pasta
temporária) e faz o que o jogo faria com várias contas: fundar e ler, a lei
dos nomes, o CONVITE entre contas (11/09: antes a guilda morava em cada
navegador, e o "aceitar" do convidado não levava a lugar nenhum), a porta e a
fila de pedidos, os cargos, o dízimo, a oferenda, o treino, o cofre e o bônus,
o banco (depósito, empréstimo, devolução e retirada) com a série GUARDADA sem
ser varrida pelo save do dono, e as regras de sair. As contas são sintéticas.
"""
import json
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
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402  (põe servidor/ no sys.path)
import guilda as guilda_mod  # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


class ProvaDaGuilda(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.mkdtemp(prefix='soterra-guilda-')
        cls.porta = porta_livre()
        cls.base = 'http://127.0.0.1:%d' % cls.porta
        cls.banco_arq = os.path.join(cls.pasta, 'dados', 'soterra.db')
        cls.log = open(os.path.join(cls.pasta, 'api.log'), 'w', encoding='utf-8')
        env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
        cls.proc = subprocess.Popen([sys.executable, API, '--porta', str(cls.porta), '--banco', cls.banco_arq],
                                    stdout=cls.log, stderr=subprocess.STDOUT, env=env)
        if not espera_api(cls.base, cls.proc):
            cls.tearDownClass()
            raise RuntimeError('a API não subiu; veja o log em ' + cls.pasta)

    @classmethod
    def tearDownClass(cls):
        if cls.proc.poll() is None:
            cls.proc.terminate()
            try:
                cls.proc.wait(5)
            except subprocess.TimeoutExpired:
                cls.proc.kill()
        cls.log.close()
        shutil.rmtree(cls.pasta, ignore_errors=True)

    # -- ajudantes ------------------------------------------------------------------
    def novo(self, apelido):
        ProvaDaGuilda._n += 1
        c = Cliente(self.base)
        status, r = c.cadastra('%s %d' % (apelido, ProvaDaGuilda._n))
        self.assertEqual(status, 201, r)
        return c

    def nome(self, base):
        ProvaDaGuilda._n += 1
        return '%s %d' % (base, ProvaDaGuilda._n)

    def sql(self, consulta, *args):
        b = sqlite3.connect(self.banco_arq)
        b.row_factory = sqlite3.Row
        try:
            linhas = b.execute(consulta, args).fetchall()
            b.commit()
            return linhas
        finally:
            b.close()

    def g(self, c, rota, corpo=None, esperado=200):
        status, r = c.pede('GET' if corpo is None else 'POST', '/api/guilda/' + rota, corpo)
        self.assertEqual(status, esperado, (rota, corpo, r))
        return r

    def funda(self, c, porta='aberta'):
        f = self.g(c, 'criar', {'nome': self.nome('Guilda'), 'emblema': '⚔'})['guilda']
        if porta != 'aberta':
            self.g(c, 'porta', {'modo': porta})
        return f['id']

    def salva(self, c, iids):
        """O save do jogo com estas peças no saco (as que ainda não nasceram, nascem)."""
        versao = c.pede('GET', '/api/save')[1]['versao']
        progress = {'version': 22, 'heroes': {}, 'inventory': [{'itemId': 'gh-wasp-sting', 'iid': i} for i in iids]}
        conhecidos = {r['iid'] for r in self.sql("SELECT iid FROM itens")}
        nasc = [{'iid': i, 'itemId': 'gh-wasp-sting', 'origem': 'saque'} for i in iids if i not in conhecidos]
        status, r = c.salva(versao, progress, {'versao': 1, 'jogador': {'nome': None}}, nasc)
        self.assertEqual(status, 200, r)
        return r

    def estado(self, iid):
        r = self.sql("SELECT estado FROM itens WHERE iid = ?", iid)
        return r[0]['estado'] if r else None

    def orfas_da_guilda(self, gid):
        """Toda linha que ainda cita a guilda `gid`, lida do próprio banco (sqlite_master): as chaves
        estrangeiras que apontam para guildas e toda coluna chamada guilda_id — uma tabela nova da
        guilda que a faxina esquecer aparece aqui sozinha. {tabela.coluna: quantas}."""
        achados = {}
        con = sqlite3.connect(self.banco_arq, timeout=10)
        try:
            for (t,) in con.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").fetchall():
                colunas = {r[3] for r in con.execute('PRAGMA foreign_key_list("%s")' % t) if r[2] == 'guildas'}
                colunas |= {r[1] for r in con.execute('PRAGMA table_info("%s")' % t) if r[1] == 'guilda_id'}
                if t == 'guildas':
                    colunas.add('id')
                for col in colunas:
                    n = con.execute('SELECT COUNT(*) FROM "%s" WHERE "%s" = ?' % (t, col), (gid,)).fetchone()[0]
                    if n:
                        achados['%s.%s' % (t, col)] = n
        finally:
            con.close()
        return achados

    # -- as provas ------------------------------------------------------------------
    def test_01_fundar_ler_e_a_lei_dos_nomes(self):
        a, b = self.novo('Ana'), self.novo('Bia')
        self.assertIsNone(self.g(a, 'minha')['guilda'], 'sem guilda, a ficha é null')
        nome = self.nome('Os Soterrados')
        f = self.g(a, 'criar', {'nome': '  ' + nome + '  ', 'emblema': '⚔'})['guilda']
        self.assertEqual(f['nome'], nome)
        self.assertEqual(f['emblema'], '⚔')
        self.assertTrue(f['souLider'])
        self.assertEqual(f['meuCargo'], 'lider')
        self.assertEqual(f['porta'], 'aberta')
        self.assertEqual(f['nivel'], 1)
        self.assertEqual(f['eu'], a.conta['id'])
        self.assertEqual([m['cargo'] for m in f['membros']], ['lider'])
        self.assertEqual(self.g(a, 'minha')['guilda']['id'], f['id'])
        self.g(b, 'criar', {'nome': nome.upper()}, 409)          # o nome é único, sem caixa
        self.g(a, 'criar', {'nome': self.nome('Outra')}, 409)    # uma guilda por conta
        self.g(b, 'criar', {'nome': '   '}, 400)
        r = self.g(b, 'criar', {'nome': 'Admin'}, 400)          # a lei dos nomes: ninguém veste a equipe
        self.assertEqual(r['erro'], guilda_mod.NOME_RESERVADO)
        m = self.novo('Mestre')
        self.sql("UPDATE contas SET gm = 1 WHERE id = ?", m.conta['id'])
        self.g(m, 'criar', {'nome': 'Equipe Admin'})              # o Mestre passa: o título é dele
        lista = self.g(b, 'lista')['guildas']
        minha = [x for x in lista if x['id'] == f['id']]
        self.assertEqual(len(minha), 1)
        self.assertEqual((minha[0]['membros'], minha[0]['porta'], minha[0]['nivel']), (1, 'aberta', 1))
        status, _ = Cliente(self.base).pede('GET', '/api/guilda/minha')
        self.assertEqual(status, 401, 'sem conta, nada de guilda')

    def test_01b_a_guilda_da_equipe_nao_sai_em_lista_nem_em_ranking(self):
        """04/10 (dono: "guild staff não deve aparecer nem na lista de guild.. só o adm possui"): a guilda
        que um Mestre lidera some da lista e do ranking de quem não é da equipe, ninguém entra nela por
        conta própria, e o Mestre segue vendo e usando a dele."""
        m, j, k = self.novo('Zelador'), self.novo('Curioso'), self.novo('Chamado')
        self.sql("UPDATE contas SET gm = 1 WHERE id = ?", m.conta['id'])
        staff = self.g(m, 'criar', {'nome': 'Staff'})['guilda']
        comum = self.funda(j)
        vista = [x['id'] for x in self.g(j, 'lista')['guildas']]
        self.assertNotIn(staff['id'], vista, 'a lista do jogador não traz a guilda da equipe')
        self.assertIn(comum, vista)
        self.assertIn(staff['id'], [x['id'] for x in self.g(m, 'lista')['guildas']], 'o Mestre vê a dele')
        self.assertEqual(self.g(m, 'minha')['guilda']['id'], staff['id'])
        self.g(m, 'mural', {'texto': 'só a equipe'})                # e usa normalmente
        # por conta própria ninguém entra: o mesmo 404 da guilda que não existe
        r = self.g(k, 'entrar', {'gid': staff['id']}, 404)
        self.assertEqual(r['erro'], 'essa guilda não existe mais')
        self.g(k, 'pedir', {'gid': staff['id']}, 404)
        # com o convite do Mestre entra — e mesmo com jogador comum dentro ela segue fora da vitrine
        self.g(m, 'convidar', {'conta': k.conta['id']})
        self.g(k, 'entrar', {'gid': staff['id']})
        self.assertNotIn(staff['id'], [x['id'] for x in self.g(j, 'lista')['guildas']])
        self.sql("UPDATE contas SET gm = gm WHERE id = ?", m.conta['id'])   # outra conexão gravou: o ranking guardado cai
        status, rk = j.pede('GET', '/api/ranking')
        self.assertEqual(status, 200, rk)
        nomes_rk = [x['nome'] for x in rk['guildas']]
        self.assertNotIn('Staff', nomes_rk, 'o ranking público não traz a guilda da equipe')
        self.assertTrue(any(x.startswith('Guilda ') for x in nomes_rk), nomes_rk)

    def test_01c_o_membro_comum_da_guilda_da_equipe_ve_a_propria_guilda(self):
        """04/10 (dono: "a da minha conta teste sumiu"): a guilda que um Mestre lidera fica fora da lista
        de quem não é dela — mas quem ENTROU (pelo convite do Mestre) continua vendo a própria guilda na
        ficha e no ranking da ficha. Escondê-la do membro fazia a guilda parecer ter sumido."""
        m, k, j = self.novo('Zelador'), self.novo('Convidado'), self.novo('De Fora')
        self.sql("UPDATE contas SET gm = 1 WHERE id = ?", m.conta['id'])
        gid = self.g(m, 'criar', {'nome': self.nome('Equipe')})['guilda']['id']
        self.g(m, 'convidar', {'conta': k.conta['id']})
        self.g(k, 'entrar', {'gid': gid})
        self.assertEqual(self.g(k, 'minha')['guilda']['id'], gid, 'a ficha do membro comum segue lá')
        self.assertIn(gid, [x['id'] for x in self.g(k, 'lista')['guildas']], 'e ele vê a própria guilda no ranking')
        self.assertNotIn(gid, [x['id'] for x in self.g(j, 'lista')['guildas']], 'quem é de fora continua sem ver')

    def test_02_o_convite_entre_contas_abre_a_porta_fechada(self):
        """O defeito do ar (11/09): "eu convidei, o usuário aceitou, mas não foi"."""
        a, b, c = self.novo('Lider'), self.novo('Convidada'), self.novo('Curioso')
        gid = self.funda(a, porta='convite')
        self.g(b, 'entrar', {'gid': gid}, 403)                    # sem convite a porta fechada recusa
        self.g(a, 'convidar', {'conta': b.conta['id']})           # o líder convida a CONTA
        r = self.g(b, 'entrar', {'gid': gid})
        self.assertTrue(r['entrou'])
        self.assertEqual(r['guilda']['meuCargo'], 'membro')
        self.assertEqual(len(r['guilda']['membros']), 2)
        f = self.g(a, 'minha')['guilda']
        self.assertEqual(sorted(m['id'] for m in f['membros']), sorted([a.conta['id'], b.conta['id']]))
        self.g(b, 'convidar', {'conta': c.conta['id']}, 403)      # membro raso não convida
        self.g(a, 'convidar', {'conta': b.conta['id']}, 409)      # quem já tem guilda
        self.g(a, 'convidar', {'conta': a.conta['id']}, 400)
        self.g(a, 'convidar', {'conta': 999999}, 404)
        self.g(c, 'entrar', {'gid': gid}, 403)                    # o convite é da conta, não da guilda inteira
        self.g(c, 'entrar', {'gid': 999999}, 404)

    def test_03_a_fila_de_pedidos(self):
        a, c, d = self.novo('Chefe'), self.novo('Pede'), self.novo('Outro')
        gid = self.funda(a, porta='convite')
        r = self.g(c, 'pedir', {'gid': gid})
        self.assertEqual((r['entrou'], r['pedidoFeito']), (False, True))
        self.g(c, 'pedir', {'gid': gid}, 409)                     # o pedido já está na fila
        self.g(d, 'pedir', {'gid': gid})
        f = self.g(a, 'minha')['guilda']
        self.assertEqual(sorted(p['id'] for p in f['pedidos']), sorted([c.conta['id'], d.conta['id']]))
        r = self.g(a, 'pedido', {'conta': c.conta['id'], 'aceitar': True})
        self.assertEqual(r['membro']['id'], c.conta['id'])
        self.g(a, 'pedido', {'conta': d.conta['id'], 'aceitar': False})
        self.assertIsNone(self.g(d, 'minha')['guilda'])
        self.g(a, 'pedido', {'conta': d.conta['id'], 'aceitar': True}, 404)   # já saiu da fila
        e = self.novo('Porta Aberta')
        gid2 = self.funda(e)
        r = self.g(d, 'pedir', {'gid': gid2})                     # porta aberta: pedir é entrar
        self.assertTrue(r['entrou'])

    def test_04_cargos_porta_e_dizimo(self):
        a, b, c = self.novo('Rei'), self.novo('Braco'), self.novo('Novo')
        gid = self.funda(a)
        self.g(b, 'entrar', {'gid': gid})
        self.g(b, 'porta', {'modo': 'convite'}, 403)               # só o líder mexe na porta
        self.g(a, 'porta', {'modo': 'trancada'}, 400)
        r = self.g(a, 'cargo', {'conta': b.conta['id'], 'cargo': 'oficial'})
        self.assertEqual(r['cargo'], 'oficial')
        self.g(a, 'cargo', {'conta': b.conta['id'], 'cargo': 'oficial'}, 409)
        self.g(b, 'cargo', {'conta': a.conta['id'], 'cargo': 'membro'}, 403)
        self.g(a, 'porta', {'modo': 'convite'})
        self.g(b, 'convidar', {'conta': c.conta['id']})            # o oficial convida
        self.g(c, 'entrar', {'gid': gid})
        self.assertEqual(self.g(c, 'minha')['guilda']['meuCargo'], 'membro')
        self.g(a, 'cargo', {'conta': b.conta['id'], 'cargo': 'membro'})
        self.g(a, 'dizimo', {'pct': 10})
        self.assertEqual(self.g(c, 'minha')['guilda']['dizimo'], 10)
        self.g(a, 'dizimo', {'pct': guilda_mod.DIZIMO_MAX + 1}, 400)
        self.g(c, 'dizimo', {'pct': 5}, 403)

    def test_05_oferenda_treino_cofre_e_bonus(self):
        a, b = self.novo('Caixa'), self.novo('Soldado')
        gid = self.funda(a)
        self.g(b, 'entrar', {'gid': gid})
        # 04/10 (dono: "dinheiro não dará mais XP para guild"): a doação sem a origem do dízimo — a oferenda
        # em vinténs de antes — é recusada e não soma nada; o dízimo segue entrando
        r = self.g(b, 'doar', {'xp': 100}, 403)
        self.assertEqual(r['erro'], guilda_mod.SEM_OFERENDA)
        self.g(b, 'doar', {'xp': 100, 'origem': 'oferenda'}, 403)
        self.assertEqual(self.g(a, 'minha')['guilda']['xp'], 0, 'a doação recusada não rende XP')
        r = self.g(b, 'doar', {'xp': 100, 'origem': 'dizimo'})
        self.assertEqual((r['xp'], r['nivel']), (100, guilda_mod.nivel_de(100)))
        self.g(b, 'doar', {'xp': 0, 'origem': 'dizimo'}, 400)
        self.g(self.novo('Sem Guilda'), 'doar', {'xp': 5, 'origem': 'dizimo'}, 409)
        r1 = self.g(b, 'treino', {})
        r2 = self.g(b, 'treino', {})
        self.assertTrue(r1['pago'])
        self.assertFalse(r2['pago'], 'dois treinos em seguida: só um paga')
        f = self.g(a, 'minha')['guilda']
        self.assertEqual((f['xp'], f['moedas'], f['treinos']), (100 + guilda_mod.XP_TREINO, guilda_mod.MOEDA_TREINO, 1))
        self.g(a, 'bonus', {'tipo': 'xp'}, 409)                    # cofre insuficiente
        self.sql("UPDATE guildas SET moedas = ? WHERE id = ?", guilda_mod.CUSTO_BONUS + 5, gid)
        self.g(b, 'bonus', {'tipo': 'xp'}, 403)                    # membro raso não gasta o cofre
        antes = int(time.time() * 1000)
        r = self.g(a, 'bonus', {'tipo': 'xp'})
        self.assertEqual(r['moedas'], 5)
        self.assertTrue(antes + (guilda_mod.BONUS_S - 5) * 1000 <= r['ate'] <= antes + (guilda_mod.BONUS_S + 5) * 1000)
        self.assertEqual(self.g(b, 'minha')['guilda']['bonus']['xp'], r['ate'], 'o bônus vale para todo membro')
        self.g(a, 'bonus', {'tipo': 'ouro'}, 400)

    def test_05b_grade_dizimo_de_cada_um_e_mensagem(self):
        """13/09: a grade vem ordenada por cargo e XP doado; o líder define o dízimo de cada
        membro (e o padrão, e o 'aplicar a todos'); líder e oficiais escrevem a mensagem."""
        a, b, c = self.novo('Chefe'), self.novo('Doador'), self.novo('Calado')
        gid = self.funda(a)
        self.g(b, 'entrar', {'gid': gid})
        self.g(c, 'entrar', {'gid': gid})
        self.g(a, 'cargo', {'conta': c.conta['id'], 'cargo': 'oficial'})
        self.g(b, 'doar', {'xp': 40, 'origem': 'dizimo'})
        self.g(a, 'dizimo', {'pct': 10})
        r = self.g(a, 'dizimo', {'pct': 20, 'conta': b.conta['id']})
        ms = {m['id']: m for m in r['guilda']['membros']}
        self.assertEqual((ms[b.conta['id']]['dizimo'], ms[b.conta['id']]['dizimoProprio']), (20, True))
        self.assertEqual((ms[c.conta['id']]['dizimo'], ms[c.conta['id']]['dizimoProprio']), (10, False))
        self.assertEqual((ms[b.conta['id']]['xpDoado'], ms[c.conta['id']]['xpDoado']), (40, 0))
        self.assertEqual([m['cargo'] for m in r['guilda']['membros']], ['lider', 'oficial', 'membro'],
                         'o cargo vem antes do XP doado')
        self.g(c, 'dizimo', {'pct': 5, 'conta': b.conta['id']}, 403)          # oficial não mexe no dízimo
        self.g(a, 'dizimo', {'pct': 5, 'conta': self.novo('Fora').conta['id']}, 404)
        self.g(a, 'dizimo', {'pct': guilda_mod.DIZIMO_MAX + 1, 'conta': b.conta['id']}, 400)
        r = self.g(a, 'dizimo', {'pct': None, 'conta': b.conta['id']})       # volta ao padrão
        ms = {m['id']: m for m in r['guilda']['membros']}
        self.assertEqual((ms[b.conta['id']]['dizimo'], ms[b.conta['id']]['dizimoProprio']), (10, False))
        self.g(a, 'dizimo', {'pct': 15, 'conta': b.conta['id']})
        r = self.g(a, 'dizimo', {'pct': 8, 'todos': True})
        self.assertTrue(all(m['dizimo'] == 8 and not m['dizimoProprio'] for m in r['guilda']['membros']))
        # o contexto do juiz lê o dízimo próprio
        self.g(a, 'dizimo', {'pct': 22, 'conta': b.conta['id']})
        self.assertEqual(self.sql("SELECT pct FROM guilda_dizimo_membro WHERE conta_id = ?", b.conta['id'])[0]['pct'], 22)
        # a mensagem
        self.g(b, 'mural', {'texto': 'oi'}, 403)                                # membro raso só lê
        self.g(c, 'mural', {'texto': '  Bem-vindos!\r\nDízimo de 8%.\x07  '})
        mu = self.g(b, 'minha')['guilda']['mural']
        self.assertEqual(mu['texto'], 'Bem-vindos!\nDízimo de 8%.')
        self.assertTrue(mu['autorNome'])
        self.g(a, 'mural', {'texto': 'x' * (guilda_mod.MURAL_MAX + 50)})
        self.assertEqual(len(self.g(b, 'minha')['guilda']['mural']['texto']), guilda_mod.MURAL_MAX)
        self.g(a, 'mural', {'texto': 5}, 400)
        self.g(a, 'mural', {'texto': '   '})
        self.assertIsNone(self.g(b, 'minha')['guilda']['mural'], 'texto vazio apaga')
        # quem sai leva o dízimo próprio embora
        self.g(b, 'sair', {})
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM guilda_dizimo_membro WHERE conta_id = ?", b.conta['id'])[0]['n'], 0)

    def test_06_o_banco_guarda_a_serie_sem_varrer(self):
        a, b = self.novo('Dona'), self.novo('Tomador')
        gid = self.funda(a)
        self.g(b, 'entrar', {'gid': gid})
        iid = 'jguild%d' % ProvaDaGuilda._n
        self.salva(a, [iid])
        self.assertEqual(self.estado(iid), 'vivo')
        self.g(a, 'banco/depositar', {'item': {'itemId': 'gh-wasp-sting', 'iid': 'jnaoexiste'}}, 409)
        self.g(b, 'banco/depositar', {'item': {'itemId': 'gh-wasp-sting', 'iid': iid}}, 409)   # a série não é dela
        r = self.g(a, 'banco/depositar', {'item': {'itemId': 'gh-wasp-sting', 'level': 2, 'stars': 1, 'iid': iid}})
        vaga = r['guilda']['banco'][0]
        self.assertEqual((vaga['iid'], vaga['dono'], vaga['level'], vaga['stars']), (iid, a.conta['id'], 2, 1))
        self.g(a, 'banco/depositar', {'item': {'itemId': 'gh-wasp-sting', 'iid': iid}}, 409)   # já está no banco
        self.salva(a, [])                                           # a peça saiu do saco da dona...
        self.assertEqual(self.estado(iid), 'vivo', '...e o save NÃO a varre: está guardada no banco da guilda')
        r = self.g(b, 'banco/pegar', {'id': vaga['id']})
        self.assertFalse(r['definitivo'])
        self.assertEqual(r['guilda']['banco'][0]['emprestadoPara'], b.conta['id'])
        self.g(a, 'banco/pegar', {'id': vaga['id']}, 409)          # emprestada: nem a dona tira
        self.g(b, 'sair', {}, 409)                                  # com empréstimo ativo não sai
        self.g(a, 'banco/devolver', {'id': vaga['id']}, 409)       # não foi ela que pegou
        self.g(b, 'banco/devolver', {'id': vaga['id']})
        self.g(a, 'sair', {}, 409)                                  # com peça sua no banco não sai
        r = self.g(a, 'banco/pegar', {'id': vaga['id']})
        self.assertTrue(r['definitivo'])
        self.assertEqual(r['item']['iid'], iid, 'a dona retira de vez a MESMA série')
        self.assertEqual(r['guilda']['banco'], [])
        self.salva(a, [iid])                                        # volta ao saco: o cartório aceita
        self.salva(a, [])
        self.assertEqual(self.estado(iid), 'fora', 'fora do banco, a varredura volta a valer')
        self.g(a, 'banco/pegar', {'id': vaga['id']}, 404)

    def test_06b_o_emprestimo_volta_sozinho_depois_de_3_dias(self):
        """04/10 (dono: "caso o usuário ... fique mais de 3 dias sem entrar, a peça volta
        automaticamente para o cofre da guilda"). A data do último acesso é mexida no banco."""
        a, b = self.novo('Dona Prazo'), self.novo('Sumido')
        gid = self.funda(a)
        self.g(b, 'entrar', {'gid': gid})
        iid = 'jprazo%d' % ProvaDaGuilda._n
        self.salva(a, [iid])
        vaga = self.g(a, 'banco/depositar', {'item': {'itemId': 'gh-wasp-sting', 'level': 1, 'iid': iid}})['guilda']['banco'][0]
        self.g(b, 'banco/pegar', {'id': vaga['id']})
        bid, dia = b.conta['id'], 86400
        self.assertEqual(guilda_mod.EMPRESTIMO_AUSENCIA_DIAS, 3)
        visto = self.sql("SELECT em FROM contas_visto WHERE conta_id = ?", bid)
        self.assertEqual(len(visto), 1, 'pegar emprestado marca a presença: o prazo parte dali')
        # menos de 3 dias: nada volta
        self.sql("UPDATE contas_visto SET em = em - ? WHERE conta_id = ?", 3 * dia - 600, bid)
        f = self.g(a, 'minha')
        self.assertEqual(f['guilda']['banco'][0]['emprestadoPara'], bid, 'antes do prazo o empréstimo segue')
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM guilda_avisos WHERE conta_id = ?", bid)[0]['n'], 0)
        # mais de 3 dias: abrir o banco devolve — a dona vê a peça livre, uma só, e ainda dela
        self.sql("UPDATE contas_visto SET em = em - ? WHERE conta_id = ?", 1200, bid)
        f = self.g(a, 'minha')
        self.assertEqual([(v['iid'], v['dono'], v['emprestadoPara']) for v in f['guilda']['banco']],
                         [(iid, a.conta['id'], None)])
        self.assertEqual(self.estado(iid), 'vivo')
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM guilda_banco WHERE iid = ?", iid)[0]['n'], 1, 'não duplica')
        # quem pegou volta: o recado diz o porquê, repete até ser confirmado e depois some
        r = self.g(b, 'minha')
        self.assertEqual([(x['itemId'], x['level'], x['motivo'], x['dias']) for x in r['avisos']],
                         [('gh-wasp-sting', 1, 'ausencia', 3)])
        self.assertEqual(len(self.g(b, 'minha')['avisos']), 1, 'sem confirmar, o recado volta')
        self.g(b, 'avisos/visto', {'ate': r['avisos'][0]['id']})
        self.assertEqual(self.g(b, 'minha')['avisos'], [])
        self.assertEqual(self.g(a, 'minha')['avisos'], [], 'o recado é só de quem perdeu o empréstimo')
        self.g(b, 'banco/devolver', {'id': vaga['id']}, 409)       # já voltou: não há o que devolver
        self.g(b, 'sair', {})                                       # e nada mais o prende à guilda
        # a peça ficou livre de verdade: a dona retira de vez a MESMA série
        r = self.g(a, 'banco/pegar', {'id': vaga['id']})
        self.assertEqual((r['definitivo'], r['item']['iid']), (True, iid))

    def test_06c_o_passo_periodico_recolhe_sem_ninguem_abrir_o_banco(self):
        import api as cartorio
        pasta = tempfile.mkdtemp(prefix='soterra-guilda-passo-')
        try:
            srv = cartorio.Api(os.path.join(pasta, 'soterra.db'))
            t = int(time.time())
            for cid in (1, 2):
                srv.con.execute("INSERT INTO contas(id, nome, email, senha_hash, sal, criado_em) VALUES (?, ?, ?, '!', '!', ?)",
                                (cid, 'Passo %d' % cid, 'passo%d@soterra.test' % cid, t))
            srv.con.execute("INSERT INTO guildas(id, nome, emblema, lider_id, criada_em) VALUES (1, 'Do Passo', 'x', 1, ?)", (t,))
            srv.con.executemany("INSERT INTO guilda_membros(guilda_id, conta_id, cargo, entrou_em) VALUES (1, ?, 'membro', ?)",
                                [(1, t), (2, t)])
            srv.con.execute("INSERT INTO guilda_banco(id, guilda_id, item_id, iid, dono_id, emprestado_para, em) "
                            "VALUES (1, 1, 'gh-wasp-sting', NULL, 1, 2, ?)", (t,))
            srv.con.commit()
            emprestada = lambda: srv.con.execute("SELECT emprestado_para FROM guilda_banco WHERE id = 1").fetchone()[0]
            # o empréstimo de antes da regra não tem data: o primeiro passo só começa a contar o prazo
            srv._g_recolhe_em = 0
            srv._g_passo_emprestimos()
            self.assertEqual(emprestada(), 2)
            self.assertIsNotNone(srv.con.execute("SELECT em FROM contas_visto WHERE conta_id = 2").fetchone())
            srv.con.execute("UPDATE contas_visto SET em = em - ? WHERE conta_id = 2",
                            (guilda_mod.EMPRESTIMO_AUSENCIA_S + 5,))
            srv.con.commit()
            srv._g_passo_emprestimos()
            self.assertEqual(emprestada(), 2, 'no máximo uma vez por hora: o passo de agora há pouco não repete')
            srv._g_recolhe_em = 0
            srv._g_passo_emprestimos()
            self.assertIsNone(emprestada(), 'vencido o prazo, o passo devolve sem ninguém abrir o banco')
            self.assertEqual(srv.con.execute("SELECT motivo FROM guilda_avisos WHERE conta_id = 2").fetchone()[0], 'ausencia')
            srv.con.close()
        finally:
            shutil.rmtree(pasta, ignore_errors=True)

    def test_07_sair_heranca_e_dissolucao(self):
        a, b = self.novo('Fundadora'), self.novo('Herdeira')
        gid = self.funda(a)
        self.g(b, 'entrar', {'gid': gid})
        r = self.g(a, 'sair', {})
        self.assertFalse(r['dissolveu'])
        f = self.g(b, 'minha')['guilda']
        self.assertTrue(f['souLider'], 'o membro mais antigo herda a liderança')
        self.assertIsNone(self.g(a, 'minha')['guilda'])
        r = self.g(b, 'sair', {})
        self.assertTrue(r['dissolveu'], 'o último apaga a luz')
        self.assertFalse(any(x['id'] == gid for x in self.g(a, 'lista')['guildas']))
        self.g(b, 'sair', {}, 409)


    def test_07b_os_pergaminhos_da_loja_rebatizam_e_trocam_o_brasao(self):
        """08/10 à noite: Pergaminho do Novo Nome e Pergaminho do Brasão — pedidos 'entregue' da loja do
        site; só o líder gasta, um pedido por troca; sem pergaminho, recusa com o caminho da loja."""
        lider, membro = self.novo('Lider'), self.novo('Membro')
        gid = self.funda(lider)
        self.g(membro, 'entrar', {'gid': gid})
        ficha = self.g(lider, 'minha')['guilda']
        self.assertEqual(ficha['pergaminhos'], {'nome': 0, 'brasao': 0})
        r = self.g(lider, 'renomear', {'nome': self.nome('Outra')}, 409)
        self.assertIn('loja do site', r['erro'])
        # dois pedidos entregues (o que a compra no site cria), um de cada
        cid = self.sql("SELECT id FROM contas ORDER BY id DESC LIMIT 2")[1]['id']
        for sku, ent in (('pergaminho-guilda-nome', {'tipo': 'guilda', 'alvo': 'nome', 'qtd': 1}),
                         ('pergaminho-guilda-brasao', {'tipo': 'guilda', 'alvo': 'brasao', 'qtd': 1})):
            self.sql("INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, idem, criado_em, fechado_em) "
                     "VALUES (?, ?, ?, ?, 'entregue', ?, 1, 1)", cid, sku, json.dumps(ent), 1, 'p-' + sku + str(cid))
        self.assertEqual(self.g(lider, 'minha')['guilda']['pergaminhos'], {'nome': 1, 'brasao': 1})
        # o membro não gasta o do líder nem o dele (não é líder)
        self.g(membro, 'renomear', {'nome': self.nome('Outra')}, 403)
        # a lei dos nomes e o nome repetido
        self.g(lider, 'renomear', {'nome': 'STAFF'}, 400)
        self.g(lider, 'renomear', {'nome': ficha['nome']}, 409)
        outro = self.novo('Outro')
        nome_do_outro = self.g(outro, 'criar', {'nome': self.nome('Guilda'), 'emblema': '⚔'})['guilda']['nome']
        self.g(lider, 'renomear', {'nome': nome_do_outro.upper()}, 409)
        self.assertEqual(self.g(lider, 'minha')['guilda']['pergaminhos']['nome'], 1, 'recusa não gasta')
        novo = self.nome('Rebatizada')
        r = self.g(lider, 'renomear', {'nome': novo})
        self.assertEqual((r['guilda']['nome'], r['guilda']['pergaminhos']), (novo, {'nome': 0, 'brasao': 1}))
        self.assertEqual(self.g(membro, 'minha')['guilda']['nome'], novo)
        self.g(lider, 'renomear', {'nome': self.nome('DeNovo')}, 409)           # gasto: sem pergaminho
        r = self.g(lider, 'brasao', {'emblema': 'v1|a|#112233|#445566|#778899|b|c'})
        self.assertEqual((r['guilda']['emblema'], r['guilda']['pergaminhos']), ('v1|a|#112233|#445566|#778899|b|c', {'nome': 0, 'brasao': 0}))
        self.g(lider, 'brasao', {'emblema': '⚑'}, 409)
        usados = self.sql("SELECT tipo, onde, antes FROM guilda_pergaminhos_usados ORDER BY id")
        self.assertEqual([(u['tipo'], u['onde']) for u in usados], [('nome', gid), ('brasao', gid)])
        self.assertEqual(usados[0]['antes'], ficha['nome'])
        # a guilda desfeita não devolve o pergaminho gasto (a tabela não cita a guilda por chave)
        self.g(lider, 'sair', {})
        self.g(membro, 'sair', {})
        self.assertEqual(self.orfas_da_guilda(gid), {})
        self.assertEqual(len(self.sql("SELECT id FROM guilda_pergaminhos_usados")), 2)

    def test_08_o_mestre_desfaz_a_guilda_inteira(self):
        """04/10 (dono: "exclua a guilda Game Over do jogo.. vou refazer para sair os bugs"). Só o Mestre;
        pede o nome digitado; o empréstimo é recolhido, as peças do banco voltam ao dono sem a série ser
        varrida, nada da guilda fica no banco (lido do sqlite_master), cada membro recebe a carta, o nome
        fica livre e repetir não quebra. Aqui SEM o juiz: quem põe a peça no saco é o jogo do dono."""
        m, a, b, c, d = (self.novo('Zelador'), self.novo('Dona'), self.novo('Tomador'), self.novo('Na Fila'),
                         self.novo('Convidado'))
        self.sql("UPDATE contas SET gm = 1 WHERE id = ?", m.conta['id'])
        nome = self.nome('Game Over')
        gid = self.g(a, 'criar', {'nome': nome, 'emblema': '⚔'})['guilda']['id']
        self.g(b, 'entrar', {'gid': gid})
        self.g(a, 'porta', {'modo': 'convite'})
        self.g(c, 'pedir', {'gid': gid})
        self.g(a, 'convidar', {'conta': d.conta['id']})
        self.g(a, 'mural', {'texto': 'adeus'})
        self.g(a, 'dizimo', {'pct': 5, 'conta': b.conta['id']})
        self.g(b, 'treino', {})
        self.sql("INSERT INTO guerra_inscricoes(lider_id, parceiro_id, guilda_id, lider_herois, lider_dono, criada_ms, "
                 "lider_visto_ms) VALUES (?, ?, ?, '[]', '{}', 1, 1)", a.conta['id'], b.conta['id'], gid)
        i1, i2 = 'jdesf%da' % ProvaDaGuilda._n, 'jdesf%db' % ProvaDaGuilda._n
        self.salva(a, [i1, i2])
        for i in (i1, i2):
            r = self.g(a, 'banco/depositar', {'item': {'itemId': 'gh-wasp-sting', 'level': 3, 'stars': 1, 'iid': i}})
        vagas = {v['iid']: v['id'] for v in r['guilda']['banco']}
        self.salva(a, [])
        self.g(b, 'banco/pegar', {'id': vagas[i1]})
        self.assertTrue(self.orfas_da_guilda(gid), 'a prova das órfãs enxerga a guilda viva')
        # o portão: só o Mestre vê a lista inteira e desfaz
        corpo = {'gid': gid, 'nome': nome}
        self.assertEqual(Cliente(self.base).pede('GET', '/api/mestre/guildas')[0], 401)
        self.assertEqual(Cliente(self.base).pede('POST', '/api/mestre/guilda/desfazer', corpo)[0], 401)
        self.assertEqual(a.pede('GET', '/api/mestre/guildas')[0], 403)
        self.assertEqual(a.pede('POST', '/api/mestre/guilda/desfazer', corpo)[0], 403, 'nem a líder desfaz por aqui')
        # a lista do Mestre: todas, com líder, membros e o banco
        status, r = m.pede('GET', '/api/mestre/guildas')
        self.assertEqual(status, 200, r)
        linha = [x for x in r['guildas'] if x['id'] == gid][0]
        self.assertEqual((linha['nome'], linha['lider']['id'], linha['totalMembros'], linha['pecas'], linha['emprestadas'],
                          linha['daEquipe']), (nome, a.conta['id'], 2, 2, 1, False))
        self.assertEqual(sorted(x['id'] for x in linha['membros']), sorted([a.conta['id'], b.conta['id']]))
        # a confirmação: o nome digitado tem de ser o da guilda
        for torto in ({'gid': gid}, {'gid': gid, 'nome': 'outro nome'}, {'gid': gid, 'nome': nome.lower()},
                      {'gid': 'x', 'nome': nome}):
            status, r = m.pede('POST', '/api/mestre/guilda/desfazer', torto)
            self.assertEqual(status, 400, (torto, r))
        self.assertEqual(self.g(a, 'minha')['guilda']['id'], gid, 'nada mudou')
        # desfaz
        status, r = m.pede('POST', '/api/mestre/guilda/desfazer', corpo)
        self.assertEqual(status, 200, r)
        self.assertEqual(r['desfeita'], {'id': gid, 'nome': nome, 'membros': 2, 'pecas': 2, 'recolhidos': 1, 'entregues': 0})
        self.assertEqual(self.orfas_da_guilda(gid), {}, 'nada da guilda fica no banco')
        self.assertNotIn(gid, [x['id'] for x in m.pede('GET', '/api/mestre/guildas')[1]['guildas']])
        # quem pegou emprestado: o recado (sem o juiz é o jogo dele que tira a cópia do saco)
        rb = self.g(b, 'minha')
        self.assertIsNone(rb['guilda'])
        self.assertEqual([(x['itemId'], x['motivo']) for x in rb['avisos']], [('gh-wasp-sting', 'guilda-desfeita')])
        # a dona: as duas peças esperam por ela, com a série protegida da varredura
        ra = self.g(a, 'minha')
        self.assertIsNone(ra['guilda'])
        self.assertEqual(sorted((x['iid'], x['level'], x['stars'], x['guilda']) for x in ra['devolucoes']),
                         sorted([(i1, 3, 1, nome), (i2, 3, 1, nome)]))
        self.salva(a, [])
        self.assertEqual((self.estado(i1), self.estado(i2)), ('vivo', 'vivo'), 'esperando o dono, a série não é varrida')
        self.salva(a, [i1, i2])                                      # o jogo dela pôs as peças no saco
        ate = max(x['id'] for x in ra['devolucoes'])
        self.assertEqual(self.g(a, 'devolucoes/visto', {'ate': ate})['marcadas'], 2)
        self.assertEqual(self.g(a, 'devolucoes/visto', {'ate': ate})['marcadas'], 0, 'confirmar de novo não muda nada')
        self.assertEqual(self.g(a, 'minha')['devolucoes'], [], 'entregue: não volta a oferecer (não duplica)')
        self.salva(a, [i1, i2])
        self.assertEqual((self.estado(i1), self.estado(i2)), ('vivo', 'vivo'))
        # a carta da Equipe: só para quem era membro
        for x, tem in ((a, True), (b, True), (c, False), (d, False)):
            cartas = [k['texto'] for k in x.pede('GET', '/api/correio')[1]['cartas']]
            self.assertEqual([k.startswith(guilda_mod.FRASE_DESFEITA % nome) for k in cartas], [True] if tem else [])
        # repetir não quebra, e a auditoria leva uma linha só
        status, r = m.pede('POST', '/api/mestre/guilda/desfazer', corpo)
        self.assertEqual((status, r.get('jaDesfeita')), (200, True), r)
        linhas = [x for x in self.sql("SELECT * FROM moderacao_auditoria WHERE acao = 'guilda-desfazer'")
                  if ('"guilda": %d,' % gid) in x['dados'] and nome in x['dados']]
        self.assertEqual([(x['mestre_id'], x['alvo_id']) for x in linhas], [(m.conta['id'], a.conta['id'])])
        # o nome fica livre, e a inscrição na guerra não prende ninguém
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM guerra_inscricoes WHERE lider_id = ?", a.conta['id'])[0]['n'], 0)
        nova = self.g(c, 'criar', {'nome': nome})['guilda']
        self.assertEqual((nova['nome'], nova['xp'], len(nova['membros']), nova['banco']), (nome, 0, 1, []))


if __name__ == '__main__':
    unittest.main(verbosity=2)
