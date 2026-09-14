#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova da SALA EM GRUPO e do DUELO RANQUEADO no servidor (servidor/grupo.py), com o JUIZ de verdade.

    python tests/grupo_duelo_api.py

Sobe o juiz (servidor/juiz/juiz.js) e a API com --juiz num banco descartável, e joga
de verdade por tests/juiz_grupo_jogador.js (as simulações de tests/juiz_grupo.js numa
linha de comando: a IA decide os lances das pessoas, cada lance com o dono).

A SALA EM GRUPO: o líder abre com a dupla conferida no estado de cada conta; com um
registro limpo, o juiz refaz uma vez e os DOIS estados são pagos numa transação (o
segundo membro recebe o recibo guardado); o fechamento fotografado espera um limpo e,
passados 120 s, a sala fica 'nao-conferida'; lance adulterado recusa; sala largada
fica 'perdida'.
O DUELO: ranqueado muda a Brasa nos DOIS estados e no ranking da arena; o did torna o
fechamento idempotente; fotografado e acima dos tetos (par e conta, 24 h) não ranqueia;
o fim forjado recusa. As provas se pulam sozinhas se o juiz não tiver as rotas.

As réguas de tempo da API são afrouxadas pelo ambiente (SOTERRA_SALA_MIN_S=0); os
processos rodam com prioridade abaixo do normal (a máquina é dividida com quem joga).
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
from autoridade_api import BAIXA, ESTADO_JS, JUIZ, NODE, espera_url, roda_node, status_de  # noqa: E402

JOGADORES = os.path.join(AQUI, 'juiz_grupo_jogador.js')
CANDIDATAS = [['cistern', 0, s] for s in (3, 17, 41, 77, 123)] + [['greenhouse', 0, s] for s in (3, 17, 41)]


