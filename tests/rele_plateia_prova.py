#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prova da PLATEIA (08/10 à noite): o que o mundo fica sabendo — api.py `_plateia` grava, o relé
(servidor/rele.py, `vigia_plateia`) lê o que é novo e anuncia a TODAS as conexões com {t:'plateia'}.

    python tests/rele_plateia_prova.py

Puras (a Api de verdade num banco descartável): `_plateia` grava com o nome da conta (ou o do jogo, dos
resumos), e cala o nome reservado à equipe. AO VIVO: o relé de verdade num subprocesso com --banco; o que
foi gravado ANTES de ele subir não sai; o que a API grava depois chega a todos em poucos segundos, com o
nome, o tipo e os dados; a linha calada não chega a ninguém.
"""
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
SERVIDOR = os.path.join(os.path.dirname(AQUI), 'servidor')
sys.dont_write_bytecode = True
sys.path.insert(0, SERVIDOR)
sys.path.insert(0, AQUI)
import api as cartorio  # noqa: E402
import privacidade  # noqa: E402
from rele_prova import recebe  # noqa: E402
from rele_nomes_prova import Rele  # noqa: E402

RESULTADOS = []


def check(nome, ok, extra=''):
    RESULTADOS.append(bool(ok))
    print(('PASSOU · ' if ok else 'FALHOU · ') + nome + ((' — ' + extra) if extra else ''))


def cria_banco(pasta):
    caminho = os.path.join(pasta, 'soterra.db')
    a = cartorio.Api(caminho)
    contas = {}
    for i, (rotulo, nome) in enumerate((('ana', 'Plateia Ana'), ('bia', 'Plateia Bia'))):
        st, r = a.cadastro(None, {'nome': nome, 'email': 'plateia-%s-%d@prova.test' % (rotulo, i),
                                  'senha': 'senha-de-prova-%d' % i, 'aceiteTermos': privacidade.VERSAO_TERMOS})
        assert st == 201, (st, r)
        contas[rotulo] = r['conta']['id']
    return a, caminho, contas


def linhas(banco):
    b = sqlite3.connect(banco)
    try:
        return b.execute("SELECT conta_id, nome, tipo, dados FROM plateia ORDER BY id").fetchall()
    finally:
        b.close()


def grava(a, cid, tipo, dados):
    with a._escrita():
        return a._plateia(cid, tipo, dados)


def main():
    P, R = 'plateia (puro): ', 'relé: '
    pasta = tempfile.mkdtemp(prefix='rele-plateia-')
    a = rl = None
    try:
        a, banco, contas = cria_banco(pasta)
        ana, bia = contas['ana'], contas['bia']
        check(P + 'a API cria a tabela da plateia vazia', linhas(banco) == [])
        check(P + '_plateia grava com o nome da conta', grava(a, ana, 'coroa', {'nivel': 3}) is True and
              linhas(banco) == [(ana, 'Plateia Ana', 'coroa', '{"nivel": 3}')], repr(linhas(banco)))
        with a._escrita():
            a.con.execute("UPDATE contas SET nome = 'Admin' WHERE id = ?", (bia,))
        check(P + 'nome reservado à equipe não sai (grava False, nada na tabela)',
              grava(a, bia, 'drop', {'itemId': 'x'}) is False and len(linhas(banco)) == 1)

        # ---------------------------------------------------------------- ao vivo
        rl = Rele(['--banco', banco])
        if not rl.ok:
            check(R + 'o relé com --banco subiu', False, rl.log()[-300:])
            return
        ws1, _ = rl.liga('plateia1')
        ws2, _ = rl.liga('plateia2')
        time.sleep(4.0)                               # a primeira olhada do relé: começa do fim
        check(R + 'o que já estava na tabela antes de o relé subir não se anuncia', recebe(ws1, 0.5) is None)
        grava(a, ana, 'drop', {'itemId': 'gh-widow-shears', 'raridade': 'epico', 'dungeon': 'greenhouse'})
        m1, m2 = recebe(ws1, 9), recebe(ws2, 9)
        try:
            j1 = json.loads(m1) if m1 else None
        except ValueError:
            j1 = None
        check(R + 'o que a API grava depois chega a TODAS as conexões (o mesmo texto)', m1 is not None and m1 == m2, '%r %r' % (m1, m2))
        check(R + 'com o nome, o tipo e os dados', j1 is not None and j1.get('t') == 'plateia' and j1.get('nome') == 'Plateia Ana'
              and j1.get('tipo') == 'drop' and (j1.get('dados') or {}).get('itemId') == 'gh-widow-shears'
              and 'conta' not in j1, repr(j1))
        grava(a, ana, 'gema', {'itemId': 'gh-widow-shears', 'extra': 'pa'})
        grava(a, ana, 'coroa', {'nivel': 5})
        m3, m4 = recebe(ws2, 9), recebe(ws2, 9)
        recebe(ws1, 3); recebe(ws1, 3)                 # a outra conexão também as ouviu: esvazia
        check(R + 'duas de uma vez chegam na ordem', m3 is not None and m4 is not None and '"tipo":"gema"' in m3 and '"tipo":"coroa"' in m4,
              '%r %r' % (m3, m4))
        check(R + 'a linha calada (nome reservado) não chega a ninguém', grava(a, bia, 'coroa', {'nivel': 2}) is False and
              recebe(ws1, 4.5) is None)
    finally:
        if rl is not None:
            log = rl.fecha()
            check(R + 'nenhum erro no log do relé', 'Traceback' not in log, log[-400:])
        if a is not None:
            try:
                a.con.close()
            except Exception:
                pass
        shutil.rmtree(pasta, ignore_errors=True)


if __name__ == '__main__':
    main()
    falhas = RESULTADOS.count(False)
    print('RESUMO: ' + ('tudo passou (%d)' % len(RESULTADOS) if not falhas else 'FALHOU — %d de %d' % (falhas, len(RESULTADOS))))
    sys.exit(1 if falhas else 0)
