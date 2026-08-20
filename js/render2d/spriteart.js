// ============================================================================
// SOTERRA 2.0 — js/render2d/spriteart.js   (JOGO.SpriteArt)
//
// Serve os personagens desenhados à mão (as folhas em assets/packs, recortadas
// por tools/recorta_sprites.py e embutidas por tools/empacota_sprites.py).
//
// Como se encaixa: NÃO mexemos no renderizador nem na HUD. Este módulo apenas
// EMBRULHA `JOGO.Art.unit`. Quando existe sprite para o personagem pedido, ele
// devolve o sprite; quando não existe, cai no desenho procedural de sempre.
// Por isso as classes sem arte continuam funcionando enquanto a arte chega.
//
// Convenções que o renderizador espera de todo canvas devolvido:
//   __res  (supersampling; aqui 1)      __anchor = [ax, ay] em 0..1
// A âncora fica nos PÉS, porque é por ela que o boneco assenta na célula.
// ============================================================================
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

(function () {
  var S = JOGO.SpriteArt = JOGO.SpriteArt || {};

  // dir do jogo: 0=SE, 1=SW, 2=NW, 3=NE
  // As folhas trazem 'frente', 'costas' e os dois perfis. Para o tabuleiro
  // isométrico bastam frente/costas com espelhamento: SE e NE olham para a
  // direita, SW e NW para a esquerda.
  var DIR = [
    { base: 'frente', flip: false },   // 0 SE
    { base: 'frente', flip: true },    // 1 SW
    { base: 'costas', flip: true },    // 2 NW
    { base: 'costas', flip: false }    // 3 NE
  ];

  // Fase do jogo -> de quais folhas tirar cada quadro.
  // O ciclo de ANDAR alterna as duas variantes de passo que o autor desenhou:
  // é isso que faz as pernas se revezarem de verdade durante o deslocamento.
  var FASE = {
    idle:     ['parado', 'parado', 'parado_b', 'parado_b'],
    andar:    ['andar_a', 'andar_a', 'andar_b', 'andar_b'],
    atacar:   ['parado_b', 'atacar', 'atacar', 'atacar', 'parado_b'],
    conjurar: ['parado_b', 'parado_b', 'atacar', 'parado_b'],
    dano:     ['dano'],
    morte:    ['morte', 'morte', 'morte']
  };

  var imgs = {};        // chave -> HTMLImageElement já carregada
  var prontos = {};     // classe -> true quando todas as imagens carregaram
  var canvasCache = {};

  function carregaClasse(classe) {
    var pacote = JOGO.SPRITES && JOGO.SPRITES[classe];
    if (!pacote) return;
    var faltam = 0, k;
    for (k in pacote) {
      faltam++;
      (function (chave, dado) {
        var im = new Image();
        im.onload = function () {
          imgs[classe + '/' + chave] = im;
          if (--faltam === 0) prontos[classe] = true;
        };
        im.onerror = function () { if (--faltam === 0) prontos[classe] = true; };
        im.src = dado.src;
      })(k, pacote[k]);
    }
  }

  S.init = function () {
    if (!JOGO.SPRITES) return;
    for (var classe in JOGO.SPRITES) carregaClasse(classe);
    embrulhaArt();
  };

  S.temSprite = function (defId) {
    return !!(JOGO.SPRITES && JOGO.SPRITES[defId] && prontos[defId]);
  };

  // Descobre qual imagem serve para (fase, quadro, direção), com reservas:
  // se faltar a pose exata, usa a pose parada da mesma direção; se faltar a
  // direção, usa a frontal. Nunca devolve vazio para um personagem que tem arte.
  function achaImagem(classe, fase, quadro, dir) {
    var d = DIR[dir % 4] || DIR[0];
    var lista = FASE[fase] || FASE.idle;
    var passo = lista[Math.min(quadro, lista.length - 1)];
    var tentativas = [
      passo + '_' + d.base,
      passo + '_frente',
      'parado_' + d.base,
      'parado_frente'
    ];
    for (var i = 0; i < tentativas.length; i++) {
      var im = imgs[classe + '/' + tentativas[i]];
      if (im) return { img: im, flip: d.flip };
    }
    return null;
  }

  // Tamanho relativo de cada classe no tabuleiro (o Sumô é a referência).
  var PORTE = { sumo: 1.0, invocador: 0.92, bruxo: 0.9, arqueiro: 0.88, espadachim: 0.88, curandeiro: 0.72 };

  // O sprite precisa sair com a MESMA métrica do desenho procedural, senão o
  // boneco não assenta na célula: canvas 320x400 com supersampling 2 e âncora
  // em [0.5, 0.88]. O personagem é encaixado dentro da área acima da âncora.
  function desenha(classe, fase, quadro, dir, escala) {
    var chave = classe + '|' + fase + '|' + quadro + '|' + dir + '|' + escala;
    if (canvasCache[chave]) return canvasCache[chave];
    var achado = achaImagem(classe, fase, quadro, dir);
    if (!achado) return null;

    var M = (JOGO.Art && JOGO.Art.metrics) || { unitW: 160, unitH: 200, res: 2, anchorX: 0.5, anchorY: 0.88 };
    var res = M.res || 2;
    var cw = Math.round(M.unitW * res), ch = Math.round(M.unitH * res);
    var baseY = ch * (M.anchorY != null ? M.anchorY : 0.88);   // linha do chão
    var alturaAlvo = baseY * (PORTE[classe] || 0.9) * (escala || 1);

    var im = achado.img;
    var k = alturaAlvo / im.height;
    var dw = Math.max(1, Math.round(im.width * k));
    var dh = Math.max(1, Math.round(im.height * k));

    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    var x = Math.round((cw - dw) / 2), y = Math.round(baseY - dh);
    if (achado.flip) { g.translate(cw, 0); g.scale(-1, 1); x = cw - x - dw; }
    g.drawImage(im, x, y, dw, dh);

    c.__res = res;
    c.__w = cw; c.__h = ch;
    c.__anchor = [M.anchorX != null ? M.anchorX : 0.5, M.anchorY != null ? M.anchorY : 0.88];
    canvasCache[chave] = c;
    return c;
  }

  function embrulhaArt() {
    var A = JOGO.Art;
    if (!A || A.__spriteWrapped) return;
    var unitOriginal = A.unit;
    var retratoOriginal = A.portrait;

    A.unit = function (defId, opts) {
      opts = opts || {};
      if (S.temSprite(defId)) {
        var pose = opts.pose || {};
        var c = desenha(defId, pose.fase || 'idle', pose.frame || 0,
                        opts.dir || 0, opts.scale || 1);
        if (c) return c;
      }
      return unitOriginal.call(A, defId, opts);
    };

    // O retrato da HUD usa sempre a pose parada de frente, recortada no busto.
    A.portrait = function (defId, opts) {
      if (S.temSprite(defId)) {
        var base = desenha(defId, 'idle', 0, 0, 1);
        if (base) {
          var lado = Math.round(base.height * 0.52);
          var c = document.createElement('canvas');
          c.width = lado; c.height = lado;
          var g = c.getContext('2d');
          g.drawImage(base, (base.width - lado) / 2, 0, lado, lado, 0, 0, lado, lado);
          c.__res = 1; c.__anchor = [0.5, 0.5];
          return c;
        }
      }
      return retratoOriginal.call(A, defId, opts);
    };

    A.__spriteWrapped = true;
  }

  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', S.init);
    } else {
      S.init();
    }
  }
})();
