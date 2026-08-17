var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// JOGO.Sprites — arte procedural v2 DIRECIONAL. Dono: Agente Designer.
//
// Cada personagem é um "turntable paramétrico": o pintor recebe o yaw APARENTE
// (facing no mundo + ângulo da câmera) e desenha frente/perfil/costas de forma
// contínua. Recursos de superfície (rebites, olhos, pérolas, canos) são
// posicionados por azimute na superfície — surf(a): x = sin(a+yaw)*R — de modo
// que deslizam e se ocultam ao girar a câmera, como num modelo 3D real.
// A luz é FIXA NO MUNDO: o renderer passa o.lx (lado iluminado na tela) e os
// gradientes/rim trocam de lado coerentemente ao girar.
//
// API:
//   Sprites.draw(ctx, defId, opts)  opts: { t, yaw, lx, scale, flash, alpha,
//                                           casting, tintAccent }
//     pés em (0,0), corpo para cima (y negativo). yaw: 0=frente p/ câmera,
//     ±PI/2=perfis, PI=costas. lx: -1..1 lado da luz na tela.
//   Sprites.portrait(ctx, defId, size)          retrato (sempre de frente)
//   Sprites.spellIcon(ctx, spell, size)         ícone de feitiço
//   Sprites.tileTop / wallFace / prop           texturas de cenário
//   Sprites.elements / defPalette / themePalette
// ============================================================================

(function () {
  var S = {};

  S.elements = {
    fire:    '#ff8c3a',
    water:   '#54c8e8',
    earth:   '#a9c05a',
    air:     '#bfe8ea',
    light:   '#ffd166',
    shadow:  '#a06ae0',
    neutral: '#d8d0c0'
  };

  // ---------- helpers básicos ----------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function hx(c) {
    return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  }
  function rgba(c, a) {
    var v = hx(c); return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a + ')';
  }
  function shade(c, amt) {
    var v = hx(c), o = '#', i, x;
    for (i = 0; i < 3; i++) {
      x = amt > 0 ? v[i] + (255 - v[i]) * amt : v[i] * (1 + amt);
      x = clamp(Math.round(x), 0, 255);
      o += (x < 16 ? '0' : '') + x.toString(16);
    }
    return o;
  }
  function mix(c1, c2, k) {
    var a = hx(c1), b = hx(c2), o = '#', i, x;
    for (i = 0; i < 3; i++) {
      x = clamp(Math.round(a[i] + (b[i] - a[i]) * k), 0, 255);
      o += (x < 16 ? '0' : '') + x.toString(16);
    }
    return o;
  }
  S.rgba = rgba; S.shade = shade; S.mix = mix;

  function lgrad(ctx, x0, y0, x1, y1, stops) {
    var g = ctx.createLinearGradient(x0, y0, x1, y1), i;
    for (i = 0; i < stops.length; i += 2) g.addColorStop(stops[i], stops[i + 1]);
    return g;
  }
  function rgrad(ctx, x, y, r, stops) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r), i;
    for (i = 0; i < stops.length; i += 2) g.addColorStop(stops[i], stops[i + 1]);
    return g;
  }

  var OUT = 'rgba(14,10,8,0.8)';
  function outline(ctx, w) {
    ctx.strokeStyle = OUT; ctx.lineWidth = w || 2.2; ctx.lineJoin = 'round'; ctx.stroke();
  }
  function ell(ctx, x, y, rx, ry) {
    ctx.beginPath(); ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
  }
  function poly(ctx, pts) {
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
  }
  function blob(ctx, pts) {
    var n = pts.length / 2, i, x0, y0, x1, y1, mx, my;
    ctx.beginPath();
    x0 = pts[(n - 1) * 2]; y0 = pts[(n - 1) * 2 + 1];
    mx = (x0 + pts[0]) / 2; my = (y0 + pts[1]) / 2;
    ctx.moveTo(mx, my);
    for (i = 0; i < n; i++) {
      x1 = pts[i * 2]; y1 = pts[i * 2 + 1];
      var j = ((i + 1) % n) * 2;
      ctx.quadraticCurveTo(x1, y1, (x1 + pts[j]) / 2, (y1 + pts[j + 1]) / 2);
    }
    ctx.closePath();
  }
  function srand(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  S._srand = srand;

  var glowMemo = null; // preenchido depois que memo() existir
  function glowDot(ctx, x, y, r, color, a) {
    var rq = Math.max(1, Math.round(r));
    var aq = Math.round((a == null ? 0.8 : a) * 20) / 20;
    if (aq <= 0) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.translate(x, y);
    ctx.fillStyle = glowMemo ? glowMemo(rq, color, aq)
      : rgrad(ctx, 0, 0, rq, [0, rgba(color, aq), 1, rgba(color, 0)]);
    ell(ctx, 0, 0, rq, rq); ctx.fill(); ctx.restore();
  }

  // ---------- kit de VISÃO DIRECIONAL + LUZ ----------
  // MEMOIZAÇÃO de gradientes (CanvasGradient independe do canvas de origem):
  // criar gradientes por frame é o maior custo dos pintores — cacheamos por
  // chave quantizada num contexto descartável.
  var GCV = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
  if (GCV) { GCV.width = GCV.height = 1; }
  var gctx = GCV ? GCV.getContext('2d') : null;
  var memoStore = {}; var memoN = 0;
  function memo(key, make) {
    var g = memoStore[key];
    if (g === undefined) {
      if (++memoN > 900) { memoStore = {}; memoN = 1; }
      g = memoStore[key] = make();
    }
    return g;
  }
  // tons: 5 níveis a partir da cor base (memoizado por cor)
  function T5(c) {
    return memo('T' + c, function () {
      return { hi: shade(c, 0.42), lt: shade(c, 0.18), md: c, sh: shade(c, -0.24), dk: shade(c, -0.46) };
    });
  }
  // gradiente horizontal iluminado pelo lado da luz (lx)
  function litH(ctx, w, tt, lx) {
    var wq = Math.max(1, Math.round(w));
    var s = lx >= 0 ? 1 : -1;
    return memo('H' + wq + tt.md + s, function () {
      return lgrad(gctx || ctx, wq * s, 0, -wq * s, 0, [0, tt.hi, 0.3, tt.lt, 0.62, tt.md, 1, tt.dk]);
    });
  }
  // versão suave (3 tons) para matéria fosca
  function litS(ctx, w, tt, lx) {
    var wq = Math.max(1, Math.round(w));
    var s = lx >= 0 ? 1 : -1;
    return memo('S' + wq + tt.md + s, function () {
      return lgrad(gctx || ctx, wq * s, 0, -wq * s, 0, [0, tt.lt, 0.5, tt.md, 1, tt.sh]);
    });
  }
  // rim light no lado da luz (stroke com gradiente que morre no lado escuro)
  function rimL(ctx, pathFn, w, col, lx, lw, a) {
    pathFn();
    var wq = Math.max(1, Math.round(w));
    var s = lx >= 0 ? 1 : -1;
    var aq = a == null ? 0.6 : Math.round(a * 20) / 20;
    var g = memo('R' + wq + col + s + aq, function () {
      return lgrad(gctx || ctx, wq * s, 0, -wq * s, 0, [0, rgba(col, aq), 0.55, rgba(col, 0.08), 1, rgba(col, 0)]);
    });
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = g; ctx.lineWidth = lw || 2.2; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
  }
  // oclusão ambiente vertical (escurece a base de um path)
  function aoV(ctx, pathFn, y0, y1, a) {
    pathFn();
    var y0q = Math.round(y0), y1q = Math.round(y1);
    var aq = a == null ? 0.34 : Math.round(a * 20) / 20;
    ctx.fillStyle = memo('A' + y0q + '|' + y1q + '|' + aq, function () {
      return lgrad(gctx || ctx, 0, y0q, 0, y1q, [0, 'rgba(10,6,4,0)', 1, 'rgba(10,6,4,' + aq + ')']);
    });
    ctx.fill();
  }

  // liga o memo ao glowDot (definido acima, antes do kit)
  glowMemo = function (rq, color, aq) {
    return memo('D' + rq + color + aq, function () {
      return rgrad(gctx, 0, 0, rq, [0, rgba(color, aq), 1, rgba(color, 0)]);
    });
  };

  function hashStr(s) {
    var h = 0; s = String(s);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  // objeto de visão passado a cada pintor
  function makeView(o, t, defId) {
    var yaw = o.yaw || 0;
    var sf = Math.sin(yaw), cf = Math.cos(yaw);
    var fw = clamp((cf + 0.5) / 0.95, 0, 1);
    fw = fw * fw * (3 - 2 * fw);                 // visibilidade da face 0..1
    var lx = o.lx == null ? -0.62 : o.lx;
    var seed = hashStr(defId);
    var ph = ((t + (seed % 70) * 0.1) % 3.6);
    var blink = ph < 0.13 ? Math.abs(Math.cos((ph / 0.13) * Math.PI * 0.5)) * 0.15 : 1;
    return {
      yaw: yaw, sf: sf, cf: cf, fw: fw, bk: 1 - fw, lx: lx, blink: blink,
      // ponto no espaço local do personagem: f = para frente, r = lado direito
      pt: function (f, r) { return { x: sf * f + cf * (r || 0), z: cf * f - sf * (r || 0) }; },
      // recurso na SUPERFÍCIE de um corpo redondo: azimute a, raio R
      surf: function (a, R) { var w2 = a + yaw; return { x: Math.sin(w2) * R, k: Math.cos(w2) }; }
    };
  }

  // olho vivo: pisca, íris brilhante, pupila acompanha o facing, brilho no lado da luz
  function eyeV(ctx, x, y, r, V, iris) {
    var open = Math.max(V.blink, 0.12);
    ctx.fillStyle = '#120d14';
    ell(ctx, x, y, r, r * 1.12 * open); ctx.fill();
    if (open > 0.45) {
      if (iris) {
        ctx.fillStyle = iris;
        ell(ctx, x + V.sf * r * 0.28, y + r * 0.06, r * 0.52, r * 0.6 * open); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ell(ctx, x + V.lx * r * 0.34, y - r * 0.38 * open, r * 0.3, r * 0.32); ctx.fill();
    }
  }

  // ---------- registro de pintores ----------
  var P = {};

  S.draw = function (ctx, defId, o) {
    o = o || {};
    var t = o.t || 0, painter = P[defId] || fallbackPainter;
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    var sc = o.scale || 1;
    ctx.scale(sc, sc);
    var V = makeView(o, t, defId);
    if (o.casting) { // antecipação: agacha e comprime
      var c = Math.sin(Math.min(o.casting, 1) * Math.PI);
      ctx.translate(0, c * 3.2);
      ctx.scale(1 + c * 0.07, 1 - c * 0.1);
    }
    if (o.flash && ctx.filter !== undefined) {
      ctx.filter = 'brightness(' + (1 + o.flash * 1.7) + ') saturate(' + (1 - o.flash * 0.75) + ')';
    }
    painter(ctx, t, o, V);
    if (o.flash) {
      ctx.filter = 'none';
      glowDot(ctx, 0, -30, 48, '#ffffff', o.flash * 0.55);
    }
    ctx.restore();
  };
  S.has = function (defId) { return !!P[defId]; };
  S.painters = P;

  function fallbackPainter(ctx, t, o, V) {
    var b = Math.sin(t * 2.4) * 2;
    var tt = T5('#7a7086');
    blob(ctx, [-14, -4, -16, -30 + b, 0, -44 + b, 16, -30 + b, 14, -4]);
    ctx.fillStyle = litS(ctx, 16, tt, V.lx); ctx.fill(); outline(ctx);
    ctx.save(); ctx.globalAlpha *= V.fw;
    eyeV(ctx, -5 + V.sf * 5, -28 + b, 3, V); eyeV(ctx, 5 + V.sf * 5, -28 + b, 3, V);
    ctx.restore();
  }

  // ======================================================================
  // HERÓIS
  // ======================================================================

  // --- Repique (hero-toll) — Sineiro TANQUE: cabeça-sino, corpo-cúpula ---
  P['hero-toll'] = function (ctx, t, o, V) {
    var br = Math.sin(t * 1.6) * 1.3;                 // respiração
    var sw = Math.sin(t * 2.1) * 4 + V.sf * 3;        // badalo pendula
    var bronze = T5('#b08543'), verd = '#3f8f7a', hi = '#ffd98a';
    var i, s;

    // ---- pernas: suportes de campanário, rebitados
    var legR = V.pt(0, 9), legL = V.pt(0, -9);
    function leg(px, near) {
      ctx.fillStyle = lgrad(ctx, px - 6, -14, px + 6, 0, [0, near ? bronze.sh : bronze.dk, 1, bronze.dk]);
      poly(ctx, [px - 5.5, 0, px + 5.5, 0, px + 4.5, -13, px - 4.5, -13]); ctx.fill(); outline(ctx, 2);
      ctx.fillStyle = bronze.md; ell(ctx, px, -12, 4.6, 3.2); ctx.fill(); outline(ctx, 1.4);
    }
    if (legL.z < legR.z) { leg(legL.x, false); leg(legR.x, true); }
    else { leg(legR.x, false); leg(legL.x, true); }

    // ---- braços (o de trás antes do corpo)
    function arm(p, near) {
      var ax = p.x * 2.6;
      ctx.strokeStyle = near ? bronze.sh : bronze.dk; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ax * 0.82, -30 + br);
      ctx.quadraticCurveTo(ax * 1.06, -24 + br, ax, -15 + br * 0.5); ctx.stroke();
      // manopla
      ctx.fillStyle = near ? bronze.md : bronze.sh;
      ell(ctx, ax, -13 + br * 0.5, 5, 5.6); ctx.fill(); outline(ctx, 1.8);
      ctx.strokeStyle = rgba('#4c3a1c', 0.7); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(ax - 3, -14 + br * 0.5); ctx.lineTo(ax + 3, -14 + br * 0.5); ctx.stroke();
    }
    var armR = V.pt(0, 10), armL = V.pt(0, -10);
    if (armL.z < armR.z) arm(armL, false); else arm(armR, false);

    // ---- corpo cúpula pesada
    var bodyW = 23 * (1 - Math.abs(V.sf) * 0.1);
    var body = function () {
      blob(ctx, [-bodyW, -8, -bodyW - 1, -26, 0, -37 + br, bodyW + 1, -26, bodyW, -8]);
    };
    body();
    ctx.fillStyle = litH(ctx, bodyW, bronze, V.lx); ctx.fill(); outline(ctx, 2.4);
    aoV(ctx, body, -18, -6, 0.3);
    // fileira de rebites na barra (giram com o yaw!)
    for (i = -3; i <= 3; i++) {
      s = V.surf(i * 0.42, bodyW * 0.9);
      if (s.k < -0.1) continue;
      ctx.fillStyle = rgba(shade('#b08543', 0.3 * s.k), 0.55 + s.k * 0.4);
      ell(ctx, s.x, -11 + Math.abs(s.x) * 0.06, 1.5, 1.5); ctx.fill();
    }
    // veias de azinhavre na superfície (por azimute)
    ctx.lineWidth = 1.7; ctx.lineCap = 'round';
    for (i = 0; i < 3; i++) {
      s = V.surf(0.8 + i * 2.0, bodyW * 0.78);
      if (s.k < 0.05) continue;
      ctx.strokeStyle = rgba(verd, 0.32 + s.k * 0.5);
      ctx.beginPath(); ctx.moveTo(s.x, -12);
      ctx.quadraticCurveTo(s.x + 4 * s.k, -21, s.x - 2, -29 + br); ctx.stroke();
    }
    // cinto de corda puída
    ctx.strokeStyle = '#6b5030'; ctx.lineWidth = 3.6;
    ctx.beginPath(); ctx.moveTo(-bodyW + 2, -15); ctx.quadraticCurveTo(0, -9 + br * 0.4, bodyW - 2, -15); ctx.stroke();
    ctx.strokeStyle = rgba('#3d2c14', 0.7); ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(-bodyW + 2, -14); ctx.quadraticCurveTo(0, -8 + br * 0.4, bodyW - 2, -14); ctx.stroke();
    // nó do cinto acompanha a frente
    var knot = V.surf(0, bodyW * 0.8);
    if (knot.k > 0) {
      ctx.fillStyle = '#7a5c36'; ell(ctx, knot.x, -12 + br * 0.3, 3, 3.4); ctx.fill(); outline(ctx, 1.2);
    }
    // braço da frente
    if (armL.z < armR.z) arm(armR, true); else arm(armL, true);

    // ---- cabeça-sino (boca para baixo)
    var hw = 16 * (1 - Math.abs(V.sf) * 0.08);
    var by = -36 + br;
    var bell = function () {
      ctx.beginPath();
      ctx.moveTo(-hw - 2, by);
      ctx.quadraticCurveTo(-hw - 3, by - 20, -hw * 0.55, by - 28);
      ctx.quadraticCurveTo(0, by - 33, hw * 0.55, by - 28);
      ctx.quadraticCurveTo(hw + 3, by - 20, hw + 2, by);
      ctx.quadraticCurveTo(hw * 1.28, by + 4.5, 0, by + 5.5);
      ctx.quadraticCurveTo(-hw * 1.28, by + 4.5, -hw - 2, by);
      ctx.closePath();
    };
    bell();
    ctx.fillStyle = litH(ctx, hw + 3, bronze, V.lx); ctx.fill(); outline(ctx, 2.5);
    // banda gravada + runa que gira com a superfície
    ctx.strokeStyle = rgba('#4c3a1c', 0.8); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-hw - 1, by - 6); ctx.quadraticCurveTo(0, by - 2.5, hw + 1, by - 6); ctx.stroke();
    for (i = -2; i <= 2; i++) {
      s = V.surf(i * 0.55, hw * 0.92);
      if (s.k < 0.08) continue;
      ctx.strokeStyle = rgba('#4c3a1c', 0.35 + s.k * 0.45); ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(s.x - 1.4, by - 9); ctx.lineTo(s.x + 1.4, by - 12.5); ctx.stroke();
    }
    // veia de azinhavre na cabeça (costas ficam mais marcadas)
    s = V.surf(Math.PI * 0.85, hw * 0.8);
    if (s.k > 0) {
      ctx.strokeStyle = rgba(verd, 0.3 + s.k * 0.55); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(s.x, by - 26);
      ctx.quadraticCurveTo(s.x - 3, by - 16, s.x + 1, by - 7); ctx.stroke();
    }
    // brilho especular metálico no lado da luz
    var spx = V.lx >= 0 ? hw * 0.55 : -hw * 0.55;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(hi, 0.5); ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(spx, by - 24); ctx.quadraticCurveTo(spx * 1.5, by - 16, spx * 1.25, by - 8); ctx.stroke();
    ctx.restore();
    rimL(ctx, bell, hw + 3, o.tintAccent || hi, V.lx, 2.2, 0.5);

    // BOCA do sino + badalo: o "rosto" — visível de frente
    if (V.fw > 0.04) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var mw = hw * 1.1 * (0.45 + 0.55 * V.fw);
      ctx.fillStyle = '#241708';
      ell(ctx, V.sf * 4, by + 4.5, mw, 4.6 * V.fw + 1.2); ctx.fill();
      ctx.strokeStyle = rgba('#0e0904', 0.8); ctx.lineWidth = 1.4; ctx.stroke();
      // badalo pendente balançando
      var bx = V.sf * 4 + sw * 0.8;
      ctx.strokeStyle = '#3a2c16'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(V.sf * 4, by - 2); ctx.lineTo(bx, by + 7); ctx.stroke();
      ctx.fillStyle = lgrad(ctx, bx - 4, by + 3, bx + 4, by + 11, [0, hi, 1, bronze.dk]);
      ell(ctx, bx, by + 8.5, 4, 4.4); ctx.fill(); outline(ctx, 1.6);
      glowDot(ctx, bx, by + 8.5, 8, hi, 0.4 * V.fw);
      ctx.restore();
    }
    // costas do sino: placa de memória aparafusada
    if (V.bk > 0.35) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.35) / 0.65;
      var px2 = -V.sf * 3;
      ctx.fillStyle = rgba('#8a6530', 0.9);
      poly(ctx, [px2 - 6, by - 22, px2 + 6, by - 22, px2 + 5, by - 10, px2 - 5, by - 10]); ctx.fill();
      ctx.strokeStyle = rgba('#3d2c14', 0.8); ctx.lineWidth = 1.2; ctx.stroke();
      ctx.strokeStyle = rgba('#4c3a1c', 0.7);
      ctx.beginPath(); ctx.moveTo(px2 - 3.4, by - 18.5); ctx.lineTo(px2 + 3.4, by - 18.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px2 - 3.4, by - 15.5); ctx.lineTo(px2 + 2, by - 15.5); ctx.stroke();
      ctx.fillStyle = verd;
      ell(ctx, px2 - 4.6, by - 21, 0.9, 0.9); ctx.fill(); ell(ctx, px2 + 4.6, by - 21, 0.9, 0.9); ctx.fill();
      ctx.restore();
    }
    // alça no topo (sempre)
    ctx.strokeStyle = bronze.dk; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, by - 31, 4.4, Math.PI, 0); ctx.stroke();
    ctx.strokeStyle = rgba(hi, 0.35); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(V.lx * 0.8, by - 31.6, 4.4, Math.PI * 1.1, Math.PI * 1.7); ctx.stroke();
  };

  // --- Estopim (hero-wick) — Pávia ASSASSINA: gota de cera, chama viva ---
  P['hero-wick'] = function (ctx, t, o, V) {
    var fl = Math.sin(t * 9) * 1.6 + Math.sin(t * 23) * 0.8;   // chama tremula
    var sw = Math.sin(t * 1.7) * 1.4;                          // balanço
    var wax = T5('#ecd9ac'), drip = '#b98d5e', fla = '#ff8c3a';
    var i, s;

    // ---- adaga de cera na mão direita (orbita com o yaw)
    var hand = V.pt(3, 11);
    function dagger() {
      ctx.save(); ctx.translate(hand.x * 1.7, -20 + sw);
      ctx.rotate(0.5 + V.sf * 0.25);
      ctx.fillStyle = lgrad(ctx, 0, -12, 0, 2, [0, '#ffb877', 0.45, '#d98a48', 1, '#8a5a44']);
      poly(ctx, [-1.6, 2, -2.6, -6, 0, -13, 2.6, -6, 1.6, 2]); ctx.fill(); outline(ctx, 1.3);
      glowDot(ctx, 0, -9, 6, fla, 0.3);
      ctx.fillStyle = '#6b4630'; ell(ctx, 0, 2.4, 2.6, 1.8); ctx.fill();
      ctx.restore();
    }
    function armB(p, near) { // braço fino
      var ax = p.x * 1.7;
      ctx.strokeStyle = near ? wax.md : wax.sh; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.x * 0.55, -40 + sw);
      ctx.quadraticCurveTo(ax * 1.15, -32 + sw, ax, -20 + sw); ctx.stroke();
      // dedos longos que pingam
      ctx.strokeStyle = rgba(near ? wax.lt : wax.sh, 0.9); ctx.lineWidth = 1.3;
      for (var j = -1; j <= 1; j++) {
        ctx.beginPath(); ctx.moveTo(ax + j * 1.8, -20 + sw);
        ctx.lineTo(ax + j * 2.5, -13 + sw + Math.abs(j) * 1.4); ctx.stroke();
      }
    }
    var handL = V.pt(3, -11);
    if (hand.z < 0) { dagger(); armB(hand, false); } else if (handL.z < 0) armB(handL, false);

    // ---- corpo: gota escorrida alta e fina
    var bw = 9 * (1 - Math.abs(V.sf) * 0.12);
    var body = function () {
      ctx.beginPath();
      ctx.moveTo(-bw - 1, 0);
      ctx.quadraticCurveTo(-bw - 4, -7, -bw + 1.5, -16);
      ctx.quadraticCurveTo(-bw - 1.5, -30, -bw + 2.5, -44 + sw);
      ctx.quadraticCurveTo(-bw + 1, -56 + sw, 0, -60 + sw);
      ctx.quadraticCurveTo(bw - 1, -56 + sw, bw - 2.5, -44 + sw);
      ctx.quadraticCurveTo(bw + 1.5, -28, bw - 1, -16);
      ctx.quadraticCurveTo(bw + 4, -6, bw * 0.6, 0);
      ctx.quadraticCurveTo(bw * 0.9, -2.6, bw * 0.2, -2);
      ctx.quadraticCurveTo(-2, -3.6, -bw - 1, 0);
      ctx.closePath();
    };
    body();
    ctx.fillStyle = litH(ctx, bw + 3, wax, V.lx); ctx.fill(); outline(ctx, 2.2);
    aoV(ctx, body, -14, 0, 0.28);
    // translucidez da cera: luz interna sobe do peito
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgrad(ctx, V.sf * 3, -46 + sw, 14, [0, rgba('#ffcf8a', 0.22), 1, rgba('#ffcf8a', 0)]);
    ell(ctx, V.sf * 3, -46 + sw, 9, 13); ctx.fill(); ctx.restore();
    // escorridos na superfície (giram por azimute)
    ctx.lineCap = 'round';
    for (i = 0; i < 4; i++) {
      s = V.surf(0.5 + i * 1.55, bw * 0.9);
      if (s.k < 0.05) continue;
      ctx.strokeStyle = rgba(drip, 0.25 + s.k * 0.45); ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(s.x, -38 + sw + i * 4);
      ctx.quadraticCurveTo(s.x + 1.5 * s.k, -28 + i * 3, s.x - 1, -18 + i * 2.5); ctx.stroke();
      ctx.fillStyle = rgba(drip, 0.3 + s.k * 0.4);
      ell(ctx, s.x - 1, -17 + i * 2.5, 1.5, 2); ctx.fill();
    }

    // capa de cera escorrida nos OMBROS (mais grossa vista de costas)
    var capeA = 0.55 + V.bk * 0.45;
    ctx.fillStyle = rgba(mix('#8a5a44', '#5c3a2c', V.bk), 0.92 * capeA);
    var cape = function () {
      ctx.beginPath();
      ctx.moveTo(-bw - 2, -50 + sw);
      ctx.quadraticCurveTo(-bw - 6 - V.bk * 3, -42, -bw - 3 - V.bk * 2, -30 + V.bk * 4);
      ctx.quadraticCurveTo(-bw + 1, -36, -bw + 0.5, -47 + sw);
      ctx.lineTo(bw - 0.5, -47 + sw);
      ctx.quadraticCurveTo(bw - 1, -36, bw + 3 + V.bk * 2, -30 + V.bk * 4);
      ctx.quadraticCurveTo(bw + 6 + V.bk * 3, -44, bw + 2, -50 + sw);
      ctx.quadraticCurveTo(0, -54 + sw - V.bk * 2, -bw - 2, -50 + sw);
      ctx.closePath();
    };
    cape(); ctx.fill(); outline(ctx, 1.8);
    // pingos endurecidos da capa (costas)
    if (V.bk > 0.3) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.3) / 0.7;
      ctx.fillStyle = '#7c4e38';
      for (i = -2; i <= 2; i++) {
        ell(ctx, -V.sf * 4 + i * 3.6, -33 + Math.abs(i) * 2 + Math.sin(t * 1.5 + i) * 0.6, 1.5, 3.2); ctx.fill();
      }
      ctx.restore();
    }

    // ---- rosto (frente): olhos-brasa + sorriso ladino
    var hy = -51 + sw;
    if (V.fw > 0.05) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var fx0 = V.sf * 4.2;
      eyeV(ctx, fx0 - 3.2, hy, 2.6, V, fla);
      eyeV(ctx, fx0 + 3.6, hy, 2.6, V, fla);
      glowDot(ctx, fx0 - 3.2, hy, 5, fla, 0.5 * V.fw);
      glowDot(ctx, fx0 + 3.6, hy, 5, fla, 0.5 * V.fw);
      // sobrancelhas espertas
      ctx.strokeStyle = rgba('#8a5a44', 0.85); ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(fx0 - 5.4, hy - 3.6); ctx.lineTo(fx0 - 1.4, hy - 4.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx0 + 1.8, hy - 4.8); ctx.lineTo(fx0 + 5.6, hy - 3.4); ctx.stroke();
      // sorriso de canto
      ctx.strokeStyle = rgba('#5a3a24', 0.85); ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(fx0 - 1.5, hy + 4.6);
      ctx.quadraticCurveTo(fx0 + 2, hy + 6.2, fx0 + 4.6, hy + 3.8); ctx.stroke();
      ctx.restore();
    }
    // costas da cabeça: mechas de cera escorrida
    if (V.bk > 0.3) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.3) / 0.7;
      ctx.strokeStyle = rgba('#c9a06a', 0.8); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      for (i = -2; i <= 2; i++) {
        var mx = -V.sf * 4 + i * 2.6;
        ctx.beginPath(); ctx.moveTo(mx, hy - 6);
        ctx.quadraticCurveTo(mx + 1.2, hy - 1, mx - 0.8, hy + 5 + Math.abs(i)); ctx.stroke();
      }
      ctx.restore();
    }
    rimL(ctx, body, bw + 3, o.tintAccent || fla, V.lx, 2, 0.5);

    // braço/adaga da frente
    if (hand.z >= 0) { armB(hand, true); dagger(); }
    if (handL.z >= 0) armB(handL, true);

    // ---- pavio + CHAMA (único ponto de luz forte — visível de todo ângulo)
    var wy = -60 + sw;
    ctx.strokeStyle = '#4a3220'; ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.moveTo(0, wy); ctx.lineTo(fl * 0.25 - V.sf * 1.5, wy - 4.5); ctx.stroke();
    var fx = fl * 0.5 - V.sf * 2, fy = wy - 4.5;
    ctx.fillStyle = fla;
    blob(ctx, [fx - 4, fy, fx - 2.4, fy - 7 - fl, fx + fl * 0.8, fy - 13 - fl, fx + 3, fy - 6.5, fx + 4, fy]);
    ctx.fill();
    ctx.fillStyle = '#ffe9b0';
    blob(ctx, [fx - 2, fy - 1, fx - 1.2, fy - 5.5, fx + fl * 0.4, fy - 8, fx + 2, fy - 4.5, fx + 2, fy - 1]);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ell(ctx, fx + fl * 0.15, fy - 3.4, 1.2, 2); ctx.fill();
    glowDot(ctx, fx, fy - 5, 17, fla, 0.6);
  };

  // --- Morela (hero-morel) — Micele INVOCADORA: chapéu-guarda-chuva, véu ---
  P['hero-morel'] = function (ctx, t, o, V) {
    var y = Math.sin(t * 1.5) * 2.2;                    // flutua
    var pu = (Math.sin(t * 2.6) + 1) / 2;               // pulso bioluminescente
    var vio = T5('#7a5fa0'), tur = '#6fe0c8', cream = '#d8cec2';
    var i, s;
    var capW = 27 * (1 - Math.abs(V.sf) * 0.06);
    var capPulse = 1 + pu * 0.035;

    // ---- filamentos no lugar dos pés (deslizam, radiais)
    ctx.lineCap = 'round';
    for (i = -3; i <= 3; i++) {
      s = V.surf(i * 0.75, 6);
      ctx.strokeStyle = rgba('#cfc8e8', 0.4 + Math.max(s.k, 0) * 0.4);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(s.x * 0.6, -8 + y);
      ctx.quadraticCurveTo(s.x + Math.sin(t * 2 + i) * 2, -3 + y, s.x * 1.6 + Math.sin(t * 2.6 + i) * 3, 0);
      ctx.stroke();
    }

    // ---- corpo esguio (haste do cogumelo)
    var body = function () {
      blob(ctx, [-7, -8 + y, -8, -26 + y, 0, -35 + y, 8, -26 + y, 7, -8 + y]);
    };
    body();
    var bodyT = T5(mix('#d8cec2', '#7a5fa0', 0.25));
    ctx.fillStyle = litS(ctx, 8, bodyT, V.lx); ctx.fill(); outline(ctx, 2.2);
    aoV(ctx, body, -16 + y, -6 + y, 0.3);

    // braços delicados
    function armM(p, near) {
      var ax = p.x * 1.6;
      ctx.strokeStyle = near ? shade('#9a86bd', 0.06) : shade('#7a5fa0', -0.2);
      ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.x * 0.8, -26 + y);
      ctx.quadraticCurveTo(ax * 1.2, -20 + y, ax, -12 + y + Math.sin(t * 2 + p.x) * 1.5); ctx.stroke();
    }
    var aR = V.pt(2, 8), aL = V.pt(2, -8);
    if (aL.z < aR.z) { armM(aL, false); armM(aR, true); }
    else { armM(aR, false); armM(aL, true); }

    // ---- costas: capuz + bolsa de esporos (só de costas)
    if (V.bk > 0.25) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.25) / 0.75;
      var bx = -V.sf * 5;
      // trouxinha de esporos amarrada
      ctx.fillStyle = '#4a3f5c';
      blob(ctx, [bx - 6, -18 + y, bx - 5, -27 + y, bx, -29 + y, bx + 5, -27 + y, bx + 6, -18 + y, bx, -15 + y]);
      ctx.fill(); outline(ctx, 1.6);
      ctx.strokeStyle = rgba(tur, 0.5); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(bx - 5, -24 + y); ctx.quadraticCurveTo(bx, -21 + y, bx + 5, -24 + y); ctx.stroke();
      // esporinhos dormindo dentro (pontinhos)
      ctx.fillStyle = rgba(tur, 0.5 + pu * 0.3);
      ell(ctx, bx - 2, -22 + y, 1.1, 1.1); ctx.fill();
      ell(ctx, bx + 2.4, -20 + y, 0.9, 0.9); ctx.fill();
      ctx.restore();
    }

    // ---- VÉU de lamelas (cai do chapéu na frente — cobre o rosto)
    if (V.fw > 0.04) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var vx = V.sf * 6;
      var vw = 15;
      ctx.fillStyle = rgba(shade('#7a5fa0', -0.3), 0.94);
      poly(ctx, [vx - vw, -37 + y, vx + vw, -37 + y, vx + vw - 3.4, -17 + y, vx - vw + 3.4, -17 + y]);
      ctx.fill();
      // dois brilhos de olhos ATRÁS do véu (misteriosos)
      glowDot(ctx, vx - 4, -29 + y, 4.5, tur, (0.3 + pu * 0.35) * V.fw);
      glowDot(ctx, vx + 4, -29 + y, 4.5, tur, (0.3 + pu * 0.35) * V.fw);
      // lamelas verticais com brilho pulsante
      for (i = -3; i <= 3; i++) {
        ctx.strokeStyle = rgba(tur, (0.2 + pu * 0.5) * (1 - Math.abs(i) / 4.4));
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(vx + i * 4.1, -37 + y);
        ctx.lineTo(vx + i * 3.6, -18 + y + Math.sin(t * 3 + i) * 1.3); ctx.stroke();
      }
      // barra ondulada do véu
      ctx.strokeStyle = rgba('#4a3f5c', 0.8); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(vx - vw + 3, -17.4 + y);
      ctx.quadraticCurveTo(vx, -15.4 + y + Math.sin(t * 2.2) * 0.8, vx + vw - 3, -17.4 + y); ctx.stroke();
      ctx.restore();
    }

    // ---- CHAPÉU carnudo largo (pulsa)
    var cy = -36 + y;
    var cw = capW * capPulse, ch = 21 * capPulse;
    var cap = function () {
      ctx.beginPath();
      ctx.moveTo(-cw, cy + 1);
      ctx.quadraticCurveTo(-cw * 0.9, cy - ch * 0.85, 0, cy - ch);
      ctx.quadraticCurveTo(cw * 0.9, cy - ch * 0.85, cw, cy + 1);
      ctx.quadraticCurveTo(0, cy + 7, -cw, cy + 1);
      ctx.closePath();
    };
    cap();
    ctx.fillStyle = litH(ctx, cw, vio, V.lx); ctx.fill(); outline(ctx, 2.5);
    // pintas na superfície do chapéu (por azimute — giram!)
    for (i = 0; i < 6; i++) {
      s = V.surf(-2.4 + i * 0.95, cw * 0.72);
      if (s.k < 0.02) continue;
      ctx.fillStyle = rgba('#ded4f2', 0.28 + s.k * 0.5);
      ell(ctx, s.x, cy - ch * (0.32 + (i % 3) * 0.18), (2.6 - (i % 2)) * (0.5 + s.k * 0.5), 2 - (i % 2) * 0.6);
      ctx.fill();
    }
    // borda bioluminescente
    ctx.strokeStyle = rgba(tur, 0.3 + pu * 0.45); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-cw + 1, cy + 1.4); ctx.quadraticCurveTo(0, cy + 7.4, cw - 1, cy + 1.4); ctx.stroke();
    glowDot(ctx, V.lx * cw * 0.4, cy - ch * 0.5, cw * 0.7, tur, 0.1 + pu * 0.12);
    rimL(ctx, cap, cw, o.tintAccent || tur, V.lx, 2.2, 0.55);

    // ---- esporos flutuando ao redor (órbita no espaço do mundo)
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < 6; i++) {
      var a = t * 0.7 + i * 1.05;
      s = V.surf(a, 22 + Math.sin(t + i * 2) * 5);
      var sy2 = cy - 4 + Math.sin(a * 1.3) * 14;
      var depth = 0.55 + Math.max(s.k, -0.4) * 0.45;
      ctx.fillStyle = rgba(tur, (0.22 + pu * 0.25) * depth);
      ell(ctx, s.x, sy2, 1.4 * depth + 0.4, 1.4 * depth + 0.4); ctx.fill();
    }
    ctx.restore();
  };

  // --- Rosácea (hero-rose) — Vitrélia SUPORTE: vitral vivo, núcleo de luz ---
  P['hero-rose'] = function (ctx, t, o, V) {
    var sh2 = Math.sin(t * 1.2) * 1.2;
    var pu = (Math.sin(t * 2.2) + 1) / 2;
    var azul = '#6d7fd3', gold = '#ffd166', rose = '#d36da8', lead = '#c9a24a', leadD = '#8a7434';
    var i;
    var shimmer = ((t * 0.5) % 2.4) / 2.4;              // varredura especular

    // manchas de cor projetadas no chão — caem na direção do facing
    ctx.save(); ctx.globalAlpha *= 0.3; ctx.globalCompositeOperation = 'lighter';
    var px = V.sf * 10;
    ctx.fillStyle = azul; ell(ctx, px - 8, 1.5, 8, 3); ctx.fill();
    ctx.fillStyle = gold; ell(ctx, px + 6, 2.5, 6.5, 2.4); ctx.fill();
    ctx.fillStyle = rose; ell(ctx, px, 3.4, 4.6, 1.8); ctx.fill();
    ctx.restore();

    // pernas: lâminas de vidro
    var lw2 = 1 - Math.abs(V.sf) * 0.2;
    ctx.fillStyle = mix(azul, '#2e2a4a', 0.45);
    poly(ctx, [-9 * lw2, 0, -3.4 * lw2, -2, -5.4 * lw2, -16, -11 * lw2, -14]); ctx.fill(); outline(ctx, 1.5);
    poly(ctx, [3.4 * lw2, -2, 9 * lw2, 0, 11 * lw2, -14, 5.4 * lw2, -16]); ctx.fill(); outline(ctx, 1.5);

    // placa de vitral com chumbo + brilho conforme luz e ângulo
    function plate(pts, col, litK) {
      poly(ctx, pts);
      var tt = T5(col);
      ctx.fillStyle = rgba(litK > 0 ? tt.lt : (litK < 0 ? tt.sh : tt.md), 0.96);
      ctx.fill();
      ctx.strokeStyle = leadD; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.strokeStyle = rgba(lead, 0.55); ctx.lineWidth = 0.8; ctx.stroke();
    }
    // torso facetado — 4 placas; brilho depende do lado da luz
    var wS = 1 - Math.abs(V.sf) * 0.22;
    var L = V.lx >= 0 ? 1 : -1;
    plate([-14 * wS, -14, 0, -20 + sh2, -4 * wS, -34, -16 * wS, -30], azul, -L);
    plate([0, -20 + sh2, 14 * wS, -14, 16 * wS, -30, 4 * wS, -34], mix(azul, '#8a5fd3', 0.5), L);
    plate([-16 * wS, -30, -4 * wS, -34, 0, -46 + sh2, -12 * wS, -44], mix(azul, gold, 0.35), -L);
    plate([4 * wS, -34, 16 * wS, -30, 12 * wS, -44, 0, -46 + sh2], mix(azul, rose, 0.3), L);

    // FRENTE: cena do amanhecer gravada no peito / COSTAS: grade de chumbo
    if (V.fw > 0.06) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var cxx = V.sf * 5;
      // sol nascente em vitral
      ctx.fillStyle = rgba('#ffd166', 0.85);
      ctx.beginPath(); ctx.arc(cxx, -27, 4.6, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba('#8a7434', 0.9); ctx.lineWidth = 1.2; ctx.stroke();
      for (i = -2; i <= 2; i++) {
        ctx.strokeStyle = rgba(gold, 0.6); ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.moveTo(cxx + i * 3, -28.5);
        ctx.lineTo(cxx + i * 4.4, -33 - Math.abs(i)); ctx.stroke();
      }
      // núcleo de luz no peito (visível através das placas)
      glowDot(ctx, cxx, -30, 14 + pu * 5, gold, 0.8 * V.fw);
      ctx.fillStyle = '#fff3d0'; ell(ctx, cxx, -30, 3 + pu, 3.4 + pu); ctx.fill();
      ctx.restore();
    }
    if (V.bk > 0.25) {
      // costas: treliça de chumbo densa, com o brilho do núcleo vazando pelas frestas
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.25) / 0.75;
      var bx = -V.sf * 5;
      ctx.strokeStyle = leadD; ctx.lineWidth = 1.7;
      for (i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(bx + i * 6, -16); ctx.lineTo(bx + i * 4.4, -43); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(bx - 9, -24); ctx.lineTo(bx + 9, -25.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx - 8, -35); ctx.lineTo(bx + 8, -36); ctx.stroke();
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(gold, 0.3 + pu * 0.3); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bx - 2, -22); ctx.lineTo(bx - 3, -40); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx + 3, -20); ctx.lineTo(bx + 4, -38); ctx.stroke();
      ctx.restore();
      ctx.restore();
    }
    // varredura especular no vidro (idle vivo)
    ctx.save();
    poly(ctx, [-16 * wS, -14, 16 * wS, -14, 12 * wS, -46 + sh2, -12 * wS, -46 + sh2]);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    var sx2 = -22 + shimmer * 44;
    ctx.fillStyle = lgrad(ctx, sx2 - 6, 0, sx2 + 6, 0, [0, 'rgba(255,255,255,0)', 0.5, 'rgba(255,255,255,0.22)', 1, 'rgba(255,255,255,0)']);
    ctx.fillRect(-18, -48, 36, 36);
    ctx.restore();

    // braços angulosos
    function armR2(p, near) {
      var ax = p.x * 1.55;
      plate([ax * 0.72, -30, ax * 1.35, -25, ax * 1.28, -17, ax * 0.6, -22],
        near ? mix(azul, gold, 0.25) : mix(azul, '#2e2a4a', 0.3), near ? L : -L);
    }
    var pR = V.pt(1, 14), pL = V.pt(1, -14);
    if (pL.z < pR.z) { armR2(pL, false); armR2(pR, true); }
    else { armR2(pR, false); armR2(pL, true); }

    // ---- cabeça: ROSÁCEA — disco que gira de verdade (rx encolhe no perfil)
    var cy = -57 + sh2;
    var discR = 11.5;
    var rx = discR * Math.max(Math.abs(V.cf), 0.22);
    // pescoço de chumbo
    ctx.strokeStyle = leadD; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, cy + 10); ctx.lineTo(0, -46 + sh2); ctx.stroke();
    // aro
    ctx.save();
    ctx.translate(V.sf * 2, cy);
    ctx.fillStyle = mix('#2e2a4a', azul, 0.3);
    ell(ctx, 0, 0, rx + 1.6, discR + 1.6); ctx.fill(); outline(ctx, 2);
    // pétalas da rosácea (frente colorida, costas com chumbo)
    var petCols = [azul, gold, rose, mix(azul, tur0(), 0.5)];
    for (i = 0; i < 8; i++) {
      var a2 = (i / 8) * Math.PI * 2 + t * 0.12;
      var pxx = Math.cos(a2) * rx * 0.62, pyy = Math.sin(a2) * discR * 0.62;
      ctx.save(); ctx.translate(pxx, pyy); ctx.rotate(Math.atan2(pyy, pxx) + Math.PI / 2);
      poly(ctx, [0, -4.6 * (rx / discR + 0.3), -3 * (rx / discR + 0.2), 2.4, 3 * (rx / discR + 0.2), 2.4]);
      var col = V.fw > 0.4 ? petCols[i % petCols.length] : mix(petCols[i % petCols.length], '#2e2a4a', 0.55);
      ctx.fillStyle = rgba(col, 0.95); ctx.fill();
      ctx.strokeStyle = leadD; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
    }
    // olho central
    ctx.fillStyle = V.fw > 0.3 ? '#fff3d0' : rgba('#fff3d0', 0.5);
    ell(ctx, 0, 0, Math.max(rx * 0.24, 1.4), 2.8); ctx.fill();
    ctx.restore();
    glowDot(ctx, V.sf * 2, cy, 9 + pu * 3, o.tintAccent || gold, 0.35 + V.fw * 0.25);

    function tur0() { return '#6fe0c8'; }
  };

  // --- Sibilo (hero-whistle) — Fôlego CONTROLE: torso-sanfona que respira ---
  P['hero-whistle'] = function (ctx, t, o, V) {
    var br = Math.sin(t * 1.7);                       // fole
    var puff = 1 + br * 0.1;
    var verde = T5('#7fb6b0'), ard = '#4a5a66', nev = '#eef7f5', brass = '#c9a24a', wood = '#c9b892';
    var hov = Math.sin(t * 2.1) * 1.5;
    var y = hov;
    var i, s;

    // pés pequenos
    var fR = V.pt(0, 7), fL = V.pt(0, -7);
    ctx.fillStyle = ard;
    ell(ctx, fL.x, -2 + y * 0.3, 3.8, 2.3); ctx.fill(); outline(ctx, 1.3);
    ell(ctx, fR.x, -2 + y * 0.3, 3.8, 2.3); ctx.fill(); outline(ctx, 1.3);
    ctx.strokeStyle = ard; ctx.lineWidth = 2.8;
    ctx.beginPath(); ctx.moveTo(fL.x, -3 + y * 0.3); ctx.lineTo(fL.x * 0.85, -14 + y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fR.x, -3 + y * 0.3); ctx.lineTo(fR.x * 0.85, -14 + y); ctx.stroke();

    // quadril de madeira pálida
    var wT = T5(wood);
    ctx.fillStyle = litS(ctx, 11, wT, V.lx);
    poly(ctx, [-11, -12 + y, 11, -12 + y, 9, -18 + y, -9, -18 + y]); ctx.fill(); outline(ctx, 1.7);

    var hFole = 22, top = -18 - hFole + y;
    var wTop = 13, wBot = 11;

    // braço de trás
    function armW(p, near) {
      var ax = p.x * 1.75;
      ctx.strokeStyle = near ? verde.md : verde.dk; ctx.lineWidth = 4.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.x * 0.9, top - 2);
      ctx.quadraticCurveTo(ax * 1.25, top + 6 + br * 2, ax, top + 18); ctx.stroke();
      // anéis do tubo
      ctx.strokeStyle = rgba('#2c3a42', 0.55); ctx.lineWidth = 1;
      for (var j = 0; j < 3; j++) {
        ctx.beginPath(); ctx.arc(ax * (1.05 + j * 0.02), top + 7 + j * 4, 2.5, 0.4, 2.7); ctx.stroke();
      }
      // apito na ponta
      ctx.fillStyle = brass; ell(ctx, ax, top + 18.5, 2.5, 3.3); ctx.fill(); outline(ctx, 1.2);
      ctx.fillStyle = '#20303a'; ell(ctx, ax, top + 17.4, 1, 1.2); ctx.fill();
    }
    var wR = V.pt(1, 12), wL = V.pt(1, -12);
    if (wL.z < wR.z) armW(wL, false); else armW(wR, false);

    // ---- TORSO-SANFONA (pregas curvam no perfil — cilindro de verdade)
    var n = 5;
    var curve = V.sf * 3.2;                          // curvatura das pregas no perfil
    for (i = 0; i < n; i++) {
      var k = i / (n - 1);
      var yy = top + hFole * k;
      var w1 = (wBot + (wTop - wBot) * (1 - k)) * (1 + Math.sin(k * Math.PI) * br * 0.14);
      var col = i % 2 ? mix('#7fb6b0', '#ffffff', 0.16) : '#7fb6b0';
      var tt2 = T5(col);
      ctx.fillStyle = litH(ctx, w1, tt2, V.lx);
      ctx.beginPath();
      ctx.moveTo(-w1, yy);
      ctx.quadraticCurveTo(curve, yy + 1.6, w1, yy);
      ctx.lineTo(w1 * 0.94, yy + hFole / n + 0.8);
      ctx.quadraticCurveTo(curve * 0.9, yy + hFole / n + 2.2, -w1 * 0.94, yy + hFole / n + 0.8);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba('#2c3a42', 0.6); ctx.lineWidth = 1.2; ctx.stroke();
    }
    // anéis de latão topo/base
    ctx.strokeStyle = brass; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(-wTop - 1, top + 0.6); ctx.quadraticCurveTo(curve, top + 2, wTop + 1, top + 0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-wBot - 1, -18 + y); ctx.quadraticCurveTo(curve, -16.6 + y, wBot + 1, -18 + y); ctx.stroke();

    // costas: placa de madeira + correias + 3 canos de órgão
    if (V.bk > 0.25) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.25) / 0.75;
      var bx = -V.sf * 6;
      ctx.fillStyle = litS(ctx, 8, wT, V.lx);
      poly(ctx, [bx - 8, top + 2, bx + 8, top + 2, bx + 6.6, top + hFole - 2, bx - 6.6, top + hFole - 2]);
      ctx.fill(); outline(ctx, 1.6);
      // correias em X
      ctx.strokeStyle = '#6b5844'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(bx - 7, top + 3); ctx.lineTo(bx + 6, top + hFole - 3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx + 7, top + 3); ctx.lineTo(bx - 6, top + hFole - 3); ctx.stroke();
      // canos de órgão saindo do ombro
      for (i = -1; i <= 1; i++) {
        var phh = ((t * 1.4 + i) % 1);
        ctx.fillStyle = brass;
        poly(ctx, [bx + i * 4.4 - 1.4, top + 2, bx + i * 4.4 + 1.4, top + 2, bx + i * 4.4 + 1.1, top - 8 - Math.abs(i) * -2 - (i === 0 ? 4 : 0), bx + i * 4.4 - 1.1, top - 8 - (i === 0 ? 4 : 0)]);
        ctx.fill(); outline(ctx, 1.1);
        if (br > 0.5) { // sopro saindo dos canos ao exalar
          ctx.fillStyle = rgba(nev, (br - 0.5) * 0.7 * (1 - phh));
          ell(ctx, bx + i * 4.4, top - 11 - (i === 0 ? 4 : 0) - phh * 5, 1.6 + phh * 1.6, 1.2 + phh); ctx.fill();
        }
      }
      ctx.restore();
    }

    // colete de couro nos ombros
    ctx.fillStyle = litS(ctx, 13, T5('#a8977a'), V.lx);
    poly(ctx, [-13.4 * puff, top, 13.4 * puff, top, 10.6, top - 7, -10.6, top - 7]); ctx.fill(); outline(ctx, 1.7);

    // ---- cabeça de madeira com boca-válvula
    var hy = top - 15;
    var hw = 10 * (1 - Math.abs(V.sf) * 0.1);
    var head = function () { blob(ctx, [-hw, top - 6, -hw - 1, hy - 4, 0, hy - 8, hw + 1, hy - 4, hw, top - 6]); };
    head();
    ctx.fillStyle = litH(ctx, hw + 1, wT, V.lx); ctx.fill(); outline(ctx, 2.2);
    // respiradouros laterais da cabeça (por azimute)
    for (i = 0; i < 2; i++) {
      s = V.surf(2.2 - i * 4.4, hw * 0.85);
      if (s.k < 0.1) continue;
      ctx.strokeStyle = rgba('#2c3a42', 0.3 + s.k * 0.4); ctx.lineWidth = 1.2;
      for (var j = 0; j < 3; j++) {
        ctx.beginPath(); ctx.moveTo(s.x - 1.6, hy + j * 2.2 - 2); ctx.lineTo(s.x + 1.6, hy + j * 2.2 - 2); ctx.stroke();
      }
    }
    rimL(ctx, head, hw + 1, o.tintAccent || nev, V.lx, 1.8, 0.5);

    // rosto: olhos serenos + boca-válvula (frente)
    if (V.fw > 0.05) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var fx0 = V.sf * 5;
      eyeV(ctx, fx0 - 4.2, hy - 1, 2, V);
      eyeV(ctx, fx0 + 4.2, hy - 1, 2, V);
      // boca-válvula (abre/fecha com a respiração)
      var mo = 2 + Math.max(br, 0) * 1.4;
      ctx.fillStyle = brass; ell(ctx, fx0, top - 9.4, 4.4, 4.4); ctx.fill(); outline(ctx, 1.4);
      ctx.fillStyle = '#20303a'; ell(ctx, fx0, top - 9.4, mo, mo); ctx.fill();
      ctx.strokeStyle = rgba(nev, 0.5); ctx.lineWidth = 0.8;
      ell(ctx, fx0, top - 9.4, mo + 0.9, mo + 0.9); ctx.stroke();
      // sopro
      if (br > 0.35) {
        ctx.strokeStyle = rgba(nev, (br - 0.35) * 0.9); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(fx0 + 4.6, top - 9.4);
        ctx.quadraticCurveTo(fx0 + 11, top - 12, fx0 + 15, top - 8.6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(fx0 + 5, top - 8);
        ctx.quadraticCurveTo(fx0 + 9, top - 6.4, fx0 + 12, top - 7.4); ctx.stroke();
      }
      ctx.restore();
    }
    // braço da frente
    if (wL.z < wR.z) armW(wR, true); else armW(wL, true);
  };

  JOGO.Sprites = S;
  // continua: monstros, tiles, retratos, ícones (anexados abaixo)
  S.__helpers = {
    clamp: clamp, rgba: rgba, shade: shade, mix: mix, lgrad: lgrad, rgrad: rgrad,
    OUT: OUT, outline: outline, ell: ell, poly: poly, blob: blob, srand: srand,
    glowDot: glowDot, T5: T5, litH: litH, litS: litS, rimL: rimL, aoV: aoV,
    makeView: makeView, eyeV: eyeV, P: P, hashStr: hashStr
  };
})();

