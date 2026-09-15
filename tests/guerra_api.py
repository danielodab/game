#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova da GUERRA DE GUILDA 2×2 no servidor (servidor/guerra.py), com o JUIZ de verdade (15/09).

    python tests/guerra_api.py

Sobe o juiz (servidor/juiz/juiz.js) e a API com --juiz num banco descartável. Quatro contas por prova, duas guildas.
Cobre: inscrever (quem lidera, com o parceiro da MESMA guilda e os dois heróis em ordem; sem guilda, outra guilda,
um herói só e herói a 0 PV recusados), juntar (a inscrição só vale com as duas duplas), o casamento com a dupla de
OUTRA guilda, a mais antiga primeiro, dentro da paridade de 10 (e nunca na mesma guilda), a casada com as duplas dos
adversários OCULTAS, os QUATRO confirmando (pronta com gid, semente e a ata do juiz: oito heróis com o dono de cada e a
vida de cada um), o prazo (quem não confirmou sai, o lado inteiro que confirmou volta à fila com o lugar), a recusa,
fechar a vitória (a guilda vencedora ganha 40 XP, a contribuição dos dois, a vida dos oito gravada na conta de cada
um), idempotente por gid, o empate e o W.O. sem XP, os tetos (3 por par de guildas e 10 por guilda em 24 h), a forja
(lance fora da vez: 422 e guardado), rápido demais, fotografado e quem não lutou.
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
sys.path.insert(0, os.path.join(AQUI, '..', 'servidor'))
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402
from autoridade_api import BAIXA, ESTADO_JS, JUIZ, NODE, espera_url, roda_node  # noqa: E402
import guerra as guerra_mod  # noqa: E402

JOGA = os.path.join(AQUI, 'juiz_guerra.js')
DUPLA = ['sumo', 'curandeiro']


