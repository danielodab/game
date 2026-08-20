var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* ============================================================================
 * SOTERRA 2.0 — js/core/engine.js  (dono: Lógica Combate)
 * Motor determinístico, sem DOM (não acessa document/window além do guard).
 * Evolução direta do motor v1 (62/62 testes): BFS, LoS Bresenham, castTargets,
 * aoeTiles, os 15 efeitos v1, os 5 traços, fila de eventos e determinismo
 * continuam idênticos. O que muda está marcado com "v2".
 *
 * NOMENCLATURA (contrato §0): `pa` = Pontos de Ataque, `pp` = Pontos de Passos.
 * A sigla de movimento da v1 foi aposentada e não sobrevive em nenhum campo,
 * evento, texto ou comentário deste projeto — só existe `pp`/`ppMax`.
 *
 * ---------------------------------------------------------------------------
 * DECISÕES DE DESIGN v1 (mantidas — o contrato é omisso nesses pontos):
 *  - RNG determinístico (mulberry32) semeado por dungeonId/roomIndex/party:
 *    a mesma batalha com as mesmas ações produz os mesmos números.
 *  - Recarga (cooldown) N: o feitiço fica indisponível por N turnos COMPLETOS
 *    do dono após o turno em que foi lançado (relança no turno N+1 seguinte).
 *  - Durações: efeitos "por X turnos" decrementam no FIM do turno da vítima.
 *    poison/regen ticam no INÍCIO do turno da vítima (X ticks para duração X).
 *  - AoE ofensiva (damage/poison/push/pull/mark/…) NUNCA atinge o próprio
 *    conjurador. Fogo amigo em ALIADOS existe — posicionamento importa.
 *  - Push: direção fixa = eixo dominante do vetor conjurador→alvo (empate =
 *    horizontal). Pull: passo a passo em direção ao conjurador. Colisão: 10 de
 *    dano por célula bloqueada, dano FIXO, absorvível por escudo. pushImmune
 *    bloqueia push E pull. swap/teleport ignoram pushImmune.
 *  - Lifesteal: cura = round(dano efetivo em PV / 2).
 *  - Poison guarda o power do conjurador no cast; a resistência é lida no tick.
 *  - explodeOnDeath / split / enrage / regenAura: idênticos à v1.
 *  - Buff de initiative altera o valor mas NÃO reordena a batalha em curso.
 *  - Se os dois lados caírem no mesmo encadeamento, a derrota prevalece.
 *  - Invisibilidade restringe apenas a IA; quebra ao conjurar dano.
 *  - LoS: Bresenham entre centros; só PAREDE ALTA ('#') estritamente entre os
 *    extremos bloqueia.
 *  - Feitiço com 'swap' exige unidade viva no alvo; needsEmptyTile exige vazio.
 *
 * ---------------------------------------------------------------------------
 * DECISÕES DE DESIGN v2 (novas — documentadas porque o contrato não fecha):
 *  1. TERRENO: '=' vira tile `cover` (obstáculo BAIXO): bloqueia passagem, não
 *     bloqueia visão. '#' = `wall` (alto, bloqueia os dois). '~' = `hole`.
 *  2. FEITIÇOS MODULARES: `Engine.spell(id)` resolve em DATA.spells,
 *     DATA.monsterSpells, DATA.petSpells, DATA.itemSpells e no registro em
 *     memória (feitiços de fusão). TODO acesso interno passa por ela.
 *  3. CLIMA: `+5/−5` PV direto no início do turno da unidade — ignora escudo e
 *     resistência (é ambiente, não ataque), nunca passa de hpMax, pode matar.
 *     Só emite `weatherTick` quando o saldo é diferente de zero (clima neutro
 *     para aquele elemento não gera evento). Ciclo automático: quando
 *     `dungeon.weatherShiftEveryRounds > 0`, o clima avança um passo do ciclo
 *     (`dungeon.weatherCycle` ou as chaves de DATA.weathers) toda vez que
 *     `(round-1) % N === 0`, a partir da rodada N+1.
 *  4. ESQUIVA/FIXAÇÃO: o teste acontece UMA vez por chamada de `Engine.move`,
 *     contra o inimigo adjacente à célula de PARTIDA que deixa de ser adjacente
 *     na célula de DESTINO — e, havendo vários, contra o PIOR deles (menor
 *     chance de sucesso). Isso mantém `Engine.reachable().risky` e `move` em
 *     acordo perfeito (a UI marca exatamente as células que arriscam teste).
 *     Falhando, o movimento é CANCELADO (`move` devolve false) e a unidade
 *     perde todo o PP restante — é isso que dá dentes à Fixação; "perder o PP
 *     restante" e ainda assim andar seria contraditório.
 *     Falha crítica: o contrato escreve `roll < chance/3`, mas o roll do teste
 *     já é ≥ chance quando falha; a falha crítica usa portanto um SEGUNDO
 *     sorteio com a fórmula literal do contrato.
 *     Movimento forçado (push/pull/teleport/swap/moveTo) NÃO testa esquiva.
 *  5. MARCAS: `mark.value` é o percentual por pilha; o multiplicador de dano é
 *     `1 + Σ(value das pilhas)/100`, que com o `value: 5` canônico reproduz
 *     exatamente `(1 + marcas*0.05)` do contrato §3. Estourado o `max`, uma
 *     nova marca RENOVA a duração da pilha mais antiga em vez de empilhar.
 *  6. detonateMarks: dano = round(pilhas * mult), literal — sem power, sem
 *     resistência e sem o multiplicador de marcas (elas foram consumidas).
 *     Escudo ainda absorve.
 *  7. ARMADILHA: fica na célula com `duration` em RODADAS; dispara para quem
 *     NÃO é do lado de quem armou, ao pisar durante um `Engine.move`
 *     deliberado (movimento forçado não pisa em armadilha — evita recursão).
 *     O feitiço da armadilha é conjurado pelo dono, a partir da célula dela.
 *  8. reflect: devolve `pct`% do dano RECEBIDO (antes do escudo) ao agressor,
 *     como dano fixo neutro que não volta a refletir.
 *  9. moveTo: deslize por eixo dominante até `maxTiles`, parando na primeira
 *     célula bloqueada. Emite `move {forced:true}` para o renderizador animar.
 * 10. chain: atinge o alvo e salta para o inimigo vivo mais próximo ainda não
 *     atingido dentro de CHAIN_JUMP_RANGE (3), multiplicando por `falloff`.
 * 11. cone: triângulo que parte da célula-alvo e se abre no sentido oposto ao
 *     conjurador (linha i tem 2i+1 células). ring: coroa de distância Manhattan
 *     exatamente `size` em torno do alvo.
 * 12. targetSide: quando o feitiço declara 'enemy'/'ally'/'self', a CÉLULA-ALVO
 *     passa a ser validada (inimigo vivo / aliado vivo / a própria célula).
 *     'any' ou ausente = como na v1.
 * 13. PETS: não entram em `state.order` — agem em `Engine.runPetTurn`, logo
 *     após o dono encerrar o turno (recebem ali o tique de clima, veneno/regen,
 *     PA/PP cheios e o decremento de durações). Não contam para vitória/derrota.
 * 14. EVENTOS DE TERRENO: aplicados sobre QUEM PISOU (o pisante é o
 *     "conjurador" e também alvo legítimo dos efeitos ofensivos).
 * 15. FUSÃO: a unidade fundida é a própria unidade A mutada — mantém o uid e a
 *     casa dela na ordem de iniciativa; B sai do tabuleiro com
 *     `alive:false, offBoard:true`, sem evento `death` e sem contar derrota.
 * 18. FÚRIA DA SALA (v2.3): a partir de `roomFury.afterRound`, cada rodada dá
 *     `powerPerRound` de poder aos INIMIGOS e corta `healCutPerRound` da cura
 *     recebida por TODOS (piso 0). É DERIVADA de `state.round` — nunca acumulada
 *     em campo —, então não há bookkeeping para dessincronizar e uma unidade
 *     invocada tarde já nasce com a fúria da rodada em que apareceu. O corte de
 *     cura vale para os dois lados de propósito: cortar só de um transferiria o
 *     empate em vez de encerrá-lo. O tique de clima NÃO é cortado: é ambiente,
 *     não "cura recebida", e o poder crescente o supera de qualquer forma.
 *     Atingido `maxRounds`, a batalha encerra como DERROTA do jogador
 *     (`furyTimeout` + `battleEnd{reason:'fury'}`) — a sala cobra a demora.
 * 17. GANHO ELEMENTAL (v2.2, contrato §9-C): `unit.elemPower` entra na conta de
 *     dano como poder EXTRA, e só quando `spell.element` é um dos elementos do
 *     conjurador. O gatilho é o elemento do FEITIÇO (literal do contrato), não o
 *     de cada efeito: assim um feitiço de fusão premia as duas metades da
 *     mistura de uma vez, como manda "vale para os dois elementos". Vale para
 *     damage, chain e poison (neste, congelado em `sourcePower` no cast, como já
 *     era o poder na v1). NÃO vale para detonateMarks, colisão de empurrão nem
 *     explodeOnDeath — esses três são dano fixo, sem poder, desde a v1.
 * 16. STATS DO PET: o esquema do contrato (§5) descreve os BÔNUS que o pet dá
 *     ao dono, não o corpo dele. O corpo usa `DATA.pets[id].stats` quando o
 *     dado o fornecer e, senão, o padrão documentado
 *     hp 40 · pa 3 · pp 3 · iniciativa do dono · power 0 · sem resistências.
 *     Os BÔNUS ao dono são responsabilidade de `Progress.battleParty()`, que
 *     entrega os stats já somados — a engine não os aplica duas vezes.
 * ==========================================================================*/

