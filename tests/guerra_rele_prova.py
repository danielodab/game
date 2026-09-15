#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A guerra de guilda 2×2 pelo RELÉ DE VERDADE: quatro clientes crus e um intruso (15/09).

    python tests/guerra_rele_prova.py

O dono: "a guerra de guild que é 2x2 de cada guild é na sede de guild". A batalha dos quatro não pediu mudança no
relé (servidor/rele.py): o lockstep manda cada lance, `vivo`, `ia`, `sai`, `foto` pelo dirigido `batalha` a cada um
dos TRÊS outros, um envelope por destino, com `para` (e `paraCx` quando já conhece a conexão). Esta prova sobe o
relé de verdade numa porta livre (prioridade baixa) e confere, com o formato que o js/core/coop.js usa:
  - cada envelope da Ana chega UMA vez a cada um dos três, com o cx dela carimbado, e o intruso Caio não ouve nada;
  - a fatia do tamanho que o R.dirige manda (5,9 KB, abaixo dos 6.000 bytes) chega aos três;
  - a cadência de uma guerra (40 lances × 3 destinos em 4 s, mais o `vivo`) passa inteira pelos baldes;
  - o `vigia` dos três na Ana: quando a conexão dela cai, os três ouvem `caiu` com o cx dela em menos de 2 s;
  - com ela fora, o dirigido a ela não chega a ninguém e quem mandou ouve `ausente`;
  - o balde geral do relé (20 envelopes/s por conexão, rajada de 40) com três destinos por lance: a rajada de um turno
    inteiro passa, e a cadência de gente também (acima de ~6 lances/s sustentados o relé descarta, e o `pede` do
    lockstep recupera o buraco);
  - ela volta com OUTRA conexão: o envelope com o `paraCx` velho não chega (voz `ausente`); sem `paraCx`, chega — por
    isso quem espera aceita o cx novo de quem estava dado por caído (Coop, aceitaGuerra).
