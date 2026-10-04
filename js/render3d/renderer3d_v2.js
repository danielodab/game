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
  /* LARGURA DA PEÇA DE MURO — uma casa e MEIA, não uma.
   *
   * Com exatamente uma casa, peça nenhuma encostava na seguinte e um trecho de
   * muro lia como CERCA DE ESTACAS: lascas verticais com vão entre elas. Eu
   * tinha travado em uma casa argumentando que "o muro tem de dizer qual casa
   * bloqueia" — e confundi o que ele precisa COMUNICAR com o que ele precisa
   * MEDIR. A casa bloqueada já é dita pelo tabuleiro: o realce, o caminho que a
   * unidade não percorre, a mira que para ali.
   *
   * Meia casa de sobra faz cada peça cobrir 1,00 m da vizinha, e a fileira
   * fecha. E como a ALTURA é fixa em WALL_H, alargar REDUZ o esticão vertical
   * em vez de aumentá-lo: de 2,25–3,48× para 1,50–2,32× nos quatro módulos.
   *
   * Por que não 1,7 casa, que distorceria ainda menos: o balanço numa peça
   * isolada passaria de 0,70 m e cobriria parte da casa vizinha — aí o muro
   * mentiria sobre onde está, que é o problema que eu queria evitar no começo. */
  var LARG_MURO = CELL * 1.5;
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
    heart:    { fog: '#332a52', sky: '#b49ce8', gnd: '#2a2044', sun: '#ffe6b8', sunI: 1.08, hemiI: 0.84, rim: '#ffd166' },
    /* 14/09 (dono: "o duelo deve ocorrer no mapa da praça"): a luz de DIA da praça 3D
     * (hub3d montaCena: céu 0xcfe8d8, sol 0xffe9c4). A névoa é o verde-acinzentado da
     * grama longe — a do jardim (#3d5c30) deixava a praça com cara de estufa. */
    praca:    { fog: '#56684c', sky: '#cfe8d8', gnd: '#2e3a30', sun: '#ffe9c4', sunI: 1.10, hemiI: 0.88, rim: '#fff0c8' },
    /* 15/09 (a guerra de guilda 2×2 "na sede de guild"): o SALÃO É DE DENTRO. Sem céu — a
     * névoa e o fundo são o breu quente de um salão de pedra, e o que sobra de cena longe
     * some nele. O "sol" vira a luz alta e amarelada dos lustres (ainda projeta a sombra
     * que assenta as peças), o hemisférico tem o alto cor de chama e o baixo de madeira
     * escura, e o contraluz é dourado: é ele que recorta o herói contra o chão de tábuas,
     * que é da mesma família de cor das peles e das armaduras de couro.
     * 15/09 (foto): com sol 1,0 e hemisfério 0,8 cor de chama o salão saía de DIA e laranja,
     * a lareira não fazia poça de luz e o herói sumia no chão. Luz geral mais baixa e menos
     * saturada; quem esquenta a cena é a lareira. */
    sede:     { fog: '#1a120c', sky: '#cfb08e', gnd: '#2a1a10', sun: '#ffe4c4', sunI: 0.74, hemiI: 0.62, rim: '#ffc070' }
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
    panX: 0, panZ: 0,
    // O JOGADOR ASSUMIU A CAMERA? Ligado no primeiro deslocamento, giro,
    // inclinacao ou zoom feito por ele. Enquanto estiver ligado, `fitCamera`
    // atualiza o que depende da sala (distancia minima/maxima, pivo, nevoa) mas
    // NAO mexe no enquadramento — senao cada reconstrucao de tabuleiro desfaria
    // o que ele acabou de fazer. `ultimaSala` desliga o sinalizador na troca de
    // sala, onde reenquadrar e ajuda e nao roubo.
    manual: false, ultimaSala: null,
    // CADEADO: trava a ENTRADA, nao o enquadramento. Tocar numa casa continua
    // funcionando (isso e jogar) e a troca de sala continua reenquadrando
    // (senao o jogador olharia para o vazio ao lado do tabuleiro novo).
    // Fechado, arrastar e girar a roda nao fazem nada.
    travada: false
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
  /* 11/09 — A PERSPECTIVA DE TELA (multijogador): 'meu' | 'aliado' | 'inimigo'.
   * No duelo pela Rede quem aceitou é o lado 'enemy' do estado (igual nos dois
   * motores); é o Game que diz de quem é cada unidade. Sem Game.ladoDaTela, a
   * regra de sempre (o lado 'player' é o meu). */
  function ladoTela(u) {
    var g = game();
    try { if (g && g.ladoDaTela) return g.ladoDaTela(u); } catch (e) {}
    return (u && u.side === 'player') ? 'meu' : 'inimigo';
  }
  /* 22/09 — o invisível do OUTRO lado some 100% desta tela (corpo, barra, anel,
   * sombra, anel da vez, câmera), e a armadilha só aparece para o lado dela.
   * Quem decide é o Game (a régua do lado da tela); sem Game, o 'player' é o
   * meu, como em ladoTela. */
  function ocultoTela(u) {
    var g = game();
    try { if (g && g.ocultoNaTela) return !!g.ocultoNaTela(u); } catch (e) {}
    return false;
  }
  function veArmadilha(tr) {
    var g = game();
    try { if (g && g.veArmadilha) return !!g.veArmadilha(tr); } catch (e) {}
    return !!tr && (tr.side == null || tr.side === 'player');
  }
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
    // MURO INVOCADO NAO E PAREDE DA SALA.
    //
    // Quando o Minotauro crava o escudo, o engine poe `type: 'wall'` na casa e
    // marca `invocado` para dizer "isto nao e alvenaria". O desenho ignorava a
    // marca e plantava uma peca de cenario ali; como o escudo e desenhado POR
    // FORA do tabuleiro, ao afundar sobrava a pedra — e o Daniel via o escudo
    // "virar muro".
    //
    // Para efeito de DESENHO a casa continua sendo o que ela e por baixo. As
    // sete chamadas de `tileKind` aqui sao todas de desenho (silhueta, gramatica
    // de parede, montagem, `roomKey`); regra de jogo le `cel.type` no engine e
    // nao passa por aqui. De quebra `roomKey` para de mudar quando um muro sobe,
    // e o tabuleiro inteiro deixa de ser reconstruido a cada escudo.
    if (t.invocado) return t.deco ? 'deco' : 'floor';
    // 02/10: o CHÃO RACHADO do Poço que desabou é buraco para a regra, mas o
    // desenho segue o de antes e o poço preto vem por fora (rebuildPerigos) —
    // senão a `roomKey` mudava e o cenário inteiro era refeito no meio da luta
    if (t.desabou) return 'floor';
    var ty = t.type || t.kind || 'floor';
    if (ty === 'wall' || ty === 'high' || ty === 'obstacle') return 'high';
    if (ty === 'cover' || ty === 'low' || ty === 'half') return 'low';
    if (ty === 'hole' || ty === 'void' || ty === 'empty' || ty === 'pit') return 'hole';
    if (t.deco) return 'deco';
    return 'floor';
  }
  /* 03/10 — AS CASAS DE MECÂNICA DO SANTUÁRIO SÃO CHÃO PARA O DESENHO. O braseiro, o respiro,
   * a bica, o cata-vento, o altar e o pilar vivo ocupam casas que para a REGRA são mureta ou
   * parede — mas quem as desenha é o santuario3d.js (a peça certa, que acende, gira, sobe e
   * desce). Se o montador as visse como '#' e '=', poria um muro de cenário em cima do pilar
   * que sobe e desce e uma mureta qualquer no lugar do braseiro, e a chave da sala mudaria a
   * cada troca de pilar (o tabuleiro inteiro refeito a cada duas rodadas). Como no muro
   * invocado e no chão que desabou: `gridTile` só serve ao desenho, a regra lê o estado. */
  var PISO_DE_MECANICA = { type: 'floor', deco: false };
  function gridTile(st, x, y) {
    if (!st || !st.grid || !st.grid.tiles) return null;
    if (y < 0 || x < 0 || y >= st.grid.h || x >= st.grid.w) return null;
    var row = st.grid.tiles[y];
    if (!row) return null;
    if (st.santuario && JOGO.Santuario3D) {
      var mec = JOGO.Santuario3D.casas(st);
      if (mec && mec.mapa[y * mec.w + x]) return PISO_DE_MECANICA;
    }
    return typeof row === 'string' ? row.charAt(x) : row[x];
  }
  function dungeonOf(st) {
    var D = DATA();
    if (!st) return null;
    var i;
    for (i = 0; D.dungeons && i < D.dungeons.length; i++) if (D.dungeons[i].id === st.dungeonId) return D.dungeons[i];
    // 14/09: o mapa de luta que não é calabouço (js/core/data/arenas.js — a praça). Sem
    // isto o duelo na praça caía no tema do jardim e na paleta de reserva.
    for (i = 0; D.arenas && i < D.arenas.length; i++) if (D.arenas[i] && D.arenas[i].id === st.dungeonId) return D.arenas[i];
    // 03/10: os calabouços especiais (js/core/data/santuario.js — o Santuário dos Elementos)
    for (i = 0; D.especiais && i < D.especiais.length; i++) if (D.especiais[i] && D.especiais[i].id === st.dungeonId) return D.especiais[i];
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

  /* 03/10 — O AMBIENTE DA SALA PODE SER MAIS FINO QUE O DO TEMA. O Santuário dos Elementos é um
   * tema só ('santuario') com cinco salas, e uma delas — a Câmara Apagada — é ESCURA por regra:
   * a luz geral dela não pode ser a das outras quatro. Quem sabe disso é o santuario3d.js, que
   * declara o ambiente dele (`R.poeAmbiente`) e diz qual vale em cada sala. Sem resposta, vale o
   * do tema, como sempre. `soSeFalta`: não troca o ambiente que a tabela já tem. */
  R.poeAmbiente = function (nome, env, soSeFalta) {
    if (!nome || !env || (soSeFalta && THEME_ENV[nome])) return;
    THEME_ENV[nome] = env;
  };
  function ambienteDaSala(st, theme) {
    var S3 = JOGO.Santuario3D, a = null;
    try { a = (S3 && S3.ambiente && st && st.santuario) ? S3.ambiente(st, theme) : null; } catch (e) { a = null; }
    return (a && THEME_ENV[a]) ? a : theme;
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
    heart:    ['chest', 'crates', 'barrel'],
    praca:    ['crates', 'barrel', 'chest'],     // 14/09: só vale para casa baixa SEM peça
    sede:     ['chest', 'crates', 'barrel']      // 15/09: idem, no salão
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
  function pecaUsuario(theme, papel, seed, alvoAlt, teto) {
    var cat = JOGO.CENARIO && JOGO.CENARIO[theme];
    var lista = cat && cat[papel];
    if (!lista || !lista.length || !M || !M.rawScene) return null;
    var chave = lista[seed % lista.length];
    var cena = null;
    try { cena = M.rawScene(chave); } catch (e) { return null; }
    if (!cena) return null;
    var no = cena.clone(true);
    no.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    if (alvoAlt) fitHeight(no, alvoAlt, teto);

    // ASSENTAR NO CHÃO, AQUI E NÃO NA EXPORTAÇÃO.
    //
    // O separador tentava pôr a base em y=0 mexendo nos vértices, e errou: media
    // a caixa em coordenadas de MUNDO e corrigia em coordenadas LOCAIS. Com o
    // objeto rotacionado — e o importador de glTF rotaciona — os dois espaços não
    // batem, e o deslocamento saía no eixo errado. O resultado na tela foi o
    // Daniel ver as peças ENTERRADAS: as altas ainda apareciam pela metade, e as
    // divisórias, que são baixas, sumiam inteiras dentro do piso.
    //
    // Medir depois de montado e empurrar o nó para cima resolve para qualquer
    // arquivo, venha ele centrado ou não, e não obriga a reexportar nada. O nó
    // vai dentro de um grupo para que quem chama continue posicionando pelo pé.
    var berco = new THREE.Group();
    berco.add(no);
    no.updateMatrixWorld(true);
    var cxb = new THREE.Box3().setFromObject(no);
    if (isFinite(cxb.min.y)) no.position.y -= cxb.min.y;

    // E CENTRAR NA HORIZONTAL, pela mesma razão.
    //
    // O separador também errava aqui, e por um motivo só: o importador de glTF
    // do Blender converte Y-para-cima em Z-PARA-CIMA, e o script supunha Y.
    // Com os eixos trocados ele centrava a peça no plano errado — as quinze
    // primeiras saíram com o centro deslocado em até 0,95 m numa casa de 2,0 m,
    // ou seja, quase encostando na casa vizinha.
    //
    // Assentar a altura já se fazia aqui; centrar em X/Z é a metade que
    // faltava. Feito na montagem, vale para todo arquivo — os que já estão no
    // jogo e os que ainda vão chegar — sem depender de o exportador ter
    // acertado.
    var cx2 = (cxb.min.x + cxb.max.x) / 2;
    var cz2 = (cxb.min.z + cxb.max.z) / 2;
    if (isFinite(cx2)) no.position.x -= cx2;
    if (isFinite(cz2)) no.position.z -= cz2;
    // a chave fica anotada para o TESTE poder varrer a cena montada e contar
    // quantas vezes cada peça entrou — é como se cobra "o marco é ÚNICO".
    berco.userData.chave = chave;
    berco.userData.papel = papel;
    return berco;
  }

  // MURO ALTO — uma peca so, aumentada ate a altura cheia.
  //
  // Os modulos de muro do Daniel sao 2x mais largos que altos (razao 1,45 a
  // 2,25): proporcao de MURETA. Isso deixa exatamente tres saidas para chegar
  // aos 3,10 m, e ja tentei duas:
  //
  //   1. ESCALA UNIFORME ate a altura -> a peca fica com 4,5 a 7,0 m de
  //      largura. Tres casas de largura para tapar uma, e o muro deixa de
  //      dizer qual casa bloqueia.
  //   2. LIMITAR A LARGURA e deixar a altura cair junto -> foi o codigo antigo.
  //      Como as quatro razoes diferem, o mesmo teto devolvia alturas de 1,78 a
  //      2,76 m, e na ponta de um trecho o teto caia pela metade. Foi o que o
  //      Daniel viu como "um do tamanho de um vaso".
  //   3. EMPILHAR FIADAS -> tentei, e ele reprovou de olho: "voce colocou muro
  //      em cima do outro". Dava para contar as tres, com o corrimao repetindo
  //      na altura. Repeticao denuncia o truque.
  //
  // Sobra ESTICAR, que e o que ele pediu ("voce deve aumentar o seu tamanho").
  // A escala horizontal poe a peca na largura de UMA CASA — regra do tabuleiro,
  // inegociavel, porque o muro tem de dizer qual casa bloqueia — e a vertical
  // sobe ate a altura cheia. O esticao fica em 2,2x a 3,1x conforme o modulo.
  //
  // Num muro com PILASTRA o esticao ate ajuda: pilastra esticada vira coluna,
  // que e o que pilastra e. Quem sofre e o corrimao horizontal, que engrossa.
  //
  // Para muro de peca unica SEM esticao o modulo precisa nascer com razao perto
  // de 0,65 — 2 m de largo por 3 m de alto. O pilar do Daniel ja e assim (0,69),
  // e por isso o pilar nunca precisou de nada disto.
  function muroDaCasa(theme, papel, seed, alturaAlvo, largura) {
    var cat = JOGO.CENARIO && JOGO.CENARIO[theme];
    var lista = cat && cat[papel];
    // `M` so e preenchido em `R.init`, e esta funcao nao precisa do renderizador
    // de pe — so do registro de modelos. Resolver aqui a deixa utilizavel por
    // quem mede sem montar uma cena inteira.
    var mods = M || JOGO.Models3D2;
    if (!lista || !lista.length || !mods || !mods.rawScene) return null;
    var chave = lista[seed % lista.length];
    var cena = null;
    try { cena = mods.rawScene(chave); } catch (e) { return null; }
    if (!cena) return null;

    var no = cena.clone(true);
    no.updateMatrixWorld(true);
    var cx = new THREE.Box3().setFromObject(no);
    var larg = Math.max(cx.max.x - cx.min.x, cx.max.z - cx.min.z);
    var alt = cx.max.y - cx.min.y;
    if (!isFinite(larg) || larg < 0.01 || !isFinite(alt) || alt < 0.01) return null;

    var kh = largura / larg;          // horizontal: uma casa
    var kv = alturaAlvo / alt;        // vertical: a altura cheia
    // O PILAR NUNCA ENGORDA ALÉM DA ARTE. A largura de uma casa serve ao
    // MURO, que precisa fechar a fileira; o pilar do jardim tem razão 0,69 e
    // a conta dava quase uniforme por sorte. O pilar da Cisterna tem razão
    // 0,32 — esticado a uma casa ele dobraria de gordura e viraria bloco, e
    // pilar existe para NÃO ser bloco. `kh ≤ kv` mantém a proporção: o vão
    // que sobra na casa é coberto pelos muros vizinhos, que passam meia casa
    // para cada lado (LARG_MURO). No jardim o teto não chega a agir.
    if (papel === 'pilar') kh = Math.min(kh, kv);
    // O MURO COM PILARES NAS PONTAS mente na caixa: no módulo da Cisterna o
    // pilar toca 100% da altura e o CORPO fica em 52% — normalizado pela caixa
    // a 3,10 m, o corpo sai a 1,6 m e um herói de 2,05 vê por cima do muro que
    // a regra diz bloquear visão. Com `alto_corpo: 'auto'` no catálogo, o alvo
    // passa a ser o CORPO da peça — medido por ela mesma, porque a fração muda
    // de módulo para módulo (o inteiro tem corpo a 52%, a brecha a 88%) — com
    // teto de 1,7× a altura para os pilares não virarem agulha. O jardim não
    // declara nada e nada muda lá.
    var frCorpo = 1;
    if (papel === 'alto' && cat && cat.alto_corpo === 'auto') {
      var fr = fracaoCorpo(chave, no);
      if (fr > 0.3 && fr < 0.97) {
        frCorpo = fr;
        kv = Math.min(alturaAlvo / (alt * fr), (alturaAlvo * 1.7) / alt);
      }
    }
    no.scale.set(kh, kv, kh);
    no.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    // ASSENTAR E CENTRAR depois de escalado. O importador de glTF nao garante
    // peca centrada nem com a base em zero, e supor isso ja enterrou peca antes.
    var berco = new THREE.Group();
    berco.add(no);
    no.updateMatrixWorld(true);
    var cb = new THREE.Box3().setFromObject(no);
    if (isFinite(cb.min.y)) no.position.y -= cb.min.y;
    var mx = (cb.min.x + cb.max.x) / 2, mz = (cb.min.z + cb.max.z) / 2;
    if (isFinite(mx)) no.position.x -= mx;
    if (isFinite(mz)) no.position.z -= mz;
    berco.userData.altura = alturaAlvo;
    berco.userData.estica = kv / kh;   // o quanto foi esticado, para o teste ver
    berco.userData.chave = chave;
    berco.userData.papel = papel;
    berco.userData.caixa = alt * kv;          // a caixa REAL depois do esticão
    berco.userData.corpo = alt * kv * frCorpo; // onde o corpo do muro chega
    return berco;
  }

  // A FRAÇÃO DO CORPO de um módulo de muro: mediana das alturas máximas por
  // coluna ao longo do maior eixo horizontal. Pilar de ponta é minoria de
  // colunas, então a mediana devolve o corpo; num módulo uniforme (jardim) ela
  // encosta em 1,0 e a normalização pelo corpo vira a normalização de sempre.
  // Medido UMA vez por chave — varrer 15 mil vértices toda montagem custaria.
  var fracaoCache = {};
  function fracaoCorpo(chave, no) {
    if (fracaoCache[chave] != null) return fracaoCache[chave];
    no.updateMatrixWorld(true);
    var bb = new THREE.Box3().setFromObject(no);
    var alt = bb.max.y - bb.min.y;
    var dx = bb.max.x - bb.min.x, dz = bb.max.z - bb.min.z;
    var eixoX = dx >= dz;
    var ini = eixoX ? bb.min.x : bb.min.z;
    var comp = Math.max(eixoX ? dx : dz, 1e-6);
    var NB = 40, topo = new Array(NB), v = new THREE.Vector3();
    no.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      var pos = o.geometry.attributes.position;
      for (var i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i); o.localToWorld(v);
        var c = eixoX ? v.x : v.z;
        var b = Math.min(NB - 1, Math.max(0, Math.floor((c - ini) / comp * NB)));
        var y = v.y - bb.min.y;
        if (topo[b] == null || y > topo[b]) topo[b] = y;
      }
    });
    var cheios = [];
    for (var b2 = 0; b2 < NB; b2++) if (topo[b2] != null) cheios.push(topo[b2]);
    cheios.sort(function (a, b3) { return a - b3; });
    var fr = (cheios.length && alt > 0.01)
      ? cheios[Math.floor(cheios.length / 2)] / alt : 1;
    fracaoCache[chave] = fr;
    return fr;
  }

  // Exposto para o teste MEDIR o muro, e nao so conferir que a funcao existe.
  // A regra que interessa — "todos da mesma altura e altos" — so se verifica
  // com regua, entao a regua precisa alcancar a peca.
  R.muroDaCasa = muroDaCasa;
  /* Exposto para o teste conferir o DESPACHO, e nao so que os seis modelos
   * existem. Sao perguntas diferentes: um escudo pode estar carregado e mesmo
   * assim nunca ser escolhido — a tabela erra, o `defId` nao chega, ou o
   * `hasModel` reprova —, e nesse caso o jogador ve o escudo padrao sem que
   * nada acuse. */
  R.modeloDoMuro = modeloDoMuro;
  R.LARG_MURO = LARG_MURO;

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
    if (compX >= compZ) {
      return { semente: hashXY(x0, y), eixo: 'x', comp: compX, i: x - x0 };
    }
    return { semente: hashXY(x, y0), eixo: 'z', comp: compZ, i: y - y0 };
  }

  // ESTA CASA LEVA O SOTAQUE?
  //
  // Um enfeite pontual no meio de um muro corrido dá charme; espalhado, polui.
  // Daí as três amarras: no máximo um por fileira, só em fileira de 3 ou mais,
  // e nunca na ponta — enfeite na ponta faz o jogador ler que a barreira acabou
  // ali, e ele tenta passar por onde não passa.
  function ehSotaque(fila) {
    if (fila.comp < 3) return false;
    var miolo = fila.comp - 2;                 // as casas que não são ponta
    return fila.i === 1 + (fila.semente % miolo);
  }

  // ======================================================= A PRAÇA TÁTICA (14/09)
  //
  // Dono: "o desafio é apenas um duelo simples, isso acontece em um mapa na praça mesmo —
  // o mapa da praça tático, com a árvore central, os portais e barracas como obstáculos".
  //
  // O mapa em grade mora em js/core/data/arenas.js, com a mesma legenda de um calabouço,
  // e traz `pecas` dizendo o que cada bloco É. Aqui cada peça veste com a arte da praça
  // 3D (models-praca: praca_arvore, praca_arena…) NO LUGAR do muro de calabouço, e o chão
  // é o da praça: lajotas cinza no jogável e grama baixa no '~'. Sala sem `pecas` não
  // passa por nada disto.
  //
  // A REGRA DO TABULEIRO continua mandando na arte, e não o contrário: o que bloqueia
  // visão ('#') tem de PARECER alto e o que é cobertura baixa ('=') tem de parecer baixo.
  // Por isso as obras entram na PEGADA delas (a largura da pegada manda) e ganham um piso
  // de altura — a Arena de 4×8 m, escalada só pela largura, sairia com 1,6 m, e um bloco
  // que corta a linha de visão não pode ser mais baixo que um herói. As barracas, que na
  // praça têm 6 m de toldo, NÃO vestem a obra: achatada a 0,9 m ela vira um tapete
  // listrado. Viram o que uma barraca tem na altura do joelho — a bancada da forja, o
  // balcão da sorte, os caixotes do mercadinho.
  var OBRA_PRACA = {
    /* A ÁRVORE: 3×3 casas (6 m) com a copa podendo passar 25% da pegada (ela fica
     * acima da cabeça de todo mundo). A ALTURA é a conta da câmera padrão (tilt 0,98,
     * dist 22): a sombra de visada de uma coisa de altura h cobre h·tan(0,98) ≈ 1,5·h
     * atrás dela. Com 17 m, como na praça, a árvore apagaria a metade norte do mapa;
     * com 6,4 ela esconde ~4,8 m (duas casas e pouco) — alta ao lado do muro de 3,1, e o
     * tabuleiro atrás dela continua na tela. A prova mede as casas escondidas.
     * 15/09 (foto): a arte é mais larga que alta (altura = 54% da largura), e a copa
     * presa a 7,5 m deixava a árvore com 4 m — pouco acima do muro. O piso de 6 m (com
     * esticão de no máximo 1,6×) a devolve ao porte de marco. */
    arvore: { chave: 'praca_arvore', sobra: 1.25, altMin: 6.0, altMax: 6.4, estMax: 1.6, rot: 2.4 },
    // a Arena e a Sede (2×4): a pegada manda na largura; o piso é a parede alta
    arena:  { chave: 'praca_arena', sobra: 1.08, altMin: WALL_H, altMax: WALL_H * 1.45, estMax: 2.4 },
    sede:   { chave: 'praca_sede',  sobra: 1.08, altMin: WALL_H, altMax: WALL_H * 1.45, estMax: 2.4 },
    banco:  { chave: 'praca_banco', sobra: 1.08, altMin: WALL_H, altMax: WALL_H * 1.35, estMax: 2.4 },
    /* o Poço é baixo e largo (altura = 46% da largura): numa casa ele teria 0,9 m. A
     * boca passa 20% da casa e a armação estica até 85% do muro — lê como poço com
     * telhado, e não como balde */
    poco:   { chave: 'praca_poco',  sobra: 1.2,  altMin: WALL_H * 0.85, altMax: WALL_H * 1.2, estMax: 2.6 }
  };
  /* SÓ AS PEÇAS QUE ESTE TABULEIRO SABE VESTIR tomam casa. Um mapa com `pecas` de outro
   * papel (15/09: o Salão da Sede, arenas.js 'sede' — parede_salao, trono, pilar…) segue
   * com o muro de sempre nessas casas; sem este filtro a peça desconhecida apagava o muro
   * e deixava a casa alta invisível. */
  var PAPEIS_PRACA = { arvore: 1, arena: 1, sede: 1, banco: 1, poco: 1, portal: 1, portal_mureta: 1,
                       portal_campo: 1,   // 19/09: o portão do Campo de PvP, na borda oeste
                       banco_praca: 1, raiz: 1, forja: 1, loteria: 1, mercado: 1 };
  /* 15/09: cada tema tem a SUA tabela de papéis (o Salão da Sede ganhou a dele, mais
   * abaixo). Tema sem tabela cai na da praça, que era a regra de antes. */
  function pecasDaSala(st, theme) {
    var dg = dungeonOf(st);
    var room = dg && dg.rooms && dg.rooms[st.roomIndex];
    var papeis = PAPEIS_POR_TEMA[theme] || PAPEIS_PRACA;
    var lista = (room && Array.isArray(room.pecas))
      ? room.pecas.filter(function (pc) { return pc && papeis[pc.papel] === 1; }) : [];
    return lista.length ? lista : null;
  }
  // um material por chave dentro da montagem: o mergeStatic funde por material (uuid),
  // então seis bancos de pedra viram UMA chamada de desenho
  function pracaMat(cache, chave, cor, extra) {
    if (cache[chave]) return cache[chave];
    var o = { color: col3(cor), roughness: 0.92, metalness: 0 };
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) o[k] = extra[k];
    cache[chave] = new THREE.MeshStandardMaterial(o);
    return cache[chave];
  }
  // A MESMA PEDRA E A MESMA GRAMA DA PRAÇA: o desenho vem do hub3d (Hub.pintaLajotas /
  // pintaGrama só pintam um canvas 2D; não precisam do Acampamento aberto). Sem o hub3d
  // carregado (página de teste avulsa) o chão sai na cor chapada — nunca quebra.
  var texPracaCache = {};
  function texturaPraca(tipo) {
    if (texPracaCache[tipo]) return texPracaCache[tipo];
    var Hb = JOGO.Hub;
    var pinta = Hb && (tipo === 'grama' ? Hb.pintaGrama : Hb.pintaLajotas);
    var cv = document.createElement('canvas');
    if (tipo === 'listras') {
      // a lona da Barraquinha da Sorte (as mesmas listras do hub3d montaLoteria)
      cv.width = 128; cv.height = 32;
      var c2 = cv.getContext('2d');
      for (var i = 0; i < 8; i++) { c2.fillStyle = i % 2 ? '#e8c25a' : '#a4232b'; c2.fillRect(i * 16, 0, 16, 32); }
    } else {
      if (!pinta) return null;
      cv.width = cv.height = 256;
      try { pinta(cv.getContext('2d')); } catch (e) { return null; }
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    texPracaCache[tipo] = tex;
    return tex;
  }
  function malha(geo, mat, x, y, z) {
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  /* O CHÃO DA PRAÇA: um gramado grande por baixo de tudo (é o '~' e o mundo em volta,
   * 16 cm abaixo da pedra — terra baixa, sem buraco de lava nem água), as lajotas numa
   * malha só sobre as casas jogáveis e um meio-fio escuro onde a pedra encontra a grama.
   * O uv é MUNDO/4, como na praça: o tile de 4 m tem quatro pedras por fileira, então
   * cada casa de 2 m mostra duas — e a pedra não se repete casa a casa. Origem = casa
   * (0,0), como o resto do kit. */
  function chaoDaPraca(st, w, h, cache) {
    var g = new THREE.Group();
    var SIZE = CELL * 64;
    var cx = (w - 1) / 2 * CELL, cz = (h - 1) / 2 * CELL;
    var texG = texturaPraca('grama');
    var geoG = new THREE.PlaneGeometry(SIZE, SIZE);
    geoG.rotateX(-Math.PI / 2);
    var uvG = geoG.attributes.uv, posG = geoG.attributes.position;
    for (var i = 0; i < uvG.count; i++) uvG.setXY(i, (posG.getX(i) + cx) / 4, -(posG.getZ(i) + cz) / 4);
    var grama = malha(geoG, texG ? pracaMat(cache, 'grama', '#dcdcdc', { map: texG, roughness: 1 })
                                 : pracaMat(cache, 'grama', '#4c7a34'), cx, -0.16, cz);
    grama.castShadow = false;
    g.add(grama);

    function eChao(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      return tileKind(gridTile(st, x, y)) !== 'hole';
    }
    var pos = [], uv = [], nor = [], idx = [];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (!eChao(x, y)) continue;
      var x0 = (x - 0.5) * CELL, x1 = (x + 0.5) * CELL, z0 = (y - 0.5) * CELL, z1 = (y + 0.5) * CELL;
      var b = pos.length / 3;
      pos.push(x0, 0, z0, x0, 0, z1, x1, 0, z1, x1, 0, z0);
      uv.push(x0 / 4, -z0 / 4, x0 / 4, -z1 / 4, x1 / 4, -z1 / 4, x1 / 4, -z0 / 4);
      nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);      // anti-horário visto de cima: a face é a de cima
    }
    if (pos.length) {
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      var texL = texturaPraca('lajotas');
      var laj = malha(geo, texL ? pracaMat(cache, 'lajota', '#e6e6e6', { map: texL, roughness: 1 })
                                : pracaMat(cache, 'lajota', '#77736a'));
      laj.castShadow = false;
      g.add(laj);
    }
    // o meio-fio: 26 cm de pedra escura em cada aresta de fronteira (do topo da lajota
    // até abaixo da grama — fecha o degrau de 16 cm, que de lado mostrava o vão)
    var matFio = pracaMat(cache, 'meiofio', '#2f3338', { roughness: 1 });
    var geoX = new THREE.BoxGeometry(CELL + 0.26, 0.28, 0.26), geoZ = new THREE.BoxGeometry(0.26, 0.28, CELL + 0.26);
    for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) {
      if (!eChao(xx, yy)) continue;
      if (!eChao(xx, yy - 1)) g.add(malha(geoX, matFio, xx * CELL, -0.06, (yy - 0.5) * CELL));
      if (!eChao(xx, yy + 1)) g.add(malha(geoX, matFio, xx * CELL, -0.06, (yy + 0.5) * CELL));
      if (!eChao(xx - 1, yy)) g.add(malha(geoZ, matFio, (xx - 0.5) * CELL, -0.06, yy * CELL));
      if (!eChao(xx + 1, yy)) g.add(malha(geoZ, matFio, (xx + 0.5) * CELL, -0.06, yy * CELL));
    }
    return g;
  }

  /* A OBRA NA PEGADA: gira primeiro (medir antes de girar desloca o centro — o tombo de
   * eixo de sempre), mede, escala pela LARGURA da pegada (x e z iguais, sem deformar a
   * planta) e só então acerta a altura dentro de [altMin, altMax] — o esticão vertical
   * tem teto (`estMax`) para a obra não virar agulha. Assenta pelo pé e centra. */
  function obraNaPegada(chave, pw, ph, rotY, o) {
    var cena = null;
    try { cena = (M && M.rawScene) ? M.rawScene(chave) : null; } catch (e) { cena = null; }
    if (!cena) return null;
    var giro = new THREE.Group();
    giro.add(cena.clone(true));
    giro.rotation.y = rotY || 0;
    giro.updateMatrixWorld(true);
    var bb = new THREE.Box3().setFromObject(giro);
    var bx = bb.max.x - bb.min.x, by = bb.max.y - bb.min.y, bz = bb.max.z - bb.min.z;
    if (!(bx > 0.01 && by > 0.01 && bz > 0.01)) return null;
    var sobra = o.sobra || 1;
    var k = Math.min(pw * sobra / bx, ph * sobra / bz);
    var ky = k;
    if (o.altMax && by * ky > o.altMax) ky = o.altMax / by;
    if (o.altMin && by * ky < o.altMin) ky = Math.min(o.altMin / by, k * (o.estMax || 1));
    giro.scale.set(k, ky, k);
    giro.updateMatrixWorld(true);
    bb = new THREE.Box3().setFromObject(giro);
    giro.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    giro.traverse(function (n) { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
    var berco = new THREE.Group();
    berco.add(giro);
    berco.userData.chave = chave;
    return { no: berco, alt: bb.max.y - bb.min.y, larg: bb.max.x - bb.min.x, prof: bb.max.z - bb.min.z };
  }

  /* A OBRA QUE AINDA NÃO DECODIFICOU (no jogo servido o GLB pode descer depois do
   * tabuleiro): um volume de pedra do tamanho da pegada, na altura do muro — a regra já
   * vale na primeira foto. A arte troca quando chegar (esperaObrasDaPraca). */
  function provisoriaDaPraca(papel, pw, ph, cache) {
    var g = new THREE.Group();
    if (papel === 'arvore') {
      g.add(malha(new THREE.CylinderGeometry(0.55, 0.8, 3.2, 10), pracaMat(cache, 'tronco', '#5b4330'), 0, 1.6, 0));
      var copa = malha(new THREE.SphereGeometry(2.6, 14, 10), pracaMat(cache, 'copa', '#4f7d3a'), 0, 4.2, 0);
      copa.scale.y = 0.72;
      g.add(copa);
      return g;
    }
    var alt = papel === 'poco' ? WALL_H * 0.85 : WALL_H;
    g.add(malha(new THREE.BoxGeometry(pw * 0.9, alt, ph * 0.9), pracaMat(cache, 'obra-pedra', '#6d655a'), 0, alt / 2, 0));
    g.add(malha(new THREE.BoxGeometry(pw * 0.96, 0.2, ph * 0.96), pracaMat(cache, 'obra-topo', '#4f4a40'), 0, alt + 0.1, 0));
    return g;
  }

  /* O PORTAL: o anel de pedra da praça (hub3d montaPortais) com o miolo aceso na cor do
   * Fecho de `ordem` e o halo do kit. Numa casa: o topo do aro fica na altura do muro
   * (WALL_H), e o aro PASSA um pouco para as muretas dos lados — que são parte da mesma
   * construção, e é por isso que ele corre no eixo delas. Portal fechado: miolo apagado
   * e o X vermelho, como na praça.
   * 19/09: `campo` monta o PORTÃO DO CAMPO DE PVP — o mesmo arco, vermelho (#e0352b, a cor
   * da entrada na praça 3D), sem Fecho por trás (não procura DATA.dungeons) e nunca
   * fechado: na praça 3D ele virou o sétimo dente do arco dos portais, e no tabuleiro
   * ocupa a mesma coluna da borda oeste, entre o portal 0 e a Arena. */
  function portalDaPraca(ordem, eixoZ, cache, campo) {
    var D = DATA(), ds = D.dungeons || [], dg = campo ? null : (ds[ordem] || null);
    var cor = campo ? '#e0352b'
            : (JOGO.Hub && JOGO.Hub.corDoTema) ? JOGO.Hub.corDoTema(dg && dg.theme) : '#d8dee4';
    var fechado = !campo && !!(dg && D.portalFechado && D.portalFechado(dg.id));
    var g = new THREE.Group();
    g.add(malha(new THREE.CylinderGeometry(0.92, 1.06, 0.34, 20), pracaMat(cache, 'portal-base', '#4a443c'), 0, 0.17, 0));
    var R0 = 1.12, T0 = 0.22, cy = WALL_H - R0 - T0;
    g.add(malha(new THREE.TorusGeometry(R0, T0, 10, 36), pracaMat(cache, 'portal-pedra', '#5a5348'), 0, cy, 0));
    // os dois pés que prendem o aro na base (sem eles o anel boiava)
    [-0.55, 0.55].forEach(function (px) {
      g.add(malha(new THREE.BoxGeometry(0.3, cy - 0.9, 0.34), pracaMat(cache, 'portal-pedra', '#5a5348'), px, 0.34 + (cy - 0.9) / 2 - 0.02, 0));
    });
    var chaveM = 'portal-miolo|' + (fechado ? 'fechado' : cor);
    if (!cache[chaveM]) {
      cache[chaveM] = new THREE.MeshBasicMaterial({ color: col3(fechado ? '#3a3f44' : cor), transparent: true,
        opacity: fechado ? 0.3 : 0.74, side: THREE.DoubleSide, depthWrite: false });
    }
    var miolo = new THREE.Mesh(new THREE.CircleGeometry(R0 - 0.1, 32), cache[chaveM]);
    miolo.position.y = cy;
    g.add(miolo);
    if (fechado) {
      [Math.PI / 4, -Math.PI / 4].forEach(function (rz) {
        var barra = malha(new THREE.BoxGeometry(1.8, 0.22, 0.08), pracaMat(cache, 'portal-x', '#ff2e2e', { emissive: col3('#5a0808') }), 0, cy, 0.06);
        barra.rotation.z = rz;
        g.add(barra);
      });
    } else {
      var K = kit();
      if (K && K.makeHalo) {
        try { var halo = K.makeHalo(cor, 2.4, 0.42); halo.position.y = cy; g.add(halo); } catch (eH) {}
      }
    }
    if (eixoZ) g.rotation.y = Math.PI / 2;
    return g;
  }
  // a mureta dos dois lados do portal: pedra baixa (cobertura), no eixo do arco
  function muretaDaPraca(eixoZ, cache) {
    var g = new THREE.Group(), alt = LOW_H * 0.9;
    g.add(malha(new THREE.BoxGeometry(CELL * 1.02, alt, 0.62), pracaMat(cache, 'portal-pedra', '#5a5348'), 0, alt / 2, 0));
    g.add(malha(new THREE.BoxGeometry(CELL * 1.06, 0.1, 0.74), pracaMat(cache, 'mureta-topo', '#6d655a'), 0, alt + 0.05, 0));
    if (eixoZ) g.rotation.y = Math.PI / 2;
    return g;
  }
  // o banco de pedra da calçada: assento, dois pés e o encosto do lado de fora — 0,97 m
  function bancoDePedra(rotY, cache) {
    var g = new THREE.Group();
    var pedra = pracaMat(cache, 'banco-pedra', '#8d867a'), pe = pracaMat(cache, 'banco-pe', '#6d655a');
    g.add(malha(new THREE.BoxGeometry(1.7, 0.14, 0.56), pedra, 0, 0.5, 0.04));
    [-0.62, 0.62].forEach(function (px) { g.add(malha(new THREE.BoxGeometry(0.24, 0.44, 0.46), pe, px, 0.22, 0.04)); });
    g.add(malha(new THREE.BoxGeometry(1.7, 0.44, 0.12), pedra, 0, 0.75, -0.26));
    g.rotation.y = rotY;
    return g;
  }
  /* a RAIZ da Árvore aflorando na lajota: três arcos baixos (até 0,62 m) correndo para
   * FORA do tronco — a direção diz de onde ela vem. Local +x = para fora. */
  function raizDaArvore(ux, uz, cache) {
    var g = new THREE.Group(), mat = pracaMat(cache, 'raiz', '#5b4330', { roughness: 1 });
    [[-0.5, 0.62, 0.17], [0.05, 0.46, 0.13], [0.52, 0.34, 0.1]].forEach(function (r, i) {
      var t = r[0], alto = r[1];
      var curva = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-1.05, -0.08, t * 0.6), new THREE.Vector3(-0.4, alto, t),
        new THREE.Vector3(0.35, alto * 0.72, t * 1.1), new THREE.Vector3(1.0, -0.08, t * 1.25 + (i - 1) * 0.1)
      ]);
      g.add(malha(new THREE.TubeGeometry(curva, 14, r[2], 7, false), mat));
    });
    g.rotation.y = Math.atan2(-uz, ux);
    return g;
  }
  /* AS BARRACAS COMO COBERTURA BAIXA — o que uma barraca tem na altura do joelho, no
   * eixo comprido da pegada (local x). Tudo abaixo de 1,15 m: um herói (~2,05) vê por
   * cima, e é isso que a casa '=' promete. */
  function barracaDaPraca(papel, pw, ph, cache) {
    var g = new THREE.Group();
    var L = Math.max(pw, ph);
    var madeira = pracaMat(cache, 'madeira', '#6b4a2e');
    if (papel === 'forja') {
      // a bancada de pedra do ferreiro, a bigorna numa ponta e o braseiro na outra
      g.add(malha(new THREE.BoxGeometry(L * 0.86, 0.66, 0.8), pracaMat(cache, 'forja-pedra', '#5c574d'), 0, 0.33, 0));
      g.add(malha(new THREE.BoxGeometry(L * 0.9, 0.12, 0.92), madeira, 0, 0.72, 0));
      var ferro = pracaMat(cache, 'ferro', '#3a3d42', { metalness: 0.35, roughness: 0.6 });
      g.add(malha(new THREE.BoxGeometry(0.3, 0.18, 0.24), ferro, -L * 0.26, 0.87, 0));
      g.add(malha(new THREE.BoxGeometry(0.66, 0.16, 0.3), ferro, -L * 0.26, 1.04, 0));
      g.add(malha(new THREE.CylinderGeometry(0.34, 0.26, 0.16, 12), ferro, L * 0.26, 0.86, 0));
      g.add(malha(new THREE.CylinderGeometry(0.29, 0.29, 0.05, 12),
        pracaMat(cache, 'brasa', '#2a0a06', { emissive: col3('#ff5a1a'), emissiveIntensity: 1.1 }), L * 0.26, 0.95, 0));
    } else if (papel === 'loteria') {
      // o balcão de madeira com a lona listrada na frente e três caixas de prêmio
      g.add(malha(new THREE.BoxGeometry(L * 0.92, 0.82, 0.8), madeira, 0, 0.41, 0));
      var texLi = texturaPraca('listras');
      if (texLi) {
        var chaveLi = 'lona';
        if (!cache[chaveLi]) cache[chaveLi] = new THREE.MeshStandardMaterial({ map: texLi, roughness: 0.95 });
        [0.415, -0.415].forEach(function (pz) {
          g.add(malha(new THREE.BoxGeometry(L * 0.9, 0.5, 0.03), cache[chaveLi], 0, 0.46, pz));
        });
      }
      [['#c94f6d', -L * 0.3], ['#e8c25a', 0], ['#4a7d96', L * 0.3]].forEach(function (c) {
        g.add(malha(new THREE.BoxGeometry(0.34, 0.26, 0.34), pracaMat(cache, 'premio' + c[0], c[0]), c[1], 0.95, 0));
      });
    } else {
      // o mercadinho: caixotes, barril e baú do kit, numa fileira; sem kit, caixas
      var K = kit(), kinds = ['crates', 'barrel', 'chest', 'crates'];
      for (var i = 0; i < kinds.length; i++) {
        var px = (i - (kinds.length - 1) / 2) * (L / kinds.length);
        var prop = null;
        try { prop = K ? K.buildProp('garden', kinds[i], 11 + i * 5) : null; } catch (eK) { prop = null; }
        if (prop) { fitHeight(prop, i === 1 ? 1.0 : 0.85, CELL * 0.5); prop.position.set(px, 0, (i % 2) ? 0.12 : -0.1); }
        else prop = malha(new THREE.BoxGeometry(0.8, 0.8, 0.8), madeira, px, 0.4, 0);
        g.add(prop);
      }
    }
    if (ph > pw) g.rotation.y = Math.PI / 2;
    return g;
  }

  /* Monta UMA peça no centro da pegada dela. Anota no relatório o que entrou e se a obra
   * foi a ARTE ou a provisória. `pecas` é a lista inteira (o portal procura as muretas
   * dele para saber o eixo). */
  function montaPecaDaPraca(pc, pecas, cache, rel) {
    var pw = (pc.w || 1) * CELL, ph = (pc.h || 1) * CELL;
    var cxC = pc.x + ((pc.w || 1) - 1) / 2, cyC = pc.y + ((pc.h || 1) - 1) / 2;
    var mx = (gridW - 1) / 2, my = (gridH - 1) / 2;
    var ang = Math.atan2(mx - cxC, my - cyC);                      // de frente para o meio
    var rot90 = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);   // na grade, de 90 em 90°
    var no = null, obra = OBRA_PRACA[pc.papel];
    function eixoZDoPortal(papelOutro) {
      for (var i = 0; i < pecas.length; i++) {
        var o = pecas[i];
        if (o.papel === papelOutro && o.ordem === pc.ordem) return o.x === pc.x;
      }
      return false;
    }
    if (obra) {
      var f = obraNaPegada(obra.chave, pw, ph, pc.papel === 'arvore' ? obra.rot : rot90, obra);
      if (f) {
        no = f.no;
        rel.obras[obra.chave] = 'arte';
        if (pc.papel === 'arvore') {
          var larg = Math.max(f.larg, f.prof);
          rel.arvore = { alt: +f.alt.toFixed(2), larg: +larg.toFixed(2),
            caixa: { x0: wx(cxC) - f.larg / 2, x1: wx(cxC) + f.larg / 2, y0: 0, y1: f.alt,
                     z0: wz(cyC) - f.prof / 2, z1: wz(cyC) + f.prof / 2 } };
        }
      } else {
        no = provisoriaDaPraca(pc.papel, pw, ph, cache);
        rel.obras[obra.chave] = 'provisoria';
        if (rel.pendentes.indexOf(obra.chave) < 0) rel.pendentes.push(obra.chave);
      }
    } else if (pc.papel === 'portal') {
      no = portalDaPraca(pc.ordem | 0, eixoZDoPortal('portal_mureta'), cache);
    } else if (pc.papel === 'portal_campo') {
      // 19/09: o portão do Campo de PvP — vermelho, sem Fecho, nunca fechado
      no = portalDaPraca(0, eixoZDoPortal('portal_mureta'), cache, true);
    } else if (pc.papel === 'portal_mureta') {
      // a mureta acompanha o eixo do arco que ela ladeia: um portal OU o portão do Campo
      no = muretaDaPraca(eixoZDoPortal('portal') || eixoZDoPortal('portal_campo'), cache);
    } else if (pc.papel === 'banco_praca') {
      no = bancoDePedra(rot90, cache);
    } else if (pc.papel === 'raiz') {
      var ux = cxC - mx, uz = cyC - my, r = Math.hypot(ux, uz) || 1;
      no = raizDaArvore(ux / r, uz / r, cache);
    } else if (pc.papel === 'forja' || pc.papel === 'loteria' || pc.papel === 'mercado') {
      no = barracaDaPraca(pc.papel, pw, ph, cache);
    }
    if (!no) return null;
    no.position.set(cxC * CELL, 0, cyC * CELL);
    rel.papeis[pc.papel] = (rel.papeis[pc.papel] || 0) + 1;
    return no;
  }

  /* A ARTE QUE DESCE DEPOIS: pede as obras que faltaram ao carregador (Bundle.pede — o
   * GLB fora do grupo que já desceu só vem se alguém pedir) e, quando a primeira chegar,
   * derruba a chave do tabuleiro: o próximo quadro remonta a sala com a arte. Espera um
   * respiro depois da primeira para as irmãs chegarem juntas (uma remontagem, não cinco).
   * Uma montagem nova cancela a espera velha. 400 voltas: o relógio virtual do headless. */
  var pracaEspera = 0;
  function esperaObrasDaPraca(chaves) {
    var minha = ++pracaEspera, voltas = 0, viu = 0;
    try { if (JOGO.Bundle && JOGO.Bundle.pede) JOGO.Bundle.pede(chaves.slice()); } catch (eB) {}
    (function deNovo() {
      if (minha !== pracaEspera || ++voltas > 400) return;
      setTimeout(function () {
        if (minha !== pracaEspera) return;
        var chegaram = chaves.filter(function (ch) {
          try { return !!(M && M.rawScene && M.rawScene(ch)); } catch (e) { return false; }
        }).length;
        if (chegaram === chaves.length || (chegaram > 0 && ++viu > 3)) { boardKey = null; return; }
        deNovo();
      }, 500);
    })();
  }
  R._obrasDaPraca = OBRA_PRACA;       // a prova lê as alturas daqui, sem repetir número

  // ================================================== O SALÃO DA SEDE (15/09)
  //
  // Dono: "a guerra de guild que é 2x2 de cada guild é na sede de guild". O mapa em grade é
  // o 'sede' de js/core/data/arenas.js (25×19, fechado por parede, porta ao sul) e as
  // `pecas` dizem o que cada bloco é. Aqui elas vestem como um SALÃO DE GUILDA por dentro:
  // tábuas no chão com o tapete da porta ao trono, parede de pedra com esteio e frechal de
  // madeira, pilares, armaduras, a mesa do conselho e duas lareiras acesas.
  //
  // A mesma lei da praça manda: '#' tem de PARECER alto (acima dos 2,05 m de um herói) e
  // '=' tem de parecer baixo (até ~1,2 m, dá para ver por cima). A prova mede as duas.
  //
  // Tudo aqui é primitiva — não há arte do dono para o salão ainda. As peças são funções
  // pequenas e separadas justamente para trocar uma a uma quando o modelo chegar
  // (`rel.provisorias` lista quem ainda é primitiva).
  var PAPEIS_SEDE = { parede_salao: 1, trono: 1, estandarte: 1, pilar: 1, armadura: 1, mesa: 1,
                      banco_salao: 1, estatua: 1, bau: 1, lareira: 1 };
  var PAPEIS_POR_TEMA = { praca: PAPEIS_PRACA, sede: PAPEIS_SEDE };
  /* A PAREDE DO SALÃO: 30% acima do muro de calabouço (4,0 m). Salão é pé-direito alto, e a
   * parede do fundo não esconde casa nenhuma — atrás dela não há tabuleiro. */
  var SEDE_PAREDE_H = WALL_H * 1.3;
  /* O RECORTE: a parede do lado da câmera desce a 1,05 m (como a maquete cortada de uma
   * planta). Inteira, a parede sul de 4 m escondia da câmera padrão (tilt 0,98: a sombra de
   * visada é ~1,5·h) as TRÊS fileiras de baixo — onde a porta e metade dos bancos estão. A
   * 1,05 ela esconde meia casa, e o topo de pedra à mostra (com o rodapé e o esteio
   * cortados junto) diz "isto é parede cortada", não mureta. */
  var SEDE_CORTE_H = 1.05;

  function sorteioSede(semente) {
    var s = semente >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function rgbaSede(r, g, b, a) {
    return 'rgba(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ',' + (a == null ? 1 : a) + ')';
  }
  // um retângulo que dá a volta na borda horizontal (a textura repete sem costura)
  function retTorus(c, x, y, w, h, estilo) {
    c.fillStyle = estilo;
    c.fillRect(x, y, w, h);
    if (x + w > 256) c.fillRect(x - 256, y, w, h);
  }
  /* AS TEXTURAS DO SALÃO, pintadas por semente fixa (a sala nasce igual toda vez, como as
   * lajotas da praça). Todas no mesmo passo de 4 m por textura, uv = mundo/4. */
  var texSedeCache = {};
  function texturaSede(tipo) {
    if (texSedeCache[tipo]) return texSedeCache[tipo];
    var cv = document.createElement('canvas');
    var r, i, k, acc, comp, tom, x0, y0;
    if (tipo === 'tapete') { cv.width = 128; cv.height = 256; } else { cv.width = cv.height = 256; }
    var c = cv.getContext('2d');
    if (!c) return null;
    if (tipo === 'tabuas') {
      /* TÁBUAS CORRENDO NO EIXO LESTE–OESTE, atravessando o tapete (que corre norte–sul):
       * 8 fileiras = tábua de 0,5 m, comprimentos de 1,4 a 3 m com a emenda desencontrada.
       * A junta é o fundo escuro que sobra entre uma tábua e outra. Tom médio, e não o
       * marrom-escuro da paleta: o herói precisa de chão que não engula a silhueta. */
      r = sorteioSede(4101);
      c.fillStyle = '#2b1d13'; c.fillRect(0, 0, 256, 256);
      for (i = 0; i < 8; i++) {
        y0 = i * 32; acc = 0;
        var ini = Math.floor(r() * 256);
        while (acc < 256) {
          comp = Math.min(256 - acc, 90 + Math.floor(r() * 100));
          if (256 - acc - comp < 40) comp = 256 - acc;          // sem toco de tábua na volta
          tom = r();
          // 15/09 (foto): o 150/104/64 de antes saía laranja sob a luz quente; puxado para o marrom
          var R0 = 128 + tom * 30, G0 = 94 + tom * 22, B0 = 68 + tom * 16;
          x0 = (ini + acc) % 256;
          retTorus(c, x0 + 1, y0 + 1, comp - 2, 30, rgbaSede(R0, G0, B0));
          for (k = 0; k < 6; k++) {                               // os veios
            retTorus(c, x0 + 3 + Math.floor(r() * 20), y0 + 3 + Math.floor(r() * 25), comp - 30, 1,
                     rgbaSede(R0 * 0.7, G0 * 0.66, B0 * 0.62, 0.30 + r() * 0.25));
          }
          retTorus(c, x0 + 1, y0 + 1, comp - 2, 2, 'rgba(255,230,190,0.10)');   // a quina gasta
          retTorus(c, x0 + 5, y0 + 7, 2, 2, 'rgba(28,20,14,0.85)');             // os pregos
          retTorus(c, x0 + 5, y0 + 23, 2, 2, 'rgba(28,20,14,0.85)');
          acc += comp;
        }
      }
    } else if (tipo === 'pedra') {
      // SILHARIA: fiadas de 0,5 m, blocos de 0,75 a 1,4 m, argamassa escura
      r = sorteioSede(733);
      c.fillStyle = '#3a312a'; c.fillRect(0, 0, 256, 256);
      for (i = 0; i < 8; i++) {
        y0 = i * 32; acc = 0;
        var ini2 = (i % 2 ? 36 : 0) + Math.floor(r() * 16);
        while (acc < 256) {
          comp = Math.min(256 - acc, 48 + Math.floor(r() * 42));
          if (256 - acc - comp < 24) comp = 256 - acc;
          tom = r();
          x0 = (ini2 + acc) % 256;
          retTorus(c, x0 + 2, y0 + 2, comp - 4, 28, rgbaSede(118 + tom * 30, 106 + tom * 26, 94 + tom * 22));
          for (k = 0; k < 7; k++) {
            retTorus(c, x0 + 3 + Math.floor(r() * (comp - 10)), y0 + 4 + Math.floor(r() * 22), 3, 2, 'rgba(0,0,0,0.13)');
          }
          retTorus(c, x0 + 2, y0 + 2, comp - 4, 2, 'rgba(255,236,210,0.09)');
          acc += comp;
        }
      }
    } else if (tipo === 'tapete') {
      /* O TAPETE DA PORTA AO TRONO: vermelho de lã com barra de ouro dos dois lados e um
       * losango a cada 6 m (a textura repete no comprimento; o losango é centrado para a
       * emenda não aparecer). u = largura, v = comprimento. */
      c.fillStyle = '#7c1a1f'; c.fillRect(0, 0, 128, 256);
      r = sorteioSede(91);
      for (k = 0; k < 500; k++) { c.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,200,160,0.05)'; c.fillRect(Math.floor(r() * 128), Math.floor(r() * 256), 2, 1); }
      c.fillStyle = '#d6a443'; c.fillRect(5, 0, 7, 256); c.fillRect(116, 0, 7, 256);
      c.fillStyle = '#4c0d12'; c.fillRect(12, 0, 4, 256); c.fillRect(112, 0, 4, 256);
      c.fillStyle = '#d6a443'; c.fillRect(18, 0, 2, 256); c.fillRect(108, 0, 2, 256);
      c.beginPath(); c.moveTo(64, 50); c.lineTo(98, 128); c.lineTo(64, 206); c.lineTo(30, 128); c.closePath();
      c.fillStyle = '#a32a2f'; c.fill();
      c.lineWidth = 4; c.strokeStyle = '#d6a443'; c.stroke();
      c.beginPath(); c.moveTo(64, 96); c.lineTo(78, 128); c.lineTo(64, 160); c.lineTo(50, 128); c.closePath();
      c.fillStyle = '#d6a443'; c.fill();
      [0, 256].forEach(function (py) { c.beginPath(); c.arc(64, py, 7, 0, Math.PI * 2); c.fillStyle = '#d6a443'; c.fill(); });
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    texSedeCache[tipo] = tex;
    return tex;
  }

  /* A BANDEIRA DO ESTANDARTE, com o GANCHO DA GUILDA: `R.setGuildasSede({ oeste: {cor,
   * emblema}, leste: {…} })` pinta a bandeira de cada lado (oeste = quem nasce no `P`,
   * leste = no `a`) e remonta o salão. Sem gancho, os dois lados saem no vermelho e ouro
   * neutros do salão. O emblema é um texto curto (uma letra, um símbolo); sem ele, o
   * escudo com a cruz. Quem decide a cor é a regra da guerra, não o tabuleiro. */
  var guildasSede = {};
  var CORES_SEDE_NEUTRAS = { cor: '#8c1f24', ouro: '#d6a443' };
  R.setGuildasSede = function (o) {
    guildasSede = {};
    if (o && typeof o === 'object') {
      ['oeste', 'leste'].forEach(function (lado) {
        var g = o[lado];
        if (g && typeof g === 'object') {
          guildasSede[lado] = {
            cor: /^#[0-9a-f]{6}$/i.test(g.cor || '') ? g.cor : CORES_SEDE_NEUTRAS.cor,
            emblema: g.emblema ? String(g.emblema).slice(0, 2) : ''
          };
        }
      });
    }
    boardKey = null;                    // o próximo quadro remonta com as bandeiras novas
    return guildasSede;
  };
  function texturaBandeira(cor, emblema) {
    var chave = 'bandeira|' + cor + '|' + (emblema || '');
    if (texSedeCache[chave]) return texSedeCache[chave];
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 200;
    var c = cv.getContext('2d');
    if (!c) return null;
    // o rabo de andorinha embaixo (alfa recortado pelo alphaTest do material)
    c.beginPath(); c.moveTo(0, 0); c.lineTo(128, 0); c.lineTo(128, 200); c.lineTo(64, 164); c.lineTo(0, 200); c.closePath();
    c.fillStyle = cor; c.fill();
    c.save(); c.clip(); c.lineWidth = 16; c.strokeStyle = CORES_SEDE_NEUTRAS.ouro; c.stroke(); c.restore();
    c.fillStyle = CORES_SEDE_NEUTRAS.ouro;
    if (emblema) {
      c.font = 'bold 64px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(emblema, 64, 90);
    } else {
      c.beginPath(); c.moveTo(38, 46); c.lineTo(90, 46); c.lineTo(90, 88);
      c.quadraticCurveTo(90, 118, 64, 134); c.quadraticCurveTo(38, 118, 38, 88); c.closePath(); c.fill();
      c.fillStyle = cor;
      c.beginPath(); c.moveTo(46, 54); c.lineTo(82, 54); c.lineTo(82, 88);
      c.quadraticCurveTo(82, 110, 64, 123); c.quadraticCurveTo(46, 110, 46, 88); c.closePath(); c.fill();
      c.fillStyle = CORES_SEDE_NEUTRAS.ouro;
      c.fillRect(60, 60, 8, 56); c.fillRect(49, 78, 30, 8);
    }
    var tex = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    texSedeCache[chave] = tex;
    return tex;
  }

  /* uv de MUNDO numa caixa já transladada: cada face pega as duas coordenadas do plano
   * dela. A pedra da parede de 4 m sai com as mesmas fiadas da de 1 m, sem esticar. */
  function uvMundo(geo, passo) {
    var p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
    for (var i = 0; i < p.count; i++) {
      var u, v;
      if (Math.abs(n.getY(i)) > 0.5) { u = p.getX(i); v = p.getZ(i); }
      else if (Math.abs(n.getX(i)) > 0.5) { u = p.getZ(i); v = p.getY(i); }
      else { u = p.getX(i); v = p.getY(i); }
      uv.setXY(i, u / passo, v / passo);
    }
    uv.needsUpdate = true;
    return geo;
  }
  function caixaSede(w, h, d, x, y, z) {
    var g = new THREE.BoxGeometry(w, h, d);
    g.translate(x || 0, y || 0, z || 0);
    return uvMundo(g, 4);
  }
  function peca(g, geo, mat, x, y, z) {
    var m = malha(geo, mat, x, y, z);
    g.add(m);
    return m;
  }
  function cilSede(rt, rb, h, seg) { return new THREE.CylinderGeometry(rt, rb, h, seg || 10); }
  // os materiais do salão (um por chave: o merge funde por material)
  function matsSede(cache) {
    if (cache.__sede) return cache.__sede;
    var texP = texturaSede('pedra');
    var m = {
      pedra: texP ? pracaMat(cache, 'sede-pedra', '#ece4da', { map: texP, roughness: 0.96 })
                  : pracaMat(cache, 'sede-pedra', '#7a6e62'),
      pedraClara: pracaMat(cache, 'sede-pedra-clara', '#948a7e', { roughness: 0.95 }),
      pedraEsc: pracaMat(cache, 'sede-pedra-esc', '#4d443c', { roughness: 1 }),
      madeira: pracaMat(cache, 'sede-madeira', '#7a5232', { roughness: 0.9 }),
      madeiraEsc: pracaMat(cache, 'sede-madeira-esc', '#43291a', { roughness: 0.92 }),
      pano: pracaMat(cache, 'sede-pano', '#8c1f24', { roughness: 1 }),
      ouro: pracaMat(cache, 'sede-ouro', '#d0a044', { metalness: 0.5, roughness: 0.42 }),
      ferro: pracaMat(cache, 'sede-ferro', '#3a3d42', { metalness: 0.35, roughness: 0.6 }),
      metal: pracaMat(cache, 'sede-metal', '#aeb4bc', { metalness: 0.45, roughness: 0.42 }),
      marmore: pracaMat(cache, 'sede-marmore', '#c9c1b4', { roughness: 0.7 }),
      fuligem: pracaMat(cache, 'sede-fuligem', '#140d09', { roughness: 1, emissive: col3('#3a1206'), emissiveIntensity: 0.6 }),
      pergaminho: pracaMat(cache, 'sede-pergaminho', '#d8c49a', { roughness: 1 }),
      chama: pracaMat(cache, 'sede-chama', '#ffc06a', { emissive: col3('#ff9a3c'), emissiveIntensity: 2.0 })
    };
    cache.__sede = m;
    return m;
  }

  /* O CHÃO DO SALÃO: breu por baixo de tudo (o mundo fora da parede não existe), as tábuas
   * numa malha só sobre as casas da sala, a SOLEIRA de pedra nas casas '~' da borda (a
   * porta) e o tapete comprido da frente do trono até a última fileira antes da porta. */
  function chaoDaSede(st, w, h, cache, pecas, rel) {
    var g = new THREE.Group();
    var m = matsSede(cache);
    var SIZE = CELL * 64;
    var cx = (w - 1) / 2 * CELL, cz = (h - 1) / 2 * CELL;
    var geoF = new THREE.PlaneGeometry(SIZE, SIZE);
    geoF.rotateX(-Math.PI / 2);
    var fora = malha(geoF, pracaMat(cache, 'sede-fora', '#120c08', { roughness: 1 }), cx, -0.06, cz);
    fora.castShadow = false;
    g.add(fora);
    function eChao(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      return tileKind(gridTile(st, x, y)) !== 'hole';
    }
    var pos = [], uv = [], nor = [], idx = [];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (!eChao(x, y)) continue;
      var x0 = (x - 0.5) * CELL, x1 = (x + 0.5) * CELL, z0 = (y - 0.5) * CELL, z1 = (y + 0.5) * CELL;
      var b = pos.length / 3;
      pos.push(x0, 0, z0, x0, 0, z1, x1, 0, z1, x1, 0, z0);
      uv.push(x0 / 4, -z0 / 4, x0 / 4, -z1 / 4, x1 / 4, -z1 / 4, x1 / 4, -z0 / 4);
      nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    if (pos.length) {
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      var texT = texturaSede('tabuas');
      var tab = malha(geo, texT ? pracaMat(cache, 'sede-tabuas', '#e2d8cc', { map: texT, roughness: 0.9 })
                                : pracaMat(cache, 'sede-tabuas', '#8a633f'));
      tab.castShadow = false;
      g.add(tab);
    }
    // a soleira: casa vazia NA BORDA que encosta no salão é a porta
    rel.soleira = 0;
    for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) {
      var borda = (xx === 0 || yy === 0 || xx === w - 1 || yy === h - 1);
      if (!borda || eChao(xx, yy) || !gridTile(st, xx, yy)) continue;
      if (!(eChao(xx - 1, yy) || eChao(xx + 1, yy) || eChao(xx, yy - 1) || eChao(xx, yy + 1))) continue;
      var sol = malha(caixaSede(CELL, 0.14, CELL, xx * CELL, -0.06, yy * CELL), m.pedra);
      sol.castShadow = false;
      g.add(sol);
      rel.soleira++;
    }
    // o tapete, no eixo do trono
    var tr = null;
    for (var i = 0; i < pecas.length; i++) if (pecas[i].papel === 'trono') { tr = pecas[i]; break; }
    var texTp = texturaSede('tapete');
    if (tr && texTp) {
      var tx = tr.x + ((tr.w || 1) - 1) / 2;
      var zA = (tr.y + (tr.h || 1) - 0.5) * CELL, zB = (h - 1.5) * CELL;
      /* 2,4 casas de largura: estreito (uma casa) ele sumia debaixo das armaduras e dos baús
       * que o mapa põe no mesmo eixo; largo, eles ficam EM CIMA do tapete, como num salão */
      var larg = CELL * 2.4, comp = zB - zA;
      if (comp > CELL) {
        var geoT = new THREE.PlaneGeometry(larg, comp);
        geoT.rotateX(-Math.PI / 2);
        var uvT = geoT.attributes.uv;
        for (var q = 0; q < uvT.count; q++) uvT.setY(q, uvT.getY(q) * comp / 6);
        var tap = malha(geoT, pracaMat(cache, 'sede-tapete', '#ffffff', { map: texTp, roughness: 1 }), tx * CELL, 0.014, (zA + zB) / 2);
        tap.castShadow = false;
        g.add(tap);
        rel.tapete = { x: tx, de: tr.y + (tr.h || 1), ate: h - 2 };
      }
    }
    return g;
  }

  /* AS PAREDES DO SALÃO: a pegada de `parede_salao` é o retângulo inteiro, mas só o
   * CONTORNO dela é parede (o miolo é o salão, e as casas altas de lá têm peça própria).
   *
   * Cada lado sai em DUAS versões — inteira (4 m, pedra, rodapé, esteio e frechal de
   * madeira, cornija, tochas) e cortada (1,05 m com o topo escuro de corte) — e o laço de
   * render mostra a cortada nos lados que ficam ENTRE a câmera e o salão (`animaSede`).
   * O canto só corta quando os dois lados dele cortam: com a câmera de quina, a parede do
   * fundo segue inteira até o canto. Nenhuma das duas mente para a regra: a borda é '#',
   * ninguém anda nem vê através dela, e do lado da câmera não há casa atrás. */
  function paredesDoSalao(st, pc, ctx) {
    var m = matsSede(ctx.cache), rel = ctx.rel, K = kit();
    var xa = pc.x, ya = pc.y, xb = pc.x + (pc.w || 1) - 1, yb = pc.y + (pc.h || 1) - 1;
    var H = SEDE_PAREDE_H, HC = SEDE_CORTE_H;
    var grupos = {}, ordem = [];
    function grupo(lados) {
      var k = lados.join('|');
      if (!grupos[k]) { grupos[k] = { lados: lados, alta: new THREE.Group(), baixa: new THREE.Group() }; ordem.push(k); }
      return grupos[k];
    }
    function eAlto(x, y) { return tileKind(gridTile(st, x, y)) === 'high'; }
    function ladosDe(x, y) {
      var l = [];
      if (y === ya) l.push('norte');
      if (y === yb) l.push('sul');
      if (x === xa) l.push('oeste');
      if (x === xb) l.push('leste');
      return l;
    }
    var NORMAL = { norte: [0, 1], sul: [0, -1], oeste: [1, 0], leste: [-1, 0] };   // para DENTRO
    // uma tira ao longo da face de dentro (rodapé, frechal): `prof` para dentro do salão
    function tira(g, lado, px, pz, hgt, yc, prof, mat, larg) {
      var n = NORMAL[lado], L = larg || CELL;
      if (n[1]) peca(g, caixaSede(L, hgt, prof, px, yc, pz + n[1] * (CELL / 2 + prof / 2)), mat);
      else peca(g, caixaSede(prof, hgt, L, px + n[0] * (CELL / 2 + prof / 2), yc, pz), mat);
    }
    function tocha(g, lado, px, pz) {
      var n = NORMAL[lado], fx = px + n[0] * CELL / 2, fz = pz + n[1] * CELL / 2, yT = 2.35;
      var sup = n[1] ? caixaSede(0.1, 0.1, 0.46, fx, yT, fz + n[1] * 0.23) : caixaSede(0.46, 0.1, 0.1, fx + n[0] * 0.23, yT, fz);
      peca(g, sup, m.ferro);
      var cx2 = fx + n[0] * 0.46, cz2 = fz + n[1] * 0.46;
      peca(g, cilSede(0.13, 0.07, 0.2, 8), m.ferro, cx2, yT + 0.1, cz2);
      var fl = peca(g, new THREE.ConeGeometry(0.1, 0.32, 7), m.chama, cx2, yT + 0.36, cz2);
      fl.castShadow = false;
      if (K && K.makeHalo) {
        try { var hl = K.makeHalo('#ff9a4a', 1.7, 0.5); hl.position.set(cx2, yT + 0.42, cz2); g.add(hl); } catch (eH) {}
      }
      rel.tochas++;
    }
    for (var y = ya; y <= yb; y++) for (var x = xa; x <= xb; x++) {
      if (!(x === xa || x === xb || y === ya || y === yb)) continue;
      if (!eAlto(x, y)) continue;
      var lados = ladosDe(x, y), G = grupo(lados);
      var px = x * CELL, pz = y * CELL;
      rel.paredes++;
      peca(G.alta, caixaSede(CELL, H, CELL, px, H / 2, pz), m.pedra);
      peca(G.alta, caixaSede(CELL + 0.12, 0.22, CELL + 0.12, px, H + 0.11, pz), m.pedraEsc);   // a cornija
      peca(G.baixa, caixaSede(CELL, HC, CELL, px, HC / 2, pz), m.pedra);
      /* o topo do corte na MESMA pedra da parede: escuro (1ª foto) ele virava uma faixa preta
       * de 2 m, e claro (2ª foto) uma faixa bege que roubava o olho do tabuleiro */
      peca(G.baixa, caixaSede(CELL + 0.04, 0.07, CELL + 0.04, px, HC + 0.035, pz), m.pedra);
      if (lados.length !== 1) continue;
      var lado = lados[0], n = NORMAL[lado];
      // a casa de dentro encostada é parede também (a lareira, o trono)? então sem enfeite
      var encostada = eAlto(x + n[0], y + n[1]);
      tira(G.alta, lado, px, pz, 0.46, 0.23, 0.14, m.pedraEsc);
      tira(G.baixa, lado, px, pz, 0.46, 0.23, 0.14, m.pedraEsc);
      if (!encostada) tira(G.alta, lado, px, pz, 0.34, H - 0.62, 0.24, m.madeiraEsc);   // o frechal
      var ao = n[1] ? x : y;
      if (!encostada && ao % 3 === 0) {
        // o ESTEIO: a viga de pé a cada 6 m, do rodapé ao frechal
        var hE = H - 0.46, hEc = HC - 0.46;
        var ex = px + n[0] * (CELL / 2 + 0.1), ez = pz + n[1] * (CELL / 2 + 0.1);
        peca(G.alta, n[1] ? caixaSede(0.38, hE, 0.2, ex, 0.46 + hE / 2, ez) : caixaSede(0.2, hE, 0.38, ex, 0.46 + hE / 2, ez), m.madeiraEsc);
        peca(G.baixa, n[1] ? caixaSede(0.38, hEc, 0.2, ex, 0.46 + hEc / 2, ez) : caixaSede(0.2, hEc, 0.38, ex, 0.46 + hEc / 2, ez), m.madeiraEsc);
      } else if (!encostada && ao % 6 === 3) {
        tocha(G.alta, lado, px, pz);
      }
    }
    // A PORTA: a corrida de casas vazias na borda ganha batente, verga de madeira e a pedra
    // por cima da verga (na versão inteira); a cortada fica só com o batente baixo
    [['norte', ya], ['sul', yb]].forEach(function (par) {
      var lado = par[0], yy = par[1], x0 = null;
      for (var xx = xa + 1; xx <= xb; xx++) {
        var vazia = xx < xb && tileKind(gridTile(st, xx, yy)) === 'hole';
        if (vazia && x0 === null) x0 = xx;
        if (!vazia && x0 !== null) {
          var x1 = xx - 1, G2 = grupo([lado]);
          var larg = (x1 - x0 + 1) * CELL, cxp = (x0 + x1) / 2 * CELL, pz2 = yy * CELL;
          var hV = 2.9;
          peca(G2.alta, caixaSede(larg, H - hV, CELL, cxp, hV + (H - hV) / 2, pz2), m.pedra);
          peca(G2.alta, caixaSede(larg + 0.7, 0.34, CELL * 1.08, cxp, hV - 0.17, pz2), m.madeiraEsc);
          [x0 - 0.5, x1 + 0.5].forEach(function (bx) {
            peca(G2.alta, caixaSede(0.34, hV - 0.34, CELL * 1.08, bx * CELL, (hV - 0.34) / 2, pz2), m.madeiraEsc);
            peca(G2.baixa, caixaSede(0.34, HC + 0.06, CELL * 1.08, bx * CELL, (HC + 0.06) / 2, pz2), m.madeiraEsc);
          });
          rel.portas++;
          x0 = null;
        }
      }
    });
    var funde = !!(K && K.mergeStatic && !window.__nomerge);
    ordem.forEach(function (k) {
      var G = grupos[k];
      var alta = funde ? K.mergeStatic(G.alta) : G.alta;
      var baixa = funde ? K.mergeStatic(G.baixa) : G.baixa;
      baixa.visible = false;
      ctx.vivos.push(alta, baixa);
      ctx.cortes.push({ lados: G.lados, alta: alta, baixa: baixa });
    });
  }

  /* O TRONO (3×1, alto): o estrado de pedra nas três casas, o painel de madeira escura com
   * o pano vermelho atrás, dois postes com pomo de ouro nas casas dos lados (a casa
   * inteira tem de parecer alta, não só a do meio) e a cadeira de espaldar alto. Frente =
   * +z local. */
  function tronoDaSede(L, m) {
    var g = new THREE.Group();
    peca(g, caixaSede(L, 0.3, CELL * 0.92, 0, 0.15, 0), m.pedraClara);
    peca(g, caixaSede(L * 0.5, 0.15, 0.5, 0, 0.075, CELL * 0.46 + 0.2), m.pedraClara);          // o degrau
    peca(g, caixaSede(L + 0.04, 0.06, 0.06, 0, 0.3, CELL * 0.46), m.ouro);
    peca(g, caixaSede(L * 0.96, 3.9, 0.3, 0, 0.3 + 1.95, -0.78), m.madeiraEsc);                  // o painel
    peca(g, caixaSede(2.3, 3.1, 0.05, 0, 0.3 + 1.95, -0.61), m.pano);
    peca(g, caixaSede(2.5, 0.12, 0.08, 0, 0.3 + 3.55, -0.6), m.ouro);
    [-1, 1].forEach(function (s) {
      peca(g, caixaSede(0.46, 3.9, 0.46, s * (L / 2 - 0.55), 0.3 + 1.95, -0.3), m.madeira);
      peca(g, new THREE.SphereGeometry(0.28, 12, 8), m.ouro, s * (L / 2 - 0.55), 0.3 + 3.9 + 0.22, -0.3);
      peca(g, caixaSede(0.12, 3.1, 0.07, s * 1.2, 0.3 + 1.95, -0.6), m.ouro);
    });
    // a cadeira
    peca(g, caixaSede(1.4, 0.5, 1.0, 0, 0.3 + 0.25, 0.05), m.madeira);
    peca(g, caixaSede(1.2, 0.12, 0.86, 0, 0.3 + 0.56, 0.08), m.pano);
    peca(g, caixaSede(1.4, 2.7, 0.26, 0, 0.3 + 0.5 + 1.35, -0.34), m.madeira);
    peca(g, caixaSede(0.96, 2.0, 0.05, 0, 0.3 + 0.5 + 1.2, -0.2), m.pano);
    peca(g, new THREE.ConeGeometry(0.3, 0.55, 4), m.ouro, 0, 0.3 + 3.2 + 0.27, -0.34);
    [-1, 1].forEach(function (s) { peca(g, caixaSede(0.2, 0.5, 0.95, s * 0.7, 0.3 + 0.75, 0.05), m.madeiraEsc); });
    return g;
  }
  // O ESTANDARTE (alto): base de pedra, mastro, travessa, pomo e a bandeira da guilda
  function estandarteDaSede(lado, m, cache) {
    var g = new THREE.Group();
    var gd = guildasSede[lado] || {};
    var cor = gd.cor || CORES_SEDE_NEUTRAS.cor;
    peca(g, cilSede(0.5, 0.62, 0.36, 12), m.pedraClara, 0, 0.18, 0);
    peca(g, cilSede(0.075, 0.09, 4.1, 8), m.madeiraEsc, 0, 0.36 + 2.05, 0);
    peca(g, new THREE.SphereGeometry(0.16, 10, 8), m.ouro, 0, 4.58, 0);
    peca(g, caixaSede(1.6, 0.09, 0.09, 0, 4.15, 0.08), m.madeiraEsc);
    [-0.8, 0.8].forEach(function (px) { peca(g, new THREE.SphereGeometry(0.07, 8, 6), m.ouro, px, 4.15, 0.08); });
    var tex = texturaBandeira(cor, gd.emblema || '');
    var chave = 'sede-bandeira|' + cor + '|' + (gd.emblema || '');
    var matB = tex ? pracaMat(cache, chave, '#ffffff', { map: tex, side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.95 })
                   : pracaMat(cache, chave, cor, { side: THREE.DoubleSide });
    var band = peca(g, new THREE.PlaneGeometry(1.45, 2.26), matB, 0, 4.1 - 1.13, 0.13);
    band.userData.bandeira = lado;
    return g;
  }
  /* O PILAR (alto): base, plinto, fuste de pedra, capitel e ábaco — 2,64 m, fino (0,9 m).
   * 15/09 (prova): a 3,76 m o ábaco do pilar (19,9) tapava da câmera padrão o herói que
   * nasce em (21,8); a 2,9 também, depois que o ajuste da câmera dos mapas de duelo trouxe o
   * pivô para a frente. A 2,64 ele ainda passa meio metro da cabeça de um herói (2,05) — lê
   * como coluna — e para de esconder a casa de nascimento; o pé-direito é da parede de 4 m. */
  function pilarDaSede(m) {
    var g = new THREE.Group();
    peca(g, caixaSede(1.2, 0.34, 1.2, 0, 0.17, 0), m.pedraEsc);
    peca(g, caixaSede(0.96, 0.2, 0.96, 0, 0.44, 0), m.pedraClara);
    var fuste = new THREE.CylinderGeometry(0.36, 0.42, 1.76, 14);
    fuste.translate(0, 0.54 + 0.88, 0);
    peca(g, uvMundo(fuste, 4), m.pedra);
    peca(g, cilSede(0.48, 0.38, 0.2, 14), m.pedraClara, 0, 2.4, 0);
    peca(g, caixaSede(1.08, 0.14, 1.08, 0, 2.57, 0), m.pedraEsc);
    return g;
  }
  /* A ARMADURA NO SUPORTE (alta): pedestal de madeira, pernas, peitoral, ombreiras, elmo
   * com penacho, o tabardo vermelho, o escudo no braço e a alabarda de pé ao lado. */
  function armaduraDaSede(m) {
    var g = new THREE.Group();
    peca(g, caixaSede(1.05, 0.28, 1.05, 0, 0.14, 0), m.madeiraEsc);
    [-0.19, 0.19].forEach(function (px) {
      peca(g, cilSede(0.12, 0.14, 0.98, 8), m.metal, px, 0.28 + 0.49, 0);
      peca(g, caixaSede(0.24, 0.12, 0.34, px, 0.34, 0.05), m.ferro);
    });
    var peito = peca(g, cilSede(0.44, 0.32, 0.86, 10), m.metal, 0, 1.26 + 0.43, 0);
    peito.scale.z = 0.62;
    peca(g, caixaSede(0.66, 0.1, 0.44, 0, 1.3, 0), m.ferro);
    peca(g, caixaSede(0.44, 0.78, 0.04, 0, 1.3, 0.28), m.pano);
    [-1, 1].forEach(function (s) {
      peca(g, new THREE.SphereGeometry(0.21, 10, 8), m.metal, s * 0.5, 2.06, 0);
      peca(g, cilSede(0.1, 0.09, 0.78, 8), m.metal, s * 0.54, 1.62, 0);
    });
    peca(g, cilSede(0.1, 0.12, 0.14, 8), m.ferro, 0, 2.18, 0);
    peca(g, cilSede(0.21, 0.23, 0.38, 12), m.metal, 0, 2.44, 0);
    peca(g, new THREE.SphereGeometry(0.21, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), m.metal, 0, 2.63, 0);
    peca(g, caixaSede(0.3, 0.05, 0.05, 0, 2.47, 0.21), m.fuligem);
    peca(g, caixaSede(0.07, 0.34, 0.46, 0, 2.94, -0.04), m.pano);
    var escudo = peca(g, cilSede(0.38, 0.38, 0.07, 18), m.pano, -0.72, 1.55, 0.18);
    escudo.rotation.z = Math.PI / 2; escudo.rotation.y = -0.35;
    var boss = peca(g, new THREE.SphereGeometry(0.1, 8, 6), m.ouro, -0.76, 1.55, 0.18);
    boss.scale.x = 0.5;
    peca(g, cilSede(0.045, 0.045, 3.3, 6), m.madeiraEsc, 0.78, 0.28 + 1.65, 0.05);
    peca(g, caixaSede(0.05, 0.52, 0.36, 0.78, 3.28, 0.22), m.metal);
    peca(g, new THREE.ConeGeometry(0.06, 0.4, 6), m.metal, 0.78, 3.78, 0.05);
    return g;
  }
  /* A MESA DO CONSELHO (5×3, BAIXA): um tampo só de 9×3,6 m a 0,85 m, com a toalha, o mapa,
   * dois candelabros baixos, as taças e os dois bancos corridos dentro da pegada. O mais
   * alto é a chama do candelabro, a 1,2 m: um herói vê por cima da mesa inteira. */
  function mesaDaSede(L, P, m) {
    var g = new THREE.Group();
    var tl = L - 1.0, tp = Math.min(3.6, P - 2.2);
    peca(g, caixaSede(tl, 0.14, tp, 0, 0.78, 0), m.madeira);
    peca(g, caixaSede(tl - 0.3, 0.16, tp - 0.3, 0, 0.64, 0), m.madeiraEsc);
    [-1, 0, 1].forEach(function (i) {
      [-1, 1].forEach(function (s) { peca(g, caixaSede(0.24, 0.58, 0.24, i * (tl / 2 - 0.45), 0.29, s * (tp / 2 - 0.3)), m.madeiraEsc); });
    });
    peca(g, caixaSede(tl - 1.0, 0.02, 1.1, 0, 0.86, 0), m.pano);
    [-0.55, 0.55].forEach(function (pz) { peca(g, caixaSede(tl - 1.0, 0.024, 0.07, 0, 0.862, pz), m.ouro); });
    var mapa = peca(g, caixaSede(1.7, 0.012, 1.15, 0.3, 0.88, 0.1), m.pergaminho);
    mapa.rotation.y = 0.12;
    [-1, 1].forEach(function (s) {
      var cx = s * tl * 0.3;
      peca(g, cilSede(0.14, 0.2, 0.06, 10), m.ouro, cx, 0.88, 0);
      // candelabro baixo (15/09: a 1,3 m ele encostava no teto da cobertura baixa; agora 1,19)
      peca(g, cilSede(0.03, 0.03, 0.12, 6), m.ouro, cx, 0.96, 0);
      peca(g, caixaSede(0.46, 0.04, 0.05, cx, 1.02, 0), m.ouro);
      [-0.21, 0, 0.21].forEach(function (dx) {
        peca(g, cilSede(0.035, 0.035, 0.08, 6), m.marmore, cx + dx, 1.08, 0);
        var ch = peca(g, new THREE.ConeGeometry(0.03, 0.07, 6), m.chama, cx + dx, 1.155, 0);
        ch.castShadow = false;
      });
      peca(g, cilSede(0.06, 0.04, 0.14, 8), m.ouro, s * tl * 0.12, 0.92, s * 0.9);
      peca(g, cilSede(0.06, 0.04, 0.14, 8), m.ouro, -s * tl * 0.38, 0.92, s * 1.1);
      // o banco corrido do lado comprido
      var bz = s * (tp / 2 + 0.75);
      peca(g, caixaSede(tl - 0.6, 0.1, 0.5, 0, 0.46, bz), m.madeira);
      [-1, 0, 1].forEach(function (i) { peca(g, caixaSede(0.14, 0.41, 0.42, i * (tl / 2 - 0.8), 0.205, bz), m.madeiraEsc); });
    });
    return g;
  }
  // O BANCO DO SALÃO (baixo): assento de tábua, dois pés e a travessa — 0,51 m
  function bancoDaSede(m) {
    var g = new THREE.Group();
    peca(g, caixaSede(1.75, 0.1, 0.56, 0, 0.46, 0), m.madeira);
    [-0.7, 0.7].forEach(function (px) { peca(g, caixaSede(0.13, 0.41, 0.46, px, 0.205, 0), m.madeiraEsc); });
    peca(g, caixaSede(1.3, 0.08, 0.08, 0, 0.16, 0), m.madeiraEsc);
    return g;
  }
  // A ESTÁTUA (baixa): o busto do fundador num plinto — 1,2 m no topo da cabeça
  function estatuaDaSede(m) {
    var g = new THREE.Group();
    peca(g, caixaSede(0.92, 0.5, 0.92, 0, 0.25, 0), m.pedraClara);
    peca(g, caixaSede(1.02, 0.08, 1.02, 0, 0.54, 0), m.pedraEsc);
    peca(g, caixaSede(0.66, 0.24, 0.34, 0, 0.7, 0), m.marmore);
    peca(g, cilSede(0.26, 0.33, 0.12, 10), m.marmore, 0, 0.62, 0);
    peca(g, cilSede(0.08, 0.09, 0.12, 8), m.marmore, 0, 0.88, 0);
    var cab = peca(g, new THREE.SphereGeometry(0.17, 12, 10), m.marmore, 0, 1.03, 0.02);
    cab.scale.y = 1.12;
    return g;
  }
  // O BAÚ (baixo): corpo de madeira, tampa redonda, cintas de ferro e o fecho de ouro — 0,9 m
  function bauDaSede(m) {
    var g = new THREE.Group();
    peca(g, caixaSede(1.2, 0.52, 0.76, 0, 0.26, 0), m.madeira);
    var tampa = new THREE.CylinderGeometry(0.38, 0.38, 1.22, 14, 1, false, 0, Math.PI);
    tampa.rotateZ(Math.PI / 2);                            // o eixo em x, a meia-cana para cima
    peca(g, tampa, m.madeiraEsc, 0, 0.52, 0);
    [-0.42, 0.42].forEach(function (px) {
      peca(g, caixaSede(0.08, 0.54, 0.79, px, 0.27, 0), m.ferro);
      var cinta = new THREE.CylinderGeometry(0.395, 0.395, 0.08, 14, 1, false, 0, Math.PI);
      cinta.rotateZ(Math.PI / 2);
      peca(g, cinta, m.ferro, px, 0.52, 0);
    });
    peca(g, caixaSede(0.16, 0.2, 0.05, 0, 0.5, 0.39), m.ouro);
    return g;
  }
  /* A LAREIRA (1×3 na parede lateral, alta). Frente = +z local, parede em −z, comprimento em
   * x (6 m). Três partes que vivem em lugares diferentes:
   *   · `no` — o lastro, a moldura de pedra com a boca, o consolo de madeira e a lenha:
   *     estático, fundido com o resto da sala;
   *   · `chamine` — o peito da chaminé do consolo até o alto da parede: segue o RECORTE da
   *     parede em que está encostada (sem isto a lareira do lado da câmera apagava duas casas
   *     de nascimento);
   *   · `vivo` — o fogo (cones que tremem) e a LUZ PONTUAL quente. É uma PointLight por
   *     lareira: com as 6 do FX e a do evento de chão, o salão fica em 8 a 9 luzes, que é o
   *     que os calabouços com evento já usam; e ela nasce UMA vez por montagem (o número de
   *     luzes não muda no meio da luta, então o shader não recompila). */
  var SEDE_LUZ = { cor: '#ff9448', intensidade: 3.2, alcance: 20 };
  function lareiraDaSede(L, m, ctx) {
    var g = new THREE.Group(), cham = new THREE.Group(), vivo = new THREE.Group();
    var H = SEDE_PAREDE_H;
    var boca = 2.4, lado = (L - 0.2 - boca) / 2;
    peca(g, caixaSede(L - 0.1, 0.22, 1.9, 0, 0.11, -0.05), m.pedraClara);
    [-1, 1].forEach(function (s) {
      peca(g, caixaSede(lado, 1.95, 1.4, s * (boca / 2 + lado / 2), 0.975, -0.3), m.pedra);
    });
    peca(g, caixaSede(boca, 0.5, 1.4, 0, 1.95 - 0.25, -0.3), m.pedra);
    peca(g, caixaSede(boca, 1.45, 0.3, 0, 0.72, -0.85), m.fuligem);
    peca(g, caixaSede(L - 0.1, 0.24, 1.75, 0, 2.07, -0.15), m.madeiraEsc);                      // o consolo
    [-0.35, 0.35].forEach(function (px) {
      var lenha = peca(g, cilSede(0.13, 0.13, 1.5, 8), m.madeiraEsc, px * 0.4, 0.34, -0.35 + px * 0.2);
      lenha.rotation.z = Math.PI / 2; lenha.rotation.y = px;
    });
    // a chaminé
    peca(cham, caixaSede(L * 0.72, H - 2.19, 1.3, 0, 2.19 + (H - 2.19) / 2, -0.35), m.pedra);
    peca(cham, caixaSede(L * 0.74, 0.14, 1.36, 0, 3.1, -0.33), m.pedraEsc);
    // o fogo: cones laranja por fora e amarelos por dentro, aditivos (a luz vem do brilho)
    var cache = ctx.cache;
    if (!cache['sede-fogo-f']) {
      cache['sede-fogo-f'] = new THREE.MeshBasicMaterial({ color: col3('#ff6a1a'), transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false });
      cache['sede-fogo-d'] = new THREE.MeshBasicMaterial({ color: col3('#ffd070'), transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false });
    }
    var chamas = [[-0.5, 0.95, 0.34, 'f'], [0.05, 1.25, 0.4, 'f'], [0.55, 0.9, 0.3, 'f'],
                  [-0.22, 0.7, 0.22, 'd'], [0.28, 0.8, 0.22, 'd']];
    chamas.forEach(function (c2, i) {
      var cone = new THREE.Mesh(new THREE.ConeGeometry(c2[2], c2[1], 8), cache['sede-fogo-' + c2[3]]);
      cone.geometry.translate(0, c2[1] / 2, 0);             // cresce do pé: a escala sobe a chama
      cone.position.set(c2[0], 0.4, -0.4);
      cone.renderOrder = 4;
      vivo.add(cone);
      ctx.fogos.push({ no: cone, ph: i * 1.7 + ctx.fogos.length * 0.9 });
    });
    var K = kit();
    if (K && K.makeHalo) {
      try { var hl = K.makeHalo('#ff8a3c', 3.4, 0.55); hl.position.set(0, 1.0, -0.2); vivo.add(hl); } catch (eH) {}
    }
    var luz = new THREE.PointLight(col3(SEDE_LUZ.cor), SEDE_LUZ.intensidade, SEDE_LUZ.alcance, 2);
    luz.position.set(0, 1.35, 1.1);
    vivo.add(luz);
    ctx.luzes.push({ l: luz, base: SEDE_LUZ.intensidade, ph: ctx.luzes.length * 2.3 });
    return { no: g, chamine: cham, vivo: vivo };
  }

  /* Monta UMA peça do salão no centro da pegada, girada de 90 em 90° para o meio da sala (o
   * comprimento sempre no maior lado da pegada) e anota no relatório: o papel, a ALTURA
   * medida depois de montada (a prova confere a regra alto/baixo com ela) e que é primitiva. */
  function montaPecaDaSede(st, pc, ctx) {
    var rel = ctx.rel, m = matsSede(ctx.cache), papel = pc.papel;
    if (papel === 'parede_salao') {
      paredesDoSalao(st, pc, ctx);
      rel.papeis[papel] = (rel.papeis[papel] || 0) + 1;
      return null;
    }
    var wC = pc.w || 1, hC = pc.h || 1;
    var cxC = pc.x + (wC - 1) / 2, cyC = pc.y + (hC - 1) / 2;
    var mx = (gridW - 1) / 2, my = (gridH - 1) / 2;
    var rot = Math.round(Math.atan2(mx - cxC, my - cyC) / (Math.PI / 2)) * (Math.PI / 2);
    var deLado = Math.abs(Math.sin(rot)) > 0.5;
    if (hC > wC && !deLado) rot = (cxC <= mx) ? Math.PI / 2 : -Math.PI / 2;
    if (wC > hC && deLado) rot = (cyC <= my) ? 0 : Math.PI;
    var L = Math.max(wC, hC) * CELL, P = Math.min(wC, hC) * CELL;
    var no = null, extra = null;
    if (papel === 'trono') no = tronoDaSede(L, m);
    else if (papel === 'estandarte') no = estandarteDaSede(cxC < mx ? 'oeste' : 'leste', m, ctx.cache);
    else if (papel === 'pilar') no = pilarDaSede(m);
    else if (papel === 'armadura') no = armaduraDaSede(m);
    else if (papel === 'mesa') no = mesaDaSede(L, P, m);
    else if (papel === 'banco_salao') no = bancoDaSede(m);
    else if (papel === 'estatua') no = estatuaDaSede(m);
    else if (papel === 'bau') no = bauDaSede(m);
    else if (papel === 'lareira') { extra = lareiraDaSede(L, m, ctx); no = extra.no; }
    if (!no) return null;
    var px = cxC * CELL, pz = cyC * CELL;
    no.rotation.y = rot;
    no.position.set(px, 0, pz);
    no.updateMatrixWorld(true);
    var alt = new THREE.Box3().setFromObject(no).max.y;
    if (extra) {
      [extra.chamine, extra.vivo].forEach(function (parte) { parte.rotation.y = rot; parte.position.set(px, 0, pz); });
      extra.chamine.updateMatrixWorld(true);
      alt = Math.max(alt, new THREE.Box3().setFromObject(extra.chamine).max.y);
      // a parede atrás da lareira é a oposta à frente dela: é o recorte dessa parede que manda
      var fx = Math.round(Math.sin(rot)), fz = Math.round(Math.cos(rot));
      var ladoParede = fx > 0 ? 'oeste' : fx < 0 ? 'leste' : fz > 0 ? 'norte' : 'sul';
      ctx.vivos.push(extra.chamine, extra.vivo);
      ctx.cortes.push({ lados: [ladoParede], alta: extra.chamine, baixa: null });
    }
    rel.papeis[papel] = (rel.papeis[papel] || 0) + 1;
    rel.alturas[papel] = Math.max(rel.alturas[papel] || 0, +alt.toFixed(2));
    if (rel.provisorias.indexOf(papel) < 0) rel.provisorias.push(papel);
    return no;
  }

  /* O QUE O SALÃO ANIMA A CADA QUADRO: o fogo e a luz das lareiras tremem (duas senoides
   * fora de fase, sem sorteio — o quadro é determinístico), e cada parede escolhe a versão
   * inteira ou a cortada pelo lado de onde a câmera olha. `sedeVivo` é trocado a cada
   * montagem: sala sem salão tem as listas vazias e isto não custa nada. */
  var sedeVivo = { fogos: [], luzes: [], cortes: [] };
  var sedeLadoCam = { norte: false, sul: false, oeste: false, leste: false };
  function animaSede(t) {
    var sv = sedeVivo, i;
    if (!sv.cortes.length && !sv.fogos.length) return;
    var sx = Math.sin(cam.ang), cz = Math.cos(cam.ang);
    // câmera em +z olha o salão por cima da parede SUL; em −x, por cima da OESTE
    sedeLadoCam.sul = cz > 0.2; sedeLadoCam.norte = cz < -0.2;
    sedeLadoCam.leste = sx > 0.2; sedeLadoCam.oeste = sx < -0.2;
    for (i = 0; i < sv.cortes.length; i++) {
      var c = sv.cortes[i], corta = true;
      for (var j = 0; j < c.lados.length; j++) if (!sedeLadoCam[c.lados[j]]) { corta = false; break; }
      c.alta.visible = !corta;
      if (c.baixa) c.baixa.visible = corta;
    }
    for (i = 0; i < sv.fogos.length; i++) {
      var f = sv.fogos[i];
      var k = 0.84 + 0.12 * Math.sin(t * 8.3 + f.ph) + 0.07 * Math.sin(t * 19.1 + f.ph * 1.7);
      f.no.scale.set(0.94 + 0.06 * Math.sin(t * 5.2 + f.ph), k, 0.94 + 0.06 * Math.cos(t * 6.1 + f.ph));
    }
    for (i = 0; i < sv.luzes.length; i++) {
      var lz = sv.luzes[i];
      lz.l.intensity = lz.base * (0.86 + 0.09 * Math.sin(t * 7.3 + lz.ph) + 0.05 * Math.sin(t * 17.9 + lz.ph));
    }
  }
  // para a prova: o estado do recorte e do fogo, sem expor os nós
  R._sedeVivo = function () {
    return {
      cortes: sedeVivo.cortes.map(function (c) { return { lados: c.lados.slice(), cortado: !c.alta.visible }; }),
      fogo: sedeVivo.fogos.length ? +sedeVivo.fogos[0].no.scale.y.toFixed(4) : null,
      luzes: sedeVivo.luzes.length
    };
  };
  R.SEDE_PAREDE_H = SEDE_PAREDE_H;

  function buildBoardKit(st, pal, theme) {
    var K = kit();
    if (!K) return false;
    var w = gridW, h = gridH;
    // 14/09: a praça tática — o que cada bloco é (arenas.js `pecas`) e o chão da praça
    var pecasSala = pecasDaSala(st, theme);
    var praca = theme === 'praca';
    // 15/09: o Salão da Sede — mesmo caminho da praça, com as peças e o chão do salão
    var sede = theme === 'sede' && !!pecasSala;
    var temaProprio = praca || sede;
    var casaDaPeca = {};
    if (pecasSala) {
      pecasSala.forEach(function (pc) {
        var pw0 = pc.w || 1, ph0 = pc.h || 1;
        for (var py = 0; py < ph0; py++) for (var px = 0; px < pw0; px++) {
          // a parede do salão só VESTE o contorno da pegada; o miolo é o salão e tem peça própria
          if (pc.papel === 'parede_salao' && px > 0 && py > 0 && px < pw0 - 1 && py < ph0 - 1) continue;
          if (pc.papel === 'parede_salao' && casaDaPeca[(pc.x + px) + ',' + (pc.y + py)]) continue;
          casaDaPeca[(pc.x + px) + ',' + (pc.y + py)] = pc;
        }
      });
    }
    var matsPraca = {};
    var relPraca = pecasSala ? { tema: sede ? 'sede' : 'praca', papeis: {}, obras: {}, pendentes: [], altoSemPeca: 0, baixoSemPeca: 0,
                                 casasCobertas: 0, arvore: null } : null;
    var ctxSede = null;
    sedeVivo = { fogos: [], luzes: [], cortes: [] };     // a animação da sala velha sai junto
    if (sede) {
      relPraca.alturas = {}; relPraca.provisorias = []; relPraca.paredes = 0; relPraca.tochas = 0;
      relPraca.portas = 0; relPraca.tapete = null; relPraca.erros = [];
      ctxSede = { cache: matsPraca, rel: relPraca, vivos: [], cortes: [], fogos: [], luzes: [] };
    }
    pracaEspera++;                        // montagem nova: a espera da anterior para
    var envG = new THREE.Group();
    envG.name = 'envkit';
    // o kit da v1 nasce com a célula (0,0) na origem; o nosso mundo é centrado
    envG.position.set(-(w - 1) / 2 * CELL, 0, -(h - 1) / 2 * CELL);

    var staticG = new THREE.Group();
    // CHAO ESTENDIDO: o campo tem de ser um LUGAR. O chao da v1 nasce escuro
    // demais para a luz nova, e props apoiados nele pareciam boiar no vazio.
    try {
      if (praca) {
        // 14/09: lajotas da praça no jogável, grama baixa no '~' (chaoDaPraca)
        staticG.add(chaoDaPraca(st, w, h, matsPraca));
      } else if (sede) {
        // 15/09: tábuas, a soleira da porta e o tapete até o trono (chaoDaSede)
        staticG.add(chaoDaSede(st, w, h, matsPraca, pecasSala, relPraca));
      } else {
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
      }
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

    // O MARCO: a peça que só existe UMA vez por sala.
    //
    // Regra do Daniel para o aquário da Cisterna: "o item que é um aquário deve
    // ficar em somente um por sala". `sotaque_alto` não serve — ele entra uma
    // vez POR TRECHO, e uma sala tem vários trechos de muro. Então o papel
    // `marco` pega a PRIMEIRA casa de sotaque da varredura e trava. A varredura
    // é y depois x, sempre na mesma ordem, e a casa de sotaque sai da semente
    // da fileira — mesma sala, mesmo lugar, toda vez. Tema sem `marco` no
    // catálogo (o jardim) cai no sotaque comum e nada muda.
    var marcoPosto = false;

    // O RELATÓRIO DA MONTAGEM, para o teste. Varrer a cena depois não serve:
    // as malhas estáticas são FUNDIDAS por material e os berços somem no
    // merge. Quem sabe quantas vezes cada peça entrou é quem as pôs — então o
    // montador anota e expõe, e a prova da regra do marco lê daqui.
    var usoPecas = {};
    function anota(no) {
      var ch = no && no.userData && no.userData.chave;
      if (ch) usoPecas[ch] = (usoPecas[ch] || 0) + 1;
    }

    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var k = tileKind(gridTile(st, x, y));
      var seed = hashXY(x, y);
      var node = null;
      var naBorda = (x === 0 || y === 0 || x === w - 1 || y === h - 1);
      // 14/09: casa vestida por uma peça da praça não ganha muro (a peça monta depois
      // do laço, uma vez por pegada); na praça o chão já veio inteiro no chaoDaPraca
      if (relPraca && (k === 'high' || k === 'low')) {
        if (casaDaPeca[x + ',' + y]) { relPraca.casasCobertas++; continue; }
        if (k === 'high') relPraca.altoSemPeca++; else relPraca.baixoSemPeca++;
      }
      if (temaProprio && k !== 'high' && k !== 'low') continue;
      if (k === 'high') {
        // A BORDA TAMBÉM É DELE AGORA.
        //
        // Antes eu deixava a moldura com a parede do acervo, com medo de que
        // peça solta abrisse buraco no muro da sala. Mas o Daniel fez MÓDULOS de
        // muro justamente para enfileirar, e ele pediu: "substitui todos os da
        // lateral". Então a borda usa as peças dele, e a continuidade vem de
        // duas coisas — a peça é a mesma ao longo de todo o trecho, e ela gira
        // para o eixo do trecho, senão a face fica de lado e aparece vão.
        //
        // `fileiraDe` serve para os dois casos: numa borda o trecho corre pela
        // aresta, no miolo corre pelo `##`. A conta é a mesma.
        var filaA = fileiraDe(st, x, y, isWall);
        // A GRAMÁTICA DA PAREDE: muro, muro, PILAR, muro, muro.
        //
        // O pilar pontua, não constrói — uma parede feita só de pilares vira
        // colunata, que foi o que o Daniel viu. E o enfeite alto (estátua,
        // coluna de vidro) entra UMA vez por trecho longo, pelo mesmo motivo do
        // sotaque de baixo: dois enfeites iguais colados ficam estranhos.
        var col = null;
        var ehMarco = false;
        if (ehSotaque(filaA)) {
          if (!marcoPosto) {
            // O TETO LARGO E DELIBERADO: o aquário é um tanque mais largo que
            // alto (razão ~1,6). Com o teto padrão de 0,95 casa ele encolhia a
            // 1,2 m — porte de móvel. A 1,7 casas ele sai com ~2,1 m de altura
            // e lê como a vitrine monumental que o marco pede.
            col = pecaUsuario(theme, 'marco', filaA.semente + filaA.i * 7, WALL_H, CELL * 1.7);
            if (col) { marcoPosto = true; ehMarco = true; }
          }
          if (!col) col = pecaUsuario(theme, 'sotaque_alto', filaA.semente + filaA.i * 7, WALL_H);
        }
        if (!col && filaA.comp >= 3 && (filaA.i % 4) === 2) {
          // O PILAR PELO MESMO CAMINHO, senao fica 34 cm abaixo dos muros.
          //
          // Ele e o unico alto com proporcao de coisa alta (razao 0,69), entao
          // quase nao estica — mas o teto de largura antigo o parava em 2,76 m,
          // e num trecho de parede uniforme 34 cm de diferenca aparecem.
          // O PILAR FICA EM UMA CASA, e não em `LARG_MURO`. Ele tem razão
          // 0,69 — proporção de coisa alta — e a uma casa já sai com 1,07× de
          // esticão, praticamente sem distorção. Alargá-lo o viraria um bloco,
          // e pilar existe para NÃO ser bloco: ele pontua a parede.
          col = muroDaCasa(theme, 'pilar', filaA.semente, WALL_H, CELL);
        }
        // TODO MURO COM A MESMA ALTURA, E ALTO — em fiadas.
        //
        // Antes o teto de LARGURA mandava na ALTURA: os quatro módulos têm
        // razões diferentes (1,45 a 2,25), então o mesmo teto devolvia alturas
        // de 1,78 a 2,76 m, e na ponta de um trecho o teto caía pela metade e o
        // muro encolhia mais. Era isso o "um do tamanho de um vaso".
        //
        // Agora a largura vale sempre uma casa e a ALTURA é fixa, obtida
        // aumentando a peça (ver `muroDaCasa`). Não há mais caso de ponta:
        // ponta e miolo têm exatamente a mesma medida, que é o pedido.
        if (!col) col = muroDaCasa(theme, 'alto', filaA.semente, WALL_H, LARG_MURO);
        if (col) {
          node = col;
          anota(col);
          // só o MURO gira para o eixo do trecho; pilar é simétrico e sotaque é
          // objeto largado ali — girar o faria parecer parte da alvenaria.
          // O MARCO gira JUNTO com a parede: o aquário é vitrine embutida no
          // muro, e atravessado ele invadiria a sala.
          if (filaA.eixo === 'z' && filaA.comp > 1 && (!ehSotaque(filaA) || ehMarco)) {
            col.rotation.y = Math.PI / 2;
          }
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
        node = temaProprio ? null : K.buildTile(theme, ((x + y) % 2) ? 'floor2' : 'floor1', seed % 97);
        // A peça sai da FILEIRA, não da casa: cinco casas seguidas usam a mesma
        // e leem como uma barreira só. Sorteando por casa, uma corrida de cinco
        // virava cinco objetos diferentes — entulho, não divisória.
        var fila = fileiraDe(st, x, y, isLow);
        // ALTURA NORMALIZADA: o obstaculo tem de ler como "da para ver por
        // cima" e nunca competir com uma unidade (heroi ~2,05 de altura).
        var prop = null;
        if (ehSotaque(fila)) {
          // a semente do SOTAQUE muda com a posição, senão toda fileira da sala
          // escolheria o mesmo enfeite e o charme viraria padrão
          prop = pecaUsuario(theme, 'sotaque', fila.semente + fila.i * 7, 0.95);
        }
        // A MURETA pelo mesmo caminho do muro, mirando LOW_H.
        //
        // `alto` e `baixo` dividem os mesmos quatro módulos. Antes o baixo era
        // a arte de muro achatada a 0,95 m com o teto de LARGURA mandando na
        // altura, e saía irregular. Agora a largura é sempre de uma casa e a
        // altura é sempre LOW_H — o que de quebra fecha o vão de ~60 cm que o
        // «muro tomado pelo mato» deixava numa corrida. Como estes módulos já
        // são baixos por natureza, aqui quase não há esticão: é o muro ALTO que
        // paga esse preço.
        if (!prop) prop = muroDaCasa(theme, 'baixo', fila.semente, LOW_H, LARG_MURO);
        if (!prop) {
          prop = K.buildProp(theme, lowKinds[fila.semente % lowKinds.length], fila.semente);
          fitHeight(prop, 0.95);
        }
        anota(prop);
        prop.position.set(x * CELL, 0, y * CELL);
        // GIRA PARA O EIXO DA FILEIRA. Uma peça mais larga que funda, posta numa
        // corrida vertical sem girar, deixa vão entre uma casa e a seguinte — a
        // barreira fica furada justamente onde devia barrar.
        // O MURO gira para o eixo da fileira; o SOTAQUE não. Ele é um objeto
        // largado ali, e girar junto o faria parecer parte da alvenaria.
        if (fila.eixo === 'z' && fila.comp > 1 && !ehSotaque(fila)) {
          prop.rotation.y = Math.PI / 2;
        }
        lowNodes.push({ node: prop, x: x, y: y });
      } else if (k === 'deco') {
        node = K.buildTile(theme, 'deco', seed % 4);
        // o enfeite de piso do usuário vai POR CIMA do ladrilho, sem colisão.
        // A ALTURA vem do catálogo (`chao_alt`) quando o tema declara: os 25 cm
        // do jardim servem para flor e cristal, mas o lustre caído e o barril
        // tombado da Cisterna a 25 cm viravam miniatura de brinquedo.
        var catChao = JOGO.CENARIO && JOGO.CENARIO[theme];
        var enf = pecaUsuario(theme, 'chao', seed, (catChao && catChao.chao_alt) || 0.25);
        if (enf) { anota(enf); enf.position.set(x * CELL, 0.02, y * CELL); lowNodes.push({ node: enf, x: x, y: y }); }
      } else {
        node = K.buildTile(theme, ((x + y) % 2) ? 'floor2' : 'floor1', seed % 97);
      }
      if (node) { node.position.set(x * CELL, 0, y * CELL); staticG.add(node); }
    }
    for (var L = 0; L < lowNodes.length; L++) staticG.add(lowNodes[L].node);

    // 14/09: as peças da praça, uma por pegada
    if (pecasSala) {
      for (var pq = 0; pq < pecasSala.length; pq++) {
        var noPeca = null;
        try {
          noPeca = sede ? montaPecaDaSede(st, pecasSala[pq], ctxSede)
                        : montaPecaDaPraca(pecasSala[pq], pecasSala, matsPraca, relPraca);
        } catch (eP) {
          noPeca = null;
          if (sede) relPraca.erros.push(pecasSala[pq].papel + ': ' + (eP && eP.message));
        }
        if (noPeca) staticG.add(noPeca);
        if (noPeca && !sede) {
          var chPeca = 'praca:' + pecasSala[pq].papel;
          usoPecas[chPeca] = (usoPecas[chPeca] || 0) + 1;
        }
      }
      // 15/09: no salão a contagem vem do relatório (a parede monta fora do staticG)
      if (sede) for (var ps in relPraca.papeis) if (relPraca.papeis.hasOwnProperty(ps)) usoPecas['sede:' + ps] = relPraca.papeis[ps];
    }

    // props de borda: o campo é um LUGAR, não um diorama solto no vazio
    // Props de borda: encostados na arena (nunca boiando no horizonte), com
    // altura normalizada e um disco de contato que os assenta no chao.
    // 14/09: na praça NÃO — o mundo em volta é o gramado da própria praça, e os troncos
    // e colunas do jardim espalhados em volta davam cara de estufa ao mapa
    // 15/09: no salão também não — fora da parede é breu
    var padPos = [];
    if (!temaProprio) try {
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
        // 0,85–1,75 m -> 2,2–4,6 m. Estes props ficam FORA da arena, a duas ou
        // três casas de distância, e a perspectiva os encolhe ainda mais. No
        // porte antigo a escada de podar aparecia do tamanho de um prego ao lado
        // de uma parede de 3,10 m — foi a reclamação do Daniel, e ele tem razão.
        // Cenário de fundo pode e deve ser MAIOR que a arquitetura da sala: é o
        // que dá a sensação de que o campo está dentro de um lugar maior.
        var altBorda = 2.2 + ((hashXY(p, 5) % 100) / 100) * 2.4;
        // fora da arena não há casa para respeitar, então o teto de largura sobe
        // junto — senão uma árvore larga voltaria a ser estrangulada em altura.
        var tetoBorda = altBorda * 1.6;
        var prop2 = pecaUsuario(theme, 'borda', p * 131 + 17, altBorda, tetoBorda);
        if (!prop2) {
          prop2 = K.buildProp(theme, kinds[(p * 7 + rr++) % kinds.length], p * 131 + 17);
          fitHeight(prop2, altBorda, tetoBorda);
        }
        anota(prop2);
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
    // 15/09: o que o salão mexe fora do merge — as duas versões de cada parede, a chaminé
    // e o fogo com a luz das lareiras — e a lista que o laço de render anima
    if (ctxSede) {
      for (var vv = 0; vv < ctxSede.vivos.length; vv++) envG.add(ctxSede.vivos[vv]);
      sedeVivo = { fogos: ctxSede.fogos, luzes: ctxSede.luzes, cortes: ctxSede.cortes };
      relPraca.luzes = ctxSede.luzes.length;
      relPraca.fogos = ctxSede.fogos.length;
      relPraca.cortes = ctxSede.cortes.length;
      animaSede(nowT);                    // o primeiro quadro já sai com o recorte certo
    }
    try {
      if (K.buildGridLines) envG.add(K.buildGridLines(theme, w, h));
      if (K.buildBrazier && !temaProprio) {  // 14/09: a praça é de dia; 15/09: o salão tem lareira
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
    // o relatório fica exposto DEPOIS de a sala inteira montar, nunca no meio:
    // teste que lesse um parcial acharia um aquário "faltando" que ainda vinha.
    R.ultimaMontagem = usoPecas;
    // 14/09: o relatório da praça tática (null sem `pecas`) — e a arte que faltou, pedida
    // 15/09: UM RELATÓRIO POR TEMA — o da praça só na praça, o do salão só no salão, e
    // `ultimaMontagemTema` o da sala atual (com `tema`), para quem não sabe qual pedir
    R.ultimaMontagemPraca = (relPraca && !sede) ? relPraca : null;
    R.ultimaMontagemSede = sede ? relPraca : null;
    R.ultimaMontagemTema = relPraca;
    if (relPraca && !sede && relPraca.pendentes.length) esperaObrasDaPraca(relPraca.pendentes);
    return true;
  }

  function buildBoard(st) {
    clearBoard();
    moldura.jaAjustou = false;          // sala nova: vale reenquadrar de novo
    gridW = st.grid.w; gridH = st.grid.h;
    var pal0 = paletteOf(st), theme0 = themeOf(st);
    applyTheme(ambienteDaSala(st, theme0));
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
    applyTheme(ambienteDaSala(st, theme));

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

  /* ------------------------------------------- O AJUSTE DOS MAPAS DE DUELO (15/09)
   * Os CALABOUÇOS ficam com o enquadramento de sempre (o de baixo, em fitCamera): o dono
   * comparou as fotos e a sala inteira espremida na área útil virava miniatura — a borda de
   * baixo sumir atrás da barra é um incômodo pequeno, o jogador gira e afasta.
   *
   * Nos MAPAS DE DUELO E GUERRA (DATA.arenas: a praça e o salão da sede) a luta começa com
   * os dois lados nos nascimentos, perto das bordas, e o enquadramento de sempre deixava a
   * dupla do oeste debaixo da barra de feitiços. Aqui se parte do MESMO enquadramento e se
   * faz só um ajuste leve, nesta ordem de preferência:
   *   1. deslizar o pivô (para cima da tela e de lado) até cada nascimento — pés, cabeça e os
   *      lados do corpo — cair no canvas, acima da barra de baixo e fora do cartão da unidade;
   *   2. se não couber, girar o azimute para o eixo comprido do mapa ficar na horizontal da
   *      tela (tentando de novo o deslize);
   *   3. só então afastar, de 1 em 1%, até no máximo 15% além da distância de sempre.
   * Não coube nem assim: fica o que deixa MENOS pixel de fora, a 15%.
   *
   * A HUD é medida na página (a barra de baixo e o cartão da unidade; sem a tela de batalha,
   * frações da HUD de mesa medida em 1262×704) e a medida guarda a MAIOR obstrução vista na
   * sala: o vigia do laço só reajusta quando ela cresce (o botão de fundir aparece), e a
   * câmera não muda a cada troca de turno. No celular (moldura ligada) nada disto roda. */
  var hudMemo = null, hudSig = '', enquadro = null;
  function ehMapaDeDuelo(st) {
    var D = DATA();
    if (!st || !D.arenas) return false;
    // 02/10: a Câmara do Eco mora em DATA.arenas mas é PvE — o enquadramento é o de calabouço
    for (var i = 0; i < D.arenas.length; i++) {
      if (D.arenas[i] && D.arenas[i].id === st.dungeonId) return D.arenas[i].modo !== 'eco';
    }
    return false;
  }
  function medeHudDuelo() {
    var cr = (canvas && canvas.getBoundingClientRect) ? canvas.getBoundingClientRect() : null;
    var tela = (typeof document !== 'undefined') ? document.querySelector('.screen-battle.is-on') : null;
    var a;
    if (cr && tela) {
      var caixa = function (sel) {
        var e = tela.querySelector(sel);
        if (!e) return null;
        var r = e.getBoundingClientRect();
        if (!(r.width > 2 && r.height > 2)) return null;
        return { x0: r.left - cr.left, y0: r.top - cr.top, x1: r.right - cr.left, y1: r.bottom - cr.top };
      };
      var bb = caixa('.bt-bottom');
      a = { base: bb ? bb.y0 : H, cartao: caixa('.bt-left'), medida: true, W: W, H: H };
      if (hudMemo && hudMemo.W === W && hudMemo.H === H) {
        a.base = Math.min(a.base, hudMemo.base);
        var c0 = hudMemo.cartao;
        if (c0) a.cartao = a.cartao ? { x0: Math.min(a.cartao.x0, c0.x0), y0: Math.min(a.cartao.y0, c0.y0),
                                        x1: Math.max(a.cartao.x1, c0.x1), y1: Math.max(a.cartao.y1, c0.y1) } : c0;
      }
      hudMemo = a;
    } else {
      a = { base: H * 0.79, cartao: { x0: W * 0.04, y0: H * 0.16, x1: W * 0.21, y1: H * 0.30 }, medida: false, W: W, H: H };
    }
    a.sig = [W, H, Math.round(a.base), a.cartao ? Math.round(a.cartao.x1) + 'x' + Math.round(a.cartao.y1) : '-'].join('|');
    return a;
  }
  // os nascimentos: as letras de lado do mapa (P e a) e os heróis que estão de pé nele
  function pontosDosNascimentos(st) {
    var casas = {}, lista = [];
    var dg = dungeonOf(st), room = dg && dg.rooms && dg.rooms[st.roomIndex];
    if (room && room.layout) {
      room.layout.forEach(function (linha, y) {
        for (var x = 0; x < linha.length; x++) {
          var ch = linha.charAt(x);
          if (ch === 'P' || ch === 'a') casas[x + ',' + y] = [x, y];
        }
      });
    }
    (st.units || []).forEach(function (u) {
      if (u && u.kind === 'hero' && u.alive && !u.offBoard) casas[u.x + ',' + u.y] = [u.x, u.y];
    });
    Object.keys(casas).forEach(function (k) {
      var c = casas[k], cx = wx(c[0]), cz = wz(c[1]);
      lista.push(new THREE.Vector3(cx, 0.05, cz), new THREE.Vector3(cx, 2.1, cz),
                 new THREE.Vector3(cx - 0.55, 1.1, cz), new THREE.Vector3(cx + 0.55, 1.1, cz),
                 new THREE.Vector3(cx, 1.1, cz - 0.55), new THREE.Vector3(cx, 1.1, cz + 0.55));
    });
    return lista;
  }
  // quantos pixels dos nascimentos ficam fora (canvas, barra de baixo, cartão) com esta câmera
  var vDuelo = null;
  function sobraDosNascimentos(pts, hud, d, ang, px, pz) {
    var sT = Math.sin(cam.tilt), cT = Math.cos(cam.tilt), M0 = 8;
    camera.position.set(cam.pivot.x + px + Math.sin(ang) * sT * d, cam.pivot.y + cT * d,
                        cam.pivot.z + pz + Math.cos(ang) * sT * d);
    camera.lookAt(cam.pivot.x + px, cam.pivot.y, cam.pivot.z + pz);
    camera.updateMatrixWorld(true);
    if (!vDuelo) vDuelo = new THREE.Vector3();
    var fora = 0, ct = hud.cartao;
    for (var i = 0; i < pts.length; i++) {
      vDuelo.copy(pts[i]).project(camera);
      var sx = (vDuelo.x + 1) / 2 * W, sy = (1 - vDuelo.y) / 2 * H;
      if (sx < M0) fora += M0 - sx;
      if (sx > W - M0) fora += sx - (W - M0);
      if (sy < M0) fora += M0 - sy;
      if (sy > hud.base - M0) fora += sy - (hud.base - M0);
      if (ct && sx > ct.x0 - M0 && sx < ct.x1 + M0 && sy > ct.y0 - M0 && sy < ct.y1 + M0) {
        fora += Math.min(sx - (ct.x0 - M0), (ct.x1 + M0) - sx, sy - (ct.y0 - M0), (ct.y1 + M0) - sy);
      }
    }
    return fora;
  }
  var DESLIZES = null;                       // (a: de lado, b: para a câmera) em m, do menor ao maior
  function deslizes() {
    if (DESLIZES) return DESLIZES;
    DESLIZES = [];
    for (var b = -2; b <= 16; b += 0.5) for (var a = -8; a <= 8; a += 1) DESLIZES.push([a, b, Math.abs(a) + Math.abs(b)]);
    DESLIZES.sort(function (p, q) { return p[2] - q[2]; });
    return DESLIZES;
  }
  function ajustaMapaDeDuelo(st) {
    if (!camera || !ehMapaDeDuelo(st)) return false;
    var hud = medeHudDuelo();
    hudSig = hud.sig;
    var pts = pontosDosNascimentos(st);
    if (!pts.length) return false;
    var sala = String(st.dungeonId) + '|' + st.roomIndex;
    // o azimute de PARTIDA é o de antes do ajuste (um giro feito por este ajuste não vira ponto de partida)
    var ang0 = (cam.giroDoAjuste && cam.giroDoAjuste.sala === sala) ? cam.giroDoAjuste.antes : cam.ang;
    var d0 = cam.dist, px0 = cam.panX, pz0 = cam.panZ;
    var angH = gridW >= gridH ? 0 : -Math.PI / 2;           // câmera no eixo z: o x (comprido) fica na horizontal
    var angs = [ang0];
    if (Math.abs(Math.atan2(Math.sin(angH - ang0), Math.cos(angH - ang0))) > 0.01) angs.push(angH);
    var ordem = [];
    angs.forEach(function (ang) { ordem.push([ang, 1]); });
    for (var kk = 1; kk <= 15; kk++) angs.forEach(function (ang) { ordem.push([ang, 1 + kk / 100]); });
    var lista = deslizes(), achou = null, melhor = null;
    for (var o = 0; o < ordem.length && !achou; o++) {
      var ang = ordem[o][0], dk = clamp(d0 * ordem[o][1], cam.minDist, cam.maxDist);
      var rX = Math.cos(ang), rZ = -Math.sin(ang), tX = Math.sin(ang), tZ = Math.cos(ang);
      for (var s = 0; s < lista.length; s++) {
        var px = px0 + rX * lista[s][0] + tX * lista[s][1], pz = pz0 + rZ * lista[s][0] + tZ * lista[s][1];
        var fora = sobraDosNascimentos(pts, hud, dk, ang, px, pz);
        var tenta = { ang: ang, k: ordem[o][1], d: dk, px: px, pz: pz, a: lista[s][0], b: lista[s][1], fora: fora };
        if (fora === 0) { achou = tenta; break; }
        if (ordem[o][1] >= 1.15 && (!melhor || fora < melhor.fora)) melhor = tenta;
      }
    }
    var r = achou || melhor;
    if (!r) return false;
    if (Math.abs(r.ang - ang0) > 1e-4) cam.giroDoAjuste = { sala: sala, antes: ang0 };
    else if (cam.giroDoAjuste && cam.giroDoAjuste.sala === sala) cam.giroDoAjuste = null;
    cam.ang = r.ang; cam.dist = r.d; cam.panX = r.px; cam.panZ = r.pz;
    enquadro = { tipo: 'duelo', distAntiga: +d0.toFixed(2), dist: +r.d.toFixed(2), k: r.k, ang: +r.ang.toFixed(4),
                 angAntigo: +ang0.toFixed(4), girou: Math.abs(r.ang - ang0) > 1e-4, deslize: { lado: r.a, frente: r.b },
                 cabe: !!achou, foraPx: Math.round(r.fora),
                 hud: { base: Math.round(hud.base), cartao: hud.cartao, medida: hud.medida } };
    return true;
  }
  R._enquadro = function () { return enquadro; };
  /* o vigia (só nos mapas de duelo, só no desktop): a obstrução cresceu e ninguém tomou a
   * câmera? reajusta. `cam.pedida` = alguém chamou setCamera com enquadramento explícito. */
  var vigiaQuadro = 0;
  function vigiaAreaUtil(st) {
    if (++vigiaQuadro % 20 !== 0) return;
    if (moldura.topo || moldura.base || cam.manual || cam.pedida || camFocus || rotAnim) return;
    if (!ehMapaDeDuelo(st)) return;
    if (medeHudDuelo().sig !== hudSig) fitCamera(st);
  }
  function noCelular2() { return !!(moldura.topo || moldura.base); }

  function fitCamera(st) {
    var fw = gridW * CELL, fh = gridH * CELL;
    var span = Math.max(fw, fh);
    cam.minDist = Math.max(5, span * 0.16);
    cam.maxDist = span * 2.0;
    cam.pivot.set(0, CELL * 0.4, 0);

    /* SALA NOVA SOLTA A CAMERA; a mesma sala, nao.
     *
     * `fitCamera` roda dentro de `buildBoard`, e o tabuleiro e reconstruido
     * sempre que a `roomKey` muda — o que acontece VARIAS vezes dentro da mesma
     * luta. Cada reconstrucao reenquadrava e desfazia o que o jogador tinha
     * acabado de fazer: era isso que dava a sensacao de a camera "sempre voltar
     * para quem esta jogando".
     *
     * Numa sala NOVA reenquadrar e ajuda, nao roubo — o contexto mudou e ninguem
     * quer atravessar a porta olhando para o lugar errado. Entao o controle
     * manual e devolvido ali, e so ali.
     */
    var salaAgora = String(st && st.dungeonId) + '|' + String(st && st.roomIndex);
    if (salaAgora !== cam.ultimaSala) { cam.ultimaSala = salaAgora; cam.manual = false; hudMemo = null; }
    if (cam.manual) return;              // o jogador esta dirigindo: nao encoste

    cam.panX = 0; cam.panZ = 0;
    cam.pedida = false;

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
    // 15/09: calabouço fica EXATAMENTE assim; mapa de duelo (praça, sede) ganha o ajuste leve
    // dos nascimentos (ajustaMapaDeDuelo), só no desktop
    enquadro = { tipo: 'calabouco', dist: +cam.dist.toFixed(2), ang: +cam.ang.toFixed(4), tilt: cam.tilt };
    if (!noCelular2() && ehMapaDeDuelo(st)) ajustaMapaDeDuelo(st);
    else if (cam.giroDoAjuste) { cam.ang = cam.giroDoAjuste.antes; cam.giroDoAjuste = null; }
    updateCamera();
  }
  // caixa que contém o grupo do jogador e os inimigos mais próximos dele
  function actionBounds(st) {
    if (!st.units || !st.units.length) return null;
    var mine = [], foes = [];
    for (var i = 0; i < st.units.length; i++) {
      var u = st.units[i];
      if (!u.alive || u.offBoard) continue;
      (ladoTela(u) !== 'inimigo' ? mine : foes).push(u);
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
    // 15/09: enquadramento pedido por fora — o vigia da área útil não desfaz (recentrar solta)
    if (o.dist != null || o.zoom != null || o.tilt != null || o.ang != null || o.panX != null ||
        o.panY != null || o.panZ != null || o.centerX != null || o.rot != null) cam.pedida = true;
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
  /* VOLTAR AO ENQUADRAMENTO DA SALA.
   *
   * Camera livre sem volta e camera perdida, e quem se perde nao volta sozinho.
   * Devolve o controle a `fitCamera` e reconstroi o enquadramento na hora. */
  R.recentrar = function () {
    cam.manual = false;
    var st = state();
    if (st && st.grid) { fitCamera(st); updateCamera(); }
    return true;
  };
  R.cameraManual = function () { return !!cam.manual; };
  R.travarCamera = function (liga) {
    cam.travada = (liga == null) ? !cam.travada : !!liga;
    return cam.travada;
  };
  R.cameraTravada = function () { return !!cam.travada; };

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
      if (ptrCount === 1) {
        // BOTAO DIREITO (2) E MEIO (1) DESLOCAM; o esquerdo continua orbitando.
        // O esquerdo ja tem dois trabalhos — toque curto seleciona a casa,
        // arrasto orbita — e tomar o arrasto dele tiraria a orbita de quem ja a
        // tem na memoria muscular. O menu de contexto do canvas ja estava
        // desligado, entao o direito estava sobrando.
        var desloca = (e.button === 2 || e.button === 1);
        drag = { id: e.pointerId, moved: false, px: p.x, py: p.y, desloca: desloca };
        pinch = null;
      }
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
          // TRAVADA: nao mexe, mas ACOMPANHA os dedos. Sem atualizar o
          // registro de posicao, o primeiro movimento depois de destravar
          // saltaria pela diferenca acumulada com o cadeado fechado.
          if (cam.travada) {
            pinch.dist = d; pinch.mx = mx; pinch.my = my;
          } else {
            cam.manual = true;
            cam.dist = clamp(cam.dist * (pinch.dist / d), cam.minDist, cam.maxDist);
            // dois dedos deslizando = DESLOCAR o pivô no plano do chão
            panBy(mx - pinch.mx, my - pinch.my);
            pinch.dist = d; pinch.mx = mx; pinch.my = my;
            updateCamera();
          }
        }
      } else if (drag && drag.id === e.pointerId) {
        var dx = p.x - drag.px, dy = p.y - drag.py;
        if (!drag.moved && Math.hypot(p.x - rec.sx, p.y - rec.sy) > TAP_PX) drag.moved = true;
        if (drag.moved && !cam.travada) {
          cam.manual = true;               // o jogador assumiu: fitCamera recua
          if (drag.desloca) {
            panBy(dx, dy);                 // direito/meio: percorre o campo
          } else {
            // ÓRBITA LIVRE: horizontal gira, vertical inclina
            cam.ang -= dx * 0.007;
            cam.tilt = clamp(cam.tilt - dy * 0.005, cam.minTilt, cam.maxTilt);
          }
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
      if (cam.travada) return;
      cam.manual = true;
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
   * A saída é a clássica dos táticos no celular: o primeiro toque MIRA (acende o caminho,
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
    if (R.isBusy()) return;
    tapCasa(tileFromScreen(sx, sy), tipo);
  }
  /* O toque numa CASA (já resolvida da tela): a mesma porta do clique, exposta
   * para as páginas de prova baterem na casa sem projetar pixels. */
  R._tapCasa = function (x, y, tipo) { if (!R.isBusy()) tapCasa({ x: x, y: y }, tipo || 'mouse'); };
  /* AS CASAS NO ALCANCE MAS SEM VISÃO (19/09): do motor (Engine.casasSemVisao, que devolve
   * cada casa com o muro que a bloqueia) ou, num motor sem ela, medidas aqui — as casas de
   * chão dentro da distância (e da linha) do feitiço que o alcance pintado não trouxe e
   * que Engine.los recusa. `range` é a lista já pintada (spellRange), para não repetir. */
  function casasSemVisao(st, u, spellId, spell, range) {
    var en = engine();
    if (!en || !st || !u) return [];
    var lista = safe(function () { return en.casasSemVisao ? en.casasSemVisao(st, u.uid, spellId) : null; }, null);
    if (lista) return lista;
    if (!en.los || !spell || !range || !st.grid) return [];
    var rg = spell.range || en.RANGE_PADRAO || { min: 0, max: 1 };
    if (rg.los === false) return [];
    var tem = {}, out = [];
    for (var i = 0; i < range.length; i++) tem[range[i].x + ',' + range[i].y] = 1;
    var min = rg.min || 0, max = (rg.max != null) ? rg.max : 1;
    for (var y = 0; y < st.grid.h; y++) for (var x = 0; x < st.grid.w; x++) {
      var t = st.grid.tiles[y] && st.grid.tiles[y][x];
      if (!t || t.type !== 'floor' || tem[x + ',' + y]) continue;
      var d = Math.abs(x - u.x) + Math.abs(y - u.y);
      if (d < min || d > max) continue;
      if (rg.line && !(x === u.x || y === u.y)) continue;
      if (safe(function () { return en.los(st, u.x, u.y, x, y); }, true)) continue;
      out.push({ x: x, y: y, muro: en.muroNaLinha ? safe(function () { return en.muroNaLinha(st, u.x, u.y, x, y); }, null) : null });
    }
    return out;
  }
  /* POR QUE A CONJURAÇÃO NÃO SAIU (19/09). O passo tem explainNoStep no motor; a
   * conjuração recusada só devolvia false, e a casa atrás do muro ficava muda. Devolve o
   * motivo quando a casa tocada está no alcance do feitiço escolhido mas sem linha de
   * visão ("Sem linha de visão: muro em (x,y)."), ou null. O toque o põe no registro da
   * batalha ANTES de chegar ao jogo, porque o jogo desmarca o feitiço na casa inválida. */
  R.explainNoCast = function (x, y) {
    var g = game(), en = engine(), st = state();
    if (!g || !g.selectedSpellId || !en || !st) return null;
    var u = safe(function () { return en.activeUnit ? en.activeUnit(st) : null; }, null);
    if (!u) return null;
    var spellId = g.selectedSpellId;
    var spell = safe(function () { return en.spell ? en.spell(spellId) : null; }, null) || (DATA().spells && DATA().spells[spellId]) || null;
    var range = safe(function () { return en.spellRange ? en.spellRange(st, u.uid, spellId) : null; }, null);
    var lista = casasSemVisao(st, u, spellId, spell, range);
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].x !== x || lista[i].y !== y) continue;
      var m = lista[i].muro;
      return 'Sem linha de visão' + (m ? ': muro em (' + m.x + ',' + m.y + ')' : '') + '.';
    }
    // 03/10: a casa no alcance que o ESCURO do Santuário não deixa mirar de longe
    var breu = safe(function () { return en.casasNoEscuro ? en.casasNoEscuro(st, u.uid, spellId) : null; }, null) || [];
    for (var b = 0; b < breu.length; b++) {
      if (breu[b].x === x && breu[b].y === y) {
        return 'No escuro: essa casa só se mira a ' + (((DATA().santuario || {}).escuro || {}).visao || 2) +
               ' casas — acenda um braseiro com um golpe de Fogo, ou leve quem é do caminho do Fogo.';
      }
    }
    return null;
  };
  function explicaToque(x, y) {
    var motivo = R.explainNoCast(x, y);
    if (!motivo) return;
    var en = engine();
    try { if (en && en.log) en.log(motivo); } catch (e) {}
  }
  function tapCasa(t, tipo) {
    var g = game(); if (!g || !g.onTileClicked || !t) return;
    // na ESCOLHA DA POSIÇÃO (03/09) o toque é direto, também no dedo: não há
    // mira nem feitiço — a casa dourada é o único alvo
    var stT = state();
    if (stT && stT.phase === 'placing') { g.onTileClicked(t.x, t.y); return; }

    if (!modoToque(tipo)) { explicaToque(t.x, t.y); g.onTileClicked(t.x, t.y); return; }

    var sig = assinaturaMira();
    if (mira && mira.x === t.x && mira.y === t.y && mira.sig === sig) {
      mira = null;
      explicaToque(t.x, t.y);
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
    v.faceTo = best ? Math.atan2(wx(best.x) - wx(u.x), wz(best.y) - wz(u.y)) : (ladoTela(u) !== 'inimigo' ? 0 : Math.PI);
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
      classId: u.classId || null,
      // 11/09: o pet cresce 12% por estrela — o mesmo porte que ele tem na
      // praça (hub3d). Entra como escala da unidade, então barra de vida,
      // sombra e anel de lado saem no tamanho do corpo que apareceu.
      scale: (u.kind === 'pet' && u.petStars) ? 1 + 0.12 * u.petStars : 1
    });
    if (!node) return null;
    node.userData.uid = u.uid;
    // 02/10: o corpo grande que troca de elemento (o Eco) — syncUnits refaz o corpo com a tinta nova
    if (u.porte > 1) node.userData.elementoFase = u.element || null;

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

    // anel de lado (aliado/inimigo) — leitura instantânea do tabuleiro; o
    // herói do PARCEIRO (11/09) ganha um anel verde-água, o meu segue azul
    var ladoU = ladoTela(u);
    var ringMat = new THREE.MeshBasicMaterial({
      color: ladoU === 'meu' ? 0x6fd8ff : (ladoU === 'aliado' ? 0x5cf2c0 : 0xff7a5a),
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
    var col = ladoTela(u) !== 'inimigo' ? '#57d977' : '#e8574a';
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
      if (node && node.userData && (node.userData.defId !== u.defId ||
          (node.userData.elementoFase !== undefined && node.userData.elementoFase !== (u.element || null)))) {
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

      // posição + solavanco. 02/10: o corpo de porte 2 fica no MEIO das quatro casas dele (x, y é o
      // canto noroeste) — sem isto o Eco nascia em cima de uma casa e transbordava para as vizinhas
      var meio = (u.porte > 1) ? (u.porte - 1) / 2 : 0;
      node.position.set(wx(v.x + meio) + v.knockX, v.z, wz(v.y + meio) + v.knockZ);
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
      if (stt.invisible) alpha *= 0.30;                 // §4: invisível ~30% (para o lado dele)
      // 22/09: para o adversário, nada — nem o vulto de 30%, nem barra, anel ou
      // sombra. O nó segue andando por baixo (vis), então reaparece no lugar certo.
      node.visible = !ocultoTela(u);
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

  // ======================================================= O AVISO DO ECO (02/10)
  /* As casas do golpe grande marcado (state.eco.aviso) ficam vermelhas no chão, pulsando, durante a
   * rodada inteira em que o grupo pode sair delas — o aviso "um turno antes" do dono. Malhas próprias
   * (não as do ovPool, que se refazem a cada mira) dentro do overlayG; refeitas só quando a marca
   * muda, e o pulso é da opacidade de um material só. Para o adversário… não há: o Eco é PvE. */
  var ecoAvisoG = null, ecoAvisoSig = '', ecoAvisoMat = null;
  function pintaAvisoEco(st) {
    var av = st && st.eco && st.eco.aviso && st.phase === 'playing' ? st.eco.aviso : null;
    var sig = av ? av.golpe + ':' + (av.casas || []).map(function (c) { return c.x + '.' + c.y; }).join(';') : '';
    if (sig !== ecoAvisoSig) {
      ecoAvisoSig = sig;
      if (ecoAvisoG) {
        if (ecoAvisoG.parent) ecoAvisoG.parent.remove(ecoAvisoG);
        ecoAvisoG = null;
      }
      if (av && overlayG) {
        if (!ecoAvisoMat) {
          ecoAvisoMat = new THREE.MeshBasicMaterial({ color: col3('#ff4a2a'), transparent: true, opacity: 0.5,
                                                      depthWrite: false, side: THREE.DoubleSide });
        }
        ecoAvisoMat.color.copy(col3(R.elementColor(av.el || 'fogo')));   // a cor do elemento do golpe
        ecoAvisoG = new THREE.Group();
        ecoAvisoG.name = 'eco-aviso';
        (av.casas || []).forEach(function (c) {
          var m = new THREE.Mesh(M.tileFlatGeo(), ecoAvisoMat);
          m.renderOrder = 3;
          m.position.set(wx(c.x), 0.07, wz(c.y));
          m.scale.setScalar(0.96);
          ecoAvisoG.add(m);
        });
        overlayG.add(ecoAvisoG);
      }
    }
    if (ecoAvisoMat && ecoAvisoG) ecoAvisoMat.opacity = 0.32 + 0.26 * (0.5 + 0.5 * Math.sin(nowT * 5.2));
  }
  R._ecoAviso = function () { return ecoAvisoG ? ecoAvisoG.children.length : 0; };   // provas: conta, não foto

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
    mesh.userData.cor = color;              // 03/10: a cor pedida, para a prova ler (o material passa por espaço de cor)
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
      // 03/10: o braseiro que acende e o pilar que sobe mudam o que se mira e por onde se anda
      st.santuario ? st.santuario.br.join('') + st.santuario.pl.join('') : '',
      g && g.isPlayerTurn ? (g.isPlayerTurn() ? 1 : 0) : 1].join('|');
  }

  function rebuildOverlays(st) {
    ovUsed = 0;
    var g = game(), en = engine();
    var D = DATA();
    // A ESCOLHA DA POSIÇÃO (03/09): as quatro casas douradas antes da rodada 1.
    // ANTES da guarda de fase/turno — em placing não é turno de ninguém, e a
    // guarda apagava as casas (o dono clicava às cegas e nada nascia).
    if (st && st.phase === 'placing' && st.placement) {
      /* 21/09: cada jogador vê as CASAS DELE (listas disjuntas) e marca a sua.
       * Antes só quem liderava via as douradas, e o toque começava a luta na
       * hora; agora a casa marcada fica cravada, mais forte que as outras, e a
       * rodada 1 só vem dos 30 s ou do PRONTO dos dois. */
      var opc = (g && g.minhasOpcoes) ? g.minhasOpcoes() : (st.placement.options || []);
      if (!opc.length) { hideRestOverlay(); return; }
      var marcada = (g && g.minhaEscolha) ? g.minhaEscolha() : null;
      var hv0 = g && g.hoverTile;
      for (var oi = 0; oi < opc.length; oi++) {
        var ehMarcada = !!(marcada && marcada.x === opc[oi].x && marcada.y === opc[oi].y);
        var sobre = !!(hv0 && hv0.x === opc[oi].x && hv0.y === opc[oi].y);
        if (ehMarcada) ovTile(opc[oi].x, opc[oi].y, '#8fe08a', 0.92, 0.22, 1.0);
        else ovTile(opc[oi].x, opc[oi].y, '#ffc44d', sobre ? 0.85 : 0.48, 0.16, sobre ? 1.0 : 0.88);
      }
      hideRestOverlay();
      return;
    }
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
        var temEspinho = !!(st.walls && st.walls.length && en.muroFerePrevisto);
        for (var i = 0; i < reach.length; i++) {
          var t = reach[i];
          var risky = !!(t.risky || t.risk || t.dodgeRisk || t.locked);
          // 03/10: terminar a vez aqui encosta no muro de espinhos do outro lado — vermelho, e vale
          // mais que o âmbar da esquiva (o espinho é certo, a fixação é sorte)
          var espinho = temEspinho && safe(function () { return en.muroFerePrevisto(st, active, t.x, t.y); }, 0) > 0;
          // células de RISCO DE ESQUIVA em âmbar (§2)
          if (espinho) ovTile(t.x, t.y, '#ff3b4a', 0.34, 0.09, 0.84);
          else ovTile(t.x, t.y, risky ? '#ff8a24' : '#28c8ff', risky ? 0.30 : 0.18, 0.09, 0.84);
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
      /* 19/09: AS CASAS NO ALCANCE MAS SEM LINHA DE VISÃO, com cor própria. spellRange já
       * filtra pela visão, então a casa atrás do muro simplesmente não era pintada e o
       * jogador via o alcance "recortado" sem saber se era distância, linha ou parede
       * ("eu não consigo mas ele consegue"). A lista vem do motor (Engine.casasSemVisao:
       * cada casa que passa por distância e linha e cai só pela visão, com o muro que a
       * bloqueia) ou, sem ele, é medida aqui com Engine.los. Cinza-azulado, num quadrado
       * menor (0,55) que o do alcance: lê como "chega, mas há muro no caminho". */
      var semVisao = casasSemVisao(st, active, spellId, spell, range);
      for (var sv = 0; sv < semVisao.length; sv++) ovTile(semVisao[sv].x, semVisao[sv].y, '#9aa3ad', 0.16, 0.06, 0.55);
      /* 03/10: AS CASAS QUE O ESCURO TIRA (o Santuário, a Câmara Apagada). Estão no alcance e à
       * vista, e mesmo assim quem não enxerga no breu não pode mirá-las de longe: sem cor
       * própria o alcance sairia "comido" sem dizer por quê. Roxo, no mesmo quadrado pequeno
       * da casa sem visão; o toque nela diz a regra (R.explainNoCast). */
      var noEscuro = safe(function () { return en.casasNoEscuro ? en.casasNoEscuro(st, active.uid, spellId) : null; }, null) || [];
      for (var ne = 0; ne < noEscuro.length; ne++) ovTile(noEscuro[ne].x, noEscuro[ne].y, '#8a63d2', 0.30, 0.06, 0.55);

      // ALVOS por cima, forte: quem dá para acertar de verdade.
      // 22/09: as casas que ESTA tela vê como alvo (Game.alvosNaTela): a do
      // invisível do outro lado não pode virar um buraco no destaque
      var targets = safe(function () {
        if (g && g.alvosNaTela) return g.alvosNaTela(active.uid, spellId);
        return en.castTargets ? en.castTargets(st, active.uid, spellId) : null;
      }, null);
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
      if (!owner || ocultoTela(owner)) continue;        // 22/09: o anel do pet desenhava em volta do dono invisível
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
    // 22/09: a vez do invisível do outro lado não acende a casa dele
    if (!active || ocultoTela(active)) { activeRing.visible = false; return; }
    var v = vis[active.uid] || { x: active.x, y: active.y };
    activeRing.visible = true;
    activeRing.position.set(wx(v.x), 0.11, wz(v.y));
    activeRing.material.color.setHex(ladoTela(active) !== 'inimigo' ? 0xffd98a : 0xff6a4a);
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
  //
  // 22/09 (o dono: "jamais podem ficar visiveis para os inimigos ou
  // adversarios, assim eles desviam e nunca caem"): so para o LADO de quem
  // armou (veArmadilha). O adversario nao tem o que ler no tabuleiro — nem o
  // laco, nem a sombra dele.
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
    var todas = (st && st.traps) || [], lista = [];
    // a assinatura sai da lista JA filtrada: a armadilha do outro lado nem
    // provoca redesenho quando nasce
    for (var f = 0; f < todas.length; f++) if (veArmadilha(todas[f])) lista.push(todas[f]);
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

  // ------------------------------------------------- O CHÃO DO POÇO (02/10)
  /* Os perigos do andar (js/core/poco.js) moram em `state.perigos` e são TODOS
   * à vista: a regra é que nada fere sem ter sido visto e avisado. Cada tipo tem
   * uma silhueta própria, que não se confunde com o laço de urso da armadilha
   * nem com a coluna de luz do evento de chão:
   *   placa   — chapa de bronze com uma SETA para o lado em que atira; a linha
   *             dela fica riscada de leve no chão o tempo todo, e acende em
   *             VERMELHO quando a placa é armada;
   *   jato    — um respiro: aro grosso na cor do elemento em volta de um
   *             buraco escuro;
   *   rachado — riscos escuros em zigue-zague; o buraco, depois de cair, é um
   *             poço preto com a borda quebrada;
   *   runa    — dois anéis lilás que giram em sentidos opostos;
   *   poça    — o espelho d'água do Colosso da Maré.
   * O AVISO é a casa pintada, pulsando, com um "!" em cima da origem — a cor diz
   * de onde vem (vermelho = setas, laranja = desabamento, a cor do elemento =
   * jato). Pinta para todo mundo: perigo de ambiente não tem dono nem lado. */
  var perNodes = [];
  var perSig = '';
  var PER_AVISO = { placa: '#ff4a3a', rachado: '#ff9a3a' };
  var perMatCache = {};
  function perMat(cor, op, aditivo) {
    var k = cor + '|' + op + '|' + (aditivo ? 1 : 0);
    if (!perMatCache[k]) {
      perMatCache[k] = new THREE.MeshBasicMaterial({
        color: col3(cor), transparent: true, opacity: op, depthWrite: false,
        side: THREE.DoubleSide, blending: aditivo ? THREE.AdditiveBlending : THREE.NormalBlending
      });
    }
    return perMatCache[k];
  }
  function perCasa(x, y, cor, op, yOff) {
    var m = new THREE.Mesh(M.tileFlatGeo(), new THREE.MeshBasicMaterial({
      color: col3(cor), transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide
    }));
    m.position.set(wx(x), yOff == null ? 0.07 : yOff, wz(y));
    m.scale.setScalar(0.94);
    m.renderOrder = 4;
    return m;
  }
  function montaPlaca(p) {
    var g = new THREE.Group();
    var chapa = new THREE.Mesh(
      M.geo('perPlaca', function () { return new THREE.BoxGeometry(CELL * 0.62, 0.06, CELL * 0.62); }),
      new THREE.MeshStandardMaterial({ color: col3('#8a7448'), roughness: 0.45, metalness: 0.6,
                                       emissive: col3('#3a2a10'), emissiveIntensity: 0.4 }));
    chapa.position.y = 0.04; chapa.castShadow = false; chapa.receiveShadow = true;
    g.add(chapa);
    // a seta: um cone deitado apontando para a linha
    var seta = new THREE.Mesh(
      M.geo('perSeta', function () { var c = new THREE.ConeGeometry(0.22, 0.55, 3); c.rotateX(Math.PI / 2); return c; }),
      new THREE.MeshStandardMaterial({ color: col3('#ffcf6a'), emissive: col3('#ff9a2a'), emissiveIntensity: 0.6,
                                       roughness: 0.4, metalness: 0.3 }));
    seta.position.y = 0.14;
    var ang = { n: Math.PI, s: 0, l: Math.PI / 2, o: -Math.PI / 2 }[p.dir] || 0;
    seta.rotation.y = ang;
    g.add(seta);
    g.userData.brilho = seta;
    return g;
  }
  function montaJato(p) {
    var g = new THREE.Group();
    var cor = R.elementColor(p.elemento);
    var boca = new THREE.Mesh(M.geo('perBoca', function () { var c = new THREE.CircleGeometry(0.42, 18); c.rotateX(-Math.PI / 2); return c; }),
      perMat('#07080a', 0.92));
    boca.position.y = 0.05; boca.renderOrder = 5;
    g.add(boca);
    var aro = new THREE.Mesh(M.geo('perAro', function () { var t = new THREE.TorusGeometry(0.5, 0.09, 6, 22); t.rotateX(-Math.PI / 2); return t; }),
      new THREE.MeshStandardMaterial({ color: col3(cor), emissive: col3(cor), emissiveIntensity: 0.5, roughness: 0.5 }));
    aro.position.y = 0.08;
    g.add(aro);
    g.userData.brilho = aro;
    return g;
  }
  function montaRachado(p) {
    var g = new THREE.Group();
    if (p.caiu) {
      var poco = new THREE.Mesh(M.geo('perPoco', function () { var c = new THREE.CircleGeometry(CELL * 0.46, 20); c.rotateX(-Math.PI / 2); return c; }),
        perMat('#020203', 0.97));
      poco.position.y = 0.06; poco.renderOrder = 5;
      g.add(poco);
      var borda = new THREE.Mesh(M.geo('perBorda', function () { var t = new THREE.TorusGeometry(CELL * 0.46, 0.08, 4, 14); t.rotateX(-Math.PI / 2); return t; }),
        new THREE.MeshStandardMaterial({ color: col3('#3a3430'), roughness: 0.95 }));
      borda.position.y = 0.07;
      g.add(borda);
      return g;
    }
    var mat = perMat('#140f0c', 0.85);
    var riscos = [[-0.55, -0.35, 0.5], [-0.15, 0.05, -0.6], [0.3, -0.25, 0.4], [0.05, 0.45, -0.3]];
    for (var i = 0; i < riscos.length; i++) {
      var r = new THREE.Mesh(M.geo('perRisco', function () { var b = new THREE.PlaneGeometry(0.62, 0.06); b.rotateX(-Math.PI / 2); return b; }), mat);
      r.position.set(riscos[i][0], 0.075, riscos[i][1]);
      r.rotation.y = riscos[i][2];
      r.renderOrder = 5;
      g.add(r);
    }
    return g;
  }
  function montaRuna() {
    var g = new THREE.Group();
    var cor = '#b98cff';
    var a1 = new THREE.Mesh(M.geo('perRuna1', function () { var t = new THREE.RingGeometry(0.52, 0.6, 24); t.rotateX(-Math.PI / 2); return t; }),
      perMat(cor, 0.85, true));
    var a2 = new THREE.Mesh(M.geo('perRuna2', function () { var t = new THREE.RingGeometry(0.26, 0.32, 5); t.rotateX(-Math.PI / 2); return t; }),
      perMat(cor, 0.9, true));
    a1.position.y = 0.08; a2.position.y = 0.09; a1.renderOrder = 6; a2.renderOrder = 6;
    g.add(a1); g.add(a2);
    g.userData.gira = [a1, a2];
    return g;
  }
  function montaPoca() {
    var g = new THREE.Group();
    var d = new THREE.Mesh(M.geo('perPoca', function () { var c = new THREE.CircleGeometry(CELL * 0.4, 20); c.rotateX(-Math.PI / 2); return c; }),
      perMat('#57c8ec', 0.42));
    d.position.y = 0.06; d.renderOrder = 5;
    g.add(d);
    return g;
  }

  function limpaPerigos() {
    var cache = {};
    for (var ck in perMatCache) if (Object.prototype.hasOwnProperty.call(perMatCache, ck)) cache[perMatCache[ck].uuid] = true;
    for (var q = perNodes.length - 1; q >= 0; q--) {
      var n = perNodes[q];
      if (n.parent) n.parent.remove(n);
      // a cada rodada isto se refaz: material próprio (e a textura do "!") vai
      // embora junto, senão a aba engorda uma pilha por rodada
      n.traverse(function (o) {
        var mt = o.material;
        if (!mt || cache[mt.uuid]) return;
        if (mt.map) mt.map.dispose();
        mt.dispose();
      });
    }
    perNodes.length = 0;
    perSig = '';
  }

  function rebuildPerigos(st) {
    var ps = (st && st.perigos) || [];
    var sig = String(st && st.round);
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      sig += '|' + p.id + ':' + p.x + ',' + p.y + ':' + (p.armada ? 1 : 0) + (p.caiu ? 1 : 0) + ':' + (p.aviso || 0);
    }
    if (sig === perSig) return;
    limpaPerigos();
    perSig = sig;
    for (var k = 0; k < ps.length; k++) {
      var pg = ps[k], node = null;
      if (pg.tipo === 'placa') node = montaPlaca(pg);
      else if (pg.tipo === 'jato') node = montaJato(pg);
      else if (pg.tipo === 'rachado') node = montaRachado(pg);
      else if (pg.tipo === 'runa') node = montaRuna(pg);
      else if (pg.tipo === 'poca') node = montaPoca(pg);
      if (!node) continue;
      node.position.set(wx(pg.x), 0, wz(pg.y));
      node.userData.ph = (pg.x * 7 + pg.y * 13) % 10;
      node.userData.perigo = pg.tipo; node.userData.papel = 'peca';
      scene.add(node);
      perNodes.push(node);
      // a linha da placa desarmada: risco fraco, para o jogador ler o alcance
      if (pg.tipo === 'placa' && !pg.armada && pg.casas) {
        for (var c = 0; c < pg.casas.length; c++) {
          var lin = perCasa(pg.casas[c].x, pg.casas[c].y, '#ffcf6a', 0.10, 0.06);
          lin.scale.set(0.30, 1, 0.30);
          lin.userData.perigo = pg.tipo; lin.userData.papel = 'linha';
          scene.add(lin); perNodes.push(lin);
        }
      }
      // O AVISO: as casas que levam o golpe, pulsando, e o "!" na origem
      if (pg.aviso && pg.casas) {
        var cor = PER_AVISO[pg.tipo] || R.elementColor(pg.elemento);
        var urgente = pg.aviso === (st.round + 1);
        for (var a = 0; a < pg.casas.length; a++) {
          var casa = perCasa(pg.casas[a].x, pg.casas[a].y, cor, urgente ? 0.42 : 0.26, 0.08);
          casa.userData.aviso = true;
          casa.userData.perigo = pg.tipo; casa.userData.papel = 'aviso';
          casa.userData.ph = a * 0.7;
          casa.userData.base = urgente ? 0.42 : 0.26;
          scene.add(casa); perNodes.push(casa);
        }
        var icone = makeIconSprite('!', cor);
        icone.position.set(wx(pg.x), 1.35, wz(pg.y));
        icone.userData.aviso = true;
        icone.userData.perigo = pg.tipo; icone.userData.papel = 'sinal';
        scene.add(icone); perNodes.push(icone);
      }
    }
  }

  /* respiração: o aviso pulsa forte (é para o olho achar), o resto devagar */
  function updatePerigos() {
    for (var i = 0; i < perNodes.length; i++) {
      var n = perNodes[i], ud = n.userData;
      var p = 0.5 + 0.5 * Math.sin(nowT * 4.0 + (ud.ph || 0));
      if (ud.aviso && n.material && ud.base != null) n.material.opacity = ud.base * (0.55 + 0.45 * p);
      else if (ud.aviso && n.isSprite) n.position.y = 1.35 + 0.12 * p;
      if (ud.brilho && ud.brilho.material) ud.brilho.material.emissiveIntensity = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(nowT * 2 + (ud.ph || 0)));
      if (ud.gira) { ud.gira[0].rotation.y = nowT * 0.5; ud.gira[1].rotation.y = -nowT * 0.9; }
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
  /* O ESCUDO DEIXOU DE SER UM SO.
   *
   * Era constante: todo feitico de muro de toda classe usava a mesma peca. O
   * Daniel modelou um escudo POR DUPLA do Minotauro, entao a constante virou
   * tabela chaveada pelo `defId` de quem ergueu (`fus:a+b`, ordem alfabetica).
   *
   * Quem nao estiver aqui — as outras 15 duplas, e o Minotauro sozinho — cai no
   * `MURO_PADRAO`, que e o escudo original. Nenhuma delas perde nada. */
  var MURO_PADRAO = 'muro-escudo';
  var MURO_POR_FUSAO = {
    'fus:arqueiro+minotauro':   'muro_arqueiro_minotauro',
    'fus:bruxo+minotauro':      'muro_bruxo_minotauro',
    'fus:curandeiro+minotauro': 'muro_curandeiro_minotauro',
    'fus:espadachim+minotauro': 'muro_espadachim_minotauro',
    'fus:invocador+minotauro':  'muro_invocador_minotauro',
    'fus:minotauro+sumo':       'muro_minotauro_sumo'
  };
  function modeloDoMuro(defId) {
    var k = defId && MURO_POR_FUSAO[defId];
    if (k && M && M.hasModel && M.hasModel(k)) return k;
    return MURO_PADRAO;
  }

  // TINGIR É MISTURAR, NUNCA SUBSTITUIR.
  //
  // Escrito com `color.copy(cor)`, isto apagava o desenho inteiro: o escudo do
  // Minotauro chegou com textura de madeira, rebite e brasão e virou uma chapa
  // laranja lisa. É o mesmo erro que já tinha lavado o chão e as paredes — o
  // material do modelo não tem cor de base, TUDO vem do atlas, e a cor do
  // material MULTIPLICA esse atlas. Escrever cor chapada em cima é jogar a
  // arte fora.
  //
  // A caixa provisória continuava precisando da cor cheia (ela não tem
  // textura), então quem faz a mistura é esta função e a força depende de o
  // corpo ter desenho ou não.
  function tingeMuro(no, cor, forca) {
    var k = (forca == null) ? 0.45 : forca;
    no.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var m = o.material.clone();
      if (m.color) m.color.lerp(cor, k);
      if (m.emissive) { m.emissive.copy(cor); m.emissiveIntensity = 0.12; }
      o.material = m;
      o.castShadow = true;
      o.receiveShadow = true;
    });
  }

  function corpoDoMuro(cor, chave) {
    chave = chave || MURO_PADRAO;
    try {
      if (M && M.hasModel && M.hasModel(chave)) {
        var cena = M.rawScene(chave);
        if (cena) {
          var no = cena.clone(true);
          // 0,45: forte o bastante para o jogador ler o elemento de longe, leve
          // o bastante para a madeira e o brasão do escudo sobreviverem.
          tingeMuro(no, cor, 0.45);
          // encaixa no porte da casa, seja qual for a escala em que veio
          var cx = new THREE.Box3().setFromObject(no);
          var tam = cx.getSize(new THREE.Vector3());
          var k = Math.min(MURO_LARG / Math.max(0.001, tam.x),
                           MURO_ALT / Math.max(0.001, tam.y),
                           MURO_LARG / Math.max(0.001, tam.z));
          if (isFinite(k) && k > 0) no.scale.setScalar(k);
          no.position.y = -cx.min.y * (no.scale.y || 1);

          // DE QUE LADO FICA A FACE.
          //
          // Um escudo é largo e fino, e a face é perpendicular ao eixo mais
          // FINO — isso é geometria da peça, não convenção de exportador, então
          // vale para qualquer escudo que chegar depois. Guardo aqui e quem
          // posiciona o muro usa: `rotation.y` some com o quarto de volta
          // quando a peça já nasce com a face no eixo Z.
          //
          // Tentei duas vezes acertar isto com número fixo — girando pelo lado
          // mais LARGO (pôs o verso para a câmera) e não girando (deixou o
          // escudo de perfil, uma lasca vertical). Deduzir do modelo é o que
          // para de errar.
          no.userData.faceEmX = (tam.x < tam.z);
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

  function montaMuro(el, defId, fere) {
    var cor = col3(R.elementColor(el));
    var g = new THREE.Group();
    var pedra = corpoDoMuro(cor, modeloDoMuro(defId));
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
    // repassa a face para quem vai mirar o muro no inimigo
    g.userData.faceOffset = (pedra.userData && pedra.userData.faceEmX) ? Math.PI / 2 : 0;
    // 03/10: o muro que fere quem encosta (engine.js) MOSTRA que fere — espinhos nas quatro faces
    if (fere > 0) {
      var esp = espinhosDoMuro(cor);
      g.add(esp);
      g.userData.espinhos = esp;
    }
    return g;
  }

  /* OS ESPINHOS DO MURO (03/10 — engine.js, "O MURO QUE FERE QUEM ENCOSTA").
   *
   * A regra fere quem TERMINA a vez numa das quatro casas vizinhas (norte, sul,
   * leste, oeste), então o desenho aponta para elas: um colar de estacas de
   * ferro cravadas no chão ao pé da pedra, três por face, inclinadas para fora
   * e invadindo a casa vizinha, com o brilho do elemento. No chão e não na
   * pedra: o corpo do muro é o escudo do Daniel (largo e FINO), e ponta presa à
   * face fina flutuaria no ar. Ficam presas à GRADE, não ao escudo — o escudo
   * gira para encarar o inimigo e os espinhos não podem girar junto, senão
   * apontariam para a quina (rebuildWalls desfaz o giro). Uma malha instanciada
   * por muro: o anel de oito pedras do nível 30 custa oito chamadas de desenho. */
  var ESPINHO_POR_FACE = [-0.55, 0, 0.55];      // ao longo da face, em frações da meia largura
  var ESPINHO_ALT = 0.9, ESPINHO_INCL = 0.72;   // comprimento; quanto sobe (rad acima do chão) — lê no celular
  function espinhosDoMuro(cor) {
    var geo = M.geo('muroEspinho', function () {
      var c = new THREE.ConeGeometry(0.15, ESPINHO_ALT, 6);
      // a ponta para +X (a face leste) e para cima; a base na origem — as outras faces giram daqui
      c.rotateZ(-Math.PI / 2 + ESPINHO_INCL);
      c.translate(Math.cos(ESPINHO_INCL) * ESPINHO_ALT / 2, Math.sin(ESPINHO_INCL) * ESPINHO_ALT / 2, 0);
      return c;
    });
    var ferro = new THREE.Color('#3a3430').lerp(cor, 0.35);
    var mat = new THREE.MeshStandardMaterial({ color: ferro, roughness: 0.42, metalness: 0.7,
                                               emissive: cor, emissiveIntensity: 0.55 });
    var n = ESPINHO_POR_FACE.length * 4;
    var inst = new THREE.InstancedMesh(geo, mat, n);
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    var p = new THREE.Vector3(), eixo = new THREE.Vector3(0, 1, 0), k = 0;
    var meia = MURO_LARG / 2, pe = meia * 0.92;
    for (var f = 0; f < 4; f++) {
      var ang = f * Math.PI / 2;               // leste, norte, oeste, sul (giro em Y)
      q.setFromAxisAngle(eixo, ang);
      for (var i = 0; i < ESPINHO_POR_FACE.length; i++) {
        var lat = ESPINHO_POR_FACE[i] * meia;
        // a base do espinho no chão, ao pé da face, `lat` ao longo dela
        p.set(pe * Math.cos(ang) + lat * Math.sin(ang), 0.04, -pe * Math.sin(ang) + lat * Math.cos(ang));
        m4.compose(p, q, s);
        inst.setMatrixAt(k++, m4);
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.userData.mat = mat;
    return inst;
  }

  /* A ZONA DOS ESPINHOS: as casas de chão vizinhas de cada muro que fere,
   * pintadas de leve na cor do elemento e respirando — onde o jogador NÃO quer
   * terminar a vez. Refeita só quando a lista de muros muda (a mesma assinatura
   * dos muros); uma casa encostada em dois muros pinta uma vez. Pública para os
   * dois lados: a pedra está à vista de todos (a IA do outro lado a pesa igual). */
  var zonaNodes = [], zonaSig = '', zonaMat = {};
  function zonaMatDe(cor) {
    if (!zonaMat[cor]) zonaMat[cor] = new THREE.MeshBasicMaterial({ color: col3(cor), transparent: true, opacity: 0.22,
                                                                      depthWrite: false, side: THREE.DoubleSide });
    return zonaMat[cor];
  }
  function limpaZona() {
    for (var i = 0; i < zonaNodes.length; i++) if (zonaNodes[i].parent) zonaNodes[i].parent.remove(zonaNodes[i]);
    zonaNodes.length = 0;
    zonaSig = '';
  }
  function rebuildZonaEspinhos(st) {
    var lista = (st && st.walls) || [], sig = '';
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].fere > 0) sig += lista[i].x + ',' + lista[i].y + ':' + (lista[i].element || '') + ';';
    }
    if (sig === zonaSig) return;
    limpaZona();
    zonaSig = sig;
    if (!sig || !st.grid) return;
    var feita = {}, VIZ = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (i = 0; i < lista.length; i++) {
      var w = lista[i];
      if (!(w.fere > 0)) continue;
      for (var d = 0; d < 4; d++) {
        var x = w.x + VIZ[d][0], y = w.y + VIZ[d][1], k = x + ',' + y;
        if (feita[k] || x < 0 || y < 0 || x >= st.grid.w || y >= st.grid.h) continue;
        var t = st.grid.tiles[y] && st.grid.tiles[y][x];
        if (!t || t.type !== 'floor') continue;
        feita[k] = true;
        var casa = new THREE.Mesh(M.tileFlatGeo(), zonaMatDe(R.elementColor(w.element || 'neutro')));
        casa.position.set(wx(x), 0.065, wz(y));
        casa.scale.setScalar(0.9);
        casa.renderOrder = 4;
        casa.userData.espinho = { x: x, y: y };
        scene.add(casa);
        zonaNodes.push(casa);
      }
    }
  }
  // para as provas de tela: as casas da zona dos espinhos agora
  R.zonaEspinhosNaTela = function () { return zonaNodes.map(function (n) { return n.userData.espinho; }); };
  R.murosComEspinhos = function () {
    var out = [];
    for (var k in wallNodes) {
      var esp = wallNodes[k].userData.espinhos;
      if (!esp) continue;
      // o giro do colar no MUNDO (tem de ser zero: preso à grade, não ao escudo)
      var q = new THREE.Quaternion();
      esp.getWorldQuaternion(q);
      var giro = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
      out.push({ casa: k, pontas: esp.count, giro: giro, giroEscudo: wallNodes[k].rotation.y });
    }
    return out;
  };
  // para as provas de tela: as casas do destaque de agora (passo, alcance…), com a cor de cada uma
  R.destaqueNaTela = function () {
    var out = [];
    for (var i = 0; i < ovUsed; i++) {
      var m = ovPool[i];
      if (!m || !m.visible) continue;
      out.push({ x: Math.round(m.position.x / CELL + (gridW - 1) / 2), y: Math.round(m.position.z / CELL + (gridH - 1) / 2),
                 cor: m.userData.cor || ('#' + m.material.color.getHexString()) });
    }
    return out;
  };

  // PARA QUEM O ESCUDO OLHA.
  //
  // O inimigo vivo mais perto da casa do muro, medido no tabuleiro e não na
  // tela. `state.walls` guarda o `side` de quem ergueu, então "inimigo" aqui é
  // simplesmente o lado contrário — serve tanto para o Minotauro do jogador
  // quanto para um monstro que erga muro um dia.
  function alvoDoMuro(st, w) {
    if (!st || !st.units) return null;
    var melhor = null, dist = 1e9;
    for (var i = 0; i < st.units.length; i++) {
      var u = st.units[i];
      if (!u.alive || u.offBoard) continue;
      if (u.side === w.side) continue;
      var d = Math.abs(u.x - w.x) + Math.abs(u.y - w.y);
      if (d < dist) { dist = d; melhor = u; }
    }
    return melhor;
  }

  // O ÂNGULO, com a correção de face do modelo.
  //
  // A correção de face NÃO mora aqui: ela é deduzida do próprio modelo, na
  // montagem (ver `faceEmX` em `corpoDoMuro`), e somada por quem posiciona.
  function anguloDoMuro(st, w) {
    var alvo = alvoDoMuro(st, w);
    var dx, dz;
    if (alvo) {
      dx = alvo.x - w.x;
      dz = alvo.y - w.y;
    } else {
      // ninguém do outro lado: encara o meio do tabuleiro, que é para onde a
      // briga acontece, em vez de uma direção qualquer
      dx = (st.grid.w - 1) / 2 - w.x;
      dz = (st.grid.h - 1) / 2 - w.y;
    }
    if (!dx && !dz) return 0;
    return Math.atan2(dx, dz);
  }

  function rebuildWalls(st) {
    var lista = (st && st.walls) || [];
    var sig = '';
    for (var i = 0; i < lista.length; i++) {
      // O ALVO ENTRA NA ASSINATURA. Sem isso o muro só seria remontado quando
      // a LISTA mudasse, e o escudo continuaria encarando o lugar onde o bicho
      // estava quando ele subiu — ficaria de perfil assim que o inimigo andasse.
      var av = alvoDoMuro(st, lista[i]);
      sig += lista[i].x + ',' + lista[i].y + ':' + (lista[i].element || '') +
             ':' + (lista[i].defId || '-') + ':' + (lista[i].fere > 0 ? 'e' : '') +
             ':' + (av ? av.x + '_' + av.y : '-') + ';';
    }
    rebuildZonaEspinhos(st);          // 03/10: as casas onde não se termina a vez
    if (sig === wallSig) return;
    wallSig = sig;

    // 03/10: os espinhos ficam presos à grade — desfaz o giro da mira do escudo
    function apruma(no, ang) {
      no.rotation.y = ang;
      if (no.userData.espinhos) no.userData.espinhos.rotation.y = -ang;
    }
    var vivos = {};
    for (i = 0; i < lista.length; i++) {
      var w = lista[i], k = w.x + ',' + w.y;
      vivos[k] = 1;
      if (wallNodes[k] && !!wallNodes[k].userData.espinhos === (w.fere > 0)) {
        // já está de pé: só reapruma a mira, sem refazer a subida
        apruma(wallNodes[k], anguloDoMuro(st, w) + (wallNodes[k].userData.faceOffset || 0));
        continue;
      }
      if (wallNodes[k]) { descartaMuro(wallNodes[k]); delete wallNodes[k]; }
      var node = montaMuro(w.element || 'neutro', w.defId, w.fere);
      var p = R.world(w.x, w.y, 0);
      node.position.set(p.x, 0, p.z);
      apruma(node, anguloDoMuro(st, w) + (node.userData.faceOffset || 0));
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
    n.traverse(function (o) {
      if (o.isMesh && o.material) o.material.dispose();
      // 03/10: o colar de espinhos é instanciado — o buffer das matrizes também vai embora
      if (o.isInstancedMesh && o.dispose) o.dispose();
    });
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
      // 03/10: a ponta dos espinhos respira no brilho do elemento
      if (n.userData.espinhos) n.userData.espinhos.userData.mat.emissiveIntensity = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(nowT * 3.1));
    }
    // a zona dos espinhos respira devagar (um material por cor: todas juntas)
    for (var zc in zonaMat) if (Object.prototype.hasOwnProperty.call(zonaMat, zc)) {
      zonaMat[zc].opacity = 0.14 + 0.12 * (0.5 + 0.5 * Math.sin(nowT * 2.0));
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
    limpaZona();
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
    // 03/10: o que a regra do Santuário avisa (a correnteza e a rajada no instante em que levam)
    if (JOGO.Santuario3D && typeof ev.type === 'string' && ev.type.indexOf('santuario') === 0) JOGO.Santuario3D.evento(ev);
    switch (ev.type) {
      case 'battleStart':
        resetAll(ev.state || state());
        break;

      case 'turnStart':
        ovSig = '';
        // 22/09: a câmera não corre até quem esta tela não pode ver
        if (!ocultoTela(findUnit(ev.uid))) nudgeTo(ev.uid);
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
        // 22/09: de quem esta tela não vê, o solavanco da vítima não aponta a casa
        lastAtk = ocultoTela(u) ? null : { x: u ? u.x : ev.x, y: u ? u.y : ev.y, age: 0 };
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

      case 'placed':
        // 03/09: cada herói que mudou de casa na escolha da posição some e
        // reaparece na casa nova — o mesmo verbo do teletransporte
        (ev.moves || []).forEach(function (mv) {
          animQ.push({ kind: 'teleport', uid: mv.uid, fx: mv.fromX, fy: mv.fromY,
                       tx: mv.toX, ty: mv.toY, t: 0, dur: 0.44, age: 0 });
        });
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
        // 22/09: o fundido que segue invisível para esta tela não ganha clarão,
        // luz nem câmera na casa dele (o nó do outro sai no próximo syncUnits)
        if (ocultoTela(findUnit(ev.uid))) break;
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
    limpaPerigos();
    if (JOGO.Santuario3D) JOGO.Santuario3D.limpa();      // 03/10
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
      rebuildPerigos(st);                 // 02/10: o chão do Poço
      rebuildWalls(st);
      pintaAvisoEco(st);                  // 02/10: as casas do golpe grande do Eco
      // 03/10: as quatro regras do Santuário dos Elementos (santuario3d.js desmonta sozinho fora dele)
      if (JOGO.Santuario3D) JOGO.Santuario3D.quadro(st, dtv, nowT);
      vigiaAreaUtil(st);                  // 15/09: a HUD cresceu? reenquadra (só no desktop)
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
    updatePerigos();
    updateWalls();
    updateWeather(dtv);
    updateRot(dtv);
    updateFocus(dtv);
    updateCamera();
    animaSede(nowT);                      // 15/09: fogo, luz e recorte das paredes do salão

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
  // 02/10: o que o chão do Poço desenhou agora (as provas CONTAM, não olham foto)
  R.perigosNaTela = function () { return perNodes.slice(); };
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
