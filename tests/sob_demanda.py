#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A CARGA SOB DEMANDA: o jogo abre baixando só o necessário, e cada calabouço
baixa os seus modelos na hora de descer?

    python tests/sob_demanda.py              # o roteiro inteiro (menu, Acampamento, Estufa, Cisterna, Poço, falha)
    python tests/sob_demanda.py --so-abrir   # só até o Acampamento (bytes e tempo) — serve também no código antigo
    python tests/sob_demanda.py --banda 10   # o servidor entrega a 10 MB/s no total (uma conexão de verdade)
    python tests/sob_demanda.py --relogio 900  # teto de RELÓGIO do Chrome (padrão 1500 s): estourou, diz o passo
    python tests/sob_demanda.py --head --por-cima js/x.js=C:/copia/x.js   # o commit + SÓ uma mudança
    python tests/sob_demanda.py --tempo-virtual  # o jeito antigo (--virtual-time-budget + --dump-dom)

TEMPO REAL (conserto 11/09): o roteiro roda no relógio de verdade e a sonda
manda o resultado ao servidor (/__fim). No tempo virtual o headless PARAVA o
relógio da página por minutos sem pedido nenhum no ar (sondado pelo DevTools e
pelo NetLog: linha principal atendendo, rede vazia) e, no fim, um filho do
Chrome segurava o stdout depois do --dump-dom — era o "passou de 30 minutos".
Se a página parar de falar, a prova pergunta ao DevTools o que ela faz (estado,
pilha, rede viva) e para quando o relógio da página não anda entre duas sondas.

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
     a pré-busca do andar SEGUINTE acha a sala (também depois do 1º andar);
  6. a FALHA: o corpo da fusão da dupla nova devolve 503 — o aviso vem com os
     dois botões; "Seguir assim mesmo" desce com a composta e o modelo NÃO
     fica condenado (nova tentativa em segundo plano; a descida seguinte pede
     de novo); nela o pedido EMPACA (nem byte, nem erro), o vigia estoura, o
     aviso volta, e "Tentar de novo" recupera;
  7. nenhum 404 na viagem inteira; portal fechado não entra na pré-busca.
