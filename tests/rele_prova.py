#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova do Relé (servidor/rele.py).

    python tests/rele_prova.py

Sobe o relé DE VERDADE numa porta livre e conecta clientes crus (o outro
lado do protocolo da Rede, js/core/rede.js). As cinco provas de sempre — a
mensagem de um chega aos outros e não volta; quem sai não trava ninguém;
envelope acima de 8 KB não passa — e as do carteiro que abre o envelope
(10/09): lixo e `de` falso caem; a SALA (a praça é a nula, o cliente antigo
que não manda sala fica na praça, mudar de sala na mesma conexão avisa as
duas); a mensagem DIRIGIDA vai só ao destino; o ECO só a quem perguntou
(com `para` e sem); o TCHAU que o relé manda por quem caiu; o pulso numa
praça cheia (os K=40 mais próximos sempre, os demais 1 em 5 — ou um a cada
3,5 s para o cliente antigo); e os LIMITES por conexão (20/s com rajada,
chat mais baixo, quem abusa cai). Roda duas vezes — com o `broadcast` do
websockets e com o de casa (`--broadcast-caseiro`, o caminho que o Ubuntu
22.04 usa: a 9.1 de lá não tem `broadcast`).

Da revisão da fase C (10/09): o `para` que não acha ninguém cai na difusão
mas PAGA o balde dela (12 de uma vez: passam 4) — e as outras portas do
mesmo quarto também: o `t` que o relé não conhece e a sala trocada a cada
envelope (até pelo eco isento, que nem o leque pagava); o `alvo` numa praça cheia
só chega aos 40 mais próximos, como o pulso; um inteiro JSON gigante não
derruba quem mandou; o chat aguenta uma pessoa digitando (rajada de 10,
1 por segundo). E, antes das rodadas ao vivo, as provas PURAS do módulo
(`prova_do_modulo`): o que depende do relógio — o pulso ralo com piso de
12 s para o cliente parado, o balde do chat — roda com o tempo injetado em
vez de esperar os segundos, e um erro dentro do _processa vira descarte
com rastro no log em vez de desconexão muda.

Desde 10/09 toda conexão ouve primeiro o anúncio do relé ({t:'rele'}); as
provas da identidade (o token, o Mestre, os nomes reservados) moram em
tests/rele_nomes_prova.py.

Da reverificação (a reconexão em laço): cada conexão nasce com todos os
baldes cheios, e o tchau que o relé manda por quem cai sem tchau não pagava
balde nenhum — conectar com um `de` novo, dizer oi e cair, em laço, dava
11.900 entregas/s numa praça de 100, de um cliente sem conta. As provas
puras: o endereço da conexão (o público mais à direita do X-Forwarded-For,
IPv6 pelo /64) e o balde de conexões novas por endereço, com o relógio
injetado; o tchau do relé só por quem se apresentou há 5 s, pago pelo balde
da própria conexão. E ao vivo (`prova_reconexao`, prioridade baixa): o laço
da reverificação vindo de um IP público cai para as ~12 conexões que o
balde do endereço deixa; o de casa (sem limite por IP) entrega o oi, mas
não ganha mais o tchau do relé; e um jogador comum que fica, cai e volta
segue sendo visto e despedido, com o laço rodando ao lado.

