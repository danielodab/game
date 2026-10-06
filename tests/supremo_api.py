#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova do ECO PRIMORDIAL no servidor (servidor/supremo.py), com o JUIZ de verdade.

    python tests/supremo_api.py

Sobe o juiz e a API como tests/autoridade_api.py (o mesmo palco: banco descartável, portas livres,
prioridade abaixo do normal) e joga tentativas DE VERDADE pela IA do jogo (tests/juiz_jogador.js na
Câmara do Eco). Prova o pedido do dono — "placar de quem tirou mais dano", conferido pelo juiz, nunca
número do cliente — e as réguas da semana:
  - GET /api/supremo é público (a semana de segunda a domingo de Brasília, as faixas, o ranking) e,
    com token, traz a parte da conta;
  - abrir: heróis conferidos, a versão das regras conferida (409 regras-velhas), o Mestre fora,
    3 tentativas por dia (429 na 4ª), abrir outra vence a aberta;
  - fechar: o dano é o do REPLAY do juiz; lance trocado = 422 e a tentativa 'recusada', sem pontuar;
    fechar de novo não pontua duas vezes; a de outra conta não é achada; rápida demais (a régua de
    verdade) = 422; vencida pelo prazo e pela semana fechada = 410; regras trocadas no meio = 410
    'regras-mudaram' ('vencida', não fraude);
  - o ranking é por conta (a melhor tentativa), a equipe joga mas não entra;
  - a semana fecha sozinha (preguiçosa, no primeiro pedido depois do fim + a folga): prêmios por
    faixa, UMA vez só (chamar de novo não duplica), pela fila da loja, e o juiz entrega no estado da
    conta — vinténs, selos e o título do pódio (o mesmo texto de js/core/titulos.js);
  - GET /api/eventos traz a semana do Eco como evento do mundo, com o fim no domingo 23:59:59;
  - O SAL DE CADA RODADA (03/10, o dono: "dificulte" o ensaio fora do jogo): o jogador de mentira joga AO VIVO
    (tests/juiz_jogador.js --ao-vivo) e pede o sal de cada rodada ao servidor de verdade no meio da partida. E
    um atacante TENTA o ensaio e é recusado: o sal de outro caminho na mesma rodada (409 caminho-preso, e a
    tentativa segue presa ao primeiro), outro caminho jogado com o sal do primeiro (422 caminho-trocado), o sal
    inventado (422 sal-forjado), a rodada pulada no pedido (409 rodada-fora) e no fechar (422 sal-faltando); o
    mesmo caminho de novo devolve o mesmo sal (a rede que caiu no meio da resposta); a conta do sal em Python é
    a do juiz em Node.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, '..'))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
import autoridade_api as A  # noqa: E402  (o palco: juiz + API num banco descartável)
from servidor_api import Cliente  # noqa: E402

sys.path.insert(0, os.path.join(RAIZ, 'servidor'))
import supremo as S  # noqa: E402

# a página nova manda a versão das regras também na abertura do Eco
if '/api/supremo/abrir' not in Cliente.ABERTURAS:
    Cliente.ABERTURAS = Cliente.ABERTURAS + ('/api/supremo/abrir',)

HEROIS = ['sumo']


def linha_dia(prova, tid):
    return prova.sql("SELECT dia FROM supremo_tentativas WHERE id = ?", tid)[0]['dia']