E, do conserto da revisão (10/09): com Economia de Dados a pré-busca não liga;
o avatar, o fantasma e o perfil de FUSÃO pedem o corpo próprio e trocam; o
gancho abre só o que a descida usa; o grimório (Progress.spellsFor) entra no
plano; um download da pré-busca empacado não segura o gancho; o guarda-roupa
pede os corpos e se repinta. E (22/09): a pré-busca só ABRE a vitrine da
praça (Hub.vitrine) — o resto baixa e fica fechado até o gancho.
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
import subprocess
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
# os do conserto (10/09): o avatar de fusão (Bruxo + Xamã), o fantasma de
# fusão (Curandeira + Espadachim), o perfil de um visitante de fusão
# (Arqueira + Bruxo) e o download empacado que o gancho promove
AVATAR = 'fus:bruxo+invocador'
FANTASMA = 'fus:curandeiro+espadachim'
PERFIL = 'fus:arqueiro+bruxo'
PROMOVE = 'fus_bruxo_espadachim'

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
  // os do conserto (os mesmos do Python; __X__ é trocado ao servir)
  var AVATAR = '__AVATAR__', FANTASMA = '__FANTASMA__', PERFIL = '__PERFIL__', PROMOVE = '__PROMOVE__';
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
  function corpoDaFusao(ap) { var p = ap.slice(4).split('+'); return J().Models3D2.modeloDaFusao(p[0], p[1]); }
  // a ECONOMIA DE DADOS do navegador (Save-Data), posta e tirada por fora do jogo
  function poeEconomia(sim) {
    var n = W().navigator;
    if (sim) Object.defineProperty(n, 'connection', { configurable: true, get: function () { return { saveData: true, effectiveType: '4g' }; } });
    else delete n.connection;
  }
  // o download que EMPACA: o pedido do modelo R.empaca sai do jogo e nunca
  // chega ao servidor — nem byte, nem erro (o sinal que sumiu no túnel).
  // Com R.empacaSo1, só o primeiro pedido empaca; os seguintes passam.
  function instalaEmpaca() {
    var w = W();
    if (!w || w.__sdEmpaca) return;
    w.__sdEmpaca = true;
    var XP = w.XMLHttpRequest.prototype, abre = XP.open, manda = XP.send;
    XP.open = function (m, u) { this.__sdUrl = String(u || ''); return abre.apply(this, arguments); };
    XP.send = function () {
      if (R.empaca && (this.__sdUrl || '').indexOf('/' + R.empaca + '.glb') >= 0) {
        R.empacados = (R.empacados || 0) + 1;
        if (!R.empacaSo1 || R.empacados === 1) return;
      }
      // o RASTREADOR (conserto 11/09): cada XHR do jogo no ar, com o endereço —
      // a sonda de DevTools lê isto se a página parar
      var xs = w.__sdXhr = w.__sdXhr || { n: 0, abertos: {} }, id = ++xs.n;
      xs.abertos[id] = (this.__sdUrl || '').slice(-90);
      this.addEventListener('loadend', function () { delete xs.abertos[id]; });
      return manda.apply(this, arguments);
    };
    // e os WebSockets do jogo (o relé da Rede): endereço e estado, para a sonda de DevTools
    if (w.WebSocket && !w.WebSocket.__sd) {
      var WS0 = w.WebSocket;
      var WSsd = function (u, pr) {
        var s = (pr === undefined) ? new WS0(u) : new WS0(u, pr);
        (w.__sdWs = w.__sdWs || []).push({ u: String(u), s: s });
        if (w.__sdWs.length > 20) w.__sdWs.shift();
        return s;
      };
      WSsd.prototype = WS0.prototype;
      WSsd.CONNECTING = 0; WSsd.OPEN = 1; WSsd.CLOSING = 2; WSsd.CLOSED = 3;
      WSsd.__sd = true;
      w.WebSocket = WSsd;
    }
    // e o fetch do jogo, do mesmo jeito (sempre chamado no window do jogo)
    if (w.fetch && !w.fetch.__sd) {
      var busca = w.fetch;
      w.fetch = function (u) {
        var xf = w.__sdXhr = w.__sdXhr || { n: 0, abertos: {} }, idf = ++xf.n;
        xf.abertos[idf] = 'fetch ' + String((u && u.url) || u || '').slice(-84);
        var pr = busca.apply(w, arguments);
        pr.then(function () { delete xf.abertos[idf]; }, function () { delete xf.abertos[idf]; });
        return pr;
      };
      w.fetch.__sd = true;
    }
  }
  // os modelos BAIXADOS e ainda FECHADOS fora de um plano (o gancho não pode abri-los)
  function foraDoPlano(plano) {
    var B = J().Bundle, noPlano = {};
    plano.forEach(function (k) { noPlano[k] = 1; });
    return B.ordemDaPreBusca().filter(function (k) { return !noPlano[k] && B.estadoDe(k) === 'chegou' && !decod(k); });
  }

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
      // em TEMPO REAL (11/09) o GL por software custa relógio de verdade: folga larga
      if (Date.now() - esperaDesde > (limiteMs || 240000)) {
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
    // o navegador em ECONOMIA DE DADOS (Save-Data) quando a praça fica de pé:
    // a pré-busca não pode ligar (o passo 'economia' confere e tira)
    if (!SO_ABRIR) { poeEconomia(true); instalaEmpaca(); }
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
    // ---- 2b. ECONOMIA DE DADOS: com Save-Data a pré-busca não liga
    var tEcon = 0;
    passo('economia', function () { tEcon = Date.now(); return true; });
    passo('economia:olha', espera(function () { return Date.now() - tEcon > 5000; }, function () {
      var Jg = J(), p = (info() || {}).pre || {};
      marco('economia:fim', { estado: p.estado, total: p.total, economia: Jg.Bundle.economiaDeDados ? Jg.Bundle.economiaDeDados() : null });
      // a conexão "melhorou": sai o Save-Data e a pré-busca liga (o resto do roteiro usa)
      poeEconomia(false);
      Jg.Bundle.preBusca();
      R.passos['economia:depois'] = { estado: ((info() || {}).pre || {}).estado, economia: Jg.Bundle.economiaDeDados() };
    }));
    // ---- 2c. o AVATAR de fusão, o FANTASMA de fusão e o PERFIL: o corpo próprio vem sob demanda
    var avatarGravado = false, topo0 = null;
    passo('avatar', function () {
      var Jg = J(), e = Jg.Hub._estado();
      marco('avatar');
      R.passos.avatar = { antes: e.corpo, quer: corpoDaFusao(AVATAR), plaquinha: e.plaquinha };
      Jg.DB.definirAvatar(AVATAR).then(function () { avatarGravado = true; J().UI.showScreen('hub'); });
      return true;
    });
    passo('avatar:corpo', espera(function () {
      var e = J().Hub._estado();
      return avatarGravado && e && e.corpo === corpoDaFusao(AVATAR);
    }, function () {
      var Jg = J(), H = Jg.Hub, e = H._estado();
      R.passos['avatar:corpo'] = { corpo: e.corpo, estado: Jg.Bundle.estadoDe(corpoDaFusao(AVATAR)), plaquinha: e.plaquinha, pos: e.pos };
      marco('fantasma');
      R.passos.fantasma = { entrou: H.fantasmaEntra('sd-g1', { classe: FANTASMA, nome: 'Visitante', x: 3, z: 8 }),
                            antes: H._corpoFantasma ? H._corpoFantasma('sd-g1') : null, quer: corpoDaFusao(FANTASMA) };
    }, 90000));
    passo('fantasma:corpo', espera(function () {
      var H = J().Hub;
      return H._corpoFantasma && H._corpoFantasma('sd-g1') === corpoDaFusao(FANTASMA);
    }, function () {
      var Jg = J();
      R.passos['fantasma:corpo'] = { corpo: Jg.Hub._corpoFantasma('sd-g1'), corpos: Jg.Hub._corposAtivos() };
      Jg.Hub.fantasmaSai('sd-g1');
      marco('perfil');
      var antes = Jg.Models3D2.lookFor(PERFIL).model;
      Jg.UI.openSheet('perfil', { nome: 'Visitante', classe: PERFIL, resumo: {} });
      topo0 = D().querySelector('.perfil-topo');
      R.passos.perfil = { abriu: !!topo0, antes: antes, quer: corpoDaFusao(PERFIL) };
    }, 90000));
    passo('perfil:corpo', espera(function () {
      var t = D().querySelector('.perfil-topo');
      return t && t !== topo0 && J().Models3D2.lookFor(PERFIL).model === corpoDaFusao(PERFIL);
    }, function () {
      R.passos['perfil:corpo'] = { veste: J().Models3D2.lookFor(PERFIL).model, repintou: true };
      J().UI.closeSheet();
    }, 90000));
    descida('estufa', 'garden', { pedido: { dungeonId: 'greenhouse', party: ['sumo'], sala: 0 },
      fn: function (Jg) { return Jg.Game.startRun(['sumo'], 'greenhouse'); } });
    // a Cisterna espera a pré-busca terminar de BAIXAR o que ela usa (a
    // decodificação segue pausada): a descida só precisa abrir, não baixar
    passo('cisterna:prebusca', espera(function () {
      // a pré-busca INTEIRA baixada (a Cisterna e o resto: coroas...) — em tempo
      // real a ordem importa: sem o resto baixado e fechado, a prova do "gancho
      // abre só o plano" não teria o que deixar de abrir
      var B = J().Bundle, ks = B.plano({ dungeonId: 'cistern', party: ['sumo'], sala: 0 });
      var ord = B.ordemDaPreBusca(), dg = B.diag();
      return ks.length && ks.every(function (k) { return B.estadoDe(k) === 'chegou' || decod(k); }) &&
             !dg.filaBaixa && !dg.vivosBaixa &&
             ord.every(function (k) { return B.estadoDe(k) === 'chegou' || B.estadoDe(k) === 'falhou' || decod(k); });
    }, function () {
      var B = J().Bundle, ks = B.plano({ dungeonId: 'cistern', party: ['sumo'], sala: 0 });
      R.foraAntes = foraDoPlano(ks);
      marco('cisterna:prebusca', { plano: ks.length, baixados_fechados: ks.filter(function (k) { return !decod(k); }).length,
                                   fora_do_plano: R.foraAntes.length, pre: (info() || {}).pre });
    }));
    descida('cisterna', 'cistern', { pedido: { dungeonId: 'cistern', party: ['sumo'], sala: 0 },
      fn: function (Jg) { return Jg.Game.startRun(['sumo'], 'cistern'); } });
    // ---- 4b. o DECODIFICADOR DE FOLGA, solto na praça: abre o que a
    // pré-busca baixou sem prender a praça (antes: um por requestIdleCallback
    // de prazo 2,5 s, e a praça desenhando sem parar só deixava sair pelo prazo).
    // Desde 22/09 abre só a VITRINE (Bundle.vitrine: o que a praça mostra); o
    // resto baixado fica fechado para o gancho — é a memória da aba
    var folga0 = null;
    function naVitrine(B) {
      var v = {};
      ((B.vitrine && B.vitrine()) || []).forEach(function (k) { v[k] = 1; });
      return v;
    }
    passo('cisterna:solta', function () {
      // o gancho abriu SÓ o plano: o que desceu fora dele segue fechado
      var fd = (R.foraAntes || []).filter(function (k) { return !decod(k); });
      R.passos['cisterna:fora'] = { antes: (R.foraAntes || []).length, fechados_depois: fd.length, exemplo: fd.slice(0, 3) };
      // a foto do que a folga vai abrir sai ANTES de soltar o decodificador:
      // tirada depois, uma leva já começada (contada em `decod`, modelo ainda
      // fechado) fazia os abertos darem um a menos que os fechados (22/09)
      var B = J().Bundle, ord = B.ordemDaPreBusca(), vit = naVitrine(B);
      function fechado(k) { return B.estadoDe(k) === 'chegou' && !decod(k); }
      folga0 = { t: Date.now(), vit: vit,
                 fechados: ord.filter(function (k) { return vit[k] && fechado(k); }).length,
                 fora: ord.filter(function (k) { return !vit[k] && fechado(k); }),
                 decod: JSON.parse(JSON.stringify((info() || {}).decod || {})) };
      if (B.pausaDecodificacao) B.pausaDecodificacao(false);
      return true;
    });
    passo('folga', function () {
      marco('folga');
      return true;
    });
    passo('folga:fim', espera(function () {
      var B = J().Bundle, dg = B.diag();
      return dg.paraDecodificar === 0 && !dg.filaBaixa && !dg.vivosBaixa &&
             B.ordemDaPreBusca().every(function (k) { return !folga0.vit[k] || B.estadoDe(k) !== 'chegou' || decod(k); });
    }, function () {
      var d = (info() || {}).decod || {}, d0 = folga0.decod || {};
      var foraFechados = folga0.fora.filter(function (k) { return !decod(k); });
      R.passos['folga:fim'] = { ms: Date.now() - folga0.t, fechados: folga0.fechados,
                                modelos: (d.modelos || 0) - (d0.modelos || 0), levas: (d.levas || 0) - (d0.levas || 0),
                                porPrazo: (d.porPrazo || 0) - (d0.porPrazo || 0),
                                esperaMs: (d.esperaMs || 0) - (d0.esperaMs || 0), abrirMs: (d.abrirMs || 0) - (d0.abrirMs || 0),
                                vitrine: Object.keys(folga0.vit).length, fora: folga0.fora.length,
                                fora_fechados: foraFechados.length, exemplo: foraFechados.slice(0, 4),
                                soBaixados: ((info() || {}).pre || {}).soBaixados };
    // 22/09: 300 s não davam mais — a praça tem sete corredores, e no GL por
    // software cada modelo levou ~3,8 s para abrir (60 da vitrine: 312 s)
    }, 600000));
    // o Poco: o plano so existe depois do sorteio (preparar), entao a sonda pergunta depois
    passo('poco:desce', function () {
      var Jg = J();
      marco('poco:desce');
      var ok = Jg.Game.startPoco(['sumo']);
      R.passos['poco:desce'] = { aceitou: ok, carga_na_hora: cargaVisivel() };
      return true;
    });
    // o 1º andar: a sonda pula a batalha dele (Game.screen = 'roomClear') — ali
    // importa o gancho do nextRoom e a pré-busca do andar SEGUINTE (vizinhos)
    passo('poco:andar1', espera(function () { return J().Game.screen === 'antessala' && !cargaVisivel(); }, function () {
      var Jg = J();
      Jg.Game.screen = 'roomClear';
      R.passos['poco:next'] = { aceitou: Jg.Game.nextRoom(), carga_na_hora: cargaVisivel() };
    }));
    passo('poco:antessala', espera(function () {
      return J().Game.screen === 'antessala' && J().Game.roomIndex === 1 && !cargaVisivel();
    }, function () {
      var Jg = J(), si = Jg.Game.roomIndex, plano = Jg.Bundle.plano({ dungeonId: 'poco', sala: si, party: ['sumo'] });
      var sala = Jg.DATA.dungeons.filter(function (d) { return d.id === 'poco'; })[0].rooms[si];
      marco('poco:antessala', { plano: plano.length, faltando: plano.filter(function (k) { return !decod(k); }), sala: si,
                                monstros: Object.keys(sala.monsters).map(function (k) { return sala.monsters[k]; }),
                                tema: sala.sceneryTheme, vizinhos: (info() || {}).vizinhos, bundle: info() });
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
    // ---- 5b. o GRIMÓRIO: o que o Progress diz que o herói leva (o Mestre leva
    // qualquer feitiço do jogo) entra no plano — a sonda empresta ao Bárbaro
    // o feitiço do Xamã que invoca o Familiar, só durante a pergunta
    passo('grimorio', function () {
      var Jg = J(), P = Jg.Progress, B = Jg.Bundle, orig = P.spellsFor, depois = [];
      var antes = B.plano({ party: ['sumo'] });
      P.spellsFor = function (hid) {
        var l = orig.apply(P, arguments) || [];
        return hid === 'sumo' ? l.concat(['invocador-neutro-1']) : l;
      };
      try { depois = B.plano({ party: ['sumo'] }); } finally { P.spellsFor = orig; }
      var quer = Jg.Models3D2.lookFor('sum-familiar').model;
      R.passos.grimorio = { quer: quer, antes: antes.indexOf(quer) >= 0, depois: depois.indexOf(quer) >= 0 };
      return true;
    });
    // ---- 6. a falha de rede num modelo. 1ª descida: 503 sem parar, o aviso,
    // "Seguir assim mesmo" — a descida segue com a composta, e o modelo NÃO
    // fica condenado: volta à fila baixa na hora (mais 503) e a descida
    // seguinte pede de novo. 2ª descida: o servidor voltou, mas o sinal sumiu
    // (o pedido EMPACA: nem byte, nem erro) — o vigia estoura, o aviso vem
    // com os botões; a prova solta o sinal e toca "Tentar de novo"
    var textoAviso = '';
    passo('falha:desce', function () {
      var Jg = J();
      marco('falha:desce');
      var ok = Jg.Game.startRun(['sumo', 'curandeiro'], 'greenhouse');
      R.passos['falha:desce'] = { aceitou: ok, carga_na_hora: cargaVisivel(), aberto_antes: decod(FALHA) };
      return true;
    });
    passo('falha:aviso', espera(function () {
      var b = D().querySelector('#carga .carga-seguir');
      if (b) textoAviso = (D().getElementById('carga-txt') || {}).textContent || '';
      return !!b;
    }, function () {
      marco('falha:aviso', { texto: textoAviso, tentar: !!D().querySelector('#carga .carga-tentar'),
                             seguir: true, tela: J().Game.screen, bundle: info() });
      D().querySelector('#carga .carga-seguir').click();
    }));
    passo('falha:seguiu', espera(function () { return J().Game.screen === 'antessala' && !cargaVisivel(); }, function () {
      var Jg = J();
      marco('falha:seguiu', { veste: Jg.Models3D2.lookFor('fus:curandeiro+sumo').model, quer: FALHA,
                              estado: Jg.Bundle.estadoDe(FALHA), diag: Jg.Bundle.diag() });
      Jg.Game.abandonar();
      Jg.UI.showScreen('hub');
    }));
    // a nova tentativa em segundo plano (fila baixa) acaba: 503 de novo, sem aviso
    passo('falha:praca', espera(function () {
      var Jg = J(), e = Jg.Hub._estado(), dg = Jg.Bundle.diag();
      return e && e.sala === null && e.construcoes && e.enfeites && Jg.Bundle.estadoDe(FALHA) === 'falhou' && !dg.voos;
    }, function () {
      R.passos['falha:praca'] = { estado: J().Bundle.estadoDe(FALHA), diag: J().Bundle.diag() };
    }));
    passo('falha:desce2', function () {
      var Jg = J();
      Jg.Bundle.prazos.parado = 2000;           // a prova encurta o vigia (no jogo: 20 s)
      R.empaca = FALHA; R.empacaSo1 = false; R.empacados = 0;
      avisa('/__falha?chave=' + encodeURIComponent(FALHA) + '&vezes=0');
      marco('falha:desce2');
      var ok = Jg.Game.startRun(['sumo', 'curandeiro'], 'greenhouse');
      R.passos['falha:desce2'] = { aceitou: ok, carga_na_hora: cargaVisivel(), estado: Jg.Bundle.estadoDe(FALHA) };
      return true;
    });
    var textoAviso2 = '';
    passo('falha:aviso2', espera(function () {
      var b = D().querySelector('#carga .carga-tentar');
      if (b) textoAviso2 = (D().getElementById('carga-txt') || {}).textContent || '';
      return !!b;
    }, function () {
      marco('falha:aviso2', { texto: textoAviso2, seguir: !!D().querySelector('#carga .carga-seguir'),
                              empacados: R.empacados, tela: J().Game.screen, bundle: info() });
      R.empaca = null;                            // o sinal voltou
      D().querySelector('#carga .carga-tentar').click();
    }));
    passo('falha:recuperou', espera(function () { return J().Game.screen === 'antessala' && !cargaVisivel(); }, function () {
      var Jg = J();
      Jg.Bundle.prazos.parado = 20000;
      marco('falha:recuperou', { aberto: decod(FALHA), veste: Jg.Models3D2.lookFor('fus:curandeiro+sumo').model, bundle: info() });
      Jg.Game.abandonar();
      Jg.UI.showScreen('hub');
    }));
    passo('praca:volta', espera(function () {
      var e = J().Hub._estado();
      return e && e.sala === null && e.construcoes && e.enfeites;
    }, function () {}));
    // ---- 7. a PROMOÇÃO: um download da pré-busca empacado no ar não segura o
    // gancho — pedir com prioridade larga o voo baixo e recomeça na frente
    var promove = null;
    passo('promove', function () {
      R.empaca = PROMOVE; R.empacaSo1 = true; R.empacados = 0;
      marco('promove');
      J().Bundle.adianta([PROMOVE]);
      return true;
    });
    passo('promove:no-ar', espera(function () { return R.empacados >= 1 && J().Bundle.diag().vivosBaixa === 1; }, function () {
      var B = J().Bundle, t = Date.now();
      marco('promove:pede');                      // a prova mede o pedido NOVO a partir daqui (relógio do servidor)
      promove = { pedidas: 0 };
      promove.pedidas = B.pede([PROMOVE], function (falhas) {
        promove.ms = Date.now() - t; promove.falhas = falhas; promove.aberto = decod(PROMOVE);
      });
    }));
    passo('promove:chegou', espera(function () { return promove && promove.ms !== undefined; }, function () {
      R.empaca = null;
      promove.empacados = R.empacados;
      marco('promove:fim', promove);
    }, 60000));
    // ---- 8. o GUARDA-ROUPA: os corpos das fusões liberadas descem e a ficha se repinta
    var caixa0 = null, paresGR = [];
    passo('guarda-roupa', function () {
      var Jg = J(), P = Jg.Progress, cls = Jg.DATA.classes || {};
      ['bruxo', 'invocador', 'espadachim'].forEach(function (c) {
        if (P.state.unlockedClasses.indexOf(c) < 0) P.state.unlockedClasses.push(c);
      });
      var ids = Object.keys(cls).filter(function (c) { return P.isClassUnlocked(c); }).sort();
      for (var a = 0; a < ids.length; a++) for (var b = a + 1; b < ids.length; b++) paresGR.push('fus:' + ids[a] + '+' + ids[b]);
      marco('guarda-roupa');
      var faltavam = paresGR.filter(function (p) { var k = corpoDaFusao(p); return k && !decod(k); });
      Jg.UI.openSheet('avatar');
      caixa0 = D().querySelector('.av-caixa');
      R.passos['guarda-roupa'] = { pares: paresGR.length, faltavam: faltavam.length };
      return true;
    });
    passo('guarda-roupa:chegou', espera(function () {
      var M = J().Models3D2, c = D().querySelector('.av-caixa');
      return c && c !== caixa0 && c.querySelectorAll('.av-carta').length === paresGR.length + 1 &&
             paresGR.every(function (p) { return M.lookFor(p).model === corpoDaFusao(p); });
    }, function () {
      var M = J().Models3D2;
      marco('guarda-roupa:fim', { pares: paresGR.length,
                                  proprios: paresGR.filter(function (p) { return M.lookFor(p).model === corpoDaFusao(p); }).length,
                                  cartas: D().querySelectorAll('.av-caixa .av-carta').length, repintou: true });
      J().UI.closeSheet();
    }, 240000));
  }

  function fim(estado) {
    R.total_ms = Date.now() - t0;
    document.getElementById('sonda').textContent = JSON.stringify(R);
    document.getElementById('summary').textContent = estado;
    // em TEMPO REAL não há --dump-dom: o resultado vai ao servidor da prova
    try {
      var xf = new XMLHttpRequest();
      xf.open('POST', '/__fim?estado=' + encodeURIComponent(estado), false);
      xf.send(JSON.stringify(R));
    } catch (eF) {}
    // o jogo sai do quadro: o resto do tempo virtual passa sem desenhar nada
    var f = document.getElementById('jogo');
    if (f && f.parentNode) f.parentNode.removeChild(f);
  }
  // o RETRATO AO VIVO (conserto 11/09): a cada passo novo e a cada 5 s
  // virtuais a sonda conta ao servidor onde está — se o Chrome estourar o
  // relógio de parede, o Python diz em que passo parou e como estava a fila
  var ultimoPasso = -1, ultimoRetrato = 0;
  function retrato() {
    try {
      var Jg = J(), ct = D() && D().getElementById('carga-txt');
      var st = { passo: passos[ativo] ? passos[ativo].nome : null, ms: Date.now() - t0,
                 tela: Jg.Game && Jg.Game.screen, carga: cargaVisivel(), carga_txt: ct ? ct.textContent : null,
                 fila: Jg.Bundle && Jg.Bundle.diag ? Jg.Bundle.diag() : null,
                 novos: Jg.Models3D2 && Jg.Models3D2._novosEstado ? Jg.Models3D2._novosEstado() : null,
                 ganchos: ((info() || {}).ganchos || []).slice(-2), erros: R.erros.slice(-3) };
      var x = new XMLHttpRequest(); x.open('POST', '/__estado', false); x.send(JSON.stringify(st));
    } catch (e) {}
  }
  function roda() {
    if (ativo !== ultimoPasso && passos[ativo]) {
      ultimoPasso = ativo;
      window.__sdPasso = passos[ativo].nome;           // a sonda de DevTools lê
      avisa('/__passo?nome=' + encodeURIComponent(passos[ativo].nome));
      retrato();
      ultimoRetrato = Date.now();
    } else if (Date.now() - ultimoRetrato > 5000) {
      ultimoRetrato = Date.now();
      retrato();
    }
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
SONDA = (SONDA.replace('__AVATAR__', AVATAR).replace('__FANTASMA__', FANTASMA)
         .replace('__PERFIL__', PERFIL).replace('__PROMOVE__', PROMOVE))


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
            if caminho == '/__passo':                   # o passo que a sonda começou (não muda a fase)
                registro.passo = urllib.parse.unquote(q.get('nome', ''))
                registro.passos_log.append((registro.passo, time.time()))
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

        def do_POST(self):
            # /__estado: o retrato ao vivo da sonda (o último fica guardado)
            n = int(self.headers.get('Content-Length') or 0)
            corpo = self.rfile.read(n) if n else b''
            caminho_p, _, query_p = self.path.partition('?')
            if caminho_p == '/__fim':                   # o resultado da sonda (tempo real)
                registro.fim = (urllib.parse.unquote(ps._query(query_p).get('estado', '')),
                                corpo.decode('utf-8', 'replace'))
                return self._corpo(b'ok', 'text/plain')
            if caminho_p != '/__estado':
                # o resto dos POST (a /api/ do jogo) segue como no http.server de sempre: 501
                return self.send_error(501, "Unsupported method ('POST')")
            registro.estado = corpo.decode('utf-8', 'replace')
            registro.estado_t = time.time()
            return self._corpo(b'ok', 'text/plain')

        def log_request(self, code='-', size='-'):
            caminho, _, query = self.path.partition('?')
            self._reg = {'fase': registro.fase, 'caminho': caminho, 'query': query,
                         'codigo': str(getattr(code, 'value', code)), 'bytes': 0, 't': time.time()}
            registro.pedidos.append(self._reg)
            registro.ultimo_t = self._reg['t']          # o vigia de página parada olha isto

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


# o que a sonda de DevTools pergunta à página parada (no quadro de cima; o jogo é o iframe)
_EXPR_PARADA = r'''(function () {
  try {
    var f = document.getElementById('jogo'), w = f && f.contentWindow, J = (w && w.JOGO) || {};
    var c = f && f.contentDocument && f.contentDocument.getElementById('carga');
    // o que ainda está no ar pelo navegador (imagem, script, fonte...): o
    // tempo virtual do headless PARA enquanto houver pedido de rede pendente
    function noAr(win) {
      try {
        return win.performance.getEntriesByType('resource').filter(function (e) { return !e.responseEnd; })
          .map(function (e) { return e.initiatorType + ' ' + String(e.name).slice(-90); }).slice(0, 12);
      } catch (e) { return 'erro: ' + e; }
    }
    var wsl = (w && w.__sdWs) ? w.__sdWs.map(function (o) { return o.u.slice(-60) + ' estado ' + o.s.readyState; }) : null;
    return JSON.stringify({ agora: Date.now(), passo: window.__sdPasso || null, tela: J.Game ? J.Game.screen : null,
      no_ar_jogo: w ? noAr(w) : null, no_ar_sonda: noAr(window), ws: wsl,
      fontes: (w && w.document.fonts) ? w.document.fonts.status : null,
      imagens: w ? Array.prototype.filter.call(w.document.images, function (i) { return !i.complete; })
                     .map(function (i) { return String(i.currentSrc || i.src).slice(0, 70); }).slice(0, 8) : null,
      sw: (w && w.navigator.serviceWorker && w.navigator.serviceWorker.controller) ? 'controlada' : 'sem',
      xhr: w && w.__sdXhr ? { n: w.__sdXhr.n, abertos: w.__sdXhr.abertos } : null,
      fila: J.Bundle && J.Bundle.diag ? J.Bundle.diag() : null,
      novos: J.Models3D2 && J.Models3D2._novosEstado ? J.Models3D2._novosEstado() : null,
      carga: c ? !c.hidden : null });
  } catch (e) { return 'erro: ' + e; }
})()'''


def _cdp_diagnostico(porta):
    """A página parou de falar: pergunta ao Chrome, pelo DevTools, se a linha
    principal ainda atende (Runtime.evaluate) e, se não, ONDE ela está presa
    (Debugger.pause -> a pilha). Atende e diz o estado = o tempo virtual parou
    (um pedido de rede no ar); não atende e pausa = laço de JS (a pilha diz
    qual); não atende nem pausa = presa fora do JS (um XHR síncrono, por ex.)."""
    import asyncio
    import urllib.request
    try:
        alvos = json.loads(urllib.request.urlopen('http://127.0.0.1:%d/json' % porta, timeout=10).read())
    except Exception as e:
        return {'erro': 'DevTools sem /json: %s' % e}
    pags = [t for t in alvos if t.get('type') == 'page' and t.get('webSocketDebuggerUrl')]
    if not pags:
        return {'erro': 'DevTools sem página', 'alvos': [t.get('type') for t in alvos]}

    async def conversa():
        import websockets
        out, n = {}, [0]
        async with websockets.connect(pags[0]['webSocketDebuggerUrl'], max_size=None) as ws:
            async def manda(metodo, params=None, espera=10.0):
                n[0] += 1
                mid = n[0]
                await ws.send(json.dumps({'id': mid, 'method': metodo, 'params': params or {}}))
                fim = time.time() + espera
                while time.time() < fim:
                    try:
                        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=max(0.1, fim - time.time())))
                    except asyncio.TimeoutError:
                        break
                    if msg.get('method') == 'Debugger.paused':
                        out['_pausa'] = msg.get('params') or {}
                    if msg.get('id') == mid:
                        return msg
                return None
            r = await manda('Runtime.evaluate', {'expression': _EXPR_PARADA, 'returnByValue': True}, 15)
            out['linha_principal'] = 'atende' if r else 'NÃO ATENDE em 15 s'
            if r:
                out['estado'] = ((r.get('result') or {}).get('result') or {}).get('value')
            await manda('Debugger.enable', {}, 15)
            try:
                await manda('Debugger.pause', {}, 10)
                fim = time.time() + 15
                while '_pausa' not in out and time.time() < fim:
                    try:
                        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=1))
                        if msg.get('method') == 'Debugger.paused':
                            out['_pausa'] = msg.get('params') or {}
                    except asyncio.TimeoutError:
                        pass
                pausa = out.pop('_pausa', None)
                if pausa is not None:
                    out['pilha'] = ['%s @ %s:%s' % (f.get('functionName') or '(anônima)', (f.get('url') or '')[-60:],
                                                   (f.get('location') or {}).get('lineNumber', 0) + 1)
                                    for f in (pausa.get('callFrames') or [])[:16]]
                else:
                    out['pilha'] = 'não pausou em 15 s (nenhum JS rodando)'
            finally:
                try:
                    await manda('Debugger.resume', {}, 5)
                    await manda('Debugger.disable', {}, 5)
                except Exception:
                    pass
        return out
    try:
        return asyncio.run(conversa())
    except Exception as e:
        return {'erro': 'DevTools: %s' % e}


