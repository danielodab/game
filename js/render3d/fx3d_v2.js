var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// JOGO.FX — efeitos da camada 3D do SOTERRA 2.0 (Three.js)
// Dono: Agente de Migração 3D.  Lei: docs/CONTRACT_V2.md §9.
//
// API do contrato (a mesma da camada 2D):
//   FX._attach(ctx)      o Renderer entrega {THREE, renderer, scene, camera, fx, decal}
//   FX.handleEvent(ev)   eventos do Engine
//   FX.update(dt, realDt) chamado pelo Renderer no fim de cada quadro
//   FX.getShake() -> {x,y}   tremida (o Renderer aplica na câmera)
//   FX.getTimeScale()        micro hit-stop
//   FX.setAmbient(theme)     partículas de ambiente por tema
//   FX.reset()               limpa tudo
//
// A GRANDE VANTAGEM DO 3D: o efeito tem LUZ DE VERDADE. A bola de fogo carrega
// uma PointLight que ilumina chão, paredes e personagens no caminho; a explosão
// dá um clarão que banha a cena; o gelo esfria a cor do ambiente por um
// instante. Para não recompilar shader a cada disparo, o número de luzes na
// cena é FIXO (pool de 6) — só a intensidade varia.
//
// Três técnicas combinadas, como pedido:
//   1. partículas 3D (um único THREE.Points com atributos por partícula)
//   2. malhas para projéteis (esfera emissiva, flecha, lâmina de corte)
//   3. bilhetes/decalques no chão (queimado, gelo, poça) sob as unidades
// ============================================================================

