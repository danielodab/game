#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova das barras de ouro compradas pela Google Play no aplicativo
(servidor/pagamento_play.py), pela API de verdade e com a Google DE MENTIRA
(tests/play_falso.py).

    python tests/pagamento_play_api.py

Sobe a Google falsa numa thread e servidor/api.py em subprocessos (banco
descartável; SOTERRA_PLAY_CREDENCIAL com uma conta de serviço inventada, só no
ambiente do subprocesso; `--play-api` apontando a falsa). Nenhuma credencial de
verdade, nenhuma conversa com a Google de verdade.

O que se prova: sem a credencial as rotas dão 503 e a loja segue; a compra paga
credita UMA vez (repetida, dez em paralelo, nos dois processos do rolling
update) e manda consumir; o token inventado, o de outro pacote e o de outro
aplicativo não creditam; a compra pendente não credita e credita quando a
Google confirma; a cancelada/reembolsada não credita; a de teste só com
SOTERRA_PLAY_TESTE=1; a de outra conta do jogo não credita; o teto de R$ 400 em
24 h (somando o Mercado Pago) segura e não manda consumir; a conta banida não
recebe; o reembolso (a lista de anuladas da Google) tira as barras, alerta o
Mestre do que já foi gasto e não tira duas vezes; o extrato e os dados da conta
mostram a compra; a Google fora responde 502 sem creditar; o JWT da conta de
serviço passa na conferência da assinatura; e o log não tem a chave.
"""
import json
import os
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
from play_falso import GooglePlayFalsa  # noqa: E402
import pagamento_play as play_mod  # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROTA = '/api/pagamento/play'


def sobe_api(pasta, nome, banco, env_extra=None, play_api=None):
    porta = porta_livre()
    log_arq = os.path.join(pasta, nome + '.log')
    log = open(log_arq, 'w', encoding='utf-8')
    env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
    env.update(env_extra or {})
    args = [sys.executable, API, '--porta', str(porta), '--banco', banco]
    if play_api:
        args += ['--play-api', play_api]
    proc = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT, env=env)
    base = 'http://127.0.0.1:%d' % porta
    if not espera_api(base, proc):
        proc.kill()
        log.close()
        raise RuntimeError('a API %s não subiu; veja %s' % (nome, log_arq))
    return proc, log, base, log_arq


class ProvaDaPlay(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.mkdtemp(prefix='soterra-play-')
        cls.g = GooglePlayFalsa()
        cls.banco_arq = os.path.join(cls.pasta, 'dados', 'soterra.db')
        cls.env = {'SOTERRA_PLAY_CREDENCIAL': cls.g.credencial()}
        cls.procs = []
        try:
            p, lg, cls.base, cls.log_arq = sobe_api(cls.pasta, 'api', cls.banco_arq, cls.env, cls.g.base)
            cls.procs.append((p, lg))
            # o segundo contêiner do rolling update: o MESMO banco
            p, lg, cls.base2, _ = sobe_api(cls.pasta, 'api2', cls.banco_arq, cls.env, cls.g.base)
            cls.procs.append((p, lg))
            # sem a credencial (banco próprio)
            p, lg, cls.base_off, _ = sobe_api(cls.pasta, 'api-off', os.path.join(cls.pasta, 'off', 'soterra.db'))
            cls.procs.append((p, lg))
            # com a credencial num ARQUIVO e aceitando compra de teste (banco próprio)
            arq = os.path.join(cls.pasta, 'conta-de-servico.json')
            with open(arq, 'w', encoding='utf-8') as f:
                f.write(cls.g.credencial())
            p, lg, cls.base_teste, _ = sobe_api(cls.pasta, 'api-teste', os.path.join(cls.pasta, 'teste', 'soterra.db'),
                                                {'SOTERRA_PLAY_CREDENCIAL': arq, 'SOTERRA_PLAY_TESTE': '1'}, cls.g.base)
            cls.procs.append((p, lg))
        except Exception:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        for proc, log in cls.procs:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(5)
                except subprocess.TimeoutExpired:
                    proc.kill()
            log.close()
        cls.g.parar()
        shutil.rmtree(cls.pasta, ignore_errors=True)

    # -- ajudantes ------------------------------------------------------------------
    def novo(self, apelido, base=None):
        ProvaDaPlay._n += 1
        c = Cliente(base or self.base)
        status, r = c.cadastra('%s %d' % (apelido, ProvaDaPlay._n))
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

    def barras(self, c):
        r = self.sql("SELECT saldo FROM barras_saldo WHERE conta_id = ?", c.conta['id'])
        return r[0]['saldo'] if r else 0

    def manda(self, c, pacote, token):
        return c.pede('POST', ROTA, {'pacote': pacote, 'token': token})

    # -- as provas ------------------------------------------------------------------
    def test_01_sem_credencial_503_e_o_resto_segue(self):
        c = self.novo('Sem Play', self.base_off)
        self.assertEqual(c.pede('GET', ROTA)[0], 503)
        status, r = c.pede('POST', ROTA, {'pacote': 'barras-50', 'token': 'x' * 40})
        self.assertEqual((status, r.get('play')), (503, False), r)
        self.assertEqual(c.pede('GET', '/api/loja/catalogo')[0], 200, 'a loja não depende da Play')

    def test_02_os_produtos_e_o_codigo_da_conta(self):
        c = self.novo('Vitrine')
        status, r = c.pede('GET', ROTA)
        self.assertEqual(status, 200, r)
        self.assertEqual([(p['id'], p['produto'], p['barras']) for p in r['pacotes']],
                         [('barras-50', 'barras_50', 50), ('barras-280', 'barras_280', 280),
                          ('barras-600', 'barras_600', 600), ('barras-1250', 'barras_1250', 1250)])
        self.assertTrue(all(p['cabe'] for p in r['pacotes']))
        self.assertNotIn('preco', r['pacotes'][0], 'no aplicativo o preço é o da Google')
        self.assertRegex(r['conta'], r'^[0-9a-f]{40}$')
        outro = self.novo('Vitrine B')
        self.assertNotEqual(outro.pede('GET', ROTA)[1]['conta'], r['conta'])
        # o id de produto da Play não aceita hífen: o mapa é um só
        self.assertEqual(play_mod.produto_play('barras-1250'), 'barras_1250')

    def test_03_compra_valida_credita_uma_vez(self):
        c = self.novo('Compra Boa')
        token = self.g.compra('barras_280', conta=c.pede('GET', ROTA)[1]['conta'])
        status, r = self.manda(c, 'barras-280', token)
        self.assertEqual(status, 201, r)
        self.assertEqual((r['creditado'], r['consumir'], r['barras']['saldo']), (True, True, 280), r)
        self.assertEqual(self.barras(c), 280)
        antes = self.g.consultas
        # o mesmo token de novo: nada entra, e o aplicativo só é mandado consumir
        for base in (self.base, self.base2):
            c2 = Cliente(base)
            c2.token, c2.conta = c.token, c.conta
            status, r = self.manda(c2, 'barras-280', token)
            self.assertEqual((status, r['creditado'], r.get('repetido'), r['consumir']), (200, False, True, True), r)
        self.assertEqual(self.barras(c), 280)
        self.assertEqual(self.g.consultas, antes, 'o repetido nem pergunta à Google')
        # outra conta mandando o token já creditado: também não entra nada
        ladrao = self.novo('Mao Leve')
        status, r = self.manda(ladrao, 'barras-280', token)
        self.assertEqual((status, r['creditado']), (200, False), r)
        self.assertEqual(self.barras(ladrao), 0)
        # o id da Play também serve no lugar do id do pacote
        t2 = self.g.compra('barras_50')
        self.assertEqual(self.manda(c, 'barras_50', t2)[0], 201)
        self.assertEqual(self.barras(c), 330)
        # o extrato diz de onde vieram; o evento ficou; os dados da conta mostram a compra, sem o token
        mov = c.pede('GET', '/api/loja/minha')[1]['barras']['movimentos']
        self.assertTrue(any(m['motivo'] == 'pacote' and 'Google Play' in (m.get('nome') or '') for m in mov), mov)
        self.assertEqual(len(self.sql("SELECT 1 FROM eventos WHERE conta_id = ? AND tipo = 'pagamento-credito'",
                                      c.conta['id'])), 2)
        dados = c.pede('GET', '/api/conta/meus-dados')[1]
        texto = json.dumps(dados)
        self.assertIn('compras_google_play', texto)
        self.assertNotIn(token, texto)
        compras = c.pede('GET', ROTA)[1]['compras']
        self.assertEqual([x['estado'] for x in compras], ['creditada', 'creditada'])

    def test_04_dez_em_paralelo_nos_dois_processos(self):
        c = self.novo('Paralelo')
        token = self.g.compra('barras_600')
        saidas = []

        def manda(base):
            x = Cliente(base)
            x.token, x.conta = c.token, c.conta
            saidas.append(self.manda(x, 'barras-600', token))

        ths = [threading.Thread(target=manda, args=((self.base, self.base2)[i % 2],)) for i in range(10)]
        for th in ths:
            th.start()
        for th in ths:
            th.join()
        self.assertEqual(sum(1 for s, r in saidas if r.get('creditado')), 1, saidas)
        self.assertTrue(all(s in (200, 201) and r.get('consumir') for s, r in saidas), saidas)
        self.assertEqual(self.barras(c), 600)
        self.assertEqual(len(self.sql("SELECT 1 FROM barras_movimentos WHERE conta_id = ?", c.conta['id'])), 1)

    def test_05_token_invalido_de_outro_pacote_e_de_outro_app(self):
        c = self.novo('Esperto')
        self.assertEqual(self.manda(c, 'barras-50', 'curto')[0], 400)
        self.assertEqual(self.manda(c, 'barras-9999', 'x' * 40)[0], 400)
        self.assertEqual(self.manda(c, 'pacote-5500', 'x' * 40)[0], 400, 'o pacote fora da venda')
        status, r = self.manda(c, 'barras-1250', 'tok.inventado-' + 'a' * 40)
        self.assertEqual((status, r.get('consumir')), (400, False), r)
        # pagou o de 50 e pede o de 1.250
        barato = self.g.compra('barras_50')
        self.assertEqual(self.manda(c, 'barras-1250', barato)[0], 400)
        # uma compra de verdade… de outro aplicativo
        alheio = self.g.compra('barras_1250', app='com.outro.jogo')
        self.assertEqual(self.manda(c, 'barras-1250', alheio)[0], 400)
        self.assertEqual(self.barras(c), 0)
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM pagamentos_play WHERE conta_id = ?", c.conta['id'])[0]['n'], 0)
        # o de 50 continua valendo no pacote certo
        self.assertEqual(self.manda(c, 'barras-50', barato)[0], 201)

    def test_06_pendente_nao_credita_e_depois_credita(self):
        c = self.novo('Boleto')
        token = self.g.compra('barras_280', estado=2)
        status, r = self.manda(c, 'barras-280', token)
        self.assertEqual((status, r['creditado'], r['consumir'], r['estado']), (200, False, False, 'pendente'), r)
        self.assertEqual(self.barras(c), 0)
        self.g.muda(token, purchaseState=0)
        self.assertEqual(self.manda(c, 'barras-280', token)[0], 201)
        self.assertEqual(self.barras(c), 280)

    def test_07_cancelada_ou_reembolsada_nao_credita(self):
        c = self.novo('Arrependido')
        token = self.g.compra('barras_280', estado=1)
        status, r = self.manda(c, 'barras-280', token)
        self.assertEqual((status, r.get('estado'), r.get('consumir')), (409, 'cancelada', False), r)
        self.assertEqual(self.barras(c), 0)

    def test_08_compra_de_teste_so_com_a_variavel(self):
        c = self.novo('Testador')
        token = self.g.compra('barras_50', teste=True)
        status, r = self.manda(c, 'barras-50', token)
        self.assertEqual((status, r.get('estado')), (409, 'teste'), r)
        self.assertEqual(self.barras(c), 0)
        t = self.novo('Testador', self.base_teste)
        status, r = self.manda(t, 'barras-50', token)
        self.assertEqual((status, r['creditado']), (201, True), r)
        self.assertTrue(t.pede('GET', ROTA)[1]['teste'])

    def test_09_compra_de_outra_conta_do_jogo(self):
        a, b = self.novo('Dona'), self.novo('Visita')
        token = self.g.compra('barras_50', conta=a.pede('GET', ROTA)[1]['conta'])
        status, r = self.manda(b, 'barras-50', token)
        self.assertEqual((status, r.get('estado'), r.get('consumir')), (403, 'outra-conta', False), r)
        self.assertEqual(self.barras(b), 0)
        self.assertEqual(self.manda(a, 'barras-50', token)[0], 201, 'a dona entra e recebe')

    def test_10_teto_diario_somando_o_mercado_pago(self):
        c = self.novo('Baleia')
        cid, t = c.conta['id'], int(time.time())
        # R$ 319,60 já creditados hoje pelo Mercado Pago (quatro Tesouros)
        for i in range(4):
            pid = self.sql("INSERT INTO pagamentos(conta_id, pacote, vintens, centavos, estado, criado_em, atualizado_em) "
                           "VALUES (?, 'barras-1250', 1250, 7990, 'aberto', ?, ?) RETURNING id", cid, t, t)[0]['id']
            self.sql("INSERT INTO pagamentos_mp(mp_id, pagamento_id, status, creditado_em, atualizado_em) "
                     "VALUES (?, ?, 'approved', ?, ?)", '9%d%d' % (cid, i), pid, t, t)
        self.assertEqual(self.manda(c, 'barras-1250', self.g.compra('barras_1250'))[0], 201, 'R$ 399,50: cabe')
        pacotes = {p['id']: p['cabe'] for p in c.pede('GET', ROTA)[1]['pacotes']}
        self.assertFalse(any(pacotes.values()), pacotes)
        token = self.g.compra('barras_50')
        status, r = self.manda(c, 'barras-50', token)
        self.assertEqual((status, r['creditado'], r['consumir'], r['estado']), (200, False, False, 'teto'), r)
        self.assertEqual(self.barras(c), 1250)
        alertas = self.sql("SELECT dados FROM contas_alertas WHERE conta_id = ? AND tipo = 'teto-diario'", cid)
        self.assertEqual(len(alertas), 1)
        self.manda(c, 'barras-50', token)
        self.assertEqual(len(self.sql("SELECT 1 FROM contas_alertas WHERE conta_id = ? AND tipo = 'teto-diario'", cid)), 1,
                         'o alerta do teto sai uma vez')
        # passadas as 24 h, a mesma compra (ainda não consumida no aparelho) credita
        self.sql("UPDATE pagamentos_mp SET creditado_em = ? WHERE mp_id LIKE ?", t - 90000, '9%d%%' % cid)
        status, r = self.manda(c, 'barras-50', token)
        self.assertEqual((status, r['creditado'], r['consumir']), (201, True, True), r)
        self.assertEqual(self.barras(c), 1300)

    def test_11_conta_banida_nao_recebe(self):
        c = self.novo('Banido')
        token = self.g.compra('barras_280')
        self.sql("UPDATE contas SET banido = 1 WHERE id = ?", c.conta['id'])
        status, r = self.manda(c, 'barras-280', token)
        self.assertEqual(status, 403, r)
        self.assertNotEqual(r.get('consumir'), True)
        self.assertEqual(self.barras(c), 0)
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM pagamentos_play WHERE token = ?", token)[0]['n'], 0)

    def test_12_reembolso_tira_as_barras(self):
        m = self.novo('Zelador Play')
        self.sql("UPDATE contas SET gm = 1 WHERE id = ?", m.conta['id'])
        c = self.novo('Reembolso')
        self.assertEqual(c.pede('POST', '/api/mestre/pagamento/play/estornos', {})[0], 403, 'só o Mestre')
        cheio, gasto = self.g.compra('barras_280'), self.g.compra('barras_50')
        self.assertEqual(self.manda(c, 'barras-280', cheio)[0], 201)
        self.g.reembolsa(cheio)
        status, r = m.pede('POST', '/api/mestre/pagamento/play/estornos', {})
        self.assertEqual((status, r.get('estornados')), (200, 1), r)
        self.assertEqual(self.barras(c), 0)
        # de novo (ou o outro contêiner): não tira duas vezes
        outro = Cliente(self.base2)
        outro.token, outro.conta = m.token, m.conta
        self.assertEqual(outro.pede('POST', '/api/mestre/pagamento/play/estornos', {})[1].get('estornados'), 0)
        # o token reembolsado nunca mais credita
        status, r = self.manda(c, 'barras-280', cheio)
        self.assertEqual((status, r.get('estado')), (409, 'cancelada'), r)
        self.assertEqual(self.barras(c), 0)
        # barras já gastas: tira o que houver e alerta o Mestre do que faltou
        self.assertEqual(self.manda(c, 'barras-50', gasto)[0], 201)
        self.sql("UPDATE barras_saldo SET saldo = 20 WHERE conta_id = ?", c.conta['id'])
        self.g.reembolsa(gasto)
        self.assertEqual(m.pede('POST', '/api/mestre/pagamento/play/estornos', {})[1].get('estornados'), 1)
        self.assertEqual(self.barras(c), 0)
        alertas = [json.loads(a['dados']) for a in self.sql(
            "SELECT dados FROM contas_alertas WHERE conta_id = ? AND tipo = 'estorno' ORDER BY id", c.conta['id'])]
        self.assertEqual([(a['tirado'], a['faltou']) for a in alertas], [(280, 0), (20, 30)], alertas)
        mov = c.pede('GET', '/api/loja/minha')[1]['barras']['movimentos']
        self.assertEqual(sum(1 for x in mov if x['motivo'] == 'estorno-pagamento'), 2, mov)
        # reembolso de uma compra que o servidor nunca viu: fica a lápide e o token não credita depois
        nunca = self.g.compra('barras_600')
        self.g.reembolsa(nunca)
        self.g.muda(nunca, purchaseState=0)       # mesmo que a Google ainda a mostrasse como paga
        m.pede('POST', '/api/mestre/pagamento/play/estornos', {})
        self.assertEqual(self.manda(c, 'barras-600', nunca)[0], 409)
        self.assertEqual(self.barras(c), 0)

    def test_13_a_google_fora_nao_credita(self):
        c = self.novo('Sem Sinal')
        token = self.g.compra('barras_50')
        self.g.fora = 1
        status, r = self.manda(c, 'barras-50', token)
        self.assertEqual(status, 502, r)
        self.assertEqual(self.barras(c), 0)
        self.assertEqual(self.manda(c, 'barras-50', token)[0], 201, 'na volta da Google, credita')

    def test_14_sem_sessao_e_o_freio(self):
        self.assertEqual(Cliente(self.base).pede('POST', ROTA, {'pacote': 'barras-50', 'token': 'x' * 40})[0], 401)
        c = self.novo('Insistente')
        for _ in range(play_mod.CONFERE_POR_HORA):
            self.assertEqual(self.manda(c, 'barras-50', 'tok.nada-' + 'b' * 40)[0], 400)
        self.assertEqual(self.manda(c, 'barras-50', 'tok.nada-' + 'b' * 40)[0], 429)

    def test_15_a_conta_de_servico_e_o_log(self):
        self.assertGreaterEqual(self.g.pedidos_de_token, 1)
        self.assertEqual(self.g.jwt_ruim, 0, 'o JWT assinado aqui passou na conferência da chave pública')
        self.assertLessEqual(self.g.pedidos_de_token, 6, 'o token de acesso é guardado, não pedido a cada compra')
        for _, log in self.procs:
            log.flush()
        with open(self.log_arq, encoding='utf-8') as f:
            texto = f.read()
        self.assertIn('Google Play ligada', texto)
        self.assertNotIn('PRIVATE KEY', texto)
        self.assertNotIn('acesso-', texto)
        self.assertNotIn('tok.', texto)
        # as funções puras: a credencial torta desliga sem quebrar
        self.assertFalse(play_mod.GooglePlay('{"client_email": "x"}').ligado)
        self.assertFalse(play_mod.GooglePlay.do_ambiente({'SOTERRA_PLAY_CREDENCIAL': '/nao/existe.json'}).ligado)
        self.assertFalse(play_mod.GooglePlay.do_ambiente({}).ligado)
        self.assertNotIn('PRIVATE', repr(play_mod.GooglePlay(self.g.credencial())))


if __name__ == '__main__':
    unittest.main(verbosity=1)
