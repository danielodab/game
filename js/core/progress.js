var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* ============================================================================
 * SOTERRA — js/core/progress.js  (dono: Agente de Lógica)
 * Progressão persistente: XP/níveis, inventário, equipamento e saque.
 * Contrato: docs/CONTRACT.md, "ADENDO v2 — Progressão, Equipamentos e Saque".
 *
 * DECISÕES DE DESIGN (documentadas — onde o contrato é omisso):
 *  - Persistência: localStorage chave 'soterra-save-v1', com try/catch em
 *    TODO acesso (file:// e headless podem negar storage). Sem storage, o
 *    estado vive só em memória — nenhuma API lança exceção por isso.
 *  - Save automático em toda mutação (addXp, equip, unequip, rollDrops,
 *    reset). load() não grava.
 *  - xpTable é ACUMULADA (índice 0 = nível 1 = 0). addXp trunca o XP no teto
 *    do nível máximo (xpTable[maxLevel-1]) para xpInfo/pct ficarem estáveis.
 *  - xpInfo no nível máximo: { xpNext: null, pct: 1 }.
 *  - addXp com valor negativo/inválido é ignorado (retorna 0) — XP nunca
 *    regride.
 *  - effectiveStats: base + perLevel*(nível-1) (hp/power) + soma dos bônus
 *    dos 3 slots equipados (hp, pa, pm, power, initiative e resists por
 *    elemento). Com save zerado (nível 1, sem itens) o resultado é
 *    idêntico aos stats base — invariante dos 62 testes do motor.
 *    Retorna null para heroId desconhecido (a Engine cai nos stats base).
 *  - equip: o item PRECISA estar no inventário (remove UMA cópia — duplicatas
 *    são permitidas); o slot vem do próprio item; o item anteriormente
 *    equipado no slot volta ao inventário. unequip devolve ao inventário.
 *  - rollDrops: sorteia da lootTable do calabouço, filtrando minRoom pelo
 *    roomIndex. Peso efetivo = weight * LUCK^grau (common 0, rare 1, epic 2),
 *    LUCK = 2.4 (solo) | 1.6 (dupla) | 1.0 (trio). 1 sorteio por sala,
 *    +1 extra na sala do chefe (roomIndex >= 2). RNG: Math.random (saque não
 *    precisa ser determinístico como a batalha).
 *  - Heróis fora do save (ex.: heróis de teste adicionados em runtime) são
 *    criados sob demanda com { xp: 0, level: 1 } e slots vazios.
 * ==========================================================================*/

(function () {
  'use strict';

  var Progress = {};
  JOGO.Progress = Progress;

  var KEY = 'soterra-save-v1';
  var SLOTS = ['weapon', 'armor', 'trinket'];
  var RARITY_DEGREE = { common: 0, rare: 1, epic: 2 };

  Progress.state = null;

  // ------------------------------------------------------------- storage
  function getStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    } catch (e) { /* acesso negado (file://, headless, modo privado) */ }
    return null;
  }

  // ------------------------------------------------------------- dados
  function leveling() {
    return (JOGO.DATA && JOGO.DATA.leveling) ||
      { maxLevel: 1, xpTable: [0], perLevel: { hp: 0, power: 0 } };
  }
  function itemDef(itemId) {
    return (JOGO.DATA && JOGO.DATA.items && JOGO.DATA.items[itemId]) || null;
  }
  function heroDef(heroId) {
    var hs = (JOGO.DATA && JOGO.DATA.heroes) || [];
    for (var i = 0; i < hs.length; i++) if (hs[i].id === heroId) return hs[i];
    return null;
  }
  function dungeonDef(dungeonId) {
    var ds = (JOGO.DATA && JOGO.DATA.dungeons) || [];
    for (var i = 0; i < ds.length; i++) if (ds[i].id === dungeonId) return ds[i];
    return null;
  }

  function emptySlots() { return { weapon: null, armor: null, trinket: null }; }

  function freshState() {
    var st = { heroes: {}, inventory: [], equipped: {} };
    var hs = (JOGO.DATA && JOGO.DATA.heroes) || [];
    for (var i = 0; i < hs.length; i++) {
      st.heroes[hs[i].id] = { xp: 0, level: 1 };
      st.equipped[hs[i].id] = emptySlots();
    }
    return st;
  }

  function ensureHero(heroId) {
    var st = Progress.state;
    if (!st.heroes[heroId] || typeof st.heroes[heroId].xp !== 'number') {
      st.heroes[heroId] = { xp: 0, level: 1 };
    }
    if (!st.equipped[heroId]) st.equipped[heroId] = emptySlots();
    return st.heroes[heroId];
  }

  function levelForXp(xp) {
    var lv = leveling();
    var table = lv.xpTable;
    var maxLevel = Math.min(lv.maxLevel, table.length);
    for (var i = maxLevel - 1; i >= 0; i--) {
      if (xp >= table[i]) return i + 1;
    }
    return 1;
  }
  function maxXp() {
    var lv = leveling();
    return lv.xpTable[Math.min(lv.maxLevel, lv.xpTable.length) - 1];
  }

  // ------------------------------------------------------------- load/save/reset
  Progress.load = function () {
    var st = null;
    var s = getStorage();
    if (s) {
      try {
        var raw = s.getItem(KEY);
        if (raw) st = JSON.parse(raw);
      } catch (e) { st = null; }
    }
    if (!st || typeof st !== 'object' ||
        !st.heroes || typeof st.heroes !== 'object' ||
        !st.equipped || typeof st.equipped !== 'object' ||
        Object.prototype.toString.call(st.inventory) !== '[object Array]') {
      st = freshState();
    }
    Progress.state = st;
    // completa heróis que faltem no save (save antigo, herói novo no DATA)
    var hs = (JOGO.DATA && JOGO.DATA.heroes) || [];
    for (var i = 0; i < hs.length; i++) ensureHero(hs[i].id);
    return Progress.state;
  };

  Progress.save = function () {
    var s = getStorage();
    if (!s) return false;
    try {
      s.setItem(KEY, JSON.stringify(Progress.state));
      return true;
    } catch (e) { return false; }
  };

  Progress.reset = function () {
    Progress.state = freshState();
    Progress.save();
    return Progress.state;
  };

  // ------------------------------------------------------------- XP / níveis
  Progress.addXp = function (heroId, amount) {
    var h = ensureHero(heroId);
    var amt = (typeof amount === 'number' && isFinite(amount)) ? Math.floor(amount) : 0;
    if (amt <= 0) return 0;
    var before = h.level;
    h.xp = Math.min(h.xp + amt, maxXp());
    h.level = levelForXp(h.xp);
    Progress.save();
    return h.level - before;
  };

  Progress.xpInfo = function (heroId) {
    var h = ensureHero(heroId);
    var lv = leveling();
    var maxLevel = Math.min(lv.maxLevel, lv.xpTable.length);
    if (h.level >= maxLevel) {
      return { level: h.level, xp: h.xp, xpNext: null, pct: 1 };
    }
    var cur = lv.xpTable[h.level - 1];
    var next = lv.xpTable[h.level];
    var pct = next > cur ? (h.xp - cur) / (next - cur) : 1;
    return { level: h.level, xp: h.xp, xpNext: next,
             pct: Math.max(0, Math.min(1, pct)) };
  };

  // ------------------------------------------------------------- stats efetivos
  Progress.effectiveStats = function (heroId) {
    var def = heroDef(heroId);
    if (!def) return null;
    var h = ensureHero(heroId);
    var lv = leveling();
    var base = def.stats;
    var out = {
      hp: base.hp, pa: base.pa, pm: base.pm,
      initiative: base.initiative, power: base.power, resists: {}
    };
    var k;
    for (k in base.resists) out.resists[k] = base.resists[k];

    var levelsAbove = h.level - 1;
    if (levelsAbove > 0 && lv.perLevel) {
      out.hp += (lv.perLevel.hp || 0) * levelsAbove;
      out.power += (lv.perLevel.power || 0) * levelsAbove;
    }

    var eq = Progress.state.equipped[heroId];
    for (var i = 0; i < SLOTS.length; i++) {
      var it = eq[SLOTS[i]] ? itemDef(eq[SLOTS[i]]) : null;
      if (!it || !it.bonuses) continue;
      var b = it.bonuses;
      if (b.hp) out.hp += b.hp;
      if (b.pa) out.pa += b.pa;
      if (b.pm) out.pm += b.pm;
      if (b.power) out.power += b.power;
      if (b.initiative) out.initiative += b.initiative;
      if (b.resists) {
        for (k in b.resists) out.resists[k] = (out.resists[k] || 0) + b.resists[k];
      }
    }
    return out;
  };

  // ------------------------------------------------------------- equipamento
  Progress.equip = function (heroId, itemId) {
    var it = itemDef(itemId);
    if (!it || SLOTS.indexOf(it.slot) < 0) return false;
    var inv = Progress.state.inventory;
    var idx = inv.indexOf(itemId);
    if (idx < 0) return false; // precisa possuir o item
    ensureHero(heroId);
    var eq = Progress.state.equipped[heroId];
    inv.splice(idx, 1);                 // sai do inventário (uma cópia)
    if (eq[it.slot]) inv.push(eq[it.slot]); // o anterior volta
    eq[it.slot] = itemId;
    Progress.save();
    return true;
  };

  Progress.unequip = function (heroId, slot) {
    if (SLOTS.indexOf(slot) < 0) return false;
    ensureHero(heroId);
    var eq = Progress.state.equipped[heroId];
    if (!eq[slot]) return false;
    Progress.state.inventory.push(eq[slot]);
    eq[slot] = null;
    Progress.save();
    return true;
  };

  // ------------------------------------------------------------- saque
  function luckFor(partySize) {
    if (partySize === 1) return 2.4;
    if (partySize === 2) return 1.6;
    return 1.0;
  }

  Progress.rollDrops = function (dungeonId, roomIndex, partySize) {
    var dungeon = dungeonDef(dungeonId);
    var table = dungeon && dungeon.lootTable;
    if (!table || !table.length) return [];

    var luck = luckFor(partySize);
    var pool = [];
    var total = 0;
    for (var i = 0; i < table.length; i++) {
      var entry = table[i];
      if (roomIndex < (entry.minRoom || 0)) continue;
      var it = itemDef(entry.itemId);
      var degree = it ? (RARITY_DEGREE[it.rarity] || 0) : 0;
      var w = entry.weight * Math.pow(luck, degree);
      if (w > 0) { pool.push({ itemId: entry.itemId, w: w }); total += w; }
    }
    if (!pool.length || total <= 0) return [];

    var rolls = roomIndex >= 2 ? 2 : 1; // sala do chefe: sorteio extra
    var drops = [];
    for (var r = 0; r < rolls; r++) {
      var pick = Math.random() * total;
      var acc = 0;
      var chosen = pool[pool.length - 1].itemId;
      for (var j = 0; j < pool.length; j++) {
        acc += pool[j].w;
        if (pick < acc) { chosen = pool[j].itemId; break; }
      }
      drops.push(chosen);
      Progress.state.inventory.push(chosen);
    }
    Progress.save();
    return drops;
  };

  // inicializa ao carregar o script (data.js já carregou nesta altura)
  Progress.load();
})();
