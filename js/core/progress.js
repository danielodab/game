var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* ============================================================================
 * SOTERRA 2.0 — js/core/progress.js   (dono: Lógica Meta)
 * Progressão persistente: classes, heróis, XP/níveis, caminho elemental,
 * feitiços, inventário ÚNICO de 4 espaços + pet, coleção de cartas com
 * estrelas, conjuntos elementais e forja de itens.
 * LEI: docs/CONTRACT_V2.md §3, §5, §8, §9 e o ADENDO v2.1 (§9-B), que
 * SUBSTITUI o que o contrair.
 * Nomenclatura obrigatória: pa = Pontos de Ataque, pp = Pontos de Passos.
 *
 * ---------------------------------------------------------------------------
 * DECISÕES DE DESIGN (onde o contrato é omisso — todas testadas):
 *
 * [D1] PERSISTÊNCIA. Chave `localStorage['soterra-save-v2']`. O save v1
 *      (`soterra-save-v1`) é IGNORADO — nunca lido, nunca migrado e nunca
 *      apagado (a v1 continua jogável). TODO acesso a storage vive em
 *      try/catch: `file://`, modo privado e headless podem negar. Sem storage
 *      o estado vive só em memória e nenhuma API lança exceção por isso.
 *      Save automático em toda mutação; `load()` nunca grava.
 *
 * [D2] SAVE CORROMPIDO NUNCA QUEBRA O JOGO. `load()` passa o JSON por um
 *      saneador (`sanitize`) que reconstrói campo a campo: tipo errado, classe
 *      inexistente, item/pet/pedra fora de DATA, elemento inválido, slot
 *      trocado, XP negativo, nível de forja fora da faixa — tudo é descartado
 *      ou corrigido. Sobrando lixo irrecuperável, cai em `freshState()`.
 *      O saneador também MIGRA formatos antigos do próprio v2:
 *      `inventory` de strings vira `[{itemId, level}]`; `cards` em array vira
 *      `{classId: n}` (conta as repetições); item equipado que não estava no
 *      inventário é devolvido a ele (modelo novo: equipar não tira do saco).
 *
 * [D3] HERÓI = UMA FICHA POR CLASSE. O contrato não diz de onde vem o
 *      `heroId`; adotamos `heroId === classId` para a ficha padrão, criada
 *      quando a classe é liberada (as `startsUnlocked` de DATA.classes já
 *      nascem com ficha — nada é fixado no código, o dado manda).
 *      `createHero(classId, heroId)` permite fichas extras.
 *
 * [D4] `hero.spells` é CACHE. A fonte da verdade é `spellsFor(heroId)`
 *      (3 base + caminho liberado + `grantsSpell` do item especial); o cache é
 *      regravado a cada mutação para o save e a UI lerem sem recalcular.
 *
 * [D5] NÍVEL DO FEITIÇO DE CAMINHO. Usa `DATA.spells[id].unlockLevel` quando
 *      existir e for > 0; senão cai em `DATA.unlockTiers[i]`.
 *
 * [D6] ELEMENTO. Todo herói nasce 'neutro'. `chooseElement` exige
 *      `level >= DATA.leveling.elementChoiceLevel` (5) e é IRREVERSÍVEL.
 *
 * [D7] INVENTÁRIO ÚNICO (§9-B). Um saco só para todo o grupo, com UMA entrada
 *      por `itemId`: `{itemId, level}`. Equipar NÃO tira o item do saco (é
 *      preciso vê-lo para forjar e para saber quem o usa); `hero.items[slot]`
 *      guarda o `itemId`. Um item não pode estar em dois heróis ao mesmo
 *      tempo: `equip` recusa e `equippedBy(itemId)` diz quem o está usando.
 *      Item REPETIDO no saque não vira entrada nova — é fundido em PEDRAS DE
 *      FORJA do elemento do item (`DUP_ITEM_STONES` = 2), decisão que
 *      substitui o antigo descarte silencioso e alimenta a forja.
 *      Sanidade do contrato §8: a contribuição de um item de espaço `pa`/`pp`
 *      é limitada a +1 mesmo depois do multiplicador da forja — a forja
 *      engorda vida, poder, resistências e esquiva, nunca a economia de ações.
 *
 * [D8] PETS. Vivem em `state.pets[]` e saem da lista ao serem equipados — um
 *      pet só serve a um herói por vez. Bônus entram em `effectiveStats`
 *      (com o mesmo teto de +1 em pa/pp).
 *
 * [D9] CARTAS ACUMULATIVAS E ESTRELAS (§9-B — substitui o desbloqueio por
 *      carta única da v2.0). `state.cards[classId] = n`, nunca decresce.
 *      Classe liberada quando `n >= unlockCost`; as cartas EXCEDENTES ao
 *      custo sobem estrelas conforme `starCosts` acumulados (máx. 5).
 *      Carta repetida NÃO vira mais XP: agora ela é progresso de estrela.
 *      Só o CHEFE derruba carta, e de forma aleatória: chance 60% (solo) /
 *      50% (dupla); a classe sai da piscina `dungeon.cardDrops` × `dropWeight`
 *      (respeitando `minDungeon` contra o ÍNDICE 0-based do calabouço em
 *      DATA.dungeons — `order` é 1-based e compará-lo faria a carta cara vazar
 *      um andar acima), e a QUANTIDADE cresce com a profundidade:
 *      `1 + floor(índice/2)` cartas —
 *      calabouço fundo compensa o custo alto das classes caras.
 *      Sem `unlockCost` no dado (progression.js ainda por atualizar), usa-se
 *      0 para classe `startsUnlocked` e `UNLOCK_COST_FALLBACK` para as outras.
 *
 * [D10] CONJUNTOS (§9-B). `effectiveStats` soma `DATA.sets[setId].bonuses[k]`
 *       de forma PROGRESSIVA e cumulativa: com 4 peças valem os bônus de 2, 3
 *       e 4. A peça é reconhecida por `item.setId` ou, na falta dele, pela
 *       lista `pieces` do próprio conjunto. Bônus de conjunto e de estrela não
 *       sofrem o multiplicador da forja nem o teto de pa/pp (são fontes
 *       distintas do item).
 *
 * [D11] FORJA (§9-B). `state.stones = {stoneId: n}`. `upgradeItem(invIndex)`
 *       é determinístico: consome `DATA.upgrade.stoneCost[level]` pedras do
 *       ELEMENTO do item (item neutro/sem elemento aceita qualquer pedra —
 *       consome a de maior estoque) e sobe 1 nível, até `maxLevel` (10).
 *       Nunca quebra, nunca regride, nunca consome sem subir.
 *       `effectiveStats` aplica `1 + bonusPerLevel*level` (0,12 ⇒ +10 = 2,2×)
 *       sobre os bônus do item, arredondando por atributo — EXCETO os
 *       atributos de `DATA.upgrade.nonScalingKeys` (pa/pp), que ficam no valor
 *       base: são pontos de ação inteiros e escalá-los furaria o teto do §8
 *       (+1 PA viraria +2 já no +5). A lista vem do DADO, não do código.
 *
 * [D12] SAQUE. `LUCK = 2.4` (solo) / `1.6` (dupla) — grupo agora é de 1 ou 2.
 *       A piscina é montada com os ITENS do calabouço (`DATA.items[*].dungeonId`,
 *       `dropWeight`, `minRoom`), que é a escala em que o Criativo calibrou o
 *       modelo; `dungeon.lootTable` fica como reserva para dados antigos.
 *       Peso efetivo = `dropWeight * LUCK^expoente`, com o expoente vindo de
 *       `DATA.lootWeights.luckExponent`. `minRoom` do item é respeitado
 *       (comum 0 · raro 1 · épico/lendário 2 ⇒ só na sala do chefe).
 *       PESO DE "NADA": `DATA.lootWeights.noDrop[dungeonId]` entra no MESMO
 *       sorteio como resultado vazio e NÃO recebe a Sorte de Saque — é isso que
 *       deixa ~50% dos sorteios secos (descida completa ≈ 2 peças) e que faz
 *       grupo menor tirar mais e melhor. 1 sorteio por sala + 1 extra no chefe.
 *       `rollPet` só no chefe.
 *
 * [D16] CONJUNTO QUE CONCEDE FEITIÇO. `spellsFor` inclui, além do `grantsSpell`
 *       do Lume, qualquer `DATA.sets[*].bonuses[n].grantsSpell` quando o herói
 *       tiver n peças daquele conjunto equipadas — genérico, sem id fixo.
 *
 * [D13] `effectiveStats` = base da classe + ganho por nível + itens (com forja)
 *       + conjuntos + pet + estrelas da classe. Herói desconhecido devolve null
 *       (o Engine cai nos stats base).
 *
 * [D15] RENDIMENTO DECRESCENTE DE XP (§9-D). `xpMultiplier(herói, calabouço)`:
 *       ×1 até `recommendedLevel + graceLevels`; acima disso, `factorPerLevel`
 *       elevado à diferença, com piso `floor`. É POR HERÓI (cada um tem seu
 *       nível) e entra DEPOIS da divisão da XP pelo tamanho do grupo. Faltando
 *       `recommendedLevel` ou `xpFalloff` no dado, devolve 1 — nunca corta por
 *       engano. Itens, pedras e cartas NÃO sofrem o corte.
 *
 * [D14] GANHO POR NÍVEL ELEMENTAL (§9-C). Todo nível dá `perLevel.hp`. As
 *       subidas ANTES da escolha do elemento (níveis 1→4, isto é
 *       `elementChoiceLevel - 2` subidas) dão `perLevel.power` genérico; as
 *       subidas a partir dali dão `perLevelElement.elemPower` — dano só nos
 *       feitiços do elemento do herói, que o Engine aplica.
 *       O contrato não diz o que fazer com quem passou do nível 5 SEM escolher:
 *       decidimos que essas subidas continuam dando poder genérico (ninguém
 *       perde progressão por adiar a escolha) e passam a valer como elementais
 *       assim que o elemento é escolhido. Sem `perLevelElement` no dado, tudo
 *       vira poder genérico (comportamento da v2.1).
 *       `effectiveStats` devolve `elemPower` e `element`; `battleParty` repassa.
 * ==========================================================================*/

