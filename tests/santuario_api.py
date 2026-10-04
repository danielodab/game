#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova do SANTUÁRIO DOS ELEMENTOS no servidor (03/10), com o juiz e a API de verdade.

    python tests/santuario_api.py

Sobe o juiz e a API como tests/autoridade_api.py (o mesmo palco: banco descartável, portas
livres, prioridade abaixo do normal) e prova que o calabouço especial 'elementsanctum' passa
pelo MESMO caminho dos seis — o servidor manda na economia dele também:
  - o juiz anuncia o calabouço com cinco salas (GET /regras) na versão 7 das regras, sem tirar
    nenhum dos seis nem o Poço;
  - o bilhete abre nas cinco salas e em nenhuma sexta;
  - a Câmara Apagada jogada de verdade (a IA do jogo conduz a dupla, sem ninguém do Fogo: a
    regra do escuro vale o tempo todo) fecha no juiz com o MESMO hash e paga no estado do
    servidor: experiência e vinténs, pedra do elemento do quadrante, peça do Coração Partido
    (nunca épica nem lendária fora do Altar) — e NENHUM selo, insígnia, âncora, carta ou
    carta de bicho, que são só de chefe;
  - a vida do fim da sala atravessa para a sala seguinte (a vida única);
  - o lance adulterado e o fim forjado caem como 'divergiu', sem mexer no estado (o golpe que
    o escuro recusa anotado como aceito está em tests/santuario_regras.js, direto no juiz);
  - a sala em grupo pela Rede: duas contas abrem a sala do Santuário, o juiz a refaz uma vez
    e paga as duas.
