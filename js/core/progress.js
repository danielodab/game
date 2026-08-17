var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* ============================================================================
 * SOTERRA 2.0 — js/core/progress.js   (dono: Lógica Meta)
 * Progressão persistente: classes desbloqueadas, heróis, XP/níveis, caminho
 * elemental, feitiços, inventário de 4 espaços + pet, cartas de personagem.
 * LEI: docs/CONTRACT_V2.md §3 (progressão), §5 (pets), §8 (itens), §9 (APIs).
 * Nomenclatura: pa = Pontos de Ataque, pp = Pontos de Passos. (`pm` não existe.)
 *
 * ---------------------------------------------------------------------------
 * DECISÕES DE DESIGN (onde o contrato é omisso — todas testadas):
 *
 * [D1] PERSISTÊNCIA. Chave nova `localStorage['soterra-save-v2']`. O save v1
 *      (`soterra-save-v1`) é IGNORADO — nunca lido, nunca migrado e nunca
 *      apagado (a v1 continua jogável). TODO acesso a storage vive em
 *      try/catch: `file://`, modo privado e headless podem negar. Sem storage
 *      o estado vive só em memória e nenhuma API lança exceção por isso.
 *      Save automático em toda mutação; `load()` nunca grava.
 *
 * [D2] SAVE CORROMPIDO NUNCA QUEBRA O JOGO. `load()` passa o JSON por um
 *      saneador (`sanitize`) que reconstrói campo a campo: tipo errado, classe
 *      inexistente, item/pet fora de DATA, elemento inválido, slot trocado, XP
 *      negativo — tudo é descartado e substituído pelo padrão. Se sobrar lixo
 *      irrecuperável, cai em `freshState()`.
 *
 * [D3] HERÓI = UMA FICHA POR CLASSE. O contrato não diz de onde vem o
 *      `heroId`; adotamos `heroId === classId` para a ficha padrão, criada
 *      automaticamente quando a classe é desbloqueada (as 2 com
 *      `startsUnlocked` já nascem com ficha). `createHero(classId, heroId)`
 *      permite fichas extras da mesma classe ('bruxo#2') se a UI quiser.
 *
 * [D4] `hero.spells` é CACHE. A fonte da verdade é `spellsFor(heroId)`
 *      (3 base + caminho liberado + `grantsSpell` do item especial); o cache é
 *      regravado a cada mutação para o save e a UI lerem sem recalcular.
 *
 * [D5] NÍVEL DO FEITIÇO DE CAMINHO. Usa `DATA.spells[id].unlockLevel` quando
 *      existir e for > 0; senão cai em `DATA.unlockTiers[i]` (posição do
 *      feitiço no caminho). Assim a progressão funciona mesmo com spells.js
 *      ainda incompleto (trabalho paralelo do Criativo).
 *
 * [D6] ELEMENTO. Todo herói nasce 'neutro'. `chooseElement` exige
 *      `level >= DATA.leveling.elementChoiceLevel` (5) e é IRREVERSÍVEL:
 *      com elemento !== 'neutro' qualquer nova escolha retorna false.
 *      `pendingElementChoice(heroId)` diz à UI que precisa perguntar.
 *
 * [D7] ITENS. `equip` exige POSSE (o item sai do inventário; o que estava no
 *      espaço volta para lá) e valida `item.slot === espaço`. Duplicatas são
 *      permitidas no inventário (remove uma cópia).
 *      Sanidade do contrato §8: a contribuição de um item de espaço `pa`/`pp`
 *      é limitada a +1 no cálculo de stats — dado exagerado de outro agente
 *      não quebra o equilíbrio. O mesmo teto defensivo vale para pets.
 *
 * [D8] PETS. Vivem em `state.pets[]` (não equipados) e saem da lista ao serem
 *      equipados, igual aos itens — um pet só pode servir a um herói por vez.
 *      Bônus do pet entram em `effectiveStats`; o comportamento em batalha é
 *      do Engine.
 *
 * [D9] CARTAS DE PERSONAGEM. Só caem na sala do CHEFE (última sala do
 *      calabouço; sem dados, `roomIndex >= 2`). Piscina = `dungeon.cardDrops`
 *      cruzado com `DATA.cards` (respeita `minDungeon` contra a `order` do
 *      calabouço e descarta `dropWeight <= 0`); sem `cardDrops` usável, cai em
 *      todas as cartas elegíveis. Peso efetivo = `entry.weight *
 *      card.dropWeight` — classe mais forte tem `dropWeight` menor, logo carta
 *      mais rara, exatamente como o contrato pede.
 *      Chance de sair carta: 60% (solo) / 50% (dupla) / 42% (trio) — mesma
 *      lógica de "menos heróis, mais sorte" do saque.
 *      CARTA REPETIDA (classe já liberada) não é perdida: vira BÔNUS DE XP
 *      (`xpBonus`: comum 80, raro 200, épico 500, pela `cardRarity` da classe).
 *      `rollCards` já desbloqueia a classe nova e salva; quem aplica o XP da
 *      repetida é o `Game` (Progress não sabe quem está no grupo).
 *
 * [D10] SAQUE. `rollDrops` (itens) mantém a regra aprovada da v1: peso
 *      efetivo = `weight * LUCK^grau`, LUCK 2.4 (solo) / 1.6 (dupla) / 1.0
 *      (trio), 1 sorteio por sala + 1 extra na sala do chefe.
 *      `rollPet` é extra e só no chefe: 25% base (×sorte), pesos de
 *      `DATA.pets[*].dropWeight`, filtrando por `dropDungeon` e ignorando pets
 *      que o jogador já tem (pet repetido não existe).
 *
 * [D11] `effectiveStats` = base da classe + `perLevel*(nível-1)` (hp/power) +
 *       bônus dos 4 itens + bônus do pet, em hp/pa/pp/power/initiative/
 *       dodge/lock/resists. Herói desconhecido devolve null (o Engine cai nos
 *       stats base). Com ficha zerada o resultado é idêntico aos stats da
 *       classe — invariante dos testes do motor.
 * ==========================================================================*/

