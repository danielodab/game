#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova das POÇÕES DE VIDA e da VIDA ÚNICA DO HERÓI na API de verdade, com o JUIZ de verdade.

    python tests/pocoes_api.py

O pedido do dono (13/09): poções à venda no mercadinho e "a poção não é para usar na batalha". E (14/09):
"hoje nas salas de espera a vida vai recuperando aos poucos até encher ou o jogador usa pote; isso vale para
quando terminar calabouço (na praça), depois de um pvp e assim por diante; e se o jogador estiver com a vida
na metade e começar uma batalha sendo pvp, poço, desafio ou outro calabouço, a vida vai começar onde estava,
na metade". Sobe o juiz e a API como tests/autoridade_api.py (herda a montagem e os ajudantes de lá; só as
provas `prova_*` daqui rodam) e cobra:
  - a compra pela /api/op (comprarPocao) e o lance de poção na batalha recusado (nada gravado);
  - a vitória, a derrota e a sala largada gravam a linha do herói (vida_heroi: PV do fim, máximo, instante);
  - QUALQUER sala (a 0, o Poço, outro calabouço) nasce com a vida da linha; 1 PV a cada 2 s; cheio sai do carry;
  - o herói caído: abrir recusado (409 vida-zero, com os segundos) até ter 1 PV;
  - GET /api/vida: só os feridos, com cheioEmMs e ate1Ms;
  - POST /api/vida/pocao na praça: cura, desconta, não passa do máximo; recusa cheio, sem poção, herói que não
    é da conta e a op pelo cliente; as rotas de antes (/api/sala/pocao e /api/grupo/pocao) bebem igual;
  - o grupo abre com a linha de cada conta;
  - o duelo: /api/duelo/abrir guarda a vida (idempotente, 409 vida-zero, teto por hora); /api/duelo/fechar
    refaz com ela (o registro jogado de vida cheia diverge e não grava) e grava a vida dos DOIS lados —
    ranqueado, largado no meio e acima do teto; o fotografado não grava.
