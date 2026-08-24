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
 * [D7] INVENTÁRIO ÚNICO DE CÓPIAS (§9-B + pedido do usuário de 18/ago). Um saco
 *      só para todo o grupo, agora com uma entrada POR CÓPIA:
 *      `{itemId, level, stars}`. Duas botas iguais são DUAS entradas — é o que
 *      permite equipar uma em cada herói e é a matéria-prima das estrelas [D18].
 *      A tela agrupa as cópias idênticas num espaço só com um contador ×N
 *      (`invStacks()` faz o agrupamento; a UI não conta na mão).
 *      EQUIPAR TIRA DO SACO: a cópia sai do inventário e passa a viver no
 *      espaço do herói (`hero.items[slot]` = itemId, `hero.itemVar[slot]` =
 *      `{level, stars}` da cópia em uso). Ela fica presa ali até ser
 *      desequipada, e `unequip` devolve a MESMA cópia ao saco. Foi troca de
 *      modelo: antes o item equipado continuava no saco. O que se perdia com
 *      isso — forjar uma peça em uso — voltou por `upgradeWorn(heroId, slot)`.
 *      Item repetido no saque NÃO vira mais pedra: vira cópia, porque é ela que
 *      alimenta a fusão de estrelas. As pedras continuam caindo dos monstros.
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
 * [D18] ESTRELAS DE ITEM (pedido do usuário, 18/ago). Segunda trilha de poder,
 *       INDEPENDENTE da forja: juntar `FUSE_COPIES` (3) cópias IDÊNTICAS —
 *       mesmo item, mesmo `level` de forja e mesmo `stars` — funde tudo numa
 *       cópia só com uma estrela a mais, até `ITEM_STARS_MAX` (3). Como a
 *       escada é de 3 em 3 sobre o MESMO degrau, um ★3 custa 27 cópias.
 *       Exigir `level` igual é o que impede o truque de forjar uma cópia barata
 *       e herdar o nível na fusão. O ganho entra SOMANDO no multiplicador da
 *       forja (`itemMult`), nunca multiplicando: `1 + 0,12·nível + estrela`,
 *       com estrela em `STAR_BONUS` = 0 / +10% / +25% / +50%. Somar mantém o
 *       teto previsível (★3 +10 = 2,70× contra 2,20× do +10 de hoje); se os
 *       dois eixos se multiplicassem daria 3,30× e a esquiva de conjunto
 *       completo (§9-H) estouraria junto. `nonScalingKeys` (pa/pp) também vale
 *       para as estrelas — nenhuma trilha cria +2 PA.
 *       NÃO CONFUNDIR com as estrelas de CLASSE [D9], que vêm de cartas de
 *       chefe, vão até 5 e vivem em `cardInfo`. São sistemas distintos: aqui a
 *       estrela é de uma PEÇA e nasce de cópias repetidas.
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
 *
 * [D17] DEFESA DE POSIÇÃO POR NÍVEL (§9-H). `dodge` e `lock` caminham em linha
 *       reta da base da classe (nível 1) até o alvo do PAPEL no nível máximo,
 *       lido em `DATA.leveling.defenseByRole[role]`. A conta entra ANTES dos
 *       itens, dos conjuntos, do pet e das estrelas — tudo isso continua somando
 *       por cima. Sem a tabela no dado, o ganho é 0 e nada muda (a v2.6 volta
 *       inteira). Um alvo ABAIXO da base nunca encolhe a classe: vale 0.
 *       `Progress.defenseAtLevel(classId, nível)` expõe a curva para a UI.
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
  var UNLOCK_COST_FALLBACK = 10;         // dado ainda sem `unlockCost` [D9]

  // ---- estrelas de ITEM [D18] — a régua inteira mora nestas três linhas.
  // Trocar o custo (3 cópias por degrau) ou a curva de ganho é mexer aqui e em
  // mais lugar nenhum; `DATA.upgrade` pode sobrescrever sem tocar no código.
  var ITEM_STARS_MAX = 3;                     // ★ máximo de uma peça
  var FUSE_COPIES = 3;                        // cópias idênticas por degrau (★3 = 27)
  var STAR_BONUS = [0, 0.08, 0.18, 0.30];
  /* Curva medida, nao chutada. A forja sozinha ja vale 2,2x no +10
   * (0,12 por nivel), e forja e estrela SOMAM. Com a curva inicial de
   * 0,10/0,25/0,50 um item ★3 +10 chegava a 2,7x o item cru — acima do teto de
   * ~2x que eu mesmo tinha posto. Com esta, o topo do jogo fica em 2,5x.
   * A estrela vale menos que a forja de proposito: as 27 copias de um ★3 caem
   * sozinhas de tanto jogar, enquanto pedra o jogador cava. */     // somado ao multiplicador da forja
  var MAX_COPIES = 99;                        // teto por variante ao sanear save

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
      defenseByRole: isObj(lv.defenseByRole) ? lv.defenseByRole : null,         // §9-H [D17]
      elementChoiceLevel: num(lv.elementChoiceLevel, 5)
    };
  }

  /* [D17] §9-H — DEFESA DE POSIÇÃO POR NÍVEL.
   * Esquiva e fixação caminham em linha reta da base da classe (nível 1) até o alvo
   * do PAPEL no nível máximo. Sem `defenseByRole` no dado, devolve 0: a curva é
   * aditiva e o motor continua funcionando com os valores de antes. Nunca encolhe
   * uma base — um alvo abaixo da base é lido como "essa classe não cresce nisso". */
  function defenseGain(classId, level, stat, base) {
    var lv = leveling();
    var tbl = lv.defenseByRole;
    if (!tbl) return 0;
    var def = classDef(classId);
    var role = def && def.role;
    var row = role ? tbl[role] : null;
    if (!isObj(row)) return 0;
    var target = num(row[stat], null);
    if (target === null) return 0;
    var span = target - num(base, 0);
    if (span <= 0) return 0;
    var top = Math.max(2, num(lv.maxLevel, 30));
    var steps = Math.max(0, Math.min(num(level, 1), top) - 1);
    return Math.round(span * steps / (top - 1));
  }
  /* Exposto para a UI e para os testes mostrarem a curva sem montar um herói. */
  Progress.defenseAtLevel = function (classId, level) {
    var def = classDef(classId);
    var base = (def && isObj(def.stats)) ? def.stats : {};
    var d = num(base.dodge, 0), l = num(base.lock, 0);
    return {
      dodge: d + defenseGain(classId, level, 'dodge', d),
      lock: l + defenseGain(classId, level, 'lock', l)
    };
  };
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
      nonScalingKeys: isArray(u.nonScalingKeys) ? u.nonScalingKeys : UPGRADE_DEFAULT.nonScalingKeys,
      // A FORJA ARRISCADA — cópia campo a campo: TODO campo novo do
      // DATA.upgrade precisa entrar AQUI, senão some sem erro nenhum (foi o
      // que engoliu riskFrom/chances/guardStone no dia em que nasceram; o
      // teste da forja pegou — mesmo golpe do CLASS_LOOK e do titulo).
      riskFrom: num(u.riskFrom, 99),
      chances: isObj(u.chances) ? u.chances : {},
      guardStone: (typeof u.guardStone === 'string') ? u.guardStone : null
    };
  }

  /* ---- régua das estrelas de ITEM [D18]. O dado pode mandar (`DATA.upgrade`
   * .maxStars / .fuseCopies / .starBonus); sem ele valem as constantes daqui. */
  function starItemCfg() {
    var u = D().upgrade;
    var b = (isObj(u) && isArray(u.starBonus) && u.starBonus.length) ? u.starBonus : STAR_BONUS;
    var mx = (isObj(u) && num(u.maxStars, null) !== null) ? Math.floor(num(u.maxStars, ITEM_STARS_MAX))
                                                          : ITEM_STARS_MAX;
    var cp = (isObj(u) && num(u.fuseCopies, null) !== null) ? Math.floor(num(u.fuseCopies, FUSE_COPIES))
                                                            : FUSE_COPIES;
    return {
      max: Math.max(0, Math.min(mx, b.length - 1)),
      copies: Math.max(2, cp),
      bonus: b
    };
  }
  Progress.starCfg = starItemCfg;        // a UI lê o custo e a curva daqui
  function clampLevel(v) {
    return Math.max(0, Math.min(num(upgradeCfg().maxLevel, 10), Math.floor(num(v, 0))));
  }
  function clampStars(v) {
    return Math.max(0, Math.min(starItemCfg().max, Math.floor(num(v, 0))));
  }
  function starBonusOf(stars) {
    var cfg = starItemCfg();
    var s = Math.max(0, Math.min(Math.floor(num(stars, 0)), cfg.bonus.length - 1));
    return num(cfg.bonus[s], 0);
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
  // [D7] a variante (forja e estrelas) da CÓPIA que está em cada espaço
  function emptyVars() { return { punho: null, passo: null, casca: null, lume: null }; }

  function newHero(classId) {
    return {
      classId: classId, element: DEFAULT_ELEMENT, xp: 0, level: 1,
      spells: [], items: emptyItems(), itemVar: emptyVars(), pet: null
    };
  }

  function freshState() {
    var st = { version: 22, unlockedClasses: [], heroes: {}, inventory: [], pets: [], cards: {}, stones: {} };
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
    var st = { version: 22, unlockedClasses: [], heroes: {}, inventory: [], pets: [], cards: {}, stones: {} };
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

    /* ---- inventário: UMA entrada por cópia [D7].
     * Aceita as três formas já gravadas em disco: string solta (v2.0),
     * `{itemId, level}` (v2.1, uma entrada por item) e `{itemId, level, stars,
     * count}` (a de agora). `count` existe para o save não inchar quando o
     * jogador acumular 27 cópias mirando uma ★3. */
    function pushItem(itemId, level, stars, count) {
      if (typeof itemId !== 'string' || !itemDef(itemId)) return;
      var lv = clampLevel(level);
      var sr = clampStars(stars);
      var n = Math.max(1, Math.min(MAX_COPIES, Math.floor(num(count, 1))));
      for (var c = 0; c < n; c++) st.inventory.push({ itemId: itemId, level: lv, stars: sr });
    }
    if (isArray(raw.inventory)) {
      for (i = 0; i < raw.inventory.length; i++) {
        var entry = raw.inventory[i];
        if (typeof entry === 'string') pushItem(entry, 0, 0, 1);
        else if (isObj(entry)) pushItem(entry.itemId, entry.level, entry.stars, entry.count);
      }
    }
    /* Tira do saco a melhor cópia de um item (mais estrelas, depois mais forja).
     * É como o save ANTIGO migra: lá o item equipado também aparecia no saco, e
     * as duas linhas descreviam UMA peça só — deixar as duas viraria duplicação. */
    function takeFromBag(itemId) {
      var best = -1;
      for (var k = 0; k < st.inventory.length; k++) {
        var e = st.inventory[k];
        if (e.itemId !== itemId) continue;
        if (best < 0 || e.stars > st.inventory[best].stars ||
            (e.stars === st.inventory[best].stars && e.level > st.inventory[best].level)) best = k;
      }
      if (best < 0) return null;
      var taken = st.inventory.splice(best, 1)[0];
      return { level: taken.level, stars: taken.stars };
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
          var srcVars = isObj(src.itemVar) ? src.itemVar : null;
          for (var rawSlot in src.items) {
            if (!src.items.hasOwnProperty(rawSlot)) continue;
            var slot = SLOT_ALIASES[rawSlot] || rawSlot;   // migra pa/pp/vida/especial
            if (indexOf(SLOTS, slot) < 0) continue;
            var itId = src.items[rawSlot];
            if (typeof itId !== 'string') continue;
            var it = itemDef(itId);
            if (!it || it.slot !== slot) continue;
            /* `itemVar` é o carimbo do modelo NOVO: quem o tem descreve uma
             * cópia que já saiu do saco ao ser equipada, e por isso não desconta
             * nada. Sem ele o save é antigo (equipado morava no saco também):
             * vale a exclusividade de então — um dono por item — e a cópia
             * correspondente sai do saco para não virar duas peças. */
            var v = srcVars && isObj(srcVars[rawSlot] || srcVars[slot])
                  ? (srcVars[rawSlot] || srcVars[slot]) : null;
            if (v) {
              h.items[slot] = itId;
              h.itemVar[slot] = { level: clampLevel(v.level), stars: clampStars(v.stars) };
            } else {
              if (equippedSeen[itId]) continue;    // exclusividade do modelo antigo
              equippedSeen[itId] = true;
              h.items[slot] = itId;
              h.itemVar[slot] = takeFromBag(itId) || { level: 0, stars: 0 };
            }
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
      if (!isObj(h.itemVar)) h.itemVar = emptyVars();
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
  /* Ids de classe que mudaram de nome, e o que era antes.
   *
   * O save guarda o `classId` de cada heroi. Quando um id muda, o heroi salvo
   * aponta para uma classe que nao existe mais — e SOME da lista sem aviso, que
   * e o pior jeito de perder o progresso de alguem.
   *
   * `curandeira` virou `curandeiro` quando a Paladina passou a ser o Curandeiro
   * (ver docs/CLASSES_V3.md). A migracao roda na carga e e idempotente. */
  var CLASSE_RENOMEADA = { curandeira: 'curandeiro' };

  function migraClasses(save) {
    if (!save || !save.heroes) return 0;
    var n = 0;
    for (var id in save.heroes) {
      if (!save.heroes.hasOwnProperty(id)) continue;
      var h = save.heroes[id];
      var novo = h && CLASSE_RENOMEADA[h.classId];
      if (novo) { h.classId = novo; n++; }
    }
    return n;
  }

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
    // ANTES de qualquer coisa ler o heroi: id de classe renomeado precisa virar
    // o novo, senao `syncSpells` abaixo procura uma classe que nao existe e o
    // heroi some da lista sem aviso.
    migraClasses(st);
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

  // ================================= inventário único, uma entrada por cópia [D7]
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
  /* Cópias LIVRES no saco (o que a grade mostra como ×N). */
  Progress.invCount = function (itemId) {
    if (!Progress.state) return 0;
    var inv = Progress.state.inventory, n = 0;
    for (var i = 0; i < inv.length; i++) if (inv[i].itemId === itemId) n++;
    return n;
  };
  /* Cópias que o jogador tem no mundo: as do saco mais as vestidas. */
  Progress.ownedCount = function (itemId) {
    return Progress.invCount(itemId) + Progress.equippedByAll(itemId).length;
  };
  /* A variante que está num espaço do herói: {itemId, level, stars} ou null. */
  Progress.equippedVar = function (heroId, slot) {
    var h = Progress.hero(heroId);
    if (!h || indexOf(SLOTS, slot) < 0 || !h.items[slot]) return null;
    var v = (isObj(h.itemVar) && isObj(h.itemVar[slot])) ? h.itemVar[slot] : null;
    return { itemId: h.items[slot], level: v ? num(v.level, 0) : 0, stars: v ? num(v.stars, 0) : 0 };
  };
  /* Melhor cópia CONHECIDA do item (saco ou vestida) — usada só para exibição;
   * quem calcula stat lê a variante do próprio espaço [D18]. */
  Progress.itemLevel = function (itemId) {
    var best = 0, i, hid;
    var st = Progress.state;
    if (!st) return 0;
    for (i = 0; i < st.inventory.length; i++) {
      if (st.inventory[i].itemId === itemId) best = Math.max(best, num(st.inventory[i].level, 0));
    }
    for (hid in st.heroes) {
      if (!st.heroes.hasOwnProperty(hid)) continue;
      for (i = 0; i < SLOTS.length; i++) {
        var v = Progress.equippedVar(hid, SLOTS[i]);
        if (v && v.itemId === itemId) best = Math.max(best, v.level);
      }
    }
    return best;
  };
  Progress.itemStars = function (itemId) {
    var best = 0, i, hid;
    var st = Progress.state;
    if (!st) return 0;
    for (i = 0; i < st.inventory.length; i++) {
      if (st.inventory[i].itemId === itemId) best = Math.max(best, num(st.inventory[i].stars, 0));
    }
    for (hid in st.heroes) {
      if (!st.heroes.hasOwnProperty(hid)) continue;
      for (i = 0; i < SLOTS.length; i++) {
        var v = Progress.equippedVar(hid, SLOTS[i]);
        if (v && v.itemId === itemId) best = Math.max(best, v.stars);
      }
    }
    return best;
  };
  /* FUNDIR TRÊS IGUAIS NUMA ESTRELA [D19].
   * Regra do usuário: "juntando 3 itens iguais ela ganha uma estrela e assim
   * indo até 3 estrelas", e ele escolheu o caminho caro — 3 peças de ★N viram
   * uma ★N+1, então um ★3 custa 27 cópias.
   * Consome do INVENTÁRIO apenas: peça equipada não some do herói sem aviso.
   * Devolve {ok, stars, usadas} ou {ok:false, motivo}. */
  Progress.canMergeItem = function (itemId, stars) {
    var st = Progress.state;
    if (!st) return { ok: false, motivo: 'sem save' };
    var cfg = starItemCfg();
    var alvo = num(stars, 0);
    if (alvo >= num(cfg.max, 3)) return { ok: false, motivo: 'já está no máximo' };
    var precisa = num(cfg.copies, 3);
    var tem = 0;
    for (var i = 0; i < st.inventory.length; i++) {
      if (st.inventory[i].itemId === itemId && num(st.inventory[i].stars, 0) === alvo &&
          num(st.inventory[i].level, 0) === 0) tem++;
    }
    return tem >= precisa
      ? { ok: true, tem: tem, precisa: precisa }
      : { ok: false, motivo: 'faltam ' + (precisa - tem), tem: tem, precisa: precisa };
  };
  /* `stars` é o degrau DE ONDE se funde: 0 junta três sem estrela e devolve ★1. */
  Progress.mergeItem = function (itemId, stars) {
    var st = Progress.state;
    var alvo = num(stars, 0);
    var pode = Progress.canMergeItem(itemId, alvo);
    if (!pode.ok) return pode;
    var cfg = starItemCfg();
    var precisa = num(cfg.copies, 3);
    var usadas = 0;
    // consome de trás para frente para não embaralhar os índices
    for (var i = st.inventory.length - 1; i >= 0 && usadas < precisa; i--) {
      var e = st.inventory[i];
      if (e.itemId === itemId && num(e.stars, 0) === alvo && num(e.level, 0) === 0) {
        st.inventory.splice(i, 1);
        usadas++;
      }
    }
    // a peça que sobe é uma nova entrada, sem forja (a forja não se herda:
    // as três consumidas tinham de estar em +0, cobrado no `canMergeItem`)
    st.inventory.push({ itemId: itemId, level: 0, stars: alvo + 1 });
    Progress.save();
    return { ok: true, stars: alvo + 1, usadas: usadas };
  };

  /* Multiplicador de bônus de uma peça: forja e estrelas SOMAM [D18]. */
  Progress.itemMult = function (level, stars) {
    return 1 + num(upgradeCfg().bonusPerLevel, 0.12) * Math.max(0, num(level, 0)) +
           starBonusOf(stars);
  };
  Progress.equippedBy = function (itemId) {
    var all = Progress.equippedByAll(itemId);
    return all.length ? all[0] : null;
  };
  /* TODOS os heróis usando uma cópia deste item (com 2 cópias, podem ser 2). */
  Progress.equippedByAll = function (itemId) {
    var st = Progress.state, out = [];
    if (!st) return out;
    for (var hid in st.heroes) {
      if (!st.heroes.hasOwnProperty(hid)) continue;
      var it = st.heroes[hid].items;
      for (var i = 0; i < SLOTS.length; i++) {
        if (it[SLOTS[i]] === itemId) { out.push(hid); break; }
      }
    }
    return out;
  };

  /* Cópias do saco agrupadas para a tela: um espaço por variante, com ×N.
   * A UI NÃO conta na mão — pediria o mesmo laço em três lugares. */
  Progress.invStacks = function () {
    var st = Progress.state;
    if (!st) return [];
    var out = [], mapa = {};
    for (var i = 0; i < st.inventory.length; i++) {
      var e = st.inventory[i];
      var chave = e.itemId + '|' + num(e.level, 0) + '|' + num(e.stars, 0);
      if (mapa.hasOwnProperty(chave)) { mapa[chave].count++; mapa[chave].indices.push(i); continue; }
      var stack = { itemId: e.itemId, level: num(e.level, 0), stars: num(e.stars, 0),
                    count: 1, index: i, indices: [i] };
      mapa[chave] = stack;
      out.push(stack);
    }
    return out;
  };

  /* Índice da melhor cópia livre: mais estrelas, depois mais forja. */
  function bestFreeIndex(itemId) {
    var inv = Progress.state.inventory, best = -1;
    for (var i = 0; i < inv.length; i++) {
      if (inv[i].itemId !== itemId) continue;
      if (best < 0 || inv[i].stars > inv[best].stars ||
          (inv[i].stars === inv[best].stars && inv[i].level > inv[best].level)) best = i;
    }
    return best;
  }

  /* Entra no saco único. Repetido agora vira CÓPIA (matéria da fusão) [D7]. */
  Progress.addItem = function (itemId) {
    if (!Progress.state || typeof itemId !== 'string') return false;
    if (!itemDef(itemId)) return false;
    Progress.state.inventory.push({ itemId: itemId, level: 0, stars: 0 });
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

  /* Equipar TIRA a cópia do saco [D7]. `invIndex` escolhe qual cópia (a grade
   * manda o índice do espaço tocado); sem ele vai a melhor livre. O que estava
   * no espaço volta para o saco na hora. */
  Progress.equip = function (heroId, itemId, invIndex) {
    var it = itemDef(itemId);
    if (!it || indexOf(SLOTS, it.slot) < 0) return false;
    var h = ensureHero(heroId);
    if (!h) return false;
    if (h.items[it.slot] === itemId &&
        (typeof invIndex !== 'number' || invIndex < 0)) return true;   // já está nele
    var inv = Progress.state.inventory;
    var idx = (typeof invIndex === 'number' && inv[invIndex] && inv[invIndex].itemId === itemId)
            ? invIndex : bestFreeIndex(itemId);
    if (idx < 0) return false;                                   // nenhuma cópia livre
    var copia = inv.splice(idx, 1)[0];
    if (!isObj(h.itemVar)) h.itemVar = emptyVars();
    devolveAoSaco(h, it.slot);                                   // o anterior fica livre
    h.items[it.slot] = itemId;
    h.itemVar[it.slot] = { level: num(copia.level, 0), stars: num(copia.stars, 0) };
    syncSpells(heroId);
    Progress.save();
    return true;
  };

  /* Devolve ao saco a cópia que está num espaço (sem salvar — quem chama salva). */
  function devolveAoSaco(h, slot) {
    var itId = h.items[slot];
    if (!itId) return false;
    var v = (isObj(h.itemVar) && isObj(h.itemVar[slot])) ? h.itemVar[slot] : null;
    Progress.state.inventory.push({
      itemId: itId, level: v ? num(v.level, 0) : 0, stars: v ? num(v.stars, 0) : 0
    });
    h.items[slot] = null;
    if (isObj(h.itemVar)) h.itemVar[slot] = null;
    return true;
  }

  Progress.unequip = function (heroId, slot) {
    if (indexOf(SLOTS, slot) < 0) return false;
    var h = ensureHero(heroId);
    if (!h || !h.items[slot]) return false;
    devolveAoSaco(h, slot);                                      // a MESMA cópia volta
    syncSpells(heroId);
    Progress.save();
    return true;
  };

  // ================================================ estrelas de item (fusão) [D18]
  /* Situação da fusão da variante que está em `invIndex`: quantas cópias
   * idênticas existem, quantas faltam e se dá para fundir agora. */
  Progress.fuseInfo = function (invIndex) {
    var st = Progress.state;
    if (!st) return null;
    var alvo = st.inventory[invIndex];
    if (!isObj(alvo)) return null;
    var cfg = starItemCfg();
    var stars = num(alvo.stars, 0), level = num(alvo.level, 0);
    var iguais = [];
    for (var i = 0; i < st.inventory.length; i++) {
      var e = st.inventory[i];
      if (e.itemId === alvo.itemId && num(e.level, 0) === level && num(e.stars, 0) === stars) {
        iguais.push(i);
      }
    }
    var maxed = stars >= cfg.max;
    return {
      itemId: alvo.itemId, level: level, stars: stars,
      copias: iguais.length, precisa: cfg.copies,
      faltam: maxed ? 0 : Math.max(0, cfg.copies - iguais.length),
      maxed: maxed,
      proxima: maxed ? stars : stars + 1,
      pode: !maxed && iguais.length >= cfg.copies
    };
  };

  /* Funde `FUSE_COPIES` cópias IDÊNTICAS numa só com +1 estrela. As três têm de
   * ter o MESMO nível de forja — é o que impede herdar forja de graça [D18].
   * Devolve a cópia nova (com o índice novo) ou null. */
  Progress.fuseItem = function (invIndex) {
    var info = Progress.fuseInfo(invIndex);
    if (!info || !info.pode) return null;
    var st = Progress.state;
    var alvos = [];
    for (var i = 0; i < st.inventory.length && alvos.length < info.precisa; i++) {
      var e = st.inventory[i];
      if (e.itemId === info.itemId && num(e.level, 0) === info.level &&
          num(e.stars, 0) === info.stars) alvos.push(i);
    }
    for (var k = alvos.length - 1; k >= 0; k--) st.inventory.splice(alvos[k], 1);
    var nova = { itemId: info.itemId, level: info.level, stars: info.stars + 1 };
    st.inventory.push(nova);
    Progress.save();
    return { itemId: nova.itemId, level: nova.level, stars: nova.stars,
             index: st.inventory.length - 1 };
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

  /* Núcleo da forja: o que custa subir esta peça deste nível, seja ela do saco
   * ou já vestida. `upgradeInfo` (saco) e `upgradeInfoWorn` (vestida) só dizem
   * DE ONDE vêm o item e o nível. */
  function forgeInfo(itemId, rawLevel, stars) {
    var def = itemDef(itemId);
    if (!def) return null;
    var up = upgradeCfg();
    var level = Math.max(0, Math.floor(num(rawLevel, 0)));
    var maxLv = num(up.maxLevel, 10);
    var stoneId = stoneForItem(def);
    var estrelas = Math.max(0, Math.floor(num(stars, 0)));
    if (level >= maxLv) {
      return { itemId: itemId, level: level, stars: estrelas, tierName: tierNameFor(level),
               custo: 0, stoneId: stoneId, temPedras: false, maxed: true };
    }
    var custo = Math.max(0, Math.floor(num(up.stoneCost[level], 0)));
    // O RISCO da batida: até riskFrom-1 é seguro; dali em diante a chance
    // vem da tabela e a falha REGRIDE — a menos que a Âncora vá junto.
    var riskFrom = num(up.riskFrom, 99);
    var arriscado = level >= riskFrom;
    var chance = arriscado
      ? Math.max(0.05, Math.min(1, num((up.chances || {})[level], 0.25)))
      : 1;
    var guardaId = up.guardStone || null;
    return {
      itemId: itemId, level: level, stars: estrelas, tierName: tierNameFor(level),
      custo: custo, stoneId: stoneId,
      temPedras: Progress.stoneCount(stoneId) >= custo, maxed: false,
      arriscado: arriscado, chance: chance,
      guardaId: guardaId,
      guardas: guardaId ? Progress.stoneCount(guardaId) : 0
    };
  }

  /* O DADO da forja, com o seam para o teste cravar o resultado. */
  Progress._forjaRng = null;
  function rolaForja() {
    var fn = Progress._forjaRng || Math.random;
    return fn();
  }
  /* Consome a Âncora quando ela vai junto (batida arriscada + escolha). */
  function pagaGuarda(info, usarGuarda) {
    if (!info.arriscado || !usarGuarda) return { usou: false, ok: true };
    if (!info.guardaId || info.guardas < 1) return { usou: false, ok: false };
    var st = Progress.state;
    if (!isObj(st.stones)) st.stones = {};
    st.stones[info.guardaId] = Progress.stoneCount(info.guardaId) - 1;
    return { usou: true, ok: true };
  }
  /* O desfecho de uma batida: subiu, segurou (âncora) ou caiu. */
  function desfecho(info, usarGuarda) {
    var guarda = pagaGuarda(info, usarGuarda);
    if (!guarda.ok) return null;                       // pediu âncora sem ter
    if (!info.arriscado || rolaForja() < info.chance) {
      return { resultado: 'subiu', nivel: info.level + 1 };
    }
    return guarda.usou
      ? { resultado: 'segurou', nivel: info.level }
      : { resultado: 'caiu', nivel: Math.max(0, info.level - 1) };
  }

  Progress.upgradeInfo = function (invIndex) {
    var st = Progress.state;
    if (!st) return null;
    var entry = st.inventory[invIndex];
    if (!isObj(entry)) return null;
    return forgeInfo(entry.itemId, entry.level, entry.stars);
  };
  /* Forjar sem desequipar: a peça em uso também sobe [D7]. */
  Progress.upgradeInfoWorn = function (heroId, slot) {
    var v = Progress.equippedVar(heroId, slot);
    return v ? forgeInfo(v.itemId, v.level, v.stars) : null;
  };
  function pagaPedras(info) {
    if (!info || info.maxed || !info.temPedras) return false;
    var st = Progress.state;
    if (!st) return false;
    if (!isObj(st.stones)) st.stones = {};
    st.stones[info.stoneId] = Progress.stoneCount(info.stoneId) - info.custo;
    return true;
  }
  Progress.upgradeWorn = function (heroId, slot, usarGuarda) {
    var h = Progress.hero(heroId);
    var info = Progress.upgradeInfoWorn(heroId, slot);
    if (!h || !info) return false;
    // a Âncora se valida ANTES de cobrar as pedras: recusar depois de pagar
    // seria cobrar a batida que não houve (o teste pegou a ordem errada)
    if (usarGuarda && info.arriscado && (!info.guardaId || info.guardas < 1)) return false;
    if (!pagaPedras(info)) return false;
    var fim = desfecho(info, usarGuarda);
    if (!fim) return false;
    if (!isObj(h.itemVar)) h.itemVar = emptyVars();
    var v = isObj(h.itemVar[slot]) ? h.itemVar[slot] : { level: 0, stars: 0 };
    h.itemVar[slot] = { level: fim.nivel, stars: num(v.stars, 0) };
    Progress.save();
    return fim;
  };

  Progress.upgradeItem = function (invIndex, usarGuarda) {
    var info = Progress.upgradeInfo(invIndex);
    if (!info) return false;
    if (usarGuarda && info.arriscado && (!info.guardaId || info.guardas < 1)) return false;
    if (!pagaPedras(info)) return false;
    var fim = desfecho(info, usarGuarda);
    if (!fim) return false;
    Progress.state.inventory[invIndex].level = fim.nivel;
    Progress.save();
    return fim;
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

    // §9-H [D17]: esquiva e fixação também sobem com o nível, no ritmo do PAPEL
    out.dodge += defenseGain(h.classId, h.level, 'dodge', out.dodge);
    out.lock += defenseGain(h.classId, h.level, 'lock', out.lock);

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
    var setCount = equippedSetCounts(h);
    for (i = 0; i < SLOTS.length; i++) {
      var itId = h.items[SLOTS[i]];
      if (!itId) continue;
      var it = itemDef(itId);
      if (!it) continue;
      // a variante da CÓPIA em uso manda: forja e estrelas daquela peça [D7][D18]
      var vv = (isObj(h.itemVar) && isObj(h.itemVar[SLOTS[i]])) ? h.itemVar[SLOTS[i]] : null;
      var mult = Progress.itemMult(vv ? vv.level : 0, vv ? vv.stars : 0);
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
    out.dodge = Math.max(0, Math.round(out.dodge));
    out.lock = Math.max(0, Math.round(out.lock));
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

  Progress.rollDrops = function (dungeonId, roomIndex, partySize, multDrop) {
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
      /* A DIFICULDADE MEXE NO PESO DE "NADA", e nao no numero de sorteios.
       *
       * Este peso E a taxa de drop: ele e o que faz ~metade dos sorteios sairem
       * vazios. Dividi-lo por 1,5 e exatamente "50% mais drop", e a conta
       * continua valendo para toda a tabela de raridade — as pecas boas
       * continuam raras em relacao as ruins, so sai "nada" com menos frequencia.
       *
       * Somar sorteios teria sido a saida obvia e estaria errada: 1,5 sorteio
       * nao existe, e arredondar para 2 daria +100% em vez de +50%. */
      var md = (typeof multDrop === 'number' && isFinite(multDrop) && multDrop > 0) ? multDrop : 1;
      if (md !== 1 && nd > 0) nd = nd / md;
      if (nd > 0) pool = pool.concat([{ id: NO_DROP, w: nd }]);
    }

    var rolls = isBossRoom(dungeonId, roomIndex) ? 2 : 1;
    var drops = [];
    for (var r = 0; r < rolls; r++) {
      var chosen = pickWeighted(pool);
      if (!chosen || chosen === NO_DROP) continue;      // saiu "nada"
      drops.push(chosen);
      Progress.addItem(chosen);            // repetido vira CÓPIA (fusão) [D7][D18]
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
        itemVar: clone(h.itemVar || {}),          // forja e ★ da cópia em uso [D18]
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