def _netlog_no_ar(caminho, quantos=12):
    """Os pedidos que o serviço de rede do Chrome ainda tem VIVOS, pelo NetLog
    (--log-net-log): o tempo virtual do headless para enquanto houver um. O
    arquivo cresce enquanto o Chrome roda (o fecho ']}' só vem na saída)."""
    try:
        txt = open(caminho, encoding='utf-8', errors='replace').read()
    except OSError:
        return None
    i = txt.find('\n"events"')
    if i < 0:
        i = txt.find('"events"')
    if i < 0:
        return 'NetLog sem eventos ainda'
    try:
        const = json.loads(txt[:i].rstrip().rstrip(',') + '}').get('constants') or {}
    except ValueError:
        return 'NetLog: não li as constantes'
    tipos = const.get('logEventTypes') or {}
    fases = const.get('logEventPhase') or {}
    vivo_id = tipos.get('REQUEST_ALIVE')
    ini, fim_ = fases.get('PHASE_BEGIN', 1), fases.get('PHASE_END', 2)
    urls, vivos, t_ult = {}, {}, 0
    for linha in txt[i:].splitlines()[1:]:
        linha = linha.strip().rstrip(',')
        if not linha.startswith('{'):
            continue
        try:
            ev = json.loads(linha)
        except ValueError:
            continue
        sid = (ev.get('source') or {}).get('id')
        try:
            t = int(ev.get('time') or 0)
        except ValueError:
            t = 0
        t_ult = max(t_ult, t)
        u = (ev.get('params') or {}).get('url')
        if u and sid is not None:
            urls[sid] = u
        if ev.get('type') == vivo_id:
            if ev.get('phase') == ini:
                vivos[sid] = t
            elif ev.get('phase') == fim_:
                vivos.pop(sid, None)
    return ['%s (há %.0f s)' % (str(urls.get(s, '?'))[-100:], (t_ult - t0) / 1000.0)
            for s, t0 in sorted(vivos.items(), key=lambda kv: kv[1])][:quantos]


