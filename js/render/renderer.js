var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// JOGO.Renderer v3 — LUGAR fixo + personagens em DIREÇÕES DISCRETAS:
//   · Unidades em vistas desenhadas: 2 vistas (3/4 frontal/traseira)
//     espelhadas → 4 direções aparentes (SE/SW/NE/NW), cacheadas em offscreen
//     (Sprites.drawDir). Troca por SNAP com histerese + micro-crossfade ≤80ms.
//     Idle anima por transform (bob/sway/respiração) + partículas sobre o cache.
//   · CENÁRIO ATERRADO: o chão temático continua até as bordas da tela em
//     qualquer ângulo/zoom (aprons de mundo assados em textura), a grade de
//     combate ASSENTA sobre ele e o ambiente (colunas, pilares, chaminés…)
//     vive em coordenadas de MUNDO — girar a câmera = andar ao redor do campo.
//   · CÂMERA ANCORADA: pivô de órbita fixo no centro do tabuleiro; arrastar
//     gira/inclina, roda = zoom no pivô. O centro nunca deriva.
//   · Luz fixa no mundo, mas SUTIL: sombras + rim light trocam de lado sem
//     deformar os desenhos. Micro hit-stop vindo do FX (FX.getTimeScale).
//
//   Renderer.init(canvasEl) / render(dt) / handleEvent(ev) / isBusy()
//   Renderer.project(gx, gy, z) -> {x, y, d, s}
//   Renderer.unitWorld(uid) -> {x, y} | null
//   Renderer.setCamera({ang,tilt,zoom,cx,cy})   (páginas de teste)
// ============================================================================

