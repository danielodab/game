#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova do QUADRO DA ARENA no servidor (servidor/arena.py), com o JUIZ de verdade (14/09).

    python tests/arena_api.py

Sobe o juiz (servidor/juiz/juiz.js) e a API com --juiz num banco descartável. Cobre: inscrever (os heróis da
conta, os DOIS quando a conta tem dois, em ordem; nenhum a 0 PV; o nível do mais forte no estado do servidor),
o quadro público (as classes de cada inscrito), desafiar com diferença de nível até 5 (e não com 6), a vida do
inscrito, confirmar (os dois = pronta com did; o inscrito é o lado A), recusar e o prazo de 30 s (o inscrito
volta ao quadro com o lugar de antes, quem desafiou fica livre), sair, e a inscrição parada que some do quadro.
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
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402
from autoridade_api import BAIXA, ESTADO_JS, JUIZ, NODE, espera_url, roda_node  # noqa: E402


class ProvaDaArena(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls):
        if NODE is None:
            raise unittest.SkipTest('sem node nesta máquina: o juiz não sobe')
        cls.pasta = tempfile.mkdtemp(prefix='soterra-arena-')
        cls.banco_arq = os.path.join(cls.pasta, 'dados', 'soterra.db')
        cls.procs, cls.logs = [], []
        try:
            porta_juiz = porta_livre()
            cls.juiz = 'http://127.0.0.1:%d' % porta_juiz
            pj = cls._processo('juiz', [NODE, JUIZ, '--porta', str(porta_juiz)])
            if not espera_url(cls.juiz + '/saude', pj):
                raise RuntimeError('o juiz não subiu; veja ' + cls.pasta)
            codigo = ("const est = require(process.argv[1]); const w = est.mundoEconomico({}); est.poeEstado(w, null, null);"
                      "const s = est.tiraEstado(w);"
                      "process.stdout.write(JSON.stringify({progress: s.progress, db: s.db, xp: w.J.DATA.leveling.xpTable}));")
            cls.inicial = roda_node(['-e', codigo, ESTADO_JS])
            env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
            porta = porta_livre()
            p = cls._processo('api', [sys.executable, API, '--porta', str(porta), '--banco', cls.banco_arq,
                                      '--juiz', cls.juiz], env)
            cls.base = 'http://127.0.0.1:%d' % porta
            if not espera_api(cls.base, p, 30):
                raise RuntimeError('a API não subiu; veja ' + cls.pasta)
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
        b = sqlite3.connect(self.banco_arq)
        b.row_factory = sqlite3.Row
        try:
            linhas = [dict(r) for r in b.execute(consulta, args).fetchall()]
            b.commit()
            return linhas
        finally:
            b.close()

    def limpa(self):
        """Cada prova começa com o quadro e as partidas vazios."""
        self.sql("DELETE FROM arena_inscritos")
        self.sql("DELETE FROM arena_partidas")

    def conta(self, apelido, niveis):
        """Uma conta com o estado no servidor e os heróis `niveis` = {heroId: nível}."""
        ProvaDaArena._n += 1
        c = Cliente(self.base)
        status, r = c.cadastra('%s %d' % (apelido, ProvaDaArena._n))
        self.assertEqual(status, 201, r)
        p, d = copy.deepcopy(self.inicial['progress']), copy.deepcopy(self.inicial['db'])
        for heroi, nivel in niveis.items():
            p['heroes'][heroi]['level'] = nivel
            p['heroes'][heroi]['xp'] = self.inicial['xp'][nivel - 1]
        status, r = c.salva(0, p, d)
        self.assertEqual(status, 200, r)
        return c

    def inscreve(self, c, herois=('sumo', 'curandeiro')):
        return c.pede('POST', '/api/arena/inscrever', {'herois': list(herois)})

    def desafia(self, c, alvo, herois=('sumo', 'curandeiro')):
        return c.pede('POST', '/api/arena/desafiar', {'alvo': alvo.conta['id'], 'herois': list(herois)})

    def estado(self, c):
        status, r = c.pede('GET', '/api/arena/estado')
        self.assertEqual(status, 200, r)
        return r

    def quadro(self, c):
        status, r = c.pede('GET', '/api/arena/quadro')
        self.assertEqual(status, 200, r)
        return r

    # -- as provas ----------------------------------------------------------------------------
    def test_01_inscrever_confere(self):
        self.limpa()
        ana = self.conta('Ana Quadro', {'sumo': 12, 'curandeiro': 7})
        self.assertEqual(self.estado(ana)['fase'], 'livre')
        casos = [({'herois': []}, 400), ({'herois': ['nada', 'sumo']}, 400), ({'herois': 'sumo'}, 400),
                 ({'herois': ['sumo', 'sumo']}, 400), ({'herois': ['sumo', 'curandeiro', 'bruxo']}, 400)]
        for corpo, esperado in casos:
            status, r = ana.pede('POST', '/api/arena/inscrever', corpo)
            self.assertEqual(status, esperado, (corpo, r))
        # 14/09 (o dono): "esse ele pré-seleciona as duas classes já"
        status, r = self.inscreve(ana, ['sumo'])
        self.assertEqual((status, r.get('motivo')), (400, 'dois'), r)
        sem = Cliente(self.base)
        ProvaDaArena._n += 1
        sem.cadastra('Sem Estado Quadro %d' % ProvaDaArena._n)
        self.assertEqual(self.inscreve(sem)[0], 409)
        antes = int(time.time() * 1000)
        status, r = self.inscreve(ana, ['curandeiro', 'sumo'])
        self.assertEqual(status, 200, r)
        self.assertEqual((r['fase'], r['herois'], r['nivel']), ('inscrito', ['curandeiro', 'sumo'], 12),
                         'a ordem da escolha fica, e o nível é o do herói MAIS FORTE no estado do servidor')
        self.assertEqual([c['classId'] for c in r['classes']], ['curandeiro', 'sumo'])
        self.assertEqual([c['nivel'] for c in r['classes']], [7, 12])
        self.assertGreaterEqual(r['desdeMs'], antes - 5)
        time.sleep(0.05)
        status, r2 = self.inscreve(ana)
        self.assertEqual((status, r2['desdeMs'], r2['herois']), (200, r['desdeMs'], ['sumo', 'curandeiro']),
                         'inscrever de novo troca a dupla sem perder o lugar')
        q = self.quadro(ana)
        self.assertEqual(len(q['inscritos']), 1)
        self.assertEqual((q['paridade'], q['inscritos'][0]['eu'], q['inscritos'][0]['nome']), (5, True, ana.conta['nome']))
        status, r = ana.pede('POST', '/api/arena/sair', {})
        self.assertEqual((status, r['fase']), (200, 'livre'))
        self.assertEqual((self.estado(ana)['fase'], self.quadro(ana)['inscritos']), ('livre', []))

    def test_02_vida_zero_recusa(self):
        self.limpa()
        ana = self.conta('Ana Caida', {'sumo': 10, 'curandeiro': 10})
        bia = self.conta('Bia Caida', {'sumo': 10, 'curandeiro': 10})
        agora_ms = int(time.time() * 1000)
        self.sql("INSERT INTO vida_heroi(conta_id, heroi, hp_fim, hp_max, desde_ms, cura) VALUES (?, 'curandeiro', 0, 90, ?, 0)",
                 ana.conta['id'], agora_ms)
        status, r = self.inscreve(ana)
        self.assertEqual((status, r.get('motivo')), (409, 'vida-zero'), r)
        self.sql("UPDATE vida_heroi SET hp_fim = 5 WHERE conta_id = ?", ana.conta['id'])
        self.assertEqual(self.inscreve(ana)[1].get('fase'), 'inscrito', 'ferido mas de pé entra')
        # o inscrito caiu depois de inscrito (voltou de outra luta a 0): ninguém o desafia até ele ficar de pé
        self.sql("UPDATE vida_heroi SET hp_fim = 0, desde_ms = ? WHERE conta_id = ?", int(time.time() * 1000), ana.conta['id'])
        status, r = self.desafia(bia, ana)
        self.assertEqual((status, r.get('motivo')), (409, 'vida-zero-alvo'), r)
        # e quem desafia também precisa estar de pé
        self.sql("UPDATE vida_heroi SET hp_fim = 50 WHERE conta_id = ?", ana.conta['id'])
        self.sql("INSERT INTO vida_heroi(conta_id, heroi, hp_fim, hp_max, desde_ms, cura) VALUES (?, 'sumo', 0, 90, ?, 0)",
                 bia.conta['id'], int(time.time() * 1000))
        status, r = self.desafia(bia, ana)
        self.assertEqual((status, r.get('motivo')), (409, 'vida-zero'), r)

    def test_03_quadro_e_paridade(self):
        self.limpa()
        ana = self.conta('Ana Nivel', {'sumo': 20, 'curandeiro': 3})
        bia = self.conta('Bia Nivel', {'sumo': 14, 'curandeiro': 14})       # 6 abaixo: não desafia
        cris = self.conta('Cris Nivel', {'sumo': 3, 'curandeiro': 15})      # 5 abaixo: desafia
        self.assertEqual(self.inscreve(ana)[0], 200)
        q = self.quadro(bia)
        linha = q['inscritos'][0]
        self.assertEqual((linha['conta'], linha['nivel'], linha['eu'], linha['brasa']),
                         (ana.conta['id'], 20, False, self.inicial['db']['jogador']['brasa']['pts']))
        self.assertEqual(linha['classes'], [{'classId': 'sumo', 'nivel': 20}, {'classId': 'curandeiro', 'nivel': 3}],
                         'quem vai desafiar vê as duas classes do inscrito')
        status, r = self.desafia(bia, ana)
        self.assertEqual((status, r.get('motivo'), r.get('nivel'), r.get('nivelDele')), (409, 'paridade', 14, 20), r)
        self.assertEqual(self.desafia(ana, ana)[0], 400, 'a própria inscrição não se desafia')
        self.assertEqual(self.desafia(bia, cris)[1].get('motivo'), 'sem-inscricao')
        status, r = self.desafia(cris, ana, ['curandeiro', 'sumo'])
        self.assertEqual((status, r['fase'], r['papel'], r['lado']), (200, 'casada', 'desafiante', 'B'), r)
        self.assertEqual(r['adversario']['classes'][0], {'classId': 'sumo', 'nivel': 20})
        ea = self.estado(ana)
        self.assertEqual((ea['fase'], ea['papel'], ea['lado'], ea['confirmei'], ea['eleConfirmou']),
                         ('casada', 'inscrito', 'A', False, False))
        self.assertEqual((ea['adversario']['nome'], ea['adversario']['nivel'], ea['adversario']['herois']),
                         (cris.conta['nome'], 15, ['curandeiro', 'sumo']), 'as classes de quem desafia aparecem ao inscrito')
        self.assertTrue(0 < ea['prazoMs'] - ea['agoraMs'] <= 30000, ea)
        self.assertNotIn('did', ea, 'o did só aparece com a partida pronta')
        self.assertEqual(self.quadro(bia)['inscritos'], [], 'o inscrito desafiado sai do quadro')
        self.assertEqual(self.inscreve(ana)[1].get('motivo'), 'casada')
        # quem está inscrito não desafia outro
        self.assertEqual(self.inscreve(bia)[0], 200)
        dani = self.conta('Dani Nivel', {'sumo': 14, 'curandeiro': 14})
        self.inscreve(dani)
        self.assertEqual(self.desafia(bia, dani)[1].get('motivo'), 'inscrito')

    def test_04_confirmar_os_dois_pronta(self):
        self.limpa()
        ana = self.conta('Ana Confirma', {'sumo': 8, 'curandeiro': 8})
        bia = self.conta('Bia Confirma', {'sumo': 9, 'curandeiro': 9})
        self.inscreve(ana)
        self.desafia(bia, ana)
        status, r = ana.pede('POST', '/api/arena/confirmar', {})
        self.assertEqual((status, r['fase'], r['confirmei']), (200, 'casada', True), r)
        self.assertTrue(self.estado(bia)['eleConfirmou'])
        status, rb = bia.pede('POST', '/api/arena/confirmar', {})
        self.assertEqual((status, rb['fase']), (200, 'pronta'), rb)
        ea = self.estado(ana)
        self.assertEqual((ea['fase'], ea['did'], ea['lado'], rb['lado']), ('pronta', rb['did'], 'A', 'B'))
        self.assertEqual((ea['herois'], ea['adversario']['herois']), (['sumo', 'curandeiro'], ['sumo', 'curandeiro']))
        self.assertRegex(ea['did'], r'^[A-Za-z0-9_:-]{8,64}$', 'o did serve para o POST /api/duelo/abrir')
        linha = self.sql("SELECT a_id, b_id, estado FROM arena_partidas WHERE did = ?", ea['did'])[0]
        self.assertEqual((linha['a_id'], linha['b_id'], linha['estado']), (ana.conta['id'], bia.conta['id'], 'pronta'))
        self.assertEqual(ana.pede('POST', '/api/arena/confirmar', {})[1]['fase'], 'pronta', 'confirmar de novo não muda')
        fora = self.conta('Fora Confirma', {'sumo': 8})
        status, r = fora.pede('POST', '/api/arena/confirmar', {})
        self.assertEqual((status, r.get('motivo')), (409, 'sem-partida'), r)

    def test_05_prazo_e_recusa_devolvem_o_inscrito(self):
        self.limpa()
        ana = self.conta('Ana Prazo', {'sumo': 8, 'curandeiro': 8})
        bia = self.conta('Bia Prazo', {'sumo': 8, 'curandeiro': 8})
        _, ra = self.inscreve(ana)
        self.desafia(bia, ana)
        bia.pede('POST', '/api/arena/confirmar', {})
        self.sql("UPDATE arena_partidas SET prazo_ms = ? WHERE estado = 'casada'", int(time.time() * 1000) - 1)
        ea = self.estado(ana)
        self.assertEqual((ea['fase'], ea['desdeMs']), ('inscrito', ra['desdeMs']),
                         'o prazo passou: o inscrito volta ao quadro com o lugar de antes')
        self.assertEqual(self.estado(bia)['fase'], 'livre', 'quem desafiou fica livre')
        # recusar faz o mesmo
        self.desafia(bia, ana)
        status, r = ana.pede('POST', '/api/arena/recusar', {})
        self.assertEqual((status, r['fase'], r['desdeMs']), (200, 'inscrito', ra['desdeMs']), r)
        self.assertEqual(self.estado(bia)['fase'], 'livre')

    def test_06_sair(self):
        self.limpa()
        ana = self.conta('Ana Sai', {'sumo': 8, 'curandeiro': 8})
        bia = self.conta('Bia Sai', {'sumo': 8, 'curandeiro': 8})
        self.inscreve(ana)
        self.desafia(bia, ana)
        self.assertEqual(bia.pede('POST', '/api/arena/sair', {})[1]['fase'], 'livre')
        self.assertEqual(self.estado(ana)['fase'], 'inscrito', 'quem desafiou desistiu: o inscrito volta ao quadro')
        self.desafia(bia, ana)
        ana.pede('POST', '/api/arena/sair', {})
        self.assertEqual((self.estado(ana)['fase'], self.estado(bia)['fase']), ('livre', 'livre'))
        self.assertEqual(self.quadro(bia)['inscritos'], [])

    def test_07_parado_some_do_quadro(self):
        self.limpa()
        ana = self.conta('Ana Parada', {'sumo': 8, 'curandeiro': 8})
        bia = self.conta('Bia Parada', {'sumo': 8, 'curandeiro': 8})
        self.inscreve(ana)
        self.sql("UPDATE arena_inscritos SET visto_ms = ?", int(time.time() * 1000) - 21000)
        self.assertEqual(self.quadro(bia)['inscritos'], [], 'a inscrição que não consulta há 20 s sai do quadro')
        self.assertEqual(self.estado(ana)['fase'], 'livre')

    def test_08_uma_conta_de_um_heroi_so(self):
        self.limpa()
        ana = self.conta('Ana Sozinha', {'sumo': 8})
        p = json.loads(self.sql("SELECT progress FROM saves WHERE conta_id = ?", ana.conta['id'])[0]['progress'])
        if len([h for h in p['heroes'] if h != 'gm']) >= 2:
            self.assertEqual(self.inscreve(ana, ['sumo'])[1].get('motivo'), 'dois')
            # a conta com um herói só (os outros tirados do estado no banco da prova) entra com um
            p['heroes'] = {'sumo': p['heroes']['sumo']}
            self.sql("UPDATE saves SET progress = ? WHERE conta_id = ?", json.dumps(p), ana.conta['id'])
        status, r = self.inscreve(ana, ['sumo'])
        self.assertEqual((status, r.get('fase')), (200, 'inscrito'), r)


if __name__ == '__main__':
    unittest.main(verbosity=2)