(function () {
  'use strict';

  var Progress = {};
  JOGO.Progress = Progress;

  var KEY = 'soterra-save-v2';
  var SLOTS = ['pa', 'pp', 'vida', 'especial'];
  var STAT_KEYS = ['hp', 'pa', 'pp', 'power', 'initiative', 'dodge', 'lock'];
  var DEFAULT_ELEMENT = 'neutro';

  // grau de raridade (pt-BR do contrato v2 + en da v1, por segurança)
  var RARITY_DEGREE = { comum: 0, raro: 1, epico: 2, common: 0, rare: 1, epic: 2 };
  // XP de consolo por carta repetida, pela raridade da classe [D9]
  var CARD_DUP_XP = { comum: 80, raro: 200, epico: 500, common: 80, rare: 200, epic: 500 };
  // chance de um chefe derrubar carta, por tamanho do grupo [D9]
  var CARD_CHANCE = [0.60, 0.60, 0.50, 0.42];
  // chance base de pet no chefe [D10]
  var PET_CHANCE = 0.25;
  // tetos defensivos do contrato §8 [D7]
  var PA_ITEM_CAP = 1, PP_ITEM_CAP = 1;

  Progress.SAVE_KEY = KEY;
  Progress.SLOTS = SLOTS;
  Progress.state = null;

  // =========================================================== storage seguro
  function getStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    } catch (e) { /* acesso negado (file://, modo privado, headless) */ }
    return null;
  }

  // ============================================================ leitura DATA
  // (tudo defensivo: os arquivos de dados são escritos em paralelo)
  function D() { return (JOGO && JOGO.DATA) || {}; }

  function leveling() {
    var lv = D().leveling;
    if (!lv || !isArray(lv.xpTable) || !lv.xpTable.length) {
      return { maxLevel: 1, xpTable: [0], perLevel: { hp: 0, power: 0 }, elementChoiceLevel: 5 };
    }
    return {
      maxLevel: num(lv.maxLevel, lv.xpTable.length),
      xpTable: lv.xpTable,
      perLevel: lv.perLevel || { hp: 0, power: 0 },
      elementChoiceLevel: num(lv.elementChoiceLevel, 5)
    };
  }
  function unlockTiers() {
    var t = D().unlockTiers;
    return isArray(t) && t.length ? t : [5, 10, 12, 15, 20, 30];
  }
  function classes() { return D().classes || {}; }
  function classDef(classId) { return classes()[classId] || null; }
  function spellDef(id) { var s = D().spells; return (s && s[id]) || null; }
  function itemDef(id) { var i = D().items; return (i && i[id]) || null; }
  function petDef(id) { var p = D().pets; return (p && p[id]) || null; }
  function cardDef(classId) { var c = D().cards; return (c && c[classId]) || null; }
  function elements() {
    var e = D().elements;
    return isArray(e) && e.length ? e : ['neutro', 'fogo', 'agua', 'terra', 'ar'];
  }
  function dungeonList() { var d = D().dungeons; return isArray(d) ? d : []; }
  function dungeonDef(dungeonId) {
    var ds = dungeonList();
    for (var i = 0; i < ds.length; i++) if (ds[i] && ds[i].id === dungeonId) return ds[i];
    return null;
  }
  // índice de profundidade do calabouço (0 = o mais raso), para `minDungeon`
  function dungeonOrder(dungeonId) {
    var ds = dungeonList();
    for (var i = 0; i < ds.length; i++) {
      if (ds[i] && ds[i].id === dungeonId) {
        return typeof ds[i].order === 'number' ? ds[i].order : i;
      }
    }
    return 0;
  }
  function isBossRoom(dungeonId, roomIndex) {
    var d = dungeonDef(dungeonId);
    var last = (d && isArray(d.rooms) && d.rooms.length) ? d.rooms.length - 1 : 2;
    return num(roomIndex, 0) >= last;
  }

  // ================================================================ utilidades
  function isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function isObj(v) { return !!v && typeof v === 'object' && !isArray(v); }
  function num(v, def) { return (typeof v === 'number' && isFinite(v)) ? v : def; }
  function clone(o) { var out = {}, k; for (k in o) if (o.hasOwnProperty(k)) out[k] = o[k]; return out; }
  function luckFor(partySize) {
    var n = num(partySize, 3);
    if (n <= 1) return 2.4;
    if (n === 2) return 1.6;
    return 1.0;
  }
  function pickWeighted(pool) { // pool: [{id, w}]
    var total = 0, i;
    for (i = 0; i < pool.length; i++) total += pool[i].w;
    if (total <= 0) return null;
    var pick = Math.random() * total, acc = 0;
    for (i = 0; i < pool.length; i++) {
      acc += pool[i].w;
      if (pick < acc) return pool[i].id;
    }
    return pool[pool.length - 1].id;
  }

  function emptyItems() { return { pa: null, pp: null, vida: null, especial: null }; }

  // ============================================================ XP e níveis
  function levelForXp(xp) {
    var lv = leveling();
    var table = lv.xpTable;
    var maxLevel = Math.min(lv.maxLevel, table.length);
    for (var i = maxLevel - 1; i >= 0; i--) if (xp >= table[i]) return i + 1;
    return 1;
  }
  function maxLevel() {
    var lv = leveling();
    return Math.min(lv.maxLevel, lv.xpTable.length);
  }
  function maxXp() {
    var lv = leveling();
    return lv.xpTable[maxLevel() - 1];
  }

  // ============================================================ estado / heróis
  function newHero(classId) {
    return {
      classId: classId,
      element: DEFAULT_ELEMENT,
      xp: 0,
      level: 1,
      spells: [],
      items: emptyItems(),
      pet: null
    };
  }

  function freshState() {
    var st = { version: 2, unlockedClasses: [], heroes: {}, inventory: [], pets: [], cards: [] };
    var cs = classes(), id;
    for (id in cs) {
      if (!cs.hasOwnProperty(id)) continue;
      if (cs[id] && cs[id].startsUnlocked) {
        st.unlockedClasses.push(id);
        st.heroes[id] = newHero(id);
      }
    }
    return st;
  }

  // Saneamento total do save [D2]: nada aqui pode lançar exceção.
  function sanitize(raw) {
    if (!isObj(raw)) return null;
    var st = { version: 2, unlockedClasses: [], heroes: {}, inventory: [], pets: [], cards: [] };
    var cs = classes(), i, id;
    var hasClasses = false;
    for (id in cs) { if (cs.hasOwnProperty(id)) { hasClasses = true; break; } }

    function classOk(cid) {
      return typeof cid === 'string' && (!hasClasses || !!cs[cid]);
    }

    // classes desbloqueadas
    var seenClass = {};
    if (isArray(raw.unlockedClasses)) {
      for (i = 0; i < raw.unlockedClasses.length; i++) {
        var cid = raw.unlockedClasses[i];
        if (classOk(cid) && !seenClass[cid]) { seenClass[cid] = true; st.unlockedClasses.push(cid); }
      }
    }
    // as que começam liberadas nunca somem de um save antigo
    for (id in cs) {
      if (cs.hasOwnProperty(id) && cs[id] && cs[id].startsUnlocked && !seenClass[id]) {
        seenClass[id] = true; st.unlockedClasses.push(id);
      }
    }

    // heróis
    var els = elements();
    if (isObj(raw.heroes)) {
      for (var hid in raw.heroes) {
        if (!raw.heroes.hasOwnProperty(hid)) continue;
        var src = raw.heroes[hid];
        if (!isObj(src)) continue;
        var cls = classOk(src.classId) ? src.classId : (classOk(hid) ? hid : null);
        if (!cls) continue;
        var h = newHero(cls);
        h.xp = Math.max(0, Math.floor(num(src.xp, 0)));
        if (maxXp() > 0) h.xp = Math.min(h.xp, maxXp());
        h.level = levelForXp(h.xp);
        // elemento: só vale se existir na lista e a classe tiver caminho
        if (typeof src.element === 'string' && src.element !== DEFAULT_ELEMENT) {
          var def = classDef(cls);
          var pathOk = !def || !def.paths || isArray(def.paths[src.element]);
          if (indexOf(els, src.element) >= 0 && pathOk &&
              h.level >= leveling().elementChoiceLevel) {
            h.element = src.element;
          }
        }
        // itens equipados: precisam existir em DATA e bater com o espaço
        if (isObj(src.items)) {
          for (i = 0; i < SLOTS.length; i++) {
            var slot = SLOTS[i], itId = src.items[slot];
            if (typeof itId !== 'string') continue;
            var it = itemDef(itId);
            if (it && it.slot === slot) h.items[slot] = itId;
          }
        }
        if (typeof src.pet === 'string' && petDef(src.pet)) h.pet = src.pet;
        st.heroes[hid] = h;
        if (!seenClass[cls]) { seenClass[cls] = true; st.unlockedClasses.push(cls); }
      }
    }
    // toda classe liberada tem ficha padrão
    for (i = 0; i < st.unlockedClasses.length; i++) {
      var c2 = st.unlockedClasses[i];
      if (!st.heroes[c2]) st.heroes[c2] = newHero(c2);
    }

    // inventário / pets / cartas
    if (isArray(raw.inventory)) {
      for (i = 0; i < raw.inventory.length; i++) {
        if (typeof raw.inventory[i] === 'string' && itemDef(raw.inventory[i])) {
          st.inventory.push(raw.inventory[i]);
        }
      }
    }
    if (isArray(raw.pets)) {
      for (i = 0; i < raw.pets.length; i++) {
        if (typeof raw.pets[i] === 'string' && petDef(raw.pets[i])) st.pets.push(raw.pets[i]);
      }
    }
    if (isArray(raw.cards)) {
      for (i = 0; i < raw.cards.length; i++) {
        if (typeof raw.cards[i] === 'string' && classOk(raw.cards[i])) st.cards.push(raw.cards[i]);
      }
    }
    return st;
  }

  function indexOf(arr, v) {
    for (var i = 0; i < arr.length; i++) if (arr[i] === v) return i;
    return -1;
  }

  // ficha existente ou criada sob demanda (heróis de teste, save incompleto)
  function ensureHero(heroId) {
    var st = Progress.state;
    if (!st) return null;
    var h = st.heroes[heroId];
    if (isObj(h) && typeof h.classId === 'string') {
      if (!isObj(h.items)) h.items = emptyItems();
      if (typeof h.element !== 'string') h.element = DEFAULT_ELEMENT;
      if (typeof h.xp !== 'number' || !isFinite(h.xp)) h.xp = 0;
      if (typeof h.level !== 'number' || !isFinite(h.level)) h.level = levelForXp(h.xp);
      if (!isArray(h.spells)) h.spells = [];
      return h;
    }
    if (classDef(heroId) || !Object.keys(classes()).length) {
      st.heroes[heroId] = newHero(heroId);
      syncSpells(heroId);
      return st.heroes[heroId];
    }
    return null;
  }

  // =========================================================== load/save/reset
  Progress.load = function () {
    var st = null;
    var s = getStorage();
    if (s) {
      try {
        var rawText = s.getItem(KEY);
        if (rawText) st = sanitize(JSON.parse(rawText));
      } catch (e) { st = null; }   // JSON quebrado, storage negado etc.
    }
    if (!st || !isObj(st.heroes)) st = freshState();
    Progress.state = st;
    // garante ficha + cache de feitiços de todo mundo
    for (var hid in st.heroes) if (st.heroes.hasOwnProperty(hid)) syncSpells(hid);
    return Progress.state;
  };

  Progress.save = function () {
    var s = getStorage();
    if (!s) return false;
    try {
      s.setItem(KEY, JSON.stringify(Progress.state));
      return true;
    } catch (e) { return false; }   // cota cheia / modo privado
  };

  Progress.reset = function () {
    Progress.state = freshState();
    for (var hid in Progress.state.heroes) {
      if (Progress.state.heroes.hasOwnProperty(hid)) syncSpells(hid);
    }
    Progress.save();
    return Progress.state;
  };

  // ================================================================ consultas
  Progress.hero = function (heroId) {
    return (Progress.state && Progress.state.heroes[heroId]) || null;
  };
  Progress.heroIds = function () {
    var out = [];
    if (!Progress.state) return out;
    for (var id in Progress.state.heroes) {
      if (Progress.state.heroes.hasOwnProperty(id)) out.push(id);
    }
    return out;
  };
  Progress.isClassUnlocked = function (classId) {
    return !!Progress.state && indexOf(Progress.state.unlockedClasses, classId) >= 0;
  };

  // ==================================================== classes e cartas
  Progress.unlockClass = function (classId) {
    var st = Progress.state;
    if (!st || typeof classId !== 'string') return false;
    if (Object.keys(classes()).length && !classDef(classId)) return false;
    if (indexOf(st.unlockedClasses, classId) >= 0) return false;   // já tinha
    st.unlockedClasses.push(classId);
    if (!st.heroes[classId]) {
      st.heroes[classId] = newHero(classId);
      syncSpells(classId);
    }
    Progress.save();
    return true;
  };

  // ficha extra da mesma classe (a UI pode querer dois bruxos) [D3]
  Progress.createHero = function (classId, heroId) {
    var st = Progress.state;
    if (!st || !classDef(classId)) return null;
    if (!Progress.isClassUnlocked(classId)) return null;
    var id = heroId || classId;
    if (st.heroes[id]) {
      var n = 2;
      while (st.heroes[classId + '#' + n]) n++;
      id = classId + '#' + n;
    }
    st.heroes[id] = newHero(classId);
    syncSpells(id);
    Progress.save();
    return id;
  };

  /* Cartas de personagem [D9]. Só na sala do chefe. Devolve
   * [{classId, name, rarity, duplicate, unlocked, xpBonus}] (0 ou 1 carta). */
  Progress.rollCards = function (dungeonId, roomIndex, partySize) {
    if (!Progress.state) Progress.load();
    if (!isBossRoom(dungeonId, roomIndex)) return [];

    var order = dungeonOrder(dungeonId);
    var dungeon = dungeonDef(dungeonId);
    var entries = (dungeon && isArray(dungeon.cardDrops)) ? dungeon.cardDrops : null;
    var pool = [], i, classId, card, w;

    if (entries) {
      for (i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!isObj(e)) continue;
        classId = e.classId;
        card = cardDef(classId);
        if (!card || num(card.dropWeight, 0) <= 0) continue;      // classe inicial: carta não existe
        if (order < num(card.minDungeon, 0)) continue;            // respeita minDungeon
        w = Math.max(0, num(e.weight, 1)) * num(card.dropWeight, 0);
        if (w > 0) pool.push({ id: classId, w: w });
      }
    }
    if (!pool.length) {  // sem cardDrops utilizável: todas as cartas elegíveis
      var all = D().cards || {};
      for (classId in all) {
        if (!all.hasOwnProperty(classId)) continue;
        card = all[classId];
        if (!card || num(card.dropWeight, 0) <= 0) continue;
        if (order < num(card.minDungeon, 0)) continue;
        pool.push({ id: classId, w: num(card.dropWeight, 0) });
      }
    }
    if (!pool.length) return [];

    var size = Math.max(1, Math.min(3, num(partySize, 3)));
    if (Math.random() >= CARD_CHANCE[size]) return [];

    var chosen = pickWeighted(pool);
    if (!chosen) return [];

    var def = classDef(chosen);
    var rarity = (def && def.cardRarity) || 'comum';
    var already = Progress.isClassUnlocked(chosen);
    var out = {
      classId: chosen,
      name: (def && def.name) || chosen,
      rarity: rarity,
      duplicate: already,
      unlocked: false,
      xpBonus: 0
    };
    if (already) {
      out.xpBonus = num(CARD_DUP_XP[rarity], 80);   // carta repetida vira XP [D9]
    } else {
      out.unlocked = Progress.unlockClass(chosen);
    }
    Progress.state.cards.push(chosen);
    Progress.save();
    return [out];
  };

  // ============================================================ XP / níveis
  Progress.addXp = function (heroId, amount) {
    var h = ensureHero(heroId);
    if (!h) return 0;
    var amt = num(amount, 0);
    amt = isFinite(amt) ? Math.floor(amt) : 0;
    if (amt <= 0) return 0;                       // XP nunca regride
    var before = h.level;
    var cap = maxXp();
    h.xp = Math.min(h.xp + amt, cap);
    h.level = levelForXp(h.xp);
    if (h.level !== before) syncSpells(heroId);
    Progress.save();
    return h.level - before;
  };

  Progress.xpInfo = function (heroId) {
    var h = ensureHero(heroId);
    if (!h) return null;
    var lv = leveling();
    var top = maxLevel();
    if (h.level >= top) return { level: h.level, xp: h.xp, xpNext: null, pct: 1 };
    var cur = lv.xpTable[h.level - 1];
    var next = lv.xpTable[h.level];
    var pct = next > cur ? (h.xp - cur) / (next - cur) : 1;
    return { level: h.level, xp: h.xp, xpNext: next, pct: Math.max(0, Math.min(1, pct)) };
  };

  // ==================================================== caminho elemental [D6]
  Progress.pendingElementChoice = function (heroId) {
    var h = Progress.hero(heroId);
    if (!h) return false;
    return h.element === DEFAULT_ELEMENT && h.level >= leveling().elementChoiceLevel;
  };

  Progress.pendingElementChoices = function (heroIds) {
    var ids = isArray(heroIds) ? heroIds : Progress.heroIds();
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      if (Progress.pendingElementChoice(ids[i])) out.push(ids[i]);
    }
    return out;
  };

  Progress.chooseElement = function (heroId, element) {
    var h = Progress.hero(heroId);
    if (!h) return false;
    if (h.element !== DEFAULT_ELEMENT) return false;                 // irreversível
    if (h.level < leveling().elementChoiceLevel) return false;        // só do nível 5 em diante
    if (typeof element !== 'string' || element === DEFAULT_ELEMENT) return false;
    if (indexOf(elements(), element) < 0) return false;               // elemento inexistente
    var def = classDef(h.classId);
    if (def && def.paths && !isArray(def.paths[element])) return false; // classe sem esse caminho
    h.element = element;
    syncSpells(heroId);
    Progress.save();
    return true;
  };

  // ============================================================ feitiços [D4][D5]
  function pathUnlockLevel(spellId, tierIndex) {
    var def = spellDef(spellId);
    var lvl = def ? num(def.unlockLevel, 0) : 0;
    if (lvl > 0) return lvl;
    var tiers = unlockTiers();
    return num(tiers[tierIndex], 99);
  }

  Progress.spellsFor = function (heroId) {
    var h = Progress.hero(heroId);
    if (!h) return [];
    var def = classDef(h.classId);
    var out = [], i;

    if (def && isArray(def.baseSpells)) {
      for (i = 0; i < def.baseSpells.length; i++) out.push(def.baseSpells[i]);
    }
    if (def && def.paths && h.element !== DEFAULT_ELEMENT && isArray(def.paths[h.element])) {
      var path = def.paths[h.element];
      for (i = 0; i < path.length; i++) {
        if (h.level >= pathUnlockLevel(path[i], i)) out.push(path[i]);
      }
    }
    var special = h.items && h.items.especial;
    if (special) {
      var it = itemDef(special);
      if (it && it.grantsSpell && indexOf(out, it.grantsSpell) < 0) out.push(it.grantsSpell);
    }
    return out;
  };

  function syncSpells(heroId) {
    var h = Progress.hero(heroId);
    if (h) h.spells = Progress.spellsFor(heroId);
    return h ? h.spells : [];
  }

  // ============================================================ inventário
  Progress.addItem = function (itemId) {
    if (!Progress.state || typeof itemId !== 'string' || !itemDef(itemId)) return false;
    Progress.state.inventory.push(itemId);
    Progress.save();
    return true;
  };
  Progress.addPet = function (petId) {
    if (!Progress.state || typeof petId !== 'string' || !petDef(petId)) return false;
    if (indexOf(Progress.state.pets, petId) >= 0) return false;   // pet repetido não existe
    Progress.state.pets.push(petId);
    Progress.save();
    return true;
  };

  Progress.equip = function (heroId, itemId) {
    var it = itemDef(itemId);
    if (!it || indexOf(SLOTS, it.slot) < 0) return false;          // item ou espaço inválido
    var h = ensureHero(heroId);
    if (!h) return false;
    var inv = Progress.state.inventory;
    var idx = indexOf(inv, itemId);
    if (idx < 0) return false;                                     // precisa possuir [D7]
    inv.splice(idx, 1);
    if (h.items[it.slot]) inv.push(h.items[it.slot]);              // o anterior volta
    h.items[it.slot] = itemId;
    syncSpells(heroId);
    Progress.save();
    return true;
  };

  Progress.unequip = function (heroId, slot) {
    if (indexOf(SLOTS, slot) < 0) return false;
    var h = ensureHero(heroId);
    if (!h || !h.items[slot]) return false;
    Progress.state.inventory.push(h.items[slot]);
    h.items[slot] = null;
    syncSpells(heroId);
    Progress.save();
    return true;
  };

  Progress.equipPet = function (heroId, petId) {
    if (!petDef(petId)) return false;
    var h = ensureHero(heroId);
    if (!h) return false;
    var pets = Progress.state.pets;
    var idx = indexOf(pets, petId);
    if (idx < 0) {
      // pode estar com outro herói: transferir é permitido [D8]
      var owner = null;
      for (var hid in Progress.state.heroes) {
        if (Progress.state.heroes.hasOwnProperty(hid) && Progress.state.heroes[hid].pet === petId) {
          owner = hid; break;
        }
      }
      if (owner === null) return false;                 // não possui o pet
      if (owner === heroId) return true;                // já é dele
      Progress.state.heroes[owner].pet = null;
    } else {
      pets.splice(idx, 1);
    }
    if (h.pet) pets.push(h.pet);                        // o anterior volta ao canil
    h.pet = petId;
    Progress.save();
    return true;
  };

  Progress.unequipPet = function (heroId) {
    var h = ensureHero(heroId);
    if (!h || !h.pet) return false;
    Progress.state.pets.push(h.pet);
    h.pet = null;
    Progress.save();
    return true;
  };

  // ======================================================== stats efetivos [D11]
  function applyBonuses(out, bonuses, capPaPp) {
    if (!isObj(bonuses)) return;
    for (var i = 0; i < STAT_KEYS.length; i++) {
      var k = STAT_KEYS[i];
      var v = num(bonuses[k], 0);
      if (!v) continue;
      if (capPaPp && (k === 'pa')) v = Math.min(v, PA_ITEM_CAP);
      if (capPaPp && (k === 'pp')) v = Math.min(v, PP_ITEM_CAP);
      out[k] += v;
    }
    if (isObj(bonuses.resists)) {
      for (var e in bonuses.resists) {
        if (!bonuses.resists.hasOwnProperty(e)) continue;
        out.resists[e] = num(out.resists[e], 0) + num(bonuses.resists[e], 0);
      }
    }
  }

  Progress.effectiveStats = function (heroId) {
    var h = Progress.hero(heroId);
    if (!h) return null;
    var def = classDef(h.classId);
    if (!def || !isObj(def.stats)) return null;
    var base = def.stats;
    var out = { hp: 0, pa: 0, pp: 0, power: 0, initiative: 0, dodge: 0, lock: 0, resists: {} };
    var i, k;
    for (i = 0; i < STAT_KEYS.length; i++) {
      k = STAT_KEYS[i];
      out[k] = num(base[k], 0);
    }
    if (isObj(base.resists)) {
      for (k in base.resists) if (base.resists.hasOwnProperty(k)) out.resists[k] = num(base.resists[k], 0);
    }

    var lv = leveling();
    var above = Math.max(0, h.level - 1);
    if (above > 0 && lv.perLevel) {
      out.hp += num(lv.perLevel.hp, 0) * above;
      out.power += num(lv.perLevel.power, 0) * above;
    }

    for (i = 0; i < SLOTS.length; i++) {
      var itId = h.items[SLOTS[i]];
      var it = itId ? itemDef(itId) : null;
      if (it) applyBonuses(out, it.bonuses, true);
    }
    if (h.pet) {
      var pd = petDef(h.pet);
      if (pd) applyBonuses(out, pd.bonuses, true);
    }

    out.hp = Math.max(1, Math.round(out.hp));
    out.pa = Math.max(0, Math.round(out.pa));
    out.pp = Math.max(0, Math.round(out.pp));
    return out;
  };

  // ============================================================ saque [D10]
  Progress.rollDrops = function (dungeonId, roomIndex, partySize) {
    if (!Progress.state) Progress.load();
    var dungeon = dungeonDef(dungeonId);
    var table = dungeon && dungeon.lootTable;
    if (!isArray(table) || !table.length) return [];

    var luck = luckFor(partySize);
    var pool = [];
    for (var i = 0; i < table.length; i++) {
      var entry = table[i];
      if (!isObj(entry)) continue;
      if (num(roomIndex, 0) < num(entry.minRoom, 0)) continue;
      var it = itemDef(entry.itemId);
      var degree = it ? num(RARITY_DEGREE[it.rarity], 0) : 0;
      var w = Math.max(0, num(entry.weight, 0)) * Math.pow(luck, degree);
      if (w > 0) pool.push({ id: entry.itemId, w: w });
    }
    if (!pool.length) return [];

    var rolls = isBossRoom(dungeonId, roomIndex) ? 2 : 1;   // chefe: sorteio extra
    var drops = [];
    for (var r = 0; r < rolls; r++) {
      var chosen = pickWeighted(pool);
      if (!chosen) continue;
      drops.push(chosen);
      Progress.state.inventory.push(chosen);
    }
    Progress.save();
    return drops;
  };

  Progress.rollPet = function (dungeonId, roomIndex, partySize) {
    if (!Progress.state) Progress.load();
    if (!isBossRoom(dungeonId, roomIndex)) return null;
    var all = D().pets || {};
    var order = dungeonOrder(dungeonId);
    var owned = {}, hid, id;
    for (var i = 0; i < Progress.state.pets.length; i++) owned[Progress.state.pets[i]] = true;
    for (hid in Progress.state.heroes) {
      if (Progress.state.heroes.hasOwnProperty(hid) && Progress.state.heroes[hid].pet) {
        owned[Progress.state.heroes[hid].pet] = true;
      }
    }
    var pool = [];
    for (id in all) {
      if (!all.hasOwnProperty(id) || owned[id]) continue;
      var p = all[id];
      if (!p || num(p.dropWeight, 0) <= 0) continue;
      var dd = p.dropDungeon;
      if (typeof dd === 'string' && dd !== dungeonId) continue;
      if (typeof dd === 'number' && order < dd) continue;
      pool.push({ id: id, w: num(p.dropWeight, 0) });
    }
    if (!pool.length) return null;
    var chance = Math.min(0.9, PET_CHANCE * luckFor(partySize));
    if (Math.random() >= chance) return null;
    var chosen = pickWeighted(pool);
    if (!chosen) return null;
    Progress.addPet(chosen);
    return chosen;
  };

  // ========================================================= grupo de batalha
  /* Formato consumido por Engine.createBattle (contrato §9). */
  Progress.battleParty = function (heroIds) {
    var ids = isArray(heroIds) ? heroIds : Progress.heroIds();
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      var heroId = ids[i];
      var h = Progress.hero(heroId);
      if (!h) continue;
      out.push({
        heroId: heroId,
        classId: h.classId,
        element: h.element || DEFAULT_ELEMENT,
        level: h.level,
        spells: Progress.spellsFor(heroId),
        pet: h.pet || null,
        items: clone(h.items),
        stats: Progress.effectiveStats(heroId)
      });
    }
    return out;
  };

  // inicializa ao carregar o script (os arquivos de DATA já rodaram)
  Progress.load();
})();