(function () {
  var R = {};

  var canvas = null, ctx = null;
  var W = 0, H = 0, DPR = 1;

  var TILE = 46;
  var WALL_H = 34;
  var HOLE_D = 26;

  // luz FIXA no mundo (azimute) — nunca gira com a câmera
  var LIGHT_W = { x: -0.585, y: -0.811 };

  var cam = {
    ang: -0.62, tilt: 0.6, zoom: 1.15,
    cx: 6, cy: 6,
    tx: 6, ty: 6,
    fitZoom: 1.15
  };
  var shake = { x: 0, y: 0 };

  // uid -> {x,y,z, fdx,fdy, yaw, flash, knockX,knockY, deathK, popK, hideK,
  //         castK, lungeK, castTx, castTy}
  var vis = {};
  var animQ = [];
  var delayed = [];
  var lastAtk = null;        // origem do último cast (recuo direcional)
  var lastHitDelay = 0.26;   // atraso do feedback de dano (bolt = voo maior)
  var curTheme = null, curDungeonId = null;
  var curRoomKey = null;
  var aprons = null;            // texturas de chão em espaço de MUNDO (assadas)
  var bgProps = null;           // cenário de fundo ancorado no mundo
  var ANIM_WATCHDOG = 3.0;      // B2: nenhuma animação pode viver mais que isto

  // ---------- projeção ----------
  function heightF() { return 0.55 + (0.85 - cam.tilt) * 0.9; }
  function project(gx, gy, z) {
    var wx = gx - cam.cx, wy = gy - cam.cy;
    var ca = Math.cos(cam.ang), sa = Math.sin(cam.ang);
    var rx = wx * ca - wy * sa;
    var ry = wx * sa + wy * ca;
    var s = cam.zoom;
    return {
      x: W / 2 + shake.x + rx * TILE * s,
      y: H * 0.52 + shake.y + ry * TILE * cam.tilt * s - (z || 0) * heightF() * s,
      d: ry,
      s: s
    };
  }
  R.project = project;

  function unproject(mx, my) {
    var s = cam.zoom;
    var rx = (mx - W / 2 - shake.x) / (TILE * s);
    var ry = (my - H * 0.52 - shake.y) / (TILE * cam.tilt * s);
    var ca = Math.cos(cam.ang), sa = Math.sin(cam.ang);
    return {
      x: rx * ca + ry * sa + cam.cx,
      y: -rx * sa + ry * ca + cam.cy
    };
  }

  R.setCamera = function (o) {
    if (!o) return;
    if (o.ang != null) cam.ang = o.ang;
    if (o.tilt != null) cam.tilt = Math.max(0.35, Math.min(0.85, o.tilt));
    if (o.zoom != null) cam.zoom = Math.max(0.55, Math.min(2.4, o.zoom));
    if (o.cx != null) { cam.cx = cam.tx = o.cx; }
    if (o.cy != null) { cam.cy = cam.ty = o.cy; }
  };

  R.unitWorld = function (uid) {
    var v = vis[uid];
    if (v) return { x: v.x, y: v.y };
    var u = findUnit(uid);
    return u ? { x: u.x, y: u.y } : null;
  };

  // ---------- helpers ----------
  function game() { return JOGO.Game || null; }
  function engine() { return JOGO.Engine || null; }
  function state() { var g = game(); return (g && g.state) || null; }
  function findUnit(uid) {
    var st = state(); if (!st || !st.units) return null;
    for (var i = 0; i < st.units.length; i++) if (st.units[i].uid === uid) return st.units[i];
    return null;
  }
  function dungeonOf(st) {
    var D = JOGO.DATA; if (!D || !st) return null;
    for (var i = 0; i < D.dungeons.length; i++) if (D.dungeons[i].id === st.dungeonId) return D.dungeons[i];
    return null;
  }
  function hexRgba(c, a) {
    var r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  // yaw APARENTE: facing do mundo visto pela câmera (0 = de frente p/ câmera)
  function targetYaw(fdx, fdy) {
    var ca = Math.cos(cam.ang), sa = Math.sin(cam.ang);
    var rx = fdx * ca - fdy * sa;
    var ry = fdx * sa + fdy * ca;
    return Math.atan2(rx, ry);
  }
  // luz no espaço da tela (recalculada por frame)
  var lightScr = { x: -0.6, y: 0.4 };
  function updateLightScr() {
    var ca = Math.cos(cam.ang), sa = Math.sin(cam.ang);
    lightScr.x = LIGHT_W.x * ca - LIGHT_W.y * sa;
    lightScr.y = LIGHT_W.x * sa + LIGHT_W.y * ca;
  }
  function lightLX() {
    var v = lightScr.x * 1.7;
    return v < -1 ? -1 : (v > 1 ? 1 : v);
  }

  // ---------- caches de textura ----------
  var texCache = {};
  function tileTex(theme, kind, variant) {
    var key = 't|' + theme + '|' + kind + '|' + variant;
    var c = texCache[key];
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = 64;
      var g = c.getContext('2d');
      g.save(); g.scale(64, 64);
      if (JOGO.Sprites && JOGO.Sprites.tileTop) JOGO.Sprites.tileTop(g, theme, kind, variant + 1);
      else { g.fillStyle = '#333'; g.fillRect(0, 0, 1, 1); }
      g.restore();
      texCache[key] = c;
    }
    return c;
  }
  function wallTex(theme, face, variant, bLevel) {
    var key = 'w|' + theme + '|' + face + '|' + variant + '|' + bLevel;
    var c = texCache[key];
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = 64;
      var g = c.getContext('2d');
      g.save(); g.scale(64, 64);
      if (JOGO.Sprites && JOGO.Sprites.wallFace) JOGO.Sprites.wallFace(g, theme, face, variant + 1, bLevel * 0.14 - 0.2);
      else { g.fillStyle = '#222'; g.fillRect(0, 0, 1, 1); }
      g.restore();
      texCache[key] = c;
    }
    return c;
  }

  function drawQuadTex(tex, ox, oy, ux, uy, vx, vy, alpha) {
    ctx.save();
    if (alpha != null) ctx.globalAlpha *= alpha;
    ctx.setTransform(DPR * ux / 64, DPR * uy / 64, DPR * vx / 64, DPR * vy / 64, DPR * ox, DPR * oy);
    ctx.drawImage(tex, 0, 0);
    ctx.restore();
  }
  function quadPath(p0, p1, p2, p3) {
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
  }
  function tileCorners(x, y, z) {
    return [
      project(x - 0.5, y - 0.5, z), project(x + 0.5, y - 0.5, z),
      project(x + 0.5, y + 0.5, z), project(x - 0.5, y + 0.5, z)
    ];
  }

  // ---------- init & input ----------
  var mouse = { down: false, sx: 0, sy: 0, dragging: false, lx: 0, ly: 0 };

  // B5: hover/clique de tabuleiro não atravessam a HUD
  function overUI(e) {
    var t = e.target;
    return !!(t && t.closest && t.closest('#ui-root'));
  }

  R.init = function (canvasEl) {
    canvas = canvasEl;
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    function resize() {
      DPR = window.devicePixelRatio || 1;
      var r = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
      W = Math.max(r.width, 320); H = Math.max(r.height, 240);
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    }
    resize();
    window.addEventListener('resize', resize);

    canvas.addEventListener('mousedown', function (e) {
      mouse.down = true; mouse.dragging = false;
      mouse.sx = e.clientX; mouse.sy = e.clientY;
      mouse.lx = e.clientX; mouse.ly = e.clientY;
    });
    window.addEventListener('mousemove', function (e) {
      var rct = canvas.getBoundingClientRect();
      var mx = e.clientX - rct.left, my = e.clientY - rct.top;
      if (mouse.down) {
        var dx = e.clientX - mouse.sx, dy = e.clientY - mouse.sy;
        if (!mouse.dragging && dx * dx + dy * dy > 36) mouse.dragging = true;
        if (mouse.dragging) {
          cam.ang += (e.clientX - mouse.lx) * 0.0085;
          cam.tilt = Math.max(0.35, Math.min(0.85, cam.tilt + (e.clientY - mouse.ly) * 0.0042));
        }
        mouse.lx = e.clientX; mouse.ly = e.clientY;
      } else {
        var g = game();
        if (g && g.onTileHover) {
          if (overUI(e)) { g.onTileHover(-1, -1); return; }   // B5
          var w = unproject(mx, my);
          g.onTileHover(Math.round(w.x), Math.round(w.y));
        }
      }
    });
    window.addEventListener('mouseup', function (e) {
      if (!mouse.down) return;
      mouse.down = false;
      if (!mouse.dragging) {
        if (overUI(e)) { mouse.dragging = false; return; }    // B5
        var rct = canvas.getBoundingClientRect();
        var mx = e.clientX - rct.left, my = e.clientY - rct.top;
        var g = game();
        if (g && g.onTileClicked && !R.isBusy()) {
          var w = unproject(mx, my);
          g.onTileClicked(Math.round(w.x), Math.round(w.y));
        }
      }
      mouse.dragging = false;
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      cam.zoom = Math.max(0.55, Math.min(2.4, cam.zoom * Math.exp(-e.deltaY * 0.0011)));
    }, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  };

  // ---------- eventos (contrato) ----------
  R.handleEvent = function (ev) {
    if (!ev) return;
    var u, v;
    switch (ev.type) {
      case 'battleStart':
        vis = {}; animQ.length = 0; delayed.length = 0;
        lastAtk = null; lastHitDelay = 0.26;
        var st = ev.state || state();
        if (st && st.grid) {
          cam.tx = cam.cx = (st.grid.w - 1) / 2;
          cam.ty = cam.cy = (st.grid.h - 1) / 2;
          var span = Math.max(st.grid.w, st.grid.h);
          cam.fitZoom = Math.max(0.7, Math.min(1.5, (Math.min(W, H) * 1.15) / (span * TILE)));
          cam.zoom = cam.fitZoom;
          cam.ang = -0.62; cam.tilt = 0.6;
        }
        // facing inicial: cada unidade encara o inimigo mais próximo
        if (st && st.units) {
          for (var i2 = 0; i2 < st.units.length; i2++) initFacing(st, st.units[i2]);
        }
        // pré-assa as vistas discretas do elenco da sala (evita hitch no 1º frame)
        if (st && st.units && JOGO.Sprites && JOGO.Sprites.prewarmViews) {
          var dgW = dungeonOf(st);
          if (dgW && dgW.palette && JOGO.Sprites.setAccent) JOGO.Sprites.setAccent(dgW.palette.accent);
          var seen = {}, ids = [];
          for (var i3 = 0; i3 < st.units.length; i3++) {
            var did = st.units[i3].defId;
            if (!seen[did]) { seen[did] = 1; ids.push(did); }
          }
          JOGO.Sprites.prewarmViews(ids);
        }
        aprons = null; bgProps = null; curRoomKey = null;
        break;

      case 'turnStart':
        // câmera ANCORADA: o pivô fica no centro do tabuleiro — nada de
        // arrastar o mundo atrás da unidade ativa (o anel + HUD já indicam).
        break;

      case 'move':
        if (ev.path && ev.path.length) {
          animQ.push({ kind: 'move', uid: ev.uid, path: ev.path.slice(), k: 0, seg: 0, age: 0 });
        }
        break;

      case 'cast':
        animQ.push({ kind: 'cast', uid: ev.uid, tx: ev.x, ty: ev.y, t: 0, dur: 0.5, age: 0 });
        // memoriza a origem do golpe p/ recuo direcional do alvo
        u = findUnit(ev.uid);
        lastAtk = { x: u ? u.x : ev.x, y: u ? u.y : ev.y, age: 0 };
        // projéteis lentos (bolt) atrasam o feedback do dano até o voo acabar
        lastHitDelay = ev.fxKey === 'bolt' ? 0.5 : 0.26;
        break;

      case 'damage':
        (function (uid) {
          delayed.push({ t: animQ.length ? lastHitDelay : 0, fn: function () {
            var vv = getVis(uid);
            if (!vv) return;
            // TEMPO 1: flash branco segurado (frames congelados via hit-stop)
            vv.flash = 1;
            vv.flashHold = 0.055;
            // recuo NA DIREÇÃO OPOSTA ao atacante (se conhecido)
            if (lastAtk && lastAtk.age < 2) {
              var pa2 = project(lastAtk.x, lastAtk.y, 0);
              var pu2 = project(vv.x, vv.y, 0);
              var kdx = pu2.x - pa2.x, kdy = pu2.y - pa2.y;
              var kl = Math.sqrt(kdx * kdx + kdy * kdy) || 1;
              vv.knockX = (kdx / kl) * 8;
              vv.knockY = (kdy / kl) * 8 - 3;
            } else {
              vv.knockX = (Math.random() * 2 - 1) * 6;
              vv.knockY = -5;
            }
            // TEMPO 2: squash (achata ~15% e volta) junto com a explosão
            delayed.push({ t: 0.055, fn: function () {
              var v3 = getVis(uid);
              if (v3) v3.squashK = 0.0001;
            } });
          } });
        })(ev.uid);
        break;

      case 'death':
        (function (uid) {
          delayed.push({ t: animQ.length ? 0.32 : 0.05, fn: function () {
            var vv = getVis(uid);
            if (vv) vv.deathK = 0.0001;
          } });
        })(ev.uid);
        break;

      case 'pushed':
        animQ.push({
          kind: 'slide', uid: ev.uid,
          fx: ev.fromX, fy: ev.fromY, txx: ev.toX, tyy: ev.toY,
          t: 0, dur: 0.09 * (Math.abs(ev.toX - ev.fromX) + Math.abs(ev.toY - ev.fromY)) + 0.08,
          collision: ev.collision, age: 0
        });
        break;

      case 'teleport':
        animQ.push({ kind: 'teleport', uid: ev.uid, fx: ev.fromX, fy: ev.fromY, txx: ev.toX, tyy: ev.toY, t: 0, dur: 0.42, age: 0 });
        break;

      case 'summon':
        if (ev.unit) {
          v = getVisFor(ev.unit.uid, ev.unit.x, ev.unit.y);
          v.popK = 0.0001;
          var st2 = state();
          if (st2) initFacing(st2, ev.unit);
        }
        break;

      case 'battleEnd':
        // B2: nada pode segurar isBusy depois do fim da batalha
        animQ.length = 0; delayed.length = 0;
        break;
    }
  };

  function initFacing(st, u) {
    var v = getVisFor(u.uid, u.x, u.y);
    var best = null, bd = 1e9;
    for (var i = 0; i < st.units.length; i++) {
      var o = st.units[i];
      if (o.side === u.side || !o.alive) continue;
      var d = Math.abs(o.x - u.x) + Math.abs(o.y - u.y);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) {
      var dx = best.x - u.x, dy = best.y - u.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      v.fdx = dx / len; v.fdy = dy / len;
    } else { v.fdx = 0; v.fdy = 1; }
    v.dir = null;   // direção discreta será resolvida no próximo frame (sem fade)
  }

  R.isBusy = function () {
    if (animQ.length > 0 || delayed.length > 0) return true;
    for (var uid in vis) {
      if (vis[uid].deathK > 0 && vis[uid].deathK < 1) return true;
    }
    return false;
  };

  // atraso EXATO até o payload visual do golpe atual (0 se nada anima) —
  // o FX usa isto p/ sincronizar flash/burst/número com a investida/projétil,
  // sem se confundir com os próprios `delayed` de feedback do renderer.
  R.hitDelay = function () {
    return animQ.length ? lastHitDelay : 0;
  };

  function getVis(uid) {
    if (vis[uid]) return vis[uid];
    var u = findUnit(uid);
    if (!u) return null;
    return getVisFor(uid, u.x, u.y);
  }
  function getVisFor(uid, x, y) {
    if (!vis[uid]) {
      vis[uid] = {
        x: x, y: y, z: 0, fdx: 0, fdy: 1,
        dir: null, dirPrev: null, fadeK: 1,
        flash: 0, flashHold: 0, squashK: 0,
        knockX: 0, knockY: 0, deathK: 0, popK: 1, castK: 0,
        lungeK: 0, castTx: null, castTy: null
      };
    }
    return vis[uid];
  }

  // ---------- animações ----------
  function updateAnims(dt) {
    for (var i = delayed.length - 1; i >= 0; i--) {
      delayed[i].t -= dt;
      if (delayed[i].t <= 0) { var fn = delayed[i].fn; delayed.splice(i, 1); fn(); }
    }
    if (lastAtk) lastAtk.age += dt;
    for (var uid in vis) {
      var v = vis[uid];
      // flash "segurado" por alguns frames antes de decair (impacto tempo 1)
      if (v.flashHold > 0) v.flashHold -= dt;
      else v.flash = Math.max(0, v.flash - dt * 6);
      // squash: achata e volta (senoide em ~0.24s)
      if (v.squashK > 0) {
        v.squashK += dt / 0.24;
        if (v.squashK >= 1) v.squashK = 0;
      }
      v.knockX *= Math.pow(0.0001, dt); v.knockY *= Math.pow(0.0001, dt);
      if (v.deathK > 0 && v.deathK < 1) v.deathK = Math.min(1, v.deathK + dt / 0.55);
      if (v.popK < 1) v.popK = Math.min(1, v.popK + dt / 0.4);
      // direção DISCRETA: snap por quadrante com histerese + micro-crossfade
      if (JOGO.Sprites && JOGO.Sprites.dirStep) {
        var nd = JOGO.Sprites.dirStep(targetYaw(v.fdx, v.fdy), v.dir);
        if (v.dir == null) { v.dir = v.dirPrev = nd; v.fadeK = 1; }
        else if (nd !== v.dir) { v.dirPrev = v.dir; v.dir = nd; v.fadeK = 0; }
      }
      if (v.fadeK < 1) v.fadeK = Math.min(1, v.fadeK + dt / 0.07);
    }
    if (!animQ.length) return;
    var a = animQ[0], v2, done = false;
    a.age = (a.age || 0) + dt;
    if (a.age > ANIM_WATCHDOG) done = true;   // B2: watchdog
    switch (done ? 'skip' : a.kind) {
      case 'move':
        v2 = getVis(a.uid);
        if (!v2) { done = true; break; }
        var speed = 10;
        a.k += dt * speed;
        while (a.k >= 1 && a.seg < a.path.length) { a.k -= 1; a.seg++; }
        var from = a.seg === 0 ? { x: v2.startX != null ? v2.startX : v2.x, y: v2.startY != null ? v2.startY : v2.y } : a.path[a.seg - 1];
        if (a.seg === 0 && v2.startX == null) { v2.startX = v2.x; v2.startY = v2.y; from = { x: v2.x, y: v2.y }; }
        if (a.seg >= a.path.length) {
          var last = a.path[a.path.length - 1];
          v2.x = last.x; v2.y = last.y;
          v2.startX = v2.startY = null;
          v2.z = 0;
          done = true;
        } else {
          var to = a.path[a.seg];
          v2.x = from.x + (to.x - from.x) * a.k;
          v2.y = from.y + (to.y - from.y) * a.k;
          v2.z = Math.abs(Math.sin(a.k * Math.PI)) * 3;
          if (to.x !== from.x || to.y !== from.y) { v2.fdx = to.x - from.x; v2.fdy = to.y - from.y; }
        }
        break;
      case 'slide':
        v2 = getVis(a.uid);
        if (!v2) { done = true; break; }
        a.t += dt;
        var k = Math.min(a.t / a.dur, 1);
        var e = 1 - (1 - k) * (1 - k);
        v2.x = a.fx + (a.txx - a.fx) * e;
        v2.y = a.fy + (a.tyy - a.fy) * e;
        if (k >= 1) { v2.x = a.txx; v2.y = a.tyy; done = true; }
        break;
      case 'teleport':
        v2 = getVis(a.uid);
        if (!v2) { done = true; break; }
        a.t += dt;
        var k2 = a.t / a.dur;
        if (k2 < 0.5) {
          v2.x = a.fx; v2.y = a.fy;
          v2.hideK = k2 * 2;
        } else {
          v2.x = a.txx; v2.y = a.tyy;
          v2.hideK = 1 - (k2 - 0.5) * 2;
        }
        if (k2 >= 1) { v2.hideK = 0; done = true; }
        break;
      case 'cast':
        v2 = getVis(a.uid);
        a.t += dt;
        var ck = Math.min(a.t / a.dur, 1);
        if (v2) {
          v2.castK = 1 - ck;
          // investida em direção ao alvo na segunda metade
          v2.lungeK = ck > 0.52 ? Math.sin(Math.min((ck - 0.52) / 0.48, 1) * Math.PI) : 0;
          v2.castTx = a.tx; v2.castTy = a.ty;
          if (a.tx != null && (a.tx !== v2.x || a.ty !== v2.y)) {
            var ddx = a.tx - v2.x, ddy = a.ty - v2.y;
            var dl = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
            v2.fdx = ddx / dl; v2.fdy = ddy / dl;
          }
        }
        if (ck >= 1) { if (v2) { v2.castK = 0; v2.lungeK = 0; } done = true; }
        break;
      case 'skip':
        v2 = getVis(a.uid);
        if (v2) {
          // watchdog: encerra a animação no estado final correto
          var u2 = findUnit(a.uid);
          if (u2) { v2.x = u2.x; v2.y = u2.y; }
          v2.z = 0; v2.castK = 0; v2.lungeK = 0; v2.hideK = 0;
          v2.squashK = 0; v2.flashHold = 0;
          v2.startX = v2.startY = null;
        }
        done = true;
        break;
      default:
        done = true;
    }
    if (done) animQ.shift();
  }

  function syncVis(st) {
    var i, u;
    for (i = 0; i < st.units.length; i++) {
      u = st.units[i];
      if (!vis[u.uid]) {
        getVisFor(u.uid, u.x, u.y);
        initFacing(st, u);
      } else if (!animatingUid(u.uid)) {
        var v = vis[u.uid];
        if (Math.abs(v.x - u.x) > 0.001 || Math.abs(v.y - u.y) > 0.001) {
          v.x += (u.x - v.x) * 0.35; v.y += (u.y - v.y) * 0.35;
          if (Math.abs(v.x - u.x) < 0.02) { v.x = u.x; v.y = u.y; }
        }
        v.z = 0;
      }
    }
  }
  function animatingUid(uid) {
    for (var i = 0; i < animQ.length; i++) if (animQ[i].uid === uid) return true;
    return false;
  }

  // ---------- fundo (névoa além do chão) ----------
  var menuMotes = [];
  function themeFog(theme) {
    if (theme === 'cistern') return '#071018';
    if (theme === 'forge') return '#150806';
    if (theme === 'garden' || theme === 'greenhouse') return '#0a1008';
    return '#0c0e12';
  }
  function drawBackground(theme, dt) {
    // o CHÃO cobre a tela em batalha; isto é só a névoa que sobra ao longe
    ctx.fillStyle = themeFog(theme);
    ctx.fillRect(0, 0, W, H);
    var glow = theme === 'forge' ? 'rgba(255,110,50,0.05)'
      : theme === 'cistern' ? 'rgba(126,240,212,0.04)'
      : 'rgba(255,215,107,0.035)';
    var rg = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.1, W / 2, H * 0.55, H * 0.85);
    rg.addColorStop(0, glow); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  }

  // ---------- CHÃO ATERRADO: terreno contínuo em espaço de MUNDO ----------
  // Duas texturas assadas por sala giram JUNTO com o mundo (uma passada de
  // drawImage cada): apron PRÓXIMO nítido (5 células além da grade) e apron
  // DISTANTE que escurece até sumir na névoa. A grade assenta SOBRE esse chão.
  function hashK(s) {
    var h = 0; s = String(s);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function themePal(theme) {
    var S = JOGO.Sprites;
    return (S && S.themePalette) ? S.themePalette(theme)
      : { primary: '#5a5a6a', secondary: '#3a3a46', accent: '#d8d0c0', floor1: '#33333d', floor2: '#3a3a46', wall: '#26262e' };
  }
  // desenha uma textura ancorada no plano z=0 do mundo (projeção afim)
  function drawWorldTex(tex, x0, y0, x1, y1) {
    var p00 = project(x0, y0, 0), p10 = project(x1, y0, 0), p01 = project(x0, y1, 0);
    ctx.save();
    ctx.setTransform(
      DPR * (p10.x - p00.x) / tex.width, DPR * (p10.y - p00.y) / tex.width,
      DPR * (p01.x - p00.x) / tex.height, DPR * (p01.y - p00.y) / tex.height,
      DPR * p00.x, DPR * p00.y);
    ctx.drawImage(tex, 0, 0);
    ctx.restore();
  }
  // detalhe temático numa célula não-jogável do apron próximo
  function aprDetail(g, theme, pal, px, py, R, rnd) {
    var v = rnd(), cx2 = px + R * (0.2 + rnd() * 0.6), cy2 = py + R * (0.2 + rnd() * 0.6);
    g.save();
    if (theme === 'garden' || theme === 'greenhouse') {
      if (v < 0.3) {                       // musgo
        g.fillStyle = hexRgba('#4f7a38', 0.14 + rnd() * 0.12);
        g.beginPath(); g.ellipse(cx2, cy2, R * (0.16 + rnd() * 0.2), R * (0.12 + rnd() * 0.14), rnd() * 3, 0, Math.PI * 2); g.fill();
      } else if (v < 0.44) {               // folhas caídas
        g.fillStyle = hexRgba('#c9a24a', 0.14 + rnd() * 0.1);
        for (var i = 0; i < 3; i++) {
          g.beginPath(); g.ellipse(px + rnd() * R, py + rnd() * R, R * 0.05, R * 0.03, rnd() * 3, 0, Math.PI * 2); g.fill();
        }
      } else if (v < 0.52) {               // raiz atravessando
        g.strokeStyle = hexRgba('#3a2c18', 0.4); g.lineWidth = R * 0.05;
        g.beginPath(); g.moveTo(px, cy2);
        g.quadraticCurveTo(px + R * 0.5, cy2 + (rnd() - 0.5) * R * 0.5, px + R, cy2 + (rnd() - 0.5) * R * 0.4); g.stroke();
      }
    } else if (theme === 'cistern') {
      if (v < 0.26) {                      // poça rasa com brilho
        g.fillStyle = hexRgba('#7ef0d4', 0.05 + rnd() * 0.04);
        g.beginPath(); g.ellipse(cx2, cy2, R * (0.2 + rnd() * 0.16), R * (0.13 + rnd() * 0.1), 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = hexRgba('#7ef0d4', 0.1); g.lineWidth = 1;
        g.beginPath(); g.ellipse(cx2, cy2, R * 0.22, R * 0.14, 0, 0, Math.PI * 2); g.stroke();
      } else if (v < 0.4) {                // salitre
        g.fillStyle = hexRgba('#c8d8dc', 0.06 + rnd() * 0.05);
        g.beginPath(); g.ellipse(cx2, cy2, R * 0.18, R * 0.1, rnd() * 3, 0, Math.PI * 2); g.fill();
      }
    } else if (theme === 'forge') {
      if (v < 0.2) {                       // fissura de brasa respirando no ferro
        g.strokeStyle = hexRgba('#ff8a3c', 0.16 + rnd() * 0.14); g.lineWidth = R * 0.045;
        g.beginPath(); g.moveTo(px + R * 0.15, cy2);
        g.lineTo(px + R * 0.45, cy2 + (rnd() - 0.5) * R * 0.3);
        g.lineTo(px + R * 0.85, cy2 + (rnd() - 0.5) * R * 0.3); g.stroke();
      } else if (v < 0.38) {               // fuligem
        g.fillStyle = hexRgba('#000000', 0.2 + rnd() * 0.15);
        g.beginPath(); g.ellipse(cx2, cy2, R * (0.18 + rnd() * 0.16), R * 0.12, 0, 0, Math.PI * 2); g.fill();
      } else if (v < 0.48) {               // placa de ferro
        g.strokeStyle = hexRgba('#0a0605', 0.5); g.lineWidth = 2;
        g.strokeRect(px + R * 0.2, py + R * 0.25, R * 0.55, R * 0.45);
      }
    }
    g.restore();
  }
  function buildAprons(theme, st) {
    var S = JOGO.Sprites;
    var pal = themePal(theme);
    var fog = themeFog(theme);
    var w = st.grid.w, h = st.grid.h;
    var out = {};
    var srand = (S && S._srand) ? S._srand : function () { return Math.random; };
    var rnd = srand(hashK(theme) + w * 31 + h * 7);

    // -- apron PRÓXIMO: mesmas lajotas do tema, mais escuras/dessaturadas
    var M1 = 5, R1 = 44;
    var cv = document.createElement('canvas');
    cv.width = (w + M1 * 2) * R1; cv.height = (h + M1 * 2) * R1;
    var g = cv.getContext('2d');
    for (var gy = -M1; gy < h + M1; gy++) {
      for (var gx = -M1; gx < w + M1; gx++) {
        var px = (gx + M1) * R1, py = (gy + M1) * R1;
        var kind = ((gx + gy) % 2 === 0) ? 'floor1' : 'floor2';
        var tex = tileTex(theme, kind, ((gx * 31 + gy * 17) % 4 + 4) % 4);
        g.drawImage(tex, px, py, R1, R1);
        var inside = gx >= 0 && gy >= 0 && gx < w && gy < h;
        var ringD = inside ? 0 : Math.max(gx < 0 ? -gx : (gx - w + 1), gy < 0 ? -gy : (gy - h + 1), 1);
        var dark = inside ? 0.1 : Math.min(0.3 + ringD * 0.1, 0.64);
        g.fillStyle = 'rgba(0,0,0,' + dark + ')';
        g.fillRect(px, py, R1, R1);
        if (!inside) {
          g.fillStyle = hexRgba(fog, 0.1 + Math.min(ringD * 0.05, 0.2));
          g.fillRect(px, py, R1, R1);
          aprDetail(g, theme, pal, px, py, R1, rnd);
        }
      }
    }
    // sombra de contato + meio-fio: a grade ASSENTA no chão
    var gx0 = M1 * R1, gy0 = M1 * R1, gw2 = w * R1, gh2 = h * R1;
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = R1 * 0.85;
    g.strokeRect(gx0 - R1 * 0.42, gy0 - R1 * 0.42, gw2 + R1 * 0.84, gh2 + R1 * 0.84);
    g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = R1 * 0.4;
    g.strokeRect(gx0 - R1 * 0.2, gy0 - R1 * 0.2, gw2 + R1 * 0.4, gh2 + R1 * 0.4);
    g.strokeStyle = hexRgba(S && S.shade ? S.shade(pal.wall, 0.35) : '#6a6a72', 0.5);
    g.lineWidth = 3;
    g.strokeRect(gx0 - 1.5, gy0 - 1.5, gw2 + 3, gh2 + 3);
    out.near = { cv: cv, x0: -0.5 - M1, y0: -0.5 - M1, x1: w - 0.5 + M1, y1: h - 0.5 + M1 };

    // -- apron DISTANTE: terreno até a névoa (baixa resolução, uma passada)
    var M2 = 46, R2 = 10;
    var cv2 = document.createElement('canvas');
    cv2.width = (w + M2 * 2) * R2; cv2.height = (h + M2 * 2) * R2;
    var g2 = cv2.getContext('2d');
    var mixF = (S && S.mix) ? S.mix : function (c) { return c; };
    g2.fillStyle = mixF(pal.floor1, '#000000', 0.5);
    g2.fillRect(0, 0, cv2.width, cv2.height);
    var i2;
    for (i2 = 0; i2 < 480; i2++) {   // ruído de terreno
      var nx = rnd() * cv2.width, ny = rnd() * cv2.height;
      g2.fillStyle = i2 % 2
        ? hexRgba('#000000', 0.05 + rnd() * 0.06)
        : hexRgba(pal.floor2, 0.06 + rnd() * 0.06);
      g2.beginPath();
      g2.ellipse(nx, ny, R2 * (1 + rnd() * 3), R2 * (0.7 + rnd() * 2), rnd() * 3, 0, Math.PI * 2);
      g2.fill();
    }
    for (i2 = 0; i2 < 110; i2++) {   // decalques temáticos esparsos
      var dxp = rnd() * cv2.width, dyp = rnd() * cv2.height;
      if (theme === 'forge') {
        g2.strokeStyle = hexRgba('#ff8a3c', 0.05 + rnd() * 0.1);
        g2.lineWidth = 1 + rnd() * 1.5;
        g2.beginPath(); g2.moveTo(dxp, dyp);
        g2.lineTo(dxp + (rnd() - 0.5) * R2 * 5, dyp + (rnd() - 0.5) * R2 * 3); g2.stroke();
      } else if (theme === 'cistern') {
        g2.fillStyle = hexRgba('#7ef0d4', 0.025 + rnd() * 0.05);
        g2.beginPath(); g2.ellipse(dxp, dyp, R2 * (0.8 + rnd() * 2), R2 * (0.5 + rnd()), 0, 0, Math.PI * 2); g2.fill();
      } else {
        g2.fillStyle = hexRgba('#4f7a38', 0.05 + rnd() * 0.08);
        g2.beginPath(); g2.ellipse(dxp, dyp, R2 * (0.8 + rnd() * 2.4), R2 * (0.5 + rnd() * 1.4), rnd() * 3, 0, Math.PI * 2); g2.fill();
      }
    }
    // tinge com a névoa e escurece radialmente até quase preto
    g2.fillStyle = hexRgba(fog, 0.2);
    g2.fillRect(0, 0, cv2.width, cv2.height);
    var rg2 = g2.createRadialGradient(cv2.width / 2, cv2.height / 2, R2 * Math.max(w, h) * 0.7,
      cv2.width / 2, cv2.height / 2, cv2.width * 0.52);
    rg2.addColorStop(0, 'rgba(0,0,0,0)');
    rg2.addColorStop(0.55, hexRgba(fog, 0.45));
    rg2.addColorStop(1, 'rgba(2,3,4,0.92)');
    g2.fillStyle = rg2;
    g2.fillRect(0, 0, cv2.width, cv2.height);
    // borda externa derrete na névoa do fundo (sem “beira de ilha”)
    var er = g2.createRadialGradient(cv2.width / 2, cv2.height / 2, cv2.width * 0.4,
      cv2.width / 2, cv2.height / 2, cv2.width * 0.52);
    er.addColorStop(0, 'rgba(0,0,0,0)'); er.addColorStop(1, 'rgba(0,0,0,1)');
    g2.globalCompositeOperation = 'destination-out';
    g2.fillStyle = er;
    g2.fillRect(0, 0, cv2.width, cv2.height);
    out.far = { cv: cv2, x0: -0.5 - M2, y0: -0.5 - M2, x1: w - 0.5 + M2, y1: h - 0.5 + M2 };
    return out;
  }

  // ---------- AMBIENTE ANCORADO NO MUNDO (colunas, pilares, chaminés…) ----------
  function buildBgProps(theme, st) {
    var S = JOGO.Sprites;
    var srand = (S && S._srand) ? S._srand : null;
    if (!srand) return [];
    var rnd = srand(hashK(String(st.dungeonId) + '|' + st.roomIndex));
    var w = st.grid.w, h = st.grid.h;
    var cx = (w - 1) / 2, cy = (h - 1) / 2;
    var rad = Math.max(w, h) * 0.5;
    var list = [], i, a, d;
    for (i = 0; i < 12; i++) {           // anel próximo
      a = (i / 12) * Math.PI * 2 + rnd() * 0.45;
      d = rad + 2.6 + rnd() * 4.2;
      list.push({
        x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d,
        kind: i % 3, seed: i * 97 + (hashK(st.dungeonId) % 233),
        s: 0.8 + rnd() * 0.45, fogK: Math.min(0.2 + (d - rad - 2) / 8, 0.7)
      });
    }
    for (i = 0; i < 7; i++) {            // silhuetas distantes
      a = (i / 7) * Math.PI * 2 + 0.4 + rnd() * 0.5;
      d = rad + 8.5 + rnd() * 7;
      list.push({
        x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d,
        kind: i % 3, seed: i * 131 + 7,
        s: 1.05 + rnd() * 0.7, fogK: 0.84
      });
    }
    return list;
  }
  function drawBgProp(theme, pr, alpha) {
    var S = JOGO.Sprites;
    if (!S || !S.mix) return;
    var pal = themePal(theme);
    var fog = themeFog(theme);
    var mixF = S.mix, k = pr.fogK;
    var glowDot = S.__helpers && S.__helpers.glowDot;
    var body = mixF(pal.wall, fog, k);
    var edge = mixF(S.shade(pal.wall, 0.28), fog, k);
    var glowA = (1 - k) * alpha;
    var t = nowT + pr.seed * 0.37;
    var i;
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (theme === 'garden' || theme === 'greenhouse') {
      if (pr.kind === 0) {               // coluna de treliça com heras
        var Hh = 104 + (pr.seed % 5) * 9;
        ctx.fillStyle = body;
        ctx.fillRect(-9, -Hh, 7, Hh); ctx.fillRect(3, -Hh + 6, 7, Hh - 6);
        ctx.fillStyle = edge;
        for (i = 1; i < 5; i++) ctx.fillRect(-11, -Hh * i / 5, 23, 3);
        ctx.fillStyle = body;
        ctx.fillRect(-13, -Hh - 5, 27, 6);
        ctx.strokeStyle = hexRgba(mixF('#4f7a38', fog, k), 0.85); ctx.lineWidth = 2.4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-7, 0);
        ctx.quadraticCurveTo(-14, -Hh * 0.45, -4, -Hh * 0.8);
        ctx.quadraticCurveTo(4, -Hh * 0.95, 10, -Hh * 0.7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.quadraticCurveTo(14, -Hh * 0.3, 6, -Hh * 0.55); ctx.stroke();
        if (glowDot) glowDot(ctx, 6 + Math.sin(t * 0.9) * 5, -Hh * 0.6 + Math.sin(t * 1.4) * 6, 4, '#ffd76b', 0.5 * glowA);
      } else if (pr.kind === 1) {        // vaso gigante rachado com planta morta
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(-22, 0); ctx.quadraticCurveTo(-26, -22, -16, -34);
        ctx.lineTo(16, -34); ctx.quadraticCurveTo(26, -22, 22, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = edge; ctx.fillRect(-19, -38, 38, 5);
        ctx.strokeStyle = hexRgba('#0e0a06', 0.5 * (1 - k)); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(-2, -18); ctx.lineTo(-8, -30); ctx.stroke();
        ctx.strokeStyle = hexRgba(mixF('#3c5c2c', fog, k), 0.9); ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-4, -36); ctx.quadraticCurveTo(-14, -58, -6, -74); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(4, -36); ctx.quadraticCurveTo(16, -52, 10, -66); ctx.stroke();
      } else {                            // moita de samambaias altas
        ctx.strokeStyle = hexRgba(mixF('#4f7a38', fog, k), 0.9);
        ctx.lineWidth = 3; ctx.lineCap = 'round';
        for (i = -2; i <= 2; i++) {
          var sw2 = Math.sin(t * 0.7 + i) * 2;
          ctx.beginPath(); ctx.moveTo(i * 5, 0);
          ctx.quadraticCurveTo(i * 12 + sw2, -34 - Math.abs(i) * -6, i * 16 + sw2, -50 + Math.abs(i) * 7);
          ctx.stroke();
        }
        if (glowDot) glowDot(ctx, Math.sin(t * 0.8) * 8, -34, 3.4, '#9adcb8', 0.4 * glowA);
      }
    } else if (theme === 'cistern') {
      if (pr.kind === 0) {               // pilar de pedra negra com salitre
        var Hp = 128 + (pr.seed % 4) * 12;
        ctx.fillStyle = body;
        ctx.fillRect(-11, -Hp, 22, Hp);
        ctx.fillStyle = edge;
        ctx.fillRect(-14, -Hp - 6, 28, 7); ctx.fillRect(-13, -4, 26, 4);
        ctx.fillStyle = hexRgba(mixF('#c8d8dc', fog, k), 0.3);
        ctx.fillRect(-8, -Hp + 4, 4, Hp * 0.32);
        ctx.fillRect(2, -Hp + 10, 3, Hp * 0.2);
        ctx.strokeStyle = hexRgba('#0a1218', 0.5 * (1 - k)); ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(-11, -Hp * 0.55); ctx.lineTo(11, -Hp * 0.55); ctx.stroke();
        if (glowDot) glowDot(ctx, 0, -3, 14, '#7ef0d4', 0.22 * glowA * (0.7 + Math.sin(t * 1.3) * 0.3));
      } else if (pr.kind === 1) {        // arco quebrado
        ctx.fillStyle = body;
        ctx.fillRect(-24, -58, 13, 58); ctx.fillRect(11, -44, 13, 44);
        ctx.fillStyle = edge;
        ctx.beginPath(); ctx.moveTo(-26, -58); ctx.lineTo(-9, -58);
        ctx.lineTo(-2, -70); ctx.lineTo(-18, -72); ctx.closePath(); ctx.fill();
        ctx.fillStyle = hexRgba(mixF('#c8d8dc', fog, k), 0.22);
        ctx.fillRect(-21, -54, 3, 30);
      } else {                            // lampião submerso ainda aceso
        ctx.strokeStyle = body; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -74); ctx.stroke();
        ctx.fillStyle = edge;
        ctx.fillRect(-7, -92, 14, 20);
        ctx.fillStyle = hexRgba('#ffe9a0', 0.75 * (1 - k));
        ctx.fillRect(-4, -88, 8, 12);
        if (glowDot) glowDot(ctx, 0, -82, 18, '#7ef0d4', 0.5 * glowA * (0.75 + Math.sin(t * 2.1) * 0.25));
      }
    } else if (theme === 'forge') {
      if (pr.kind === 0) {               // chaminé de ferro com boca em brasa
        var Hc = 130 + (pr.seed % 5) * 10;
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(14, 0);
        ctx.lineTo(9, -Hc); ctx.lineTo(-9, -Hc); ctx.closePath(); ctx.fill();
        ctx.fillStyle = edge;
        for (i = 1; i < 4; i++) ctx.fillRect(-13 + i, -Hc * i / 4, 26 - i * 2, 3);
        ctx.fillRect(-11, -Hc - 5, 22, 6);
        ctx.fillStyle = hexRgba('#ff8a3c', 0.55 * (1 - k));
        ctx.fillRect(-6, -Hc - 3, 12, 3);
        if (glowDot) glowDot(ctx, 0, -Hc - 2, 15, '#ff9a3c', 0.55 * glowA * (0.7 + Math.sin(t * 2.6) * 0.3));
      } else if (pr.kind === 1) {        // bigorna-monumento fria
        ctx.fillStyle = edge;
        ctx.fillRect(-16, -14, 32, 14);
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(-20, -14); ctx.lineTo(20, -14); ctx.lineTo(30, -20); ctx.lineTo(26, -30);
        ctx.lineTo(17, -26); ctx.lineTo(-14, -26); ctx.lineTo(-24, -22); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = hexRgba('#ff8a3c', 0.2 * (1 - k)); ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(-8, -18); ctx.lineTo(2, -22); ctx.stroke();
      } else {                            // viga com correntes
        var Hv = 116 + (pr.seed % 4) * 10;
        ctx.fillStyle = body;
        ctx.fillRect(-5, -Hv, 10, Hv);
        ctx.fillRect(-26, -Hv, 52, 7);
        ctx.strokeStyle = edge; ctx.lineWidth = 2.6;
        for (i = -1; i <= 1; i += 2) {
          var chx = i * 17, swc = Math.sin(t * 0.8 + i) * 2;
          ctx.beginPath(); ctx.moveTo(chx, -Hv + 7);
          ctx.quadraticCurveTo(chx + swc, -Hv * 0.6, chx + swc * 1.6, -Hv * 0.35); ctx.stroke();
          ctx.beginPath(); ctx.arc(chx + swc * 1.6, -Hv * 0.35 + 4, 3.4, 0, Math.PI * 2); ctx.stroke();
        }
        if (glowDot) glowDot(ctx, 8, -6, 12, '#ff7a3c', 0.3 * glowA * (0.6 + Math.sin(t * 3.1) * 0.3));
      }
    }
    ctx.restore();
  }
  function drawVignette() {
    var g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function drawMenuBg(dt) {
    drawBackground(null, dt);
    if (menuMotes.length < 40 && Math.random() < 0.3) {
      menuMotes.push({ x: Math.random() * W, y: H + 10, vy: 8 + Math.random() * 16, s: 1 + Math.random() * 2, a: 0.15 + Math.random() * 0.3 });
    }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var i = menuMotes.length - 1; i >= 0; i--) {
      var m = menuMotes[i];
      m.y -= m.vy * dt; m.x += Math.sin(m.y * 0.01 + i) * 0.3;
      if (m.y < -10) { menuMotes.splice(i, 1); continue; }
      ctx.fillStyle = 'rgba(255,217,138,' + m.a + ')';
      ctx.beginPath(); ctx.arc(m.x, m.y, m.s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    drawVignette();
  }

  // ---------- overlays táticos ----------
  function overlayQuad(x, y, color, alpha, lift) {
    var c = tileCorners(x, y, lift || 1.5);
    quadPath(c[0], c[1], c[2], c[3]);
    ctx.fillStyle = hexRgba(color, alpha);
    ctx.fill();
  }
  function overlayEdge(x, y, color, alpha, lw) {
    var c = tileCorners(x, y, 1.5);
    quadPath(c[0], c[1], c[2], c[3]);
    ctx.strokeStyle = hexRgba(color, alpha); ctx.lineWidth = lw || 1.6;
    ctx.stroke();
  }

  function drawOverlays(st, dg) {
    var g = game(), en = engine();
    if (!g || !en || !st || st.phase !== 'playing') return;
    if (!(g.isPlayerTurn && g.isPlayerTurn())) return;
    if (R.isBusy()) return;
    var acc = (dg && dg.palette && dg.palette.accent) || '#ffd98a';
    var active = en.activeUnit ? en.activeUnit(st) : null;
    if (!active) return;
    var i;
    var hov = g.hoverTile;
    var spellId = g.selectedSpellId;

    if (!spellId) {
      var reach = null;
      try { reach = en.reachable ? en.reachable(st, active.uid) : null; } catch (e) { reach = null; }
      if (reach) {
        for (i = 0; i < reach.length; i++) {
          overlayQuad(reach[i].x, reach[i].y, '#8fd4a0', 0.15);
          overlayEdge(reach[i].x, reach[i].y, '#8fd4a0', 0.22);
        }
      }
      if (hov) {
        var path = null;
        try { path = en.path ? en.path(st, active.uid, hov.x, hov.y) : null; } catch (e2) { path = null; }
        if (path && path.length) {
          for (i = 0; i < path.length; i++) {
            overlayQuad(path[i].x, path[i].y, '#c8f0c0', 0.3);
            var p = project(path[i].x, path[i].y, 3);
            ctx.fillStyle = 'rgba(240,255,235,0.85)';
            ctx.beginPath(); ctx.arc(p.x, p.y, (i === path.length - 1 ? 5 : 3) * cam.zoom, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
    } else {
      var spell = JOGO.DATA && JOGO.DATA.spells && JOGO.DATA.spells[spellId];
      var elCol = spell && JOGO.Sprites && JOGO.Sprites.elements[spell.element] || '#ffd98a';
      var targets = null;
      try { targets = en.castTargets ? en.castTargets(st, active.uid, spellId) : null; } catch (e3) { targets = null; }
      var inTargets = false;
      if (targets) {
        for (i = 0; i < targets.length; i++) {
          overlayQuad(targets[i].x, targets[i].y, elCol, 0.18);
          overlayEdge(targets[i].x, targets[i].y, elCol, 0.4);
          if (hov && targets[i].x === hov.x && targets[i].y === hov.y) inTargets = true;
        }
      }
      // TELEGRAPH pulsante da área de efeito
      if (hov && inTargets) {
        var aoe = null;
        try { aoe = en.aoeTiles ? en.aoeTiles(st, spellId, active.x, active.y, hov.x, hov.y) : null; } catch (e4) { aoe = null; }
        if (aoe) {
          var pulse = 0.3 + Math.sin(nowT * 7) * 0.14;
          var edgeP = 0.55 + Math.sin(nowT * 7) * 0.3;
          for (i = 0; i < aoe.length; i++) {
            overlayQuad(aoe[i].x, aoe[i].y, '#ff7a4a', pulse);
            overlayEdge(aoe[i].x, aoe[i].y, '#ffb385', edgeP, 2.2);
            overlayEdge(aoe[i].x, aoe[i].y, elCol, 0.35 + Math.sin(nowT * 7 + 1.2) * 0.2, 1);
          }
          // círculo pulsante no epicentro
          var ep = project(hov.x, hov.y, 2);
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          var rr = (0.42 + Math.sin(nowT * 5) * 0.06);
          ctx.strokeStyle = hexRgba(elCol, 0.55); ctx.lineWidth = 2;
          ctx.beginPath();
          for (var v3 = 0; v3 <= 24; v3++) {
            var a4 = (v3 / 24) * Math.PI * 2;
            var pp = project(hov.x + Math.cos(a4) * rr, hov.y + Math.sin(a4) * rr, 2);
            if (v3 === 0) ctx.moveTo(pp.x, pp.y); else ctx.lineTo(pp.x, pp.y);
          }
          ctx.stroke(); ctx.restore();
        }
      }
    }
    if (hov && st.grid && hov.x >= 0 && hov.y >= 0 && hov.x < st.grid.w && hov.y < st.grid.h) {
      overlayEdge(hov.x, hov.y, acc, 0.85);
    }
  }

  // ---------- parede: prisma com LUZ FIXA NO MUNDO ----------
  function drawWall(theme, x, y, st, seed) {
    var wh = WALL_H;
    var b = tileCorners(x, y, 0);
    var tp = tileCorners(x, y, wh);
    var edges = [[0, 1, 0, -1], [1, 2, 1, 0], [2, 3, 0, 1], [3, 0, -1, 0]];
    var cx0 = project(x, y, 0);
    var i;
    for (i = 0; i < 4; i++) {
      var e = edges[i];
      var nx = x + e[2], ny = y + e[3];
      if (st && st.grid && ny >= 0 && ny < st.grid.h && nx >= 0 && nx < st.grid.w
        && st.grid.tiles[ny][nx].type === 'wall') continue;
      var m = project(x + e[2] * 0.5, y + e[3] * 0.5, 0);
      if (m.d <= cx0.d) continue;
      var p0 = b[e[0]], p1 = b[e[1]], p2 = tp[e[1]], p3 = tp[e[0]];
      // brilho pela NORMAL DA FACE NO MUNDO vs luz fixa — coerente ao girar
      var dotL = e[2] * LIGHT_W.x + e[3] * LIGHT_W.y;
      var lv = Math.max(0, Math.min(3, Math.round((dotL + 1) * 1.5)));
      var tex = wallTex(theme, 'side', (x * 7 + y * 13 + i) % 4, lv);
      drawQuadTex(tex, p0.x, p0.y, p1.x - p0.x, p1.y - p0.y, p3.x - p0.x, p3.y - p0.y);
      quadPath(p0, p1, p2, p3);
      var lg = ctx.createLinearGradient(0, p0.y, 0, p3.y);
      lg.addColorStop(0, 'rgba(0,0,0,0)');
      lg.addColorStop(1, 'rgba(0,0,0,0.42)');
      ctx.fillStyle = lg; ctx.fill();
      ctx.strokeStyle = 'rgba(8,5,3,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    }
    var texT = wallTex(theme, 'top', (x * 3 + y * 5) % 4, 2);
    drawQuadTex(texT, tp[0].x, tp[0].y, tp[1].x - tp[0].x, tp[1].y - tp[0].y, tp[3].x - tp[0].x, tp[3].y - tp[0].y);
    quadPath(tp[0], tp[1], tp[2], tp[3]);
    ctx.strokeStyle = 'rgba(8,5,3,0.6)'; ctx.lineWidth = 1.2; ctx.stroke();
    // aresta iluminada do topo no lado da luz (B3: legibilidade)
    var la = Math.atan2(-LIGHT_W.y, -LIGHT_W.x); // direção DE ONDE vem a luz
    for (i = 0; i < 4; i++) {
      var e2 = edges[i];
      var dotE = e2[2] * LIGHT_W.x + e2[3] * LIGHT_W.y;
      if (dotE < 0.35) continue;
      var q0 = tp[e2[0]], q1 = tp[e2[1]];
      ctx.strokeStyle = theme === 'forge' ? 'rgba(255,170,90,0.5)' : 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(q0.x, q0.y); ctx.lineTo(q1.x, q1.y); ctx.stroke();
    }
  }

  // ---------- buraco ----------
  function drawHole(theme, x, y, st) {
    var d = HOLE_D;
    var b = tileCorners(x, y, 0);
    var bt = tileCorners(x, y, -d);
    var cx0 = project(x, y, 0);
    var edges = [[0, 1, 0, -1], [1, 2, 1, 0], [2, 3, 0, 1], [3, 0, -1, 0]];
    var bcol = theme === 'cistern' ? '#04141e' : theme === 'forge' ? '#1c0802' : '#171008';
    // boca do buraco: cava o CHÃO (o apron passa por baixo — nada de vazio)
    quadPath(b[0], b[1], b[2], b[3]);
    ctx.fillStyle = bcol; ctx.fill();
    quadPath(bt[0], bt[1], bt[2], bt[3]);
    ctx.fillStyle = bcol; ctx.fill();
    if (theme === 'garden' || theme === 'greenhouse') {
      var rs = ((x * 73 + y * 37) % 5) - 2;
      ctx.strokeStyle = 'rgba(138,107,62,0.35)'; ctx.lineWidth = 1.2;
      var pr0 = project(x - 0.24, y + rs * 0.08, -d);
      var pr1 = project(x + 0.28, y - rs * 0.06, -d);
      ctx.beginPath(); ctx.moveTo(pr0.x, pr0.y);
      ctx.quadraticCurveTo((pr0.x + pr1.x) / 2, pr0.y + 4, pr1.x, pr1.y); ctx.stroke();
    }
    var p = project(x, y, -d);
    var rr = TILE * cam.zoom * 0.42;
    var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
    if (theme === 'forge') {
      g.addColorStop(0, 'rgba(255,140,60,' + (0.5 + Math.sin(nowT * 3 + x + y) * 0.15) + ')');
      g.addColorStop(1, 'rgba(255,80,20,0)');
    } else if (theme === 'cistern') {
      g.addColorStop(0, 'rgba(126,240,212,' + (0.22 + Math.sin(nowT * 2 + x * 2 + y) * 0.08) + ')');
      g.addColorStop(1, 'rgba(60,140,160,0)');
    } else {
      g.addColorStop(0, 'rgba(90,143,77,0.14)');
      g.addColorStop(1, 'rgba(40,60,30,0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, rr, rr * cam.tilt, 0, 0, Math.PI * 2); ctx.fill();
    if (theme === 'cistern') {
      ctx.strokeStyle = 'rgba(126,240,212,' + (0.25 + Math.sin(nowT * 2.4 + x) * 0.12) + ')';
      ctx.lineWidth = 1;
      var wr = rr * (0.4 + ((nowT * 0.3 + (x * 13 + y * 7) % 10 / 10) % 1) * 0.5);
      ctx.beginPath(); ctx.ellipse(p.x, p.y, wr, wr * cam.tilt, 0, 0, Math.PI * 2); ctx.stroke();
    }
    for (var i = 0; i < 4; i++) {
      var e = edges[i];
      var nx = x + e[2], ny = y + e[3];
      if (st && st.grid && ny >= 0 && ny < st.grid.h && nx >= 0 && nx < st.grid.w
        && st.grid.tiles[ny][nx].type === 'hole') continue;
      var m = project(x + e[2] * 0.5, y + e[3] * 0.5, 0);
      if (m.d > cx0.d) continue;
      var p0 = b[e[0]], p1 = b[e[1]], p2 = bt[e[1]], p3 = bt[e[0]];
      quadPath(p0, p1, p2, p3);
      var lg = ctx.createLinearGradient(0, p0.y, 0, p2.y);
      lg.addColorStop(0, 'rgba(6,4,2,0.92)');
      lg.addColorStop(1, theme === 'forge' ? 'rgba(120,40,10,0.55)' : 'rgba(10,14,16,0.4)');
      ctx.fillStyle = lg; ctx.fill();
    }
    quadPath(b[0], b[1], b[2], b[3]);
    ctx.strokeStyle = 'rgba(8,5,3,0.7)'; ctx.lineWidth = 1.4; ctx.stroke();
  }

  // ---------- unidades ----------
  function drawUnit(u, v, dg, st) {
    var acc = (dg && dg.palette && dg.palette.accent) || '#ffd98a';
    var p = project(v.x, v.y, (v.z || 0));
    var sc = cam.zoom * 0.92;
    var dying = v.deathK > 0;
    var alpha = 1;
    if (dying) alpha = 1 - v.deathK;
    if (v.hideK) alpha *= (1 - v.hideK);
    var isInvis = false;
    if (u.effects) {
      for (var i = 0; i < u.effects.length; i++) if (u.effects[i].type === 'invisible') isInvis = true;
    }
    if (isInvis) alpha *= u.side === 'player' ? 0.38 : 0.3;
    if (alpha <= 0.01) return;

    // SOMBRA fixa no mundo: alongada na direção oposta à luz
    var ps = project(v.x, v.y, 0);
    var sOff = 0.3;
    var psh = project(v.x - LIGHT_W.x * sOff, v.y - LIGHT_W.y * sOff, 0);
    var shAng = Math.atan2(psh.y - ps.y, psh.x - ps.x);
    var shLen = Math.sqrt((psh.x - ps.x) * (psh.x - ps.x) + (psh.y - ps.y) * (psh.y - ps.y));
    var baseR = TILE * 0.3 * cam.zoom * v.popK * (u.boss ? 1.7 : 1);
    ctx.save();
    ctx.globalAlpha = 0.38 * alpha;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(
      (ps.x + psh.x) / 2, (ps.y + psh.y) / 2,
      baseR + shLen * 0.55, baseR * cam.tilt * 0.9,
      shAng, 0, Math.PI * 2
    );
    ctx.fill();
    // núcleo de contato mais escuro sob os pés
    ctx.globalAlpha = 0.3 * alpha;
    ctx.beginPath();
    ctx.ellipse(ps.x, ps.y, baseR * 0.72, baseR * 0.62 * cam.tilt, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // anel do ativo
    var en = engine();
    var active = (en && en.activeUnit && st) ? en.activeUnit(st) : null;
    if (active && active.uid === u.uid && st.phase === 'playing') {
      ctx.save();
      var pulse = 0.55 + Math.sin(nowT * 4) * 0.2;
      ctx.strokeStyle = hexRgba(u.side === 'player' ? '#ffd98a' : '#ff6a4a', pulse);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(ps.x, ps.y, TILE * 0.42 * cam.zoom, TILE * 0.42 * cam.zoom * cam.tilt, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    // investida da conjuração: empurra o sprite na direção do alvo (na tela)
    if (v.lungeK > 0 && v.castTx != null) {
      var tp2 = project(v.castTx, v.castTy, 0);
      var ldx = tp2.x - p.x, ldy = tp2.y - p.y;
      var ll = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
      // avanço com STRETCH na direção do alvo
      ctx.translate((ldx / ll) * v.lungeK * 13 * cam.zoom, (ldy / ll) * v.lungeK * 13 * cam.zoom);
      ctx.scale(1 + v.lungeK * 0.08, 1 - v.lungeK * 0.06);
    }
    // squash de impacto: achata ~15% e volta (ancorado nos pés)
    if (v.squashK > 0) {
      var sq = Math.sin(Math.min(v.squashK, 1) * Math.PI);
      ctx.scale(1 + sq * 0.17, 1 - sq * 0.15);
    }
    if (dying) {
      ctx.translate(0, v.deathK * 6 * sc);
      ctx.scale(1 + v.deathK * 0.15, 1 - v.deathK * 0.5);
    }
    if (v.popK < 1) {
      var pk = v.popK;
      ctx.scale(0.4 + pk * 0.6, 1.6 - pk * 0.6);
    }
    ctx.translate((v.knockX || 0) * sc, (v.knockY || 0) * sc);
    ctx.scale(sc, sc);
    var SP = JOGO.Sprites;
    if (SP && SP.drawDir) {
      // idle por TRANSFORM sobre a vista cacheada (bob + sway + respiração)
      var spec = SP.idleSpec ? SP.idleSpec(u.defId) : { amp: 1.5, speed: 1.8, sway: 0.012, breath: 0.014 };
      var tu = nowT + (hashUid(u.uid) % 100) * 0.13;
      var ph2 = Math.sin(tu * spec.speed);
      ctx.translate(0, ph2 * spec.amp * 0.5 - spec.amp * 0.5);
      ctx.rotate(Math.sin(tu * spec.speed * 0.55) * spec.sway);
      ctx.scale(1 + ph2 * spec.breath * 0.35, 1 - ph2 * spec.breath);
      var dirCur = v.dir == null ? 0 : v.dir;
      var od = { t: tu, flash: v.flash, casting: v.castK, lightX: lightLX(), alpha: alpha };
      if (v.fadeK < 1 && v.dirPrev != null && v.dirPrev !== dirCur) {
        // micro-crossfade ≤80ms na troca de quadrante (nunca interpola forma)
        od.alpha = alpha * (1 - v.fadeK); od.overlay = false;
        SP.drawDir(ctx, u.defId, v.dirPrev, od);
        od.alpha = alpha * v.fadeK; od.overlay = true;
        SP.drawDir(ctx, u.defId, dirCur, od);
      } else {
        SP.drawDir(ctx, u.defId, dirCur, od);
      }
    } else if (SP && SP.draw) {
      SP.draw(ctx, u.defId, {
        t: nowT + (hashUid(u.uid) % 100) * 0.13,
        yaw: 0, lx: lightLX(), flash: v.flash, alpha: alpha,
        casting: v.castK, tintAccent: acc
      });
    }
    ctx.restore();

    if (!dying && u.hp < u.hpMax) {
      var bw = (u.boss ? 46 : 30) * cam.zoom;
      var top = project(v.x, v.y, (u.boss ? 132 : 76));
      var hpk = Math.max(u.hp / u.hpMax, 0);
      ctx.save();
      ctx.globalAlpha = 0.92 * alpha;
      ctx.fillStyle = 'rgba(10,8,10,0.75)';
      ctx.fillRect(top.x - bw / 2 - 1, top.y - 3, bw + 2, 5.5);
      ctx.fillStyle = hpk > 0.5 ? '#7ac26a' : hpk > 0.25 ? '#e0b04a' : '#e05a3c';
      ctx.fillRect(top.x - bw / 2, top.y - 2, bw * hpk, 3.5);
      if (u.shield > 0) {
        ctx.fillStyle = '#8ad4f0';
        var sk = Math.min(u.shield / u.hpMax, 1);
        ctx.fillRect(top.x - bw / 2, top.y - 5, bw * sk, 2);
      }
      ctx.restore();
    }
  }
  function hashUid(uid) {
    var h = 0, s = String(uid);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  // ---------- render principal ----------
  var nowT = 0;
  R.render = function (dt) {
    if (!ctx) return;
    dt = dt || 0.016;
    // micro HIT-STOP: o FX dita a escala do tempo visual
    var ts = (JOGO.FX && JOGO.FX.getTimeScale) ? JOGO.FX.getTimeScale() : 1;
    var dtv = dt * ts;
    nowT += dtv;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    var g = game();
    var st = state();
    var inBattle = st && (!g || !g.screen || g.screen === 'battle' || g.screen === 'roomClear' || g.screen === 'defeat' || g.screen === 'dungeonComplete');

    if (!st || !inBattle) {
      drawMenuBg(dt);
      if (JOGO.FX && JOGO.FX.updateAndDraw) JOGO.FX.updateAndDraw(ctx, dt);
      return;
    }

    var dg = dungeonOf(st);
    var theme = dg ? dg.theme : null;
    var roomKey = String(st.dungeonId) + '|' + st.roomIndex + '|' + st.grid.w + 'x' + st.grid.h;
    if (theme !== curTheme || st.dungeonId !== curDungeonId || roomKey !== curRoomKey) {
      curTheme = theme; curDungeonId = st.dungeonId; curRoomKey = roomKey;
      texCache = {}; aprons = null; bgProps = null;
      if (JOGO.FX && JOGO.FX.setAmbient) JOGO.FX.setAmbient(theme);
      if (JOGO.Sprites && JOGO.Sprites.setAccent && dg && dg.palette) JOGO.Sprites.setAccent(dg.palette.accent);
      if (st.grid && (cam.tx !== (st.grid.w - 1) / 2 || cam.ty !== (st.grid.h - 1) / 2)) {
        if (cam.cx === 6 && cam.cy === 6 && cam.tx === 6 && cam.ty === 6) {
          cam.tx = cam.cx = (st.grid.w - 1) / 2;
          cam.ty = cam.cy = (st.grid.h - 1) / 2;
        }
      }
    }

    var sh = (JOGO.FX && JOGO.FX.getShake) ? JOGO.FX.getShake() : { x: 0, y: 0 };
    shake.x = sh.x; shake.y = sh.y;

    // pivô ANCORADO: cx/cy só mudam em battleStart/setCamera — nada de deriva

    updateLightScr();
    updateAnims(dtv);
    if (st.units) syncVis(st);

    drawBackground(theme, dt);

    // CHÃO ATÉ AS BORDAS: aprons de terreno ancorados no mundo, sob a grade
    if (!aprons) aprons = buildAprons(theme, st);
    if (!bgProps) bgProps = buildBgProps(theme, st);
    drawWorldTex(aprons.far.cv, aprons.far.x0, aprons.far.y0, aprons.far.x1, aprons.far.y1);
    drawWorldTex(aprons.near.cv, aprons.near.x0, aprons.near.y0, aprons.near.x1, aprons.near.y1);

    var gw = st.grid.w, gh = st.grid.h;
    var x, y, tile;

    for (y = 0; y < gh; y++) {
      for (x = 0; x < gw; x++) {
        tile = st.grid.tiles[y][x];
        if (tile.type === 'wall') continue;
        if (tile.type === 'hole') { drawHole(theme, x, y, st); continue; }
        var kind = tile.deco ? 'deco' : (((x + y) % 2) ? 'floor2' : 'floor1');
        var variant = (x * 31 + y * 17) % 4;
        var c = tileCorners(x, y, 0);
        var tex = tileTex(theme, kind, variant);
        drawQuadTex(tex, c[0].x, c[0].y, c[1].x - c[0].x, c[1].y - c[0].y, c[3].x - c[0].x, c[3].y - c[0].y);
        quadPath(c[0], c[1], c[2], c[3]);
        ctx.strokeStyle = 'rgba(8,6,4,0.35)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }

    drawOverlays(st, dg);

    // marcas e clarões no PISO ficam SOB as unidades
    if (JOGO.FX && JOGO.FX.drawGroundLayer) JOGO.FX.drawGroundLayer(ctx);

    var items = [];
    for (y = 0; y < gh; y++) {
      for (x = 0; x < gw; x++) {
        tile = st.grid.tiles[y][x];
        if (tile.type === 'wall') {
          items.push({ d: project(x, y, 0).d, kind: 'wall', x: x, y: y });
        } else if (tile.deco && tile.type === 'floor') {
          items.push({ d: project(x, y, 0).d - 0.18, kind: 'prop', x: x, y: y });
        }
      }
    }
    // ambiente ancorado no MUNDO: entra no mesmo depth-sort; o que orbita para
    // o lado de cá da câmera esvanece para não tapar o combate
    if (bgProps && bgProps.length) {
      var fd = -1e9;
      var gcs = [[-0.5, -0.5], [gw - 0.5, -0.5], [gw - 0.5, gh - 0.5], [-0.5, gh - 0.5]];
      for (var c2 = 0; c2 < 4; c2++) {
        var pc = project(gcs[c2][0], gcs[c2][1], 0);
        if (pc.d > fd) fd = pc.d;
      }
      for (var bp = 0; bp < bgProps.length; bp++) {
        var pr = bgProps[bp];
        var pp2 = project(pr.x, pr.y, 0);
        if (pp2.x < -180 || pp2.x > W + 180 || pp2.y < -240 || pp2.y > H + 140) continue;
        var fade = 1 - Math.max(0, Math.min((pp2.d - fd - 0.2) / 1.6, 0.94));
        if (fade <= 0.07) continue;
        items.push({ d: pp2.d, kind: 'bg', pr: pr, px: pp2.x, py: pp2.y, fade: fade });
      }
    }
    if (st.units) {
      for (var i = 0; i < st.units.length; i++) {
        var u = st.units[i];
        var v = vis[u.uid];
        if (!v) continue;
        if (!u.alive && (!v.deathK || v.deathK >= 1)) continue;
        items.push({ d: project(v.x, v.y, 0).d + 0.001, kind: 'unit', u: u, v: v });
      }
    }
    items.sort(function (a, b) { return a.d - b.d; });
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      if (it.kind === 'wall') drawWall(theme, it.x, it.y, st, it.x * 7 + it.y);
      else if (it.kind === 'bg') {
        ctx.save();
        ctx.translate(it.px, it.py);
        ctx.scale(cam.zoom * it.pr.s, cam.zoom * it.pr.s);
        drawBgProp(theme, it.pr, it.fade);
        ctx.restore();
      }
      else if (it.kind === 'prop') {
        var pp = project(it.x, it.y, 0);
        ctx.save();
        ctx.translate(pp.x, pp.y);
        ctx.scale(cam.zoom, cam.zoom);
        if (JOGO.Sprites && JOGO.Sprites.prop) JOGO.Sprites.prop(ctx, theme, it.x * 13 + it.y * 29, nowT);
        ctx.restore();
      } else {
        drawUnit(it.u, it.v, dg, st);
      }
    }

    if (JOGO.FX && JOGO.FX.updateAndDraw) JOGO.FX.updateAndDraw(ctx, dt);

    drawVignette();
  };

  JOGO.Renderer = R;
})();