(function () {
  'use strict';

  var Progress = {};
  JOGO.Progress = Progress;

  var KEY = 'soterra-save-v2';
  // §9-C: os 4 espaços ganharam nome próprio (nada de nomes de planilha)
  var SLOTS = ['punho', 'passo', 'casca', 'lume'];
  // saves antigos (v2.0/v2.1) guardavam os ids velhos — migração automática
  var SLOT_ALIASES = { pa: 'punho', pp: 'passo', vida: 'casca', especial: 'lume' };
  var SPELL_SLOT = 'lume';                 // o espaço que concede feitiço
  var STAT_KEYS = ['hp', 'pa', 'pp', 'power', 'initiative', 'dodge', 'lock'];
  var DEFAULT_ELEMENT = 'neutro';

  // expoente da Sorte de Saque por raridade — só vale se o dado não trouxer
  // `DATA.lootWeights.luckExponent` (lendário divide o expoente do épico: com
  // ×LUCK³ o solo trivializaria o troféu)
  var RARITY_DEGREE = { comum: 0, raro: 1, epico: 2, lendario: 2,
                        common: 0, rare: 1, epic: 2, legendary: 2 };
  var NO_DROP = ' nada';    // entrada virtual de "nenhum item" no sorteio
  // chance de o chefe derrubar carta, por tamanho do grupo (1 ou 2) [D9]
  var CARD_CHANCE = [0.60, 0.60, 0.50];
  var PET_CHANCE = 0.25;                 // chance base de pet no chefe [D12]
  var PA_ITEM_CAP = 1, PP_ITEM_CAP = 1;  // sanidade do contrato §8 [D7]
  var DUP_ITEM_STONES = 2;               // item repetido vira pedras [D7]
  var UNLOCK_COST_FALLBACK = 10;         // dado ainda sem `unlockCost` [D9]

  // Padrões do ADENDO v2.1, usados enquanto os arquivos de dados não chegam.
  var STAR_COSTS_DEFAULT = [5, 15, 30, 55, 90];
  var STARS_DEFAULT = {
    max: 5,
    bonuses: { 1: { hp: 15 }, 2: { power: 8 }, 3: { pp: 1 }, 4: { hp: 25, dodge: 10 }, 5: { pa: 1 } }
  };
  var UPGRADE_DEFAULT = {
    maxLevel: 10,
    tiers: [{ from: 0, to: 2, name: 'Comum' }, { from: 3, to: 5, name: 'Raro' },
            { from: 6, to: 9, name: 'Supremo' }, { from: 10, to: 10, name: 'Magnífico' }],
    bonusPerLevel: 0.12,
    stoneCost: [2, 3, 4, 6, 8, 10, 13, 16, 20, 25],
    nonScalingKeys: ['pa', 'pp']
  };

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

  // ================================================================ utilidades
  function isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function isObj(v) { return !!v && typeof v === 'object' && !isArray(v); }
  function num(v, def) { return (typeof v === 'number' && isFinite(v)) ? v : def; }
  function clone(o) { var out = {}, k; for (k in o) if (o.hasOwnProperty(k)) out[k] = o[k]; return out; }
  function indexOf(arr, v) {
    for (var i = 0; i < arr.length; i++) if (arr[i] === v) return i;
    return -1;
  }
  function keys(o) {
    var out = [], k;
    for (k in o) if (o.hasOwnProperty(k)) out.push(k);
    return out;
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
      perLevelElement: isObj(lv.perLevelElement) ? lv.perLevelElement : null,   // §9-C [D14]
      xpFalloff: isObj(lv.xpFalloff) ? lv.xpFalloff : null,                     // §9-D [D15]
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
  function setDefs() { return D().sets || {}; }
  function stoneDefs() { return D().stones || {}; }
  function starsCfg() {
    var s = D().stars;
    if (!isObj(s) || !isObj(s.bonuses)) return STARS_DEFAULT;
    return { max: num(s.max, 5), bonuses: s.bonuses };
  }
  function upgradeCfg() {
    var u = D().upgrade;
    if (!isObj(u) || !isArray(u.stoneCost) || !u.stoneCost.length) return UPGRADE_DEFAULT;
    return {
      maxLevel: num(u.maxLevel, u.stoneCost.length),
      tiers: isArray(u.tiers) ? u.tiers : UPGRADE_DEFAULT.tiers,
      bonusPerLevel: num(u.bonusPerLevel, UPGRADE_DEFAULT.bonusPerLevel),
      stoneCost: u.stoneCost,
      // atributos que NÃO escalam com o nível de forja (§9-B / items.js) [D11]
      nonScalingKeys: isArray(u.nonScalingKeys) ? u.nonScalingKeys : UPGRADE_DEFAULT.nonScalingKeys
    };
  }
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
  /* Profundidade do calabouço como ÍNDICE 0-BASED (0 = o mais raso).
   * ATENÇÃO: `DATA.cards[*].minDungeon` é 0-based ("0 = o primeiro"), enquanto
   * `dungeon.order` é 1-BASED — comparar com `order` faria a carta cara vazar
   * um andar acima do previsto. Aqui vale sempre a posição em DATA.dungeons. */
  function dungeonIndex(dungeonId) {
    var ds = dungeonList();
    for (var i = 0; i < ds.length; i++) if (ds[i] && ds[i].id === dungeonId) return i;
    return 0;
  }
  function isBossRoom(dungeonId, roomIndex) {
    var d = dungeonDef(dungeonId);
    var last = (d && isArray(d.rooms) && d.rooms.length) ? d.rooms.length - 1 : 2;
    return num(roomIndex, 0) >= last;
  }
  function luckFor(partySize) {          // [D12] grupo de 1 ou 2
    return num(partySize, 2) <= 1 ? 2.4 : 1.6;
  }

  // pedra do elemento pedido (fallback: o próprio nome do elemento como id)
  function stoneIdForElement(element) {
    var el = element || DEFAULT_ELEMENT;
    var defs = stoneDefs();
    for (var id in defs) {
      if (defs.hasOwnProperty(id) && defs[id] && defs[id].element === el) return id;
    }
    return el;
  }
  // conjunto ao qual o item pertence (`setId` do item ou busca em DATA.sets)
  function setIdOf(itemId) {
    var it = itemDef(itemId);
    if (it && it.setId) return it.setId;
    var sets = setDefs();
    for (var sid in sets) {
      if (!sets.hasOwnProperty(sid)) continue;
      var pieces = sets[sid] && sets[sid].pieces;
      if (isArray(pieces) && indexOf(pieces, itemId) >= 0) return sid;
    }
    return null;
  }

  // ============================================================ XP e níveis
  function levelForXp(xp) {
    var lv = leveling();
    var table = lv.xpTable;
    var top = Math.min(lv.maxLevel, table.length);
    for (var i = top - 1; i >= 0; i--) if (xp >= table[i]) return i + 1;
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

  // ============================================================ estado
  function emptyItems() { return { punho: null, passo: null, casca: null, lume: null }; }

  function newHero(classId) {
    return {
      classId: classId, element: DEFAULT_ELEMENT, xp: 0, level: 1,
      spells: [], items: emptyItems(), pet: null
    };
  }

  function freshState() {
    var st = { version: 21, unlockedClasses: [], heroes: {}, inventory: [], pets: [], cards: {}, stones: {} };
    var cs = classes(), id;
    for (id in cs) {
      if (!cs.hasOwnProperty(id)) continue;
      if (cs[id] && cs[id].startsUnlocked) {     // o DADO manda [D3]
        st.unlockedClasses.push(id);
        st.heroes[id] = newHero(id);
      }
    }
    return st;
  }

  // ------------------------------------------------------ saneamento [D2]
  function sanitize(raw) {
    if (!isObj(raw)) return null;
    var st = { version: 21, unlockedClasses: [], heroes: {}, inventory: [], pets: [], cards: {}, stones: {} };
    var cs = classes(), i, id;
    var hasClasses = keys(cs).length > 0;
    var up = upgradeCfg();

    function classOk(cid) { return typeof cid === 'string' && (!hasClasses || !!cs[cid]); }

    // ---- classes liberadas
    var seenClass = {};
    if (isArray(raw.unlockedClasses)) {
      for (i = 0; i < raw.unlockedClasses.length; i++) {
        var cid = raw.unlockedClasses[i];
        if (classOk(cid) && !seenClass[cid]) { seenClass[cid] = true; st.unlockedClasses.push(cid); }
      }
    }
    for (id in cs) {
      if (cs.hasOwnProperty(id) && cs[id] && cs[id].startsUnlocked && !seenClass[id]) {
        seenClass[id] = true; st.unlockedClasses.push(id);
      }
    }

    // ---- inventário: aceita string (nível 0) e {itemId, level}; funde repetidos
    function pushItem(itemId, level) {
      if (typeof itemId !== 'string' || !itemDef(itemId)) return;
      var lv = Math.max(0, Math.min(num(up.maxLevel, 10), Math.floor(num(level, 0))));
      for (var k = 0; k < st.inventory.length; k++) {
        if (st.inventory[k].itemId === itemId) {                  // uma entrada por item
          if (lv > st.inventory[k].level) st.inventory[k].level = lv;
          return;
        }
      }
      st.inventory.push({ itemId: itemId, level: lv });
    }
    if (isArray(raw.inventory)) {
      for (i = 0; i < raw.inventory.length; i++) {
        var entry = raw.inventory[i];
        if (typeof entry === 'string') pushItem(entry, 0);
        else if (isObj(entry)) pushItem(entry.itemId, entry.level);
      }
    }

    // ---- heróis
    var els = elements();
    var equippedSeen = {};
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
        if (typeof src.element === 'string' && src.element !== DEFAULT_ELEMENT) {
          var def = classDef(cls);
          var pathOk = !def || !def.paths || isArray(def.paths[src.element]);
          if (indexOf(els, src.element) >= 0 && pathOk &&
              h.level >= leveling().elementChoiceLevel) {
            h.element = src.element;
          }
        }
        if (isObj(src.items)) {
          for (var rawSlot in src.items) {
            if (!src.items.hasOwnProperty(rawSlot)) continue;
            var slot = SLOT_ALIASES[rawSlot] || rawSlot;   // migra pa/pp/vida/especial
            if (indexOf(SLOTS, slot) < 0) continue;
            var itId = src.items[rawSlot];
            if (typeof itId !== 'string') continue;
            var it = itemDef(itId);
            if (!it || it.slot !== slot) continue;
            if (equippedSeen[itId]) continue;      // exclusividade do item [D7]
            equippedSeen[itId] = true;
            pushItem(itId, 0);                     // migração: volta ao saco único
            h.items[slot] = itId;
          }
        }
        if (typeof src.pet === 'string' && petDef(src.pet)) h.pet = src.pet;
        st.heroes[hid] = h;
        if (!seenClass[cls]) { seenClass[cls] = true; st.unlockedClasses.push(cls); }
      }
    }
    for (i = 0; i < st.unlockedClasses.length; i++) {
      var c2 = st.unlockedClasses[i];
      if (!st.heroes[c2]) st.heroes[c2] = newHero(c2);
    }

    // ---- pets soltos
    if (isArray(raw.pets)) {
      for (i = 0; i < raw.pets.length; i++) {
        if (typeof raw.pets[i] === 'string' && petDef(raw.pets[i]) &&
            indexOf(st.pets, raw.pets[i]) < 0) st.pets.push(raw.pets[i]);
      }
    }

    // ---- cartas: objeto {classId:n} ou array antiga (conta repetições)
    if (isArray(raw.cards)) {
      for (i = 0; i < raw.cards.length; i++) {
        var ci = raw.cards[i];
        if (classOk(ci)) st.cards[ci] = (st.cards[ci] || 0) + 1;
      }
    } else if (isObj(raw.cards)) {
      for (id in raw.cards) {
        if (!raw.cards.hasOwnProperty(id) || !classOk(id)) continue;
        var n = Math.floor(num(raw.cards[id], 0));
        if (n > 0) st.cards[id] = n;
      }
    }

    // ---- pedras de forja
    if (isObj(raw.stones)) {
      var sd = stoneDefs(), hasStones = keys(sd).length > 0;
      for (id in raw.stones) {
        if (!raw.stones.hasOwnProperty(id)) continue;
        if (hasStones && !sd[id] && indexOf(elements(), id) < 0) continue;
        var q = Math.floor(num(raw.stones[id], 0));
        if (q > 0) st.stones[id] = q;
      }
    }
    return st;
  }

  // ficha existente ou criada sob demanda
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
    if (classDef(heroId) || !keys(classes()).length) {
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
      } catch (e) { st = null; }
    }
    if (!st || !isObj(st.heroes)) st = freshState();
    Progress.state = st;
    for (var hid in st.heroes) if (st.heroes.hasOwnProperty(hid)) syncSpells(hid);
    syncUnlocksFromCards();
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
    return Progress.state ? keys(Progress.state.heroes) : [];
  };
  Progress.isClassUnlocked = function (classId) {
    return !!Progress.state && indexOf(Progress.state.unlockedClasses, classId) >= 0;
  };

  // ============================================ cartas, desbloqueio e estrelas
  function unlockCostFor(classId) {
    var def = classDef(classId);
    if (def && def.startsUnlocked) return 0;
    var cfg = cardDef(classId);
    var c = cfg ? num(cfg.unlockCost, null) : null;
    if (c === null || c < 0) return UNLOCK_COST_FALLBACK;   // dado ainda por atualizar
    return Math.floor(c);
  }
  function starCostsFor(classId) {
    var cfg = cardDef(classId);
    if (cfg && isArray(cfg.starCosts) && cfg.starCosts.length) return cfg.starCosts;
    return STAR_COSTS_DEFAULT;
  }
  function cardsOwned(classId) {
    if (!Progress.state || !isObj(Progress.state.cards)) return 0;
    return Math.max(0, Math.floor(num(Progress.state.cards[classId], 0)));
  }

  Progress.cardInfo = function (classId) {
    var def = classDef(classId);
    var cost = unlockCostFor(classId);
    var owned = cardsOwned(classId);
    var costs = starCostsFor(classId);
    var maxStars = num(starsCfg().max, 5);
    var surplus = Math.max(0, owned - cost);
    var stars = 0;
    for (var i = 0; i < costs.length && i < maxStars; i++) {
      if (surplus >= num(costs[i], Infinity)) stars = i + 1;
    }
    var next = null;
    if (stars < Math.min(maxStars, costs.length)) {
      next = { star: stars + 1, faltam: Math.max(0, num(costs[stars], 0) - surplus) };
    }
    return {
      classId: classId,
      name: (def && def.name) || classId,
      cards: owned,
      unlocked: Progress.isClassUnlocked(classId),
      unlockCost: cost,
      stars: stars,
      next: next
    };
  };

  // soma dos bônus fixos das estrelas conquistadas pela classe [D9]
  function starBonuses(classId) {
    var stars = Progress.cardInfo(classId).stars;
    var cfg = starsCfg();
    var out = null;
    for (var s = 1; s <= stars; s++) {
      var b = cfg.bonuses[s] || cfg.bonuses[String(s)];
      if (!isObj(b)) continue;
      if (!out) out = { resists: {} };
      for (var k in b) {
        if (!b.hasOwnProperty(k)) continue;
        if (k === 'resists') {
          for (var e in b.resists) {
            if (b.resists.hasOwnProperty(e)) out.resists[e] = num(out.resists[e], 0) + num(b.resists[e], 0);
          }
        } else out[k] = num(out[k], 0) + num(b[k], 0);
      }
    }
    return out;
  }

  function syncUnlocksFromCards() {
    var st = Progress.state;
    if (!st) return;
    for (var classId in st.cards) {
      if (!st.cards.hasOwnProperty(classId)) continue;
      if (cardsOwned(classId) >= unlockCostFor(classId)) Progress.unlockClass(classId);
    }
  }

  Progress.unlockClass = function (classId) {
    var st = Progress.state;
    if (!st || typeof classId !== 'string') return false;
    if (keys(classes()).length && !classDef(classId)) return false;
    if (indexOf(st.unlockedClasses, classId) >= 0) return false;
    st.unlockedClasses.push(classId);
    if (!st.heroes[classId]) {
      st.heroes[classId] = newHero(classId);
      syncSpells(classId);
    }
    Progress.save();
    return true;
  };

  /* Soma cartas de uma classe (nunca decresce) e libera a classe ao atingir o
   * custo. Devolve o `cardInfo` resultante. */
  Progress.addCards = function (classId, n) {
    var st = Progress.state;
    if (!st || typeof classId !== 'string') return null;
    if (keys(classes()).length && !classDef(classId)) return null;
    var amount = Math.floor(num(n, 0));
    if (amount > 0) {
      st.cards[classId] = cardsOwned(classId) + amount;
      if (st.cards[classId] >= unlockCostFor(classId)) Progress.unlockClass(classId);
      Progress.save();
    }
    return Progress.cardInfo(classId);
  };

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

  /* Cartas do chefe [D9]. Devolve
   * [{classId, name, amount, cards, unlocked, stars, starUp}] (0 ou 1 entrada). */
  Progress.rollCards = function (dungeonId, roomIndex, partySize) {
    if (!Progress.state) Progress.load();
    var dungeon = dungeonDef(dungeonId);
    if (!dungeon) return [];
    if (!isBossRoom(dungeonId, roomIndex)) return [];

    // profundidade 0-based: `minDungeon` é 0-based, `order` é 1-based
    var depth = dungeonIndex(dungeonId);
    // `cardDrops` ausente = dado ainda não escrito (piscina geral);
    // `cardDrops: []` = decisão explícita de não derrubar carta nenhuma.
    var entries = isArray(dungeon.cardDrops) ? dungeon.cardDrops : null;
    var pool = [], i, classId, card, w;

    if (entries) {
      for (i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!isObj(e)) continue;
        classId = e.classId;
        card = cardDef(classId);
        if (!card || num(card.dropWeight, 0) <= 0) continue;
        if (depth < num(card.minDungeon, 0)) continue;
        w = Math.max(0, num(e.weight, 1)) * num(card.dropWeight, 0);
        if (w > 0) pool.push({ id: classId, w: w });
      }
    }
    if (!pool.length && entries === null) {
      var all = D().cards || {};
      for (classId in all) {
        if (!all.hasOwnProperty(classId)) continue;
        card = all[classId];
        if (!card || num(card.dropWeight, 0) <= 0) continue;
        if (depth < num(card.minDungeon, 0)) continue;
        pool.push({ id: classId, w: num(card.dropWeight, 0) });
      }
    }
    if (!pool.length) return [];

    var size = Math.max(1, Math.min(2, Math.round(num(partySize, 2))));
    if (Math.random() >= CARD_CHANCE[size]) return [];

    var chosen = pickWeighted(pool);
    if (!chosen) return [];

    var antes = Progress.cardInfo(chosen);
    var amount = 1 + Math.floor(Math.max(0, depth) / 2);   // fundo dá mais cartas
    var depois = Progress.addCards(chosen, amount);
    return [{
      classId: chosen,
      name: depois.name,
      amount: amount,
      cards: depois.cards,
      unlockCost: depois.unlockCost,
      unlocked: depois.unlocked,
      novaClasse: !antes.unlocked && depois.unlocked,
      stars: depois.stars,
      starUp: depois.stars - antes.stars,
      next: depois.next
    }];
  };

  // ============================================================ XP / níveis
  Progress.addXp = function (heroId, amount) {
    var h = ensureHero(heroId);
    if (!h) return 0;
    var amt = num(amount, 0);
    amt = isFinite(amt) ? Math.floor(amt) : 0;
    if (amt <= 0) return 0;
    var before = h.level;
    h.xp = Math.min(h.xp + amt, maxXp());
    h.level = levelForXp(h.xp);
    if (h.level !== before) syncSpells(heroId);
    Progress.save();
    return h.level - before;
  };

  /* Rendimento decrescente de XP em conteúdo fácil (§9-D) [D15].
   * Aceita heroId ou o nível cru. Devolve 1 quando faltar dado — nunca corta
   * por engano. Vale SÓ para XP: item, pedra e carta seguem sua raridade. */
  Progress.xpMultiplier = function (heroOrLevel, dungeonId) {
    var level = null;
    if (typeof heroOrLevel === 'number' && isFinite(heroOrLevel)) level = heroOrLevel;
    else {
      var h = Progress.hero(heroOrLevel);
      if (h) level = h.level;
    }
    if (level === null) return 1;
    var d = dungeonDef(dungeonId);
    var rec = d ? num(d.recommendedLevel, null) : null;
    var cfg = leveling().xpFalloff;
    if (rec === null || !isObj(cfg)) return 1;          // dado ausente: sem corte
    var acima = level - (rec + num(cfg.graceLevels, 0));
    if (acima <= 0) return 1;                            // dentro da faixa de graça
    var m = Math.pow(num(cfg.factorPerLevel, 1), acima); // queda geométrica
    return Math.max(num(cfg.floor, 0), m);               // com piso
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
    for (var i = 0; i < ids.length; i++) if (Progress.pendingElementChoice(ids[i])) out.push(ids[i]);
    return out;
  };

  Progress.chooseElement = function (heroId, element) {
    var h = Progress.hero(heroId);
    if (!h) return false;
    if (h.element !== DEFAULT_ELEMENT) return false;
    if (h.level < leveling().elementChoiceLevel) return false;
    if (typeof element !== 'string' || element === DEFAULT_ELEMENT) return false;
    if (indexOf(elements(), element) < 0) return false;
    var def = classDef(h.classId);
    if (def && def.paths && !isArray(def.paths[element])) return false;
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
    return num(unlockTiers()[tierIndex], 99);
  }

  /* Quantas peças de cada conjunto o herói está usando: {setId: n}.
   * Usado tanto pelos bônus de conjunto quanto pelo feitiço de conjunto. */
  function equippedSetCounts(h) {
    var counts = {};
    if (!h || !isObj(h.items)) return counts;
    for (var i = 0; i < SLOTS.length; i++) {
      var itId = h.items[SLOTS[i]];
      if (!itId) continue;
      var sid = setIdOf(itId);
      if (sid) counts[sid] = (counts[sid] || 0) + 1;
    }
    return counts;
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
    var lume = h.items && h.items[SPELL_SLOT];      // o espaço 'lume' concede feitiço
    if (lume) {
      var it = itemDef(lume);
      if (it && it.grantsSpell && indexOf(out, it.grantsSpell) < 0) out.push(it.grantsSpell);
    }
    // CONJUNTO que concede feitiço [D16]: qualquer `bonuses[n].grantsSpell`
    // vale quando o herói tem n peças daquele conjunto (genérico, sem id fixo).
    var counts = equippedSetCounts(h);
    var sets = setDefs();
    for (var sid in counts) {
      if (!counts.hasOwnProperty(sid)) continue;
      var sdef = sets[sid];
      if (!sdef || !isObj(sdef.bonuses)) continue;
      for (var need = 2; need <= counts[sid]; need++) {
        var b = sdef.bonuses[need] || sdef.bonuses[String(need)];
        if (b && b.grantsSpell && indexOf(out, b.grantsSpell) < 0) out.push(b.grantsSpell);
      }
    }
    return out;
  };

  function syncSpells(heroId) {
    var h = Progress.hero(heroId);
    if (h) h.spells = Progress.spellsFor(heroId);
    return h ? h.spells : [];
  }

  // ================================================= inventário único [D7]
  Progress.invIndexOf = function (itemId) {
    if (!Progress.state) return -1;
    var inv = Progress.state.inventory;
    for (var i = 0; i < inv.length; i++) if (inv[i].itemId === itemId) return i;
    return -1;
  };
  Progress.invEntry = function (itemId) {
    var i = Progress.invIndexOf(itemId);
    return i >= 0 ? Progress.state.inventory[i] : null;
  };
  Progress.itemLevel = function (itemId) {
    var e = Progress.invEntry(itemId);
    return e ? e.level : 0;
  };
  Progress.equippedBy = function (itemId) {
    var st = Progress.state;
    if (!st) return null;
    for (var hid in st.heroes) {
      if (!st.heroes.hasOwnProperty(hid)) continue;
      var it = st.heroes[hid].items;
      for (var i = 0; i < SLOTS.length; i++) if (it[SLOTS[i]] === itemId) return hid;
    }
    return null;
  };

  /* Entra no saco único. Item repetido vira pedras do elemento dele [D7]. */
  Progress.addItem = function (itemId) {
    if (!Progress.state || typeof itemId !== 'string') return false;
    var def = itemDef(itemId);
    if (!def) return false;
    if (Progress.invIndexOf(itemId) >= 0) {
      Progress.addStones(stoneIdForElement(def.element), DUP_ITEM_STONES);
      return false;                        // repetido: virou pedra
    }
    Progress.state.inventory.push({ itemId: itemId, level: 0 });
    Progress.save();
    return true;
  };

  Progress.addPet = function (petId) {
    if (!Progress.state || typeof petId !== 'string' || !petDef(petId)) return false;
    if (indexOf(Progress.state.pets, petId) >= 0) return false;
    for (var hid in Progress.state.heroes) {
      if (Progress.state.heroes.hasOwnProperty(hid) && Progress.state.heroes[hid].pet === petId) return false;
    }
    Progress.state.pets.push(petId);
    Progress.save();
    return true;
  };

  Progress.equip = function (heroId, itemId) {
    var it = itemDef(itemId);
    if (!it || indexOf(SLOTS, it.slot) < 0) return false;
    var h = ensureHero(heroId);
    if (!h) return false;
    if (Progress.invIndexOf(itemId) < 0) return false;          // precisa possuir
    var dono = Progress.equippedBy(itemId);
    if (dono !== null && dono !== heroId) return false;          // já está em uso [D7]
    if (h.items[it.slot] === itemId) return true;
    h.items[it.slot] = itemId;                                   // o anterior fica livre
    syncSpells(heroId);
    Progress.save();
    return true;
  };

  Progress.unequip = function (heroId, slot) {
    if (indexOf(SLOTS, slot) < 0) return false;
    var h = ensureHero(heroId);
    if (!h || !h.items[slot]) return false;
    h.items[slot] = null;                                        // continua no saco
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
      var owner = null;
      for (var hid in Progress.state.heroes) {
        if (Progress.state.heroes.hasOwnProperty(hid) && Progress.state.heroes[hid].pet === petId) {
          owner = hid; break;
        }
      }
      if (owner === null) return false;
      if (owner === heroId) return true;
      Progress.state.heroes[owner].pet = null;                   // transferência [D8]
    } else {
      pets.splice(idx, 1);
    }
    if (h.pet) pets.push(h.pet);
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

  // ============================================================ forja [D11]
  Progress.addStones = function (stoneId, n) {
    var st = Progress.state;
    if (!st || typeof stoneId !== 'string') return false;
    var amount = Math.floor(num(n, 0));
    if (amount <= 0) return false;
    if (!isObj(st.stones)) st.stones = {};
    st.stones[stoneId] = Math.max(0, Math.floor(num(st.stones[stoneId], 0))) + amount;
    Progress.save();
    return true;
  };
  Progress.stoneCount = function (stoneId) {
    var st = Progress.state;
    if (!st || !isObj(st.stones)) return 0;
    return Math.max(0, Math.floor(num(st.stones[stoneId], 0)));
  };

  function tierNameFor(level) {
    var tiers = upgradeCfg().tiers;
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      if (level >= num(t.from, 0) && level <= num(t.to, 0)) return t.name;
    }
    return tiers.length ? tiers[tiers.length - 1].name : '';
  }

  // pedra usada por um item: a do elemento dele; neutro usa a de maior estoque
  function stoneForItem(def) {
    var el = (def && def.element) || DEFAULT_ELEMENT;
    if (el !== DEFAULT_ELEMENT) return stoneIdForElement(el);
    var st = Progress.state;
    var best = stoneIdForElement(DEFAULT_ELEMENT), bestN = -1;
    var pool = keys(stoneDefs());
    if (!pool.length && st && isObj(st.stones)) pool = keys(st.stones);
    for (var i = 0; i < pool.length; i++) {
      var n = Progress.stoneCount(pool[i]);
      if (n > bestN) { bestN = n; best = pool[i]; }
    }
    return best;
  }

  Progress.upgradeInfo = function (invIndex) {
    var st = Progress.state;
    if (!st) return null;
    var entry = st.inventory[invIndex];
    if (!isObj(entry)) return null;
    var def = itemDef(entry.itemId);
    var up = upgradeCfg();
    var level = Math.max(0, Math.floor(num(entry.level, 0)));
    var maxLv = num(up.maxLevel, 10);
    var stoneId = stoneForItem(def);
    if (level >= maxLv) {
      return { itemId: entry.itemId, level: level, tierName: tierNameFor(level),
               custo: 0, stoneId: stoneId, temPedras: false, maxed: true };
    }
    var custo = Math.max(0, Math.floor(num(up.stoneCost[level], 0)));
    return {
      itemId: entry.itemId, level: level, tierName: tierNameFor(level),
      custo: custo, stoneId: stoneId,
      temPedras: Progress.stoneCount(stoneId) >= custo, maxed: false
    };
  };

  Progress.upgradeItem = function (invIndex) {
    var info = Progress.upgradeInfo(invIndex);
    if (!info || info.maxed || !info.temPedras) return false;
    var st = Progress.state;
    st.stones[info.stoneId] = Progress.stoneCount(info.stoneId) - info.custo;
    st.inventory[invIndex].level = info.level + 1;              // determinístico
    Progress.save();
    return true;
  };

  // ======================================================== stats efetivos [D13]
  function addStat(out, k, v, capPaPp) {
    if (!v) return;
    if (capPaPp && k === 'pa') v = Math.min(v, PA_ITEM_CAP);
    if (capPaPp && k === 'pp') v = Math.min(v, PP_ITEM_CAP);
    out[k] += v;
  }
  /* Soma um bloco de bônus. `mult` é o multiplicador da forja: só vale para os
   * atributos FORA de `nonScalingKeys` — pa/pp nunca escalam [D11]. */
  function applyBonuses(out, bonuses, capPaPp, mult) {
    if (!isObj(bonuses)) return;
    var m = (typeof mult === 'number' && isFinite(mult)) ? mult : 1;
    var noScale = upgradeCfg().nonScalingKeys || [];
    for (var i = 0; i < STAT_KEYS.length; i++) {
      var k = STAT_KEYS[i];
      var v = num(bonuses[k], 0);
      if (!v) continue;
      var val = (indexOf(noScale, k) >= 0) ? v : Math.round(v * m);
      addStat(out, k, val, capPaPp);
    }
    if (isObj(bonuses.resists)) {
      var mr = (indexOf(noScale, 'resists') >= 0) ? 1 : m;
      for (var e in bonuses.resists) {
        if (!bonuses.resists.hasOwnProperty(e)) continue;
        out.resists[e] = num(out.resists[e], 0) + Math.round(num(bonuses.resists[e], 0) * mr);
      }
    }
  }

  Progress.effectiveStats = function (heroId) {
    var h = Progress.hero(heroId);
    if (!h) return null;
    var def = classDef(h.classId);
    if (!def || !isObj(def.stats)) return null;
    var base = def.stats;
    var out = { hp: 0, pa: 0, pp: 0, power: 0, elemPower: 0, initiative: 0, dodge: 0, lock: 0,
                element: h.element || DEFAULT_ELEMENT, resists: {} };
    var i, k;
    for (i = 0; i < STAT_KEYS.length; i++) { k = STAT_KEYS[i]; out[k] = num(base[k], 0); }
    if (isObj(base.resists)) {
      for (k in base.resists) if (base.resists.hasOwnProperty(k)) out.resists[k] = num(base.resists[k], 0);
    }

    // ---- níveis [D14]: todo nível dá PV; o poder vira ELEMENTAL depois da escolha
    var lv = leveling();
    var per = lv.perLevel || {};
    var perEl = lv.perLevelElement || null;
    var ups = Math.max(0, h.level - 1);
    // subidas antes da escolha (níveis 1→4, ou seja `elementChoiceLevel - 2` subidas)
    var genericUps = Math.min(ups, Math.max(0, num(lv.elementChoiceLevel, 5) - 2));
    var elementalUps = ups - genericUps;
    var hasElement = (h.element && h.element !== DEFAULT_ELEMENT);

    out.hp += num(per.hp, 0) * genericUps +
              num(perEl && perEl.hp, num(per.hp, 0)) * elementalUps;
    out.power += num(per.power, 0) * genericUps;
    if (hasElement && perEl) {
      out.elemPower += num(perEl.elemPower, 0) * elementalUps;   // dano no elemento do herói
    } else {
      // sem elemento escolhido (ou dado antigo sem `perLevelElement`): poder genérico
      out.power += num(per.power, 0) * elementalUps;
    }

    // ---- itens equipados (com o multiplicador da forja) e contagem de conjuntos
    var up = upgradeCfg();
    var setCount = equippedSetCounts(h);
    for (i = 0; i < SLOTS.length; i++) {
      var itId = h.items[SLOTS[i]];
      if (!itId) continue;
      var it = itemDef(itId);
      if (!it) continue;
      var mult = 1 + num(up.bonusPerLevel, 0.12) * Progress.itemLevel(itId);
      applyBonuses(out, it.bonuses, true, mult);
    }

    // ---- conjuntos: progressivo e cumulativo (4 peças valem 2+3+4) [D10]
    var sets = setDefs();
    for (var sid2 in setCount) {
      if (!setCount.hasOwnProperty(sid2)) continue;
      var sdef = sets[sid2];
      if (!sdef || !isObj(sdef.bonuses)) continue;
      for (var need = 2; need <= setCount[sid2]; need++) {
        var b = sdef.bonuses[need] || sdef.bonuses[String(need)];
        if (isObj(b)) applyBonuses(out, b, false, 1);
      }
    }

    // ---- pet
    if (h.pet) {
      var pd = petDef(h.pet);
      if (pd) applyBonuses(out, pd.bonuses, true, 1);
    }

    // ---- estrelas da classe (fixas e permanentes) [D9]
    applyBonuses(out, starBonuses(h.classId), false, 1);

    out.hp = Math.max(1, Math.round(out.hp));
    out.pa = Math.max(0, Math.round(out.pa));
    out.pp = Math.max(0, Math.round(out.pp));
    out.elemPower = Math.max(0, Math.round(out.elemPower));
    return out;
  };

  // ============================================================ saque [D12]
  // expoente da Sorte de Saque para uma raridade (o DADO manda) [D12]
  function luckExponent(rarity) {
    var LW = D().lootWeights;
    if (isObj(LW) && isObj(LW.luckExponent)) return num(LW.luckExponent[rarity], 0);
    return num(RARITY_DEGREE[rarity], 0);
  }

  /* Piscina de saque de um calabouço [D12].
   * Preferência: os próprios itens de `DATA.items` daquele calabouço, com
   * `dropWeight` e `minRoom` calibrados pelo Criativo — é essa escala que o
   * peso de "nada" (`lootWeights.noDrop`) acompanha. Só na ausência deles cai
   * na `dungeon.lootTable` da v2.1 (e aí, sem "nada", para não desequilibrar). */
  function lootPool(dungeonId, roomIndex, luck) {
    var room = num(roomIndex, 0);
    var items = D().items || {};
    var pool = [], usouItens = false, id, it, w;
    for (id in items) {
      if (!items.hasOwnProperty(id)) continue;
      it = items[id];
      if (!it || it.dungeonId !== dungeonId) continue;
      if (num(it.dropWeight, 0) <= 0) continue;
      usouItens = true;
      if (room < num(it.minRoom, 0)) continue;          // épico/lendário: só no chefe
      w = num(it.dropWeight, 0) * Math.pow(luck, luckExponent(it.rarity));
      if (w > 0) pool.push({ id: id, w: w });
    }
    if (usouItens) return { pool: pool, itemBased: true };

    var dungeon = dungeonDef(dungeonId);
    var table = dungeon && dungeon.lootTable;
    if (!isArray(table)) return { pool: [], itemBased: false };
    for (var i = 0; i < table.length; i++) {
      var entry = table[i];
      if (!isObj(entry)) continue;
      it = itemDef(entry.itemId);
      var minRoom = Math.max(num(entry.minRoom, 0), num(it && it.minRoom, 0));
      if (room < minRoom) continue;
      w = Math.max(0, num(entry.weight, 0)) * Math.pow(luck, luckExponent(it && it.rarity));
      if (w > 0) pool.push({ id: entry.itemId, w: w });
    }
    return { pool: pool, itemBased: false };
  }

  Progress.rollDrops = function (dungeonId, roomIndex, partySize) {
    if (!Progress.state) Progress.load();
    var luck = luckFor(partySize);
    var built = lootPool(dungeonId, roomIndex, luck);
    var pool = built.pool;
    if (!pool.length) return [];

    // PESO DE "NADA": entra no mesmo sorteio das peças e é o que faz o saque
    // doer (~50% dos sorteios saem vazios). Não recebe a Sorte de Saque — é
    // justamente por isso que grupo menor tira mais e melhor. [D12]
    if (built.itemBased) {
      var LW = D().lootWeights;
      var nd = (isObj(LW) && isObj(LW.noDrop)) ? num(LW.noDrop[dungeonId], 0) : 0;
      if (nd > 0) pool = pool.concat([{ id: NO_DROP, w: nd }]);
    }

    var rolls = isBossRoom(dungeonId, roomIndex) ? 2 : 1;
    var drops = [];
    for (var r = 0; r < rolls; r++) {
      var chosen = pickWeighted(pool);
      if (!chosen || chosen === NO_DROP) continue;      // saiu "nada"
      drops.push(chosen);
      Progress.addItem(chosen);            // repetido vira pedras [D7]
    }
    Progress.save();
    return drops;
  };

  Progress.rollPet = function (dungeonId, roomIndex, partySize) {
    if (!Progress.state) Progress.load();
    if (!isBossRoom(dungeonId, roomIndex)) return null;
    var all = D().pets || {};
    var depth = dungeonIndex(dungeonId);
    var owned = {}, hid, id, i;
    for (i = 0; i < Progress.state.pets.length; i++) owned[Progress.state.pets[i]] = true;
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
      if (typeof dd === 'number' && depth < dd) continue;
      pool.push({ id: id, w: num(p.dropWeight, 0) });
    }
    if (!pool.length) return null;
    if (Math.random() >= Math.min(0.9, PET_CHANCE * luckFor(partySize))) return null;
    var chosen = pickWeighted(pool);
    if (!chosen) return null;
    Progress.addPet(chosen);
    return chosen;
  };

  // ========================================================= grupo de batalha
  /* Formato consumido por Engine.createBattle. Grupo de 1 ou 2 (§9-B):
   * heróis inválidos são ignorados e o excedente é cortado. */
  Progress.battleParty = function (heroIds) {
    var ids = isArray(heroIds) ? heroIds : Progress.heroIds();
    var out = [];
    for (var i = 0; i < ids.length && out.length < 2; i++) {
      var heroId = ids[i];
      var h = Progress.hero(heroId);
      if (!h) continue;
      var stats = Progress.effectiveStats(heroId);
      out.push({
        heroId: heroId,
        classId: h.classId,
        element: h.element || DEFAULT_ELEMENT,
        level: h.level,
        spells: Progress.spellsFor(heroId),
        pet: h.pet || null,
        items: clone(h.items),
        stars: Progress.cardInfo(h.classId).stars,
        elemPower: stats ? stats.elemPower : 0,   // §9-C: o motor consome na fórmula de dano
        stats: stats
      });
    }
    return out;
  };

  // inicializa ao carregar o script (os arquivos de DATA já rodaram)
  Progress.load();
})();
