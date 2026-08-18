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
//   2. mantém UM banco de animações do KayKit (os 9 personagens dividem o mesmo
//      esqueleto de 41 ossos, então 30 clipes servem para todos) e usa os
//      clipes PRÓPRIOS de cada criatura Quaternius;
//   3. traduz AÇÕES LÓGICAS ('idle','walk','attack','cast','hit','die'…) para o
//      clipe certo de cada modelo — o renderizador nunca cita nome de clipe;
//   4. clona modelos com esqueleto (SkeletonUtils.clone reimplementado — o
//      vendor não traz o utilitário) e tinge o material por classe/elemento;
//   5. resolve `defId -> aparência`: 6 classes, 66 monstros (por família, com
//      exceções por id), 6 chefes, 6 pets e as 15 FUSÕES;
//   6. gera RETRATOS a partir dos próprios modelos (cena offscreen, luz de três
//      pontos) — a HUD ganha retrato de tudo sem arte manual.
//
// API:
//   Models3D2.CELL · load(cb) · isReady()
//   Models3D2.unit(defId, opts) -> THREE.Group        (opts: element, elements, boss, kind, classId)
//   Models3D2.lookFor(defId, opts) -> descrição da aparência
//   Models3D2.portrait(defId, opts) -> HTMLCanvasElement (cacheado)
//   Models3D2.elementColor(e) · attach(group, modelKey, meshName, boneName)
//
// Cada grupo devolvido por `unit` traz em `userData`:
//   { model, mixer, height, radius, bones:{handR,handL,head,chest},
//     play(acao, opts), has(acao), tintMats[], look, procAnimate(st,t,dt) }
// ============================================================================

