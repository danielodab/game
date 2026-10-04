var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// JOGO.Models3D — fábrica de TODOS os meshes do jogo (dono: Agente Designer 3D)
//
//   · AMBIENTE: montadores por tema sobre os GLBs CC0 do KayKit Dungeon
//     Remastered (assets/embedded/env-kit.js), com tint pela paleta do
//     calabouço (DATA.dungeons). Escala: 1 célula = 2 unidades (CELL).
//   · UNIDADES: 29 modelos procedurais low-poly (primitivas THREE, flat
//     shading, sub-partes nomeadas) fiéis às silhuetas do GDD, com animação
//     por código: idle / walk / cast / hit / death.
//
//   API:
//     Models3D.ready(cb)                        — espera o parse dos GLBs
//     Models3D.buildUnit(defId) -> {group, animate(st, t, dt)}
//     Models3D.buildTile(theme, kind, variant) -> Group   (topo do piso em y=0)
//     Models3D.buildWall(theme, seed, opts)    -> Group   (altura real)
//     Models3D.buildHole(theme, seed)          -> Group   (cavidade + fundo emissivo)
//     Models3D.buildProp(theme, kind, seed)    -> Group   (props de borda)
//     Models3D.propKinds(theme)                -> [kinds]
//     Models3D.buildGround(theme)              -> Mesh    (chão estendido)
//     Models3D.themePalette(theme)             -> paleta do DATA
//     Models3D.CELL, Models3D.WALL_H
// ============================================================================

