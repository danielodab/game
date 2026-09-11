#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova da loja de vinténs (servidor/loja.py), pela API de verdade.

    python tests/loja_api.py

Sobe servidor/api.py num subprocesso (banco descartável numa pasta
temporária) e faz o que o site e o jogo fariam: o save sobe com a carteira, o
site compra, o jogo retira, e o PUT do save confirma a entrega ou o estorno.
As contas são sintéticas, criadas aqui.

O que se prova: o catálogo público (sem as classes iniciais, sem o gm, sem a
Âncora), a reserva (duas compras não gastam o mesmo vintém, nem em dois
processos no mesmo banco), o idem, retirar e cancelar, a confirmação dentro do
save (e nada com versão velha), as regras de classe e de pergaminho, os
limites (7 e 30 dias, 5 abertos, 10 por hora; o liberaEm só com o grupo
cheio; o teto de 30 LINHAS por hora, em qualquer estado e para o Mestre
também), o Mestre, e que o catálogo espelha os dados do jogo
(progression.js, classes.js, items.js).
"""
import json
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402  (põe servidor/ no sys.path)
import comum  # noqa: E402
import loja as loja_mod  # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

DIA = 86400
PRECOS = {'pergaminho-xp': 1500, 'pergaminho-elemento': 5000, 'pedras-agua': 300, 'pedras-terra': 300,
          'pedras-ar': 450, 'pedras-fogo': 450, 'pedras-neutro': 450, 'classe-invocador': 8000,
          'classe-bruxo': 8000, 'classe-espadachim': 20000, 'classe-arqueiro': 25000, 'classe-minotauro': 30000}
HEROI_FOGO = {'sumo': {'classId': 'sumo', 'xp': 900, 'level': 6, 'element': 'fogo', 'elements': ['fogo']}}


def idem():
    return secrets.token_hex(8)


def save_loja(carteira=0, classes=('sumo', 'curandeiro'), cartas=None, herois=None, anotacao=None):
    progress = {'version': 22, 'unlockedClasses': list(classes), 'cards': dict(cartas or {}),
                'heroes': herois if herois is not None else dict(HEROI_FOGO), 'inventory': []}
    db = {'versao': 1, 'jogador': {'nome': None}, 'carteira': {'moedas': carteira},
          'banco': {'moedas': 99999, 'itens': []}, 'mercado': None}      # o cofre cheio não conta
    if anotacao is not None:
        db['loja'] = anotacao
    return progress, db


class ProvaDaLoja(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.mkdtemp(prefix='soterra-loja-')
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
        ProvaDaLoja._n += 1
        c = Cliente(self.base)
        status, r = c.cadastra('%s %d' % (apelido, ProvaDaLoja._n))
        self.assertEqual(status, 201, r)
        return c

    def sql(self, consulta, *args):
        b = sqlite3.connect(self.banco_arq)
        b.row_factory = sqlite3.Row
        try:
            linhas = b.execute(consulta, args).fetchall()
            b.commit()
            return linhas
        finally:
            b.close()

    def mestre(self, c):
        self.sql("UPDATE contas SET gm = 1 WHERE id = ?", c.conta['id'])

    def sobe(self, c, **kw):
        """O jogo sobe o save (na versão que o servidor tem); devolve a resposta do PUT."""
        versao = c.pede('GET', '/api/save')[1]['versao']
        status, r = c.salva(versao, *save_loja(**kw))
        self.assertEqual(status, 200, r)
        return r

    def compra(self, c, sku, chave=None):
        return c.pede('POST', '/api/loja/comprar', {'sku': sku, 'idem': chave or idem()})

    def comprou(self, c, sku):
        status, r = self.compra(c, sku)
        self.assertEqual(status, 201, (sku, r))
        return r['pedido']

    def minha(self, c):
        status, r = c.pede('GET', '/api/loja/minha')
        self.assertEqual(status, 200, r)
        return r

    def pedido(self, c, pid):
        return [p for p in self.minha(c)['pedidos'] if p['id'] == pid][0]

    # -- o catálogo ---------------------------------------------------------------------
    def test_catalogo_publico(self):
        status, r = Cliente(self.base).pede('GET', '/api/loja/catalogo', token=None)
        self.assertEqual(status, 200, r)
        self.assertEqual((r['ok'], r['versao']), (True, 1))
        itens = r['itens']
        self.assertEqual({i['sku']: i['preco'] for i in itens}, PRECOS)
        self.assertEqual([i['secao'] for i in itens], ['pergaminhos'] * 2 + ['pedras'] * 5 + ['personagens'] * 5)
        alvos = {i['alvo'] for i in itens}
        for fora in ('sumo', 'curandeiro', 'curandeira', 'gm', 'stone-anchor'):
            self.assertNotIn(fora, alvos)
        self.assertNotIn('ncora', json.dumps(itens, ensure_ascii=False))
        for i in itens:
            self.assertTrue(isinstance(i['preco'], int) and i['preco'] > 0, i)
            self.assertTrue(i['nome'] and i['descricao'], i)
            self.assertEqual(set(i['limite']), {'grupo', 'max', 'dias'})
            self.assertIn(i['tipo'], ('pergaminho', 'pedras', 'classe'))
        xp = [i for i in itens if i['sku'] == 'pergaminho-xp'][0]
        self.assertEqual(xp['limite'], {'grupo': 'pergaminho-xp', 'max': 1, 'dias': 7})
        self.assertIn('9 salas', xp['descricao'])
        pedras = [i for i in itens if i['tipo'] == 'pedras']
        self.assertTrue(all(i['qtd'] == 10 and i['limite'] == {'grupo': 'pedras', 'max': 5, 'dias': 7} for i in pedras))
        xama = [i for i in itens if i['sku'] == 'classe-invocador'][0]
        self.assertEqual((xama['nome'], xama['raridade'], xama['cartas'], xama['limite']['dias']),
                         ('Xamã', 'raro', 10, None))

    # -- comprar ------------------------------------------------------------------------
    def test_comprar_erros_basicos(self):
        self.assertEqual(Cliente(self.base).pede('POST', '/api/loja/comprar', {'sku': 'pedras-agua', 'idem': idem()})[0], 401)
        self.assertEqual(Cliente(self.base).pede('GET', '/api/loja/minha')[0], 401)
        self.assertEqual(Cliente(self.base).pede('POST', '/api/loja/retirar', {})[0], 401)
        c = self.novo('Erro Basico')
        for corpo, erro in (({'sku': 'ancora', 'idem': idem()}, 'produto desconhecido'),
                            ({'sku': 'classe-sumo', 'idem': idem()}, 'produto desconhecido'),
                            ({'sku': None, 'idem': idem()}, 'produto desconhecido'),
                            ({'sku': 'pedras-agua'}, 'idem inválido (8 a 64 letras, dígitos, _ ou -)'),
                            ({'sku': 'pedras-agua', 'idem': 'curto'}, 'idem inválido (8 a 64 letras, dígitos, _ ou -)'),
                            ({'sku': 'pedras-agua', 'idem': 'tem espaço aqui'}, 'idem inválido (8 a 64 letras, dígitos, _ ou -)'),
                            ({'sku': 'pedras-agua', 'idem': 'x' * 65}, 'idem inválido (8 a 64 letras, dígitos, _ ou -)')):
            status, r = c.pede('POST', '/api/loja/comprar', corpo)
            self.assertEqual((status, r.get('erro')), (400, erro), corpo)
        status, r = self.compra(c, 'pedras-agua')
        self.assertEqual((status, r['erro']), (409, 'o servidor ainda não viu seus vinténs: abra o jogo logado nesta '
                                                    'conta (na conta Principal)'))
        m = self.minha(c)
        self.assertEqual(m['saldo'], {'carteira': 0, 'reservado': 0, 'disponivel': 0, 'semFundo': False,
                                      'saveVersao': 0, 'saveEm': None})
        self.assertEqual(m['pedidos'], [])
        self.assertEqual(m['classes'], {k: {'liberada': False, 'cartas': 0}
                                        for k in ('invocador', 'bruxo', 'espadachim', 'arqueiro', 'minotauro')})
        self.assertEqual(set(m['limites']), {'pergaminho-xp', 'pergaminho-elemento', 'pedras', 'classe-invocador',
                                             'classe-bruxo', 'classe-espadachim', 'classe-arqueiro', 'classe-minotauro'})
        self.assertEqual(m['limites']['pedras'], {'usados': 0, 'max': 5, 'dias': 7, 'liberaEm': None})

    def test_reserva(self):
        c = self.novo('Rosa Reserva')
        r = self.sobe(c, carteira=10000)
        status, r = self.compra(c, 'classe-invocador')
        self.assertEqual(status, 201, r)
        self.assertEqual((r['pedido']['preco'], r['pedido']['estado'], r['pedido']['nome']), (8000, 'pendente', 'Xamã'))
        self.assertEqual({k: r['saldo'][k] for k in ('carteira', 'reservado', 'disponivel', 'semFundo')},
                         {'carteira': 10000, 'reservado': 8000, 'disponivel': 2000, 'semFundo': False})
        status, r = self.compra(c, 'classe-bruxo')            # 8.000 de novo: só há 2.000 livres
        self.assertEqual((status, r['erro'], r['saldo']['disponivel']), (409, 'vinténs insuficientes', 2000))
        status, r = self.compra(c, 'pedras-agua')
        self.assertEqual((status, r['saldo']['disponivel']), (201, 1700))
        m = self.minha(c)
        self.assertEqual((m['saldo']['reservado'], m['saldo']['disponivel']), (8300, 1700))
        self.assertEqual([p['sku'] for p in m['pedidos']], ['pedras-agua', 'classe-invocador'])     # o mais novo antes
        self.assertTrue(m['saldo']['saveVersao'] >= 1 and m['saldo']['saveEm'])

    def test_idem_repetido(self):
        c = self.novo('Ivo Idem')
        self.sobe(c, carteira=5000)
        chave = idem()
        status, r1 = self.compra(c, 'pedras-terra', chave)
        self.assertEqual(status, 201, r1)
        status, r2 = self.compra(c, 'pedras-terra', chave)     # o mesmo clique, de novo
        self.assertEqual(status, 200, r2)
        self.assertEqual(r2['pedido']['id'], r1['pedido']['id'])
        self.assertEqual(r2['saldo']['reservado'], 300)
        status, r = self.compra(c, 'pedras-ar', chave)
        self.assertEqual((status, r['erro']), (409, 'idem já usado em outro produto'))
        self.assertEqual(len(self.minha(c)['pedidos']), 1)
        # o idem é por conta: outra conta pode usar a mesma chave
        d = self.novo('Ivo Outro')
        self.sobe(d, carteira=500)
        self.assertEqual(self.compra(d, 'pedras-terra', chave)[0], 201)

    def test_retirar_e_cancelar(self):
        c = self.novo('Rita Retira')
        self.sobe(c, carteira=5000)
        p1, p2 = self.comprou(c, 'pedras-agua'), self.comprou(c, 'pedras-terra')
        status, r = c.pede('POST', '/api/loja/retirar', {})
        self.assertEqual(status, 200, r)
        self.assertEqual(r['pedidos'], [
            {'id': p1['id'], 'sku': 'pedras-agua', 'nome': '10 Lágrimas de Cisterna', 'preco': 300,
             'entrega': {'tipo': 'pedras', 'alvo': 'stone-tear', 'qtd': 10}},
            {'id': p2['id'], 'sku': 'pedras-terra', 'nome': '10 Grãos de Rocha-Mãe', 'preco': 300,
             'entrega': {'tipo': 'pedras', 'alvo': 'stone-root', 'qtd': 10}}])
        q1 = self.pedido(c, p1['id'])
        self.assertEqual((q1['estado'], q1['cancelavel']), ('retirado', False))
        self.assertLessEqual(abs(q1['retiradoEm'] - time.time()), 10)
        status, r = c.pede('POST', '/api/loja/cancelar', {'id': p1['id']})
        self.assertEqual((status, r['erro']), (409, 'já está a caminho do jogo; espere a entrega ou 24 h'))
        # preso há mais de 24 h: aí o jogador pode cancelar
        self.sql("UPDATE loja_pedidos SET retirado_em = ? WHERE id = ?", int(time.time()) - 25 * 3600, p1['id'])
        self.assertTrue(self.pedido(c, p1['id'])['cancelavel'])
        status, r = c.pede('POST', '/api/loja/cancelar', {'id': p1['id']})
        self.assertEqual(status, 200, r)
        self.assertEqual((r['pedido']['estado'], r['saldo']['reservado']), ('cancelado', 300))
        self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': p1['id']})[1]['erro'], 'pedido já fechado')
        # pendente cancela e solta a reserva
        p3 = self.comprou(c, 'pedras-ar')
        self.assertEqual(self.minha(c)['saldo']['reservado'], 750)
        status, r = c.pede('POST', '/api/loja/cancelar', {'id': p3['id']})
        self.assertEqual((status, r['saldo']['reservado']), (200, 300))
        # de outra conta, que não existe, torto
        d = self.novo('Rita Outra')
        self.assertEqual(d.pede('POST', '/api/loja/cancelar', {'id': p2['id']}), (404, {'ok': False, 'erro': 'pedido não encontrado'}))
        self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': 99999999})[0], 404)
        for torto in ({}, {'id': 'x'}, {'id': True}, {'id': 0}, {'id': -3}):
            self.assertEqual(c.pede('POST', '/api/loja/cancelar', torto)[0], 400, torto)
        # a retirada seguinte só traz o que continua aberto
        self.assertEqual([p['id'] for p in c.pede('POST', '/api/loja/retirar', {})[1]['pedidos']], [p2['id']])
        self.assertEqual(self.pedido(c, p2['id'])['estado'], 'retirado')

    # -- a confirmação dentro do save ------------------------------------------------------
    def test_put_confirma(self):
        c = self.novo('Pedro Confirma')
        d = self.novo('Pedro Vizinho')
        self.sobe(c, carteira=2000)
        self.sobe(d, carteira=1000)
        p1, p2, p3 = (self.comprou(c, s) for s in ('pedras-agua', 'pedras-terra', 'pedras-ar'))
        q = self.comprou(d, 'pedras-agua')
        self.assertEqual(len(c.pede('POST', '/api/loja/retirar', {})[1]['pedidos']), 3)
        # o jogo aplicou p1 (descontou 300), recusou p2 sem saldo e p3 com um motivo que não existe,
        # e "aplicou" o pedido da outra conta (ignorado)
        anot = {'aplicadas': [p1['id'], q['id']],
                'recusadas': [{'id': p2['id'], 'motivo': 'sem-saldo'}, {'id': p3['id'], 'motivo': 'inventado'}]}
        r = self.sobe(c, carteira=1700, anotacao=anot)
        self.assertEqual(r['loja'], {'entregues': [p1['id']], 'estornados': [p2['id'], p3['id']]})
        m = self.minha(c)
        por_id = {p['id']: p for p in m['pedidos']}
        self.assertEqual((por_id[p1['id']]['estado'], por_id[p2['id']]['estado'], por_id[p3['id']]['estado']),
                         ('entregue', 'estornado', 'estornado'))
        self.assertEqual((por_id[p2['id']]['motivo'], por_id[p3['id']]['motivo']), ('sem-saldo', 'recusado'))
        self.assertTrue(por_id[p1['id']]['fechadoEm'])
        self.assertEqual((m['saldo']['carteira'], m['saldo']['reservado']), (1700, 0))
        self.assertEqual(self.sql("SELECT versao_save FROM loja_pedidos WHERE id = ?", p1['id'])[0][0], r['versao'])
        self.assertEqual(self.pedido(d, q['id'])['estado'], 'pendente')       # o da outra conta ficou
        # a mesma anotação de novo: nada muda (já fechados)
        self.assertEqual(self.sobe(c, carteira=1700, anotacao=anot)['loja'], {'entregues': [], 'estornados': []})
        # um save sem anotação responde a loja vazia
        self.assertEqual(self.sobe(c, carteira=1700)['loja'], {'entregues': [], 'estornados': []})
        # PUT com versão velha: 409, e nada é confirmado
        p4 = self.comprou(c, 'pedras-fogo')
        versao = c.pede('GET', '/api/save')[1]['versao']
        status, r = c.salva(versao - 1, *save_loja(carteira=1250, anotacao={'aplicadas': [p4['id']], 'recusadas': []}))
        self.assertEqual(status, 409, r)
        self.assertEqual(self.pedido(c, p4['id'])['estado'], 'pendente')
        status, r = c.salva(versao, *save_loja(carteira=1250, anotacao={'aplicadas': [p4['id']], 'recusadas': []}))
        self.assertEqual((status, r['loja']['entregues']), (200, [p4['id']]))
        # cancelado e depois aplicado mesmo assim (o jogo não soube): vira entregue, com o evento na trilha
        p5 = self.comprou(c, 'pedras-neutro')
        self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': p5['id']})[0], 200)
        r = self.sobe(c, carteira=800, anotacao={'aplicadas': [p1['id'], p4['id'], p5['id']], 'recusadas': []})
        self.assertEqual(r['loja']['entregues'], [p5['id']])
        tardio = self.sql("SELECT dados FROM eventos WHERE conta_id = ? AND tipo = 'loja-cancelamento-tardio'",
                          c.conta['id'])
        self.assertEqual([json.loads(x[0])['id'] for x in tardio], [p5['id']])
        # anotação torta nunca derruba o save
        for torta in ({'aplicadas': 'x', 'recusadas': 7}, {'aplicadas': [True, -1, 'a', 2 ** 60, None]},
                      {'recusadas': [5, {'id': 'x'}, {'motivo': 'sem-saldo'}]}, 'lixo', None):
            db = save_loja(carteira=800)[1]
            db['loja'] = torta
            versao = c.pede('GET', '/api/save')[1]['versao']
            status, r = c.salva(versao, save_loja()[0], db)
            self.assertEqual((status, r.get('loja')), (200, {'entregues': [], 'estornados': []}), torta)
        eventos = {x[0] for x in self.sql("SELECT DISTINCT tipo FROM eventos WHERE conta_id = ? AND tipo LIKE 'loja-%'",
                                          c.conta['id'])}
        self.assertEqual(eventos, {'loja-compra', 'loja-cancela', 'loja-entregue', 'loja-estorno',
                                   'loja-cancelamento-tardio'})

    # -- as regras de cada produto -----------------------------------------------------------
    def test_classe(self):
        c = self.novo('Cida Classe')
        self.sobe(c, carteira=100000, classes=('sumo', 'curandeiro', 'bruxo'), cartas={'invocador': 6, 'bruxo': 12})
        self.assertEqual(self.compra(c, 'classe-bruxo')[1]['erro'], 'essa classe já está liberada')
        m = self.minha(c)
        self.assertEqual(m['classes']['bruxo'], {'liberada': True, 'cartas': 12})
        self.assertEqual(m['classes']['invocador'], {'liberada': False, 'cartas': 6})
        p = self.comprou(c, 'classe-invocador')
        self.assertEqual(self.compra(c, 'classe-invocador')[1]['erro'], 'já há um pedido dessa classe a caminho')
        c.pede('POST', '/api/loja/retirar', {})
        self.assertEqual(self.compra(c, 'classe-invocador')[1]['erro'], 'já há um pedido dessa classe a caminho')
        # entregue, mas o save ainda não mostra a classe liberada: "já foi comprada"
        r = self.sobe(c, carteira=92000, classes=('sumo', 'curandeiro', 'bruxo'),
                      anotacao={'aplicadas': [p['id']], 'recusadas': []})
        self.assertEqual(r['loja']['entregues'], [p['id']])
        status, r = self.compra(c, 'classe-invocador')
        self.assertEqual((status, r['erro']), (409, 'essa classe já foi comprada'))
        self.sobe(c, carteira=92000, classes=('sumo', 'curandeiro', 'bruxo', 'invocador'))
        self.assertEqual(self.compra(c, 'classe-invocador')[1]['erro'], 'essa classe já está liberada')
        # estornada não conta: pode comprar de novo
        p2 = self.comprou(c, 'classe-minotauro')
        self.sobe(c, carteira=92000, anotacao={'aplicadas': [], 'recusadas': [{'id': p2['id'], 'motivo': 'erro-local'}]})
        self.assertEqual(self.compra(c, 'classe-minotauro')[0], 201)

    def test_pergaminhos(self):
        gm_heroi = {'classId': 'gm', 'xp': comum.XP_MAX, 'level': 30, 'element': 'fogo',
                    'elements': ['fogo', 'agua', 'terra', 'ar']}
        c = self.novo('Neto Neutro')
        self.sobe(c, carteira=20000, herois={'sumo': {'classId': 'sumo', 'xp': 100, 'level': 3, 'element': 'neutro'},
                                             'gm': gm_heroi})
        self.assertEqual(self.compra(c, 'pergaminho-elemento')[1]['erro'], 'nenhum herói escolheu caminho elemental ainda')
        self.assertEqual(self.compra(c, 'pergaminho-xp')[0], 201)
        t = self.novo('Tina Topo')
        self.sobe(t, carteira=20000, herois={'sumo': {'classId': 'sumo', 'xp': comum.XP_MAX, 'level': 30,
                                                      'element': 'agua', 'elements': ['agua']},
                                             'curandeira': {'xp': comum.XP_MAX + 500, 'level': 30},
                                             'gm': dict(gm_heroi, xp=10)})
        self.assertEqual(self.compra(t, 'pergaminho-xp')[1]['erro'], 'todos os heróis já estão no nível 30')
        self.assertEqual(self.compra(t, 'pergaminho-elemento')[0], 201)
        # um caminho só na lista (o ativo voltou a neutro por um save antigo) também conta como escolhido
        e = self.novo('Elo Lista')
        self.sobe(e, carteira=20000, herois={'bruxo#2': {'classId': 'bruxo', 'xp': 5, 'level': 5, 'element': 'neutro',
                                                         'elements': ['terra']}})
        self.assertEqual(self.compra(e, 'pergaminho-elemento')[0], 201)

    # -- os limites ------------------------------------------------------------------------
    def test_limite_de_7_e_30_dias(self):
        c = self.novo('Lia Limite')
        self.sobe(c, carteira=100000)
        p = self.comprou(c, 'pergaminho-xp')
        self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': p['id']})[0], 200)
        p = self.comprou(c, 'pergaminho-xp')                     # cancelado não conta
        self.sobe(c, carteira=98500, anotacao={'aplicadas': [p['id']], 'recusadas': []})
        criado = self.sql("SELECT criado_em FROM loja_pedidos WHERE id = ?", p['id'])[0][0]
        status, r = self.compra(c, 'pergaminho-xp')              # entregue conta
        self.assertEqual((status, r['erro'], r['liberaEm']), (429, 'limite deste produto: 1 a cada 7 dias', criado + 7 * DIA))
        self.assertEqual(self.minha(c)['limites']['pergaminho-xp'],
                         {'usados': 1, 'max': 1, 'dias': 7, 'liberaEm': criado + 7 * DIA})
        self.sql("UPDATE loja_pedidos SET criado_em = criado_em - ? WHERE id = ?", 8 * DIA, p['id'])
        self.assertEqual(self.compra(c, 'pergaminho-xp')[0], 201)
        # a Reescrita: 1 a cada 30 dias
        q = self.comprou(c, 'pergaminho-elemento')
        status, r = self.compra(c, 'pergaminho-elemento')
        self.assertEqual((status, r['erro']), (429, 'limite deste produto: 1 a cada 30 dias'))
        self.sql("UPDATE loja_pedidos SET criado_em = criado_em - ? WHERE id = ?", 29 * DIA, q['id'])
        self.assertEqual(self.compra(c, 'pergaminho-elemento')[0], 429)
        self.sql("UPDATE loja_pedidos SET criado_em = criado_em - ? WHERE id = ?", 2 * DIA, q['id'])
        self.assertEqual(self.compra(c, 'pergaminho-elemento')[0], 201)

    def test_limite_das_pedras(self):
        c = self.novo('Pepa Pedras')
        self.sobe(c, carteira=100000)
        feitos = [self.comprou(c, s) for s in ('pedras-agua', 'pedras-terra', 'pedras-ar', 'pedras-fogo', 'pedras-neutro')]
        mais_velho = min(r[0] for r in self.sql("SELECT criado_em FROM loja_pedidos WHERE conta_id = ?", c.conta['id']))
        status, r = self.compra(c, 'pedras-agua')                # 5 pacotes somando os tipos
        self.assertEqual((status, r['erro'], r['liberaEm']), (429, 'limite deste produto: 5 a cada 7 dias',
                                                              mais_velho + 7 * DIA))
        lim = self.minha(c)['limites']['pedras']
        self.assertEqual((lim['usados'], lim['max']), (5, 5))
        # estornado não conta
        self.sobe(c, carteira=100000, anotacao={'aplicadas': [], 'recusadas': [{'id': feitos[0]['id'], 'motivo': 'sem-saldo'}]})
        self.assertEqual(self.compra(c, 'pedras-agua')[0], 201)

    def test_limite_de_abertos_e_por_hora(self):
        c = self.novo('Abel Abertos')
        self.sobe(c, carteira=100000)
        for s in ('pergaminho-xp', 'pergaminho-elemento', 'classe-invocador', 'classe-bruxo', 'pedras-agua'):
            self.comprou(c, s)
        status, r = self.compra(c, 'classe-espadachim')
        self.assertEqual((status, r['erro']), (429, 'pedidos abertos demais (5)'))
        # 10 por hora (pendente, retirado e entregue contam; cancelado não)
        h = self.novo('Hugo Hora')
        self.sobe(h, carteira=100000)
        t = int(time.time())
        b = sqlite3.connect(self.banco_arq)
        b.executemany("INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, criado_em) "
                      "VALUES (?, 'teste-hora', '{}', 0, 'entregue', ?)", [(h.conta['id'], t - 100)] * 10)
        b.commit()
        b.close()
        status, r = self.compra(h, 'pergaminho-xp')
        self.assertEqual((status, r['erro'], r['liberaEm']), (429, 'compras demais na última hora (10)', t - 100 + 3600))
        self.sql("UPDATE loja_pedidos SET estado = 'cancelado' WHERE conta_id = ? AND sku = 'teste-hora'", h.conta['id'])
        self.assertEqual(self.compra(h, 'pergaminho-xp')[0], 201)

    def test_libera_em_so_com_o_grupo_cheio(self):
        """liberaEm (contrato público de GET /api/loja/minha) só existe com o
        grupo cheio: com 1 de 5 pacotes usados ele devolvia a data da 1ª compra
        mais 7 dias — "limite atingido" para quem ainda pode comprar quatro."""
        c = self.novo('Vaga Livre')
        self.sobe(c, carteira=100000)
        p = self.comprou(c, 'pedras-agua')
        criado = self.sql("SELECT criado_em FROM loja_pedidos WHERE id = ?", p['id'])[0][0]
        lim = self.minha(c)['limites']
        self.assertEqual(lim['pedras'], {'usados': 1, 'max': 5, 'dias': 7, 'liberaEm': None})
        self.assertEqual(lim['pergaminho-xp'], {'usados': 0, 'max': 1, 'dias': 7, 'liberaEm': None})
        feitos = [p] + [self.comprou(c, 'pedras-terra') for _ in range(3)]
        q = self.comprou(c, 'pergaminho-xp')                         # grupo de 1: cheio na 1ª compra
        criado_q = self.sql("SELECT criado_em FROM loja_pedidos WHERE id = ?", q['id'])[0][0]
        lim = self.minha(c)['limites']
        self.assertEqual(lim['pedras'], {'usados': 4, 'max': 5, 'dias': 7, 'liberaEm': None})
        self.assertEqual(lim['pergaminho-xp'], {'usados': 1, 'max': 1, 'dias': 7, 'liberaEm': criado_q + 7 * DIA})
        self.assertEqual(lim['classe-invocador'], {'usados': 0, 'max': 1, 'dias': None, 'liberaEm': None})   # sem janela: nunca
        # entregues continuam contando no grupo (e soltam a vaga dos 5 abertos)
        self.sobe(c, carteira=98000, anotacao={'aplicadas': [x['id'] for x in feitos + [q]], 'recusadas': []})
        self.assertEqual(self.minha(c)['limites']['pedras'], {'usados': 4, 'max': 5, 'dias': 7, 'liberaEm': None})
        u = self.comprou(c, 'pedras-ar')                             # o 5º: cheio — a data é a da 1ª compra + 7 dias
        self.assertEqual(self.minha(c)['limites']['pedras'], {'usados': 5, 'max': 5, 'dias': 7, 'liberaEm': criado + 7 * DIA})
        # cancelar o 5º pacote abre a vaga: a data some de novo
        self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': u['id']})[0], 200)
        self.assertEqual(self.minha(c)['limites']['pedras'], {'usados': 4, 'max': 5, 'dias': 7, 'liberaEm': None})

    def test_teto_de_linhas_por_hora(self):
        """Comprar e cancelar devolve a vaga das 10 compras por hora (de
        propósito: nenhum vintém se perdeu), mas cada ciclo grava uma linha em
        loja_pedidos e duas em eventos, que ninguém poda — 33 ciclos por segundo
        enchiam o disco a 1 GB por dia por conta. O teto de 30 LINHAS por hora
        conta todo estado, e vale para o Mestre."""
        c = self.novo('Disco Cheio')
        self.sobe(c, carteira=100000)
        t = int(time.time())
        b = sqlite3.connect(self.banco_arq)
        b.executemany("INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, criado_em, fechado_em) "
                      "VALUES (?, 'pedras-agua', '{}', 300, ?, ?, ?)",
                      [(c.conta['id'], 'cancelado' if i % 2 else 'estornado', t - 100 - i, t - 90) for i in range(25)])
        b.commit()
        b.close()
        for _ in range(5):                                           # 5 ciclos de verdade: 30 linhas na hora
            p = self.comprou(c, 'pedras-agua')
            self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': p['id']})[0], 200)
        m = self.minha(c)
        self.assertEqual((m['saldo']['reservado'], m['limites']['pedras']['usados']), (0, 0))   # nada aberto, nada gasto
        status, r = self.compra(c, 'pedras-agua')                    # a 31ª: 429 mesmo assim
        self.assertEqual((status, r['erro'], r['liberaEm']), (429, 'pedidos demais na última hora (30)', t - 124 + 3600))
        self.assertEqual(self.sql("SELECT COUNT(*) FROM loja_pedidos WHERE conta_id = ?", c.conta['id'])[0][0], 30)
        # a linha mais velha sai da hora: cabe uma de novo
        self.sql("UPDATE loja_pedidos SET criado_em = ? WHERE conta_id = ? AND criado_em = ?", t - 3601, c.conta['id'], t - 124)
        self.assertEqual(self.compra(c, 'pedras-agua')[0], 201)
        # o Mestre não tem limite de produto nem de saldo, mas tem este: um token roubado não enche o disco
        g = self.novo('Guia Disco')
        self.mestre(g)
        b = sqlite3.connect(self.banco_arq)
        b.executemany("INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, criado_em, fechado_em) "
                      "VALUES (?, 'pergaminho-xp', '{}', 0, 'cancelado', ?, ?)", [(g.conta['id'], t - 50, t - 40)] * 29)
        b.commit()
        b.close()
        self.assertEqual(self.compra(g, 'pergaminho-xp')[0], 201)    # a 30ª
        status, r = self.compra(g, 'pergaminho-xp')
        self.assertEqual((status, r['erro'], r['liberaEm']), (429, 'pedidos demais na última hora (30)', t - 50 + 3600))

    def test_mestre_compra_sem_saldo(self):
        m = self.novo('Guia Loja')
        self.mestre(m)
        self.sobe(m, carteira=0, classes=('sumo', 'curandeiro', 'bruxo'))
        status, r = self.compra(m, 'classe-minotauro')
        self.assertEqual(status, 201, r)
        self.assertEqual((r['pedido']['preco'], r['saldo']['semFundo'], r['saldo']['reservado']), (0, True, 0))
        for _ in range(2):                                      # sem limite de produto
            self.assertEqual(self.compra(m, 'pergaminho-xp')[0], 201)
        # as regras do produto valem para ele também
        self.assertEqual(self.compra(m, 'classe-bruxo')[1]['erro'], 'essa classe já está liberada')
        self.assertTrue(self.minha(m)['saldo']['semFundo'])
        # sem save nenhum: o Mestre não precisa de vintém para o servidor ver
        m2 = self.novo('Guia Novo')
        self.mestre(m2)
        self.assertEqual(self.compra(m2, 'pedras-fogo')[0], 201)

    # -- dois processos no mesmo banco (o rolling update do Coolify) -------------------------
    def test_dois_processos_no_mesmo_banco(self):
        """Duas compras que juntas estouram o saldo, uma em cada processo, ao
        mesmo tempo: só uma passa. E o mesmo idem nos dois: um pedido só."""
        porta2 = porta_livre()
        log2 = open(os.path.join(self.pasta, 'api2.log'), 'w', encoding='utf-8')
        env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
        proc2 = subprocess.Popen([sys.executable, API, '--porta', str(porta2), '--banco', self.banco_arq],
                                 stdout=log2, stderr=subprocess.STDOUT, env=env)
        try:
            base2 = 'http://127.0.0.1:%d' % porta2
            self.assertTrue(espera_api(base2, proc2), 'o segundo processo não subiu')
            for rodada in range(6):
                c = self.novo('Dupla Loja')
                self.sobe(c, carteira=10000)
                c2 = Cliente(base2)
                c2.token, c2.conta = c.token, c.conta
                res = []

                def vai(cli, sku, chave=None):
                    res.append(self.compra(cli, sku, chave))

                t1 = threading.Thread(target=vai, args=(c, 'classe-invocador'))
                t2 = threading.Thread(target=vai, args=(c2, 'classe-bruxo'))
                t1.start(); t2.start(); t1.join(); t2.join()
                self.assertEqual(sorted(s for s, _ in res), [201, 409], 'rodada %d: %r' % (rodada, res))
                self.assertEqual(self.minha(c)['saldo']['reservado'], 8000)
                res.clear()
                chave = idem()
                t1 = threading.Thread(target=vai, args=(c, 'pedras-agua', chave))
                t2 = threading.Thread(target=vai, args=(c2, 'pedras-agua', chave))
                t1.start(); t2.start(); t1.join(); t2.join()
                self.assertEqual(sorted(s for s, _ in res), [200, 201], 'rodada %d: %r' % (rodada, res))
                self.assertEqual(res[0][1]['pedido']['id'], res[1][1]['pedido']['id'])
                self.assertEqual(len(self.minha(c)['pedidos']), 2)
        finally:
            proc2.terminate()
            try:
                proc2.wait(5)
            except subprocess.TimeoutExpired:
                proc2.kill()
            log2.close()

    # -- o catálogo espelha os dados do jogo ------------------------------------------------------
    @staticmethod
    def le(rel):
        with open(os.path.join(AQUI, '..', rel), 'rb') as f:
            return f.read().decode('utf-8', errors='replace')

    def test_catalogo_espelha_dados(self):
        """No molde de test_xp_max_espelha_tabela: se o jogo mudar um custo em
        cartas, uma raridade, quem nasce liberado ou uma pedra, isto grita."""
        prog = self.le('js/core/data/progression.js')
        cartas_bloco = prog[prog.index('JOGO.DATA.cards = {'):]
        cartas_bloco = cartas_bloco[:cartas_bloco.index('};')]
        custo = {k: int(v) for k, v in re.findall(r'^\s+([a-z]+):\s*\{\s*unlockCost:\s*(\d+)', cartas_bloco, re.M)}
        classes_js = self.le('js/core/data/classes.js')
        blocos = re.split(r'^  ([a-z_]+): \{', classes_js, flags=re.M)
        classes = {}
        for nome, corpo in zip(blocos[1::2], blocos[2::2]):
            classes[nome] = {'nasce': re.search(r'startsUnlocked:\s*(true|false)', corpo).group(1) == 'true',
                             'raridade': re.search(r"cardRarity:\s*'([a-z]+)'", corpo).group(1),
                             'nome': re.search(r"name:\s*'([^']+)'", corpo).group(1)}
        self.assertEqual(tuple(classes), comum.CLASSES_RANK)
        vendidas = {i['alvo']: i for i in loja_mod.CATALOGO if i['tipo'] == 'classe'}
        # à venda: exatamente as que não nascem liberadas (o gm nem é classe de classes.js)
        self.assertEqual(set(vendidas), {k for k, v in classes.items() if not v['nasce']})
        for cid, item in vendidas.items():
            self.assertEqual(item['cartas'], custo[cid], cid)
            self.assertEqual(item['raridade'], classes[cid]['raridade'], cid)
            self.assertEqual(item['nome'], classes[cid]['nome'], cid)
            self.assertGreater(custo[cid], 0, cid)
        # as pedras: ids e elementos de DATA.stones; a Âncora fica de fora
        itens_js = self.le('js/core/data/items.js')
        pedras = dict(re.findall(r"id: '(stone-[a-z]+)', name: '[^']+', element: '([a-z]+)'", itens_js))
        self.assertIn('stone-anchor', pedras)
        vendidas = {i['alvo']: i['elemento'] for i in loja_mod.CATALOGO if i['tipo'] == 'pedras'}
        self.assertEqual(vendidas, {k: v for k, v in pedras.items() if k != 'stone-anchor'})
        self.assertEqual(set(vendidas.values()), set(comum.ELEMENTOS))

    def test_pergaminho_espelha_dados(self):
        """DATA.pergaminhos (progression.js, da frente do jogo) contra o que o
        catálogo promete na descrição. Se a frente do jogo ainda não entrou,
        fica pulado — a junção roda de novo."""
        prog = self.le('js/core/data/progression.js')
        casou = re.search(r'DATA\.pergaminhos\s*=\s*\{(.*?)\};', prog, re.S)
        if casou is None:
            self.skipTest('JOGO.DATA.pergaminhos ainda não existe em progression.js')
        corpo = casou.group(1)
        xp = re.search(r'xp\s*:\s*\{([^}]*)\}', corpo).group(1)
        self.assertEqual(float(re.search(r'fator\s*:\s*([\d.]+)', xp).group(1)), loja_mod.PERGAMINHO_XP['fator'])
        self.assertEqual(int(re.search(r'salas\s*:\s*(\d+)', xp).group(1)), loja_mod.PERGAMINHO_XP['salas'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