// ============================================================================
// PARTE 2 — MONSTROS: Estufa Soterrada (Flora Voraz / Enxame)
// ============================================================================
(function () {
  var S = JOGO.Sprites, H = S.__helpers;
  var P = H.P, T5 = H.T5, litH = H.litH, litS = H.litS, rimL = H.rimL, aoV = H.aoV;
  var rgba = H.rgba, shade = H.shade, mix = H.mix, lgrad = H.lgrad, rgrad = H.rgrad;
  var outline = H.outline, ell = H.ell, poly = H.poly, blob = H.blob;
  var glowDot = H.glowDot, eyeV = H.eyeV, clamp = H.clamp;

  // Vergasta: chicote vegetal enraizado num vaso rachado (torreta)
  P['thorn-lasher'] = function (ctx, t, o, V) {
    var sway = Math.sin(t * 1.6) * 5 + V.sf * 6;
    var i, s;
    // vaso de barro com luz coerente
    var potT = T5('#a5714a');
    var pot = function () { poly(ctx, [-13, 0, 13, 0, 10, -14, -10, -14]); };
    pot();
    ctx.fillStyle = litH(ctx, 13, potT, V.lx); ctx.fill(); outline(ctx, 2.2);
    aoV(ctx, pot, -8, 0, 0.32);
    // rachadura na superfície do vaso (gira por azimute)
    s = V.surf(0.9, 10);
    if (s.k > 0.05) {
      ctx.strokeStyle = rgba('#3a2418', 0.4 + s.k * 0.5); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(s.x, -1); ctx.lineTo(s.x + 2 * s.k, -8); ctx.lineTo(s.x - 1, -13); ctx.stroke();
    }
    // remendo de musgo nas costas do vaso
    s = V.surf(Math.PI, 9);
    if (s.k > 0.1) {
      ctx.fillStyle = rgba('#4f7a38', 0.3 + s.k * 0.4);
      ell(ctx, s.x, -7, 4.4, 2.6); ctx.fill();
    }
    ctx.fillStyle = '#2e2318'; ell(ctx, 0, -14, 10, 3); ctx.fill();
    // caule-chicote em espiral, verga na direção do facing
    var tipx = V.sf * 10 + sway, leanF = V.sf * 8;
    ctx.strokeStyle = '#4f7a38'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -14);
    ctx.quadraticCurveTo(-leanF * 0.5 + sway * 0.4, -32, leanF * 0.6 + sway * 0.8, -42);
    ctx.quadraticCurveTo(leanF + sway, -52, tipx, -58);
    ctx.stroke();
    ctx.strokeStyle = '#7fae55'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(V.lx * 1.4, -16);
    ctx.quadraticCurveTo(-leanF * 0.5 + sway * 0.4 + V.lx * 2, -32, leanF * 0.7 + sway * 0.9, -44); ctx.stroke();
    // farpas ao longo do caule
    ctx.fillStyle = '#8fae5a';
    for (i = 0; i < 6; i++) {
      var k = i / 5;
      var px = (-leanF * 0.4 + sway * 0.4) * (1 - k) + (leanF * 0.8 + sway) * k;
      var py = -20 - k * 34;
      var side = (i % 2 ? 1 : -1);
      poly(ctx, [px, py, px + side * (6 + (i * 37 % 5) * 0.5), py - 2.6, px, py - 4.6]); ctx.fill();
    }
    // ponta: flor morta com "boca" — abre na frente, botão fechado de costas
    var tipy = -58;
    var bud = function () {
      blob(ctx, [tipx - 6, tipy, tipx - 3.4, tipy - 9.4, tipx + 3.4, tipy - 9.4, tipx + 6, tipy]);
    };
    bud();
    ctx.fillStyle = litS(ctx, 6, T5('#7a4a6a'), V.lx); ctx.fill(); outline(ctx, 1.7);
    if (V.fw > 0.1) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      ctx.fillStyle = '#d8b0c8';
      ell(ctx, tipx, tipy - 4.4, 2.6, 3.4); ctx.fill();
      ctx.fillStyle = '#41152e';
      ell(ctx, tipx, tipy - 4, 1.7, 2.4); ctx.fill();
      // dentinhos
      ctx.fillStyle = '#e8d8c0';
      poly(ctx, [tipx - 1.4, tipy - 5.8, tipx - 0.7, tipy - 4.4, tipx, tipy - 5.8]); ctx.fill();
      eyeV(ctx, tipx + V.sf, tipy - 7.4, 1.6, V, '#e8ff9a');
      ctx.restore();
    } else {
      // costas do botão: pétalas fechadas
      ctx.strokeStyle = rgba('#5a3a50', 0.8); ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(tipx - 2, tipy - 1); ctx.quadraticCurveTo(tipx, tipy - 6, tipx - 1, tipy - 8.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tipx + 2.4, tipy - 1); ctx.quadraticCurveTo(tipx + 1, tipy - 5, tipx + 2, tipy - 8.4); ctx.stroke();
    }
    // flores mortas caídas ao pé
    ctx.fillStyle = rgba('#9a7a8a', 0.65);
    ell(ctx, -10, -2, 2.4, 1.5); ctx.fill(); ell(ctx, 12, -3, 1.9, 1.3); ctx.fill();
  };

  // Bufo-de-Pólen: bola de pólen sorridente que explode
  P['pollen-puff'] = function (ctx, t, o, V) {
    var bo = Math.abs(Math.sin(t * 3.2)) * 3;
    var y = -bo;
    var i, s;
    // perninhas de graveto
    var lR = V.pt(0, 6), lL = V.pt(0, -6);
    ctx.strokeStyle = '#6b4a2e'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(lL.x, -8 + y); ctx.lineTo(lL.x * 1.35, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lR.x, -8 + y); ctx.lineTo(lR.x * 1.35, 0); ctx.stroke();
    // bola felpuda com tufos
    var R = 16;
    var body = function () {
      var pts = [], n = 10;
      for (var j = 0; j < n; j++) {
        var a = (j / n) * Math.PI * 2, r = R + (j % 2) * 2.5 + Math.sin(t * 2 + j) * 0.8;
        pts.push(Math.cos(a) * r, -24 + y + Math.sin(a) * r * 0.92);
      }
      blob(ctx, pts);
    };
    body();
    var lxs = V.lx >= 0 ? 1 : -1;
    ctx.fillStyle = rgrad(ctx, lxs * 6, -30 + y, 26, [0, '#fff2a8', 0.5, '#f0d060', 1, '#a8862e']);
    ctx.fill(); outline(ctx, 2.2);
    // tufos de pólen na superfície (giram)
    for (i = 0; i < 5; i++) {
      s = V.surf(-2 + i * 1.25, R * 0.8);
      if (s.k < 0) continue;
      ctx.fillStyle = rgba('#fff2a8', 0.25 + s.k * 0.4);
      ell(ctx, s.x, -24 + y - 6 + (i % 3) * 5, 2.6, 1.8); ctx.fill();
    }
    if (V.fw > 0.06) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var fx0 = V.sf * 7;
      // sorriso costurado — o aviso
      ctx.strokeStyle = '#5a3a1c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(fx0 - 8, -19 + y); ctx.quadraticCurveTo(fx0, -12.6 + y, fx0 + 8, -19 + y); ctx.stroke();
      ctx.lineWidth = 1.3;
      for (i = -2; i <= 2; i++) {
        var xx = fx0 + i * 3.4, yy = -16.2 + y - Math.abs(i) * 1.1;
        ctx.beginPath(); ctx.moveTo(xx, yy - 2.2); ctx.lineTo(xx + 1, yy + 2); ctx.stroke();
      }
      // olhinhos felizes fechados
      ctx.strokeStyle = '#3a2a14'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(fx0 - 6, -28 + y, 3, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
      ctx.beginPath(); ctx.arc(fx0 + 6, -28 + y, 3, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
      // bochechas
      ctx.fillStyle = rgba('#e8a04a', 0.5);
      ell(ctx, fx0 - 10, -22 + y, 2.4, 1.6); ctx.fill();
      ell(ctx, fx0 + 10, -22 + y, 2.4, 1.6); ctx.fill();
      ctx.restore();
    }
    // costas: remendo costurado em X (a "tampa" da bomba)
    if (V.bk > 0.3) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.3) / 0.7;
      var bx = -V.sf * 7;
      ctx.fillStyle = rgba('#c9a24a', 0.55);
      ell(ctx, bx, -26 + y, 5, 4); ctx.fill();
      ctx.strokeStyle = '#5a3a1c'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(bx - 3.4, -29 + y); ctx.lineTo(bx + 3.4, -23 + y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx + 3.4, -29 + y); ctx.lineTo(bx - 3.4, -23 + y); ctx.stroke();
      ctx.restore();
    }
    // nuvem de pólen
    glowDot(ctx, 0, -26 + y, 26, '#ffe98a', 0.16);
    ctx.fillStyle = rgba('#ffe98a', 0.5);
    for (i = 0; i < 4; i++) {
      var a2 = t * 1.1 + i * 1.7;
      ell(ctx, Math.cos(a2) * 20, -26 + y + Math.sin(a2 * 1.4) * 12, 1.3, 1.3); ctx.fill();
    }
  };

  // Carrapicho-Mãe: novelo de farpas com olhinhos NA SUPERFÍCIE (giram!)
  P['burr-mother'] = function (ctx, t, o, V) {
    var ro = Math.sin(t * 1.4) * 0.06;
    var i, s;
    ctx.save(); ctx.translate(0, -20); ctx.rotate(ro);
    // espinhos radiais
    var n = 14;
    for (i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + 0.2;
      var r1 = 17, r2 = 24 + (i % 3) * 2;
      var litK = Math.cos(a - (V.lx >= 0 ? -0.6 : Math.PI + 0.6));
      ctx.fillStyle = shade('#5a4a2a', litK * 0.18);
      poly(ctx, [Math.cos(a - 0.09) * r1, Math.sin(a - 0.09) * r1 * 0.94,
                 Math.cos(a) * r2, Math.sin(a) * r2 * 0.94,
                 Math.cos(a + 0.09) * r1, Math.sin(a + 0.09) * r1 * 0.94]);
      ctx.fill();
    }
    // corpo novelo
    var lxs = V.lx >= 0 ? 1 : -1;
    ell(ctx, 0, 0, 18, 17);
    ctx.fillStyle = rgrad(ctx, lxs * 6, -6, 27, [0, '#9a824c', 0.55, '#6b5632', 1, '#3d2f18']);
    ctx.fill(); outline(ctx, 2.2);
    // fios enrolados
    ctx.strokeStyle = rgba('#3a2c16', 0.6); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, 12, 0.4 + V.yaw * 0.5, 2.4 + V.yaw * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(2, 3, 8, 2.8 + V.yaw * 0.5, 5.2 + V.yaw * 0.5); ctx.stroke();
    // DEZENAS de olhinhos distribuídos na ESFERA — aparecem/somem ao girar
    var eyes = [
      [0.0, -6], [0.5, -10], [-0.5, -9], [1.0, -3], [-1.0, -4],
      [0.3, 2], [-0.3, 1], [0.9, 6], [-0.8, 7], [1.4, -7], [-1.5, -6],
      [1.8, 3], [-1.8, 2], [0.1, 10], [2.6, -2], [-2.6, 0], [3.1, 4]
    ];
    for (i = 0; i < eyes.length; i++) {
      s = V.surf(eyes[i][0], 13);
      if (s.k < 0.06) continue;
      var ey = eyes[i][1];
      var blink = Math.sin(t * 3 + i * 2.7) > -0.92;
      var al = clamp(s.k * 1.6, 0, 1);
      if (blink) {
        ctx.fillStyle = rgba('#0e0a08', al);
        ell(ctx, s.x, ey, 1.8 * (0.5 + s.k * 0.5), 2); ctx.fill();
        ctx.fillStyle = rgba('#ffffff', 0.85 * al);
        ell(ctx, s.x - 0.5, ey - 0.6, 0.55, 0.6); ctx.fill();
      } else {
        ctx.strokeStyle = rgba('#0e0a08', al); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(s.x - 1.6, ey); ctx.lineTo(s.x + 1.6, ey); ctx.stroke();
      }
    }
    ctx.restore();
  };

  // Vespa-Lustre: corpo AXIAL — cabeça na direção do facing, lanterna atrás
  P['lantern-wasp'] = function (ctx, t, o, V) {
    var hov = Math.sin(t * 4) * 3, y = -26 + hov;
    var wing = Math.sin(t * 40);
    var hd = V.pt(13, 0);   // cabeça à frente
    var ab = V.pt(-12, 0);  // abdômen-lanterna atrás
    var hs = 1 + hd.z * 0.02, as2 = 1 + ab.z * 0.02; // escala por profundidade
    glowDot(ctx, ab.x, y + 8, 18, '#ffe9a0', 0.35);

    function drawAbdomen() {
      var lx2 = ab.x;
      ctx.fillStyle = rgba('#dcecf0', 0.6);
      blob(ctx, [lx2 - 7 * as2, y, lx2 - 5 * as2, y - 8 * as2, lx2 + 4 * as2, y - 9 * as2, lx2 + 8 * as2, y - 2, lx2 + 5 * as2, y + 7 * as2, lx2 - 4 * as2, y + 7 * as2]);
      ctx.fill(); outline(ctx, 1.7);
      ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(lx2 - 6 * as2, y - 3.4); ctx.lineTo(lx2 + 6.4 * as2, y - 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lx2 - 5 * as2, y + 3); ctx.lineTo(lx2 + 5.4 * as2, y + 3); ctx.stroke();
      var lum = 0.6 + Math.sin(t * 7) * 0.3;
      ctx.fillStyle = '#fff0b8'; ell(ctx, lx2, y - 1, 2.6 * as2, 2.8 * as2); ctx.fill();
      glowDot(ctx, lx2, y - 1, 12 * as2, '#ffe9a0', lum);
      // ferrão atrás
      var st2 = V.pt(-20, 0);
      ctx.fillStyle = '#e0d0a0';
      poly(ctx, [st2.x, y + 1, st2.x - V.sf * 6, y + 5.4, lx2, y + 4.4]); ctx.fill(); outline(ctx, 1.1);
    }
    function drawHead() {
      var hx2 = hd.x;
      ctx.fillStyle = litS(ctx, 6, T5('#4a3826'), V.lx);
      ell(ctx, hx2, y - 2, 5.8 * hs, 5.2 * hs); ctx.fill(); outline(ctx, 1.7);
      // antenas
      ctx.strokeStyle = '#2c2018'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(hx2 - 1, y - 6);
      ctx.quadraticCurveTo(hx2 + V.sf * 4 - 2, y - 12, hx2 + V.sf * 7 - 3, y - 10 + Math.sin(t * 6) * 1.4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hx2 + 1, y - 6);
      ctx.quadraticCurveTo(hx2 + V.sf * 4 + 2, y - 13, hx2 + V.sf * 7 + 2, y - 11 - Math.sin(t * 6) * 1.4); ctx.stroke();
      // olhos grandes compostos
      ctx.save(); ctx.globalAlpha *= Math.max(V.fw, 0.25);
      eyeV(ctx, hx2 - 2.2 + V.sf * 2, y - 3.4, 2.3 * hs, V, '#9ae0c8');
      eyeV(ctx, hx2 + 2.6 + V.sf * 2, y - 3.2, 2 * hs, V, '#9ae0c8');
      ctx.restore();
      // mandíbulas
      if (V.fw > 0.2) {
        ctx.strokeStyle = rgba('#e0d0a0', V.fw * 0.9); ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(hx2 + V.sf * 2, y + 1.4, 2.2, 0.3, Math.PI - 0.3); ctx.stroke();
      }
    }
    // tórax central + pernas penduradas
    function drawThorax() {
      ctx.fillStyle = litH(ctx, 8, T5('#57432c'), V.lx);
      ell(ctx, 0, y, 8, 6.6); ctx.fill(); outline(ctx, 1.7);
      // listras
      ctx.strokeStyle = rgba('#2c2018', 0.7); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-3, y - 5.6); ctx.quadraticCurveTo(-2, y, -3, y + 5.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2, y - 6); ctx.quadraticCurveTo(3, y, 2, y + 6); ctx.stroke();
      ctx.strokeStyle = '#2c2018'; ctx.lineWidth = 1.4;
      for (var j = 0; j < 3; j++) {
        ctx.beginPath(); ctx.moveTo(-4 + j * 4, y + 5);
        ctx.lineTo(-6 + j * 4 + Math.sin(t * 4 + j) * 1.5, y + 13); ctx.stroke();
      }
    }
    // asas por cima (borrão)
    function drawWings() {
      ctx.fillStyle = rgba('#cfe8f0', 0.38);
      ell(ctx, -V.sf * 3, y - 12 + wing * 2, 13, 4.2); ctx.fill();
      ell(ctx, -V.sf * 5, y - 10 - wing * 2, 11, 3.6); ctx.fill();
    }
    // ordem por profundidade
    if (ab.z < hd.z) { drawAbdomen(); drawThorax(); drawHead(); }
    else { drawHead(); drawThorax(); drawAbdomen(); }
    drawWings();
  };

  // Seiveiro: toco corcunda; caldeirão na FRENTE (some atrás do corpo de costas)
  P['sap-shaman'] = function (ctx, t, o, V) {
    var br = Math.sin(t * 1.5) * 1.5;
    var i, s;
    var pot = V.pt(9, 0);
    function cauldron() {
      var cx2 = pot.x * 0.8;
      ctx.fillStyle = lgrad(ctx, cx2 - 13, -18, cx2 + 13, -2, [0, '#5c5c66', 0.5, '#3a3a44', 1, '#1e1e24']);
      blob(ctx, [cx2 - 13, -3, cx2 - 14, -15, cx2, -19, cx2 + 14, -15, cx2 + 13, -3]); ctx.fill(); outline(ctx, 2);
      // seiva dourada borbulhando
      ctx.fillStyle = '#ffcf5a';
      ell(ctx, cx2, -15, 11, 3); ctx.fill();
      ctx.fillStyle = '#ffe9a0';
      ell(ctx, cx2 - 3, -15.5, 4, 1.4); ctx.fill();
      glowDot(ctx, cx2, -14, 17, '#ffcf5a', 0.65);
      var bub = (t * 1.3) % 1;
      ctx.fillStyle = rgba('#ffe9a0', 1 - bub);
      ell(ctx, cx2 + Math.sin(t * 2.1) * 5, -15 - bub * 8, 1.6 + bub, 1.6 + bub); ctx.fill();
      // concha de pau
      ctx.strokeStyle = '#4a3520'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx2 + 6, -15); ctx.lineTo(cx2 + 10, -24 + br); ctx.stroke();
      ctx.fillStyle = '#6b4f32'; ell(ctx, cx2 + 10.6, -25 + br, 2.2, 1.6); ctx.fill();
      // mãos segurando
      ctx.fillStyle = '#6b4f32';
      ell(ctx, cx2 - 12.4, -12, 3.2, 3.8); ctx.fill(); outline(ctx, 1.3);
      ell(ctx, cx2 + 12.4, -12, 3.2, 3.8); ctx.fill(); outline(ctx, 1.3);
    }
    if (pot.z < 0) cauldron();
    // raízes na base
    ctx.strokeStyle = '#4a3520'; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    for (i = -2; i <= 2; i++) {
      s = V.surf(i * 1.1, 8);
      ctx.beginPath(); ctx.moveTo(s.x * 0.65, -6);
      ctx.quadraticCurveTo(s.x, -2, s.x * 1.35, 0); ctx.stroke();
    }
    // corpo-toco corcunda (corcunda vira para trás!)
    var hump = -V.cf * 6; // corcunda no lado oposto ao facing
    var body = function () {
      blob(ctx, [-15, -4, -17 + hump * 0.6, -24 + br, hump - 6, -43 + br, hump + 9, -39 + br, 15, -19, 13, -4]);
    };
    body();
    ctx.fillStyle = litH(ctx, 16, T5('#7a5c3c'), V.lx); ctx.fill(); outline(ctx, 2.3);
    aoV(ctx, body, -16, -2, 0.3);
    // casca: anéis de madeira
    ctx.strokeStyle = rgba('#3a2814', 0.7); ctx.lineWidth = 1.4;
    s = V.surf(2.6, 9);
    if (s.k > 0.05) { ctx.beginPath(); ctx.arc(s.x, -28 + br, 6, 0.6, 2.8); ctx.stroke(); }
    s = V.surf(-2.2, 10);
    if (s.k > 0.05) { ctx.beginPath(); ctx.arc(s.x, -16, 4.6, 3.4, 5.6); ctx.stroke(); }
    // rosto entalhado a canivete (frente)
    if (V.fw > 0.08) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var fx0 = V.sf * 6 + hump * 0.3;
      ctx.strokeStyle = '#2c1e10'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(fx0 - 8, -35 + br); ctx.lineTo(fx0 - 3, -33.4 + br); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx0 + 2, -36 + br); ctx.lineTo(fx0 + 7, -34 + br); ctx.stroke();
      // brilho de seiva nos talhos-olhos
      glowDot(ctx, fx0 - 5.5, -34.4 + br, 4, '#ffcf5a', 0.7 * V.fw);
      glowDot(ctx, fx0 + 4.5, -35 + br, 4, '#ffcf5a', 0.7 * V.fw);
      ctx.beginPath(); ctx.moveTo(fx0 - 6, -27 + br); ctx.lineTo(fx0 - 1, -25.4 + br); ctx.lineTo(fx0 + 4, -27.4 + br); ctx.stroke();
      ctx.restore();
    }
    // costas: fenda de machado antiga + musgo
    if (V.bk > 0.3) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.3) / 0.7;
      var bx = -V.sf * 5 + hump * 0.5;
      ctx.strokeStyle = '#241708'; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(bx, -36 + br); ctx.lineTo(bx + 2, -26 + br); ctx.stroke();
      ctx.fillStyle = rgba('#4f7a38', 0.55);
      ell(ctx, bx - 5, -22, 5, 3); ctx.fill();
      ell(ctx, bx + 6, -30 + br, 3.4, 2.2); ctx.fill();
      ctx.restore();
    }
    // brotinho no topo
    ctx.strokeStyle = '#5a8f3c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hump * 0.7 - 2, -42 + br); ctx.quadraticCurveTo(hump * 0.7, -48 + br, hump * 0.7 + 3, -49 + br); ctx.stroke();
    ctx.fillStyle = '#7ab04a'; ell(ctx, hump * 0.7 + 4, -50 + br, 3.4, 2.2); ctx.fill();
    if (pot.z >= 0) cauldron();
  };

  // A JARDINEIRA-VIÚVA (CHEFE ~2x): treliça, véu, TESOURA que orbita
  P['boss-gardener'] = function (ctx, t, o, V) {
    var sc = 1.9; ctx.save(); ctx.scale(sc, sc);
    var sw = Math.sin(t * 1.1) * 2;
    var snip = Math.max(0, Math.sin(t * 2.6));      // tesourada periódica
    var i, s;
    var shears = V.pt(4, 17);                        // tesoura na mão direita

    function drawShears(near) {
      var px = shears.x * 1.55;
      // braço até a tesoura
      ctx.strokeStyle = '#3c3244'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(V.sf * 4 + (near ? 10 : -10) * V.cf * 0.8, -52 + sw);
      ctx.quadraticCurveTo(px * 0.8, -46, px, -38 + sw); ctx.stroke();
      ctx.save();
      ctx.translate(px, -36 + sw);
      ctx.rotate(0.45 + V.sf * 0.3 + snip * 0.06);
      var bs = near ? 1 : 0.92;
      function blade(flip2) {
        ctx.save(); ctx.scale(bs, flip2 ? -bs : bs); ctx.rotate(snip * 0.22);
        ctx.fillStyle = lgrad(ctx, 0, -3, 26, 0, [0, '#a89a80', 0.45, '#b5502e', 1, '#5c3220']);
        poly(ctx, [0, 0, 24, -4.4, 28, -1, 4, 3.6]); ctx.fill(); outline(ctx, 1.5);
        ctx.strokeStyle = rgba('#3d2114', 0.7); ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(8, -1.8); ctx.lineTo(12, -2.2); ctx.stroke();
        ctx.restore();
      }
      blade(false); blade(true);
      ctx.fillStyle = '#4a3520'; ell(ctx, 1, 0, 3.4, 3.4); ctx.fill(); outline(ctx, 1.3);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba('#ffd76b', 0.35 + snip * 0.3); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(6, -2.6); ctx.lineTo(24, -4.6); ctx.stroke();
      ctx.restore();
      ctx.restore();
    }
    if (shears.z < 0) drawShears(false);

    // saia-treliça (estrutura de jardim)
    var skw = 26 * (1 - Math.abs(V.sf) * 0.08);
    var skirt = function () { poly(ctx, [-skw, 0, skw, 0, 16, -34, -16, -34]); };
    skirt();
    ctx.fillStyle = litH(ctx, skw, T5('#57432c'), V.lx); ctx.fill(); outline(ctx, 2.5);
    aoV(ctx, skirt, -16, 0, 0.34);
    // grade da treliça — as ripas verticais giram por azimute!
    ctx.lineWidth = 1.7;
    for (i = -3; i <= 3; i++) {
      s = V.surf(i * 0.5, skw * 0.86);
      if (s.k < -0.05) continue;
      ctx.strokeStyle = rgba(shade('#8a6b46', s.k * 0.25), 0.5 + s.k * 0.4);
      ctx.beginPath(); ctx.moveTo(s.x, 0); ctx.lineTo(s.x * 0.62, -34); ctx.stroke();
    }
    for (i = 0; i < 3; i++) {
      ctx.strokeStyle = rgba('#8a6b46', 0.75); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-24 + i * 3.4, -8 - i * 9); ctx.lineTo(24 - i * 3.4, -8 - i * 9); ctx.stroke();
    }
    // heras + rosinhas mortas na superfície
    for (i = 0; i < 3; i++) {
      s = V.surf(0.7 + i * 1.9, skw * 0.8);
      if (s.k < 0.05) continue;
      ctx.strokeStyle = rgba('#4f7a38', 0.4 + s.k * 0.5); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(s.x, -1);
      ctx.quadraticCurveTo(s.x * 0.7 + 4, -16, s.x * 0.62, -30); ctx.stroke();
      ctx.fillStyle = rgba('#7a4a6a', 0.5 + s.k * 0.4);
      ell(ctx, s.x * 0.75, -14 - i * 4, 2, 1.6); ctx.fill();
    }
    // torso estreito de viúva
    var torso = function () { blob(ctx, [-13, -33, -11, -55 + sw, 0, -61 + sw, 11, -55 + sw, 13, -33]); };
    torso();
    ctx.fillStyle = litH(ctx, 13, T5('#3c3244'), V.lx); ctx.fill(); outline(ctx, 2.3);
    // braço esquerdo com luva de couro
    var glv = V.pt(4, -17);
    ctx.strokeStyle = '#3c3244'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(V.sf * 4 - 10 * V.cf, -50 + sw);
    ctx.quadraticCurveTo(glv.x * 1.4, -44, glv.x * 1.55, -32); ctx.stroke();
    ctx.fillStyle = '#8a6b46'; ell(ctx, glv.x * 1.55, -30, 4.4, 5.2); ctx.fill(); outline(ctx, 1.7);
    // dedos da luva
    ctx.strokeStyle = '#6b4f32'; ctx.lineWidth = 1.4;
    for (i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(glv.x * 1.55 + i * 2, -26);
      ctx.lineTo(glv.x * 1.55 + i * 2.6, -22.6 + Math.abs(i)); ctx.stroke();
    }

    // VÉU de viúva
    var veil = function () {
      ctx.beginPath();
      ctx.moveTo(-13, -57 + sw);
      ctx.quadraticCurveTo(-16, -80 + sw, 0, -84 + sw);
      ctx.quadraticCurveTo(16, -80 + sw, 13, -57 + sw);
      ctx.quadraticCurveTo(15, -45 + sw, 10, -39 + sw);
      ctx.lineTo(-10, -39 + sw);
      ctx.quadraticCurveTo(-15, -45 + sw, -13, -57 + sw);
      ctx.closePath();
    };
    veil();
    ctx.fillStyle = litH(ctx, 15, T5('#443a50'), V.lx); ctx.fill(); outline(ctx, 2.3);
    rimL(ctx, veil, 15, (o && o.tintAccent) || '#ffd76b', V.lx, 1.8, 0.45);
    // renda do véu (ondula)
    ctx.strokeStyle = rgba('#8a7a9a', 0.5); ctx.lineWidth = 1;
    for (i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(i * 5 + V.sf * 2, -82 + sw);
      ctx.quadraticCurveTo(i * 5.6 + Math.sin(t * 1.8 + i) * 1.2, -60 + sw, i * 4.6, -40.4 + sw); ctx.stroke();
    }
    // FRENTE: dois olhos de saudade sob o véu / COSTAS: laço fúnebre
    if (V.fw > 0.06) {
      var pu = 0.5 + Math.sin(t * 2.6) * 0.3;
      var fx0 = V.sf * 6;
      glowDot(ctx, fx0 - 4.5, -66 + sw, 5.5, '#d8ffb0', pu * V.fw);
      glowDot(ctx, fx0 + 4.5, -66 + sw, 5.5, '#d8ffb0', pu * V.fw);
      ctx.fillStyle = rgba('#e8ffd0', V.fw);
      ell(ctx, fx0 - 4.5, -66 + sw, 1.4, 1.9); ctx.fill();
      ell(ctx, fx0 + 4.5, -66 + sw, 1.4, 1.9); ctx.fill();
    }
    if (V.bk > 0.3) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.3) / 0.7;
      var bx = -V.sf * 5;
      // laço de fita preta
      ctx.fillStyle = '#241c2c';
      poly(ctx, [bx, -70 + sw, bx - 7, -75 + sw, bx - 6, -66 + sw]); ctx.fill(); outline(ctx, 1.2);
      poly(ctx, [bx, -70 + sw, bx + 7, -75 + sw, bx + 6, -66 + sw]); ctx.fill(); outline(ctx, 1.2);
      ell(ctx, bx, -70 + sw, 2.2, 2.4); ctx.fillStyle = '#38304a'; ctx.fill(); outline(ctx, 1.1);
      // fitas caindo
      ctx.strokeStyle = rgba('#38304a', 0.9); ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(bx - 1.4, -68 + sw);
      ctx.quadraticCurveTo(bx - 3 + Math.sin(t * 1.6) * 2, -56 + sw, bx - 2, -46 + sw); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx + 1.6, -68 + sw);
      ctx.quadraticCurveTo(bx + 4 + Math.sin(t * 1.4) * 2, -58 + sw, bx + 3, -48 + sw); ctx.stroke();
      ctx.restore();
    }
    if (shears.z >= 0) drawShears(true);
    ctx.restore();
  };

  // Brotinho-Voraz: muda com bocarra (frente) e broto-espiral (costas)
  P['sprout-feral'] = function (ctx, t, o, V) {
    var bo = Math.abs(Math.sin(t * 5)) * 3, y = -bo;
    var i;
    var lR = V.pt(0, 5), lL = V.pt(0, -5);
    ctx.strokeStyle = '#5a7a34'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(lL.x, -6 + y); ctx.lineTo(lL.x * 1.3, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lR.x, -6 + y); ctx.lineTo(lR.x * 1.3, 0); ctx.stroke();
    var body = function () { blob(ctx, [-11, -6 + y, -12, -20 + y, 0, -26 + y, 12, -20 + y, 11, -6 + y]); };
    body();
    ctx.fillStyle = litH(ctx, 12, T5('#8ab554'), V.lx); ctx.fill(); outline(ctx, 2.2);
    if (V.fw > 0.08) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var fx0 = V.sf * 5;
      var mo = 1 + Math.sin(t * 5) * 0.4;
      ctx.fillStyle = '#3c2030';
      blob(ctx, [fx0 - 8, -12 + y, fx0, -15 - mo + y, fx0 + 8, -12 + y, fx0, -7 + mo * 0.5 + y]); ctx.fill();
      ctx.fillStyle = '#f0ead0';
      for (i = -2; i <= 2; i++) {
        poly(ctx, [fx0 + i * 3 - 1.2, -13.6 + y + Math.abs(i) * 0.4, fx0 + i * 3, -10.4 + y, fx0 + i * 3 + 1.2, -13.6 + y + Math.abs(i) * 0.4]);
        ctx.fill();
      }
      eyeV(ctx, fx0 - 5, -20 + y, 2.2, V, '#d8ff9a');
      eyeV(ctx, fx0 + 5, -20 + y, 2.2, V, '#d8ff9a');
      ctx.restore();
    }
    if (V.bk > 0.3) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.3) / 0.7;
      var bx = -V.sf * 5;
      ctx.strokeStyle = rgba('#4a6a2c', 0.9); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx, -24 + y); ctx.quadraticCurveTo(bx - 2, -16 + y, bx, -8 + y); ctx.stroke();
      ctx.beginPath(); ctx.arc(bx + 3, -16 + y, 2.6, 0, Math.PI * 1.6); ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = '#7ab04a';
    var fl = Math.sin(t * 6) * 0.3;
    ctx.save(); ctx.translate(V.sf * 2, -25 + y);
    ctx.rotate(-0.5 + fl); ell(ctx, -5, -4, 6, 2.6); ctx.fill();
    ctx.rotate(1 - fl * 2); ell(ctx, 5, -4, 6, 2.6); ctx.fill();
    ctx.restore();
  };

  // Carrapichinho: bola de farpas mini com carranca
  P['burrlet'] = function (ctx, t, o, V) {
    var ro = Math.sin(t * 2.4) * 0.3;
    var i;
    ctx.save(); ctx.translate(0, -11); ctx.rotate(ro);
    var n = 9;
    for (i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      var litK = Math.cos(a - (V.lx >= 0 ? -0.6 : Math.PI + 0.6));
      ctx.fillStyle = shade('#5a4a2a', litK * 0.15);
      poly(ctx, [Math.cos(a - 0.14) * 8, Math.sin(a - 0.14) * 8,
                 Math.cos(a) * 13, Math.sin(a) * 13,
                 Math.cos(a + 0.14) * 8, Math.sin(a + 0.14) * 8]);
      ctx.fill();
    }
    ell(ctx, 0, 0, 9, 8.6);
    var lxs = V.lx >= 0 ? 1 : -1;
    ctx.fillStyle = rgrad(ctx, lxs * 3, -2, 13, [0, '#93794a', 0.6, '#6b5632', 1, '#3d2f18']);
    ctx.fill(); outline(ctx, 1.7);
    if (V.fw > 0.1) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var fx0 = V.sf * 3.4;
      eyeV(ctx, fx0 - 3, -1, 1.7, V); eyeV(ctx, fx0 + 3.4, 0.4, 1.7, V);
      ctx.strokeStyle = '#241a0e'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(fx0 - 4.6, -3.6); ctx.lineTo(fx0 - 1.4, -2.4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx0 + 4.8, -3.4); ctx.lineTo(fx0 + 1.8, -2.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(fx0, 5.4, 2.6, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };

  // Esporinho: cogumelo-bebê de olhos grandes
  P['sporeling'] = function (ctx, t, o, V) {
    var bo = Math.sin(t * 2.6) * 1.6, y = bo * 0.6;
    var pu = 0.3 + (Math.sin(t * 3) + 1) * 0.2;
    var i, s;
    var lR = V.pt(0, 4), lL = V.pt(0, -4);
    ctx.strokeStyle = rgba('#cfc8e8', 0.8); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(lL.x, -4 + y); ctx.lineTo(lL.x * 1.4, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lR.x, -4 + y); ctx.lineTo(lR.x * 1.4, 0); ctx.stroke();
    var body = function () { blob(ctx, [-6, -3 + y, -6.5, -14 + y, 0, -17 + y, 6.5, -14 + y, 6, -3 + y]); };
    body();
    ctx.fillStyle = litS(ctx, 7, T5('#d8cec2'), V.lx); ctx.fill(); outline(ctx, 1.7);
    var cap = function () {
      ctx.beginPath();
      ctx.moveTo(-11, -14 + y);
      ctx.quadraticCurveTo(-9, -25 + y, 0, -26 + y);
      ctx.quadraticCurveTo(9, -25 + y, 11, -14 + y);
      ctx.quadraticCurveTo(0, -10.5 + y, -11, -14 + y);
      ctx.closePath();
    };
    cap();
    ctx.fillStyle = litH(ctx, 11, T5('#8a6fb0'), V.lx); ctx.fill(); outline(ctx, 1.9);
    for (i = 0; i < 4; i++) {
      s = V.surf(-1.6 + i * 1.1, 8);
      if (s.k < 0.05) continue;
      ctx.fillStyle = rgba('#e0d8f0', 0.4 + s.k * 0.45);
      ell(ctx, s.x, -21 + y + (i % 2) * 2, 1.5, 1.1); ctx.fill();
    }
    ctx.strokeStyle = rgba('#6fe0c8', pu); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-10, -14.4 + y); ctx.quadraticCurveTo(0, -11 + y, 10, -14.4 + y); ctx.stroke();
    if (V.fw > 0.08) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var fx0 = V.sf * 3;
      eyeV(ctx, fx0 - 3.2, -12 + y, 2.7, V, '#6fe0c8');
      eyeV(ctx, fx0 + 3.2, -12 + y, 2.7, V, '#6fe0c8');
      ctx.strokeStyle = '#4a3a3a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(fx0, -8.4 + y, 1.6, 0.3, Math.PI - 0.3); ctx.stroke();
      ctx.restore();
    }
  };
})();