def _chrome_vigiado(chrome, perfil, url, budget, relogio, registro=None, parado=240, tempo_real=False):
    """O ps._chrome com RELÓGIO DE PAREDE (conserto 11/09): no headless o tempo
    virtual anda no ritmo dos quadros, e um passo que espera à toa 120 s
    virtuais desenhando a praça vira meia hora de relógio. Estourou: derruba
    a árvore do Chrome DESTE perfil (taskkill /T) e devolve ('', True, sondas).
    Se o servidor passa `parado` s sem pedido nenhum, pergunta à página pelo
    DevTools o que ela está fazendo (até 3 vezes) — ver _cdp_diagnostico."""
    # o console do jogo vai para um arquivo ao lado do perfil (--enable-logging):
    # um erro de JS no meio do roteiro aparece no relatório, não some calado
    err = open(os.path.join(os.path.dirname(perfil), 'chrome_console.txt'), 'wb')
    porta_cdp = ps.porta_livre()
    p = subprocess.Popen([chrome, '--headless=new', '--disable-gpu', '--no-first-run',
                          '--no-default-browser-check', '--window-size=1400,900',
                          '--enable-logging=stderr', '--log-level=0',
                          '--remote-debugging-port=%d' % porta_cdp, '--remote-allow-origins=*',
                          '--log-net-log=' + os.path.join(os.path.dirname(perfil), 'netlog.json'),
                          '--user-data-dir=' + perfil] +
                         # TEMPO REAL (padrão desde 11/09): sem orçamento virtual e sem
                         # --dump-dom — o headless PARAVA o tempo virtual por minutos sem
                         # pedido nenhum no ar (sondado pelo DevTools e pelo NetLog), e o
                         # roteiro longo morria no relógio. A sonda manda o resultado
                         # ao servidor (/__fim) e a prova derruba o Chrome.
                         ([url] if tempo_real else ['--virtual-time-budget=%d' % budget, '--dump-dom', url]),
                         stdout=subprocess.PIPE, stderr=err, creationflags=ps.BAIXA)
    # A SAÍDA É LIDA POR UMA LINHA À PARTE (conserto 11/09, a causa do "passou
    # de 30 minutos"): o --dump-dom escreve o DOM e fecha a página, mas às vezes
    # um processo filho do Chrome fica vivo segurando o stdout — o EOF nunca
    # vem, e o communicate()/subprocess.run(capture_output) esperava o relógio
    # inteiro para, no fim, jogar fora um DOM que já estava pronto. Aqui: DOM
    # completo ('</html>') e 20 s sem o Chrome sair = derruba a árvore e segue.
    buf = []

    def le():
        for bloco in iter(lambda: p.stdout.read1(65536), b''):   # read1: o que ja chegou (read(n) esperava n bytes ou o EOF)
            buf.append(bloco)
    leitor = threading.Thread(target=le, daemon=True)
    leitor.start()

    def derruba():
        if os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(p.pid), '/T', '/F'], capture_output=True)
        else:
            p.kill()
        leitor.join(30)
        try:
            p.wait(timeout=30)
        except Exception:
            pass
        err.close()
        return b''.join(buf).decode('utf-8', 'replace')

    t0, sondas, t_dump = time.time(), [], None
    while True:
        leitor.join(timeout=5)
        if not leitor.is_alive():                  # EOF: o Chrome e os filhos fecharam a saída
            try:
                p.wait(timeout=30)
            except Exception:
                pass
            err.close()
            return b''.join(buf).decode('utf-8', 'replace'), False, sondas
        if t_dump is None and b'</html>' in b''.join(buf[-3:])[-8000:]:
            t_dump = time.time()
        if t_dump is not None and time.time() - t_dump > 20:
            print('  (o Chrome escreveu o DOM e não saiu em 20 s — um filho segurava o stdout: derrubado)',
                  flush=True)
            return derruba(), False, sondas
        if tempo_real and getattr(registro, 'fim', None):   # a sonda mandou o resultado
            return derruba(), False, sondas
        agora = time.time()
        ultimo = max(t0, getattr(registro, 'ultimo_t', None) or t0)
        if (agora - ultimo > parado and len(sondas) < 3
                and (not sondas or agora - sondas[-1]['t'] > parado)):
            d = _cdp_diagnostico(porta_cdp)
            d['t'] = agora
            d['parado_s'] = int(agora - ultimo)
            d['passo'] = getattr(registro, 'passo', None)
            d['rede_viva'] = _netlog_no_ar(os.path.join(os.path.dirname(perfil), 'netlog.json'))
            sondas.append(d)
            print('  [DevTools: %d s sem pedido nenhum, no passo %r] %s' % (
                d['parado_s'], d['passo'], json.dumps({k: v for k, v in d.items() if k not in ('t', 'passo')},
                                                      ensure_ascii=False)[:3500]), flush=True)
            # duas sondas com o MESMO relógio da página = o tempo virtual congelou:
            # esperar o resto do relógio de parede não prova mais nada
            try:
                ag = [json.loads(s.get('estado') or '{}').get('agora') for s in sondas[-2:]]
            except ValueError:
                ag = []
            if len(ag) == 2 and ag[0] and ag[0] == ag[1]:
                print('  (o tempo virtual da página não andou entre as duas sondas: parei a prova aqui)', flush=True)
                return derruba(), True, sondas
        if agora - t0 > relogio:
            break
    return derruba(), True, sondas


