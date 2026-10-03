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
  - GET /api/eventos traz a semana do Eco como evento do mundo, com o fim no domingo 23:59:59.
"""
import json
import os
import re
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
        c = self.novo(apelido)
        self.poe_estado(c)
        return c

    def abre_eco(self, c, base=None, **kw):
        corpo = {'herois': list(HEROIS)}
        corpo.update(kw)
        cli = self.em(c, base) if base else c
        return cli.pede('POST', '/api/supremo/abrir', corpo)

    def joga_eco(self, c, tentativa, corta=None):
        s = self.save(c)
        linha = self.sql("SELECT * FROM supremo_tentativas WHERE id = ?", tentativa)[0]
        pedido = {'progress': s['progress'], 'db': s['db'], 'dungeonId': 'camara_eco', 'roomIndex': 0,
                  'semente': linha['semente'], 'dificuldade': 'normal', 'herois': json.loads(linha['herois']),
                  'carry': None}
        if corta is not None:
            pedido['cortaEm'] = corta
        return A.roda_node([A.JOGADOR], pedido)

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
        self.assertEqual((st, r.get('motivo')), (422, 'divergiu'), r)
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
        self.assertEqual(moedas(depois) - moedas(antes), 5000)
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


if __name__ == '__main__':
    unittest.main(verbosity=2)
