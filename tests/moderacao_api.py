#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova da moderação (servidor/moderacao.py), pela API de verdade — com o juiz.

    python tests/moderacao_api.py

Sobe o juiz (servidor/juiz/juiz.js) e duas APIs no MESMO banco descartável: uma
com --juiz e outra com o juiz apontando para uma porta morta (o "pôr no
inventário" sem juiz). O Mestre é marcado pelo SQL (contas.gm = 1), como o
`admin mestre` faz.

O que se prova (pedido do dono, 02/10: o painel do Mestre dentro do jogo,
banimento temporário ou permanente com motivo, silêncio, denúncias com fila e
retorno, auditoria de toda ação do Mestre):
  - o PORTÃO: as rotas novas do Mestre dão 401 sem token e 403 (a frase do
    painel) a quem não é Mestre, antes de olhar o corpo;
  - o BANIMENTO: 1h/24h/7d/30d/permanente/personalizado, motivo obrigatório; toda
    rota com conta dá 403 com {motivo, fim}; o login também, só DEPOIS da senha;
    sair e perguntar por quê passam; o prazo vence sozinho no próximo pedido
    (linha 'expirou', contas.banido volta a 0); desbanir; banir de novo troca a
    linha; o Mestre não bane a si mesmo nem outro Mestre; o banimento de antes
    (o `admin banir` sem linha) é permanente; o `admin desbanir` (0 pelo SQL)
    manda;
  - o SILÊNCIO: com prazo, lido em /api/moderacao/eu, desfeito;
  - a DENÚNCIA: validação, falas marcadas como relato do cliente, 1 por alvo por
    hora, 10 por dia; a fila do Mestre (contagem, estados, fechada é final), a
    ação ligada (a procedente bane com o id da denúncia) e a carta ao denunciante
    (sem dizer a punição);
  - a AUDITORIA: cada ação na mesma transação; as rotas antigas do Mestre pelo
    gancho do despacha (o e-mail buscado mascarado); a Caixa pelo /api/op;
  - o PÔR NO INVENTÁRIO: pelo juiz, com estrelas, nível e quantidade, as séries
    registradas com a origem 'caixa', o estado devolvido ao próprio Mestre (o
    jogo adota), idem, peça só no próprio Mestre, selos em outra conta, op
    interna recusada do cliente, sem juiz 503.
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

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402  (põe servidor/ no sys.path)
from autoridade_api import BAIXA, ESTADO_JS, JUIZ, NODE, PECA, espera_url, roda_node  # noqa: E402
import mestre as mestre_mod  # noqa: E402
import moderacao as mod  # noqa: E402

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

FRASE = mestre_mod.FRASE_SO_MESTRE
SENHA = 'segredo-bom-8'
ROTAS_MESTRE = (('POST', '/api/mestre/banir', {'conta': 1, 'duracao': '1h', 'motivo': 'abc'}),
                ('POST', '/api/mestre/desbanir', {'conta': 1}),
                ('POST', '/api/mestre/silenciar', {'conta': 1, 'duracao': '1h', 'motivo': 'abc'}),
                ('POST', '/api/mestre/dessilenciar', {'conta': 1}),
                ('GET', '/api/mestre/banimentos', None), ('GET', '/api/mestre/denuncias', None),
                ('POST', '/api/mestre/denuncia', {'id': 1, 'estado': 'em-analise'}),
                ('GET', '/api/mestre/auditoria', None),
                ('POST', '/api/mestre/dar', {'tipo': 'selos', 'elemento': 'fogo', 'n': 1, 'idem': 'abcdefgh1'}))


def idem():
    return secrets.token_hex(8)


class ProvaDaModeracao(unittest.TestCase):
    _n = 0
    procs = []

    @classmethod
    def setUpClass(cls):
        if NODE is None:
            raise unittest.SkipTest('sem node nesta máquina: o juiz não sobe')
        cls.pasta = tempfile.mkdtemp(prefix='soterra-moderacao-')
        cls.banco_arq = os.path.join(cls.pasta, 'dados', 'soterra.db')
        cls.logs, cls.procs = [], []
        try:
            porta_juiz = porta_livre()
            cls.juiz = 'http://127.0.0.1:%d' % porta_juiz
            pj = cls._processo('juiz', [NODE, JUIZ, '--porta', str(porta_juiz)])
            if not espera_url(cls.juiz + '/saude', pj):
                raise RuntimeError('o juiz não subiu; veja ' + cls.pasta)
            codigo = ("const est = require(process.argv[1]); const w = est.mundoEconomico({}); est.poeEstado(w, null, null);"
                      "const s = est.tiraEstado(w); process.stdout.write(JSON.stringify({progress: s.progress, db: s.db}));")
            cls.inicial = roda_node(['-e', codigo, ESTADO_JS])
            env = {k: v for k, v in os.environ.items() if not k.startswith('SOTERRA_')}
            cls.base = cls._api('api', env, cls.juiz)
            cls.base_sem_juiz = cls._api('api-sem-juiz', env, 'http://127.0.0.1:%d' % porta_livre())
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
    def _api(cls, nome, env, juiz):
        porta = porta_livre()
        p = cls._processo(nome, [sys.executable, API, '--porta', str(porta), '--banco', cls.banco_arq, '--juiz', juiz], env)
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

    # -- ajudantes --------------------------------------------------------------------------------
    def novo(self, apelido, base=None):
        ProvaDaModeracao._n += 1
        c = Cliente(base or self.base)
        status, r = c.cadastra('%s %d' % (apelido, ProvaDaModeracao._n), senha=SENHA)
        self.assertEqual(status, 201, r)
        return c

    def mestre(self, apelido='Guia Mod'):
        m = self.novo(apelido)
        self.sql("UPDATE contas SET gm = 1 WHERE id = ?", m.conta['id'])
        return m

    def em(self, c, base):
        outro = Cliente(base)
        outro.token, outro.conta = c.token, c.conta
        return outro

    def sql(self, consulta, *args):
        b = sqlite3.connect(self.banco_arq)
        b.row_factory = sqlite3.Row
        try:
            linhas = [dict(r) for r in b.execute(consulta, args).fetchall()]
            b.commit()
            return linhas
        finally:
            b.close()

    def login(self, c, senha=SENHA):
        return Cliente(self.base).pede('POST', '/api/login', {'login': c.conta['nome'], 'senha': senha})

    def poe_estado(self, c):
        p, d = copy.deepcopy(self.inicial['progress']), copy.deepcopy(self.inicial['db'])
        status, r = c.salva(0, p, d, [])
        self.assertEqual(status, 200, r)
        return r

    def bane(self, m, alvo, **kw):
        corpo = {'conta': alvo.conta['id'], 'duracao': '1h', 'motivo': 'xingou na praça'}
        corpo.update(kw)
        return m.pede('POST', '/api/mestre/banir', corpo)

    def auditoria(self, acao=None, alvo=None):
        q = 'SELECT * FROM moderacao_auditoria WHERE 1 = 1'
        args = []
        if acao:
            q += ' AND acao = ?'
            args.append(acao)
        if alvo:
            q += ' AND alvo_id = ?'
            args.append(alvo)
        return self.sql(q + ' ORDER BY id', *args)

    # -- o portão ----------------------------------------------------------------------------------
    def test_01_portao_das_rotas_do_mestre(self):
        comum = self.novo('Comum Portao')
        for metodo, rota, corpo in ROTAS_MESTRE:
            status, r = Cliente(self.base).pede(metodo, rota, corpo)
            self.assertEqual(status, 401, (rota, r))
            status, r = comum.pede(metodo, rota, {'lixo': True} if corpo is not None else None)
            self.assertEqual((status, r.get('erro')), (403, FRASE), rota)
        self.assertFalse([a for a in self.auditoria() if a['mestre_id'] == comum.conta['id']],
                         'nenhuma recusa vira linha de auditoria')

    # -- o banimento ---------------------------------------------------------------------------------
    def test_02_banir_com_prazo_vale_em_toda_rota_e_no_login(self):
        m, j = self.mestre('Guia Bane'), self.novo('Jogador Bane')
        t0 = int(time.time())
        status, r = self.bane(m, j, duracao='24h', motivo='ofendeu outro jogador no chat')
        self.assertEqual(status, 201, r)
        b = r['banimento']
        self.assertEqual(b['motivo'], 'ofendeu outro jogador no chat')
        self.assertFalse(b['permanente'])
        self.assertTrue(t0 + 86400 - 5 <= b['fim'] <= t0 + 86400 + 5, b)
        # toda rota com conta: 403 com o motivo e o fim (o jogo mostra a tela com isto)
        for metodo, rota, corpo in (('GET', '/api/eu', None), ('GET', '/api/save', None),
                                    ('POST', '/api/denuncia', {'alvo': m.conta['id'], 'categoria': 'ofensa'}),
                                    ('GET', '/api/correio', None), ('GET', '/api/loja/minha', None)):
            status, r = j.pede(metodo, rota, corpo)
            self.assertEqual((status, r['erro']), (403, mod.FRASE_BANIDA), rota)
            self.assertEqual((r['banimento']['motivo'], r['banimento']['fim']), (b['motivo'], b['fim']), rota)
            self.assertNotIn('por', r['banimento'], 'o jogador não vê quem aplicou')
        # o login: só DEPOIS da senha certa (sem a senha, nem o motivo nem o "banida")
        status, r = self.login(j, 'senha-errada-99')
        self.assertEqual(status, 401, r)
        self.assertNotIn('banimento', r)
        status, r = self.login(j)
        self.assertEqual(status, 403, r)
        self.assertEqual(r['banimento']['fim'], b['fim'])
        self.assertNotIn('token', r)
        # o que passa: perguntar por quê, e sair
        status, r = j.pede('GET', '/api/moderacao/eu')
        self.assertEqual(status, 200, r)
        self.assertEqual(r['banimento']['motivo'], b['motivo'])
        self.assertIsNone(r['silencio'])
        self.assertEqual(j.pede('POST', '/api/logout', {})[0], 200)
        # a trilha e a auditoria
        self.assertEqual(len(self.sql("SELECT * FROM eventos WHERE conta_id = ? AND tipo = 'banido'", j.conta['id'])), 1)
        a = self.auditoria('banir', j.conta['id'])
        self.assertEqual(len(a), 1)
        self.assertEqual(a[0]['mestre_id'], m.conta['id'])
        self.assertEqual(json.loads(a[0]['dados'])['duracao'], '24h')
        self.assertEqual(self.sql("SELECT banido FROM contas WHERE id = ?", j.conta['id'])[0]['banido'], 1)

    def test_03_o_prazo_vence_sozinho(self):
        m, j = self.mestre('Guia Prazo'), self.novo('Jogador Prazo')
        self.assertEqual(self.bane(m, j)[0], 201)
        self.assertEqual(j.pede('GET', '/api/eu')[0], 403)
        t = int(time.time())
        self.sql("UPDATE moderacao_banimentos SET fim = ? WHERE conta_id = ?", t - 1, j.conta['id'])
        status, r = j.pede('GET', '/api/eu')
        self.assertEqual(status, 200, 'o prazo venceu: a conta volta sem ninguém mexer (%r)' % r)
        linha = self.sql("SELECT * FROM moderacao_banimentos WHERE conta_id = ?", j.conta['id'])[0]
        self.assertEqual((linha['encerrado_como'], linha['encerrado_em']), ('expirou', t - 1))
        self.assertEqual(self.sql("SELECT banido FROM contas WHERE id = ?", j.conta['id'])[0]['banido'], 0)
        self.assertEqual(len(self.sql("SELECT * FROM eventos WHERE conta_id = ? AND tipo = 'ban-expirou'",
                                      j.conta['id'])), 1)
        # o login também fecha o prazo vencido (sem pedido nenhum antes)
        j2 = self.novo('Prazo Login')
        self.assertEqual(self.bane(m, j2, duracao='7d')[0], 201)
        self.sql("UPDATE moderacao_banimentos SET fim = ? WHERE conta_id = ?", t - 1, j2.conta['id'])
        status, r = self.login(j2)
        self.assertEqual(status, 200, r)

    def test_04_duracoes_regras_e_troca(self):
        m, j = self.mestre('Guia Regras'), self.novo('Jogador Regras')
        t = int(time.time())
        status, r = self.bane(m, j, duracao='permanente', motivo='trapaça comprovada')
        self.assertEqual(status, 201, r)
        self.assertTrue(r['banimento']['permanente'])
        self.assertIsNone(r['banimento']['fim'])
        # banir de novo TROCA a linha: uma aberta só, a de antes fecha como 'trocado'
        status, r = self.bane(m, j, duracao='personalizado', ate=t + 7200, motivo='revisto: 2 horas')
        self.assertEqual(status, 201, r)
        self.assertEqual(r['banimento']['fim'], t + 7200)
        linhas = self.sql("SELECT * FROM moderacao_banimentos WHERE conta_id = ? ORDER BY id", j.conta['id'])
        self.assertEqual([x['encerrado_como'] for x in linhas], ['trocado', None])
        self.assertEqual(j.pede('GET', '/api/eu')[1]['banimento']['fim'], t + 7200)
        for mexe in ({'duracao': '2h'}, {'duracao': None}, {'duracao': 'personalizado'},
                     {'duracao': 'personalizado', 'ate': t + 5}, {'duracao': 'personalizado', 'ate': t + 11 * 365 * 86400},
                     {'duracao': 'personalizado', 'ate': True}, {'motivo': 'x'}, {'motivo': None}, {'motivo': 'y' * 301},
                     {'conta': 'abc'}, {'conta': True}):
            status, r = self.bane(m, j, **mexe)
            self.assertEqual(status, 400, (mexe, r))
        self.assertEqual(self.bane(m, m)[0], 409, 'o Mestre não bane a si mesmo')
        self.assertIn('si mesmo', self.bane(m, m)[1]['erro'])
        outro_mestre = self.mestre('Guia Outro')
        self.assertEqual(self.bane(m, outro_mestre)[0], 409, 'nem outra conta com a marca')
        fantasma = Cliente(self.base)
        fantasma.conta = {'id': 999999}
        self.assertEqual(self.bane(m, fantasma)[0], 404)
        # a mesma régua no silêncio
        self.assertEqual(m.pede('POST', '/api/mestre/silenciar', {'conta': m.conta['id'], 'duracao': '1h',
                                                                 'motivo': 'abc'})[0], 409)

    def test_05_desbanir_legado_e_admin(self):
        m, j = self.mestre('Guia Desbane'), self.novo('Jogador Desbane')
        self.assertEqual(self.bane(m, j)[0], 201)
        status, r = m.pede('POST', '/api/mestre/desbanir', {'conta': j.conta['id'], 'motivo': 'pediu desculpas'})
        self.assertEqual(status, 200, r)
        self.assertEqual(j.pede('GET', '/api/eu')[0], 200)
        linha = self.sql("SELECT * FROM moderacao_banimentos WHERE conta_id = ?", j.conta['id'])[0]
        self.assertEqual((linha['encerrado_como'], linha['encerrado_motivo'], linha['encerrado_por']),
                         ('desfeito', 'pediu desculpas', m.conta['id']))
        self.assertEqual(m.pede('POST', '/api/mestre/desbanir', {'conta': j.conta['id']})[0], 409)
        self.assertEqual(len(self.auditoria('desbanir', j.conta['id'])), 1)
        # o banimento de ANTES desta tabela (o `admin banir` velho): sem linha, é permanente
        velho = self.novo('Jogador Velho')
        self.sql("UPDATE contas SET banido = 1 WHERE id = ?", velho.conta['id'])
        status, r = velho.pede('GET', '/api/eu')
        self.assertEqual(status, 403)
        self.assertEqual((r['banimento']['permanente'], r['banimento']['motivo'], r['banimento'].get('legado')),
                         (True, None, True))
        status, r = m.pede('GET', '/api/mestre/banimentos')
        self.assertEqual(status, 200, r)
        self.assertIn(velho.conta['id'], [x['conta']['id'] for x in r['legado']])
        self.assertEqual(m.pede('POST', '/api/mestre/desbanir', {'conta': velho.conta['id']})[0], 200)
        self.assertEqual(velho.pede('GET', '/api/eu')[0], 200)
        # o `admin desbanir` do Terminal (o 0/1 pelo SQL) manda, mesmo com a linha ainda aberta
        j3 = self.novo('Jogador Terminal')
        self.assertEqual(self.bane(m, j3, duracao='30d')[0], 201)
        self.sql("UPDATE contas SET banido = 0 WHERE id = ?", j3.conta['id'])
        self.assertEqual(j3.pede('GET', '/api/eu')[0], 200)
        # a lista: o banimento em vigor aparece ativo; com ?todos=1, o histórico também
        j4 = self.novo('Jogador Lista')
        self.assertEqual(self.bane(m, j4, duracao='7d')[0], 201)
        r = m.pede('GET', '/api/mestre/banimentos')[1]
        ativo = [x for x in r['banimentos'] if x['conta']['id'] == j4.conta['id']]
        self.assertEqual(len(ativo), 1)
        self.assertTrue(ativo[0]['ativo'])
        self.assertEqual(ativo[0]['porNome'], m.conta['nome'])
        self.assertNotIn(j.conta['id'], [x['conta']['id'] for x in r['banimentos']], 'o desfeito sai da lista dos ativos')
        r = m.pede('GET', '/api/mestre/banimentos?todos=1&conta=%d' % j.conta['id'])[1]
        self.assertEqual([x['encerradoComo'] for x in r['banimentos']], ['desfeito'])

    def test_06_silencio(self):
        m, j = self.mestre('Guia Cala'), self.novo('Jogador Cala')
        status, r = m.pede('POST', '/api/mestre/silenciar', {'conta': j.conta['id'], 'duracao': '1h',
                                                            'motivo': 'spam no chat'})
        self.assertEqual(status, 201, r)
        status, r = j.pede('GET', '/api/moderacao/eu')
        self.assertEqual(status, 200, r)
        self.assertEqual(r['silencio']['motivo'], 'spam no chat')
        self.assertIsNone(r['banimento'])
        self.assertEqual(j.pede('GET', '/api/eu')[0], 200, 'silenciado não é banido')
        r = m.pede('GET', '/api/mestre/banimentos')[1]
        self.assertIn(j.conta['id'], [x['conta']['id'] for x in r['silencios'] if x['ativo']])
        ficha = m.pede('GET', '/api/mestre/conta?id=%d' % j.conta['id'])[1]
        self.assertEqual(ficha['moderacao']['silencio']['motivo'], 'spam no chat')
        self.assertEqual(m.pede('POST', '/api/mestre/dessilenciar', {'conta': j.conta['id']})[0], 200)
        self.assertIsNone(j.pede('GET', '/api/moderacao/eu')[1]['silencio'])
        self.assertEqual(m.pede('POST', '/api/mestre/dessilenciar', {'conta': j.conta['id']})[0], 409)
        self.assertEqual([a['acao'] for a in self.auditoria(alvo=j.conta['id']) if a['acao'] != 'conta'],
                         ['silenciar', 'dessilenciar'])

    # -- a denúncia ------------------------------------------------------------------------------------
    def test_07_denuncia_validacao_e_freios(self):
        quem, alvo = self.novo('Denuncia Quem'), self.novo('Denuncia Alvo')
        base = {'alvo': alvo.conta['id'], 'categoria': 'ofensa', 'texto': 'me xingou', 'onde': 'chat'}
        for mexe, esperado in (({'alvo': quem.conta['id']}, 400), ({'alvo': 'x'}, 400), ({'alvo': 999999}, 404),
                               ({'categoria': 'feio'}, 400), ({'categoria': 'outro', 'texto': 'curto'}, 400),
                               ({'texto': 'x' * 501}, 400), ({'texto': 5}, 400),
                               ({'falas': [{'texto': 'a'}] * 21}, 400), ({'falas': 'oi'}, 400), ({'falas': ['oi']}, 400)):
            status, r = quem.pede('POST', '/api/denuncia', dict(base, **mexe))
            self.assertEqual(status, esperado, (mexe, r))
        falas = [{'texto': 'seu lixo\x07', 'em': int(time.time() * 1000)}, {'texto': '  ', 'em': 1}, {'texto': 'b' * 300}]
        status, r = quem.pede('POST', '/api/denuncia', dict(base, falas=falas))
        self.assertEqual(status, 201, r)
        d = self.sql("SELECT * FROM moderacao_denuncias WHERE id = ?", r['denuncia']['id'])[0]
        guardadas = json.loads(d['falas'])
        self.assertEqual([f['texto'] for f in guardadas], ['seu lixo', 'b' * 240], 'controle sai, vazia sai, corta em 240')
        self.assertTrue(all(f['relato'] == 'cliente' for f in guardadas), 'as falas são relato do cliente')
        self.assertTrue(abs(guardadas[0]['em'] - time.time()) < 60, 'o instante em ms vira segundos')
        self.assertEqual((d['estado'], d['alvo_nome'], d['denunciante_nome']), ('aberta', alvo.conta['nome'], quem.conta['nome']))
        # uma por alvo por hora
        status, r = quem.pede('POST', '/api/denuncia', base)
        self.assertEqual(status, 429, r)
        self.assertGreater(r['liberaEm'], time.time() + 3000)
        # dez por dia (as nove de antes postas pelo SQL, em alvos que não existem mais)
        t = int(time.time())
        for i in range(9):
            self.sql("INSERT INTO moderacao_denuncias(denunciante_id, categoria, criado_em, atualizado_em) "
                     "VALUES (?, 'spam', ?, ?)", quem.conta['id'], t - 100 - i, t)
        outro = self.novo('Denuncia Outro')
        status, r = quem.pede('POST', '/api/denuncia', dict(base, alvo=outro.conta['id']))
        self.assertEqual(status, 429, r)
        self.assertTrue(t + 86000 < r['liberaEm'] <= t + 86400, r)
        # a denúncia não é ação do Mestre: não vai à auditoria
        self.assertFalse(self.auditoria(alvo=alvo.conta['id']))

    def test_08_fila_do_mestre_acao_e_carta(self):
        m, quem, alvo = self.mestre('Guia Fila'), self.novo('Fila Quem'), self.novo('Fila Alvo')
        status, r = quem.pede('POST', '/api/denuncia', {'alvo': alvo.conta['id'], 'categoria': 'trapaca',
                                                        'texto': 'atravessa parede', 'falas': [{'texto': 'kkk'}]})
        self.assertEqual(status, 201, r)
        did = r['denuncia']['id']
        status, r = m.pede('GET', '/api/mestre/denuncias')
        self.assertEqual(status, 200, r)
        d = [x for x in r['denuncias'] if x['id'] == did][0]
        self.assertEqual((d['estado'], d['categoriaNome'], d['alvo']['id'], d['denunciante']['id'], d['contraAlvo']),
                         ('aberta', 'trapaça ou abuso de bug', alvo.conta['id'], quem.conta['id'], 1))
        self.assertEqual(d['falas'][0]['relato'], 'cliente')
        self.assertGreaterEqual(r['contagem']['aberta'], 1)
        self.assertEqual(m.pede('GET', '/api/mestre/denuncias?estado=xyz')[0], 400)
        self.assertFalse(self.auditoria('denuncias'), 'olhar a fila não é ação')
        # em análise; ação só na procedente; procedente com o banimento ligado
        self.assertEqual(m.pede('POST', '/api/mestre/denuncia', {'id': did, 'estado': 'em-analise'})[0], 200)
        self.assertEqual(m.pede('POST', '/api/mestre/denuncia', {'id': did, 'estado': 'em-analise'})[0], 409)
        self.assertEqual(m.pede('POST', '/api/mestre/denuncia', {'id': did, 'estado': 'aberta'})[0], 400)
        self.assertEqual(m.pede('POST', '/api/mestre/denuncia', {'id': did, 'estado': 'improcedente',
                                                                 'acao': {'tipo': 'banir', 'duracao': '1h'}})[0], 400)
        self.assertEqual(m.pede('POST', '/api/mestre/denuncia', {'id': did, 'estado': 'procedente',
                                                                 'acao': {'tipo': 'expulsar', 'duracao': '1h'}})[0], 400)
        status, r = m.pede('POST', '/api/mestre/denuncia', {
            'id': did, 'estado': 'procedente', 'resposta': 'Obrigado pelo aviso.', 'nota': 'vi o vídeo',
            'acao': {'tipo': 'banir', 'duracao': '7d'}})
        self.assertEqual(status, 200, r)
        self.assertEqual((r['denuncia']['estado'], r['denuncia']['acao']['tipo']), ('procedente', 'banir'))
        ban = self.sql("SELECT * FROM moderacao_banimentos WHERE conta_id = ? AND encerrado_em IS NULL", alvo.conta['id'])
        self.assertEqual(len(ban), 1)
        self.assertEqual(ban[0]['denuncia_id'], did, 'o banimento guarda a denúncia que o causou')
        self.assertIn('denúncia %d procedente' % did, ban[0]['motivo'])
        self.assertEqual(alvo.pede('GET', '/api/eu')[0], 403)
        # fechada é final
        self.assertEqual(m.pede('POST', '/api/mestre/denuncia', {'id': did, 'estado': 'improcedente'})[0], 409)
        self.assertEqual(m.pede('POST', '/api/mestre/denuncia', {'id': 999999, 'estado': 'improcedente'})[0], 404)
        # a carta ao denunciante: diz que procedeu, leva a resposta, NUNCA a punição
        status, r = quem.pede('GET', '/api/correio')
        self.assertEqual((status, r['naoLidas']), (200, 1), r)
        carta = r['cartas'][0]
        self.assertIn('concordou', carta['texto'])
        self.assertIn('Obrigado pelo aviso.', carta['texto'])
        self.assertNotIn('banid', carta['texto'].lower())
        self.assertNotIn('vi o vídeo', carta['texto'], 'a nota é interna')
        self.assertEqual(quem.pede('POST', '/api/correio/lida', {'id': carta['id']})[0], 200)
        self.assertEqual(quem.pede('GET', '/api/correio')[1]['naoLidas'], 0)
        self.assertEqual(alvo.pede('POST', '/api/correio/lida', {'id': carta['id']})[0], 403, 'banido não lê o correio')
        outro = self.novo('Fila Intruso')
        self.assertEqual(outro.pede('POST', '/api/correio/lida', {'id': carta['id']})[0], 404, 'a carta é de quem recebeu')
        # a improcedente também responde
        alvo2 = self.novo('Fila Alvo Dois')
        did2 = quem.pede('POST', '/api/denuncia', {'alvo': alvo2.conta['id'], 'categoria': 'nome'})[1]['denuncia']['id']
        self.assertEqual(m.pede('POST', '/api/mestre/denuncia', {'id': did2, 'estado': 'improcedente'})[0], 200)
        r = quem.pede('GET', '/api/correio')[1]
        self.assertEqual(r['naoLidas'], 1)
        self.assertIn('não encontrou violação', r['cartas'][0]['texto'])
        self.assertEqual(alvo2.pede('GET', '/api/eu')[0], 200)
        # a auditoria: as três passagens de estado, com a ação ligada na procedente
        a = [json.loads(x['dados']) for x in self.auditoria('denuncia') if json.loads(x['dados'])['id'] in (did, did2)]
        self.assertEqual([(x['de'], x['para']) for x in a],
                         [('aberta', 'em-analise'), ('em-analise', 'procedente'), ('aberta', 'improcedente')])
        self.assertEqual(len(self.auditoria('banir', alvo.conta['id'])), 1)

    # -- a auditoria das rotas antigas -------------------------------------------------------------------
    def test_09_auditoria_das_rotas_antigas(self):
        m, j = self.mestre('Guia Trilha'), self.novo('Trilha Alvo')
        status, r = m.pede('POST', '/api/mestre/presentear', {'conta': j.conta['id'], 'vintens': 77, 'idem': idem()})
        self.assertEqual(status, 201, r)
        self.assertEqual(m.pede('GET', '/api/mestre/conta?id=%d' % j.conta['id'])[0], 200)
        email = self.sql("SELECT email FROM contas WHERE id = ?", j.conta['id'])[0]['email']
        self.assertEqual(m.pede('POST', '/api/mestre/contas', {'q': email})[0], 200)
        self.assertEqual(m.pede('GET', '/api/mestre/presentes')[0], 200)
        minhas = [a for a in self.auditoria() if a['mestre_id'] == m.conta['id']]
        self.assertEqual([a['acao'] for a in minhas], ['presentear', 'conta', 'contas'],
                         'o presente e a ficha deixam linha; a lista de presentes (leitura) não')
        self.assertEqual(json.loads(minhas[0]['dados'])['vintens'], 77)
        self.assertEqual(minhas[0]['alvo_id'], j.conta['id'])
        self.assertEqual(minhas[1]['alvo_id'], j.conta['id'], 'a ficha acha o alvo no ?id=')
        busca = json.loads(minhas[2]['dados'])['busca']
        self.assertNotEqual(busca, email)
        self.assertIn('***@', busca, 'o e-mail buscado fica mascarado')
        status, r = m.pede('GET', '/api/mestre/auditoria?alvo=%d' % j.conta['id'])
        self.assertEqual(status, 200, r)
        self.assertEqual([x['acao'] for x in r['registros']], ['conta', 'presentear'])
        self.assertEqual(r['registros'][0]['mestre']['nome'], m.conta['nome'])
        self.assertEqual(m.pede('GET', '/api/mestre/auditoria?limite=abc')[0], 400)

    # -- o pôr no inventário e as ferramentas -------------------------------------------------------------
    def test_10_por_no_inventario_pelo_juiz(self):
        m, j = self.mestre('Guia Caixa'), self.novo('Caixa Jogador')
        corpo = {'tipo': 'item', 'itemId': PECA, 'estrelas': 3, 'nivel': 2, 'qtd': 2, 'idem': idem()}
        status, r = m.pede('POST', '/api/mestre/dar', corpo)
        self.assertEqual(status, 409, 'sem estado no servidor: %r' % r)
        self.poe_estado(m)
        self.poe_estado(j)
        status, r = m.pede('POST', '/api/mestre/dar', corpo)
        self.assertEqual(status, 201, r)
        novas = [e for e in r['progress']['inventory'] if e['itemId'] == PECA]
        self.assertEqual([(e['stars'], e['level']) for e in novas], [(3, 2), (3, 2)], 'o estado volta ao próprio Mestre')
        self.assertEqual(sorted(e['iid'] for e in novas), sorted(r['resultado']['iids']))
        self.assertTrue(isinstance(r['hash'], str) and r['versao'] >= 2, r)
        regs = self.sql("SELECT * FROM itens WHERE iid IN (?, ?)", *r['resultado']['iids'])
        self.assertEqual([(x['conta_id'], x['origem'], x['estado']) for x in regs], [(m.conta['id'], 'caixa', 'vivo')] * 2)
        salvo = m.pede('GET', '/api/save')[1]
        self.assertEqual(len([e for e in salvo['progress']['inventory'] if e['itemId'] == PECA]), 2, 'gravado no servidor')
        # o mesmo clique de novo: nada entra outra vez
        status, r2 = m.pede('POST', '/api/mestre/dar', corpo)
        self.assertEqual((status, r2.get('repetido')), (200, True), r2)
        self.assertEqual(len([e for e in r2['progress']['inventory'] if e['itemId'] == PECA]), 2)
        self.assertEqual(m.pede('POST', '/api/mestre/dar', dict(corpo, qtd=1))[0], 409, 'idem de outra entrega')
        # as regras
        for mexe, esperado in (({'itemId': 'nao-existe'}, 422), ({'estrelas': 99}, 422), ({'qtd': 21}, 400),
                               ({'qtd': 0}, 400), ({'itemId': '../x'}, 400), ({'nivel': -1}, 400), ({'tipo': 'pet'}, 400),
                               ({'conta': j.conta['id']}, 403), ({'idem': 'curto'}, 400)):
            pedido = dict(corpo, idem=idem())
            pedido.update(mexe)
            status, r = m.pede('POST', '/api/mestre/dar', pedido)
            self.assertEqual(status, esperado, (mexe, r))
        # selos em OUTRA conta: o estado dela muda, a resposta não o leva
        status, r = m.pede('POST', '/api/mestre/dar', {'conta': j.conta['id'], 'tipo': 'selos', 'elemento': 'agua',
                                                       'n': 12, 'idem': idem()})
        self.assertEqual(status, 201, r)
        self.assertNotIn('progress', r)
        self.assertEqual(j.pede('GET', '/api/save')[1]['progress']['selos']['agua'], 12)
        self.assertEqual(m.pede('POST', '/api/mestre/dar', {'conta': j.conta['id'], 'tipo': 'selos', 'elemento': 'luz',
                                                            'n': 1, 'idem': idem()})[0], 400)
        # banida: nada entra
        self.assertEqual(self.bane(m, j)[0], 201)
        self.assertEqual(m.pede('POST', '/api/mestre/dar', {'conta': j.conta['id'], 'tipo': 'selos', 'elemento': 'agua',
                                                            'n': 1, 'idem': idem()})[0], 409)
        # a auditoria leva o idem e o que entrou
        a = self.auditoria('dar-item', m.conta['id'])
        self.assertEqual(len(a), 1)
        self.assertEqual(a[0]['idem'], corpo['idem'])
        self.assertEqual(json.loads(a[0]['dados'])['args']['estrelas'], 3)
        # o cliente não pede a op interna sozinho
        status, r = m.pede('POST', '/api/op', {'ops': [{'nome': 'mestreDarItem', 'args': {'itemId': PECA}}]})
        self.assertEqual(status, 403, r)
        # sem juiz: 503, e nada entra
        antes = m.pede('GET', '/api/save')[1]['versao']
        status, r = self.em(m, self.base_sem_juiz).pede('POST', '/api/mestre/dar', dict(corpo, idem=idem()))
        self.assertEqual(status, 503, r)
        self.assertEqual(m.pede('GET', '/api/save')[1]['versao'], antes)

    def test_11_ferramentas_pelo_op_do_mestre(self):
        m, j = self.mestre('Guia Ferramenta'), self.novo('Ferramenta Comum')
        r = self.poe_estado(m)
        hash_antes = m.pede('GET', '/api/save')[1]['hash']
        status, r = m.pede('POST', '/api/op', {'hashAntes': hash_antes, 'ops': [
            {'nome': 'gmNivel', 'args': {'heroId': 'sumo', 'nivel': 17}},
            {'nome': 'gmElemento', 'args': {'heroId': 'sumo', 'elemento': 'terra'}},
            {'nome': 'gmLiberaClasse', 'args': {'classId': 'bruxo'}}]})
        self.assertEqual(status, 200, r)
        self.assertEqual(r['resultados'], [True, True, True])
        p = r['progress']
        self.assertEqual((p['heroes']['sumo']['level'], p['heroes']['sumo']['element']), (17, 'terra'))
        self.assertIn('bruxo', p['unlockedClasses'])
        a = self.auditoria('op', m.conta['id'])
        self.assertEqual(len(a), 1)
        self.assertEqual([o['nome'] for o in json.loads(a[0]['dados'])['ops']], ['gmNivel', 'gmElemento', 'gmLiberaClasse'])
        # quem não é Mestre: o juiz recusa a op do Mestre
        self.poe_estado(j)
        status, r = j.pede('POST', '/api/op', {'hashAntes': j.pede('GET', '/api/save')[1]['hash'],
                                               'ops': [{'nome': 'gmNivel', 'args': {'heroId': 'sumo', 'nivel': 30}}]})
        self.assertEqual(status, 422, r)
        self.assertEqual(r.get('motivo'), 'gm')


if __name__ == '__main__':
    unittest.main(verbosity=2)