As sementes são fixadas só no banco da prova (o servidor de verdade sorteia a dele).
"""
import copy
import json
import os
import sys
import unittest
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
import autoridade_api as A  # noqa: E402  (o palco: juiz + API num banco descartável)

ID = 'elementsanctum'
SEMENTE_QUE_VENCE = 1             # a Câmara Apagada no fácil, Bárbaro de Terra e Curandeira de Água no 30: a IA vence
JOGADORES = os.path.join(AQUI, 'juiz_grupo_jogador.js')
PEDRAS_DO_QUADRANTE = 'fogo'


def _juiz(base, rota):
    with urllib.request.urlopen(base + rota, timeout=5) as r:
        return json.loads(r.read().decode('utf-8'))


# O palco sem as provas dele: herdar ProvaDaAutoridade traria as vinte provas da autoridade para rodar de novo
# aqui. `None` no lugar de cada test_* faz o unittest não as enxergar; os ajudantes (novo, poe_estado, sql,
# save, joga, fecha, fecha_lutas, eventos) ficam.
Palco = type('Palco', (A.ProvaDaAutoridade,), {n: None for n in dir(A.ProvaDaAutoridade) if n.startswith('test_')})


class ProvaDoSantuario(Palco):

    def estado30(self):
        """A dupla de sempre da conta nova, no teto: o Bárbaro de Terra e a Curandeira de Água."""
        p = copy.deepcopy(self.inicial['progress'])
        d = copy.deepcopy(self.inicial['db'])
        for heroi, elemento in (('sumo', 'terra'), ('curandeiro', 'agua')):
            p['heroes'][heroi]['level'] = 30
            p['heroes'][heroi]['xp'] = self.inicial['xp'][29]
            p['heroes'][heroi]['element'] = elemento
        d['carteira'] = {'moedas': 0}
        return p, d

    def conta30(self, apelido):
        c = self.novo(apelido)
        p, d = self.estado30()
        self.poe_estado(c, p, d)
        return c

    def abre_santuario(self, c, sala=0, semente=SEMENTE_QUE_VENCE, dificuldade='facil'):
        status, r = c.pede('POST', '/api/sala/abrir', {'dungeonId': ID, 'roomIndex': sala, 'dificuldade': dificuldade,
                                                       'herois': ['sumo', 'curandeiro']})
        self.assertEqual(status, 200, r)
        if semente is not None:
            self.sql("UPDATE salas SET semente = ? WHERE bilhete = ?", semente, r['bilhete'])
            r['semente'] = semente
        return r

    def dados_do_jogo(self):
        codigo = ("const {mundo} = require(process.argv[1]); const D = mundo(['js/core/progress.js']).JOGO.DATA;"
                  "const it = {}; Object.keys(D.items).forEach((k) => { it[k] = { dg: D.items[k].dungeonId || null, r: D.items[k].rarity }; });"
                  "const st = {}; Object.keys(D.stones).forEach((k) => { st[k] = D.stones[k].element || null; });"
                  "process.stdout.write(JSON.stringify({ itens: it, pedras: st, ancora: (D.upgrade || {}).guardStone || 'stone-anchor' }));")
        motor = os.path.join(A.RAIZ, 'servidor', 'juiz', 'motor.js').replace('\\', '/')
        return A.roda_node(['-e', codigo, motor])

    # ---------------------------------------------------------------------------------------------
    def test_01_o_juiz_anuncia_o_santuario(self):
        r = _juiz(self.juiz, '/regras')
        self.assertEqual(r['calaboucos'].get(ID), 5, r['calaboucos'])
        self.assertGreaterEqual(r['regras'], 7, 'o Santuário subiu a versão das regras')
        for dg in ('greenhouse', 'cistern', 'emberlock', 'windscaffold', 'quakemine', 'brokenheart'):
            self.assertEqual(r['calaboucos'].get(dg), 3, dg)
        self.assertIn('poco', r['calaboucos'])

    def test_02_o_bilhete_abre_nas_cinco_salas(self):
        c = self.conta30('Sant Bilhete')
        for sala in range(5):
            b = self.abre_santuario(c, sala=sala, semente=None)
            linha = self.sala(b['bilhete'])
            self.assertEqual((linha['dungeon'], linha['sala'], linha['estado']), (ID, sala, 'aberta'))
            self.fecha_lutas(c)
        status, r = c.pede('POST', '/api/sala/abrir', {'dungeonId': ID, 'roomIndex': 5, 'herois': ['sumo']})
        self.assertEqual(status, 400, r)
        self.assertIn('5', r.get('erro', ''))

    def test_03_a_camara_apagada_paga_no_estado_do_servidor(self):
        c = self.conta30('Sant Vence')
        antes = self.save(c)
        b = self.abre_santuario(c)
        jogo = self.joga(c, b['bilhete'])
        self.assertEqual(jogo['fase'], 'won', 'a sala da prova precisa ser vencida pela IA (semente %d)' % SEMENTE_QUE_VENCE)
        status, r = self.fecha(c, b['bilhete'], jogo)
        self.assertEqual(status, 200, r)
        self.assertEqual(r['fase'], 'won')
        rw = r['recompensa']
        self.assertGreater(rw['xpGanho'], 0)
        self.assertGreater(rw['moedas'], 0)
        depois = self.save(c)
        self.assertEqual(depois['versao'], antes['versao'] + 1)
        self.assertGreater(depois['db']['carteira']['moedas'], antes['db']['carteira']['moedas'])
        self.assertEqual(self.sala(b['bilhete'])['estado'], 'paga')
        # sem chefe: nada do que é só de chefe
        self.assertEqual(rw['selos'], {}, 'selo é só de chefe')
        self.assertEqual(rw['insignias'], 0, 'insígnia é só de chefe')
        self.assertEqual(rw['cards'], [], 'carta de classe é só de chefe')
        self.assertEqual(rw['petCards'], [], 'carta de bicho é só de chefe')
        dados = self.dados_do_jogo()
        self.assertNotIn(dados['ancora'], rw['stones'], 'a Âncora é só de chefe')
        # a pedra é a do elemento do quadrante (oito guardiões de Fogo, 75% cada um: sempre cai alguma)
        self.assertTrue(rw['stones'], 'a Câmara Apagada paga pedra')
        for sid in rw['stones']:
            self.assertEqual(dados['pedras'].get(sid), PEDRAS_DO_QUADRANTE, sid)
        # a peça, quando cai, é do Coração Partido — e nunca épica nem lendária fora do Altar
        for iid in rw['drops']:
            self.assertEqual(dados['itens'][iid]['dg'], 'brokenheart', iid)
            self.assertNotIn(dados['itens'][iid]['r'], ('epico', 'lendario'), iid)
        # a vida única: o fim da sala atravessa para a seguinte
        linhas = self.sql("SELECT heroi, hp_fim, hp_max FROM vida_heroi WHERE conta_id = ?", c.conta['id'])
        self.assertEqual(sorted(l['heroi'] for l in linhas), ['curandeiro', 'sumo'])
        feridos = {l['heroi']: l for l in linhas if l['hp_fim'] < l['hp_max']}
        vivos = [h for h, l in feridos.items() if l['hp_fim'] > 0]
        if any(l['hp_fim'] <= 0 for l in linhas):
            # quem caiu espera a vida voltar: a sala seguinte não abre com herói a 0
            status, r2 = c.pede('POST', '/api/sala/abrir', {'dungeonId': ID, 'roomIndex': 1, 'dificuldade': 'facil',
                                                            'herois': ['sumo', 'curandeiro']})
            self.assertEqual(status, 409, r2)
        else:
            b2 = self.abre_santuario(c, sala=1, semente=None)
            for h in vivos:
                self.assertGreaterEqual(b2['carry'][h], feridos[h]['hp_fim'])

    def test_04_lance_adulterado_cai_como_divergiu(self):
        c = self.conta30('Sant Trapaca')
        antes = self.save(c)
        b = self.abre_santuario(c)
        jogo = self.joga(c, b['bilhete'])
        # o lance que o motor RECUSOU (um passo ou um golpe) anotado como aceito: o juiz roda a regra do
        # mapa (o escuro, o custo da água, o pilar de pé) e acusa
        torto = copy.deepcopy(jogo)
        recusados = [i for i, l in enumerate(torto['lances']) if l.get('ok') is False]
        alvo = recusados[0] if recusados else 0
        torto['lances'][alvo]['ok'] = not torto['lances'][alvo]['ok']
        status, r = self.fecha(c, b['bilhete'], torto)
        self.assertEqual(status, 422, r)
        self.assertEqual(r['motivo'], 'divergiu')
        self.assertEqual(self.sala(b['bilhete'])['estado'], 'recusada')
        self.assertEqual(self.save(c), antes, 'nada muda no estado')
        # e o fim forjado (o hash de outra batalha) também
        self.fecha_lutas(c)
        b2 = self.abre_santuario(c)
        jogo2 = self.joga(c, b2['bilhete'])
        forjado = dict(jogo2, hash=(jogo2['hash'] + 1) % (2 ** 31))
        status, r = self.fecha(c, b2['bilhete'], forjado)
        self.assertEqual((status, r.get('motivo')), (422, 'divergiu'), r)
        self.assertEqual(self.save(c), antes)

    def test_05_a_sala_em_grupo_pela_rede(self):
        if A.status_de(self.juiz + '/grupo/fecha', {}) == 404:
            self.skipTest('o juiz não tem POST /grupo/fecha')
        ana, bia = self.novo('Ana Sant'), self.novo('Bia Sant')
        for c, heroi, elemento in ((ana, 'sumo', 'terra'), (bia, 'curandeiro', 'agua')):
            p = copy.deepcopy(self.inicial['progress'])
            p['heroes'][heroi]['level'] = 30
            p['heroes'][heroi]['xp'] = self.inicial['xp'][29]
            p['heroes'][heroi]['element'] = elemento
            self.assertEqual(c.salva(0, p, copy.deepcopy(self.inicial['db']))[0], 200)
        sa, sb = self.save(ana), self.save(bia)
        membros = [{'progress': sa['progress'], 'db': sa['db'], 'dono': 'ana', 'herois': ['sumo']},
                   {'progress': sb['progress'], 'db': sb['db'], 'dono': 'bia', 'herois': ['curandeiro']}]
        achada = A.roda_node([JOGADORES], {'modo': 'procura-grupo', 'membros': membros, 'dificuldade': 'facil',
                                           'candidatos': [[ID, 0, s] for s in range(1, 25)]}, tempo=600)
        self.assertEqual(achada['fase'], 'won', 'nenhuma semente candidata é vencida pela dupla em grupo')
        corpo = {'dungeonId': ID, 'roomIndex': 0, 'dificuldade': 'facil', 'herois': ['sumo'], 'dono': 'ana',
                 'parceiro': {'conta': bia.conta['id'], 'dono': 'bia', 'herois': ['curandeiro']}}
        status, r = ana.pede('POST', '/api/grupo/abrir', corpo)
        self.assertEqual(status, 200, r)
        self.sql("UPDATE salas_grupo SET semente = ? WHERE gid = ?", achada['semente'], r['gid'])
        fecho = {'gid': r['gid'], 'lances': achada['lances'], 'hashFinal': achada['hash'], 'fotografada': False, 'autoridade': True}
        status, rf = ana.pede('POST', '/api/grupo/fechar', fecho)
        self.assertEqual(status, 200, rf)
        self.assertEqual(rf['fase'], 'won')
        self.assertEqual((self.save(ana)['versao'], self.save(bia)['versao']), (2, 2), 'as DUAS contas são pagas')
        pagos = self.sql("SELECT conta_id, recompensa FROM salas_grupo_pago WHERE gid = ?", r['gid'])
        self.assertEqual(len(pagos), 2)
        for p in pagos:
            rw = json.loads(p['recompensa'])
            self.assertGreater(rw['xpGanho'], 0)
            self.assertEqual((rw['selos'], rw['insignias'], rw['cards']), ({}, 0, []))


if __name__ == '__main__':
    unittest.main(verbosity=2)