(function () {
  'use strict';
  var FX = {};
  JOGO.FX = FX;

  var THREE = null, scene = null, camera = null, fxG = null, decalG = null, R3 = null;
  var glr = null;                  // o WebGLRenderer: so para saber o tamanho do buffer
  var attached = false;
  var queued = [];

  var MAXP = 2600;                 // partículas simultâneas
  var LIGHT_POOL = 6;

  var ELEM = {
    neutro: '#d8dee4', fogo: '#ff8c3a', agua: '#57c8ec',
    terra: '#9bd06a', ar: '#c8b6ff'
  };
  function ecol(e) { return ELEM[e] || ELEM.neutro; }
  function col3(c) { return new THREE.Color(hexInt(c)).convertSRGBToLinear(); }
  function hexInt(c) {
    if (typeof c === 'number') return c;
    var s = String(c).charAt(0) === '#' ? String(c).slice(1) : String(c);
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    return isNaN(n) ? 0xffffff : n;
  }

  // --------------------------------------------------------------- partículas
  var pts = null, pPos = null, pCol = null, pSize = null, pTile = null, pGeo = null;
  var parts = [];                    // {x,y,z,vx,vy,vz,life,max,r,g,b,size,grav,drag,fade}
  var freeList = [];

  /* O atlas vem EMBUTIDO em base64 (assets/embedded/fx-atlas.js) porque buscar
   * um .png por fetch falha quando o jogo abre por file://. Se o arquivo nao
   * estiver na pagina, o sistema volta ao ponto gerado por codigo e nada quebra
   * — as paginas de teste antigas continuam funcionando sem carrega-lo. */
  var ATLAS_TEX = null, ATLAS_TENTADO = false;
  function atlasTexture() {
    if (ATLAS_TENTADO) return ATLAS_TEX;
    ATLAS_TENTADO = true;
    var A = (typeof JOGO !== 'undefined') ? JOGO.FX_ATLAS : null;
    if (!A || !A.png) return null;
    var img = new Image();
    var tex = new THREE.Texture(img);
    img.onload = function () { tex.needsUpdate = true; };
    img.src = A.png;
    tex.minFilter = THREE.LinearFilter;      // sem mipmap: o quadro e pequeno e
    tex.magFilter = THREE.LinearFilter;      // o borrao de nivel come o desenho
    tex.generateMipmaps = false;
    ATLAS_TEX = tex;
    return tex;
  }

  var DOT_TEX = null;
  function dotTexture() {
    if (DOT_TEX) return DOT_TEX;
    var cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    var c = cv.getContext('2d');
    var g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.72)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    DOT_TEX = new THREE.CanvasTexture(cv);
    return DOT_TEX;
  }

  /* O 320 que estava aqui era um numero solto, e ele MENTIA sobre o tamanho.
   * O fator honesto — o que faz uma particula de `size` metros desenhar `size`
   * metros na tela — e altura_do_buffer / (2 * tan(fov/2)). No quadro de celular
   * (640 px de altura, fov 42) isso da 833, nao 320: cada particula saia com 38%
   * do tamanho que o codigo pedia, e o desenho encolhia junto.
   * Medido no tabuleiro: com 320, uma particula de size 0,34 tinha 2,8 px de
   * tela — numa celula de 40 px. Meia-lua, runa e cascalho nao existem em 2,8 px.
   * Agora o fator vem do buffer de verdade e acompanha a resolucao: em tela
   * grande a particula cresce junto, em vez de virar poeira. */
  var PT_K = 320;
  var PART_VS = [
    'attribute float aSize;',
    'attribute float aTile;',
    'uniform float uPx;',
    'varying vec3 vColor;',
    'varying float vTile;',
    'void main() {',
    '  vColor = color;',
    '  vTile = aTile;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_PointSize = aSize * (uPx / max(0.001, -mv.z));',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  // O quadro do atlas entra como ATRIBUTO por particula, nao como material
  // separado: assim as dezesseis formas convivem numa unica chamada de desenho.
  // `uGrade` e 1 quando o atlas esta carregado e 0 quando caimos no ponto
  // gerado por codigo — com 0 a conta de UV se anula e a textura inteira e lida.
  var PART_FS = [
    'uniform sampler2D uMap;',
    'uniform float uGrade;',
    'varying vec3 vColor;',
    'varying float vTile;',
    'void main() {',
    '  vec2 uv = gl_PointCoord;',
    '  if (uGrade > 0.5) {',
    '    float n = 4.0;',
    '    float col = mod(vTile, n);',
    '    float row = floor(vTile / n);',
    '    uv = (vec2(col, row) + vec2(uv.x, 1.0 - uv.y)) / n;',
    '    uv.y = 1.0 - uv.y;',
    '  }',
    '  vec4 t = texture2D(uMap, uv);',
    '  gl_FragColor = vec4(vColor, 1.0) * t;',
    '  if (gl_FragColor.a < 0.01) discard;',
    '}'
  ].join('\n');

  // ------------------------------------------------------ QUADROS DO ATLAS
  // Cada familia aponta para o desenho que a LE. Antes tudo usava o mesmo
  // borrao radial: um corte, um terremoto e uma invocacao chegavam na tela com
  // a mesma mancha redonda, e so a cor os separava.
  var TILE = {
    ponto: 0, corte: 1, cascalho: 2, brasa: 3,
    runa: 4, brilho: 5, fumaca: 6, raio: 7,
    redemoinho: 8, anel: 9, risco: 10, estouro: 11,
    aura: 12, lingua: 13, halo: 14, cintila: 15
  };
  FX.TILE = TILE;

  function buildParticles() {
    pGeo = new THREE.BufferGeometry();
    pPos = new Float32Array(MAXP * 3);
    pCol = new Float32Array(MAXP * 3);
    pSize = new Float32Array(MAXP);
    pTile = new Float32Array(MAXP);
    for (var i = 0; i < MAXP; i++) {
      pPos[i * 3 + 1] = -9999;
      pSize[i] = 0;
      parts.push(null);
      freeList.push(i);
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
    pGeo.setAttribute('aTile', new THREE.BufferAttribute(pTile, 1));
    var atlas = atlasTexture();
    var mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: atlas || dotTexture() },
                  uGrade: { value: atlas ? 1 : 0 },
                  uPx: { value: PT_K } },
      vertexShader: PART_VS, fragmentShader: PART_FS,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending, vertexColors: true
    });
    pts = new THREE.Points(pGeo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 12;
    fxG.add(pts);
  }

  function spawn(o) {
    if (!freeList.length) return null;
    var i = freeList.pop();
    var col = col3(o.color || '#ffffff');
    parts[i] = {
      x: o.x, y: o.y, z: o.z,
      vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: 0, max: o.life || 0.7,
      r: col.r, g: col.g, b: col.b,
      size: o.size || 0.3, grav: o.grav == null ? -3.2 : o.grav,
      drag: o.drag == null ? 1.6 : o.drag,
      fade: o.fade == null ? 1 : o.fade,
      grow: o.grow || 0,
      tile: o.tile == null ? TILE.ponto : o.tile
    };
    pTile[i] = parts[i].tile;
    return i;
  }
  function burst(x, y, z, n, o) {
    o = o || {};
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var e = (o.flat ? 0.12 : 1) * (Math.random() * 0.9 + 0.15);
      var sp = (o.speed || 4) * (0.4 + Math.random() * 0.9);
      spawn({
        x: x + (Math.random() - 0.5) * (o.spread || 0.3),
        y: y + (Math.random() - 0.5) * (o.spread || 0.3) * 0.6,
        z: z + (Math.random() - 0.5) * (o.spread || 0.3),
        vx: Math.cos(a) * sp, vy: e * sp * (o.up == null ? 1 : o.up), vz: Math.sin(a) * sp,
        life: (o.life || 0.6) * (0.6 + Math.random() * 0.8),
        color: o.color, size: (o.size || 0.32) * (0.5 + Math.random()),
        grav: o.grav, drag: o.drag, grow: o.grow, tile: o.tile
      });
    }
  }

  function updateParticles(dt) {
    var n = 0;
    for (var i = 0; i < MAXP; i++) {
      var p = parts[i];
      if (!p) { pSize[i] = 0; pPos[i * 3 + 1] = -9999; continue; }
      p.life += dt;
      if (p.life >= p.max) { parts[i] = null; freeList.push(i); pSize[i] = 0; pPos[i * 3 + 1] = -9999; continue; }
      var d = Math.pow(0.0001, dt * p.drag * 0.25);
      p.vx *= d; p.vz *= d;
      p.vy = p.vy * d + p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02) { p.y = 0.02; p.vy = Math.abs(p.vy) * 0.25; }
      var k = 1 - p.life / p.max;
      var a = Math.pow(k, p.fade);
      pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z;
      pCol[i * 3] = p.r * a; pCol[i * 3 + 1] = p.g * a; pCol[i * 3 + 2] = p.b * a;
      pSize[i] = p.size * (1 + p.grow * (1 - k));
      n++;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
    pGeo.attributes.aSize.needsUpdate = true;
    return n;
  }

  // ------------------------------------------------------------ luzes (pool)
  var lightPool = [];
  function buildLights() {
    for (var i = 0; i < LIGHT_POOL; i++) {
      var l = new THREE.PointLight(0xffffff, 0, 14, 2);
      l.position.set(0, -50, 0);
      l.userData = { busy: false };
      fxG.add(l);
      lightPool.push(l);
    }
  }
  function takeLight(color, intensity, dist) {
    for (var i = 0; i < lightPool.length; i++) {
      if (lightPool[i].userData.busy) continue;
      var l = lightPool[i];
      l.userData.busy = true;
      l.color.copy(col3(color));
      l.intensity = intensity;
      l.distance = dist || 14;
      return l;
    }
    return null;
  }
  function freeLight(l) {
    if (!l) return;
    l.intensity = 0;
    l.position.set(0, -50, 0);
    l.userData.busy = false;
  }

  // ------------------------------------------------------------- projéteis
  var shots = [];               // {mesh, light, from, to, t, dur, onHit}
  var sphereGeo = null, arrowGeo = null;
  function projMesh(kind, color) {
    var mat = new THREE.MeshBasicMaterial({ color: col3(color), transparent: true, opacity: 0.95 });
    var g;
    if (kind === 'arrow') {
      if (!arrowGeo) { arrowGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.9, 6); arrowGeo.rotateX(Math.PI / 2); }
      g = arrowGeo;
    } else {
      if (!sphereGeo) sphereGeo = new THREE.SphereGeometry(0.24, 12, 10);
      g = sphereGeo;
    }
    var m = new THREE.Mesh(g, mat);
    m.renderOrder = 11;
    return m;
  }

  function launch(from, to, o) {
    o = o || {};
    var color = o.color || '#ffcc66';
    var color2 = o.color2 || null;              // segundo elemento (fusao)
    var mesh = projMesh(o.kind, color);
    mesh.position.copy(from);
    fxG.add(mesh);
    // casca externa na cor do segundo elemento: o projétil da fusão é bicolor
    var shell = null;
    if (color2) {
      shell = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({
        color: col3(color2), transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      shell.scale.setScalar(1.9);
      mesh.add(shell);
    }
    var light = takeLight(color, o.lightI || 2.6, o.lightD || 9);
    if (light) light.position.copy(from);
    var d = from.distanceTo(to);
    shots.push({
      mesh: mesh, shell: shell, light: light, from: from.clone(), to: to.clone(),
      t: 0, dur: Math.max(0.16, Math.min(0.8, d / (o.speed || 22))),
      arc: o.arc == null ? 0.5 : o.arc, color: color, color2: color2,
      trail: o.trail !== false, onHit: o.onHit || null
    });
  }
  function updateShots(dt) {
    for (var i = shots.length - 1; i >= 0; i--) {
      var s = shots[i];
      s.t += dt;
      var k = Math.min(1, s.t / s.dur);
      var px = s.from.x + (s.to.x - s.from.x) * k;
      var pz = s.from.z + (s.to.z - s.from.z) * k;
      var py = s.from.y + (s.to.y - s.from.y) * k + Math.sin(k * Math.PI) * s.arc;
      s.mesh.position.set(px, py, pz);
      if (s.light) s.light.position.set(px, py + 0.2, pz);
      if (s.trail) {
        // rastro: alterna as duas cores (a fusão deixa um rastro trançado)
        var use2 = s.color2 && ((s.t * 60) | 0) % 2 === 1;
        spawn({ x: px, y: py, z: pz, vx: (Math.random() - 0.5) * 0.9, vy: (Math.random() - 0.5) * 0.7,
                vz: (Math.random() - 0.5) * 0.9, life: 0.34,
                color: use2 ? s.color2 : s.color, size: 0.30, grav: 0.4, drag: 3 });
        if (s.color2) {
          // espiral do segundo elemento em volta do eixo do tiro
          var ph = s.t * 26;
          spawn({ x: px + Math.cos(ph) * 0.34, y: py + Math.sin(ph) * 0.34, z: pz,
                  vx: 0, vy: 0, vz: 0, life: 0.30, color: s.color2, size: 0.26, grav: 0.2, drag: 4 });
        }
      }
      if (s.light && s.color2) {
        // a luz pulsa entre as duas cores: o chão recebe as duas
        s.light.color.copy(mixCol(s.color, s.color2, 0.5 + 0.5 * Math.sin(s.t * 22)));
      }
      if (s.shell) s.shell.scale.setScalar(1.7 + Math.sin(s.t * 26) * 0.35);
      if (k >= 1) {
        if (s.onHit) { try { s.onHit(s.to); } catch (e) {} }
        fxG.remove(s.mesh);
        if (s.shell) s.shell.material.dispose();
        s.mesh.material.dispose();
        freeLight(s.light);
        shots.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------- clarões
  var flashes = [];             // {light, t, dur, peak}
  function flash(pos, color, peak, dur, dist) {
    var l = takeLight(color, 0, dist || 18);
    if (!l) return;
    l.position.copy(pos);
    flashes.push({ light: l, t: 0, dur: dur || 0.42, peak: peak || 40 });
  }
  function updateFlashes(dt) {
    for (var i = flashes.length - 1; i >= 0; i--) {
      var f = flashes[i];
      f.t += dt;
      var k = f.t / f.dur;
      if (k >= 1) { freeLight(f.light); flashes.splice(i, 1); continue; }
      f.light.intensity = f.peak * Math.pow(1 - k, 1.8);
    }
  }

  // ------------------------------------------------------------- ondas/decais
  var rings = [], decals = [];
  var ringGeo = null;
  function shockRing(pos, color, r0, r1, dur) {
    if (!ringGeo) { ringGeo = new THREE.RingGeometry(0.86, 1.0, 40); ringGeo.rotateX(-Math.PI / 2); }
    var m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: col3(color), transparent: true, opacity: 0.75,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    }));
    m.position.set(pos.x, 0.08, pos.z);
    m.scale.setScalar(r0 || 0.4);
    m.renderOrder = 8;
    fxG.add(m);
    rings.push({ m: m, t: 0, dur: dur || 0.5, r0: r0 || 0.4, r1: r1 || 3.0 });
  }
  function updateRings(dt) {
    for (var i = rings.length - 1; i >= 0; i--) {
      var r = rings[i];
      r.t += dt;
      var k = Math.min(1, r.t / r.dur);
      r.m.scale.setScalar(r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 2)));
      r.m.material.opacity = 0.75 * (1 - k);
      if (k >= 1) { fxG.remove(r.m); r.m.material.dispose(); rings.splice(i, 1); }
    }
  }
  var decalGeo = null;
  function scorch(pos, color, size, life) {
    if (!decalGeo) { decalGeo = new THREE.PlaneGeometry(1, 1); decalGeo.rotateX(-Math.PI / 2); }
    var m = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({
      map: dotTexture(), color: col3(color), transparent: true,
      opacity: 0.34, depthWrite: false
    }));
    m.position.set(pos.x, 0.05, pos.z);
    m.scale.setScalar(size || 2.2);
    m.renderOrder = 7;
    decalG.add(m);
    decals.push({ m: m, t: 0, dur: life || 4.5 });
    while (decals.length > 26) {
      var old = decals.shift();
      decalG.remove(old.m); old.m.material.dispose();
    }
  }
  function updateDecals(dt) {
    for (var i = decals.length - 1; i >= 0; i--) {
      var d = decals[i];
      d.t += dt;
      d.m.material.opacity = 0.34 * Math.max(0, 1 - d.t / d.dur);
      if (d.t >= d.dur) { decalG.remove(d.m); d.m.material.dispose(); decals.splice(i, 1); }
    }
  }
  FX.clearDecals = function () {
    for (var i = 0; i < decals.length; i++) { decalG.remove(decals[i].m); decals[i].m.material.dispose(); }
    decals.length = 0;
  };

  // ==================================================================== PLACAS
  /* MEDIDO, nao suposto (tests/efeitos_placa.html, quadro de celular 420x640):
   *   - a celula do tabuleiro mede 40 px e um metro do mundo mede 20 px;
   *   - uma particula de tamanho 0,34 desenhava 2,8 px de tela.
   * Meia-lua, runa e leque nao existem em 2,8 px: chegam como o mesmo pontinho,
   * e o que sobra para separar um meteoro de um sopro e a cor. Pior — medindo o
   * que cada familia PINTA na tela, 'bola', 'corte' e 'flecha' davam o mesmo
   * numero ate o pixel (17.535 px, lado de 209 px), porque o que se ve nelas nao
   * e o desenho: e a luz do impacto lavando o chao. O desenho ficava abaixo do
   * limiar de deteccao. Oito familias pintavam menos de 1.000 px, e a aura
   * pintava DOIS.
   *
   * (De quebra, a hipotese de que a mistura aditiva "satura tudo para branco"
   * NAO se confirmou no tabuleiro: 0% dos pixels do efeito chegavam ao branco.
   * Ela e verdadeira no close-up, que era onde estavamos olhando.)
   *
   * A PLACA e a resposta: um bilhete de 3 a 13 metros com a forma inteira, que
   * na tela mede de 60 a 260 px. Ai a FORMA tem tamanho para competir com a cor.
   *
   * Quatro jeitos de por a placa no mundo:
   *   'chao'    deitada no piso, girada para o alvo — runa, leque, anel, cruz
   *   'bilhete' de frente para a camera — meia-lua, estouro, halo, estrela
   *   'trilho'  em pe, a LARGURA ao longo do caminho — feixe, fio do gancho
   *   'mira'    em pe, ATRAVESSADA no caminho — a onda que passa
   *
   * O `forro` e o truque de contraste: a mesma forma desenhada antes, 16% maior,
   * em quase-preto e mistura normal. Ela escurece o chao exatamente onde o
   * desenho claro vai entrar, entao a forma aparece clara sobre escuro em vez de
   * somar com o piso iluminado — e ganha um contorno, como o resto da arte toon.
   */
  var PLACA_TEX = null, PLACA_TENTADO = false, PLACA_N = 4;
  function placaTexture() {
    if (PLACA_TENTADO) return PLACA_TEX;
    PLACA_TENTADO = true;
    var A = (typeof JOGO !== 'undefined') ? JOGO.FX_PLACAS : null;
    if (!A || !A.png) return null;      // sem o atlas o jogo segue: cai no borrao
    var img = new Image();
    var tex = new THREE.Texture(img);
    img.onload = function () { tex.needsUpdate = true; };
    img.src = A.png;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;        // a placa e GRANDE na tela; mipmap so borra
    PLACA_N = A.cols || 4;
    PLACA_TEX = tex;
    return tex;
  }

  var PL = {
    runas: 0, anel: 1, aro: 2, halo: 3,
    meialua: 4, virgula: 5, leque: 6, cruz: 7,
    raio: 8, estouro: 9, detrito: 10, estrela: 11,
    chama: 12, fumaca: 13, garras: 14, risco: 15
  };
  FX.PLACA = PL;

  /* ENQUADRAMENTO — medido no proprio atlas, quadro a quadro (a conta esta em
   * tests/efeitos_placa.html, secao "tinta"). O sprite do Kenney nao preenche o
   * quadro: `risco` ocupa 16% da ALTURA da celula e `raio` 18%. Pedir uma placa
   * de 1,2 m de altura para o fio do gancho entregava 0,19 m de desenho — 4 px
   * na tela. Era por isso que o feixe e o gancho mediam o MESMO que sem placa
   * nenhuma, ate o pixel: a placa estava la e nao dava para ver.
   *
   * [fracao da largura, fracao da altura, ganho de brilho]. O tamanho pedido em
   * `de`/`ate` passa a ser o tamanho da TINTA, nao o do quadro vazio ao redor
   * dela; o quadro cresce por baixo para entregar aquilo. O ganho compensa os
   * quadros de tinta rala (halo, virgula, fumaca ficam com alfa ~0,35). */
  var PL_ENQ = [
    [0.62, 0.62, 2.30], [0.69, 0.69, 1.00], [0.88, 0.88, 1.00], [0.73, 0.78, 2.10],
    [0.61, 0.27, 2.40], [0.46, 0.58, 2.20], [0.34, 0.55, 1.00], [0.89, 0.89, 1.00],
    [1.00, 0.18, 1.00], [0.39, 0.42, 1.00], [0.71, 0.80, 1.00], [0.59, 0.63, 1.00],
    [0.21, 0.50, 1.00], [0.72, 0.73, 2.20], [0.62, 0.62, 1.11], [0.53, 0.16, 1.00]
  ];
  /* Os quatro ganhos acima de 1,5 (runas, halo, virgula, fumaca) sao os quadros
   * de tinta rala e BORRADA. Medida no tabuleiro, a aura desenhava 44 px: o
   * halo estava la, de 6 metros, mas e um brilho tao macio que sobre um chao ja
   * iluminado nao chega a mudar 90 de 255 em pixel nenhum — existe e nao se ve.
   * A conta de partida foi 0,62 / (percentil 80 da tinta do quadro); estes
   * quatro subiram acima dela porque somam sobre um piso claro, nao sobre
   * preto. O branco estourado segue medido na folha e continua em 0%. */

  var PLACAS_ON = true;
  FX.setPlacas = function (v) { PLACAS_ON = (v !== false); };
  FX.placasLigadas = function () { return PLACAS_ON; };

  var PLACA_VS = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');
  // O atlas guarda cinza+alpha: a cor vem daqui, entao a MESMA forma serve aos
  // cinco elementos e as duas cores de uma fusao sem duplicar textura.
  var PLACA_FS = [
    'uniform sampler2D uMap;',
    'uniform vec2 uOff;',
    'uniform float uCel;',
    'uniform vec3 uCor;',
    'uniform float uOp;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec4 t = texture2D(uMap, uOff + vUv * uCel);',
    '  float a = t.a * uOp;',
    '  if (a < 0.004) discard;',
    '  gl_FragColor = vec4(uCor * t.rgb, a);',
    '}'
  ].join('\n');

  var geoBil = null, geoChao = null;
  function geosPlaca() {
    if (geoBil) return;
    geoBil = new THREE.PlaneGeometry(1, 1);
    // deitada: +X e a direita do desenho, -Z e o "para cima" dele, normal = +Y
    geoChao = new THREE.PlaneGeometry(1, 1);
    geoChao.rotateX(-Math.PI / 2);
  }
  // para onde o desenho aponta, em cada um dos tres jeitos de deitar a placa
  function angChao(dx, dz) { return Math.atan2(dx, dz) + Math.PI; }
  function angTrilho(dx, dz) { return Math.atan2(-dz, dx); }
  function angMira(dx, dz) { return Math.atan2(dx, dz); }
  function v3(x, y, z) { return new THREE.Vector3(x, y, z); }

  var placas = [];
  var MAX_PLACAS = 26;
  function placa(o) {
    if (!PLACAS_ON || !attached) return null;
    geosPlaca();
    var tex = placaTexture(), n = PLACA_N;
    var idx = o.tile || 0, cc = idx % n, rr = Math.floor(idx / n);
    var de0 = o.de || [3, 3], ate0 = o.ate || de0;
    // o pedido e o tamanho da TINTA; o quadro cresce por baixo para entrega-lo
    var eq = PL_ENQ[idx] || [1, 1, 1];
    var de = [de0[0] / eq[0], de0[1] / eq[1]];
    var ate = [ate0[0] / eq[0], ate0[1] / eq[1]];
    var ganho = eq[2];

    function faz(cor, escura) {
      var mat = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: tex || dotTexture() },
          // flipY do three deixa v=0 no rodape da imagem: a linha `rr` (contada
          // de cima) comeca em (n-1-rr)/n
          uOff: { value: new THREE.Vector2(tex ? cc / n : 0, tex ? (n - 1 - rr) / n : 0) },
          uCel: { value: tex ? 1 / n : 1 },
          uCor: { value: col3(cor) },
          uOp: { value: 0 }
        },
        vertexShader: PLACA_VS, fragmentShader: PLACA_FS,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: escura ? THREE.NormalBlending : THREE.AdditiveBlending
      });
      var m = new THREE.Mesh(o.modo === 'chao' ? geoChao : geoBil, mat);
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = (o.modo === 'chao' ? 8 : 13) + (escura ? 0 : 1);
      fxG.add(m);
      var k = escura ? 1.16 : 1;
      placas.push({
        m: m, mat: mat, modo: o.modo || 'bilhete',
        t: 0, atraso: o.atraso || 0, dur: o.dur || 0.6,
        w0: de[0] * k, h0: de[1] * k, w1: ate[0] * k, h1: ate[1] * k,
        p0: o.pos, p1: o.para || o.pos,
        ang: o.ang || 0, giro: o.giro || 0,
        op: escura ? (o.forro || 0.5) : (o.op == null ? 0.9 : o.op) * ganho,
        subida: o.subida == null ? 0.07 : o.subida,
        saida: o.saida == null ? 1.4 : o.saida,
        patamar: o.patamar == null ? 0.45 : o.patamar,
        curva: o.curva == null ? 2.2 : o.curva
      });
    }
    // teto: um feitico de area nao pode encher a cena de quadro transparente
    if (placas.length > MAX_PLACAS) return null;
    if (o.forro) faz(o.corForro || '#04050a', true);
    faz(o.color || '#ffffff', false);
    return true;
  }

  /* ------------------------------------------------------------- FILME
   *
   * Efeito ANIMADO quadro a quadro, contra o tile parado que o resto do arquivo
   * usa. A folha e 4x4 de 128 px, uma por (tipo, elemento), embutida em
   * `JOGO.FX_ANIM` — ver tools/embute_fx_anim.py para como ela e feita.
   *
   * Cinco tipos, e os cinco vieram do que o pacote realmente tem, nao de uma
   * lista que eu quisesse ter:
   *
   *   estouro  bola de fogo abrindo         chama  coluna de fogo subindo
   *   baque    espalhamento rasteiro        anel   toro que cresce
   *   onda     risco que atravessa
   *
   * A COR DO ELEMENTO VEM DE TINTA, e isso e uma correcao. Eu tinha escrito
   * aqui que nao ia tingir porque havia "uma folha por elemento" — o pacote
   * anuncia cinco variacoes de cor e eu supus cinco matizes. Medindo, sao TRES:
   * `fire` e `fire+smoke` sao o mesmo laranja, `blueish_flame` e `blueish_smoke`
   * o mesmo verde-azulado, e `magic` a lavanda. Com o mapa de cinco, `terra`
   * saia laranja IDENTICO a `fogo` — dois elementos indistinguiveis na tela.
   *
   * Entao entram so as tres matizes de verdade (15 folhas em vez de 25, 399 KB
   * em vez de 606) e a identidade de elemento sai da tabela `TINTA` abaixo.
   */
  /* elemento -> [folha, multiplicador por canal]
   *
   * O multiplicador e a razao entre a cor do elemento em js/core/data/elements.js
   * e a cor MEDIA MEDIDA da folha. Os dois lados sao numeros que ja existiam:
   *
   *   fogo   #ff8c3a / fire          (189,128,75)  -> 1.35, 1.09, 0.77
   *   terra  #9bd06a / fire          (189,128,75)  -> 0.82, 1.62, 1.41
   *   agua   #57c8ec / blueish_flame ( 31,154,116) -> 2.40, 1.11, 1.74
   *   ar     #c8b6ff / magic         (137,128,173) -> 1.46, 1.42, 1.47
   *   neutro #d8dee4 / magic         (137,128,173) -> 1.58, 1.73, 1.32
   *
   * Fator ACIMA DE 1 e proposital e funciona: `material.color` multiplica a
   * textura no shader e nao ha corte antes da escrita final, entao um valor
   * maior que 1 CLAREIA o canal em vez de saturar. Sem isso a agua nunca sairia
   * do verde-azulado da folha, porque multiplicar so sabe escurecer.
   *
   * A folha e escolhida por CARATER e nao por matiz: fogo e terra sao materia
   * solida aquecida (mesma folha, tintas opostas); agua, ar e neutro sao vapor.
   */
  var TINTA = {
    fogo:   ['fire',          1.35, 1.09, 0.77],
    terra:  ['fire',          0.82, 1.62, 1.41],
    agua:   ['blueish_flame', 2.40, 1.11, 1.74],
    ar:     ['magic',         1.46, 1.42, 1.47],
    neutro: ['magic',         1.58, 1.73, 1.32]
  };

  var ANIM_TEX = {}, ANIM_N = 4, filmes = [], preparou = false;
  var MAX_FILMES = 24;        // mesmo espirito do teto de placas (12/10: dois ou tres filmes por lance)

  function animTexture(chave) {
    if (ANIM_TEX[chave] !== undefined) return ANIM_TEX[chave];
    var A = (typeof JOGO !== 'undefined') ? JOGO.FX_ANIM : null;
    if (!A || !A[chave]) { ANIM_TEX[chave] = null; return null; }
    var img = new Image();
    var tex = new THREE.Texture(img);
    img.onload = function () { tex.needsUpdate = true; };
    img.src = 'data:image/jpeg;base64,' + A[chave];
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    // sRGB, COMO TODA TEXTURA DAQUI. Sem isto o three trata a folha como se ela
    // ja estivesse em linear e clareia tudo na saida: o laranja do fogo saia
    // AMARELO, o azul da agua saia ciano, e fogo e terra ficavam iguais na tela.
    // Eu culpei o aditivo primeiro e baixei a opacidade — a cor nao mudou, o que
    // provou que o problema era outro. E espaco de cor.
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    ANIM_N = (typeof JOGO !== 'undefined' && JOGO.FX_ANIM_GRADE) || 4;
    ANIM_TEX[chave] = tex;
    return tex;
  }

  /* Ha folha para este tipo neste elemento?
   * Exposto porque o teste precisa saber a diferenca entre "o efeito nao
   * apareceu" e "nao existe folha para esta combinacao" — sao defeitos
   * diferentes e a foto nao distingue os dois. */
  FX.temFilme = function (tipo, el) {
    var A = (typeof JOGO !== 'undefined') ? JOGO.FX_ANIM : null;
    var t = TINTA[el || 'neutro'] || TINTA.neutro;
    // a MESMA queda do filme(): a folha BRANCA do Blender, senão a da paleta, senão a assinada `:unico`
    return !!(A && (A[tipo + ':branco'] || A[tipo + ':' + t[0]] || A[tipo + ':unico']));
  };
  /* 12/10 — a cor de um filme BRANCO: a do elemento puxada para o branco (o núcleo da folha é
   * branco de verdade, e a mistura aditiva faz o resto; a cor cheia deixava o golpe opaco e sujo) */
  function corBranca(el, k) {
    var c = new THREE.Color(hexInt(ecol(el)));
    c.lerp(new THREE.Color(1, 1, 1), k == null ? 0.34 : k);   // medido na foto da sala: a 0,42 o golpe saía quase branco
    return c;
  }
  FX.tintaDe = function (el) { return TINTA[el] || TINTA.neutro; };
  /* 12/10 — A FOLHA QUE AINDA NÃO ABRIU. `animTexture` cria a imagem na primeira vez que o tipo é pedido e
   * ela decodifica DEPOIS (data URI, assíncrona); até lá o three desenha o plano com o mapa vazio — um
   * quadrado da cor do elemento, do tamanho do filme (fotografado em tests/fx_sala.html: um disco branco de
   * 4 m no chão). Duas defesas: as folhas do Blender são pedidas ao ligar o FX (preparaFilmes), e todo filme
   * nasce invisível até a imagem da folha dele estar completa (imagemPronta, conferida a cada quadro). */
  function imagemPronta(tex) {
    var im = tex && tex.image;
    return !!(im && im.complete && im.naturalWidth > 0);
  }
  FX.preparaFilmes = function () {
    var A = (typeof JOGO !== 'undefined') ? JOGO.FX_ANIM : null;
    if (!A || !THREE) return 0;
    var lista = (typeof JOGO !== 'undefined' && JOGO.FX_ANIM_BLENDER) || [];
    var n = 0;
    for (var i = 0; i < lista.length; i++) if (animTexture(lista[i] + ':branco')) n++;
    return n;
  };
  FX.filmesProntos = function () {
    var lista = (typeof JOGO !== 'undefined' && JOGO.FX_ANIM_BLENDER) || [];
    for (var i = 0; i < lista.length; i++) {
      var t = ANIM_TEX[lista[i] + ':branco'];
      if (t && !imagemPronta(t)) return false;
    }
    return true;
  };

  /* o.tipo   estouro|chama|baque|anel|onda
   * o.el     fogo|agua|terra|ar|neutro  (cai em neutro se nao houver folha)
   * o.pos    THREE.Vector3
   * o.tam    largura em metros (a altura acompanha, o quadro e quadrado)
   * o.dur    segundos da animacao inteira
   * o.modo   'bilhete' (de pe, encarando a camera) | 'chao' (deitado)  */
  function filme(o) {
    if (!attached || !o || !o.pos) return null;
    if (filmes.length > MAX_FILMES) return null;
    geosPlaca();
    var el = o.el || 'neutro';
    var t = TINTA[el] || TINTA.neutro;
    // 12/10 — a FOLHA BRANCA do Blender (`tipo:branco`) vem antes de tudo: é cinza+preto, e a cor
    // é a do elemento (corBranca) ou a que o chamador pedir em `o.cor` ('#rrggbb').
    var branca = false, tex = animTexture(o.tipo + ':branco');
    if (tex) branca = true;
    else tex = animTexture(o.tipo + ':' + t[0]);
    // FOLHA ASSINADA: os filmes do CGHEVEN vem numa cor autoral (escudo
    // dourado, portal laranja) e existem so como `tipo:unico`. Entram com
    // tinta BRANCA — tingir por elemento destruiria a assinatura, que e
    // exatamente o que elas trazem de melhor.
    var assinada = false;
    if (!tex) {
      tex = animTexture(o.tipo + ':unico');
      assinada = !!tex;
    }
    if (!tex) return null;

    // CLONE POR FILME. A textura clonada divide a imagem — nao custa memoria de
    // video de verdade — mas tem offset proprio. Sem isso, dois filmes ao mesmo
    // tempo brigariam pelo mesmo offset e piscariam juntos.
    var t2 = tex.clone();
    t2.needsUpdate = true;
    t2.repeat.set(1 / ANIM_N, 1 / ANIM_N);

    var mat = new THREE.MeshBasicMaterial({
      map: t2, transparent: true, depthWrite: false,
      // `setRGB` aceita valor acima de 1 e o shader nao corta antes da escrita
      // final: e assim que a agua sai do verde-azulado da folha para o azul do
      // elemento. Multiplicar so sabe escurecer; aqui precisa clarear.
      color: branca ? (o.cor ? new THREE.Color(hexInt(o.cor)) : corBranca(el, o.branco))
           : assinada ? new THREE.Color(1, 1, 1)
                      : new THREE.Color().setRGB(t[1], t[2], t[3]),
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      // 0,62 E NAO 1. Mistura aditiva soma no que ja esta na tela, e a folha
      // pre-multiplicada ja e clara: a 1 o laranja do fogo estourava para
      // AMARELO, o azul da agua para ciano, e a fumaca escura do `terra` sumia —
      // fogo e terra ficavam identicos na tela, que e o oposto do motivo de
      // haver cinco cores. A 0,62 cada elemento volta a ter a cor que o autor
      // rendeu. Medido com foto, nao chutado.
      opacity: (o.op == null ? (branca ? 0.9 : 0.62) : o.op)
    });
    var m = new THREE.Mesh(o.modo === 'chao' ? geoChao : geoBil, mat);
    m.frustumCulled = false;
    m.renderOrder = (o.modo === 'chao' ? 9 : 14);
    m.visible = imagemPronta(tex);          // 12/10: sem a imagem, nada de quadrado de cor
    var tam = o.tam || 3;
    // 12/10: `espelho` vira a folha de lado (o golpe da esquerda e o da direita saem da mesma folha);
    // `alt` estica a altura do bilhete (o raio e o pilar são mais altos que largos)
    var esp = o.espelho ? -1 : 1, altK = o.alt || 1;
    if (o.modo === 'chao') m.scale.set(tam * esp, 1, tam * altK); else m.scale.set(tam * esp, tam * altK, 1);
    m.position.copy(o.pos);
    if (o.modo === 'chao' && o.ang) m.rotation.y = o.ang;
    fxG.add(m);
    filmes.push({ m: m, mat: mat, tex: t2, t: 0,
                  dur: o.dur || 0.62, modo: o.modo || 'bilhete',
                  cresce: o.cresce || 0, tam: tam, esp: esp, altK: altK,
                  ang: o.ang || 0, op: (o.op == null ? (branca ? 0.9 : 0.62) : o.op) });
    return true;
  }
  FX.filme = filme;

  function updateFilmes(dt) {
    for (var i = filmes.length - 1; i >= 0; i--) {
      var f = filmes[i];
      f.t += dt;
      var k = f.t / f.dur;
      if (k >= 1) {
        fxG.remove(f.m); f.mat.dispose(); f.tex.dispose(); filmes.splice(i, 1); continue;
      }
      if (!f.m.visible && imagemPronta(f.tex)) f.m.visible = true;   // 12/10: a folha abriu no meio do filme
      var total = ANIM_N * ANIM_N;
      var q = Math.min(total - 1, Math.floor(k * total));
      var cc = q % ANIM_N, rr = Math.floor(q / ANIM_N);
      // flipY do three poe v=0 no rodape: a linha `rr`, contada de cima,
      // comeca em (N-1-rr)/N. Mesma conta da placa, mesmo motivo.
      f.tex.offset.set(cc / ANIM_N, (ANIM_N - 1 - rr) / ANIM_N);
      if (f.cresce) {
        var e = 1 + f.cresce * k;
        if (f.modo === 'chao') f.m.scale.set(f.tam * e * (f.esp || 1), 1, f.tam * e * (f.altK || 1));
        else f.m.scale.set(f.tam * e * (f.esp || 1), f.tam * e * (f.altK || 1), 1);
      }
      if (f.modo === 'bilhete' && camera) {
        f.m.quaternion.copy(camera.quaternion);
        if (f.ang) f.m.rotateZ(f.ang);
      }
    }
  }

  function limpaFilmes() {
    for (var i = filmes.length - 1; i >= 0; i--) {
      fxG.remove(filmes[i].m); filmes[i].mat.dispose(); filmes[i].tex.dispose();
    }
    filmes.length = 0;
  }

  function updatePlacas(dt) {
    for (var i = placas.length - 1; i >= 0; i--) {
      var p = placas[i];
      p.t += dt;
      var tt = p.t - p.atraso;
      if (tt < 0) { p.m.visible = false; continue; }
      var k = tt / p.dur;
      if (k >= 1) {
        fxG.remove(p.m); p.mat.dispose(); placas.splice(i, 1); continue;
      }
      var e = 1 - Math.pow(1 - k, p.curva);
      p.m.visible = true;
      var lw = p.w0 + (p.w1 - p.w0) * e, lh = p.h0 + (p.h1 - p.h0) * e;
      // A placa deitada teve a geometria girada em X, entao o "para cima" do
      // desenho virou o eixo Z e o Y virou a NORMAL. Escalar (w,h,1) nela deixa
      // um anel de 13 m de largura por 1 m de fundo — uma tira, nao um anel.
      if (p.modo === 'chao') p.m.scale.set(lw, 1, lh);
      else p.m.scale.set(lw, lh, 1);
      p.m.position.set(p.p0.x + (p.p1.x - p.p0.x) * e,
                       p.p0.y + (p.p1.y - p.p0.y) * e,
                       p.p0.z + (p.p1.z - p.p0.z) * e);
      var ang = p.ang + p.giro * tt;
      if (p.modo === 'bilhete' && camera) {
        p.m.quaternion.copy(camera.quaternion);
        p.m.rotateZ(ang);
      } else {
        p.m.rotation.set(0, ang, 0);
      }
      /* PATAMAR. A queda era (1-k)^saida desde o primeiro quadro: SONDADO, o
       * corte batia 1.109 px no quadro 4 e caia para 173 no quadro 8 — 0,17 s
       * de desenho legivel num efeito de 0,6 s. A media ao longo do efeito,
       * que e o que o jogador enxerga, ficava em 304 px. Agora a placa SEGURA
       * a opacidade cheia ate `patamar` da vida e so entao cai. */
      var sobe = p.subida > 0 ? Math.min(1, tt / p.subida) : 1;
      var cai = k <= p.patamar ? 1
              : Math.pow((1 - k) / (1 - p.patamar), p.saida);
      p.mat.uniforms.uOp.value = p.op * sobe * cai;
    }
  }
  function limpaPlacas() {
    for (var i = 0; i < placas.length; i++) { fxG.remove(placas[i].m); placas[i].mat.dispose(); }
    placas.length = 0;
  }

  // ------------------------------------------------------------- números
  // Cada número que sobe na tela custava um canvas + uma textura + um material
  // NOVOS. Num feitiço de área que pega seis alvos são seis uploads para a placa
  // no mesmo quadro — o tranco que se sente quando o efeito aparece.
  //
  // Os números se repetem muito (o mesmo dano, a mesma cor, o mesmo tamanho),
  // então guardamos a TEXTURA por conteúdo. O sprite e o material continuam por
  // instância, porque cada um tem opacidade própria enquanto sobe.
  var texCache = {};          // "texto|cor|tamanho" -> THREE.CanvasTexture
  var TEX_CACHE_MAX = 240;    // teto: uma batalha longa não vira vazamento
  var texCacheN = 0;

  function texDoNumero(text, color, big) {
    var chave = text + '|' + color + '|' + (big ? 'g' : 'p');
    var achada = texCache[chave];
    if (achada) return achada;
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 96;
    var c = cv.getContext('2d');
    c.font = 'bold ' + (big ? 62 : 46) + 'px Trebuchet MS, Verdana, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 7; c.strokeStyle = 'rgba(12,10,8,0.9)';
    c.strokeText(text, 128, 50);
    c.fillStyle = color;
    c.fillText(text, 128, 50);
    var tex = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;
    if (texCacheN >= TEX_CACHE_MAX) { limpaTexCache(); }
    texCache[chave] = tex;
    texCacheN++;
    return tex;
  }
  function limpaTexCache() {
    for (var k in texCache) {
      if (texCache.hasOwnProperty(k)) { try { texCache[k].dispose(); } catch (e) {} }
    }
    texCache = {}; texCacheN = 0;
  }

  var floaters = [];
  function floater(pos, text, color, big) {
    var tex = texDoNumero(String(text), color, big);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.position.copy(pos);
    sp.scale.set(big ? 2.2 : 1.6, big ? 0.82 : 0.6, 1);
    sp.renderOrder = 30;
    fxG.add(sp);
    floaters.push({ sp: sp, t: 0, dur: 1.05, vy: 1.5 });
  }
  function updateFloaters(dt) {
    for (var i = floaters.length - 1; i >= 0; i--) {
      var f = floaters[i];
      f.t += dt;
      f.sp.position.y += f.vy * dt;
      f.vy *= 0.94;
      var k = f.t / f.dur;
      f.sp.material.opacity = k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3);
      if (k >= 1) {
        fxG.remove(f.sp);
        // A textura agora e COMPARTILHADA entre todos os numeros iguais: quem
        // some nao pode joga-la fora, ou o proximo "24" apareceria em branco.
        // Quem limpa e limpaTexCache(), no teto ou ao sair da sala.
        f.sp.material.dispose();
        floaters.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------- tremida/tempo
  var shakeAmp = 0, shakeT = 0, shakeOut = { x: 0, y: 0 };
  var freezeT = 0;
  function addShake(a) { shakeAmp = Math.max(shakeAmp, a); }
  FX.getShake = function () { return shakeOut; };
  FX.getTimeScale = function () { return freezeT > 0 ? 0.14 : 1; };

  // ------------------------------------------------------------- ambiente
  var ambientTheme = null, ambT = 0;
  FX.setAmbient = function (theme) { ambientTheme = theme; };
  var AMB = {
    garden:  { color: '#a8ffb0', rate: 7,  up: 0.6,  size: 0.20 },
    cistern: { color: '#7ef0d4', rate: 6,  up: 0.35, size: 0.18 },
    forge:   { color: '#ff9a4a', rate: 12, up: 1.5,  size: 0.22 },
    scaffold:{ color: '#e6efff', rate: 5,  up: 0.2,  size: 0.16 },
    mine:    { color: '#c9a227', rate: 6,  up: 0.25, size: 0.20 },
    heart:   { color: '#ffd166', rate: 8,  up: 0.5,  size: 0.22 },
    // 15/09: o Salão da Sede — poeira dourada devagar na luz das lareiras (poucas: é salão, não forja)
    sede:    { color: '#ffc27a', rate: 3,  up: 0.28, size: 0.14 },
    // 03/10: a Câmara do Eco tem tema próprio agora; a poeira é a mesma do Coração, que ela vestia
    eco:     { color: '#ffd166', rate: 8,  up: 0.5,  size: 0.22 },
    // 03/10: o Santuário — pó claro e devagar, sem a cor de um quadrante só
    santuario: { color: '#e6e0ff', rate: 5, up: 0.3, size: 0.16 }
  };
  function updateAmbient(dt) {
    var a = AMB[ambientTheme];
    if (!a || !R3) return;
    ambT += dt * a.rate;
    var span = 12;
    while (ambT >= 1) {
      ambT -= 1;
      spawn({
        x: (Math.random() - 0.5) * span * 2, y: Math.random() * 0.6,
        z: (Math.random() - 0.5) * span * 2,
        vx: (Math.random() - 0.5) * 0.35, vy: a.up * (0.6 + Math.random() * 0.9),
        vz: (Math.random() - 0.5) * 0.35,
        life: 2.6 + Math.random() * 2.2, color: a.color, size: a.size,
        grav: 0.02, drag: 0.3, fade: 1.6
      });
    }
  }

  // ================================================================== ANEXO
  FX._attach = function (ctx) {
    if (attached) return;
    THREE = ctx.THREE;
    scene = ctx.scene; camera = ctx.camera;
    fxG = ctx.fx; decalG = ctx.decal || ctx.fx;
    R3 = ctx.renderer3d || JOGO.Renderer;
    glr = ctx.renderer || null;
    buildParticles();
    buildLights();
    attached = true;
    if (queued.length) {
      var q = queued.slice(); queued.length = 0;
      for (var i = 0; i < q.length; i++) FX.handleEvent(q[i]);
    }
  };

  // ELEMENTOS DE UM FEITICO. A fusao gera feitico composto (DATA.fusionForms x
  // DATA.fusionBlends): ar+agua tem de mostrar VENTO E AGUA ao mesmo tempo, com
  // as duas cores na luz dinamica. Ordem de busca: o evento diz > a unidade
  // fundida diz (elemPair) > o feitico diz > neutro.
  function spellElements(ev, spell) {
    var out = [];
    function push(e) { if (e && out.indexOf(e) < 0) out.push(e); }
    if (ev && ev.elements && ev.elements.length) { for (var i = 0; i < ev.elements.length; i++) push(ev.elements[i]); }
    if (ev && ev.elemPair && ev.elemPair.length) { for (var j = 0; j < ev.elemPair.length; j++) push(ev.elemPair[j]); }
    if (spell) {
      push(spell.element);
      var eff = spell.effects || [];
      for (var k = 0; k < eff.length; k++) push(eff[k].element);
    }
    if (ev && ev.element) push(ev.element);
    // o conjurador fundido carrega os dois elementos da mistura
    var u = ev && ev.uid ? unitOf(ev.uid) : null;
    if (u && u.elemPair) { for (var m = 0; m < u.elemPair.length; m++) push(u.elemPair[m]); }
    if (!out.length) out.push('neutro');
    return out.slice(0, 2);
  }
  function unitOf(uid) {
    var st = (JOGO.Game && JOGO.Game.state) || null;
    if (!st || !st.units) return null;
    for (var i = 0; i < st.units.length; i++) if (st.units[i].uid === uid) return st.units[i];
    return null;
  }
  // mistura das duas cores elementais (usada na luz dinamica)
  function mixCol(a, b, k) {
    var ca = col3(a), cb = col3(b);
    return ca.lerp(cb, k == null ? 0.5 : k);
  }

  // posição 3D de uma unidade (centro do peito) / de uma célula
  function unitPos(uid, hFrac) {
    if (!R3) return new THREE.Vector3();
    var w = R3.unitWorld ? R3.unitWorld(uid) : null;
    var h = R3.unitHeight ? R3.unitHeight(uid) : 1.7;
    if (!w) return new THREE.Vector3(0, 1, 0);
    var v = R3.world(w.x, w.y, 0);
    v.y = h * (hFrac == null ? 0.6 : hFrac);
    return v;
  }
  function cellPos(x, y, h) {
    if (!R3) return new THREE.Vector3();
    return R3.world(x, y, h || 0);
  }

  // =============================================== FAMILIAS DE FEITICO
  // Os 171 feiticos declaram 171 `fxKey` distintos ('lesserMeteor', 'ashCone',
  // 'emberRain'...), e o despacho antigo conhecia nove nomes genericos — nenhum
  // deles batia. Resultado: TODO feitico caia no mesmo `else` e virava a mesma
  // bolinha. O meteoro nao caia do ceu, o cone nao abria, a armadilha nao
  // plantava nada. Era a queixa "entre todos os que testei o efeito foi o mesmo".
  //
  // Em vez de escrever 171 efeitos a mao, o NOME do fxKey diz a que familia o
  // feitico pertence, e cada familia tem um desenho proprio. Feitico novo entra
  // sozinho na familia certa; quando nao encaixa em nenhuma cai na bola, que
  // volta a ser o ultimo recurso em vez do unico.
  //
  // A ORDEM importa: 'stoneSentinelCall' e invocacao, nao pedra; 'emberRain' e
  // chuva, nao brasa. O especifico vem antes do generico.
  var REGRAS_FX = [
    ['meteoro',    /meteor/i],
    ['chuva',      /rain|quiver|swarm|volley/i],
    ['invocacao',  /call$|summon|sentinel|golem|nymph|falcon|hound/i],
    ['armadilha',  /trap|stake|snare|alarm|ambush/i],
    ['cone',       /cone|breath|gale|mist|typhoon/i],
    ['cruz',       /cross/i],
    ['anel',       /ring|circle|cyclone|maelstrom|whirl|vortex|dome|nova|storm|eye/i],
    ['terremoto',  /quake|fissure|root|menhir|boulder|slab|spike|stone|mountain|wall|husk|bark/i],
    ['onda',       /wave|tide|pool|current|undertow|drown|brine|spring|cistern|siphon|maw/i],
    ['cura',       /heal|poultice|blessing|succor|tending|warm|sweet|restoring|calm|good/i],
    ['aura',       /pact|skin|veins|blood|fury|forge|heart|dance|word|curse|bore|brazier|retort/i],
    ['investida',  /step|swap|walk|run|charge|descend|throw|slam|hop|skip/i],
    ['flecha',     /arrow|shot|bolt|spark|lance|harpoon|pin|brand|mark/i],
    ['corte',      /blade|cut|slash|thrust|edge|dagger|hamstring|leech|scald|rust|flint|quick/i],
    ['feixe',      /beam|line|ray/i],
    // ---- vindos do `fxShape` das formas de FUSAO, que usam outro vocabulario
    ['estouro',    /^burst$|explod/i],
    ['escudo',     /shield|veil|guard/i],
    ['piscar',     /blink|teleport|phase/i],
    ['gancho',     /hook|grapple|pull|drag/i],
    ['maldicao',   /debuff|hex|rot|wither/i],
    ['aura',       /^buff$/i],
    ['cone',       /gust|wind/i]
  ];

  function familiaDe(fk) {
    if (!fk) return 'bola';
    // os nomes genericos antigos continuam valendo
    if (fk === 'melee') return 'corte';
    if (fk === 'slam') return 'investida';
    if (fk === 'beam' || fk === 'line') return 'feixe';
    if (fk === 'nova' || fk === 'ring' || fk === 'circle') return 'anel';
    if (fk === 'heal') return 'cura';
    if (fk === 'arrow') return 'flecha';
    for (var i = 0; i < REGRAS_FX.length; i++) {
      if (REGRAS_FX[i][1].test(fk)) return REGRAS_FX[i][0];
    }
    return 'bola';
  }
  FX.familiaDe = familiaDe;      // exposto para o teste conferir a cobertura

  /* Cai do ceu de vies e arrebenta: o desenho que o jogador espera de um
   * meteoro, e que ele nao estava vendo. */
  function meteoro(dest, el, el2, grande) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    var alto = new THREE.Vector3(dest.x + 3.0, 14, dest.z - 4.2);
    burst(alto.x, alto.y, alto.z, 16, { color: col, speed: 1.2, life: 0.7, size: 0.4, grav: -1,
                                        tile: TILE.brasa });
    // A PEDRA. A esfera do projetil tem 0,24 m de raio: cinco pixels de tela.
    // A lingua de fogo acompanha a queda com 5 m de altura, e ai da para ver o
    // que esta caindo.
    var voo = Math.max(0.16, Math.min(0.8, alto.distanceTo(dest) / (grande ? 30 : 24)));
    placa({ tile: PL.chama, color: col, modo: 'bilhete',
            pos: v3(alto.x, alto.y, alto.z), para: v3(dest.x, dest.y + 0.8, dest.z),
            de: [2.0, 4.6], ate: [2.8, 6.2], dur: voo * 1.05,
            op: 0.95, curva: 1, subida: 0.05, saida: 0.35 });
    launch(alto, dest, {
      color: col, color2: col2, kind: 'ball', speed: grande ? 30 : 24, arc: 0,
      onHit: function (pos) {
        impact(pos, el, grande ? 2.0 : 1.4, el2);
        filme({ tipo: 'impacto', el: el, modo: 'bilhete', tam: grande ? 5.0 : 3.8, dur: 0.42, cresce: 0.45, op: 0.9,
                ang: Math.random() * 6.28, pos: v3(pos.x, Math.max(1.0, pos.y + 0.6), pos.z) });
        shockRing(pos, col, 0.4, grande ? 4.6 : 3.0, 0.55);
        scorch(pos, col, grande ? 3.6 : 2.4, 6);
        placa({ tile: PL.estouro, color: col, modo: 'bilhete',
                pos: v3(pos.x, Math.max(1.0, pos.y + 0.8), pos.z),
                de: [2.6, 2.6], ate: grande ? [12.5, 12.5] : [9.0, 9.0],
                dur: 0.55, op: 1, saida: 1.6, forro: 0.55 });
        placa({ tile: PL.anel, color: col2 || col, modo: 'chao',
                pos: v3(pos.x, 0.10, pos.z), de: [2.0, 2.0],
                ate: grande ? [14, 14] : [10, 10], dur: 0.66, op: 0.9, saida: 1.4 });
        addShake(grande ? 9 : 6.5);
        freezeT = Math.max(freezeT, grande ? 0.09 : 0.05);
      }
    });
  }

  /* Varios corpos pequenos caindo sobre a area: chuva de brasa, revoada. */
  function chuva(dest, el, el2, n) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    n = n || 7;
    for (var i = 0; i < n; i++) {
      (function (k) {
        setTimeout(function () {
          var dx = (Math.random() - 0.5) * 2.6, dz = (Math.random() - 0.5) * 2.6;
          var chao = new THREE.Vector3(dest.x + dx, dest.y, dest.z + dz);
          var ceu = new THREE.Vector3(chao.x + 1.2, 11, chao.z - 1.6);
          var cor = (col2 && k % 3 === 2) ? col2 : col;
          placa({ tile: PL.chama, color: cor, modo: 'bilhete',
                  pos: v3(ceu.x, ceu.y, ceu.z), para: v3(chao.x, chao.y + 0.6, chao.z),
                  de: [0.9, 2.4], ate: [1.3, 3.2], dur: 0.5, op: 0.9,
                  curva: 1, subida: 0.04, saida: 0.4 });
          launch(ceu, chao, {
            color: cor, kind: 'ball', speed: 22, arc: 0,
            onHit: function (pos) {
              burst(pos.x, pos.y + 0.2, pos.z, 14, { color: col, speed: 3.2, life: 0.4, size: 0.24,
                                                    tile: TILE.brasa });
              shockRing(pos, col, 0.2, 1.1, 0.35);
              if (k % 2 === 0) filme({ tipo: 'impacto', el: el, modo: 'bilhete', tam: 1.6, dur: 0.3, cresce: 0.3, op: 0.7,
                                       ang: Math.random() * 6.28, pos: v3(pos.x, pos.y + 0.2, pos.z) });
              placa({ tile: PL.estouro, color: cor, modo: 'bilhete',
                      pos: v3(pos.x, Math.max(0.7, pos.y + 0.4), pos.z),
                      de: [0.9, 0.9], ate: [3.6, 3.6], dur: 0.34, op: 0.95, saida: 1.7 });
            }
          });
        }, k * 85);
      })(i);
    }
    // a area inteira marcada de uma vez: sem isto o jogador so ve pingos soltos
    // e nao entende ONDE a chuva cai
    placa({ tile: PL.anel, color: col, modo: 'chao', pos: v3(dest.x, 0.08, dest.z),
            de: [3.4, 3.4], ate: [8.0, 8.0], dur: 0.95, op: 0.6, saida: 1.0, curva: 1.6 });
    scorch(dest, col, 3.2, 5);
    addShake(4);
  }

  /* Sopro que ABRE a partir do conjurador na direcao do alvo. */
  function cone(from, dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    var dx = dest.x - from.x, dz = dest.z - from.z;
    var d = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
    dx /= d; dz /= d;
    // O LEQUE. Deitado no chao, apontado para o alvo, do tamanho da area que o
    // sopro pega: e este desenho que diz "cone" antes de qualquer particula.
    var meio = v3(from.x + dx * d * 0.52, 0.11, from.z + dz * d * 0.52);
    placa({ tile: PL.leque, color: col, modo: 'chao', pos: meio, ang: angChao(dx, dz),
            de: [d * 0.60, d * 0.70], ate: [d * 1.45, d * 1.55],
            dur: 0.78, op: 1, saida: 1.1, patamar: 0.5, forro: 0.5 });
    // segunda lingua, atrasada e mais estreita: o sopro PULSA em vez de abrir
    // uma vez so e sumir
    placa({ tile: PL.leque, color: col2 || col, modo: 'chao', pos: meio, ang: angChao(dx, dz),
            de: [d * 0.34, d * 0.42], ate: [d * 1.05, d * 1.15],
            dur: 0.62, atraso: 0.14, op: 0.9, saida: 1.2, patamar: 0.45 });
    var passos = 9;
    for (var i = 0; i < passos; i++) {
      (function (k) {
        setTimeout(function () {
          var t = (k + 1) / passos;
          var cx = from.x + dx * d * t, cz = from.z + dz * d * t;
          burst(cx, from.y + 0.1, cz, 12, {
            color: (col2 && k % 2) ? col2 : col,
            speed: 2.2, life: 0.42, size: 0.3,
            spread: 0.35 + t * 1.9,               // abre conforme avanca
            flat: true, up: 0.35, tile: TILE.fumaca
          });
        }, k * 26);
      })(i);
    }
  }

  /* Quatro bracos saindo do alvo: o desenho do feitico em cruz. */
  function cruz(dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    impact(dest, el, 1.2, el2);
    // os quatro bracos, num desenho so, deitados no chao: 9 m de cruz
    placa({ tile: PL.cruz, color: col, modo: 'chao', pos: v3(dest.x, 0.11, dest.z),
            de: [3.0, 3.0], ate: [9.5, 9.5], dur: 0.62, op: 0.95, saida: 1.4,
            giro: 0.5, forro: 0.5 });
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    dirs.forEach(function (dr, di) {
      for (var i = 1; i <= 4; i++) {
        (function (k, d2) {
          setTimeout(function () {
            burst(dest.x + d2[0] * k, dest.y + 0.15, dest.z + d2[1] * k, 9, {
              color: (col2 && di % 2) ? col2 : col,
              speed: 2.0, life: 0.4, size: 0.28, flat: true, up: 0.5, spread: 0.35,
              tile: TILE.lingua
            });
          }, k * 40);
        })(i, dr);
      }
    });
    scorch(dest, col, 2.6, 4);
  }

  /* O chao ERGUE: particulas subindo, marca no piso, tranco na camera. */
  function terremoto(dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    burst(dest.x, dest.y + 0.05, dest.z, 40, {
      color: col, speed: 5.5, life: 0.75, size: 0.36, up: 2.4, grav: 5.5, spread: 1.1,
      tile: TILE.cascalho
    });
    if (col2) burst(dest.x, dest.y + 0.05, dest.z, 24, {
      color: col2, speed: 4.2, life: 0.9, size: 0.32, up: 2.0, grav: 4.5, spread: 1.3,
      tile: TILE.cascalho
    });
    shockRing(dest, col, 0.3, 3.0, 0.5);
    scorch(dest, col, 2.6, 5);
    // a nuvem de cascalho tem de ter TAMANHO: 40 particulas de 7 px somem
    placa({ tile: PL.detrito, color: col, modo: 'bilhete', pos: v3(dest.x, 1.2, dest.z),
            de: [3.2, 2.6], ate: [8.6, 7.0], dur: 0.72, op: 0.95, saida: 1.5 });
    placa({ tile: PL.anel, color: col2 || col, modo: 'chao', pos: v3(dest.x, 0.10, dest.z),
            de: [1.6, 1.6], ate: [9.5, 9.5], dur: 0.6, op: 0.85, saida: 1.4 });
    addShake(7);
  }

  /* Lamina baixa e rapida correndo rente ao chao ate o alvo. */
  function onda(from, dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    // A PAREDE que atravessa: em pe, atravessada no caminho, ela ANDA de quem
    // conjura ate o alvo. E o unico jeito de ler "passou por aqui".
    var ox = dest.x - from.x, oz = dest.z - from.z;
    placa({ tile: PL.virgula, color: col, modo: 'mira', ang: angMira(ox, oz),
            pos: v3(from.x + ox * 0.12, 1.1, from.z + oz * 0.12),
            para: v3(dest.x, 1.2, dest.z),
            de: [5.6, 3.4], ate: [9.0, 5.2], dur: 0.66, op: 1,
            curva: 1, saida: 1.15, patamar: 0.5, forro: 0.45 });
    placa({ tile: PL.anel, color: col2 || col, modo: 'chao', pos: v3(dest.x, 0.09, dest.z),
            de: [1.4, 1.4], ate: [7.0, 7.0], dur: 0.5, atraso: 0.34, op: 0.85, saida: 1.4 });
    var passos = 8;
    for (var i = 0; i <= passos; i++) {
      (function (k) {
        setTimeout(function () {
          var t = k / passos;
          burst(from.x + (dest.x - from.x) * t, 0.18, from.z + (dest.z - from.z) * t, 14, {
            color: (col2 && k % 3 === 2) ? col2 : col,
            speed: 2.6, life: 0.5, size: 0.34, flat: true, up: 0.22, spread: 1.0,
            tile: TILE.redemoinho
          });
        }, k * 30);
      })(i);
    }
    setTimeout(function () { shockRing(dest, col, 0.4, 2.4, 0.45); }, passos * 30);
  }

  /* Rastro de corrida do conjurador ate o destino, e o baque na chegada. */
  function investida(from, dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    var ix = dest.x - from.x, iz = dest.z - from.z;
    var idist = Math.max(0.8, Math.sqrt(ix * ix + iz * iz));
    var passos = 7;
    // o risco da corrida cobre o caminho INTEIRO num desenho so
    placa({ tile: PL.risco, color: col, modo: 'trilho', ang: angTrilho(ix, iz),
            pos: v3((from.x + dest.x) / 2, from.y * 0.7 + 0.3, (from.z + dest.z) / 2),
            de: [idist * 0.4, 1.2], ate: [idist * 1.05, 2.2],
            dur: 0.36, op: 0.85, saida: 1.7 });
    // e as garras no fim, no tempo da pancada
    placa({ tile: PL.garras, color: col2 || col, modo: 'bilhete',
            pos: v3(dest.x, dest.y + 0.6, dest.z),
            de: [2.8, 2.8], ate: [7.0, 7.0], dur: 0.44, atraso: passos * 0.022,
            op: 1, saida: 1.7, ang: 0.2, forro: 0.5 });
    for (var i = 0; i <= passos; i++) {
      (function (k) {
        setTimeout(function () {
          var t = k / passos;
          burst(from.x + (dest.x - from.x) * t, from.y * 0.7 + 0.2,
                from.z + (dest.z - from.z) * t, 9, {
            color: (col2 && k % 2) ? col2 : col, speed: 1.5, life: 0.36, size: 0.28, spread: 0.4,
            tile: TILE.risco
          });
        }, k * 22);
      })(i);
    }
    setTimeout(function () {
      impact(dest, el, 1.5, el2); addShake(6);
      filme({ tipo: 'impacto', el: el, modo: 'bilhete', tam: 3.4, dur: 0.4, cresce: 0.4, op: 0.85,
              ang: Math.random() * 6.28, pos: v3(dest.x, dest.y + 0.4, dest.z) });
    }, passos * 22);
  }

  /* Arco de corte no alvo, no tempo do golpe corpo a corpo. */
  function corte(dest, el, el2) {
    var hd = R3 && R3.hitDelay ? R3.hitDelay() : 0.3;
    setTimeout(function () {
      var col = ecol(el);
      // A MEIA-LUA. Sete metros de arco que GIRA durante o golpe: e a diferenca
      // entre "cortou" e "aconteceu alguma coisa laranja".
      /* SONDADO: pedindo 8,2 m de ALTURA de meia-lua o enquadramento abria um
       * quadro de 30 m (a lua ocupa 27% da altura da celula) e esticava um
       * sprite de 256 px em 570 px de tela. Ela ficava enorme, borrada e mais
       * FRACA: 12,6 x 28,5 m de placa acesa a 92% pintavam 44 px. Um corte e
       * LARGO E RASO — pedir a proporcao do desenho, e nao um quadrado, e o que
       * faz a lamina existir. */
      placa({ tile: PL.meialua, color: col, modo: 'bilhete',
              pos: v3(dest.x, dest.y + 0.5, dest.z),
              de: [4.8, 1.9], ate: [6.4, 2.6], dur: 0.62, op: 1, saida: 1.1,
              patamar: 0.62, ang: -0.75, giro: 1.4, forro: 0.55 });
      if (el2) {
        placa({ tile: PL.meialua, color: ecol(el2), modo: 'bilhete',
                pos: v3(dest.x, dest.y + 0.7, dest.z),
                de: [3.4, 1.3], ate: [6.6, 2.5], dur: 0.5, atraso: 0.07, op: 0.9,
                saida: 1.4, patamar: 0.45, ang: 2.1, giro: -4.4 });
      }
      // arco: as particulas seguem um semicirculo, nao uma explosao redonda
      for (var i = 0; i < 14; i++) {
        var a = -0.5 + (i / 13) * 2.2;
        spawn({
          x: dest.x + Math.cos(a) * 1.0, y: dest.y + 0.2 + Math.sin(a) * 0.5,
          z: dest.z + Math.sin(a) * 0.5,
          vx: Math.cos(a) * 3.2, vy: 0.6, vz: Math.sin(a) * 3.2,
          life: 0.3, color: col, size: 0.42, tile: TILE.corte
        });
      }
      impact(dest, el, 1.0, el2);
    }, hd * 1000);
  }

  /* Armadilha: nao ha projetil nem estouro. Algo e PLANTADO e fica no chao. */
  function armadilha(dest, el, el2) {
    var col = ecol(el);
    shockRing(dest, col, 1.1, 0.7, 0.5);            // anel que FECHA, ao contrario
    scorch(dest, col, 1.7, 9);
    // O SELO. Roda devagar e demora 1,8 s a apagar — o oposto do estouro, que
    // e o que "armadilha" tem de dizer.
    // DUAS voltas de selo, girando em sentidos opostos. Uma so era linha fina
    // demais: 4 m de runa desenhavam 160 px na tela, e um selo tem camadas.
    placa({ tile: PL.runas, color: col, modo: 'chao', pos: v3(dest.x, 0.09, dest.z),
            de: [1.8, 1.8], ate: [7.4, 7.4], dur: 1.8, op: 1.1, saida: 0.5,
            patamar: 0.55, curva: 3.2, giro: 0.45, forro: 0.45 });
    placa({ tile: PL.runas, color: el2 ? ecol(el2) : col, modo: 'chao',
            pos: v3(dest.x, 0.11, dest.z),
            de: [1.0, 1.0], ate: [3.6, 3.6], dur: 1.7, atraso: 0.12, op: 0.95,
            saida: 0.5, patamar: 0.55, curva: 3.0, giro: -0.7 });
    burst(dest.x, dest.y + 0.15, dest.z, 12, {
      color: col, speed: 1.1, life: 0.7, size: 0.34, flat: true, up: 0.3, tile: TILE.runa
    });
    if (el2) burst(dest.x, dest.y + 0.2, dest.z, 8, { color: ecol(el2), speed: 0.9, life: 0.8,
                                                      size: 0.3, tile: TILE.runa });
  }

  /* Invocacao: coluna de luz subindo onde a criatura vai aparecer. */
  function invocacao(dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    // circulo de invocacao girando ao contrario da armadilha, e o halo subindo
    placa({ tile: PL.runas, color: col, modo: 'chao', pos: v3(dest.x, 0.10, dest.z),
            de: [1.0, 1.0], ate: [4.8, 4.8], dur: 0.95, op: 1, saida: 1.0,
            giro: -1.7, forro: 0.5 });
    placa({ tile: PL.halo, color: col2 || col, modo: 'bilhete',
            pos: v3(dest.x, 0.4, dest.z), para: v3(dest.x, 2.6, dest.z),
            de: [3.0, 3.0], ate: [5.4, 5.4], dur: 0.85, atraso: 0.12,
            op: 0.8, saida: 1.3 });
    for (var i = 0; i < 5; i++) {
      (function (k) {
        setTimeout(function () {
          burst(dest.x, dest.y + k * 0.55, dest.z, 12, {
            color: (col2 && k % 2) ? col2 : col,
            speed: 0.9, life: 0.6, size: 0.36, up: 2.2, grav: -1.4, spread: 0.7,
            tile: TILE.runa
          });
        }, k * 70);
      })(i);
    }
    shockRing(dest, col, 0.3, 2.0, 0.7);
  }

  /* Aura no PROPRIO conjurador: pacto, pele, sangue fervendo. Sem projetil —
   * era isto que sumia por completo, porque a bola generica precisa de um
   * destino e estes feiticos apontam para si mesmos. */
  function aura(from, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    // Esta era a pior de todas: medida no tabuleiro, a aura pintava DOIS pixels.
    // O halo no peito e o anel que FECHA em volta dos pes resolvem sem projetil.
    placa({ tile: PL.halo, color: col, modo: 'bilhete',
            pos: v3(from.x, from.y * 0.6 + 0.35, from.z),
            de: [2.8, 2.8], ate: [6.6, 6.6], dur: 1.15, op: 1.15, saida: 0.9,
            patamar: 0.65, giro: 1.1 });
    // TRES aneis que FECHAM em volta dos pes, um atras do outro. O que separa a
    // aura de todo o resto nao e a forma do anel — e o sentido: aqui a energia
    // entra, no estouro ela sai. Repetido tres vezes o olho pega o sentido.
    for (var a = 0; a < 3; a++) {
      placa({ tile: PL.anel, color: (a % 2 && col2) ? col2 : col, modo: 'chao',
              pos: v3(from.x, 0.10 + a * 0.01, from.z),
              de: [5.4, 5.4], ate: [1.5, 1.5], dur: 0.62, atraso: a * 0.19,
              op: 0.95, saida: 0.9, patamar: 0.5, curva: 1.4 });
    }
    for (var i = 0; i < 4; i++) {
      (function (k) {
        setTimeout(function () {
          burst(from.x, from.y * 0.55 + 0.25, from.z, 16, {
            color: (col2 && k % 2) ? col2 : col,
            speed: 1.4, life: 0.75, size: 0.34, up: 1.6, grav: -0.9, spread: 0.85,
            tile: TILE.aura
          });
        }, k * 90);
      })(i);
    }
    shockRing({ x: from.x, y: 0, z: from.z }, col, 1.6, 0.4, 0.6);
  }

  /* Estouro seco no alvo: sem projetil, a coisa ja acontece la. */
  function estouro(dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    placa({ tile: PL.estouro, color: col, modo: 'bilhete',
            pos: v3(dest.x, Math.max(0.8, dest.y + 0.6), dest.z),
            de: [2.4, 2.4], ate: [10.0, 10.0], dur: 0.5, op: 1, saida: 1.6, forro: 0.55 });
    placa({ tile: PL.anel, color: col2 || col, modo: 'chao', pos: v3(dest.x, 0.10, dest.z),
            de: [1.6, 1.6], ate: [9.0, 9.0], dur: 0.56, op: 0.9, saida: 1.4 });
    burst(dest.x, dest.y + 0.3, dest.z, 46, {
      color: col, speed: 6.5, life: 0.55, size: 0.42, spread: 0.5, tile: TILE.estouro
    });
    if (col2) burst(dest.x, dest.y + 0.4, dest.z, 30, {
      color: col2, speed: 5.0, life: 0.7, size: 0.38, spread: 0.7, tile: TILE.estouro
    });
    shockRing(dest, col, 0.3, 3.4, 0.45);
    scorch(dest, col, 2.4, 4);
    addShake(6);
  }

  /* Escudo: casca que FECHA em volta do alvo, subindo do chao. */
  function escudo(dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    // o aro grosso FECHANDO em volta do alvo — cresce ao contrario do estouro
    placa({ tile: PL.aro, color: col, modo: 'bilhete', pos: v3(dest.x, dest.y + 0.5, dest.z),
            de: [7.0, 7.0], ate: [3.6, 3.6], dur: 0.75, op: 0.9, saida: 0.85,
            curva: 1.8, forro: 0.4 });
    placa({ tile: PL.anel, color: col2 || col, modo: 'chao', pos: v3(dest.x, 0.10, dest.z),
            de: [5.6, 5.6], ate: [3.0, 3.0], dur: 0.62, op: 0.75, saida: 1.1 });
    for (var i = 0; i < 3; i++) {
      (function (k) {
        setTimeout(function () {
          // as particulas nascem num anel e sobem: leitura de casca, nao de estouro
          for (var j = 0; j < 14; j++) {
            var a = (j / 14) * Math.PI * 2;
            spawn({
              x: dest.x + Math.cos(a) * 1.15, y: dest.y - 0.4 + k * 0.3, z: dest.z + Math.sin(a) * 1.15,
              vx: -Math.cos(a) * 0.35, vy: 1.5, vz: -Math.sin(a) * 0.35,
              life: 0.65, color: (col2 && k % 2) ? col2 : col, size: 0.34, tile: TILE.halo
            });
          }
        }, k * 90);
      })(i);
    }
    shockRing(dest, col, 1.9, 0.8, 0.55);
  }

  /* Piscar: some de um lugar e aparece no outro, sem nada no caminho. */
  function piscar(from, dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    // a estrela SUME de um lado e NASCE do outro: o crescimento invertido conta
    // a historia sem nada percorrer o caminho
    placa({ tile: PL.estrela, color: col, modo: 'bilhete',
            pos: v3(from.x, from.y * 0.6 + 0.35, from.z),
            de: [5.0, 5.0], ate: [0.5, 0.5], dur: 0.32, op: 1, saida: 0.8, curva: 1.3 });
    burst(from.x, from.y * 0.6 + 0.2, from.z, 20, {
      color: col, speed: 2.4, life: 0.4, size: 0.34, spread: 0.5, grav: -0.5,
      tile: TILE.cintila
    });
    placa({ tile: PL.estrela, color: col2 || col, modo: 'bilhete',
            pos: v3(dest.x, dest.y + 0.5, dest.z),
            de: [0.6, 0.6], ate: [6.4, 6.4], dur: 0.44, atraso: 0.14, op: 1, saida: 1.5 });
    setTimeout(function () {
      burst(dest.x, dest.y + 0.2, dest.z, 24, {
        color: col2 || col, speed: 2.8, life: 0.45, size: 0.36, spread: 0.5, grav: -0.5,
        tile: TILE.cintila
      });
      shockRing(dest, col, 1.4, 0.3, 0.35);
    }, 140);
  }

  /* Gancho: um fio sai da mao e PUXA — a linha corre do alvo de volta. */
  function gancho(from, dest, el, el2) {
    /* MEDIDO: o gancho chamava `beam` e depois acrescentava um fio. As duas
     * familias saiam com 1,00 de semelhanca — eram o MESMO desenho, e nao ha
     * placa que conserte duas coisas que sao uma so. O gancho tem tres tempos
     * que o feixe nao tem: o arpeu VAI, MORDE e PUXA. */
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    var gx = dest.x - from.x, gz = dest.z - from.z;
    var gdd = Math.max(0.8, Math.sqrt(gx * gx + gz * gz));
    // 1. VAI: o fio cresce de quem lanca ate o alvo
    placa({ tile: PL.risco, color: col, modo: 'trilho', ang: angTrilho(gx, gz),
            pos: v3(from.x + gx * 0.16, from.y * 0.8, from.z + gz * 0.16),
            para: v3((from.x + dest.x) / 2, (from.y + dest.y) / 2, (from.z + dest.z) / 2),
            de: [gdd * 0.25, 0.9], ate: [gdd, 1.4], dur: 0.26, op: 1,
            saida: 1.0, patamar: 0.7, curva: 1.0 });
    // 2. MORDE: as garras fecham no alvo
    placa({ tile: PL.garras, color: col2 || col, modo: 'bilhete',
            pos: v3(dest.x, dest.y + 0.55, dest.z),
            de: [1.8, 1.8], ate: [4.6, 4.6], dur: 0.42, atraso: 0.2, op: 1,
            saida: 1.3, patamar: 0.45, ang: -0.6, forro: 0.5 });
    // 3. PUXA: o fio ESTICADO encolhe de volta, trazendo o alvo junto
    placa({ tile: PL.risco, color: col2 || col, modo: 'trilho', ang: angTrilho(gx, gz),
            pos: v3((from.x + dest.x) / 2, (from.y + dest.y) / 2, (from.z + dest.z) / 2),
            para: v3(from.x + gx * 0.28, from.y * 0.9, from.z + gz * 0.28),
            de: [gdd, 1.8], ate: [gdd * 0.55, 1.1], dur: 0.62, op: 1,
            atraso: 0.3, saida: 1.1, patamar: 0.5, curva: 1.4 });
    setTimeout(function () { impact(dest, el, 0.8, el2); addShake(4); }, 230);
    var passos = 6;
    for (var i = 0; i <= passos; i++) {
      (function (k) {
        setTimeout(function () {
          var t = 1 - k / passos;                 // do alvo PARA quem puxa
          burst(from.x + (dest.x - from.x) * t, from.y * 0.7 + 0.15,
                from.z + (dest.z - from.z) * t, 7, {
            color: col, speed: 1.2, life: 0.3, size: 0.3, spread: 0.3, tile: TILE.risco
          });
        }, 120 + k * 26);
      })(i);
    }
  }

  /* Maldicao: cai DE CIMA sobre o alvo, devagar, e assenta. */
  function maldicao(dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    // a fumaca DESCE sobre o alvo e o selo assenta no chao: nada explode
    placa({ tile: PL.fumaca, color: col, modo: 'bilhete',
            pos: v3(dest.x, dest.y + 3.4, dest.z), para: v3(dest.x, dest.y + 0.5, dest.z),
            de: [3.0, 3.0], ate: [6.4, 6.4], dur: 0.9, op: 0.85, saida: 1.1, curva: 1.2 });
    placa({ tile: PL.runas, color: col2 || col, modo: 'chao', pos: v3(dest.x, 0.09, dest.z),
            de: [5.0, 5.0], ate: [2.6, 2.6], dur: 0.9, atraso: 0.22, op: 0.75,
            saida: 0.8, giro: -0.9, curva: 1.5 });
    for (var i = 0; i < 3; i++) {
      (function (k) {
        setTimeout(function () {
          burst(dest.x, dest.y + 2.4 - k * 0.5, dest.z, 14, {
            color: (col2 && k % 2) ? col2 : col,
            speed: 0.7, life: 0.9, size: 0.34, up: -0.6, grav: 1.4, spread: 0.9,
            tile: TILE.fumaca
          });
        }, k * 110);
      })(i);
    }
    scorch(dest, col, 1.6, 5);
  }

  /* CAMADA ANIMADA POR FAMILIA — [tipo de folha, modo, tamanho em metros,
   * duracao, quanto cresce durante a animacao].
   *
   * Doze das 21 familias. `flecha`, `feixe` e `bola` sao PROJETEIS (o filme e
   * uma explosao parada, nao um tiro que viaja — mas a flecha ganhou o clarao
   * de BOCA na origem, ver tocaFamilia) e `piscar` e `gancho` seguem sem
   * folha que sirva. Meia integracao honesta e melhor que uma inteira forcada.
   *
   * As folhas `unico` (CGHEVEN, CC0) entraram em 24/08: o `escudo` que este
   * comentario esperava, o `cone` de vento virou tornado de verdade, e a
   * `invocacao` agora ABRE UM PORTAL no chao — a criatura chega por ele. */
  /* 12/10 — as folhas do BLENDER (assets/embedded/fx-blender.js, tools/fx_blender.py) entram aqui: cada
   * família pode tocar MAIS DE UM filme — [tipo, modo, tamanho, duração, cresce, atraso em s ('hit' = o
   * tempo do golpe chegar, R3.hitDelay), opções]. O golpe de contato virou a LÂMINA que varre (no tempo do
   * acerto, de um lado ou do outro); o terremoto RACHA o chão; a cura e a invocação sobem um PILAR de luz; a
   * armadilha e a maldição assentam um SELO de runas; o estouro ganha o IMPACTO seco por cima da explosão. */
  var FILME_FAM = {
    meteoro:   [['estouro', 'bilhete', 5.2, 0.55, 0.35], ['rachadura', 'chao', 7.0, 0.8, 0.25, 0.45]],
    estouro:   [['estouro', 'bilhete', 4.2, 0.50, 0.30], ['impacto', 'bilhete', 3.8, 0.42, 0.45, 0, { op: 0.8 }]],
    anel:      [['anel',    'chao',    5.0, 0.62, 0.55]],
    terremoto: [['rachadura', 'chao',  6.2, 0.75, 0.30], ['impacto', 'bilhete', 2.8, 0.36, 0.3, 0.05, { op: 0.6 }]],
    onda:      [['onda',    'bilhete', 3.6, 0.42, 0.25]],
    investida: [['onda',    'bilhete', 3.0, 0.38, 0.20]],
    aura:      [['chama',   'bilhete', 2.6, 0.80, 0.10], ['pilar', 'bilhete', 2.4, 0.9, 0.05, 0, { alt: 1.6, op: 0.7 }]],
    cura:      [['anel',    'chao',    3.2, 0.70, 0.30], ['pilar', 'bilhete', 2.6, 0.95, 0.05, 0.05, { alt: 1.7 }]],
    corte:     [['golpe',   'bilhete', 3.6, 0.40, 0.12, 'hit', { giro: 0.7, espelho: 'sorteio' }]],
    escudo:    [['escudo',  'bilhete', 3.0, 0.60, 0.15]],
    cone:      [['tornado', 'bilhete', 4.0, 0.66, 0.25]],
    invocacao: [['portal',  'chao',    3.4, 0.72, 0.30], ['pilar', 'bilhete', 3.0, 0.9, 0.1, 0.12, { alt: 1.6, op: 0.75 }]],
    armadilha: [['selo',    'chao',    4.4, 1.5, 0.08, 0, { op: 0.8 }]],
    maldicao:  [['selo',    'chao',    3.8, 1.1, 0.05, 0.1, { op: 0.6 }]],
    piscar:    [['impacto', 'bilhete', 2.6, 0.32, 0.3, 0.12, { op: 0.7 }]],
    gancho:    [['impacto', 'bilhete', 2.4, 0.3, 0.3, 0.23, { op: 0.6 }]]
  };
  /* toca os filmes de uma família em `dest` (as posições vêm em metros do mundo) */
  function filmesDaFamilia(fam, from, dest, el, el2) {
    var lista = FILME_FAM[fam];
    if (!lista || !dest) return;
    var hd = R3 && R3.hitDelay ? R3.hitDelay() : 0.3;
    for (var i = 0; i < lista.length; i++) {
      (function (ff) {
        var op = ff[6] || {};
        var atraso = ff[5] === 'hit' ? hd : (ff[5] || 0);
        var toca = function () {
          var alto = (ff[1] === 'chao') ? 0.06 : 1.05;
          var ang = op.giro ? (Math.random() - 0.5) * 2 * op.giro : 0;
          var esp = op.espelho === 'sorteio' ? (Math.random() < 0.5) : !!op.espelho;
          filme({ tipo: ff[0], el: el, modo: ff[1], tam: ff[2], dur: ff[3], cresce: ff[4], op: op.op, alt: op.alt,
                  ang: ang, espelho: esp, pos: v3(dest.x, (dest.y || 0) + alto, dest.z) });
          // ELEMENTO SECUNDARIO, quando a fusao gera feitico de dois elementos.
          // Menor e um pouco atrasado, para ler como o segundo elemento CHEGANDO
          // e nao como dois efeitos disputando o mesmo instante.
          if (el2 && el2 !== el) {
            filme({ tipo: ff[0], el: el2, modo: ff[1], tam: ff[2] * 0.72, dur: ff[3],
                    cresce: ff[4], op: (op.op || 0.62) * 0.7, alt: op.alt, ang: ang, espelho: !esp,
                    pos: v3(dest.x, (dest.y || 0) + alto + (ff[1] === 'chao' ? 0.02 : 0.5), dest.z) });
          }
        };
        if (atraso > 0) setTimeout(toca, atraso * 1000); else toca();
      })(lista[i]);
    }
    // 12/10 — o ELEMENTO escolhe um filme a mais: o AR traz o RAIO em todo tiro, feixe e anel;
    // a ÁGUA, o JATO em toda onda e anel (a família diz a forma; o elemento, a matéria)
    var ventoso = (el === 'ar' || el2 === 'ar'), aguado = (el === 'agua' || el2 === 'agua');
    if (ventoso && (fam === 'flecha' || fam === 'feixe' || fam === 'anel' || fam === 'chuva')) {
      var atrasoRaio = fam === 'flecha' ? 0.3 : 0.05;
      setTimeout(function () {
        filme({ tipo: 'raio', el: 'ar', modo: 'bilhete', tam: 3.2, alt: 1.9, dur: 0.42, cresce: 0.05, op: 0.95,
                espelho: Math.random() < 0.5, pos: v3(dest.x, (dest.y || 0) + 2.4, dest.z) });
      }, atrasoRaio * 1000);
    }
    if (aguado && (fam === 'onda' || fam === 'anel' || fam === 'sifao' || fam === 'estouro')) {
      setTimeout(function () {
        filme({ tipo: 'jato', el: 'agua', modo: 'bilhete', tam: 3.0, alt: 1.6, dur: 0.6, cresce: 0.1, op: 0.9,
                pos: v3(dest.x, (dest.y || 0) + 1.6, dest.z) });
      }, 180);
    }
  }

  /* Escolhe e toca o desenho da familia. */
  function tocaFamilia(fam, from, dest, el, el2, sp) {
    // O FILME ENTRA POR CIMA, nao no lugar. O desenho de particula e placa de
    // cada familia foi ajustado ao longo de muitas correcoes; trocar tudo por
    // filme seria jogar isso fora so para ganhar movimento.
    // O CLARAO DE BOCA: a familia `flecha` (o tiro do Cacador, o Chumbo do
    // Totem) ganha o muzzle NA ORIGEM — curto, pequeno, na altura da arma.
    // O projetil continua sendo particula; o clarao e o instante do disparo.
    if (fam === 'flecha' && from) {
      filme({ tipo: 'muzzle', el: el, modo: 'bilhete', tam: 1.7, dur: 0.30,
              cresce: 0.1, pos: v3(from.x, (from.y || 0) + 1.15, from.z) });
    }
    filmesDaFamilia(fam, from, dest, el, el2);
    switch (fam) {
      case 'meteoro':   meteoro(dest, el, el2, !!(sp && sp.unlockLevel >= 20)); break;
      case 'chuva':     chuva(dest, el, el2, 7); break;
      case 'cone':      cone(from, dest, el, el2); break;
      case 'cruz':      cruz(dest, el, el2); break;
      case 'anel':      nova(dest, ecol(el), el2 ? ecol(el2) : null); break;
      case 'terremoto': terremoto(dest, el, el2); break;
      case 'onda':      onda(from, dest, el, el2); break;
      case 'investida': investida(from, dest, el, el2); break;
      case 'corte':     corte(dest, el, el2); break;
      case 'armadilha': armadilha(dest, el, el2); break;
      case 'invocacao': invocacao(dest, el, el2); break;
      case 'aura':      aura(from, el, el2); break;
      case 'cura':
        healUp(dest, ecol(el));
        if (el2) healUp(dest, ecol(el2));
        break;
      case 'feixe':     beam(from, dest, ecol(el), el2 ? ecol(el2) : null); break;
      case 'estouro':   estouro(dest, el, el2); break;
      case 'escudo':    escudo(dest, el, el2); break;
      case 'piscar':    piscar(from, dest, el, el2); break;
      case 'gancho':    gancho(from, dest, el, el2); break;
      case 'maldicao':  maldicao(dest, el, el2); break;
      case 'flecha': {
        // a haste da flecha tem 4,5 cm de raio: meio pixel. O rastro em trilho e
        // o que faz o tiro existir na tela, e e ele que separa a flecha da bola.
        var fx2 = dest.x - from.x, fz2 = dest.z - from.z;
        var fd = Math.max(0.8, Math.sqrt(fx2 * fx2 + fz2 * fz2));
        placa({ tile: PL.risco, color: ecol(el), modo: 'trilho', ang: angTrilho(fx2, fz2),
                pos: v3((from.x + dest.x) / 2, (from.y + dest.y) / 2 + 0.15, (from.z + dest.z) / 2),
                de: [fd * 0.35, 1.6], ate: [fd * 1.02, 3.2], dur: 0.62, op: 1,
                saida: 1.25, patamar: 0.48 });
        launch(from, dest, {
          color: ecol(el), color2: el2 ? ecol(el2) : null, kind: 'arrow', speed: 34, arc: 0.25,
          onHit: function (pos) {
            impact(pos, el, 1.0, el2);
            // 12/10: o IMPACTO do Blender onde a flecha crava — o tiro passou a ter um fim
            filme({ tipo: 'impacto', el: el, modo: 'bilhete', tam: 2.6, dur: 0.34, cresce: 0.35, op: 0.85,
                    ang: Math.random() * 6.28, pos: v3(pos.x, pos.y + 0.2, pos.z) });
          }
        });
        break;
      }
      default:
        launch(from, dest, {
          color: ecol(el), color2: el2 ? ecol(el2) : null, kind: 'ball', speed: 22, arc: 0.6,
          onHit: function (pos) {
            impact(pos, el, 1.0, el2);
            filme({ tipo: 'impacto', el: el, modo: 'bilhete', tam: 3.0, dur: 0.38, cresce: 0.4, op: 0.85,
                    ang: Math.random() * 6.28, pos: v3(pos.x, pos.y + 0.3, pos.z) });
            // a bola e o ultimo recurso, mas ate ela deixa uma marca no chao
            placa({ tile: PL.anel, color: ecol(el), modo: 'chao', pos: v3(pos.x, 0.09, pos.z),
                    de: [1.0, 1.0], ate: [7.0, 7.0], dur: 0.6, op: 1, saida: 1.2,
                    patamar: 0.45 });
          }
        });
    }
  }

  // ========================================= A ASSINATURA DE CADA CLASSE (07/10)
  /* O dono: "estou achando muito genérico". A família decide o desenho pelo nome do feitiço e o
   * ELEMENTO decide a cor — então o corte do Bárbaro e o do Ladino eram a mesma meia-lua em outra
   * cor, e a fusão era o desenho da classe anfitriã com dois tons. Aqui cada classe ganha uma
   * ASSINATURA que entra POR CIMA da família, na cor da classe (não do elemento): o que a classe faz
   * com as mãos antes do golpe (na origem) e a marca que ela deixa no alvo. A fusão mistura: a
   * assinatura da anfitriã inteira, e a da convidada menor e um instante atrasada — a mesma leitura
   * do "segundo elemento chegando" que o filme já usa.
   *   sumo        golpe pesado: a poeira sobe dos pés e o chão RACHA sob o alvo
   *   arqueiro    o tiro: farpas de risco na origem e lascas secas no alvo
   *   bruxo       as runas giram no chão do conjurador e um resto de runa cai no alvo
   *   espadachim  a sombra: fumaça escura nos pés e garras saindo do escuro no alvo (forro)
   *   curandeiro  luz e pétalas que caem devagar em volta
   *   invocador   espíritos em órbita e o aro no chão
   *   minotauro   pedra: cascalho pesado e a cruz de poeira no alvo
   * Monstro não tem assinatura (o elenco já é a cara de cada um). Orçamento: no máximo duas placas e
   * ~30 partículas por assinatura — o celular ralo segue dentro do teto de MAXP. */
  var ASSINATURA = {
    sumo:       { acento: '#ffb347', tile: null, efeito: 'racha' },
    arqueiro:   { acento: '#dff5a8', tile: null, efeito: 'rastro' },
    bruxo:      { acento: '#c9a0ff', tile: null, efeito: 'runas' },
    espadachim: { acento: '#b9a3ff', tile: null, efeito: 'sombra' },
    curandeiro: { acento: '#fff1b8', tile: null, efeito: 'petalas' },
    invocador:  { acento: '#86e8d2', tile: null, efeito: 'espiritos' },
    minotauro:  { acento: '#d2ab7c', tile: null, efeito: 'pedra' }
  };
  FX.ASSINATURA = ASSINATURA;
  var ASSINATURA_ON = true;
  FX.setAssinatura = function (v) { ASSINATURA_ON = (v !== false); };

  /* as classes de quem conjura: [classe] no herói, [anfitriã, convidada] na fusão */
  function classesDe(u) {
    if (!u) return [];
    if (u.kind === 'hero') return u.classId ? [u.classId] : [];
    if (u.kind !== 'fusion') return [];
    var fonte = (Object.prototype.toString.call(u.heroIds) === '[object Array]') ? u.heroIds
              : (Object.prototype.toString.call(u.from) === '[object Array]') ? u.from : [];
    var out = [];
    for (var i = 0; i < fonte.length && out.length < 2; i++) {
      var v = fonte[i];
      if (typeof v !== 'string') continue;
      var alvo = unitOf(v);
      var cid = alvo ? (alvo.classId || alvo.heroId) : v;
      if (cid && out.indexOf(cid) < 0) out.push(cid);
    }
    return out;
  }
  FX.classesDe = classesDe;

  /* a assinatura de UMA classe: `peso` (1 = inteira; a convidada da fusão entra a 0,7) e `atraso` em ms */
  function assinatura(cid, from, dest, peso, atraso) {
    var a = ASSINATURA[cid];
    if (!a || !ASSINATURA_ON || !attached || !from) return false;
    peso = peso || 1;
    var cor = a.acento;
    var alvo = dest || from;
    var k = peso;
    setTimeout(function () {
      switch (a.efeito) {
        case 'racha':
          // a poeira dos pés na arrancada, e o chão rachando sob o alvo quando o golpe chega
          burst(from.x, 0.15, from.z, Math.round(12 * k), { color: cor, speed: 2.2, life: 0.5, size: 0.3, flat: true, up: 0.5,
                                                               tile: TILE.cascalho });
          if (dest) {
            var hd = R3 && R3.hitDelay ? R3.hitDelay() : 0.3;
            placa({ tile: PL.raio, color: cor, modo: 'chao', ang: Math.random() * Math.PI,
                    pos: v3(dest.x, 0.08, dest.z), de: [2.2 * k, 0.5 * k], ate: [7.5 * k, 1.3 * k],
                    dur: 0.5, atraso: hd, op: 1, saida: 1.2, forro: 0.5 });
            setTimeout(function () {
              burst(dest.x, 0.2, dest.z, Math.round(18 * k), { color: cor, speed: 4.2, life: 0.5, size: 0.34, flat: true,
                                                                 up: 0.9, tile: TILE.cascalho, grav: -5 });
              addShake(2.5 * k);
            }, hd * 1000);
          }
          break;
        case 'rastro':
          // farpas na origem (o arco solta) e lascas secas no alvo
          burst(from.x, from.y, from.z, Math.round(8 * k), { color: cor, speed: 2.6, life: 0.3, size: 0.26, tile: TILE.risco, grav: 0 });
          if (dest) {
            setTimeout(function () {
              burst(dest.x, dest.y, dest.z, Math.round(12 * k), { color: cor, speed: 6.0, life: 0.32, size: 0.28, tile: TILE.risco,
                                                                    grav: -4, drag: 2.5 });
              placa({ tile: PL.estrela, color: cor, modo: 'bilhete', pos: v3(dest.x, dest.y + 0.3, dest.z),
                      de: [0.8 * k, 0.8 * k], ate: [3.0 * k, 3.0 * k], dur: 0.22, op: 1, saida: 2.0 });
            }, 180);
          }
          break;
        case 'runas':
          // as runas giram no chão do conjurador; um resto de runa cai sobre o alvo
          placa({ tile: PL.runas, color: cor, modo: 'chao', pos: v3(from.x, 0.09, from.z),
                  de: [2.4 * k, 2.4 * k], ate: [4.6 * k, 4.6 * k], dur: 0.9, op: 1, saida: 0.8, patamar: 0.5, giro: 2.2 });
          burst(from.x, 0.3, from.z, Math.round(10 * k), { color: cor, speed: 0.8, life: 0.8, size: 0.3, up: 2.2, grav: 0.4,
                                                             tile: TILE.runa, spread: 1.2 });
          if (dest) {
            setTimeout(function () {
              burst(dest.x, dest.y + 1.2, dest.z, Math.round(8 * k), { color: cor, speed: 0.6, life: 0.7, size: 0.3, up: -1.5,
                                                                         grav: -2.5, tile: TILE.runa, spread: 0.8 });
            }, 220);
          }
          break;
        case 'sombra':
          // a sombra: fumaça escura nos pés (forro escuro), e as garras saindo do escuro no alvo
          placa({ tile: PL.fumaca, color: cor, modo: 'bilhete', pos: v3(from.x, from.y * 0.5, from.z),
                  de: [2.2 * k, 2.2 * k], ate: [3.6 * k, 3.6 * k], dur: 0.45, op: 0.55, saida: 1.0, forro: 0.9 });
          burst(from.x, 0.2, from.z, Math.round(10 * k), { color: '#5a4a86', speed: 1.6, life: 0.5, size: 0.4, flat: true,
                                                             tile: TILE.fumaca, grav: 0.4 });
          if (dest) {
            setTimeout(function () {
              placa({ tile: PL.garras, color: cor, modo: 'bilhete', pos: v3(dest.x, dest.y + 0.5, dest.z),
                      de: [1.6 * k, 1.6 * k], ate: [5.4 * k, 5.4 * k], dur: 0.36, op: 0.9, saida: 1.6,
                      ang: Math.random() * 1.2 - 0.6, forro: 0.85 });
              burst(dest.x, dest.y, dest.z, Math.round(10 * k), { color: '#6a5a9a', speed: 2.0, life: 0.5, size: 0.38,
                                                                    tile: TILE.fumaca, grav: 0.2 });
            }, 120);
          }
          break;
        case 'petalas':
          // luz e pétalas que caem devagar em volta de quem conjura e de quem recebe
          [from, dest].forEach(function (p, i) {
            if (!p || (i === 1 && p === from)) return;
            placa({ tile: PL.halo, color: cor, modo: 'bilhete', pos: v3(p.x, p.y + 0.4, p.z),
                    de: [1.8 * k, 1.8 * k], ate: [3.6 * k, 3.6 * k], dur: 0.8, atraso: i * 0.15, op: 0.9, saida: 0.9, patamar: 0.5 });
            for (var n = 0; n < Math.round(12 * k); n++) {
              var ang = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 1.2;
              spawn({ x: p.x + Math.cos(ang) * r, y: p.y + 1.6 + Math.random() * 0.8, z: p.z + Math.sin(ang) * r,
                      vx: (Math.random() - 0.5) * 0.4, vy: -0.3, vz: (Math.random() - 0.5) * 0.4,
                      life: 1.1 + Math.random() * 0.5, color: n % 3 ? cor : '#ffffff', size: 0.3, grav: -0.5, drag: 0.6,
                      tile: n % 2 ? TILE.brilho : TILE.cintila });
            }
          });
          break;
        case 'espiritos':
          // o aro no chão e os espíritos em órbita, que sobem
          placa({ tile: PL.aro, color: cor, modo: 'chao', pos: v3(from.x, 0.09, from.z),
                  de: [2.0 * k, 2.0 * k], ate: [4.0 * k, 4.0 * k], dur: 0.8, op: 1, saida: 0.9, patamar: 0.45, giro: -1.6 });
          for (var e = 0; e < Math.round(10 * k); e++) {
            var ae = (e / Math.round(10 * k)) * Math.PI * 2, re = 1.1;
            spawn({ x: from.x + Math.cos(ae) * re, y: 0.4 + (e % 3) * 0.3, z: from.z + Math.sin(ae) * re,
                    vx: -Math.sin(ae) * 2.4, vy: 1.4, vz: Math.cos(ae) * 2.4,
                    life: 0.9, color: cor, size: 0.36, grav: 0.2, drag: 0.3, tile: TILE.redemoinho });
          }
          if (dest && dest !== from) {
            setTimeout(function () {
              burst(dest.x, dest.y + 0.3, dest.z, Math.round(8 * k), { color: cor, speed: 1.2, life: 0.6, size: 0.3, up: 1.8,
                                                                         tile: TILE.redemoinho });
            }, 200);
          }
          break;
        case 'pedra':
          // pedra: o cascalho pesado que cai perto, e a cruz de poeira sob o alvo
          burst(from.x, 0.3, from.z, Math.round(14 * k), { color: cor, speed: 3.0, life: 0.6, size: 0.36, up: 1.2,
                                                             tile: TILE.cascalho, grav: -6 });
          if (dest) {
            var hd2 = R3 && R3.hitDelay ? R3.hitDelay() : 0.3;
            placa({ tile: PL.cruz, color: cor, modo: 'chao', pos: v3(dest.x, 0.08, dest.z),
                    de: [2.0 * k, 2.0 * k], ate: [6.0 * k, 6.0 * k], dur: 0.5, atraso: hd2, op: 0.95, saida: 1.3, forro: 0.45 });
            setTimeout(function () {
              burst(dest.x, 0.15, dest.z, Math.round(16 * k), { color: cor, speed: 3.2, life: 0.6, size: 0.4, flat: true, up: 0.7,
                                                                  tile: TILE.cascalho, grav: -5 });
              burst(dest.x, 0.1, dest.z, Math.round(10 * k), { color: '#e8d8c0', speed: 1.4, life: 0.8, size: 0.5, flat: true,
                                                                 tile: TILE.fumaca, grav: 0.1 });
              addShake(3 * k);
            }, hd2 * 1000);
          }
          break;
      }
    }, atraso || 0);
    return true;
  }
  /* a assinatura de quem conjura: o herói inteira; a fusão com a MISTURA (anfitriã inteira, convidada a 0,7 e
   * 120 ms depois). `from`/`dest` são posições do mundo. */
  function assinaturaDe(uid, from, dest) {
    var cls = classesDe(unitOf(uid));
    if (!cls.length) return false;
    assinatura(cls[0], from, dest, 1, 0);
    if (cls[1] && cls[1] !== cls[0]) assinatura(cls[1], from, dest, 0.7, 120);
    return true;
  }
  FX.debugAssinatura = function (cid, gx, gy, tx, ty) {
    assinatura(cid, cellPos(gx, gy, 0.9), (tx != null) ? cellPos(tx, ty, 0.7) : null, 1, 0);
  };

  // ================================================================ EVENTOS
  FX.handleEvent = function (ev) {
    if (!ev) return;
    if (!attached) { if (queued.length < 300) queued.push(ev); return; }
    if (!preparou) { preparou = true; try { FX.preparaFilmes(); } catch (ePrep) {} }   // 12/10: as folhas do Blender abrem no 1º evento
    var D = JOGO.DATA || {};
    var u, p, tgt, col;

    switch (ev.type) {
      case 'battleStart':
        FX.reset();
        break;

      case 'cast': {
        u = ev.uid ? unitPos(ev.uid, 0.72) : null;
        // Engine.spell resolve em QUALQUER fonte: classes, monstros, pets, itens
        // e — o que faltava aqui — os feiticos gerados da fusao. Antes so
        // DATA.spells era consultado, entao as 2625 fusoes vinham sem definicao
        // e caiam todas no 'bolt' padrao: a mesma flecha para o jogo inteiro.
        var sp = ev.spell ||
                 (JOGO.Engine && JOGO.Engine.spell ?
                    (function () { try { return JOGO.Engine.spell(ev.spellId); } catch (e) { return null; } })() : null) ||
                 (D.spells && D.spells[ev.spellId]) || null;
        var fk = (sp && sp.fxKey) || (sp && sp.fxShape) || ev.fxKey || 'bolt';
        var els = spellElements(ev, sp);
        var el = els[0], el2 = els[1] || null;
        col = ecol(el);
        var col2 = el2 ? ecol(el2) : null;
        if (!u) break;
        // carga na mão do conjurador (as duas cores quando é fusão)
        burst(u.x, u.y, u.z, 14, { color: col, speed: 1.6, life: 0.36, size: 0.26, grav: 0.6, spread: 0.3 });
        if (col2) burst(u.x, u.y, u.z, 12, { color: col2, speed: 1.2, life: 0.46, size: 0.24, grav: 0.3, spread: 0.34 });
        var dest = (ev.x != null) ? cellPos(ev.x, ev.y, 0.7) : null;
        if (!dest) {
          // Sem celula de destino ainda ha desenho a fazer: os feiticos de
          // pacto/pele/sangue agem sobre quem conjura. Antes o `break` aqui
          // apagava o efeito inteiro deles.
          var famSo = familiaDe(fk);
          if (famSo === 'aura' || famSo === 'cura') tocaFamilia(famSo, u, u, el, el2, sp);
          else aura(u, el, el2);
          assinaturaDe(ev.uid, u, null);          // 07/10: a assinatura da classe, só na origem
          break;
        }
        tocaFamilia(familiaDe(fk), u, dest, el, el2, sp);
        assinaturaDe(ev.uid, u, dest);            // 07/10: a assinatura da classe (e a mistura da fusão) por cima
        break;
      }

      case 'damage': {
        p = unitPos(ev.uid, 0.9);
        col = ecol(ev.element || 'neutro');
        if (ev.amount > 0) {
          floater(p, '-' + ev.amount, ev.amount >= 40 ? '#ffd166' : '#ffffff', ev.amount >= 40);
          burst(p.x, p.y, p.z, 10 + Math.min(18, ev.amount / 3), {
            color: col, speed: 3.4, life: 0.45, size: 0.24, spread: 0.4
          });
          addShake(Math.min(9, 2.2 + ev.amount * 0.08));
          if (ev.amount >= 45) freezeT = Math.max(freezeT, 0.07);
        }
        /* 19/09: A COBERTURA BAIXA. O motor manda `coberto: true` (e a `reducao`) quando a
         * vítima estava atrás de um '=' (Engine.coberto): o número menor precisa de um
         * porquê na tela, senão parece dano errado. Um segundo flutuante, miúdo e cinza,
         * logo abaixo do número: "cobertura −25%". */
        if (ev.coberto) {
          floater({ x: p.x, y: p.y - 0.55, z: p.z },
                  'cobertura −' + ((JOGO.Engine && JOGO.Engine.COBERTURA_PCT) || 25) + '%', '#b8c4d0', false);
        }
        break;
      }

      case 'heal':
        p = unitPos(ev.uid, 0.5);
        floater(p, '+' + (ev.amount || 0), '#7ef0a0');
        healUp(p, '#7ef0a0');
        break;

      case 'shield':
        p = unitPos(ev.uid, 0.6);
        shockRing(p, '#9be8ff', 0.3, 1.3, 0.5);
        burst(p.x, p.y, p.z, 18, { color: '#9be8ff', speed: 1.4, life: 0.6, size: 0.24, grav: 0.3 });
        break;

      case 'death':
        p = unitPos(ev.uid, 0.5);
        burst(p.x, p.y, p.z, 46, { color: '#ffffff', speed: 4.6, life: 0.9, size: 0.30, spread: 0.5 });
        scorch(p, '#20160f', 2.4, 6);
        flash(p, '#ffe0b0', 5.5, 0.4, 11);
        addShake(7);
        break;

      case 'weatherShift':
        addShake(4);
        break;

      case 'weatherTick':
        if (ev.amount) {
          p = unitPos(ev.uid, 0.9);
          floater(p, (ev.amount > 0 ? '+' : '') + ev.amount, ev.amount > 0 ? '#9be8ff' : '#ffae7a');
        }
        break;

      case 'dodgeFail':
        p = unitPos(ev.uid, 0.6);
        floater(p, 'preso!', '#ff9a5a');
        burst(p.x, p.y, p.z, 14, { color: '#ff9a5a', speed: 2.2, life: 0.45, flat: true });
        break;

      case 'dodgeOk':
        p = unitPos(ev.uid, 0.6);
        burst(p.x, 0.1, p.z, 10, { color: '#cfe4ff', speed: 2.6, life: 0.32, flat: true, up: 0.2 });
        break;

      case 'markStack':
        p = unitPos(ev.uid, 1.0);
        burst(p.x, p.y, p.z, 10, { color: '#ff9ad0', speed: 1.4, life: 0.45, size: 0.24, grav: -0.6 });
        break;

      case 'tileEvent':
      case 'trapTriggered':
        p = unitPos(ev.uid, 0.3);
        shockRing(p, '#ffd76b', 0.3, 2.0, 0.5);
        burst(p.x, 0.2, p.z, 20, { color: '#ffd76b', speed: 3.0, life: 0.6 });
        break;

      /* 02/10 — O CHÃO DO POÇO (js/core/poco.js). O aviso é um anel baixo na
       * origem (o resto é a casa pintada, no renderer); o disparo varre as
       * casas marcadas com a cor de quem fere: vermelho das setas, a cor do
       * elemento do jato, poeira escura do chão que cai. */
      case 'perigoAviso':
        if (ev.x != null) shockRing(cellPos(ev.x, ev.y, 0.15), ev.tipo === 'placa' ? '#ff4a3a' : (ev.tipo === 'rachado' ? '#ff9a3a' : ecol(ev.elemento)), 0.2, 1.4, 0.6);
        break;

      case 'perigoDispara':
        (function (ev2) {
          var cor = ev2.tipo === 'placa' ? '#ff6a4a' : (ev2.tipo === 'rachado' ? '#4a3a2a' : ecol(ev2.elemento));
          var casas = ev2.casas || [];
          for (var ci = 0; ci < casas.length; ci++) {
            var cp = cellPos(casas[ci].x, casas[ci].y, 0.2);
            burst(cp.x, 0.2, cp.z, ev2.tipo === 'jato' ? 22 : 12, {
              color: cor, speed: ev2.tipo === 'jato' ? 4.2 : 3.0, life: 0.55, up: ev2.tipo === 'jato' ? 3.2 : 0.6, size: 0.26
            });
          }
          if (ev2.x != null) shockRing(cellPos(ev2.x, ev2.y, 0.15), cor, 0.3, 2.4, 0.5);
          addShake(ev2.tipo === 'rachado' ? 6 : 3);
        })(ev);
        break;

      /* 03/10 — O SANTUÁRIO DOS ELEMENTOS (js/core/santuario.js). O que fica na tela é do
       * santuario3d.js (o breu, a água, o pilar, as setas); aqui só o INSTANTE em que a regra
       * age, com os efeitos que já existem: a labareda (ou o vapor) do braseiro que muda, a
       * poeira do pilar que troca, o respingo de quem a correnteza leva e o risco de vento de
       * quem a rajada empurra. Tudo sem número: nenhuma dessas regras fere. */
      case 'santuarioBraseiro':
        (function (ev2) {
          var pb = cellPos(ev2.x, ev2.y, 1.4);
          if (ev2.aceso) {
            burst(pb.x, pb.y, pb.z, 26, { color: '#ffb24a', speed: 3.2, life: 0.6, up: 2.2, size: 0.3, grav: -1.2 });
            shockRing(cellPos(ev2.x, ev2.y, 0.15), '#ffb24a', 0.3, 4.2, 0.7);
          } else {
            burst(pb.x, pb.y, pb.z, 18, { color: '#b9c7d2', speed: 1.4, life: 0.9, up: 2.6, size: 0.34, grav: -0.8, drag: 1.2 });
            shockRing(cellPos(ev2.x, ev2.y, 0.15), '#5a6f80', 0.3, 1.8, 0.5);
          }
        })(ev);
        break;

      case 'santuarioPilares':
        (function (ev2) {
          var todos = (ev2.sobem || []).concat(ev2.descem || []);
          // no máximo doze nuvens de pó: no Salão trocam 24 pilares de uma vez
          for (var pi = 0; pi < todos.length; pi += Math.max(1, Math.floor(todos.length / 12))) {
            var pp = cellPos(todos[pi].x, todos[pi].y, 0.2);
            burst(pp.x, 0.2, pp.z, 9, { color: '#c8b48a', speed: 1.8, life: 0.7, up: 0.5, size: 0.3, flat: true, drag: 1.5 });
          }
          if (todos.length) addShake(3);
        })(ev);
        break;

      case 'santuarioMare':
      case 'santuarioRajada':
        (function (ev2) {
          var agua = ev2.type === 'santuarioMare';
          var d = { n: [0, -1], s: [0, 1], l: [1, 0], o: [-1, 0] }[ev2.dir] || [0, 0];
          (ev2.movidos || []).forEach(function (uid) {
            var pu = unitPos(uid, agua ? 0.12 : 0.55);
            for (var k = 0; k < (agua ? 9 : 7); k++) {
              spawn({ x: pu.x - d[0] * 0.5 + (Math.random() - 0.5) * 0.6, y: pu.y + Math.random() * (agua ? 0.25 : 0.7),
                      z: pu.z - d[1] * 0.5 + (Math.random() - 0.5) * 0.6,
                      vx: d[0] * (3 + Math.random() * 2), vy: agua ? 0.8 + Math.random() : 0.1, vz: d[1] * (3 + Math.random() * 2),
                      life: 0.45, color: agua ? '#9fdcff' : '#e2d8ff', size: agua ? 0.22 : 0.18, grav: agua ? 2.4 : 0, drag: 1.2 });
            }
          });
        })(ev);
        break;

      /* 03/10 — OS ESPINHOS DO MURO (engine.js, "O MURO QUE FERE QUEM ENCOSTA"). O número
       * sai no `damage` que vem logo atrás; aqui o porquê: lascas na cor do elemento saindo
       * da pedra para quem encostou, um anel baixo ao pé dela e a palavra miúda acima. A
       * tela do outro lado nem recebe o evento quando quem sangra está invisível
       * (Game.eventoParaTela: ele leva o uid da vítima). */
      case 'muroFere':
        (function (ev2) {
          var cor = ecol(ev2.element || 'neutro');
          var pv = unitPos(ev2.uid, 0.55);
          var pm = (ev2.x != null) ? cellPos(ev2.x, ev2.y, 0.5) : null;
          if (pm && pv) {
            var dx = pv.x - pm.x, dz = pv.z - pm.z, dd = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
            for (var k = 0; k < 14; k++) {
              spawn({ x: pm.x + dx / dd * 0.8, y: 0.25 + Math.random() * 0.7, z: pm.z + dz / dd * 0.8,
                      vx: dx / dd * (3.5 + Math.random() * 2) + (Math.random() - 0.5) * 1.2, vy: 0.6 + Math.random(),
                      vz: dz / dd * (3.5 + Math.random() * 2) + (Math.random() - 0.5) * 1.2,
                      life: 0.35, color: k % 3 ? cor : '#d8d2c8', size: 0.2, grav: 2.2, drag: 1.6 });
            }
            shockRing({ x: pm.x, y: 0.1, z: pm.z }, cor, 0.3, 1.5, 0.35);
          }
          if (pv) {
            burst(pv.x, pv.y, pv.z, 12, { color: cor, speed: 2.6, life: 0.4, size: 0.22, spread: 0.35 });
            floater({ x: pv.x, y: pv.y + 0.75, z: pv.z }, 'espinhos', '#ffb3b3', false);
          }
          addShake(3);
        })(ev);
        break;

      case 'perigoRuna':
        p = unitPos(ev.uid, 0.3);
        shockRing(p, '#b98cff', 0.3, 1.6, 0.5);
        floater(unitPos(ev.uid, 1.0), '−' + (ev.pp || 0) + ' PP', '#b98cff');
        break;

      case 'couracaCaiu':
        p = unitPos(ev.uid, 0.6);
        burst(p.x, p.y, p.z, 36, { color: '#8a8278', speed: 3.6, life: 0.8, size: 0.32, grav: 1.6, spread: 0.5 });
        floater(unitPos(ev.uid, 1.1), 'couraça caiu!', '#e8dcc8', true);
        addShake(5);
        break;

      case 'ventania':
        p = unitPos(ev.uid, 0.6);
        shockRing(p, '#c8b6ff', 0.4, 2.6, 0.45);
        burst(p.x, p.y, p.z, 18, { color: '#e6ddff', speed: 4.0, life: 0.4, size: 0.2, flat: true });
        break;

      case 'summon':
        if (ev.unit) {
          p = cellPos(ev.unit.x, ev.unit.y, 0.3);
          shockRing(p, '#b98cff', 0.3, 2.2, 0.6);
          burst(p.x, 0.2, p.z, 30, { color: '#b98cff', speed: 3.4, life: 0.8, up: 1.6 });
          flash(p, '#b98cff', 5.0, 0.45, 10);
        }
        break;

      case 'fusion':
        (function (ev2) {
          var T = (R3 && R3.FUSION_TIMING) || { approach: 0.6, flash: 0.26, reveal: 0.66 };
          var els = ev2.elemPair || ['neutro', 'neutro'];
          var c1 = ecol(els[0]), c2 = ecol(els[1] || els[0]);
          var w = R3 && R3.unitWorld ? R3.unitWorld(ev2.uid) : null;
          var mid = w ? cellPos(w.x, w.y, 0.6) : new THREE.Vector3(0, 1, 0);
          // espiral das duas cores convergindo
          var steps = 34;
          for (var i = 0; i < steps; i++) {
            (function (i) {
              setTimeout(function () {
                var a = i / steps * Math.PI * 6;
                var r = 2.4 * (1 - i / steps) + 0.2;
                spawn({ x: mid.x + Math.cos(a) * r, y: 0.3 + i * 0.05, z: mid.z + Math.sin(a) * r,
                        vx: -Math.cos(a) * 2.4, vy: 1.2, vz: -Math.sin(a) * 2.4,
                        life: 0.7, color: i % 2 ? c1 : c2, size: 0.42, grav: 0.4, drag: 1.0 });
              }, (i / steps) * T.approach * 1000);
            })(i);
          }
          setTimeout(function () {
            flash(mid, '#ffffff', 24, 0.55, 20);
            shockRing(mid, c1, 0.4, 6.5, 0.75);
            shockRing(mid, c2, 0.3, 5.0, 0.9);
            burst(mid.x, mid.y, mid.z, 120, { color: c1, speed: 7.5, life: 1.0, size: 0.42, spread: 0.6 });
            burst(mid.x, mid.y, mid.z, 120, { color: c2, speed: 6.0, life: 1.1, size: 0.38, spread: 0.6 });
            addShake(16);
            freezeT = Math.max(freezeT, 0.16);
          }, T.approach * 1000);
        })(ev);
        break;

      case 'battleEnd':
        addShake(6);
        break;
    }
  };

  // -------------------------------------------------------- efeitos compostos
  var SCORCH = { agua: '#123646', ar: '#3c3c52', terra: '#2a2413', fogo: '#241208', neutro: '#26262c' };
  function impact(pos, element, power, element2) {
    var col = ecol(element), col2 = element2 && element2 !== element ? ecol(element2) : null;
    // A batida. Aqui estava a prova de que "tudo parece igual": medindo o que
    // aparece na tela, 'bola', 'corte' e 'flecha' pintavam o MESMO numero de
    // pixels, porque o que se via nas tres era so o clarao desta funcao lavando
    // o chao — as particulas ficavam abaixo do limiar. Agora a batida tem uma
    // forma, e cada familia poe a SUA por cima.
    /* A batida e PONTUACAO, nao a manchete. Ela aparece em toda familia; se for
     * o maior desenho da tela, o que o jogador ve de meteoro, corte e flecha e
     * a mesma coisa. Encolhida, ela pontua o golpe e deixa a assinatura da
     * familia liderar. */
    placa({ tile: PL.estouro, color: col, modo: 'bilhete',
            pos: v3(pos.x, Math.max(0.7, pos.y + 0.3), pos.z),
            de: [1.2 * power, 1.2 * power], ate: [3.4 * power, 3.4 * power],
            dur: 0.34, op: 0.95, saida: 1.8, patamar: 0.3, forro: 0.5 });
    if (col2) {
      placa({ tile: PL.estouro, color: col2, modo: 'bilhete',
              pos: v3(pos.x, Math.max(0.9, pos.y + 0.7), pos.z),
              de: [1.1 * power, 1.1 * power], ate: [3.8 * power, 3.8 * power],
              dur: 0.42, atraso: 0.06, op: 0.8, saida: 1.8 });
    }
    burst(pos.x, Math.max(0.2, pos.y), pos.z, Math.round(26 * power), {
      color: col, speed: 5.2 * power, life: 0.55, size: 0.34, spread: 0.4
    });
    if (col2) {
      // segunda assinatura: mesma explosão, outra cor, outro ritmo
      burst(pos.x, Math.max(0.2, pos.y), pos.z, Math.round(22 * power), {
        color: col2, speed: 3.6 * power, life: 0.75, size: 0.30, spread: 0.5, grav: -1.2
      });
    }
    burst(pos.x, 0.15, pos.z, Math.round(16 * power), {
      color: '#ffffff', speed: 5.0 * power, life: 0.3, size: 0.24, flat: true, up: 0.25
    });
    /* O CLARAO ENCOLHEU, e nao foi para economizar. Medido no tabuleiro, a luz
     * desta funcao lavava de 26.000 a 63.000 px do recorte — ate METADE da
     * tela — com o mesmo amarelo em TODA familia, porque `impact` e a unica
     * coisa que meteoro, corte, flecha e bola tem em comum. Era ela a resposta
     * literal a queixa "tudo igual, nao da para ver diferenca": a assinatura
     * compartilhada era maior que a propria. Com 4,5 m de alcance a batida
     * continua acendendo o alvo e o chao em volta, e para de pintar o quadro
     * inteiro por cima do desenho de cada familia. O anel de choque duplicado
     * saiu pelo mesmo motivo: dois aneis iguais em cores diferentes nao dizem
     * duas coisas, dizem a mesma duas vezes. */
    /* O ANEL DE CHOQUE SAIU DAQUI. Olhando a folha de contato, o mesmo anel
     * dourado concentrico no chao aparecia em estouro, flecha, feixe, gancho,
     * investida e invocacao — seis familias com a mesma assinatura, porque
     * todas passam por `impact`. As que precisam de anel ja chamam `shockRing`
     * por conta propria (meteoro, chuva, terremoto, onda, corte, armadilha,
     * aura, maldicao, nova), e nessas ele quer dizer alguma coisa. Aqui ele so
     * dizia "houve uma batida", que a placa de estouro ja diz com forma. */
    flash(new THREE.Vector3(pos.x, 0.8, pos.z), col, 5.0 * power, 0.30, 4.5 * power);
    if (col2) flash(new THREE.Vector3(pos.x, 1.1, pos.z), col2, 3.8 * power, 0.40, 5.0 * power);
    scorch(pos, SCORCH[element] || '#241208', 2.0 * power, 4);
    addShake(5 * power);
  }
  /* Costuras de teste: a folha de contato precisa disparar UMA familia sem
   * inventar um feitico, e precisa poder perguntar o que a placa virou no
   * mundo — tamanho, opacidade e se esta na frente da camera. */
  FX.debugFam = function (fam, from, dest, el, el2) { tocaFamilia(fam, from, dest, el, el2, null); };
  FX.debugPlacas = function () {
    return placas.map(function (p) {
      return { modo: p.modo, vis: p.m.visible, op: +p.mat.uniforms.uOp.value.toFixed(3),
               esc: [+p.m.scale.x.toFixed(2), +p.m.scale.y.toFixed(2), +p.m.scale.z.toFixed(2)],
               pos: [+p.m.position.x.toFixed(2), +p.m.position.y.toFixed(2), +p.m.position.z.toFixed(2)] };
    });
  };
  FX.debugImpact = function (gx, gy, element, power, element2) {
    impact(cellPos(gx, gy, 0.5), element, power || 1, element2);
  };
  FX.debugNova = function (gx, gy, e1, e2) { nova(cellPos(gx, gy, 0.3), ecol(e1), e2 ? ecol(e2) : null); };
  FX.debugBeam = function (fx2, fy2, tx, ty, e1, e2) {
    beam(cellPos(fx2, fy2, 1.0), cellPos(tx, ty, 1.0), ecol(e1), e2 ? ecol(e2) : null);
  };
  FX.debugLaunch = function (fx2, fy2, tx, ty, e1, e2) {
    launch(cellPos(fx2, fy2, 1.0), cellPos(tx, ty, 0.8), {
      color: ecol(e1), color2: e2 ? ecol(e2) : null,
      onHit: function (pos) { impact(pos, e1, 1.0, e2); }
    });
  };

  function beam(from, to, col, col2) {
    // O feixe era 26 pontinhos em fila — a 7 px cada, uma pontilhada. A placa em
    // trilho e UMA peca do tamanho do tiro.
    var bx = to.x - from.x, bz = to.z - from.z;
    var bd = Math.max(0.8, Math.sqrt(bx * bx + bz * bz));
    placa({ tile: PL.raio, color: col, modo: 'trilho', ang: angTrilho(bx, bz),
            pos: v3((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2),
            de: [bd, 2.4], ate: [bd, 4.6], dur: 0.66, op: 1, saida: 1.1,
            patamar: 0.5, forro: 0.4 });
    // um segundo raio, mais fino e fora de tempo, para o feixe TREMER em vez de
    // ser uma barra parada
    placa({ tile: PL.raio, color: col2 || col, modo: 'trilho', ang: angTrilho(bx, bz),
            pos: v3((from.x + to.x) / 2, (from.y + to.y) / 2 + 0.5, (from.z + to.z) / 2),
            de: [bd * 0.94, 1.4], ate: [bd, 3.0], dur: 0.52, atraso: 0.1, op: 0.9,
            saida: 1.2, patamar: 0.45 });
    var n = 26;
    for (var i = 0; i <= n; i++) {
      var k = i / n;
      spawn({
        x: from.x + (to.x - from.x) * k,
        y: from.y + (to.y - from.y) * k,
        z: from.z + (to.z - from.z) * k,
        vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8, vz: (Math.random() - 0.5) * 0.8,
        life: 0.42, color: col, size: 0.46, grav: 0.2, drag: 2.4
      });
      if (col2) {
        // o segundo elemento espirala em torno do feixe
        var a2 = k * 26;
        spawn({
          x: from.x + (to.x - from.x) * k + Math.cos(a2) * 0.4,
          y: from.y + (to.y - from.y) * k + Math.sin(a2) * 0.4,
          z: from.z + (to.z - from.z) * k,
          vx: 0, vy: 0, vz: 0, life: 0.5, color: col2, size: 0.38, grav: 0.1, drag: 2.0
        });
      }
    }
    // 11 m de alcance de luz lavavam 26.800 px do recorte — mais da metade do
    // que o feixe inteiro pintava era clarao, e clarao e igual em toda familia
    flash(to, col, 6.0, 0.32, 4.5);
    if (col2) flash(from, col2, 3.6, 0.36, 3.6);
    shockRing(to, col, 0.3, 2.2, 0.4);
    addShake(5);
  }
  function nova(pos, col, col2) {
    // o anel que ABRE, 13 m de diametro no chao — o desenho da nova
    placa({ tile: PL.anel, color: col, modo: 'chao', pos: v3(pos.x, 0.10, pos.z),
            de: [1.6, 1.6], ate: [13.5, 13.5], dur: 0.66, op: 1, saida: 1.3 });
    placa({ tile: PL.halo, color: col2 || col, modo: 'bilhete', pos: v3(pos.x, 1.3, pos.z),
            de: [2.4, 2.4], ate: [9.0, 9.0], dur: 0.52, op: 0.85, saida: 1.7 });
    burst(pos.x, 0.3, pos.z, 90, { color: col, speed: 8.5, life: 0.8, size: 0.36, flat: true, up: 0.35 });
    if (col2) burst(pos.x, 0.5, pos.z, 70, { color: col2, speed: 6.0, life: 1.0, size: 0.34, flat: true, up: 0.9 });
    shockRing(pos, col, 0.4, 5.2, 0.6);
    if (col2) shockRing(pos, col2, 0.4, 6.4, 0.8);
    shockRing(pos, '#ffffff', 0.3, 3.6, 0.45);
    flash(new THREE.Vector3(pos.x, 1.0, pos.z), col, 13, 0.5, 16);
    if (col2) flash(new THREE.Vector3(pos.x, 1.6, pos.z), col2, 10, 0.66, 17);
    addShake(11);
    freezeT = Math.max(freezeT, 0.08);
  }
  function healUp(pos, col) {
    placa({ tile: PL.estrela, color: col, modo: 'bilhete', pos: v3(pos.x, pos.y + 0.9, pos.z),
            de: [2.2, 2.2], ate: [6.0, 6.0], dur: 0.72, op: 0.95, saida: 1.5, giro: 0.8 });
    placa({ tile: PL.anel, color: col, modo: 'chao', pos: v3(pos.x, 0.10, pos.z),
            de: [4.2, 4.2], ate: [1.2, 1.2], dur: 0.62, op: 0.8, saida: 1.0, curva: 1.5 });
    for (var i = 0; i < 26; i++) {
      var a = Math.random() * Math.PI * 2, r = 0.35 + Math.random() * 0.5;
      spawn({
        x: pos.x + Math.cos(a) * r, y: 0.1, z: pos.z + Math.sin(a) * r,
        vx: 0, vy: 1.9 + Math.random() * 1.3, vz: 0,
        life: 0.85, color: col, size: 0.30, grav: 0.5, drag: 0.4
      });
    }
    flash(pos, col, 4.0, 0.5, 8);
  }

  // ================================================================= ATUALIZA
  var tmpV2 = null;
  // O tamanho de tela de uma particula depende do BUFFER, que muda com a janela
  // e com o devicePixelRatio. Recalculado por quadro (uma divisao) em vez de
  // cravado num 320 que so valia para uma resolucao — e para nenhuma, na verdade.
  function ajustaEscalaPonto() {
    if (!pts || !glr || !camera || !camera.fov) return;
    if (!tmpV2) tmpV2 = new THREE.Vector2();
    var h = 0;
    try { h = glr.getDrawingBufferSize(tmpV2).y; } catch (e) { return; }
    if (!(h > 0)) return;
    PT_K = h / (2 * Math.tan(camera.fov * Math.PI / 360));
    pts.material.uniforms.uPx.value = PT_K;
  }

  FX.update = function (dt, realDt) {
    if (!attached) return;
    if (freezeT > 0) freezeT -= (realDt == null ? dt : realDt);
    ajustaEscalaPonto();
    updatePlacas(dt);
    updateFilmes(dt);
    updateShots(dt);
    updateFlashes(dt);
    updateRings(dt);
    updateDecals(dt);
    updateFloaters(dt);
    updateAmbient(dt);
    updateParticles(dt);

    if (shakeAmp > 0.01) {
      shakeT += dt * 44;
      shakeOut.x = Math.sin(shakeT) * shakeAmp;
      shakeOut.y = Math.cos(shakeT * 1.31) * shakeAmp * 0.62;
      shakeAmp *= Math.pow(0.0015, dt);
    } else { shakeAmp = 0; shakeOut.x = 0; shakeOut.y = 0; }
  };

  FX.reset = function () {
    if (!attached) { queued.length = 0; return; }
    for (var i = 0; i < MAXP; i++) {
      if (parts[i]) { parts[i] = null; freeList.push(i); }
      pSize[i] = 0; pPos[i * 3 + 1] = -9999;
    }
    for (var s = shots.length - 1; s >= 0; s--) {
      fxG.remove(shots[s].mesh); shots[s].mesh.material.dispose(); freeLight(shots[s].light);
    }
    shots.length = 0;
    for (var f = flashes.length - 1; f >= 0; f--) freeLight(flashes[f].light);
    flashes.length = 0;
    for (var r = rings.length - 1; r >= 0; r--) { fxG.remove(rings[r].m); rings[r].m.material.dispose(); }
    rings.length = 0;
    for (var t = floaters.length - 1; t >= 0; t--) { fxG.remove(floaters[t].sp); floaters[t].sp.material.dispose(); }
    floaters.length = 0;
    limpaPlacas();
    limpaFilmes();
    FX.clearDecals();
    limpaTexCache();          // as texturas dos numeros vao embora com a sala
    shakeAmp = 0; shakeOut.x = 0; shakeOut.y = 0; freezeT = 0;
  };

  /* Forma do que esta desenhado agora — para o teste poder provar que familias
   * diferentes desenham COISAS diferentes, e nao so "desenham alguma coisa".
   * Sem isto a unica pergunta possivel era "tem particula?", que da a mesma
   * resposta para o meteoro e para a aura. */
  FX.amostra = function () {
    var n = 0, sx = 0, sy = 0, sz = 0;
    var minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, minz = 1e9, maxz = -1e9;
    for (var i = 0; i < MAXP; i++) {
      var p = parts[i];
      if (!p) continue;
      n++; sx += p.x; sy += p.y; sz += p.z;
      if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
      if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
      if (p.z < minz) minz = p.z; if (p.z > maxz) maxz = p.z;
    }
    if (!n) return { n: 0 };
    return { n: n, cx: sx / n, cy: sy / n, cz: sz / n,
             alto: maxy, baixo: miny,
             largX: maxx - minx, largZ: maxz - minz };
  };

  FX.stats = function () {
    var alive = 0;
    for (var i = 0; i < MAXP; i++) if (parts[i]) alive++;
    return { particles: alive, shots: shots.length, decals: decals.length,
             floaters: floaters.length, texCache: texCacheN,
             rings: rings.length, luzes: flashes.length,
             placas: placas.length, ptK: PT_K };
  };
})();
