var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// JOGO.Renderer — SOTERRA 2.0 · apresentação 3D (Three.js r147)
// Dono: Agente de Migração 3D.  Lei: docs/CONTRACT_V2.md §9 e adendos 9-B..9-E.
//
// API do contrato (idêntica à da camada 2D — o núcleo e a HUD não percebem a troca):
//   Renderer.init(canvasOuContainer [, opts])  ·  Renderer.render(dt)
//   Renderer.handleEvent(ev)  ·  Renderer.isBusy()
//   Renderer.project(gx, gy [, z]) -> {x, y, s, d}      (coordenadas de TELA)
//   Renderer.setCamera({zoom, panX, panY, rot, ang, tilt})
//   Renderer.rotate(+1|-1)                               (§9-E: quarto de volta)
//
// CÂMERA: órbita LIVRE em volta do pivô (o que a v1 tinha e o jogador sentia
//   falta). Arrastar = girar/inclinar · roda/pinça = aproximar · toque curto =
//   ação na célula por raycast · dois dedos = deslocar. Entrada sobre
//   `#ui-root` é ignorada.
//
// CONTRATO INTERNO com js/render3d/fx3d_v2.js (mesmo dono):
//   Renderer.world(gx, gy, z) -> THREE.Vector3        posição de MUNDO 3D
//   Renderer.fxLayers()       -> {scene, fx, decal, THREE, renderer, camera}
//   Renderer.unitWorld(uid)   -> {x, y} em células (posição ANIMADA)
//   Renderer.unitHeight(uid)  -> altura visual em unidades de mundo
//   Renderer.hitDelay()       -> atraso até o payload do golpe atual (s)
//   Renderer.elementColor(e)  -> '#rrggbb'
//   Renderer.FUSION_TIMING    -> {approach, flash, reveal}
//   FX expõe: getShake(), getTimeScale(), setAmbient(theme), update(dt),
//             handleEvent(ev), reset(), _attach(ctx)
// ============================================================================

