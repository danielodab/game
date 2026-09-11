#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A CARGA SOB DEMANDA: o jogo abre baixando só o necessário, e cada calabouço
baixa os seus modelos na hora de descer?

    python tests/sob_demanda.py              # o roteiro inteiro (menu, Acampamento, Estufa, Cisterna, Poço, falha)
    python tests/sob_demanda.py --so-abrir   # só até o Acampamento (bytes e tempo) — serve também no código antigo
    python tests/sob_demanda.py --banda 10   # o servidor entrega a 10 MB/s no total (uma conexão de verdade)

Monta o pacote como tests/pacote_servido.py (a lista do tools/sobe_vps.py), roda
nele o servidor/coolify/versao.py e serve com um http.server que ANOTA cada
pedido (fase, código, bytes, instante real) e sabe FALHAR de propósito: um
modelo marcado devolve 503 até a prova mandar parar. Abre o jogo no Chrome
headless, em prioridade baixa, por uma SONDA — uma página fora do pacote que
põe o index.html num quadro e conduz o roteiro pela API do jogo:

  1. chega ao menu: quantos bytes e quanto tempo, e que só a BASE desceu;
  2. entra no Acampamento e espera a praça de pé (construções e enfeites);
  3. desce na Estufa: os modelos dela (cenário, monstros, o que eles invocam)
     chegaram e abriram antes da antessala; entra na batalha e confere que os
     monstros vestem o corpo DELES e que o cenário do usuário está na cena;
  4. o mesmo na Cisterna;
  5. o Poço: a sala sorteada diz o que baixar, e a batalha desenha com eles;
  6. a FALHA: o corpo da fusão da dupla nova devolve 503 — a descida mostra o
     aviso com "Tentar de novo"; a prova libera o arquivo, toca no botão, e a
     descida segue com o modelo aberto;
  7. nenhum 404 na viagem inteira; portal fechado não entra na pré-busca.
