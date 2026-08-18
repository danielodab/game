var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// JOGO.Models3D2 — catálogo de modelos 3D do SOTERRA 2.0
// Dono: Agente de Migração 3D.  Lei: docs/CONTRACT_V2.md §9 + adendos.
//
// O que este arquivo faz:
//   1. decodifica os GLB embutidos em base64 (JOGO.MODELS, de
//      assets/embedded/models-*.js) — o jogo abre por file://, onde fetch de
//      .glb falha, então NADA é buscado na rede;
//   2. mantém UM banco de animações (todos os personagens do KayKit dividem o
//      mesmo esqueleto de 41 ossos, então 30 clipes servem para todo mundo);
//   3. clona modelos com esqueleto (SkeletonUtils.clone reimplementado — o
//      vendor não traz o utilitário) e tinge o material por elemento/classe;
//   4. resolve `defId -> aparência`: classes, monstros (por família), pets e
//      FUSÕES (corpo da classe dominante + arma-assinatura da outra).
//
// API:
//   Models3D2.CELL                        tamanho de uma célula em unidades de mundo
//   Models3D2.load(cb)                    decodifica tudo (idempotente)
//   Models3D2.isReady()                   -> bool
//   Models3D2.unit(defId, opts)           -> THREE.Group | null   (opts: {element, elements, boss, kind, classId, scale})
//   Models3D2.lookFor(defId, opts)        -> descrição da aparência (sem construir)
//   Models3D2.clips()                     -> [THREE.AnimationClip]
//   Models3D2.clip(name)                  -> THREE.AnimationClip | null
//   Models3D2.elementColor(e)             -> '#rrggbb'
//   Models3D2.attach(group, meshKey, boneName)  acopla um adereço a um osso
//
// Cada grupo devolvido por `unit` traz:
//   g.userData = { root, mixer, actions, height, radius, bones:{handR,handL,head,chest},
//                  play(name, opts), stopAll(), tintMats:[…] }
// ============================================================================

