#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova dos direitos do titular (servidor/privacidade.py) — 02/10, antes do lançamento.

    python tests/privacidade_api.py

Sobe a API DE VERDADE num subprocesso (porta livre, banco descartável, --emails-prova:
cada e-mail vira uma linha de um arquivo e nada sai da máquina) e conversa por HTTP.
Os estados que só a autoridade (o juiz) cria — anúncio do mercadinho em custódia,
empréstimo do banco da guilda, pagamento aprovado — entram direto no banco, como o
servidor os deixaria; a exclusão é que é posta à prova.

O que se cobra:
  - o CADASTRO exige o aceite da versão de agora dos Termos (400 sem, 409 com versão
    velha) e grava os dois documentos com a versão e o instante, na mesma transação; a
    conta de antes aceita pela rota de aceite;
  - EXCLUIR exige o nome EXATO e a senha; a conta do Mestre, a luta com outros no meio e
    o pagamento aberto seguram (409);
  - depois da exclusão, NENHUMA linha de NENHUMA tabela aponta para a conta, fora a
    lápide e contas_excluidas — a prova LÊ O ESQUEMA (toda coluna com chave estrangeira
    para contas, mais as colunas conta_id sem chave), então a tabela nova de qualquer
    frente entra aqui sozinha; e nenhuma chave estrangeira fica solta;
  - fica o que a lei manda (o pagamento, o extrato das barras, o evento do pagamento),
    sem a conta; o nome e o e-mail voltam a ficar livres, e o id não é reaproveitado;
  - a guilda: o membro mais antigo herda; sozinho, a guilda se desfaz; o empréstimo
    que a conta deu fica com quem pegou, o que ela pegou volta ao dono;
  - o mercadinho: o anúncio dela some com as propostas nele; a proposta dela some; a
    venda antiga fica para o comprador sem dizer quem era;
  - o e-mail de confirmação sai;
  - BAIXAR MEUS DADOS traz o que é da conta (e nada de outra), com freio por hora;
  - a FAXINA dos prazos da Política (sessão vencida com o IP dela, código e freio de
    mais de 1 dia) roda no boot;
  - o TEXTO É VERDADEIRO AO CÓDIGO: a versão é a mesma nos quatro lugares, e cada
    número marcado com data-regua nas páginas bate com a constante dona dele.
