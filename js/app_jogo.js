// SOTERRA — o código do jogo guardado NO APARELHO (só no aplicativo de Android).
//
// O PEDIDO (06/10, o dono): "o jogador pode ter a opção de salvar o jogo no
// celular, mas só consegue conectar ao game com internet".
//
// O JOGO É SOMENTE ONLINE. O que se guarda são os ARQUIVOS do jogo (.js e .css),
// para o aplicativo abrir mais rápido e gastar menos dados. A página, o
// js/versao.js, a conta, a batalha e a loja vêm sempre do servidor: sem internet
// o aplicativo mostra a tela "sem conexão" da casca, com ou sem jogo guardado.
//
// A WEB NÃO CARREGA ESTE ARQUIVO: o index.html só o escreve dentro do aplicativo,
// como o js/app_modelos.js. E mesmo carregado ele só registra o /sw.js na casca
// de verdade (Capacitor nativo) — o `?app=1` das provas só vale em endereço
// local, para ninguém ganhar um service worker no navegador por um link.
//
// QUEM GUARDA É O /sw.js (leia as três regras no começo dele). Daqui saem só os
// recados: a lista do que o servidor pede AGORA (o guardado que não está nela é
// apagado), "baixe o que falta" para quem escolheu Baixar tudo, quanto está
// guardado e "apague".
//
// DESLIGAR: o jogador, nas Configurações ("Apagar o jogo guardado"); nós, pela
// linha `window.__guardaJogo = false` do index.html ou pelo `DESLIGA` do /sw.js.
// Desligado, este arquivo desregistra o service worker e apaga o cache.

var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

