#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova da LUTA LARGADA na API de verdade, com o JUIZ de verdade (15/09).

    python tests/luta_largada_api.py

O dono (15/09): "arrume as falhas conhecidas". Uma delas: fechar a aba no meio de uma derrota (sala solo, Poço,
sala em grupo) escapava da vida zerada — o servidor nunca recebia o fechar, e a vida_heroi ficava a de antes da luta.
O jogo agora guarda o registro da luta e a fecha antes de abrir outra (js/core/autoridade.js); o servidor cobre quem
não fecha: a conta que ABRE uma luta nova com uma luta dela ainda aberta no servidor largou a de antes
(servidor/salas.py, luta_aberta) e os heróis DELA naquela luta ficam a 0. Sobe o juiz e a API como
tests/autoridade_api.py (herda a montagem e os ajudantes; só as provas `prova_*` daqui rodam) e cobra:
  - o bilhete aberto e jogado sem fechar + uma abertura nova: os heróis daquela sala a 0 (com o máximo de verdade),
    a sala 'perdida', o aviso `largada` na resposta — também no 409 vida-zero que a própria largada provoca;
  - a luta fechada antes pelo registro (os lances guardados, sem o hash do fim): a vida do ponto em que o replay
    parou e nenhuma `largada`;
  - a sala em grupo: só os heróis da conta que largou; a sala segue aberta e o fechamento da parceira grava a vida
    dela sem regravar a de quem largou;
  - o `largou` da sala em grupo (a parte de quem saiu, pelo registro): só os heróis dele, a sala segue aberta;
  - o duelo, a Arena e a guerra também largam a luta pendente antes de abrir;
  - 19/09: a GUERRA pronta é uma luta aberta (luta_aberta_guerra): abrir uma sala com ela pendente larga a guerra —
    os heróis da conta a 0, a saída declarada (guerra_saidas), o evento e `largada` na resposta.
Os processos rodam com prioridade abaixo do normal (a máquina é dividida).
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
CANDIDATAS = [['cistern', 0, s] for s in (3, 17, 41, 77, 123)] + [['greenhouse', 0, s] for s in (3, 17, 41)]


