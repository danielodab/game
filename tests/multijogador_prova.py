#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A prova de PONTA A PONTA do multijogador: dois jogadores de verdade pelo relé
de verdade.

    python tests/multijogador_prova.py [--chrome-baixa CAMINHO] [--budget MS]
                                       [--saida PASTA] [--modo tudo|grupo|duelo|social|conexao]

PEDIDO DO DONO (10/09): "ao clicar em um personagem (outro jogador) deve ter
como mandar a mensagem particular pra ele, chamar para grupo, chamar para
guilda, desafiar para duelo (que vai para um mapa aleatorio dos existentes). e
quando estiver em grupo, quem chama é o lider, podendo transferir a liderança
[...] grupo de no maximo 2 jogadores. e quando forem para as salas, devem
entrar juntos na batalha."

O que sobe (tudo em prioridade baixa; o dono usa a máquina):
  - o relé DE VERDADE (servidor/rele.py) numa porta livre, com o log num arquivo;
  - um servidorzinho HTTP da raiz do projeto (as páginas do jogo), que também
    "dorme" por pedido (/dorme: o fetch pendente segura o relógio virtual do
    headless enquanto o WebSocket anda de verdade) e recebe os sinais da página
    (/sinal: o impostor);
  - uma INTRUSA crua (Python) na praça, que ouve tudo o que o relé lhe entregar;
  - UM Chrome headless (por --chrome-baixa, ou pelo lançador daqui com as mesmas
    travas: prioridade baixa, núcleos limitados, perfil descartável) com a
    página de fora: DOIS tests/coop_cliente.html (Ana e Bia), cada um no seu
    iframe, cada um com a sua conta, ligados ao relé por ?rede=ws://.

O roteiro (a página de fora é "a mão" dos dois jogadores):
  1. conexão: os dois pelo ws, com o cx do relé, e um vendo o outro;
  2. mensagem particular: só a Bia recebe (e a intrusa não ouve nada); para
     quem não está ligado, a voz "ausente";
  3. grupo: convite, aceite, os dois lados iguais; grupo cheio recusa o 3º;
  4. liderança: passa para a Bia e volta; quem não lidera não desce;
  5. a descida: os dois JUNTOS na antessala, a porta da líder acende, a sala 1
     inteira pelo WebSocket com o piloto automático (cada um joga o SEU herói
     pela porta local): os lances de cada um aparecem no outro e o hash bate em
     todo turno e no fim; um impostor com o id da Ana tenta mandar "sair",
     "lider", "estado", "ia" e um lance à Bia (conexão própria, cx dele);
  6. sala 2, a queda LONGA (a rede da Bia fica fora mais que a carência): o
     "caiu" na hora, o herói dela na IA só depois dos 15 s, a volta com cx novo
     ANTES do fim da sala, a foto, e a descida que continua;
  7. sala 3, a queda CURTA (religa sozinha em 3-5,5 s): o herói volta a ela na
     sala seguinte, fica com ela na queda e até o fim da sala;
  8. cisterna 1: o relógio de parede encerra o turno de quem não joga (30 s),
     quem espera vê o prazo, 3 PV estragados num motor são pegos pelo hash e a
     foto conserta, e a fusão entre jogadores pedida e aceita;
  9. cisterna 2, a queda SEM VOLTA: a descida acaba e o grupo se desfaz;
 10. o impostor na praça: "descer", "lider" e "sair" forjados com o id da Ana;
 11. o duelo: desafio, a dupla às cegas, os dois no MESMO mapa (sorteado entre
     os calabouços abertos), a batalha até o fim e o mesmo hash.
Nas salas com queda, a história de hashes é comparada a partir da última foto
ou dessincronia (o registro de quem esteve fora tem a simulação sozinha); as
notas trazem o diagnóstico (fotos, dessincronias, o `mot` do "ia", os avisos).
--modo social roda só 1 a 4 e o 10; --modo duelo, 1 e 11.
Depois, aqui: a intrusa não recebeu nada dirigido, nenhum segredo apareceu
nela nem no log do relé, e o relé não teve exceção.