Precisa do websockets com cliente síncrono (12+) na máquina de testes; a
prova da reconexão em laço usa o cliente asyncio (13+).
"""
import asyncio
import collections
import io
import json
import logging
import os
import socket
import subprocess
import sys
import tempfile
import time

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

from websockets.sync.client import connect

AQUI = os.path.dirname(os.path.abspath(__file__))
RELE = os.path.join(AQUI, '..', 'servidor', 'rele.py')
RESULTADOS = []
BAIXA = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)     # o dono usa a máquina enquanto a prova roda


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


def constante(nome, padrao):
    """Uma régua do servidor/rele.py — o contrato que as provas ao vivo
    medem; o `padrao` só vale contra um relé de antes do conserto."""
    d = os.path.dirname(os.path.abspath(RELE))
    if d not in sys.path:
        sys.path.insert(0, d)
    try:
        import rele
    except Exception:
        return padrao
    return getattr(rele, nome, padrao)


def recebe(ws, segundos):
    try:
        return ws.recv(timeout=segundos)
    except TimeoutError:
        return None
    except Exception:
        return None


def junta(ws, espera=0.3):
    """Tudo o que chegar até ficar `espera` segundos sem nada (JSON aberto; o resto cru)."""
    fora = []
    while True:
        s = recebe(ws, espera)
        if s is None:
            return fora
        try:
            fora.append(json.loads(s))
        except Exception:
            fora.append(s)


def de(lista, t, quem):
    return [m for m in lista if isinstance(m, dict) and m.get('t') == t and m.get('de') == quem]


def manda(ws, **campos):
    ws.send(json.dumps(campos, ensure_ascii=False))


def roda(extra, rotulo):
    porta = porta_livre()
    # o log do relé vai para um arquivo: num PIPE que ninguém lê, o buffer
    # (uns 4 KB no Windows) enche com as linhas de entrou/saiu e o relé TRAVA
    registro = tempfile.TemporaryFile()
    proc = subprocess.Popen([sys.executable, RELE, '--porta', str(porta)] + extra,
                            stdout=subprocess.DEVNULL, stderr=registro)
    abertos = []
    url = 'ws://127.0.0.1:%d' % porta

    anuncios = []

    def liga():
        ws = connect(url, max_queue=None)
        abertos.append(ws)
        # (10/09) o relé se anuncia a quem conecta, antes de tudo ({t:'rele'},
        # servidor/rele_ident.py): o carteiro começa depois dele
        anuncios.append(recebe(ws, 3))
        return ws

    def fecha_todos():
        for ws in abertos:
            try:
                ws.close()
            except Exception:
                pass
        del abertos[:]

    try:
        if not espera_porta(porta):
            registro.seek(0)
            check(rotulo + ': o relé subiu', False, registro.read().decode('utf-8', 'replace')[-400:])
            return
        R = rotulo + ': '

        # ------------------------------------------------ as cinco de sempre
        a, b, c = liga(), liga(), liga()
        time.sleep(0.4)                                  # o relé registra os três
        oi_a = '{"t":"oi","de":"a"}'
        a.send(oi_a)
        rb, rc = recebe(b, 3), recebe(c, 3)
        check(R + 'a mensagem de A chega a B e a C (o mesmo texto)', rb == rc == oi_a, '%r %r' % (rb, rc))
        check(R + 'e não volta para quem mandou', recebe(a, 0.6) is None)

        fala_b = '{"t":"chat","de":"b","nome":"B","texto":"de-b"}'
        b.send(fala_b)
        ra, rc2 = recebe(a, 3), recebe(c, 3)
        check(R + 'B fala, A e C ouvem', ra == rc2 == fala_b, '%r %r' % (ra, rc2))

        c.close()
        time.sleep(0.3)
        d = liga()
        time.sleep(0.3)
        depois = '{"t":"chat","de":"b","nome":"B","texto":"depois"}'
        b.send(depois)
        check(R + 'quem sai não trava ninguém (A e o novo D ouvem)',
              recebe(a, 3) == depois and recebe(d, 3) == depois)

        try:
            a.send('x' * (9 * 1024))                     # o relé derruba quem manda (max_size)
        except Exception:
            pass
        rb, rd = junta(b, 0.8), junta(d, 0.3)
        grande = [m for m in rb + rd if isinstance(m, str) and len(m) > 8 * 1024]
        check(R + 'envelope acima de 8 KB não é repassado', not grande, '%d grandes' % len(grande))

        # --------------------------------------- o envelope: lixo e `de` falso
        obs = liga()
        manda(obs, t='pulso', de='obs', x=0, z=0, sala=None)
        s1 = liga()
        manda(s1, t='pulso', de='s1', x=3, z=3, sala=None)
        time.sleep(0.3)
        junta(obs, 0.2)
        for lixo in ('lixo', '[1,2]', '{"t":"chat"}', '{"de":"s1"}', '{"t":"chat","de":7}'):
            s1.send(lixo)
        manda(s1, t='chat', de='outro', nome='Falso', texto='sou outro')
        ro = junta(obs, 0.5)
        check(R + 'o que não é envelope (JSON com t e de) cai', not ro, repr(ro)[:200])
        check(R + 'outro `de` na mesma conexão (falsificação) cai', not de(ro, 'chat', 'outro'))

        # (3.3) um inteiro JSON de 400 dígitos passa pelo max_size e estourava
        # o float() do _num: a conexão caía em silêncio (1000, sem log) e o
        # relé ainda despedia por ele. Agora é um número inválido: ignorado
        s1.send('{"t":"pulso","de":"s1","x":%s,"z":0}' % ('9' * 400))
        time.sleep(0.5)
        ro = junta(obs, 0.3)
        try:
            manda(s1, t='chat', de='s1', nome='S1', texto='ainda aqui')
        except Exception:
            pass
        time.sleep(0.3)
        ro2 = junta(obs, 0.3)
        check(R + 'inteiro JSON gigante no envelope não derruba a conexão (sem tchau; o chat seguinte chega)',
              s1.close_code is None and not de(ro, 'tchau', 's1') and len(de(ro2, 'chat', 's1')) == 1,
              'close_code=%r tchau=%d chat=%d' % (s1.close_code, len(de(ro, 'tchau', 's1')), len(de(ro2, 'chat', 's1'))))

        # ------------------------------------------------------------ a sala
        p, q, g, g2 = liga(), liga(), liga(), liga()
        manda(p, t='oi', de='p', nome='P', x=0, z=0, sala=None, v=2)
        manda(q, t='oi', de='q', nome='Q', x=1, z=1)               # cliente antigo: sem sala
        manda(g2, t='pulso', de='g2', x=0, z=0, sala='garden:1')
        time.sleep(0.2)
        manda(g, t='oi', de='g', nome='G', x=0, z=0, sala='garden:1', v=2)
        time.sleep(0.4)
        rp, rq, rg, rg2 = junta(p, 0.2), junta(q, 0.2), junta(g, 0.2), junta(g2, 0.2)
        check(R + 'a sala declarada na entrada não chama a praça (o oi de G fica no jardim)',
              not de(rp, 'oi', 'g') and not de(rq, 'oi', 'g') and len(de(rg2, 'oi', 'g')) == 1)

        manda(p, t='pulso', de='p', x=0.5, z=0, sala=None)
        time.sleep(0.4)
        rp, rq, rg, rg2 = junta(p, 0.2), junta(q, 0.2), junta(g, 0.2), junta(g2, 0.2)
        check(R + 'o pulso da praça fica na praça',
              len(de(rq, 'pulso', 'p')) == 1 and not de(rg, 'pulso', 'p') and not de(rg2, 'pulso', 'p'))

        manda(g, t='pulso', de='g', x=1, z=0, sala='garden:1')
        time.sleep(0.4)
        rp, rq, rg2 = junta(p, 0.2), junta(q, 0.2), junta(g2, 0.2)
        check(R + 'o pulso do jardim fica no jardim',
              len(de(rg2, 'pulso', 'g')) == 1 and not de(rp, 'pulso', 'g') and not de(rq, 'pulso', 'g'))

        manda(q, t='pulso', de='q', x=2, z=2)                       # antigo: pulso sem sala
        time.sleep(0.4)
        rp, rg, rg2 = junta(p, 0.2), junta(g, 0.2), junta(g2, 0.2)
        check(R + 'o cliente antigo que não manda sala está na praça',
              len(de(rp, 'pulso', 'q')) == 1 and not de(rg, 'pulso', 'q') and not de(rg2, 'pulso', 'q'))

        manda(g, t='oi', de='g', nome='G', x=0, z=0, sala=None, v=2)  # volta à praça, mesma conexão
        time.sleep(0.4)
        rp, rq, rg2 = junta(p, 0.2), junta(q, 0.2), junta(g2, 0.2)
        check(R + 'mudar de sala na mesma conexão avisa as duas salas',
              len(de(rp, 'oi', 'g')) == 1 and len(de(rq, 'oi', 'g')) == 1 and len(de(rg2, 'oi', 'g')) == 1)

        # ------------------------------------------------------- a dirigida
        manda(p, t='troca', de='p', para='q', acao='convite', dados=None)
        time.sleep(0.4)
        rq, rg, rg2, ro = junta(q, 0.2), junta(g, 0.2), junta(g2, 0.2), junta(obs, 0.2)
        check(R + 'a troca dirigida vai só ao destino',
              len(de(rq, 'troca', 'p')) == 1 and not de(rg, 'troca', 'p') and not de(rg2, 'troca', 'p')
              and not de(ro, 'troca', 'p'))
        manda(p, t='guilda', de='p', para='ninguem-aqui', acao='convite', dados=None)
        time.sleep(0.4)
        rq, rg2, ro = junta(q, 0.2), junta(g2, 0.2), junta(obs, 0.2)
        check(R + 'destino desconhecido: como antes (todos ouvem)',
              len(de(rq, 'guilda', 'p')) == 1 and len(de(rg2, 'guilda', 'p')) == 1 and len(de(ro, 'guilda', 'p')) == 1)

        # ---------------------------------------------------------- o eco
        e2, e3 = liga(), liga()
        manda(e2, t='pulso', de='e2', x=0, z=0, sala='eco:1')
        manda(e3, t='pulso', de='e3', x=0, z=0, sala='eco:1')
        time.sleep(0.3)
        e1 = liga()
        manda(e1, t='oi', de='e1', nome='E1', x=0, z=0, sala='eco:1', v=2)
        time.sleep(0.4)
        junta(e2, 0.2), junta(e3, 0.2)
        manda(e2, t='eco', de='e2', nome='E2', x=0, z=0, sala='eco:1')           # antigo: sem para
        time.sleep(0.3)
        manda(e2, t='eco', de='e2', nome='E2', x=0, z=0, sala='eco:1')           # já respondeu
        manda(e3, t='eco', de='e3', para='e1', nome='E3', x=0, z=0, sala='eco:1', v=2)
        time.sleep(0.4)
        r1, r2, r3 = junta(e1, 0.3), junta(e2, 0.2), junta(e3, 0.2)
        check(R + 'o eco antigo (sem para) vai só a quem perguntou, uma vez',
              len(de(r1, 'eco', 'e2')) == 1 and not de(r3, 'eco', 'e2'), '%d' % len(de(r1, 'eco', 'e2')))
        check(R + 'o eco novo (com para) vai só ao destino',
              len(de(r1, 'eco', 'e3')) == 1 and not de(r2, 'eco', 'e3'))

        # ---------------------------------------------- o tchau pelo que caiu
        # (reverificação, a reconexão em laço) o relé só despede por quem se
        # apresentou — um oi que chegou a alguém, como o cliente de verdade
        # faz ao entrar — há pelo menos TCHAU_APOS_S (5 s): o z9 e as duas
        # abas do z7 se apresentam juntos, e a espera é uma só
        junta(obs, 0.1)
        z9, z7a, z7b = liga(), liga(), liga()
        manda(z9, t='oi', de='z9', nome='Z9', x=0, z=0, sala=None, v=2)
        manda(z7a, t='oi', de='z7', nome='Z7', x=0, z=0, sala=None, v=2)
        manda(z7b, t='oi', de='z7', nome='Z7', x=0, z=0, sala=None, v=2)
        time.sleep(constante('TCHAU_APOS_S', 5.0) + 0.3)
        junta(obs, 0.1)
        z9.close()
        time.sleep(0.4)
        ro = junta(obs, 0.3)
        check(R + 'quem se apresentou e cai sem tchau ganha o tchau do relé', len(de(ro, 'tchau', 'z9')) == 1)
        z8 = liga()
        manda(z8, t='pulso', de='z8', x=0, z=0, sala=None)
        manda(z8, t='tchau', de='z8')
        time.sleep(0.2)
        z8.close()
        time.sleep(0.4)
        ro = junta(obs, 0.3)
        check(R + 'quem disse tchau não ganha um segundo', len(de(ro, 'tchau', 'z8')) == 1)
        z7a.close()
        time.sleep(0.4)
        ro1 = junta(obs, 0.3)
        z7b.close()
        time.sleep(0.4)
        ro2 = junta(obs, 0.3)
        check(R + 'a mesma conta em duas abas: o tchau só quando a última cai',
              not de(ro1, 'tchau', 'z7') and len(de(ro2, 'tchau', 'z7')) == 1)

        # -------------------------------------------------------- os limites
        r, w = liga(), liga()
        manda(r, t='pulso', de='r', x=0, z=0, sala='lim:1')
        manda(w, t='pulso', de='w', x=0, z=0, sala='lim:1')
        time.sleep(0.3)
        junta(r, 0.1)
        t0 = time.time()
        for i in range(100):
            manda(w, t='alvo', de='w', x=i, z=0)
        gasto = time.time() - t0
        time.sleep(0.5)
        n = len(de(junta(r, 0.3), 'alvo', 'w'))
        check(R + 'limite por conexão: 100 de uma vez, passa a rajada (~40)',
              35 <= n <= 45 + 20 * gasto, '%d passaram em %.2f s' % (n, gasto))
        w2 = liga()
        manda(w2, t='pulso', de='w2', x=0, z=0, sala='lim:1')
        for i in range(20):
            manda(w2, t='chat', de='w2', nome='W2', texto='fala %d' % i)
        time.sleep(0.5)
        n = len(de(junta(r, 0.3), 'chat', 'w2'))
        check(R + 'o chat tem limite próprio, mais baixo (rajada de 10, e 1 por segundo)', 10 <= n <= 11, '%d passaram' % n)

        # (3.1) o `para` que não acha ninguém cai na difusão (oi e eco: a
        # sala; troca/guilda: o servidor inteiro) — e paga o balde do fan-out
        # (1 a cada 5 s, rajada de 4), não só o geral de 20/s. Antes era a
        # amplificação de graça: 12 de uma vez passavam os 12
        for tipo, campos in (('oi', dict(nome='X', x=0, z=0, sala='lim:1', v=2)),
                             ('troca', dict(acao='convite', dados=None)),
                             ('eco', dict(nome='X', x=0, z=0, sala='lim:1', v=2))):
            wx = liga()
            manda(wx, t='pulso', de='x-' + tipo, x=0, z=0, sala='lim:1')
            time.sleep(0.2)
            junta(r, 0.1)
            for i in range(12):
                manda(wx, t=tipo, de='x-' + tipo, para='ninguem-%d' % i, **campos)
            time.sleep(0.5)
            n = len(de(junta(r, 0.3), tipo, 'x-' + tipo))
            check(R + '`%s` com `para` que não existe cai na difusão, mas paga o balde dela (12 de uma vez: passam 4)' % tipo,
                  4 <= n <= 5, '%d passaram' % n)

        # (3.1, as outras portas do mesmo quarto) o `t` que o relé não
        # conhece, sem `para`, ia à sala inteira; trocar de sala a cada pulso
        # avisava as DUAS salas inteiras — as duas a 20/s, só no balde geral.
        # Consertar só o `para` deixava o ataque trocar de porta
        wx = liga()
        manda(wx, t='pulso', de='x-zz', x=0, z=0, sala='lim:1')
        time.sleep(0.2)
        junta(r, 0.1)
        for i in range(12):
            manda(wx, t='zz', de='x-zz', n=i)
        time.sleep(0.5)
        n = len(de(junta(r, 0.3), 'zz', 'x-zz'))
        check(R + 'um `t` que o relé não conhece vai à sala, mas paga o balde da difusão (12 de uma vez: passam 4)',
              4 <= n <= 5, '%d passaram' % n)
        r2, wt = liga(), liga()
        manda(r2, t='pulso', de='r2', x=0, z=0, sala='lim:2')
        manda(wt, t='pulso', de='x-sala', x=0, z=0, sala='lim:1')   # a 1ª sala é declaração: não paga
        time.sleep(0.3)
        junta(r2, 0.1)
        for i in range(12):
            manda(wt, t='pulso', de='x-sala', x=0, z=0, sala=('lim:2' if i % 2 == 0 else 'lim:1'))
        time.sleep(0.5)
        n = len(de(junta(r2, 0.3), 'pulso', 'x-sala'))
        check(R + 'trocar de sala a cada pulso (as duas salas inteiras ouvem) paga o balde da difusão: de 12, passam 4',
              4 <= n <= 5, '%d chegaram à outra sala' % n)
        w3 = liga()
        try:
            for i in range(260):
                w3.send('lixo %d' % i)
        except Exception:
            pass
        time.sleep(0.8)
        check(R + 'quem abusa sem parar é desligado (1008)', w3.close_code == 1008, repr(w3.close_code))

        # --------------------------------- os K mais próximos numa praça cheia
        fecha_todos()
        time.sleep(0.6)
        perto = [liga() for _ in range(40)]          # a 1..40 m, clientes novos
        longe_novo = [liga() for _ in range(5)]      # a 41..45 m, clientes novos
        longe_velho = [liga() for _ in range(5)]     # a 101..105 m, clientes antigos (sem v)
        for i, ws in enumerate(perto + longe_novo):
            manda(ws, t='oi', de='n%d' % i, nome='N', x=float(i + 1), z=0, sala=None, v=2)
        for i, ws in enumerate(longe_velho):
            manda(ws, t='oi', de='v%d' % i, nome='V', x=101.0 + i, z=0)
        s = liga()
        time.sleep(0.5)
        manda(s, t='oi', de='s', nome='S', x=0, z=0, sala=None, v=2)
        time.sleep(0.8)
        todos = perto + longe_novo + longe_velho
        for ws in todos:
            junta(ws, 0.05)

        def conta():
            time.sleep(0.6)
            return [len(de(junta(ws, 0.05), 'pulso', 's')) for ws in todos]

        def pulsa(k):
            for _ in range(k):
                manda(s, t='pulso', de='s', x=0, z=0, sala=None)

        pulsa(5)
        c1 = conta()
        time.sleep(3.0)
        pulsa(2)
        c2 = conta()
        time.sleep(3.0)
        pulsa(1)
        c3 = conta()
        tot = [x + y + z for x, y, z in zip(c1, c2, c3)]
        np_, nl, nv = tot[:40], tot[40:45], tot[45:]
        check(R + 'praça cheia: os 40 mais próximos recebem todo pulso (8 de 8)',
              all(v == 8 for v in np_), str(sorted(set(np_))))
        check(R + 'os demais (cliente novo) recebem 1 a cada 5 (o 1º e o 6º)',
              all(v == 2 for v in nl), str(nl))
        check(R + 'os demais (cliente antigo, varredura de 8 s) recebem um a cada 3,5 s',
              all(v == 3 for v in nv), str(nv))
        check(R + 'a primeira rodada de 5: perto 5, longe 1',
              all(v == 5 for v in c1[:40]) and all(v == 1 for v in c1[40:]), str(sorted(set(c1))))

        # (3.2) o alvo — o clique de andar, que sai muito mais que o pulso —
        # ia à sala inteira (era o N² que o pulso já não tinha). Agora passa
        # pelo mesmo corte: só os 40 mais próximos (o dobro do TETO_FANTASMAS
        # de 20 que ganham corpo na praça)
        manda(s, t='alvo', de='s', x=0, z=0)
        time.sleep(0.6)
        ca = [len(de(junta(ws, 0.05), 'alvo', 's')) for ws in todos]
        check(R + 'praça cheia: o alvo (o clique de andar) também só chega aos 40 mais próximos',
              all(v == 1 for v in ca[:40]) and all(v == 0 for v in ca[40:]),
              '%d dos 40 perto, %d dos 10 longe' % (sum(ca[:40]), sum(ca[40:])))
        esperado = '{"t":"rele","v":1,"ident":false}'
        check(R + 'toda conexão ouviu primeiro o anúncio do relé (sem --banco: ident false)',
              len(anuncios) > 50 and all(x == esperado for x in anuncios),
              '%d conexões, %d sem o anúncio' % (len(anuncios), sum(1 for x in anuncios if x != esperado)))
    finally:
        fecha_todos()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        registro.close()


def prova_do_modulo():
    """As provas PURAS, sem relé no ar: importa o servidor/rele.py como módulo
    e chama direto o que depende do relógio (o pulso ralo, o balde do chat)
    com o tempo INJETADO — em vez de esperar 12 s de verdade — e o que é
    interno (o _num, o _processa isolado dentro do trata)."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(RELE)))
    import rele
    R = 'módulo: '

    def limpa():
        rele.PARES.clear()
        rele.POR_ID.clear()
        rele.SALAS.clear()
        rele.SALAS[None] = set()

    def par(id_, x, t, versao=2):
        p = rele.Par(object(), t)
        p.id, p.x, p.z, p.versao = id_, float(x), 0.0, versao
        rele.SALAS[None].add(p)
        rele.POR_ID.setdefault(id_, set()).add(p)
        return p

    # ---------------------------------------- (3.3) o _num e o _processa
    try:
        ok = rele._num(10 ** 400) is None
    except OverflowError:
        ok = False
    check(R + 'inteiro JSON gigante no _num vira None em vez de OverflowError', ok)
    check(R + 'o _num aceita número comum e recusa bool, NaN e texto',
          rele._num(1.5) == 1.5 and rele._num(3) == 3.0 and rele._num(True) is None
          and rele._num(float('nan')) is None and rele._num('1') is None)

    class WsFalso:                                   # o `async for msg in ws` do trata
        remote_address = ('prova', 0)

        def __init__(self, msgs):
            self.msgs = list(msgs)

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self.msgs:
                raise StopAsyncIteration
            return self.msgs.pop(0)

    limpa()
    chamadas = []

    def explode(par_, m, agora):
        chamadas.append(m['t'])
        if len(chamadas) == 1:
            raise RuntimeError('envelope torto')
        return []

    registro = io.StringIO()
    alca = logging.StreamHandler(registro)
    original = rele._processa
    rele._processa = explode
    rele.log.addHandler(alca)
    try:
        asyncio.run(rele.trata(WsFalso(['{"t":"pulso","de":"m1","x":0,"z":0}',
                                        '{"t":"chat","de":"m1","nome":"M","texto":"ainda vivo"}'])))
    finally:
        rele._processa = original
        rele.log.removeHandler(alca)
    check(R + 'um erro dentro do _processa descarta o envelope e a conexão segue lendo',
          chamadas == ['pulso', 'chat'], repr(chamadas))
    check(R + 'e deixa rastro no log (log.exception com o envelope)',
          'envelope derrubou' in registro.getvalue() and 'RuntimeError' in registro.getvalue(),
          registro.getvalue()[:120].replace('\n', ' | '))

    # ------------------------------------------------- (3.5) o pulso ralo
    limpa()
    t = 1000.0
    s = par('s', 0, t)
    outros = [par('n%d' % i, i + 1, t) for i in range(45)]
    longe = outros[40:]

    def chegou(dest):
        return sum(1 for p in longe if p in dest)

    d = [chegou(rele._pulso(s, t)), chegou(rele._pulso(s, t + 6.0)), chegou(rele._pulso(s, t + 12.5))]
    check(R + 'pulso ralo: parado (um pulso a cada 6 s), quem está longe ouve de novo em 12 s — não em 30',
          d == [5, 0, 5], str(d))
    limpa()
    s = par('s', 0, t)
    outros = [par('n%d' % i, i + 1, t) for i in range(45)]
    longe = outros[40:]
    seq = [chegou(rele._pulso(s, t + 2.0 * i)) for i in range(10)]
    check(R + 'quem anda (pulso a cada 2 s) segue no 1 em 5: o 1º e o 6º',
          seq == [5, 0, 0, 0, 0, 5, 0, 0, 0, 0], str(seq))
    limpa()
    s = par('s', 0, t)
    outros = [par('n%d' % i, i + 1, t) for i in range(45)]
    longe = outros[40:]
    todos_ = rele._processa(s, {'t': 'alvo', 'de': 's', 'x': 0, 'z': 0}, t)
    check(R + 'o alvo passa pelo corte dos K mais próximos (45 na sala: 40 recebem, os 5 de longe não)',
          len(todos_) == 40 and chegou(todos_) == 0, '%d, longe %d' % (len(todos_), chegou(todos_)))

    # ---------------------- (3.1) toda difusão paga o balde da difusão
    # a porta que o revisor mediu (o `para` que não acha ninguém) tem as
    # provas ao vivo; aqui as outras do mesmo quarto, que sem o conserto
    # espalhavam à sala inteira a 20/s: o `t` que o relé não conhece (sem
    # `para`) e a sala trocada a cada envelope — e o eco ISENTO (responde a
    # um oi) que troca de sala, que não pagava nem o balde geral nem o leque
    def praca_cheia():
        limpa()
        s_ = par('s', 0, t)
        s_.declarou = True                           # já está na praça: outra sala é MUDANÇA
        return s_, [par('n%d' % i, i + 1, t) for i in range(45)]

    def trocas(s_, envelopes, antes_de_cada=None):
        n_ = 0
        for m in envelopes:
            if antes_de_cada:
                antes_de_cada()
            sala0 = s_.sala
            rele._processa(s_, m, t)
            n_ += (s_.sala != sala0)
        return n_

    s, viz = praca_cheia()
    n = sum(1 for _ in range(12) if rele._processa(s, {'t': 'zz', 'de': 's'}, t))
    check(R + 'um `t` que o relé não conhece vai à sala, mas paga o balde da difusão (12 de uma vez: passam 4)',
          n == 4, '%d passaram' % n)
    s, viz = praca_cheia()
    n = trocas(s, [{'t': 'pulso', 'de': 's', 'x': 0, 'z': 0, 'sala': sala} for sala in ['b', None] * 6])
    check(R + 'trocar de sala a cada pulso (as duas salas inteiras ouvem) paga o balde da difusão: de 12, passam 4',
          n == 4, '%d trocas passaram' % n)
    s, viz = praca_cheia()
    c = viz[0]
    pergunta = {'t': 'oi', 'de': c.id, 'para': 's', 'nome': 'C', 'x': 1, 'z': 0, 'v': 2}
    n = trocas(s, [{'t': 'eco', 'de': 's', 'para': c.id, 'nome': 'S', 'x': 0, 'z': 0, 'sala': sala, 'v': 2}
                   for sala in ['b', None] * 6],
               antes_de_cada=lambda: rele._processa(c, dict(pergunta), t))   # cada eco responde a um oi: isento
    check(R + 'o eco isento (responde a um oi) que troca de sala também paga: de 12, passam 4',
          n == 4, '%d trocas passaram' % n)
    s, viz = praca_cheia()
    n = trocas(s, [{'t': 'oi', 'de': 's', 'nome': 'S', 'x': 0, 'z': 0, 'sala': sala, 'v': 2}
                   for sala in ['b', None, 'b', None]])
    check(R + 'a troca de sala do jogo (o oi da apresentação) paga UMA vez só: 4 seguidas passam as 4',
          n == 4, '%d trocas passaram' % n)

    # ------------------ (reverificação, a reconexão em laço) o endereço
    # o limite de conexões novas é por endereço: o IP público do
    # X-Forwarded-For lido da direita para a esquerda, como no cartório (o
    # forjado à esquerda não conta), IPv6 pelo /64; privado ou ausente, sem
    # limite; e o socket público (relé exposto direto) vale mais que o
    # cabeçalho, que qualquer um escreve
    from websockets.datastructures import Headers

    class WsCab:
        def __init__(self, sock, xff=None, legado=False):
            self.remote_address = (sock, 5555)
            h = Headers()
            for linha in ([] if xff is None else [xff] if isinstance(xff, str) else xff):
                h['X-Forwarded-For'] = linha
            if legado:
                self.request_headers = h                                   # websockets 9 a 12 (o legado)
            else:
                self.request = type('Pedido', (), {'headers': h, 'path': '/ws'})()   # a implementação nova

    def chave(*a, **k):
        f = getattr(rele, '_chave_ip', None)
        if f is None:
            return 'o relé não tem _chave_ip'
        try:
            return f(WsCab(*a, **k))
        except Exception as e:
            return 'erro %s' % type(e).__name__

    casos = [(('127.0.0.1', '177.10.20.30'), {}, '177.10.20.30'),
             (('127.0.0.1', '8.8.8.8, 177.10.20.30, 172.18.0.5'), {}, '177.10.20.30'),
             (('127.0.0.1', '8.8.8.8, 177.10.20.30, 172.18.0.5'), {'legado': True}, '177.10.20.30'),
             (('127.0.0.1', ['8.8.8.8', '177.10.20.30']), {}, '177.10.20.30'),
             (('127.0.0.1', '::ffff:177.10.20.30'), {}, '177.10.20.30'),
             (('127.0.0.1', '2804:14c:1234:5678::1'), {}, '2804:14c:1234:5678::/64'),
             (('127.0.0.1', '2804:14c:1234:5678:ffff:1:2:3'), {}, '2804:14c:1234:5678::/64'),
             (('127.0.0.1', '2804:14c:1234:5679::1'), {}, '2804:14c:1234:5679::/64'),
             (('127.0.0.1',), {}, None),
             (('127.0.0.1', '10.0.0.7, 192.168.1.1'), {}, None),
             (('177.10.20.99', '8.8.8.8'), {}, '177.10.20.99')]
    erradas = [(a, esperado, chave(*a, **k)) for a, k, esperado in casos if chave(*a, **k) != esperado]
    check(R + 'o endereço da conexão: o público mais à direita do X-Forwarded-For (o forjado à esquerda não conta), '
              'IPv6 pelo /64, privado ou ausente sem limite, socket público acima do cabeçalho',
          not erradas, repr(erradas)[:300])

    admite = getattr(rele, '_admite', None)
    rajada_ip, taxa_ip = getattr(rele, 'NOVAS_RAJADA', 10.0), getattr(rele, 'NOVAS_TAXA', 0.5)
    k = int(rajada_ip)
    if admite is None:
        check(R + 'conexões novas por endereço: %d de uma vez, depois 1 a cada %.0f s' % (k, 1 / taxa_ip), False,
              'o relé não tem _admite')
    else:
        rele.NOVAS.clear()
        t0 = 5000.0
        rajada = [admite('177.10.20.30', t0) for _ in range(k + 5)]
        depois = [admite('177.10.20.30', t0 + i / taxa_ip) for i in (1, 2, 3)]
        cedo = admite('177.10.20.30', t0 + 3 / taxa_ip + 0.1)             # a ficha seguinte ainda não voltou
        outro = admite('177.10.20.31', t0)
        casa = all(admite(None, t0) for _ in range(500))
        check(R + 'conexões novas por endereço: %d de uma vez, depois 1 a cada %.0f s; outro IP tem balde próprio; '
                  'sem IP público (em casa) não tem limite' % (k, 1 / taxa_ip),
              rajada == [True] * k + [False] * 5 and depois == [True] * 3 and not cedo and outro and casa,
              'rajada %d de %d, depois %r, cedo %r, outro %r, casa %r'
              % (rajada.count(True), k + 5, depois, cedo, outro, casa))
        rele.NOVAS.clear()
        for i in range(rele.NOVAS_MAX - 1):
            admite('ocupa-%d' % i, t0)                   # só ocupam o mapa; em t0 + 100 estão cheios de novo
        for _ in range(k):
            admite('quente', t0 + 99.0)                  # este acabou de esvaziar o balde
        admite('novo', t0 + 100.0)
        check(R + 'o mapa de endereços cheio esquece os baldes cheios, nunca o de quem está sendo freado',
              len(rele.NOVAS) == 2 and 'quente' in rele.NOVAS and not admite('quente', t0 + 100.0),
              '%d no mapa' % len(rele.NOVAS))
        rele.NOVAS.clear()

    # ------------------ (reverificação, a reconexão em laço) o tchau do relé
    # só por quem se apresentou (um oi ou eco que chegou a alguém) há pelo
    # menos TCHAU_APOS_S, pago pelo balde da difusão e pelo leque DA CONEXÃO
    # QUE CAIU; antes, conectar, dizer oi e cair dava 2 entregas por par a
    # cada volta (o oi e o tchau do relé), sem balde nenhum no tchau
    apos = getattr(rele, 'TCHAU_APOS_S', 5.0)
    enviados = []

    def grava(conexoes, msg):
        enviados.append((len(conexoes), msg))
        return len(conexoes)

    def praca45():
        limpa()
        for i in range(45):
            p_ = rele.Par(object(), t)
            p_.id, p_.x, p_.z = 'n%d' % i, float(i + 1), 0.0
            rele.PARES[p_.ws] = p_
            rele.SALAS[None].add(p_)
            rele.POR_ID.setdefault(p_.id, set()).add(p_)

    def entra(quando):
        p_ = rele.Par(object(), quando)
        rele.PARES[p_.ws] = p_
        rele.SALAS[None].add(p_)
        return p_

    def oi(p_, id_, quando):
        return rele._processa(p_, {'t': 'oi', 'de': id_, 'nome': 'X', 'x': 0, 'z': 0, 'v': 2}, quando)

    def cai(p_, quando):
        """Quantas entregas o tchau do relé fez quando `p_` caiu."""
        del enviados[:]
        try:
            rele._sai(p_, quando)
        except TypeError:                            # o _sai de antes do conserto não aceitava o relógio
            rele._sai(p_)
        return sum(n_ for n_, msg in enviados if '"tchau"' in msg)

    manda_orig = rele.manda_a_todos
    rele.manda_a_todos = grava
    try:
        praca45()
        p = entra(t)
        rele._processa(p, {'t': 'pulso', 'de': 'calado', 'x': 0, 'z': 0}, t)
        nunca = cai(p, t + 60.0)
        praca45()
        p = entra(t)
        oi(p, 'rapido', t)
        cedo = cai(p, t + 1.0)
        praca45()
        p = entra(t)
        oi(p, 'ficou', t)
        ficou = cai(p, t + apos + 0.1)
        praca45()
        p = entra(t)
        oi(p, 'gastou', t)
        gastos = sum(1 for _ in range(10) if oi(p, 'gastou', t + apos))   # difundiu tudo o que o balde deixava
        gastou = cai(p, t + apos)
        praca45()                                    # o laço da reverificação, puro: 200 voltas
        entregas = tchaus = 0
        for i in range(200):
            q = t + 0.017 * i
            p = entra(q)
            entregas += len(oi(p, 'lixo-%d' % i, q) or ())
            n = cai(p, q + 0.005)
            entregas += n
            tchaus += n
    finally:
        rele.manda_a_todos = manda_orig
        limpa()
    check(R + 'o tchau do relé: quem nunca se apresentou (só pulso) não ganha tchau ao cair', nunca == 0,
          '%d entregas' % nunca)
    check(R + 'o tchau do relé: quem disse oi e caiu antes de %.0f s não ganha (a volta do laço da reverificação)' % apos,
          cedo == 0, '%d entregas' % cedo)
    check(R + 'o tchau do relé: quem se apresentou há %.0f s e cai ganha o tchau, a todos (45)' % apos,
          ficou == 45, '%d entregas' % ficou)
    check(R + 'o tchau do relé paga o balde da difusão DA CONEXÃO: quem gastou tudo em difusão antes de cair não ganha',
          gastos >= 1 and gastou == 0, '%d difusões antes, %d entregas do tchau' % (gastos, gastou))
    check(R + 'o laço puro (conectar, dizer oi e cair, 200 voltas numa praça de 45): 1 entrega por par a cada volta (o oi), não 2',
          tchaus == 0 and entregas == 200 * 45, '%d entregas, %d do tchau do relé' % (entregas, tchaus))

    # ----------------------------------------------- (3.4) o balde do chat
    b = rele.Balde(rele.CHAT_TAXA, rele.CHAT_RAJADA, 0.0)
    perdidas = sum(0 if b.tira(1.5 * i) else 1 for i in range(1, 41))     # 40 linhas, uma a cada 1,5 s
    check(R + 'chat: uma pessoa numa conversa animada (1 linha a cada 1,5 s por 60 s) não perde nenhuma',
          perdidas == 0, '%d perdidas' % perdidas)
    b = rele.Balde(rele.CHAT_TAXA, rele.CHAT_RAJADA, 0.0)
    robo = sum(1 if b.tira(0.05 * i) else 0 for i in range(1, 201))       # 20 linhas/s durante 10 s
    check(R + 'chat: um robô a 20 linhas/s passa só a rajada de 10 mais 1 por segundo (~20 em 10 s)',
          18 <= robo <= 22, '%d passaram de 200' % robo)


