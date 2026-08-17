var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// JOGO.FX — SOTERRA 2.0 · efeitos em PixiJS 7.  Dono: Agente Designer RENDER.
//
//   FX.handleEvent(ev)     contrato (docs/CONTRACT_V2.md §9)
//   FX.update(dt)          chamado pelo Renderer no fim de cada frame
//   FX.getShake() -> {x,y} lido pelo Renderer (aplicado ao contêiner `world`)
//   FX.getTimeScale()      micro hit-stop (o Renderer escala o dt visual)
//   FX.setAmbient(theme)   partículas ambientes por tema
//   FX.reset()             limpa tudo
//   FX._attach(ctx)        o Renderer entrega PIXI + camadas (uso interno)
//
// ARQUITETURA DE PARTÍCULAS
//   Um ÚNICO atlas 256×256 gerado em canvas 2D  →  uma base texture  →  duas
//   PIXI.ParticleContainer (uma aditiva, uma normal) com pool de sprites.
//   Isso mantém tudo num punhado de draw calls mesmo com centenas de partículas.
//
// PIPELINE DE UM FEITIÇO
//   'cast'   → círculo de conjuração + carga no conjurador (antecipação)
//            → payload do fxKey atrasado por Renderer.hitDelay() (voo do projétil)
//   'damage' → TEMPO 1 clarão + hit-stop · TEMPO 2 explosão com anel + número
//   'death'  → dissolução nas cores da unidade
//   'fusion' → aproximação · clarão · revelação (o momento mais especial)
// ============================================================================