class ProvaDoGrupoEDuelo(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls):
        if NODE is None:
            raise unittest.SkipTest('sem node nesta máquina: o juiz não sobe')
        cls.pasta = tempfile.mkdtemp(prefix='soterra-grupo-')
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
            env.update(SOTERRA_SALA_MIN_S='0', SOTERRA_SALA_S_POR_TURNO='0')
            porta = porta_livre()
            p = cls._processo('api', [sys.executable, API, '--porta', str(porta), '--banco', cls.banco_arq,
                                      '--juiz', cls.juiz], env)
            cls.base = 'http://127.0.0.1:%d' % porta
            if not espera_api(cls.base, p, 30):
                raise RuntimeError('a API não subiu; veja ' + cls.pasta)
            cls.tem_grupo = status_de(cls.juiz + '/grupo/fecha', {}) != 404
            cls.tem_duelo = status_de(cls.juiz + '/duelo/fecha', {}) != 404
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
    def novo(self, apelido):
        ProvaDoGrupoEDuelo._n += 1
        c = Cliente(self.base)
        status, r = c.cadastra('%s %d' % (apelido, ProvaDoGrupoEDuelo._n))
        self.assertEqual(status, 201, r)
        return c

    def sql(self, consulta, *args):
        b = sqlite3.connect(self.banco_arq)
        b.row_factory = sqlite3.Row
        try:
            linhas = [dict(r) for r in b.execute(consulta, args).fetchall()]
            b.commit()
            return linhas
        finally:
            b.close()

    def com_estado(self, apelido, heroi, nivel):
        c = self.novo(apelido)
        p, d = copy.deepcopy(self.inicial['progress']), copy.deepcopy(self.inicial['db'])
        p['heroes'][heroi]['level'] = nivel
        p['heroes'][heroi]['xp'] = self.inicial['xp'][nivel - 1]
        status, r = c.salva(0, p, d)
        self.assertEqual(status, 200, r)
        return c

    def save(self, c):
        status, r = c.pede('GET', '/api/save')
        self.assertEqual(status, 200, r)
        return r

    def dupla(self, nivel=22):
        return self.com_estado('Ana Grupo', 'sumo', nivel), self.com_estado('Bia Grupo', 'curandeiro', nivel)

    def membros(self, ana, bia):
        sa, sb = self.save(ana), self.save(bia)
        return [{'progress': sa['progress'], 'db': sa['db'], 'dono': 'ana', 'herois': ['sumo']},
                {'progress': sb['progress'], 'db': sb['db'], 'dono': 'bia', 'herois': ['curandeiro']}]

    def corpo_abrir(self, bia, dungeon='cistern', sala=0, **kw):
        corpo = {'dungeonId': dungeon, 'roomIndex': sala, 'dificuldade': 'normal', 'herois': ['sumo'], 'dono': 'ana',
                 'parceiro': {'conta': bia.conta['id'], 'dono': 'bia', 'herois': ['curandeiro']}}
        corpo.update(kw)
        return corpo

    def abre_vencivel(self, ana, bia):
        """Acha uma sala que a dupla vence, abre, fixa a semente (só no banco da prova) e joga."""
        achada = roda_node([JOGADORES], {'modo': 'procura-grupo', 'membros': self.membros(ana, bia),
                                         'candidatos': CANDIDATAS})
        self.assertEqual(achada['fase'], 'won', 'nenhuma sala candidata é vencida pela dupla')
        status, r = ana.pede('POST', '/api/grupo/abrir', self.corpo_abrir(bia, achada['dungeonId'], achada['roomIndex']))
        self.assertEqual(status, 200, r)
        self.sql("UPDATE salas_grupo SET semente = ? WHERE gid = ?", achada['semente'], r['gid'])
        return r['gid'], achada

    def fecha_grupo(self, c, gid, jogo, **kw):
        corpo = {'gid': gid, 'lances': jogo['lances'], 'hashFinal': jogo['hash'], 'fotografada': False, 'autoridade': True}
        corpo.update(kw)
        return c.pede('POST', '/api/grupo/fechar', corpo)

    def precisa(self, rota):
        if not getattr(self, 'tem_' + rota):
            self.skipTest('o juiz ainda não tem POST /%s/fecha' % rota)

    # -- a sala em grupo -------------------------------------------------------------------------
    def test_01_grupo_abrir_confere(self):
        self.precisa('grupo')
        sozinha = self.novo('Sem Estado')
        ana, bia = self.dupla()
        status, r = sozinha.pede('POST', '/api/grupo/abrir', self.corpo_abrir(bia))
        self.assertEqual(status, 409, r)
        c = self.novo('Parceira Nova')
        banida = self.com_estado('Banida Grupo', 'curandeiro', 5)
        self.sql("UPDATE contas SET banido = 1 WHERE id = ?", banida.conta['id'])
        casos = [({'parceiro': {'conta': ana.conta['id'], 'dono': 'bia', 'herois': ['curandeiro']}}, 400),
                 ({'parceiro': {'conta': 999999, 'dono': 'bia', 'herois': ['curandeiro']}}, 404),
                 ({'parceiro': {'conta': banida.conta['id'], 'dono': 'bia', 'herois': ['curandeiro']}}, 404),
                 ({'parceiro': {'conta': c.conta['id'], 'dono': 'bia', 'herois': ['curandeiro']}}, 409),
                 ({'dono': 'bia'}, 400), ({'herois': ['nada']}, 400), ({'roomIndex': 9}, 400),
                 ({'parceiro': {'conta': bia.conta['id'], 'dono': 'bia', 'herois': ['bruxo']}}, 400),
                 ({'dificuldade': 'insano'}, 400), ({'parceiro': None}, 400)]
        for mexe, esperado in casos:
            status, r = ana.pede('POST', '/api/grupo/abrir', self.corpo_abrir(bia, **mexe))
            self.assertEqual(status, esperado, (mexe, r))
        status, r1 = ana.pede('POST', '/api/grupo/abrir', self.corpo_abrir(bia))
        self.assertEqual(status, 200, r1)
        self.assertTrue(isinstance(r1['semente'], int) and r1['carry'] is None, r1)
        status, r2 = ana.pede('POST', '/api/grupo/abrir', self.corpo_abrir(bia))
        self.assertEqual(status, 200, r2)
        self.assertEqual(self.sql("SELECT estado FROM salas_grupo WHERE gid = ?", r1['gid'])[0]['estado'], 'vencida')
        self.assertEqual(self.sql("SELECT party FROM salas_grupo WHERE gid = ?", r2['gid'])[0]['party'],
                         json.dumps([{'conta': ana.conta['id'], 'dono': 'ana', 'herois': ['sumo']},
                                     {'conta': bia.conta['id'], 'dono': 'bia', 'herois': ['curandeiro']}]))

    def test_02_grupo_vitoria_paga_os_dois(self):
        self.precisa('grupo')
        ana, bia = self.dupla()
        fora = self.com_estado('Curiosa Grupo', 'sumo', 3)
        gid, jogo = self.abre_vencivel(ana, bia)
        status, r = self.fecha_grupo(fora, gid, jogo)
        self.assertEqual(status, 404, r)
        status, r = self.fecha_grupo(ana, gid, jogo)
        self.assertEqual(status, 200, r)
        self.assertEqual((r['fase'], r['versao']), ('won', 2))
        self.assertIsInstance(r['recompensa'], dict)
        sa, sb = self.save(ana), self.save(bia)
        self.assertEqual((sa['versao'], sb['versao']), (2, 2), 'os DOIS estados são pagos')
        self.assertEqual((sa['progress'], sa['hash']), (r['progress'], r['hash']))
        pagos = self.sql("SELECT conta_id, recompensa FROM salas_grupo_pago WHERE gid = ? ORDER BY conta_id", gid)
        self.assertEqual(sorted(p['conta_id'] for p in pagos), sorted([ana.conta['id'], bia.conta['id']]))
        # o recibo de cada um (o XP do herói pode nem subir: o rendimento decrescente do jogo num nível 22)
        for p in pagos:
            self.assertGreater(json.loads(p['recompensa'])['xpGanho'], 0, p['conta_id'])
        self.assertEqual(sb['hash'], self.sql("SELECT hash FROM autoridade WHERE conta_id = ?", bia.conta['id'])[0]['hash'])
        self.assertEqual(self.sql("SELECT estado FROM salas_grupo WHERE gid = ?", gid)[0]['estado'], 'paga')
        # 14/09, a vida única: o fim de cada herói fica na linha da conta DELE
        carry = json.loads(self.sql("SELECT carry_saida FROM salas_grupo WHERE gid = ?", gid)[0]['carry_saida'])
        for c, heroi, dono in ((ana, 'sumo', 'ana'), (bia, 'curandeiro', 'bia')):
            linha = self.sql("SELECT hp_fim, hp_max FROM vida_heroi WHERE conta_id = ? AND heroi = ?", c.conta['id'], heroi)
            self.assertEqual(len(linha), 1, heroi)
            self.assertEqual(linha[0]['hp_fim'], min(carry[dono + ':' + heroi], linha[0]['hp_max']), heroi)
        for c in (ana, bia):
            self.assertEqual(len(self.sql("SELECT 1 FROM eventos WHERE conta_id = ? AND tipo = 'grupo-paga'", c.conta['id'])), 1)
            self.assertEqual(self.sql("SELECT hash FROM autoridade WHERE conta_id = ?", c.conta['id'])[0]['hash'],
                             self.save(c)['hash'])
            for e in self.save(c)['progress']['inventory']:
                if isinstance(e, dict) and e.get('iid'):
                    self.assertEqual(self.sql("SELECT conta_id, estado FROM itens WHERE iid = ?", e['iid']),
                                     [{'conta_id': c.conta['id'], 'estado': 'vivo'}])
        # o outro membro fecha depois: recebe o recibo DELE, sem pagar de novo
        status, rb = self.fecha_grupo(bia, gid, jogo)
        self.assertEqual(status, 200, rb)
        do_banco = [json.loads(p['recompensa']) for p in pagos if p['conta_id'] == bia.conta['id']][0]
        self.assertEqual((rb['fase'], rb['recompensa'], rb['versao']), ('won', do_banco, 2))

    def test_03_grupo_fotografada_espera_o_limpo(self):
        self.precisa('grupo')
        ana, bia = self.dupla()
        gid, jogo = self.abre_vencivel(ana, bia)
        status, r = self.fecha_grupo(bia, gid, {'lances': [], 'hash': None}, fotografada=True)
        self.assertEqual(status, 200, r)
        self.assertEqual((r['fase'], r['recompensa']), ('aguardando', None))
        self.assertGreater(r['esperaAte'], time.time())
        status, r = self.fecha_grupo(ana, gid, jogo)                    # o limpo chega dentro da espera: paga
        self.assertEqual((status, r.get('fase')), (200, 'won'), r)
        status, r = self.fecha_grupo(bia, gid, {'lances': [], 'hash': None}, fotografada=True)
        self.assertEqual((status, r['fase'], r['versao']), (200, 'won', 2), r)
        self.assertIsInstance(r['recompensa'], dict)

    def test_04_grupo_nao_conferida(self):
        self.precisa('grupo')
        ana, bia = self.dupla()
        gid, jogo = self.abre_vencivel(ana, bia)
        status, r = self.fecha_grupo(ana, gid, jogo, fotografada=True)
        self.assertEqual((status, r['fase']), (200, 'aguardando'), r)
        self.sql("UPDATE salas_grupo SET primeiro_fecho = ? WHERE gid = ?", int(time.time()) - 121, gid)
        status, r = self.fecha_grupo(bia, gid, jogo)                    # o limpo chegou tarde demais
        self.assertEqual(status, 200, r)
        self.assertEqual((r['fase'], r['recompensa'], r['erro']),
                         ('nao-conferida', None, 'a sala em grupo teve uma sincronização por foto e não pôde ser conferida'))
        self.assertEqual((self.save(ana)['versao'], self.save(bia)['versao']), (1, 1))

    def test_05_grupo_adulterado_e_largado(self):
        self.precisa('grupo')
        ana, bia = self.dupla()
        gid, jogo = self.abre_vencivel(ana, bia)
        torto = copy.deepcopy(jogo)
        i = next(i for i, l in enumerate(torto['lances']) if l['a'] == 'm' and l['de'] == 'ana')
        torto['lances'][i]['de'] = 'bia'                              # lance da Bia com o herói da Ana
        status, r = self.fecha_grupo(bia, gid, torto)
        self.assertEqual((status, r.get('motivo')), (422, 'vez'), r)
        self.assertEqual(self.sql("SELECT estado FROM salas_grupo WHERE gid = ?", gid)[0]['estado'], 'recusada')
        status, r = self.fecha_grupo(ana, gid, jogo)
        self.assertEqual((status, r['fase'], r['motivo']), (200, 'recusada', 'vez'), r)
        self.assertEqual((self.save(ana)['versao'], self.save(bia)['versao']), (1, 1))
        vidas = "SELECT COUNT(*) AS n FROM vida_heroi WHERE conta_id IN (?, ?)"
        self.assertEqual(self.sql(vidas, ana.conta['id'], bia.conta['id'])[0]['n'], 0, 'a sala recusada não grava vida')
        # sala largada no meio: perdida, a economia não muda — 14/09: a vida de cada um é gravada
        gid2, jogo2 = self.abre_vencivel(ana, bia)
        status, r = self.fecha_grupo(ana, gid2, {'lances': jogo2['lances'][:3], 'hash': None})
        self.assertEqual(status, 200, r)
        self.assertEqual((r['fase'], r['recompensa']), ('perdida', None))
        self.assertEqual((self.save(ana)['versao'], self.save(bia)['versao']), (1, 1))
        self.assertEqual(self.sql(vidas, ana.conta['id'], bia.conta['id'])[0]['n'], 2)

    # -- o duelo ranqueado ----------------------------------------------------------------------------
    def joga_duelo(self, a, b, semente=999):
        sa, sb = self.save(a), self.save(b)
        return roda_node([JOGADORES], {'modo': 'duelo', 'dungeonId': 'cistern', 'roomIndex': 0, 'semente': semente,
                                       'A': {'progress': sa['progress'], 'db': sa['db'], 'dono': 'ana', 'herois': ['sumo']},
                                       'B': {'progress': sb['progress'], 'db': sb['db'], 'dono': 'bia',
                                             'herois': ['curandeiro']}})

    def corpo_duelo(self, a, b, did, jogo, **kw):
        corpo = {'did': did, 'dungeonId': 'cistern', 'roomIndex': 0, 'semente': 999,
                 'A': {'conta': a.conta['id'], 'dono': 'ana', 'herois': ['sumo']},
                 'B': {'conta': b.conta['id'], 'dono': 'bia', 'herois': ['curandeiro']},
                 'lances': jogo['lances'], 'hashFinal': jogo['hash'], 'fotografada': False}
        corpo.update(kw)
        return corpo

    def did(self):
        ProvaDoGrupoEDuelo._n += 1
        return 'duelo-prova-%d' % ProvaDoGrupoEDuelo._n

    def duplas_de_duelo(self):
        return self.com_estado('Ana Duelo', 'sumo', 20), self.com_estado('Bia Duelo', 'curandeiro', 20)

    def test_10_duelo_ranqueado_nos_dois(self):
        self.precisa('duelo')
        a, b = self.duplas_de_duelo()
        fora = self.com_estado('Plateia Duelo', 'sumo', 3)
        jogo = self.joga_duelo(a, b)
        self.assertIn(jogo['fase'], ('won', 'lost', 'empate'))
        did = self.did()
        status, r = fora.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo))
        self.assertEqual(status, 403, r)
        status, r = a.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, a, self.did(), jogo))
        self.assertEqual(status, 400, r)
        status, r = a.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo))
        self.assertEqual(status, 200, r)
        self.assertTrue(r['ranqueado'])
        self.assertEqual((r['fase'], r['versao']), (jogo['fase'], 2))
        self.assertIn('sumo', r['vida'], '14/09: a resposta traz a vida de quem pede (a prova inteira: tests/pocoes_api.py)')
        sa, sb = self.save(a), self.save(b)
        self.assertEqual((sa['versao'], sb['versao']), (2, 2))
        ba, bb = sa['db']['jogador']['brasa'], sb['db']['jogador']['brasa']
        self.assertEqual((ba['partidas'], bb['partidas']), (1, 1), 'a Brasa muda nos DOIS estados')
        self.assertEqual(ba['pts'], self.inicial['db']['jogador']['brasa']['pts'] + r['delta'])
        if r['venc'] != 'empate':
            self.assertEqual(r['delta'] > 0, r['venc'] == 'A')
        resumos = {x['conta_id']: x for x in self.sql("SELECT conta_id, brasa_pts, brasa_partidas FROM resumos "
                                                        "WHERE conta_id IN (?, ?)", a.conta['id'], b.conta['id'])}
        self.assertEqual(resumos[a.conta['id']]['brasa_partidas'], 1)
        self.assertEqual(resumos[b.conta['id']]['brasa_pts'], bb['pts'], 'os pontos chegam ao ranking da arena')
        self.assertEqual(len(self.sql("SELECT 1 FROM eventos WHERE tipo = 'duelo-ranqueado' AND conta_id IN (?, ?)",
                                      a.conta['id'], b.conta['id'])), 2)
        # o outro lado fecha o MESMO duelo: o resultado guardado, sem gravar de novo
        status, r2 = b.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo))
        self.assertEqual(status, 200, r2)
        self.assertEqual((r2['fase'], r2['venc'], r2['ranqueado'], r2['versao']), (r['fase'], r['venc'], True, 2))
        self.assertEqual(r2['delta'], bb['pts'] - self.inicial['db']['jogador']['brasa']['pts'])
        status, r3 = fora.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo))
        self.assertEqual(status, 404, r3)

    def test_11_duelo_fotografado_nao_ranqueia(self):
        self.precisa('duelo')
        a, b = self.duplas_de_duelo()
        jogo = self.joga_duelo(a, b)
        status, r = a.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, self.did(), jogo, fotografada=True))
        self.assertEqual(status, 200, r)
        self.assertEqual((r['fase'], r['ranqueado'], r['versao']), ('nao-conferido', False, 1))
        self.assertEqual(self.save(b)['versao'], 1)

    def test_12_duelo_tetos(self):
        self.precisa('duelo')
        a, b = self.duplas_de_duelo()
        jogo = self.joga_duelo(a, b)
        t = int(time.time())
        for i in range(3):                                            # o par já duelou 3 vezes ranqueado hoje
            self.sql("INSERT INTO duelos(did, a_id, b_id, fase, venc, criado_em, resultado) VALUES (?, ?, ?, 'won', 'A', ?, '{}')",
                     'antigo-par-%d-%d' % (a.conta['id'], i), b.conta['id'] if i % 2 else a.conta['id'],
                     a.conta['id'] if i % 2 else b.conta['id'], t - 60)
        did = self.did()
        status, r = a.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo))
        self.assertEqual(status, 200, r)
        self.assertEqual((r['ranqueado'], r['motivo'], r['versao']), (False, 'teto', 1))
        self.assertEqual(self.sql("SELECT fase FROM duelos WHERE did = ?", did)[0]['fase'], 'teto')
        # o teto por conta: 20 ranqueados de uma conta com uma terceira
        c, d = self.duplas_de_duelo()
        terceira = self.com_estado('Terceira Duelo', 'sumo', 3)
        for i in range(20):
            self.sql("INSERT INTO duelos(did, a_id, b_id, fase, venc, criado_em, resultado) VALUES (?, ?, ?, 'won', 'A', ?, '{}')",
                     'antigo-conta-%d-%d' % (c.conta['id'], i), c.conta['id'], terceira.conta['id'], t - 60)
        jogo2 = self.joga_duelo(c, d)
        status, r = d.pede('POST', '/api/duelo/fechar', self.corpo_duelo(c, d, self.did(), jogo2))
        self.assertEqual(status, 200, r)
        self.assertEqual((r['ranqueado'], r['motivo']), (False, 'teto'))
        self.assertEqual((self.save(c)['versao'], self.save(d)['versao']), (1, 1))

    def test_13_duelo_forjado_recusa(self):
        self.precisa('duelo')
        a, b = self.duplas_de_duelo()
        jogo = self.joga_duelo(a, b)
        did = self.did()
        status, r = a.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo,
                                                                          hashFinal=(jogo['hash'] + 7) % (2 ** 32)))
        self.assertEqual((status, r.get('motivo')), (422, 'divergiu'), r)
        status, r = b.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did, jogo))
        self.assertEqual(status, 200, r)
        self.assertEqual((r['fase'], r['ranqueado'], r['motivo']), ('recusado', False, 'divergiu'))
        self.assertEqual((self.save(a)['versao'], self.save(b)['versao']), (1, 1))


if __name__ == '__main__':
    unittest.main(verbosity=2)
