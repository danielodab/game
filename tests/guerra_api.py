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
um), idempotente por gid, o empate sem XP, os tetos (3 por par de guildas e 10 por guilda em 24 h), a forja (lance fora
da vez: 422 — e o limpo de outro vence), rápido demais, fotografado e quem não lutou.
19/09, a revisão da guerra (o dono: "dê uma revisada na guerra de guild do meu jogo e ajuste o que for necessário"):
o registro sem fim (ou vazio) NUNCA fecha a guerra na hora — espera (aguardando) e só a vida de quem fechou grava; o
registro com fim de outro dos quatro vence; passada a espera, 'sem-fim' com a vida do replay para os oito; o W.O. com a
queda dos dois adversários provada pelo Relé (rele_presenca) dá a vitória com XP, a queda recente espera, sem prova
'wo-sem-prova'; a saída declarada (sair {gid} / desistiu) zera os heróis na hora e é a prova da marca `morte`; os dois de
um lado fora → o outro vence; as marcas forjadas contra o adversário caem (422 marca-sem-prova); a pronta não some em
3 min e abrir outra luta com ela pendente larga a guerra; quem troca de guilda sai da fila (e 409 outra-guilda ao
confirmar); semXp no estado casada; a pronta sem ata cai; o fechamento concorrente paga uma vez; os motivos 4xx.
A 2ª rodada da revisão (o revisor adversarial): a marca `ia` passa de quem for (o parceiro marca por prazo, sem queda
no Relé, e o registro limpo do adversário era recusado — o lado que perdia vetava a guerra); o vazio não fecha a luta
aberta (quem fecha vazio e abre outra luta é largado); o recusado e o rápido demais repetidos depois da espera encerram
pelo fechar; o fotografado é 'em-luta'; o W.O. conta os 60 s do primeiro pedido de W.O. (guerra_wo); sair da pronta
sem ata derruba a guerra que não começou.
A 3ª rodada (o revisor adversarial de novo): a corrida entre sair {gid} e o fechar vazio da mesma conta não devolve a
vida do começo (as saídas relidas dentro da escrita); o fim forçado (os dois de um lado fora, o W.O. provado) vale
também para o fotografado (o juiz recebe o vazio com `perdeu`); o W.O. em espera fica persistido (o estado 'em-luta',
o replay guardado) e a prova madura fecha o W.O. pela consulta de qualquer um; a pronta sem ata + outra luta derruba a
guerra que não começou; a queda entre a casada e a pronta prova o W.O.; a ata sempre leva `regras`.
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
import threading
import time
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(AQUI, '..', 'servidor'))
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402
from autoridade_api import BAIXA, ESTADO_JS, JUIZ, NODE, adota_regras, espera_url, roda_node  # noqa: E402
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
            adota_regras(cls.juiz)              # 19/09: as provas são a página nova (versaoRegras nas aberturas)
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
        for t in ('guerra_inscricoes', 'guerra_jogadores', 'guerra_partidas', 'guerra_resultados', 'guerra_espera',
                  'guerra_saidas', 'guerra_wo', 'luta_aberta_guerra', 'luta_aberta', 'vida_heroi', 'rele_presenca', 'eventos'):
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
        """o tempo mínimo (0,35 s por turno de gente) sem esperar de verdade — a partida inteira fica uma hora mais
        velha (a casada também: 3ª rodada, a prova do W.O. conta desde criada_ms)"""
        self.sql("UPDATE guerra_partidas SET pronta_ms = pronta_ms - 3600000, criada_ms = criada_ms - 3600000 WHERE gid = ?", gid)

    def abre_sala(self, c):
        return c.pede('POST', '/api/sala/abrir', {'dungeonId': 'cistern', 'roomIndex': 0, 'dificuldade': 'normal',
                                                  'herois': ['sumo']})

    def luta_aberta(self, c, gid):
        r = self.sql("SELECT estado FROM luta_aberta_guerra WHERE conta_id = ? AND gid = ?", c.conta['id'], gid)
        return r[0]['estado'] if r else None

    def fecha(self, c, gid, jogo, **extra):
        corpo = {'gid': gid, 'lances': jogo['lances'], 'hashFinal': jogo['hashFinal']}
        corpo.update(extra)
        return c.pede('POST', '/api/guerra/fechar', corpo)

    def xp(self, gid):
        return self.sql("SELECT xp FROM guildas WHERE id = ?", gid)[0]['xp']

    # 19/09: os ajudantes da revisão
    def espera_vencida(self, gid):
        """a espera de GUERRA_ESPERA s por um registro com fim passou, sem esperar de verdade"""
        self.sql("UPDATE guerra_partidas SET primeiro_fecho = primeiro_fecho - ? WHERE gid = ?", guerra_mod.GUERRA_ESPERA + 5, gid)

    def presenca(self, c, evento, em_ms):
        self.sql("INSERT INTO rele_presenca(conta_id, evento, em_ms) VALUES (?, ?, ?)", c.conta['id'], evento, em_ms)

    def vida(self, c):
        """{heroi: (hp_fim, hp_max)} da conta"""
        return {v['heroi']: (v['hp_fim'], v['hp_max']) for v in
                self.sql("SELECT heroi, hp_fim, hp_max FROM vida_heroi WHERE conta_id = ?", c.conta['id'])}

    def contas_com_vida(self):
        return {v['conta_id'] for v in self.sql("SELECT DISTINCT conta_id FROM vida_heroi")}

    def resultados(self, gid=None):
        if gid is None:
            return self.sql("SELECT COUNT(*) AS n FROM guerra_resultados")[0]['n']
        return self.sql("SELECT COUNT(*) AS n FROM guerra_resultados WHERE gid = ?", gid)[0]['n']

    def saidas(self, gid):
        return {s['conta_id']: s['motivo'] for s in self.sql("SELECT conta_id, motivo FROM guerra_saidas WHERE gid = ?", gid)}

    def eventos(self, c, tipo):
        return [json.loads(e['dados']) for e in self.sql("SELECT dados FROM eventos WHERE conta_id = ? AND tipo = ?", c.conta['id'], tipo)]

    def sair(self, c, gid):
        return c.pede('POST', '/api/guerra/sair', {'gid': gid})

    # -- as provas ----------------------------------------------------------------------------
    def test_01_inscrever_e_juntar(self):
        a1, a2, fora, outra = self.conta('Ana'), self.conta('Bia'), self.conta('Solo'), self.conta('Rival')
        nulo = Cliente(self.base)                     # 19/09: cadastrada, nunca salvou (sem estado no servidor)
        self.assertEqual(nulo.cadastra('Nulo %d' % int(time.time() * 1000 % 100000))[0], 201)
        s, r = self.inscreve(a1, a2)
        self.assertEqual((s, r.get('motivo')), (409, 'sem-guilda'), r)
        self.guilda(a1, a2, nulo)
        self.guilda(outra)
        s, r = self.inscreve(a1, outra)
        self.assertEqual((s, r.get('motivo')), (409, 'outra-guilda'), 'o parceiro é da mesma guilda')
        s, r = self.inscreve(a1, a1)
        self.assertEqual((s, r.get('motivo')), (400, 'parceiro'), 'o parceiro é outra conta (19/09: com motivo)')
        s, r = self.inscreve(a1, nulo)
        self.assertEqual((s, r.get('motivo')), (409, 'sem-estado-parceiro'), r)
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
        s, r = a2.pede('POST', '/api/guerra/juntar', {'herois': DUPLA, 'dono': a1.dono})
        self.assertEqual((s, r.get('motivo')), (400, 'mesmo-dono'), '19/09: o mesmo id de rede do líder, com motivo')
        s, r = self.junta(a2)
        self.assertEqual((s, r['fase']), (200, 'inscrito'), r)
        self.assertEqual(self.estado(a1)['fase'], 'inscrito')
        s, r = a2.pede('POST', '/api/guerra/sair', {})
        self.assertEqual((s, r['fase']), (200, 'livre'))
        self.assertEqual(self.estado(a1)['fase'], 'livre', 'sair desfaz a dupla de jogadores inteira')
        # 19/09: quem não tem estado é o LÍDER — o motivo diz isso (a frase de antes mandava o parceiro recarregar)
        s, r = self.inscreve(a1, a2)
        self.assertEqual(s, 200, r)
        self.sql("DELETE FROM saves WHERE conta_id = ?", a1.conta['id'])
        s, r = self.junta(a2)
        self.assertEqual((s, r.get('motivo')), (409, 'sem-estado-lider'), r)

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
        # 3ª rodada: a ata sempre leva a versão das regras — o número vem na própria resposta do /guerra/ata
        self.assertIsInstance(ata.get('regras'), int, ata.get('regras'))
        self.assertGreaterEqual(ata['regras'], 1)

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
        self.assertEqual((s, r.get('motivo'), r.get('fase')), (422, 'rapido-demais', 'aguardando'),
                         'fechar logo depois de abrir não vale — e (19/09) não fecha a guerra: espera')
        self.assertEqual(self.resultados(), 0)
        self.assertEqual(self.contas_com_vida(), set(), 'o recusado não grava vida')
        # a recusa não é final: a mesma partida, envelhecida, fecha com a vitória
        self.envelhece(e['gid'])
        s, r = self.fecha(a2, e['gid'], jogo)
        self.assertEqual(s, 200, r)
        self.assertEqual((r['fase'], r['venc'], r['xp'], r['lado'], r.get('fechada')), (jogo['fase'], jogo['venc'], 40, 'A', True))
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
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM guerra_espera")[0]['n'], 0, 'a espera some com o resultado')
        self.assertEqual({x['estado'] for x in self.sql("SELECT estado FROM luta_aberta_guerra WHERE gid = ?", e['gid'])},
                         {'fechada'}, 'a luta aberta dos quatro fecha')
        # idempotente: quem fecha depois recebe o guardado, e o XP não dobra
        s, r2 = self.fecha(b2, e['gid'], jogo)
        self.assertEqual((s, r2['xp'], r2['venc'], r2['lado']), (200, 40, jogo['venc'], 'B'))
        self.assertEqual(self.xp(gv), antes[0] + guerra_mod.GUERRA_XP)
        s, r3 = self.fecha(a1, e['gid'], {'lances': [], 'hashFinal': None})
        self.assertEqual((s, r3['xp']), (200, 40), 'o guardado vale mesmo com outro registro')
        estranho = self.conta('Zeca')
        s, r = self.fecha(estranho, e['gid'], jogo)
        self.assertEqual((s, r.get('motivo')), (404, 'sem-partida'), 'quem não lutou não fecha')
        # 19/09: a guerra recém-fechada aparece no estado como 'fechada' (para quem perdeu a resposta) e não prende
        est = self.estado(a1)
        self.assertEqual((est['fase'], est['gid'], est['xp'], est['venceu']), ('fechada', e['gid'], 40, jogo['venc'] == 'A'), est)
        self.sql("UPDATE guerra_resultados SET criado_em = criado_em - ? WHERE gid = ?", guerra_mod.GUERRA_FECHADA_MS // 1000 + 5, e['gid'])
        self.assertEqual(self.estado(a1)['fase'], 'livre', 'depois de um minuto a guerra fechada sai do estado')

    def test_07_sem_fim_espera_e_o_empate_nao_rende(self):
        """19/09: o registro SEM fim (a guerra largada no meio) nunca fecha a guerra na hora"""
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        antes = (self.xp(ga), self.xp(gb))
        largada = self.joga(e['ata'], para=6)
        self.envelhece(e['gid'])
        s, r = self.fecha(a1, e['gid'], largada)
        self.assertEqual((s, r['fase'], r['motivo']), (200, 'aguardando', 'sem-fim'), r)
        self.assertTrue(100000 < r['esperaMs'] <= guerra_mod.GUERRA_ESPERA * 1000, r['esperaMs'])
        self.assertEqual(self.resultados(), 0)
        self.assertEqual(self.contas_com_vida(), {a1.conta['id']}, 'só a vida de quem fechou grava enquanto espera')
        self.assertEqual(self.estado(a1)['fase'], 'em-luta', 'quem fechou a parte dela espera os outros')
        self.assertEqual(self.estado(b1)['fase'], 'pronta', 'para os outros a guerra segue')
        s, r = self.fecha(b2, e['gid'], largada)
        self.assertEqual((s, r['fase']), (200, 'aguardando'))
        self.assertEqual(self.contas_com_vida(), {a1.conta['id'], b2.conta['id']})
        # a espera vence sem um registro com fim: 'sem-fim', a vida do replay para os oito, sem XP
        self.espera_vencida(e['gid'])
        s, r = self.fecha(a1, e['gid'], largada)
        self.assertEqual(s, 200, r)
        self.assertEqual((r['venc'], r['xp'], r['motivo'], r['venceu'], r.get('fechada')), (None, 0, 'sem-fim', None, True))
        self.assertEqual(len(self.sql("SELECT 1 FROM vida_heroi")), 8, 'o fim da espera grava a vida do replay para os oito')
        self.assertEqual((self.xp(ga), self.xp(gb)), antes)
        self.assertEqual(self.estado(b1)['fase'], 'fechada')
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
        self.assertIn(jogo['venc'], ('A', 'B'), jogo['fase'])
        self.envelhece(e['gid'])
        s, r = self.fecha(a1, e['gid'], jogo, fotografada=True)
        self.assertEqual((s, r['fase'], r['motivo']), (200, 'aguardando', 'fotografada'), 'o registro fotografado não refaz: espera um limpo')
        self.assertEqual(self.estado(a1)['fase'], 'em-luta', '2ª rodada: o fotografado já fechou a parte dele (o jogo não abre outra luta)')
        forjado = copy.deepcopy(jogo['lances'])
        i = next(k for k, l in enumerate(forjado) if l.get('de') == a1.dono)
        forjado[i]['de'] = b1.dono
        s, r = self.fecha(b1, e['gid'], {'lances': forjado, 'hashFinal': jogo['hashFinal']})
        self.assertEqual((s, r.get('motivo'), r.get('fase')), (422, 'vez', 'aguardando'), 'o lance de quem não tem a vez derruba o registro — e só ele')
        self.assertEqual(self.resultados(), 0, '19/09: o registro recusado não fecha a guerra (era um veto de graça)')
        self.assertEqual(self.contas_com_vida(), set(), 'registro recusado não grava vida')
        s, r = self.fecha(a2, e['gid'], jogo)
        self.assertEqual((s, r['fase'], r['venc'], r['xp']), (200, jogo['fase'], jogo['venc'], 40), 'o registro limpo de outro dos quatro vence o torto')
        self.assertEqual(self.xp(ga if jogo['venc'] == 'A' else gb), 40)
        # só fotografados, e a espera vencida: 'nao-conferida' (sem XP e sem vida)
        self.sql("DELETE FROM vida_heroi")
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        self.envelhece(e['gid'])
        s, r = self.fecha(a1, e['gid'], jogo, fotografada=True)
        self.assertEqual((s, r['fase']), (200, 'aguardando'))
        self.espera_vencida(e['gid'])
        s, r = self.fecha(b1, e['gid'], jogo, fotografada=True)
        self.assertEqual((s, r['fase'], r['xp'], r.get('motivo')), (200, 'nao-conferida', 0, 'fotografada'), r)
        self.assertEqual(self.contas_com_vida(), set())
        # 19/09: o limpo TARDIO (depois dos 120 s do fotografado) ainda vale — antes virava 'nao-conferida'
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        jogo = self.joga(e['ata'])
        self.assertIn(jogo['venc'], ('A', 'B'), jogo['fase'])
        self.envelhece(e['gid'])
        s, r = self.fecha(a1, e['gid'], jogo, fotografada=True)
        self.assertEqual((s, r['fase']), (200, 'aguardando'))
        self.espera_vencida(e['gid'])
        s, r = self.fecha(b1, e['gid'], jogo)
        self.assertEqual((s, r['fase'], r['venc'], r['xp']), (200, jogo['fase'], jogo['venc'], 40), r)
        s, r = a1.pede('POST', '/api/guerra/fechar', {'gid': 'nada'})
        self.assertEqual((s, r.get('motivo')), (400, 'gid'))

    # -- 19/09: a revisão da guerra ----------------------------------------------------------------------------------
    def test_10_fechar_vazio_nao_anula_a_guerra(self):
        """CRÍTICO da revisão: o lado que perdia fechava com lances=[] e o servidor guardava 'sem-fim' como final,
        com a vida dos oito cheia; o registro do vencedor caía no guardado. Agora o vazio espera e o com fim vence."""
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        jogo = self.joga(e['ata'])
        self.assertIn(jogo['venc'], ('A', 'B'), jogo['fase'])
        gv = ga if jogo['venc'] == 'A' else gb
        self.envelhece(e['gid'])
        s, r = self.fecha(b1, e['gid'], {'lances': [], 'hashFinal': None})
        self.assertEqual((s, r['fase'], r['motivo']), (200, 'aguardando', 'sem-fim'), r)
        self.assertEqual(self.resultados(), 0, 'o registro vazio não fecha a guerra')
        self.assertEqual(self.contas_com_vida(), {b1.conta['id']}, 'só os heróis de quem fechou (cheios: ele não jogou)')
        # 2ª rodada da revisão: o vazio NÃO fecha a luta aberta de quem fechou — a Duda fecha vazio e abre um calabouço
        # no meio da guerra: é largada (heróis a 0, saída 'largada'), em vez de sair com a vida do começo e a sala aberta
        s, r = self.fecha(b2, e['gid'], {'lances': [], 'hashFinal': None})
        self.assertEqual((s, r['fase']), (200, 'aguardando'), r)
        self.assertEqual(self.estado(b2)['fase'], 'em-luta')
        self.assertEqual(self.sql("SELECT estado FROM luta_aberta_guerra WHERE conta_id = ?", b2.conta['id'])[0]['estado'], 'aberta')
        s, r = b2.pede('POST', '/api/sala/abrir', {'dungeonId': 'cistern', 'roomIndex': 0, 'dificuldade': 'normal', 'herois': ['sumo']})
        self.assertEqual((s, r.get('motivo'), r.get('largada')), (409, 'vida-zero', {'herois': DUPLA}), r)
        self.assertEqual(self.saidas(e['gid']), {b2.conta['id']: 'largada'})
        self.assertTrue(all(hp == 0 for hp, _ in self.vida(b2).values()), self.vida(b2))
        self.assertEqual(self.estado(b2)['fase'], 'livre')
        s, r = self.fecha(a1, e['gid'], jogo)
        self.assertEqual((s, r['venc'], r['xp'], r.get('fechada')), (200, jogo['venc'], 40, True), 'o registro com fim vence o vazio')
        self.assertEqual(self.xp(gv), 40)
        self.assertEqual(len(self.sql("SELECT 1 FROM vida_heroi")), 8)
        s, rb = self.fecha(b1, e['gid'], {'lances': [], 'hashFinal': None})
        self.assertEqual((s, rb['xp']), (200, 40))
        self.assertEqual({h: v[0] for h, v in self.vida(b1).items()}, rb['vida'], 'a vida de quem fechou vazio é regravada com o fim de verdade')
        self.assertTrue(all(hp == 0 for hp, _ in self.vida(b2).values()), 'quem largou não é regravado')

    def test_11_wo_com_a_queda_provada_pelo_rele(self):
        """o W.O. declarado por quem ficou: a prova é do Relé (rele_presenca), para os DOIS adversários"""
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        largada = self.joga(e['ata'], para=6)
        self.envelhece(e['gid'])
        agora = int(time.time() * 1000)
        for c in (b1, b2):
            self.presenca(c, 'caiu', agora - 70000)          # caíram há 70 s (depois da pronta), sem voltar
        s, r = self.fecha(a1, e['gid'], largada, wo=True)
        self.assertEqual((s, r['fase'], r['venc'], r['xp'], r.get('fim'), r['venceu']), (200, 'won', 'A', 40, 'wo', True), r)
        for c in (b1, b2):
            v = self.vida(c)
            self.assertEqual(sorted(v), sorted(DUPLA))
            self.assertTrue(all(hp == 0 and mx > 60 for hp, mx in v.values()), 'o lado ausente sai a 0, com o máximo de verdade: %r' % v)
        self.assertEqual(sorted(self.vida(a1)), sorted(DUPLA), 'quem ficou grava a vida do replay')
        self.assertEqual((self.xp(ga), self.xp(gb)), (40, 0), 'decisão do coordenador: o W.O. provado rende XP nos tetos')
        # a queda recente ('cedo') espera até os 60 s; a volta dentro dos 60 s desfaz a prova: 'wo-sem-prova' (na espera)
        self.sql("DELETE FROM vida_heroi")
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        largada = self.joga(e['ata'], para=6)
        self.envelhece(e['gid'])
        agora = int(time.time() * 1000)
        for c in (b1, b2):
            self.presenca(c, 'caiu', agora - 10000)
        s, r = self.fecha(a1, e['gid'], largada, wo=True)
        self.assertEqual((s, r['fase'], r['motivo']), (200, 'aguardando', 'wo'), r)
        self.assertAlmostEqual(r['esperaMs'], 50000, delta=4000)
        self.assertEqual(self.resultados(e['gid']), 0)
        # 3ª rodada: o W.O. em espera fica persistido como qualquer fechamento sem fim — o replay de quem declarou na
        # espera (motivo 'wo'), a vida dele gravada, o estado 'em-luta' (antes não ficava em lugar nenhum)
        self.assertEqual(self.contas_com_vida(), {a1.conta['id']}, 'esperando a prova, a vida do replay de quem declarou grava')
        self.assertEqual([x['motivo'] for x in self.sql("SELECT motivo FROM guerra_espera WHERE gid = ?", e['gid'])], ['wo'])
        self.assertEqual(self.estado(a1)['fase'], 'em-luta')
        for c in (b1, b2):
            self.presenca(c, 'voltou', agora - 5000)
        s, r = self.fecha(a1, e['gid'], largada, wo=True)
        self.assertEqual((s, r['fase'], r['motivo']), (200, 'aguardando', 'wo-sem-prova'), r)
        self.assertEqual(self.contas_com_vida(), {a1.conta['id']}, 'sem prova: só a vida do replay de quem fechou')
        self.assertEqual((self.xp(ga), self.xp(gb)), (0, 0))
        # a espera acaba sem outro registro: o porquê fica — 'wo-sem-prova', não 'sem-fim' (3ª rodada)
        self.espera_vencida(e['gid'])
        s, r = self.fecha(a1, e['gid'], largada, wo=True)
        self.assertEqual((s, r.get('fechada'), r['venc'], r['xp'], r.get('motivo')), (200, True, None, 0, 'wo-sem-prova'), r)
        self.assertEqual(len(self.sql("SELECT 1 FROM vida_heroi")), 8)
        # nenhuma queda anotada: espera WO_ESPERA_MS do PRIMEIRO pedido de W.O. (guerra_wo) — e não do primeiro_fecho de
        # outro (2ª rodada: o vazio da Cris de 100 s atrás pulava a espera e dava 'wo-sem-prova' na hora); depois,
        # 'wo-sem-prova'
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        largada = self.joga(e['ata'], para=6)
        self.envelhece(e['gid'])
        s, r = self.fecha(b1, e['gid'], {'lances': [], 'hashFinal': None})
        self.assertEqual((s, r['fase']), (200, 'aguardando'), r)
        self.sql("UPDATE guerra_partidas SET primeiro_fecho = primeiro_fecho - 100 WHERE gid = ?", e['gid'])
        s, r = self.fecha(a2, e['gid'], largada, wo=True)
        self.assertEqual((s, r['fase'], r['motivo']), (200, 'aguardando', 'wo'), r)
        self.assertAlmostEqual(r['esperaMs'], 60000, delta=4000)
        self.assertEqual(len(self.sql("SELECT 1 FROM guerra_wo WHERE gid = ?", e['gid'])), 1)
        self.sql("UPDATE guerra_wo SET pedido_ms = pedido_ms - 70000 WHERE gid = ?", e['gid'])
        s, r = self.fecha(a2, e['gid'], largada, wo=True)
        self.assertEqual((s, r['fase'], r['motivo']), (200, 'aguardando', 'wo-sem-prova'), r)
        s, r = self.fecha(a2, e['gid'], largada, desistiu=True, wo=True)
        self.assertEqual((s, r.get('motivo')), (400, 'desistiu-e-wo'))

    def test_12_sair_declarado_zera_na_hora_e_prova_a_marca_morte(self):
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        s, r = self.sair(b2, e['gid'])
        self.assertEqual((s, r['fase']), (200, 'livre'), r)
        v = self.vida(b2)
        self.assertTrue(sorted(v) == sorted(DUPLA) and all(hp == 0 and mx > 60 for hp, mx in v.values()), v)
        self.assertEqual(self.saidas(e['gid']), {b2.conta['id']: 'saiu'})
        self.assertEqual(self.sql("SELECT estado FROM luta_aberta_guerra WHERE conta_id = ?", b2.conta['id'])[0]['estado'], 'fechada')
        self.assertEqual(self.estado(b1)['fase'], 'pronta', 'a guerra segue para os outros três')
        self.assertEqual([x.get('por') for x in self.eventos(b1, 'guerra-saiu')], [b2.conta['id']])
        s, r = self.sair(b2, e['gid'])
        self.assertEqual(s, 200, 'idempotente')
        self.assertEqual(self.saidas(e['gid']), {b2.conta['id']: 'saiu'})
        desde = self.sql("SELECT desde_ms FROM vida_heroi WHERE conta_id = ?", b2.conta['id'])[0]['desde_ms']
        # o registro da Ana com a morte dos heróis da Duda (a marca `morte` que o `sai` provoca): a saída é a prova
        jogo = self.joga(e['ata'], sai={'dono': b2.dono, 'depois': 3})
        self.assertTrue(any(l.get('a') == 'x' and l.get('ev') == 'morte' for l in jogo['lances']))
        self.assertIn(jogo['venc'], ('A', 'B', 'empate'), jogo['fase'])
        self.envelhece(e['gid'])
        s, r = self.fecha(a1, e['gid'], jogo)
        self.assertEqual((s, r['venc']), (200, jogo['venc']), r)
        self.assertEqual(self.sql("SELECT desde_ms FROM vida_heroi WHERE conta_id = ?", b2.conta['id'])[0]['desde_ms'], desde,
                         'quem saiu não é regravado pelo fim dos outros')
        self.assertTrue(all(hp == 0 for hp, _ in self.vida(b2).values()))

    def test_13_os_dois_de_um_lado_sairam_o_outro_vence(self):
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        largada = self.joga(e['ata'], para=4)
        self.envelhece(e['gid'])
        s, r = self.fecha(b1, e['gid'], largada, desistiu=True, lado='A')
        self.assertEqual((s, r.get('motivo')), (403, 'desistencia-alheia'), r)
        self.assertEqual(self.saidas(e['gid']), {})
        s, r = self.fecha(b1, e['gid'], largada, desistiu=True, lado='B')
        self.assertEqual((s, r['fase'], r['motivo']), (200, 'aguardando', 'sem-fim'), 'a Cris desistiu; a Duda ainda luta')
        self.assertEqual(self.saidas(e['gid']), {b1.conta['id']: 'desistiu'})
        self.assertTrue(all(hp == 0 for hp, _ in self.vida(b1).values()))
        self.assertEqual(self.estado(b1)['fase'], 'livre')
        self.assertEqual(self.estado(b2)['fase'], 'pronta')
        s, r = self.sair(b2, e['gid'])
        self.assertEqual(s, 200, r)
        # os dois de B fora: qualquer um que feche agora dá a vitória a A, com XP, fim 'saida'
        s, r = self.fecha(a2, e['gid'], largada)
        self.assertEqual((s, r['fase'], r['venc'], r['xp'], r.get('fim'), r['venceu']), (200, 'won', 'A', 40, 'saida', True), r)
        self.assertEqual((self.xp(ga), self.xp(gb)), (40, 0))
        for c in (b1, b2):
            self.assertTrue(all(hp == 0 for hp, _ in self.vida(c).values()))
        self.assertEqual(sorted(self.vida(a1)), sorted(DUPLA))
        self.assertEqual(self.estado(a1)['fase'], 'fechada')

    def test_14_marcas_forjadas_contra_o_adversario_caem(self):
        """o achado do juiz: quatro marcas `morte` nos heróis do adversário, sem lance, davam +40 XP e o outro lado a 0.
        2ª rodada: a marca `ia` passa de quem for — o parceiro marca por PRAZO (sem queda no Relé) e a voz entra nos
        quatro registros; exigir prova recusava o registro limpo do adversário e o lado que perdia vetava a guerra."""
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        jogo = self.joga(e['ata'])
        self.assertIn(jogo['venc'], ('A', 'B'), jogo['fase'])
        self.envelhece(e['gid'])
        forja = [{'a': 'x', 'ev': 'morte', 'u': u, 'ok': True} for u in jogo['uids'][b1.dono] + jogo['uids'][b2.dono]]
        s, r = self.fecha(a1, e['gid'], {'lances': forja, 'hashFinal': None})
        self.assertEqual((s, r.get('motivo'), r.get('fase')), (422, 'marca-sem-prova', 'aguardando'), r)
        self.assertEqual((self.xp(ga), self.xp(gb), self.resultados(), self.contas_com_vida()), (0, 0, 0, set()))
        self.assertEqual(self.estado(a1)['fase'], 'em-luta')
        # a marca `ia` sobre o adversário passa sem prova: é só passar a vez (o registro sem fim só espera)
        forja_ia = [{'a': 'x', 'ev': 'ia', 'u': u, 'v': True, 'ok': True} for u in jogo['uids'][b1.dono]]
        s, r = self.fecha(a2, e['gid'], {'lances': forja_ia, 'hashFinal': None})
        self.assertEqual((s, r['fase'], r['motivo']), (200, 'aguardando', 'sem-fim'), r)
        self.assertEqual((self.resultados(), self.contas_com_vida()), (0, {a2.conta['id']}))
        s, r = self.fecha(b2, e['gid'], jogo)
        self.assertEqual((s, r['venc'], r['xp']), (200, jogo['venc'], 40), 'o registro limpo vence')
        # o CRÍTICO da 2ª rodada: a Ana marca a Bia por PRAZO (sem 'caiu' no Relé); a marca entra nos quatro registros e
        # o registro limpo da Cris (o lado oposto) vale — era 422 marca-sem-prova, e a guerra acabava 'sem-fim' com a
        # vida do começo para os oito (ou 'recusada'), sem XP para quem venceu
        self.sql("DELETE FROM vida_heroi")
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        jogo = self.joga(e['ata'], cai={'dono': a2.dono, 'depois': 1})
        self.assertTrue(any(l.get('a') == 'x' and l.get('ev') == 'ia' and l.get('v') for l in jogo['lances']))
        self.assertIn(jogo['venc'], ('A', 'B', 'empate'), jogo['fase'])
        self.envelhece(e['gid'])
        s, r = self.fecha(b1, e['gid'], jogo)
        self.assertEqual((s, r.get('venc'), r.get('fechada')), (200, jogo['venc'], True), r)
        self.assertEqual(len(self.sql("SELECT 1 FROM vida_heroi")), 8)
        # e o W.O. provado com o parceiro marcado por prazo: o Cris marcou a Duda (prazo) e os dois caíram de verdade
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        largada = self.joga(e['ata'], cai={'dono': b2.dono, 'depois': 1}, para=8)
        self.envelhece(e['gid'])
        agora = int(time.time() * 1000)
        for c in (b1, b2):
            self.presenca(c, 'caiu', agora - 70000)
        s, r = self.fecha(a1, e['gid'], largada, wo=True)
        self.assertEqual((s, r['fase'], r['venc'], r['xp'], r.get('fim')), (200, 'won', 'A', 40, 'wo'), r)

    def test_15_a_pronta_nao_some_em_3_min_e_outra_luta_a_larga(self):
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        self.sql("UPDATE guerra_partidas SET pronta_ms = pronta_ms - 240000 WHERE gid = ?", e['gid'])
        self.assertEqual(self.estado(a1)['fase'], 'pronta', 'a guerra em curso há 4 min continua no estado (era livre)')
        # a Ana abre um calabouço com a guerra pendente: a guerra fica largada (os heróis dela a 0) e a sala nem abre
        s, r = a1.pede('POST', '/api/sala/abrir', {'dungeonId': 'cistern', 'roomIndex': 0, 'dificuldade': 'normal', 'herois': ['sumo']})
        self.assertEqual((s, r.get('motivo'), r.get('largada')), (409, 'vida-zero', {'herois': DUPLA}), r)
        self.assertTrue(all(hp == 0 and mx > 60 for hp, mx in self.vida(a1).values()), self.vida(a1))
        self.assertEqual(self.saidas(e['gid']), {a1.conta['id']: 'largada'})
        self.assertEqual(self.sql("SELECT estado FROM luta_aberta_guerra WHERE conta_id = ?", a1.conta['id'])[0]['estado'], 'largada')
        self.assertEqual([x['tipo'] for x in self.eventos(a1, 'luta-largada')], ['guerra'])
        self.assertEqual(self.estado(a1)['fase'], 'livre')
        self.assertEqual(self.estado(a2)['fase'], 'pronta', 'para os outros a guerra segue')
        # inscrever noutra guerra com esta pendente também larga (o Cris)
        s, r = self.inscreve(b1, b2)
        self.assertEqual((s, r.get('motivo'), r.get('largada')), (409, 'vida-zero', {'herois': DUPLA}), r)
        self.assertEqual(sorted(self.saidas(e['gid'])), sorted([a1.conta['id'], b1.conta['id']]))
        # quem ficou fecha a guerra; quem largou não é regravado
        jogo = self.joga(e['ata'])
        self.envelhece(e['gid'])
        s, r = self.fecha(a2, e['gid'], jogo)
        self.assertEqual(s, 200, r)
        self.assertIn(r['fase'], ('won', 'lost', 'empate', 'aguardando'))
        self.assertTrue(all(hp == 0 for hp, _ in self.vida(a1).values()))
        # a largada de muito tempo atrás (mais de 2 h) só fecha a luta aberta, sem zerar
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        self.sql("UPDATE luta_aberta_guerra SET desde_ms = desde_ms - ? WHERE gid = ?", 3 * 3600 * 1000, e['gid'])
        s, r = a1.pede('POST', '/api/sala/abrir', {'dungeonId': 'cistern', 'roomIndex': 0, 'dificuldade': 'normal', 'herois': ['sumo']})
        self.assertNotIn('largada', r)
        self.assertEqual(self.sql("SELECT estado FROM luta_aberta_guerra WHERE conta_id = ? AND gid = ?", a1.conta['id'], e['gid'])[0]['estado'], 'fechada')

    def test_16_quem_troca_de_guilda_sai_da_fila(self):
        a1, a2 = self.conta('Ana'), self.conta('Bia')
        b1, b2 = self.conta('Cris'), self.conta('Duda')
        ga, gb = self.guilda(a1, a2), self.guilda(b1, b2)
        self.assertEqual(self.dupla_na_fila(a1, a2)['fase'], 'inscrito')
        s, r = a1.pede('POST', '/api/guilda/sair', {})
        self.assertEqual(s, 200, r)
        s, r = a1.pede('POST', '/api/guilda/entrar', {'gid': gb})
        self.assertEqual(s, 200, r)
        self.assertEqual(self.estado(a2)['fase'], 'livre', 'a inscrição de quem trocou de guilda cai')
        self.assertEqual([x.get('motivo') for x in self.eventos(a2, 'guerra-saiu')], ['guilda'])
        self.assertEqual(self.dupla_na_fila(b1, b2)['fase'], 'inscrito', 'ninguém para casar (a1 agora é da B)')
        # casada, e a troca antes de confirmar: 409 outra-guilda, a partida cai e o outro lado volta à fila
        c1, c2 = self.conta('Eva'), self.conta('Fábio')
        self.guilda(c1, c2)
        self.assertEqual(self.dupla_na_fila(c1, c2)['fase'], 'casada')
        s, r = c1.pede('POST', '/api/guilda/sair', {})
        self.assertEqual(s, 200, r)
        s, r = c1.pede('POST', '/api/guerra/confirmar', {})
        self.assertEqual((s, r.get('motivo')), (409, 'outra-guilda'), r)
        self.assertEqual(self.estado(b1)['fase'], 'inscrito', 'o outro lado volta à fila com o lugar')
        self.assertEqual(self.estado(c2)['fase'], 'livre')
        self.assertEqual([x.get('motivo') for x in self.eventos(b1, 'guerra-caiu')], ['guilda'])

    def test_17_semxp_ao_casar_e_a_pronta_sem_ata_cai(self):
        (a1, a2, b1, b2), (ga, gb) = self.casada()
        self.assertFalse(self.estado(a1)['semXp'])
        t = int(time.time())
        for i in range(guerra_mod.GUERRAS_XP_POR_PAR):
            self.sql("INSERT INTO guerra_resultados(gid, fase, venc, xp, guilda_xp, a_guilda, b_guilda, criado_em) "
                     "VALUES (?, 'won', 'A', 40, ?, ?, ?, ?)", 'velha-par-%d' % i, ga, ga, gb, t - 3600)
        self.assertTrue(self.estado(b2)['semXp'], 'os tetos avisam ANTES de confirmar')
        for c in (a1, a2, b1, b2):
            self.assertEqual(c.pede('POST', '/api/guerra/confirmar', {})[0], 200)
        e = self.estado(a1)
        for _ in range(20):
            if e.get('ata'):
                break
            time.sleep(0.2)
            e = self.estado(a1)
        self.assertEqual((e['fase'], e['semXp']), ('pronta', True))
        # a pronta cuja ata nunca saiu não fica pronta para sempre: cai depois de GUERRA_PRONTA_MS, com o evento
        self.sql("UPDATE guerra_partidas SET ata = NULL, pronta_ms = pronta_ms - ? WHERE gid = ?", guerra_mod.GUERRA_PRONTA_MS + 1000, e['gid'])
        self.assertEqual(self.estado(a1)['fase'], 'livre')
        self.assertEqual(self.sql("SELECT estado FROM guerra_partidas WHERE gid = ?", e['gid'])[0]['estado'], 'caiu')
        self.assertEqual([x.get('motivo') for x in self.eventos(b1, 'guerra-caiu')], ['ata'])
        self.assertEqual({x['estado'] for x in self.sql("SELECT estado FROM luta_aberta_guerra WHERE gid = ?", e['gid'])}, {'fechada'})

    def test_18_fechar_concorrente_paga_uma_vez(self):
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        jogo = self.joga(e['ata'])
        self.assertIn(jogo['venc'], ('A', 'B'), jogo['fase'])
        gv = ga if jogo['venc'] == 'A' else gb
        self.envelhece(e['gid'])
        saidas = {}

        def fecha(c, k):
            saidas[k] = self.fecha(c, e['gid'], jogo)
        fios = [threading.Thread(target=fecha, args=(c, i)) for i, c in enumerate((a1, a2, b1, b2))]
        for f in fios:
            f.start()
        for f in fios:
            f.join()
        self.assertEqual([saidas[k][0] for k in sorted(saidas)], [200] * 4, saidas)
        self.assertEqual({saidas[k][1]['xp'] for k in saidas}, {40})
        self.assertEqual(self.xp(gv), 40, 'os quatro fechando juntos pagam o XP uma vez só')
        self.assertEqual(self.resultados(), 1)
        self.assertEqual(len(self.sql("SELECT 1 FROM vida_heroi")), 8)

    def test_19_o_recusado_encerra_pelo_fechar_e_o_sair_da_pronta_sem_ata(self):
        """2ª rodada da revisão: o registro recusado (e o rápido demais) repetido depois da espera encerra a guerra
        pelo próprio fechar ('recusada') — o jogo repete o fechar a cada 5 s e não consulta o estado na tela de fim
        (ficava 422 'aguardando' com esperaMs 0 para sempre); e sair {gid} da pronta cuja ata não saiu derruba a
        guerra que não começou (respondia 'pronta' sem declarar nada)."""
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        jogo = self.joga(e['ata'])
        self.envelhece(e['gid'])
        forjado = copy.deepcopy(jogo['lances'])
        i = next(k for k, l in enumerate(forjado) if l.get('de') == a1.dono)
        forjado[i]['de'] = b1.dono
        torto = {'lances': forjado, 'hashFinal': jogo['hashFinal']}
        s, r = self.fecha(b1, e['gid'], torto)
        self.assertEqual((s, r.get('motivo'), r.get('fase')), (422, 'vez', 'aguardando'), r)
        s, r = self.fecha(b1, e['gid'], torto)
        self.assertEqual((s, r.get('fase')), (422, 'aguardando'), r)
        self.assertEqual(len(self.eventos(b1, 'guerra-recusada')), 1, 'o fechar repetido não repete o evento')
        self.espera_vencida(e['gid'])
        s, r = self.fecha(b1, e['gid'], torto)
        self.assertEqual((s, r['fase'], r.get('fechada'), r['xp'], r.get('motivo')), (200, 'recusada', True, 0, 'vez'), r)
        self.assertEqual(self.resultados(e['gid']), 1)
        self.assertEqual(self.estado(b1)['fase'], 'fechada')
        # o rápido demais, idem (a pronta não envelhece: segue rápido demais, e a espera vencida encerra)
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        jogo = self.joga(e['ata'])
        s, r = self.fecha(a1, e['gid'], jogo)
        self.assertEqual((s, r.get('motivo'), r.get('fase')), (422, 'rapido-demais', 'aguardando'), r)
        self.espera_vencida(e['gid'])
        s, r = self.fecha(a1, e['gid'], jogo)
        self.assertEqual((s, r['fase'], r.get('fechada'), r.get('motivo')), (200, 'recusada', True, 'rapido-demais'), r)
        self.assertEqual((self.xp(ga), self.xp(gb), self.contas_com_vida()), (0, 0, set()))
        # sair {gid} da pronta cuja ata ainda não saiu: a guerra que não começou cai para os quatro, sem custo, e o
        # outro lado volta à fila com o lugar (como a recusa da casada)
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        self.sql("UPDATE guerra_partidas SET ata = NULL WHERE gid = ?", e['gid'])
        s, r = self.sair(b2, e['gid'])
        self.assertEqual((s, r['fase']), (200, 'livre'), r)
        self.assertEqual(self.saidas(e['gid']), {}, 'ninguém saiu de uma guerra que não começou')
        self.assertEqual(self.sql("SELECT estado FROM guerra_partidas WHERE gid = ?", e['gid'])[0]['estado'], 'caiu')
        self.assertEqual(self.contas_com_vida(), set())
        self.assertEqual(self.estado(b1)['fase'], 'livre')
        self.assertEqual(self.estado(a1)['fase'], 'inscrito', 'o outro lado volta à fila')
        self.assertEqual([x.get('motivo') for x in self.eventos(a1, 'guerra-caiu')], ['saiu'])
        self.assertEqual({x['estado'] for x in self.sql("SELECT estado FROM luta_aberta_guerra WHERE gid = ?", e['gid'])}, {'fechada'})

    # -- 19/09: a 3ª rodada da revisão ---------------------------------------------------------------------------------
    def test_20_a_corrida_entre_sair_e_o_fechar_vazio_nao_devolve_a_vida(self):
        """ALTO da 3ª rodada: o ramo sem fim gravava a vida com o `saidas` lido ANTES do juiz — o sair {gid} (ou a
        largada de outra aba) que entrava nesse meio era sobrescrito pela vida do replay (com lances=[] a do começo), e a
        conta ficava 'livre' com a saída declarada e a vida cheia (provado 2 em 3 corridas). As saídas agora são relidas
        dentro da escrita."""
        for tentativa in range(3):
            (a1, a2, b1, b2), (ga, gb), e = self.pronta()
            self.envelhece(e['gid'])
            fora = {}

            def sai():
                fora['sair'] = self.sair(b1, e['gid'])

            def fecha():
                time.sleep(0.01)
                fora['fechar'] = self.fecha(b1, e['gid'], {'lances': [], 'hashFinal': None})
            fios = [threading.Thread(target=sai), threading.Thread(target=fecha)]
            for f in fios:
                f.start()
            for f in fios:
                f.join()
            self.assertEqual(fora['sair'][0], 200, fora['sair'])
            self.assertEqual(fora['fechar'][0], 200, fora['fechar'])
            self.assertEqual(self.saidas(e['gid']), {b1.conta['id']: 'saiu'})
            v = self.vida(b1)
            self.assertTrue(sorted(v) == sorted(DUPLA) and all(hp == 0 for hp, _ in v.values()),
                            'corrida %d: a saída declarada foi sobrescrita pela vida do replay: %r' % (tentativa, v))
            self.assertEqual(self.estado(b1)['fase'], 'livre')
        # a largada de "outra aba" (sala/abrir) correndo com o fechar vazio: a vida fica a 0 de qualquer jeito
        for tentativa in range(3):
            (a1, a2, b1, b2), (ga, gb), e = self.pronta()
            self.envelhece(e['gid'])
            fora = {}

            def abre():
                fora['sala'] = self.abre_sala(b1)

            def fecha2():
                time.sleep(0.01)
                fora['fechar'] = self.fecha(b1, e['gid'], {'lances': [], 'hashFinal': None})
            fios = [threading.Thread(target=abre), threading.Thread(target=fecha2)]
            for f in fios:
                f.start()
            for f in fios:
                f.join()
            self.assertEqual((fora['sala'][0], fora['sala'][1].get('motivo')), (409, 'vida-zero'), fora['sala'])
            self.assertEqual(self.saidas(e['gid']), {b1.conta['id']: 'largada'})
            v = self.vida(b1)
            self.assertTrue(sorted(v) == sorted(DUPLA) and all(hp == 0 for hp, _ in v.values()),
                            'corrida %d (largada): a vida do replay cobriu a largada: %r' % (tentativa, v))

    def test_21_o_fim_forcado_vale_para_o_fotografado(self):
        """MÉDIO da 3ª rodada: `fotografada: true` engolia o fim forçado que é fato do servidor — o W.O. provado pelo
        Relé e a saída declarada dos dois adversários viravam 'aguardando fotografada' → 'nao-conferida' (sem XP, sem
        punição). Agora o fotografado vai ao juiz com o registro VAZIO e `perdeu`: o lado ausente a 0, o presente com a
        vida do começo, XP nos tetos."""
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        largada = self.joga(e['ata'], para=6)
        self.envelhece(e['gid'])
        agora = int(time.time() * 1000)
        for c in (b1, b2):
            self.presenca(c, 'caiu', agora - 70000)
        s, r = self.fecha(a1, e['gid'], largada, fotografada=True, wo=True)
        self.assertEqual((s, r['fase'], r['venc'], r['xp'], r.get('fim')), (200, 'won', 'A', 40, 'wo'), r)
        for c in (b1, b2):
            self.assertTrue(all(hp == 0 and mx > 60 for hp, mx in self.vida(c).values()), self.vida(c))
        self.assertTrue(all(hp == mx for hp, mx in self.vida(a1).values()), 'o fotografado não refaz: a vida do começo %r' % self.vida(a1))
        self.assertEqual(len(self.sql("SELECT 1 FROM vida_heroi")), 8)
        self.assertEqual((self.xp(ga), self.xp(gb)), (40, 0))
        # os dois adversários declararam a saída, e quem ficou é fotografado: 'won' fim 'saida' na hora
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        largada = self.joga(e['ata'], para=4)
        self.envelhece(e['gid'])
        self.assertEqual(self.sair(b1, e['gid'])[0], 200)
        self.assertEqual(self.sair(b2, e['gid'])[0], 200)
        s, r = self.fecha(a1, e['gid'], largada, fotografada=True)
        self.assertEqual((s, r['fase'], r['venc'], r['xp'], r.get('fim')), (200, 'won', 'A', 40, 'saida'), r)
        self.assertEqual(self.xp(ga), 40)
        # o fotografado com o W.O. ainda sem a prova madura: 'aguardando wo' (em-luta, o vazio na espera) — e a prova
        # madura fecha o W.O. pela CONSULTA de qualquer um, com a vida do começo para quem ficou
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        self.envelhece(e['gid'])
        agora = int(time.time() * 1000)
        for c in (b1, b2):
            self.presenca(c, 'caiu', agora - 10000)
        s, r = self.fecha(a1, e['gid'], largada, fotografada=True, wo=True)
        self.assertEqual((s, r['fase'], r['motivo']), (200, 'aguardando', 'wo'), r)
        self.assertAlmostEqual(r['esperaMs'], 50000, delta=4000)
        self.assertEqual(self.estado(a1)['fase'], 'em-luta')
        self.assertEqual(self.sql("SELECT lances, motivo FROM guerra_espera WHERE gid = ?", e['gid']), [{'lances': '[]', 'motivo': 'wo'}])
        self.sql("UPDATE rele_presenca SET em_ms = em_ms - 70000")
        self.sql("UPDATE guerra_wo SET pedido_ms = pedido_ms - 70000 WHERE gid = ?", e['gid'])
        est = self.estado(b2)
        self.assertEqual((est['fase'], est['venc'], est['fim'], est['xp'], est['venceu']), ('fechada', 'A', 'wo', 40, False), est)
        self.assertTrue(all(hp == 0 for hp, _ in self.vida(b1).values()))
        self.assertTrue(all(hp == mx for hp, mx in self.vida(a2).values()), self.vida(a2))
        # o fotografado sem fim forçado nenhum segue esperando como antes
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        self.envelhece(e['gid'])
        s, r = self.fecha(a1, e['gid'], largada, fotografada=True)
        self.assertEqual((s, r['fase'], r['motivo']), (200, 'aguardando', 'fotografada'), r)

    def test_22_a_pronta_sem_ata_e_outra_luta_derruba_a_guerra(self):
        """MÉDIO da 3ª rodada: a pronta cuja ata ainda não saiu (o juiz lento) + sala/abrir punha a luta aberta como
        'fechada' sem derrubar nada — a sala abria e, quando a ata saía, a conta lutava em duas frentes sem a régua da
        largada. Agora é o mesmo de sair {gid}: a guerra que não começou cai para os quatro, sem custo, e o outro lado
        volta à fila com o lugar."""
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        self.sql("UPDATE guerra_partidas SET ata = NULL WHERE gid = ?", e['gid'])
        s, r = self.abre_sala(a1)
        self.assertEqual(s, 200, r)
        self.assertNotIn('largada', r, 'a guerra que não começou não custa nada')
        self.assertEqual(self.sql("SELECT estado FROM guerra_partidas WHERE gid = ?", e['gid'])[0]['estado'], 'caiu')
        self.assertEqual({x['estado'] for x in self.sql("SELECT estado FROM luta_aberta_guerra WHERE gid = ?", e['gid'])}, {'fechada'})
        self.assertEqual((self.saidas(e['gid']), self.contas_com_vida()), ({}, set()))
        self.assertEqual(self.estado(a1)['fase'], 'livre')
        self.assertEqual(self.estado(a2)['fase'], 'livre')
        self.assertEqual(self.estado(b1)['fase'], 'inscrito', 'o outro lado volta à fila com o lugar')
        self.assertEqual([x.get('motivo') for x in self.eventos(b1, 'guerra-caiu')], ['saiu'])
        # a ata que chega depois não ressuscita a partida
        self.assertEqual(self.sql("SELECT ata FROM guerra_partidas WHERE gid = ?", e['gid'])[0]['ata'], None)
        self.assertEqual(self.estado(a1)['fase'], 'livre')

    def test_23_o_wo_em_espera_fica_persistido_e_a_consulta_o_fecha(self):
        """MÉDIO da 3ª rodada: o 'aguardando wo' não ficava em lugar nenhum — o estado de quem declarou era 'pronta', a
        consulta nunca lia a prova madura, quem ficou e declarou era largado a 0 ao abrir outra luta e a partida ficava
        'pronta' para sempre. Agora o replay de quem declarou fica na espera (motivo 'wo', 'em-luta'), a prova madura
        fecha o W.O. pela consulta de qualquer um dos quatro e a espera vencida encerra 'wo-sem-prova'."""
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        largada = self.joga(e['ata'], para=6)
        self.envelhece(e['gid'])
        agora = int(time.time() * 1000)
        for c in (b1, b2):
            self.presenca(c, 'caiu', agora - 10000)             # caíram há 10 s: 'cedo'
        s, r = self.fecha(a1, e['gid'], largada, wo=True)
        self.assertEqual((s, r['fase'], r['motivo']), (200, 'aguardando', 'wo'), r)
        est = self.estado(a1)
        self.assertEqual(est['fase'], 'em-luta', 'quem já fechou a parte dela (o W.O.) espera os outros')
        self.assertTrue(est['esperaMs'] > 0)
        self.assertEqual([x['motivo'] for x in self.sql("SELECT motivo FROM guerra_espera WHERE gid = ?", e['gid'])], ['wo'])
        self.assertIsNotNone(self.sql("SELECT primeiro_fecho FROM guerra_partidas WHERE gid = ?", e['gid'])[0]['primeiro_fecho'])
        self.assertEqual(self.contas_com_vida(), {a1.conta['id']})
        # a prova madura (60 s passam) e ninguém repete o fechar (a página da Ana foi embora): a consulta da Bia resolve
        self.sql("UPDATE rele_presenca SET em_ms = em_ms - 70000")
        self.sql("UPDATE guerra_wo SET pedido_ms = pedido_ms - 70000 WHERE gid = ?", e['gid'])
        est = self.estado(a2)
        self.assertEqual((est['fase'], est['venc'], est['fim'], est['xp'], est['venceu']), ('fechada', 'A', 'wo', 40, True), est)
        self.assertEqual((self.xp(ga), self.xp(gb)), (40, 0))
        for c in (b1, b2):
            self.assertTrue(all(hp == 0 and mx > 60 for hp, mx in self.vida(c).values()), self.vida(c))
        self.assertFalse(all(hp == 0 for hp, _ in self.vida(a1).values()), 'quem ficou e declarou o W.O. não acaba a 0')
        self.assertEqual(len(self.sql("SELECT 1 FROM vida_heroi")), 8)
        self.assertEqual([x.get('fim') for x in self.eventos(a1, 'guerra-fim')], ['wo'])
        # a Ana abre um calabouço depois: a guerra já fechou — nada a larga
        s, r = self.abre_sala(a1)
        self.assertNotIn('largada', r, r)
        self.assertEqual(self.saidas(e['gid']), {})
        # o W.O. da Ana repetido depois lê o guardado
        s, r = self.fecha(a1, e['gid'], largada, wo=True)
        self.assertEqual((s, r['fase'], r['xp'], r.get('fim')), (200, 'won', 40, 'wo'))
        # o único fechar é um W.O. sem queda anotada e ninguém mais fecha: a espera acaba pela consulta, 'wo-sem-prova'
        self.sql("DELETE FROM vida_heroi")
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        largada = self.joga(e['ata'], para=6)
        self.envelhece(e['gid'])
        s, r = self.fecha(a1, e['gid'], largada, wo=True)
        self.assertEqual((s, r['fase'], r['motivo']), (200, 'aguardando', 'wo'), r)
        self.assertAlmostEqual(r['esperaMs'], 60000, delta=4000)
        self.assertEqual(self.estado(a1)['fase'], 'em-luta')
        self.assertEqual(self.estado(b1)['fase'], 'pronta')
        self.sql("UPDATE guerra_wo SET pedido_ms = pedido_ms - 600000 WHERE gid = ?", e['gid'])
        self.espera_vencida(e['gid'])
        for c in (a1, a2, b1, b2):
            self.estado(c)
        self.assertEqual(self.resultados(e['gid']), 1, 'a espera de um fim que não veio encerra pela consulta')
        est = self.estado(a1)
        self.assertEqual((est['fase'], est['resultado'], est['motivo'], est['xp']), ('fechada', 'playing', 'wo-sem-prova', 0), est)
        self.assertEqual(len(self.sql("SELECT 1 FROM vida_heroi")), 8, 'a vida do replay para os oito')
        self.assertEqual((self.xp(ga), self.xp(gb)), (0, 0))

    def test_24_a_queda_entre_a_casada_e_a_pronta_prova_o_wo(self):
        """BAIXO da 3ª rodada: a prova contava desde pronta_ms — quem confirmou pelo HTTP com o Relé já caído (e nunca
        voltou) não tinha 'caiu' depois da pronta. Agora conta desde a casada (criada_ms); a queda de antes da casada
        segue não contando."""
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        largada = self.joga(e['ata'], para=6)
        self.envelhece(e['gid'])
        self.sql("UPDATE guerra_partidas SET criada_ms = pronta_ms - 20000 WHERE gid = ?", e['gid'])   # 20 s entre a casada e a pronta
        p = self.sql("SELECT pronta_ms, criada_ms FROM guerra_partidas WHERE gid = ?", e['gid'])[0]
        for c in (b1, b2):
            self.presenca(c, 'caiu', p['pronta_ms'] - 5000)      # 5 s antes da pronta (depois da casada), sem voltar
        s, r = self.fecha(a1, e['gid'], largada, wo=True)
        self.assertEqual((s, r['fase'], r['venc'], r.get('fim'), r['xp']), (200, 'won', 'A', 'wo', 40), r)
        # a queda de ANTES da casada não é desta guerra
        (a1, a2, b1, b2), (ga, gb), e = self.pronta()
        largada = self.joga(e['ata'], para=6)
        self.envelhece(e['gid'])
        p = self.sql("SELECT pronta_ms, criada_ms FROM guerra_partidas WHERE gid = ?", e['gid'])[0]
        for c in (b1, b2):
            self.presenca(c, 'caiu', p['criada_ms'] - 5000)
        s, r = self.fecha(a1, e['gid'], largada, wo=True)
        self.assertEqual((s, r['fase'], r['motivo']), (200, 'aguardando', 'wo'), r)


if __name__ == '__main__':
    unittest.main(verbosity=2)
