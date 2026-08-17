var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// JOGO.FX (3D real) — dono: Agente Designer 3D — FASE B
//
//   MESMA API do contrato: FX.handleEvent(ev). Internos consumidos pelo
//   Renderer 3D (mesmo dono): bind(renderer) / resize(w,h,pr) / onScene(ctx) /
//   update(dtReal, t) / render(scene, camera, dt) → composer com BLOOM.
//
//   · BLOOM: UnrealBloomPass (threshold alto — só emissivos/chamas estouram).
//   · Partículas GPU: THREE.Points + ShaderMaterial (pool fixo, additivo +
//     pool de fumaça), texturas procedurais.
//   · Projéteis com núcleo + halo + LUZ pontual viajando + rastro; impacto em
//     2 tempos (flash + burst radial 3D + anel de choque + luz momentânea).
//   · Assinatura por elemento (labaredas/gotas/estilhaços/lâminas/raios/
//     fumaça), decais no chão (~3s), números de dano billboard, screen shake
//     + micro hit-stop, morte com burst, morte de CHEFE cinematográfica.
//   · Ambiente por tema: vagalumes (Estufa), bolhas (Cisterna), fagulhas
//     subindo (Fecho).
//   · Luzes de FX em POOL FIXO (3) — contagem estável, zero recompile.
// ============================================================================

