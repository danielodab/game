#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova das POÇÕES DE VIDA e da VIDA ENTRE AS SALAS na API de verdade, com o JUIZ de verdade.

    python tests/pocoes_api.py

O pedido do dono (13/09): "no mercadinho do jogo deve ter poções à venda por vinténs" e,
depois, "a poção não é para usar na batalha.. e sim para curar a vida após uma batalha na sala
de espera entre as salas.. quando acaba a luta o jogador fica com a vida que terminou a última
luta.. carrega 1 pv a cada 2 segundos. se um personagem morre ele vem com a vida zerada
aumentando 1 pv a cada 2 s também". Sobe o juiz e a API como tests/autoridade_api.py (herda a
montagem e os ajudantes de lá; só as provas `prova_*` daqui rodam) e cobra:
  - a compra pela /api/op (comprarPocao), como antes;
  - o lance de poção na batalha: 422 'pocao-na-batalha', sala recusada, nada gravado;
  - a vitória não desconta poção e abre a sala de espera (vida_espera: PV do fim, máximo, instante);
  - a regeneração calculada no servidor ao abrir a sala seguinte (1 PV a cada 2 s, até o máximo);
  - o herói caído: abrir recusado (409 'vida-zero', com os segundos) até ele ter 1 PV;
  - beber na sala de espera (POST /api/sala/pocao): cura, desconta, não passa do máximo, entra no
    carry da sala seguinte; recusa cheio, sem poção, herói de fora, op pelo cliente, outra conta e
    a descida que já seguiu;
  - em grupo (POST /api/grupo/pocao): cada um cura só os próprios, com as próprias poções; a sala
    do grupo espera todos de pé.
