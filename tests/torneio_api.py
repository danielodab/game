#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova do TORNEIO DA ARENA no servidor (servidor/torneio.py), com o JUIZ de verdade (10/10).

    python tests/torneio_api.py

O contrato é docs/TORNEIO.md. Sobe o juiz (servidor/juiz/juiz.js) e a API com --juiz num banco descartável, e o
duelo de torneio é jogado de verdade por tests/juiz_grupo_jogador.js (a IA decide os lances dos dois lados).
O relógio do torneio é o do servidor e mora no banco: as provas ADIANTAM os relógios pelo sqlite (o fechamento
das inscrições, o início, o prazo da chamada, a espera entre as rodadas) e qualquer rota do torneio dá o passo
— o laço de fundo (aqui a cada 1 s, SOTERRA_TORNEIO_PASSO_S) dá o mesmo passo, e a prova 01 o vê sozinho.

Cobre: os três torneios da semana (sábado 14:00 as duas faixas de PvP, domingo 14:00 o de guilda, de Brasília);
as rotas públicas sem conta; o Mestre marcando e cancelando (e só ele); as vagas 2→4→8→16 e o `cheio`; a faixa
de nível (`nivel`), `outra-chave`, o Mestre fora, `tipo`, `fechado`, sair; o cancelamento com menos de 2; o
sorteio com passes (5 inscritos = chave de 8, 3 passes, nunca dois passes na mesma luta); a chamada, o W.O. de
um lado e o sorteio com nenhum presente; a partida pronta no /api/arena/estado com `torneio`; o duelo de
torneio fechado com vencedor avançando a chave sem mexer na Brasa nem na vida (e com os heróis a 0 PV na
porta); a revanche e o sorteio depois dela; a final e o prêmio pelo tamanho da chave (barras no extrato,
vinténs, gemas) pago UMA vez; a conquista, o título válido no juiz e a moldura na vitrine; o carimbo do Relé
(`arena`, `campea`, `titulos`); o torneio de guilda (voluntários, a escolha do líder/oficial, o padrão pelo
maior nível, o XP em dobro no contexto do juiz por 7 dias, o XP da guilda); a desistência depois do fechamento.
Os processos rodam com prioridade abaixo do normal (a máquina é dividida com quem joga).
"""
import copy
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
RAIZ = os.path.dirname(AQUI)
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(RAIZ, 'servidor'))
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402
from autoridade_api import BAIXA, ESTADO_JS, JUIZ, NODE, adota_regras, espera_url, roda_node  # noqa: E402

JOGADORES = os.path.join(AQUI, 'juiz_grupo_jogador.js')
DUPLA = ['sumo', 'curandeiro']
DIA_MS = 86400 * 1000
PREMIOS = {16: (20, 5000, 2), 8: (10, 2500, 1), 4: (5, 1250, 0), 2: (2, 600, 0)}


class ProvaDoTorneio(unittest.TestCase):
    _n = 0
    _dias = 20          # cada torneio marcado cai num dia de Brasília diferente (a `outra-chave` é por dia)

    @classmethod
    def setUpClass(cls):
        if NODE is None:
            raise unittest.SkipTest('sem node nesta máquina: o juiz não sobe')
        cls.pasta = tempfile.mkdtemp(prefix='soterra-torneio-')
        cls.banco_arq = os.path.join(cls.pasta, 'dados', 'soterra.db')
        cls.procs, cls.logs = [], []
        try:
            porta_juiz = porta_livre()
            cls.juiz = 'http://127.0.0.1:%d' % porta_juiz
            pj = cls._processo('juiz', [NODE, JUIZ, '--porta', str(porta_juiz)])
            if not espera_url(cls.juiz + '/saude', pj):
                raise RuntimeError('o juiz não subiu; veja ' + cls.pasta)
            adota_regras(cls.juiz)
            codigo = ("const est = require(process.argv[1]); const w = est.mundoEconomico({}); est.poeEstado(w, null, null);"
                      "const s = est.tiraEstado(w);"
                      "process.stdout.write(JSON.stringify({progress: s.progress, db: s.db, xp: w.J.DATA.leveling.xpTable}));")
            cls.inicial = roda_node(['-e', codigo, ESTADO_JS])
            env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
            # o laço de fundo a cada 1 s; e as LEITURAS dão o passo sempre (em produção, no máximo 1 por segundo):
            # a prova adianta um relógio no banco e lê o resultado na chamada seguinte
            env.update(SOTERRA_SALA_MIN_S='0', SOTERRA_SALA_S_POR_TURNO='0', SOTERRA_TORNEIO_PASSO_S='1',
                       SOTERRA_TORNEIO_PASSO_MIN_S='0')
            porta = porta_livre()
            p = cls._processo('api', [sys.executable, API, '--porta', str(porta), '--banco', cls.banco_arq,
                                      '--juiz', cls.juiz], env)
            cls.base = 'http://127.0.0.1:%d' % porta
            if not espera_api(cls.base, p, 30):
                raise RuntimeError('a API não subiu; veja ' + cls.pasta)
            cls.gm = None
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
    def tearDownClass(cls):
        for p in getattr(cls, 'procs', []):
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
    def sql(self, consulta, *args):
        for _ in range(50):                     # o laço de fundo escreve no mesmo banco: a trava ocupada espera
            b = sqlite3.connect(self.banco_arq, timeout=10)
            b.row_factory = sqlite3.Row
            try:
                linhas = [dict(r) for r in b.execute(consulta, args).fetchall()]
                b.commit()
                return linhas
            except sqlite3.OperationalError:
                time.sleep(0.1)
            finally:
                b.close()
        raise RuntimeError('o banco da prova ficou trancado')

    def agora_ms(self):
        return int(time.time() * 1000)

    def conta(self, apelido, nivel=22, niveis=None):
        """Uma conta com o estado no servidor e a dupla (Bárbaro e Curandeiro) no nível dado."""
        ProvaDoTorneio._n += 1
        c = Cliente(self.base)
        status, r = c.cadastra('%s %d' % (apelido, ProvaDoTorneio._n))
        self.assertEqual(status, 201, r)
        p, d = copy.deepcopy(self.inicial['progress']), copy.deepcopy(self.inicial['db'])
        for heroi, nv in (niveis or {h: nivel for h in DUPLA}).items():
            p['heroes'][heroi]['level'] = nv
            p['heroes'][heroi]['xp'] = self.inicial['xp'][nv - 1]
        status, r = c.salva(0, p, d)
        self.assertEqual(status, 200, r)
        return c

    def mestre(self):
        if ProvaDoTorneio.gm is None:
            m = Cliente(self.base)
            status, r = m.cadastra('Regente Torneio')
            self.assertEqual(status, 201, r)
            self.sql("UPDATE contas SET gm = 1 WHERE id = ?", m.conta['id'])
            ProvaDoTorneio.gm = m
        return ProvaDoTorneio.gm

    def marca(self, tipo='pvp', faixa='20-25', titulo=None):
        ProvaDoTorneio._dias += 1
        corpo = {'tipo': tipo, 'faixa': faixa, 'inicioMs': self.agora_ms() + ProvaDoTorneio._dias * DIA_MS}
        if titulo:
            corpo['titulo'] = titulo
        status, r = self.mestre().pede('POST', '/api/mestre/torneio/marcar', corpo)
        self.assertEqual(status, 200, r)
        return r['torneio']['id']

    def T(self, tid):
        status, r = Cliente(self.base).pede('GET', '/api/torneio?id=%d' % tid)      # pública: sem conta
        self.assertEqual(status, 200, r)
        return r['torneio']

    def inscreve(self, c, tid, herois=None):
        return c.pede('POST', '/api/torneio/inscrever', {'torneio': tid, 'herois': herois or DUPLA})

    def meu(self, c):
        status, r = c.pede('GET', '/api/torneio/meu')
        self.assertEqual(status, 200, r)
        return r

    def presente(self, c, tid):
        status, r = c.pede('POST', '/api/torneio/presente', {'torneio': tid})
        self.assertEqual(status, 200, r)
        return r

    def fecha_inscricoes(self, tid):
        self.sql("UPDATE torneios SET inscricao_ate_ms = ? WHERE id = ? AND estado = 'inscricoes'", self.agora_ms() - 1, tid)
        return self.T(tid)

    def comeca(self, tid):
        self.sql("UPDATE torneios SET inicio_ms = ? WHERE id = ? AND estado = 'sorteado'", self.agora_ms() - 1, tid)
        return self.T(tid)

    def vence_prazo(self, tid):
        self.sql("UPDATE torneio_lutas SET prazo_ms = 1 WHERE torneio_id = ? AND estado = 'chamada'", tid)
        return self.T(tid)

    def proxima_rodada(self, tid):
        """A rodada inteira decidida: a seguinte começa 2 min depois — a prova adianta esse relógio."""
        t = self.T(tid)                                   # o passo anota quando a rodada ficou decidida
        if t['estado'] != 'andamento':
            return t
        self.sql("UPDATE torneios SET rodada_decidida_ms = 1 WHERE id = ? AND rodada_decidida_ms IS NOT NULL", tid)
        return self.T(tid)

    def lutas(self, t, rodada=None):
        r = t['chave']['rodadas'][t['chave']['rodada'] if rodada is None else rodada]
        return r

    def por_wo(self, tid, contas, favorito=None):
        """Leva o torneio até o fim só com W.O.: em cada luta chamada, UM lado diz "estou aqui" (o `favorito`, quando
        ele luta nela; senão o de cima) e o prazo vence. Devolve o T encerrado."""
        de = {c.conta['id']: c for c in contas}
        for _ in range(8):
            t = self.T(tid)
            if t['estado'] != 'andamento':
                break
            for l in self.lutas(t):
                if l['estado'] != 'chamada':
                    continue
                quem = l['a']['conta']
                if favorito is not None and favorito.conta['id'] in (l['a']['conta'], l['b']['conta']):
                    quem = favorito.conta['id']
                self.presente(de[quem], tid)
            self.vence_prazo(tid)
            self.proxima_rodada(tid)
        t = self.T(tid)
        self.assertEqual(t['estado'], 'encerrado', t)
        return t

    def save(self, c):
        status, r = c.pede('GET', '/api/save')
        self.assertEqual(status, 200, r)
        return r

    def brasa(self, c):
        return (self.save(c)['db'].get('jogador') or {}).get('brasa') or {}

    def barras(self, c):
        status, r = c.pede('GET', '/api/loja/minha')
        self.assertEqual(status, 200, r)
        return r['barras']

    def titulo(self, c, titulo):
        """A op do título no estado do servidor (o hash de antes é o que o servidor guarda: a prova adota e repete)."""
        corpo = {'ops': [{'nome': 'definirTitulo', 'args': {'titulo': titulo}}]}
        status, r = c.pede('POST', '/api/op', corpo)
        if status == 409 and r.get('hash'):
            status, r = c.pede('POST', '/api/op', dict(corpo, hashAntes=r['hash']))
        return status, r

    def joga(self, a, b, semente):
        sa, sb = self.save(a), self.save(b)
        return roda_node([JOGADORES], {'modo': 'duelo', 'dungeonId': 'cistern', 'roomIndex': 0, 'semente': semente,
                                       'A': {'progress': sa['progress'], 'db': sa['db'], 'dono': 'ana', 'herois': DUPLA},
                                       'B': {'progress': sb['progress'], 'db': sb['db'], 'dono': 'bia', 'herois': DUPLA}})

    def corpo_duelo(self, a, b, did, jogo, semente, **kw):
        corpo = {'did': did, 'modo': 'arena', 'dungeonId': 'cistern', 'roomIndex': 0, 'semente': semente,
                 'A': {'conta': a.conta['id'], 'dono': 'ana', 'herois': DUPLA},
                 'B': {'conta': b.conta['id'], 'dono': 'bia', 'herois': DUPLA},
                 'lances': jogo['lances'] if jogo else [], 'hashFinal': jogo['hash'] if jogo else None, 'fotografada': False}
        corpo.update(kw)
        return corpo

    def dupla_na_final(self, faixa='20-25', nivel=22):
        """Dois inscritos, chave de 2, os dois presentes: a final com a partida pronta. Devolve (tid, A, B, did) —
        A é o de cima da chave."""
        tid = self.marca('pvp', faixa)
        x, y = self.conta('Ana Final', nivel), self.conta('Bia Final', nivel)
        for c in (x, y):
            status, r = self.inscreve(c, tid)
            self.assertEqual(status, 200, r)
        self.fecha_inscricoes(tid)
        t = self.comeca(tid)
        self.assertEqual((t['estado'], t['chave']['tamanho']), ('andamento', 2), t)
        luta = self.lutas(t)[0]
        a, b = (x, y) if luta['a']['conta'] == x.conta['id'] else (y, x)
        self.presente(a, tid)
        r = self.presente(b, tid)
        self.assertIsNotNone(r['luta'], r)
        return tid, a, b, r['luta']['did']

    # -- as provas ----------------------------------------------------------------------------
    def test_01_os_da_semana_nascem_sozinhos(self):
        """O laço de fundo cria os três da semana sem ninguém pedir: sábado 14:00 (duas faixas de PvP) e domingo
        14:00 (guilda), no horário de Brasília, com as inscrições fechando 10 minutos antes."""
        import datetime
        limite = time.time() + 15
        linhas = []
        while time.time() < limite and len(linhas) < 3:
            linhas = self.sql("SELECT * FROM torneios WHERE origem = 'semanal' ORDER BY inicio_ms, faixa")
            time.sleep(0.3)
        self.assertEqual(sorted((l['tipo'], l['faixa']) for l in linhas if l['tipo'] == 'pvp'),
                         [('pvp', '20-25'), ('pvp', '25-30')], linhas)
        self.assertEqual([l['faixa'] for l in linhas if l['tipo'] == 'guilda'], [None], linhas)
        for l in linhas:
            brasilia = datetime.datetime.fromtimestamp(l['inicio_ms'] / 1000 - 3 * 3600, datetime.timezone.utc)
            self.assertEqual((brasilia.weekday(), brasilia.hour, brasilia.minute), (5 if l['tipo'] == 'pvp' else 6, 14, 0), l)
            self.assertEqual(l['inicio_ms'] - l['inscricao_ate_ms'], 600000)
            self.assertEqual((l['estado'], (l['nivel_min'], l['nivel_max'])),
                             ('inscricoes', {'20-25': (20, 25), '25-30': (25, 30), None: (20, 30)}[l['faixa']]))
            self.assertGreater(l['inscricao_ate_ms'], self.agora_ms())
        # o passo é idempotente: pedir de novo não cria outro
        status, r = Cliente(self.base).pede('GET', '/api/torneios')
        self.assertEqual(status, 200, r)
        self.assertEqual(len(self.sql("SELECT 1 FROM torneios WHERE origem = 'semanal'")), 3)
        # o semanal seguinte só nasce quando o anterior acaba — e nunca a menos de 6 dias dele
        velho = [l for l in linhas if l['faixa'] == '20-25'][0]
        self.sql("UPDATE torneios SET estado = 'cancelado' WHERE id = ?", velho['id'])
        Cliente(self.base).pede('GET', '/api/torneios')
        novos = self.sql("SELECT * FROM torneios WHERE origem = 'semanal' AND faixa = '20-25' AND estado = 'inscricoes'")
        self.assertEqual(len(novos), 1, novos)
        self.assertEqual(novos[0]['inicio_ms'] - velho['inicio_ms'], 7 * DIA_MS)

    def test_02_publicas_sem_conta_e_as_do_mestre(self):
        tid = self.marca('pvp', '25-30', 'Copa da Prova')
        anon = Cliente(self.base)
        status, r = anon.pede('GET', '/api/torneios')
        self.assertEqual(status, 200, r)
        self.assertIn('agoraMs', r)
        t = next(x for x in r['torneios'] if x['id'] == tid)
        self.assertEqual((t['tipo'], t['faixa'], t['nivelMin'], t['nivelMax'], t['titulo'], t['origem'], t['estado']),
                         ('pvp', '25-30', 25, 30, 'Copa da Prova', 'mestre', 'inscricoes'))
        self.assertEqual((t['vagas'], t['inscritos'], t['chave'], t['campeao']), (2, [], None, None))
        self.assertEqual(t['premio'], {'barras': 2, 'vintens': 600, 'gemas': 0, 'conquista': False, 'moldura': False,
                                       'xpGuilda': 0})
        self.assertEqual(t['inicioMs'] - t['inscricaoAteMs'], 600000)
        self.assertEqual(self.T(tid)['id'], tid)
        self.assertEqual(anon.pede('GET', '/api/torneio?id=999999')[0], 404)
        self.assertEqual(anon.pede('GET', '/api/torneio?id=abc')[0], 400)
        for metodo, rota in (('GET', '/api/torneio/meu'), ('POST', '/api/torneio/inscrever'), ('POST', '/api/torneio/presente'),
                             ('POST', '/api/torneio/sair'), ('POST', '/api/torneio/voluntariar'),
                             ('POST', '/api/torneio/desvoluntariar'), ('POST', '/api/torneio/representante')):
            self.assertEqual(anon.pede(metodo, rota, {} if metodo == 'POST' else None)[0], 401, rota)
        # só o Mestre marca, vê tudo e cancela
        ana = self.conta('Ana Comum')
        for metodo, rota in (('GET', '/api/mestre/torneios'), ('POST', '/api/mestre/torneio/marcar'),
                             ('POST', '/api/mestre/torneio/cancelar')):
            self.assertEqual(ana.pede(metodo, rota, {} if metodo == 'POST' else None)[0], 403, rota)
        gm = self.mestre()
        futuro = self.agora_ms() + 400 * DIA_MS
        for corpo in ({'tipo': 'duplas', 'faixa': '20-25', 'inicioMs': futuro}, {'tipo': 'pvp', 'faixa': '10-20', 'inicioMs': futuro},
                      {'tipo': 'pvp', 'faixa': '20-25', 'inicioMs': self.agora_ms() + 60000},
                      {'tipo': 'pvp', 'faixa': '20-25', 'inicioMs': futuro},
                      {'tipo': 'pvp', 'faixa': '20-25', 'inicioMs': self.agora_ms() + DIA_MS, 'titulo': 'x'}):
            status, r = gm.pede('POST', '/api/mestre/torneio/marcar', corpo)
            self.assertEqual(status, 400, (corpo, r))
        # o de guilda não tem faixa (20 a 30) e ganha o título padrão
        gid = self.marca('guilda', None)
        g = self.T(gid)
        self.assertEqual((g['tipo'], g['faixa'], g['nivelMin'], g['nivelMax'], g['titulo']),
                         ('guilda', None, 20, 30, 'Torneio das Guildas'))
        # cancelar: some das públicas, fica na do Mestre; inscrever nele é `fechado`; cancelar de novo é 409
        status, r = gm.pede('POST', '/api/mestre/torneio/cancelar', {'torneio': tid})
        self.assertEqual((status, r['torneio']['estado'], r['torneio']['motivo']), (200, 'cancelado', 'mestre'), r)
        self.assertNotIn(tid, [x['id'] for x in anon.pede('GET', '/api/torneios')[1]['torneios']])
        status, r = gm.pede('GET', '/api/mestre/torneios')
        self.assertEqual(status, 200, r)
        self.assertEqual(next(x for x in r['torneios'] if x['id'] == tid)['estado'], 'cancelado')
        status, r = self.inscreve(self.conta('Bia Tarde', 27), tid)
        self.assertEqual((status, r.get('motivo')), (409, 'fechado'), r)
        self.assertEqual(gm.pede('POST', '/api/mestre/torneio/cancelar', {'torneio': tid})[0], 409)
        self.assertEqual(gm.pede('POST', '/api/mestre/torneio/cancelar', {'torneio': 999999})[0], 404)
        self.assertGreaterEqual(len(self.sql("SELECT 1 FROM moderacao_auditoria WHERE mestre_id = ?", gm.conta['id'])), 3,
                                'toda ação do Mestre deixa linha')
        self.sql("UPDATE torneios SET estado = 'cancelado' WHERE id = ?", gid)

    def test_03_inscricao_confere(self):
        tid = self.marca('pvp', '20-25')
        ana = self.conta('Ana Faixa', 22)
        for corpo in ({'torneio': tid, 'herois': []}, {'torneio': tid, 'herois': ['nada', 'sumo']},
                      {'torneio': 'x', 'herois': DUPLA}):
            self.assertEqual(ana.pede('POST', '/api/torneio/inscrever', corpo)[0], 400, corpo)
        self.assertEqual(self.inscreve(ana, 999999)[0], 404)
        status, r = self.inscreve(ana, tid, ['sumo'])
        self.assertEqual((status, r.get('motivo')), (400, 'dois'), 'a conta com dois heróis inscreve a DUPLA')
        # a faixa: o nível do herói MAIS FORTE da dupla, no estado do servidor
        baixo = self.conta('Bia Baixa', niveis={'sumo': 19, 'curandeiro': 12})
        status, r = self.inscreve(baixo, tid)
        self.assertEqual((status, r.get('motivo'), r.get('nivel'), r.get('nivelMin'), r.get('nivelMax')),
                         (409, 'nivel', 19, 20, 25), r)
        alto = self.conta('Caio Alto', niveis={'sumo': 26, 'curandeiro': 20})
        self.assertEqual(self.inscreve(alto, tid)[1].get('motivo'), 'nivel')
        misto = self.conta('Dora Mista', niveis={'sumo': 25, 'curandeiro': 3})
        status, r = self.inscreve(misto, tid)
        self.assertEqual(status, 200, 'vale o mais forte: 25 entra na 20-25')
        # o Mestre não entra
        status, r = self.inscreve(self.mestre(), tid)
        self.assertEqual((status, r.get('motivo')), (403, 'mestre'), r)
        # inscrever e trocar a dupla (inscrever de novo) sem perder o lugar
        status, r = self.inscreve(ana, tid)
        self.assertEqual(status, 200, r)
        eu = next(i for i in r['torneio']['inscritos'] if i['conta'] == ana.conta['id'])
        self.assertEqual((eu['nivel'], [c['classId'] for c in eu['classes']], eu['guilda']), (22, ['sumo', 'curandeiro'], None))
        self.assertTrue(eu['nome'].startswith('Ana Faixa'))
        status, r = self.inscreve(ana, tid, ['curandeiro', 'sumo'])
        self.assertEqual(status, 200, r)
        self.assertEqual(len(r['torneio']['inscritos']), 2)
        m = self.meu(ana)
        self.assertEqual(m['inscricoes'], [{'torneio': tid, 'herois': ['curandeiro', 'sumo'],
                                            'classes': [{'classId': 'curandeiro', 'nivel': 22}, {'classId': 'sumo', 'nivel': 22}],
                                            'nivel': 22}])
        self.assertEqual((m['luta'], m['conquistas'], m['moldura'], m['vigente'], m['guilda']),
                         (None, {'pvp': 0, 'guilda': 0}, False, False, None))
        # uma conta, uma chave por dia: o nível 25 escolhe UMA das duas do mesmo dia
        mesmo_dia = self.sql("SELECT inicio_ms FROM torneios WHERE id = ?", tid)[0]['inicio_ms']
        outro = self.marca('pvp', '25-30')
        self.sql("UPDATE torneios SET inicio_ms = ?, inscricao_ate_ms = ? WHERE id = ?", mesmo_dia, mesmo_dia - 600000, outro)
        status, r = self.inscreve(misto, outro)
        self.assertEqual((status, r.get('motivo'), r.get('torneio')), (409, 'outra-chave', tid), r)
        # ...e sai de uma para entrar na outra
        status, r = misto.pede('POST', '/api/torneio/sair', {'torneio': tid})
        self.assertEqual(status, 200, r)
        self.assertNotIn(misto.conta['id'], [i['conta'] for i in r['torneio']['inscritos']])
        self.assertEqual(misto.pede('POST', '/api/torneio/sair', {'torneio': tid})[1].get('motivo'), 'sem-inscricao')
        self.assertEqual(self.inscreve(misto, outro)[0], 200)
        # o de guilda não aceita inscrição direta (`tipo`), e o de PvP não aceita voluntário
        gid = self.marca('guilda', None)
        status, r = self.inscreve(ana, gid)
        self.assertEqual((status, r.get('motivo')), (400, 'tipo'), r)
        status, r = ana.pede('POST', '/api/torneio/voluntariar', {'torneio': tid, 'herois': DUPLA})
        self.assertEqual((status, r.get('motivo')), (400, 'tipo'), r)
        # fechou: `fechado`
        self.fecha_inscricoes(tid)
        status, r = self.inscreve(self.conta('Eva Tarde', 22), tid)
        self.assertEqual((status, r.get('motivo')), (409, 'fechado'), r)
        for x in (outro, gid):
            self.sql("UPDATE torneios SET estado = 'cancelado' WHERE id = ?", x)

    def test_04_menos_de_dois_cancela_e_quem_saiu_da_faixa_nao_entra(self):
        tid = self.marca('pvp', '20-25')
        ana = self.conta('Ana Sozinha', 21)
        self.assertEqual(self.inscreve(ana, tid)[0], 200)
        t = self.fecha_inscricoes(tid)
        self.assertEqual((t['estado'], t['chave']), ('cancelado', None), t)
        self.assertEqual(self.meu(ana)['inscricoes'], [], 'o cancelado some das inscrições da conta')
        self.assertEqual(self.sql("SELECT motivo FROM torneios WHERE id = ?", tid)[0]['motivo'], 'poucos')
        # o nível vale no estado do SERVIDOR também no fechamento: quem passou da faixa depois de inscrito não entra
        tid = self.marca('pvp', '20-25')
        bia, caio, dora = self.conta('Bia Sobe', 25), self.conta('Caio Fica', 23), self.conta('Dora Fica', 24)
        for c in (bia, caio, dora):
            self.assertEqual(self.inscreve(c, tid)[0], 200)
        s = self.save(bia)
        s['progress']['heroes']['sumo']['level'] = 27
        s['progress']['heroes']['sumo']['xp'] = self.inicial['xp'][26]
        self.sql("UPDATE saves SET progress = ? WHERE conta_id = ?", json.dumps(s['progress']), bia.conta['id'])
        t = self.fecha_inscricoes(tid)
        self.assertEqual((t['estado'], t['chave']['tamanho']), ('sorteado', 2), t)
        self.assertEqual(sorted(i['conta'] for i in t['inscritos']), sorted([caio.conta['id'], dora.conta['id']]))
        self.sql("UPDATE torneios SET estado = 'cancelado' WHERE id = ?", tid)

    def test_05_vagas_aos_pares_ate_16_e_o_cheio(self):
        tid = self.marca('pvp', '20-25')
        contas, vagas = [], [self.T(tid)['vagas']]
        for i in range(16):
            c = self.conta('Vaga', 20 + i % 6)
            status, r = self.inscreve(c, tid)
            self.assertEqual(status, 200, r)
            contas.append(c)
            vagas.append(r['torneio']['vagas'])
        # nasce com 2; encheu, dobra: 2 → 4 → 8 → 16 (o teto)
        self.assertEqual(vagas, [2, 2, 4, 4, 8, 8, 8, 8, 16, 16, 16, 16, 16, 16, 16, 16, 16])
        self.assertEqual(self.T(tid)['premio']['barras'], 20, 'o prêmio mostrado é o do tamanho de agora')
        status, r = self.inscreve(self.conta('Dezessete', 22), tid)
        self.assertEqual((status, r.get('motivo')), (409, 'cheio'), r)
        self.assertEqual(self.inscreve(contas[3], tid)[0], 200, 'quem já está dentro troca a dupla mesmo com a chave cheia')
        ProvaDoTorneio.cheio = (tid, contas)

    def test_06_chave_de_16_ate_o_campeao_e_o_premio_maior(self):
        tid, contas = ProvaDoTorneio.cheio
        t = self.fecha_inscricoes(tid)
        self.assertEqual((t['estado'], t['vagas'], t['chave']['tamanho'], [len(r) for r in t['chave']['rodadas']]),
                         ('sorteado', 16, 16, [8, 4, 2, 1]), t)
        self.assertTrue(all(l['a'] and l['b'] and l['estado'] == 'aguarda' for l in t['chave']['rodadas'][0]))
        self.assertEqual(sorted(l[k]['conta'] for l in t['chave']['rodadas'][0] for k in 'ab'),
                         sorted(c.conta['id'] for c in contas), 'cada inscrito numa posição, uma vez')
        # a previsão pública: inicio + rodada × 20 min
        self.assertEqual([r[0]['previstoMs'] - t['inicioMs'] for r in t['chave']['rodadas']], [0, 1200000, 2400000, 3600000])
        favorito = contas[5]
        self.comeca(tid)
        fim = self.por_wo(tid, contas, favorito)
        self.assertEqual(fim['campeao']['conta'], favorito.conta['id'])
        self.assertTrue(all(l['estado'] == 'decidida' and l['como'] == 'wo' for r in fim['chave']['rodadas'] for l in r))
        b = self.barras(favorito)
        self.assertEqual(b['saldo'], 20)
        mov = [m for m in b['movimentos'] if m['motivo'] == 'torneio']
        self.assertEqual([(m['delta'], m['torneio'], m['nome']) for m in mov], [(20, tid, 'Torneio da Arena')], b)
        pedidos = {p['sku']: p for p in self.sql("SELECT * FROM loja_pedidos WHERE conta_id = ? AND sku LIKE 'torneio%'",
                                                 favorito.conta['id'])}
        self.assertEqual(json.loads(pedidos['torneio-vintens']['entrega'])['qtd'], 5000)
        self.assertEqual(json.loads(pedidos['torneio']['entrega']), {'tipo': 'pedras', 'alvo': 'stone-gem', 'qtd': 2,
                                                                      'origem': 'torneio'})
        self.assertEqual({p['estado'] for p in pedidos.values()}, {'entregue'}, 'a entrega é na hora, pelo juiz')
        s = self.save(favorito)
        self.assertEqual(s['progress']['stones'].get('stone-gem'), 2, 'as duas Gemas Enterradas entraram no estado')
        self.assertEqual(self.meu(favorito)['conquistas'], {'pvp': 1, 'guilda': 0})
        self.assertEqual(len(self.sql("SELECT 1 FROM plateia WHERE tipo = 'torneio' AND conta_id = ?", favorito.conta['id'])), 1)

    def test_07_cinco_inscritos_chave_de_8_tres_passes_wo_e_sorteio(self):
        tid = self.marca('pvp', '20-25')
        contas = [self.conta('Cinco', 21 + i % 4) for i in range(5)]
        de = {c.conta['id']: c for c in contas}
        for c in contas:
            self.assertEqual(self.inscreve(c, tid)[0], 200)
        t = self.fecha_inscricoes(tid)
        self.assertEqual((t['estado'], t['vagas'], t['chave']['tamanho'], t['chave']['rodada']), ('sorteado', 8, 8, 0), t)
        self.assertEqual(t['premio'], {'barras': 10, 'vintens': 2500, 'gemas': 1, 'conquista': True, 'moldura': True,
                                       'xpGuilda': 0})
        r0 = t['chave']['rodadas'][0]
        passes = [l for l in r0 if l['b'] is None]
        self.assertEqual(len(passes), 3, r0)
        self.assertTrue(all(l['a'] is not None for l in r0), 'nunca dois passes na mesma luta')
        self.assertTrue(all((l['estado'], l['vencedor'], l['como']) == ('decidida', 'a', 'bye') for l in passes), passes)
        cheia = next(l for l in r0 if l['b'] is not None)
        self.assertEqual((cheia['estado'], cheia['vencedor'], cheia['como']), ('aguarda', None, None))
        # quem passou livre já está na rodada seguinte, na metade certa (pos // 2; par = em cima)
        r1 = t['chave']['rodadas'][1]
        for l in passes:
            self.assertEqual(r1[l['pos'] // 2]['a' if l['pos'] % 2 == 0 else 'b']['conta'], l['a']['conta'])
        # sorteado não é andamento: ninguém é chamado antes da hora
        self.assertTrue(all(self.meu(c)['luta'] is None for c in contas))
        # começou: só a luta cheia é chamada; os dois têm 3 minutos
        t = self.comeca(tid)
        self.assertEqual(t['estado'], 'andamento')
        l0 = next(l for l in self.lutas(t) if l['como'] != 'bye')
        self.assertEqual(l0['estado'], 'chamada')
        a, b = de[l0['a']['conta']], de[l0['b']['conta']]
        ma = self.meu(a)['luta']
        self.assertEqual((ma['torneio'], ma['rodada'], ma['pos'], ma['lado'], ma['presente'], ma['elePresente']),
                         (tid, 0, l0['pos'], 'A', False, False), ma)
        self.assertEqual(ma['adversario']['conta'], b.conta['id'])
        self.assertEqual([c['classId'] for c in ma['adversario']['classes']], DUPLA)
        self.assertNotIn('did', ma)
        self.assertTrue(170000 < ma['prazoMs'] - self.agora_ms() <= 180000, ma)
        # só o de baixo diz "estou aqui": W.O.
        mb = self.presente(b, tid)['luta']
        self.assertEqual((mb['lado'], mb['presente'], mb['elePresente']), ('B', True, False))
        self.assertTrue(self.meu(a)['luta']['elePresente'])
        t = self.vence_prazo(tid)
        l0 = t['chave']['rodadas'][0][l0['pos']]
        self.assertEqual((l0['estado'], l0['vencedor'], l0['como']), ('decidida', 'b', 'wo'), l0)
        self.assertIsNone(self.meu(a)['luta'])
        # a rodada seguinte só começa 2 minutos depois de a anterior estar inteira decidida
        self.assertEqual(self.T(tid)['chave']['rodada'], 0)
        t = self.proxima_rodada(tid)
        self.assertEqual(t['chave']['rodada'], 1)
        semis = self.lutas(t)
        self.assertEqual([l['estado'] for l in semis], ['chamada', 'chamada'])
        self.assertTrue(all(abs(l['previstoMs'] - self.agora_ms()) < 30000 for l in semis), 'a previsão é corrigida quando a rodada começa')
        # NENHUM presente nas duas semis: o servidor sorteia quem passa (a chave não para)
        t = self.vence_prazo(tid)
        semis = t['chave']['rodadas'][1]
        self.assertTrue(all((l['estado'], l['como']) == ('decidida', 'sorteio') and l['vencedor'] in ('a', 'b') for l in semis), semis)
        # a final: um presente só
        t = self.proxima_rodada(tid)
        final = self.lutas(t)[0]
        self.assertEqual((t['chave']['rodada'], final['estado']), (2, 'chamada'))
        campeao = de[final['a']['conta']]
        fim = self.por_wo(tid, contas, campeao)
        self.assertEqual((fim['campeao']['conta'], fim['campeao']['nome']), (campeao.conta['id'], final['a']['nome']))
        # o prêmio da chave de 8 (a SORTEADA, não a dos 5 inscritos): 10 barras, 2500 vinténs, 1 gema — UMA vez
        self.assertEqual(self.barras(campeao)['saldo'], 10)
        for _ in range(3):
            self.T(tid)
            Cliente(self.base).pede('GET', '/api/torneios')
        time.sleep(2.5)                                         # e o laço de fundo dá o passo dele também
        self.assertEqual(self.barras(campeao)['saldo'], 10, 'nada se paga duas vezes')
        self.assertEqual(len(self.sql("SELECT 1 FROM loja_pedidos WHERE conta_id = ? AND sku LIKE 'torneio%'",
                                      campeao.conta['id'])), 2)
        self.assertEqual(self.sql("SELECT tamanho, premio FROM torneio_pagos WHERE torneio_id = ?", tid)[0]['tamanho'], 8)
        self.assertEqual(self.save(campeao)['progress']['stones'].get('stone-gem'), 1)
        # o encerrado aparece entre os últimos da lista pública
        self.assertIn(tid, [x['id'] for x in Cliente(self.base).pede('GET', '/api/torneios')[1]['torneios']])
        ProvaDoTorneio.campeao8 = campeao

    def test_08_conquista_titulo_no_juiz_moldura_na_vitrine_e_o_carimbo(self):
        campeao = ProvaDoTorneio.campeao8
        m = self.meu(campeao)
        self.assertEqual((m['conquistas'], m['moldura'], m['vigente']), ({'pvp': 1, 'guilda': 0}, True, True), m)
        # o título: a régua do juiz lê as conquistas do BANCO (contexto.arena), nunca do cliente
        status, r = self.titulo(campeao, 'Campeão da Arena')
        self.assertEqual(status, 200, r)
        self.assertEqual(self.save(campeao)['db']['jogador'].get('titulo'), 'Campeão da Arena', r.get('resultados'))
        status, r = self.titulo(campeao, 'Bicampeão da Arena')
        self.assertEqual((status, r['resultados'][0].get('ok')), (200, False), 'com UMA conquista o segundo degrau não entra')
        outro = self.conta('Sem Titulo', 22)
        status, r = self.titulo(outro, 'Campeão da Arena')
        self.assertEqual((status, r['resultados'][0].get('ok')), (200, False), r)
        status, r = self.titulo(outro, 'Campeão das Guildas')
        self.assertEqual((status, r['resultados'][0].get('ok')), (200, False), r)
        # a moldura `arena` na vitrine de quem ganhou em chave de 8 ou 16 — e só dele
        status, r = campeao.pede('GET', '/api/loja/moldura')
        self.assertEqual(status, 200, r)
        self.assertIn('arena', r['molduras']['tem'])
        linha = next(x for x in r['molduras']['todas'] if x['id'] == 'arena')
        self.assertEqual((linha['sku'], linha['nome'], linha['grau'], linha['marcas'], linha['conquistas']),
                         (None, 'Campeão da Arena', 1, 1, 1))
        status, r = campeao.pede('POST', '/api/loja/moldura', {'moldura': 'arena'})
        self.assertEqual((status, r['molduras']['escolhida']), (200, 'arena'), r)
        status, r = outro.pede('GET', '/api/loja/moldura')
        self.assertNotIn('arena', r['molduras']['tem'])
        self.assertNotIn('arena', [x['id'] for x in r['molduras']['todas']])
        status, r = outro.pede('POST', '/api/loja/moldura', {'moldura': 'arena'})
        self.assertEqual(status, 409, r)
        # o carimbo do Relé: `arena: {n, vigente}` sai do banco; o que a página inventou cai
        import rele_ident
        conta, definitivo = rele_ident.confere(self.banco_arq, campeao.token)
        self.assertTrue(definitivo)
        self.assertEqual((conta.get('arena'), conta.get('moldura')), ({'n': 1, 'vigente': True}, 'arena'), conta)
        env = {'t': 'oi', 'de': 'j1', 'nome': 'Fulano', 'titulo': 'Campeão da Arena', 'arena': {'n': 99, 'vigente': False}}
        saiu = rele_ident.carimba(env, conta, so_cache=True)
        self.assertEqual((saiu['arena'], saiu['moldura']), ({'n': 1, 'vigente': True}, 'arena'), saiu)
        conta2, _ = rele_ident.confere(self.banco_arq, outro.token)
        self.assertNotIn('arena', conta2)
        env = {'t': 'oi', 'de': 'j2', 'nome': 'Beltrano', 'arena': {'n': 5, 'vigente': True}, 'moldura': 'arena',
               'resumo': {'guilda': {'nome': 'Qualquer', 'emblema': '⚑', 'campea': True, 'titulos': 5}}}
        saiu = rele_ident.carimba(env, conta2, so_cache=True)
        self.assertNotIn('arena', saiu)
        self.assertEqual(saiu['moldura'], 'auto', 'a moldura que a conta não tem não viaja')
        self.assertEqual(sorted(saiu['resumo']['guilda']), ['emblema', 'nome'], 'a marca de campeã inventada cai')
        # chave de 4 conta como conquista mas NÃO dá a moldura; chave de 2 nem conquista
        tid = self.marca('pvp', '25-30')
        tres = [self.conta('Quatro', 27) for _ in range(3)]
        for c in tres:
            self.assertEqual(self.inscreve(c, tid)[0], 200)
        t = self.fecha_inscricoes(tid)
        self.assertEqual((t['chave']['tamanho'], t['premio']['barras'], t['premio']['conquista'], t['premio']['moldura']),
                         (4, 5, True, False))
        self.comeca(tid)
        fim = self.por_wo(tid, tres)
        c4 = next(c for c in tres if c.conta['id'] == fim['campeao']['conta'])
        m = self.meu(c4)
        self.assertEqual((m['conquistas']['pvp'], m['moldura'], m['vigente'], self.barras(c4)['saldo']), (1, False, True, 5))
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM loja_pedidos WHERE conta_id = ? AND sku = 'torneio'",
                                  c4.conta['id'])[0]['n'], 0, 'a chave de 4 não dá gema')
        # o vigente é por faixa: o campeão da 20-25 segue vigente depois de a 25-30 acabar
        self.assertTrue(self.meu(campeao)['vigente'])

    def test_09_partida_pronta_e_duelo_de_torneio(self):
        """Os dois presentes: a partida nasce PRONTA na Arena com o did do torneio. O duelo fecha pelo juiz, o
        vencedor leva a chave, e nem a Brasa nem a vida mudam — mesmo com os heróis a 0 PV na porta."""
        tid, a, b, did = self.dupla_na_final()
        self.assertTrue(did.startswith('torneio-'))
        ea = a.pede('GET', '/api/arena/estado')[1]
        eb = b.pede('GET', '/api/arena/estado')[1]
        self.assertEqual((ea['fase'], ea['did'], ea['torneio'], ea['lado'], ea['herois']), ('pronta', did, tid, 'A', DUPLA), ea)
        self.assertEqual((eb['fase'], eb['did'], eb['torneio'], eb['lado']), ('pronta', did, tid, 'B'), eb)
        self.assertEqual(ea['adversario']['conta'], b.conta['id'])
        self.assertEqual(self.T(tid)['chave']['rodadas'][0][0]['estado'], 'luta')
        ma = self.meu(a)['luta']
        self.assertEqual((ma['did'], ma['presente'], ma['elePresente']), (did, True, True))
        # a partida do torneio fica à mostra até a luta fechar (não só os 180 s da pronta do quadro)...
        self.sql("UPDATE arena_partidas SET pronta_ms = pronta_ms - 600000, criada_ms = criada_ms - 600000 WHERE did = ?", did)
        self.assertEqual(a.pede('GET', '/api/arena/estado')[1].get('torneio'), tid)
        # ...e sair do quadro da Arena não some com ela
        self.assertEqual(a.pede('POST', '/api/arena/sair', {})[1].get('torneio'), tid)
        # a vida única: os heróis de A estão a 0 PV e a luta do torneio abre assim mesmo, CHEIA
        agora_ms = self.agora_ms()
        for h in DUPLA:
            self.sql("INSERT OR REPLACE INTO vida_heroi(conta_id, heroi, hp_fim, hp_max, desde_ms) VALUES (?, ?, 0, 300, ?)",
                     a.conta['id'], h, agora_ms + 3600000)
        status, r = a.pede('POST', '/api/duelo/abrir', {'did': 'duelo-de-fora-%d' % tid, 'herois': DUPLA})
        self.assertEqual((status, r.get('motivo')), (409, 'vida-zero'), 'num duelo comum o herói a 0 PV barra')
        vidas_antes = self.sql("SELECT * FROM vida_heroi WHERE conta_id IN (?, ?) ORDER BY conta_id, heroi", a.conta['id'], b.conta['id'])
        for c in (a, b):
            status, r = c.pede('POST', '/api/duelo/abrir', {'did': did, 'herois': DUPLA})
            self.assertEqual((status, r.get('carry')), (200, None), r)
        jogo = sem = None
        for s in (999, 17, 41, 77, 123, 5):
            jogo, sem = self.joga(a, b, s), s
            if jogo['fase'] in ('won', 'lost'):
                break
        self.assertIn(jogo['fase'], ('won', 'lost'), 'nenhuma semente deu um duelo com vencedor')
        brasa_antes = (self.brasa(a), self.brasa(b))
        versoes = (self.save(a)['versao'], self.save(b)['versao'])
        # um terceiro não fecha; o lado B fecha: o juiz refaz e o vencedor avança
        status, r = self.conta('Plateia', 22).pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo, sem))
        self.assertEqual(status, 403, r)
        status, r = b.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo, sem))
        self.assertEqual(status, 200, r)
        self.assertEqual((r['fase'], r['ranqueado'], r['delta'], r.get('torneio'), r.get('motivo')),
                         (jogo['fase'], False, 0, tid, None), r)
        self.assertIn(r['venc'], ('A', 'B'))
        venc = a if r['venc'] == 'A' else b
        t = self.T(tid)
        final = t['chave']['rodadas'][0][0]
        self.assertEqual((t['estado'], final['estado'], final['vencedor'], final['como']),
                         ('encerrado', 'decidida', r['venc'].lower(), 'luta'), t)
        self.assertEqual(t['campeao']['conta'], venc.conta['id'])
        # a Brasa não muda, o estado não sobe de versão por causa do duelo, a vida fica como estava
        self.assertEqual((self.brasa(a), self.brasa(b)), brasa_antes)
        perdedor = b if venc is a else a
        self.assertEqual(self.save(perdedor)['versao'], versoes[0 if perdedor is a else 1])
        self.assertEqual(self.sql("SELECT * FROM vida_heroi WHERE conta_id IN (?, ?) ORDER BY conta_id, heroi",
                                  a.conta['id'], b.conta['id']), vidas_antes, 'a vida do fim NÃO grava')
        self.assertEqual(self.sql("SELECT venc FROM duelos WHERE did = ?", did)[0]['venc'], None, 'não conta nos tetos do dia')
        self.assertEqual(self.sql("SELECT estado FROM arena_partidas WHERE did = ?", did)[0]['estado'], 'jogada')
        self.assertEqual(a.pede('GET', '/api/arena/estado')[1]['fase'], 'livre')
        # o outro lado fecha o MESMO duelo: o guardado, e nada anda de novo
        status, r2 = a.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo, sem))
        self.assertEqual((status, r2['venc'], r2.get('torneio')), (200, r['venc'], tid), r2)
        # chave de 2: 2 barras, 600 vinténs, sem conquista
        self.assertEqual(self.barras(venc)['saldo'], 2)
        self.assertEqual(self.barras(perdedor)['saldo'], 0)
        self.assertEqual(self.meu(venc)['conquistas']['pvp'], 0, 'a chave de 2 não conta como conquista')
        self.assertEqual(json.loads(self.sql("SELECT entrega FROM loja_pedidos WHERE conta_id = ? AND sku = 'torneio-vintens'",
                                             venc.conta['id'])[0]['entrega'])['qtd'], 600)

    def test_10_revanche_e_o_sorteio_depois_dela(self):
        tid, a, b, did = self.dupla_na_final('25-30', 27)
        # o duelo fecha SEM vencedor (sincronizou por foto): UMA revanche — did novo, mais 3 minutos de chamada
        status, r = a.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, None, 999, fotografada=True))
        self.assertEqual((status, r['venc'], r['motivo']), (200, None, 'fotografada'), r)
        t = self.T(tid)
        final = t['chave']['rodadas'][0][0]
        self.assertEqual((t['estado'], final['estado'], final['vencedor']), ('andamento', 'chamada', None), t)
        ma = self.meu(a)['luta']
        self.assertEqual((ma['presente'], ma['elePresente'], ma['revanche']), (False, False, True), ma)
        self.assertNotIn('did', ma)
        self.assertTrue(170000 < ma['prazoMs'] - self.agora_ms() <= 180000)
        self.assertEqual(a.pede('GET', '/api/arena/estado')[1]['fase'], 'livre', 'a partida do did velho saiu da frente')
        self.presente(a, tid)
        did2 = self.presente(b, tid)['luta']['did']
        self.assertNotEqual(did2, did)
        self.assertEqual(b.pede('GET', '/api/arena/estado')[1].get('did'), did2)
        # fechar de novo o did VELHO não mexe na revanche
        status, r = b.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, None, 999, fotografada=True))
        self.assertEqual(status, 200, r)
        self.assertEqual(self.T(tid)['chave']['rodadas'][0][0]['estado'], 'luta')
        # a revanche também sem vencedor: decide por sorteio, e o torneio acaba
        status, r = b.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did2, None, 999, fotografada=True))
        self.assertEqual((status, r['venc']), (200, None), r)
        t = self.T(tid)
        final = t['chave']['rodadas'][0][0]
        self.assertEqual((t['estado'], final['estado'], final['como']), ('encerrado', 'decidida', 'sorteio'), t)
        self.assertIn(final['vencedor'], ('a', 'b'))
        self.assertEqual(len(self.sql("SELECT 1 FROM torneio_dids WHERE torneio_id = ?", tid)), 2)
        self.assertGreaterEqual(len(self.sql("SELECT 1 FROM eventos WHERE tipo = 'torneio-sem-vencedor' AND conta_id = ?",
                                             a.conta['id'])), 2, 'fica na trilha quem fechou sem vencedor')
        # a luta que passa de 30 minutos decide por sorteio
        tid, a, b, did = self.dupla_na_final('25-30', 28)
        self.sql("UPDATE torneio_lutas SET luta_ms = luta_ms - 1800001 WHERE torneio_id = ?", tid)
        t = self.T(tid)
        self.assertEqual((t['estado'], t['chave']['rodadas'][0][0]['como']), ('encerrado', 'sorteio'), t)
        self.assertEqual(self.sql("SELECT estado FROM arena_partidas WHERE did = ?", did)[0]['estado'], 'jogada')
        # o did de torneio fechado por fora do torneio (o modo errado) não dá vitória a ninguém: revanche
        tid, a, b, did = self.dupla_na_final('25-30', 29)
        jogo = self.joga(a, b, 999)
        status, r = a.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo, 999, modo='desafio'))
        self.assertEqual((status, r.get('motivo'), r.get('torneio')), (200, 'amistoso', None), r)
        self.assertEqual(self.T(tid)['chave']['rodadas'][0][0]['estado'], 'chamada')
        self.sql("UPDATE torneios SET estado = 'cancelado' WHERE id = ?", tid)

    def joga_cortado(self, a, b, corta=6, semente=999):
        """O duelo parado no meio (a IA joga os dois lados até `corta` lances e pára na vez de gente)."""
        sa, sb = self.save(a), self.save(b)
        jogo = roda_node([JOGADORES], {'modo': 'duelo', 'dungeonId': 'cistern', 'roomIndex': 0, 'semente': semente,
                                       'cortaEm': corta,
                                       'A': {'progress': sa['progress'], 'db': sa['db'], 'dono': 'ana', 'herois': DUPLA},
                                       'B': {'progress': sb['progress'], 'db': sb['db'], 'dono': 'bia', 'herois': DUPLA}})
        self.assertEqual(jogo['fase'], 'playing', 'o duelo cortado no meio não acabou')
        return jogo

    def abre_os_dois(self, a, b, did):
        for c in (a, b):
            status, r = c.pede('POST', '/api/duelo/abrir', {'did': did, 'herois': DUPLA})
            self.assertEqual(status, 200, r)

    def vidas(self, *contas):
        return self.sql("SELECT * FROM vida_heroi WHERE conta_id IN (%s) ORDER BY conta_id, heroi" % ','.join('?' * len(contas)),
                        *[c.conta['id'] for c in contas])

    def final_de(self, tid):
        return self.T(tid)['chave']['rodadas'][0][0]

    def test_10b_desistencia_wo_do_rele_e_o_replay_forjado(self):
        """Os outros desfechos do duelo, no did de um torneio: quem recebe a desistência ESPERA (e a vida não grava);
        a desistência declarada e o W.O. provado pelo relé dão a vitória (como 'desistencia' e 'wo') sem zerar a vida
        de ninguém nem mexer na Brasa; a espera que vence e o replay forjado (422) fecham SEM vencedor: revanche."""
        # 1. a desistência declarada
        tid, a, b, did = self.dupla_na_final('25-30', 26)
        self.abre_os_dois(a, b, did)
        jogo = self.joga_cortado(a, b)
        status, r = b.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo, 999))
        self.assertEqual((status, r['fase'], r.get('motivo')), (200, 'aguardando', 'desistencia'), r)
        self.assertEqual(self.vidas(a, b), [], 'esperando a declaração, a vida do replay NÃO grava no torneio')
        self.assertEqual(self.final_de(tid)['estado'], 'luta', 'e a chave espera')
        status, r = b.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo, 999, desistiu=True, lado='A'))
        self.assertEqual((status, r.get('motivo')), (403, 'desistencia-alheia'), r)
        status, r = a.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo, 999, desistiu=True, lado='A'))
        self.assertEqual((status, r['venc'], r['ranqueado'], r.get('fim'), r.get('torneio')), (200, 'B', False, 'desistencia', tid), r)
        final = self.final_de(tid)
        self.assertEqual((final['estado'], final['vencedor'], final['como']), ('decidida', 'b', 'desistencia'), final)
        self.assertEqual(self.T(tid)['campeao']['conta'], b.conta['id'])
        self.assertEqual(self.vidas(a, b), [], 'quem desiste do torneio não sai com os heróis a 0: a vida única fica como estava')
        self.assertEqual((self.brasa(a).get('partidas'), self.brasa(b).get('partidas')), (0, 0))
        # 2. o W.O. provado pelo relé (a queda da conta ausente depois de o duelo abrir, sem volta em 60 s)
        tid, a, b, did = self.dupla_na_final('25-30', 26)
        self.abre_os_dois(a, b, did)
        self.sql("UPDATE duelo_vida SET criado_em = criado_em - 300 WHERE did = ?", did)
        jogo = self.joga_cortado(a, b)
        self.sql("INSERT INTO rele_presenca(conta_id, evento, em_ms) VALUES (?, 'caiu', ?)", b.conta['id'], self.agora_ms() - 90000)
        status, r = a.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo, 999, wo=True))
        self.assertEqual((status, r['venc'], r['ranqueado'], r.get('fim'), r.get('torneio')), (200, 'A', False, 'wo', tid), r)
        final = self.final_de(tid)
        self.assertEqual((final['estado'], final['vencedor'], final['como']), ('decidida', 'a', 'wo'), final)
        self.assertEqual(self.vidas(a, b), [])
        # 3. o W.O. sem prova nenhuma não dá vitória: sem vencedor = revanche
        tid, a, b, did = self.dupla_na_final('25-30', 26)
        self.abre_os_dois(a, b, did)
        self.sql("UPDATE duelo_vida SET criado_em = criado_em - 300 WHERE did = ?", did)
        jogo = self.joga_cortado(a, b)
        self.sql("INSERT INTO rele_presenca(conta_id, evento, em_ms) VALUES (?, 'caiu', ?)", b.conta['id'], self.agora_ms() - 90000)
        self.sql("INSERT INTO rele_presenca(conta_id, evento, em_ms) VALUES (?, 'voltou', ?)", b.conta['id'], self.agora_ms() - 80000)
        status, r = a.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo, 999, wo=True))
        self.assertEqual((status, r['venc'], r.get('motivo'), r.get('torneio')), (200, None, 'wo-sem-prova', tid), r)
        final = self.final_de(tid)
        self.assertEqual((final['estado'], final['vencedor']), ('chamada', None), 'o W.O. que o relé não prova abre a revanche')
        self.assertEqual(self.vidas(a, b), [])
        self.sql("UPDATE torneios SET estado = 'cancelado' WHERE id = ?", tid)
        # 4. a espera pela declaração que vence (120 s): fecha sem vencedor = revanche
        tid, a, b, did = self.dupla_na_final('25-30', 26)
        self.abre_os_dois(a, b, did)
        jogo = self.joga_cortado(a, b)
        status, r = b.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo, 999))
        self.assertEqual((status, r['fase']), (200, 'aguardando'), r)
        self.sql("UPDATE duelo_espera SET primeiro_ms = primeiro_ms - 121000 WHERE did = ?", did)
        status, r = b.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo, 999))
        self.assertEqual((status, r['venc'], r.get('fim')), (200, None, 'sem-confirmacao'), r)
        self.assertEqual(self.final_de(tid)['estado'], 'chamada')
        self.sql("UPDATE torneios SET estado = 'cancelado' WHERE id = ?", tid)
        # 5. o replay forjado: o juiz recusa (422), o duelo fica 'recusado' — ninguém vence por ele: revanche
        tid, a, b, did = self.dupla_na_final('25-30', 26)
        self.abre_os_dois(a, b, did)
        jogo = self.joga_cortado(a, b)
        status, r = a.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo, 999, desistiu=True,
                                                                          hashFinal=(jogo['hash'] + 1) % (2 ** 32)))
        self.assertEqual(status, 422, r)
        final = self.final_de(tid)
        self.assertEqual((final['estado'], final['vencedor']), ('chamada', None), final)
        ev = self.sql("SELECT dados FROM eventos WHERE tipo = 'torneio-sem-vencedor' AND conta_id = ? ORDER BY id DESC LIMIT 1",
                      b.conta['id'])
        self.assertEqual(json.loads(ev[0]['dados']).get('por'), a.conta['id'], 'fica na trilha QUEM fechou sem vencedor')
        self.sql("UPDATE torneios SET estado = 'cancelado' WHERE id = ?", tid)

    def test_11_sair_depois_do_fechamento_e_wo(self):
        tid = self.marca('pvp', '20-25')
        contas = [self.conta('Desiste', 22) for _ in range(4)]
        de = {c.conta['id']: c for c in contas}
        for c in contas:
            self.assertEqual(self.inscreve(c, tid)[0], 200)
        t = self.fecha_inscricoes(tid)
        self.assertEqual(t['chave']['tamanho'], 4)
        l0, l1 = t['chave']['rodadas'][0]
        fujao = de[l0['a']['conta']]
        # antes do início: a desistência fica anotada e a luta dele cai por W.O. assim que é chamada
        status, r = fujao.pede('POST', '/api/torneio/sair', {'torneio': tid})
        self.assertEqual(status, 200, r)
        t = self.comeca(tid)
        l0 = t['chave']['rodadas'][0][0]
        self.assertEqual((l0['estado'], l0['vencedor'], l0['como']), ('decidida', 'b', 'wo'), l0)
        # no meio da luta: os dois presentes, um sai — o outro vence por W.O. e a partida some
        x, y = de[l1['a']['conta']], de[l1['b']['conta']]
        self.presente(x, tid)
        did = self.presente(y, tid)['luta']['did']
        status, r = y.pede('POST', '/api/torneio/sair', {'torneio': tid})
        self.assertEqual(status, 200, r)
        l1 = r['torneio']['chave']['rodadas'][0][1]
        self.assertEqual((l1['estado'], l1['vencedor'], l1['como']), ('decidida', 'a', 'wo'), l1)
        self.assertEqual(self.sql("SELECT estado FROM arena_partidas WHERE did = ?", did)[0]['estado'], 'jogada')
        self.assertEqual(self.conta('De Fora', 22).pede('POST', '/api/torneio/sair', {'torneio': tid})[1].get('motivo'),
                         'sem-inscricao')
        self.sql("UPDATE torneios SET estado = 'cancelado' WHERE id = ?", tid)

    # -- o torneio de guilda ------------------------------------------------------------------
    def guilda(self, nome, lider, membros=()):
        status, r = lider.pede('POST', '/api/guilda/criar', {'nome': nome, 'emblema': '⚔'})
        self.assertEqual(status, 200, r)
        gid = r['guilda']['id']
        for m in membros:
            status, r = m.pede('POST', '/api/guilda/entrar', {'gid': gid})
            self.assertEqual(status, 200, r)
        return gid

    def voluntaria(self, c, tid, herois=None):
        return c.pede('POST', '/api/torneio/voluntariar', {'torneio': tid, 'herois': herois or DUPLA})

    def test_12_torneio_de_guilda(self):
        ProvaDoTorneio._n += 1
        k = ProvaDoTorneio._n
        tid = self.marca('guilda', None)
        # três guildas: Lobos (líder, oficial, dois membros), Corvos (líder e um membro), Ursos (só o líder)
        lobo, oficial, m1, m2 = (self.conta('Lobo Chefe', 24), self.conta('Lobo Vice', 22), self.conta('Lobo Um', 28),
                                 self.conta('Lobo Dois', 26))
        corvo, c1 = self.conta('Corvo Chefe', 21), self.conta('Corvo Um', 29)
        urso = self.conta('Urso Chefe', 25)
        g_lobos = self.guilda('Lobos %d' % k, lobo, (oficial, m1, m2))
        g_corvos = self.guilda('Corvos %d' % k, corvo, (c1,))
        g_ursos = self.guilda('Ursos %d' % k, urso)
        status, r = lobo.pede('POST', '/api/guilda/cargo', {'conta': oficial.conta['id'], 'cargo': 'oficial'})
        self.assertEqual(status, 200, r)
        # quem não tem guilda não se voluntaria; fora de 20 a 30 também não; o Mestre não
        status, r = self.voluntaria(self.conta('Sem Guilda', 22), tid)
        self.assertEqual((status, r.get('motivo')), (409, 'sem-guilda'), r)
        self.assertEqual(self.voluntaria(self.mestre(), tid)[1].get('motivo'), 'mestre')
        novato = self.conta('Lobo Novato', 12)
        self.assertEqual(novato.pede('POST', '/api/guilda/entrar', {'gid': g_lobos})[0], 200)
        status, r = self.voluntaria(novato, tid)
        self.assertEqual((status, r.get('motivo'), r.get('nivelMin'), r.get('nivelMax')), (409, 'nivel', 20, 30), r)
        # os voluntários: a guilda aparece no torneio com o de MAIOR nível (o padrão) e as vagas contam GUILDAS
        status, r = self.voluntaria(m2, tid)
        self.assertEqual(status, 200, r)
        self.assertEqual((r['torneio']['vagas'], [i['conta'] for i in r['torneio']['inscritos']]), (2, [m2.conta['id']]), r)
        self.assertEqual(r['torneio']['inscritos'][0]['guilda'], {'id': g_lobos, 'nome': 'Lobos %d' % k, 'emblema': '⚔'})
        self.assertEqual((r['guilda']['torneio'], r['guilda']['souVoluntario'], r['guilda']['possoEscolher'],
                          r['guilda']['representante']), (tid, True, False, None), r['guilda'])
        self.assertEqual(self.voluntaria(m1, tid)[0], 200)
        self.assertEqual(self.voluntaria(lobo, tid)[0], 200)
        t = self.T(tid)
        self.assertEqual([i['conta'] for i in t['inscritos']], [m1.conta['id']], 'sem escolha, vai o voluntário de maior nível')
        self.assertEqual(t['vagas'], 2, 'três voluntários da MESMA guilda são uma vaga só')
        self.assertNotEqual(self.meu(lobo)['guilda']['torneio'], tid, 'sem dizer qual, o bloco fala do de guilda mais próximo (o da semana)')
        g = lobo.pede('GET', '/api/torneio/meu?torneio=%d' % tid)[1]['guilda']
        self.assertEqual(([v['conta'] for v in g['voluntarios']], g['possoEscolher'], g['souVoluntario']),
                         ([m2.conta['id'], m1.conta['id'], lobo.conta['id']], True, True), g)
        self.assertEqual((g['voluntarios'][1]['nivel'], [c['classId'] for c in g['voluntarios'][1]['classes']]), (28, DUPLA))
        # a escolha é do líder ou de um oficial, e só entre os voluntários da própria guilda
        status, r = m1.pede('POST', '/api/torneio/representante', {'torneio': tid, 'conta': m2.conta['id']})
        self.assertEqual((status, r.get('motivo')), (403, 'cargo'), r)
        status, r = oficial.pede('POST', '/api/torneio/representante', {'torneio': tid, 'conta': corvo.conta['id']})
        self.assertEqual((status, r.get('motivo')), (409, 'sem-voluntario'), r)
        status, r = oficial.pede('POST', '/api/torneio/representante', {'torneio': tid, 'conta': m2.conta['id']})
        self.assertEqual(status, 200, r)
        self.assertEqual((r['guilda']['representante'], [i['conta'] for i in r['torneio']['inscritos']]),
                         (m2.conta['id'], [m2.conta['id']]), r)
        # `conta: null` desfaz a escolha (volta o padrão); o líder escolhe de novo
        status, r = lobo.pede('POST', '/api/torneio/representante', {'torneio': tid, 'conta': None})
        self.assertEqual((status, r['guilda']['representante'], r['torneio']['inscritos'][0]['conta']),
                         (200, None, m1.conta['id']), r)
        status, r = lobo.pede('POST', '/api/torneio/representante', {'torneio': tid, 'conta': m2.conta['id']})
        self.assertEqual(status, 200, r)
        # o escolhido que se desvoluntaria deixa a guilda com o padrão; depois volta e é escolhido de novo
        status, r = m2.pede('POST', '/api/torneio/desvoluntariar', {'torneio': tid})
        self.assertEqual((status, r['guilda']['souVoluntario'], r['torneio']['inscritos'][0]['conta']), (200, False, m1.conta['id']), r)
        self.assertEqual(self.voluntaria(m2, tid)[0], 200)
        self.assertEqual(lobo.pede('POST', '/api/torneio/representante', {'torneio': tid, 'conta': m2.conta['id']})[0], 200)
        # as outras guildas: Corvos sem escolha (vai o de nível 29); Ursos com o líder; as vagas dobram
        self.assertEqual(self.voluntaria(corvo, tid)[0], 200)
        self.assertEqual(self.voluntaria(c1, tid)[0], 200)
        status, r = self.voluntaria(urso, tid)
        self.assertEqual((status, r['torneio']['vagas'], len(r['torneio']['inscritos'])), (200, 4, 3), r)
        self.assertEqual(r['torneio']['premio']['xpGuilda'], 150)
        # o fechamento: uma vaga por guilda, cada uma com o representante dela
        t = self.fecha_inscricoes(tid)
        self.assertEqual((t['estado'], t['chave']['tamanho']), ('sorteado', 4), t)
        self.assertEqual({i['conta']: i['guilda']['id'] for i in t['inscritos']},
                         {m2.conta['id']: g_lobos, c1.conta['id']: g_corvos, urso.conta['id']: g_ursos})
        pessoas = [l[k2] for l in t['chave']['rodadas'][0] for k2 in 'ab' if l[k2]]
        self.assertTrue(all(p['guilda'] and p['guilda']['id'] in (g_lobos, g_corvos, g_ursos) for p in pessoas), pessoas)
        self.assertEqual(lobo.pede('GET', '/api/torneio/meu?torneio=%d' % tid)[1]['guilda']['representante'], m2.conta['id'])
        status, r = self.voluntaria(oficial, tid)
        self.assertEqual((status, r.get('motivo')), (409, 'fechado'), r)
        # os Lobos vencem (por W.O.): o representante leva o prêmio da chave de 4 e o título; a guilda, o XP e o dobro
        xp_antes = self.sql("SELECT xp FROM guildas WHERE id = ?", g_lobos)[0]['xp']
        self.comeca(tid)
        fim = self.por_wo(tid, [m2, c1, urso], m2)
        self.assertEqual((fim['campeao']['conta'], fim['campeao']['guilda']['id']), (m2.conta['id'], g_lobos), fim['campeao'])
        self.assertEqual(self.sql("SELECT xp FROM guildas WHERE id = ?", g_lobos)[0]['xp'], xp_antes + 150)
        self.assertEqual(self.barras(m2)['saldo'], 5)
        m = self.meu(m2)
        self.assertEqual((m['conquistas'], m['moldura'], m['vigente']), ({'pvp': 0, 'guilda': 1}, False, False), m)
        status, r = self.titulo(m2, 'Campeão das Guildas')
        self.assertEqual(status, 200, r)
        self.assertEqual(self.save(m2)['db']['jogador'].get('titulo'), 'Campeão das Guildas', r.get('resultados'))
        status, r = self.titulo(lobo, 'Campeão das Guildas')
        self.assertEqual(r['resultados'][0].get('ok'), False, 'o título é do REPRESENTANTE, não da guilda inteira')
        # a ficha da guilda e o XP EM DOBRO por 7 dias: o fator próprio vai no contexto do juiz de TODO membro
        status, r = oficial.pede('GET', '/api/guilda/minha')
        self.assertEqual(status, 200, r)
        tg = r['guilda']['torneio']
        self.assertEqual((tg['campea'], tg['titulos'], tg['fatorXp']), (True, 1, 2), tg)
        self.assertTrue(abs(tg['xpDobroAteMs'] - (self.agora_ms() + 7 * DIA_MS)) < 120000, tg)
        self.assertEqual(corvo.pede('GET', '/api/guilda/minha')[1]['guilda']['torneio'],
                         {'campea': False, 'titulos': 0, 'fatorXp': 1, 'xpDobroAteMs': 0})
        import api as modulo_api
        espelho = modulo_api.Api(self.banco_arq)           # o mesmo banco, noutra conexão: só para ler o contexto do juiz
        try:
            agora = int(time.time())
            for c in (lobo, oficial, m1, m2, novato):
                self.assertEqual(espelho._guilda_contexto(c.conta['id'], agora).get('fatorXp'), 2, c.conta)
            self.assertNotIn('fatorXp', espelho._guilda_contexto(corvo.conta['id'], agora))
            self.assertNotIn('fatorXp', espelho._guilda_contexto(self.conta('Avulso', 22).conta['id'], agora))
            self.assertEqual(espelho._guilda_contexto(m1.conta['id'], agora + 7 * 86400 + 60).get('fatorXp'), None,
                             'passados os 7 dias o dobro acaba')
            self.assertEqual(espelho._torneio_conquistas(m2.conta['id']), {'pvp': 0, 'guilda': 1})
        finally:
            espelho.con.close()
        # o carimbo do Relé na guilda do perfil: `campea` e `titulos`, só na guilda em que a conta está
        import rele_ident
        conta, _ = rele_ident.confere(self.banco_arq, m1.token)
        self.assertEqual(conta.get('guildaTorneio'), {'nome': 'Lobos %d' % k, 'campea': True, 'titulos': 1}, conta)
        env = {'t': 'oi', 'de': 'j3', 'nome': 'Lobo', 'resumo': {'guilda': {'nome': 'Lobos %d' % k, 'emblema': '⚔'}}}
        saiu = rele_ident.carimba(env, conta, so_cache=True)
        self.assertEqual((saiu['resumo']['guilda'].get('campea'), saiu['resumo']['guilda'].get('titulos')), (True, 1), saiu)
        env = {'t': 'oi', 'de': 'j3', 'nome': 'Lobo', 'resumo': {'guilda': {'nome': 'Corvos %d' % k, 'emblema': '⚔'}}}
        saiu = rele_ident.carimba(env, conta, so_cache=True) or env
        self.assertNotIn('campea', saiu['resumo']['guilda'], 'vestindo o nome de OUTRA guilda a marca não sai')
        self.assertNotIn('titulos', saiu['resumo']['guilda'])
        conta_c, _ = rele_ident.confere(self.banco_arq, corvo.token)
        self.assertNotIn('guildaTorneio', conta_c)
        # a plateia anuncia o campeão com a guilda
        dados = json.loads(self.sql("SELECT dados FROM plateia WHERE tipo = 'torneio' AND conta_id = ? ORDER BY id DESC LIMIT 1",
                                    m2.conta['id'])[0]['dados'])
        self.assertEqual((dados['torneio'], dados['tipo'], dados['tamanho'], dados['guilda']), (tid, 'guilda', 4, 'Lobos %d' % k))

    def test_13_guilda_da_equipe_fica_de_fora_e_guilda_sem_voluntario_nao_entra(self):
        ProvaDoTorneio._n += 1
        k = ProvaDoTorneio._n
        tid = self.marca('guilda', None)
        gm = self.mestre()
        status, r = gm.pede('POST', '/api/guilda/criar', {'nome': 'Bastidores %d' % k})
        if status == 409:                                   # o Mestre já tem a guilda dele de outra prova
            g_equipe = gm.pede('GET', '/api/guilda/minha')[1]['guilda']['id']
        else:
            self.assertEqual(status, 200, r)
            g_equipe = r['guilda']['id']
        ajudante = self.conta('Ajudante', 25)
        self.sql("INSERT OR REPLACE INTO guilda_membros(conta_id, guilda_id, cargo, entrou_em) VALUES (?, ?, 'membro', ?)",
                 ajudante.conta['id'], g_equipe, int(time.time()))
        status, r = self.voluntaria(ajudante, tid)
        self.assertEqual((status, r.get('motivo')), (403, 'equipe'), r)
        # duas guildas, só uma com voluntário: menos de 2 representantes = cancelado
        a, b = self.conta('Tigre Chefe', 23), self.conta('Garça Chefe', 23)
        self.guilda('Tigres %d' % k, a)
        self.guilda('Garças %d' % k, b)
        self.assertEqual(self.voluntaria(a, tid)[0], 200)
        t = self.fecha_inscricoes(tid)
        self.assertEqual(t['estado'], 'cancelado', t)


if __name__ == '__main__':
    unittest.main(verbosity=2)