def prova_reconexao(n=100, janela=4.0):
    """(reverificação, a reconexão em laço) O relé DE VERDADE, em prioridade
    baixa, numa praça de `n` parados. O laço da reverificação — conectar com
    um `de` novo, dizer oi e cair sem tchau, sem parar — medido assim: vindo
    de um IP público (o X-Forwarded-For que o Caddy repassa: o forjado à
    esquerda não conta), o balde de conexões novas do endereço corta o laço;
    vindo de casa (loopback, sem limite por IP), cada volta ainda entrega o
    oi, mas não ganha mais o tchau do relé; e um jogador comum (outro IP) que
    fica, cai e volta segue sendo visto e despedido, com o laço rodando ao
    lado. Precisa do cliente asyncio do websockets (13+)."""
    try:
        from websockets.asyncio.client import connect as aconnect
    except ImportError:
        check('reconexão em laço: o cliente asyncio do websockets (13+) na máquina de testes', False)
        return
    porta = porta_livre()
    registro = tempfile.TemporaryFile()
    proc = subprocess.Popen([sys.executable, RELE, '--porta', str(porta), '--relatorio', '0'],
                            stdout=subprocess.DEVNULL, stderr=registro, creationflags=BAIXA)
    try:
        if not espera_porta(porta):
            registro.seek(0)
            check('reconexão em laço: o relé subiu', False, registro.read().decode('utf-8', 'replace')[-400:])
            return
        asyncio.run(_reconexao(aconnect, 'ws://127.0.0.1:%d' % porta, n, janela))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        registro.close()


