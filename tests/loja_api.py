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

13/09, as BARRAS DE OURO: o catálogo v3 custa barras (a moeda de cada item em
`moeda`), com as duas trocas (barras → vinténs e vinténs → barras) no começo;
as compras em barras debitam na hora e cancelar ou estornar devolve; a reserva
de vinténs segue valendo para o que custa vinténs (a troca por barras e os
pedidos antigos). As provas próprias das barras (pacote, estorno, juiz,
concorrência, Mestre) moram em tests/barras_api.py.
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
# 13/09: em barras de ouro, menos a troca de vinténs por barras (em vinténs)
PRECOS = {'boas-vindas': 250,                 # 04/10: o Pacote de Boas-Vindas, no topo
          'vintens-1000': 50, 'vintens-5000': 250, 'vintens-12000': 600, 'vintens-25000': 1250,
          'barras-por-vintens-10': 800, 'barras-por-vintens-50': 4000, 'barras-por-vintens-100': 8000,
          'barras-por-vintens-250': 20000,
          'classe-invocador': 500, 'classe-bruxo': 500, 'classe-espadachim': 1000, 'classe-arqueiro': 1250,
          'classe-minotauro': 1500,
          'bonus-xp-1': 75, 'bonus-xp-3': 195, 'bonus-xp-7': 395,
          'pedras-agua': 25, 'pedras-terra': 25, 'pedras-ar': 40, 'pedras-fogo': 40, 'pedras-neutro': 40,
          'pedras-agua-50': 110, 'pedras-terra-50': 110, 'pedras-ar-50': 180, 'pedras-fogo-50': 180,
          'pedras-neutro-50': 180,
          'insignia-1': 25, 'insignias-10': 225,
          'pergaminho-elemento': 250,
          'aura-fogo': 150, 'aura-agua': 150, 'aura-terra': 150, 'aura-ar': 150, 'aura-neutra': 150}     # 04/10
SECOES = (['boas-vindas'] + ['vintens'] * 4 + ['barras-por-vintens'] * 4 + ['personagens'] * 5 + ['bonus'] * 3 + ['pedras'] * 10
          + ['guilda'] * 2 + ['pergaminhos'] + ['aparencia'] * 5)