(function () {
  'use strict';

  var FX = {};
  var hasTHREE = (typeof THREE !== 'undefined');

  // ------------------------------------------------------------ estado geral
  var glr = null;                    // WebGLRenderer (bind)
  var composer = null, bloomPass = null, renderPass = null;
  var scene = null, camera = null;
  var fxG = null;                    // grupo raiz do FX (persistente na cena)
  var ctx = { theme: 'garden', cell: 2, w: 13, h: 11, holes: [] };
  var W = 2, H = 2, PR = 1;
  var nowT = 0;
  var delayed = [];                  // {t, fn} — relógio com hit-stop aplicado
  var shakeMag = 0, shakeT = 0;
  var stopT = 0, stopScale = 1;      // hit-stop

  function R() { return JOGO.Renderer || null; }
  function cellW(x) { return x * ctx.cell; }
  function tileWorld(x, y) { return { x: cellW(x), y: 0, z: cellW(y) }; }
  function anchor(uid, part) {
    var r = R();
    if (r && r.unitAnchor) { var a = r.unitAnchor(uid, part); if (a) return a; }
    return { x: 0, y: 1, z: 0 };
  }
  function hitDelay() {
    var r = R();
    return (r && r.hitDelay) ? r.hitDelay() : 0.26;
  }
  function later(t, fn) { delayed.push({ t: t, fn: fn }); }

  // --------------------------------------------------------------- elementos
  var ELEM = {
    fire:    { core: '#fff3d0', glow: '#ff7a2c', spark: '#ffb347', decal: 'scorch', grav: 2.6,  smoke: true },
    water:   { core: '#eafcff', glow: '#4ac8e8', spark: '#9ae8ff', decal: 'wet',    grav: -7,   smoke: false },
    earth:   { core: '#ffe9b0', glow: '#c8a04a', spark: '#b08c50', decal: 'cracks', grav: -8,   smoke: false },
    air:     { core: '#ffffff', glow: '#b8e8e0', spark: '#defff6', decal: 'swirl',  grav: 0.5,  smoke: false },
    light:   { core: '#fffbe4', glow: '#ffe9a0', spark: '#fff7c8', decal: 'star',   grav: 1.2,  smoke: false },
    shadow:  { core: '#e6d4ff', glow: '#9a6fd3', spark: '#7a52b0', decal: 'smoke',  grav: 1.0,  smoke: true },
    neutral: { core: '#f4eee0', glow: '#d8d0c0', spark: '#cfc6b2', decal: 'cracks', grav: -4,   smoke: false }
  };
  function elemOf(e) { return ELEM[e] || ELEM.neutral; }

  // ------------------------------------------------------------ texturas
  var texCache = {};
  function makeTex(name, painter, size) {
    if (texCache[name]) return texCache[name];
    var cv = document.createElement('canvas');
    cv.width = cv.height = size || 64;
    painter(cv.getContext('2d'), size || 64);
    var t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding;
    texCache[name] = t;
    return t;
  }
  function dotTex() {
    return makeTex('dot', function (c, s) {
      var g = c.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2 - 1);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, s, s);
    });
  }
  function starTex() {
    return makeTex('star', function (c, s) {
      var cx2 = s / 2;
      var g = c.createRadialGradient(cx2, cx2, 1, cx2, cx2, cx2 - 1);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, s, s);
      c.strokeStyle = 'rgba(255,255,255,0.9)';
      c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(cx2, 2); c.lineTo(cx2, s - 2); c.stroke();
      c.beginPath(); c.moveTo(2, cx2); c.lineTo(s - 2, cx2); c.stroke();
    });
  }
  // "POW!": estrela irregular CHAPADA (flash de impacto de gibi)
  function powTex() {
    return makeTex('pow', function (c, s) {
      var cx2 = s / 2, spikes = 9;
      c.fillStyle = 'rgba(255,255,255,1)';
      c.beginPath();
      for (var i = 0; i < spikes * 2; i++) {
        var a = (i / (spikes * 2)) * Math.PI * 2;
        var r = (i % 2 === 0)
          ? s * 0.46 * (0.72 + ((i * 7) % 5) * 0.07)
          : s * 0.16 * (0.8 + ((i * 13) % 3) * 0.14);
        var x = cx2 + Math.cos(a) * r, y = cx2 + Math.sin(a) * r;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.closePath(); c.fill();
    }, 128);
  }
  // estrelinha GORDA de 4 pontas (partícula chunky de impacto)
  function chunkTex() {
    return makeTex('chunk', function (c, s) {
      var cx2 = s / 2, R = s * 0.46, r = s * 0.15;
      c.fillStyle = 'rgba(255,255,255,1)';
      c.beginPath();
      for (var i = 0; i < 8; i++) {
        var a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        var rr = (i % 2 === 0) ? R : r;
        var x = cx2 + Math.cos(a) * rr, y = cx2 + Math.sin(a) * rr;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.closePath(); c.fill();
    });
  }
  // fumacinha REDONDA e fofa (3 bolhas chapadas, borda quase dura)
  function puffTex() {
    return makeTex('puff', function (c, s) {
      function blob(x, y, r) {
        var g = c.createRadialGradient(x, y, r * 0.55, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.82, 'rgba(255,255,255,0.85)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      }
      blob(s * 0.38, s * 0.55, s * 0.26);
      blob(s * 0.62, s * 0.52, s * 0.24);
      blob(s * 0.5, s * 0.38, s * 0.24);
    });
  }

  // ----------------------------------------------------- pool de PARTÍCULAS
  function makePool(max, blending, texture) {
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(max * 3);
    var col = new Float32Array(max * 3);
    var siz = new Float32Array(max);
    var alp = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alp, 1));
    var mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: texture }, uScaleH: { value: 600 } },
      vertexShader: [
        'attribute vec3 aColor;',
        'attribute float aSize;',
        'attribute float aAlpha;',
        'varying vec3 vColor;',
        'varying float vAlpha;',
        'uniform float uScaleH;',
        'void main() {',
        '  vColor = aColor; vAlpha = aAlpha;',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  gl_PointSize = aSize * (uScaleH / max(0.001, -mv.z));',
        '  gl_Position = projectionMatrix * mv;',
        '}'].join('\n'),
      fragmentShader: [
        'uniform sampler2D uTex;',
        'varying vec3 vColor;',
        'varying float vAlpha;',
        'void main() {',
        '  vec4 t = texture2D(uTex, gl_PointCoord);',
        '  gl_FragColor = vec4(vColor, vAlpha * t.a);',
        '  if (gl_FragColor.a < 0.004) discard;',
        '}'].join('\n'),
      blending: blending,
      depthWrite: false,
      transparent: true
    });
    var points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 20;
    return {
      mesh: points, geo: geo, mat: mat, max: max,
      pos: pos, col: col, siz: siz, alp: alp,
      list: [], free: []
    };
  }
  var poolAdd = null, poolSmoke = null, poolStar = null;

  // partícula: {x,y,z, vx,vy,vz, age,life, s0,s1, r,g,b, a0, grav, drag, tw}
  function spawn(pool, o) {
    var p;
    if (pool.free.length) p = pool.free.pop();
    else if (pool.list.length < pool.max) { p = {}; }
    else return null;                        // pool cheio: descarta
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.age = 0; p.life = o.life || 0.6;
    p.s0 = o.s0 != null ? o.s0 : 0.16; p.s1 = o.s1 != null ? o.s1 : 0.02;
    p.r = o.r; p.g = o.g; p.b = o.b;
    p.a0 = o.a0 != null ? o.a0 : 1;
    p.grav = o.grav || 0; p.drag = o.drag != null ? o.drag : 0.9;
    p.tw = o.tw || 0;                        // cintilação
    pool.list.push(p);
    return p;
  }
  var tmpColor = hasTHREE ? new THREE.Color() : null;
  function colOf(hex) {
    tmpColor.set(hex).convertSRGBToLinear();
    return tmpColor;
  }
  function burst(pool, px, py, pz, hex, n, opt) {
    opt = opt || {};
    var c = colOf(hex);
    var r0 = c.r, g0 = c.g, b0 = c.b;
    for (var i = 0; i < n; i++) {
      var th = Math.random() * Math.PI * 2;
      var ph = (Math.random() - 0.5) * Math.PI;
      var sp = (opt.speed || 4) * (0.35 + Math.random() * 0.75);
      var up = opt.up != null ? opt.up : 0.5;
      spawn(pool, {
        x: px + (Math.random() - 0.5) * 0.14, y: py + (Math.random() - 0.5) * 0.14, z: pz + (Math.random() - 0.5) * 0.14,
        vx: Math.cos(th) * Math.cos(ph) * sp,
        vy: Math.abs(Math.sin(ph)) * sp * up + (opt.vy || 0),
        vz: Math.sin(th) * Math.cos(ph) * sp,
        life: (opt.life || 0.55) * (0.6 + Math.random() * 0.8),
        s0: (opt.s0 || 0.17) * (0.7 + Math.random() * 0.7), s1: opt.s1 != null ? opt.s1 : 0.02,
        r: r0, g: g0, b: b0, a0: opt.a0 != null ? opt.a0 : 1,
        grav: opt.grav != null ? opt.grav : -6, drag: opt.drag != null ? opt.drag : 1.6,
        tw: opt.tw || 0
      });
    }
  }
  function updatePool(pool, dt) {
    var L = pool.list, n = 0;
    for (var i = 0; i < L.length; i++) {
      var p = L[i];
      p.age += dt;
      if (p.age >= p.life) { pool.free.push(p); continue; }
      var dr = Math.pow(0.5, dt * p.drag);
      p.vx *= dr; p.vz *= dr; p.vy = p.vy * dr + p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02 && p.vy < 0) { p.y = 0.02; p.vy *= -0.3; p.vx *= 0.7; p.vz *= 0.7; }
      var k = p.age / p.life;
      var a = p.a0 * (k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88);
      if (p.tw) a *= 0.72 + Math.sin((nowT + p.x * 3.1) * p.tw) * 0.28;
      pool.pos[n * 3] = p.x; pool.pos[n * 3 + 1] = p.y; pool.pos[n * 3 + 2] = p.z;
      pool.col[n * 3] = p.r; pool.col[n * 3 + 1] = p.g; pool.col[n * 3 + 2] = p.b;
      pool.siz[n] = p.s0 + (p.s1 - p.s0) * k;
      pool.alp[n] = a;
      L[n++] = p;
    }
    L.length = n;
    pool.geo.attributes.position.needsUpdate = true;
    pool.geo.attributes.aColor.needsUpdate = true;
    pool.geo.attributes.aSize.needsUpdate = true;
    pool.geo.attributes.aAlpha.needsUpdate = true;
    pool.geo.setDrawRange(0, n);
  }

  // ------------------------------------------------------ luzes de FX (pool)
  var fxLights = [];                    // 3 luzes fixas {l, busy, t, dur, base}
  function acquireLight(hex, intensity, dist, x, y, z, dur) {
    for (var i = 0; i < fxLights.length; i++) {
      var e = fxLights[i];
      if (!e.busy) {
        e.busy = true; e.t = 0; e.dur = dur || 0.3; e.base = intensity;
        e.l.color.set(hex).convertSRGBToLinear();
        e.l.intensity = intensity;
        e.l.distance = dist;
        e.l.position.set(x, y, z);
        return e;
      }
    }
    return null;
  }
  function updateLights(dt) {
    for (var i = 0; i < fxLights.length; i++) {
      var e = fxLights[i];
      if (!e.busy) continue;
      if (e.follow) {                       // preso a um projétil
        if (e.follow.dead) { e.busy = false; e.follow = null; e.l.intensity = 0; continue; }
        e.l.position.set(e.follow.x, e.follow.y, e.follow.z);
        e.l.intensity = e.base * (0.85 + Math.sin(nowT * 31) * 0.15);
        continue;
      }
      e.t += dt;
      if (e.t >= e.dur) { e.busy = false; e.l.intensity = 0; continue; }
      e.l.intensity = e.base * (1 - e.t / e.dur);
    }
  }

  // --------------------------------------------------------------- sprites
  function makeSprite(texture, hex, scale, opacity) {
    var m = new THREE.SpriteMaterial({
      map: texture, color: new THREE.Color(hex).convertSRGBToLinear(),
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      opacity: opacity != null ? opacity : 1
    });
    var sp = new THREE.Sprite(m);
    sp.scale.set(scale, scale, 1);
    sp.renderOrder = 22;
    return sp;
  }
  // flashes: sprites com vida curta {sp, age, life, s0, s1, a0}
  var flashes = [];
  function flash(px, py, pz, hex, size, life, tex, rot) {
    var sp = makeSprite(tex || starTex(), hex, size, 1);
    if (rot != null) sp.material.rotation = rot;
    sp.position.set(px, py, pz);
    fxG.add(sp);
    flashes.push({ sp: sp, age: 0, life: life || 0.14, s0: size * 0.55, s1: size, a0: 1 });
  }
  function updateFlashes(dt) {
    for (var i = flashes.length - 1; i >= 0; i--) {
      var f = flashes[i];
      f.age += dt;
      var k = f.age / f.life;
      if (k >= 1) {
        fxG.remove(f.sp);
        if (f.isMesh && f.sp.geometry) f.sp.geometry.dispose();
        f.sp.material.dispose();
        flashes.splice(i, 1); continue;
      }
      if (!f.isMesh) {
        var s = f.s0 + (f.s1 - f.s0) * Math.sqrt(k);
        f.sp.scale.set(s, s, 1);
      }
      f.sp.material.opacity = f.a0 * (1 - k * k);
    }
  }

  // ------------------------------------------------------- anéis de choque
  var rings = [];
  function ring(px, pz, hex, r1, life, y) {
    var geo = new THREE.RingGeometry(0.24, 0.62, 40);      // anel GROSSO cartoon
    geo.rotateX(-Math.PI / 2);
    var m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex).convertSRGBToLinear(),
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.9,
      depthWrite: false, side: THREE.DoubleSide
    });
    var ms = new THREE.Mesh(geo, m);
    ms.position.set(px, y != null ? y : 0.05, pz);
    ms.renderOrder = 21;
    fxG.add(ms);
    rings.push({ ms: ms, age: 0, life: life || 0.5, r1: r1 || 2.6 });
  }
  function updateRings(dt) {
    for (var i = rings.length - 1; i >= 0; i--) {
      var rg = rings[i];
      rg.age += dt;
      var k = rg.age / rg.life;
      if (k >= 1) {
        fxG.remove(rg.ms); rg.ms.geometry.dispose(); rg.ms.material.dispose();
        rings.splice(i, 1); continue;
      }
      var s = 0.4 + rg.r1 * Math.pow(k, 0.62);
      rg.ms.scale.set(s, 1, s);
      rg.ms.material.opacity = 0.9 * (1 - k) * (1 - k);
    }
  }

  // ------------------------------------------------------------- decais
  var decalTex = {};
  function getDecalTex(kind) {
    if (decalTex[kind]) return decalTex[kind];
    var cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    var c = cv.getContext('2d');
    var i, a, r;
    function blotch(color, n, rr) {
      for (var j = 0; j < n; j++) {
        var th = Math.random() * Math.PI * 2, d = Math.random() * rr;
        c.fillStyle = color;
        c.globalAlpha = 0.16 + Math.random() * 0.3;
        c.beginPath();
        c.ellipse(64 + Math.cos(th) * d, 64 + Math.sin(th) * d, 7 + Math.random() * 16, 5 + Math.random() * 12, th, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
    }
    if (kind === 'scorch') {
      blotch('#0a0503', 22, 34);
      c.strokeStyle = 'rgba(255,130,50,0.9)';
      for (i = 0; i < 7; i++) {
        a = Math.random() * Math.PI * 2;
        c.lineWidth = 1 + Math.random() * 1.6;
        c.beginPath(); c.moveTo(64 + Math.cos(a) * 6, 64 + Math.sin(a) * 6);
        c.lineTo(64 + Math.cos(a) * (26 + Math.random() * 26), 64 + Math.sin(a) * (26 + Math.random() * 26));
        c.stroke();
      }
    } else if (kind === 'wet') {
      blotch('#0a2028', 20, 36);
      c.strokeStyle = 'rgba(150,240,255,0.8)';
      c.lineWidth = 1.6;
      c.beginPath(); c.ellipse(64, 64, 34, 26, 0.4, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.ellipse(60, 60, 20, 15, 0.4, 0, Math.PI * 2); c.stroke();
    } else if (kind === 'cracks') {
      blotch('#120c06', 12, 26);
      c.strokeStyle = 'rgba(20,12,6,0.85)';
      for (i = 0; i < 8; i++) {
        a = (i / 8) * Math.PI * 2 + Math.random() * 0.5;
        c.lineWidth = 2 + Math.random() * 2;
        c.beginPath(); c.moveTo(64, 64);
        var x2 = 64, y2 = 64;
        for (var s2 = 0; s2 < 3; s2++) {
          x2 += Math.cos(a + (Math.random() - 0.5) * 0.8) * (10 + Math.random() * 12);
          y2 += Math.sin(a + (Math.random() - 0.5) * 0.8) * (10 + Math.random() * 12);
          c.lineTo(x2, y2);
        }
        c.stroke();
      }
    } else if (kind === 'swirl') {
      c.strokeStyle = 'rgba(220,255,246,0.6)';
      for (i = 0; i < 3; i++) {
        c.lineWidth = 1.6 + i;
        c.beginPath();
        for (a = 0; a < Math.PI * 1.8; a += 0.14) {
          r = 6 + a * (9 - i * 1.6);
          var px2 = 64 + Math.cos(a + i * 2.1) * r, py2 = 64 + Math.sin(a + i * 2.1) * r;
          if (a === 0) c.moveTo(px2, py2); else c.lineTo(px2, py2);
        }
        c.stroke();
      }
    } else if (kind === 'star') {
      c.strokeStyle = 'rgba(255,240,190,0.8)';
      for (i = 0; i < 10; i++) {
        a = (i / 10) * Math.PI * 2;
        c.lineWidth = i % 2 ? 1.4 : 2.6;
        c.beginPath(); c.moveTo(64 + Math.cos(a) * 7, 64 + Math.sin(a) * 7);
        c.lineTo(64 + Math.cos(a) * (i % 2 ? 30 : 48), 64 + Math.sin(a) * (i % 2 ? 30 : 48));
        c.stroke();
      }
      c.beginPath();
      c.arc(64, 64, 12, 0, Math.PI * 2);
      c.stroke();
    } else {                              // smoke (sombra)
      blotch('#160a20', 24, 36);
      c.strokeStyle = 'rgba(154,111,211,0.35)';
      c.lineWidth = 2;
      c.beginPath(); c.ellipse(64, 64, 30, 24, 0.7, 0, Math.PI * 2); c.stroke();
    }
    var t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding;
    decalTex[kind] = t;
    return t;
  }
  var decals = [];
  function decal(px, pz, kind) {
    var m = new THREE.MeshBasicMaterial({
      map: getDecalTex(kind), transparent: true, opacity: 0.85,
      depthWrite: false
    });
    var ms = new THREE.Mesh(new THREE.PlaneGeometry(ctx.cell * 0.92, ctx.cell * 0.92), m);
    ms.rotation.x = -Math.PI / 2;
    ms.rotation.z = Math.random() * Math.PI * 2;
    ms.position.set(px, 0.035 + decals.length * 0.0012, pz);
    ms.renderOrder = 8;
    fxG.add(ms);
    decals.push({ ms: ms, age: 0, life: 3.0 });
    if (decals.length > 10) {
      var old = decals.shift();
      fxG.remove(old.ms); old.ms.geometry.dispose(); old.ms.material.dispose();
    }
  }
  function updateDecals(dt) {
    for (var i = decals.length - 1; i >= 0; i--) {
      var d = decals[i];
      d.age += dt;
      var k = d.age / d.life;
      if (k >= 1) {
        fxG.remove(d.ms); d.ms.geometry.dispose(); d.ms.material.dispose();
        decals.splice(i, 1); continue;
      }
      d.ms.material.opacity = 0.85 * (k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
    }
  }

  // ------------------------------------------------------ números de dano
  // fonte GORDA + quique elástico; QA N5: escalonamento REAL — cada número
  // novo nasce num slot deslocado (x/y/atraso de subida) p/ nunca virar "1524"
  var numbers = [];
  var numSlot = 0;
  var NUM_SLOTS = [[0, 0], [-0.85, 0.45], [0.85, 0.55], [-0.45, 0.95], [0.5, 1.0]];
  function number(px, py, pz, text, kind) {
    // kind: 'dmg' | 'crit' | 'heal' | 'shield'
    var cv = document.createElement('canvas');
    cv.width = 224; cv.height = 112;
    var c = cv.getContext('2d');
    var big = kind === 'crit';
    c.font = '900 ' + (big ? 72 : 56) + 'px "Arial Black", Arial, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = big ? 16 : 13;
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(24,12,32,0.98)';                 // contorno GROSSO de tinta
    c.strokeText(text, 112, 58);
    var grad = c.createLinearGradient(0, 20, 0, 92);
    if (kind === 'heal') { grad.addColorStop(0, '#d6ffb8'); grad.addColorStop(1, '#4ed23e'); }
    else if (kind === 'shield') { grad.addColorStop(0, '#eafaff'); grad.addColorStop(1, '#54c8ff'); }
    else if (big) { grad.addColorStop(0, '#fff6c2'); grad.addColorStop(1, '#ff8a1c'); }
    else { grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#ffd253'); }
    c.fillStyle = grad;
    c.fillText(text, 112, 58);
    var tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    tex.minFilter = THREE.LinearFilter;
    var m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    var sp = new THREE.Sprite(m);
    var s = big ? 3.3 : 2.5;
    sp.scale.set(s, s / 2, 1);
    var slot = NUM_SLOTS[numSlot++ % NUM_SLOTS.length];
    sp.position.set(px + slot[0], py + slot[1], pz);
    sp.renderOrder = 95;
    m.rotation = (Math.random() - 0.5) * 0.22;             // inclinadinho de gibi
    fxG.add(sp);
    numbers.push({
      sp: sp, age: 0, life: big ? 1.2 : 1.0, s: s, big: big,
      y0: py + slot[1], tilt: m.rotation
    });
  }
  function updateNumbers(dt) {
    for (var i = numbers.length - 1; i >= 0; i--) {
      var n = numbers[i];
      n.age += dt;
      var k = n.age / n.life;
      if (k >= 1) {
        fxG.remove(n.sp); n.sp.material.map.dispose(); n.sp.material.dispose();
        numbers.splice(i, 1); continue;
      }
      // QUIQUE ELÁSTICO: estoura além do tamanho, rebate 2x e assenta
      var base = n.big ? 1.4 : 1.18, pop;
      if (k < 0.34) {
        var u = k / 0.34;
        pop = base * (1 + Math.sin(u * Math.PI * 2.4) * 0.42 * Math.exp(-u * 2.4));
        if (k < 0.06) pop *= k / 0.06;                     // nasce do nada num pulo
      } else {
        pop = base - (n.big ? 0.18 : 0.1) * ((k - 0.34) / 0.66);
      }
      n.sp.scale.set(n.s * pop, n.s * pop / 2, 1);
      n.sp.position.y = n.y0 + Math.pow(k, 0.8) * 1.05;
      n.sp.material.rotation = n.tilt * (1 - k * 0.7);
      n.sp.material.opacity = k > 0.72 ? 1 - (k - 0.72) / 0.28 : 1;
    }
  }

  // -------------------------------------------------------------- projéteis
  var projectiles = [];
  function projectile(from, to, elem, dur, fxKey) {
    var E = elemOf(elem);
    var core = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 10, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(E.core).convertSRGBToLinear() })
    );
    core.renderOrder = 23;
    var halo = makeSprite(dotTex(), E.glow, 1.8, 0.9);
    core.add(halo);
    core.position.set(from.x, from.y, from.z);
    fxG.add(core);
    var pr = {
      core: core, elem: elem, t: 0, dur: dur || 0.5,
      x0: from.x, y0: from.y, z0: from.z, x1: to.x, y1: to.y != null ? to.y : 0.9, z1: to.z,
      x: from.x, y: from.y, z: from.z,
      arc: (elem === 'earth' || elem === 'water') ? 1.4 : 0.45,
      wave: elem === 'shadow' ? 1 : elem === 'air' ? 2 : 0,
      dead: false, fxKey: fxKey
    };
    var le = acquireLight(E.glow, 2.3, 8, from.x, from.y, from.z, 9);
    if (le) { le.follow = pr; }
    projectiles.push(pr);
    return pr;
  }
  function updateProjectiles(dt) {
    for (var i = projectiles.length - 1; i >= 0; i--) {
      var p = projectiles[i];
      p.t += dt;
      var k = Math.min(p.t / p.dur, 1);
      var x = p.x0 + (p.x1 - p.x0) * k;
      var z = p.z0 + (p.z1 - p.z0) * k;
      var y = p.y0 + (p.y1 - p.y0) * k + Math.sin(k * Math.PI) * p.arc;
      if (p.wave) {
        var dx = p.z1 - p.z0, dz = -(p.x1 - p.x0);
        var dl = Math.sqrt(dx * dx + dz * dz) || 1;
        var off = Math.sin(k * Math.PI * (p.wave * 2 + 1)) * 0.34 * p.wave;
        x += (dx / dl) * off; z += (dz / dl) * off;
      }
      // LINHAS DE VELOCIDADE: núcleo estica na direção do voo (cometa cartoon)
      var mdx = x - p.x, mdy = y - p.y, mdz = z - p.z;
      var ml = Math.sqrt(mdx * mdx + mdy * mdy + mdz * mdz);
      p.x = x; p.y = y; p.z = z;
      p.core.position.set(x, y, z);
      if (ml > 0.0001) {
        p.core.lookAt(x + mdx, y + mdy, z + mdz);
        p.core.scale.set(0.8, 0.8, 2.6);                   // gota esticada
      }
      // rastro: fagulhas + estrelinhas chunky que ficam p/ trás
      var E = elemOf(p.elem);
      var c = colOf(E.spark);
      for (var tr = 0; tr < 2; tr++) {
        spawn(poolAdd, {
          x: x + (Math.random() - 0.5) * 0.1, y: y + (Math.random() - 0.5) * 0.1, z: z + (Math.random() - 0.5) * 0.1,
          vx: -mdx * 16 + (Math.random() - 0.5) * 0.7, vy: -mdy * 16 + (Math.random() - 0.5) * 0.7, vz: -mdz * 16 + (Math.random() - 0.5) * 0.7,
          life: 0.3, s0: 0.26, s1: 0.03, r: c.r, g: c.g, b: c.b, a0: 0.9, grav: 0, drag: 3
        });
      }
      if (Math.random() < 0.5) {
        spawn(poolStar, {
          x: x, y: y, z: z,
          vx: (Math.random() - 0.5) * 1.2, vy: (Math.random() - 0.5) * 1.2, vz: (Math.random() - 0.5) * 1.2,
          life: 0.4, s0: 0.3, s1: 0.06, r: c.r, g: c.g, b: c.b, a0: 0.95, grav: 0, drag: 1.5, tw: 6
        });
      }
      if (k >= 1) {
        p.dead = true;
        fxG.remove(p.core);
        p.core.geometry.dispose(); p.core.material.dispose();
        impact({ x: p.x1, y: p.y1, z: p.z1 }, p.elem, p.fxKey === 'beam' ? 0.8 : 1);
        projectiles.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------- impactos
  function impact(at, elem, power) {
    power = power || 1;
    var E = elemOf(elem);
    // 2 tempos: "POW!" branco (estrela irregular girada) + hit-stop, depois
    // estrelas chunky + anel grosso duplo + fumacinha fofa + decal
    flash(at.x, at.y, at.z, '#ffffff', 2.6 * power, 0.1, powTex(), Math.random() * Math.PI * 2);
    hitStop(0.05, 0.22);
    addShake(3.2 * power);
    later(0.045, function () {
      flash(at.x, at.y + 0.05, at.z, E.glow, 3.4 * power, 0.2, powTex(), Math.random() * Math.PI * 2);
      // ESTRELAS gordas voando (o coração do impacto cartoon)
      burst(poolStar, at.x, at.y, at.z, E.spark, Math.round(12 * power), {
        speed: 5.4 * power, life: 0.62, s0: 0.5, s1: 0.1, grav: E.grav, tw: 4
      });
      burst(poolStar, at.x, at.y, at.z, E.core, 5, { speed: 3, life: 0.42, s0: 0.55, s1: 0.16, grav: 0 });
      burst(poolAdd, at.x, at.y, at.z, E.spark, Math.round(18 * power), {
        speed: 6.4 * power, life: 0.55, s0: 0.26, grav: E.grav, tw: elem === 'fire' ? 9 : 0
      });
      // fumacinhas redondas fofas em anel baixo
      burst(poolSmoke, at.x, Math.max(at.y - 0.4, 0.25), at.z, '#efe6da', 6, {
        speed: 1.7, life: 0.6, s0: 0.34, s1: 0.72, a0: 0.55, grav: 1.8, drag: 1.6, up: 0.35
      });
      if (E.smoke) {
        burst(poolSmoke, at.x, at.y + 0.2, at.z, elem === 'fire' ? '#3a1c0a' : '#241436', 7, {
          speed: 1.1, life: 1.1, s0: 0.38, s1: 0.9, a0: 0.55, grav: 1.4, drag: 1.2
        });
      }
      ring(at.x, at.z, E.glow, 2.9 * power, 0.45);
      ring(at.x, at.z, '#ffffff', 1.9 * power, 0.3, 0.08);
      decal(at.x, at.z, E.decal);
      acquireLight(E.glow, 3.2 * power, 9, at.x, at.y + 0.4, at.z, 0.32);
    });
  }

  // ---------------------------------------------------- poeirinha de saltito
  // usada pelo Renderer a cada aterrissagem do movimento (interna, mesmo dono)
  FX.puff = function (wx, wy, wz, opt) {
    if (!fxG || !poolSmoke) return;
    opt = opt || {};
    var hex = opt.hex || (ctx.theme === 'forge' ? '#dfb49c'
      : ctx.theme === 'cistern' ? '#cfe8e4' : '#ddd4ae');
    var c = colOf(hex);
    var n = opt.n || 4;
    for (var i = 0; i < n; i++) {
      var th = (i / n) * Math.PI * 2 + Math.random() * 0.8;
      spawn(poolSmoke, {
        x: wx + Math.cos(th) * 0.16, y: wy != null ? wy : 0.1, z: wz + Math.sin(th) * 0.16,
        vx: Math.cos(th) * (1.1 + Math.random() * 0.5),
        vy: 0.4 + Math.random() * 0.4,
        vz: Math.sin(th) * (1.1 + Math.random() * 0.5),
        life: 0.5, s0: 0.24, s1: 0.52, r: c.r, g: c.g, b: c.b,
        a0: 0.5, grav: 0.6, drag: 2.6
      });
    }
  };

  // ---------------------------------------------------------- shake/stop
  function addShake(m) { shakeMag = Math.min(shakeMag + m, 14); shakeT = 0; }
  function hitStop(dur, scale) {
    stopT = Math.max(stopT, dur);
    stopScale = Math.min(stopScale, scale);
  }
  FX.getTimeScale = function () { return stopT > 0 ? stopScale : 1; };
  FX.getShake = function () {
    if (shakeMag < 0.05) return { x: 0, y: 0 };
    return {
      x: (Math.sin(nowT * 71) + Math.sin(nowT * 133) * 0.6) * shakeMag * 0.5,
      y: (Math.cos(nowT * 89) + Math.sin(nowT * 151) * 0.6) * shakeMag * 0.5
    };
  };

  // ------------------------------------------------------------- ambiente
  var ambT = 0;
  function ambient(dt) {
    ambT -= dt;
    if (ambT > 0) return;
    var w = ctx.w, h = ctx.h, cell = ctx.cell;
    var px, pz, c;
    if (ctx.theme === 'garden') {
      ambT = 0.16;
      // vagalumes: pontinhos dourados vagando (o "sol" da Estufa)
      c = colOf('#ffd76b');
      px = (Math.random() * (w + 4) - 2) * cell;
      pz = (Math.random() * (h + 4) - 2) * cell;
      spawn(poolAdd, {
        x: px, y: 0.5 + Math.random() * 2.2, z: pz,
        vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.3) * 0.3, vz: (Math.random() - 0.5) * 0.5,
        life: 3.4 + Math.random() * 2, s0: 0.1, s1: 0.07, r: c.r, g: c.g, b: c.b,
        a0: 0.85, grav: 0, drag: 0.1, tw: 5 + Math.random() * 4
      });
      // poeira nos feixes
      c = colOf('#fff3d0');
      spawn(poolAdd, {
        x: (Math.random() * w) * cell, y: 1.5 + Math.random() * 3, z: (Math.random() * h) * cell,
        vx: 0.06, vy: -0.16, vz: 0.03,
        life: 4, s0: 0.05, s1: 0.05, r: c.r, g: c.g, b: c.b, a0: 0.4, grav: 0, drag: 0, tw: 2
      });
    } else if (ctx.theme === 'cistern') {
      ambT = 0.2;
      // bolhas subindo dos canais + névoa fria
      var hole = ctx.holes.length ? ctx.holes[(Math.random() * ctx.holes.length) | 0] : null;
      if (hole) {
        c = colOf('#9ae8ff');
        spawn(poolAdd, {
          x: hole.x * cell + (Math.random() - 0.5) * cell * 0.7,
          y: -0.4, z: hole.y * cell + (Math.random() - 0.5) * cell * 0.7,
          vx: 0, vy: 0.5 + Math.random() * 0.5, vz: 0,
          life: 1.6, s0: 0.07, s1: 0.12, r: c.r, g: c.g, b: c.b, a0: 0.7, grav: 0, drag: 0, tw: 3
        });
      }
      c = colOf('#7ef0d4');
      spawn(poolAdd, {
        x: (Math.random() * w) * cell, y: 0.15, z: (Math.random() * h) * cell,
        vx: (Math.random() - 0.5) * 0.3, vy: 0.05, vz: (Math.random() - 0.5) * 0.3,
        life: 3.2, s0: 0.06, s1: 0.05, r: c.r, g: c.g, b: c.b, a0: 0.35, grav: 0, drag: 0.2, tw: 4
      });
    } else {
      ambT = 0.075;
      // fagulhas sobem das grelhas/fossos; cinza flutua
      var src = ctx.holes.length && Math.random() < 0.6
        ? ctx.holes[(Math.random() * ctx.holes.length) | 0]
        : { x: Math.random() * w, y: Math.random() * h };
      c = colOf(Math.random() < 0.7 ? '#ffb347' : '#ff6a22');
      spawn(poolAdd, {
        x: src.x * cell + (Math.random() - 0.5) * cell,
        y: 0.1, z: src.y * cell + (Math.random() - 0.5) * cell,
        vx: (Math.random() - 0.5) * 0.5, vy: 1.2 + Math.random() * 1.4, vz: (Math.random() - 0.5) * 0.5,
        life: 1.5 + Math.random(), s0: 0.09, s1: 0.03, r: c.r, g: c.g, b: c.b,
        a0: 0.95, grav: 0.45, drag: 0.4, tw: 7 + Math.random() * 6
      });
    }
  }

  // -------------------------------------------------------------- eventos
  function unitOf(uid) {
    var g = JOGO.Game;
    if (!g || !g.state || !g.state.units) return null;
    for (var i = 0; i < g.state.units.length; i++) if (g.state.units[i].uid === uid) return g.state.units[i];
    return null;
  }

  var pendingEvents = [];                 // eventos antes da 1ª cena (replay)
  FX.handleEvent = function (ev) {
    if (!ev) return;
    if (!fxG) {                           // cena ainda não montada: guarda
      if (ev.type !== 'battleStart' && ev.type !== 'battleEnd' && pendingEvents.length < 64) {
        pendingEvents.push(ev);
      }
      return;
    }
    switch (ev.type) {
      case 'battleStart':
        resetTransient();
        break;
      case 'cast': (function () {
        var caster = anchor(ev.uid);
        var elem = ev.element || 'neutral';
        var E = elemOf(elem);
        var key = ev.fxKey || 'slam';
        var tgt = tileWorld(ev.x, ev.y);
        tgt.y = 0.55;
        var tu = null, gst = JOGO.Game && JOGO.Game.state;
        if (gst && JOGO.Engine && JOGO.Engine.unitAt) {
          try { tu = JOGO.Engine.unitAt(gst, ev.x, ev.y); } catch (e2) { tu = null; }
        }
        if (tu) { var ta = anchor(tu.uid); tgt.x = ta.x; tgt.y = ta.y; tgt.z = ta.z; }
        // tempo 1 — WINDUP no conjurador: partículas convergem + brilho
        var wi;
        for (wi = 0; wi < 16; wi++) {
          var wth = Math.random() * Math.PI * 2, wr = 0.8 + Math.random() * 0.5;
          var wc = colOf(E.spark);
          spawn(poolAdd, {
            x: caster.x + Math.cos(wth) * wr, y: caster.y + (Math.random() - 0.4) * 0.8, z: caster.z + Math.sin(wth) * wr,
            vx: -Math.cos(wth) * 3.2, vy: (0.4 - Math.random() * 0.8), vz: -Math.sin(wth) * 3.2,
            life: 0.28, s0: 0.22, s1: 0.06, r: wc.r, g: wc.g, b: wc.b, a0: 0.95, grav: 0, drag: 0.4
          });
        }
        flash(caster.x, caster.y + 0.25, caster.z, E.glow, 1.8, 0.26, dotTex());
        acquireLight(E.glow, 1.4, 6, caster.x, caster.y + 0.4, caster.z, 0.28);
        // tempo 2 — PAYLOAD por fxKey
        var hd = hitDelay();
        if (key === 'bolt' || key === 'hook') {
          later(0.02, function () { projectile(caster, tgt, elem, Math.max(hd, 0.3), key); });
        } else if (key === 'beam') {
          later(0.1, function () {
            beamLine(caster, tgt, E);
            later(0.1, function () { impact(tgt, elem, 0.9); });
          });
        } else if (key === 'nova' || key === 'burst') {
          later(hd, function () {
            impact(tgt, elem, 1.25);
            ring(tgt.x, tgt.z, E.glow, 3.6, 0.6);
            ring(tgt.x, tgt.z, E.core, 2.4, 0.45);
          });
        } else if (key === 'gust') {
          later(hd * 0.7, function () {
            windCone(caster, tgt, E);
          });
        } else if (key === 'heal') {
          later(hd * 0.8, function () { columnRise(tgt, '#7ac26a', '#c8ffb0', 20); });
        } else if (key === 'buff') {
          later(hd * 0.8, function () { columnRise(tgt, '#ffd98a', '#fff3c0', 16); });
        } else if (key === 'debuff') {
          later(hd * 0.8, function () { columnSink(tgt, '#9a6fd3', 16); });
        } else if (key === 'shieldFx') {
          later(hd * 0.8, function () {
            ring(tgt.x, tgt.z, '#6ac8f0', 1.6, 0.5);
            burst(poolAdd, tgt.x, tgt.y, tgt.z, '#bfe8ff', 14, { speed: 1.6, life: 0.7, s0: 0.16, grav: 2, drag: 2 });
          });
        } else if (key === 'summonFx') {
          later(hd * 0.9, function () {
            ring(tgt.x, tgt.z, E.glow, 1.9, 0.55);
            burst(poolAdd, tgt.x, 0.25, tgt.z, E.spark, 20, { speed: 2.4, life: 0.7, s0: 0.16, grav: 3.4, up: 1.4 });
          });
        } else if (key === 'poisonCloud') {
          later(hd, function () {
            impact(tgt, elem, 0.7);
            // QA N6: contraste em qualquer tema — bolhas VIOLETA saturadas fofas
            // + motas verde-limão gordas + anel de leitura, em 3 ONDAS (a nuvem
            // borbulha ~2s em vez de um sopro único que a caustica engole)
            var poisonWave = function (mult) {
              for (var pc = 0; pc < 8; pc++) {
                burst(poolSmoke, tgt.x + (Math.random() - 0.5) * 1.6, 0.35, tgt.z + (Math.random() - 0.5) * 1.6,
                  '#5a2492', 2, { speed: 0.5, life: 1.9, s0: 0.55, s1: 1.25, a0: 0.85 * mult, grav: 0.28, drag: 0.6 });
              }
              burst(poolAdd, tgt.x, 0.5, tgt.z, '#c8ff4a', 14,
                { speed: 1.3, life: 1.5, s0: 0.32, s1: 0.08, a0: mult, grav: 0.5, drag: 0.7, tw: 5 });
              burst(poolStar, tgt.x, 0.7, tgt.z, '#b4f04a', 5,
                { speed: 1.1, life: 1.1, s0: 0.42, s1: 0.1, a0: 0.95 * mult, grav: 0.6, drag: 0.8, tw: 4 });
            };
            poisonWave(1);
            later(0.55, function () { poisonWave(0.8); ring(tgt.x, tgt.z, '#8ae03c', 1.6, 0.4); });
            later(1.1, function () { poisonWave(0.6); });
            ring(tgt.x, tgt.z, '#8ae03c', 2.2, 0.55);
          });
        } else if (key === 'veil' || key === 'blink') {
          later(hd * 0.6, function () {
            burst(poolAdd, caster.x, caster.y, caster.z, E.core, 18, { speed: 1.8, life: 0.5, s0: 0.15, grav: 1.5 });
          });
        } else {                              // slam e afins: pancada no alvo
          later(hd, function () { impact(tgt, elem, 1); });
        }
      })(); break;
      case 'damage': (function () {
        var uid = ev.uid, amt = ev.amount, elem = ev.element || 'neutral';
        var crit = amt >= 30;
        later(hitDelay(), function () {
          var at = anchor(uid, 'head');
          number(at.x, at.y + 0.25, at.z, String(amt), crit ? 'crit' : 'dmg');
          var E = elemOf(elem);
          burst(poolAdd, at.x, at.y - 0.5, at.z, E.spark, crit ? 18 : 10, { speed: 3.0, life: 0.42, s0: 0.22, grav: E.grav * 0.6 });
          if (crit) { addShake(4.5); hitStop(0.07, 0.18); flash(at.x, at.y - 0.4, at.z, '#ffffff', 1.9, 0.12); }
        });
      })(); break;
      case 'heal': (function () {
        var uid = ev.uid, amt = ev.amount;
        later(0.12, function () {
          var at = anchor(uid, 'head');
          number(at.x, at.y + 0.25, at.z, '+' + amt, 'heal');
          columnRise(anchor(uid), '#7ac26a', '#c8ffb0', 14);
        });
      })(); break;
      case 'shield': (function () {
        var uid = ev.uid, amt = ev.amount;
        later(0.1, function () {
          var at = anchor(uid, 'head');
          number(at.x, at.y + 0.25, at.z, String(amt), 'shield');
          ring(at.x, at.z, '#6ac8f0', 1.5, 0.45);
        });
      })(); break;
      case 'effectApplied': (function () {
        var eff = ev.effect || {};
        var uid = ev.uid;
        later(0.1, function () {
          var at = anchor(uid);
          if (eff.type === 'poison') {
            burst(poolSmoke, at.x, at.y, at.z, '#2a1442', 5, { speed: 0.8, life: 1.4, s0: 0.32, s1: 0.62, a0: 0.6, grav: 0.6 });
            burst(poolAdd, at.x, at.y, at.z, '#b4f04a', 7, { speed: 1.0, life: 1.0, s0: 0.16, s1: 0.05, a0: 0.9, grav: 0.8, tw: 5 });
          }
          else if (eff.type === 'invisible') burst(poolAdd, at.x, at.y, at.z, '#eef7f5', 16, { speed: 1.6, life: 0.6, s0: 0.14, grav: 1 });
          else if (eff.type === 'taunt') flash(at.x, at.y + 0.7, at.z, '#ff6a4a', 1.2, 0.3);
          else if (eff.type === 'buff' && eff.value > 0) columnRise(at, '#ffd98a', '#fff3c0', 10);
          else if (eff.type === 'buff') columnSink(at, '#9a6fd3', 10);
        });
      })(); break;
      case 'pushed': (function () {
        var to = tileWorld(ev.toX, ev.toY);
        var dur = 0.09 * (Math.abs(ev.toX - ev.fromX) + Math.abs(ev.toY - ev.fromY)) + 0.1;
        var coll = ev.collision;
        later(dur, function () {
          burst(poolAdd, to.x, 0.2, to.z, '#d8d0c0', coll ? 16 : 8, { speed: 2.6, life: 0.4, s0: 0.15, grav: -7, up: 0.7 });
          if (coll) { addShake(4); ring(to.x, to.z, '#d8d0c0', 1.4, 0.35); }
        });
      })(); break;
      case 'teleport': (function () {
        var from = tileWorld(ev.fromX, ev.fromY);
        var to = tileWorld(ev.toX, ev.toY);
        burst(poolAdd, from.x, 0.9, from.z, '#ffc86a', 16, { speed: 1.8, life: 0.45, s0: 0.15, grav: 2 });
        later(0.21, function () {
          burst(poolAdd, to.x, 0.9, to.z, '#ffc86a', 20, { speed: 2.2, life: 0.5, s0: 0.16, grav: 2 });
          ring(to.x, to.z, '#ffc86a', 1.4, 0.4);
        });
      })(); break;
      case 'summon': (function () {
        if (!ev.unit) return;
        var at = tileWorld(ev.unit.x, ev.unit.y);
        ring(at.x, at.z, '#8fd4a0', 1.7, 0.5);
        burst(poolAdd, at.x, 0.3, at.z, '#b9e89a', 18, { speed: 2.2, life: 0.6, s0: 0.15, grav: 3, up: 1.5 });
      })(); break;
      case 'death': (function () {
        var uid = ev.uid;
        var su = unitOf(uid);
        var boss = su && su.boss;
        later(0.3, function () {
          var at = anchor(uid);
          if (boss) {
            // MORTE DE CHEFE cinematográfica
            flash(at.x, at.y + 0.4, at.z, '#ffffff', 6.5, 0.3);
            hitStop(0.24, 0.12);
            addShake(13);
            acquireLight('#fff3d0', 4.5, 16, at.x, at.y + 1, at.z, 1.1);
            var hue = ctx.theme === 'forge' ? '#ff9a3c' : ctx.theme === 'cistern' ? '#7ef0d4' : '#ffd76b';
            ring(at.x, at.z, hue, 4.6, 0.9);
            later(0.18, function () { ring(at.x, at.z, '#ffffff', 6.2, 1.0); });
            later(0.38, function () { ring(at.x, at.z, hue, 8.2, 1.2); addShake(6); });
            burst(poolStar, at.x, at.y + 0.4, at.z, hue, 22, { speed: 5.8, life: 1.1, s0: 0.6, s1: 0.14, grav: -3.4, up: 1.2, tw: 5 });
            burst(poolStar, at.x, at.y + 0.4, at.z, '#ffffff', 10, { speed: 3.4, life: 0.7, s0: 0.55, s1: 0.16, grav: -2 });
            burst(poolAdd, at.x, at.y, at.z, hue, 46, { speed: 6.4, life: 1.2, s0: 0.24, grav: -3, up: 1.1, tw: 6 });
            burst(poolSmoke, at.x, at.y, at.z, '#2a2030', 14, { speed: 1.6, life: 1.8, s0: 0.5, s1: 1.3, a0: 0.55, grav: 0.9 });
          } else {
            var hue2 = su && su.side === 'player' ? '#ffd98a' : '#c85a6a';
            flash(at.x, at.y, at.z, hue2, 2.0, 0.2, powTex(), Math.random() * Math.PI * 2);
            burst(poolStar, at.x, at.y, at.z, hue2, 8, { speed: 3.4, life: 0.7, s0: 0.5, s1: 0.12, grav: -2.6, up: 0.9, tw: 5 });
            burst(poolAdd, at.x, at.y, at.z, hue2, 20, { speed: 3.2, life: 0.8, s0: 0.17, grav: -2.4, up: 0.9, tw: 5 });
            burst(poolSmoke, at.x, at.y, at.z, '#2a2232', 6, { speed: 1, life: 1.3, s0: 0.4, s1: 0.9, a0: 0.45, grav: 1 });
            addShake(2.4);
          }
        });
      })(); break;
      case 'battleEnd':
        // não segura nada: transientes seguem até morrer sozinhos, filas limpam
        delayed.length = 0;
        // vitória: estrelinhas douradas sobre os heróis (par do pulinho)
        if (ev.winner === 'player') {
          var gst2 = JOGO.Game && JOGO.Game.state;
          if (gst2 && gst2.units) {
            for (var wu = 0; wu < gst2.units.length; wu++) {
              var hu = gst2.units[wu];
              if (hu.side !== 'player' || !hu.alive) continue;
              var ha = anchor(hu.uid, 'head');
              burst(poolStar, ha.x, ha.y + 0.5, ha.z, '#ffd253', 8,
                { speed: 2.6, life: 0.9, s0: 0.42, s1: 0.1, grav: -2.2, up: 1.4, tw: 5 });
              columnRise({ x: ha.x, z: ha.z }, '#ffd98a', '#fff6c2', 10);
            }
          }
        }
        break;
    }
  };

  // feixe reto instantâneo (beam): quad esticado + glow
  function beamLine(from, to, E) {
    var dx = to.x - from.x, dy = (to.y - from.y), dz = to.z - from.z;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(E.core).convertSRGBToLinear(),
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.95, depthWrite: false
    });
    var geo = new THREE.CylinderGeometry(0.06, 0.06, len, 6, 1, true);
    geo.rotateZ(Math.PI / 2);                    // eixo → X
    var beam = new THREE.Mesh(geo, m);
    beam.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    beam.lookAt(to.x, to.y, to.z);
    beam.rotateY(Math.PI / 2);
    beam.renderOrder = 22;
    fxG.add(beam);
    flashes.push({ sp: beam, age: 0, life: 0.22, s0: 1, s1: 1, a0: 0.95, isMesh: true });
    // brilho ao longo
    var c = colOf(E.spark);
    for (var i = 0; i < 14; i++) {
      var k = i / 14;
      spawn(poolAdd, {
        x: from.x + dx * k, y: from.y + dy * k, z: from.z + dz * k,
        vx: (Math.random() - 0.5), vy: (Math.random() - 0.5), vz: (Math.random() - 0.5),
        life: 0.4, s0: 0.16, s1: 0.03, r: c.r, g: c.g, b: c.b, a0: 0.9, grav: 0, drag: 2
      });
    }
  }
  // cone de vento (gust)
  function windCone(from, to, E) {
    var dx = to.x - from.x, dz = to.z - from.z;
    var dl = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= dl; dz /= dl;
    var c = colOf(E.core);
    for (var i = 0; i < 26; i++) {
      var spr = 0.55 * (Math.random() - 0.5);
      var px = -dz * spr, pz = dx * spr;
      var sp2 = 6 + Math.random() * 4;
      spawn(poolAdd, {
        x: from.x + dx * 0.5 + px, y: 0.5 + Math.random() * 0.8, z: from.z + dz * 0.5 + pz,
        vx: dx * sp2 + px * 3, vy: (Math.random() - 0.3) * 1.2, vz: dz * sp2 + pz * 3,
        life: 0.42, s0: 0.2, s1: 0.04, r: c.r, g: c.g, b: c.b, a0: 0.8, grav: 0, drag: 1.4
      });
    }
    addShake(2);
  }
  // coluna que sobe (cura/buff) e que afunda (debuff)
  function columnRise(at, hexA, hexB, n) {
    for (var i = 0; i < n; i++) {
      var c = colOf(i % 2 ? hexA : hexB);
      var th = Math.random() * Math.PI * 2, r = 0.25 + Math.random() * 0.45;
      spawn(poolAdd, {
        x: at.x + Math.cos(th) * r, y: 0.15 + Math.random() * 0.4, z: at.z + Math.sin(th) * r,
        vx: 0, vy: 1.6 + Math.random() * 1.2, vz: 0,
        life: 0.8 + Math.random() * 0.4, s0: 0.15, s1: 0.05, r: c.r, g: c.g, b: c.b,
        a0: 0.95, grav: 0, drag: 0.4, tw: 4
      });
    }
    ring(at.x, at.z, hexA, 1.3, 0.5);
  }
  function columnSink(at, hex, n) {
    for (var i = 0; i < n; i++) {
      var c = colOf(hex);
      var th = Math.random() * Math.PI * 2, r = 0.2 + Math.random() * 0.4;
      spawn(poolAdd, {
        x: at.x + Math.cos(th) * r, y: 1.6 + Math.random() * 0.6, z: at.z + Math.sin(th) * r,
        vx: 0, vy: -1.6 - Math.random(), vz: 0,
        life: 0.7, s0: 0.14, s1: 0.05, r: c.r, g: c.g, b: c.b, a0: 0.9, grav: 0, drag: 0.4
      });
    }
  }

  // ------------------------------------------------- integração c/ Renderer
  FX.bind = function (renderer) { glr = renderer; };
  FX.resize = function (w, h, pr) {
    W = w; H = h; PR = pr || 1;
    if (composer) {
      composer.setPixelRatio(PR);
      composer.setSize(W, H);
      if (bloomPass) bloomPass.setSize(Math.max(W >> 1, 2), Math.max(H >> 1, 2));
    }
    if (poolAdd) poolAdd.mat.uniforms.uScaleH.value = H * PR * 0.9;
    if (poolSmoke) poolSmoke.mat.uniforms.uScaleH.value = H * PR * 0.9;
    if (poolStar) poolStar.mat.uniforms.uScaleH.value = H * PR * 0.9;
  };
  FX.onScene = function (c) {
    if (!hasTHREE) return;
    scene = c.scene; camera = c.camera;
    ctx.theme = c.theme || 'garden';
    ctx.cell = c.cell || 2;
    ctx.w = c.w || 13; ctx.h = c.h || 11;
    ctx.holes = c.holes || [];
    ensureInfra();
    resetTransient();
    if (pendingEvents.length) {           // replay do que chegou cedo demais
      var pend = pendingEvents;
      pendingEvents = [];
      for (var pi = 0; pi < pend.length; pi++) FX.handleEvent(pend[pi]);
    }
  };
  function ensureInfra() {
    if (!fxG) {
      fxG = new THREE.Group();
      poolAdd = makePool(1024, THREE.AdditiveBlending, dotTex());
      poolSmoke = makePool(256, THREE.NormalBlending, puffTex());   // fofa e redonda
      poolStar = makePool(256, THREE.AdditiveBlending, chunkTex()); // estrelas chunky
      poolAdd.mat.uniforms.uScaleH.value = H * PR * 0.9;
      poolSmoke.mat.uniforms.uScaleH.value = H * PR * 0.9;
      poolStar.mat.uniforms.uScaleH.value = H * PR * 0.9;
      fxG.add(poolAdd.mesh);
      fxG.add(poolSmoke.mesh);
      fxG.add(poolStar.mesh);
      for (var i = 0; i < 2; i++) {
        var l = new THREE.PointLight(0xffffff, 0, 6, 2);
        l.position.set(0, -50, 0);
        fxLights.push({ l: l, busy: false, t: 0, dur: 0, base: 0, follow: null });
        fxG.add(l);
      }
    }
    if (fxG.parent !== scene) scene.add(fxG);
    if (!composer && glr && THREE.EffectComposer && THREE.RenderPass && THREE.UnrealBloomPass) {
      composer = new THREE.EffectComposer(glr);
      renderPass = new THREE.RenderPass(scene, camera);
      // bloom em MEIA resolução: mesmo visual borrado, metade do custo
      // threshold mais alto: sob tone-mapping LINEAR as superfícies toon claras
      // passam de 0.82 — só emissivos de verdade (chamas/núcleos) estouram
      bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(Math.max(W >> 1, 2), Math.max(H >> 1, 2)), 0.55, 0.34, 0.96);
      composer.addPass(renderPass);
      composer.addPass(bloomPass);
      composer.setPixelRatio(PR);
      composer.setSize(Math.max(W, 2), Math.max(H, 2));
      // composer.setSize sobrescreve o tamanho dos passes → re-encolhe o bloom
      bloomPass.setSize(Math.max(W >> 1, 2), Math.max(H >> 1, 2));
    }
  }
  function resetTransient() {
    delayed.length = 0;
    var i;
    for (i = projectiles.length - 1; i >= 0; i--) {
      fxG.remove(projectiles[i].core);
      projectiles[i].dead = true;
    }
    projectiles.length = 0;
    for (i = flashes.length - 1; i >= 0; i--) fxG.remove(flashes[i].sp);
    flashes.length = 0;
    for (i = rings.length - 1; i >= 0; i--) fxG.remove(rings[i].ms);
    rings.length = 0;
    for (i = decals.length - 1; i >= 0; i--) fxG.remove(decals[i].ms);
    decals.length = 0;
    for (i = numbers.length - 1; i >= 0; i--) fxG.remove(numbers[i].sp);
    numbers.length = 0;
    for (i = 0; i < fxLights.length; i++) { fxLights[i].busy = false; fxLights[i].follow = null; fxLights[i].l.intensity = 0; }
    if (poolAdd) { poolAdd.list.length = 0; poolAdd.geo.setDrawRange(0, 0); }
    if (poolSmoke) { poolSmoke.list.length = 0; poolSmoke.geo.setDrawRange(0, 0); }
    if (poolStar) { poolStar.list.length = 0; poolStar.geo.setDrawRange(0, 0); }
    numSlot = 0;
    shakeMag = 0; stopT = 0; stopScale = 1;
  }

  // update: recebe dt REAL (sem hit-stop) — o FX aplica o próprio timescale
  FX.update = function (dt, t) {
    if (!fxG) return;
    nowT = t != null ? t : nowT + dt;
    // hit-stop conta em tempo real
    if (stopT > 0) { stopT -= dt; if (stopT <= 0) { stopT = 0; stopScale = 1; } }
    var ts = FX.getTimeScale();
    var dtv = dt * ts;
    shakeT += dt;
    shakeMag *= Math.pow(0.0006, dt);           // decai rápido
    for (var i = delayed.length - 1; i >= 0; i--) {
      delayed[i].t -= dtv;
      if (delayed[i].t <= 0) { var fn = delayed[i].fn; delayed.splice(i, 1); fn(); }
    }
    updateProjectiles(dtv);
    updatePool(poolAdd, dtv);
    updatePool(poolSmoke, dtv);
    updatePool(poolStar, dtv);
    updateFlashes(dtv);
    updateRings(dtv);
    updateDecals(dtv);
    updateNumbers(dtv);
    updateLights(dtv);
    ambient(dtv);
  };

  // render com bloom (retorna false p/ o Renderer usar o caminho simples)
  FX.render = function (sc, cam2, dt) {
    if (!composer) return false;
    renderPass.scene = sc;
    renderPass.camera = cam2;
    composer.render(dt);
    return true;
  };

  // ganchos legados/sondas
  FX.setAmbient = function (theme) { ctx.theme = theme || ctx.theme; };
  FX._debug = function () {
    return {
      particles: poolAdd ? poolAdd.list.length : 0,
      smoke: poolSmoke ? poolSmoke.list.length : 0,
      projectiles: projectiles.length,
      decals: decals.length,
      numbers: numbers.length,
      rings: rings.length,
      composer: !!composer
    };
  };

  JOGO.FX = FX;
})();