(function () {
  'use strict';
  if (typeof THREE === 'undefined') {
    if (typeof console !== 'undefined') console.error('[Renderer3D] THREE ausente (vendor/three.min.js)');
    return;
  }

  var R = {};
  var M = null;                       // JOGO.Models3D2

  // -------------------------------------------------------------- constantes
  var CELL = 2.0;
  var WALL_H = CELL * 1.55;           // obstáculo ALTO: bloqueia passagem e visão
  var LOW_H = CELL * 0.46;            // obstáculo BAIXO: bloqueia passagem, não a visão
  var HOLE_D = CELL * 1.2;
  var ANIM_WATCHDOG = 3.0;
  var TAP_PX = 9, TAP_MS = 260;
  var MOVE_RATE = 4.2;                // células por segundo
  var FACE_OFF = 0;                   // o rig do KayKit nasce olhando para +Z

  R.CELL = CELL;
  R.FUSION_TIMING = { approach: 0.62, flash: 0.26, reveal: 0.66 };

  var ELEMENT_COLORS = {
    neutro: '#d8dee4', fogo: '#ff8c3a', agua: '#57c8ec',
    terra: '#9bd06a', ar: '#c8b6ff'
  };
  R.ELEMENT_COLORS = ELEMENT_COLORS;
  R.elementColor = function (e) { return ELEMENT_COLORS[e] || ELEMENT_COLORS.neutro; };

  // Ambiente por tema (§7 — 6 calabouços). Céu/chão do hemisférico dão a
  // "sombra colorida" que faz a cena parecer desenho e não maquete cinza.
  var THEME_ENV = {
    garden:   { fog: '#3d5c30', sky: '#a8c887', gnd: '#2c3c66', sun: '#fff0c2', sunI: 1.12, hemiI: 0.82, rim: '#a8ffc0' },
    cistern:  { fog: '#1d5570', sky: '#7ec0da', gnd: '#20265c', sun: '#e2f4f8', sunI: 1.02, hemiI: 0.86, rim: '#7ef0d4' },
    forge:    { fog: '#5e2510', sky: '#e09668', gnd: '#46205c', sun: '#ffd8a0', sunI: 1.08, hemiI: 0.78, rim: '#ff9a5a' },
    scaffold: { fog: '#454a5c', sky: '#c8d2ea', gnd: '#3a3550', sun: '#eef7f5', sunI: 1.12, hemiI: 0.88, rim: '#cfe4ff' },
    mine:     { fog: '#403322', sky: '#c8a878', gnd: '#2e2440', sun: '#ffe0a8', sunI: 1.00, hemiI: 0.76, rim: '#c9a227' },
    heart:    { fog: '#332a52', sky: '#b49ce8', gnd: '#2a2044', sun: '#ffe6b8', sunI: 1.08, hemiI: 0.84, rim: '#ffd166' }
  };
  function envOf(theme) { return THEME_ENV[theme] || THEME_ENV.garden; }

  // ------------------------------------------------------------------ estado
  var canvas = null, host = null, renderer = null, scene = null, camera = null;
  var composer = null, bloomPass = null;
  var lastCalls = 0, lastTris = 0;   // lidos no fim do quadro (ver R.stats)
  var W = 2, H = 2, DPR = 1;
  var ready = false, initFailed = false;
  var pendingEvents = [];

  var boardG = null, unitsG = null, overlayG = null, fxG = null, decalG = null, weatherG = null;
  var lights = { hemi: null, sun: null, rim: null, fill: null };
  var boardKey = null, curTheme = null, gridW = 1, gridH = 1;

  var cam = {
    ang: -Math.PI / 4,      // azimute
    tilt: 0.98,             // ângulo polar a partir do zênite (0 = de cima)
    dist: 22,
    minDist: 7, maxDist: 52,
    minTilt: 0.30, maxTilt: 1.35,
    pivot: new THREE.Vector3(0, 0, 0),
    panX: 0, panZ: 0
  };
  var rotAnim = null;                 // giro de 90° animado (§9-E)
  var camFocus = null;                // foco cinematográfico (fusão)
  var shake = { x: 0, y: 0 };
  var nowT = 0;

  var vis = {};                       // uid -> estado visual
  var unitNodes = {};                 // uid -> THREE.Group
  var unitSnap = {};                  // último retrato conhecido (fusão)
  var animQ = [], delayed = [];
  var lastAtk = null, lastHitDelay = 0.28;
  var ovSig = '', evSig = '~init~';

  // ------------------------------------------------------------------ acesso
  function game() { return JOGO.Game || null; }
  function engine() { return JOGO.Engine || null; }
  function state() { var g = game(); return (g && g.state) || null; }
  function DATA() { return JOGO.DATA || {}; }
  function findUnit(uid) {
    var st = state(); if (!st || !st.units) return null;
    for (var i = 0; i < st.units.length; i++) if (st.units[i].uid === uid) return st.units[i];
    return null;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function safe(fn, dflt) { try { var r = fn(); return r == null ? dflt : r; } catch (e) { return dflt; } }
  function hexInt(c) { return M ? M.hexInt(c) : 0xffffff; }
  // cor de cena: hex escrito a mao esta em sRGB; o three r147 (legacyMode)
  // espera LINEAR nos materiais e nas luzes.
  function col3(c) { return new THREE.Color(hexInt(c)).convertSRGBToLinear(); }

  // grid → mundo (centro do tabuleiro na origem)
  function wx(gx) { return (gx - (gridW - 1) / 2) * CELL; }
  function wz(gy) { return (gy - (gridH - 1) / 2) * CELL; }
  function gxOf(x) { return x / CELL + (gridW - 1) / 2; }
  function gyOf(z) { return z / CELL + (gridH - 1) / 2; }
  R.world = function (gx, gy, z) { return new THREE.Vector3(wx(gx), z || 0, wz(gy)); };

  // -------------------------------------------------------------- leitura do state
  function tileKind(t) {
    if (t == null) return null;
    if (typeof t === 'string') {
      if (t === '#') return 'high';
      if (t === '=') return 'low';
      if (t === '~') return 'hole';
      if (t === ',') return 'deco';
      return 'floor';
    }
    var ty = t.type || t.kind || 'floor';
    if (ty === 'wall' || ty === 'high' || ty === 'obstacle') return 'high';
    if (ty === 'cover' || ty === 'low' || ty === 'half') return 'low';
    if (ty === 'hole' || ty === 'void' || ty === 'empty' || ty === 'pit') return 'hole';
    if (t.deco) return 'deco';
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
    if (!D.dungeons || !st) return null;
    for (var i = 0; i < D.dungeons.length; i++) if (D.dungeons[i].id === st.dungeonId) return D.dungeons[i];
    return null;
  }
  function themeOf(st) {
    if (!st) return 'garden';
    if (st.sceneryTheme) return st.sceneryTheme;
    var dg = dungeonOf(st);
    if (dg) {
      var room = dg.rooms && dg.rooms[st.roomIndex];
      if (room && room.sceneryTheme) return room.sceneryTheme;
      return dg.theme || 'garden';
    }
    return st.theme || 'garden';
  }
  function paletteOf(st) {
    var dg = dungeonOf(st);
    var p = (dg && dg.palette) || (st && st.palette) || {};
    return {
      primary: p.primary || '#5a8f4d', secondary: p.secondary || '#3b4739',
      accent: p.accent || '#ffd76b',
      floor1: p.floor1 || '#35513a', floor2: p.floor2 || '#3d5c41',
      wall: p.wall || '#57452f', lowWall: p.lowWall || p.wall || '#6b5334',
      voidColor: p.voidColor || '#0d1016'
    };
  }
  function weatherId(st) {
    var w = st && st.weather;
    if (!w) return 'calmo';
    return typeof w === 'string' ? w : (w.id || 'calmo');
  }

  // ============================================================ INICIALIZAÇÃO
  R.init = function (target, opts) {
    opts = opts || {};
    if (renderer) return true;
    M = JOGO.Models3D2 || null;
    if (!M) { initFailed = true; console.error('[Renderer3D] JOGO.Models3D2 ausente'); return false; }

    if (target && target.tagName === 'CANVAS') { canvas = target; host = target.parentElement || document.body; }
    else {
      host = target || document.body;
      canvas = document.createElement('canvas');
      canvas.style.display = 'block';
      host.appendChild(canvas);
    }
    // resolucao: 2x so faz sentido em tela pequena; no desktop 4x de pixels
    // custa mais do que entrega. 1.5 e o teto util aqui.
    //
    // No celular o teto desce para 1,25. Um aparelho com dpr 3 desenharia
    // 585x1266 = 741 mil pixels a 1,5; a 1,25 são 514 mil — 31% de
    // preenchimento a menos por quadro, e a HUD (que é DOM) continua nítida
    // porque ela não passa pelo canvas.
    var teto = (JOGO.Mobile && JOGO.Mobile.economico && JOGO.Mobile.economico()) ? 1.25 : 1.5;
    DPR = clamp(window.devicePixelRatio || 1, 1, teto);
    var box = measure(); W = box.w; H = box.h;

    var wantPreserve = opts.preserveDrawingBuffer ||
      (typeof location !== 'undefined' && /[?&]snap=/.test(location.search || ''));
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas, antialias: opts.antialias !== false, alpha: false,
        preserveDrawingBuffer: !!wantPreserve, powerPreference: 'high-performance'
      });
    } catch (e) {
      initFailed = true; console.error('[Renderer3D] WebGL indisponível:', e); return false;
    }
    renderer.setPixelRatio(DPR);
    renderer.setSize(W, H, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (THREE.sRGBEncoding != null) renderer.outputEncoding = THREE.sRGBEncoding;
    // ACES comprime o realce e DESSATURA a cena inteira (lição da v1). Com
    // arte de atlas chapado, o tom linear preserva a cor; as luzes abaixo já
    // estão calibradas para isso.
    renderer.toneMapping = THREE.LinearToneMapping;
    renderer.toneMappingExposure = 1.0;

    scene = new THREE.Scene();
    scene.background = col3(0x101418);
    scene.fog = new THREE.Fog(col3(0x101418).getHex(), 26, 90);

    camera = new THREE.PerspectiveCamera(42, W / H, 0.5, 400);

    boardG = new THREE.Group(); boardG.name = 'board';
    decalG = new THREE.Group(); decalG.name = 'decals';
    overlayG = new THREE.Group(); overlayG.name = 'overlay';
    unitsG = new THREE.Group(); unitsG.name = 'units';
    fxG = new THREE.Group(); fxG.name = 'fx';
    weatherG = new THREE.Group(); weatherG.name = 'weather';
    scene.add(boardG, decalG, overlayG, unitsG, fxG, weatherG);

    buildLights();
    buildComposer(opts);
    bindInput();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', function () { setTimeout(onResize, 80); });

    ready = true;

    // modelos: decodificação assíncrona dos GLB embutidos
    M.load(function (err) {
      if (err && console && console.warn) console.warn('[Renderer3D] modelos:', err);
      ovSig = '';
    });

    if (JOGO.FX && JOGO.FX._attach) {
      try {
        JOGO.FX._attach({
          THREE: THREE, renderer: renderer, scene: scene, camera: camera,
          fx: fxG, decal: decalG, weather: weatherG, renderer3d: R
        });
      } catch (e2) { if (console && console.warn) console.warn('[Renderer3D] FX._attach falhou', e2); }
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
    if (!renderer) return;
    var b = measure();
    if (b.w === W && b.h === H) return;
    W = b.w; H = b.h;
    renderer.setSize(W, H, false);
    aplicaMoldura();                 // já faz o updateProjectionMatrix
    if (composer) composer.setSize(W, H);
  }
  R.resize = onResize;

  // ---------------------------------------------------------- QUALIDADE
  // A sala pode ter 23x19 celulas e ~40 unidades. Em vez de derrubar o quadro,
  // cortamos onde nao se nota: resolucao da sombra e da tela.
  var quality = { shadow: 2048, dpr: 1.5, units: 0 };
  function shadowSize() {
    var small = Math.min(W, H) < 700;
    if (small) return 1024;
    return quality.units > 26 ? 1024 : 2048;
  }
  function applyQuality(nUnits) {
    if (nUnits === quality.units) return;
    var before = shadowSize();
    quality.units = nUnits;
    var after = shadowSize();
    if (after !== before && lights.sun) {
      lights.sun.shadow.mapSize.set(after, after);
      if (lights.sun.shadow.map) { lights.sun.shadow.map.dispose(); lights.sun.shadow.map = null; }
    }
    // muita unidade em cena: so quem tem porte projeta sombra
    var limit = nUnits > 26;
    for (var uid in unitNodes) {
      var nd = unitNodes[uid];
      if (!nd || nd.__shadowLimited === limit) continue;
      nd.__shadowLimited = limit;
      var big = nd.userData.height > 2.2;
      nd.traverse(function (o) {
        if (o.isMesh || o.isSkinnedMesh) o.castShadow = limit ? big : true;
      });
    }
  }

  function buildLights() {
    lights.hemi = new THREE.HemisphereLight(col3('#a8c887'), col3('#2c3c66'), 0.82);
    scene.add(lights.hemi);

    lights.sun = new THREE.DirectionalLight(col3('#fff0c2'), 1.12);
    lights.sun.position.set(11, 20, 8);
    lights.sun.castShadow = true;
    lights.sun.shadow.mapSize.set(shadowSize(), shadowSize());
    lights.sun.shadow.camera.near = 1;
    lights.sun.shadow.camera.far = 90;
    lights.sun.shadow.camera.left = -26;
    lights.sun.shadow.camera.right = 26;
    lights.sun.shadow.camera.top = 26;
    lights.sun.shadow.camera.bottom = -26;
    lights.sun.shadow.bias = -0.0012;
    lights.sun.shadow.normalBias = 0.03;
    scene.add(lights.sun);
    scene.add(lights.sun.target);

    lights.rim = new THREE.DirectionalLight(col3('#a8ffc0'), 0.42);
    lights.rim.position.set(-12, 9, -14);
    scene.add(lights.rim);

    lights.fill = new THREE.AmbientLight(0xffffff, 0.18);
    scene.add(lights.fill);
  }

  function buildComposer(opts) {
    if (opts && opts.bloom === false) return;
    /* BLOOM NO CELULAR: não. O `UnrealBloomPass` é um recorte de brilho mais
     * CINCO desfoques em cadeia, cada um lendo e escrevendo a tela inteira. Em
     * chamadas de desenho ele parece barato (14 de 341, ~4%); em PREENCHIMENTO,
     * que é onde o GPU de telefone se afoga, ele multiplica o custo do quadro.
     * `R.setBloom(true)` continua religando para quem quiser. */
    // `?bloom=1` / `?bloom=0` mandam por cima — é como se compara o MESMO
    // quadro com e sem o brilho, que foi como descobrimos que desligar o
    // composer mudava o tom da imagem inteira (ver `aplicaTomSemComposer`).
    var pedido = /[?&]bloom=1/.test(location.search || '') ? true
               : /[?&]bloom=0/.test(location.search || '') ? false : null;
    if (pedido === false) return;
    if (pedido !== true && JOGO.Mobile && JOGO.Mobile.economico && JOGO.Mobile.economico()) return;
    if (!THREE.EffectComposer || !THREE.RenderPass || !THREE.UnrealBloomPass) return;
    try {
      composer = new THREE.EffectComposer(renderer);
      composer.addPass(new THREE.RenderPass(scene, camera));
      bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(W * 0.5, H * 0.5), 0.30, 0.62, 0.99);
      composer.addPass(bloomPass);
      composer.setSize(W, H);
    } catch (e) { composer = null; bloomPass = null; }
  }

  // Cúpula de céu em gradiente: o chão estendido se perde na névoa e o alto
  // continua sendo um lugar, não um retângulo de cor chapada.
  var skyDome = null;
  var SKY_VS = 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';
  var SKY_FS = [
    'uniform vec3 uTop; uniform vec3 uBot; varying vec3 vP;',
    'void main(){',
    '  float h = clamp(vP.y / 220.0 + 0.34, 0.0, 1.0);',
    '  gl_FragColor = vec4(mix(uBot, uTop, pow(h, 0.85)), 1.0);',
    '}'
  ].join('\n');
  function buildSky(E) {
    if (!skyDome) {
      var g = new THREE.SphereGeometry(300, 24, 16);
      skyDome = new THREE.Mesh(g, new THREE.ShaderMaterial({
        uniforms: { uTop: { value: new THREE.Color(0x0a0d10) }, uBot: { value: new THREE.Color(0x203020) } },
        vertexShader: SKY_VS, fragmentShader: SKY_FS,
        side: THREE.BackSide, depthWrite: false, fog: false
      }));
      skyDome.renderOrder = -1;
      scene.add(skyDome);
    }
    var bot = col3(E.fog);
    var top = bot.clone().multiplyScalar(0.28);
    skyDome.material.uniforms.uBot.value.copy(bot);
    skyDome.material.uniforms.uTop.value.copy(top);
  }

  function applyTheme(theme) {
    if (theme === curTheme) return;
    curTheme = theme;
    var E = envOf(theme);
    buildSky(E);
    var fog = col3(E.fog);
    scene.background = fog.clone();
    scene.fog.color = fog.clone();
    lights.hemi.color = col3(E.sky);
    lights.hemi.groundColor = col3(E.gnd);
    lights.hemi.intensity = E.hemiI;
    lights.sun.color = col3(E.sun);
    lights.sun.intensity = E.sunI;
    lights.rim.color = col3(E.rim);
  }

  // ================================================================ TABULEIRO
  var boardMeshes = [];
  var boardProcedural = false;
  function clearBoard() {
    for (var i = boardMeshes.length - 1; i >= 0; i--) {
      var m = boardMeshes[i];
      if (m.parent) m.parent.remove(m);
      if (m.geometry && m.geometry.__own) m.geometry.dispose();
      if (m.material && m.material.dispose) m.material.dispose();
    }
    boardMeshes.length = 0;
    while (boardG.children.length) boardG.remove(boardG.children[0]);
  }

  // O KIT DE CENÁRIO já está no repositório: `assets/embedded/env-kit.js`
  // (49 GLBs do KayKit Dungeon Remastered, CC0 — mesma família visual dos
  // personagens). `js/render3d/models3d.js` (camada v1, congelada) sabe montá-lo
  // com auto-tiling de paredes, buracos com profundidade e props de borda:
  // REAPROVEITAMOS esse código em vez de reescrever.
  function kit() {
    var K = JOGO.Models3D;
    return (K && K.isReady && K.isReady() && K.buildTile) ? K : null;
  }
  var LOW_PROPS = {
    garden:   ['crates', 'barrel', 'chest'],
    cistern:  ['chest', 'table', 'coins'],
    forge:    ['keg', 'box_big', 'crates'],
    scaffold: ['crates', 'barrel', 'chest'],
    mine:     ['crates', 'barrel', 'rubble'],
    heart:    ['chest', 'crates', 'barrel']
  };
  function hashXY(x, y) { return ((x * 73856093) ^ (y * 19349663)) >>> 0; }
  function lighten(hex, k) {
    var c = new THREE.Color(hexInt(hex));
    c.r = Math.min(1, c.r + (1 - c.r) * k);
    c.g = Math.min(1, c.g + (1 - c.g) * k);
    c.b = Math.min(1, c.b + (1 - c.b) * k);
    return '#' + c.getHexString();
  }
  // normaliza a altura de uma peca de cenario (o kit vem em escalas variadas)
  // ESCALA PELA ALTURA, MAS SEM ESTOURAR A CASA.
  //
  // Escalar só pela altura funciona para prop alto e estreito (barril, caixote)
  // e QUEBRA para prop baixo e largo. A mesa do KayKit é o caso: ela nasce mais
  // larga do que alta, e esticá-la até 0,95 m de altura levava o tampo a mais de
  // 2,6 m de lado — uma laje pálida e chapada, maior que a própria casa,
  // pairando a quase um metro do chão. Foi o "quadrado transparente em cima dos
  // itens de divisória": não era transparente nem era um quadrado solto, era o
  // tampo inflado.
  //
  // Agora a altura continua sendo o alvo, mas a LARGURA tem teto: o prop nunca
  // passa de `limite` (padrão: a casa inteira menos uma folga). Quando os dois
  // brigam, ganha o menor — melhor um móvel mais baixo do que um que invade a
  // casa do vizinho.
  function fitHeight(node, target, limite) {
    node.updateMatrixWorld(true);
    var bb = new THREE.Box3().setFromObject(node);
    var hgt = bb.max.y - bb.min.y;
    var larg = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    if (!isFinite(hgt) || hgt <= 0.01) return;
    var k = target / hgt;
    // 0,82 -> 0,95 da casa. O teto existe para o prop nao invadir a casa do
    // vizinho, e 0,82 era medo a mais: 0,95 x 2,0 = 1,90 m ainda cabe folgado
    // nos 2,0 m da casa. A diferenca importa para peca naturalmente larga — a
    // redoma de vidro quebrada tem 2,8 de largura para cada 1 de altura, e com
    // o teto apertado ela encolhia para 0,58 m em vez dos 0,95 m do papel.
    var teto = (limite == null ? CELL * 0.95 : limite);
    if (isFinite(larg) && larg > 0.01 && larg * k > teto) k = teto / larg;
    node.scale.multiplyScalar(k);
  }

  // Um único material clonado por material de origem: mantém o merge por
  // material (poucas draw calls) e ainda permite tingir as paredes por tema.
  function retint(root, color, k, cache) {
    var c = col3(color);
    root.traverse(function (n) {
      if (!n.isMesh || !n.material) return;
      var mats = Array.isArray(n.material) ? n.material : [n.material];
      var out = [];
      for (var i = 0; i < mats.length; i++) {
        var m = mats[i];
        if (!m) { out.push(m); continue; }
        var key = m.uuid;
        if (!cache[key]) {
          var cl = m.clone();
          if (cl.color) cl.color.lerp(c, k);
          cache[key] = cl;
        }
        out.push(cache[key]);
      }
      n.material = Array.isArray(n.material) ? out : out[0];
    });
  }

  // ---------------------------------------------- CENÁRIO DO USUÁRIO (v3)
  //
  // Quando `JOGO.CENARIO[tema]` existe, as peças do Daniel entram no lugar das
  // do acervo emprestado. Foi o que ele pediu ao notar que "as paredes estão num
  // gráfico diferente do meu personagem": com o elenco todo sendo dele, o
  // cenário virou a única coisa fora de tom.
  //
  // A escolha é por SEMENTE DA CASA, nunca aleatória: a mesma sala tem de nascer
  // igual toda vez que for redesenhada, senão o barril troca de lugar quando um
  // muro sobe e o jogador vê o cenário piscar.
  function pecaUsuario(theme, papel, seed, alvoAlt) {
    var cat = JOGO.CENARIO && JOGO.CENARIO[theme];
    var lista = cat && cat[papel];
    if (!lista || !lista.length || !M || !M.rawScene) return null;
    var chave = lista[seed % lista.length];
    var cena = null;
    try { cena = M.rawScene(chave); } catch (e) { return null; }
    if (!cena) return null;
    var no = cena.clone(true);
    no.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    if (alvoAlt) fitHeight(no, alvoAlt);
    return no;
  }

  // A FILEIRA A QUE ESTA CASA PERTENCE.
  //
  // Devolve {semente, eixo}: a semente é a mesma para toda a corrida (para que
  // todas as casas usem a MESMA peça) e o eixo diz se a barreira corre em X ou
  // em Z (para girar a peça e não deixar buraco entre uma casa e a seguinte).
  //
  // Casa isolada continua sendo casa isolada — aí a semente é dela mesma e
  // qualquer peça serve.
  function fileiraDe(st, x, y, ehBaixo) {
    var x0 = x, x1 = x, y0 = y, y1 = y;
    while (ehBaixo(x0 - 1, y)) x0--;
    while (ehBaixo(x1 + 1, y)) x1++;
    while (ehBaixo(x, y0 - 1)) y0--;
    while (ehBaixo(x, y1 + 1)) y1++;
    var compX = x1 - x0 + 1, compZ = y1 - y0 + 1;
    if (compX >= compZ) return { semente: hashXY(x0, y), eixo: 'x', comp: compX };
    return { semente: hashXY(x, y0), eixo: 'z', comp: compZ };
  }

  function buildBoardKit(st, pal, theme) {
    var K = kit();
    if (!K) return false;
    var w = gridW, h = gridH;
    var envG = new THREE.Group();
    envG.name = 'envkit';
    // o kit da v1 nasce com a célula (0,0) na origem; o nosso mundo é centrado
    envG.position.set(-(w - 1) / 2 * CELL, 0, -(h - 1) / 2 * CELL);

    var staticG = new THREE.Group();
    // CHAO ESTENDIDO: o campo tem de ser um LUGAR. O chao da v1 nasce escuro
    // demais para a luz nova, e props apoiados nele pareciam boiar no vazio.
    try {
      // O rodapé recebe a SILHUETA da sala: sem isso ele desenhava um retângulo
      // em volta da grade e re-quadrava o mapa inteiro, justamente depois de as
      // salas ganharem contorno próprio. Vazio ('hole') e fora da grade não são sala.
      var ground = K.buildGround(theme, w, h, function (cx, cy) {
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
        return tileKind(gridTile(st, cx, cy)) !== 'hole';
      });
      var gcache = {};
      // 0,55 -> 0,34. O material do KayKit nao tem cor de base: TUDO vem do
      // atlas de textura, entao tingir e MULTIPLICAR o desenho por uma cor
      // chapada. A 0,55 o chao perdia a pedra, a junta e o desgaste e virava um
      // campo liso — foi o "parece sem acabamento". A 0,34 a paleta do calabouco
      // ainda manda no clima e o desenho da textura sobrevive por baixo.
      retint(ground, lighten(pal.floor2, 0.42), 0.34, gcache);
      staticG.add(ground);
    } catch (e) {}

    function isWall(x2, y2) {
      if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) return false;
      return tileKind(gridTile(st, x2, y2)) === 'high';
    }
    function isLow(x2, y2) {
      if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) return false;
      return tileKind(gridTile(st, x2, y2)) === 'low';
    }
    var lowKinds = LOW_PROPS[theme] || LOW_PROPS.garden;
    var lowNodes = [];
    var wallCache = {};

    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var k = tileKind(gridTile(st, x, y));
      var seed = hashXY(x, y);
      var node = null;
      var naBorda = (x === 0 || y === 0 || x === w - 1 || y === h - 1);
      if (k === 'high') {
        // As colunas do usuário são PILARES SOLTOS, e o anel de borda precisa de
        // parede contínua (com encaixe de vizinho) para a sala ter muro. Então:
        // pilar dele nas casas de dentro, parede do acervo na moldura.
        // O mesmo vale para a parede de dentro: `##` é um trecho de muro, não
        // duas estátuas soltas. A peça vem da fileira.
        var filaA = naBorda ? null : fileiraDe(st, x, y, isWall);
        var col = filaA ? pecaUsuario(theme, 'alto', filaA.semente, WALL_H) : null;
        if (col) {
          node = col;
        } else {
          node = K.buildWall(theme, seed, {
            mask: { n: isWall(x, y - 1), e: isWall(x + 1, y), s: isWall(x, y + 1), w: isWall(x - 1, y) },
            border: naBorda
          });
          // Mesma razao do chao: a parede do kit tem bloco, argamassa e musgo
          // desenhados na textura, e a cor chapada os apagava.
          retint(node, pal.wall, 0.22, wallCache);
        }
      } else if (k === 'hole') {
        node = K.buildHole(theme, seed);
      } else if (k === 'low') {
        // obstáculo BAIXO: chão normal + a peça da DIVISÓRIA. Bloqueia passagem,
        // NÃO bloqueia a visão — por isso é visivelmente mais baixo que a parede.
        node = K.buildTile(theme, ((x + y) % 2) ? 'floor2' : 'floor1', seed % 97);
        // A peça sai da FILEIRA, não da casa: cinco casas seguidas usam a mesma
        // e leem como uma barreira só. Sorteando por casa, uma corrida de cinco
        // virava cinco objetos diferentes — entulho, não divisória.
        var fila = fileiraDe(st, x, y, isLow);
        // ALTURA NORMALIZADA: o obstaculo tem de ler como "da para ver por
        // cima" e nunca competir com uma unidade (heroi ~2,05 de altura).
        var prop = pecaUsuario(theme, 'baixo', fila.semente, 0.95);
        if (!prop) {
          prop = K.buildProp(theme, lowKinds[fila.semente % lowKinds.length], fila.semente);
          fitHeight(prop, 0.95);
        }
        prop.position.set(x * CELL, 0, y * CELL);
        // GIRA PARA O EIXO DA FILEIRA. Uma peça mais larga que funda, posta numa
        // corrida vertical sem girar, deixa vão entre uma casa e a seguinte — a
        // barreira fica furada justamente onde devia barrar.
        if (fila.eixo === 'z' && fila.comp > 1) prop.rotation.y = Math.PI / 2;
        lowNodes.push({ node: prop, x: x, y: y });
      } else if (k === 'deco') {
        node = K.buildTile(theme, 'deco', seed % 4);
        // o enfeite de piso do usuário vai POR CIMA do ladrilho, sem colisão
        var enf = pecaUsuario(theme, 'chao', seed, 0.25);
        if (enf) { enf.position.set(x * CELL, 0.02, y * CELL); lowNodes.push({ node: enf, x: x, y: y }); }
      } else {
        node = K.buildTile(theme, ((x + y) % 2) ? 'floor2' : 'floor1', seed % 97);
      }
      if (node) { node.position.set(x * CELL, 0, y * CELL); staticG.add(node); }
    }
    for (var L = 0; L < lowNodes.length; L++) staticG.add(lowNodes[L].node);

    // props de borda: o campo é um LUGAR, não um diorama solto no vazio
    // Props de borda: encostados na arena (nunca boiando no horizonte), com
    // altura normalizada e um disco de contato que os assenta no chao.
    var padPos = [];
    try {
      var kinds = K.propKinds(theme);
      var rr = 0;
      var cxp = (w - 1) / 2 * CELL, czp = (h - 1) / 2 * CELL;
      var halfW = (w / 2) * CELL, halfH = (h / 2) * CELL;
      for (var p = 0; p < 18; p++) {
        var a = (p / 18) * Math.PI * 2 + ((hashXY(p, 7) % 100) / 100) * 0.35;
        var ca = Math.cos(a), sa = Math.sin(a);
        // distancia ate a BORDA do retangulo nessa direcao + folga de 1..2.6 celulas
        var tx = Math.abs(ca) > 1e-4 ? halfW / Math.abs(ca) : 1e9;
        var tz = Math.abs(sa) > 1e-4 ? halfH / Math.abs(sa) : 1e9;
        var edge = Math.min(tx, tz);
        var d = edge + CELL * (1.0 + ((hashXY(p, 3) % 100) / 100) * 1.6);
        var px = cxp + ca * d, pz = czp + sa * d;
        var altBorda = 0.85 + ((hashXY(p, 5) % 100) / 100) * 0.9;
        var prop2 = pecaUsuario(theme, 'borda', p * 131 + 17, altBorda);
        if (!prop2) {
          prop2 = K.buildProp(theme, kinds[(p * 7 + rr++) % kinds.length], p * 131 + 17);
          fitHeight(prop2, altBorda);
        }
        prop2.position.set(px, 0, pz);
        staticG.add(prop2);
        padPos.push([px, 0.02, pz]);
      }
    } catch (e2) {}

    /* Os 18 discos de contato dos props eram 18 malhas COM 18 MATERIAIS — 18
     * chamadas de desenho para 36 triângulos no total. São todos iguais: viram
     * um `InstancedMesh`, uma chamada. (MEDIDO: parte dos 149 do grupo `board`.) */
    if (padPos.length) {
      var padMesh = new THREE.InstancedMesh(M.tileFlatGeo(), new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false
      }), padPos.length);
      var mtxP = new THREE.Matrix4(), escP = new THREE.Vector3(0.55, 0.55, 0.55);
      var quatP = new THREE.Quaternion(), posP = new THREE.Vector3();
      for (var pi = 0; pi < padPos.length; pi++) {
        posP.set(padPos[pi][0], padPos[pi][1], padPos[pi][2]);
        mtxP.compose(posP, quatP, escP);
        padMesh.setMatrixAt(pi, mtxP);
      }
      padMesh.instanceMatrix.needsUpdate = true;
      padMesh.renderOrder = 2;
      padMesh.frustumCulled = false;
      envG.add(padMesh);
    }

    envG.add((K.mergeStatic && !window.__nomerge) ? K.mergeStatic(staticG) : staticG);
    try {
      if (K.buildGridLines) envG.add(K.buildGridLines(theme, w, h));
      if (K.buildBrazier) {
        var corners = [[-1.1, -1.1], [w + 0.1, -1.1], [-1.1, h + 0.1], [w + 0.1, h + 0.1]];
        for (var b2 = 0; b2 < 4; b2++) {
          var brz = K.buildBrazier(theme, b2);
          brz.position.set(corners[b2][0] * CELL, 0, corners[b2][1] * CELL);
          envG.add(brz);
        }
      }
    } catch (e3) {}

    /* O MARCADOR FLUTUANTE DO OBSTÁCULO BAIXO SAIU.
     *
     * Havia aqui um quadrado translúcido da cor de destaque, do tamanho da
     * casa, pairando a 1,02 m sobre cada baú e cada barril. Ele existia para
     * dizer uma regra verdadeira (§6: obstáculo baixo bloqueia passagem, não
     * bloqueia visão), mas dizia isso com uma placa no ar — o Daniel reclamou
     * dele duas vezes, e da segunda com razão redobrada: eu tinha consertado o
     * tampo inflado das mesas e jurado que era isso, quando o quadrado que ele
     * via era este, num caminho de código diferente.
     *
     * A regra continua sendo dita, só que pelo objeto: o obstáculo tem 0,95 m e
     * a parede tem 3,10 m — mais de três vezes. Quem olha o tabuleiro vê por
     * cima de um e não vê por cima do outro. Se um dia fizer falta um reforço,
     * que seja um CONTORNO no chão da casa, nunca uma placa suspensa.
     */

    boardG.add(envG);
    boardMeshes.push(envG);
    return true;
  }

  function buildBoard(st) {
    clearBoard();
    moldura.jaAjustou = false;          // sala nova: vale reenquadrar de novo
    gridW = st.grid.w; gridH = st.grid.h;
    var pal0 = paletteOf(st), theme0 = themeOf(st);
    applyTheme(theme0);
    boardProcedural = false;
    if (buildBoardKit(st, pal0, theme0)) {
      var fw0 = gridW * CELL, fh0 = gridH * CELL;
      var span0 = Math.max(fw0, fh0) * 0.75 + 6;
      lights.sun.shadow.camera.left = -span0;
      lights.sun.shadow.camera.right = span0;
      lights.sun.shadow.camera.top = span0;
      lights.sun.shadow.camera.bottom = -span0;
      lights.sun.shadow.camera.updateProjectionMatrix();
      scene.fog.near = span0 * 0.75;
      scene.fog.far = span0 * 2.6;
      fitCamera(st);
      return;
    }
    boardProcedural = true;
    buildBoardProc(st);
  }

  // Plano B totalmente procedural: se o env-kit não estiver disponível, o jogo
  // continua rodando (caixas tingidas pela paleta do calabouço).
  function buildBoardProc(st) {
    var pal = paletteOf(st);
    var theme = themeOf(st);
    applyTheme(theme);

    var floorMat1 = new THREE.MeshStandardMaterial({ color: col3(pal.floor1), roughness: 0.94, metalness: 0.0 });
    var floorMat2 = new THREE.MeshStandardMaterial({ color: col3(pal.floor2), roughness: 0.94, metalness: 0.0 });
    var decoMat = new THREE.MeshStandardMaterial({ color: col3(pal.primary), roughness: 0.88, metalness: 0.02 });
    var wallMat = new THREE.MeshStandardMaterial({ color: col3(pal.wall), roughness: 0.9, metalness: 0.04 });
    var lowMat = new THREE.MeshStandardMaterial({ color: col3(pal.lowWall), roughness: 0.88, metalness: 0.04 });

    var floorGeo = M.floorGeo(), highGeo = M.highGeo(), lowGeo = M.lowGeo();

    var counts = { f1: 0, f2: 0, deco: 0, high: 0, low: 0 };
    var x, y, k;
    for (y = 0; y < gridH; y++) for (x = 0; x < gridW; x++) {
      k = tileKind(gridTile(st, x, y));
      if (k === 'hole') continue;
      if (k === 'high') counts.high++;
      else if (k === 'low') counts.low++;
      else if (k === 'deco') counts.deco++;
      else if ((x + y) & 1) counts.f2++; else counts.f1++;
    }

    var inst = {
      f1: counts.f1 ? new THREE.InstancedMesh(floorGeo, floorMat1, counts.f1) : null,
      f2: counts.f2 ? new THREE.InstancedMesh(floorGeo, floorMat2, counts.f2) : null,
      deco: counts.deco ? new THREE.InstancedMesh(floorGeo, decoMat, counts.deco) : null,
      high: counts.high ? new THREE.InstancedMesh(highGeo, wallMat, counts.high) : null,
      low: counts.low ? new THREE.InstancedMesh(lowGeo, lowMat, counts.low) : null,
    };
    for (var key in inst) {
      var im = inst[key];
      if (!im) continue;
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      boardG.add(im);
      boardMeshes.push(im);
    }
    var idx = { f1: 0, f2: 0, deco: 0, high: 0, low: 0 };
    var mtx = new THREE.Matrix4();
    for (y = 0; y < gridH; y++) for (x = 0; x < gridW; x++) {
      k = tileKind(gridTile(st, x, y));
      if (k === 'hole') continue;
      var px = wx(x), pz = wz(y);
      if (k === 'high') {
        mtx.makeTranslation(px, WALL_H / 2, pz);
        inst.high.setMatrixAt(idx.high++, mtx);
      } else if (k === 'low') {
        // (o marcador suspenso que ficava em LOW_H + 0.12 saiu — ver a nota
        //  em buildBoardKit: a altura do obstáculo já diz que dá para ver por cima)
        mtx.makeTranslation(px, LOW_H / 2, pz);
        inst.low.setMatrixAt(idx.low, mtx);
        idx.low++;
      } else if (k === 'deco') {
        mtx.makeTranslation(px, -0.2, pz);
        inst.deco.setMatrixAt(idx.deco++, mtx);
      } else {
        mtx.makeTranslation(px, -0.2, pz);
        if ((x + y) & 1) inst.f2.setMatrixAt(idx.f2++, mtx);
        else inst.f1.setMatrixAt(idx.f1++, mtx);
      }
    }
    for (var key2 in inst) if (inst[key2]) inst[key2].instanceMatrix.needsUpdate = true;

    // fosso: um plano escuro sob os buracos, e a "casca" externa do campo
    var voidGeo = new THREE.PlaneGeometry(gridW * CELL + 40, gridH * CELL + 40);
    voidGeo.rotateX(-Math.PI / 2);
    var voidMesh = new THREE.Mesh(voidGeo, new THREE.MeshStandardMaterial({
      color: col3(pal.voidColor), roughness: 1, metalness: 0
    }));
    voidMesh.position.y = -HOLE_D;
    voidMesh.receiveShadow = true;
    boardG.add(voidMesh); boardMeshes.push(voidMesh);

    // borda: uma moldura baixa que dá "lugar" ao campo
    var frameMat = new THREE.MeshStandardMaterial({ color: col3(pal.secondary), roughness: 0.95 });
    var fw = gridW * CELL, fh = gridH * CELL;
    var edges = [
      [0, -(fh / 2 + CELL * 0.6), fw + CELL * 2, CELL * 1.2],
      [0, (fh / 2 + CELL * 0.6), fw + CELL * 2, CELL * 1.2],
      [-(fw / 2 + CELL * 0.6), 0, CELL * 1.2, fh],
      [(fw / 2 + CELL * 0.6), 0, CELL * 1.2, fh]
    ];
    for (var e = 0; e < edges.length; e++) {
      var g2 = new THREE.BoxGeometry(edges[e][2], 0.5, edges[e][3]);
      g2.__own = true;
      var mm = new THREE.Mesh(g2, frameMat);
      mm.position.set(edges[e][0], -0.32, edges[e][1]);
      mm.receiveShadow = true; mm.castShadow = false;
      boardG.add(mm); boardMeshes.push(mm);
    }

    // a luz-chave e a sombra seguem o tamanho da sala
    var span = Math.max(fw, fh) * 0.75 + 6;
    lights.sun.shadow.camera.left = -span;
    lights.sun.shadow.camera.right = span;
    lights.sun.shadow.camera.top = span;
    lights.sun.shadow.camera.bottom = -span;
    lights.sun.shadow.camera.updateProjectionMatrix();
    scene.fog.near = span * 0.75;
    scene.fog.far = span * 2.6;

    fitCamera(st);
  }

  function roomKey(st) {
    var s = String(st.dungeonId) + '|' + st.roomIndex + '|' + st.grid.w + 'x' + st.grid.h + '|';
    for (var y = 0; y < st.grid.h; y += 2) for (var x = 0; x < st.grid.w; x += 2) s += (tileKind(gridTile(st, x, y)) || '.').charAt(0);
    return s;
  }

  // =================================================================== CÂMERA
  // ENQUADRAMENTO: com salas de até 23×19 células, mostrar a sala inteira deixa
  // todo mundo do tamanho de formiga. Enquadramos o GRUPO + o primeiro punhado
  // de inimigos, e nunca deixamos a célula menor que ~44 px na tela (§0, mobile).
  /* ------------------------------------------------------- MOLDURA DA HUD
   * Em retrato de celular a HUD come as duas pontas da tela: 95 px de barra
   * em cima e 229 px de feitiços embaixo, num aparelho de 844 px. O tabuleiro
   * continuava sendo enquadrado no CENTRO DO CANVAS — que fica 67 px abaixo do
   * centro da faixa que sobra —, então a fileira de baixo do mapa nascia atrás
   * da barra de feitiços. Quem joga no telefone não via as próprias unidades.
   *
   * `setViewOffset` resolve sem gambiarra de posição: a câmera passa a enquadrar
   * uma IMAGEM MAIOR e desenhamos só a janela que aparece, deslocada para que o
   * centro do enquadramento caia no meio da FAIXA LIVRE, não do canvas.
   *
   * Só entra no celular (`Mobile.celular()`): no desktop a HUD é lateral e o
   * enquadramento de sempre continua valendo — e continua sendo o que as 50
   * páginas de teste medem.
   */
  var moldura = { topo: 0, base: 0, imgH: 0 };
  function faixaLivre() { return Math.max(80, H - moldura.topo - moldura.base); }
  function aplicaMoldura() {
    if (!camera) return;
    if (!moldura.topo && !moldura.base) {
      if (camera.view && camera.view.enabled) camera.clearViewOffset();
      camera.aspect = W / H;
      moldura.imgH = H;
      camera.updateProjectionMatrix();
      return;
    }
    var cy = (moldura.topo + (H - moldura.base)) / 2;      // centro da faixa livre
    var imgH = 2 * Math.max(cy, H - cy);                   // altura da imagem virtual
    moldura.imgH = imgH;
    camera.aspect = W / imgH;
    camera.setViewOffset(W, imgH, 0, Math.round(imgH / 2 - cy), W, H);
    camera.updateProjectionMatrix();
  }
  R.setMoldura = function (topoPx, basePx) {
    var t = Math.max(0, topoPx | 0), b = Math.max(0, basePx | 0);
    if (t === moldura.topo && b === moldura.base) return false;
    moldura.topo = t; moldura.base = b;
    aplicaMoldura();
    // Reenquadrar UMA vez por sala. A barra de fusão aparece e some no meio da
    // luta; refazer o enquadramento a cada vez roubaria a câmera das mãos de
    // quem já tinha girado ou aproximado — o deslocamento acima já resolve o
    // essencial sozinho.
    var st = state();
    if (st && st.grid && !moldura.jaAjustou) { moldura.jaAjustou = true; fitCamera(st); }
    return true;
  };
  R.moldura = function () { return { topo: moldura.topo, base: moldura.base, imgH: moldura.imgH }; };

  function fitCamera(st) {
    var fw = gridW * CELL, fh = gridH * CELL;
    var span = Math.max(fw, fh);
    cam.minDist = Math.max(5, span * 0.16);
    cam.maxDist = span * 2.0;
    cam.pivot.set(0, CELL * 0.4, 0);
    cam.panX = 0; cam.panZ = 0;

    var focus = actionBounds(st);
    var needW = span, needH = span;
    if (focus) {
      cam.panX = wx((focus.x0 + focus.x1) / 2);
      cam.panZ = wz((focus.y0 + focus.y1) / 2);
      // Enquadramento: o teto de 11 células deixava a câmera colada — numa sala
      // 17x15 apareciam 8 células e UMA unidade de sete, e o mapa tático não
      // dava para ler. Agora a moldura acompanha a ação até a sala inteira, e a
      // trava de legibilidade abaixo é que decide o limite.
      // Quem decide o enquadramento é o PISO da faixa, não o teto: com a ação
      // concentrada num canto, `focus` é pequeno e a câmera cola. Subir o teto
      // de 11 para 17 mudou a distância de 17,2 para 18,9 — quase nada. O piso
      // é que precisa mostrar o mapa: 15x13 células, ou a sala inteira se for menor.
      // O piso acompanha o TAMANHO DA SALA, não um número fixo: as salas
      // cresceram para 21x17–27x23 e um piso cravado em 15x13 voltaria a
      // esconder o mapa tático justamente nas salas grandes, que são as que
      // mais precisam ser lidas de uma vez.
      // NO CELULAR O PISO SE INVERTE. Em 390 px de largura só cabem ~13 casas
      // com célula legível; pedir 85% de uma sala de 21x17 empurra a câmera até
      // o teto de legibilidade e ainda assim corta os lados — o pior dos dois
      // mundos, longe E incompleto. Em pé, a moldura hug a AÇÃO: 11 casas de
      // piso, que é o que a tela sustenta.
      var noCelular = !!(moldura.topo || moldura.base);
      var pisoW = noCelular ? Math.min(gridW, 11) : Math.min(gridW, Math.max(15, Math.round(gridW * 0.85)));
      var pisoH = noCelular ? Math.min(gridH, 11) : Math.min(gridH, Math.max(13, Math.round(gridH * 0.85)));
      needW = clamp((focus.x1 - focus.x0 + (noCelular ? 3 : 6)), pisoW, gridW) * CELL;
      needH = clamp((focus.y1 - focus.y0 + (noCelular ? 3 : 6)), pisoH, gridH) * CELL;
    }
    var vfov = camera.fov * Math.PI / 180;
    var tanV = Math.tan(vfov / 2);
    // Fatores empíricos. Os antigos (0,66 e 0,86) ENCOLHIAM a distância bem na
    // hora em que a inclinação já achata o tabuleiro — o resultado era a câmera
    // colada mesmo pedindo a sala inteira. Recalibrados pelo enquadramento que
    // ficou bom numa sala 17x15: mostra o mapa sem virar formigueiro.
    // Com moldura, o que cabe não é o canvas inteiro: é a FAIXA LIVRE. `kV`
    // mede quanto da imagem virtual sobra visível; sem moldura vale 1 e a conta
    // volta a ser exatamente a de antes.
    var imgH = moldura.imgH || H;
    var kV = imgH / faixaLivre();
    var aspEff = W / imgH;
    // O piso do aspecto existe para a câmera não fugir numa tela muito alta.
    // Com moldura ele desce: a imagem virtual é 977 px para 390 de largura, e
    // travar em 0,55 faria a conta acreditar numa tela 38% mais larga do que
    // ela é — foi por isso que as unidades da esquerda nasciam fora da tela.
    var pisoAsp = (moldura.topo || moldura.base) ? 0.34 : 0.55;
    var fitV = (needH * 0.5) / tanV * kV * 0.88;
    var fitH = (needW * 0.5) / (tanV * Math.max(pisoAsp, aspEff)) * 1.05;
    var d = Math.max(fitV, fitH);
    // Trava de legibilidade. No celular a célula precisa caber o dedo (§0), mas
    // no desktop os 40 px de antes eram o que prendia a câmera perto: davam
    // dist ~17 numa sala de 17x15. Tela grande aguenta célula menor sem perder
    // leitura, e é ela que mostra o mapa inteiro.
    // 40 px de célula era a regra do dedo — e ela nasceu quando UM toque já
    // resolvia a jogada. Com a mira em dois toques o erro passou a ser de graça
    // (o primeiro toque só aponta), então 30 px cabem: são três casas a mais de
    // tabuleiro visível em cada direção, que num mapa 21x17 é a diferença entre
    // ver a briga e ver um pedaço dela.
    var minCellPx = (moldura.topo || moldura.base) ? 30 : (Math.min(W, H) < 620 ? 40 : 26);
    var maxD = (CELL * imgH) / (2 * tanV * minCellPx);
    cam.dist = clamp(Math.min(d, maxD), cam.minDist, cam.maxDist);
    updateCamera();
  }
  // caixa que contém o grupo do jogador e os inimigos mais próximos dele
  function actionBounds(st) {
    if (!st.units || !st.units.length) return null;
    var mine = [], foes = [];
    for (var i = 0; i < st.units.length; i++) {
      var u = st.units[i];
      if (!u.alive || u.offBoard) continue;
      (u.side === 'player' ? mine : foes).push(u);
    }
    if (!mine.length) mine = foes;
    if (!mine.length) return null;
    var cx = 0, cy = 0;
    for (var m = 0; m < mine.length; m++) { cx += mine[m].x; cy += mine[m].y; }
    cx /= mine.length; cy /= mine.length;
    foes.sort(function (a, b) {
      return (Math.abs(a.x - cx) + Math.abs(a.y - cy)) - (Math.abs(b.x - cx) + Math.abs(b.y - cy));
    });
    var pool = mine.concat(foes.slice(0, Math.max(2, Math.min(4, foes.length))));
    var b = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 };
    for (var p = 0; p < pool.length; p++) {
      b.x0 = Math.min(b.x0, pool[p].x); b.x1 = Math.max(b.x1, pool[p].x);
      b.y0 = Math.min(b.y0, pool[p].y); b.y1 = Math.max(b.y1, pool[p].y);
    }
    return b;
  }
  function updateCamera() {
    var st = Math.sin(cam.tilt), ct = Math.cos(cam.tilt);
    var px = cam.pivot.x + cam.panX, pz = cam.pivot.z + cam.panZ;
    var tx = px + shake.x * 0.02, tz = pz;
    camera.position.set(
      tx + Math.sin(cam.ang) * st * cam.dist,
      cam.pivot.y + ct * cam.dist + shake.y * 0.02,
      tz + Math.cos(cam.ang) * st * cam.dist
    );
    camera.lookAt(tx, cam.pivot.y + shake.y * 0.02, tz);
    // o sol acompanha o azimute para a sombra nunca cair atrás da câmera
    lights.sun.position.set(px + Math.sin(cam.ang + 0.9) * 22, 26, pz + Math.cos(cam.ang + 0.9) * 22);
    lights.sun.target.position.set(px, 0, pz);
    lights.sun.target.updateMatrixWorld();
  }

  R.setCamera = function (o) {
    if (!o) return;
    if (o.ang != null) cam.ang = o.ang;
    if (o.tilt != null) cam.tilt = clamp(o.tilt, cam.minTilt, cam.maxTilt);
    if (o.dist != null) cam.dist = clamp(o.dist, cam.minDist, cam.maxDist);
    if (o.zoom != null) cam.dist = clamp(cam.dist / Math.max(0.05, o.zoom), cam.minDist, cam.maxDist);
    if (o.panX != null) cam.panX = o.panX;
    if (o.panY != null) cam.panZ = o.panY;
    if (o.panZ != null) cam.panZ = o.panZ;
    if (o.rot != null) {
      // §9-E: quatro posições fixas — em 3D vira azimute em múltiplos de 90°
      var want = ((o.rot | 0) % 4 + 4) % 4;
      var target = -Math.PI / 4 + want * Math.PI / 2;
      if (o.animate === false) { cam.ang = target; rotAnim = null; }
      else rotAnim = { from: cam.ang, to: target, t: 0, dur: 0.26 };
    }
    if (o.centerX != null && o.centerY != null) {
      cam.panX = wx(o.centerX); cam.panZ = wz(o.centerY);
    }
    updateCamera();
  };
  R.getCamera = function () {
    return { ang: cam.ang, tilt: cam.tilt, dist: cam.dist, zoom: 1,
             panX: cam.panX, panY: cam.panZ, rot: R.rotation() };
  };
  R.rotation = function () {
    var q = Math.round((cam.ang + Math.PI / 4) / (Math.PI / 2));
    return ((q % 4) + 4) % 4;
  };
  R.rotate = function (dir) {
    if (rotAnim) return false;
    var to = cam.ang + (dir < 0 ? -1 : 1) * Math.PI / 2;
    rotAnim = { from: cam.ang, to: to, t: 0, dur: 0.28 };
    return true;
  };
  function updateRot(dt) {
    if (!rotAnim) return;
    rotAnim.t += dt;
    var k = Math.min(1, rotAnim.t / rotAnim.dur);
    var e = k * k * (3 - 2 * k);
    cam.ang = rotAnim.from + (rotAnim.to - rotAnim.from) * e;
    if (k >= 1) rotAnim = null;
  }

  function focusOn(gx, gy, inD, holdD, outD, punch) {
    camFocus = {
      x: wx(gx), z: wz(gy), px0: cam.panX, pz0: cam.panZ, d0: cam.dist,
      t: 0, inD: inD, holdD: holdD, outD: outD, punch: punch == null ? 0.28 : punch
    };
  }
  R.focusOn = focusOn;
  function updateFocus(dt) {
    if (!camFocus) return;
    var f = camFocus; f.t += dt;
    var k;
    if (f.t < f.inD) { k = f.t / f.inD; k = k * k * (3 - 2 * k); }
    else if (f.t < f.inD + f.holdD) k = 1;
    else if (f.t < f.inD + f.holdD + f.outD) { k = 1 - (f.t - f.inD - f.holdD) / f.outD; k = k * k * (3 - 2 * k); }
    else { camFocus = null; return; }
    cam.panX = f.px0 + (f.x - f.px0) * k;
    cam.panZ = f.pz0 + (f.z - f.pz0) * k;
    cam.dist = clamp(f.d0 * (1 - f.punch * k), cam.minDist, cam.maxDist);
  }

  // projeção para a TELA (HUD, rótulos, FX 2D residual)
  var _v3 = new THREE.Vector3();
  R.project = function (gx, gy, z) {
    _v3.set(wx(gx), (z || 0) * 0.02, wz(gy));
    _v3.project(camera);
    return {
      x: (_v3.x * 0.5 + 0.5) * W,
      y: (-_v3.y * 0.5 + 0.5) * H,
      s: 1, d: _v3.z
    };
  };
  R.projectWorld = function (v) {
    var p = v.clone().project(camera);
    return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H, d: p.z };
  };
  R.camZoom = function () { return 22 / Math.max(1, cam.dist); };

  // ==================================================================== ENTRADA
  var ptrs = {}, ptrCount = 0, drag = null, pinch = null, hoverTile = null;
  var raycaster = new THREE.Raycaster();
  var groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function overUI(e) {
    var t = e && e.target;
    if (!t || !t.closest) return false;
    return !!t.closest('#ui-root');
  }
  function localPos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function tileFromScreen(sx, sy) {
    var ndc = new THREE.Vector2((sx / W) * 2 - 1, -(sy / H) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    var hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return { x: -1, y: -1 };
    return { x: Math.round(gxOf(hit.x)), y: Math.round(gyOf(hit.z)) };
  }
  R.tileAt = tileFromScreen;

  function bindInput() {
    canvas.style.touchAction = 'none';
    canvas.style.webkitTapHighlightColor = 'transparent';

    canvas.addEventListener('pointerdown', function (e) {
      if (overUI(e)) return;
      camFocus = null;
      var p = localPos(e);
      ptrs[e.pointerId] = { x: p.x, y: p.y, sx: p.x, sy: p.y, t: (e.timeStamp || Date.now()),
                            tipo: e.pointerType || 'mouse' };
      ptrCount++;
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (er) {} }
      if (ptrCount === 1) { drag = { id: e.pointerId, moved: false, px: p.x, py: p.y }; pinch = null; }
      else if (ptrCount === 2) {
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
          cam.dist = clamp(cam.dist * (pinch.dist / d), cam.minDist, cam.maxDist);
          // dois dedos deslizando = DESLOCAR o pivô no plano do chão
          panBy(mx - pinch.mx, my - pinch.my);
          pinch.dist = d; pinch.mx = mx; pinch.my = my;
          updateCamera();
        }
      } else if (drag && drag.id === e.pointerId) {
        var dx = p.x - drag.px, dy = p.y - drag.py;
        if (!drag.moved && Math.hypot(p.x - rec.sx, p.y - rec.sy) > TAP_PX) drag.moved = true;
        if (drag.moved) {
          // ÓRBITA LIVRE: horizontal gira, vertical inclina
          cam.ang -= dx * 0.007;
          cam.tilt = clamp(cam.tilt - dy * 0.005, cam.minTilt, cam.maxTilt);
          updateCamera();
        }
        drag.px = p.x; drag.py = p.y;
      }
      e.preventDefault();
    };
    canvas.addEventListener('pointermove', moveHandler, { passive: false });
    window.addEventListener('pointermove', function (e) { if (ptrs[e.pointerId]) moveHandler(e); }, { passive: false });

    function endPointer(e) {
      var rec = ptrs[e.pointerId];
      if (!rec) return;
      var p = localPos(e);
      var dt = (e.timeStamp || Date.now()) - rec.t;
      var dist = Math.hypot(p.x - rec.sx, p.y - rec.sy);
      var wasTap = ptrCount === 1 && drag && drag.id === e.pointerId && !drag.moved && dist < TAP_PX && dt < TAP_MS;
      delete ptrs[e.pointerId];
      ptrCount = Math.max(0, ptrCount - 1);
      if (ptrCount < 2) pinch = null;
      if (ptrCount === 0) drag = null;
      else if (drag && drag.id === e.pointerId) {
        var left = Object.keys(ptrs)[0];
        drag = left ? { id: left, moved: true, px: ptrs[left].x, py: ptrs[left].y } : null;
      }
      if (wasTap && !overUI(e)) doTap(p.x, p.y, rec.tipo);
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    window.addEventListener('pointerup', function (e) { if (ptrs[e.pointerId]) endPointer(e); });

    canvas.addEventListener('wheel', function (e) {
      if (overUI(e)) return;
      e.preventDefault();
      cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.0011), cam.minDist, cam.maxDist);
      updateCamera();
    }, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('pointerleave', function () { doHover(-1e6, -1e6); });
  }

  function panBy(dxPx, dyPx) {
    var k = cam.dist * 0.0022;
    var s = Math.sin(cam.ang), c = Math.cos(cam.ang);
    cam.panX -= (dxPx * c - dyPx * s) * k;
    cam.panZ -= (dxPx * -s - dyPx * c) * k;
    var lim = Math.max(gridW, gridH) * CELL * 0.6;
    cam.panX = clamp(cam.panX, -lim, lim);
    cam.panZ = clamp(cam.panZ, -lim, lim);
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
  /* ------------------------------------------------------- MIRA POR TOQUE
   * O jogo mostrava a área do feitiço com o MOUSE POR CIMA. No celular isso
   * não existe: o dedo não paira, e o primeiro contato já é o clique. Sem
   * conserto, quem joga no telefone gasta o PA às cegas — larga a explosão sem
   * nunca ter visto o desenho dela.
   *
   * A saída é a mesma do Dofus Touch: o primeiro toque MIRA (acende o caminho,
   * o alcance e a área, exatamente o que o mouse acendia), o segundo toque na
   * MESMA casa CONFIRMA. Tocar em outra casa só muda a mira — nunca dispara.
   *
   * A mira guarda de quem e de qual feitiço ela é: trocar de feitiço, de
   * unidade ou de turno invalida a confirmação pendente, para que um toque
   * antigo nunca resolva uma ação nova.
   */
  var mira = null;
  R.mira = function () { return mira; };
  R.limpaMira = function () {
    if (!mira) return;
    mira = null;
    var g = game();
    if (g && g.onTileHover) g.onTileHover(-1, -1);
  };
  /* Quem manda é o PONTEIRO que chegou, não o aparelho: num híbrido (notebook
   * com tela sensível) o dedo tem de mirar e o mouse tem de continuar agindo de
   * primeira. Só quando o ponteiro é mouse é que consultamos o perfil — e aí
   * `?mobile=1` serve para experimentar o modo toque numa máquina de mesa. */
  function modoToque(tipo) {
    if (tipo === 'touch' || tipo === 'pen') return true;
    if (JOGO.Mobile && JOGO.Mobile.forcado !== null && JOGO.Mobile.forcado !== undefined) {
      return !!JOGO.Mobile.forcado;
    }
    return !!(JOGO.Mobile && JOGO.Mobile.toque());
  }
  function assinaturaMira() {
    var g = game(), en = engine(), st = state();
    var u = safe(function () { return (en && en.activeUnit && st) ? en.activeUnit(st) : null; }, null);
    return (g ? (g.selectedSpellId || '-') : '-') + '|' + (u ? u.uid : '-') +
           '|' + (u ? u.pa + ':' + u.pp : '-');
  }

  function doTap(sx, sy, tipo) {
    var g = game(); if (!g || !g.onTileClicked) return;
    if (R.isBusy()) return;
    var t = tileFromScreen(sx, sy);

    if (!modoToque(tipo)) { g.onTileClicked(t.x, t.y); return; }

    var sig = assinaturaMira();
    if (mira && mira.x === t.x && mira.y === t.y && mira.sig === sig) {
      mira = null;
      g.onTileClicked(t.x, t.y);
      if (g.onTileHover) g.onTileHover(-1, -1);
      ovSig = '';
      return;
    }
    mira = { x: t.x, y: t.y, sig: sig };
    if (g.onTileHover) g.onTileHover(t.x, t.y);
    ovSig = '';
    if (JOGO.UI && JOGO.UI.dicaMira) JOGO.UI.dicaMira(g.selectedSpellId ? 'feitico' : 'andar');
  }

  // =================================================================== UNIDADES
  function getVis(uid) { return vis[uid] || null; }
  function getVisFor(uid, x, y) {
    var v = vis[uid];
    if (!v) {
      v = vis[uid] = {
        x: x, y: y, z: 0, face: 0, faceTo: 0,
        flash: 0, flashHold: 0, knockX: 0, knockZ: 0, castK: 0,
        deathK: 0, popK: 1, hideK: 0, walking: 0, anim: '', animLock: 0,
        bob: Math.random() * 6.28, startX: null, startY: null
      };
    }
    return v;
  }
  function initFacing(st, u, v) {
    // vira para o inimigo mais próximo — nasce olhando para a briga
    var best = null, bd = 1e9;
    for (var i = 0; i < st.units.length; i++) {
      var o = st.units[i];
      if (!o.alive || o.side === u.side) continue;
      var d = Math.abs(o.x - u.x) + Math.abs(o.y - u.y);
      if (d < bd) { bd = d; best = o; }
    }
    v.faceTo = best ? Math.atan2(wx(best.x) - wx(u.x), wz(best.y) - wz(u.y)) : (u.side === 'player' ? 0 : Math.PI);
    v.face = v.faceTo;
  }
  function faceTowards(v, gx, gy) {
    var dx = wx(gx) - wx(v.x), dz = wz(gy) - wz(v.y);
    if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) return;
    v.faceTo = Math.atan2(dx, dz);
  }

  function unitElements(u) {
    if (u.elemPair && u.elemPair.length) return u.elemPair.slice(0, 2);
    if (u.elements && u.elements.length) return u.elements.slice(0, 2);
    var D = DATA();
    var e = u.element ||
      (D.monsters && D.monsters[u.defId] && D.monsters[u.defId].element) ||
      (D.pets && D.pets[u.defId] && D.pets[u.defId].element) || 'neutro';
    return [e];
  }

  // AÇÃO por arma + por feitiço: com 76–95 clipes por modelo, feitiços
  // diferentes da mesma classe ganham gestos diferentes (§ pedido do usuário).
  function weaponOf(node) {
    var look = node && node.userData && node.userData.look;
    return (look && look.weapon) || '';
  }
  function meleeActionFor(node, variant) {
    var w = weaponOf(node);
    if (/^2H_/.test(w)) return (variant % 2) ? 'attackSpin' : 'attack2h';
    if (w) return (variant % 2) ? 'attackAlt' : 'attack';
    return 'punch';
  }
  function rangedActionFor(node, variant) {
    var w = weaponOf(node);
    if (/Crossbow|Bow/.test(w)) return 'shoot';
    if (/Staff|Wand|Spellbook/.test(w)) {
      return ['cast', 'castRaise', 'castLong', 'summon'][variant % 4];
    }
    return (variant % 3) === 0 ? 'throw' : 'cast';
  }
  // o gesto é estável por feitiço: o mesmo feitiço sempre faz o mesmo gesto
  function castActionFor(node, melee, spellId) {
    var v = spellId ? (hashStr(String(spellId)) % 97) : 0;
    return melee ? meleeActionFor(node, v) : rangedActionFor(node, v);
  }
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }

  function buildUnitNode(u) {
    if (!M.isReady()) return null;
    var els = unitElements(u);
    var node = M.unit(u.defId, {
      element: els[0], elements: els, boss: !!u.boss, kind: u.kind,
      classId: u.classId || null
    });
    if (!node) return null;
    node.userData.uid = u.uid;

    // sombra de contato (um disco escuro) — ancora a figura no chão mesmo com
    // a sombra projetada fraca em celular
    var sh = new THREE.Mesh(
      M.geo('contact', function () {
        var g = new THREE.CircleGeometry(0.5, 20);
        g.rotateX(-Math.PI / 2);
        return g;
      }),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.30, depthWrite: false })
    );
    sh.position.y = 0.03;
    sh.scale.setScalar(node.userData.radius * 2.1);
    sh.renderOrder = 1;
    node.add(sh);
    node.userData.contact = sh;

    // barra de vida + estados (canvas em sprite: legível de qualquer ângulo)
    var bar = makeBarSprite();
    bar.position.y = node.userData.height + 0.30;
    node.add(bar);
    node.userData.bar = bar;

    // anel de lado (aliado/inimigo) — leitura instantânea do tabuleiro
    var ringMat = new THREE.MeshBasicMaterial({
      color: u.side === 'player' ? 0x6fd8ff : 0xff7a5a,
      transparent: true, opacity: 0.55, depthWrite: false
    });
    var ring = new THREE.Mesh(M.geo('sideRing', function () {
      var g = new THREE.RingGeometry(0.62, 0.78, 28);
      g.rotateX(-Math.PI / 2);
      return g;
    }), ringMat);
    ring.position.y = 0.05;
    ring.renderOrder = 2;
    node.add(ring);
    node.userData.sideRing = ring;

    node.userData.play('idle', { fade: 0 });
    return node;
  }

  function makeBarSprite() {
    var cv = document.createElement('canvas');
    cv.width = 192; cv.height = 84;
    var tex = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    var sp = new THREE.Sprite(mat);
    sp.scale.set(1.25, 0.55, 1);
    sp.renderOrder = 20;
    sp.userData = { cv: cv, tex: tex, sig: '' };
    return sp;
  }

  function statusOf(u) {
    var s = { poison: 0, invisible: 0, root: 0, taunt: 0, mark: 0, shield: 0, reflect: 0, regen: 0 };
    var e = u.effects || [];
    for (var i = 0; i < e.length; i++) {
      var t = e[i].type;
      if (t === 'poison') s.poison++;
      else if (t === 'invisible') s.invisible++;
      else if (t === 'root') s.root++;
      else if (t === 'taunt') s.taunt++;
      else if (t === 'reflect') s.reflect++;
      else if (t === 'regen') s.regen++;
      else if (t === 'mark') s.mark += (e[i].stacks || e[i].value || 1);
    }
    if (u.marks != null) s.mark = u.marks;
    s.shield = u.shield || 0;
    return s;
  }

  function drawBar(sp, u, stt) {
    var sig = u.hp + '/' + u.hpMax + '|' + stt.shield + '|' + stt.poison + stt.root + stt.taunt +
              stt.reflect + stt.regen + stt.invisible + '|' + stt.mark;
    if (sp.userData.sig === sig) return;
    sp.userData.sig = sig;
    var cv = sp.userData.cv, c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);

    // trilho
    var bw = 150, bh = 15, bx = (cv.width - bw) / 2, by = 46;
    c.fillStyle = 'rgba(10,13,18,0.80)';
    roundRect(c, bx - 3, by - 3, bw + 6, bh + 6, 7); c.fill();
    var frac = Math.max(0, Math.min(1, u.hp / Math.max(1, u.hpMax)));
    var col = u.side === 'player' ? '#57d977' : '#e8574a';
    if (frac < 0.34) col = '#ffae3a';
    c.fillStyle = col;
    roundRect(c, bx, by, Math.max(2, bw * frac), bh, 5); c.fill();
    if (stt.shield > 0) {
      var sfrac = Math.min(1, stt.shield / Math.max(1, u.hpMax));
      c.fillStyle = 'rgba(150,215,255,0.92)';
      roundRect(c, bx, by - 5, Math.max(2, bw * sfrac), 5, 2); c.fill();
    }
    c.strokeStyle = 'rgba(255,255,255,0.32)'; c.lineWidth = 1.5;
    roundRect(c, bx, by, bw, bh, 5); c.stroke();

    // ícones de estado (fila acima da barra)
    var icons = [];
    if (stt.poison) icons.push(['#6fd06a', '☣']);
    if (stt.root) icons.push(['#b98a4a', '⚓']);
    if (stt.taunt) icons.push(['#ff6a4a', '!']);
    if (stt.reflect) icons.push(['#9be8ff', '↺']);
    if (stt.regen) icons.push(['#7ef0d4', '+']);
    if (stt.invisible) icons.push(['#c0b8ff', '◌']);
    if (stt.mark > 0) icons.push(['#ff9ad0', String(stt.mark)]);
    var iw = 26, tot = icons.length * iw, ix = (cv.width - tot) / 2;
    c.font = 'bold 19px Verdana, Segoe UI Symbol, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (var i = 0; i < icons.length; i++) {
      var cx = ix + i * iw + iw / 2;
      c.fillStyle = 'rgba(10,13,18,0.82)';
      roundRect(c, cx - 11, 8, 22, 26, 7); c.fill();
      c.strokeStyle = icons[i][0]; c.lineWidth = 1.6;
      roundRect(c, cx - 11, 8, 22, 26, 7); c.stroke();
      c.fillStyle = icons[i][0];
      c.fillText(icons[i][1], cx, 22);
    }
    sp.userData.tex.needsUpdate = true;
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function syncUnits(st) {
    var seen = {};
    var i, u, v, node;
    for (i = 0; i < st.units.length; i++) {
      u = st.units[i];
      if (u.offBoard) continue;
      seen[u.uid] = true;
      v = vis[u.uid];
      if (!v) { v = getVisFor(u.uid, u.x, u.y); initFacing(st, u, v); }
      unitSnap[u.uid] = { x: v.x, y: v.y, defId: u.defId };
      node = unitNodes[u.uid];
      // O nó é guardado por UID, mas a FUSÃO mantém o uid do anfitrião e troca
      // só o `defId` (vira 'fus:a+b'). Reaproveitando o nó, a unidade fundida
      // continuava com o boneco de antes e as marcas da outra classe nunca
      // apareciam — era o relato "ao fundir ele não vem fundido". Quando o
      // defId muda, o modelo é refeito.
      if (node && node.userData && node.userData.defId !== u.defId) {
        if (node.parent) node.parent.remove(node);
        delete unitNodes[u.uid];
        node = null;
      }
      if (!node) {
        node = buildUnitNode(u);
        if (!node) continue;
        unitNodes[u.uid] = node;
        unitsG.add(node);
      }
    }
    for (var uid in unitNodes) {
      if (seen[uid] || fusionHolds(uid)) continue;
      var n = unitNodes[uid];
      if (n.parent) n.parent.remove(n);
      delete unitNodes[uid];
      delete vis[uid];
    }
  }

  // Durante a FUSÃO os dois fundidos já saíram do state (offBoard), mas a cena
  // ainda precisa mostrá-los convergindo: seguramos os nós até a animação acabar.
  function fusionHolds(uid) {
    for (var i = 0; i < animQ.length; i++) {
      var a = animQ[i];
      if (a.kind === 'fusion' && (a.a === uid || a.b === uid)) return true;
    }
    return false;
  }

  function updateUnitNodes(st, dt) {
    // os fundidos segurados pela animação não estão mais em st.units
    for (var h in unitNodes) {
      if (!fusionHolds(h)) continue;
      var hv = vis[h], hn = unitNodes[h];
      if (!hv || !hn) continue;
      hn.position.set(wx(hv.x) + hv.knockX, hv.z, wz(hv.y) + hv.knockZ);
      hn.rotation.y = hv.face + FACE_OFF;
      applyAlpha(hn, Math.max(0, 1 - hv.hideK));
      if (hn.userData.bar) hn.userData.bar.visible = false;
      if (hn.userData.sideRing) hn.userData.sideRing.visible = false;
      if (hn.userData.mixer) hn.userData.mixer.update(dt);
    }
    for (var i = 0; i < st.units.length; i++) {
      var u = st.units[i];
      var node = unitNodes[u.uid];
      var v = vis[u.uid];
      if (!node || !v) continue;
      var ud = node.userData;

      // posição + solavanco
      node.position.set(wx(v.x) + v.knockX, v.z, wz(v.y) + v.knockZ);
      // rotação suave até a direção desejada
      var d = v.faceTo - v.face;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      v.face += d * Math.min(1, dt * 12);
      node.rotation.y = v.face + FACE_OFF;

      // morte: afunda e some
      var alpha = 1;
      if (v.deathK > 0) {
        node.position.y -= v.deathK * 0.9;
        alpha = Math.max(0, 1 - v.deathK);
      }
      if (v.popK < 1) node.scale.setScalar(0.4 + 0.6 * v.popK);
      else node.scale.setScalar(1);
      if (v.hideK > 0) alpha *= (1 - v.hideK);

      var stt = statusOf(u);
      if (stt.invisible) alpha *= 0.30;                 // §4: invisível ~30%
      applyAlpha(node, alpha);

      // flash de dano (o emissivo elemental volta ao valor de base depois)
      var mats = ud.tintMats;
      if (mats) {
        var f = v.flash;
        if (f > 0 || v.__wasFlash) {
          for (var m = 0; m < mats.length; m++) {
            var mm = mats[m];
            if (!mm.emissive) continue;
            if (f > 0) {
              mm.emissiveIntensity = (mm.__baseEmiI || 0.1) + f * 1.7;
              mm.emissive.setRGB(1, 0.52 + 0.42 * (1 - f), 0.42);
            } else {
              mm.emissiveIntensity = mm.__baseEmiI || 0.1;
              mm.emissive.setHex(mm.__baseEmiHex == null ? 0x000000 : mm.__baseEmiHex);
            }
          }
          v.__wasFlash = f > 0;
        }
      }

      // barra + estados
      if (ud.bar) {
        ud.bar.visible = alpha > 0.05 && u.alive;
        if (ud.bar.visible) {
          drawBar(ud.bar, u, stt);
          ud.bar.position.y = ud.height + 0.30 + Math.sin(nowT * 2.2 + v.bob) * 0.03;
        }
      }
      if (ud.sideRing) {
        ud.sideRing.visible = u.alive && alpha > 0.2;
        ud.sideRing.material.opacity = 0.20 + 0.16 * (0.5 + 0.5 * Math.sin(nowT * 2.4 + v.bob));
      }
      if (ud.contact) ud.contact.material.opacity = 0.30 * alpha;

      // ANIMAÇÃO: a fase da unidade manda na ação lógica
      var want, opt = null;
      if (v.deathK > 0) { want = 'die'; opt = { loop: false, fade: 0.12 }; }
      else if (v.animLock > 0) { want = v.anim; }
      else if (v.walking > 0) {
        // LOCOMOÇÃO: o MODELO decide qual clipe responde por "andando" (§
        // Models3D2.locomotion). Pedir 'run' na marra fazia o sapo — que só
        // tem Jump — cair no clipe de parado e deslizar pelo tabuleiro.
        var lm = ud.locomotion ? ud.locomotion() : null;
        want = lm ? lm.action : 'run';
        if (lm && !lm.cycle && lm.dur > 0) {
          // arco único (pulo): um pulo por célula andada
          opt = { timeScale: clamp(lm.dur * MOVE_RATE, 0.7, 2.4) };
        } else {
          opt = { timeScale: 1.12 };
        }
      }
      else if (stt.root) { want = 'blocking'; }
      else if (stt.taunt && u.side === 'enemy') { want = 'taunt'; }
      else want = 'idle';
      if (want && v.anim !== want) { ud.play(want, opt || {}); v.anim = want; }
      if (v.animLock > 0) v.animLock -= dt;
      if (ud.mixer) ud.mixer.update(dt);
      // POSTURA depois da animação: o clipe reescreve a rotação dos ossos a cada
      // quadro, então a cabeça baixa do Bárbaro só fica de pé se for somada AQUI.
      if (ud.postura) { try { ud.postura(); } catch (e) {} }
      // modelos procedurais da v1 têm animação própria por código
      if (ud.procAnimate) {
        ud.procAnimate({
          moving: v.walking > 0 ? 1 : 0, castK: v.castK || 0,
          flash: v.flash, deathK: v.deathK, invis: !!stt.invisible
        }, nowT + v.bob, dt);
      }
    }
  }

  function applyAlpha(node, a) {
    var mats = node.userData.tintMats;
    if (!mats) return;
    var trans = a < 0.995;
    for (var i = 0; i < mats.length; i++) {
      mats[i].transparent = trans;
      mats[i].opacity = a;
      mats[i].depthWrite = a > 0.6;
    }
  }

  // ================================================================= OVERLAYS
  var ovPool = [], ovUsed = 0;
  var ovMatCache = {};
  function ovMat(color, opacity) {
    var k = color + '|' + opacity;
    if (!ovMatCache[k]) {
      ovMatCache[k] = new THREE.MeshBasicMaterial({
        color: col3(color), transparent: true, opacity: opacity,
        depthWrite: false, side: THREE.DoubleSide
      });
    }
    return ovMatCache[k];
  }
  function ovTile(x, y, color, opacity, yOff, scale) {
    var mesh = ovPool[ovUsed];
    if (!mesh) {
      mesh = new THREE.Mesh(M.tileFlatGeo(), ovMat(color, opacity));
      mesh.renderOrder = 3;
      ovPool.push(mesh);
      overlayG.add(mesh);
    }
    ovUsed++;
    mesh.visible = true;
    mesh.material = ovMat(color, opacity);
    mesh.position.set(wx(x), (yOff == null ? 0.09 : yOff), wz(y));
    mesh.scale.setScalar(scale == null ? 0.92 : scale);
    return mesh;
  }
  function overlaySignature(st) {
    var g = game(), en = engine();
    var active = safe(function () { return en && en.activeUnit ? en.activeUnit(st) : null; }, null);
    var hv = g && g.hoverTile;
    var evs = st.tileEventsActive || st.tileEvents || [];
    var pos = '';
    for (var i = 0; i < st.units.length; i++) pos += st.units[i].x + ',' + st.units[i].y + (st.units[i].alive ? '' : 'x') + ';';
    // PP e PA entram na assinatura: sem eles, uma FIXAÇÃO fracassada — que leva
    // todo o PP sem tirar a unidade do lugar — deixava a assinatura IDÊNTICA, e
    // as casas azuis de caminhada continuavam acesas com PP 0. O jogador clicava
    // nelas e nada acontecia. Foi metade do relato "o PP não carrega".
    return [st.phase, st.round, active ? active.uid : '-', g && g.selectedSpellId,
      active ? active.pp + ':' + active.pa : '-',
      hv ? hv.x + ':' + hv.y : '-', mira ? 'M' + mira.x + ':' + mira.y : '-',
      evs.length, R.isBusy() ? 1 : 0, pos,
      g && g.isPlayerTurn ? (g.isPlayerTurn() ? 1 : 0) : 1].join('|');
  }

  function rebuildOverlays(st) {
    ovUsed = 0;
    var g = game(), en = engine();
    var D = DATA();
    if (!st || st.phase !== 'playing') { hideRestOverlay(); return; }
    var active = safe(function () { return en && en.activeUnit ? en.activeUnit(st) : null; }, null);
    if (!active) { hideRestOverlay(); return; }

    var playerTurn = g && g.isPlayerTurn ? g.isPlayerTurn() : true;
    if (!playerTurn || R.isBusy()) { hideRestOverlay(); return; }

    // uma mira de outro turno / outro feitiço não confirma nada: some sozinha
    if (mira && mira.sig !== assinaturaMira()) mira = null;

    var spellId = g && g.selectedSpellId;
    var hv = g && g.hoverTile;

    if (!spellId) {
      var reach = safe(function () { return en.reachable ? en.reachable(st, active.uid) : null; }, null);
      if (reach) {
        for (var i = 0; i < reach.length; i++) {
          var t = reach[i];
          var risky = !!(t.risky || t.risk || t.dodgeRisk || t.locked);
          // células de RISCO DE ESQUIVA em âmbar (§2)
          ovTile(t.x, t.y, risky ? '#ff8a24' : '#28c8ff', risky ? 0.30 : 0.18, 0.09, 0.84);
        }
      }
      if (hv && hv.x >= 0) {
        var path = safe(function () { return en.path ? en.path(st, active.uid, hv.x, hv.y) : null; }, null);
        if (path && path.length) {
          for (var j = 0; j < path.length; j++) {
            ovTile(path[j].x, path[j].y, '#fff2c8', j === path.length - 1 ? 0.66 : 0.34, 0.12, 0.50);
          }
        }
      }
    } else {
      // A MESMA PORTA DO MOTOR: `Engine.spell` resolve feitiço de classe, de item,
      // de pet, de monstro e os GERADOS de fusão. Ler só `DATA.spells` fazia toda
      // fusão cair no cinza de neutro — o mesmo defeito que já corrigimos no HUD
      // e no ícone de feitiço.
      var spell = safe(function () { return en.spell ? en.spell(spellId) : null; }, null) ||
        (D.spells && D.spells[spellId]) || (g && g.selectedSpell) || null;
      var elCol = R.elementColor(spell && spell.element ? spell.element : 'neutro');

      // ALCANCE primeiro, fraco: onde o feitiço CHEGA, mesmo sem ninguém lá.
      // Sem isto, escolher um ataque corpo a corpo sem inimigo ao lado não
      // pintava NADA e parecia que o jogo tinha travado.
      var range = safe(function () { return en.spellRange ? en.spellRange(st, active.uid, spellId) : null; }, null);
      var noAlcance = false;
      if (range) {
        for (var rr = 0; rr < range.length; rr++) {
          ovTile(range[rr].x, range[rr].y, elCol, 0.09, 0.05, 0.92);
          if (hv && range[rr].x === hv.x && range[rr].y === hv.y) noAlcance = true;
        }
      }

      // ALVOS por cima, forte: quem dá para acertar de verdade.
      var targets = safe(function () { return en.castTargets ? en.castTargets(st, active.uid, spellId) : null; }, null);
      var inTargets = false;
      if (targets) {
        for (var k = 0; k < targets.length; k++) {
          ovTile(targets[k].x, targets[k].y, elCol, 0.34, 0.11, 0.80);
          if (hv && targets[k].x === hv.x && targets[k].y === hv.y) inTargets = true;
        }
      }
      // ÁREA DE EFEITO sob o cursor. Antes só aparecia sobre ALVO VÁLIDO, então
      // um feitiço de área mirado no chão vazio não mostrava explosão nenhuma —
      // e é justamente aí que o jogador precisa ver o desenho antes de gastar o
      // PA. Agora basta o cursor estar DENTRO DO ALCANCE.
      if (hv && (inTargets || noAlcance)) {
        var aoe = safe(function () { return en.aoeTiles ? en.aoeTiles(st, spellId, active.x, active.y, hv.x, hv.y) : null; }, null);
        if (aoe && aoe.length) {
          // mais forte quando o tiro sai de verdade; só prévia quando não há alvo
          var forca = inTargets ? 0.42 : 0.26;
          for (var m = 0; m < aoe.length; m++) ovTile(aoe[m].x, aoe[m].y, '#ff5a28', forca, 0.13, 0.90);
        }
      }
    }

    // zona do pet
    for (var pu = 0; pu < st.units.length; pu++) {
      var pet = st.units[pu];
      if (pet.kind !== 'pet' || !pet.alive) continue;
      var ownerUid = pet.ownerUid || pet.owner || pet.summonerUid;
      var owner = ownerUid ? findUnit(ownerUid) : null;
      if (!owner) continue;
      var pd = (D.pets && D.pets[pet.defId] && D.pets[pet.defId].followDistance) || pet.followDistance || 2;
      for (var dy = -pd; dy <= pd; dy++) for (var dx = -pd; dx <= pd; dx++) {
        if (Math.abs(dx) + Math.abs(dy) !== pd) continue;
        var px = owner.x + dx, py = owner.y + dy;
        if (px < 0 || py < 0 || px >= st.grid.w || py >= st.grid.h) continue;
        ovTile(px, py, '#9be0ff', 0.14, 0.07, 0.86);
      }
    }

    // ALVO DA MIRA por último, por cima de tudo: no toque, é ele que diz
    // "estou apontando AQUI — toque de novo e vai". Sem esta marca, a prévia
    // some no meio das casas azuis de caminhada e o jogador não sabe se o
    // primeiro toque pegou.
    if (mira && mira.x >= 0 && mira.y >= 0) {
      ovTile(mira.x, mira.y, '#ffffff', 0.55, 0.155, 0.34);
      ovTile(mira.x, mira.y, '#ffd98a', 0.42, 0.150, 0.96);
    }
    hideRestOverlay();
  }
  function hideRestOverlay() {
    for (var i = ovUsed; i < ovPool.length; i++) ovPool[i].visible = false;
  }

  // anel da unidade ativa — a cada frame, acompanha quem anda
  var activeRing = null;
  function drawActiveRing(active) {
    if (!activeRing) {
      activeRing = new THREE.Mesh(M.geo('activeRing', function () {
        var g = new THREE.RingGeometry(0.72, 0.94, 32);
        g.rotateX(-Math.PI / 2);
        return g;
      }), new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.85, depthWrite: false }));
      activeRing.renderOrder = 4;
      overlayG.add(activeRing);
    }
    if (!active) { activeRing.visible = false; return; }
    var v = vis[active.uid] || { x: active.x, y: active.y };
    activeRing.visible = true;
    activeRing.position.set(wx(v.x), 0.11, wz(v.y));
    activeRing.material.color.setHex(active.side === 'player' ? 0xffd98a : 0xff6a4a);
    activeRing.material.opacity = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(nowT * 4.2));
    activeRing.scale.setScalar(1 + 0.05 * Math.sin(nowT * 4.2));
  }

  // ------------------------------------------------- eventos de terreno (chão)
  // ------------------------------------------------- ARMADILHA NO CHAO
  // O motor guarda `state.traps` desde sempre, mas o renderizador so reagia ao
  // INSTANTE em que a armadilha dispara: o Xama armava e o chao nao mostrava
  // nada. O jogador perdia de vista onde poe os proprios lacos, e o adversario
  // nao tinha o que ler no tabuleiro.
  //
  // Agora a armadilha ARMADA fica no chao ate disparar ou expirar, desenhada
  // como um laco de urso — arco de metal e dentes — na cor do elemento dela.
  var trapNodes = [];
  var trapSig = '';
  var trapGeoArco = null, trapGeoDente = null, trapGeoBase = null;

  function trapElemento(tr) {
    var sp = null;
    try { sp = JOGO.Engine && JOGO.Engine.spell ? JOGO.Engine.spell(tr.trapId) : null; } catch (e) {}
    return (sp && sp.element) || 'neutro';
  }

  /* Um laco de urso: base escura, arco aberto e dentes virados para dentro.
   * Le como armadilha a 40 px porque a silhueta e um ANEL DENTADO, que nao se
   * confunde com as marcas redondas de evento de terreno. */
  function montaArmadilha(el) {
    var cor = col3(R.elementColor(el));
    var g = new THREE.Group();

    if (!trapGeoBase) {
      trapGeoBase = new THREE.CircleGeometry(0.34, 16);
      trapGeoBase.rotateX(-Math.PI / 2);
    }
    var base = new THREE.Mesh(trapGeoBase, new THREE.MeshBasicMaterial({
      color: col3('#0d0f12'), transparent: true, opacity: 0.72, depthWrite: false
    }));
    base.position.y = 0.03;
    base.renderOrder = 6;
    g.add(base);

    if (!trapGeoArco) {
      trapGeoArco = new THREE.TorusGeometry(0.30, 0.045, 6, 18);
      trapGeoArco.rotateX(-Math.PI / 2);
    }
    var arco = new THREE.Mesh(trapGeoArco, new THREE.MeshStandardMaterial({
      color: cor, roughness: 0.55, metalness: 0.25,
      emissive: cor, emissiveIntensity: 0.35
    }));
    arco.position.y = 0.07;
    arco.castShadow = true;
    g.add(arco);

    // os dentes: cones deitados apontando para o centro
    if (!trapGeoDente) trapGeoDente = new THREE.ConeGeometry(0.045, 0.17, 4);
    var N = 8;
    for (var i = 0; i < N; i++) {
      var a = (i / N) * Math.PI * 2;
      var d = new THREE.Mesh(trapGeoDente, new THREE.MeshStandardMaterial({
        color: cor, roughness: 0.5, metalness: 0.3,
        emissive: cor, emissiveIntensity: 0.25
      }));
      d.position.set(Math.cos(a) * 0.30, 0.13, Math.sin(a) * 0.30);
      // deitado para fora e inclinado para dentro: dente de laco, nao espinho
      d.rotation.z = Math.cos(a) * 0.85;
      d.rotation.x = -Math.sin(a) * 0.85;
      d.castShadow = true;
      g.add(d);
    }
    g.userData.arco = arco;
    return g;
  }

  function rebuildTraps(st) {
    var lista = (st && st.traps) || [];
    var sig = '';
    for (var i = 0; i < lista.length; i++) {
      sig += lista[i].x + ',' + lista[i].y + ':' + (lista[i].trapId || '') + ';';
    }
    if (sig === trapSig) return;
    trapSig = sig;
    for (var q = trapNodes.length - 1; q >= 0; q--) {
      var n = trapNodes[q];
      if (n.parent) n.parent.remove(n);
      n.traverse(function (o) { if (o.isMesh && o.material) o.material.dispose(); });
    }
    trapNodes.length = 0;
    for (var t = 0; t < lista.length; t++) {
      var tr = lista[t];
      var node = montaArmadilha(trapElemento(tr));
      var p = R.world(tr.x, tr.y, 0);
      node.position.set(p.x, 0, p.z);
      node.userData.ph = (tr.x * 7 + tr.y * 13) % 10;
      scene.add(node);
      trapNodes.push(node);
    }
  }

  /* Pulsacao lenta: a armadilha respira para o olho achar, sem virar farol. */
  function updateTraps() {
    for (var i = 0; i < trapNodes.length; i++) {
      var n = trapNodes[i];
      var p = 0.5 + 0.5 * Math.sin(nowT * 1.8 + n.userData.ph);
      if (n.userData.arco) n.userData.arco.material.emissiveIntensity = 0.22 + p * 0.42;
      n.rotation.y = nowT * 0.25;
    }
  }

  // ------------------------------------------------- MURO INVOCADO
  // O verbo do Minotauro. O motor ja o guardava em `state.walls` e ja trocava
  // o tipo da celula para 'wall' — mas o tabuleiro so se redesenha quando a
  // CHAVE DA SALA muda, e essa chave amostra uma celula sim, outra nao. Um
  // muro erguido numa casa impar nao mudava chave nenhuma: a classe inteira
  // era invisivel. Redesenhar o tabuleiro por causa de uma casa tambem nao
  // serve — ele foi reduzido a 29 malhas de proposito.
  //
  // Entao o muro invocado e desenhado como coisa PROPRIA, do mesmo jeito que a
  // armadilha: uma laje de pedra na cor do elemento de quem a ergueu, que SOBE
  // do chao quando nasce e AFUNDA quando o turno dela acaba. Sobe e afunda
  // porque muro que aparece e some piscando nao se le como muro — o olho
  // precisa ver a pedra vindo para entender que o caminho fechou.
  var wallNodes = {};        // "x,y" -> malha de pe
  var wallFalling = [];      // as que estao afundando, ainda na cena
  var wallSig = '';
  var wallGeo = null;
  // A pedra tem de ter o PORTE DA PAREDE DA SALA. Escrita com 0,86 de largura e
  // 1,05 de altura num mundo onde a casa mede CELL = 2,0 e a parede sobe a
  // WALL_H = 3,1, ela saía com menos de meia casa de largura e um terço da
  // altura: lia como CAIXOTE largado no chão, não como caminho fechado. O motor
  // trata a célula como obstáculo alto — bloqueia passagem E visão —, então o
  // desenho tem de dizer a mesma coisa que a regra.
  var MURO_LARG = CELL * 0.9;
  var MURO_ALT = WALL_H;
  var MURO_SOBE = 0.42;      // segundos de subida e de descida

  // A CAIXA E PROVISORIA, e de proposito.
  //
  // Entra aqui a arte do escudo quando ela existir: basta o modelo responder
  // pela chave 'muro-escudo' em `Models3D2` que este desenho passa a usa-lo,
  // encaixado no mesmo porte (largura da casa, altura da parede) e tingido com
  // a cor do elemento. Nada mais no arquivo precisa mudar — subida, queda,
  // faixa acesa e limpeza continuam valendo para os dois casos. Enquanto o
  // modelo nao existe, a caixa segura o lugar: ela ja diz "o caminho fechou",
  // que e a informacao que o jogador precisa ler.
  var MURO_MODELO = 'muro-escudo';

  function tingeMuro(no, cor) {
    no.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var m = o.material.clone();
      if (m.color) m.color.copy(cor);
      if (m.emissive) { m.emissive.copy(cor); m.emissiveIntensity = 0.16; }
      o.material = m;
      o.castShadow = true;
      o.receiveShadow = true;
    });
  }

  function corpoDoMuro(cor) {
    try {
      if (M && M.hasModel && M.hasModel(MURO_MODELO)) {
        var cena = M.rawScene(MURO_MODELO);
        if (cena) {
          var no = cena.clone(true);
          tingeMuro(no, cor);
          // encaixa no porte da casa, seja qual for a escala em que veio
          var cx = new THREE.Box3().setFromObject(no);
          var tam = cx.getSize(new THREE.Vector3());
          var k = Math.min(MURO_LARG / Math.max(0.001, tam.x),
                           MURO_ALT / Math.max(0.001, tam.y),
                           MURO_LARG / Math.max(0.001, tam.z));
          if (isFinite(k) && k > 0) no.scale.setScalar(k);
          no.position.y = -cx.min.y * (no.scale.y || 1);
          return no;
        }
      }
    } catch (e) {}
    if (!wallGeo) wallGeo = new THREE.BoxGeometry(MURO_LARG, MURO_ALT, MURO_LARG);
    var pedra = new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({
      color: cor, roughness: 0.85, metalness: 0.05,
      emissive: cor, emissiveIntensity: 0.16
    }));
    pedra.position.y = MURO_ALT / 2;
    pedra.castShadow = true;
    pedra.receiveShadow = true;
    return pedra;
  }

  function montaMuro(el) {
    var cor = col3(R.elementColor(el));
    var g = new THREE.Group();
    var pedra = corpoDoMuro(cor);
    g.add(pedra);

    // Uma faixa acesa na base: diz "isto foi invocado, nao e parede da sala".
    var faixa = new THREE.Mesh(
      new THREE.BoxGeometry(MURO_LARG * 1.08, 0.09, MURO_LARG * 1.08),
      new THREE.MeshBasicMaterial({ color: cor, transparent: true, opacity: 0.9, depthWrite: false })
    );
    faixa.position.y = 0.06;
    faixa.renderOrder = 6;
    g.add(faixa);

    g.userData.pedra = pedra;
    g.userData.faixa = faixa;
    return g;
  }

  function rebuildWalls(st) {
    var lista = (st && st.walls) || [];
    var sig = '';
    for (var i = 0; i < lista.length; i++) {
      sig += lista[i].x + ',' + lista[i].y + ':' + (lista[i].element || '') + ';';
    }
    if (sig === wallSig) return;
    wallSig = sig;

    var vivos = {};
    for (i = 0; i < lista.length; i++) {
      var w = lista[i], k = w.x + ',' + w.y;
      vivos[k] = 1;
      if (wallNodes[k]) continue;
      var node = montaMuro(w.element || 'neutro');
      var p = R.world(w.x, w.y, 0);
      node.position.set(p.x, 0, p.z);
      node.userData.t0 = nowT;        // nasce afundada e sobe
      scene.add(node);
      wallNodes[k] = node;
    }
    // as que sairam da lista comecam a afundar em vez de sumir de uma vez
    for (var k2 in wallNodes) {
      if (vivos[k2]) continue;
      var n = wallNodes[k2];
      n.userData.tFim = nowT;
      wallFalling.push(n);
      delete wallNodes[k2];
    }
  }

  function descartaMuro(n) {
    if (n.parent) n.parent.remove(n);
    n.traverse(function (o) { if (o.isMesh && o.material) o.material.dispose(); });
  }

  function updateWalls() {
    var k;
    for (k in wallNodes) {
      var n = wallNodes[k];
      var t = Math.min(1, (nowT - n.userData.t0) / MURO_SOBE);
      // desacelera no fim: a pedra assenta, nao freia de supetao
      var e = 1 - (1 - t) * (1 - t);
      n.position.y = -MURO_ALT * (1 - e);
      if (n.userData.faixa) n.userData.faixa.material.opacity = 0.55 + 0.35 * Math.sin(nowT * 2.2);
    }
    for (var i = wallFalling.length - 1; i >= 0; i--) {
      var f = wallFalling[i];
      var tf = (nowT - f.userData.tFim) / MURO_SOBE;
      if (tf >= 1) { descartaMuro(f); wallFalling.splice(i, 1); continue; }
      f.position.y = -MURO_ALT * (tf * tf);
    }
  }

  function limpaMuros() {
    for (var k in wallNodes) descartaMuro(wallNodes[k]);
    wallNodes = {};
    for (var i = 0; i < wallFalling.length; i++) descartaMuro(wallFalling[i]);
    wallFalling.length = 0;
    wallSig = '';
  }

  var evNodes = [];
  var EV_COLORS = { buff: '#ffd76b', mystery: '#b98cff', portal: '#58b6f0', drain: '#e0556a', fountain: '#7ef0d4' };
  function rebuildTileEvents(st) {
    var evs = st.tileEventsActive || st.tileEvents || [];
    var sig = '';
    for (var i = 0; i < evs.length; i++) sig += evs[i].x + ',' + evs[i].y + ':' + (evs[i].eventId || evs[i].id) + ';';
    if (sig === evSig) return;
    evSig = sig;
    for (var q = evNodes.length - 1; q >= 0; q--) {
      if (evNodes[q].parent) evNodes[q].parent.remove(evNodes[q]);
    }
    evNodes.length = 0;
    var D = DATA();
    for (var e = 0; e < evs.length; e++) {
      var ev = evs[e];
      if (!ev || ev.x == null) continue;
      var def = (D.tileEvents && D.tileEvents[ev.eventId || ev.id]) || {};
      var kind = def.kind || 'mystery';
      var col = EV_COLORS[kind] || '#ffd76b';
      var grp = new THREE.Group();
      grp.position.set(wx(ev.x), 0, wz(ev.y));

      var disc = new THREE.Mesh(M.tileFlatGeo(), new THREE.MeshBasicMaterial({
        color: col3(col), transparent: true, opacity: 0.30, depthWrite: false
      }));
      disc.position.y = 0.10; disc.scale.setScalar(0.9); disc.renderOrder = 5;
      grp.add(disc);

      var beam = new THREE.Mesh(
        M.geo('evBeam', function () { return new THREE.CylinderGeometry(0.16, 0.30, 1.7, 10, 1, true); }),
        new THREE.MeshBasicMaterial({ color: col3(col), transparent: true, opacity: 0.13,
          depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
      );
      beam.position.y = 0.85; beam.renderOrder = 6;
      grp.add(beam);

      var icon = makeIconSprite(def.icon || ({ buff: '⚡', mystery: '?', portal: '@', drain: '×', fountain: '+' }[kind]), col);
      icon.position.y = 1.15;
      grp.add(icon);

      var lite = new THREE.PointLight(col3(col), 0.6, 5, 2);
      lite.position.y = 0.8;
      grp.add(lite);

      grp.userData = { beam: beam, icon: icon, lite: lite, ph: Math.random() * 6.28 };
      overlayG.add(grp);
      evNodes.push(grp);
    }
  }
  function makeIconSprite(txt, color) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 96;
    var c = cv.getContext('2d');
    c.fillStyle = 'rgba(10,13,18,0.72)';
    roundRect(c, 12, 12, 72, 72, 20); c.fill();
    c.strokeStyle = color; c.lineWidth = 4;
    roundRect(c, 12, 12, 72, 72, 20); c.stroke();
    c.fillStyle = color;
    c.font = 'bold 46px Verdana, Segoe UI Symbol, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(txt), 48, 52);
    var tex = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(0.66, 0.66, 1);
    sp.renderOrder = 21;
    return sp;
  }

  // =================================================================== CLIMA
  var weather = { id: '', rain: null, motes: null, gust: null, tint: null, shakeT: 0, qx: 0, qy: 0 };
  function setWeather(id, instant) {
    if (!id) id = 'calmo';
    if (weather.id === id) return;
    weather.id = id;
    buildWeather();
  }
  R.setWeather = setWeather;

  function weatherPal(id) {
    var D = DATA();
    var def = D.weathers && D.weathers[id];
    var p = (def && def.palette) || {};
    var base = {
      calmo:    { tint: '#d8dee4', a: 0.00, particle: '#6b7684' },
      chuva:    { tint: '#57c8ec', a: 0.30, particle: '#a8e4f5' },
      estiagem: { tint: '#ff8c3a', a: 0.24, particle: '#ffd08a' },
      vendaval: { tint: '#c8b6ff', a: 0.18, particle: '#e0dcff' },
      tremor:   { tint: '#9bd06a', a: 0.20, particle: '#bda06a' }
    }[id] || { tint: '#d8dee4', a: 0, particle: '#6b7684' };
    return { tint: p.tint || base.tint, a: base.a, particle: p.particle || base.particle };
  }

  function buildWeather() {
    while (weatherG.children.length) {
      var c = weatherG.children[0];
      weatherG.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
    weather.rain = weather.motes = weather.gust = null;
    var id = weather.id;
    var pal = weatherPal(id);
    var span = Math.max(gridW, gridH) * CELL * 0.9 + 8;

    if (id === 'chuva') {
      // RISCOS, nao pontos: a chuva precisa se ler de qualquer angulo
      var n = 1500;
      var pos = new Float32Array(n * 6);
      var LEN = 1.5;
      for (var i = 0; i < n; i++) {
        var rx = (Math.random() - 0.5) * span * 2.2;
        var ry = Math.random() * 26;
        var rz = (Math.random() - 0.5) * span * 2.2;
        pos[i * 6] = rx; pos[i * 6 + 1] = ry; pos[i * 6 + 2] = rz;
        pos[i * 6 + 3] = rx + 0.18; pos[i * 6 + 4] = ry + LEN; pos[i * 6 + 5] = rz;
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      var seg = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
        color: col3(pal.particle), transparent: true, opacity: 0.55, depthWrite: false
      }));
      seg.frustumCulled = false;
      weatherG.add(seg);
      // respingos no chao
      var m = 260;
      var sp2 = new Float32Array(m * 3);
      for (var j = 0; j < m; j++) {
        sp2[j * 3] = (Math.random() - 0.5) * span * 2;
        sp2[j * 3 + 1] = 0.05 + Math.random() * 0.4;
        sp2[j * 3 + 2] = (Math.random() - 0.5) * span * 2;
      }
      var gs = new THREE.BufferGeometry();
      gs.setAttribute('position', new THREE.BufferAttribute(sp2, 3));
      var splash = new THREE.Points(gs, new THREE.PointsMaterial({
        color: col3('#dff2ff'), size: 0.14, transparent: true, opacity: 0.5, depthWrite: false
      }));
      splash.frustumCulled = false;
      weatherG.add(splash);
      weather.rain = { seg: seg, splash: splash, span: span, len: LEN };
      lights.hemi.intensity = envOf(curTheme).hemiI * 0.66;
      lights.sun.intensity = envOf(curTheme).sunI * 0.52;
      scene.fog.color.lerp(col3('#3a6a86'), 0.34);
      scene.background.lerp(col3('#24445a'), 0.34);
    } else if (id === 'estiagem') {
      var n2 = 420;
      var p2 = new Float32Array(n2 * 3);
      for (var j = 0; j < n2; j++) {
        p2[j * 3] = (Math.random() - 0.5) * span * 2;
        p2[j * 3 + 1] = Math.random() * 8;
        p2[j * 3 + 2] = (Math.random() - 0.5) * span * 2;
      }
      var g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.BufferAttribute(p2, 3));
      var pts2 = new THREE.Points(g2, new THREE.PointsMaterial({
        color: col3(pal.particle), size: 0.12, transparent: true, opacity: 0.55,
        depthWrite: false, blending: THREE.AdditiveBlending
      }));
      pts2.frustumCulled = false;
      weatherG.add(pts2);
      weather.motes = { pts: pts2, span: span, up: 0.5 };
      lights.sun.color = col3('#ffb347');
      lights.sun.intensity = envOf(curTheme).sunI * 1.18;
      lights.hemi.color = col3('#ffcf8a');
      renderer.toneMappingExposure = 1.12;
      scene.fog.color.lerp(col3('#71401c'), 0.35);
      scene.background.lerp(col3('#7a4a20'), 0.32);
    } else if (id === 'vendaval') {
      var n3 = 620;
      var p3 = new Float32Array(n3 * 6);
      for (var k2 = 0; k2 < n3; k2++) {
        var gx = (Math.random() - 0.5) * span * 2.2;
        var gy = 0.4 + Math.random() * 11;
        var gz = (Math.random() - 0.5) * span * 2.2;
        p3[k2 * 6] = gx; p3[k2 * 6 + 1] = gy; p3[k2 * 6 + 2] = gz;
        p3[k2 * 6 + 3] = gx + 2.6; p3[k2 * 6 + 4] = gy + 0.25; p3[k2 * 6 + 5] = gz + 0.8;
      }
      var g3 = new THREE.BufferGeometry();
      g3.setAttribute('position', new THREE.BufferAttribute(p3, 3));
      var gust = new THREE.LineSegments(g3, new THREE.LineBasicMaterial({
        color: col3(pal.particle), transparent: true, opacity: 0.34, depthWrite: false,
        blending: THREE.AdditiveBlending
      }));
      gust.frustumCulled = false;
      weatherG.add(gust);
      weather.gust = { seg: gust, span: span };
      lights.hemi.color = col3('#cfd8ff');
      scene.fog.color.lerp(col3('#4a4a68'), 0.28);
    } else if (id === 'tremor') {
      var n4 = 520;
      var p4 = new Float32Array(n4 * 3);
      for (var k3 = 0; k3 < n4; k3++) {
        p4[k3 * 3] = (Math.random() - 0.5) * span * 2;
        p4[k3 * 3 + 1] = Math.random() * 3.2;
        p4[k3 * 3 + 2] = (Math.random() - 0.5) * span * 2;
      }
      var g4 = new THREE.BufferGeometry();
      g4.setAttribute('position', new THREE.BufferAttribute(p4, 3));
      var pts4 = new THREE.Points(g4, new THREE.PointsMaterial({
        color: col3(pal.particle), size: 0.15, transparent: true, opacity: 0.50, depthWrite: false
      }));
      pts4.frustumCulled = false;
      weatherG.add(pts4);
      weather.motes = { pts: pts4, span: span, up: 0.12 };
      scene.fog.color.lerp(col3('#5a4a2a'), 0.26);
    } else {
      renderer.toneMappingExposure = 1.0;
      applyThemeLights();
    }
    syncSky();
  }
  function syncSky() {
    if (!skyDome) return;
    skyDome.material.uniforms.uBot.value.copy(scene.fog.color);
    skyDome.material.uniforms.uTop.value.copy(scene.fog.color.clone().multiplyScalar(0.26));
  }
  function applyThemeLights() {
    var E = envOf(curTheme);
    lights.hemi.color = col3(E.sky);
    lights.hemi.groundColor = col3(E.gnd);
    lights.hemi.intensity = E.hemiI;
    lights.sun.color = col3(E.sun);
    lights.sun.intensity = E.sunI;
    var fog = col3(E.fog);
    scene.fog.color.copy(fog);
    scene.background.copy(fog);
    syncSky();
  }

  function updateWeather(dt) {
    var i, arr;
    if (weather.rain) {
      arr = weather.rain.seg.geometry.attributes.position.array;
      var L = weather.rain.len, sp = weather.rain.span;
      for (i = 0; i < arr.length; i += 6) {
        arr[i + 1] -= dt * 34; arr[i + 4] -= dt * 34;
        arr[i] += dt * 3.0;    arr[i + 3] += dt * 3.0;
        if (arr[i + 1] < 0) {
          var nx = (Math.random() - 0.5) * sp * 2.2, nz = (Math.random() - 0.5) * sp * 2.2;
          arr[i] = nx; arr[i + 1] = 24 + Math.random() * 4; arr[i + 2] = nz;
          arr[i + 3] = nx + 0.18; arr[i + 4] = arr[i + 1] + L; arr[i + 5] = nz;
        }
      }
      weather.rain.seg.geometry.attributes.position.needsUpdate = true;
      arr = weather.rain.splash.geometry.attributes.position.array;
      for (i = 1; i < arr.length; i += 3) {
        arr[i] -= dt * 2.2;
        if (arr[i] < 0.03) {
          arr[i] = 0.05 + Math.random() * 0.5;
          arr[i - 1] = (Math.random() - 0.5) * sp * 2;
          arr[i + 1] = (Math.random() - 0.5) * sp * 2;
        }
      }
      weather.rain.splash.geometry.attributes.position.needsUpdate = true;
    }
    if (weather.motes) {
      arr = weather.motes.pts.geometry.attributes.position.array;
      var up = weather.motes.up;
      for (i = 1; i < arr.length; i += 3) {
        arr[i] += dt * up * (0.6 + (i % 7) * 0.12);
        arr[i - 1] += Math.sin(nowT * 0.8 + i) * dt * 0.35;
        if (arr[i] > 9) arr[i] = 0.1;
      }
      weather.motes.pts.geometry.attributes.position.needsUpdate = true;
    }
    if (weather.gust) {
      arr = weather.gust.seg.geometry.attributes.position.array;
      var sg = weather.gust.span;
      for (i = 0; i < arr.length; i += 6) {
        var d = dt * 30;
        arr[i] += d; arr[i + 3] += d;
        arr[i + 2] += d * 0.3; arr[i + 5] += d * 0.3;
        if (arr[i] > sg * 1.2) {
          var back = sg * 2.4;
          arr[i] -= back; arr[i + 3] -= back;
        }
        if (arr[i + 2] > sg * 1.2) {
          var back2 = sg * 2.4;
          arr[i + 2] -= back2; arr[i + 5] -= back2;
        }
      }
      weather.gust.seg.geometry.attributes.position.needsUpdate = true;
    }
    if (weather.id === 'tremor') {
      weather.shakeT += dt;
      var amp = 0.10 + Math.sin(weather.shakeT * 0.7) * 0.06;
      weather.qx = Math.sin(weather.shakeT * 24.0) * amp;
      weather.qy = Math.cos(weather.shakeT * 19.3) * amp * 0.6;
    } else if (weather.id === 'vendaval') {
      weather.shakeT += dt;
      weather.qx = Math.sin(weather.shakeT * 1.7) * 0.05;
      weather.qy = 0;
    } else { weather.qx = 0; weather.qy = 0; }
  }

  // ============================================================ EVENTOS (§9)
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
        nudgeTo(ev.uid);
        break;

      case 'move':
        if (ev.path && ev.path.length) {
          animQ.push({ kind: 'move', uid: ev.uid, path: ev.path.slice(), k: 0, seg: 0, age: 0 });
        }
        break;

      case 'cast':
        u = findUnit(ev.uid);
        var melee = isMelee(ev, u);
        lastHitDelay = melee ? 0.30 : 0.52;
        animQ.push({
          kind: 'cast', uid: ev.uid, tx: ev.x, ty: ev.y, t: 0, spellId: ev.spellId,
          hit: lastHitDelay, dur: lastHitDelay + 0.42, melee: melee, age: 0, started: false
        });
        lastAtk = { x: u ? u.x : ev.x, y: u ? u.y : ev.y, age: 0 };
        break;

      case 'damage':
        (function (uid) {
          delayed.push({ t: animQ.length ? lastHitDelay : 0, fn: function () {
            var vv = getVis(uid); if (!vv) return;
            vv.flash = 1; vv.flashHold = 0.07;
            var nd = unitNodes[uid];
            if (nd && vv.deathK <= 0 && vv.animLock <= 0) {
              nd.userData.play('hit', { loop: false, fade: 0.06, restart: true });
              vv.anim = 'hit'; vv.animLock = 0.34;
            }
            if (lastAtk && lastAtk.age < 2) {
              var dx = wx(vv.x) - wx(lastAtk.x), dz = wz(vv.y) - wz(lastAtk.y);
              var l = Math.hypot(dx, dz) || 1;
              vv.knockX = (dx / l) * 0.24; vv.knockZ = (dz / l) * 0.24;
            } else { vv.knockX = (Math.random() * 2 - 1) * 0.16; vv.knockZ = 0; }
          } });
        })(ev.uid);
        break;

      case 'heal':
      case 'shield':
        v = getVis(ev.uid);
        if (v) v.flash = 0.35;
        break;

      case 'death':
        (function (uid) {
          delayed.push({ t: animQ.length ? 0.28 : 0.05, fn: function () {
            var vv = getVis(uid); if (vv) vv.deathK = 0.0001;
          } });
        })(ev.uid);
        break;

      case 'pushed':
        animQ.push({
          kind: 'slide', uid: ev.uid, fx: ev.fromX, fy: ev.fromY, tx: ev.toX, ty: ev.toY,
          t: 0, dur: 0.10 * (Math.abs(ev.toX - ev.fromX) + Math.abs(ev.toY - ev.fromY)) + 0.10, age: 0
        });
        break;

      case 'teleport':
        animQ.push({ kind: 'teleport', uid: ev.uid, fx: ev.fromX, fy: ev.fromY, tx: ev.toX, ty: ev.toY, t: 0, dur: 0.44, age: 0 });
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
        if (v && ev.amount < 0) { v.flash = 0.55; v.flashHold = 0.04; }
        break;

      case 'dodgeFail':
        v = getVis(ev.uid);
        if (v) { v.knockX = (Math.random() * 2 - 1) * 0.12; v.flash = 0.3; }
        break;

      case 'petAct':
        v = getVis(ev.uid);
        if (v) v.flash = 0.2;
        break;

      case 'tileEvent':
      case 'trapTriggered':
      case 'markStack':
      case 'effectApplied':
        ovSig = ''; evSig = '~init~';
        break;

      case 'battleEnd':
        animQ.length = 0; delayed.length = 0; camFocus = null;
        for (var uid in vis) { vis[uid].hideK = 0; vis[uid].flash = 0; vis[uid].animLock = 0; }
        ovSig = '';
        break;
    }
  };

  function resetAll(st) {
    vis = {}; unitSnap = {};
    animQ.length = 0; delayed.length = 0; camFocus = null;
    lastAtk = null; lastHitDelay = 0.28;
    for (var uid in unitNodes) {
      var n = unitNodes[uid];
      if (n.parent) n.parent.remove(n);
    }
    unitNodes = {};
    boardKey = null; ovSig = ''; evSig = '~init~';
    limpaMuros();
    weather.id = '';
    if (st && st.grid) {
      buildBoard(st);
      boardKey = roomKey(st);
      for (var i = 0; st.units && i < st.units.length; i++) {
        var u = st.units[i];
        var v = getVisFor(u.uid, u.x, u.y);
        initFacing(st, u, v);
      }
    }
    setWeather(weatherId(st), true);
    if (JOGO.FX && JOGO.FX.setAmbient) { try { JOGO.FX.setAmbient(themeOf(st)); } catch (e) {} }
    if (JOGO.FX && JOGO.FX.reset) { try { JOGO.FX.reset(); } catch (e2) {} }
  }

  function nudgeTo(uid) {
    if (!uid || camFocus) return;
    var u = findUnit(uid);
    if (!u) return;
    var v = vis[uid];
    var gx = v ? v.x : u.x, gy = v ? v.y : u.y;
    var p = R.project(gx, gy, 0);
    var m = Math.min(W, H) * 0.18;
    if (p.x > m && p.x < W - m && p.y > m && p.y < H - m) return;
    camFocus = {
      x: wx(gx), z: wz(gy), px0: cam.panX, pz0: cam.panZ, d0: cam.dist,
      t: 0, inD: 0.45, holdD: 0, outD: 0, punch: 0
    };
  }

  // ------------------------------------------------------------------ FUSÃO
  // O momento mais dramático do jogo (§4). Em 3D: os dois convergem, sobem,
  // o clarão engole tudo, e a nova unidade nasce MAIOR, com aura das duas
  // cores elementais e a arma da segunda classe no punho livre.
  function startFusion(ev) {
    var from = ev.from || [];
    var a = from[0], b = from[1];
    var va = (a && vis[a]) || null, vb = (b && vis[b]) || null;
    if (a && !va && unitSnap[a]) va = getVisFor(a, unitSnap[a].x, unitSnap[a].y);
    if (b && !vb && unitSnap[b]) vb = getVisFor(b, unitSnap[b].x, unitSnap[b].y);
    var mid;
    if (va && vb) mid = { x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2 };
    else {
      var nu = findUnit(ev.uid);
      mid = nu ? { x: nu.x, y: nu.y } : { x: va ? va.x : 0, y: va ? va.y : 0 };
    }
    var T = R.FUSION_TIMING;
    animQ.push({
      kind: 'fusion', uid: ev.uid, a: a, b: b, mid: mid, t: 0,
      dur: T.approach + T.flash + T.reveal, age: 0, newReady: false, lit: null,
      elemPair: ev.elemPair || null
    });
    focusOn(mid.x, mid.y, T.approach, T.flash + T.reveal, 0.6, 0.30);
  }

  // ============================================================== ANIMAÇÕES
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
      v.knockX *= Math.pow(0.0002, dt); v.knockZ *= Math.pow(0.0002, dt);
      if (v.deathK > 0 && v.deathK < 1) v.deathK = Math.min(1, v.deathK + dt / 0.9);
      if (v.popK < 1) v.popK = Math.min(1, v.popK + dt / 0.4);
      if (v.walking > 0) v.walking = Math.max(0, v.walking - dt * 6);
    }
    if (!animQ.length) return;
    var a = animQ[0], v2, done = false;
    a.age = (a.age || 0) + dt;
    if (a.age > ANIM_WATCHDOG) done = true;

    switch (done ? 'skip' : a.kind) {
      case 'move':
        v2 = getVis(a.uid);
        if (!v2) { done = true; break; }
        v2.walking = 1;
        a.k += dt * MOVE_RATE;
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
          if (to.x !== from.x || to.y !== from.y) {
            v2.faceTo = Math.atan2(wx(to.x) - wx(from.x), wz(to.y) - wz(from.y));
          }
        }
        break;

      case 'slide':
        v2 = getVis(a.uid);
        if (!v2) { done = true; break; }
        a.t += dt;
        var k = Math.min(a.t / a.dur, 1), e = 1 - (1 - k) * (1 - k);
        v2.x = a.fx + (a.tx - a.fx) * e;
        v2.y = a.fy + (a.ty - a.fy) * e;
        if (k >= 1) { v2.x = a.tx; v2.y = a.ty; done = true; }
        break;

      case 'teleport':
        v2 = getVis(a.uid);
        if (!v2) { done = true; break; }
        a.t += dt;
        var k2 = a.t / a.dur;
        if (k2 < 0.5) { v2.x = a.fx; v2.y = a.fy; v2.hideK = k2 * 2; }
        else { v2.x = a.tx; v2.y = a.ty; v2.hideK = 1 - (k2 - 0.5) * 2; }
        if (k2 >= 1) { v2.hideK = 0; done = true; }
        break;

      case 'cast':
        v2 = getVis(a.uid);
        a.t += dt;
        if (!a.started) {
          a.started = true;
          var nd = unitNodes[a.uid];
          if (nd && v2) {
            var act = castActionFor(nd, a.melee, a.spellId);
            nd.userData.play(act, { loop: false, fade: 0.08, timeScale: 1.1, restart: true });
            v2.anim = act; v2.animLock = a.dur;
            if (a.tx != null) faceTowards(v2, a.tx, a.ty);
          }
        }
        if (v2) v2.castK = Math.sin(Math.min(1, a.t / a.dur) * Math.PI);
        if (v2 && a.melee) {
          // investida curta: avança meia célula no instante do golpe e volta
          var ck = Math.min(a.t / a.dur, 1);
          var lunge = ck < 0.45 ? (ck / 0.45) : Math.max(0, 1 - (ck - 0.45) / 0.55);
          if (a.tx != null) {
            var dxu = wx(a.tx) - wx(v2.x), dzu = wz(a.ty) - wz(v2.y);
            var lu = Math.hypot(dxu, dzu) || 1;
            v2.knockX = (dxu / lu) * lunge * 0.34;
            v2.knockZ = (dzu / lu) * lunge * 0.34;
          }
        }
        if (a.t >= a.dur) { if (v2) { v2.animLock = 0; } done = true; }
        break;

      case 'fusion':
        a.t += dt;
        var T = R.FUSION_TIMING;
        var va = a.a ? vis[a.a] : null, vb = a.b ? vis[a.b] : null;
        var vn = vis[a.uid];
        if (!a.lit) {
          a.lit = new THREE.PointLight(0xffffff, 0, 22, 2);
          a.lit.position.set(wx(a.mid.x), 1.6, wz(a.mid.y));
          fxG.add(a.lit);
        }
        if (a.t < T.approach) {
          var kk = a.t / T.approach;
          if (va) { va.x += (a.mid.x - va.x) * Math.min(1, dt * 8); va.y += (a.mid.y - va.y) * Math.min(1, dt * 8); va.z = Math.sin(kk * Math.PI) * 0.7; }
          if (vb) { vb.x += (a.mid.x - vb.x) * Math.min(1, dt * 8); vb.y += (a.mid.y - vb.y) * Math.min(1, dt * 8); vb.z = Math.sin(kk * Math.PI) * 0.7; }
          if (vn) vn.hideK = 1;
          a.lit.intensity = 1.5 + kk * 7;
        } else if (a.t < T.approach + T.flash) {
          if (va) va.hideK = 1;
          if (vb) vb.hideK = 1;
          if (vn) vn.hideK = 1;
          a.lit.intensity = 26;
        } else {
          if (!a.newReady) {
            a.newReady = true;
            var nu2 = findUnit(a.uid);
            var vv = vn || getVisFor(a.uid, nu2 ? nu2.x : a.mid.x, nu2 ? nu2.y : a.mid.y);
            vv.popK = 0.0001; vv.hideK = 0;
            vn = vv;
            var nnode = unitNodes[a.uid];
            if (nnode) { nnode.userData.play('cheer', { loop: false, fade: 0.05, restart: true }); vv.anim = 'cheer'; vv.animLock = 0.9; }
          }
          if (vn) vn.hideK = 0;
          var kd = (a.t - T.approach - T.flash) / T.reveal;
          a.lit.intensity = Math.max(0, 26 * (1 - kd));
        }
        if (a.t >= a.dur) {
          if (va) va.hideK = 1;
          if (vb) vb.hideK = 1;
          if (vn) vn.hideK = 0;
          if (a.lit && a.lit.parent) a.lit.parent.remove(a.lit);
          done = true;
        }
        break;

      case 'skip':
        v2 = getVis(a.uid);
        if (v2) {
          var u2 = findUnit(a.uid);
          if (u2) { v2.x = u2.x; v2.y = u2.y; }
          v2.z = 0; v2.hideK = 0; v2.animLock = 0; v2.flashHold = 0;
          v2.startX = v2.startY = null;
        }
        if (a.lit && a.lit.parent) a.lit.parent.remove(a.lit);
        done = true;
        break;

      default: done = true;
    }
    if (done) animQ.shift();
  }

  // ============================================================ LAÇO DE RENDER
  R.render = function (dt) {
    if (!ready || !renderer) return;
    dt = (dt == null) ? 0.016 : Math.min(dt, 0.1);
    var ts = (JOGO.FX && JOGO.FX.getTimeScale) ? JOGO.FX.getTimeScale() : 1;
    var dtv = dt * ts;
    nowT += dtv;

    var st = state();
    var sh = (JOGO.FX && JOGO.FX.getShake) ? JOGO.FX.getShake() : { x: 0, y: 0 };
    shake.x = sh.x + (weather.qx || 0) * 20;
    shake.y = sh.y + (weather.qy || 0) * 20;

    if (st && st.grid) {
      // o env-kit decodifica em segundo plano: quando ficar pronto, o tabuleiro
      // provisório (procedural) dá lugar ao cenário de verdade
      if (boardProcedural && kit()) boardKey = null;
      var rk = roomKey(st);
      if (rk !== boardKey) {
        boardKey = rk;
        buildBoard(st);
        ovSig = ''; evSig = '~init~';
        weather.id = '';
        setWeather(weatherId(st), true);
        if (JOGO.FX && JOGO.FX.setAmbient) { try { JOGO.FX.setAmbient(themeOf(st)); } catch (e) {} }
      }
      if (weatherId(st) !== weather.id) setWeather(weatherId(st));
      updateAnims(dtv);
      syncUnits(st);
      applyQuality(Object.keys(unitNodes).length);
      updateUnitNodes(st, dtv);

      var sig = overlaySignature(st);
      if (sig !== ovSig) { ovSig = sig; rebuildOverlays(st); }
      rebuildTileEvents(st);
      rebuildTraps(st);
      rebuildWalls(st);
      var en = engine();
      drawActiveRing(safe(function () { return en && en.activeUnit ? en.activeUnit(st) : null; }, null));
    }

    // pulsação dos eventos de terreno
    for (var e = 0; e < evNodes.length; e++) {
      var g = evNodes[e], ud = g.userData;
      var p = 0.5 + 0.5 * Math.sin(nowT * 2.6 + ud.ph);
      ud.beam.material.opacity = 0.08 + p * 0.10;
      ud.icon.position.y = 1.15 + p * 0.10;
      ud.lite.intensity = 0.4 + p * 0.5;
      g.rotation.y = nowT * 0.6;
    }

    updateTraps();
    updateWalls();
    updateWeather(dtv);
    updateRot(dtv);
    updateFocus(dtv);
    updateCamera();

    if (JOGO.FX && JOGO.FX.update) { try { JOGO.FX.update(dtv, dt); } catch (e3) {} }

    // O contador zera sozinho a cada renderer.render(); com o composer ligado
    // sao varios passes por quadro e a leitura do fim media so o ULTIMO (dava 1).
    // Desligamos o zerar automatico e zeramos nos na entrada do quadro, entao a
    // conta passa a somar a cena INTEIRA mais os passes do bloom.
    renderer.info.autoReset = false;
    renderer.info.reset();
    if (composer) composer.render(dtv);
    else renderer.render(scene, camera);
    lastCalls = renderer.info.render.calls;
    lastTris = renderer.info.render.triangles;
  };

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
    return n && n.userData ? n.userData.height : 1.7;
  };
  R.unitNode = function (uid) { return unitNodes[uid] || null; };
  R.fxLayers = function () {
    return { scene: scene, fx: fxG, decal: decalG, weather: weatherG,
             THREE: THREE, renderer: renderer, camera: camera, renderer3d: R };
  };
  R.scene = function () { return scene; };
  R.camera = function () { return camera; };
  R.threeRenderer = function () { return renderer; };
  R.isReady = function () { return ready && M && M.isReady(); };
  R.quality = function () { return { shadow: shadowSize(), dpr: DPR, units: quality.units }; };
  /* Liga/desliga o brilho (bloom).
   *
   * O UnrealBloomPass e o custo FIXO mais alto deste renderer: ele acrescenta
   * cerca de doze passes de tela cheia em TODO quadro, tenha ou nao algo
   * brilhando na cena. Numa maquina modesta, ou em tela grande, e ele que come
   * o quadro — e o jogador sente como "travado quando tem efeito", porque o
   * efeito soma trabalho em cima de um custo que ja estava alto.
   *
   * Devolve o estado em que ficou. */
  R.setBloom = function (ligado) {
    if (ligado && !composer) buildComposer({ bloom: true });
    else if (!ligado && composer) {
      try { composer.renderTarget1 && composer.renderTarget1.dispose(); } catch (e) {}
      try { composer.renderTarget2 && composer.renderTarget2.dispose(); } catch (e) {}
      composer = null; bloomPass = null;
    }
    return !!composer;
  };
  R.hasBloom = function () { return !!composer; };

  R.stats = function () {
    return { units: Object.keys(unitNodes).length, anims: animQ.length,
             models: M ? M.modelKeys().length : 0, clips: M ? M.clips().length : 0,
             // com o composer ligado, o ultimo passe zera o contador e estes dois
             // saiam sempre como 1; guardamos a leitura do fim do quadro
             calls: lastCalls, tris: lastTris,
             bloom: !!composer,
             texturas: renderer ? renderer.info.memory.textures : 0,
             geometrias: renderer ? renderer.info.memory.geometries : 0,
             programas: renderer && renderer.info.programs ? renderer.info.programs.length : 0 };
  };

  JOGO.Renderer = R;
  JOGO.Renderer3D2 = R;
})();