(function () {
  'use strict';
  if (typeof THREE === 'undefined') { console.error('Models3D: THREE ausente'); return; }

  var M = {};
  var CELL = 2;          // 1 célula do grid = 2 unidades do mundo (escala KayKit)
  var WALL_H = 2.0;      // altura da parede (peças do kit a escala 0.5)
  M.CELL = CELL;
  M.WALL_H = WALL_H;

  // ---------------------------------------------------------------- carga GLB
  var kit = {};                       // key -> THREE.Group (template)
  var readyFlag = false, readyCbs = [];

  M.ready = function (cb) {
    if (typeof cb !== 'function') return;
    if (readyFlag) cb(); else readyCbs.push(cb);
  };
  M.isReady = function () { return readyFlag; };

  function b64ToBuf(b64) {
    var bin = atob(b64);
    var buf = new ArrayBuffer(bin.length);
    var u8 = new Uint8Array(buf);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return buf;
  }

  function finishLoad() {
    readyFlag = true;
    var cbs = readyCbs; readyCbs = [];
    for (var i = 0; i < cbs.length; i++) { try { cbs[i](); } catch (e) { console.error(e); } }
  }

  (function loadAll() {
    var A = JOGO.ASSETS || {};
    var keys = Object.keys(A);
    if (!keys.length || !THREE.GLTFLoader) { finishLoad(); return; }
    var loader = new THREE.GLTFLoader();
    var pending = keys.length;
    keys.forEach(function (k) {
      try {
        loader.parse(b64ToBuf(A[k]), '', function (gltf) {
          kit[k] = gltf.scene;
          if (--pending === 0) finishLoad();
        }, function (err) {
          console.error('Models3D: falha no parse de "' + k + '"', err);
          if (--pending === 0) finishLoad();
        });
      } catch (e) {
        console.error('Models3D: exceção no parse de "' + k + '"', e);
        if (--pending === 0) finishLoad();
      }
    });
  })();

  // --------------------------------------------------------------- paletas
  var FALLBACK_PAL = {
    garden:  { primary: '#5a8f4d', secondary: '#8a6b3e', accent: '#ffd76b', floor1: '#35513a', floor2: '#3d5c41', wall: '#57452f' },
    cistern: { primary: '#2e6e8e', secondary: '#1d3a4d', accent: '#7ef0d4', floor1: '#24404f', floor2: '#2a4a5a', wall: '#16222c' },
    forge:   { primary: '#c4502e', secondary: '#4a2a26', accent: '#ffb347', floor1: '#3a2422', floor2: '#452a25', wall: '#241512' }
  };
  function normTheme(theme) {
    if (theme === 'greenhouse') return 'garden';
    if (theme === 'emberlock') return 'forge';
    return theme || 'garden';
  }
  M.themePalette = function (theme) {
    theme = normTheme(theme);
    var D = JOGO.DATA;
    if (D && D.dungeons) {
      for (var i = 0; i < D.dungeons.length; i++) {
        if (D.dungeons[i].theme === theme || D.dungeons[i].id === theme) return D.dungeons[i].palette;
      }
    }
    // 03/10: os calabouços especiais (js/core/data/santuario.js) moram fora de DATA.dungeons — sem
    // isto o tema 'santuario' não achava a paleta dele e o piso saía com o verde de reserva do jardim
    var es = (D && D.especiais) || [];
    for (var j = 0; j < es.length; j++) {
      if (es[j] && (es[j].theme === theme || es[j].id === theme) && es[j].palette) return es[j].palette;
    }
    return FALLBACK_PAL[theme] || FALLBACK_PAL.garden;
  };

  function col(hex) { return new THREE.Color(hex); }
  // clareia/escurece uma cor hex (k>1 clareia multiplicando, k<1 escurece)
  function shade(hex, k) {
    var c = col(hex);
    c.r = Math.min(1, c.r * k); c.g = Math.min(1, c.g * k); c.b = Math.min(1, c.b * k);
    return c;
  }
  function mix(hexA, hexB, k) { return col(hexA).lerp(col(hexB), k); }

  // ------------------------------------------------------------ TOON SHADING
  // rampa de 4 degraus com viés CLARO (cartoon é luminoso; a sombra é um
  // degrau colorido, não um breu). RGBA p/ funcionar em WebGL1 e WebGL2.
  var toonRampTex = null;
  function toonRamp() {
    if (toonRampTex) return toonRampTex;
    var steps = [0.46, 0.72, 0.92, 1.0];
    var data = new Uint8Array(steps.length * 4);
    for (var i = 0; i < steps.length; i++) {
      var v = Math.round(steps[i] * 255);
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
    }
    toonRampTex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
    toonRampTex.minFilter = THREE.NearestFilter;
    toonRampTex.magFilter = THREE.NearestFilter;
    toonRampTex.generateMipmaps = false;
    toonRampTex.needsUpdate = true;
    return toonRampTex;
  }
  // paleta cartoon: satura (+~28%) e clareia de leve toda cor autorada (sRGB)
  var _hsl = { h: 0, s: 0, l: 0 };
  function toonColor(c) {
    c.getHSL(_hsl);
    c.setHSL(_hsl.h, Math.min(1, _hsl.s * 1.28 + 0.02), Math.min(0.88, _hsl.l * 1.07 + 0.01));
    return c;
  }

  // ------------------------------------------------------------ materiais
  // cores são autoradas em sRGB (hex) → converter p/ linear (outputEncoding sRGB)
  // TOON: MeshToonMaterial com rampa de degraus — chapado, vivo, cartoon.
  function mat(color, o) {
    o = o || {};
    var c = toonColor(((color && color.isColor) ? color.clone() : new THREE.Color(color)));
    var m = new THREE.MeshToonMaterial({
      color: c.convertSRGBToLinear(),
      gradientMap: toonRamp()
    });
    if (o.flat) m.flatShading = true;      // padrão agora é SUAVE (redondinho)
    if (o.emissive != null) {
      m.emissive = ((o.emissive.isColor) ? o.emissive.clone() : new THREE.Color(o.emissive)).convertSRGBToLinear();
    }
    if (o.ei != null) m.emissiveIntensity = o.ei;
    if (o.alpha != null && o.alpha < 1) { m.transparent = true; m.opacity = o.alpha; }
    if (o.side) m.side = o.side;
    return m;
  }

  // ---------------------------------------------------- CONTORNOS (traço)
  // Inverted hull: casco expandido ao longo das normais SUAVIZADAS (solda
  // vértices por posição — sem rachaduras nas quinas), BackSide, espessura
  // proporcional à distância da câmera (traço consistente em qualquer zoom).
  var outlineMatCache = {};
  function outlineMat(hex, thick) {
    var key = hex + '|' + thick;
    var m = outlineMatCache[key];
    if (!m) {
      m = outlineMatCache[key] = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(hex).convertSRGBToLinear() },
          uThick: { value: thick }
        },
        vertexShader: [
          'uniform float uThick;',
          'void main() {',
          '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
          '  vec3 n = normalize(normalMatrix * normal);',
          '  float d = clamp(length(mv.xyz), 5.0, 46.0);',
          '  mv.xyz += n * uThick * d;',
          '  gl_Position = projectionMatrix * mv;',
          '}'].join('\n'),
        fragmentShader: [
          'uniform vec3 uColor;',
          'void main() { gl_FragColor = vec4(uColor, 1.0); }'].join('\n'),
        side: THREE.BackSide
      });
      m.userData.isOutline = true;
    }
    return m;
  }
  // clone da geometria com normais soldadas por posição (média) — casco liso
  function hullGeometry(srcGeo) {
    var g = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo.clone();
    var pos = g.attributes.position, nor = g.attributes.normal;
    if (!nor) { g.computeVertexNormals(); nor = g.attributes.normal; }
    var acc = {}, i, key, e;
    for (i = 0; i < pos.count; i++) {
      key = ((pos.getX(i) * 97) | 0) + ',' + ((pos.getY(i) * 97) | 0) + ',' + ((pos.getZ(i) * 97) | 0);
      e = acc[key] || (acc[key] = [0, 0, 0]);
      e[0] += nor.getX(i); e[1] += nor.getY(i); e[2] += nor.getZ(i);
    }
    var out = new Float32Array(pos.count * 3);
    for (i = 0; i < pos.count; i++) {
      key = ((pos.getX(i) * 97) | 0) + ',' + ((pos.getY(i) * 97) | 0) + ',' + ((pos.getZ(i) * 97) | 0);
      e = acc[key];
      var l = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
      if (l > 0.35) {                       // média válida
        out[i * 3] = e[0] / l; out[i * 3 + 1] = e[1] / l; out[i * 3 + 2] = e[2] / l;
      } else {                              // faces opostas se cancelaram (placa
        out[i * 3] = nor.getX(i);           // fina): usa a normal original — nada
        out[i * 3 + 1] = nor.getY(i);       // de vetor nulo/NaN no shader
        out[i * 3 + 2] = nor.getZ(i);
      }
    }
    g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
    return g;
  }
  function isGlowMat(m) {
    return !!(m.emissive && m.emissiveIntensity > 0.75
      && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.12);
  }
  // adiciona cascos de contorno aos meshes estruturais de um grupo.
  // opts: { color, thick, minR, all }
  M.addOutlines = function (root, opts) {
    opts = opts || {};
    var thick = opts.thick != null ? opts.thick : 0.0034;
    var hex = opts.color || '#241a2e';
    var minR = opts.minR != null ? opts.minR : 0.055;
    var targets = [];
    root.traverse(function (n) {
      if (!n.isMesh || !n.geometry || !n.material) return;
      if (n.userData.outline) return;
      var m2 = n.material;
      if (m2.userData && m2.userData.isOutline) return;
      if (m2.transparent) return;                      // vidro/água: sem casco
      if (isGlowMat(m2)) return;                       // brilho puro: sem traço
      if (!n.castShadow && !opts.all) return;          // detalhinho/halo
      if (!n.geometry.boundingSphere) n.geometry.computeBoundingSphere();
      var r = n.geometry.boundingSphere.radius * Math.max(n.scale.x, Math.max(n.scale.y, n.scale.z));
      if (r < minR) return;
      targets.push(n);
    });
    var om = outlineMat(hex, thick);
    for (var i = 0; i < targets.length; i++) {
      var hull = new THREE.Mesh(hullGeometry(targets[i].geometry), om);
      hull.userData.outline = 1;
      hull.castShadow = false; hull.receiveShadow = false;
      targets[i].add(hull);                            // herda transform/animação
    }
    return root;
  };

  // clone do template do kit com materiais TOON tintados (cache por key+tint)
  var tintCache = {};
  function kitClone(key, tintHex, o) {
    o = o || {};
    var tpl = kit[key];
    if (!tpl) return new THREE.Group();
    var ck = key + '|' + (tintHex || '-') + '|' + (o.emissive || '-');
    var matMap = tintCache[ck];
    if (!matMap) { matMap = tintCache[ck] = {}; }
    var g = tpl.clone(true);
    g.traverse(function (n) {
      if (!n.isMesh) return;
      n.castShadow = o.noCast ? false : true;
      n.receiveShadow = true;
      var src = n.material;
      if (!src) return;
      if (!matMap[src.uuid]) {
        var mm = new THREE.MeshToonMaterial({
          map: src.map || null,
          gradientMap: toonRamp()
        });
        if (src.vertexColors) mm.vertexColors = true;
        if (src.transparent) { mm.transparent = true; mm.opacity = src.opacity; }
        if (tintHex) {
          mm.color = toonColor(new THREE.Color(tintHex)).convertSRGBToLinear();
        } else if (src.color) {
          // cor nativa do kit (linear) → sRGB → satura → linear
          var c0 = src.color.clone().convertLinearToSRGB();
          mm.color = toonColor(c0).convertSRGBToLinear();
        }
        if (o.emissive) {
          mm.emissive = new THREE.Color(o.emissive).convertSRGBToLinear();
          mm.emissiveIntensity = o.ei != null ? o.ei : 1;
        } else if (src.emissive && (src.emissive.r + src.emissive.g + src.emissive.b) > 0.01) {
          mm.emissive = src.emissive.clone();
          mm.emissiveIntensity = src.emissiveIntensity != null ? src.emissiveIntensity : 1;
        }
        if (o.envOutline) mm.userData.envOutline = 1;   // mergeStatic põe traço
        matMap[src.uuid] = mm;
      }
      n.material = matMap[src.uuid];
    });
    return g;
  }

  // material CACHEADO p/ ambiente (compartilhar material = fundir draw calls)
  var envMatCache = {};
  function cmat(key, color, o) {
    var m = envMatCache[key];
    if (!m) m = envMatCache[key] = mat(color, o);
    return m;
  }
  // acesso do renderer p/ pulsar emissivos do ambiente (lava/água/brasa)
  M.envMat = function (key) { return envMatCache[key] || null; };

  /* ---- fusão de estáticos ------------------------------------------------
   *
   * MEDIDO (tests/perf.html, sala 21x17, 7 unidades): o grupo `board` chegava
   * ao quadro com 149 malhas e 184 772 triângulos. Cada malha é pelo menos uma
   * chamada de desenho, e num GPU de celular a chamada custa mais que o
   * triângulo. A fusão já existia — e mesmo assim sobravam 63 malhas de
   * cenário. Por quê?
   *
   * Porque o agrupamento era por `material.uuid`. O kit KayKit vem em 49 `.glb`
   * separados, cada um com sua PRÓPRIA cópia do mesmo atlas de 1024 px e do
   * mesmo material — objetos diferentes, conteúdo idêntico. O código via 63
   * materiais onde a placa de vídeo veria 2 texturas.
   *
   * Duas correções, nesta ordem:
   *
   *   1. A TEXTURA é comparada pelo CONTEÚDO, não pela identidade: desenhamos
   *      cada imagem num quadrado de 32 px e tiramos um resumo dos pixels. As
   *      cópias do mesmo atlas colapsam numa só.
   *
   *   2. A COR sai do material e vai para os VÉRTICES. Eram 31 cores distintas
   *      — 31 materiais impossíveis de juntar. Como `MeshToonMaterial`
   *      multiplica cor-de-vértice × cor-do-material × textura, gravar a cor em
   *      cada vértice e deixar o material branco dá EXATAMENTE o mesmo pixel, e
   *      agora tudo o que compartilha textura vira uma malha só.
   *
   * Fica de fora quem tem EMISSIVO (lava, brasa, água): esses o renderizador
   * pulsa por referência via `M.envMat`, e trocar o material por um novo
   * apagaria a pulsação. São 4 ou 5 malhas — não vale o risco.
   */

  // resumo do CONTEÚDO de uma imagem (32x32 → FNV-1a). Cacheado no objeto.
  var lupa = null;
  function resumoImagem(img) {
    if (!img) return 'sem';
    if (img.__soterraResumo) return img.__soterraResumo;
    var r;
    try {
      if (!lupa) { lupa = document.createElement('canvas'); lupa.width = 32; lupa.height = 32; }
      var ctx = lupa.getContext('2d');
      ctx.clearRect(0, 0, 32, 32);
      ctx.drawImage(img, 0, 0, 32, 32);
      var d = ctx.getImageData(0, 0, 32, 32).data;
      var h = 2166136261;
      for (var i = 0; i < d.length; i++) { h ^= d[i]; h = (h * 16777619) >>> 0; }
      r = (img.width || 0) + 'x' + (img.height || 0) + '#' + h.toString(16);
    } catch (e) {
      // imagem que não deixa ler pixel: cada uma fica no seu balde, como antes
      r = 'opaca' + (contaOpacas++);
    }
    img.__soterraResumo = r;
    return r;
  }
  var contaOpacas = 0;
  var texCanonica = {};                      // resumo -> a primeira textura vista
  function chaveTextura(t) {
    if (!t) return 'sem';
    if (t.__soterraChave) return t.__soterraChave;
    var k = resumoImagem(t.image) + '|' + (t.flipY ? 1 : 0) + '|' + t.wrapS + ',' + t.wrapT +
            '|' + t.repeat.x + ',' + t.repeat.y + '|' + t.offset.x + ',' + t.offset.y +
            '|' + (t.encoding != null ? t.encoding : (t.colorSpace || ''));
    t.__soterraChave = k;
    if (!texCanonica[k]) texCanonica[k] = t;
    return k;
  }
  function temEmissivo(m) {
    return !!(m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.01);
  }

  M.mergeStatic = function (root, opts) {
    opts = opts || {};
    // Traço do cenário: 20 malhas e 74 968 triângulos só para o contorno — um
    // segundo desenho do mesmo casco. É a primeira coisa a cair num aparelho de
    // bateria; a leitura do tabuleiro não depende dele.
    var semTraco = opts.outline === false ||
      (opts.outline == null && JOGO.Mobile && JOGO.Mobile.economico && JOGO.Mobile.economico());

    root.updateMatrixWorld(true);
    var buckets = {};
    var keep = [];
    root.traverse(function (n) {
      if (n.isSprite || n.isPointLight || (n.userData && n.userData.keep)) { keep.push(n); return; }
      if (!n.isMesh || !n.geometry || !n.material) return;
      var m = n.material;
      var porUuid = temEmissivo(m) || !m.isMeshToonMaterial;
      var key = porUuid
        ? ('uuid:' + m.uuid)
        : ['toon', chaveTextura(m.map), m.transparent ? 1 : 0, m.opacity, m.side,
           m.depthWrite ? 1 : 0, m.alphaTest, m.gradientMap ? m.gradientMap.uuid : '-',
           (m.userData && m.userData.envOutline) ? 1 : 0].join('|');
      key += '|' + (n.castShadow ? 1 : 0) + '|' + (n.receiveShadow ? 1 : 0);
      var b = buckets[key];
      if (!b) {
        b = buckets[key] = {
          mat: m, porUuid: porUuid, cast: n.castShadow, recv: n.receiveShadow,
          geoms: [], cores: [], usaVC: []
        };
      }
      var g2 = n.geometry.index ? n.geometry.toNonIndexed() : n.geometry.clone();
      g2.applyMatrix4(n.matrixWorld);          // (applyMatrix4 já corrige normais)
      b.geoms.push(g2);
      b.cores.push(m.color ? m.color : null);  // vai para os vértices
      // ARMADILHA: várias peças do kit trazem um atributo `color` que o material
      // NÃO usa (`vertexColors` desligado) — é dado morto que o shader ignora.
      // Multiplicar por ele ao fundir acendia esse dado morto e escurecia a sala
      // inteira. Só entra na conta quem já usava.
      b.usaVC.push(!!m.vertexColors);
    });
    var out = new THREE.Group();
    Object.keys(buckets).forEach(function (key) {
      var b = buckets[key];
      var total = 0, hasUv = true, i;
      for (i = 0; i < b.geoms.length; i++) {
        total += b.geoms[i].attributes.position.count;
        if (!b.geoms[i].attributes.uv) hasUv = false;
      }
      var pos = new Float32Array(total * 3);
      var nor = new Float32Array(total * 3);
      var uv = hasUv ? new Float32Array(total * 2) : null;
      var cor = b.porUuid ? null : new Float32Array(total * 3);
      var off = 0;
      for (i = 0; i < b.geoms.length; i++) {
        var ga = b.geoms[i].attributes;
        pos.set(ga.position.array, off * 3);
        if (ga.normal) nor.set(ga.normal.array, off * 3);
        if (uv && ga.uv) uv.set(ga.uv.array, off * 2);
        if (cor) {
          // cor do material × cor-de-vértice que a peça já trouxesse
          var c = b.cores[i] || { r: 1, g: 1, b: 1 };
          var vc = b.usaVC[i] ? (ga.color || null) : null;
          for (var v = 0; v < ga.position.count; v++) {
            var j = (off + v) * 3;
            cor[j]     = c.r * (vc ? vc.getX(v) : 1);
            cor[j + 1] = c.g * (vc ? vc.getY(v) : 1);
            cor[j + 2] = c.b * (vc ? vc.getZ(v) : 1);
          }
        }
        off += ga.position.count;
        b.geoms[i].dispose();
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      if (cor) geo.setAttribute('color', new THREE.BufferAttribute(cor, 3));

      var mat = b.mat;
      if (!b.porUuid) {
        var src = b.mat;
        mat = new THREE.MeshToonMaterial({
          map: texCanonica[chaveTextura(src.map)] || src.map || null,
          gradientMap: src.gradientMap || null,
          vertexColors: true, color: 0xffffff,
          transparent: src.transparent, opacity: src.opacity,
          side: src.side, depthWrite: src.depthWrite, alphaTest: src.alphaTest
        });
        if (src.userData && src.userData.envOutline) mat.userData.envOutline = 1;
      }
      var ms = new THREE.Mesh(geo, mat);
      ms.castShadow = b.cast;
      ms.receiveShadow = b.recv;
      out.add(ms);
      // traço FINO no ambiente (só materiais marcados: paredes/pilares/props)
      if (!semTraco && mat.userData && mat.userData.envOutline) {
        var oc = b.mat.color ? b.mat.color.clone().convertLinearToSRGB() : new THREE.Color('#443344');
        oc.multiplyScalar(0.30).lerp(new THREE.Color('#171226'), 0.4);
        var hull = new THREE.Mesh(hullGeometry(geo), outlineMat('#' + oc.getHexString(), 0.0016));
        hull.userData.outline = 1;
        hull.castShadow = false; hull.receiveShadow = false;
        ms.add(hull);
      }
    });
    // luzes/sprites/marcadores presos ao mundo (transform global preservado)
    var wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    keep.forEach(function (n) {
      n.updateWorldMatrix(true, false);
      n.matrixWorld.decompose(wp, wq, ws);
      var c = n.clone();
      c.position.copy(wp);
      c.quaternion.copy(wq);
      c.scale.copy(ws);
      out.add(c);
    });
    return out;
  };

  // ----------------------------------------------------------- primitivas
  function mesh(geo, m) {
    var ms = new THREE.Mesh(geo, m);
    ms.castShadow = true; ms.receiveShadow = false;
    return ms;
  }
  function box(w, h, d, m, x, y, z) {
    var ms = mesh(new THREE.BoxGeometry(w, h, d), m);
    ms.position.set(x || 0, y || 0, z || 0); return ms;
  }
  function cyl(rt, rb, h, seg, m, x, y, z) {
    var ms = mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 8), m);
    ms.position.set(x || 0, y || 0, z || 0); return ms;
  }
  function sph(r, m, x, y, z, w, hh) {
    var ms = mesh(new THREE.SphereGeometry(r, w || 10, hh || 8), m);
    ms.position.set(x || 0, y || 0, z || 0); return ms;
  }
  function ico(r, det, m, x, y, z) {
    var ms = mesh(new THREE.IcosahedronGeometry(r, det || 0), m);
    ms.position.set(x || 0, y || 0, z || 0); return ms;
  }
  function cone(r, h, seg, m, x, y, z) {
    var ms = mesh(new THREE.ConeGeometry(r, h, seg || 8), m);
    ms.position.set(x || 0, y || 0, z || 0); return ms;
  }
  function tor(r, t, m, x, y, z, arc) {
    var ms = mesh(new THREE.TorusGeometry(r, t, 6, 12, arc || Math.PI * 2), m);
    ms.position.set(x || 0, y || 0, z || 0); return ms;
  }
  function lathe(pts, seg, m, x, y, z) {
    var v = [];
    for (var i = 0; i < pts.length; i++) v.push(new THREE.Vector2(pts[i][0], pts[i][1]));
    var ms = mesh(new THREE.LatheGeometry(v, seg || 10), m);
    ms.position.set(x || 0, y || 0, z || 0); return ms;
  }
  function grp(x, y, z) {
    var g = new THREE.Group();
    g.position.set(x || 0, y || 0, z || 0); return g;
  }
  // jitter de vértices p/ visual lapidado à mão (mantém base plana se keepBase)
  function jitterGeo(geo, amp, keepBase) {
    var g2 = geo.toNonIndexed();
    var pos = g2.attributes.position;
    var seenY = {};
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (keepBase && y < 0.01) continue;
      var k = (Math.round(x * 37) * 13 + Math.round(y * 41) * 7 + Math.round(z * 53)) % 100;
      var r = Math.sin(k * 12.9898) * 43758.5453; r = r - Math.floor(r);
      var r2 = Math.sin(k * 78.233) * 12543.21; r2 = r2 - Math.floor(r2);
      pos.setX(i, x + (r - 0.5) * amp);
      pos.setZ(i, z + (r2 - 0.5) * amp);
      seenY[k] = 1;
    }
    g2.computeVertexNormals();
    return g2;
  }
  function srand(seed) {
    var s = (seed == null ? 1 : seed) >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // ================================================================ AMBIENTE

  // textura de HALO aditivo (glow de tocha/braseiro) — cache único
  var haloTex = null;
  function getHaloTex() {
    if (haloTex) return haloTex;
    // halo DESENHADO: miolo chapado + anel destacado (não gradiente fotográfico)
    var cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    var c2 = cv.getContext('2d');
    var gr = c2.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.42, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.48, 'rgba(255,255,255,0.16)');
    gr.addColorStop(0.72, 'rgba(255,255,255,0.13)');
    gr.addColorStop(0.80, 'rgba(255,255,255,0.30)');
    gr.addColorStop(0.86, 'rgba(255,255,255,0.05)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    c2.fillStyle = gr;
    c2.fillRect(0, 0, 64, 64);
    haloTex = new THREE.CanvasTexture(cv);
    haloTex.encoding = THREE.sRGBEncoding;
    return haloTex;
  }
  // sprite de halo (aditivo). userData.flicker=1 faz o renderer tremular
  M.makeHalo = function (hex, scale, opacity) {
    var m2 = new THREE.SpriteMaterial({
      map: getHaloTex(),
      color: new THREE.Color(hex).convertSRGBToLinear(),
      blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false,
      opacity: opacity != null ? opacity : 0.55
    });
    var sp = new THREE.Sprite(m2);
    sp.scale.setScalar(scale || 1.2);
    sp.userData.flicker = 1;
    sp.userData.baseOpacity = m2.opacity;
    sp.userData.baseScale = scale || 1.2;
    return sp;
  };
  // marcador de luz pontual (o renderer aloca luzes reais de um pool)
  function lightMarker(hex, intensity, dist, y) {
    var o = new THREE.Object3D();
    o.userData.keep = 1;
    o.userData.torchLight = { color: hex, intensity: intensity, dist: dist };
    if (y != null) o.position.y = y;
    return o;
  }

  // ---- manchas por tema (decal transparente sobre a lajota)
  var stainCache = {};
  function stainMat(theme, v) {
    var key = theme + '|' + v;
    if (stainCache[key]) return stainCache[key];
    var cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    var c2 = cv.getContext('2d');
    var rnd = srand(v * 977 + (theme === 'forge' ? 5 : theme === 'cistern' ? 11 : 17));
    var i, x, y, r;
    if (theme === 'garden') {              // musgo: manchas verdes irregulares
      for (i = 0; i < 26; i++) {
        x = 24 + rnd() * 80; y = 24 + rnd() * 80; r = 5 + rnd() * 17;
        c2.fillStyle = 'rgba(' + (52 + (rnd() * 28 | 0)) + ',' + (92 + (rnd() * 40 | 0)) + ',44,' + (0.10 + rnd() * 0.16) + ')';
        c2.beginPath(); c2.ellipse(x, y, r, r * (0.5 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2); c2.fill();
      }
    } else if (theme === 'cistern') {      // poça: mancha escura com brilho frio
      x = 64; y = 64;
      for (i = 5; i > 0; i--) {
        c2.fillStyle = 'rgba(10,26,34,' + (0.09 + i * 0.045) + ')';
        c2.beginPath(); c2.ellipse(x, y, 12 + i * 8 + rnd() * 6, 8 + i * 6 + rnd() * 5, rnd() * 0.8, 0, Math.PI * 2); c2.fill();
      }
      c2.strokeStyle = 'rgba(126,240,212,0.20)';
      c2.lineWidth = 1.5;
      c2.beginPath(); c2.ellipse(x - 6, y - 6, 17 + rnd() * 8, 10 + rnd() * 5, 0.4, 0, Math.PI * 2); c2.stroke();
    } else {                               // fuligem: riscas radiais escuras
      for (i = 0; i < 22; i++) {
        x = 20 + rnd() * 88; y = 20 + rnd() * 88;
        c2.fillStyle = 'rgba(8,4,3,' + (0.10 + rnd() * 0.18) + ')';
        c2.beginPath(); c2.ellipse(x, y, 4 + rnd() * 15, 3 + rnd() * 9, rnd() * 3, 0, Math.PI * 2); c2.fill();
      }
      c2.strokeStyle = 'rgba(255,110,40,0.10)';
      c2.lineWidth = 1;
      for (i = 0; i < 5; i++) {
        c2.beginPath(); x = rnd() * 128; y = rnd() * 128;
        c2.moveTo(x, y); c2.lineTo(x + (rnd() - 0.5) * 46, y + (rnd() - 0.5) * 30); c2.stroke();
      }
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    var m2 = new THREE.MeshToonMaterial({
      map: tex, gradientMap: toonRamp(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1
    });
    stainCache[key] = m2;
    return m2;
  }

  // ---- piso: lajotas do kit com juntas legíveis, xadrez com contraste + manchas
  M.buildTile = function (theme, kind, variant) {
    theme = normTheme(theme);
    var pal = M.themePalette(theme);
    var g = grp();
    var v = (variant == null ? 0 : variant) | 0;
    var key, tint;
    if (kind === 'deco') {
      if (theme === 'garden') { key = (v % 2) ? 'floor_weeds2' : 'floor_weeds'; tint = shade(pal.floor1, 2.5); }
      else if (theme === 'cistern') { key = 'floor_deco'; tint = shade(mix(pal.floor2, pal.accent, 0.16), 2.3); }
      else { key = 'floor_grate'; tint = shade('#6a4a40', 1.35); }
    } else {
      key = (v % 8 === 1) ? 'floor_b' : (v % 8 === 5) ? 'floor_c' : 'floor_a';
      // xadrez com contraste legível (sem virar tabuleiro de damas)
      var base = (kind === 'floor2') ? shade(pal.floor2, 2.12) : shade(pal.floor1, 1.8);
      var wob = 0.92 + ((v * 37) % 7) * 0.03;
      tint = shade('#' + base.getHexString(), wob * (theme === 'forge' ? 1.12 : 1.0));
    }
    var t = kitClone(key, '#' + tint.getHexString(), { noCast: true });
    t.position.y = -0.05;                        // topo da lajota do kit fica em y=0
    if (key === 'floor_grate') {
      t.scale.x = 0.5;                           // peça 4x2 do kit → célula 2x2
      // brasa viva sob a grelha (GDD: luz vem de baixo)
      var emberM = cmat('tile-ember', '#2a0a06', { emissive: '#ff5210', ei: 1.0, rough: 1 });
      var ember = mesh(new THREE.PlaneGeometry(CELL * 0.82, CELL * 0.82), emberM);
      ember.rotation.x = -Math.PI / 2; ember.position.y = -0.42;
      ember.castShadow = false; ember.receiveShadow = false;
      g.add(ember);
    }
    if (kind !== 'deco') t.rotation.y = (v % 4) * Math.PI / 2;   // quebra a repetição
    g.add(t);
    // mancha temática esparsa (~1 em 5 células)
    if (kind !== 'deco' && (v % 23) < 4) {
      var st = mesh(new THREE.PlaneGeometry(CELL, CELL), stainMat(theme, v % 3));
      st.rotation.x = -Math.PI / 2;
      st.rotation.z = (v % 4) * Math.PI / 2;
      st.position.y = 0.012;
      st.castShadow = false; st.receiveShadow = true;
      g.add(st);
    }
    return g;
  };

  // ---- PAREDES: módulos reais do kit, auto-tiling por vizinhança.
  // Peças nativas: 4u de comprimento, 4u de altura, 1u de espessura.
  // Escala 0.5 uniforme ⇒ 1 célula (2u) por peça, altura 2u, tijolos corretos.
  var WK = 0.5;                       // escala do kit p/ paredes
  var WALL_TINT = {
    garden:  '#c9b184',               // treliça/pedra amadeirada com musgo
    cistern: '#9cbccb',               // pedra úmida azulada
    forge:   '#c29278'                // pedra queimada avermelhada
  };
  var WALL_BASE_TINT = {
    garden: '#5a4c34', cistern: '#2c4450', forge: '#3f2820'
  };
  function wallPiece(theme, key) {
    var w = kitClone(key, WALL_TINT[theme] || WALL_TINT.garden, { envOutline: 1 });
    w.scale.setScalar(WK);
    return w;
  }
  // opts.mask = {n,e,s,w} paredes vizinhas; opts.border = true se célula de borda
  M.buildWall = function (theme, seed, opts) {
    theme = normTheme(theme);
    opts = opts || {};
    var mask = opts.mask || {};
    var rnd = srand((seed == null ? 1 : seed) * 7919 + 13);
    var g = grp();

    // lajota escura de fundação sob a parede (assenta a peça no chão)
    var basePlate = kitClone('floor_a', WALL_BASE_TINT[theme], { noCast: true });
    basePlate.position.y = -0.05;
    g.add(basePlate);

    var n = !!mask.n, e = !!mask.e, s = !!mask.s, w = !!mask.w;
    var count = (n ? 1 : 0) + (e ? 1 : 0) + (s ? 1 : 0) + (w ? 1 : 0);
    var piece = null, ry = 0;

    if (count === 4) { piece = wallPiece(theme, 'wall_cross'); }
    else if (count === 3) {
      piece = wallPiece(theme, 'wall_tsplit');          // reto em X, ramo p/ +Z
      if (e && w && s) ry = 0;
      else if (e && w && n) ry = Math.PI;
      else if (n && s && e) ry = Math.PI / 2;
      else ry = -Math.PI / 2;                            // n+s+w
    } else if (count === 2 && ((e && w) || (n && s))) {
      // reto: variantes p/ ritmo (pilar embutido, rachada, quebrada, janela na borda)
      var r = rnd();
      var key = 'wall_str';
      if (r < 0.16) key = 'wall_pil';
      else if (r < 0.30) key = 'wall_str2';
      else if (r < 0.38) key = 'wall_str3';
      else if (opts.border && theme !== 'garden' && r < 0.50) key = 'wall_win';
      piece = wallPiece(theme, key);
      ry = (e && w) ? 0 : Math.PI / 2;
      if (rnd() < 0.5) ry += Math.PI;                    // alterna a face "bonita"
    } else if (count === 2) {
      piece = wallPiece(theme, 'wall_corner');           // braços p/ -X e +Z
      if (w && s) ry = 0;
      else if (s && e) ry = Math.PI / 2;
      else if (e && n) ry = Math.PI;
      else ry = -Math.PI / 2;                            // n+w
    } else if (count === 1) {
      // fim de corrida: meia-parede até o vizinho + poste de remate
      piece = wallPiece(theme, 'wall_half');             // corre de 0 a +X
      ry = e ? 0 : w ? Math.PI : s ? -Math.PI / 2 : Math.PI / 2;
      var post = kitClone('pillar', WALL_TINT[theme], { envOutline: 1 });
      post.scale.setScalar(0.56);
      g.add(post);
    } else {
      // isolada: pilar robusto (colunas da Cisterna etc.)
      var pil = kitClone((seed % 3 === 0) ? 'pillar_deco' : 'pillar', WALL_TINT[theme], { envOutline: 1 });
      pil.scale.setScalar(0.6);
      pil.rotation.y = (seed % 4) * Math.PI / 2;
      g.add(pil);
    }
    if (piece) { piece.rotation.y = ry; g.add(piece); }

    var h = WALL_H;                                      // 2.0 na escala nova
    // coroamento temático discreto no topo do trecho reto
    if (theme === 'forge' && piece && count >= 2 && rnd() < 0.6) {
      var seam = box(CELL * 0.98, 0.045, 0.2, cmat('wall-ember', '#2a0c06', { emissive: '#ff5210', ei: 0.9 }), 0, h - 0.03, 0);
      seam.rotation.y = ry;
      seam.castShadow = false;
      g.add(seam);
    } else if (theme === 'garden' && piece && rnd() < 0.55) {
      // heras derramando da crista
      var vineM = cmat('wall-vine', '#3f6428', { rough: 1 });
      for (var vi = 0; vi < 2; vi++) {
        var vx = (rnd() - 0.5) * CELL * 0.8;
        var vz = (rnd() < 0.5 ? -1 : 1) * 0.3;
        var vine = box(0.14, 0.5 + rnd() * 0.7, 0.06, vineM, vx, h - 0.3 - rnd() * 0.25, vz);
        if (Math.abs(ry % Math.PI) > 0.1) { vine.position.set(vz, vine.position.y, vx); }
        vine.castShadow = false;
        g.add(vine);
      }
    }

    // adereços em faces expostas (o renderer diz a direção p/ FORA da parede)
    if (opts.torchDir) {
      var tw = kitClone('torch_wall', null, {});
      tw.scale.setScalar(0.85);
      tw.position.set(opts.torchDir.x * 0.3, h * 0.62, opts.torchDir.z * 0.3);
      tw.rotation.y = Math.atan2(opts.torchDir.x, opts.torchDir.z);
      g.add(tw);
      var fx2 = opts.torchDir.x * 0.44, fz2 = opts.torchDir.z * 0.44;
      var fl = sph(0.085, cmat('wall-torchflame', '#ffc06a', { emissive: '#ff9a3c', ei: 2.0 }), fx2, h * 0.62 + 0.5, fz2, 6, 5);
      fl.castShadow = false;
      g.add(fl);
      var halo = M.makeHalo('#ff9a4a', 1.5, 0.5);
      halo.position.set(fx2, h * 0.62 + 0.55, fz2);
      g.add(halo);
      var lm = lightMarker('#ff8a3c', 0.95, 7.5);
      lm.position.set(fx2, h * 0.62 + 0.6, fz2);
      g.add(lm);
    }
    if (opts.bannerDir) {
      // banner nativo: pano em +z, y 0.53..3.73 — escala 0.5 casa com parede 2.0
      var bset = theme === 'garden' ? ['banner_green', 'banner_pat_g']
        : theme === 'cistern' ? ['banner_blue', 'banner_pat_b']
          : ['banner_red', 'banner_pat_r'];
      // tint escurece o pano p/ não estourar sob o rim frio da Cisterna
      var btint = theme === 'cistern' ? '#7a9cc8' : null;
      var bn = kitClone(bset[seed % bset.length], btint, {});
      bn.scale.setScalar(0.5);
      bn.position.set(opts.bannerDir.x * 0.26, 0.06, opts.bannerDir.z * 0.26);
      bn.rotation.y = Math.atan2(opts.bannerDir.x, opts.bannerDir.z);
      g.add(bn);
    }
    return g;
  };

  // textura de fundo de buraco: crosta escura com veios luminosos por tema
  function moltenMat(theme) {
    var key = 'hole-' + (theme === 'forge' ? 'lava' : theme === 'cistern' ? 'water' : 'soil');
    if (envMatCache[key]) return envMatCache[key];
    var cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    var c2 = cv.getContext('2d');
    var rnd = srand(theme === 'forge' ? 41 : theme === 'cistern' ? 43 : 47);
    var i, j, x, y;
    // estilo GRÁFICO: bandas chapadas de 2 tons, sem blur (cartoon, não foto)
    if (theme === 'forge') {
      c2.fillStyle = '#240804';
      c2.fillRect(0, 0, 128, 128);
      for (i = 0; i < 20; i++) {                 // placas de crosta chapadas
        c2.fillStyle = (i % 2) ? '#180402' : '#30100a';
        c2.beginPath();
        c2.ellipse(rnd() * 128, rnd() * 128, 9 + rnd() * 18, 7 + rnd() * 12, rnd() * 3, 0, Math.PI * 2);
        c2.fill();
      }
      // veios de magma em DUAS BANDAS (larga laranja + miolo claro)
      for (i = 0; i < 8; i++) {
        var pts = [[rnd() * 128, rnd() * 128]];
        for (j = 0; j < 4; j++) {
          pts.push([pts[j][0] + (rnd() - 0.5) * 55, pts[j][1] + (rnd() - 0.5) * 55]);
        }
        c2.lineCap = 'round'; c2.lineJoin = 'round';
        c2.strokeStyle = '#ff7a22'; c2.lineWidth = 5.5 + rnd() * 2;
        c2.beginPath(); c2.moveTo(pts[0][0], pts[0][1]);
        for (j = 1; j < pts.length; j++) c2.lineTo(pts[j][0], pts[j][1]);
        c2.stroke();
        c2.strokeStyle = '#ffd873'; c2.lineWidth = 2;
        c2.beginPath(); c2.moveTo(pts[0][0], pts[0][1]);
        for (j = 1; j < pts.length; j++) c2.lineTo(pts[j][0], pts[j][1]);
        c2.stroke();
      }
    } else if (theme === 'cistern') {
      c2.fillStyle = '#06303c';
      c2.fillRect(0, 0, 128, 128);
      // ondas gráficas: anéis grossos de 2 tons
      c2.lineCap = 'round';
      for (i = 0; i < 10; i++) {
        x = rnd() * 128; y = rnd() * 128;
        var rw = 10 + rnd() * 24, rh = 6 + rnd() * 14, rot = rnd() * 3;
        c2.strokeStyle = '#27d8b4'; c2.lineWidth = 3.6;
        c2.beginPath(); c2.ellipse(x, y, rw, rh, rot, 0, Math.PI * 2); c2.stroke();
        c2.strokeStyle = '#c2fff0'; c2.lineWidth = 1.3;
        c2.beginPath(); c2.ellipse(x, y, rw * 0.72, rh * 0.72, rot, 0, Math.PI * 2); c2.stroke();
      }
    } else {
      c2.fillStyle = '#140d06';
      c2.fillRect(0, 0, 128, 128);
      // raízes chunky + esporos gordos
      c2.lineCap = 'round';
      for (i = 0; i < 9; i++) {
        c2.strokeStyle = (i % 2) ? '#4a6a2a' : '#3a5220';
        c2.lineWidth = 3 + rnd() * 3;
        c2.beginPath();
        x = rnd() * 128; y = rnd() * 128;
        c2.moveTo(x, y);
        for (j = 0; j < 3; j++) { x += (rnd() - 0.5) * 50; y += (rnd() - 0.5) * 50; c2.lineTo(x, y); }
        c2.stroke();
      }
      c2.fillStyle = '#8ee27a';
      for (i = 0; i < 14; i++) {
        c2.beginPath(); c2.arc(rnd() * 128, rnd() * 128, 1.6 + rnd() * 2.6, 0, Math.PI * 2); c2.fill();
      }
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    var m2 = new THREE.MeshToonMaterial({
      map: tex, emissiveMap: tex, gradientMap: toonRamp(),
      color: new THREE.Color('#8a8a8a').convertSRGBToLinear(),
      emissive: new THREE.Color('#ffffff').convertSRGBToLinear(),
      emissiveIntensity: theme === 'forge' ? 1.1 : theme === 'cistern' ? 0.85 : 0.55
    });
    envMatCache[key] = m2;
    return m2;
  }

  // ---- buraco: cavidade com fundo emissivo temático
  M.buildHole = function (theme, seed) {
    theme = normTheme(theme);
    var pal = M.themePalette(theme);
    var rnd = srand((seed == null ? 3 : seed) * 104729 + 7);
    var g = grp();
    var D = 1.15;                                   // profundidade
    var wallC = shade(pal.wall, 0.85);
    var innerM = cmat('hole-inner|' + theme, wallC, { rough: 1, side: THREE.BackSide });
    // poço: caixa sem tampa vista por dentro
    var shaft = mesh(new THREE.BoxGeometry(CELL * 0.98, D, CELL * 0.98), innerM);
    shaft.position.y = -D / 2;
    shaft.castShadow = false; shaft.receiveShadow = true;
    g.add(shaft);
    // superfície luminosa RASA com TEXTURA (crosta escura + veios que brilham)
    var bottomM, bottomY = -D + 0.02;
    if (theme === 'forge') { bottomM = moltenMat('forge'); bottomY = -0.5; }
    else if (theme === 'cistern') { bottomM = moltenMat('cistern'); bottomY = -0.42; }
    else { bottomM = moltenMat('garden'); bottomY = -0.72; }
    var bottom = mesh(new THREE.PlaneGeometry(CELL * 0.96, CELL * 0.96), bottomM);
    bottom.rotation.set(-Math.PI / 2, 0, (seed % 4) * Math.PI / 2);
    bottom.position.y = bottomY;
    bottom.castShadow = false; bottom.receiveShadow = false;
    g.add(bottom);
    // borda (meio-fio) para leitura da beirada
    var rimM = cmat('hole-rim|' + theme, shade(pal.wall, 1.9), { rough: 0.95 });
    for (var i = 0; i < 4; i++) {
      var a = i * Math.PI / 2;
      var rim = box(CELL * 1.02, 0.07, 0.1, rimM, 0, 0.03, 0);
      rim.position.x = Math.sin(a) * CELL * 0.47;
      rim.position.z = Math.cos(a) * CELL * 0.47;
      rim.rotation.y = a;
      rim.castShadow = false; rim.receiveShadow = true;
      g.add(rim);
    }
    if (theme === 'garden') {
      // raízes atravessando o canteiro afundado
      var rootM = cmat('hole-root', '#3a2c18', { rough: 1 });
      for (var r = 0; r < 2; r++) {
        var root = cyl(0.035, 0.05, CELL * (0.6 + rnd() * 0.3), 5, rootM, 0, -D * 0.55, 0);
        root.rotation.z = Math.PI / 2 + (rnd() - 0.5) * 0.6;
        root.rotation.y = rnd() * Math.PI;
        root.castShadow = false;
        g.add(root);
      }
    }
    return g;
  };

  // ---- props de borda por tema (kit + tint)
  var PROPS = {
    garden: [
      { key: 'trunk', s: [1.0, 1.5] },
      { key: 'barrel', tint: '#9a6a48', s: [0.8, 1.05] },          // vaso de barro
      { key: 'rubble', tint: '#6a7a52', s: [0.32, 0.44] },         // entulho musgoso
      { key: 'column', tint: '#8a7a5a', s: [0.9, 1.2] },
      { key: 'bottle', s: [1.2, 1.7] },
      { key: 'crates', tint: '#7a6a4a', s: [0.55, 0.7] },
      { key: 'chest', tint: '#7a6a4a', s: [0.55, 0.7] }
    ],
    cistern: [
      { key: 'pillar', tint: '#5a707a', s: [0.42, 0.5] },
      { key: 'candle', s: [0.85, 1.05] },
      { key: 'chest', tint: '#5a6a78', s: [0.6, 0.75] },
      { key: 'coins', tint: '#c8b06a', s: [0.8, 1.1] },
      { key: 'table', tint: '#4a5a68', s: [0.7, 0.85] },
      { key: 'chair', tint: '#4a5a68', s: [0.8, 1.0] },
      { key: 'bottle', tint: '#4a8a8a', s: [1.2, 1.6] },
      { key: 'rubble', tint: '#3c4c56', s: [0.3, 0.42] }
    ],
    forge: [
      { key: 'keg', tint: '#6a4432', s: [0.7, 0.9] },
      { key: 'box_big', tint: '#5a4030', s: [0.75, 0.95] },
      { key: 'crates', tint: '#5a4030', s: [0.55, 0.7] },
      { key: 'rubble_big', tint: '#4a3228', s: [0.26, 0.34] },
      { key: 'barrier', tint: '#4a3a34', s: [0.85, 1.0] },
      { key: 'barrier_col', tint: '#4a3a34', s: [0.85, 1.0] },
      { key: 'torch', s: [1.1, 1.3] }
    ]
  };
  M.propKinds = function (theme) {
    var list = PROPS[normTheme(theme)] || PROPS.garden;
    return list.map(function (p) { return p.key; });
  };
  M.buildProp = function (theme, kind, seed) {
    theme = normTheme(theme);
    var list = PROPS[theme] || PROPS.garden;
    var spec = null;
    for (var i = 0; i < list.length; i++) if (list[i].key === kind) { spec = list[i]; break; }
    if (!spec) spec = list[(seed || 0) % list.length];
    var rnd = srand((seed == null ? 5 : seed) * 31 + 17);
    var g = kitClone(spec.key, spec.tint || null, { envOutline: 1 });
    var s = spec.s[0] + rnd() * (spec.s[1] - spec.s[0]);
    g.scale.setScalar(s);
    g.rotation.y = rnd() * Math.PI * 2;
    return g;
  };

  // ---- chão ESTENDIDO ao redor do tabuleiro (o campo é um lugar)
  // Anel com RECORTE sob a grade (senão o plano atravessaria os buracos) +
  // rodapé que sela o perímetro. Origem = célula (0,0) do grid.
  // `solido(x, y)` (opcional) diz se a célula faz parte da sala. Com ele, o
  // rodapé passa a contornar a SILHUETA real em vez do retângulo da grade —
  // era o rodapé que re-quadrava a sala inteira depois de os mapas ganharem
  // recorte próprio, e ele virou a última coisa retangular em cena.
  // Sem o argumento, o comportamento antigo continua valendo.
  M.buildGround = function (theme, wCells, hCells, solido) {
    var g = grp();
    var w = wCells || 13, h = hCells || 11;
    var cx = (w - 1) / 2 * CELL, cz = (h - 1) / 2 * CELL;
    var SIZE = CELL * 64;
    var tex = groundTexture(theme);
    var m = new THREE.MeshToonMaterial({ map: tex, gradientMap: toonRamp(), color: new THREE.Color(0x9a9a9a).convertSRGBToLinear() });
    // moldura: retângulo externo com furo exatamente sob a grade
    // (rotateX(-90°) leva (x, y) do shape a (x, 0, −y) ⇒ construir com y = −z)
    var shape = new THREE.Shape();
    shape.moveTo(cx - SIZE / 2, -(cz - SIZE / 2));
    shape.lineTo(cx + SIZE / 2, -(cz - SIZE / 2));
    shape.lineTo(cx + SIZE / 2, -(cz + SIZE / 2));
    shape.lineTo(cx - SIZE / 2, -(cz + SIZE / 2));
    shape.closePath();
    var x0 = -CELL / 2, z0 = -CELL / 2, x1 = (w - 0.5) * CELL, z1 = (h - 0.5) * CELL;
    var hole = new THREE.Path();
    hole.moveTo(x0, -z0); hole.lineTo(x1, -z0); hole.lineTo(x1, -z1); hole.lineTo(x0, -z1);
    hole.closePath();
    shape.holes.push(hole);
    var geo = new THREE.ShapeGeometry(shape, 4);
    geo.rotateX(-Math.PI / 2);                   // shape XY → plano XZ (topo p/ cima)
    tex.repeat.set(1 / 9, 1 / 9);                // UVs em unidades de mundo
    var ring = new THREE.Mesh(geo, m);
    ring.position.y = -0.12;
    ring.receiveShadow = true;
    ring.castShadow = false;
    g.add(ring);
    // rodapé escuro selando o vão sob a borda da grade
    var pal = M.themePalette(theme);
    var skirtM = cmat('ground-skirt|' + theme, shade(pal.wall, 0.7), { rough: 1 });
    var SKH = 1.6, SKT = 0.4;
    function skirt(px, pz, sx2, sz2) {
      var b = box(sx2, SKH, sz2, skirtM, px, -SKH / 2 - 0.02, pz);
      b.castShadow = false; b.receiveShadow = true;
      g.add(b);
    }
    if (typeof solido !== 'function') {
      // sem mapa: retângulo, como sempre foi
      skirt(cx, z0 + 0.02 - SKT / 2, (w + 0.5) * CELL, SKT);
      skirt(cx, z1 - 0.02 + SKT / 2, (w + 0.5) * CELL, SKT);
      skirt(x0 + 0.02 - SKT / 2, cz, SKT, (h + 0.5) * CELL);
      skirt(x1 - 0.02 + SKT / 2, cz, SKT, (h + 0.5) * CELL);
      return g;
    }
    // com mapa: um trecho de rodapé em cada ARESTA de fronteira, isto é, toda
    // vez que uma célula da sala encosta em vazio ou na borda do mundo. O
    // contorno sai exatamente igual ao da sala, com cantos, reentrâncias e tudo.
    var vx, vy;
    for (vy = 0; vy < h; vy++) {
      for (vx = 0; vx < w; vx++) {
        if (!solido(vx, vy)) continue;
        var px = vx * CELL, pz = vy * CELL;
        if (!solido(vx, vy - 1)) skirt(px, pz - CELL / 2 + SKT / 2, CELL + SKT, SKT);
        if (!solido(vx, vy + 1)) skirt(px, pz + CELL / 2 - SKT / 2, CELL + SKT, SKT);
        if (!solido(vx - 1, vy)) skirt(px - CELL / 2 + SKT / 2, pz, SKT, CELL + SKT);
        if (!solido(vx + 1, vy)) skirt(px + CELL / 2 - SKT / 2, pz, SKT, CELL + SKT);
      }
    }
    return g;
  };

  function groundTexture(theme) {
    theme = normTheme(theme);
    var pal = M.themePalette(theme);
    var cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    var c2 = cv.getContext('2d');
    // ESCURO de verdade (o palco é o tabuleiro; fora é penumbra que vai à névoa)
    var f1 = shade(pal.floor1, 0.72), f2 = shade(pal.floor2, 0.78);
    c2.fillStyle = '#' + f1.getHexString();
    c2.fillRect(0, 0, 256, 256);
    var rnd = srand(theme === 'forge' ? 11 : theme === 'cistern' ? 23 : 37);
    var i, x0, y0;
    // desenho TOROIDAL (repete nas 4 direções) — some a grade de espelhamento
    function blot(x, y, rw, rh, rot, style) {
      c2.fillStyle = style;
      for (var ox = -256; ox <= 256; ox += 256) {
        for (var oy = -256; oy <= 256; oy += 256) {
          c2.beginPath();
          c2.ellipse(x + ox, y + oy, rw, rh, rot, 0, Math.PI * 2);
          c2.fill();
        }
      }
    }
    for (i = 0; i < 150; i++) {                       // manchas de terreno
      var st = 'rgba(' + (rnd() < 0.5 ? '0,0,0' : Math.round(f2.r * 255) + ',' + Math.round(f2.g * 255) + ',' + Math.round(f2.b * 255)) + ',' + (0.05 + rnd() * 0.1) + ')';
      blot(rnd() * 256, rnd() * 256, 6 + rnd() * 26, 4 + rnd() * 18, rnd() * 3, st);
    }
    // decalques temáticos esparsos
    for (i = 0; i < 50; i++) {
      if (theme === 'forge') {
        c2.strokeStyle = 'rgba(255,120,50,' + (0.05 + rnd() * 0.08) + ')';
        c2.lineWidth = 1 + rnd();
        c2.beginPath(); x0 = 20 + rnd() * 216; y0 = 20 + rnd() * 216;
        c2.moveTo(x0, y0); c2.lineTo(x0 + (rnd() - 0.5) * 30, y0 + (rnd() - 0.5) * 18); c2.stroke();
      } else if (theme === 'cistern') {
        blot(rnd() * 256, rnd() * 256, 4 + rnd() * 14, 3 + rnd() * 8, 0, 'rgba(126,240,212,' + (0.03 + rnd() * 0.04) + ')');
      } else {
        blot(rnd() * 256, rnd() * 256, 5 + rnd() * 16, 3 + rnd() * 10, rnd() * 3, 'rgba(60,96,44,' + (0.06 + rnd() * 0.09) + ')');
      }
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  // ---- grade tática sutil sobre o piso (linhas finas aditivas)
  M.buildGridLines = function (theme, w, h) {
    var pal = M.themePalette(theme);
    var pts = [];
    // só o MIOLO jogável (o anel de borda é parede — linhas sob ela vazariam)
    var x0 = CELL / 2, z0 = CELL / 2;
    var iw = w - 2, ih = h - 2;
    var i;
    for (i = 0; i <= iw; i++) {
      pts.push(x0 + i * CELL, 0.028, z0, x0 + i * CELL, 0.028, z0 + ih * CELL);
    }
    for (i = 0; i <= ih; i++) {
      pts.push(x0, 0.028, z0 + i * CELL, x0 + iw * CELL, 0.028, z0 + i * CELL);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    var m2 = new THREE.LineBasicMaterial({
      color: new THREE.Color(pal.accent).convertSRGBToLinear(),
      transparent: true, opacity: 0.10,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var lines = new THREE.LineSegments(geo, m2);
    lines.renderOrder = 3;
    return lines;
  };

  // ---- braseiro/tocha de pé com halo + marcador de luz (cantos da sala)
  M.buildBrazier = function (theme, seed) {
    theme = normTheme(theme);
    var g = grp();
    var t = kitClone('torch', null, {});
    t.scale.setScalar(1.35);
    t.position.y = 0.55;                             // haste nativa começa em -0.4
    g.add(t);
    var col = theme === 'cistern' ? '#59e0c0' : '#ff9a4a';
    var fl = sph(0.11, cmat('brz-flame|' + theme, theme === 'cistern' ? '#8af0dc' : '#ffc06a',
      { emissive: theme === 'cistern' ? '#4adcc0' : '#ff9a3c', ei: 1.9 }), 0, 1.62, 0, 7, 6);
    fl.castShadow = false;
    g.add(fl);
    var halo = M.makeHalo(col, 2.0, 0.55);
    halo.position.y = 1.68;
    g.add(halo);
    var lm = lightMarker(theme === 'cistern' ? '#4adcc0' : '#ff8a3c', 1.0, 9);
    lm.position.y = 1.75;
    g.add(lm);
    M.addOutlines(g, { thick: 0.0022, color: '#1c1428', minR: 0.1 });
    return g;
  };

  // ---- arena de chefe: peça única por tema, encostada atrás do trono do chefe
  M.buildArena = function (theme) {
    theme = normTheme(theme);
    var g = grp();
    var i, a;
    if (theme === 'garden') {
      // TRONO DE CIPÓS: duas colunas abraçadas por heras + dossel luminoso
      var vineM = cmat('arena-vine', '#3f6428', { rough: 1 });
      var glowM = cmat('arena-fire', '#ffd76b', { emissive: '#ffd76b', ei: 1.5 });
      for (i = 0; i < 2; i++) {
        var px = i === 0 ? -1.5 : 1.5;
        var coln = kitClone('column', '#8a7a5a', {});
        coln.scale.set(1.5, 2.4, 1.5);
        coln.position.x = px;
        g.add(coln);
        for (a = 0; a < 4; a++) {
          var vv = cyl(0.055, 0.075, 1.4 + a * 0.35, 5, vineM, px + Math.sin(a * 2.1) * 0.3, 0.9 + a * 0.35, Math.cos(a * 1.7) * 0.3);
          vv.rotation.z = Math.sin(a * 3.3) * 0.35;
          vv.castShadow = false;
          g.add(vv);
        }
      }
      // verga de cipó ligando as colunas
      var lint = cyl(0.09, 0.09, 3.4, 7, vineM, 0, 3.15, 0);
      lint.rotation.z = Math.PI / 2;
      g.add(lint);
      // vagalumes-redoma no dossel
      for (i = 0; i < 4; i++) {
        var fx = -1.3 + i * 0.85;
        var orb = sph(0.07, glowM, fx, 2.75 + Math.sin(i * 2.2) * 0.25, 0.1, 6, 5);
        orb.castShadow = false;
        g.add(orb);
        var hh = M.makeHalo('#ffd76b', 0.8, 0.45);
        hh.position.set(fx, 2.78 + Math.sin(i * 2.2) * 0.25, 0.1);
        g.add(hh);
      }
      var lmg = lightMarker('#ffd76b', 0.85, 8);
      lmg.position.set(0, 2.9, 0.4);
      g.add(lmg);
    } else if (theme === 'cistern') {
      // CORTINA D'ÁGUA entre dois pilares (o renderer rola a textura)
      var pilL = kitClone('pillar', '#5a707a', {}); pilL.scale.setScalar(0.62); pilL.position.x = -1.7; g.add(pilL);
      var pilR = kitClone('pillar', '#5a707a', {}); pilR.scale.setScalar(0.62); pilR.position.x = 1.7; g.add(pilR);
      var cv = document.createElement('canvas');
      cv.width = 64; cv.height = 128;
      var c2 = cv.getContext('2d');
      c2.clearRect(0, 0, 64, 128);
      for (i = 0; i < 26; i++) {
        var wx = Math.random() * 64, ww = 1 + Math.random() * 2.5;
        var gr = c2.createLinearGradient(0, 0, 0, 128);
        gr.addColorStop(0, 'rgba(190,255,240,0)');
        gr.addColorStop(0.5, 'rgba(190,255,240,' + (0.25 + Math.random() * 0.4) + ')');
        gr.addColorStop(1, 'rgba(190,255,240,0)');
        c2.fillStyle = gr;
        c2.fillRect(wx, 0, ww, 128);
      }
      var wtex = new THREE.CanvasTexture(cv);
      wtex.wrapS = wtex.wrapT = THREE.RepeatWrapping;
      wtex.encoding = THREE.sRGBEncoding;
      var wm = new THREE.MeshBasicMaterial({
        map: wtex, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
        color: new THREE.Color('#7ef0d4').convertSRGBToLinear()
      });
      var sheet = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.35), wm);
      sheet.position.y = 1.28;
      sheet.castShadow = false; sheet.receiveShadow = false;
      sheet.userData.keep = 1;
      sheet.userData.scrollV = 1.4;                    // renderer: tex.offset.y -= dt*scrollV
      g.add(sheet);
      // espuma na base
      var foam = mesh(new THREE.PlaneGeometry(3.2, 0.7), new THREE.MeshBasicMaterial({
        color: new THREE.Color('#bef7ea').convertSRGBToLinear(), transparent: true, opacity: 0.30,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      foam.rotation.x = -Math.PI / 2;
      foam.position.set(0, 0.05, 0.28);
      foam.castShadow = false;
      g.add(foam);
      var lmc = lightMarker('#4adcc0', 1.0, 9);
      lmc.position.set(0, 1.6, 0.7);
      g.add(lmc);
    } else {
      // BIGORNA-MONUMENTO em pedestal com veios de brasa
      var ironM = cmat('arena-iron', '#3a3238', { metal: 0.55, rough: 0.5 });
      var iron2 = cmat('arena-iron2', '#57484a', { metal: 0.6, rough: 0.42 });
      var embM = cmat('arena-emb', '#2a0c06', { emissive: '#ff4a08', ei: 0.8 });
      var ped = box(2.6, 0.5, 1.9, cmat('arena-ped', '#33231d', { rough: 0.95 }), 0, 0.25, 0);
      g.add(ped);
      var seam = box(2.66, 0.07, 1.96, embM, 0, 0.5, 0);
      seam.castShadow = false;
      g.add(seam);
      g.add(box(1.7, 0.5, 1.0, ironM, 0, 0.78, 0));      // corpo
      g.add(box(2.3, 0.42, 0.85, iron2, 0, 1.22, 0));    // mesa
      var horn = cone(0.34, 0.9, 8, iron2, 1.45, 1.22, 0);
      horn.rotation.z = -Math.PI / 2;
      g.add(horn);
      var eye = box(0.9, 0.08, 0.5, embM, 0, 1.46, 0);   // brasa na mesa
      eye.castShadow = false;
      g.add(eye);
      var hh2 = M.makeHalo('#ff7a2c', 2.4, 0.4);
      hh2.position.set(0, 1.7, 0);
      g.add(hh2);
      var lmf = lightMarker('#ff6a22', 0.9, 9);
      lmf.position.set(0, 2.3, 0.6);
      g.add(lmf);
    }
    // palco de chefe mais TEATRAL: maior e com traço
    g.scale.setScalar(1.18);
    M.addOutlines(g, { thick: 0.0022, color: '#1c1428', minR: 0.12 });
    return g;
  };

  // ================================================================ UNIDADES
  // Convenções: frente = +Z; pés em y=0; herói ~1.5–1.9 de altura; chefe ~2×.
  // Cada builder devolve {group, parts, animate(st, t, dt)} e o wrapper de
  // buildUnit aplica flash/death/opacity comuns.

  var RACE_PAL = {
    bellborn:    { a: '#b08543', b: '#3f8f7a', c: '#ffd98a' },
    waxkin:      { a: '#e8d5a8', b: '#8a5a44', c: '#ff8c3a' },
    sporeborn:   { a: '#7a5fa0', b: '#33453f', c: '#6fe0c8' },
    glassborn:   { a: '#6d7fd3', b: '#2e2a4a', c: '#ffd166' },
    bellowsborn: { a: '#7fb6b0', b: '#4a5a66', c: '#eef7f5' },
    flora:       { a: '#5a8f4d', b: '#8a6b3e', c: '#ffd76b' },
    court:       { a: '#2e6e8e', b: '#1d3a4d', c: '#7ef0d4' },
    forge:       { a: '#c4502e', b: '#4a2a26', c: '#ffb347' }
  };

  // balanço de andar + respiração genéricos aplicados ao corpo raiz
  function idleSway(node, t, amp, speed) {
    node.rotation.z = Math.sin(t * speed) * amp;
  }
  function walkRock(node, t, on) {
    if (on) {
      node.rotation.z = Math.sin(t * 13) * 0.09;
      node.position.y = Math.abs(Math.sin(t * 13)) * 0.09;
    }
  }

  // ---------------------------------------------------------------- HERÓIS

  // Repique — golem de bronze com cabeça-sino e badalo visível
  function buildToll() {
    var P = RACE_PAL.bellborn;
    var g = grp();
    var bronze = mat(P.a, { metal: 0.55, rough: 0.45 });
    var verdet = mat(P.b, { rough: 0.8 });
    var glowM = mat(P.c, { emissive: P.c, ei: 0.5 });
    var body = grp(0, 0, 0);
    g.add(body);
    // pernas curtas e firmes
    body.add(cyl(0.13, 0.17, 0.3, 7, bronze, -0.22, 0.15, 0));
    body.add(cyl(0.13, 0.17, 0.3, 7, bronze, 0.22, 0.15, 0));
    // torso abaulado (mais ATARRACADO — proporção cartoon)
    var torso = lathe([[0.001, 0], [0.34, 0.04], [0.44, 0.28], [0.4, 0.55], [0.26, 0.7], [0.001, 0.72]], 12, bronze, 0, 0.28, 0);
    torso.scale.set(1.16, 0.94, 1.16);
    body.add(torso);
    // veias de azinhavre
    var vein = tor(0.41, 0.03, verdet, 0, 0.62, 0); vein.rotation.x = Math.PI / 2; body.add(vein);
    var vein2 = tor(0.44, 0.025, verdet, 0, 0.48, 0); vein2.rotation.x = Math.PI / 2; body.add(vein2);
    // braços troncudos
    var armL = grp(-0.46, 0.85, 0), armR = grp(0.46, 0.85, 0);
    armL.add(cyl(0.09, 0.12, 0.5, 7, bronze, 0, -0.25, 0));
    armR.add(cyl(0.09, 0.12, 0.5, 7, bronze, 0, -0.25, 0));
    armL.add(sph(0.13, bronze, 0, -0.52, 0, 8, 6));
    armR.add(sph(0.13, bronze, 0, -0.52, 0, 8, 6));
    body.add(armL); body.add(armR);
    // cabeça-SINO GRANDE (+45% — assinatura cartoon), badalo à mostra no vão
    var head = grp(0, 1.18, 0);
    head.scale.setScalar(1.45);
    var bell = lathe([[0.36, 0], [0.4, 0.06], [0.33, 0.3], [0.24, 0.5], [0.12, 0.62], [0.001, 0.66]], 14, bronze, 0, 0, 0);
    head.add(bell);
    head.add(tor(0.375, 0.035, verdet, 0, 0.03, 0, Math.PI * 2)).children;
    var lip = head.children[head.children.length - 1]; lip.rotation.x = Math.PI / 2;
    head.add(sph(0.07, glowM, 0, 0.7, 0, 8, 6));              // pega no topo
    // BADALO visível pendendo ABAIXO da boca do sino (o "rosto" dele)
    var clapper = grp(0, 0.3, 0);
    clapper.add(cyl(0.025, 0.025, 0.42, 5, verdet, 0, -0.21, 0));
    clapper.add(sph(0.12, glowM, 0, -0.46, 0, 8, 6));
    head.add(clapper);
    body.add(head);
    return {
      group: g,
      animate: function (st, t) {
        body.rotation.z = 0; body.position.y = 0;
        walkRock(body, t, st.moving);
        if (!st.moving) idleSway(body, t, 0.035, 1.3);
        // badalo balança COM INÉRCIA — o "rosto" do Repique
        clapper.rotation.x = Math.sin(t * 2.1) * 0.5;
        clapper.rotation.z = Math.cos(t * 1.7) * 0.4;
        head.position.y = 1.18 + Math.sin(t * 1.3) * 0.055;
        head.rotation.z = Math.sin(t * 1.05) * 0.05;             // sino pende de leve
        if (st.castK > 0) {
          var k = Math.sin(st.castK * Math.PI);
          armL.rotation.x = -k * 2.1; armR.rotation.x = -k * 2.1;
          clapper.rotation.x = Math.sin(st.castK * Math.PI * 6) * 1.0;   // repica!
          head.position.y = 1.18 + k * 0.1;                       // sino salta
        } else { armL.rotation.x = 0; armR.rotation.x = 0; }
      }
    };
  }

  // Estopim — figura de cera escorrida com chama viva na cabeça
  function buildWick() {
    var P = RACE_PAL.waxkin;
    var g = grp();
    var wax = mat(P.a, { rough: 0.6 });
    var drip = mat(P.b, { rough: 0.7 });
    var flameM = mat('#ff7a26', { emissive: '#ff7a26', ei: 1.9 });
    var flame2M = mat('#ffc86a', { emissive: '#ffc86a', ei: 2.1 });
    var body = grp(); g.add(body);
    // corpo fino e derretido (gota escorrida)
    var trunk = lathe([[0.001, 0], [0.16, 0.02], [0.13, 0.35], [0.17, 0.7], [0.14, 1.05], [0.09, 1.25], [0.001, 1.32]], 9, wax, 0, 0, 0);
    body.add(trunk);
    // camadas escorridas nos ombros
    var cape = lathe([[0.16, 0], [0.23, 0.1], [0.15, 0.28], [0.001, 0.34]], 8, drip, 0, 1.0, 0);
    body.add(cape);
    // braços longos que pingam
    var armL = grp(-0.16, 1.12, 0), armR = grp(0.16, 1.12, 0);
    armL.add(cyl(0.028, 0.045, 0.62, 5, wax, 0, -0.31, 0));
    armR.add(cyl(0.028, 0.045, 0.62, 5, wax, 0, -0.31, 0));
    // adaga de cera fervente na mão direita
    var blade = box(0.06, 0.42, 0.02, flame2M, 0, -0.74, 0.1);
    blade.rotation.x = 0.6;
    armR.add(blade);
    // escorridos de cera pelo corpo (silhueta de vela usada)
    for (var dr = 0; dr < 4; dr++) {
      var da = dr * 1.7 + 0.4;
      var drip2 = cyl(0.025, 0.045, 0.22 + (dr % 2) * 0.14, 4, drip,
        Math.cos(da) * 0.15, 0.95 - dr * 0.06, Math.sin(da) * 0.13);
      body.add(drip2);
    }
    body.add(armL); body.add(armR);
    // cabeça derretida + CHAMA GRANDE no topo (assinatura, +50%)
    var head = sph(0.18, wax, 0, 1.42, 0, 8, 7);
    head.scale.y = 1.25;
    body.add(head);
    var flame = grp(0, 1.66, 0);
    var f0 = sph(0.13, flameM, 0, 0.11, 0, 8, 6);
    var f1 = cone(0.13, 0.44, 7, flameM, 0, 0.34, 0);
    var f2 = cone(0.065, 0.23, 6, flame2M, 0, 0.23, 0);
    flame.add(f0); flame.add(f1); flame.add(f2);
    var light = new THREE.PointLight(0xff9a4a, 0.9, 6.5, 2);
    light.position.y = 0.4;
    flame.add(light);
    body.add(flame);
    return {
      group: g,
      animate: function (st, t) {
        body.rotation.z = 0; body.position.y = 0;
        walkRock(body, t, st.moving);
        if (!st.moving) {
          body.rotation.z = Math.sin(t * 1.4) * 0.055;
          body.position.y = Math.sin(t * 2.1) * 0.035;
        }
        // chama DANÇA sempre (escala + rebolado — muito mais viva)
        var fl = 1 + Math.sin(t * 11) * 0.26 + Math.sin(t * 23.7) * 0.12;
        flame.scale.set(1, fl, 1);
        flame.rotation.z = Math.sin(t * 7.3) * 0.26;
        flame.rotation.x = Math.cos(t * 5.1) * 0.15;
        light.intensity = 0.75 + Math.sin(t * 9.1) * 0.2;
        if (st.castK > 0) {
          var k = Math.sin(st.castK * Math.PI);
          flame.scale.set(1 + k * 0.5, fl + k * 0.9, 1 + k * 0.5);
          light.intensity = 0.9 + k * 1.6;
          armR.rotation.x = -k * 1.9;
        } else armR.rotation.x = 0.15;
        armL.rotation.x = Math.sin(t * 1.7) * 0.08;
      }
    };
  }

  // Morela — chapéu de cogumelo com véu de lamelas e pés de filamento
  function buildMorel() {
    var P = RACE_PAL.sporeborn;
    var g = grp();
    var capM = mat(P.a, { rough: 0.85 });
    var bodyM = mat(P.b, { rough: 0.95 });
    var gillM = mat(mix(P.c, P.b, 0.15), { emissive: P.c, ei: 0.75 });
    var body = grp(); g.add(body);
    // filamentos pálidos no lugar dos pés
    var filM = mat('#cfd8c8', { rough: 1 });
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * Math.PI * 2;
      var f = cyl(0.015, 0.03, 0.26, 4, filM, Math.cos(a) * 0.1, 0.13, Math.sin(a) * 0.1);
      f.rotation.x = (Math.sin(a)) * 0.35; f.rotation.z = -Math.cos(a) * 0.35;
      body.add(f);
    }
    // corpo esguio
    var trunk = lathe([[0.001, 0], [0.13, 0.02], [0.11, 0.4], [0.14, 0.8], [0.1, 1.05], [0.001, 1.1]], 9, bodyM, 0, 0.2, 0);
    body.add(trunk);
    // véu de lamelas cobrindo o rosto (cone aberto com nervuras emissivas)
    var veil = grp(0, 1.32, 0);
    var vcone = cone(0.42, 0.5, 12, bodyM, 0, -0.25, 0);
    vcone.material = mat(shade(P.b, 1.25), { rough: 0.95 });
    veil.add(vcone);
    for (var l = 0; l < 8; l++) {
      var la = (l / 8) * Math.PI * 2;
      var lam = box(0.03, 0.42, 0.012, gillM, Math.cos(la) * 0.3, -0.28, Math.sin(la) * 0.3);
      lam.rotation.y = -la;
      lam.rotation.x = 0.32;
      lam.castShadow = false;
      veil.add(lam);
    }
    body.add(veil);
    // CHAPÉU carnudo GIGANTE (guarda-chuva de desenho animado, +32%)
    var cap = grp(0, 1.36, 0);
    cap.scale.setScalar(1.32);
    var dome = lathe([[0.001, 0], [0.55, 0.02], [0.5, 0.16], [0.3, 0.32], [0.001, 0.4]], 14, capM, 0, 0, 0);
    cap.add(dome);
    // pintas do chapéu
    var dotM = mat(shade(P.a, 1.7), { rough: 0.9 });
    cap.add(sph(0.07, dotM, 0.24, 0.2, 0.2, 7, 5));
    cap.add(sph(0.05, dotM, -0.28, 0.16, 0.1, 7, 5));
    cap.add(sph(0.045, dotM, 0.05, 0.28, -0.26, 7, 5));
    body.add(cap);
    return {
      group: g,
      animate: function (st, t) {
        body.rotation.z = 0;
        // desliza: flutua suave em vez de passos
        body.position.y = Math.sin(t * 1.7) * 0.07 + (st.moving ? 0.07 : 0);
        body.rotation.z = Math.sin(t * 1.1) * 0.04;
        // chapéu PULSA como cogumelo respirando (assinatura)
        var capPulse = 1.32 + Math.sin(t * 1.9) * 0.055;
        cap.scale.set(capPulse, 1.32 - Math.sin(t * 1.9) * 0.04, capPulse);
        cap.rotation.z = Math.sin(t * 1.35) * 0.1;
        cap.rotation.x = Math.cos(t * 1.05) * 0.08;
        if (st.castK > 0) {
          var k = Math.sin(st.castK * Math.PI);
          cap.rotation.x = -k * 0.65;              // ergue o chapéu — véu brilha
          veil.scale.set(1 + k * 0.3, 1 + k * 0.12, 1 + k * 0.3);
        } else veil.scale.set(1, 1, 1);
      }
    };
  }

  // Rosácea — painéis de vitral com núcleo emissivo no peito
  function buildRose() {
    var P = RACE_PAL.glassborn;
    var g = grp();
    var leadM = mat(mix(P.b, '#000000', 0.1), { metal: 0.4, rough: 0.5 });
    // vitral COM luz própria: o vidro reluz por dentro (senão vira silhueta preta)
    var glassA = mat(P.a, { rough: 0.25, alpha: 0.9, emissive: P.a, ei: 0.34 });
    var glassB = mat('#9a6fd3', { rough: 0.25, alpha: 0.9, emissive: '#9a6fd3', ei: 0.34 });
    var glassC = mat('#5fb0c8', { rough: 0.25, alpha: 0.9, emissive: '#5fb0c8', ei: 0.34 });
    var goldM = mat(P.c, { metal: 0.6, rough: 0.35, emissive: P.c, ei: 0.25 });
    var coreM = mat(P.c, { emissive: P.c, ei: 2.6 });
    var body = grp(); g.add(body);
    // esqueleto de chumbo dourado
    body.add(cyl(0.035, 0.035, 1.15, 6, leadM, 0, 0.65, 0));
    body.add(cyl(0.03, 0.03, 0.62, 5, leadM, -0.16, 0.28, 0)).children;
    var legR = cyl(0.03, 0.03, 0.62, 5, leadM, 0.16, 0.28, 0);
    body.add(legR);
    // painéis de vitral (nenhuma curva orgânica)
    var panels = grp(0, 0, 0);
    function panel(m2, w, h2, x, y, z, ry, rz) {
      var p = box(w, h2, 0.035, m2, x, y, z);
      p.rotation.y = ry || 0; p.rotation.z = rz || 0;
      p.castShadow = true;
      panels.add(p);
      return p;
    }
    panel(glassA, 0.34, 0.5, 0, 1.0, 0.1, 0, 0);
    panel(glassB, 0.26, 0.42, -0.24, 0.92, -0.04, 0.5, 0.12);
    panel(glassC, 0.26, 0.42, 0.24, 0.92, -0.04, -0.5, -0.12);
    panel(glassB, 0.2, 0.34, -0.14, 0.5, 0.06, 0.2, 0.3);
    panel(glassC, 0.2, 0.34, 0.14, 0.5, 0.06, -0.2, -0.3);
    // ombreiras/braços = lâminas de vidro
    panel(glassA, 0.14, 0.5, -0.4, 0.88, 0, 0.2, 0.5);
    panel(glassA, 0.14, 0.5, 0.4, 0.88, 0, -0.2, -0.5);
    body.add(panels);
    // NÚCLEO de luz pulsando no peito, visível através das placas
    var core = sph(0.09, coreM, 0, 1.0, 0.05, 8, 6);
    core.castShadow = false;
    body.add(core);
    var clight = new THREE.PointLight(0xffd166, 0.7, 5, 2);
    clight.position.set(0, 1.0, 0.15);
    body.add(clight);
    // cabeça-ROSÁCEA GRANDE (+45%): anel de pétalas de vidro + aro dourado
    var head = grp(0, 1.56, 0);
    head.scale.setScalar(1.45);
    var hoop = tor(0.2, 0.028, goldM, 0, 0, 0); head.add(hoop);
    for (var i = 0; i < 8; i++) {
      var a = (i / 8) * Math.PI * 2;
      var pet = cone(0.07, 0.18, 4, i % 2 ? glassB : glassC, Math.cos(a) * 0.2, 0, Math.sin(a) * 0.02);
      pet.position.y = Math.sin(a) * 0.2;
      pet.rotation.z = -a - Math.PI / 2;
      pet.castShadow = false;
      head.add(pet);
    }
    head.add(sph(0.06, coreM, 0, 0, 0.01, 8, 6));
    body.add(head);
    return {
      group: g,
      animate: function (st, t) {
        body.rotation.z = 0; body.position.y = 0;
        walkRock(body, t, st.moving);
        if (!st.moving) body.position.y = Math.sin(t * 1.5) * 0.035;
        // núcleo pulsa FORTE; placas cintilam girando (vitral vivo)
        var pulse = 1.2 + Math.sin(t * 2.3) * 0.26;
        core.scale.setScalar(pulse);
        clight.intensity = 0.55 + Math.sin(t * 2.3) * 0.3;
        panels.rotation.y = Math.sin(t * 0.9) * 0.1;
        head.rotation.y = Math.sin(t * 0.7) * 0.45;               // rosácea GIRA
        if (st.castK > 0) {
          var k = Math.sin(st.castK * Math.PI);
          core.scale.setScalar(pulse + k * 1.1);
          clight.intensity = 0.7 + k * 2.2;
          panels.scale.setScalar(1 + k * 0.06);
          head.rotation.y += k * 2.2;
        } else panels.scale.setScalar(1);
      }
    };
  }

  // Sibilo — torso-fole sanfonado que respira, braços-tubo, boca-válvula
  function buildWhistle() {
    var P = RACE_PAL.bellowsborn;
    var g = grp();
    var leather = mat(P.a, { rough: 0.85 });
    var wood = mat(mix(P.b, '#8a7a5a', 0.4), { rough: 0.9 });
    var brassM = mat('#c8a04a', { metal: 0.6, rough: 0.4 });
    var body = grp(); g.add(body);
    // perninhas leves
    body.add(cyl(0.05, 0.07, 0.3, 5, wood, -0.14, 0.15, 0));
    body.add(cyl(0.05, 0.07, 0.3, 5, wood, 0.14, 0.15, 0));
    // TORSO-FOLE: pregas alternadas (anima inflando/desinflando)
    var bellows = grp(0, 0.32, 0);
    var pleats = [];
    for (var i = 0; i < 6; i++) {
      var r = (i % 2 === 0) ? 0.35 : 0.26;               // fole mais GORDO
      var p = cyl(r, r, 0.12, 9, i % 2 ? leather : mat(shade(P.a, 0.8), { rough: 0.9 }), 0, i * 0.13 + 0.06, 0);
      pleats.push(p);
      bellows.add(p);
    }
    var topCap = cyl(0.3, 0.35, 0.1, 9, wood, 0, 6 * 0.13 + 0.1, 0);
    bellows.add(topCap);
    body.add(bellows);
    // braços = tubos flexíveis com registros de latão
    var armL = grp(-0.3, 1.05, 0), armR = grp(0.3, 1.05, 0);
    function tubeArm(arm, sgn) {
      for (var s = 0; s < 4; s++) {
        arm.add(cyl(0.05, 0.05, 0.13, 7, s % 2 ? leather : brassM, sgn * s * 0.05, -s * 0.13 - 0.06, Math.sin(s) * 0.02));
      }
      arm.add(sph(0.07, brassM, sgn * 0.16, -0.56, 0.02, 7, 5));
    }
    tubeArm(armL, -0.5); tubeArm(armR, 0.5);
    body.add(armL); body.add(armR);
    // cabeça GRANDE com BOCA-VÁLVULA circular (assinatura: assobia ao falar)
    var head = grp(0, 1.45, 0);
    head.scale.setScalar(1.34);
    head.add(cyl(0.05, 0.06, 0.14, 6, brassM, 0, -0.14, 0));      // pescoço
    head.add(sph(0.18, leather, 0, 0.05, 0, 9, 7));
    var valve = tor(0.1, 0.035, brassM, 0, 0.04, 0.16);
    head.add(valve);
    var valveIn = cyl(0.075, 0.075, 0.06, 10, mat('#141e26', { rough: 1 }), 0, 0.04, 0.16);
    valveIn.rotation.x = Math.PI / 2;
    head.add(valveIn);
    body.add(head);
    return {
      group: g,
      animate: function (st, t) {
        body.rotation.z = 0; body.position.y = 0;
        walkRock(body, t, st.moving);
        // a respiração JÁ é o idle: fole BOMBEIA exagerado
        var br = Math.sin(t * 2.2);
        bellows.scale.y = 1 + br * 0.17;
        bellows.scale.x = bellows.scale.z = 1 - br * 0.09;
        head.position.y = 1.45 + br * 0.13;
        armL.rotation.z = 0.15 + br * 0.11;
        armR.rotation.z = -0.15 - br * 0.11;
        if (st.castK > 0) {
          // dois tempos: INSPIRA fundo, depois EXPIRA de golpe
          var k = st.castK;
          var inh = k < 0.55 ? (k / 0.55) : 1 - (k - 0.55) / 0.45 * 1.6;
          bellows.scale.y = 1 + inh * 0.42;
          bellows.scale.x = bellows.scale.z = 1 - inh * 0.18;
          head.position.y = 1.45 + inh * 0.3;
        }
      }
    };
  }

  // -------------------------------------------------------- ESTUFA (flora)

  // Vergasta — chicote vegetal enraizado num vaso rachado (torreta)
  function buildThornLasher() {
    var P = RACE_PAL.flora;
    var g = grp();
    var potM = mat('#9a6a48', { rough: 0.95 });
    var stalkM = mat(P.a, { rough: 0.95 });
    var thornM = mat(shade(P.a, 1.6), { rough: 0.9 });
    var body = grp(); g.add(body);
    var pot = lathe([[0.2, 0], [0.34, 0.05], [0.3, 0.35], [0.36, 0.44]], 9, potM, 0, 0, 0);
    body.add(pot);
    // rachadura
    var crack = box(0.02, 0.3, 0.02, mat('#3a2418', { rough: 1 }), 0.28, 0.2, 0.16);
    crack.rotation.z = 0.3; body.add(crack);
    // caule-chicote curvado com farpas
    var whip = grp(0, 0.4, 0);
    var segs = [];
    var seg = whip;
    for (var i = 0; i < 5; i++) {
      var s = grp(0, i === 0 ? 0.05 : 0.3, 0);
      s.add(cyl(0.07 - i * 0.011, 0.09 - i * 0.011, 0.34, 6, stalkM, 0, 0.15, 0));
      var th = cone(0.025, 0.12, 4, thornM, 0.07 - i * 0.01, 0.15, 0);
      th.rotation.z = -Math.PI / 2;
      s.add(th);
      seg.add(s); segs.push(s);
      seg = s;
    }
    // flor morta na ponta (maior — a "cara" da torreta)
    var flower = grp(0, 0.32, 0);
    flower.scale.setScalar(1.35);
    for (var f = 0; f < 5; f++) {
      var fa = (f / 5) * Math.PI * 2;
      var pet = box(0.1, 0.02, 0.05, mat('#6a5a3e', { rough: 1 }), Math.cos(fa) * 0.08, 0, Math.sin(fa) * 0.08);
      pet.rotation.y = -fa;
      flower.add(pet);
    }
    flower.add(sph(0.05, mat(P.c, { emissive: P.c, ei: 0.5 }), 0, 0, 0, 7, 5));
    seg.add(flower);
    body.add(whip);
    return {
      group: g,
      animate: function (st, t) {
        // enraizada: nada de walk — o chicote ondula
        for (var i = 0; i < segs.length; i++) {
          segs[i].rotation.z = Math.sin(t * 1.7 + i * 0.9) * 0.16;
          segs[i].rotation.x = Math.cos(t * 1.3 + i * 0.7) * 0.1;
        }
        if (st.castK > 0) {
          var k = Math.sin(st.castK * Math.PI);
          for (var j = 0; j < segs.length; j++) {
            segs[j].rotation.x = -k * 0.5 + Math.cos(t * 12 + j) * 0.1 * k;
          }
        }
      }
    };
  }

  // Bufo-de-Pólen — bola de pólen com perninhas e sorriso costurado
  function buildPollenPuff() {
    var g = grp();
    var puffM = mat('#e0c052', { rough: 1 });
    var body = grp(0, 0.42, 0); g.add(body);
    var ball = ico(0.38, 1, puffM, 0, 0, 0);
    body.add(ball);
    // tufos
    for (var i = 0; i < 5; i++) {
      var a = i * 2.4;
      body.add(cone(0.05, 0.16, 4, puffM, Math.cos(a) * 0.34, Math.sin(a * 1.7) * 0.3, Math.sin(a) * 0.34));
    }
    // sorriso costurado (fio escuro)
    var smileM = mat('#4a3a20', { rough: 1 });
    var smile = tor(0.13, 0.018, smileM, 0, -0.08, 0.35, Math.PI * 0.8);
    smile.rotation.z = Math.PI + Math.PI * 0.1;
    body.add(smile);
    for (var s2 = 0; s2 < 3; s2++) {
      body.add(box(0.015, 0.06, 0.015, smileM, -0.09 + s2 * 0.09, -0.08 + (s2 === 1 ? -0.05 : -0.02), 0.36));
    }
    body.add(sph(0.055, smileM, -0.12, 0.13, 0.33, 6, 5));
    body.add(sph(0.055, smileM, 0.12, 0.13, 0.33, 6, 5));
    // perninhas de graveto
    var legM = mat('#5a4428', { rough: 1 });
    var legL = cyl(0.02, 0.025, 0.34, 4, legM, -0.13, -0.28, 0);
    var legR = cyl(0.02, 0.025, 0.34, 4, legM, 0.13, -0.28, 0);
    body.add(legL); body.add(legR);
    return {
      group: g,
      animate: function (st, t) {
        // anda balançando (isso deveria ser um aviso)
        var wob = st.moving ? Math.sin(t * 12) : Math.sin(t * 2.6) * 0.4;
        body.rotation.z = wob * 0.14;
        body.position.y = 0.42 + Math.abs(wob) * 0.06;
        legL.rotation.x = st.moving ? Math.sin(t * 12) * 0.7 : 0;
        legR.rotation.x = st.moving ? -Math.sin(t * 12) * 0.7 : 0;
        if (st.castK > 0) {
          var k = Math.sin(st.castK * Math.PI);
          body.scale.setScalar(1 + k * 0.25);
        } else body.scale.setScalar(1);
      }
    };
  }

  // Carrapicho-Mãe / Carrapichinho — novelo de farpas com olhinhos
  function buildBurr(small) {
    var P = RACE_PAL.flora;
    var g = grp();
    var burM = mat(mix(P.b, '#4a3a22', 0.5), { rough: 1 });
    var spikeM = mat(shade(P.b, 1.3), { rough: 0.95 });
    var eyeM = mat('#101010', { rough: 0.4 });
    var R = small ? 0.24 : 0.42;
    var body = grp(0, R + 0.06, 0); g.add(body);
    body.add(ico(R, 1, burM, 0, 0, 0));
    var rnd = srand(small ? 5 : 9);
    for (var i = 0; i < (small ? 10 : 18); i++) {
      var th = rnd() * Math.PI * 2, ph = Math.acos(rnd() * 2 - 1);
      var sx = Math.sin(ph) * Math.cos(th), sy = Math.cos(ph), sz = Math.sin(ph) * Math.sin(th);
      var sp = cone(R * 0.14, R * 0.55, 4, spikeM, sx * R, sy * R, sz * R);
      sp.lookAt(sx * 3, R + 0.06 + sy * 3, sz * 3);
      sp.rotateX(Math.PI / 2);
      body.add(sp);
    }
    // olhões pretos entre os espinhos (voltados p/ frente)
    for (var e = 0; e < (small ? 3 : 6); e++) {
      var ex = (rnd() - 0.5) * R * 1.4, ey = (rnd() - 0.3) * R * 1.1;
      var ez = Math.sqrt(Math.max(R * R - ex * ex - ey * ey, 0.001));
      body.add(sph(R * 0.15, eyeM, ex, ey, ez, 6, 5));
    }
    return {
      group: g,
      animate: function (st, t) {
        var roll = st.moving ? t * 9 : Math.sin(t * 1.4) * 0.12;
        body.rotation.x = st.moving ? roll : Math.sin(t * 1.4) * 0.1;
        body.rotation.z = Math.cos(t * 1.1) * 0.08;
        if (st.castK > 0) body.scale.setScalar(1 + Math.sin(st.castK * Math.PI) * 0.2);
        else body.scale.setScalar(1);
      }
    };
  }

  // Vespa-Lustre — vespa com abdômen-lanterna de vidro
  function buildLanternWasp() {
    var g = grp();
    var chitM = mat('#6a5a2e', { rough: 0.7 });
    var glassM = mat('#ffe9b0', { rough: 0.3, alpha: 0.55 });
    var glowM = mat('#ffd76b', { emissive: '#ffd76b', ei: 2.4 });
    var wingM = mat('#dfeaf0', { rough: 0.3, alpha: 0.4, flat: false });
    var body = grp(0, 0.85, 0); g.add(body);      // voa
    body.add(sph(0.16, chitM, 0, 0, 0.12, 8, 6)); // tórax
    var head = sph(0.14, chitM, 0, 0.03, 0.33, 8, 6);
    body.add(head);
    body.add(sph(0.052, mat('#181008', { rough: 0.3 }), -0.06, 0.08, 0.43, 6, 5));
    body.add(sph(0.052, mat('#181008', { rough: 0.3 }), 0.06, 0.08, 0.43, 6, 5));
    // abdômen = LANTERNA de vidro GRANDE com luz presa dentro
    var lantern = grp(0, -0.04, -0.2);
    lantern.scale.setScalar(1.28);
    var glass = lathe([[0.001, -0.2], [0.14, -0.14], [0.17, 0.02], [0.12, 0.14], [0.001, 0.18]], 9, glassM, 0, 0, 0);
    lantern.add(glass);
    var bulb = sph(0.1, glowM, 0, -0.02, 0, 7, 5);
    bulb.castShadow = false;
    lantern.add(bulb);
    lantern.rotation.x = 0.5;
    body.add(lantern);
    // ferrão
    var sting = cone(0.03, 0.14, 5, chitM, 0, -0.16, -0.34);
    sting.rotation.x = Math.PI * 0.72;
    body.add(sting);
    // asas (2 pares)
    var wingL = grp(-0.08, 0.12, 0.05), wingR = grp(0.08, 0.12, 0.05);
    var wl = box(0.34, 0.01, 0.12, wingM, -0.19, 0, 0); wingL.add(wl);
    var wl2 = box(0.26, 0.01, 0.1, wingM, -0.15, -0.02, -0.1); wingL.add(wl2);
    var wr = box(0.34, 0.01, 0.12, wingM, 0.19, 0, 0); wingR.add(wr);
    var wr2 = box(0.26, 0.01, 0.1, wingM, 0.15, -0.02, -0.1); wingR.add(wr2);
    body.add(wingL); body.add(wingR);
    return {
      group: g,
      animate: function (st, t) {
        body.position.y = 0.85 + Math.sin(t * 3.1) * 0.07;
        body.rotation.z = Math.sin(t * 2.2) * 0.06;
        wingL.rotation.z = Math.sin(t * 40) * 0.5 + 0.15;
        wingR.rotation.z = -Math.sin(t * 40) * 0.5 - 0.15;
        var bp = 1 + Math.sin(t * 5.3) * 0.2;
        bulb.scale.setScalar(bp);
        if (st.castK > 0) {
          var k = Math.sin(st.castK * Math.PI);
          body.rotation.x = k * 0.5;                 // mergulho do ferrão
        } else body.rotation.x = 0;
      }
    };
  }

  // Seiveiro — toco corcunda com rosto entalhado e caldeirão de seiva
  function buildSapShaman() {
    var P = RACE_PAL.flora;
    var g = grp();
    var barkM = mat('#6a4e30', { rough: 1 });
    var bark2M = mat('#57452f', { rough: 1 });
    var sapM = mat('#ffb347', { emissive: '#ff9a2e', ei: 1.1 });
    var body = grp(); g.add(body);
    // toco corcunda
    var trunkGeo = jitterGeo(new THREE.CylinderGeometry(0.3, 0.42, 0.95, 9), 0.05, true);
    var trunk = mesh(trunkGeo, barkM);
    trunk.position.y = 0.48;
    trunk.rotation.z = 0.16;                        // corcunda
    body.add(trunk);
    // gomos de casca
    body.add(cyl(0.1, 0.14, 0.5, 5, bark2M, -0.3, 0.25, 0.1));
    body.add(cyl(0.08, 0.12, 0.4, 5, bark2M, 0.28, 0.2, -0.12));
    // rosto entalhado a canivete (olhos e boca escavados, brilho de seiva)
    var eyeM = mat('#2a1a0c', { emissive: '#ffb347', ei: 0.7 });
    body.add(box(0.1, 0.14, 0.03, eyeM, -0.12, 0.85, 0.31));
    body.add(box(0.1, 0.11, 0.03, eyeM, 0.11, 0.87, 0.31));
    body.add(box(0.2, 0.055, 0.03, eyeM, 0, 0.66, 0.35));
    // galhinhos no topo
    var twig = cyl(0.02, 0.03, 0.4, 4, bark2M, -0.08, 1.15, -0.05);
    twig.rotation.z = 0.5;
    body.add(twig);
    // caldeirão de seiva no colo
    var pot = grp(0, 0.42, 0.4);
    pot.add(lathe([[0.12, 0], [0.2, 0.04], [0.22, 0.16], [0.18, 0.22]], 9, mat('#3a3026', { metal: 0.3, rough: 0.7 }), 0, 0, 0));
    var sap = cyl(0.17, 0.17, 0.03, 9, sapM, 0, 0.2, 0);
    sap.castShadow = false;
    pot.add(sap);
    // bolha
    var bub = sph(0.03, sapM, 0.06, 0.24, 0.02, 6, 5);
    bub.castShadow = false;
    pot.add(bub);
    body.add(pot);
    return {
      group: g,
      animate: function (st, t) {
        body.rotation.z = 0; body.position.y = 0;
        walkRock(body, t, st.moving);
        if (!st.moving) body.rotation.z = Math.sin(t * 0.9) * 0.02;
        bub.position.y = 0.22 + ((t * 0.35) % 0.3);
        bub.scale.setScalar(1 - ((t * 0.35) % 0.3) * 2.2);
        sap.scale.setScalar(1 + Math.sin(t * 3.1) * 0.05);
        if (st.castK > 0) {
          var k = Math.sin(st.castK * Math.PI);
          pot.rotation.x = -k * 0.7;                 // verte a seiva
          sap.material.emissiveIntensity = 1.1 + k * 1.5;
        } else pot.rotation.x = 0;
      }
    };
  }

  // A Jardineira-Viúva — vulto de treliça com véu e TESOURÃO (chefe ~2×)
  function buildBossGardener() {
    var P = RACE_PAL.flora;
    var g = grp();
    var latM = mat('#57452f', { rough: 1 });
    var veilM = mat('#241f28', { rough: 1, alpha: 0.94 });
    var gloveM = mat('#7a5a3a', { rough: 0.95 });
    var shearM = mat('#8a8a82', { metal: 0.7, rough: 0.4 });
    var rustM = mat('#7a4a2e', { metal: 0.3, rough: 0.8 });
    var body = grp(); g.add(body);
    // saia/corpo de treliça (grade de ripas em A)
    var skirt = grp(0, 0, 0);
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * Math.PI * 2;
      var rib = box(0.09, 1.7, 0.06, latM, Math.cos(a) * 0.55, 0.85, Math.sin(a) * 0.55);
      rib.rotation.y = -a;
      rib.rotation.x = 0.16 * Math.cos(a * 0); // leve A
      skirt.add(rib);
    }
    for (var h2 = 0; h2 < 3; h2++) {
      var hoopR = 0.62 - h2 * 0.13;
      var hp = tor(hoopR, 0.035, latM, 0, 0.3 + h2 * 0.55, 0);
      hp.rotation.x = Math.PI / 2;
      skirt.add(hp);
    }
    body.add(skirt);
    // heras na treliça
    var vineM = mat('#4f7a38', { rough: 1 });
    skirt.add(box(0.07, 1.3, 0.05, vineM, 0.48, 0.7, 0.32));
    skirt.add(box(0.07, 1.0, 0.05, vineM, -0.42, 0.6, -0.4));
    // torso estreito + VÉU de viúva caindo da cabeça
    body.add(cyl(0.24, 0.36, 0.8, 8, latM, 0, 2.1, 0));
    var head = grp(0, 2.85, 0);
    head.scale.setScalar(1.28);                       // véu maior — vilã de desenho
    var veil = lathe([[0.001, 0.45], [0.24, 0.36], [0.3, 0.1], [0.42, -0.5], [0.5, -1.05]], 10, veilM, 0, 0, 0);
    veil.castShadow = true;
    head.add(veil);
    // por baixo do véu, dois pontos de brilho GRANDES
    head.add(sph(0.055, mat(P.c, { emissive: P.c, ei: 2 }), -0.1, 0.05, 0.22, 6, 5));
    head.add(sph(0.055, mat(P.c, { emissive: P.c, ei: 2 }), 0.1, 0.05, 0.22, 6, 5));
    body.add(head);
    // braços com luvas de couro e TESOURA DE PODA no lugar das mãos
    var armL = grp(-0.5, 2.35, 0.1), armR = grp(0.5, 2.35, 0.1);
    armL.add(cyl(0.07, 0.09, 0.7, 6, latM, 0, -0.35, 0));
    armR.add(cyl(0.07, 0.09, 0.7, 6, latM, 0, -0.35, 0));
    armL.add(sph(0.13, gloveM, 0, -0.75, 0.05, 7, 6));
    armR.add(sph(0.13, gloveM, 0, -0.75, 0.05, 7, 6));
    // TESOURÃO enorme: o adereço-assinatura dela (2x cartoon)
    var shears = grp(0, 1.45, 0.75);
    shears.scale.setScalar(1.9);
    var blA = grp(-0.1, 0, 0), blB = grp(0.1, 0, 0);
    var b1 = box(0.09, 0.05, 1.15, shearM, -0.06, 0, 0.55); b1.rotation.y = 0.12; blA.add(b1);
    var b2 = box(0.09, 0.05, 1.15, shearM, 0.06, 0, 0.55); b2.rotation.y = -0.12; blB.add(b2);
    blA.add(box(0.06, 0.08, 0.4, rustM, -0.12, 0, -0.25));
    blB.add(box(0.06, 0.08, 0.4, rustM, 0.12, 0, -0.25));
    shears.add(blA); shears.add(blB);
    shears.add(sph(0.07, rustM, 0, 0, 0, 7, 5));
    body.add(shears);
    return {
      group: g,
      boss: true,
      animate: function (st, t) {
        body.rotation.z = 0; body.position.y = 0;
        walkRock(body, t, st.moving);
        if (!st.moving) body.position.y = Math.sin(t * 1.1) * 0.03;
        head.rotation.y = Math.sin(t * 0.6) * 0.22;
        veil.rotation.y = Math.sin(t * 0.8) * 0.1;
        // o tesourão abre e fecha devagar — sempre
        var open = 0.1 + Math.abs(Math.sin(t * 0.9)) * 0.12;
        blA.rotation.y = open; blB.rotation.y = -open;
        if (st.castK > 0) {
          var k = st.castK;
          var snip = k < 0.5 ? k * 2 : 1 - (k - 0.5) * 2;
          blA.rotation.y = 0.45 * snip + 0.02;
          blB.rotation.y = -0.45 * snip - 0.02;
          shears.position.z = 0.55 + Math.sin(k * Math.PI) * 0.45;
        } else shears.position.z = 0.55;
      }
    };
  }

  // Brotinho-Voraz — muda com folhas e dentes
  function buildSproutFeral() {
    var P = RACE_PAL.flora;
    var g = grp();
    var leafM = mat(P.a, { rough: 0.95 });
    var mouthM = mat('#2a1a12', { rough: 1 });
    var toothM = mat('#e8e0d0', { rough: 0.6 });
    var body = grp(0, 0.26, 0); g.add(body);
    var head = sph(0.22, mouthM, 0, 0.05, 0, 9, 7);
    head.scale.z = 1.15;
    body.add(head);
    for (var i = 0; i < 5; i++) {
      body.add(cone(0.03, 0.09, 4, toothM, -0.12 + i * 0.06, -0.04, 0.2));
    }
    // folhas
    var leafL = grp(-0.12, 0.2, -0.05), leafR = grp(0.12, 0.2, -0.05);
    var l1 = sph(0.16, leafM, -0.1, 0.08, 0, 7, 5); l1.scale.set(1.4, 0.3, 0.8); leafL.add(l1);
    var l2 = sph(0.16, leafM, 0.1, 0.08, 0, 7, 5); l2.scale.set(1.4, 0.3, 0.8); leafR.add(l2);
    body.add(leafL); body.add(leafR);
    body.add(cyl(0.03, 0.05, 0.2, 5, mat('#5a7a3a', { rough: 1 }), 0, -0.2, 0));
    return {
      group: g,
      animate: function (st, t) {
        var hop = st.moving ? Math.abs(Math.sin(t * 14)) * 0.16 : Math.abs(Math.sin(t * 3.2)) * 0.05;
        body.position.y = 0.26 + hop;
        leafL.rotation.z = 0.3 + Math.sin(t * 6) * 0.25;
        leafR.rotation.z = -0.3 - Math.sin(t * 6) * 0.25;
        head.scale.y = 1 + Math.sin(t * 5.1) * 0.12;      // mastiga o ar
        if (st.castK > 0) head.scale.y = 1 + Math.sin(st.castK * Math.PI) * 0.5;
      }
    };
  }

  // Esporinho — cogumelo-bebê de olhos grandes (invocação de Morela)
  function buildSporeling() {
    var P = RACE_PAL.sporeborn;
    var g = grp();
    var capM = mat(P.a, { rough: 0.85 });
    var skinM = mat('#d8d0c0', { rough: 0.95 });
    var body = grp(); g.add(body);
    body.add(cyl(0.1, 0.13, 0.3, 7, skinM, 0, 0.2, 0));
    var cap = lathe([[0.001, 0], [0.3, 0.01], [0.26, 0.12], [0.14, 0.22], [0.001, 0.26]], 11, capM, 0, 0.34, 0);
    body.add(cap);
    var dotM = mat(mix(P.c, P.a, 0.3), { emissive: P.c, ei: 0.5 });
    body.add(sph(0.04, dotM, 0.12, 0.48, 0.1, 6, 5));
    body.add(sph(0.03, dotM, -0.12, 0.44, -0.08, 6, 5));
    // olhos GRANDES demais
    var eyeW = mat('#f4f0e4', { rough: 0.3 });
    var pupM = mat('#241a30', { rough: 0.3 });
    var eyeL = sph(0.07, eyeW, -0.08, 0.26, 0.1, 8, 6);
    var eyeR = sph(0.07, eyeW, 0.08, 0.26, 0.1, 8, 6);
    body.add(eyeL); body.add(eyeR);
    body.add(sph(0.032, pupM, -0.08, 0.26, 0.16, 6, 5));
    body.add(sph(0.032, pupM, 0.08, 0.26, 0.16, 6, 5));
    // pezinhos
    body.add(sph(0.05, skinM, -0.07, 0.04, 0.02, 6, 5));
    body.add(sph(0.05, skinM, 0.07, 0.04, 0.02, 6, 5));
    return {
      group: g,
      animate: function (st, t) {
        var hop = st.moving ? Math.abs(Math.sin(t * 13)) * 0.14 : 0;
        body.position.y = hop + (st.moving ? 0 : Math.sin(t * 2.4) * 0.02);
        cap.rotation.z = Math.sin(t * 2.1) * 0.08;
        body.rotation.z = st.moving ? Math.sin(t * 13) * 0.1 : 0;
        if (st.castK > 0) body.scale.setScalar(1 + Math.sin(st.castK * Math.PI) * 0.25);
        else body.scale.setScalar(1);
      }
    };
  }

  // ------------------------------------------------------ CISTERNA (corte)

  // Afogadiço — carregador inchado com lampião
  function buildDrownedPorter() {
    var P = RACE_PAL.court;
    var g = grp();
    var skinM = mat('#5a7a6a', { rough: 0.95 });
    var coatM = mat(shade(P.b, 1.5), { rough: 0.95 });
    var algM = mat('#3c5c46', { rough: 1 });
    var body = grp(); g.add(body);
    body.add(cyl(0.12, 0.16, 0.45, 6, coatM, -0.16, 0.22, 0));
    body.add(cyl(0.12, 0.16, 0.45, 6, coatM, 0.16, 0.22, 0));
    // torso inchado de água
    var torso = sph(0.42, coatM, 0, 0.75, 0, 10, 8);
    torso.scale.y = 1.15;
    body.add(torso);
    body.add(sph(0.44, skinM, 0, 0.72, 0.06, 10, 8)).children;
    var belly = body.children[body.children.length - 1];
    belly.scale.set(0.85, 0.95, 0.85);
    // cabeça caída (grande, cartoon)
    var head = grp(0.05, 1.32, 0.12);
    head.scale.setScalar(1.28);
    head.add(sph(0.2, skinM, 0, 0, 0, 9, 7));
    head.rotation.x = 0.35;
    // algas no lugar do cabelo
    for (var i = 0; i < 4; i++) {
      var al = cyl(0.02, 0.035, 0.3, 4, algM, -0.1 + i * 0.07, 0.05, -0.1);
      al.rotation.x = -0.6 - i * 0.15;
      head.add(al);
    }
    // olhos apagados
    head.add(sph(0.05, mat('#c8d8c8', { emissive: '#9ab8a8', ei: 0.5 }), -0.075, 0.03, 0.18, 6, 5));
    head.add(sph(0.05, mat('#c8d8c8', { emissive: '#9ab8a8', ei: 0.5 }), 0.075, 0.03, 0.18, 6, 5));
    body.add(head);
    // braços; um segura o LAMPIÃO que nunca soltou
    var armL = grp(-0.44, 1.0, 0), armR = grp(0.44, 1.0, 0);
    armL.add(cyl(0.07, 0.09, 0.55, 6, skinM, 0, -0.27, 0));
    armR.add(cyl(0.07, 0.09, 0.55, 6, skinM, 0, -0.27, 0));
    body.add(armL); body.add(armR);
    var lamp = grp(0, -0.62, 0.05);
    lamp.add(box(0.12, 0.16, 0.12, mat('#2a3438', { metal: 0.5, rough: 0.6 }), 0, 0, 0));
    var lampGlow = box(0.07, 0.09, 0.07, mat(P.c, { emissive: P.c, ei: 2.2 }), 0, 0, 0);
    lampGlow.castShadow = false;
    lamp.add(lampGlow);
    armR.add(lamp);
    return {
      group: g,
      animate: function (st, t) {
        body.rotation.z = 0; body.position.y = 0;
        walkRock(body, t, st.moving);
        if (!st.moving) body.rotation.z = Math.sin(t * 0.8) * 0.025;
        lamp.rotation.z = Math.sin(t * 1.7) * 0.2;         // lampião balança
        lampGlow.scale.setScalar(1 + Math.sin(t * 4.2) * 0.15);
        head.rotation.z = Math.sin(t * 0.5) * 0.1;
        if (st.castK > 0) {
          var k = Math.sin(st.castK * Math.PI);
          head.rotation.x = 0.35 - k * 0.9;                // bocanhada
          torso.scale.y = 1.15 + k * 0.1;
        } else head.rotation.x = 0.35;
      }
    };
  }

  // Moreia-Flauta — enguia em ponto de interrogação com crânio perfurado
  function buildMorayPiper() {
    var P = RACE_PAL.court;
    var g = grp();
    var eelM = mat(shade(P.a, 1.15), { rough: 0.7 });
    var belM = mat(shade(P.a, 1.8), { rough: 0.7 });
    var boneM = mat('#d8d4c4', { rough: 0.85 });
    var body = grp(); g.add(body);
    // corpo em S erguido (segmentos encadeados)
    var segs = [];
    var parent = body;
    var curls = [0.5, 0.35, 0.1, -0.25, -0.5, -0.55];
    for (var i = 0; i < 6; i++) {
      var s = grp(0, i === 0 ? 0.12 : 0.3, 0);
      var r1 = 0.19 - i * 0.02;
      var segMesh = cyl(r1 - 0.02, r1, 0.34, 8, i % 2 ? eelM : belM, 0, 0.15, 0);
      s.add(segMesh);
      s.rotation.x = curls[i] * 0.55;
      parent.add(s); segs.push(s);
      parent = s;
    }
    // barbatana dorsal
    for (var f2 = 1; f2 < 5; f2++) {
      var fin = cone(0.05, 0.16, 4, belM, 0, 0.15, -0.16);
      fin.rotation.x = -Math.PI / 2.4;
      segs[f2].add(fin);
    }
    // crânio-flauta GRANDE com furos
    var skull = grp(0, 0.34, 0);
    skull.scale.setScalar(1.35);
    var sk = sph(0.16, boneM, 0, 0.02, 0.05, 9, 7);
    sk.scale.set(0.85, 0.85, 1.5);
    skull.add(sk);
    var jaw = sph(0.1, boneM, 0, -0.08, 0.14, 8, 6);
    jaw.scale.set(0.7, 0.4, 1.3);
    skull.add(jaw);
    var holeM = mat('#101820', { emissive: P.c, ei: 0.35 });
    for (var h3 = 0; h3 < 3; h3++) {
      skull.add(sph(0.028, holeM, 0.08, 0.09, 0.02 + h3 * 0.09, 6, 5));
    }
    skull.add(sph(0.04, mat(P.c, { emissive: P.c, ei: 1.6 }), -0.07, 0.06, 0.16, 6, 5));
    skull.add(sph(0.04, mat(P.c, { emissive: P.c, ei: 1.6 }), 0.07, 0.06, 0.16, 6, 5));
    segs[5].add(skull);
    return {
      group: g,
      animate: function (st, t) {
        for (var i = 0; i < segs.length; i++) {
          segs[i].rotation.x = curls[i] * 0.55 + Math.sin(t * 2.1 + i * 0.8) * 0.09;
          segs[i].rotation.z = Math.sin(t * 1.6 + i * 0.5) * 0.07;
        }
        if (st.moving) {
          for (var j = 0; j < segs.length; j++) segs[j].rotation.z += Math.sin(t * 9 + j) * 0.12;
        }
        if (st.castK > 0) {
          var k = Math.sin(st.castK * Math.PI);
          skull.rotation.x = -k * 0.6;                     // ergue p/ cuspir o jato
          jaw.position.y = -0.08 - k * 0.07;
        } else { skull.rotation.x = 0; jaw.position.y = -0.08; }
      }
    };
  }

  // Água-Viva-Lustre — cúpula translúcida com franjas de cristal
  function buildLanternJelly() {
    var P = RACE_PAL.court;
    var g = grp();
    var domeM = mat(mix(P.c, P.a, 0.35), { rough: 0.3, alpha: 0.5, flat: false });
    var glowM = mat(P.c, { emissive: P.c, ei: 1.8 });
    var body = grp(0, 0.75, 0); g.add(body);        // flutua a um palmo do chão
    var dome = lathe([[0.001, 0.3], [0.24, 0.26], [0.4, 0.12], [0.44, -0.02], [0.36, -0.08], [0.001, -0.08]], 14, domeM, 0, 0.2, 0);
    dome.castShadow = true;
    body.add(dome);
    var heart = sph(0.17, glowM, 0, 0.2, 0, 8, 6);
    heart.castShadow = false;
    body.add(heart);
    var jlight = new THREE.PointLight(0x7ef0d4, 0.8, 6, 2);
    jlight.position.y = 0.2;
    body.add(jlight);
    // franjas de cristal (tentáculos retos como um lustre)
    var tents = [];
    var tentM = mat(mix(P.c, '#ffffff', 0.3), { rough: 0.4, alpha: 0.75 });
    for (var i = 0; i < 9; i++) {
      var a = (i / 9) * Math.PI * 2;
      var tnt = grp(Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3);
      tnt.add(box(0.035, 0.55, 0.035, tentM, 0, -0.28, 0));
      tnt.add(sph(0.035, glowM, 0, -0.58, 0, 6, 5));
      body.add(tnt); tents.push(tnt);
    }
    return {
      group: g,
      animate: function (st, t) {
        // pulso de cúpula (nada de passos: flutua)
        var pk = Math.sin(t * 2.4);
        dome.scale.set(1 - pk * 0.06, 1 + pk * 0.12, 1 - pk * 0.06);
        body.position.y = 0.75 + Math.sin(t * 1.5) * 0.09 + (st.moving ? 0.12 : 0);
        for (var i = 0; i < tents.length; i++) {
          tents[i].rotation.x = Math.sin(t * 1.8 + i) * 0.14;
          tents[i].rotation.z = Math.cos(t * 1.5 + i * 1.3) * 0.14;
        }
        jlight.intensity = 0.65 + Math.sin(t * 2.4) * 0.2;
        heart.scale.setScalar(1 + pk * 0.12);
        if (st.castK > 0) {
          var k = Math.sin(st.castK * Math.PI);
          jlight.intensity = 0.8 + k * 1.8;
          heart.scale.setScalar(1.1 + k * 0.6);
        }
      }
    };
  }

  // Salmourão — colosso de sal em camadas com coração d'água
  function buildBrineGolem() {
    var P = RACE_PAL.court;
    var g = grp();
    var saltM = mat('#b2c6cc', { rough: 0.55 });
    var salt2M = mat(mix('#9ab4bc', P.a, 0.55), { rough: 0.6 });
    var heartM = mat('#061826', { emissive: '#1e88b0', ei: 2.0 });
    var body = grp(); g.add(body);
    // pernas-bloco
    body.add(box(0.3, 0.5, 0.34, salt2M, -0.28, 0.25, 0));
    body.add(box(0.3, 0.5, 0.34, salt2M, 0.28, 0.25, 0));
    // torso: blocos angulares empilhados com fresta p/ o coração
    var torso = grp(0, 0, 0);
    var t1 = box(0.95, 0.42, 0.6, saltM, 0, 0.72, 0); t1.rotation.y = 0.08; torso.add(t1);
    var t2 = box(0.85, 0.4, 0.55, salt2M, 0.03, 1.12, 0.02); t2.rotation.y = -0.1; torso.add(t2);
    var t3 = box(0.7, 0.36, 0.5, saltM, -0.04, 1.5, -0.02); t3.rotation.y = 0.14; torso.add(t3);
    // coração de água escura VISÍVEL no peito
    var heart = sph(0.16, heartM, 0, 1.12, 0.28, 8, 6);
    heart.castShadow = false;
    torso.add(heart);
    body.add(torso);
    // braços maciços
    var armL = grp(-0.62, 1.45, 0), armR = grp(0.62, 1.45, 0);
    armL.add(box(0.28, 0.75, 0.32, salt2M, -0.05, -0.4, 0));
    armR.add(box(0.28, 0.75, 0.32, salt2M, 0.05, -0.4, 0));
    armL.add(box(0.32, 0.3, 0.36, saltM, -0.06, -0.9, 0));
    armR.add(box(0.32, 0.3, 0.36, saltM, 0.06, -0.9, 0));
    body.add(armL); body.add(armR);
    // cabeça entre os ombros (maior, olhos grandes)
    body.add(box(0.42, 0.34, 0.38, saltM, 0, 1.84, 0.06));
    body.add(sph(0.05, mat(P.c, { emissive: P.c, ei: 1.6 }), -0.1, 1.86, 0.27, 5, 4));
    body.add(sph(0.05, mat(P.c, { emissive: P.c, ei: 1.6 }), 0.1, 1.86, 0.27, 5, 4));
    return {
      group: g,
      animate: function (st, t) {
        body.rotation.z = 0; body.position.y = 0;
        if (st.moving) {                                    // passo pesado e lento
          body.rotation.z = Math.sin(t * 6.5) * 0.05;
          body.position.y = Math.abs(Math.sin(t * 6.5)) * 0.05;
        } else {
          torso.rotation.x = Math.sin(t * 0.9) * 0.015;    // arfa devagar
        }
        heart.scale.setScalar(1 + Math.sin(t * 1.6) * 0.14);
        if (st.castK > 0) {
          var k = Math.sin(st.castK * Math.PI);
          armR.rotation.x = -k * 1.9;
          armL.rotation.x = -k * 0.4;
        } else { armR.rotation.x = 0; armL.rotation.x = 0; }
      }
    };
  }

  // Gota-Gorda / Gotinha — gota d'água com rosto boiando dentro
  function buildDrop(small) {
    var P = RACE_PAL.court;
    var g = grp();
    var waterM = mat(mix(P.a, P.c, 0.25), { rough: 0.25, alpha: 0.72, flat: false });
    var R = small ? 0.26 : 0.5;
    var body = grp(0, R + 0.04, 0); g.add(body);
    var blob = lathe([[0.001, -R], [R * 0.8, -R * 0.55], [R, 0], [R * 0.72, R * 0.6], [R * 0.28, R * 0.95], [0.001, R * 1.1]], 12, waterM, 0, 0, 0);
    body.add(blob);
    // rosto dentro: sonolento (gorda) / indignado (gotinha)
    var faceM = mat('#16303c', { rough: 0.6 });
    if (small) {
      var browL = box(0.12, 0.028, 0.02, faceM, -0.08, 0.12, R * 0.55); browL.rotation.z = -0.5;
      var browR = box(0.12, 0.028, 0.02, faceM, 0.08, 0.12, R * 0.55); browR.rotation.z = 0.5;
      body.add(browL); body.add(browR);
      body.add(sph(0.045, faceM, -0.08, 0.03, R * 0.55, 6, 5));
      body.add(sph(0.045, faceM, 0.08, 0.03, R * 0.55, 6, 5));
      var mo = tor(0.06, 0.02, faceM, 0, -0.1, R * 0.55, Math.PI);
      body.add(mo);
    } else {
      var lidL = box(0.17, 0.035, 0.03, faceM, -0.15, 0.12, R * 0.62);
      var lidR = box(0.17, 0.035, 0.03, faceM, 0.15, 0.12, R * 0.62);
      body.add(lidL); body.add(lidR);
      var mo2 = tor(0.08, 0.022, faceM, 0, -0.12, R * 0.62, Math.PI);
      mo2.rotation.z = Math.PI;                            // boquinha caída (dormindo)
      body.add(mo2);
    }
    return {
      group: g,
      animate: function (st, t) {
        // wobble líquido permanente (squash & stretch)
        var w = Math.sin(t * (small ? 5.2 : 3.4));
        body.scale.set(1 - w * 0.07, 1 + w * 0.1, 1 - w * 0.07);
        if (st.moving) {
          var hop = Math.abs(Math.sin(t * 11));
          body.position.y = R + 0.04 + hop * (small ? 0.14 : 0.2);
          body.scale.y *= 1 + hop * 0.15;
        } else body.position.y = R + 0.04;
        if (st.castK > 0) {
          var k = Math.sin(st.castK * Math.PI);
          body.scale.set(1 + k * 0.25, 1 - k * 0.2, 1 + k * 0.25);   // chuaque!
        }
      }
    };
  }

  // Baronesa Salmoura — vestido de baile d'água com colar de pérolas (chefe)
  function buildBossBaroness() {
    var P = RACE_PAL.court;
    var g = grp();
    var gownM = mat(mix(P.b, P.a, 0.35), { rough: 0.3, alpha: 0.8, flat: false });
    var gown2M = mat(shade(P.b, 1.6), { rough: 0.4, alpha: 0.85, flat: false });
    var pearlM = mat('#f0ece0', { rough: 0.25, emissive: '#8a8578', ei: 0.25 });
    var body = grp(); g.add(body);
    // SAIA de baile: sino amplo de água escura
    var skirt = lathe([[0.001, 0], [0.85, 0.02], [0.8, 0.3], [0.55, 0.9], [0.4, 1.3], [0.34, 1.5]], 16, gownM, 0, 0, 0);
    body.add(skirt);
    // babados
    var frill = tor(0.78, 0.06, gown2M, 0, 0.14, 0);
    frill.rotation.x = Math.PI / 2;
    body.add(frill);
    // corpete
    var bodice = lathe([[0.34, 0], [0.3, 0.3], [0.34, 0.6], [0.26, 0.8], [0.001, 0.85]], 12, gown2M, 0, 1.5, 0);
    body.add(bodice);
    // ondas vivas subindo do vestido
    var waveM = mat(P.c, { emissive: P.c, ei: 0.6, alpha: 0.5 });
    var wave1 = tor(0.6, 0.03, waveM, 0, 0.65, 0); wave1.rotation.x = Math.PI / 2; wave1.castShadow = false;
    body.add(wave1);
    // luvas fantasma
    var armL = grp(-0.42, 2.05, 0.05), armR = grp(0.42, 2.05, 0.05);
    armL.add(cyl(0.05, 0.07, 0.55, 6, gown2M, -0.05, -0.28, 0.05));
    armR.add(cyl(0.05, 0.07, 0.55, 6, gown2M, 0.05, -0.28, 0.05));
    armL.add(sph(0.08, gownM, -0.08, -0.6, 0.1, 7, 5));
    armR.add(sph(0.08, gownM, 0.08, -0.6, 0.1, 7, 5));
    body.add(armL); body.add(armR);
    // onde deveria haver pescoço: COLAR DE PÉROLAS GRANDES boiando
    var necklace = grp(0, 2.52, 0);
    necklace.scale.setScalar(1.35);
    var pearls = [];
    for (var i = 0; i < 7; i++) {
      var a = (i / 7) * Math.PI * 2;
      var pr = sph(i === 0 ? 0.13 : 0.095, pearlM, Math.cos(a) * 0.24, Math.sin(i * 2.1) * 0.05, Math.sin(a) * 0.24, 8, 6);
      necklace.add(pr); pearls.push(pr);
    }
    body.add(necklace);
    // dois brilhos frios GRANDES onde seria o olhar
    body.add(sph(0.06, mat(P.c, { emissive: P.c, ei: 2.4 }), -0.11, 2.66, 0.16, 6, 5));
    body.add(sph(0.06, mat(P.c, { emissive: P.c, ei: 2.4 }), 0.11, 2.66, 0.16, 6, 5));
    return {
      group: g,
      boss: true,
      animate: function (st, t) {
        // o vestido dança sozinho — ela não pisa, desliza
        body.position.y = Math.sin(t * 1.2) * 0.05 + (st.moving ? 0.06 : 0);
        skirt.rotation.y = t * 0.4;
        frill.rotation.z = t * 0.3;
        wave1.position.y = 0.45 + ((t * 0.45) % 1) * 0.9;
        wave1.scale.setScalar(1 - ((t * 0.45) % 1) * 0.55);
        necklace.rotation.y = Math.sin(t * 0.8) * 0.4;
        for (var i = 0; i < pearls.length; i++) {
          pearls[i].position.y = Math.sin(t * 1.7 + i * 1.2) * 0.06;
        }
        armL.rotation.z = 0.3 + Math.sin(t * 1.1) * 0.12;
        armR.rotation.z = -0.3 - Math.cos(t * 1.3) * 0.12;
        if (st.castK > 0) {
          var k = Math.sin(st.castK * Math.PI);
          skirt.rotation.y = t * 0.4 + k * 2.2;            // rodopio da maré
          armL.rotation.x = -k * 1.3; armR.rotation.x = -k * 1.3;
          skirt.scale.set(1 + k * 0.15, 1, 1 + k * 0.15);
        } else { armL.rotation.x = 0; armR.rotation.x = 0; skirt.scale.set(1, 1, 1); }
      }
    };
  }

  // ------------------------------------------------------- FECHO (fornalha)

  // Tição — carvão em brasa com sorriso rachado
  function buildEmberImp() {
    var g = grp();
    var coalM = mat('#241410', { rough: 1 });
    var crackM = mat('#ff6a22', { emissive: '#ff6a22', ei: 2.2 });
    var body = grp(0, 0.4, 0); g.add(body);
    var core = ico(0.3, 1, crackM, 0, 0, 0);
    core.castShadow = false;
    body.add(core);
    var shell = ico(0.34, 1, coalM, 0, 0, 0);
    body.add(shell);
    // rachaduras: o núcleo vaza por frestas (caixas emissivas finas)
    body.add(box(0.5, 0.03, 0.03, crackM, 0, 0.08, 0.28)).children;
    var smile = box(0.37, 0.06, 0.03, crackM, 0, -0.07, 0.32);
    smile.rotation.z = 0.1;
    body.add(smile);
    body.add(sph(0.065, crackM, -0.12, 0.14, 0.29, 5, 4));
    body.add(sph(0.065, crackM, 0.12, 0.14, 0.29, 5, 4));
    // bracinhos finos
    var armL = grp(-0.3, 0.05, 0), armR = grp(0.3, 0.05, 0);
    armL.add(cyl(0.025, 0.035, 0.34, 4, coalM, -0.09, 0, 0));
    armR.add(cyl(0.025, 0.035, 0.34, 4, coalM, 0.09, 0, 0));
    armL.children[0].rotation.z = 0.5; armR.children[0].rotation.z = -0.5;
    body.add(armL); body.add(armR);
    // perninhas
    var legL = cyl(0.03, 0.04, 0.26, 4, coalM, -0.12, -0.36, 0);
    var legR = cyl(0.03, 0.04, 0.26, 4, coalM, 0.12, -0.36, 0);
    body.add(legL); body.add(legR);
    var ilight = new THREE.PointLight(0xff6a22, 0.7, 4.5, 2);
    body.add(ilight);
    return {
      group: g,
      animate: function (st, t) {
        var run = st.moving ? Math.sin(t * 16) : 0;
        body.position.y = 0.4 + (st.moving ? Math.abs(run) * 0.12 : Math.sin(t * 3.4) * 0.03);
        body.rotation.z = run * 0.14;
        legL.rotation.x = run * 0.9; legR.rotation.x = -run * 0.9;
        armL.rotation.x = -run * 0.7; armR.rotation.x = run * 0.7;
        // a brasa respira
        var glow = 1 + Math.sin(t * 6.2) * 0.25;
        core.scale.setScalar(glow * 0.95);
        ilight.intensity = 0.55 + Math.sin(t * 6.2) * 0.25;
        if (st.castK > 0) {
          var k = Math.sin(st.castK * Math.PI);
          core.scale.setScalar(0.95 + k * 0.5);
          ilight.intensity = 0.7 + k * 1.6;
        }
      }
    };
  }

  // Bigorna Ambulante — bigorna com pernas atarracadas
  function buildWalkingAnvil() {
    var g = grp();
    var ironM = mat('#3a3a42', { metal: 0.65, rough: 0.5 });
    var iron2M = mat('#26262e', { metal: 0.6, rough: 0.6 });
    var body = grp(0, 0, 0); g.add(body);
    // pernas atarracadas
    var legL = grp(-0.28, 0.42, 0), legR = grp(0.28, 0.42, 0);
    legL.add(cyl(0.12, 0.16, 0.42, 7, iron2M, 0, -0.21, 0));
    legR.add(cyl(0.12, 0.16, 0.42, 7, iron2M, 0, -0.21, 0));
    legL.add(box(0.3, 0.1, 0.36, ironM, 0, -0.4, 0.04));
    legR.add(box(0.3, 0.1, 0.36, ironM, 0, -0.4, 0.04));
    body.add(legL); body.add(legR);
    // corpo = BIGORNA de verdade (base + tronco + mesa + bico)
    var anvil = grp(0, 0.42, 0);
    anvil.add(box(0.66, 0.16, 0.5, iron2M, 0, 0.08, 0));
    anvil.add(box(0.44, 0.3, 0.36, iron2M, 0, 0.3, 0));
    anvil.add(box(0.95, 0.2, 0.44, ironM, 0, 0.54, 0));
    var horn = cone(0.14, 0.5, 7, ironM, 0.68, 0.54, 0);
    horn.rotation.z = -Math.PI / 2;
    anvil.add(horn);
    // olhos de rancor GRANDES sob a mesa
    anvil.add(sph(0.06, mat('#ffb347', { emissive: '#ffb347', ei: 2 }), -0.13, 0.42, 0.25, 5, 4));
    anvil.add(sph(0.06, mat('#ffb347', { emissive: '#ffb347', ei: 2 }), 0.13, 0.42, 0.25, 5, 4));
    // cicatrizes de martelada
    anvil.add(box(0.2, 0.02, 0.02, mat('#8a8a92', { metal: 0.7, rough: 0.4 }), -0.1, 0.65, 0.16));
    anvil.add(box(0.14, 0.02, 0.02, mat('#8a8a92', { metal: 0.7, rough: 0.4 }), 0.14, 0.65, -0.12));
    body.add(anvil);
    return {
      group: g,
      animate: function (st, t) {
        body.rotation.z = 0; body.position.y = 0;
        if (st.moving) {
          var stp = Math.sin(t * 7);
          body.rotation.z = stp * 0.07;
          body.position.y = Math.abs(stp) * 0.07;          // tremor de peso
          legL.rotation.x = stp * 0.5; legR.rotation.x = -stp * 0.5;
        } else {
          body.rotation.z = Math.sin(t * 0.7) * 0.012;
          legL.rotation.x = 0; legR.rotation.x = 0;
        }
        if (st.castK > 0) {
          var k = st.castK;
          anvil.rotation.x = k < 0.5 ? -k * 0.8 : (-0.4 + (k - 0.5) * 2.4);   // inclina e ESMAGA
        } else anvil.rotation.x = 0;
      }
    };
  }

  // Cinzento — contorno de ferreiro em fuligem com olhos de brasa
  function buildAshWraith() {
    var g = grp();
    var ashM = mat('#2c2c30', { rough: 1, alpha: 0.82 });
    var ash2M = mat('#1c1c20', { rough: 1, alpha: 0.7 });
    var emberM = mat('#ff7a2e', { emissive: '#ff7a2e', ei: 2.6 });
    var body = grp(0, 0.3, 0); g.add(body);         // flutua (sem pés)
    // vulto: lathe esfarelando na base
    var shroud = lathe([[0.05, 0], [0.3, 0.25], [0.34, 0.7], [0.24, 1.05], [0.14, 1.25], [0.001, 1.35]], 10, ashM, 0, 0, 0);
    body.add(shroud);
    // farrapos na base
    var rags = [];
    for (var i = 0; i < 5; i++) {
      var a = (i / 5) * Math.PI * 2;
      var rag = cone(0.07, 0.3, 4, ash2M, Math.cos(a) * 0.22, -0.05, Math.sin(a) * 0.22);
      rag.rotation.x = Math.PI;
      body.add(rag); rags.push(rag);
    }
    // ombros/braços sugeridos
    var armL = grp(-0.3, 0.85, 0), armR = grp(0.3, 0.85, 0);
    armL.add(cone(0.07, 0.5, 5, ash2M, -0.08, -0.2, 0));
    armR.add(cone(0.07, 0.5, 5, ash2M, 0.08, -0.2, 0));
    body.add(armL); body.add(armR);
    // dois pontos de brasa GRANDES no capuz
    var eyeL = sph(0.065, emberM, -0.09, 1.05, 0.16, 6, 5);
    var eyeR = sph(0.065, emberM, 0.09, 1.05, 0.16, 6, 5);
    eyeL.castShadow = false; eyeR.castShadow = false;
    body.add(eyeL); body.add(eyeR);
    return {
      group: g,
      animate: function (st, t) {
        body.position.y = 0.3 + Math.sin(t * 1.9) * 0.06 + (st.moving ? 0.1 : 0);
        body.rotation.y = Math.sin(t * 0.8) * 0.1;
        shroud.rotation.y = t * 0.5;                       // fuligem gira lenta
        shroud.scale.x = shroud.scale.z = 1 + Math.sin(t * 2.7) * 0.05;
        for (var i = 0; i < rags.length; i++) {
          rags[i].rotation.z = Math.sin(t * 3.1 + i * 1.7) * 0.3;
        }
        var fl = 1 + Math.sin(t * 8.2 + 1) * 0.2;
        eyeL.scale.setScalar(fl); eyeR.scale.setScalar(fl);
        if (st.castK > 0) {
          var k = Math.sin(st.castK * Math.PI);
          armR.rotation.x = -k * 1.6;
          shroud.scale.y = 1 + k * 0.14;
        } else { armR.rotation.x = 0; shroud.scale.y = 1; }
      }
    };
  }

  // Monte de Escória / Escorinha — pilha rastejante com veios de brasa
  function buildSlag(small) {
    var g = grp();
    var slagM = mat('#2a1c16', { rough: 1 });
    var slag2M = mat('#3a2a20', { rough: 1 });
    var veinM = mat('#ff5a1e', { emissive: '#ff5a1e', ei: 1.8 });
    var S = small ? 0.5 : 1;
    var body = grp(0, 0, 0); g.add(body);
    var rnd = srand(small ? 77 : 41);
    // amontoado de pedras
    var rocks = [];
    var n = small ? 4 : 7;
    for (var i = 0; i < n; i++) {
      var rr = (0.22 + rnd() * 0.2) * S;
      var rk = ico(rr, 0, i % 2 ? slagM : slag2M,
        (rnd() - 0.5) * 0.7 * S, rr * 0.75 + rnd() * 0.3 * S, (rnd() - 0.5) * 0.7 * S);
      rk.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      body.add(rk); rocks.push(rk);
    }
    // veios incandescentes entre as pedras
    var veins = [];
    for (var v2 = 0; v2 < (small ? 2 : 4); v2++) {
      var vn = box((0.3 + rnd() * 0.3) * S, 0.035 * S, 0.05 * S, veinM,
        (rnd() - 0.5) * 0.5 * S, (0.15 + rnd() * 0.4) * S, (rnd() - 0.5) * 0.5 * S);
      vn.rotation.y = rnd() * 3; vn.rotation.z = (rnd() - 0.5) * 0.7;
      vn.castShadow = false;
      body.add(vn); veins.push(vn);
    }
    var slight = new THREE.PointLight(0xff5a1e, small ? 0.35 : 0.55, 4 * S, 2);
    slight.position.y = 0.4 * S;
    body.add(slight);
    return {
      group: g,
      animate: function (st, t) {
        // arrasta: ondula como lava fria
        var crawl = st.moving ? Math.sin(t * 7) : Math.sin(t * 1.3);
        body.scale.y = 1 + crawl * 0.05;
        body.rotation.y = st.moving ? Math.sin(t * 3.3) * 0.08 : 0;
        for (var i = 0; i < veins.length; i++) {
          veins[i].material.emissiveIntensity = 1.5 + Math.sin(t * 4 + i * 2) * 0.7;
        }
        slight.intensity = (0.45 + Math.sin(t * 3.6) * 0.18) * (st.castK > 0 ? 2 : 1);
        if (st.castK > 0) {
          var k = Math.sin(st.castK * Math.PI);
          body.scale.y = 1 + k * 0.3;                      // ergue o peso morto
        }
      }
    };
  }

  // Fagulha — faísca com pernas e opinião
  function buildSparkWhelp() {
    var g = grp();
    var sparkM = mat('#ff9a2e', { emissive: '#ff9a2e', ei: 1.7 });
    var coreM = mat('#ffd98a', { emissive: '#ffd98a', ei: 2.0 });
    var legM = mat('#3a2a20', { rough: 1 });
    var body = grp(0, 0.32, 0); g.add(body);
    var spark = mesh(new THREE.OctahedronGeometry(0.2, 0), sparkM);
    spark.castShadow = false;
    body.add(spark);
    var core = mesh(new THREE.OctahedronGeometry(0.1, 0), coreM);
    core.castShadow = false;
    body.add(core);
    var legL = cyl(0.018, 0.022, 0.22, 4, legM, -0.08, -0.24, 0);
    var legR = cyl(0.018, 0.022, 0.22, 4, legM, 0.08, -0.24, 0);
    body.add(legL); body.add(legR);
    var wlight = new THREE.PointLight(0xffb347, 0.55, 3.5, 2);
    body.add(wlight);
    return {
      group: g,
      animate: function (st, t) {
        var run = st.moving ? Math.sin(t * 18) : 0;
        body.position.y = 0.32 + (st.moving ? Math.abs(run) * 0.12 : Math.sin(t * 5.2) * 0.04);
        legL.rotation.x = run; legR.rotation.x = -run;
        spark.rotation.y = t * 3.1; spark.rotation.x = t * 1.7;
        core.rotation.y = -t * 4.3;
        var fl = 1 + Math.sin(t * 12.7) * 0.22;
        spark.scale.setScalar(fl);
        wlight.intensity = 0.4 + Math.sin(t * 12.7) * 0.2;
        if (st.castK > 0) spark.scale.setScalar(fl + Math.sin(st.castK * Math.PI) * 0.5);
      }
    };
  }

  // Ferreiro Sem-Rosto — avental e braços pendurados em calor tremulante
  function buildFacelessSmith() {
    var g = grp();
    var apronM = mat('#5a4030', { rough: 0.95 });
    var armM = mat('#8a6a52', { rough: 0.9 });
    var heatM = mat('#ff8c3a', { emissive: '#ff8c3a', ei: 0.5, alpha: 0.22 });
    var body = grp(0, 0.25, 0); g.add(body);        // flutua um palmo
    // calor tremulando onde deveria haver corpo
    var heat = lathe([[0.05, 0], [0.26, 0.4], [0.3, 0.9], [0.2, 1.3], [0.001, 1.5]], 9, heatM, 0, 0, 0);
    heat.castShadow = false;
    body.add(heat);
    // AVENTAL de couro flutuando
    var apron = grp(0, 0, 0.14);
    var ap = box(0.5, 0.85, 0.06, apronM, 0, 0.55, 0);
    apron.add(ap);
    apron.add(box(0.36, 0.3, 0.06, apronM, 0, 1.12, -0.02));
    // bolso e fivelas
    apron.add(box(0.2, 0.16, 0.03, mat('#4a3428', { rough: 1 }), 0, 0.5, 0.05));
    apron.add(sph(0.03, mat('#c8a04a', { metal: 0.7, rough: 0.4 }), -0.14, 1.24, 0.03, 5, 4));
    apron.add(sph(0.03, mat('#c8a04a', { metal: 0.7, rough: 0.4 }), 0.14, 1.24, 0.03, 5, 4));
    body.add(apron);
    // dois braços musculosos pendurados no nada
    var armL = grp(-0.4, 1.3, 0.05), armR = grp(0.4, 1.3, 0.05);
    armL.add(cyl(0.07, 0.1, 0.55, 7, armM, -0.03, -0.28, 0));
    armR.add(cyl(0.07, 0.1, 0.55, 7, armM, 0.03, -0.28, 0));
    armL.add(sph(0.1, armM, -0.05, -0.6, 0.02, 7, 6));
    armR.add(sph(0.1, armM, 0.05, -0.6, 0.02, 7, 6));
    body.add(armL); body.add(armR);
    // martelo de forja GRANDE na mão direita
    var hammer = grp(0.05, -0.6, 0.1);
    hammer.scale.setScalar(1.3);
    hammer.add(cyl(0.025, 0.025, 0.5, 6, mat('#7a5a3a', { rough: 0.9 }), 0, 0.1, 0));
    hammer.add(box(0.22, 0.12, 0.12, mat('#3a3a42', { metal: 0.7, rough: 0.4 }), 0, 0.38, 0));
    armR.add(hammer);
    // olhos? não: só uma brasa GORDA suspensa onde seria a cabeça
    var emberHead = sph(0.09, mat('#ff8c3a', { emissive: '#ff8c3a', ei: 1.8 }), 0, 1.62, 0.05, 7, 5);
    emberHead.castShadow = false;
    body.add(emberHead);
    return {
      group: g,
      animate: function (st, t) {
        body.position.y = 0.25 + Math.sin(t * 1.6) * 0.05 + (st.moving ? 0.08 : 0);
        heat.scale.x = heat.scale.z = 1 + Math.sin(t * 9.3) * 0.08;
        heat.rotation.y = t * 0.9;
        apron.rotation.x = Math.sin(t * 1.9) * 0.05;
        emberHead.position.y = 1.62 + Math.sin(t * 2.6) * 0.04;
        // martelo bate de leve na palma esquerda (idle)
        armR.rotation.x = Math.sin(t * 1.4) * 0.14 - 0.1;
        armL.rotation.x = -0.15;
        if (st.castK > 0) {
          var k = st.castK;
          armR.rotation.x = k < 0.5 ? -k * 2.4 : (-1.2 + (k - 0.5) * 3.4);
        }
      }
    };
  }

  // Magno, o Acendedor — forno-titã com grelha no peito e martelo-chaminé
  function buildBossHeartforge() {
    var g = grp();
    var ironM = mat('#33261e', { metal: 0.35, rough: 0.7 });
    var iron2M = mat('#241512', { metal: 0.3, rough: 0.8 });
    var fireM = mat('#ff8a36', { emissive: '#ff9a42', ei: 3.0 });
    var body = grp(); g.add(body);
    // pernas-coluna
    body.add(cyl(0.24, 0.3, 0.8, 8, iron2M, -0.42, 0.4, 0));
    body.add(cyl(0.24, 0.3, 0.8, 8, iron2M, 0.42, 0.4, 0));
    body.add(box(0.6, 0.16, 0.7, ironM, -0.42, 0.06, 0.06));
    body.add(box(0.6, 0.16, 0.7, ironM, 0.42, 0.06, 0.06));
    // torso-FORNO
    var torso = grp(0, 0, 0);
    var trunkGeo = jitterGeo(new THREE.BoxGeometry(1.5, 1.6, 1.0), 0.04, false);
    trunkGeo.translate(0, 1.6, 0);
    torso.add(mesh(trunkGeo, ironM));
    // GRELHA no peito com a primeira chama do mundo dentro (à frente da chapa)
    var furnace = grp(0, 1.65, 0.58);
    var fire = box(0.8, 0.7, 0.06, fireM, 0, 0, -0.03);
    fire.castShadow = false;
    furnace.add(fire);
    for (var b3 = 0; b3 < 4; b3++) {
      furnace.add(box(0.86, 0.07, 0.05, iron2M, 0, -0.27 + b3 * 0.18, 0.02));
    }
    furnace.add(box(0.07, 0.76, 0.05, iron2M, -0.28, 0, 0.02));
    furnace.add(box(0.07, 0.76, 0.05, iron2M, 0.28, 0, 0.02));
    torso.add(furnace);
    // ombreiras + cabeça-fornalha pequena com olhos de fogo
    torso.add(box(0.56, 0.34, 0.7, iron2M, -0.75, 2.35, 0));
    torso.add(box(0.56, 0.34, 0.7, iron2M, 0.75, 2.35, 0));
    var head = grp(0, 2.74, 0.1);
    head.scale.setScalar(1.28);                       // cabeçorra de forno
    head.add(box(0.5, 0.42, 0.48, ironM, 0, 0, 0));
    var eyeL = box(0.13, 0.075, 0.03, fireM, -0.13, 0.05, 0.25);
    var eyeR = box(0.13, 0.075, 0.03, fireM, 0.13, 0.05, 0.25);
    eyeL.castShadow = false; eyeR.castShadow = false;
    head.add(eyeL); head.add(eyeR);
    torso.add(head);
    body.add(torso);
    // braço esquerdo
    var armL = grp(-0.95, 2.25, 0);
    armL.add(cyl(0.13, 0.17, 0.85, 7, ironM, -0.05, -0.45, 0));
    armL.add(sph(0.2, iron2M, -0.08, -0.95, 0.02, 8, 6));
    body.add(armL);
    // braço direito com o MARTELO-CHAMINÉ ao ombro
    var armR = grp(0.95, 2.25, 0);
    armR.add(cyl(0.13, 0.17, 0.7, 7, ironM, 0.05, -0.35, 0));
    var hammer = grp(0.1, -0.72, 0.05);
    hammer.add(cyl(0.05, 0.05, 1.5, 7, mat('#5a4634', { rough: 0.9 }), 0, 0.45, 0));
    // cabeça do martelo = CHAMINÉ AVANTAJADA com boca em brasa
    var chim = grp(0, 1.25, 0);
    chim.scale.setScalar(1.32);
    chim.add(box(0.5, 0.55, 0.42, iron2M, 0, 0, 0));
    var mouth = box(0.34, 0.1, 0.3, fireM, 0, 0.29, 0);
    mouth.castShadow = false;
    chim.add(mouth);
    hammer.add(chim);
    hammer.rotation.z = -0.5;                        // apoiado no ombro
    armR.add(hammer);
    body.add(armR);
    var flight = new THREE.PointLight(0xff6a22, 1.1, 9, 2);
    flight.position.set(0, 1.7, 1.0);
    body.add(flight);
    return {
      group: g,
      boss: true,
      animate: function (st, t) {
        body.rotation.z = 0; body.position.y = 0;
        if (st.moving) {
          var stp = Math.sin(t * 6);
          body.rotation.z = stp * 0.05;
          body.position.y = Math.abs(stp) * 0.08;
        }
        // a fornalha RESPIRA: o peito pulsa em brilho, fagulhas de luz
        var breathe = 0.75 + Math.sin(t * 2.1) * 0.25 + Math.sin(t * 7.7) * 0.08;
        fire.material.emissiveIntensity = 1.8 + breathe * 1.4;
        flight.intensity = 0.8 + breathe * 0.55;
        head.rotation.y = Math.sin(t * 0.5) * 0.16;
        armL.rotation.x = Math.sin(t * 1.1) * 0.06;
        if (st.castK > 0) {
          var k = st.castK;
          // ergue o martelo-chaminé e DESCE
          if (k < 0.55) { hammer.rotation.z = -0.5 - (k / 0.55) * 1.4; }
          else { hammer.rotation.z = -1.9 + ((k - 0.55) / 0.45) * 2.6; }
          fire.material.emissiveIntensity = 3.2 + k * 2;
          flight.intensity = 1.2 + k * 1.6;
        } else hammer.rotation.z = -0.5 + Math.sin(t * 1.3) * 0.04;
      }
    };
  }

  // fallback p/ defId desconhecido
  function buildFallback(defId) {
    var g = grp();
    var m = mat('#8a8a92', { rough: 0.9 });
    var body = grp(0, 0, 0); g.add(body);
    body.add(cyl(0.22, 0.3, 0.9, 8, m, 0, 0.45, 0));
    body.add(sph(0.22, m, 0, 1.1, 0, 8, 6));
    console.warn('Models3D: defId desconhecido "' + defId + '" — usando fallback');
    return {
      group: g,
      animate: function (st, t) { walkRock(body, t, st.moving); }
    };
  }

  var BUILDERS = {
    'hero-toll': buildToll,
    'hero-wick': buildWick,
    'hero-morel': buildMorel,
    'hero-rose': buildRose,
    'hero-whistle': buildWhistle,
    'thorn-lasher': buildThornLasher,
    'pollen-puff': buildPollenPuff,
    'burr-mother': function () { return buildBurr(false); },
    'burrlet': function () { return buildBurr(true); },
    'lantern-wasp': buildLanternWasp,
    'sap-shaman': buildSapShaman,
    'boss-gardener': buildBossGardener,
    'sprout-feral': buildSproutFeral,
    'sporeling': buildSporeling,
    'drowned-porter': buildDrownedPorter,
    'moray-piper': buildMorayPiper,
    'lantern-jelly': buildLanternJelly,
    'brine-golem': buildBrineGolem,
    'fat-drop': function () { return buildDrop(false); },
    'droplet': function () { return buildDrop(true); },
    'boss-baroness': buildBossBaroness,
    'ember-imp': buildEmberImp,
    'walking-anvil': buildWalkingAnvil,
    'ash-wraith': buildAshWraith,
    'slag-mound': function () { return buildSlag(false); },
    'slag-bit': function () { return buildSlag(true); },
    'spark-whelp': buildSparkWhelp,
    'faceless-smith': buildFacelessSmith,
    'boss-heartforge': buildBossHeartforge
  };

  M.unitIds = function () { return Object.keys(BUILDERS); };

  // cor do TRAÇO por família (tom escuro da paleta local — nunca preto puro)
  var OUTLINE_HEX = {
    bellborn: '#3c2a12', waxkin: '#48281c', sporeborn: '#2a1f3a',
    glassborn: '#1d1b36', bellowsborn: '#243138',
    flora: '#23301c', court: '#102836', forge: '#2c1410'
  };
  var UNIT_FAMILY = {
    'hero-toll': 'bellborn', 'hero-wick': 'waxkin', 'hero-morel': 'sporeborn',
    'hero-rose': 'glassborn', 'hero-whistle': 'bellowsborn', 'sporeling': 'sporeborn',
    'thorn-lasher': 'flora', 'pollen-puff': 'flora', 'burr-mother': 'flora',
    'burrlet': 'flora', 'lantern-wasp': 'flora', 'sap-shaman': 'flora',
    'boss-gardener': 'flora', 'sprout-feral': 'flora',
    'drowned-porter': 'court', 'moray-piper': 'court', 'lantern-jelly': 'court',
    'brine-golem': 'court', 'fat-drop': 'court', 'droplet': 'court', 'boss-baroness': 'court',
    'ember-imp': 'forge', 'walking-anvil': 'forge', 'ash-wraith': 'forge',
    'slag-mound': 'forge', 'slag-bit': 'forge', 'spark-whelp': 'forge',
    'faceless-smith': 'forge', 'boss-heartforge': 'forge'
  };

  // wrapper comum: TRAÇO de contorno, flash de emissive, morte cômica, fade
  M.buildUnit = function (defId) {
    var builder = BUILDERS[defId] || function () { return buildFallback(defId); };
    var u = builder();
    var g = u.group;
    // contorno de desenho animado (inverted hull; cor = tom escuro da paleta)
    // (window.__noOutlines: chave de diagnóstico das páginas de teste)
    if (!(typeof window !== 'undefined' && window.__noOutlines)) {
      M.addOutlines(g, {
        color: OUTLINE_HEX[UNIT_FAMILY[defId]] || '#241a2e',
        thick: u.boss ? 0.0030 : 0.0036,
        minR: 0.05
      });
    }
    // coleciona materiais p/ flash & fade (por unidade — materiais não compartilhados)
    var mats = [], outlines = [], seen = {};
    g.traverse(function (n) {
      if (!n.isMesh || !n.material) return;
      if (n.userData.outline || (n.material.userData && n.material.userData.isOutline)) {
        if (n.userData.outline) outlines.push(n);
        return;
      }
      if (seen[n.material.uuid]) return;
      seen[n.material.uuid] = 1;
      mats.push({
        m: n.material,
        baseE: n.material.emissive ? n.material.emissive.clone() : new THREE.Color(0),
        baseEI: n.material.emissiveIntensity != null ? n.material.emissiveIntensity : 1,
        baseO: n.material.opacity != null ? n.material.opacity : 1,
        baseT: !!n.material.transparent
      });
    });
    var lights = [];
    g.traverse(function (n) { if (n.isPointLight) lights.push({ l: n, base: n.intensity }); });
    var white = new THREE.Color(1, 1, 1);
    var tmpC = new THREE.Color();
    var lastFlash = 0, lastDeath = 0, lastInvis = false, lastHull = true;
    function applyCommon(st, t) {
      var flash = st.flash || 0;
      var deathK = st.deathK || 0;
      var invis = !!st.invis;
      if (flash > 0.003 || lastFlash > 0.003) {
        for (var i = 0; i < mats.length; i++) {
          var e = mats[i];
          tmpC.copy(e.baseE).lerp(white, Math.min(flash, 1));
          e.m.emissive.copy(tmpC);
          e.m.emissiveIntensity = e.baseEI + flash * 1.6;
        }
      }
      if (deathK > 0 || lastDeath > 0 || invis || lastInvis) {
        // morte cômica fica VISÍVEL (salto/giro/panqueca) e só esvai no fim
        var fadeK = deathK > 0.72 ? (deathK - 0.72) / 0.28 : 0;
        var iv = invis ? (0.32 + Math.sin((t || 0) * 5.3) * 0.06) : 1;   // shimmer
        var op = (1 - fadeK) * iv;
        var restore = deathK <= 0 && !invis;
        for (var j = 0; j < mats.length; j++) {
          var e2 = mats[j];
          e2.m.transparent = true;
          e2.m.opacity = e2.baseO * op;
          if (restore) { e2.m.transparent = e2.baseT; e2.m.opacity = e2.baseO; }
        }
        for (var k = 0; k < lights.length; k++) lights[k].l.intensity = lights[k].base * op;
        // casco não tem alfa: some quando o corpo fica fantasma
        var showHull = op > 0.72;
        if (showHull !== lastHull) {
          for (var q = 0; q < outlines.length; q++) outlines[q].visible = showHull;
          lastHull = showHull;
        }
      } else if (!lastHull) {
        for (var q2 = 0; q2 < outlines.length; q2++) outlines[q2].visible = true;
        lastHull = true;
      }
      lastFlash = flash; lastDeath = deathK; lastInvis = invis;
    }
    return {
      group: g,
      boss: !!u.boss,
      animate: function (st, t, dt) {
        st = st || {};
        try { u.animate(st, t, dt); } catch (e) { /* nunca derruba o frame */ }
        applyCommon(st, t);
      }
    };
  };

  JOGO.Models3D = M;
})();
