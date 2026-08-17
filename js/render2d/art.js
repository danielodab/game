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

/*__PART2__*/
  JOGO.Art = A;
})();