def sonda(chrome, perfil, base, budget, so_abrir, relogio=1500, registro=None, tempo_real=False):
    # o limite geral da sonda: em tempo real, o relógio de parede (menos a folga do boot)
    limite = max(5000, (relogio - 90) * 1000) if tempo_real else max(5000, budget - 10000)
    url = base + '__sd.html?limite=%d&falha=%s%s' % (limite, FALHA, '&so=abrir' if so_abrir else '')
    dump, estourou, _sondas = _chrome_vigiado(chrome, perfil, url, budget, relogio, registro, tempo_real=tempo_real)
    if tempo_real and getattr(registro, 'fim', None):
        # o resultado veio pelo servidor: monta o "DOM" que a leitura abaixo espera
        est, corpo = registro.fim
        dump = '<div id="summary">%s</div><pre id="sonda">%s</pre>' % (html.escape(est), html.escape(corpo))
    m = re.search(r'<pre id="sonda">(.*?)</pre>', dump, re.S)
    s = re.search(r'id="summary"[^>]*>([^<]*)<', dump)
    if estourou and not (m and m.group(1).strip()):
        return {'erro': 'o Chrome estourou o relógio de parede (%d s)' % relogio, 'estourou': True}, 'ESTOUROU'
    if not m or not m.group(1).strip():
        return {'erro': 'a sonda não escreveu nada (DOM de %d bytes)' % len(dump)}, (s.group(1) if s else '')
    try:
        res = json.loads(html.unescape(m.group(1)))
    except ValueError:
        return {'erro': 'sonda ilegível: ' + m.group(1)[:300]}, (s.group(1) if s else '')
    if estourou:                                   # o DOM veio, mas depois do relógio: conta como estouro
        res['estourou'] = True
    return res, (s.group(1) if s else '')


