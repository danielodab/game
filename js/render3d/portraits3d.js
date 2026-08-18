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
  var cardCache = {};      // cartas de classe já compostas com o retrato 3D

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
    // ---------------------------------------------------------- carta de classe
    // A tela de Coleção NÃO passa por `Art.portrait`: ela chama `Art.cardIcon`
    // (= `Art.classCard`), que desenha moldura + raridade + nome e, no meio, um
    // boneco procedural 2D. Embrulhar só `portrait` deixava a Coleção inteira
    // com aquela figura antiga ao lado dos modelos 3D do tabuleiro.
    // Aqui a moldura, a borda de raridade e a placa de nome continuam sendo as
    // do `art.js` — trocamos apenas a FIGURA pelo retrato do modelo.
    var originalCard = A.classCard;
    if (originalCard) {
      A.classCard = function (classId, w, h) {
        w = w || 132; h = h || 186;
        var base = originalCard.call(A, classId, w, h);
        if (!base || hasHandArt(classId)) return base;
        var M = JOGO.Models3D2;
        if (!M || !M.isReady || !M.isReady()) return base;   // ainda decodificando

        var ck = 'card3d:' + classId + ':' + w + ':' + h;
        if (cardCache[ck]) return cardCache[ck];

        var res = base.width / w;                            // art.js pinta em RES
        var retrato = P.get(classId, { size: Math.max(128, Math.round((h - 46) * res)) });
        if (!retrato) return base;

        // cópia: o `base` vem do cache do art.js e não pode ser rabiscado
        var c = document.createElement('canvas');
        c.width = base.width; c.height = base.height;
        var g = c.getContext('2d');
        g.drawImage(base, 0, 0);

        // a figura ocupa a mesma janela que o art.js recorta para o boneco
        var fx = 6 * res, fy = 10 * res, fw = (w - 12) * res, fh = (h - 40) * res;
        g.save();
        g.beginPath(); g.rect(fx, fy, fw, fh); g.clip();
        // preenche a janela mantendo a proporção do retrato (corta o excesso)
        var esc = Math.max(fw / retrato.width, fh / retrato.height);
        var dw = retrato.width * esc, dh = retrato.height * esc;
        g.drawImage(retrato, fx + (fw - dw) / 2, fy + (fh - dh) / 2, dw, dh);
        g.restore();
        // redesenha a placa de nome por cima, que o retrato cobriu
        g.drawImage(base, 0, (h - 40) * res, base.width, base.height - (h - 40) * res,
                          0, (h - 40) * res, base.width, base.height - (h - 40) * res);

        c.__anchor = [0.5, 0.5];
        cardCache[ck] = c;
        return c;
      };
      A.cardIcon = A.classCard;
    }

    // ---------------------------------------------------------- boneco inteiro
    // `Art.unit` desenha a FIGURA DE CORPO INTEIRO, e e ela que aparece nos
    // cartoes da tela "Quem desce", na ficha do heroi e na celula de fusao —
    // cinco lugares que continuavam com o boneco procedural 2D ao lado dos
    // modelos 3D do tabuleiro. O usuario reclamou tres vezes ("os cards
    // precisam mudar! estao feio demais na versao 2d").
    var originalUnit = A.unit;
    if (originalUnit) {
      A.unit = function (defId, opts) {
        opts = opts || {};
        if (!hasHandArt(defId)) {
          var M = JOGO.Models3D2;
          if (M && M.isReady && M.isReady()) {
            var cv = null;
            try {
              cv = M.portrait(defId, {
                size: opts.size || 256,
                corpoInteiro: true,
                element: opts.element || (opts.elements && opts.elements[0]) || null,
                elements: opts.elements || null,
                kind: opts.kind || null, classId: opts.classId || null, boss: !!opts.boss
              });
            } catch (e) { cv = null; }
            if (cv) {
              // o hud posiciona pelo ancoradouro; corpo inteiro centra no meio
              cv.__res = 1;
              cv.__anchor = [0.5, 0.5];
              return cv;
            }
          }
        }
        return originalUnit.call(A, defId, opts);
      };
    }

    A.__portrait3dWrapped = true;
    wrapped = true;
    return true;
  };

  // instala assim que os modelos terminarem de decodificar
  if (typeof window !== 'undefined') {
    var tryInstall = function () {
      if (!JOGO.Art) { setTimeout(tryInstall, 120); return; }
      if (JOGO.Models3D2 && JOGO.Models3D2.load) {
        JOGO.Models3D2.load(function () {
          // Instalar não basta: a tela que já estava pintada continua exibindo o
          // 2D de emergência, porque o HUD desenha uma vez e não se redesenha
          // sozinho. Sem este repaint, quem abriu a tela durante a decodificação
          // ficava com o boneco antigo até sair e voltar.
          if (P.install() && JOGO.UI && JOGO.UI.repaint) {
            try { JOGO.UI.repaint(); } catch (e) {}
          }
        });
      } else {
        setTimeout(tryInstall, 200);
      }
    };
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', tryInstall);
    else tryInstall();
  }
})();