"""
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))
sys.dont_write_bytecode = True
from servidor_api import API, Cliente, espera_api, porta_livre  # noqa: E402  (põe servidor/ no sys.path)
import api as cartorio  # noqa: E402
import comum  # noqa: E402
import conta as conta_mod  # noqa: E402
import loja as loja_mod  # noqa: E402
import mercado as mercado_mod  # noqa: E402
import pagamento as pagamento_mod  # noqa: E402
import presenca as presenca_mod  # noqa: E402
import privacidade  # noqa: E402
import registros  # noqa: E402

SENHA = 'segredo-bom-8'
ASSUNTO_EXCLUIDA = 'SOTERRA: sua conta foi excluída'


def ambiente_limpo():
    env = dict(os.environ)
    for k in list(env):
        if k.startswith('SOTERRA_'):
            del env[k]
    env['PYTHONIOENCODING'] = 'utf-8'
    return env


class ProvaDaPrivacidade(unittest.TestCase):
    _n = 0

    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.mkdtemp(prefix='soterra-priv-')
        cls.banco = os.path.join(cls.pasta, 'dados', 'soterra.db')
        cls.emails_arq = os.path.join(cls.pasta, 'emails.jsonl')
        porta = porta_livre()
        cls.base = 'http://127.0.0.1:%d' % porta
        cls.log = open(os.path.join(cls.pasta, 'api.log'), 'w', encoding='utf-8')
        cls.proc = subprocess.Popen([sys.executable, API, '--porta', str(porta), '--banco', cls.banco,
                                     '--emails-prova', cls.emails_arq],
                                    stdout=cls.log, stderr=subprocess.STDOUT, env=ambiente_limpo())
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
    def novo(self, apelido, **kw):
        ProvaDaPrivacidade._n += 1
        c = Cliente(self.base)
        nome = '%s %d' % (apelido, ProvaDaPrivacidade._n)
        status, r = c.cadastra(nome, **kw)
        self.assertEqual(status, 201, r)
        c.nome, c.email = nome, nome.replace(' ', '') + '@soterra.test'
        return c

    def sql(self, q, *args):
        con = sqlite3.connect(self.banco, timeout=10)
        con.row_factory = sqlite3.Row
        try:
            linhas = con.execute(q, args).fetchall()
            con.commit()
            return linhas
        finally:
            con.close()

    def um(self, q, *args):
        linhas = self.sql(q, *args)
        return linhas[0] if linhas else None

    def exclui(self, c, nome=None, senha=SENHA):
        return c.pede('POST', '/api/conta/excluir', {'nome': c.nome if nome is None else nome, 'senha': senha})

    def emails(self, para):
        if not os.path.exists(self.emails_arq):
            return []
        with open(self.emails_arq, encoding='utf-8') as f:
            return [json.loads(ln) for ln in f if ln.endswith('\n') and json.loads(ln)['para'].lower() == para.lower()]

    def referencias(self, cid):
        """Toda linha de toda tabela que ainda aponta para a conta `cid`: as colunas com
        chave estrangeira para contas(id) (lidas do esquema) e as colunas `conta_id` sem
        chave. Fora: a lápide (contas) e contas_excluidas, que existem para isso."""
        achados = {}
        con = sqlite3.connect(self.banco, timeout=10)
        try:
            tabelas = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table' "
                                                 "AND name NOT LIKE 'sqlite_%'")]
            for t in tabelas:
                if t in ('contas', 'contas_excluidas'):
                    continue
                colunas = {r[3] for r in con.execute('PRAGMA foreign_key_list("%s")' % t) if r[2] == 'contas'}
                colunas |= {r[1] for r in con.execute('PRAGMA table_info("%s")' % t) if r[1] == 'conta_id'}
                for col in colunas:
                    n = con.execute('SELECT COUNT(*) FROM "%s" WHERE "%s" = ?' % (t, col), (cid,)).fetchone()[0]
                    if n:
                        achados['%s.%s' % (t, col)] = n
        finally:
            con.close()
        return achados

    # -- 1. o aceite -------------------------------------------------------------------------
    def test_cadastro_exige_o_aceite(self):
        c = Cliente(self.base)
        ProvaDaPrivacidade._n += 1
        nome = 'Sem Aceite %d' % ProvaDaPrivacidade._n
        st, r = c.cadastra(nome, aceite=False)
        self.assertEqual(st, 400, r)
        self.assertEqual(r.get('motivo'), 'sem-aceite')
        self.assertIn('Termos de Uso', r['erro'])
        st, r = c.cadastra(nome, aceite='2000-01-01')
        self.assertEqual(st, 409, r)
        self.assertEqual((r.get('motivo'), r.get('versaoTermos')), ('termos-velhos', privacidade.VERSAO_TERMOS))
        self.assertIsNone(self.um("SELECT id FROM contas WHERE nome = ?", nome), 'sem aceite, nenhuma conta nasce')

        st, r = Cliente(self.base).pede('GET', '/api/termos')
        self.assertEqual((st, r['versaoTermos']), (200, privacidade.VERSAO_TERMOS), r)
        t0 = int(time.time())
        c = self.novo('Com Aceite')
        t1 = int(time.time())
        linhas = self.sql("SELECT documento, versao, aceito_em FROM aceites WHERE conta_id = ? ORDER BY documento",
                          c.conta['id'])
        self.assertEqual([(x['documento'], x['versao']) for x in linhas],
                         [('privacidade', privacidade.VERSAO_TERMOS), ('termos', privacidade.VERSAO_TERMOS)])
        self.assertTrue(all(t0 - 1 <= x['aceito_em'] <= t1 + 1 for x in linhas), [dict(x) for x in linhas])
        st, r = c.pede('GET', '/api/conta/aceite')
        self.assertEqual(st, 200, r)
        self.assertEqual((r['pendente'], r['aceite']['versao'], r['versaoTermos']),
                         (False, privacidade.VERSAO_TERMOS, privacidade.VERSAO_TERMOS))

        # a conta de antes dos documentos (sem linha) aceita pela rota
        self.sql("DELETE FROM aceites WHERE conta_id = ?", c.conta['id'])
        st, r = c.pede('GET', '/api/conta/aceite')
        self.assertEqual((st, r['pendente'], r['aceite']), (200, True, None), r)
        st, r = c.pede('POST', '/api/conta/aceite', {'versao': '2000-01-01'})
        self.assertEqual(st, 409, r)
        st, r = c.pede('POST', '/api/conta/aceite', {})
        self.assertEqual(st, 400, r)
        st, r = c.pede('POST', '/api/conta/aceite', {'versao': privacidade.VERSAO_TERMOS})
        self.assertEqual((st, r['pendente']), (200, False), r)
        self.assertEqual(self.um("SELECT COUNT(*) AS n FROM aceites WHERE conta_id = ?", c.conta['id'])['n'], 2)

    # -- 2. a confirmação forte ----------------------------------------------------------------
    def test_excluir_pede_nome_exato_e_senha(self):
        c = self.novo('Quase Sai')
        st, r = c.pede('POST', '/api/conta/excluir', {'nome': c.nome})
        self.assertEqual(st, 400, r)
        st, r = self.exclui(c, nome=c.nome.upper())
        self.assertEqual((st, r.get('motivo')), (400, 'nome-errado'), r)
        st, r = self.exclui(c, nome='outra pessoa')
        self.assertEqual((st, r.get('motivo')), (400, 'nome-errado'), r)
        st, r = self.exclui(c, senha='senha-errada-1')
        self.assertEqual((st, r['erro']), (400, 'senha errada'), r)
        st, r = c.pede('GET', '/api/eu')
        self.assertEqual(st, 200, 'nada saiu com a confirmação errada')
        self.assertEqual(self.um("SELECT COUNT(*) AS n FROM eventos WHERE conta_id = ? AND tipo = 'senha-recusada'",
                                 c.conta['id'])['n'], 1, 'a senha errada conta como a da troca de senha')
        # o Mestre não sai por aqui
        self.sql("UPDATE contas SET gm = 1 WHERE id = ?", c.conta['id'])
        st, r = self.exclui(c)
        self.assertEqual((st, r.get('motivo')), (409, 'mestre'), r)
        self.sql("UPDATE contas SET gm = 0 WHERE id = ?", c.conta['id'])
        st, r = self.exclui(c)
        self.assertEqual(st, 200, r)

    def test_luta_e_pagamento_abertos_seguram(self):
        a, b = self.novo('Luta Aberta'), self.novo('Luta Outro')
        # 03/10 (revisão): o DUELO aberto (duelo/abrir guardou a vida) e ainda sem resultado segura — sem isso o
        # fechamento do outro lado caía em 404 para sempre (a conta do duelo virou lápide banida)
        t = int(time.time())
        self.sql("INSERT INTO duelo_vida(did, conta_id, herois, carry, criado_em) VALUES ('d-priv-duelo', ?, '[]', NULL, ?)",
                 a.conta['id'], t)
        self.sql("INSERT INTO duelo_vida(did, conta_id, herois, carry, criado_em) VALUES ('d-priv-duelo', ?, '[]', NULL, ?)",
                 b.conta['id'], t)
        st, r = self.exclui(a)
        self.assertEqual((st, r.get('motivo')), (409, 'luta-aberta'), r)
        self.assertIn('duelo', r['erro'])
        # com o resultado guardado, o duelo acabou e não segura mais
        self.sql("INSERT INTO duelos(did, a_id, b_id, fase, criado_em) VALUES ('d-priv-duelo', ?, ?, 'won', ?)",
                 a.conta['id'], b.conta['id'], t)
        # e o duelo aberto há mais tempo que a janela, sem resultado, foi largado pelos dois: também não segura
        self.sql("INSERT INTO duelo_vida(did, conta_id, herois, carry, criado_em) VALUES ('d-priv-largado', ?, '[]', NULL, ?)",
                 a.conta['id'], t - privacidade.EXCLUIR_DUELO_JANELA - 60)
        agora_ms = int(time.time() * 1000)
        self.sql("INSERT INTO arena_partidas(did, a_id, b_id, a_herois, b_herois, a_classes, b_classes, a_nivel, "
                 "b_nivel, a_desde_ms, criada_ms, prazo_ms, estado) VALUES ('d-luta-1', ?, ?, '[]', '[]', '[]', '[]', "
                 "1, 1, ?, ?, ?, 'casada')", a.conta['id'], b.conta['id'], agora_ms, agora_ms, agora_ms + 30000)
        st, r = self.exclui(a)
        self.assertEqual((st, r.get('motivo')), (409, 'luta-aberta'), r)
        self.sql("UPDATE arena_partidas SET estado = 'jogada' WHERE did = 'd-luta-1'")
        t = int(time.time())
        self.sql("INSERT INTO pagamentos(conta_id, pacote, vintens, centavos, referencia, estado, criado_em, "
                 "atualizado_em) VALUES (?, 'barras-50', 50, 490, 'sot-luta-aberta', 'aberto', ?, ?)",
                 a.conta['id'], t, t)
        st, r = self.exclui(a)
        self.assertEqual((st, r.get('motivo')), (409, 'pagamento-aberto'), r)
        # o link vale 2 h: depois disso o pagamento sem resposta do Mercado Pago não segura mais
        self.sql("UPDATE pagamentos SET criado_em = ? WHERE referencia = 'sot-luta-aberta'",
                 t - privacidade.PAGAMENTO_ABERTO - 60)
        st, r = self.exclui(a)
        self.assertEqual(st, 200, r)
        # a partida que já tinha sido jogada some com a conta (CASCADE): o outro lado segue inteiro
        self.assertIsNone(self.um("SELECT did FROM arena_partidas WHERE did = 'd-luta-1'"))
        st, r = b.pede('GET', '/api/eu')
        self.assertEqual(st, 200)

    # -- 3. a exclusão de verdade -----------------------------------------------------------------
    def test_excluir_apaga_tudo_e_guarda_so_o_que_a_lei_manda(self):
        a = self.novo('Vai Sair')
        b = self.novo('Herdeiro')
        c = self.novo('Membro Novo')
        cid = a.conta['id']
        # o save, com uma peça no saco (o registro de itens)
        progress = {'version': 22, 'inventory': [{'itemId': 'it-x', 'level': 1, 'stars': 0, 'iid': 'jpriv1'}],
                    'heroes': {'sumo': {'classId': 'sumo', 'xp': 500, 'level': 5, 'items': {}, 'itemVar': {}}}}
        db = {'versao': 1, 'jogador': {'nome': 'Sai Logo', 'brasa': {'pts': 1000, 'partidas': 0}},
              'banco': {'moedas': 0, 'itens': []}, 'mercado': None}
        st, r = a.salva(0, progress, db, [{'iid': 'jpriv1', 'itemId': 'it-x', 'origem': 'saque'}])
        self.assertEqual(st, 200, r)
        st, r = a.pede('POST', '/api/avatar', {'avatar': 'classe:sumo'})
        self.assertEqual(st, 200, r)
        # amigos e inimigos, dos dois lados
        self.assertEqual(a.pede('POST', '/api/amigos/definir', {'conta': b.conta['id'], 'tipo': 'amigo'})[0], 200)
        self.assertEqual(b.pede('POST', '/api/amigos/definir', {'conta': cid, 'tipo': 'inimigo'})[0], 200)
        # a guilda: A funda, B entra antes de C — B é o membro mais antigo
        st, r = a.pede('POST', '/api/guilda/criar', {'nome': 'Os Que Ficam %d' % cid})
        self.assertEqual(st, 200, r)
        gid = r['guilda']['id']
        self.assertEqual(b.pede('POST', '/api/guilda/entrar', {'gid': gid})[0], 200)
        self.assertEqual(c.pede('POST', '/api/guilda/entrar', {'gid': gid})[0], 200)
        self.sql("UPDATE guilda_membros SET entrou_em = entrou_em + 5 WHERE conta_id = ?", c.conta['id'])
        st, r = a.pede('POST', '/api/guilda/mural', {'texto': 'bem-vindos'})
        self.assertEqual(st, 200, r)
        t = int(time.time())
        # o banco da guilda: a peça de A emprestada a B (B ficou com uma cópia) e a peça de C emprestada a A
        self.sql("INSERT INTO itens(iid, conta_id, item_id, origem, criado_em) VALUES ('jpriv-orig', ?, 'it-y', 'saque', ?)",
                 cid, t)
        self.sql("INSERT INTO itens(iid, conta_id, item_id, origem, criado_em) VALUES ('jpriv-copia', ?, 'it-y', 'banco', ?)",
                 b.conta['id'], t)
        self.sql("INSERT INTO guilda_banco(id, guilda_id, item_id, iid, dono_id, emprestado_para, em) "
                 "VALUES (9001, ?, 'it-y', 'jpriv-orig', ?, ?, ?)", gid, cid, b.conta['id'], t)
        self.sql("INSERT INTO guilda_emprestimos(banco_id, conta_id, iid, em) VALUES (9001, ?, 'jpriv-copia', ?)",
                 b.conta['id'], t)
        self.sql("INSERT INTO guilda_banco(id, guilda_id, item_id, iid, dono_id, emprestado_para, em) "
                 "VALUES (9002, ?, 'it-z', NULL, ?, ?, ?)", gid, c.conta['id'], cid, t)
        self.sql("INSERT INTO guilda_emprestimos(banco_id, conta_id, iid, em) VALUES (9002, ?, 'jpriv-copia-a', ?)",
                 cid, t)
        # o mercadinho: o anúncio de A (com a proposta de B), a proposta de A no anúncio de B, e uma venda antiga
        self.sql("INSERT INTO itens(iid, conta_id, item_id, origem, criado_em) VALUES ('jpriv-anuncio', ?, 'it-w', 'saque', ?)",
                 cid, t)
        self.sql("INSERT INTO mercado_anuncios(id, vendedor_id, iid, item_id, preco, criado_em) "
                 "VALUES (9101, ?, 'jpriv-anuncio', 'it-w', 100, ?)", cid, t)
        self.sql("INSERT INTO mercado_propostas(id, anuncio_id, comprador_id, valor, criado_em) VALUES (9201, 9101, ?, 80, ?)",
                 b.conta['id'], t)
        self.sql("INSERT INTO mercado_anuncios(id, vendedor_id, item_id, preco, criado_em) VALUES (9102, ?, 'it-v', 50, ?)",
                 b.conta['id'], t)
        self.sql("INSERT INTO mercado_propostas(id, anuncio_id, comprador_id, valor, criado_em) VALUES (9202, 9102, ?, 40, ?)",
                 cid, t)
        self.sql("INSERT INTO mercado_anuncios(id, vendedor_id, item_id, preco, estado, criado_em, comprador_id, "
                 "valor_final, fechado_em) VALUES (9103, ?, 'it-u', 30, 'vendido', ?, ?, 30, ?)",
                 b.conta['id'], t - 100, cid, t - 50)
        # o dinheiro: um pacote aprovado e creditado, o extrato e o saldo das barras, o evento do pagamento
        self.sql("INSERT INTO pagamentos(id, conta_id, pacote, vintens, centavos, referencia, estado, criado_em, "
                 "atualizado_em) VALUES (9301, ?, 'barras-50', 50, 490, 'sot-priv-pago', 'aberto', ?, ?)",
                 cid, t - 86400, t - 86400)
        self.sql("INSERT INTO pagamentos_mp(mp_id, pagamento_id, status, valor_centavos, creditado_em, atualizado_em) "
                 "VALUES ('77001', 9301, 'approved', 490, ?, ?)", t - 86000, t - 86000)
        self.sql("INSERT INTO barras_movimentos(conta_id, delta, motivo, ref, saldo_depois, idem, criado_em) "
                 "VALUES (?, 50, 'pacote', 'pagamento:9301', 50, 'mp:77001', ?)", cid, t - 86000)
        self.sql("INSERT INTO barras_saldo(conta_id, saldo, atualizado_em) VALUES (?, 50, ?)", cid, t - 86000)
        self.sql("INSERT INTO eventos(conta_id, tipo, dados, criado_em) VALUES (?, 'pagamento-credito', ?, ?)",
                 cid, json.dumps({'pagamento': 9301, 'mp': '77001', 'barras': 50}), t - 86000)
        # o que só guarda o número (sem chave estrangeira): a presença do relé e a espera do duelo
        self.sql("INSERT INTO rele_presenca(conta_id, evento, em_ms) VALUES (?, 'caiu', ?)", cid, t * 1000)
        self.sql("INSERT INTO duelo_espera(did, conta_id, motivo, primeiro_ms) VALUES ('d-priv', ?, 'wo', ?)",
                 cid, t * 1000)
        self.sql("INSERT INTO vida_heroi(conta_id, heroi, hp_fim, hp_max, desde_ms) VALUES (?, 'sumo', 10, 100, ?)",
                 cid, t * 1000)
        # o registro de erros com a conta
        st, r = a.pede('POST', '/api/registro/erros', {'erros': [{'mensagem': 'quebrou na prova da privacidade'}],
                                                       'versao': 'prova'})
        self.assertEqual(st, 200, r)
        nulos_antes = self.um("SELECT COUNT(*) AS n FROM eventos WHERE conta_id IS NULL "
                              "AND tipo NOT LIKE 'pagamento-%'")['n']
        self.assertTrue(self.referencias(cid), 'a conta tem de aparecer em muitos lugares antes da exclusão')

        st, r = self.exclui(a)
        self.assertEqual(st, 200, r)
        self.assertEqual((r['excluida'], r['guilda']), (True, 'lideranca'))

        # (antes do login de prova abaixo: o nome que não existe grava um login-recusado sem conta)
        self.assertEqual(self.um("SELECT COUNT(*) AS n FROM eventos WHERE conta_id IS NULL "
                                 "AND tipo NOT LIKE 'pagamento-%'")['n'], nulos_antes,
                         'os eventos da conta saem; não viram eventos sem dono')
        # o token morreu, o login também
        st, _ = a.pede('GET', '/api/eu')
        self.assertEqual(st, 401)
        st, _ = Cliente(self.base).pede('POST', '/api/login', {'login': a.nome, 'senha': SENHA})
        self.assertEqual(st, 401)
        # NENHUMA linha aponta para a conta (o esquema inteiro), e nenhuma chave ficou solta
        self.assertEqual(self.referencias(cid), {})
        self.assertEqual(self.sql("PRAGMA foreign_key_check"), [])
        # a lápide segura o número: nome que ninguém cadastra, e-mail .invalid, banida
        lap = self.um("SELECT * FROM contas WHERE id = ?", cid)
        self.assertEqual((lap['nome'], lap['email'], lap['banido'], lap['gm']),
                         (privacidade.LAPIDE_NOME % cid, privacidade.LAPIDE_EMAIL % cid, 1, 0))
        self.assertFalse(comum.nome_valido(lap['nome']), 'o nome da lápide não passa na lei dos nomes')
        self.assertIsNotNone(self.um("SELECT * FROM contas_excluidas WHERE conta_id = ?", cid))
        # fica o que a lei manda, sem a conta
        pg = self.um("SELECT * FROM pagamentos WHERE id = 9301")
        self.assertIsNotNone(pg)
        self.assertIsNone(pg['conta_id'])
        self.assertIsNotNone(self.um("SELECT * FROM pagamentos_mp WHERE mp_id = '77001'"))
        mv = self.um("SELECT * FROM barras_movimentos WHERE idem = 'mp:77001'")
        self.assertIsNotNone(mv)
        self.assertIsNone(mv['conta_id'])
        self.assertEqual(self.um("SELECT COUNT(*) AS n FROM eventos WHERE conta_id IS NULL AND tipo = 'pagamento-credito' "
                                 "AND dados LIKE '%77001%'")['n'], 1)
        # a guilda: B herdou (o mais antigo), C segue, a mensagem do mural fica sem autor
        g = self.um("SELECT * FROM guildas WHERE id = ?", gid)
        self.assertEqual(g['lider_id'], b.conta['id'])
        self.assertEqual({r['conta_id'] for r in self.sql("SELECT conta_id FROM guilda_membros WHERE guilda_id = ?", gid)},
                         {b.conta['id'], c.conta['id']})
        mu = self.um("SELECT * FROM guilda_mural WHERE guilda_id = ?", gid)
        self.assertEqual((mu['texto'], mu['autor_id']), ('bem-vindos', None))
        # o empréstimo que A deu: a cópia fica com B; o que A pegou volta a ser só do dono (C)
        self.assertIsNone(self.um("SELECT id FROM guilda_banco WHERE id = 9001"))
        copia = self.um("SELECT * FROM itens WHERE iid = 'jpriv-copia'")
        self.assertEqual((copia['conta_id'], copia['estado']), (b.conta['id'], 'vivo'))
        volta = self.um("SELECT * FROM guilda_banco WHERE id = 9002")
        self.assertEqual((volta['dono_id'], volta['emprestado_para']), (c.conta['id'], None))
        # o mercadinho
        self.assertIsNone(self.um("SELECT id FROM mercado_anuncios WHERE id = 9101"))
        self.assertIsNone(self.um("SELECT id FROM mercado_propostas WHERE id = 9201"))
        self.assertIsNone(self.um("SELECT id FROM mercado_propostas WHERE id = 9202"))
        self.assertIsNotNone(self.um("SELECT id FROM mercado_anuncios WHERE id = 9102"))
        venda = self.um("SELECT * FROM mercado_anuncios WHERE id = 9103")
        self.assertEqual((venda['estado'], venda['comprador_id']), ('vendido', None))
        # o erro registrado fica (é do jogo), sem a conta
        self.assertIsNotNone(self.um("SELECT chave FROM erros_registro WHERE mensagem = 'quebrou na prova da privacidade'"))
        # B vê o amigo sumir; o ranking não tem o nome
        st, r = b.pede('GET', '/api/amigos')
        self.assertEqual(st, 200, r)
        self.assertNotIn(a.nome, json.dumps(r, ensure_ascii=False))
        st, r = Cliente(self.base).pede('GET', '/api/ranking')
        self.assertNotIn('Sai Logo', json.dumps(r, ensure_ascii=False))
        self.assertNotIn(a.nome, json.dumps(r, ensure_ascii=False))
        # o último e-mail, para o endereço que era da conta
        fim = time.time() + 5
        while time.time() < fim and not any(m['assunto'] == ASSUNTO_EXCLUIDA for m in self.emails(a.email)):
            time.sleep(0.1)
        self.assertTrue(any(m['assunto'] == ASSUNTO_EXCLUIDA for m in self.emails(a.email)), self.emails(a.email))
        # o nome e o e-mail ficam livres; o número, não
        d = Cliente(self.base)
        st, r = d.cadastra(a.nome, email=a.email)
        self.assertEqual(st, 201, r)
        self.assertNotEqual(r['conta']['id'], cid)

    def test_sozinho_a_guilda_se_desfaz(self):
        a = self.novo('So Na Guilda')
        st, r = a.pede('POST', '/api/guilda/criar', {'nome': 'Solitaria %d' % a.conta['id']})
        self.assertEqual(st, 200, r)
        gid = r['guilda']['id']
        a.pede('POST', '/api/guilda/mural', {'texto': 'ninguém aqui'})
        st, r = self.exclui(a)
        self.assertEqual((st, r.get('guilda')), (200, 'desfeita'), r)
        self.assertIsNone(self.um("SELECT id FROM guildas WHERE id = ?", gid))
        for tabela in ('guilda_membros', 'guilda_contrib', 'guilda_mural', 'guilda_banco', 'guilda_dizimo_membro'):
            self.assertEqual(self.um("SELECT COUNT(*) AS n FROM %s WHERE guilda_id = ?" % tabela, gid)['n'], 0, tabela)
        self.assertEqual(self.referencias(a.conta['id']), {})

    # -- 4. baixar meus dados ---------------------------------------------------------------------
    def test_meus_dados(self):
        a, b = self.novo('Quer Dados'), self.novo('Outro Dado')
        a.pede('POST', '/api/amigos/definir', {'conta': b.conta['id'], 'tipo': 'amigo'})
        st, r = a.pede('GET', '/api/conta/meus-dados')
        self.assertEqual(st, 200, r)
        d = r['dados']
        self.assertEqual((d['conta']['nome'], d['conta']['email']), (a.nome, a.email))
        self.assertEqual({x['documento'] for x in d['aceites']}, {'termos', 'privacidade'})
        self.assertTrue(d['sessoes'] and 'ip' in d['sessoes'][0] and 'agente' in d['sessoes'][0], d['sessoes'])
        self.assertIn('cadastro', [e['tipo'] for e in d['eventos']['itens']])
        self.assertEqual(d['amigos_e_inimigos'], [{'nome': b.nome, 'tipo': 'amigo', 'em': d['amigos_e_inimigos'][0]['em']}])
        texto = json.dumps(d, ensure_ascii=False)
        self.assertNotIn(b.email, texto, 'o e-mail de outra conta nunca entra')
        self.assertNotIn('senha_hash', texto)
        self.assertNotIn(a.token, texto, 'nem o token da sessão')
        for chave in ('save', 'itens', 'salas', 'barras_de_ouro', 'loja', 'pagamentos', 'mercadinho', 'guilda',
                      'ranking', 'retrato', 'vida_dos_herois', 'registros_de_erro'):
            self.assertIn(chave, d)
        for _ in range(privacidade.MEUS_DADOS_POR_HORA - 1):
            self.assertEqual(a.pede('GET', '/api/conta/meus-dados')[0], 200)
        st, r = a.pede('GET', '/api/conta/meus-dados')
        self.assertEqual(st, 429, r)
        st, r = Cliente(self.base).pede('GET', '/api/conta/meus-dados')
        self.assertEqual(st, 401)


class ProvaDaFaxina(unittest.TestCase):
    """A faxina dos prazos da Política roda no boot da API (sem subprocesso: o Api direto)."""

    def test_boot_limpa_sessao_vencida_codigo_e_freio(self):
        pasta = tempfile.mkdtemp(prefix='soterra-faxina-')
        try:
            caminho = os.path.join(pasta, 'soterra.db')
            api = cartorio.Api(caminho)
            t = int(time.time())
            velho = t - comum.SESSAO_DIAS * 86400 - 60
            con = api.con
            con.execute("INSERT INTO contas(id, nome, email, senha_hash, sal, criado_em) VALUES (1, 'Faxina', "
                        "'f@soterra.test', 'x', 'y', ?)", (t,))
            con.execute("INSERT INTO sessoes(token, conta_id, criado_em, ultimo_uso) VALUES ('velha', 1, ?, ?)", (velho, velho))
            con.execute("INSERT INTO sessoes_extra(token, ip, agente, criado_em) VALUES ('velha', '189.34.12.7', 'X', ?)", (velho,))
            con.execute("INSERT INTO sessoes(token, conta_id, criado_em, ultimo_uso) VALUES ('viva', 1, ?, ?)", (t, t))
            con.execute("INSERT INTO codigos(conta_id, finalidade, hash, ip, criado_em, expira_em) "
                        "VALUES (1, 'senha', 'h', '189.34.12.7', ?, ?)", (t - conta_mod.FAXINA - 60, t))
            con.execute("INSERT INTO limites(chave, em) VALUES ('login-ip:189.34.12.7', ?)", (t - conta_mod.FAXINA - 60,))
            con.execute("INSERT INTO limites(chave, em) VALUES ('login-ip:189.34.12.8', ?)", (t,))
            velho_erro = t - registros.RETENCAO_DIAS * 86400 - 60
            con.execute("INSERT INTO erros_registro(chave, origem, tipo, mensagem, contagem, primeira_em, ultima_em) "
                        "VALUES ('%s', 'cliente', 'erro', 'velho', 1, ?, ?)" % ('e' * 32), (velho_erro, velho_erro))
            con.commit()
            con.close()
            api2 = cartorio.Api(caminho)          # o boot
            sess = [r[0] for r in api2.con.execute("SELECT token FROM sessoes ORDER BY token")]
            self.assertEqual(sess, ['viva'])
            self.assertEqual(api2.con.execute("SELECT COUNT(*) FROM sessoes_extra").fetchone()[0], 0,
                             'o IP da sessão vencida sai com ela')
            self.assertEqual(api2.con.execute("SELECT COUNT(*) FROM codigos").fetchone()[0], 0)
            self.assertEqual([r[0] for r in api2.con.execute("SELECT chave FROM limites")], ['login-ip:189.34.12.8'])
            self.assertEqual(api2.con.execute("SELECT COUNT(*) FROM erros_registro").fetchone()[0], 0,
                             'o erro quieto há mais de 30 dias sai mesmo sem lote novo')
            api2.con.close()
        finally:
            shutil.rmtree(pasta, ignore_errors=True)


class ProvaDoTexto(unittest.TestCase):
    """O texto das páginas é verdadeiro ao código: a versão e os números com dono."""

    def le(self, *caminho):
        with open(os.path.join(RAIZ, *caminho), encoding='utf-8') as f:
            return f.read()

    def test_a_versao_e_a_mesma_nos_quatro_lugares(self):
        v = privacidade.VERSAO_TERMOS
        self.assertRegex(v, r'^\d{4}-\d{2}-\d{2}$')
        self.assertIn("SITE.VERSAO_TERMOS = '%s'" % v, self.le('site', 'site.js'))
        dia = '%s/%s/%s' % (v[8:10], v[5:7], v[0:4])
        for pagina in ('termos.html', 'privacidade.html'):
            html = self.le('site', pagina)
            self.assertIn('data-versao="%s"' % v, html, pagina)
            self.assertIn('Versão de <b>%s</b>' % dia, html, pagina)

    def test_cada_numero_marcado_bate_com_a_constante(self):
        backup = self.le('servidor', 'coolify', 'backup.sh')
        dias_backup = int(re.search(r"-mtime \+(\d+) -delete", backup).group(1))
        inativo = re.search(r'S\.INATIVO_MS = (\d+) \* 60 \* 1000', self.le('js', 'core', 'sessao.js'))
        por_giro = re.search(r'porGiro:\s*(\d+)', self.le('js', 'core', 'data', 'items_selos.js'))
        esperado = {
            'SESSAO_DIAS': comum.SESSAO_DIAS,
            'FAXINA_DIAS': conta_mod.FAXINA // 86400,
            'PRESENCA_HORAS': presenca_mod.GUARDA_MS // 3600000,
            'ERROS_DIAS': registros.RETENCAO_DIAS,
            'BACKUP_DIAS': dias_backup,
            'PBKDF2_VOLTAS': comum.PBKDF2_VOLTAS,
            'INATIVO_MIN': int(inativo.group(1)),
            'TETO_REAIS_DIA': pagamento_mod.TETO_CENTAVOS_DIA // 100,
            'PAGAMENTO_HORAS': pagamento_mod.PREFERENCIA_VALIDADE // 3600,
            'VINTENS_POR_BARRA': loja_mod.VINTENS_POR_BARRA,
            'VINTENS_POR_BARRA_FARMADA': loja_mod.VINTENS_POR_BARRA_FARMADA,
            'TAXA_MERCADO': mercado_mod.TAXA_PCT,
            'SELOS_POR_GIRO': int(por_giro.group(1)),
        }
        self.assertEqual(privacidade.PAGAMENTO_ABERTO, pagamento_mod.PREFERENCIA_VALIDADE,
                         'a exclusão espera o mesmo prazo do link de pagamento')
        vistos = set()
        for pagina in ('termos.html', 'privacidade.html'):
            for nome, valor in re.findall(r'data-regua="([A-Z_0-9]+)">([^<]+)<', self.le('site', pagina)):
                self.assertIn(nome, esperado, '%s: data-regua %s sem constante conferida' % (pagina, nome))
                # "R$ 400,00" → 400; "200.000" → 200000; "30" → 30
                numero = int(re.sub(r'[^\d]', '', valor.split(',')[0]))
                self.assertEqual(numero, esperado[nome], '%s: %s diz %s, o código %s' % (pagina, nome, valor,
                                                                                         esperado[nome]))
                vistos.add(nome)
        self.assertEqual(vistos, set(esperado), 'toda constante conferida aparece em alguma página')

    def test_o_que_nao_existe_no_codigo_fica_para_preencher(self):
        for pagina in ('termos.html', 'privacidade.html'):
            html = self.le('site', pagina)
            for campo in ('razão social', 'CNPJ', 'e-mail de contato'):
                self.assertIn('[PREENCHER: %s]' % campo, html, pagina)
        self.assertIn('[PREENCHER: cidade do foro]', self.le('site', 'termos.html'))
        self.assertIn('[PREENCHER: nome do encarregado (DPO)]', self.le('site', 'privacidade.html'))
        self.assertTrue(os.path.exists(os.path.join(RAIZ, 'docs', 'REVISAO_JURIDICA.md')))

    def test_rodape_de_toda_pagina_do_site_leva_aos_documentos(self):
        for nome in sorted(os.listdir(os.path.join(RAIZ, 'site'))):
            if nome.endswith('.html'):
                html = self.le('site', nome)
                self.assertIn('href="termos.html"', html, nome)
                self.assertIn('href="privacidade.html"', html, nome)


if __name__ == '__main__':
    unittest.main(verbosity=2)