// ============================================================================
// PARTE 3 — MONSTROS: Cisterna dos Afogados (Corte Afogada)
// ============================================================================
(function () {
  var S = JOGO.Sprites, H = S.__helpers;
  var P = H.P, T5 = H.T5, litH = H.litH, litS = H.litS, rimL = H.rimL, aoV = H.aoV;
  var rgba = H.rgba, shade = H.shade, mix = H.mix, lgrad = H.lgrad, rgrad = H.rgrad;
  var outline = H.outline, ell = H.ell, poly = H.poly, blob = H.blob;
  var glowDot = H.glowDot, eyeV = H.eyeV, clamp = H.clamp;

  // Afogadiço: carregador inchado; LAMPIÃO na mão direita orbita com o yaw
  P['drowned-porter'] = function (ctx, t, o, V) {
    var sw = Math.sin(t * 1.3) * 1.6;
    var i, s;
    var lamp = V.pt(4, 12);
    function drawLamp(near) {
      var ax = lamp.x * 1.75;
      ctx.strokeStyle = near ? '#54706488' : '#3a5248'; ctx.lineWidth = 4.6; ctx.lineCap = 'round';
      ctx.strokeStyle = near ? '#547064' : '#3a5248';
      ctx.beginPath(); ctx.moveTo(lamp.x * 0.9, -30);
      ctx.quadraticCurveTo(ax * 1.15, -26, ax, -18 + sw); ctx.stroke();
      // alça + lampião
      ctx.strokeStyle = '#7a6a4a'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(ax, -18 + sw); ctx.lineTo(ax, -13 + sw); ctx.stroke();
      ctx.fillStyle = rgba('#d8ecf0', 0.5);
      poly(ctx, [ax - 4, -13 + sw, ax + 4, -13 + sw, ax + 3.2, -2 + sw, ax - 3.2, -2 + sw]); ctx.fill(); outline(ctx, 1.5);
      ctx.strokeStyle = '#7a6a4a'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(ax - 3.6, -8 + sw); ctx.lineTo(ax + 3.6, -8 + sw); ctx.stroke();
      ctx.fillStyle = '#ffe9a0'; ell(ctx, ax, -7.5 + sw, 2, 2.6); ctx.fill();
      glowDot(ctx, ax, -7.5 + sw, 13, '#ffe9a0', 0.6);
    }
    var armL2 = V.pt(2, -13);
    if (lamp.z < 0) drawLamp(false);
    // braço esquerdo caído
    if (armL2.z < 0) {
      ctx.strokeStyle = '#3a5248'; ctx.lineWidth = 4.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(armL2.x * 0.9, -28);
      ctx.quadraticCurveTo(armL2.x * 1.55, -20, armL2.x * 1.5, -10 + sw); ctx.stroke();
    }
    // pernas inchadas
    var lR = V.pt(0, 8), lL = V.pt(0, -8);
    ctx.fillStyle = '#4a6258';
    poly(ctx, [lL.x - 4.4, 0, lL.x + 4.4, 0, lL.x + 3.6, -12, lL.x - 3.6, -12]); ctx.fill(); outline(ctx, 1.9);
    poly(ctx, [lR.x - 4.4, 0, lR.x + 4.4, 0, lR.x + 3.6, -12, lR.x - 3.6, -12]); ctx.fill(); outline(ctx, 1.9);
    // corpo inchado de água
    var body = function () { blob(ctx, [-16, -8, -18, -30 + sw, -5, -42 + sw, 10, -40 + sw, 17, -25, 14, -8]); };
    body();
    ctx.fillStyle = litH(ctx, 17, T5('#5f7f70'), V.lx); ctx.fill(); outline(ctx, 2.3);
    aoV(ctx, body, -20, -6, 0.3);
    // barriga d'água translúcida (frente)
    if (V.fw > 0.1) {
      ctx.fillStyle = rgba('#8ac0b0', 0.28 * V.fw);
      ell(ctx, V.sf * 5, -20, 10, 8); ctx.fill();
      // bolha subindo dentro
      var bub = (t * 0.8) % 1;
      ctx.strokeStyle = rgba('#c8ecdf', (1 - bub) * 0.5 * V.fw); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(V.sf * 5 + Math.sin(t * 3) * 3, -14 - bub * 12, 1.6, 0, Math.PI * 2); ctx.stroke();
    }
    // remendos de roupa antiga (superfície)
    s = V.surf(0.6, 12);
    if (s.k > 0.05) {
      ctx.fillStyle = rgba('#2c3e46', 0.5 + s.k * 0.4);
      poly(ctx, [s.x - 7, -14, s.x + 7, -12, s.x + 6, -8, s.x - 6, -9]); ctx.fill();
    }
    // costas: mochila de carregador apodrecida + cracas
    if (V.bk > 0.3) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.3) / 0.7;
      var bx = -V.sf * 5;
      ctx.fillStyle = '#41564c';
      poly(ctx, [bx - 8, -36 + sw, bx + 8, -36 + sw, bx + 6.4, -16, bx - 6.4, -16]); ctx.fill(); outline(ctx, 1.7);
      ctx.strokeStyle = '#2c3e46'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx - 7, -33 + sw); ctx.lineTo(bx + 7, -33 + sw); ctx.stroke();
      // cracas
      ctx.fillStyle = '#8a9a8e';
      ell(ctx, bx - 4, -26, 1.8, 1.4); ctx.fill();
      ell(ctx, bx + 4.4, -21, 1.4, 1.1); ctx.fill();
      ell(ctx, bx + 1, -30 + sw, 1.2, 1); ctx.fill();
      ctx.restore();
    }
    // cabeça inchada meio caída (pende para o lado do facing)
    var hx2 = V.sf * 6, hy = -45 + sw;
    var head = function () { blob(ctx, [hx2 - 9, hy + 8, hx2 - 10, hy - 2, hx2, hy - 6, hx2 + 10, hy - 2, hx2 + 9, hy + 8]); };
    head();
    ctx.fillStyle = litH(ctx, 10, T5('#6b8a7a'), V.lx); ctx.fill(); outline(ctx, 2.1);
    // algas no lugar do cabelo (caem em volta — por azimute)
    ctx.lineCap = 'round';
    for (i = -2; i <= 2; i++) {
      s = V.surf(i * 0.9, 8);
      ctx.strokeStyle = rgba('#3a6248', 0.5 + Math.max(s.k, 0) * 0.4);
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(hx2 + s.x, hy - 4);
      ctx.quadraticCurveTo(hx2 + s.x * 1.3 + Math.sin(t * 1.8 + i) * 2, hy + 2, hx2 + s.x * 1.5, hy + 9 + Math.abs(i));
      ctx.stroke();
    }
    // rosto de afogado (frente)
    if (V.fw > 0.08) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      eyeV(ctx, hx2 - 4, hy + 1, 2, V, '#9adcc8');
      eyeV(ctx, hx2 + 4, hy + 1, 2, V, '#9adcc8');
      ctx.fillStyle = '#16262c';
      ell(ctx, hx2, hy + 6, 2.8, 2); ctx.fill();
      ctx.restore();
    }
    if (armL2.z >= 0) {
      ctx.strokeStyle = '#4a6258'; ctx.lineWidth = 4.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(armL2.x * 0.9, -28);
      ctx.quadraticCurveTo(armL2.x * 1.55, -20, armL2.x * 1.5, -10 + sw); ctx.stroke();
      var dr = (t * 1.1) % 1;
      ctx.fillStyle = rgba('#8ac0d0', 1 - dr);
      ell(ctx, armL2.x * 1.5, -8 + sw + dr * 8, 1.3, 1.8); ctx.fill();
    }
    if (lamp.z >= 0) drawLamp(true);
  };

  // Moreia-Flauta: serpente AXIAL — a cabeça avança na direção do facing
  P['moray-piper'] = function (ctx, t, o, V) {
    var swv = Math.sin(t * 1.8) * 3;
    var y = Math.sin(t * 2.4) * 1.6;
    var i;
    // poça d'água de onde emerge
    ctx.fillStyle = rgba('#2a5a6a', 0.85);
    ell(ctx, 0, -1, 16, 4.6); ctx.fill();
    ctx.strokeStyle = rgba('#7ef0d4', 0.35); ctx.lineWidth = 1.2;
    ell(ctx, 0, -1, 12 + Math.sin(t * 2) * 2, 3.4); ctx.stroke();
    // corpo em S: pescoço sobe e a cabeça projeta na direção do facing
    var hd = V.pt(11, 0);
    var hx3 = hd.x + swv * 0.5, hy2 = -52 + y;
    var neckX = hx3 * 0.55;
    var bodyT = T5('#3c6a7a');
    ctx.strokeStyle = litS(ctx, 8, bodyT, V.lx);
    ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-2, -2);
    ctx.quadraticCurveTo(-6 - V.sf * 4, -20, neckX * 0.5, -32 + y);
    ctx.quadraticCurveTo(neckX * 1.4 + swv * 0.4, -44 + y, hx3, hy2 + 4);
    ctx.stroke();
    // gradiente manual no pescoço: repinta com traço mais claro no lado da luz
    ctx.strokeStyle = rgba(shade('#3c6a7a', 0.28), 0.65); ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(-2 + V.lx * 2.4, -4);
    ctx.quadraticCurveTo(-6 - V.sf * 4 + V.lx * 3, -20, neckX * 0.5 + V.lx * 2.6, -33 + y);
    ctx.stroke();
    // barbatana dorsal — fica nas COSTAS do pescoço (visível de costas/perfil)
    var finSide = -V.sf;
    ctx.fillStyle = rgba('#7ab8c8', 0.4 + V.bk * 0.4);
    ctx.beginPath();
    ctx.moveTo(finSide * 5 - 2, -8);
    ctx.quadraticCurveTo(finSide * 10 - 3 + Math.sin(t * 3) * 2, -22, neckX * 0.5 + finSide * 6, -34 + y);
    ctx.quadraticCurveTo(finSide * 6 - 2, -24, finSide * 2 - 1, -10);
    ctx.closePath(); ctx.fill();
    // furos de flauta ao longo do pescoço (lado da frente)
    for (i = 0; i < 4; i++) {
      var k = 0.3 + i * 0.16;
      var fx2 = (-2) * (1 - k) + neckX * k + V.sf * 3;
      var fy2 = -2 - k * (46 - y * -1);
      if (V.fw < 0.15 && V.bk > 0.5) continue;
      ctx.fillStyle = rgba('#0e1c22', 0.5 + V.fw * 0.5);
      ell(ctx, fx2, fy2, 1.5, 1.9); ctx.fill();
      var ph = (t * 2 + i * 0.7) % 1;
      ctx.fillStyle = rgba('#bfe8ea', (1 - ph) * 0.4 * (0.4 + V.fw * 0.6));
      ell(ctx, fx2 - 3 - ph * 4, fy2, 1 + ph * 1.6, 1 + ph); ctx.fill();
    }
    // CABEÇA-flauta: crânio perfurado (projeção axial com escala de profundidade)
    var hs = 1.2 + hd.z * 0.022;
    ctx.fillStyle = litS(ctx, 8, T5('#8aa8b0'), V.lx);
    blob(ctx, [hx3 - 6.5 * hs, hy2 + 4.5, hx3 - 4.4 * hs, hy2 - 5.5 * hs, hx3 + 6.5 * hs, hy2 - 6.5 * hs, hx3 + V.sf * 6 + 8.5 * hs, hy2 - 1, hx3 + 7.5 * hs, hy2 + 5.5]);
    ctx.fill(); outline(ctx, 1.9);
    // boca aberta com dentes de agulha — aponta na direção do facing
    var mx = hx3 + V.sf * 10;
    if (Math.abs(V.sf) > 0.15 || V.fw > 0.3) {
      ctx.fillStyle = '#16262c';
      poly(ctx, [hx3 + V.sf * 4, hy2 - 2.6, mx + V.sf * 4, hy2 + 1 + Math.sin(t * 2.2) * 1.2, hx3 + V.sf * 4, hy2 + 4]);
      ctx.fill();
      ctx.strokeStyle = '#d8ecf0'; ctx.lineWidth = 1;
      for (i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(hx3 + V.sf * (5 + i * 2.4), hy2 - 1 + i * 0.5);
        ctx.lineTo(hx3 + V.sf * (6 + i * 2.4), hy2 + 1.6 + i * 0.4); ctx.stroke();
      }
    }
    // crista de espinha no topo do crânio
    ctx.strokeStyle = rgba('#5c8a96', 0.9); ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(hx3 - 3, hy2 - 6 * hs);
    ctx.quadraticCurveTo(hx3 - V.sf * 4, hy2 - 10 * hs, hx3 - V.sf * 7 - 2, hy2 - 7 * hs); ctx.stroke();
    // olho branco de afogado (dos dois lados, mais forte na frente)
    ctx.save(); ctx.globalAlpha *= (0.35 + V.fw * 0.65);
    eyeV(ctx, hx3 + V.sf * 2, hy2 - 2.4, 2.2 * hs, V, '#d8f0e8');
    ctx.restore();
  };

  // Água-Viva-Lustre: radial — contas do lustre orbitam FIXAS NO MUNDO
  P['lantern-jelly'] = function (ctx, t, o, V) {
    var hov = Math.sin(t * 1.6) * 4, y = -34 + hov;
    var pulse = (Math.sin(t * 2.4) + 1) / 2;
    var i, s;
    glowDot(ctx, 0, -2, 22, '#7ef0d4', 0.25 + pulse * 0.15);
    // tentáculos-franja (radiais, ondulam)
    ctx.lineCap = 'round';
    for (i = -4; i <= 4; i++) {
      s = V.surf(i * 0.66, 17);
      var wob = Math.sin(t * 2.2 + i * 0.9) * 3;
      var depth = 0.5 + Math.max(s.k, -0.5) * 0.5;
      ctx.strokeStyle = rgba(i % 2 ? '#a8e8f0' : '#7ef0d4', 0.3 + depth * 0.35);
      ctx.lineWidth = 1.3 + depth * 0.6;
      ctx.beginPath(); ctx.moveTo(s.x * 0.85, y + 8);
      ctx.quadraticCurveTo(s.x + wob, y + 20, s.x * 1.15 + wob * 1.6, y + 32 + Math.abs(i));
      ctx.stroke();
    }
    // contas de cristal penduradas (giram com a câmera)
    for (i = 0; i < 5; i++) {
      s = V.surf(i * 1.256, 13);
      if (s.k < -0.3) continue;
      var depth2 = 0.6 + s.k * 0.4;
      ctx.fillStyle = rgba('#d8f8f0', 0.4 + depth2 * 0.4);
      ell(ctx, s.x, y + 12 + Math.sin(t * 3 + i) * 1.6, 1.4 * depth2, 2.2 * depth2); ctx.fill();
    }
    // campana translúcida
    var bell = function () {
      ctx.beginPath();
      ctx.moveTo(-20, y + 8);
      ctx.quadraticCurveTo(-22, y - 12, 0, y - 16 - pulse * 2);
      ctx.quadraticCurveTo(22, y - 12, 20, y + 8);
      ctx.quadraticCurveTo(10, y + 13, 0, y + 12);
      ctx.quadraticCurveTo(-10, y + 13, -20, y + 8);
      ctx.closePath();
    };
    bell();
    var lxs = V.lx >= 0 ? 8 : -8;
    ctx.fillStyle = rgrad(ctx, lxs, y - 6, 27, [0, 'rgba(216,252,255,0.85)', 0.55, 'rgba(126,220,232,0.55)', 1, 'rgba(52,120,152,0.55)']);
    ctx.fill(); outline(ctx, 1.7);
    // nervuras da campana (por azimute)
    for (i = -2; i <= 2; i++) {
      s = V.surf(i * 0.62, 16);
      if (s.k < -0.1) continue;
      ctx.strokeStyle = rgba('#eafcff', 0.2 + Math.max(s.k, 0) * 0.4); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(s.x, y + 9);
      ctx.quadraticCurveTo(s.x * 1.1, y - 6, s.x * 0.5, y - 14); ctx.stroke();
    }
    // órgão de luz interno
    ctx.fillStyle = '#fff8e0';
    ell(ctx, 0, y - 2, 4 + pulse * 1.6, 5 + pulse * 1.6); ctx.fill();
    glowDot(ctx, 0, y - 2, 20 + pulse * 8, '#7ef0d4', 0.6);
    // pontinhos de luz na borda (orbitam)
    for (i = 0; i < 7; i++) {
      s = V.surf(i * 0.897, 19);
      if (s.k < -0.4) continue;
      ctx.fillStyle = rgba('#eafcff', (0.3 + pulse * 0.4) * (0.6 + s.k * 0.4));
      ell(ctx, s.x, y + 9.4, 1.1, 1.1); ctx.fill();
    }
  };

  // Salmourão: colosso de sal; coração d'água no PEITO, espinhos nas COSTAS
  P['brine-golem'] = function (ctx, t, o, V) {
    var br = Math.sin(t * 0.9) * 1.2;
    var i, s;
    var saltT = T5('#c8d4d8');
    // braços (trás primeiro)
    function armG(p, near) {
      var ax = p.x * 1.62;
      ctx.fillStyle = near ? litS(ctx, 6, saltT, V.lx) : saltT.sh;
      blob(ctx, [ax - 4.4, -46 + br, ax + 3.4, -47 + br, ax + 5.4, -26, ax + 1, -16, ax - 5, -27]);
      ctx.fill(); outline(ctx, 2.1);
      // junta cristalizada
      ctx.strokeStyle = rgba('#6a8290', 0.6); ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(ax - 3.4, -34); ctx.lineTo(ax + 3.6, -35); ctx.stroke();
    }
    var aR = V.pt(1, 16), aL = V.pt(1, -16);
    if (aL.z < aR.z) armG(aL, false); else armG(aR, false);
    // pernas-blocos
    var lR = V.pt(0, 11), lL = V.pt(0, -11);
    ctx.fillStyle = saltT.md;
    poly(ctx, [lL.x - 6, 0, lL.x + 6, 0, lL.x + 5, -14, lL.x - 5, -13]); ctx.fill(); outline(ctx, 2.1);
    poly(ctx, [lR.x - 6, 0, lR.x + 6, 0, lR.x + 5, -13, lR.x - 5, -14]); ctx.fill(); outline(ctx, 2.1);
    // corpo maciço em camadas
    var bw = 21 * (1 - Math.abs(V.sf) * 0.1);
    var body = function () {
      poly(ctx, [-bw - 1, -12, bw + 1, -12, bw - 2, -30 + br, bw, -32 + br, bw - 5, -48 + br, -bw + 4, -48 + br, -bw, -31 + br, -bw + 2, -29 + br]);
    };
    body();
    ctx.fillStyle = litH(ctx, bw, saltT, V.lx); ctx.fill(); outline(ctx, 2.5);
    aoV(ctx, body, -24, -10, 0.28);
    // estratos horizontais
    ctx.strokeStyle = rgba('#6a8290', 0.7); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-bw + 1, -20); ctx.lineTo(bw - 1, -21); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-bw + 1, -30 + br); ctx.lineTo(bw - 1, -31 + br); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-bw + 3, -40 + br); ctx.lineTo(bw - 4, -40 + br); ctx.stroke();
    // lascas afiadas nos ombros
    ctx.fillStyle = saltT.hi;
    poly(ctx, [-bw + 4, -48 + br, -bw - 1, -58 + br, -bw + 9, -50 + br]); ctx.fill(); outline(ctx, 1.7);
    poly(ctx, [bw - 5, -48 + br, bw - 1, -56 + br, bw - 10, -50 + br]); ctx.fill(); outline(ctx, 1.7);
    // FRENTE: coração de água escura / COSTAS: cristais crescendo
    if (V.fw > 0.08) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var hb = 1 + Math.sin(t * 2.2) * 0.12;
      var cxx = V.sf * 6;
      ctx.fillStyle = '#0e2230';
      blob(ctx, [cxx - 6 * hb, -32, cxx, -38 - br, cxx + 6 * hb, -32, cxx + 4 * hb, -26, cxx - 4 * hb, -26]);
      ctx.fill();
      ctx.fillStyle = rgba('#2e6e8e', 0.9);
      ell(ctx, cxx, -31 - br, 3.4 * hb, 4 * hb); ctx.fill();
      glowDot(ctx, cxx, -31 - br, 10, '#2e8ea8', 0.5 * V.fw);
      // rachaduras irradiando
      ctx.strokeStyle = rgba('#4a6a7a', 0.8); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cxx - 5, -30); ctx.lineTo(cxx - 12, -26); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cxx + 5, -34); ctx.lineTo(cxx + 12, -37); ctx.stroke();
      ctx.restore();
    }
    if (V.bk > 0.25) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.25) / 0.75;
      var bx = -V.sf * 5;
      ctx.fillStyle = '#eef4f6';
      poly(ctx, [bx - 8, -28, bx - 4, -40 + br, bx - 1, -28]); ctx.fill(); outline(ctx, 1.3);
      poly(ctx, [bx + 1, -32, bx + 5, -44 + br, bx + 8, -31]); ctx.fill(); outline(ctx, 1.3);
      poly(ctx, [bx - 3, -22, bx, -31, bx + 3, -21]); ctx.fill(); outline(ctx, 1.2);
      ctx.restore();
    }
    // braço da frente
    if (aL.z < aR.z) armG(aR, true); else armG(aL, true);
    // cabeça pequena sem pescoço
    var hx2 = V.sf * 4;
    ctx.fillStyle = litS(ctx, 9, T5('#d8e2e6'), V.lx);
    poly(ctx, [hx2 - 9, -48 + br, hx2 + 9, -48 + br, hx2 + 7, -58 + br, hx2 - 7, -58 + br]); ctx.fill(); outline(ctx, 2.1);
    if (V.fw > 0.1) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      eyeV(ctx, hx2 - 3.6, -53 + br, 1.8, V, '#2e8ea8');
      eyeV(ctx, hx2 + 3.6, -53 + br, 1.8, V, '#2e8ea8');
      ctx.restore();
    } else if (V.bk > 0.4) {
      // nuca: fenda cristalizada
      ctx.strokeStyle = rgba('#6a8290', 0.7 * V.bk); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(hx2 - 3, -56 + br); ctx.lineTo(hx2 + 2, -51 + br); ctx.stroke();
    }
  };

  // Gota-Gorda: rosto sonolento BOIANDO DENTRO — parallax pelo yaw
  P['fat-drop'] = function (ctx, t, o, V) {
    var sq = 1 + Math.sin(t * 2.2) * 0.05;
    var y = Math.sin(t * 2.2 + 1) * 1.4;
    ctx.save(); ctx.translate(0, y); ctx.scale(sq, 1 / sq);
    var body = function () {
      ctx.beginPath();
      ctx.moveTo(0, -46);
      ctx.quadraticCurveTo(-19, -34, -19, -16);
      ctx.quadraticCurveTo(-19, 0, 0, 0);
      ctx.quadraticCurveTo(19, 0, 19, -16);
      ctx.quadraticCurveTo(19, -34, 0, -46);
      ctx.closePath();
    };
    body();
    var lxs = V.lx >= 0 ? 7 : -7;
    ctx.fillStyle = rgrad(ctx, lxs, -26, 31, [0, 'rgba(150,216,236,0.92)', 0.55, 'rgba(70,150,190,0.88)', 1, 'rgba(24,70,108,0.92)']);
    ctx.fill(); outline(ctx, 2.3);
    // brilho especular no lado da luz
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ell(ctx, lxs * 1.15, -32, 3.4, 6); ctx.fill();
    ell(ctx, lxs * 0.6, -40, 1.6, 2.6); ctx.fill();
    // rosto sonolento boiando DENTRO da gota — desloca com o yaw (parallax)
    var fx3 = V.sf * 7 + Math.sin(t * 1.1) * 3, fy3 = -18 + Math.sin(t * 1.7) * 2;
    var vis = 0.25 + V.fw * 0.65;      // de costas: silhueta turva do rosto
    ctx.save(); ctx.globalAlpha *= vis;
    ctx.strokeStyle = '#0e2c3c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(fx3 - 6, fy3, 3.4, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.beginPath(); ctx.arc(fx3 + 6, fy3, 3.4, 0.2, Math.PI - 0.2); ctx.stroke();
    ell(ctx, fx3, fy3 + 8, 2.6, 3.2);
    ctx.fillStyle = '#0e2c3c'; ctx.fill();
    var bub = (t * 0.9) % 1;
    ctx.strokeStyle = rgba('#d8f4ff', 1 - bub); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(fx3 + 8 + bub * 4, fy3 + 4 - bub * 10, 2 + bub * 2, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    // detrito girando dentro (pérola perdida)
    var s = V.surf(2.2 + t * 0.3, 10);
    ctx.fillStyle = rgba('#e8e2d4', 0.5 + Math.max(s.k, 0) * 0.3);
    ell(ctx, s.x, -12 + Math.sin(t * 1.3) * 3, 1.8, 1.8); ctx.fill();
    ctx.restore();
  };

  // Gotinha: pequena, redonda, indignada
  P['droplet'] = function (ctx, t, o, V) {
    var bo = Math.abs(Math.sin(t * 4.4)) * 4, y = -bo;
    var body = function () {
      ctx.beginPath();
      ctx.moveTo(0, -22 + y);
      ctx.quadraticCurveTo(-9, -15 + y, -9, -7 + y);
      ctx.quadraticCurveTo(-9, 0 + y, 0, 0 + y);
      ctx.quadraticCurveTo(9, 0 + y, 9, -7 + y);
      ctx.quadraticCurveTo(9, -15 + y, 0, -22 + y);
      ctx.closePath();
    };
    body();
    var lxs = V.lx >= 0 ? 3.4 : -3.4;
    ctx.fillStyle = rgrad(ctx, lxs, -10 + y, 15, [0, 'rgba(160,224,244,0.95)', 0.6, 'rgba(80,160,200,0.92)', 1, 'rgba(30,80,120,0.95)']);
    ctx.fill(); outline(ctx, 1.9);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ell(ctx, lxs, -14 + y, 1.6, 2.6); ctx.fill();
    if (V.fw > 0.1) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var fx0 = V.sf * 3.4;
      ctx.strokeStyle = '#0e2c3c'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(fx0 - 5.5, -12 + y); ctx.lineTo(fx0 - 1.5, -10 + y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx0 + 5.5, -12 + y); ctx.lineTo(fx0 + 1.5, -10 + y); ctx.stroke();
      eyeV(ctx, fx0 - 3.4, -7.6 + y, 1.6, V); eyeV(ctx, fx0 + 3.4, -7.6 + y, 1.6, V);
      ctx.beginPath(); ctx.arc(fx0, -2.6 + y, 2, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      ctx.restore();
    }
  };

  // BARONESA SALMOURA (CHEFE ~2x): vestido de baile, pérolas que ORBITAM
  P['boss-baroness'] = function (ctx, t, o, V) {
    var sc = 1.9; ctx.save(); ctx.scale(sc, sc);
    var sw = Math.sin(t * 1.2) * 2;
    var wl = Math.sin(t * 2.0);
    var i, s;
    // leque na mão direita (orbita)
    var fan = V.pt(3, 16);
    function drawFan(near) {
      var px = fan.x * 1.6;
      ctx.strokeStyle = rgba('#3c6a8a', 0.9); ctx.lineWidth = 4.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(V.sf * 3 + (near ? 8 : -8) * V.cf * 0.9, -48 + sw);
      ctx.quadraticCurveTo(px * 0.9, -44 - wl, px, -32 - wl * 2); ctx.stroke();
      ctx.save(); ctx.translate(px, -32 - wl * 2); ctx.rotate(0.7 + V.sf * 0.3 + wl * 0.06);
      // leque meio aberto
      for (var j = 0; j < 4; j++) {
        ctx.fillStyle = rgba(j % 2 ? '#8aa8c0' : '#6a8aa8', 0.9);
        ctx.save(); ctx.rotate(-0.12 + j * 0.09);
        poly(ctx, [0, 0, 13, -2.4, 13, 0.8, 0, 1.8]); ctx.fill();
        ctx.restore();
      }
      outline(ctx, 1.1);
      ctx.restore();
      // gotas escorrendo da mão
      var dr = (t * 1.4) % 1;
      ctx.fillStyle = rgba('#7ec8e0', 1 - dr);
      ell(ctx, px, -28 - wl * 2 + dr * 12, 1.4, 2); ctx.fill();
    }
    if (fan.z < 0) drawFan(false);

    // saia de baile enorme
    var skw = 30 * (1 - Math.abs(V.sf) * 0.06);
    var skirt = function () {
      ctx.beginPath();
      ctx.moveTo(-skw, 0);
      ctx.quadraticCurveTo(-skw - 2, -18, -14, -34 + sw * 0.4);
      ctx.lineTo(14, -34 + sw * 0.4);
      ctx.quadraticCurveTo(skw + 2, -18, skw, 0);
      ctx.quadraticCurveTo(20, 3 + wl, 10, 0.5);
      ctx.quadraticCurveTo(0, 3.4 - wl, -10, 0.5);
      ctx.quadraticCurveTo(-20, 3 + wl, -skw, 0);
      ctx.closePath();
    };
    skirt();
    ctx.fillStyle = litH(ctx, skw, T5('#2a4a6e'), V.lx); ctx.fill(); outline(ctx, 2.5);
    aoV(ctx, skirt, -14, 2, 0.3);
    // brocado antigo — curvas por azimute (giram)
    for (i = 0; i < 5; i++) {
      s = V.surf(-1.6 + i * 0.8, skw * 0.82);
      if (s.k < -0.05) continue;
      ctx.strokeStyle = rgba('#7a9ab8', 0.2 + Math.max(s.k, 0) * 0.35); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(s.x, -2);
      ctx.quadraticCurveTo(s.x * 0.9, -16, s.x * 0.55, -32); ctx.stroke();
    }
    // FRENTE: janela rasgada com água viva / COSTAS: cauda + laço encharcado
    if (V.fw > 0.1) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var wx = V.sf * 8;
      ctx.beginPath();
      ctx.moveTo(wx - 10, -4); ctx.quadraticCurveTo(wx - 6, -18, wx + 2, -24);
      ctx.quadraticCurveTo(wx + 10, -18, wx + 9, -4); ctx.closePath();
      ctx.save(); ctx.clip();
      ctx.fillStyle = '#0a1a2c'; ctx.fillRect(wx - 12, -26, 24, 24);
      ctx.strokeStyle = rgba('#7ef0d4', 0.5); ctx.lineWidth = 1.3;
      for (i = 0; i < 3; i++) {
        var ph = (t * 0.9 + i * 0.33) % 1;
        ctx.beginPath(); ctx.moveTo(wx - 10, -4 - ph * 20);
        ctx.quadraticCurveTo(wx, -8 - ph * 20 + Math.sin(t * 3 + i) * 2, wx + 10, -4 - ph * 20);
        ctx.stroke();
      }
      // rostinhos afogados na água da saia (detalhe macabro sutil)
      glowDot(ctx, wx - 3, -12, 3, '#7ef0d4', 0.3);
      glowDot(ctx, wx + 4, -17, 2.4, '#7ef0d4', 0.25);
      ctx.restore();
      ctx.strokeStyle = rgba('#8ab8d0', 0.6); ctx.lineWidth = 1.4; ctx.stroke();
      ctx.restore();
    }
    if (V.bk > 0.25) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.25) / 0.75;
      var bx = -V.sf * 8;
      // anágua de cauda + laço
      ctx.fillStyle = rgba('#1d3a5d', 0.9);
      blob(ctx, [bx - 9, -30 + sw * 0.4, bx + 9, -30 + sw * 0.4, bx + 13, -12, bx, -6 + wl, bx - 13, -12]);
      ctx.fill(); outline(ctx, 1.7);
      ctx.fillStyle = '#3c5a7a';
      poly(ctx, [bx, -28, bx - 8, -33, bx - 6, -24]); ctx.fill(); outline(ctx, 1.2);
      poly(ctx, [bx, -28, bx + 8, -33, bx + 6, -24]); ctx.fill(); outline(ctx, 1.2);
      ell(ctx, bx, -28, 2.4, 2.6); ctx.fillStyle = '#5a7a9a'; ctx.fill(); outline(ctx, 1.1);
      // gotejar da barra
      var dr2 = (t * 1.1) % 1;
      ctx.fillStyle = rgba('#7ec8e0', 1 - dr2);
      ell(ctx, bx - 5, -10 + dr2 * 9, 1.2, 1.8); ctx.fill();
      ctx.restore();
    }
    // corpete
    var torso = function () { blob(ctx, [-13, -33 + sw * 0.4, -10, -52 + sw, 0, -55 + sw, 10, -52 + sw, 13, -33 + sw * 0.4]); };
    torso();
    ctx.fillStyle = litH(ctx, 13, T5('#24405e'), V.lx); ctx.fill(); outline(ctx, 2.3);
    // FRENTE: corpete brocado / COSTAS: amarração do espartilho
    if (V.fw > 0.1) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var cxx = V.sf * 5;
      ctx.strokeStyle = rgba('#7a9ab8', 0.5); ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(cxx - 6, -50 + sw); ctx.quadraticCurveTo(cxx, -44 + sw, cxx - 5, -36 + sw); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cxx + 6, -50 + sw); ctx.quadraticCurveTo(cxx, -44 + sw, cxx + 5, -36 + sw); ctx.stroke();
      ctx.restore();
    }
    if (V.bk > 0.3) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.3) / 0.7;
      var bxx = -V.sf * 5;
      ctx.strokeStyle = rgba('#8ab8d0', 0.8); ctx.lineWidth = 1.2;
      for (i = 0; i < 4; i++) {
        var yy = -51 + sw + i * 4.4;
        ctx.beginPath(); ctx.moveTo(bxx - 4, yy); ctx.lineTo(bxx + 4, yy + 2.6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bxx + 4, yy); ctx.lineTo(bxx - 4, yy + 2.6); ctx.stroke();
      }
      ctx.restore();
    }
    // ombros de renda encharcada
    var shR = V.pt(1, 12), shL = V.pt(1, -12);
    ctx.fillStyle = rgba('#5a7a9a', 0.8);
    ell(ctx, shL.x * 1.05, -50 + sw, 6, 4); ctx.fill(); outline(ctx, 1.5);
    ell(ctx, shR.x * 1.05, -50 + sw, 6, 4); ctx.fill(); outline(ctx, 1.5);
    // braço esquerdo d'água
    var la = V.pt(2, -15);
    ctx.strokeStyle = rgba('#3c6a8a', 0.9); ctx.lineWidth = 4.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(V.sf * 3 - 8 * V.cf, -48 + sw);
    ctx.quadraticCurveTo(la.x * 1.4, -42 + wl, la.x * 1.6, -28 + wl * 2); ctx.stroke();

    // COLAR DE PÉROLAS boiando (cada pérola orbita FIXA no mundo!)
    var ny = -62 + sw + Math.sin(t * 1.7) * 1.6;
    ctx.strokeStyle = rgba('#d8e8f0', 0.25); ctx.lineWidth = 5;
    ell(ctx, 0, ny, 9, 3.6); ctx.stroke();
    var pearls = [];
    for (i = 0; i < 9; i++) {
      var a = (i / 9) * Math.PI * 2 + t * 0.55;
      s = V.surf(a, 9.4);
      pearls.push({ x: s.x, y: ny + s.k * -3.4, k: s.k });
    }
    pearls.sort(function (p1, p2) { return p2.k - p1.k; });
    for (i = 0; i < pearls.length; i++) {
      var p = pearls[i];
      var pr = 2.1 * (0.75 + (1 - Math.max(p.k, 0)) * 0.35);
      ctx.fillStyle = lgrad(ctx, p.x - 2, p.y - 2, p.x + 2, p.y + 2, [0, '#fef8ec', 1, '#a89f88']);
      ell(ctx, p.x, p.y, pr, pr); ctx.fill();
      ctx.strokeStyle = rgba('#6a625a', 0.6); ctx.lineWidth = 0.8; ctx.stroke();
    }
    glowDot(ctx, 0, ny, 15, (o && o.tintAccent) || '#7ef0d4', 0.35);
    // coroa d'água
    ctx.strokeStyle = rgba('#7ec8e0', 0.5); ctx.lineWidth = 1.6;
    for (i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(i * 4, ny - 4);
      ctx.quadraticCurveTo(i * 4.6, ny - 10 - Math.sin(t * 2.6 + i) * 2, i * 3, ny - 12 - Math.sin(t * 2.2 + i) * 2);
      ctx.stroke();
    }
    if (fan.z >= 0) drawFan(true);
    ctx.restore();
  };
})();

