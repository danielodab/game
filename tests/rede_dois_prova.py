#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova dos DIRIGIDOS (11/09): a mensagem particular, o grupo, o duelo e a batalha em dupla pela Rede.

    python tests/rede_dois_prova.py [--chrome-baixa CAMINHO] [--sem-navegador] [--so-navegador]

O pedido do dono (10/09): tocar noutro jogador leva à mensagem particular, ao
grupo e ao duelo, e o grupo desce JUNTO para a batalha. Tudo isso viaja em
mensagens DIRIGIDAS a uma pessoa — e o relé de antes, quando o destino não
estava ligado, espalhava a troca e a guilda pelo servidor inteiro: numa
mensagem particular, vazamento. Esta prova sobe o relé DE VERDADE
(servidor/rele.py) e confere em três níveis:

  0. o módulo (sem relé no ar): o `cx` por conexão, o `paraCx`, o dirigido
     sem recuo e a voz `ausente`, os baldes do convite e do sussurro, o
     `vigia` (4 alvos por conexão, 16 vigias por alvo) e o `caiu` na queda —
     com tchau ou sem, com a outra aba viva ou não —, o log que não guarda o
     texto e o nome reservado julgado no sussurro;
  1. o relé ao vivo com clientes crus (a Ana, a Bia e o intruso Caio): o
     sussurro só chega à Bia; o que vai a quem não está não chega a ninguém
     (e a Ana ouve `ausente` — antes, o Caio receberia); sem `para`, cai; o
     nome reservado é trocado; o carimbo do `cx` vence o forjado; a segunda
     aba não ouve o que é da primeira; o `caiu` chega em menos de 1 s; o 4º
     convite e o 11º sussurro caem; a troca a quem não está não se espalha; e
     o envelope de 9 KB fecha a conexão com 1009 (o motivo das fatias);
  2. o js/core/rede.js de verdade no Chrome headless: dois iframes da mesma
     origem, servidos por um http.server daqui, ligados ao relé de verdade
     (um terceiro, a um relé ANTIGO de mentira; o intruso é um cliente cru na
     mesma praça): o R.dirige de 20 KB chega inteiro como UM evento, o
     R.ouvir com dois ouvintes, o R.entrar com outra sala sem tchau (a mesma
     conexão: o cx não muda), o R._derruba com o `caiu` do outro lado e o
     `religou` com cx novo (e o vigia que volta sozinho), o sussurro, o cinto
     contra o 1009, e o relé antigo recusando o privado e os dirigidos.

Da revisão adversarial do multijogador (11/09): o achado 17 — o id sem conta
preso ao APARELHO (a prova: outra conexão com o id da vítima não entra nele,
nem na queda e na volta; o segredo nunca é repassado nem vai ao log; o rede.js
de verdade manda a prova e o impostor cru com o id da Bia não ouve nada
dirigido a ela) — e o achado 21 — a caixa de ENTRADA de cada destino, por
endereço de quem manda (conexão nova e id novo não renovam) e o `cala`, que
faz o Silenciar segurar quem abre uma conexão nova a cada envio.