Não conserta nada de ninguém: relata o que passa e o que falha.
Precisa do websockets com cliente síncrono (12+).
"""
import html
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

from websockets.sync.client import connect  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..'))
RELE = os.path.join(RAIZ, 'servidor', 'rele.py')
BAIXA = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)     # o dono usa a máquina enquanto a prova roda
CHROMES = [r'C:\Program Files\Google\Chrome\Application\chrome.exe',
           r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
           '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
DIRIGIDOS = ('sussurro', 'grupo', 'duelo', 'batalha')
INTRUSA = 'intrusa-c'
RESULTADOS = []


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


# ================================================================ o relé de verdade
class Rele:
    """servidor/rele.py num subprocesso (prioridade baixa), numa porta livre; o
    log vai para um arquivo (num PIPE que ninguém lê o relé trava)."""

    def __init__(self):
        self.porta = porta_livre()
        self.registro = tempfile.TemporaryFile()
        self.proc = subprocess.Popen([sys.executable, RELE, '--porta', str(self.porta), '--relatorio', '0'],
                                     stdout=subprocess.DEVNULL, stderr=self.registro, creationflags=BAIXA,
                                     env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))   # sem .pyc em servidor/
        self.url = 'ws://127.0.0.1:%d' % self.porta
        self.ok = espera_porta(self.porta)

    def log(self):
        self.registro.flush()
        self.registro.seek(0)
        return self.registro.read().decode('utf-8', 'replace')

    def fecha(self):
        self.proc.terminate()
        try:
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()
        texto = self.log()
        self.registro.close()
        return texto


class Cru:
    """Um cliente cru do relé numa thread: guarda tudo o que ouve (texto cru)."""

    def __init__(self, url):
        self.ws = connect(url + '/ws?n=' + secrets.token_hex(6), max_queue=None, open_timeout=5)
        self.ouvidos = []
        self.vivo = True
        self.trava = threading.Lock()
        threading.Thread(target=self._ouve, daemon=True).start()

    def _ouve(self):
        while self.vivo:
            try:
                s = self.ws.recv(timeout=0.5)
            except TimeoutError:
                continue
            except Exception:
                break
            with self.trava:
                self.ouvidos.append(s)

    def manda(self, obj):
        self.ws.send(json.dumps(obj, ensure_ascii=False))

    def lista(self):
        with self.trava:
            return list(self.ouvidos)

    def fecha(self):
        self.vivo = False
        try:
            self.ws.close()
        except Exception:
            pass


def abre_json(s):
    try:
        m = json.loads(s)
        return m if isinstance(m, dict) else None
    except Exception:
        return None


# ================================================================ a prova
class Prova:
    def __init__(self):
        self.rele = None
        self.intrusa = None
        self.impostor = None
        self.pulsos = None
        self.sinais = []

    # ---- o que a página pede por /sinal
    def sinal(self, q):
        ev = (q.get('ev') or [''])[0]
        v = lambda k: (q.get(k) or [''])[0]  # noqa: E731
        self.sinais.append(ev)
        if ev == 'impostor-praca':
            # na praça, com o grupo formado: o que desfaria o grupo ou levaria a Bia sozinha
            a, b, gid = v('a'), v('b'), v('gid')
            try:
                self.impostor = Cru(self.rele.url)
            except Exception as e:
                return {'erro': 'sem conexão: %s' % e}
            forjados = [
                {'t': 'grupo', 'de': a, 'para': b, 'acao': 'descer', 'dados': {'gid': gid, 'dungeonId': 'greenhouse', 'dificuldade': 'normal'}},
                {'t': 'grupo', 'de': a, 'para': b, 'acao': 'lider', 'dados': {'gid': gid, 'novo': b, 'v': 99999}},
                {'t': 'grupo', 'de': a, 'para': b, 'acao': 'sair', 'dados': {'gid': gid, 'motivo': 'impostor'}},
            ]
            if v('expirou'):
                forjados = [{'t': 'grupo', 'de': a, 'para': b, 'acao': 'sair', 'dados': {'gid': gid, 'motivo': 'expirou'}}]
            for m in forjados:
                try:
                    self.impostor.manda(m)
                except Exception:
                    pass
            return {'enviados': len(forjados), 'acoes': [m['t'] + ':' + m['acao'] + ':' + str(m['dados'].get('motivo', '')) for m in forjados]}
        if ev == 'impostor':
            a, b, gid, bid = v('a'), v('b'), v('gid'), v('bid')
            try:
                T = int(v('T') or 0)
            except ValueError:
                T = 0
            try:
                self.impostor = Cru(self.rele.url)
            except Exception as e:
                return {'erro': 'sem conexão: %s' % e}
            forjados = [
                {'t': 'grupo', 'de': a, 'para': b, 'acao': 'sair', 'dados': {'gid': gid, 'motivo': 'impostor'}},
                {'t': 'grupo', 'de': a, 'para': b, 'acao': 'lider', 'dados': {'gid': gid, 'novo': b}},
                {'t': 'grupo', 'de': a, 'para': b, 'acao': 'estado',
                 'dados': {'gid': gid, 'v': 99999, 'lider': b, 'fase': 'praca',
                           'membros': [{'id': a, 'cx': 'deadbeef', 'heroi': {'classId': 'sumo', 'element': 'fogo', 'level': 1}},
                                       {'id': b, 'cx': 'deadbeef', 'heroi': {'classId': 'curandeiro', 'element': 'agua', 'level': 1}}]}},
                {'t': 'batalha', 'de': a, 'para': b, 'acao': 'ia', 'dados': {'b': bid, 'u': v('ub'), 'mot': 'caiu'}},
                {'t': 'batalha', 'de': a, 'para': b, 'acao': 'lance',
                 'dados': {'b': bid, 'T': T, 'k': 0, 'u': v('ua'), 'a': 'e', 'ok': True}},
                {'t': 'batalha', 'de': a, 'para': b, 'acao': 'lance',
                 'dados': {'b': bid, 'T': T + 1, 'k': 0, 'u': v('ua'), 'a': 'e', 'ok': True}},
            ]
            for m in forjados:
                try:
                    self.impostor.manda(m)
                except Exception:
                    pass
            return {'enviados': len(forjados), 'acoes': [m['t'] + ':' + m['acao'] for m in forjados]}
        if ev == 'impostor-fim':
            imp, self.impostor = self.impostor, None
            if imp is None:
                return {'erro': 'sem impostor'}
            time.sleep(0.3)
            imp.fecha()
            ouvidos = [abre_json(s) or {} for s in imp.lista()]
            dirigidos = [m.get('t') + ':' + str(m.get('acao')) for m in ouvidos if m.get('t') in DIRIGIDOS]
            vozes = [m.get('t') for m in ouvidos if not m.get('de')]
            return {'ouvidos': len(ouvidos), 'dirigidos': dirigidos[:20], 'vozes': vozes[:10]}
        return {'erro': 'sinal desconhecido: ' + ev}


class Pedidos(SimpleHTTPRequestHandler):
    """A raiz do projeto, mais /dorme (o relógio), /sinal (a prova) e a página de fora."""
    prova = None
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map,
                          **{'.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8',
                             '.json': 'application/json', '.css': 'text/css'})

    def __init__(self, *a, **k):
        super().__init__(*a, directory=RAIZ, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _manda(self, corpo, tipo):
        dados = corpo.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', tipo)
        self.send_header('Content-Length', str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == '/dorme':
            try:
                ms = max(0, min(int(parse_qs(u.query).get('ms', ['40'])[0]), 1000))
            except ValueError:
                ms = 40
            time.sleep(ms / 1000.0)
            return self._manda('ok', 'text/plain')
        if u.path == '/sinal':
            try:
                r = self.prova.sinal(parse_qs(u.query))
            except Exception as e:
                r = {'erro': repr(e)}
            return self._manda(json.dumps(r, ensure_ascii=False), 'application/json')
        if u.path == '/__prova/dupla.html':
            return self._manda(PAGINA, 'text/html; charset=utf-8')
        return super().do_GET()

    def log_message(self, *a):
        pass


# ================================================================ a página de fora
PAGINA = r"""<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Multijogador de ponta a ponta (prova)</title>
<style>
  body{margin:0;background:#0f1216;color:#e8eef6;font:12px/1.4 monospace;padding:8px}
  iframe{width:49%;height:150px;border:1px solid #2a323d;background:#0b0e12}
  #summary{padding:6px 10px;border-radius:6px;margin:6px 0;background:#1b2230}
  #dados{display:none}
</style></head>
<body>
<div id="summary">rodando…</div>
<div id="quadros"></div>
<div id="log"></div>
<pre id="dados"></pre>
<script>
(function () {
  'use strict';
  var log = document.getElementById('log');
  var falhas = 0, total = 0, dados = { etapas: {}, salas: [], notas: [] };
  function linha(txt) { var d = document.createElement('div'); d.textContent = txt; log.appendChild(d); }
  function check(nome, ok, extra) {
    total++;
    if (!ok) falhas++;
    linha((ok ? 'PASSOU · ' : 'FALHOU · ') + nome + (extra ? ' — ' + extra : ''));
    return !!ok;
  }
  function nota(txt) { dados.notas.push(txt); linha('NOTA · ' + txt); }
  function guarda() { try { document.getElementById('dados').textContent = JSON.stringify(dados); } catch (e) {} }
  function arg(n) { var m = new RegExp('[?&]' + n + '=([^&]+)').exec(location.search); return m ? decodeURIComponent(m[1]) : ''; }
  var REDE = arg('rede'), MODO = arg('modo') || 'tudo', INTRUSA = arg('intrusa') || 'intrusa-c';
  function enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }
  function s(fn, def) { try { var v = fn(); return v === undefined ? def : v; } catch (e) { return def; } }
  function curto(v) { var t; try { t = JSON.stringify(v); } catch (e) { t = String(v); } return String(t).slice(0, 220); }

  // ---------------------------------------------------------------- o tempo
  // o fetch pendente segura o relógio virtual (o WebSocket anda de verdade);
  // o setTimeout sem fetch pendente anda 40 ms do relógio virtual (os timers
  // dos dois jogadores rodam aí). Virtual ≈ real, e nunca mais depressa.
  function respira() { return fetch('/dorme?ms=40', { cache: 'no-store' }).then(function (r) { return r.text(); }, function () {}); }
  function anda(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function passo() { return respira().then(function () { return anda(40); }); }
  var obs = { A: { r: 0, d: 0, Tr: 0, Td: 0, log: [] }, B: { r: 0, d: 0, Tr: 0, Td: 0, log: [] } };
  function observa() {
    if (!A || !B) return;
    [['A', A], ['B', B]].forEach(function (p) {
      var o = obs[p[0]], se = ses(p[1]);
      var r = se.restauracoes || 0, d = se.dessinc || 0;
      if (r > o.r) { o.r = r; o.Tr = turno(p[1]); o.log.push('foto@T' + o.Tr); }
      if (d > o.d) {
        o.d = d; o.Td = turno(p[1]);
        var ud = s(function () { return p[1].Co._S().ultimaDessinc; }, null);
        o.log.push('dessinc@T' + o.Td + (ud ? '(' + ud.mot + ' T' + ud.T + ')' : ''));
      }
    });
  }
  function zeraObs() {
    ['A', 'B'].forEach(function (k) { obs[k].Tr = 0; obs[k].Td = 0; obs[k].log = []; });
    dados.tSala = A.w.Date.now();
  }
  function espera(cond, ms) {
    var t0 = Date.now(), voltas = Math.ceil(ms / 40) + 20;
    return new Promise(function (res) {
      (function volta() {
        try { observa(); } catch (e0) {}
        var ok = false;
        try { ok = !!cond(); } catch (e) { ok = false; }
        if (ok) return res(true);
        if (voltas-- <= 0 || Date.now() - t0 > ms) return res(false);
        passo().then(volta);
      })();
    });
  }
  function dorme(ms) { return espera(function () { return false; }, ms); }
  function sinal(q) {
    return fetch('/sinal?' + q, { cache: 'no-store' }).then(function (r) { return r.json(); }, function () { return null; });
  }

  // ---------------------------------------------------------------- os dois jogadores
  function abre(fid, q) {
    var f = document.createElement('iframe');
    f.id = fid;
    f.src = '/tests/coop_cliente.html?rede=' + REDE + '&' + q;   // o ws:// cru: o rede.js o procura ao pé da letra
    document.getElementById('quadros').appendChild(f);
    return f;
  }
  var fA = abre('a', 'conta=a&nome=Ana&heroi=sumo&nivel=15&x=0&z=9');
  var fB = abre('b', 'conta=b&nome=Bia&heroi=curandeiro&nivel=15&x=1.5&z=9');
  var A = null, B = null;
  function lado(f, nome) {
    var w = f.contentWindow, J = w.JOGO || {};
    return { nome: nome, w: w, J: J, C: w.cliente, R: J.Rede, G: J.Game, E: J.Engine, P: J.Progress,
             Gr: J.Grupo, Du: J.Duelo, Su: J.Sussurros, Co: J.Coop, wsOrig: null, falsos: [] };
  }
  function carregou(f) {
    try { var c = f.contentWindow.cliente; return !!(c && (c.pronto || c.falhou)); } catch (e) { return false; }
  }
  function est(L) { return s(function () { return L.Gr.estado(); }, {}) || {}; }
  function ses(L) { return s(function () { return L.Co.sessao(); }, {}) || {}; }
  function du(L) { return s(function () { return L.Du.estado(); }, {}) || {}; }
  function par(L) { return s(function () { return L.Gr.parceiro(); }, null) || {}; }
  function cx(L) { return s(function () { return L.R.meuCx(); }, null); }
  function temPar(L, id) { return s(function () { return L.R.pares().some(function (p) { return p.id === id; }); }, false); }
  function hashDe(L) { var st = L.G.state; return st ? s(function () { return L.E.hash(st); }, null) : null; }
  function turno(L) { var st = L.G.state; return st ? (st.turno !== undefined ? st.turno : -1) : -1; }
  function heroiDe(L, dono) {
    var st = L.G.state, us = (st && st.units) || [];
    for (var i = 0; i < us.length; i++) {
      if ((us[i].kind === 'hero' || us[i].kind === 'fusion') && us[i].dono === dono) return us[i];
    }
    return null;
  }
  function uidDe(dono) { var u = heroiDe(A, dono); return u ? u.uid : null; }
  function unidade(L, uid) { var st = L.G.state; return st ? s(function () { return L.E.findUnit(st, uid); }, null) : null; }
  function fimDeSala(L) { return ['roomClear', 'dungeonComplete', 'defeat'].indexOf(L.G.screen) >= 0; }
  function eventos(L, tipo, desde) {
    return (L.C.eventos || []).filter(function (e) { return e.tipo === tipo && (!desde || e.t >= desde); });
  }
  function membros(e) { return (e.membros || []).map(function (m) { return m.id; }).sort().join(','); }

  // a rede da Bia "cai" de verdade: o WebSocket novo fica pendurado (nem abre,
  // nem falha) até `libera`, quando falha uma vez e a Rede religa sozinha
  function bloqueia(L) {
    if (L.wsOrig) return;
    var W = L.w.WebSocket;
    L.wsOrig = W;
    var falsos = L.falsos = [];
    var Falso = function (url) {
      var f = { url: url, readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null,
                send: function () {}, close: function () { f.readyState = 3; } };
      falsos.push(f);
      return f;
    };
    Falso.CONNECTING = 0; Falso.OPEN = 1; Falso.CLOSING = 2; Falso.CLOSED = 3;
    L.w.WebSocket = Falso;
  }
  function libera(L) {
    if (!L.wsOrig) return 0;
    L.w.WebSocket = L.wsOrig;
    L.wsOrig = null;
    var n = 0;
    L.falsos.forEach(function (f) {
      if (f.readyState === 3) return;
      f.readyState = 3;
      n++;
      try { if (f.onclose) f.onclose({ code: 1006 }); } catch (e) {}
    });
    return n;
  }

  // ---------------------------------------------------------------- comparações
  function comparaHashes(desdeT) {
    var hA = s(function () { return A.Co._hashes(); }, null) || {}, hB = s(function () { return B.Co._hashes(); }, null) || {};
    var comuns = 0, dif = [];
    Object.keys(hA).forEach(function (T) {
      if (hB[T] === undefined || Number(T) < (desdeT || 0)) return;
      comuns++;
      if (String(hA[T]) !== String(hB[T])) dif.push('T' + T + ':' + hA[T] + '≠' + hB[T]);
    });
    return { comuns: comuns, dif: dif, nA: Object.keys(hA).length, nB: Object.keys(hB).length };
  }
  function chaveLance(l) {
    return [l.T, l.k, l.a, l.u, l.x === undefined ? '' : l.x, l.y === undefined ? '' : l.y, l.s || '', l.alvo || ''].join('/');
  }
  function lances(L, desdeT) {
    var lg = s(function () { return L.Co._log(); }, null) || {}, fora = [];
    Object.keys(lg).forEach(function (T) {
      if (Number(T) < (desdeT || 0)) return;
      (lg[T] || []).forEach(function (l) { fora.push(l); });
    });
    return fora;
  }
  function comparaLogs(uA, uB, desdeT) {
    var la = lances(A, desdeT), lb = lances(B, desdeT);
    var ka = la.map(chaveLance).sort(), kb = lb.map(chaveLance).sort();
    var sa = {}, sb = {};
    ka.forEach(function (k) { sa[k] = true; });
    kb.forEach(function (k) { sb[k] = true; });
    return {
      iguais: ka.join('|') === kb.join('|'), nA: ka.length, nB: kb.length,
      soA: ka.filter(function (k) { return !sb[k]; }).slice(0, 3),
      soB: kb.filter(function (k) { return !sa[k]; }).slice(0, 3),
      daAnaNaBia: lb.filter(function (l) { return l.u === uA; }).length,
      daBiaNaAna: la.filter(function (l) { return l.u === uB; }).length
    };
  }
  function tiposDe(lista) {
    var c = {};
    lista.forEach(function (l) { c[l.a] = (c[l.a] || 0) + 1; });
    return c;
  }

  // ---------------------------------------------------------------- 1. conexão
  function etapaConexao() {
    return espera(function () { return carregou(fA) && carregou(fB); }, 180000).then(function (ok) {
      var fa = s(function () { return fA.contentWindow.cliente.falhou; }, 'sem cliente'),
          fb = s(function () { return fB.contentWindow.cliente.falhou; }, 'sem cliente');
      check('os dois jogadores carregaram o jogo sem tela', ok && !fa && !fb, curto([fa, fb]));
      if (!ok || fa || fb) return false;
      A = lado(fA, 'Ana');
      B = lado(fB, 'Bia');
      var falta = [];
      [A, B].forEach(function (L) {
        ['Grupo', 'Duelo', 'Sussurros', 'Coop'].forEach(function (m) { if (!L.J[m]) falta.push(L.nome + ' sem ' + m); });
      });
      check('as duas páginas têm o Grupo, o Duelo, os Sussurros e o Coop', !falta.length, falta.join(', '));
      var errs = A.C.erros.concat(B.C.erros);
      check('nenhum erro de script ao carregar', !errs.length, errs.slice(0, 3).join(' || '));
      return espera(function () {
        return A.R.transporte() === 'ws' && B.R.transporte() === 'ws' &&
               s(function () { return A.R.privado(); }, false) && s(function () { return B.R.privado(); }, false);
      }, 15000);
    }).then(function (ok) {
      if (!A) return false;
      check('os dois ligaram pelo relé de verdade (ws) e o relé se anunciou com o cx (R.privado)', ok,
            curto([A.R.transporte(), B.R.transporte(), s(function () { return A.R.privado(); }, '?'), s(function () { return B.R.privado(); }, '?')]));
      if (!ok) return false;
      dados.idA = A.C.id; dados.idB = B.C.id; dados.cxA = cx(A); dados.cxB = cx(B);
      check('cada conexão ganhou um cx do relé (8 hex), diferentes', /^[0-9a-f]{8}$/.test(dados.cxA) &&
            /^[0-9a-f]{8}$/.test(dados.cxB) && dados.cxA !== dados.cxB, dados.cxA + ' / ' + dados.cxB);
      return espera(function () { return temPar(A, B.C.id) && temPar(B, A.C.id); }, 15000);
    }).then(function (ok) {
      if (!A) return false;
      check('cada um vê o outro na praça (oi/eco pelo relé)', ok);
      return ok;
    });
  }

  // ---------------------------------------------------------------- 2. mensagem particular
  function etapaSussurro() {
    var seg = 'segredo-' + Math.random().toString(36).slice(2, 10);
    var seg2 = 'ninguem-' + Math.random().toString(36).slice(2, 10);
    dados.segredos = [seg, seg2];
    guarda();
    var r = s(function () { return A.Su.manda(B.C.id, 'oi Bia, ' + seg); }, null);
    check('sussurro: a Ana manda a mensagem particular (Sussurros.manda → ok)', r && r.ok, curto(r));
    function daBia() { return B.C.sussurros.filter(function (l) { return String(l.texto).indexOf(seg) >= 0; }); }
    return espera(function () { return daBia().length > 0; }, 6000).then(function (ok) {
      check('sussurro: chegou à Bia (aoChegar)', ok, curto(B.C.sussurros.slice(-2)));
      var l = daBia()[0] || {};
      check('sussurro: com o nome da Ana, marcado como de fora', l.nome === 'Ana' && !l.meu && l.de === A.C.id, curto(l));
      var ev = eventos(B, 'sussurro').filter(function (e) { return String(e.texto).indexOf(seg) >= 0; })[0] || {};
      check('sussurro: o evento da Rede traz o cx da conexão da Ana (o carimbo do relé)', ev.cx === dados.cxA, curto(ev));
      var meu = s(function () { return A.Su.lista(); }, []).filter(function (x) { return String(x.texto).indexOf(seg) >= 0; })[0] || {};
      check('sussurro: a Ana guarda a própria linha (meu:true)', meu.meu === true, curto(meu));
      var r2 = s(function () { return A.Su.manda('jninguem' + Math.random().toString(36).slice(2, 8), seg2); }, null);
      nota('sussurro a um id que não está ligado: ' + curto(r2));
      return espera(function () {
        return eventos(A, 'ausente').some(function (e) { return e.tipoMsg === 'sussurro'; }) &&
               s(function () { return A.Su.lista(); }, []).some(function (x) { return x.falhou && String(x.texto).indexOf(seg2) >= 0; });
      }, 6000);
    }).then(function (ok) {
      check('sussurro a quem não está ligado: o relé responde "ausente" e a linha fica como não entregue', ok,
            curto(eventos(A, 'ausente')) + ' ' + curto(s(function () { return A.Su.lista(); }, []).slice(-1)));
      return true;
    });
  }

  // ---------------------------------------------------------------- 3. grupo
  function etapaGrupo() {
    var r = s(function () { return A.Gr.convidar(B.C.id); }, null);
    check('grupo: a Ana chama a Bia (Grupo.convidar → ok)', r && r.ok, curto(r));
    return espera(function () { return B.C.convites.length > 0; }, 6000).then(function (ok) {
      var c = B.C.convites[0] || {};
      check('grupo: o convite chega à Bia (aoConvite) com o id e o nome da Ana', ok && c.id === A.C.id && c.nome === 'Ana', curto(c));
      if (!ok) return false;
      s(function () { return B.Gr.responder(true); });
      return espera(function () { return est(A).fase === 'formado' && est(B).fase === 'formado'; }, 6000);
    }).then(function (ok) {
      var ea = est(A), eb = est(B);
      check('grupo: formado nos dois lados', ok, ea.fase + ' / ' + eb.fase);
      if (!ok) return false;
      check('grupo: quem chamou é a líder, nos dois lados', ea.lider === A.C.id && eb.lider === A.C.id, ea.lider + ' / ' + eb.lider);
      check('grupo: dois membros, os mesmos nos dois', (ea.membros || []).length === 2 && membros(ea) === membros(eb), membros(ea) + ' / ' + membros(eb));
      var pa = par(A), pb = par(B);
      check('grupo: cada um guarda o parceiro com o cx da conexão dele', pa.id === B.C.id && pa.cx === cx(B) &&
            pb.id === A.C.id && pb.cx === cx(A), curto([pa.id, pa.cx, pb.id, pb.cx]));
      check('grupo: souLider na Ana e não na Bia', s(function () { return A.Gr.souLider(); }, null) === true &&
            s(function () { return B.Gr.souLider(); }, null) === false);
      var r3 = s(function () { return A.Gr.convidar(INTRUSA); }, null);
      check('grupo de no máximo 2: com o grupo cheio, chamar uma terceira pessoa é recusado', r3 && r3.ok === false, curto(r3));
      var ha = (ea.membros || []).filter(function (m) { return m.id === B.C.id; })[0] || {};
      check('grupo: o cartão da Bia no lado da Ana traz o herói que ela leva (para o retrato)',
            ha.heroi && ha.heroi.classId === 'curandeiro' && ha.heroi.level >= 1, curto(ha.heroi));
      return true;
    });
  }

  // ---------------------------------------------------------------- 4. liderança
  function etapaLideranca() {
    var v0 = est(B).v;
    var r0 = s(function () { return B.Gr.passarLideranca(); }, null);
    check('liderança: quem não lidera não passa a liderança', r0 && r0.ok === false, curto(r0));
    var r = s(function () { return A.Gr.passarLideranca(); }, null);
    check('liderança: a Ana passa a liderança (ok)', r && r.ok, curto(r));
    return espera(function () { return est(A).lider === B.C.id && est(B).lider === B.C.id; }, 6000).then(function (ok) {
      check('liderança: a Bia lidera, nos dois lados', ok, est(A).lider + ' / ' + est(B).lider);
      check('liderança: o número do estado (v) cresceu', typeof est(B).v === 'number' && est(B).v > v0, v0 + ' → ' + est(B).v);
      check('liderança: a coroa trocou (Bia lidera, Ana não)', s(function () { return B.Gr.souLider(); }, null) === true &&
            s(function () { return A.Gr.souLider(); }, null) === false);
      var r2 = s(function () { return A.Gr.descer('greenhouse'); }, null);
      check('liderança: só quem lidera escolhe o calabouço (a Ana não desce)', r2 && r2.ok === false, curto(r2));
      s(function () { return B.Gr.passarLideranca(); });
      return espera(function () { return est(A).lider === A.C.id && est(B).lider === A.C.id; }, 6000);
    }).then(function (ok) {
      check('liderança: e volta para a Ana (a Bia passa de volta)', ok, est(A).lider + ' / ' + est(B).lider);
      return ok && A.G.screen !== 'antessala' && B.G.screen !== 'antessala';
    });
  }

  // ---------------------------------------------------------------- 5. descida e batalha
  function chegaNaPorta(dg, rot) {
    // de onde estiverem (praça, derrota, sala vencida, antessala) até a porta acesa
    var inicio;
    if (A.G.screen === 'antessala' && B.G.screen === 'antessala') inicio = Promise.resolve(true);
    else if (A.G.screen === 'roomClear') {
      var sA0 = ses(A);
      var ok = s(function () { return A.Co.proxima(); }, false);
      check(rot + 'a líder abre a próxima sala (Coop.proxima)', ok === true,
            curto({ ok: ok, descidaAcabou: sA0.descidaAcabou, parceiroVoltou: sA0.parceiroVoltou, parceiroIA: sA0.parceiroIA,
                    sumidoDesde: !!sA0.sumidoDesde, grupo: est(A).fase, dados: A.C.dadosTela.roomClear &&
                    { descidaAcabou: A.C.dadosTela.roomClear.descidaAcabou, parceiroVoltou: A.C.dadosTela.roomClear.parceiroVoltou } }));
      inicio = espera(function () { return ses(B).proximaLiberada || B.G.screen === 'antessala'; }, 8000).then(function (ok2) {
        check(rot + 'o "Seguir" da parceira acende quando a "próxima" chega', ok2, curto(ses(B).proximaLiberada));
        if (B.G.screen !== 'antessala') s(function () { return B.Co.seguir(); });
        return espera(function () { return A.G.screen === 'antessala' && B.G.screen === 'antessala'; }, 12000);
      });
    } else {
      var cA = cx(A), cB = cx(B);
      var r = s(function () { return A.Gr.descer(dg); }, null);
      check(rot + 'a líder chama o grupo para ' + dg + ' (Grupo.descer → ok)', r && r.ok, curto(r));
      inicio = espera(function () { return A.G.screen === 'antessala' && B.G.screen === 'antessala'; }, 12000).then(function (ok3) {
        if (ok3) {
          check(rot + 'a conexão não caiu ao trocar de tela (o mesmo cx; o R.entrar com a sala não religa)',
                cx(A) === cA && cx(B) === cB, curto([cA, cx(A), cB, cx(B)]));
        }
        return ok3;
      });
    }
    return inicio.then(function (ok) {
      check(rot + 'os dois JUNTOS na antessala (' + A.G.dungeonId + ' sala ' + (A.G.roomIndex + 1) + ')',
            ok && A.G.dungeonId === B.G.dungeonId && A.G.roomIndex === B.G.roomIndex, A.G.screen + ' / ' + B.G.screen);
      if (!ok) return false;
      check(rot + 'cada um leva o SEU herói principal (um herói por jogador)',
            A.G.party.join() === 'sumo' && B.G.party.join() === 'curandeiro', curto([A.G.party, B.G.party]));
      var sala = A.G.dungeonId + ':' + A.G.roomIndex;
      check(rot + 'a Rede das duas está na sala da antessala', s(function () { return A.R.minhaSala(); }, '?') === sala &&
            s(function () { return B.R.minhaSala(); }, '?') === sala, curto([A.R.minhaSala(), B.R.minhaSala()]));
      return espera(function () { return s(function () { return A.Co.podeEntrar().ok; }, false); }, 12000);
    }).then(function (ok) {
      check(rot + 'a porta da líder acende (o "pronto" da parceira chegou)', ok, curto(s(function () { return A.Co.podeEntrar(); }, null)));
      var pb = s(function () { return B.Co.podeEntrar(); }, null);
      check(rot + 'a porta da parceira não abre (quem abre é a líder)', pb && pb.ok === false, curto(pb));
      return ok;
    });
  }

  function entraNaSala(rot, pilotos) {
    pilotos = pilotos || {};
    A.C.pilota(pilotos.a || { joga: true, casa: 0 });
    B.C.pilota(pilotos.b || { joga: true, casa: 0 });
    nota(rot + 'piloto: Ana=' + A.C.piloto + ' Bia=' + B.C.piloto);
    var ri = A.G.roomIndex;
    zeraObs();
    var ok = s(function () { return A.Co.entrar(); }, false);
    check(rot + 'a líder abre a porta (Coop.entrar)', ok === true, curto(ok));
    return espera(function () { return A.G.screen === 'battle' && B.G.screen === 'battle' && A.G.state && B.G.state; }, 20000).then(function (ok2) {
      check(rot + 'os dois estão DENTRO da mesma sala', ok2 && A.G.roomIndex === ri && B.G.roomIndex === ri &&
            A.G.dungeonId === B.G.dungeonId, A.G.screen + ' / ' + B.G.screen);
      if (!ok2) return false;
      var hA = heroiDe(A, A.C.id), hB = heroiDe(A, B.C.id), hA2 = heroiDe(B, A.C.id), hB2 = heroiDe(B, B.C.id);
      check(rot + 'o herói de cada um está nos dois motores, com o dono certo', !!(hA && hB && hA2 && hB2) &&
            hA.uid === hA2.uid && hB.uid === hB2.uid && hA.heroId === 'sumo' && hB.heroId === 'curandeiro',
            curto([hA && hA.uid, hB && hB.uid, hA2 && hA2.uid, hB2 && hB2.uid]));
      var ni = (A.G.state.units || []).filter(function (u) { return u.side === 'enemy'; }).length;
      var nb = (B.G.state.units || []).filter(function (u) { return u.side === 'enemy'; }).length;
      check(rot + 'os mesmos monstros nos dois', ni > 0 && ni === nb, ni + ' / ' + nb);
      return true;
    });
  }

  function confereFim(rot, semDessinc, desdeT) {
    // desdeT: numa sala com queda, a história de antes da volta pode divergir
    // (a foto conserta o estado, não o registro); compara-se dali em diante
    var uA = uidDe(A.C.id), uB = uidDe(B.C.id);
    observa();
    if (!semDessinc) {
      var ult = Math.max(obs.A.Tr, obs.A.Td, obs.B.Tr, obs.B.Td);
      if (ult) desdeT = Math.max(desdeT || 0, ult + 1);
      nota(rot + 'diagnóstico — Ana: ' + (obs.A.log.join(' ') || 'nada') + ' · Bia: ' + (obs.B.log.join(' ') || 'nada') +
           ' · a Bia recebeu "ia": ' + curto(eventos(B, 'batalha', dados.tSala).filter(function (e) { return e.acao === 'ia'; })
                                              .map(function (e) { return e.d && e.d.mot; })) +
           ' · avisos do Coop na Ana: ' + curto(A.C.avisos.filter(function (a) { return a.coop && a.t >= dados.tSala; })
                                                .map(function (a) { return Math.round((a.t - dados.tSala) / 1000) + 's ' + a.texto; })));
    }
    if (desdeT) nota(rot + 'hashes e lances comparados a partir do turno ' + desdeT + ' (depois da última foto ou dessincronia)');
    check(rot + 'a mesma tela de fim nos dois', A.G.screen === B.G.screen, A.G.screen + ' / ' + B.G.screen);
    var hA = hashDe(A), hB = hashDe(B);
    check(rot + 'o MESMO hash do estado no fim da sala', hA !== null && hA === hB,
          hA + ' / ' + hB + ' · turno ' + turno(A) + '/' + turno(B) + ' · ' + (A.G.state && A.G.state.phase));
    var hs = comparaHashes(desdeT);
    check(rot + 'o mesmo hash em todo turno guardado pelos dois', hs.comuns >= (desdeT ? 1 : 2) && !hs.dif.length,
          hs.comuns + ' turnos em comum (Ana ' + hs.nA + ', Bia ' + hs.nB + ') ' + hs.dif.slice(0, 3).join(' '));
    var lg = comparaLogs(uA, uB, desdeT);
    check(rot + 'a mesma lista de lances nos dois', lg.iguais && lg.nA > 0,
          lg.nA + ' / ' + lg.nB + ' lances; só na Ana: ' + lg.soA.join(' ') + '; só na Bia: ' + lg.soB.join(' '));
    if (!desdeT) check(rot + 'os lances da Ana aparecem na Bia, e os da Bia na Ana', lg.daAnaNaBia > 0 && lg.daBiaNaAna > 0,
          'da Ana na Bia ' + lg.daAnaNaBia + ' · da Bia na Ana ' + lg.daBiaNaAna + ' · tipos ' + curto(tiposDe(lances(A))));
    var dA = ses(A).dessinc, dB = ses(B).dessinc;
    if (semDessinc) check(rot + 'nenhuma dessincronia (nenhuma foto de resgate)', !dA && !dB, 'Ana ' + dA + ' · Bia ' + dB);
    else nota(rot + 'dessincronias: Ana ' + dA + ' · Bia ' + dB);
    var pa = A.C.dadosTela[A.G.screen] || {}, pb = B.C.dadosTela[B.G.screen] || {};
    if (A.G.screen === 'roomClear' || A.G.screen === 'dungeonComplete') {
      check(rot + 'a recompensa sai como de rede, e só a líder é a líder', pa.rede === true && pb.rede === true &&
            pa.lider === true && pb.lider === false, curto([pa.rede, pa.lider, pb.rede, pb.lider]));
      var xa = pa.xpPorHeroi, xb = pb.xpPorHeroi;
      function ids(x) { return Array.isArray(x) ? x.map(function (e) { return e.heroId || e.id; }) : Object.keys(x || {}); }
      check(rot + 'a XP vai só para o próprio herói, em cada cliente', ids(xa).join() === 'sumo' && ids(xb).join() === 'curandeiro',
            curto([ids(xa), ids(xb)]));
    }
    dados.salas.push({ rot: rot, tela: A.G.screen, turno: turno(A), hash: hA, lances: lg.nA, dessinc: [dA, dB],
                       daAnaNaBia: lg.daAnaNaBia, daBiaNaAna: lg.daBiaNaAna });
    guarda();
  }

  function lutaAteOFim(rot, limite) {
    return espera(function () { return fimDeSala(A) && fimDeSala(B); }, limite || 300000).then(function (ok) {
      check(rot + 'os dois chegaram ao fim da sala', ok, A.G.screen + ' / ' + B.G.screen + ' · turno ' + turno(A) + '/' + turno(B));
      return ok;
    });
  }

  function impostor(rot) {
    return espera(function () { return A.G.state && A.G.state.phase === 'playing' && turno(A) >= 2; }, 30000).then(function (ok) {
      if (!ok) { nota(rot + 'a batalha não chegou ao turno 2: sem impostor'); return true; }
      var uA = uidDe(A.C.id), uB = uidDe(B.C.id), dB0 = ses(B).dessinc || 0;
      var q = 'ev=impostor&a=' + enc(A.C.id) + '&b=' + enc(B.C.id) + '&gid=' + enc(est(B).gid) + '&bid=' + enc(ses(A).bid) +
              '&T=' + turno(A) + '&ua=' + enc(uA) + '&ub=' + enc(uB);
      return sinal(q).then(function (r) {
        dados.impostor = r;
        check(rot + 'impostor: um cliente cru com o id da Ana (conexão própria) mandou envelopes forjados à Bia', r && r.enviados > 0, curto(r));
        return dorme(3000);
      }).then(function () {
        var eb = est(B), pb = par(B);
        var mA = (eb.membros || []).filter(function (m) { return m.id === A.C.id; })[0] || {};
        check(rot + 'impostor: "sair" (também o de motivo "expirou"), "lider" e "estado" forjados não valem — a Bia segue no grupo da Ana, com o cx certo',
              eb.fase === 'formado' && eb.lider === A.C.id && pb.id === A.C.id && pb.cx === cx(A) && mA.on !== false &&
              !mA.saiu && !eb.descidaAcabou,
              curto({ fase: eb.fase, lider: eb.lider === A.C.id, cx: pb.cx === cx(A), on: mA.on, saiu: mA.saiu, descidaAcabou: eb.descidaAcabou }));
        var ub = unidade(B, uB);
        check(rot + 'impostor: o "ia" forjado não pôs o herói da Bia na IA', !!ub && !ub.ia, curto(ub && ub.ia));
        check(rot + 'impostor: os lances forjados não dessincronizaram a Bia', (ses(B).dessinc || 0) === dB0, dB0 + ' → ' + ses(B).dessinc);
        return sinal('ev=impostor-fim');
      }).then(function (r) {
        dados.impostorOuviu = r;
        check(rot + 'impostor: com o id da Ana, não ouviu o grupo nem os lances da Bia (o paraCx entrega só à conexão certa)',
              r && !r.erro && !(r.dirigidos || []).length, curto(r));
        return true;
      });
    });
  }

  function etapaSala1() {
    var rot = 'sala 1: ';
    return chegaNaPorta('greenhouse', rot).then(function (ok) {
      if (!ok) return false;
      return entraNaSala(rot);
    }).then(function (ok) {
      if (!ok) return false;
      return Promise.all([impostor(rot), lutaAteOFim(rot)]).then(function (r) {
        if (!r[1]) return false;
        confereFim(rot, true);
        return true;
      });
    });
  }

  // ---------------------------------------------------------------- 6. a queda longa
  function quedaLonga(rot) {
    return espera(function () { return A.G.state && A.G.state.phase === 'playing' && turno(A) >= 3; }, 60000).then(function (ok) {
      check(rot + 'a batalha andou 3 turnos antes da queda', ok, 'turno ' + turno(A));
      if (!ok) return false;
      var cB0 = cx(B), uB = uidDe(B.C.id), t0 = A.w.Date.now(), r0 = ses(B).restauracoes || 0;
      // a Ana para de jogar (o turno dela anda só pelo relógio de 30 s): sem isso a IA
      // termina a sala nos 3 a 5,5 s do religar e a Bia volta tarde demais (a descida acaba)
      A.C.pilota({ joga: false, casa: 0 });
      bloqueia(B);
      var derrubou = s(function () { B.R._derruba(); return true; }, false);
      check(rot + 'a rede da Bia cai (R._derruba, e o religar fica pendurado)', derrubou);
      var tCaiu = null, tIA = null;
      return espera(function () {
        var e = eventos(A, 'caiu', t0).filter(function (x) { return x.id === B.C.id; })[0];
        if (e) tCaiu = e.t;
        return !!e;
      }, 5000).then(function (ok1) {
        check(rot + 'a Ana ouve "caiu" da Bia na hora (o vigia do relé)', ok1,
              ok1 ? ((tCaiu - t0) + ' ms') : curto(eventos(A, 'caiu', t0)));
        return espera(function () { var u = unidade(A, uB); if (u && u.ia === true) { tIA = A.w.Date.now(); return true; } return false; }, 40000);
      }).then(function (ok2) {
        var dt = tIA ? (tIA - (tCaiu || t0)) : null;
        check(rot + 'passada a carência, o herói da Bia fica marcado fora (o turno passa) no motor da Ana', ok2, dt === null ? 'não foi' : (dt / 1000).toFixed(1) + ' s depois do caiu');
        check(rot + '...e não antes dos 15 s de carência', ok2 && dt >= 14000, dt === null ? '-' : (dt / 1000).toFixed(1) + ' s');
        check(rot + 'a Ana segue líder e é a autoridade', est(A).lider === A.C.id && ses(A).autoridade === A.C.id,
              curto([est(A).lider === A.C.id, ses(A).autoridade === A.C.id]));
        var n = libera(B);
        nota(rot + 'a rede da Bia volta (' + n + ' tentativa(s) pendurada(s) soltas)');
        return espera(function () { return eventos(B, 'religou', t0).length > 0; }, 15000);
      }).then(function (ok3) {
        var ev = eventos(B, 'religou', t0)[0] || {};
        check(rot + 'a Bia religa sozinha com um cx NOVO (evento religou)', ok3 && !!ev.cx && ev.cx !== cB0, curto(ev) + ' · antes ' + cB0);
        return espera(function () { return par(A).cx === cx(B); }, 12000);
      }).then(function (ok4) {
        check(rot + 'a volta: a Ana confere a chave e troca o cx da Bia', ok4, curto([par(A).cx, cx(B)]));
        check(rot + 'a Bia voltou ANTES do fim da sala', !fimDeSala(A), A.G.screen + ' · turno ' + turno(A));
        return espera(function () { return (ses(B).restauracoes || 0) > r0; }, 20000).then(function (okf) {
          check(rot + 'a Bia pede a foto e se restaura por ela', okf, 'restaurações ' + r0 + ' → ' + ses(B).restauracoes);
          dados.volta2 = turno(B) + 1;
          return espera(function () {
          var u = unidade(B, uB);
          return u && !u.ia && A.G.state && B.G.state && turno(A) === turno(B) && hashDe(A) === hashDe(B);
        }, 25000);
        });
      }).then(function (ok5) {
        A.C.pilota({ joga: true, casa: 0 });
        check(rot + 'a Bia retoma pela foto: o mesmo estado da Ana, com o herói DELA de volta (voltou a jogar)', ok5,
              curto([turno(A), turno(B), hashDe(A), hashDe(B), s(function () { return unidade(B, uB).ia; }, '?')]));
        return true;
      });
    });
  }

  function etapaSala2() {
    var rot = 'sala 2 (queda longa): ';
    return chegaNaPorta('greenhouse', rot).then(function (ok) {
      if (!ok) return false;
      return entraNaSala(rot);
    }).then(function (ok) {
      if (!ok) return false;
      var uB = uidDe(B.C.id);
      return Promise.all([quedaLonga(rot), lutaAteOFim(rot)]).then(function (r) {
        if (!r[1]) return false;
        confereFim(rot, false, dados.volta2 || 999);
        var ua = unidade(A, uB), ub = unidade(B, uB);
        check(rot + 'no fim da sala o herói da Bia é dela de novo, nos dois', !!(ua && ub && !ua.ia && !ub.ia), curto([ua && ua.ia, ub && ub.ia]));
        return true;
      });
    });
  }

  // ---------------------------------------------------------------- 7. a queda curta
  function etapaSala3() {
    var rot = 'sala 3 (queda curta): ';
    var uB = null;
    return chegaNaPorta('greenhouse', rot).then(function (ok) {
      if (!ok) return false;
      return entraNaSala(rot);
    }).then(function (ok) {
      if (!ok) return false;
      uB = uidDe(B.C.id);
      var u0 = unidade(A, uB), u1 = unidade(B, uB);
      check(rot + 'na sala seguinte o herói da Bia volta a ser dela (sem IA), nos dois', !!(u0 && u1) && !u0.ia && !u1.ia,
            curto([u0 && u0.ia, u1 && u1.ia]));
      var queda = espera(function () { return A.G.state && A.G.state.phase === 'playing' && turno(A) >= 3; }, 60000).then(function (ok2) {
        if (!ok2) { check(rot + 'a batalha andou 3 turnos antes da queda', false, 'turno ' + turno(A)); return false; }
        var cB0 = cx(B), t0 = A.w.Date.now();
        s(function () { B.R._derruba(); });
        return espera(function () { return eventos(A, 'caiu', t0).some(function (x) { return x.id === B.C.id; }); }, 5000).then(function (ok3) {
          check(rot + 'a Ana ouve "caiu" da Bia', ok3);
          return espera(function () { return eventos(B, 'religou', t0).length > 0 && par(A).cx === cx(B); }, 15000);
        }).then(function (ok4) {
          var ev = eventos(B, 'religou', t0)[0] || {};
          check(rot + 'a Bia religa sozinha (3 a 5,5 s) com cx novo, e a Ana troca o cx dela', ok4 && ev.cx !== cB0,
                curto([cB0, ev.cx, par(A).cx]));
          dados.volta3 = turno(A) + 2;
          var u = unidade(A, uB);
          check(rot + 'dentro da carência: o herói da Bia NÃO foi para a IA', !!u && !u.ia, curto(u && u.ia));
          return true;
        });
      });
      return Promise.all([queda, lutaAteOFim(rot)]).then(function (r) {
        if (!r[1]) return false;
        confereFim(rot, false, dados.volta3 || 999);
        var ua = unidade(A, uB);
        check(rot + 'e a sala acabou com o herói da Bia nas mãos dela', !!ua && !ua.ia, curto(ua && ua.ia));
        return true;
      });
    });
  }


  // ---------------------------------------------------------------- 8. cisterna 1: o relógio, a foto e a fusão
  function voltaAPraca(rot) {
    if (!(fimDeSala(A) || fimDeSala(B))) return Promise.resolve(true);
    A.C.praca();
    B.C.praca();
    return espera(function () { return est(A).fase === 'formado' && est(B).fase === 'formado' && A.C.tela === 'hub' && B.C.tela === 'hub'; }, 8000).then(function (ok) {
      check(rot + 'de volta à praça depois do calabouço, o grupo continua', ok, curto([est(A).fase, est(B).fase, A.C.tela, B.C.tela]));
      return ok;
    });
  }
  function ativa(L) { var st = L.G.state; return st ? s(function () { return L.E.activeUnit(st); }, null) : null; }
  function etapaCisterna1() {
    var rot = 'cisterna 1 (relógio, foto e fusão): ';
    var uA = null, uB = null;
    return voltaAPraca(rot).then(function (ok) {
      if (!ok) return false;
      return chegaNaPorta('cistern', rot);
    }).then(function (ok) {
      if (!ok) return false;
      // a Bia NÃO joga o primeiro turno dela: o relógio de parede do cliente dela encerra
      return entraNaSala(rot, { a: { joga: true, casa: 1 }, b: { joga: false } });
    }).then(function (ok) {
      if (!ok) return false;
      uA = uidDe(A.C.id); uB = uidDe(B.C.id);
      var t0 = 0, tl0 = null, viuEspera = null;
      var relogio = espera(function () { var u = ativa(B); return A.G.state.phase === 'playing' && u && u.uid === uB; }, 90000).then(function (ok2) {
        if (!ok2) { check(rot + 'chegou a vez do herói da Bia', false, 'turno ' + turno(A)); return false; }
        return dorme(300).then(function () {
          t0 = B.w.Date.now();
          tl0 = s(function () { return B.G.timeLeft(); }, null);
          var u = ativa(B);
          if (!u || u.uid !== uB) tl0 = null;
          return espera(function () {
          var e = ses(A).esperando;
          if (e && e.uid === uB) viuEspera = e;
          var u = ativa(B);
          return !u || u.uid !== uB || fimDeSala(B);
        }, 200000);
        });
      }).then(function (ok3) {
        if (ok3 === false && !t0) return false;
        var dt = (B.w.Date.now() - t0) / 1000;
        check(rot + 'sem ninguém tocar, o relógio de parede da Bia encerra o turno dela no prazo (' + (tl0 === null ? '?' : Math.round(tl0)) + ' s)',
              ok3 && tl0 !== null && Math.abs(dt - tl0) <= 3, dt.toFixed(1) + ' s');
        check(rot + '...e a Ana, esperando, mostra "vez da Bia" com o prazo estimado (sessao.esperando)',
              !!viuEspera && viuEspera.uid === uB && viuEspera.prazo > 0, curto(viuEspera));
        B.C.pilota({ joga: true, casa: 0 });
        return true;
      });
      var foto = relogio.then(function () {
        return espera(function () { return A.G.state && A.G.state.phase === 'playing' && turno(A) >= turno(B) && turno(A) >= 4; }, 60000);
      }).then(function (ok4) {
        if (!ok4 || fimDeSala(A)) { nota(rot + 'a sala acabou antes da foto de resgate'); return true; }
        var inimigo = (B.G.state.units || []).filter(function (u) { return u.side === 'enemy' && u.alive; })[0];
        if (!inimigo) { nota(rot + 'sem inimigo vivo para estragar'); return true; }
        var d0 = (ses(A).dessinc || 0) + (ses(B).dessinc || 0), T0 = turno(B);
        var estragou = s(function () { B.Co._estraga(inimigo.uid, 3); return true; }, false);
        check(rot + 'o gancho _estraga tira 3 PV de um monstro só no motor da Bia', estragou);
        return espera(function () { return (ses(A).dessinc || 0) + (ses(B).dessinc || 0) > d0; }, 30000).then(function (ok5) {
          check(rot + 'o hash acusa a diferença (uma dessincronia contada)', ok5 || fimDeSala(A), 'no turno ' + T0 + ' → ' + turno(B));
          return espera(function () { return turno(A) === turno(B) && hashDe(A) === hashDe(B) && turno(A) > T0; }, 30000);
        }).then(function (ok6) {
          check(rot + 'a foto da líder conserta: o mesmo estado nos dois de novo', ok6 || (fimDeSala(A) && fimDeSala(B) && hashDe(A) === hashDe(B)),
                curto([turno(A), turno(B), hashDe(A), hashDe(B)]));
          dados.volta4 = turno(A) + 1;
          return true;
        });
      });
      return Promise.all([foto, lutaAteOFim(rot)]).then(function (r) {
        if (!r[1]) return false;
        confereFim(rot, false, dados.volta4 || 999);
        /* 12/09: a fusão ENTRE JOGADORES não existe mais ("o jogador só pode
           fundir com seus personagens"). O que se cobra aqui é o avesso: nenhuma
           unidade fundida nesta sala junta heróis de donos diferentes. */
        var cruzadas = (A.G.state.units || []).filter(function (u) {
          if (u.kind !== 'fusion' || !u.fusedFrom || u.fusedFrom.length < 2) return false;
          var b = (A.G.state.units || []).filter(function (x) { return x.uid === u.fusedFrom[1]; })[0];
          return !!b && (b.dono || null) !== (u.dono || null);
        });
        check(rot + 'nenhuma fusão juntou heróis de jogadores diferentes', cruzadas.length === 0, curto(cruzadas.map(function (u) { return u.uid; })));
        return true;
      });
    });
  }

  // ---------------------------------------------------------------- 9. a queda sem volta
  function etapaSemVolta() {
    var rot = 'sem volta: ';
    var ida = (A.G.screen === 'roomClear') ? chegaNaPorta('cistern', rot)
            : voltaAPraca(rot).then(function (ok) { return ok && chegaNaPorta('cistern', rot); });
    return ida.then(function (ok) {
      if (!ok) return false;
      return entraNaSala(rot);
    }).then(function (ok) {
      if (!ok) return false;
      var uB = uidDe(B.C.id);
      return espera(function () { return A.G.state && A.G.state.phase === 'playing' && turno(A) >= 3; }, 60000).then(function (ok2) {
        if (!ok2) { check(rot + 'a batalha andou 3 turnos', false); return false; }
        bloqueia(B);
        s(function () { B.R._derruba(); });
        return espera(function () { var u = unidade(A, uB); return u && u.ia === true; }, 40000);
      }).then(function (ok3) {
        check(rot + 'o herói da Bia fica marcado fora (o turno passa) no motor da Ana', ok3);
        return espera(function () { return fimDeSala(A); }, 300000);
      }).then(function (ok4) {
        var pa = A.C.dadosTela[A.G.screen] || {};
        check(rot + 'a Ana termina a sala sozinha', ok4, A.G.screen);
        if (A.G.screen !== 'defeat') {
          check(rot + 'a recompensa diz que a Bia não voltou e a descida acabou', pa.descidaAcabou === true && pa.parceiroVoltou === false,
                curto([pa.descidaAcabou, pa.parceiroVoltou]));
        }
        libera(B);
        return espera(function () { return est(A).fase === 'livre'; }, 20000);
      }).then(function (ok5) {
        check(rot + 'e o grupo se desfaz para quem ficou', ok5, est(A).fase);
        return true;
      });
    });
  }


  // ---------------------------------------------------------------- 10. o impostor na praça
  function etapaImpostorPraca() {
    var rot = 'impostor na praça: ';
    libera(B);
    [A, B].forEach(function (L) { if (L.C.tela !== 'hub') L.C.praca(); });
    var forma;
    if (est(A).fase === 'formado' && est(B).fase === 'formado' && est(A).lider === A.C.id) forma = Promise.resolve(true);
    else {
      if (est(A).fase === 'formado') s(function () { return A.Gr.sair('prova'); });
      if (est(B).fase === 'formado') s(function () { return B.Gr.sair('prova'); });
      forma = espera(function () {
        return est(A).fase === 'livre' && est(B).fase === 'livre' && A.C.tela === 'hub' && B.C.tela === 'hub' &&
               s(function () { return A.R.privado() && B.R.privado(); }, false) && temPar(A, B.C.id) && temPar(B, A.C.id);
      }, 20000).then(function (ok) {
        if (!ok) return false;
        var n0 = B.C.convites.length;
        var r = s(function () { return A.Gr.convidar(B.C.id); }, null);
        if (!r || !r.ok) { check(rot + 'a Ana chama a Bia de novo', false, curto(r)); return false; }
        return espera(function () { return B.C.convites.length > n0; }, 6000).then(function () {
          s(function () { return B.Gr.responder(true); });
          return espera(function () { return est(A).fase === 'formado' && est(B).fase === 'formado'; }, 6000);
        });
      });
    }
    return forma.then(function (ok) {
      check(rot + 'o grupo (de novo) formado na praça', ok, curto([est(A).fase, est(B).fase, A.C.tela, B.C.tela]));
      if (!ok) return false;
      var q = 'ev=impostor-praca&a=' + enc(A.C.id) + '&b=' + enc(B.C.id) + '&gid=' + enc(est(B).gid);
      function membroA() { return (est(B).membros || []).filter(function (m) { return m.id === A.C.id; })[0] || {}; }
      return sinal(q).then(function (r) {
        dados.impostorPraca = r;
        check(rot + 'um cliente cru com o id da Ana (conexão própria) mandou à Bia "descer", "lider" e "sair"', r && r.enviados > 0, curto(r));
        return dorme(3000);
      }).then(function () {
        var eb = est(B), mA = membroA();
        check(rot + 'o "descer" forjado não leva a Bia sozinha para a antessala', B.C.tela === 'hub' && B.G.screen !== 'antessala',
              B.C.tela + ' / ' + B.G.screen);
        check(rot + 'o "lider" forjado não troca a liderança', eb.fase === 'formado' && eb.lider === A.C.id,
              curto({ fase: eb.fase, liderAna: eb.lider === A.C.id }));
        check(rot + 'o "sair" forjado (motivo qualquer) não desfaz o grupo da Bia', eb.fase === 'formado' && mA.on !== false && !mA.saiu,
              curto({ fase: eb.fase, on: mA.on, saiu: mA.saiu }));
        return sinal('ev=impostor-fim');
      }).then(function (r) {
        dados.impostorPracaOuviu = r;
        if (est(B).fase !== 'formado') return true;
        return sinal(q + '&expirou=1').then(function (r2) {
          dados.impostorPraca2 = r2;
          return dorme(3000);
        }).then(function () {
          var eb = est(B), mA = membroA();
          check(rot + 'o "sair" forjado com motivo "expirou" (antes o grupo.js aceitava esse sem conferir o cx nem a chave) não desfaz o grupo da Bia',
                eb.fase === 'formado' && mA.on !== false && !mA.saiu, curto({ fase: eb.fase, on: mA.on, saiu: mA.saiu, grupoDaAna: est(A).fase }));
          return sinal('ev=impostor-fim');
        }).then(function () { return true; });
      });
    });
  }

  // ---------------------------------------------------------------- 11. a praça e o duelo
  function etapaPraca() {
    libera(B);
    [A, B].forEach(function (L) { if (L.C.tela !== 'hub') L.C.praca(); });
    return espera(function () { return A.C.tela === 'hub' && B.C.tela === 'hub'; }, 5000).then(function () {
      if (est(A).fase === 'formado') s(function () { return A.Gr.sair('prova'); });
      if (est(B).fase === 'formado') s(function () { return B.Gr.sair('prova'); });
      return espera(function () {
        return est(A).fase === 'livre' && est(B).fase === 'livre' && s(function () { return A.R.privado() && B.R.privado(); }, false) &&
               temPar(A, B.C.id) && temPar(B, A.C.id);
      }, 20000);
    }).then(function (ok) {
      check('praça: os dois livres e ligados, um vendo o outro', ok, curto([est(A).fase, est(B).fase, A.C.tela, B.C.tela]));
      return ok;
    });
  }

  function abertos() {
    var D = A.J.DATA || {};
    return (D.dungeons || []).filter(function (d) {
      return d && d.rooms && d.rooms.length && d.id !== 'poco' && !(D.portalFechado && D.portalFechado(d.id));
    });
  }

  function etapaDuelo() {
    var rot = 'duelo: ';
    var ab = abertos(), idsAb = ab.map(function (d) { return d.id; }).sort();
    var salas = {}, fora = [], nSalas = 0;
    ab.forEach(function (d) { nSalas += d.rooms.length; });
    for (var i = 0; i < 300; i++) {
      var ar = s(function () { return A.Co.sorteiaArena((i * 2654435761) >>> 0); }, null);
      if (!ar || idsAb.indexOf(ar.dungeonId) < 0) { fora.push(curto(ar)); continue; }
      salas[ar.dungeonId + ':' + ar.roomIndex] = true;
    }
    check(rot + 'o sorteio da arena cai sempre num calabouço aberto, e as ' + nSalas + ' salas aparecem (300 sementes)',
          !fora.length && Object.keys(salas).length === nSalas, Object.keys(salas).sort().join(' ') + (fora.length ? ' · fora: ' + fora.slice(0, 2).join(' ') : ''));
    var r = s(function () { return A.Du.desafiar(B.C.id); }, null);
    check(rot + 'a Ana desafia a Bia (Duelo.desafiar → ok)', r && r.ok, curto(r));
    return espera(function () { return B.C.desafios.length > 0; }, 6000).then(function (ok) {
      var d = B.C.desafios[0] || {};
      check(rot + 'o desafio chega à Bia (aoDesafio), com o id e o nome da Ana', ok && d.id === A.C.id && d.nome === 'Ana', curto(d));
      if (!ok) return false;
      s(function () { return B.Du.responder(true); });
      return espera(function () { return du(A).fase === 'escolhendo' && du(B).fase === 'escolhendo'; }, 8000);
    }).then(function (ok) {
      check(rot + 'aceito: os dois escolhem a dupla', ok, du(A).fase + ' / ' + du(B).fase);
      if (!ok) return false;
      check(rot + 'a Ana é o lado A e a Bia o B', du(A).eu === 'A' && du(B).eu === 'B', du(A).eu + ' / ' + du(B).eu);
      [A, B].forEach(function (L) { L.C.pilota({ joga: true, casa: 0 }); });
      var ra = s(function () { return A.Du.escolher(['sumo', 'curandeiro']); }, null);
      var rb = s(function () { return B.Du.escolher(['curandeiro', 'sumo']); }, null);
      check(rot + 'cada um escolhe a SUA dupla (compromisso às cegas)', ra && ra.ok && rb && rb.ok, curto([ra, rb]));
      return espera(function () {
        return A.G.screen === 'battle' && B.G.screen === 'battle' && A.G.state && B.G.state && A.G.state.pvp && B.G.state.pvp;
      }, 40000);
    }).then(function (ok) {
      check(rot + 'os dois caem na arena, cada um no seu motor', ok, A.G.screen + ' / ' + B.G.screen + ' · ' + curto([du(A).fase, du(B).fase]));
      if (!ok) return false;
      var gA = JSON.stringify(A.G.state.grid.tiles), gB = JSON.stringify(B.G.state.grid.tiles);
      check(rot + 'o MESMO mapa nos dois (a mesma grade, casa a casa)', gA === gB, A.G.state.grid.w + 'x' + A.G.state.grid.h + ' / ' + B.G.state.grid.w + 'x' + B.G.state.grid.h);
      var uA = A.G.state.units || [];
      var daAna = uA.filter(function (u) { return u.dono === A.C.id; }), daBia = uA.filter(function (u) { return u.dono === B.C.id; });
      check(rot + 'cada um com a sua dupla: a da Ana no lado A (player), a da Bia no B (enemy)',
            daAna.length === 2 && daBia.length === 2 && daAna.every(function (u) { return u.side === 'player'; }) &&
            daBia.every(function (u) { return u.side === 'enemy'; }), curto(uA.map(function (u) { return [u.heroId || u.defId, u.side, u.dono === A.C.id ? 'A' : (u.dono === B.C.id ? 'B' : '-')]; })));
      check(rot + 'sem monstros e sem pets na arena', uA.every(function (u) { return u.kind === 'hero'; }), curto(uA.map(function (u) { return u.kind; })));
      check(rot + 'a perspectiva é só de tela: meuLado player na Ana, enemy na Bia',
            s(function () { return A.G.meuLado(); }, '?') === 'player' && s(function () { return B.G.meuLado(); }, '?') === 'enemy',
            curto([s(function () { return A.G.meuLado(); }, '?'), s(function () { return B.G.meuLado(); }, '?')]));
      var hs = comparaHashes();
      check(rot + 'o mesmo hash no começo', hs.comuns >= 1 && !hs.dif.length, hs.comuns + ' ' + hs.dif.slice(0, 2).join(' '));
      return espera(function () { return A.G.screen === 'duelFim' && B.G.screen === 'duelFim'; }, 480000);
    }).then(function (ok) {
      if (ok === false && A.G.screen !== 'duelFim' && B.G.screen !== 'duelFim' && !(A.G.state && A.G.state.pvp)) return false;
      check(rot + 'os dois chegam ao fim do duelo', ok, A.G.screen + ' / ' + B.G.screen + ' · turno ' + turno(A) + '/' + turno(B));
      if (!ok) return false;
      var fa = A.C.dadosTela.duelFim || {}, fb = B.C.dadosTela.duelFim || {};
      check(rot + 'o fim é de rede nos dois (rede:true)', fa.rede === true && fb.rede === true, curto([fa.rede, fb.rede]));
      check(rot + 'o resultado bate: um vence e o outro perde, ou empate nos dois',
            (fa.empate === true && fb.empate === true) || (!fa.empate && !fb.empate && !!fa.venci !== !!fb.venci),
            curto([fa.venci, fa.empate, fb.venci, fb.empate]));
      var ar1 = fa.arena || {}, ar2 = fb.arena || {};
      // 14/09 (o dono): "o duelo deve ocorrer no mapa da praça" — o desafio amistoso não sorteia
      check(rot + 'o mapa é o mesmo nos dois e é a PRAÇA (o desafio amistoso)', ar1.dungeonId === 'praca' && ar1.dungeonId === ar2.dungeonId &&
            ar1.roomIndex === 0 && ar2.roomIndex === 0 && fa.modo === 'desafio' && fb.modo === 'desafio', curto([ar1, ar2, fa.modo]));
      check(rot + 'cada um vê o outro como oponente', String(fa.oponente).indexOf('Bia') >= 0 && String(fb.oponente).indexOf('Ana') >= 0,
            curto([fa.oponente, fb.oponente]));
      var hA = hashDe(A), hB = hashDe(B);
      check(rot + 'o MESMO hash no fim do duelo', hA !== null && hA === hB, hA + ' / ' + hB);
      var hs = comparaHashes();
      check(rot + 'o mesmo hash em todo turno', hs.comuns >= 2 && !hs.dif.length, hs.comuns + ' ' + hs.dif.slice(0, 3).join(' '));
      var lg = comparaLogs(null, null, 0);
      check(rot + 'a mesma lista de lances nos dois', lg.iguais && lg.nA > 0, lg.nA + ' / ' + lg.nB);
      dados.duelo = { venciA: fa.venci, venciB: fb.venci, empate: fa.empate, arena: ar1, turno: turno(A), lances: lg.nA };
      guarda();
      var hist = [[], []];
      function leHist() {
        A.J.DB.historicoPvp().then(function (h) { hist[0] = h || []; });
        B.J.DB.historicoPvp().then(function (h) { hist[1] = h || []; });
      }
      function dele(i, nome) { return hist[i].filter(function (x) { return String(x.oponente).indexOf(nome) >= 0; }).pop(); }
      return espera(function () { leHist(); return !!(dele(0, 'Bia') && dele(1, 'Ana')); }, 15000).then(function () {
        var ea = dele(0, 'Bia') || {}, eb = dele(1, 'Ana') || {};
        check(rot + 'o histórico local de cada um guarda o duelo de rede (amistoso)', /-rede|-wo/.test(ea.resultado || '') &&
              /-rede|-wo/.test(eb.resultado || ''), curto([ea.resultado, eb.resultado]));
        return true;
      });
    });
  }

  // ---------------------------------------------------------------- o roteiro
  var ROTEIRO = [
    ['conexão', etapaConexao, null, 'tudo grupo duelo conexao social'],
    ['sussurro', etapaSussurro, 'conexão', 'tudo grupo conexao social'],
    ['grupo', etapaGrupo, 'conexão', 'tudo grupo social'],
    ['liderança', etapaLideranca, 'grupo', 'tudo grupo social'],
    ['sala 1', etapaSala1, 'liderança', 'tudo grupo'],
    ['sala 2 (queda longa)', etapaSala2, 'sala 1', 'tudo grupo'],
    ['sala 3 (queda curta)', etapaSala3, 'sala 2 (queda longa)', 'tudo grupo'],
    ['cisterna 1 (relógio, foto e fusão)', etapaCisterna1, 'sala 3 (queda curta)', 'tudo grupo'],
    ['sem volta', etapaSemVolta, 'cisterna 1 (relógio, foto e fusão)', 'tudo grupo'],
    ['impostor na praça', etapaImpostorPraca, 'grupo', 'tudo grupo social'],
    ['praça', etapaPraca, 'conexão', 'tudo duelo'],
    ['duelo', etapaDuelo, 'praça', 'tudo duelo']
  ];
  function fim() {
    if (A && A.C) s(function () { A.C.para(); });
    if (B && B.C) s(function () { B.C.para(); });
    dados.falhas = falhas;
    dados.total = total;
    dados.errosA = A ? A.C.erros.slice(-10) : [];
    dados.errosB = B ? B.C.erros.slice(-10) : [];
    guarda();
    var sum = document.getElementById('summary');
    sum.textContent = falhas ? ('FALHOU — ' + falhas + ' de ' + total) : ('tudo passou (' + total + ')');
  }
  function roda(i) {
    if (i >= ROTEIRO.length) return fim();
    var e = ROTEIRO[i], nome = e[0], dep = e[2];
    if (e[3].split(' ').indexOf(MODO) < 0) return roda(i + 1);
    if (dep && dados.etapas[dep] !== true) {
      dados.etapas[nome] = 'pulada';
      check(nome + ': não rodou (a etapa "' + dep + '" não passou)', false);
      return roda(i + 1);
    }
    var t0 = Date.now();
    var p;
    try { p = e[1](); } catch (ex) { p = Promise.resolve('exceção: ' + ex); }
    return Promise.resolve(p).then(function (ok) {
      if (ok !== true && ok !== false) check(nome + ': a etapa terminou sem erro de script', false, curto(ok));
      dados.etapas[nome] = ok === true;
      nota(nome + ': ' + (ok === true ? 'concluída' : 'interrompida') + ' em ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s (relógio da página)');
      guarda();
      return roda(i + 1);
    }, function (ex) {
      check(nome + ': a etapa terminou sem erro de script', false, String(ex && (ex.stack || ex)).slice(0, 300));
      dados.etapas[nome] = false;
      guarda();
      return roda(i + 1);
    });
  }
  roda(0);
})();
</script>
</body></html>
"""


# ================================================================ o Chrome
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


def roda_chrome(url, saida, baixa, budget):
    """UM Chrome headless, em prioridade baixa e perfil descartável. Com `baixa`
    (--chrome-baixa CAMINHO, ou SOTERRA_CHROME_BAIXA) quem abre o Chrome é esse
    lançador; sem ele, o daqui faz o mesmo."""
    if baixa:
        subprocess.run([sys.executable, baixa, url, saida, str(budget)], capture_output=True, timeout=3600,
                       creationflags=BAIXA)
    else:
        chrome = next((c for c in CHROMES if os.path.exists(c)), None)
        if not chrome:
            return None
        limita_nucleos()
        perfil = tempfile.mkdtemp(prefix='multijogador-chrome-')
        try:
            with open(saida, 'wb') as f:
                subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                                '--user-data-dir=' + perfil, '--virtual-time-budget=%d' % budget, '--dump-dom', url],
                               stdout=f, stderr=subprocess.DEVNULL, timeout=3600, creationflags=BAIXA)
        finally:
            shutil.rmtree(perfil, ignore_errors=True)
    try:
        return open(saida, encoding='utf-8', errors='replace').read()
    except OSError:
        return ''


def le_pagina(dom):
    """As linhas PASSOU/FALHOU da página viram checks daqui; devolve os dados."""
    m = re.search(r'id="summary"[^>]*>([^<]*)<', dom or '')
    resumo = html.unescape(m.group(1)) if m else '(sem página)'
    for l in re.findall(r'<div>((?:PASSOU|FALHOU|NOTA) · [^<]*)</div>', dom or ''):
        l = html.unescape(l)
        if l.startswith('NOTA'):
            print(l, flush=True)
            continue
        corpo = l.split(' · ', 1)[1]
        nome, _, extra = corpo.partition(' — ')
        check('página: ' + nome, l.startswith('PASSOU'), extra)
    check('página: chegou ao fim (%s)' % resumo, not resumo.startswith('rodando') and resumo != '(sem página)')
    d = re.search(r'<pre id="dados">([^<]*)</pre>', dom or '')
    try:
        return json.loads(html.unescape(d.group(1))) if d and d.group(1).strip() else {}
    except Exception:
        return {}


def main(argumentos):
    def opcao(nome, padrao=None):
        if nome in argumentos:
            i = argumentos.index(nome)
            return argumentos[i + 1] if i + 1 < len(argumentos) else padrao
        return padrao

    baixa = opcao('--chrome-baixa', os.environ.get('SOTERRA_CHROME_BAIXA'))
    budget = int(opcao('--budget', '1800000'))
    modo = opcao('--modo', 'tudo')
    saida = opcao('--saida')
    if not baixa and not any(os.path.exists(c) for c in CHROMES):
        check('há um Chrome para a prova', False)
        return 1
    pasta = saida or tempfile.mkdtemp(prefix='multijogador-')
    os.makedirs(pasta, exist_ok=True)
    prova = Prova()
    http = None
    texto_log = ''
    dados = {}
    try:
        prova.rele = Rele()
        check('o relé de verdade subiu (porta %d)' % prova.rele.porta, prova.rele.ok)
        if not prova.rele.ok:
            return 1
        Pedidos.prova = prova
        http = ThreadingHTTPServer(('127.0.0.1', 0), Pedidos)
        http.daemon_threads = True
        threading.Thread(target=http.serve_forever, daemon=True).start()
        base = 'http://127.0.0.1:%d' % http.server_address[1]

        # a intrusa: na praça, perto dos dois, ouvindo tudo o que o relé lhe der
        prova.intrusa = Cru(prova.rele.url)
        prova.intrusa.manda({'t': 'oi', 'de': INTRUSA, 'v': 2, 'nome': 'Intrusa', 'titulo': '', 'classe': 'sumo',
                             'x': 0.8, 'z': 9.0, 'sala': None})
        parar = threading.Event()

        def pulsa():
            while not parar.wait(4.0):
                try:
                    prova.intrusa.manda({'t': 'pulso', 'de': INTRUSA, 'x': 0.8, 'z': 9.0, 'sala': None})
                except Exception:
                    return
        threading.Thread(target=pulsa, daemon=True).start()

        url = '%s/__prova/dupla.html?rede=%s&modo=%s&intrusa=%s' % (base, prova.rele.url, modo, INTRUSA)
        print('página: %s (budget virtual %d ms)' % (url, budget), flush=True)
        t0 = time.time()
        dom = roda_chrome(url, os.path.join(pasta, 'dupla.dom.html'), baixa, budget)
        print('o Chrome rodou em %.0f s' % (time.time() - t0), flush=True)
        if dom is None:
            check('há um Chrome para a prova', False)
            return 1
        dados = le_pagina(dom)
        parar.set()
        time.sleep(0.5)
        ouvidos = prova.intrusa.lista()
        prova.intrusa.fecha()
    finally:
        if prova.impostor is not None:
            prova.impostor.fecha()
        if prova.rele is not None:
            texto_log = prova.rele.fecha()
        if http is not None:
            http.shutdown()

    # ---------------------------------------------------------- o que a intrusa ouviu
    abertos = [abre_json(s) or {} for s in ouvidos]
    dirigidos = [m for m in abertos if m.get('t') in DIRIGIDOS and m.get('para') != INTRUSA]
    check('a intrusa na praça não recebeu NENHUM envelope dirigido a outra pessoa (%d mensagens ouvidas)' % len(abertos),
          not dirigidos, repr([(m.get('t'), m.get('acao'), m.get('de'), m.get('para')) for m in dirigidos[:5]]))
    segredos = [x for x in (dados.get('segredos') or []) if x]
    check('a página guardou os segredos das mensagens particulares', len(segredos) == 2, repr(segredos))
    vazou = [x for x in segredos if any(x in s for s in ouvidos)]
    check('nenhuma mensagem particular chegou à intrusa', segredos and not vazou, repr(vazou))
    vistos = sorted({m.get('t') for m in abertos if m.get('t')})
    print('NOTA · a intrusa ouviu os tipos: %s' % ', '.join(vistos), flush=True)
    imp = dados.get('impostorOuviu') or {}
    if imp:
        print('NOTA · o impostor ouviu: %s' % json.dumps(imp, ensure_ascii=False), flush=True)

    # ---------------------------------------------------------- o log do relé
    check('o log do relé não tem o texto de nenhuma mensagem particular', segredos and not any(x in texto_log for x in segredos))
    excecoes = [l for l in texto_log.splitlines() if 'Traceback' in l or 'Exception' in l or 'ERROR' in l]
    check('o relé não teve exceção durante a prova', not excecoes, ' | '.join(excecoes[:3]))
    with open(os.path.join(pasta, 'rele.log'), 'w', encoding='utf-8') as f:
        f.write(texto_log)
    with open(os.path.join(pasta, 'dados.json'), 'w', encoding='utf-8') as f:
        json.dump(dados, f, ensure_ascii=False, indent=1)
    print('NOTA · o DOM, o log do relé e os dados ficaram em %s' % pasta, flush=True)

    total, bons = len(RESULTADOS), sum(RESULTADOS)
    print('\n%s — %d de %d' % ('TUDO PASSOU' if bons == total else 'FALHOU', bons, total), flush=True)
    if not saida:
        shutil.rmtree(pasta, ignore_errors=True)
    return 0 if bons == total else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
