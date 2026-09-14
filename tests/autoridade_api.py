#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova da AUTORIDADE (servidor/salas.py e as rotas que ela muda), com o JUIZ de verdade.

    python tests/autoridade_api.py

Sobe o juiz em Node (servidor/juiz/juiz.js) e a API com --juiz, cada um numa porta
livre, com um banco descartável numa pasta temporária, e fala com eles por HTTP
como o jogo falaria. As salas são jogadas DE VERDADE por tests/juiz_jogador.js (a
IA do jogo decide os lances do herói, cada lance anotado no formato do cliente).

O que se prova (docs/SEGURANCA.md §4):
  - o bilhete: calabouço, sala, dificuldade e heróis conferidos; um aberto por conta;
    o teto por hora;
  - o fechamento: a vitória paga NO ESTADO DO SERVIDOR (versão +1, séries novas no
    registro com a origem do juiz, carteira, sala 'paga', o PV que atravessa), o
    lance adulterado é recusado sem mexer no estado, a sala rápida demais também, a
    sala largada fica 'perdida', o bilhete fechado não fecha de novo e o de outra
    conta não é achado;
  - o PUT cosmético: o progress e a economia do corpo não entram, o cosmético sim,
    sem 409 por versão;
  - o POST /api/op: forma, ops internas, hash desatualizado (409 com o estado);
  - o juiz fora do ar: 503 e nada gravado (e o bilhete continua fechável depois).
As provas das OPS no juiz (op de verdade, a loja, a troca e o banco da guilda
entregues no servidor) se pulam sozinhas enquanto o juiz não tiver POST /op.