O Chrome: um por vez, em prioridade baixa (--chrome-baixa CAMINHO, ou
SOTERRA_CHROME_BAIXA, é o lançador da máquina de testes; sem ele, o daqui faz
o mesmo). Precisa do websockets 13+ (o cliente síncrono e o servidor asyncio).
"""
import asyncio
import hashlib
import html
import io
import json
import logging
import os
import random
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

from websockets.sync.client import connect
try:
    from websockets.asyncio.server import serve as serve_ws
except ImportError:                                   # antes da 13
    from websockets.server import serve as serve_ws

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))
SERVIDOR = os.path.join(RAIZ, 'servidor')
RELE = os.path.join(SERVIDOR, 'rele.py')
BAIXA = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)     # o dono usa a máquina enquanto a prova roda
CHROMES = [r'C:\Program Files\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
           '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
RESULTADOS = []
HEX8 = re.compile(r'[0-9a-f]{8}')


def check(nome, ok, extra=''):
    RESULTADOS.append(bool(ok))
    print(('PASSOU · ' if ok else 'FALHOU · ') + nome + ((' — ' + extra) if extra else ''), flush=True)


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
    except Exception:                                  # TimeoutError, a conexão fechada...
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


def voz(lista, t):
    """A voz do relé (sem `de`) de um tipo."""
    return [m for m in lista if isinstance(m, dict) and m.get('t') == t and 'de' not in m]


def primeiro(lista, t, quem):
    achados = de(lista, t, quem)
    return achados[0] if achados else {}


def manda(ws, **campos):
    ws.send(json.dumps(campos, ensure_ascii=False))


def espera_voz(ws, t, segundos):
    """A primeira voz do relé do tipo `t` que chegar em até `segundos` (ou None)."""
    fim = time.time() + segundos
    while time.time() < fim:
        s = recebe(ws, max(0.05, fim - time.time()))
        if s is None:
            if getattr(ws, 'close_code', None) is not None:
                return None
            continue
        try:
            m = json.loads(s)
        except Exception:
            continue
        if isinstance(m, dict) and m.get('t') == t and 'de' not in m:
            return m
    return None


# ================================================================ 0. o módulo
def prova_do_modulo():
    """O servidor/rele.py como módulo, sem relé no ar: as conexões são Par de
    mentira e o que o relé mandaria fica gravado (manda_a_todos trocado)."""
    if SERVIDOR not in sys.path:
        sys.path.insert(0, SERVIDOR)
    import rele
    import rele_ident
    R = 'módulo: '
    enviados = []                                     # (conexões, texto)

    def grava(conexoes, msg):
        enviados.append((list(conexoes), msg))
        return len(conexoes)

    def limpa():
        rele.PARES.clear()
        rele.POR_ID.clear()
        rele.SALAS.clear()
        rele.SALAS[None] = set()
        rele.PROVA.clear()
        rele.SOLTOS.clear()
        rele.CALADOS.clear()
        del enviados[:]

    def par(id_, t):
        p = rele.Par(object(), t)
        rele.PARES[p.ws] = p
        rele.SALAS[None].add(p)
        p.id = id_
        rele.POR_ID.setdefault(id_, set()).add(p)
        return p

    def vozes(p, t):
        fora = []
        for conexoes, msg in enviados:
            if p.ws in conexoes:
                m = json.loads(msg)
                if m.get('t') == t:
                    fora.append(m)
        return fora

    def env(t_, de_, **k):
        k.update(t=t_, de=de_)
        return k

    # ------------------------------------------------ o anúncio com o cx
    check(R + 'o anúncio leva o cx da conexão (8 hex) depois da marca; cx torto fica de fora; sem cx, como antes',
          rele_ident.anuncio(False, 'marcaxyz12', 'a1b2c3d4') == '{"t":"rele","v":1,"ident":false,"n":"marcaxyz12","cx":"a1b2c3d4"}'
          and rele_ident.anuncio(True, None, 'X"y') == '{"t":"rele","v":1,"ident":true}'
          and rele_ident.anuncio(True) == '{"t":"rele","v":1,"ident":true}')
    check(R + 'o sussurro leva nome: entra no carimbo e no juiz (COM_NOME, JULGADOS)',
          'sussurro' in rele_ident.COM_NOME and 'sussurro' in rele_ident.JULGADOS)
    m = rele_ident.carimba({'t': 'sussurro', 'de': 'jana01', 'para': 'bia', 'nome': 'GM Ana', 'texto': 'oi', 'mestre': True}, None)
    check(R + 'sussurro com nome reservado, sem ser o Mestre: vira Aventureiro-na01 e o mestre que ele pôs cai (o texto fica)',
          m is not None and m.get('nome') == 'Aventureiro-na01' and 'mestre' not in m and m.get('texto') == 'oi', repr(m))
    m = rele_ident.carimba({'t': 'sussurro', 'de': 'jdono1', 'para': 'bia', 'nome': 'GM Dono', 'texto': 'oi'},
                           {'id': 1, 'nome': 'Dono', 'gm': True})
    check(R + 'o sussurro do Mestre conferido sai com mestre:true e o nome dele',
          m is not None and m.get('mestre') is True and m.get('nome') == 'GM Dono', repr(m))

    t = 1000.0
    orig = rele.manda_a_todos
    rele.manda_a_todos = grava
    try:
        limpa()
        a, b, c = par('ana', t), par('bia', t), par('caio', t)
        b2 = par('bia', t)                             # a segunda aba da Bia
        cxs = [p.cx for p in (a, b, c, b2)]
        check(R + 'cada conexão nasce com o seu cx: 8 hex (secrets), um diferente do outro',
              all(isinstance(x, str) and HEX8.fullmatch(x) for x in cxs) and len(set(cxs)) == 4, repr(cxs))
        sem = [rele._processa(a, env(tp, 'ana', acao='x'), t) for tp in rele.DIRIGIDOS]
        check(R + 'dirigido sem `para` cai (None), em todos os tipos — e ninguém ouve voz nenhuma',
              all(x is None for x in sem) and not enviados, repr(sem))
        d = rele._processa(a, env('grupo', 'ana', para='bia', acao='estado', dados={'gid': 'g'}), t)
        check(R + 'grupo para a Bia: as DUAS abas dela (sem paraCx), mais ninguém', d is not None and set(d) == {b, b2})
        d = rele._processa(a, env('grupo', 'ana', para='bia', paraCx=b2.cx, acao='estado'), t)
        check(R + 'com paraCx: só aquela aba', d == [b2])
        del enviados[:]
        d = rele._processa(a, env('batalha', 'ana', para='ninguem', acao='lance', dados={'bid': 'ana-x1y2:cistern:0:1', 'T': 3}), t)
        v = vozes(a, 'ausente')
        check(R + 'destino ausente: ninguém recebe ([]), e SÓ quem mandou ouve `ausente` com o tipo, a acao e o ref (o bid, cortado em 24)',
              d == [] and len(enviados) == 1 and v == [{'t': 'ausente', 'para': 'ninguem', 'paraCx': None, 'tipo': 'batalha',
                                                        'acao': 'lance', 'ref': 'ana-x1y2:cistern:0:1'[:24]}], repr(v))
        del enviados[:]
        d = rele._processa(a, env('grupo', 'ana', para='bia', paraCx='ffffffff', acao='estado', dados={'gid': 'ana-x1y2'}), t)
        v = vozes(a, 'ausente')
        check(R + 'paraCx de uma conexão que não existe: ninguém recebe, e o ausente diz qual (e o gid)',
              d == [] and len(v) == 1 and v[0].get('paraCx') == 'ffffffff' and v[0].get('ref') == 'ana-x1y2', repr(v))
        check(R + 'paraCx torto (número, ou mais de 16) derruba o envelope',
              rele._processa(a, env('grupo', 'ana', para='bia', paraCx=7, acao='x'), t) is None
              and rele._processa(a, env('grupo', 'ana', para='bia', paraCx='a' * 17, acao='x'), t) is None)
        del enviados[:]
        d1 = rele._processa(a, env('troca', 'ana', para='sumido', acao='convite'), t)
        d2 = rele._processa(a, env('guilda', 'ana', para='sumido', acao='convite'), t)
        check(R + 'troca e guilda para quem não está: ninguém ouve (antes: o servidor inteiro), e voltam como ausente',
              d1 == [] and d2 == [] and [x.get('tipo') for x in vozes(a, 'ausente')] == ['troca', 'guilda'])

        limpa()
        a, b = par('ana', t), par('bia', t)
        conv = [rele._processa(a, env('grupo', 'ana', para='bia', acao='convite', dados={'gid': 'g%d' % i}), t) for i in range(4)]
        desafio = rele._processa(a, env('duelo', 'ana', para='bia', acao='desafio', dados={'did': 'd'}), t)
        outro = rele._processa(a, env('grupo', 'ana', para='bia', acao='estado'), t)
        depois = rele._processa(a, env('duelo', 'ana', para='bia', acao='desafio'), t + 3.05)
        check(R + 'convite: 3 de uma vez, o 4º cai; o desafio de duelo paga o MESMO balde; o resto do grupo não; 3 s depois volta uma ficha',
              [x is not None for x in conv] == [True, True, True, False] and desafio is None and outro == [b] and depois == [b],
              repr((conv, desafio, outro, depois))[:200])
        limpa()
        a, b = par('ana', t), par('bia', t)
        s = [rele._processa(a, env('sussurro', 'ana', para='bia', nome='Ana', texto='oi %d' % i), t) for i in range(11)]
        check(R + 'sussurro: paga o balde do chat (rajada de 10: o 11º cai)', [x is not None for x in s] == [True] * 10 + [False])

        # ------------------------------------------------------- o vigia
        limpa()
        a = par('ana', t)
        alvos = [par('alvo%d' % i, t) for i in range(5)]
        rs = [rele._processa(a, env('vigia', 'ana', para=p.id), t) for p in alvos]
        check(R + 'vigia não é repassado ([]) e cada conexão vigia até 4: o 5º tira o mais antigo',
              rs == [[]] * 5 and a.vigio == alvos[1:] and a not in alvos[0].vigias and all(a in p.vigias for p in alvos[1:]))
        limpa()
        alvo = par('alvo', t)
        vs = [par('v%02d' % i, t) for i in range(17)]
        for v_ in vs:
            rele._processa(v_, env('vigia', v_.id, para='alvo'), t)
        check(R + 'e cada conexão tem até 16 vigias: o 17º não entra', len(alvo.vigias) == 16 and vs[16] not in alvo.vigias)
        del enviados[:]
        rele._processa(vs[0], env('vigia', vs[0].id, para='ninguem'), t)
        check(R + 'vigiar quem não está: a voz ausente (tipo vigia)', [m.get('tipo') for m in vozes(vs[0], 'ausente')] == ['vigia'])
        rele._processa(vs[1], env('vigia', vs[1].id, para='alvo', solta=True), t)
        check(R + 'solta:true tira da lista', vs[1] not in alvo.vigias and alvo not in vs[1].vigio)
        rele._sai(vs[2], t)
        check(R + 'o vigia que cai sai da lista do alvo', vs[2] not in alvo.vigias)
        del enviados[:]
        rele._sai(alvo, t)
        caidas = [(conexoes, json.loads(msg)) for conexoes, msg in enviados if json.loads(msg).get('t') == 'caiu']
        quem = set(p for conexoes, _ in caidas for p in vs if p.ws in conexoes)
        check(R + 'o alvo cai: cada vigia vivo ouve caiu {id, cx}, numa entrega só (14 = 16 menos o que soltou e o que caiu)',
              len(caidas) == 1 and caidas[0][1] == {'t': 'caiu', 'id': 'alvo', 'cx': alvo.cx} and quem == set(vs[3:16]) | {vs[0]},
              '%d entregas, %d vigias' % (len(caidas), len(quem)))
        limpa()
        a, b, b2 = par('ana', t), par('bia', t), par('bia', t)
        rele._processa(a, env('vigia', 'ana', para='bia', paraCx=b.cx), t)
        rele._processa(b, env('tchau', 'bia'), t)
        del enviados[:]
        rele._sai(b, t)
        cai = vozes(a, 'caiu')
        check(R + 'caiu vale com ou sem tchau, e mesmo com a outra aba viva (a queda é da CONEXÃO): a Ana ouve, e ninguém ganha tchau',
              cai == [{'t': 'caiu', 'id': 'bia', 'cx': b.cx}] and not [1 for _, msg in enviados if '"tchau"' in msg], repr(cai))

        # ------------------------------------------ achado 17: o id sem conta é do APARELHO
        def nova(t_, ipk=None):
            """Uma conexão que ainda não disse quem é (o id sai do 1º envelope, pelo _processa)."""
            p = rele.Par(object(), t_)
            rele.PARES[p.ws] = p
            rele.SALAS[None].add(p)
            p.ipk = ipk
            return p

        P1, P2 = 'segredo-do-aparelho-da-bia-0001', 'outro-aparelho-qualquer-00002'
        H1 = hashlib.sha256(P1.encode()).hexdigest()
        limpa()
        ana_ = nova(t)
        rele._processa(ana_, env('oi', 'ana', nome='Ana'), t)
        bia1 = nova(t)
        ok_p = rele._prova(bia1, env('prova', 'bia', prova=P1), t)
        rele._processa(bia1, env('oi', 'bia', nome='Bia'), t)
        imp = nova(t)
        r_sem = rele._processa(imp, env('oi', 'bia', nome='Bia'), t)
        imp2 = nova(t)
        rele._prova(imp2, env('prova', 'bia', prova=P2), t)
        r_outra = rele._processa(imp2, env('oi', 'bia', nome='Bia'), t)
        bia2 = nova(t)
        rele._prova(bia2, env('prova', 'bia', prova=P1), t)
        r_aba = rele._processa(bia2, env('pulso', 'bia', x=0, z=0), t)
        check(R + 'achado 17 · o id sem conta preso ao aparelho: outra conexão sem a prova, ou com a de outro aparelho, não entra no id (descartada, fora do POR_ID); a segunda aba do MESMO aparelho entra',
              ok_p and r_sem is None and r_outra is None and imp.id is None and imp2.id is None and r_aba is not None
              and rele.POR_ID.get('bia') == {bia1, bia2} and rele.PROVA.get('bia') == H1,
              repr((ok_p, r_sem, r_outra, imp.id, r_aba)))
        d_s = rele._processa(ana_, env('sussurro', 'ana', para='bia', nome='Ana', texto='só da Bia'), t)
        d_c = rele._processa(ana_, env('grupo', 'ana', para='bia', acao='convite', dados={'gid': 'ana-1', 'chave': 'k'}), t)
        d_v = rele._processa(ana_, env('grupo', 'ana', para='bia', acao='volta', dados={'gid': 'ana-1', 'prova': 'p'}), t)
        check(R + 'achado 17 · o sussurro, o convite e a `volta` da Ana ao id da Bia (sem paraCx) chegam só às conexões do aparelho dela — nunca ao impostor',
              all(d is not None and set(d) == {bia1, bia2} for d in (d_s, d_c, d_v)), repr((d_s, d_c, d_v)))
        r_imp = rele._processa(imp, env('grupo', 'bia', para='ana', acao='resposta', dados={'gid': 'ana-1', 'ok': True}), t)
        check(R + 'achado 17 · ...e o impostor não responde o convite por ela: o "sim" dele cai antes de chegar à Ana', r_imp is None and imp.id is None)
        rele._sai(bia1, t)
        rele._sai(bia2, t + 1)
        imp3 = nova(t + 3)
        r_volta = rele._processa(imp3, env('oi', 'bia', nome='Bia'), t + 3)
        bia3 = nova(t + 5)
        rele._prova(bia3, env('prova', 'bia', prova=P1), t + 5)
        r_bia3 = rele._processa(bia3, env('oi', 'bia', nome='Bia'), t + 5)
        check(R + 'achado 17 · a Bia caiu: nos segundos da volta o id segue preso ao aparelho dela — o impostor não entra, e ela volta',
              r_volta is None and imp3.id is None and r_bia3 is not None and bia3.id == 'bia', repr((r_volta, r_bia3)))
        rele._sai(bia3, t + 40)
        rele._poda_provas(t + 40 + rele.PROVA_MEMORIA_S - 1)
        r_cedo = rele._processa(nova(t + 41), env('oi', 'bia', nome='Bia'), t + 41)
        rele._poda_provas(t + 40 + rele.PROVA_MEMORIA_S + 1)
        r_tarde = rele._processa(nova(t + 700), env('oi', 'bia', nome='Bia'), t + 700)
        check(R + 'achado 17 · a memória do aparelho vale 10 min depois da última conexão, e depois o relé esquece (não cresce para sempre)',
              r_cedo is None and r_tarde is not None and 'bia' not in rele.SOLTOS, repr((r_cedo, r_tarde)))

        limpa()
        v1, v2 = nova(t), nova(t)
        ok_v = (rele._processa(v1, env('oi', 'velho', nome='V'), t) is not None
                and rele._processa(v2, env('pulso', 'velho', x=0, z=0), t) is not None)
        cs = nova(t)
        rele._prova(cs, env('prova', 'cris', prova=P2), t)
        rele._processa(cs, env('oi', 'cris', nome='Cris'), t)
        cc = nova(t)
        cc.conta = {'id': 7, 'nome': 'Cris', 'gm': False}
        r_cc = rele._processa(cc, env('oi', 'cris', nome='Cris'), t)
        check(R + 'achado 17 · o cliente antigo (sem prova) segue como antes: duas conexões sem prova no mesmo id entram; e a CONTA conferida não depende do aparelho (a conta decide, e tira quem não é ela)',
              ok_v and r_cc is not None and cc.id == 'cris' and cs.id is None, repr((ok_v, r_cc, cs.id)))
        limpa()
        lt = nova(t)
        rele._processa(lt, env('oi', 'tarde', nome='T'), t)      # o anúncio atrasou: a fila saiu antes da prova
        ok_lt = rele._prova(lt, env('prova', 'tarde', prova=P1), t)
        r4 = rele._processa(nova(t), env('oi', 'tarde', nome='T'), t)
        check(R + 'achado 17 · a prova que chega DEPOIS do primeiro envelope (anúncio atrasado) prende o id de quem está sozinho nele',
              ok_lt and rele.PROVA.get('tarde') == H1 and r4 is None, repr((ok_lt, r4)))
        check(R + 'achado 17 · a prova vale uma vez por conexão (a segunda cai) e a torta (curta) não vale',
              rele._prova(lt, env('prova', 'tarde', prova=P2), t) is False
              and rele._prova(nova(t), env('prova', 'x', prova='curta'), t) is False)

        # ------------------------------------------ achado 21: a caixa de entrada e o `cala`
        limpa()
        bia = nova(t)
        rele._processa(bia, env('oi', 'bia', nome='Bia'), t)
        rs = [rele._processa(nova(t, ipk='177.20.30.40'), env('sussurro', 'enx%02d' % i, para='bia', nome='E', texto='lixo %d' % i), t)
              for i in range(20)]
        entregues = sum(1 for r in rs if r)
        RS = int(rele.ENTRADA['sussurro'][1])
        check(R + 'achado 21 · 20 conexões novas do MESMO endereço, cada uma com um id novo, mandam um sussurro à Bia: passa só a rajada da caixa de entrada dela (%d, a do chat de UMA conexão), não 20' % RS,
              entregues == RS, '%d passaram' % entregues)
        r_mais = rele._processa(nova(t + 2.1, ipk='177.20.30.40'), env('sussurro', 'enx99', para='bia', nome='E', texto='x'), t + 2.1)
        r_outro = rele._processa(nova(t, ipk='201.1.2.3'), env('sussurro', 'amiga', para='bia', nome='Amiga', texto='oi'), t)
        check(R + 'achado 21 · ...depois, no ritmo do balde (1 por segundo) daquele endereço; e outro endereço tem a própria vez',
              r_mais == [bia] and r_outro == [bia], repr((r_mais, r_outro)))
        del enviados[:]
        r_freados = [rele._processa(nova(t + 2.2, ipk='177.20.30.40'), env('sussurro', 'enx9%d' % k, para='bia', nome='E', texto='x'), t + 2.2)
                     for k in range(4)]
        check(R + 'achado 21 · o que a caixa de entrada freia não vira `ausente` (quem insiste não fica sabendo)',
              r_freados[-1] == [] and not [1 for _, msg in enviados if '"ausente"' in msg], repr(r_freados))
        conv = [rele._processa(nova(t, ipk='177.20.30.50'), env(t_, 'cv%d' % i, para='bia', acao=ac, dados={'gid': 'g'}), t)
                for i, (t_, ac) in enumerate((('grupo', 'convite'), ('duelo', 'desafio'), ('troca', 'convite'), ('guilda', 'convite')))]
        est = rele._processa(nova(t, ipk='177.20.30.50'), env('grupo', 'cv9', para='bia', acao='estado', dados={'gid': 'g'}), t)
        check(R + 'achado 21 · convite de grupo, desafio de duelo, convite de troca e de guilda, de conexões novas do mesmo endereço, dividem a caixa de convites da Bia (3 de uma vez, o balde do convite); o resto do grupo não paga',
              [bool(x) for x in conv] == [True, True, True, False] and est == [bia], repr((conv, est)))

        limpa()
        bia = nova(t)
        rele._processa(bia, env('oi', 'bia', nome='Bia'), t)

        def sus(ip, n, quando, pref):
            return sum(1 for k in range(n)
                       if rele._processa(nova(quando, ipk=ip), env('sussurro', '%s%d' % (pref, k), para='bia', nome='E', texto='x'), quando))

        RS = int(rele.ENTRADA['sussurro'][1])
        cheias = [sus('177.9.0.%d' % (i + 1), RS + 2, t, 'r%d-' % i) for i in range(rele.ENTRADA_MAX)]
        novos = [sus('178.9.0.%d' % (i + 1), RS + 2, t, 'n%d-' % i) for i in range(3)]
        de_novo = sus('177.9.0.1', 3, t, 'v-')
        check(R + 'achado 21 · a caixa cheia de remetentes (64) não se esvazia com remetentes novos em rodízio: os novos dividem UM balde (uma rajada ao todo) e o primeiro endereço segue freado',
              all(x == RS for x in cheias) and sum(novos) == RS and de_novo == 0 and len(bia.entrada) <= rele.ENTRADA_MAX + 2,
              repr((cheias[:3], novos, de_novo, len(bia.entrada))))

        limpa()
        bia = nova(t)
        rele._processa(bia, env('oi', 'bia', nome='Bia'), t)
        x1 = nova(t, ipk='177.30.0.1')
        r1 = rele._processa(x1, env('sussurro', 'chato1', para='bia', nome='Chato', texto='oi'), t)
        rele._sai(x1, t)                                  # abre, manda e fecha: a conexão nem existe mais
        del enviados[:]
        rc = rele._processa(bia, env('cala', 'bia', para='chato1'), t + 1)
        r2 = rele._processa(nova(t + 2, ipk='177.30.0.1'), env('sussurro', 'chato2', para='bia', nome='Chato', texto='de novo'), t + 2)
        r3 = rele._processa(nova(t + 2, ipk='177.30.0.1'), env('grupo', 'chato3', para='bia', acao='convite', dados={'gid': 'c'}), t + 2)
        r4 = rele._processa(nova(t + 2, ipk='201.5.5.5'), env('sussurro', 'amiga', para='bia', nome='Amiga', texto='oi'), t + 2)
        check(R + 'achado 21 · o Silenciar segura quem abre conexão nova a cada envio: depois do `cala` (o chato1 já tinha fechado), o mesmo endereço com id novo não chega à Bia — nem sussurro, nem convite; outro endereço chega; e nada disso vira voz',
              r1 == [bia] and rc == [] and r2 == [] and r3 == [] and r4 == [bia] and not enviados, repr((r1, rc, r2, r3, r4, len(enviados))))
        rele._sai(bia, t + 3)
        bia_n = nova(t + 5)
        rele._processa(bia_n, env('oi', 'bia', nome='Bia'), t + 5)
        r5 = rele._processa(nova(t + 6, ipk='177.30.0.1'), env('sussurro', 'chato4', para='bia', nome='C', texto='x'), t + 6)
        check(R + 'achado 21 · o silêncio é da PESSOA, não da conexão: a Bia religa e o endereço segue calado', r5 == [], repr(r5))
        rele._processa(bia_n, env('cala', 'bia', para='chato1', solta=True), t + 7)
        r6 = rele._processa(nova(t + 8, ipk='177.30.0.1'), env('sussurro', 'chato5', para='bia', nome='C', texto='x'), t + 8)
        rele._processa(bia_n, env('cala', 'bia', para='chato5'), t + 9)
        tv = t + 9 + rele.CALA_S + 1
        r7 = rele._processa(nova(tv, ipk='177.30.0.1'), env('sussurro', 'chato6', para='bia', nome='C', texto='x'), tv)
        check(R + 'achado 21 · devolver a voz (solta) abre o endereço de novo; e o silêncio vence sozinho em 1 h (o IP muda de dono)',
              r6 == [bia_n] and r7 == [bia_n], repr((r6, r7)))
        limpa()
        bia = nova(t)
        rele._processa(bia, env('oi', 'bia', nome='Bia'), t)
        z1 = nova(t)
        rele._processa(z1, env('sussurro', 'zeca', para='bia', nome='Z', texto='x'), t)
        rele._processa(bia, env('cala', 'bia', para='zeca'), t)
        rz1 = rele._processa(z1, env('sussurro', 'zeca', para='bia', nome='Z', texto='x'), t)
        rz2 = rele._processa(nova(t), env('sussurro', 'zeca2', para='bia', nome='Z', texto='x'), t)
        check(R + 'achado 21 · sem endereço público (em casa, nas provas) o silêncio do relé é pelo id: o zeca calado não chega; outro id chega',
              rz1 == [] and rz2 == [bia], repr((rz1, rz2)))
    finally:
        rele.manda_a_todos = orig
        limpa()

    # ------------------------------------------------ o log do dirigido
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

    segredo = 'segredo-%06d' % random.randrange(10 ** 6)

    def explode(par_, m_, agora):
        raise RuntimeError('explodiu com ' + json.dumps(m_))   # até o erro cita o envelope

    registro = io.StringIO()
    alca = logging.StreamHandler(registro)
    original = rele._processa
    rele._processa = explode
    rele.log.addHandler(alca)
    try:
        asyncio.run(rele.trata(WsFalso([
            json.dumps({'t': 'sussurro', 'de': 'm1', 'para': 'x', 'nome': 'Nome' + segredo, 'texto': segredo}),
            json.dumps({'t': 'grupo', 'de': 'm1', 'para': 'x', 'acao': 'convite', 'dados': {'gid': segredo}}),
            json.dumps({'t': 'zz', 'de': 'm1', 'n': 1})])))
    finally:
        rele._processa = original
        rele.log.removeHandler(alca)
        limpa()
    txt = registro.getvalue()
    check(R + 'erro no _processa com um sussurro: o log diz só o tipo — nem o texto, nem o nome, nem a mensagem do erro',
          't=sussurro' in txt and segredo not in txt, txt[:200].replace('\n', ' | '))
    check(R + '...num dirigido, só o tipo, a acao e o tamanho (nem os dados)',
          "t=grupo acao='convite'" in txt and 'caracteres' in txt, txt[:300].replace('\n', ' | '))
    check(R + '(o tipo que não é dirigido segue com os 200 caracteres de sempre)', '"zz"' in txt)


# ================================================================ 1. o relé ao vivo
class Rele:
    """O relé DE VERDADE num subprocesso (prioridade baixa), numa porta livre;
    o log vai para um arquivo (num PIPE que ninguém lê o relé trava)."""

    def __init__(self, extra):
        self.porta = porta_livre()
        self.registro = tempfile.TemporaryFile()
        self.proc = subprocess.Popen([sys.executable, RELE, '--porta', str(self.porta), '--relatorio', '0'] + extra,
                                     stdout=subprocess.DEVNULL, stderr=self.registro, creationflags=BAIXA)
        self.abertos = []
        self.url = 'ws://127.0.0.1:%d' % self.porta
        self.ok = espera_porta(self.porta)

    def liga(self, marca=None):
        """Um cliente cru; devolve (ws, o anúncio aberto)."""
        ws = connect(self.url + ('/ws?n=' + marca if marca else ''), max_queue=None)
        self.abertos.append(ws)
        s = recebe(ws, 3)
        try:
            an = json.loads(s) if s else None
        except Exception:
            an = None
        return ws, an

    def log(self):
        self.registro.flush()
        self.registro.seek(0)
        return self.registro.read().decode('utf-8', 'replace')

    def fecha(self):
        for ws in self.abertos:
            try:
                ws.close()
            except Exception:
                pass
        self.proc.terminate()
        try:
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()
        texto = self.log()
        self.registro.close()
        return texto


def prova_ao_vivo():
    R = 'ao vivo: '
    rl = Rele([])
    texto_log = ''
    SEG = 'segredo-do-aparelho-da-lia-%06d' % random.randrange(10 ** 6)   # achado 17
    try:
        if not rl.ok:
            check(R + 'o relé subiu', False, rl.log()[-300:])
            return
        a, an_a = rl.liga('marcaana00001')
        b, an_b = rl.liga('marcabia00001')
        c, an_c = rl.liga()                                   # o intruso, sem marca (cliente antigo)
        cx = {k: (an or {}).get('cx') for k, an in (('a', an_a), ('b', an_b), ('c', an_c))}
        check(R + 'o anúncio conta a cada conexão o cx dela (8 hex; um por conexão, com marca ou sem)',
              all(isinstance(v, str) and HEX8.fullmatch(v) for v in cx.values()) and len(set(cx.values())) == 3
              and (an_a or {}).get('n') == 'marcaana00001' and 'n' not in (an_c or {}), repr((an_a, an_c)))
        for ws, id_ in ((a, 'ana'), (b, 'bia'), (c, 'caio')):
            manda(ws, t='oi', de=id_, nome=id_.capitalize(), classe='sumo', x=0, z=0, sala=None, v=2)
        time.sleep(0.5)
        for ws in (a, b, c):
            junta(ws, 0.2)

        manda(a, t='sussurro', de='ana', para='bia', nome='Ana', texto='só para a Bia · prova-1')
        rb, rc, ra = junta(b, 0.6), junta(c, 0.6), junta(a, 0.2)
        s = de(rb, 'sussurro', 'ana')
        check(R + 'sussurro da Ana para a Bia: só a Bia recebe, com o cx da Ana carimbado; o Caio não ouve nada em 0,6 s',
              len(s) == 1 and s[0].get('cx') == cx['a'] and s[0].get('texto') == 'só para a Bia · prova-1' and not rc and not ra,
              repr((s, rc, ra))[:300])

        manda(a, t='sussurro', de='ana', para='ninguem-aqui', nome='Ana', texto='perdido · prova-2')
        ra, rb, rc = junta(a, 0.6), junta(b, 0.3), junta(c, 0.3)
        v = voz(ra, 'ausente')
        check(R + 'sussurro a um id que não está: ninguém recebe (antes, o servidor inteiro — o Caio também), e a Ana ouve `ausente`',
              not rb and not rc and v == [{'t': 'ausente', 'para': 'ninguem-aqui', 'paraCx': None, 'tipo': 'sussurro',
                                           'acao': None, 'ref': None}], repr((v, rb, rc))[:300])

        manda(a, t='grupo', de='ana', acao='convite', dados={'gid': 'ana-semp'})
        manda(a, t='sussurro', de='ana', nome='Ana', texto='sem destino · prova-3')
        ra, rb, rc = junta(a, 0.5), junta(b, 0.3), junta(c, 0.3)
        check(R + 'dirigido sem `para` é descartado: ninguém ouve, nem voz', not ra and not rb and not rc, repr((ra, rb, rc))[:300])

        manda(a, t='sussurro', de='ana', para='bia', nome='GM Ana', mestre=True, texto='sou do suporte · prova-4')
        s = primeiro(junta(b, 1.0), 'sussurro', 'ana')
        check(R + 'o nome reservado no sussurro ("GM Ana") chega como Aventureiro-ana, e o `mestre` que ela pôs cai',
              s.get('nome') == 'Aventureiro-ana' and 'mestre' not in s and s.get('texto') == 'sou do suporte · prova-4', repr(s))

        d_, _ = rl.liga('marcadora0001')
        manda(d_, t='oi', de='dora', nome='Dora', classe='sumo', x=0, z=0, sala=None, v=2)
        time.sleep(0.3)
        for ws in (a, b, c):
            junta(ws, 0.1)
        for i in range(11):
            manda(d_, t='sussurro', de='dora', para='bia', nome='Dora', texto='rajada %d · prova-5' % i)
        n = len(de(junta(b, 0.6), 'sussurro', 'dora'))
        check(R + 'o 11º sussurro em rajada cai (o balde do chat: 10 de uma vez, 1 por segundo)', n == 10, '%d passaram' % n)

        manda(a, t='grupo', de='ana', para='bia', cx='deadbeef', acao='estado', dados={'gid': 'ana-ab12', 'v': 1})
        g = primeiro(junta(b, 0.6), 'grupo', 'ana')
        check(R + 'o relé carimba o cx de verdade da Ana por cima do forjado (deadbeef)',
              g.get('cx') == cx['a'] and g.get('dados') == {'gid': 'ana-ab12', 'v': 1}, repr(g))

        b2, an_b2 = rl.liga('marcabia00002')                  # a segunda aba da Bia
        cx_b2 = (an_b2 or {}).get('cx')
        manda(b2, t='pulso', de='bia', x=0, z=0, sala=None)
        time.sleep(0.3)
        for ws in (a, b, b2, c):
            junta(ws, 0.1)
        manda(a, t='grupo', de='ana', para='bia', paraCx=cx['b'], acao='estado', dados={'gid': 'ana-ab12', 'v': 2})
        r1, r2 = junta(b, 0.5), junta(b2, 0.3)
        manda(a, t='grupo', de='ana', para='bia', acao='estado', dados={'gid': 'ana-ab12', 'v': 3})
        r1b, r2b = junta(b, 0.5), junta(b2, 0.3)
        check(R + 'com `paraCx`, só aquela conexão da Bia recebe (a segunda aba, não); sem ele, as duas',
              len(de(r1, 'grupo', 'ana')) == 1 and not de(r2, 'grupo', 'ana')
              and len(de(r1b, 'grupo', 'ana')) == 1 and len(de(r2b, 'grupo', 'ana')) == 1,
              '%d %d %d %d' % (len(de(r1, 'grupo', 'ana')), len(de(r2, 'grupo', 'ana')), len(de(r1b, 'grupo', 'ana')),
                               len(de(r2b, 'grupo', 'ana'))))

        manda(a, t='vigia', de='ana', para='bia', paraCx=cx_b2)
        time.sleep(0.3)
        antes = junta(a, 0.2)
        t0 = time.time()
        b2.close()
        m = espera_voz(a, 'caiu', 2.0)
        dt = time.time() - t0
        rb, rc = junta(b, 0.2), junta(c, 0.2)
        check(R + 'a Ana vigia a segunda aba da Bia, que fecha: a Ana ouve caiu {id, cx} em menos de 1 s (e o vigia em si não chega a ninguém)',
              m == {'t': 'caiu', 'id': 'bia', 'cx': cx_b2} and dt < 1.0 and not voz(antes, 'ausente')
              and not de(rb, 'vigia', 'ana') and not de(rc, 'vigia', 'ana'), '%r em %.2f s' % (m, dt))

        manda(a, t='vigia', de='ana', para='ninguem-aqui')
        v = voz(junta(a, 0.5), 'ausente')
        check(R + 'vigiar quem não está: a voz ausente (tipo vigia)',
              len(v) == 1 and v[0].get('tipo') == 'vigia' and v[0].get('para') == 'ninguem-aqui', repr(v))

        e_, _ = rl.liga('marcaeva00001')
        manda(e_, t='oi', de='eva', nome='Eva', classe='sumo', x=0, z=0, sala=None, v=2)
        time.sleep(0.3)
        for ws in (a, b, c):
            junta(ws, 0.1)
        for i in range(4):
            manda(e_, t='grupo', de='eva', para='bia', acao='convite', dados={'gid': 'eva-%d' % i})
        manda(e_, t='duelo', de='eva', para='bia', acao='desafio', dados={'did': 'eva-000001'})
        manda(e_, t='grupo', de='eva', para='bia', acao='estado', dados={'gid': 'eva-0', 'v': 1})
        rb = junta(b, 0.6)
        conv = [x for x in de(rb, 'grupo', 'eva') if x.get('acao') == 'convite']
        est = [x for x in de(rb, 'grupo', 'eva') if x.get('acao') == 'estado']
        check(R + 'o 4º convite em 3 s cai (1 a cada 3 s, rajada de 3), e o desafio de duelo logo atrás também (o mesmo balde); o resto do grupo passa',
              len(conv) == 3 and not de(rb, 'duelo', 'eva') and len(est) == 1,
              '%d convites, %d desafios, %d estados' % (len(conv), len(de(rb, 'duelo', 'eva')), len(est)))

        manda(a, t='troca', de='ana', para='sumido', acao='convite', dados=None)
        ra, rb, rc = junta(a, 0.5), junta(b, 0.3), junta(c, 0.3)
        check(R + 'a troca para um id ausente não se espalha mais (antes: o servidor inteiro), e a Ana ouve ausente',
              not de(rb, 'troca', 'ana') and not de(rc, 'troca', 'ana') and [x.get('tipo') for x in voz(ra, 'ausente')] == ['troca'],
              repr((voz(ra, 'ausente'), rc))[:300])

        gr, _ = rl.liga('marcagrande01')
        manda(gr, t='pulso', de='grande', x=0, z=0, sala=None)
        time.sleep(0.2)
        junta(b, 0.1)
        try:
            gr.send(json.dumps({'t': 'batalha', 'de': 'grande', 'para': 'bia', 'acao': 'foto', 'dados': {'s': 'x' * 9200}}))
        except Exception:
            pass
        fim = time.time() + 3
        while gr.close_code is None and time.time() < fim:
            recebe(gr, 0.2)
        rb = junta(b, 0.3)
        check(R + 'um envelope de 9 KB fecha a conexão com 1009 (e não chega a ninguém) — o motivo do R.dirige fatiar',
              gr.close_code == 1009 and not de(rb, 'batalha', 'grande'), repr(gr.close_code))
        manda(a, t='sussurro', de='ana', para='bia', nome='Ana', texto='ainda aqui · prova-6')
        check(R + '...só aquela conexão: a Ana segue falando com a Bia', len(de(junta(b, 0.6), 'sussurro', 'ana')) == 1)

        # ---- achado 17 (ao vivo): o id sem conta preso ao aparelho
        l1, _ = rl.liga('marcalia00001')
        manda(l1, t='prova', de='lia', prova=SEG)
        manda(l1, t='oi', de='lia', nome='Lia', classe='sumo', x=0, z=0, sala=None, v=2)
        time.sleep(0.3)
        imp, _ = rl.liga('marcaimpost01')
        manda(imp, t='oi', de='lia', nome='Lia', classe='sumo', x=0, z=0, sala=None, v=2)
        manda(imp, t='pulso', de='lia', x=0, z=0, sala=None)
        time.sleep(0.3)
        for ws in (a, b, c, l1, imp):
            junta(ws, 0.1)
        manda(a, t='sussurro', de='ana', para='lia', nome='Ana', texto='para a Lia · prova-7')
        manda(a, t='grupo', de='ana', para='lia', acao='convite', dados={'gid': 'ana-lia1', 'chave': 'k'})
        rl1, rimp = junta(l1, 0.6), junta(imp, 0.4)
        manda(imp, t='grupo', de='lia', para='ana', acao='resposta', dados={'gid': 'ana-lia1', 'ok': True})
        ra = junta(a, 0.5)
        dir_imp = [m for m in rimp if isinstance(m, dict) and m.get('t') in ('sussurro', 'grupo', 'duelo', 'batalha')]
        check(R + 'achado 17 · um impostor com o id da Lia (conexão própria, sem a prova do aparelho dela) não ouve o sussurro nem o convite — só a Lia — e o "sim" dele não chega à Ana',
              len(de(rl1, 'sussurro', 'ana')) == 1 and len(de(rl1, 'grupo', 'ana')) == 1 and not dir_imp and not de(ra, 'grupo', 'lia'),
              repr((len(rl1), dir_imp[:2], de(ra, 'grupo', 'lia')))[:300])
        tudo = json.dumps([rl1, rimp, ra, junta(b, 0.2), junta(c, 0.2)], ensure_ascii=False)
        check(R + 'achado 17 · a prova do aparelho nunca é repassada (ninguém ouviu o segredo)', SEG not in tudo)

        # ---- achado 21 (ao vivo): conexões novas de um endereço público (o X-Forwarded-For que o Caddy repassa)
        def liga_ip(marca, ip):
            ws = connect(rl.url + '/ws?n=' + marca, max_queue=None, additional_headers={'X-Forwarded-For': ip})
            rl.abertos.append(ws)
            recebe(ws, 3)                                  # o anúncio
            return ws

        junta(b, 0.2)
        enx = [liga_ip('marcaenx%05d' % i, '177.40.0.9') for i in range(8)]   # ligadas antes (o limite de conexões novas deixa 10)
        for k in range(2):
            for i, w in enumerate(enx):
                manda(w, t='sussurro', de='enx%02d' % i, para='bia', nome='Enxurrada', texto='lixo %d.%d · prova-8' % (i, k))
        rb = junta(b, 0.8)
        n_enx = len([m for m in rb if isinstance(m, dict) and m.get('t') == 'sussurro' and str(m.get('de', '')).startswith('enx')])
        check(R + 'achado 21 · 8 conexões novas do mesmo endereço público, cada uma com um id novo, despejam 16 sussurros na Bia: chegam só os da rajada da caixa de entrada dela (10, a do chat de UMA conexão), não 16',
              10 <= n_enx <= 11, '%d chegaram' % n_enx)
        manda(b, t='cala', de='bia', para='enx03')
        time.sleep(2.3)                                    # uma ficha nova no balde de conexões do endereço (1 a cada 2 s)
        w2 = liga_ip('marcaenx99999', '177.40.0.9')
        manda(w2, t='sussurro', de='enx-novo', para='bia', nome='Enxurrada', texto='voltei · prova-9')
        manda(w2, t='grupo', de='enx-novo', para='bia', acao='convite', dados={'gid': 'enx-g'})
        amiga = liga_ip('marcaamiga001', '177.40.0.10')
        manda(amiga, t='sussurro', de='amiga', para='bia', nome='Amiga', texto='oi, Bia')
        rb = junta(b, 0.8)
        check(R + 'achado 21 · o Silenciar da Bia (o cala do enx03, que já tinha falado) segura o endereço: a conexão nova com id novo não chega nem com sussurro nem com convite; a amiga, de outro endereço, chega',
              not de(rb, 'sussurro', 'enx-novo') and not de(rb, 'grupo', 'enx-novo') and len(de(rb, 'sussurro', 'amiga')) == 1,
              repr([(m.get('t'), m.get('de')) for m in rb if isinstance(m, dict)])[:300])
        renx = [junta(w, 0.1) for w in enx] + [junta(w2, 0.1), junta(amiga, 0.1), junta(a, 0.1), junta(c, 0.1)]
        check(R + 'achado 21 · o `cala` não é repassado a ninguém (o calado não fica sabendo)',
              not any(de(r_, 'cala', 'bia') for r_ in renx))
    finally:
        texto_log = rl.fecha()
    vazou = [x for x in ('prova-%d' % i for i in range(1, 7)) if x in texto_log]
    check(R + 'nenhum texto de sussurro foi ao log do relé', bool(texto_log) and not vazou, repr(vazou))
    vazou2 = [x for x in ('prova-7', 'prova-8', 'prova-9', SEG) if x in texto_log]
    check(R + 'achados 17 e 21 · nem os sussurros novos nem o segredo do aparelho foram ao log do relé', bool(texto_log) and not vazou2,
          repr(vazou2))


# ================================================================ 2. o rede.js no navegador
class ReleAntigo:
    """O relé de antes de 10/09, de mentira: não se anuncia e repassa tudo a todos. Guarda o que recebeu."""

    def __init__(self):
        self.porta = porta_livre()
        self.recebidas = []
        self.conexoes = set()
        self.pronto = threading.Event()
        self.loop = self.parar = None

    def inicia(self):
        threading.Thread(target=lambda: asyncio.run(self._principal()), daemon=True).start()
        return self.pronto.wait(10)

    async def _principal(self):
        self.loop = asyncio.get_running_loop()
        self.parar = asyncio.Event()
        async with serve_ws(self._trata, '127.0.0.1', self.porta):
            self.pronto.set()
            await self.parar.wait()

    async def _trata(self, ws, *_):
        self.conexoes.add(ws)
        try:
            async for msg in ws:
                self.recebidas.append(msg)
                for o in list(self.conexoes):
                    if o is not ws:
                        try:
                            await o.send(msg)
                        except Exception:
                            pass
        except Exception:
            pass
        finally:
            self.conexoes.discard(ws)

    def para(self):
        if self.loop is not None:
            self.loop.call_soon_threadsafe(self.parar.set)


class Intruso(threading.Thread):
    """Um cliente cru na MESMA praça da Ana e da Bia (o Caio): se apresenta,
    responde ao oi com o eco (como o jogo faz), pulsa a cada 2 s e guarda tudo
    o que ouve, com a hora — nada dirigido a outra pessoa pode chegar a ele."""

    def __init__(self, url):
        threading.Thread.__init__(self, daemon=True)
        self.url = url
        self.caixa = []                                 # (time.time(), mensagem)
        self.parar = threading.Event()
        self.pronto = threading.Event()
        self.erro = None

    def run(self):
        try:
            ws = connect(self.url + '/ws?n=marcaintruso01', max_queue=None)
        except Exception as e:
            self.erro = repr(e)
            self.pronto.set()
            return
        cartao = {'de': 'caio', 'nome': 'Caio', 'classe': 'sumo', 'x': 5, 'z': 5, 'sala': None, 'v': 2}
        try:
            recebe(ws, 3)                               # o anúncio
            ws.send(json.dumps(dict(cartao, t='oi')))
            self.pronto.set()
            ult = time.time()
            while not self.parar.is_set() and ws.close_code is None:
                s = recebe(ws, 0.3)
                if s is not None:
                    try:
                        m = json.loads(s)
                    except Exception:
                        m = s
                    self.caixa.append((time.time(), m))
                    if isinstance(m, dict) and m.get('t') == 'oi' and m.get('de') and m.get('para') in (None, 'caio'):
                        ws.send(json.dumps(dict(cartao, t='eco', para=m['de'])))
                if time.time() - ult >= 2.0:
                    ws.send(json.dumps({'t': 'pulso', 'de': 'caio', 'x': 5, 'z': 5, 'sala': None}))
                    ult = time.time()
        except Exception as e:
            self.erro = repr(e)
        finally:
            self.pronto.set()
            try:
                ws.close()
            except Exception:
                pass


class Impostor(threading.Thread):
    """(achado 17) Um cliente cru com o id de OUTRA pessoa (a Bia), numa conexão
    própria e sem a prova do aparelho dela: diz oi e pulsa como ela e guarda
    tudo o que ouve. Com o id preso ao aparelho da Bia (o rede.js manda a
    prova depois do anúncio), o relé não o deixa entrar no id."""

    def __init__(self, url, id_):
        threading.Thread.__init__(self, daemon=True)
        self.url, self.id = url, id_
        self.caixa = []
        self.parar = threading.Event()
        self.pronto = threading.Event()
        self.erro = None

    def run(self):
        try:
            ws = connect(self.url + '/ws?n=marcaimpostor1', max_queue=None)
        except Exception as e:
            self.erro = repr(e)
            self.pronto.set()
            return
        try:
            recebe(ws, 3)                               # o anúncio
            cartao = {'de': self.id, 'nome': 'Bia', 'classe': 'sumo', 'x': 2, 'z': 2, 'sala': None, 'v': 2}
            ws.send(json.dumps(dict(cartao, t='oi')))
            ws.send(json.dumps({'t': 'pulso', 'de': self.id, 'x': 2, 'z': 2, 'sala': None}))
            self.pronto.set()
            ult = time.time()
            while not self.parar.is_set() and ws.close_code is None:
                s = recebe(ws, 0.3)
                if s is not None:
                    try:
                        self.caixa.append(json.loads(s))
                    except Exception:
                        self.caixa.append(s)
                if time.time() - ult >= 2.0:
                    ws.send(json.dumps({'t': 'pulso', 'de': self.id, 'x': 2, 'z': 2, 'sala': None}))
                    ult = time.time()
        except Exception as e:
            self.erro = repr(e)
        finally:
            self.pronto.set()
            try:
                ws.close()
            except Exception:
                pass


class Servidor(BaseHTTPRequestHandler):
    """As páginas da prova, o rede.js e o nomes.js do jogo (lidos a cada
    pedido), o /dorme que segura o relógio virtual do headless enquanto o
    WebSocket anda de verdade, e o /marca (a página diz ao Python a hora de
    cada passo)."""
    paginas = {}
    marcas = []
    rele_url = None                                     # achado 17: o relé do impostor
    impostor = None

    def _manda(self, codigo, corpo, tipo):
        self.send_response(codigo)
        self.send_header('Content-Type', tipo)
        self.send_header('Content-Length', str(len(corpo)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == '/dorme':
            try:
                ms = max(0, min(int(q.get('ms', ['40'])[0]), 1000))
            except ValueError:
                ms = 40
            time.sleep(ms / 1000.0)
            return self._manda(200, b'ok', 'text/plain')
        if u.path == '/marca':
            Servidor.marcas.append((q.get('e', ['?'])[0], time.time()))
            return self._manda(200, b'ok', 'text/plain')
        if u.path == '/impostor':
            if Servidor.impostor is None and Servidor.rele_url:
                imp = Impostor(Servidor.rele_url, q.get('id', ['bia'])[0])
                imp.start()
                imp.pronto.wait(8)
                Servidor.impostor = imp
            imp = Servidor.impostor
            corpo = json.dumps({'ok': bool(imp is not None and imp.pronto.is_set() and not imp.erro),
                                'erro': (imp.erro if imp is not None else 'sem relé')})
            return self._manda(200, corpo.encode('utf-8'), 'application/json')
        if u.path == '/impostor-fim':
            imp = Servidor.impostor
            if imp is None:
                return self._manda(200, b'{"ok":false}', 'application/json')
            time.sleep(0.6)
            imp.parar.set()
            caixa = list(imp.caixa)
            tipos = ('sussurro', 'grupo', 'duelo', 'batalha', 'troca', 'guilda', 'vigia', 'cala', 'prova')
            dirs = [m for m in caixa if isinstance(m, dict) and m.get('t') in tipos]
            corpo = json.dumps({'ok': True, 'ouvidas': len(caixa), 'dirigidos': len(dirs),
                                'segredo': any('segredo-do-aparelho-17' in json.dumps(m, ensure_ascii=False) for m in caixa),
                                'tipos': sorted({m.get('t') for m in caixa if isinstance(m, dict) and m.get('t')})},
                               ensure_ascii=False)
            return self._manda(200, corpo.encode('utf-8'), 'application/json')
        if u.path in Servidor.paginas:
            return self._manda(200, Servidor.paginas[u.path].encode('utf-8'), 'text/html; charset=utf-8')
        if u.path in ('/js/core/rede.js', '/js/core/nomes.js'):
            with open(os.path.join(RAIZ, *u.path.strip('/').split('/')), 'rb') as f:
                return self._manda(200, f.read(), 'application/javascript; charset=utf-8')
        return self._manda(404, b'nada', 'text/plain')

    def log_message(self, *a):
        pass


PAGINA_FILHO = """<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>um jogador</title></head><body>
<script src="/js/core/nomes.js"></script>
<script src="/js/core/rede.js"></script>
</body></html>
"""

PAGINA_PAI = r"""<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Os dirigidos da Rede (prova)</title></head>
<body>
<div id="summary">rodando…</div>
<div id="log"></div>
<div id="segredo"></div>
<iframe id="fa" style="width:8px;height:8px"></iframe>
<iframe id="fb" style="width:8px;height:8px"></iframe>
<iframe id="fc" style="width:8px;height:8px"></iframe>
<script>
(function () {
  'use strict';
  var log = document.getElementById('log');
  var falhas = 0, total = 0;
  function check(nome, ok, extra) {
    total++; if (!ok) falhas++;
    var d = document.createElement('div');
    d.textContent = (ok ? 'PASSOU · ' : 'FALHOU · ') + nome + (extra ? ' — ' + extra : '');
    log.appendChild(d);
  }
  function fim() {
    document.getElementById('summary').textContent = falhas ? ('FALHOU — ' + falhas + ' de ' + total)
                                                            : ('tudo passou (' + total + ')');
  }
  function arg(nome) {
    var m = new RegExp('[?&]' + nome + '=([^&]+)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : '';
  }
  var REDE = arg('rede'), ANTIGO = arg('antigo');
  function respira() { return fetch('/dorme?ms=40').then(function (r) { return r.text(); }, function () {}); }
  function marca(e) { return fetch('/marca?e=' + encodeURIComponent(e)).then(function (r) { return r.text(); }, function () {}); }
  function espera(cond, ms) {
    var voltas = Math.ceil(ms / 40);
    return new Promise(function (res) {
      (function volta() {
        var ok = false;
        try { ok = !!cond(); } catch (e) {}
        if (ok || voltas-- <= 0) return res(ok);
        respira().then(volta);
      })();
    });
  }
  // sem fetch pendente o relógio virtual pula direto para o próximo prazo
  function pausaVirtual(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function carrega(id, rede, quem) {
    return new Promise(function (res) {
      var f = document.getElementById(id);
      f.onload = function () { res(f.contentWindow); };
      f.src = '/filho.html?rede=' + rede + '&quem=' + quem;
    });
  }
  function acha(lista, fn) { for (var i = 0; i < lista.length; i++) if (fn(lista[i])) return lista[i]; return null; }
  function conta(lista, fn) { var n = 0; for (var i = 0; i < lista.length; i++) if (fn(lista[i])) n++; return n; }
  function j(o) { try { return JSON.stringify(o); } catch (e) { return String(o); } }
  function repete(s, n) { return new Array(n + 1).join(s); }
  // um "estado" de batalha de ~20 KB, com o que o JSON escapa (aspas), acento e emoji
  function estadoGrande(n) {
    var s = [], k = 0, tam = 0;
    while (tam < n) {
      var t = JSON.stringify({ uid: 'u' + k, nome: 'Guardião da Cisterna ç ' + k, hp: 37 + k, fx: '\ud83d\udd25',
                               dono: (k % 2) ? 'ana' : 'bia' });
      s.push(t); tam += t.length; k++;
    }
    return '[' + s.join(',') + ']';
  }
  function ev(lista, tipo, fn) { return acha(lista, function (e) { return e.tipo === tipo && (!fn || fn(e)); }); }

  var A, B, C, evA = [], evB = [], evC = [];
  Promise.all([carrega('fa', REDE, 'a'), carrega('fb', REDE, 'b'), carrega('fc', ANTIGO, 'c')]).then(function (ws) {
    A = ws[0].JOGO && ws[0].JOGO.Rede; B = ws[1].JOGO && ws[1].JOGO.Rede; C = ws[2].JOGO && ws[2].JOGO.Rede;
    check('os três iframes carregaram o rede.js (a mesma origem: a página mexe neles)', !!A && !!B && !!C && A !== B);
    // os ouvintes vêm ANTES do entrar (o R.ouvir sobrevive ao entrar/sair)
    A.ouvir('*', function (e) { evA.push(e); });
    B.ouvir('*', function (e) { evB.push(e); });
    C.ouvir('*', function (e) { evC.push(e); });
    check('R.entrar liga a Ana e a Bia',
          A.entrar({ id: 'ana', nome: 'Ana', classe: 'sumo', x: 1, z: 1 }) === true &&
          B.entrar({ id: 'bia', nome: 'Bia', classe: 'sumo', x: 2, z: 2 }) === true);
    return espera(function () {
      return A.privado() && B.privado() && !!acha(A.pares(), function (p) { return p.id === 'bia'; }) &&
             !!acha(B.pares(), function (p) { return p.id === 'ana'; });
    }, 10000);
  }).then(function (ok) {
    check('as duas se veem pelo relé (transporte ws) e ele é privado (anunciou com a marca e deu o cx)',
          ok && A.transporte() === 'ws' && B.transporte() === 'ws' && A.estadoConexao() === 'ws' && B.estadoConexao() === 'ws',
          A.transporte() + ' ' + A.estadoConexao() + ' ' + A.privado());
    var ca = A.meuCx(), cb = B.meuCx();
    check('cada uma tem o seu cx (8 hex), diferente', /^[0-9a-f]{8}$/.test(ca || '') && /^[0-9a-f]{8}$/.test(cb || '') && ca !== cb,
          ca + ' ' + cb);
    check('o evento cx chegou ao ouvinte pendurado antes do entrar', !!ev(evA, 'cx', function (e) { return e.cx === ca; }),
          j(evA.slice(0, 3)));
    check('R.nomeDe: o registro primeiro; sem registro, a sugestão limpa; a reservada vira Aventureiro',
          B.nomeDe('ana') === 'Ana' && B.nomeDe('zz9', 'Zé') === 'Zé' && /^Aventureiro/.test(B.nomeDe('zz9', 'GM Zé')),
          B.nomeDe('zz9', 'GM Zé'));
    check('R.sussurrar da Ana à Bia sai', A.sussurrar('bia', '  segredo-da-prova  ', { cx: B.meuCx() }) === true, A.ultimaRecusa());
    return espera(function () { return !!ev(evB, 'sussurro'); }, 6000);
  }).then(function () {
    var s = ev(evB, 'sussurro') || {};
    check('a Bia recebe o sussurro: de ana, com o nome do registro, o texto sem espaço nas pontas e o cx carimbado da Ana',
          s.de === 'ana' && s.nome === 'Ana' && s.texto === 'segredo-da-prova' && s.cx === A.meuCx() && s.mestre === false, j(s));
    check('sussurro vazio não sai (texto)', A.sussurrar('bia', '   ') === false && A.ultimaRecusa() === 'texto');
    A.sussurrar('ninguem-aqui', 'perdido-na-praca');
    return espera(function () { return !!ev(evA, 'ausente', function (e) { return e.tipoMsg === 'sussurro'; }); }, 6000);
  }).then(function (ok) {
    var a = ev(evA, 'ausente', function (e) { return e.tipoMsg === 'sussurro'; }) || {};
    check('sussurro a quem não está: a Ana ouve ausente (para, tipoMsg)', ok && a.para === 'ninguem-aqui', j(a));
    var um = [], dois = [];
    B.ouvir('grupo', function (e) { um.push(e); });
    var desliga = B.ouvir('grupo', function (e) { dois.push(e); });
    check('R.dirige de um estado de grupo sai', A.dirige('grupo', 'bia', 'estado', { gid: 'ana-p1q2', v: 1 }, { cx: B.meuCx() }) === true,
          A.ultimaRecusa());
    return espera(function () { return um.length > 0 && dois.length > 0; }, 6000).then(function () {
      check('R.ouvir: os dois ouvintes do mesmo tipo recebem; o evento traz de, cx, acao e dados',
            um.length === 1 && dois.length === 1 && um[0].de === 'ana' && um[0].cx === A.meuCx() &&
            um[0].acao === 'estado' && !!um[0].dados && um[0].dados.gid === 'ana-p1q2', j(um[0]));
      desliga();
      A.dirige('grupo', 'bia', 'estado', { gid: 'ana-p1q2', v: 2 });
      return espera(function () { return um.length > 1; }, 6000);
    }).then(function () {
      check('...e o desliga() tira só aquele ouvinte', um.length === 2 && dois.length === 1 && um[1].dados.v === 2,
            um.length + ' ' + dois.length);
    });
  }).then(function () {
    var grande = { bid: 'ana-p1q2:cistern:0:1', T: 8, estado: estadoGrande(20000) };
    var tam = JSON.stringify(grande).length;
    check('R.dirige de ' + Math.round(tam / 1024) + ' KB (acima do teto de ' + A.ENVELOPE_MAX + ') sai, fatiado',
          tam > 20000 && A.dirige('batalha', 'bia', 'foto', grande, { cx: B.meuCx() }) === true, A.ultimaRecusa());
    return espera(function () { return !!ev(evB, 'batalha', function (e) { return e.acao === 'foto'; }); }, 8000).then(function () {
      var fotos = evB.filter(function (e) { return e.tipo === 'batalha' && e.acao === 'foto'; });
      var partes = evB.filter(function (e) { return e.acao === 'parte'; });
      check('...e chega INTEIRO, como UM evento (nenhum pedaço vaza aos ouvintes), igual ao que saiu, com o cx da Ana',
            fotos.length === 1 && !partes.length && JSON.stringify(fotos[0].dados) === JSON.stringify(grande) && fotos[0].cx === A.meuCx(),
            fotos.length + ' fotos, ' + partes.length + ' pedaços');
      check('...sem remontagem pendente', B._fatiasPendentes() === 0);
      A._fatia(60);
      var dupla = { did: 'ana-123456', sal: '0123456789abcdef0123456789abcdef',
                    dupla: JSON.stringify([{ classId: 'sumo', level: 12, nome: 'Arqueira ç' }, { classId: 'bruxo', level: 11 }]) + repete(' ', 10) };
      check('com a fatia forçada a 60 bytes (R._fatia), um dado pequeno também vai em pedaços', A.dirige('duelo', 'bia', 'revela', dupla) === true,
            A.ultimaRecusa());
      return espera(function () { return !!ev(evB, 'duelo', function (e) { return e.acao === 'revela'; }); }, 8000).then(function () {
        var r = ev(evB, 'duelo', function (e) { return e.acao === 'revela'; }) || {};
        check('...e chega inteiro, um evento só', JSON.stringify(r.dados) === JSON.stringify(dupla) &&
              conta(evB, function (e) { return e.tipo === 'duelo' && e.acao === 'revela'; }) === 1, j(r).slice(0, 200));
        check('mais de 16 pedaços: recusa (grande), e nada sai',
              A.dirige('batalha', 'bia', 'foto', { s: repete('x', 3000) }) === false && A.ultimaRecusa() === 'grande');
        A._fatia(5500);
      });
    });
  }).then(function () {
    check('o cinto: um envelope acima do teto nem sai (a troca de 7 KB)', A.trocaManda('bia', 'oferta', { itens: [], lixo: repete('x', 7000) }) === false);
    A.dirige('grupo', 'bia', 'estado', { gid: 'ana-p1q2', v: 3 });
    return espera(function () { return !!ev(evB, 'grupo', function (e) { return e.dados && e.dados.v === 3; }); }, 6000).then(function (ok) {
      check('...e a conexão segue viva (o que vem depois chega)', ok && A.estadoConexao() === 'ws');
    });
  }).then(function () {
    var cx0 = B.meuCx();
    return marca('antes-sala').then(function () {
      check('R.entrar de novo (o mesmo id) com outra sala devolve true',
            B.entrar({ id: 'bia', nome: 'Bia', classe: 'sumo', x: 2, z: 2, sala: 'garden:1' }) === true);
      return espera(function () { return !!ev(evA, 'mudouSala', function (e) { return e.id === 'bia' && e.sala === 'garden:1'; }); }, 6000);
    }).then(function (ok) {
      check('a Ana vê a Bia mudar de sala (mudouSala), sem ninguém sair', ok && !ev(evA, 'saiu', function (e) { return e.id === 'bia'; }));
      check('...e é a MESMA conexão: o cx da Bia não mudou', B.meuCx() === cx0 && B.minhaSala() === 'garden:1', cx0 + ' ' + B.meuCx());
      B.entrar({ id: 'bia', nome: 'Bia Nova', classe: 'sumo', x: 2, z: 2, sala: null });
      return espera(function () {
        var p = acha(A.pares(), function (q) { return q.id === 'bia'; });
        return !!p && p.nome === 'Bia Nova' && p.sala === null;
      }, 6000);
    }).then(function (ok) {
      check('de volta à praça com outro nome: a Ana vê o nome novo (a re-apresentação), ainda sem tchau e na mesma conexão',
            ok && B.meuCx() === cx0 && !ev(evA, 'saiu', function (e) { return e.id === 'bia'; }));
      return marca('depois-sala');
    });
  }).then(function () {
    var cxB = B.meuCx(), cxA = A.meuCx();
    check('R.vigia: a Ana vigia a conexão da Bia, e a Bia a da Ana', A.vigia('bia', cxB) === true && B.vigia('ana', cxA) === true);
    // 11/09 (revisão): na volta, o que o ouvinte do `religou` manda (a `volta` do
    // grupo, com o cx novo) sai ANTES do que ficou na fila durante a queda —
    // senão o outro recebia os lances guardados antes de saber do cx novo
    var desligaOrdem = B.ouvir('religou', function () {
      desligaOrdem();
      B.dirige('grupo', 'ana', 'estado', { gid: 'ordem', v: 'primeiro' }, { cx: A.meuCx() });
    });
    return espera(function () { return false; }, 400).then(function () {
      check('R._derruba() fecha a conexão da Bia (sem tchau)', B._derruba() === true);
      return espera(function () { return !!ev(evA, 'caiu', function (e) { return e.id === 'bia'; }); }, 4000);
    }).then(function (ok) {
      var c = ev(evA, 'caiu', function (e) { return e.id === 'bia'; }) || {};
      check('a Ana ouve caiu {id, cx} da conexão vigiada', ok && c.cx === cxB, j(c));
      check('a Bia fica religando: sem cx e sem privado', B.estadoConexao() === 'religando' && B.meuCx() === null && B.privado() === false,
            B.estadoConexao() + ' ' + B.meuCx());
      check('com a Bia fora do ar, o dirigido dela espera na fila (sai ao religar)',
            B.dirige('grupo', 'ana', 'estado', { gid: 'ordem', v: 'velho' }, { cx: A.meuCx() }) === true, B.ultimaRecusa());
      return pausaVirtual(6000).then(function () {
        return espera(function () { return !!ev(evB, 'religou') && B.privado(); }, 10000);
      });
    }).then(function (ok) {
      var r = ev(evB, 'religou') || {};
      check('a Bia religa sozinha (3 a 5,5 s) e ouve religou com um cx NOVO', ok && /^[0-9a-f]{8}$/.test(r.cx || '') && r.cx !== cxB &&
            B.meuCx() === r.cx, j(r));
      return espera(function () {
        return conta(evA, function (e) { return e.tipo === 'grupo' && e.dados && e.dados.gid === 'ordem'; }) >= 2;
      }, 6000);
    }).then(function () {
      var ordem = evA.filter(function (e) { return e.tipo === 'grupo' && e.dados && e.dados.gid === 'ordem'; })
                     .map(function (e) { return e.dados.v; });
      check('na volta, o que o ouvinte do `religou` manda chega ANTES do que esperava na fila (a `volta` antes dos lances guardados)',
            ordem.join(',') === 'primeiro,velho', ordem.join(','));
      return espera(function () { return false; }, 400);
    }).then(function () {
      check('R._derruba() na Ana', A._derruba() === true);
      return espera(function () { return !!ev(evB, 'caiu', function (e) { return e.id === 'ana'; }); }, 4000);
    }).then(function (ok) {
      var c = ev(evB, 'caiu', function (e) { return e.id === 'ana'; }) || {};
      check('o vigia da Bia voltou SOZINHO depois do religou: a queda da Ana chega a ela', ok && c.cx === cxA, j(c));
      return pausaVirtual(6000).then(function () { return espera(function () { return A.privado() && B.privado(); }, 10000); });
    }).then(function (ok) {
      check('as duas de volta', ok);
      var n0 = conta(evB, function (e) { return e.tipo === 'grupo'; });
      A.dirige('grupo', 'bia', 'estado', { gid: 'ana-p1q2', v: 4 }, { cx: B.meuCx() });
      return espera(function () { return conta(evB, function (e) { return e.tipo === 'grupo'; }) > n0; }, 6000).then(function (ok2) {
        var g = evB.filter(function (e) { return e.tipo === 'grupo'; }).pop() || {};
        check('depois da volta, o dirigido chega com o cx NOVO da Ana, pelo paraCx NOVO da Bia', ok2 && g.cx === A.meuCx() && !!g.dados && g.dados.v === 4,
              j(g));
        check('R.visto: o último envelope da Ana na Bia é recente; quem nunca falou, 0', B.visto('ana') > 0 && B.visto('ninguem') === 0);
      });
    });
  }).then(function () {
    // 11/09 (revisão): O BALDE DE SAÍDA. Uma rajada de 60 dirigidos: sai no
    // máximo a rajada do balde (36, abaixo dos 40 do relé) na hora, o resto
    // espera na fila e sai no ritmo — o relé nunca descarta (200 descartes em
    // 10 s DESLIGAM a conexão, e qualquer um podia provocar isso com pedidos)
    var wA = document.getElementById('fa').contentWindow, envios = 0;
    var mandaOrig = wA.WebSocket.prototype.send;
    wA.WebSocket.prototype.send = function (d) { envios++; return mandaOrig.call(this, d); };
    var n0 = conta(evB, function (e) { return e.tipo === 'grupo' && e.dados && e.dados.gid === 'balde'; });
    var e0 = envios, i;
    for (i = 0; i < 60; i++) A.dirige('grupo', 'bia', 'estado', { gid: 'balde', v: i }, { cx: B.meuCx() });
    var naHora = envios - e0;
    check('a rajada de 60 dirigidos: na hora sai no máximo a rajada do balde (36); o resto espera na fila',
          naHora >= 1 && naHora <= A.RAJADA_SAIDA, naHora + ' na hora');
    return espera(function () { return envios - e0 >= 60; }, 15000).then(function (ok) {
      check('...e a fila sai toda, no ritmo do balde', ok, (envios - e0) + ' de 60');
      return espera(function () {
        return conta(evB, function (e) { return e.tipo === 'grupo' && e.dados && e.dados.gid === 'balde'; }) - n0 >= 36;
      }, 6000);
    }).then(function () {
      var vs = evB.filter(function (e) { return e.tipo === 'grupo' && e.dados && e.dados.gid === 'balde'; }).map(function (e) { return e.dados.v; });
      var emOrdem = true;
      for (var k = 1; k < vs.length; k++) if (vs[k] <= vs[k - 1]) emOrdem = false;
      check('...na ordem em que saíram (a fila não embaralha)', vs.length >= 36 && emOrdem, vs.length + ' chegaram');
      wA.WebSocket.prototype.send = mandaOrig;
    });
  }).then(function () {
    // achado 17: um impostor cru com o id da Bia (conexão própria, sem a prova do aparelho dela)
    var wB = document.getElementById('fb').contentWindow, seg = '';
    try { seg = wB.localStorage.getItem('soterra-rede-prova-v1') || ''; } catch (e) { seg = ''; }
    document.getElementById('segredo').textContent = seg;
    check('achado 17 · o navegador guardou o segredo do aparelho (32 hex, localStorage)', /^[0-9a-f]{32}$/.test(seg), seg.length + ' caracteres');
    return fetch('/impostor?id=bia').then(function (r) { return r.json(); }, function () { return {}; }).then(function (r) {
      check('achado 17 · o impostor com o id da Bia ligou ao relé e disse oi como ela', !!r && r.ok === true, j(r));
      return espera(function () { return false; }, 600);
    }).then(function () {
      check('achado 17 · R.sussurrar da Ana à Bia SEM cx (vai a toda conexão do id)', A.sussurrar('bia', 'segredo-do-aparelho-17') === true,
            A.ultimaRecusa());
      A.dirige('grupo', 'bia', 'convite', { gid: 'ana-ap17', chave: 'k17' });
      return espera(function () {
        return !!ev(evB, 'sussurro', function (e) { return e.texto === 'segredo-do-aparelho-17'; }) &&
               !!ev(evB, 'grupo', function (e) { return e.acao === 'convite' && !!e.dados && e.dados.gid === 'ana-ap17'; });
      }, 6000);
    }).then(function (ok) {
      return fetch('/impostor-fim').then(function (r) { return r.json(); }, function () { return null; }).then(function (r) {
        r = r || {};
        check('achado 17 · a Bia recebe o sussurro e o convite; o impostor com o id dela não ouve nenhum dirigido (o rede.js mandou a prova do aparelho e o relé prendeu o id)',
              ok && r.ok === true && (r.dirigidos || 0) === 0 && !r.segredo, j(r).slice(0, 300));
      });
    });
  }).then(function () {
    check('achado 21 · R.cala pelo relé novo sai (e solta também)', A.cala('caio') === true && A.cala('caio', true) === true);
    return espera(function () { return false; }, 400);
  }).then(function () {
    check('R.entrar liga a Cora ao relé antigo', C.entrar({ id: 'cora', nome: 'Cora', classe: 'sumo', x: 0, z: 0 }) === true);
    // o socket abre em tempo REAL (a espera segura o relógio virtual); só depois
    // de aberto o prazo do anúncio corre — e aí o relógio virtual pode pular
    function ateLigar(n) {
      if (C.estadoConexao() === 'ws' || n <= 0) return Promise.resolve(C.estadoConexao() === 'ws');
      return espera(function () { return false; }, 400).then(function () {
        return pausaVirtual(C.ANUNCIO_MS + 500);
      }).then(function () {
        return espera(function () { return C.estadoConexao() === 'ws'; }, 800);
      }).then(function () { return ateLigar(n - 1); });
    }
    return ateLigar(4).then(function (ok) {
      check('pelo relé antigo (que não se anuncia) a Rede liga, mas NÃO é privada e não tem cx',
            ok && C.transporte() === 'ws' && C.privado() === false && C.meuCx() === null, C.estadoConexao());
      check('R.sussurrar pelo relé antigo devolve false (privado)', C.sussurrar('ana', 'oi') === false && C.ultimaRecusa() === 'privado');
      check('R.dirige pelo relé antigo devolve false (rele-antigo: ele espalharia)',
            C.dirige('grupo', 'ana', 'convite', { gid: 'cora-1' }) === false && C.ultimaRecusa() === 'rele-antigo');
      check('R.vigia pelo relé antigo devolve false', C.vigia('ana', 'deadbeef') === false);
      check('achado 21 · R.cala pelo relé antigo devolve false (ele entregaria o cala ao próprio calado)', C.cala('ana') === false);
    });
  }).catch(function (e) {
    check('a corrente não estoura', false, e && (e.stack || e.message || e));
  }).then(function () {
    try { A.sair(); B.sair(); C.sair(); } catch (e) {}
    fim();
  });
})();
</script>
</body>
</html>
"""


def limita_nucleos():
    """O dono usa a máquina: este processo (e o Chrome, que herda a afinidade)
    fica em no máximo um quarto dos núcleos lógicos, com piso de 2."""
    try:
        import ctypes
        n = os.cpu_count() or 2
        k = max(2, n // 4)
        mascara = 0
        for i in range(max(0, n - k), n):
            mascara |= 1 << i
        k32 = ctypes.windll.kernel32
        k32.SetProcessAffinityMask(k32.GetCurrentProcess(), ctypes.c_size_t(mascara))
    except Exception:
        pass


def roda_chrome(url, saida, baixa=None, budget=120000):
    """Um Chrome headless por vez, em prioridade baixa e perfil descartável. Com
    `baixa` (--chrome-baixa CAMINHO, ou SOTERRA_CHROME_BAIXA), quem abre o
    Chrome é esse lançador; sem ele, o daqui faz o mesmo."""
    if baixa:
        subprocess.run([sys.executable, baixa, url, saida, str(budget)], capture_output=True, timeout=900,
                       creationflags=BAIXA)
    else:
        chrome = next((c for c in CHROMES if os.path.exists(c)), None)
        if not chrome:
            return None
        limita_nucleos()
        perfil = tempfile.mkdtemp(prefix='rede-dois-chrome-')
        try:
            with open(saida, 'wb') as f:
                subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                                '--user-data-dir=' + perfil, '--virtual-time-budget=%d' % budget, '--dump-dom', url],
                               stdout=f, stderr=subprocess.DEVNULL, timeout=900, creationflags=BAIXA)
        finally:
            shutil.rmtree(perfil, ignore_errors=True)
    try:
        return open(saida, encoding='utf-8', errors='replace').read()
    except OSError:
        return ''


def le_pagina(R, dom):
    """As linhas PASSOU/FALHOU da página viram checks daqui."""
    m = re.search(r'id="summary"[^>]*>([^<]*)<', dom or '')
    resumo = html.unescape(m.group(1)) if m else '(sem página)'
    linhas = [html.unescape(l) for l in re.findall(r'<div>((?:PASSOU|FALHOU) · [^<]*)</div>', dom or '')]
    for l in linhas:
        ok = l.startswith('PASSOU')
        corpo = l.split(' · ', 1)[1]
        nome, _, extra = corpo.partition(' — ')
        check(R + nome, ok, extra)
    check(R + 'a página chegou ao fim (%s)' % resumo, bool(linhas) and not resumo.startswith('rodando'))


def prova_no_navegador(argumentos):
    R = 'navegador: '
    baixa = os.environ.get('SOTERRA_CHROME_BAIXA')
    if '--chrome-baixa' in argumentos:
        i = argumentos.index('--chrome-baixa')
        baixa = argumentos[i + 1] if i + 1 < len(argumentos) else None
    if not baixa and not any(os.path.exists(c) for c in CHROMES):
        check(R + 'há um Chrome para a prova do rede.js (ou rode com --sem-navegador)', False)
        return
    pasta = tempfile.mkdtemp(prefix='rede-dois-nav-')
    rl = antigo = servidor = intruso = None
    texto_log = ''
    segredo_nav = None                                   # achado 17: o segredo do aparelho da página (lido do DOM)
    try:
        rl = Rele([])
        antigo = ReleAntigo()
        if not (rl.ok and antigo.inicia()):
            check(R + 'o relé e o relé antigo de mentira subiram', False)
            return
        Servidor.paginas = {'/pai.html': PAGINA_PAI, '/filho.html': PAGINA_FILHO}
        Servidor.marcas = []
        Servidor.rele_url = rl.url
        Servidor.impostor = None
        servidor = ThreadingHTTPServer(('127.0.0.1', 0), Servidor)
        threading.Thread(target=servidor.serve_forever, daemon=True).start()
        intruso = Intruso(rl.url)
        intruso.start()
        if not intruso.pronto.wait(10) or intruso.erro:
            check(R + 'o intruso ligou ao relé', False, intruso.erro or '')
            return
        time.sleep(0.3)
        # ':' e '/' sem escapar: o urlDoRele do rede.js procura 'rede=ws://' ao pé da letra
        q = urlencode({'rede': rl.url, 'antigo': 'ws://127.0.0.1:%d' % antigo.porta}, safe=':/')
        url = 'http://127.0.0.1:%d/pai.html?%s' % (servidor.server_address[1], q)
        dom = roda_chrome(url, os.path.join(pasta, 'pai.dom.html'), baixa)
        le_pagina(R, dom)
        m_seg = re.search(r'id="segredo">([0-9a-f]{32})<', dom or '')
        segredo_nav = m_seg.group(1) if m_seg else None
    finally:
        if Servidor.impostor is not None:
            Servidor.impostor.parar.set()
            Servidor.impostor.join(3)
        if intruso is not None:
            intruso.parar.set()
            intruso.join(5)
        if rl is not None:
            texto_log = rl.fecha()
        if antigo is not None:
            antigo.para()
        if servidor is not None:
            servidor.shutdown()
        shutil.rmtree(pasta, ignore_errors=True)
    if intruso is None or antigo is None:
        return
    caixa = list(intruso.caixa)
    dirigidos = [m for _, m in caixa if isinstance(m, dict) and m.get('t') in ('sussurro', 'grupo', 'duelo', 'batalha', 'troca', 'vigia',
                                                                                  'cala', 'prova')]
    alheias = [m for _, m in caixa if isinstance(m, dict) and m.get('t') in ('ausente', 'caiu')]
    delas = [m for _, m in caixa if isinstance(m, dict) and m.get('de') in ('ana', 'bia')]
    check(R + 'o intruso, na mesma praça, viu a Ana e a Bia (%d envelopes delas) — e nenhum dirigido: nem o sussurro, nem o grupo, nem a foto de 20 KB' % len(delas),
          bool(delas) and not dirigidos, repr(dirigidos[:2])[:300])
    check(R + '...nem a voz que era de outro (ausente, caiu)', not alheias, repr(alheias[:2])[:200])
    marcas = dict(Servidor.marcas)
    ta, td = marcas.get('antes-sala'), marcas.get('depois-sala')
    tchaus = [m for t_, m in caixa if isinstance(m, dict) and m.get('t') == 'tchau' and m.get('de') == 'bia'
              and ta is not None and td is not None and ta <= t_ <= td]
    jardim = [m for t_, m in caixa if isinstance(m, dict) and m.get('t') == 'oi' and m.get('de') == 'bia' and m.get('sala') == 'garden:1']
    check(R + 'R.entrar com outra sala NÃO manda tchau: entre as marcas o intruso não ouviu tchau da Bia — e ouviu a mudança (o oi dela já com a sala nova: a mesma conexão avisando as duas salas)',
          ta is not None and td is not None and not tchaus and bool(jardim), 'marcas %r, %d tchaus, %d oi do jardim' % (sorted(marcas), len(tchaus), len(jardim)))
    check(R + 'o texto do sussurro nunca foi ao log do relé',
          bool(texto_log) and 'segredo-da-prova' not in texto_log and 'perdido-na-praca' not in texto_log)
    da_cora = [x for x in antigo.recebidas if '"de":"cora"' in x]
    novos = [x for x in da_cora if any(('"t":"%s"' % t) in x for t in ('sussurro', 'grupo', 'duelo', 'batalha', 'vigia', 'cala', 'prova'))]
    check(R + 'o relé antigo recebeu a Cora (%d envelopes) e nenhum dirigido novo dela (o R.dirige e o R.sussurrar recusaram)' % len(da_cora),
          bool(da_cora) and not novos, repr(novos[:1]))
    ouvidos_txt = json.dumps([m for _, m in caixa], ensure_ascii=False)
    check(R + 'achado 17 · o segredo do aparelho da página nunca saiu do relé novo: nem o intruso, nem o log o viram, e o relé antigo nunca o recebeu',
          bool(segredo_nav) and segredo_nav not in ouvidos_txt and segredo_nav not in texto_log
          and not any(segredo_nav in x for x in antigo.recebidas), repr(segredo_nav))


if __name__ == '__main__':
    argumentos = sys.argv[1:]
    if '--so-navegador' not in argumentos:
        prova_do_modulo()
        prova_ao_vivo()
    if '--sem-navegador' in argumentos:
        print('PULOU · navegador: --sem-navegador (o js/core/rede.js NÃO foi provado nesta rodada)')
    else:
        prova_no_navegador(argumentos)
    falhas = RESULTADOS.count(False)
    print('RESUMO: ' + ('tudo passou (%d)' % len(RESULTADOS) if not falhas else 'FALHOU — %d de %d' % (falhas, len(RESULTADOS))))
    sys.exit(1 if falhas else 0)