(function () {
  'use strict';

  var Engine = {};
  JOGO.Engine = Engine;

  Engine.events = [];      // fila; main.js drena — a engine só faz push
  Engine.state = null;

  // ------------------------------------------------------------- constantes
  Engine.WEATHER_TICK = 5;       // PV ganhos/perdidos por tique de clima
  Engine.CHAIN_JUMP_RANGE = 3;   // alcance de cada salto do efeito 'chain'
  // v2.3 — FÚRIA PROGRESSIVA DA SALA. Padrão usado quando
  // `DATA.leveling.roomFury` ainda não existe (o dado é de outro dono).
  //
  // NÚMEROS MEDIDOS, não chutados. Varredura de 108 batalhas (6 duplas × 18
  // salas, nível 1, só feitiços base — a configuração mais dura que existe):
  //   sem fúria ............ 8 EMPATES, 16 vitórias, pior caso 77 rodadas
  //   afterRound 12 ........ 0 empates, 15 vitórias (custou uma legítima)
  //   afterRound 20 ........ 0 empates, 16 vitórias, pior caso 28 rodadas
  // Ficou em 20 porque resolve todos os empates SEM cobrar nenhuma vitória
  // legítima: só 4% das batalhas decididas passam da rodada 20 (a mediana é 5),
  // então a fúria segue invisível no jogo normal. `maxRounds: 40` é folga de 12
  // rodadas sobre o pior caso observado — nunca disparou na varredura.
  Engine.ROOM_FURY = { afterRound: 20, powerPerRound: 10,
                       healCutPerRound: 0.15, maxRounds: 40 };
  Engine.MARK_DEFAULT_VALUE = 5; // % de dano por pilha quando o dado omite
  Engine.MARK_DEFAULT_MAX = 5;   // pilhas máximas quando o dado omite
  Engine.PET_FOLLOW_DEFAULT = 2; // followDistance padrão

  var DEFAULT_RIVALS = { fogo: 'agua', agua: 'fogo', terra: 'ar', ar: 'terra', neutro: null };
  var DEFAULT_WEATHERS = {
    calmo:     { id: 'calmo',     name: 'Calmo',     favors: null,    harms: null },
    chuva:     { id: 'chuva',     name: 'Chuva',     favors: 'agua',  harms: 'fogo' },
    estiagem:  { id: 'estiagem',  name: 'Estiagem',  favors: 'fogo',  harms: 'agua' },
    vendaval:  { id: 'vendaval',  name: 'Vendaval',  favors: 'ar',    harms: 'terra' },
    tremor:    { id: 'tremor',    name: 'Tremor',    favors: 'terra', harms: 'ar' }
  };

  function emit(ev) { Engine.events.push(ev); }
  function log(text) { emit({ type: 'log', text: text }); }
  Engine.emit = emit;   // Fusion (mesmo dono) publica pela mesma fila
  Engine.log = log;

  function DATA() { return JOGO.DATA || {}; }

  // --------------------------------------------------------------- RNG
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function nextRand(state) { // mulberry32
    state._rng = (state._rng + 0x6D2B79F5) >>> 0;
    var t = state._rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rollInt(state, min, max) {
    if (max <= min) return min;
    return min + Math.floor(nextRand(state) * (max - min + 1));
  }
  Engine.rand = nextRand;   // exposto para Fusion/testes determinísticos

  // sorteio ponderado determinístico sobre [{weight}]
  function weightedPick(state, list) {
    if (!list || !list.length) return null;
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += Math.max(0, list[i].weight || 0);
    if (total <= 0) return list[0];
    var r = nextRand(state) * total;
    for (i = 0; i < list.length; i++) {
      r -= Math.max(0, list[i].weight || 0);
      if (r < 0) return list[i];
    }
    return list[list.length - 1];
  }

  // --------------------------------------------------------------- helpers
  function inBounds(state, x, y) {
    return x >= 0 && y >= 0 && x < state.grid.w && y < state.grid.h;
  }
  function tileAt(state, x, y) {
    return inBounds(state, x, y) ? state.grid.tiles[y][x] : null;
  }
  function isFloor(state, x, y) {
    var t = tileAt(state, x, y);
    return !!t && t.type === 'floor';
  }
  function blocksSight(state, x, y) {
    var t = tileAt(state, x, y);
    return !!t && t.type === 'wall';   // 'cover' (baixo) e 'hole' não bloqueiam visão
  }
  function manhattan(x0, y0, x1, y1) {
    return Math.abs(x1 - x0) + Math.abs(y1 - y0);
  }
  function clamp(lo, hi, v) { return v < lo ? lo : (v > hi ? hi : v); }

  Engine.unitAt = function (state, x, y) {
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.alive && !u.offBoard && u.x === x && u.y === y) return u;
    }
    return null;
  };
  Engine.findUnit = function (state, uid) {
    for (var i = 0; i < state.units.length; i++) {
      if (state.units[i].uid === uid) return state.units[i];
    }
    return null;
  };
  Engine.activeUnit = function (state) {
    return Engine.findUnit(state, state.order[state.activeIdx]);
  };

  Engine.unitHasTrait = function (unit, type) {
    if (!unit || !unit.traits) return false;
    for (var i = 0; i < unit.traits.length; i++) {
      if (unit.traits[i].type === type) return true;
    }
    return false;
  };
  function getTrait(unit, type) {
    if (!unit || !unit.traits) return null;
    for (var i = 0; i < unit.traits.length; i++) {
      if (unit.traits[i].type === type) return unit.traits[i];
    }
    return null;
  }
  Engine.unitHasEffect = function (unit, type) {
    if (!unit) return false;
    for (var i = 0; i < unit.effects.length; i++) {
      if (unit.effects[i].type === type) return true;
    }
    return false;
  };
  function countEffects(unit, type) {
    var n = 0;
    for (var i = 0; i < unit.effects.length; i++) if (unit.effects[i].type === type) n++;
    return n;
  }

  function sumBuffs(unit, stat) {
    var s = 0;
    for (var i = 0; i < unit.effects.length; i++) {
      var e = unit.effects[i];
      if (e.type === 'buff' && e.stat === stat) s += e.value;
    }
    return s;
  }
  Engine.effPower = function (unit) {
    return unit.power + sumBuffs(unit, 'power');
  };
  Engine.effResist = function (unit, element) {
    var r = (unit.resists && unit.resists[element]) || 0;
    for (var i = 0; i < unit.effects.length; i++) {
      var e = unit.effects[i];
      if (e.type === 'resist' && e.element === element) r += e.value;
    }
    return Math.min(100, r);
  };
  // v2: esquiva e fixação (com buffs)
  Engine.effDodge = function (unit) {
    return (unit.dodge || 0) + sumBuffs(unit, 'dodge');
  };
  Engine.effLock = function (unit) {
    return (unit.lock || 0) + sumBuffs(unit, 'lock');
  };
  // v2: multiplicador de dano recebido por marcas — 1 + Σ(value)/100
  Engine.markMultiplier = function (unit) {
    var pct = 0;
    for (var i = 0; i < unit.effects.length; i++) {
      if (unit.effects[i].type === 'mark') {
        pct += (unit.effects[i].value != null ? unit.effects[i].value : Engine.MARK_DEFAULT_VALUE);
      }
    }
    return 1 + pct / 100;
  };
  Engine.markStacks = function (unit) { return countEffects(unit, 'mark'); };

  function recomputeShield(unit) {
    var s = 0;
    for (var i = 0; i < unit.effects.length; i++) {
      var e = unit.effects[i];
      if (e.type === 'shield') s += e.remaining;
    }
    unit.shield = s;
  }

  // --------------------------------------------------- v2: feitiços modulares
  Engine._genSpells = {};   // feitiços gerados em memória (fusão, itens sintéticos)

  Engine.registerSpell = function (spell) {
    if (spell && spell.id) Engine._genSpells[spell.id] = spell;
    return spell || null;
  };
  // Resolve um id de feitiço em QUALQUER fonte de dados. Uso interno obrigatório.
  // Fontes: registro em memória (fusões) · DATA.spells (classes) ·
  // DATA.monsterSpells · DATA.petSpells · DATA.itemSpells · DATA.fusionSpells
  // (payloads de armadilha e feitiços dos invocados de fusão).
  Engine.spell = function (id) {
    if (!id) return null;
    if (Engine._genSpells[id]) return Engine._genSpells[id];
    var D = DATA();
    var srcs = [D.spells, D.monsterSpells, D.petSpells, D.itemSpells, D.fusionSpells];
    for (var i = 0; i < srcs.length; i++) {
      if (srcs[i] && srcs[i][id]) return srcs[i][id];
    }
    return null;
  };
  function spellDef(id) { return Engine.spell(id); }

  // Idem para definições de monstro: DATA.monsters + DATA.fusionSummons (as
  // criaturas que as formas de fusão invocam). Todo `summon{monsterId}` e o
  // traço `split` passam por aqui.
  Engine.monster = function (id) {
    if (!id) return null;
    var D = DATA();
    if (D.monsters && D.monsters[id]) return D.monsters[id];
    if (D.fusionSummons && D.fusionSummons[id]) return D.fusionSummons[id];
    return null;
  };

  // acessores tolerantes (os dados podem estar incompletos durante o desenvolvimento)
  function sRange(sp) { return sp.range || { min: 0, max: 1, line: false, los: false }; }
  function sAoe(sp) { return sp.aoe || { shape: 'single', size: 0 }; }
  function sEffects(sp) { return sp.effects || []; }
  function sPaCost(sp) { return sp.paCost || 0; }
  function sCooldown(sp) { return sp.cooldown || 0; }
  function sCastsPerTurn(sp) { return sp.castsPerTurn || 0; }

  function spellHasEffect(spell, type) {
    var effs = sEffects(spell);
    for (var i = 0; i < effs.length; i++) if (effs[i].type === type) return true;
    return false;
  }

  // --------------------------------------------------- v2: elementos e clima
  function rivalOf(element) {
    var r = DATA().rivals || DEFAULT_RIVALS;
    return r[element] !== undefined ? r[element] : (DEFAULT_RIVALS[element] || null);
  }
  Engine.rivalOf = rivalOf;

  function weatherTable() {
    var w = DATA().weathers;
    return (w && Object.keys(w).length) ? w : DEFAULT_WEATHERS;
  }
  Engine.weatherDef = function (state) {
    var t = weatherTable();
    return t[state.weather] || null;
  };
  // elementos de uma unidade (a fusão carrega dois)
  function unitElements(u) {
    if (u.elements && u.elements.length) return u.elements;
    return [u.element || 'neutro'];
  }
  Engine.unitElements = unitElements;

  // v2.2 (contrato §9-C): a partir da escolha, cada nível dá `elemPower` — dano
  // extra que SÓ conta quando o feitiço conjurado é do elemento do conjurador:
  //   (100 + power + (spell.element === unit.element ? elemPower : 0))/100
  // O vocabulário de `buff` não tem 'elemPower', então não há buff a somar aqui.
  Engine.effElemPower = function (unit) {
    return (unit && unit.elemPower) || 0;
  };
  // A comparação é contra `unitElements`, não contra `unit.element` cru: a
  // unidade FUNDIDA carrega DOIS elementos e o contrato manda o bônus (a média
  // dos fundidos) valer para os dois elementos da mistura. Para quem tem um
  // elemento só, `unitElements` devolve `[element]` e isto é exatamente a
  // igualdade literal do contrato.
  // O gatilho é o elemento do FEITIÇO (não o de cada efeito): é o que o
  // contrato escreve, e é o que faz um feitiço de fusão premiar as duas metades
  // da mistura de uma vez.
  Engine.elementalBonus = function (unit, spell) {
    var ep = Engine.effElemPower(unit);
    if (!ep || !spell || !spell.element) return 0;
    return unitElements(unit).indexOf(spell.element) >= 0 ? ep : 0;
  };

  function setWeather(state, weatherId, silent) {
    if (!weatherId || state.weather === weatherId) return false;
    state.weather = weatherId;
    var cyc = weatherCycle(state);
    var idx = cyc.indexOf(weatherId);
    if (idx >= 0) state._weatherIdx = idx;
    if (!silent) {
      var def = weatherTable()[weatherId];
      emit({ type: 'weatherShift', weather: weatherId });
      log('O clima muda: ' + ((def && def.name) || weatherId) + '.');
    }
    return true;
  }
  Engine.setWeather = setWeather;

  // Ciclo automático de clima: `dungeon.weatherCycle` quando o dado o traz;
  // senão os CINCO climas canônicos do contrato §2 que existirem em
  // DATA.weathers (nunca "todas as chaves": um clima extra de teste ou de
  // conteúdo experimental entraria no rodízio das salas reais); e só em último
  // caso, todas as chaves.
  var CANON_WEATHERS = ['calmo', 'chuva', 'estiagem', 'vendaval', 'tremor'];
  function weatherCycle(state) {
    var d = getDungeon(state.dungeonId);
    if (d && d.weatherCycle && d.weatherCycle.length) return d.weatherCycle;
    var t = weatherTable();
    var out = [], i, k;
    for (i = 0; i < CANON_WEATHERS.length; i++) {
      if (t[CANON_WEATHERS[i]]) out.push(CANON_WEATHERS[i]);
    }
    if (out.length) return out;
    for (k in t) if (Object.prototype.hasOwnProperty.call(t, k)) out.push(k);
    return out;
  }

  function weatherTick(state, u) {
    if (!u.alive) return;
    var w = Engine.weatherDef(state);
    if (!w) return;
    var els = unitElements(u);
    var amount = 0;
    if (w.favors && els.indexOf(w.favors) >= 0) amount += Engine.WEATHER_TICK;
    if (w.harms && els.indexOf(w.harms) >= 0) amount -= Engine.WEATHER_TICK;
    if (amount === 0) return;                    // clima indiferente: sem evento
    if (amount > 0) {
      var gain = Math.min(amount, u.hpMax - u.hp);
      u.hp += gain;
      emit({ type: 'weatherTick', uid: u.uid, amount: gain });
      if (gain > 0) log(u.name + ' se fortalece com o clima (+' + gain + ').');
    } else {
      // dano ambiental: ignora escudo e resistência, pode matar
      u.hp = Math.max(0, u.hp + amount);
      emit({ type: 'weatherTick', uid: u.uid, amount: amount });
      log(u.name + ' sofre com o clima (' + amount + ').');
      checkEnrage(state, u);
      if (u.hp <= 0) processDeath(state, u);
    }
  }

  // ------------------------------------------------- v2.3: fúria da sala
  // Empate por sustentação (um lado cura mais do que o outro machuca) é um
  // beco sem saída: o jogador não perde e não ganha. A partir de `afterRound`
  // a sala esquenta — os INIMIGOS ganham poder a cada rodada e a cura recebida
  // por TODOS encolhe até zerar —, de modo que toda batalha necessariamente
  // resolve. É o "enrage" clássico do gênero: invisível numa luta normal, que
  // termina muito antes da rodada 12.
  function furyConfig() {
    var L = DATA().leveling || {};
    return L.roomFury || Engine.ROOM_FURY;
  }
  Engine.furyConfig = furyConfig;

  // DERIVADA de `state.round`, nunca acumulada em campo: não há bookkeeping para
  // dessincronizar, e uma unidade invocada na rodada 20 já nasce com a fúria
  // daquela rodada — não com a de quando a sala começou a esquentar.
  Engine.furyOf = function (state) {
    var cfg = furyConfig();
    var over = state.round - (cfg.afterRound || 0);
    if (over <= 0) return { rounds: 0, power: 0, healScale: 1 };
    return {
      rounds: over,
      power: Math.round((cfg.powerPerRound || 0) * over),
      healScale: Math.max(0, 1 - (cfg.healCutPerRound || 0) * over)
    };
  };
  // O poder da fúria é do lado INIMIGO: é a sala reagindo aos invasores.
  Engine.furyPower = function (state, unit) {
    if (!state || !unit || unit.side !== 'enemy') return 0;
    return Engine.furyOf(state).power;
  };
  // O corte de cura vale para os DOIS lados (senão o empate só trocaria de mãos).
  Engine.healScale = function (state) {
    return state ? Engine.furyOf(state).healScale : 1;
  };
  // Poder efetivo de uma conjuração: base + buffs (v1) + bônus elemental (v2.2)
  // + fúria da sala (v2.3). Todo cálculo de dano passa por aqui.
  Engine.castPower = function (state, caster, spell) {
    return Engine.effPower(caster) + Engine.elementalBonus(caster, spell) +
           Engine.furyPower(state, caster);
  };

  // --------------------------------------------------------------- criação
  function makeUnit(state, def, kind, side, x, y, opts) {
    opts = opts || {};
    state._uidCounter++;
    var st = opts.stats || def.stats || {};
    var resists = {};
    var srcRes = st.resists || {};
    for (var k in srcRes) resists[k] = srcRes[k];
    var spells = (opts.spells || def.spells || def.baseSpells || []).slice();
    return {
      uid: 'u' + state._uidCounter,
      defId: def.id,
      kind: kind,                     // 'hero' | 'monster' | 'summon' | 'pet' | 'fusion'
      side: side,
      name: opts.name || def.name,
      x: x, y: y,
      hp: st.hp, hpMax: st.hp,
      pa: st.pa, paMax: st.pa,
      pp: st.pp, ppMax: st.pp,        // v2: PP (Pontos de Passos)
      initiative: st.initiative || 0,
      power: st.power || 0,
      elemPower: st.elemPower || opts.elemPower || 0,  // v2.2: dano no próprio elemento
      dodge: st.dodge || 0,           // v2
      lock: st.lock || 0,             // v2
      element: opts.element || def.element || 'neutro',  // v2
      level: opts.level || 1,         // v2
      classId: opts.classId || null,  // v2
      heroId: opts.heroId || null,    // v2
      resists: resists,
      spells: spells,
      cooldowns: {},
      castsThisTurn: {},
      effects: [],
      shield: 0,
      alive: true,
      offBoard: false,                // v2: saiu do tabuleiro sem morrer (fusão)
      boss: !!def.boss,
      traits: def.traits ? def.traits.slice() : [],
      aiRole: def.ai || opts.aiRole || null,
      enraged: false,
      summonerUid: null,
      ownerUid: opts.ownerUid || null, // v2: dono do pet
      petId: opts.petId || null,       // v2
      behavior: opts.behavior || null, // v2: comportamento do pet
      range: opts.range || 0,          // v2: alcance de ação do pet
      followDistance: opts.followDistance || 0, // v2
      fusionIntent: null,              // v2
      _birth: state._uidCounter
    };
  }

  function getDungeon(dungeonId) {
    var ds = DATA().dungeons || [];
    for (var i = 0; i < ds.length; i++) if (ds[i].id === dungeonId) return ds[i];
    return null;
  }

  // v2: stats efetivos de um herói do grupo (nível + itens ficam com Progress;
  // aqui só há uma escala defensiva de nível quando o chamador não os fornece).
  function heroStats(entry, cls) {
    if (entry.stats) return entry.stats;
    var base = cls && cls.stats;
    if (!base) return null;
    var out = { hp: base.hp, pa: base.pa, pp: base.pp, initiative: base.initiative,
                power: base.power, elemPower: 0,
                dodge: base.dodge || 0, lock: base.lock || 0, resists: {} };
    for (var k in (base.resists || {})) out.resists[k] = base.resists[k];
    // v2.2: todo nível dá PV; o ganho de DANO muda de genérico para elemental na
    // escolha do elemento. Convenção do dado (progression.js): os níveis
    // 2→`elementChoiceLevel` usam `perLevel` e os seguintes usam
    // `perLevelElement`; quem nunca escolheu segue no genérico até o fim.
    // Isto é a rede de segurança de quem chama `createBattle` sem `stats` —
    // o caminho oficial é `Progress.battleParty()`, que já entrega tudo pronto.
    var lv = entry.level || 1;
    var L = DATA().leveling || {};
    var per = L.perLevel || null;
    var perEl = L.perLevelElement || null;
    var choice = L.elementChoiceLevel || 5;
    var chose = !!entry.element && entry.element !== 'neutro';
    var genericSteps = Math.max(0, (chose ? Math.min(lv, choice) : lv) - 1);
    var elementSteps = chose ? Math.max(0, lv - choice) : 0;
    if (per) {
      out.hp += (per.hp || 0) * genericSteps;
      out.power += (per.power || 0) * genericSteps;
    }
    if (perEl) {
      out.hp += (perEl.hp || 0) * elementSteps;
      out.elemPower += (perEl.elemPower || 0) * elementSteps;
    }
    // §9-H: esquiva e fixação sobem com o nível no ritmo do PAPEL da classe.
    // Mesma conta de `Progress.effectiveStats` — as duas portas de entrada do
    // grupo têm de concordar, senão a batalha muda conforme quem a montou.
    out.dodge += defenseGain(cls, lv, 'dodge', out.dodge);
    out.lock += defenseGain(cls, lv, 'lock', out.lock);
    return out;
  }

  /* §9-H — DEFESA DE POSIÇÃO POR NÍVEL (espelho de Progress [D17]).
   * `efetivo = base + round((alvo − base) × (nível − 1) / (maxLevel − 1))`, com o
   * alvo lido em `DATA.leveling.defenseByRole[classe.role]`. Sem a tabela no dado
   * o ganho é 0 e o motor se comporta como na v2.6. Alvo abaixo da base vale 0. */
  function defenseGain(cls, level, stat, base) {
    var tbl = (DATA().leveling || {}).defenseByRole;
    if (!tbl || !cls || !cls.role) return 0;
    var row = tbl[cls.role];
    if (!row || typeof row[stat] !== 'number') return 0;
    var span = row[stat] - (base || 0);
    if (span <= 0) return 0;
    var top = Math.max(2, (DATA().leveling || {}).maxLevel || 30);
    var steps = Math.max(0, Math.min(level || 1, top) - 1);
    return Math.round(span * steps / (top - 1));
  }

  // Normaliza `party`: aceita strings (id de classe/herói) ou objetos do contrato.
  function normalizeParty(party) {
    var out = [];
    for (var i = 0; i < party.length; i++) {
      var p = party[i];
      if (typeof p === 'string') p = { heroId: p, classId: p };
      out.push(p);
    }
    return out;
  }

  Engine.createBattle = function (dungeonId, roomIndex, party) {
    var dungeon = getDungeon(dungeonId);
    if (!dungeon) throw new Error('Engine.createBattle: calabouço desconhecido: ' + dungeonId);
    var room = dungeon.rooms[roomIndex];
    if (!room) throw new Error('Engine.createBattle: sala inválida: ' + roomIndex);
    if (!party || !party.length) throw new Error('Engine.createBattle: grupo vazio');
    party = normalizeParty(party);

    var layout = room.layout;
    var h = layout.length, w = layout[0].length;
    var tiles = [];
    var heroSpawns = [];
    var monsterSpawns = [];
    var y, x, ch;

    for (y = 0; y < h; y++) {
      var row = [];
      for (x = 0; x < w; x++) {
        ch = layout[y].charAt(x);
        if (ch === '#') row.push({ type: 'wall', deco: false });
        else if (ch === '=') row.push({ type: 'cover', deco: false });   // v2: obstáculo BAIXO
        else if (ch === '~') row.push({ type: 'hole', deco: false });
        else if (ch === ',') row.push({ type: 'floor', deco: true });
        else row.push({ type: 'floor', deco: false });
        if (ch === 'P') heroSpawns.push({ x: x, y: y });
        else if (ch >= 'a' && ch <= 'z') monsterSpawns.push({ x: x, y: y, letter: ch });
      }
      tiles.push(row);
    }
    if (party.length > heroSpawns.length) {
      throw new Error('Engine.createBattle: spawns de herói insuficientes na sala');
    }

    var seedIds = [];
    for (var s = 0; s < party.length; s++) {
      seedIds.push(party[s].heroId || party[s].classId || ('p' + s));
    }
    var state = {
      dungeonId: dungeonId,
      roomIndex: roomIndex,
      round: 1,
      phase: 'playing',
      grid: { w: w, h: h, tiles: tiles },
      units: [],
      order: [],
      activeIdx: 0,
      weather: room.weather || dungeon.defaultWeather || 'calmo',   // v2
      tileEventsActive: [],                                          // v2
      traps: [],                                                     // v2
      // MUROS INVOCADOS (v3, verbo do Minotauro). Cada um guarda a celula e o
      // que ela ERA, para devolver quando expirar — nunca supor 'floor', porque
      // o Minotauro pode erguer muro sobre chao decorado e a decoracao some.
      walls: [],
      pendingFusion: null,                                           // v2
      _weatherIdx: 0,
      _uidCounter: 0,
      _rng: hashStr(dungeonId + ':' + roomIndex + ':' + seedIds.join(','))
    };
    var cyc = weatherCycle(state);
    var wi = cyc.indexOf(state.weather);
    state._weatherIdx = wi >= 0 ? wi : 0;

    var i;
    var pets = [];
    for (i = 0; i < party.length; i++) {
      var p = party[i];
      var cls = (DATA().classes && DATA().classes[p.classId]) || null;
      var def = cls;
      if (!def && DATA().heroes) {   // compatibilidade defensiva com dados antigos
        for (var hh = 0; hh < DATA().heroes.length; hh++) {
          if (DATA().heroes[hh].id === (p.heroId || p.classId)) def = DATA().heroes[hh];
        }
      }
      if (!def) throw new Error('Engine.createBattle: classe desconhecida: ' + p.classId);
      var st = heroStats(p, def);
      if (!st) throw new Error('Engine.createBattle: classe sem stats: ' + p.classId);
      var hs = heroSpawns[i];
      var unit = makeUnit(state, def, 'hero', 'player', hs.x, hs.y, {
        stats: st,
        spells: p.spells || def.baseSpells || def.spells || [],
        element: p.element || 'neutro',
        level: p.level || 1,
        classId: p.classId || def.id,
        heroId: p.heroId || def.id,
        name: p.name || def.name
      });
      state.units.push(unit);
      if (p.pet) pets.push({ ownerUnit: unit, petId: p.pet });
    }
    for (i = 0; i < monsterSpawns.length; i++) {
      var ms = monsterSpawns[i];
      var mid = room.monsters ? room.monsters[ms.letter] : null;
      if (!mid) throw new Error('Engine.createBattle: letra sem monstro: ' + ms.letter);
      var md = Engine.monster(mid);
      if (!md) throw new Error('Engine.createBattle: monstro desconhecido: ' + mid);
      state.units.push(makeUnit(state, md, 'monster', 'enemy', ms.x, ms.y, { element: md.element }));
    }

    // ordem por iniciativa (desc); desempate estável pela ordem de criação.
    // v2: pets NÃO entram na ordem — agem no fim do turno do dono.
    var sorted = state.units.slice().sort(function (a, b) {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      return a._birth - b._birth;
    });
    for (i = 0; i < sorted.length; i++) state.order.push(sorted[i].uid);
    state.activeIdx = 0;

    // v2: pets entram junto do dono, em célula livre adjacente
    for (i = 0; i < pets.length; i++) spawnPet(state, pets[i].ownerUnit, pets[i].petId);

    Engine.state = state;
    emit({ type: 'battleStart', state: state });
    log(dungeon.name + ' — ' + room.name);
    emit({ type: 'roundStart', round: 1 });
    startTurn(state, 0);
    return state;
  };

  // --------------------------------------------------------- v2: pets
  function spawnPet(state, owner, petId) {
    var pd = (DATA().pets || {})[petId];
    if (!pd) return null;
    var cells = freeAdjacentCells(state, owner.x, owner.y, 1);
    if (!cells.length) return null;
    var base = pd.stats || {};
    var st = {
      hp: base.hp || 40, pa: base.pa || 3, pp: base.pp || 3,
      initiative: base.initiative || owner.initiative,
      power: base.power || 0, dodge: base.dodge || 0, lock: base.lock || 0,
      resists: base.resists || {}
    };
    var u = makeUnit(state, { id: pd.id, name: pd.name, spells: pd.spells || [] },
      'pet', owner.side, cells[0].x, cells[0].y, {
        stats: st,
        spells: pd.spells || [],
        element: pd.element || 'neutro',
        ownerUid: owner.uid,
        petId: pd.id,
        behavior: pd.behavior || 'attack',
        range: pd.range || 1,
        followDistance: pd.followDistance || Engine.PET_FOLLOW_DEFAULT
      });
    state.units.push(u);
    emit({ type: 'petSpawn', unit: u, ownerUid: owner.uid });
    return u;
  }

  // --------------------------------------------------------------- movimento
  function isWalkable(state, x, y) {
    return isFloor(state, x, y) && !Engine.unitAt(state, x, y);
  }
  var DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  function bfs(state, sx, sy, maxCost) {
    var dist = {};
    var parent = {};
    var queue = [{ x: sx, y: sy }];
    dist[sx + ',' + sy] = 0;
    var head = 0;
    while (head < queue.length) {
      var cur = queue[head++];
      var d = dist[cur.x + ',' + cur.y];
      if (maxCost >= 0 && d >= maxCost) continue;
      for (var i = 0; i < DIRS.length; i++) {
        var nx = cur.x + DIRS[i][0], ny = cur.y + DIRS[i][1];
        var key = nx + ',' + ny;
        if (dist[key] !== undefined) continue;
        if (!isWalkable(state, nx, ny)) continue;
        dist[key] = d + 1;
        parent[key] = cur.x + ',' + cur.y;
        queue.push({ x: nx, y: ny });
      }
    }
    return { dist: dist, parent: parent };
  }

  // v2: inimigos vivos adjacentes a (x,y) que podem fixar `unit`
  function lockersAt(state, unit, x, y) {
    var out = [];
    for (var i = 0; i < state.units.length; i++) {
      var e = state.units[i];
      if (!e.alive || e.offBoard || e === unit) continue;
      if (e.side === unit.side) continue;
      if (manhattan(x, y, e.x, e.y) === 1) out.push(e);
    }
    return out;
  }

  // v2: bônus elemental do teste de esquiva
  function elementalDodgeBonus(fleeing, locker) {
    var ef = unitElements(fleeing)[0] || 'neutro';
    var el = unitElements(locker)[0] || 'neutro';
    if (ef === el) return 0;                 // mesmo elemento
    if (rivalOf(ef) === el) return 0.30;     // fugindo do próprio rival
    return 0.10;                             // não relacionado (inclui neutro)
  }

  Engine.dodgeChance = function (state, uid, lockerUid) {
    var u = Engine.findUnit(state, uid);
    var l = Engine.findUnit(state, lockerUid);
    if (!u || !l) return 1;
    var raw = 0.35 + (Engine.effDodge(u) - Engine.effLock(l)) * 0.02 + elementalDodgeBonus(u, l);
    // arredonda a 4 casas: a soma de decimais em ponto flutuante produziria
    // 0.6499999999999999 e a UI mostra esse número como porcentagem.
    return Math.round(clamp(0.10, 0.90, raw) * 10000) / 10000;
  };

  // pior fixador: menor chance de sucesso. Empate = o primeiro encontrado.
  function worstLocker(state, unit, destX, destY) {
    var cand = lockersAt(state, unit, unit.x, unit.y);
    var worst = null, worstChance = 2;
    for (var i = 0; i < cand.length; i++) {
      var e = cand[i];
      if (manhattan(destX, destY, e.x, e.y) === 1) continue;  // continua colado nele
      var c = Engine.dodgeChance(state, unit.uid, e.uid);
      if (c < worstChance) { worstChance = c; worst = e; }
    }
    return worst;
  }

  Engine.reachable = function (state, uid) {
    var u = Engine.findUnit(state, uid);
    if (!u || !u.alive || u.pp <= 0) return [];
    if (Engine.unitHasEffect(u, 'root')) return [];       // v2: enraizado não anda
    var r = bfs(state, u.x, u.y, u.pp);
    var lockers = lockersAt(state, u, u.x, u.y);          // v2
    var out = [];
    for (var key in r.dist) {
      var c = r.dist[key];
      if (c === 0) continue;
      var parts = key.split(',');
      var cx = parseInt(parts[0], 10), cy = parseInt(parts[1], 10);
      var risky = false;
      for (var i = 0; i < lockers.length; i++) {
        if (manhattan(cx, cy, lockers[i].x, lockers[i].y) !== 1) { risky = true; break; }
      }
      out.push({ x: cx, y: cy, cost: c, risky: risky });
    }
    return out;
  };

  Engine.path = function (state, uid, x, y) {
    var u = Engine.findUnit(state, uid);
    if (!u || !u.alive) return null;
    if (x === u.x && y === u.y) return null;
    if (!isWalkable(state, x, y)) return null;
    var r = bfs(state, u.x, u.y, u.pp);
    var key = x + ',' + y;
    if (r.dist[key] === undefined) return null;
    var path = [];
    while (key !== u.x + ',' + u.y) {
      var parts = key.split(',');
      path.unshift({ x: parseInt(parts[0], 10), y: parseInt(parts[1], 10) });
      key = r.parent[key];
    }
    return path;
  };

  /* v2.4 — POR QUE O PASSO NÃO SAIU.
   * `Engine.move` recusava em SILÊNCIO quando faltava PP, e esse é justamente o
   * estado em que o jogador mais precisa de explicação: uma FIXAÇÃO fracassada
   * leva TODO o PP restante SEM tirar a unidade do lugar (contrato §2), e a
   * partir daí cada clique no chão não fazia nada e não dizia nada. O relato do
   * playtest foi exatamente esse: "o PP não carrega, depois que eu uso ele fica
   * zerado" — o PP recarrega sim (todo `startTurn`), o que faltava era o motor
   * dizer que aquele turno já não tem passo.
   * O motor já fala quando a unidade está presa (`root`) e quando a esquiva
   * falha; aqui fecha o terceiro caso. Só comenta destinos ALCANÇÁVEIS a pé —
   * toque em parede, em buraco ou em cima de unidade dispensa explicação e não
   * polui o diário. */
  function explainNoStep(state, u, x, y) {
    if (x === u.x && y === u.y) return;
    if (!isWalkable(state, x, y)) return;
    var need = bfs(state, u.x, u.y, -1).dist[x + ',' + y];
    if (need === undefined) return;                       // sem caminho: nada a dizer
    if (u.pp <= 0) log(u.name + ' não tem mais Pontos de Passos neste turno.');
    else log(u.name + ' precisa de ' + need + ' PP para chegar aí e só tem ' + u.pp + '.');
  }

  Engine.move = function (state, uid, x, y) {
    if (state.phase !== 'playing') return false;
    var u = Engine.findUnit(state, uid);
    if (!u || !u.alive || u.offBoard) return false;
    if (Engine.unitHasEffect(u, 'root')) {                // v2
      log(u.name + ' está preso ao chão.');
      return false;
    }
    var path = Engine.path(state, uid, x, y);
    if (!path || path.length > u.pp) { explainNoStep(state, u, x, y); return false; }

    // v2: teste de esquiva/fixação, uma vez por movimento, contra o pior fixador
    var locker = worstLocker(state, u, x, y);
    if (locker) {
      var chance = Engine.dodgeChance(state, uid, locker.uid);
      var roll = nextRand(state);
      if (roll < chance) {
        emit({ type: 'dodgeOk', uid: uid, lockerUid: locker.uid, chance: chance });
      } else {
        u.pp = 0;
        var critical = nextRand(state) < chance / 3;      // ver decisão de design 4
        if (critical) u.pa = Math.max(0, u.pa - 1);
        emit({ type: 'dodgeFail', uid: uid, lockerUid: locker.uid,
               chance: chance, critical: critical });
        log(u.name + ' não escapa de ' + locker.name + (critical ? ' (falha crítica!)' : '') + '.');
        return false;
      }
    }

    u.pp -= path.length;
    u.x = x; u.y = y;
    emit({ type: 'move', uid: uid, path: path });

    // v2: pisa em armadilhas e eventos de terreno ao longo do caminho
    for (var i = 0; i < path.length; i++) {
      if (!u.alive || state.phase !== 'playing') break;
      Engine.triggerTrap(state, uid, path[i].x, path[i].y);
      if (!u.alive || state.phase !== 'playing') break;
      Engine.triggerTileEvent(state, uid, path[i].x, path[i].y);
    }
    return true;
  };

  // --------------------------------------------------------------- visão
  Engine.los = function (state, x0, y0, x1, y1) {
    var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    var dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    var err = dx + dy;
    var x = x0, y = y0;
    for (;;) {
      if (!(x === x0 && y === y0) && !(x === x1 && y === y1)) {
        if (blocksSight(state, x, y)) return false;
      }
      if (x === x1 && y === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
    return true;
  };

  // --------------------------------------------------------------- feitiços
  function canCastNow(state, unit, spell) {
    if (!unit.alive || unit.offBoard) return false;
    if (unit.spells.indexOf(spell.id) < 0) return false;
    if (unit.pa < sPaCost(spell)) return false;
    if ((unit.cooldowns[spell.id] || 0) > 0) return false;
    if (sCastsPerTurn(spell) > 0 &&
        (unit.castsThisTurn[spell.id] || 0) >= sCastsPerTurn(spell)) return false;
    return true;
  }

  function validTargetCell(state, unit, spell, tx, ty) {
    if (!inBounds(state, tx, ty)) return false;
    if (!isFloor(state, tx, ty)) return false;
    var rg = sRange(spell);
    var d = manhattan(unit.x, unit.y, tx, ty);
    if (d < (rg.min || 0) || d > (rg.max != null ? rg.max : 1)) return false;
    if (rg.line && !(tx === unit.x || ty === unit.y)) return false;
    if (rg.los && !Engine.los(state, unit.x, unit.y, tx, ty)) return false;
    var occupant = Engine.unitAt(state, tx, ty);
    if (spell.needsEmptyTile && occupant) return false;
    if (spellHasEffect(spell, 'swap') && (!occupant || occupant === unit)) return false;
    // v2: targetSide
    var ts = spell.targetSide;

    // FEITICO DE AREA MIRA O CHAO, NAO A CRIATURA.
    // `targetSide:'enemy'` exigia um inimigo NA PROPRIA celula, entao um feitico
    // de area so podia ser lancado em cima de alguem — nao dava para largar a
    // explosao entre dois inimigos, nem chutar onde o outro VAI estar. Numa
    // grade tatica isso e meia mecanica jogada fora.
    // Quando o feitico tem area de verdade, a celula-alvo passa a ser um LUGAR:
    // basta estar no alcance, e a area pega quem estiver dentro (ou ninguem).
    // O alvo 'self' continua preso ao conjurador, que e o que ele significa.
    var ar = spell.aoe;
    var temArea = !!(ar && ar.shape && ar.shape !== 'single' && (ar.size || 0) > 0);
    if (temArea && (ts === 'enemy' || ts === 'ally')) return true;

    if (ts === 'enemy' && (!occupant || occupant.side === unit.side)) return false;
    if (ts === 'ally' && (!occupant || occupant.side !== unit.side)) return false;
    if (ts === 'self' && !(tx === unit.x && ty === unit.y)) return false;
    return true;
  }
  Engine.validTargetCell = validTargetCell;

  /* ALCANCE do feitiço, para a interface desenhar.
   * `castTargets` devolve só as células com ALVO VÁLIDO: para um ataque de
   * corpo a corpo sem ninguém ao lado, devolve VAZIO — e o tabuleiro não pinta
   * nada. Do lado do jogador isso parece defeito: ele escolhe o ataque e a tela
   * não responde. Foi o relato do playtest ("ao selecionar um ataque deve
   * mostrar o alcance daquele ataque").
   * Aqui devolvemos ONDE O FEITIÇO CHEGA — distância, linha e visão —, sem
   * exigir que haja alguém lá. A interface pinta este conjunto fraco e, por
   * cima, `castTargets` forte: o jogador vê o alcance E quem dá para acertar. */
  Engine.spellRange = function (state, uid, spellId) {
    var u = Engine.findUnit(state, uid);
    var spell = spellDef(spellId);
    if (!u || !spell) return [];
    var rg = sRange(spell);
    var out = [];
    for (var y = 0; y < state.grid.h; y++) {
      for (var x = 0; x < state.grid.w; x++) {
        if (!isFloor(state, x, y)) continue;
        var d = manhattan(u.x, u.y, x, y);
        if (d < (rg.min || 0) || d > (rg.max != null ? rg.max : 1)) continue;
        if (rg.line && !(x === u.x || y === u.y)) continue;
        if (rg.los && !Engine.los(state, u.x, u.y, x, y)) continue;
        out.push({ x: x, y: y });
      }
    }
    return out;
  };

  Engine.castTargets = function (state, uid, spellId) {
    var u = Engine.findUnit(state, uid);
    var spell = spellDef(spellId);
    if (!u || !spell || !canCastNow(state, u, spell)) return [];
    var out = [];
    for (var y = 0; y < state.grid.h; y++) {
      for (var x = 0; x < state.grid.w; x++) {
        if (validTargetCell(state, u, spell, x, y)) out.push({ x: x, y: y });
      }
    }
    return out;
  };

  // Aceita id de feitiço OU o objeto do feitiço (armadilhas e eventos de
  // terreno conjuram feitiços sintéticos que não existem em DATA).
  Engine.aoeTiles = function (state, spellOrId, casterX, casterY, tx, ty) {
    var spell = (spellOrId && typeof spellOrId === 'object') ? spellOrId : spellDef(spellOrId);
    if (!spell) return [];
    var aoe = sAoe(spell);
    var shape = aoe.shape, size = aoe.size || 0;
    var out = [];
    function add(x, y) {
      if (inBounds(state, x, y) && state.grid.tiles[y][x].type !== 'wall') {
        out.push({ x: x, y: y });
      }
    }
    var dx, dy, i, s;
    if (shape === 'single') {
      add(tx, ty);
    } else if (shape === 'cross') {
      add(tx, ty);
      for (s = 1; s <= size; s++) {
        add(tx + s, ty); add(tx - s, ty); add(tx, ty + s); add(tx, ty - s);
      }
    } else if (shape === 'circle') {
      for (dy = -size; dy <= size; dy++) {
        for (dx = -size; dx <= size; dx++) {
          if (Math.abs(dx) + Math.abs(dy) <= size) add(tx + dx, ty + dy);
        }
      }
    } else if (shape === 'line') {
      // linha de comprimento `size` a partir do alvo, afastando-se do conjurador
      var ddx = tx - casterX, ddy = ty - casterY;
      var sx = 0, sy = 0;
      if (Math.abs(ddx) >= Math.abs(ddy)) sx = ddx === 0 ? 1 : (ddx > 0 ? 1 : -1);
      else sy = ddy > 0 ? 1 : -1;
      for (i = 0; i < Math.max(1, size); i++) add(tx + i * sx, ty + i * sy);
    } else if (shape === 'cone') {
      // v2: triângulo a partir do alvo, abrindo no sentido oposto ao conjurador.
      // linha i (0..size-1) tem 2i+1 células; total = size².
      var cdx = tx - casterX, cdy = ty - casterY;
      var fx = 0, fy = 0;
      if (Math.abs(cdx) >= Math.abs(cdy)) fx = cdx === 0 ? 1 : (cdx > 0 ? 1 : -1);
      else fy = cdy > 0 ? 1 : -1;
      var px = -fy, py = fx;                  // eixo perpendicular
      for (i = 0; i < Math.max(1, size); i++) {
        for (var k = -i; k <= i; k++) {
          add(tx + fx * i + px * k, ty + fy * i + py * k);
        }
      }
    } else if (shape === 'ring') {
      // v2: coroa de distância Manhattan exatamente `size`
      if (size <= 0) { add(tx, ty); }
      else {
        for (dy = -size; dy <= size; dy++) {
          for (dx = -size; dx <= size; dx++) {
            if (Math.abs(dx) + Math.abs(dy) === size) add(tx + dx, ty + dy);
          }
        }
      }
    }
    return out;
  };

  // --------------------------------------------------------------- dano
  // v2: `mult` extra (falloff de chain, marcas já embutidas pelo chamador)
  function rollDamageAmount(state, min, max, power, resist, mult) {
    var roll = rollInt(state, min, max);
    var amt = Math.round(roll * (100 + power) / 100 * (100 - resist) / 100 * (mult == null ? 1 : mult));
    return Math.max(0, amt);
  }

  // Aplica dano já calculado: escudo absorve antes do PV. Retorna a perda de PV.
  function dealDamage(state, target, amount, element, sourceUid, noReflect) {
    if (!target.alive || amount <= 0) {
      if (target.alive) emit({ type: 'damage', uid: target.uid, amount: 0, element: element });
      return 0;
    }
    var absorbed = 0;
    if (target.shield > 0) {
      var left = amount;
      for (var i = 0; i < target.effects.length && left > 0; i++) {
        var e = target.effects[i];
        if (e.type !== 'shield' || e.remaining <= 0) continue;
        var take = Math.min(e.remaining, left);
        e.remaining -= take;
        absorbed += take;
        left -= take;
      }
      for (var j = target.effects.length - 1; j >= 0; j--) {
        if (target.effects[j].type === 'shield' && target.effects[j].remaining <= 0) {
          target.effects.splice(j, 1);
        }
      }
      recomputeShield(target);
    }
    var hpLoss = amount - absorbed;
    target.hp = Math.max(0, target.hp - hpLoss);
    emit({ type: 'damage', uid: target.uid, amount: amount, element: element,
           absorbed: absorbed, hpLoss: hpLoss, sourceUid: sourceUid || null });

    // v2: reflect — devolve % do dano RECEBIDO ao agressor (não re-reflete)
    if (!noReflect && sourceUid && sourceUid !== target.uid) {
      var pct = 0;
      for (var r = 0; r < target.effects.length; r++) {
        if (target.effects[r].type === 'reflect') pct += (target.effects[r].pct || 0);
      }
      if (pct > 0) {
        var attacker = Engine.findUnit(state, sourceUid);
        if (attacker && attacker.alive) {
          var back = Math.round(amount * pct / 100);
          if (back > 0) {
            log(target.name + ' reflete ' + back + ' de dano.');
            emit({ type: 'reflect', uid: target.uid, targetUid: attacker.uid, amount: back });
            dealDamage(state, attacker, back, 'neutro', target.uid, true);
          }
        }
      }
    }

    checkEnrage(state, target);
    if (target.hp <= 0) processDeath(state, target);
    return hpLoss;
  }

  // TODA cura passa por aqui — efeito heal, regen, roubo de vida e regenAura —,
  // então é o único ponto em que a fúria da sala precisa cortar (v2.3).
  function applyHeal(state, target, amount) {
    if (!target.alive || amount <= 0) return 0;
    amount = Math.round(amount * Engine.healScale(state));
    if (amount <= 0) return 0;
    var healed = Math.min(amount, target.hpMax - target.hp);
    target.hp += healed;
    emit({ type: 'heal', uid: target.uid, amount: healed });
    return healed;
  }
  Engine.applyHeal = applyHeal;

  function checkEnrage(state, unit) {
    if (!unit.alive || unit.enraged) return;
    var t = getTrait(unit, 'enrage');
    if (!t) return;
    if (unit.hp < t.hpPct * unit.hpMax) {
      unit.enraged = true;
      var eff = { type: 'buff', stat: 'power', value: t.power, duration: 9999, sourceUid: unit.uid };
      unit.effects.push(eff);
      emit({ type: 'effectApplied', uid: unit.uid, effect: eff });
      log(unit.name + ' se enfurece! (+' + t.power + ' de poder)');
    }
  }

  function freeAdjacentCells(state, x, y, count) {
    var cand = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    var out = [];
    for (var i = 0; i < cand.length && out.length < count; i++) {
      var nx = x + cand[i][0], ny = y + cand[i][1];
      if (isWalkable(state, nx, ny)) out.push({ x: nx, y: ny });
    }
    return out;
  }

  function insertIntoOrderAfter(state, afterUid, newUid) {
    var idx = state.order.indexOf(afterUid);
    if (idx < 0) { state.order.push(newUid); return; }
    state.order.splice(idx + 1, 0, newUid);
    if (idx + 1 <= state.activeIdx) state.activeIdx++;
  }

  function spawnMonsterUnit(state, monsterId, x, y, kind, side, summonerUid) {
    var def = Engine.monster(monsterId);
    if (!def) return null;
    var u = makeUnit(state, def, kind, side, x, y, { element: def.element });
    u.summonerUid = summonerUid || null;
    state.units.push(u);
    insertIntoOrderAfter(state, summonerUid, u.uid);
    emit({ type: 'summon', unit: u });
    return u;
  }

  function processDeath(state, unit) {
    if (!unit.alive) return;
    unit.alive = false;
    unit.hp = 0;
    emit({ type: 'death', uid: unit.uid });
    log(unit.name + ' morre.');

    // v2: fusão que morre some de vez (não devolve os dois)
    if (unit.kind === 'fusion' && JOGO.Fusion && JOGO.Fusion.split) {
      JOGO.Fusion.split(state, unit.uid);
    }

    var explode = getTrait(unit, 'explodeOnDeath');
    if (explode) {
      log(unit.name + ' explode!');
      var victims = [];
      for (var i = 0; i < state.units.length; i++) {
        var v = state.units[i];
        if (v.alive && !v.offBoard && manhattan(unit.x, unit.y, v.x, v.y) <= explode.radius) victims.push(v);
      }
      for (var j = 0; j < victims.length; j++) {
        var resist = Engine.effResist(victims[j], explode.element);
        var amt = Math.max(0, Math.round(explode.damage * (100 - resist) / 100));
        dealDamage(state, victims[j], amt, explode.element, unit.uid);
      }
    }

    var split = getTrait(unit, 'split');
    if (split) {
      var cells = freeAdjacentCells(state, unit.x, unit.y, split.count);
      for (var k = 0; k < cells.length; k++) {
        var kind = unit.kind === 'summon' ? 'summon' : unit.kind;
        spawnMonsterUnit(state, split.monsterId, cells[k].x, cells[k].y, kind, unit.side, unit.uid);
      }
      if (cells.length > 0) log(unit.name + ' se divide em ' + cells.length + '!');
    }

    checkBattleEnd(state);
  }
  Engine.processDeath = processDeath;

  // v2: pets e invocações não sustentam o lado
  function sideHasCore(state, side) {
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (!u.alive || u.offBoard) continue;
      if (u.side !== side) continue;
      if (u.kind === 'summon' || u.kind === 'pet') continue;
      return true;
    }
    return false;
  }

  function checkBattleEnd(state) {
    if (state.phase !== 'playing') return;
    var playerAlive = sideHasCore(state, 'player');
    var enemyAlive = sideHasCore(state, 'enemy');
    if (!playerAlive) {
      state.phase = 'lost';
      emit({ type: 'battleEnd', winner: 'enemy' });
      log('A Descida foi derrotada...');
    } else if (!enemyAlive) {
      state.phase = 'won';
      emit({ type: 'battleEnd', winner: 'player' });
      log('Sala limpa!');
    }
  }
  Engine.checkBattleEnd = checkBattleEnd;

  // --------------------------------------------------------------- push/pull
  function forcedMove(state, caster, target, tiles, mode) {
    if (!target.alive || tiles <= 0) return;
    if (Engine.unitHasTrait(target, 'pushImmune')) {
      log(target.name + ' não se move um palmo.');
      return;
    }
    var fromX = target.x, fromY = target.y;
    var moved = 0, collisionDmg = 0;
    var i, sx, sy, nx, ny;

    if (mode === 'push') {
      var ddx = target.x - caster.x, ddy = target.y - caster.y;
      if (ddx === 0 && ddy === 0) return;
      if (Math.abs(ddx) >= Math.abs(ddy)) { sx = ddx >= 0 ? 1 : -1; sy = 0; }
      else { sx = 0; sy = ddy > 0 ? 1 : -1; }
      for (i = 0; i < tiles; i++) {
        nx = target.x + sx; ny = target.y + sy;
        if (!isWalkable(state, nx, ny)) {
          collisionDmg = 10 * (tiles - moved);
          break;
        }
        target.x = nx; target.y = ny; moved++;
      }
    } else { // pull — passo a passo, eixo dominante reavaliado
      var intended = Math.min(tiles, Math.max(0, manhattan(caster.x, caster.y, target.x, target.y) - 1));
      for (i = 0; i < tiles; i++) {
        var dx = caster.x - target.x, dy = caster.y - target.y;
        if (Math.abs(dx) + Math.abs(dy) <= 1) break; // adjacente: fim natural, sem colisão
        if (Math.abs(dx) >= Math.abs(dy)) { sx = dx > 0 ? 1 : -1; sy = 0; }
        else { sx = 0; sy = dy > 0 ? 1 : -1; }
        nx = target.x + sx; ny = target.y + sy;
        if (!isWalkable(state, nx, ny)) {
          if (sy === 0 && dy !== 0 && isWalkable(state, target.x, target.y + (dy > 0 ? 1 : -1))) {
            nx = target.x; ny = target.y + (dy > 0 ? 1 : -1);
          } else if (sx === 0 && dx !== 0 && isWalkable(state, target.x + (dx > 0 ? 1 : -1), target.y)) {
            nx = target.x + (dx > 0 ? 1 : -1); ny = target.y;
          } else {
            collisionDmg = 10 * (intended - moved);
            break;
          }
        }
        target.x = nx; target.y = ny; moved++;
      }
    }

    if (moved > 0 || collisionDmg > 0) {
      emit({ type: 'pushed', uid: target.uid, fromX: fromX, fromY: fromY,
             toX: target.x, toY: target.y, collision: collisionDmg });
      if (collisionDmg > 0) {
        log(target.name + ' colide! (' + collisionDmg + ' de dano)');
        dealDamage(state, target, collisionDmg, 'neutro', caster.uid);
      }
    }
  }

  // --------------------------------------------------- v2: marcas
  function applyMark(state, target, eff, sourceUid) {
    var maxStacks = eff.max || Engine.MARK_DEFAULT_MAX;
    var value = eff.value != null ? eff.value : Engine.MARK_DEFAULT_VALUE;
    var stacks = countEffects(target, 'mark');
    if (stacks >= maxStacks) {
      for (var i = 0; i < target.effects.length; i++) {   // renova a mais antiga
        if (target.effects[i].type === 'mark') {
          target.effects[i].duration = Math.max(target.effects[i].duration, eff.duration);
          break;
        }
      }
    } else {
      var applied = { type: 'mark', value: value, duration: eff.duration,
                      max: maxStacks, sourceUid: sourceUid };
      target.effects.push(applied);
      stacks++;
      emit({ type: 'effectApplied', uid: target.uid, effect: applied });
    }
    emit({ type: 'markStack', uid: target.uid, stacks: stacks });
  }

  function consumeMarks(target) {
    var n = 0;
    for (var i = target.effects.length - 1; i >= 0; i--) {
      if (target.effects[i].type === 'mark') { target.effects.splice(i, 1); n++; }
    }
    return n;
  }

  // --------------------------------------------------- v2: armadilhas
  Engine.trapsAt = function (state, x, y) {
    var out = [];
    for (var i = 0; i < state.traps.length; i++) {
      if (state.traps[i].x === x && state.traps[i].y === y) out.push(state.traps[i]);
    }
    return out;
  };

  Engine.triggerTrap = function (state, uid, x, y) {
    var u = Engine.findUnit(state, uid);
    if (!u || !u.alive || state.phase !== 'playing') return false;
    for (var i = state.traps.length - 1; i >= 0; i--) {
      var tr = state.traps[i];
      if (tr.x !== x || tr.y !== y) continue;
      if (tr.side === u.side) continue;              // não dispara para o próprio lado
      state.traps.splice(i, 1);
      emit({ type: 'trapTriggered', uid: uid, trapId: tr.trapId, x: x, y: y });
      log(u.name + ' pisa em uma armadilha!');
      var sp = spellDef(tr.trapId);
      if (sp) {
        var owner = Engine.findUnit(state, tr.ownerUid);
        if (!owner || !owner.alive) owner = u;
        castCore(state, owner, sp, x, y, { casterX: x, casterY: y, selfHarm: true, silent: true });
      }
      return true;
    }
    return false;
  };

  // --------------------------------------------------- v2: eventos de terreno
  Engine.tileEventAt = function (state, x, y) {
    for (var i = 0; i < state.tileEventsActive.length; i++) {
      var te = state.tileEventsActive[i];
      if (te.x === x && te.y === y) return te;
    }
    return null;
  };

  function spawnTileEvents(state) {
    var D = DATA();
    if (!D.tileEvents) return;
    var dungeon = getDungeon(state.dungeonId);
    if (!dungeon) return;
    var rate = dungeon.tileEventRate;
    if (!rate) return;
    var perRound = dungeon.tileEventSpawnPerRound || dungeon.spawnPerRound || 1;
    var pool = [];
    for (var k in D.tileEvents) {
      if (Object.prototype.hasOwnProperty.call(D.tileEvents, k)) pool.push(D.tileEvents[k]);
    }
    if (!pool.length) return;

    for (var n = 0; n < perRound; n++) {
      if (nextRand(state) >= rate) continue;
      var free = [];
      for (var y = 0; y < state.grid.h; y++) {
        for (var x = 0; x < state.grid.w; x++) {
          if (!isFloor(state, x, y)) continue;
          if (Engine.unitAt(state, x, y)) continue;
          if (Engine.tileEventAt(state, x, y)) continue;
          if (Engine.trapsAt(state, x, y).length) continue;
          free.push({ x: x, y: y });
        }
      }
      if (!free.length) return;
      var cell = free[Math.floor(nextRand(state) * free.length)];
      var ev = weightedPick(state, pool);
      if (!ev) return;
      var entry = { x: cell.x, y: cell.y, eventId: ev.id, kind: ev.kind,
                    icon: ev.icon || null, remaining: ev.duration || 3 };
      state.tileEventsActive.push(entry);
      emit({ type: 'tileEventSpawn', x: cell.x, y: cell.y, eventId: ev.id, kind: ev.kind });
    }
  }

  Engine.triggerTileEvent = function (state, uid, x, y) {
    var u = Engine.findUnit(state, uid);
    if (!u || !u.alive || state.phase !== 'playing') return false;
    for (var i = 0; i < state.tileEventsActive.length; i++) {
      var te = state.tileEventsActive[i];
      if (te.x !== x || te.y !== y) continue;
      var def = (DATA().tileEvents || {})[te.eventId];
      state.tileEventsActive.splice(i, 1);     // consome
      var effects = null, text = '';
      if (def) {
        if (def.outcomes && def.outcomes.length) {           // '?' surpresa
          var pick = weightedPick(state, def.outcomes);
          if (pick) { effects = pick.effects || []; text = pick.text || def.name || ''; }
        } else {
          effects = def.effects || [];
          text = def.name || '';
        }
      }
      emit({ type: 'tileEvent', uid: uid, eventId: te.eventId, x: x, y: y, text: text });
      if (text) log(u.name + ': ' + text);
      if (effects && effects.length) {
        // o pisante é o "conjurador" E alvo legítimo (decisão de design 14)
        applyEffects(state, u, { id: 'tileEvent:' + te.eventId, element: 'neutro',
                                 aoe: { shape: 'single', size: 0 }, effects: effects },
                     x, y, { casterX: x, casterY: y, selfHarm: true });
      }
      return true;
    }
    return false;
  };

  // --------------------------------------------------------------- cast
  Engine.cast = function (state, uid, spellId, x, y) {
    if (state.phase !== 'playing') return false;
    var caster = Engine.findUnit(state, uid);
    var spell = spellDef(spellId);
    if (!caster || !spell) return false;
    if (!canCastNow(state, caster, spell)) return false;
    if (!validTargetCell(state, caster, spell, x, y)) return false;

    caster.pa -= sPaCost(spell);
    caster.castsThisTurn[spellId] = (caster.castsThisTurn[spellId] || 0) + 1;
    if (sCooldown(spell) > 0) caster.cooldowns[spellId] = sCooldown(spell) + 1;

    castCore(state, caster, spell, x, y, {});
    return true;
  };

  // Conjuração sem custo/validação (usada por cast, armadilhas, pets e eventos).
  function castCore(state, caster, spell, x, y, opts) {
    opts = opts || {};
    emit({ type: 'cast', uid: caster.uid, spellId: spell.id, x: x, y: y,
           fxKey: spell.fxKey, element: spell.element });
    if (!opts.silent) log(caster.name + ' conjura ' + spell.name + '.');

    // invisível quebra ao conjurar dano
    if (spellHasEffect(spell, 'damage') && Engine.unitHasEffect(caster, 'invisible')) {
      for (var r = caster.effects.length - 1; r >= 0; r--) {
        if (caster.effects[r].type === 'invisible') caster.effects.splice(r, 1);
      }
      log(caster.name + ' sai das sombras!');
    }
    applyEffects(state, caster, spell, x, y, opts);
  }
  Engine.castCore = castCore;

  function applyEffects(state, caster, spell, x, y, opts) {
    opts = opts || {};
    var cx = opts.casterX != null ? opts.casterX : caster.x;
    var cy = opts.casterY != null ? opts.casterY : caster.y;
    var tiles = Engine.aoeTiles(state, spell, cx, cy, x, y);
    var effects = sEffects(spell);
    // v2.2/v2.3: calculado UMA vez por conjuração — depende do conjurador e do
    // feitiço, não do alvo. Inclui buffs, bônus elemental e fúria da sala.
    var castPower = Engine.castPower(state, caster, spell);

    function unitsInTiles(includeCaster) {
      var list = [];
      for (var i = 0; i < tiles.length; i++) {
        var u = Engine.unitAt(state, tiles[i].x, tiles[i].y);
        if (u && u.alive && (includeCaster || u !== caster)) list.push(u);
      }
      return list;
    }
    // efeitos ofensivos não atingem o conjurador — exceto armadilha/evento de
    // terreno, em que o "conjurador" é justamente a vítima (selfHarm).
    function hostileTargets() { return unitsInTiles(!!opts.selfHarm); }

    for (var e = 0; e < effects.length; e++) {
      if (state.phase !== 'playing') break;
      var eff = effects[e];
      var targets, t, u, applied;

      switch (eff.type) {
        case 'damage':
          targets = hostileTargets();
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            var amt = rollDamageAmount(state, eff.min, eff.max,
              castPower,                                       // v2.2/v2.3
              Engine.effResist(u, eff.element),
              Engine.markMultiplier(u));                       // v2: marcas
            var hpLoss = dealDamage(state, u, amt, eff.element, caster.uid);
            if (eff.lifesteal && hpLoss > 0 && caster.alive) {
              var stolen = Math.round(hpLoss / 2);
              if (stolen > 0) {
                applyHeal(state, caster, stolen);
                log(caster.name + ' rouba ' + stolen + ' de vida.');
              }
            }
          }
          break;

        case 'heal':
          targets = unitsInTiles(true);
          for (t = 0; t < targets.length; t++) {
            applyHeal(state, targets[t], rollInt(state, eff.min, eff.max));
          }
          break;

        case 'shield':
          targets = unitsInTiles(true);
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            applied = { type: 'shield', value: eff.value, remaining: eff.value,
                        duration: eff.duration, sourceUid: caster.uid };
            u.effects.push(applied);
            recomputeShield(u);
            emit({ type: 'shield', uid: u.uid, amount: eff.value });
            emit({ type: 'effectApplied', uid: u.uid, effect: applied });
          }
          break;

        case 'buff':
          targets = unitsInTiles(true);
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            applied = { type: 'buff', stat: eff.stat, value: eff.value,
                        duration: eff.duration, sourceUid: caster.uid };
            u.effects.push(applied);
            // ajuste imediato para buffs de recursos valerem já neste turno
            if (eff.stat === 'pa') u.pa = Math.max(0, u.pa + eff.value);
            if (eff.stat === 'pp') u.pp = Math.max(0, u.pp + eff.value);
            if (eff.stat === 'initiative') u.initiative += eff.value; // não reordena
            emit({ type: 'effectApplied', uid: u.uid, effect: applied });
          }
          break;

        case 'resist':
          targets = unitsInTiles(true);
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            applied = { type: 'resist', element: eff.element, value: eff.value,
                        duration: eff.duration, sourceUid: caster.uid };
            u.effects.push(applied);
            emit({ type: 'effectApplied', uid: u.uid, effect: applied });
          }
          break;

        case 'poison':
          targets = hostileTargets();
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            // o veneno congela o poder do conjurador no cast (decisão v1) — o
            // bônus elemental v2.2 e a fúria v2.3 são parte desse poder e vão
            // congelados junto, no valor que valia na hora da conjuração.
            applied = { type: 'poison', element: eff.element, min: eff.min, max: eff.max,
                        duration: eff.duration, sourceUid: caster.uid,
                        sourcePower: castPower };
            u.effects.push(applied);
            emit({ type: 'effectApplied', uid: u.uid, effect: applied });
          }
          break;

        case 'regen':
          targets = unitsInTiles(true);
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            applied = { type: 'regen', min: eff.min, max: eff.max,
                        duration: eff.duration, sourceUid: caster.uid };
            u.effects.push(applied);
            emit({ type: 'effectApplied', uid: u.uid, effect: applied });
          }
          break;

        case 'push':
          targets = hostileTargets();
          targets.sort(function (a, b) {
            return manhattan(cx, cy, b.x, b.y) - manhattan(cx, cy, a.x, a.y);
          });
          for (t = 0; t < targets.length; t++) forcedMove(state, caster, targets[t], eff.tiles, 'push');
          break;

        case 'pull':
          targets = hostileTargets();
          targets.sort(function (a, b) {
            return manhattan(cx, cy, a.x, a.y) - manhattan(cx, cy, b.x, b.y);
          });
          for (t = 0; t < targets.length; t++) forcedMove(state, caster, targets[t], eff.tiles, 'pull');
          break;

        case 'teleport':
          if (!Engine.unitAt(state, x, y) && isFloor(state, x, y)) {
            var tfx = caster.x, tfy = caster.y;
            caster.x = x; caster.y = y;
            emit({ type: 'teleport', uid: caster.uid, fromX: tfx, fromY: tfy, toX: x, toY: y });
          }
          break;

        case 'swap':
          u = Engine.unitAt(state, x, y);
          if (u && u !== caster) {
            var sx2 = caster.x, sy2 = caster.y;
            caster.x = u.x; caster.y = u.y;
            u.x = sx2; u.y = sy2;
            emit({ type: 'teleport', uid: caster.uid, fromX: sx2, fromY: sy2, toX: caster.x, toY: caster.y });
            emit({ type: 'teleport', uid: u.uid, fromX: caster.x, fromY: caster.y, toX: sx2, toY: sy2 });
          }
          break;

        case 'summon':
          if (!Engine.unitAt(state, x, y) && isFloor(state, x, y)) {
            var su = spawnMonsterUnit(state, eff.monsterId, x, y, 'summon', caster.side, caster.uid);
            if (su) log(caster.name + ' invoca ' + su.name + '.');
          }
          break;

        case 'taunt':
          targets = unitsInTiles(true);
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            applied = { type: 'taunt', duration: eff.duration, sourceUid: caster.uid };
            u.effects.push(applied);
            emit({ type: 'effectApplied', uid: u.uid, effect: applied });
            log(u.name + ' provoca os inimigos!');
          }
          break;

        case 'invisible':
          targets = unitsInTiles(true);
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            applied = { type: 'invisible', duration: eff.duration, sourceUid: caster.uid };
            u.effects.push(applied);
            emit({ type: 'effectApplied', uid: u.uid, effect: applied });
            log(u.name + ' some nas sombras.');
          }
          break;

        // ------------------------------------------------------------ v2
        case 'root':
          targets = hostileTargets();
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            applied = { type: 'root', duration: eff.duration, sourceUid: caster.uid };
            u.effects.push(applied);
            u.pp = 0;                                   // prende já neste turno
            emit({ type: 'effectApplied', uid: u.uid, effect: applied });
            log(u.name + ' fica preso ao chão.');
          }
          break;

        case 'mark':
          targets = hostileTargets();
          for (t = 0; t < targets.length; t++) applyMark(state, targets[t], eff, caster.uid);
          break;

        case 'detonateMarks':
          targets = hostileTargets();
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            var stacks = consumeMarks(u);
            if (stacks <= 0) continue;
            emit({ type: 'markStack', uid: u.uid, stacks: 0 });
            var dmg = Math.round(stacks * (eff.mult || 0));
            log(u.name + ': ' + stacks + ' marcas detonam (' + dmg + ').');
            dealDamage(state, u, dmg, eff.element || spell.element || 'neutro', caster.uid);
          }
          break;

        /* MURO INVOCADO — o verbo BARRAR, do Minotauro.
         *
         * `wall` ja e um tipo de celula que bloqueia passagem e visao, vindo do
         * `#` do desenho da sala. O que faltava era mudar o tipo DURANTE a
         * partida e devolver depois. Nao ha peca nova no tabuleiro: e a propria
         * celula que endurece por alguns turnos.
         *
         * Regras que o muro respeita, e o motivo de cada uma:
         *   · so sobe em celula de CHAO — nao em cima de buraco nem de outro muro;
         *   · nao sobe em celula OCUPADA, senao a unidade fica presa dentro da
         *     pedra sem ter como sair;
         *   · guarda o tipo anterior e devolve ao expirar. */
        case 'wall':
          if (isFloor(state, x, y) && !Engine.unitAt(state, x, y)) {
            var jaTem = false;
            for (var wi = 0; wi < state.walls.length; wi++) {
              if (state.walls[wi].x === x && state.walls[wi].y === y) { jaTem = true; break; }
            }
            if (!jaTem) {
              var cel = tileAt(state, x, y);
              // O ELEMENTO fica guardado no muro, nao so no evento. O
              // renderizador desenha a pedra pela lista `state.walls` (um muro
              // dura varios turnos e o evento passa uma vez so), e sem isso ele
              // nao teria como saber de que cor pintar o que ja estava de pe —
              // mesmo problema que a armadilha teve, resolvido do mesmo jeito.
              state.walls.push({ x: x, y: y, antes: cel.type, deco: !!cel.deco,
                                 ownerUid: caster.uid, side: caster.side,
                                 element: eff.element || spell.element || 'neutro',
                                 remaining: eff.duration || 3 });
              cel.type = 'wall';
              cel.deco = false;
              cel.invocado = true;
              emit({ type: 'wallRaised', uid: caster.uid, x: x, y: y,
                     element: eff.element || spell.element || 'neutro',
                     duration: eff.duration || 3 });
              log(caster.name + ' ergue um muro.');
            }
          }
          break;

        case 'trap':
          if (isFloor(state, x, y)) {
            var trap = { x: x, y: y, trapId: eff.trapId, ownerUid: caster.uid,
                         side: caster.side, remaining: eff.duration || 3 };
            state.traps.push(trap);
            emit({ type: 'trapSet', uid: caster.uid, trapId: eff.trapId, x: x, y: y });
            log(caster.name + ' arma uma armadilha.');
          }
          break;

        case 'weatherShift':
          setWeather(state, eff.weather);
          break;

        case 'cleanse':
          targets = unitsInTiles(true);
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            var kinds = eff.kinds || [];
            var removed = 0;
            for (var ci = u.effects.length - 1; ci >= 0; ci--) {
              if (kinds.indexOf(u.effects[ci].type) >= 0) { u.effects.splice(ci, 1); removed++; }
            }
            recomputeShield(u);
            if (removed > 0) {
              emit({ type: 'cleanse', uid: u.uid, kinds: kinds.slice(), removed: removed });
              log(u.name + ' se purifica.');
            }
          }
          break;

        case 'reflect':
          targets = unitsInTiles(true);
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            applied = { type: 'reflect', pct: eff.pct, duration: eff.duration, sourceUid: caster.uid };
            u.effects.push(applied);
            emit({ type: 'effectApplied', uid: u.uid, effect: applied });
          }
          break;

        case 'dispelShield':
          targets = hostileTargets();
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            var had = u.shield;
            for (var di = u.effects.length - 1; di >= 0; di--) {
              if (u.effects[di].type === 'shield') u.effects.splice(di, 1);
            }
            recomputeShield(u);
            if (had > 0) {
              emit({ type: 'dispelShield', uid: u.uid, removed: had });
              emit({ type: 'shield', uid: u.uid, amount: 0 });
              log(u.name + ' perde o escudo.');
            }
          }
          break;

        case 'moveTo':
          slideTo(state, caster, x, y, eff.maxTiles || 0);
          break;

        case 'chain':
          chainDamage(state, caster, eff, spell, x, y, castPower);
          break;
      }
    }
  }
  Engine.applyEffects = applyEffects;

  // v2: investida — desliza por eixo dominante até maxTiles
  function slideTo(state, caster, x, y, maxTiles) {
    var path = [];
    var steps = 0;
    while (steps < maxTiles && !(caster.x === x && caster.y === y)) {
      var dx = x - caster.x, dy = y - caster.y;
      var sx = 0, sy = 0;
      if (Math.abs(dx) >= Math.abs(dy)) sx = dx > 0 ? 1 : -1;
      else sy = dy > 0 ? 1 : -1;
      var nx = caster.x + sx, ny = caster.y + sy;
      if (!isWalkable(state, nx, ny)) break;
      caster.x = nx; caster.y = ny;
      path.push({ x: nx, y: ny });
      steps++;
    }
    if (path.length) emit({ type: 'move', uid: caster.uid, path: path, forced: true });
  }

  // v2: raio em cadeia
  function chainDamage(state, caster, eff, spell, x, y, castPower) {
    var cur = Engine.unitAt(state, x, y);
    if (!cur || !cur.alive || cur.side === caster.side) return;
    var hit = {};
    var mult = 1;
    var falloff = eff.falloff != null ? eff.falloff : 0.7;
    var jumps = eff.jumps || 0;
    var element = eff.element || spell.element || 'neutro';
    for (var j = 0; j <= jumps; j++) {
      if (!cur || !cur.alive) break;
      hit[cur.uid] = true;
      var amt = rollDamageAmount(state, eff.min, eff.max,
        castPower != null ? castPower : Engine.effPower(caster),   // v2.2/v2.3
        Engine.effResist(cur, element), Engine.markMultiplier(cur) * mult);
      emit({ type: 'chainHop', uid: cur.uid, index: j });
      dealDamage(state, cur, amt, element, caster.uid);
      if (state.phase !== 'playing') break;
      mult *= falloff;
      // próximo salto: inimigo vivo mais próximo ainda não atingido
      var next = null, bestD = 999;
      for (var i = 0; i < state.units.length; i++) {
        var u = state.units[i];
        if (!u.alive || u.offBoard || hit[u.uid]) continue;
        if (u.side === caster.side) continue;
        var d = manhattan(cur.x, cur.y, u.x, u.y);
        if (d <= Engine.CHAIN_JUMP_RANGE && d < bestD) { bestD = d; next = u; }
      }
      cur = next;
    }
  }

  // --------------------------------------------------------------- turnos
  // Tiques de início de turno compartilhados por unidades da ordem e por pets.
  function runStartTicks(state, u) {
    weatherTick(state, u);                        // v2
    if (!u.alive) return;

    var aura = getTrait(u, 'regenAura');
    if (aura) {
      for (var i = 0; i < state.units.length; i++) {
        var ally = state.units[i];
        if (ally.alive && !ally.offBoard && ally !== u && ally.side === u.side &&
            manhattan(u.x, u.y, ally.x, ally.y) <= aura.radius && ally.hp < ally.hpMax) {
          applyHeal(state, ally, aura.value);
        }
      }
    }

    var effs = u.effects.slice();
    for (var e = 0; e < effs.length; e++) {
      if (!u.alive) break;
      var eff = effs[e];
      if (u.effects.indexOf(eff) < 0) continue;
      if (eff.type === 'poison') {
        var amt = rollDamageAmount(state, eff.min, eff.max,
          eff.sourcePower || 0, Engine.effResist(u, eff.element), Engine.markMultiplier(u));
        if (amt > 0) log(u.name + ' sofre ' + amt + ' de veneno.');
        dealDamage(state, u, amt, eff.element, eff.sourceUid);
      } else if (eff.type === 'regen') {
        applyHeal(state, u, rollInt(state, eff.min, eff.max));
      }
    }
  }

  /* v2.4 — o `type` do efeito é vocabulário FECHADO do contrato e fica em inglês
   * no código; o diário de batalha, não. "Bárbaro: efeito root expira" era a
   * única pista de que a unidade voltara a andar — e em inglês. */
  var EFEITO_PT = {
    root: 'não está mais preso ao chão', poison: 'se livra do veneno',
    regen: 'para de se regenerar', shield: 'perde o escudo',
    buff: 'perde o bônus', resist: 'perde a resistência',
    taunt: 'não está mais provocado', invisible: 'reaparece',
    mark: 'perde uma marca', reflect: 'para de refletir dano'
  };

  function tickDownEffects(state, u) {
    for (var i = u.effects.length - 1; i >= 0; i--) {
      var eff = u.effects[i];
      eff.duration--;
      if (eff.duration <= 0) {
        u.effects.splice(i, 1);
        log(u.name + ' ' + (EFEITO_PT[eff.type] || ('perde o efeito ' + eff.type)) + '.');
      }
    }
    recomputeShield(u);
    for (var sid in u.cooldowns) {
      if (u.cooldowns[sid] > 0) u.cooldowns[sid]--;
    }
  }

  function startTurn(state, guard) {
    if (state.phase !== 'playing') return;
    if (guard > state.order.length + 2) return;
    var u = Engine.activeUnit(state);
    if (!u || !u.alive || u.offBoard) { advanceTurn(state, guard + 1); return; }

    u.pa = Math.max(0, u.paMax + sumBuffs(u, 'pa'));
    u.pp = Math.max(0, u.ppMax + sumBuffs(u, 'pp'));
    if (Engine.unitHasEffect(u, 'root')) u.pp = 0;      // v2
    u.castsThisTurn = {};
    emit({ type: 'turnStart', uid: u.uid });

    runStartTicks(state, u);

    if (!u.alive) advanceTurn(state, guard + 1);
  }

  // v2: início de rodada — clima automático, armadilhas e eventos de terreno
  function onRoundStart(state) {
    var i;
    // v2.3: a sala esquenta. Avisa a interface a cada degrau para o jogador ver
    // a pressão subindo, e corta a batalha no teto — sem teto, uma sala em que
    // ninguém consegue matar ninguém ainda seria um beco sem saída.
    var fcfg = furyConfig();
    var fury = Engine.furyOf(state);
    if (fury.rounds > 0) {
      emit({ type: 'fury', round: state.round, power: fury.power,
             healScale: fury.healScale, rounds: fury.rounds });
      if (fury.rounds === 1) log('A sala se enfurece! Os inimigos ganham força a cada rodada.');
    }
    if (fcfg.maxRounds > 0 && state.round >= fcfg.maxRounds) {
      state.phase = 'lost';
      emit({ type: 'furyTimeout', round: state.round, maxRounds: fcfg.maxRounds });
      emit({ type: 'battleEnd', winner: 'enemy', reason: 'fury' });
      log('A sala consome quem demora demais.');
      return;
    }
    var dungeon = getDungeon(state.dungeonId);
    var every = (dungeon && dungeon.weatherShiftEveryRounds) || 0;
    if (every > 0 && state.round > 1 && (state.round - 1) % every === 0) {
      var cyc = weatherCycle(state);
      if (cyc.length > 1) {
        state._weatherIdx = (state._weatherIdx + 1) % cyc.length;
        var next = cyc[state._weatherIdx];
        state.weather = null;             // força o evento mesmo em ciclo curto
        setWeather(state, next);
      }
    }
    // muros invocados envelhecem junto das armadilhas, e devolvem a celula ao
    // que ela era — nao a 'floor' cru, para nao apagar chao decorado
    for (i = state.walls.length - 1; i >= 0; i--) {
      state.walls[i].remaining--;
      if (state.walls[i].remaining <= 0) {
        var w = state.walls[i];
        var cw = tileAt(state, w.x, w.y);
        if (cw) { cw.type = w.antes; cw.deco = w.deco; cw.invocado = false; }
        emit({ type: 'wallFell', x: w.x, y: w.y });
        state.walls.splice(i, 1);
      }
    }
    for (i = state.traps.length - 1; i >= 0; i--) {
      state.traps[i].remaining--;
      if (state.traps[i].remaining <= 0) {
        emit({ type: 'trapExpired', trapId: state.traps[i].trapId,
               x: state.traps[i].x, y: state.traps[i].y });
        state.traps.splice(i, 1);
      }
    }
    for (i = state.tileEventsActive.length - 1; i >= 0; i--) {
      state.tileEventsActive[i].remaining--;
      if (state.tileEventsActive[i].remaining <= 0) {
        emit({ type: 'tileEventExpired', eventId: state.tileEventsActive[i].eventId,
               x: state.tileEventsActive[i].x, y: state.tileEventsActive[i].y });
        state.tileEventsActive.splice(i, 1);
      }
    }
    spawnTileEvents(state);
  }

  function advanceTurn(state, guard) {
    if (state.phase !== 'playing') return;
    if (guard > state.order.length + 2) return;
    var steps = 0, max = state.order.length * 2 + 2;
    do {
      state.activeIdx++;
      if (state.activeIdx >= state.order.length) {
        state.activeIdx = 0;
        state.round++;
        emit({ type: 'roundStart', round: state.round });
        onRoundStart(state);                            // v2
        if (state.phase !== 'playing') return;
      }
      steps++;
      if (steps > max) return; // ninguém vivo (o fim de batalha já deveria ter disparado)
      var u = Engine.findUnit(state, state.order[state.activeIdx]);
      if (u && u.alive && !u.offBoard) break;
    } while (true);
    startTurn(state, guard);
  }

  Engine.endTurn = function (state) {
    if (state.phase !== 'playing') return;
    var u = Engine.activeUnit(state);
    if (u) {
      tickDownEffects(state, u);
      // v2: a fusão declarada resolve no FIM do turno de quem declarou
      if (JOGO.Fusion && JOGO.Fusion.resolve && state.pendingFusion &&
          state.pendingFusion.a === u.uid) {
        JOGO.Fusion.resolve(state);
      }
      // v2: os pets do dono agem logo depois dele
      if (state.phase === 'playing') Engine.runPetTurn(state, u.uid);
    }
    if (state.phase !== 'playing') return;
    advanceTurn(state, 0);
  };

  // --------------------------------------------------------- v2: turno do pet
  Engine.petsOf = function (state, ownerUid) {
    var out = [];
    for (var i = 0; i < state.units.length; i++) {
      var p = state.units[i];
      if (p.kind === 'pet' && p.ownerUid === ownerUid && p.alive && !p.offBoard) out.push(p);
    }
    return out;
  };

  function petBestSpell(state, pet, kinds) {
    var best = null;
    for (var i = 0; i < pet.spells.length; i++) {
      var sp = spellDef(pet.spells[i]);
      if (!sp) continue;
      if (!canCastNow(state, pet, sp)) continue;
      var match = false;
      for (var k = 0; k < kinds.length; k++) if (spellHasEffect(sp, kinds[k])) match = true;
      if (!match) continue;
      if (!best || sPaCost(sp) > sPaCost(best)) best = sp;   // o mais caro = o melhor
    }
    return best;
  }

  Engine.runPetTurn = function (state, ownerUid) {
    if (state.phase !== 'playing') return false;
    var pets = Engine.petsOf(state, ownerUid);
    if (!pets.length) return false;
    var owner = Engine.findUnit(state, ownerUid);
    var acted = false;

    for (var pi = 0; pi < pets.length; pi++) {
      var pet = pets[pi];
      if (!pet.alive || state.phase !== 'playing') continue;
      pet.pa = Math.max(0, pet.paMax + sumBuffs(pet, 'pa'));
      pet.pp = Math.max(0, pet.ppMax + sumBuffs(pet, 'pp'));
      if (Engine.unitHasEffect(pet, 'root')) pet.pp = 0;
      pet.castsThisTurn = {};
      emit({ type: 'turnStart', uid: pet.uid, pet: true });
      runStartTicks(state, pet);
      if (!pet.alive || state.phase !== 'playing') { continue; }

      var follow = pet.followDistance || Engine.PET_FOLLOW_DEFAULT;
      var reach = pet.range || 1;
      var i, u, d;

      // ------- alvos
      var enemies = [], woundedAlly = null, woundedPct = 1;
      for (i = 0; i < state.units.length; i++) {
        u = state.units[i];
        if (!u.alive || u.offBoard || u === pet) continue;
        if (u.side !== pet.side) { if (!Engine.unitHasEffect(u, 'invisible')) enemies.push(u); }
        else if (u.hp / u.hpMax < woundedPct) { woundedPct = u.hp / u.hpMax; woundedAlly = u; }
      }

      // ------- reposiciona: nunca além de followDistance do dono
      var anchor = owner && owner.alive && !owner.offBoard ? owner : null;
      var cells = [{ x: pet.x, y: pet.y, cost: 0 }].concat(Engine.reachable(state, pet.uid));
      var bestCell = cells[0], bestScore = -Infinity;
      for (i = 0; i < cells.length; i++) {
        var c = cells[i];
        var dOwner = anchor ? manhattan(c.x, c.y, anchor.x, anchor.y) : 0;
        if (anchor && dOwner > follow) continue;          // respeita a coleira
        var score = -0.5 * c.cost;
        if (pet.behavior === 'support') {
          var tgt = woundedAlly || anchor;
          if (tgt) score -= 1.2 * manhattan(c.x, c.y, tgt.x, tgt.y);
        } else if (pet.behavior === 'guard') {
          score -= 2.0 * dOwner;
        } else { // attack
          var dEnemy = 99;
          for (var q = 0; q < enemies.length; q++) {
            d = manhattan(c.x, c.y, enemies[q].x, enemies[q].y);
            if (d < dEnemy) dEnemy = d;
          }
          score -= 1.0 * Math.abs(Math.min(dEnemy, 99) - Math.min(reach, 99));
        }
        if (c.risky) score -= 3;
        if (score > bestScore) { bestScore = score; bestCell = c; }
      }
      if (bestCell.x !== pet.x || bestCell.y !== pet.y) {
        if (Engine.move(state, pet.uid, bestCell.x, bestCell.y)) {
          emit({ type: 'petAct', uid: pet.uid, action: 'move', ownerUid: ownerUid });
          acted = true;
        }
      }
      if (!pet.alive || state.phase !== 'playing') continue;

      // ------- age conforme o comportamento, respeitando `range`
      var spell = null, target = null;
      if (pet.behavior === 'support') {
        spell = petBestSpell(state, pet, ['heal', 'shield', 'buff', 'regen', 'cleanse']);
        target = woundedAlly && woundedAlly.hp < woundedAlly.hpMax ? woundedAlly : (anchor || pet);
      } else {
        spell = petBestSpell(state, pet, ['damage', 'poison', 'push', 'mark', 'root', 'chain']);
        var bd = 999;
        for (i = 0; i < enemies.length; i++) {
          d = manhattan(pet.x, pet.y, enemies[i].x, enemies[i].y);
          if (d <= reach && d < bd) { bd = d; target = enemies[i]; }
        }
      }
      if (spell && target && manhattan(pet.x, pet.y, target.x, target.y) <= reach &&
          validTargetCell(state, pet, spell, target.x, target.y)) {
        if (Engine.cast(state, pet.uid, spell.id, target.x, target.y)) {
          emit({ type: 'petAct', uid: pet.uid, action: 'cast', spellId: spell.id,
                 targetUid: target.uid, ownerUid: ownerUid });
          acted = true;
        }
      } else if (!acted) {
        emit({ type: 'petAct', uid: pet.uid, action: 'idle', ownerUid: ownerUid });
      }

      if (pet.alive) tickDownEffects(state, pet);
    }
    return acted;
  };
})();
