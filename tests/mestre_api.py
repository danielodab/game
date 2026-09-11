#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova do painel do Mestre (servidor/mestre.py), pela API de verdade.

    python tests/mestre_api.py

Sobe servidor/api.py num subprocesso (banco descartável numa pasta
temporária), cria as contas por HTTP e marca o Mestre (contas.gm = 1) pelo
SQL, como o `admin mestre` faz.

O que se prova (o pedido do dono de 10/09: "na conta admin posso pesquisar
qualquer usuario e fazer essas liberações"): o portão (401, o 403 com a frase
do painel ANTES de olhar o corpo, o Mestre banido, a marca tirada que vale na
hora); a busca (nome por pedaço sem caixa, % e _ literais, e-mail só inteiro,
#id e dígitos, os 400 que não gastam o freio, 20 + "mais", o e-mail mascarado,
as marcas, as 60 por hora por Mestre); a ficha (os campos, o save, as classes, o
catálogo com o veredito do servidor, o saldo, os pagamentos e os alertas; as
120 por hora, contando o id que não existe); o presente (de classe, de item e
de VINTÉNS: preço 0, `origem:'presente'` só no presente, sem save, banida,
idem, a regra do produto, os limites do jogador que não valem nem se gastam,
os 30 por hora e os 500.000 vinténs por dia do Mestre); a entrega pelo save; o
cancelar; a trilha e o log (sem o termo buscado); a lista; os alertas de
pagamento (lista, visto, 404); e o esquema num banco de antes.
"""
import json
import os
import secrets
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
from servidor_api import API, ESQUEMA_ANTIGO, Cliente, cartorio, espera_api, porta_livre  # noqa: E402
import loja as loja_mod  # noqa: E402
import mestre as mestre_mod  # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

FRASE = mestre_mod.FRASE_SO_MESTRE
ROTAS = (('POST', '/api/mestre/contas', {'q': 'alguem'}), ('GET', '/api/mestre/conta?id=1', None),
         ('POST', '/api/mestre/presentear', {'conta': 1, 'sku': 'classe-bruxo', 'idem': 'abcdefgh1'}),
         ('POST', '/api/mestre/presente/cancelar', {'id': 1}), ('GET', '/api/mestre/presentes', None),
         ('GET', '/api/mestre/alertas', None), ('POST', '/api/mestre/alerta/visto', {'id': 1}),
         ('POST', '/api/mestre/pagamento/conferir', {'id': 1}))
HEROI_FOGO = {'sumo': {'classId': 'sumo', 'xp': 900, 'level': 6, 'element': 'fogo', 'elements': ['fogo']}}


def idem():
    return secrets.token_hex(8)


class ProvaDoMestre(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.mkdtemp(prefix='soterra-mestre-')
        cls.porta = porta_livre()
        cls.base = 'http://127.0.0.1:%d' % cls.porta
        cls.banco_arq = os.path.join(cls.pasta, 'dados', 'soterra.db')
        cls.log_arq = os.path.join(cls.pasta, 'api.log')
        cls.log = open(cls.log_arq, 'w', encoding='utf-8')
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
    def novo(self, apelido, email=None):
        ProvaDoMestre._n += 1
        c = Cliente(self.base)
        status, r = c.cadastra('%s %d' % (apelido, ProvaDoMestre._n), email=email)
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

    def mestre(self, apelido='Guia Painel'):
        m = self.novo(apelido)
        self.sql("UPDATE contas SET gm = 1 WHERE id = ?", m.conta['id'])
        return m

    def enche(self, chave, quantas, em=None):
        b = sqlite3.connect(self.banco_arq)
        b.executemany("INSERT INTO limites(chave, em) VALUES (?, ?)", [(chave, em or int(time.time()))] * quantas)
        b.commit()
        b.close()

    def baldes(self, chave):
        return self.sql("SELECT COUNT(*) FROM limites WHERE chave = ?", chave)[0][0]

    def sobe(self, c, carteira=0, classes=('sumo', 'curandeiro'), herois=None, anotacao=None, cartas=None):
        versao = c.pede('GET', '/api/save')[1]['versao']
        progress = {'version': 22, 'unlockedClasses': list(classes), 'cards': dict(cartas or {}),
                    'heroes': herois if herois is not None else dict(HEROI_FOGO), 'inventory': []}
        db = {'versao': 1, 'jogador': {'nome': None}, 'carteira': {'moedas': carteira},
              'banco': {'moedas': 99999, 'itens': []}}
        if anotacao is not None:
            db['loja'] = anotacao
        status, r = c.salva(versao, progress, db)
        self.assertEqual(status, 200, r)
        return r

    def busca(self, m, q):
        return m.pede('POST', '/api/mestre/contas', {'q': q})

    def ficha(self, m, cid):
        status, r = m.pede('GET', '/api/mestre/conta?id=%d' % cid)
        self.assertEqual(status, 200, r)
        return r

    def presenteia(self, m, alvo, sku=None, vintens=None, chave=None):
        corpo = {'conta': alvo.conta['id'] if hasattr(alvo, 'conta') else alvo, 'idem': chave or idem()}
        if sku is not None:
            corpo['sku'] = sku
        if vintens is not None:
            corpo['vintens'] = vintens
        return m.pede('POST', '/api/mestre/presentear', corpo)

    def deu(self, m, alvo, sku=None, vintens=None):
        status, r = self.presenteia(m, alvo, sku, vintens)
        self.assertEqual(status, 201, r)
        return r['presente']

    def minha(self, c):
        status, r = c.pede('GET', '/api/loja/minha')
        self.assertEqual(status, 200, r)
        return r

    # -- 1. o portão ---------------------------------------------------------------------
    def test_portao(self):
        for metodo, rota, corpo in ROTAS:
            status, r = Cliente(self.base).pede(metodo, rota, corpo)
            self.assertEqual(status, 401, rota)
        c = self.novo('Comum Portao')
        for metodo, rota, corpo in ROTAS:
            status, r = c.pede(metodo, rota, corpo)
            self.assertEqual((status, r['erro']), (403, FRASE), rota)
            status, r = c.pede(metodo, rota, {'lixo': True} if corpo is not None else None)   # o corpo nem é olhado
            self.assertEqual((status, r['erro']), (403, FRASE), rota)
        # o 403 dos eventos segue com a frase antiga
        status, r = c.pede('POST', '/api/eventos', {'tipo': 'xp'})
        self.assertEqual((status, r['erro']), (403, 'só o Mestre do Fundo mexe nos eventos do mundo'))
        m = self.mestre('Guia Portao')
        self.assertEqual(self.busca(m, '#%d' % c.conta['id'])[0], 200)
        # a marca tirada pelo SQL vale no pedido seguinte; o Mestre banido leva 'conta banida'
        self.sql("UPDATE contas SET gm = 0 WHERE id = ?", m.conta['id'])
        self.assertEqual(self.busca(m, '#1')[1]['erro'], FRASE)
        self.sql("UPDATE contas SET gm = 1, banido = 1 WHERE id = ?", m.conta['id'])
        self.assertEqual(self.busca(m, '#1'), (403, {'ok': False, 'erro': 'conta banida'}))

    # -- 2. a busca ----------------------------------------------------------------------
    def test_busca(self):
        m = self.mestre('Guia Busca')
        a = self.novo('Ana Clara Busca', email='Ana.Clara.Busca@Soterra.Test')
        p1 = self.novo('Pe_dro Busca')
        p2 = self.novo('Pexdro Busca')
        status, r = self.busca(m, 'ARA BUSC')                 # pedaço do nome, sem caixa
        self.assertEqual((status, r['modo']), (200, 'nome'), r)
        self.assertEqual([x['id'] for x in r['contas']], [a.conta['id']])
        achada = r['contas'][0]
        self.assertEqual(set(achada), {'id', 'nome', 'email', 'criadoEm', 'gm', 'banido'})
        self.assertEqual(achada['email'], 'An***@Soterra.Test')      # mascarado na lista
        self.assertEqual((achada['gm'], achada['banido']), (False, False))
        # _ e % são letras, não curinga
        self.assertEqual([x['id'] for x in self.busca(m, 'pe_d')[1]['contas']], [p1.conta['id']])
        self.assertEqual(self.busca(m, 'a%c')[1]['contas'], [])
        self.assertIn(p2.conta['id'], [x['id'] for x in self.busca(m, 'xdro busca')[1]['contas']])
        # o e-mail: só inteiro (sem caixa); pedaço de e-mail não acha ninguém
        r = self.busca(m, 'ana.clara.busca@soterra.test')[1]
        self.assertEqual((r['modo'], [x['id'] for x in r['contas']]), ('email', [a.conta['id']]))
        self.assertEqual(self.busca(m, '@soterra.test')[1]['contas'], [])
        self.assertEqual(self.busca(m, 'clara.busca@')[1]['contas'], [])
        # #id e só dígitos
        r = self.busca(m, '#%d' % a.conta['id'])[1]
        self.assertEqual((r['modo'], [x['id'] for x in r['contas']]), ('id', [a.conta['id']]))
        r = self.busca(m, str(p1.conta['id']))[1]
        self.assertEqual((r['modo'], r['contas'][0]['id']), ('id', p1.conta['id']))
        # os 400 (antes do freio: não gastam vez)
        antes = self.baldes('mestre-busca:%d' % m.conta['id'])
        for torto in ('ab', '  a ', '', None, 7, ['ana'], 'x' * 121, '#', '#abc'):
            status, r = self.busca(m, torto)
            self.assertEqual((status, r['erro']), (400, mestre_mod.FRASE_BUSCA), torto)
        self.assertEqual(self.baldes('mestre-busca:%d' % m.conta['id']), antes)
        # 25 contas com o mesmo pedaço: 20 e "mais"
        marca = 'Lote%s' % secrets.token_hex(2)
        for i in range(25):
            self.novo('%s %02d' % (marca, i))
        r = self.busca(m, marca)[1]
        self.assertEqual((len(r['contas']), r['mais']), (20, True))
        self.assertFalse(self.busca(m, 'ARA BUSC')[1]['mais'])
        # banida e Mestre aparecem, com a marca
        self.sql("UPDATE contas SET banido = 1 WHERE id = ?", p2.conta['id'])
        x = [x for x in self.busca(m, 'xdro busca')[1]['contas'] if x['id'] == p2.conta['id']][0]
        self.assertTrue(x['banido'])
        x = self.busca(m, '#%d' % m.conta['id'])[1]['contas'][0]
        self.assertTrue(x['gm'])
        # a 61ª da hora: 429 com liberaEm; o balde é por Mestre
        t = int(time.time())
        feitas = self.baldes('mestre-busca:%d' % m.conta['id'])
        self.enche('mestre-busca:%d' % m.conta['id'], 60 - feitas, t - 20)
        status, r = self.busca(m, 'ARA BUSC')
        self.assertEqual((status, r['erro']), (429, 'buscas demais nesta hora; espere um pouco'))
        self.assertTrue(r['liberaEm'] and r['liberaEm'] <= t + 3600, r)
        m2 = self.mestre('Guia Outro')
        self.assertEqual(self.busca(m2, 'ARA BUSC')[0], 200)

    # -- 3. a ficha ----------------------------------------------------------------------
    def test_ficha(self):
        m = self.mestre('Guia Ficha')
        c = self.novo('Fica Ficha')
        r = self.ficha(m, c.conta['id'])
        self.assertEqual(set(r), {'ok', 'agora', 'conta', 'save', 'classes', 'cartas', 'catalogo', 'presentes', 'saldo',
                                  'pagamentos', 'alertas'})
        self.assertEqual(r['conta']['email'], c.conta['nome'].replace(' ', '') + '@soterra.test')   # inteiro, na ficha
        self.assertEqual((r['conta']['gm'], r['conta']['banido']), (False, False))
        self.assertTrue(r['conta']['ultimaSessao'])
        self.assertEqual((r['save'], r['classes'], r['presentes'], r['pagamentos'], r['alertas']), (None, [], [], [], []))
        self.assertEqual(r['saldo']['aCaminho'], 0)
        cat = {i['sku']: i for i in r['catalogo']}
        self.assertEqual(set(cat), set(loja_mod.POR_SKU))
        self.assertEqual(len(cat), 21)
        self.assertEqual((cat['pergaminho-elemento']['pode'], cat['pergaminho-elemento']['motivo']),
                         (False, 'nenhum herói escolheu caminho elemental ainda'))       # sem save
        self.assertEqual((cat['classe-bruxo']['pode'], cat['classe-bruxo']['raridade']), (True, 'raro'))
        self.assertEqual(set(cat['classe-bruxo']), {'sku', 'nome', 'secao', 'tipo', 'alvo', 'raridade', 'pode', 'motivo'})
        # com save: versão, vinténs do bolso (o cofre não), classes liberadas com o nível, as cartas
        herois = {'sumo': {'classId': 'sumo', 'xp': 900, 'level': 6, 'element': 'fogo', 'elements': ['fogo']},
                  'bruxo#2': {'classId': 'bruxo', 'xp': 300, 'level': 4, 'element': 'agua'}}
        self.sobe(c, carteira=4321, classes=('sumo', 'curandeira', 'bruxo'), herois=herois, cartas={'invocador': 7})
        r = self.ficha(m, c.conta['id'])
        self.assertEqual((r['save']['versao'], r['save']['vintens'], r['save']['nivelMax']), (1, 4321, 6))
        self.assertTrue(r['save']['em'])
        self.assertEqual(r['classes'], [{'id': 'sumo', 'nivel': 6, 'elemento': 'fogo'},
                                        {'id': 'bruxo', 'nivel': 4, 'elemento': 'agua'},
                                        {'id': 'curandeiro', 'nivel': None, 'elemento': None}])
        self.assertEqual(r['cartas']['invocador'], {'liberada': False, 'cartas': 7})
        cat = {i['sku']: i for i in r['catalogo']}
        self.assertEqual((cat['classe-bruxo']['pode'], cat['classe-bruxo']['motivo']), (False, 'essa classe já está liberada'))
        self.assertTrue(cat['pergaminho-elemento']['pode'])
        self.assertEqual(r['saldo']['carteira'], 4321)
        # banida: nada pode
        self.sql("UPDATE contas SET banido = 1 WHERE id = ?", c.conta['id'])
        self.assertTrue(all(i['motivo'] == 'conta banida' and not i['pode'] for i in self.ficha(m, c.conta['id'])['catalogo']))
        # id torto 400; que não existe 404 e CONTA no freio; a 121ª: 429
        for torto in ('', '?id=', '?id=x', '?id=0', '?id=-1', '?id=1.5', '?id=99999999999999999'):
            status, r = m.pede('GET', '/api/mestre/conta' + torto)
            self.assertEqual((status, r['erro']), (400, 'id precisa ser o número da conta'), torto)
        antes = self.baldes('mestre-ficha:%d' % m.conta['id'])
        self.assertEqual(m.pede('GET', '/api/mestre/conta?id=987654321'), (404, {'ok': False, 'erro': 'conta não encontrada'}))
        self.assertEqual(self.baldes('mestre-ficha:%d' % m.conta['id']), antes + 1)
        self.enche('mestre-ficha:%d' % m.conta['id'], 120 - antes - 1)
        status, r = m.pede('GET', '/api/mestre/conta?id=%d' % c.conta['id'])
        self.assertEqual((status, r['erro']), (429, 'fichas demais nesta hora; espere um pouco'))

    # -- 4. presentear ---------------------------------------------------------------------
    def test_presentear(self):
        m = self.mestre('Guia Presente')
        c = self.novo('Recebe Presente')
        # sem save: aceita, e diz que espera o jogo abrir
        status, r = self.presenteia(m, c, 'classe-bruxo')
        self.assertEqual((status, r['semSave']), (201, True), r)
        p = r['presente']
        self.assertEqual({k: p[k] for k in ('sku', 'nome', 'tipo', 'estado', 'cancelavel', 'vintens')},
                         {'sku': 'classe-bruxo', 'nome': 'Bruxo', 'tipo': 'classe', 'estado': 'pendente',
                          'cancelavel': True, 'vintens': None})
        self.assertEqual((p['conta'], p['por']), ({'id': c.conta['id'], 'nome': c.conta['nome']},
                                                  {'id': m.conta['id'], 'nome': m.conta['nome']}))
        self.assertEqual(self.sql("SELECT preco FROM loja_pedidos WHERE id = ?", p['id'])[0][0], 0)
        # o jogador vê "presente" sem cancelar; não compra a classe que chega de presente
        linha = [x for x in self.minha(c)['pedidos'] if x['id'] == p['id']][0]
        self.assertEqual((linha['origem'], linha['cancelavel'], linha['preco']), ('presente', False, 0))
        self.sobe(c, carteira=50000)
        status, r = c.pede('POST', '/api/loja/comprar', {'sku': 'classe-bruxo', 'idem': idem()})
        self.assertEqual((status, r['erro']), (409, 'já há um pedido dessa classe a caminho'))
        # o retirar: origem SÓ no presente; a compra comum sai igual a antes
        q = c.pede('POST', '/api/loja/comprar', {'sku': 'pedras-agua', 'idem': idem()})[1]['pedido']
        r = c.pede('POST', '/api/loja/retirar', {})[1]
        self.assertEqual(r['pedidos'], [{'id': p['id'], 'sku': 'classe-bruxo', 'nome': 'Bruxo', 'preco': 0,
                                         'entrega': {'tipo': 'classe', 'alvo': 'bruxo', 'qtd': 1}, 'origem': 'presente'},
                                        {'id': q['id'], 'sku': 'pedras-agua', 'nome': '10 Lágrimas de Cisterna',
                                         'preco': 500, 'entrega': {'tipo': 'pedras', 'alvo': 'stone-tear', 'qtd': 10}}])
        # a classe a caminho (presente ou compra) barra o presente dela
        self.assertEqual(self.presenteia(m, c, 'classe-bruxo'), (409, {'ok': False, 'erro': 'já há um pedido dessa classe a caminho'}))
        c.pede('POST', '/api/loja/comprar', {'sku': 'classe-minotauro', 'idem': idem()})
        self.assertEqual(self.presenteia(m, c, 'classe-minotauro')[1]['erro'], 'já há um pedido dessa classe a caminho')
        # a classe já liberada
        d = self.novo('Ja Tem')
        self.sobe(d, classes=('sumo', 'curandeiro', 'invocador'))
        self.assertEqual(self.presenteia(m, d, 'classe-invocador')[1]['erro'], 'essa classe já está liberada')
        # o mesmo idem: 200 repetido e UMA linha; o idem de uma compra do jogador: 409
        chave = idem()
        self.assertEqual(self.presenteia(m, d, 'pedras-fogo-50', chave=chave)[0], 201)
        status, r = self.presenteia(m, d, 'pedras-fogo-50', chave=chave)
        self.assertEqual((status, r['repetido']), (200, True))
        self.assertEqual(self.sql("SELECT COUNT(*) FROM loja_pedidos WHERE conta_id = ? AND idem = ?", d.conta['id'],
                                  chave)[0][0], 1)
        self.assertEqual(self.presenteia(m, d, 'insignia-1', chave=chave)[1]['erro'], 'idem já usado em outro pedido')
        compra_idem = idem()
        self.sobe(d, carteira=5000, classes=('sumo', 'curandeiro', 'invocador'))
        self.assertEqual(d.pede('POST', '/api/loja/comprar', {'sku': 'insignia-1', 'idem': compra_idem})[0], 201)
        self.assertEqual(self.presenteia(m, d, 'insignia-1', chave=compra_idem)[1]['erro'], 'idem já usado em outro pedido')
        # banida, inexistente, sku e idem tortos
        self.sql("UPDATE contas SET banido = 1 WHERE id = ?", d.conta['id'])
        self.assertEqual(self.presenteia(m, d, 'insignia-1'), (409, {'ok': False, 'erro': 'essa conta está banida: o presente não entra'}))
        self.assertEqual(self.presenteia(m, 987654321, 'insignia-1'), (404, {'ok': False, 'erro': 'conta não encontrada'}))
        for sku in ('ancora', 'classe-sumo', 'classe-gm', 'pergaminho-xp', 'pacote-1000', 'presente-vintens', None, 7):
            self.assertEqual(self.presenteia(m, c, sku)[1]['erro'], 'produto desconhecido', sku)
        self.assertEqual(m.pede('POST', '/api/mestre/presentear', {'conta': c.conta['id'], 'sku': 'insignia-1',
                                                                   'idem': 'curto'})[1]['erro'],
                         'idem inválido (8 a 64 letras, dígitos, _ ou -)')
        for torto in (None, 'x', True, 0, -2):
            self.assertEqual(m.pede('POST', '/api/mestre/presentear', {'conta': torto, 'sku': 'insignia-1', 'idem': idem()})[1]['erro'],
                             'conta precisa ser o número da conta', torto)
        # para a PRÓPRIA conta do Mestre: pode (o dono testa o caminho)
        self.assertEqual(self.presenteia(m, m, 'bonus-xp-1')[0], 201)

    def test_limites_do_jogador_nao_valem_nem_se_gastam(self):
        m = self.mestre('Guia Limite')
        c = self.novo('Limite Livre')
        self.sobe(c, carteira=100000)
        # a Reescrita (1 a cada 30 dias): o jogador comprou a dele; o presente sai mesmo assim
        self.assertEqual(c.pede('POST', '/api/loja/comprar', {'sku': 'pergaminho-elemento', 'idem': idem()})[0], 201)
        self.assertEqual(self.presenteia(m, c, 'pergaminho-elemento')[0], 201)
        # e o presente não gasta a janela: noutra conta, o presente primeiro e o jogador ainda compra
        d = self.novo('Janela Livre')
        self.sobe(d, carteira=100000)
        self.assertEqual(self.presenteia(m, d, 'pergaminho-elemento')[0], 201)
        self.assertEqual(d.pede('POST', '/api/loja/comprar', {'sku': 'pergaminho-elemento', 'idem': idem()})[0], 201)
        # 6 presentes pendentes não travam os 5 abertos do jogador, nem as compras e linhas por hora
        for _ in range(6):
            self.deu(m, d, 'pedras-agua')
        for s in ('pedras-terra', 'pedras-ar', 'bonus-xp-1', 'insignia-1'):
            self.assertEqual(d.pede('POST', '/api/loja/comprar', {'sku': s, 'idem': idem()})[0], 201, s)
        self.assertEqual(d.pede('POST', '/api/loja/comprar', {'sku': 'insignia-1', 'idem': idem()})[1]['erro'],
                         'pedidos abertos demais (5)')          # os 5 são as compras dele
        self.assertEqual(self.minha(d)['limites']['pergaminho-elemento']['usados'], 1)
        # o 31º presente do MESMO Mestre na hora: 429 com liberaEm (os de antes contam em qualquer estado)
        g = self.mestre('Guia Teto')
        t = int(time.time())
        b = sqlite3.connect(self.banco_arq)
        for _ in range(30):
            pid = b.execute("INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, criado_em) "
                            "VALUES (?, 'pedras-agua', '{}', 0, 'cancelado', ?)", (c.conta['id'], t - 100)).lastrowid
            b.execute("INSERT INTO loja_presentes(pedido_id, por, criado_em) VALUES (?, ?, ?)", (pid, g.conta['id'], t - 100))
        b.commit()
        b.close()
        status, r = self.presenteia(g, c, 'pedras-agua')
        self.assertEqual((status, r['erro'], r['liberaEm']), (429, 'presentes demais na última hora (30)', t - 100 + 3600))
        self.assertEqual(self.presenteia(m, c, 'pedras-agua')[0], 201)       # o teto é por Mestre

    # -- 5. o presente de vinténs -------------------------------------------------------------
    def test_presente_de_vintens(self):
        m = self.mestre('Guia Vintem')
        c = self.novo('Ganha Vintem')                     # nunca abriu o jogo
        status, r = self.presenteia(m, c, vintens=12345)
        self.assertEqual(status, 201, r)
        p = r['presente']
        self.assertEqual({k: p[k] for k in ('sku', 'nome', 'tipo', 'vintens', 'estado', 'cancelavel')},
                         {'sku': 'presente-vintens', 'nome': '12.345 vinténs', 'tipo': 'vintens', 'vintens': 12345,
                          'estado': 'pendente', 'cancelavel': True})
        saldo = self.minha(c)['saldo']
        self.assertEqual((saldo['aCaminho'], saldo['disponivel']), (12345, 12345))
        # o jogador já gasta no site, sem save
        self.assertEqual(c.pede('POST', '/api/loja/comprar', {'sku': 'classe-invocador', 'idem': idem()})[0], 201)
        r = c.pede('POST', '/api/loja/retirar', {})[1]
        self.assertEqual(r['pedidos'][0], {'id': p['id'], 'sku': 'presente-vintens', 'nome': '12.345 vinténs', 'preco': 0,
                                           'entrega': {'tipo': 'vintens', 'alvo': 'carteira', 'qtd': 12345},
                                           'origem': 'presente'})
        ev = self.sql("SELECT dados FROM eventos WHERE conta_id = ? AND tipo = 'presente-admin'", c.conta['id'])
        self.assertEqual([json.loads(e[0]) for e in ev], [{'id': p['id'], 'para': c.conta['id'], 'sku': 'presente-vintens',
                                                           'por': m.conta['id'], 'vintens': 12345}])
        # os 400
        for corpo, erro in (({'sku': 'insignia-1', 'vintens': 10}, 'mande sku ou vintens, não os dois'),
                            ({'vintens': 0}, 'vintens precisa ser um inteiro de 1 a 100.000'),
                            ({'vintens': 100001}, 'vintens precisa ser um inteiro de 1 a 100.000'),
                            ({'vintens': 1.5}, 'vintens precisa ser um inteiro de 1 a 100.000'),
                            ({'vintens': '10'}, 'vintens precisa ser um inteiro de 1 a 100.000'),
                            ({'vintens': True}, 'vintens precisa ser um inteiro de 1 a 100.000')):
            status, r = m.pede('POST', '/api/mestre/presentear', dict(corpo, conta=c.conta['id'], idem=idem()))
            self.assertEqual((status, r['erro']), (400, erro), corpo)
        # o mesmo idem com outra quantia: 409; com a mesma: repetido
        chave = idem()
        self.assertEqual(self.presenteia(m, c, vintens=100, chave=chave)[0], 201)
        self.assertEqual(self.presenteia(m, c, vintens=100, chave=chave)[1]['repetido'], True)
        self.assertEqual(self.presenteia(m, c, vintens=101, chave=chave)[1]['erro'], 'idem já usado em outro pedido')
        # o teto de 500.000 por Mestre em 24 h
        g = self.mestre('Guia Cofre')
        t = int(time.time())
        b = sqlite3.connect(self.banco_arq)
        pid = b.execute("INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, criado_em) "
                        "VALUES (?, 'presente-vintens', '{}', 0, 'entregue', ?)", (c.conta['id'], t - 500)).lastrowid
        b.execute("INSERT INTO loja_presentes(pedido_id, por, criado_em) VALUES (?, ?, ?)", (pid, g.conta['id'], t - 500))
        b.execute("INSERT INTO loja_creditos(pedido_id, vintens, origem, criado_em) VALUES (?, 499000, 'presente', ?)",
                  (pid, t - 500))
        b.commit()
        b.close()
        self.assertEqual(self.presenteia(g, c, vintens=1000)[0], 201)          # 500.000 cabe
        status, r = self.presenteia(g, c, vintens=1)
        self.assertEqual((status, r['erro'], r['liberaEm']),
                         (429, 'vinténs de presente demais nas últimas 24 h (500.000)', t - 500 + 86400))
        self.assertEqual(self.presenteia(m, c, vintens=1)[0], 201)             # o teto é por Mestre

    # -- 6. a entrega pelo save ----------------------------------------------------------------
    def test_entrega_pelo_save(self):
        m = self.mestre('Guia Entrega')
        c = self.novo('Entrega Save')
        self.sobe(c, carteira=0)
        p = self.deu(m, c, 'classe-arqueiro')
        q = self.deu(m, c, 'classe-espadachim')
        c.pede('POST', '/api/loja/retirar', {})
        r = self.sobe(c, classes=('sumo', 'curandeiro', 'arqueiro'),
                      anotacao={'aplicadas': [p['id']], 'recusadas': [{'id': q['id'], 'motivo': 'classe-ja-liberada'}]})
        self.assertEqual(r['loja'], {'entregues': [p['id']], 'estornados': [q['id']]})
        f = self.ficha(m, c.conta['id'])
        self.assertIn('arqueiro', [x['id'] for x in f['classes']])
        estados = {x['id']: (x['estado'], x['motivo']) for x in f['presentes']}
        self.assertEqual(estados[p['id']], ('entregue', None))
        self.assertEqual(estados[q['id']], ('estornado', 'classe-ja-liberada'))
        self.assertEqual(self.minha(c)['saldo']['reservado'], 0)       # presente tem preço 0: nada reservado

    # -- 7. cancelar ----------------------------------------------------------------------
    def test_cancelar(self):
        m = self.mestre('Guia Cancela')
        c = self.novo('Cancela Presente')
        p = self.deu(m, c, 'bonus-xp-7')
        # o jogador não cancela presente
        self.assertEqual(c.pede('POST', '/api/loja/cancelar', {'id': p['id']}),
                         (409, {'ok': False, 'erro': 'presente do Mestre: só o Mestre cancela'}))
        status, r = m.pede('POST', '/api/mestre/presente/cancelar', {'id': p['id']})
        self.assertEqual(status, 200, r)
        self.assertEqual((r['presente']['estado'], r['presente']['canceladoPor'], r['presente']['cancelavel']),
                         ('cancelado', {'id': m.conta['id'], 'nome': m.conta['nome']}, False))
        self.assertEqual(m.pede('POST', '/api/mestre/presente/cancelar', {'id': p['id']}),
                         (409, {'ok': False, 'erro': 'presente já fechado'}))
        # retirado há pouco: não; há 25 h: sim
        q = self.deu(m, c, 'pedras-ar')
        c.pede('POST', '/api/loja/retirar', {})
        self.assertEqual(m.pede('POST', '/api/mestre/presente/cancelar', {'id': q['id']})[1]['erro'],
                         'já está a caminho do jogo; espere a entrega ou 24 h')
        self.sql("UPDATE loja_pedidos SET retirado_em = ? WHERE id = ?", int(time.time()) - 25 * 3600, q['id'])
        self.assertEqual(m.pede('POST', '/api/mestre/presente/cancelar', {'id': q['id']})[0], 200)
        # o presente de vinténs cancelado sai do "a caminho"
        v = self.deu(m, c, vintens=777)
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 777)
        self.assertEqual(m.pede('POST', '/api/mestre/presente/cancelar', {'id': v['id']})[0], 200)
        self.assertEqual(self.minha(c)['saldo']['aCaminho'], 0)
        # compra comum não é presente; torto
        self.sobe(c, carteira=5000)
        compra = c.pede('POST', '/api/loja/comprar', {'sku': 'insignia-1', 'idem': idem()})[1]['pedido']
        self.assertEqual(m.pede('POST', '/api/mestre/presente/cancelar', {'id': compra['id']}),
                         (404, {'ok': False, 'erro': 'presente não encontrado'}))
        for torto in ({}, {'id': 'x'}, {'id': 0}, {'id': True}):
            self.assertEqual(m.pede('POST', '/api/mestre/presente/cancelar', torto)[1]['erro'],
                             'id precisa ser o número do presente', torto)
        # a trilha
        ev = [json.loads(e[0]) for e in self.sql(
            "SELECT dados FROM eventos WHERE conta_id = ? AND tipo = 'presente-cancela' ORDER BY id", c.conta['id'])]
        self.assertEqual(ev[0], {'id': p['id'], 'para': c.conta['id'], 'sku': 'bonus-xp-7', 'por': m.conta['id'],
                                 'de': 'pendente'})
        self.assertEqual(ev[1]['de'], 'retirado')

    # -- 8. a trilha e o log ----------------------------------------------------------------
    def test_trilha_e_log(self):
        m = self.mestre('Guia Trilha')
        c = self.novo('Trilha Alvo', email='trilha.alvo.segredo@soterra.test')
        p = self.deu(m, c, 'classe-minotauro')
        ev = self.sql("SELECT conta_id, dados FROM eventos WHERE tipo = 'presente-admin' AND conta_id = ?", c.conta['id'])
        self.assertEqual([(e[0], json.loads(e[1])) for e in ev],
                         [(c.conta['id'], {'id': p['id'], 'para': c.conta['id'], 'sku': 'classe-minotauro',
                                           'por': m.conta['id']})])
        self.assertEqual(self.busca(m, 'trilha.alvo.segredo@soterra.test')[0], 200)
        time.sleep(0.3)
        with open(self.log_arq, encoding='utf-8', errors='replace') as f:
            texto = f.read()
        self.assertNotIn('trilha.alvo.segredo', texto)
        self.assertIn('mestre: #%d buscou (email) — 1 achadas' % m.conta['id'], texto)
        self.assertIn('mestre: #%d deu classe-minotauro a #%d' % (m.conta['id'], c.conta['id']), texto)

    # -- 9. a lista -------------------------------------------------------------------------
    def test_lista(self):
        m = self.mestre('Guia Lista')
        c = self.novo('Lista Um')
        d = self.novo('Lista Dois')
        dados = [self.deu(m, c, 'pedras-agua'), self.deu(m, d, 'pedras-terra'), self.deu(m, c, vintens=5)]
        status, r = m.pede('GET', '/api/mestre/presentes')
        self.assertEqual(status, 200, r)
        ids = [x['id'] for x in r['presentes']]
        self.assertEqual(ids, sorted(ids, reverse=True))
        self.assertLessEqual(len(ids), 50)
        self.assertEqual(ids[:3], [x['id'] for x in reversed(dados)])
        self.assertIsNone(r['conta'])
        status, r = m.pede('GET', '/api/mestre/presentes?conta=%d' % c.conta['id'])
        self.assertEqual((r['conta'], [x['id'] for x in r['presentes']]), (c.conta['id'], [dados[2]['id'], dados[0]['id']]))
        self.assertEqual(r['presentes'][0]['nome'], '5 vinténs')
        for torto in ('x', '0', '', '-1'):
            status, r = m.pede('GET', '/api/mestre/presentes?conta=' + torto)
            self.assertEqual((status, r['erro']), (400, 'conta precisa ser o número da conta'), torto)

    # -- 10. a ficha com saldo, pagamentos e alertas; as rotas de alerta ---------------------------------
    def test_alertas_e_pagamentos_na_ficha(self):
        m = self.mestre('Guia Alerta')
        c = self.novo('Alerta Conta')
        t = int(time.time())
        b = sqlite3.connect(self.banco_arq)
        pg = b.execute("INSERT INTO pagamentos(conta_id, pacote, vintens, centavos, referencia, estado, criado_em, "
                       "atualizado_em) VALUES (?, 'pacote-5500', 5500, 1990, ?, 'aberto', ?, ?)",
                       (c.conta['id'], 'sot-1-%s' % secrets.token_hex(8), t - 100, t - 100)).lastrowid
        a1 = b.execute("INSERT INTO contas_alertas(conta_id, tipo, dados, criado_em) VALUES (?, 'estorno', ?, ?)",
                       (c.conta['id'], json.dumps({'mp': '1', 'vintens': 5500}), t - 50)).lastrowid
        a2 = b.execute("INSERT INTO contas_alertas(conta_id, tipo, dados, criado_em) VALUES (?, 'valor-diferente', '{}', ?)",
                       (c.conta['id'], t - 40)).lastrowid
        b.commit()
        b.close()
        f = self.ficha(m, c.conta['id'])
        self.assertEqual([(p['id'], p['estado'], p['preco'], p['nome']) for p in f['pagamentos']],
                         [(pg, 'aberto', 'R$ 19,90', 'Saco de 5.500 vinténs')])
        self.assertEqual([a['id'] for a in f['alertas']], [a2, a1])
        self.assertEqual(f['alertas'][1], {'id': a1, 'conta': {'id': c.conta['id'], 'nome': c.conta['nome']},
                                           'tipo': 'estorno', 'dados': {'mp': '1', 'vintens': 5500}, 'criadoEm': t - 50,
                                           'vistoEm': None, 'vistoPor': None})
        # a lista geral: os abertos primeiro
        status, r = m.pede('POST', '/api/mestre/alerta/visto', {'id': a1})
        self.assertEqual(status, 200, r)
        self.assertEqual((r['alerta']['vistoPor'], bool(r['alerta']['vistoEm'])),
                         ({'id': m.conta['id'], 'nome': m.conta['nome']}, True))
        visto_em = r['alerta']['vistoEm']
        self.assertEqual(m.pede('POST', '/api/mestre/alerta/visto', {'id': a1})[1]['alerta']['vistoEm'], visto_em)
        lista = m.pede('GET', '/api/mestre/alertas')[1]['alertas']
        abertos = [a['vistoEm'] is None for a in lista]
        self.assertEqual(abertos, sorted(abertos, reverse=True))            # abertos antes dos vistos
        self.assertIn(a2, [a['id'] for a in lista if a['vistoEm'] is None])
        # a ficha: os abertos e os vistos
        self.assertEqual([(a['id'], a['vistoEm'] is None) for a in self.ficha(m, c.conta['id'])['alertas']],
                         [(a2, True), (a1, False)])
        self.assertEqual(m.pede('POST', '/api/mestre/alerta/visto', {'id': 99999999}),
                         (404, {'ok': False, 'erro': 'alerta não encontrado'}))
        for torto in ({}, {'id': 'x'}, {'id': 0}):
            self.assertEqual(m.pede('POST', '/api/mestre/alerta/visto', torto)[1]['erro'],
                             'id precisa ser o número do alerta')
        self.assertEqual(c.pede('POST', '/api/mestre/alerta/visto', {'id': a2})[1]['erro'], FRASE)
        self.assertEqual(c.pede('GET', '/api/mestre/alertas')[0], 403)

    # -- 11. o esquema num banco de antes ------------------------------------------------------
    def test_esquema_em_banco_antigo(self):
        pasta = tempfile.mkdtemp(prefix='antigo-', dir=self.pasta)
        caminho = os.path.join(pasta, 'soterra.db')
        b = sqlite3.connect(caminho)
        b.executescript(ESQUEMA_ANTIGO)
        b.executescript(loja_mod.ESQUEMA_LOJA.split('-- os presentes do Mestre')[0])       # a loja da Fase C, sem as novas
        b.commit()
        antes = {r[0] for r in b.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        b.close()
        self.assertNotIn('loja_presentes', antes)
        api = cartorio.Api(caminho)
        try:
            tabelas = {r[0] for r in api.con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        finally:
            api.con.close()
        for nova in ('loja_presentes', 'loja_creditos', 'pagamentos', 'pagamentos_mp', 'contas_alertas', 'avatares'):
            self.assertIn(nova, tabelas)


if __name__ == '__main__':
    unittest.main(verbosity=2)