(function () {
  'use strict';
  /* O TEXTO NO IDIOMA DO JOGADOR (docs/IDIOMAS.md): a chave é o próprio português. Sem o JOGO.I18n
   * (o juiz do servidor e as provas em Node não o carregam) volta o português, com as {variáveis}. */
  function Tx(s, v) {
    var I = (typeof JOGO !== 'undefined' && JOGO) ? JOGO.I18n : null;
    if (I && I.t) return I.t(s, v);
    if (!v) return s;
    return String(s).replace(/\{([A-Za-z_]\w*)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m;
    });
  }

  var G = {};
  JOGO.AppJogo = G;

  var MB = 1048576;
  var NOME = 'soterra-jogo-1';              // o cache (o mesmo nome do /sw.js)
  var PREF = 'soterra-app-jogo';            // localStorage: 'nao' = o jogador mandou apagar
  var SW = '/sw.js';
  var HASH = /^[0-9a-f]{12}$/;

  // ============================================================ a conta pura
  /* O que se guarda: os .js e .css do jogo. A MESMA regra está em servidor/coolify/versao.py (do_jogo). */
  G.doJogo = function (f) {
    return /\.(js|css)$/.test(f) && f.indexOf('site/') !== 0 && f !== 'sw.js' && f !== 'js/versao.js';
  };
  /* Os endereços que o servidor pede AGORA, com o hash de cada um. V = window.SOTERRA_VERSAO. */
  G.lista = function (V) {
    var l = [], a = (V && V.versao && V.versao !== 'dev' && V.arquivos) || {};
    for (var f in a) {
      if (Object.prototype.hasOwnProperty.call(a, f) && G.doJogo(f) && HASH.test(a[f])) l.push('/' + f + '?v=' + a[f]);
    }
    return l.sort();
  };
  G.peso = function () { var V = versao(); return (V && V.peso > 0) ? V.peso : 0; };
  function mb(bytes) { return (Math.round(10 * (bytes || 0) / MB) / 10).toFixed(1).replace('.', ','); }

  // ============================================================ onde vale
  function versao() { return (typeof window !== 'undefined') ? window.SOTERRA_VERSAO : null; }
  function cofre(k, v) {
    try {
      if (v === undefined) return window.localStorage.getItem(k);
      if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v);
    } catch (e) {}
    return null;
  }
  function sw() { try { return window.navigator.serviceWorker || null; } catch (e) { return null; } }
  function caixas() { try { return window.caches || null; } catch (e) { return null; } }

  /* A casca de verdade, ou a fingida (`?app=1`) num endereço local. */
  G.noApp = function () {
    try {
      var C = window.Capacitor;
      if (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()) return true;
      var L = window.location;
      return /[?&]app=1(&|$)/.test(L.search || '') && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(L.hostname || '');
    } catch (e) { return false; }
  };
  /* Dá para guardar aqui? No aplicativo, com service worker e cache no WebView, com o mapa do build
   * (em casa o js/versao.js é o 'dev', sem hash: nada a guardar) e sem a válvula fechada. */
  G.pode = function () {
    return G.noApp() && !!sw() && !!caixas() && window.__guardaJogo !== false && G.lista(versao()).length > 0;
  };
  G.querGuardar = function () { return cofre(PREF) !== 'nao'; };
  G.ligado = function () { return G.pode() && G.querGuardar(); };

  // ============================================================ os recados ao /sw.js
  /* Resolve com a resposta, ou com null (sem service worker ativo, erro, 2 min sem resposta). Nunca rejeita. */
  function pede(msg) {
    var S = sw();
    if (!S || !S.ready || !S.getRegistration) return Promise.resolve(null);
    return new Promise(function (ok) {
      var t = setTimeout(function () { ok(null); }, 120000);
      function fim(r) { clearTimeout(t); ok(r && !r.erro ? r : null); }
      // sem registro, o `ready` não resolve nunca: pergunta antes
      S.getRegistration('/').then(function (tem) { return tem ? S.ready : null; }).then(function (reg) {
        if (!reg || !reg.active) return fim(null);
        var canal = new MessageChannel();
        canal.port1.onmessage = function (ev) { fim(ev.data); };
        reg.active.postMessage(msg, [canal.port2]);
      }).then(null, function () { fim(null); });
    });
  }
  /* Deixa o guardado igual ao que o servidor pede agora; com `completar`, baixa o que falta. */
  G.acerta = function (completar) {
    return pede({ tipo: 'acerta', urls: G.lista(versao()), completar: !!completar });
  };
  G.completa = function () { return G.ligado() ? G.liga().then(function () { return G.acerta(true); }) : Promise.resolve(null); };
  G.estado = function () {
    return pede({ tipo: 'estado' }).then(function (r) { return r || { n: 0, bytes: 0 }; });
  };

  /* Registra o /sw.js e MANDA CONFERIR com o servidor (`update`, sem cache no meio por causa do
   * `updateViaCache: 'none'`): registrar de novo o mesmo endereço não confere nada, e o navegador
   * só confere sozinho quando quer. É o que faz a válvula do /sw.js chegar na abertura seguinte.
   * Custa um pedido pequeno por abertura. Nunca rejeita. */
  G.liga = function () {
    var S = sw();
    if (!S) return Promise.resolve(null);
    try {
      return S.register(SW, { scope: '/', updateViaCache: 'none' }).then(function (reg) {
        try { if (reg && reg.active && reg.update) reg.update().then(null, function () {}); } catch (e) {}
        return reg;
      }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  };
  /* Tira tudo: o service worker e o cache. Não mexe na vontade do jogador. Nunca rejeita. */
  G.desliga = function () {
    var S = sw(), C = caixas(), p = [];
    try {
      if (S && S.getRegistrations) p.push(S.getRegistrations().then(function (rs) {
        return Promise.all(rs.map(function (r) {
          var a = r.active || r.waiting || r.installing;
          return (a && /\/sw\.js(\?|$)/.test(a.scriptURL)) ? r.unregister() : null;
        }));
      }).then(null, function () {}));
      if (C) p.push(C.delete(NOME).then(null, function () {}));
    } catch (e) {}
    return Promise.all(p);
  };
  /* O jogador: "Apagar o jogo guardado" e "Guardar o jogo". */
  G.apaga = function () { cofre(PREF, 'nao'); return G.desliga(); };
  G.guarda = function () {
    cofre(PREF, null);
    if (!G.pode()) return Promise.resolve(null);
    return G.liga().then(function () { return G.acerta(tudo()); });
  };
  function tudo() { return !!(JOGO.AppModelos && JOGO.AppModelos.escolha && JOGO.AppModelos.escolha() === 'tudo'); }

  /* A ABERTURA (o index.html chama quando a página termina de carregar). Ligado: registra, apaga as
   * versões velhas e — para quem escolheu Baixar tudo — completa. Desligado (pelo jogador ou por nós):
   * garante que nada ficou. Fora do aplicativo: não faz NADA, nem olha se há service worker. */
  G.abre = function () {
    if (!G.noApp() || !sw()) return Promise.resolve(null);
    if (!G.ligado()) return G.desliga();
    return G.liga().then(function (reg) { return reg ? G.acerta(tudo()) : null; });
  };

  /* A SEÇÃO DAS CONFIGURAÇÕES (js/ui/hud.js a pendura só no aplicativo). */
  G.secaoConfig = function () {
    if (!G.pode()) return null;
    var sec = document.createElement('section');
    sec.className = 'cfg-sec';
    sec.id = 'cfg-jogo';
    function pinta(e) {
      sec.textContent = '';
      var lig = G.querGuardar();
      var h = document.createElement('h3'); h.className = 'bk-tit'; h.textContent = Tx('Jogo no aparelho');
      sec.appendChild(h);
      var ln = document.createElement('div'); ln.className = 'cfg-linha';
      var tx = document.createElement('div'); tx.className = 'cfg-tx';
      var b = document.createElement('b'); b.className = 'cfg-tit'; b.id = 'cfg-jogo-uso';
      b.textContent = lig ? Tx('{a} MB do jogo guardados', { a: mb(e.bytes) }) : Tx('O jogo não está guardado');
      var d = document.createElement('span'); d.className = 'cfg-dica';
      d.textContent = lig
        ? Tx('Os arquivos do jogo ficam no aparelho para abrir mais rápido e gastar menos dados. Para entrar e jogar, é preciso internet.')
        : Tx('Cada abertura baixa o jogo de novo. Guardar ocupa cerca de {a} MB e, do mesmo jeito, é preciso internet para entrar e jogar.', { a: mb(G.peso()) });
      tx.appendChild(b); tx.appendChild(d); ln.appendChild(tx);
      var x = document.createElement('button');
      x.type = 'button'; x.id = lig ? 'cfg-jogo-apagar' : 'cfg-jogo-guardar';
      x.className = 'btn-mini' + (lig ? '' : ' btn-gold');
      x.textContent = lig ? Tx('Apagar o jogo guardado') : Tx('Guardar o jogo');
      x.addEventListener('click', function () {
        x.disabled = true;
        (lig ? G.apaga() : G.guarda()).then(atualiza, atualiza);
      });
      ln.appendChild(x);
      sec.appendChild(ln);
    }
    function atualiza() {
      if (!G.querGuardar()) return pinta({ n: 0, bytes: 0 });
      G.estado().then(pinta, function () { pinta({ n: 0, bytes: 0 }); });
    }
    pinta({ n: 0, bytes: 0 });
    atualiza();
    return sec;
  };
})();
