#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova do MERCADINHO ENTRE CONTAS (servidor/mercado.py), com o JUIZ de verdade.

    python tests/mercado_api.py

Sobe o juiz em Node e a API com --juiz (e uma API SEM juiz no mesmo banco, para o
503 e para a varredura do salvar de antes), com um banco descartável numa pasta
temporária, e fala com eles por HTTP como o jogo falaria. Contas descartáveis.

O que se prova (o pedido do dono de 13/09):
  - anunciar tira a peça do saco (custódia no servidor, série viva com o vendedor);
  - comprar pelo preço move a peça e os vinténs, com a taxa de 5% (mínimo 1);
  - saco curto usa o banco; saco + banco curto não compra;
  - propor → o vendedor aceita → o comprador confirma: vende por Y com a taxa sobre Y;
  - dois compradores aceitos: o 1º que confirma leva, o 2º recebe 'perdida';
  - negar mantém o anúncio; vender a outro antes da confirmação = 'perdida';
  - retirar devolve a peça e cancela as propostas;
  - ninguém compra nem propõe o próprio anúncio; proposta ≥ preço e sem saldo caem;
  - as ofertas antigas do db.mercado.ofertas viram anúncios (com a série);
  - a série não duplica nem some: nem na op seguinte, nem na varredura do salvar sem juiz;
  - as ops antigas do jogador e as internas do mercado não passam pelo /api/op.
