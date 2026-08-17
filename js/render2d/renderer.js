var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// JOGO.Renderer — SOTERRA 2.0 · renderizador isométrico 2D em PixiJS 7
// Dono: Agente Designer RENDER.  Lei: docs/CONTRACT_V2.md §9.
//
// API do contrato:
//   Renderer.init(canvasOuContainer [, opts])
//   Renderer.render(dt)
//   Renderer.handleEvent(ev)
//   Renderer.isBusy()
//   Renderer.project(x, y [, z]) -> {x, y, s, d}     (coordenadas de TELA)
//   Renderer.setCamera({zoom, panX, panY})
//
// Câmera: isométrica FIXA (losangos, sem rotação — padrão Dofus 1.29).
//   arrastar = PAN · roda/pinça = ZOOM clampado · toque curto = ação na célula.
//   Entrada unificada por pointerdown/pointermove/pointerup (mouse == toque).
//
// CAMADAS (contêineres Pixi), de baixo para cima:
//   stage
//    ├ bgLayer        céu/névoa em espaço de TELA (Graphics, redesenhado no resize)
//    ├ world          [pan + zoom + shake]  ← tudo em espaço de MUNDO isométrico
//    │   ├ floorLayer     chão assado num Graphics único (rebuild só por sala)
//    │   ├ decalLayer     marcas do FX no chão (sob unidades)
//    │   ├ overlayLayer   overlays táticos (alcance/caminho/alvos/área/eventos/pet)
//    │   ├ objectLayer    obstáculos + unidades, ordenado por profundidade (zIndex)
//    │   ├ fxLayer        partículas/projéteis/impactos do FX
//    │   └ topLayer       números de dano e rótulos (contra-escala no zoom)
//    ├ weatherLayer   clima em espaço de TELA (chuva, calor, vendaval, poeira)
//    └ vignetteLayer  vinheta + tinta do clima
//
// CONTRATO INTERNO com js/render2d/fx.js (mesmo dono):
//   Renderer.iso(gx, gy, z) -> {x, y}     coordenadas de MUNDO (dentro de `world`)
//   Renderer.fxLayers()     -> {decal, fx, top, world, app}
//   Renderer.unitWorld(uid) -> {x, y} em células (posição ANIMADA) | null
//   Renderer.unitHeight(uid)-> altura visual em px de mundo
//   Renderer.hitDelay()     -> atraso até o payload do golpe atual (s)
//   Renderer.camZoom()      -> zoom atual
//   Renderer.elementColor(e)-> '#rrggbb'
//   Renderer.FUSION_TIMING  -> {approach, flash, reveal}
//   FX expõe: getShake(), getTimeScale(), setAmbient(theme), update(dt),
//             handleEvent(ev), reset(), _attach(ctx)
//
// ADAPTADOR DE ARTE (js/render2d/art.js, do Designer Arte — pode não existir):
//   Art.tile(kind, o) · Art.obstacle(kind, o) · Art.prop(kind, o) · Art.unit(defId, o)
//   Cada função pode devolver: PIXI.Texture | PIXI.Container | HTMLCanvasElement |
//   HTMLImageElement. Se devolver `undefined`, tentamos a assinatura canvas2d
//   `Art.fn(ctx2d, kind, o)` desenhando numa caixa [-w/2..w/2] × [-h..0].
//   Sem Art (ou em qualquer erro) usamos placeholders geométricos: o jogo RODA.
// ============================================================================

