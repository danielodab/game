#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova do Relé (servidor/rele.py).

    python tests/rele_prova.py

Sobe o relé DE VERDADE numa porta livre e conecta três clientes: a mensagem
de um chega aos outros dois e não volta para quem mandou; envelope acima de
8 KB não passa; quem sai não trava ninguém. Roda duas vezes — com o
`broadcast` do websockets e com o de casa (`--broadcast-caseiro`, o caminho
que o Ubuntu 22.04 usa: a 9.1 de lá não tem `broadcast`).

Precisa do websockets com cliente síncrono (12+) na máquina de testes.
"""
import os
import socket
import subprocess
import sys
import time

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

from websockets.sync.client import connect

AQUI = os.path.dirname(os.path.abspath(__file__))
RELE = os.path.join(AQUI, '..', 'servidor', 'rele.py')
RESULTADOS = []


def check(nome, ok, extra=''):
    RESULTADOS.append(bool(ok))
    print(('PASSOU · ' if ok else 'FALHOU · ') + nome + ((' — ' + extra) if extra else ''))


def porta_livre():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    porta = s.getsockname()[1]
    s.close()
    return porta


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
    except TimeoutError:
        return None
    except Exception:
        return None


def roda(extra, rotulo):
    porta = porta_livre()
    proc = subprocess.Popen([sys.executable, RELE, '--porta', str(porta)] + extra,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    abertos = []
    try:
        if not espera_porta(porta):
            check(rotulo + ': o relé subiu', False, (proc.stderr.read() or b'').decode('utf-8', 'replace')[-400:])
            return
        url = 'ws://127.0.0.1:%d' % porta
        a, b, c = connect(url), connect(url), connect(url)
        abertos += [a, b, c]
        time.sleep(0.4)                                  # o relé registra os três

        a.send('{"t":"oi","de":"a"}')
        rb, rc = recebe(b, 3), recebe(c, 3)
        check(rotulo + ': a mensagem de A chega a B e a C', rb == rc == '{"t":"oi","de":"a"}', '%r %r' % (rb, rc))
        check(rotulo + ': e não volta para quem mandou', recebe(a, 0.6) is None)

        b.send('de-b')
        ra, rc2 = recebe(a, 3), recebe(c, 3)
        check(rotulo + ': B fala, A e C ouvem', ra == rc2 == 'de-b', '%r %r' % (ra, rc2))

        c.close()
        time.sleep(0.3)
        d = connect(url)
        abertos.append(d)
        time.sleep(0.3)
        b.send('depois')
        check(rotulo + ': quem sai não trava ninguém (A e o novo D ouvem)',
              recebe(a, 3) == 'depois' and recebe(d, 3) == 'depois')

        try:
            a.send('x' * (9 * 1024))                     # o relé derruba quem manda (max_size)
        except Exception:
            pass
        check(rotulo + ': envelope acima de 8 KB não é repassado', recebe(b, 0.8) is None and recebe(d, 0.3) is None)
    finally:
        for ws in abertos:
            try:
                ws.close()
            except Exception:
                pass
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == '__main__':
    roda([], 'broadcast do websockets')
    roda(['--broadcast-caseiro'], 'broadcast de casa (caminho da 9.x)')
    falhas = RESULTADOS.count(False)
    print('RESUMO: ' + ('tudo passou (%d)' % len(RESULTADOS) if not falhas else 'FALHOU — %d de %d' % (falhas, len(RESULTADOS))))
    sys.exit(1 if falhas else 0)
