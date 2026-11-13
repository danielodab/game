#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova do anúncio premiado do aplicativo (servidor/anuncio.py), pela API de verdade.

    python tests/anuncio_api.py

Sobe servidor/api.py num subprocesso (banco descartável) com `--anuncio-chaves`
apontando para um arquivo com a chave PÚBLICA de um par ECDSA P-256 gerado aqui.
A prova faz o papel da Google: assina a consulta com a chave privada e chama
GET /api/anuncio/premio, como a verificação pelo servidor (SSV) do AdMob faz.

O que se prova: a assinatura válida credita (1 barra no extrato com a origem
'anuncio'; 50 vinténs a caminho, num pedido de preço 0); assinatura inválida,
consulta adulterada, chave desconhecida, bilhete de outra conta, bilhete
repetido, transaction_id repetido, bloco errado, bilhete vencido, conta banida
e a 6ª do dia NÃO creditam; o limite de um prêmio não gasta o do outro; o
reward_amount que vem no pedido não manda em nada; o dia vira e volta a 5; o
Mestre não recebe bilhete; sem sessão não há bilhete nem estado.

A UNITY ADS (13/11): o servidor sobe também com um Game ID e um segredo de prova, e a
prova faz o papel da Unity — assina o aviso com HMAC-MD5 (os parâmetros em ordem
alfabética, 'chave=valor' unidos por vírgula, como o exemplo oficial dela) e chama
GET /api/anuncio/unity?sid=…&oid=…&hmac=…. O hmac certo credita e a resposta é o
texto '1'; hmac errado, segredo errado, sid trocado e chave repetida dão 403; o mesmo
oid não credita duas vezes; o bilhete é o mesmo do AdMob (um bilhete, um anúncio);
o oid da Unity nunca colide com o transaction_id da Google. E a escolha da rede pelo
ambiente: a Unity quando configurada, o AdMob quando não, a pedida quando de pé.
"""
import base64
import hashlib
import hmac
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402  (põe servidor/ no sys.path)
import anuncio as an  # noqa: E402

from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402

KEY_ID = '1234567890'
UNIDADE = an.BLOCO_PADRAO.rsplit('/', 1)[-1]
UNITY_JOGO = '5550123'
UNITY_SEGREDO = 'segredo-de-prova-da-unity'


def hmac_unity(params, segredo=UNITY_SEGREDO):
    """A conta do exemplo oficial da Unity (PHP: ksort, "$k=$v" unidos por vírgula, hash_hmac md5)."""
    texto = ','.join('%s=%s' % (k, params[k]) for k in sorted(params) if k != 'hmac')
    return hmac.new(segredo.encode('utf-8'), texto.encode('utf-8'), hashlib.md5).hexdigest()


class ProvaDoAnuncio(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.mkdtemp(prefix='soterra-anuncio-')
        cls.porta = porta_livre()
        cls.base = 'http://127.0.0.1:%d' % cls.porta
        cls.banco_arq = os.path.join(cls.pasta, 'dados', 'soterra.db')
        cls.privada = ec.generate_private_key(ec.SECP256R1())
        cls.intrusa = ec.generate_private_key(ec.SECP256R1())       # um par que o servidor não conhece
        pem = cls.privada.public_key().public_bytes(serialization.Encoding.PEM,
                                                    serialization.PublicFormat.SubjectPublicKeyInfo).decode('ascii')
        chaves = os.path.join(cls.pasta, 'chaves.json')
        with open(chaves, 'w', encoding='utf-8') as f:
            json.dump({'keys': [{'keyId': int(KEY_ID), 'pem': pem}]}, f)
        cls.log = open(os.path.join(cls.pasta, 'api.log'), 'w', encoding='utf-8')
        env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
        env.update({'SOTERRA_UNITY_JOGO': UNITY_JOGO, 'SOTERRA_UNITY_SEGREDO': UNITY_SEGREDO})
        cls.proc = subprocess.Popen([sys.executable, API, '--porta', str(cls.porta), '--banco', cls.banco_arq,
                                     '--anuncio-chaves', chaves], stdout=cls.log, stderr=subprocess.STDOUT, env=env)
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
    def novo(self, apelido='Anuncio'):
        ProvaDoAnuncio._n += 1
        c = Cliente(self.base)
        status, r = c.cadastra('%s %d' % (apelido, ProvaDoAnuncio._n))
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

    def bilhete(self, c, tipo):
        status, r = c.pede('POST', '/api/anuncio/bilhete', {'tipo': tipo})
        self.assertEqual(status, 201, r)
        return r

    def consulta(self, bilhete, usuario, transacao=None, unidade=UNIDADE, chave=None, key_id=KEY_ID, quantia=1,
                 estraga=None):
        """A consulta que a Google manda: os parâmetros em ordem, a assinatura e o key_id no fim."""
        ProvaDoAnuncio._n += 1
        transacao = transacao or ('%032x' % (int(time.time() * 1000) * 1000 + ProvaDoAnuncio._n))
        mensagem = urllib.parse.urlencode([
            ('ad_network', '5450213213286189855'), ('ad_unit', unidade), ('custom_data', bilhete),
            ('reward_amount', str(quantia)), ('reward_item', 'premio'), ('timestamp', str(int(time.time() * 1000))),
            ('transaction_id', transacao), ('user_id', usuario)])
        assinatura = (chave or self.privada).sign(mensagem.encode('utf-8'), ec.ECDSA(hashes.SHA256()))
        if estraga:
            mensagem = estraga(mensagem)
        return '%s&signature=%s&key_id=%s' % (
            mensagem, base64.urlsafe_b64encode(assinatura).decode('ascii').rstrip('='), key_id), transacao

    def google(self, consulta):
        try:
            with urllib.request.urlopen(self.base + '/api/anuncio/premio?' + consulta, timeout=15) as r:
                return r.status, json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode('utf-8'))

    def assiste(self, c, tipo, **kw):
        b = self.bilhete(c, tipo)
        q, transacao = self.consulta(b['bilhete'], b['conta'], **kw)
        status, r = self.google(q)
        return status, r, b, q

    def unity(self, sid, oid=None, segredo=UNITY_SEGREDO, troca_sid=None, consulta=None, maiusculo=False):
        """O aviso que a Unity manda: sid e oid, e o hmac deles no fim. Devolve (status, texto, oid)."""
        ProvaDoAnuncio._n += 1
        oid = oid or ('oid%d%d' % (int(time.time() * 1000), ProvaDoAnuncio._n))
        assinatura = hmac_unity({'sid': sid, 'oid': oid}, segredo)
        if maiusculo:
            assinatura = assinatura.upper()
        q = consulta or urllib.parse.urlencode([('sid', troca_sid or sid), ('oid', oid), ('hmac', assinatura)])
        try:
            with urllib.request.urlopen(self.base + '/api/anuncio/unity?' + q, timeout=15) as r:
                self.assertTrue(r.headers.get('Content-Type', '').startswith('text/plain'), r.headers.get('Content-Type'))
                return r.status, r.read().decode('utf-8'), oid
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode('utf-8'), oid

    def premios_da_conta(self, c):
        return self.sql("SELECT transacao, tipo, chave FROM propaganda_premios WHERE conta_id = ? UNION ALL "
                        "SELECT transacao, tipo, chave FROM propaganda_premios_v2 WHERE conta_id = ?",
                        c.conta['id'], c.conta['id'])

    def estado(self, c):
        status, r = c.pede('GET', '/api/anuncio')
        self.assertEqual(status, 200, r)
        return {p['tipo']: p for p in r['premios']}, r

    def barras(self, c):
        status, r = c.pede('GET', '/api/loja/minha')
        self.assertEqual(status, 200, r)
        return r['barras'], r

    # -- as provas ------------------------------------------------------------------
    def test_estado_e_os_numeros_do_dono(self):
        c = self.novo()
        p, r = self.estado(c)
        self.assertEqual((an.ANUNCIO_VINTENS, an.ANUNCIO_BARRAS, an.ANUNCIO_MAX_DIA), (50, 1, 5))
        self.assertEqual(p['vintens'], {'tipo': 'vintens', 'qtd': 50, 'hoje': 0, 'limite': 5, 'faltam': 5})
        self.assertEqual(p['barras'], {'tipo': 'barras', 'qtd': 1, 'hoje': 0, 'limite': 5, 'faltam': 5})
        self.assertEqual(r['bloco'], an.BLOCO_PADRAO)
        # 13/11: com a Unity configurada, é ela a rede do aplicativo; o AdMob segue de pé para a casca antiga
        self.assertEqual(r['provedor'], 'unity')
        self.assertEqual(r['unity'], {'jogo': UNITY_JOGO, 'bloco': an.UNITY_BLOCO_PADRAO})
        b = self.bilhete(c, 'barras')
        self.assertEqual((b['provedor'], b['unity'], b['bloco']), ('unity', r['unity'], an.BLOCO_PADRAO))
        self.assertNotIn(UNITY_SEGREDO, json.dumps(r) + json.dumps(b))        # o segredo nunca sai do servidor
        self.assertTrue(0 < r['zeraEm'] - r['agora'] <= 86400)
        # a virada é a 00:00 de Brasília (03:00 UTC)
        self.assertEqual(r['zeraEm'] % 86400, 3 * 3600)

    def test_sem_sessao_nao_ha_estado_nem_bilhete(self):
        c = Cliente(self.base)
        self.assertEqual(c.pede('GET', '/api/anuncio')[0], 401)
        self.assertEqual(c.pede('POST', '/api/anuncio/bilhete', {'tipo': 'barras'})[0], 401)
        d = self.novo()
        self.assertEqual(d.pede('POST', '/api/anuncio/bilhete', {'tipo': 'ouro'})[0], 400)

    def test_assinatura_valida_credita_uma_barra_no_extrato(self):
        c = self.novo()
        status, r, b, q = self.assiste(c, 'barras', quantia=999)      # o reward_amount não manda em nada
        self.assertEqual((status, r.get('creditado')), (200, True), r)
        barras, _ = self.barras(c)
        self.assertEqual(barras['saldo'], 1)
        m = barras['movimentos'][0]
        self.assertEqual((m['delta'], m['motivo'], m['nome'], m['saldo']), (1, 'anuncio', 'Anúncio assistido', 1))
        p, _ = self.estado(c)
        self.assertEqual((p['barras']['hoje'], p['barras']['faltam'], p['vintens']['hoje']), (1, 4, 0))
        # a MESMA consulta de novo (a Google repetindo): 200 e nada a mais
        status, r = self.google(q)
        self.assertEqual((status, r.get('creditado'), r.get('motivo')), (200, False, 'repetido'), r)
        self.assertEqual(self.barras(c)[0]['saldo'], 1)

    def test_vintens_entram_pelo_pedido_de_preco_zero(self):
        c = self.novo()
        status, r, b, q = self.assiste(c, 'vintens')
        self.assertEqual((status, r.get('creditado')), (200, True), r)
        barras, minha = self.barras(c)
        self.assertEqual(barras['saldo'], 0)                          # vinténs não são barras
        self.assertEqual(minha['saldo']['aCaminho'], 50)
        ped = self.sql("SELECT p.sku, p.preco, p.estado, p.entrega, cr.vintens, cr.origem FROM loja_pedidos p "
                       "JOIN loja_creditos cr ON cr.pedido_id = p.id WHERE p.conta_id = ?", c.conta['id'])
        self.assertEqual(len(ped), 1)
        self.assertEqual((ped[0]['sku'], ped[0]['preco'], ped[0]['estado'], ped[0]['vintens']),
                         ('anuncio-vintens', 0, 'pendente', 50))
        self.assertEqual(json.loads(ped[0]['entrega']), {'tipo': 'vintens', 'alvo': 'carteira', 'qtd': 50})
        nomes = [x.get('nome') for x in minha.get('pedidos', [])]
        self.assertIn('50 vinténs (anúncio)', nomes, minha)
        p, _ = self.estado(c)
        self.assertEqual((p['vintens']['hoje'], p['barras']['hoje']), (1, 0))

    def test_o_que_nao_credita(self):
        c, outro = self.novo(), self.novo()
        b = self.bilhete(c, 'barras')
        bo = self.bilhete(outro, 'barras')
        casos = {
            'sem assinatura': ('ad_unit=%s&custom_data=%s&transaction_id=abcdef123456&user_id=%s'
                               % (UNIDADE, b['bilhete'], b['conta']), 403, None),
            'assinatura de outro par': (self.consulta(b['bilhete'], b['conta'], chave=self.intrusa)[0], 403, None),
            'chave desconhecida': (self.consulta(b['bilhete'], b['conta'], key_id='42')[0], 403, None),
            'consulta adulterada': (self.consulta(b['bilhete'], b['conta'], estraga=lambda m: m.replace(
                'custom_data=' + b['bilhete'], 'custom_data=' + bo['bilhete']))[0], 403, None),
            'assinatura lixo': ('ad_unit=%s&custom_data=%s&transaction_id=abcdef123456&user_id=%s&signature=AAAA'
                                '&key_id=%s' % (UNIDADE, b['bilhete'], b['conta'], KEY_ID), 403, None),
            'bloco errado': (self.consulta(b['bilhete'], b['conta'], unidade='5224354917')[0], 200, 'bloco'),
            'bilhete inventado': (self.consulta('x' * 32, b['conta'])[0], 200, 'bilhete'),
            'bilhete de outra conta': (self.consulta(bo['bilhete'], b['conta'])[0], 200, 'outra-conta'),
            'conta trocada': (self.consulta(b['bilhete'], bo['conta'])[0], 200, 'outra-conta'),
        }
        for nome, (q, status, motivo) in casos.items():
            s, r = self.google(q)
            self.assertEqual((s, r.get('motivo')), (status, motivo), '%s: %r' % (nome, r))
            self.assertFalse(r.get('creditado'), nome)
        for x in (c, outro):
            self.assertEqual(self.barras(x)[0]['saldo'], 0)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM propaganda_premios WHERE conta_id IN (?, ?)",
                                  c.conta['id'], outro.conta['id'])[0][0], 0)
        # e o bilhete, intacto depois de tudo isso, ainda vale UMA vez
        s, r = self.google(self.consulta(b['bilhete'], b['conta'])[0])
        self.assertTrue(r.get('creditado'), r)
        s, r = self.google(self.consulta(b['bilhete'], b['conta'])[0])       # outra transação, o mesmo bilhete
        self.assertEqual((s, r.get('creditado'), r.get('motivo')), (200, False, 'bilhete-usado'), r)
        self.assertEqual(self.barras(c)[0]['saldo'], 1)

    def test_transacao_repetida_com_outro_bilhete(self):
        c = self.novo()
        b1, b2 = self.bilhete(c, 'barras'), self.bilhete(c, 'barras')
        q1, transacao = self.consulta(b1['bilhete'], b1['conta'])
        self.assertTrue(self.google(q1)[1].get('creditado'))
        s, r = self.google(self.consulta(b2['bilhete'], b2['conta'], transacao=transacao)[0])
        self.assertEqual((r.get('creditado'), r.get('motivo')), (False, 'repetido'), r)
        self.assertEqual(self.barras(c)[0]['saldo'], 1)

    def test_bilhete_vencido_e_conta_banida(self):
        c = self.novo()
        b = self.bilhete(c, 'barras')
        self.sql("UPDATE propaganda_bilhetes SET criado_em = criado_em - ? WHERE bilhete = ?", an.BILHETE_VALE + 5,
                 b['bilhete'])
        s, r = self.google(self.consulta(b['bilhete'], b['conta'])[0])
        self.assertEqual((r.get('creditado'), r.get('motivo')), (False, 'bilhete-vencido'), r)
        b = self.bilhete(c, 'vintens')
        self.sql("UPDATE contas SET banido = 1 WHERE id = ?", c.conta['id'])
        s, r = self.google(self.consulta(b['bilhete'], b['conta'])[0])
        self.assertEqual((r.get('creditado'), r.get('motivo')), (False, 'conta'), r)
        self.sql("UPDATE contas SET banido = 0 WHERE id = ?", c.conta['id'])
        self.assertEqual(self.sql("SELECT COUNT(*) FROM propaganda_premios WHERE conta_id = ?", c.conta['id'])[0][0], 0)

    def test_o_mestre_nao_recebe_bilhete(self):
        m = self.novo('Chefia')
        self.sql("UPDATE contas SET gm = 1 WHERE id = ?", m.conta['id'])
        s, r = m.pede('POST', '/api/anuncio/bilhete', {'tipo': 'barras'})
        self.assertEqual((s, r.get('mestre')), (403, True), r)
        self.assertTrue(self.estado(m)[1]['mestre'])

    def test_limite_de_cada_premio_e_a_virada_do_dia(self):
        c = self.novo()
        for i in range(5):
            s, r, b, q = self.assiste(c, 'barras')
            self.assertTrue(r.get('creditado'), (i, r))
        # a 6ª: um bilhete pego ANTES de o limite fechar chega depois dele — e não credita
        s, r = c.pede('POST', '/api/anuncio/bilhete', {'tipo': 'barras'})
        self.assertEqual((s, r.get('limite')), (409, True), r)
        self.assertTrue(r['zeraEm'] > time.time())
        t = int(time.time())
        self.sql("INSERT INTO propaganda_bilhetes(bilhete, conta_id, tipo, criado_em) VALUES (?, ?, 'barras', ?)",
                 'b' * 32, c.conta['id'], t)
        bv = self.bilhete(c, 'vintens')          # o código da conta vem num bilhete do OUTRO prêmio
        s, r = self.google(self.consulta('b' * 32, bv['conta'])[0])
        self.assertEqual((s, r.get('creditado'), r.get('motivo')), (200, False, 'limite'), r)
        self.assertEqual(self.barras(c)[0]['saldo'], 5)
        # o limite das barras NÃO gasta o dos vinténs: os 5 de vinténs entram
        s, r = self.google(self.consulta(bv['bilhete'], bv['conta'])[0])
        self.assertTrue(r.get('creditado'), r)
        for i in range(4):
            self.assertTrue(self.assiste(c, 'vintens')[1].get('creditado'), i)
        p, _ = self.estado(c)
        self.assertEqual((p['barras']['hoje'], p['barras']['faltam'], p['vintens']['hoje'], p['vintens']['faltam']),
                         (5, 0, 5, 0))
        self.assertEqual(c.pede('POST', '/api/anuncio/bilhete', {'tipo': 'vintens'})[0], 409)
        self.assertEqual(self.barras(c)[1]['saldo']['aCaminho'], 250)
        # o dia vira (os prêmios de hoje passam a ser de ontem): volta a 5 de cada
        self.sql("UPDATE propaganda_premios SET dia = dia - 1 WHERE conta_id = ?", c.conta['id'])
        p, _ = self.estado(c)
        self.assertEqual((p['barras']['faltam'], p['vintens']['faltam']), (5, 5))
        self.assertTrue(self.assiste(c, 'barras')[1].get('creditado'))
        self.assertEqual(self.barras(c)[0]['saldo'], 6)

    # -- a Unity Ads (13/11) -------------------------------------------------------------
    def test_unity_hmac_certo_credita_e_responde_1(self):
        c = self.novo()
        b = self.bilhete(c, 'barras')
        status, texto, oid = self.unity(b['bilhete'])
        self.assertEqual((status, texto), (200, '1'))
        self.assertEqual(self.barras(c)[0]['saldo'], 1)
        m = self.barras(c)[0]['movimentos'][0]
        self.assertEqual((m['delta'], m['motivo']), (1, 'anuncio'))
        self.assertEqual([tuple(x) for x in self.premios_da_conta(c)], [('unity:' + oid, 'barras', 'unity')])
        p, _ = self.estado(c)
        self.assertEqual((p['barras']['hoje'], p['barras']['faltam']), (1, 4))
        # a Unity repetindo o MESMO aviso: '1' de novo e nada a mais
        self.assertEqual(self.unity(b['bilhete'], oid=oid)[:2], (200, '1'))
        # o mesmo bilhete num aviso NOVO: um bilhete, um anúncio
        self.assertEqual(self.unity(b['bilhete'])[:2], (200, '1'))
        self.assertEqual(self.barras(c)[0]['saldo'], 1)
        self.assertEqual(len(self.premios_da_conta(c)), 1)
        # o hmac em maiúsculas também vale (é o mesmo número em hexadecimal)
        b2 = self.bilhete(c, 'barras')
        self.assertEqual(self.unity(b2['bilhete'], maiusculo=True)[:2], (200, '1'))
        self.assertEqual(self.barras(c)[0]['saldo'], 2)

    def test_unity_vintens_e_fragmentos(self):
        c = self.novo()
        self.assertEqual(self.unity(self.bilhete(c, 'vintens')['bilhete'])[:2], (200, '1'))
        self.assertEqual(self.unity(self.bilhete(c, 'fragmentos')['bilhete'])[:2], (200, '1'))
        _, minha = self.barras(c)
        self.assertEqual(minha['saldo']['aCaminho'], 50)
        ped = self.sql("SELECT sku, entrega FROM loja_pedidos WHERE conta_id = ? ORDER BY id", c.conta['id'])
        self.assertEqual([x['sku'] for x in ped], ['anuncio-vintens', 'anuncio-fragmentos'])
        self.assertEqual(json.loads(ped[1]['entrega']), {'tipo': 'pedras', 'alvo': an.FRAGMENTO_ID, 'qtd': 3})
        p, _ = self.estado(c)
        self.assertEqual((p['vintens']['hoje'], p['fragmentos']['hoje'], p['barras']['hoje']), (1, 1, 0))

    def test_unity_o_que_nao_credita(self):
        c, outro = self.novo(), self.novo()
        b, bo = self.bilhete(c, 'barras'), self.bilhete(outro, 'barras')
        sid = b['bilhete']
        h = hmac_unity({'sid': sid, 'oid': 'abc123'})
        casos = {
            'sem hmac': ('sid=%s&oid=abc123' % sid, 403),
            'sem nada': ('', 403),
            'hmac lixo': ('sid=%s&oid=abc123&hmac=%s' % (sid, '0' * 32), 403),
            'chave repetida': ('sid=%s&sid=%s&oid=abc123&hmac=%s' % (sid, bo['bilhete'], h), 403),
            'hmac repetido': ('sid=%s&oid=abc123&hmac=%s&hmac=%s' % (sid, h, h), 403),
            'campo a mais fora da conta': ('sid=%s&oid=abc123&extra=1&hmac=%s' % (sid, h), 403),
        }
        for nome, (q, esperado) in casos.items():
            s, texto, _ = self.unity(sid, consulta=q or 'x=')
            self.assertEqual(s, esperado, '%s: %s' % (nome, texto))
        self.assertEqual(self.unity(sid, segredo='outro-segredo')[0], 403)                  # segredo errado
        self.assertEqual(self.unity(sid, troca_sid=bo['bilhete'])[0], 403)                  # sid trocado depois de assinar
        # assinados, mas sem bilhete que preste: '1' (a Unity para de repetir) e nada creditado
        self.assertEqual(self.unity('x' * 32)[:2], (200, '1'))
        self.assertEqual(self.unity('curto')[:2], (200, '1'))
        for x in (c, outro):
            self.assertEqual(self.barras(x)[0]['saldo'], 0)
            self.assertEqual(len(self.premios_da_conta(x)), 0)
        # um campo a mais, se a Unity o mandar ASSINADO, entra na conta e vale
        q = urllib.parse.urlencode([('sid', sid), ('oid', 'comextra1'), ('productid', 'x'),
                                    ('hmac', hmac_unity({'sid': sid, 'oid': 'comextra1', 'productid': 'x'}))])
        self.assertEqual(self.unity(sid, consulta=q)[:2], (200, '1'))
        self.assertEqual(self.barras(c)[0]['saldo'], 1)

    def test_unity_e_google_nao_se_misturam(self):
        """O oid da Unity e o transaction_id da Google moram na mesma coluna UNIQUE: o prefixo os separa."""
        c = self.novo()
        b1 = self.bilhete(c, 'barras')
        q, transacao = self.consulta(b1['bilhete'], b1['conta'], transacao='mesmonumero123')
        self.assertTrue(self.google(q)[1].get('creditado'))
        b2 = self.bilhete(c, 'barras')
        self.assertEqual(self.unity(b2['bilhete'], oid='mesmonumero123')[:2], (200, '1'))
        self.assertEqual(self.barras(c)[0]['saldo'], 2)
        # e o bilhete gasto pela Unity não credita de novo pela Google
        q, _ = self.consulta(b2['bilhete'], b2['conta'])
        self.assertEqual(self.google(q)[1].get('motivo'), 'bilhete-usado')
        self.assertEqual(self.barras(c)[0]['saldo'], 2)

    def test_unity_limite_e_conta_banida(self):
        c = self.novo()
        for i in range(5):
            self.assertEqual(self.unity(self.bilhete(c, 'vintens')['bilhete'])[:2], (200, '1'), i)
        t = int(time.time())
        self.sql("INSERT INTO propaganda_bilhetes(bilhete, conta_id, tipo, criado_em) VALUES (?, ?, 'vintens', ?)",
                 'u' * 32, c.conta['id'], t)
        self.assertEqual(self.unity('u' * 32)[:2], (200, '1'))
        self.assertEqual(self.estado(c)[0]['vintens']['hoje'], 5)
        b = self.bilhete(c, 'barras')
        self.sql("UPDATE contas SET banido = 1 WHERE id = ?", c.conta['id'])
        self.assertEqual(self.unity(b['bilhete'])[:2], (200, '1'))
        self.sql("UPDATE contas SET banido = 0 WHERE id = ?", c.conta['id'])
        self.assertEqual(self.barras(c)[0]['saldo'], 0)


class EscolhaDaRede(unittest.TestCase):
    """A rede do aplicativo sai do ambiente (Anuncios.do_ambiente), sem subir servidor."""

    def rede(self, **env):
        a = an.Anuncios.do_ambiente(dict(('SOTERRA_' + k, v) for k, v in env.items()))
        return a.provedor, a.admob, a.unity, a.ligado

    def test_a_escolha(self):
        u = {'UNITY_JOGO': UNITY_JOGO, 'UNITY_SEGREDO': UNITY_SEGREDO}
        self.assertEqual(self.rede(), ('admob', True, False, True))                 # como era antes
        self.assertEqual(self.rede(**u), ('unity', True, True, True))               # configurada: a Unity
        self.assertEqual(self.rede(ANUNCIO_PROVEDOR='admob', **u), ('admob', True, True, True))   # o dono volta
        self.assertEqual(self.rede(ANUNCIO_PROVEDOR='Unity', **u), ('unity', True, True, True))
        self.assertEqual(self.rede(ANUNCIO_PROVEDOR='unity'), ('admob', True, False, True))       # pedida, não de pé
        self.assertEqual(self.rede(UNITY_JOGO=UNITY_JOGO), ('admob', True, False, True))          # sem segredo
        self.assertEqual(self.rede(UNITY_JOGO='meu-jogo', UNITY_SEGREDO='x'), ('admob', True, False, True))
        self.assertEqual(self.rede(ANUNCIOS='0', **u), (None, False, False, False))
        a = an.Anuncios(bloco='', unity_jogo=UNITY_JOGO, unity_segredo=UNITY_SEGREDO)
        self.assertEqual((a.provedor, a.admob, a.unity), ('unity', False, True))
        a = an.Anuncios.do_ambiente({'SOTERRA_UNITY_JOGO': UNITY_JOGO, 'SOTERRA_UNITY_SEGREDO': 'segredo-que-nao-aparece',
                                     'SOTERRA_UNITY_BLOCO': 'Premiado_Android'})
        self.assertEqual((a.unity_bloco, a.provedor), ('Premiado_Android', 'unity'))
        self.assertIn('Unity: jogo %s' % UNITY_JOGO, a.descricao())
        self.assertNotIn('segredo-que-nao-aparece', a.descricao())            # a linha do log não leva o segredo

    def test_conferencia_da_unity(self):
        a = an.Anuncios(unity_jogo=UNITY_JOGO, unity_segredo=UNITY_SEGREDO)
        h = hmac_unity({'oid': '1', 'sid': 'b'})
        self.assertEqual(a.confere_unity('sid=b&oid=1&hmac=' + h), {'sid': 'b', 'oid': '1'})
        self.assertEqual(a.confere_unity('oid=1&hmac=%s&sid=b' % h), {'sid': 'b', 'oid': '1'})   # a ordem da URL não importa
        self.assertIsNone(a.confere_unity('sid=b&oid=2&hmac=' + h))
        self.assertIsNone(a.confere_unity('sid=b&oid=1&hmac=' + h + '&hmac=' + h))
        self.assertIsNone(a.confere_unity('sid=b&oid=1&hmac=' + 'é' * 32))
        self.assertIsNone(a.confere_unity(None))
        self.assertIsNone(a.confere_unity('x' * (an.CONSULTA_MAX + 1)))
        # o valor decodificado entra na conta (como o $_GET do PHP e o req.query do Node)
        h = hmac_unity({'oid': '1', 'sid': 'a b/c'})
        self.assertEqual(a.confere_unity('sid=a+b%2Fc&oid=1&hmac=' + h)['sid'], 'a b/c')
        self.assertIsNone(an.Anuncios(unity_jogo=UNITY_JOGO).confere_unity('sid=b&oid=1&hmac=' + h))


if __name__ == '__main__':
    unittest.main(verbosity=1)