class ProvaDaLargada(A.ProvaDaAutoridade):
    """Só os métodos `prova_*` rodam (o carregador abaixo): os `test_*` herdados são da outra prova."""

    def conta(self, apelido, niveis=None):
        c = self.novo(apelido)
        p, d = self.estado_de_partida()
        for heroi, n in (niveis or {}).items():
            p['heroes'][heroi]['level'] = n
            p['heroes'][heroi]['xp'] = self.inicial['xp'][n - 1]
        self.poe_estado(c, p, d)
        return c

    def linha(self, c, heroi='sumo'):
        linhas = self.sql("SELECT * FROM vida_heroi WHERE conta_id = ? AND heroi = ?", c.conta['id'], heroi)
        return linhas[0] if linhas else None

    def luta(self, tipo, ref, c):
        linhas = self.sql("SELECT * FROM luta_aberta WHERE tipo = ? AND ref = ? AND conta_id = ?", tipo, ref, c.conta['id'])
        return linhas[0] if linhas else None

    def abre_corpo(self, c, **corpo):
        return c.pede('POST', '/api/sala/abrir', dict({'dungeonId': 'cistern', 'roomIndex': 0, 'dificuldade': 'normal',
                                                       'herois': ['sumo']}, **corpo))

    def grupo(self, ana, bia, vencivel=False):
        """A sala em grupo aberta pela Ana (sumo) com a Bia (curandeiro); devolve (gid, jogo)."""
        sa, sb = self.save(ana), self.save(bia)
        membros = [{'progress': sa['progress'], 'db': sa['db'], 'dono': 'ana', 'herois': ['sumo']},
                   {'progress': sb['progress'], 'db': sb['db'], 'dono': 'bia', 'herois': ['curandeiro']}]
        if vencivel:
            jogo = A.roda_node([JOGADORES], {'modo': 'procura-grupo', 'membros': membros, 'candidatos': CANDIDATAS})
            self.assertEqual(jogo['fase'], 'won', 'nenhuma sala candidata é vencida pela dupla')
        else:
            jogo = {'dungeonId': 'cistern', 'roomIndex': 0, 'semente': 17}
        status, r = ana.pede('POST', '/api/grupo/abrir', {
            'dungeonId': jogo['dungeonId'], 'roomIndex': jogo['roomIndex'], 'dificuldade': 'normal', 'herois': ['sumo'],
            'dono': 'ana', 'parceiro': {'conta': bia.conta['id'], 'dono': 'bia', 'herois': ['curandeiro']}})
        self.assertEqual(status, 200, r)
        self.sql("UPDATE salas_grupo SET semente = ? WHERE gid = ?", jogo['semente'], r['gid'])
        if not vencivel:
            jogo = A.roda_node([JOGADORES], {'modo': 'grupo', 'membros': membros, 'dungeonId': 'cistern', 'roomIndex': 0,
                                             'semente': 17})
        return r['gid'], jogo

    def estado_grupo(self, gid):
        return self.sql("SELECT estado FROM salas_grupo WHERE gid = ?", gid)[0]['estado']

    # -- a sala solo ------------------------------------------------------------------------------------------
    def prova_01_sala_aberta_sem_fechar_e_largada(self):
        c = self.conta('Largou Sala')
        b = self.abre(c)
        self.assertEqual(self.luta('sala', b['bilhete'], c)['estado'], 'aberta', 'a luta aberta da conta, desde o bilhete')
        jogo = self.joga(c, b['bilhete'], corta=3)                    # jogou um pouco e fechou a aba: o servidor nunca soube
        status, r = self.abre_corpo(c)
        self.assertEqual((status, r.get('motivo'), r.get('largada')), (409, 'vida-zero', {'herois': ['sumo']}), r)
        linha = self.linha(c)
        self.assertEqual(linha['hp_fim'], 0, 'os heróis da sala largada voltam do zero')
        self.assertGreater(linha['hp_max'], 60, 'com o PV máximo de verdade (o juiz refez a sala sem lance)')
        self.assertEqual(self.sala(b['bilhete'])['estado'], 'perdida')
        self.assertEqual(self.luta('sala', b['bilhete'], c)['estado'], 'largada')
        self.assertEqual(len(self.eventos(c, 'luta-largada')), 1)
        # a vida volta aos poucos; a abertura seguinte passa, sem largada de novo
        self.sql("UPDATE vida_heroi SET desde_ms = desde_ms - 10000 WHERE conta_id = ?", c.conta['id'])
        status, r = self.abre_corpo(c)
        self.assertEqual(status, 200, r)
        self.assertNotIn('largada', r)
        self.assertIn(r['carry']['sumo'], (5, 6), 'a sala nova nasce com a vida que voltou desde a largada')
        # o bilhete largado não fecha mais: o registro que chegasse tarde não desfaz a largada
        status, r = self.fecha(c, b['bilhete'], jogo)
        self.assertEqual(status, 409, r)
        self.assertEqual(self.linha(c)['hp_fim'], 0)

    def prova_02_fechada_pelo_registro_nao_larga(self):
        c = self.conta('Honesta Sala')
        b = self.abre(c)
        jogo = self.joga(c, b['bilhete'], corta=3)
        # o jogo reaberto fecha a luta do registro ANTES do bilhete novo: os lances guardados, sem o hash do fim
        status, r = c.pede('POST', '/api/sala/fechar', {'bilhete': b['bilhete'], 'lances': jogo['lances'], 'hashFinal': None})
        self.assertEqual((status, r['fase'], r['recompensa']), (200, 'playing', None), r)
        linha = self.linha(c)
        self.assertGreater(linha['hp_fim'], 0, 'a vida do ponto em que o replay parou, não zero')
        status, r = self.abre_corpo(c)
        self.assertEqual(status, 200, r)
        self.assertNotIn('largada', r)
        self.assertEqual(self.luta('sala', b['bilhete'], c)['estado'], 'fechada')
        self.assertEqual(len(self.eventos(c, 'luta-largada')), 0)
        # o bilhete de antes do deploy (sem a linha da luta aberta) nunca é largado
        c2 = self.conta('Antiga Sala')
        b2 = self.abre(c2)
        self.sql("DELETE FROM luta_aberta WHERE ref = ?", b2['bilhete'])
        status, r = self.abre_corpo(c2)
        self.assertEqual(status, 200, r)
        self.assertNotIn('largada', r)
        # e a largada de muito tempo atrás só fica fechada (a vida já teria voltado)
        c3 = self.conta('Velha Sala')
        b3 = self.abre(c3)
        self.sql("UPDATE luta_aberta SET aberta_ms = aberta_ms - 3 * 3600 * 1000 WHERE ref = ?", b3['bilhete'])
        status, r = self.abre_corpo(c3)
        self.assertEqual(status, 200, r)
        self.assertNotIn('largada', r)
        self.assertEqual(self.luta('sala', b3['bilhete'], c3)['estado'], 'fechada')

    # -- a sala em grupo --------------------------------------------------------------------------------------
    def prova_03_grupo_so_os_herois_de_quem_largou(self):
        ana = self.conta('Ana Larga')
        bia = self.conta('Bia Fica', niveis={'curandeiro': 22})
        gid, jogo = self.grupo(ana, bia, vencivel=True)
        self.assertEqual((self.luta('grupo', gid, ana)['estado'], self.luta('grupo', gid, bia)['estado']), ('aberta', 'aberta'))
        # a Ana fecha a aba no meio e abre uma sala solo
        status, r = self.abre_corpo(ana)
        self.assertEqual((status, r.get('largada')), (409, {'herois': ['sumo']}), r)
        self.assertEqual(self.linha(ana)['hp_fim'], 0)
        self.assertIsNone(self.linha(bia, 'curandeiro'), 'os heróis da parceira não são tocados')
        self.assertEqual(self.estado_grupo(gid), 'aberta', 'a sala segue aberta: a parceira ainda fecha a dela')
        self.assertEqual(self.luta('grupo', gid, bia)['estado'], 'aberta')
        # a Bia fecha a sala com o registro limpo (vencida): paga, grava a vida DELA; a da Ana continua a 0
        status, r = bia.pede('POST', '/api/grupo/fechar', {'gid': gid, 'lances': jogo['lances'], 'hashFinal': jogo['hash'],
                                                           'fotografada': False})
        self.assertEqual((status, r['fase']), (200, 'won'), r)
        self.assertIsNotNone(self.linha(bia, 'curandeiro'), 'a gravação normal da parceira vale para os heróis dela')
        self.assertEqual(self.linha(ana)['hp_fim'], 0, 'o fechamento da parceira não regrava quem largou')

    def prova_04_grupo_largou_pelo_registro(self):
        ana = self.conta('Ana Registro')
        bia = self.conta('Bia Registro', niveis={'curandeiro': 22})
        gid, jogo = self.grupo(ana, bia)
        self.assertGreater(len(jogo['lances']), 6)
        status, r = ana.pede('POST', '/api/grupo/fechar', {'gid': gid, 'lances': jogo['lances'][:5], 'hashFinal': None,
                                                           'largou': True})
        self.assertEqual((status, r['fase']), (200, 'largou'), r)
        la = self.linha(ana)
        self.assertTrue(la is not None and la['hp_fim'] > 0, 'a vida do ponto em que o replay parou, só da Ana')
        self.assertIsNone(self.linha(bia, 'curandeiro'), 'só a parte de quem saiu')
        self.assertEqual(self.estado_grupo(gid), 'aberta')
        self.assertEqual(self.luta('grupo', gid, ana)['estado'], 'registro')
        status, r = ana.pede('POST', '/api/grupo/fechar', {'gid': gid, 'lances': jogo['lances'][:5], 'largou': True})
        self.assertEqual((status, r['fase']), (200, 'largou'), 'idempotente')
        # abrir outra luta depois não larga nada
        status, r = self.abre_corpo(ana)
        self.assertEqual(status, 200, r)
        self.assertNotIn('largada', r)
        # a Bia fecha a sala depois (largada no meio também): a vida dela grava; a da Ana fica a do registro
        status, r = bia.pede('POST', '/api/grupo/fechar', {'gid': gid, 'lances': jogo['lances'][:5], 'hashFinal': None})
        self.assertEqual((status, r['fase']), (200, 'perdida'), r)
        self.assertIsNotNone(self.linha(bia, 'curandeiro'))
        self.assertEqual(self.linha(ana)['desde_ms'], la['desde_ms'], 'a linha de quem saiu não é regravada')

    # -- as outras portas ------------------------------------------------------------------------------------
    def prova_05_duelo_arena_e_guerra_tambem_largam(self):
        c = self.conta('Larga Duelo')
        b = self.abre(c)
        self.joga(c, b['bilhete'], corta=2)
        status, r = c.pede('POST', '/api/duelo/abrir', {'did': 'larga-duelo-%d' % int(time.time() * 1000), 'herois': ['sumo']})
        self.assertEqual((status, r.get('motivo'), r.get('largada')), (409, 'vida-zero', {'herois': ['sumo']}), r)
        c2 = self.conta('Larga Arena')
        self.abre(c2)
        status, r = c2.pede('POST', '/api/arena/inscrever', {'herois': ['sumo', 'curandeiro']})
        self.assertEqual((status, r.get('largada')), (409, {'herois': ['sumo']}), r)
        c3 = self.conta('Larga Guerra')
        self.abre(c3)
        status, r = c3.pede('POST', '/api/guerra/inscrever', {'parceiro': c2.conta['id'], 'herois': ['sumo', 'curandeiro'],
                                                             'dono': 'guerreira'})
        self.assertEqual(r.get('largada'), {'herois': ['sumo']}, r)
        self.assertEqual(self.linha(c3)['hp_fim'], 0)

    # -- a guerra pronta (19/09) ------------------------------------------------------------------------------------
    def prova_06_guerra_pronta_largada(self):
        """19/09 (a revisão da guerra): a guerra PRONTA é uma luta aberta (luta_aberta_guerra) — quem abre uma sala
        com ela pendente larga a guerra: os heróis dela a 0 com o máximo de verdade, a saída declarada em
        guerra_saidas, o evento, e a resposta com `largada`; a guerra segue para os outros três."""
        js = [self.conta(n) for n in ('Ana Guerra', 'Bia Guerra', 'Cris Guerra', 'Duda Guerra')]
        a1, a2, b1, b2 = js
        for c, d in zip(js, ('ana', 'bia', 'cris', 'duda')):
            c.dono = d
        for lider, parceiro in ((a1, a2), (b1, b2)):
            status, r = lider.pede('POST', '/api/guilda/criar', {'nome': 'Clã ' + self.serie('g'), 'emblema': '⚔'})
            self.assertEqual(status, 200, r)
            status, r = parceiro.pede('POST', '/api/guilda/entrar', {'gid': r['guilda']['id']})
            self.assertEqual(status, 200, r)
        for lider, parceiro in ((a1, a2), (b1, b2)):
            status, r = lider.pede('POST', '/api/guerra/inscrever', {'parceiro': parceiro.conta['id'],
                                                                    'herois': ['sumo', 'curandeiro'], 'dono': lider.dono})
            self.assertEqual(status, 200, r)
            status, r = parceiro.pede('POST', '/api/guerra/juntar', {'herois': ['sumo', 'curandeiro'], 'dono': parceiro.dono})
            self.assertEqual(status, 200, r)
        self.assertEqual(r['fase'], 'casada', r)
        for c in js:
            status, r = c.pede('POST', '/api/guerra/confirmar', {})
            self.assertEqual(status, 200, r)
        for _ in range(25):
            status, e = a1.pede('GET', '/api/guerra/estado')
            if e.get('ata'):
                break
            time.sleep(0.2)
        self.assertEqual((e['fase'], bool(e.get('ata'))), ('pronta', True), e)
        gid = e['gid']
        self.assertEqual([x['estado'] for x in self.sql("SELECT estado FROM luta_aberta_guerra WHERE gid = ?", gid)], ['aberta'] * 4)
        # a Ana abre um calabouço no meio da guerra: larga a guerra (409 vida-zero da própria largada)
        status, r = self.abre_corpo(a1)
        self.assertEqual((status, r.get('motivo'), r.get('largada')), (409, 'vida-zero', {'herois': ['sumo', 'curandeiro']}), r)
        for h in ('sumo', 'curandeiro'):
            linha = self.linha(a1, h)
            self.assertEqual(linha['hp_fim'], 0, h)
            self.assertGreater(linha['hp_max'], 60, 'o máximo de verdade (o juiz refez a guerra sem lance)')
        self.assertEqual(self.sql("SELECT estado FROM luta_aberta_guerra WHERE conta_id = ?", a1.conta['id'])[0]['estado'], 'largada')
        self.assertEqual([x['motivo'] for x in self.sql("SELECT motivo FROM guerra_saidas WHERE gid = ?", gid)], ['largada'])
        self.assertEqual(json.loads(self.eventos(a1, 'luta-largada')[0]['dados'])['tipo'], 'guerra')
        self.assertEqual(a1.pede('GET', '/api/guerra/estado')[1]['fase'], 'livre')
        self.assertEqual(a2.pede('GET', '/api/guerra/estado')[1]['fase'], 'pronta', 'a guerra segue para os outros')
        self.assertIsNone(self.linha(a2), 'os heróis dos outros não são tocados')
        # abrir de novo depois não larga nada (a saída já está declarada)
        self.sql("UPDATE vida_heroi SET desde_ms = desde_ms - 10000 WHERE conta_id = ?", a1.conta['id'])
        status, r = self.abre_corpo(a1)
        self.assertEqual(status, 200, r)
        self.assertNotIn('largada', r)


if __name__ == '__main__':
    carregador = unittest.TestLoader()
    carregador.testMethodPrefix = 'prova_'
    resultado = unittest.TextTestRunner(verbosity=2).run(carregador.loadTestsFromTestCase(ProvaDaLargada))
    sys.exit(0 if resultado.wasSuccessful() else 1)