O RELÓGIO: a prova mexe no instante do fechamento guardado no banco dela (vida_espera.fechou_ms)
— no passado para a vida ter voltado, no futuro para o relógio ficar parado enquanto a prova bebe.
Os processos rodam com prioridade abaixo do normal (a máquina é dividida).
"""
import json
import os
import secrets
import sys
import time
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
import autoridade_api as A  # noqa: E402  (a montagem do juiz e da API e os ajudantes)

PEQ, MED, GRA = 'pocao-pequena', 'pocao-media', 'pocao-grande'
PARADO = 60 * 1000                # o fechamento 60 s no futuro: a vida não sobe enquanto a prova bebe


def agora_ms():
    return int(time.time() * 1000)


class ProvaDasPocoes(A.ProvaDaAutoridade):
    """Só os métodos `prova_*` rodam (o carregador abaixo): os `test_*` herdados são da outra prova."""

    def conta_com(self, apelido, pocoes=None, carteira=0):
        c = self.novo(apelido)
        p, d = self.estado_de_partida(carteira=carteira)
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

    def vida(self, ref):
        return {l['chave']: l for l in self.sql("SELECT * FROM vida_espera WHERE ref = ?", ref)}

    def poe_vida(self, ref, chave, **campos):
        for campo, valor in campos.items():
            self.sql("UPDATE vida_espera SET %s = ? WHERE ref = ? AND chave = ?" % campo, valor, ref, chave)

    def bebe(self, c, bilhete, heroi, pocao):
        return c.pede('POST', '/api/sala/pocao', {'bilhete': bilhete, 'heroId': heroi, 'pocaoId': pocao})

    # -- a banca pela /api/op ----------------------------------------------------------------
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

    # -- a batalha não bebe ---------------------------------------------------------------------
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
        self.assertEqual(self.vida(b['bilhete']), {}, 'e nenhuma sala de espera nasce')

    def prova_03_vitoria_nao_desconta_e_abre_a_espera(self):
        c = self.conta_com('Vitoriosa', {PEQ: 4})
        t0 = agora_ms()
        bilhete, r = self.vence(c)
        s = self.save(c)
        self.assertEqual(s['progress'].get('consumiveis'), {PEQ: 4}, 'a vitória não mexe nas poções')
        v = self.vida(bilhete)
        self.assertEqual(set(v), set(r['carry']))
        linha = v['sumo']
        self.assertEqual(linha['hp_fim'], r['carry']['sumo'], 'o PV com que o herói terminou')
        self.assertGreater(linha['hp_max'], 0)
        self.assertGreaterEqual(linha['hp_max'], linha['hp_fim'])
        self.assertEqual((linha['conta_id'], linha['cura']), (c.conta['id'], 0))
        self.assertTrue(t0 <= linha['fechou_ms'] <= agora_ms(), 'o instante do fechamento, no relógio do servidor')
        # a sala largada (perdida) não abre sala de espera nem muda o estado
        b2 = self.abre(c)
        jogo2 = self.joga(c, b2['bilhete'], corta=1)
        status, r2 = self.fecha(c, b2['bilhete'], jogo2)
        self.assertEqual(status, 200, r2)
        self.assertEqual((r2['fase'], r2['recompensa']), ('playing', None))
        self.assertEqual(self.save(c)['versao'], s['versao'])
        self.assertEqual(self.vida(b2['bilhete']), {})

    # -- o relógio da sala de espera ------------------------------------------------------------
    def prova_04_regeneracao_no_servidor(self):
        c = self.conta_com('Regenera')
        bilhete, r = self.vence(c)
        mx = self.vida(bilhete)['sumo']['hp_max']
        self.assertGreater(mx, 40)
        self.poe_vida(bilhete, 'sumo', hp_fim=10, fechou_ms=agora_ms() - 50000)
        b1 = self.abre(c, sala=1, semente=None)
        self.assertIn(b1['carry']['sumo'], (35, 36), '10 PV + 50 s a 1 PV a cada 2 s = 35')
        self.assertEqual(json.loads(self.sala(b1['bilhete'])['carry']), b1['carry'], 'o carry do bilhete é o que o juiz refaz')
        self.poe_vida(bilhete, 'sumo', fechou_ms=agora_ms() - 3600 * 1000)
        b2 = self.abre(c, sala=1, semente=None)
        self.assertEqual(b2['carry']['sumo'], mx, 'uma hora de espera enche até o máximo, e não passa')
        # a sala seguinte jogada com esse PV fecha: o juiz refaz com o carry que o servidor deu
        jogo = self.joga(c, b2['bilhete'])
        status, rr = self.fecha(c, b2['bilhete'], jogo)
        self.assertEqual(status, 200, rr)
        self.assertEqual(rr['fase'], jogo['fase'])

    def prova_05_heroi_caido_espera_1_pv(self):
        c = self.conta_com('Caida')
        bilhete, r = self.vence(c)
        self.poe_vida(bilhete, 'sumo', hp_fim=0, fechou_ms=agora_ms() + PARADO)
        corpo = {'dungeonId': 'cistern', 'roomIndex': 1, 'dificuldade': 'normal', 'herois': ['sumo']}
        status, rr = c.pede('POST', '/api/sala/abrir', corpo)
        self.assertEqual(status, 409, rr)
        self.assertEqual((rr.get('motivo'), rr.get('heroi'), rr.get('esperaS')), ('vida-zero', 'sumo', 2), rr)
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM salas WHERE conta_id = ? AND sala = 1", c.conta['id'])[0]['n'], 0,
                         'nenhum bilhete nasce com herói a 0 PV')
        self.poe_vida(bilhete, 'sumo', fechou_ms=agora_ms() - 2100)
        b1 = self.abre(c, sala=1, semente=None)
        self.assertIn(b1['carry']['sumo'], (1, 2), 'caído volta com 0 e sobe: 2,1 s de espera = 1 PV')
        # a descida NOVA (sala 0) nasce de vida cheia
        b0 = self.abre(c, sala=0, semente=None)
        self.assertIsNone(b0['carry'])

    # -- beber na sala de espera ----------------------------------------------------------------
    def prova_06_beber_na_espera(self):
        self.precisa_op()
        c = self.conta_com('Boticaria Espera', {PEQ: 2, GRA: 1})
        bilhete, r = self.vence(c)
        mx = self.vida(bilhete)['sumo']['hp_max']
        self.assertGreater(mx, 60)
        self.poe_vida(bilhete, 'sumo', hp_fim=mx - 40, fechou_ms=agora_ms() + PARADO)      # o relógio parado
        status, b = self.bebe(c, bilhete, 'sumo', PEQ)
        self.assertEqual(status, 200, b)
        self.assertEqual((b['heroi'], b['cura'], b['hp'], b['hpMax']), ('sumo', 30, mx - 10, mx))
        s = self.save(c)
        self.assertEqual(s['progress'].get('consumiveis'), {PEQ: 1, GRA: 1}, 'a poção sai do estado do servidor')
        self.assertEqual((s['hash'], s['versao']), (b['hash'], b['versao']))
        self.assertEqual(self.vida(bilhete)['sumo']['cura'], 30, 'e a cura entra no registro da vida')
        self.assertEqual(len(self.eventos(c, 'pocao-espera')), 1)
        # a Grande com 10 faltando: enche e não passa
        status, b2 = self.bebe(c, bilhete, 'sumo', GRA)
        self.assertEqual(status, 200, b2)
        self.assertEqual(b2['hp'], mx)
        self.assertEqual(self.save(c)['progress'].get('consumiveis'), {PEQ: 1})
        # cheia: a Pequena é recusada e não gasta
        antes = self.save(c)
        status, b3 = self.bebe(c, bilhete, 'sumo', PEQ)
        self.assertEqual((status, b3.get('motivo')), (409, 'cheio'), b3)
        self.assertEqual(self.save(c), antes)
        # ferida de novo (a prova zera as curas): sem a Média, a op cai inteira
        self.poe_vida(bilhete, 'sumo', cura=0)
        status, b4 = self.bebe(c, bilhete, 'sumo', MED)
        self.assertEqual((status, b4.get('motivo')), (422, 'sem-pocao'), b4)
        self.assertEqual(self.save(c), antes)
        self.assertEqual(self.vida(bilhete)['sumo']['cura'], 0)
        # herói que não desceu; a op pelo cliente; o bilhete de outra conta
        status, b5 = self.bebe(c, bilhete, 'curandeiro', PEQ)
        self.assertEqual((status, b5.get('motivo')), (400, 'heroi'), b5)
        status, b6 = c.pede('POST', '/api/op', {'ops': [{'nome': 'beberPocao', 'args': {'id': PEQ}}]})
        self.assertEqual(status, 403, b6)
        intrusa = self.conta_com('Intrusa', {PEQ: 1})
        status, b7 = self.bebe(intrusa, bilhete, 'sumo', PEQ)
        self.assertEqual(status, 404, b7)
        self.assertEqual(self.save(c), antes)
        # a última Pequena, e a porta: a sala seguinte nasce com o fim + a cura (o relógio parado)
        status, b8 = self.bebe(c, bilhete, 'sumo', PEQ)
        self.assertEqual(status, 200, b8)
        self.assertEqual(b8['hp'], mx - 10)
        self.assertIsNone(self.save(c)['progress'].get('consumiveis'), 'a última poção some do estado')
        b1 = self.abre(c, sala=1, semente=None)
        self.assertEqual(b1['carry']['sumo'], mx - 10, 'a poção bebida na espera entra no carry da sala seguinte')
        # a descida seguiu: o bilhete velho não abre mais a sala de espera
        status, b9 = self.bebe(c, bilhete, 'sumo', PEQ)
        self.assertEqual((status, b9.get('motivo')), (409, 'sem-descida'), b9)

    # -- em grupo ---------------------------------------------------------------------------------
    def prova_07_grupo_cura_so_os_proprios(self):
        self.precisa_op()
        ana = self.conta_com('Ana do Grupo', {PEQ: 2})
        bia = self.conta_com('Bia do Grupo', {MED: 1})
        ida, idb = ana.conta['id'], bia.conta['id']
        # a sala 0 do grupo, vencida, gravada direto no banco da prova (a partida em grupo de verdade
        # é de tests/grupo_duelo_api.py): a Ana terminou com 10 PV, o herói da Bia caído
        gid, t = secrets.token_urlsafe(18), int(time.time())
        party = [{'conta': ida, 'dono': 'ana', 'herois': ['sumo']}, {'conta': idb, 'dono': 'bia', 'herois': ['sumo']}]
        self.sql("INSERT INTO salas_grupo(gid, lider_id, membro_id, dungeon, sala, dificuldade, semente, party, carry, "
                 "aberta_em, fechada_em, estado, carry_saida) VALUES (?, ?, ?, 'cistern', 0, 'normal', 1, ?, NULL, ?, ?, 'paga', ?)",
                 gid, ida, idb, json.dumps(party), t - 60, t - 30, json.dumps({'ana:sumo': 10, 'bia:sumo': 0}))
        parado = agora_ms() + PARADO
        for chave, conta_id, hp in (('ana:sumo', ida, 10), ('bia:sumo', idb, 0)):
            self.sql("INSERT INTO vida_espera(ref, chave, conta_id, hp_fim, hp_max, fechou_ms, cura) VALUES (?, ?, ?, ?, 200, ?, 0)",
                     gid, chave, conta_id, hp, parado)
        abrir = {'dungeonId': 'cistern', 'roomIndex': 1, 'dificuldade': 'normal', 'herois': ['sumo'], 'dono': 'ana',
                 'parceiro': {'conta': idb, 'dono': 'bia', 'herois': ['sumo']}}
        status, r = ana.pede('POST', '/api/grupo/abrir', abrir)
        self.assertEqual((status, r.get('motivo'), r.get('heroi')), (409, 'vida-zero', 'bia:sumo'), r)
        # a Ana bebe: a chave é a DELA, a poção sai do estado DELA
        status, r = ana.pede('POST', '/api/grupo/pocao', {'gid': gid, 'heroId': 'sumo', 'pocaoId': PEQ})
        self.assertEqual(status, 200, r)
        self.assertEqual((r['heroi'], r['cura'], r['hp']), ('ana:sumo', 30, 40))
        self.assertEqual(self.save(ana)['progress'].get('consumiveis'), {PEQ: 1})
        self.assertEqual(self.save(bia)['progress'].get('consumiveis'), {MED: 1}, 'as poções da Bia não saem')
        v = self.vida(gid)
        self.assertEqual((v['ana:sumo']['cura'], v['bia:sumo']['cura']), (30, 0), 'e o herói da Bia não é curado')
        # a Ana não cura um herói que não é dela na sala; quem não é do grupo não bebe
        status, r = ana.pede('POST', '/api/grupo/pocao', {'gid': gid, 'heroId': 'curandeiro', 'pocaoId': PEQ})
        self.assertEqual((status, r.get('motivo')), (400, 'heroi'), r)
        eva = self.conta_com('Eva de Fora', {PEQ: 1})
        status, r = eva.pede('POST', '/api/grupo/pocao', {'gid': gid, 'heroId': 'sumo', 'pocaoId': PEQ})
        self.assertEqual(status, 404, r)
        # a Bia cura o dela com a própria Média
        status, r = bia.pede('POST', '/api/grupo/pocao', {'gid': gid, 'heroId': 'sumo', 'pocaoId': MED})
        self.assertEqual(status, 200, r)
        self.assertEqual((r['heroi'], r['hp']), ('bia:sumo', 70))
        self.assertIsNone(self.save(bia)['progress'].get('consumiveis'))
        self.assertEqual(self.save(ana)['progress'].get('consumiveis'), {PEQ: 1})
        # todos de pé: a sala do grupo abre com a vida de cada um
        status, r = ana.pede('POST', '/api/grupo/abrir', abrir)
        self.assertEqual(status, 200, r)
        self.assertEqual(r['carry'], {'ana:sumo': 40, 'bia:sumo': 70})
        # e a sala de espera acabou: o gid velho não bebe mais
        status, r = ana.pede('POST', '/api/grupo/pocao', {'gid': gid, 'heroId': 'sumo', 'pocaoId': PEQ})
        self.assertEqual((status, r.get('motivo')), (409, 'sem-descida'), r)


if __name__ == '__main__':
    carregador = unittest.TestLoader()
    carregador.testMethodPrefix = 'prova_'
    resultado = unittest.TextTestRunner(verbosity=2).run(carregador.loadTestsFromTestCase(ProvaDasPocoes))
    sys.exit(0 if resultado.wasSuccessful() else 1)
