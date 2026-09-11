#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova da loja de vinténs (servidor/loja.py), pela API de verdade.

    python tests/loja_api.py

Sobe servidor/api.py num subprocesso (banco descartável numa pasta
temporária) e faz o que o site e o jogo fariam: o save sobe com a carteira, o
site compra, o jogo retira, e o PUT do save confirma a entrega ou o estorno.
As contas são sintéticas, criadas aqui.

O que se prova: o catálogo público v2 (Loja 2, 10/09: personagens, bônus de XP
por tempo, pedras de 10 e de 50, insígnias, a Reescrita e os pacotes em reais;
sem as classes iniciais, sem o gm, sem a Âncora, sem o Pergaminho da
Sabedoria), a reserva (duas compras não gastam o mesmo vintém, nem em dois
processos no mesmo banco), o idem, retirar e cancelar, a confirmação dentro do
save (e nada com versão velha), as regras de classe, de pergaminho e de bônus,
os limites (só a Reescrita tem janela; a compra única das classes; 5 abertos,
10 por hora; o teto de 30 LINHAS por hora, em qualquer estado e para o Mestre
também), o Mestre, os CRÉDITOS a caminho (o saldo `aCaminho`, a compra sem save
com crédito, a ordem no retirar, o cancelar recusado, os tetos que não os
contam, a reemissão do crédito de pacote recusado), o `entrega.agora` só no
bônus, e que o catálogo espelha os dados do jogo (progression.js, classes.js,
items.js, items_selos.js).
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
PRECOS = {'classe-invocador': 10000, 'classe-bruxo': 10000, 'classe-espadachim': 20000, 'classe-arqueiro': 25000,
          'classe-minotauro': 30000,
          'bonus-xp-1': 1500, 'bonus-xp-3': 3900, 'bonus-xp-7': 7900,
          'pedras-agua': 500, 'pedras-terra': 500, 'pedras-ar': 800, 'pedras-fogo': 800, 'pedras-neutro': 800,
          'pedras-agua-50': 2250, 'pedras-terra-50': 2250, 'pedras-ar-50': 3600, 'pedras-fogo-50': 3600,
          'pedras-neutro-50': 3600,
          'insignia-1': 500, 'insignias-10': 4500,
          'pergaminho-elemento': 5000}
