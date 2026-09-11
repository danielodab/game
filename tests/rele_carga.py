#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A carga do Relé: quantos envios por segundo e quanta CPU, antes e depois.

    python tests/rele_carga.py --antes CAMINHO/rele_antigo.py [--tamanhos 50,150,300]

`--antes` é o relé de antes do carteiro que abre o envelope (o que repassava
tudo a todos): `git show df1f8dc:servidor/rele.py > rele_antigo.py`. Sem
`--antes`, o script tira ele mesmo do git para um arquivo temporário.

CURTA E EM PRIORIDADE BAIXA (a máquina tem dono): cada rodada dura menos de
20 s, o relé e os simuladores rodam abaixo do normal, e são no máximo 300
clientes simulados (até 100 por processo). Cada cliente se porta como a Rede
(js/core/rede.js) da sua geração:

  antigo   pulso a cada 2 s sempre, eco sem `para`, oi sem `v`
  novo     pulso só quando andou ou como sinal de vida a cada ~6 s, eco com
           `para`, oi com `v: 2`

Todos andam de vez em quando (alvo em ~15% dos tiques de 2 s), falam pouco
(0,5% dos tiques) e oferecem o deflate, como o navegador. A janela medida é
de 10 s; depois, UM jogador entra na praça cheia e conta-se quantos ecos a
entrada dele custou. Cenários: antes (relé antigo + clientes antigos) e
depois (relé novo + clientes novos) em cada tamanho; no maior, também o relé
novo com clientes antigos em cache (compat) e o relé novo com deflate ligado
(para separar o ganho do roteamento do ganho de não comprimir).