Depois de escrever o resultado a sonda derruba o quadro: o resto do tempo
virtual passa sem desenhar nada (a máquina é compartilhada).
"""
import argparse
import functools
import html
import http.server
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import urllib.parse

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.dont_write_bytecode = True
import pacote_servido as ps  # noqa: E402

MB = ps.MB
# o modelo que a prova derruba: o corpo da fusão Bárbaro + Curandeira, que
# nenhuma das três primeiras descidas (Bárbaro sozinho) pede
FALHA = 'fus_curandeiro_sumo'

SONDA = r'''<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>sonda da carga sob demanda</title></head>
<body style="margin:0;background:#000">
<div id="summary">rodando</div>
<pre id="sonda"></pre>
<iframe id="jogo" src="/index.html" style="width:640px;height:400px;border:0"></iframe>
<script>
(function () {
  var qs = location.search;
  var SO_ABRIR = /[?&]so=abrir/.test(qs);
  var m = /[?&]limite=(\d+)/.exec(qs), LIMITE = m ? +m[1] : 600000;
  var FALHA = (/[?&]falha=([^&]+)/.exec(qs) || [])[1] || '';
  var t0 = Date.now();
  var R = { marcos: {}, passos: {}, erros: [] };
  function avisa(caminho) {
    try { var x = new XMLHttpRequest(); x.open('GET', caminho, false); x.send(); } catch (e) {}
  }
  function marco(nome, extra) {
    R.marcos[nome] = { ms: Date.now() - t0 };
    if (extra) R.passos[nome] = extra;
    avisa('/__marco?nome=' + encodeURIComponent(nome));
  }
  function W() { return document.getElementById('jogo').contentWindow; }
  function J() { var w = W(); return (w && w.JOGO) || {}; }
  function D() { return document.getElementById('jogo').contentDocument; }
  function temDescer() {
    var d = D();
    if (!d || !d.body) return false;
    var els = d.querySelectorAll('button');
    for (var i = 0; i < els.length; i++) {
      if ((els[i].textContent || '').replace(/\s+/g, ' ').trim() === 'Descer') return true;
    }
    return false;
  }
  function info() { var B = J().Bundle; return B && B.info ? JSON.parse(JSON.stringify(B.info())) : null; }
  function cargaVisivel() { var c = D() && D().getElementById('carga'); return !!(c && !c.hidden); }
  function decod(k) { var M = J().Models3D2; return !!(M && M.decodificado ? M.decodificado(k) : (M && M.hasModel && M.hasModel(k))); }

  // o que a batalha montou: o corpo de cada inimigo e as pecas do cenario do usuario
  function batalha(tema) {
    var Jg = J(), G = Jg.Game, Rr = Jg.Renderer, M = Jg.Models3D2, out = { inimigos: [], pecas: 0, stats: null };
    try { out.stats = Rr.stats(); } catch (e) {}
    try {
      (G.state.units || []).forEach(function (u) {
        if (u.side !== 'enemy') return;
        var no = Rr.unitNode(u.uid || u.id);
        var look = no && no.userData && no.userData.look;
        var quer = M.lookFor(u.defId).model;
        out.inimigos.push({ id: u.defId, quer: quer, veste: look ? look.model : null,
                            aberto: decod(quer), no: !!no });
      });
    } catch (e) { out.erro = String(e && e.message || e); }
    // O CENÁRIO: varrer a cena não serve — as malhas estáticas são fundidas
    // por material e os berços somem no merge. O montador anota quantas vezes
    // cada peça entrou (Renderer.ultimaMontagem), e é dali que se lê.
    try {
      var cat = (Jg.CENARIO || {})[tema] || {}, chaves = {};
      Object.keys(cat).forEach(function (p) { if (Array.isArray(cat[p])) cat[p].forEach(function (k) { chaves[k] = 1; }); });
      var uso = Rr.ultimaMontagem || {};
      out.pecas_usadas = [];
      Object.keys(uso).forEach(function (k) {
        if (!chaves[k]) return;
        out.pecas += uso[k];
        out.pecas_usadas.push(k + (decod(k) ? '' : '(FECHADA)'));
      });
    } catch (e2) { out.erroCena = String(e2 && e2.message || e2); }
    return out;
  }

  var passos = [], ativo = 0, esperaDesde = 0;
  function passo(nome, fn) { passos.push({ nome: nome, fn: fn }); }
  function espera(cond, depois, limiteMs) {
    return function () {
      var ok = false;
      try { ok = cond(); } catch (e) { ok = false; }
      if (ok) { depois(); return true; }
      if (Date.now() - esperaDesde > (limiteMs || 120000)) {
        R.erros.push('esgotou: ' + passos[ativo].nome);
        // o retrato de quando travou: a tela, a #carga, a fila e o decodificador
        try {
          var Jg = J(), ct = D().getElementById('carga-txt');
          R.diag = { tela: Jg.Game && Jg.Game.screen, carga: cargaVisivel(), carga_txt: ct ? ct.textContent : null,
                     fila: Jg.Bundle && Jg.Bundle.diag ? Jg.Bundle.diag() : null,
                     novos: Jg.Models3D2 && Jg.Models3D2._novosEstado ? Jg.Models3D2._novosEstado() : null,
                     ganchos: (info() || {}).ganchos, erros_bundle: ((info() || {}).erros || []).slice(0, 4) };
        } catch (eD) { R.diag = { erro: String(eD && eD.message || eD) }; }
        return 'desiste';
      }
      return false;
    };
  }

  // ---- 1. o menu
  passo('menu', espera(function () {
    var Jg = J();
    return temDescer() && Jg.Models3D2 && Jg.Models3D2.isReady() && Jg.Models3D && Jg.Models3D.isReady() &&
           W().__BOOT_MS !== undefined;
  }, function () {
    var Jg = J(), M = Jg.MODELS || {};
    marco('menu', { boot_ms: W().__BOOT_MS, modelos_em_maos: Object.keys(M).length,
                    decodificados: Jg.Models3D2.modelKeys().length, bundle: info(),
                    sob_demanda: !!(Jg.Bundle.sobDemanda && Jg.Bundle.sobDemanda()) });
    Jg.UI.selection(['sumo']);
    // a pré-busca baixa, mas NÃO abre: a Cisterna vai encontrar os modelos
    // baixados e fechados — o caminho em que o gancho só decodifica
    if (!SO_ABRIR && Jg.Bundle.pausaDecodificacao) Jg.Bundle.pausaDecodificacao(true);
    Jg.UI.showScreen('hub');
  }, 240000));
  // ---- 2. o Acampamento de pe
  passo('acampamento', espera(function () {
    var H = J().Hub, e = H && H._estado ? H._estado() : null;
    return e && e.construcoes && e.enfeites;
  }, function () {
    var Jg = J(), B = Jg.Bundle;
    var fechados = [], ordem = [];
    try {
      ordem = B.ordemDaPreBusca ? B.ordemDaPreBusca() : [];
      var abertas = {};
      (Jg.DATA.dungeons || []).forEach(function (dg) {
        if (!dg || dg.id === 'poco') return;
        var ks = B.plano({ dungeonId: dg.id, party: [] });
        if (Jg.DATA.portalFechado(dg.id)) fechados.push({ id: dg.id, chaves: ks });
        else ks.forEach(function (k) { abertas[k] = 1; });
      });
      fechados.forEach(function (f) { f.chaves = f.chaves.filter(function (k) { return !abertas[k]; }); });
    } catch (e) {}
    var naOrdem = {};
    ordem.forEach(function (k) { naOrdem[k] = 1; });
    var vazou = [];
    fechados.forEach(function (f) { f.chaves.forEach(function (k) { if (naOrdem[k]) vazou.push(f.id + ':' + k); }); });
    marco('acampamento', { bundle: info(), ordem: ordem.length, fechados: fechados.map(function (f) { return f.id; }),
                           fechados_chaves: fechados.reduce(function (n, f) { return n + f.chaves.length; }, 0),
                           vazou: vazou });
    if (SO_ABRIR) return;
  }, 240000));

  function descida(rotulo, tema, comeca) {
    var plano = null, viuCarga = false;
    passo(rotulo + ':desce', function () {
      var Jg = J();
      marco(rotulo + ':desce');
      plano = Jg.Bundle.plano(comeca.pedido);
      var ok = comeca.fn(Jg);
      viuCarga = cargaVisivel();
      R.passos[rotulo + ':desce'] = { plano: plano.length, faltavam: plano.filter(function (k) { return !decod(k); }).length,
                                      aceitou: ok, carga_na_hora: viuCarga };
      return true;
    });
    passo(rotulo + ':antessala', espera(function () {
      if (cargaVisivel()) viuCarga = true;
      return J().Game.screen === 'antessala' && !cargaVisivel();
    }, function () {
      var faltando = plano.filter(function (k) { return !decod(k); });
      marco(rotulo + ':antessala', { plano: plano.length, faltando: faltando, carga_apareceu: viuCarga, bundle: info() });
      J().Game.entrarNaSala();
    }));
    passo(rotulo + ':batalha', espera(function () {
      var Jg = J(), st = null;
      try { st = Jg.Renderer.stats(); } catch (e) {}
      return Jg.Game.screen === 'battle' && st && st.units > 0 && st.tris > 0 && st.calls > 0;
    }, function () {
      marco(rotulo + ':batalha', batalha(tema));
      var Jg = J();
      Jg.Game.restart();
      Jg.UI.showScreen('hub');
    }));
  }

  if (!SO_ABRIR) {
    descida('estufa', 'garden', { pedido: { dungeonId: 'greenhouse', party: ['sumo'], sala: 0 },
      fn: function (Jg) { return Jg.Game.startRun(['sumo'], 'greenhouse'); } });
    // a Cisterna espera a pré-busca terminar de BAIXAR o que ela usa (a
    // decodificação segue pausada): a descida só precisa abrir, não baixar
    passo('cisterna:prebusca', espera(function () {
      var B = J().Bundle, ks = B.plano({ dungeonId: 'cistern', party: ['sumo'], sala: 0 });
      return ks.length && ks.every(function (k) { return B.estadoDe(k) === 'chegou' || decod(k); });
    }, function () {
      var B = J().Bundle, ks = B.plano({ dungeonId: 'cistern', party: ['sumo'], sala: 0 });
      marco('cisterna:prebusca', { plano: ks.length, baixados_fechados: ks.filter(function (k) { return !decod(k); }).length,
                                   pre: (info() || {}).pre });
    }));
    descida('cisterna', 'cistern', { pedido: { dungeonId: 'cistern', party: ['sumo'], sala: 0 },
      fn: function (Jg) { return Jg.Game.startRun(['sumo'], 'cistern'); } });
    passo('cisterna:solta', function () {
      if (J().Bundle.pausaDecodificacao) J().Bundle.pausaDecodificacao(false);
      return true;
    });
    // o Poco: o plano so existe depois do sorteio (preparar), entao a sonda pergunta depois
    passo('poco:desce', function () {
      var Jg = J();
      marco('poco:desce');
      var ok = Jg.Game.startPoco(['sumo']);
      R.passos['poco:desce'] = { aceitou: ok, carga_na_hora: cargaVisivel() };
      return true;
    });
    passo('poco:antessala', espera(function () { return J().Game.screen === 'antessala' && !cargaVisivel(); }, function () {
      var Jg = J(), plano = Jg.Bundle.plano({ dungeonId: 'poco', sala: 0, party: ['sumo'] });
      var sala = Jg.DATA.dungeons.filter(function (d) { return d.id === 'poco'; })[0].rooms[0];
      marco('poco:antessala', { plano: plano.length, faltando: plano.filter(function (k) { return !decod(k); }),
                                monstros: Object.keys(sala.monsters).map(function (k) { return sala.monsters[k]; }),
                                tema: sala.sceneryTheme, bundle: info() });
      R.temaPoco = sala.sceneryTheme;
      Jg.Game.entrarNaSala();
    }));
    passo('poco:batalha', espera(function () {
      var Jg = J(), st = null;
      try { st = Jg.Renderer.stats(); } catch (e) {}
      return Jg.Game.screen === 'battle' && st && st.units > 0 && st.tris > 0;
    }, function () {
      marco('poco:batalha', batalha(R.temaPoco));
      var Jg = J();
      Jg.Game.restart();
      Jg.UI.selection(['sumo', 'curandeiro']);
      Jg.UI.showScreen('hub');
    }));
    // ---- 6. a falha de rede num modelo, o aviso e a volta
    var textoAviso = '';
    passo('falha:desce', function () {
      var Jg = J();
      marco('falha:desce');
      var ok = Jg.Game.startRun(['sumo', 'curandeiro'], 'greenhouse');
      R.passos['falha:desce'] = { aceitou: ok, carga_na_hora: cargaVisivel(), aberto_antes: decod(FALHA) };
      return true;
    });
    passo('falha:aviso', espera(function () {
      var b = D().querySelector('#carga .carga-tentar');
      if (b) textoAviso = (D().getElementById('carga-txt') || {}).textContent || '';
      return !!b;
    }, function () {
      marco('falha:aviso', { texto: textoAviso, seguir: !!D().querySelector('#carga .carga-seguir'),
                             tela: J().Game.screen, bundle: info() });
      avisa('/__falha?chave=' + encodeURIComponent(FALHA) + '&vezes=0');
      D().querySelector('#carga .carga-tentar').click();
    }));
    passo('falha:recuperou', espera(function () { return J().Game.screen === 'antessala' && !cargaVisivel(); }, function () {
      marco('falha:recuperou', { aberto: decod(FALHA), bundle: info() });
    }));
  }

  function fim(estado) {
    R.total_ms = Date.now() - t0;
    document.getElementById('sonda').textContent = JSON.stringify(R);
    document.getElementById('summary').textContent = estado;
    // o jogo sai do quadro: o resto do tempo virtual passa sem desenhar nada
    var f = document.getElementById('jogo');
    if (f && f.parentNode) f.parentNode.removeChild(f);
  }
  function roda() {
    if (Date.now() - t0 > LIMITE) { R.erros.push('limite geral'); return fim('NAO CHEGOU'); }
    if (ativo >= passos.length) return fim('PRONTO');
    var r = false;
    try { r = passos[ativo].fn(); } catch (e) { R.erros.push(passos[ativo].nome + ': ' + (e && e.message || e)); r = 'desiste'; }
    if (r === 'desiste') return fim('NAO CHEGOU');
    if (r) { ativo++; esperaDesde = Date.now(); }
    setTimeout(roda, 250);
  }
  esperaDesde = Date.now();
  setTimeout(roda, 500);
})();
</script>
</body></html>
'''


class Banda(object):
    """Um balde de fichas para o servidor inteiro: `banda` MB/s somando todos
    os pedidos paralelos — uma conexão de verdade, não uma por arquivo."""

    def __init__(self, mbps):
        self.taxa = float(mbps) * MB
        self.trava = threading.Lock()
        self.livre = time.time()

    def consome(self, n):
        if self.taxa <= 0:
            return
        with self.trava:
            agora = time.time()
            inicio = max(agora, self.livre)
            self.livre = inicio + n / self.taxa
            espera = self.livre - agora
        if espera > 0:
            time.sleep(espera)


def servidor(raiz, registro, banda, falhas):
    """http.server na pasta do pacote, que anota cada pedido (com o instante
    real) e sabe falhar: `falhas[chave_do_modelo]` = quantas vezes devolver 503.
    /__sd.html é a sonda; /__marco?nome= muda a fase; /__falha?chave=&vezes= ajusta."""

    class Atendente(http.server.SimpleHTTPRequestHandler):
        def _corpo(self, corpo, tipo):
            self.send_response(200)
            self.send_header('Content-Type', tipo)
            self.send_header('Content-Length', str(len(corpo)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(corpo)

        def do_GET(self):
            caminho, _, query = self.path.partition('?')
            q = ps._query(query)
            if caminho == '/__sd.html':
                return self._corpo(SONDA.encode('utf-8'), 'text/html; charset=utf-8')
            if caminho == '/__marco':
                nome = urllib.parse.unquote(q.get('nome', ''))
                registro.marcos.append((nome, time.time()))
                registro.fase = nome
                return self._corpo(b'ok', 'text/plain')
            if caminho == '/__falha':
                falhas[q.get('chave', '')] = int(q.get('vezes', '0') or 0)
                return self._corpo(b'ok', 'text/plain')
            m = re.match(r'^/assets/models/bundle/[^/]+/([^/]+)\.glb$', caminho)
            if m and falhas.get(m.group(1), 0) > 0:
                falhas[m.group(1)] -= 1
                self.send_response(503)
                self.send_header('Content-Length', '0')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                return
            return http.server.SimpleHTTPRequestHandler.do_GET(self)

        def log_request(self, code='-', size='-'):
            caminho, _, query = self.path.partition('?')
            self._reg = {'fase': registro.fase, 'caminho': caminho, 'query': query,
                         'codigo': str(getattr(code, 'value', code)), 'bytes': 0, 't': time.time()}
            registro.pedidos.append(self._reg)

        def copyfile(self, source, outputfile):
            n = 0
            while True:
                bloco = source.read(64 * 1024)
                if not bloco:
                    break
                banda.consome(len(bloco))
                outputfile.write(bloco)
                n += len(bloco)
            if getattr(self, '_reg', None) is not None:
                self._reg['bytes'] += n

        def log_message(self, *a):
            pass

    porta = ps.porta_livre()
    srv = ps._Servidor(('127.0.0.1', porta), functools.partial(Atendente, directory=raiz))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, 'http://127.0.0.1:%d/' % porta


def sonda(chrome, perfil, base, budget, so_abrir):
    url = base + '__sd.html?limite=%d&falha=%s%s' % (max(5000, budget - 10000), FALHA, '&so=abrir' if so_abrir else '')
    dump = ps._chrome(chrome, perfil, url, budget)
    m = re.search(r'<pre id="sonda">(.*?)</pre>', dump, re.S)
    s = re.search(r'id="summary"[^>]*>([^<]*)<', dump)
    if not m or not m.group(1).strip():
        return {'erro': 'a sonda não escreveu nada (DOM de %d bytes)' % len(dump)}, (s.group(1) if s else '')
    try:
        return json.loads(html.unescape(m.group(1))), (s.group(1) if s else '')
    except ValueError:
        return {'erro': 'sonda ilegível: ' + m.group(1)[:300]}, (s.group(1) if s else '')


def main():
    ap = argparse.ArgumentParser(description='a carga sob demanda')
    ap.add_argument('--so-abrir', action='store_true', help='só até o Acampamento (serve no código antigo)')
    ap.add_argument('--banda', type=float, default=0, help='MB/s no total (0 = sem freio)')
    ap.add_argument('--budget', type=int, default=420000, help='tempo virtual do Chrome em ms')
    ap.add_argument('--head', action='store_true', help='o pacote do último commit (não o do disco)')
    a = ap.parse_args()
    chrome = ps.acha_chrome()
    if not chrome:
        print('sem Chrome/Edge para a prova headless')
        return 2
    pasta = tempfile.mkdtemp(prefix='soterra-sd-')
    try:
        raiz, _, _, sv = ps.prepara(pasta, arvore=not a.head)
        if sv:
            print('  ' + sv)
        man = json.loads(ps.ler(ps.MANIFESTO, raiz))
        grupo = {it['chave']: it.get('grupo') for it in man['itens'] if it['alvo'] == 'MODELS'}
        bytes_grupo = {}
        for it in man['itens']:
            g = it.get('grupo') or '(sem grupo)'
            bytes_grupo[g] = bytes_grupo.get(g, 0) + it['bytes']
        registro = ps.Registro()
        registro.fase = 'boot'
        registro.marcos = []
        falhas = {} if a.so_abrir else {FALHA: 10 ** 6}
        banda = Banda(a.banda)
        srv, base = servidor(raiz, registro, banda, falhas)
        t_chrome = time.time()
        try:
            r, resumo_sonda = sonda(chrome, os.path.join(pasta, 'perfil'), base, a.budget, a.so_abrir)
        finally:
            srv.shutdown()
        dur = time.time() - t_chrome
        print('  sonda: %s — %.0f s de relógio, %s ms virtuais' % (resumo_sonda, dur, r.get('total_ms')))
        if r.get('erros'):
            print('  erros da sonda: ' + '; '.join(r['erros'][:5]))
        if r.get('diag'):
            print('  onde travou: ' + json.dumps(r['diag'], ensure_ascii=False)[:1500])

        pedidos = registro.pedidos
        t_ini = min([p['t'] for p in pedidos if not p['caminho'].startswith('/__')] or [t_chrome])
        marcos = dict(registro.marcos)

        def fase(*nomes):
            return [p for p in pedidos if p['fase'] in nomes and not p['caminho'].startswith('/__')]

        def mb(n):
            return '%.1f MB' % (n / MB)

        ate_menu = ps.contas(fase('boot'))
        ate_acamp = ps.contas(fase('boot', 'menu'))
        passos = r.get('passos') or {}
        pm = passos.get('menu') or {}
        pa = passos.get('acampamento') or {}
        seg_menu = (marcos['menu'] - t_ini) if 'menu' in marcos else None
        seg_acamp = (marcos['acampamento'] - t_ini) if 'acampamento' in marcos else None
        print('  até o menu: %s em %d arquivos (modelos %s) · %s s de relógio · boot %s ms virtuais'
              % (mb(ate_menu['total']), ate_menu['n200'], mb(ate_menu['modelos']),
                 '%.1f' % seg_menu if seg_menu is not None else '?', pm.get('boot_ms')))
        print('  até o Acampamento pronto: %s · %s s de relógio'
              % (mb(ate_acamp['total']), '%.1f' % seg_acamp if seg_acamp is not None else '?'))

        ps.check('o jogo chega ao menu (Descer), com os modelos da base prontos', 'menu' in marcos,
                 'boot %s ms' % pm.get('boot_ms'))
        ps.check('o Acampamento fica de pé (construções e enfeites da praça plantados)', 'acampamento' in marcos)
        nb = bytes_grupo.get('base', 0)
        sob = bool(pm.get('sob_demanda'))
        ps.check('o manifesto separa os modelos em grupos, e a base é bem menor que o todo',
                 'base' in bytes_grupo and nb < 0.4 * man['totalBytes'],
                 'base %s de %s; %d grupos' % (mb(nb), mb(man['totalBytes']), len(bytes_grupo)))
        ps.check('o jogo servido está no modo sob demanda', sob)
        ps.check('até o menu desceu SÓ a base (os modelos do boot são os do grupo base)',
                 sob and abs(ate_menu['modelos'] - nb) < 0.02 * nb,
                 'modelos até o menu %s, base %s' % (mb(ate_menu['modelos']), mb(nb)))
        ps.check('até o menu desceu menos da metade do que descia (menos de 60 MB)',
                 ate_menu['total'] < 60 * MB, mb(ate_menu['total']))
        ps.check('portal fechado não entra na pré-busca', 'acampamento' in marcos and not pa.get('vazou'),
                 'fechados %s (%s chaves só deles); vazou %s' % (pa.get('fechados'), pa.get('fechados_chaves'), pa.get('vazou')))

        if not a.so_abrir:
            for rot, nome in (('estufa', 'a Estufa'), ('cisterna', 'a Cisterna'), ('poco', 'o Poço')):
                an = passos.get(rot + ':antessala') or {}
                bt = passos.get(rot + ':batalha') or {}
                ps.check('%s: os modelos dela chegaram e abriram ANTES da antessala' % nome,
                         (rot + ':antessala') in marcos and an.get('plano', 0) > 0 and not an.get('faltando'),
                         'plano %s, faltando %s, a tela de carga %s' % (an.get('plano'), (an.get('faltando') or [])[:4],
                                                                        'apareceu' if an.get('carga_apareceu') else 'nem precisou'))
                ini = bt.get('inimigos') or []
                proprios = [x for x in ini if x.get('veste') == x.get('quer') and x.get('aberto')]
                ps.check('%s: a batalha desenha, e cada monstro veste o corpo DELE' % nome,
                         (rot + ':batalha') in marcos and ini and len(proprios) == len(ini)
                         and (bt.get('stats') or {}).get('tris', 0) > 0,
                         '%d/%d monstros com o próprio corpo, %s triângulos, %s' % (
                             len(proprios), len(ini), (bt.get('stats') or {}).get('tris'),
                             ', '.join('%s->%s' % (x['id'], x['veste']) for x in ini[:4])))
                ps.check('%s: o cenário do usuário está na cena da batalha' % nome,
                         bt.get('pecas', 0) > 0, '%s peças' % bt.get('pecas'))
            fa = passos.get('falha:aviso') or {}
            fr = passos.get('falha:recuperou') or {}
            falhou = [p for p in pedidos if p['caminho'].endswith('/' + FALHA + '.glb') and p['codigo'] == '503']
            deu = [p for p in pedidos if p['caminho'].endswith('/' + FALHA + '.glb') and p['codigo'] == '200']
            ps.check('falha de rede num modelo: depois das novas tentativas, o aviso com "Tentar de novo"',
                     'falha:aviso' in marcos and 'Não consegui baixar' in (fa.get('texto') or '') and len(falhou) >= 4,
                     '%r · %d respostas 503' % (fa.get('texto'), len(falhou)))
            ps.check('o botão recupera: o modelo desce, abre e a descida segue para a antessala',
                     'falha:recuperou' in marcos and fr.get('aberto') and deu, '%d respostas 200' % len(deu))

        faltas = sorted({p['caminho'] for p in pedidos if p['codigo'] == '404'
                         and not p['caminho'].startswith(('/api/', '/ws', '/site/img/')) and p['caminho'] != '/favicon.ico'})
        ps.check('nenhum arquivo pedido falta (0 × 404)', not faltas, ', '.join(faltas[:6]))
        sem_v, sem_h = ps.enderecos_marcados(pedidos, raiz)
        ps.check('cada modelo, do boot ou sob demanda, desceu com o hash do conteúdo (?h=)', not sem_h, ', '.join(sem_h[:4]))

        # os números, por fase
        print('  fase                     desceu        modelos   arquivos')
        for nome, _ in registro.marcos:
            c = ps.contas(fase(nome))
            print('  %-24s %9s %12s %8d' % (nome, mb(c['total']), mb(c['modelos']), c['n200']))
        tot = ps.contas([p for p in pedidos])
        print('  total da viagem: %s em %d arquivos' % (mb(tot['total']), tot['n200']))
        for g in sorted(bytes_grupo, key=lambda k: -bytes_grupo[k]):
            print('    grupo %-28s %s' % (g, mb(bytes_grupo[g])))
        if pa.get('bundle'):
            print('  pré-busca: %s' % json.dumps((pa['bundle'] or {}).get('pre')))
        ult = (passos.get('falha:recuperou') or passos.get('poco:antessala') or {}).get('bundle') or {}
        for g in ult.get('ganchos') or []:
            print('  gancho: %s' % json.dumps(g, ensure_ascii=False))
    finally:
        shutil.rmtree(pasta, ignore_errors=True)
    return ps.resumo()


if __name__ == '__main__':
    sys.exit(main())