class ProvaDoEco(A.ProvaDaAutoridade):
    """Herda o palco e os ajudantes (novo, poe_estado, sql, save, roda_node...)."""

    def conta_pronta(self, apelido):
        # 03/10: o herói no nível 26, e não no 22 do palco. Medido com o jogador de mentira (a IA) em tentativas de
        # semente e sais sorteados: no 22 ele não tira NADA do Eco em ~4% delas (6 de 150 — cai antes de chegar
        # perto), e as provas que cobram "o placar do replay" com dano > 0 falhavam por sorte; no 26, 0 de 200
        # (o menor dano foi 90). A test_12 sobe dele para o 30 depois do fim
        c = self.novo(apelido)
        self.poe_estado(c, *self.estado_de_partida(nivel=26))
        return c

    def abre_eco(self, c, base=None, **kw):
        corpo = {'herois': list(HEROIS)}
        corpo.update(kw)
        cli = self.em(c, base) if base else c
        return cli.pede('POST', '/api/supremo/abrir', corpo)

    def joga_eco(self, c, tentativa, corta=None, opcao=None, responde=None, base=None):
        """A tentativa jogada AO VIVO (03/10): o jogador de mentira para em cada virada, e o sal da rodada vem do
        servidor de verdade (POST /api/supremo/sal) com o caminho que ele mandou — como o game.js faz. `responde`
        (pedido, status, resposta) → o sal que o jogador usa: é por onde o atacante das provas troca o sal."""
        s = self.save(c)
        linha = self.sql("SELECT * FROM supremo_tentativas WHERE id = ?", tentativa)[0]
        pedido = {'progress': s['progress'], 'db': s['db'], 'dungeonId': 'camara_eco', 'roomIndex': 0,
                  'semente': linha['semente'], 'dificuldade': 'normal', 'herois': json.loads(linha['herois']),
                  'carry': None}
        if corta is not None:
            pedido['cortaEm'] = corta
        if opcao is not None:
            pedido['opcao'] = opcao
        cli = self.em(c, base) if base else c
        proc = subprocess.Popen([A.NODE, A.JOGADOR, '--ao-vivo'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, creationflags=A.BAIXA)
        respostas = []
        try:
            proc.stdin.write((json.dumps(pedido) + '\n').encode('utf-8'))
            proc.stdin.flush()
            while True:
                ln = proc.stdout.readline()
                if not ln:
                    raise RuntimeError('o jogador parou: ' + proc.stderr.read().decode('utf-8', 'replace')[-2000:])
                m = json.loads(ln.decode('utf-8'))
                if 'fim' in m:
                    jogo = m['fim']
                    jogo['respostas'] = respostas
                    return jogo
                pede = m['pede']
                st, r = cli.pede('POST', '/api/supremo/sal', {'tentativa': tentativa, 'rodada': pede['rodada'],
                                                               'caminho': pede['caminho']})
                respostas.append({'rodada': pede['rodada'], 'caminho': pede['caminho'], 'status': st, 'resposta': r})
                sal = r.get('sal') if st == 200 else None
                if responde is not None:
                    sal = responde(pede, st, r)
                proc.stdin.write((json.dumps({'sal': sal}) + '\n').encode('utf-8'))
                proc.stdin.flush()
        finally:
            try:
                proc.stdin.close()
            except Exception:
                pass
            try:
                proc.wait(30)
            except subprocess.TimeoutExpired:
                proc.kill()
            for f in (proc.stdout, proc.stderr):
                try:
                    f.close()
                except Exception:
                    pass

    def fecha_eco(self, c, tentativa, jogo, base=None):
        cli = self.em(c, base) if base else c
        return cli.pede('POST', '/api/supremo/fechar', {'tentativa': tentativa, 'lances': jogo['lances'],
                                                       'hashFinal': jogo['hash']})

    # ------------------------------------------------------------------------------------------
    def test_01_ler_e_publico_e_com_token_traz_a_conta(self):
        st, r = Cliente(self.base).pede('GET', '/api/supremo', token=None)
        self.assertEqual(st, 200, r)
        sem = r['semana']
        self.assertEqual(sem['fim'] - sem['inicio'], 7 * 86400 - 1)
        # a semana abre numa segunda 00:00 de Brasília (03:00 UTC)
        self.assertEqual(time.gmtime(sem['inicio']).tm_wday, 0)
        self.assertEqual(time.gmtime(sem['inicio']).tm_hour, 3)
        self.assertTrue(sem['inicio'] <= r['agora'] <= sem['fim'])
        self.assertEqual([f['id'] for f in r['faixas']], ['podio', 'elite', 'cem', 'participacao'])
        self.assertIsNone(r['eu'])
        self.assertEqual(r['tentativasPorDia'], 3)
        c = self.conta_pronta('Leitor')
        st, r = c.pede('GET', '/api/supremo')
        self.assertEqual(st, 200, r)
        self.assertEqual(r['eu']['restantes'], 3)
        self.assertIsNone(r['eu']['melhor'])

    def test_02_abrir_confere_herois_versao_e_o_mestre(self):
        c = self.conta_pronta('Abridor')
        st, r = c.pede('POST', '/api/supremo/abrir', {'herois': 'sumo'})
        self.assertEqual(st, 400, r)
        st, r = c.pede('POST', '/api/supremo/abrir', {'herois': ['bruxo']})
        self.assertEqual(st, 400, r)                       # não é desta conta (a classe nem foi liberada)
        st, r = c.pede('POST', '/api/supremo/abrir', {'herois': HEROIS, 'versaoRegras': 1})
        self.assertEqual((st, r.get('motivo')), (409, 'regras-velhas'), r)
        st, r = c.pede('POST', '/api/supremo/abrir', {'herois': HEROIS, 'versaoRegras': None})
        self.assertEqual((st, r.get('motivo')), (409, 'regras-velhas'), r)    # sem o campo = a página de antes
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM supremo_tentativas WHERE conta_id = ?",
                                  c.conta['id'])[0]['n'], 0)
        st, r = self.abre_eco(c)
        self.assertEqual(st, 200, r)
        self.assertTrue(isinstance(r['semente'], int) and isinstance(r['tentativa'], str))
        self.assertEqual(r['restantes'], 2)
        linha = self.sql("SELECT * FROM supremo_tentativas WHERE id = ?", r['tentativa'])[0]
        self.assertEqual((linha['estado'], linha['semente'], linha['regras']), ('aberta', r['semente'], Cliente.REGRAS))
        # o Mestre (a classe gm) não abre tentativa: o estado com a ficha dele
        g = self.novo('Mestrinho')
        p, d = self.estado_de_partida()
        p['heroes']['gm'] = dict(p['heroes']['sumo'], classId='gm')
        self.poe_estado(g, p, d)
        self.sql("UPDATE contas SET gm = 1 WHERE id = ?", g.conta['id'])
        st, r = g.pede('POST', '/api/supremo/abrir', {'herois': ['gm']})
        self.assertEqual(st, 400, r)

    def test_03_tres_por_dia_e_abrir_outra_vence_a_aberta(self):
        c = self.conta_pronta('Teimoso')
        ids = []
        for i in range(3):
            st, r = self.abre_eco(c)
            self.assertEqual(st, 200, r)
            self.assertEqual(r['restantes'], 2 - i)
            ids.append(r['tentativa'])
        estados = [self.sql("SELECT estado, motivo FROM supremo_tentativas WHERE id = ?", t)[0] for t in ids]
        self.assertEqual([e['estado'] for e in estados], ['vencida', 'vencida', 'aberta'])
        self.assertEqual(estados[0]['motivo'], 'outra-aberta')
        st, r = self.abre_eco(c)
        self.assertEqual((st, r.get('motivo')), (429, 'sem-tentativas'), r)
        self.assertTrue(r.get('liberaEm', 0) > time.time())
        # o dia é o de Brasília: a tentativa de ONTEM não conta para hoje
        self.sql("UPDATE supremo_tentativas SET dia = dia - 1 WHERE conta_id = ?", c.conta['id'])
        st, r = self.abre_eco(c)
        self.assertEqual(st, 200, r)

    def test_04_fechar_o_placar_e_o_do_replay(self):
        c = self.conta_pronta('Batedor')
        st, r = self.abre_eco(c)
        self.assertEqual(st, 200, r)
        tid = r['tentativa']
        jogo = self.joga_eco(c, tid)
        self.assertNotEqual(jogo['fase'], 'playing')
        # o lance trocado: o juiz recusa e a tentativa não pontua
        torto = json.loads(json.dumps(jogo))
        i = next(k for k, l in enumerate(torto['lances']) if l['a'] == 'c' and l.get('ok'))
        torto['lances'][i]['x'] = (torto['lances'][i]['x'] + 3) % 18
        st, r = self.fecha_eco(c, tid, torto)
        # 03/10: o lance trocado que o motor ainda aceita só aparece adiante — e o primeiro lance de sal depois dele
        # já acusa (o caminho até ali não é o que o servidor travou). As duas são a mesma regra: não pontua
        self.assertEqual(st, 422, r)
        self.assertIn(r.get('motivo'), ('divergiu', 'caminho-trocado'), r)
        linha = self.sql("SELECT * FROM supremo_tentativas WHERE id = ?", tid)[0]
        self.assertEqual((linha['estado'], linha['dano']), ('recusada', None))
        st, r = self.fecha_eco(c, tid, jogo)
        self.assertEqual(st, 409, r)                       # recusada não fecha de novo
        # outra tentativa, jogada honesta
        st, r = self.abre_eco(c)
        tid = r['tentativa']
        jogo = self.joga_eco(c, tid)
        outro = self.conta_pronta('Curioso')
        st, r = self.fecha_eco(outro, tid, jogo)
        self.assertEqual(st, 404, r)                       # a de outra conta não é achada
        # a tentativa honesta pediu o sal de cada rodada depois da 1ª, e o servidor deu
        self.assertTrue(jogo['respostas'] and all(x['status'] == 200 for x in jogo['respostas']), jogo['respostas'])
        self.assertEqual([x['rodada'] for x in jogo['respostas']], list(range(2, 2 + len(jogo['respostas']))))
        st, r = self.fecha_eco(c, tid, jogo)
        self.assertEqual(st, 200, r)
        self.assertTrue(r['dano'] > 0, r)
        self.assertEqual(r['pontos'], r['dano'] + r['bonus'])
        linha = self.sql("SELECT * FROM supremo_tentativas WHERE id = ?", tid)[0]
        self.assertEqual((linha['estado'], linha['dano'], linha['pontos']), ('conferida', r['dano'], r['pontos']))
        self.assertTrue(linha['turnos'] > 0)
        # o dano é o do juiz: refeito por fora com as mesmas entradas dá o mesmo número
        self.assertEqual(r['eu']['melhor']['dano'], r['dano'])
        self.assertEqual(r['eu']['restantes'], 1)
        st, r2 = self.fecha_eco(c, tid, jogo)
        self.assertEqual(st, 409, r2)                      # não pontua duas vezes
        # o ranking público mostra ESTA conta com o placar do juiz, na posição que a ficha dela diz (03/10: a
        # checagem de antes passava com qualquer ranking não vazio)
        st, rk = Cliente(self.base).pede('GET', '/api/supremo', token=None)
        meu_nome = self.sql("SELECT COALESCE(r.nome, c.nome) AS nome FROM contas c LEFT JOIN resumos r "
                            "ON r.conta_id = c.id WHERE c.id = ?", c.conta['id'])[0]['nome']
        minhas = [l for l in rk['ranking'] if l['nome'] == meu_nome]
        self.assertEqual(len(minhas), 1, rk['ranking'])
        self.assertEqual((minhas[0]['pontos'], minhas[0]['dano'], minhas[0]['posicao']),
                         (r['pontos'], r['dano'], r['eu']['posicao']), rk['ranking'])

    def test_05_largada_no_meio_pontua_ate_onde_foi(self):
        c = self.conta_pronta('Meio')
        st, r = self.abre_eco(c)
        tid = r['tentativa']
        inteira = self.joga_eco(c, tid)
        # a mesma tentativa (a mesma semente) largada na metade dos lances: a aba fechada no meio
        jogo = self.joga_eco(c, tid, corta=max(2, len(inteira['lances']) // 2))
        self.assertEqual(jogo['fase'], 'playing')
        st, r = c.pede('POST', '/api/supremo/fechar', {'tentativa': tid, 'lances': jogo['lances'], 'hashFinal': None})
        self.assertEqual(st, 200, r)
        self.assertEqual(r['fase'], 'playing')
        self.assertTrue(r['dano'] >= 0)
        self.assertEqual(self.sql("SELECT estado FROM supremo_tentativas WHERE id = ?", tid)[0]['estado'], 'conferida')

    def test_06_rapida_demais_vencida_e_regras_trocadas(self):
        c = self.conta_pronta('Apressado')
        # a régua de verdade (a API rigorosa: SALA_MIN_S 4 s) — fechar na hora não vale
        st, r = self.abre_eco(c)
        tid = r['tentativa']
        jogo = self.joga_eco(c, tid)
        self.sql("UPDATE supremo_tentativas SET aberta_ms = ? WHERE id = ?", int(time.time() * 1000), tid)
        st, r = self.fecha_eco(c, tid, jogo, base=self.base_rigorosa)
        self.assertEqual((st, r.get('motivo')), (422, 'rapido-demais'), r)
        self.assertEqual(self.sql("SELECT estado FROM supremo_tentativas WHERE id = ?", tid)[0]['estado'], 'recusada')
        # o prazo (2 h)
        st, r = self.abre_eco(c)
        tid = r['tentativa']
        self.sql("UPDATE supremo_tentativas SET aberta_ms = aberta_ms - ? WHERE id = ?", (S.VALIDADE_S + 60) * 1000, tid)
        st, r = c.pede('POST', '/api/supremo/fechar', {'tentativa': tid, 'lances': [], 'hashFinal': None})
        self.assertEqual((st, r.get('motivo')), (410, 'vencida'), r)
        # a versão das regras trocada no meio (um deploy): vence limpa, não é fraude
        st, r = self.abre_eco(c)
        tid = r['tentativa']
        jogo = self.joga_eco(c, tid)
        self.sql("UPDATE supremo_tentativas SET regras = regras + 1 WHERE id = ?", tid)
        st, r = self.fecha_eco(c, tid, jogo)
        self.assertEqual((st, r.get('motivo')), (410, 'regras-mudaram'), r)
        linha = self.sql("SELECT estado, motivo FROM supremo_tentativas WHERE id = ?", tid)[0]
        self.assertEqual((linha['estado'], linha['motivo']), ('vencida', 'regras-mudaram'))
        # ... e a vez do dia VOLTA (o 410 promete; 03/10): três abertas hoje, uma devolvida pelo deploy
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM supremo_tentativas WHERE conta_id = ? AND dia = ?",
                                  c.conta['id'], linha_dia(self, tid))[0]['n'], 3)
        st, r = c.pede('GET', '/api/supremo')
        self.assertEqual((st, r['eu']['restantes']), (200, 1), r.get('eu'))
        st, r = self.abre_eco(c)
        self.assertEqual((st, r.get('restantes')), (200, 0), r)
        st, r = self.abre_eco(c)
        self.assertEqual((st, r.get('motivo')), (429, 'sem-tentativas'), r)

    def test_07_a_semana_fecha_uma_vez_e_os_premios_chegam(self):
        agora_s = int(time.time())
        passada = S.semana_de(agora_s) - 1
        # quatro contas com tentativas conferidas na semana passada (o placar escrito direto: o que se
        # prova aqui é o fechamento), uma delas da equipe
        contas = [self.conta_pronta('Semana%d' % i) for i in range(4)]
        equipe = contas[3]
        self.sql("UPDATE contas SET gm = 1 WHERE id = ?", equipe.conta['id'])
        fim = S.inicio_da_semana(passada) + 3 * 86400
        for i, (c, pts) in enumerate(zip(contas, (900, 1500, 1500, 5000))):
            for k, extra in enumerate((0, -100)):
                self.sql("INSERT INTO supremo_tentativas(id, conta_id, semana, dia, semente, herois, regras, aberta_ms, "
                         "fechada_em, estado, dano, pontos, derrubou, rodada, turnos) VALUES "
                         "(?, ?, ?, ?, 1, '[\"sumo\"]', NULL, ?, ?, 'conferida', ?, ?, 0, 12, 20)",
                         'p%d-%d-%d' % (passada, i, k), c.conta['id'], passada, S.dia_de(fim), (fim - 600) * 1000,
                         fim + i - k, pts + extra, pts + extra)
        # a semana de agora ainda não fecha, a passada sim (o primeiro pedido)
        st, r = Cliente(self.base).pede('GET', '/api/supremo/ranking?semana=%d' % passada, token=None)
        self.assertEqual(st, 200, r)
        self.assertTrue(r['fechada'], r)
        ranking = r['ranking']
        self.assertEqual([l['pontos'] for l in ranking], [1500, 1500, 900])   # a equipe fora; o melhor de cada um
        # empate: quem chegou primeiro (a conta 1 fechou antes da 2)
        prem = {p['conta_id']: p for p in self.sql("SELECT * FROM supremo_premios WHERE semana = ?", passada)}
        self.assertEqual(sorted(prem), sorted(c.conta['id'] for c in contas[:3]))
        self.assertEqual(prem[contas[1].conta['id']]['posicao'], 1)
        self.assertEqual(prem[contas[2].conta['id']]['posicao'], 2)
        self.assertTrue(all(p['faixa'] == 'podio' and p['titulo'] == S.TITULO_ECO for p in prem.values()))
        pedidos = self.sql("SELECT * FROM loja_pedidos WHERE sku LIKE 'eco-%' AND conta_id IN (?, ?, ?)",
                           *[c.conta['id'] for c in contas[:3]])
        self.assertEqual(len(pedidos), 6)                  # vinténs + selos/título, para cada um
        # UMA vez só: pedir de novo (e chamar o fechamento direto) não duplica nada
        for _ in range(2):
            Cliente(self.base).pede('GET', '/api/supremo', token=None)
            contas[0].pede('POST', '/api/loja/retirar', {})
        self.assertEqual(len(self.sql("SELECT * FROM supremo_premios WHERE semana = ?", passada)), 3)
        self.assertEqual(len(self.sql("SELECT * FROM loja_pedidos WHERE sku LIKE 'eco-%' AND conta_id IN (?, ?, ?)",
                                      *[c.conta['id'] for c in contas[:3]])), 6)
        self.assertEqual(len(self.sql("SELECT * FROM supremo_semanas WHERE semana = ?", passada)), 1)
        # a entrega pelo juiz no estado da conta: vinténs, selos (5 de cada) e o título
        antes = self.save(contas[1])
        st, r = contas[1].pede('POST', '/api/loja/retirar', {})
        self.assertEqual(st, 200, r)
        self.assertTrue(r.get('aplicado'), r)
        origens = {p['sku']: p.get('origem') for p in r['pedidos']}
        self.assertEqual(origens, {'eco-vintens': 'eco', 'eco-premio': 'eco'}, r['pedidos'])
        depois = self.save(contas[1])
        moedas = lambda s: ((s['db'] or {}).get('carteira') or {}).get('moedas', 0)  # noqa: E731
        self.assertEqual(moedas(depois) - moedas(antes), S.FAIXAS[0]['vintens'])   # 06/10: o pódio caiu de 5.000 para 1.500
        self.assertEqual(depois['progress'].get('selos'), {'fogo': 5, 'agua': 5, 'terra': 5, 'ar': 5})
        self.assertEqual(depois['progress'].get('titulosEco'), [S.TITULO_ECO])
        estados = {p['estado'] for p in self.sql("SELECT estado FROM loja_pedidos WHERE conta_id = ? AND sku LIKE 'eco-%'",
                                                  contas[1].conta['id'])}
        self.assertEqual(estados, {'entregue'})
        # a entrega também não se repete
        st, r = contas[1].pede('POST', '/api/loja/retirar', {})
        self.assertEqual(r.get('pedidos'), [], r)
        # a tentativa aberta da semana fechada não fecha mais
        c = contas[0]
        self.sql("INSERT INTO supremo_tentativas(id, conta_id, semana, dia, semente, herois, aberta_ms, estado) VALUES "
                 "(?, ?, ?, ?, 1, '[\"sumo\"]', ?, 'aberta')", 'x' * 20, c.conta['id'], passada, S.dia_de(fim),
                 int(time.time() * 1000) - 60000)
        st, r = c.pede('POST', '/api/supremo/fechar', {'tentativa': 'x' * 20, 'lances': [], 'hashFinal': None})
        self.assertEqual((st, r.get('motivo')), (410, 'vencida'), r)

    def test_08_faixas_e_selos(self):
        self.assertEqual(S.faixa_de(1)['id'], 'podio')
        self.assertEqual(S.faixa_de(3)['id'], 'podio')
        self.assertEqual(S.faixa_de(4)['id'], 'elite')
        self.assertEqual(S.faixa_de(10)['id'], 'elite')
        self.assertEqual(S.faixa_de(11)['id'], 'cem')
        self.assertEqual(S.faixa_de(100)['id'], 'cem')
        self.assertEqual(S.faixa_de(101)['id'], 'participacao')
        self.assertEqual(S.faixa_de(99999)['id'], 'participacao')
        self.assertEqual(S.selos_da_faixa(20), {'fogo': 5, 'agua': 5, 'terra': 5, 'ar': 5})
        self.assertEqual(S.selos_da_faixa(10), {'fogo': 3, 'agua': 3, 'terra': 2, 'ar': 2})
        self.assertEqual(S.selos_da_faixa(0), {})
        # o título do servidor é o do catálogo do jogo (js/core/titulos.js, T.ECO) e o número de tentativas
        # é o espelho de js/core/data/eco.js
        with open(os.path.join(RAIZ, 'js', 'core', 'titulos.js'), encoding='utf-8') as f:
            tit = f.read()
        self.assertIn("titulo: '%s'" % S.TITULO_ECO, tit)
        with open(os.path.join(RAIZ, 'js', 'core', 'data', 'eco.js'), encoding='utf-8') as f:
            eco = f.read()
        self.assertEqual(int(re.search(r'tentativasPorDia:\s*(\d+)', eco).group(1)), S.TENTATIVAS_POR_DIA)
        # nada se compra: nenhum item da loja fala do Eco
        import loja
        self.assertFalse(any('eco' in i['sku'] or i['tipo'] == 'premio-eco' for i in loja.CATALOGO))

    def test_09_a_semana_e_um_evento_do_mundo(self):
        st, r = Cliente(self.base).pede('GET', '/api/eventos', token=None)
        self.assertEqual(st, 200, r)
        semana = S.semana_de(r['agora'])
        # num campo à parte: `ativos` e `proximos` seguem sendo só a agenda do Mestre
        self.assertFalse(any(str(e['id']).startswith('eco-') for e in r['ativos'] + r['proximos']), r)
        ev = [e for e in r['semanais'] if e['id'] == 'eco-%d' % semana and e['inicio'] <= r['agora'] < e['fim']]
        self.assertEqual(len(ev), 1, r['semanais'])
        self.assertEqual((ev[0]['tipo'], ev[0]['inicio'], ev[0]['fim']),
                         ('aviso', S.inicio_da_semana(semana), S.inicio_da_semana(semana + 1)))
        self.assertTrue(any(e['id'] == 'eco-%d' % (semana + 1) for e in r['semanais']), r['semanais'])
        self.assertNotIn('aviso', r['fatores'].get('geral', {}))    # aviso não mexe em fator nenhum

    def test_10_relogio_de_brasilia(self):
        import calendar
        seg = calendar.timegm((2026, 10, 5, 3, 0, 0))          # segunda 00:00 em Brasília
        self.assertEqual(S.semana_de(seg), S.semana_de(seg - 1) + 1)
        self.assertEqual(S.inicio_da_semana(S.semana_de(seg)), seg)
        dom = calendar.timegm((2026, 10, 12, 2, 59, 59))       # domingo 23:59:59 em Brasília
        self.assertEqual(S.semana_de(dom), S.semana_de(seg))
        self.assertEqual(S.dia_de(seg) - S.dia_de(seg - 1), 1)

    def test_12_o_grupo_e_o_da_abertura(self):
        """03/10 (revisão): o fechar refeito (sem rede) sobe a fila de ops antes; uma peça equipada ou um nível
        ganho na praça entre o fim e o fechar mudava o grupo que o juiz montava, e a tentativa legítima caía como
        'divergiu'. O juiz refaz com o estado da ABERTURA (supremo_estados)."""
        c = self.conta_pronta('Mexe Depois')
        st, r = self.abre_eco(c)
        self.assertEqual(st, 200, r)
        tid = r['tentativa']
        self.assertEqual(len(self.sql("SELECT 1 FROM supremo_estados WHERE tentativa = ?", tid)), 1)
        jogo = self.joga_eco(c, tid)
        # o estado do servidor muda depois do fim (o herói sobe 10 níveis)
        linha = self.sql("SELECT progress FROM saves WHERE conta_id = ?", c.conta['id'])[0]
        prog = json.loads(linha['progress'])
        h = prog['heroes']['sumo']
        h['level'] = min(30, int(h.get('level') or 1) + 10)
        h['xp'] = int(h.get('xp') or 0) + 50000
        self.sql("UPDATE saves SET progress = ? WHERE conta_id = ?", json.dumps(prog), c.conta['id'])
        st, r = self.fecha_eco(c, tid, jogo)
        self.assertEqual(st, 200, r)
        self.assertTrue(r['dano'] > 0, r)
        self.assertEqual(self.sql("SELECT 1 FROM supremo_estados WHERE tentativa = ?", tid), [], 'a foto sai ao fechar')

    def test_13_o_ensaio_e_recusado(self):
        """03/10 (o dono: "dificulte"). Um atacante joga a tentativa duas vezes até a rodada 2 por caminhos
        diferentes, quer a sorte dos dois e jogar o melhor. O servidor dá o sal de UM caminho por rodada; o juiz
        recusa o outro caminho jogado com aquele sal, o sal inventado e a rodada sem sal."""
        c = self.conta_pronta('Ensaiador')
        st, r = self.abre_eco(c)
        self.assertEqual(st, 200, r)
        tid = r['tentativa']
        a = self.joga_eco(c, tid)                                       # o caminho A, honesto, ao vivo
        sal_a = {x['rodada']: x['resposta']['sal'] for x in a['respostas'] if x['status'] == 200}
        cam_a = {x['rodada']: x['caminho'] for x in a['respostas']}
        self.assertTrue(len(sal_a) >= 1 and 2 in sal_a, a['respostas'])
        travadas = self.sql("SELECT rodada, caminho, sal FROM supremo_sais WHERE tentativa = ? ORDER BY rodada", tid)
        self.assertEqual([(t['rodada'], t['caminho'], t['sal']) for t in travadas],
                         [(k, cam_a[k], sal_a[k]) for k in sorted(sal_a)])
        # a rede caiu no meio da resposta: o mesmo caminho de novo recebe o MESMO sal
        st, r = c.pede('POST', '/api/supremo/sal', {'tentativa': tid, 'rodada': 2, 'caminho': cam_a[2]})
        self.assertEqual((st, r.get('sal')), (200, sal_a[2]), r)
        # ... inclusive pelo outro contêiner (a chave sai do mesmo segredo)
        st, r = self.em(c, self.base_rigorosa).pede('POST', '/api/supremo/sal', {'tentativa': tid, 'rodada': 2,
                                                                                  'caminho': cam_a[2]})
        self.assertEqual((st, r.get('sal')), (200, sal_a[2]), r)

        # O ENSAIO: o caminho B (outra casa na colocação) pede a sorte dele na rodada 2 — recusado — e segue com a
        # sorte travada no A, na esperança de o juiz não reparar
        def usa_a_sorte_de_a(pede, status, resposta):
            return sal_a.get(pede['rodada']) if status != 200 else resposta['sal']
        b = self.joga_eco(c, tid, opcao=1, responde=usa_a_sorte_de_a)
        pedido_b = b['respostas'][0]
        self.assertNotEqual(pedido_b['caminho'], cam_a[2], 'a outra casa tem de dar outro caminho')
        self.assertEqual((pedido_b['rodada'], pedido_b['status'], pedido_b['resposta'].get('motivo')),
                         (2, 409, 'caminho-preso'), pedido_b)
        self.assertEqual(self.sql("SELECT caminho FROM supremo_sais WHERE tentativa = ? AND rodada = 2", tid)[0]['caminho'],
                         cam_a[2], 'a rodada 2 continua presa ao caminho A')
        ensaios = self.sql("SELECT dados FROM eventos WHERE conta_id = ? AND tipo = 'supremo-ensaio'", c.conta['id'])
        self.assertTrue(ensaios and json.loads(ensaios[0]['dados'])['motivo'] == 'caminho-preso', ensaios)
        st, r = self.fecha_eco(c, tid, b)
        self.assertEqual((st, r.get('motivo')), (422, 'caminho-trocado'), r)
        self.assertEqual(self.sql("SELECT estado FROM supremo_tentativas WHERE id = ?", tid)[0]['estado'], 'recusada')
        st, r = self.fecha_eco(c, tid, a)
        self.assertEqual(st, 409, r)                       # a tentativa do ensaio não volta a valer

        # o sal inventado e a rodada pulada no fechar (outra tentativa, jogada honesta)
        st, r = self.abre_eco(c)
        tid2 = r['tentativa']
        jogo = self.joga_eco(c, tid2)
        k = next(i for i, l in enumerate(jogo['lances']) if l['a'] == 'r')
        forjado = json.loads(json.dumps(jogo))
        forjado['lances'][k]['s'] = (forjado['lances'][k]['s'] + 1) % (S.SAL_MAX + 1)
        st, r = self.fecha_eco(c, tid2, forjado)
        self.assertEqual((st, r.get('motivo')), (422, 'sal-forjado'), r)
        d = self.conta_pronta('Pulador')
        st, r = self.abre_eco(d)
        tid3 = r['tentativa']
        jogo = self.joga_eco(d, tid3)
        k = next(i for i, l in enumerate(jogo['lances']) if l['a'] == 'r')
        pulado = dict(jogo, lances=[l for i, l in enumerate(jogo['lances']) if i != k])
        st, r = self.fecha_eco(d, tid3, pulado)
        self.assertEqual((st, r.get('motivo')), (422, 'sal-faltando'), r)

        # o PEDIDO fora da ordem: a rodada 3 antes da 2, a 1 (é da semente), a 13, caminho torto, a de outra conta
        st, r = self.abre_eco(c)
        tid4 = r['tentativa']
        caminho = hashlib.sha256(b'qualquer').hexdigest()
        st, r = c.pede('POST', '/api/supremo/sal', {'tentativa': tid4, 'rodada': 3, 'caminho': caminho})
        self.assertEqual((st, r.get('motivo'), r.get('esperada')), (409, 'rodada-fora', 2), r)
        for corpo in ({'rodada': 1, 'caminho': caminho}, {'rodada': S.RODADAS + 1, 'caminho': caminho},
                      {'rodada': 2, 'caminho': caminho.upper()}, {'rodada': 2, 'caminho': caminho[:-1]},
                      {'rodada': '2', 'caminho': caminho}, {'rodada': True, 'caminho': caminho}):
            st, r = c.pede('POST', '/api/supremo/sal', dict(corpo, tentativa=tid4))
            self.assertEqual(st, 400, (corpo, r))
        st, r = self.conta_pronta('Bisbilhoteiro').pede('POST', '/api/supremo/sal',
                                                        {'tentativa': tid4, 'rodada': 2, 'caminho': caminho})
        self.assertEqual(st, 404, r)
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM supremo_sais WHERE tentativa = ?", tid4)[0]['n'], 0)
        # o prazo: a tentativa vencida não ganha sal (e fica vencida)
        self.sql("UPDATE supremo_tentativas SET aberta_ms = aberta_ms - ? WHERE id = ?", (S.VALIDADE_S + 60) * 1000, tid4)
        st, r = c.pede('POST', '/api/supremo/sal', {'tentativa': tid4, 'rodada': 2, 'caminho': caminho})
        self.assertEqual((st, r.get('motivo')), (410, 'vencida'), r)
        self.assertEqual(self.sql("SELECT estado, motivo FROM supremo_tentativas WHERE id = ?", tid4)[0]['estado'], 'vencida')

    def test_14_a_conta_do_sal_e_a_mesma_no_juiz(self):
        """O sal sai da API (Python) e o juiz (Node) o recalcula: as duas contas têm de ser a mesma, byte a byte."""
        chave = S.chave_da_tentativa(b'segredo-de-prova', 'tentativa-de-prova-0001')
        casos = [(2, hashlib.sha256(b'a').hexdigest()), (7, hashlib.sha256(b'b').hexdigest()), (12, '0' * 64)]
        codigo = ("const {salDe} = require(process.argv[1]); const c = JSON.parse(process.argv[2]);"
                  "process.stdout.write(JSON.stringify(c.casos.map((x) => salDe(Buffer.from(c.chave, 'hex'), x[0], x[1]))));")
        node = A.roda_node(['-e', codigo, os.path.join(RAIZ, 'servidor', 'juiz', 'supremo.js').replace('\\', '/'),
                            json.dumps({'chave': chave.hex(), 'casos': casos})])
        self.assertEqual(node, [S.sal_da_rodada(chave, r, cam) for r, cam in casos])
        self.assertTrue(all(0 <= x <= S.SAL_MAX for x in node), node)
        # e o espelho do número de rodadas (js/core/data/eco.js)
        with open(os.path.join(RAIZ, 'js', 'core', 'data', 'eco.js'), encoding='utf-8') as f:
            self.assertEqual(int(re.search(r'rodadas:\s*(\d+)', f.read()).group(1)), S.RODADAS)

    def test_11_banimento_vencido_nao_tira_do_ranking(self):
        """03/10 (revisão): o 0/1 de contas.banido só volta a 0 no próximo pedido da própria conta. O
        banimento com prazo que já venceu (a conta não pediu nada depois) não tira a conta do ranking nem
        do prêmio; o em vigor, o permanente e o de antes da tabela (sem linha) tiram."""
        agora_s = int(time.time())
        semana = S.semana_de(agora_s) - 2                   # duas semanas atrás: a test_07 fecha a passada
        contas = [self.conta_pronta('Vencido%d' % i) for i in range(4)]
        venceu, vigor, perm, legado = contas
        fim = S.inicio_da_semana(semana) + 2 * 86400
        for i, (c, pts) in enumerate(zip(contas, (900, 800, 700, 600))):
            self.sql("INSERT INTO supremo_tentativas(id, conta_id, semana, dia, semente, herois, regras, aberta_ms, "
                     "fechada_em, estado, dano, pontos, derrubou, rodada, turnos) VALUES "
                     "(?, ?, ?, ?, 1, '[\"sumo\"]', NULL, ?, ?, 'conferida', ?, ?, 0, 12, 20)",
                     'v%d-%d' % (semana, i), c.conta['id'], semana, S.dia_de(fim), (fim - 600) * 1000,
                     fim + i, pts, pts)
        for c, ini, fim_ban in ((venceu, agora_s - 7200, agora_s - 3600), (vigor, agora_s - 60, agora_s + 3600),
                                (perm, agora_s - 60, None)):
            self.sql("INSERT INTO moderacao_banimentos(conta_id, motivo, inicio, fim) VALUES (?, 'prova', ?, ?)",
                     c.conta['id'], ini, fim_ban)
        self.sql("UPDATE contas SET banido = 1 WHERE id IN (?, ?, ?, ?)", *[c.conta['id'] for c in contas])
        st, r = Cliente(self.base).pede('GET', '/api/supremo/ranking?semana=%d' % semana, token=None)
        self.assertEqual(st, 200, r)
        self.assertTrue(r['fechada'], r)
        self.assertEqual([l['pontos'] for l in r['ranking']], [900])   # só a do banimento vencido
        prem = self.sql("SELECT conta_id, posicao FROM supremo_premios WHERE semana = ?", semana)
        self.assertEqual([(p['conta_id'], p['posicao']) for p in prem], [(venceu.conta['id'], 1)])
        self.assertEqual(self.sql("SELECT banido FROM contas WHERE id = ?", venceu.conta['id'])[0]['banido'], 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
