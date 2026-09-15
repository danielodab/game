#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova da PRESENÇA que o Relé conta (15/09): a queda e a volta de uma conta identificada.

    python tests/rele_presenca_prova.py

O dono (15/09): "arrume as falhas conhecidas". O W.O. do duelo não custava nada a quem sumia: quem fecha a aba
não declara nada ao servidor. Quem vê a conexão cair é o relé, que já sabe a conta de cada conexão pela sessão
(servidor/rele_ident.py); ele anota no banco da API (servidor/presenca.py, tabela rele_presenca) 'caiu' quando a
última conexão identificada da conta fecha e 'voltou' quando a conta ganha a primeira de novo, e a API confirma o
W.O. por ali (servidor/grupo.py, duelo_fechar).

Primeiro as provas PURAS de servidor/presenca.py (o veredito da queda e a anotação, num banco descartável); depois
AO VIVO: o relé de verdade num subprocesso com --banco, contra um banco criado pela Api do cartório — a identidade
conferida grava 'voltou'; a segunda aba da mesma conta não grava nada; fechar uma das duas não é queda; fechar a
última grava 'caiu'; a volta grava 'voltou'; a conexão sem conta não grava nada; e a API lê a prova no mesmo banco.
O relé roda com prioridade abaixo do normal (a máquina é dividida).
"""
import os
import shutil
import sqlite3
import sys
import tempfile
import time

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

AQUI = os.path.dirname(os.path.abspath(__file__))
SERVIDOR = os.path.normpath(os.path.join(AQUI, '..', 'servidor'))
sys.dont_write_bytecode = True            # sem .pyc em servidor/
sys.path.insert(0, SERVIDOR)
sys.path.insert(0, AQUI)
import api as cartorio  # noqa: E402  (o banco nasce pela Api de verdade)
import presenca  # noqa: E402
from rele_prova import manda, recebe  # noqa: E402
from rele_nomes_prova import Rele  # noqa: E402  (o relé de verdade num subprocesso de prioridade baixa)

RESULTADOS = []


def check(nome, ok, extra=''):
    RESULTADOS.append(bool(ok))
    print(('PASSOU · ' if ok else 'FALHOU · ') + nome + ((' — ' + extra) if extra else ''))


# ------------------------------------------------------------------ as provas puras
def prova_do_modulo():
    P = 'presença (puro): '
    con = sqlite3.connect(':memory:')
    con.executescript(presenca.ESQUEMA_PRESENCA)
    agora = 10 ** 12

    def poe(conta, evento, em):
        con.execute("INSERT INTO rele_presenca(conta_id, evento, em_ms) VALUES (?, ?, ?)", (conta, evento, em))

    check(P + 'sem queda anotada: nada', presenca.prova_de_queda(con, 1, agora - 600000, agora) == ('nada', None))
    poe(1, 'caiu', agora - 900000)
    check(P + 'a queda de ANTES de o duelo abrir não conta', presenca.prova_de_queda(con, 1, agora - 600000, agora)[0] == 'nada')
    poe(1, 'caiu', agora - 90000)
    check(P + 'caiu há 90 s e não voltou: provada (com o instante da queda)',
          presenca.prova_de_queda(con, 1, agora - 600000, agora) == ('provada', agora - 90000))
    poe(2, 'caiu', agora - 90000)
    poe(2, 'voltou', agora - 40000)
    check(P + 'caiu e voltou em 50 s: sem prova', presenca.prova_de_queda(con, 2, agora - 600000, agora) == ('sem', None))
    poe(2, 'caiu', agora - 20000)
    check(P + 'voltou e caiu de novo há 20 s: cedo, até a janela de 60 s passar',
          presenca.prova_de_queda(con, 2, agora - 600000, agora) == ('cedo', agora + 40000))
    check(P + 'a mesma queda, 41 s depois: provada', presenca.prova_de_queda(con, 2, agora - 600000, agora + 41000)[0] == 'provada')
    poe(3, 'caiu', agora - 200000)
    poe(3, 'voltou', agora - 139000)                  # voltou 61 s depois: tarde demais
    check(P + 'a volta depois dos 60 s não desfaz a queda', presenca.prova_de_queda(con, 3, agora - 600000, agora)[0] == 'provada')
    check(P + 'o banco sem a tabela responde nada (a API de antes)',
          presenca.prova_de_queda(sqlite3.connect(':memory:'), 1, 0, agora) == ('nada', None))
    con.close()

    pasta = tempfile.mkdtemp(prefix='presenca-pura-')
    try:
        ausente = os.path.join(pasta, 'nao-existe.db')
        check(P + 'anota: banco ausente não grava e não cria o arquivo',
              presenca.anota(ausente, 7, 'caiu') is False and not os.path.exists(ausente))
        banco = os.path.join(pasta, 'soterra.db')
        sqlite3.connect(banco).close()                # o arquivo existe, a tabela ainda não (o relé chegou antes da API)
        check(P + 'anota: cria a tabela que falta e grava', presenca.anota(banco, 7, 'caiu', 1000) is True)
        check(P + 'anota: evento torto, conta torta: não grava',
              presenca.anota(banco, 7, 'sumiu') is False and presenca.anota(banco, True, 'caiu') is False
              and presenca.anota(banco, '7', 'caiu') is False)
        b = sqlite3.connect(banco)
        agora_ms = int(time.time() * 1000)
        b.execute("INSERT INTO rele_presenca(conta_id, evento, em_ms) VALUES (8, 'voltou', ?)", (agora_ms - 25 * 3600 * 1000,))
        b.commit()
        b.close()
        presenca._faxina['em'] = 0
        presenca.anota(banco, 8, 'caiu')
        b = sqlite3.connect(banco)
        linhas = b.execute("SELECT conta_id, evento FROM rele_presenca ORDER BY rowid").fetchall()
        b.close()
        check(P + 'a faxina tira as linhas de mais de 24 h (e guarda as de agora)', linhas == [(8, 'caiu')], repr(linhas))
    finally:
        shutil.rmtree(pasta, ignore_errors=True)


# ------------------------------------------------------------------ ao vivo
def cria_banco(pasta):
    caminho = os.path.join(pasta, 'soterra.db')
    a = cartorio.Api(caminho)
    contas = {}
    for i, (rotulo, nome) in enumerate((('ana', 'Presenca Ana'), ('bia', 'Presenca Bia'))):
        st, r = a.cadastro(None, {'nome': nome, 'email': 'presenca-%s-%d@prova.test' % (rotulo, i),
                                  'senha': 'senha-de-prova-%d' % i})
        assert st == 201, (st, r)
        contas[rotulo] = (r['conta']['id'], r['token'])
    return a, caminho, contas


def eventos(banco, conta):
    b = sqlite3.connect(banco)
    try:
        return [r[0] for r in b.execute("SELECT evento FROM rele_presenca WHERE conta_id = ? ORDER BY em_ms, rowid", (conta,))]
    except sqlite3.Error:
        return []
    finally:
        b.close()


def espera_eventos(banco, conta, n, prazo=6.0):
    fim = time.time() + prazo
    while time.time() < fim:
        ev = eventos(banco, conta)
        if len(ev) >= n:
            return ev
        time.sleep(0.1)
    return eventos(banco, conta)


def identifica(rl, de, token):
    ws, _ = rl.liga('presencaprova' + de)
    manda(ws, t='ident', de=de, token=token)
    return ws, recebe(ws, 4)


def prova_ao_vivo():
    R = 'relé: '
    pasta = tempfile.mkdtemp(prefix='rele-presenca-')
    a = rl = None
    try:
        a, banco, contas = cria_banco(pasta)
        ana, bia = contas['ana'], contas['bia']
        check(R + 'a API cria a tabela da presença (servidor/presenca.py)', eventos(banco, ana[0]) == [])
        rl = Rele(['--banco', banco])
        if not rl.ok:
            check(R + 'o relé com --banco subiu', False, rl.log()[-300:])
            return
        ws1, resp = identifica(rl, 'hana01', ana[1])
        check(R + 'a conta se identifica', resp == '{"t":"ident-ok","mestre":false}', repr(resp))
        ev = espera_eventos(banco, ana[0], 1)
        check(R + 'a primeira conexão identificada da conta grava "voltou"', ev == ['voltou'], repr(ev))
        ws2, resp2 = identifica(rl, 'hana01', ana[1])
        time.sleep(0.8)
        check(R + 'a segunda aba da mesma conta não grava nada', resp2 is not None and eventos(banco, ana[0]) == ['voltou'],
              repr(eventos(banco, ana[0])))
        ws1.close()
        time.sleep(0.8)
        check(R + 'fechar uma das duas abas não é queda (a conta segue na praça)', eventos(banco, ana[0]) == ['voltou'],
              repr(eventos(banco, ana[0])))
        t_caiu = int(time.time() * 1000)
        ws2.close()
        ev = espera_eventos(banco, ana[0], 2)
        check(R + 'fechar a ÚLTIMA conexão identificada grava "caiu"', ev == ['voltou', 'caiu'], repr(ev))
        con = sqlite3.connect(banco)
        veredito = presenca.prova_de_queda(con, ana[0], t_caiu - 5000, int(time.time() * 1000))
        con.close()
        check(R + 'a API lê a queda no mesmo banco: ainda cedo (a janela de 60 s está aberta)', veredito[0] == 'cedo', repr(veredito))
        ws3, _ = identifica(rl, 'hana01', ana[1])
        ev = espera_eventos(banco, ana[0], 3)
        check(R + 'a volta grava "voltou" de novo', ev == ['voltou', 'caiu', 'voltou'], repr(ev))
        con = sqlite3.connect(banco)
        veredito = presenca.prova_de_queda(con, ana[0], t_caiu - 5000, int(time.time() * 1000) + 120000)
        con.close()
        check(R + 'e com a volta dentro dos 60 s a queda não prova W.O.', veredito == ('sem', None), repr(veredito))
        anon, _ = rl.liga('presencaprovaanon')
        manda(anon, t='pulso', de='hanon01', x=0, z=0, sala=None, luta=False)
        time.sleep(0.3)
        anon.close()
        ws_b, _ = identifica(rl, 'hbia01', bia[1])
        ws_b.close()
        ev_b = espera_eventos(banco, bia[0], 2)
        time.sleep(0.5)
        b = sqlite3.connect(banco)
        todas = b.execute("SELECT COUNT(*) FROM rele_presenca").fetchone()[0]
        b.close()
        check(R + 'a conexão sem conta não grava nada; cada conta grava só as dela',
              ev_b == ['voltou', 'caiu'] and todas == 5, repr((ev_b, todas)))
        ws3.close()
        ev = espera_eventos(banco, ana[0], 4)
        check(R + 'a queda de novo', ev[-1:] == ['caiu'], repr(ev))
    finally:
        if rl is not None:
            log = rl.fecha()
            check(R + 'nenhum aviso de presença não anotada no log do relé', 'não foi anotada' not in log, log[-400:])
        if a is not None:
            try:
                a.con.close()
            except Exception:
                pass
        shutil.rmtree(pasta, ignore_errors=True)


if __name__ == '__main__':
    prova_do_modulo()
    prova_ao_vivo()
    falhas = RESULTADOS.count(False)
    print('RESUMO: ' + ('tudo passou (%d)' % len(RESULTADOS) if not falhas else 'FALHOU — %d de %d' % (falhas, len(RESULTADOS))))
    sys.exit(1 if falhas else 0)
