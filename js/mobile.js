// SOTERRA — o que este aparelho é (dono: Agente Mobile).
//
// Um só lugar responde três perguntas que o resto do jogo faz o tempo todo, e
// que antes ninguém respondia:
//
//   toque()      — o dedo é o ponteiro principal? Se for, PASSAR POR CIMA não
//                  existe, e a prévia de área de feitiço precisa de outra porta
//                  (ver `renderer3d_v2.js`: toque-para-mirar, 2º toque confirma).
//   celular()    — a tela é estreita/retrato? A HUD desenhada para 1280 px não
//                  cabe em 390 px sem encolher.
//   economico()  — vale cortar brilho e traço? GPU de celular paga caro em
//                  preenchimento de tela, e o bloom são 5 desfoques por quadro.
//
// Nada aqui adivinha por marca de aparelho: `navigator.userAgent` mente e muda.
// Medimos o que importa — ponteiro grosso, ausência de hover, tamanho da tela.
//
// Manda por cima de tudo: `?mobile=1` liga, `?mobile=0` desliga. É como se testa
// o modo celular numa máquina de mesa (e é como `tests/perf.html` mede os dois).

var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

(function () {
  'use strict';

  var M = {};
  JOGO.Mobile = M;

  var busca = (typeof location !== 'undefined' && location.search) || '';
  var forcado = /[?&]mobile=1/.test(busca) ? true
              : /[?&]mobile=0/.test(busca) ? false
              : null;
  M.forcado = forcado;

  function media(q) {
    try { return !!(window.matchMedia && window.matchMedia(q).matches); }
    catch (e) { return false; }
  }

  function temToque() {
    if (typeof window === 'undefined') return false;
    if (navigator.maxTouchPoints > 0) return true;
    if ('ontouchstart' in window) return true;
    return media('(pointer: coarse)');
  }

  // "Sem hover" é o teste que importa para a prévia de feitiço: um híbrido
  // (notebook com tela sensível) TEM mouse, e ali passar por cima funciona.
  var toque = (forcado !== null) ? forcado : (temToque() && media('(hover: none)'));

  function larguraCurta() {
    var w = (window.innerWidth || 1280);
    var h = (window.innerHeight || 800);
    return Math.min(w, h) <= 520 || w <= 820;
  }
  /* Tela de aparelho, não janela pequena. A distinção importa: `larguraCurta`
   * dá verdadeiro numa janela de navegador de 800 px numa máquina de mesa — e
   * foi exatamente isso que apagou o brilho e o traço na medição de desktop,
   * fingindo um ganho que não existia. Aqui o corte é o formato de telefone:
   * um lado curto DE VERDADE e nenhum lado grande. */
  function telaDeAparelho() {
    var w = (window.innerWidth || 1280);
    var h = (window.innerHeight || 800);
    return Math.min(w, h) <= 480 && Math.max(w, h) <= 1024;
  }

  M.toque = function () { return toque; };
  M.celular = function () {
    if (forcado !== null) return forcado;
    return toque && larguraCurta();
  };
  M.retrato = function () { return (window.innerHeight || 0) >= (window.innerWidth || 1); };
  // Economia de GPU: vale para qualquer aparelho de toque, e para tela de
  // telefone — nunca por uma janela de desktop estar estreita.
  M.economico = function () {
    if (forcado !== null) return forcado;
    return toque || telaDeAparelho();
  };

  // Classes no <html> para o CSS que a consulta de mídia não alcança sozinha
  // (ex.: alvo de 44 px só quando o ponteiro é o dedo).
  function marca() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    var c = document.documentElement.classList;
    if (!c) return;
    c.toggle('toque', M.toque());
    c.toggle('celular', M.celular());
    c.toggle('retrato', M.retrato());
  }
  M.remarca = marca;
  marca();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', marca);
    window.addEventListener('orientationchange', function () { setTimeout(marca, 80); });
  }
})();
