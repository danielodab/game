var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// JOGO.FX v2 — "juice" completo. Dono: Agente Designer.
//
//   FX.handleEvent(ev)          contrato (main.js)
//   FX.updateAndDraw(ctx, dt)   chamado pelo Renderer no fim do frame
//   FX.getShake() -> {x,y}      lido pelo Renderer
//   FX.getTimeScale() -> num    micro hit-stop (Renderer escala dt visual)
//   FX.setAmbient(theme)        partículas ambientes por tema
//
// Pipeline de um feitiço:
//   'cast' → círculo de conjuração no chão + carga no conjurador (antecipação)
//          → payload do fxKey com atraso sincronizado à investida do Renderer
//   'damage' → flash + burst radial POR ELEMENTO + número forte + shake ∝ dano
//              + micro hit-stop em golpes pesados
//   'death'  → dissolução dramática nas CORES do próprio monstro
// ============================================================================

(function () {
  var FX = {};

  // ---------- utilidades ----------
  function el() { return (JOGO.Sprites && JOGO.Sprites.elements) || {}; }
  function elColor(e) { return el()[e] || '#d8d0c0'; }
  function rgba(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function shade(c, amt) {
    var S = JOGO.Sprites;
    return (S && S.shade) ? S.shade(c, amt) : c;
  }
  function proj(gx, gy, z) {
    if (JOGO.Renderer && JOGO.Renderer.project) return JOGO.Renderer.project(gx, gy, z || 0);
    return { x: gx * 40, y: gy * 40 - (z || 0), s: 1 };
  }
  // memo de gradientes quentes (CanvasGradient independe do canvas de origem)
  var FGC = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
  if (FGC) { FGC.width = FGC.height = 1; }
  var fgctx = FGC ? FGC.getContext('2d') : null;
  var fmemo = {}; var fmemoN = 0;
  function memoG(key, make) {
    var g = fmemo[key];
    if (g === undefined) {
      if (++fmemoN > 400) { fmemo = {}; fmemoN = 1; }
      g = fmemo[key] = make();
    }
    return g;
  }

  function unitWorld(uid) {
    if (JOGO.Renderer && JOGO.Renderer.unitWorld) {
      var w = JOGO.Renderer.unitWorld(uid);
      if (w) return w;
    }
    var st = JOGO.Game && JOGO.Game.state;
    if (st && st.units) {
      for (var i = 0; i < st.units.length; i++) {
        if (st.units[i].uid === uid) return { x: st.units[i].x, y: st.units[i].y };
      }
    }
    return null;
  }
  function unitOf(uid) {
    var st = JOGO.Game && JOGO.Game.state;
    if (st && st.units) {
      for (var i = 0; i < st.units.length; i++) if (st.units[i].uid === uid) return st.units[i];
    }
    return null;
  }
  function palOf(uid) {
    var u = unitOf(uid);
    var S = JOGO.Sprites;
    var p = (u && S && S.defPalette) ? S.defPalette(u.defId) : null;
    return p || { primary: '#d8d0c0', secondary: '#8a8296', accent: '#ffffff' };
  }
  // atraso padrão: sincroniza o hit com a animação de conjuração/projétil.
  // Preferimos Renderer.hitDelay() (exato: 0 sem animação, 0.26 investida,
  // 0.5 bolt); fallback no isBusy antigo + atraso extra de projétil.
  function syncDelay() {
    var R2 = JOGO.Renderer;
    if (R2 && R2.hitDelay) return R2.hitDelay();
    if (!(R2 && R2.isBusy && R2.isBusy())) return 0;
    return 0.26 + (fxClock < hitSyncUntil ? hitSyncExtra : 0);
  }

  // ---------- pool de partículas ----------
  var POOL_N = 900;
  var pool = [];
  (function () { for (var i = 0; i < POOL_N; i++) pool.push({ on: false }); })();
  var poolIdx = 0;

  // shapes: dot | spark | flame | drop | bubble | shard | streak | smoke | ray | star
  function spawn(o) {
    var n = POOL_N, p;
    while (n-- > 0) {
      poolIdx = (poolIdx + 1) % POOL_N;
      p = pool[poolIdx];
      if (!p.on) break;
    }
    p.on = true;
    p.gx = o.gx || 0; p.gy = o.gy || 0; p.z = o.z || 0;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.life = 0; p.max = o.max || 0.6;
    p.size = o.size || 3; p.col = o.col || '#ffffff';
    p.col2 = o.col2 || null;
    p.grav = o.grav || 0; p.drag = o.drag == null ? 1 : o.drag;
    p.glow = !!o.glow; p.shape = o.shape || 'dot';
    p.grow = o.grow || 0; p.spin = o.spin || 0; p.rot = Math.random() * Math.PI * 2;
    return p;
  }

  // ---------- assinatura visual POR ELEMENTO ----------
  var ELEM_FX = {
    fire:   { shapes: ['flame', 'spark', 'spark'], col2: '#ffe9a0', grav: -220, up: 60, drag: 0.94 },
    water:  { shapes: ['drop', 'bubble', 'dot'], col2: '#d8f4ff', grav: 340, up: 66, drag: 0.96 },
    earth:  { shapes: ['shard', 'shard', 'dot'], col2: '#e0d8a0', grav: 420, up: 90, drag: 0.97 },
    air:    { shapes: ['streak', 'streak', 'dot'], col2: '#ffffff', grav: -30, up: 30, drag: 0.9 },
    light:  { shapes: ['ray', 'star', 'dot'], col2: '#fff8e0', grav: -140, up: 46, drag: 0.95 },
    shadow: { shapes: ['smoke', 'wisp', 'dot'], col2: '#5a4a78', grav: -90, up: 30, drag: 0.96 },
    neutral:{ shapes: ['dot', 'spark', 'dot'], col2: '#f0e8d8', grav: -120, up: 40, drag: 0.94 }
  };

  // explosão radial estilizada por elemento
  function elemBurst(gx, gy, element, n, opt) {
    opt = opt || {};
    var st = ELEM_FX[element] || ELEM_FX.neutral;
    var col = opt.col || elColor(element);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = (opt.speed || 2.4) * (0.4 + Math.random() * 0.9);
      var shape = st.shapes[i % st.shapes.length];
      spawn({
        gx: gx, gy: gy, z: (opt.z == null ? 20 : opt.z) + Math.random() * 12,
        vx: Math.cos(a) * sp * 0.022, vy: Math.sin(a) * sp * 0.022,
        vz: (Math.random() * 1.8 - 0.3) * st.up * (opt.upK || 1),
        max: (opt.life || 0.6) * (0.55 + Math.random() * 0.9),
        size: (opt.size || 3.2) * (0.6 + Math.random() * 0.9) * (shape === 'smoke' ? 2 : 1),
        col: Math.random() < 0.65 ? col : (st.col2 || col),
        col2: st.col2,
        grav: st.grav, drag: st.drag,
        glow: shape !== 'smoke' && shape !== 'shard',
        shape: shape,
        spin: (Math.random() - 0.5) * 8,
        grow: shape === 'smoke' ? 5 : 0
      });
    }
  }

  // ---------- estruturas dinâmicas ----------
  var projectiles = []; // {a,b,t,dur,col,element,arcH,size}
  var beams = [];       // {a,b,t,dur,col,rope}
  var rings = [];       // {gx,gy,t,dur,col,maxR,hex,z,w}
  var clouds = [];      // {gx,gy,t,dur,col}
  var floaters = [];    // números de dano
  var flashes = [];     // {gx,gy,z,t,dur,col,r}  flash de impacto
  var castCircles = []; // {gx,gy,t,dur,col}      círculo de conjuração
  var charges = [];     // {uid,t,dur,col}        carga no conjurador
  var slashes = [];     // {gx,gy,z,a0,sweep,t,dur,col}  arco de golpe melee
  var decals = [];      // {gx,gy,el,t,dur,r,cv,add,seed} marcas no chão
  var glights = [];     // {gx,gy,t,dur,col,r,a}  clarão projetado no piso
  var delayedQ = [];    // {t, fn}
  var shakeT = 0, shakeDur = 0, shakeMag = 0;
  var freezeT = 0;
  var fxClock = 0;                       // relógio real do FX
  var hitSyncUntil = 0, hitSyncExtra = 0; // atraso extra p/ projéteis lentos

  // ---------- plano do CHÃO ----------
  // transforma o ctx para o plano z≈0: círculo unitário = raio r no mundo.
  // Exato sob qualquer rotação/tilt da câmera (usa 3 pontos projetados).
  function groundT(ctx, gx, gy, r, z) {
    var zz = z == null ? 1.2 : z;
    var p0 = proj(gx, gy, zz);
    var px = proj(gx + r, gy, zz);
    var py = proj(gx, gy + r, zz);
    ctx.transform(px.x - p0.x, px.y - p0.y, py.x - p0.x, py.y - p0.y, p0.x, p0.y);
  }
  function unitGlowGrad(col, a) {
    return memoG('UG' + col + '|' + Math.round(a * 20), function () {
      var g = fgctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, rgba(col, a));
      g.addColorStop(0.5, rgba(col, a * 0.4));
      g.addColorStop(1, rgba(col, 0));
      return g;
    });
  }
  // clarão radial que ILUMINA O CHÃO ao redor (aditivo, no plano do piso)
  function drawGroundGlow(ctx, gx, gy, r, col, a) {
    if (a <= 0.012 || !fgctx) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    groundT(ctx, gx, gy, r);
    ctx.fillStyle = unitGlowGrad(col, Math.min(a, 1));
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ---------- MARCAS NO CHÃO (decal por elemento, esvaece em ~3s) ----------
  var DECAL_MAX = 18;
  function decalRand(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function bakeDecal(element, seed) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 96;
    var g = cv.getContext('2d');
    var rnd = decalRand(seed);
    g.translate(48, 48);
    var i, a, r0, r1, x0, y0;
    function blotch(color, rBase, rVar, n) {
      g.fillStyle = color;
      g.beginPath();
      for (i = 0; i <= n; i++) {
        a = (i / n) * Math.PI * 2;
        r0 = rBase + rnd() * rVar;
        if (i === 0) g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        else g.lineTo(Math.cos(a) * r0, Math.sin(a) * r0);
      }
      g.closePath(); g.fill();
    }
    switch (element) {
      case 'fire': // chão CHAMUSCADO com brasinhas presas
        blotch('rgba(10,6,3,0.8)', 22, 18, 11);
        blotch('rgba(34,15,6,0.75)', 12, 10, 9);
        g.strokeStyle = 'rgba(6,3,2,0.6)'; g.lineWidth = 3; g.lineCap = 'round';
        for (i = 0; i < 7; i++) {
          a = rnd() * Math.PI * 2;
          g.beginPath();
          g.moveTo(Math.cos(a) * 10, Math.sin(a) * 10);
          g.lineTo(Math.cos(a) * (30 + rnd() * 12), Math.sin(a) * (30 + rnd() * 12));
          g.stroke();
        }
        for (i = 0; i < 6; i++) { // brasinhas
          a = rnd() * Math.PI * 2; r0 = 6 + rnd() * 24;
          x0 = Math.cos(a) * r0; y0 = Math.sin(a) * r0;
          g.fillStyle = 'rgba(255,150,60,0.95)';
          g.beginPath(); g.arc(x0, y0, 1.6 + rnd() * 1.4, 0, Math.PI * 2); g.fill();
          g.fillStyle = 'rgba(255,230,160,0.8)';
          g.beginPath(); g.arc(x0, y0, 0.8, 0, Math.PI * 2); g.fill();
        }
        break;
      case 'water': // POÇA reflexiva
        blotch('rgba(30,90,120,0.68)', 26, 14, 10);
        blotch('rgba(60,140,175,0.55)', 16, 9, 8);
        g.strokeStyle = 'rgba(126,240,212,0.5)'; g.lineWidth = 2;
        g.beginPath();
        for (i = 0; i <= 10; i++) {
          a = (i / 10) * Math.PI * 2;
          r0 = 27 + Math.sin(a * 3 + seed) * 5;
          if (i === 0) g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
          else g.lineTo(Math.cos(a) * r0, Math.sin(a) * r0);
        }
        g.closePath(); g.stroke();
        g.fillStyle = 'rgba(220,248,255,0.4)'; // reflexo
        g.beginPath(); g.ellipse(-7, -7, 11, 4.5, -0.5, 0, Math.PI * 2); g.fill();
        for (i = 0; i < 3; i++) { // gotas satélite
          a = rnd() * Math.PI * 2;
          g.fillStyle = 'rgba(60,140,175,0.5)';
          g.beginPath(); g.arc(Math.cos(a) * 38, Math.sin(a) * 38, 2.5 + rnd() * 2, 0, Math.PI * 2); g.fill();
        }
        break;
      case 'earth': // RACHADURAS com esporos
        blotch('rgba(20,16,8,0.5)', 18, 12, 9);
        for (i = 0; i < 5; i++) {
          a = (i / 5) * Math.PI * 2 + rnd() * 0.7;
          var mx = Math.cos(a + 0.25) * (16 + rnd() * 8), my = Math.sin(a + 0.25) * (16 + rnd() * 8);
          var ex = Math.cos(a - 0.12) * (32 + rnd() * 10), ey = Math.sin(a - 0.12) * (32 + rnd() * 10);
          // halo claro por baixo (borda erguida da rachadura — legível no escuro)
          g.strokeStyle = 'rgba(224,216,160,0.4)'; g.lineWidth = 5; g.lineCap = 'round';
          g.beginPath(); g.moveTo(Math.cos(a) * 3, Math.sin(a) * 3);
          g.lineTo(mx, my); g.lineTo(ex, ey); g.stroke();
          // fissura escura por cima
          g.strokeStyle = 'rgba(10,7,3,0.95)'; g.lineWidth = 2.6;
          g.beginPath(); g.moveTo(Math.cos(a) * 3, Math.sin(a) * 3);
          g.lineTo(mx, my); g.lineTo(ex, ey); g.stroke();
          g.lineWidth = 1.4;
          g.beginPath(); g.moveTo(mx, my);
          g.lineTo(mx + (rnd() - 0.5) * 22, my + (rnd() - 0.5) * 22); g.stroke();
        }
        for (i = 0; i < 6; i++) { // esporos brilhando nas fendas
          a = rnd() * Math.PI * 2; r0 = 8 + rnd() * 22;
          x0 = Math.cos(a) * r0; y0 = Math.sin(a) * r0;
          g.fillStyle = 'rgba(138,212,74,0.9)';
          g.beginPath(); g.arc(x0, y0, 2 + rnd(), 0, Math.PI * 2); g.fill();
          g.fillStyle = 'rgba(220,255,180,0.8)';
          g.beginPath(); g.arc(x0, y0, 0.9, 0, Math.PI * 2); g.fill();
        }
        break;
      case 'air': // anel de poeira (o redemoinho gira em runtime)
        g.strokeStyle = 'rgba(225,238,242,0.3)'; g.lineWidth = 4; g.lineCap = 'round';
        for (i = 0; i < 5; i++) {
          a = rnd() * Math.PI * 2;
          g.beginPath(); g.arc(0, 0, 20 + rnd() * 16, a, a + 0.7 + rnd() * 0.8); g.stroke();
        }
        g.fillStyle = 'rgba(225,238,242,0.22)';
        for (i = 0; i < 8; i++) {
          a = rnd() * Math.PI * 2; r0 = 10 + rnd() * 30;
          g.beginPath(); g.arc(Math.cos(a) * r0, Math.sin(a) * r0, 1.6 + rnd() * 1.6, 0, Math.PI * 2); g.fill();
        }
        break;
      case 'light': // GLIFO brilhante (desenhado aditivo em runtime)
        g.strokeStyle = 'rgba(255,209,102,0.95)'; g.lineWidth = 2.6;
        g.beginPath(); g.arc(0, 0, 38, 0, Math.PI * 2); g.stroke();
        g.lineWidth = 1.4;
        g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.stroke();
        g.lineWidth = 2;
        g.beginPath(); // triângulos entrelaçados = selo
        for (i = 0; i <= 3; i++) { a = (i / 3) * Math.PI * 2 - Math.PI / 2; if (i === 0) g.moveTo(Math.cos(a) * 30, Math.sin(a) * 30); else g.lineTo(Math.cos(a) * 30, Math.sin(a) * 30); }
        g.stroke();
        g.beginPath();
        for (i = 0; i <= 3; i++) { a = (i / 3) * Math.PI * 2 + Math.PI / 2; if (i === 0) g.moveTo(Math.cos(a) * 30, Math.sin(a) * 30); else g.lineTo(Math.cos(a) * 30, Math.sin(a) * 30); }
        g.stroke();
        for (i = 0; i < 6; i++) { // diamantes nos raios
          a = (i / 6) * Math.PI * 2;
          x0 = Math.cos(a) * 38; y0 = Math.sin(a) * 38;
          g.fillStyle = 'rgba(255,240,200,0.95)';
          g.save(); g.translate(x0, y0); g.rotate(a);
          g.beginPath(); g.moveTo(-3, 0); g.lineTo(0, -3); g.lineTo(3, 0); g.lineTo(0, 3); g.closePath(); g.fill();
          g.restore();
        }
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.beginPath(); g.arc(0, 0, 4, 0, Math.PI * 2); g.fill();
        break;
      default: // shadow — mancha que FERVE (bolhas em runtime)
        blotch('rgba(18,8,30,0.8)', 22, 14, 11);
        blotch('rgba(40,20,66,0.7)', 13, 8, 9);
        g.strokeStyle = 'rgba(120,80,180,0.45)'; g.lineWidth = 2;
        g.beginPath();
        for (i = 0; i <= 12; i++) {
          a = (i / 12) * Math.PI * 2;
          r0 = 26 + Math.sin(a * 4 + seed) * 6;
          if (i === 0) g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
          else g.lineTo(Math.cos(a) * r0, Math.sin(a) * r0);
        }
        g.closePath(); g.stroke();
    }
    return cv;
  }
  function spawnDecal(gx, gy, element, power) {
    if (!document || !document.createElement) return;
    if (decals.length >= DECAL_MAX) decals.shift();
    var seed = (((gx * 73856093) ^ (gy * 19349663) ^ ((decals.length + 1) * 83492791)) >>> 0) || 7;
    decals.push({
      gx: gx, gy: gy, el: element, t: 0, dur: 3.1,
      r: 0.5 + Math.min(power || 16, 40) * 0.007,
      cv: bakeDecal(element, seed),
      add: element === 'light',
      seed: seed
    });
  }
  // vida da marca: brasinhas, borbulhas, redemoinho…
  function decalLive(ctx, dc, da, du) {
    var t = dc.t;
    if (dc.el === 'fire') {
      drawGroundGlow(ctx, dc.gx, dc.gy, dc.r * 1.15, '#ff8c3a', 0.2 * da * (0.7 + Math.sin(t * 9 + dc.seed) * 0.3));
      if (Math.random() < du * 3.2) {
        var af = Math.random() * Math.PI * 2, rf = Math.random() * dc.r * 0.8;
        spawn({
          gx: dc.gx + Math.cos(af) * rf, gy: dc.gy + Math.sin(af) * rf, z: 2,
          vz: 26 + Math.random() * 22, max: 0.55, size: 1.6,
          col: Math.random() < 0.5 ? '#ff9a3c' : '#ffd76b', glow: true, drag: 1, shape: 'spark', grav: -60
        });
      }
    } else if (dc.el === 'water') {
      // reflexo ondulando
      ctx.save(); groundT(ctx, dc.gx, dc.gy, dc.r);
      ctx.strokeStyle = rgba('#d8f4ff', 0.3 * da * (0.5 + Math.sin(t * 4 + dc.seed) * 0.5));
      ctx.lineWidth = 0.06;
      var wr = 0.3 + ((t * 0.5 + (dc.seed % 10) / 10) % 1) * 0.6;
      ctx.beginPath(); ctx.arc(0, 0, wr, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    } else if (dc.el === 'earth') {
      if (Math.random() < du * 1.4) {
        spawn({
          gx: dc.gx + (Math.random() - 0.5) * dc.r, gy: dc.gy + (Math.random() - 0.5) * dc.r, z: 2,
          vz: 14 + Math.random() * 10, max: 0.9, size: 1.5,
          col: '#8ad44a', glow: true, drag: 1, grav: 0
        });
      }
    } else if (dc.el === 'air') {
      // redemoinho de poeira girando
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      groundT(ctx, dc.gx, dc.gy, dc.r);
      ctx.strokeStyle = rgba('#e1eef2', 0.4 * da); ctx.lineWidth = 0.07; ctx.lineCap = 'round';
      var rot = t * 4.6;
      for (var sw = 0; sw < 3; sw++) {
        var aa = rot + sw * (Math.PI * 2 / 3);
        ctx.beginPath(); ctx.arc(0, 0, 0.42 + sw * 0.2, aa, aa + 1.5); ctx.stroke();
      }
      ctx.restore();
      if (Math.random() < du * 2.2) {
        var ad = Math.random() * Math.PI * 2;
        spawn({
          gx: dc.gx + Math.cos(ad) * dc.r * 0.7, gy: dc.gy + Math.sin(ad) * dc.r * 0.7, z: 3,
          vx: -Math.sin(ad) * 0.02, vy: Math.cos(ad) * 0.02, vz: 16,
          max: 0.5, size: 2, col: '#e1eef2', glow: true, drag: 0.97, shape: 'streak'
        });
      }
    } else if (dc.el === 'light') {
      drawGroundGlow(ctx, dc.gx, dc.gy, dc.r * 1.3, '#ffd166', 0.22 * da * (0.6 + Math.sin(t * 3) * 0.4));
      if (Math.random() < du * 1.2) {
        spawn({
          gx: dc.gx + (Math.random() - 0.5) * dc.r * 1.4, gy: dc.gy + (Math.random() - 0.5) * dc.r * 1.4,
          z: 3, vz: 24 + Math.random() * 16, max: 0.7, size: 1.8,
          col: '#ffd166', glow: true, drag: 1, shape: 'star'
        });
      }
    } else if (dc.el === 'shadow') {
      // fervura: bolhas escuras subindo e estourando
      ctx.save(); groundT(ctx, dc.gx, dc.gy, dc.r);
      for (var bb = 0; bb < 3; bb++) {
        var bt = (t * 1.6 + bb * 0.37 + (dc.seed % 7) * 0.1) % 1;
        var ba = (dc.seed * 0.7 + bb * 2.2) % (Math.PI * 2);
        var br = 0.2 + ((dc.seed >> bb) % 5) / 10;
        ctx.fillStyle = rgba('#2a1444', (1 - bt) * 0.75 * da);
        ctx.beginPath();
        ctx.arc(Math.cos(ba) * br, Math.sin(ba) * br, 0.05 + bt * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      if (Math.random() < du * 1.6) {
        spawn({
          gx: dc.gx + (Math.random() - 0.5) * dc.r, gy: dc.gy + (Math.random() - 0.5) * dc.r, z: 4,
          vz: 12 + Math.random() * 10, max: 0.7, size: 3,
          col: '#a06ae0', glow: false, shape: 'smoke', drag: 0.98, grow: 3
        });
      }
    }
  }

  function later(delay, fn) {
    if (delay <= 0) fn(); else delayedQ.push({ t: delay, fn: fn });
  }
  function addShake(mag, dur) {
    if (mag > shakeMag * (1 - shakeT / Math.max(shakeDur, 0.01)) || shakeT >= shakeDur) {
      shakeMag = mag; shakeDur = dur; shakeT = 0;
    }
  }
  function hitStop(dur) { freezeT = Math.max(freezeT, dur); }
  FX.getShake = function () {
    if (shakeT >= shakeDur) return { x: 0, y: 0 };
    var k = 1 - shakeT / shakeDur;
    var m = shakeMag * k * k;
    return { x: (Math.random() * 2 - 1) * m, y: (Math.random() * 2 - 1) * m };
  };
  FX.getTimeScale = function () { return freezeT > 0 ? 0.12 : 1; };

  function addFloater(gx, gy, txt, col, big, kind, amount) {
    // valores muito altos ganham escala extra além do "big"
    var xk = 1;
    if (amount != null && amount >= 40) xk = 1.16;
    if (amount != null && amount >= 60) xk = 1.3;
    floaters.push({
      gx: gx, gy: gy, z: 50 + Math.random() * 6, txt: txt, col: col,
      t: 0, dur: big ? 1.35 : 1.05, big: !!big, kind: kind || 'dmg', xk: xk,
      dx: (Math.random() * 2 - 1) * 16, vy0: big ? 66 : 52
    });
  }

  // IMPACTO EM DOIS TEMPOS:
  //   T1 — flash branco seco no alvo + hit-stop (2-3 frames congelados)
  //   T2 — explosão: burst denso 30+, anel de choque, fragmentos elementais,
  //        clarão iluminando o CHÃO e marca temporária no piso.
  function impact(gx, gy, element, power, opt) {
    opt = opt || {};
    var col = elColor(element);
    var heavy = power >= 25;
    flashes.push({ gx: gx, gy: gy, z: opt.z == null ? 26 : opt.z, t: 0, dur: 0.07, col: '#ffffff', r: 22 + power * 0.55 });
    if (power >= 8) hitStop(heavy ? 0.085 : 0.04);
    later(0.055, function () {
      flashes.push({ gx: gx, gy: gy, z: 24, t: 0, dur: 0.3, col: col, r: 26 + power * 0.7 });
      glights.push({ gx: gx, gy: gy, t: 0, dur: 0.45, col: col, r: 1.2 + power * 0.02, a: 0.8 });
      elemBurst(gx, gy, element, Math.min(30 + Math.round(power * 0.7), 52), {
        speed: 2.8 + power * 0.045, size: 3.4 + power * 0.04, life: 0.7
      });
      rings.push({ gx: gx, gy: gy, t: 0, dur: 0.34, col: col, maxR: 0.82 + power * 0.014, z: 4, w: 3.4 });
      rings.push({ gx: gx, gy: gy, t: 0.05, dur: 0.4, col: '#ffffff', maxR: 0.64 + power * 0.012, z: 8, w: 1.4 });
      if (!opt.noDecal) spawnDecal(gx, gy, element, power);
      // fragmentos direcionais quando o golpe vem de alguém (corpo a corpo)
      if (opt.fromX != null) {
        var ddx = gx - opt.fromX, ddy = gy - opt.fromY;
        var dl = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        var base = Math.atan2(ddy / dl, ddx / dl);
        for (var fi = 0; fi < 9; fi++) {
          var fa = base + (Math.random() - 0.5) * 1.1;
          var fs2 = 0.035 + Math.random() * 0.03;
          spawn({
            gx: gx, gy: gy, z: 16 + Math.random() * 14,
            vx: Math.cos(fa) * fs2, vy: Math.sin(fa) * fs2,
            vz: 30 + Math.random() * 50,
            max: 0.4 + Math.random() * 0.3, size: 2.6 + Math.random() * 1.6,
            col: fi % 3 ? col : '#ffffff', glow: true, drag: 0.94,
            shape: fi % 2 ? 'streak' : 'shard', grav: -260, spin: (Math.random() - 0.5) * 10
          });
        }
      }
      // shake calibrado: pesado é PERCEPTÍVEL, fraco é sussurro
      if (heavy) addShake(Math.min(5 + power * 0.16, 13), 0.3 + power * 0.003);
      else if (power >= 12) addShake(3, 0.22);
      else addShake(1.5, 0.13);
    });
  }

  // ---------- ambiente ----------
  var ambientTheme = null, ambientT = 0;
  FX.setAmbient = function (theme) { ambientTheme = theme; };

  function spawnAmbient(dt) {
    if (!ambientTheme) return;
    var st = JOGO.Game && JOGO.Game.state;
    var w = (st && st.grid && st.grid.w) || 13, h = (st && st.grid && st.grid.h) || 13;
    ambientT += dt;
    var rate = ambientTheme === 'forge' ? 0.06 : 0.09;
    while (ambientT > rate) {
      ambientT -= rate;
      // partículas em espaço de MUNDO, também sobre o chão ao redor da grade
      var gx = Math.random() * (w + 9) - 5, gy = Math.random() * (h + 9) - 5;
      if (ambientTheme === 'garden' || ambientTheme === 'greenhouse') {
        var fire = Math.random() < 0.25;
        spawn({
          gx: gx, gy: gy, z: 10 + Math.random() * 50,
          vx: (Math.random() - 0.5) * 0.006, vy: (Math.random() - 0.5) * 0.006,
          vz: 6 + Math.random() * 8,
          max: 3 + Math.random() * 2.5, size: fire ? 2.2 : 1.6,
          col: fire ? '#ffd76b' : '#9adcb8', glow: true, grav: 0, drag: 1
        });
      } else if (ambientTheme === 'cistern') {
        if (Math.random() < 0.7) {
          spawn({
            gx: gx, gy: gy, z: 2, vz: 26 + Math.random() * 18,
            max: 2 + Math.random() * 1.6, size: 1.4 + Math.random() * 1.4,
            col: '#7ef0d4', glow: true, shape: 'bubble', drag: 1
          });
        } else {
          spawn({
            gx: gx, gy: gy, z: 120, vz: -190,
            max: 0.62, size: 1.8, col: '#8ac0d0', glow: false, shape: 'drop', drag: 1
          });
        }
      } else {
        var soot = Math.random() < 0.3;
        spawn({
          gx: gx, gy: gy, z: 2,
          vx: (Math.random() - 0.5) * 0.01, vy: (Math.random() - 0.5) * 0.01,
          vz: 22 + Math.random() * 26,
          max: 1.8 + Math.random() * 1.6, size: soot ? 2 : 1.5,
          col: soot ? '#4a4448' : (Math.random() < 0.5 ? '#ffb347' : '#ff7a3c'),
          glow: !soot, drag: 1
        });
      }
    }
  }

  // ---------- eventos (contrato) ----------
  FX.handleEvent = function (ev) {
    if (!ev) return;
    var w, colr, d;
    switch (ev.type) {
      case 'battleStart':
        FX.reset();
        if (ev.state && JOGO.DATA && JOGO.DATA.dungeons) {
          for (var i = 0; i < JOGO.DATA.dungeons.length; i++) {
            if (JOGO.DATA.dungeons[i].id === ev.state.dungeonId) FX.setAmbient(JOGO.DATA.dungeons[i].theme);
          }
        }
        break;

      case 'cast':
        castFx(ev);
        break;

      case 'damage':
        (function (uid, amount, element) {
          later(syncDelay(), function () {
            var w2 = unitWorld(uid);
            if (!w2) return;
            var col = elColor(element);
            var big = amount >= 30;
            impact(w2.x, w2.y, element, amount, { noDecal: true });
            // o número estoura JUNTO com a explosão (tempo 2)
            later(0.055, function () {
              addFloater(w2.x, w2.y, String(amount), col, big, 'dmg', amount);
            });
          });
        })(ev.uid, ev.amount, ev.element);
        break;

      case 'heal':
        (function (uid, amount) {
          later(syncDelay(), function () {
            var w2 = unitWorld(uid);
            if (!w2) return;
            addFloater(w2.x, w2.y, '+' + amount, '#9ae08a', amount >= 26, 'heal', amount);
            glights.push({ gx: w2.x, gy: w2.y, t: 0, dur: 0.6, col: '#9ae08a', r: 0.95, a: 0.5 });
            for (var j = 0; j < 22; j++) {
              spawn({
                gx: w2.x + (Math.random() - 0.5) * 0.8, gy: w2.y + (Math.random() - 0.5) * 0.8,
                z: 2 + Math.random() * 20, vz: 36 + Math.random() * 34,
                max: 0.9 + Math.random() * 0.7, size: 1.8 + Math.random() * 2,
                col: Math.random() < 0.5 ? '#9ae08a' : '#ffd98a', glow: true, drag: 1,
                shape: Math.random() < 0.35 ? 'star' : 'dot'
              });
            }
            // cruzes de cura subindo
            for (var jc = 0; jc < 3; jc++) {
              spawn({
                gx: w2.x + (Math.random() - 0.5) * 0.6, gy: w2.y + (Math.random() - 0.5) * 0.6,
                z: 14 + jc * 10, vz: 28,
                max: 0.9, size: 3.4, col: '#c8ffb0', glow: true, drag: 1, shape: 'star'
              });
            }
            rings.push({ gx: w2.x, gy: w2.y, t: 0, dur: 0.5, col: '#9ae08a', maxR: 0.6, z: 2, w: 2.6 });
          });
        })(ev.uid, ev.amount);
        break;

      case 'shield':
        (function (uid, amount) {
          // levemente atrasado p/ não colidir com número de cura simultâneo
          later(syncDelay() + 0.22, function () {
            var w2 = unitWorld(uid);
            if (!w2) return;
            addFloater(w2.x, w2.y, '+' + amount, '#8ad4f0', false, 'shield');
            rings.push({ gx: w2.x, gy: w2.y, t: 0, dur: 0.55, col: '#8ad4f0', maxR: 0.62, hex: true, z: 18 });
            for (var j = 0; j < 6; j++) {
              var a = (j / 6) * Math.PI * 2;
              spawn({
                gx: w2.x + Math.cos(a) * 0.4, gy: w2.y + Math.sin(a) * 0.4,
                z: 10 + Math.random() * 26, vz: 8,
                max: 0.5, size: 2.2, col: '#bfeaff', glow: true, drag: 1, shape: 'shard', spin: 3
              });
            }
          });
        })(ev.uid, ev.amount);
        break;

      case 'death':
        (function (uid) {
          var u = unitOf(uid);
          var pal = palOf(uid);
          var isBoss = !!(u && u.boss);
          later(syncDelay() + 0.05, function () {
            var w2 = unitWorld(uid);
            if (!w2) return;
            deathDissolve(w2.x, w2.y, pal, isBoss);
            if (isBoss) { addShake(15, 1.0); hitStop(0.14); }
            else addShake(4, 0.3);
          });
        })(ev.uid);
        break;

      case 'pushed':
        if (ev.collision) {
          (function (tx, ty) {
            later(0.14, function () {
              flashes.push({ gx: tx, gy: ty, z: 20, t: 0, dur: 0.14, col: '#ffffff', r: 20 });
              elemBurst(tx, ty, 'earth', 12, { speed: 2.6, size: 3 });
              addShake(6, 0.28); hitStop(0.06);
            });
          })(ev.toX, ev.toY);
        } else {
          // rastro de deslize
          elemBurst(ev.fromX, ev.fromY, 'air', 5, { speed: 1.2, size: 2, life: 0.3 });
        }
        break;

      case 'teleport':
        (function (fx2, fy2, tx, ty) {
          burstBlink(fx2, fy2, '#c0b8ff', false);
          later(0.16, function () { burstBlink(tx, ty, '#ffffff', true); });
        })(ev.fromX, ev.fromY, ev.toX, ev.toY);
        break;

      case 'summon':
        if (ev.unit) {
          (function (x, y, uid) {
            var pal = palOf(uid);
            rings.push({ gx: x, gy: y, t: 0, dur: 0.6, col: pal.accent, maxR: 0.8, z: 2 });
            elemBurst(x, y, 'earth', 10, { col: pal.primary, speed: 1.8, size: 2.6 });
            for (var j = 0; j < 5; j++) {
              spawn({
                gx: x + (Math.random() - 0.5) * 0.5, gy: y + (Math.random() - 0.5) * 0.5,
                z: 2, vz: 30 + Math.random() * 26,
                max: 0.8, size: 2, col: pal.accent, glow: true, drag: 1
              });
            }
          })(ev.unit.x, ev.unit.y, ev.unit.uid);
        }
        break;

      case 'effectApplied':
        w = unitWorld(ev.uid);
        if (w && ev.effect) {
          if (ev.effect.type === 'poison') {
            later(syncDelay(), (function (wx, wy) {
              return function () { elemBurst(wx, wy, 'earth', 7, { col: '#8ad44a', speed: 1.3, up: 26 }); };
            })(w.x, w.y));
          } else if (ev.effect.type === 'taunt') {
            addFloater(w.x, w.y, '!', '#ff9a4a', true, 'mark');
          }
        }
        break;

      case 'battleEnd':
        break;
    }
  };

  function burstBlink(gx, gy, col, arriving) {
    flashes.push({ gx: gx, gy: gy, z: 24, t: 0, dur: 0.2, col: col, r: 26 });
    for (var i = 0; i < 10; i++) {
      var a = (i / 10) * Math.PI * 2;
      spawn({
        gx: gx, gy: gy, z: 6 + i * 4,
        vx: Math.cos(a) * (arriving ? -0.03 : 0.03), vy: Math.sin(a) * (arriving ? -0.03 : 0.03),
        vz: arriving ? 10 : 30,
        max: 0.4 + Math.random() * 0.2, size: 2.4, col: col, glow: true, drag: 0.93, shape: 'streak'
      });
    }
    rings.push({ gx: gx, gy: gy, t: 0, dur: 0.3, col: col, maxR: 0.5, z: 2 });
  }

  function deathDissolve(gx, gy, pal, isBoss) {
    var n = isBoss ? 64 : 22;
    if (isBoss) {
      // CLARÃO de morte de chefe: flash branco enorme + luz no chão + anéis
      flashes.push({ gx: gx, gy: gy, z: 30, t: 0, dur: 0.34, col: '#ffffff', r: 90 });
      glights.push({ gx: gx, gy: gy, t: 0, dur: 1.1, col: pal.accent, r: 2.8, a: 0.95 });
      rings.push({ gx: gx, gy: gy, t: -0.08, dur: 0.55, col: '#ffffff', maxR: 2.4, z: 6, w: 2 });
      rings.push({ gx: gx, gy: gy, t: -0.2, dur: 0.6, col: pal.accent, maxR: 3.2, z: 3, w: 4 });
      spawnDecal(gx, gy, 'light', 34);
    }
    // matéria do corpo se desfazendo (cores do próprio monstro)
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 1.2 + Math.random() * 2.2;
      var up = Math.random() < 0.6;
      spawn({
        gx: gx + (Math.random() - 0.5) * 0.4, gy: gy + (Math.random() - 0.5) * 0.4,
        z: 4 + Math.random() * (isBoss ? 60 : 36),
        vx: Math.cos(a) * sp * 0.016, vy: Math.sin(a) * sp * 0.016,
        vz: up ? 30 + Math.random() * 50 : -20,
        max: 0.7 + Math.random() * 0.7,
        size: 2.6 + Math.random() * (isBoss ? 4 : 2.6),
        col: Math.random() < 0.55 ? pal.primary : (Math.random() < 0.5 ? pal.secondary : pal.accent),
        grav: up ? -60 : 240, drag: 0.95,
        glow: Math.random() < 0.5,
        shape: Math.random() < 0.45 ? 'shard' : (Math.random() < 0.5 ? 'smoke' : 'dot'),
        spin: (Math.random() - 0.5) * 9,
        grow: 2
      });
    }
    // alma subindo (motas na cor de destaque)
    for (var j = 0; j < (isBoss ? 24 : 6); j++) {
      spawn({
        gx: gx + (Math.random() - 0.5) * 0.5, gy: gy + (Math.random() - 0.5) * 0.5,
        z: 10 + Math.random() * 20, vz: 40 + Math.random() * 40,
        max: 1.1 + Math.random() * 0.7, size: 1.8 + Math.random() * 1.6,
        col: pal.accent, glow: true, drag: 1
      });
    }
    rings.push({ gx: gx, gy: gy, t: 0, dur: 0.5, col: pal.accent, maxR: isBoss ? 1.6 : 0.8, z: 3 });
    flashes.push({ gx: gx, gy: gy, z: 20, t: 0, dur: 0.22, col: pal.accent, r: isBoss ? 46 : 26 });
  }

  // ---------- conjuração ----------
  // ângulo NA TELA do vetor a→b (para orientar o arco de golpe)
  function screenAng(ax, ay, bx, by) {
    var A = proj(ax, ay, 22), B = proj(bx, by, 22);
    return Math.atan2(B.y - A.y, B.x - A.x);
  }
  function castFx(ev) {
    var cw = unitWorld(ev.uid) || { x: ev.x, y: ev.y };
    var col = elColor(ev.element);
    var key = ev.fxKey || 'burst';
    // 1) ANTECIPAÇÃO imediata (windup ~0.3s): círculo de conjuração, carga
    //    crescente e DUAS ondas de partículas convergindo no conjurador
    castCircles.push({ gx: cw.x, gy: cw.y, t: 0, dur: 0.5, col: col });
    charges.push({ uid: ev.uid, t: 0, dur: 0.3, col: col });
    glights.push({ gx: cw.x, gy: cw.y, t: 0, dur: 0.32, col: col, r: 0.85, a: 0.42 });
    for (var i = 0; i < 20; i++) {
      var a = (i / 20) * Math.PI * 2 + Math.random() * 0.3;
      var rr0 = 0.7 + Math.random() * 0.45;
      var wave = i % 2 ? 0 : 0.1;
      later(wave, (function (a2, rr2) {
        return function () {
          spawn({
            gx: cw.x + Math.cos(a2) * rr2, gy: cw.y + Math.sin(a2) * rr2,
            z: 2 + Math.random() * 26,
            vx: -Math.cos(a2) * (0.034 + Math.random() * 0.014),
            vy: -Math.sin(a2) * (0.034 + Math.random() * 0.014),
            vz: 20 + Math.random() * 26,
            max: 0.26 + Math.random() * 0.14,
            size: 2 + Math.random() * 1.6,
            col: Math.random() < 0.3 ? '#ffffff' : col,
            glow: true, drag: 1, shape: Math.random() < 0.3 ? 'streak' : 'dot'
          });
        };
      })(a, rr0));
    }
    // 2) PAYLOAD sincronizado com a investida do renderer (~0.26s)
    var D = 0.26;
    var tx = ev.x, ty = ev.y, elem = ev.element, cx = cw.x, cy = cw.y;
    switch (key) {
      case 'slam':
        // ARCO DE GOLPE: lâmina luminosa varrendo o alvo pouco antes do hit
        later(D - 0.1, function () {
          var sa = screenAng(cx, cy, tx, ty);
          slashes.push({ gx: tx, gy: ty, z: 26, a0: sa - 1.55, sweep: 3.0, t: 0, dur: 0.24, col: col });
        });
        later(D, function () {
          impact(tx, ty, elem, 24, { fromX: cx, fromY: cy });
          // poeira baixa
          elemBurst(tx, ty, 'neutral', 8, { col: '#c8b89a', speed: 1.6, size: 3.4, z: 3, life: 0.5 });
        });
        break;
      case 'bolt':
        // núcleo incandescente maior + rastro longo; o dano espera o voo
        hitSyncExtra = 0.22; hitSyncUntil = fxClock + 1.0;
        later(D * 0.7, function () {
          projectiles.push({ a: { x: cx, y: cy }, b: { x: tx, y: ty }, t: 0, dur: 0.3, col: col, element: elem, arcH: 30, size: 5.4 });
        });
        break;
      case 'beam':
        later(D, function () {
          beams.push({ a: { x: cx, y: cy }, b: { x: tx, y: ty }, t: 0, dur: 0.34, col: col });
          impact(tx, ty, elem, 14, {});
        });
        break;
      case 'burst':
        later(D, function () { impact(tx, ty, elem, 22, {}); });
        break;
      case 'nova':
        later(D, function () {
          flashes.push({ gx: tx, gy: ty, z: 22, t: 0, dur: 0.08, col: '#ffffff', r: 52 });
          hitStop(0.07);
        });
        later(D + 0.055, function () {
          rings.push({ gx: tx, gy: ty, t: 0, dur: 0.6, col: col, maxR: 2.8, z: 4, w: 4.5 });
          rings.push({ gx: tx, gy: ty, t: 0.1, dur: 0.6, col: '#ffffff', maxR: 2.4, z: 8, w: 1.8 });
          rings.push({ gx: tx, gy: ty, t: 0.2, dur: 0.6, col: col, maxR: 3.2, z: 2, w: 2.2 });
          elemBurst(tx, ty, elem, 38, { speed: 3.6, size: 3.6, life: 0.75 });
          flashes.push({ gx: tx, gy: ty, z: 18, t: 0, dur: 0.3, col: col, r: 54 });
          glights.push({ gx: tx, gy: ty, t: 0, dur: 0.6, col: col, r: 2.6, a: 0.85 });
          spawnDecal(tx, ty, elem, 30);
          addShake(8, 0.4);
        });
        break;
      case 'heal':
        later(D, function () {
          rings.push({ gx: tx, gy: ty, t: 0, dur: 0.45, col: '#9ae08a', maxR: 0.7, z: 2 });
        });
        break;
      case 'buff':
        later(D, function () { spiral(tx, ty, col, true); });
        break;
      case 'debuff':
        later(D, function () { spiral(tx, ty, '#8a6ad0', false); });
        break;
      case 'shieldFx':
        later(D, function () {
          rings.push({ gx: tx, gy: ty, t: 0, dur: 0.55, col: '#8ad4f0', maxR: 0.75, hex: true, z: 18 });
        });
        break;
      case 'veil':
        later(D * 0.6, function () {
          for (var j = 0; j < 14; j++) {
            spawn({
              gx: cx + (Math.random() - 0.5) * 0.7, gy: cy + (Math.random() - 0.5) * 0.7,
              z: 4 + Math.random() * 38, vz: 12 + Math.random() * 12,
              max: 0.9 + Math.random() * 0.5, size: 5 + Math.random() * 4,
              col: '#5a5266', glow: false, shape: 'smoke', drag: 0.98, grow: 7
            });
          }
        });
        break;
      case 'hook':
        later(D * 0.6, function () {
          beams.push({ a: { x: cx, y: cy }, b: { x: tx, y: ty }, t: 0, dur: 0.36, col: col, rope: true });
        });
        break;
      case 'gust':
        later(D * 0.7, function () { gustLine({ x: cx, y: cy }, { x: tx, y: ty }, col); });
        break;
      case 'blink':
        // tratado pelo evento 'teleport'; aqui só a partida
        break;
      case 'summonFx':
        later(D, function () {
          rings.push({ gx: tx, gy: ty, t: 0, dur: 0.65, col: col, maxR: 0.85, z: 2 });
          castCircles.push({ gx: tx, gy: ty, t: 0, dur: 0.6, col: col });
        });
        break;
      case 'poisonCloud':
        later(D, function () {
          clouds.push({ gx: tx, gy: ty, t: 0, dur: 1.3, col: '#8ad44a' });
          elemBurst(tx, ty, 'earth', 8, { col: '#8ad44a', speed: 1.4, size: 3 });
        });
        break;
      default:
        later(D, function () { impact(tx, ty, elem, 16, {}); });
    }
  }

  function spiral(gx, gy, col, up) {
    for (var i = 0; i < 14; i++) {
      var a = (i / 14) * Math.PI * 4;
      spawn({
        gx: gx + Math.cos(a) * 0.32, gy: gy + Math.sin(a) * 0.32,
        z: up ? 4 + i * 3 : 48 - i * 3,
        vx: -Math.sin(a) * 0.013, vy: Math.cos(a) * 0.013,
        vz: up ? 44 : -44,
        max: 0.7 + i * 0.03, size: 2.4, col: col, glow: true, drag: 1,
        shape: i % 3 === 0 ? 'star' : 'dot'
      });
    }
  }

  function gustLine(a, b, col) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (var i = 0; i < 16; i++) {
      var k = i / 16;
      spawn({
        gx: a.x + dx * k + (Math.random() - 0.5) * 0.4,
        gy: a.y + dy * k + (Math.random() - 0.5) * 0.4,
        z: 14 + Math.random() * 20,
        vx: (dx / len) * 0.14, vy: (dy / len) * 0.14, vz: 0,
        max: 0.4 + Math.random() * 0.25, size: 3, col: i % 3 ? col : '#ffffff',
        glow: true, drag: 0.97, shape: 'streak'
      });
    }
  }

  // ---------- camada de CHÃO (marcas + clarões no piso) ----------
  // O Renderer chama FX.drawGroundLayer(ctx) ANTES das unidades, para as
  // marcas ficarem SOB os personagens. Se ninguém chamar (páginas antigas),
  // updateAndDraw desenha como fallback por cima.
  var underDrawn = false;
  function updateGround(du) {
    var i;
    for (i = decals.length - 1; i >= 0; i--) {
      var dc = decals[i]; dc.t += du;
      if (dc.t > dc.dur) { decals.splice(i, 1); continue; }
    }
    for (i = glights.length - 1; i >= 0; i--) {
      glights[i].t += du;
      if (glights[i].t > glights[i].dur) glights.splice(i, 1);
    }
  }
  function decalAlpha(dc) {
    var k = dc.t / dc.dur;
    return k < 0.1 ? k / 0.1 : (k > 0.42 ? 1 - (k - 0.42) / 0.58 : 1);
  }
  function drawGround(ctx, du) {
    var i;
    for (i = 0; i < decals.length; i++) {
      var dc = decals[i];
      var da = decalAlpha(dc);
      if (da <= 0.01) continue;
      ctx.save();
      if (dc.add) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = da * (0.7 + Math.sin(dc.t * 5 + dc.seed) * 0.3);
      } else {
        ctx.globalAlpha = da * 0.92;
      }
      groundT(ctx, dc.gx, dc.gy, dc.r);
      ctx.drawImage(dc.cv, -1.09, -1.09, 2.18, 2.18);
      ctx.restore();
      decalLive(ctx, dc, da, du);
    }
    for (i = 0; i < glights.length; i++) {
      var gl = glights[i];
      var k = gl.t / gl.dur;
      var ga = Math.sin(Math.min(k * 1.15, 1) * Math.PI) * gl.a;
      drawGroundGlow(ctx, gl.gx, gl.gy, gl.r * (0.72 + k * 0.5), gl.col, ga);
    }
  }
  FX.drawGroundLayer = function (ctx) {
    drawGround(ctx, lastDu);
    underDrawn = true;
  };
  var lastDu = 0.016;

  // ---------- update + draw ----------
  FX.updateAndDraw = function (ctx, dt) {
    dt = Math.min(dt || 0.016, 0.05);
    // hit-stop: congela conteúdo, o cronômetro do freeze corre em tempo real
    var ts = freezeT > 0 ? 0.12 : 1;
    freezeT = Math.max(0, freezeT - dt);
    var du = dt * ts;
    lastDu = du;
    fxClock += dt;
    shakeT += dt;
    spawnAmbient(du);
    updateGround(du);
    if (!underDrawn) drawGround(ctx, du);
    underDrawn = false;

    var i, p, s0, s1, k;

    // atrasados
    for (i = delayedQ.length - 1; i >= 0; i--) {
      delayedQ[i].t -= dt;
      if (delayedQ[i].t <= 0) { var fn = delayedQ[i].fn; delayedQ.splice(i, 1); fn(); }
    }

    // círculos de conjuração no chão (anel duplo girando + riscos radiais)
    for (i = castCircles.length - 1; i >= 0; i--) {
      var cc = castCircles[i]; cc.t += du;
      if (cc.t > cc.dur) { castCircles.splice(i, 1); continue; }
      k = cc.t / cc.dur;
      var ca = Math.sin(Math.min(k * 1.25, 1) * Math.PI);
      var rot = cc.t * 4;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      // anel externo
      drawGroundRing(ctx, cc.gx, cc.gy, 0.52, rgba(cc.col, 0.75 * ca), 2.4, rot, 26);
      // anel interno tracejado (gira ao contrário)
      drawGroundRing(ctx, cc.gx, cc.gy, 0.34, rgba(cc.col, 0.55 * ca), 1.6, -rot * 1.4, 8);
      // riscos radiais
      for (var rr2 = 0; rr2 < 4; rr2++) {
        var aa = rot * 0.7 + rr2 * Math.PI / 2;
        var p1 = proj(cc.gx + Math.cos(aa) * 0.34, cc.gy + Math.sin(aa) * 0.34, 2);
        var p2 = proj(cc.gx + Math.cos(aa) * 0.5, cc.gy + Math.sin(aa) * 0.5, 2);
        ctx.strokeStyle = rgba(cc.col, 0.6 * ca); ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      }
      ctx.restore();
    }

    // carga no conjurador (glow crescente subindo)
    for (i = charges.length - 1; i >= 0; i--) {
      var ch = charges[i]; ch.t += du;
      if (ch.t > ch.dur) { charges.splice(i, 1); continue; }
      k = ch.t / ch.dur;
      var wpos = unitWorld(ch.uid);
      if (!wpos) continue;
      s0 = proj(wpos.x, wpos.y, 26);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      // brilho crescente denso + núcleo branco pulsando
      var rr = (12 + k * 32) * s0.s;
      var gg = ctx.createRadialGradient(s0.x, s0.y, 0, s0.x, s0.y, rr);
      gg.addColorStop(0, rgba(ch.col, 0.55 * (0.4 + k * 0.6)));
      gg.addColorStop(0.55, rgba(ch.col, 0.22 * (0.4 + k * 0.6)));
      gg.addColorStop(1, rgba(ch.col, 0));
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(s0.x, s0.y, rr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,' + (0.5 * k).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(s0.x, s0.y, (2 + k * 4) * s0.s, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // nuvens persistentes
    for (i = clouds.length - 1; i >= 0; i--) {
      var c = clouds[i]; c.t += du;
      if (c.t > c.dur) { clouds.splice(i, 1); continue; }
      var ca2 = Math.sin(Math.min(c.t / c.dur, 1) * Math.PI);
      for (var b2 = 0; b2 < 4; b2++) {
        var bx = c.gx + Math.sin(c.t * 3 + b2 * 2.1) * 0.3;
        var by = c.gy + Math.cos(c.t * 2.4 + b2 * 1.7) * 0.3;
        s0 = proj(bx, by, 10 + b2 * 8 + Math.sin(c.t * 5 + b2) * 4);
        ctx.fillStyle = rgba(c.col, 0.15 * ca2);
        ctx.beginPath(); ctx.arc(s0.x, s0.y, (15 + b2 * 5) * s0.s, 0, Math.PI * 2); ctx.fill();
      }
      // bolhas estourando
      if (Math.random() < 0.25) {
        spawn({
          gx: c.gx + (Math.random() - 0.5) * 0.8, gy: c.gy + (Math.random() - 0.5) * 0.8,
          z: 6, vz: 20, max: 0.5, size: 1.8, col: c.col, glow: true, shape: 'bubble', drag: 1
        });
      }
    }

    // anéis
    for (i = rings.length - 1; i >= 0; i--) {
      var r = rings[i]; r.t += du;
      if (r.t < 0) continue;
      if (r.t > r.dur) { rings.splice(i, 1); continue; }
      k = Math.max(r.t, 0) / r.dur;
      var rad = r.maxR * (r.hex ? Math.sin(k * Math.PI) : easeOut(k));
      var alpha = r.hex ? 0.7 : (1 - k) * 0.9;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(r.col, alpha);
      ctx.lineWidth = (r.w || (r.hex ? 2 : 3)) * (1 - k * 0.5) + 0.8;
      ctx.beginPath();
      var n = r.hex ? 6 : 26;
      for (var v = 0; v <= n; v++) {
        var a2 = (v / n) * Math.PI * 2;
        var s2 = proj(r.gx + Math.cos(a2) * rad, r.gy + Math.sin(a2) * rad, r.z == null ? 2 : r.z);
        if (v === 0) ctx.moveTo(s2.x, s2.y); else ctx.lineTo(s2.x, s2.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // flashes de impacto
    for (i = flashes.length - 1; i >= 0; i--) {
      var f2 = flashes[i]; f2.t += du;
      if (f2.t > f2.dur) { flashes.splice(i, 1); continue; }
      k = f2.t / f2.dur;
      s0 = proj(f2.gx, f2.gy, f2.z);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var fr = f2.r * (0.5 + k * 0.8) * s0.s;
      var fg = ctx.createRadialGradient(s0.x, s0.y, 0, s0.x, s0.y, fr);
      fg.addColorStop(0, rgba(f2.col, 0.85 * (1 - k)));
      fg.addColorStop(0.55, rgba(f2.col, 0.3 * (1 - k)));
      fg.addColorStop(1, rgba(f2.col, 0));
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(s0.x, s0.y, fr, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // projéteis: núcleo INCANDESCENTE 2x + halo pulsante + rastro de 10
    // segmentos com fade + luz projetada no chão + fagulhas caindo
    for (i = projectiles.length - 1; i >= 0; i--) {
      var pr = projectiles[i]; pr.t += du;
      k = Math.min(pr.t / pr.dur, 1);
      var ek = easeIn(k);
      var px = pr.a.x + (pr.b.x - pr.a.x) * ek;
      var py = pr.a.y + (pr.b.y - pr.a.y) * ek;
      var arc = Math.sin(ek * Math.PI) * (pr.arcH || 26);
      s0 = proj(px, py, 30 + arc);
      // luz do projétil viajando pelo CHÃO
      drawGroundGlow(ctx, px, py, 0.9, pr.col, 0.42);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      // rastro cônico longo (10 segmentos)
      for (var tr = 1; tr <= 10; tr++) {
        var kk = Math.max(ek - tr * 0.034, 0);
        var tx2 = pr.a.x + (pr.b.x - pr.a.x) * kk, ty2 = pr.a.y + (pr.b.y - pr.a.y) * kk;
        var tss = proj(tx2, ty2, 30 + Math.sin(kk * Math.PI) * (pr.arcH || 26));
        var trk = 1 - tr / 11;
        ctx.fillStyle = rgba(pr.col, 0.5 * trk);
        ctx.beginPath(); ctx.arc(tss.x, tss.y, Math.max(pr.size * (1.45 - tr * 0.12), 0.7) * s0.s, 0, Math.PI * 2); ctx.fill();
      }
      // halo PULSANTE
      var pulse = 1 + Math.sin(pr.t * 34) * 0.2;
      var hr = pr.size * 4 * pulse * s0.s;
      var hg = ctx.createRadialGradient(s0.x, s0.y, 0, s0.x, s0.y, hr);
      hg.addColorStop(0, rgba(pr.col, 0.8)); hg.addColorStop(0.5, rgba(pr.col, 0.3)); hg.addColorStop(1, rgba(pr.col, 0));
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(s0.x, s0.y, hr, 0, Math.PI * 2); ctx.fill();
      // coroa na cor do elemento + núcleo branco incandescente (2x)
      ctx.fillStyle = rgba(pr.col, 0.95);
      ctx.beginPath(); ctx.arc(s0.x, s0.y, pr.size * 1.9 * s0.s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(s0.x, s0.y, pr.size * 1.25 * s0.s, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // fagulhas DESPENCANDO do projétil
      if (Math.random() < 0.9) {
        spawn({
          gx: px, gy: py, z: 30 + arc,
          vx: (Math.random() - 0.5) * 0.012, vy: (Math.random() - 0.5) * 0.012,
          vz: -8 - Math.random() * 26,
          max: 0.4, size: 1.7, col: Math.random() < 0.3 ? '#ffffff' : pr.col,
          glow: true, drag: 0.95, shape: 'spark', grav: -420
        });
      }
      if (k >= 1) {
        impact(pr.b.x, pr.b.y, pr.element, 20, {});
        projectiles.splice(i, 1);
      }
    }

    // ARCOS DE GOLPE corpo a corpo (lâmina luminosa com rastro, 3-4 frames)
    for (i = slashes.length - 1; i >= 0; i--) {
      var sl = slashes[i]; sl.t += du;
      if (sl.t > sl.dur) { slashes.splice(i, 1); continue; }
      k = sl.t / sl.dur;
      var prog = easeOut(k);
      s0 = proj(sl.gx, sl.gy, sl.z);
      var rad = (30 + prog * 12) * s0.s;
      var aTip = sl.a0 + sl.sweep * prog;
      ctx.save();
      ctx.translate(s0.x, s0.y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      // rastro: 4 lâminas defasadas na cor do elemento
      for (var tb = 3; tb >= 0; tb--) {
        var lagA = sl.a0 + sl.sweep * Math.max(prog - tb * 0.16, 0);
        if (lagA <= sl.a0 + 0.02) continue;
        ctx.strokeStyle = rgba(sl.col, (1 - k) * (1 - tb * 0.21) * 0.9);
        ctx.lineWidth = Math.max((8 - tb * 1.6) * s0.s, 1);
        ctx.beginPath(); ctx.arc(0, 0, rad - tb * 2.6 * s0.s, sl.a0, lagA); ctx.stroke();
      }
      // gume branco na frente do arco
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.95 * (1 - k)).toFixed(3) + ')';
      ctx.lineWidth = 2.6 * s0.s;
      ctx.beginPath(); ctx.arc(0, 0, rad, Math.max(aTip - 0.55, sl.a0), aTip); ctx.stroke();
      // faísca na ponta
      var tipx = Math.cos(aTip) * rad, tipy = Math.sin(aTip) * rad;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * (1 - k)).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(tipx, tipy, 3 * s0.s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba(sl.col, 0.7 * (1 - k));
      ctx.beginPath(); ctx.arc(tipx, tipy, 5.4 * s0.s, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // feixes / cordas
    for (i = beams.length - 1; i >= 0; i--) {
      var bm = beams[i]; bm.t += du;
      if (bm.t > bm.dur) { beams.splice(i, 1); continue; }
      k = bm.t / bm.dur;
      var ba = Math.sin(Math.min(k * 1.4, 1) * Math.PI);
      s0 = proj(bm.a.x, bm.a.y, 34); s1 = proj(bm.b.x, bm.b.y, 26);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      if (bm.rope) {
        var mx = (s0.x + s1.x) / 2, my = (s0.y + s1.y) / 2 + 16 * (1 - k);
        ctx.strokeStyle = rgba(bm.col, 0.9 * ba); ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.quadraticCurveTo(mx, my, s1.x, s1.y); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,' + 0.5 * ba + ')'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.quadraticCurveTo(mx, my - 2, s1.x, s1.y); ctx.stroke();
        // gancho na ponta
        ctx.fillStyle = rgba(bm.col, ba);
        ctx.beginPath(); ctx.arc(s1.x, s1.y, 4.4, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.strokeStyle = rgba(bm.col, 0.22 * ba); ctx.lineWidth = 11;
        ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
        ctx.strokeStyle = rgba(bm.col, 0.85 * ba); ctx.lineWidth = 3.6;
        ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.85 * ba) + ')'; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
        // pulso viajando pelo feixe
        var pk = (k * 2) % 1;
        var ppx = s0.x + (s1.x - s0.x) * pk, ppy = s0.y + (s1.y - s0.y) * pk;
        ctx.fillStyle = 'rgba(255,255,255,' + 0.8 * ba + ')';
        ctx.beginPath(); ctx.arc(ppx, ppy, 3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // partículas do pool
    for (i = 0; i < POOL_N; i++) {
      p = pool[i];
      if (!p.on) continue;
      p.life += du;
      if (p.life >= p.max) { p.on = false; continue; }
      p.gx += p.vx * du * 60; p.gy += p.vy * du * 60;
      p.z += p.vz * du;
      p.vz += p.grav * du;
      p.vx *= p.drag; p.vy *= p.drag;
      p.rot += p.spin * du;
      if (p.z < 0) { p.z = 0; p.vz *= -0.4; }
      var lk = p.life / p.max;
      var a3 = lk < 0.7 ? 1 : 1 - (lk - 0.7) / 0.3;
      s0 = proj(p.gx, p.gy, p.z);
      var sz = (p.size + p.grow * lk) * s0.s;
      drawParticle(ctx, p, s0, sz, a3);
    }

    // NÚMEROS DE DANO — tipografia forte com pop, arco e fade
    for (i = floaters.length - 1; i >= 0; i--) {
      var f = floaters[i]; f.t += du;
      if (f.t > f.dur) { floaters.splice(i, 1); continue; }
      k = f.t / f.dur;
      var fa = k < 0.1 ? k / 0.1 : (k > 0.66 ? 1 - (k - 0.66) / 0.34 : 1);
      // pop com overshoot elástico
      var pop = k < 0.24 ? backOut(k / 0.24) : 1;
      // trajetória: sobe rápido e desacelera em arco lateral
      var rise = f.vy0 * k - 26 * k * k;
      s0 = proj(f.gx, f.gy, f.z + rise);
      var xoff = f.dx * easeOut(k);
      var fs = (f.big ? 34 : 22) * (f.xk || 1) * pop * Math.min(s0.s, 1.5);
      ctx.save();
      ctx.translate(s0.x + xoff, s0.y);
      // crítico/valor alto tem SHAKE próprio nos primeiros instantes
      if (f.big && k < 0.32) {
        var jm = (1 - k / 0.32) * 2.6;
        ctx.translate((Math.random() * 2 - 1) * jm, (Math.random() * 2 - 1) * jm);
      }
      if (f.big && k < 0.24) ctx.rotate((1 - k / 0.24) * -0.12);
      ctx.font = '900 ' + fs.toFixed(1) + 'px "Arial Black", "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = fa;
      // cura ganha cruz brilhante ao lado do número
      if (f.kind === 'heal') {
        var cxr = fs * 0.78, crw = fs * 0.3;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = fa * 0.9;
        ctx.strokeStyle = '#c8ffb0'; ctx.lineWidth = Math.max(fs * 0.14, 2.6); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-cxr - crw, 0); ctx.lineTo(-cxr + crw, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-cxr, -crw); ctx.lineTo(-cxr, crw); ctx.stroke();
        var hgl = ctx.createRadialGradient(-cxr, 0, 0, -cxr, 0, crw * 2.2);
        hgl.addColorStop(0, 'rgba(154,224,138,0.6)'); hgl.addColorStop(1, 'rgba(154,224,138,0)');
        ctx.fillStyle = hgl;
        ctx.beginPath(); ctx.arc(-cxr, 0, crw * 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      // sombra dura + contorno GROSSO
      ctx.fillStyle = 'rgba(8,6,4,0.8)';
      ctx.fillText(f.txt, 2.4, 2.8);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(10,8,6,0.95)'; ctx.lineWidth = Math.max(4, fs * 0.2);
      ctx.strokeText(f.txt, 0, 0);
      // corpo do número: gradiente branco→cor
      var tg = ctx.createLinearGradient(0, -fs * 0.5, 0, fs * 0.5);
      tg.addColorStop(0, '#ffffff');
      tg.addColorStop(0.45, f.col);
      tg.addColorStop(1, shade(f.col, -0.25));
      ctx.fillStyle = tg;
      ctx.fillText(f.txt, 0, 0);
      // brilho no crítico
      if (f.big && k < 0.4) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = fa * (1 - k / 0.4) * 0.6;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(f.txt, 0, 0);
      }
      ctx.restore();
    }
  };

  function drawGroundRing(ctx, gx, gy, rad, style, lw, rot, segs) {
    ctx.strokeStyle = style; ctx.lineWidth = lw;
    var n = segs || 26;
    for (var v = 0; v < n; v++) {
      var a0 = rot + (v / n) * Math.PI * 2;
      var a1 = rot + ((v + 0.62) / n) * Math.PI * 2;
      var p0 = proj(gx + Math.cos(a0) * rad, gy + Math.sin(a0) * rad, 2);
      var p1 = proj(gx + Math.cos(a1) * rad, gy + Math.sin(a1) * rad, 2);
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    }
  }

  function drawParticle(ctx, p, s0, sz, a3) {
    var col = p.col;
    switch (p.shape) {
      case 'smoke':
      case 'wisp':
        ctx.fillStyle = rgba(col, (p.shape === 'wisp' ? 0.4 : 0.3) * a3);
        ctx.beginPath(); ctx.arc(s0.x, s0.y, sz, 0, Math.PI * 2); ctx.fill();
        break;
      case 'bubble':
        ctx.strokeStyle = rgba(col, 0.5 * a3); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(s0.x, s0.y, sz, 0, Math.PI * 2); ctx.stroke();
        break;
      case 'drop':
        ctx.strokeStyle = rgba(col, 0.7 * a3); ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(s0.x, s0.y - 5 * (s0.s || 1)); ctx.lineTo(s0.x, s0.y); ctx.stroke();
        break;
      case 'shard':
        ctx.save(); ctx.translate(s0.x, s0.y); ctx.rotate(p.rot);
        ctx.fillStyle = rgba(col, 0.92 * a3);
        ctx.beginPath();
        ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.7, sz * 0.5); ctx.lineTo(-sz * 0.7, sz * 0.4);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = rgba('#ffffff', 0.25 * a3);
        ctx.beginPath(); ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.3, 0); ctx.lineTo(-sz * 0.3, 0);
        ctx.closePath(); ctx.fill();
        ctx.restore();
        break;
      case 'streak':
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(col, 0.6 * a3); ctx.lineWidth = Math.max(sz * 0.45, 0.8);
        ctx.lineCap = 'round';
        var s3 = proj(p.gx - p.vx * 5, p.gy - p.vy * 5, p.z + 3);
        ctx.beginPath(); ctx.moveTo(s3.x, s3.y); ctx.lineTo(s0.x, s0.y); ctx.stroke();
        ctx.restore();
        break;
      case 'flame': {
        var szq = Math.max(1, Math.round(sz * 2) / 2);
        var aq = Math.max(0.1, Math.round(a3 * 10) / 10);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.translate(s0.x, s0.y);
        ctx.fillStyle = memoG('F' + szq + '|' + col + '|' + (p.col2 || '') + '|' + aq, function () {
          var fg = (fgctx || ctx).createRadialGradient(0, 0, 0, 0, 0, szq * 1.6);
          fg.addColorStop(0, rgba(p.col2 || '#ffe9a0', 0.9 * aq));
          fg.addColorStop(0.5, rgba(col, 0.6 * aq));
          fg.addColorStop(1, rgba(col, 0));
          return fg;
        });
        ctx.beginPath();
        ctx.ellipse(0, 0, szq, szq * 1.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case 'spark':
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(col, 0.9 * a3); ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(s0.x, s0.y - p.vz * 0.012 - 2); ctx.lineTo(s0.x, s0.y); ctx.stroke();
        ctx.fillStyle = rgba(p.col2 || '#ffffff', 0.9 * a3);
        ctx.beginPath(); ctx.arc(s0.x, s0.y, Math.max(sz * 0.4, 0.8), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      case 'ray':
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(col, 0.7 * a3); ctx.lineWidth = sz * 0.5;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s0.x, s0.y - sz * 3); ctx.lineTo(s0.x, s0.y + sz * 1.4); ctx.stroke();
        ctx.restore();
        break;
      case 'star':
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(col, 0.9 * a3); ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.moveTo(s0.x - sz, s0.y); ctx.lineTo(s0.x + sz, s0.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s0.x, s0.y - sz); ctx.lineTo(s0.x, s0.y + sz); ctx.stroke();
        ctx.fillStyle = rgba('#ffffff', 0.9 * a3);
        ctx.beginPath(); ctx.arc(s0.x, s0.y, sz * 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      default:
        if (p.glow) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = rgba(col, 0.75 * a3);
          ctx.beginPath(); ctx.arc(s0.x, s0.y, sz, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = rgba(col, 0.2 * a3);
          ctx.beginPath(); ctx.arc(s0.x, s0.y, sz * 2.2, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        } else {
          ctx.fillStyle = rgba(col, 0.8 * a3);
          ctx.beginPath(); ctx.arc(s0.x, s0.y, sz, 0, Math.PI * 2); ctx.fill();
        }
    }
  }

  function easeOut(k) { return 1 - (1 - k) * (1 - k); }
  function easeIn(k) { return k * k * 0.6 + k * 0.4; }
  function backOut(k) { var c = 2.2; k = k - 1; return 1 + (c + 1) * k * k * k + c * k * k; }

  FX.reset = function () {
    for (var i = 0; i < POOL_N; i++) pool[i].on = false;
    projectiles.length = 0; beams.length = 0; rings.length = 0;
    clouds.length = 0; floaters.length = 0; flashes.length = 0;
    castCircles.length = 0; charges.length = 0; delayedQ.length = 0;
    slashes.length = 0; decals.length = 0; glights.length = 0;
    shakeT = shakeDur = shakeMag = 0; freezeT = 0;
    hitSyncUntil = 0; hitSyncExtra = 0; underDrawn = false;
  };

  JOGO.FX = FX;
})();