As réguas de tempo são afrouxadas pelo ambiente na API principal
(SOTERRA_SALA_MIN_S=0, SOTERRA_SALA_S_POR_TURNO=0); uma segunda API no MESMO banco
sobe com as réguas de verdade e o teto de 3 salas por hora. Os processos rodam com
prioridade abaixo do normal: a máquina é dividida com quem joga.
"""
import copy
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
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, '..'))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402  (põe servidor/ no sys.path)

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

JUIZ = os.path.join(RAIZ, 'servidor', 'juiz', 'juiz.js')
JOGADOR = os.path.join(AQUI, 'juiz_jogador.js')
ESTADO_JS = os.path.join(RAIZ, 'servidor', 'juiz', 'estado.js').replace('\\', '/')
BAIXA = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)     # só existe no Windows; no Linux é 0
PECA = 'gh-wasp-sting'            # uma peça que existe nos dados do jogo (items_extra.js)
SEMENTE_QUE_VENCE = 11            # a Cisterna, sala 0, com o Bárbaro no nível 22: a IA vence


def acha_node():
    for c in (shutil.which('node'), r'C:\Program Files\nodejs\node.exe'):
        if c and os.path.exists(c):
            return c
    return None


NODE = acha_node()


def roda_node(args, entrada=None, tempo=120):
    r = subprocess.run([NODE] + args, input=json.dumps(entrada).encode('utf-8') if entrada is not None else None,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=tempo, creationflags=BAIXA)
    if r.returncode != 0:
        raise RuntimeError('node falhou: ' + r.stderr.decode('utf-8', 'replace')[-2000:])
    return json.loads(r.stdout.decode('utf-8'))


def espera_url(url, proc, segundos=60):
    limite = time.time() + segundos
    while time.time() < limite:
        if proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.2)
    return False


def status_de(url, corpo):
    req = urllib.request.Request(url, data=json.dumps(corpo).encode('utf-8'), method='POST',
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


class ProvaDaAutoridade(unittest.TestCase):
    _n = 0
    procs = []

    @classmethod
    def setUpClass(cls):
        if NODE is None:
            raise unittest.SkipTest('sem node nesta máquina: o juiz não sobe')
        cls.pasta = tempfile.mkdtemp(prefix='soterra-autoridade-')
        cls.banco_arq = os.path.join(cls.pasta, 'dados', 'soterra.db')
        cls.logs = []
        cls.procs = []
        try:
            cls._sobe()
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
    def _sobe(cls):
        porta_juiz = porta_livre()
        cls.juiz = 'http://127.0.0.1:%d' % porta_juiz
        pj = cls._processo('juiz', [NODE, JUIZ, '--porta', str(porta_juiz)])
        if not espera_url(cls.juiz + '/saude', pj):
            raise RuntimeError('o juiz não subiu; veja ' + cls.pasta)
        # o estado de partida: o de uma conta nova do jogo (o primeiro PUT do cliente)
        codigo = ("const est = require(process.argv[1]); const w = est.mundoEconomico({}); est.poeEstado(w, null, null);"
                  "const s = est.tiraEstado(w);"
                  "process.stdout.write(JSON.stringify({progress: s.progress, db: s.db, xp: w.J.DATA.leveling.xpTable}));")
        cls.inicial = roda_node(['-e', codigo, ESTADO_JS])
        base_env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
        solto = dict(base_env, SOTERRA_SALA_MIN_S='0', SOTERRA_SALA_S_POR_TURNO='0')
        rigoroso = dict(base_env, SOTERRA_SALAS_POR_HORA='3')
        cls.base = cls._api('api', solto, cls.juiz)
        cls.base_rigorosa = cls._api('api-rigorosa', rigoroso, cls.juiz)
        cls.base_sem_juiz = cls._api('api-juiz-caido', solto, 'http://127.0.0.1:%d' % porta_livre())
        cls.tem_op = status_de(cls.juiz + '/op', {}) != 404

    @classmethod
    def _api(cls, nome, env, juiz):
        porta = porta_livre()
        p = cls._processo(nome, [sys.executable, API, '--porta', str(porta), '--banco', cls.banco_arq,
                                 '--juiz', juiz], env)
        base = 'http://127.0.0.1:%d' % porta
        if not espera_api(base, p, 30):
            raise RuntimeError('a API %s não subiu; veja %s' % (nome, cls.pasta))
        return base

    @classmethod
    def tearDownClass(cls):
        for p in cls.procs:                     # só os processos que esta prova subiu
            if p.poll() is None:
                p.terminate()
                try:
                    p.wait(5)
                except subprocess.TimeoutExpired:
                    p.kill()
        for log in getattr(cls, 'logs', []):
            log.close()
        shutil.rmtree(getattr(cls, 'pasta', ''), ignore_errors=True)

    # -- ajudantes ------------------------------------------------------------------------
    def novo(self, apelido, base=None):
        ProvaDaAutoridade._n += 1
        c = Cliente(base or self.base)
        status, r = c.cadastra('%s %d' % (apelido, ProvaDaAutoridade._n))
        self.assertEqual(status, 201, r)
        return c

    def em(self, c, base):
        """O mesmo jogador falando com outra API (o mesmo banco)."""
        outro = Cliente(base)
        outro.token, outro.conta = c.token, c.conta
        return outro

    def serie(self, prefixo):
        ProvaDaAutoridade._n += 1
        return 'j%s%d' % (prefixo, ProvaDaAutoridade._n)

    def sql(self, consulta, *args):
        b = sqlite3.connect(self.banco_arq)
        b.row_factory = sqlite3.Row
        try:
            linhas = [dict(r) for r in b.execute(consulta, args).fetchall()]
            b.commit()
            return linhas
        finally:
            b.close()

    def estado_de_partida(self, nivel=22, carteira=0, pecas=()):
        p = copy.deepcopy(self.inicial['progress'])
        d = copy.deepcopy(self.inicial['db'])
        p['heroes']['sumo']['level'] = nivel
        p['heroes']['sumo']['xp'] = self.inicial['xp'][nivel - 1]
        for iid in pecas:
            p['inventory'].append({'itemId': PECA, 'level': 0, 'stars': 0, 'iid': iid})
        d['carteira'] = {'moedas': carteira}
        return p, d

    def poe_estado(self, c, progress=None, db=None, pecas=()):
        """O primeiro PUT da conta: aceito inteiro, vira o estado do servidor."""
        if progress is None:
            progress, db = self.estado_de_partida(pecas=pecas)
        nasc = [{'iid': i, 'itemId': PECA, 'origem': 'saque'} for i in pecas]
        status, r = c.salva(0, progress, db, nasc)
        self.assertEqual(status, 200, r)
        self.assertEqual(r['versao'], 1)
        return r

    def save(self, c):
        status, r = c.pede('GET', '/api/save')
        self.assertEqual(status, 200, r)
        return r

    def abre(self, c, sala=0, semente=SEMENTE_QUE_VENCE, **kw):
        corpo = {'dungeonId': 'cistern', 'roomIndex': sala, 'dificuldade': 'normal', 'herois': ['sumo']}
        corpo.update(kw)
        status, r = c.pede('POST', '/api/sala/abrir', corpo)
        self.assertEqual(status, 200, r)
        if semente is not None:
            # a semente do servidor é sorteada; a prova fixa uma que a IA vence (só no banco da prova)
            self.sql("UPDATE salas SET semente = ? WHERE bilhete = ?", semente, r['bilhete'])
            r['semente'] = semente
        return r

    def joga(self, c, bilhete, sala=0, corta=None):
        s = self.save(c)
        linha = self.sql("SELECT * FROM salas WHERE bilhete = ?", bilhete)[0]
        pedido = {'progress': s['progress'], 'db': s['db'], 'dungeonId': linha['dungeon'], 'roomIndex': linha['sala'],
                  'semente': linha['semente'], 'dificuldade': linha['dificuldade'],
                  'herois': json.loads(linha['herois']),
                  'carry': json.loads(linha['carry']) if linha['carry'] else None}
        if corta is not None:
            pedido['cortaEm'] = corta
        return roda_node([JOGADOR], pedido)

    def fecha(self, c, bilhete, jogo):
        return c.pede('POST', '/api/sala/fechar', {'bilhete': bilhete, 'lances': jogo['lances'],
                                                   'hashFinal': jogo['hash']})

    def sala(self, bilhete):
        return self.sql("SELECT * FROM salas WHERE bilhete = ?", bilhete)[0]

    def eventos(self, c, tipo):
        return self.sql("SELECT dados FROM eventos WHERE conta_id = ? AND tipo = ?", c.conta['id'], tipo)

    def precisa_op(self):
        if not self.tem_op:
            self.skipTest('o juiz ainda não tem POST /op (servidor/juiz/economia.js): esta prova liga sozinha quando tiver')

    # -- o bilhete ---------------------------------------------------------------------------
    def test_01_abrir_confere_tudo(self):
        c = self.novo('Bilhete')
        status, r = c.pede('POST', '/api/sala/abrir', {'dungeonId': 'cistern', 'roomIndex': 0, 'herois': ['sumo']})
        self.assertEqual(status, 409, 'sem estado no servidor não há bilhete: %r' % r)
        p, d = self.estado_de_partida()
        p['heroes']['bruxo'] = {'classId': 'bruxo', 'level': 1, 'xp': 0}       # a ficha existe, a classe não foi liberada
        self.poe_estado(c, p, d)
        base = {'dungeonId': 'cistern', 'roomIndex': 0, 'dificuldade': 'normal', 'herois': ['sumo']}
        tortos = [({'dungeonId': 'calabouco-que-nao-ha'}, 400), ({'roomIndex': 3}, 400), ({'roomIndex': -1}, 400),
                  ({'roomIndex': True}, 400), ({'dificuldade': 'insano'}, 400), ({'herois': []}, 400),
                  ({'herois': ['sumo', 'sumo']}, 400), ({'herois': ['ninguem']}, 400), ({'herois': ['bruxo']}, 400),
                  ({'herois': ['sumo', 'curandeiro', 'bruxo']}, 400), ({'dungeonId': 7}, 400)]
        for mexe, esperado in tortos:
            status, r = c.pede('POST', '/api/sala/abrir', dict(base, **mexe))
            self.assertEqual(status, esperado, (mexe, r))
        r1 = self.abre(c, semente=None)
        self.assertTrue(isinstance(r1['semente'], int) and 0 <= r1['semente'] < 2 ** 31, r1)
        self.assertIsNone(r1['carry'])
        self.assertEqual(self.sala(r1['bilhete'])['estado'], 'aberta')
        r2 = self.abre(c, semente=None, herois=['sumo', 'curandeiro'], dificuldade='dificil')
        self.assertNotEqual(r1['bilhete'], r2['bilhete'])
        self.assertEqual(self.sala(r1['bilhete'])['estado'], 'vencida', 'um bilhete aberto por conta')
        self.assertEqual(self.sala(r2['bilhete'])['estado'], 'aberta')
        status, r = c.pede('POST', '/api/sala/fechar', {'bilhete': r1['bilhete'], 'lances': []})
        self.assertEqual(status, 410, r)
        self.assertEqual(c.pede('POST', '/api/sala/fechar', {'bilhete': 'x', 'lances': []})[0], 400)
        self.assertEqual(c.pede('POST', '/api/sala/fechar', {'bilhete': 'A' * 24, 'lances': []})[0], 404)
        self.assertEqual(c.pede('POST', '/api/sala/fechar', {'bilhete': r2['bilhete'], 'lances': 'nada'})[0], 400)
        self.assertEqual(Cliente(self.base).pede('POST', '/api/sala/abrir', base)[0], 401)

    def test_02_teto_de_salas_por_hora(self):
        c = self.novo('Apressado', self.base_rigorosa)
        self.poe_estado(c)
        for _ in range(3):
            self.abre(c, semente=None)
        status, r = c.pede('POST', '/api/sala/abrir', {'dungeonId': 'cistern', 'roomIndex': 0, 'herois': ['sumo']})
        self.assertEqual(status, 429, r)
        self.assertGreater(r['liberaEm'], time.time())

    # -- o fechamento -------------------------------------------------------------------------
    def test_03_vitoria_paga_no_estado_do_servidor(self):
        c = self.novo('Vencedor')
        self.poe_estado(c)
        antes = self.save(c)
        b = self.abre(c)
        jogo = self.joga(c, b['bilhete'])
        self.assertEqual(jogo['fase'], 'won', 'a sala da prova precisa ser vencida pela IA')
        status, r = self.fecha(c, b['bilhete'], jogo)
        self.assertEqual(status, 200, r)
        self.assertEqual(r['fase'], 'won')
        self.assertIsInstance(r['recompensa'], dict)
        self.assertEqual(r['versao'], 2)
        self.assertIsInstance(r['hash'], str)
        self.assertIsInstance(r['carry'], dict)
        depois = self.save(c)
        self.assertEqual(depois['versao'], 2)
        self.assertEqual((depois['progress'], depois['db'], depois['hash']), (r['progress'], r['db'], r['hash']))
        self.assertGreater(depois['progress']['heroes']['sumo']['xp'], antes['progress']['heroes']['sumo']['xp'])
        self.assertGreater(depois['db']['carteira']['moedas'], antes['db']['carteira']['moedas'],
                           'os vinténs da sala entram na carteira do SERVIDOR')
        novos = [e['iid'] for e in depois['progress']['inventory'] if isinstance(e, dict) and e.get('iid')]
        for iid in novos:
            linha = self.sql("SELECT conta_id, origem, estado FROM itens WHERE iid = ?", iid)
            self.assertEqual(linha, [{'conta_id': c.conta['id'], 'origem': 'saque', 'estado': 'vivo'}], iid)
        self.assertEqual(len(self.sql("SELECT iid FROM itens WHERE conta_id = ?", c.conta['id'])), len(novos))
        s = self.sala(b['bilhete'])
        self.assertEqual(s['estado'], 'paga')
        self.assertEqual(s['turnos'], sum(1 for l in jogo['lances'] if l['a'] == 'e'))
        self.assertEqual(json.loads(s['carry_saida']), r['carry'])
        self.assertEqual(self.sql("SELECT hash FROM autoridade WHERE conta_id = ?", c.conta['id'])[0]['hash'], r['hash'])
        self.assertEqual(len(self.eventos(c, 'sala-paga')), 1)
        # o bilhete pago não paga de novo
        status, r2 = self.fecha(c, b['bilhete'], jogo)
        self.assertEqual(status, 409, r2)
        self.assertEqual(self.save(c)['versao'], 2)
        # a sala seguinte da descida leva o PV que o servidor anotou — 13/09: mais a vida que voltou na
        # sala de espera (1 PV a cada 2 s; a prova da regeneração com o relógio é tests/pocoes_api.py)
        b2 = self.abre(c, sala=1, semente=None)
        self.assertEqual(set(b2['carry']), set(r['carry']))
        for chave, hp in r['carry'].items():
            self.assertGreaterEqual(b2['carry'][chave], hp, chave)

    def test_04_dizimo_chega_pela_sala(self):
        c = self.novo('Dizimista')
        status, g = c.pede('POST', '/api/guilda/criar', {'nome': 'Dizimo %d' % ProvaDaAutoridade._n})
        self.assertEqual(status, 200, g)
        self.assertEqual(c.pede('POST', '/api/guilda/dizimo', {'pct': 25})[0], 200)
        status, r = c.pede('POST', '/api/guilda/doar', {'xp': 100})
        self.assertEqual((status, r.get('erro')), (403, 'o dízimo é creditado pelo servidor ao fechar a sala'))
        self.poe_estado(c)
        # a Cisterna rende pouco XP a um herói de nível 22 (o rendimento decrescente do jogo), e 25% de
        # quase nada arredonda a zero: um evento de XP ×10 na Cisterna garante o dízimo — e prova que
        # os fatores da agenda chegam ao juiz pelo servidor
        t = int(time.time())
        ev = self.sql("INSERT INTO agenda_eventos(tipo, multiplicador, calabouco, titulo, texto, inicio, fim, criado_em) "
                      "VALUES ('xp', 10, 'cistern', 'Prova do dízimo', '', ?, ?, ?) RETURNING id", t - 60, t + 3600, t)
        try:
            b = self.abre(c)
            status, r = self.fecha(c, b['bilhete'], self.joga(c, b['bilhete']))
        finally:
            self.sql("UPDATE agenda_eventos SET cancelado_em = ? WHERE id = ?", t, ev[0]['id'])
        self.assertEqual(status, 200, r)
        doado = (r['recompensa'].get('dizimo') or {}).get('doado', 0)
        self.assertGreater(doado, 0, 'com ×10 o dízimo de 25%% não arredonda a zero: %r' % r['recompensa'].get('dizimo'))
        xp = self.sql("SELECT xp FROM guildas WHERE id = ?", g['guilda']['id'])[0]['xp']
        self.assertEqual(xp, doado, 'o XP do dízimo que o juiz anotou entra na guilda do servidor')
        dados = json.loads(self.eventos(c, 'sala-paga')[0]['dados'])
        self.assertEqual(dados['guildaXp'], xp)

    def test_05_lance_adulterado_recusa_sem_mexer_no_estado(self):
        c = self.novo('Trapaceiro')
        self.poe_estado(c)
        antes = self.save(c)
        b = self.abre(c)
        jogo = self.joga(c, b['bilhete'])
        torto = copy.deepcopy(jogo)
        torto['lances'][0]['ok'] = not torto['lances'][0]['ok']          # a colocação "deu diferente"
        status, r = self.fecha(c, b['bilhete'], torto)
        self.assertEqual(status, 422, r)
        self.assertEqual(r['motivo'], 'divergiu')
        self.assertEqual(self.sala(b['bilhete'])['estado'], 'recusada')
        self.assertEqual(self.save(c), antes, 'nada muda no estado')
        self.assertEqual(json.loads(self.eventos(c, 'sala-recusada')[0]['dados'])['motivo'], 'divergiu')
        status, r = self.fecha(c, b['bilhete'], jogo)                    # e o bilhete queimado não fecha de novo
        self.assertEqual(status, 409, r)
        self.assertEqual(self.save(c), antes)

    def test_06_rapido_demais(self):
        c = self.novo('Relampago', self.base_rigorosa)
        self.poe_estado(c)
        antes = self.save(c)
        b = self.abre(c)
        jogo = self.joga(c, b['bilhete'])
        status, r = self.fecha(c, b['bilhete'], jogo)                    # a régua de verdade: 4 s no mínimo
        self.assertEqual(status, 422, r)
        self.assertEqual(r['motivo'], 'rapido-demais')
        self.assertEqual(self.sala(b['bilhete'])['estado'], 'recusada')
        self.assertEqual(self.save(c), antes)

    def test_07_sala_largada_fica_perdida(self):
        c = self.novo('Desistente')
        self.poe_estado(c)
        antes = self.save(c)
        b = self.abre(c)
        jogo = self.joga(c, b['bilhete'], corta=3)
        self.assertEqual(jogo['fase'], 'playing')
        status, r = self.fecha(c, b['bilhete'], jogo)
        self.assertEqual(status, 200, r)
        self.assertEqual((r['fase'], r['recompensa'], r['versao']), ('playing', None, 1))
        self.assertEqual(self.sala(b['bilhete'])['estado'], 'perdida')
        self.assertEqual(self.save(c), antes)

    def test_08_bilhete_de_outra_conta(self):
        a, b = self.novo('Primeira Conta'), self.novo('Intrusa')
        self.poe_estado(a)
        self.poe_estado(b)
        bil = self.abre(a)
        jogo = self.joga(a, bil['bilhete'])
        status, r = self.fecha(b, bil['bilhete'], jogo)
        self.assertEqual(status, 404, r)
        self.assertEqual(self.sala(bil['bilhete'])['estado'], 'aberta')
        self.assertEqual(self.save(b)['versao'], 1)

    # -- o PUT cosmético ----------------------------------------------------------------------
    def test_09_put_so_grava_o_cosmetico(self):
        c = self.novo('Cosmetico')
        p, d = self.estado_de_partida(carteira=10)
        self.poe_estado(c, p, d)
        guardado = self.save(c)
        self.assertEqual(guardado['progress'], p, 'o primeiro PUT é aceito inteiro')
        pf, df = copy.deepcopy(p), copy.deepcopy(d)
        pf['heroes']['sumo']['level'] = 30
        pf['inventory'].append({'itemId': PECA, 'level': 9, 'stars': 5, 'iid': 'jforjado1'})
        df['carteira'] = {'moedas': 999999}
        df['jogador']['brasa'] = {'pts': 5000, 'partidas': 9}
        df['jogador']['nome'] = 'Nome Bonito'
        df['placar'] = {'visto': 1}
        df['loja'] = {'aplicadas': [1, 2, 3], 'recusadas': []}
        status, r = c.salva(0, pf, df, [{'iid': 'jforjado1', 'itemId': PECA, 'origem': 'saque'}])
        self.assertEqual(status, 200, 'sem 409 por versão velha: %r' % r)
        self.assertEqual((r['versao'], r['autoridade']), (2, True))
        self.assertIn('hash', r)
        s = self.save(c)
        self.assertEqual(s['progress'], p, 'o progress do corpo é ignorado')
        self.assertEqual(s['db']['carteira'], {'moedas': 10})
        self.assertEqual(s['db']['jogador']['brasa'], d['jogador']['brasa'])
        self.assertEqual(s['db'].get('loja'), d.get('loja'))
        self.assertEqual((s['db']['jogador']['nome'], s['db']['placar']), ('Nome Bonito', {'visto': 1}))
        self.assertEqual(self.sql("SELECT iid FROM itens WHERE iid = 'jforjado1'"), [], 'nascimentos ignorados')
        self.assertEqual(self.sql("SELECT nome FROM resumos WHERE conta_id = ?", c.conta['id'])[0]['nome'], 'Nome Bonito')

    # -- a op ---------------------------------------------------------------------------------
    def test_10_op_confere_forma_e_hash(self):
        c = self.novo('Operador')
        status, r = c.pede('POST', '/api/op', {'ops': [{'nome': 'girarRoleta'}]})
        self.assertEqual(status, 409, r)
        self.poe_estado(c)
        for corpo, esperado in (({'ops': []}, 400), ({'ops': [{'nome': 'girarRoleta'}] * 41}, 400),
                                ({'ops': [{'nome': '1x'}]}, 400), ({'ops': [{'nome': 'girarRoleta', 'args': [1]}]}, 400),
                                ({'ops': [{'nome': 'lojaEntregar', 'args': {}}]}, 403),
                                ({'ops': [{'nome': 'bancoGuildaPoe'}]}, 403)):
            status, r = c.pede('POST', '/api/op', corpo)
            self.assertEqual(status, esperado, (corpo, r))
        self.sql("INSERT OR REPLACE INTO autoridade(conta_id, hash, atualizado_em) VALUES (?, 'abcd1234', 1)",
                 c.conta['id'])
        status, r = c.pede('POST', '/api/op', {'hashAntes': 'ffffffff', 'ops': [{'nome': 'girarRoleta'}]})
        self.assertEqual(status, 409, r)
        self.assertEqual((r['versao'], r['hash']), (1, 'abcd1234'))
        self.assertEqual(r['progress'], self.save(c)['progress'])
        self.assertIn('db', r)
        self.assertEqual(self.save(c)['versao'], 1)

    # -- o juiz fora do ar ----------------------------------------------------------------------
    def test_11_juiz_fora_do_ar_nada_e_gravado(self):
        c = self.novo('Sem Juiz')
        self.poe_estado(c)
        antes = self.save(c)
        b = self.abre(c)
        jogo = self.joga(c, b['bilhete'])
        caido = self.em(c, self.base_sem_juiz)
        status, r = self.fecha(caido, b['bilhete'], jogo)
        self.assertEqual(status, 503, r)
        self.assertEqual(self.sala(b['bilhete'])['estado'], 'aberta', 'o bilhete espera o juiz voltar')
        status, r = caido.pede('POST', '/api/sala/abrir', {'dungeonId': 'cistern', 'roomIndex': 0, 'herois': ['sumo']})
        self.assertEqual(status, 503, r)
        status, r = caido.pede('POST', '/api/op', {'ops': [{'nome': 'girarRoleta'}]})
        self.assertEqual(status, 503, r)
        self.assertEqual(self.save(c), antes)
        status, r = self.fecha(c, b['bilhete'], jogo)                   # o juiz de volta: fecha e paga
        self.assertEqual(status, 200, r)
        self.assertEqual(r['versao'], 2)

    # -- as ops no juiz (ligam quando o juiz tiver POST /op) ------------------------------------------
    def test_20_op_de_verdade(self):
        self.precisa_op()
        c = self.novo('Banqueiro')
        p, d = self.estado_de_partida(carteira=500)
        self.poe_estado(c, p, d)
        status, r = c.pede('POST', '/api/op', {'ops': [{'nome': 'depositarMoedas', 'args': {'n': 100}}]})
        self.assertEqual(status, 200, r)
        self.assertEqual(r['versao'], 2)
        self.assertIn('progress', r, 'sem hashDepois, o estado vai junto')
        s = self.save(c)
        self.assertEqual(s['db']['carteira']['moedas'], 400)
        self.assertEqual(s['hash'], r['hash'])
        # com o hash guardado, o hashAntes certo passa e o errado leva 409
        status, r2 = c.pede('POST', '/api/op', {'hashAntes': 'ffffffff', 'ops': [{'nome': 'sacarMoedas', 'args': {'n': 1}}]})
        self.assertEqual(status, 409, r2)
        status, r2 = c.pede('POST', '/api/op', {'hashAntes': r['hash'], 'hashDepois': 'nao-bate',
                                                'ops': [{'nome': 'sacarMoedas', 'args': {'n': 50}}]})
        self.assertEqual(status, 200, r2)
        self.assertEqual(r2['db']['carteira']['moedas'], 450)
        # op que o juiz não conhece: 422 com o índice, nada gravado, e a trilha
        status, r3 = c.pede('POST', '/api/op', {'hashAntes': r2['hash'], 'ops': [
            {'nome': 'sacarMoedas', 'args': {'n': 1}}, {'nome': 'naoExiste'}]})
        self.assertEqual(status, 422, r3)
        self.assertEqual(r3.get('indice'), 1)
        self.assertEqual(self.save(c)['versao'], 3)
        self.assertEqual(len(self.eventos(c, 'op-recusada')), 1)

    def test_21_loja_entrega_no_servidor(self):
        self.precisa_op()
        c = self.novo('Freguesa')
        p, d = self.estado_de_partida(carteira=1300)
        self.poe_estado(c, p, d)
        # 13/09: o que custa VINTÉNS na loja é a troca por barras de ouro (800 vinténs → 10 barras)
        status, r = c.pede('POST', '/api/loja/comprar', {'sku': 'barras-por-vintens-10', 'idem': secrets.token_hex(8)})
        self.assertEqual(status, 201, r)
        pid = r['pedido']['id']
        # e um pedido com uma entrega que o jogo não conhece: o juiz recusa, o servidor estorna
        b = sqlite3.connect(self.banco_arq)
        cur = b.execute("INSERT INTO loja_pedidos(conta_id, sku, entrega, preco, estado, criado_em) "
                        "VALUES (?, 'torto', '{\"tipo\":\"nada\",\"alvo\":\"x\",\"qtd\":1}', 0, 'pendente', ?)",
                        (c.conta['id'], int(time.time())))
        torto_id = cur.lastrowid
        b.commit()
        b.close()
        status, r = c.pede('POST', '/api/loja/retirar', {})
        self.assertEqual(status, 200, r)
        self.assertEqual(r['entregues'], [pid])
        self.assertEqual(r['estornados'], [torto_id])
        self.assertEqual(r['versao'], 2)
        s = self.save(c)
        self.assertEqual(s['db']['carteira']['moedas'], 500, 'o preço sai da carteira do servidor')
        self.assertEqual(self.sql("SELECT saldo FROM barras_saldo WHERE conta_id = ?", c.conta['id']),
                         [{'saldo': 10}], 'as barras entram junto com a entrega')
        self.assertEqual((s['progress'], s['db'], s['hash']), (r['progress'], r['db'], r['hash']))
        estados = {x['id']: x['estado'] for x in self.sql("SELECT id, estado FROM loja_pedidos WHERE conta_id = ?",
                                                          c.conta['id'])}
        self.assertEqual(estados, {pid: 'entregue', torto_id: 'estornado'})
        status, r = c.pede('POST', '/api/loja/retirar', {})
        self.assertEqual((status, r['pedidos'], r['versao']), (200, [], 2))

    def test_22_troca_no_servidor(self):
        self.precisa_op()
        a, b = self.novo('Troca A'), self.novo('Troca B')
        ia, ib = self.serie('ta'), self.serie('tb')
        pa, da = self.estado_de_partida(carteira=300, pecas=[ia])
        pb, dbb = self.estado_de_partida(carteira=0, pecas=[ib])
        self.poe_estado(a, pa, da, pecas=[ia])
        self.poe_estado(b, pb, dbb, pecas=[ib])
        # a que pede mais vinténs do que tem: o juiz recusa a troca inteira
        status, r = a.pede('POST', '/api/troca', {'com': b.conta['id'], 'dou': {'iids': [ia], 'moedas': 99999},
                                                  'recebo': [ib]})
        self.assertEqual((status, r.get('aguardando')), (200, True), r)
        status, r = b.pede('POST', '/api/troca', {'com': a.conta['id'], 'dou': [ib],
                                                  'recebo': {'iids': [ia], 'moedas': 99999}})
        self.assertEqual(status, 422, r)
        self.assertEqual((self.save(a)['versao'], self.save(b)['versao']), (1, 1), 'nada gravado')
        # a de verdade
        status, r = a.pede('POST', '/api/troca', {'com': b.conta['id'], 'dou': {'iids': [ia], 'moedas': 100},
                                                  'recebo': {'iids': [ib]}})
        self.assertEqual((status, r.get('aguardando')), (200, True), r)
        status, r = b.pede('POST', '/api/troca', {'com': a.conta['id'], 'dou': {'iids': [ib]},
                                                  'recebo': {'iids': [ia], 'moedas': 100}})
        self.assertEqual(status, 200, r)
        self.assertTrue(r['feita'])
        self.assertEqual(r['versao'], 2)
        sa, sb = self.save(a), self.save(b)
        self.assertEqual(r['progress'], sb['progress'])
        series = lambda s: {e.get('iid') for e in s['progress']['inventory'] if isinstance(e, dict)}
        self.assertIn(ib, series(sa))
        self.assertNotIn(ia, series(sa))
        self.assertIn(ia, series(sb))
        self.assertEqual((sa['db']['carteira']['moedas'], sb['db']['carteira']['moedas']), (200, 100))
        self.assertEqual(self.sql("SELECT conta_id, origem, estado FROM itens WHERE iid = ?", ia),
                         [{'conta_id': b.conta['id'], 'origem': 'troca', 'estado': 'vivo'}])
        self.assertEqual(self.sql("SELECT conta_id, origem, estado FROM itens WHERE iid = ?", ib),
                         [{'conta_id': a.conta['id'], 'origem': 'troca', 'estado': 'vivo'}])

    def test_23_banco_da_guilda_no_servidor(self):
        self.precisa_op()
        a, b = self.novo('Dona Banco'), self.novo('Tomador Banco')
        ig = self.serie('gb')
        pa, da = self.estado_de_partida(pecas=[ig])
        self.poe_estado(a, pa, da, pecas=[ig])
        self.poe_estado(b)
        status, g = a.pede('POST', '/api/guilda/criar', {'nome': 'Cofre %d' % ProvaDaAutoridade._n})
        self.assertEqual(status, 200, g)
        self.assertEqual(b.pede('POST', '/api/guilda/entrar', {'gid': g['guilda']['id']})[0], 200)
        self.assertEqual(a.pede('POST', '/api/guilda/banco/depositar', {'item': {'itemId': PECA}})[0], 400)
        status, r = a.pede('POST', '/api/guilda/banco/depositar', {'item': {'itemId': PECA, 'level': 9, 'iid': ig}})
        self.assertEqual(status, 200, r)
        vaga = r['guilda']['banco'][0]
        self.assertEqual((vaga['iid'], vaga['level']), (ig, 0), 'o nível guardado é o do estado do servidor')
        self.assertNotIn(ig, [e.get('iid') for e in self.save(a)['progress']['inventory']])
        self.assertEqual(self.sql("SELECT estado FROM itens WHERE iid = ?", ig)[0]['estado'], 'vivo')
        status, r = b.pede('POST', '/api/guilda/banco/pegar', {'id': vaga['id']})
        self.assertEqual(status, 200, r)
        self.assertFalse(r['definitivo'])
        copia = r['item']['iid']
        self.assertNotEqual(copia, ig)
        self.assertIn(copia, [e.get('iid') for e in self.save(b)['progress']['inventory']])
        self.assertEqual(self.sql("SELECT conta_id, origem, estado FROM itens WHERE iid = ?", copia),
                         [{'conta_id': b.conta['id'], 'origem': 'banco', 'estado': 'vivo'}])
        status, r = b.pede('POST', '/api/guilda/banco/devolver', {'id': vaga['id']})
        self.assertEqual(status, 200, r)
        self.assertNotIn(copia, [e.get('iid') for e in self.save(b)['progress']['inventory']])
        self.assertEqual(self.sql("SELECT estado FROM itens WHERE iid = ?", copia)[0]['estado'], 'fora')
        status, r = a.pede('POST', '/api/guilda/banco/pegar', {'id': vaga['id']})
        self.assertEqual(status, 200, r)
        self.assertTrue(r['definitivo'])
        self.assertIn(ig, [e.get('iid') for e in self.save(a)['progress']['inventory']])
        self.assertEqual(self.sql("SELECT conta_id, estado FROM itens WHERE iid = ?", ig),
                         [{'conta_id': a.conta['id'], 'estado': 'vivo'}])


if __name__ == '__main__':
    unittest.main(verbosity=2)