// ============================================================================
// PARTE 4 — MONSTROS: Fecho de Brasa (Prole da Fornalha)
// ============================================================================
(function () {
  var S = JOGO.Sprites, H = S.__helpers;
  var P = H.P, T5 = H.T5, litH = H.litH, litS = H.litS, rimL = H.rimL, aoV = H.aoV;
  var rgba = H.rgba, shade = H.shade, mix = H.mix, lgrad = H.lgrad, rgrad = H.rgrad;
  var outline = H.outline, ell = H.ell, poly = H.poly, blob = H.blob;
  var glowDot = H.glowDot, eyeV = H.eyeV, clamp = H.clamp;

  // Tição: carvão em brasa correndo; sorriso rachado na frente, fenda nas costas
  P['ember-imp'] = function (ctx, t, o, V) {
    var bo = Math.abs(Math.sin(t * 4.8)) * 3.4, y = -bo;
    var hot = 0.6 + Math.sin(t * 6) * 0.25;
    var i, s;
    glowDot(ctx, 0, -18 + y, 26, '#ff7a3c', hot * 0.5);
    // braços finos animados
    var aR = V.pt(0, 12), aL = V.pt(0, -12);
    ctx.strokeStyle = '#2c1812'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(aL.x * 0.9, -18 + y);
    ctx.quadraticCurveTo(aL.x * 1.4, -14 + Math.sin(t * 5) * 3, aL.x * 1.6, -22 + Math.sin(t * 5) * 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(aR.x * 0.9, -18 + y);
    ctx.quadraticCurveTo(aR.x * 1.4, -14 - Math.sin(t * 5) * 3, aR.x * 1.6, -22 - Math.sin(t * 5) * 4); ctx.stroke();
    // garras em brasa nas pontas
    ctx.fillStyle = rgba('#ffb060', 0.9);
    ell(ctx, aL.x * 1.6, -22 + Math.sin(t * 5) * 4, 1.6, 1.6); ctx.fill();
    ell(ctx, aR.x * 1.6, -22 - Math.sin(t * 5) * 4, 1.6, 1.6); ctx.fill();
    // perninhas
    var lR = V.pt(0, 6), lL = V.pt(0, -6);
    ctx.strokeStyle = '#2c1812'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(lL.x * 0.85, -6 + y); ctx.lineTo(lL.x * 1.15, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lR.x * 0.85, -6 + y); ctx.lineTo(lR.x * 1.15, 0); ctx.stroke();
    // corpo: carvão anguloso
    var body = function () {
      poly(ctx, [-12, -6 + y, -14, -18 + y, -8, -28 + y, 2, -31 + y, 12, -26 + y, 13, -14 + y, 6, -5 + y]);
    };
    body();
    ctx.fillStyle = litH(ctx, 14, T5('#4a2e22'), V.lx); ctx.fill(); outline(ctx, 2.2);
    glowDot(ctx, 0, -18 + y, 13, '#ff8a3c', hot * 0.35);
    // rachaduras incandescentes na superfície (por azimute)
    ctx.lineCap = 'round';
    for (i = 0; i < 3; i++) {
      s = V.surf(0.7 + i * 2.0, 10);
      if (s.k < 0.02) continue;
      ctx.strokeStyle = rgba('#ffa254', (0.5 + s.k * 0.5) * hot); ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(s.x, -24 + y + i * 2);
      ctx.lineTo(s.x + 3 * s.k, -19 + y + i * 2); ctx.lineTo(s.x - 1, -14 + y + i); ctx.stroke();
    }
    if (V.fw > 0.06) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var fx0 = V.sf * 5;
      // SORRISO rachado de luz (o estopim)
      ctx.strokeStyle = rgba('#ffb060', 0.95); ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(fx0 - 7, -12 + y);
      ctx.quadraticCurveTo(fx0, -6.5 + y, fx0 + 7, -12 + y); ctx.stroke();
      ctx.lineWidth = 1.2;
      for (i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(fx0 + i * 4, -9.6 + y + Math.abs(i)); ctx.lineTo(fx0 + i * 4, -12.4 + y); ctx.stroke();
      }
      glowDot(ctx, fx0, -10 + y, 9, '#ffb060', hot * 0.8 * V.fw);
      eyeV(ctx, fx0 - 5, -21 + y, 2, V, '#ffcf6a');
      eyeV(ctx, fx0 + 5, -21 + y, 2, V, '#ffcf6a');
      ctx.restore();
    }
    // costas: fenda vulcânica em cruz vazando luz
    if (V.bk > 0.3) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.3) / 0.7;
      var bx = -V.sf * 5;
      ctx.strokeStyle = rgba('#ff9a4a', hot); ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(bx, -26 + y); ctx.lineTo(bx + 1, -12 + y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx - 4, -20 + y); ctx.lineTo(bx + 5, -19 + y); ctx.stroke();
      glowDot(ctx, bx, -19 + y, 8, '#ff9a4a', hot * 0.7);
      ctx.restore();
    }
    // fagulhas subindo
    for (i = 0; i < 3; i++) {
      var ph = (t * 1.6 + i * 0.4) % 1;
      ctx.fillStyle = rgba('#ffb060', (1 - ph) * 0.8);
      ell(ctx, Math.sin(i * 9 + t) * 8, -28 + y - ph * 16, 1.2, 1.2); ctx.fill();
    }
  };

  // Bigorna Ambulante: o CHIFRE da bigorna aponta na direção do facing!
  P['walking-anvil'] = function (ctx, t, o, V) {
    var stomp = Math.abs(Math.sin(t * 2.2)) * 1.6;
    var y = -stomp;
    var i, s;
    var iron = T5('#5c5a60');
    // pernas atarracadas
    var lR = V.pt(0, 10), lL = V.pt(0, -10);
    ctx.fillStyle = '#3c3a40';
    poly(ctx, [lL.x - 4.6, 0, lL.x + 4.6, 0, lL.x + 4, -10 + y, lL.x - 4, -10 + y]); ctx.fill(); outline(ctx, 2.1);
    poly(ctx, [lR.x - 4.6, 0, lR.x + 4.6, 0, lR.x + 4, -10 + y, lR.x - 4, -10 + y]); ctx.fill(); outline(ctx, 2.1);
    // base da bigorna
    ctx.fillStyle = litH(ctx, 13, T5('#4a484e'), V.lx);
    poly(ctx, [-13, -9 + y, 13, -9 + y, 10, -20 + y, -10, -20 + y]); ctx.fill(); outline(ctx, 2.3);
    // corpo da bigorna: bloco + CHIFRE apontando para onde encara
    var hornLen = 14 * V.sf;                    // chifre encolhe de frente (foreshortening)
    var tailLen = -9 * V.sf;
    var bw = 15 + Math.abs(V.sf) * 4;
    var body = function () {
      ctx.beginPath();
      ctx.moveTo(-bw, -20 + y);
      ctx.lineTo(bw, -20 + y);
      ctx.lineTo(bw - 2, -30 + y);
      if (Math.abs(hornLen) > 2) {
        ctx.lineTo(bw - 2 + hornLen, -31 + y);
        ctx.quadraticCurveTo(bw + 2 + hornLen * 1.25, -34 + y, bw - 2 + hornLen * 0.9, -38 + y);
      }
      ctx.lineTo(bw - 4, -36 + y);
      ctx.lineTo(-bw + 4, -36 + y);
      if (Math.abs(tailLen) > 1.4) {
        ctx.lineTo(-bw + tailLen, -33 + y);
        ctx.lineTo(-bw + tailLen, -26 + y);
      }
      ctx.closePath();
    };
    body();
    ctx.fillStyle = litH(ctx, bw + 6, iron, V.lx); ctx.fill(); outline(ctx, 2.5);
    // topo de metal batido
    ctx.strokeStyle = rgba('#c8c6cc', 0.5); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-bw + 5, -35 + y); ctx.lineTo(bw - 5, -35 + y); ctx.stroke();
    // cicatrizes de marteladas (superfície)
    for (i = 0; i < 3; i++) {
      s = V.surf(0.5 + i * 1.7, bw * 0.7);
      if (s.k < 0.05) continue;
      ctx.strokeStyle = rgba('#1c1a20', 0.5 + s.k * 0.4); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(s.x - 2.4, -32 + y + i * 2.4); ctx.lineTo(s.x + 2, -29.6 + y + i * 2.4); ctx.stroke();
    }
    // FRENTE: cara de ferro raivosa gravada
    if (V.fw > 0.08) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var fx0 = V.sf * 6;
      ctx.fillStyle = '#ff6a2c';
      poly(ctx, [fx0 - 9, -28 + y, fx0 - 3, -26 + y, fx0 - 9, -24.6 + y]); ctx.fill();
      poly(ctx, [fx0 + 9, -28 + y, fx0 + 3, -26 + y, fx0 + 9, -24.6 + y]); ctx.fill();
      glowDot(ctx, fx0 - 6, -26 + y, 5, '#ff6a2c', 0.5 * V.fw);
      glowDot(ctx, fx0 + 6, -26 + y, 5, '#ff6a2c', 0.5 * V.fw);
      // boca: fresta rangendo
      ctx.strokeStyle = rgba('#ff6a2c', 0.6); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(fx0 - 4, -22.6 + y); ctx.lineTo(fx0 + 4, -22.6 + y); ctx.stroke();
      ctx.restore();
    }
    // COSTAS: marca de fundição estampada
    if (V.bk > 0.35) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.35) / 0.65;
      var bx = -V.sf * 5;
      ctx.strokeStyle = rgba('#8a888e', 0.8); ctx.lineWidth = 1.3;
      ell(ctx, bx, -27 + y, 4.4, 4.4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx - 2.4, -27 + y); ctx.lineTo(bx + 2.4, -27 + y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx, -29.4 + y); ctx.lineTo(bx, -24.6 + y); ctx.stroke();
      ctx.restore();
    }
    // vapor das narinas ao pisar (sai pelo chifre)
    if (stomp > 1.2 && Math.abs(V.sf) > 0.2) {
      ctx.fillStyle = rgba('#c8c6cc', (stomp - 1.2) * 0.8);
      ell(ctx, (bw - 2) * (V.sf > 0 ? 1 : -1) + hornLen, -34 + y, 2.4, 1.4); ctx.fill();
    }
  };

  // Cinzento: vulto de fuligem; olhos-brasa na frente, capuz vazio atrás
  P['ash-wraith'] = function (ctx, t, o, V) {
    var dr = Math.sin(t * 1.4) * 2;
    var i, s;
    ctx.save(); ctx.globalAlpha *= 0.85;
    // fumaça na base
    for (i = 0; i < 4; i++) {
      var ph = (t * 0.7 + i * 0.25) % 1;
      ctx.fillStyle = rgba('#4a4448', (1 - ph) * 0.5);
      ell(ctx, Math.sin(i * 7 + t * 1.2) * (6 + ph * 8), -4 - ph * 8, 6 - ph * 2, 4 - ph); ctx.fill();
    }
    // vulto do torso
    var body = function () {
      ctx.beginPath();
      ctx.moveTo(-10, -8);
      ctx.quadraticCurveTo(-16, -22, -12, -38 + dr);
      ctx.quadraticCurveTo(-10, -50 + dr, 0, -52 + dr);
      ctx.quadraticCurveTo(12, -50 + dr, 13, -38 + dr);
      ctx.quadraticCurveTo(15, -24, 8, -8);
      ctx.quadraticCurveTo(0, -2, -10, -8);
      ctx.closePath();
    };
    body();
    ctx.fillStyle = litH(ctx, 14, T5('#443c40'), V.lx); ctx.fill();
    // farrapos desprendendo
    ctx.fillStyle = rgba('#3c3438', 0.7);
    ell(ctx, -13 + Math.sin(t * 2) * 2, -20, 3.4, 6); ctx.fill();
    ell(ctx, 13 + Math.sin(t * 2.4) * 2, -26, 3, 5); ctx.fill();
    // avental de ferreiro fantasma (frente)
    if (V.fw > 0.15) {
      ctx.save(); ctx.globalAlpha *= V.fw * 0.7;
      var ax = V.sf * 4;
      ctx.fillStyle = '#2e282c';
      poly(ctx, [ax - 7, -36 + dr, ax + 7, -36 + dr, ax + 5.4, -12, ax - 5.4, -12]); ctx.fill();
      ctx.strokeStyle = rgba('#5c5458', 0.6); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ax - 5, -30 + dr); ctx.lineTo(ax + 5, -30 + dr); ctx.stroke();
      ctx.restore();
    }
    // cabeça encapuzada
    var hx2 = V.sf * 3;
    ctx.fillStyle = litS(ctx, 8, T5('#332b30'), V.lx);
    blob(ctx, [hx2 - 8, -50 + dr, hx2 - 7, -60 + dr, hx2, -63 + dr, hx2 + 7, -60 + dr, hx2 + 8, -50 + dr]);
    ctx.fill();
    // FRENTE: dois pontos de brasa / COSTAS: capuz oco com brasas vazando
    var hot = 0.7 + Math.sin(t * 5) * 0.25;
    if (V.fw > 0.06) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      ctx.fillStyle = '#ff8a3c';
      ell(ctx, hx2 - 3.4, -56 + dr, 1.8, 2.2); ctx.fill();
      ell(ctx, hx2 + 3.4, -56 + dr, 1.8, 2.2); ctx.fill();
      glowDot(ctx, hx2 - 3.4, -56 + dr, 7, '#ff8a3c', hot * V.fw);
      glowDot(ctx, hx2 + 3.4, -56 + dr, 7, '#ff8a3c', hot * V.fw);
      ctx.restore();
    }
    if (V.bk > 0.3) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.3) / 0.7;
      var bx = -V.sf * 3;
      // costura do capuz + brasas escapando por trás
      ctx.strokeStyle = rgba('#5c5458', 0.8); ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(bx, -62 + dr); ctx.quadraticCurveTo(bx + 1, -56 + dr, bx, -50 + dr); ctx.stroke();
      var phb = (t * 1.3) % 1;
      ctx.fillStyle = rgba('#ff8a3c', (1 - phb) * 0.7);
      ell(ctx, bx + Math.sin(t * 4) * 3, -54 + dr - phb * 8, 1.1, 1.1); ctx.fill();
      ctx.restore();
    }
    // braço apontando na direção do facing
    var pt = V.pt(14, 2);
    ctx.strokeStyle = rgba('#3c3438', 0.9); ctx.lineWidth = 4.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(V.sf * 5, -44 + dr);
    ctx.quadraticCurveTo(pt.x * 0.8, -42, pt.x * 1.35, -44 + Math.sin(t * 1.8) * 2); ctx.stroke();
    ctx.fillStyle = '#ff8a3c';
    ell(ctx, pt.x * 1.4, -44 + Math.sin(t * 1.8) * 2, 1.6, 1.6); ctx.fill();
    glowDot(ctx, pt.x * 1.4, -44 + Math.sin(t * 1.8) * 2, 5, '#ff8a3c', 0.5);
    // fuligem orbitando (fixa no mundo)
    for (i = 0; i < 5; i++) {
      var a = t * 0.9 + i * 1.26;
      s = V.surf(a, 18);
      ctx.fillStyle = rgba('#6a6268', 0.3 + Math.max(s.k, 0) * 0.3);
      ell(ctx, s.x, -34 + Math.sin(a * 1.4) * 20, 1.3, 1.3); ctx.fill();
    }
    ctx.restore();
  };

  // Monte de Escória: pilha rastejante — rachaduras de brasa por azimute
  P['slag-mound'] = function (ctx, t, o, V) {
    var oo = Math.sin(t * 1.1) * 1.4;
    var hot = 0.5 + Math.sin(t * 3.4) * 0.25;
    var i, s;
    // rastro vitrificado atrás (na direção OPOSTA ao facing)
    var trail = V.pt(-16, 0);
    ctx.fillStyle = rgba('#7a4a2c', 0.4);
    ell(ctx, trail.x, -1, 12, 3); ctx.fill();
    glowDot(ctx, trail.x, -1, 10, '#ff7a3c', 0.12);
    // pilha disforme
    var body = function () {
      blob(ctx, [-22, -3, -24, -14 + oo, -12, -26 + oo, -2, -22, 4, -30 + oo, 14, -24 + oo, 22, -12, 20, -3]);
    };
    body();
    ctx.fillStyle = litH(ctx, 23, T5('#4a352c'), V.lx); ctx.fill(); outline(ctx, 2.3);
    aoV(ctx, body, -12, -1, 0.3);
    // calombos
    ctx.fillStyle = '#4a3830';
    ell(ctx, -8, -25 + oo, 5, 3.6); ctx.fill(); outline(ctx, 1.5);
    ell(ctx, 9, -26 + oo, 4, 3); ctx.fill(); outline(ctx, 1.5);
    // RACHADURAS de brasa na superfície (giram por azimute)
    ctx.lineCap = 'round';
    for (i = 0; i < 4; i++) {
      s = V.surf(-1.8 + i * 1.15, 16);
      if (s.k < 0) continue;
      ctx.strokeStyle = rgba('#ff8a3c', (hot + 0.3) * (0.4 + s.k * 0.6)); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.x, -6 - i);
      ctx.lineTo(s.x + 4 * s.k, -13 + oo - i); ctx.lineTo(s.x - 2, -18 + oo); ctx.stroke();
    }
    glowDot(ctx, 0, -14, 20, '#ff7a3c', hot * 0.4);
    // olhos: brasas fundas desalinhadas (frente)
    if (V.fw > 0.08) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var fx0 = V.sf * 8;
      eyeV(ctx, fx0 - 7, -18 + oo, 2, V, '#ffb060');
      eyeV(ctx, fx0 + 6, -21 + oo, 1.7, V, '#ffb060');
      // boca de forno derretida
      ctx.strokeStyle = rgba('#ff8a3c', 0.5 * V.fw); ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(fx0 - 4, -10 + oo); ctx.quadraticCurveTo(fx0, -8 + oo, fx0 + 4, -10.5 + oo); ctx.stroke();
      ctx.restore();
    }
    // goteja escória
    var dp = (t * 1.2) % 1;
    ctx.fillStyle = rgba('#ff8a3c', 1 - dp);
    ell(ctx, 14, -6 + dp * 6, 1.4, 2); ctx.fill();
  };

  // Ferreiro Sem-Rosto: avental na frente, correias cruzadas atrás; martelo orbita
  P['faceless-smith'] = function (ctx, t, o, V) {
    var wob = Math.sin(t * 1.6) * 1.6;
    var i;
    // calor tremulando
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < 3; i++) {
      var ph = (t * 0.8 + i * 0.33) % 1;
      ctx.strokeStyle = rgba('#ff9a5a', (1 - ph) * 0.18);
      ctx.lineWidth = 5 - ph * 3;
      ctx.beginPath();
      ctx.moveTo(-10, -30 - ph * 26);
      ctx.quadraticCurveTo(0, -34 - ph * 26 + Math.sin(t * 4 + i * 2) * 3, 10, -30 - ph * 26);
      ctx.stroke();
    }
    ctx.restore();
    // martelo na mão direita (orbita)
    var ham = V.pt(2, 15);
    function drawHammer(near) {
      var hx = ham.x * 1.75;
      // braço musculoso flutuante
      ctx.save(); ctx.translate(hx, -44 + wob + Math.sin(t * 2) * 2);
      ctx.fillStyle = lgrad(ctx, -6, -8, 6, 12, [0, near ? '#d8aa80' : '#a87c58', 1, '#8a6242']);
      blob(ctx, [-5, -6, 4, -8, 7, 2, 4, 12, -3, 10]);
      ctx.fill(); outline(ctx, 1.9);
      ctx.restore();
      ctx.save(); ctx.translate(hx + 5, -32 + wob); ctx.rotate(0.3 + V.sf * 0.2 + Math.sin(t * 2.2) * 0.12);
      ctx.strokeStyle = '#5a4630'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -14); ctx.stroke();
      ctx.fillStyle = lgrad(ctx, -7, -20, 7, -12, [0, '#9a989e', 1, '#3d3b42']);
      poly(ctx, [-7, -20, 7, -20, 7, -13, -7, -13]); ctx.fill(); outline(ctx, 1.7);
      // face do martelo em brasa
      glowDot(ctx, V.sf * 5, -16.5, 4, '#ff9a5a', 0.4);
      ctx.restore();
    }
    var armL3 = V.pt(2, -15);
    if (ham.z < 0) drawHammer(false);
    if (armL3.z < 0) {
      ctx.save(); ctx.translate(armL3.x * 1.75, -42 + wob - Math.sin(t * 2) * 2);
      ctx.fillStyle = '#a87c58';
      blob(ctx, [5, -6, -4, -8, -7, 2, -4, 12, 3, 10]); ctx.fill(); outline(ctx, 1.9);
      ctx.restore();
    }
    // AVENTAL de couro (é o corpo)
    var apr = function () {
      ctx.beginPath();
      ctx.moveTo(-13, -6 + wob * 0.4);
      ctx.quadraticCurveTo(-15, -26, -12, -42 + wob);
      ctx.lineTo(-6, -50 + wob);
      ctx.lineTo(6, -50 + wob);
      ctx.lineTo(12, -42 + wob);
      ctx.quadraticCurveTo(15, -26, 13, -6 + wob * 0.4);
      ctx.quadraticCurveTo(0, -1 + wob * 0.4, -13, -6 + wob * 0.4);
      ctx.closePath();
    };
    apr();
    ctx.fillStyle = litH(ctx, 14, T5('#75543a'), V.lx); ctx.fill(); outline(ctx, 2.3);
    aoV(ctx, apr, -18, -2, 0.3);
    // FRENTE: costuras + bolso com ferramentas / COSTAS: correias cruzadas + vazio
    if (V.fw > 0.08) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var fx0 = V.sf * 4;
      ctx.strokeStyle = rgba('#2e1e12', 0.8); ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(fx0 - 8, -44 + wob); ctx.lineTo(fx0 + 8, -44 + wob); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx0 - 7, -20); ctx.lineTo(fx0 + 7, -20); ctx.lineTo(fx0 + 7, -10); ctx.lineTo(fx0 - 7, -10); ctx.closePath(); ctx.stroke();
      // tenaz no bolso
      ctx.strokeStyle = '#8a888e'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(fx0 - 3, -20); ctx.lineTo(fx0 - 4, -27); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx0 - 1.4, -20); ctx.lineTo(fx0 - 1, -26); ctx.stroke();
      // respingo de metal na barra
      ctx.fillStyle = rgba('#9a989e', 0.7);
      ell(ctx, fx0 + 5, -14, 1.4, 1); ctx.fill();
      ctx.restore();
    }
    if (V.bk > 0.25) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.25) / 0.75;
      var bx = -V.sf * 4;
      // as costas do avental são ABERTAS: correias sobre calor puro
      ctx.fillStyle = rgba('#1c1210', 0.85);
      poly(ctx, [bx - 9, -42 + wob, bx + 9, -42 + wob, bx + 10, -10, bx - 10, -10]); ctx.fill();
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgrad(ctx, bx, -26, 14, [0, rgba('#ff9a5a', 0.4 + Math.sin(t * 3) * 0.15), 1, rgba('#ff9a5a', 0)]);
      ell(ctx, bx, -26, 10, 16); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = '#442e1e'; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(bx - 8, -42 + wob); ctx.lineTo(bx + 8, -14); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx + 8, -42 + wob); ctx.lineTo(bx - 8, -14); ctx.stroke();
      ctx.fillStyle = '#8a6242'; ell(ctx, bx, -28, 2, 2); ctx.fill();
      ctx.restore();
    }
    // alças subindo para o NADA
    ctx.strokeStyle = '#442e1e'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-6, -50 + wob); ctx.lineTo(-4, -58 + wob); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, -50 + wob); ctx.lineTo(4, -58 + wob); ctx.stroke();
    // brasa fraca onde seria a cabeça
    glowDot(ctx, V.sf * 3, -62 + wob, 10, '#ff9a5a', 0.35 + Math.sin(t * 3) * 0.15);
    // ferramentas penduradas (superfície)
    var s2 = V.surf(1.1, 11);
    if (s2.k > 0.05) {
      ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(s2.x, -34); ctx.lineTo(s2.x, -28); ctx.stroke();
      ctx.fillStyle = '#8a888e'; ell(ctx, s2.x, -27, 1.8, 2.6); ctx.fill();
    }
    if (armL3.z >= 0) {
      ctx.save(); ctx.translate(armL3.x * 1.75, -42 + wob - Math.sin(t * 2) * 2);
      ctx.fillStyle = '#c89a72';
      blob(ctx, [5, -6, -4, -8, -7, 2, -4, 12, 3, 10]); ctx.fill(); outline(ctx, 1.9);
      ctx.restore();
    }
    if (ham.z >= 0) drawHammer(true);
  };

  // MAGNO, O ACENDEDOR (CHEFE ~2.1x): forno-titã; grelha na frente, caldeira atrás
  P['boss-heartforge'] = function (ctx, t, o, V) {
    var sc = 2.1; ctx.save(); ctx.scale(sc, sc);
    var br = Math.sin(t * 1.3);
    var hot = 0.6 + Math.sin(t * 2.8) * 0.2 + br * 0.1;
    var i, s;
    var iron = T5('#4a3a32');
    // martelo-chaminé ao ombro direito (ORBITA com o yaw — leitura de chefe)
    var ham = V.pt(3, 20);
    function drawHammer(near) {
      var hx = ham.x * 1.5;
      ctx.save();
      ctx.translate(hx, -46 - br); ctx.rotate(-0.5 + V.sf * 0.22 + br * 0.03);
      ctx.strokeStyle = '#4a3a28'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(0, -26); ctx.stroke();
      ctx.fillStyle = lgrad(ctx, -10, -40, 10, -24, [0, near ? '#7a6a60' : '#5a4a42', 1, '#241c18']);
      poly(ctx, [-10, -26, 10, -26, 8, -40, -8, -40]); ctx.fill(); outline(ctx, 2.1);
      ctx.fillStyle = '#1c1210'; ell(ctx, 0, -40, 7, 2.4); ctx.fill();
      // boca da chaminé em brasa
      glowDot(ctx, 0, -39, 6, '#ff9a3c', 0.5);
      // fumaça
      for (var j = 0; j < 3; j++) {
        var ph2 = (t * 0.7 + j * 0.33) % 1;
        ctx.fillStyle = rgba('#8a827e', (1 - ph2) * 0.4);
        ell(ctx, Math.sin(t + j * 2) * 3 * ph2, -42 - ph2 * 14, 3 + ph2 * 4, 2.4 + ph2 * 2.6); ctx.fill();
      }
      ctx.restore();
      // braço segurando
      ctx.fillStyle = '#38302e';
      blob(ctx, [hx - 4, -48 - br, hx + 3, -44 - br, hx + 4, -30, hx - 2, -24, hx - 6, -36]);
      ctx.fill(); outline(ctx, 2.1);
    }
    if (ham.z < 0) drawHammer(false);
    // braço esquerdo maciço
    var arm = V.pt(1, -19);
    function drawArm(near) {
      var ax = arm.x * 1.55;
      ctx.fillStyle = near ? '#443a36' : '#2e2624';
      blob(ctx, [ax - 4, -46 - br, ax + 3, -48 - br, ax + 6, -26, ax, -18, ax - 6, -30]);
      ctx.fill(); outline(ctx, 2.1);
      ctx.fillStyle = '#5c4a42'; ell(ctx, ax, -18, 5.5, 5); ctx.fill(); outline(ctx, 1.9);
    }
    if (arm.z < 0) drawArm(false);

    // pernas: colunas de ferro
    var lR = V.pt(0, 14), lL = V.pt(0, -14);
    ctx.fillStyle = '#38302e';
    poly(ctx, [lL.x - 6, 0, lL.x + 6, 0, lL.x + 5.4, -16, lL.x - 5.4, -16]); ctx.fill(); outline(ctx, 2.3);
    poly(ctx, [lR.x - 6, 0, lR.x + 6, 0, lR.x + 5.4, -16, lR.x - 5.4, -16]); ctx.fill(); outline(ctx, 2.3);
    ctx.fillStyle = '#241c1a';
    poly(ctx, [lL.x - 7, 0, lL.x + 7, 0, lL.x + 7, -4, lL.x - 7, -4]); ctx.fill();
    poly(ctx, [lR.x - 7, 0, lR.x + 7, 0, lR.x + 7, -4, lR.x - 7, -4]); ctx.fill();

    // corpo: FORNO maciço
    var bw = 25 * (1 - Math.abs(V.sf) * 0.08);
    var body = function () {
      poly(ctx, [-bw - 1, -14, bw + 1, -14, bw - 3, -52 - br, bw - 9, -58 - br, -bw + 9, -58 - br, -bw + 3, -52 - br]);
    };
    body();
    ctx.fillStyle = litH(ctx, bw, iron, V.lx); ctx.fill(); outline(ctx, 2.7);
    aoV(ctx, body, -30, -12, 0.3);
    // placas rebitadas — rebites na superfície giram
    ctx.strokeStyle = rgba('#14100e', 0.9); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-bw + 2, -32); ctx.lineTo(bw - 2, -32); ctx.stroke();
    for (i = -2; i <= 2; i++) {
      s = V.surf(i * 0.62, bw * 0.9);
      if (s.k < -0.05) continue;
      ctx.strokeStyle = rgba('#14100e', 0.4 + Math.max(s.k, 0) * 0.4);
      ctx.beginPath(); ctx.moveTo(s.x, -58 - br); ctx.lineTo(s.x * 1.05, -14); ctx.stroke();
    }
    for (i = 0; i < 8; i++) {
      s = V.surf(-2.1 + i * 0.6, bw * 0.86);
      if (s.k < 0) continue;
      ctx.fillStyle = rgba('#6a5a50', 0.4 + s.k * 0.5);
      ell(ctx, s.x, -30, 1.1, 1.1); ctx.fill();
      ell(ctx, s.x, -55 - br, 1.1, 1.1); ctx.fill();
    }
    // FRENTE: GRELHA com a primeira chama / COSTAS: caldeira com canos e válvula
    if (V.fw > 0.08) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var gx = V.sf * 7;
      ctx.fillStyle = '#0e0806';
      poly(ctx, [gx - 14, -22, gx + 14, -22, gx + 12, -46 - br, gx - 12, -46 - br]); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.moveTo(gx - 13, -22); ctx.lineTo(gx + 13, -22); ctx.lineTo(gx + 11, -46 - br); ctx.lineTo(gx - 11, -46 - br); ctx.closePath();
      ctx.clip();
      ctx.fillStyle = rgrad(ctx, gx, -26, 24, [0, '#ffe9a0', 0.3, '#ff9a3c', 0.7, '#c4502e', 1, '#40140a']);
      ctx.fillRect(gx - 14, -48, 28, 28);
      for (i = 0; i < 4; i++) {
        var fw2 = Math.sin(t * 5 + i * 1.8) * 2;
        ctx.fillStyle = rgba('#ffcf6a', 0.7);
        blob(ctx, [gx + i * 6 - 9 + fw2 - 2.4, -24, gx + i * 6 - 9 + fw2 - 1, -32 - Math.abs(fw2) * 2, gx + i * 6 - 9 + fw2 + 1.6, -27, gx + i * 6 - 9 + fw2 + 2.4, -23]);
        ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = '#1c1210'; ctx.lineWidth = 2.6;
      for (i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(gx + i * 7, -22); ctx.lineTo(gx + i * 6.4, -46 - br); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(gx - 13, -34 - br * 0.5); ctx.lineTo(gx + 13, -34 - br * 0.5); ctx.stroke();
      glowDot(ctx, gx, -33, 26, '#ff9a3c', hot * 0.55 * V.fw);
      ctx.restore();
    }
    if (V.bk > 0.25) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.25) / 0.75;
      var bx = -V.sf * 7;
      // porta de fornalha trancada
      ctx.fillStyle = '#2e2420';
      poly(ctx, [bx - 10, -24, bx + 10, -24, bx + 9, -42 - br, bx - 9, -42 - br]); ctx.fill();
      ctx.strokeStyle = '#14100e'; ctx.lineWidth = 1.8; ctx.stroke();
      // dobradiças e tranca
      ctx.fillStyle = '#5c4a42';
      poly(ctx, [bx - 9, -38, bx - 5, -38, bx - 5, -35.6, bx - 9, -35.6]); ctx.fill();
      poly(ctx, [bx - 9, -30, bx - 5, -30, bx - 5, -27.6, bx - 9, -27.6]); ctx.fill();
      // válvula-roda
      ctx.strokeStyle = '#6a5a50'; ctx.lineWidth = 1.8;
      ell(ctx, bx + 4, -33, 3.6, 3.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx + 1.4, -33); ctx.lineTo(bx + 6.6, -33); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx + 4, -36.6); ctx.lineTo(bx + 4, -29.4); ctx.stroke();
      // luz vazando pelas frestas da porta
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba('#ff9a3c', hot * 0.5); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(bx - 9, -24.6); ctx.lineTo(bx + 9, -24.6); ctx.stroke();
      ctx.restore();
      // canos de exaustão subindo das costas
      ctx.fillStyle = '#38302e';
      poly(ctx, [bx - 7, -58 - br, bx - 3.4, -58 - br, bx - 3, -66 - br, bx - 7.4, -66 - br]); ctx.fill(); outline(ctx, 1.5);
      poly(ctx, [bx + 3.4, -58 - br, bx + 7, -58 - br, bx + 7.4, -63 - br, bx + 3, -63 - br]); ctx.fill(); outline(ctx, 1.5);
      var phv = (t * 0.9) % 1;
      ctx.fillStyle = rgba('#8a827e', (1 - phv) * 0.4);
      ell(ctx, bx - 5.2, -68 - br - phv * 8, 2 + phv * 2.4, 1.6 + phv * 1.6); ctx.fill();
      ctx.restore();
    }
    // ombros: blocos com correntes (as correntes pendem por azimute)
    ctx.fillStyle = '#44362e';
    blob(ctx, [-bw - 6, -50 - br, -bw + 5, -56 - br, -bw + 7, -46, -bw - 1, -40]); ctx.fill(); outline(ctx, 2.3);
    blob(ctx, [bw - 5, -56 - br, bw + 6, -50 - br, bw + 1, -40, bw - 7, -46]); ctx.fill(); outline(ctx, 2.3);
    for (var c2 = 0; c2 < 2; c2++) {
      s = V.surf(c2 === 0 ? 2.4 : -2.4, bw * 0.95);
      if (s.k < -0.2) continue;
      ctx.strokeStyle = rgba('#5c5a60', 0.6 + Math.max(s.k, 0) * 0.3); ctx.lineWidth = 1.6;
      for (i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(s.x + Math.sin(t * 1.4 + c2) * (i * 0.7), -38 + i * 6, 2, 2.8, 0.2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (arm.z >= 0) drawArm(true);
    // cabeça: capuz de forja com visor
    var hx2 = V.sf * 5, hy3 = -58 - br;
    ctx.fillStyle = litS(ctx, 11, T5('#44362e'), V.lx);
    blob(ctx, [hx2 - 11, hy3, hx2 - 10, hy3 - 12, hx2, hy3 - 15, hx2 + 10, hy3 - 12, hx2 + 11, hy3]);
    ctx.fill(); outline(ctx, 2.3);
    // visor: fenda de luz (frente) / rebite triplo (costas)
    if (V.fw > 0.08) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      ctx.fillStyle = rgba('#ffcf6a', 0.95);
      poly(ctx, [hx2 - 7, hy3 - 8, hx2 + 7, hy3 - 8, hx2 + 6, hy3 - 5.4, hx2 - 6, hy3 - 5.4]); ctx.fill();
      glowDot(ctx, hx2, hy3 - 7, 12, '#ff9a3c', hot * V.fw);
      ctx.restore();
    }
    if (V.bk > 0.35) {
      ctx.save(); ctx.globalAlpha *= (V.bk - 0.35) / 0.65;
      ctx.fillStyle = '#6a5a50';
      for (i = -1; i <= 1; i++) { ell(ctx, hx2 + i * 4, hy3 - 8, 1.1, 1.1); ctx.fill(); }
      ctx.restore();
    }
    rimL(ctx, body, bw, (o && o.tintAccent) || '#ffb347', V.lx, 2, 0.4);
    if (ham.z >= 0) drawHammer(true);
    ctx.restore();
  };

  // Fagulha: faísca com pernas e opinião
  P['spark-whelp'] = function (ctx, t, o, V) {
    var bo = Math.abs(Math.sin(t * 6)) * 4, y = -bo - 8;
    var hot = 0.7 + Math.sin(t * 9) * 0.3;
    var i;
    glowDot(ctx, 0, y - 4, 16, '#ffcf6a', hot * 0.7);
    var lR = V.pt(0, 4), lL = V.pt(0, -4);
    ctx.strokeStyle = '#e8a03c'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(lL.x * 0.8, y + 4); ctx.lineTo(lL.x * 1.3 - Math.sin(t * 8) * 2, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lR.x * 0.8, y + 4); ctx.lineTo(lR.x * 1.3 + Math.sin(t * 8) * 2, 0); ctx.stroke();
    // corpo: estrela irregular
    var pts = [], n = 8;
    for (i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + t * 2.4;
      var r = i % 2 ? 9 + Math.sin(t * 12 + i) * 1.6 : 4.6;
      pts.push(Math.cos(a) * r, y - 4 + Math.sin(a) * r);
    }
    poly(ctx, pts);
    ctx.fillStyle = '#ffcf6a'; ctx.fill();
    ctx.fillStyle = '#fff3d0';
    ell(ctx, V.sf * 1.5, y - 4, 3.4, 3.4); ctx.fill();
    // olhinhos determinados (frente)
    if (V.fw > 0.15) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      var fx0 = V.sf * 2;
      ctx.fillStyle = '#1c100c';
      ell(ctx, fx0 - 1.8, y - 5, 1, 1.3); ctx.fill();
      ell(ctx, fx0 + 1.8, y - 5, 1, 1.3); ctx.fill();
      ctx.strokeStyle = '#1c100c'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(fx0 - 3, y - 6.8); ctx.lineTo(fx0 - 0.8, y - 6.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx0 + 3, y - 6.8); ctx.lineTo(fx0 + 0.8, y - 6.2); ctx.stroke();
      ctx.restore();
    }
    // rastro atrás (oposto ao facing)
    for (i = 0; i < 3; i++) {
      var ph = (t * 2.4 + i * 0.33) % 1;
      ctx.fillStyle = rgba('#ffb060', (1 - ph) * 0.7);
      ell(ctx, -V.sf * (4 + ph * 8), y + 2 + ph * 8, 1.1, 1.1); ctx.fill();
    }
  };

  // Escorinha: caco de escória rastejante
  P['slag-bit'] = function (ctx, t, o, V) {
    var cr = Math.sin(t * 3.2) * 1.4;
    var hot = 0.6 + Math.sin(t * 4.4) * 0.3;
    poly(ctx, [-10, 0, -12 + cr, -8, -4, -14, 5, -12, 11 - cr, -6, 8, 0]);
    ctx.fillStyle = litH(ctx, 11, T5('#4a352c'), V.lx); ctx.fill(); outline(ctx, 1.9);
    // veia de brasa (por azimute)
    var s = V.surf(0.4, 7);
    if (s.k > -0.2) {
      ctx.strokeStyle = rgba('#ff8a3c', (hot + 0.2) * (0.5 + Math.max(s.k, 0) * 0.5)); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(s.x - 3, -4); ctx.lineTo(s.x + 1, -8); ctx.lineTo(s.x + 4, -5); ctx.stroke();
    }
    glowDot(ctx, 0, -6, 10, '#ff7a3c', hot * 0.5);
    if (V.fw > 0.15) {
      ctx.save(); ctx.globalAlpha *= V.fw;
      eyeV(ctx, V.sf * 3 - 3, -8, 1.5, V, '#ffb060');
      eyeV(ctx, V.sf * 3 + 3.4, -7, 1.5, V, '#ffb060');
      ctx.restore();
    }
    // arrasto de calor atrás (oposto ao facing)
    ctx.strokeStyle = rgba('#ff8a3c', 0.25); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-V.sf * 10, -1); ctx.lineTo(-V.sf * 18, -1); ctx.stroke();
  };
})();