(function () {
  'use strict';
  if (typeof THREE === 'undefined') {
    if (typeof console !== 'undefined') console.error('[Models3D2] THREE ausente');
    return;
  }

  var M = {};
  JOGO.Models3D2 = M;

  M.CELL = 2.0;
  var UNIT_SCALE = 0.92;

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
  // three r147 roda em legacyMode: o material do glTF guarda cor LINEAR, mas
  // um hex escrito a mao esta em sRGB. Sem converter, tudo sai lavado.
  function col3(c) { return new THREE.Color(hexInt(c)).convertSRGBToLinear(); }
  M.col3 = col3;
  function hashStr(s) {
    var h = 2166136261; s = String(s || '');
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  M.hashStr = hashStr;
  function DATA() { return JOGO.DATA || {}; }

  // ============================================================ AÇÕES LÓGICAS
  // O renderizador pede 'attack'; aqui decidimos qual dos 76–95 clipes do
  // KayKit (ou dos 3–13 do Quaternius) responde por isso naquele modelo.
  var KAYKIT_ACTIONS = {
    idle: 'Idle', walk: 'Walking_A', run: 'Running_A',
    attack: '1H_Melee_Attack_Slice_Diagonal', attackAlt: '1H_Melee_Attack_Chop',
    attack2h: '2H_Melee_Attack_Chop', attackSpin: '2H_Melee_Attack_Spin',
    shoot: '1H_Ranged_Shoot', aim: '1H_Ranged_Aiming',
    cast: 'Spellcast_Shoot', castRaise: 'Spellcast_Raise',
    castLoop: 'Spellcasting', castLong: 'Spellcast_Long', summon: 'Spellcast_Summon',
    hit: 'Hit_A', die: 'Death_A', diePose: 'Death_A_Pose',
    cheer: 'Cheer', taunt: 'Taunt', block: 'Block', blocking: 'Blocking',
    dodge: 'Dodge_Backward', punch: 'Unarmed_Melee_Attack_Punch_A',
    throw: 'Throw', use: 'Use_Item', interact: 'Interact',
    jump: 'Jump_Full_Short', pickup: 'PickUp',
    spawn: 'Spawn_Ground', awaken: 'Skeletons_Awaken_Standing'
  };
  // fallback: se a ação não existir no modelo, tenta esta cadeia
  var ACTION_FALLBACK = {
    run: ['walk', 'idle'], walk: ['run', 'idle'],
    attackAlt: ['attack'], attack2h: ['attack'], attackSpin: ['attack2h', 'attack'],
    shoot: ['attack'], aim: ['idle'],
    cast: ['attack'], castRaise: ['cast', 'attack'], castLoop: ['idle'],
    castLong: ['castLoop', 'cast'], summon: ['cast'],
    hit: ['idle'], die: ['idle'], diePose: ['die'],
    cheer: ['idle'], taunt: ['idle'], block: ['idle'], blocking: ['idle'],
    dodge: ['jump', 'idle'], punch: ['attack'], throw: ['attack'],
    use: ['interact', 'idle'], interact: ['idle'], jump: ['idle'],
    pickup: ['interact', 'idle'], spawn: ['jump', 'idle'], awaken: ['idle']
  };

  // criaturas Quaternius: cada GLB traz os próprios clipes ('RatArmature|Rat_Run')
  function autoActions(clipNames) {
    var out = {};
    function pick(re, key) {
      if (out[key]) return;
      for (var i = 0; i < clipNames.length; i++) if (re.test(clipNames[i])) { out[key] = clipNames[i]; return; }
    }
    pick(/Idle$|Idle_2$|Flying$/i, 'idle');
    pick(/Walk$/i, 'walk');
    pick(/Run$|Gallop$/i, 'run');
    pick(/Attack$/i, 'attack');
    pick(/Death$/i, 'die');
    pick(/Jump$|Jump_ToIdle$/i, 'jump');
    pick(/HitReact/i, 'hit');
    pick(/Eating$|Idle_2/i, 'interact');
    if (!out.idle && clipNames.length) out.idle = clipNames[0];
    if (out.attack) { out.cast = out.attack; out.shoot = out.attack; out.punch = out.attack; }
    if (out.jump && !out.dodge) out.dodge = out.jump;
    return out;
  }

  // ---------------------------------------------------------------- APARÊNCIA
  // NOTA DE CONCEITO: as aparências mudaram para caber no acervo CC0. A
  // identidade TÁTICA de cada classe está preservada; o visual é novo.
  M.CLASS_LOOK = {
    sumo: { model: 'barbarian', show: ['2H_Axe', 'Barbarian_Cape'],
            scale: 1.16, tint: '#d4553f', accent: '#ffd08a', weapon: '2H_Axe',
            concept: 'Bárbaro corpulento de machado de duas mãos e capa' },
    arqueiro: { model: 'rogue_hooded', show: ['2H_Crossbow', 'Rogue_Cape'],
            scale: 1.00, tint: '#4f9d6a', accent: '#d8f0a0', weapon: '2H_Crossbow',
            concept: 'Batedor encapuzado de besta de duas mãos' },
    bruxo: { model: 'mage', show: ['2H_Staff', 'Mage_Hat', 'Mage_Cape'],
            scale: 1.02, tint: '#7a5fa0', accent: '#b98cff', weapon: '2H_Staff',
            concept: 'Mago de chapéu pontudo e cajado' },
    espadachim: { model: 'rogue', show: ['Knife', 'Knife_Offhand'],
            scale: 0.97, tint: '#2f6f8f', accent: '#9be8ff', weapon: 'Knife',
            concept: 'Ladino ágil de adagas gêmeas' },
    curandeira: { model: 'knight', show: ['1H_Sword', 'Badge_Shield', 'Knight_Cape'],
            scale: 1.00, tint: '#f0c05a', accent: '#fff2c2', weapon: '1H_Sword',
            concept: 'Paladina de armadura clara e escudo de brasão' },
    invocador: { model: 'mage', show: ['Spellbook_open', '1H_Wand', 'Mage_Cape'],
            scale: 1.00, tint: '#3f8f8a', accent: '#8ff0d8', weapon: '1H_Wand',
            concept: 'Xamã de grimório aberto e varinha, sem chapéu' }
  };

  // Monstros — 3 fontes, escolhidas por id/família:
  //   1. `proc:true` → modelo procedural da camada v1 (js/render3d/models3d.js),
  //      feito sob medida para ESTE bestiário (flora, corte afogada, fornalha);
  //   2. esqueletos KayKit (mesma família visual dos heróis) para humanoides;
  //   3. criaturas Quaternius (CC0, animadas) para bichos.
  var MONSTER_LOOK = {
    // --- Flora Voraz (Estufa) - trepadeiras, esporos e carrapichos
    'thorn-lasher':   { model: 'q_snake',        scale: 1.00 },
    'pollen-puff':    { model: 'q_frog',         scale: 0.85 },
    'burr-mother':    { model: 'q_spider',       scale: 1.05 },
    'sap-shaman':     { model: 'skeleton_mage',  show: ['Skeleton_Staff'], scale: 1.00 },
    'sprout-feral':   { model: 'q_frog',         scale: 0.78 },
    'burrlet':        { model: 'q_spider',       scale: 0.58 },
    'boss-gardener':  { model: 'q_stag',         scale: 1.25 },
    // --- Enxame da Estufa
    'lantern-wasp':   { model: 'q_wasp',         scale: 0.95 },
    'dew-strider':    { model: 'q_spider',       scale: 0.85 },
    // --- Corte Afogada (Cisterna)
    'drowned-porter': { model: 'skeleton_warrior', show: ['Skeleton_Blade'], scale: 1.05 },
    'moray-piper':    { model: 'q_snake',        scale: 1.10 },
    'lantern-jelly':  { model: 'q_frog',         scale: 0.92 },
    'brine-golem':    { model: 'skeleton_warrior', show: ['Skeleton_Shield_Large_A'], scale: 1.30 },
    'fat-drop':       { model: 'q_frog',         scale: 0.95 },
    'droplet':        { model: 'q_frog',         scale: 0.55 },
    'sump-crab':      { model: 'q_spider',       scale: 0.95 },
    'mist-warbler':   { model: 'q_wasp',         scale: 0.80 },
    'boss-baroness':  { model: 'skeleton_mage',  show: ['Skeleton_Staff'], scale: 1.45 },
    // --- Prole da Fornalha (Fecho de Brasa)
    'ember-imp':      { model: 'skeleton_minion', scale: 0.82 },
    'walking-anvil':  { model: 'q_bull',         scale: 1.05 },
    'ash-wraith':     { model: 'skeleton_mage',  scale: 1.00 },
    'slag-mound':     { model: 'q_frog',         scale: 1.05 },
    'faceless-smith': { model: 'skeleton_warrior', show: ['Skeleton_Axe'], scale: 1.15 },
    'quench-hound':   { model: 'q_wolf',         scale: 0.85 },
    'chain-hauler':   { model: 'skeleton_warrior', show: ['Skeleton_Axe'], scale: 1.20 },
    'spark-whelp':    { model: 'q_velociraptor', scale: 0.70 },
    'slag-bit':       { model: 'q_frog',         scale: 0.50 },
    'boss-heartforge':{ model: 'q_trex',         scale: 1.30 },
    // --- Coro dos Andaimes (Andaimes do Vento)
    'plank-shrike':   { model: 'q_wasp',         scale: 0.95 },
    'gust-gremlin':   { model: 'skeleton_minion', scale: 0.85 },
    'rope-hanger':    { model: 'skeleton_rogue', scale: 1.00 },
    'kite-serpent':   { model: 'q_snake',        scale: 1.15 },
    'ballast-golem':  { model: 'skeleton_warrior', show: ['Skeleton_Shield_Large_B'], scale: 1.30 },
    'whistle-choir':  { model: 'skeleton_mage',  show: ['Skeleton_Staff'], scale: 1.00 },
    'mote-swarm':     { model: 'q_wasp',         scale: 0.70 },
    'mote-bit':       { model: 'q_wasp',         scale: 0.50 },
    'nail-sprite':    { model: 'q_wasp',         scale: 0.60 },
    'boss-windwright':{ model: 'skeleton_warrior', show: ['Skeleton_Axe', 'Skeleton_Shield_Large_A'], scale: 1.55 },
    // --- Turno da Noite (Mina Tremula)
    'pick-revenant':  { model: 'skeleton_warrior', show: ['Skeleton_Axe'], scale: 1.00 },
    'firedamp-wisp':  { model: 'q_wasp',         scale: 0.70 },
    'cave-jaw':       { model: 'q_velociraptor', scale: 0.90 },
    'crystal-chanter':{ model: 'skeleton_mage',  show: ['Skeleton_Staff'], scale: 1.05 },
    'sinkhole-worm':  { model: 'q_snake',        scale: 1.30 },
    'ore-tumbler':    { model: 'q_frog',         scale: 0.90 },
    'ore-chip':       { model: 'q_frog',         scale: 0.55 },
    'shaft-bat':      { model: 'q_wasp',         scale: 0.75 },
    'damp-seeper':    { model: 'q_frog',         scale: 0.80 },
    'boss-deepknock': { model: 'q_triceratops',  scale: 1.30 },
    // --- Guarda do Coracao (Coracao Partido)
    'cinder-herald':  { model: 'skeleton_warrior', show: ['Skeleton_Blade'], scale: 1.10 },
    'tide-herald':    { model: 'skeleton_mage',  show: ['Skeleton_Staff'], scale: 1.10 },
    'stone-herald':   { model: 'skeleton_warrior', show: ['Skeleton_Shield_Large_A'], scale: 1.15 },
    'gale-herald':    { model: 'skeleton_rogue', show: ['Skeleton_Crossbow'], scale: 1.05 },
    'null-warden':    { model: 'skeleton_warrior', show: ['Skeleton_Shield_Small_A', 'Skeleton_Blade'], scale: 1.20 },
    'mirror-twin':    { model: 'skeleton_rogue', scale: 1.00 },
    'mirror-sliver':  { model: 'skeleton_rogue', scale: 0.70 },
    'weather-mote':   { model: 'q_wasp',         scale: 0.60 },
    'heartroot':      { model: 'q_snake',        scale: 1.00 },
    'boss-riftheart': { model: 'q_trex',         scale: 1.45 },
    // --- Rebanho do Invocador (invocacoes)
    'sporeling':          { model: 'q_frog',   scale: 0.62 },
    'sum-familiar':       { model: 'q_fox',    scale: 0.72 },
    'sum-ember-hound':    { model: 'q_wolf',   scale: 0.85 },
    'sum-magma-colossus': { model: 'q_bull',   scale: 1.30 },
    'sum-tide-nymph':     { model: 'skeleton_mage', scale: 1.00 },
    'sum-stone-sentinel': { model: 'skeleton_warrior', show: ['Skeleton_Shield_Large_A'], scale: 1.15 },
    'sum-mountain-golem': { model: 'q_bull',   scale: 1.55 },
    'sum-storm-falcon':   { model: 'q_wasp',   scale: 0.90 }
  };

  // Familias: rede de seguranca quando um id novo aparecer nos dados.
  M.FAMILY_LOOK = {
    'Flora Voraz':          { model: 'q_spider',         scale: 0.95 },
    'Enxame da Estufa':     { model: 'q_wasp',           scale: 0.85 },
    'Corte Afogada':        { model: 'skeleton_mage',    scale: 1.00 },
    'Prole da Fornalha':    { model: 'skeleton_warrior', scale: 1.00 },
    'Coro dos Andaimes':    { model: 'skeleton_rogue',   scale: 1.00 },
    'Turno da Noite':       { model: 'skeleton_minion',  scale: 1.00 },
    'Guarda do Coração':    { model: 'skeleton_warrior', scale: 1.10 },
    'Rebanho do Invocador': { model: 'skeleton_minion',  scale: 0.90 }
  };
  M.MONSTER_FALLBACK = { model: 'skeleton_minion', scale: 1.0 };

  M.PET_LOOK = {
    'pet-emberling': { model: 'q_velociraptor', scale: 0.86 },
    'pet-snapvine': { model: 'q_snake', scale: 0.95 },
    'pet-galehawk': { model: 'q_wasp', scale: 0.90 },
    'pet-dewling': { model: 'q_frog', scale: 0.88 },
    'pet-lodestone': { model: 'q_spider', scale: 0.84 },
    'pet-heartshard': { model: 'q_fox', scale: 0.88 }
  };

  // ------------------------------------------------------------ decodificação
  var raw = {};            // chave -> {scene, clips:{nome->clip}, actions:{acao->nome}, kind}
  var bankClips = {};      // nome -> AnimationClip (banco KayKit)
  var loading = false, ready = false, failed = false;
  var waiters = [];

  function b64ToArrayBuffer(b64) {
    var bin = atob(b64), len = bin.length;
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
    if (!keys.length) { finish(new Error('JOGO.MODELS vazio: inclua assets/embedded/models-*.js')); return; }
    if (typeof THREE.GLTFLoader !== 'function') { finish(new Error('THREE.GLTFLoader ausente')); return; }

    var loader = new THREE.GLTFLoader();
    var pending = keys.length, firstErr = null;
    keys.forEach(function (key) {
      var ab;
      try { ab = b64ToArrayBuffer(src[key]); }
      catch (e) { firstErr = firstErr || e; step(); return; }
      try {
        loader.parse(ab, '', function (gltf) {
          if (key === '_anims') {
            for (var i = 0; i < gltf.animations.length; i++) bankClips[gltf.animations[i].name] = gltf.animations[i];
          } else {
            prepScene(gltf.scene);
            var clips = {}, names = [];
            for (var j = 0; j < (gltf.animations || []).length; j++) {
              clips[gltf.animations[j].name] = gltf.animations[j];
              names.push(gltf.animations[j].name);
            }
            raw[key] = {
              scene: gltf.scene, clips: clips,
              actions: names.length ? autoActions(names) : null,   // null = usa o banco KayKit
              own: names.length > 0,
              natural: naturalHeight(gltf.scene)
            };
          }
          step();
        }, function (err) { firstErr = firstErr || err; step(); });
      } catch (e2) { firstErr = firstErr || e2; step(); }
    });

    function step() { if (--pending <= 0) finish(firstErr); }
    function finish(err) {
      ready = true; loading = false;
      failed = !!err && !Object.keys(raw).length;
      var q = waiters.slice(); waiters.length = 0;
      for (var i = 0; i < q.length; i++) { try { q[i](err); } catch (e) {} }
    }
  };

  // altura natural do modelo (para normalizar o porte entre acervos diferentes)
  function naturalHeight(scene) {
    scene.updateMatrixWorld(true);
    var box = new THREE.Box3(), tmp = new THREE.Box3(), found = false;
    scene.traverse(function (n) {
      if (!n.isSkinnedMesh || !n.geometry) return;
      if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
      tmp.copy(n.geometry.boundingBox).applyMatrix4(n.matrixWorld);
      if (!found) { box.copy(tmp); found = true; } else box.union(tmp);
    });
    if (!found) box.setFromObject(scene);
    var h = box.max.y - box.min.y;
    return (isFinite(h) && h > 0.01) ? h : 1.8;
  }

  function prepScene(scene) {
    scene.traverse(function (n) {
      if (!n.isMesh && !n.isSkinnedMesh) return;
      n.castShadow = true; n.receiveShadow = true;
      n.frustumCulled = false;
      var mats = Array.isArray(n.material) ? n.material : [n.material];
      for (var i = 0; i < mats.length; i++) {
        var m = mats[i];
        if (!m) continue;
        if (m.map) { m.map.magFilter = THREE.NearestFilter; m.map.minFilter = THREE.LinearMipmapLinearFilter; }
        m.roughness = 0.84; m.metalness = 0.02;
      }
    });
  }

  M.clipNames = function (key) {
    if (key && raw[key] && raw[key].own) return Object.keys(raw[key].clips);
    return Object.keys(bankClips);
  };
  M.modelKeys = function () { return Object.keys(raw); };
  M.hasModel = function (k) { return !!raw[k]; };
  M.clips = function () { var o = []; for (var k in bankClips) o.push(bankClips[k]); return o; };

  // --------------------------------------------------------- clone esqueletal
  function cloneSkinned(source) {
    var srcLookup = new Map(), cloneLookup = new Map();
    var clone = source.clone();
    parallelTraverse(source, clone, function (a, b) { srcLookup.set(b, a); cloneLookup.set(a, b); });
    clone.traverse(function (node) {
      if (!node.isSkinnedMesh) return;
      var srcMesh = srcLookup.get(node);
      var srcBones = srcMesh.skeleton.bones;
      node.skeleton = srcMesh.skeleton.clone();
      node.bindMatrix.copy(srcMesh.bindMatrix);
      node.skeleton.bones = srcBones.map(function (b) { return cloneLookup.get(b); });
      node.bind(node.skeleton, node.bindMatrix);
    });
    return clone;
  }
  function parallelTraverse(a, b, cb) {
    cb(a, b);
    for (var i = 0; i < a.children.length; i++) parallelTraverse(a.children[i], b.children[i], cb);
  }
  M.cloneSkinned = cloneSkinned;

  // ------------------------------------------------------------- tint/material
  function tintMaterials(root, color, strength, emissive, emiI) {
    var out = [];
    var col = col3(color);
    root.traverse(function (n) {
      if (!n.isMesh && !n.isSkinnedMesh) return;
      var mats = Array.isArray(n.material) ? n.material : [n.material];
      var cloned = [];
      for (var i = 0; i < mats.length; i++) {
        var m = mats[i];
        if (!m) { cloned.push(m); continue; }
        var c = m.clone();
        c.color = c.color ? c.color.clone() : new THREE.Color(0xffffff);
        c.color.lerp(col, strength == null ? 0.45 : strength);
        if (emissive != null) {
          c.emissive = col3(emissive);
          c.emissiveIntensity = emiI == null ? 0.10 : emiI;
          c.__baseEmiI = c.emissiveIntensity;
          c.__baseEmiHex = c.emissive.getHex();
        }
        c.__baseOpacity = c.opacity != null ? c.opacity : 1;
        cloned.push(c); out.push(c);
      }
      n.material = Array.isArray(n.material) ? cloned : cloned[0];
    });
    return out;
  }
  M.tintMaterials = tintMaterials;

  // ------------------------------------------------------- resolução de aparência
  var BULK = { sumo: 5, curandeira: 4, invocador: 3, bruxo: 3, arqueiro: 2, espadachim: 1 };

  function classLook(classId) { return M.CLASS_LOOK[classId] || null; }

  // FUSÃO — SISTEMA, não 15 casos escritos à mão (§4):
  //   corpo = classe de silhueta dominante · arma = adereço-assinatura da outra
  //   cor   = mistura das duas paletas · aura = mistura dos dois elementos
  //   porte = maior (a unidade soma a vida das duas)
  function fusionLook(defId) {
    var pair = String(defId).slice(4).split('+');
    var a = pair[0], b = pair[1];
    var la = classLook(a), lb = classLook(b);
    if (!la && !lb) return null;
    if (!la) { la = lb; a = b; lb = null; }
    var host = a, guest = b;
    if (lb && (BULK[b] || 0) > (BULK[a] || 0)) { host = b; guest = a; }
    var lh = classLook(host), lg = classLook(guest);
    return {
      model: lh.model, show: lh.show.slice(), scale: 1.26,
      tint: lh.tint, accent: lg ? lg.accent : lh.accent,
      mixTint: lg ? lg.tint : null,
      graft: lg ? { model: lg.model, mesh: lg.weapon, bone: 'handslot.l' } : null,
      fusion: true, hostClass: host, guestClass: guest,
      concept: lg ? (lh.concept + ' + ' + lg.weapon) : lh.concept
    };
  }

  function monsterLook(defId) {
    var D = DATA();
    var md = (D.monsters && D.monsters[defId]) || null;
    var base = MONSTER_LOOK[defId] ||
               (md && md.family && M.FAMILY_LOOK[md.family]) ||
               M.MONSTER_FALLBACK;
    var boss = !!(md && md.boss);
    return {
      model: base.model, show: (base.show || []).slice(),
      proc: !!base.proc, procId: defId,
      scale: (base.scale || 1),          // o porte de chefe ja vem da altura-alvo
      tint: M.elementColor((md && md.element) || 'neutro'),
      accent: M.elementColor((md && md.element) || 'neutro'),
      family: md && md.family, boss: boss
    };
  }
  function petLook(defId) {
    var D = DATA();
    var pd = (D.pets && D.pets[defId]) || null;
    var base = M.PET_LOOK[defId] || { model: 'q_fox', scale: 0.55 };
    return {
      model: base.model, show: [], scale: base.scale || 0.55,
      tint: M.elementColor((pd && pd.element) || 'neutro'), pet: true
    };
  }

  M.lookFor = function (defId, opts) {
    opts = opts || {};
    var id = String(defId || '');
    if (id.indexOf('fus:') === 0) return fusionLook(id);
    var cl = classLook(opts.classId || id);
    if (cl) {
      return { model: cl.model, show: cl.show.slice(), scale: cl.scale || 1,
               tint: cl.tint, accent: cl.accent, weapon: cl.weapon,
               classId: opts.classId || id, concept: cl.concept };
    }
    var D = DATA();
    if (opts.kind === 'pet' || (D.pets && D.pets[id])) return petLook(id);
    return monsterLook(id);
  };

  // ------------------------------------------------------------------- unidade
  function sanit(name) { return String(name).replace(/[\.\[\]:\/]/g, ''); }
  function findBone(root, name) {
    return root.getObjectByName(name) || root.getObjectByName(sanit(name)) || null;
  }
  M.findBone = findBone;
  function meshByName(root, name) {
    var clean = sanit(name), found = null;
    root.traverse(function (n) { if (!found && (n.name === name || n.name === clean)) found = n; });
    return found;
  }
  function visibleBodyBox(root) {
    root.updateMatrixWorld(true);
    var box = new THREE.Box3(), tmp = new THREE.Box3(), found = false;
    root.traverse(function (n) {
      if (!n.isSkinnedMesh || !n.visible || !n.geometry) return;
      if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
      tmp.copy(n.geometry.boundingBox).applyMatrix4(n.matrixWorld);
      if (!found) { box.copy(tmp); found = true; } else box.union(tmp);
    });
    if (!found) box.setFromObject(root);
    return box;
  }

  // modelo procedural da camada v1 (bestiário desenhado para o SOTERRA)
  function procUnit(defId, look, opts) {
    var V1 = JOGO.Models3D;
    if (!V1 || !V1.isReady || !V1.isReady() || !V1.buildUnit) return null;
    var ids = V1.unitIds ? V1.unitIds() : [];
    if (ids.indexOf(defId) < 0) return null;
    var built;
    try { built = V1.buildUnit(defId); } catch (e) { return null; }
    if (!built || !built.group) return null;
    var group = new THREE.Group();
    group.name = 'unit:' + defId;
    group.add(built.group);
    var scale = (look.scale || 1) * (opts.boss ? 1.15 : 1);
    built.group.scale.setScalar(scale);
    var box = new THREE.Box3().setFromObject(built.group);
    var height = Math.max(0.7, box.max.y - box.min.y);
    var radius = Math.max(0.25, Math.min(1.1, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.4));
    group.userData = {
      defId: defId, look: look, model: built.group, mixer: null, proc: built,
      height: height, radius: radius, scale: scale, tintMats: null,
      bones: {}, procState: { moving: 0, castK: 0, flash: 0, deathK: 0, invis: false },
      play: function () { return null; }, has: function () { return true; },
      currentName: function () { return null; },
      procAnimate: function (st, t, dt) { try { built.animate(st, t, dt); } catch (e) {} }
    };
    return group;
  }

  M.unit = function (defId, opts) {
    opts = opts || {};
    if (!ready) return null;
    var look = opts.look || M.lookFor(defId, opts);
    if (!look) return null;

    if (look.proc) {
      var pu = procUnit(look.procId || defId, look, opts);
      if (pu) return pu;
    }

    var src = raw[look.model] || raw[M.MONSTER_FALLBACK.model];
    if (!src) return null;

    var group = new THREE.Group();
    group.name = 'unit:' + defId;
    var model = cloneSkinned(src.scene);
    group.add(model);

    // adereços: só os citados em `show` ficam visíveis (o corpo é skinned)
    if (!src.own) {
      var showSet = {};
      for (var i = 0; i < (look.show || []).length; i++) showSet[look.show[i]] = true;
      model.traverse(function (n) {
        if (!n.isMesh || n.isSkinnedMesh) return;
        n.visible = !!showSet[n.name];
      });
    }

    // ENXERTO DA FUSÃO: a arma-assinatura da outra classe entra no punho livre
    if (look.graft && look.graft.mesh) {
      var gsrc = raw[look.graft.model];
      if (gsrc) {
        var gm = meshByName(gsrc.scene, look.graft.mesh);
        var bone = findBone(model, look.graft.bone) || findBone(model, 'handslot.l');
        if (gm && bone) {
          var g2 = gm.clone();
          g2.visible = true; g2.castShadow = true;
          g2.position.set(0, 0, 0); g2.rotation.set(0, 0, 0); g2.scale.set(1, 1, 1);
          bone.add(g2);
          group.userData_graft = g2;
        }
      }
    }

    var elems = (opts.elements && opts.elements.length) ? opts.elements : [opts.element || 'neutro'];
    var eCol = M.elementColor(elems[0]);
    var baseTint = look.tint || eCol;
    // O material do KayKit nao tem baseColorFactor: TODA a cor vem do atlas de
    // textura. Tingir forte multiplica o atlas por uma cor chapada e lava o
    // desenho. Heroi recebe so um verniz (a identidade vem do anel e da aura);
    // monstro recebe mais, porque a leitura do ELEMENTO e tatica.
    var strength = look.classId ? 0.30 : (look.fusion ? 0.42 : 0.52);
    var mats = tintMaterials(model, baseTint, strength,
                             eCol, elems[0] === 'neutro' ? 0.03 : 0.08);
    if (look.fusion && look.mixTint) {
      var mix = col3(look.mixTint);
      for (var mi = 0; mi < mats.length; mi++) mats[mi].color.lerp(mix, 0.28);
    }
    if (elems.length > 1) {
      var e2 = col3(M.elementColor(elems[1]));
      for (var mj = 0; mj < mats.length; mj++) {
        mats[mj].emissive.lerp(e2, 0.5);
        mats[mj].emissiveIntensity = 0.16;
        mats[mj].__baseEmiI = 0.16;
      }
    }

    // PORTE NORMALIZADO: cada acervo nasce numa escala diferente; medimos a
    // altura natural e ajustamos para a altura-alvo do papel. Assim um lobo do
    // Quaternius e um esqueleto do KayKit convivem sem um virar brinquedo.
    var targetH = look.classId ? 2.05 : (look.pet ? 1.20 : (look.fusion ? 2.55 : 1.80));
    if (opts.boss || look.boss) targetH = 2.95;
    var natural = src.natural || 1.8;
    var scale = (targetH / natural) * (look.scale || 1) * (opts.scale || 1);
    model.scale.setScalar(scale);

    var box = visibleBodyBox(model);
    var height = Math.max(0.6, (box.max.y - box.min.y) || 1.7);
    var radius = Math.max(0.22, Math.min(1.2,
      Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * (src.own ? 0.5 : 0.34)));

    // ------------------------------------------------------------- animação
    var mixer = new THREE.AnimationMixer(model);
    var actionMap = src.own ? src.actions : KAYKIT_ACTIONS;
    var clipSrc = src.own ? src.clips : bankClips;
    var cache = {}, current = null, currentAct = '';

    function resolve(name, depth) {
      if (depth > 4) return null;
      var clipName = actionMap[name];
      if (clipName && clipSrc[clipName]) return clipSrc[clipName];
      var fb = ACTION_FALLBACK[name];
      for (var i = 0; fb && i < fb.length; i++) {
        var r = resolve(fb[i], (depth || 0) + 1);
        if (r) return r;
      }
      if (name !== 'idle') return resolve('idle', 5);
      return null;
    }
    function action(name) {
      if (cache[name] !== undefined) return cache[name];
      var clip = resolve(name, 0);
      cache[name] = clip ? mixer.clipAction(clip) : null;
      return cache[name];
    }
    function has(name) {
      var clipName = actionMap[name];
      return !!(clipName && clipSrc[clipName]);
    }
    function play(name, o) {
      o = o || {};
      var a = action(name);
      if (!a) return null;
      if (current === a && !o.restart) {
        if (o.timeScale != null) a.timeScale = o.timeScale;
        currentAct = name;
        return a;
      }
      a.reset();
      a.timeScale = o.timeScale == null ? 1 : o.timeScale;
      a.setLoop(o.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = o.loop === false;
      a.enabled = true;
      a.setEffectiveWeight(1);
      if (current && current !== a) { a.crossFadeFrom(current, o.fade == null ? 0.16 : o.fade, false); a.play(); }
      else { a.fadeIn(o.fade == null ? 0.10 : o.fade); a.play(); }
      current = a; currentAct = name;
      return a;
    }

    group.userData = {
      defId: defId, look: look, model: model, mixer: mixer,
      height: height, radius: radius, scale: scale, tintMats: mats,
      own: src.own,
      bones: {
        handR: findBone(model, 'handslot.r'), handL: findBone(model, 'handslot.l'),
        head: findBone(model, 'head'), chest: findBone(model, 'chest')
      },
      play: play, has: has,
      currentName: function () { return currentAct; },
      stopAll: function () { mixer.stopAllAction(); current = null; }
    };
    group.userData.play('idle', { fade: 0 });
    return group;
  };

  M.attach = function (group, modelKey, meshName, boneName) {
    var src = raw[modelKey];
    if (!src || !group || !group.userData || !group.userData.model) return null;
    var mesh = meshByName(src.scene, meshName);
    var bone = findBone(group.userData.model, boneName);
    if (!mesh || !bone) return null;
    var c = mesh.clone();
    c.visible = true; c.castShadow = true;
    bone.add(c);
    return c;
  };

  // ================================================================ RETRATOS
  // Cena offscreen com luz de três pontos e fundo em gradiente do elemento.
  // Serve retrato para TUDO (6 classes, 66 monstros, 6 chefes, 6 pets, 15
  // fusões) com consistência de estilo e sem arte manual.
  var portCache = {}, portRenderer = null, portScene = null, portCam = null;
  function portraitRig(size) {
    if (portRenderer) return;
    portRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    portRenderer.setSize(size, size, false);
    portRenderer.setPixelRatio(1);
    if (THREE.sRGBEncoding != null) portRenderer.outputEncoding = THREE.sRGBEncoding;
    portRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    portRenderer.toneMappingExposure = 1.05;
    portScene = new THREE.Scene();
    portCam = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
    var key = new THREE.DirectionalLight(0xfff0d0, 2.1); key.position.set(2.4, 2.6, 3.2);
    var fill = new THREE.DirectionalLight(0x9ec8ff, 0.85); fill.position.set(-3.0, 0.9, 1.6);
    var rim = new THREE.DirectionalLight(0xffffff, 1.7); rim.position.set(-1.2, 2.2, -3.4);
    portScene.add(key, fill, rim, new THREE.AmbientLight(0xffffff, 0.28));
  }
  function gradientBg(cv, colorA, colorB) {
    var c = cv.getContext('2d'), s = cv.width;
    var g = c.createRadialGradient(s * 0.5, s * 0.38, s * 0.06, s * 0.5, s * 0.5, s * 0.72);
    g.addColorStop(0, colorA); g.addColorStop(1, colorB);
    c.fillStyle = g; c.fillRect(0, 0, s, s);
    // vinheta
    var v = c.createRadialGradient(s * 0.5, s * 0.5, s * 0.30, s * 0.5, s * 0.5, s * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = v; c.fillRect(0, 0, s, s);
  }
  function shadeHex(hex, k) {
    var c = new THREE.Color(hexInt(hex));
    c.r = Math.min(1, c.r * k); c.g = Math.min(1, c.g * k); c.b = Math.min(1, c.b * k);
    return '#' + c.getHexString();
  }

  M.portrait = function (defId, opts) {
    opts = opts || {};
    var size = opts.size || 192;
    var key = defId + '|' + (opts.element || '') + '|' + size;
    if (portCache[key]) return portCache[key];
    if (!ready) return null;

    var look = M.lookFor(defId, opts);
    if (!look) return null;
    var node = null;
    try { node = M.unit(defId, { element: opts.element, elements: opts.elements, kind: opts.kind, classId: opts.classId, boss: opts.boss }); }
    catch (e) { node = null; }
    if (!node) return null;

    portraitRig(size);
    portRenderer.setSize(size, size, false);
    portScene.add(node);
    // pose de parado, um quadro à frente para sair do bind pose
    if (node.userData.mixer) { node.userData.play('idle', { fade: 0 }); node.userData.mixer.update(0.6); }
    if (node.userData.procAnimate) node.userData.procAnimate({ moving: 0, castK: 0 }, 0.6, 0.016);
    node.updateMatrixWorld(true);

    var box = new THREE.Box3().setFromObject(node);
    var h = Math.max(0.3, box.max.y - box.min.y);
    // enquadra cabeça e ombros, em 3/4
    var headY = box.min.y + h * (look.pet || (look.model || '').indexOf('q_') === 0 ? 0.62 : 0.82);
    var frame = h * 0.42;
    var dist = frame / Math.tan((portCam.fov * Math.PI / 180) / 2) * 1.05;
    var ang = 0.62;
    portCam.position.set(Math.sin(ang) * dist, headY + frame * 0.22, Math.cos(ang) * dist);
    portCam.lookAt(0, headY, 0);
    portCam.updateProjectionMatrix();

    portRenderer.setClearColor(0x000000, 0);
    portRenderer.clear();
    portRenderer.render(portScene, portCam);

    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var el = (opts.element) || (look.classId ? null : null);
    var base = look.accent || look.tint || '#8a8a92';
    gradientBg(cv, shadeHex(base, 1.15), shadeHex(base, 0.22));
    cv.getContext('2d').drawImage(portRenderer.domElement, 0, 0, size, size);

    portScene.remove(node);
    portCache[key] = cv;
    return cv;
  };
  M.clearPortraits = function () { portCache = {}; };

  // --------------------------------------------------------- peças de cenário
  var geoCache = {};
  function geo(key, make) { if (!geoCache[key]) geoCache[key] = make(); return geoCache[key]; }
  M.geo = geo;
  M.floorGeo = function () { return geo('floor', function () { return new THREE.BoxGeometry(M.CELL, 0.4, M.CELL); }); };
  M.highGeo = function () { return geo('high', function () { return new THREE.BoxGeometry(M.CELL * 0.96, M.CELL * 1.55, M.CELL * 0.96); }); };
  M.lowGeo = function () { return geo('low', function () { return new THREE.BoxGeometry(M.CELL * 0.94, M.CELL * 0.46, M.CELL * 0.94); }); };
  M.lowTopGeo = function () { return geo('lowtop', function () { return new THREE.BoxGeometry(M.CELL * 0.98, M.CELL * 0.30, M.CELL * 0.98); }); };
  M.tileFlatGeo = function () {
    return geo('flat', function () {
      var g = new THREE.PlaneGeometry(M.CELL, M.CELL);
      g.rotateX(-Math.PI / 2);
      return g;
    });
  };
})();
