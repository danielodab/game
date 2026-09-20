#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova da VERSÃO DAS REGRAS do bilhete (19/09, docs/SEGURANCA.md §4.1), com o juiz de verdade.

    python tests/regras_versao_api.py

Sobe o juiz e a API como tests/autoridade_api.py (o mesmo palco: banco descartável, portas
livres, prioridade abaixo do normal) e prova o que o dono pediu ao subir a regra da visão —
"cliente velho e juiz novo não podem refazer a mesma sala com resultado diferente sem o
servidor saber":
  - GET /regras e GET /saude do juiz anunciam `regras` = Engine.VERSAO_REGRAS (inteiro ≥ 2);
  - POST /api/sala/abrir com a versão do juiz passa; com outra cai 409 'regras-velhas' com o
    número do juiz; torta cai 400; SEM o campo cai 409 também (a 2ª rodada de conserto: a única
    página que não manda é a de antes do número, e ela jogaria com as regras velhas para cair
    como 'divergiu' no fim — a revisão mediu 22% das salas dela divergindo só com a IA);
  - a sala em grupo, o duelo e a confirmação da guerra conferem o mesmo campo na abertura (409
    com outra versão ou sem o campo; nada abre), e a ata da guerra leva o número que o próprio
    /guerra/ata do juiz devolve;
  - o bilhete guarda o número do juiz em salas_regras;
  - POST /api/sala/fechar de um bilhete aberto sob OUTRA versão (a linha trocada à mão, como
    um deploy no meio da sala) vence com 410 'regras-mudaram', a sala fica 'vencida' (não
    'recusada': não é fraude) e a trilha (evento sala-vencida) diz o porquê; o bilhete da
    mesma versão fecha como sempre.
  A rodada de conserto (19/09, os achados da revisão):
  - o bilhete SEM linha em salas_regras (aberto antes do deploy que trouxe a tabela) é da
    versão 1, a implícita do engine.js: vence com 'regras-mudaram' em vez de ser refeito
    com as regras novas e cair como 'divergiu';
  - a sala em grupo, o duelo e a guerra guardam o número na abertura (salas_grupo_regras,
    duelos_regras, `regras` na ata da guerra) e vencem do mesmo jeito: 410 'grupo-vencida'
    para os dois; o duelo guardado como 'vencido' para os dois lados; a guerra fechada
    'vencida' na hora para os quatro, sem os 120 s de espera. Linha (ou chave) ausente = 1;
    o duelo sem abertura nenhuma (a página de antes do duelo/abrir) não confere.