// ============================================================================
// PARTE 5 — TILES, PAREDES, PROPS, RETRATOS, ÍCONES
// ============================================================================
(function () {
  var S = JOGO.Sprites, H = S.__helpers;
  var rgba = H.rgba, shade = H.shade, mix = H.mix, lgrad = H.lgrad, rgrad = H.rgrad;
  var outline = H.outline, ell = H.ell, poly = H.poly, srand = H.srand;
  var glowDot = H.glowDot, blob = H.blob;

  function themePalette(theme) {
    var d = (JOGO.DATA && JOGO.DATA.dungeons) || [];
    for (var i = 0; i < d.length; i++) if (d[i].theme === theme || d[i].id === theme) return d[i].palette;
    return { primary: '#5a5a6a', secondary: '#3a3a46', accent: '#d8d0c0', floor1: '#33333d', floor2: '#3a3a46', wall: '#26262e' };
  }
  S.themePalette = themePalette;

  S.tileTop = function (ctx, theme, kind, seed) {
    var pal = themePalette(theme);
    var rnd = srand(seed * 7919 + 13);
    var base = kind === 'floor2' ? pal.floor2 : pal.floor1;
    if (kind === 'deco') base = mix(pal.floor1, pal.primary, 0.22);
    base = mix(base, '#000000', rnd() * 0.07);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 1, 1);
    var i;
    if (theme === 'garden' || theme === 'greenhouse') {
      ctx.strokeStyle = rgba('#1c2c1e', 0.5); ctx.lineWidth = 0.03;
      ctx.strokeRect(0.06, 0.06, 0.88, 0.88);
      for (i = 0; i < 3; i++) {
        ctx.fillStyle = rgba('#5a8f4d', 0.1 + rnd() * 0.12);
        ell(ctx, rnd(), rnd(), 0.12 + rnd() * 0.14, 0.1 + rnd() * 0.1); ctx.fill();
      }
      if (kind === 'deco') {
        ctx.strokeStyle = rgba('#7ab04a', 0.85); ctx.lineWidth = 0.025;
        for (i = 0; i < 5; i++) {
          var gx = 0.2 + rnd() * 0.6, gy = 0.2 + rnd() * 0.6;
          ctx.beginPath(); ctx.moveTo(gx, gy);
          ctx.quadraticCurveTo(gx + 0.04, gy - 0.1, gx + (rnd() - 0.5) * 0.12, gy - 0.16); ctx.stroke();
        }
        ctx.fillStyle = rgba('#ffd76b', 0.5);
        ell(ctx, 0.3 + rnd() * 0.4, 0.3 + rnd() * 0.4, 0.03, 0.03); ctx.fill();
      }
    } else if (theme === 'cistern') {
      ctx.strokeStyle = rgba('#0c161c', 0.6); ctx.lineWidth = 0.03;
      ctx.strokeRect(0.05, 0.05, 0.9, 0.9);
      ctx.fillStyle = rgba('#7ef0d4', 0.04 + rnd() * 0.05);
      ell(ctx, 0.3 + rnd() * 0.4, 0.3 + rnd() * 0.4, 0.3, 0.2); ctx.fill();
      if (kind === 'deco') {
        ctx.fillStyle = rgba('#7ef0d4', 0.13);
        ell(ctx, 0.5, 0.5, 0.3, 0.24); ctx.fill();
        ctx.strokeStyle = rgba('#bffaf0', 0.35); ctx.lineWidth = 0.02;
        ell(ctx, 0.5, 0.5, 0.22 + rnd() * 0.06, 0.17); ctx.stroke();
        ctx.strokeStyle = rgba('#0c161c', 0.5); ctx.lineWidth = 0.018;
        for (i = 0; i < 3; i++) {
          ctx.strokeRect(0.1 + rnd() * 0.7, 0.08 + rnd() * 0.12, 0.12, 0.1);
        }
      }
    } else {
      ctx.strokeStyle = rgba('#0e0806', 0.7); ctx.lineWidth = 0.03;
      ctx.strokeRect(0.05, 0.05, 0.9, 0.9);
      ctx.fillStyle = rgba('#000000', 0.12 + rnd() * 0.1);
      ell(ctx, rnd(), rnd(), 0.16, 0.12); ctx.fill();
      if (kind === 'deco') {
        ctx.fillStyle = rgba('#180a06', 0.9);
        ctx.fillRect(0.12, 0.12, 0.76, 0.76);
        ctx.fillStyle = rgba('#ff7a3c', 0.55 + rnd() * 0.2);
        ctx.fillRect(0.14, 0.14, 0.72, 0.72);
        ctx.fillStyle = rgba('#ffcf6a', 0.5);
        ell(ctx, 0.3 + rnd() * 0.4, 0.3 + rnd() * 0.4, 0.1, 0.08); ctx.fill();
        ctx.strokeStyle = '#241512'; ctx.lineWidth = 0.09;
        for (i = 1; i <= 3; i++) {
          ctx.beginPath(); ctx.moveTo(0.12, 0.12 + i * 0.19); ctx.lineTo(0.88, 0.12 + i * 0.19); ctx.stroke();
        }
        ctx.strokeRect(0.12, 0.12, 0.76, 0.76);
      } else if (rnd() > 0.7) {
        ctx.fillStyle = rgba('#6a5a50', 0.6);
        ell(ctx, 0.15, 0.15, 0.035, 0.035); ctx.fill();
        ell(ctx, 0.85, 0.85, 0.035, 0.035); ctx.fill();
      }
    }
  };

  // face de parede: 'side' | 'top'; brightness vem da LUZ FIXA DO MUNDO
  S.wallFace = function (ctx, theme, face, seed, brightness) {
    var pal = themePalette(theme);
    var rnd = srand(seed * 5077 + face.length * 31);
    var base = pal.wall;
    var b = brightness == null ? 0 : brightness;
    ctx.fillStyle = shade(base, b);
    ctx.fillRect(0, 0, 1, 1);
    var i;
    if (theme === 'garden' || theme === 'greenhouse') {
      if (face === 'top') {
        for (i = 0; i < 6; i++) {
          ctx.fillStyle = rgba(i % 2 ? '#4f7a38' : '#3c5c2c', 0.5 + rnd() * 0.3);
          ell(ctx, rnd(), rnd(), 0.2 + rnd() * 0.15, 0.16 + rnd() * 0.12); ctx.fill();
        }
        ctx.fillStyle = rgba('#ffd76b', 0.5); ell(ctx, rnd(), rnd(), 0.035, 0.035); ctx.fill();
      } else {
        ctx.strokeStyle = rgba(shade('#57452f', b + 0.14), 0.9); ctx.lineWidth = 0.06;
        for (i = 0; i <= 3; i++) {
          ctx.beginPath(); ctx.moveTo(i / 3, 0); ctx.lineTo(i / 3, 1); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(0, 0.33); ctx.lineTo(1, 0.33); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 0.72); ctx.lineTo(1, 0.72); ctx.stroke();
        ctx.strokeStyle = rgba('#4f7a38', 0.75); ctx.lineWidth = 0.035;
        var vx = rnd();
        ctx.beginPath(); ctx.moveTo(vx, 0);
        ctx.quadraticCurveTo(vx + 0.1, 0.3, vx - 0.05, 0.55 + rnd() * 0.3); ctx.stroke();
      }
    } else if (theme === 'cistern') {
      if (face === 'top') {
        ctx.strokeStyle = rgba('#0a1218', 0.55); ctx.lineWidth = 0.03;
        ctx.strokeRect(0.06, 0.06, 0.88, 0.88);
        for (i = 0; i < 3; i++) {
          ctx.fillStyle = rgba('#c8d8dc', 0.08 + rnd() * 0.09);
          ell(ctx, rnd(), rnd(), 0.1 + rnd() * 0.16, 0.07 + rnd() * 0.1); ctx.fill();
        }
        // brilho salino nas arestas para legibilidade
        ctx.strokeStyle = rgba('#7ef0d4', 0.14); ctx.lineWidth = 0.05;
        ctx.strokeRect(0.03, 0.03, 0.94, 0.94);
      } else {
        ctx.strokeStyle = rgba('#0a1218', 0.7); ctx.lineWidth = 0.035;
        ctx.beginPath(); ctx.moveTo(0, 0.5); ctx.lineTo(1, 0.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0.5, 0); ctx.lineTo(0.5, 0.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0.25, 0.5); ctx.lineTo(0.25, 1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0.75, 0.5); ctx.lineTo(0.75, 1); ctx.stroke();
        ctx.fillStyle = rgba('#c8d8dc', 0.28);
        var sx3 = 0.15 + rnd() * 0.6;
        poly(ctx, [sx3, 0, sx3 + 0.12, 0, sx3 + 0.09, 0.3 + rnd() * 0.4, sx3 + 0.04, 0.25 + rnd() * 0.3]);
        ctx.fill();
      }
    } else { // forge — B3: topo em brasa BEM legível em qualquer ângulo
      if (face === 'top') {
        // ferro escuro com centro em brasa forte + aresta clara
        ctx.fillStyle = shade('#241512', b + 0.08);
        ctx.fillRect(0, 0, 1, 1);
        var gg = ctx.createRadialGradient(0.5, 0.5, 0.05, 0.5, 0.5, 0.62);
        gg.addColorStop(0, rgba('#ffcf6a', 0.85));
        gg.addColorStop(0.35, rgba('#ff8a3c', 0.6));
        gg.addColorStop(1, rgba('#c4502e', 0.06));
        ctx.fillStyle = gg;
        ctx.fillRect(0.08, 0.08, 0.84, 0.84);
        // fissuras de brasa cruzando o topo
        ctx.strokeStyle = rgba('#ffcf6a', 0.75); ctx.lineWidth = 0.035;
        ctx.beginPath(); ctx.moveTo(0.16, 0.4 + rnd() * 0.2);
        ctx.lineTo(0.42, 0.5); ctx.lineTo(0.6, 0.32 + rnd() * 0.3); ctx.lineTo(0.86, 0.52); ctx.stroke();
        // moldura de ferro rebitada (aresta sempre legível)
        ctx.strokeStyle = rgba('#0a0605', 0.95); ctx.lineWidth = 0.1;
        ctx.strokeRect(0.05, 0.05, 0.9, 0.9);
        ctx.strokeStyle = rgba('#8a6a50', 0.55); ctx.lineWidth = 0.035;
        ctx.strokeRect(0.11, 0.11, 0.78, 0.78);
        ctx.fillStyle = rgba('#9a7a5a', 0.8);
        ell(ctx, 0.12, 0.12, 0.035, 0.035); ctx.fill();
        ell(ctx, 0.88, 0.12, 0.035, 0.035); ctx.fill();
        ell(ctx, 0.12, 0.88, 0.035, 0.035); ctx.fill();
        ell(ctx, 0.88, 0.88, 0.035, 0.035); ctx.fill();
      } else {
        // blocos de ferro rebitado com mais contraste
        ctx.fillStyle = shade('#2e1a14', b);
        ctx.fillRect(0, 0, 1, 1);
        ctx.strokeStyle = rgba('#0a0605', 0.9); ctx.lineWidth = 0.045;
        ctx.beginPath(); ctx.moveTo(0, 0.5); ctx.lineTo(1, 0.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0.5, 0); ctx.lineTo(0.5, 0.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0.3, 0.5); ctx.lineTo(0.3, 1); ctx.stroke();
        // aresta superior iluminada pela brasa do topo
        ctx.fillStyle = lgrad(ctx, 0, 0, 0, 0.2, [0, rgba('#ff9a4a', 0.5), 1, rgba('#ff9a4a', 0)]);
        ctx.fillRect(0, 0, 1, 0.2);
        ctx.fillStyle = rgba(shade('#7a625a', b), 0.85);
        for (i = 0; i < 4; i++) {
          ell(ctx, 0.12 + (i % 2) * 0.76, 0.14 + Math.floor(i / 2) * 0.72, 0.04, 0.04); ctx.fill();
        }
        // brilho rubro vindo de baixo
        ctx.fillStyle = lgrad(ctx, 0, 1, 0, 0.55, [0, 'rgba(255,122,60,0.32)', 1, 'rgba(255,122,60,0)']);
        ctx.fillRect(0, 0.55, 1, 0.45);
      }
    }
  };

  S.prop = function (ctx, theme, seed, t) {
    var rnd = srand(seed * 2711 + 7);
    var v = rnd();
    if (theme === 'garden' || theme === 'greenhouse') {
      if (v < 0.5) {
        ctx.strokeStyle = rgba('#6b9c48', 0.9); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
        for (var i = -2; i <= 2; i++) {
          ctx.beginPath(); ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(i * 4, -7 - Math.abs(i), i * 6 + Math.sin(t + i) * 1, -11 + Math.abs(i) * 2);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = '#c9a24a'; ell(ctx, 3, -3, 2, 3); ctx.fill();
        ctx.fillStyle = '#8a5fa0'; ell(ctx, 3, -6, 4.4, 2.6); ctx.fill(); outline(ctx, 1);
        var fy = -12 + Math.sin(t * 1.4 + seed) * 3;
        glowDot(ctx, -5 + Math.sin(t * 0.9 + seed * 2) * 4, fy, 5, '#ffd76b', 0.5 + Math.sin(t * 5 + seed) * 0.3);
      }
    } else if (theme === 'cistern') {
      if (v < 0.5) {
        ctx.fillStyle = '#d8e2dc'; ell(ctx, -3, -2, 2.2, 2.2); ctx.fill(); outline(ctx, 0.8);
        ctx.fillStyle = '#c0ccc8'; ell(ctx, 3, -1.4, 1.7, 1.7); ctx.fill(); outline(ctx, 0.8);
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ell(ctx, -3.6, -2.8, 0.6, 0.6); ctx.fill();
      } else {
        ctx.strokeStyle = '#3c5a66'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(0, -8); ctx.stroke();
        ctx.fillStyle = rgba('#d8ecf0', 0.4);
        poly(ctx, [-3.4, -8, 3.4, -8, 2.6, 0, -2.6, 0]); ctx.fill(); outline(ctx, 1);
        ctx.fillStyle = '#ffe9a0'; ell(ctx, 0, -4, 1.4, 1.8); ctx.fill();
        glowDot(ctx, 0, -4, 8, '#7ef0d4', 0.5 + Math.sin(t * 2 + seed) * 0.2);
      }
    } else {
      if (v < 0.5) {
        ctx.fillStyle = '#3c3a40';
        poly(ctx, [-5, 0, 5, 0, 4, -4, 7, -6, 6, -8, -6, -8, -4, -4]); ctx.fill(); outline(ctx, 1.2);
      } else {
        ctx.strokeStyle = '#44424a'; ctx.lineWidth = 1.4;
        for (var j = 0; j < 4; j++) {
          ctx.beginPath(); ctx.ellipse(-6 + j * 4, -2 - (j % 2), 2, 2.6, 0.4 * j, 0, Math.PI * 2); ctx.stroke();
        }
        glowDot(ctx, 2, -3, 4, '#ff7a3c', 0.4 + Math.sin(t * 3 + seed) * 0.2);
      }
    }
  };

  // ---------------- retratos ----------------
  function defPalette(defId) {
    var D = JOGO.DATA || {};
    var i, h = D.heroes || [];
    for (i = 0; i < h.length; i++) {
      if (h[i].id === defId) {
        var r = (D.races || []).filter(function (x) { return x.id === h[i].raceId; })[0];
        return r ? r.palette : null;
      }
    }
    var m = (D.monsters || {})[defId];
    if (m) {
      if (m.family === 'Corte Afogada') return { primary: '#2e6e8e', secondary: '#1d3a4d', accent: '#7ef0d4' };
      if (m.family === 'Prole da Fornalha') return { primary: '#c4502e', secondary: '#4a2a26', accent: '#ffb347' };
      return { primary: '#5a8f4d', secondary: '#33453f', accent: '#ffd76b' };
    }
    return null;
  }
  S.defPalette = defPalette;

  // retrato SEMPRE de frente (yaw 0) — usado por timeline/cards da HUD
  S.portrait = function (ctx, defId, size, opts) {
    opts = opts || {};
    var pal = defPalette(defId) || { primary: '#5a5a6a', secondary: '#3a3a46', accent: '#d8d0c0' };
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    var g = ctx.createLinearGradient(0, 0, size * 0.3, size);
    g.addColorStop(0, shade(pal.primary, -0.25));
    g.addColorStop(1, shade(pal.secondary, -0.45));
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    glowDot(ctx, size * 0.5, size * 0.4, size * 0.55, pal.accent, 0.25);
    var m = (JOGO.DATA && JOGO.DATA.monsters || {})[defId];
    var big = m && m.boss;
    var sc = size / (big ? 150 : 78);
    ctx.translate(size / 2, size * (big ? 1.28 : 1.18));
    ctx.scale(sc, sc);
    S.draw(ctx, defId, { t: opts.t || 0, yaw: 0, lx: -0.62 });
    ctx.restore();
  };

  // ---------------- ícones de feitiço ----------------
  S.spellIcon = function (ctx, spell, size, opts) {
    opts = opts || {};
    var el2 = (spell && spell.element) || 'neutral';
    var col = S.elements[el2] || S.elements.neutral;
    var fx = (spell && spell.fxKey) || 'burst';
    var s = size, c = s / 2;
    ctx.save();
    ctx.clearRect(0, 0, s, s);
    var g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, shade('#1a2026', 0.06));
    g.addColorStop(1, '#0e1216');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    glowDot(ctx, c, c, s * 0.62, col, 0.3);
    ctx.translate(c, c);
    var u = s / 44;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var i;
    switch (fx) {
      case 'slam':
        ctx.fillStyle = col;
        var pts = [];
        for (i = 0; i < 10; i++) {
          var a = (i / 10) * Math.PI * 2 - Math.PI / 2;
          var r = i % 2 ? 5 * u : 13 * u;
          pts.push(Math.cos(a) * r, Math.sin(a) * r);
        }
        poly(ctx, pts); ctx.fill();
        ctx.fillStyle = '#fff'; ell(ctx, 0, 0, 3 * u, 3 * u); ctx.fill();
        break;
      case 'bolt':
        ctx.strokeStyle = rgba(col, 0.5); ctx.lineWidth = 3 * u;
        ctx.beginPath(); ctx.moveTo(-13 * u, 10 * u); ctx.quadraticCurveTo(-2 * u, 2 * u, 8 * u, -7 * u); ctx.stroke();
        ctx.fillStyle = col; ell(ctx, 9 * u, -8 * u, 5 * u, 5 * u); ctx.fill();
        ctx.fillStyle = '#fff'; ell(ctx, 9 * u, -8 * u, 2 * u, 2 * u); ctx.fill();
        break;
      case 'beam':
        ctx.strokeStyle = rgba(col, 0.4); ctx.lineWidth = 7 * u;
        ctx.beginPath(); ctx.moveTo(-13 * u, 9 * u); ctx.lineTo(13 * u, -9 * u); ctx.stroke();
        ctx.strokeStyle = col; ctx.lineWidth = 3 * u;
        ctx.beginPath(); ctx.moveTo(-13 * u, 9 * u); ctx.lineTo(13 * u, -9 * u); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 * u;
        ctx.beginPath(); ctx.moveTo(-13 * u, 9 * u); ctx.lineTo(13 * u, -9 * u); ctx.stroke();
        break;
      case 'burst':
        ctx.strokeStyle = col; ctx.lineWidth = 2.4 * u;
        for (i = 0; i < 8; i++) {
          var a2 = (i / 8) * Math.PI * 2;
          ctx.beginPath(); ctx.moveTo(Math.cos(a2) * 5 * u, Math.sin(a2) * 5 * u);
          ctx.lineTo(Math.cos(a2) * 13 * u, Math.sin(a2) * 13 * u); ctx.stroke();
        }
        ctx.fillStyle = col; ell(ctx, 0, 0, 4 * u, 4 * u); ctx.fill();
        break;
      case 'nova':
        ctx.strokeStyle = rgba(col, 0.9); ctx.lineWidth = 2.4 * u;
        ell(ctx, 0, 0, 5 * u, 5 * u); ctx.stroke();
        ctx.strokeStyle = rgba(col, 0.55); ell(ctx, 0, 0, 9.5 * u, 9.5 * u); ctx.stroke();
        ctx.strokeStyle = rgba(col, 0.3); ell(ctx, 0, 0, 14 * u, 14 * u); ctx.stroke();
        ctx.fillStyle = '#fff'; ell(ctx, 0, 0, 2 * u, 2 * u); ctx.fill();
        break;
      case 'heal':
        ctx.strokeStyle = col; ctx.lineWidth = 5 * u;
        ctx.beginPath(); ctx.moveTo(0, -10 * u); ctx.lineTo(0, 10 * u); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-10 * u, 0); ctx.lineTo(10 * u, 0); ctx.stroke();
        glowDot(ctx, 5 * u, -7 * u, 4 * u, '#ffffff', 0.8);
        break;
      case 'buff':
        ctx.strokeStyle = col; ctx.lineWidth = 3 * u;
        ctx.beginPath(); ctx.moveTo(-8 * u, 10 * u); ctx.quadraticCurveTo(10 * u, 6 * u, 0, -9 * u); ctx.stroke();
        ctx.fillStyle = col;
        poly(ctx, [0, -13 * u, -5 * u, -4 * u, 5 * u, -4 * u]); ctx.fill();
        break;
      case 'debuff':
        ctx.strokeStyle = col; ctx.lineWidth = 3 * u;
        ctx.beginPath(); ctx.moveTo(-8 * u, -10 * u); ctx.quadraticCurveTo(10 * u, -6 * u, 0, 9 * u); ctx.stroke();
        ctx.fillStyle = col;
        poly(ctx, [0, 13 * u, -5 * u, 4 * u, 5 * u, 4 * u]); ctx.fill();
        break;
      case 'shieldFx':
        ctx.fillStyle = rgba(col, 0.3); ctx.strokeStyle = col; ctx.lineWidth = 2.4 * u;
        var hp2 = [];
        for (i = 0; i < 6; i++) {
          var a3 = (i / 6) * Math.PI * 2 - Math.PI / 2;
          hp2.push(Math.cos(a3) * 11 * u, Math.sin(a3) * 12 * u);
        }
        poly(ctx, hp2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.2 * u;
        ctx.beginPath(); ctx.moveTo(-4 * u, -6 * u); ctx.lineTo(-4 * u, 4 * u); ctx.stroke();
        break;
      case 'veil':
        ctx.fillStyle = rgba(col, 0.5);
        ell(ctx, -4 * u, 4 * u, 8 * u, 6 * u); ctx.fill();
        ell(ctx, 5 * u, -1 * u, 7 * u, 5 * u); ctx.fill();
        ell(ctx, -2 * u, -7 * u, 6 * u, 4.4 * u); ctx.fill();
        ctx.fillStyle = rgba('#0e1216', 0.7);
        ell(ctx, 0, 0, 4 * u, 6 * u); ctx.fill();
        break;
      case 'hook':
        ctx.strokeStyle = col; ctx.lineWidth = 3 * u;
        ctx.beginPath(); ctx.moveTo(-12 * u, -9 * u);
        ctx.quadraticCurveTo(6 * u, -7 * u, 8 * u, 4 * u); ctx.stroke();
        ctx.beginPath(); ctx.arc(4.5 * u, 6 * u, 4.5 * u, -0.5, Math.PI * 1.1); ctx.stroke();
        ctx.fillStyle = col;
        poly(ctx, [0, 10 * u, 3 * u, 4 * u, 6 * u, 9 * u]); ctx.fill();
        break;
      case 'gust':
        ctx.strokeStyle = col; ctx.lineWidth = 2.6 * u;
        for (i = -1; i <= 1; i++) {
          ctx.beginPath(); ctx.moveTo(-12 * u, i * 6.4 * u);
          ctx.quadraticCurveTo(4 * u, i * 6.4 * u - 3 * u, 12 * u, i * 6.4 * u);
          ctx.stroke();
        }
        poly(ctx, [13 * u, 0, 6 * u, -4.4 * u, 6 * u, 4.4 * u]);
        ctx.fillStyle = col; ctx.fill();
        break;
      case 'blink':
        ctx.fillStyle = rgba(col, 0.45);
        poly(ctx, [-8 * u, -12 * u, -3 * u, -4 * u, -13 * u, -1 * u]); ctx.fill();
        ctx.fillStyle = col;
        poly(ctx, [8 * u, 12 * u, 3 * u, 4 * u, 13 * u, 1 * u, 6 * u, 0]); ctx.fill();
        ctx.strokeStyle = rgba('#fff', 0.7); ctx.lineWidth = 1.4 * u;
        ctx.beginPath(); ctx.moveTo(-5 * u, -6 * u); ctx.lineTo(5 * u, 6 * u); ctx.stroke();
        break;
      case 'summonFx':
        ctx.strokeStyle = col; ctx.lineWidth = 2 * u;
        ell(ctx, 0, 6 * u, 12 * u, 5 * u); ctx.stroke();
        ctx.fillStyle = col;
        ell(ctx, 0, -2 * u, 6 * u, 8 * u); ctx.fill();
        ctx.fillStyle = '#fff'; ell(ctx, -2 * u, -4 * u, 1.6 * u, 2 * u); ctx.fill();
        break;
      case 'poisonCloud':
        ctx.fillStyle = rgba(col, 0.65);
        ell(ctx, -5 * u, 2 * u, 8 * u, 6 * u); ctx.fill();
        ell(ctx, 6 * u, 0, 7 * u, 5.4 * u); ctx.fill();
        ell(ctx, 0, -6 * u, 6 * u, 5 * u); ctx.fill();
        ctx.strokeStyle = rgba('#fff', 0.5); ctx.lineWidth = 1.2 * u;
        ell(ctx, -3 * u, -2 * u, 2 * u, 2 * u); ctx.stroke();
        ell(ctx, 5 * u, 3 * u, 1.4 * u, 1.4 * u); ctx.stroke();
        break;
      default:
        ctx.fillStyle = col; ell(ctx, 0, 0, 8 * u, 8 * u); ctx.fill();
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = rgba(col, 0.5); ctx.lineWidth = Math.max(1.5, s * 0.03);
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);
    ctx.restore();
  };

  // ---------------- ícones de ITEM (progressão/saque — Adendo v2) ----------
  // Silhueta única por iconKey (guia visual no GDD §8.6) + moldura/brilho por
  // raridade: comum bronze/cinza · raro azul · épico dourado.
  var RAR_C = {
    common: { frame: '#9a8264', glow: '#b8a480', bg0: '#221c14', bg1: '#141009' },
    rare:   { frame: '#54a8e8', glow: '#7ec4f8', bg0: '#142330', bg1: '#0b131b' },
    epic:   { frame: '#ffd166', glow: '#ffe9a8', bg0: '#2b2010', bg1: '#170f06' }
  };
  S.rarityColor = function (rar) { return (RAR_C[rar] || RAR_C.common).frame; };

  var ITEM_PAINTERS = {
    'shears': function (c, u) {        // tesoura de poda fechada
      c.strokeStyle = '#b8bcc0'; c.lineWidth = 3.4 * u;
      c.beginPath(); c.moveTo(-3 * u, 12 * u); c.lineTo(4 * u, -10 * u); c.stroke();
      c.beginPath(); c.moveTo(3 * u, 12 * u); c.lineTo(-4 * u, -10 * u); c.stroke();
      c.fillStyle = '#d8dce0';
      poly(c, [4 * u, -10 * u, 7 * u, -15 * u, 2 * u, -13 * u]); c.fill();
      poly(c, [-4 * u, -10 * u, -7 * u, -15 * u, -2 * u, -13 * u]); c.fill();
      c.strokeStyle = '#4f7a38'; c.lineWidth = 4 * u;    // cabos verdes
      c.beginPath(); c.arc(-4.6 * u, 12 * u, 3.4 * u, -0.6, Math.PI + 0.6); c.stroke();
      c.beginPath(); c.arc(4.6 * u, 12 * u, 3.4 * u, Math.PI - 0.6, 0.6, true); c.stroke();
      c.fillStyle = '#8a8e92'; ell(c, 0, 1 * u, 2 * u, 2 * u); c.fill();
    },
    'vine-whip': function (c, u) {     // chicote em espiral com espinhos
      c.strokeStyle = '#5a8f4d'; c.lineWidth = 3.2 * u;
      c.beginPath();
      for (var i = 0; i <= 40; i++) {
        var a = (i / 40) * Math.PI * 4.4;
        var r = 2 * u + (i / 40) * 11 * u;
        var x = Math.cos(a) * r, y = Math.sin(a) * r * 0.85;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
      c.fillStyle = '#ffd76b';                           // farpas douradas
      for (var j = 0; j < 6; j++) {
        var aj = (j / 6) * Math.PI * 2 + 0.5;
        var rj = 8 * u + (j % 3) * 2.4 * u;
        var xj = Math.cos(aj) * rj, yj = Math.sin(aj) * rj * 0.85;
        poly(c, [xj, yj, xj + 2.6 * u, yj - 1 * u, xj + 1 * u, yj + 2.2 * u]); c.fill();
      }
    },
    'trellis-shield': function (c, u) { // escudo quadrado em grade + hera
      c.fillStyle = '#57452f';
      c.fillRect(-11 * u, -12 * u, 22 * u, 24 * u);
      c.strokeStyle = '#3a2c1c'; c.lineWidth = 2 * u;
      c.strokeRect(-11 * u, -12 * u, 22 * u, 24 * u);
      c.lineWidth = 1.6 * u;
      for (var i = -1; i <= 1; i++) {
        c.beginPath(); c.moveTo(i * 7 * u, -12 * u); c.lineTo(i * 7 * u, 12 * u); c.stroke();
        c.beginPath(); c.moveTo(-11 * u, i * 8 * u); c.lineTo(11 * u, i * 8 * u); c.stroke();
      }
      c.strokeStyle = '#4f7a38'; c.lineWidth = 2 * u;    // hera num canto
      c.beginPath(); c.moveTo(-11 * u, 12 * u);
      c.quadraticCurveTo(-4 * u, 4 * u, -8 * u, -6 * u); c.stroke();
      c.fillStyle = '#6aa050';
      ell(c, -8 * u, -6 * u, 2.2 * u, 1.6 * u); c.fill();
      ell(c, -6 * u, 3 * u, 2 * u, 1.4 * u); c.fill();
    },
    'apron': function (c, u) {         // avental trapezoidal, bolso central
      c.fillStyle = '#8a6b3e';
      poly(c, [-7 * u, -14 * u, 7 * u, -14 * u, 12 * u, 13 * u, -12 * u, 13 * u]); c.fill();
      c.strokeStyle = '#5c4626'; c.lineWidth = 1.6 * u;
      poly(c, [-7 * u, -14 * u, 7 * u, -14 * u, 12 * u, 13 * u, -12 * u, 13 * u]); c.stroke();
      c.strokeStyle = '#c8a86a'; c.lineWidth = 1.4 * u;  // alça
      c.beginPath(); c.moveTo(-6 * u, -14 * u); c.quadraticCurveTo(0, -19 * u, 6 * u, -14 * u); c.stroke();
      c.fillStyle = '#6a5230';                           // bolso
      c.fillRect(-5 * u, -1 * u, 10 * u, 8 * u);
      c.strokeStyle = '#4a3820'; c.strokeRect(-5 * u, -1 * u, 10 * u, 8 * u);
      c.fillStyle = '#6aa050';                           // remendo de folha
      ell(c, 5 * u, -8 * u, 3 * u, 2 * u); c.fill();
    },
    'firefly-jar': function (c, u) {   // redoma com 3 vagalumes
      c.fillStyle = rgba('#a8c8e0', 0.25);
      c.beginPath(); c.arc(0, 1 * u, 11 * u, Math.PI, 0); c.lineTo(11 * u, 10 * u); c.lineTo(-11 * u, 10 * u); c.closePath(); c.fill();
      c.strokeStyle = rgba('#c8e0f0', 0.7); c.lineWidth = 1.6 * u;
      c.beginPath(); c.arc(0, 1 * u, 11 * u, Math.PI, 0); c.lineTo(11 * u, 10 * u); c.lineTo(-11 * u, 10 * u); c.closePath(); c.stroke();
      c.fillStyle = '#57452f'; c.fillRect(-12 * u, 10 * u, 24 * u, 4 * u);
      glowDot(c, -4 * u, -2 * u, 4 * u, '#ffd76b', 0.9);
      glowDot(c, 4 * u, 3 * u, 3.4 * u, '#ffd76b', 0.8);
      glowDot(c, 1 * u, -6 * u, 2.8 * u, '#ffd76b', 0.7);
    },
    'amber': function (c, u) {         // gota facetada com bolha
      var g = lgrad(c, 0, -14 * u, 0, 14 * u, [0, '#ffe9a8', 0.5, '#ffd76b', 1, '#c89a3a']);
      c.fillStyle = g;
      poly(c, [0, -14 * u, 8 * u, -3 * u, 10 * u, 6 * u, 0, 13 * u, -10 * u, 6 * u, -8 * u, -3 * u]); c.fill();
      c.strokeStyle = rgba('#8a6a20', 0.8); c.lineWidth = 1.4 * u;
      poly(c, [0, -14 * u, 8 * u, -3 * u, 10 * u, 6 * u, 0, 13 * u, -10 * u, 6 * u, -8 * u, -3 * u]); c.stroke();
      c.strokeStyle = rgba('#fff8dc', 0.6); c.lineWidth = 1 * u;
      c.beginPath(); c.moveTo(0, -14 * u); c.lineTo(-3 * u, 4 * u); c.stroke();
      c.strokeStyle = rgba('#8a6a20', 0.7);
      ell(c, 2 * u, 4 * u, 2.6 * u, 2 * u); c.stroke();  // bolha interna
    },
    'great-shears': function (c, u) {  // tesourão aberto em X, ferrugem
      c.strokeStyle = '#a8acb0'; c.lineWidth = 4.2 * u;
      c.beginPath(); c.moveTo(-12 * u, -13 * u); c.lineTo(9 * u, 10 * u); c.stroke();
      c.beginPath(); c.moveTo(12 * u, -13 * u); c.lineTo(-9 * u, 10 * u); c.stroke();
      c.strokeStyle = rgba('#a05a2c', 0.75); c.lineWidth = 1.8 * u; // ferrugem
      c.beginPath(); c.moveTo(-9 * u, -10 * u); c.lineTo(-2 * u, -2 * u); c.stroke();
      c.beginPath(); c.moveTo(9 * u, -10 * u); c.lineTo(4 * u, -4 * u); c.stroke();
      c.strokeStyle = '#6a4a28'; c.lineWidth = 4.6 * u;  // cabos
      c.beginPath(); c.moveTo(9 * u, 10 * u); c.lineTo(13 * u, 15 * u); c.stroke();
      c.beginPath(); c.moveTo(-9 * u, 10 * u); c.lineTo(-13 * u, 15 * u); c.stroke();
      c.fillStyle = '#e8ecf0'; ell(c, 0, -1.5 * u, 2.6 * u, 2.6 * u); c.fill();
      glowDot(c, 0, -2 * u, 10 * u, '#ffd166', 0.35);
    },
    'rapier': function (c, u) {        // florete de sal
      c.strokeStyle = '#e8f0ee'; c.lineWidth = 2.2 * u;
      c.beginPath(); c.moveTo(10 * u, -14 * u); c.lineTo(-6 * u, 6 * u); c.stroke();
      c.strokeStyle = rgba('#7ef0d4', 0.65); c.lineWidth = 0.9 * u; // reflexo
      c.beginPath(); c.moveTo(9 * u, -12 * u); c.lineTo(-4 * u, 4 * u); c.stroke();
      c.strokeStyle = '#c8d8d4'; c.lineWidth = 2 * u;    // copo circular
      ell(c, -6.6 * u, 6.8 * u, 4.4 * u, 4.4 * u); c.stroke();
      c.strokeStyle = '#a8b8b4'; c.lineWidth = 2.6 * u;  // punho
      c.beginPath(); c.moveTo(-8 * u, 8.4 * u); c.lineTo(-12 * u, 13 * u); c.stroke();
    },
    'flute': function (c, u) {         // crânio-flauta com 3 furos
      c.fillStyle = '#e0d8c4';
      blob(c, [-14 * u, 2 * u, -10 * u, -4 * u, 2 * u, -5.5 * u, 13 * u, -3 * u, 15 * u, 2 * u, 8 * u, 5.5 * u, -6 * u, 6 * u]);
      c.fill();
      c.strokeStyle = '#8a8270'; c.lineWidth = 1.2 * u;
      blob(c, [-14 * u, 2 * u, -10 * u, -4 * u, 2 * u, -5.5 * u, 13 * u, -3 * u, 15 * u, 2 * u, 8 * u, 5.5 * u, -6 * u, 6 * u]);
      c.stroke();
      c.fillStyle = '#26201a';                           // órbita
      ell(c, 11 * u, -0.5 * u, 2.4 * u, 2.8 * u); c.fill();
      for (var i = 0; i < 3; i++) {                      // furos de flauta
        c.fillStyle = '#3a3226';
        ell(c, (-8 + i * 5) * u, 0.5 * u, 1.5 * u, 1.5 * u); c.fill();
      }
    },
    'coat': function (c, u) {          // casaca de gola alta escorrendo
      c.fillStyle = '#2e6e8e';
      poly(c, [-8 * u, -13 * u, 8 * u, -13 * u, 11 * u, 12 * u, 4 * u, 10 * u, 0, 13 * u, -4 * u, 10 * u, -11 * u, 12 * u]); c.fill();
      c.strokeStyle = '#1d4a60'; c.lineWidth = 1.6 * u;
      poly(c, [-8 * u, -13 * u, 8 * u, -13 * u, 11 * u, 12 * u, 4 * u, 10 * u, 0, 13 * u, -4 * u, 10 * u, -11 * u, 12 * u]); c.stroke();
      c.fillStyle = '#1d3a4d';                           // gola alta
      poly(c, [-8 * u, -13 * u, -4 * u, -16 * u, 0, -12 * u, 4 * u, -16 * u, 8 * u, -13 * u]); c.fill();
      c.strokeStyle = '#16303f'; c.lineWidth = 1.2 * u;  // botões
      c.beginPath(); c.moveTo(0, -11 * u); c.lineTo(0, 10 * u); c.stroke();
      c.fillStyle = rgba('#7ef0d4', 0.8);                // gotas escorrendo
      ell(c, -6 * u, 14 * u, 1 * u, 2 * u); c.fill();
      ell(c, 7 * u, 14.6 * u, 0.9 * u, 1.8 * u); c.fill();
    },
    'salt-plate': function (c, u) {    // peitoral de placas de cristal
      c.fillStyle = '#e8f0ee';
      poly(c, [-10 * u, -12 * u, 10 * u, -12 * u, 13 * u, 0, 8 * u, 13 * u, -8 * u, 13 * u, -13 * u, 0]); c.fill();
      c.strokeStyle = '#a8b8b4'; c.lineWidth = 1.4 * u;
      poly(c, [-10 * u, -12 * u, 10 * u, -12 * u, 13 * u, 0, 8 * u, 13 * u, -8 * u, 13 * u, -13 * u, 0]); c.stroke();
      c.strokeStyle = rgba('#7ef0d4', 0.85); c.lineWidth = 1.3 * u; // arestas
      c.beginPath(); c.moveTo(-13 * u, 0); c.lineTo(0, -4 * u); c.lineTo(13 * u, 0); c.stroke();
      c.beginPath(); c.moveTo(0, -12 * u); c.lineTo(0, -4 * u); c.lineTo(-3 * u, 13 * u); c.stroke();
      c.beginPath(); c.moveTo(0, -4 * u); c.lineTo(4 * u, 13 * u); c.stroke();
    },
    'oil-lantern': function (c, u) {   // lampião com chama afogada
      c.strokeStyle = '#3a3a42'; c.lineWidth = 1.8 * u;  // alça
      c.beginPath(); c.arc(0, -9 * u, 5 * u, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
      c.fillStyle = '#2a2a32';                           // corpo
      c.fillRect(-7 * u, -6 * u, 14 * u, 16 * u);
      c.strokeStyle = '#16161c'; c.strokeRect(-7 * u, -6 * u, 14 * u, 16 * u);
      c.fillStyle = rgba('#0c1418', 0.9);                // vidro
      c.fillRect(-4.6 * u, -3.6 * u, 9.2 * u, 11 * u);
      glowDot(c, 0, 1.6 * u, 6.5 * u, '#7ef0d4', 0.9);   // chama
      c.fillStyle = '#d8fff4';
      poly(c, [0, -2.4 * u, 2 * u, 2.6 * u, 0, 4.6 * u, -2 * u, 2.6 * u]); c.fill();
      c.fillStyle = '#2a2a32'; c.fillRect(-8 * u, 10 * u, 16 * u, 3 * u);
    },
    'tide-flask': function (c, u) {    // frasco bojudo, água inclinada
      c.fillStyle = rgba('#c8dce4', 0.3);
      c.beginPath(); c.arc(0, 4 * u, 10 * u, 0, Math.PI * 2); c.fill();
      c.fillRect(-3 * u, -12 * u, 6 * u, 8 * u);
      c.save();                                          // água inclinada
      c.beginPath(); c.arc(0, 4 * u, 9 * u, 0, Math.PI * 2); c.clip();
      c.fillStyle = rgba('#2e6e8e', 0.85);
      poly(c, [-10 * u, 3 * u, 10 * u, 7 * u, 10 * u, 14 * u, -10 * u, 14 * u]); c.fill();
      c.strokeStyle = rgba('#7ef0d4', 0.8); c.lineWidth = 1.2 * u;
      c.beginPath(); c.moveTo(-10 * u, 3 * u); c.lineTo(10 * u, 7 * u); c.stroke();
      c.restore();
      c.strokeStyle = rgba('#e8f4f8', 0.75); c.lineWidth = 1.5 * u;
      c.beginPath(); c.arc(0, 4 * u, 10 * u, 0, Math.PI * 2); c.stroke();
      c.strokeRect(-3 * u, -12 * u, 6 * u, 8 * u);
      c.fillStyle = '#8a6b3e'; c.fillRect(-4 * u, -15 * u, 8 * u, 3.4 * u); // rolha
    },
    'pearl': function (c, u) {         // colar: arco de 5 pérolas
      c.strokeStyle = rgba('#c8d8dc', 0.6); c.lineWidth = 1.2 * u;
      c.beginPath(); c.arc(0, -6 * u, 12.5 * u, Math.PI * 0.15, Math.PI * 0.85); c.stroke();
      for (var i = 0; i < 5; i++) {
        var a = Math.PI * (0.2 + i * 0.15);
        var x = Math.cos(a) * 12.5 * u, y = -6 * u + Math.sin(a) * 12.5 * u;
        var r = (i === 2 ? 4.6 : 3.2) * u;
        var g = rgrad(c, x - r * 0.3, y - r * 0.3, r * 1.8, [0, '#ffffff', 0.5, '#e8dce8', 1, '#a898b0']);
        c.fillStyle = g; ell(c, x, y, r, r); c.fill();
        c.fillStyle = rgba('#ffffff', 0.9); ell(c, x - r * 0.32, y - r * 0.35, r * 0.28, r * 0.22); c.fill();
      }
      glowDot(c, 0, 6 * u, 9 * u, '#ffd166', 0.3);
    },
    'anvil-hammer': function (c, u) {  // martelo de forja
      c.strokeStyle = '#c8a86a'; c.lineWidth = 3 * u;    // cabo claro
      c.beginPath(); c.moveTo(-9 * u, 13 * u); c.lineTo(6 * u, -6 * u); c.stroke();
      c.fillStyle = '#3a3a42';                           // cabeça quadrada
      c.save(); c.translate(7 * u, -8 * u); c.rotate(0.35);
      c.fillRect(-8 * u, -5 * u, 16 * u, 10 * u);
      c.strokeStyle = '#1c1c22'; c.lineWidth = 1.4 * u;
      c.strokeRect(-8 * u, -5 * u, 16 * u, 10 * u);
      c.fillStyle = '#55555e'; c.fillRect(-8 * u, -5 * u, 16 * u, 3 * u);
      c.restore();
    },
    'slag-saber': function (c, u) {    // sabre curvo de escória
      c.fillStyle = '#22181a';
      c.beginPath();
      c.moveTo(-10 * u, 12 * u);
      c.quadraticCurveTo(2 * u, -2 * u, 9 * u, -13 * u);
      c.lineTo(12 * u, -10 * u);
      c.quadraticCurveTo(8 * u, -2 * u, 3 * u, 4 * u);   // gume irregular
      c.lineTo(1 * u, 3 * u); c.lineTo(0, 7 * u); c.lineTo(-3 * u, 6 * u);
      c.lineTo(-7 * u, 13 * u);
      c.closePath(); c.fill();
      c.strokeStyle = rgba('#ffb347', 0.9); c.lineWidth = 1.2 * u; // veios
      c.beginPath(); c.moveTo(-7 * u, 10 * u); c.quadraticCurveTo(2 * u, -2 * u, 8 * u, -11 * u); c.stroke();
      c.beginPath(); c.moveTo(-2 * u, 4 * u); c.lineTo(1 * u, 1 * u); c.stroke();
      c.strokeStyle = '#4a3a28'; c.lineWidth = 3.2 * u;  // punho
      c.beginPath(); c.moveTo(-9 * u, 12 * u); c.lineTo(-13 * u, 15 * u); c.stroke();
    },
    'riveted-plate': function (c, u) { // placa com 4 rebites
      c.fillStyle = '#241512';
      c.fillRect(-11 * u, -12 * u, 22 * u, 24 * u);
      c.strokeStyle = '#0f0806'; c.lineWidth = 1.8 * u;
      c.strokeRect(-11 * u, -12 * u, 22 * u, 24 * u);
      c.strokeStyle = rgba('#55352a', 0.9); c.lineWidth = 1.2 * u;
      c.beginPath(); c.moveTo(-11 * u, 0); c.lineTo(11 * u, 0); c.stroke();
      c.fillStyle = '#c8b8a0';
      var rp = [[-7, -8], [7, -8], [-7, 8], [7, 8]];
      for (var i = 0; i < 4; i++) { ell(c, rp[i][0] * u, rp[i][1] * u, 1.8 * u, 1.8 * u); c.fill(); }
    },
    'soot-cloak': function (c, u) {    // manto esfarelando em partículas
      c.fillStyle = '#3c3a3e';
      poly(c, [0, -15 * u, 9 * u, -9 * u, 11 * u, 6 * u, 7 * u, 5 * u, 8 * u, 10 * u, 3 * u, 8 * u, 2 * u, 12 * u, -4 * u, 9 * u, -8 * u, 11 * u, -10 * u, 5 * u, -9 * u, -9 * u]);
      c.fill();
      c.fillStyle = '#26242a';                           // capuz
      c.beginPath(); c.arc(0, -9 * u, 6.4 * u, Math.PI * 0.9, Math.PI * 2.1); c.closePath(); c.fill();
      glowDot(c, -1.8 * u, -9 * u, 1.6 * u, '#ff7a3c', 0.75);   // olhos de brasa
      glowDot(c, 1.8 * u, -9 * u, 1.6 * u, '#ff7a3c', 0.75);
      c.fillStyle = rgba('#55525a', 0.9);                // esfarelando
      ell(c, -7 * u, 13.6 * u, 1.2 * u, 1.2 * u); c.fill();
      ell(c, 1 * u, 14.8 * u, 1 * u, 1 * u); c.fill();
      ell(c, 8 * u, 13 * u, 1.3 * u, 1.3 * u); c.fill();
    },
    'valve': function (c, u) {         // válvula de latão com alavanca
      c.strokeStyle = '#c8a04a'; c.lineWidth = 3 * u;
      ell(c, 0, 1 * u, 10 * u, 10 * u); c.stroke();
      c.lineWidth = 2 * u;
      for (var i = 0; i < 4; i++) {
        var a = (i / 4) * Math.PI * 2 + 0.4;
        c.beginPath(); c.moveTo(Math.cos(a) * 3 * u, 1 * u + Math.sin(a) * 3 * u);
        c.lineTo(Math.cos(a) * 9.6 * u, 1 * u + Math.sin(a) * 9.6 * u); c.stroke();
      }
      c.fillStyle = '#e0bc6a'; ell(c, 0, 1 * u, 3 * u, 3 * u); c.fill();
      c.strokeStyle = '#8a6a2a'; c.lineWidth = 2.6 * u;  // alavanca
      c.beginPath(); c.moveTo(7 * u, -6 * u); c.lineTo(14 * u, -13 * u); c.stroke();
      c.fillStyle = rgba('#ffffff', 0.55);               // sopro
      ell(c, -12 * u, -10 * u, 2.2 * u, 1.3 * u); c.fill();
      ell(c, -15 * u, -12.6 * u, 1.4 * u, 0.9 * u); c.fill();
    },
    'ember': function (c, u) {         // carvão facetado com fissuras acesas
      c.fillStyle = '#1c1414';
      poly(c, [-4 * u, -13 * u, 8 * u, -9 * u, 13 * u, 1 * u, 7 * u, 12 * u, -7 * u, 13 * u, -13 * u, 3 * u, -11 * u, -7 * u]);
      c.fill();
      c.strokeStyle = rgba('#ffb347', 0.95); c.lineWidth = 1.5 * u;
      c.beginPath(); c.moveTo(-9 * u, -2 * u); c.lineTo(-1 * u, 1 * u); c.lineTo(3 * u, -6 * u); c.stroke();
      c.beginPath(); c.moveTo(-1 * u, 1 * u); c.lineTo(2 * u, 9 * u); c.stroke();
      c.beginPath(); c.moveTo(3 * u, -6 * u); c.lineTo(9 * u, -1 * u); c.stroke();
      glowDot(c, 0, 0, 12 * u, '#ff8a3c', 0.4);
    },
    'furnace-grate': function (c, u) { // peitoral-grelha com brasa atrás
      c.fillStyle = '#2a2024';
      poly(c, [-11 * u, -12 * u, 11 * u, -12 * u, 13 * u, 2 * u, 8 * u, 13 * u, -8 * u, 13 * u, -13 * u, 2 * u]); c.fill();
      glowDot(c, 0, 0, 10 * u, '#c4502e', 0.85);         // luz interna
      c.fillStyle = rgba('#ff7a3c', 0.85);
      c.fillRect(-7 * u, -8 * u, 14 * u, 16 * u);
      c.fillStyle = '#241a1e';                           // 3 barras
      for (var i = 0; i < 3; i++) c.fillRect(-7 * u, (-6 + i * 5.6) * u, 14 * u, 3 * u);
      c.strokeStyle = '#0f0a0c'; c.lineWidth = 1.8 * u;
      poly(c, [-11 * u, -12 * u, 11 * u, -12 * u, 13 * u, 2 * u, 8 * u, 13 * u, -8 * u, 13 * u, -13 * u, 2 * u]); c.stroke();
    }
  };

  function drawItemIcon(ctx, itemId, s) {
    var item = (JOGO.DATA && JOGO.DATA.items && JOGO.DATA.items[itemId]) || null;
    var rarity = (item && item.rarity) || 'common';
    var rc = RAR_C[rarity] || RAR_C.common;
    var key = (item && item.iconKey) || 'shears';
    ctx.save();
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = lgrad(ctx, 0, 0, 0, s, [0, rc.bg0, 1, rc.bg1]);
    ctx.fillRect(0, 0, s, s);
    // brilho por raridade atrás da silhueta
    glowDot(ctx, s / 2, s / 2, s * 0.6, rc.glow,
      rarity === 'epic' ? 0.42 : rarity === 'rare' ? 0.26 : 0.14);
    ctx.translate(s / 2, s / 2);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var u = s / 44;
    (ITEM_PAINTERS[key] || ITEM_PAINTERS.shears)(ctx, u);
    ctx.restore();
    // moldura por raridade (épico ganha moldura dupla + cantos)
    ctx.save();
    var lw = Math.max(1.6, s * 0.045);
    ctx.strokeStyle = rc.frame; ctx.lineWidth = lw;
    ctx.strokeRect(lw / 2, lw / 2, s - lw, s - lw);
    if (rarity === 'epic') {
      ctx.strokeStyle = rgba('#fff3d0', 0.55); ctx.lineWidth = 1;
      ctx.strokeRect(lw + 1, lw + 1, s - lw * 2 - 2, s - lw * 2 - 2);
      ctx.fillStyle = '#ffe9a8';
      var cn = Math.max(3, s * 0.1);
      poly(ctx, [0, 0, cn, 0, 0, cn]); ctx.fill();
      poly(ctx, [s, 0, s - cn, 0, s, cn]); ctx.fill();
      poly(ctx, [0, s, cn, s, 0, s - cn]); ctx.fill();
      poly(ctx, [s, s, s - cn, s, s, s - cn]); ctx.fill();
    } else if (rarity === 'rare') {
      ctx.strokeStyle = rgba('#bfe2ff', 0.35); ctx.lineWidth = 1;
      ctx.strokeRect(lw + 1, lw + 1, s - lw * 2 - 2, s - lw * 2 - 2);
    }
    ctx.restore();
  }

  // Sprites.itemIcon(ctx, itemId, size) desenha no contexto dado;
  // Sprites.itemIcon(itemId[, size]) devolve um <canvas> pronto (2x DPI).
  S.itemIcon = function (a, b, c) {
    if (a && typeof a.getImageData === 'function') {
      drawItemIcon(a, b, c || 44);
      return null;
    }
    var size = b || 44;
    var cv = document.createElement('canvas');
    cv.width = cv.height = size * 2;
    cv.style.width = size + 'px'; cv.style.height = size + 'px';
    var g = cv.getContext('2d');
    g.scale(2, 2);
    drawItemIcon(g, a, size);
    return cv;
  };
})();

// ============================================================================
// PARTE 6 — DIREÇÕES DISCRETAS estilo Dofus/Wakfu (cache por personagem×vista)
//
// Cada personagem tem 2 vistas DESENHADAS (3/4 frontal e 3/4 traseira, em yaws
// canônicos FIXOS), espelhadas horizontalmente → 4 direções aparentes
// (SE/SW/NE/NW). Cada vista é assada UMA única vez num canvas offscreen (pose
// fixa, luz fixa) — nada de morphing pela câmera. O idle anima por TRANSFORM
// (bob/sway/respiração) e por partículas/brilhos desenhados SOBRE o cache.
//
//   Sprites.drawDir(ctx, defId, dir, o)    dir: 0=SE 1=SW 2=NE 3=NW
//       o: { t, alpha, flash, casting, lightX, overlay }
//   Sprites.dirFromYaw(yaw) / Sprites.dirStep(yaw, dirAtual)   (com histerese)
//   Sprites.idleSpec(defId) -> { amp, speed, sway, breath }
//   Sprites.setAccent(hex) · Sprites.prewarmViews(ids) · Sprites.clearViewCache()
// ============================================================================
(function () {
  var S = JOGO.Sprites, H = S.__helpers;
  var rgba = H.rgba, ell = H.ell, blob = H.blob, glowDot = H.glowDot;
  var litS = H.litS, T5 = H.T5;

  var BS = 2.2;                       // resolução do cache (aguenta zoom alto)
  var YAW_F = 0.55;                   // vista 3/4 frontal
  var YAW_B = Math.PI - 0.55;         // vista 3/4 traseira
  var T0 = 0;                         // pose canônica (fases de idle neutras)
  var HPI = Math.PI / 2;

  function isBoss(defId) {
    var m = JOGO.DATA && JOGO.DATA.monsters && JOGO.DATA.monsters[defId];
    return !!(m && m.boss);
  }

  var accentCur = '#ffd98a';
  var viewCache = {}, silCache = {};
  S.setAccent = function (hex) {
    if (hex && hex !== accentCur) { accentCur = hex; viewCache = {}; silCache = {}; }
  };
  S.clearViewCache = function () { viewCache = {}; silCache = {}; };

  function fallbackV(ctx, t, o, V) {
    var tt = T5('#7a7086');
    blob(ctx, [-14, -4, -16, -30, 0, -44, 16, -30, 14, -4]);
    ctx.fillStyle = litS(ctx, 16, tt, V.lx); ctx.fill();
    H.outline(ctx);
  }

  // assa a vista canônica num offscreen — pose fixa, olhos abertos, luz fixa
  function getView(defId, view) {
    var key = defId + '|' + view + '|' + accentCur;
    var e = viewCache[key];
    if (e) return e;
    var boss = isBoss(defId);
    var x0 = boss ? -122 : -68, x1 = boss ? 122 : 68;
    var y0 = boss ? -242 : -126, y1 = boss ? 34 : 30;
    var cw = Math.ceil((x1 - x0) * BS), ch = Math.ceil((y1 - y0) * BS);
    var cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    var g = cv.getContext('2d');
    g.scale(BS, BS);
    g.translate(-x0, -y0);
    var yaw = view === 1 ? YAW_B : YAW_F;
    var o = { t: T0, yaw: yaw, lx: -0.62, tintAccent: accentCur };
    var V = H.makeView(o, T0, defId);
    V.blink = 1;                      // vista canônica nunca pisca
    var painter = H.P[defId] || fallbackV;
    try { painter(g, T0, o, V); } catch (err) { /* vista vazia > crash */ }
    e = { img: cv, w: cw, h: ch, x0: x0, y0: y0 };
    viewCache[key] = e;
    return e;
  }

  // silhueta tingida com a cor de destaque — usada como rim light dinâmico
  function getSil(defId, view) {
    var key = defId + '|' + view + '|' + accentCur;
    var s = silCache[key];
    if (s) return s;
    var e = getView(defId, view);
    s = document.createElement('canvas');
    s.width = e.w; s.height = e.h;
    var g = s.getContext('2d');
    g.drawImage(e.img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = accentCur;
    g.fillRect(0, 0, e.w, e.h);
    silCache[key] = s;
    return s;
  }

  S.prewarmViews = function (ids) {
    if (!ids) return;
    for (var i = 0; i < ids.length; i++) {
      getView(ids[i], 0); getView(ids[i], 1);
      getSil(ids[i], 0); getSil(ids[i], 1);
    }
  };

  // dir 0=SE (frente-dir) · 1=SW (frente-esq, espelho) · 2=NE (costas-dir) ·
  // 3=NW (costas-esq, espelho). yaw aparente: 0 = de frente para a câmera.
  S.DIR_LABELS = ['SE · frente', 'SW · frente', 'NE · costas', 'NW · costas'];
  S.dirFromYaw = function (yaw) {
    if (yaw >= 0 && yaw < HPI) return 0;
    if (yaw < 0 && yaw >= -HPI) return 1;
    if (yaw >= HPI) return 2;
    return 3;
  };
  var SECT = { 0: [0, HPI], 1: [-HPI, 0], 2: [HPI, Math.PI], 3: [-Math.PI, -HPI] };
  var HYST = 0.1;
  S.dirStep = function (yaw, cur) {
    var raw = S.dirFromYaw(yaw);
    if (cur == null || raw === cur) return raw;
    var a = SECT[cur][0] - HYST, b = SECT[cur][1] + HYST;
    if (yaw >= a && yaw <= b) return cur;
    // wrap em ±PI (setores 2 e 3 são vizinhos pelas costas)
    if (cur === 2 && yaw <= -Math.PI + HYST) return cur;
    if (cur === 3 && yaw >= Math.PI - HYST) return cur;
    return raw;
  };

  var FLOATY = {
    'lantern-jelly': 1, 'lantern-wasp': 1, 'ash-wraith': 1,
    'spark-whelp': 1, 'hero-morel': 1
  };
  S.idleSpec = function (defId) {
    if (isBoss(defId)) return { amp: 1.0, speed: 1.15, sway: 0.007, breath: 0.010 };
    if (FLOATY[defId]) return { amp: 3.2, speed: 1.5, sway: 0.02, breath: 0.008 };
    return { amp: 1.5, speed: 1.8, sway: 0.013, breath: 0.015 };
  };

  // ------- vida SOBRE o cache: só partículas e brilhos, nunca a forma -------
  var OV = {};
  OV['hero-toll'] = function (ctx, t, view) {
    if (view === 0) glowDot(ctx, 3.3, -27.5, 7, '#ffd98a', 0.22 + Math.sin(t * 2.1) * 0.1);
  };
  OV['hero-wick'] = function (ctx, t) {
    var fl = Math.sin(t * 9) * 1.6 + Math.sin(t * 23) * 0.8;
    var fx = fl * 0.5 - 1.0, fy = -64.5;
    ctx.fillStyle = '#ff8c3a';
    blob(ctx, [fx - 3.6, fy, fx - 2.2, fy - 6.5 - fl, fx + fl * 0.8, fy - 12 - fl, fx + 2.8, fy - 6, fx + 3.6, fy]);
    ctx.fill();
    ctx.fillStyle = '#ffe9b0';
    blob(ctx, [fx - 1.8, fy - 1, fx - 1.1, fy - 5, fx + fl * 0.4, fy - 7.4, fx + 1.8, fy - 4.2, fx + 1.8, fy - 1]);
    ctx.fill();
    glowDot(ctx, fx, fy - 5, 16, '#ff8c3a', 0.55);
  };
  OV['hero-morel'] = function (ctx, t, view) {
    var pu = (Math.sin(t * 2.6) + 1) / 2;
    if (view === 0) {
      glowDot(ctx, -0.9, -29, 4.5, '#6fe0c8', 0.28 + pu * 0.3);
      glowDot(ctx, 7.1, -29, 4.5, '#6fe0c8', 0.28 + pu * 0.3);
    }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 5; i++) {
      var a = t * 0.7 + i * 1.25;
      var deep = Math.cos(a);
      ctx.fillStyle = rgba('#6fe0c8', (0.2 + pu * 0.25) * (0.55 + Math.max(deep, -0.4) * 0.45));
      ell(ctx, Math.sin(a) * (21 + Math.sin(t + i * 2) * 4), -40 + Math.sin(a * 1.3) * 13, 1.5, 1.5);
      ctx.fill();
    }
    ctx.restore();
  };
  OV['hero-rose'] = function (ctx, t, view) {
    var pu = (Math.sin(t * 2.2) + 1) / 2;
    if (view === 0) glowDot(ctx, 2.6, -30, 12 + pu * 4, '#ffd166', 0.5);
    glowDot(ctx, 1.05, -57, 8 + pu * 3, '#ffd166', 0.26 + (view === 0 ? 0.18 : 0.06));
  };
  OV['hero-whistle'] = function (ctx, t, view) {
    if (view !== 0) return;
    var ph = (t * 1.1) % 1;
    ctx.fillStyle = rgba('#eef7f5', (1 - ph) * 0.4);
    ell(ctx, 6.6 + ph * 9, -49.4 - ph * 3, 1.2 + ph * 2, 1 + ph * 1.4); ctx.fill();
  };
  OV['pollen-puff'] = function (ctx, t) {
    glowDot(ctx, 0, -26, 24, '#ffe98a', 0.13);
    ctx.fillStyle = rgba('#ffe98a', 0.5);
    for (var i = 0; i < 4; i++) {
      var a = t * 1.1 + i * 1.7;
      ell(ctx, Math.cos(a) * 19, -26 + Math.sin(a * 1.4) * 11, 1.3, 1.3); ctx.fill();
    }
  };
  OV['lantern-wasp'] = function (ctx, t) {
    glowDot(ctx, -6.3, -27, 13, '#ffe9a0', 0.5 + Math.sin(t * 7) * 0.28);
    ctx.fillStyle = rgba('#cfe8f0', 0.1 + Math.abs(Math.sin(t * 34)) * 0.16);
    ell(ctx, -1.6, -38 + Math.sin(t * 34) * 1.6, 12, 3.6); ctx.fill();
  };
  OV['sap-shaman'] = function (ctx, t, view) {
    if (view !== 0) return;
    glowDot(ctx, 3.8, -14.5, 15, '#ffcf5a', 0.5 + Math.sin(t * 2.4) * 0.12);
    var bub = (t * 1.3) % 1;
    ctx.fillStyle = rgba('#ffe9a0', 1 - bub);
    ell(ctx, 3.8 + Math.sin(t * 2.1) * 4, -15 - bub * 8, 1.4 + bub, 1.4 + bub); ctx.fill();
  };
  OV['drowned-porter'] = function (ctx, t) {
    glowDot(ctx, 21.6, -7.5, 12, '#ffe9a0', 0.5 + Math.sin(t * 3.1) * 0.12);
  };
  OV['lantern-jelly'] = function (ctx, t) {
    var pu = (Math.sin(t * 2.4) + 1) / 2;
    glowDot(ctx, 0, -36, 18 + pu * 7, '#7ef0d4', 0.55);
    glowDot(ctx, 0, -2, 20, '#7ef0d4', 0.16 + pu * 0.12);
  };
  OV['brine-golem'] = function (ctx, t, view) {
    if (view === 0) glowDot(ctx, 3.1, -31, 10, '#2e8ea8', 0.4 + Math.sin(t * 2.2) * 0.15);
  };
  OV['boss-gardener'] = function (ctx, t, view) {
    if (view !== 0) return;
    var pu = 0.45 + Math.sin(t * 2.6) * 0.3;
    glowDot(ctx, -2.7, -125, 9, '#d8ffb0', pu);
    glowDot(ctx, 14.4, -125, 9, '#d8ffb0', pu);
  };
  OV['boss-baroness'] = function (ctx, t) {
    glowDot(ctx, 0, -118, 26, accentCur, 0.28 + Math.sin(t * 1.7) * 0.1);
  };
  OV['ember-imp'] = function (ctx, t) {
    var hot = 0.55 + Math.sin(t * 6) * 0.25;
    glowDot(ctx, 0, -18, 22, '#ff7a3c', hot * 0.5);
    for (var i = 0; i < 3; i++) {
      var ph = (t * 1.6 + i * 0.4) % 1;
      ctx.fillStyle = rgba('#ffb060', (1 - ph) * 0.8);
      ell(ctx, Math.sin(i * 9 + t) * 8, -28 - ph * 16, 1.2, 1.2); ctx.fill();
    }
  };
  OV['walking-anvil'] = function (ctx, t, view) {
    if (view !== 0) return;
    var hot = 0.4 + Math.sin(t * 3.4) * 0.15;
    glowDot(ctx, -2.9, -26, 5, '#ff6a2c', hot);
    glowDot(ctx, 9.1, -26, 5, '#ff6a2c', hot);
  };
  OV['ash-wraith'] = function (ctx, t, view) {
    var hot = 0.6 + Math.sin(t * 5) * 0.25;
    if (view === 0) {
      glowDot(ctx, -1.8, -56, 7, '#ff8a3c', hot);
      glowDot(ctx, 5, -56, 7, '#ff8a3c', hot);
    }
    glowDot(ctx, 12.6, -44 + Math.sin(t * 1.8) * 2, 5, '#ff8a3c', 0.5);
  };
  OV['slag-mound'] = function (ctx, t) {
    glowDot(ctx, 0, -14, 20, '#ff7a3c', (0.45 + Math.sin(t * 3.4) * 0.22) * 0.5);
    var dp = (t * 1.2) % 1;
    ctx.fillStyle = rgba('#ff8a3c', 1 - dp);
    ell(ctx, 14, -6 + dp * 6, 1.3, 1.9); ctx.fill();
  };
  OV['faceless-smith'] = function (ctx, t, view) {
    glowDot(ctx, 1.6, -62, 10, '#ff9a5a', 0.32 + Math.sin(t * 3) * 0.14);
    if (view === 1) glowDot(ctx, -1.6, -26, 12, '#ff9a5a', 0.22 + Math.sin(t * 3) * 0.1);
  };
  OV['boss-heartforge'] = function (ctx, t, view) {
    var hot = 0.55 + Math.sin(t * 2.8) * 0.2;
    if (view === 0) {
      glowDot(ctx, 7.7, -69, 26, '#ff9a3c', hot * 0.6);
      glowDot(ctx, 5.5, -138.6, 12, '#ff9a3c', hot * 0.8);
    } else {
      glowDot(ctx, -7.7, -52, 12, '#ff9a3c', hot * 0.4);
    }
    var ph = (t * 1.3) % 1;
    ctx.fillStyle = rgba('#ffb060', (1 - ph) * 0.7);
    ell(ctx, Math.sin(t * 2) * 10, -120 - ph * 26, 1.6, 1.6); ctx.fill();
  };
  OV['spark-whelp'] = function (ctx, t) {
    glowDot(ctx, 0, -12, 15, '#ffcf6a', 0.6 + Math.sin(t * 9) * 0.25);
  };
  OV['slag-bit'] = function (ctx, t) {
    glowDot(ctx, 0, -6, 9, '#ff7a3c', (0.5 + Math.sin(t * 4.4) * 0.28) * 0.55);
  };
  OV['sporeling'] = function (ctx, t) {
    glowDot(ctx, 0, -12, 9, '#6fe0c8', 0.25 + (Math.sin(t * 3) + 1) * 0.12);
  };

  S.drawDir = function (ctx, defId, dir, o) {
    o = o || {};
    var view = dir >= 2 ? 1 : 0;
    var mirror = dir === 1 || dir === 3;
    var e = getView(defId, view);
    if (!e) return;
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    if (ctx.globalAlpha <= 0.01) { ctx.restore(); return; }
    if (o.casting) {                  // antecipação: agacha e comprime (transform)
      var c = Math.sin(Math.min(o.casting, 1) * Math.PI);
      ctx.translate(0, c * 3.2);
      ctx.scale(1 + c * 0.07, 1 - c * 0.1);
    }
    if (mirror) ctx.scale(-1, 1);
    var lw = e.w / BS, lh = e.h / BS;
    // rim light dinâmico: halo fino da silhueta no lado da luz DO MUNDO —
    // realce troca de lado sem deformar o desenho
    var L = o.lightX || 0;
    var eff = mirror ? -L : L;
    if (Math.abs(eff) > 0.05) {
      var sil = getSil(defId, view);
      ctx.save();
      ctx.globalAlpha *= Math.min(Math.abs(eff) * 1.5, 1) * 0.45;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(sil, e.x0 + (eff > 0 ? 1.7 : -1.7), e.y0 - 1.1, lw, lh);
      ctx.restore();
    }
    ctx.drawImage(e.img, e.x0, e.y0, lw, lh);
    if (o.flash && o.flash > 0.02 && ctx.filter !== undefined) {
      ctx.save();
      ctx.globalAlpha *= Math.min(o.flash, 1) * 0.9;
      ctx.filter = 'brightness(2.6) saturate(0.2)';
      ctx.drawImage(e.img, e.x0, e.y0, lw, lh);
      ctx.filter = 'none';
      ctx.restore();
    }
    var ov = OV[defId];
    if (ov && o.overlay !== false) ov(ctx, o.t || 0, view, mirror, o);
    if (o.flash) glowDot(ctx, 0, -30, 44, '#ffffff', Math.min(o.flash, 1) * 0.4);
    ctx.restore();
  };
})();