class ProvaDaGuerra(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls):
        if NODE is None:
            raise unittest.SkipTest('sem node nesta máquina: o juiz não sobe')
        cls.pasta = tempfile.mkdtemp(prefix='soterra-guerra-')
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

    def setUp(self):
        for t in ('guerra_inscricoes', 'guerra_jogadores', 'guerra_partidas', 'guerra_resultados', 'vida_heroi'):
            self.sql("DELETE FROM %s" % t)

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

    def conta(self, apelido, nivel=12):
        ProvaDaGuerra._n += 1
        c = Cliente(self.base)
        status, r = c.cadastra('%s %d' % (apelido, ProvaDaGuerra._n))
        self.assertEqual(status, 201, r)
        p, d = copy.deepcopy(self.inicial['progress']), copy.deepcopy(self.inicial['db'])
        for heroi in DUPLA:
            p['heroes'][heroi]['level'] = nivel
            p['heroes'][heroi]['xp'] = self.inicial['xp'][nivel - 1]
        status, r = c.salva(0, p, d)
        self.assertEqual(status, 200, r)
        c.dono = 'rede%d' % c.conta['id']
        return c

    def guilda(self, *membros):
        ProvaDaGuerra._n += 1
        status, r = membros[0].pede('POST', '/api/guilda/criar', {'nome': 'Clã %d' % ProvaDaGuerra._n, 'emblema': '⚔'})
        self.assertEqual(status, 200, r)
        gid = r['guilda']['id']
        for m in membros[1:]:
            status, r = m.pede('POST', '/api/guilda/entrar', {'gid': gid})
            self.assertEqual(status, 200, r)
        return gid

    def inscreve(self, lider, parceiro, herois=DUPLA):
        return lider.pede('POST', '/api/guerra/inscrever', {'parceiro': parceiro.conta['id'], 'herois': list(herois),
                                                           'dono': lider.dono})

    def junta(self, parceiro, herois=DUPLA):
        return parceiro.pede('POST', '/api/guerra/juntar', {'herois': list(herois), 'dono': parceiro.dono})

    def estado(self, c):
        status, r = c.pede('GET', '/api/guerra/estado')
        self.assertEqual(status, 200, r)
        return r

    def dupla_na_fila(self, lider, parceiro):
        s, r = self.inscreve(lider, parceiro)
        self.assertEqual(s, 200, r)
        s, r = self.junta(parceiro)
        self.assertEqual(s, 200, r)
        return r

    def casada(self, nivel_a=12, nivel_b=12):
        a1, a2 = self.conta('Ana', nivel_a), self.conta('Bia', nivel_a)
        b1, b2 = self.conta('Cris', nivel_b), self.conta('Duda', nivel_b)
        ga, gb = self.guilda(a1, a2), self.guilda(b1, b2)
        self.dupla_na_fila(a1, a2)
        r = self.dupla_na_fila(b1, b2)
        self.assertEqual(r['fase'], 'casada', r)
        return (a1, a2, b1, b2), (ga, gb)

    def pronta(self, **kw):
        js, gs = self.casada(**kw)
        for c in js:
            s, r = c.pede('POST', '/api/guerra/confirmar', {})
            self.assertEqual(s, 200, r)
        e = self.estado(js[0])
        for _ in range(20):
            if e.get('ata'):
                break
            time.sleep(0.2)
            e = self.estado(js[0])
        self.assertEqual(e['fase'], 'pronta', e)
        self.assertTrue(e.get('ata'), e)
        return js, gs, e

    def joga(self, ata, **op):
        return roda_node([JOGA, '--joga'], {'ata': ata, 'op': op}, tempo=300)

    def envelhece(self, gid):
        """o tempo mínimo (0,35 s por turno de gente) sem esperar de verdade"""
        self.sql("UPDATE guerra_partidas SET pronta_ms = pronta_ms - 3600000 WHERE gid = ?", gid)

    def fecha(self, c, gid, jogo, **extra):
        corpo = {'gid': gid, 'lances': jogo['lances'], 'hashFinal': jogo['hashFinal']}
        corpo.update(extra)
        return c.pede('POST', '/api/guerra/fechar', corpo)

    def xp(self, gid):
        return self.sql("SELECT xp FROM guildas WHERE id = ?", gid)[0]['xp']

    # -- as provas ----------------------------------------------------------------------------
    def test_01_inscrever_e_juntar(self):
        a1, a2, fora, outra = self.conta('Ana'), self.conta('Bia'), self.conta('Solo'), self.conta('Rival')
        s, r = self.inscreve(a1, a2)
        self.assertEqual((s, r.get('motivo')), (409, 'sem-guilda'), r)
        self.guilda(a1, a2)
        self.guilda(outra)
        s, r = self.inscreve(a1, outra)
        self.assertEqual((s, r.get('motivo')), (409, 'outra-guilda'), 'o parceiro é da mesma guilda')
        s, r = self.inscreve(a1, a1)
        self.assertEqual(s, 400, 'o parceiro é outra conta')
        s, r = self.inscreve(a1, a2, ['sumo'])
        self.assertEqual((s, r.get('motivo')), (400, 'dois'), 'quem tem dois leva os dois')
        s, r = self.junta(fora)
        self.assertEqual((s, r.get('motivo')), (409, 'sem-convite'), r)
        s, r = self.inscreve(a1, a2)
        self.assertEqual(s, 200, r)
        self.assertEqual((r['fase'], r['parceiro']['conta'], r['herois']), ('aguardando', a2.conta['id'], DUPLA))
        e = self.estado(a2)
        self.assertEqual((e['fase'], e['lider']['conta']), ('convite', a1.conta['id']))
        # a inscrição só vale com as duas duplas
        self.assertEqual(self.sql("SELECT desde_ms FROM guerra_inscricoes")[0]['desde_ms'], None)
        # herói a 0 PV não entra
        self.sql("INSERT INTO vida_heroi(conta_id, heroi, hp_fim, hp_max, desde_ms, cura) VALUES (?, 'sumo', 0, 100, ?, 0)",
                 a2.conta['id'], int(time.time() * 1000))
        s, r = self.junta(a2)
        self.assertEqual((s, r.get('motivo')), (409, 'vida-zero'), r)
        self.sql("DELETE FROM vida_heroi")
        s, r = self.junta(a2)
        self.assertEqual((s, r['fase']), (200, 'inscrito'), r)
        self.assertEqual(self.estado(a1)['fase'], 'inscrito')
        s, r = a2.pede('POST', '/api/guerra/sair', {})
        self.assertEqual((s, r['fase']), (200, 'livre'))
        self.assertEqual(self.estado(a1)['fase'], 'livre', 'sair desfaz a dupla de jogadores inteira')

    def test_02_casar_com_outra_guilda_na_paridade(self):
        a1, a2 = self.conta('Ana', 10), self.conta('Bia', 10)
        b1, b2, b3, b4 = self.conta('Cris', 21), self.conta('Duda', 21), self.conta('Eva', 21), self.conta('Fábio', 21)
        c1, c2 = self.conta('Gil', 20), self.conta('Hugo', 15)
        self.guilda(a1, a2)
        gb = self.guilda(b1, b2, b3, b4)
        self.guilda(c1, c2)
        self.assertEqual(self.dupla_na_fila(a1, a2)['fase'], 'inscrito')
        self.assertEqual(self.dupla_na_fila(b1, b2)['fase'], 'inscrito', '21 contra 10 passa da paridade')
        self.assertEqual(self.dupla_na_fila(b3, b4)['fase'], 'inscrito', 'a mesma guilda nunca casa consigo')
        r = self.dupla_na_fila(c1, c2)
        self.assertEqual(r['fase'], 'casada', 'o nível da dupla é o do herói mais forte dos quatro (20)')
        self.assertEqual(r['lado'], 'B')
        self.assertEqual(sorted(x['conta'] for x in r['adversarios']), sorted([a1.conta['id'], a2.conta['id']]),
                         'a mais antiga (Ana e Bia, nível 10: diferença de 10) casa primeiro')
        self.assertEqual(self.estado(b1)['fase'], 'inscrito')
        self.assertEqual(self.estado(b3)['fase'], 'inscrito')
        self.assertEqual(guerra_mod.GUERRA_PARIDADE, 10)

    def test_03_casada_oculta_e_os_quatro_confirmam(self):
        (a1, a2, b1, b2), (ga, gb) = self.casada()
        e = self.estado(a1)
        self.assertEqual((e['fase'], e['lado'], e['guildas']['B']['id']), ('casada', 'A', gb))
        self.assertEqual(sorted(x['nome'][:4] for x in e['adversarios']), ['Cris', 'Duda'])
        texto = json.dumps(e)
        self.assertNotIn('curandeiro', texto.replace(json.dumps(e['herois']), ''), 'as duplas dos adversários ficam ocultas')
        self.assertTrue(all('herois' not in x and 'classes' not in x for x in e['adversarios']))
        self.assertLessEqual(e['prazoMs'] - e['agoraMs'], guerra_mod.GUERRA_CONFIRMA_MS)
        self.sql("INSERT INTO vida_heroi(conta_id, heroi, hp_fim, hp_max, desde_ms, cura) VALUES (?, 'curandeiro', 7, 999, ?, 0)",
                 b2.conta['id'], int(time.time() * 1000))
        for c in (a1, a2, b1):
            s, r = c.pede('POST', '/api/guerra/confirmar', {})
            self.assertEqual((s, r['fase']), (200, 'casada'), r)
        self.assertTrue(self.estado(a1)['confirmei'])
        s, r = b2.pede('POST', '/api/guerra/confirmar', {})
        self.assertEqual(s, 200, r)
        e = self.estado(b2)
        for _ in range(20):
            if e.get('ata'):
                break
            time.sleep(0.2)
            e = self.estado(b2)
        self.assertEqual(e['fase'], 'pronta', e)
        self.assertRegex(e['gid'], r'^guerra-[0-9a-f]{20}$')
        self.assertIsInstance(e['semente'], int)
        ata = e['ata']
        self.assertEqual((ata['mapa'], ata['sala'], len(ata['A']), len(ata['B'])), ('sede', 0, 4, 4))
        self.assertEqual([p['dono'] for p in ata['A']], [a1.dono, a1.dono, a2.dono, a2.dono])
        self.assertEqual([p['dono'] for p in ata['B']], [b1.dono, b1.dono, b2.dono, b2.dono])
        self.assertEqual(ata['carry'], {b2.dono + ':curandeiro': 7}, 'a vida de cada herói, pela chave dono:heroId')
        self.assertEqual([j['dono'] for j in e['jogadores']], [a1.dono, a2.dono, b1.dono, b2.dono])

    def test_04_o_prazo_devolve_o_lado_que_confirmou(self):
        (a1, a2, b1, b2), _ = self.casada()
        desde = self.sql("SELECT desde_ms FROM guerra_jogadores WHERE conta_id = ?", a1.conta['id'])[0]['desde_ms']
        for c in (a1, a2, b1):
            c.pede('POST', '/api/guerra/confirmar', {})
        self.sql("UPDATE guerra_partidas SET prazo_ms = 1")
        e = self.estado(a1)
        self.assertEqual((e['fase'], e['desdeMs']), ('inscrito', desde), 'o lado que confirmou volta com o lugar de antes')
        self.assertEqual(self.estado(a2)['fase'], 'inscrito')
        self.assertEqual(self.estado(b1)['fase'], 'livre', 'o lado em que alguém não confirmou sai')
        self.assertEqual(self.estado(b2)['fase'], 'livre')

    def test_05_recusar(self):
        (a1, a2, b1, b2), _ = self.casada()
        s, r = b1.pede('POST', '/api/guerra/recusar', {})
        self.assertEqual((s, r['fase']), (200, 'livre'), r)
        self.assertEqual(self.estado(b2)['fase'], 'livre')
        self.assertEqual(self.estado(a1)['fase'], 'inscrito', 'o outro lado volta à fila')
        s, r = a1.pede('POST', '/api/guerra/confirmar', {})
        self.assertEqual((s, r.get('motivo')), (409, 'sem-partida'))

    def test_06_vitoria_da_xp_a_guilda_certa_e_grava_a_vida_dos_oito(self):
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        jogo = self.joga(e['ata'])
        self.assertIn(jogo['venc'], ('A', 'B'), jogo['fase'])
        gv, gp = (ga, gb) if jogo['venc'] == 'A' else (gb, ga)
        antes = (self.xp(gv), self.xp(gp))
        s, r = self.fecha(b1, e['gid'], jogo)
        self.assertEqual((s, r.get('motivo')), (422, 'rapido-demais'), 'fechar logo depois de abrir não vale')
        # a recusa ficou guardada: outra partida para a vitória
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        jogo = self.joga(e['ata'])
        gv, gp = (ga, gb) if jogo['venc'] == 'A' else (gb, ga)
        antes = (self.xp(gv), self.xp(gp))
        self.envelhece(e['gid'])
        s, r = self.fecha(a2, e['gid'], jogo)
        self.assertEqual(s, 200, r)
        self.assertEqual((r['fase'], r['venc'], r['xp'], r['lado']), (jogo['fase'], jogo['venc'], 40, 'A'))
        self.assertEqual(r['venceu'], jogo['venc'] == 'A')
        self.assertEqual(r['guilda']['id'], gv)
        self.assertEqual((self.xp(gv), self.xp(gp)), (antes[0] + guerra_mod.GUERRA_XP, antes[1]),
                         'a vencedora ganha 40 XP; a perdedora não perde')
        vencedores = (a1, a2) if jogo['venc'] == 'A' else (b1, b2)
        contrib = {x['conta_id']: x['xp'] for x in self.sql("SELECT conta_id, xp FROM guilda_contrib WHERE guilda_id = ?", gv)}
        self.assertEqual(sum(contrib.get(c.conta['id'], 0) for c in vencedores), 40, contrib)
        vidas = self.sql("SELECT conta_id, heroi FROM vida_heroi")
        for c in (a1, a2, b1, b2):
            self.assertEqual(sorted(v['heroi'] for v in vidas if v['conta_id'] == c.conta['id']), sorted(DUPLA),
                             'a vida dos oito heróis, cada um na conta dele')
        self.assertEqual(sorted(r['vida'].keys()) if r['vida'] else [], sorted(
            v['heroi'] for v in vidas if v['conta_id'] == a2.conta['id'] and v['heroi'] in r['vida']))
        # idempotente: quem fecha depois recebe o guardado, e o XP não dobra
        s, r2 = self.fecha(b2, e['gid'], jogo)
        self.assertEqual((s, r2['xp'], r2['venc'], r2['lado']), (200, 40, jogo['venc'], 'B'))
        self.assertEqual(self.xp(gv), antes[0] + guerra_mod.GUERRA_XP)
        s, r3 = self.fecha(a1, e['gid'], {'lances': [], 'hashFinal': None})
        self.assertEqual((s, r3['xp']), (200, 40), 'o guardado vale mesmo com outro registro')
        estranho = self.conta('Zeca')
        s, _ = self.fecha(estranho, e['gid'], jogo)
        self.assertEqual(s, 404, 'quem não lutou não fecha')
        self.assertEqual(self.estado(a1)['fase'], 'livre', 'a guerra fechada sai do estado')

    def test_07_empate_e_wo_nao_rendem(self):
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        antes = (self.xp(ga), self.xp(gb))
        wo = self.joga(e['ata'], para=6)
        self.envelhece(e['gid'])
        s, r = self.fecha(a1, e['gid'], wo)
        self.assertEqual(s, 200, r)
        self.assertEqual((r['venc'], r['xp'], r['motivo'], r['venceu']), (None, 0, 'sem-fim', None))
        self.assertEqual(len(self.sql("SELECT 1 FROM vida_heroi")), 8, 'o W.O. grava a vida assim mesmo')
        self.assertEqual((self.xp(ga), self.xp(gb)), antes)
        # o empate: ninguém ataca até o teto de rodadas, todos cheios (a mesma fração de vida)
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        jogo = self.joga(e['ata'], passa=True)
        self.assertEqual(jogo['venc'], 'empate', jogo['fase'])
        self.envelhece(e['gid'])
        s, r = self.fecha(b2, e['gid'], jogo)
        self.assertEqual(s, 200, r)
        self.assertEqual((r['venc'], r['xp'], r['motivo']), ('empate', 0, 'empate'))
        self.assertEqual((self.xp(ga), self.xp(gb)), (0, 0))

    def test_08_tetos(self):
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        t = int(time.time())
        for i in range(guerra_mod.GUERRAS_XP_POR_PAR):
            self.sql("INSERT INTO guerra_resultados(gid, fase, venc, xp, guilda_xp, a_guilda, b_guilda, criado_em) "
                     "VALUES (?, 'won', 'A', 40, ?, ?, ?, ?)", 'velha-par-%d' % i, gb, gb, ga, t - 3600)
        jogo = self.joga(e['ata'])
        self.envelhece(e['gid'])
        s, r = self.fecha(a1, e['gid'], jogo)
        self.assertEqual((s, r['xp'], r['motivo']), (200, 0, 'teto'), r)
        self.assertEqual((self.xp(ga), self.xp(gb)), (0, 0), 'acima do teto do par, a guerra vale sem XP')
        # 10 por guilda (contra guildas quaisquer)
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        for i in range(guerra_mod.GUERRAS_XP_POR_GUILDA):
            self.sql("INSERT INTO guerra_resultados(gid, fase, venc, xp, guilda_xp, a_guilda, b_guilda, criado_em) "
                     "VALUES (?, 'won', 'A', 40, ?, ?, ?, ?)", 'velha-g-%d' % i, ga, ga, 900000 + i, t - 3600)
        jogo = self.joga(e['ata'])
        self.envelhece(e['gid'])
        s, r = self.fecha(b1, e['gid'], jogo)
        self.assertEqual((s, r['xp'], r['motivo']), (200, 0, 'teto'), r)
        # o que passou de 24 h não conta
        self.sql("UPDATE guerra_resultados SET criado_em = criado_em - 90000 WHERE gid LIKE 'velha-%'")
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        jogo = self.joga(e['ata'])
        self.envelhece(e['gid'])
        s, r = self.fecha(b1, e['gid'], jogo)
        self.assertEqual((s, r['xp']), (200, 40), r)

    def test_09_forja_fotografada(self):
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        jogo = self.joga(e['ata'])
        self.envelhece(e['gid'])
        s, r = self.fecha(a1, e['gid'], jogo, fotografada=True)
        self.assertEqual((s, r['fase']), (200, 'aguardando'), 'o registro fotografado não refaz: espera um limpo')
        forjado = copy.deepcopy(jogo['lances'])
        i = next(k for k, l in enumerate(forjado) if l.get('de') == a1.dono)
        forjado[i]['de'] = b1.dono
        s, r = self.fecha(b1, e['gid'], {'lances': forjado, 'hashFinal': jogo['hashFinal']})
        self.assertEqual((s, r.get('motivo')), (422, 'vez'), 'o lance de quem não tem a vez derruba o registro')
        s, r = self.fecha(a2, e['gid'], jogo)
        self.assertEqual((s, r['fase'], r['xp']), (200, 'recusada', 0), 'a recusa fica guardada (idempotente)')
        self.assertEqual((self.xp(ga), self.xp(gb)), (0, 0))
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM vida_heroi")[0]['n'], 0, 'registro recusado não grava vida')
        s, r = a1.pede('POST', '/api/guerra/fechar', {'gid': 'nada'})
        self.assertEqual(s, 400)


if __name__ == '__main__':
    unittest.main(verbosity=2)
