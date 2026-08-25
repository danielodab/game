// Os ícones de item do usuário assumem o Art.itemIcon (dono: designer).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É
 * ============
 * O mesmo movimento do portraits3d: embrulha `Art.itemIcon` e, quando existe
 * arte do usuário para o item (JOGO.ICONES_ITENS, fundo removido por ele),
 * devolve ELA no lugar do desenho procedural — com o MESMO contrato de canvas
 * (físico = size×RES, __res/__w/__anchor), então toda célula do jogo (saco,
 * banco, mercado, forja, ficha, mesa de troca) troca de arte sem saber.
 *
 * DECODIFICAÇÃO É ASSÍNCRONA: até a imagem abrir, sai o procedural de sempre
 * — e como as fichas redesenham a cada abertura, a arte aparece já na
 * primeira visita real. Nada de tela esperando ícone.
 *
 * Item SEM arte continua procedural — os lotes chegam por calabouço e o jogo
 * não pode quebrar no intervalo entre eles.
 */
(function () {
  'use strict';

  var imagens = {};                // itemId -> HTMLImageElement (decodificando ou pronta)
  var prontos = {};                // itemId -> true quando decodificada
  var cache = {};                  // 'id:size' -> canvas embrulhado

  function preparar() {
    var A = JOGO.ICONES_ITENS || {};
    Object.keys(A).forEach(function (id) {
      if (imagens[id]) return;
      var img = new Image();
      img.onload = function () { prontos[id] = true; };
      img.src = 'data:image/png;base64,' + A[id];
      imagens[id] = img;
    });
  }

  function instalar() {
    var Art = JOGO.Art;
    if (!Art || Art.__iconesItensWrapped) return false;
    var original = Art.itemIcon;
    if (typeof original !== 'function') return false;

    Art.itemIcon = function (itemId, size) {
      size = size || 56;
      if (!prontos[itemId]) return original.call(Art, itemId, size);
      var chave = itemId + ':' + size;
      if (cache[chave]) return cache[chave];

      var res = (Art.res || 2);
      var c = document.createElement('canvas');
      c.width = Math.round(size * res);
      c.height = Math.round(size * res);
      c.__res = res; c.__w = size; c.__h = size;
      c.__anchor = [0.5, 0.5];
      var g = c.getContext('2d');
      var img = imagens[itemId];
      // contain: a peça inteira dentro do quadrado, folga transparente
      var esc = Math.min(c.width / img.width, c.height / img.height) * 0.94;
      var dw = img.width * esc, dh = img.height * esc;
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
      cache[chave] = c;
      return c;
    };
    Art.__iconesItensWrapped = true;
    return true;
  }

  preparar();
  // o Art pode carregar depois deste arquivo: insiste até ele existir
  (function tenta() {
    if (!instalar()) setTimeout(tenta, 120);
  })();
})();