(function () {
  'use strict';
  if (typeof THREE === 'undefined') {
    if (typeof console !== 'undefined') console.error('[Models3D2] THREE ausente');
    return;
  }

  var M = {};
  JOGO.Models3D2 = M;

  M.CELL = 2.0;                       // 1 célula = 2 unidades de mundo
  var UNIT_SCALE = 0.92;              // o KayKit nasce com ~1.7 de altura

  // ------------------------------------------------------------------ cores
  var ELEMENT_COLORS = {
    neutro: '#d8dee4', fogo: '#ff8c3a', agua: '#57c8ec',
    terra: '#9bd06a', ar: '#c8b6ff'
  };
  M.ELEMENT_COLORS = ELEMENT_COLORS;
  M.elementColor = function (e) { return ELEMENT_COLORS[e] || ELEMENT_COLORS.neutro; };

  function hexInt(c) {
    if (typeof c === 'number') return c;
    if (typeof c !== 'string') return 0xffffff;
    var s = c.charAt(0) === '#' ? c.slice(1) : c;
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    return isNaN(n) ? 0xffffff : n;
  }
  M.hexInt = hexInt;
  function hashStr(s) {
    var h = 2166136261; s = String(s || '');
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  M.hashStr = hashStr;

  // ---------------------------------------------------------------- APARÊNCIA
  // Os nomes de malha vêm dos GLB do KayKit (ver docs/CREDITS_3D.md).
  // `show` lista os adereços VISÍVEIS; qualquer adereço não citado fica oculto.
  // As malhas com esqueleto (corpo) estão sempre visíveis.
  //
  // NOTA DE CONCEITO (repassar ao Criativo Classes): as aparências mudaram para
  // caber no pacote CC0. Identidade tática preservada, visual novo.
  M.CLASS_LOOK = {
    // tanque: o corpo mais pesado do pacote, machado de duas mãos
    sumo: { model: 'barbarian', show: ['2H_Axe', 'Barbarian_Cape'],
            scale: 1.16, tint: '#d4553f', accent: '#ffd08a',
            concept: 'Bárbaro corpulento de machado e capa', weapon: '2H_Axe', hand: 'r' },
    // atirador: encapuzado com besta de duas mãos
    arqueiro: { model: 'rogue_hooded', show: ['2H_Crossbow', 'Rogue_Cape'],
            scale: 1.00, tint: '#4f9d6a', accent: '#d8f0a0',
            concept: 'Batedor encapuzado de besta', weapon: '2H_Crossbow', hand: 'r' },
    // mago: chapéu pontudo, cajado, capa
    bruxo: { model: 'mage', show: ['2H_Staff', 'Mage_Hat', 'Mage_Cape'],
            scale: 1.02, tint: '#7a5fa0', accent: '#b98cff',
            concept: 'Mago de chapéu e cajado', weapon: '2H_Staff', hand: 'r' },
    // assassino: ágil, duas adagas
    espadachim: { model: 'rogue', show: ['Knife', 'Knife_Offhand'],
            scale: 0.97, tint: '#2f6f8f', accent: '#9be8ff',
            concept: 'Ladino ágil de adagas gêmeas', weapon: 'Knife', hand: 'r' },
    // suporte: figura de luz, armadura clara e escudo com brasão
    curandeira: { model: 'knight', show: ['1H_Sword', 'Badge_Shield', 'Knight_Cape'],
            scale: 1.00, tint: '#f0c05a', accent: '#fff2c2',
            concept: 'Paladina/clériga de armadura clara e escudo de brasão',
            weapon: '1H_Sword', hand: 'r' },
    // invocador: xamã sem chapéu, grimório aberto e varinha
    invocador: { model: 'mage', show: ['Spellbook_open', '1H_Wand', 'Mage_Cape'],
            scale: 1.00, tint: '#3f8f8a', accent: '#8ff0d8',
            concept: 'Xamã de grimório aberto e varinha (sem chapéu)',
            weapon: '1H_Wand', hand: 'r' }
  };

  // Monstros: agrupados por FAMÍLIA (js/core/data/monsters.js, só leitura).
  // Sem correspondência exata no acervo CC0 — o que temos é a linha de
  // esqueletos do KayKit + criaturas do Quaternius; a variação dentro da
  // família sai do tint elemental e do porte.
  M.FAMILY_LOOK = {
    'Turno da Noite':       { model: 'skeleton_minion',  show: [] },
    'Prole da Fornalha':    { model: 'skeleton_warrior', show: ['Skeleton_Blade'] },
    'Guarda do Coração':    { model: 'skeleton_warrior', show: ['Skeleton_Shield_Large_A'] },
    'Coro dos Andaimes':    { model: 'skeleton_rogue',   show: ['Skeleton_Crossbow'] },
    'Corte Afogada':        { model: 'skeleton_mage',    show: ['Skeleton_Staff'] },
    'Rebanho do Invocador': { model: 'skeleton_minion',  show: [] },
    'Flora Voraz':          { model: 'skeleton_mage',    show: [] },
    'Enxame da Estufa':     { model: 'skeleton_rogue',   show: [] }
  };
  M.MONSTER_FALLBACK = { model: 'skeleton_minion', show: [] };

  // ------------------------------------------------------------ decodificação
  var raw = {};            // chave -> {gltf, scene}
  var animClips = [];
  var loading = false, ready = false, failed = false;
  var waiters = [];

  function b64ToArrayBuffer(b64) {
    var bin = atob(b64);
    var len = bin.length;
    var buf = new Uint8Array(len);
    for (var i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }

  M.isReady = function () { return ready; };
  M.failed = function () { return failed; };

  M.load = function (cb) {
    if (ready) { if (cb) cb(null); return; }
    if (cb) waiters.push(cb);
    if (loading) return;
    loading = true;

    var src = JOGO.MODELS || {};
    var keys = Object.keys(src);
    if (!keys.length) {
      failed = true; ready = true; loading = false;
      done(new Error('JOGO.MODELS vazio: inclua assets/embedded/models-*.js'));
      return;
    }
    if (typeof THREE.GLTFLoader !== 'function') {
      failed = true; ready = true; loading = false;
      done(new Error('THREE.GLTFLoader ausente (vendor/GLTFLoader.js)'));
      return;
    }
    var loader = new THREE.GLTFLoader();
    var pending = keys.length;
    var firstErr = null;

    keys.forEach(function (key) {
      var ab;
      try { ab = b64ToArrayBuffer(src[key]); }
      catch (e) { firstErr = firstErr || e; step(); return; }
      try {
        loader.parse(ab, '', function (gltf) {
          if (key === '_anims') {
            animClips = gltf.animations || [];
          } else {
            prepScene(gltf.scene);
            raw[key] = { scene: gltf.scene, animations: gltf.animations || [] };
          }
          step();
        }, function (err) { firstErr = firstErr || err; step(); });
      } catch (e2) { firstErr = firstErr || e2; step(); }
    });

    function step() {
      pending--;
      if (pending > 0) return;
      ready = true; loading = false;
      failed = !!firstErr && !Object.keys(raw).length;
      done(firstErr);
    }
    function done(err) {
      var q = waiters.slice(); waiters.length = 0;
      for (var i = 0; i < q.length; i++) { try { q[i](err); } catch (e) {} }
    }
  };

  // materiais toon-friendly + sombra em tudo
  function prepScene(scene) {
    scene.traverse(function (n) {
      if (!n.isMesh && !n.isSkinnedMesh) return;
      n.castShadow = true;
      n.receiveShadow = true;
      n.frustumCulled = false;               // esqueleto animado sai da caixa
      var mats = Array.isArray(n.material) ? n.material : [n.material];
      for (var i = 0; i < mats.length; i++) {
        var m = mats[i];
        if (!m) continue;
        if (m.map) { m.map.magFilter = THREE.NearestFilter; m.map.minFilter = THREE.LinearMipmapLinearFilter; }
        m.roughness = 0.82;
        m.metalness = 0.02;
      }
    });
  }

  M.clips = function () { return animClips; };
  M.clip = function (name) {
    for (var i = 0; i < animClips.length; i++) if (animClips[i].name === name) return animClips[i];
    return null;
  };
  M.clipNames = function () { return animClips.map(function (c) { return c.name; }); };

  // --------------------------------------------------------- clone esqueletal
  // Equivalente ao SkeletonUtils.clone do three (que não está vendorado).
  function cloneSkinned(source) {
    var srcLookup = new Map();
    var cloneLookup = new Map();
    var clone = source.clone();

    parallelTraverse(source, clone, function (a, b) {
      srcLookup.set(b, a);
      cloneLookup.set(a, b);
    });

    clone.traverse(function (node) {
      if (!node.isSkinnedMesh) return;
      var cloneMesh = node;
      var srcMesh = srcLookup.get(node);
      var srcBones = srcMesh.skeleton.bones;
      cloneMesh.skeleton = srcMesh.skeleton.clone();
      cloneMesh.bindMatrix.copy(srcMesh.bindMatrix);
      cloneMesh.skeleton.bones = srcBones.map(function (bone) { return cloneLookup.get(bone); });
      cloneMesh.bind(cloneMesh.skeleton, cloneMesh.bindMatrix);
    });
    return clone;
  }
  function parallelTraverse(a, b, callback) {
    callback(a, b);
    for (var i = 0; i < a.children.length; i++) {
      parallelTraverse(a.children[i], b.children[i], callback);
    }
  }
  M.cloneSkinned = cloneSkinned;

  // ------------------------------------------------------------- tint/material
  // O KayKit usa uma textura minúscula de paleta. Tingir com `material.color`
  // multiplica a paleta inteira e some com a leitura; usamos uma mistura
  // suave + emissivo elemental discreto, que preserva o desenho.
  function tintMaterials(root, color, strength, emissive, emiI) {
    var out = [];
    var col = new THREE.Color(hexInt(color));
    root.traverse(function (n) {
      if (!n.isMesh && !n.isSkinnedMesh) return;
      var mats = Array.isArray(n.material) ? n.material : [n.material];
      var cloned = [];
      for (var i = 0; i < mats.length; i++) {
        var m = mats[i];
        if (!m) { cloned.push(m); continue; }
        var c = m.clone();
        c.color = c.color ? c.color.clone() : new THREE.Color(0xffffff);
        c.color.lerp(col, strength == null ? 0.42 : strength);
        if (emissive != null) {
          c.emissive = new THREE.Color(hexInt(emissive));
          c.emissiveIntensity = emiI == null ? 0.18 : emiI;
        }
        cloned.push(c);
        out.push(c);
      }
      n.material = Array.isArray(n.material) ? cloned : cloned[0];
    });
    return out;
  }
  M.tintMaterials = tintMaterials;

  // ------------------------------------------------------- resolução de aparência
  function DATA() { return JOGO.DATA || {}; }

  function classLook(classId) {
    return M.CLASS_LOOK[classId] || null;
  }
  function monsterLook(defId) {
    var D = DATA();
    var md = D.monsters && D.monsters[defId];
    if (md && md.family && M.FAMILY_LOOK[md.family]) {
      var L = M.FAMILY_LOOK[md.family];
      return { model: L.model, show: L.show.slice(), scale: md.boss ? 1.5 : 1.0,
               tint: M.elementColor(md.element || 'neutro'), family: md.family };
    }
    return { model: M.MONSTER_FALLBACK.model, show: [], scale: 1.0,
             tint: M.elementColor((md && md.element) || 'neutro') };
  }
  function petLook(defId) {
    var D = DATA();
    var pd = D.pets && D.pets[defId];
    return { model: 'skeleton_minion', show: [], scale: 0.58,
             tint: M.elementColor((pd && pd.element) || 'neutro'), pet: true };
  }

  // FUSÃO — sistema, não 15 casos escritos à mão (§4):
  //   corpo = classe de silhueta DOMINANTE (a mais corpulenta das duas)
  //   arma  = adereço-assinatura da OUTRA classe, acoplado ao punho livre
  //   cor   = mistura das duas paletas; aura = mistura dos dois elementos
  //   porte = maior (a unidade soma a vida das duas)
  var BULK = { sumo: 5, curandeira: 4, invocador: 3, bruxo: 3, arqueiro: 2, espadachim: 1 };
  function fusionLook(defId, opts) {
    var pair = String(defId).slice(4).split('+');
    var a = pair[0], b = pair[1];
    var la = classLook(a), lb = classLook(b);
    if (!la && !lb) return null;
    if (!la) { la = lb; a = b; lb = null; }
    var host = a, guest = b;
    if (lb && (BULK[b] || 0) > (BULK[a] || 0)) { host = b; guest = a; }
    var lh = classLook(host), lg = classLook(guest);
    var show = lh.show.slice();
    // a arma do hóspede entra pela mão livre (esquerda); se não der, fica só a cor
    var graft = lg ? { model: lg.model, mesh: lg.weapon, bone: 'handslotl' } : null;
    return {
      model: lh.model, show: show, scale: (lh.scale || 1) * 1.22,
      tint: lh.tint, accent: lg ? lg.tint : lh.accent,
      mixTint: lg ? lg.tint : null, graft: graft, fusion: true,
      hostClass: host, guestClass: guest
    };
  }

  M.lookFor = function (defId, opts) {
    opts = opts || {};
    var id = String(defId || '');
    if (id.indexOf('fus:') === 0) return fusionLook(id, opts);
    if (opts.kind === 'pet') return petLook(id);
    var cl = classLook(opts.classId || id);
    if (cl) {
      return { model: cl.model, show: cl.show.slice(), scale: cl.scale || 1,
               tint: cl.tint, accent: cl.accent, classId: opts.classId || id };
    }
    var D = DATA();
    if (D.pets && D.pets[id]) return petLook(id);
    if (D.monsters && D.monsters[id]) return monsterLook(id);
    return { model: M.MONSTER_FALLBACK.model, show: [], scale: 1,
             tint: M.elementColor(opts.element || 'neutro') };
  };

  // ------------------------------------------------------------------- unidade
  function findBone(root, name) {
    var n = root.getObjectByName(name);
    if (n) return n;
    // GLTFLoader passa os nomes por PropertyBinding.sanitizeNodeName:
    // 'handslot.r' vira 'handslotr'. Tentamos as duas grafias.
    return root.getObjectByName(String(name).replace(/[\.\[\]:\/]/g, '')) || null;
  }
  M.findBone = findBone;

  function meshByName(root, name) {
    var clean = String(name).replace(/[\.\[\]:\/]/g, '');
    var found = null;
    root.traverse(function (n) {
      if (found) return;
      if (n.name === name || n.name === clean) found = n;
    });
    return found;
  }

  // Constrói o objeto visual de uma unidade.
  //   opts: { element, elements:[a,b], boss, kind, classId, scale, look }
  M.unit = function (defId, opts) {
    opts = opts || {};
    if (!ready) return null;
    var look = opts.look || M.lookFor(defId, opts);
    if (!look) return null;
    var src = raw[look.model];
    if (!src) src = raw[M.MONSTER_FALLBACK.model];
    if (!src) return null;

    var group = new THREE.Group();
    group.name = 'unit:' + defId;
    var model = cloneSkinned(src.scene);
    model.position.set(0, 0, 0);
    group.add(model);

    // adereços: só os citados em `show` continuam visíveis
    var showSet = {};
    for (var i = 0; i < (look.show || []).length; i++) showSet[look.show[i]] = true;
    model.traverse(function (n) {
      if (!n.isMesh) return;
      if (n.isSkinnedMesh) return;                  // corpo
      n.visible = !!showSet[n.name];
    });

    // enxerto da fusão: arma-assinatura da outra classe no punho livre
    if (look.graft && look.graft.mesh) {
      var gsrc = raw[look.graft.model];
      if (gsrc) {
        var gm = meshByName(gsrc.scene, look.graft.mesh);
        var bone = findBone(model, look.graft.bone) || findBone(model, 'handslot.l');
        if (gm && bone) {
          var g2 = gm.clone();
          g2.visible = true;
          g2.castShadow = true;
          g2.position.set(0, 0, 0);
          g2.rotation.set(0, 0, 0);
          g2.scale.set(1, 1, 1);
          bone.add(g2);
        }
      }
    }

    // cor: mistura da paleta da classe/elemento + emissivo elemental
    var elems = opts.elements && opts.elements.length ? opts.elements : [opts.element || 'neutro'];
    var eCol = M.elementColor(elems[0]);
    var baseTint = look.tint || eCol;
    var mats = tintMaterials(model, baseTint, look.fusion ? 0.34 : 0.40,
                             eCol, elems[0] === 'neutro' ? 0.05 : 0.16);
    if (look.fusion && look.mixTint) {
      // a fusão puxa metade do caminho para a cor da segunda classe
      var mix = new THREE.Color(hexInt(look.mixTint));
      for (var mi = 0; mi < mats.length; mi++) mats[mi].color.lerp(mix, 0.30);
    }
    if (elems.length > 1) {
      var e2 = new THREE.Color(hexInt(M.elementColor(elems[1])));
      for (var mj = 0; mj < mats.length; mj++) mats[mj].emissive.lerp(e2, 0.5);
    }

    var scale = UNIT_SCALE * (look.scale || 1) * (opts.boss ? 1.35 : 1) * (opts.scale || 1);
    model.scale.setScalar(scale);

    // caixa envolvente (barra de vida, ícones, alvo do FX)
    var box = new THREE.Box3().setFromObject(model);
    var height = Math.max(0.6, (box.max.y - box.min.y) || 1.7);
    var radius = Math.max(0.25, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5);

    var mixer = new THREE.AnimationMixer(model);
    var actions = {};
    var current = null;

    function action(name) {
      if (actions[name]) return actions[name];
      var clip = M.clip(name);
      if (!clip) return null;
      var a = mixer.clipAction(clip);
      actions[name] = a;
      return a;
    }
    function play(name, o) {
      o = o || {};
      var a = action(name);
      if (!a) return null;
      if (current === a && !o.restart) {
        if (o.timeScale != null) a.timeScale = o.timeScale;
        return a;
      }
      a.reset();
      a.timeScale = o.timeScale == null ? 1 : o.timeScale;
      a.setLoop(o.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = o.loop === false;
      a.enabled = true;
      a.setEffectiveWeight(1);
      if (current && current !== a) {
        a.crossFadeFrom(current, o.fade == null ? 0.18 : o.fade, false);
        a.play();
      } else {
        a.fadeIn(o.fade == null ? 0.12 : o.fade);
        a.play();
      }
      current = a;
      return a;
    }
    function stopAll() {
      mixer.stopAllAction();
      current = null;
    }

    group.userData = {
      defId: defId, look: look, model: model, mixer: mixer, actions: actions,
      height: height, radius: radius, scale: scale, tintMats: mats,
      bones: {
        handR: findBone(model, 'handslot.r'),
        handL: findBone(model, 'handslot.l'),
        head: findBone(model, 'head'),
        chest: findBone(model, 'chest')
      },
      play: play, stopAll: stopAll,
      currentName: function () {
        for (var k in actions) if (actions[k] === current) return k;
        return null;
      }
    };
    return group;
  };

  // acopla um adereço (por nome de malha, de qualquer modelo carregado) a um osso
  M.attach = function (group, modelKey, meshName, boneName) {
    var src = raw[modelKey];
    if (!src || !group || !group.userData) return null;
    var mesh = meshByName(src.scene, meshName);
    var bone = findBone(group.userData.model, boneName);
    if (!mesh || !bone) return null;
    var c = mesh.clone();
    c.visible = true; c.castShadow = true;
    bone.add(c);
    return c;
  };

  M.modelKeys = function () { return Object.keys(raw); };
  M.hasModel = function (k) { return !!raw[k]; };

  // --------------------------------------------------------- peças de cenário
  // Geometria procedural: barata, combina com o tom cartoon dos modelos e
  // permite tingir por tema sem baixar mais nada.
  var geoCache = {};
  function geo(key, make) {
    if (!geoCache[key]) geoCache[key] = make();
    return geoCache[key];
  }
  M.geo = geo;

  M.floorGeo = function () {
    return geo('floor', function () { return new THREE.BoxGeometry(M.CELL, 0.4, M.CELL); });
  };
  M.highGeo = function () {
    return geo('high', function () { return new THREE.BoxGeometry(M.CELL * 0.96, M.CELL * 1.55, M.CELL * 0.96); });
  };
  M.lowGeo = function () {
    return geo('low', function () { return new THREE.BoxGeometry(M.CELL * 0.94, M.CELL * 0.46, M.CELL * 0.94); });
  };
  M.lowTopGeo = function () {
    return geo('lowtop', function () { return new THREE.BoxGeometry(M.CELL * 0.98, M.CELL * 0.30, M.CELL * 0.98); });
  };
  M.tileFlatGeo = function () {
    return geo('flat', function () {
      var g = new THREE.PlaneGeometry(M.CELL, M.CELL);
      g.rotateX(-Math.PI / 2);
      return g;
    });
  };

  M.dispose = function (root) {
    if (!root) return;
    root.traverse(function (n) {
      if (n.geometry && !n.__shared) n.geometry.dispose();
      var mats = Array.isArray(n.material) ? n.material : (n.material ? [n.material] : []);
      for (var i = 0; i < mats.length; i++) {
        if (mats[i].map && mats[i].map.__shared !== true) { /* textura compartilhada: não descartar */ }
        mats[i].dispose();
      }
    });
  };
})();
