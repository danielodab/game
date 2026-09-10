var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// JOGO.Renderer (3D real / Three.js) — dono: Agente Designer 3D
//
//   MESMA API do contrato (o jogo roda sem tocar em core/hud):
//     Renderer.init(canvasEl) / render(dt) / handleEvent(ev) / isBusy()
//     Renderer.project(gx, gy, z) -> {x, y, d, s}     (p/ HUD e FX)
//     Renderer.unitWorld(uid) -> {x, y} | null         (coords de GRID)
//     Renderer.setCamera({ang, tilt, zoom})            (páginas de teste)
//     Renderer.hitDelay() -> s                          (FX sincroniza impacto)
//
//   · Cena por batalha: tabuleiro do state, chão ESTENDIDO ao redor (o campo
//     é um lugar), paredes reais com sombra, buracos, props de borda, névoa.
//   · Luz: hemisférica + direcional com sombras (2048, PCFSoft) + pontuais
//     temáticas. Fundo/névoa por tema.
//   · Câmera: PerspectiveCamera orbitando pivô FIXO no centro do tabuleiro.
//     Arrasto gira 360° e inclina (polar clampado ~[0.9, 1.35] do zênite);
//     roda = dolly clampado; clique < 6px = ação; raycast no plano y=0 →
//     Game.onTileClicked/onTileHover; input ignorado sobre #ui-root (B5).
//   · handleEvent: move (célula a célula ~10 cél/s com virada suave), cast
//     (pose 2 tempos), damage (flash + knockback), death (dissolve + remoção),
//     teleport/pushed/summon. Watchdog de 3 s por animação (B2).
// ============================================================================

