/* SOTERRA — A AVALIAÇÃO NA LOJA E OS ATALHOS DA COMUNIDADE (15/10).
 *
 * O mercado: o jogo que pede avaliação na hora certa (logo depois de uma vitória, para quem já
 * jogou o bastante) tem nota melhor na loja; e o jogador que acha um botão para falar com a
 * equipe reclama na loja menos. Aqui:
 *
 *  - `A.vitoria()`: contada a cada sala vencida (a tela roomClear, pelo embrulho do UI.showScreen).
 *    Na TERCEIRA vitória, com pelo menos dois dias desde o primeiro boot neste aparelho, e uma vez
 *    só, o aplicativo pede a avaliação pela caixa nativa da Google Play (o plugin
 *    @capacitor-community/in-app-review; a Play decide se mostra). Na web não pede nada.
 *  - `A.avaliar()`: o botão das Configurações — no aplicativo abre a mesma caixa; na web abre a
 *    página da Play numa aba.
 *  - `A.LINKS`: o e-mail da equipe e o endereço da comunidade. O da comunidade fica VAZIO até o dono
 *    pôr o dele (Discord, WhatsApp, Telegram): sem endereço, o botão não aparece.
 *
 * A contagem mora em localStorage 'soterra-avaliacao' {vitorias, primeiroBoot, pedidoEm}. Nada vai
 * ao servidor. O plugin segue o padrão do notificacoes.js: a ponte sobe na primeira chamada. */
(function (raiz) {
  'use strict';
  var JOGO = raiz.JOGO = raiz.JOGO || {};
  var A = JOGO.Avaliacao = JOGO.Avaliacao || {};

  A.CHAVE = 'soterra-avaliacao';
  A.VITORIAS_PARA_PEDIR = 3;
  A.DIAS_PARA_PEDIR = 2;
  A.APP_ID = 'br.com.soterra.jogo';
  A.LINKS = {
    email: 'system@viidoo.io',
    comunidade: ''        // o dono põe o endereço (Discord, WhatsApp, Telegram); vazio = sem botão
  };

  function texto(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
  function le(win) {
    try { return JSON.parse(win.localStorage.getItem(A.CHAVE) || '{}') || {}; } catch (e) { return {}; }
  }
  function grava(win, d) { try { win.localStorage.setItem(A.CHAVE, JSON.stringify(d)); } catch (e) {} }

  /* A REGRA, pura: dado o registro e o instante, pede agora? (e devolve o registro novo) */
  A.decide = function (d, agoraMs) {
    d = d || {};
    var novo = { vitorias: (d.vitorias || 0) + 1, primeiroBoot: d.primeiroBoot || agoraMs, pedidoEm: d.pedidoEm || 0 };
    var dias = (agoraMs - novo.primeiroBoot) / 86400000;
    var pede = !novo.pedidoEm && novo.vitorias >= A.VITORIAS_PARA_PEDIR && dias >= A.DIAS_PARA_PEDIR;
    if (pede) novo.pedidoEm = agoraMs;
    return { pede: pede, registro: novo };
  };

  function nativo() {
    try { var C = raiz.Capacitor; return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()); }
    catch (e) { return false; }
  }
  function plugin() {
    try { var g = raiz.capacitorInAppReview; return (g && g.InAppReview) || null; } catch (e) { return null; }
  }
  function carrega(src) {
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = s.onerror = function () { resolve(); };
      document.head.appendChild(s);
    });
  }
  var ponteP = null;
  function ponte() {
    if (plugin() || !nativo()) return Promise.resolve(!!plugin());
    if (ponteP) return ponteP;
    var url = (typeof raiz.__url === 'function') ? raiz.__url : function (f) { return f; };
    ponteP = (raiz.capacitorExports ? Promise.resolve() : carrega(url('vendor/capacitor/capacitor.js')))
      .then(function () { return carrega(url('vendor/capacitor/in-app-review.js')); })
      .then(function () { return !!plugin(); });
    ponteP.then(function (tem) { if (!tem) ponteP = null; });
    return ponteP;
  }

  A.noApp = nativo;
  A.paginaDaLoja = function () { return 'https://play.google.com/store/apps/details?id=' + A.APP_ID; };

  /* a caixa nativa (no app) ou a página da loja (na web); devolve Promise<'nativo'|'loja'|'nada'> */
  A.avaliar = function () {
    if (!nativo()) {
      try { raiz.open(A.paginaDaLoja(), '_blank', 'noopener'); return Promise.resolve('loja'); } catch (e) { return Promise.resolve('nada'); }
    }
    return ponte().then(function (tem) {
      var p = plugin();
      if (!tem || !p || typeof p.requestReview !== 'function') return 'nada';
      return Promise.resolve(p.requestReview()).then(function () { return 'nativo'; }, function () { return 'nada'; });
    });
  };

  /* uma sala vencida: conta, e na hora certa pede (só no aplicativo) */
  A.vitoria = function () {
    var win = raiz;
    var r = A.decide(le(win), Date.now());
    grava(win, r.registro);
    if (!r.pede) return false;
    try { if (JOGO.EventosUso && JOGO.EventosUso.anota) JOGO.EventosUso.anota('avaliacao_pedida'); } catch (e) {}
    if (!nativo()) return false;
    A.avaliar();
    return true;
  };
  A.primeiroBoot = function () {
    var d = le(raiz);
    if (!d.primeiroBoot) { d.primeiroBoot = Date.now(); grava(raiz, d); }
  };

  /* o embrulho do UI.showScreen: a tela roomClear é a vitória da sala */
  function liga(win) {
    if (!win || !win.location || win.location.protocol === 'file:') return;
    A.primeiroBoot();
    var tentativas = 0;
    (function embrulha() {
      var UI = (win.JOGO || {}).UI;
      if (!UI || typeof UI.showScreen !== 'function') { if (++tentativas < 60) win.setTimeout(embrulha, 500); return; }
      if (UI.showScreen.__avaliacao) return;
      var original = UI.showScreen;
      var novo = function (nome) {
        try { if (nome === 'roomClear') A.vitoria(); } catch (e) {}
        return original.apply(this, arguments);
      };
      novo.__avaliacao = true;
      UI.showScreen = novo;
    })();
  }
  if (typeof window !== 'undefined' && raiz === window) liga(window);
})(typeof window !== 'undefined' ? window : globalThis);