Mede: mensagens que entram por segundo, envios que chegam aos clientes por
segundo e a CPU do processo do relé (% de um núcleo) na janela.
"""
import argparse
import asyncio
import json
import math
import os
import random
import socket
import subprocess
import sys
import tempfile
import time

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

AQUI = os.path.dirname(os.path.abspath(__file__))
RELE_NOVO = os.path.join(AQUI, '..', 'servidor', 'rele.py')
BAIXA = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)
POR_PROCESSO = 100
ESPERA_LIGAR = 4.0       # s para todos ligarem antes do início
AQUECE = 1.5             # s de comportamento antes da janela
JANELA = 10.0            # s medidos
ENTRADA = 2.0            # s de observação da entrada de um jogador
TIQUE = 2.0
P_ANDA, P_FALA = 0.15, 0.005
LADO = 25.0              # a praça simulada: quadrado de ±25 m


# =============================================================== o simulador
async def trabalhador(url, n, modo, semente, t0, primeiro):
    from websockets.asyncio.client import connect
    rnd = random.Random(semente)
    ini_janela, fim_janela = t0 + AQUECE, t0 + AQUECE + JANELA
    t_entra = fim_janela + 0.3
    fim = t_entra + ENTRADA
    rec, st = {}, {'enviadas': 0, 'ecos_entrada': 0, 'erros': 0, 'ligados': 0}
    novo = (modo == 'novo')

    def dentro():
        return ini_janela <= time.time() < fim_janela

    async def envia(ws, obj):
        if dentro():
            st['enviadas'] += 1
        await ws.send(json.dumps(obj, separators=(',', ':')))

    async def ouve(ws, meu):
        try:
            async for msg in ws:
                agora = time.time()
                t = msg[6:msg.find('"', 6)] if msg.startswith('{"t":"') else '?'
                if ini_janela <= agora < fim_janela:
                    rec[t] = rec.get(t, 0) + 1
                elif t_entra <= agora < fim and t == 'eco':
                    st['ecos_entrada'] += 1
                if t == 'oi' and agora >= t_entra - 0.1:          # só a entrada medida pede eco
                    try:
                        m = json.loads(msg)
                    except Exception:
                        continue
                    eco = {'t': 'eco', 'de': meu, 'nome': meu, 'x': 0, 'z': 0, 'sala': None}
                    if novo:
                        eco.update(para=m.get('de'), v=2)
                    await ws.send(json.dumps(eco, separators=(',', ':')))
        except Exception:
            pass

    async def cliente(i):
        meu = 'c%d-%d' % (semente, i)
        x, z = rnd.uniform(-LADO, LADO), rnd.uniform(-LADO, LADO)
        try:
            ws = await connect(url, open_timeout=15, max_size=None)
        except Exception:
            st['erros'] += 1
            return
        st['ligados'] += 1
        oi = {'t': 'oi', 'de': meu, 'nome': meu, 'titulo': '', 'classe': 'sumo',
              'resumo': {'classes': {'sumo': 12, 'bruxo': 7}, 'total': 19}, 'x': x, 'z': z, 'sala': None}
        if novo:
            oi['v'] = 2
        await ws.send(json.dumps(oi, separators=(',', ':')))
        escuta = asyncio.ensure_future(ouve(ws, meu))
        if not novo:
            # o cliente antigo responde todo oi com um eco sem `para`. Aqui é
            # UM eco, depois de todos ligados, que paga as perguntas da
            # chegada: sem ele o relé novo guardaria essas dívidas (30 s) e a
            # entrada medida sairia inflada; responder a cada oi seria N³
            # envios no relé antigo antes mesmo da janela
            await asyncio.sleep(max(0, t0 - 2.0 - time.time()))
            await ws.send(json.dumps({'t': 'eco', 'de': meu, 'nome': meu, 'x': x, 'z': z, 'sala': None},
                                     separators=(',', ':')))
        ult, andou = time.time(), False
        prox = t0 + rnd.uniform(0, TIQUE)
        try:
            while True:
                espera = prox - time.time()
                if espera > 0:
                    await asyncio.sleep(espera)
                agora = time.time()
                if agora >= fim:
                    break
                if rnd.random() < P_ANDA:
                    x = max(-LADO, min(LADO, x + rnd.uniform(-5, 5)))
                    z = max(-LADO, min(LADO, z + rnd.uniform(-5, 5)))
                    await envia(ws, {'t': 'alvo', 'de': meu, 'x': x, 'z': z})
                    andou = True
                if not novo or andou or agora - ult >= TIQUE * 2.5:
                    await envia(ws, {'t': 'pulso', 'de': meu, 'x': x, 'z': z, 'sala': None})
                    ult, andou = agora, False
                if rnd.random() < P_FALA:
                    await envia(ws, {'t': 'chat', 'de': meu, 'nome': meu, 'texto': 'bom dia, praça'})
                prox += TIQUE
        except Exception:
            st['erros'] += 1
        finally:
            escuta.cancel()
            try:
                await ws.close()
            except Exception:
                pass

    async def recem_chegado():
        await asyncio.sleep(max(0, t_entra - time.time()))
        try:
            ws = await connect(url, open_timeout=10, max_size=None)
        except Exception:
            st['erros'] += 1
            return
        oi = {'t': 'oi', 'de': 'recem', 'nome': 'Recém', 'x': 0, 'z': 0, 'sala': None}
        if novo:
            oi['v'] = 2
        await ws.send(json.dumps(oi, separators=(',', ':')))
        escuta = asyncio.ensure_future(ouve(ws, 'recem'))
        await asyncio.sleep(max(0, fim - time.time()))
        escuta.cancel()
        try:
            await ws.close()
        except Exception:
            pass

    tarefas = []
    for i in range(n):                        # liga em fila curta, como gente chegando
        tarefas.append(asyncio.ensure_future(cliente(i)))
        if i % 10 == 9:
            await asyncio.sleep(0.05)
    if primeiro:
        tarefas.append(asyncio.ensure_future(recem_chegado()))
    await asyncio.gather(*tarefas, return_exceptions=True)
    st['recebidas'] = rec
    print(json.dumps(st))


# ============================================================ o orquestrador
def cpu_s(proc):
    """Segundos de CPU (usuário + núcleo) do processo, pelo Win32; None fora do Windows sem psutil."""
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        c, e, k, u = (wintypes.FILETIME() for _ in range(4))
        ok = ctypes.windll.kernel32.GetProcessTimes(wintypes.HANDLE(int(proc._handle)), ctypes.byref(c),
                                                    ctypes.byref(e), ctypes.byref(k), ctypes.byref(u))
        if not ok:
            return None
        f = lambda ft: ((ft.dwHighDateTime << 32) | ft.dwLowDateTime) / 1e7
        return f(k) + f(u)
    try:
        import psutil
        t = psutil.Process(proc.pid).cpu_times()
        return t.user + t.system
    except Exception:
        return None


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


def dorme_ate(t):
    while True:
        falta = t - time.time()
        if falta <= 0:
            return
        time.sleep(min(falta, 0.2))


def rodada(rotulo, rele, extra, modo, n):
    porta = porta_livre()
    log = tempfile.TemporaryFile()          # PIPE sem leitor enche e trava o relé
    proc = subprocess.Popen([sys.executable, rele, '--porta', str(porta)] + extra,
                            stdout=subprocess.DEVNULL, stderr=log, creationflags=BAIXA)
    trab = []
    try:
        if not espera_porta(porta):
            return {'rotulo': rotulo, 'n': n, 'falhou': 'o relé não subiu'}
        t0 = time.time() + ESPERA_LIGAR
        k = max(1, int(math.ceil(n / float(POR_PROCESSO))))
        for j in range(k):
            parte = n // k + (1 if j < n % k else 0)
            trab.append(subprocess.Popen(
                [sys.executable, os.path.abspath(__file__), '--trabalhador', '--url', 'ws://127.0.0.1:%d' % porta,
                 '--n', str(parte), '--modo', modo, '--semente', str(j + 1), '--inicio', repr(t0)] +
                (['--primeiro'] if j == 0 else []),
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=BAIXA, text=True))
        dorme_ate(t0 + AQUECE)
        c0 = cpu_s(proc)
        dorme_ate(t0 + AQUECE + JANELA)
        c1 = cpu_s(proc)
        saidas = []
        for p in trab:
            try:
                out, _ = p.communicate(timeout=20)
                saidas.append(json.loads(out.strip().splitlines()[-1]))
            except Exception as e:
                saidas.append({'erros': 1, 'enviadas': 0, 'ecos_entrada': 0, 'ligados': 0, 'recebidas': {},
                               'falha': str(e)[:120]})
        rec = {}
        for s in saidas:
            for t, v in s.get('recebidas', {}).items():
                rec[t] = rec.get(t, 0) + v
        return {'rotulo': rotulo, 'n': n,
                'ligados': sum(s.get('ligados', 0) for s in saidas),
                'erros': sum(s.get('erros', 0) for s in saidas),
                'entrada_s': sum(s.get('enviadas', 0) for s in saidas) / JANELA,
                'envios_s': sum(rec.values()) / JANELA,
                'por_tipo_s': {t: round(v / JANELA) for t, v in sorted(rec.items())},
                'ecos_entrada': sum(s.get('ecos_entrada', 0) for s in saidas),
                'cpu': (None if c0 is None or c1 is None else 100.0 * (c1 - c0) / JANELA)}
    finally:
        for p in trab:
            if p.poll() is None:
                p.kill()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        log.close()


def rele_antigo_do_git():
    raiz = os.path.join(AQUI, '..')
    txt = subprocess.run(['git', 'show', 'df1f8dc:servidor/rele.py'], cwd=raiz,
                         capture_output=True, check=True).stdout
    caminho = os.path.join(tempfile.mkdtemp(prefix='rele-antes-'), 'rele_antes.py')
    open(caminho, 'wb').write(txt)
    return caminho


def linha(r):
    if 'falhou' in r:
        return '%-16s %4d  FALHOU: %s' % (r['rotulo'], r['n'], r['falhou'])
    cpu = '   ?  ' if r['cpu'] is None else '%5.1f%%' % r['cpu']
    return '%-16s %4d  %4d/%-4d %8.0f %10.0f %8.1f %s %8d' % (
        r['rotulo'], r['n'], r['ligados'], r['n'], r['entrada_s'], r['envios_s'],
        r['envios_s'] / max(1, r['n']), cpu, r['ecos_entrada'])


def main():
    ap = argparse.ArgumentParser(description='A carga do Relé, antes e depois')
    ap.add_argument('--antes', help='o rele.py de antes (git show df1f8dc:servidor/rele.py)')
    ap.add_argument('--tamanhos', default='50,150,300')
    ap.add_argument('--trabalhador', action='store_true', help=argparse.SUPPRESS)
    ap.add_argument('--url'), ap.add_argument('--n', type=int), ap.add_argument('--modo')
    ap.add_argument('--semente', type=int, default=1), ap.add_argument('--inicio', type=float)
    ap.add_argument('--primeiro', action='store_true')
    a = ap.parse_args()
    if a.trabalhador:
        asyncio.run(trabalhador(a.url, a.n, a.modo, a.semente, a.inicio, a.primeiro))
        return 0
    tamanhos = [min(300, int(x)) for x in a.tamanhos.split(',') if x.strip()]
    antes = a.antes or rele_antigo_do_git()
    print('relé de antes: %s' % antes)
    print('%-16s %4s  %-9s %8s %10s %8s %6s %8s' % ('cenário', 'N', 'ligados', 'entra/s', 'envios/s',
                                                  'por jog.', 'CPU', 'ecos/ent'))
    res = []
    for n in tamanhos:
        for rot, rele, extra, modo in [('antes', antes, [], 'antigo'), ('depois', RELE_NOVO, [], 'novo')]:
            r = rodada(rot, rele, extra, modo, n)
            res.append(r)
            print(linha(r), flush=True)
        if n == max(tamanhos):
            for rot, extra, modo in [('compat(antigos)', [], 'antigo'), ('depois+deflate', ['--compressao'], 'novo')]:
                r = rodada(rot, RELE_NOVO, extra, modo, n)
                res.append(r)
                print(linha(r), flush=True)
    print('por tipo (envios/s):')
    for r in res:
        if 'falhou' not in r:
            print('  %-16s %4d  %s' % (r['rotulo'], r['n'], r['por_tipo_s']))
    ok = True
    for n in tamanhos:
        an = next((r for r in res if r['n'] == n and r['rotulo'] == 'antes'), None)
        de = next((r for r in res if r['n'] == n and r['rotulo'] == 'depois'), None)
        if not an or not de or 'falhou' in an or 'falhou' in de:
            ok = False
            continue
        menos_envio = de['envios_s'] < an['envios_s']
        menos_cpu = an['cpu'] is None or de['cpu'] is None or de['cpu'] <= an['cpu'] * 1.1 + 1.0
        todos = de['ligados'] == n and de['erros'] == 0
        print('N=%d: envios/s %.0f -> %.0f (%.1fx), CPU %s -> %s, ecos por entrada %d -> %d%s' % (
            n, an['envios_s'], de['envios_s'], an['envios_s'] / max(1.0, de['envios_s']),
            '?' if an['cpu'] is None else '%.1f%%' % an['cpu'], '?' if de['cpu'] is None else '%.1f%%' % de['cpu'],
            an['ecos_entrada'], de['ecos_entrada'], '' if todos else ' (depois: ligados %d, erros %d)' % (de['ligados'], de['erros'])))
        ok = ok and menos_envio and menos_cpu and todos
    print('RESUMO: ' + ('o relé novo envia menos e gasta menos CPU em todos os tamanhos' if ok else 'FALHOU'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