(function () {
  'use strict';
  if (typeof THREE === 'undefined') { console.error('Renderer3D: THREE ausente'); return; }

  var R = {};
  var canvas = null, renderer = null, scene = null, camera = null;
  var W = 2, H = 2;

  var CELL = 2;        // sincronizado com Models3D.CELL no init
  var HOP_RATE = 5.2;  // SALTITOS por segundo (movimento aos saltinhos, não deslizar)
  var HOP_H = 0.34;    // altura do arco do saltito
  var CAST_DUR = 0.66; // conjuração com antecipação → lançamento → follow-through
  var ANIM_WATCHDOG = 3.0;

  // câmera orbital: pivô FIXO no centro do tabuleiro
  var cam = {
    ang: -0.62,          // azimute
    tilt: 1.08,          // ângulo polar a partir do zênite (clamp 0.9..1.35)
    zoom: 26,            // distância ao pivô (clamp por sala)
    minZoom: 10, maxZoom: 44,
    pivot: new THREE.Vector3(0, 0, 0)
  };
  var shake = { x: 0, y: 0 };

  // grupos da cena
  var boardG = null, unitsG = null, overlayG = null;
  var lights = { hemi: null, dir: null, rim: null, points: [], spots: [], torches: [] };
  var curRoomKey = null, curTheme = null;
  var envDome = null;                 // fundo em gradiente (não-preto)
  var flickerSprites = [];            // halos que tremulam
  var scrollMats = [];                // texturas que rolam (cortina d'água)
  var causticsMat = null;             // cáusticas da cisterna
  var fillerLights = [];              // pool anti-recompile (contagem estável)

  // unidades: uid -> { obj:{group,animate,boss}, hp bar, vis {...} }
  var units = {};
  var animQ = [];
  var delayed = [];
  var lastAtk = null;
  var lastHitDelay = 0.26;
  var nowT = 0;
  var frameNo = 0;

  var ELEM = {
    fire: '#ff7a3c', water: '#4ac8e8', earth: '#c8a04a', air: '#b8e8e0',
    light: '#ffe9a0', shadow: '#9a6fd3', neutral: '#d8d0c0'
  };
  // TOON high-key: cena CLARA e legível como desenho animado. Key suave +
  // fill hemisférico saturado; o chão do hemisfério é AZUL/ROXO — sombras
  // COLORIDAS, nunca cinza lamacento. Névoa colorida, fundo em gradiente.
  var THEME_ENV = {
    garden:  { fog: '#2c4420', horizon: '#4e7030', zenith: '#0e180a',
               hemiSky: '#a8c887', hemiGnd: '#2c3c66', hemiI: 0.8,
               sun: '#fff0c2', sunI: 0.92, rim: '#a8ffc0', rimI: 0.45, exposure: 1.02 },
    cistern: { fog: '#14485c', horizon: '#20647c', zenith: '#061018',
               hemiSky: '#7ec0da', hemiGnd: '#20265c', hemiI: 0.85,
               sun: '#e2f4f8', sunI: 0.85, rim: '#7ef0d4', rimI: 0.5, exposure: 1.04 },
    forge:   { fog: '#4c1c0c', horizon: '#7c3012', zenith: '#160604',
               hemiSky: '#e09668', hemiGnd: '#46205c', hemiI: 0.8,
               sun: '#ffd8a0', sunI: 0.88, rim: '#ff9a5a', rimI: 0.45, exposure: 1.04 }
  };

  // ------------------------------------------------------------- helpers
  function game() { return JOGO.Game || null; }
  function engine() { return JOGO.Engine || null; }
  function state() { var g = game(); return (g && g.state) || null; }
  function models() { return JOGO.Models3D || null; }
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
  function normTheme(t) {
    if (t === 'greenhouse') return 'garden';
    if (t === 'emberlock') return 'forge';
    return t || 'garden';
  }
  function gx2w(x) { return x * CELL; }     // grid → mundo (tile center)
  function gz2w(y) { return y * CELL; }
  function hashXY(x, y) { return ((x * 73856093) ^ (y * 19349663)) >>> 0; }
  function srand(seed) {
    var s = (seed == null ? 1 : seed) >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function angLerp(a, b, k) {
    var d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
  }
  function disposeDeep(root) {
    root.traverse(function (n) {
      if (n.isMesh) {
        if (n.geometry) n.geometry.dispose();
        var m = n.material;
        if (Array.isArray(m)) m.forEach(function (mm) { if (mm.map) mm.map.dispose(); mm.dispose(); });
        else if (m) { if (m.map) m.map.dispose(); m.dispose(); }
      }
      if (n.isSprite && n.material) {
        if (n.material.map) n.material.map.dispose();
        n.material.dispose();
      }
    });
  }

  // ------------------------------------------------------------- init
  var mouse = { down: false, sx: 0, sy: 0, dragging: false, lx: 0, ly: 0, mx: -1, my: -1, hoverDirty: false };
  function overUI(e) {
    var t = e.target;
    return !!(t && t.closest && t.closest('#ui-root'));
  }

  R.init = function (canvasEl) {
    canvas = canvasEl;
    if (!canvas) return;
    var M = models();
    if (M && M.CELL) CELL = M.CELL;
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      preserveDrawingBuffer: !!window.__preserve3d
    });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;   // (Soft custa ~2x no fill)
    renderer.shadowMap.autoUpdate = false;          // sombra sob demanda (perf)
    renderer.outputEncoding = THREE.sRGBEncoding;
    // TOON: linear em vez de ACES — ACES dessatura os chapados e os emissivos;
    // cartoon quer cor VIVA e chapada (clamp em branco é bem-vindo)
    renderer.toneMapping = THREE.LinearToneMapping;
    renderer.toneMappingExposure = 1.08;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(46, 1, 0.5, 400);
    if (JOGO.FX && JOGO.FX.bind) JOGO.FX.bind(renderer);   // composer de bloom do FX
    resize();
    window.addEventListener('resize', resize);

    canvas.addEventListener('mousedown', function (e) {
      mouse.down = true; mouse.dragging = false;
      mouse.sx = e.clientX; mouse.sy = e.clientY;
      mouse.lx = e.clientX; mouse.ly = e.clientY;
    });
    window.addEventListener('mousemove', function (e) {
      if (mouse.down) {
        var dx = e.clientX - mouse.sx, dy = e.clientY - mouse.sy;
        if (!mouse.dragging && dx * dx + dy * dy > 36) mouse.dragging = true;
        if (mouse.dragging) {
          cam.ang -= (e.clientX - mouse.lx) * 0.0085;
          cam.tilt = Math.max(0.9, Math.min(1.35, cam.tilt - (e.clientY - mouse.ly) * 0.0042));
        }
        mouse.lx = e.clientX; mouse.ly = e.clientY;
      } else {
        var g = game();
        if (g && g.onTileHover) {
          if (overUI(e)) { g.onTileHover(-1, -1); return; }   // B5
          var rct = canvas.getBoundingClientRect();
          mouse.mx = e.clientX - rct.left; mouse.my = e.clientY - rct.top;
          mouse.hoverDirty = true;
        }
      }
    });
    window.addEventListener('mouseup', function (e) {
      if (!mouse.down) return;
      mouse.down = false;
      if (!mouse.dragging) {
        if (overUI(e)) { mouse.dragging = false; return; }    // B5
        var g = game();
        if (g && g.onTileClicked && !R.isBusy()) {
          var rct = canvas.getBoundingClientRect();
          var t = pickTile(e.clientX - rct.left, e.clientY - rct.top);
          if (t) g.onTileClicked(t.x, t.y);
        }
      }
      mouse.dragging = false;
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      cam.zoom = Math.max(cam.minZoom, Math.min(cam.maxZoom, cam.zoom * Math.exp(e.deltaY * 0.0011)));
    }, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  };

  function resize() {
    if (!renderer) return;
    var r = canvas.parentElement ? canvas.parentElement.getBoundingClientRect()
      : { width: window.innerWidth, height: window.innerHeight };
    W = Math.max(r.width, 320); H = Math.max(r.height, 240);
    var pr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(pr);
    renderer.setSize(W, H, true);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    if (JOGO.FX && JOGO.FX.resize) JOGO.FX.resize(W, H, pr);
  }

  R.setCamera = function (o) {
    if (!o) return;
    if (o.ang != null) cam.ang = o.ang;
    if (o.tilt != null) cam.tilt = Math.max(0.9, Math.min(1.35, o.tilt));
    if (o.zoom != null) cam.zoom = Math.max(cam.minZoom, Math.min(cam.maxZoom, o.zoom));
  };

  function updateCamera() {
    var sp = Math.sin(cam.tilt), cp = Math.cos(cam.tilt);
    camera.position.set(
      cam.pivot.x + cam.zoom * sp * Math.sin(cam.ang),
      cam.pivot.y + cam.zoom * cp,
      cam.pivot.z + cam.zoom * sp * Math.cos(cam.ang)
    );
    camera.lookAt(cam.pivot);
    // shake do FX (opcional, fase B) em espaço de tela
    if (shake.x || shake.y) {
      var right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      var up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      camera.position.addScaledVector(right, shake.x * 0.02);
      camera.position.addScaledVector(up, -shake.y * 0.02);
    }
  }

  // raycast no plano y=0 → célula do grid
  var raycaster = new THREE.Raycaster();
  var ndc = new THREE.Vector2();
  function pickTile(px, py) {
    if (!camera) return null;
    ndc.x = (px / W) * 2 - 1;
    ndc.y = -(py / H) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    var o = raycaster.ray.origin, d = raycaster.ray.direction;
    if (Math.abs(d.y) < 1e-6) return null;
    var t = -o.y / d.y;
    if (t < 0) return null;
    var wx = o.x + d.x * t, wz = o.z + d.z * t;
    return { x: Math.round(wx / CELL), y: Math.round(wz / CELL) };
  }

  // projeção p/ HUD/FX: coords de tela do centro da célula (z = altura no mundo)
  var projV = new THREE.Vector3();
  R.project = function (gx, gy, z) {
    if (!camera) return { x: 0, y: 0, d: 0, s: 1 };
    projV.set(gx2w(gx), z || 0, gz2w(gy));
    var dist = projV.distanceTo(camera.position);
    projV.project(camera);
    return {
      x: (projV.x + 1) / 2 * W,
      y: (-projV.y + 1) / 2 * H,
      d: dist,
      s: (H * 1.05) / Math.max(dist, 0.001)     // fator de escala aproximado p/ FX
    };
  };

  R.unitWorld = function (uid) {
    var u = units[uid];
    if (u) return { x: u.vis.x, y: u.vis.y };
    var su = findUnit(uid);
    return su ? { x: su.x, y: su.y } : null;
  };

  // ------------------------------------------------------------- eventos
  R.handleEvent = function (ev) {
    if (!ev) return;
    switch (ev.type) {
      case 'battleStart': {
        var st = ev.state || state();
        animQ.length = 0; delayed.length = 0;
        lastAtk = null; lastHitDelay = 0.26;
        curRoomKey = null;                       // força rebuild da cena
        if (st && st.grid) {
          cam.ang = -0.62; cam.tilt = 1.08;
          fitCamera(st);
        }
        break;
      }
      case 'move':
        if (ev.path && ev.path.length) {
          animQ.push({ kind: 'move', uid: ev.uid, path: ev.path.slice(), k: 0, seg: 0, age: 0 });
        }
        break;
      case 'cast': {
        animQ.push({ kind: 'cast', uid: ev.uid, tx: ev.x, ty: ev.y, t: 0, dur: CAST_DUR, age: 0 });
        var u = findUnit(ev.uid);
        lastAtk = { x: u ? u.x : ev.x, y: u ? u.y : ev.y, age: 0 };
        // o golpe conecta no LANÇAMENTO (fim da antecipação), não no início
        lastHitDelay = ev.fxKey === 'bolt' ? 0.52 : 0.34;
        break;
      }
      case 'damage':
        (function (uid) {
          delayed.push({ t: animQ.length ? lastHitDelay : 0, fn: function () {
            var v = getVis(uid);
            if (!v) return;
            v.flash = 1;
            v.flashHold = 0.055;
            if (lastAtk && lastAtk.age < 2) {
              var kdx = v.x - lastAtk.x, kdy = v.y - lastAtk.y;
              var kl = Math.sqrt(kdx * kdx + kdy * kdy) || 1;
              v.knockX = (kdx / kl) * 0.34;
              v.knockY = (kdy / kl) * 0.34;
            } else {
              v.knockX = (Math.random() * 2 - 1) * 0.25;
              v.knockY = (Math.random() * 2 - 1) * 0.25;
            }
            delayed.push({ t: 0.055, fn: function () {
              var v2 = getVis(uid);
              if (v2) v2.squashK = 0.0001;
            } });
          } });
        })(ev.uid);
        break;
      case 'death':
        (function (uid) {
          delayed.push({ t: animQ.length ? 0.32 : 0.05, fn: function () {
            var v = getVis(uid);
            if (v) v.deathK = 0.0001;
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
          var uu = ensureUnit(ev.unit);
          if (uu) { uu.vis.x = ev.unit.x; uu.vis.y = ev.unit.y; uu.vis.popK = 0.0001; }
        }
        break;
      case 'battleEnd':
        animQ.length = 0; delayed.length = 0;    // B2: nada segura isBusy após o fim
        // vitória de sala: pulinho comemorativo dos heróis (cosmético — não
        // entra na fila, não segura isBusy)
        if (ev.winner === 'player') {
          for (var cu in units) {
            var cr = units[cu];
            if (cr.su && cr.su.alive && cr.su.side === 'player') cr.vis.cheerT = 1.6;
          }
        }
        break;
    }
  };

  R.isBusy = function () {
    if (animQ.length > 0 || delayed.length > 0) return true;
    for (var uid in units) {
      var d = units[uid].vis.deathK;
      if (d > 0 && d < 1) return true;
    }
    return false;
  };

  R.hitDelay = function () { return animQ.length ? lastHitDelay : 0; };

  // ------------------------------------------------------------- cena
  function fitCamera(st) {
    var w = st.grid.w, h = st.grid.h;
    cam.pivot.set((w - 1) / 2 * CELL, 0, (h - 1) / 2 * CELL);
    var span = Math.max(w, h) * CELL;
    cam.minZoom = span * 0.55;
    cam.maxZoom = span * 2.1;
    cam.zoom = span * 1.06;
  }

  function buildScene(st, dg) {
    // limpa cena anterior
    if (boardG) { scene.remove(boardG); disposeDeep(boardG); boardG = null; }
    if (unitsG) { scene.remove(unitsG); disposeDeep(unitsG); unitsG = null; }
    if (overlayG) { scene.remove(overlayG); disposeDeep(overlayG); overlayG = null; }
    if (envDome) { scene.remove(envDome); disposeDeep(envDome); envDome = null; }
    var li;
    for (li = 0; li < lights.points.length; li++) scene.remove(lights.points[li]);
    for (li = 0; li < lights.spots.length; li++) { scene.remove(lights.spots[li]); if (lights.spots[li].target) scene.remove(lights.spots[li].target); }
    for (li = 0; li < lights.torches.length; li++) scene.remove(lights.torches[li]);
    for (li = 0; li < fillerLights.length; li++) scene.remove(fillerLights[li]);
    lights.points.length = 0; lights.spots.length = 0; lights.torches.length = 0;
    fillerLights.length = 0;
    flickerSprites.length = 0;
    scrollMats.length = 0;
    causticsMat = null;
    if (lights.hemi) { scene.remove(lights.hemi); lights.hemi = null; }
    if (lights.dir) { scene.remove(lights.dir); scene.remove(lights.dir.target); lights.dir = null; }
    if (lights.rim) { scene.remove(lights.rim); scene.remove(lights.rim.target); lights.rim = null; }
    units = {};
    overlayPool.length = 0;
    overlaySig = null;
    activeRing = null;              // o anel antigo foi descartado com o overlayG

    var M = models();
    var theme = normTheme(dg ? dg.theme : null);
    curTheme = theme;
    var env = THEME_ENV[theme] || THEME_ENV.garden;
    var w = st.grid.w, h = st.grid.h;
    var rnd = srand((String(st.dungeonId) + '|' + st.roomIndex).length * 2654435761 + w * 31 + h);

    boardG = new THREE.Group();
    unitsG = new THREE.Group();
    overlayG = new THREE.Group();
    scene.add(boardG); scene.add(unitsG); scene.add(overlayG);
    ensureOverlayInfra();

    // névoa + FUNDO EM GRADIENTE (domo) — nada de preto chapado
    var span = Math.max(w, h) * CELL;
    scene.fog = new THREE.Fog(new THREE.Color(env.fog).convertSRGBToLinear(), span * 1.25, span * 3.4);
    renderer.setClearColor(new THREE.Color(env.zenith), 1);
    renderer.toneMappingExposure = env.exposure || 1.25;
    envDome = makeEnvDome(env);
    envDome.position.copy(cam.pivot);
    scene.add(envDome);

    function isWall(x2, y2) {
      if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) return false;
      return st.grid.tiles[y2][x2].type === 'wall';
    }

    if (M) {
      // tudo que é ESTÁTICO nasce num grupo próprio e é FUNDIDO por material
      // no fim (mergeStatic) — o tabuleiro inteiro em poucas draw calls.
      var staticG = new THREE.Group();
      // chão ESTENDIDO até a névoa — o campo é um lugar, não um diorama
      var ground = M.buildGround(theme, w, h);
      staticG.add(ground);

      // células
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var tile = st.grid.tiles[y][x];
          var seed = hashXY(x, y);
          var node = null;
          if (tile.type === 'wall') {
            var opts = wallDressing(st, x, y, theme, seed);
            opts.mask = { n: isWall(x, y - 1), e: isWall(x + 1, y), s: isWall(x, y + 1), w: isWall(x - 1, y) };
            opts.border = (x === 0 || y === 0 || x === w - 1 || y === h - 1);
            node = M.buildWall(theme, seed, opts);
          } else if (tile.type === 'hole') {
            node = M.buildHole(theme, seed);
          } else if (tile.deco) {
            node = M.buildTile(theme, 'deco', seed % 4);
          } else {
            node = M.buildTile(theme, ((x + y) % 2) ? 'floor2' : 'floor1', seed % 97);
          }
          node.position.set(gx2w(x), 0, gz2w(y));
          staticG.add(node);
        }
      }

      // props de borda: anel ao redor do tabuleiro, ancorado no mundo
      // (NUNCA sobre o tabuleiro: rejeita posições dentro do retângulo da grade)
      var kinds = M.propKinds(theme);
      var cx = cam.pivot.x, cz = cam.pivot.z;
      var rad = span * 0.5;
      function outsideBoard(px, pz, margin) {
        return px < -CELL * margin || pz < -CELL * margin
          || px > (w - 1 + margin) * CELL || pz > (h - 1 + margin) * CELL;
      }
      for (var p = 0; p < 14; p++) {
        var a = (p / 14) * Math.PI * 2 + rnd() * 0.4;
        var d = rad + CELL * (1.1 + rnd() * 3.4);
        var ppx = cx + Math.cos(a) * d, ppz = cz + Math.sin(a) * d;
        var tries = 0;
        while (!outsideBoard(ppx, ppz, 1.0) && tries++ < 8) {
          d += CELL;
          ppx = cx + Math.cos(a) * d; ppz = cz + Math.sin(a) * d;
        }
        var kind = kinds[(p * 7 + ((rnd() * 13) | 0)) % kinds.length];
        var prop = M.buildProp(theme, kind, p * 131 + (seedOf(st) % 977));
        prop.position.set(ppx, 0, ppz);
        staticG.add(prop);
      }
      // silhuetas mais distantes (grandes, meio na névoa)
      for (var p2 = 0; p2 < 6; p2++) {
        var a2 = (p2 / 6) * Math.PI * 2 + 0.35 + rnd() * 0.5;
        var d2 = rad + CELL * (5 + rnd() * 4);
        var fpx = cx + Math.cos(a2) * d2, fpz = cz + Math.sin(a2) * d2;
        var tr2 = 0;
        while (!outsideBoard(fpx, fpz, 2.2) && tr2++ < 8) {
          d2 += CELL;
          fpx = cx + Math.cos(a2) * d2; fpz = cz + Math.sin(a2) * d2;
        }
        var far = M.buildProp(theme, kinds[(p2 * 3 + 1) % kinds.length], p2 * 313 + 7);
        far.scale.multiplyScalar(1.6 + rnd() * 0.9);
        far.position.set(fpx, 0, fpz);
        staticG.add(far);
      }
      boardG.add((M.mergeStatic && !window.__nomerge) ? M.mergeStatic(staticG) : staticG);

      // grade tática sutil (linhas aditivas — não entram na fusão)
      if (M.buildGridLines) {
        var grid = M.buildGridLines(theme, w, h);
        boardG.add(grid);
      }
      // braseiros ancorando os 4 cantos (fora do tabuleiro)
      if (M.buildBrazier) {
        var corners = [[-1.1, -1.1], [w + 0.1, -1.1], [-1.1, h + 0.1], [w + 0.1, h + 0.1]];
        for (var b2 = 0; b2 < 4; b2++) {
          var brz = M.buildBrazier(theme, b2);
          brz.position.set(gx2w(corners[b2][0]), 0, gz2w(corners[b2][1]));
          boardG.add(brz);
        }
      }
      // arena de chefe: peça única atrás do spawn do chefe
      if (M.buildArena && st.units) {
        var bossU = null;
        for (var bu = 0; bu < st.units.length; bu++) if (st.units[bu].boss) { bossU = st.units[bu]; break; }
        if (bossU) {
          var arena = M.buildArena(theme);
          // encosta na borda mais próxima do chefe, olhando p/ o centro
          var dxs = [{ d: bossU.x, px: -1.35, pz: bossU.y, ry: Math.PI / 2 },
                     { d: w - 1 - bossU.x, px: w + 0.35, pz: bossU.y, ry: -Math.PI / 2 },
                     { d: bossU.y, px: bossU.x, pz: -1.35, ry: 0 },
                     { d: h - 1 - bossU.y, px: bossU.x, pz: h + 0.35, ry: Math.PI }];
          dxs.sort(function (q, r2) { return q.d - r2.d; });
          arena.position.set(gx2w(dxs[0].px), 0, gz2w(dxs[0].pz));
          arena.rotation.y = dxs[0].ry;
          boardG.add(arena);
        }
      }
      // coleta halos/cortinas/marcadores de luz do tabuleiro fundido
      collectDynamics(boardG, theme, span);
    }

    // ---- luz key (quente, com sombra) + fill hemisférico + rim frio
    lights.hemi = new THREE.HemisphereLight(new THREE.Color(env.hemiSky).convertSRGBToLinear(), new THREE.Color(env.hemiGnd).convertSRGBToLinear(), env.hemiI);
    scene.add(lights.hemi);
    var dir = new THREE.DirectionalLight(new THREE.Color(env.sun).convertSRGBToLinear(), env.sunI);
    dir.position.set(cam.pivot.x - span * 0.55, span * 0.95, cam.pivot.z - span * 0.7);
    dir.target.position.copy(cam.pivot);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    var sc = span * 0.72;
    dir.shadow.camera.left = -sc; dir.shadow.camera.right = sc;
    dir.shadow.camera.top = sc; dir.shadow.camera.bottom = -sc;
    dir.shadow.camera.near = 1; dir.shadow.camera.far = span * 3;
    dir.shadow.bias = -0.0009;
    dir.shadow.normalBias = 0.035;
    scene.add(dir); scene.add(dir.target);
    lights.dir = dir;
    // rim de contorno (frio, sem sombra, vindo de trás/abaixo do olhar padrão)
    var rim = new THREE.DirectionalLight(new THREE.Color(env.rim).convertSRGBToLinear(), env.rimI);
    rim.position.set(cam.pivot.x + span * 0.7, span * 0.4, cam.pivot.z + span * 0.8);
    rim.target.position.copy(cam.pivot);
    scene.add(rim); scene.add(rim.target);
    lights.rim = rim;

    // pontuais temáticas perto de buracos (lava/água/canteiro brilham)
    var holes = [];
    for (var hy = 0; hy < h; hy++) for (var hx = 0; hx < w; hx++) {
      if (st.grid.tiles[hy][hx].type === 'hole') holes.push({ x: hx, y: hy });
    }
    var pcol = theme === 'forge' ? 0xff6a26 : theme === 'cistern' ? 0x4adcc0 : 0xffd76b;
    var pint = theme === 'forge' ? 1.3 : theme === 'cistern' ? 0.9 : 0.7;   // linear: menos quente
    var spots = [];
    if (holes.length) {
      spots.push(holes[0]);
      if (holes.length > 2) spots.push(holes[holes.length - 1]);
    }
    while (spots.length < 2) {
      spots.push({ x: 1 + ((rnd() * (w - 2)) | 0), y: 1 + ((rnd() * (h - 2)) | 0) });
    }
    for (var s2 = 0; s2 < Math.min(spots.length, 3); s2++) {
      var pl = new THREE.PointLight(new THREE.Color(pcol).convertSRGBToLinear(), pint, span * 0.75, 2);
      pl.position.set(gx2w(spots[s2].x), theme === 'cistern' ? 0.4 : 0.9, gz2w(spots[s2].y));
      scene.add(pl);
      lights.points.push(pl);
    }

    // toques específicos de tema (feixes de sol / cáusticas)
    themeExtras(theme, st, w, h, span);

    // ---- unidades
    if (st.units) {
      for (var i = 0; i < st.units.length; i++) ensureUnit(st.units[i]);
      for (var j = 0; j < st.units.length; j++) initFacing(st, st.units[j]);
    }

    // FX ganha o contexto da cena (ambiente por tema, pools novos)
    if (JOGO.FX && JOGO.FX.onScene) {
      JOGO.FX.onScene({
        scene: scene, camera: camera, theme: theme,
        w: w, h: h, cell: CELL, span: span, pivot: cam.pivot,
        holes: holes
      });
    }
  }

  // domo de fundo com gradiente vertical rico
  function makeEnvDome(env) {
    var cv = document.createElement('canvas');
    cv.width = 4; cv.height = 128;
    var c2 = cv.getContext('2d');
    var gr = c2.createLinearGradient(0, 128, 0, 0);
    gr.addColorStop(0, env.horizon);
    gr.addColorStop(0.45, env.fog);
    gr.addColorStop(1, env.zenith);
    c2.fillStyle = gr;
    c2.fillRect(0, 0, 4, 128);
    var tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    var m = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.BackSide, fog: false, depthWrite: false
    });
    var dome = new THREE.Mesh(new THREE.SphereGeometry(170, 24, 12), m);
    dome.renderOrder = -10;
    return dome;
  }

  // varre o tabuleiro fundido: halos p/ tremular, panos p/ rolar, marcadores
  // de tocha viram luzes REAIS (pool com teto fixo — sem recompiles depois)
  var MAX_TORCH_LIGHTS = 5;
  function collectDynamics(root, theme, span) {
    var markers = [];
    root.traverse(function (n) {
      if (n.isSprite && n.userData && n.userData.flicker) flickerSprites.push(n);
      if (n.userData && n.userData.scrollV && n.material && n.material.map) {
        scrollMats.push({ map: n.material.map, v: n.userData.scrollV });
      }
      if (n.userData && n.userData.torchLight) markers.push(n);
    });
    // prioriza os braseiros dos cantos e depois espalha
    var wp = new THREE.Vector3();
    for (var i = 0; i < markers.length && lights.torches.length < MAX_TORCH_LIGHTS; i += Math.max(1, Math.floor(markers.length / MAX_TORCH_LIGHTS))) {
      var mk = markers[i];
      mk.getWorldPosition(wp);
      var spec = mk.userData.torchLight;
      var tl = new THREE.PointLight(new THREE.Color(spec.color).convertSRGBToLinear(), spec.intensity, spec.dist, 2);
      tl.position.copy(wp);
      tl.userData.base = spec.intensity;
      tl.userData.phase = i * 2.13;
      scene.add(tl);
      lights.torches.push(tl);
    }
  }

  // feixes de sol da Estufa / cáusticas da Cisterna
  function themeExtras(theme, st, w, h, span) {
    var cx = cam.pivot.x, cz = cam.pivot.z;
    if (theme === 'garden') {
      // 2 feixes "de sol" por vidro rachado: spot + cone volumétrico falso
      for (var i = 0; i < 2; i++) {
        var sx = cx + (i ? -w * 0.22 : w * 0.26) * CELL * 0.5;
        var sz = cz + (i ? h * 0.2 : -h * 0.24) * CELL * 0.5;
        var sp2 = new THREE.SpotLight(new THREE.Color('#ffe9b0').convertSRGBToLinear(), 1.0, span * 1.6, 0.34, 0.55, 1.2);
        sp2.position.set(sx + 2.5, span * 0.75, sz - 2);
        sp2.target.position.set(sx, 0, sz);
        sp2.castShadow = false;
        scene.add(sp2); scene.add(sp2.target);
        lights.spots.push(sp2);
        var beamM = new THREE.MeshBasicMaterial({
          color: new THREE.Color('#ffe9b0').convertSRGBToLinear(),
          transparent: true, opacity: 0.032, blending: THREE.AdditiveBlending,
          depthWrite: false, side: THREE.DoubleSide, fog: false
        });
        var beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.9, span * 0.75, 12, 1, true), beamM);
        beam.position.set(sx + 1.6, span * 0.37, sz - 1.3);
        beam.rotation.z = 0.16; beam.rotation.x = -0.12;
        beam.renderOrder = 6;
        boardG.add(beam);
      }
    } else if (theme === 'cistern') {
      // cáusticas: teia luminosa rolando sobre o piso inteiro
      var cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      var c2 = cv.getContext('2d');
      c2.clearRect(0, 0, 256, 256);
      // cáusticas GRÁFICAS: bandas grossas de 2 tons (desenho, não gradiente)
      var rnd2 = srand(4242);
      c2.lineCap = 'round'; c2.lineJoin = 'round';
      for (var k = 0; k < 18; k++) {
        var x0 = rnd2() * 256, y0 = rnd2() * 256, segs = 3 + (rnd2() * 3 | 0);
        var pts = [[x0, y0]];
        for (var s3 = 0; s3 < segs; s3++) {
          pts.push([pts[s3][0] + (rnd2() - 0.5) * 90, pts[s3][1] + (rnd2() - 0.5) * 90]);
        }
        function trace(wd, style, alpha) {
          c2.strokeStyle = style; c2.lineWidth = wd; c2.globalAlpha = alpha;
          c2.beginPath();
          c2.moveTo(pts[0][0], pts[0][1]);
          for (var pp = 1; pp < pts.length; pp++) {
            c2.quadraticCurveTo(
              (pts[pp - 1][0] + pts[pp][0]) / 2 + 12, (pts[pp - 1][1] + pts[pp][1]) / 2 - 8,
              pts[pp][0], pts[pp][1]);
          }
          c2.stroke();
        }
        trace(4.5 + rnd2() * 2.5, 'rgba(120,240,210,0.75)', 0.55 + rnd2() * 0.3);
        trace(1.6, 'rgba(230,255,248,0.9)', 0.75);
      }
      c2.globalAlpha = 1;
      var tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(w / 5, h / 5);
      causticsMat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.2,
        blending: THREE.AdditiveBlending, depthWrite: false,
        color: new THREE.Color('#7ef0d4').convertSRGBToLinear()
      });
      var caus = new THREE.Mesh(new THREE.PlaneGeometry(w * CELL, h * CELL), causticsMat);
      caus.rotation.x = -Math.PI / 2;
      caus.position.set(cx, 0.022, cz);
      caus.renderOrder = 2;
      boardG.add(caus);
    }
  }
  function seedOf(st) {
    var s = String(st.dungeonId) + st.roomIndex, hsh = 0;
    for (var i = 0; i < s.length; i++) hsh = (hsh * 31 + s.charCodeAt(i)) >>> 0;
    return hsh;
  }
  // qual face da parede está exposta (p/ tocha/estandarte)
  function wallDressing(st, x, y, theme, seed) {
    var dirs = [{ x: 0, z: 1, dx: 0, dy: 1 }, { x: 0, z: -1, dx: 0, dy: -1 },
                { x: 1, z: 0, dx: 1, dy: 0 }, { x: -1, z: 0, dx: -1, dy: 0 }];
    var exposed = [];
    for (var i = 0; i < 4; i++) {
      var nx = x + dirs[i].dx, ny = y + dirs[i].dy;
      if (nx < 0 || ny < 0 || nx >= st.grid.w || ny >= st.grid.h) continue;
      if (st.grid.tiles[ny][nx].type === 'floor') exposed.push(dirs[i]);
    }
    if (!exposed.length) return {};
    var r = seed % 100;
    var pick = exposed[seed % exposed.length];
    if (theme === 'forge') {
      if (r < 24) return { torchDir: pick };
      if (r < 34) return { bannerDir: pick };
    } else if (theme === 'cistern') {
      if (r < 22) return { bannerDir: pick };
    } else {
      if (r < 12) return { torchDir: pick };
      if (r < 26) return { bannerDir: pick };
    }
    return {};
  }

  // ------------------------------------------------------------- unidades
  // pool anti-recompile: a CONTAGEM de point lights na cena fica estável —
  // ao remover uma unidade com K luzes entram K "fillers" (intensidade 0) e
  // ao entrar uma unidade saem fillers. Sem stall de shader na morte.
  function countPointLights(g) {
    var c = 0;
    g.traverse(function (n) { if (n.isPointLight) c++; });
    return c;
  }
  function addFillers(k) {
    while (k-- > 0 && fillerLights.length < 4) {
      var f = new THREE.PointLight(0xffffff, 0, 0.001, 2);
      f.position.set(0, -60, 0);
      scene.add(f);
      fillerLights.push(f);
    }
  }
  function takeFillers(k) {
    while (k-- > 0 && fillerLights.length) scene.remove(fillerLights.pop());
  }

  function ensureUnit(su) {
    if (!su || units[su.uid]) return units[su.uid] || null;
    var M = models();
    if (!M || !unitsG) return null;
    var built = M.buildUnit(su.defId);
    unitsG.add(built.group);
    takeFillers(countPointLights(built.group));
    var rec = {
      obj: built,
      su: su,
      baseScale: su.boss ? 1.22 : 1.34,     // presença forte na célula
      vis: {
        x: su.x, y: su.y, z: 0,
        yaw: 0, targetYaw: 0,
        flash: 0, flashHold: 0, squashK: 0,
        knockX: 0, knockY: 0,
        deathK: 0, popK: 1, hideK: 0,
        castK: 0, castRaw: 0, moving: false,
        hopK: 0, landK: 0, cheerT: 0,
        deathStyle: hashUid(su.uid) % 3,
        phase: (hashUid(su.uid) % 100) * 0.13
      },
      bar: makeHpBar(!!su.boss),
      barState: ''
    };
    rec.bar.sprite.visible = false;
    built.group.add(rec.bar.sprite);
    rec.bar.sprite.position.y = su.boss ? 3.1 : 1.78;
    units[su.uid] = rec;
    return rec;
  }
  function hashUid(uid) {
    var h = 0, s = String(uid);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function getVis(uid) {
    var rec = units[uid];
    if (rec) return rec.vis;
    var su = findUnit(uid);
    if (!su) return null;
    rec = ensureUnit(su);
    return rec ? rec.vis : null;
  }
  function initFacing(st, su) {
    var rec = units[su.uid];
    if (!rec) return;
    var best = null, bd = 1e9;
    for (var i = 0; i < st.units.length; i++) {
      var o = st.units[i];
      if (o.side === su.side || !o.alive) continue;
      var d = Math.abs(o.x - su.x) + Math.abs(o.y - su.y);
      if (d < bd) { bd = d; best = o; }
    }
    var yaw = best ? Math.atan2(best.x - su.x, best.y - su.y) : 0;
    rec.vis.yaw = rec.vis.targetYaw = yaw;
  }

  // barra de vida como sprite (canvas)
  function makeHpBar(boss) {
    var cv = document.createElement('canvas');
    cv.width = 64; cv.height = 12;
    var tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    tex.encoding = THREE.sRGBEncoding;
    var mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    var sp = new THREE.Sprite(mat);
    sp.scale.set(boss ? 1.9 : 1.15, boss ? 0.36 : 0.22, 1);
    sp.renderOrder = 90;
    return { sprite: sp, cv: cv, tex: tex };
  }
  function updateHpBar(rec, su) {
    var key = su.hp + '/' + su.hpMax + '/' + (su.shield || 0);
    if (rec.barState === key) return;
    rec.barState = key;
    var show = su.alive && (su.hp < su.hpMax || (su.shield || 0) > 0);
    rec.bar.sprite.visible = show;
    if (!show) return;
    // barra CHUNKY estilo cartoon: contorno escuro grosso + cor viva
    var c = rec.bar.cv.getContext('2d');
    c.clearRect(0, 0, 64, 12);
    c.fillStyle = 'rgba(20,12,26,0.95)';
    c.fillRect(0, 2, 64, 9);
    var k = Math.max(su.hp / su.hpMax, 0);
    c.fillStyle = k > 0.5 ? '#7ee05a' : k > 0.25 ? '#ffc63c' : '#ff5a3c';
    c.fillRect(2, 4, 60 * k, 5);
    c.fillStyle = 'rgba(255,255,255,0.35)';                  // brilho de tinta
    c.fillRect(2, 4, 60 * k, 2);
    if (su.shield > 0) {
      c.fillStyle = '#7ae0ff';
      c.fillRect(2, 0, 60 * Math.min(su.shield / su.hpMax, 1), 2);
    }
    rec.bar.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------- animações
  // curva de conjuração: ANTECIPA devagar (carrega) → SOLTA num pulo → assenta
  function castCurve(k) {
    if (k < 0.5) return (k / 0.5) * 0.3;                     // carrega (30%)
    if (k < 0.7) {
      var u = (k - 0.5) / 0.2;                               // lançamento c/ back-ease
      var s = 1.70158;
      var e = 1 + (--u) * u * ((s + 1) * u + s);             // easeOutBack 0..1
      return 0.3 + Math.min(Math.max(e, 0), 1) * 0.7;        // clamp: pose segura o pico
    }
    return 1;                                                // follow-through (pose volta)
  }
  function landPuff(v) {
    var fx = JOGO.FX;
    if (fx && fx.puff) fx.puff(gx2w(v.x), 0.12, gz2w(v.y));
  }
  function updateAnims(dt) {
    for (var i = delayed.length - 1; i >= 0; i--) {
      delayed[i].t -= dt;
      if (delayed[i].t <= 0) { var fn = delayed[i].fn; delayed.splice(i, 1); fn(); }
    }
    if (lastAtk) lastAtk.age += dt;
    for (var uid in units) {
      var v = units[uid].vis;
      if (v.flashHold > 0) v.flashHold -= dt;
      else v.flash = Math.max(0, v.flash - dt * 6);
      if (v.squashK > 0) {
        v.squashK += dt / 0.34;                              // squash mais longo (lê-se)
        if (v.squashK >= 1) v.squashK = 0;
      }
      if (v.landK > 0) {
        v.landK += dt / 0.22;                                // mola da aterrissagem
        if (v.landK >= 1) v.landK = 0;
      }
      if (v.cheerT > 0) v.cheerT = Math.max(0, v.cheerT - dt);
      v.knockX *= Math.pow(0.0001, dt); v.knockY *= Math.pow(0.0001, dt);
      if (v.deathK > 0 && v.deathK < 1) {
        v.deathK = Math.min(1, v.deathK + dt / (units[uid].obj.boss ? 1.15 : 0.8));
      }
      if (v.popK < 1) v.popK = Math.min(1, v.popK + dt / 0.4);
      v.yaw = angLerp(v.yaw, v.targetYaw, Math.min(dt * 11, 1));
      v.moving = false;
      v.castK = 0; v.castRaw = 0;
      v.hopK = 0;
    }
    if (!animQ.length) return;
    var a = animQ[0], v2, done = false;
    a.age = (a.age || 0) + dt;
    if (a.age > ANIM_WATCHDOG) done = true;                 // B2: watchdog
    switch (done ? 'skip' : a.kind) {
      case 'move':
        // SALTITOS: um pulinho por célula, squash na aterrissagem + poeirinha
        v2 = getVis(a.uid);
        if (!v2) { done = true; break; }
        v2.moving = true;
        a.k += dt * HOP_RATE;
        while (a.k >= 1 && a.seg < a.path.length) {
          a.k -= 1; a.seg++;
          // aterrissou numa célula: mola + poeira
          var landed = a.seg <= a.path.length ? a.path[a.seg - 1] : null;
          if (landed) {
            v2.x = landed.x; v2.y = landed.y;
            v2.landK = 0.0001;
            landPuff(v2);
          }
        }
        var from = a.seg === 0
          ? { x: a.sx != null ? a.sx : v2.x, y: a.sy != null ? a.sy : v2.y }
          : a.path[a.seg - 1];
        if (a.seg === 0 && a.sx == null) { a.sx = v2.x; a.sy = v2.y; from = { x: v2.x, y: v2.y }; }
        if (a.seg >= a.path.length) {
          var last = a.path[a.path.length - 1];
          v2.x = last.x; v2.y = last.y; v2.z = 0;
          done = true;
        } else {
          var to = a.path[a.seg];
          v2.x = from.x + (to.x - from.x) * a.k;
          v2.y = from.y + (to.y - from.y) * a.k;
          v2.z = Math.sin(a.k * Math.PI) * HOP_H;            // arco do saltito
          v2.hopK = a.k;                                     // estica no ar
          if (to.x !== from.x || to.y !== from.y) {
            v2.targetYaw = Math.atan2(to.x - from.x, to.y - from.y);   // vira p/ onde anda
          }
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
        if (k >= 1) {
          v2.x = a.txx; v2.y = a.tyy;
          if (a.collision) { v2.flash = Math.max(v2.flash, 0.6); v2.squashK = 0.0001; }
          done = true;
        }
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
          v2.castRaw = ck;                    // squash de antecipação global
          v2.castK = castCurve(ck);           // pose do modelo: carrega → SOLTA
          if (a.tx != null && (a.tx !== Math.round(v2.x) || a.ty !== Math.round(v2.y))) {
            v2.targetYaw = Math.atan2(a.tx - v2.x, a.ty - v2.y);      // encara o alvo
          }
        }
        if (ck >= 1) { if (v2) { v2.castK = 0; v2.castRaw = 0; } done = true; }
        break;
      case 'skip':
        v2 = getVis(a.uid);
        if (v2) {
          var su2 = findUnit(a.uid);
          if (su2) { v2.x = su2.x; v2.y = su2.y; }
          v2.z = 0; v2.castK = 0; v2.castRaw = 0; v2.hopK = 0;
          v2.hideK = 0; v2.squashK = 0; v2.flashHold = 0;
          v2.moving = false;
        }
        done = true;
        break;
      default:
        done = true;
    }
    if (done) animQ.shift();
  }

  function animatingUid(uid) {
    for (var i = 0; i < animQ.length; i++) if (animQ[i].uid === uid) return true;
    return false;
  }

  function syncUnits(st, dt) {
    var i, su;
    // cria/realinha
    for (i = 0; i < st.units.length; i++) {
      su = st.units[i];
      var rec = units[su.uid];
      if (!rec) {
        if (su.alive) { rec = ensureUnit(su); if (rec) initFacing(st, su); }
        continue;
      }
      rec.su = su;
      var v = rec.vis;
      if (!animatingUid(su.uid) && su.alive) {
        if (Math.abs(v.x - su.x) > 0.001 || Math.abs(v.y - su.y) > 0.001) {
          v.x += (su.x - v.x) * Math.min(dt * 8, 1);
          v.y += (su.y - v.y) * Math.min(dt * 8, 1);
          if (Math.abs(v.x - su.x) < 0.02) { v.x = su.x; v.y = su.y; }
        }
        v.z = 0;
      }
    }
    // remove mortos já dissolvidos
    for (var uid in units) {
      var rec2 = units[uid];
      var alive = rec2.su && rec2.su.alive;
      if (!alive && rec2.vis.deathK >= 1) {
        addFillers(countPointLights(rec2.obj.group));   // contagem estável (B: pool)
        unitsG.remove(rec2.obj.group);
        disposeDeep(rec2.obj.group);
        delete units[uid];
      }
    }
  }

  function applyUnitTransforms(st, dg, dt) {
    var en = engine();
    var active = (en && en.activeUnit && st) ? en.activeUnit(st) : null;
    for (var uid in units) {
      var rec = units[uid];
      var su = rec.su || findUnit(uid);
      if (!su) continue;
      var v = rec.vis;
      var g = rec.obj.group;
      var dead = !su.alive && v.deathK <= 0 && !animatingUid(uid);
      if (dead && !R.isBusy()) { v.deathK = 0.0001; }
      var px = gx2w(v.x) + v.knockX, py = v.z, pz = gz2w(v.y) + v.knockY;
      var rotY = v.yaw, rotZ = 0;
      // escala: princípios de desenho animado em TUDO (squash & stretch)
      var sx = 1, sy = 1;
      // pop de invocação (mola elástica)
      if (v.popK < 1) {
        var pk = v.popK;
        var ov = 1 + Math.sin(pk * Math.PI) * 0.28;          // passa do ponto e volta
        sx = (0.35 + pk * 0.65) * ov; sy = (1.7 - pk * 0.7) / ov;
      }
      // SALTITO: estica subindo, comprime descendo
      if (v.hopK > 0) {
        var stretch = Math.sin(v.hopK * Math.PI) * 0.17;
        sy *= 1 + stretch; sx *= 1 - stretch * 0.55;
      }
      // mola da ATERRISSAGEM: squash forte → overshoot → assenta
      if (v.landK > 0) {
        var lk = Math.min(v.landK, 1);
        var spring = Math.sin(lk * Math.PI * 2.0) * Math.exp(-lk * 2.6);
        sy *= 1 - spring * 0.3; sx *= 1 + spring * 0.24;
      }
      // ANTECIPAÇÃO de conjuração: agacha/infla → estica no lançamento → quique
      if (v.castRaw > 0) {
        var cr = v.castRaw, cs;
        if (cr < 0.5) cs = -0.16 * (cr / 0.5);               // agacha (carrega)
        else if (cr < 0.7) cs = -0.16 + ((cr - 0.5) / 0.2) * 0.4;   // ESTICA (+0.24)
        else {
          var fu = (cr - 0.7) / 0.3;                          // follow-through c/ quique
          cs = 0.24 * Math.cos(fu * Math.PI * 1.5) * (1 - fu);
        }
        sy *= 1 + cs; sx *= 1 - cs * 0.6;
      }
      // DANO: squash exagerado + tremidinha
      if (v.squashK > 0) {
        var q = Math.min(v.squashK, 1);
        var sq = Math.sin(q * Math.PI) * Math.exp(-q * 1.2);
        sx *= 1 + sq * 0.34; sy *= 1 - sq * 0.3;
        rotZ += Math.sin(nowT * 57 + v.phase) * 0.1 * (1 - q);
      }
      if (v.hideK > 0) { sx *= Math.max(1 - v.hideK, 0.001); sy *= Math.max(1 - v.hideK * 0.6, 0.001); }
      // MORTE cômico-dramática: pula, gira e vira panqueca
      if (v.deathK > 0) {
        var dk = v.deathK;
        if (dk < 0.3) {                                       // 1) salta indignado
          var uk = Math.sin((dk / 0.3) * Math.PI);
          py += uk * (rec.obj.boss ? 0.9 : 0.55);
          sy *= 1 + uk * 0.3; sx *= 1 - uk * 0.14;
        } else {                                              // 2) gira caindo 3) panqueca
          var fk = (dk - 0.3) / 0.7;
          py += Math.max(0, Math.sin((1 - fk) * Math.PI * 0.5)) * 0.1;
          var pancake = Math.min(fk * 1.35, 1);
          var bounce = Math.abs(Math.sin(fk * Math.PI * 2.2)) * (1 - fk) * 0.12;
          sy *= Math.max(1 - pancake * 0.94, 0.06) + bounce;
          sx *= 1 + pancake * 0.55;
        }
        rotY += (v.deathStyle === 1 ? 6.5 : v.deathStyle === 2 ? -4.5 : 3.2) * dk * dk;
        if (v.deathStyle === 2) rotZ += dk * 0.5;             // tomba de lado
      }
      // VITÓRIA: pulinho comemorativo
      if (v.cheerT > 0) {
        var ct = (1.6 - v.cheerT) * 6.2 + v.phase;
        var hop = Math.abs(Math.sin(ct));
        py += hop * 0.42;
        sy *= 1 + hop * 0.16; sx *= 1 - hop * 0.08;
        rotY += Math.sin(ct * 0.5) * 0.35;
      }
      g.position.set(px, py, pz);
      g.rotation.y = rotY;
      g.rotation.z = rotZ;
      var bs = rec.baseScale || 1;
      g.scale.set(sx * bs, sy * bs, sx * bs);
      // invisível (efeito): meio transparente p/ o jogador, some p/ inimigo… fase A: alfa único
      var isInvis = false;
      if (su.effects) {
        for (var e2 = 0; e2 < su.effects.length; e2++) if (su.effects[e2].type === 'invisible') isInvis = true;
      }
      g.visible = v.hideK < 1;
      // anima o modelo (idle/walk/cast/flash/morte)
      rec.obj.animate({
        moving: v.moving,
        castK: v.castK,
        flash: v.flash + (isInvis ? -0 : 0),
        deathK: v.deathK,
        invis: isInvis
      }, nowT + v.phase, dt);
      // barra de vida
      updateHpBar(rec, su);
      // anel do ativo
      if (activeRing && active && active.uid === uid && st.phase === 'playing') {
        activeRing.visible = true;
        activeRing.position.set(gx2w(v.x), 0.06, gz2w(v.y));
        var pulse = 0.55 + Math.sin(nowT * 4) * 0.2;
        activeRing.material.opacity = pulse;
        activeRing.material.color.set(su.side === 'player' ? 0xffd98a : 0xff6a4a).convertSRGBToLinear();
        var rs = su.boss ? 1.6 : 1;
        activeRing.scale.set(rs, rs, rs);
      }
    }
  }

  // ------------------------------------------------------------- overlays
  var overlayPool = [];
  var overlayUsed = 0;
  var overlaySig = null;
  var overlayLists = null;
  var activeRing = null;

  function ensureOverlayInfra() {
    if (!activeRing) {
      var ringGeo = new THREE.RingGeometry(CELL * 0.28, CELL * 0.44, 28);   // anel GROSSO
      ringGeo.rotateX(-Math.PI / 2);
      activeRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffd98a, transparent: true, opacity: 0.6, depthWrite: false,
        blending: THREE.AdditiveBlending
      }));
      activeRing.renderOrder = 5;
      activeRing.visible = false;      // só na criação (o render decide por frame)
    }
    if (activeRing.parent !== overlayG) overlayG.add(activeRing);
  }
  function overlayQuad(x, y, colorHex, alpha, lift) {
    var q = overlayPool[overlayUsed];
    if (!q) {
      var geo = new THREE.PlaneGeometry(CELL * 0.94, CELL * 0.94);
      geo.rotateX(-Math.PI / 2);
      q = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false,
        blending: THREE.AdditiveBlending           // "quads emissivos" do contrato
      }));
      q.renderOrder = 4;
      overlayPool[overlayUsed] = q;
      overlayG.add(q);
    }
    overlayUsed++;
    q.visible = true;
    q.position.set(gx2w(x), 0.045 + (lift || 0), gz2w(y));
    q.material.color.set(colorHex).convertSRGBToLinear();
    q.material.opacity = alpha;
    return q;
  }
  function computeOverlayLists(st, g, en) {
    var lists = { reach: null, path: null, targets: null, aoe: null, hov: g.hoverTile || null };
    var active = en.activeUnit ? en.activeUnit(st) : null;
    if (!active) return lists;
    var spellId = g.selectedSpellId;
    if (!spellId) {
      try { lists.reach = en.reachable ? en.reachable(st, active.uid) : null; } catch (e) { lists.reach = null; }
      if (g.hoverTile) {
        try { lists.path = en.path ? en.path(st, active.uid, g.hoverTile.x, g.hoverTile.y) : null; } catch (e2) { lists.path = null; }
      }
    } else {
      var targets = null;
      try { targets = en.castTargets ? en.castTargets(st, active.uid, spellId) : null; } catch (e3) { targets = null; }
      lists.targets = targets;
      var hov = g.hoverTile;
      if (hov && targets) {
        var inT = false;
        for (var i = 0; i < targets.length; i++) if (targets[i].x === hov.x && targets[i].y === hov.y) { inT = true; break; }
        if (inT) {
          try { lists.aoe = en.aoeTiles ? en.aoeTiles(st, spellId, active.x, active.y, hov.x, hov.y) : null; } catch (e4) { lists.aoe = null; }
        }
      }
    }
    return lists;
  }
  function drawOverlays(st, dg) {
    ensureOverlayInfra();
    overlayUsed = 0;
    var g = game(), en = engine();
    var show = g && en && st && st.phase === 'playing'
      && (g.isPlayerTurn && g.isPlayerTurn()) && !R.isBusy();
    if (show) {
      var active = en.activeUnit ? en.activeUnit(st) : null;
      var hov = g.hoverTile;
      var sig = st.round + '|' + (active ? active.uid + '|' + active.pa + '|' + active.pm : '-')
        + '|' + g.selectedSpellId + '|' + (hov ? hov.x + ',' + hov.y : '-');
      if (sig !== overlaySig) {
        overlaySig = sig;
        overlayLists = computeOverlayLists(st, g, en);
      }
      var L = overlayLists, i;
      if (L) {
        var acc = (dg && dg.palette && dg.palette.accent) || '#ffd98a';
        if (L.reach) for (i = 0; i < L.reach.length; i++) overlayQuad(L.reach[i].x, L.reach[i].y, '#5fc47c', 0.22);
        if (L.path) for (i = 0; i < L.path.length; i++) overlayQuad(L.path[i].x, L.path[i].y, '#d6ffcf', 0.4, 0.012);
        if (L.targets) {
          var spell = JOGO.DATA && JOGO.DATA.spells && JOGO.DATA.spells[g.selectedSpellId];
          var elCol = (spell && ELEM[spell.element]) || '#ffd98a';
          for (i = 0; i < L.targets.length; i++) overlayQuad(L.targets[i].x, L.targets[i].y, elCol, 0.34);
        }
        if (L.aoe) {
          var pulse = 0.55 + Math.sin(nowT * 7) * 0.18;
          for (i = 0; i < L.aoe.length; i++) overlayQuad(L.aoe[i].x, L.aoe[i].y, '#ff7a4a', pulse, 0.024);
        }
        if (L.hov && st.grid && L.hov.x >= 0 && L.hov.y >= 0 && L.hov.x < st.grid.w && L.hov.y < st.grid.h) {
          overlayQuad(L.hov.x, L.hov.y, acc, 0.6, 0.036);
        }
      }
    } else {
      overlaySig = null;
      if (activeRing) activeRing.visible = st && st.phase === 'playing';
    }
    for (var k = overlayUsed; k < overlayPool.length; k++) overlayPool[k].visible = false;
    if (!show || !st || st.phase !== 'playing') { if (activeRing) activeRing.visible = false; }
  }

  // ------------------------------------------------------------- render
  R.render = function (dt) {
    if (!renderer) return;
    dt = dt || 0.016;
    var ts = (JOGO.FX && JOGO.FX.getTimeScale) ? JOGO.FX.getTimeScale() : 1;
    var dtv = dt * ts;
    nowT += dtv;

    var g = game();
    var st = state();
    var inBattle = st && (!g || !g.screen || g.screen === 'battle' || g.screen === 'roomClear'
      || g.screen === 'defeat' || g.screen === 'dungeonComplete');

    if (!st || !inBattle) {
      // fora da batalha NADA segura isBusy (QA N4: dissolve de morte congelava
      // com Game.state nulo após derrota e prendia isBusy em true no menu)
      if (animQ.length || delayed.length) { animQ.length = 0; delayed.length = 0; }
      for (var nu in units) {
        var nv = units[nu].vis;
        if (nv.deathK > 0 && nv.deathK < 1) nv.deathK = 1;
      }
      // fundo estático suave fora da batalha
      renderer.setClearColor(0x0c0e12, 1);
      renderer.clear(true, true, true);
      return;
    }

    var M = models();
    if (M && !M.isReady()) {
      renderer.setClearColor(0x0c0e12, 1);
      renderer.clear(true, true, true);
      return;
    }

    // troca de sala/tema → reconstrói a cena
    var dg = dungeonOf(st);
    var roomKey = String(st.dungeonId) + '|' + st.roomIndex + '|' + st.grid.w + 'x' + st.grid.h;
    if (roomKey !== curRoomKey) {
      curRoomKey = roomKey;
      fitCamera(st);
      buildScene(st, dg);
      renderer.shadowMap.needsUpdate = true;
    }
    // mapa de sombra a 30 Hz (idle respira devagar; imperceptível, ~3 ms a menos)
    frameNo++;
    if ((frameNo & 1) === 0) renderer.shadowMap.needsUpdate = true;

    var sh = (JOGO.FX && JOGO.FX.getShake) ? JOGO.FX.getShake() : null;
    shake.x = sh ? sh.x : 0; shake.y = sh ? sh.y : 0;

    // dimensiona se o canvas mudou
    var pw = canvas.parentElement ? canvas.parentElement.clientWidth : canvas.clientWidth;
    if (pw && Math.abs(pw - W) > 2) resize();

    updateAnims(dtv);
    syncUnits(st, dtv);

    // hover por raycast (barato: só quando o mouse mexeu)
    if (mouse.hoverDirty) {
      mouse.hoverDirty = false;
      var gg = game();
      if (gg && gg.onTileHover) {
        var t2 = pickTile(mouse.mx, mouse.my);
        if (t2) gg.onTileHover(t2.x, t2.y); else gg.onTileHover(-1, -1);
      }
    }

    if (activeRing) activeRing.visible = false;
    applyUnitTransforms(st, dg, dtv);
    drawOverlays(st, dg);

    // luzes pontuais temáticas respiram
    var li, pl;
    for (li = 0; li < lights.points.length; li++) {
      pl = lights.points[li];
      pl.intensity = pl.userData.base == null
        ? (pl.userData.base = pl.intensity)
        : pl.userData.base * (0.82 + Math.sin(nowT * 2.3 + li * 2.1) * 0.18);
    }
    // TOCHAS: flicker vivo (duas senoides dessincronizadas + serrilha)
    for (li = 0; li < lights.torches.length; li++) {
      pl = lights.torches[li];
      var ph = pl.userData.phase || 0;
      pl.intensity = pl.userData.base * (0.74
        + Math.sin(nowT * 9.3 + ph) * 0.14
        + Math.sin(nowT * 23.7 + ph * 1.7) * 0.08
        + Math.sin(nowT * 3.1 + ph * 0.6) * 0.06);
    }
    // halos tremulam junto
    for (li = 0; li < flickerSprites.length; li++) {
      var sp3 = flickerSprites[li];
      var f2 = 0.8 + Math.sin(nowT * 8.7 + li * 2.9) * 0.14 + Math.sin(nowT * 21.1 + li) * 0.08;
      sp3.material.opacity = (sp3.userData.baseOpacity || 0.5) * f2;
      var bs2 = sp3.userData.baseScale || 1.2;
      sp3.scale.set(bs2 * (0.92 + f2 * 0.12), bs2 * (0.92 + f2 * 0.12), 1);
    }
    // panos que rolam (cortina d'água) + cáusticas
    for (li = 0; li < scrollMats.length; li++) {
      scrollMats[li].map.offset.y -= dtv * scrollMats[li].v * 0.25;
    }
    if (causticsMat) {
      causticsMat.map.offset.x += dtv * 0.021;
      causticsMat.map.offset.y += dtv * 0.013;
      causticsMat.opacity = 0.18 + Math.sin(nowT * 1.7) * 0.05;
    }
    // emissivos do ambiente pulsam (água/lava/brasas)
    var M2 = models();
    if (M2 && M2.envMat) {
      var em;
      if ((em = M2.envMat('hole-lava'))) em.emissiveIntensity = 1.1 + Math.sin(nowT * 2.1) * 0.25 + Math.sin(nowT * 7.7) * 0.1;
      if ((em = M2.envMat('tile-ember'))) em.emissiveIntensity = 0.95 + Math.sin(nowT * 3.3) * 0.2;
      if ((em = M2.envMat('hole-water'))) em.emissiveIntensity = 0.85 + Math.sin(nowT * 1.5) * 0.18;
      if ((em = M2.envMat('wall-ember'))) em.emissiveIntensity = 0.85 + Math.sin(nowT * 2.7) * 0.18;
    }

    // FX: avança partículas e (se houver composer) renderiza com bloom
    // (recebe dt REAL — o FX aplica o próprio hit-stop internamente)
    var fx = JOGO.FX;
    if (fx && fx.update) fx.update(dt, nowT);
    updateCamera();
    if (!(fx && fx.render && fx.render(scene, camera, dtv))) {
      renderer.render(scene, camera);
    }
  };

  // âncora de FX no torso da unidade (coordenadas de MUNDO)
  R.unitAnchor = function (uid, part) {
    var rec = units[uid];
    if (!rec) {
      var su = findUnit(uid);
      if (!su) return null;
      return { x: gx2w(su.x), y: 1.1, z: gz2w(su.y) };
    }
    var v = rec.vis;
    var hgt = rec.obj.boss ? 1.7 : 1.1;
    if (part === 'feet') hgt = 0.08;
    if (part === 'head') hgt = rec.obj.boss ? 2.6 : 1.7;
    return { x: gx2w(v.x) + v.knockX, y: v.z + hgt, z: gz2w(v.y) + v.knockY };
  };
  R.themeName = function () { return curTheme; };

  // sonda de teste (páginas de preview)
  R._scene = function () { return { scene: scene, camera: camera }; };
  R._debug = function () {
    return {
      overlayUsed: overlayUsed,
      pool: overlayPool.length,
      units: Object.keys(units).length,
      anims: animQ.length,
      ring: activeRing ? activeRing.visible : null
    };
  };

  JOGO.Renderer = R;
})();