E o LOTE de pedras de forja (22/09): anunciar tira as pedras do estado no servidor (linha em
mercado_lotes), lote fora da régua é 400, estoque curto não grava nada, comprar põe as pedras no
comprador (saco depois banco, com a taxa, mesmo de saco cheio), retirar as devolve, o resumo
agrega por pedra (e `itens` não mostra lote), o item?id=<pedra> ordena pelo preço por pedra, a
proposta aceita e confirmada move as pedras, o teto de anúncios conta os lotes, o lote local de
antes volta ao estoque na migração e as leituras dizem `tipo` e `qtd`.
Os processos rodam com prioridade abaixo do normal: a máquina é dividida com quem joga.
"""
import copy
import json
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
from autoridade_api import BAIXA, ESTADO_JS, JUIZ, NODE, PECA, espera_url, roda_node  # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


def taxa(v):
    return max(1, (v * 5 + 99) // 100)


class ProvaDoMercado(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls):
        if NODE is None:
            raise unittest.SkipTest('sem node nesta máquina: o juiz não sobe')
        cls.pasta = tempfile.mkdtemp(prefix='soterra-mercado-')
        cls.banco_arq = os.path.join(cls.pasta, 'dados', 'soterra.db')
        cls.logs, cls.procs = [], []
        try:
            porta_juiz = porta_livre()
            juiz = 'http://127.0.0.1:%d' % porta_juiz
            pj = cls._processo('juiz', [NODE, JUIZ, '--porta', str(porta_juiz)])
            if not espera_url(juiz + '/saude', pj):
                raise RuntimeError('o juiz não subiu; veja ' + cls.pasta)
            codigo = ("const est = require(process.argv[1]); const w = est.mundoEconomico({}); est.poeEstado(w, null, null);"
                      "const s = est.tiraEstado(w); process.stdout.write(JSON.stringify({progress: s.progress, db: s.db}));")
            cls.inicial = roda_node(['-e', codigo, ESTADO_JS])
            env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
            cls.base = cls._api('api', env, ['--juiz', juiz])
            cls.base_sem_juiz = cls._api('api-sem-juiz', env, [])
        except BaseException:
            cls.tearDownClass()
            raise

    @classmethod
    def _processo(cls, nome, args, env=None):
        log = open(os.path.join(cls.pasta, nome + '.log'), 'w', encoding='utf-8')
        cls.logs.append(log)
        p = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT, env=env, creationflags=BAIXA)
        cls.procs.append(p)
        return p

    @classmethod
    def _api(cls, nome, env, extra):
        porta = porta_livre()
        p = cls._processo(nome, [sys.executable, API, '--porta', str(porta), '--banco', cls.banco_arq] + extra, env)
        base = 'http://127.0.0.1:%d' % porta
        if not espera_api(base, p, 30):
            raise RuntimeError('a API %s não subiu; veja %s' % (nome, cls.pasta))
        return base

    @classmethod
    def tearDownClass(cls):
        for p in cls.procs:
            if p.poll() is None:
                p.terminate()
                try:
                    p.wait(5)
                except subprocess.TimeoutExpired:
                    p.kill()
        for log in getattr(cls, 'logs', []):
            log.close()
        shutil.rmtree(getattr(cls, 'pasta', ''), ignore_errors=True)

    # -- ajudantes ------------------------------------------------------------------------------
    def novo(self, apelido):
        ProvaDoMercado._n += 1
        c = Cliente(self.base)
        status, r = c.cadastra('%s %d' % (apelido, ProvaDoMercado._n))
        self.assertEqual(status, 201, r)
        return c

    def serie(self, prefixo):
        ProvaDoMercado._n += 1
        return 'j%s%d' % (prefixo, ProvaDoMercado._n)

    def sql(self, consulta, *args):
        b = sqlite3.connect(self.banco_arq)
        b.row_factory = sqlite3.Row
        try:
            linhas = [dict(r) for r in b.execute(consulta, args).fetchall()]
            b.commit()
            return linhas
        finally:
            b.close()

    def poe_estado(self, c, carteira=0, banco=0, pecas=(), mercado=None, nasc_extra=(), pedras=None, saco_cheio=0):
        """`pedras` = {stoneId: n} vira o estoque inteiro; `saco_cheio` = quantas peças de enchimento
        (com série) além de `pecas` — o lote de pedras não precisa de espaço no saco."""
        p = copy.deepcopy(self.inicial['progress'])
        d = copy.deepcopy(self.inicial['db'])
        if pedras is not None:
            p['stones'] = dict(pedras)
        enche = [self.serie('en') for _ in range(saco_cheio)]
        for iid in enche:
            p['inventory'].append({'itemId': PECA, 'level': 0, 'stars': 0, 'iid': iid})
        nasc_extra = list(nasc_extra) + enche
        for iid in pecas:
            p['inventory'].append({'itemId': PECA, 'level': 1, 'stars': 1, 'iid': iid})
        d['carteira'] = {'moedas': carteira}
        d['banco'] = {'moedas': banco, 'itens': []}
        if mercado is not None:
            d['mercado'] = mercado
        nasc = [{'iid': i, 'itemId': PECA, 'origem': 'saque'} for i in list(pecas) + list(nasc_extra)]
        status, r = c.salva(0, p, d, nasc)
        self.assertEqual(status, 200, r)
        return r

    def save(self, c):
        status, r = c.pede('GET', '/api/save')
        self.assertEqual(status, 200, r)
        return r

    @staticmethod
    def series(s):
        return [e.get('iid') for e in s['progress']['inventory'] if isinstance(e, dict)]

    @staticmethod
    def bolso(s):
        return s['db']['carteira']['moedas'], s['db']['banco']['moedas']

    def anuncia(self, c, iid, preco):
        status, r = c.pede('POST', '/api/mercado/anunciar', {'iid': iid, 'preco': preco})
        self.assertEqual(status, 200, r)
        return r['anuncio']['id']

    def propoe(self, c, aid, valor):
        status, r = c.pede('POST', '/api/mercado/propor', {'anuncioId': aid, 'valor': valor})
        self.assertEqual(status, 200, r)
        return r['proposta']['id']

    def item_do_registro(self, iid):
        return self.sql("SELECT conta_id, origem, estado FROM itens WHERE iid = ?", iid)

    @staticmethod
    def estoque(s, sid):
        """As pedras `sid` no estado (save ou resposta que traz `progress`)."""
        return int((s['progress'].get('stones') or {}).get(sid) or 0)

    def anuncia_lote(self, c, sid, qtd, preco):
        status, r = c.pede('POST', '/api/mercado/anunciar', {'tipo': 'pedra', 'stoneId': sid, 'qtd': qtd, 'preco': preco})
        self.assertEqual(status, 200, r)
        return r['anuncio']['id']

    _limite = None

    def limite_do_saco(self):
        if ProvaDoMercado._limite is None:
            ProvaDoMercado._limite = int(roda_node(
                ['-e', "const est=require(process.argv[1]);const w=est.mundoEconomico({});est.poeEstado(w,null,null);"
                       "process.stdout.write(JSON.stringify(w.J.Progress.bagLimit ? w.J.Progress.bagLimit() : 60))",
                 ESTADO_JS]))
        return ProvaDoMercado._limite

    # -- as provas -------------------------------------------------------------------------------
    def test_01_sem_juiz_503_e_ops_fechadas(self):
        c = self.novo('Sem Juiz')
        self.poe_estado(c)
        sem = Cliente(self.base_sem_juiz)
        sem.token, sem.conta = c.token, c.conta
        for metodo, rota in (('GET', '/api/mercado/resumo'), ('POST', '/api/mercado/anunciar')):
            status, r = sem.pede(metodo, rota, {} if metodo == 'POST' else None)
            self.assertEqual(status, 503, (rota, r))
        self.assertEqual(Cliente(self.base).pede('GET', '/api/mercado/resumo')[0], 401)
        # as internas não passam pelo /api/op, e as antigas do jogador o juiz recusa
        for nome in ('mercadoPaga', 'mercadoPoe', 'mercadoRecebe', 'mercadoTira', 'mercadoLegadoTira'):
            self.assertEqual(c.pede('POST', '/api/op', {'ops': [{'nome': nome, 'args': {}}]})[0], 403, nome)
        status, r = c.pede('POST', '/api/op', {'ops': [{'nome': 'anunciarMercado', 'args': {'invIndex': 0, 'preco': 9}}]})
        self.assertEqual((status, r.get('motivo')), (422, 'mercado'), r)

    def test_02_anunciar_tira_a_peca(self):
        a = self.novo('Vendedora')
        ia, ib = self.serie('an'), self.serie('an')
        self.poe_estado(a, pecas=[ia, ib])
        for corpo in ({'iid': ia, 'preco': 0}, {'iid': ia, 'preco': 10000}, {'iid': ia, 'preco': True}, {'preco': 50},
                      {'iid': 'jnaotem', 'preco': 50}, {'invIndex': 99, 'preco': 50}):
            status, r = a.pede('POST', '/api/mercado/anunciar', corpo)
            self.assertIn(status, (400, 409), (corpo, r))
        # pelo índice do saco do SERVIDOR
        s = self.save(a)
        idx = self.series(s).index(ib)
        status, r = a.pede('POST', '/api/mercado/anunciar', {'invIndex': idx, 'preco': 80})
        self.assertEqual(status, 200, r)
        self.assertEqual((r['anuncio']['itemId'], r['anuncio']['level'], r['anuncio']['stars']), (PECA, 1, 1))
        self.assertNotIn(ib, self.series(r), 'a resposta traz o estado sem a peça')
        s = self.save(a)
        self.assertNotIn(ib, self.series(s))
        self.assertEqual(s['versao'], r['versao'])
        self.assertEqual(self.item_do_registro(ib), [{'conta_id': a.conta['id'], 'origem': 'saque', 'estado': 'vivo'}],
                         'em custódia a série segue viva com o vendedor')
        status, r = a.pede('POST', '/api/mercado/anunciar', {'iid': ib, 'preco': 80})
        self.assertEqual(status, 409, 'a peça anunciada não está mais no saco: %r' % r)
        b = self.novo('Olhadora')
        self.poe_estado(b)
        status, res = b.pede('GET', '/api/mercado/resumo')
        self.assertEqual(status, 200, res)
        linha = [x for x in res['itens'] if x['itemId'] == PECA][0]
        self.assertGreaterEqual(linha['qtd'], 1)
        status, it = b.pede('GET', '/api/mercado/item?id=' + PECA)
        self.assertEqual(status, 200, it)
        todos = [x for x in it['anuncios'] if x['vendedor'] == a.conta['nome']]
        self.assertEqual(len(todos), 1, it)
        self.assertFalse(todos[0]['meu'])
        self.assertEqual(todos[0]['preco'], 80)
        self.assertTrue([x for x in a.pede('GET', '/api/mercado/item?id=' + PECA)[1]['anuncios'] if x['meu']])
        self.assertEqual(b.pede('GET', '/api/mercado/item?id=x%20y')[0], 400)
        self.assertEqual(b.pede('GET', '/api/mercado/item')[0], 400)

    def test_03_comprar_pelo_preco_com_taxa(self):
        a, b = self.novo('Vende Preco'), self.novo('Compra Preco')
        ia = self.serie('cp')
        self.poe_estado(a, carteira=10, pecas=[ia])
        self.poe_estado(b, carteira=500)
        aid = self.anuncia(a, ia, 100)
        status, r = a.pede('POST', '/api/mercado/comprar', {'anuncioId': aid})
        self.assertEqual(status, 400, 'o próprio anúncio não se compra: %r' % r)
        status, r = b.pede('POST', '/api/mercado/comprar', {'anuncioId': aid})
        self.assertEqual(status, 200, r)
        self.assertEqual((r['valor'], r['deCarteira'], r['deBanco']), (100, 100, 0))
        sb, sa = self.save(b), self.save(a)
        self.assertIn(ia, self.series(sb))
        self.assertEqual(self.bolso(sb), (400, 0))
        self.assertEqual(self.bolso(sa), (10 + 100 - taxa(100), 0), 'o vendedor recebe o preço menos a taxa, mesmo fora')
        self.assertEqual((sb['progress'], sb['db']), (r['progress'], r['db']))
        self.assertEqual(self.item_do_registro(ia), [{'conta_id': b.conta['id'], 'origem': 'mercador', 'estado': 'vivo'}])
        self.assertEqual(self.sql("SELECT estado, valor_final, taxa FROM mercado_anuncios WHERE id = ?", aid),
                         [{'estado': 'vendido', 'valor_final': 100, 'taxa': 5}])
        status, r = b.pede('POST', '/api/mercado/comprar', {'anuncioId': aid})
        self.assertEqual((status, r.get('motivo')), (409, 'perdeu'), 'vendido não vende duas vezes')
        # o vendedor fica sabendo da venda (e marca como vista)
        status, av = a.pede('GET', '/api/mercado/avisos')
        venda = [v for v in av['vendas'] if v['id'] == aid]
        self.assertEqual((venda[0]['valor'], venda[0]['taxa'], venda[0]['recebeu'], venda[0]['comprador']),
                         (100, 5, 95, b.conta['nome']), av)
        self.assertEqual(a.pede('POST', '/api/mercado/visto', {'vendas': [aid]})[0], 200)
        self.assertEqual([v for v in a.pede('GET', '/api/mercado/avisos')[1]['vendas'] if v['id'] == aid], [])
        status, meus = a.pede('GET', '/api/mercado/meus')
        self.assertEqual(meus['vendas'][0]['recebeu'], 95)

    def test_04_saco_curto_usa_o_banco(self):
        a, b, c = self.novo('Vende Banco'), self.novo('Compra Banco'), self.novo('Sem Bolso')
        ia = self.serie('bc')
        self.poe_estado(a, pecas=[ia])
        self.poe_estado(b, carteira=30, banco=200)
        self.poe_estado(c, carteira=40, banco=50)
        aid = self.anuncia(a, ia, 100)
        status, r = c.pede('POST', '/api/mercado/comprar', {'anuncioId': aid})
        self.assertEqual((status, r.get('motivo'), r.get('faltam')), (409, 'saldo', 10), r)
        self.assertEqual(self.bolso(self.save(c)), (40, 50))
        status, r = b.pede('POST', '/api/mercado/comprar', {'anuncioId': aid})
        self.assertEqual(status, 200, r)
        self.assertEqual((r['deCarteira'], r['deBanco']), (30, 70))
        self.assertEqual(self.bolso(self.save(b)), (0, 130))
        self.assertEqual(self.bolso(self.save(a)), (95, 0))

    def test_05_propor_aceitar_confirmar(self):
        a, b = self.novo('Vende Prop'), self.novo('Compra Prop')
        ia = self.serie('pp')
        self.poe_estado(a, pecas=[ia])
        self.poe_estado(b, carteira=100, banco=100)
        aid = self.anuncia(a, ia, 200)
        for corpo, esperado in (({'anuncioId': aid, 'valor': 200}, 400), ({'anuncioId': aid, 'valor': 0}, 400),
                                ({'anuncioId': aid, 'valor': 1.5}, 400), ({'anuncioId': 999999, 'valor': 5}, 404)):
            self.assertEqual(b.pede('POST', '/api/mercado/propor', corpo)[0], esperado, corpo)
        self.assertEqual(a.pede('POST', '/api/mercado/propor', {'anuncioId': aid, 'valor': 50})[0], 400,
                         'o vendedor não propõe no próprio anúncio')
        p1 = self.propoe(b, aid, 120)
        p2 = self.propoe(b, aid, 150)                          # a nova substitui a antiga
        self.assertEqual(self.sql("SELECT estado FROM mercado_propostas WHERE id = ?", p1)[0]['estado'], 'cancelada')
        # o vendedor vê a proposta recebida
        status, av = a.pede('GET', '/api/mercado/avisos')
        self.assertEqual([(x['id'], x['valor'], x['comprador']) for x in av['recebidas']], [(p2, 150, b.conta['nome'])])
        status, meus = a.pede('GET', '/api/mercado/meus')
        props = [x for x in meus['anuncios'] if x['id'] == aid][0]['propostas']
        self.assertIn((p2, 150, 'aberta'), [(x['id'], x['valor'], x['estado']) for x in props])
        # o comprador não responde a própria proposta, e não confirma o que não foi aceito
        self.assertEqual(b.pede('POST', '/api/mercado/responder', {'propostaId': p2, 'aceitar': True})[0], 404)
        self.assertEqual(b.pede('POST', '/api/mercado/confirmar', {'propostaId': p2, 'aceitar': True})[0], 409)
        status, r = a.pede('POST', '/api/mercado/responder', {'propostaId': p2, 'aceitar': True})
        self.assertEqual((status, r.get('estado')), (200, 'aceita'), r)
        self.assertEqual(self.sql("SELECT estado FROM mercado_anuncios WHERE id = ?", aid)[0]['estado'], 'aberto',
                         'aceitar não fecha o anúncio')
        status, av = b.pede('GET', '/api/mercado/avisos')
        conf = [x for x in av['confirmar'] if x['id'] == p2][0]
        self.assertEqual((conf['vendedor'], conf['valor'], conf['preco'], conf['itemId']), (a.conta['nome'], 150, 200, PECA))
        self.assertEqual(a.pede('POST', '/api/mercado/confirmar', {'propostaId': p2, 'aceitar': True})[0], 404)
        status, r = b.pede('POST', '/api/mercado/confirmar', {'propostaId': p2, 'aceitar': True})
        self.assertEqual(status, 200, r)
        self.assertEqual((r['valor'], r['deCarteira'], r['deBanco']), (150, 100, 50))
        sb, sa = self.save(b), self.save(a)
        self.assertIn(ia, self.series(sb))
        self.assertEqual(self.bolso(sb), (0, 50))
        self.assertEqual(self.bolso(sa), (150 - taxa(150), 0), 'a taxa é sobre o valor NEGOCIADO (8 de 150)')
        self.assertEqual(taxa(150), 8)
        self.assertEqual(self.sql("SELECT estado FROM mercado_propostas WHERE id = ?", p2)[0]['estado'], 'concluida')
        self.assertEqual(self.sql("SELECT valor_final, taxa FROM mercado_anuncios WHERE id = ?", aid),
                         [{'valor_final': 150, 'taxa': 8}])

    def test_06_dois_aceitos_o_primeiro_leva(self):
        a, b, c = self.novo('Vende Dois'), self.novo('Primeiro'), self.novo('Segundo')
        ia = self.serie('dd')
        self.poe_estado(a, pecas=[ia])
        self.poe_estado(b, carteira=300)
        self.poe_estado(c, carteira=300)
        aid = self.anuncia(a, ia, 250)
        pb, pc = self.propoe(b, aid, 200), self.propoe(c, aid, 210)
        for p in (pb, pc):
            self.assertEqual(a.pede('POST', '/api/mercado/responder', {'propostaId': p, 'aceitar': True})[0], 200)
        status, r = b.pede('POST', '/api/mercado/confirmar', {'propostaId': pb, 'aceitar': True})
        self.assertEqual(status, 200, r)
        status, av = c.pede('GET', '/api/mercado/avisos')
        self.assertEqual([x['id'] for x in av['confirmar'] if x['id'] == pc], [], 'a do segundo não pede mais confirmação')
        self.assertIn((pc, 'perdida'), [(x['id'], x['estado']) for x in av['desfechos']])
        status, r = c.pede('POST', '/api/mercado/confirmar', {'propostaId': pc, 'aceitar': True})
        self.assertEqual((status, r.get('motivo')), (409, 'perdeu'), r)
        self.assertIn('perdeu essa negociação', r['erro'])
        self.assertEqual(self.bolso(self.save(c)), (300, 0), 'quem perdeu não paga nada')
        self.assertIn(ia, self.series(self.save(b)))
        self.assertEqual(c.pede('POST', '/api/mercado/visto', {'desfechos': [pc]})[0], 200)
        self.assertEqual([x for x in c.pede('GET', '/api/mercado/avisos')[1]['desfechos'] if x['id'] == pc], [])

    def test_07_negar_mantem_o_anuncio_e_recusa(self):
        a, b, c = self.novo('Vende Nega'), self.novo('Desiste'), self.novo('Recusado')
        ia = self.serie('ng')
        self.poe_estado(a, pecas=[ia])
        self.poe_estado(b, carteira=300)
        self.poe_estado(c, carteira=300)
        aid = self.anuncia(a, ia, 100)
        pb, pc = self.propoe(b, aid, 90), self.propoe(c, aid, 20)
        self.assertEqual(a.pede('POST', '/api/mercado/responder', {'propostaId': pb, 'aceitar': True})[0], 200)
        self.assertEqual(a.pede('POST', '/api/mercado/responder', {'propostaId': pc, 'aceitar': False})[0], 200)
        self.assertEqual(a.pede('POST', '/api/mercado/responder', {'propostaId': pc, 'aceitar': True})[0], 409)
        status, r = b.pede('POST', '/api/mercado/confirmar', {'propostaId': pb, 'aceitar': False})
        self.assertEqual((status, r.get('estado')), (200, 'desistiu'), r)
        self.assertEqual(self.sql("SELECT estado FROM mercado_anuncios WHERE id = ?", aid)[0]['estado'], 'aberto')
        self.assertEqual(self.bolso(self.save(b)), (300, 0))
        self.assertIn((pc, 'recusada'), [(x['id'], x['estado']) for x in c.pede('GET', '/api/mercado/avisos')[1]['desfechos']])
        status, minhas = c.pede('GET', '/api/mercado/propostas')
        self.assertEqual([(x['estado'], x['vendedor'], x['preco'], x['valor']) for x in minhas['propostas'] if x['id'] == pc],
                         [('recusada', a.conta['nome'], 100, 20)])

    def test_08_vendido_a_outro_antes_de_confirmar(self):
        a, b, c = self.novo('Vende Antes'), self.novo('Demorou'), self.novo('Pagou Logo')
        ia = self.serie('va')
        self.poe_estado(a, pecas=[ia])
        self.poe_estado(b, carteira=300)
        self.poe_estado(c, carteira=300)
        aid = self.anuncia(a, ia, 100)
        pb = self.propoe(b, aid, 60)
        self.assertEqual(a.pede('POST', '/api/mercado/responder', {'propostaId': pb, 'aceitar': True})[0], 200)
        status, r = c.pede('POST', '/api/mercado/comprar', {'anuncioId': aid})
        self.assertEqual(status, 200, r)
        self.assertEqual(self.sql("SELECT estado, visto FROM mercado_propostas WHERE id = ?", pb),
                         [{'estado': 'perdida', 'visto': 0}])
        status, r = b.pede('POST', '/api/mercado/confirmar', {'propostaId': pb, 'aceitar': True})
        self.assertEqual((status, r.get('motivo')), (409, 'perdeu'), r)
        self.assertEqual(self.bolso(self.save(b)), (300, 0))
        self.assertEqual(self.bolso(self.save(a)), (95, 0), 'a venda foi pelo preço, com a taxa do preço')

    def test_09_retirar_devolve_e_cancela(self):
        a, b = self.novo('Retira'), self.novo('Ofertou')
        ia = self.serie('rt')
        self.poe_estado(a, pecas=[ia])
        self.poe_estado(b, carteira=300)
        aid = self.anuncia(a, ia, 100)
        pb = self.propoe(b, aid, 70)
        self.assertEqual(b.pede('POST', '/api/mercado/retirar', {'anuncioId': aid})[0], 404, 'só o dono retira')
        status, r = a.pede('POST', '/api/mercado/retirar', {'anuncioId': aid})
        self.assertEqual(status, 200, r)
        self.assertEqual(r['item']['iid'], ia)
        sa = self.save(a)
        self.assertEqual(self.series(sa).count(ia), 1)
        self.assertEqual(self.item_do_registro(ia), [{'conta_id': a.conta['id'], 'origem': 'saque', 'estado': 'vivo'}])
        self.assertEqual(self.sql("SELECT estado FROM mercado_propostas WHERE id = ?", pb)[0]['estado'], 'cancelada')
        self.assertIn((pb, 'cancelada'), [(x['id'], x['estado']) for x in b.pede('GET', '/api/mercado/avisos')[1]['desfechos']])
        self.assertEqual(a.pede('POST', '/api/mercado/retirar', {'anuncioId': aid})[0], 409)
        self.assertEqual(b.pede('POST', '/api/mercado/comprar', {'anuncioId': aid})[1].get('motivo'), 'perdeu')

    def test_10_sem_saldo_nao_propoe_e_cancelar(self):
        a, b = self.novo('Vende Caro'), self.novo('Liso')
        ia = self.serie('sl')
        self.poe_estado(a, pecas=[ia])
        self.poe_estado(b, carteira=10, banco=5)
        aid = self.anuncia(a, ia, 500)
        status, r = b.pede('POST', '/api/mercado/propor', {'anuncioId': aid, 'valor': 16})
        self.assertEqual((status, r.get('motivo'), r.get('faltam')), (409, 'saldo', 1), r)
        pb = self.propoe(b, aid, 15)
        # o saldo cai antes da confirmação: sem saldo, a proposta segue aceita
        self.assertEqual(a.pede('POST', '/api/mercado/responder', {'propostaId': pb, 'aceitar': True})[0], 200)
        self.assertEqual(b.pede('POST', '/api/op', {'hashAntes': self.save(b)['hash'],
                                                  'ops': [{'nome': 'depositarMoedas', 'args': {'n': 10}}]})[0], 200)
        self.sql("UPDATE saves SET db = json_set(db, '$.banco.moedas', 2) WHERE conta_id = ?", b.conta['id'])
        status, r = b.pede('POST', '/api/mercado/confirmar', {'propostaId': pb, 'aceitar': True})
        self.assertEqual((status, r.get('motivo')), (409, 'saldo'), r)
        self.assertEqual(self.sql("SELECT estado FROM mercado_propostas WHERE id = ?", pb)[0]['estado'], 'aceita')
        status, r = b.pede('POST', '/api/mercado/cancelar', {'propostaId': pb})
        self.assertEqual((status, r.get('estado')), (200, 'cancelada'), r)
        self.assertEqual(b.pede('POST', '/api/mercado/cancelar', {'propostaId': pb})[0], 409)
        self.assertEqual(a.pede('POST', '/api/mercado/cancelar', {'propostaId': pb})[0], 404)

    def test_11_legado_vira_anuncio(self):
        a, b = self.novo('Legado'), self.novo('Compra Legado')
        il = self.serie('lg')
        mercado = {'dia': '2026-09-12', 'ofertas': [
            {'id': 'jg-1', 'vendedor': 'jogador', 'itemId': PECA, 'level': 2, 'stars': 1, 'iid': il, 'preco': 120},
            {'id': 'jg-2', 'vendedor': 'jogador', 'itemId': PECA, 'level': 0, 'stars': 0, 'iid': None, 'preco': 50},
            {'id': 'mf-1', 'vendedor': 'mercador', 'itemId': PECA, 'level': 0, 'stars': 0, 'preco': 9}]}
        self.poe_estado(a, mercado=mercado, nasc_extra=[il])
        self.poe_estado(b, carteira=1000)
        self.assertEqual(self.item_do_registro(il)[0]['estado'], 'vivo')
        status, r = a.pede('GET', '/api/mercado/meus')
        self.assertEqual(status, 200, r)
        self.assertIn('progress', r, 'a migração devolve o estado novo para adotar')
        self.assertEqual(r['db']['mercado']['ofertas'], [])
        self.assertEqual(sorted((x['preco'], x['level'], x['stars']) for x in r['anuncios']), [(50, 0, 0), (120, 2, 1)])
        self.assertEqual(self.save(a)['db']['mercado']['ofertas'], [])
        self.assertEqual(self.item_do_registro(il), [{'conta_id': a.conta['id'], 'origem': 'saque', 'estado': 'vivo'}])
        status, r2 = a.pede('GET', '/api/mercado/meus')
        self.assertNotIn('progress', r2, 'a migração roda uma vez')
        self.assertEqual(len(r2['anuncios']), 2)
        com, sem = sorted(r['anuncios'], key=lambda x: -x['preco'])
        status, r = b.pede('POST', '/api/mercado/comprar', {'anuncioId': com['id']})
        self.assertEqual(status, 200, r)
        self.assertEqual(r['item']['iid'], il)
        status, r = b.pede('POST', '/api/mercado/comprar', {'anuncioId': sem['id']})
        self.assertEqual(status, 200, r)
        nova = r['item']['iid']
        self.assertNotEqual(nova, il)
        self.assertEqual(self.item_do_registro(nova), [{'conta_id': b.conta['id'], 'origem': 'mercador', 'estado': 'vivo'}],
                         'a oferta antiga sem série ganha série nova na venda')
        sb = self.save(b)
        self.assertEqual((self.series(sb).count(il), self.series(sb).count(nova)), (1, 1))
        self.assertEqual(self.bolso(self.save(a)), (120 - taxa(120) + 50 - taxa(50), 0))

    def test_12_serie_nao_some_nem_duplica(self):
        a = self.novo('Custodia')
        ia, ib = self.serie('cu'), self.serie('cu')
        self.poe_estado(a, carteira=100, pecas=[ia, ib])
        aid = self.anuncia(a, ia, 100)
        # a op seguinte (juiz) não marca a série em custódia como 'fora'
        s = self.save(a)
        status, r = a.pede('POST', '/api/op', {'hashAntes': s['hash'], 'ops': [{'nome': 'depositarMoedas', 'args': {'n': 10}}]})
        self.assertEqual(status, 200, r)
        self.assertEqual(self.item_do_registro(ia)[0]['estado'], 'vivo')
        # o PUT cosmético com a série de volta no saco não a põe lá
        s = self.save(a)
        p = copy.deepcopy(s['progress'])
        p['inventory'].append({'itemId': PECA, 'level': 1, 'stars': 1, 'iid': ia})
        status, r = a.salva(s['versao'], p, s['db'])
        self.assertEqual(status, 200, r)
        self.assertNotIn(ia, self.series(self.save(a)))
        # a API SEM juiz (o cartório de antes): a varredura do salvar não mata a série em custódia...
        sem = Cliente(self.base_sem_juiz)
        sem.token, sem.conta = a.token, a.conta
        s = self.save(a)
        status, r = sem.salva(s['versao'], s['progress'], s['db'])
        self.assertEqual(status, 200, r)
        self.assertEqual(self.item_do_registro(ia)[0]['estado'], 'vivo', 'a varredura pula a peça anunciada')
        self.assertEqual(self.item_do_registro(ib)[0]['estado'], 'vivo')
        # ...e um save que a traga de volta ao saco é recusado (seria a mesma peça em dois lugares)
        s = self.save(a)
        p = copy.deepcopy(s['progress'])
        p['inventory'].append({'itemId': PECA, 'level': 1, 'stars': 1, 'iid': ia})
        status, r = sem.salva(s['versao'], p, s['db'])
        self.assertEqual(status, 409, r)
        self.assertIn('mercadinho', r['erro'])
        # e segue vendável, uma vez
        b = self.novo('Compra Custodia')
        self.poe_estado(b, carteira=100)
        self.assertEqual(b.pede('POST', '/api/mercado/comprar', {'anuncioId': aid})[0], 200)
        self.assertEqual(len(self.sql("SELECT iid FROM itens WHERE iid = ?", ia)), 1)
        self.assertEqual(self.item_do_registro(ia)[0]['conta_id'], b.conta['id'])

    def test_13_teto_de_anuncios_e_saco_cheio(self):
        a, b = self.novo('Teto'), self.novo('Saco Cheio')
        import mercado as mc
        pecas = [self.serie('tt') for _ in range(mc.ANUNCIOS_MAX + 1)]
        self.poe_estado(a, pecas=pecas)
        for iid in pecas[:mc.ANUNCIOS_MAX]:
            self.anuncia(a, iid, 5)
        status, r = a.pede('POST', '/api/mercado/anunciar', {'iid': pecas[-1], 'preco': 5})
        self.assertEqual(status, 409, r)
        self.assertIn('máximo', r['erro'])
        # saco cheio: não compra, e nada muda
        cheio = [self.serie('sc') for _ in range(200)]
        p = copy.deepcopy(self.inicial['progress'])
        d = copy.deepcopy(self.inicial['db'])
        limite = roda_node(['-e', "const est=require(process.argv[1]);const w=est.mundoEconomico({});est.poeEstado(w,null,null);"
                                  "process.stdout.write(JSON.stringify(w.J.Progress.bagLimit ? w.J.Progress.bagLimit() : 60))",
                            ESTADO_JS])
        cheio = cheio[:int(limite)]
        for iid in cheio:
            p['inventory'].append({'itemId': PECA, 'level': 0, 'stars': 0, 'iid': iid})
        d['carteira'] = {'moedas': 100}
        status, r = b.salva(0, p, d, [{'iid': i, 'itemId': PECA, 'origem': 'saque'} for i in cheio])
        self.assertEqual(status, 200, r)
        aid = self.sql("SELECT id FROM mercado_anuncios WHERE vendedor_id = ? AND estado = 'aberto' LIMIT 1",
                       a.conta['id'])[0]['id']
        antes = self.save(b)
        status, r = b.pede('POST', '/api/mercado/comprar', {'anuncioId': aid})
        self.assertEqual((status, r.get('motivo')), (409, 'saco'), r)
        self.assertEqual(self.save(b)['versao'], antes['versao'])
        self.assertEqual(self.sql("SELECT estado FROM mercado_anuncios WHERE id = ?", aid)[0]['estado'], 'aberto')

    # -- o LOTE de pedras de forja (22/09) --------------------------------------------------------------
    def test_14_lote_anuncia_e_retira(self):
        a = self.novo('Pedreira')
        self.poe_estado(a, pedras={'stone-ember': 120})
        antes = self.save(a)
        for corpo in ({'tipo': 'pedra', 'stoneId': 'stone-ember', 'qtd': 7, 'preco': 50},
                      {'tipo': 'pedra', 'stoneId': 'stone-ember', 'qtd': '10', 'preco': 50},
                      {'tipo': 'pedra', 'stoneId': 'stone-ember', 'qtd': True, 'preco': 50},
                      {'tipo': 'pedra', 'stoneId': 'stone-ember', 'qtd': 10.0, 'preco': 50},
                      {'tipo': 'pedra', 'stoneId': 'stone-ember', 'qtd': 1000, 'preco': 50},
                      {'tipo': 'pedra', 'stoneId': 'stone-ember', 'qtd': 10, 'preco': 0},
                      {'tipo': 'pedra', 'stoneId': 'stone-ember', 'qtd': 10, 'preco': 10000},
                      {'tipo': 'pedra', 'stoneId': 'stone ember', 'qtd': 10, 'preco': 50},
                      {'tipo': 'pedra', 'qtd': 10, 'preco': 50},
                      {'tipo': 'lote', 'stoneId': 'stone-ember', 'qtd': 10, 'preco': 50}):
            status, r = a.pede('POST', '/api/mercado/anunciar', corpo)
            self.assertEqual(status, 400, (corpo, r))
        # a pedra que o dado não conhece: quem diz é o juiz (argumento), a API devolve 400
        status, r = a.pede('POST', '/api/mercado/anunciar', {'tipo': 'pedra', 'stoneId': 'stone-nada', 'qtd': 1, 'preco': 5})
        self.assertEqual((status, r.get('motivo')), (400, 'argumento'), r)
        # estoque curto: 409 'pedras', e nada é gravado
        status, r = a.pede('POST', '/api/mercado/anunciar', {'tipo': 'pedra', 'stoneId': 'stone-tear', 'qtd': 10, 'preco': 30})
        self.assertEqual((status, r.get('motivo'), r.get('tem'), r.get('faltam')), (409, 'pedras', 0, 10), r)
        self.assertIn('pedras insuficientes', r['erro'])
        depois = self.save(a)
        self.assertEqual((depois['versao'], depois['progress'].get('stones')), (antes['versao'], antes['progress'].get('stones')))
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM mercado_anuncios WHERE vendedor_id = ?", a.conta['id']),
                         [{'n': 0}], 'nada foi anunciado')
        # o lote de 50: as pedras saem do estado do SERVIDOR
        status, r = a.pede('POST', '/api/mercado/anunciar', {'tipo': 'pedra', 'stoneId': 'stone-ember', 'qtd': 50, 'preco': 240})
        self.assertEqual(status, 200, r)
        aid = r['anuncio']['id']
        self.assertEqual(r['anuncio'], {'id': aid, 'tipo': 'pedra', 'itemId': 'stone-ember', 'stoneId': 'stone-ember',
                                        'qtd': 50, 'preco': 240, 'taxa': taxa(240)})
        self.assertEqual(self.estoque(r, 'stone-ember'), 70, 'a resposta traz o estado sem as 50')
        s = self.save(a)
        self.assertEqual((self.estoque(s, 'stone-ember'), s['versao']), (70, r['versao']))
        self.assertEqual(self.sql("SELECT anuncio_id, tipo, qtd FROM mercado_lotes WHERE anuncio_id = ?", aid),
                         [{'anuncio_id': aid, 'tipo': 'pedra', 'qtd': 50}])
        self.assertEqual(self.sql("SELECT item_id, iid, level, stars, preco, estado FROM mercado_anuncios WHERE id = ?", aid),
                         [{'item_id': 'stone-ember', 'iid': None, 'level': 0, 'stars': 0, 'preco': 240, 'estado': 'aberto'}])
        # Meus anúncios diz tipo e qtd (a peça diria 'peca' e 1)
        status, meus = a.pede('GET', '/api/mercado/meus')
        self.assertEqual([(x['id'], x['tipo'], x['qtd'], x['itemId'], x['taxa']) for x in meus['anuncios']],
                         [(aid, 'pedra', 50, 'stone-ember', 12)])
        # retirar: as 50 voltam ao estoque
        status, r = a.pede('POST', '/api/mercado/retirar', {'anuncioId': aid})
        self.assertEqual(status, 200, r)
        self.assertEqual((r['tipo'], r['pedras']), ('pedra', {'stoneId': 'stone-ember', 'qtd': 50}))
        self.assertEqual(r['item'], {'itemId': 'stone-ember', 'level': 0, 'stars': 0, 'qtd': 50, 'tipo': 'pedra'})
        self.assertEqual(self.estoque(r, 'stone-ember'), 120)
        self.assertEqual(self.estoque(self.save(a), 'stone-ember'), 120)
        self.assertEqual(self.sql("SELECT estado FROM mercado_anuncios WHERE id = ?", aid)[0]['estado'], 'retirado')
        self.assertEqual(a.pede('POST', '/api/mercado/retirar', {'anuncioId': aid})[0], 409, 'não retira duas vezes')

    def test_15_lote_comprar_saco_depois_banco(self):
        a, b, c = self.novo('Vende Lote'), self.novo('Compra Lote'), self.novo('Lote Liso')
        self.poe_estado(a, carteira=5, pedras={'stone-tear': 100})
        # o comprador de saco CHEIO: pedra não ocupa o saco, a compra passa
        self.poe_estado(b, carteira=30, banco=200, pedras={'stone-tear': 3}, saco_cheio=self.limite_do_saco())
        self.poe_estado(c, carteira=40, banco=50)
        aid = self.anuncia_lote(a, 'stone-tear', 100, 150)
        self.assertEqual(a.pede('POST', '/api/mercado/comprar', {'anuncioId': aid})[0], 400, 'o próprio lote não se compra')
        status, r = c.pede('POST', '/api/mercado/comprar', {'anuncioId': aid})
        self.assertEqual((status, r.get('motivo'), r.get('faltam')), (409, 'saldo', 60), r)
        self.assertEqual(self.estoque(self.save(c), 'stone-tear'), 0)
        status, r = b.pede('POST', '/api/mercado/comprar', {'anuncioId': aid})
        self.assertEqual(status, 200, r)
        self.assertEqual((r['valor'], r['deCarteira'], r['deBanco'], r['tipo'], r['qtd']), (150, 30, 120, 'pedra', 100))
        self.assertEqual(r['pedras'], {'stoneId': 'stone-tear', 'qtd': 100})
        self.assertEqual(r['item'], {'itemId': 'stone-tear', 'level': 0, 'stars': 0, 'qtd': 100, 'tipo': 'pedra'})
        sb, sa = self.save(b), self.save(a)
        self.assertEqual((self.estoque(sb, 'stone-tear'), self.bolso(sb)), (103, (0, 80)))
        self.assertEqual((self.estoque(sa, 'stone-tear'), self.bolso(sa)), (0, (5 + 150 - taxa(150), 0)),
                         'o vendedor recebe o preço menos a taxa (8 de 150)')
        self.assertEqual((sb['progress'], sb['db']), (r['progress'], r['db']))
        self.assertEqual(self.sql("SELECT estado, valor_final, taxa, comprador_id FROM mercado_anuncios WHERE id = ?", aid),
                         [{'estado': 'vendido', 'valor_final': 150, 'taxa': 8, 'comprador_id': b.conta['id']}])
        self.assertEqual(b.pede('POST', '/api/mercado/comprar', {'anuncioId': aid})[1].get('motivo'), 'perdeu')
        # o vendedor fica sabendo, com tipo e qtd
        status, av = a.pede('GET', '/api/mercado/avisos')
        venda = [v for v in av['vendas'] if v['id'] == aid]
        self.assertEqual([(v['tipo'], v['qtd'], v['itemId'], v['valor'], v['recebeu']) for v in venda],
                         [('pedra', 100, 'stone-tear', 150, 142)], av)
        status, meus = a.pede('GET', '/api/mercado/meus')
        self.assertEqual([(v['tipo'], v['qtd'], v['recebeu']) for v in meus['vendas'] if v['id'] == aid], [('pedra', 100, 142)])

    def test_16_resumo_e_item_das_pedras(self):
        a, b = self.novo('Lotes A'), self.novo('Lotes B')
        self.poe_estado(a, pedras={'stone-breath': 200})
        self.poe_estado(b, pedras={'stone-breath': 100})
        ids = [self.anuncia_lote(a, 'stone-breath', 10, 50),          # 5 por pedra
               self.anuncia_lote(a, 'stone-breath', 100, 350),        # 3,5
               self.anuncia_lote(a, 'stone-breath', 10, 35),          # 3,5 — empata, o lote mais barato primeiro
               self.anuncia_lote(b, 'stone-breath', 50, 200),         # 4
               self.anuncia_lote(b, 'stone-breath', 1, 7)]            # 7
        status, res = a.pede('GET', '/api/mercado/resumo')
        self.assertEqual(status, 200, res)
        self.assertEqual([x for x in res['pedras'] if x['stoneId'] == 'stone-breath'],
                         [{'stoneId': 'stone-breath', 'lotes': 5, 'pedras': 171, 'menor': 7, 'menorUnit': 3.5, 'meus': 3}])
        self.assertEqual(res['lotesPedra'], [1, 10, 50, 100])
        self.assertNotIn('stone-breath', [x['itemId'] for x in res['itens']], 'itens é só de peças')
        self.assertTrue(all(not x['itemId'].startswith('stone-') for x in res['itens']), res['itens'])
        status, it = b.pede('GET', '/api/mercado/item?id=stone-breath')
        self.assertEqual(status, 200, it)
        self.assertEqual([(x['id'], x['tipo'], x['qtd'], x['preco'], x['unit'], x['meu']) for x in it['anuncios']],
                         [(ids[2], 'pedra', 10, 35, 3.5, False), (ids[1], 'pedra', 100, 350, 3.5, False),
                          (ids[3], 'pedra', 50, 200, 4, True), (ids[0], 'pedra', 10, 50, 5, False),
                          (ids[4], 'pedra', 1, 7, 7, True)])
        self.assertEqual(it['anuncios'][0]['vendedor'], a.conta['nome'])
        # a peça ganha tipo 'peca', qtd 1 e unit = preço, e a ordem de sempre (preço)
        status, it = b.pede('GET', '/api/mercado/item?id=' + PECA)
        self.assertTrue(it['anuncios'], it)
        self.assertTrue(all(x['tipo'] == 'peca' and x['qtd'] == 1 and x['unit'] == x['preco'] for x in it['anuncios']))
        self.assertEqual([x['preco'] for x in it['anuncios']], sorted(x['preco'] for x in it['anuncios']))
        # o estoque dos dois caiu o que anunciaram
        self.assertEqual((self.estoque(self.save(a), 'stone-breath'), self.estoque(self.save(b), 'stone-breath')), (80, 49))

    def test_17_proposta_no_lote(self):
        a, b, c = self.novo('Lote Prop'), self.novo('Propoe Lote'), self.novo('Perde Lote')
        self.poe_estado(a, pedras={'stone-slate': 60})
        self.poe_estado(b, carteira=100)
        self.poe_estado(c, carteira=100)
        aid = self.anuncia_lote(a, 'stone-slate', 50, 100)
        self.assertEqual(b.pede('POST', '/api/mercado/propor', {'anuncioId': aid, 'valor': 100})[0], 400,
                         'a proposta é menor que o preço, no lote também')
        pb, pc = self.propoe(b, aid, 80), self.propoe(c, aid, 60)
        status, av = a.pede('GET', '/api/mercado/avisos')
        self.assertEqual(sorted((x['id'], x['tipo'], x['qtd']) for x in av['recebidas'] if x['anuncioId'] == aid),
                         sorted([(pb, 'pedra', 50), (pc, 'pedra', 50)]))
        self.assertEqual(a.pede('POST', '/api/mercado/responder', {'propostaId': pb, 'aceitar': True})[0], 200)
        status, av = b.pede('GET', '/api/mercado/avisos')
        conf = [x for x in av['confirmar'] if x['id'] == pb]
        self.assertEqual([(x['tipo'], x['qtd'], x['itemId'], x['valor'], x['preco']) for x in conf],
                         [('pedra', 50, 'stone-slate', 80, 100)])
        status, minhas = b.pede('GET', '/api/mercado/propostas')
        self.assertEqual([(x['tipo'], x['qtd'], x['estado']) for x in minhas['propostas'] if x['id'] == pb],
                         [('pedra', 50, 'aceita')])
        status, r = b.pede('POST', '/api/mercado/confirmar', {'propostaId': pb, 'aceitar': True})
        self.assertEqual(status, 200, r)
        self.assertEqual((r['valor'], r['tipo'], r['pedras']), (80, 'pedra', {'stoneId': 'stone-slate', 'qtd': 50}))
        sb, sa = self.save(b), self.save(a)
        self.assertEqual((self.estoque(sb, 'stone-slate'), self.bolso(sb)), (50, (20, 0)))
        self.assertEqual((self.estoque(sa, 'stone-slate'), self.bolso(sa)), (10, (80 - taxa(80), 0)))
        self.assertEqual(self.sql("SELECT estado FROM mercado_propostas WHERE id = ?", pb)[0]['estado'], 'concluida')
        status, av = c.pede('GET', '/api/mercado/avisos')
        self.assertEqual([(x['estado'], x['tipo'], x['qtd']) for x in av['desfechos'] if x['id'] == pc],
                         [('perdida', 'pedra', 50)])
        self.assertEqual(self.bolso(self.save(c)), (100, 0), 'quem perdeu não paga nada')

    def test_18_lote_ops_internas_e_teto(self):
        a = self.novo('Teto Lote')
        import mercado as mc
        self.poe_estado(a, pedras={'stone-root': mc.ANUNCIOS_MAX + 1})
        for nome in ('mercadoTiraPedras', 'mercadoPoePedras'):
            status, r = a.pede('POST', '/api/op', {'ops': [{'nome': nome, 'args': {'stoneId': 'stone-root', 'qtd': 1}}]})
            self.assertEqual(status, 403, (nome, r))
        # o teto de anúncios abertos conta o lote como conta a peça
        for _ in range(mc.ANUNCIOS_MAX):
            self.anuncia_lote(a, 'stone-root', 1, 3)
        status, r = a.pede('POST', '/api/mercado/anunciar', {'tipo': 'pedra', 'stoneId': 'stone-root', 'qtd': 1, 'preco': 3})
        self.assertEqual(status, 409, r)
        self.assertIn('máximo', r['erro'])
        self.assertEqual(self.estoque(self.save(a), 'stone-root'), 1, 'o anúncio recusado pelo teto não tira pedra')

    def test_19_lote_local_de_antes_volta_ao_estoque(self):
        a = self.novo('Lote Legado')
        mercado = {'dia': '2026-09-21', 'ofertas': [
            {'id': 'jg-1', 'vendedor': 'jogador', 'tipo': 'pedra', 'stoneId': 'stone-ember', 'qtd': 10, 'preco': 50},
            {'id': 'jg-2', 'vendedor': 'jogador', 'itemId': PECA, 'level': 0, 'stars': 0, 'iid': None, 'preco': 40}]}
        self.poe_estado(a, mercado=mercado, pedras={'stone-ember': 5})
        status, r = a.pede('GET', '/api/mercado/meus')
        self.assertEqual(status, 200, r)
        self.assertEqual(r['db']['mercado']['ofertas'], [])
        self.assertEqual(self.estoque(r, 'stone-ember'), 15, 'as 10 do lote local voltaram ao estoque')
        self.assertEqual([(x['tipo'], x['itemId'], x['preco']) for x in r['anuncios']], [('peca', PECA, 40)],
                         'só a peça virou anúncio')
        self.assertEqual(self.estoque(self.save(a), 'stone-ember'), 15)


if __name__ == '__main__':
    unittest.main(verbosity=2)
