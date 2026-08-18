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
  var pts = null, pPos = null, pCol = null, pSize = null, pGeo = null;
  var parts = [];                    // {x,y,z,vx,vy,vz,life,max,r,g,b,size,grav,drag,fade}
  var freeList = [];

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

  var PART_VS = [
    'attribute float aSize;',
    'varying vec3 vColor;',
    'void main() {',
    '  vColor = color;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_PointSize = aSize * (320.0 / max(0.001, -mv.z));',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  var PART_FS = [
    'uniform sampler2D uMap;',
    'varying vec3 vColor;',
    'void main() {',
    '  vec4 t = texture2D(uMap, gl_PointCoord);',
    '  gl_FragColor = vec4(vColor, 1.0) * t;',
    '  if (gl_FragColor.a < 0.01) discard;',
    '}'
  ].join('\n');

  function buildParticles() {
    pGeo = new THREE.BufferGeometry();
    pPos = new Float32Array(MAXP * 3);
    pCol = new Float32Array(MAXP * 3);
    pSize = new Float32Array(MAXP);
    for (var i = 0; i < MAXP; i++) {
      pPos[i * 3 + 1] = -9999;
      pSize[i] = 0;
      parts.push(null);
      freeList.push(i);
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
    var mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: dotTexture() } },
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
      grow: o.grow || 0
    };
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
        grav: o.grav, drag: o.drag, grow: o.grow
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
    heart:   { color: '#ffd166', rate: 8,  up: 0.5,  size: 0.22 }
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
    burst(alto.x, alto.y, alto.z, 16, { color: col, speed: 1.2, life: 0.7, size: 0.4, grav: -1 });
    launch(alto, dest, {
      color: col, color2: col2, kind: 'ball', speed: grande ? 30 : 24, arc: 0,
      onHit: function (pos) {
        impact(pos, el, grande ? 2.0 : 1.4, el2);
        shockRing(pos, col, 0.4, grande ? 4.6 : 3.0, 0.55);
        scorch(pos, col, grande ? 3.6 : 2.4, 6);
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
          launch(ceu, chao, {
            color: (col2 && k % 3 === 2) ? col2 : col, kind: 'ball', speed: 22, arc: 0,
            onHit: function (pos) {
              burst(pos.x, pos.y + 0.2, pos.z, 14, { color: col, speed: 3.2, life: 0.4, size: 0.24 });
              shockRing(pos, col, 0.2, 1.1, 0.35);
            }
          });
        }, k * 85);
      })(i);
    }
    scorch(dest, col, 3.2, 5);
    addShake(4);
  }

  /* Sopro que ABRE a partir do conjurador na direcao do alvo. */
  function cone(from, dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    var dx = dest.x - from.x, dz = dest.z - from.z;
    var d = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
    dx /= d; dz /= d;
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
            flat: true, up: 0.35
          });
        }, k * 26);
      })(i);
    }
  }

  /* Quatro bracos saindo do alvo: o desenho do feitico em cruz. */
  function cruz(dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    impact(dest, el, 1.2, el2);
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    dirs.forEach(function (dr, di) {
      for (var i = 1; i <= 4; i++) {
        (function (k, d2) {
          setTimeout(function () {
            burst(dest.x + d2[0] * k, dest.y + 0.15, dest.z + d2[1] * k, 9, {
              color: (col2 && di % 2) ? col2 : col,
              speed: 2.0, life: 0.4, size: 0.28, flat: true, up: 0.5, spread: 0.35
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
      color: col, speed: 5.5, life: 0.75, size: 0.36, up: 2.4, grav: 5.5, spread: 1.1
    });
    if (col2) burst(dest.x, dest.y + 0.05, dest.z, 24, {
      color: col2, speed: 4.2, life: 0.9, size: 0.32, up: 2.0, grav: 4.5, spread: 1.3
    });
    shockRing(dest, col, 0.3, 3.0, 0.5);
    scorch(dest, col, 2.6, 5);
    addShake(7);
  }

  /* Lamina baixa e rapida correndo rente ao chao ate o alvo. */
  function onda(from, dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    var passos = 8;
    for (var i = 0; i <= passos; i++) {
      (function (k) {
        setTimeout(function () {
          var t = k / passos;
          burst(from.x + (dest.x - from.x) * t, 0.18, from.z + (dest.z - from.z) * t, 14, {
            color: (col2 && k % 3 === 2) ? col2 : col,
            speed: 2.6, life: 0.5, size: 0.34, flat: true, up: 0.22, spread: 1.0
          });
        }, k * 30);
      })(i);
    }
    setTimeout(function () { shockRing(dest, col, 0.4, 2.4, 0.45); }, passos * 30);
  }

  /* Rastro de corrida do conjurador ate o destino, e o baque na chegada. */
  function investida(from, dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    var passos = 7;
    for (var i = 0; i <= passos; i++) {
      (function (k) {
        setTimeout(function () {
          var t = k / passos;
          burst(from.x + (dest.x - from.x) * t, from.y * 0.7 + 0.2,
                from.z + (dest.z - from.z) * t, 9, {
            color: (col2 && k % 2) ? col2 : col, speed: 1.5, life: 0.36, size: 0.28, spread: 0.4
          });
        }, k * 22);
      })(i);
    }
    setTimeout(function () { impact(dest, el, 1.5, el2); addShake(6); }, passos * 22);
  }

  /* Arco de corte no alvo, no tempo do golpe corpo a corpo. */
  function corte(dest, el, el2) {
    var hd = R3 && R3.hitDelay ? R3.hitDelay() : 0.3;
    setTimeout(function () {
      var col = ecol(el);
      // arco: as particulas seguem um semicirculo, nao uma explosao redonda
      for (var i = 0; i < 14; i++) {
        var a = -0.5 + (i / 13) * 2.2;
        spawn({
          x: dest.x + Math.cos(a) * 1.0, y: dest.y + 0.2 + Math.sin(a) * 0.5,
          z: dest.z + Math.sin(a) * 0.5,
          vx: Math.cos(a) * 3.2, vy: 0.6, vz: Math.sin(a) * 3.2,
          life: 0.3, color: col, size: 0.26
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
    burst(dest.x, dest.y + 0.15, dest.z, 12, {
      color: col, speed: 1.1, life: 0.7, size: 0.22, flat: true, up: 0.3
    });
    if (el2) burst(dest.x, dest.y + 0.2, dest.z, 8, { color: ecol(el2), speed: 0.9, life: 0.8, size: 0.2 });
  }

  /* Invocacao: coluna de luz subindo onde a criatura vai aparecer. */
  function invocacao(dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    for (var i = 0; i < 5; i++) {
      (function (k) {
        setTimeout(function () {
          burst(dest.x, dest.y + k * 0.55, dest.z, 12, {
            color: (col2 && k % 2) ? col2 : col,
            speed: 0.9, life: 0.6, size: 0.3, up: 2.2, grav: -1.4, spread: 0.7
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
    for (var i = 0; i < 4; i++) {
      (function (k) {
        setTimeout(function () {
          burst(from.x, from.y * 0.55 + 0.25, from.z, 16, {
            color: (col2 && k % 2) ? col2 : col,
            speed: 1.4, life: 0.75, size: 0.28, up: 1.6, grav: -0.9, spread: 0.85
          });
        }, k * 90);
      })(i);
    }
    shockRing({ x: from.x, y: 0, z: from.z }, col, 1.6, 0.4, 0.6);
  }

  /* Estouro seco no alvo: sem projetil, a coisa ja acontece la. */
  function estouro(dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    burst(dest.x, dest.y + 0.3, dest.z, 46, {
      color: col, speed: 6.5, life: 0.55, size: 0.36, spread: 0.5
    });
    if (col2) burst(dest.x, dest.y + 0.4, dest.z, 30, {
      color: col2, speed: 5.0, life: 0.7, size: 0.32, spread: 0.7
    });
    shockRing(dest, col, 0.3, 3.4, 0.45);
    scorch(dest, col, 2.4, 4);
    addShake(6);
  }

  /* Escudo: casca que FECHA em volta do alvo, subindo do chao. */
  function escudo(dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    for (var i = 0; i < 3; i++) {
      (function (k) {
        setTimeout(function () {
          // as particulas nascem num anel e sobem: leitura de casca, nao de estouro
          for (var j = 0; j < 14; j++) {
            var a = (j / 14) * Math.PI * 2;
            spawn({
              x: dest.x + Math.cos(a) * 1.15, y: dest.y - 0.4 + k * 0.3, z: dest.z + Math.sin(a) * 1.15,
              vx: -Math.cos(a) * 0.35, vy: 1.5, vz: -Math.sin(a) * 0.35,
              life: 0.65, color: (col2 && k % 2) ? col2 : col, size: 0.26
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
    burst(from.x, from.y * 0.6 + 0.2, from.z, 20, {
      color: col, speed: 2.4, life: 0.4, size: 0.28, spread: 0.5, grav: -0.5
    });
    setTimeout(function () {
      burst(dest.x, dest.y + 0.2, dest.z, 24, {
        color: col2 || col, speed: 2.8, life: 0.45, size: 0.3, spread: 0.5, grav: -0.5
      });
      shockRing(dest, col, 1.4, 0.3, 0.35);
    }, 140);
  }

  /* Gancho: um fio sai da mao e PUXA — a linha corre do alvo de volta. */
  function gancho(from, dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    beam(from, dest, col, col2);
    var passos = 6;
    for (var i = 0; i <= passos; i++) {
      (function (k) {
        setTimeout(function () {
          var t = 1 - k / passos;                 // do alvo PARA quem puxa
          burst(from.x + (dest.x - from.x) * t, from.y * 0.7 + 0.15,
                from.z + (dest.z - from.z) * t, 7, {
            color: col, speed: 1.2, life: 0.3, size: 0.24, spread: 0.3
          });
        }, 120 + k * 26);
      })(i);
    }
  }

  /* Maldicao: cai DE CIMA sobre o alvo, devagar, e assenta. */
  function maldicao(dest, el, el2) {
    var col = ecol(el), col2 = el2 ? ecol(el2) : null;
    for (var i = 0; i < 3; i++) {
      (function (k) {
        setTimeout(function () {
          burst(dest.x, dest.y + 2.4 - k * 0.5, dest.z, 14, {
            color: (col2 && k % 2) ? col2 : col,
            speed: 0.7, life: 0.9, size: 0.26, up: -0.6, grav: 1.4, spread: 0.9
          });
        }, k * 110);
      })(i);
    }
    scorch(dest, col, 1.6, 5);
  }

  /* Escolhe e toca o desenho da familia. */
  function tocaFamilia(fam, from, dest, el, el2, sp) {
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
      case 'flecha':
        launch(from, dest, {
          color: ecol(el), color2: el2 ? ecol(el2) : null, kind: 'arrow', speed: 34, arc: 0.25,
          onHit: function (pos) { impact(pos, el, 1.0, el2); }
        });
        break;
      default:
        launch(from, dest, {
          color: ecol(el), color2: el2 ? ecol(el2) : null, kind: 'ball', speed: 22, arc: 0.6,
          onHit: function (pos) { impact(pos, el, 1.0, el2); }
        });
    }
  }

  // ================================================================ EVENTOS
  FX.handleEvent = function (ev) {
    if (!ev) return;
    if (!attached) { if (queued.length < 300) queued.push(ev); return; }
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
          break;
        }
        tocaFamilia(familiaDe(fk), u, dest, el, el2, sp);
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
    shockRing(pos, col, 0.35, 2.4 * power, 0.42);
    if (col2) shockRing(pos, col2, 0.30, 3.1 * power, 0.58);
    flash(new THREE.Vector3(pos.x, 0.8, pos.z), col, 6.5 * power, 0.34, 9 * power);
    if (col2) flash(new THREE.Vector3(pos.x, 1.1, pos.z), col2, 5.0 * power, 0.46, 10 * power);
    scorch(pos, SCORCH[element] || '#241208', 2.0 * power, 4);
    addShake(5 * power);
  }
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
    flash(to, col, 7.5, 0.35, 11);
    if (col2) flash(from, col2, 4.5, 0.4, 8);
    shockRing(to, col, 0.3, 2.2, 0.4);
    if (col2) shockRing(to, col2, 0.3, 3.0, 0.55);
    addShake(5);
  }
  function nova(pos, col, col2) {
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
  FX.update = function (dt, realDt) {
    if (!attached) return;
    if (freezeT > 0) freezeT -= (realDt == null ? dt : realDt);
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
             rings: rings.length, luzes: flashes.length };
  };
})();