A batalha em si (o hash nos quatro motores, quem marca quem caiu, a foto de quem manda, o W.O. do lado) é provada no
tests/guerra_motor.html, com quatro clientes do jogo de verdade num correio de mentira.
"""
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
RELE = os.path.join(RAIZ, 'servidor', 'rele.py')
BAIXA = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)
HEX8 = re.compile(r'^[0-9a-f]{8}$')

try:
    from websockets.sync.client import connect
except ImportError:                                    # pragma: no cover
    print('precisa do websockets 13+ (o cliente síncrono)')
    sys.exit(2)

TOTAL, FALHAS = [0], [0]


def check(nome, ok, extra=''):
    TOTAL[0] += 1
    if not ok:
        FALHAS[0] += 1
    print(('PASSOU' if ok else 'FALHOU') + ' · ' + nome + ('' if ok or not extra else ' — ' + str(extra)[:300]))


def porta_livre():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def espera_porta(porta, segundos=10):
    fim = time.time() + segundos
    while time.time() < fim:
        try:
            socket.create_connection(('127.0.0.1', porta), timeout=0.5).close()
            return True
        except OSError:
            time.sleep(0.1)
    return False


def recebe(ws, segundos):
    try:
        return ws.recv(timeout=segundos)
    except Exception:
        return None


def junta(ws, espera=0.3):
    fora = []
    while True:
        s = recebe(ws, espera)
        if s is None:
            return fora
        try:
            fora.append(json.loads(s))
        except Exception:
            fora.append(s)


def de(lista, t, quem, acao=None):
    return [m for m in lista if isinstance(m, dict) and m.get('t') == t and m.get('de') == quem
            and (acao is None or m.get('acao') == acao)]


def voz(lista, t):
    return [m for m in lista if isinstance(m, dict) and m.get('t') == t and 'de' not in m]


def manda(ws, **campos):
    ws.send(json.dumps(campos, ensure_ascii=False, separators=(',', ':')))


def main():
    porta = porta_livre()
    registro = tempfile.TemporaryFile()
    proc = subprocess.Popen([sys.executable, RELE, '--porta', str(porta), '--relatorio', '0'],
                            stdout=subprocess.DEVNULL, stderr=registro, creationflags=BAIXA)
    url = 'ws://127.0.0.1:%d' % porta
    abertos = []

    def liga(marca):
        ws = connect(url + '/ws?n=' + marca, max_queue=None)
        abertos.append(ws)
        s = recebe(ws, 3)
        try:
            an = json.loads(s) if s else {}
        except Exception:
            an = {}
        return ws, an.get('cx')

    try:
        check('o relé subiu', espera_porta(porta))
        ws, cx = {}, {}
        for id_ in ('ana', 'bia', 'cris', 'duda', 'caio'):
            ws[id_], cx[id_] = liga('marca%s000001' % id_)
            manda(ws[id_], t='oi', de=id_, nome=id_.capitalize(), classe='sumo', x=0, z=0, sala=None, v=2)
        time.sleep(0.5)
        for w in ws.values():
            junta(w, 0.2)
        check('cinco conexões, cada uma com o seu cx', all(isinstance(v, str) and HEX8.match(v) for v in cx.values())
              and len(set(cx.values())) == 5, repr(cx))
        gid = 'guerra-00000000000000000abc'
        outros = ('bia', 'cris', 'duda')

        # 1. um lance da Ana aos três
        for p in outros:
            manda(ws['ana'], t='batalha', de='ana', para=p, acao='lance',
                  dados={'b': gid, 'T': 3, 'k': 0, 'a': 'm', 'u': 'u1', 'x': 4, 'y': 5, 'ok': True})
        rs = {p: junta(ws[p], 0.5) for p in outros}
        rc = junta(ws['caio'], 0.3)
        check('o lance da Ana chega UMA vez a cada um dos três, com o cx dela carimbado; o intruso não ouve nada',
              all(len(de(rs[p], 'batalha', 'ana', 'lance')) == 1 and de(rs[p], 'batalha', 'ana')[0].get('cx') == cx['ana']
                  and de(rs[p], 'batalha', 'ana')[0].get('dados', {}).get('T') == 3 for p in outros) and not rc,
              repr({p: len(rs[p]) for p in outros}) + ' caio=' + repr(rc)[:80])

        # 2. a fatia do tamanho do R.dirige
        pedaco = 'x' * 5600
        for p in outros:
            manda(ws['ana'], t='batalha', de='ana', para=p, paraCx=cx[p], acao='parte',
                  dados={'ref': 'f1', 'i': 0, 'n': 3, 'a': 'foto', 's': pedaco})
        rs = {p: junta(ws[p], 0.6) for p in outros}
        tam = len(json.dumps({'t': 'batalha', 'de': 'ana', 'para': 'bia', 'paraCx': cx['bia'], 'acao': 'parte',
                              'dados': {'ref': 'f1', 'i': 0, 'n': 3, 'a': 'foto', 's': pedaco}}).encode('utf-8'))
        check('a fatia de %d bytes (abaixo dos 6.000 do R.dirige) chega aos três pelo paraCx de cada um' % tam,
              tam < 6000 and all(len(de(rs[p], 'batalha', 'ana', 'parte')) == 1 for p in outros) and not junta(ws['caio'], 0.2),
              repr({p: len(rs[p]) for p in outros}))

        # 3. a cadência de uma guerra. O balde geral do relé é de 20 envelopes/s por conexão (rajada de 40): com três
        # destinos por lance, um jogador sustenta ~6 lances/s — gente num turno faz bem menos. Primeiro a RAJADA de um
        # turno inteiro de uma vez (12 lances × 3 = 36 envelopes), depois 40 lances a 5 por segundo com o vivo
        time.sleep(2.2)                                  # o balde da Ana se enche de novo (as provas de cima gastaram)
        for i in range(12):
            for p in outros:
                manda(ws['ana'], t='batalha', de='ana', para=p, paraCx=cx[p], acao='lance',
                      dados={'b': gid, 'T': 9, 'k': i, 'a': 'm', 'u': 'u1', 'x': i, 'y': 2, 'ok': True})
        rs = {p: junta(ws[p], 0.8) for p in outros}
        check('a rajada de um turno inteiro (12 lances × 3 destinos de uma vez) passa inteira',
              all(len(de(rs[p], 'batalha', 'ana', 'lance')) == 12 for p in outros),
              repr({p: len(de(rs[p], 'batalha', 'ana', 'lance')) for p in outros}))
        time.sleep(2.2)
        t0 = time.time()
        for i in range(40):
            for p in outros:
                manda(ws['ana'], t='batalha', de='ana', para=p, paraCx=cx[p], acao='lance',
                      dados={'b': gid, 'T': 10 + i // 4, 'k': i % 4, 'a': 'c', 'u': 'u1', 's': 'golpe', 'x': 1, 'y': 2, 'ok': True})
            if i % 8 == 0:
                for p in outros:
                    manda(ws['ana'], t='batalha', de='ana', para=p, paraCx=cx[p], acao='vivo', dados={'b': gid, 'T': 10 + i // 4})
            time.sleep(0.2)
        rs = {p: junta(ws[p], 0.8) for p in outros}
        n = {p: len(de(rs[p], 'batalha', 'ana', 'lance')) for p in outros}
        check('a cadência de uma guerra (40 lances × 3 destinos em %.1f s, mais o vivo) passa inteira pelos baldes' % (time.time() - t0),
              all(v == 40 for v in n.values()) and all(len(de(rs[p], 'batalha', 'ana', 'vivo')) == 5 for p in outros), repr(n))
        # os três também falam entre si ao mesmo tempo (a Duda manda aos outros três, a Ana inclusive)
        for p in ('ana', 'bia', 'cris'):
            manda(ws['duda'], t='batalha', de='duda', para=p, acao='dentro', dados={'bid': gid, 'viu': False})
        rs2 = {p: junta(ws[p], 0.5) for p in ('ana', 'bia', 'cris')}
        check('quem é do outro lado manda aos três do mesmo jeito (o `dentro` da Duda)',
              all(len(de(rs2[p], 'batalha', 'duda', 'dentro')) == 1 for p in rs2))

        # 4. o vigia dos três na Ana e a queda dela
        for p in outros:
            manda(ws[p], t='vigia', de=p, para='ana')
        time.sleep(0.4)
        for p in outros:
            junta(ws[p], 0.1)
        t0 = time.time()
        ws['ana'].close()
        caiu = {}
        fim = time.time() + 2.5
        while time.time() < fim and len(caiu) < 3:
            for p in outros:
                if p in caiu:
                    continue
                for m in voz(junta(ws[p], 0.05), 'caiu'):
                    if m.get('id') == 'ana':
                        caiu[p] = (m.get('cx'), time.time() - t0)
        check('a Ana cai: os três que a vigiam ouvem `caiu` com o cx dela em menos de 2 s',
              len(caiu) == 3 and all(c[0] == cx['ana'] and c[1] < 2.0 for c in caiu.values()), repr(caiu))

        # 5. com ela fora: ausente
        manda(ws['bia'], t='batalha', de='bia', para='ana', acao='pede', dados={'b': gid, 'T': 20, 'k': 0})
        vb = voz(junta(ws['bia'], 0.6), 'ausente')
        check('o dirigido a quem caiu não chega a ninguém e quem mandou ouve `ausente` (com a batalha na ref)',
              len(vb) == 1 and vb[0].get('para') == 'ana' and vb[0].get('tipo') == 'batalha' and vb[0].get('acao') == 'pede'
              and not junta(ws['caio'], 0.2) and not de(junta(ws['cris'], 0.2), 'batalha', 'bia'), repr(vb))

        # 6. a volta com outra conexão
        ws['ana'], cx_novo = liga('marcaana000002')
        manda(ws['ana'], t='oi', de='ana', nome='Ana', classe='sumo', x=0, z=0, sala=None, v=2)
        time.sleep(0.4)
        for w in ws.values():
            junta(w, 0.1)
        manda(ws['cris'], t='batalha', de='cris', para='ana', paraCx=cx['ana'], acao='lance',
              dados={'b': gid, 'T': 21, 'k': 0, 'a': 'e', 'ok': True})
        ra, vc = junta(ws['ana'], 0.5), voz(junta(ws['cris'], 0.4), 'ausente')
        check('a Ana volta com OUTRA conexão: o envelope com o paraCx velho não chega, e quem mandou ouve `ausente`',
              cx_novo and cx_novo != cx['ana'] and not de(ra, 'batalha', 'cris') and len(vc) == 1, repr((ra, vc))[:200])
        manda(ws['ana'], t='batalha', de='ana', para='cris', acao='pede', dados={'b': gid, 'T': 21, 'k': 0})
        rc2 = de(junta(ws['cris'], 0.5), 'batalha', 'ana', 'pede')
        check('o que ela manda da conexão nova chega com o cx NOVO carimbado (é por ele que quem a dava por caída a aceita)',
              len(rc2) == 1 and rc2[0].get('cx') == cx_novo, repr(rc2))
        manda(ws['cris'], t='batalha', de='cris', para='ana', acao='lance', dados={'b': gid, 'T': 21, 'k': 0, 'a': 'e', 'ok': True})
        check('sem paraCx (ou com o cx novo), o lance do Cris chega a ela', len(de(junta(ws['ana'], 0.5), 'batalha', 'cris', 'lance')) == 1)
        check('o intruso não ouviu nada dirigido em toda a prova', not [m for m in junta(ws['caio'], 0.3)
                                                                         if isinstance(m, dict) and m.get('t') == 'batalha'])
    finally:
        for w in abertos:
            try:
                w.close()
            except Exception:
                pass
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        registro.flush()
        registro.seek(0)
        log = registro.read().decode('utf-8', 'replace')
        registro.close()
        check('o relé não teve exceção no log', 'Traceback' not in log, log[-400:])
    print('FALHOU — %d de %d' % (FALHAS[0], TOTAL[0]) if FALHAS[0] else 'tudo passou (%d)' % TOTAL[0])
    return 1 if FALHAS[0] else 0


if __name__ == '__main__':
    sys.exit(main())
