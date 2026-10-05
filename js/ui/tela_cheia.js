// SOTERRA — a tela cheia (dono: Designer).
//
// 11/09, pedido do dono: "tanto para celular ou pc colocar tela cheia o jogo e
// um x no canto para fechar o modo tela cheia; cel deve funcionar nas
// orientações retrato e paisagem".
//
// UM botão, no canto de cima à direita, preso ao <body> — fora do #ui-root,
// que não recebe toque (o mesmo lugar do botão de teste) — e por isso vivo em
// todas as telas: ⛶ entra na tela cheia; dentro dela vira ✕ e sai. O Esc do
// computador também sai (é do navegador), e o botão acompanha pelo evento.
//
// A ORIENTAÇÃO NUNCA É TRAVADA: a tela cheia gira com o aparelho, retrato ou
// paisagem, e o jogo se remonta no `resize` que a troca de tela cheia e a
// volta do aparelho disparam (renderer3d_v2, hub3d e mobile.js já escutam). Um
// resize de reforço sai 150 ms depois de cada troca, para o navegador que
// troca a tela sem avisar na hora.
//
// SEM A API (o Safari do iPhone só põe VÍDEO em tela cheia): o ⛶ abre a
// explicação do caminho que funciona lá — "Adicionar à Tela de Início"; aberto
// pelo ícone, o jogo roda sem as barras do navegador (o index.html declara
// apple-mobile-web-app-capable). Aberto assim e sem a API, o botão nem aparece:
// não há barra nenhuma para esconder.
//
// O CANTO É RESERVADO pelo CSS: html.tem-canto liga `--canto`, e quem morava
// ali (o som, o recentrar e o cadeado da batalha, o "Menu" do Acampamento, o
// fim dos cabeçalhos, o botão de teste no celular) chega para a esquerda.

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
  if (typeof document === 'undefined') return;

  var TC = {};
  JOGO.TelaCheia = TC;
  var doc = document, raiz = doc.documentElement;
  var botao = null, ajuda = null;

  var ICONE_ENTRA = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2.5 6.5v-4h4M11.5 2.5h4v4M15.5 11.5v4h-4M6.5 15.5h-4v-4"/></svg>';
  var ICONE_SAI = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4 4l10 10M14 4L4 14"/></svg>';

  function cheia() { return doc.fullscreenElement || doc.webkitFullscreenElement || null; }
  function suporta() {
    return !!((doc.fullscreenEnabled || doc.webkitFullscreenEnabled) &&
              (raiz.requestFullscreen || raiz.webkitRequestFullscreen));
  }
  function instalado() {
    try {
      if (window.navigator && window.navigator.standalone === true) return true;
      return !!(window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches ||
                                      window.matchMedia('(display-mode: fullscreen)').matches));
    } catch (e) { return false; }
  }

  TC.suporta = suporta;
  TC.cheia = function () { return !!cheia(); };
  TC.entra = function () {
    var p = null;
    try {
      if (raiz.requestFullscreen) p = raiz.requestFullscreen({ navigationUI: 'hide' });
      else if (raiz.webkitRequestFullscreen) p = raiz.webkitRequestFullscreen();
    } catch (e) { p = null; }
    // recusou (quadro sem permissão, navegador que não deixa): a explicação
    if (p && typeof p.then === 'function') p.then(null, function () { mostraAjuda(); });
    return p;
  };
  TC.sai = function () {
    try {
      if (doc.exitFullscreen) {
        var p = doc.exitFullscreen();
        if (p && typeof p.then === 'function') p.then(null, function () {});
      } else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
    } catch (e) { /* já estava fora */ }
  };
  TC.alterna = function () {
    if (cheia()) TC.sai();
    else if (suporta()) TC.entra();
    else mostraAjuda();
  };

  function pinta() {
    if (!botao) return;
    var dentro = !!cheia();
    botao.innerHTML = dentro ? ICONE_SAI : ICONE_ENTRA;
    botao.classList.toggle('is-cheia', dentro);
    var rot = dentro ? Tx('Sair da tela cheia') : Tx('Tela cheia');
    botao.title = rot;
    botao.setAttribute('aria-label', rot);
    botao.setAttribute('aria-pressed', dentro ? 'true' : 'false');
    raiz.classList.toggle('tela-cheia', dentro);
    if (dentro) fechaAjuda();
  }
  function aoMudar() {
    pinta();
    setTimeout(function () {
      try { window.dispatchEvent(new Event('resize')); } catch (e) { /* navegador antigo */ }
    }, 150);
  }

  function fechaAjuda() { if (ajuda) ajuda.hidden = true; }
  function mostraAjuda() {
    if (!ajuda) {
      ajuda = doc.createElement('div');
      ajuda.className = 'tc-ajuda';
      ajuda.setAttribute('role', 'dialog');
      ajuda.setAttribute('aria-label', Tx('Tela cheia'));
      ajuda.innerHTML = Tx('<b>Tela cheia</b><p>Este navegador não deixa o jogo ocupar a tela inteira — é o caso do Safari no iPhone.</p><p>O jeito que funciona é instalar o SOTERRA na tela de início e abrir pelo ícone: ele roda sem as barras do navegador, em pé ou deitado.</p><ul><li><b>iPhone e iPad</b> (Safari): Compartilhar → <i>Adicionar à Tela de Início</i></li><li><b>Android</b>: menu ⋮ do navegador → <i>Instalar app</i> ou <i>Adicionar à tela inicial</i></li></ul><button type="button" class="btn btn-mini btn-primary tc-ok">Entendi</button>');
      ajuda.querySelector('.tc-ok').addEventListener('click', fechaAjuda);
      doc.body.appendChild(ajuda);
    }
    ajuda.hidden = false;
  }

  function monta() {
    if (botao || !doc.body) return;
    if (instalado() && !suporta()) return;     // aberto pelo ícone, sem API: não há barra para esconder
    botao = doc.createElement('button');
    botao.type = 'button';
    botao.className = 'tc-botao';
    // o toque no botão não chega ao jogo (a câmera, o tabuleiro, a praça)
    ['pointerdown', 'mousedown', 'touchstart'].forEach(function (t) {
      botao.addEventListener(t, function (ev) { ev.stopPropagation(); }, { passive: true });
    });
    botao.addEventListener('click', function (ev) { ev.stopPropagation(); TC.alterna(); });
    doc.body.appendChild(botao);
    raiz.classList.add('tem-canto');
    pinta();
  }

  doc.addEventListener('fullscreenchange', aoMudar);
  doc.addEventListener('webkitfullscreenchange', aoMudar);
  TC._pinta = pinta;                            // provas: a API de mentira troca e repinta
  if (doc.body) monta(); else doc.addEventListener('DOMContentLoaded', monta);
})();