def main():
    ap = argparse.ArgumentParser(description='a carga sob demanda')
    ap.add_argument('--so-abrir', action='store_true', help='só até o Acampamento (serve no código antigo)')
    ap.add_argument('--banda', type=float, default=0, help='MB/s no total (0 = sem freio)')
    ap.add_argument('--budget', type=int, default=420000, help='tempo virtual do Chrome em ms')
    ap.add_argument('--head', action='store_true', help='o pacote do último commit (não o do disco)')
    ap.add_argument('--relogio', type=int, default=1500,
                    help='segundos de RELÓGIO para o Chrome (estourou: diz o passo em que parou)')
    ap.add_argument('--tempo-virtual', action='store_true',
                    help='o jeito antigo: --virtual-time-budget e --dump-dom (o headless pode PARAR o tempo '
                         'virtual por minutos sem pedido nenhum no ar; o padrão é tempo real)')
    ap.add_argument('--por-cima', action='append', default=[], metavar='CAMINHO=ARQUIVO',
                    help='troca um arquivo do pacote por outro antes do build (ex.: com --head, o commit '
                         'mais SÓ uma mudança, sem as edições em andamento de outras rodadas); repetível')
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
        if a.por_cima:
            # troca os arquivos e roda o versao.py de novo, como o build faria
            for spec in a.por_cima:
                caminho, _, origem = spec.partition('=')
                shutil.copyfile(origem, os.path.join(raiz, *caminho.split('/')))
                print('  por cima: %s <- %s' % (caminho, origem))
            rv = subprocess.run([sys.executable, os.path.join(raiz, 'servidor', 'coolify', 'versao.py'), raiz],
                                capture_output=True, text=True, encoding='utf-8', errors='replace')
            print('  ' + (rv.stdout + rv.stderr).strip()[:300])
            if rv.returncode != 0:
                return 1
        man = json.loads(ps.ler(ps.MANIFESTO, raiz))
        grupo = {it['chave']: it.get('grupo') for it in man['itens'] if it['alvo'] == 'MODELS'}
        bytes_grupo = {}
        for it in man['itens']:
            g = it.get('grupo') or '(sem grupo)'
            bytes_grupo[g] = bytes_grupo.get(g, 0) + it['bytes']
        registro = ps.Registro()
        registro.fase = 'boot'
        registro.marcos = []
        registro.passo = None
        registro.passos_log = []
        registro.estado = None
        registro.estado_t = None
        registro.ultimo_t = None
        registro.fim = None
        falhas = {} if a.so_abrir else {FALHA: 10 ** 6}
        banda = Banda(a.banda)
        srv, base = servidor(raiz, registro, banda, falhas)
        t_chrome = time.time()
        try:
            r, resumo_sonda = sonda(chrome, os.path.join(pasta, 'perfil'), base, a.budget, a.so_abrir, a.relogio,
                                    registro, tempo_real=not a.tempo_virtual)
            print('  relógio da sonda: %s' % ('virtual (--tempo-virtual)' if a.tempo_virtual else 'real'))
        finally:
            srv.shutdown()
        dur = time.time() - t_chrome
        print('  sonda: %s — %.0f s de relógio, %s ms virtuais' % (resumo_sonda, dur, r.get('total_ms')))
        # o relógio por passo (de parede): onde a prova gasta, e onde parou se estourou
        pl = registro.passos_log
        if pl:
            fatias = ['%s %.0fs' % (pl[i][0], (pl[i + 1][1] if i + 1 < len(pl) else time.time()) - pl[i][1])
                      for i in range(len(pl))]
            print('  relógio por passo: ' + ' · '.join(fatias))
        ps.check('a sonda termina dentro do relógio de parede (%d s)' % a.relogio, not r.get('estourou'),
                 'parou no passo %r; último retrato (%s s antes do fim): %s' % (
                     registro.passo, '%.0f' % (time.time() - registro.estado_t) if registro.estado_t else '?',
                     (registro.estado or '')[:1500]) if r.get('estourou') else '%.0f s' % dur)
        # o console do jogo (--enable-logging): os erros de JS; se estourou, o fim dele
        try:
            con = open(os.path.join(pasta, 'chrome_console.txt'), encoding='utf-8', errors='replace').read().splitlines()
        except OSError:
            con = []
        con_js = [l for l in con if 'CONSOLE' in l]
        erros_js = [l for l in con_js if re.search(r'Uncaught|Error|erro', l)]
        print('  console do jogo: %d linhas, %d com erro' % (len(con_js), len(erros_js)))
        for l in (con_js[-25:] if r.get('estourou') else erros_js[:8]):
            print('    ' + l[-300:])
        if r.get('estourou'):
            print('  últimos pedidos ao servidor (segundos antes do fim):')
            t_fim = time.time()
            for p in registro.pedidos[-15:]:
                print('    -%5.0fs %-22s %s %s' % (t_fim - p['t'], (p['fase'] or '')[:22], p['codigo'], p['caminho'][-70:]))
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
                     'falha:aviso' in marcos and 'Não consegui baixar' in (fa.get('texto') or '') and len(falhou) >= 4
                     and fa.get('tentar') and fa.get('seguir'),
                     '%r · %d respostas 503 · botões: tentar %s, seguir %s'
                     % (fa.get('texto'), len(falhou), fa.get('tentar'), fa.get('seguir')))
            ps.check('o botão recupera: o modelo desce, abre e a descida segue para a antessala',
                     'falha:recuperou' in marcos and fr.get('aberto') and deu and fr.get('veste') == FALHA,
                     '%d respostas 200; a fusão veste %s' % (len(deu), fr.get('veste')))
            # ---- o conserto da revisão (10/09)
            fs = passos.get('falha:seguiu') or {}
            d2 = passos.get('falha:desce2') or {}
            ps.check('"Seguir assim mesmo" desce com a composta e NÃO condena o modelo: nova tentativa em '
                     'segundo plano, e a descida seguinte pede de novo',
                     'falha:seguiu' in marcos and fs.get('veste') not in (None, FALHA) and len(falhou) >= 8
                     and bool(d2.get('carga_na_hora')),
                     'veste %s; %d respostas 503 (4 do gancho + %d em segundo plano); a 2ª descida %s'
                     % (fs.get('veste'), len(falhou), max(0, len(falhou) - 4),
                        'pediu de novo' if d2.get('carga_na_hora') else 'NÃO pediu'))
            a2 = passos.get('falha:aviso2') or {}
            ps.check('download que EMPACA (nem byte, nem erro): o vigia estoura e o aviso vem com os dois botões',
                     'falha:aviso2' in marcos and 'Não consegui baixar' in (a2.get('texto') or '') and a2.get('seguir')
                     and (a2.get('empacados') or 0) >= 4,
                     '%r · %s pedidos empacados' % (a2.get('texto'), a2.get('empacados')))
            ec = passos.get('economia:fim') or {}
            ed = passos.get('economia:depois') or {}
            econ = ps.contas(fase('acampamento'))
            ps.check('Economia de Dados (Save-Data): a pré-busca não liga e nada desce sozinho',
                     'economia:fim' in marcos and ec.get('estado') == 'economia' and not ec.get('total')
                     and econ['modelos'] == 0 and ed.get('estado') in ('marcada', 'rodando'),
                     'estado %s, %s de modelos em 5 s de praça; sem o Save-Data a pré-busca fica %s'
                     % (ec.get('estado'), mb(econ['modelos']), ed.get('estado')))
            av = passos.get('avatar') or {}
            ac = passos.get('avatar:corpo') or {}
            av_glb = [p for p in pedidos if p['caminho'].endswith('/%s.glb' % (av.get('quer') or '?')) and p['codigo'] == '200']
            seg_av = (marcos['fantasma'] - marcos['avatar']) if ('fantasma' in marcos and 'avatar' in marcos) else None
            ps.check('o avatar de fusão pede o corpo próprio e troca na praça',
                     bool(av.get('quer')) and ac.get('corpo') == av.get('quer') and len(av_glb) == 1,
                     '%s -> %s em %s s de relógio; %d pedido(s) do .glb' % (
                         av.get('antes'), ac.get('corpo'), '%.1f' % seg_av if seg_av is not None else '?', len(av_glb)))
            fn = passos.get('fantasma') or {}
            fc = passos.get('fantasma:corpo') or {}
            ps.check('o fantasma de fusão nasce composto, pede o corpo próprio e troca',
                     bool(fn.get('entrou')) and fc.get('corpo') == fn.get('quer') and fn.get('antes') != fn.get('quer'),
                     '%s -> %s' % (fn.get('antes'), fc.get('corpo')))
            pf = passos.get('perfil') or {}
            pc = passos.get('perfil:corpo') or {}
            ps.check('o perfil do visitante de fusão pede o corpo e se repinta com ele',
                     bool(pf.get('abriu')) and pc.get('repintou') and pc.get('veste') == pf.get('quer'),
                     '%s -> %s' % (pf.get('antes'), pc.get('veste')))
            cf = passos.get('cisterna:fora') or {}
            ps.check('o gancho abre SÓ o que a descida usa (o resto baixado segue fechado para a folga)',
                     (cf.get('antes') or 0) > 0 and cf.get('fechados_depois') == cf.get('antes'),
                     '%s baixados fora do plano da Cisterna; fechados depois da descida: %s'
                     % (cf.get('antes'), cf.get('fechados_depois')))
            ff = passos.get('folga:fim') or {}
            # antes: um modelo por requestIdleCallback que só saía pelo prazo de 2,5 s
            # (a praça não deixa folga). O que o conserto muda é a ESPERA de cada leva
            # (do agendar ao rIC disparar): prazo de 600 ms, antes 2,5 s — a média
            # abaixo de 2,5 s só é possível com o prazo novo. O ABRIR é o custo do
            # modelo (no headless, GL por software em tempo real) e fica no relatório.
            lv = ff.get('levas') or 0
            esp_media = (ff.get('esperaMs') or 0) / float(lv) if lv else None
            ps.check('o decodificador de folga abre na praça a VITRINE que a pré-busca baixou (espera por leva abaixo dos 2,5 s de antes)',
                     (ff.get('fechados') or 0) > 0 and ff.get('modelos', 0) >= (ff.get('fechados') or 0)
                     and esp_media is not None and esp_media < 2500,
                     '%s baixados e fechados, abertos em %s levas (%s pelo prazo): espera média %s ms por leva, '
                     'abrir %s ms no total, %s ms do começo ao fim'
                     % (ff.get('fechados'), lv, ff.get('porPrazo'),
                        '%.0f' % esp_media if esp_media is not None else '?', ff.get('abrirMs'), ff.get('ms')))
            # 22/09 ("a aba consome 2,6 GB"): modelo aberto guarda a textura
            # descompactada (~12 MB); o que a praça não mostra só baixa
            ps.check('a pré-busca só BAIXA o que a praça não mostra (monstro, peça fora do corredor, coroa): '
                     'segue fechado depois da folga',
                     (ff.get('vitrine') or 0) > 0 and (ff.get('fora') or 0) > 0
                     and ff.get('fora_fechados') == ff.get('fora'),
                     '%s chaves na vitrine; %s baixadas fora dela, %s ainda fechadas depois da folga (ex.: %s); '
                     'soBaixados %s' % (ff.get('vitrine'), ff.get('fora'), ff.get('fora_fechados'),
                                        ', '.join(ff.get('exemplo') or []), ff.get('soBaixados')))
            viz = (passos.get('poco:antessala') or {}).get('vizinhos') or []
            ps.check('Poço: a pré-busca do andar seguinte acha a sala sorteada, também depois do 1º andar',
                     any(v.get('sala', 0) >= 2 for v in viz) and all(v.get('existia') and v.get('chaves', 0) > 0 for v in viz),
                     json.dumps(viz))
            gr = passos.get('grimorio') or {}
            ps.check('a invocação do grimório (Progress.spellsFor: o Mestre leva qualquer feitiço) entra no plano',
                     bool(gr.get('depois')) and not gr.get('antes'),
                     '%s: sem o feitiço %s, com ele %s' % (gr.get('quer'), gr.get('antes'), gr.get('depois')))
            pm2 = passos.get('promove:fim') or {}
            deu_p = [p for p in pedidos if p['caminho'].endswith('/' + PROMOVE + '.glb') and p['codigo'] == '200']
            # o que prova a promoção é o pedido NOVO chegar ao servidor logo depois do
            # pede (relógio de parede do servidor): sem ela, só depois do vigia (20 s)
            t_pede = marcos.get('promove:pede')
            atraso = (deu_p[0]['t'] - t_pede) if (deu_p and t_pede) else None
            ps.check('o gancho não fica refém de um download da pré-busca parado no ar (larga e recomeça na frente)',
                     pm2.get('ms') is not None and not pm2.get('falhas') and pm2.get('aberto')
                     and len(deu_p) == 1 and atraso is not None and atraso < 5,
                     'o pedido novo chegou ao servidor %s s depois do pede (sem a promoção: o vigia, 20 s); '
                     'aberto em %s ms; %d pedido(s) ao servidor'
                     % ('%.1f' % atraso if atraso is not None else '?', pm2.get('ms'), len(deu_p)))
            g0 = passos.get('guarda-roupa') or {}
            gf = passos.get('guarda-roupa:fim') or {}
            ps.check('o guarda-roupa pede os corpos das fusões liberadas e se repinta com eles',
                     bool(gf.get('repintou')) and gf.get('pares', 0) >= 6 and gf.get('proprios') == gf.get('pares')
                     and (g0.get('faltavam') or 0) > 0 and gf.get('cartas') == gf.get('pares', 0) + 1,
                     '%s pares, %s faltavam, %s com o corpo próprio, %s cartas' % (
                         gf.get('pares'), g0.get('faltavam'), gf.get('proprios'), gf.get('cartas')))

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
        if ult.get('decod'):
            print('  decodificador de folga: %s · bytes por fase: %s' % (
                json.dumps(ult.get('decod')),
                json.dumps({k: mb(v.get('bytes', 0)) for k, v in (ult.get('porFase') or {}).items()})))
        if not a.so_abrir and 'avatar' in marcos and 'fantasma' in marcos:
            c_av = ps.contas(fase('avatar'))
            print('  avatar de fusão: %s de modelos, %.1f s de relógio até trocar'
                  % (mb(c_av['modelos']), marcos['fantasma'] - marcos['avatar']))
    finally:
        shutil.rmtree(pasta, ignore_errors=True)
    return ps.resumo()


if __name__ == '__main__':
    sys.exit(main())