(function () {
  var FX = {};
  var P = null, app = null, R = null;
  var decalC = null, addPC = null, normPC = null, topC = null, screenC = null;
  var attached = false;
  var queued = [];

  var parts = [], pool = [], projectiles = [], timers = [], decals = [], floaters = [], fpool = [];
  var ambientTheme = null, ambientT = 0;
  var shakeM = 0, shakeDur = 0, shakeT = 0, shakeOut = { x: 0, y: 0 };
  var freezeT = 0;
  var flashSpr = null, flashA = 0, flashCol = 0xffffff;
  var nowT = 0;
  var MAX_PARTS = 900;
  // escala do mundo: todos os tamanhos foram desenhados para um losango de 88px;
  // o Renderer manda a métrica real (hoje 128, a mesma do Art) e tudo acompanha.
  var SC = 1;

  // ---------- atlas ----------
  var A = {};   // nome -> PIXI.Texture
  function buildAtlas() {
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 192;
    var c = cv.getContext('2d');

    function soft(cx, cy, r, stops) {
      var g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
      for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
      c.fillStyle = g;
      c.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    // 0 dot (suave)
    soft(32, 32, 32, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
    // 1 hard (núcleo)
    soft(96, 32, 32, [[0, 'rgba(255,255,255,1)'], [0.62, 'rgba(255,255,255,0.92)'], [0.85, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
    // 2 ring
    c.save(); c.translate(160, 32);
    c.strokeStyle = 'rgba(255,255,255,1)'; c.lineWidth = 5;
    c.beginPath(); c.arc(0, 0, 24, 0, 6.2832); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 11;
    c.beginPath(); c.arc(0, 0, 24, 0, 6.2832); c.stroke();
    c.restore();
    // 3 star / flare
    c.save(); c.translate(224, 32);
    c.fillStyle = 'rgba(255,255,255,1)';
    c.beginPath();
    for (var i = 0; i < 4; i++) {
      var a = i * Math.PI / 2;
      c.moveTo(0, 0);
      c.lineTo(Math.cos(a - 0.16) * 30, Math.sin(a - 0.16) * 30);
      c.lineTo(Math.cos(a) * 30, Math.sin(a) * 30);
      c.lineTo(Math.cos(a + 0.16) * 30, Math.sin(a + 0.16) * 30);
    }
    c.fill();
    var gg = c.createRadialGradient(0, 0, 0, 0, 0, 14);
    gg.addColorStop(0, 'rgba(255,255,255,1)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gg; c.beginPath(); c.arc(0, 0, 14, 0, 6.2832); c.fill();
    c.restore();
    // 4 smoke
    c.save(); c.translate(32, 96);
    for (var s = 0; s < 5; s++) {
      var ang = s / 5 * 6.2832;
      soft(Math.cos(ang) * 9, Math.sin(ang) * 9, 22, [[0, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
    }
    c.restore();
    // 5 shard (lasca)
    c.save(); c.translate(96, 96);
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(0, -26); c.lineTo(15, 8); c.lineTo(0, 26); c.lineTo(-15, 6); c.closePath(); c.fill();
    c.restore();
    // 6 drop (gota)
    c.save(); c.translate(160, 96);
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(0, -26); c.quadraticCurveTo(16, 2, 0, 24); c.quadraticCurveTo(-16, 2, 0, -26); c.fill();
    c.restore();
    // 7 streak (rastro)
    c.save(); c.translate(224, 96);
    var lg = c.createLinearGradient(-30, 0, 30, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,1)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = lg; c.fillRect(-30, -5, 60, 10);
    c.restore();
    // 8 leaf/petal em (32,160)
    c.save(); c.translate(32, 160);
    c.fillStyle = '#ffffff';
    c.beginPath(); c.ellipse(0, 0, 20, 9, 0.6, 0, 6.2832); c.fill();
    c.restore();
    // 9 quadrado macio (poeira grossa) em (96,160)
    c.save(); c.translate(96, 160);
    soft(0, 0, 22, [[0, 'rgba(255,255,255,0.85)'], [0.6, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']]);
    c.restore();

    var base = P.Texture.from(cv).baseTexture;
    function sub(x, y, w, h) { return new P.Texture(base, new P.Rectangle(x, y, w, h)); }
    A.dot = sub(0, 0, 64, 64);
    A.hard = sub(64, 0, 64, 64);
    A.ring = sub(128, 0, 64, 64);
    A.star = sub(192, 0, 64, 64);
    A.smoke = sub(0, 64, 64, 64);
    A.shard = sub(64, 64, 64, 64);
    A.drop = sub(128, 64, 64, 64);
    A.streak = sub(192, 64, 64, 64);
    A.leaf = sub(0, 128, 64, 64);
    A.dust = sub(64, 128, 64, 64);
  }

  // ---------- assinaturas por elemento ----------
  var ELEM = {
    fogo: { a: '#ff7a3c', b: '#ffd76b', c: '#8a1e0a', tex: 'dot', bit: 'hard', up: -46, spin: 0, wob: 0.9, head: 'dot', trail: 'hard' },
    agua: { a: '#4fb8f0', b: '#bff0ff', c: '#0a3a5a', tex: 'drop', bit: 'drop', up: 10, spin: 2, wob: 1.6, head: 'hard', trail: 'drop' },
    terra: { a: '#8fc056', b: '#d8c07a', c: '#4a3a1e', tex: 'shard', bit: 'shard', up: 60, spin: 7, wob: 0.2, head: 'shard', trail: 'dust' },
    ar: { a: '#cfe4ff', b: '#ffffff', c: '#5a7a90', tex: 'streak', bit: 'hard', up: -18, spin: 4, wob: 2.4, head: 'star', trail: 'streak' },
    neutro: { a: '#d9d2c2', b: '#fff4dc', c: '#4a453c', tex: 'hard', bit: 'hard', up: -14, spin: 1, wob: 0.6, head: 'hard', trail: 'hard' }
  };
  function elemOf(e) { return ELEM[e] || ELEM.neutro; }
  function hexInt(c) {
    if (typeof c === 'number') return c;
    if (typeof c !== 'string') return 0xffffff;
    var s = c.charAt(0) === '#' ? c.slice(1) : c;
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    return isNaN(n) ? 0xffffff : n;
  }

  // ---------- ligação com o Renderer ----------
  FX._attach = function (ctx) {
    if (attached) return;
    P = ctx.PIXI; app = ctx.app; R = ctx.renderer;
    SC = (R && R.TILE_W) ? (R.TILE_W / 88) : 1;
    buildAtlas();
    decalC = new P.Container();
    ctx.decal.addChild(decalC);
    normPC = new P.ParticleContainer(MAX_PARTS, { scale: true, position: true, rotation: true, tint: true, alpha: true });
    addPC = new P.ParticleContainer(MAX_PARTS, { scale: true, position: true, rotation: true, tint: true, alpha: true });
    addPC.blendMode = P.BLEND_MODES.ADD;
    ctx.fx.addChild(normPC, addPC);
    topC = new P.Container();
    ctx.top.addChild(topC);
    // clarão de tela (fusão, impactos pesados) — espaço de TELA
    screenC = new P.Container();
    ctx.weather.addChild(screenC);
    flashSpr = new P.Graphics();
    flashSpr.beginFill(0xffffff).drawRect(0, 0, 4096, 4096).endFill();
    flashSpr.alpha = 0;
    flashSpr.blendMode = P.BLEND_MODES.ADD;
    screenC.addChild(flashSpr);
    attached = true;
    if (queued.length) { var q = queued.slice(); queued.length = 0; for (var i = 0; i < q.length; i++) FX.handleEvent(q[i]); }
  };

  // ATENÇÃO: `z` chega na métrica de referência (losango 88) e é convertido aqui.
  function world(gx, gy, z) {
    var zz = (z || 0) * SC;
    if (R && R.iso) return R.iso(gx, gy, zz);
    return { x: (gx - gy) * 44, y: (gx + gy) * 22 - zz };
  }
  function unitPos(uid) {
    if (R && R.unitWorld) { var w = R.unitWorld(uid); if (w) return w; }
    var st = JOGO.Game && JOGO.Game.state;
    if (st && st.units) for (var i = 0; i < st.units.length; i++) if (st.units[i].uid === uid) return { x: st.units[i].x, y: st.units[i].y };
    return null;
  }
  function unitOf(uid) {
    var st = JOGO.Game && JOGO.Game.state;
    if (st && st.units) for (var i = 0; i < st.units.length; i++) if (st.units[i].uid === uid) return st.units[i];
    return null;
  }
  function unitH(uid) { return (R && R.unitHeight) ? R.unitHeight(uid) : 70; }
  function palOf(uid) {
    var u = unitOf(uid);
    var D = JOGO.DATA || {};
    var id = u ? u.defId : '';
    var p = (D.classes && D.classes[id] && D.classes[id].palette) ||
      (D.monsters && D.monsters[id] && D.monsters[id].palette) || null;
    if (p) return p;
    return { primary: '#c8b89a', secondary: '#6a5a48', accent: '#ffd98a' };
  }
  function elementOfUnit(uid) {
    var u = unitOf(uid);
    if (!u) return 'neutro';
    if (u.element) return u.element;
    var D = JOGO.DATA || {};
    var m = D.monsters && D.monsters[u.defId];
    return (m && m.element) || 'neutro';
  }

  // ---------- pool de partículas ----------
  function take(texName, additive) {
    var s = pool.pop();
    if (!s) { s = new P.Sprite(A[texName]); s.anchor.set(0.5); }
    else s.texture = A[texName];
    s.alpha = 1; s.rotation = 0; s.tint = 0xffffff; s.scale.set(1);
    (additive ? addPC : normPC).addChild(s);
    return s;
  }
  function give(s) {
    if (s.parent) s.parent.removeChild(s);
    if (pool.length < 600) pool.push(s);
    else s.destroy();
  }
  function spawn(o) {
    if (parts.length >= MAX_PARTS - 8) return null;
    var add = o.add !== false;
    var s = take(o.tex || 'hard', add);
    var p = {
      s: s, add: add, x: o.x, y: o.y, z: o.z || 0,
      vx: (o.vx || 0) * SC, vy: (o.vy || 0) * SC, vz: o.vz || 0,
      g: (o.g == null ? 0 : o.g) * SC, drag: o.drag == null ? 0.06 : o.drag,
      life: o.life || 0.6, age: 0,
      s0: (o.s0 == null ? 12 : o.s0) * SC, s1: (o.s1 == null ? 0 : o.s1) * SC,
      a0: o.a0 == null ? 1 : o.a0, a1: o.a1 == null ? 0 : o.a1,
      rot: o.rot || 0, spin: o.spin || 0, tint: hexInt(o.tint || '#ffffff'),
      tint1: o.tint1 != null ? hexInt(o.tint1) : null,
      grow: o.grow || null, aim: o.aim || false
    };
    s.tint = p.tint;
    s.rotation = p.rot;
    parts.push(p);
    return p;
  }
  function lerpTint(a, b, k) {
    var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    var br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * k) << 16) | (Math.round(ag + (bg - ag) * k) << 8) | Math.round(ab + (bb - ab) * k);
  }

  // ---------- primitivas visuais ----------
  function burst(gx, gy, element, n, opt) {
    opt = opt || {};
    var E = elemOf(element);
    var base = world(gx, gy, opt.z == null ? 22 : opt.z);
    var power = opt.power || 1;
    for (var i = 0; i < n; i++) {
      var a = (opt.dir != null ? opt.dir + (Math.random() - 0.5) * (opt.spread || 1.6) : Math.random() * 6.2832);
      var sp = (opt.speed || 90) * (0.35 + Math.random()) * power;
      spawn({
        tex: Math.random() < 0.6 ? E.tex : E.bit,
        x: base.x + (Math.random() - 0.5) * 8, y: base.y + (Math.random() - 0.5) * 6,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.55 - (E.up * 0.3),
        g: E.up > 0 ? 190 : -30,
        life: (opt.life || 0.55) * (0.7 + Math.random() * 0.7),
        s0: (opt.size || 15) * (0.5 + Math.random() * 0.9) * power,
        s1: (opt.size || 15) * 0.1,
        tint: E.b, tint1: E.a,
        spin: (Math.random() - 0.5) * E.spin * 2,
        rot: Math.random() * 6.28,
        add: opt.add !== false
      });
    }
  }
  function ring(gx, gy, col, r0, r1, dur, z, lw) {
    var w = world(gx, gy, z == null ? 6 : z);
    var p = spawn({
      tex: 'ring', x: w.x, y: w.y, life: dur || 0.42,
      s0: r0 || 12, s1: r1 || 90, a0: 0.95, a1: 0, tint: col, add: true, drag: 0
    });
    if (p) p.flat = true;    // achata no eixo Y (anel deitado no chão isométrico)
    return p;
  }
  function flare(gx, gy, col, size, dur, z) {
    var w = world(gx, gy, z == null ? 24 : z);
    spawn({ tex: 'star', x: w.x, y: w.y, life: dur || 0.3, s0: size || 60, s1: (size || 60) * 0.2, a0: 1, a1: 0, tint: col, add: true, spin: 1.2, drag: 0 });
    spawn({ tex: 'dot', x: w.x, y: w.y, life: (dur || 0.3) * 1.3, s0: (size || 60) * 0.8, s1: 2, a0: 0.9, a1: 0, tint: col, add: true, drag: 0 });
  }
  function smokePuff(gx, gy, n, col, z) {
    var w = world(gx, gy, z == null ? 12 : z);
    for (var i = 0; i < n; i++) {
      spawn({
        tex: 'smoke', x: w.x + (Math.random() - 0.5) * 16, y: w.y + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 40, vy: -14 - Math.random() * 26,
        life: 0.7 + Math.random() * 0.5, s0: 16 + Math.random() * 12, s1: 44 + Math.random() * 26,
        a0: 0.34, a1: 0, tint: col || '#6a6055', add: false, drag: 0.5
      });
    }
  }

  // impacto em 2 TEMPOS: clarão curto (com hit-stop) → explosão com anel
  function impact(gx, gy, element, power, opt) {
    opt = opt || {};
    var E = elemOf(element);
    var pw = Math.max(0.55, Math.min(2.2, power || 1));
    // TEMPO 1 — clarão branco + hit-stop
    flare(gx, gy, '#ffffff', 46 * pw, 0.14, 22);
    if (pw > 1.05) hitStop(0.055 * Math.min(pw, 1.8));
    addShake(4.5 * pw, 0.24);
    // TEMPO 2 — explosão + anel + fumaça (2 quadros depois)
    later(0.055, function () {
      burst(gx, gy, element, Math.round(16 + 16 * pw), { speed: 120 * pw, size: 16 * pw, life: 0.5, power: pw });
      ring(gx, gy, E.b, 14, 78 * pw, 0.40, 6);
      ring(gx, gy, E.a, 8, 52 * pw, 0.30, 10);
      flare(gx, gy, E.b, 54 * pw, 0.24, 20);
      if (element === 'terra' || element === 'neutro') smokePuff(gx, gy, 3, '#6a5a44');
      if (element === 'fogo') smokePuff(gx, gy, 3, '#4a2a1c');
      spawnDecal(gx, gy, element, pw);
    });
  }

  // ---------- marcas temporárias no chão ----------
  function spawnDecal(gx, gy, element, power) {
    if (decals.length > 14) { var old = decals.shift(); old.g.destroy(); }
    var E = elemOf(element);
    var g = new P.Graphics();
    var w = world(gx, gy, 0);
    var rnd = Math.random;
    var r = 26 * SC * (0.8 + (power || 1) * 0.35);
    g.position.set(w.x, w.y);
    if (element === 'fogo') {
      g.beginFill(0x1a0c06, 0.55); g.drawEllipse(0, 0, r, r * 0.5); g.endFill();
      g.beginFill(hexInt(E.a), 0.35);
      for (var i = 0; i < 6; i++) g.drawEllipse((rnd() - 0.5) * r, (rnd() - 0.5) * r * 0.5, 3 + rnd() * 4, 2 + rnd() * 2);
      g.endFill();
    } else if (element === 'agua') {
      g.beginFill(hexInt(E.c), 0.42); g.drawEllipse(0, 0, r, r * 0.5); g.endFill();
      g.lineStyle(1.6, hexInt(E.b), 0.5); g.drawEllipse(0, 0, r * 0.7, r * 0.35);
    } else if (element === 'terra') {
      g.lineStyle(2.4, 0x2a2014, 0.65);
      for (var k = 0; k < 5; k++) {
        var a = rnd() * 6.28;
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.5);
      }
      g.lineStyle(0);
      g.beginFill(hexInt(E.a), 0.22); g.drawEllipse(0, 0, r * 0.6, r * 0.3); g.endFill();
    } else if (element === 'ar') {
      g.lineStyle(2, hexInt(E.a), 0.42);
      for (var s = 0; s < 3; s++) {
        g.drawEllipse(0, 0, r * (0.4 + s * 0.3), r * (0.2 + s * 0.15));
      }
    } else {
      g.beginFill(0x201c18, 0.4); g.drawEllipse(0, 0, r * 0.8, r * 0.4); g.endFill();
    }
    decalC.addChild(g);
    decals.push({ g: g, age: 0, life: 3.2 });
  }

  // ---------- números / rótulos ----------
  function floater(gx, gy, txt, col, big, kind) {
    var t = fpool.pop();
    var size = big ? 30 : 20;
    if (!t) {
      t = new P.Text('', {
        fontFamily: 'Trebuchet MS, Verdana, Arial, sans-serif',
        fontSize: 32, fontWeight: '900', fill: 0xffffff,
        stroke: 0x140c12, strokeThickness: 6, lineJoin: 'round'
      });
      t.anchor.set(0.5, 1);
      t.resolution = Math.min(2, window.devicePixelRatio || 1);
    }
    t.text = String(txt);
    t.style.fontSize = 32;
    t.style.fill = hexInt(col);
    t.style.strokeThickness = big ? 7 : 5;
    t.alpha = 1;
    t.visible = true;
    topC.addChild(t);
    var w = world(gx, gy, unitTop(gx, gy));
    var f = {
      t: t, x: w.x + (Math.random() - 0.5) * 12, y: w.y, age: 0, life: big ? 1.15 : 0.95,
      vy: (-46 - (big ? 16 : 0)) * SC, base: size / 32, kind: kind || 'dmg', pop: 0
    };
    floaters.push(f);
    return f;
  }
  function unitTop() { return 78; }   // em métrica de referência: world() escala

  // ---------- shake / hit-stop / timers ----------
  function addShake(mag, dur) {
    shakeM = Math.max(shakeM, mag);
    shakeDur = Math.max(shakeDur, dur || 0.25);
    shakeT = shakeDur;
  }
  function hitStop(d) { freezeT = Math.max(freezeT, d); }
  function later(delay, fn) { timers.push({ t: delay, fn: fn }); }
  function screenFlash(col, a, dur) {
    flashCol = hexInt(col || '#ffffff');
    flashA = Math.max(flashA, a == null ? 0.5 : a);
    flashSpr.tint = flashCol;
    flashSpr.__decay = 1 / (dur || 0.35);
  }

  FX.getShake = function () { return shakeOut; };
  FX.getTimeScale = function () { return freezeT > 0 ? 0.12 : 1; };
  FX.setAmbient = function (theme) { ambientTheme = theme; };

  // ---------- projéteis com rastro por elemento ----------
  function projectile(fx, fy, tx, ty, element, dur, onHit) {
    var E = elemOf(element);
    var head = take(E.head, true);
    head.tint = hexInt(E.b);
    var glow = take('dot', true);
    glow.tint = hexInt(E.a);
    var pr = {
      fx: fx, fy: fy, tx: tx, ty: ty, t: 0, dur: dur || 0.42,
      element: element, head: head, glow: glow, onHit: onHit,
      arc: element === 'terra' ? 62 : (element === 'agua' ? 22 : 14),
      wob: E.wob, spin: E.spin
    };
    projectiles.push(pr);
    return pr;
  }
  function updateProjectiles(dt) {
    for (var i = projectiles.length - 1; i >= 0; i--) {
      var p = projectiles[i];
      p.t += dt;
      var k = Math.min(1, p.t / p.dur);
      var gx = p.fx + (p.tx - p.fx) * k;
      var gy = p.fy + (p.ty - p.fy) * k;
      var z = 24 + Math.sin(k * Math.PI) * p.arc;
      var w = world(gx, gy, z);
      // ondulação lateral característica (água serpenteia, ar espirala)
      var perp = Math.sin(k * Math.PI * (p.element === 'agua' ? 2.2 : 3.4)) * p.wob * 7 * SC;
      w.x += perp;
      var E = elemOf(p.element);
      var sz = (p.element === 'terra' ? 20 : 17) * SC;
      p.head.position.set(w.x, w.y);
      p.head.width = p.head.height = sz;
      p.head.rotation += (p.spin || 0) * dt * (p.element === 'terra' ? 1 : 0.4);
      p.glow.position.set(w.x, w.y);
      p.glow.width = p.glow.height = sz * 2.6;
      p.glow.alpha = 0.55;
      // rastro
      if (Math.random() < 0.92) {
        spawn({
          tex: E.trail, x: w.x + (Math.random() - 0.5) * 5, y: w.y + (Math.random() - 0.5) * 5,
          vx: (Math.random() - 0.5) * 26, vy: (E.up * 0.35) + (Math.random() - 0.5) * 18,
          life: 0.34 + Math.random() * 0.22, s0: 12 + Math.random() * 7, s1: 0,
          tint: E.b, tint1: E.a, spin: (Math.random() - 0.5) * 4, rot: Math.random() * 6.28
        });
      }
      if (k >= 1) {
        give(p.head); give(p.glow);
        projectiles.splice(i, 1);
        if (p.onHit) p.onHit();
      }
    }
  }

  // ---------- feixe / arco de golpe ----------
  function beam(fx, fy, tx, ty, col, life) {
    var a = world(fx, fy, 26), b = world(tx, ty, 26);
    var n = Math.max(6, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / (12 * SC)));
    for (var i = 0; i <= n; i++) {
      var k = i / n;
      spawn({
        tex: 'hard', x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k,
        life: (life || 0.3) * (0.6 + Math.random() * 0.6),
        s0: 16 + Math.random() * 10, s1: 0, tint: col, drag: 0.9,
        vx: (Math.random() - 0.5) * 16, vy: (Math.random() - 0.5) * 16
      });
    }
  }
  function slashArc(fx, fy, tx, ty, col) {
    var a = world(fx, fy, 30), b = world(tx, ty, 30);
    var ang = Math.atan2(b.y - a.y, b.x - a.x);
    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    for (var i = 0; i < 12; i++) {
      var k = i / 11 - 0.5;
      spawn({
        tex: 'streak', x: mx + Math.cos(ang + 1.57) * k * 44 * SC, y: my + Math.sin(ang + 1.57) * k * 44 * SC,
        life: 0.24, s0: 34 * (1 - Math.abs(k)), s1: 0, tint: col, rot: ang, drag: 1.2,
        vx: Math.cos(ang) * 90, vy: Math.sin(ang) * 90
      });
    }
  }

  // ---------- ambiente ----------
  function spawnAmbient(dt) {
    if (!ambientTheme) return;
    ambientT -= dt;
    if (ambientT > 0) return;
    ambientT = 0.24 + Math.random() * 0.3;
    var st = JOGO.Game && JOGO.Game.state;
    if (!st || !st.grid) return;
    var gx = Math.random() * st.grid.w, gy = Math.random() * st.grid.h;
    var w = world(gx, gy, 8 + Math.random() * 40);
    spawn({
      tex: 'hard', x: w.x, y: w.y, vx: (Math.random() - 0.5) * 10, vy: -8 - Math.random() * 10,
      life: 1.6 + Math.random(), s0: 2.4 + Math.random() * 2.4, s1: 0,
      a0: 0.35, a1: 0, tint: '#ffd9a0', drag: 0.1
    });
  }

  // ---------- eventos do contrato ----------
  FX.handleEvent = function (ev) {
    if (!ev) return;
    if (!attached) { if (queued.length < 400) queued.push(ev); return; }
    var p, u, col, i;
    switch (ev.type) {
      case 'battleStart':
        FX.reset();
        break;

      case 'cast':
        castFx(ev);
        break;

      case 'damage':
        (function (e) {
          var d = (R && R.hitDelay) ? R.hitDelay() : 0;
          later(d, function () {
            var pos = unitPos(e.uid); if (!pos) return;
            var amount = e.amount || 0;
            var elem = e.element || 'neutro';
            var pw = Math.max(0.6, Math.min(2.0, amount / 26 + 0.6));
            impact(pos.x, pos.y, elem, pw);
            if (amount > 0) {
              var f = floater(pos.x, pos.y, '-' + amount, elemOf(elem).b, amount >= 25, 'dmg');
            } else {
              floater(pos.x, pos.y, 'bloqueado', '#9fd0e8', false, 'info');
            }
          });
        })(ev);
        break;

      case 'heal':
        (function (e) {
          var pos = unitPos(e.uid); if (!pos) return;
          for (i = 0; i < 16; i++) {
            var w = world(pos.x + (Math.random() - 0.5) * 0.8, pos.y + (Math.random() - 0.5) * 0.8, 4);
            spawn({ tex: 'star', x: w.x, y: w.y, vx: (Math.random() - 0.5) * 22, vy: -60 - Math.random() * 50,
              life: 0.7 + Math.random() * 0.4, s0: 9 + Math.random() * 8, s1: 0, tint: '#9ce8a0', tint1: '#e8fff0', spin: 1.6, drag: 0.2 });
          }
          ring(pos.x, pos.y, '#9ce8a0', 10, 62, 0.5, 4);
          if (e.amount) floater(pos.x, pos.y, '+' + e.amount, '#9ce8a0', false, 'heal');
        })(ev);
        break;

      case 'shield':
        (function (e) {
          var pos = unitPos(e.uid); if (!pos) return;
          ring(pos.x, pos.y, '#8ad4f0', 14, 70, 0.45, 26);
          for (i = 0; i < 12; i++) {
            var a = i / 12 * 6.2832;
            var w = world(pos.x + Math.cos(a) * 0.5, pos.y + Math.sin(a) * 0.5, 26);
            spawn({ tex: 'hard', x: w.x, y: w.y, vx: Math.cos(a) * 14, vy: -22 - Math.random() * 14, life: 0.5, s0: 12, s1: 0, tint: '#bfeaff' });
          }
          if (e.amount) floater(pos.x, pos.y, '+' + e.amount, '#8ad4f0', false, 'shield');
        })(ev);
        break;

      case 'death':
        (function (e) {
          later(0.3, function () {
            var pos = unitPos(e.uid); if (!pos) return;
            var pal = palOf(e.uid);
            var u2 = unitOf(e.uid);
            var big = u2 && u2.boss ? 1.7 : 1;
            addShake(6 * big, 0.35);
            ring(pos.x, pos.y, pal.accent, 12, 96 * big, 0.55, 6);
            for (i = 0; i < Math.round(28 * big); i++) {
              var a = Math.random() * 6.2832, sp = 40 + Math.random() * 110;
              var w = world(pos.x, pos.y, 20 + Math.random() * 40);
              spawn({
                tex: Math.random() < 0.5 ? 'hard' : 'smoke',
                x: w.x, y: w.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - 40,
                life: 0.7 + Math.random() * 0.7, s0: 10 + Math.random() * 16 * big, s1: 0,
                tint: Math.random() < 0.5 ? pal.primary : pal.accent, tint1: pal.secondary,
                g: 30, spin: (Math.random() - 0.5) * 4
              });
            }
            smokePuff(pos.x, pos.y, 4, '#3a3038');
          });
        })(ev);
        break;

      case 'pushed':
        (function (e) {
          var a = world(e.fromX, e.fromY, 6);
          for (i = 0; i < 10; i++) {
            spawn({ tex: 'dust', x: a.x + (Math.random() - 0.5) * 20, y: a.y + (Math.random() - 0.5) * 10,
              vx: (e.toX - e.fromX) * -22 + (Math.random() - 0.5) * 30, vy: -10 - Math.random() * 18,
              life: 0.5, s0: 12 + Math.random() * 10, s1: 26, a0: 0.4, a1: 0, tint: '#c8b898', add: false });
          }
          if (e.collision) { addShake(4, 0.2); var b = world(e.toX, e.toY, 20); flare(e.toX, e.toY, '#ffd9a0', 40, 0.2, 24); }
        })(ev);
        break;

      case 'teleport':
        (function (e) {
          blinkFx(e.fromX, e.fromY, '#b98cff', false);
          later(0.22, function () { blinkFx(e.toX, e.toY, '#b98cff', true); });
        })(ev);
        break;

      case 'summon':
        if (ev.unit) {
          ring(ev.unit.x, ev.unit.y, '#ffd98a', 8, 66, 0.5, 4);
          burst(ev.unit.x, ev.unit.y, 'neutro', 16, { speed: 70, size: 13, z: 14 });
        }
        break;

      case 'effectApplied':
        (function (e) {
          var pos = unitPos(e.uid); if (!pos) return;
          var t = e.effect && e.effect.type;
          var cmap = { poison: '#6fd06a', root: '#b08048', taunt: '#ff6a4a', invisible: '#c0b8ff',
            regen: '#9ce8a0', reflect: '#8ad4f0', buff: '#ffd76b', resist: '#a0d0ff', mark: '#ff9ad0' };
          var c2 = cmap[t] || '#ffd98a';
          for (i = 0; i < 9; i++) {
            var a = i / 9 * 6.2832;
            var w = world(pos.x + Math.cos(a) * 0.42, pos.y + Math.sin(a) * 0.42, 24);
            spawn({ tex: 'hard', x: w.x, y: w.y, vx: Math.cos(a) * 12, vy: -26 - Math.random() * 12, life: 0.55, s0: 10, s1: 0, tint: c2 });
          }
        })(ev);
        break;

      // ---------------- eventos NOVOS da v2 ----------------
      case 'weatherTick':
        (function (e) {
          var pos = unitPos(e.uid); if (!pos) return;
          var amt = e.amount || 0;
          var good = amt > 0;
          floater(pos.x, pos.y, (good ? '+' : '') + amt, good ? '#9ce8a0' : '#ff8a6a', false, 'weather');
          for (i = 0; i < 7; i++) {
            var w = world(pos.x + (Math.random() - 0.5) * 0.7, pos.y + (Math.random() - 0.5) * 0.7, 10);
            spawn({ tex: 'hard', x: w.x, y: w.y, vx: (Math.random() - 0.5) * 16,
              vy: good ? -40 : 30, life: 0.6, s0: 8, s1: 0, tint: good ? '#9ce8a0' : '#ff8a6a' });
          }
        })(ev);
        break;

      case 'weatherShift':
        (function (e) {
          var id = typeof e.weather === 'string' ? e.weather : (e.weather && e.weather.id);
          var cmap = { chuva: '#4fb8f0', estiagem: '#ffb14a', vendaval: '#cfe4ff', tremor: '#c8a066', calmo: '#ffffff' };
          screenFlash(cmap[id] || '#ffffff', 0.28, 0.7);
          addShake(id === 'tremor' ? 8 : 3, 0.5);
          var st = JOGO.Game && JOGO.Game.state;
          if (st && st.grid) {
            for (i = 0; i < 26; i++) {
              var gx = Math.random() * st.grid.w, gy = Math.random() * st.grid.h;
              var w = world(gx, gy, 10 + Math.random() * 50);
              spawn({ tex: 'streak', x: w.x, y: w.y, vx: (Math.random() - 0.5) * 120, vy: -30 - Math.random() * 40,
                life: 0.8, s0: 22, s1: 0, tint: cmap[id] || '#ffffff', rot: Math.random() * 6.28 });
            }
          }
        })(ev);
        break;

      case 'dodgeFail':
        (function (e) {
          var pos = unitPos(e.uid); if (!pos) return;
          floater(pos.x, pos.y, 'PRESO!', '#ff9a4a', true, 'info');
          addShake(5, 0.24);
          ring(pos.x, pos.y, '#ff9a4a', 34, 12, 0.34, 4);      // anel que FECHA (prende)
          var lk = e.lockerUid ? unitPos(e.lockerUid) : null;
          if (lk) beam(lk.x, lk.y, pos.x, pos.y, '#ff9a4a', 0.26);
          for (i = 0; i < 10; i++) {
            var a = i / 10 * 6.2832;
            var w = world(pos.x + Math.cos(a) * 0.55, pos.y + Math.sin(a) * 0.55, 6);
            spawn({ tex: 'shard', x: w.x, y: w.y, vx: -Math.cos(a) * 40, vy: -Math.sin(a) * 20 - 10, life: 0.4, s0: 12, s1: 0, tint: '#ffb45a', spin: 4 });
          }
        })(ev);
        break;

      case 'dodgeOk':
        (function (e) {
          var pos = unitPos(e.uid); if (!pos) return;
          floater(pos.x, pos.y, 'esquiva', '#cfe4ff', false, 'info');
          for (i = 0; i < 8; i++) {
            var w = world(pos.x + (Math.random() - 0.5) * 0.8, pos.y + (Math.random() - 0.5) * 0.8, 16);
            spawn({ tex: 'streak', x: w.x, y: w.y, vx: (Math.random() - 0.5) * 90, vy: -16 - Math.random() * 20,
              life: 0.34, s0: 20, s1: 0, tint: '#cfe4ff', rot: Math.random() * 6.28 });
          }
        })(ev);
        break;

      case 'fusion':
        fusionFx(ev);
        break;

      case 'petAct':
        (function (e) {
          var pos = unitPos(e.uid); if (!pos) return;
          var c2 = '#ffd76b';
          ring(pos.x, pos.y, c2, 6, 44, 0.36, 4);
          for (i = 0; i < 10; i++) {
            var a = i / 10 * 6.2832;
            var w = world(pos.x + Math.cos(a) * 0.3, pos.y + Math.sin(a) * 0.3, 30);
            spawn({ tex: 'star', x: w.x, y: w.y, vx: Math.cos(a) * 30, vy: Math.sin(a) * 16 - 30, life: 0.5, s0: 10, s1: 0, tint: c2, spin: 3 });
          }
          if (e.action) floater(pos.x, pos.y, String(e.action), c2, false, 'info');
        })(ev);
        break;

      case 'tileEvent':
        (function (e) {
          var pos = unitPos(e.uid); if (!pos) return;
          var D = JOGO.DATA || {};
          var def = (D.tileEvents && D.tileEvents[e.eventId]) || {};
          var kmap = { buff: '#ffd76b', mystery: '#b98cff', portal: '#58b6f0', drain: '#e0556a', fountain: '#7ef0d4' };
          var c2 = kmap[def.kind] || '#ffd76b';
          ring(pos.x, pos.y, c2, 8, 84, 0.55, 4);
          flare(pos.x, pos.y, c2, 52, 0.3, 16);
          for (i = 0; i < 20; i++) {
            var a = Math.random() * 6.2832;
            var w = world(pos.x, pos.y, 6);
            spawn({ tex: 'star', x: w.x, y: w.y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 30 - 50, life: 0.75, s0: 12, s1: 0, tint: c2, spin: 3, g: 60 });
          }
          if (e.text) floater(pos.x, pos.y, e.text, c2, true, 'info');
        })(ev);
        break;

      case 'trapTriggered':
        (function (e) {
          var pos = unitPos(e.uid); if (!pos) return;
          addShake(7, 0.3);
          hitStop(0.06);
          screenFlash('#ffb45a', 0.18, 0.25);
          ring(pos.x, pos.y, '#ffb45a', 6, 92, 0.4, 4);
          burst(pos.x, pos.y, 'terra', 26, { speed: 150, size: 16, z: 8 });
          floater(pos.x, pos.y, 'ARMADILHA!', '#ffb45a', true, 'info');
        })(ev);
        break;

      case 'markStack':
        (function (e) {
          var pos = unitPos(e.uid); if (!pos) return;
          var n = e.stacks || 1;
          floater(pos.x, pos.y, '✦'.repeat ? ('marca ×' + n) : ('marca x' + n), '#ff9ad0', false, 'info');
          for (i = 0; i < 6 + n * 2; i++) {
            var a = Math.random() * 6.2832;
            var w = world(pos.x + Math.cos(a) * 0.5, pos.y + Math.sin(a) * 0.5, 34);
            spawn({ tex: 'star', x: w.x, y: w.y, vx: -Math.cos(a) * 46, vy: -Math.sin(a) * 24, life: 0.42, s0: 12, s1: 2, tint: '#ff9ad0', spin: 5 });
          }
          ring(pos.x, pos.y, '#ff9ad0', 40, 10, 0.32, 30);
        })(ev);
        break;

      case 'battleEnd':
        timers.length = 0;
        break;
    }
  };

  function blinkFx(gx, gy, col, arriving) {
    ring(gx, gy, col, arriving ? 70 : 10, arriving ? 8 : 70, 0.32, 6);
    for (var i = 0; i < 14; i++) {
      var a = i / 14 * 6.2832;
      var r = arriving ? 0.8 : 0.15;
      var w = world(gx + Math.cos(a) * r, gy + Math.sin(a) * r, 22);
      spawn({
        tex: 'streak', x: w.x, y: w.y,
        vx: Math.cos(a) * (arriving ? -70 : 70), vy: Math.sin(a) * (arriving ? -34 : 34) - 12,
        life: 0.36, s0: 20, s1: 0, tint: col, rot: a
      });
    }
    flare(gx, gy, col, 40, 0.24, 26);
  }

  // ---------- conjuração ----------
  function castFx(ev) {
    var D = JOGO.DATA || {};
    var spell = (D.spells && D.spells[ev.spellId]) || ev.spell || null;
    var element = (spell && spell.element) || ev.element || elementOfUnit(ev.uid);
    var fxKey = (spell && spell.fxKey) || ev.fxKey || 'burst';
    var E = elemOf(element);
    var from = unitPos(ev.uid);
    if (!from) return;
    var tx = ev.x != null ? ev.x : from.x, ty = ev.y != null ? ev.y : from.y;

    // antecipação: círculo de conjuração no chão + carga subindo
    ring(from.x, from.y, E.b, 46, 12, 0.34, 3);
    for (var i = 0; i < 12; i++) {
      var a = i / 12 * 6.2832;
      var w = world(from.x + Math.cos(a) * 0.55, from.y + Math.sin(a) * 0.55, 4);
      spawn({ tex: E.bit, x: w.x, y: w.y, vx: -Math.cos(a) * 26, vy: -Math.sin(a) * 13 - 46,
        life: 0.42, s0: 11, s1: 0, tint: E.b, tint1: E.a, spin: 2 });
    }

    var delay = (R && R.hitDelay) ? R.hitDelay() : 0.26;
    switch (fxKey) {
      case 'bolt':
      case 'arrow':
        projectile(from.x, from.y, tx, ty, element, Math.max(0.18, delay - 0.04), null);
        break;
      case 'chain':
        projectile(from.x, from.y, tx, ty, element, Math.max(0.18, delay - 0.04), null);
        break;
      case 'beam':
        later(0.16, function () { beam(from.x, from.y, tx, ty, E.b, 0.34); });
        break;
      case 'slam':
      case 'melee':
        later(delay * 0.7, function () { slashArc(from.x, from.y, tx, ty, E.b); });
        break;
      case 'nova':
        later(delay * 0.6, function () {
          ring(from.x, from.y, E.b, 10, 150, 0.55, 8);
          burst(from.x, from.y, element, 28, { speed: 150, size: 15, z: 12 });
        });
        break;
      case 'heal':
        break;
      case 'gust':
        later(delay * 0.5, function () { beam(from.x, from.y, tx, ty, '#cfe4ff', 0.3); });
        break;
      default:
        later(delay * 0.8, function () { flare(tx, ty, E.b, 40, 0.22, 18); });
    }
  }

  // ---------- FUSÃO: o momento mais especial do jogo ----------
  function fusionFx(ev) {
    var T = (R && R.FUSION_TIMING) || { approach: 0.55, flash: 0.2, reveal: 0.55 };
    var from = ev.from || [];
    var pa = from[0] ? unitPos(from[0]) : null;
    var pb = from[1] ? unitPos(from[1]) : null;
    var mid = (pa && pb) ? { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 } : (pa || pb || unitPos(ev.uid));
    if (!mid) return;
    var elems = ev.elemPair || [];
    var cA = elemOf(elems[0] || elementOfUnit(from[0])).a;
    var cB = elemOf(elems[1] || elementOfUnit(from[1])).a;

    // 1) aproximação: dois círculos e fios de luz convergindo
    var steps = 10;
    for (var s = 0; s < steps; s++) {
      (function (k) {
        later(T.approach * (k / steps), function () {
          if (pa) spiralTo(pa, mid, cA);
          if (pb) spiralTo(pb, mid, cB);
          ring(mid.x, mid.y, '#ffffff', 8 + k * 4, 4, 0.22, 6);
        });
      })(s);
    }
    // 2) CLARÃO
    later(T.approach, function () {
      screenFlash('#ffffff', 0.85, 0.42);
      hitStop(0.1);
      addShake(11, 0.5);
      flare(mid.x, mid.y, '#ffffff', 190, 0.34, 34);
      ring(mid.x, mid.y, '#ffffff', 10, 210, 0.5, 20);
    });
    // 3) revelação: colunas de luz nas duas cores + chuva de faíscas + anel duplo
    later(T.approach + T.flash * 0.6, function () {
      ring(mid.x, mid.y, cA, 14, 130, 0.6, 6);
      ring(mid.x, mid.y, cB, 26, 168, 0.7, 6);
      var i;
      for (i = 0; i < 46; i++) {
        var a = Math.random() * 6.2832, sp = 60 + Math.random() * 150;
        var w = world(mid.x, mid.y, 16 + Math.random() * 30);
        spawn({
          tex: Math.random() < 0.5 ? 'star' : 'hard', x: w.x, y: w.y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - 60,
          life: 0.9 + Math.random() * 0.6, s0: 12 + Math.random() * 14, s1: 0,
          tint: i % 2 ? cA : cB, tint1: '#ffffff', g: 90, spin: (Math.random() - 0.5) * 6
        });
      }
      // coluna de luz
      for (i = 0; i < 26; i++) {
        var w2 = world(mid.x + (Math.random() - 0.5) * 0.5, mid.y + (Math.random() - 0.5) * 0.5, 4 + i * 5);
        spawn({ tex: 'dot', x: w2.x, y: w2.y, vy: -70 - Math.random() * 60, life: 0.8,
          s0: 30 - i * 0.6, s1: 4, a0: 0.55, a1: 0, tint: i % 2 ? cA : cB });
      }
      floater(mid.x, mid.y, 'FUSÃO!', '#fff0c0', true, 'info');
    });
  }
  function spiralTo(fromP, toP, col) {
    for (var i = 0; i < 3; i++) {
      var k = Math.random();
      var gx = fromP.x + (toP.x - fromP.x) * k, gy = fromP.y + (toP.y - fromP.y) * k;
      var w = world(gx, gy, 10 + Math.random() * 40);
      var t = world(toP.x, toP.y, 26);
      var dx = t.x - w.x, dy = t.y - w.y, l = Math.hypot(dx, dy) || 1;
      spawn({
        tex: 'hard', x: w.x, y: w.y, vx: (dx / l) * 150, vy: (dy / l) * 150 - 20,
        life: 0.4, s0: 12, s1: 0, tint: col, tint1: '#ffffff', drag: 0.02
      });
    }
  }

  // ---------- atualização ----------
  FX.update = function (dt, realDt) {
    if (!attached) return;
    var rdt = realDt == null ? dt : realDt;
    nowT += dt;
    if (freezeT > 0) freezeT = Math.max(0, freezeT - rdt);

    var i;
    for (i = timers.length - 1; i >= 0; i--) {
      timers[i].t -= dt;
      if (timers[i].t <= 0) { var fn = timers[i].fn; timers.splice(i, 1); try { fn(); } catch (e) {} }
    }

    updateProjectiles(dt);
    spawnAmbient(dt);

    // partículas
    for (i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.age += dt;
      var k = p.age / p.life;
      if (k >= 1) { give(p.s); parts.splice(i, 1); continue; }
      var damp = Math.pow(1 - Math.min(0.95, p.drag), dt * 60);
      p.vx *= damp; p.vy *= damp;
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.spin * dt;
      var sz = p.s0 + (p.s1 - p.s0) * k;
      var s = p.s;
      s.position.set(p.x, p.y);
      s.rotation = p.rot;
      s.alpha = p.a0 + (p.a1 - p.a0) * k;
      if (p.flat) { s.width = sz * 2; s.height = sz; }
      else { s.width = sz; s.height = sz; }
      if (p.tint1 != null) s.tint = lerpTint(p.tint, p.tint1, k);
    }

    // marcas no chão
    for (i = decals.length - 1; i >= 0; i--) {
      var d = decals[i];
      d.age += dt;
      if (d.age >= d.life) { d.g.destroy(); decals.splice(i, 1); continue; }
      var kk = d.age / d.life;
      d.g.alpha = kk < 0.15 ? kk / 0.15 : (1 - (kk - 0.15) / 0.85) * 0.9;
    }

    // números flutuantes (contra-escala pelo zoom p/ legibilidade em qualquer zoom)
    var zoom = (R && R.camZoom) ? R.camZoom() : 1;
    var cs = Math.max(0.55, Math.min(1.5, 1 / zoom));
    for (i = floaters.length - 1; i >= 0; i--) {
      var f = floaters[i];
      f.age += dt;
      var fk = f.age / f.life;
      if (fk >= 1) {
        f.t.visible = false;
        if (f.t.parent) f.t.parent.removeChild(f.t);
        if (fpool.length < 16) fpool.push(f.t); else f.t.destroy();
        floaters.splice(i, 1);
        continue;
      }
      // quique: sobe rápido, desacelera, cai um pouco no fim
      var pop = fk < 0.18 ? (1.55 - Math.cos(fk / 0.18 * Math.PI) * 0.55) : 1;
      f.y += f.vy * dt;
      f.vy += 130 * SC * dt;
      f.t.position.set(f.x, f.y);
      f.t.scale.set(cs * f.base * pop);
      f.t.alpha = fk > 0.7 ? 1 - (fk - 0.7) / 0.3 : 1;
    }

    // shake
    if (shakeT > 0) {
      shakeT = Math.max(0, shakeT - rdt);
      var amp = shakeM * (shakeT / (shakeDur || 1));
      shakeOut.x = (Math.random() * 2 - 1) * amp;
      shakeOut.y = (Math.random() * 2 - 1) * amp * 0.7;
      if (shakeT <= 0) { shakeM = 0; shakeOut.x = shakeOut.y = 0; }
    } else { shakeOut.x = 0; shakeOut.y = 0; }

    // clarão de tela
    if (flashA > 0) {
      flashA = Math.max(0, flashA - rdt * (flashSpr.__decay || 3));
      flashSpr.alpha = flashA;
    } else flashSpr.alpha = 0;
  };

  FX.reset = function () {
    if (!attached) return;
    var i;
    for (i = 0; i < parts.length; i++) give(parts[i].s);
    parts.length = 0;
    for (i = 0; i < projectiles.length; i++) { give(projectiles[i].head); give(projectiles[i].glow); }
    projectiles.length = 0;
    for (i = 0; i < decals.length; i++) decals[i].g.destroy();
    decals.length = 0;
    for (i = 0; i < floaters.length; i++) {
      if (floaters[i].t.parent) floaters[i].t.parent.removeChild(floaters[i].t);
      floaters[i].t.destroy();
    }
    floaters.length = 0;
    timers.length = 0;
    shakeM = shakeT = 0; freezeT = 0; flashA = 0;
    shakeOut.x = shakeOut.y = 0;
    if (flashSpr) flashSpr.alpha = 0;
  };

  FX.stats = function () {
    return { parts: parts.length, pool: pool.length, projectiles: projectiles.length, decals: decals.length, floaters: floaters.length, timers: timers.length };
  };

  // atalhos usados pela página de teste
  FX.debugImpact = function (gx, gy, element, power) { impact(gx, gy, element, power || 1); };
  FX.debugProjectile = function (fx, fy, tx, ty, element) {
    projectile(fx, fy, tx, ty, element, 0.5, function () { impact(tx, ty, element, 1.2); });
  };
  FX.debugFloater = function (gx, gy, txt, col, big) { floater(gx, gy, txt, col, big); };

  JOGO.FX = FX;
})();
