// Os ícones EXTRAS do usuário (03/09): pedras de forja, selos de chefe,
// insígnia de fundação e vintém — assumem o Art (dono: designer).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É
 * ============
 * O irmão do icones_itens.js. Embrulha `Art.stoneIcon` (as seis pedras de
 * forja eram um cristal procedural) e CRIA três funções que não existiam —
 * `Art.seloIcon(elemento, size)`, `Art.insigniaIcon(size)` e
 * `Art.vintemIcon(size)`: o selo e a insígnia eram os caracteres ❂ e ⚜ em
 * CSS, e o vintém não tinha ícone nenhum (só o número e a palavra).
 *
 * Mesmo contrato de canvas do resto do Art (físico = size×RES, __res/__w/
 * __anchor), então `art('seloIcon', ['fogo', 26], 26)` na HUD funciona como
 * qualquer outro ícone. Decodificação assíncrona: até a imagem abrir, sai o
 * procedural (pedra) ou um glifo de texto (❂ ⚜ ●) — nada de tela esperando.
 */
(function () {
  'use strict';

  var imagens = {};                // id -> HTMLImageElement
  var prontos = {};                // id -> true quando decodificada
  var cache = {};                  // 'id:size' -> canvas

  function preparar() {
    var A = JOGO.ICONES_EXTRAS || {};
    Object.keys(A).forEach(function (id) {
      if (imagens[id]) return;
      var img = new Image();
      img.onload = function () { prontos[id] = true; };
      img.src = 'data:image/png;base64,' + A[id];
      imagens[id] = img;
    });
  }

  function canvasBase(Art, size) {
    var res = (Art.res || 2);
    var c = document.createElement('canvas');
    c.width = Math.round(size * res);
    c.height = Math.round(size * res);
    c.__res = res; c.__w = size; c.__h = size;
    c.__anchor = [0.5, 0.5];
    return c;
  }

  // a arte do usuário dentro do quadrado (contain), com folga transparente
  function daArte(Art, id, size) {
    var chave = id + ':' + size;
    if (cache[chave]) return cache[chave];
    var c = canvasBase(Art, size);
    var g = c.getContext('2d');
    var img = imagens[id];
    var esc = Math.min(c.width / img.width, c.height / img.height) * 0.94;
    var dw = img.width * esc, dh = img.height * esc;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
    cache[chave] = c;
    return c;
  }

  // o glifo de antes, para a janela entre o boot e a decodificação
  function doGlifo(Art, glifo, cor, size) {
    var c = canvasBase(Art, size);
    var g = c.getContext('2d');
    g.fillStyle = cor;
    g.font = 'bold ' + Math.round(c.width * 0.78) + 'px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(glifo, c.width / 2, c.height / 2 + c.width * 0.04);
    return c;
  }

  function instalar() {
    var Art = JOGO.Art;
    if (!Art || Art.__iconesExtrasWrapped) return false;
    var stoneOriginal = Art.stoneIcon;
    if (typeof stoneOriginal !== 'function') return false;

    Art.stoneIcon = function (stoneId, size) {
      size = size || 56;
      if (!prontos[stoneId]) return stoneOriginal.call(Art, stoneId, size);
      return daArte(Art, stoneId, size);
    };
    Art.seloIcon = function (elemento, size) {
      size = size || 26;
      var id = 'selo-' + (elemento || 'neutro');
      if (prontos[id]) return daArte(Art, id, size);
      var cor = '#d8dee4';
      try { cor = Art.elementColor(elemento) || cor; } catch (e) {}
      return doGlifo(Art, '❂', cor, size);
    };
    Art.insigniaIcon = function (size) {
      size = size || 26;
      if (prontos.insignia) return daArte(Art, 'insignia', size);
      return doGlifo(Art, '⚜', '#c9a227', size);
    };
    Art.vintemIcon = function (size) {
      size = size || 16;
      if (prontos.vintem) return daArte(Art, 'vintem', size);
      return doGlifo(Art, '●', '#e8c25a', size);
    };
    // para os testes saberem se a ARTE já está servindo (e não o glifo)
    Art.__iconeExtraPronto = function (id) { return !!prontos[id]; };
    Art.__iconesExtrasWrapped = true;
    return true;
  }

  preparar();
  (function tenta() {
    if (!instalar()) setTimeout(tenta, 120);
  })();
})();
