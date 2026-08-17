var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// JOGO.Art — arte procedural 2D, estilo DOFUS 1.29. Dono: Designer Arte.
//
// Tudo é desenhado em canvas offscreen e devolvido como <canvas>; o Renderer
// converte com PIXI.Texture.from(canvas). Todo resultado é CACHEADO por chave.
//
// ---------------------------------------------------------------------------
// API pública
//   Art.unit(defId, opts)        -> canvas   opts: {element|elements, dir, scale}
//   Art.tile(theme, variant)     -> canvas   losango de chão (M.tileW × M.tileH+alt)
//   Art.obstacleHigh(theme, v)   -> canvas   bloqueia passagem E visão
//   Art.obstacleLow(theme, v)    -> canvas   bloqueia passagem, não a visão
//   Art.prop(theme, key)         -> canvas   decoração sem colisão
//   Art.portrait(defId, opts)    -> canvas   retrato quadrado (busto, de frente)
//   Art.spellIcon(spellOrKey, s) -> canvas
//   Art.itemIcon(itemId, s)      -> canvas
//   Art.petIcon(petId, s)        -> canvas
//   Art.tileEventIcon(kind, s)   -> canvas
//   Art.stoneIcon(stoneId, s)    -> canvas   pedra de forja (ADENDO v2.1)
//   Art.cardIcon(classId, w, h)  -> canvas   carta de classe (= Art.classCard)
//   Art.starIcon(filled, s)      -> canvas   estrela cheia/vazia da coleção
//   Art.rarityColor(rarity)      -> '#hex'
//   Art.elementColor(element)    -> '#hex'
//   Art.texture(key)             -> canvas   ('unit:sumo:fogo:0', 'tile:estufa:1', …)
//   Art.metrics / Art.setRes(n) / Art.clearCache() / Art.stats()
//
// ---------------------------------------------------------------------------
// CONVENÇÕES PARA O RENDERER (importante)
//   • Todo canvas traz `__res` (supersampling) e `__anchor` = [ax, ay] em 0..1.
//     No Pixi:  sp.anchor.set(cv.__anchor[0], cv.__anchor[1]);
//               sp.scale.set(1 / cv.__res);
//     Assim o sprite fica no tamanho de tela correto e ancorado no ponto certo.
//   • Unidade: âncora nos PÉS (0.5, 0.88) — posicione no centro da célula.
//   • Losango de chão: âncora (0.5, 0.5) do TOPO do losango (tileW × tileH).
//     Obstáculos/props: âncora na base (0.5, 1 - baseInset), alinhada ao centro
//     da célula; o canvas já reserva a altura acima.
//   • dir: 0=SE (frente-direita) · 1=SW (frente-esquerda) · 2=NW (costas-esq.)
//          3=NE (costas-direita). 1 e 2 são espelhos de 0 e 3.
//
// Estilo: cores chapadas (2–3 tons por forma), contorno escuro derivado da
// própria cor, silhueta forte, zero gradiente realista. Legibilidade em tela
// de celular vem antes de detalhe.
// ============================================================================

