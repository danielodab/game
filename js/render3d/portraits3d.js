var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// JOGO.Portraits3D — retratos da HUD gerados a partir dos MODELOS 3D
// Dono: Agente de Migração 3D.
//
// Por que existe: com 6 classes, 66 monstros, 6 chefes, 6 pets e 15 fusões,
// desenhar retrato de tudo à mão é inviável. Renderizamos cada retrato uma vez
// numa cena offscreen (busto em 3/4, luz de três pontos, fundo em gradiente da
// cor do elemento, vinheta), cacheamos a textura e servimos por `Art.portrait`.
//
// REGRA DE PRECEDÊNCIA (não quebrar a arte do usuário):
//   1. arte desenhada à mão (js/render2d/spriteart.js, quando há sprite);
//   2. retrato 3D deste módulo;
//   3. retrato procedural do `js/render2d/art.js` (último recurso).
// Embrulhamos `Art.portrait` sem alterar a assinatura: `portrait(defId, opts)`
// devolve um <canvas> quadrado. Carregue este arquivo DEPOIS de art.js e de
// spriteart.js.
// ============================================================================

(function () {
  'use strict';

  var P = {};
  JOGO.Portraits3D = P;

  var wrapped = false;

  // ids que continuam com arte desenhada à mão (o spriteart embrulha antes)
  function hasHandArt(defId) {
    var S = JOGO.SpriteArt || JOGO.Sprites2D || null;
    if (S && typeof S.temSprite === 'function') {
      try { return !!S.temSprite(defId); } catch (e) { return false; }
    }
    return false;
  }

  P.get = function (defId, opts) {
    var M = JOGO.Models3D2;
    if (!M || !M.isReady || !M.isReady()) return null;
    opts = opts || {};
    try {
      return M.portrait(defId, {
        size: opts.size || 128,
        element: opts.element || (opts.elements && opts.elements[0]) || null,
        elements: opts.elements || null,
        kind: opts.kind || null,
        classId: opts.classId || null,
        boss: !!opts.boss
      });
    } catch (e) {
      if (console && console.warn) console.warn('[Portraits3D] falhou para ' + defId, e);
      return null;
    }
  };

  P.install = function () {
    var A = JOGO.Art;
    if (!A || wrapped || A.__portrait3dWrapped) return false;
    var original = A.portrait;
    A.portrait = function (defId, opts) {
      if (!hasHandArt(defId)) {
        var cv = P.get(defId, opts);
        if (cv) {
          cv.__res = 1;
          cv.__anchor = [0.5, 0.5];
          return cv;
        }
      }
      return original ? original.call(A, defId, opts) : null;
    };
    A.__portrait3dWrapped = true;
    wrapped = true;
    return true;
  };

  // instala assim que os modelos terminarem de decodificar
  if (typeof window !== 'undefined') {
    var tryInstall = function () {
      if (!JOGO.Art) { setTimeout(tryInstall, 120); return; }
      if (JOGO.Models3D2 && JOGO.Models3D2.load) {
        JOGO.Models3D2.load(function () { P.install(); });
      } else {
        setTimeout(tryInstall, 200);
      }
    };
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', tryInstall);
    else tryInstall();
  }
})();