GRUPOS = {'pergaminho-elemento', 'classe-invocador', 'classe-bruxo', 'classe-espadachim', 'classe-arqueiro',
          'classe-minotauro',
          'boas-vindas', 'aura-fogo', 'aura-agua', 'aura-terra', 'aura-ar', 'aura-neutra'}    # 04/10: um por conta
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

    def da_barras(self, c, n):
        """13/09: barras de ouro na conta, como um 'ajuste' do dono (o saldo e o extrato juntos)."""
        t = int(time.time())
        self.sql("INSERT INTO barras_saldo(conta_id, saldo, atualizado_em) VALUES (?, ?, ?) "
                 "ON CONFLICT(conta_id) DO UPDATE SET saldo = saldo + excluded.saldo", c.conta['id'], n, t)
        self.sql("INSERT INTO barras_movimentos(conta_id, delta, motivo, ref, saldo_depois, criado_em) "
                 "VALUES (?, ?, 'ajuste', 'prova', (SELECT saldo FROM barras_saldo WHERE conta_id = ?), ?)",
                 c.conta['id'], n, c.conta['id'], t)

    def barras(self, c):
        return self.minha(c)['barras']['saldo']

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
        self.assertEqual((r['ok'], r['versao']), (True, 3))
        itens = r['itens']
        self.assertEqual({i['sku']: i['preco'] for i in itens}, PRECOS)
        self.assertEqual([i['secao'] for i in itens], SECOES)
        # 13/09: a moeda de cada item; só a troca de vinténs por barras custa vinténs
        self.assertEqual({i['sku'] for i in itens if i['moeda'] == 'vintens'},
                         {'barras-por-vintens-10', 'barras-por-vintens-50', 'barras-por-vintens-100',
                          'barras-por-vintens-250'})
        self.assertEqual({i['moeda'] for i in itens}, {'barras', 'vintens'})
        self.assertEqual(r['barras'], {'nome': 'Barras de Ouro', 'vintensPorBarra': 20, 'vintensPorBarraFarmada': 80})
        for i in itens:
            if i['tipo'] == 'vintens':                            # 1 barra = 20 vinténs
                self.assertEqual((i['alvo'], i['preco'] * 20, i['nome']), ('carteira', i['qtd'],
                                                                        '%s vinténs' % loja_mod.milhar(i['qtd'])))
            if i['tipo'] == 'barras':                             # 80 vinténs = 1 barra: 4× mais caro
                self.assertEqual((i['alvo'], i['preco'], i['nome']), ('conta', i['qtd'] * 80,
                                                                   '%s barras de ouro' % loja_mod.milhar(i['qtd'])))
        itens = [i for i in itens if i['tipo'] not in ('vintens', 'barras')]
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
            self.assertIn(i['tipo'], ('classe', 'bonus-xp', 'pedras', 'insignias', 'pergaminho', 'aura', 'pacote'))
            if i['limite'] is not None:
                self.assertEqual(set(i['limite']), {'grupo', 'max', 'dias'})
        # só a Reescrita tem janela; as classes, compra única; o resto, nenhum (o preço é o freio)
        self.assertEqual({i['sku']: i['limite'] for i in itens if i['limite'] is not None and i['limite']['dias']},
                         {'pergaminho-elemento': {'grupo': 'pergaminho-elemento', 'max': 1, 'dias': 30}})
        for i in itens:
            if i['tipo'] in ('classe', 'aura', 'pacote'):         # 04/10: a aura e o Pacote, um por conta
                self.assertEqual(i['limite'], {'grupo': i['sku'], 'max': 1, 'dias': None})
            elif i['tipo'] != 'pergaminho':
                self.assertIsNone(i['limite'], i['sku'])
        pedras = [i for i in itens if i['tipo'] == 'pedras']
        self.assertEqual(sorted(i['qtd'] for i in pedras), [10] * 5 + [50] * 5)
        for i in pedras:
            dez = [j for j in pedras if j['alvo'] == i['alvo'] and j['qtd'] == 10][0]
            if i['qtd'] == 50:                                    # o pacote de 50 sai mais barato que 5 de 10
                self.assertLess(i['preco'], dez['preco'] * 5, i['sku'])
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
        # a régua: personagem = 50 barras de ouro (1.000 vinténs) por carta do desbloqueio
        for i in itens:
            if i['tipo'] == 'classe':
                self.assertEqual(i['preco'], 50 * i['cartas'], i['sku'])
        # os pacotes de BARRAS em reais, formatados pelo servidor; o pagamento desligado (sem as variáveis)
        self.assertEqual(r['pacotes'], [
            {'id': 'barras-50', 'nome': 'Bolsa de 50 barras de ouro', 'moeda': 'barras', 'barras': 50, 'centavos': 490,
             'preco': 'R$ 4,90'},
            {'id': 'barras-280', 'nome': 'Saco de 280 barras de ouro', 'moeda': 'barras', 'barras': 280,
             'centavos': 1990, 'preco': 'R$ 19,90'},
            {'id': 'barras-600', 'nome': 'Arca de 600 barras de ouro', 'moeda': 'barras', 'barras': 600,
             'centavos': 3990, 'preco': 'R$ 39,90'},
            {'id': 'barras-1250', 'nome': 'Tesouro de 1.250 barras de ouro', 'moeda': 'barras', 'barras': 1250,
             'centavos': 7990, 'preco': 'R$ 79,90'}])
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
                            ({'sku': 'barras-50', 'idem': idem()}, 'produto desconhecido'),
                            ({'sku': 'presente-vintens', 'idem': idem()}, 'produto desconhecido'),
                            ({'sku': None, 'idem': idem()}, 'produto desconhecido'),
                            ({'sku': 'pedras-agua'}, 'idem inválido (8 a 64 letras, dígitos, _ ou -)'),
                            ({'sku': 'pedras-agua', 'idem': 'curto'}, 'idem inválido (8 a 64 letras, dígitos, _ ou -)'),
                            ({'sku': 'pedras-agua', 'idem': 'mp:12345678'}, 'idem inválido (8 a 64 letras, dígitos, _ ou -)'),
                            ({'sku': 'pedras-agua', 'idem': 'tem espaço aqui'}, 'idem inválido (8 a 64 letras, dígitos, _ ou -)'),
                            ({'sku': 'pedras-agua', 'idem': 'x' * 65}, 'idem inválido (8 a 64 letras, dígitos, _ ou -)')):
            status, r = c.pede('POST', '/api/loja/comprar', corpo)
            self.assertEqual((status, r.get('erro')), (400, erro), corpo)
        # 13/09: o item em barras não precisa do save (as barras moram aqui): sem barras, é o 409 das barras
        status, r = self.compra(c, 'pedras-agua')
        self.assertEqual((status, r['erro'], r['barras']), (409, 'barras de ouro insuficientes', {'saldo': 0}))
        # o que custa vinténs (a troca por barras) ainda precisa de o servidor ver a carteira
        status, r = self.compra(c, 'barras-por-vintens-10')
        self.assertEqual((status, r['erro']), (409, 'o servidor ainda não viu seus vinténs: abra o jogo logado nesta '
                                                    'conta (na conta Principal)'))
        m = self.minha(c)
        self.assertEqual(m['saldo'], {'carteira': 0, 'reservado': 0, 'aCaminho': 0, 'disponivel': 0, 'semFundo': False,
                                      'saveVersao': 0, 'saveEm': None})
        self.assertEqual(m['barras'], {'saldo': 0, 'movimentos': []})
        self.assertEqual(m['pedidos'], [])
        self.assertEqual(m['classes'], {k: {'liberada': False, 'cartas': 0}
                                        for k in ('invocador', 'bruxo', 'espadachim', 'arqueiro', 'minotauro')})
        self.assertEqual(set(m['limites']), GRUPOS)
        self.assertEqual(m['limites']['pergaminho-elemento'], {'usados': 0, 'max': 1, 'dias': 30, 'liberaEm': None})

    def test_sem_a_autoridade_a_fila_continua_e_o_jogo_e_avisado_ja(self):
        """04/10: a entrega na hora é do servidor com a autoridade (tests/autoridade_api.py). Em casa, sem o
        juiz, a compra continua um pedido na fila — mas o /api/eu que o jogo pergunta a cada 30 s conta os
        pedidos que esperam, e o jogo aberto busca logo, sem esperar o ciclo de 5 minutos."""
        c = self.novo('Fila De Casa')
        self.sobe(c, carteira=1000)
        status, eu = c.pede('GET', '/api/eu')
        self.assertEqual(eu['lojaAbertos'], 0)
        status, r = self.compra(c, 'barras-por-vintens-10')
        self.assertEqual((status, r['pedido']['estado'], r.get('naHora'), r['barras']['saldo']), (201, 'pendente', None, 0), r)
        self.assertNotIn('espera', r['pedido'])
        status, eu = c.pede('GET', '/api/eu')
        self.assertEqual(eu['lojaAbertos'], 1)
        status, r = c.pede('POST', '/api/loja/retirar', {})
        self.assertEqual(len(r['pedidos']), 1)
        status, eu = c.pede('GET', '/api/eu')
        self.assertEqual(eu['lojaAbertos'], 0, 'o que o jogo já buscou não chama de novo')

    def test_reserva(self):
        """A reserva de VINTÉNS (13/09: o que custa vinténs é a troca por barras de ouro)."""
        c = self.novo('Rosa Reserva')
        self.sobe(c, carteira=12000)
        status, r = self.compra(c, 'barras-por-vintens-100')
        self.assertEqual(status, 201, r)
        self.assertEqual({k: r['pedido'][k] for k in ('preco', 'estado', 'nome', 'moeda', 'ganhaBarras')},
                         {'preco': 8000, 'estado': 'pendente', 'nome': '100 barras de ouro', 'moeda': 'vintens',
                          'ganhaBarras': 100})
        self.assertNotIn('origem', r['pedido'])
        self.assertEqual({k: r['saldo'][k] for k in ('carteira', 'reservado', 'aCaminho', 'disponivel', 'semFundo')},
                         {'carteira': 12000, 'reservado': 8000, 'aCaminho': 0, 'disponivel': 4000, 'semFundo': False})
        self.assertEqual(r['barras'], {'saldo': 0})                    # as barras só entram na entrega
        status, r = self.compra(c, 'barras-por-vintens-100')           # 8.000 de novo: só há 4.000 livres
        self.assertEqual((status, r['erro'], r['saldo']['disponivel']), (409, 'vinténs insuficientes', 4000))
        status, r = self.compra(c, 'barras-por-vintens-10')
        self.assertEqual((status, r['saldo']['disponivel']), (201, 3200))
        m = self.minha(c)
        self.assertEqual((m['saldo']['reservado'], m['saldo']['disponivel']), (8800, 3200))
        self.assertEqual([p['sku'] for p in m['pedidos']], ['barras-por-vintens-10', 'barras-por-vintens-100'])
        self.assertTrue(m['saldo']['saveVersao'] >= 1 and m['saldo']['saveEm'])

    def test_idem_repetido(self):
        c = self.novo('Ivo Idem')
        self.sobe(c, carteira=5000)
        self.da_barras(c, 100)
        chave = idem()
        status, r1 = self.compra(c, 'pedras-terra', chave)
        self.assertEqual(status, 201, r1)
        status, r2 = self.compra(c, 'pedras-terra', chave)     # o mesmo clique, de novo
        self.assertEqual(status, 200, r2)
        self.assertEqual(r2['pedido']['id'], r1['pedido']['id'])
        self.assertEqual((r2['saldo']['reservado'], r2['barras']['saldo']), (0, 75))   # as barras saíram uma vez só
        status, r = self.compra(c, 'pedras-ar', chave)
        self.assertEqual((status, r['erro']), (409, 'idem já usado em outro produto'))
        self.assertEqual(len(self.minha(c)['pedidos']), 1)
        # o idem é por conta: outra conta pode usar a mesma chave
        d = self.novo('Ivo Outro')
        self.sobe(d, carteira=500)
        self.da_barras(d, 25)
        self.assertEqual(self.compra(d, 'pedras-terra', chave)[0], 201)

    def test_retirar_e_cancelar(self):
        c = self.novo('Rita Retira')
        self.sobe(c, carteira=5000)
        self.da_barras(c, 1000)
        p1, p2 = self.comprou(c, 'pedras-agua'), self.comprou(c, 'pedras-terra-50')
        self.assertEqual((p1['moeda'], p1['barras'], p1['preco'], self.barras(c)), ('barras', 25, 0, 865))
        status, r = c.pede('POST', '/api/loja/retirar', {})
        self.assertEqual(status, 200, r)
        self.assertEqual(r['pedidos'], [                                  # pagos em barras: preço 0 em vinténs
            {'id': p1['id'], 'sku': 'pedras-agua', 'nome': '10 Lágrimas de Cisterna', 'preco': 0,
             'entrega': {'tipo': 'pedras', 'alvo': 'stone-tear', 'qtd': 10}},
            {'id': p2['id'], 'sku': 'pedras-terra-50', 'nome': '50 Grãos de Rocha-Mãe', 'preco': 0,
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
        self.assertEqual((r['pedido']['estado'], r['barras']['saldo']), ('cancelado', 890))   # as 25 barras voltaram
        self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': p1['id']})[1]['erro'], 'pedido já fechado')
        self.assertEqual(self.barras(c), 890)                                               # uma vez só
        # pendente cancela e devolve as barras
        p3 = self.comprou(c, 'pedras-ar')
        self.assertEqual(self.barras(c), 850)
        status, r = c.pede('POST', '/api/loja/cancelar', {'id': p3['id']})
        self.assertEqual((status, r['barras']['saldo']), (200, 890))
        movs = self.minha(c)['barras']['movimentos']
        self.assertEqual([(x['motivo'], x['delta'], x['pedido']) for x in movs[:2]],
                         [('estorno-loja', 40, p3['id']), ('loja', -40, p3['id'])])
        self.assertEqual(movs[0]['nome'], '10 Sopros Engarrafados')
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
        self.da_barras(c, 1000)
        self.da_barras(d, 100)
        p1, p2, p3 = (self.comprou(c, s) for s in ('pedras-agua', 'pedras-terra', 'pedras-ar'))     # 1.000 → 910
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
        self.assertEqual(m['barras']['saldo'], 975)                           # as barras de p2 e p3 voltaram
        self.assertEqual(self.sql("SELECT versao_save FROM loja_pedidos WHERE id = ?", p1['id'])[0][0], r['versao'])
        self.assertEqual(self.pedido(d, q['id'])['estado'], 'pendente')       # o da outra conta ficou
        # a mesma anotação de novo: nada muda (já fechados), nem as barras
        self.assertEqual(self.sobe(c, carteira=1500, anotacao=anot)['loja'], {'entregues': [], 'estornados': []})
        self.assertEqual(self.barras(c), 975)
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
        # cancelado e depois aplicado mesmo assim (o jogo não soube): vira entregue, com o evento na trilha;
        # as barras que o cancelamento devolveu saem de novo (13/09)
        self.assertEqual(self.barras(c), 935)                                 # 975 − 40 da pedras-fogo
        p5 = self.comprou(c, 'insignia-1')
        self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': p5['id']})[0], 200)
        self.assertEqual(self.barras(c), 935)
        r = self.sobe(c, carteira=200, anotacao={'aplicadas': [p1['id'], p4['id'], p5['id']], 'recusadas': []})
        self.assertEqual(r['loja']['entregues'], [p5['id']])
        self.assertEqual(self.barras(c), 910)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM contas_alertas WHERE conta_id = ?", c.conta['id'])[0][0], 0)
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
        self.da_barras(c, 10000)
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
        self.da_barras(c, 1000)
        self.assertEqual(self.compra(c, 'pergaminho-elemento')[1]['erro'], 'nenhum herói escolheu caminho elemental ainda')
        self.assertEqual(self.compra(c, 'bonus-xp-1')[0], 201)
        self.assertEqual(self.compra(c, 'bonus-xp-1')[0], 201)             # sem janela: comprar de novo soma os dias
        t = self.novo('Tina Topo')
        self.sobe(t, carteira=20000, herois={'sumo': {'classId': 'sumo', 'xp': comum.XP_MAX, 'level': 30,
                                                      'element': 'agua', 'elements': ['agua']},
                                             'curandeira': {'xp': comum.XP_MAX + 500, 'level': 30},
                                             'gm': dict(gm_heroi, xp=10)})
        self.da_barras(t, 1000)
        # o bônus de XP com todos no nível 30 VENDE: no jogo ele ainda rende a fatia do pet e o dízimo
        # (conserto 11/09; a recusa do nível 30 ficou só no Sabedoria, que tem carga a poupar e saiu da venda)
        self.assertEqual(self.compra(t, 'bonus-xp-1')[0], 201)
        self.assertEqual(self.compra(t, 'pergaminho-elemento')[0], 201)
        # um caminho só na lista (o ativo voltou a neutro por um save antigo) também conta como escolhido
        e = self.novo('Elo Lista')
        self.sobe(e, carteira=20000, herois={'bruxo#2': {'classId': 'bruxo', 'xp': 5, 'level': 5, 'element': 'neutro',
                                                         'elements': ['terra']}})
        self.da_barras(e, 1000)
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
        self.da_barras(c, 5000)
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
        self.da_barras(c, 5000)
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
        self.da_barras(c, 5000)
        for s in ('bonus-xp-1', 'pergaminho-elemento', 'classe-invocador', 'classe-bruxo', 'pedras-agua'):
            self.comprou(c, s)
        status, r = self.compra(c, 'classe-espadachim')
        self.assertEqual((status, r['erro']), (429, 'pedidos abertos demais (5)'))
        # 10 por hora (pendente, retirado e entregue contam; cancelado não)
        h = self.novo('Hugo Hora')
        self.sobe(h, carteira=100000)
        self.da_barras(h, 5000)
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
        self.da_barras(c, 5000)
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
        self.da_barras(c, 5000)
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
        self.assertEqual((r['barras'], r['pedido']['moeda']), ({'saldo': 0}, None))    # nem vintém nem barra
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
        # a conta nunca abriu o jogo (sem save) e compra com o vintém a caminho (13/09: a troca por barras); a
        # Reescrita, não
        self.assertEqual(self.compra(c, 'pergaminho-elemento')[1]['erro'], 'nenhum herói escolheu caminho elemental ainda')
        status, r = self.compra(c, 'barras-por-vintens-100')
        self.assertEqual(status, 201, r)
        self.assertEqual((r['saldo']['aCaminho'], r['saldo']['reservado'], r['saldo']['disponivel']), (12000, 8000, 4000))
        status, r = self.compra(c, 'barras-por-vintens-100')
        self.assertEqual((status, r['erro'], r['saldo']['disponivel']), (409, 'vinténs insuficientes', 4000))
        # o crédito de pacote não se cancela pelo site
        status, r = c.pede('POST', '/api/loja/cancelar', {'id': cred})
        self.assertEqual((status, r['erro']), (409, 'vinténs de pacote não se cancelam: eles entram sozinhos na conta'))
        # o retirar: o crédito (id menor) antes da compra; origem só no crédito
        r = c.pede('POST', '/api/loja/retirar', {})[1]
        self.assertEqual([p['id'] for p in r['pedidos']], sorted(p['id'] for p in r['pedidos']))
        self.assertEqual(r['pedidos'][0], {'id': cred, 'sku': 'pacote-12000', 'nome': 'Arca de 12.000 vinténs', 'preco': 0,
                                           'entrega': {'tipo': 'vintens', 'alvo': 'carteira', 'qtd': 12000},
                                           'origem': 'pagamento'})
        self.assertNotIn('origem', r['pedidos'][1])
        # o jogo soma o crédito (0 → 12.000), paga a troca (→ 4.000) e o PUT fecha os dois; as barras entram agora
        self.assertEqual(self.barras(c), 0)
        anot = {'aplicadas': [p['id'] for p in r['pedidos']], 'recusadas': []}
        r = self.sobe(c, carteira=4000, anotacao=anot)
        self.assertEqual(len(r['loja']['entregues']), 2)
        m = self.minha(c)
        self.assertEqual({k: m['saldo'][k] for k in ('carteira', 'reservado', 'aCaminho', 'disponivel')},
                         {'carteira': 4000, 'reservado': 0, 'aCaminho': 0, 'disponivel': 4000})
        self.assertEqual((m['barras']['saldo'], m['barras']['movimentos'][0]['motivo'], m['barras']['movimentos'][0]['delta']),
                         (100, 'troca-vintens', 100))
        self.sobe(c, carteira=4000, anotacao=anot)                   # a mesma anotação: as barras não entram de novo
        self.assertEqual(self.barras(c), 100)
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
        self.da_barras(c, 1000)
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
        self.da_barras(c, 1000)
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
                self.da_barras(c, 600)                  # 13/09: barras para UMA classe de 500
                c2 = Cliente(base2)
                c2.token, c2.conta = c.token, c.conta
                res = []

                def vai(cli, sku, chave=None):
                    res.append(self.compra(cli, sku, chave))

                t1 = threading.Thread(target=vai, args=(c, 'classe-invocador'))
                t2 = threading.Thread(target=vai, args=(c2, 'classe-bruxo'))
                t1.start(); t2.start(); t1.join(); t2.join()
                self.assertEqual(sorted(s for s, _ in res), [201, 409], 'rodada %d: %r' % (rodada, res))
                self.assertEqual(self.barras(c), 100)            # a barra nunca fica negativa nem sai duas vezes
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


class ProvaDasNovidades(ProvaDaLoja):
    """04/10: o Pacote de Boas-Vindas, as auras, as ofertas da semana e o presente a um amigo.

    Sobe uma API PRÓPRIA com as ofertas LIGADAS (LOJA_OFERTAS=1): a classe de cima conta barras com os preços
    cheios, e a oferta muda conforme a semana do calendário. Daqui só se herdam os ajudantes."""

    @classmethod
    def setUpClass(cls):
        os.environ['LOJA_OFERTAS'] = '1'
        try:
            super().setUpClass()
        finally:
            os.environ['LOJA_OFERTAS'] = '0'

    def setUp(self):
        loja_mod.OFERTAS_LIGADAS = True              # as contas desta prova usam as mesmas funções do servidor
        self.addCleanup(setattr, loja_mod, 'OFERTAS_LIGADAS', False)

    def preco(self, sku):
        return loja_mod.preco_de(loja_mod.POR_SKU[sku], time.time())

    def fora_da_oferta(self, secao):
        """Um item da seção que NÃO está em oferta nesta semana (custa o preço cheio)."""
        hoje = loja_mod.ofertas_da_semana(loja_mod.semana_de(time.time()))
        return [i['sku'] for i in loja_mod.CATALOGO if i['secao'] == secao and i['sku'] not in hoje][0]

    def presenteia(self, c, sku, nome, chave=None):
        return c.pede('POST', '/api/loja/presentear', {'sku': sku, 'nome': nome, 'idem': chave or idem()})

    # herdadas da prova de cima: rodariam de novo aqui, com as ofertas mexendo nos preços que elas fixam
    for _nome in [n for n in dir(ProvaDaLoja) if n.startswith('test_')]:
        locals()[_nome] = None
    del _nome

    # -- o Pacote de Boas-Vindas ---------------------------------------------------------------
    def test_boas_vindas_uma_vez_por_conta(self):
        c = self.novo('Bia Boas Vindas')
        self.sobe(c)
        self.da_barras(c, 700)
        m = self.minha(c)
        self.assertEqual(m['boasVindas'], {'disponivel': True, 'comprado': False, 'preco': 250, 'precoCheio': 820,
                                           'classes': ['invocador', 'bruxo']})
        corpo = {'sku': 'boas-vindas', 'idem': idem()}
        self.assertEqual(c.pede('POST', '/api/loja/comprar', corpo)[0], 400)                 # sem as escolhas
        self.assertEqual(c.pede('POST', '/api/loja/comprar', dict(corpo, classe='minotauro', aura='fogo'))[0], 400)
        self.assertEqual(c.pede('POST', '/api/loja/comprar', dict(corpo, classe='bruxo', aura='roxa'))[0], 400)
        self.assertEqual(self.barras(c), 700)
        corpo = dict(corpo, classe='invocador', aura='fogo')
        status, r = c.pede('POST', '/api/loja/comprar', corpo)
        self.assertEqual(status, 201, r)
        pid = r['pedido']['id']
        self.assertEqual((r['pedido']['estado'], r['pedido']['barras'], r['barras']['saldo']), ('pendente', 250, 450))
        self.assertEqual(c.pede('POST', '/api/loja/comprar', corpo)[0], 200)                 # o mesmo clique: nada de novo
        self.assertEqual(self.barras(c), 450)
        # a entrega congelada: 10 pedras de cada uma das cinco, a classe escolhida e a aura
        ent = json.loads(self.sql("SELECT entrega FROM loja_pedidos WHERE id = ?", pid)[0]['entrega'])
        self.assertEqual((ent['tipo'], ent['aura'], len(ent['itens'])), ('pacote', 'fogo', 6))
        self.assertEqual([(i['tipo'], i['qtd']) for i in ent['itens']], [('pedras', 10)] * 5 + [('classe', 1)])
        self.assertEqual(ent['itens'][-1]['alvo'], 'invocador')
        # UMA vez por conta: a segunda compra (outro clique, outra classe) é recusada e nada é cobrado
        status, r = c.pede('POST', '/api/loja/comprar', {'sku': 'boas-vindas', 'idem': idem(), 'classe': 'bruxo',
                                                         'aura': 'agua'})
        self.assertEqual((status, r['erro']), (429, 'limite deste produto: 1 por conta'))
        self.assertEqual(self.barras(c), 450)
        m = self.minha(c)
        self.assertEqual((m['boasVindas']['disponivel'], m['boasVindas']['comprado']), (False, True))
        self.assertEqual(m['auras']['tem'], ['fogo'])                                        # a aura já é da conta
        # a classe do pacote está a caminho: comprá-la avulsa é recusado
        self.assertEqual(self.compra(c, 'classe-invocador')[0], 409)
        # o jogo recebe o pacote pela fila de sempre e o save confirma
        fila = c.pede('POST', '/api/loja/retirar', {})[1]['pedidos']
        self.assertEqual([(p['id'], p['entrega']['tipo']) for p in fila], [(pid, 'pacote')])
        self.sobe(c, classes=('sumo', 'curandeiro', 'invocador'), anotacao={'aplicadas': [pid]})
        self.assertEqual(self.pedido(c, pid)['estado'], 'entregue')
        # entregue: continua sendo uma vez só, para sempre
        status, r = c.pede('POST', '/api/loja/comprar', {'sku': 'boas-vindas', 'idem': idem(), 'classe': 'bruxo',
                                                         'aura': 'agua'})
        self.assertEqual(status, 429, r)
        self.assertEqual(self.barras(c), 450)

    def test_boas_vindas_recusado_devolve_tudo(self):
        """O jogo recusou o pacote (a classe liberou por cartas no meio do caminho): as barras voltam, a aura
        sai com o pedido — e a vestida também — e o pacote volta a estar disponível."""
        c = self.novo('Rui Recusado')
        self.sobe(c)
        self.da_barras(c, 250)
        status, r = c.pede('POST', '/api/loja/comprar', {'sku': 'boas-vindas', 'idem': idem(), 'classe': 'bruxo',
                                                         'aura': 'ar'})
        self.assertEqual(status, 201, r)
        pid = r['pedido']['id']
        self.assertEqual(c.pede('POST', '/api/loja/aura', {'aura': 'ar'})[1]['auras']['escolhida'], 'ar')
        c.pede('POST', '/api/loja/retirar', {})
        self.sobe(c, anotacao={'recusadas': [{'id': pid, 'motivo': 'classe-ja-liberada'}]})
        m = self.minha(c)
        self.assertEqual((self.pedido(c, pid)['estado'], m['barras']['saldo']), ('estornado', 250))
        self.assertEqual((m['auras']['tem'], m['auras']['escolhida']), ([], None))
        self.assertEqual(self.sql("SELECT COUNT(*) FROM aura_escolhida WHERE conta_id = ?", c.conta['id'])[0][0], 0)
        self.assertTrue(m['boasVindas']['disponivel'])
        # quem já tem as duas classes não vê a chamada
        self.sobe(c, classes=('sumo', 'curandeiro', 'invocador', 'bruxo'))
        self.assertEqual(self.minha(c)['boasVindas']['disponivel'], False)
        self.assertEqual(c.pede('GET', '/api/loja/vitrine')[1]['boasVindas']['disponivel'], False)

    # -- as auras -----------------------------------------------------------------------------
    def test_mestre_tem_todas_as_auras(self):
        """04/10, o dono: "o super admin tem que ter todas auras liberadas". A conta marcada como
        Mestre possui as cinco sem comprar: a ficha (GET /api/loja/aura e a vitrine) mostra todas, a
        escolha é aceita e o Relé carimba a escolhida. O jogador comum segue sem nenhuma."""
        import rele_ident
        todas = list(loja_mod.AURAS)
        m = self.novo('Zulu Todas Auras')
        self.assertEqual(m.pede('GET', '/api/loja/aura')[1]['auras']['tem'], [])              # ainda é conta comum
        self.assertEqual(m.pede('POST', '/api/loja/aura', {'aura': 'fogo'})[0], 409)
        self.mestre(m)
        self.assertEqual(self.barras(m), 0)                                                   # sem comprar nada
        status, r = m.pede('GET', '/api/loja/aura')
        self.assertEqual((status, r['auras']['tem'], r['auras']['escolhida']), (200, todas, None))
        self.assertEqual(m.pede('GET', '/api/loja/vitrine')[1]['auras']['tem'], todas)
        for cor in todas:                                                                     # cada uma é aceita
            status, r = m.pede('POST', '/api/loja/aura', {'aura': cor})
            self.assertEqual((status, r['auras']['escolhida'], r['auras']['tem']), (200, cor, todas))
        self.assertEqual(m.pede('GET', '/api/loja/vitrine')[1]['auras']['escolhida'], todas[-1])
        self.assertEqual(m.pede('POST', '/api/loja/aura', {'aura': 'dourada'})[0], 400)       # a que não existe, não
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM loja_pedidos WHERE conta_id = ?", m.conta['id'])[0]['n'], 0)
        # o Relé lê a escolhida do banco e a carimba no oi do Mestre
        conta, _ = rele_ident.confere(self.banco_arq, m.token)
        self.assertEqual((conta['gm'], conta['aura']), (True, todas[-1]))
        oi = {'t': 'oi', 'de': 'xm', 'nome': 'Oda'}
        self.assertEqual(rele_ident.carimba(oi, conta, so_cache=True)['auraCor'], todas[-1])
        # a compra confere só o que foi COMPRADO: o Mestre segue podendo comprar (e testar) a loja
        self.da_barras(m, 400)
        self.comprou(m, 'aura-agua')
        self.assertEqual(self.compra(m, 'aura-agua')[0], 409)
        self.assertEqual(m.pede('GET', '/api/loja/aura')[1]['auras']['tem'], todas)
        # o jogador comum não muda: nenhuma aura, nenhuma escolha aceita
        c = self.novo('Comum Sem Aura')
        self.assertEqual(c.pede('GET', '/api/loja/aura')[1]['auras']['tem'], [])
        self.assertEqual(c.pede('POST', '/api/loja/aura', {'aura': 'fogo'})[0], 409)
        # tirada a marca, a escolhida que ele não comprou deixa de valer; a comprada fica
        self.sql("UPDATE contas SET gm = 0 WHERE id = ?", m.conta['id'])
        r = m.pede('GET', '/api/loja/aura')[1]['auras']
        self.assertEqual((r['tem'], r['escolhida']), (['agua'], None))

    def test_aura_comprada_escolhida_e_lida_de_volta(self):
        import rele_ident
        self.assertEqual(rele_ident.AURAS, loja_mod.AURAS)                                   # os gêmeos
        self.assertEqual({i['alvo'] for i in loja_mod.CATALOGO if i['tipo'] == 'aura'}, set(loja_mod.AURAS))
        c = self.novo('Aurora Aura')
        self.da_barras(c, 400)                                                               # sem save: a aura não precisa do jogo
        custo = self.preco('aura-agua')
        self.assertEqual(c.pede('POST', '/api/loja/aura', {'aura': 'agua'})[0], 409)         # ainda não tem
        p = self.comprou(c, 'aura-agua')
        self.assertEqual((p['estado'], p['barras'], p['cancelavel']), ('entregue', custo, False))
        self.assertEqual(self.barras(c), 400 - custo)
        self.assertEqual(c.pede('POST', '/api/loja/retirar', {})[1]['pedidos'], [])           # nada vai para o jogo
        status, r = self.compra(c, 'aura-agua')                                              # de novo: já é dela
        self.assertEqual((status, r['erro']), (409, 'essa aura já é sua'))
        self.assertEqual(self.barras(c), 400 - custo)
        # escolher, ler de volta (pela ficha do jogo e pela vitrine), trocar e desligar
        status, r = c.pede('GET', '/api/loja/aura')
        self.assertEqual((r['auras']['tem'], r['auras']['escolhida']), (['agua'], None))
        self.assertEqual([a['cor'] for a in r['auras']['todas']], list(loja_mod.AURAS))
        status, r = c.pede('POST', '/api/loja/aura', {'aura': 'agua'})
        self.assertEqual((status, r['auras']['escolhida']), (200, 'agua'))
        self.assertEqual(c.pede('GET', '/api/loja/aura')[1]['auras']['escolhida'], 'agua')
        self.assertEqual(c.pede('GET', '/api/loja/vitrine')[1]['auras']['escolhida'], 'agua')
        self.assertEqual(self.minha(c)['auras']['escolhida'], 'agua')
        self.assertEqual(c.pede('POST', '/api/loja/aura', {'aura': 'fogo'})[0], 409)         # a que não comprou
        self.assertEqual(c.pede('POST', '/api/loja/aura', {'aura': 'dourada'})[0], 400)
        self.assertEqual(c.pede('GET', '/api/loja/aura')[1]['auras']['escolhida'], 'agua')    # a recusa não mexe
        self.assertEqual(c.pede('GET', '/api/loja/aura', token=None)[0], 401)
        # O RELÉ lê a escolhida do banco e a carimba no oi; o que o cliente disser de si mesmo cai
        conta, definitivo = rele_ident.confere(self.banco_arq, c.token)
        self.assertEqual((definitivo, conta['aura']), (True, 'agua'))
        oi = {'t': 'oi', 'de': 'x1', 'nome': 'Aurora', 'auraCor': 'fogo'}
        self.assertEqual(rele_ident.carimba(oi, conta, so_cache=True)['auraCor'], 'agua')
        outro = self.novo('Zeca Sem Aura')
        conta2, _ = rele_ident.confere(self.banco_arq, outro.token)
        self.assertNotIn('aura', conta2)
        oi = {'t': 'oi', 'de': 'x2', 'nome': 'Zeca', 'auraCor': 'fogo'}
        self.assertNotIn('auraCor', rele_ident.carimba(oi, conta2, so_cache=True))
        oi = {'t': 'oi', 'de': 'x3', 'nome': 'Anônimo', 'auraCor': 'ar'}
        self.assertNotIn('auraCor', rele_ident.carimba(oi, None, so_cache=True))
        # desligar
        self.assertEqual(c.pede('POST', '/api/loja/aura', {'aura': None})[1]['auras']['escolhida'], None)
        self.assertNotIn('aura', rele_ident.confere(self.banco_arq, c.token)[0])

    # -- as ofertas da semana -----------------------------------------------------------------
    def test_oferta_da_semana_deterministica_e_cobrada(self):
        t = int(time.time())
        semana = loja_mod.semana_de(t)
        # determinística: a mesma semana dá sempre os mesmos itens; semanas diferentes giram
        self.assertEqual(loja_mod.ofertas_da_semana(semana), loja_mod.ofertas_da_semana(semana))
        self.assertGreater(len({loja_mod.ofertas_da_semana(semana + k) for k in range(8)}), 1)
        for k in range(60):
            skus = loja_mod.ofertas_da_semana(semana + k)
            itens = [loja_mod.POR_SKU[s] for s in skus]
            self.assertEqual(len(skus), 3)
            self.assertEqual(len({i['secao'] for i in itens}), 3)                            # três seções diferentes
            for i in itens:                                                                  # nunca moeda nem o Pacote
                self.assertNotIn(i['tipo'], ('vintens', 'barras', 'pacote'), skus)
                self.assertEqual(i['moeda'], 'barras')
        # a semana vira na segunda, 00:00 de Brasília (03:00 UTC)
        from datetime import datetime, timedelta, timezone
        status, r = Cliente(self.base).pede('GET', '/api/loja/catalogo', token=None)
        of = r['ofertas']
        fim = datetime.fromtimestamp(of['fim'], timezone(timedelta(hours=-3)))
        self.assertEqual((fim.weekday(), fim.hour, fim.minute, fim.second), (0, 0, 0, 0))
        self.assertEqual(of['fim'] - of['inicio'], 7 * DIA)
        self.assertTrue(of['inicio'] <= r['agora'] < of['fim'])
        self.assertTrue(abs(r['agora'] - t) < 30)
        self.assertEqual((of['desconto'], of['semana']), (25, semana))
        self.assertEqual([i['sku'] for i in of['itens']], list(loja_mod.ofertas_da_semana(semana)))
        self.assertEqual(loja_mod.preco_com_desconto(150), 113)                              # para cima: nunca mais de 25%
        self.assertEqual(loja_mod.preco_com_desconto(500), 375)
        # o preço COBRADO é o da oferta; o do catálogo segue cheio (o site risca um e mostra o outro)
        cheios = {i['sku']: i['preco'] for i in r['itens']}
        c = self.novo('Olga Oferta')
        self.sobe(c)
        self.da_barras(c, 5000)
        saldo = 5000
        for o in of['itens']:
            cheio = loja_mod.POR_SKU[o['sku']]['preco']
            self.assertEqual((o['precoCheio'], cheios[o['sku']]), (cheio, cheio))
            self.assertEqual(o['preco'], -(-cheio * 75 // 100))
            self.assertLess(o['preco'], cheio)
            p = self.comprou(c, o['sku'])
            saldo -= o['preco']
            self.assertEqual((p['barras'], self.barras(c)), (o['preco'], saldo), o)
            self.assertEqual(self.sql("SELECT custo FROM loja_barras WHERE pedido_id = ?", p['id'])[0]['custo'], o['preco'])
            if p['cancelavel']:                                                              # cancelar devolve o que foi cobrado
                self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': p['id']})[0], 200)
                saldo += o['preco']
                self.assertEqual(self.barras(c), saldo)
        # fora da oferta, o preço cheio
        sku = self.fora_da_oferta('pedras')
        self.comprou(c, sku)
        self.assertEqual(self.barras(c), saldo - loja_mod.POR_SKU[sku]['preco'])
        # LOJA_OFERTAS=0 (a chave do dono): sem oferta, tudo no preço cheio
        loja_mod.OFERTAS_LIGADAS = False
        self.assertEqual(loja_mod.ofertas_da_semana(semana), ())
        self.assertEqual(loja_mod.preco_de(loja_mod.POR_SKU[of['itens'][0]['sku']], t), cheios[of['itens'][0]['sku']])

    # -- o presente a um amigo ------------------------------------------------------------------
    def test_presente_a_um_amigo(self):
        a, b = self.novo('Dora Doadora'), self.novo('Rita Recebe')
        na, nb = a.conta['nome'], b.conta['nome']
        self.sobe(b, classes=('sumo', 'curandeiro', 'bruxo'))
        self.da_barras(a, 2000)
        # AS TRAVAS — nenhuma cobra nada nem conta no limite do dia
        self.assertEqual(self.presenteia(a, 'pedras-agua', 'Ninguém Com Esse Nome 999')[0], 404)
        status, r = self.presenteia(a, 'pedras-agua', na)
        self.assertEqual((status, r['erro']), (400, 'você não pode presentear a si mesmo'))
        for sku in ('vintens-1000', 'barras-por-vintens-10', 'boas-vindas'):                 # moeda e o Pacote: nunca
            status, r = self.presenteia(a, sku, nb)
            self.assertEqual((status, r['erro']), (400, 'esse produto não pode ser dado de presente'), sku)
        self.assertEqual(self.presenteia(a, 'inventado', nb)[0], 400)
        self.assertEqual(a.pede('POST', '/api/loja/presentear', {'sku': 'pedras-agua', 'nome': nb, 'idem': 'x'})[0], 400)
        self.assertEqual(Cliente(self.base).pede('POST', '/api/loja/presentear',
                                                 {'sku': 'pedras-agua', 'nome': nb, 'idem': idem()}, token=None)[0], 401)
        status, r = self.presenteia(a, 'classe-bruxo', nb)                                   # a classe que ela já tem
        self.assertEqual(status, 409, r)
        self.assertIn('essa classe já está liberada', r['erro'])
        banido, excluido = self.novo('Beto Banido'), self.novo('Eva Excluída')
        self.sql("UPDATE contas SET banido = 1 WHERE id = ?", banido.conta['id'])
        self.sql("INSERT INTO contas_excluidas(conta_id, excluida_em) VALUES (?, ?)", excluido.conta['id'], int(time.time()))
        self.assertEqual(self.presenteia(a, 'pedras-agua', banido.conta['nome'])[0], 409)
        self.assertEqual(self.presenteia(a, 'pedras-agua', excluido.conta['nome'])[0], 404)
        pobre = self.novo('Pedro Sem Barras')
        status, r = self.presenteia(pobre, 'pedras-agua', nb)
        self.assertEqual((status, r['erro']), (409, 'barras de ouro insuficientes'))
        self.assertEqual(self.barras(a), 2000)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM loja_amigos")[0][0], 0)
        self.assertEqual(self.minha(a)['presentes'], {'dados': 0, 'max': 3, 'liberaEm': None})

        # 1º PRESENTE: pedras. Paga quem dá, uma vez só; chega pela fila de quem recebe, com a carta
        saldo, chave = 2000, idem()
        custo = self.preco('pedras-agua')
        status, r = self.presenteia(a, 'pedras-agua', nb.upper(), chave)                     # o nome não liga para maiúsculas
        self.assertEqual(status, 201, r)
        pid = r['presente']['id']
        saldo -= custo
        self.assertEqual((r['presente']['para'], r['presente']['barras'], r['barras']['saldo']), (nb, custo, saldo))
        status, r = self.presenteia(a, 'pedras-agua', nb, chave)                             # o mesmo clique de novo
        self.assertEqual((status, r['repetido'], r['presente']['id']), (200, True, pid))
        self.assertEqual(self.barras(a), saldo)                                              # cobrado UMA vez
        self.assertEqual(self.sql("SELECT COUNT(*) FROM loja_amigos")[0][0], 1)
        self.assertEqual(self.presenteia(a, 'pedras-terra', nb, chave)[0], 409)              # o idem em outro produto
        mb = self.minha(b)
        p = [x for x in mb['pedidos'] if x['id'] == pid][0]
        self.assertEqual((p['origem'], p['de'], p['estado'], p['cancelavel'], p['moeda']), ('amigo', na, 'pendente', False, None))
        self.assertNotIn('barras', p)
        self.assertEqual(mb['barras']['saldo'], 0)
        self.assertEqual(b.pede('POST', '/api/loja/cancelar', {'id': pid})[0], 409)          # quem recebe não "cancela" as barras alheias
        self.assertEqual(a.pede('POST', '/api/loja/cancelar', {'id': pid})[0], 404)          # e o pedido não é da conta de quem deu
        cartas = b.pede('GET', '/api/correio')[1]
        self.assertEqual(cartas['naoLidas'], 1)
        self.assertEqual(cartas['cartas'][0]['assunto'], 'Você ganhou um presente')
        self.assertIn(na, cartas['cartas'][0]['texto'])
        self.assertIn(loja_mod.POR_SKU['pedras-agua']['nome'], cartas['cartas'][0]['texto'])
        fila = b.pede('POST', '/api/loja/retirar', {})[1]['pedidos']
        self.assertEqual([(x['id'], x['origem'], x['de'], x['preco'], x['entrega']['tipo']) for x in fila],
                         [(pid, 'amigo', na, 0, 'pedras')])
        self.sobe(b, classes=('sumo', 'curandeiro', 'bruxo'), anotacao={'aplicadas': [pid]})
        self.assertEqual(self.pedido(b, pid)['estado'], 'entregue')
        self.assertEqual((self.barras(a), self.barras(b)), (saldo, 0))
        # o presente não gasta os tetos de quem recebe (nem o de abertos, nem o de compras por hora)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM loja_pedidos WHERE conta_id = ? AND " + loja_mod.SEM_GANHO,
                                  b.conta['id'])[0][0], 0)

        # 2º PRESENTE: uma aura — já é dela na hora; a que ela já tem não entra de novo
        custo = self.preco('aura-ar')
        self.assertEqual(self.presenteia(a, 'aura-ar', nb)[0], 201)
        saldo -= custo
        self.assertEqual(self.barras(a), saldo)
        self.assertEqual(b.pede('POST', '/api/loja/aura', {'aura': 'ar'})[1]['auras']['escolhida'], 'ar')
        status, r = self.presenteia(a, 'aura-ar', nb)
        self.assertEqual(status, 409, r)
        self.assertIn('essa aura já é sua', r['erro'])
        self.assertEqual(self.barras(a), saldo)

        # 3º PRESENTE: uma classe que o jogo recusa na entrega — as barras voltam para QUEM DEU
        custo = self.preco('classe-invocador')
        status, r = self.presenteia(a, 'classe-invocador', nb)
        self.assertEqual(status, 201, r)
        pid3 = r['presente']['id']
        self.assertEqual(self.barras(a), saldo - custo)
        self.assertEqual(self.compra(b, 'classe-invocador')[0], 409)                         # já vem a caminho
        b.pede('POST', '/api/loja/retirar', {})
        self.sobe(b, classes=('sumo', 'curandeiro', 'bruxo', 'invocador'),
                  anotacao={'aplicadas': [pid], 'recusadas': [{'id': pid3, 'motivo': 'classe-ja-liberada'}]})
        self.assertEqual(self.pedido(b, pid3)['estado'], 'estornado')
        self.assertEqual((self.barras(a), self.barras(b)), (saldo, 0))

        # O LIMITE DO DIA: três presentes em 24 h (o estornado conta: segura o vai e vem)
        status, r = self.presenteia(a, 'pedras-terra', nb)
        self.assertEqual((status, r['erro']), (429, 'presentes demais nas últimas 24 h (3)'))
        self.assertTrue(r['liberaEm'] > time.time())
        self.assertEqual(self.barras(a), saldo)
        self.assertEqual(self.minha(a)['presentes']['dados'], 3)
        # um dia depois a vaga volta
        self.sql("UPDATE loja_amigos SET criado_em = criado_em - ? WHERE de = ?", DIA + 5, a.conta['id'])
        self.assertEqual(self.presenteia(a, 'pedras-terra', nb)[0], 201)

        # O MESTRE VÊ: o extrato de quem deu diz para quem foi, e a trilha dos dois lados fica nos eventos
        nomes = [mv['nome'] for mv in self.minha(a)['barras']['movimentos'] if mv['motivo'] == 'loja']
        self.assertIn('%s (presente para %s)' % (loja_mod.POR_SKU['aura-ar']['nome'], nb), nomes)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM eventos WHERE conta_id = ? AND tipo = 'loja-presenteou'",
                                  a.conta['id'])[0][0], 4)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM eventos WHERE conta_id = ? AND tipo = 'loja-presente-amigo'",
                                  b.conta['id'])[0][0], 4)
        g = self.novo('Gil Guardião')
        self.mestre(g)
        status, ficha = g.pede('GET', '/api/mestre/conta?id=%d' % a.conta['id'])
        self.assertEqual(status, 200, ficha)                                                 # a ficha do Mestre mostra o mesmo extrato
        self.assertIn('%s (presente para %s)' % (loja_mod.POR_SKU['aura-ar']['nome'], nb),
                      [mv['nome'] for mv in ficha['barras']['movimentos']])
        self.assertNotIn('boas-vindas', [i['sku'] for i in ficha['catalogo']])               # o Mestre não presenteia o Pacote

    def test_presente_respeita_o_limite_do_produto_em_quem_recebe(self):
        """A Reescrita é uma por mês: a de presente conta na janela de quem RECEBE, e a segunda é recusada."""
        a, b = self.novo('Lia Limite'), self.novo('Noé Recebe')
        self.sobe(b)                                                                         # o herói do save já escolheu caminho
        self.da_barras(a, 1000)
        self.da_barras(b, 1000)
        self.assertEqual(self.presenteia(a, 'pergaminho-elemento', b.conta['nome'])[0], 201)
        status, r = self.presenteia(a, 'pergaminho-elemento', b.conta['nome'])
        self.assertEqual(status, 409, r)
        self.assertIn('limite', r['erro'])
        self.assertEqual(self.compra(b, 'pergaminho-elemento')[0], 429)                      # e ele mesmo não compra outra no mês
        self.assertEqual(self.barras(a), 1000 - self.preco('pergaminho-elemento'))
        # quem recebe demais sem abrir o jogo: o teto de presentes esperando
        c = self.novo('Caio Cheio')
        for i in range(loja_mod.PRESENTES_AMIGO_ABERTOS):
            dador = self.novo('Dador %d' % i)
            self.da_barras(dador, 100)
            self.assertEqual(self.presenteia(dador, 'pedras-agua', c.conta['nome'])[0], 201)
        status, r = self.presenteia(a, 'pedras-agua', c.conta['nome'])
        self.assertEqual(status, 429, r)
        self.da_barras(c, 100)                                                               # e a loja dele segue livre
        self.comprou(c, 'pedras-agua')


if __name__ == '__main__':
    unittest.main(verbosity=2)