"""
import json
import os
import sys
import time
import unittest
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, AQUI)
import autoridade_api as A  # noqa: E402  (o palco: juiz + API num banco descartável)


def _juiz(base, rota):
    with urllib.request.urlopen(base + rota, timeout=5) as r:
        return json.loads(r.read().decode('utf-8'))


class ProvaDasRegras(A.ProvaDaAutoridade):
    """Herda o palco e os ajudantes (novo, poe_estado, abre, sala, sql, eventos, fecha_lutas)."""

    def test_01_o_juiz_anuncia_a_versao_das_regras(self):
        r = _juiz(self.juiz, '/regras')
        self.assertTrue(isinstance(r.get('regras'), int) and r['regras'] >= 2, r)
        s = _juiz(self.juiz, '/saude')
        self.assertEqual(s.get('regras'), r['regras'], s)

    def test_02_abrir_confere_a_versao_do_cliente(self):
        c = self.novo('Regras')
        self.poe_estado(c)
        v = _juiz(self.juiz, '/regras')['regras']
        base = {'dungeonId': 'cistern', 'roomIndex': 0, 'dificuldade': 'normal', 'herois': ['sumo']}
        status, r = c.pede('POST', '/api/sala/abrir', dict(base, versaoRegras=v + 1))
        self.assertEqual(status, 409, r)
        self.assertEqual(r.get('motivo'), 'regras-velhas', r)
        self.assertEqual(r.get('regras'), v, r)
        self.assertEqual(c.pede('POST', '/api/sala/abrir', dict(base, versaoRegras='x'))[0], 400)
        self.assertEqual(c.pede('POST', '/api/sala/abrir', dict(base, versaoRegras=1.5))[0], 400)
        status, r = c.pede('POST', '/api/sala/abrir', dict(base, versaoRegras=v))
        self.assertEqual(status, 200, r)
        linha = self.sql("SELECT * FROM salas_regras WHERE bilhete = ?", r['bilhete'])
        self.assertEqual(len(linha), 1, linha)
        self.assertEqual(linha[0]['regras'], v)
        self.fecha_lutas(c)
        # sem o campo: a página de ANTES do número (a única que não manda) — 409 como a de versão errada, e o erro
        # diz para recarregar (a A.prepara da página velha mostra r.erro no aviso); nenhum bilhete nasce
        bilhetes = self.sql("SELECT COUNT(*) AS n FROM salas WHERE conta_id = ?", c.conta['id'])[0]['n']
        status, r2 = c.pede('POST', '/api/sala/abrir', dict(base, versaoRegras=None))
        self.assertEqual((status, r2.get('motivo'), r2.get('regras')), (409, 'regras-velhas', v), r2)
        self.assertIn('recarregue', r2.get('erro', ''), r2)
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM salas WHERE conta_id = ?", c.conta['id'])[0]['n'], bilhetes)
        # e o Cliente das provas (a página nova) manda o número sozinho
        status, r3 = c.pede('POST', '/api/sala/abrir', base)
        self.assertEqual(status, 200, r3)
        self.assertEqual(self.sql("SELECT regras FROM salas_regras WHERE bilhete = ?", r3['bilhete'])[0]['regras'], v)

    def test_03_fechar_sob_outra_versao_vence_em_vez_de_recusar(self):
        c = self.novo('Deploy')
        self.poe_estado(c)
        b = self.abre(c)
        # o "deploy no meio da sala": o bilhete ficou com a versão de antes
        self.sql("UPDATE salas_regras SET regras = regras + 1 WHERE bilhete = ?", b['bilhete'])
        status, r = c.pede('POST', '/api/sala/fechar', {'bilhete': b['bilhete'], 'lances': [], 'hashFinal': None})
        self.assertEqual(status, 410, r)
        self.assertEqual(r.get('motivo'), 'regras-mudaram', r)
        self.assertEqual(self.sala(b['bilhete'])['estado'], 'vencida', 'não é fraude: o bilhete vence')
        trilha = [json.loads(e['dados']) for e in self.eventos(c, 'sala-vencida')]
        self.assertTrue(any(t.get('motivo') == 'regras-mudaram' and t.get('bilhete') == b['bilhete'] for t in trilha), trilha)
        self.assertEqual(self.eventos(c, 'sala-recusada'), [], 'a sala não vira recusada')
        # e o bilhete fechado não fecha de novo
        self.assertEqual(c.pede('POST', '/api/sala/fechar', {'bilhete': b['bilhete'], 'lances': []})[0], 410)
        # a mesma versão: fecha como sempre (largada sem lances fica 'perdida', sem pagar)
        self.fecha_lutas(c)
        b2 = self.abre(c)
        status, r = c.pede('POST', '/api/sala/fechar', {'bilhete': b2['bilhete'], 'lances': [], 'hashFinal': None})
        self.assertEqual(status, 200, r)
        self.assertEqual(self.sala(b2['bilhete'])['estado'], 'perdida')

    def test_04_bilhete_sem_linha_e_da_versao_1_e_vence(self):
        """O bilhete aberto ANTES do deploy que trouxe salas_regras não tem linha: é da versão 1 (a implícita do
        engine.js) e vence — a revisão mediu 12 de 54 salas de antes caindo como 'divergiu' (fraude) sem isso."""
        c = self.novo('Antes')
        self.poe_estado(c)
        b = self.abre(c)
        self.sql("DELETE FROM salas_regras WHERE bilhete = ?", b['bilhete'])
        status, r = c.pede('POST', '/api/sala/fechar', {'bilhete': b['bilhete'], 'lances': [], 'hashFinal': None})
        self.assertEqual((status, r.get('motivo')), (410, 'regras-mudaram'), r)
        self.assertEqual(self.sala(b['bilhete'])['estado'], 'vencida')
        trilha = [json.loads(e['dados']) for e in self.eventos(c, 'sala-vencida')]
        self.assertTrue(any(t.get('bilhete') == b['bilhete'] and t.get('regras') == 1 for t in trilha), trilha)
        self.assertEqual(self.eventos(c, 'sala-recusada'), [])

    # -- a sala em grupo, o duelo e a guerra (a rodada de conserto) ---------------------------------------------
    def dupla(self, nome):
        a, b = self.novo(nome + ' Lider'), self.novo(nome + ' Parceiro')
        self.poe_estado(a)
        self.poe_estado(b)
        return a, b

    def abre_grupo(self, a, b):
        self.fecha_lutas(a)
        self.fecha_lutas(b)
        status, r = a.pede('POST', '/api/grupo/abrir', {
            'dungeonId': 'cistern', 'roomIndex': 0, 'dificuldade': 'normal', 'herois': ['sumo'], 'dono': 'ana',
            'parceiro': {'conta': b.conta['id'], 'dono': 'bia', 'herois': ['curandeiro']}})
        self.assertEqual(status, 200, r)
        return r['gid']

    def fecha_grupo(self, c, gid):
        return c.pede('POST', '/api/grupo/fechar', {'gid': gid, 'lances': [], 'hashFinal': None, 'fotografada': False})

    def test_05_sala_em_grupo_guarda_a_versao_e_vence_sob_outra(self):
        v = _juiz(self.juiz, '/regras')['regras']
        a, b = self.dupla('Grupo')
        gid = self.abre_grupo(a, b)
        self.assertEqual(self.sql("SELECT regras FROM salas_grupo_regras WHERE gid = ?", gid)[0]['regras'], v)
        # o deploy no meio da sala: a versão guardada é outra
        self.sql("UPDATE salas_grupo_regras SET regras = regras + 1 WHERE gid = ?", gid)
        status, r = self.fecha_grupo(a, gid)
        self.assertEqual((status, r.get('motivo')), (410, 'regras-mudaram'), r)
        g = self.sql("SELECT estado, motivo FROM salas_grupo WHERE gid = ?", gid)[0]
        self.assertEqual((g['estado'], g['motivo']), ('vencida', 'regras-mudaram'))
        for c in (a, b):
            trilha = [json.loads(e['dados']) for e in self.eventos(c, 'grupo-vencida')]
            self.assertTrue(any(t.get('gid') == gid and t.get('motivo') == 'regras-mudaram' for t in trilha), trilha)
            self.assertEqual(self.eventos(c, 'grupo-recusada'), [])
        status, r = self.fecha_grupo(b, gid)                   # o parceiro encontra a sala vencida
        self.assertEqual(status, 410, r)
        # a sala em grupo de antes do número (sem linha) é da versão 1 e vence também
        gid2 = self.abre_grupo(a, b)
        self.sql("DELETE FROM salas_grupo_regras WHERE gid = ?", gid2)
        status, r = self.fecha_grupo(b, gid2)
        self.assertEqual((status, r.get('motivo')), (410, 'regras-mudaram'), r)
        self.assertEqual(self.sql("SELECT estado FROM salas_grupo WHERE gid = ?", gid2)[0]['estado'], 'vencida')
        # a mesma versão: o juiz refaz como sempre (sem lance, a sala não é vencida: 'perdida')
        gid3 = self.abre_grupo(a, b)
        status, r = self.fecha_grupo(a, gid3)
        self.assertEqual(status, 200, r)
        self.assertEqual(r.get('fase'), 'perdida', r)

    def corpo_duelo(self, a, b, did):
        return {'did': did, 'modo': 'campo', 'dungeonId': 'cistern', 'roomIndex': 0, 'semente': 999,
                'A': {'conta': a.conta['id'], 'dono': 'ana', 'herois': ['sumo']},
                'B': {'conta': b.conta['id'], 'dono': 'bia', 'herois': ['curandeiro']},
                'lances': [], 'hashFinal': None, 'fotografada': False}

    def abre_duelo(self, a, b, did):
        self.fecha_lutas(a)
        self.fecha_lutas(b)
        for c, hs in ((a, ['sumo']), (b, ['curandeiro'])):
            status, r = c.pede('POST', '/api/duelo/abrir', {'did': did, 'herois': hs})
            self.assertEqual(status, 200, r)

    def test_06_duelo_guarda_a_versao_e_vence_sob_outra(self):
        v = _juiz(self.juiz, '/regras')['regras']
        a, b = self.dupla('Duelo')
        did = 'duelo-regras-%d' % a.conta['id']
        self.abre_duelo(a, b, did)
        self.assertEqual(self.sql("SELECT regras FROM duelos_regras WHERE did = ?", did)[0]['regras'], v)
        self.sql("UPDATE duelos_regras SET regras = regras + 1 WHERE did = ?", did)
        status, r = a.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did))
        self.assertEqual(status, 200, r)
        self.assertEqual((r.get('fase'), r.get('motivo'), r.get('ranqueado')), ('vencido', 'regras-mudaram', False), r)
        status, r2 = b.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did))     # o outro lado lê o mesmo
        self.assertEqual((status, r2.get('fase'), r2.get('motivo')), (200, 'vencido', 'regras-mudaram'), r2)
        for c in (a, b):
            self.assertTrue(any(json.loads(e['dados']).get('did') == did for e in self.eventos(c, 'duelo-vencido')))
            self.assertEqual(self.eventos(c, 'duelo-recusado'), [])
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM vida_heroi WHERE conta_id IN (?, ?)", a.conta['id'], b.conta['id'])[0]['n'], 0,
                         'a vida não é gravada: o replay não foi refeito')
        # a abertura de antes do número (duelo_vida sem duelos_regras) é da versão 1 e vence também
        did2 = did + '-antes'
        self.abre_duelo(a, b, did2)
        self.sql("DELETE FROM duelos_regras WHERE did = ?", did2)
        status, r = b.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did2))
        self.assertEqual((status, r.get('fase'), r.get('motivo')), (200, 'vencido', 'regras-mudaram'), r)
        # sem abertura nenhuma (a página de antes do duelo/abrir, as provas que só fecham) não há o que conferir
        did3 = did + '-sem-abrir'
        status, r = a.pede('POST', '/api/duelo/fechar', self.corpo_duelo(a, b, did3))
        self.assertEqual(status, 200, r)
        self.assertNotEqual(r.get('motivo'), 'regras-mudaram', r)

    def guerra_pronta(self, nome):
        """Quatro contas, duas guildas, a fila, os quatro confirmam: (js, gid, ata) (como tests/guerra_api.py)."""
        js = self.guerra_casada(nome)
        for c in js:
            status, r = c.pede('POST', '/api/guerra/confirmar', {})
            self.assertEqual(status, 200, r)
        e = None
        for _ in range(30):
            status, e = js[0].pede('GET', '/api/guerra/estado')
            if e.get('ata'):
                break
            time.sleep(0.2)
        self.assertEqual(e.get('fase'), 'pronta', e)
        self.assertTrue(e.get('ata'), e)
        return js, e['gid'], e['ata']

    def guerra_casada(self, nome):
        """Quatro contas, duas guildas, a fila casada (ninguém confirmou ainda): os quatro Clientes."""
        js = []
        for apelido in ('A1', 'A2', 'B1', 'B2'):
            c = self.novo(nome + ' ' + apelido)
            self.poe_estado(c)
            c.dono = 'rede%d' % c.conta['id']
            js.append(c)
        for lider, parceiro in ((js[0], js[1]), (js[2], js[3])):
            status, r = lider.pede('POST', '/api/guilda/criar', {'nome': 'Clã %s %d' % (nome, lider.conta['id']), 'emblema': '⚔'})
            self.assertEqual(status, 200, r)
            status, r = parceiro.pede('POST', '/api/guilda/entrar', {'gid': r['guilda']['id']})
            self.assertEqual(status, 200, r)
            status, r = lider.pede('POST', '/api/guerra/inscrever', {'parceiro': parceiro.conta['id'], 'herois': ['sumo', 'curandeiro'],
                                                                     'dono': lider.dono})
            self.assertEqual(status, 200, r)
            status, r = parceiro.pede('POST', '/api/guerra/juntar', {'herois': ['sumo', 'curandeiro'], 'dono': parceiro.dono})
            self.assertEqual(status, 200, r)
        self.assertEqual(r['fase'], 'casada', r)
        return js

    def test_07_guerra_guarda_a_versao_na_ata_e_vence_sob_outra(self):
        v = _juiz(self.juiz, '/regras')['regras']
        js, gid, ata = self.guerra_pronta('Guerra')
        self.assertEqual(ata.get('regras'), v, 'a ata leva a versão das regras do juiz')
        # o deploy no meio da guerra: a ata guardada é de outra versão
        self.sql("UPDATE guerra_partidas SET ata = ? WHERE gid = ?", json.dumps(dict(ata, regras=v + 1)), gid)
        status, r = js[1].pede('POST', '/api/guerra/fechar', {'gid': gid, 'lances': [], 'hashFinal': None})
        self.assertEqual(status, 200, r)
        self.assertEqual((r.get('fase'), r.get('motivo'), r.get('fechada'), r.get('xp')), ('vencida', 'regras-mudaram', True, 0), r)
        self.assertEqual(self.sql("SELECT fase FROM guerra_resultados WHERE gid = ?", gid)[0]['fase'], 'vencida')
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM guerra_espera WHERE gid = ?", gid)[0]['n'], 0, 'sem os 120 s de espera')
        for c in js:
            fins = [json.loads(e['dados']) for e in self.eventos(c, 'guerra-fim')]
            self.assertTrue(any(f.get('gid') == gid and f.get('motivo') == 'regras-mudaram' for f in fins), fins)
            self.assertEqual(self.eventos(c, 'guerra-recusada'), [])
        status, r = js[2].pede('POST', '/api/guerra/fechar', {'gid': gid, 'lances': [], 'hashFinal': None})
        self.assertEqual((status, r.get('fase'), r.get('motivo')), (200, 'vencida', 'regras-mudaram'), r)
        # a ata de antes do número (sem a chave) é da versão 1 e vence também
        js2, gid2, ata2 = self.guerra_pronta('Antes')
        ata2.pop('regras', None)
        self.sql("UPDATE guerra_partidas SET ata = ? WHERE gid = ?", json.dumps(ata2), gid2)
        status, r = js2[3].pede('POST', '/api/guerra/fechar', {'gid': gid2, 'lances': [], 'hashFinal': None})
        self.assertEqual((status, r.get('fase'), r.get('motivo')), (200, 'vencida', 'regras-mudaram'), r)

    def test_08_grupo_duelo_e_guerra_conferem_a_versao_na_abertura(self):
        """A 2ª rodada de conserto: a página de antes do deploy não abre a sala em grupo, não abre o duelo e não
        confirma a guerra para cair como fraude no fim — 409 'regras-velhas' com outra versão OU sem o campo (a
        página de antes do número), e nada abre; a página nova (o Cliente das provas) passa."""
        v = _juiz(self.juiz, '/regras')['regras']
        a, b = self.dupla('Abertura')
        self.fecha_lutas(a)
        self.fecha_lutas(b)
        corpo_grupo = {'dungeonId': 'cistern', 'roomIndex': 0, 'dificuldade': 'normal', 'herois': ['sumo'], 'dono': 'ana',
                       'parceiro': {'conta': b.conta['id'], 'dono': 'bia', 'herois': ['curandeiro']}}
        for velha in (dict(corpo_grupo, versaoRegras=v + 1), dict(corpo_grupo, versaoRegras=None)):
            status, r = a.pede('POST', '/api/grupo/abrir', velha)
            self.assertEqual((status, r.get('motivo'), r.get('regras')), (409, 'regras-velhas', v), r)
            self.assertIn('recarregue', r.get('erro', ''), r)
        self.assertEqual(a.pede('POST', '/api/grupo/abrir', dict(corpo_grupo, versaoRegras='x'))[0], 400)
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM salas_grupo WHERE lider_id = ?", a.conta['id'])[0]['n'], 0, 'nada abriu')
        status, r = a.pede('POST', '/api/grupo/abrir', corpo_grupo)             # a página nova: o Cliente manda o número
        self.assertEqual(status, 200, r)
        self.fecha_lutas(a)
        self.fecha_lutas(b)
        did = 'duelo-abertura-%d' % a.conta['id']
        for velha in ({'did': did, 'herois': ['sumo'], 'versaoRegras': v + 1}, {'did': did, 'herois': ['sumo'], 'versaoRegras': None}):
            status, r = a.pede('POST', '/api/duelo/abrir', velha)
            self.assertEqual((status, r.get('motivo'), r.get('regras')), (409, 'regras-velhas', v), r)
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM duelo_vida WHERE did = ?", did)[0]['n'], 0, 'o duelo não abriu')
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM duelos_regras WHERE did = ?", did)[0]['n'], 0)
        status, r = a.pede('POST', '/api/duelo/abrir', {'did': did, 'herois': ['sumo']})
        self.assertEqual(status, 200, r)
        self.assertEqual(self.sql("SELECT regras FROM duelos_regras WHERE did = ?", did)[0]['regras'], v)
        # a guerra: os quatro na partida casada; o quarto com a página velha não confirma e a partida NÃO fica pronta
        js = self.guerra_casada('Confirma')
        for c in js[:3]:
            self.assertEqual(c.pede('POST', '/api/guerra/confirmar', {})[0], 200)
        for velha in ({'versaoRegras': v + 1}, {'versaoRegras': None}):
            status, r = js[3].pede('POST', '/api/guerra/confirmar', velha)
            self.assertEqual((status, r.get('motivo'), r.get('regras')), (409, 'regras-velhas', v), r)
        status, e = js[3].pede('GET', '/api/guerra/estado')
        self.assertEqual((status, e.get('fase')), (200, 'casada'), e)
        self.assertEqual(self.sql("SELECT COUNT(*) AS n FROM guerra_partidas WHERE estado = 'pronta' AND gid IN "
                                  "(SELECT gid FROM guerra_jogadores WHERE conta_id = ?)", js[3].conta['id'])[0]['n'], 0)
        # recarregou: a página nova confirma, a partida fica pronta e a ata leva o número que o /guerra/ata devolveu
        self.assertEqual(js[3].pede('POST', '/api/guerra/confirmar', {})[0], 200)
        for _ in range(30):
            status, e = js[3].pede('GET', '/api/guerra/estado')
            if e.get('ata'):
                break
            time.sleep(0.2)
        self.assertEqual(e.get('fase'), 'pronta', e)
        self.assertEqual((e.get('ata') or {}).get('regras'), v, e.get('ata'))


# só as provas daqui rodam: as da autoridade seguem em tests/autoridade_api.py
for _nome in [n for n in dir(A.ProvaDaAutoridade) if n.startswith('test_')]:
    setattr(ProvaDasRegras, _nome, None)


if __name__ == '__main__':
    unittest.main(verbosity=2)