SECOES = ['personagens'] * 5 + ['bonus'] * 3 + ['pedras'] * 10 + ['guilda'] * 2 + ['pergaminhos']
GRUPOS = {'pergaminho-elemento', 'classe-invocador', 'classe-bruxo', 'classe-espadachim', 'classe-arqueiro',
          'classe-minotauro'}
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

    def semeia_credito(self, c, vintens, origem='pagamento', mp_id=None, sku=None, estado='pendente', em=None):
        """Um crédito como o pagamento.py (origem 'pagamento') ou o mestre.py (origem 'presente') gravaria."""
        t = em or int(time.time())
        b = sqlite3.connect(self.banco_arq)
        try:
            pid = b.execute(
                "INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, idem, criado_em) VALUES (?, ?, ?, 0, ?, ?, ?)",
                (c.conta['id'], sku or ('pacote-12000' if origem == 'pagamento' else 'presente-vintens'),
                 json.dumps({'tipo': 'vintens', 'alvo': 'carteira', 'qtd': vintens}), estado,
                 'mp:%s' % mp_id if mp_id else None, t)).lastrowid
            b.execute("INSERT INTO loja_creditos(pedido_id, vintens, origem, mp_id, criado_em) VALUES (?, ?, ?, ?, ?)",
                      (pid, vintens, origem, mp_id, t))
            if origem == 'presente':
                b.execute("INSERT INTO loja_presentes(pedido_id, por, criado_em) VALUES (?, NULL, ?)", (pid, t))
            b.commit()
        finally:
            b.close()
        return pid

    def semeia_presente(self, c, sku='pedras-agua', estado='pendente', em=None):
        item = loja_mod.POR_SKU[sku]
        t = em or int(time.time())
        b = sqlite3.connect(self.banco_arq)
        try:
            pid = b.execute(
                "INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, criado_em) VALUES (?, ?, ?, 0, ?, ?)",
                (c.conta['id'], sku, json.dumps(loja_mod.entrega_de(item)), estado, t)).lastrowid
            b.execute("INSERT INTO loja_presentes(pedido_id, por, criado_em) VALUES (?, NULL, ?)", (pid, t))
            b.commit()
        finally:
            b.close()
        return pid

    # -- o catálogo ---------------------------------------------------------------------
    def test_catalogo_publico(self):
        status, r = Cliente(self.base).pede('GET', '/api/loja/catalogo', token=None)
        self.assertEqual(status, 200, r)
        self.assertEqual((r['ok'], r['versao']), (True, 2))
        itens = r['itens']
        self.assertEqual({i['sku']: i['preco'] for i in itens}, PRECOS)
        self.assertEqual([i['secao'] for i in itens], SECOES)
        alvos = {i['alvo'] for i in itens}
        for fora in ('sumo', 'curandeiro', 'curandeira', 'gm', 'stone-anchor'):
            self.assertNotIn(fora, alvos)
        texto = json.dumps(itens, ensure_ascii=False)
        self.assertNotIn('ncora', texto)
        self.assertNotIn('pergaminho-xp', texto)                  # o da Sabedoria saiu da venda
        self.assertNotIn('Sabedoria', [i['nome'] for i in itens])
        for i in itens:
            self.assertTrue(isinstance(i['preco'], int) and i['preco'] > 0, i)
            self.assertTrue(i['nome'] and i['descricao'], i)
            self.assertIn(i['tipo'], ('classe', 'bonus-xp', 'pedras', 'insignias', 'pergaminho'))
            if i['limite'] is not None:
                self.assertEqual(set(i['limite']), {'grupo', 'max', 'dias'})
        # só a Reescrita tem janela; as classes, compra única; o resto, nenhum (o preço é o freio)
        self.assertEqual({i['sku']: i['limite'] for i in itens if i['limite'] is not None and i['limite']['dias']},
                         {'pergaminho-elemento': {'grupo': 'pergaminho-elemento', 'max': 1, 'dias': 30}})
        for i in itens:
            if i['tipo'] == 'classe':
                self.assertEqual(i['limite'], {'grupo': i['sku'], 'max': 1, 'dias': None})
            elif i['tipo'] != 'pergaminho':
                self.assertIsNone(i['limite'], i['sku'])
        pedras = [i for i in itens if i['tipo'] == 'pedras']
        self.assertEqual(sorted(i['qtd'] for i in pedras), [10] * 5 + [50] * 5)
        for i in pedras:
            dez = [j for j in pedras if j['alvo'] == i['alvo'] and j['qtd'] == 10][0]
            if i['qtd'] == 50:                                    # 10% de desconto no pacote de 50
                self.assertEqual(i['preco'], dez['preco'] * 5 * 9 // 10, i['sku'])
                self.assertTrue(i['descricao'].startswith('Cinquenta'), i)
            else:
                self.assertTrue(i['descricao'].startswith('Dez'), i)
        bonus = [i for i in itens if i['tipo'] == 'bonus-xp']
        self.assertEqual([(i['qtd'], i['dias'], i['alvo']) for i in bonus], [(1, 1, 'xp'), (3, 3, 'xp'), (7, 7, 'xp')])
        self.assertEqual([i['nome'] for i in bonus], ['Bônus de XP — 1 dia', 'Bônus de XP — 3 dias', 'Bônus de XP — 7 dias'])
        for i in bonus:
            self.assertIn('+50% de experiência', i['descricao'])
            self.assertIn('relógio do servidor', i['descricao'])
            self.assertIn('×2', i['descricao'])
        ins = [i for i in itens if i['tipo'] == 'insignias']
        self.assertEqual([(i['sku'], i['qtd'], i['alvo']) for i in ins], [('insignia-1', 1, 'fundacao'),
                                                                          ('insignias-10', 10, 'fundacao')])
        xama = [i for i in itens if i['sku'] == 'classe-invocador'][0]
        self.assertEqual((xama['nome'], xama['raridade'], xama['cartas'], xama['limite']['dias']),
                         ('Xamã', 'raro', 10, None))
        # a régua: personagem = 1.000 vinténs por carta do desbloqueio
        for i in itens:
            if i['tipo'] == 'classe':
                self.assertEqual(i['preco'], 1000 * i['cartas'], i['sku'])
        # os pacotes em reais, formatados pelo servidor; o pagamento desligado (esta API sobe sem as variáveis)
        self.assertEqual(r['pacotes'], [
            {'id': 'pacote-1000', 'nome': 'Bolsa de 1.000 vinténs', 'vintens': 1000, 'centavos': 490, 'preco': 'R$ 4,90'},
            {'id': 'pacote-5500', 'nome': 'Saco de 5.500 vinténs', 'vintens': 5500, 'centavos': 1990, 'preco': 'R$ 19,90'},
            {'id': 'pacote-12000', 'nome': 'Arca de 12.000 vinténs', 'vintens': 12000, 'centavos': 3990,
             'preco': 'R$ 39,90'},
            {'id': 'pacote-25000', 'nome': 'Tesouro de 25.000 vinténs', 'vintens': 25000, 'centavos': 7990,
             'preco': 'R$ 79,90'}])
        self.assertEqual(r['pagamento'], {'ligado': False, 'teste': False})
        self.assertEqual(loja_mod.reais(123456), 'R$ 1.234,56')

    # -- comprar ------------------------------------------------------------------------
    def test_comprar_erros_basicos(self):
        self.assertEqual(Cliente(self.base).pede('POST', '/api/loja/comprar', {'sku': 'pedras-agua', 'idem': idem()})[0], 401)
        self.assertEqual(Cliente(self.base).pede('GET', '/api/loja/minha')[0], 401)
        self.assertEqual(Cliente(self.base).pede('POST', '/api/loja/retirar', {})[0], 401)
        c = self.novo('Erro Basico')
        for corpo, erro in (({'sku': 'ancora', 'idem': idem()}, 'produto desconhecido'),
                            ({'sku': 'classe-sumo', 'idem': idem()}, 'produto desconhecido'),
                            ({'sku': 'pergaminho-xp', 'idem': idem()}, 'produto desconhecido'),
                            ({'sku': 'pacote-1000', 'idem': idem()}, 'produto desconhecido'),
                            ({'sku': 'presente-vintens', 'idem': idem()}, 'produto desconhecido'),
                            ({'sku': None, 'idem': idem()}, 'produto desconhecido'),
                            ({'sku': 'pedras-agua'}, 'idem inválido (8 a 64 letras, dígitos, _ ou -)'),
                            ({'sku': 'pedras-agua', 'idem': 'curto'}, 'idem inválido (8 a 64 letras, dígitos, _ ou -)'),
                            ({'sku': 'pedras-agua', 'idem': 'mp:12345678'}, 'idem inválido (8 a 64 letras, dígitos, _ ou -)'),
                            ({'sku': 'pedras-agua', 'idem': 'tem espaço aqui'}, 'idem inválido (8 a 64 letras, dígitos, _ ou -)'),
                            ({'sku': 'pedras-agua', 'idem': 'x' * 65}, 'idem inválido (8 a 64 letras, dígitos, _ ou -)')):
            status, r = c.pede('POST', '/api/loja/comprar', corpo)
            self.assertEqual((status, r.get('erro')), (400, erro), corpo)
        status, r = self.compra(c, 'pedras-agua')
        self.assertEqual((status, r['erro']), (409, 'o servidor ainda não viu seus vinténs: abra o jogo logado nesta '
                                                    'conta (na conta Principal)'))
        m = self.minha(c)
        self.assertEqual(m['saldo'], {'carteira': 0, 'reservado': 0, 'aCaminho': 0, 'disponivel': 0, 'semFundo': False,
                                      'saveVersao': 0, 'saveEm': None})
        self.assertEqual(m['pedidos'], [])
        self.assertEqual(m['classes'], {k: {'liberada': False, 'cartas': 0}
                                        for k in ('invocador', 'bruxo', 'espadachim', 'arqueiro', 'minotauro')})
        self.assertEqual(set(m['limites']), GRUPOS)
        self.assertEqual(m['limites']['pergaminho-elemento'], {'usados': 0, 'max': 1, 'dias': 30, 'liberaEm': None})

    def test_reserva(self):
        c = self.novo('Rosa Reserva')
        self.sobe(c, carteira=12000)
        status, r = self.compra(c, 'classe-invocador')
        self.assertEqual(status, 201, r)
        self.assertEqual((r['pedido']['preco'], r['pedido']['estado'], r['pedido']['nome']), (10000, 'pendente', 'Xamã'))
        self.assertNotIn('origem', r['pedido'])
        self.assertEqual({k: r['saldo'][k] for k in ('carteira', 'reservado', 'aCaminho', 'disponivel', 'semFundo')},
                         {'carteira': 12000, 'reservado': 10000, 'aCaminho': 0, 'disponivel': 2000, 'semFundo': False})
        status, r = self.compra(c, 'classe-bruxo')            # 10.000 de novo: só há 2.000 livres
        self.assertEqual((status, r['erro'], r['saldo']['disponivel']), (409, 'vinténs insuficientes', 2000))
        status, r = self.compra(c, 'pedras-agua')
        self.assertEqual((status, r['saldo']['disponivel']), (201, 1500))
        m = self.minha(c)
        self.assertEqual((m['saldo']['reservado'], m['saldo']['disponivel']), (10500, 1500))
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
        self.assertEqual(r2['saldo']['reservado'], 500)
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
        p1, p2 = self.comprou(c, 'pedras-agua'), self.comprou(c, 'pedras-terra-50')
        status, r = c.pede('POST', '/api/loja/retirar', {})
        self.assertEqual(status, 200, r)
        self.assertEqual(r['pedidos'], [
            {'id': p1['id'], 'sku': 'pedras-agua', 'nome': '10 Lágrimas de Cisterna', 'preco': 500,
             'entrega': {'tipo': 'pedras', 'alvo': 'stone-tear', 'qtd': 10}},
            {'id': p2['id'], 'sku': 'pedras-terra-50', 'nome': '50 Grãos de Rocha-Mãe', 'preco': 2250,
             'entrega': {'tipo': 'pedras', 'alvo': 'stone-root', 'qtd': 50}}])
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
        self.assertEqual((r['pedido']['estado'], r['saldo']['reservado']), ('cancelado', 2250))
        self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': p1['id']})[1]['erro'], 'pedido já fechado')
        # pendente cancela e solta a reserva
        p3 = self.comprou(c, 'pedras-ar')
        self.assertEqual(self.minha(c)['saldo']['reservado'], 3050)
        status, r = c.pede('POST', '/api/loja/cancelar', {'id': p3['id']})
        self.assertEqual((status, r['saldo']['reservado']), (200, 2250))
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
        # o jogo aplicou p1 (descontou 500), recusou p2 sem saldo e p3 com um motivo que não existe,
        # e "aplicou" o pedido da outra conta (ignorado)
        anot = {'aplicadas': [p1['id'], q['id']],
                'recusadas': [{'id': p2['id'], 'motivo': 'sem-saldo'}, {'id': p3['id'], 'motivo': 'inventado'}]}
        r = self.sobe(c, carteira=1500, anotacao=anot)
        self.assertEqual(r['loja'], {'entregues': [p1['id']], 'estornados': [p2['id'], p3['id']]})
        m = self.minha(c)
        por_id = {p['id']: p for p in m['pedidos']}
        self.assertEqual((por_id[p1['id']]['estado'], por_id[p2['id']]['estado'], por_id[p3['id']]['estado']),
                         ('entregue', 'estornado', 'estornado'))
        self.assertEqual((por_id[p2['id']]['motivo'], por_id[p3['id']]['motivo']), ('sem-saldo', 'recusado'))
        self.assertTrue(por_id[p1['id']]['fechadoEm'])
        self.assertEqual((m['saldo']['carteira'], m['saldo']['reservado']), (1500, 0))
        self.assertEqual(self.sql("SELECT versao_save FROM loja_pedidos WHERE id = ?", p1['id'])[0][0], r['versao'])
        self.assertEqual(self.pedido(d, q['id'])['estado'], 'pendente')       # o da outra conta ficou
        # a mesma anotação de novo: nada muda (já fechados)
        self.assertEqual(self.sobe(c, carteira=1500, anotacao=anot)['loja'], {'entregues': [], 'estornados': []})
        # um save sem anotação responde a loja vazia
        self.assertEqual(self.sobe(c, carteira=1500)['loja'], {'entregues': [], 'estornados': []})
        # PUT com versão velha: 409, e nada é confirmado
        p4 = self.comprou(c, 'pedras-fogo')
        versao = c.pede('GET', '/api/save')[1]['versao']
        status, r = c.salva(versao - 1, *save_loja(carteira=700, anotacao={'aplicadas': [p4['id']], 'recusadas': []}))
        self.assertEqual(status, 409, r)
        self.assertEqual(self.pedido(c, p4['id'])['estado'], 'pendente')
        status, r = c.salva(versao, *save_loja(carteira=700, anotacao={'aplicadas': [p4['id']], 'recusadas': []}))
        self.assertEqual((status, r['loja']['entregues']), (200, [p4['id']]))
        # cancelado e depois aplicado mesmo assim (o jogo não soube): vira entregue, com o evento na trilha
        p5 = self.comprou(c, 'insignia-1')
        self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': p5['id']})[0], 200)
        r = self.sobe(c, carteira=200, anotacao={'aplicadas': [p1['id'], p4['id'], p5['id']], 'recusadas': []})
        self.assertEqual(r['loja']['entregues'], [p5['id']])
        tardio = self.sql("SELECT dados FROM eventos WHERE conta_id = ? AND tipo = 'loja-cancelamento-tardio'",
                          c.conta['id'])
        self.assertEqual([json.loads(x[0])['id'] for x in tardio], [p5['id']])
        # anotação torta nunca derruba o save
        for torta in ({'aplicadas': 'x', 'recusadas': 7}, {'aplicadas': [True, -1, 'a', 2 ** 60, None]},
                      {'recusadas': [5, {'id': 'x'}, {'motivo': 'sem-saldo'}]}, 'lixo', None):
            db = save_loja(carteira=200)[1]
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
        r = self.sobe(c, carteira=90000, classes=('sumo', 'curandeiro', 'bruxo'),
                      anotacao={'aplicadas': [p['id']], 'recusadas': []})
        self.assertEqual(r['loja']['entregues'], [p['id']])
        status, r = self.compra(c, 'classe-invocador')
        self.assertEqual((status, r['erro']), (409, 'essa classe já foi comprada'))
        self.sobe(c, carteira=90000, classes=('sumo', 'curandeiro', 'bruxo', 'invocador'))
        self.assertEqual(self.compra(c, 'classe-invocador')[1]['erro'], 'essa classe já está liberada')
        # estornada não conta: pode comprar de novo
        p2 = self.comprou(c, 'classe-minotauro')
        self.sobe(c, carteira=90000, anotacao={'aplicadas': [], 'recusadas': [{'id': p2['id'], 'motivo': 'erro-local'}]})
        self.assertEqual(self.compra(c, 'classe-minotauro')[0], 201)

    def test_reescrita_e_bonus(self):
        gm_heroi = {'classId': 'gm', 'xp': comum.XP_MAX, 'level': 30, 'element': 'fogo',
                    'elements': ['fogo', 'agua', 'terra', 'ar']}
        c = self.novo('Neto Neutro')
        self.sobe(c, carteira=20000, herois={'sumo': {'classId': 'sumo', 'xp': 100, 'level': 3, 'element': 'neutro'},
                                             'gm': gm_heroi})
        self.assertEqual(self.compra(c, 'pergaminho-elemento')[1]['erro'], 'nenhum herói escolheu caminho elemental ainda')
        self.assertEqual(self.compra(c, 'bonus-xp-1')[0], 201)
        self.assertEqual(self.compra(c, 'bonus-xp-1')[0], 201)             # sem janela: comprar de novo soma os dias
        t = self.novo('Tina Topo')
        self.sobe(t, carteira=20000, herois={'sumo': {'classId': 'sumo', 'xp': comum.XP_MAX, 'level': 30,
                                                      'element': 'agua', 'elements': ['agua']},
                                             'curandeira': {'xp': comum.XP_MAX + 500, 'level': 30},
                                             'gm': dict(gm_heroi, xp=10)})
        # o bônus de XP com todos no nível 30 VENDE: no jogo ele ainda rende a fatia do pet e o dízimo
        # (conserto 11/09; a recusa do nível 30 ficou só no Sabedoria, que tem carga a poupar e saiu da venda)
        self.assertEqual(self.compra(t, 'bonus-xp-1')[0], 201)
        self.assertEqual(self.compra(t, 'pergaminho-elemento')[0], 201)
        # um caminho só na lista (o ativo voltou a neutro por um save antigo) também conta como escolhido
        e = self.novo('Elo Lista')
        self.sobe(e, carteira=20000, herois={'bruxo#2': {'classId': 'bruxo', 'xp': 5, 'level': 5, 'element': 'neutro',
                                                         'elements': ['terra']}})
        self.assertEqual(self.compra(e, 'pergaminho-elemento')[0], 201)

    def test_pergaminho_da_sabedoria_fora_da_venda(self):
        """O pedido antigo ainda aberto sai no retirar com o nome certo e é entregue normalmente."""
        c = self.novo('Sabe Antigo')
        self.sobe(c, carteira=5000)
        t = int(time.time())
        antigo = self.sql("INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, criado_em) "
                          "VALUES (?, 'pergaminho-xp', ?, 1500, 'pendente', ?) RETURNING id", c.conta['id'],
                          json.dumps({'tipo': 'pergaminho', 'alvo': 'xp', 'qtd': 1}), t - 3 * DIA)[0][0]
        self.assertEqual(self.pedido(c, antigo)['nome'], 'Pergaminho da Sabedoria')
        self.assertEqual(self.minha(c)['saldo']['reservado'], 1500)
        r = c.pede('POST', '/api/loja/retirar', {})[1]
        self.assertEqual(r['pedidos'], [{'id': antigo, 'sku': 'pergaminho-xp', 'nome': 'Pergaminho da Sabedoria',
                                         'preco': 1500, 'entrega': {'tipo': 'pergaminho', 'alvo': 'xp', 'qtd': 1}}])
        r = self.sobe(c, carteira=3500, anotacao={'aplicadas': [antigo], 'recusadas': []})
        self.assertEqual(r['loja']['entregues'], [antigo])
        self.assertEqual(self.compra(c, 'pergaminho-xp')[1]['erro'], 'produto desconhecido')

    # -- os limites ------------------------------------------------------------------------
    def test_limite_da_reescrita(self):
        c = self.novo('Lia Limite')
        self.sobe(c, carteira=100000)
        p = self.comprou(c, 'pergaminho-elemento')
        self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': p['id']})[0], 200)
        p = self.comprou(c, 'pergaminho-elemento')              # cancelado não conta
        self.sobe(c, carteira=95000, anotacao={'aplicadas': [p['id']], 'recusadas': []})
        criado = self.sql("SELECT criado_em FROM loja_pedidos WHERE id = ?", p['id'])[0][0]
        status, r = self.compra(c, 'pergaminho-elemento')       # entregue conta
        self.assertEqual((status, r['erro'], r['liberaEm']), (429, 'limite deste produto: 1 a cada 30 dias', criado + 30 * DIA))
        self.assertEqual(self.minha(c)['limites']['pergaminho-elemento'],
                         {'usados': 1, 'max': 1, 'dias': 30, 'liberaEm': criado + 30 * DIA})
        self.sql("UPDATE loja_pedidos SET criado_em = criado_em - ? WHERE id = ?", 29 * DIA, p['id'])
        self.assertEqual(self.compra(c, 'pergaminho-elemento')[0], 429)
        self.sql("UPDATE loja_pedidos SET criado_em = criado_em - ? WHERE id = ?", 2 * DIA, p['id'])
        self.assertEqual(self.compra(c, 'pergaminho-elemento')[0], 201)

    def test_sem_janela_nas_pedras_bonus_e_insignias(self):
        """Sem janela de 7 dias: o preço é o freio. Ficam os tetos de abuso (5 abertos)."""
        c = self.novo('Pepa Pedras')
        self.sobe(c, carteira=100000)
        skus = ('pedras-agua', 'pedras-fogo-50', 'bonus-xp-7', 'insignias-10', 'insignia-1')
        feitos = [self.comprou(c, s) for s in skus]
        self.assertEqual(self.compra(c, 'pedras-agua')[1]['erro'], 'pedidos abertos demais (5)')
        c.pede('POST', '/api/loja/retirar', {})
        self.sobe(c, carteira=100000 - sum(PRECOS[s] for s in skus),
                  anotacao={'aplicadas': [p['id'] for p in feitos], 'recusadas': []})
        for s in skus:                                          # os mesmos de novo, na mesma semana
            self.assertEqual(self.compra(c, s)[0], 201, s)
        self.assertEqual(set(self.minha(c)['limites']), GRUPOS)   # nenhum grupo de pedras nem de bônus

    def test_limite_de_abertos_e_por_hora(self):
        c = self.novo('Abel Abertos')
        self.sobe(c, carteira=100000)
        for s in ('bonus-xp-1', 'pergaminho-elemento', 'classe-invocador', 'classe-bruxo', 'pedras-agua'):
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
        status, r = self.compra(h, 'bonus-xp-1')
        self.assertEqual((status, r['erro'], r['liberaEm']), (429, 'compras demais na última hora (10)', t - 100 + 3600))
        self.sql("UPDATE loja_pedidos SET estado = 'cancelado' WHERE conta_id = ? AND sku = 'teste-hora'", h.conta['id'])
        self.assertEqual(self.compra(h, 'bonus-xp-1')[0], 201)

    def test_libera_em_so_com_o_grupo_cheio(self):
        """liberaEm (contrato público de GET /api/loja/minha) só existe com o
        grupo cheio; sem janela (as classes), nunca."""
        c = self.novo('Vaga Livre')
        self.sobe(c, carteira=100000)
        lim = self.minha(c)['limites']
        self.assertEqual(lim['pergaminho-elemento'], {'usados': 0, 'max': 1, 'dias': 30, 'liberaEm': None})
        q = self.comprou(c, 'pergaminho-elemento')                     # grupo de 1: cheio na 1ª compra
        criado_q = self.sql("SELECT criado_em FROM loja_pedidos WHERE id = ?", q['id'])[0][0]
        x = self.comprou(c, 'classe-invocador')
        lim = self.minha(c)['limites']
        self.assertEqual(lim['pergaminho-elemento'], {'usados': 1, 'max': 1, 'dias': 30, 'liberaEm': criado_q + 30 * DIA})
        self.assertEqual(lim['classe-invocador'], {'usados': 1, 'max': 1, 'dias': None, 'liberaEm': None})   # sem janela
        self.assertEqual(lim['classe-bruxo'], {'usados': 0, 'max': 1, 'dias': None, 'liberaEm': None})
        # cancelar abre a vaga: a data some de novo
        self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': q['id']})[0], 200)
        self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': x['id']})[0], 200)
        lim = self.minha(c)['limites']
        self.assertEqual(lim['pergaminho-elemento'], {'usados': 0, 'max': 1, 'dias': 30, 'liberaEm': None})
        self.assertEqual(lim['classe-invocador']['usados'], 0)

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
                      "VALUES (?, 'pedras-agua', '{}', 500, ?, ?, ?)",
                      [(c.conta['id'], 'cancelado' if i % 2 else 'estornado', t - 100 - i, t - 90) for i in range(25)])
        b.commit()
        b.close()
        for _ in range(5):                                           # 5 ciclos de verdade: 30 linhas na hora
            p = self.comprou(c, 'pedras-agua')
            self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': p['id']})[0], 200)
        m = self.minha(c)
        self.assertEqual(m['saldo']['reservado'], 0)                 # nada aberto, nada gasto
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
                      "VALUES (?, 'bonus-xp-1', '{}', 0, 'cancelado', ?, ?)", [(g.conta['id'], t - 50, t - 40)] * 29)
        b.commit()
        b.close()
        self.assertEqual(self.compra(g, 'bonus-xp-1')[0], 201)       # a 30ª
        status, r = self.compra(g, 'bonus-xp-1')
        self.assertEqual((status, r['erro'], r['liberaEm']), (429, 'pedidos demais na última hora (30)', t - 50 + 3600))

    def test_mestre_compra_sem_saldo(self):
        m = self.novo('Guia Loja')
        self.mestre(m)
        self.sobe(m, carteira=0, classes=('sumo', 'curandeiro', 'bruxo'))
        status, r = self.compra(m, 'classe-minotauro')
        self.assertEqual(status, 201, r)
        self.assertEqual((r['pedido']['preco'], r['saldo']['semFundo'], r['saldo']['reservado']), (0, True, 0))
        for _ in range(2):                                      # sem limite de produto
            self.assertEqual(self.compra(m, 'pergaminho-elemento')[0], 201)
        # as regras do produto valem para ele também
        self.assertEqual(self.compra(m, 'classe-bruxo')[1]['erro'], 'essa classe já está liberada')
        self.assertTrue(self.minha(m)['saldo']['semFundo'])
        # sem save nenhum: o Mestre não precisa de vintém para o servidor ver
        m2 = self.novo('Guia Novo')
        self.mestre(m2)
        self.assertEqual(self.compra(m2, 'pedras-fogo')[0], 201)

    # -- os créditos a caminho (pacote pago, presente de vinténs) ---------------------------------
    def test_credito_a_caminho(self):
        c = self.novo('Cris Credito')
        cred = self.semeia_credito(c, 12000, mp_id='71000000001')
        m = self.minha(c)
        self.assertEqual(m['saldo'], {'carteira': 0, 'reservado': 0, 'aCaminho': 12000, 'disponivel': 12000,
                                      'semFundo': False, 'saveVersao': 0, 'saveEm': None})
        linha = m['pedidos'][0]
        self.assertEqual({k: linha[k] for k in ('id', 'sku', 'nome', 'preco', 'estado', 'cancelavel', 'origem', 'vintens')},
                         {'id': cred, 'sku': 'pacote-12000', 'nome': 'Arca de 12.000 vinténs', 'preco': 0,
                          'estado': 'pendente', 'cancelavel': False, 'origem': 'pagamento', 'vintens': 12000})
        # a conta nunca abriu o jogo (sem save) e compra com o vintém a caminho; a Reescrita, não
        self.assertEqual(self.compra(c, 'pergaminho-elemento')[1]['erro'], 'nenhum herói escolheu caminho elemental ainda')
        status, r = self.compra(c, 'classe-invocador')
        self.assertEqual(status, 201, r)
        self.assertEqual((r['saldo']['aCaminho'], r['saldo']['reservado'], r['saldo']['disponivel']), (12000, 10000, 2000))
        status, r = self.compra(c, 'bonus-xp-3')
        self.assertEqual((status, r['erro'], r['saldo']['disponivel']), (409, 'vinténs insuficientes', 2000))
        # o crédito de pacote não se cancela pelo site
        status, r = c.pede('POST', '/api/loja/cancelar', {'id': cred})
        self.assertEqual((status, r['erro']), (409, 'vinténs de pacote não se cancelam: eles chegam quando o jogo abrir'))
        # o retirar: o crédito (id menor) antes da compra; origem só no crédito
        r = c.pede('POST', '/api/loja/retirar', {})[1]
        self.assertEqual([p['id'] for p in r['pedidos']], sorted(p['id'] for p in r['pedidos']))
        self.assertEqual(r['pedidos'][0], {'id': cred, 'sku': 'pacote-12000', 'nome': 'Arca de 12.000 vinténs', 'preco': 0,
                                           'entrega': {'tipo': 'vintens', 'alvo': 'carteira', 'qtd': 12000},
                                           'origem': 'pagamento'})
        self.assertNotIn('origem', r['pedidos'][1])
        # o jogo soma o crédito (0 → 12.000), paga o Xamã (→ 2.000) e o PUT fecha os dois
        r = self.sobe(c, carteira=2000, classes=('sumo', 'curandeiro', 'invocador'),
                      anotacao={'aplicadas': [p['id'] for p in r['pedidos']], 'recusadas': []})
        self.assertEqual(len(r['loja']['entregues']), 2)
        m = self.minha(c)
        self.assertEqual({k: m['saldo'][k] for k in ('carteira', 'reservado', 'aCaminho', 'disponivel')},
                         {'carteira': 2000, 'reservado': 0, 'aCaminho': 0, 'disponivel': 2000})
        # o presente de vinténs: nome '<N> vinténs', origem presente, não se cancela pelo site
        pres = self.semeia_credito(c, 1234, origem='presente')
        p = self.pedido(c, pres)
        self.assertEqual((p['nome'], p['origem'], p['vintens'], p['cancelavel']), ('1.234 vinténs', 'presente', 1234, False))
        self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': pres})[1]['erro'], 'presente do Mestre: só o Mestre cancela')
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 1234)
        # o idem de um crédito não serve para uma compra (nem o 'mp:…', que nem passa na regra do idem)
        self.sql("UPDATE loja_pedidos SET idem = 'presente-abc123' WHERE id = ?", pres)
        self.assertEqual(self.compra(c, 'insignia-1', 'presente-abc123')[1]['erro'], 'idem já usado em outro produto')

    def test_entrega_agora_so_no_bonus(self):
        c = self.novo('Bia Bonus')
        self.sobe(c, carteira=20000)
        b3, pd = self.comprou(c, 'bonus-xp-3'), self.comprou(c, 'pedras-agua')
        antes = int(time.time())
        r = c.pede('POST', '/api/loja/retirar', {})[1]
        depois = int(time.time())
        por_id = {p['id']: p for p in r['pedidos']}
        ent = por_id[b3['id']]['entrega']
        self.assertEqual((ent['tipo'], ent['alvo'], ent['qtd']), ('bonus-xp', 'xp', 3))
        self.assertTrue(antes <= ent['agora'] <= depois, ent)
        self.assertNotIn('agora', por_id[pd['id']]['entrega'])
        self.assertEqual(por_id[b3['id']]['nome'], 'Bônus de XP — 3 dias')
        # o retirado que volta numa retirada seguinte leva o `agora` novo (o jogo aplica uma vez: anota o id)
        self.sql("UPDATE loja_pedidos SET retirado_em = retirado_em - 100 WHERE id = ?", b3['id'])
        time.sleep(1.1)
        r2 = c.pede('POST', '/api/loja/retirar', {})[1]
        self.assertGreater([p for p in r2['pedidos'] if p['id'] == b3['id']][0]['entrega']['agora'], ent['agora'])
        # no banco a entrega continua congelada, sem o carimbo
        self.assertEqual(json.loads(self.sql("SELECT entrega FROM loja_pedidos WHERE id = ?", b3['id'])[0][0]),
                         {'tipo': 'bonus-xp', 'alvo': 'xp', 'qtd': 3})

    def test_tetos_do_jogador_ignoram_creditos_e_presentes(self):
        c = self.novo('Teto Extra')
        self.sobe(c, carteira=100000)
        t = int(time.time())
        for i in range(6):                                           # 12 abertos que não são do jogador
            self.semeia_credito(c, 1000, mp_id='7200000%04d' % i)
            self.semeia_presente(c)
        for i in range(30):                                          # e 30 linhas de presente na hora
            self.semeia_presente(c, estado='cancelado', em=t - 60)
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 6000)
        feitos = [self.comprou(c, s) for s in ('pedras-agua', 'pedras-terra', 'pedras-ar', 'pedras-fogo', 'pedras-neutro')]
        self.assertEqual(self.compra(c, 'insignia-1')[1]['erro'], 'pedidos abertos demais (5)')   # os 5 são dele
        self.assertEqual(len(feitos), 5)

    def test_credito_de_pacote_recusado_volta(self):
        """D12: o jogo recusou o crédito de um pacote pago → 'estornado' e um crédito
        novo (mesma quantia) no mesmo save, até 3 vezes; na 4ª, alerta para o Mestre.
        O presente de vinténs recusado só fecha (não há dinheiro)."""
        c = self.novo('Recu Sado')
        self.sobe(c, carteira=0)
        t = int(time.time())
        b = sqlite3.connect(self.banco_arq)
        try:
            pg = b.execute("INSERT INTO pagamentos(conta_id, pacote, vintens, centavos, referencia, estado, criado_em, "
                           "atualizado_em) VALUES (?, 'pacote-1000', 1000, 490, ?, 'aberto', ?, ?)",
                           (c.conta['id'], 'sot-1-%s' % secrets.token_hex(8), t, t)).lastrowid
            b.commit()
        finally:
            b.close()
        atual = self.semeia_credito(c, 1000, mp_id='73000000001', sku='pacote-1000')
        self.sql("INSERT INTO pagamentos_mp(mp_id, pagamento_id, status, valor_centavos, pedido_id, creditado_em, "
                 "atualizado_em) VALUES ('73000000001', ?, 'approved', 490, ?, ?, ?)", pg, atual, t, t)
        for vez in range(1, 4):
            c.pede('POST', '/api/loja/retirar', {})
            r = self.sobe(c, carteira=0, anotacao={'aplicadas': [], 'recusadas': [{'id': atual, 'motivo': 'item-invalido'}]})
            self.assertEqual(r['loja']['estornados'], [atual])
            self.assertEqual(len(r['loja']['reemitidos']), 1, r)
            novo = r['loja']['reemitidos'][0]
            self.assertGreater(novo, atual)
            p = self.pedido(c, novo)
            self.assertEqual((p['estado'], p['vintens'], p['origem'], p['nome']),
                             ('pendente', 1000, 'pagamento', 'Bolsa de 1.000 vinténs'))
            linha = self.sql("SELECT pedido_id, reemissoes FROM pagamentos_mp WHERE mp_id = '73000000001'")[0]
            self.assertEqual((linha['pedido_id'], linha['reemissoes']), (novo, vez))
            self.assertEqual(self.minha(c)['saldo']['aCaminho'], 1000)
            atual = novo
        # a 4ª recusa: fica estornado, e o Mestre ganha um alerta
        c.pede('POST', '/api/loja/retirar', {})
        r = self.sobe(c, carteira=0, anotacao={'aplicadas': [], 'recusadas': [{'id': atual, 'motivo': 'item-invalido'}]})
        self.assertEqual(r['loja'], {'entregues': [], 'estornados': [atual]})
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 0)
        alertas = self.sql("SELECT tipo, dados FROM contas_alertas WHERE conta_id = ?", c.conta['id'])
        self.assertEqual([a['tipo'] for a in alertas], ['credito-recusado'])
        self.assertEqual(json.loads(alertas[0]['dados'])['pedido'], atual)
        # o presente de vinténs recusado só fecha
        pres = self.semeia_credito(c, 500, origem='presente')
        c.pede('POST', '/api/loja/retirar', {})
        r = self.sobe(c, carteira=0, anotacao={'aplicadas': [], 'recusadas': [{'id': pres, 'motivo': 'item-invalido'}]})
        self.assertEqual(r['loja'], {'entregues': [], 'estornados': [pres]})
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 0)

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
                self.sobe(c, carteira=12000)
                c2 = Cliente(base2)
                c2.token, c2.conta = c.token, c.conta
                res = []

                def vai(cli, sku, chave=None):
                    res.append(self.compra(cli, sku, chave))

                t1 = threading.Thread(target=vai, args=(c, 'classe-invocador'))
                t2 = threading.Thread(target=vai, args=(c2, 'classe-bruxo'))
                t1.start(); t2.start(); t1.join(); t2.join()
                self.assertEqual(sorted(s for s, _ in res), [201, 409], 'rodada %d: %r' % (rodada, res))
                self.assertEqual(self.minha(c)['saldo']['reservado'], 10000)
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
        cartas, uma raridade, quem nasce liberado, uma pedra ou quantas insígnias
        fundam uma guilda, isto grita."""
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
        self.assertEqual(set(comum.INICIAIS), {k for k, v in classes.items() if v['nasce']})
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
        # as insígnias: 10 fundam uma guilda (DATA.insignias.porGuilda, items_selos.js)
        selos = self.le('js/core/data/items_selos.js')
        casou = re.search(r'DATA\.insignias\s*=\s*\{[^}]*porGuilda\s*:\s*(\d+)', selos)
        self.assertIsNotNone(casou, 'DATA.insignias.porGuilda sumiu de items_selos.js')
        self.assertEqual(int(casou.group(1)), loja_mod.INSIGNIAS_POR_GUILDA)
        self.assertEqual(loja_mod.POR_SKU['insignias-10']['qtd'], loja_mod.INSIGNIAS_POR_GUILDA)

    def test_pergaminho_espelha_dados(self):
        """DATA.pergaminhos (progression.js) contra PERGAMINHO_XP: o jogo segue
        lendo o Pergaminho da Sabedoria já comprado."""
        prog = self.le('js/core/data/progression.js')
        casou = re.search(r'DATA\.pergaminhos\s*=\s*\{(.*?)\};', prog, re.S)
        if casou is None:
            self.skipTest('JOGO.DATA.pergaminhos ainda não existe em progression.js')
        corpo = casou.group(1)
        xp = re.search(r'xp\s*:\s*\{([^}]*)\}', corpo).group(1)
        self.assertEqual(float(re.search(r'fator\s*:\s*([\d.]+)', xp).group(1)), loja_mod.PERGAMINHO_XP['fator'])
        self.assertEqual(int(re.search(r'salas\s*:\s*(\d+)', xp).group(1)), loja_mod.PERGAMINHO_XP['salas'])

    def test_bonus_xp_espelha_dados(self):
        """JOGO.DATA.bonusXp.fator (progression.js, da frente do jogo) == BONUS_XP
        (a descrição promete +50%). Se a frente do jogo ainda não entrou, fica
        pulado — a junção roda de novo."""
        prog = self.le('js/core/data/progression.js')
        casou = re.search(r'DATA\.bonusXp\s*=\s*\{([^}]*)\}', prog)
        if casou is None:
            self.skipTest('JOGO.DATA.bonusXp ainda não existe em progression.js')
        self.assertEqual(float(re.search(r'fator\s*:\s*([\d.]+)', casou.group(1)).group(1)), loja_mod.BONUS_XP['fator'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