(function () {
  var R = {};
  var P = null;                    // referência a PIXI

  // ---------- constantes de projeção ----------
  // 128×64 é a métrica do Art (Art.metrics.tileW/tileH): assim a arte entra 1:1,
  // sem reamostragem, e o placeholder geométrico tem a mesma escala.
  var TW = 128, TH = 64;           // losango 2:1 (metade-largura 64, metade-altura 32)
  var HW = TW / 2, HH = TH / 2;
  var H_HIGH = 84;                 // altura do obstáculo ALTO (px de mundo)
  var H_LOW = 30;                  // altura do obstáculo BAIXO (cobertura)
  var D_HOLE = 38;                 // profundidade do buraco
  var ANIM_WATCHDOG = 3.0;         // §4: nenhuma animação vive mais que isto
  var TAP_PX = 8, TAP_MS = 250;    // toque curto = ação na célula

  R.TILE_W = TW; R.TILE_H = TH;
  R.FUSION_TIMING = { approach: 0.55, flash: 0.20, reveal: 0.55 };

  var ELEMENT_COLORS = {
    neutro: '#d9d2c2', fogo: '#ff7a3c', agua: '#4fb8f0',
    terra: '#8fc056', ar: '#cfe4ff'
  };
  R.elementColor = function (e) {
    var A = JOGO.Art;
    if (A && A.elements && A.elements[e]) return A.elements[e];
    return ELEMENT_COLORS[e] || ELEMENT_COLORS.neutro;
  };
  R.ELEMENT_COLORS = ELEMENT_COLORS;

  // ---------- estado ----------
  var app = null, stage = null, view = null, host = null;
  var bgLayer = null, world = null, floorLayer = null, decalLayer = null,
      overlayLayer = null, objectLayer = null, fxLayer = null, topLayer = null,
      weatherLayer = null, vignetteLayer = null;
  var W = 0, H = 0, DPR = 1;
  var ready = false, initFailed = false;

  var cam = { zoom: 1, panX: 0, panY: 0, fitZoom: 1, minZoom: 0.35, maxZoom: 2.6 };
  var shake = { x: 0, y: 0 };
  var nowT = 0;

  var vis = {};                    // uid -> visual state
  var unitNodes = {};              // uid -> PIXI.Container
  var animQ = [], delayed = [];
  var lastAtk = null, lastHitDelay = 0.26;
  var boardKey = null, boardNodes = [];
  var ovSig = '', ovPulse = null, ovEventNodes = [];
  var texCache = {}, artMode = {};
  var pendingEvents = [];          // eventos recebidos antes do init

  function game() { return JOGO.Game || null; }
  function engine() { return JOGO.Engine || null; }
  function state() { var g = game(); return (g && g.state) || null; }
  function DATA() { return JOGO.DATA || (JOGO.Game && JOGO.Game.DATA) || {}; }
  function findUnit(uid) {
    var st = state(); if (!st || !st.units) return null;
    for (var i = 0; i < st.units.length; i++) if (st.units[i].uid === uid) return st.units[i];
    return null;
  }

  // ---------- utilidades ----------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function hexInt(c) {
    if (typeof c === 'number') return c;
    if (typeof c !== 'string') return 0xffffff;
    var s = c.charAt(0) === '#' ? c.slice(1) : c;
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    return isNaN(n) ? 0xffffff : n;
  }
  R.hexInt = hexInt;
  function shadeHex(c, amt) {          // amt>0 clareia, <0 escurece
    var n = hexInt(c);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= (1 + amt); g *= (1 + amt); b *= (1 + amt); }
    return (Math.round(clamp(r, 0, 255)) << 16) | (Math.round(clamp(g, 0, 255)) << 8) | Math.round(clamp(b, 0, 255));
  }
  R.shadeHex = shadeHex;
  function mixHex(a, b, k) {
    var A = hexInt(a), B = hexInt(b);
    var r = ((A >> 16) & 255) * (1 - k) + ((B >> 16) & 255) * k;
    var g = ((A >> 8) & 255) * (1 - k) + ((B >> 8) & 255) * k;
    var c = (A & 255) * (1 - k) + (B & 255) * k;
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(c);
  }
  function hashStr(s) {
    var h = 2166136261; s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  function srand(seed) {
    var s = seed >>> 0 || 1;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  // ---------- projeção isométrica ----------
  function iso(gx, gy, z) {
    return { x: (gx - gy) * HW, y: (gx + gy) * HH - (z || 0) };
  }
  R.iso = iso;
  R.project = function (gx, gy, z) {
    var p = iso(gx, gy, z);
    return {
      x: cam.panX + shake.x + p.x * cam.zoom,
      y: cam.panY + shake.y + p.y * cam.zoom,
      s: cam.zoom, d: gx + gy
    };
  };
  function unproject(sx, sy) {
    var ix = (sx - cam.panX - shake.x) / cam.zoom;
    var iy = (sy - cam.panY - shake.y) / cam.zoom;
    var a = ix / HW, b = iy / HH;
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }
  R.camZoom = function () { return cam.zoom; };

  // ---------- leitura DEFENSIVA do grid ----------
  // aceita tiles como objeto {type,deco} ou como caractere de layout
  function tileKind(t) {
    if (t == null) return 'floor';
    if (typeof t === 'string') {
      if (t === '#') return 'high';
      if (t === '=') return 'low';
      if (t === '~') return 'hole';
      if (t === ',') return 'deco';
      return 'floor';
    }
    var ty = t.type || t.kind || 'floor';
    if (ty === 'wall' || ty === 'high' || ty === 'highwall' || ty === 'obstacle') return 'high';
    if (ty === 'low' || ty === 'cover' || ty === 'lowwall' || ty === 'lowObstacle' || ty === 'half') return 'low';
    if (ty === 'hole' || ty === 'void' || ty === 'empty' || ty === 'pit') return 'hole';
    if (t.low === true || t.cover === true) return 'low';
    if (ty === 'deco' || t.deco) return 'deco';
    return 'floor';
  }
  function gridTile(st, x, y) {
    if (!st || !st.grid || !st.grid.tiles) return null;
    if (y < 0 || x < 0 || y >= st.grid.h || x >= st.grid.w) return null;
    var row = st.grid.tiles[y];
    if (!row) return null;
    return typeof row === 'string' ? row.charAt(x) : row[x];
  }
  function dungeonOf(st) {
    var D = DATA();
    if (!D || !D.dungeons || !st) return null;
    var list = D.dungeons;
    for (var i = 0; i < list.length; i++) if (list[i].id === st.dungeonId) return list[i];
    return null;
  }
  function themeOf(st) {
    if (!st) return null;
    var dg = dungeonOf(st);
    if (st.sceneryTheme) return st.sceneryTheme;
    if (dg) {
      var room = dg.rooms && dg.rooms[st.roomIndex];
      if (room && room.sceneryTheme) return room.sceneryTheme;
      return dg.theme || dg.id;
    }
    return st.theme || null;
  }
  function dungeonPalette(st) {
    var dg = dungeonOf(st);
    var p = (dg && dg.palette) || (st && st.palette) || {};
    return {
      primary: p.primary || '#5c6a55',
      secondary: p.secondary || '#3b4739',
      accent: p.accent || '#ffd98a',
      floor1: p.floor1 || p.primary || '#4a5a48',
      floor2: p.floor2 || p.secondary || '#405039',
      wall: p.wall || p.secondary || '#39412f'
    };
  }
  function weatherId(st) {
    var w = st && st.weather;
    if (!w) return 'calmo';
    if (typeof w === 'string') return w;
    return w.id || 'calmo';
  }

  // ---------- adaptador de Arte (js/render2d/art.js, do Designer Arte) ----------
  // Art.unit(defId,{element|elements,dir,scale}) · Art.tile(theme,variante)
  // Art.obstacleHigh/obstacleLow(theme,chave) · Art.prop(theme,chave)
  // Art.tileEventIcon(kind,size) · Art.portrait/spellIcon/itemIcon (uso da HUD)
  // Cada uma devolve um <canvas> com __res (supersampling) e __anchor [ax,ay].
  // Se o Art não existir — ou explodir — cai no placeholder geométrico: o jogo RODA.
  function artOk(fnName) {
    var A = JOGO.Art;
    return !!(A && typeof A[fnName] === 'function' && artMode[fnName] !== 'fail');
  }
  // px de mundo por px de arte (1 quando as métricas batem, que é o caso)
  function artK() {
    var A = JOGO.Art, m = A && A.metrics;
    var base = (m && m.tileW) ? m.tileW : TW;
    return TW / base;
  }
  function artRaw(fnName, args) {
    if (!artOk(fnName)) return null;
    try {
      var r = JOGO.Art[fnName].apply(JOGO.Art, args);
      artMode[fnName] = r ? 'ok' : 'empty';
      return r || null;
    } catch (e) {
      artMode[fnName] = 'fail';
      if (typeof console !== 'undefined' && console.warn) console.warn('[Renderer] Art.' + fnName + ' falhou; usando placeholder.', e);
      return null;
    }
  }
  // <canvas>|Texture|Container -> DisplayObject pronto, já ancorado e escalado
  function artSprite(r, dfltAnchorY) {
    if (!r) return null;
    if (P.Container && r instanceof P.Container) return r;
    var tex = (r instanceof P.Texture) ? r : null;
    if (!tex) {
      if (!(r.getContext || r.tagName === 'IMG' || r.tagName === 'CANVAS')) return null;
      tex = P.Texture.from(r);          // PIXI cacheia a baseTexture pelo canvas
    }
    var sp = new P.Sprite(tex);
    var an = r.__anchor || [0.5, dfltAnchorY == null ? 1 : dfltAnchorY];
    sp.anchor.set(an[0], an[1]);
    sp.scale.set(artK() / (r.__res || 1));
    return sp;
  }
  function artCanvas(fnName, args) { return artRaw(fnName, args); }
  function artNode(fnName, args, dfltAnchorY) { return artSprite(artRaw(fnName, args), dfltAnchorY); }

  // cor média do chão da arte — usada para casar buraco/sombra/fundo com o tema
  function sampleColor(cv, px, py) {
    if (!cv || !cv.getContext) return null;
    try {
      var c2 = cv.getContext('2d', { willReadFrequently: true });
      var d = c2.getImageData(Math.round(px), Math.round(py), 1, 1).data;
      if (d[3] < 8) return null;
      return (d[0] << 16) | (d[1] << 8) | d[2];
    } catch (e) { return null; }
  }
  // altura REAL do desenho acima dos pés (px de mundo): a caixa do canvas é
  // maior que a figura, e barra de vida solta no ar fica feia.
  function artTop(cv) {
    if (!cv || !cv.getContext) return 0;
    if (cv.__topPx != null) return cv.__topPx * (artK() / (cv.__res || 1));
    var res = 0;
    try {
      var c2 = cv.getContext('2d', { willReadFrequently: true });
      var w = cv.width, h = cv.height;
      var img = c2.getImageData(0, 0, w, h).data;
      var top = h, x, y;
      for (y = 0; y < h; y += 2) {
        for (x = 0; x < w; x += 3) {
          if (img[(y * w + x) * 4 + 3] > 24) { top = y; y = h; break; }
        }
      }
      var an = (cv.__anchor && cv.__anchor[1] != null) ? cv.__anchor[1] : 1;
      res = Math.max(8, h * an - top);
    } catch (e) { res = cv.height * 0.7; }
    cv.__topPx = res;
    return res * (artK() / (cv.__res || 1));
  }

  // ---------- texturas procedurais (partilhadas com o FX) ----------
  function canvasTex(key, w, h, draw) {
    if (texCache[key]) return texCache[key];
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var c = cv.getContext('2d');
    draw(c, w, h);
    var t = P.Texture.from(cv);
    texCache[key] = t;
    return t;
  }
  R.canvasTex = function (key, w, h, draw) { return canvasTex(key, w, h, draw); };

  function texDot() {
    return canvasTex('dot', 64, 64, function (c) {
      var g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    });
  }
  function texHard() {
    return canvasTex('hard', 32, 32, function (c) {
      var g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(16, 16, 16, 0, 6.2832); c.fill();
    });
  }
  function texShadow() {
    return canvasTex('shadow', 128, 64, function (c) {
      var g = c.createRadialGradient(64, 32, 0, 64, 32, 64);
      g.addColorStop(0, 'rgba(0,0,0,0.62)');
      g.addColorStop(0.6, 'rgba(0,0,0,0.28)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.save(); c.translate(64, 32); c.scale(1, 0.5); c.beginPath(); c.arc(0, 0, 62, 0, 6.2832); c.fill(); c.restore();
    });
  }
  R.texDot = texDot; R.texHard = texHard;

  // ---------- init ----------
  R.init = function (target, opts) {
    opts = opts || {};
    if (typeof PIXI === 'undefined') {
      initFailed = true;
      if (typeof console !== 'undefined') console.error('[Renderer] PIXI não carregado (vendor/pixi.min.js).');
      return false;
    }
    P = PIXI;
    if (app) return true;

    if (target && target.tagName === 'CANVAS') { view = target; host = target.parentElement || document.body; }
    else {
      host = target || document.body;
      view = document.createElement('canvas');
      view.style.display = 'block';
      host.appendChild(view);
    }
    DPR = clamp(window.devicePixelRatio || 1, 1, 2);   // mobile: nunca acima de 2

    var wantPreserve = opts.preserveDrawingBuffer ||
      (typeof location !== 'undefined' && /[?&]snap=/.test(location.search || ''));

    var box = measure();
    W = box.w; H = box.h;
    try {
      app = new P.Application({
        view: view, width: W, height: H,
        backgroundColor: 0x0a0d10, backgroundAlpha: 1,
        antialias: opts.antialias !== false,
        resolution: DPR, autoDensity: true,
        autoStart: false, preserveDrawingBuffer: !!wantPreserve,
        powerPreference: 'high-performance'
      });
    } catch (e) {
      initFailed = true;
      if (typeof console !== 'undefined') console.error('[Renderer] falha ao criar PIXI.Application:', e);
      return false;
    }
    stage = app.stage;
    stage.sortableChildren = false;

    bgLayer = new P.Container();
    world = new P.Container();
    floorLayer = new P.Container();
    decalLayer = new P.Container();
    overlayLayer = new P.Container();
    objectLayer = new P.Container(); objectLayer.sortableChildren = true;
    fxLayer = new P.Container();
    topLayer = new P.Container();
    weatherLayer = new P.Container();
    vignetteLayer = new P.Container();
    world.addChild(floorLayer, decalLayer, overlayLayer, objectLayer, fxLayer, topLayer);
    stage.addChild(bgLayer, world, weatherLayer, vignetteLayer);

    buildBackdrop();
    bindInput();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', function () { setTimeout(onResize, 60); });

    ready = true;
    // o FX vive no mesmo dono: entrega as camadas e reproduz eventos pendentes
    if (JOGO.FX && JOGO.FX._attach) {
      try { JOGO.FX._attach({ PIXI: P, app: app, renderer: R, decal: decalLayer, fx: fxLayer, top: topLayer, world: world, weather: weatherLayer }); }
      catch (e2) { if (console && console.warn) console.warn('[Renderer] FX._attach falhou', e2); }
    }
    if (pendingEvents.length) {
      var q = pendingEvents.slice(); pendingEvents.length = 0;
      for (var i = 0; i < q.length; i++) R.handleEvent(q[i]);
    }
    return true;
  };

  function measure() {
    var r = null;
    if (host && host.getBoundingClientRect) r = host.getBoundingClientRect();
    var w = r && r.width ? r.width : (window.innerWidth || 800);
    var h = r && r.height ? r.height : (window.innerHeight || 600);
    return { w: Math.max(240, Math.round(w)), h: Math.max(200, Math.round(h)) };
  }
  function onResize() {
    if (!app) return;
    var box = measure();
    if (box.w === W && box.h === H) return;
    W = box.w; H = box.h;
    app.renderer.resize(W, H);
    buildBackdrop();
    var st = state();
    if (st && st.grid) { fitBoard(st, true); }
    ovSig = '';
  }
  R.resize = onResize;

  // ---------- fundo e vinheta (espaço de tela) ----------
  var bgGfx = null, vigGfx = null, weatherTint = null, roomPal = null;
  function buildBackdrop() {
    if (!bgLayer) return;
    bgLayer.removeChildren();
    vignetteLayer.removeChildren();
    var st = state();
    var pal = roomPal || dungeonPalette(st);
    var deep = shadeHex(pal.secondary, -0.72);

    bgGfx = new P.Graphics();
    bgGfx.beginFill(deep).drawRect(0, 0, W, H).endFill();
    bgLayer.addChild(bgGfx);
    var glow = new P.Sprite(texDot());
    glow.anchor.set(0.5);
    glow.position.set(W / 2, H * 0.52);
    glow.width = W * 1.5; glow.height = H * 1.6;
    glow.tint = shadeHex(pal.primary, 0.05);
    glow.alpha = 0.30;
    glow.blendMode = P.BLEND_MODES.ADD;
    bgLayer.addChild(glow);

    weatherTint = new P.Graphics();
    weatherTint.beginFill(0xffffff).drawRect(0, 0, W, H).endFill();
    weatherTint.alpha = 0;
    vignetteLayer.addChild(weatherTint);

    vigGfx = new P.Graphics();
    // moldura escura nas bordas (barato: 4 faixas em degradê discreto)
    var band = Math.max(48, Math.min(W, H) * 0.22);
    for (var j = 0; j < 10; j++) {
      var a = 0.045 * (1 - j / 10);
      var o = band * (j / 10);
      vigGfx.beginFill(0x000000, a);
      vigGfx.drawRect(0, o, W, band / 10 + 1);
      vigGfx.drawRect(0, H - o - band / 10 - 1, W, band / 10 + 1);
      vigGfx.drawRect(o, 0, band / 10 + 1, H);
      vigGfx.drawRect(W - o - band / 10 - 1, 0, band / 10 + 1, H);
      vigGfx.endFill();
    }
    vignetteLayer.addChild(vigGfx);
  }

  // ---------- câmera ----------
  function boardBounds(st) {
    var w = st.grid.w, h = st.grid.h;
    var c = [iso(-0.5, -0.5, 0), iso(w - 0.5, -0.5, 0), iso(w - 0.5, h - 0.5, 0), iso(-0.5, h - 0.5, 0)];
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (var i = 0; i < 4; i++) {
      x0 = Math.min(x0, c[i].x); x1 = Math.max(x1, c[i].x);
      y0 = Math.min(y0, c[i].y); y1 = Math.max(y1, c[i].y);
    }
    y0 -= H_HIGH; y1 += 26;
    return { x0: x0, x1: x1, y0: y0, y1: y1 };
  }
  function fitBoard(st, keepZoom) {
    if (!st || !st.grid) return;
    var b = boardBounds(st);
    var pad = 0.90;
    var z = Math.min(W * pad / (b.x1 - b.x0), H * pad / (b.y1 - b.y0));
    // MOBILE: caber a sala inteira deixaria a célula com ~36 px — menor que o
    // alvo de toque de 44 px do contrato. Preferimos começar aproximado e
    // deixar o jogador arrastar (é o que o Dofus faz no celular).
    var small = Math.min(W, H) < 620;
    var minTilePx = small ? 58 : 44;
    var didZoomIn = false;
    if (z < minTilePx / TW) { z = minTilePx / TW; didZoomIn = true; }
    cam.fitZoom = clamp(z, 0.3, 2.2);
    cam.minZoom = Math.max(0.26, cam.fitZoom * (didZoomIn ? 0.45 : 0.62));
    cam.maxZoom = Math.min(3.0, Math.max(cam.fitZoom * 2.4, 1.8));
    if (!keepZoom) cam.zoom = cam.fitZoom;
    cam.zoom = clamp(cam.zoom, cam.minZoom, cam.maxZoom);
    // sem caber tudo, a câmera nasce em cima do grupo do jogador
    var cxy = null;
    if (didZoomIn) cxy = partyCenter(st);
    if (cxy) {
      var pc = iso(cxy.x, cxy.y, 0);
      cam.panX = W / 2 - pc.x * cam.zoom;
      cam.panY = H / 2 - pc.y * cam.zoom;
    } else {
      cam.panX = W / 2 - ((b.x0 + b.x1) / 2) * cam.zoom;
      cam.panY = H / 2 - ((b.y0 + b.y1) / 2) * cam.zoom;
    }
    clampCam();
  }
  function partyCenter(st) {
    if (!st.units || !st.units.length) return null;
    var sx = 0, sy = 0, n = 0;
    for (var i = 0; i < st.units.length; i++) {
      var u = st.units[i];
      if (!u.alive || u.side !== 'player') continue;
      sx += u.x; sy += u.y; n++;
    }
    return n ? { x: sx / n, y: sy / n } : null;
  }
  function clampCam() {
    var st = state();
    if (!st || !st.grid) return;
    var b = boardBounds(st);
    var m = Math.min(W, H) * 0.30;
    var lo = W - m - b.x1 * cam.zoom, hi = m - b.x0 * cam.zoom;
    cam.panX = lo > hi ? (lo + hi) / 2 : clamp(cam.panX, lo, hi);
    lo = H - m - b.y1 * cam.zoom; hi = m - b.y0 * cam.zoom;
    cam.panY = lo > hi ? (lo + hi) / 2 : clamp(cam.panY, lo, hi);
  }
  R.setCamera = function (o) {
    if (!o) return;
    if (o.zoom != null) cam.zoom = clamp(o.zoom, cam.minZoom, cam.maxZoom);
    if (o.panX != null) cam.panX = o.panX;
    if (o.panY != null) cam.panY = o.panY;
    if (o.centerX != null && o.centerY != null) {
      var p = iso(o.centerX, o.centerY, 0);
      cam.panX = W / 2 - p.x * cam.zoom;
      cam.panY = H / 2 - p.y * cam.zoom;
    }
    clampCam();
  };
  R.getCamera = function () { return { zoom: cam.zoom, panX: cam.panX, panY: cam.panY, fitZoom: cam.fitZoom }; };

  // ---------- foco cinematográfico (usado pela FUSÃO) ----------
  var camFocus = null;
  function focusOn(gx, gy, inDur, holdDur, outDur, punch) {
    var c0 = unproject(W / 2, H / 2);
    camFocus = {
      x: gx, y: gy, cx: c0.x, cy: c0.y, z0: cam.zoom,
      t: 0, inD: inDur, holdD: holdDur, outD: outDur,
      punch: punch == null ? 0.22 : punch
    };
  }
  R.focusOn = focusOn;
  function updateCamFocus(dt) {
    if (!camFocus) return;
    var f = camFocus;
    f.t += dt;
    var k;
    if (f.t < f.inD) { k = f.t / f.inD; k = k * k * (3 - 2 * k); }
    else if (f.t < f.inD + f.holdD) k = 1;
    else if (f.t < f.inD + f.holdD + f.outD) {
      k = 1 - (f.t - f.inD - f.holdD) / f.outD; k = k * k * (3 - 2 * k);
    } else { camFocus = null; return; }
    var z = clamp(f.z0 * (1 + f.punch * k), cam.minZoom, cam.maxZoom);
    var cx = f.cx + (f.x - f.cx) * k, cy = f.cy + (f.y - f.cy) * k;
    var p = iso(cx, cy, 24);
    cam.zoom = z;
    cam.panX = W / 2 - p.x * z;
    cam.panY = H / 2 - p.y * z;
    clampCam();
  }
  function zoomAt(sx, sy, factor) {
    var z0 = cam.zoom;
    var z1 = clamp(z0 * factor, cam.minZoom, cam.maxZoom);
    if (z1 === z0) return;
    cam.panX = sx - (sx - cam.panX) * (z1 / z0);
    cam.panY = sy - (sy - cam.panY) * (z1 / z0);
    cam.zoom = z1;
    clampCam();
  }

  // ---------- entrada unificada (mouse + toque) ----------
  var ptrs = {}, ptrCount = 0, drag = null, pinch = null, hoverTile = null;
  function overUI(e) {
    var t = e && e.target;
    if (!t || !t.closest) return false;
    return !!t.closest('#ui-root');
  }
  function localPos(e) {
    var r = view.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function bindInput() {
    view.style.touchAction = 'none';
    view.style.webkitTapHighlightColor = 'transparent';

    view.addEventListener('pointerdown', function (e) {
      if (overUI(e)) return;
      camFocus = null;                 // a mão do jogador manda mais que a câmera
      var p = localPos(e);
      ptrs[e.pointerId] = { x: p.x, y: p.y, sx: p.x, sy: p.y, t: (e.timeStamp || Date.now()), type: e.pointerType };
      ptrCount++;
      if (view.setPointerCapture) { try { view.setPointerCapture(e.pointerId); } catch (er) {} }
      if (ptrCount === 1) {
        drag = { id: e.pointerId, moved: false, px: p.x, py: p.y };
        pinch = null;
      } else if (ptrCount === 2) {
        drag = null;
        var ids = Object.keys(ptrs);
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        pinch = { ids: ids, dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      }
      e.preventDefault();
    }, { passive: false });

    var moveHandler = function (e) {
      var rec = ptrs[e.pointerId];
      var p = localPos(e);
      if (!rec) {
        if (e.pointerType === 'mouse' && !overUI(e)) doHover(p.x, p.y);
        return;
      }
      rec.x = p.x; rec.y = p.y;
      if (pinch && ptrCount >= 2) {
        var a = ptrs[pinch.ids[0]], b = ptrs[pinch.ids[1]];
        if (a && b) {
          var d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          zoomAt(mx, my, d / (pinch.dist || d));
          cam.panX += mx - pinch.mx; cam.panY += my - pinch.my;
          clampCam();
          pinch.dist = d; pinch.mx = mx; pinch.my = my;
        }
      } else if (drag && drag.id === e.pointerId) {
        var dx = p.x - drag.px, dy = p.y - drag.py;
        if (!drag.moved && Math.hypot(p.x - rec.sx, p.y - rec.sy) > TAP_PX) drag.moved = true;
        if (drag.moved) { cam.panX += dx; cam.panY += dy; clampCam(); }
        drag.px = p.x; drag.py = p.y;
      }
      e.preventDefault();
    };
    view.addEventListener('pointermove', moveHandler, { passive: false });
    window.addEventListener('pointermove', function (e) {
      if (ptrs[e.pointerId]) moveHandler(e);          // arrasto que sai do canvas
    }, { passive: false });

    function endPointer(e) {
      var rec = ptrs[e.pointerId];
      if (!rec) return;
      var p = localPos(e);
      var dt = (e.timeStamp || Date.now()) - rec.t;
      var dist = Math.hypot(p.x - rec.sx, p.y - rec.sy);
      var wasTap = ptrCount === 1 && drag && drag.id === e.pointerId && !drag.moved &&
        dist < TAP_PX && dt < TAP_MS;
      delete ptrs[e.pointerId];
      ptrCount = Math.max(0, ptrCount - 1);
      if (ptrCount < 2) pinch = null;
      if (ptrCount === 0) drag = null;
      else if (drag && drag.id === e.pointerId) {
        var left = Object.keys(ptrs)[0];
        drag = left ? { id: left, moved: true, px: ptrs[left].x, py: ptrs[left].y } : null;
      }
      if (wasTap && !overUI(e)) doTap(p.x, p.y);
    }
    view.addEventListener('pointerup', endPointer);
    view.addEventListener('pointercancel', endPointer);
    window.addEventListener('pointerup', function (e) { if (ptrs[e.pointerId]) endPointer(e); });

    view.addEventListener('wheel', function (e) {
      if (overUI(e)) return;
      e.preventDefault();
      var p = localPos(e);
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0012));
    }, { passive: false });
    view.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    view.addEventListener('pointerleave', function () { doHover(-1e6, -1e6); });
  }

  function tileFromScreen(sx, sy) {
    var w = unproject(sx, sy);
    return { x: Math.round(w.x), y: Math.round(w.y) };
  }
  function doHover(sx, sy) {
    var g = game(); if (!g || !g.onTileHover) return;
    var t = tileFromScreen(sx, sy);
    var st = state();
    if (!st || !st.grid || t.x < 0 || t.y < 0 || t.x >= st.grid.w || t.y >= st.grid.h) {
      if (hoverTile) { hoverTile = null; g.onTileHover(-1, -1); }
      return;
    }
    if (hoverTile && hoverTile.x === t.x && hoverTile.y === t.y) return;
    hoverTile = t;
    g.onTileHover(t.x, t.y);
  }
  function doTap(sx, sy) {
    var g = game(); if (!g || !g.onTileClicked) return;
    if (R.isBusy()) return;
    var t = tileFromScreen(sx, sy);
    g.onTileClicked(t.x, t.y);
  }

  // ---------- placeholders geométricos ----------
  function paletteFor(u) {
    var D = DATA(), def = null, id = u.defId || u.id || '';
    if (String(id).indexOf('fus:') === 0) {
      var parts = String(id).slice(4).split('+');
      var pa = classPal(parts[0]), pb = classPal(parts[1]);
      return { primary: mixHex(pa.primary, pb.primary, 0.5), secondary: mixHex(pa.secondary, pb.secondary, 0.5),
        accent: pb.accent || pa.accent, fused: true, a: pa, b: pb };
    }
    if (D.classes && D.classes[id] && D.classes[id].palette) def = D.classes[id].palette;
    else if (D.monsters && D.monsters[id] && D.monsters[id].palette) def = D.monsters[id].palette;
    else if (D.pets && D.pets[id]) def = D.pets[id].palette || null;
    if (u.classId && !def && D.classes && D.classes[u.classId]) def = D.classes[u.classId].palette;
    if (def) return { primary: def.primary || '#8a8a96', secondary: def.secondary || '#4a4a56', accent: def.accent || '#ffd98a' };
    var h = hashStr(id);
    var hue = h % 360;
    return { primary: hsl(hue, 46, 52), secondary: hsl(hue, 40, 30), accent: hsl((hue + 40) % 360, 70, 66) };
  }
  function classPal(cid) {
    var D = DATA();
    if (D.classes && D.classes[cid] && D.classes[cid].palette) return D.classes[cid].palette;
    var h = hashStr(cid || 'x');
    return { primary: hsl(h % 360, 46, 52), secondary: hsl(h % 360, 40, 30), accent: hsl((h + 40) % 360, 70, 66) };
  }
  function hsl(h, s, l) {
    s /= 100; l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return '#' + [r, g, b].map(function (v) {
      var t = Math.round((v + m) * 255).toString(16); return t.length < 2 ? '0' + t : t;
    }).join('');
  }

  // desenha um bonequinho estilizado (Dofus-like simplificado) na caixa
  // x ∈ [-bw/2, bw/2], y ∈ [-bh, 0] — pés na origem.
  function placeholderUnit(u) {
    var pal = paletteFor(u);
    var g = new P.Graphics();
    var big = u.boss ? 1.42 : (u.kind === 'pet' ? 0.66 : 1);
    var bw = TW * 0.52 * big, bh = TW * 0.84 * big;
    var pri = hexInt(pal.primary), sec = hexInt(pal.secondary), acc = hexInt(pal.accent);
    var line = shadeHex(pal.secondary, -0.55);
    var elem = u.element || (DATA().monsters && DATA().monsters[u.defId] && DATA().monsters[u.defId].element) || 'neutro';
    var ecol = hexInt(R.elementColor(elem));

    g.beginFill(0x000000, 0.001).drawRect(-bw / 2 - 6, -bh - 16, bw + 12, bh + 18).endFill();

    // pés
    g.lineStyle(0);
    g.beginFill(line, 1).drawEllipse(-bw * 0.17, -3, bw * 0.15, 4).drawEllipse(bw * 0.17, -3, bw * 0.15, 4).endFill();
    // corpo (cápsula)
    g.lineStyle(2.2, line, 1);
    g.beginFill(pri, 1);
    g.moveTo(-bw * 0.30, -6);
    g.bezierCurveTo(-bw * 0.44, -bh * 0.34, -bw * 0.38, -bh * 0.58, -bw * 0.22, -bh * 0.62);
    g.lineTo(bw * 0.22, -bh * 0.62);
    g.bezierCurveTo(bw * 0.38, -bh * 0.58, bw * 0.44, -bh * 0.34, bw * 0.30, -6);
    g.closePath();
    g.endFill();
    // faixa/cinta na cor secundária
    g.lineStyle(0);
    g.beginFill(sec, 1).drawRect(-bw * 0.34, -bh * 0.36, bw * 0.68, bh * 0.10).endFill();
    g.beginFill(acc, 1).drawRect(-bw * 0.09, -bh * 0.37, bw * 0.18, bh * 0.12).endFill();
    // braços
    g.lineStyle(5.2 * big, pri, 1);
    g.moveTo(-bw * 0.30, -bh * 0.50); g.lineTo(-bw * 0.46, -bh * 0.26);
    g.moveTo(bw * 0.30, -bh * 0.50); g.lineTo(bw * 0.46, -bh * 0.26);
    g.lineStyle(2.0, line, 0.6);
    g.moveTo(-bw * 0.30, -bh * 0.50); g.lineTo(-bw * 0.46, -bh * 0.26);
    g.moveTo(bw * 0.30, -bh * 0.50); g.lineTo(bw * 0.46, -bh * 0.26);
    // cabeça
    g.lineStyle(2.2, line, 1);
    g.beginFill(mixHex(pal.primary, '#ffe6c8', 0.55), 1);
    g.drawEllipse(0, -bh * 0.79, bw * 0.28, bh * 0.19);
    g.endFill();
    // olhos
    g.lineStyle(0);
    g.beginFill(0x1a1418, 1)
      .drawEllipse(-bw * 0.10, -bh * 0.80, 2.4 * big, 3.4 * big)
      .drawEllipse(bw * 0.10, -bh * 0.80, 2.4 * big, 3.4 * big).endFill();
    // marca elemental / adorno de cabeça
    g.lineStyle(2, line, 0.9);
    g.beginFill(ecol, 1);
    if (u.boss) {
      g.moveTo(-bw * 0.30, -bh * 0.93);
      g.lineTo(-bw * 0.16, -bh * 1.10); g.lineTo(0, -bh * 0.95);
      g.lineTo(bw * 0.16, -bh * 1.10); g.lineTo(bw * 0.30, -bh * 0.93);
      g.closePath();
    } else if (u.kind === 'pet') {
      g.drawCircle(0, -bh * 1.02, bw * 0.11);
    } else {
      g.moveTo(0, -bh * 1.03); g.lineTo(bw * 0.13, -bh * 0.93);
      g.lineTo(0, -bh * 0.84); g.lineTo(-bw * 0.13, -bh * 0.93); g.closePath();
    }
    g.endFill();
    if (pal.fused) {   // silhueta partida ao meio nas duas cores
      g.lineStyle(0);
      g.beginFill(hexInt(pal.b ? pal.b.primary : pal.primary), 0.55);
      g.moveTo(0, -6); g.lineTo(bw * 0.30, -6);
      g.bezierCurveTo(bw * 0.38, -bh * 0.58, bw * 0.38, -bh * 0.58, bw * 0.22, -bh * 0.62);
      g.lineTo(0, -bh * 0.62); g.closePath(); g.endFill();
    }
    return { gfx: g, w: bw, h: bh };
  }

  function unitTexture(u) {
    var key = 'unit|' + u.defId + '|' + (u.boss ? 'b' : '') + (u.kind || '') + '|' + (u.element || '');
    if (texCache[key]) return texCache[key];
    var ph = placeholderUnit(u);
    var t = app.renderer.generateTexture(ph.gfx, { resolution: Math.min(2, DPR) });
    ph.gfx.destroy();
    texCache[key] = t;
    texCache[key + '|h'] = ph.h;
    return t;
  }

  // elementos da unidade (a fusão pode ter dois: a arte mistura as silhuetas)
  function unitElements(u) {
    if (u.elemPair && u.elemPair.length) return u.elemPair.slice(0, 2);
    if (u.elements && u.elements.length) return u.elements.slice(0, 2);
    var D = DATA();
    var e = u.element ||
      (D.monsters && D.monsters[u.defId] && D.monsters[u.defId].element) ||
      (D.pets && D.pets[u.defId] && D.pets[u.defId].element) || 'neutro';
    return [e];
  }
  // 0=SE(+x) · 1=SW(+y) · 2=NW(−x) · 3=NE(−y)
  function isoDir(dx, dy) {
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 2;
    return dy >= 0 ? 1 : 3;
  }
  function unitArtCanvas(u, dir) {
    // PREFERÊNCIA (combinada com o Designer Arte): se um dia o Art entregar
    // partes articuladas (Art.unitParts) ou quadros de pose, basta trocar a
    // fonte aqui — o rig abaixo já anima por peça.
    return artCanvas('unit', [u.defId, { elements: unitElements(u), dir: dir }]);
  }

  // ---------- RIG: o personagem é montado em PEÇAS e animado ----------
  // Sem partes prontas na arte, fatiamos o desenho na linha do quadril e
  // separamos as duas metades das pernas. Cada perna gira em torno do quadril,
  // o tronco cobre a emenda. Resultado: passo visível, célula a célula.
  function artBBox(cv) {
    if (cv.__bbox) return cv.__bbox;
    var bb = { x0: 0, y0: 0, x1: cv.width, y1: cv.height };
    try {
      var c2 = cv.getContext('2d', { willReadFrequently: true });
      var w = cv.width, h = cv.height;
      var img = c2.getImageData(0, 0, w, h).data;
      var x0 = w, y0 = h, x1 = -1, y1 = -1, x, y;
      for (y = 0; y < h; y += 2) {
        for (x = 0; x < w; x += 2) {
          if (img[(y * w + x) * 4 + 3] > 24) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 >= 0) bb = { x0: x0, y0: y0, x1: x1 + 2, y1: y1 + 2 };
    } catch (e) {}
    cv.__bbox = bb;
    return bb;
  }
  // descritor de fatias por canvas (uma vez por defId+direção)
  function rigOf(cv) {
    if (cv.__rig) return cv.__rig;
    var bb = artBBox(cv);
    var W2 = cv.width, H2 = cv.height;
    var an = cv.__anchor || [0.5, 1];
    var hipY = Math.round(bb.y0 + (bb.y1 - bb.y0) * 0.68);
    hipY = clamp(hipY, 2, H2 - 3);
    var midX = Math.round((bb.x0 + bb.x1) / 2);
    midX = clamp(midX, 2, W2 - 3);
    var seam = 4;                                  // sobreposição: nada de fresta
    var base = P.Texture.from(cv).baseTexture;
    var r = {
      torso: new P.Texture(base, new P.Rectangle(0, 0, W2, Math.min(H2, hipY + seam))),
      legL: new P.Texture(base, new P.Rectangle(0, hipY, midX, H2 - hipY)),
      legR: new P.Texture(base, new P.Rectangle(midX, hipY, W2 - midX, H2 - hipY)),
      hipY: hipY, midX: midX, w: W2, h: H2, ax: an[0], ay: an[1],
      res: cv.__res || 1,
      legH: (H2 - hipY)
    };
    cv.__rig = r;
    return r;
  }
  function addFlashChild(sp) {
    var f = new P.Sprite(sp.texture);
    f.blendMode = P.BLEND_MODES.ADD;
    f.alpha = 0;
    sp.addChild(f);
    return f;
  }
  function applyRig(node, cv) {
    var r = rigOf(cv);
    var s = artK() / r.res;
    var ax = r.ax * r.w, ay = r.ay * r.h;
    var t = node.__torso, l = node.__legL, rr = node.__legR;
    t.texture = r.torso; l.texture = r.legL; rr.texture = r.legR;
    if (t.__fl) t.__fl.texture = r.torso;
    if (l.__fl) l.__fl.texture = r.legL;
    if (rr.__fl) rr.__fl.texture = r.legR;
    t.scale.set(s); l.scale.set(s); rr.scale.set(s);
    t.position.set(-ax * s, -ay * s);
    // as duas pernas giram em torno do MESMO ponto: o quadril
    l.pivot.set(r.midX, 0);
    rr.pivot.set(0, 0);
    l.position.set((r.midX - ax) * s, (r.hipY - ay) * s);
    rr.position.set((r.midX - ax) * s, (r.hipY - ay) * s);
    node.__legLen = r.legH * s;
    node.__rigOk = true;
  }

  // ---------- tabuleiro ----------
  function clearBoard() {
    for (var i = 0; i < boardNodes.length; i++) {
      if (boardNodes[i].parent) boardNodes[i].parent.removeChild(boardNodes[i]);
      boardNodes[i].destroy({ children: true });
    }
    boardNodes.length = 0;
    floorLayer.removeChildren();
  }

  function sceneryOf(st) {
    var D = DATA(), th = themeOf(st);
    var s = (D.scenery && D.scenery[th]) || null;
    return {
      theme: th,
      high: (s && s.high) || [], low: (s && s.low) || [],
      floor: (s && s.floor) || [], props: (s && s.props) || []
    };
  }
  function pick(list, seed) {
    if (!list || !list.length) return null;
    return list[hashStr(seed) % list.length];
  }

  function buildBoard(st) {
    clearBoard();
    var theme = themeOf(st);
    var sc = sceneryOf(st);
    var pal = dungeonPalette(st);
    var w = st.grid.w, h = st.grid.h;
    var rnd = srand(hashStr(String(st.dungeonId) + '|' + st.roomIndex + '|' + w + 'x' + h));
    var tileCv = artOk('tile') ? artRaw('tile', [theme, 0]) : null;
    var useArtTile = !!tileCv;
    if (tileCv) {
      // o chão veio da arte: buraco e sombra passam a nascer da MESMA cor,
      // senão a sala fica com dois temas brigando
      var cTop = sampleColor(tileCv, tileCv.width * 0.5, tileCv.height * 0.42);
      var cSide = sampleColor(tileCv, tileCv.width * 0.5, tileCv.height * 0.94);
      if (cTop != null) { pal.floor1 = cTop; pal.floor2 = shadeHex(cTop, -0.10); pal.primary = cTop; }
      if (cSide != null) { pal.secondary = cSide; pal.wall = cSide; }
    }
    roomPal = pal;

    var f1 = hexInt(pal.floor1), f2 = hexInt(pal.floor2);
    var edge = shadeHex(pal.secondary, -0.45);
    var g = new P.Graphics();

    // sombra da sala (assenta o tabuleiro no escuro do fundo)
    g.beginFill(0x000000, 0.35);
    g.drawPolygon([
      iso(-1.4, -1.4).x, iso(-1.4, -1.4).y, iso(w + 0.4, -1.4).x, iso(w + 0.4, -1.4).y,
      iso(w + 0.4, h + 0.4).x, iso(w + 0.4, h + 0.4).y, iso(-1.4, h + 0.4).x, iso(-1.4, h + 0.4).y
    ]);
    g.endFill();

    // buracos e o chão geométrico moram no mesmo Graphics (1 draw call)
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var k = tileKind(gridTile(st, x, y));
        if (k === 'hole') { drawHole(g, x, y, pal); continue; }
        if (k === 'high' || k === 'low') continue;   // desenhados como objetos
        if (useArtTile) continue;                    // chão vem da arte
        var base = ((x + y) % 2) ? f1 : f2;
        var col = shadeHex(base, (rnd() - 0.5) * 0.06);
        g.beginFill(col, 1);
        diamond(g, x, y, 0, 0);
        g.endFill();
        g.lineStyle(1, edge, 0.30);
        diamondLine(g, x, y, 0.02, 0);
        g.lineStyle(0);
        if (k === 'deco') {
          // chão decorado: mancha temática + pontinhos
          g.beginFill(shadeHex(pal.accent, -0.35), 0.20);
          diamond(g, x, y, 0.16, 0);
          g.endFill();
          g.beginFill(shadeHex(pal.accent, -0.1), 0.28);
          for (var d = 0; d < 3; d++) {
            var px = iso(x + (rnd() - 0.5) * 0.5, y + (rnd() - 0.5) * 0.5, 0);
            g.drawEllipse(px.x, px.y, 3.2 + rnd() * 2.4, 1.8 + rnd());
          }
          g.endFill();
        }
      }
    }
    floorLayer.addChild(g);
    boardNodes.push(g);

    // chão de ARTE: sprites em ordem de linha (a espessura do losango cobre o
    // vizinho ao sul/leste, que é desenhado depois). Poucas texturas ⇒ o batch
    // do Pixi resolve a sala inteira em 1–2 draw calls.
    if (useArtTile) {
      for (var ay = 0; ay < h; ay++) {
        for (var ax = 0; ax < w; ax++) {
          var ak = tileKind(gridTile(st, ax, ay));
          if (ak === 'hole' || ak === 'high' || ak === 'low') continue;
          // 2 variações de chão + variação de decoração (','), mais uma rara
          var variant = (ak === 'deco') ? 2 : (((ax + ay) % 2) ? 1 : 0);
          if (ak !== 'deco' && (hashStr('v' + ax + '_' + ay + theme) % 11) === 0) variant = 3;
          var sp = artNode('tile', [theme, variant], 0.5);
          if (!sp) continue;
          var tp = iso(ax, ay, 0);
          sp.position.set(tp.x, tp.y);
          floorLayer.addChild(sp);
          boardNodes.push(sp);
        }
      }
    }

    // obstáculos como objetos (entram no depth-sort com as unidades)
    for (var y2 = 0; y2 < h; y2++) {
      for (var x2 = 0; x2 < w; x2++) {
        var k2 = tileKind(gridTile(st, x2, y2));
        if (k2 !== 'high' && k2 !== 'low') continue;
        var node = k2 === 'high' ? buildHigh(theme, sc, pal, x2, y2) : buildLow(theme, sc, pal, x2, y2);
        var p = iso(x2, y2, 0);
        node.position.set(p.x, p.y);
        node.zIndex = (x2 + y2) * 10 + (k2 === 'low' ? 1 : 2);
        objectLayer.addChild(node);
        boardNodes.push(node);
      }
    }

    // props: decoração SEM colisão nas células de chão decorado (','),
    // e de vez em quando num chão comum. Unidades podem pisar por cima.
    if (artOk('prop')) {
      for (var y3 = 0; y3 < h; y3++) {
        for (var x3 = 0; x3 < w; x3++) {
          var k3 = tileKind(gridTile(st, x3, y3));
          if (k3 !== 'deco' && k3 !== 'floor') continue;
          var hsh = hashStr('p' + x3 + '_' + y3 + theme);
          if (k3 === 'deco' ? (hsh % 3 !== 0) : (hsh % 29 !== 0)) continue;
          var pk = pick(sc.props, 'pk' + x3 + '_' + y3 + theme);
          var pn = artNode('prop', [theme, pk], 0.86);
          if (!pn) break;
          var pp3 = iso(x3 + ((hsh >> 3) % 7 - 3) * 0.045, y3 + ((hsh >> 7) % 7 - 3) * 0.045, 0);
          pn.position.set(pp3.x, pp3.y);
          pn.zIndex = (x3 + y3) * 10;      // abaixo da unidade da mesma célula (+5)
          objectLayer.addChild(pn);
          boardNodes.push(pn);
        }
      }
    }
  }

  function diamond(g, x, y, inset, z) {
    var k = 0.5 - (inset || 0);
    var a = iso(x - k, y - k, z), b = iso(x + k, y - k, z), c = iso(x + k, y + k, z), d = iso(x - k, y + k, z);
    g.drawPolygon([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]);
  }
  function diamondLine(g, x, y, inset, z) {
    var k = 0.5 - (inset || 0);
    var a = iso(x - k, y - k, z), b = iso(x + k, y - k, z), c = iso(x + k, y + k, z), d = iso(x - k, y + k, z);
    g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.lineTo(a.x, a.y);
  }
  function drawHole(g, x, y, pal) {
    // buraco: paredes internas descendo + fundo preto + borda quebrada iluminada
    var wallC = shadeHex(pal.secondary, -0.55);
    var deep = shadeHex(pal.secondary, -0.86);
    var k = 0.5;
    var bN = iso(x - k, y - k), bE = iso(x + k, y - k), bS = iso(x + k, y + k), bW = iso(x - k, y + k);
    g.beginFill(deep, 1); diamond(g, x, y, 0, 0); g.endFill();
    // paredes visíveis do buraco (norte/oeste ficam à vista na isométrica)
    g.beginFill(wallC, 1);
    g.drawPolygon([bN.x, bN.y, bE.x, bE.y, bE.x, bE.y + D_HOLE * 0.55, bN.x, bN.y + D_HOLE * 0.55]);
    g.endFill();
    g.beginFill(shadeHex(pal.secondary, -0.70), 1);
    g.drawPolygon([bW.x, bW.y, bN.x, bN.y, bN.x, bN.y + D_HOLE * 0.55, bW.x, bW.y + D_HOLE * 0.55]);
    g.endFill();
    g.beginFill(0x000000, 1); diamond(g, x, y, 0.20, -D_HOLE * 0.55); g.endFill();
    // lábio iluminado no lado da luz
    g.lineStyle(2, shadeHex(pal.primary, 0.35), 0.75);
    g.moveTo(bW.x, bW.y); g.lineTo(bN.x, bN.y); g.lineTo(bE.x, bE.y);
    g.lineStyle(1.4, 0x000000, 0.7);
    g.moveTo(bE.x, bE.y); g.lineTo(bS.x, bS.y); g.lineTo(bW.x, bW.y);
    g.lineStyle(0);
  }

  // obstáculo ALTO: prisma sólido, bloqueia visão — silhueta pesada e opaca
  function buildHigh(theme, sc, pal, x, y) {
    var c = new P.Container();
    var art = artNode('obstacleHigh', [theme, pick(sc.high, 'h' + x + '_' + y + theme)], 0.8);
    if (art) { c.addChild(art); c.__artH = (art.height || H_HIGH); return c; }
    var g = new P.Graphics();
    var rnd = srand(hashStr('h' + x + '_' + y + theme));
    var hgt = H_HIGH * (0.86 + rnd() * 0.30);
    var top = hexInt(shadeHex(pal.wall, 0.20));
    var left = hexInt(shadeHex(pal.wall, -0.20));
    var right = hexInt(shadeHex(pal.wall, -0.44));
    var line = hexInt(shadeHex(pal.wall, -0.72));
    var k = 0.5;
    var bN = iso(-k, -k), bE = iso(k, -k), bS = iso(k, k), bWt = iso(-k, k);
    // faces laterais
    g.beginFill(left, 1).lineStyle(1.4, line, 0.8);
    g.drawPolygon([bWt.x, bWt.y, bS.x, bS.y, bS.x, bS.y - hgt, bWt.x, bWt.y - hgt]);
    g.endFill();
    g.beginFill(right, 1);
    g.drawPolygon([bS.x, bS.y, bE.x, bE.y, bE.x, bE.y - hgt, bS.x, bS.y - hgt]);
    g.endFill();
    // topo
    g.beginFill(top, 1);
    g.drawPolygon([bN.x, bN.y - hgt, bE.x, bE.y - hgt, bS.x, bS.y - hgt, bWt.x, bWt.y - hgt]);
    g.endFill();
    // detalhe: fendas/veios temáticos
    g.lineStyle(1.2, line, 0.45);
    for (var i = 1; i <= 2; i++) {
      var yy = -hgt * (i / 3);
      g.moveTo(bWt.x, bWt.y + yy); g.lineTo(bS.x, bS.y + yy);
      g.moveTo(bS.x, bS.y + yy); g.lineTo(bE.x, bE.y + yy);
    }
    // aresta iluminada
    g.lineStyle(1.8, hexInt(shadeHex(pal.wall, 0.48)), 0.55);
    g.moveTo(bWt.x, bWt.y - hgt); g.lineTo(bN.x, bN.y - hgt); g.lineTo(bE.x, bE.y - hgt);
    c.addChild(g);
    return c;
  }

  // obstáculo BAIXO ('=' cobertura): baixo, topo TRANSLÚCIDO — bloqueia passagem,
  // não bloqueia visão. Silhueta claramente distinta do alto.
  function buildLow(theme, sc, pal, x, y) {
    var c = new P.Container();
    var art = artNode('obstacleLow', [theme, pick(sc.low, 'l' + x + '_' + y + theme)], 0.8);
    if (art) {
      c.addChild(art);
      // reforço de leitura: o baixo é COBERTURA. Um contorno claro no chão
      // separa-o do obstáculo alto mesmo quando a arte é parecida.
      var ring = new P.Graphics();
      ring.lineStyle(2, hexInt(shadeHex(pal.accent, 0.1)), 0.30);
      diamondLine(ring, 0, 0, 0.12, 0);
      ring.lineStyle(0);
      c.addChildAt(ring, 0);
      return c;
    }
    var g = new P.Graphics();
    var hgt = H_LOW;
    var base = mixHex(pal.wall, '#8fa0b8', 0.28);
    var top = hexInt(shadeHex(base, 0.30));
    var left = hexInt(shadeHex(base, -0.12));
    var right = hexInt(shadeHex(base, -0.36));
    var line = hexInt(shadeHex(base, -0.66));
    var k = 0.46;
    var bN = iso(-k, -k), bE = iso(k, -k), bS = iso(k, k), bWt = iso(-k, k);
    g.beginFill(left, 1).lineStyle(1.3, line, 0.85);
    g.drawPolygon([bWt.x, bWt.y, bS.x, bS.y, bS.x, bS.y - hgt, bWt.x, bWt.y - hgt]);
    g.endFill();
    g.beginFill(right, 1);
    g.drawPolygon([bS.x, bS.y, bE.x, bE.y, bE.x, bE.y - hgt, bS.x, bS.y - hgt]);
    g.endFill();
    // topo TRANSLÚCIDO (dá para ver o que está atrás — leitura de "cobertura")
    g.beginFill(top, 0.42);
    g.drawPolygon([bN.x, bN.y - hgt, bE.x, bE.y - hgt, bS.x, bS.y - hgt, bWt.x, bWt.y - hgt]);
    g.endFill();
    // grade no topo (reforça "vazado": dá para ver através)
    g.lineStyle(1.3, hexInt(shadeHex(base, 0.55)), 0.7);
    for (var i = -1; i <= 1; i++) {
      var a = iso(i * 0.22, -k), b = iso(i * 0.22, k);
      g.moveTo(a.x, a.y - hgt); g.lineTo(b.x, b.y - hgt);
      var a2 = iso(-k, i * 0.22), b2 = iso(k, i * 0.22);
      g.moveTo(a2.x, a2.y - hgt); g.lineTo(b2.x, b2.y - hgt);
    }
    // pontas/estacas nos cantos: nunca confundir com o obstáculo alto
    g.lineStyle(0);
    g.beginFill(hexInt(shadeHex(base, -0.25)), 0.95);
    var corners = [bN, bE, bS, bWt];
    for (var q = 0; q < 4; q++) {
      g.drawRect(corners[q].x - 2.6, corners[q].y - hgt - 5, 5.2, hgt + 6);
    }
    g.endFill();
    c.addChild(g);
    return c;
  }

  // ---------- unidades ----------
  function getVis(uid) {
    if (vis[uid]) return vis[uid];
    var u = findUnit(uid);
    if (!u) return null;
    return getVisFor(uid, u.x, u.y);
  }
  function getVisFor(uid, x, y) {
    if (!vis[uid]) {
      vis[uid] = {
        x: x, y: y, z: 0, face: 1, dir: 0, flash: 0, flashHold: 0,
        squash: 0, deathK: 0, popK: 1, hideK: 0, castK: 0, lungeK: 0,
        castTx: null, castTy: null, knockX: 0, knockY: 0,
        walkK: 0, walkPh: 0,           // ciclo de PERNAS (0..1 de mistura, fase)
        atkK: 0, atkMelee: 0, hitK: 0, // gesto de ataque e recuo de dano
        hp: -1, shield: -1, sig: '', bob: Math.random() * 6.28
      };
    }
    return vis[uid];
  }

  function makeUnitNode(u) {
    var c = new P.Container();
    var sh = new P.Sprite(texShadow());
    sh.anchor.set(0.5, 0.5);
    sh.width = TW * 0.62 * (u.boss ? 1.5 : (u.kind === 'pet' ? 0.7 : 1));
    sh.height = TH * 0.62 * (u.boss ? 1.5 : (u.kind === 'pet' ? 0.7 : 1));
    sh.__sx = sh.scale.x; sh.__sy = sh.scale.y;
    sh.alpha = 0.55;
    c.addChild(sh); c.__shadow = sh;

    var body = new P.Container();
    var cv = unitArtCanvas(u, 0);
    if (cv) {
      // ARTE ARTICULADA: pernas primeiro, tronco por cima (esconde a emenda)
      var legL = new P.Sprite(P.Texture.EMPTY);
      var legR = new P.Sprite(P.Texture.EMPTY);
      var torso = new P.Sprite(P.Texture.EMPTY);
      body.addChild(legL, legR, torso);
      c.__legL = legL; c.__legR = legR; c.__torso = torso;
      legL.__fl = addFlashChild(legL);
      legR.__fl = addFlashChild(legR);
      torso.__fl = addFlashChild(torso);
      c.__art = true; c.__artDir = 0;
      applyRig(c, cv);
      c.__height = artTop(cv);
      // criaturas sem pernas óbvias (pets, gosmas) balançam em vez de marchar
      c.__gait = (DATA().classes && DATA().classes[u.defId]) || String(u.defId).indexOf('fus:') === 0
        ? 'walk' : (u.kind === 'pet' ? 'hop' : 'waddle');
    } else {
      var tex = unitTexture(u);
      var sp = new P.Sprite(tex); sp.anchor.set(0.5, 1);
      body.addChild(sp);
      var fl = new P.Sprite(tex); fl.anchor.set(0.5, 1);
      fl.tint = 0xffffff; fl.blendMode = P.BLEND_MODES.ADD; fl.alpha = 0;
      body.addChild(fl);
      c.__flash = fl; c.__sprite = sp; c.__gait = 'waddle';
      c.__height = texCache['unit|' + u.defId + '|' + (u.boss ? 'b' : '') + (u.kind || '') + '|' + (u.element || '') + '|h'] || 76;
      // placeholder: duas perninhas desenhadas à parte, para haver PASSO
      var phl = placeholderLegs(u);
      body.addChildAt(phl.left, 0); body.addChildAt(phl.right, 0);
      c.__legL = phl.left; c.__legR = phl.right; c.__phLegs = true;
    }
    c.addChild(body); c.__body = body;

    var bars = new P.Graphics();
    c.addChild(bars); c.__bars = bars;
    var marks = new P.Container();
    c.addChild(marks); c.__marks = marks;
    c.__markKey = '';
    return c;
  }

  // pernas do placeholder (sem Art): dois retângulos com pé, girando no quadril
  function placeholderLegs(u) {
    var pal = paletteFor(u);
    var big = u.boss ? 1.42 : (u.kind === 'pet' ? 0.66 : 1);
    var bw = TW * 0.52 * big, bh = TW * 0.84 * big;
    var col = hexInt(shadeHex(pal.secondary, 0.05));
    var line = hexInt(shadeHex(pal.secondary, -0.55));
    function leg(sign) {
      var g = new P.Graphics();
      g.beginFill(col, 1).lineStyle(2, line, 1);
      g.drawRoundedRect(-bw * 0.10, 0, bw * 0.20, bh * 0.30, bw * 0.07);
      g.endFill();
      g.beginFill(line, 1).lineStyle(0);
      g.drawEllipse(sign * bw * 0.03, bh * 0.30, bw * 0.13, bh * 0.035);
      g.endFill();
      g.position.set(sign * bw * 0.16, -bh * 0.30);
      return g;
    }
    return { left: leg(-1), right: leg(1) };
  }

  function unitStatus(u) {
    var s = { poison: 0, invisible: 0, root: 0, taunt: 0, mark: 0, shieldFx: 0, reflect: 0, regen: 0 };
    var e = u.effects || [];
    for (var i = 0; i < e.length; i++) {
      var t = e[i] && e[i].type;
      if (t === 'poison') s.poison++;
      else if (t === 'invisible') s.invisible++;
      else if (t === 'root') s.root++;
      else if (t === 'taunt') s.taunt++;
      else if (t === 'mark') s.mark += (e[i].stacks || e[i].count || 1);
      else if (t === 'reflect') s.reflect++;
      else if (t === 'regen') s.regen++;
    }
    if (u.marks != null) s.mark = u.marks;
    return s;
  }

  // ANIMAÇÃO DO RIG — pernas alternadas no andar, plantadas no golpe.
  // `v.walkK` mistura o ciclo (0 parado, 1 andando); `v.walkPh` é a fase.
  function animateRig(c, v, t) {
    var L = c.__legL, R2 = c.__legR;
    if (!L || !R2) return;
    var gait = c.__gait || 'walk';
    var k = v.walkK || 0;
    var ph = v.walkPh || 0;
    var amp = gait === 'walk' ? 0.42 : (gait === 'hop' ? 0.16 : 0.26);
    var swing = Math.sin(ph) * amp * k;
    var lift = Math.abs(Math.cos(ph)) * (gait === 'walk' ? 3.2 : 1.6) * k;

    // gesto de ataque: a perna da frente planta e a de trás empurra
    var a = v.atkK || 0;
    var plant = a > 0 ? Math.sin(Math.min(1, a) * Math.PI) : 0;

    if (c.__phLegs) {
      // placeholder: as pernas são Graphics com pivô no quadril (position já lá)
      L.rotation = swing + plant * 0.30;
      R2.rotation = -swing - plant * 0.18;
    } else {
      L.rotation = swing + plant * 0.22;
      R2.rotation = -swing - plant * 0.14;
    }
    // o passo levanta o pé de trás: um leve deslocamento vertical alternado
    var base = c.__legBaseY;
    if (base == null) { base = c.__legBaseY = L.position.y; }
    L.position.y = base - Math.max(0, Math.sin(ph)) * lift;
    R2.position.y = base - Math.max(0, -Math.sin(ph)) * lift;
  }

  function updateUnitNode(u, v, st) {
    var c = unitNodes[u.uid];
    if (!c) { c = unitNodes[u.uid] = makeUnitNode(u); objectLayer.addChild(c); }
    var p = iso(v.x, v.y, v.z || 0);
    c.position.set(p.x + (v.knockX || 0), p.y + (v.knockY || 0));
    c.zIndex = Math.round((v.x + v.y) * 10) + 5;

    var stt = unitStatus(u);
    var alpha = 1;
    if (v.deathK > 0) alpha *= Math.max(0, 1 - v.deathK);
    if (v.hideK > 0) alpha *= Math.max(0, 1 - v.hideK);
    if (stt.invisible) alpha *= 0.30;                 // §4: invisível ~30%
    c.alpha = alpha;
    c.visible = alpha > 0.02;

    var body = c.__body;
    // direção: a arte tem 4 poses isométricas; o placeholder espelha em X
    if (c.__art && v.dir != null && v.dir !== c.__artDir) {
      var ncv = unitArtCanvas(u, v.dir);
      if (ncv) { applyRig(c, ncv); c.__artDir = v.dir; }
    }
    // idle: respiração + bob; morte: achata e afunda; invocação: pop
    var t = nowT * 1.7 + v.bob;
    var breathe = 1 + Math.sin(t) * 0.022;
    var sx = c.__art ? 1 : v.face, sy = 1;
    sx *= breathe * (1 - (v.squash > 0 ? Math.sin(v.squash * Math.PI) * -0.16 : 0));
    sy *= (1 / breathe);
    if (v.squash > 0) { var q = Math.sin(Math.min(v.squash, 1) * Math.PI); sx *= (1 + q * 0.17); sy *= (1 - q * 0.15); }
    if (v.popK < 1) { sx *= (0.45 + v.popK * 0.55); sy *= (1.55 - v.popK * 0.55); }
    if (v.deathK > 0) { sx *= (1 + v.deathK * 0.35); sy *= Math.max(0.04, 1 - v.deathK * 0.85); }
    if (v.lungeK > 0) { sy *= (1 - v.lungeK * 0.05); }

    // ---- CICLO DE PERNAS + GESTO DE ATAQUE (o que o jogador olha) ----
    animateRig(c, v, t);

    body.scale.set(sx, sy);
    body.position.y = Math.sin(t) * 2 - 2;
    body.rotation = Math.sin(t * 0.55) * 0.012 + (v.deathK > 0 ? v.deathK * 0.5 * v.face : 0);
    if (v.castK > 0) body.position.y -= v.castK * 7;
    // inclinação do tronco no ataque: recua, projeta, volta
    if (v.atkK) {
      var lean = (v.atkK < 0.5 ? -v.atkK * 0.9 : (v.atkK - 0.5) * 1.6) * 0.26;
      body.rotation += lean * (v.face || 1);
      body.position.y -= Math.abs(v.atkK - 0.5) * 3;
    }
    if (v.hitK > 0) body.rotation -= v.hitK * 0.22 * (v.face || 1);
    if (v.lungeK > 0 && v.castTx != null) {
      var tp = iso(v.castTx, v.castTy, 0), me = iso(v.x, v.y, 0);
      var dx = tp.x - me.x, dy = tp.y - me.y, l = Math.hypot(dx, dy) || 1;
      var reach = v.atkMelee ? 34 : 12;
      c.position.x += (dx / l) * v.lungeK * reach;
      c.position.y += (dy / l) * v.lungeK * reach;
    }
    var fa = Math.min(1, v.flash);
    if (c.__flash) c.__flash.alpha = fa;
    if (c.__torso) {
      if (c.__torso.__fl) c.__torso.__fl.alpha = fa;
      if (c.__legL && c.__legL.__fl) c.__legL.__fl.alpha = fa;
      if (c.__legR && c.__legR.__fl) c.__legR.__fl.alpha = fa;
    }
    if (c.__shadow) {
      // o contêiner já subiu z px; a sombra desce de volta para o chão
      c.__shadow.alpha = 0.5 * alpha * (1 - Math.min(0.7, (v.z || 0) / 50));
      c.__shadow.position.y = (v.z || 0);
      var shrink = 1 - Math.min(0.35, (v.z || 0) / 90);
      c.__shadow.scale.set(c.__shadow.__sx * shrink, c.__shadow.__sy * shrink);
    }

    // barra de vida + escudo + marcadores (só redesenha quando muda)
    var hgt = c.__height || 76;
    var sig = u.hp + '/' + u.hpMax + '|' + (u.shield || 0) + '|' + stt.poison + stt.root + stt.taunt + stt.reflect + stt.regen + '|' + stt.mark + '|' + (v.deathK > 0 ? 1 : 0);
    if (sig !== c.__sig) {
      c.__sig = sig;
      var g = c.__bars;
      g.clear();
      if (v.deathK <= 0 && (u.hp < u.hpMax || (u.shield || 0) > 0)) {
        var bw = (u.boss ? 76 : 48), by = -hgt - 14;
        var hk = clamp(u.hp / Math.max(1, u.hpMax), 0, 1);
        g.beginFill(0x0a0810, 0.78).drawRoundedRect(-bw / 2 - 2, by - 2, bw + 4, 11, 4).endFill();
        g.beginFill(hk > 0.5 ? 0x7ac26a : hk > 0.25 ? 0xe0b04a : 0xe05a3c, 1)
          .drawRoundedRect(-bw / 2, by, bw * hk, 7, 3).endFill();
        if ((u.shield || 0) > 0) {
          var sk = clamp(u.shield / Math.max(1, u.hpMax), 0, 1);
          g.beginFill(0x8ad4f0, 0.95).drawRoundedRect(-bw / 2, by - 6, bw * sk, 4, 2).endFill();
        }
      }
      buildMarks(c, u, stt, hgt);
    }
    // pulso dos marcadores
    if (c.__marks.children.length) {
      c.__marks.position.y = Math.sin(nowT * 3.4 + v.bob) * 1.4;
    }
  }

  function buildMarks(c, u, stt, hgt) {
    var key = stt.poison + '|' + stt.root + '|' + stt.taunt + '|' + stt.mark + '|' + stt.reflect + '|' + stt.regen + '|' + stt.invisible;
    if (key === c.__markKey) return;
    c.__markKey = key;
    var box = c.__marks;
    for (var i = box.children.length - 1; i >= 0; i--) box.children[i].destroy({ children: true });
    box.removeChildren();
    var icons = [];
    if (stt.poison) icons.push({ c: 0x6fd06a, s: 'drop' });
    if (stt.root) icons.push({ c: 0xb08048, s: 'ring' });
    if (stt.taunt) icons.push({ c: 0xff6a4a, s: 'bang' });
    if (stt.reflect) icons.push({ c: 0x8ad4f0, s: 'shield' });
    if (stt.regen) icons.push({ c: 0x9ce8a0, s: 'cross' });
    if (stt.invisible) icons.push({ c: 0xc0b8ff, s: 'eye' });
    if (stt.mark > 0) icons.push({ c: 0xff9ad0, s: 'mark', n: stt.mark });
    if (!icons.length) return;
    var wTot = icons.length * 19;
    for (var k = 0; k < icons.length; k++) {
      var ic = icons[k];
      var g = new P.Graphics();
      var x = -wTot / 2 + 9.5 + k * 19, y = -hgt - 31;
      g.beginFill(0x120e16, 0.72).drawCircle(x, y, 8.6).endFill();
      g.lineStyle(1.7, ic.c, 1);
      g.beginFill(ic.c, 0.35);
      if (ic.s === 'drop') { g.moveTo(x, y - 5.2); g.lineTo(x + 3.9, y + 1.3); g.lineTo(x, y + 5.2); g.lineTo(x - 3.9, y + 1.3); g.closePath(); }
      else if (ic.s === 'ring') { g.drawCircle(x, y, 4.7); }
      else if (ic.s === 'bang') { g.drawRect(x - 1.6, y - 5.5, 3.1, 6.5); g.drawRect(x - 1.6, y + 2.6, 3.1, 2.9); }
      else if (ic.s === 'shield') { g.moveTo(x, y - 5.7); g.lineTo(x + 4.4, y - 2.1); g.lineTo(x, y + 5.7); g.lineTo(x - 4.4, y - 2.1); g.closePath(); }
      else if (ic.s === 'cross') { g.drawRect(x - 1.7, y - 5.2, 3.4, 10.4); g.drawRect(x - 5.2, y - 1.7, 10.4, 3.4); }
      else if (ic.s === 'eye') { g.drawEllipse(x, y, 5.7, 3.4); }
      else { g.moveTo(x, y - 5.7); g.lineTo(x + 5.2, y); g.lineTo(x, y + 5.7); g.lineTo(x - 5.2, y); g.closePath(); }
      g.endFill();
      box.addChild(g);
      if (ic.s === 'mark' && ic.n > 1) {
        var tx = new P.Text('' + ic.n, { fontFamily: 'Verdana, Arial, sans-serif', fontSize: 12, fontWeight: '700', fill: 0xffffff, stroke: 0x2a1020, strokeThickness: 3 });
        tx.anchor.set(0.5); tx.position.set(x + 8, y + 6);
        tx.resolution = Math.min(2, DPR);
        box.addChild(tx);
      }
    }
  }

  function syncUnits(st) {
    var seen = {};
    for (var i = 0; i < st.units.length; i++) {
      var u = st.units[i];
      seen[u.uid] = 1;
      var v = vis[u.uid];
      if (!v) { v = getVisFor(u.uid, u.x, u.y); initFacing(st, u, v); }
      else if (!animatingUid(u.uid)) {
        if (Math.abs(v.x - u.x) > 0.001 || Math.abs(v.y - u.y) > 0.001) {
          v.x += (u.x - v.x) * 0.35; v.y += (u.y - v.y) * 0.35;
          if (Math.abs(v.x - u.x) < 0.02 && Math.abs(v.y - u.y) < 0.02) { v.x = u.x; v.y = u.y; }
        }
        if (!animQ.length) v.z = 0;
      }
      if (!u.alive && (!v.deathK || v.deathK >= 1)) {
        var dead = unitNodes[u.uid];
        if (dead) { dead.visible = false; }
        continue;
      }
      updateUnitNode(u, v, st);
    }
    // limpa nós de unidades que saíram do estado (ex.: fundida absorvida)
    for (var uid in unitNodes) {
      if (!seen[uid]) {
        var n = unitNodes[uid];
        if (n.parent) n.parent.removeChild(n);
        n.destroy({ children: true });
        delete unitNodes[uid];
      }
    }
  }
  function initFacing(st, u, v) {
    var best = null, bd = 1e9;
    for (var i = 0; i < st.units.length; i++) {
      var o = st.units[i];
      if (o.side === u.side || !o.alive) continue;
      var d = Math.abs(o.x - u.x) + Math.abs(o.y - u.y);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) faceUnit(v, u.x, u.y, best.x, best.y);
  }
  function faceTo(fx, fy, tx, ty) {
    var a = iso(fx, fy, 0), b = iso(tx, ty, 0);
    return (b.x < a.x - 0.5) ? -1 : 1;
  }
  // define espelhamento (placeholder) E pose isométrica (arte) de uma vez
  function faceUnit(v, fx, fy, tx, ty) {
    if (!v) return;
    v.face = faceTo(fx, fy, tx, ty);
    v.dir = isoDir(tx - fx, ty - fy);
  }
  function animatingUid(uid) {
    for (var i = 0; i < animQ.length; i++) if (animQ[i].uid === uid) return true;
    return false;
  }

  // ---------- overlays táticos ----------
  var ovBase = null, ovAoe = null, ovActive = null, ovEventsBox = null;
  function ensureOverlayNodes() {
    if (ovBase) return;
    ovBase = new P.Graphics();
    ovAoe = new P.Graphics();
    ovActive = new P.Graphics();
    ovEventsBox = new P.Container();
    overlayLayer.addChild(ovBase, ovAoe, ovEventsBox, ovActive);
  }
  function safe(fn, dflt) { try { var r = fn(); return r == null ? dflt : r; } catch (e) { return dflt; } }

  function overlaySignature(st) {
    var g = game(), en = engine();
    var active = safe(function () { return en && en.activeUnit ? en.activeUnit(st) : null; }, null);
    var hv = g && g.hoverTile;
    var evs = st.tileEventsActive || st.tileEvents || [];
    var pos = '';
    for (var i = 0; i < st.units.length; i++) pos += st.units[i].x + ',' + st.units[i].y + (st.units[i].alive ? '' : 'x') + ';';
    return [st.phase, st.round, active ? active.uid : '-', g && g.selectedSpellId,
      hv ? hv.x + ':' + hv.y : '-', evs.length, R.isBusy() ? 1 : 0, pos,
      g && g.isPlayerTurn ? (g.isPlayerTurn() ? 1 : 0) : 1].join('|');
  }

  function fillTile(g, x, y, col, alpha, inset) {
    g.beginFill(hexInt(col), alpha);
    diamond(g, x, y, inset == null ? 0.06 : inset, 1);
    g.endFill();
  }
  function strokeTile(g, x, y, col, alpha, lw, inset) {
    g.lineStyle(lw || 1.6, hexInt(col), alpha);
    diamondLine(g, x, y, inset == null ? 0.06 : inset, 1);
    g.lineStyle(0);
  }

  // eventos de terreno: contêiner PRÓPRIO, reconstruído só quando a lista muda
  // (não a cada hover) — PIXI.Text é caro de criar.
  var evSig = '';
  function rebuildTileEvents(st) {
    var evs = st.tileEventsActive || st.tileEvents || [];
    var sig = '';
    for (var i = 0; i < evs.length; i++) sig += evs[i].x + ',' + evs[i].y + ':' + (evs[i].eventId || evs[i].id) + ';';
    if (sig === evSig) return;
    evSig = sig;
    for (var q = ovEventNodes.length - 1; q >= 0; q--) ovEventNodes[q].destroy({ children: true });
    ovEventNodes.length = 0;
    ovEventsBox.removeChildren();
    var D = DATA();
    for (var e = 0; e < evs.length; e++) {
      var ev = evs[e];
      if (!ev || ev.x == null) continue;
      var defEv = (D.tileEvents && D.tileEvents[ev.eventId || ev.id]) || {};
      var node = buildTileEventNode(ev, defEv);
      var p = iso(ev.x, ev.y, 1);
      node.position.set(p.x, p.y);
      ovEventsBox.addChild(node);
      ovEventNodes.push(node);
    }
  }

  var ppLabel = null;
  function rebuildOverlays(st) {
    ensureOverlayNodes();
    var g = game(), en = engine();
    ovBase.clear(); ovAoe.clear();
    ovPulse = null;
    if (ppLabel) ppLabel.visible = false;
    rebuildTileEvents(st);
    var D = DATA();

    if (!st || st.phase !== 'playing') return;
    var active = safe(function () { return en && en.activeUnit ? en.activeUnit(st) : null; }, null);
    if (!active) return;

    // 2) zona do pet (sempre útil de ver)
    for (var pu = 0; pu < st.units.length; pu++) {
      var pet = st.units[pu];
      if (pet.kind !== 'pet' || !pet.alive) continue;
      var ownerUid = pet.ownerUid || pet.owner || pet.summonerUid;
      var owner = ownerUid ? findUnit(ownerUid) : null;
      if (!owner) continue;
      var pd = (D.pets && D.pets[pet.defId] && D.pets[pet.defId].followDistance) || pet.followDistance || 2;
      ovBase.lineStyle(1.4, 0x9be0ff, 0.30);
      for (var a = 0; a <= 32; a++) {
        var ang = a / 32 * Math.PI * 2;
        var pp = iso(owner.x + Math.cos(ang) * (pd + 0.4), owner.y + Math.sin(ang) * (pd + 0.4), 1);
        if (a === 0) ovBase.moveTo(pp.x, pp.y); else ovBase.lineTo(pp.x, pp.y);
      }
      ovBase.lineStyle(0);
    }

    var playerTurn = g && g.isPlayerTurn ? g.isPlayerTurn() : true;
    if (!playerTurn || R.isBusy()) return;   // o anel da unidade ativa é por frame

    var spellId = g && g.selectedSpellId;
    var hv = g && g.hoverTile;

    if (!spellId) {
      // 3) alcance de movimento (risco de esquiva em cor de alerta)
      var reach = safe(function () { return en.reachable ? en.reachable(st, active.uid) : null; }, null);
      if (reach) {
        for (var i = 0; i < reach.length; i++) {
          var t = reach[i];
          var risky = !!(t.risky || t.risk || t.dodgeRisk || t.locked);
          fillTile(ovBase, t.x, t.y, risky ? '#ff8a24' : '#28c8ff', risky ? 0.46 : 0.40);
          strokeTile(ovBase, t.x, t.y, risky ? '#ffd07a' : '#dcf6ff', risky ? 0.95 : 0.80, 2.2);
          if (risky) {
            // triângulo de alerta: sair daqui pode falhar a esquiva
            var pc = iso(t.x, t.y, 1);
            ovBase.beginFill(0xffc06a, 0.85);
            ovBase.moveTo(pc.x, pc.y - 10); ovBase.lineTo(pc.x + 7.5, pc.y + 3); ovBase.lineTo(pc.x - 7.5, pc.y + 3);
            ovBase.closePath(); ovBase.endFill();
          }
        }
      }
      // 4) preview de caminho
      if (hv && hv.x >= 0) {
        var path = safe(function () { return en.path ? en.path(st, active.uid, hv.x, hv.y) : null; }, null);
        if (path && path.length) {
          for (var j = 0; j < path.length; j++) {
            fillTile(ovBase, path[j].x, path[j].y, '#ffffff', 0.52, 0.14);
            var pp2 = iso(path[j].x, path[j].y, 3);
            ovBase.beginFill(0xfff6d0, j === path.length - 1 ? 0.98 : 0.8);
            ovBase.drawCircle(pp2.x, pp2.y, j === path.length - 1 ? 8 : 4.4);
            ovBase.endFill();
          }
          // custo em passos (PP) no fim do caminho
          var pend = iso(path[path.length - 1].x, path[path.length - 1].y, 28);
          ovBase.beginFill(0x0e1218, 0.78);
          ovBase.drawRoundedRect(pend.x - 19, pend.y - 13, 38, 25, 8);
          ovBase.endFill();
          if (!ppLabel) {
            ppLabel = new P.Text('', {
              fontFamily: 'Trebuchet MS, Verdana, sans-serif', fontSize: 15, fontWeight: '700',
              fill: 0xfff2c8, stroke: 0x14100c, strokeThickness: 3
            });
            ppLabel.anchor.set(0.5);
            ppLabel.resolution = Math.min(2, DPR);
            overlayLayer.addChild(ppLabel);
          }
          ppLabel.text = path.length + ' PP';
          ppLabel.position.set(pend.x, pend.y - 1);
          ppLabel.visible = true;
        }
      }
    } else {
      // 5) alvos válidos + área do feitiço
      var spell = (D.spells && D.spells[spellId]) ||
        (JOGO.Fusion && JOGO.Fusion.spellById && safe(function () { return JOGO.Fusion.spellById(spellId); }, null)) ||
        (g && g.selectedSpell) || null;
      var elCol = R.elementColor(spell && spell.element ? spell.element : 'neutro');
      var targets = safe(function () { return en.castTargets ? en.castTargets(st, active.uid, spellId) : null; }, null);
      var inTargets = false;
      if (targets) {
        for (var k = 0; k < targets.length; k++) {
          fillTile(ovBase, targets[k].x, targets[k].y, elCol, 0.28);
          strokeTile(ovBase, targets[k].x, targets[k].y, elCol, 0.80, 2);
          if (hv && targets[k].x === hv.x && targets[k].y === hv.y) inTargets = true;
        }
      }
      if (hv && inTargets) {
        var aoe = safe(function () { return en.aoeTiles ? en.aoeTiles(st, spellId, active.x, active.y, hv.x, hv.y) : null; }, null);
        if (aoe && aoe.length) {
          for (var m = 0; m < aoe.length; m++) {
            fillTile(ovAoe, aoe[m].x, aoe[m].y, '#ff5a28', 0.52, 0.04);
            strokeTile(ovAoe, aoe[m].x, aoe[m].y, '#ffe0c0', 0.95, 3, 0.04);
          }
          ovPulse = { kind: 'aoe' };
        }
      }
    }
  }

  // desenhado a CADA frame: acompanha a unidade enquanto ela anda
  function drawActiveRing(active) {
    if (!ovActive) return;
    ovActive.clear();
    if (!active) return;
    var v = vis[active.uid] || { x: active.x, y: active.y };
    var col = active.side === 'player' ? 0xffd98a : 0xff6a4a;
    ovActive.lineStyle(2.6, col, 0.9);
    for (var a = 0; a <= 28; a++) {
      var ang = a / 28 * Math.PI * 2;
      var p = iso(v.x + Math.cos(ang) * 0.46, v.y + Math.sin(ang) * 0.46, 1);
      if (a === 0) ovActive.moveTo(p.x, p.y); else ovActive.lineTo(p.x, p.y);
    }
    ovActive.lineStyle(0);
    var g = game();
    var hv = g && g.hoverTile;
    var st = state();
    if (hv && hv.x >= 0 && st && st.grid && hv.x < st.grid.w && hv.y < st.grid.h) {
      strokeTile(ovActive, hv.x, hv.y, '#ffffff', 0.55, 2);
    }
  }

  function buildTileEventNode(ev, def) {
    var kind = def.kind || 'mystery';
    var colors = { buff: '#ffd76b', mystery: '#b98cff', portal: '#58b6f0', drain: '#e0556a', fountain: '#7ef0d4' };
    var col = hexInt(colors[kind] || '#ffd76b');
    var c = new P.Container();
    var glow = new P.Sprite(texDot());
    glow.anchor.set(0.5); glow.width = TW * 0.95; glow.height = TH * 1.5;
    glow.tint = col; glow.alpha = 0.32; glow.blendMode = P.BLEND_MODES.ADD;
    c.addChild(glow); c.__glow = glow;
    var g = new P.Graphics();
    var k = 0.42;
    var a = iso(-k, -k), b = iso(k, -k), d = iso(k, k), e = iso(-k, k);
    g.beginFill(col, 0.26);
    g.drawPolygon([a.x, a.y, b.x, b.y, d.x, d.y, e.x, e.y]);
    g.endFill();
    g.lineStyle(2.4, col, 0.95);
    g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(d.x, d.y); g.lineTo(e.x, e.y); g.closePath();
    g.lineStyle(0);
    // pedestal escuro atrás do ícone (legibilidade em qualquer chão)
    g.beginFill(0x0d1016, 0.65); g.drawRoundedRect(-19, -46, 38, 38, 11); g.endFill();
    g.lineStyle(1.8, col, 0.8); g.drawRoundedRect(-19, -46, 38, 38, 11); g.lineStyle(0);
    c.addChild(g);
    // ícone: preferimos a arte (Art.tileEventIcon); sem ela, um glifo de texto
    var artIcon = artNode('tileEventIcon', [kind, 48], 0.5);
    if (artIcon) {
      artIcon.position.set(0, -27);
      artIcon.__y0 = -27;
      c.addChild(artIcon); c.__icon = artIcon;
      return c;
    }
    var icon = def.icon || ({ buff: '⚡', mystery: '?', portal: '@', drain: '×', fountain: '+' }[kind]);
    var tx = new P.Text(String(icon), {
      fontFamily: 'Segoe UI Emoji, Verdana, Arial, sans-serif', fontSize: 20,
      fontWeight: '700', fill: 0xffffff, stroke: 0x16101c, strokeThickness: 3
    });
    tx.anchor.set(0.5, 0.5); tx.position.set(0, -27);
    tx.__y0 = -27;
    tx.resolution = Math.min(2, DPR);
    c.addChild(tx); c.__icon = tx;
    return c;
  }

  // ---------- CLIMA ----------
  var weather = {
    id: 'calmo', prev: null, k: 1, drops: [], motes: [], gfx: null, tint: null,
    puddles: null, heat: null, box: null, shakeT: 0
  };
  function setWeather(id, instant) {
    if (!id) id = 'calmo';
    if (weather.id === id && weather.k >= 1) return;
    weather.prev = weather.id;
    weather.id = id;
    weather.k = instant ? 1 : 0;
    buildWeather();
  }
  R.setWeather = setWeather;

  function weatherPalette(id) {
    var D = DATA();
    var def = D.weathers && D.weathers[id];
    var p = (def && def.palette) || {};
    var base = {
      calmo: { tint: '#ffffff', tintA: 0.0, fog: '#0a0d10' },
      chuva: { tint: '#5a86b4', tintA: 0.34, fog: '#0a1420' },
      estiagem: { tint: '#ffb14a', tintA: 0.26, fog: '#2a1a08' },
      vendaval: { tint: '#9fd0c0', tintA: 0.18, fog: '#101a18' },
      tremor: { tint: '#b08a58', tintA: 0.26, fog: '#181208' }
    }[id] || { tint: '#ffffff', tintA: 0, fog: '#0a0d10' };
    return {
      tint: p.tint || p.sky || p.primary || base.tint,
      tintA: p.tintAlpha != null ? p.tintAlpha : base.tintA,
      fog: p.fog || base.fog,
      accent: p.accent || base.tint
    };
  }

  function buildWeather() {
    if (!weatherLayer) return;
    weatherLayer.removeChildren();
    weather.drops = []; weather.motes = [];
    if (weather.ground) { weather.ground.destroy({ children: true }); weather.ground = null; }
    weather.puddleG = null;
    var id = weather.id;
    var box = new P.Container();
    weatherLayer.addChild(box);
    weather.box = box;
    var pal = weatherPalette(id);
    buildWeatherGround(id);

    if (id === 'chuva') {
      var pc = new P.Container();
      box.addChild(pc);
      var dropTex = canvasTex('rain', 4, 26, function (c, w, h) {
        var g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, 'rgba(190,225,255,0)');
        g.addColorStop(0.4, 'rgba(200,232,255,0.85)');
        g.addColorStop(1, 'rgba(255,255,255,0.95)');
        c.fillStyle = g; c.fillRect(1, 0, 2, h);
      });
      for (var i = 0; i < 190; i++) {
        var s = new P.Sprite(dropTex);
        s.anchor.set(0.5, 1);
        s.alpha = 0.25 + Math.random() * 0.45;
        s.scale.set(0.6 + Math.random() * 0.9, 0.7 + Math.random() * 1.5);
        s.x = Math.random() * W; s.y = Math.random() * H;
        s.rotation = 0.16;
        pc.addChild(s);
        weather.drops.push({ s: s, v: 780 + Math.random() * 620, wind: 130 });
      }
      // névoa fria
      var fog = new P.Graphics();
      fog.beginFill(hexInt('#6fa8d8'), 0.06).drawRect(0, 0, W, H).endFill();
      box.addChild(fog);
    } else if (id === 'estiagem') {
      // calor ondulando: faixas horizontais que deslizam + luz âmbar
      var heat = new P.Container();
      box.addChild(heat);
      weather.heat = [];
      for (var b = 0; b < 20; b++) {
        var bar = new P.Graphics();
        bar.beginFill(0xffd08a, 0.09).drawRect(0, 0, W * 1.4, 12 + Math.random() * 22).endFill();
        bar.blendMode = P.BLEND_MODES.ADD;
        bar.y = (b / 20) * H;
        bar.x = -W * 0.2;
        heat.addChild(bar);
        weather.heat.push({ g: bar, ph: Math.random() * 6.28, amp: 16 + Math.random() * 34, sp: 0.5 + Math.random() * 0.9 });
      }
      var sun = new P.Sprite(texDot());
      sun.anchor.set(0.5); sun.position.set(W * 0.74, H * 0.12);
      sun.width = W * 0.9; sun.height = H * 0.8;
      sun.tint = 0xffc264; sun.alpha = 0.32; sun.blendMode = P.BLEND_MODES.ADD;
      box.addChild(sun);
      var dustC = new P.Container(); box.addChild(dustC);
      for (var d2 = 0; d2 < 46; d2++) {
        var m = new P.Sprite(texHard());
        m.anchor.set(0.5); m.width = m.height = 2 + Math.random() * 4;
        m.tint = 0xffd9a0; m.alpha = 0.18 + Math.random() * 0.3;
        m.x = Math.random() * W; m.y = Math.random() * H;
        m.blendMode = P.BLEND_MODES.ADD;
        dustC.addChild(m);
        weather.motes.push({ s: m, vx: -8 + Math.random() * 16, vy: -6 - Math.random() * 14, ph: Math.random() * 6.28 });
      }
    } else if (id === 'vendaval') {
      var gustC = new P.Container(); box.addChild(gustC);
      var gustTex = canvasTex('gust', 96, 10, function (c, w, h) {
        var g = c.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, 'rgba(230,245,255,0.85)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(0, h / 2 - 1.5, w, 3);
      });
      for (var gi = 0; gi < 34; gi++) {
        var gs = new P.Sprite(gustTex);
        gs.anchor.set(0.5); gs.alpha = 0.14 + Math.random() * 0.3;
        gs.scale.set(0.7 + Math.random() * 2.2, 0.6 + Math.random() * 1.2);
        gs.x = Math.random() * W; gs.y = Math.random() * H;
        gs.blendMode = P.BLEND_MODES.ADD;
        gustC.addChild(gs);
        weather.motes.push({ s: gs, vx: 420 + Math.random() * 520, vy: -12 + Math.random() * 24, ph: Math.random() * 6.28, wave: 12 + Math.random() * 22, kind: 'gust' });
      }
      // folhas e poeira
      var leafTex = canvasTex('leaf', 20, 14, function (c, w, h) {
        c.fillStyle = '#9dc46a';
        c.beginPath(); c.ellipse(w / 2, h / 2, w * 0.42, h * 0.34, 0.5, 0, 6.2832); c.fill();
        c.strokeStyle = 'rgba(60,80,30,0.8)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(2, h - 2); c.lineTo(w - 2, 2); c.stroke();
      });
      for (var li = 0; li < 26; li++) {
        var ls = new P.Sprite(leafTex);
        ls.anchor.set(0.5);
        ls.alpha = 0.55 + Math.random() * 0.4;
        ls.scale.set(0.5 + Math.random() * 0.8);
        ls.tint = [0x9dc46a, 0xc9a24a, 0xa8b0a0][li % 3];
        ls.x = Math.random() * W; ls.y = Math.random() * H;
        gustC.addChild(ls);
        weather.motes.push({ s: ls, vx: 300 + Math.random() * 420, vy: -20 + Math.random() * 40, ph: Math.random() * 6.28, wave: 26 + Math.random() * 40, spin: (Math.random() - 0.5) * 9, kind: 'leaf' });
      }
    } else if (id === 'tremor') {
      var dustC2 = new P.Container(); box.addChild(dustC2);
      for (var q2 = 0; q2 < 70; q2++) {
        var ds = new P.Sprite(texHard());
        ds.anchor.set(0.5);
        ds.width = ds.height = 1.6 + Math.random() * 3.4;
        ds.tint = 0xd8bE90; ds.alpha = 0.2 + Math.random() * 0.42;
        ds.x = Math.random() * W; ds.y = Math.random() * H;
        dustC2.addChild(ds);
        weather.motes.push({ s: ds, vx: -10 + Math.random() * 20, vy: 34 + Math.random() * 90, ph: Math.random() * 6.28, kind: 'fall' });
      }
      var haze = new P.Graphics();
      haze.beginFill(hexInt('#c8a066'), 0.07).drawRect(0, 0, W, H).endFill();
      box.addChild(haze);
    }
    // tinta geral
    if (weatherTint) {
      weatherTint.tint = hexInt(pal.tint);
      weatherTint.__targetA = pal.tintA;
      weatherTint.blendMode = (id === 'estiagem') ? P.BLEND_MODES.ADD : P.BLEND_MODES.MULTIPLY;
      if (id === 'estiagem') weatherTint.__targetA = pal.tintA * 0.55;
    }
    box.alpha = 0;
  }

  // efeitos do clima assentados no CHÃO (espaço de mundo, sob as unidades)
  function buildWeatherGround(id) {
    var st = state();
    if (!st || !st.grid || !decalLayer) return;
    var c = new P.Container();
    decalLayer.addChildAt(c, 0);
    weather.ground = c;
    var rnd = srand(hashStr('wg' + id + st.grid.w + st.grid.h));
    var i, x, y, k, p, g;
    if (id === 'chuva') {
      g = new P.Graphics();
      for (i = 0; i < 26; i++) {
        x = Math.floor(rnd() * st.grid.w); y = Math.floor(rnd() * st.grid.h);
        if (tileKind(gridTile(st, x, y)) !== 'floor' && tileKind(gridTile(st, x, y)) !== 'deco') continue;
        p = iso(x + (rnd() - 0.5) * 0.4, y + (rnd() - 0.5) * 0.4, 0);
        var rw = 12 + rnd() * 16;
        g.beginFill(0x8fd0f0, 0.16).drawEllipse(p.x, p.y, rw, rw * 0.44).endFill();
        g.lineStyle(1.2, 0xbfeaff, 0.22).drawEllipse(p.x, p.y, rw * 0.72, rw * 0.32);
        g.lineStyle(0);
      }
      c.addChild(g);
      weather.puddleG = g;
    } else if (id === 'estiagem') {
      g = new P.Graphics();
      for (i = 0; i < 30; i++) {
        x = Math.floor(rnd() * st.grid.w); y = Math.floor(rnd() * st.grid.h);
        p = iso(x + (rnd() - 0.5) * 0.5, y + (rnd() - 0.5) * 0.5, 0);
        g.lineStyle(1.4, 0x6a3a12, 0.28);
        var ax = p.x, ay = p.y;
        for (k = 0; k < 3; k++) {
          var nx = ax + (rnd() - 0.5) * 26, ny = ay + (rnd() - 0.5) * 12;
          g.moveTo(ax, ay); g.lineTo(nx, ny); ax = nx; ay = ny;
        }
      }
      g.lineStyle(0);
      c.addChild(g);
    } else if (id === 'vendaval') {
      // riscos de vento varrendo o chão, na diagonal do tabuleiro
      g = new P.Graphics();
      for (i = 0; i < 22; i++) {
        x = rnd() * st.grid.w; y = rnd() * st.grid.h;
        var s0 = iso(x, y, 0), s1 = iso(x + 1.2 + rnd(), y - 0.5 - rnd() * 0.6, 0);
        g.lineStyle(1.6, 0xdfeaff, 0.10 + rnd() * 0.10);
        g.moveTo(s0.x, s0.y);
        g.quadraticCurveTo((s0.x + s1.x) / 2, (s0.y + s1.y) / 2 - 8, s1.x, s1.y);
      }
      g.lineStyle(0);
      c.addChild(g);
    } else if (id === 'tremor') {
      g = new P.Graphics();
      for (i = 0; i < 18; i++) {
        x = Math.floor(rnd() * st.grid.w); y = Math.floor(rnd() * st.grid.h);
        p = iso(x, y, 0);
        g.beginFill(0xc8a066, 0.14).drawEllipse(p.x, p.y, 16 + rnd() * 14, 8 + rnd() * 6).endFill();
      }
      // rachaduras longas: o chão está partindo
      g.lineStyle(2.2, 0x1a1208, 0.32);
      for (i = 0; i < 5; i++) {
        x = rnd() * st.grid.w; y = rnd() * st.grid.h;
        var cx0 = iso(x, y, 0);
        g.moveTo(cx0.x, cx0.y);
        for (k = 0; k < 4; k++) {
          x += (rnd() - 0.5) * 2.4; y += (rnd() - 0.5) * 2.4;
          var cn = iso(x, y, 0);
          g.lineTo(cn.x, cn.y);
        }
      }
      g.lineStyle(0);
      c.addChild(g);
    }
  }

  function updateWeather(dt) {
    if (weather.puddleG) weather.puddleG.alpha = 0.75 + Math.sin(nowT * 2.2) * 0.25;
    if (!weather.box) return;
    weather.k = Math.min(1, weather.k + dt / 0.9);
    weather.box.alpha = weather.k;
    if (weatherTint) {
      var target = (weatherTint.__targetA || 0) * weather.k;
      weatherTint.alpha += (target - weatherTint.alpha) * Math.min(1, dt * 4);
    }
    var i, m;
    if (weather.id === 'chuva') {
      for (i = 0; i < weather.drops.length; i++) {
        var d = weather.drops[i];
        d.s.y += d.v * dt; d.s.x += d.wind * dt;
        if (d.s.y > H + 20) { d.s.y = -30 - Math.random() * 60; d.s.x = Math.random() * W - 60; }
        if (d.s.x > W + 40) d.s.x = -20;
      }
    } else if (weather.id === 'estiagem') {
      for (i = 0; weather.heat && i < weather.heat.length; i++) {
        var hb = weather.heat[i];
        hb.g.x = -W * 0.2 + Math.sin(nowT * hb.sp + hb.ph) * hb.amp;
        hb.g.alpha = 0.06 + (0.5 + Math.sin(nowT * hb.sp * 1.7 + hb.ph) * 0.5) * 0.10;
      }
    }
    for (i = 0; i < weather.motes.length; i++) {
      m = weather.motes[i];
      if (m.kind === 'gust' || m.kind === 'leaf') {
        m.s.x += m.vx * dt;
        m.s.y += m.vy * dt + Math.sin(nowT * 3 + m.ph) * (m.wave || 0) * dt;
        if (m.spin) m.s.rotation += m.spin * dt;
        if (m.s.x > W + 80) { m.s.x = -80; m.s.y = Math.random() * H; }
      } else if (m.kind === 'fall') {
        m.s.y += m.vy * dt;
        m.s.x += Math.sin(nowT * 2 + m.ph) * 8 * dt;
        if (m.s.y > H + 10) { m.s.y = -10; m.s.x = Math.random() * W; }
      } else {
        m.s.x += m.vx * dt + Math.sin(nowT * 1.3 + m.ph) * 6 * dt;
        m.s.y += m.vy * dt;
        if (m.s.y < -10) { m.s.y = H + 10; m.s.x = Math.random() * W; }
      }
    }
    // tremor: tremida sutil da câmera
    if (weather.id === 'tremor') {
      weather.shakeT += dt;
      var amp = 1.5 + Math.sin(weather.shakeT * 0.7) * 1.0;
      weather.qx = Math.sin(weather.shakeT * 23.0) * amp;
      weather.qy = Math.cos(weather.shakeT * 19.3) * amp * 0.6;
    } else { weather.qx = 0; weather.qy = 0; }
  }

  // corpo a corpo? define se o conjurador AVANÇA até o alvo ou só arma o gesto
  function isMelee(ev, u) {
    var D = DATA();
    var sp = (D.spells && D.spells[ev.spellId]) || ev.spell || null;
    var fk = (sp && sp.fxKey) || ev.fxKey;
    if (fk === 'melee' || fk === 'slam') return true;
    if (fk === 'bolt' || fk === 'arrow' || fk === 'chain' || fk === 'beam' ||
        fk === 'nova' || fk === 'heal' || fk === 'gust') return false;
    if (sp && sp.range && sp.range.max != null) return sp.range.max <= 1;
    if (u && ev.x != null) return (Math.abs(u.x - ev.x) + Math.abs(u.y - ev.y)) <= 1;
    return false;
  }

  // ---------- eventos do contrato ----------
  R.handleEvent = function (ev) {
    if (!ev) return;
    if (!ready) { if (pendingEvents.length < 400) pendingEvents.push(ev); return; }
    var v, u;
    switch (ev.type) {
      case 'battleStart':
        resetAll(ev.state || state());
        break;

      case 'turnStart':
        ovSig = '';
        nudgeTo(ev.uid);          // quem vai jogar precisa estar na tela
        break;

      case 'move':
        if (ev.path && ev.path.length) {
          animQ.push({ kind: 'move', uid: ev.uid, path: ev.path.slice(), k: 0, seg: 0, age: 0 });
        }
        break;

      case 'cast':
        u = findUnit(ev.uid);
        var melee = isMelee(ev, u);
        // o golpe cai junto com o dano; à distância o gesto é curto e o
        // projétil é que viaja (FX usa o mesmo hitDelay)
        lastHitDelay = melee ? 0.26 : 0.50;
        animQ.push({
          kind: 'cast', uid: ev.uid, tx: ev.x, ty: ev.y, t: 0,
          hit: lastHitDelay, dur: lastHitDelay + 0.34, melee: melee, age: 0
        });
        lastAtk = { x: u ? u.x : ev.x, y: u ? u.y : ev.y, age: 0 };
        break;

      case 'damage':
        (function (uid) {
          delayed.push({ t: animQ.length ? lastHitDelay : 0, fn: function () {
            var vv = getVis(uid); if (!vv) return;
            vv.flash = 1; vv.flashHold = 0.06; vv.hitK = 1;
            if (lastAtk && lastAtk.age < 2) {
              var pa = iso(lastAtk.x, lastAtk.y, 0), pu = iso(vv.x, vv.y, 0);
              var dx = pu.x - pa.x, dy = pu.y - pa.y, l = Math.hypot(dx, dy) || 1;
              vv.knockX = (dx / l) * 13; vv.knockY = (dy / l) * 13 - 4;
            } else { vv.knockX = (Math.random() * 2 - 1) * 9; vv.knockY = -7; }
            delayed.push({ t: 0.06, fn: function () { var v3 = getVis(uid); if (v3) v3.squash = 0.0001; } });
          } });
        })(ev.uid);
        break;

      case 'heal':
      case 'shield':
        v = getVis(ev.uid);
        if (v) v.squash = 0.0001;
        break;

      case 'death':
        (function (uid) {
          delayed.push({ t: animQ.length ? 0.30 : 0.05, fn: function () {
            var vv = getVis(uid); if (vv) vv.deathK = 0.0001;
          } });
        })(ev.uid);
        break;

      case 'pushed':
        animQ.push({
          kind: 'slide', uid: ev.uid, fx: ev.fromX, fy: ev.fromY, txx: ev.toX, tyy: ev.toY,
          t: 0, dur: 0.09 * (Math.abs(ev.toX - ev.fromX) + Math.abs(ev.toY - ev.fromY)) + 0.08, age: 0
        });
        break;

      case 'teleport':
        animQ.push({ kind: 'teleport', uid: ev.uid, fx: ev.fromX, fy: ev.fromY, txx: ev.toX, tyy: ev.toY, t: 0, dur: 0.42, age: 0 });
        break;

      case 'summon':
        if (ev.unit) {
          v = getVisFor(ev.unit.uid, ev.unit.x, ev.unit.y);
          v.popK = 0.0001;
          var st2 = state(); if (st2) initFacing(st2, ev.unit, v);
        }
        ovSig = '';
        break;

      case 'fusion':
        startFusion(ev);
        break;

      case 'weatherShift':
        setWeather(typeof ev.weather === 'string' ? ev.weather : (ev.weather && ev.weather.id));
        break;

      case 'weatherTick':
        v = getVis(ev.uid);
        if (v && ev.amount < 0) { v.flash = 0.5; v.flashHold = 0.03; }
        break;

      case 'dodgeFail':
        v = getVis(ev.uid);
        if (v) { v.squash = 0.0001; v.knockX = (Math.random() * 2 - 1) * 5; }
        break;

      case 'petAct':
        v = getVis(ev.uid);
        if (v) { v.squash = 0.0001; }
        break;

      case 'tileEvent':
      case 'trapTriggered':
      case 'markStack':
      case 'effectApplied':
        ovSig = '';
        break;

      case 'battleEnd':
        animQ.length = 0; delayed.length = 0; camFocus = null;
        for (var uid in vis) {
          var vv2 = vis[uid];
          vv2.castK = 0; vv2.lungeK = 0; vv2.hideK = 0; vv2.squash = 0; vv2.flash = 0; vv2.flashHold = 0;
        }
        ovSig = '';
        break;
    }
  };

  function resetAll(st) {
    vis = {};
    animQ.length = 0; delayed.length = 0; camFocus = null;
    lastAtk = null; lastHitDelay = 0.26;
    for (var uid in unitNodes) {
      var n = unitNodes[uid];
      if (n.parent) n.parent.removeChild(n);
      n.destroy({ children: true });
    }
    unitNodes = {};
    boardKey = null; ovSig = ''; evSig = '';
    weather.id = '';
    if (st && st.grid) {
      buildBoard(st);
      boardKey = roomKey(st);
      fitBoard(st, false);
      for (var i = 0; st.units && i < st.units.length; i++) {
        var u = st.units[i];
        var v = getVisFor(u.uid, u.x, u.y);
        initFacing(st, u, v);
      }
    }
    buildBackdrop();
    setWeather(weatherId(st), true);
    if (JOGO.FX && JOGO.FX.setAmbient) { try { JOGO.FX.setAmbient(themeOf(st)); } catch (e) {} }
  }
  function roomKey(st) {
    return String(st.dungeonId) + '|' + st.roomIndex + '|' + st.grid.w + 'x' + st.grid.h + '|' + gridHash(st);
  }
  function gridHash(st) {
    var s = '';
    for (var y = 0; y < st.grid.h; y += 2) for (var x = 0; x < st.grid.w; x += 2) s += tileKind(gridTile(st, x, y)).charAt(0);
    return hashStr(s);
  }

  // ---------- fusão (o momento mais especial) ----------
  function startFusion(ev) {
    var from = ev.from || [];
    var a = from[0], b = from[1];
    var va = a ? getVis(a) : null, vb = b ? getVis(b) : null;
    var mid = null;
    if (va && vb) mid = { x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2 };
    else {
      var nu = findUnit(ev.uid);
      mid = nu ? { x: nu.x, y: nu.y } : { x: va ? va.x : 0, y: va ? va.y : 0 };
    }
    var T = R.FUSION_TIMING;
    animQ.push({
      kind: 'fusion', uid: ev.uid, a: a, b: b, mid: mid, t: 0,
      dur: T.approach + T.flash + T.reveal, age: 0,
      newVisReady: false
    });
    // a câmera acompanha: aproxima na convergência, segura no clarão, volta depois
    focusOn(mid.x, mid.y, T.approach, T.flash + T.reveal, 0.55, 0.26);
  }

  // recentra suavemente se a unidade estiver fora da área confortável da tela
  function nudgeTo(uid) {
    if (!uid || camFocus) return;
    var u = findUnit(uid);
    if (!u) return;
    var v = vis[uid];
    var gx = v ? v.x : u.x, gy = v ? v.y : u.y;
    var p = R.project(gx, gy, 40);
    var m = Math.min(W, H) * 0.16;
    if (p.x > m && p.x < W - m && p.y > m && p.y < H - m) return;
    focusOn(gx, gy, 0.45, 0, 0, 0);
  }

  R.isBusy = function () {
    if (animQ.length > 0 || delayed.length > 0) return true;
    for (var uid in vis) if (vis[uid].deathK > 0 && vis[uid].deathK < 1) return true;
    return false;
  };
  R.hitDelay = function () { return animQ.length ? lastHitDelay : 0; };
  R.unitWorld = function (uid) {
    var v = vis[uid];
    if (v) return { x: v.x, y: v.y };
    var u = findUnit(uid);
    return u ? { x: u.x, y: u.y } : null;
  };
  R.unitHeight = function (uid) {
    var n = unitNodes[uid];
    return n && n.__height ? n.__height : 70;
  };
  R.fxLayers = function () {
    return { decal: decalLayer, fx: fxLayer, top: topLayer, world: world, weather: weatherLayer, app: app };
  };

  // ---------- animações ----------
  function updateAnims(dt) {
    var i;
    for (i = delayed.length - 1; i >= 0; i--) {
      delayed[i].t -= dt;
      if (delayed[i].t <= 0) { var fn = delayed[i].fn; delayed.splice(i, 1); fn(); }
    }
    if (lastAtk) lastAtk.age += dt;
    for (var uid in vis) {
      var v = vis[uid];
      if (v.flashHold > 0) v.flashHold -= dt; else v.flash = Math.max(0, v.flash - dt * 6);
      if (v.squash > 0) { v.squash += dt / 0.24; if (v.squash >= 1) v.squash = 0; }
      if (v.walkK > 0) v.walkK = Math.max(0, v.walkK - dt * 7);   // pernas voltam ao repouso
      if (v.hitK > 0) v.hitK = Math.max(0, v.hitK - dt * 4);      // recuo do golpe recebido
      v.knockX *= Math.pow(0.0002, dt); v.knockY *= Math.pow(0.0002, dt);
      if (v.deathK > 0 && v.deathK < 1) v.deathK = Math.min(1, v.deathK + dt / 0.55);
      if (v.popK < 1) v.popK = Math.min(1, v.popK + dt / 0.4);
    }
    if (!animQ.length) return;
    var a = animQ[0], v2, done = false;
    a.age = (a.age || 0) + dt;
    if (a.age > ANIM_WATCHDOG) done = true;
    switch (done ? 'skip' : a.kind) {
      case 'move':
        v2 = getVis(a.uid);
        if (!v2) { done = true; break; }
        // 4,4 células/s: rápido como no Dofus, mas devagar o bastante para ver o passo
        a.k += dt * 4.4;
        while (a.k >= 1 && a.seg < a.path.length) { a.k -= 1; a.seg++; }
        var from;
        if (a.seg === 0) {
          if (v2.startX == null) { v2.startX = v2.x; v2.startY = v2.y; }
          from = { x: v2.startX, y: v2.startY };
        } else from = a.path[a.seg - 1];
        if (a.seg >= a.path.length) {
          var last = a.path[a.path.length - 1];
          v2.x = last.x; v2.y = last.y; v2.z = 0;
          v2.startX = v2.startY = null;
          done = true;
        } else {
          var to = a.path[a.seg];
          v2.x = from.x + (to.x - from.x) * a.k;
          v2.y = from.y + (to.y - from.y) * a.k;
          // PASSO: uma passada completa (esquerda+direita) por célula
          v2.walkK = 1;
          v2.walkPh = (a.seg + a.k) * Math.PI * 2;
          v2.z = Math.abs(Math.sin(v2.walkPh)) * 5;          // sobe a cada passo
          if (to.x !== from.x || to.y !== from.y) faceUnit(v2, from.x, from.y, to.x, to.y);
        }
        break;
      case 'slide':
        v2 = getVis(a.uid);
        if (!v2) { done = true; break; }
        a.t += dt;
        var k = Math.min(a.t / a.dur, 1), e = 1 - (1 - k) * (1 - k);
        v2.x = a.fx + (a.txx - a.fx) * e;
        v2.y = a.fy + (a.tyy - a.fy) * e;
        if (k >= 1) { v2.x = a.txx; v2.y = a.tyy; done = true; }
        break;
      case 'teleport':
        v2 = getVis(a.uid);
        if (!v2) { done = true; break; }
        a.t += dt;
        var k2 = a.t / a.dur;
        if (k2 < 0.5) { v2.x = a.fx; v2.y = a.fy; v2.hideK = k2 * 2; }
        else { v2.x = a.txx; v2.y = a.tyy; v2.hideK = 1 - (k2 - 0.5) * 2; }
        if (k2 >= 1) { v2.hideK = 0; done = true; }
        break;
      case 'cast':
        // ANTECIPAÇÃO → GOLPE (no instante do dano) → RETORNO
        v2 = getVis(a.uid);
        a.t += dt;
        var ck = Math.min(a.t / a.dur, 1);
        if (v2) {
          var sAt = clamp(a.hit / a.dur, 0.15, 0.85);      // fração onde o golpe cai
          var atk, lun, cst, w;
          if (ck < sAt) {
            w = ck / sAt;
            atk = 0.5 * w; cst = w; lun = 0;
          } else {
            w = (ck - sAt) / (1 - sAt);
            atk = w < 0.25 ? (0.5 + 0.5 * (w / 0.25)) : Math.max(0, 1 - (w - 0.25) / 0.75);
            cst = Math.max(0, 1 - w / 0.3);
            lun = w < 0.25 ? (w / 0.25) : Math.max(0, 1 - (w - 0.25) / 0.5);
          }
          v2.atkK = atk; v2.castK = cst; v2.lungeK = lun;
          v2.atkMelee = a.melee ? 1 : 0;
          v2.castTx = a.tx; v2.castTy = a.ty;
          if (a.tx != null) faceUnit(v2, v2.x, v2.y, a.tx, a.ty);
        }
        if (ck >= 1) { if (v2) { v2.castK = 0; v2.lungeK = 0; v2.atkK = 0; } done = true; }
        break;
      case 'fusion':
        a.t += dt;
        var T = R.FUSION_TIMING;
        var va = a.a ? vis[a.a] : null, vb = a.b ? vis[a.b] : null;
        var vn = vis[a.uid];
        if (a.t < T.approach) {
          var kk = a.t / T.approach, ee = kk * kk * (3 - 2 * kk);
          if (va) { va.x = va.x + (a.mid.x - va.x) * Math.min(1, dt * 9); va.y = va.y + (a.mid.y - va.y) * Math.min(1, dt * 9); va.z = Math.sin(kk * Math.PI) * 10; }
          if (vb) { vb.x = vb.x + (a.mid.x - vb.x) * Math.min(1, dt * 9); vb.y = vb.y + (a.mid.y - vb.y) * Math.min(1, dt * 9); vb.z = Math.sin(kk * Math.PI) * 10; }
          if (vn) { vn.hideK = 1; }
        } else if (a.t < T.approach + T.flash) {
          if (va) va.hideK = 1;
          if (vb) vb.hideK = 1;
          if (vn) vn.hideK = 1;
        } else {
          if (!a.newVisReady) {
            a.newVisReady = true;
            var nu = findUnit(a.uid);
            var vv = vn || getVisFor(a.uid, nu ? nu.x : a.mid.x, nu ? nu.y : a.mid.y);
            vv.popK = 0.0001; vv.hideK = 0;
            vn = vv;
          }
          if (vn) vn.hideK = 0;
        }
        if (a.t >= a.dur) {
          if (va) va.hideK = 1;
          if (vb) vb.hideK = 1;
          if (vn) vn.hideK = 0;
          done = true;
        }
        break;
      case 'skip':
        v2 = getVis(a.uid);
        if (v2) {
          var u2 = findUnit(a.uid);
          if (u2) { v2.x = u2.x; v2.y = u2.y; }
          v2.z = 0; v2.castK = 0; v2.lungeK = 0; v2.hideK = 0; v2.squash = 0; v2.flashHold = 0;
          v2.startX = v2.startY = null;
        }
        done = true;
        break;
      default: done = true;
    }
    if (done) animQ.shift();
  }

  // ---------- laço de render ----------
  var perf = { frames: 0, ms: 0 };
  R.render = function (dt) {
    if (!ready || !app) return;
    dt = (dt == null) ? 0.016 : Math.min(dt, 0.1);
    var ts = (JOGO.FX && JOGO.FX.getTimeScale) ? JOGO.FX.getTimeScale() : 1;
    var dtv = dt * ts;
    nowT += dtv;

    var st = state();
    var sh = (JOGO.FX && JOGO.FX.getShake) ? JOGO.FX.getShake() : { x: 0, y: 0 };
    shake.x = sh.x + (weather.qx || 0);
    shake.y = sh.y + (weather.qy || 0);

    if (st && st.grid) {
      var rk = roomKey(st);
      if (rk !== boardKey) {
        boardKey = rk;
        buildBoard(st);
        buildBackdrop();
        fitBoard(st, false);
        ovSig = '';
        setWeather(weatherId(st), true);
        if (JOGO.FX && JOGO.FX.setAmbient) { try { JOGO.FX.setAmbient(themeOf(st)); } catch (e) {} }
      }
      if (weatherId(st) !== weather.id) setWeather(weatherId(st));
      updateAnims(dtv);
      if (st.units) syncUnits(st);
      var sig = overlaySignature(st);
      if (sig !== ovSig) { ovSig = sig; rebuildOverlays(st); }
      if (ovActive && st.phase === 'playing') {
        var en2 = engine();
        drawActiveRing(safe(function () { return en2 && en2.activeUnit ? en2.activeUnit(st) : null; }, null));
      }
      if (ovPulse) ovAoe.alpha = 0.62 + Math.sin(nowT * 7) * 0.34;
      else ovAoe.alpha = 1;
      if (ovActive) ovActive.alpha = 0.62 + Math.sin(nowT * 4) * 0.28;
      for (var e = 0; e < ovEventNodes.length; e++) {
        var n = ovEventNodes[e];
        if (n.__glow) n.__glow.alpha = 0.20 + (0.5 + Math.sin(nowT * 3 + e) * 0.5) * 0.26;
        if (n.__icon) n.__icon.position.y = n.__icon.__y0 + Math.sin(nowT * 2.6 + e) * 2.8;
      }
    }

    updateCamFocus(dtv);
    world.position.set(cam.panX + shake.x, cam.panY + shake.y);
    world.scale.set(cam.zoom);

    updateWeather(dt);
    if (JOGO.FX && JOGO.FX.update) { try { JOGO.FX.update(dtv, dt); } catch (e2) { if (console && console.warn) console.warn('[FX]', e2); } }

    app.renderer.render(stage);
    perf.frames++;
  };

  // sonda de perf p/ testes: renderiza n frames medindo o custo
  R.perfProbe = function (n) {
    n = n || 60;
    var t0 = (performance && performance.now) ? performance.now() : Date.now();
    for (var i = 0; i < n; i++) R.render(0.016);
    var gl = app && app.renderer && app.renderer.gl;
    if (gl && gl.finish) gl.finish();
    var t1 = (performance && performance.now) ? performance.now() : Date.now();
    return { frames: n, totalMs: t1 - t0, msPerFrame: (t1 - t0) / n, fps: 1000 / ((t1 - t0) / n) };
  };
  R.canvas = function () { return view; };
  R.stats = function () {
    var st = state();
    return {
      units: st && st.units ? st.units.length : 0,
      objects: objectLayer ? objectLayer.children.length : 0,
      floor: floorLayer ? floorLayer.children.length : 0,
      fx: fxLayer ? fxLayer.children.length : 0,
      zoom: cam.zoom, weather: weather.id, busy: R.isBusy(),
      tileW: TW, art: R.artStatus()
    };
  };
  // quais funções do Art entraram de fato (o resto caiu no placeholder)
  R.artStatus = function () {
    var out = {}, k;
    var names = ['unit', 'tile', 'obstacleHigh', 'obstacleLow', 'prop', 'tileEventIcon'];
    for (k = 0; k < names.length; k++) out[names[k]] = artMode[names[k]] || (artOk(names[k]) ? 'idle' : 'ausente');
    return out;
  };

  JOGO.Renderer = R;
})();