async def _reconexao(aconnect, url, n, janela):
    R = 'reconexão em laço: '
    rajada, taxa = constante('NOVAS_RAJADA', 10.0), constante('NOVAS_TAXA', 0.5)
    apos = constante('TCHAU_APOS_S', 5.0)
    cont = collections.Counter()                     # (t, quem) entregues aos parados; quem: 'lixo-A', 'lixo-B' ou o id

    def quem(de_):
        return de_.rsplit('-', 1)[0] if de_.startswith('lixo-') else de_

    async def ouve(ws):
        try:
            async for msg in ws:
                try:
                    m = json.loads(msg)
                except Exception:
                    continue
                if isinstance(m, dict) and isinstance(m.get('de'), str):
                    cont[(m.get('t'), quem(m['de']))] += 1
        except Exception:
            pass

    def env(**o):
        return json.dumps(o, separators=(',', ':'))

    async def liga(cabecalhos=None):
        return await aconnect(url, open_timeout=10, max_size=None, additional_headers=cabecalhos)

    async def laco(rotulo, cabecalhos, segundos):
        """O laço da reverificação: conecta com um `de` novo, diz oi e cai sem tchau."""
        t0 = time.monotonic()
        voltas = recusadas = 0
        while time.monotonic() - t0 < segundos:
            try:
                ws = await liga(cabecalhos(voltas) if cabecalhos else None)
            except Exception:
                break
            try:
                await ws.send(env(t='oi', de='%s-%d' % (rotulo, voltas), nome='x', x=0.0, z=0.0, sala=None, v=2))
            except Exception:
                pass
            await asyncio.sleep(0.005)
            try:
                await ws.close()
            except Exception:
                pass
            recusadas += ws.close_code == 1013
            voltas += 1
        return voltas, recusadas, time.monotonic() - t0

    async def fica(ws, id_, segundos):
        """Um jogador parado: pulsa a cada segundo."""
        fim = time.monotonic() + segundos
        while True:
            falta = fim - time.monotonic()
            if falta <= 0:
                return
            await ws.send(env(t='pulso', de=id_, x=0.5, z=0.0, sala=None))
            await asyncio.sleep(min(1.0, falta))

    praca = []
    try:
        for i in range(n):
            ws = await liga()
            praca.append((ws, asyncio.ensure_future(ouve(ws))))
            await ws.send(env(t='oi', de='q%03d' % i, nome='Q', x=float(i + 1), z=0.0, sala=None, v=2))
        await asyncio.sleep(1.0 + n / 200.0)
        jog = {'X-Forwarded-For': '177.10.20.31'}     # o jogador comum: outro IP público
        oi_j = env(t='oi', de='jog', nome='Jogador', x=0.5, z=0.0, sala=None, v=2)

        # 1) de um IP público. O que chega ao relé atrás do Traefik e do
        # Caddy é "<o que o cliente forjou>, <o IP dele>, <o Traefik>"; a
        # parte forjada muda a cada volta e não adianta
        j1 = await liga(jog)
        await j1.send(oi_j)
        ficando = asyncio.ensure_future(fica(j1, 'jog', apos + 0.6))
        voltas, recusadas, dur = await laco(
            'lixo-A', lambda i: {'X-Forwarded-For': '8.8.%d.%d, 177.10.20.30, 172.18.0.2' % (i // 250 % 250, i % 250)},
            janela)
        await ficando
        await j1.close()                             # o jogador cai sem tchau (aba morta)
        await asyncio.sleep(1.0)
        oi_a, tchau_a = cont[('oi', 'lixo-A')], cont[('tchau', 'lixo-A')]
        aceitas = voltas - recusadas
        cabem = rajada + taxa * dur + 1
        check(R + 'de um IP público, conectar, dizer oi e cair sem tchau, em laço, passa só o balde do endereço '
                  '(~%d conexões) e nenhum tchau do relé (antes: 11.900 entregas/s numa praça de 100)' % (rajada + taxa * janela),
              tchau_a == 0 and oi_a <= cabem * n and aceitas <= cabem,
              '%d voltas em %.1f s: %d fechadas com 1013, %d aceitas; entregues %d oi + %d tchau = %.0f/s (teto %.0f/s)'
              % (voltas, dur, recusadas, aceitas, oi_a, tchau_a, (oi_a + tchau_a) / dur, cabem * n / dur))
        t1, o1 = cont[('tchau', 'jog')], cont[('oi', 'jog')]
        check(R + 'com o laço rodando ao lado, um jogador comum (outro IP) que se apresenta, fica %.0f s e cai sem '
                  'tchau é visto e ganha o tchau do relé' % (apos + 0.6),
              o1 == n and t1 == n, 'oi %d, tchau %d, de %d parados' % (o1, t1, n))

        # 2) ele volta: é visto de novo, e o tchau que ele mesmo diz chega (e o relé não manda outro)
        j2 = await liga(jog)
        await j2.send(oi_j)
        await asyncio.sleep(0.8)
        o2 = cont[('oi', 'jog')]
        await j2.send(env(t='tchau', de='jog'))
        await asyncio.sleep(0.3)
        await j2.close()
        await asyncio.sleep(0.8)
        t2 = cont[('tchau', 'jog')]
        check(R + 'ele volta (mesmo IP, mesmo id) e é visto de novo; o tchau que ele diz chega, e o relé não manda um segundo',
              o2 == 2 * n and t2 == 2 * n, 'oi %d, tchau %d (esperado %d e %d)' % (o2, t2, 2 * n, 2 * n))

        # 3) de casa (loopback: sem limite por endereço) o laço ainda entrega
        # o oi, mas não ganha o tchau do relé; e o jogador volta outra vez,
        # fica e cai: o relé despede por ele de novo
        j3 = await liga(jog)
        await j3.send(oi_j)
        ficando = asyncio.ensure_future(fica(j3, 'jog', apos + 0.6))
        voltas_b, _, dur_b = await laco('lixo-B', None, 2.0)
        await ficando
        await j3.close()
        await asyncio.sleep(1.0)
        oi_b, tchau_b = cont[('oi', 'lixo-B')], cont[('tchau', 'lixo-B')]
        check(R + 'de casa (sem limite por endereço), o mesmo laço entrega 1 por parado a cada volta (o oi), não 2: '
                  'o relé não despede quem nem ficou %.0f s' % apos,
              voltas_b >= 10 and tchau_b == 0 and oi_b <= voltas_b * n,
              '%d voltas em %.1f s: %d oi + %d tchau entregues' % (voltas_b, dur_b, oi_b, tchau_b))
        t3, o3 = cont[('tchau', 'jog')], cont[('oi', 'jog')]
        check(R + 'o jogador volta outra vez, fica e cai: o relé despede por ele de novo',
              o3 == 3 * n and t3 == 3 * n, 'oi %d, tchau %d (esperado %d e %d)' % (o3, t3, 3 * n, 3 * n))
    finally:
        for ws, tarefa in praca:
            tarefa.cancel()
            try:
                await ws.close()
            except Exception:
                pass


if __name__ == '__main__':
    prova_do_modulo()
    roda([], 'broadcast do websockets')
    roda(['--broadcast-caseiro'], 'broadcast de casa (caminho da 9.x)')
    prova_reconexao()
    falhas = RESULTADOS.count(False)
    print('RESUMO: ' + ('tudo passou (%d)' % len(RESULTADOS) if not falhas else 'FALHOU — %d de %d' % (falhas, len(RESULTADOS))))
    sys.exit(1 if falhas else 0)