O RELÓGIO: a prova mexe no instante da linha no banco dela (vida_heroi.desde_ms) — no passado para a vida ter
voltado, no futuro para o relógio ficar parado enquanto a prova bebe. Os processos rodam com prioridade abaixo
do normal (a máquina é dividida).
"""
import json
import os
import sys
import time
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
import autoridade_api as A  # noqa: E402  (a montagem do juiz e da API e os ajudantes)

JOGADORES = os.path.join(AQUI, 'juiz_grupo_jogador.js')
PEQ, MED, GRA = 'pocao-pequena', 'pocao-media', 'pocao-grande'
PARADO = 60 * 1000                # a linha 60 s no futuro: a vida não sobe enquanto a prova bebe


def agora_ms():
    return int(time.time() * 1000)


class ProvaDasPocoes(A.ProvaDaAutoridade):
    """Só os métodos `prova_*` rodam (o carregador abaixo): os `test_*` herdados são da outra prova."""

    def conta_com(self, apelido, pocoes=None, carteira=0, nivel=22, niveis=None):
        c = self.novo(apelido)
        p, d = self.estado_de_partida(nivel=nivel, carteira=carteira)
        for heroi, n in (niveis or {}).items():
            p['heroes'][heroi]['level'] = n
            p['heroes'][heroi]['xp'] = self.inicial['xp'][n - 1]
        if pocoes:
            p['consumiveis'] = dict(pocoes)
        self.poe_estado(c, p, d)
        return c

    def vence(self, c):
        """A sala 0 da Cisterna vencida pela IA; devolve (bilhete, resposta do fechar)."""
        b = self.abre(c)
        jogo = self.joga(c, b['bilhete'])
        self.assertEqual(jogo['fase'], 'won', 'a sala da prova precisa ser vencida pela IA')
        status, r = self.fecha(c, b['bilhete'], jogo)
        self.assertEqual(status, 200, r)
        self.assertEqual(r['fase'], 'won')
        return b['bilhete'], r

    def linha(self, c, heroi='sumo'):
        linhas = self.sql("SELECT * FROM vida_heroi WHERE conta_id = ? AND heroi = ?", c.conta['id'], heroi)
        return linhas[0] if linhas else None

    def poe_linha(self, c, heroi='sumo', hp=10, mx=200, desde=None, cura=0):
        self.sql("INSERT OR REPLACE INTO vida_heroi(conta_id, heroi, hp_fim, hp_max, desde_ms, cura) VALUES (?, ?, ?, ?, ?, ?)",
                 c.conta['id'], heroi, hp, mx, agora_ms() + PARADO if desde is None else desde, cura)

    def mexe_linha(self, c, heroi='sumo', **campos):
        for campo, valor in campos.items():
            self.sql("UPDATE vida_heroi SET %s = ? WHERE conta_id = ? AND heroi = ?" % campo, valor, c.conta['id'], heroi)

    def bebe(self, c, heroi, pocao, rota='/api/vida/pocao', **extra):
        return c.pede('POST', rota, dict({'heroId': heroi, 'pocaoId': pocao}, **extra))

    def abre_corpo(self, c, corpo):
        return c.pede('POST', '/api/sala/abrir', dict({'dungeonId': 'cistern', 'roomIndex': 0, 'dificuldade': 'normal',
                                                       'herois': ['sumo']}, **corpo))

    # -- o duelo ---------------------------------------------------------------------------------
    def did(self):
        A.ProvaDaAutoridade._n += 1
        return 'duelo-vida-%d' % A.ProvaDaAutoridade._n

    def duelistas(self, apelido):
        return (self.conta_com('Ana ' + apelido, nivel=20),
                self.conta_com('Bia ' + apelido, niveis={'curandeiro': 20}))

    def abre_duelo(self, c, did, herois):
        return c.pede('POST', '/api/duelo/abrir', {'did': did, 'herois': herois})

    def joga_duelo(self, a, b, vidaA=None, vidaB=None):
        sa, sb = self.save(a), self.save(b)
        return A.roda_node([JOGADORES], {
            'modo': 'duelo', 'dungeonId': 'cistern', 'roomIndex': 0, 'semente': 999, 'vidaA': vidaA, 'vidaB': vidaB,
            'A': {'progress': sa['progress'], 'db': sa['db'], 'dono': 'ana', 'herois': ['sumo']},
            'B': {'progress': sb['progress'], 'db': sb['db'], 'dono': 'bia', 'herois': ['curandeiro']}})

    def fecha_duelo(self, quem, a, b, did, jogo, **kw):
        corpo = {'did': did, 'dungeonId': 'cistern', 'roomIndex': 0, 'semente': 999,
                 'A': {'conta': a.conta['id'], 'dono': 'ana', 'herois': ['sumo']},
                 'B': {'conta': b.conta['id'], 'dono': 'bia', 'herois': ['curandeiro']},
                 'lances': jogo['lances'], 'hashFinal': jogo['hash'], 'fotografada': False}
        corpo.update(kw)
        return quem.pede('POST', '/api/duelo/fechar', corpo)

    # -- a banca pela /api/op e a batalha que não bebe ----------------------------------------------
    def prova_01_compra_pela_op(self):
        self.precisa_op()
        c = self.conta_com('Boticaria', carteira=2000)
        status, r = c.pede('POST', '/api/op', {'ops': [{'nome': 'comprarPocao', 'args': {'id': MED, 'qtd': 3}}]})
        self.assertEqual(status, 200, r)
        self.assertTrue(r['resultados'][0]['ok'], r['resultados'])
        s = self.save(c)
        self.assertEqual(s['db']['carteira']['moedas'], 2000 - 3 * 110, 'os vinténs saem do saco NO SERVIDOR')
        self.assertEqual(s['progress'].get('consumiveis'), {MED: 3})
        self.assertEqual(s['hash'], r['hash'])
        status, r2 = c.pede('POST', '/api/op', {'hashAntes': r['hash'], 'ops': [
            {'nome': 'comprarPocao', 'args': {'id': PEQ, 'qtd': 20}},
            {'nome': 'comprarPocao', 'args': {'id': PEQ, 'qtd': 1}},
            {'nome': 'comprarPocao', 'args': {'id': GRA, 'qtd': 4}}]})
        self.assertEqual(status, 200, r2)
        self.assertEqual([x.get('ok') for x in r2['resultados']], [True, False, False], r2['resultados'])
        self.assertTrue(r2['resultados'][1].get('cheio'), 'a 21ª Pequena passa do teto')
        self.assertTrue(r2['resultados'][2].get('semVintem'), '4 Grandes custam 1040 e o saco tem 870')
        s2 = self.save(c)
        self.assertEqual(s2['db']['carteira']['moedas'], 2000 - 330 - 800)
        self.assertEqual(s2['progress']['consumiveis'], {MED: 3, PEQ: 20})

    def prova_02_lance_de_pocao_na_batalha_recusado(self):
        c = self.conta_com('Gole Proibido', {PEQ: 3})
        antes = self.save(c)
        b = self.abre(c)
        jogo = self.joga(c, b['bilhete'])
        uid = next((l['u'] for l in jogo['lances'] if isinstance(l.get('u'), int)), 1)
        lances = jogo['lances'][:1] + [{'a': 'po', 'u': uid, 's': PEQ, 'ok': True}] + jogo['lances'][1:]
        status, r = self.fecha(c, b['bilhete'], {'lances': lances, 'hash': jogo['hash']})
        self.assertEqual(status, 422, r)
        self.assertEqual(r.get('motivo'), 'pocao-na-batalha')
        self.assertEqual(self.sala(b['bilhete'])['estado'], 'recusada')
        self.assertEqual(self.save(c), antes, 'nada muda no estado')
        self.assertIsNone(self.linha(c), 'e a sala recusada não grava vida')

    # -- o fim de toda luta grava a vida --------------------------------------------------------------
    def prova_03_fim_de_luta_grava_a_vida(self):
        c = self.conta_com('Vitoriosa', {PEQ: 4})
        t0 = agora_ms()
        bilhete, r = self.vence(c)
        s = self.save(c)
        self.assertEqual(s['progress'].get('consumiveis'), {PEQ: 4}, 'a vitória não mexe nas poções')
        linha = self.linha(c)
        self.assertEqual(linha['hp_fim'], r['carry']['sumo'], 'o PV com que o herói terminou')
        self.assertGreater(linha['hp_max'], 0)
        self.assertGreaterEqual(linha['hp_max'], linha['hp_fim'])
        self.assertEqual(linha['cura'], 0)
        self.assertTrue(t0 <= linha['desde_ms'] <= agora_ms(), 'o instante do fechamento, no relógio do servidor')
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM vida_heroi WHERE conta_id = ?", c.conta['id'])[0]['n'], 1,
                         'uma linha por herói que lutou')
        # a sala largada: a economia não muda, mas a vida é gravada de novo (o PV em que o replay parou)
        b2 = self.abre(c)
        jogo2 = self.joga(c, b2['bilhete'], corta=1)
        status, r2 = self.fecha(c, b2['bilhete'], jogo2)
        self.assertEqual(status, 200, r2)
        self.assertEqual((r2['fase'], r2['recompensa'], r2['carry']), ('playing', None, None))
        self.assertEqual(self.save(c)['versao'], s['versao'])
        linha2 = self.linha(c)
        entrou = (json.loads(self.sala(b2['bilhete'])['carry'] or 'null') or {}).get('sumo', linha2['hp_max'])
        # cortada depois da colocação, o replay ainda roda os turnos da IA até a vez do herói: a linha fica com
        # o PV em que o replay parou, nunca acima do que entrou
        self.assertLessEqual(linha2['hp_fim'], entrou, 'o PV em que o replay parou')
        self.assertLessEqual(linha2['hp_fim'], linha2['hp_max'])
        self.assertGreaterEqual(linha2['desde_ms'], linha['desde_ms'])

    def prova_04_toda_sala_nasce_com_a_vida_da_linha(self):
        c = self.conta_com('Regenera')
        self.vence(c)
        mx = self.linha(c)['hp_max']
        self.assertGreater(mx, 60)
        self.mexe_linha(c, hp_fim=10, cura=0, desde_ms=agora_ms() - 50000)
        b0 = self.abre(c, semente=None)
        self.assertIn(b0['carry']['sumo'], (35, 36), 'a sala 0 de uma descida nova também: 10 PV + 50 s = 35')
        self.assertEqual(json.loads(self.sala(b0['bilhete'])['carry']), b0['carry'], 'o carry do bilhete é o que o juiz refaz')
        for corpo in ({'dungeonId': 'poco', 'roomIndex': 0}, {'dungeonId': 'greenhouse', 'roomIndex': 0},
                      {'roomIndex': 2}):
            status, bx = self.abre_corpo(c, corpo)
            self.assertEqual(status, 200, (corpo, bx))
            self.assertIn(bx['carry']['sumo'], (35, 36, 37), ('o Poço, outro calabouço e a sala do meio: a mesma vida', corpo))
        # uma hora de espera enche: o cheio sai do carry (o motor dá o PV máximo de hoje)
        self.mexe_linha(c, desde_ms=agora_ms() - 3600 * 1000)
        b1 = self.abre(c, sala=1, semente=None)
        self.assertIsNone(b1['carry'])
        # a sala jogada com a vida da linha se refaz igual no juiz, e o fim volta para a linha
        self.mexe_linha(c, hp_fim=mx - 20, desde_ms=agora_ms() + PARADO)
        b2 = self.abre(c)
        self.assertEqual(b2['carry'], {'sumo': mx - 20})
        jogo = self.joga(c, b2['bilhete'])
        status, rr = self.fecha(c, b2['bilhete'], jogo)
        self.assertEqual(status, 200, rr)
        self.assertEqual(rr['fase'], jogo['fase'])
        if rr['fase'] == 'won':
            self.assertEqual(self.linha(c)['hp_fim'], rr['carry']['sumo'])

    def prova_05_derrota_zera_e_espera_1_pv(self):
        caida = self.conta_com('Caida', nivel=1)
        b = self.abre(caida)
        jogo = self.joga(caida, b['bilhete'])
        self.assertEqual(jogo['fase'], 'lost', 'o Bárbaro no nível 1 precisa cair na Cisterna')
        antes = self.save(caida)
        status, r = self.fecha(caida, b['bilhete'], jogo)
        self.assertEqual(status, 200, r)
        self.assertEqual((r['fase'], r['recompensa'], r['carry']), ('lost', None, None))
        self.assertEqual(self.save(caida), antes, 'a derrota não muda a economia')
        linha = self.linha(caida)
        self.assertEqual(linha['hp_fim'], 0, 'quem cai sai a 0')
        self.assertGreater(linha['hp_max'], 0)
        n_salas = self.sql("SELECT COUNT(*) AS n FROM salas WHERE conta_id = ?", caida.conta['id'])[0]['n']
        status, rr = self.abre_corpo(caida, {})
        self.assertEqual(status, 409, rr)
        self.assertEqual((rr.get('motivo'), rr.get('heroi')), ('vida-zero', 'sumo'), rr)
        self.assertIn(rr.get('esperaS'), (1, 2), rr)
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM salas WHERE conta_id = ?", caida.conta['id'])[0]['n'], n_salas,
                         'nenhum bilhete nasce com herói a 0 PV')
        self.mexe_linha(caida, desde_ms=agora_ms() - 2100)
        status, b1 = self.abre_corpo(caida, {'dungeonId': 'poco'})
        self.assertEqual(status, 200, b1)
        self.assertIn(b1['carry']['sumo'], (1, 2), 'caído volta com 0 e sobe: 2,1 s de espera = 1 PV')

    # -- GET /api/vida ------------------------------------------------------------------------------
    def prova_06_api_vida_lista_os_feridos(self):
        c = self.conta_com('Relogio')
        t = agora_ms()
        self.poe_linha(c, 'sumo', hp=10, mx=200, desde=t + PARADO)
        self.poe_linha(c, 'curandeiro', hp=0, mx=150, desde=t - 1000)
        self.poe_linha(c, 'bruxo', hp=90, mx=90, desde=t - 1000)
        status, r = c.pede('GET', '/api/vida')
        self.assertEqual(status, 200, r)
        self.assertEqual(r['msPorPv'], 2000)
        self.assertLess(abs(r['agoraMs'] - agora_ms()), 5000)
        self.assertEqual(set(r['herois']), {'sumo', 'curandeiro'}, 'o cheio não vem')
        s = r['herois']['sumo']
        self.assertEqual((s['hp'], s['max'], s['ate1Ms']), (10, 200, 0))
        self.assertEqual(s['cheioEmMs'], t + PARADO + 190 * 2000 - r['agoraMs'])
        k = r['herois']['curandeiro']
        self.assertEqual((k['hp'], k['max']), (0, 150))
        self.assertEqual(k['ate1Ms'], max(0, t + 1000 - r['agoraMs']))
        self.assertEqual(k['cheioEmMs'], t - 1000 + 150 * 2000 - r['agoraMs'])
        self.mexe_linha(c, 'sumo', desde_ms=agora_ms() - 50000)
        self.assertIn(c.pede('GET', '/api/vida')[1]['herois']['sumo']['hp'], (35, 36), '50 s depois: 25 PV a mais')
        self.mexe_linha(c, 'sumo', desde_ms=agora_ms() - 3600 * 1000)
        self.assertNotIn('sumo', c.pede('GET', '/api/vida')[1]['herois'], 'a linha que encheu sai da lista')
        vizinha = self.novo('Vizinha')
        status, r = vizinha.pede('GET', '/api/vida')
        self.assertEqual((status, r['herois']), (200, {}), 'cada conta vê a própria vida')

    # -- a poção fora da batalha -----------------------------------------------------------------------
    def prova_07_pocao_na_praca(self):
        self.precisa_op()
        c = self.conta_com('Boticaria Praca', {PEQ: 2, GRA: 1})
        mx = 200
        self.poe_linha(c, 'sumo', hp=mx - 40, mx=mx)                 # o relógio parado
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM salas WHERE conta_id = ?", c.conta['id'])[0]['n'], 0,
                         'nenhuma sala aberta: a praça')
        status, b = self.bebe(c, 'sumo', PEQ)
        self.assertEqual(status, 200, b)
        self.assertEqual((b['heroi'], b['cura'], b['hp'], b['hpMax']), ('sumo', 30, mx - 10, mx))
        s = self.save(c)
        self.assertEqual(s['progress'].get('consumiveis'), {PEQ: 1, GRA: 1}, 'a poção sai do estado do servidor')
        self.assertEqual((s['hash'], s['versao']), (b['hash'], b['versao']))
        self.assertEqual((b['progress'], b['db']), (s['progress'], s['db']))
        self.assertEqual(self.linha(c)['cura'], 30, 'e a cura entra na linha do herói')
        self.assertEqual(len(self.eventos(c, 'pocao-vida')), 1)
        # a Grande com 10 faltando: enche e não passa
        status, b2 = self.bebe(c, 'sumo', GRA)
        self.assertEqual(status, 200, b2)
        self.assertEqual(b2['hp'], mx)
        self.assertEqual(self.save(c)['progress'].get('consumiveis'), {PEQ: 1})
        # cheio: a Pequena é recusada e não gasta; sem linha também é cheio (o curandeiro nunca lutou)
        antes = self.save(c)
        status, b3 = self.bebe(c, 'sumo', PEQ)
        self.assertEqual((status, b3.get('motivo'), b3.get('hp'), b3.get('hpMax')), (409, 'cheio', mx, mx), b3)
        status, b3 = self.bebe(c, 'curandeiro', PEQ)
        self.assertEqual((status, b3.get('motivo')), (409, 'cheio'), b3)
        self.assertEqual(self.save(c), antes)
        # ferido de novo (a prova zera as curas): sem a Média, a op cai inteira
        self.mexe_linha(c, cura=0)
        status, b4 = self.bebe(c, 'sumo', MED)
        self.assertEqual((status, b4.get('motivo')), (422, 'sem-pocao'), b4)
        self.assertEqual(self.save(c), antes)
        self.assertEqual(self.linha(c)['cura'], 0)
        # o herói que não é da conta; a op pelo cliente; formas tortas
        status, b5 = self.bebe(c, 'bruxo', PEQ)
        self.assertEqual((status, b5.get('motivo')), (400, 'heroi'), b5)
        status, b6 = c.pede('POST', '/api/op', {'ops': [{'nome': 'beberPocao', 'args': {'id': PEQ}}]})
        self.assertEqual(status, 403, b6)
        self.assertEqual(self.bebe(c, '', PEQ)[0], 400)
        self.assertEqual(self.bebe(c, 'sumo', 7)[0], 400)
        # a Intrusa bebe o "sumo" DELA: a linha é por conta, a da Boticária não muda
        intrusa = self.conta_com('Intrusa', {PEQ: 1})
        status, b7 = self.bebe(intrusa, 'sumo', PEQ)
        self.assertEqual((status, b7.get('motivo')), (409, 'cheio'), b7)
        self.assertEqual(self.linha(c)['cura'], 0)
        self.assertEqual(self.save(c), antes)
        # a última Pequena, e a porta: a sala nasce com o fim + a cura (o relógio parado)
        status, b8 = self.bebe(c, 'sumo', PEQ)
        self.assertEqual(status, 200, b8)
        self.assertEqual(b8['hp'], mx - 10)
        self.assertIsNone(self.save(c)['progress'].get('consumiveis'), 'a última poção some do estado')
        b0 = self.abre(c, semente=None)
        self.assertEqual(b0['carry'], {'sumo': mx - 10}, 'a poção bebida na praça entra no carry da sala')

    def prova_08_rotas_de_antes_bebem_igual(self):
        self.precisa_op()
        c = self.conta_com('Pagina Velha', {PEQ: 2})
        self.poe_linha(c, 'sumo', hp=50, mx=200)
        status, r = self.bebe(c, 'sumo', PEQ, rota='/api/sala/pocao', bilhete='A' * 24)
        self.assertEqual(status, 200, r)
        self.assertEqual((r['cura'], r['hp'], r['hpMax']), (30, 80, 200))
        status, r = self.bebe(c, 'sumo', PEQ, rota='/api/grupo/pocao', gid='B' * 24)
        self.assertEqual(status, 200, r)
        self.assertEqual(r['hp'], 110)
        self.assertIsNone(self.save(c)['progress'].get('consumiveis'))
        self.assertEqual(self.linha(c)['cura'], 60)
        self.assertEqual(self.bebe(c, 'sumo', PEQ, rota='/api/sala/pocao', bilhete='x')[0], 400)
        self.assertEqual(self.bebe(c, 'sumo', PEQ, rota='/api/grupo/pocao')[0], 400)

    # -- em grupo ----------------------------------------------------------------------------------
    def prova_09_grupo_abre_com_a_linha_de_cada_conta(self):
        self.precisa_op()
        ana = self.conta_com('Ana do Grupo', {PEQ: 2})
        bia = self.conta_com('Bia do Grupo', {MED: 1})
        self.poe_linha(ana, 'sumo', hp=10, mx=200)
        self.poe_linha(bia, 'sumo', hp=0, mx=200)
        abrir = {'dungeonId': 'cistern', 'roomIndex': 0, 'dificuldade': 'normal', 'herois': ['sumo'], 'dono': 'ana',
                 'parceiro': {'conta': bia.conta['id'], 'dono': 'bia', 'herois': ['sumo']}}
        status, r = ana.pede('POST', '/api/grupo/abrir', abrir)
        self.assertEqual((status, r.get('motivo'), r.get('heroi')), (409, 'vida-zero', 'bia:sumo'), r)
        # a Bia bebe na praça, com a poção DELA, no herói DELA
        status, r = self.bebe(bia, 'sumo', MED)
        self.assertEqual((status, r.get('hp')), (200, 70), r)
        self.assertEqual(self.save(ana)['progress'].get('consumiveis'), {PEQ: 2}, 'as poções da Ana não saem')
        self.assertEqual(self.linha(ana)['cura'], 0, 'e o herói da Ana não é curado')
        status, r = ana.pede('POST', '/api/grupo/abrir', abrir)
        self.assertEqual(status, 200, r)
        self.assertEqual(r['carry'], {'ana:sumo': 10, 'bia:sumo': 70})
        self.assertEqual(json.loads(self.sql("SELECT carry FROM salas_grupo WHERE gid = ?", r['gid'])[0]['carry']), r['carry'])
        # a vida da Ana encheu: só a Bia no carry
        self.mexe_linha(ana, desde_ms=agora_ms() - 3600 * 1000)
        status, r = ana.pede('POST', '/api/grupo/abrir', abrir)
        self.assertEqual((status, r.get('carry')), (200, {'bia:sumo': 70}), r)

    # -- o duelo ------------------------------------------------------------------------------------
    def prova_10_duelo_abrir_guarda_a_vida(self):
        a, b = self.duelistas('Porta')
        did = self.did()
        self.poe_linha(a, 'sumo', hp=0, mx=500)
        status, r = self.abre_duelo(a, did, ['sumo'])
        self.assertEqual((status, r.get('motivo'), r.get('heroi')), (409, 'vida-zero', 'sumo'), r)
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM duelo_vida WHERE did = ?", did)[0]['n'], 0)
        self.mexe_linha(a, hp_fim=30)
        status, r = self.abre_duelo(a, did, ['sumo'])
        self.assertEqual((status, r.get('carry')), (200, {'sumo': 30}), r)
        self.mexe_linha(a, hp_fim=80)
        status, r = self.abre_duelo(a, did, ['sumo'])
        self.assertEqual((status, r.get('carry')), (200, {'sumo': 30}), 'idempotente: o guardado, não a vida de agora')
        status, r = self.abre_duelo(b, did, ['curandeiro'])
        self.assertEqual((status, r.get('carry')), (200, None), 'sem linha = cheio')
        linhas = self.sql("SELECT conta_id, herois, carry FROM duelo_vida WHERE did = ? ORDER BY conta_id", did)
        self.assertEqual([(l['conta_id'], json.loads(l['herois']), json.loads(l['carry'] or 'null')) for l in linhas],
                         [(a.conta['id'], ['sumo'], {'sumo': 30}), (b.conta['id'], ['curandeiro'], None)])
        for corpo in ({'did': 'x', 'herois': ['sumo']}, {'did': self.did(), 'herois': []},
                      {'did': self.did(), 'herois': ['bruxo']}, {'did': self.did(), 'herois': ['sumo', 'sumo']}):
            status, r = b.pede('POST', '/api/duelo/abrir', corpo)
            self.assertEqual(status, 400, (corpo, r))
        # o teto de aberturas por hora: o repetido não conta
        t = int(time.time())
        for _ in range(60):
            self.sql("INSERT INTO limites(chave, em) VALUES (?, ?)", 'duelo-abrir:%d' % b.conta['id'], t)
        status, r = self.abre_duelo(b, self.did(), ['curandeiro'])
        self.assertEqual(status, 429, r)
        self.assertGreater(r['liberaEm'], time.time())
        self.assertEqual(self.abre_duelo(b, did, ['curandeiro'])[0], 200)

    def prova_11_duelo_fechar_aplica_e_grava_os_dois(self):
        a, b = self.duelistas('Arena')
        self.poe_linha(a, 'sumo', hp=40, mx=5000)                # o relógio parado
        did = self.did()
        self.assertEqual(self.abre_duelo(a, did, ['sumo'])[1]['carry'], {'sumo': 40})
        self.assertEqual(self.abre_duelo(b, did, ['curandeiro'])[1]['carry'], None)
        # o cliente jogou de vida cheia: o servidor refaz com os 40 guardados, diverge e não grava a vida
        cheio = self.joga_duelo(a, b)
        status, r = self.fecha_duelo(a, a, b, did, cheio)
        self.assertEqual(status, 422, r)
        self.assertEqual((self.linha(a)['hp_fim'], self.linha(a)['desde_ms'] > agora_ms()), (40, True))
        self.assertIsNone(self.linha(b, 'curandeiro'))
        # o duelo jogado com a vida guardada
        did2 = self.did()
        self.abre_duelo(a, did2, ['sumo'])
        self.abre_duelo(b, did2, ['curandeiro'])
        jogo = self.joga_duelo(a, b, vidaA={'sumo': 40})
        self.assertIn(jogo['fase'], ('won', 'lost', 'empate'))
        t0 = agora_ms()
        status, r = self.fecha_duelo(a, a, b, did2, jogo)
        self.assertEqual(status, 200, r)
        self.assertEqual((r['fase'], r['ranqueado'], r['versao']), (jogo['fase'], True, 2))
        la, lb = self.linha(a), self.linha(b, 'curandeiro')
        self.assertEqual(la['hp_fim'], min(jogo['vidaFimA']['sumo'], la['hp_max']), 'a vida do fim do lado A')
        self.assertEqual(lb['hp_fim'], min(jogo['vidaFimB']['curandeiro'], lb['hp_max']), 'e a do lado B, na conta dele')
        self.assertLess(la['hp_max'], 5000, 'o máximo é o do herói de hoje, do juiz')
        for linha in (la, lb):
            self.assertEqual(linha['cura'], 0)
            self.assertTrue(t0 - 1000 <= linha['desde_ms'] <= agora_ms())
        self.assertEqual(set(r['vida']), {'sumo'}, 'a resposta traz a vida de quem pede')
        self.assertTrue(la['hp_fim'] <= r['vida']['sumo'] <= min(la['hp_max'], la['hp_fim'] + 2), r['vida'])
        status, r2 = self.fecha_duelo(b, a, b, did2, jogo)
        self.assertEqual((status, r2['versao']), (200, 2), r2)
        self.assertEqual(set(r2['vida']), {'curandeiro'}, 'o guardado também traz a vida de quem pede')
        # largado no meio (sem vencedor): a Brasa não muda, a vida grava onde o replay parou
        self.mexe_linha(a, hp_fim=40, desde_ms=agora_ms() + PARADO)
        did3 = self.did()
        self.abre_duelo(a, did3, ['sumo'])
        self.abre_duelo(b, did3, ['curandeiro'])
        status, r3 = self.fecha_duelo(a, a, b, did3, {'lances': jogo['lances'][:4], 'hash': None})
        self.assertEqual(status, 200, r3)
        self.assertEqual((r3['venc'], r3['ranqueado'], r3['versao']), (None, False, 2), r3)
        la3 = self.linha(a)
        self.assertLessEqual(la3['desde_ms'], agora_ms(), 'a linha foi regravada agora')
        self.assertLessEqual(la3['hp_fim'], 40)

    def prova_12_duelo_teto_grava_e_foto_nao(self):
        c, d = self.duelistas('Teto')
        t = int(time.time())
        for i in range(3):                                            # o par já duelou 3 vezes ranqueado hoje
            self.sql("INSERT INTO duelos(did, a_id, b_id, fase, venc, criado_em, resultado) VALUES (?, ?, ?, 'won', 'A', ?, '{}')",
                     'antigo-vida-%d-%d' % (c.conta['id'], i), c.conta['id'], d.conta['id'], t - 60)
        jogo = self.joga_duelo(c, d)                                  # nenhum abriu: entram cheios (a página de antes)
        did = self.did()
        status, r = self.fecha_duelo(c, c, d, did, jogo)
        self.assertEqual(status, 200, r)
        self.assertEqual((r['ranqueado'], r['motivo'], r['versao']), (False, 'teto', 1))
        self.assertEqual(self.sql("SELECT fase FROM duelos WHERE did = ?", did)[0]['fase'], 'teto')
        self.assertEqual(len(self.eventos(c, 'duelo-teto')), 1)
        lc, ld = self.linha(c), self.linha(d, 'curandeiro')
        self.assertIsNotNone(lc, 'acima do teto o juiz refaz e a vida é gravada')
        self.assertEqual(lc['hp_fim'], min(jogo['vidaFimA']['sumo'], lc['hp_max']))
        self.assertEqual(ld['hp_fim'], min(jogo['vidaFimB']['curandeiro'], ld['hp_max']))
        # fotografado: não refaz, não grava
        self.mexe_linha(c, desde_ms=12345)
        status, r = self.fecha_duelo(c, c, d, self.did(), jogo, fotografada=True)
        self.assertEqual((status, r['fase']), (200, 'nao-conferido'), r)
        self.assertEqual(self.linha(c)['desde_ms'], 12345)


if __name__ == '__main__':
    carregador = unittest.TestLoader()
    carregador.testMethodPrefix = 'prova_'
    resultado = unittest.TextTestRunner(verbosity=2).run(carregador.loadTestsFromTestCase(ProvaDasPocoes))
    sys.exit(0 if resultado.wasSuccessful() else 1)