(function () {
  'use strict';

  var A = {};
  var TAU = Math.PI * 2;

  // ------------------------------------------------------------------ métricas
  var RES = 2;
  var M = {
    tileW: 128, tileH: 64,
    unitW: 160, unitH: 200,
    anchorX: 0.5, anchorY: 0.88,
    artUnit: 1.28,          // px de tela por unidade de arte (herói ~104 un.)
    res: RES,
    spriteScale: 1 / RES
  };
  A.metrics = M;

  // ------------------------------------------------------------------- cores
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function hx(c) {
    if (c.charAt(0) !== '#') c = '#' + c;
    if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  }
  function toHex(r, g, b) {
    var o = '#', v = [r, g, b], i, x;
    for (i = 0; i < 3; i++) { x = clamp(Math.round(v[i]), 0, 255); o += (x < 16 ? '0' : '') + x.toString(16); }
    return o;
  }
  function rgba(c, a) { var v = hx(c); return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a + ')'; }
  // sh(c, k): k>0 clareia, k<0 escurece
  function sh(c, k) {
    var v = hx(c), i, o = [];
    for (i = 0; i < 3; i++) o[i] = k > 0 ? v[i] + (255 - v[i]) * k : v[i] * (1 + k);
    return toHex(o[0], o[1], o[2]);
  }
  function mx(c1, c2, k) {
    var a = hx(c1), b = hx(c2), i, o = [];
    for (i = 0; i < 3; i++) o[i] = a[i] + (b[i] - a[i]) * k;
    return toHex(o[0], o[1], o[2]);
  }
  // satura mantendo o brilho (cores chapadas vibrantes, cara de desenho)
  function vivid(c, k) {
    var v = hx(c), m = (v[0] + v[1] + v[2]) / 3, i, o = [];
    for (i = 0; i < 3; i++) o[i] = m + (v[i] - m) * (1 + k);
    return toHex(o[0], o[1], o[2]);
  }
  // contorno: escuro, com um resto do matiz original (jeito Dofus, não preto puro)
  function lineOf(c) { return mx(sh(c, -0.62), '#191016', 0.5); }
  A.sh = sh; A.mx = mx; A.rgba = rgba; A.lineOf = lineOf;

  var ELEM = {
    neutro: { c: '#d8dee4', deep: '#8b93a0', glow: '#f4f8ff', name: 'Neutro' },
    fogo:   { c: '#ff8c3a', deep: '#c3341a', glow: '#ffd98a', name: 'Fogo' },
    agua:   { c: '#57c8ec', deep: '#1f6bb0', glow: '#b9f2ff', name: 'Água' },
    terra:  { c: '#9bd06a', deep: '#5c7a2a', glow: '#e2f0a8', name: 'Terra' },
    ar:     { c: '#c8b6ff', deep: '#7a63c8', glow: '#f0eaff', name: 'Ar' }
  };
  function elemInfo(e) {
    var d = (JOGO.DATA && JOGO.DATA.elementInfo && JOGO.DATA.elementInfo[e]) || null;
    var base = ELEM[e] || ELEM.neutro;
    if (d && d.color && d.color !== base.c) {
      return { c: d.color, deep: sh(d.color, -0.42), glow: sh(d.color, 0.5), name: d.name || base.name };
    }
    return base;
  }
  A.elementColor = function (e) { return elemInfo(e).c; };

  var RARITY = { comum: '#9aa4ae', raro: '#54a8e8', epico: '#ffc44d',
                 common: '#9aa4ae', rare: '#54a8e8', epic: '#ffc44d' };
  A.rarityColor = function (r) { return RARITY[r] || RARITY.comum; };

  // ------------------------------------------------------- canvas / contexto
  function mkCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * RES));
    c.height = Math.max(1, Math.round(h * RES));
    c.__res = RES; c.__w = w; c.__h = h;
    c.__anchor = [0.5, 0.5];
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in g) g.imageSmoothingQuality = 'high';
    return c;
  }

  var _lw = 2;              // espessura de contorno em unidades de arte (por desenho)
  var LW = 2.5;             // espessura desejada em px de TELA
  function setScale(k) { _lw = LW * RES / k; }

  // ------------------------------------------------------------ construtores
  // Cada builder devolve uma função(ctx) que monta o path, com .c (centro) e
  // .r (raio aprox.) para o sombreamento chapado saber onde cortar.
  function tag(f, cx, cy, r) { f.c = [cx, cy]; f.r = r; return f; }

  function Pel(x, y, rx, ry, rot) {
    return tag(function (ctx) {
      ctx.beginPath(); ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot || 0, 0, TAU);
    }, x, y, Math.max(Math.abs(rx), Math.abs(ry)));
  }
  function Prr(cx, cy, w, h, r) {
    var x = cx - w / 2, y = cy - h / 2;
    r = Math.min(r == null ? 4 : r, w / 2, h / 2);
    return tag(function (ctx) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }, cx, cy, Math.max(w, h) / 2);
  }
  function Ppoly(pts) {
    var i, mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
    for (i = 0; i < pts.length; i += 2) {
      if (pts[i] < mnx) mnx = pts[i]; if (pts[i] > mxx) mxx = pts[i];
      if (pts[i + 1] < mny) mny = pts[i + 1]; if (pts[i + 1] > mxy) mxy = pts[i + 1];
    }
    return tag(function (ctx) {
      ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
      for (var j = 2; j < pts.length; j += 2) ctx.lineTo(pts[j], pts[j + 1]);
      ctx.closePath();
    }, (mnx + mxx) / 2, (mny + mxy) / 2, Math.max(mxx - mnx, mxy - mny) / 2);
  }
  // curva fechada suave passando pelos pontos médios (orgânico, sem bicos)
  function Pblob(pts) {
    var n = pts.length / 2, i, mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
    for (i = 0; i < pts.length; i += 2) {
      if (pts[i] < mnx) mnx = pts[i]; if (pts[i] > mxx) mxx = pts[i];
      if (pts[i + 1] < mny) mny = pts[i + 1]; if (pts[i + 1] > mxy) mxy = pts[i + 1];
    }
    return tag(function (ctx) {
      var j, x1, y1, k;
      ctx.beginPath();
      var x0 = pts[(n - 1) * 2], y0 = pts[(n - 1) * 2 + 1];
      ctx.moveTo((x0 + pts[0]) / 2, (y0 + pts[1]) / 2);
      for (j = 0; j < n; j++) {
        x1 = pts[j * 2]; y1 = pts[j * 2 + 1];
        k = ((j + 1) % n) * 2;
        ctx.quadraticCurveTo(x1, y1, (x1 + pts[k]) / 2, (y1 + pts[k + 1]) / 2);
      }
      ctx.closePath();
    }, (mnx + mxx) / 2, (mny + mxy) / 2, Math.max(mxx - mnx, mxy - mny) / 2);
  }
  // cápsula com tangentes externas — membros, dedos, cabos
  function Pcap(x1, y1, r1, x2, y2, r2) {
    var dx = x2 - x1, dy = y2 - y1;
    var d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
    var a = Math.atan2(dy, dx);
    var t = Math.acos(clamp((r1 - r2) / d, -1, 1));
    return tag(function (ctx) {
      ctx.beginPath();
      ctx.arc(x1, y1, r1, a + t, a - t + TAU, false);
      ctx.arc(x2, y2, r2, a - t, a + t, false);
      ctx.closePath();
    }, (x1 + x2) / 2, (y1 + y2) / 2, Math.max(r1, r2) + d / 2);
  }
  // losango isométrico (célula)
  function Pdiamond(cx, cy, w, h) {
    return Ppoly([cx, cy - h / 2, cx + w / 2, cy, cx, cy + h / 2, cx - w / 2, cy]);
  }
  A.Pel = Pel; A.Prr = Prr; A.Ppoly = Ppoly; A.Pblob = Pblob; A.Pcap = Pcap;

  // -------------------------------------------------------------------- part
  // A peça central do estilo: preenche chapado, corta um segundo tom no lado
  // oposto à luz (fixa em cima-à-esquerda) e fecha com contorno escuro.
  var LIGHT = 0.62;
  function part(ctx, P, col, o) {
    o = o || {};
    ctx.save();
    P(ctx);
    ctx.fillStyle = col;
    ctx.fill();
    if (!o.flat) {
      var c = o.c || P.c || [0, 0];
      var r = (o.r || P.r || 22) * 3.2;
      ctx.save(); ctx.clip();
      ctx.translate(c[0] + (o.sx || 0), c[1] + (o.sy || 0));
      ctx.rotate(o.rot == null ? LIGHT : o.rot);
      ctx.fillStyle = o.dark || sh(col, -(o.k == null ? 0.24 : o.k));
      ctx.fillRect(0, -r, r, r * 2);
      ctx.restore();
      if (o.hi) {
        var rr = (o.r || P.r || 22);
        ctx.save(); ctx.clip();
        ctx.fillStyle = sh(col, o.hi === true ? 0.26 : o.hi);
        ctx.beginPath();
        ctx.ellipse(c[0] - rr * 0.36, c[1] - rr * 0.46, rr * 0.44, rr * 0.3, -0.5, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
    if (!o.noline) {
      P(ctx);
      ctx.strokeStyle = o.line || lineOf(col);
      ctx.lineWidth = (o.lw == null ? 1 : o.lw) * _lw;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }
  // forma chapada sem contorno (sombras internas, panos de fundo)
  function flat(ctx, P, col) { ctx.save(); P(ctx); ctx.fillStyle = col; ctx.fill(); ctx.restore(); }
  // traço solto (cordas, tiras, linhas de expressão)
  function stroke(ctx, pts, col, w, curve) {
    ctx.save();
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    if (curve && pts.length >= 6) {
      for (var i = 2; i < pts.length - 3; i += 4) {
        ctx.quadraticCurveTo(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
      }
    } else {
      for (var j = 2; j < pts.length; j += 2) ctx.lineTo(pts[j], pts[j + 1]);
    }
    ctx.strokeStyle = col; ctx.lineWidth = (w == null ? 1 : w) * _lw;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke(); ctx.restore();
  }
  function glow(ctx, x, y, r, col, a) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(col, a == null ? 0.85 : a));
    g.addColorStop(0.45, rgba(col, (a == null ? 0.85 : a) * 0.35));
    g.addColorStop(1, rgba(col, 0));
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.restore();
  }
  A.part = part; A.flat = flat; A.stroke = stroke;

  // ------------------------------------------------------- ruído determinístico
  function hash(s) {
    var h = 2166136261, i;
    s = String(s);
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) {
    var s = (typeof seed === 'string' ? hash(seed) : seed) >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  A.hash = hash;

  // ==========================================================================
  // PALETAS DE CLASSE
  // Puxa DATA.classes[id].palette quando existir; senão usa o padrão daqui.
  // O elemento tinge a cor principal sem destruir a identidade da classe.
  // ==========================================================================
  var DEF_PAL = {
    sumo:       { main: '#d4553f', dark: '#3a2b26', accent: '#ffd08a', skin: '#f0b98a', hair: '#2b1d18', cloth: '#9c2f3c' },
    arqueiro:   { main: '#4f9d6a', dark: '#26402f', accent: '#d8f0a0', skin: '#f5d7ae', hair: '#e8cf86', cloth: '#2f5a3e' },
    bruxo:      { main: '#7a5fa0', dark: '#241c33', accent: '#b98cff', skin: '#d8bc9c', hair: '#e6ded0', cloth: '#33285a' },
    espadachim: { main: '#2f6f8f', dark: '#1b2733', accent: '#9be8ff', skin: '#e8c49a', hair: '#22303c', cloth: '#25384a' },
    curandeira: { main: '#f0c05a', dark: '#6b4a2f', accent: '#fff2c2', skin: '#ffdcbc', hair: '#e07a3f', cloth: '#e88fa8' },
    invocador:  { main: '#3f8f8a', dark: '#1e3330', accent: '#8ff0d8', skin: '#c9bb9c', hair: '#2b3a35', cloth: '#2c4a44' },
    _:          { main: '#8a8f96', dark: '#2a2f36', accent: '#e0e6ec', skin: '#e0c0a0', hair: '#33291f', cloth: '#3a4048' }
  };

  function classPal(id, els) {
    var C = (JOGO.DATA && JOGO.DATA.classes && JOGO.DATA.classes[id]) || null;
    var b = DEF_PAL[id] || DEF_PAL._;
    var p = {
      main: (C && C.palette && C.palette.primary) || b.main,
      dark: (C && C.palette && C.palette.secondary) || b.dark,
      accent: (C && C.palette && C.palette.accent) || b.accent,
      skin: b.skin, hair: b.hair, cloth: b.cloth,
      metal: '#c2cbd6', leather: '#8a5a34', wood: '#9a6b3f'
    };
    els = els || ['neutro'];
    var e0 = els[0] || 'neutro';
    var i0 = elemInfo(e0);
    p.el = i0; p.elId = e0;
    if (e0 !== 'neutro') {
      p.main = vivid(mx(p.main, i0.c, 0.46), 0.10);
      p.accent = mx(p.accent, i0.glow, 0.55);
      p.cloth = mx(p.cloth, i0.deep, 0.40);
      p.metal = mx(p.metal, i0.c, 0.18);
    }
    var e1 = els[1] || null;
    if (e1) {
      var i1 = elemInfo(e1);
      p.el2 = i1; p.el2Id = e1;
      if (e1 !== 'neutro') {
        p.accent2 = i1.glow;
        p.cloth = mx(p.cloth, i1.deep, 0.30);
        p.wood = mx(p.wood, i1.c, 0.22);
      }
    }
    p.line = lineOf(p.main);
    return p;
  }

  // ==========================================================================
  // FORMAS ELEMENTAIS reutilizáveis (chama, gota, lasca, pena)
  // ==========================================================================
  function Pflame(x, y, w, h, lean) {
    lean = lean || 0;
    return tag(function (ctx) {
      ctx.beginPath();
      ctx.moveTo(x - w, y);
      ctx.quadraticCurveTo(x - w * 0.98, y - h * 0.52, x - w * 0.2 + lean * h * 0.4, y - h * 0.7);
      ctx.quadraticCurveTo(x + lean * h * 0.8 - w * 0.05, y - h * 0.92, x + lean * h, y - h);
      ctx.quadraticCurveTo(x + lean * h * 0.4 + w * 0.62, y - h * 0.66, x + w, y - h * 0.3);
      ctx.quadraticCurveTo(x + w * 1.04, y + h * 0.08, x, y + h * 0.1);
      ctx.quadraticCurveTo(x - w * 1.04, y + h * 0.08, x - w, y);
      ctx.closePath();
    }, x, y - h * 0.42, Math.max(w, h * 0.55));
  }
  function Pdrop(x, y, r) {
    return tag(function (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y - r * 1.85);
      ctx.quadraticCurveTo(x + r * 0.98, y - r * 0.35, x + r * 0.9, y + r * 0.15);
      ctx.quadraticCurveTo(x + r * 0.8, y + r, x, y + r);
      ctx.quadraticCurveTo(x - r * 0.8, y + r, x - r * 0.9, y + r * 0.15);
      ctx.quadraticCurveTo(x - r * 0.98, y - r * 0.35, x, y - r * 1.85);
      ctx.closePath();
    }, x, y - r * 0.2, r * 1.2);
  }
  function Pshard(x, y, r, seed) {
    var rd = rng(seed || 7), n = 5, pts = [], i, a, rr;
    for (i = 0; i < n; i++) {
      a = i / n * TAU - 0.4;
      rr = r * (0.66 + rd() * 0.5);
      pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.86);
    }
    return Ppoly(pts);
  }
  function Pfeather(x, y, len, ang) {
    var c = Math.cos(ang), s = Math.sin(ang), w = len * 0.26;
    return tag(function (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + c * len * 0.4 - s * w, y + s * len * 0.4 + c * w,
                           x + c * len, y + s * len);
      ctx.quadraticCurveTo(x + c * len * 0.45 + s * w, y + s * len * 0.45 - c * w, x, y);
      ctx.closePath();
    }, x + c * len * 0.5, y + s * len * 0.5, len * 0.55);
  }
  function Pswirl(x, y, r, turns) {
    return tag(function (ctx) {
      var i, a, rr, n = 26;
      ctx.beginPath();
      for (i = 0; i <= n; i++) {
        a = i / n * TAU * (turns || 1.1);
        rr = r * (0.2 + 0.8 * i / n);
        if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.62);
        else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.62);
      }
    }, x, y, r);
  }
  function Pstar(x, y, r, n, inner) {
    var pts = [], i, a, rr;
    n = n || 4; inner = inner == null ? 0.4 : inner;
    for (i = 0; i < n * 2; i++) {
      a = i / (n * 2) * TAU - Math.PI / 2;
      rr = (i % 2 ? r * inner : r);
      pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    return Ppoly(pts);
  }

  // --------------------------------------------------- decoração por elemento
  // Atrás do corpo: aura/silhueta que reforça a leitura à distância.
  function elemBack(ctx, An, cfg) {
    var e = cfg.pal.elId, p = cfg.pal, i = p.el;
    if (!e || e === 'neutro') { if (!cfg.pal.el2Id || cfg.pal.el2Id === 'neutro') return; }
    var hx0 = An.head[0], hy = An.head[1], hr = An.head[2];
    var cy = An.chest[1];
    if (e === 'fogo') {
      part(ctx, Pflame(-hr * 1.7, cy + 6, 7, 26, 0.22), sh(i.c, -0.12), { k: 0.18, line: lineOf(i.deep) });
      part(ctx, Pflame(hr * 1.85, cy - 4, 6, 20, -0.2), sh(i.c, -0.05), { k: 0.18, line: lineOf(i.deep) });
      part(ctx, Pflame(0, hy - hr * 1.15, 5, 15, 0.1), i.glow, { k: 0.16, line: lineOf(i.c) });
    } else if (e === 'agua') {
      part(ctx, Pel(0, An.hipY + 8, An.wide * 1.15, 8), rgba(i.c, 0.55), { flat: true, noline: true });
      stroke(ctx, [-An.wide * 1.2, An.hipY + 6, 0, An.hipY - 2, An.wide * 1.2, An.hipY + 6], rgba(i.glow, 0.8), 1.1, true);
      part(ctx, Pdrop(-hr * 1.9, cy - 6, 4.2), i.c, { k: 0.2, hi: true, line: lineOf(i.deep) });
      part(ctx, Pdrop(hr * 2.0, cy + 8, 3.4), i.glow, { k: 0.2, line: lineOf(i.deep) });
    } else if (e === 'terra') {
      part(ctx, Pshard(-hr * 2.0, cy - 2, 7, 'ta'), mx(i.deep, '#6b5a3a', 0.5), { k: 0.28 });
      part(ctx, Pshard(hr * 2.1, cy + 12, 5.5, 'tb'), mx(i.deep, '#6b5a3a', 0.35), { k: 0.28 });
      part(ctx, Pshard(hr * 1.5, hy - hr * 0.8, 4, 'tc'), i.c, { k: 0.24 });
    } else if (e === 'ar') {
      ctx.save();
      ctx.strokeStyle = rgba(i.glow, 0.75); ctx.lineWidth = _lw * 0.9; ctx.lineCap = 'round';
      Pswirl(-hr * 1.6, cy - 4, 13, 1.05)(ctx); ctx.stroke();
      Pswirl(hr * 1.9, cy + 14, 9, 0.9)(ctx); ctx.stroke();
      ctx.restore();
      part(ctx, Pfeather(hr * 1.4, hy - hr * 0.6, 11, -0.9), i.c, { k: 0.2, line: lineOf(i.deep) });
    }
    // segundo elemento (fusões): eco no lado oposto
    var e2 = p.el2Id;
    if (e2 && e2 !== 'neutro' && e2 !== e) {
      var j = p.el2;
      if (e2 === 'fogo') part(ctx, Pflame(hr * 2.1, cy + 10, 6, 21, -0.24), j.c, { k: 0.18, line: lineOf(j.deep) });
      else if (e2 === 'agua') part(ctx, Pdrop(hr * 2.2, cy - 2, 4.6), j.c, { k: 0.2, hi: true, line: lineOf(j.deep) });
      else if (e2 === 'terra') part(ctx, Pshard(hr * 2.2, cy + 6, 6.4, 'f2'), mx(j.deep, '#6b5a3a', 0.4), { k: 0.26 });
      else if (e2 === 'ar') {
        ctx.save(); ctx.strokeStyle = rgba(j.glow, 0.8); ctx.lineWidth = _lw * 0.9;
        Pswirl(hr * 2.1, cy + 2, 11, 1.0)(ctx); ctx.stroke(); ctx.restore();
      }
    }
  }
  // Na frente: brilho nos olhos/arma e faíscas curtas — pouco, só o tempero.
  function elemFront(ctx, An, cfg) {
    var p = cfg.pal, e = p.elId, i = p.el;
    if (!e || e === 'neutro') return;
    var s = An.shN;
    if (e === 'fogo') {
      part(ctx, Pflame(s[0] + 2, s[1] - 3, 4, 12, -0.15), i.glow, { k: 0.14, line: lineOf(i.c) });
    } else if (e === 'agua') {
      part(ctx, Pel(s[0] + 1, s[1] - 1, 5.4, 3.2, -0.4), rgba(i.glow, 0.9), { k: 0.16, line: lineOf(i.deep) });
    } else if (e === 'terra') {
      part(ctx, Pshard(s[0] + 1, s[1] - 2, 5.6, 'sh'), mx(i.c, '#8a7a52', 0.4), { k: 0.26 });
    } else if (e === 'ar') {
      part(ctx, Pfeather(s[0] - 1, s[1] - 3, 10, -0.35), i.glow, { k: 0.18, line: lineOf(i.deep) });
    }
  }

  // ==========================================================================
  // ACESSÓRIOS — vocabulário compartilhado. Qualquer peça funciona em qualquer
  // corpo, o que permite gerar as 15 fusões por composição.
  // ==========================================================================
  var ACC = {};

  // ---------------------------------------------------------------- cabeça
  // Cada peça tem duas metades: `behind` (atrás do crânio) e `front` (sobre
  // ele). O ROSTO é sempre desenhado por último, então nada o encobre — o erro
  // clássico de "herói sem cara" não acontece por construção.
  ACC.head = {
    // Sumô — cabelo colado e coque samurai
    topknot: {
      front: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal;
        part(ctx, tag(function (g) {
          g.beginPath();
          g.moveTo(h[0] - r * 1.0, h[1] - r * 0.16);
          g.quadraticCurveTo(h[0] - r * 0.92, h[1] - r * 1.06, h[0] + r * 0.06, h[1] - r * 1.08);
          g.quadraticCurveTo(h[0] + r * 1.0, h[1] - r * 1.02, h[0] + r * 1.02, h[1] - r * 0.12);
          g.quadraticCurveTo(h[0] + r * 0.7, h[1] - r * 0.5, h[0] + r * 0.1, h[1] - r * 0.46);
          g.quadraticCurveTo(h[0] - r * 0.6, h[1] - r * 0.48, h[0] - r * 1.0, h[1] - r * 0.16);
          g.closePath();
        }, h[0], h[1] - r * 0.6, r), p.hair, { k: 0.3 });
        part(ctx, Pel(h[0] + r * 0.06, h[1] - r * 1.12, r * 0.32, r * 0.24), sh(p.hair, 0.12), { k: 0.3, lw: 0.85 });
        part(ctx, Pcap(h[0] + r * 0.06, h[1] - r * 1.16, r * 0.18, h[0] + r * 0.52, h[1] - r * 1.5, r * 0.13),
             p.hair, { k: 0.24, lw: 0.85 });
      }
    },
    // Elfo — capuz curto que emoldura o rosto e deixa as orelhas de fora
    hood: {
      behind: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal, c = mx(p.main, p.dark, 0.3);
        part(ctx, Pblob([h[0] - r * 1.3, h[1] + r * 0.5, h[0] - r * 1.26, h[1] - r * 0.5,
                         h[0] - r * 0.4, h[1] - r * 1.34, h[0] + r * 0.66, h[1] - r * 1.22,
                         h[0] + r * 1.3, h[1] - r * 0.4, h[0] + r * 1.24, h[1] + r * 0.52]), c, { k: 0.26 });
        part(ctx, Ppoly([h[0] - r * 1.2, h[1] + r * 0.1, h[0] - r * 2.0, h[1] + r * 0.9,
                         h[0] - r * 0.7, h[1] + r * 0.8]), sh(c, -0.18), { k: 0.2 });
      },
      front: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal, c = mx(p.main, p.dark, 0.3);
        // só a testa: uma aba baixa, o rosto fica livre
        part(ctx, tag(function (g) {
          g.beginPath();
          g.moveTo(h[0] - r * 1.12, h[1] - r * 0.14);
          g.quadraticCurveTo(h[0] - r * 0.2, h[1] - r * 1.3, h[0] + r * 1.12, h[1] - r * 0.2);
          g.quadraticCurveTo(h[0] + r * 0.9, h[1] - r * 0.62, h[0] + r * 0.1, h[1] - r * 0.72);
          g.quadraticCurveTo(h[0] - r * 0.8, h[1] - r * 0.66, h[0] - r * 1.12, h[1] - r * 0.14);
          g.closePath();
        }, h[0], h[1] - r * 0.7, r), sh(c, 0.08), { k: 0.24 });
        part(ctx, Pel(h[0] + r * 0.34, h[1] - r * 0.86, r * 0.2, r * 0.2), p.accent, { k: 0.18, lw: 0.75 });
      }
    },
    // Bruxo — chapéu pontudo, aba larga acima dos olhos
    wizhat: {
      front: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal;
        var bx = h[0], by = h[1] - r * 0.62;
        var c = mx(p.main, p.dark, 0.24), c2 = sh(c, -0.18);
        part(ctx, tag(function (g) {
          g.beginPath();
          g.moveTo(bx - r * 1.0, by + r * 0.1);
          g.quadraticCurveTo(bx - r * 0.72, by - r * 1.5, bx + r * 0.3, by - r * 2.3);
          g.quadraticCurveTo(bx + r * 1.45, by - r * 2.86, bx + r * 1.92, by - r * 2.1);
          g.quadraticCurveTo(bx + r * 1.1, by - r * 1.98, bx + r * 0.84, by - r * 1.36);
          g.quadraticCurveTo(bx + r * 0.58, by - r * 0.56, bx + r * 0.98, by + r * 0.1);
          g.closePath();
        }, bx, by - r, r * 1.6), c, { k: 0.26 });
        part(ctx, Pel(bx + r * 0.05, by + r * 0.16, r * 1.78, r * 0.46), c2, { k: 0.2, hi: 0.2 });
        part(ctx, Ppoly([bx - r * 1.0, by - r * 0.02, bx + r * 1.0, by - r * 0.02,
                         bx + r * 0.9, by - r * 0.4, bx - r * 0.94, by - r * 0.4]), p.dark, { k: 0.2, lw: 0.85 });
        part(ctx, Pstar(bx + r * 0.46, by - r * 0.2, r * 0.28, 4, 0.42), p.accent, { k: 0.2, lw: 0.8 });
      }
    },
    // Espadachim — cabelo espetado + bandana na testa
    bandana: {
      behind: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal;
        part(ctx, Pblob([h[0] - r * 1.06, h[1] - r * 0.2, h[0] - r * 0.7, h[1] - r * 1.16,
                         h[0] + r * 0.12, h[1] - r * 1.36, h[0] + r * 0.9, h[1] - r * 1.0,
                         h[0] + r * 1.06, h[1] - r * 0.16]), p.hair, { k: 0.28 });
        part(ctx, Ppoly([h[0] - r * 0.94, h[1] - r * 0.76, h[0] - r * 1.72, h[1] - r * 1.16,
                         h[0] - r * 0.5, h[1] - r * 1.16]), p.hair, { k: 0.28, lw: 0.9 });
        part(ctx, Ppoly([h[0] + r * 0.14, h[1] - r * 1.2, h[0] + r * 0.3, h[1] - r * 1.94,
                         h[0] + r * 0.74, h[1] - r * 1.06]), p.hair, { k: 0.28, lw: 0.9 });
        part(ctx, Pblob([h[0] - r * 1.0, h[1] - r * 0.5, h[0] - r * 2.1, h[1] - r * 0.74,
                         h[0] - r * 2.6, h[1] - r * 0.12, h[0] - r * 1.7, h[1] - r * 0.14]),
             sh(p.main, -0.12), { k: 0.22 });
      },
      front: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal;
        part(ctx, tag(function (g) {
          g.beginPath();
          g.moveTo(h[0] - r * 1.08, h[1] - r * 0.36);
          g.quadraticCurveTo(h[0], h[1] - r * 0.62, h[0] + r * 1.08, h[1] - r * 0.46);
          g.lineTo(h[0] + r * 1.04, h[1] - r * 0.78);
          g.quadraticCurveTo(h[0], h[1] - r * 0.94, h[0] - r * 1.06, h[1] - r * 0.68);
          g.closePath();
        }, h[0], h[1] - r * 0.6, r), vivid(p.main, 0.14), { k: 0.24 });
      }
    },
    // Curandeira — cabelão com chiquinhas; a franja NÃO cobre os olhos
    buns: {
      behind: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal;
        part(ctx, Pblob([h[0] - r * 1.16, h[1] + r * 0.5, h[0] - r * 1.2, h[1] - r * 0.7,
                         h[0] - r * 0.4, h[1] - r * 1.22, h[0] + r * 0.5, h[1] - r * 1.18,
                         h[0] + r * 1.2, h[1] - r * 0.6, h[0] + r * 1.18, h[1] + r * 0.54]), p.hair, { k: 0.26 });
        part(ctx, Pel(h[0] - r * 1.3, h[1] + r * 0.2, r * 0.44, r * 0.52), p.hair, { k: 0.26, hi: 0.2 });
        part(ctx, Pel(h[0] + r * 1.34, h[1] + r * 0.12, r * 0.46, r * 0.54), p.hair, { k: 0.26, hi: 0.2 });
      },
      front: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal;
        part(ctx, tag(function (g) {
          g.beginPath();
          g.moveTo(h[0] - r * 1.04, h[1] - r * 0.22);
          g.quadraticCurveTo(h[0] - r * 0.9, h[1] - r * 1.1, h[0] + r * 0.06, h[1] - r * 1.1);
          g.quadraticCurveTo(h[0] + r * 1.0, h[1] - r * 1.06, h[0] + r * 1.04, h[1] - r * 0.2);
          g.quadraticCurveTo(h[0] + r * 0.62, h[1] - r * 0.52, h[0] + r * 0.2, h[1] - r * 0.42);
          g.quadraticCurveTo(h[0] - r * 0.5, h[1] - r * 0.36, h[0] - r * 1.04, h[1] - r * 0.22);
          g.closePath();
        }, h[0], h[1] - r * 0.66, r), sh(p.hair, 0.1), { k: 0.24 });
        var fx = h[0] + r * 0.96, fy = h[1] - r * 0.78, i;
        for (i = 0; i < 5; i++) {
          var a = i / 5 * TAU;
          part(ctx, Pel(fx + Math.cos(a) * r * 0.2, fy + Math.sin(a) * r * 0.2, r * 0.17, r * 0.17),
               p.accent, { k: 0.18, lw: 0.75 });
        }
        part(ctx, Pel(fx, fy, r * 0.12, r * 0.12), '#ffe27a', { k: 0.2, lw: 0.7 });
      }
    },
    // Invocador — máscara chifruda de madeira (esconde o rosto de propósito)
    mask: {
      hideFace: true,
      behind: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal, c = mx(p.dark, p.main, 0.4);
        part(ctx, Pblob([h[0] - r * 1.24, h[1] + r * 0.4, h[0] - r * 1.14, h[1] - r * 0.8,
                         h[0] + r * 0.1, h[1] - r * 1.3, h[0] + r * 1.18, h[1] - r * 0.76,
                         h[0] + r * 1.24, h[1] + r * 0.44]), c, { k: 0.24 });
      },
      front: function (ctx, An, cfg) {
        var h = An.head, r = h[2], p = cfg.pal;
        var mkC = mx(p.wood, p.accent, 0.18);
        part(ctx, Pcap(h[0] - r * 0.86, h[1] - r * 0.68, r * 0.2, h[0] - r * 1.44, h[1] - r * 1.52, r * 0.07),
             p.wood, { k: 0.3, lw: 0.9 });
        part(ctx, Pcap(h[0] + r * 0.9, h[1] - r * 0.62, r * 0.2, h[0] + r * 1.5, h[1] - r * 1.46, r * 0.07),
             p.wood, { k: 0.3, lw: 0.9 });
        part(ctx, Pblob([h[0] - r * 0.88, h[1] - r * 0.56, h[0] + r * 0.2, h[1] - r * 0.82,
                         h[0] + r * 0.98, h[1] - r * 0.44, h[0] + r * 0.86, h[1] + r * 0.62,
                         h[0] + r * 0.12, h[1] + r * 0.98, h[0] - r * 0.78, h[1] + r * 0.52]),
             mkC, { k: 0.24, hi: 0.18 });
        glow(ctx, h[0] - r * 0.26, h[1] - r * 0.08, r * 0.66, p.accent, 0.55);
        glow(ctx, h[0] + r * 0.5, h[1] - r * 0.06, r * 0.6, p.accent, 0.55);
        part(ctx, Ppoly([h[0] - r * 0.6, h[1] - r * 0.22, h[0] - r * 0.02, h[1] - r * 0.34,
                         h[0] - r * 0.04, h[1] + r * 0.04, h[0] - r * 0.62, h[1] + r * 0.1]),
             sh(p.accent, 0.4), { flat: true, lw: 0.75, line: sh(p.accent, -0.3) });
        part(ctx, Ppoly([h[0] + r * 0.26, h[1] - r * 0.34, h[0] + r * 0.76, h[1] - r * 0.2,
                         h[0] + r * 0.74, h[1] + r * 0.1, h[0] + r * 0.24, h[1] + r * 0.02]),
             sh(p.accent, 0.4), { flat: true, lw: 0.75, line: sh(p.accent, -0.3) });
        stroke(ctx, [h[0] - r * 0.5, h[1] + r * 0.5, h[0] + r * 0.02, h[1] + r * 0.58,
                     h[0] + r * 0.5, h[1] + r * 0.44], sh(p.wood, -0.42), 1, true);
      }
    }
  };

  // -------------------------------------------------------- costas / atrás
  ACC.back = {
    quiver: function (ctx, An, cfg) {
      var p = cfg.pal, b = An.backC, i;
      part(ctx, Prr(b[0] - An.wide * 0.5, b[1] + 2, 11, 30, 5), p.leather, { k: 0.28, rot: LIGHT });
      for (i = 0; i < 3; i++) {
        var ax = b[0] - An.wide * 0.5 - 3 + i * 3.4, ay = b[1] - 14 - i * 1.5;
        stroke(ctx, [ax, ay + 6, ax - 2 - i, ay - 8], sh(p.wood, -0.2), 0.8);
        part(ctx, Ppoly([ax - 2 - i, ay - 8, ax - 6 - i, ay - 12, ax + 1 - i, ay - 11]),
             i === 1 ? p.accent : p.main, { k: 0.22, lw: 0.7 });
      }
    },
    cape: function (ctx, An, cfg) {
      var p = cfg.pal, c = mx(p.main, p.dark, 0.44);
      var y0 = An.shF[1] - 3, y1 = An.hipY + An.h * 0.30, w = An.wide * 1.28;
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-w * 0.72, y0);
        g.quadraticCurveTo(-w * 1.24, y0 + (y1 - y0) * 0.55, -w * 0.95, y1);
        g.quadraticCurveTo(-w * 0.3, y1 + 6, 0, y1 + 2);
        g.quadraticCurveTo(w * 0.55, y1 + 6, w * 0.98, y1 - 3);
        g.quadraticCurveTo(w * 1.2, y0 + (y1 - y0) * 0.4, w * 0.68, y0);
        g.closePath();
      }, 0, (y0 + y1) / 2, w), c, { k: 0.22, rot: LIGHT });
      stroke(ctx, [-w * 0.5, y0 + 8, -w * 0.62, (y0 + y1) / 2, -w * 0.5, y1 - 4], sh(c, -0.18), 0.9, true);
      stroke(ctx, [w * 0.42, y0 + 10, w * 0.58, (y0 + y1) / 2, w * 0.46, y1 - 6], sh(c, -0.18), 0.9, true);
    },
    scarf: function (ctx, An, cfg) {
      var p = cfg.pal, c = vivid(p.main, 0.16);
      var x0 = An.shF[0] + 2, y0 = An.shF[1] - 1;
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo(x0 - An.wide * 1.5, y0 - 6, x0 - An.wide * 2.3, y0 + 12);
        g.quadraticCurveTo(x0 - An.wide * 1.9, y0 + 6, x0 - An.wide * 1.5, y0 + 14);
        g.quadraticCurveTo(x0 - An.wide * 0.8, y0 + 16, x0, y0 + 9);
        g.closePath();
      }, x0 - An.wide, y0 + 6, An.wide * 1.6), c, { k: 0.24, rot: LIGHT });
      part(ctx, Pel(An.neck[0], An.neck[1] + 1, An.wide * 0.42, 4.6), sh(c, -0.06), { k: 0.2 });
    },
    totem: function (ctx, An, cfg) {
      var p = cfg.pal, b = An.backC, x = b[0] - An.wide * 0.42, i;
      var top = An.head[1] - An.head[2] * 0.4, bot = An.hipY + 10;
      var cols = [p.wood, mx(p.wood, p.main, 0.5), mx(p.wood, p.accent, 0.3)];
      for (i = 0; i < 3; i++) {
        var yy = top + (bot - top) * (i / 3 + 0.16), hgt = (bot - top) / 3.2;
        part(ctx, Prr(x, yy, 17 - i * 1.2, hgt, 3), cols[i], { k: 0.28, rot: LIGHT });
        // carinha entalhada
        part(ctx, Pel(x - 3.4, yy - 1, 1.9, 1.5), p.accent, { k: 0.1, lw: 0.6 });
        part(ctx, Pel(x + 3.2, yy - 1, 1.9, 1.5), p.accent, { k: 0.1, lw: 0.6 });
        stroke(ctx, [x - 3.6, yy + 4, x, yy + 5.4, x + 3.6, yy + 4], sh(cols[i], -0.4), 0.8, true);
      }
      // asas do topo
      part(ctx, Ppoly([x - 8, top + 3, x - 15, top - 2, x - 8, top + 8]), mx(p.wood, p.dark, 0.3), { k: 0.26, lw: 0.8 });
      part(ctx, Ppoly([x + 8, top + 3, x + 15, top - 2, x + 8, top + 8]), mx(p.wood, p.dark, 0.3), { k: 0.26, lw: 0.8 });
    }
  };

  // ------------------------------------------------------------------ armas
  // Todas desenhadas a partir da mão (hx,hy) informada pelo corpo.
  ACC.weapon = {
    fists: function () {},
    bow: function (ctx, An, cfg, hx0, hy0) {
      var p = cfg.pal, R = 33;
      var cx = hx0 + 7, cy = hy0 - 2;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(-0.16);
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(0, -R);
        g.quadraticCurveTo(16, -R * 0.52, 16, 0);
        g.quadraticCurveTo(16, R * 0.52, 0, R);
        g.quadraticCurveTo(10.6, R * 0.5, 10.6, 0);
        g.quadraticCurveTo(10.6, -R * 0.5, 0, -R);
        g.closePath();
      }, 10, 0, R), mx(p.wood, p.main, 0.34), { k: 0.26 });
      // corda + flecha encaixada
      stroke(ctx, [0, -R, -1.5, 0, 0, R], rgba('#f4ecd8', 0.92), 0.75, true);
      stroke(ctx, [-14, 0, 12, 0], sh(p.wood, -0.24), 0.7);
      part(ctx, Ppoly([-14, 0, -19, -3.4, -18, 0, -19, 3.4]), p.accent, { k: 0.18, lw: 0.7 });
      part(ctx, Ppoly([12, 0, 8, -2.6, 8, 2.6]), sh(p.metal, -0.1), { k: 0.18, lw: 0.7 });
      part(ctx, Pel(14, 0, 3.4, 5.6), p.accent, { k: 0.2, lw: 0.8 });
      ctx.restore();
    },
    staff: function (ctx, An, cfg, hx0, hy0) {
      var p = cfg.pal;
      var topY = An.head[1] - An.head[2] * 2.5;
      var botY = 2;
      var tx = hx0 + 4, bx = hx0 - 3;
      part(ctx, Pcap(tx, topY + 8, 2.5, bx, botY, 2.1), p.wood, { k: 0.28 });
      // nós na madeira
      stroke(ctx, [tx - 1, topY + 24, bx + 1.5, botY - 22], sh(p.wood, -0.28), 0.55);
      // cristal
      part(ctx, Ppoly([tx, topY - 9, tx + 6.5, topY + 1, tx + 3.4, topY + 10,
                       tx - 3.4, topY + 10, tx - 6.5, topY + 1]), p.accent, { k: 0.2, hi: true });
      glow(ctx, tx, topY + 1, 15, p.accent, 0.5);
      part(ctx, Pel(tx, topY + 11, 4.4, 2.6), mx(p.metal, p.main, 0.3), { k: 0.24, lw: 0.8 });
    },
    sword: function (ctx, An, cfg, hx0, hy0) {
      var p = cfg.pal;
      ctx.save();
      ctx.translate(hx0, hy0); ctx.rotate(0.42);
      part(ctx, Ppoly([-1.6, 2, 1.6, 2, 2.2, -34, 0, -41, -2.2, -34]), mx(p.metal, p.accent, 0.28), { k: 0.2, hi: true });
      stroke(ctx, [0, -3, 0, -33], sh(p.metal, 0.4), 0.5);
      part(ctx, Prr(0, 3.4, 13, 3.4, 1.6), mx(p.main, p.dark, 0.3), { k: 0.24 });
      part(ctx, Prr(0, 9, 3.4, 9, 1.6), p.leather, { k: 0.26 });
      part(ctx, Pel(0, 14.4, 2.6, 2.6), p.accent, { k: 0.2, lw: 0.8 });
      ctx.restore();
    },
    wand: function (ctx, An, cfg, hx0, hy0) {
      var p = cfg.pal;
      var topY = hy0 - 30, tx = hx0 + 3;
      part(ctx, Pcap(tx, topY + 6, 1.9, hx0 - 1, hy0 + 12, 1.7), p.wood, { k: 0.28 });
      // bulbo em flor
      var i;
      for (i = 0; i < 5; i++) {
        var a = i / 5 * TAU - 0.4;
        part(ctx, Pel(tx + Math.cos(a) * 4.4, topY + Math.sin(a) * 4.4, 3.4, 3.0), p.main, { k: 0.2, lw: 0.8, hi: true });
      }
      part(ctx, Pel(tx, topY, 3.4, 3.4), p.accent, { k: 0.18, lw: 0.8 });
      glow(ctx, tx, topY, 13, p.accent, 0.5);
    },
    tome: function (ctx, An, cfg, hx0, hy0) {
      var p = cfg.pal;
      var x = hx0 + 3, y = hy0 - 2;
      ctx.save(); ctx.translate(x, y); ctx.rotate(0.16);
      part(ctx, Ppoly([-13, 2, -1, -2.4, -1, 8, -13, 12]), mx(p.main, p.dark, 0.4), { k: 0.24 });
      part(ctx, Ppoly([1, -2.4, 13, 2, 13, 12, 1, 8]), mx(p.main, p.dark, 0.28), { k: 0.24 });
      part(ctx, Ppoly([-12, 1.4, -1, -2.6, -1, 5.4, -12, 9]), '#f2e6c8', { k: 0.14, lw: 0.7 });
      part(ctx, Ppoly([1, -2.6, 12, 1.4, 12, 9, 1, 5.4]), '#e8dab8', { k: 0.14, lw: 0.7 });
      stroke(ctx, [-9, 2.4, -3, 0.6], sh('#c8b48a', -0.2), 0.5);
      stroke(ctx, [-9, 5.2, -3, 3.4], sh('#c8b48a', -0.2), 0.5);
      part(ctx, Pstar(0, -6, 4.2, 4, 0.36), p.accent, { k: 0.16, lw: 0.7 });
      glow(ctx, 0, -6, 12, p.accent, 0.45);
      ctx.restore();
    }
  };
  // versão "guardada" da arma (fusões: a arma do corpo dominante fica às costas)
  function drawStowed(ctx, An, cfg, kind) {
    var p = cfg.pal, b = An.backC;
    var x = b[0] - An.wide * 0.62, y = b[1];
    ctx.save(); ctx.translate(x, y); ctx.rotate(0.42); ctx.scale(0.82, 0.82);
    if (kind === 'bow') {
      part(ctx, tag(function (g) {
        g.beginPath(); g.moveTo(0, -22);
        g.quadraticCurveTo(-11, -11, -11, 0); g.quadraticCurveTo(-11, 11, 0, 22);
        g.quadraticCurveTo(-7, 11, -7, 0); g.quadraticCurveTo(-7, -11, 0, -22);
        g.closePath();
      }, -6, 0, 22), mx(p.wood, p.dark, 0.3), { k: 0.26, lw: 0.8 });
    } else if (kind === 'sword') {
      part(ctx, Ppoly([-1.4, 0, 1.4, 0, 1.8, -26, 0, -31, -1.8, -26]), sh(p.metal, -0.24), { k: 0.2, lw: 0.8 });
      part(ctx, Prr(0, 2.4, 10, 2.8, 1.4), mx(p.dark, p.main, 0.3), { k: 0.24, lw: 0.8 });
    } else if (kind === 'staff' || kind === 'wand') {
      part(ctx, Pcap(0, -24, 1.8, 0, 20, 1.6), sh(p.wood, -0.2), { k: 0.26, lw: 0.8 });
      part(ctx, Pel(0, -26, 3.4, 3.4), sh(p.accent, -0.2), { k: 0.2, lw: 0.7 });
    } else if (kind === 'tome') {
      part(ctx, Prr(0, 0, 15, 19, 2), mx(p.main, p.dark, 0.42), { k: 0.24, lw: 0.8 });
      part(ctx, Prr(4, 0, 4, 17, 1), '#e8dab8', { k: 0.16, lw: 0.6 });
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ torso
  ACC.torso = {
    mawashi: function (ctx, An, cfg) {
      var p = cfg.pal, y = An.hipY + 2, w = An.wide * 1.08, i;
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-w, y - 8); g.quadraticCurveTo(0, y - 12, w, y - 8);
        g.lineTo(w * 0.96, y + 4); g.quadraticCurveTo(0, y + 9, -w * 0.96, y + 4);
        g.closePath();
      }, 0, y - 2, w), p.cloth, { k: 0.22, rot: LIGHT });
      for (i = -2; i <= 2; i++) {
        part(ctx, Prr(i * w * 0.34, y + 9, w * 0.17, 15, 1.5), sh(p.cloth, i % 2 ? -0.1 : 0.06), { k: 0.2, lw: 0.75 });
      }
      part(ctx, Pel(0, y - 3, w * 0.2, 4), p.accent, { k: 0.2, lw: 0.8 });
    },
    baldric: function (ctx, An, cfg) {
      var p = cfg.pal;
      var x0 = An.shF[0] + 1, y0 = An.shF[1] + 2, x1 = An.hipC[0] + An.wide * 0.5, y1 = An.hipY - 1;
      part(ctx, Pcap(x0, y0, 3.4, x1, y1, 3.0), p.leather, { k: 0.28, rot: LIGHT });
      part(ctx, Prr((x0 + x1) / 2, (y0 + y1) / 2, 6, 5, 1.4), p.accent, { k: 0.22, lw: 0.8 });
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-An.wide * 0.92, An.hipY - 3); g.quadraticCurveTo(0, An.hipY + 3, An.wide * 0.92, An.hipY - 3);
        g.lineTo(An.wide * 0.88, An.hipY - 8); g.quadraticCurveTo(0, An.hipY - 3, -An.wide * 0.88, An.hipY - 8);
        g.closePath();
      }, 0, An.hipY - 3, An.wide), p.leather, { k: 0.24 });
    },
    robe: function (ctx, An, cfg) {
      var p = cfg.pal, c = mx(p.main, p.dark, 0.2);
      var y0 = An.chest[1] + 2, y1 = An.hipY + An.h * 0.30, w = An.wide;
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-w * 0.5, y0); g.lineTo(w * 0.5, y0);
        g.quadraticCurveTo(w * 0.75, (y0 + y1) / 2, w * 0.66, y1);
        g.quadraticCurveTo(0, y1 + 5, -w * 0.66, y1);
        g.quadraticCurveTo(-w * 0.75, (y0 + y1) / 2, -w * 0.5, y0);
        g.closePath();
      }, 0, (y0 + y1) / 2, w), c, { k: 0.22, rot: LIGHT });
      stroke(ctx, [0, y0 + 2, 2, (y0 + y1) / 2, 0, y1 - 2], sh(c, -0.24), 0.9, true);
      part(ctx, Pel(0, y0 + 1, w * 0.2, 3), p.accent, { k: 0.2, lw: 0.8 });
    },
    sash: function (ctx, An, cfg) {
      var p = cfg.pal, y = An.hipY - 2, w = An.wide;
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-w * 0.9, y - 5); g.quadraticCurveTo(0, y - 1, w * 0.9, y - 6);
        g.lineTo(w * 0.86, y + 3); g.quadraticCurveTo(0, y + 8, -w * 0.86, y + 2);
        g.closePath();
      }, 0, y, w), vivid(p.main, 0.2), { k: 0.24 });
      part(ctx, Pblob([w * 0.5, y, w * 0.95, y + 6, w * 0.72, y + 18, w * 0.4, y + 8]),
           vivid(p.main, 0.1), { k: 0.24, lw: 0.85 });
    },
    apron: function (ctx, An, cfg) {
      var p = cfg.pal, y0 = An.chest[1] + 3, y1 = An.hipY + An.h * 0.22, w = An.wide * 0.86;
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-w * 0.44, y0); g.lineTo(w * 0.44, y0);
        g.quadraticCurveTo(w * 0.8, (y0 + y1) / 2, w * 0.72, y1);
        g.quadraticCurveTo(0, y1 + 4, -w * 0.72, y1);
        g.quadraticCurveTo(-w * 0.8, (y0 + y1) / 2, -w * 0.44, y0);
        g.closePath();
      }, 0, (y0 + y1) / 2, w), '#f4ead6', { k: 0.16, rot: LIGHT });
      part(ctx, Prr(0, (y0 + y1) / 2 + 3, w * 0.5, 8, 2), sh('#f4ead6', -0.1), { k: 0.14, lw: 0.8 });
      part(ctx, Pel(0, y0 + 1, w * 0.24, 3), p.accent, { k: 0.2, lw: 0.8 });
    },
    tabard: function (ctx, An, cfg) {
      var p = cfg.pal, y0 = An.chest[1] - 2, y1 = An.hipY + An.h * 0.20, w = An.wide * 0.62, i;
      part(ctx, Ppoly([-w * 0.5, y0, w * 0.5, y0, w * 0.62, y1, 0, y1 + 4, -w * 0.62, y1]),
           mx(p.cloth, p.main, 0.4), { k: 0.24, rot: LIGHT });
      for (i = 0; i < 3; i++) {
        part(ctx, Pstar(0, y0 + 8 + i * 11, 2.8, 4, 0.34), p.accent, { k: 0.16, lw: 0.6 });
      }
    }
  };

  // ==========================================================================
  // CORPO — peças compartilhadas (braços, pernas, mãos, pés, rosto)
  // ==========================================================================
  function drawArm(ctx, a, col) {
    part(ctx, Pcap(a.sh[0], a.sh[1], a.r0, a.el[0], a.el[1], a.r1), col, { k: 0.24 });
    part(ctx, Pcap(a.el[0], a.el[1], a.r1, a.hd[0], a.hd[1], a.r1 * 0.9), col, { k: 0.24 });
  }
  function drawHand(ctx, a, col) {
    part(ctx, Pel(a.hd[0], a.hd[1], a.hr, a.hr * 0.95), col, { k: 0.22, hi: true });
  }
  function drawLeg(ctx, l, col, footCol) {
    part(ctx, Pcap(l.hip[0], l.hip[1], l.r0, l.knee[0], l.knee[1], l.r1), col, { k: 0.24 });
    part(ctx, Pcap(l.knee[0], l.knee[1], l.r1, l.ank[0], l.ank[1], l.r1 * 0.86), col, { k: 0.24 });
    if (l.foot) {
      part(ctx, tag(function (g) {
        var f = l.foot;
        g.beginPath();
        g.moveTo(f[0] - f[2] * 0.5, f[1] - f[3]);
        g.quadraticCurveTo(f[0] + f[2] * 0.62, f[1] - f[3] * 1.15, f[0] + f[2] * 0.62, f[1]);
        g.quadraticCurveTo(f[0], f[1] + f[3] * 0.7, f[0] - f[2] * 0.5, f[1]);
        g.closePath();
      }, l.foot[0], l.foot[1] - l.foot[3] * 0.3, l.foot[2] * 0.6), footCol, { k: 0.26 });
    }
  }
  // olho estilo desenho: oval escuro + brilho
  function eye(ctx, x, y, rx, ry, col, hiSide) {
    part(ctx, Pel(x, y, rx, ry), col || '#2a2028', { k: 0.1, lw: 0.7 });
    flat(ctx, Pel(x + rx * (hiSide || 0.3), y - ry * 0.36, rx * 0.32, ry * 0.3), 'rgba(255,255,255,0.92)');
  }
  // Rosto: traços GRANDES e poucos. Tudo aqui foi calibrado para continuar
  // legível quando o herói ocupa ~90 px de altura na tela do celular.
  var INK = '#2b2028';
  function drawFace(ctx, An, cfg, style) {
    if (cfg.back) return;
    var h = An.head, r = h[2], p = cfg.pal;
    var cx = h[0] + r * 0.16, cy = h[1] + r * 0.14;   // rosto puxado p/ o lado da câmera
    var ex = r * 0.4, ey = cy;                        // afastamento dos olhos
    if (style === 'mask') return;

    if (style === 'glow') {
      // sombra da aba do chapéu cobrindo os olhos + dois pontos acesos
      ctx.save();
      Pel(h[0], h[1], r * 1.02, r * 1.06)(ctx); ctx.clip();
      flat(ctx, Prr(h[0], h[1] - r * 0.24, r * 2.4, r * 1.5, 0), 'rgba(26,16,32,0.82)');
      ctx.restore();
      glow(ctx, cx - ex, ey - r * 0.1, r * 0.66, p.accent, 0.7);
      glow(ctx, cx + ex, ey - r * 0.14, r * 0.62, p.accent, 0.7);
      part(ctx, Pel(cx - ex, ey - r * 0.1, r * 0.21, r * 0.11, -0.22), sh(p.accent, 0.55),
           { flat: true, lw: 0.7, line: p.accent });
      part(ctx, Pel(cx + ex, ey - r * 0.14, r * 0.2, r * 0.1, -0.22), sh(p.accent, 0.55),
           { flat: true, lw: 0.7, line: p.accent });
      stroke(ctx, [cx - r * 0.28, cy + r * 0.46, cx + r * 0.06, cy + r * 0.52, cx + r * 0.34, cy + r * 0.42], INK, 1.1, true);
      return;
    }
    if (style === 'cute') {
      eye(ctx, cx - ex, ey + r * 0.02, r * 0.22, r * 0.27, '#3a2430', 0.32);
      eye(ctx, cx + ex, ey - r * 0.02, r * 0.22, r * 0.27, '#3a2430', 0.32);
      flat(ctx, Pel(cx - ex * 1.7, cy + r * 0.32, r * 0.17, r * 0.11), rgba('#ff8fa8', 0.6));
      flat(ctx, Pel(cx + ex * 1.7, cy + r * 0.3, r * 0.17, r * 0.11), rgba('#ff8fa8', 0.6));
      stroke(ctx, [cx - r * 0.18, cy + r * 0.42, cx + r * 0.02, cy + r * 0.56, cx + r * 0.22, cy + r * 0.4], '#8a4a48', 1.1, true);
      return;
    }
    if (style === 'grim') {
      eye(ctx, cx - ex, ey + r * 0.04, r * 0.16, r * 0.15, INK, 0.28);
      eye(ctx, cx + ex, ey + r * 0.02, r * 0.16, r * 0.15, INK, 0.28);
      stroke(ctx, [cx - ex * 1.5, cy - r * 0.34, cx - ex * 0.4, cy - r * 0.14], INK, 1.5);
      stroke(ctx, [cx + ex * 1.5, cy - r * 0.36, cx + ex * 0.4, cy - r * 0.16], INK, 1.5);
      stroke(ctx, [cx - r * 0.34, cy + r * 0.5, cx + r * 0.04, cy + r * 0.44, cx + r * 0.38, cy + r * 0.5], '#8a4a42', 1.4, true);
      return;
    }
    if (style === 'grin') {
      // meia-máscara cobrindo o queixo (assassino)
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(cx - r * 0.86, cy + r * 0.16);
        g.quadraticCurveTo(cx, cy + r * 0.1, cx + r * 0.86, cy + r * 0.1);
        g.quadraticCurveTo(cx + r * 0.54, cy + r * 0.9, cx - r * 0.08, cy + r * 0.88);
        g.quadraticCurveTo(cx - r * 0.72, cy + r * 0.7, cx - r * 0.86, cy + r * 0.16);
        g.closePath();
      }, cx, cy + r * 0.45, r * 0.85), mx(p.cloth, p.dark, 0.45), { k: 0.22, lw: 0.85 });
      eye(ctx, cx - ex, ey - r * 0.16, r * 0.18, r * 0.13, INK, 0.28);
      eye(ctx, cx + ex, ey - r * 0.2, r * 0.18, r * 0.13, INK, 0.28);
      stroke(ctx, [cx - ex * 1.5, cy - r * 0.5, cx - ex * 0.42, cy - r * 0.38], INK, 1.3);
      stroke(ctx, [cx + ex * 1.5, cy - r * 0.54, cx + ex * 0.42, cy - r * 0.42], INK, 1.3);
      return;
    }
    // 'sharp' — padrão (elfo/atento)
    eye(ctx, cx - ex, ey - r * 0.02, r * 0.2, r * 0.19, '#2f2430', 0.3);
    eye(ctx, cx + ex, ey - r * 0.06, r * 0.2, r * 0.19, '#2f2430', 0.3);
    stroke(ctx, [cx - ex * 1.5, cy - r * 0.42, cx - ex * 0.34, cy - r * 0.32], '#4a3038', 1.2);
    stroke(ctx, [cx + ex * 1.5, cy - r * 0.46, cx + ex * 0.34, cy - r * 0.36], '#4a3038', 1.2);
    stroke(ctx, [cx - r * 0.06, cy + r * 0.46, cx + r * 0.3, cy + r * 0.4], '#8a4a42', 1.2);
  }
  // nuca (vista de costas): massa de cabelo + gola
  function drawNape(ctx, An, cfg) {
    var h = An.head, r = h[2], p = cfg.pal;
    var c = sh(p.hair, -0.22);
    part(ctx, Pblob([h[0] - r * 0.84, h[1] + r * 0.38, h[0] - r * 0.9, h[1] - r * 0.42,
                     h[0] - r * 0.26, h[1] - r * 0.92, h[0] + r * 0.5, h[1] - r * 0.88,
                     h[0] + r * 0.9, h[1] - r * 0.26, h[0] + r * 0.82, h[1] + r * 0.44]), c, { k: 0.24 });
    stroke(ctx, [h[0] - r * 0.34, h[1] - r * 0.42, h[0] - r * 0.16, h[1] + r * 0.24], sh(c, -0.3), 0.85);
    stroke(ctx, [h[0] + r * 0.28, h[1] - r * 0.46, h[0] + r * 0.4, h[1] + r * 0.2], sh(c, -0.3), 0.85);
  }
  function elfEars(ctx, An, cfg) {
    var h = An.head, r = h[2], p = cfg.pal;
    part(ctx, Ppoly([h[0] - r * 0.86, h[1] - r * 0.02, h[0] - r * 1.66, h[1] - r * 0.78,
                     h[0] - r * 0.8, h[1] + r * 0.32]), An.skin, { k: 0.24, lw: 0.85 });
    part(ctx, Ppoly([h[0] + r * 0.88, h[1] - r * 0.06, h[0] + r * 1.7, h[1] - r * 0.82,
                     h[0] + r * 0.82, h[1] + r * 0.28]), An.skin, { k: 0.24, lw: 0.85 });
  }
  // crânio padrão (oval). O rosto vem depois, em paintUnit.
  function drawHead(ctx, An, cfg) {
    var h = An.head, r = h[2];
    part(ctx, Pcap(An.neck[0], An.neck[1] + 3, r * 0.42, h[0], h[1] + r * 0.5, r * 0.5),
         sh(An.skin, -0.1), { k: 0.2, lw: 0.85 });
    part(ctx, Pel(h[0], h[1], r, r * 1.04), An.skin, { k: 0.2, hi: 0.18 });
    if (cfg.acc.ears) elfEars(ctx, An, cfg);
    if (cfg.back) drawNape(ctx, An, cfg);
  }

  // ==========================================================================
  // AS SEIS CLASSES — plano de corpo + pintura
  // Cada plano devolve ÂNCORAS; o resto (acessórios, elemento, fusão) se apoia
  // nelas, o que permite montar qualquer combinação sem redesenhar nada.
  // ==========================================================================
  var PLANS = {};

  // ------------------------------------------------------------------- SUMÔ
  PLANS.sumo = {
    face: 'grim',
    anchors: function (cfg) {
      var p = cfg.pal;
      var An = { h: 104, wide: 30, skin: mx(p.skin, p.el.c, p.elId === 'neutro' ? 0 : 0.1) };
      An.head = [3, -88, 14.5]; An.neck = [2, -76]; An.chest = [0, -64];
      An.hipY = -34; An.hipC = [0, -38]; An.backC = [-3, -60];
      An.shN = [24, -70]; An.shF = [-22, -70];
      An.armN = { sh: [23, -70], el: [37, -58], hd: [31, -42], r0: 7.6, r1: 6.2, hr: 7.8 };
      An.armF = { sh: [-21, -70], el: [-35, -60], hd: [-30, -46], r0: 7.2, r1: 5.9, hr: 7.2 };
      An.legN = { hip: [14, -34], knee: [22, -17], ank: [18, -5], r0: 9.6, r1: 7.4, foot: [19, -1, 15, 5] };
      An.legF = { hip: [-14, -34], knee: [-23, -18], ank: [-20, -6], r0: 9.2, r1: 7.1, foot: [-21, -2, 14, 4.6] };
      An.armCol = An.skin; An.legCol = An.skin; An.handCol = An.skin;
      An.footCol = mx(p.dark, An.skin, 0.25);
      An.handN = An.armN.hd; An.handF = An.armF.hd;
      return An;
    },
    torso: function (ctx, An, cfg) {
      var s = An.skin;
      part(ctx, Pblob([-30, -50, -27, -70, -14, -80, 0, -82, 15, -80, 27, -70,
                       30, -50, 25, -32, 0, -27, -25, -32]), s, { k: 0.22, hi: 0.14, rot: LIGHT });
      // barriga e peitoral: duas linhas soltas dão o volume sem sujar
      stroke(ctx, [-19, -63, 0, -58, 20, -63], sh(s, -0.3), 0.9, true);
      stroke(ctx, [-12, -44, 0, -40, 12, -45], sh(s, -0.26), 0.8, true);
      part(ctx, Pel(-3, -44, 2.6, 2.0), sh(s, -0.3), { flat: true, lw: 0.6, line: sh(s, -0.34) });
    },
    head: function (ctx, An, cfg) {
      var h = An.head, r = h[2];
      // bochechas de lutador
      part(ctx, Pel(h[0], h[1] + r * 0.12, r * 1.06, r * 0.98), An.skin, { k: 0.2, hi: 0.16 });
      part(ctx, Pel(h[0] - r * 0.78, h[1] + r * 0.34, r * 0.34, r * 0.28), sh(An.skin, -0.06), { k: 0.16, lw: 0.7 });
      part(ctx, Pel(h[0] + r * 0.82, h[1] + r * 0.3, r * 0.34, r * 0.28), sh(An.skin, -0.06), { k: 0.16, lw: 0.7 });
      if (cfg.acc.ears) elfEars(ctx, An, cfg);
      if (cfg.back) drawNape(ctx, An, cfg);
    }
  };

  // ------------------------------------------------------------ ELFO ARQUEIRO
  PLANS.arqueiro = {
    face: 'sharp',
    anchors: function (cfg) {
      var p = cfg.pal;
      var An = { h: 108, wide: 17, skin: mx(p.skin, p.el.c, p.elId === 'neutro' ? 0 : 0.08) };
      An.head = [3, -92, 11]; An.neck = [2, -80]; An.chest = [0, -70];
      An.hipY = -50; An.hipC = [0, -52]; An.backC = [-2, -66];
      An.shN = [15, -76]; An.shF = [-13, -76];
      An.armN = { sh: [14, -76], el: [24, -66], hd: [19, -55], r0: 4.6, r1: 3.7, hr: 4.8 };
      An.armF = { sh: [-13, -76], el: [-21, -66], hd: [-17, -54], r0: 4.3, r1: 3.5, hr: 4.5 };
      An.legN = { hip: [8, -50], knee: [11, -27], ank: [10, -5], r0: 5.6, r1: 4.2, foot: [11, -1, 13, 5] };
      An.legF = { hip: [-8, -50], knee: [-13, -28], ank: [-13, -6], r0: 5.4, r1: 4.0, foot: [-14, -2, 12, 4.6] };
      An.armCol = mx(p.main, p.cloth, 0.4); An.legCol = mx(p.dark, p.main, 0.24);
      An.handCol = An.skin; An.footCol = p.leather;
      An.handN = An.armN.hd; An.handF = An.armF.hd;
      return An;
    },
    torso: function (ctx, An, cfg) {
      var p = cfg.pal;
      part(ctx, Pblob([-16, -60, -15, -76, -6, -82, 6, -82, 15, -76, 16, -60,
                       12, -46, 0, -43, -12, -46]), p.main, { k: 0.24, hi: 0.14, rot: LIGHT });
      // gola em folha
      part(ctx, Ppoly([-9, -80, 0, -74, 9, -80, 6, -70, -6, -70]), mx(p.main, p.accent, 0.4), { k: 0.2, lw: 0.85 });
      stroke(ctx, [0, -72, 0, -48], sh(p.main, -0.28), 0.8);
    },
    head: function (ctx, An, cfg) {
      drawHead(ctx, An, cfg);
    }
  };

  // ------------------------------------------------------------------ BRUXO
  PLANS.bruxo = {
    face: 'glow',
    anchors: function (cfg) {
      var p = cfg.pal;
      var An = { h: 100, wide: 22, skin: p.skin };
      An.head = [2, -84, 11]; An.neck = [1, -73]; An.chest = [0, -66];
      An.hipY = -48; An.hipC = [0, -50]; An.backC = [-2, -62];
      An.shN = [15, -70]; An.shF = [-13, -70];
      An.armN = { sh: [14, -70], el: [24, -60], hd: [20, -50], r0: 5.8, r1: 4.6, hr: 4.8 };
      An.armF = { sh: [-13, -70], el: [-22, -61], hd: [-18, -50], r0: 5.5, r1: 4.4, hr: 4.5 };
      An.legN = null; An.legF = null;    // manto até o chão
      An.armCol = mx(p.main, p.cloth, 0.5); An.handCol = An.skin;
      An.handN = An.armN.hd; An.handF = An.armF.hd;
      return An;
    },
    torso: function (ctx, An, cfg) {
      var p = cfg.pal, c = mx(p.main, p.cloth, 0.3);
      // sino do manto: a silhueta que identifica o mago de longe
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-14, -70);
        g.quadraticCurveTo(-19, -40, -25, -6);
        g.quadraticCurveTo(-12, 1, 0, -1);
        g.quadraticCurveTo(13, 1, 25, -6);
        g.quadraticCurveTo(19, -40, 14, -70);
        g.quadraticCurveTo(0, -76, -14, -70);
        g.closePath();
      }, 0, -36, 26), c, { k: 0.22, hi: 0.1, rot: LIGHT });
      stroke(ctx, [-8, -62, -12, -34, -15, -4], sh(c, -0.26), 0.9, true);
      stroke(ctx, [9, -62, 13, -34, 16, -5], sh(c, -0.26), 0.9, true);
      // barra iluminada
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-25, -6); g.quadraticCurveTo(0, 2, 25, -6);
        g.quadraticCurveTo(0, -3, -25, -6); g.closePath();
      }, 0, -4, 25), p.accent, { k: 0.18, lw: 0.8 });
    },
    head: function (ctx, An, cfg) {
      drawHead(ctx, An, cfg);
    }
  };

  // ------------------------------------------------------------- ESPADACHIM
  PLANS.espadachim = {
    face: 'grin',
    anchors: function (cfg) {
      var p = cfg.pal;
      var An = { h: 104, wide: 17, skin: p.skin };
      An.head = [5, -90, 11]; An.neck = [4, -78]; An.chest = [2, -68];
      An.hipY = -48; An.hipC = [1, -50]; An.backC = [-1, -64];
      An.shN = [16, -74]; An.shF = [-11, -74];
      An.armN = { sh: [15, -74], el: [26, -66], hd: [24, -53], r0: 4.7, r1: 3.8, hr: 4.8 };
      An.armF = { sh: [-11, -74], el: [-21, -64], hd: [-15, -52], r0: 4.4, r1: 3.6, hr: 4.5 };
      An.legN = { hip: [9, -48], knee: [16, -26], ank: [17, -5], r0: 5.6, r1: 4.2, foot: [18, -1, 14, 6] };
      An.legF = { hip: [-7, -48], knee: [-14, -28], ank: [-17, -6], r0: 5.4, r1: 4.0, foot: [-18, -2, 13, 5.4] };
      An.armCol = mx(p.cloth, p.dark, 0.3); An.legCol = mx(p.dark, p.main, 0.3);
      An.handCol = An.skin; An.footCol = mx(p.dark, '#000', 0.1);
      An.handN = An.armN.hd; An.handF = An.armF.hd;
      return An;
    },
    torso: function (ctx, An, cfg) {
      var p = cfg.pal;
      part(ctx, Pblob([-13, -58, -13, -74, -4, -80, 8, -80, 17, -74, 16, -58,
                       12, -46, 1, -43, -10, -46]), p.main, { k: 0.24, hi: 0.14, rot: LIGHT });
      // lapelas cruzadas
      part(ctx, Ppoly([-6, -78, 3, -70, 12, -78, 10, -50, -4, -50]), mx(p.main, p.dark, 0.42), { k: 0.22, lw: 0.85 });
      stroke(ctx, [-4, -74, 3, -68, 11, -74], p.accent, 0.8, true);
    },
    head: function (ctx, An, cfg) {
      drawHead(ctx, An, cfg);
    }
  };

  // ------------------------------------------------------------- CURANDEIRA
  PLANS.curandeira = {
    face: 'cute',
    anchors: function (cfg) {
      var p = cfg.pal;
      var An = { h: 80, wide: 15, skin: p.skin };
      An.head = [2, -58, 17]; An.neck = [2, -42]; An.chest = [0, -38];
      An.hipY = -26; An.hipC = [0, -28]; An.backC = [-2, -38];
      An.shN = [11, -40]; An.shF = [-9, -40];
      An.armN = { sh: [10, -40], el: [17, -34], hd: [15, -25], r0: 3.9, r1: 3.2, hr: 4.2 };
      An.armF = { sh: [-9, -40], el: [-16, -33], hd: [-13, -25], r0: 3.7, r1: 3.0, hr: 3.9 };
      An.legN = { hip: [6, -18], knee: [8, -10], ank: [8, -4], r0: 3.8, r1: 3.2, foot: [8, -1, 10, 4.4] };
      An.legF = { hip: [-6, -18], knee: [-9, -11], ank: [-9, -5], r0: 3.6, r1: 3.0, foot: [-10, -2, 9, 4] };
      An.armCol = mx(p.cloth, p.main, 0.35); An.legCol = '#f4ead6';
      An.handCol = An.skin; An.footCol = p.leather;
      An.handN = An.armN.hd; An.handF = An.armF.hd;
      return An;
    },
    torso: function (ctx, An, cfg) {
      var p = cfg.pal, c = mx(p.cloth, p.main, 0.3);
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-9, -42);
        g.quadraticCurveTo(-14, -28, -18, -6);
        g.quadraticCurveTo(-8, 0, 0, -1);
        g.quadraticCurveTo(9, 0, 18, -6);
        g.quadraticCurveTo(14, -28, 9, -42);
        g.quadraticCurveTo(0, -46, -9, -42);
        g.closePath();
      }, 0, -24, 19), c, { k: 0.22, hi: 0.12, rot: LIGHT });
      part(ctx, tag(function (g) {
        g.beginPath(); g.moveTo(-18, -6); g.quadraticCurveTo(0, 2, 18, -6);
        g.quadraticCurveTo(0, -3, -18, -6); g.closePath();
      }, 0, -4, 18), p.accent, { k: 0.18, lw: 0.8 });
      stroke(ctx, [-4, -40, -6, -22, -7, -6], sh(c, -0.24), 0.8, true);
    },
    head: function (ctx, An, cfg) {
      drawHead(ctx, An, cfg);
    }
  };

  // -------------------------------------------------------------- INVOCADOR
  PLANS.invocador = {
    face: 'mask',
    anchors: function (cfg) {
      var p = cfg.pal;
      var An = { h: 100, wide: 20, skin: p.skin };
      An.head = [2, -82, 12]; An.neck = [1, -71]; An.chest = [0, -64];
      An.hipY = -44; An.hipC = [0, -46]; An.backC = [-2, -62];
      An.shN = [16, -70]; An.shF = [-14, -70];
      An.armN = { sh: [15, -70], el: [26, -62], hd: [23, -51], r0: 5.6, r1: 4.4, hr: 4.6 };
      An.armF = { sh: [-14, -70], el: [-24, -62], hd: [-19, -52], r0: 5.3, r1: 4.2, hr: 4.3 };
      An.legN = null; An.legF = null;
      An.armCol = mx(p.cloth, p.main, 0.28); An.handCol = An.skin;
      An.handN = An.armN.hd; An.handF = An.armF.hd;
      return An;
    },
    torso: function (ctx, An, cfg) {
      var p = cfg.pal, c = mx(p.cloth, p.dark, 0.2), i;
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-15, -68);
        g.quadraticCurveTo(-20, -38, -23, -5);
        g.quadraticCurveTo(-11, 1, 0, -1);
        g.quadraticCurveTo(12, 1, 23, -5);
        g.quadraticCurveTo(20, -38, 15, -68);
        g.quadraticCurveTo(0, -74, -15, -68);
        g.closePath();
      }, 0, -36, 24), c, { k: 0.22, hi: 0.1, rot: LIGHT });
      // franjas de cordinha com contas
      for (i = -1; i <= 1; i++) {
        stroke(ctx, [i * 8, -56, i * 9.5, -46, i * 9, -36], sh(c, -0.3), 0.7, true);
        part(ctx, Pel(i * 9, -35, 2.0, 2.0), p.accent, { k: 0.16, lw: 0.6 });
      }
    },
    head: function (ctx, An, cfg) {
      drawHead(ctx, An, cfg);
    }
  };

  // ==========================================================================
  // KITS por classe e MONTAGEM DE FUSÃO
  // Base = classe de corpo mais marcante (rank); a outra entra pelos adereços.
  // Cobre as 15 duplas sem desenhar nenhuma à mão.
  // ==========================================================================
  var KIT = {
    sumo:       { head: 'topknot', torso: 'mawashi', weapon: null,    back: null,     face: 'grim',  ears: false },
    arqueiro:   { head: 'hood',    torso: 'baldric', weapon: 'bow',   back: 'quiver', face: 'sharp', ears: true },
    bruxo:      { head: 'wizhat',  torso: 'robe',    weapon: 'staff', back: 'cape',   face: 'glow',  ears: false },
    espadachim: { head: 'bandana', torso: 'sash',    weapon: 'sword', back: 'scarf',  face: 'grin',  ears: false },
    curandeira: { head: 'buns',    torso: 'apron',   weapon: 'wand',  back: null,     face: 'cute',  ears: false },
    invocador:  { head: 'mask',    torso: 'tabard',  weapon: 'tome',  back: 'totem',  face: 'mask',  ears: false }
  };
  // quanto o corpo da classe é "dono" da silhueta
  var BODY_RANK = { sumo: 6, arqueiro: 4, espadachim: 3.5, curandeira: 3, bruxo: 2.5, invocador: 2 };
  A.KIT = KIT;

  function baseCfg(classId, els) {
    var k = KIT[classId] || KIT.sumo;
    return {
      base: PLANS[classId] ? classId : 'sumo',
      pal: classPal(classId, els),
      acc: { head: k.head, torso: k.torso, weapon: k.weapon, back: k.back, face: k.face, ears: k.ears },
      fusion: false
    };
  }
  function fusionCfg(ca, cb, els) {
    var ra = BODY_RANK[ca] || 1, rb = BODY_RANK[cb] || 1;
    var dom = (ra > rb || (ra === rb && ca < cb)) ? ca : cb;
    var rec = dom === ca ? cb : ca;
    var kd = KIT[dom] || KIT.sumo, kr = KIT[rec] || KIT.sumo;
    // paleta: corpo do dominante puxado para a cor do recessivo + os 2 elementos
    var pd = classPal(dom, els), pr = classPal(rec, [els[1] || els[0]]);
    var pal = pd;
    pal.main = mx(pd.main, pr.main, 0.38);
    pal.cloth = mx(pd.cloth, pr.cloth, 0.45);
    pal.accent = mx(pd.accent, pr.accent, 0.5);
    pal.hair = pd.hair; pal.wood = mx(pd.wood, pr.wood, 0.4);
    pal.line = lineOf(pal.main);
    return {
      base: PLANS[dom] ? dom : 'sumo',
      pal: pal,
      acc: {
        // a máscara do invocador esconde o rosto: só vale quando ELE é o corpo
        head: (kr.head === 'mask' && dom !== 'invocador') ? kd.head : (kr.head || kd.head),
        torso: kd.torso,
        torso2: kr.torso !== kd.torso ? kr.torso : null,
        weapon: kr.weapon || kd.weapon,
        back: kr.back || kd.back,
        stow: kr.weapon && kd.weapon ? kd.weapon : null,
        stowBack: kr.back && kd.back && kr.back !== kd.back ? kd.back : null,
        face: kd.face === 'mask' && kr.face !== 'mask' ? kr.face : kd.face,
        ears: kd.ears || kr.ears
      },
      fusion: true, dom: dom, rec: rec
    };
  }

  // -------------------------------------------------------------- montagem
  function drawBackItems(ctx, An, cfg) {
    if (cfg.acc.stowBack && ACC.back[cfg.acc.stowBack]) ACC.back[cfg.acc.stowBack](ctx, An, cfg);
    if (cfg.acc.back && ACC.back[cfg.acc.back]) ACC.back[cfg.acc.back](ctx, An, cfg);
    if (cfg.acc.stow) drawStowed(ctx, An, cfg, cfg.acc.stow);
  }

  function paintUnit(ctx, cfg) {
    var P = PLANS[cfg.base] || PLANS.sumo;
    var An = P.anchors(cfg);
    An.cfg = cfg;
    var wp = cfg.acc.weapon && ACC.weapon[cfg.acc.weapon] ? ACC.weapon[cfg.acc.weapon] : null;

    elemBack(ctx, An, cfg);
    if (!cfg.back) drawBackItems(ctx, An, cfg);
    else if (wp) { ctx.save(); ctx.globalAlpha = 0.95; wp(ctx, An, cfg, An.handN[0], An.handN[1]); ctx.restore(); }

    if (An.legF) drawLeg(ctx, An.legF, sh(An.legCol, -0.12), sh(An.footCol, -0.12));
    drawArm(ctx, An.armF, sh(An.armCol, -0.12));
    drawHand(ctx, An.armF, sh(An.handCol, -0.12));

    P.torso(ctx, An, cfg);
    if (An.legN) drawLeg(ctx, An.legN, An.legCol, An.footCol);

    if (cfg.acc.torso && ACC.torso[cfg.acc.torso]) ACC.torso[cfg.acc.torso](ctx, An, cfg);
    if (cfg.acc.torso2 && ACC.torso[cfg.acc.torso2]) ACC.torso[cfg.acc.torso2](ctx, An, cfg);

    var hg = (cfg.acc.head && ACC.head[cfg.acc.head]) || null;
    if (hg && hg.behind) hg.behind(ctx, An, cfg);
    P.head(ctx, An, cfg);
    if (hg && hg.front) hg.front(ctx, An, cfg);
    if (!cfg.back && !(hg && hg.hideFace)) drawFace(ctx, An, cfg, cfg.acc.face || P.face || 'sharp');

    drawArm(ctx, An.armN, An.armCol);
    if (!cfg.back && wp) wp(ctx, An, cfg, An.handN[0], An.handN[1]);
    drawHand(ctx, An.armN, An.handCol);

    if (cfg.back) drawBackItems(ctx, An, cfg);
    elemFront(ctx, An, cfg);
    return An;
  }

  // ==========================================================================
  // MONSTROS E PETS — gerador por arquétipo.
  // Enquanto DATA.monsters/DATA.pets não existirem (ou trouxerem bichos novos),
  // o arquétipo sai de palavras-chave do id/nome e, em último caso, do hash:
  // nunca aparece um quadrado cinza no tabuleiro.
  // ==========================================================================
  // 9 arquétipos. A ordem da lista É a prioridade de casamento: o primeiro que
  // bater vence, então o mais específico vem antes (planta antes de fera para
  // 'Brotinho-Voraz'; pedra antes de bruto para 'Sentinela de Pedra').
  var ARCH = ['blob', 'fera', 'inseto', 'espirito', 'bruto', 'planta', 'pedra', 'ave', 'verme'];
  var ARCH_WORDS = [
    ['planta', /raiz|planta|flor|cipo|cipó|vinha|broto|semente|fungo|cogumelo|espor|musgo|trepad|carrapich|verga|jardin|seiv|p[óo]len|thorn|root|vine|sprout|seed|bloom|spore|pollen|burr|leaf|garden|sap\b/i],
    ['blob', /lodo|limo|gosma|blob|slime|lama|geleia|gota|gotinha|escorr|monte de|[áa]gua-viva|jelly|ooze|sludge|slag|drop|droplet|goo|seep|mound|\bdamp/i],
    ['verme', /verme|lombriga|serpe|serpente|cobra|enguia|moreia|larva|worm|snake|eel|moray|slither/i],
    ['ave', /p[aá]ssaro|falc[aã]o|[aá]guia|morcego|corvo|coruja|\basas?\b|\bpenas?\b|pican[çc]o|cantarol|\bcoro\b|assobio|bird|falcon|hawk|eagle|\bbat\b|crow|owl|shrike|warbler|choir|whistle|piper|\bwing/i],
    ['inseto', /inseto|besouro|aranha|escorpi|mosca|traca|traça|casulo|ferr[ãa]o|centop|vespa|formig|caranguejo|wasp|spider|beetle|mite|roach|moth|\bcrab\b|ant-/i],
    ['espirito', /esp[ií]rito|alma|\beco\b|fantasma|sopro|brilho|f[aá]tuo|nevoa|névoa|sombra|assombr|cinza|cinzent|espelho|g[êe]meo|estilha|\bmote|fogar[ée]u|familiar|cora[çc][ãa]o|ninfa|pregolim|wraith|wisp|ghost|spirit|revenant|phantom|shade|mirror|sliver|\bash|firedamp|rift(?!.*forge)|nymph|sprite/i],
    ['pedra', /pedra|rocha|golem|cristal|est[aá]tua|entulho|escombro|granito|mineral|laje|min[ée]rio|lasca|alicerce|bigorna|seixo|stone|rock|crystal|\bore\b|slate|boulder|anvil|lodestone|ballast/i],
    ['fera', /lobo|c[aã]o\b|cão|rato|fera|bicho|garra|presa|javali|peixe|caranguejo|bocarra|ti[çc][ãa]o|fagulha|gremlin|voraz|hound|wolf|beast|fang|claw|crab|jaw|imp\b|whelp|feral/i],
    ['bruto', /guarda|bruto|carrasco|gigante|capataz|soldado|mestre|senhor|rei|rainha|campe|ferreiro|zelador|colosso|sentinela|arauto|baron|xam[ãa]|enforca|puxa|bate|acendedor|smith|warden|colossus|sentinel|porter|hauler|herald|wright|forge|knock|shaman|hanger|revenant/i]
  ];
  function archOf(defId, md) {
    if (md && md.archetype && ARCH.indexOf(md.archetype) >= 0) return md.archetype;
    var s = defId + ' ' + ((md && md.name) || '');
    for (var i = 0; i < ARCH_WORDS.length; i++) if (ARCH_WORDS[i][1].test(s)) return ARCH_WORDS[i][0];
    return ARCH[hash(defId) % ARCH.length];
  }
  function creaturePal(defId, md, els) {
    var el = (md && md.element) || (els && els[0]) || null;
    var rd = rng(defId + 'pal');
    var base;
    if (el && el !== 'neutro') base = elemInfo(el).c;
    else base = ['#8a9a6a', '#9a7a5a', '#7a8a9a', '#9a6a7a', '#6a8a8a'][Math.floor(rd() * 5)];
    var p = {
      main: vivid(base, 0.08),
      dark: sh(base, -0.5),
      accent: el && el !== 'neutro' ? elemInfo(el).glow : sh(base, 0.42),
      skin: base, el: elemInfo(el || 'neutro'), elId: el || 'neutro',
      cloth: sh(base, -0.34), metal: '#c2cbd6', leather: '#8a5a34', wood: '#9a6b3f',
      hair: sh(base, -0.55)
    };
    p.line = lineOf(p.main);
    return p;
  }
  // olhos "de desenho" reaproveitáveis para bichos
  function critterEyes(ctx, x, y, r, n, spread, col) {
    var i, k;
    for (i = 0; i < (n || 2); i++) {
      k = (n || 2) === 1 ? 0 : (i / ((n || 2) - 1) - 0.5) * 2;
      part(ctx, Pel(x + k * spread, y - Math.abs(k) * r * 0.3, r, r * 1.1), '#fdfaf2', { k: 0.12, lw: 0.8 });
      flat(ctx, Pel(x + k * spread + r * 0.22, y - Math.abs(k) * r * 0.3, r * 0.46, r * 0.6), col || '#241c22');
      flat(ctx, Pel(x + k * spread + r * 0.06, y - Math.abs(k) * r * 0.3 - r * 0.34, r * 0.2, r * 0.22), 'rgba(255,255,255,0.9)');
    }
  }
  function paintCreature(ctx, defId, md, cfg) {
    var p = cfg.pal, a = cfg.arch, rd = rng(defId), i, ang;
    var big = cfg.boss ? 1.24 : 1;
    var H = (cfg.boss ? 92 : 62) * (md && md.scale ? md.scale : 1);
    // Variação por id: dois bichos do mesmo arquétipo nunca saem idênticos.
    // vw/vh mexem na proporção (gordo/magro, alto/baixo) e vd escolhe o
    // detalhe contável (nº de dentes, caudas, patas, pontas…).
    var vr = rng(defId + '#var');
    var vw = 0.86 + vr() * 0.34, vh = 0.88 + vr() * 0.3, vd = vr(), vd2 = vr();
    var nd = 3 + Math.floor(vd * 4);          // 3..6 elementos repetidos
    ctx.save(); ctx.scale(big * vw, big * vh);
    if (a === 'blob') {
      var bt = 1 + vd2 * 0.34;                    // quão "alto" o pingo é
      part(ctx, Pel(0, -6, 30, 8), rgba(p.dark, 0.35), { flat: true, noline: true });
      part(ctx, Pblob([-30, -14, -26, -38 * bt, -8, -48 * bt, 12, -46 * bt,
                       28, -34 * bt, 30, -12, 12, -3, -12, -3]),
           p.main, { k: 0.24, hi: 0.16 });
      for (i = 0; i < nd; i++) {                  // pingos escorrendo
        part(ctx, Pel(-16 + i * (32 / nd), -3, 8 - i * 1.2, 3.4), sh(p.main, -0.16), { k: 0.16, lw: 0.75 });
      }
      critterEyes(ctx, 2, -32 * bt, 6.4, vd2 > 0.72 ? 3 : 2, 10);
      stroke(ctx, [-6, -20 * bt, 2, -15 * bt, 11, -20 * bt], sh(p.main, -0.42), 1, true);
    } else if (a === 'fera') {
      part(ctx, Pcap(-16, -26, 13, 18, -30, 11), p.main, { k: 0.24, hi: 0.12 });
      for (i = 0; i < 4; i++) {
        var lx = -18 + (i % 2) * 30, ly = -4 - Math.floor(i / 2) * 2;
        part(ctx, Pcap(lx + 2, -20, 4.6, lx, ly, 3.6), i < 2 ? sh(p.main, -0.14) : p.main, { k: 0.22, lw: 0.9 });
        part(ctx, Pel(lx - 1, ly + 1, 5.4, 2.8), p.dark, { k: 0.2, lw: 0.8 });
      }
      part(ctx, Pel(24, -38, 12.5, 11), p.main, { k: 0.22, hi: 0.14 });
      part(ctx, Pcap(28, -34, 7, 38, -30, 4.4), sh(p.main, 0.06), { k: 0.22, lw: 0.9 });
      part(ctx, Pel(39, -30, 2.6, 2.2), p.dark, { k: 0.16, lw: 0.7 });
      var oe = 46 + vd2 * 16;                     // orelhas curtas ou compridas
      part(ctx, Ppoly([18, -oe, 14, -oe - 12, 26, -oe - 4]), sh(p.main, -0.1), { k: 0.24, lw: 0.9 });
      part(ctx, Ppoly([30, -oe, 34, -oe - 12, 38, -oe]), sh(p.main, -0.1), { k: 0.24, lw: 0.9 });
      critterEyes(ctx, 27, -40, 3.6, 2, 6);
      part(ctx, Pcap(-28, -28, 4, -40 - vd * 8, -40 + vd * 14, 2), sh(p.main, -0.12), { k: 0.22, lw: 0.9 });
      if (vd2 > 0.55) {                           // metade das feras tem placas nas costas
        for (i = 0; i < 3; i++) {
          part(ctx, Ppoly([-10 + i * 11, -38, -6 + i * 11, -50 - i, -2 + i * 11, -38]),
               sh(p.main, -0.2), { k: 0.2, lw: 0.8 });
        }
      }
    } else if (a === 'inseto') {
      for (i = 0; i < 6; i++) {
        ang = -0.5 + (i % 3) * 0.5;
        var sx = i < 3 ? -1 : 1;
        stroke(ctx, [sx * 10, -26, sx * (22 + (i % 3) * 5), -30 + (i % 3) * 4, sx * (26 + (i % 3) * 6), -2],
               sh(p.dark, 0.1), 1.1, true);
      }
      part(ctx, Pel(-10, -24, 16, 13, -0.2), p.main, { k: 0.24, hi: 0.12 });
      part(ctx, Pel(8, -30, 12, 11), sh(p.main, 0.06), { k: 0.22 });
      part(ctx, Pel(22, -36, 9.5, 8.5), p.main, { k: 0.22, hi: 0.14 });
      stroke(ctx, [24, -44, 30, -54, 36, -52], p.dark, 1, true);
      stroke(ctx, [20, -44, 20, -56, 27, -58], p.dark, 1, true);
      critterEyes(ctx, 24, -37, 3.2, 2, 5.5, p.dark);
      part(ctx, Ppoly([-24, -26, -38, -34, -26, -18]), p.accent, { k: 0.2, lw: 0.85 });
    } else if (a === 'espirito') {
      glow(ctx, 0, -34, 34, p.accent, 0.4);
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(-20, -30);
        g.quadraticCurveTo(-22, -58, 0, -60);
        g.quadraticCurveTo(22, -58, 20, -30);
        g.quadraticCurveTo(16, -14, 8, -6);
        g.quadraticCurveTo(0, 2, -8, -8);
        g.quadraticCurveTo(-18, -16, -20, -30);
        g.closePath();
      }, 0, -32, 24), mx(p.main, '#f2f6ff', 0.2), { k: 0.2, hi: 0.16 });
      for (i = 0; i < 3; i++) {
        stroke(ctx, [-14 + i * 13, -8, -12 + i * 13, 2, -16 + i * 13, 8], rgba(p.accent, 0.7), 1, true);
      }
      critterEyes(ctx, 1, -40, 5.2, 2, 8.5, p.dark);
    } else if (a === 'bruto') {
      part(ctx, Pcap(-14, -18, 9, -13, -3, 7), p.dark, { k: 0.22 });
      part(ctx, Pcap(14, -18, 9, 15, -3, 7), p.dark, { k: 0.22 });
      part(ctx, Pblob([-24, -30, -20, -54, 0, -62, 20, -54, 24, -30, 14, -14, -14, -14]),
           p.main, { k: 0.24, hi: 0.12 });
      part(ctx, Pcap(-22, -50, 7, -32, -24, 6), sh(p.main, -0.12), { k: 0.22 });
      part(ctx, Pcap(22, -50, 7, 33, -26, 6), p.main, { k: 0.22 });
      part(ctx, Pel(-34, -20, 7, 6.6), sh(p.main, -0.1), { k: 0.2 });
      part(ctx, Pel(35, -22, 7, 6.6), p.main, { k: 0.2 });
      part(ctx, Pel(2, -68, 12, 11), p.skin, { k: 0.2, hi: 0.14 });
      critterEyes(ctx, 3, -69, 3.4, 2, 5.6);
      stroke(ctx, [-4, -62, 3, -59, 10, -62], sh(p.skin, -0.4), 1, true);
      part(ctx, Prr(2, -78, 20, 6, 2), p.cloth, { k: 0.24, lw: 0.9 });
    } else if (a === 'planta') {
      part(ctx, Pel(0, -4, 24, 7), sh(p.dark, 0.1), { k: 0.2 });
      for (i = 0; i < 4; i++) {
        ang = -2.6 + i * 0.62;
        stroke(ctx, [Math.cos(ang) * 8, -6, Math.cos(ang) * 22, -12 - i, Math.cos(ang) * 30, -3],
               sh(p.dark, 0.16), 1.2, true);
      }
      part(ctx, Pcap(0, -10, 6.5, 3, -44, 5.4), mx(p.main, '#4a7a32', 0.4), { k: 0.24 });
      part(ctx, tag(function (g) {
        g.beginPath();
        g.moveTo(3, -44);
        g.quadraticCurveTo(-20, -52, -18, -66);
        g.quadraticCurveTo(-8, -78, 6, -76);
        g.quadraticCurveTo(22, -70, 20, -54);
        g.quadraticCurveTo(14, -44, 3, -44);
        g.closePath();
      }, 2, -60, 20), p.main, { k: 0.24, hi: 0.14 });
      // dentes
      for (i = 0; i < 5; i++) {
        part(ctx, Ppoly([-16 + i * 8, -50, -12 + i * 8, -42, -8 + i * 8, -50]), '#f4ecd8', { k: 0.14, lw: 0.7 });
      }
      part(ctx, Pel(-6, -64, 3.6, 3.8), p.accent, { k: 0.16, lw: 0.8 });
      part(ctx, Pel(9, -66, 3.6, 3.8), p.accent, { k: 0.16, lw: 0.8 });
      part(ctx, Ppoly([-22, -18, -38, -26, -24, -8]), mx(p.main, '#4a7a32', 0.55), { k: 0.22, lw: 0.9 });
      part(ctx, Ppoly([24, -20, 40, -30, 26, -10]), mx(p.main, '#4a7a32', 0.4), { k: 0.22, lw: 0.9 });
    } else if (a === 'ave') {
      // pássaro roliço pousado: corpo oval, peito claro, bico triangular, cauda em leque
      part(ctx, Pcap(-6, -2, 3.2, -9, -22, 2.6), p.dark, { k: 0.2, lw: 0.85 });
      part(ctx, Pcap(8, -2, 3.2, 6, -22, 2.6), p.dark, { k: 0.2, lw: 0.85 });
      for (i = 0; i < 4; i++) {                       // leque da cauda
        part(ctx, Ppoly([-16, -34, -34 - i * 3, -40 - i * 7, -18, -28 + i * 2]),
             i % 2 ? sh(p.main, -0.14) : p.main, { k: 0.22, lw: 0.9 });
      }
      part(ctx, Pel(-1, -34, 20, 22, -0.14), p.main, { k: 0.24, hi: 0.14 });
      part(ctx, Pel(3, -30, 11, 13), sh(p.main, 0.34), { k: 0.16, lw: 0.9 });   // peito
      part(ctx, Pel(-4, -38, 12.5, 10, -0.5), sh(p.main, -0.1), { k: 0.22 });   // asa dobrada
      stroke(ctx, [-12, -42, -2, -36, 6, -34], p.dark, 1, true);
      part(ctx, Pel(12, -52, 11, 10.5), p.main, { k: 0.22, hi: 0.16 });         // cabeça
      part(ctx, Ppoly([20, -54, 34, -50, 20, -46]), mx(p.accent, '#e8a63c', 0.4), { k: 0.22, lw: 0.9 });
      part(ctx, Ppoly([6, -60, 9, -70, 14, -60]), sh(p.main, -0.16), { k: 0.2, lw: 0.85 });  // topete
      critterEyes(ctx, 13, -54, 4, 2, 5.4, p.dark);
    } else if (a === 'verme') {
      // serpe: corpo em S de anéis decrescentes, cabeça com boca e presas
      var segN = 6;
      for (i = segN - 1; i >= 0; i--) {
        var t = i / (segN - 1);
        var sxx = -26 + i * 10 + Math.sin(i * 1.15) * 5;
        var syy = -6 - i * 8 - Math.cos(i * 0.9) * 5;
        part(ctx, Pel(sxx, syy, 15 - t * 5.5, 11 - t * 3.6, -0.2 + Math.sin(i) * 0.3),
             i % 2 ? sh(p.main, -0.12) : p.main, { k: 0.24, hi: 0.12 });
      }
      part(ctx, Pel(22, -50, 14, 11.5, -0.25), p.main, { k: 0.22, hi: 0.16 });
      part(ctx, tag(function (g) {                    // boca aberta
        g.beginPath(); g.moveTo(28, -48); g.quadraticCurveTo(40, -46, 38, -38);
        g.quadraticCurveTo(30, -38, 26, -44); g.closePath();
      }, 32, -44, 8), mx(p.dark, '#7a1e2a', 0.5), { k: 0.16, lw: 0.9 });
      part(ctx, Ppoly([29, -47, 31, -40, 33, -47]), '#f4ecd8', { k: 0.12, lw: 0.7 });
      part(ctx, Ppoly([35, -45, 36, -39, 38, -45]), '#f4ecd8', { k: 0.12, lw: 0.7 });
      critterEyes(ctx, 20, -54, 3.8, 2, 5.6, p.dark);
      stroke(ctx, [18, -62, 24, -72, 30, -66], p.accent, 1.1, true);   // antena
    } else { // pedra
      part(ctx, Pshard(0, -22, 26, defId + 'a'), p.main, { k: 0.28, hi: 0.12 });
      part(ctx, Pshard(-18, -44, 13, defId + 'b'), sh(p.main, 0.08), { k: 0.26 });
      part(ctx, Pshard(19, -40, 11, defId + 'c'), sh(p.main, -0.06), { k: 0.26 });
      part(ctx, Pshard(0, -52, 16, defId + 'd'), p.main, { k: 0.26, hi: 0.14 });
      critterEyes(ctx, 1, -52, 4.4, 2, 7.5, p.dark);
      part(ctx, Pel(-26, -6, 10, 5), sh(p.main, -0.2), { k: 0.24, lw: 0.9 });
      part(ctx, Pel(26, -6, 10, 5), sh(p.main, -0.12), { k: 0.24, lw: 0.9 });
      glow(ctx, 1, -52, 18, p.accent, 0.3);
    }
    // marca elemental
    if (p.elId && p.elId !== 'neutro') {
      var ei = p.el;
      if (p.elId === 'fogo') part(ctx, Pflame(-24, -44, 5, 15, 0.2), ei.c, { k: 0.16, lw: 0.8, line: lineOf(ei.deep) });
      else if (p.elId === 'agua') part(ctx, Pdrop(-24, -46, 4), ei.c, { k: 0.18, lw: 0.8, line: lineOf(ei.deep) });
      else if (p.elId === 'terra') part(ctx, Pshard(-25, -44, 6, 'me'), mx(ei.deep, '#6b5a3a', 0.4), { k: 0.24, lw: 0.85 });
      else if (p.elId === 'ar') part(ctx, Pfeather(-22, -46, 11, -0.7), ei.glow, { k: 0.18, lw: 0.8, line: lineOf(ei.deep) });
    }
    if (cfg.boss) {
      // coroa do chefe: leitura imediata de "esse é o grande"
      part(ctx, Ppoly([-16, -78, -12, -92, -5, -84, 2, -95, 9, -84, 16, -92, 18, -78]),
           '#ffc44d', { k: 0.2, lw: 0.9 });
      glow(ctx, 1, -86, 22, '#ffd98a', 0.4);
    }
    ctx.restore();
    return H;
  }

  // ------------------------------------------------------------------- PETS
  // Cada pet tem CORPO PRÓPRIO (não é o mesmo boneco repintado): o tipo sai de
  // palavras do id/nome/descrição. Todos ficam menores que um herói e com
  // cabeça grande — leitura de "bichinho" mesmo a 40 px.
  // ORDEM = prioridade. Regexes com \b: 'brasa' contém 'asa', 'guia' contém-se
  // em 'águia' — sem borda de palavra um pet cai no corpo errado.
  var PET_KIND = [
    ['dragao', /drag[ãa]o|dragonete|dragonzinho|brasinha|emberling|drake|wyrm|lagart/i],
    ['planta', /\bplanta|vaso|vinha|bocarra|snapvine|carn[íi]vora|\bflor\b|raiz|broto/i],
    ['caco', /\bcaco\b|estilha[çc]o|cristal|shard|\blasca\b|heartshard/i],
    ['gota', /\bgota\b|borbulha|bolha|dewling|orvalho|\bdrop|bubble/i],
    ['seixo', /seixo|pedrinha|pedregulh|\bstone\b|lodestone|rocha|magnetit/i],
    ['ave', /[áa]guia|falc[ãa]o|\bave\b|p[áa]ssaro|hawk|falcon|rasga-ar|\basas?\b|\bpenas?\b|gavi[ãa]o/i]
  ];
  function petKindOf(petId, pd) {
    var s = petId + ' ' + ((pd && pd.name) || '') + ' ' + ((pd && pd.description) || '');
    for (var i = 0; i < PET_KIND.length; i++) if (PET_KIND[i][1].test(s)) return PET_KIND[i][0];
    if (pd && pd.element === 'ar') return 'ave';
    if (pd && pd.element === 'agua') return 'gota';
    if (pd && pd.element === 'terra') return 'planta';
    if (pd && pd.element === 'fogo') return 'dragao';
    return 'seixo';
  }
  function paintPet(ctx, petId, pd, cfg) {
    var p = cfg.pal, i;
    var kind = petKindOf(petId, pd);
    var belly = sh(p.main, 0.36);
    ctx.save(); ctx.scale(0.74, 0.74);

    if (kind === 'dragao') {
      part(ctx, Pcap(-2, -14, 6, -26, -6, 4), sh(p.main, -0.16), { k: 0.2, lw: 0.9 });      // cauda
      part(ctx, Ppoly([-26, -10, -38, -14, -30, -2]), sh(p.main, 0.14), { k: 0.2, lw: 0.85 });
      part(ctx, Pel(-8, -5, 5, 4), sh(p.main, -0.2), { k: 0.2, lw: 0.9 });                  // pés
      part(ctx, Pel(9, -5, 5, 4), sh(p.main, -0.08), { k: 0.2, lw: 0.9 });
      part(ctx, Ppoly([-12, -30, -34, -46, -26, -20]), sh(p.main, 0.12), { k: 0.22, lw: 0.9 });  // asas
      part(ctx, Ppoly([12, -30, 34, -46, 26, -20]), sh(p.main, 0.2), { k: 0.22, lw: 0.9 });
      part(ctx, Pel(0, -20, 15, 14), p.main, { k: 0.24, hi: 0.14 });
      part(ctx, Pel(1, -17, 8.5, 8), belly, { k: 0.14, lw: 0.85 });
      for (i = 0; i < 3; i++) {                                                              // crista
        part(ctx, Ppoly([-4 + i * 5, -32 - i, -2 + i * 5, -42 - i * 2, 2 + i * 5, -32 - i]),
             sh(p.accent, -0.1), { k: 0.18, lw: 0.8 });
      }
      part(ctx, Pel(4, -38, 13, 12), p.main, { k: 0.22, hi: 0.16 });                         // cabeça
      part(ctx, Pel(14, -35, 7, 5.5, 0.15), sh(p.main, 0.1), { k: 0.18, lw: 0.85 });         // focinho
      part(ctx, Pel(18, -36, 1.4, 1.2), p.dark, { flat: true, noline: true });
      part(ctx, Ppoly([-4, -46, -8, -58, 3, -49]), sh(p.main, -0.14), { k: 0.2, lw: 0.85 }); // chifres
      part(ctx, Ppoly([7, -47, 11, -58, 12, -46]), sh(p.main, -0.08), { k: 0.2, lw: 0.85 });
      critterEyes(ctx, 5, -40, 4.4, 2, 6);

    } else if (kind === 'planta') {
      part(ctx, tag(function (g) {                                                           // vaso rachado
        g.beginPath(); g.moveTo(-17, -2); g.lineTo(-13, -22); g.lineTo(13, -22);
        g.lineTo(17, -2); g.closePath();
      }, 0, -12, 18), mx('#a4623c', p.dark, 0.24), { k: 0.24, hi: 0.1 });
      part(ctx, Prr(0, -23, 34, 6, 2), mx('#b56f45', p.dark, 0.2), { k: 0.22, lw: 0.9 });
      stroke(ctx, [-4, -20, -1, -12, -5, -4], sh('#7a4326', -0.2), 1.1, true);               // racho
      part(ctx, Pcap(0, -22, 5.5, 2, -46, 4.6), mx(p.main, '#4f8a34', 0.55), { k: 0.24 });   // caule
      part(ctx, Ppoly([-4, -34, -22, -42, -6, -28]), mx(p.main, '#4f8a34', 0.4), { k: 0.22, lw: 0.9 });
      part(ctx, Ppoly([6, -38, 24, -44, 8, -32]), mx(p.main, '#4f8a34', 0.3), { k: 0.22, lw: 0.9 });
      part(ctx, tag(function (g) {                                                           // cabeça-boca
        g.beginPath(); g.moveTo(2, -46); g.quadraticCurveTo(-19, -54, -16, -66);
        g.quadraticCurveTo(-6, -78, 6, -76); g.quadraticCurveTo(21, -70, 18, -55);
        g.quadraticCurveTo(13, -46, 2, -46); g.closePath();
      }, 1, -60, 19), p.main, { k: 0.24, hi: 0.14 });
      for (i = 0; i < 4; i++) {
        part(ctx, Ppoly([-13 + i * 8, -51, -10 + i * 8, -44, -6 + i * 8, -51]),
             '#f6efdd', { k: 0.12, lw: 0.7 });
      }
      critterEyes(ctx, 1, -64, 4.6, 2, 7.4, p.dark);

    } else if (kind === 'ave') {
      part(ctx, Pcap(-4, -3, 2.6, -6, -18, 2.2), '#e8b23c', { k: 0.18, lw: 0.8 });
      part(ctx, Pcap(6, -3, 2.6, 5, -18, 2.2), '#e8b23c', { k: 0.18, lw: 0.8 });
      for (i = 0; i < 3; i++) {
        part(ctx, Ppoly([-12, -26, -30 - i * 4, -30 - i * 6, -13, -21 + i * 2]),
             i % 2 ? sh(p.main, -0.12) : p.main, { k: 0.22, lw: 0.9 });
      }
      part(ctx, Pel(0, -26, 16, 17, -0.12), p.main, { k: 0.24, hi: 0.14 });
      part(ctx, Pel(4, -23, 9, 10), belly, { k: 0.14, lw: 0.85 });
      part(ctx, Pel(-3, -30, 11, 8.5, -0.55), sh(p.main, -0.12), { k: 0.22 });               // asa
      part(ctx, Pfeather(-14, -40, 13, -0.9), sh(p.main, 0.24), { k: 0.18, lw: 0.85 });
      part(ctx, Pel(10, -42, 10, 9.4), p.main, { k: 0.22, hi: 0.16 });
      part(ctx, Ppoly([17, -44, 30, -40, 17, -37]), '#e8b23c', { k: 0.22, lw: 0.9 });        // bico
      critterEyes(ctx, 11, -44, 4, 2, 5.2, p.dark);

    } else if (kind === 'gota') {
      glow(ctx, 0, -24, 30, p.accent, 0.28);
      part(ctx, Pel(0, -3, 17, 4.6), rgba(p.dark, 0.4), { flat: true, noline: true });
      part(ctx, tag(function (g) {                                                           // gota grande
        g.beginPath(); g.moveTo(0, -56); g.quadraticCurveTo(20, -34, 20, -20);
        g.quadraticCurveTo(20, -3, 0, -3); g.quadraticCurveTo(-20, -3, -20, -20);
        g.quadraticCurveTo(-20, -34, 0, -56); g.closePath();
      }, 0, -24, 22), mx(p.main, '#ffffff', 0.14), { k: 0.2, hi: 0.2 });
      part(ctx, Pel(-7, -32, 4.6, 7, -0.5), 'rgba(255,255,255,0.72)', { flat: true, noline: true });
      part(ctx, Pel(11, -14, 3.4, 3, 0), rgba(p.accent, 0.6), { flat: true, noline: true });
      critterEyes(ctx, 1, -26, 5.4, 2, 8, p.dark);
      stroke(ctx, [-5, -15, 1, -11, 7, -15], sh(p.main, -0.4), 1, true);

    } else if (kind === 'caco') {
      glow(ctx, 0, -28, 32, p.accent, 0.34);
      part(ctx, Pel(0, -3, 15, 4.4), rgba(p.dark, 0.38), { flat: true, noline: true });
      part(ctx, Ppoly([-13, -8, -17, -34, -3, -56, 12, -36, 9, -8]), p.main, { k: 0.28, hi: 0.16 });
      part(ctx, Ppoly([-3, -56, 12, -36, 9, -8, 2, -10]), sh(p.main, -0.16), { flat: true, lw: 0.9 });
      part(ctx, Ppoly([-16, -22, -26, -32, -19, -14]), sh(p.main, 0.18), { k: 0.24, lw: 0.85 });
      part(ctx, Ppoly([12, -28, 23, -38, 15, -18]), sh(p.main, 0.1), { k: 0.24, lw: 0.85 });
      critterEyes(ctx, -1, -28, 4.8, 2, 7, p.dark);
      part(ctx, Pel(-4, -46, 2.2, 3.2, 0.3), 'rgba(255,255,255,0.7)', { flat: true, noline: true });

    } else {  // seixo — pedrinha redonda que flutua um pouco
      part(ctx, Pel(0, -2, 15, 4.4), rgba(p.dark, 0.42), { flat: true, noline: true });
      part(ctx, Pblob([-18, -18, -14, -34, 0, -40, 15, -33, 18, -17, 10, -8, -10, -8]),
           p.main, { k: 0.26, hi: 0.14 });
      part(ctx, Pel(-6, -30, 5.4, 3.4, -0.4), sh(p.main, 0.22), { k: 0.12, lw: 0.8 });
      part(ctx, Pel(9, -14, 3.4, 2.4, 0.5), sh(p.main, -0.18), { k: 0.12, lw: 0.8 });
      for (i = 0; i < 2; i++) {                                                              // pedrinhas orbitando
        part(ctx, Pshard(-22 + i * 44, -30 - i * 8, 5, petId + i), sh(p.main, i ? 0.1 : -0.1),
             { k: 0.24, lw: 0.85 });
      }
      critterEyes(ctx, 1, -24, 5, 2, 7.6, p.dark);
      stroke(ctx, [-4, -14, 1, -11, 6, -14], sh(p.main, -0.42), 1, true);
    }

    // selo elemental — sempre acima da cabeça, mesmo lugar em todos os pets
    if (p.elId && p.elId !== 'neutro') {
      var ei = p.el;
      if (p.elId === 'fogo') part(ctx, Pflame(-16, -56, 4.4, 12, 0.1), ei.glow, { k: 0.14, lw: 0.8, line: lineOf(ei.c) });
      else if (p.elId === 'agua') part(ctx, Pdrop(-16, -58, 3.8), ei.glow, { k: 0.16, lw: 0.8, line: lineOf(ei.deep) });
      else if (p.elId === 'terra') part(ctx, Pshard(-16, -56, 5, 'pe'), mx(ei.c, '#8a7a52', 0.4), { k: 0.22, lw: 0.85 });
      else if (p.elId === 'ar') part(ctx, Pfeather(-16, -56, 10, -1.4), ei.glow, { k: 0.16, lw: 0.8, line: lineOf(ei.deep) });
    }
    ctx.restore();
  }

  // ==========================================================================
  // RESOLUÇÃO DE defId  →  configuração de desenho
  // ==========================================================================
  function normEls(opts) {
    var e = [];
    if (opts.elements && opts.elements.length) e = opts.elements.slice(0, 2);
    else if (opts.element) e = [opts.element];
    if (!e.length) e = ['neutro'];
    if (!ELEM[e[0]]) e[0] = 'neutro';
    if (e[1] && !ELEM[e[1]]) e[1] = 'neutro';
    return e;
  }
  var DIRS = [{ back: false, mirror: false }, { back: false, mirror: true },
              { back: true, mirror: true }, { back: true, mirror: false }];
  var DIR_NAMES = { SE: 0, SW: 1, NW: 2, NE: 3, se: 0, sw: 1, nw: 2, ne: 3 };
  function normDir(d) {
    if (typeof d === 'string') d = DIR_NAMES[d] != null ? DIR_NAMES[d] : 0;
    d = (d | 0) % 4; if (d < 0) d += 4;
    return d;
  }
  A.DIRS = DIR_NAMES;

  function parseFusion(defId) {
    if (defId.indexOf('fus:') !== 0) return null;
    var body = defId.slice(4);
    var i = body.indexOf('+');
    if (i < 0) return null;
    return [body.slice(0, i), body.slice(i + 1)];
  }
  function isClass(id) { return !!PLANS[id]; }

  function unitCanvas(defId, els, dir, scale) {
    var w = M.unitW * scale, h = M.unitH * scale;
    var c = mkCanvas(w, h), g = c.getContext('2d');
    var k = M.artUnit * scale * RES;
    setScale(k);
    var d = DIRS[dir];
    g.save();
    g.translate(c.width / 2, c.height * M.anchorY);
    g.scale(k, k);
    if (d.mirror) g.scale(-1, 1);

    var fus = parseFusion(defId);
    if (fus && (isClass(fus[0]) || isClass(fus[1]))) {
      var cfg = fusionCfg(fus[0], fus[1], els);
      cfg.back = d.back;
      paintUnit(g, cfg);
    } else if (isClass(defId)) {
      var cfg2 = baseCfg(defId, els);
      cfg2.back = d.back;
      paintUnit(g, cfg2);
    } else {
      var pets = (JOGO.DATA && JOGO.DATA.pets) || null;
      var pd = pets && pets[defId];
      if (pd) {
        paintPet(g, defId, pd, { pal: creaturePal(defId, pd, els), back: d.back });
      } else {
        var md = (JOGO.DATA && JOGO.DATA.monsters && JOGO.DATA.monsters[defId]) || null;
        paintCreature(g, defId, md, {
          pal: creaturePal(defId, md, els),
          arch: archOf(defId, md),
          boss: !!(md && (md.boss || md.isBoss)),
          back: d.back
        });
      }
    }
    g.restore();
    c.__anchor = [M.anchorX, M.anchorY];
    return c;
  }

  // ==========================================================================
  // CENÁRIO — chão, obstáculos e props por tema
  // ==========================================================================
  var THEMES = {
    estufa:   { floor: '#7d9a4e', floor2: '#6a8642', edge: '#3f5326', wall: '#5c7a35', accent: '#e2f0a8',
                high: 'hedge', low: 'planter', props: ['samambaia', 'cogumelo', 'lanterna', 'vaso'] },
    cisterna: { floor: '#5d7f8c', floor2: '#4d6c78', edge: '#263a44', wall: '#456474', accent: '#b9f2ff',
                high: 'coluna', low: 'canal', props: ['poca', 'corrente', 'lanterna', 'urna'] },
    brasa:    { floor: '#7a4a3a', floor2: '#663c30', edge: '#3a1e18', wall: '#5c3428', accent: '#ffb347',
                high: 'forja', low: 'veio', props: ['brasa', 'bigorna', 'corrente', 'urna'] },
    vento:    { floor: '#8a8296', floor2: '#756e82', edge: '#3c3748', wall: '#655e74', accent: '#f0eaff',
                high: 'andaime', low: 'caixa', props: ['corda', 'bandeira', 'lanterna', 'caixa'] },
    mina:     { floor: '#7a6a4e', floor2: '#665842', edge: '#332b20', wall: '#5c4e38', accent: '#c9a227',
                high: 'rocha', low: 'entulho', props: ['carrinho', 'picareta', 'lanterna', 'cristal'] },
    coracao:  { floor: '#5a5270', floor2: '#4a4360', edge: '#241f36', wall: '#463f60', accent: '#b98cff',
                high: 'cristal', low: 'runa', props: ['cristal', 'runa', 'lanterna', 'urna'] }
  };
  var THEME_ALIAS = {
    greenhouse: 'estufa', garden: 'estufa', jardim: 'estufa', vegetal: 'estufa', estufa: 'estufa',
    cistern: 'cisterna', agua: 'cisterna', water: 'cisterna', afogados: 'cisterna', cisterna: 'cisterna',
    ember: 'brasa', emberlock: 'brasa', fogo: 'brasa', fire: 'brasa', forja: 'brasa', fecho: 'brasa', brasa: 'brasa',
    wind: 'vento', ar: 'vento', air: 'vento', andaime: 'vento', andaimes: 'vento', vendaval: 'vento', vento: 'vento',
    mine: 'mina', terra: 'mina', earth: 'mina', tremor: 'mina', mina: 'mina',
    heart: 'coracao', coracao: 'coracao', 'coração': 'coracao', final: 'coracao', partido: 'coracao'
  };
  function themeOf(theme) {
    if (!theme) return THEMES.estufa;
    var t = String(theme).toLowerCase();
    if (THEMES[t]) return withDungeonPalette(t, THEMES[t]);
    var al = THEME_ALIAS[t];
    if (al) return withDungeonPalette(al, THEMES[al]);
    for (var k in THEME_ALIAS) if (t.indexOf(k) >= 0) return withDungeonPalette(THEME_ALIAS[k], THEMES[THEME_ALIAS[k]]);
    // tema desconhecido: deriva uma paleta estável do hash (nunca cinza morto)
    var h = hash(t), base = 'hsl';
    var hue = h % 360;
    var col = hslHex(hue, 26, 44);
    return { floor: col, floor2: sh(col, -0.12), edge: sh(col, -0.5), wall: sh(col, -0.16),
             accent: sh(col, 0.55), high: 'rocha', low: 'entulho', props: ['lanterna', 'urna', 'cristal'] };
  }
  // se o Criativo Mundo já escreveu os calabouços, respeita a paleta dele
  function withDungeonPalette(key, T) {
    var dgs = (JOGO.DATA && JOGO.DATA.dungeons) || null;
    if (!dgs || !dgs.length) return T;
    for (var i = 0; i < dgs.length; i++) {
      var d = dgs[i];
      var th = String(d.theme || d.id || '').toLowerCase();
      if (THEME_ALIAS[th] === key || th === key) {
        if (d.palette && d.palette.primary) {
          var o = {}; for (var k in T) o[k] = T[k];
          o.floor = mx(T.floor, d.palette.primary, 0.28);
          o.floor2 = sh(o.floor, -0.12);
          o.wall = mx(T.wall, d.palette.secondary || d.palette.primary, 0.3);
          o.accent = d.palette.accent || T.accent;
          return o;
        }
      }
    }
    return T;
  }
  function hslHex(h, s, l) {
    s /= 100; l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r, g, b;
    if (h < 60) { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; } else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
    return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }
  A.themePalette = themeOf;

  // caixa isométrica: 3 faces chapadas com contorno — a base de todo cenário
  function isoBox(ctx, cx, cy, w, hgt, col, o) {
    o = o || {};
    var hw = w / 2, hh = w / 4;
    var ln = o.line || lineOf(col);
    part(ctx, Ppoly([cx - hw, cy - hgt, cx, cy - hgt + hh, cx, cy + hh, cx - hw, cy]),
         sh(col, -0.3), { flat: true, lw: 0.9, line: ln });
    part(ctx, Ppoly([cx + hw, cy - hgt, cx, cy - hgt + hh, cx, cy + hh, cx + hw, cy]),
         sh(col, -0.13), { flat: true, lw: 0.9, line: ln });
    part(ctx, Ppoly([cx, cy - hgt - hh, cx + hw, cy - hgt, cx, cy - hgt + hh, cx - hw, cy - hgt]),
         sh(col, 0.1), { flat: true, lw: 0.9, line: ln });
  }

  function tileCanvas(theme, variant) {
    var T = themeOf(theme), tw = M.tileW, th = M.tileH, thick = 12;
    var c = mkCanvas(tw, th + thick), g = c.getContext('2d');
    setScale(RES);
    g.save(); g.scale(RES, RES);
    var cx = tw / 2, cy = th / 2;
    var v = (variant | 0);
    var col = v % 2 ? T.floor2 : T.floor;
    var rd = rng(theme + ':' + v);
    // espessura (lados do bloco de chão)
    part(g, Ppoly([cx - tw / 2 + 1, cy, cx, cy + th / 2, cx, cy + th / 2 + thick, cx - tw / 2 + 1, cy + thick]),
         sh(col, -0.42), { flat: true, lw: 0.7, line: rgba(T.edge, 0.8) });
    part(g, Ppoly([cx + tw / 2 - 1, cy, cx, cy + th / 2, cx, cy + th / 2 + thick, cx + tw / 2 - 1, cy + thick]),
         sh(col, -0.28), { flat: true, lw: 0.7, line: rgba(T.edge, 0.8) });
    // topo
    part(g, Pdiamond(cx, cy, tw - 2, th - 1), col, { flat: true, lw: 0.7, line: rgba(T.edge, 0.65) });
    // detalhe do topo por variante
    if (v === 1) {
      stroke(g, [cx - 26, cy - 4, cx - 4, cy + 6, cx + 20, cy - 2], sh(col, -0.24), 0.7, true);
      stroke(g, [cx + 6, cy + 12, cx + 22, cy + 6], sh(col, -0.24), 0.6, true);
    } else if (v === 2) {
      // chão "decorado" (,) — mosaico
      part(g, Pdiamond(cx, cy, (tw - 2) * 0.52, (th - 1) * 0.52), sh(col, 0.14), { flat: true, lw: 0.7, line: rgba(T.edge, 0.5) });
      part(g, Pdiamond(cx, cy, (tw - 2) * 0.2, (th - 1) * 0.2), T.accent, { flat: true, lw: 0.6, line: rgba(T.edge, 0.5) });
    } else if (v === 3) {
      var i, n = 5;
      for (i = 0; i < n; i++) {
        var a = rd() * TAU, r2 = rd() * 0.34 + 0.1;
        flat(g, Pel(cx + Math.cos(a) * tw * r2 * 0.5, cy + Math.sin(a) * th * r2 * 0.5, 5 + rd() * 5, 2.6 + rd() * 2),
             rgba(T.accent, 0.2));
      }
    }
    g.restore();
    c.__anchor = [0.5, (th / 2) / (th + thick)];
    c.__kind = 'tile';
    return c;
  }
  var HIGH = {
    hedge: function (g, T, cx, cy, v) {
      var rd = rng('hedge' + v), i;
      isoBox(g, cx, cy, 74, 16, mx(T.wall, '#3f5326', 0.4));
      part(g, Pblob([cx - 40, cy - 26, cx - 34, cy - 62, cx - 6, cy - 78, cx + 26, cy - 70,
                     cx + 40, cy - 40, cx + 34, cy - 18, cx, cy - 8, cx - 30, cy - 14]),
           mx(T.wall, '#4f8a35', 0.55), { k: 0.24, hi: 0.14 });
      for (i = 0; i < 7; i++) {
        var a = rd() * TAU, rr = 12 + rd() * 24;
        part(g, Pel(cx + Math.cos(a) * rr, cy - 44 + Math.sin(a) * rr * 0.62, 7 + rd() * 4, 5 + rd() * 3, rd()),
             mx(T.wall, '#66a83f', 0.7), { k: 0.18, lw: 0.75 });
      }
      for (i = 0; i < 3; i++) {
        part(g, Pel(cx - 20 + i * 20, cy - 60 + (i % 2) * 14, 4, 4), i === 1 ? '#ff8fa8' : T.accent, { k: 0.16, lw: 0.7 });
      }
    },
    coluna: function (g, T, cx, cy, v) {
      isoBox(g, cx, cy, 62, 12, sh(T.wall, -0.14));
      isoBox(g, cx, cy - 12, 44, 62, T.wall);
      isoBox(g, cx, cy - 74, 58, 12, sh(T.wall, 0.08));
      stroke(g, [cx - 12, cy - 20, cx - 12, cy - 68], sh(T.wall, -0.34), 0.8);
      stroke(g, [cx + 12, cy - 20, cx + 12, cy - 68], sh(T.wall, -0.34), 0.8);
      part(g, Pel(cx, cy - 88, 20, 8), rgba(T.accent, 0.35), { flat: true, noline: true });
    },
    forja: function (g, T, cx, cy, v) {
      isoBox(g, cx, cy, 70, 44, sh(T.wall, -0.06));
      isoBox(g, cx, cy - 44, 48, 26, T.wall);
      part(g, Ppoly([cx - 20, cy - 30, cx + 20, cy - 30, cx + 14, cy - 6, cx - 14, cy - 6]),
           '#2a1410', { k: 0.2, lw: 0.9 });
      part(g, Pflame(cx, cy - 10, 12, 26, 0.1), '#ff8c3a', { k: 0.16, line: '#8a2a12' });
      part(g, Pflame(cx, cy - 12, 6, 15, -0.1), '#ffd98a', { k: 0.14, line: '#c3341a' });
      glow(g, cx, cy - 18, 34, '#ff8c3a', 0.5);
    },
    andaime: function (g, T, cx, cy, v) {
      var i;
      for (i = 0; i < 2; i++) {
        var x = cx - 22 + i * 44;
        part(g, Prr(x, cy - 40, 8, 80, 2), mx(T.wall, '#8a6b3f', 0.5), { k: 0.26, lw: 0.9 });
      }
      for (i = 0; i < 3; i++) {
        part(g, Prr(cx, cy - 16 - i * 28, 56, 6, 2), mx(T.wall, '#9a7a4a', 0.42), { k: 0.24, lw: 0.9 });
      }
      stroke(g, [cx - 22, cy - 72, cx + 22, cy - 20], rgba('#c8b48a', 0.8), 0.9);
      part(g, Ppoly([cx + 22, cy - 78, cx + 46, cy - 70, cx + 22, cy - 62]), T.accent, { k: 0.2, lw: 0.85 });
    },
    rocha: function (g, T, cx, cy, v) {
      var rd = rng('rocha' + v);
      part(g, Pshard(cx, cy - 24, 40, 'r' + v), T.wall, { k: 0.3, hi: 0.1 });
      part(g, Pshard(cx - 14, cy - 56, 22, 'r2' + v), sh(T.wall, 0.08), { k: 0.28 });
      part(g, Pshard(cx + 18, cy - 50, 17, 'r3' + v), sh(T.wall, -0.06), { k: 0.28 });
      part(g, Pel(cx + 8, cy - 40, 5, 4), rgba(T.accent, 0.8), { k: 0.18, lw: 0.7 });
      part(g, Pel(cx - 18, cy - 30, 3.6, 3), rgba(T.accent, 0.6), { k: 0.18, lw: 0.7 });
    },
    cristal: function (g, T, cx, cy, v) {
      isoBox(g, cx, cy, 60, 10, sh(T.wall, -0.2));
      part(g, Ppoly([cx, cy - 92, cx + 17, cy - 52, cx + 11, cy - 12, cx - 11, cy - 12, cx - 17, cy - 52]),
           mx(T.accent, T.wall, 0.35), { k: 0.24, hi: 0.2 });
      part(g, Ppoly([cx - 24, cy - 58, cx - 14, cy - 30, cx - 26, cy - 12, cx - 34, cy - 34]),
           mx(T.accent, T.wall, 0.5), { k: 0.24 });
      part(g, Ppoly([cx + 26, cy - 48, cx + 34, cy - 26, cx + 24, cy - 12, cx + 16, cy - 30]),
           mx(T.accent, T.wall, 0.45), { k: 0.24 });
      glow(g, cx, cy - 46, 44, T.accent, 0.45);
    }
  };
  var LOW = {
    planter: function (g, T, cx, cy, v) {
      isoBox(g, cx, cy, 68, 22, mx(T.wall, '#8a6b3f', 0.55));
      var rd = rng('pl' + v), i;
      for (i = 0; i < 5; i++) {
        var a = rd() * TAU, rr = 8 + rd() * 16;
        part(g, Pel(cx + Math.cos(a) * rr, cy - 28 + Math.sin(a) * rr * 0.5, 8, 6, rd()),
             mx(T.wall, '#66a83f', 0.7), { k: 0.2, lw: 0.8 });
      }
      part(g, Pel(cx + 8, cy - 34, 4, 4), T.accent, { k: 0.16, lw: 0.7 });
    },
    canal: function (g, T, cx, cy, v) {
      isoBox(g, cx, cy, 74, 10, sh(T.wall, -0.1));
      part(g, Pdiamond(cx, cy - 12, 56, 28), mx('#2f9fe0', T.floor, 0.25), { k: 0.18, lw: 0.8 });
      stroke(g, [cx - 18, cy - 12, cx - 4, cy - 6, cx + 12, cy - 14], rgba('#b9f2ff', 0.8), 0.8, true);
      stroke(g, [cx - 8, cy - 20, cx + 6, cy - 16], rgba('#b9f2ff', 0.5), 0.7, true);
    },
    veio: function (g, T, cx, cy, v) {
      isoBox(g, cx, cy, 72, 12, sh(T.wall, -0.16));
      part(g, Pdiamond(cx, cy - 14, 54, 26), '#3a1610', { k: 0.2, lw: 0.8 });
      part(g, Pdiamond(cx, cy - 14, 40, 19), '#ff6a1e', { k: 0.16, lw: 0.7 });
      part(g, Pdiamond(cx, cy - 15, 22, 10), '#ffd98a', { k: 0.14, lw: 0.6 });
      glow(g, cx, cy - 14, 34, '#ff8c3a', 0.42);
    },
    caixa: function (g, T, cx, cy, v) {
      isoBox(g, cx, cy, 56, 34, mx(T.wall, '#9a7a4a', 0.55));
      stroke(g, [cx - 28, cy - 20, cx, cy - 6, cx + 28, cy - 20], sh(mx(T.wall, '#9a7a4a', 0.55), -0.34), 0.8, true);
      part(g, Prr(cx, cy - 40, 30, 6, 2), mx(T.wall, '#7a5a34', 0.5), { k: 0.24, lw: 0.85 });
    },
    entulho: function (g, T, cx, cy, v) {
      var rd = rng('en' + v), i;
      for (i = 0; i < 5; i++) {
        part(g, Pshard(cx - 20 + rd() * 40, cy - 6 - rd() * 22, 9 + rd() * 8, 'e' + v + i),
             sh(T.wall, -0.08 + rd() * 0.3), { k: 0.28, lw: 0.85 });
      }
      part(g, Prr(cx + 10, cy - 24, 5, 30, 2), mx(T.wall, '#8a6b3f', 0.6), { k: 0.26, lw: 0.85 });
    },
    runa: function (g, T, cx, cy, v) {
      isoBox(g, cx, cy, 64, 16, sh(T.wall, -0.08));
      part(g, Pdiamond(cx, cy - 18, 46, 23), sh(T.wall, 0.14), { k: 0.16, lw: 0.8 });
      part(g, Pstar(cx, cy - 18, 12, 4, 0.36), T.accent, { k: 0.16, lw: 0.8 });
      glow(g, cx, cy - 18, 26, T.accent, 0.4);
    }
  };
  var PROPS = {
    samambaia: function (g, T, cx, cy) {
      var i;
      for (i = 0; i < 5; i++) {
        var a = -2.6 + i * 0.62;
        part(g, Pfeather(cx, cy - 4, 22, a), mx(T.wall, '#66a83f', 0.66), { k: 0.22, lw: 0.8 });
      }
    },
    cogumelo: function (g, T, cx, cy) {
      part(g, Pcap(cx, cy - 4, 4, cx + 1, cy - 16, 3.4), '#e8dcc0', { k: 0.2, lw: 0.85 });
      part(g, Pel(cx + 1, cy - 18, 11, 7.5), '#d8604a', { k: 0.22, hi: 0.18 });
      part(g, Pel(cx - 3, cy - 20, 2.6, 1.8), '#f4ecd8', { k: 0.14, lw: 0.6 });
      part(g, Pel(cx + 5, cy - 19, 2.2, 1.5), '#f4ecd8', { k: 0.14, lw: 0.6 });
      glow(g, cx + 1, cy - 18, 16, T.accent, 0.24);
    },
    lanterna: function (g, T, cx, cy) {
      part(g, Pcap(cx, cy - 2, 2.4, cx, cy - 34, 2.0), '#4a4038', { k: 0.26, lw: 0.85 });
      part(g, Ppoly([cx - 8, cy - 36, cx + 8, cy - 36, cx + 6, cy - 52, cx - 6, cy - 52]),
           mx(T.accent, '#ffd98a', 0.5), { k: 0.2, lw: 0.85 });
      part(g, Ppoly([cx - 9, cy - 52, cx + 9, cy - 52, cx, cy - 60]), '#4a4038', { k: 0.24, lw: 0.85 });
      glow(g, cx, cy - 44, 30, T.accent, 0.5);
    },
    vaso: function (g, T, cx, cy) {
      part(g, tag(function (c2) {
        c2.beginPath();
        c2.moveTo(cx - 12, cy - 24); c2.quadraticCurveTo(cx - 16, cy - 6, cx - 8, cy - 1);
        c2.quadraticCurveTo(cx, cy + 2, cx + 8, cy - 1);
        c2.quadraticCurveTo(cx + 16, cy - 6, cx + 12, cy - 24);
        c2.quadraticCurveTo(cx, cy - 28, cx - 12, cy - 24); c2.closePath();
      }, cx, cy - 12, 14), mx(T.wall, '#b07a4a', 0.6), { k: 0.24, hi: 0.14 });
      part(g, Pel(cx, cy - 24, 12, 4), sh(mx(T.wall, '#b07a4a', 0.6), -0.2), { k: 0.2, lw: 0.85 });
    },
    urna: function (g, T, cx, cy) {
      part(g, Pel(cx, cy - 16, 13, 18), mx(T.wall, '#8a7a5a', 0.5), { k: 0.24, hi: 0.14 });
      part(g, Prr(cx, cy - 34, 14, 6, 2), sh(mx(T.wall, '#8a7a5a', 0.5), -0.2), { k: 0.22, lw: 0.85 });
      stroke(g, [cx - 9, cy - 18, cx + 9, cy - 20], sh(T.wall, -0.34), 0.7);
    },
    poca: function (g, T, cx, cy) {
      part(g, Pel(cx, cy - 2, 22, 9), rgba('#2f9fe0', 0.55), { k: 0.14, lw: 0.7, line: rgba('#1f6bb0', 0.7) });
      stroke(g, [cx - 10, cy - 3, cx + 2, cy, cx + 12, cy - 4], rgba('#b9f2ff', 0.75), 0.7, true);
    },
    corrente: function (g, T, cx, cy) {
      var i;
      for (i = 0; i < 6; i++) part(g, Pel(cx, cy - 8 - i * 8, 3.6, 4.6), '#7a828c', { k: 0.24, lw: 0.8 });
    },
    brasa: function (g, T, cx, cy) {
      part(g, Pel(cx, cy - 3, 16, 7), '#3a1610', { k: 0.2, lw: 0.8 });
      part(g, Pflame(cx - 4, cy - 6, 5, 13, 0.15), '#ff8c3a', { k: 0.16, lw: 0.8, line: '#8a2a12' });
      part(g, Pflame(cx + 5, cy - 5, 4, 10, -0.1), '#ffd98a', { k: 0.14, lw: 0.8, line: '#c3341a' });
      glow(g, cx, cy - 10, 26, '#ff8c3a', 0.45);
    },
    bigorna: function (g, T, cx, cy) {
      part(g, Prr(cx, cy - 6, 22, 8, 2), '#5a5f66', { k: 0.24, lw: 0.85 });
      part(g, Prr(cx, cy - 16, 10, 12, 2), '#6a7078', { k: 0.24, lw: 0.85 });
      part(g, Ppoly([cx - 20, cy - 26, cx + 20, cy - 26, cx + 14, cy - 20, cx - 14, cy - 20]), '#7a828c', { k: 0.22, lw: 0.85 });
    },
    corda: function (g, T, cx, cy) {
      stroke(g, [cx - 26, cy - 52, cx, cy - 34, cx + 26, cy - 54], '#b09060', 1.1, true);
      part(g, Pel(cx, cy - 36, 3.4, 3.4), '#8a6b3f', { k: 0.22, lw: 0.8 });
    },
    bandeira: function (g, T, cx, cy) {
      part(g, Pcap(cx, cy - 2, 2.2, cx, cy - 46, 1.8), '#6a5a44', { k: 0.26, lw: 0.85 });
      part(g, tag(function (c2) {
        c2.beginPath(); c2.moveTo(cx + 2, cy - 46);
        c2.quadraticCurveTo(cx + 24, cy - 40, cx + 22, cy - 26);
        c2.quadraticCurveTo(cx + 10, cy - 30, cx + 2, cy - 24); c2.closePath();
      }, cx + 12, cy - 34, 14), T.accent, { k: 0.22, lw: 0.85 });
    },
    carrinho: function (g, T, cx, cy) {
      part(g, Ppoly([cx - 20, cy - 26, cx + 20, cy - 26, cx + 15, cy - 8, cx - 15, cy - 8]),
           mx(T.wall, '#8a6b3f', 0.5), { k: 0.26, lw: 0.9 });
      part(g, Pel(cx - 10, cy - 5, 6, 6), '#3a3128', { k: 0.24, lw: 0.85 });
      part(g, Pel(cx + 10, cy - 5, 6, 6), '#3a3128', { k: 0.24, lw: 0.85 });
      part(g, Pshard(cx, cy - 30, 9, 'cc'), T.accent, { k: 0.24, lw: 0.85 });
    },
    picareta: function (g, T, cx, cy) {
      part(g, Pcap(cx - 8, cy - 2, 2.2, cx + 6, cy - 38, 1.9), '#9a7a4a', { k: 0.26, lw: 0.85 });
      part(g, tag(function (c2) {
        c2.beginPath(); c2.moveTo(cx - 12, cy - 34);
        c2.quadraticCurveTo(cx + 6, cy - 46, cx + 22, cy - 34);
        c2.quadraticCurveTo(cx + 6, cy - 40, cx - 12, cy - 30); c2.closePath();
      }, cx + 4, cy - 37, 17), '#8a929c', { k: 0.24, lw: 0.85 });
    },
    cristal: function (g, T, cx, cy) {
      part(g, Ppoly([cx, cy - 40, cx + 9, cy - 18, cx + 5, cy - 2, cx - 5, cy - 2, cx - 9, cy - 18]),
           mx(T.accent, T.wall, 0.3), { k: 0.24, hi: 0.2 });
      glow(g, cx, cy - 20, 24, T.accent, 0.4);
    },
    runa: function (g, T, cx, cy) {
      part(g, Pstar(cx, cy - 8, 11, 4, 0.34), T.accent, { k: 0.18, lw: 0.8 });
      glow(g, cx, cy - 8, 22, T.accent, 0.42);
    }
  };

  function sceneryCanvas(kindMap, theme, key, tall) {
    var T = themeOf(theme);
    var w = M.tileW + 24, h = tall;
    var c = mkCanvas(w, h), g = c.getContext('2d');
    setScale(RES);
    g.save(); g.scale(RES, RES);
    var cx = w / 2, cy = h - M.tileH / 2 - 4;
    var fn = kindMap[key];
    if (fn) fn(g, T, cx, cy, hash(String(key)) % 4);
    g.restore();
    c.__anchor = [0.5, cy / h];
    return c;
  }

  // ==========================================================================
  // RETRATOS — busto de frente, enquadrado no rosto
  // ==========================================================================
  function unitPalOf(defId, els) {
    var fus = parseFusion(defId);
    if (fus && (isClass(fus[0]) || isClass(fus[1]))) return fusionCfg(fus[0], fus[1], els).pal;
    if (isClass(defId)) return classPal(defId, els);
    var pets = (JOGO.DATA && JOGO.DATA.pets) || null;
    var md = pets && pets[defId] ? pets[defId]
           : ((JOGO.DATA && JOGO.DATA.monsters && JOGO.DATA.monsters[defId]) || null);
    return creaturePal(defId, md, els);
  }
  A.unitPalette = unitPalOf;

  function portraitCanvas(defId, els, size) {
    var c = mkCanvas(size, size), g = c.getContext('2d');
    var pal = unitPalOf(defId, els);
    var S = size * RES;
    // fundo: disco chapado com halo do elemento
    g.save();
    var bg1 = mx(pal.dark, '#0d1014', 0.34), bg2 = mx(pal.main, '#0d1014', 0.62);
    var lg = g.createLinearGradient(0, 0, 0, S);
    lg.addColorStop(0, bg2); lg.addColorStop(1, bg1);
    g.fillStyle = lg; g.fillRect(0, 0, S, S);
    var rg = g.createRadialGradient(S * 0.5, S * 0.66, S * 0.05, S * 0.5, S * 0.66, S * 0.62);
    rg.addColorStop(0, rgba(pal.el.c, 0.34)); rg.addColorStop(1, rgba(pal.el.c, 0));
    g.fillStyle = rg; g.fillRect(0, 0, S, S);
    g.restore();

    // figura enquadrada no rosto
    var fus = parseFusion(defId);
    var cfg, An, hx0, hy0, hr;
    if (fus && (isClass(fus[0]) || isClass(fus[1]))) cfg = fusionCfg(fus[0], fus[1], els);
    else if (isClass(defId)) cfg = baseCfg(defId, els);
    else cfg = null;

    g.save();
    g.beginPath(); g.rect(0, 0, S, S); g.clip();
    if (cfg) {
      cfg.back = false;
      An = (PLANS[cfg.base] || PLANS.sumo).anchors(cfg);
      hx0 = An.head[0]; hy0 = An.head[1]; hr = An.head[2];
      var k = S * 0.23 / hr;
      setScale(k);
      g.translate(S * 0.5 - hx0 * k, S * 0.46 - hy0 * k);
      g.scale(k, k);
      paintUnit(g, cfg);
    } else {
      var pets = (JOGO.DATA && JOGO.DATA.pets) || null;
      var pd = pets && pets[defId];
      var md = (JOGO.DATA && JOGO.DATA.monsters && JOGO.DATA.monsters[defId]) || null;
      var k2 = S * 0.016;
      setScale(k2);
      g.translate(S * 0.5, S * 0.5 + 34 * k2);
      g.scale(k2, k2);
      if (pd) paintPet(g, defId, pd, { pal: pal, back: false });
      else paintCreature(g, defId, md, { pal: pal, arch: archOf(defId, md),
                                         boss: !!(md && (md.boss || md.isBoss)), back: false });
    }
    g.restore();

    // moldura
    setScale(RES);
    g.save(); g.scale(RES, RES);
    var s2 = size;
    g.strokeStyle = rgba(pal.el.c, 0.55); g.lineWidth = 2;
    g.strokeRect(1, 1, s2 - 2, s2 - 2);
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1;
    g.strokeRect(3, 3, s2 - 6, s2 - 6);
    g.restore();
    c.__anchor = [0.5, 0.5];
    return c;
  }

  // ==========================================================================
  // ÍCONES — feitiço, item, pet, evento de terreno
  // ==========================================================================
  var GLYPH = {
    burst: function (g, x, y, r, col) {
      part(g, Pstar(x, y, r, 8, 0.44), col, { k: 0.2, hi: 0.2 });
      part(g, Pel(x, y, r * 0.32, r * 0.32), sh(col, 0.42), { k: 0.14, lw: 0.7 });
    },
    flame: function (g, x, y, r, col) {
      part(g, Pflame(x, y + r * 0.8, r * 0.72, r * 1.75, 0.08), col, { k: 0.18, hi: 0.2 });
      part(g, Pflame(x, y + r * 0.7, r * 0.34, r * 0.95, -0.05), sh(col, 0.44), { k: 0.14, lw: 0.7 });
    },
    drop: function (g, x, y, r, col) {
      part(g, Pdrop(x, y + r * 0.28, r * 0.86), col, { k: 0.18, hi: 0.22 });
    },
    stone: function (g, x, y, r, col) {
      part(g, Pshard(x, y, r, 'gs'), col, { k: 0.26, hi: 0.16 });
      part(g, Pshard(x - r * 0.5, y + r * 0.5, r * 0.45, 'gs2'), sh(col, -0.14), { k: 0.24, lw: 0.8 });
    },
    gust: function (g, x, y, r, col) {
      g.save();
      g.strokeStyle = col; g.lineWidth = _lw * 1.5; g.lineCap = 'round';
      Pswirl(x, y, r, 1.15)(g); g.stroke();
      g.strokeStyle = sh(col, 0.4); g.lineWidth = _lw * 0.9;
      Pswirl(x + r * 0.2, y + r * 0.3, r * 0.5, 0.9)(g); g.stroke();
      g.restore();
    },
    heal: function (g, x, y, r, col) {
      part(g, Ppoly([x - r * 0.28, y - r, x + r * 0.28, y - r, x + r * 0.28, y - r * 0.3,
                     x + r, y - r * 0.3, x + r, y + r * 0.28, x + r * 0.28, y + r * 0.28,
                     x + r * 0.28, y + r, x - r * 0.28, y + r, x - r * 0.28, y + r * 0.28,
                     x - r, y + r * 0.28, x - r, y - r * 0.3, x - r * 0.28, y - r * 0.3]),
           col, { k: 0.2, hi: 0.2 });
    },
    shield: function (g, x, y, r, col) {
      part(g, tag(function (c2) {
        c2.beginPath();
        c2.moveTo(x, y - r);
        c2.quadraticCurveTo(x + r, y - r * 0.86, x + r * 0.92, y - r * 0.2);
        c2.quadraticCurveTo(x + r * 0.8, y + r * 0.72, x, y + r);
        c2.quadraticCurveTo(x - r * 0.8, y + r * 0.72, x - r * 0.92, y - r * 0.2);
        c2.quadraticCurveTo(x - r, y - r * 0.86, x, y - r);
        c2.closePath();
      }, x, y, r), col, { k: 0.22, hi: 0.2 });
      stroke(g, [x, y - r * 0.6, x, y + r * 0.6], sh(col, -0.3), 0.9);
    },
    up: function (g, x, y, r, col) {
      part(g, Ppoly([x, y - r, x + r * 0.86, y - r * 0.05, x + r * 0.34, y - r * 0.05,
                     x + r * 0.34, y + r * 0.86, x - r * 0.34, y + r * 0.86,
                     x - r * 0.34, y - r * 0.05, x - r * 0.86, y - r * 0.05]), col, { k: 0.2, hi: 0.2 });
    },
    down: function (g, x, y, r, col) {
      g.save(); g.translate(x, y); g.rotate(Math.PI); g.translate(-x, -y);
      GLYPH.up(g, x, y, r, col); g.restore();
    },
    push: function (g, x, y, r, col) {
      part(g, Ppoly([x + r, y, x + r * 0.1, y - r * 0.62, x + r * 0.1, y + r * 0.62]), col, { k: 0.2, hi: 0.2 });
      part(g, Prr(x - r * 0.62, y, r * 0.34, r * 1.5, 2), sh(col, -0.2), { k: 0.2, lw: 0.8 });
    },
    pull: function (g, x, y, r, col) {
      part(g, Ppoly([x - r, y, x - r * 0.1, y - r * 0.62, x - r * 0.1, y + r * 0.62]), col, { k: 0.2, hi: 0.2 });
      part(g, Prr(x + r * 0.62, y, r * 0.34, r * 1.5, 2), sh(col, -0.2), { k: 0.2, lw: 0.8 });
    },
    swirl: function (g, x, y, r, col) {
      g.save(); g.strokeStyle = col; g.lineWidth = _lw * 1.8; g.lineCap = 'round';
      Pswirl(x, y, r, 1.6)(g); g.stroke(); g.restore();
      part(g, Pel(x, y, r * 0.2, r * 0.14), sh(col, 0.4), { k: 0.14, lw: 0.7 });
    },
    poison: function (g, x, y, r, col) {
      part(g, Pel(x, y + r * 0.2, r * 0.8, r * 0.78), col, { k: 0.22, hi: 0.18 });
      part(g, Pel(x - r * 0.3, y + r * 0.1, r * 0.16, r * 0.2), '#241c22', { k: 0.1, lw: 0.7 });
      part(g, Pel(x + r * 0.3, y + r * 0.1, r * 0.16, r * 0.2), '#241c22', { k: 0.1, lw: 0.7 });
      part(g, Pel(x + r * 0.5, y - r * 0.7, r * 0.24, r * 0.24), sh(col, 0.3), { k: 0.16, lw: 0.7 });
      part(g, Pel(x - r * 0.6, y - r * 0.5, r * 0.16, r * 0.16), sh(col, 0.3), { k: 0.16, lw: 0.7 });
    },
    mark: function (g, x, y, r, col) {
      part(g, Pel(x, y, r, r), 'rgba(0,0,0,0)', { noline: false, flat: true, line: col, lw: 1.6 });
      part(g, Pel(x, y, r * 0.56, r * 0.56), 'rgba(0,0,0,0)', { flat: true, line: col, lw: 1.3 });
      part(g, Pel(x, y, r * 0.2, r * 0.2), col, { k: 0.14, lw: 0.7 });
    },
    summon: function (g, x, y, r, col) {
      part(g, Prr(x, y + r * 0.3, r * 1.1, r * 1.2, 3), col, { k: 0.24, hi: 0.16 });
      part(g, Ppoly([x - r * 0.9, y - r * 0.4, x, y - r, x + r * 0.9, y - r * 0.4]), sh(col, -0.16), { k: 0.2, lw: 0.85 });
      part(g, Pel(x - r * 0.3, y + r * 0.24, r * 0.16, r * 0.16), sh(col, 0.5), { k: 0.14, lw: 0.6 });
      part(g, Pel(x + r * 0.3, y + r * 0.24, r * 0.16, r * 0.16), sh(col, 0.5), { k: 0.14, lw: 0.6 });
    },
    trap: function (g, x, y, r, col) {
      var i;
      part(g, Pel(x, y + r * 0.3, r * 0.98, r * 0.42), sh(col, -0.24), { k: 0.2 });
      for (i = 0; i < 5; i++) {
        part(g, Ppoly([x - r * 0.8 + i * r * 0.4, y + r * 0.24, x - r * 0.62 + i * r * 0.4, y - r * 0.5,
                       x - r * 0.44 + i * r * 0.4, y + r * 0.24]), '#f2ead8', { k: 0.14, lw: 0.6 });
      }
    },
    chain: function (g, x, y, r, col) {
      part(g, Ppoly([x - r, y - r * 0.5, x - r * 0.1, y - r * 0.12, x - r * 0.42, y + r * 0.08,
                     x + r, y + r * 0.6, x + r * 0.14, y + r * 0.16, x + r * 0.46, y - r * 0.06]),
           col, { k: 0.2, hi: 0.2 });
    },
    root: function (g, x, y, r, col) {
      var i;
      for (i = 0; i < 3; i++) {
        stroke(g, [x - r * 0.8 + i * r * 0.8, y + r, x - r * 0.5 + i * r * 0.5, y, x - r * 0.9 + i * r * 0.9, y - r],
               col, 1.6, true);
      }
      part(g, Pel(x, y + r * 0.9, r * 0.9, r * 0.24), sh(col, -0.3), { k: 0.2, lw: 0.8 });
    },
    invisible: function (g, x, y, r, col) {
      part(g, tag(function (c2) {
        c2.beginPath();
        c2.moveTo(x - r, y);
        c2.quadraticCurveTo(x, y - r * 0.9, x + r, y);
        c2.quadraticCurveTo(x, y + r * 0.9, x - r, y);
        c2.closePath();
      }, x, y, r), col, { k: 0.2, hi: 0.2 });
      part(g, Pel(x, y, r * 0.34, r * 0.34), '#241c22', { k: 0.1, lw: 0.7 });
      stroke(g, [x - r, y + r * 0.6, x + r, y - r * 0.6], sh(col, -0.4), 1.4);
    },
    weather: function (g, x, y, r, col) {
      part(g, Pblob([x - r, y - r * 0.1, x - r * 0.5, y - r * 0.7, x + r * 0.3, y - r * 0.7,
                     x + r, y - r * 0.1, x + r * 0.4, y + r * 0.3, x - r * 0.4, y + r * 0.3]),
           sh(col, 0.2), { k: 0.2 });
      stroke(g, [x - r * 0.5, y + r * 0.4, x - r * 0.7, y + r], col, 1.2);
      stroke(g, [x + r * 0.1, y + r * 0.4, x - r * 0.1, y + r], col, 1.2);
      stroke(g, [x + r * 0.6, y + r * 0.4, x + r * 0.4, y + r], col, 1.2);
    },
    blade: function (g, x, y, r, col) {
      part(g, Ppoly([x - r * 0.24, y + r, x + r * 0.2, y + r, x + r * 0.3, y - r * 0.5,
                     x, y - r, x - r * 0.3, y - r * 0.5]), col, { k: 0.18, hi: 0.24 });
      part(g, Prr(x, y + r * 0.86, r * 1.1, r * 0.22, 2), sh(col, -0.36), { k: 0.2, lw: 0.8 });
    }
  };
  function glyphFor(spell) {
    if (!spell) return 'burst';
    if (typeof spell === 'string') return GLYPH[spell] ? spell : 'burst';
    var e = (spell.effects || []), i, t;
    var byElem = { fogo: 'flame', agua: 'drop', terra: 'stone', ar: 'gust', neutro: 'burst' };
    var pri = { heal: 'heal', shield: 'shield', buff: 'up', resist: 'shield', push: 'push', pull: 'pull',
                teleport: 'swirl', swap: 'swirl', poison: 'poison', regen: 'heal', summon: 'summon',
                taunt: 'mark', invisible: 'invisible', root: 'root', mark: 'mark', detonateMarks: 'burst',
                trap: 'trap', weatherShift: 'weather', cleanse: 'heal', reflect: 'shield',
                dispelShield: 'blade', moveTo: 'push', chain: 'chain' };
    for (i = 0; i < e.length; i++) {
      t = e[i].type;
      if (t === 'damage') continue;
      if (pri[t]) return pri[t];
    }
    for (i = 0; i < e.length; i++) if (e[i].type === 'damage') {
      if (spell.range && spell.range.max <= 1) return 'blade';
      return byElem[e[i].element] || 'burst';
    }
    return byElem[spell.element] || 'burst';
  }

  function iconFrame(g, size, col, rar) {
    var s = size;
    part(g, Prr(s / 2, s / 2, s - 3, s - 3, s * 0.22), mx(col, '#141a20', 0.62),
         { k: 0.3, lw: 1.1, line: sh(col, -0.55) });
    part(g, Prr(s / 2, s / 2, s - 9, s - 9, s * 0.17), mx(col, '#0f1418', 0.42),
         { flat: true, lw: 0.8, line: rgba(sh(col, 0.4), 0.5) });
    if (rar) {
      var rc = A.rarityColor(rar);
      g.save(); g.strokeStyle = rc; g.lineWidth = 2;
      Prr(s / 2, s / 2, s - 3, s - 3, s * 0.22)(g); g.stroke(); g.restore();
    }
  }

  function spellIconCanvas(spell, size) {
    var c = mkCanvas(size, size), g = c.getContext('2d');
    setScale(RES); g.save(); g.scale(RES, RES);
    var el = (spell && spell.element) || 'neutro';
    var info = elemInfo(ELEM[el] ? el : 'neutro');
    iconFrame(g, size, info.c, null);
    var kind = glyphFor(spell);
    glow(g, size / 2, size / 2, size * 0.42, info.c, 0.4);
    (GLYPH[kind] || GLYPH.burst)(g, size / 2, size / 2, size * 0.27, info.c);
    g.restore();
    c.__anchor = [0.5, 0.5];
    return c;
  }

  var SLOT_GLYPH = {
    pa: function (g, x, y, r, col) {
      // manopla: PA
      part(g, Pblob([x - r * 0.9, y + r * 0.2, x - r * 0.8, y - r * 0.5, x - r * 0.1, y - r * 0.86,
                     x + r * 0.7, y - r * 0.6, x + r * 0.9, y + r * 0.1, x + r * 0.4, y + r * 0.86,
                     x - r * 0.5, y + r * 0.86]), col, { k: 0.24, hi: 0.2 });
      var i;
      for (i = 0; i < 3; i++) {
        part(g, Prr(x - r * 0.4 + i * r * 0.42, y - r * 0.34, r * 0.3, r * 0.42, 2), sh(col, 0.18), { k: 0.2, lw: 0.7 });
      }
    },
    pp: function (g, x, y, r, col) {
      // bota: PP
      part(g, tag(function (c2) {
        c2.beginPath();
        c2.moveTo(x - r * 0.5, y - r * 0.9);
        c2.lineTo(x + r * 0.16, y - r * 0.9);
        c2.quadraticCurveTo(x + r * 0.3, y + r * 0.1, x + r * 0.95, y + r * 0.4);
        c2.quadraticCurveTo(x + r, y + r * 0.86, x + r * 0.3, y + r * 0.86);
        c2.lineTo(x - r * 0.5, y + r * 0.86);
        c2.closePath();
      }, x, y, r), col, { k: 0.24, hi: 0.2 });
      part(g, Prr(x - r * 0.16, y + r * 0.78, r * 1.6, r * 0.28, 2), sh(col, -0.34), { k: 0.2, lw: 0.75 });
    },
    vida: function (g, x, y, r, col) {
      part(g, tag(function (c2) {
        c2.beginPath();
        c2.moveTo(x, y + r * 0.92);
        c2.quadraticCurveTo(x - r * 1.05, y + r * 0.05, x - r * 0.52, y - r * 0.62);
        c2.quadraticCurveTo(x - r * 0.08, y - r * 0.9, x, y - r * 0.34);
        c2.quadraticCurveTo(x + r * 0.08, y - r * 0.9, x + r * 0.52, y - r * 0.62);
        c2.quadraticCurveTo(x + r * 1.05, y + r * 0.05, x, y + r * 0.92);
        c2.closePath();
      }, x, y, r), col, { k: 0.22, hi: 0.24 });
    },
    especial: function (g, x, y, r, col) {
      part(g, Pel(x, y, r * 0.72, r * 0.72), col, { k: 0.22, hi: 0.26 });
      var i;
      for (i = 0; i < 6; i++) {
        var a = i / 6 * TAU;
        part(g, Ppoly([x + Math.cos(a) * r * 0.76, y + Math.sin(a) * r * 0.76,
                       x + Math.cos(a + 0.2) * r * 1.05, y + Math.sin(a + 0.2) * r * 1.05,
                       x + Math.cos(a - 0.2) * r * 1.05, y + Math.sin(a - 0.2) * r * 1.05]),
             sh(col, 0.34), { k: 0.18, lw: 0.7 });
      }
      glow(g, x, y, r * 1.5, sh(col, 0.4), 0.5);
    },
    pet: function (g, x, y, r, col) {
      part(g, Pel(x, y + r * 0.16, r * 0.8, r * 0.72), col, { k: 0.22, hi: 0.2 });
      part(g, Ppoly([x - r * 0.5, y - r * 0.38, x - r * 0.72, y - r, x - r * 0.1, y - r * 0.6]), sh(col, -0.1), { k: 0.2, lw: 0.75 });
      part(g, Ppoly([x + r * 0.5, y - r * 0.38, x + r * 0.72, y - r, x + r * 0.1, y - r * 0.6]), sh(col, -0.04), { k: 0.2, lw: 0.75 });
      critterEyes(g, x, y, r * 0.24, 2, r * 0.34);
    }
  };
  function itemIconCanvas(itemId, size) {
    var c = mkCanvas(size, size), g = c.getContext('2d');
    setScale(RES); g.save(); g.scale(RES, RES);
    var it = (JOGO.DATA && JOGO.DATA.items && JOGO.DATA.items[itemId]) || null;
    var slot = (it && it.slot) || 'vida';
    var rar = (it && it.rarity) || 'comum';
    var rc = A.rarityColor(rar);
    var base = { pa: '#e0674a', pp: '#5fc8a8', vida: '#e05a6a', especial: '#b98cff' }[slot] || '#9aa4ae';
    if (it && it.element && ELEM[it.element]) base = mx(base, elemInfo(it.element).c, 0.4);
    iconFrame(g, size, base, rar);
    glow(g, size / 2, size / 2, size * 0.4, rc, rar === 'epico' ? 0.45 : 0.25);
    (SLOT_GLYPH[slot] || SLOT_GLYPH.vida)(g, size / 2, size / 2, size * 0.26, base);
    // pedrinhas de raridade
    var n = rar === 'epico' ? 3 : rar === 'raro' ? 2 : 1, i;
    for (i = 0; i < n; i++) {
      part(g, Pel(size * 0.5 + (i - (n - 1) / 2) * size * 0.13, size * 0.88, size * 0.038, size * 0.038),
           rc, { k: 0.2, lw: 0.6 });
    }
    g.restore();
    c.__anchor = [0.5, 0.5];
    return c;
  }

  function petIconCanvas(petId, size) {
    var c = mkCanvas(size, size), g = c.getContext('2d');
    var pd = (JOGO.DATA && JOGO.DATA.pets && JOGO.DATA.pets[petId]) || null;
    var pal = creaturePal(petId, pd, null);
    setScale(RES); g.save(); g.scale(RES, RES);
    iconFrame(g, size, pal.main, null);
    g.restore();
    g.save();
    g.beginPath(); g.rect(0, 0, size * RES, size * RES); g.clip();
    var k = size * RES * 0.0155;
    setScale(k);
    g.translate(size * RES * 0.5, size * RES * 0.5 + 22 * k);
    g.scale(k, k);
    paintPet(g, petId, pd, { pal: pal, back: false });
    g.restore();
    c.__anchor = [0.5, 0.5];
    return c;
  }

  var EVENT_KIND = {
    buff:     { col: '#ffd166', glyph: 'up' },
    mystery:  { col: '#b98cff', glyph: 'mystery' },
    portal:   { col: '#57c8ec', glyph: 'swirl' },
    drain:    { col: '#e05a6a', glyph: 'drain' },
    fountain: { col: '#7ef0d4', glyph: 'heal' }
  };
  function tileEventCanvas(kind, size) {
    var c = mkCanvas(size, size), g = c.getContext('2d');
    var K = EVENT_KIND[kind] || EVENT_KIND.buff;
    setScale(RES); g.save(); g.scale(RES, RES);
    var cx = size / 2, cy = size / 2, r = size * 0.4;
    // pastilha no chão: losango + halo
    glow(g, cx, cy, r * 1.5, K.col, 0.55);
    part(g, Pdiamond(cx, cy, size * 0.9, size * 0.5), rgba(K.col, 0.35),
         { flat: true, lw: 1.1, line: rgba(sh(K.col, 0.3), 0.9) });
    part(g, Pel(cx, cy - size * 0.06, r * 0.62, r * 0.62), mx(K.col, '#141a20', 0.5),
         { k: 0.24, lw: 1, line: sh(K.col, -0.4) });
    var gy = cy - size * 0.06, gr = size * 0.2;
    if (K.glyph === 'mystery') {
      g.save();
      g.fillStyle = K.col;
      g.font = 'bold ' + Math.round(size * 0.42) + 'px Georgia, serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.strokeStyle = sh(K.col, -0.6); g.lineWidth = 2.4; g.lineJoin = 'round';
      g.strokeText('?', cx, gy + 1); g.fillText('?', cx, gy + 1);
      g.restore();
    } else if (K.glyph === 'drain') {
      part(g, Pdrop(cx, gy + gr * 0.2, gr * 0.8), K.col, { k: 0.2, hi: 0.2 });
      stroke(g, [cx - gr * 0.5, gy + gr * 0.7, cx + gr * 0.5, gy + gr * 0.7], sh(K.col, -0.3), 1.1);
    } else {
      (GLYPH[K.glyph] || GLYPH.up)(g, cx, gy, gr, K.col);
    }
    g.restore();
    c.__anchor = [0.5, 0.5];
    return c;
  }

  // ------------------------------------------------- PEDRAS DE FORJA (§9-B)
  // Uma silhueta por elemento, para o jogador contar o estoque de relance:
  // fogo = brasa em chama · água = lágrima · terra = grão de rocha ·
  // ar = bolha assobiando · neutro = lasca de lousa (serve em qualquer forja).
  function stoneIconCanvas(stoneId, size) {
    var c = mkCanvas(size, size), g = c.getContext('2d');
    var sd = (JOGO.DATA && JOGO.DATA.stones && JOGO.DATA.stones[stoneId]) || null;
    var el = (sd && sd.element) || (/ember|fogo/.test(stoneId) ? 'fogo'
            : /tear|agua/.test(stoneId) ? 'agua' : /root|terra/.test(stoneId) ? 'terra'
            : /breath|\bar\b/.test(stoneId) ? 'ar' : 'neutro');
    var ei = elemInfo(ELEM[el] ? el : 'neutro');
    var cx = size / 2, cy = size / 2, r = size * 0.3;
    setScale(RES); g.save(); g.scale(RES, RES);
    iconFrame(g, size, ei.c, null);
    glow(g, cx, cy, r * 1.7, ei.glow, 0.42);
    // corpo mineral: cristal facetado, sempre a mesma leitura de "pedra"
    part(g, Ppoly([cx - r * 0.9, cy + r * 0.5, cx - r * 0.66, cy - r * 0.55,
                   cx, cy - r * 1.05, cx + r * 0.72, cy - r * 0.5,
                   cx + r * 0.86, cy + r * 0.55, cx, cy + r * 1.02]),
         ei.c, { k: 0.3, hi: 0.2, lw: 1.1, line: lineOf(ei.deep) });
    part(g, Ppoly([cx, cy - r * 1.05, cx + r * 0.72, cy - r * 0.5,
                   cx + r * 0.86, cy + r * 0.55, cx, cy + r * 1.02]),
         sh(ei.deep, 0.12), { flat: true, lw: 0.8, line: rgba(ei.deep, 0.7) });
    part(g, Ppoly([cx - r * 0.4, cy - r * 0.3, cx - r * 0.06, cy - r * 0.72,
                   cx + r * 0.1, cy - r * 0.2, cx - r * 0.2, cy + r * 0.16]),
         sh(ei.glow, 0.24), { flat: true, noline: true });
    // marca do elemento flutuando sobre o cristal
    if (el === 'fogo') part(g, Pflame(cx, cy - r * 0.35, r * 0.34, r * 1.0, 0), ei.glow, { k: 0.16, lw: 0.8, line: lineOf(ei.deep) });
    else if (el === 'agua') part(g, Pdrop(cx, cy - r * 0.25, r * 0.36), ei.glow, { k: 0.18, lw: 0.8, line: lineOf(ei.deep) });
    else if (el === 'terra') part(g, Pel(cx, cy + r * 0.05, r * 0.3, r * 0.26), sh(ei.glow, -0.05), { k: 0.2, lw: 0.8, line: lineOf(ei.deep) });
    else if (el === 'ar') part(g, Pfeather(cx - r * 0.1, cy - r * 0.1, r * 0.9, -0.9), ei.glow, { k: 0.16, lw: 0.8, line: lineOf(ei.deep) });
    else {
      stroke(g, [cx - r * 0.42, cy + r * 0.2, cx + r * 0.06, cy - r * 0.34, cx + r * 0.44, cy + r * 0.14],
             rgba('#ffffff', 0.8), 1.2, true);
    }
    g.restore();
    c.__anchor = [0.5, 0.5];
    return c;
  }

  // -------------------------------------------------- ESTRELAS DE CLASSE (§9-B)
  // filled = conquistada (dourada e brilhando) · vazia = contorno apagado.
  function starIconCanvas(filled, size, col) {
    var c = mkCanvas(size, size), g = c.getContext('2d');
    var on = !!filled;
    var base = col || (on ? '#ffc44d' : '#4a5361');
    var cx = size / 2, cy = size / 2, R = size * 0.42;
    setScale(RES); g.save(); g.scale(RES, RES);
    if (on) glow(g, cx, cy, R * 1.7, '#ffd98a', 0.5);
    part(g, Pstar(cx, cy, R, 5, 0.44), base, { k: on ? 0.26 : 0.1, hi: on ? 0.3 : 0,
                                               lw: 1.2, line: on ? '#7a4a10' : '#2b323c' });
    if (on) {
      part(g, Pel(cx - R * 0.24, cy - R * 0.3, R * 0.2, R * 0.14, -0.5),
           'rgba(255,255,255,0.85)', { flat: true, noline: true });
    }
    g.restore();
    c.__anchor = [0.5, 0.5];
    return c;
  }

  // ==========================================================================
  // CACHE + API PÚBLICA
  // ==========================================================================
  var CACHE = {};
  var MISSES = 0;
  function cached(key, make) {
    var v = CACHE[key];
    if (v) return v;
    MISSES++;
    v = make();
    CACHE[key] = v;
    return v;
  }
  A.clearCache = function () { CACHE = {}; MISSES = 0; };
  // IMPORTANTE: os canvases devolvidos são CACHEADOS e compartilhados. Para
  // colocar um no DOM (HUD, galeria) use SEMPRE uma cópia — inserir o original
  // duas vezes o MOVE do primeiro lugar. O Pixi pode usar o original à vontade.
  A.node = function (cv, cssW, cls) {
    var c = document.createElement('canvas');
    c.width = cv.width; c.height = cv.height;
    c.getContext('2d').drawImage(cv, 0, 0);
    var w = cssW || cv.__w || (cv.width / (cv.__res || 1));
    c.style.width = w + 'px';
    c.style.height = (w * cv.height / cv.width) + 'px';
    if (cls) c.className = cls;
    c.__res = cv.__res; c.__anchor = cv.__anchor;
    return c;
  };
  A.stats = function () {
    var n = 0, k, px = 0;
    for (k in CACHE) { n++; px += CACHE[k].width * CACHE[k].height; }
    return { entries: n, generated: MISSES, megabytes: Math.round(px * 4 / 1048576 * 10) / 10 };
  };
  A.setRes = function (r) {
    RES = M.res = Math.max(1, Math.min(4, r | 0 || 1));
    M.spriteScale = 1 / RES;
    A.clearCache();
  };

  A.unit = function (defId, opts) {
    opts = opts || {};
    var els = normEls(opts), dir = normDir(opts.dir), scale = opts.scale || 1;
    return cached('unit:' + defId + ':' + els.join('+') + ':' + dir + ':' + scale, function () {
      return unitCanvas(defId, els, dir, scale);
    });
  };
  A.portrait = function (defId, opts) {
    opts = opts || {};
    var els = normEls(opts), size = opts.size || 128;
    return cached('portrait:' + defId + ':' + els.join('+') + ':' + size, function () {
      return portraitCanvas(defId, els, size);
    });
  };
  A.tile = function (theme, variant) {
    variant = variant | 0;
    return cached('tile:' + theme + ':' + variant, function () { return tileCanvas(theme, variant); });
  };
  A.obstacleHigh = function (theme, variant) {
    var T = themeOf(theme);
    var key = (typeof variant === 'string' && HIGH[variant]) ? variant : T.high;
    return cached('high:' + theme + ':' + key, function () {
      return sceneryCanvas(HIGH, theme, key, M.tileH + 116);
    });
  };
  A.obstacleLow = function (theme, variant) {
    var T = themeOf(theme);
    var key = (typeof variant === 'string' && LOW[variant]) ? variant : T.low;
    return cached('low:' + theme + ':' + key, function () {
      return sceneryCanvas(LOW, theme, key, M.tileH + 64);
    });
  };
  A.prop = function (theme, key) {
    var T = themeOf(theme);
    var k = (key && PROPS[key]) ? key : T.props[hash(String(key || 'p')) % T.props.length];
    return cached('prop:' + theme + ':' + k, function () {
      return sceneryCanvas(PROPS, theme, k, M.tileH + 68);
    });
  };
  A.spellIcon = function (spellOrKey, size) {
    size = size || 56;
    var sp = spellOrKey, id;
    if (typeof spellOrKey === 'string') {
      sp = (JOGO.DATA && JOGO.DATA.spells && JOGO.DATA.spells[spellOrKey]) || null;
      id = spellOrKey;
      if (!sp) {
        // sem dados ainda: deriva elemento/forma do id ('classe-elemento-nivel')
        var m = /(?:^|[-:])(fogo|agua|terra|ar|neutro)(?:[-:]|$)/.exec(spellOrKey);
        sp = { id: spellOrKey, element: m ? m[1] : 'neutro', effects: [], range: { max: 4 } };
      }
    } else id = (sp && sp.id) || 'sp';
    return cached('spell:' + id + ':' + size, function () { return spellIconCanvas(sp, size); });
  };
  A.itemIcon = function (itemId, size) {
    size = size || 56;
    return cached('item:' + itemId + ':' + size, function () { return itemIconCanvas(itemId, size); });
  };
  A.petIcon = function (petId, size) {
    size = size || 56;
    return cached('pet:' + petId + ':' + size, function () { return petIconCanvas(petId, size); });
  };
  A.tileEventIcon = function (kind, size) {
    size = size || 48;
    return cached('event:' + kind + ':' + size, function () { return tileEventCanvas(kind, size); });
  };
  // ---- ADENDO v2.1: pedras de forja, cartas de classe e estrelas
  A.stoneIcon = function (stoneId, size) {
    size = size || 56;
    return cached('stone:' + stoneId + ':' + size, function () { return stoneIconCanvas(stoneId, size); });
  };
  A.starIcon = function (filled, size, col) {
    size = size || 28;
    return cached('star:' + (filled ? 1 : 0) + ':' + size + ':' + (col || '-'), function () {
      return starIconCanvas(filled, size, col);
    });
  };
  A.stoneIds = function () {
    var d = (JOGO.DATA && JOGO.DATA.stones) || null, o = [], k;
    if (d) { for (k in d) o.push(k); }
    return o.length ? o : ['stone-ember', 'stone-tear', 'stone-root', 'stone-breath', 'stone-slate'];
  };

  // carta de personagem (recompensa de chefe). `Art.cardIcon` é o nome do
  // adendo §9-B; `Art.classCard` continua valendo (mesma função).
  A.classCard = function (classId, w, h) {
    w = w || 132; h = h || 186;
    return cached('card:' + classId + ':' + w + ':' + h, function () {
      var c = mkCanvas(w, h), g = c.getContext('2d');
      var C = (JOGO.DATA && JOGO.DATA.classes && JOGO.DATA.classes[classId]) || null;
      var pal = classPal(classId, ['neutro']);
      var rar = (C && C.cardRarity) || 'comum';
      var rc = A.rarityColor(rar);
      setScale(RES); g.save(); g.scale(RES, RES);
      part(g, Prr(w / 2, h / 2, w - 4, h - 4, 10), mx(pal.dark, '#0b0e12', 0.4), { k: 0.3, lw: 1.2, line: '#0b0e12' });
      var lg = g.createLinearGradient(0, 0, 0, h);
      lg.addColorStop(0, rgba(pal.main, 0.4)); lg.addColorStop(1, rgba(pal.main, 0.05));
      g.save(); Prr(w / 2, h / 2, w - 10, h - 10, 8)(g); g.clip();
      g.fillStyle = lg; g.fillRect(0, 0, w, h); g.restore();
      g.save(); g.strokeStyle = rc; g.lineWidth = 2.2;
      Prr(w / 2, h / 2, w - 7, h - 7, 9)(g); g.stroke(); g.restore();
      g.restore();
      // figura
      g.save();
      g.beginPath(); g.rect(6 * RES, 10 * RES, (w - 12) * RES, (h - 40) * RES); g.clip();
      var cfg = baseCfg(classId, ['neutro']); cfg.back = false;
      var An = (PLANS[cfg.base] || PLANS.sumo).anchors(cfg);
      var k = (h - 46) * RES * 0.0092;
      setScale(k);
      g.translate(w * RES * 0.5, (h - 40) * RES * 0.92);
      g.scale(k, k);
      paintUnit(g, cfg);
      g.restore();
      // nome
      setScale(RES); g.save(); g.scale(RES, RES);
      g.fillStyle = 'rgba(8,10,14,0.82)';
      g.fillRect(5, h - 34, w - 10, 28);
      g.fillStyle = '#f0e8d8';
      g.font = 'bold ' + Math.round(w * 0.115) + 'px Georgia, serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText((C && C.name) || classId, w / 2, h - 24);
      g.fillStyle = rc;
      g.font = Math.round(w * 0.082) + 'px "Segoe UI", system-ui, sans-serif';
      g.fillText(rar.toUpperCase(), w / 2, h - 12);
      g.restore();
      c.__anchor = [0.5, 0.5];
      return c;
    });
  };

  A.cardIcon = A.classCard;

  // chave genérica — 'unit:sumo:fogo:0' · 'tile:estufa:1' · 'spell:x' · …
  A.texture = function (key) {
    if (CACHE[key]) return CACHE[key];
    var p = String(key).split(':');
    // defIds de fusão trazem ':' no meio — remonta antes de despachar
    if ((p[0] === 'unit' || p[0] === 'portrait') && p[1] === 'fus') {
      p = [p[0], 'fus:' + p[2]].concat(p.slice(3));
    }
    switch (p[0]) {
      case 'unit': return A.unit(p[1], { element: p[2], dir: p[3] });
      case 'portrait': return A.portrait(p[1], { element: p[2], size: p[3] ? +p[3] : 128 });
      case 'tile': return A.tile(p[1], +p[2] || 0);
      case 'high': return A.obstacleHigh(p[1], p[2]);
      case 'low': return A.obstacleLow(p[1], p[2]);
      case 'prop': return A.prop(p[1], p[2]);
      case 'spell': return A.spellIcon(p[1], p[2] ? +p[2] : 56);
      case 'item': return A.itemIcon(p[1], p[2] ? +p[2] : 56);
      case 'pet': return A.petIcon(p[1], p[2] ? +p[2] : 56);
      case 'event': return A.tileEventIcon(p[1], p[2] ? +p[2] : 48);
      case 'card': return A.classCard(p[1]);
      case 'stone': return A.stoneIcon(p[1], p[2] ? +p[2] : 56);
      case 'star': return A.starIcon(p[1] === '1' || p[1] === 'on', p[2] ? +p[2] : 28);
      default: return A.unit(key, {});
    }
  };

  // listas úteis para galeria/HUD
  A.classIds = function () {
    var d = (JOGO.DATA && JOGO.DATA.classes) || null, out = [], k;
    if (d) { for (k in d) out.push(k); }
    if (!out.length) for (k in PLANS) out.push(k);
    return out;
  };
  A.elementIds = function () {
    var d = (JOGO.DATA && JOGO.DATA.elements) || null;
    return d && d.length ? d.slice() : ['neutro', 'fogo', 'agua', 'terra', 'ar'];
  };
  A.fusionPairs = function () {
    var ids = A.classIds().filter(function (c) { return !!PLANS[c]; }).sort();
    var out = [], i, j;
    for (i = 0; i < ids.length; i++) for (j = i + 1; j < ids.length; j++) out.push(ids[i] + '+' + ids[j]);
    return out;
  };
  // arquétipo escolhido para um monstro (galeria usa para medir variedade)
  A.archetypeOf = function (defId) {
    var md = (JOGO.DATA && JOGO.DATA.monsters && JOGO.DATA.monsters[defId]) || null;
    return archOf(defId, md);
  };
  A.petKindOf = function (petId) {
    var pd = (JOGO.DATA && JOGO.DATA.pets && JOGO.DATA.pets[petId]) || null;
    return petKindOf(petId, pd);
  };
  A.themeIds = function () { var o = [], k; for (k in THEMES) o.push(k); return o; };
  A.propKeys = function () { var o = [], k; for (k in PROPS) o.push(k); return o; };
  A.highKeys = function () { var o = [], k; for (k in HIGH) o.push(k); return o; };
  A.lowKeys = function () { var o = [], k; for (k in LOW) o.push(k); return o; };
  A.eventKinds = function () { var o = [], k; for (k in EVENT_KIND) o.push(k); return o; };

  JOGO.Art = A;
})();
