var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* ============================================================================
 * SOTERRA — js/core/engine.js  (dono: Agente de Lógica)
 * Motor determinístico, sem DOM (não acessa document/window além do guard).
 *
 * DECISÕES DE DESIGN (documentadas — o contrato é omisso nesses pontos):
 *  - RNG determinístico (mulberry32) semeado por dungeonId/roomIndex/heroIds:
 *    a mesma batalha com as mesmas ações produz os mesmos números.
 *  - Recarga (cooldown) N: o feitiço fica indisponível por N turnos COMPLETOS
 *    do dono após o turno em que foi lançado (relança no turno N+1 seguinte).
 *    Assim cooldown 1 é diferente de cooldown 0 ("sem recarga"), como o
 *    data.js pressupõe ao distinguir os dois.
 *  - Durações: efeitos "por X turnos" decrementam no FIM do turno da vítima,
 *    valendo por X turnos completos dela. poison/regen ticam no INÍCIO do
 *    turno da vítima (X ticks para duração X).
 *  - AoE ofensiva (damage/poison/push/pull) NUNCA atinge o próprio conjurador
 *    (senão Dobre Fúnebre/Gole Amargo feririam o dono). Fogo amigo em ALIADOS
 *    existe — posicionamento importa.
 *  - Push: direção fixa = eixo dominante do vetor conjurador→alvo (empate =
 *    horizontal). Pull: passo a passo em direção ao conjurador, eixo dominante
 *    reavaliado a cada célula ("arrasta pela sala"). Colisão: 10 de dano por
 *    célula bloqueada (parede, buraco, unidade, borda), dano FIXO (sem
 *    power/resist), absorvível por escudo, só na unidade movida. Pull que para
 *    por ficar adjacente ao conjurador não conta colisão. pushImmune bloqueia
 *    push E pull (é âncora) e não sofre colisão. swap/teleport ignoram
 *    pushImmune (não são empurrão).
 *  - Lifesteal: cura = round(dano efetivo em HP / 2) ("metade do que colheu").
 *  - Poison guarda o power do conjurador no momento do cast; a resistência da
 *    vítima é lida a cada tick.
 *  - explodeOnDeath: dano = round(damage * (100 - resist)/100) em TODAS as
 *    unidades vivas (qualquer lado) em raio Manhattan; power não se aplica.
 *  - split: cópias nascem em células livres adjacentes (ortogonais primeiro,
 *    depois diagonais), herdam kind/side do original e entram na ordem de
 *    iniciativa logo após ele. Cópias de monstro comum CONTAM para a derrota
 *    do lado (matar a Carrapicho-Mãe exige matar as crias).
 *  - enrage: ao cruzar o limiar vira um efeito buff de power permanente
 *    (duration 9999) + eventos effectApplied/log; dispara uma única vez.
 *  - regenAura: cura aliados (EXCETO o próprio portador) no raio Manhattan,
 *    no início do turno do portador.
 *  - Buff de initiative altera o valor mas NÃO reordena a batalha em curso.
 *  - Se os dois lados caírem no mesmo encadeamento de mortes, a derrota do
 *    jogador prevalece (phase 'lost').
 *  - Invisibilidade restringe apenas a IA (castTargets não filtra — o
 *    contrato diz "IA não consegue alvejar"); quebra quando o invisível
 *    conjura um feitiço que contenha efeito 'damage'.
 *  - LoS: Bresenham simples entre centros; só células de PAREDE estritamente
 *    entre os extremos bloqueiam.
 *  - Feitiço com efeito 'swap' exige unidade viva na célula-alvo. Demais
 *    feitiços podem mirar célula de chão vazia (o efeito simplesmente não
 *    encontra alvo), exceto needsEmptyTile, que EXIGE célula vazia.
 * ==========================================================================*/

(function () {
  'use strict';

  var Engine = {};
  JOGO.Engine = Engine;

  Engine.events = [];      // fila; main.js drena — a engine só faz push
  Engine.state = null;

  function emit(ev) { Engine.events.push(ev); }
  function log(text) { emit({ type: 'log', text: text }); }

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
  function manhattan(x0, y0, x1, y1) {
    return Math.abs(x1 - x0) + Math.abs(y1 - y0);
  }

  Engine.unitAt = function (state, x, y) {
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.alive && u.x === x && u.y === y) return u;
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

  function recomputeShield(unit) {
    var s = 0;
    for (var i = 0; i < unit.effects.length; i++) {
      var e = unit.effects[i];
      if (e.type === 'shield') s += e.remaining;
    }
    unit.shield = s;
  }

  // --------------------------------------------------------------- criação
  // statsOverride (opcional): stats efetivos vindos de JOGO.Progress para
  // heróis (nível + equipamento). Com save zerado é idêntico a def.stats.
  function makeUnit(state, def, kind, side, x, y, statsOverride) {
    state._uidCounter++;
    var st = statsOverride || def.stats;
    var resists = {};
    for (var k in st.resists) resists[k] = st.resists[k];
    return {
      uid: 'u' + state._uidCounter,
      defId: def.id,
      kind: kind,
      side: side,
      name: def.name,
      x: x, y: y,
      hp: st.hp, hpMax: st.hp,
      pa: st.pa, paMax: st.pa,
      pm: st.pm, pmMax: st.pm,
      initiative: st.initiative,
      power: st.power,
      resists: resists,
      spells: def.spells.slice(),
      cooldowns: {},
      castsThisTurn: {},
      effects: [],
      shield: 0,
      alive: true,
      boss: !!def.boss,
      traits: def.traits ? def.traits.slice() : [],
      aiRole: def.ai || null,
      enraged: false,
      summonerUid: null,
      _birth: state._uidCounter
    };
  }

  function getDungeon(dungeonId) {
    var ds = JOGO.DATA.dungeons;
    for (var i = 0; i < ds.length; i++) if (ds[i].id === dungeonId) return ds[i];
    return null;
  }
  function getHeroDef(heroId) {
    var hs = JOGO.DATA.heroes;
    for (var i = 0; i < hs.length; i++) if (hs[i].id === heroId) return hs[i];
    return null;
  }

  Engine.createBattle = function (dungeonId, roomIndex, heroIds) {
    var dungeon = getDungeon(dungeonId);
    if (!dungeon) throw new Error('Engine.createBattle: dungeon desconhecido: ' + dungeonId);
    var room = dungeon.rooms[roomIndex];
    if (!room) throw new Error('Engine.createBattle: sala inválida: ' + roomIndex);
    if (!heroIds || !heroIds.length) throw new Error('Engine.createBattle: heroIds vazio');

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
        else if (ch === '~') row.push({ type: 'hole', deco: false });
        else if (ch === ',') row.push({ type: 'floor', deco: true });
        else row.push({ type: 'floor', deco: false });
        if (ch === 'P') heroSpawns.push({ x: x, y: y });
        else if (ch >= 'a' && ch <= 'z') monsterSpawns.push({ x: x, y: y, letter: ch });
      }
      tiles.push(row);
    }
    if (heroIds.length > heroSpawns.length) {
      throw new Error('Engine.createBattle: spawns de herói insuficientes na sala');
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
      _uidCounter: 0,
      _rng: hashStr(dungeonId + ':' + roomIndex + ':' + heroIds.join(','))
    };

    var i;
    for (i = 0; i < heroIds.length; i++) {
      var hd = getHeroDef(heroIds[i]);
      if (!hd) throw new Error('Engine.createBattle: herói desconhecido: ' + heroIds[i]);
      var hs = heroSpawns[i];
      // ADENDO v2: heróis usam stats efetivos (nível + equipamento) quando
      // JOGO.Progress existir; sem Progress (ou em erro), stats base.
      var effStats = null;
      if (JOGO.Progress && JOGO.Progress.effectiveStats) {
        try { effStats = JOGO.Progress.effectiveStats(hd.id); } catch (err) { effStats = null; }
      }
      state.units.push(makeUnit(state, hd, 'hero', 'player', hs.x, hs.y, effStats));
    }
    for (i = 0; i < monsterSpawns.length; i++) {
      var ms = monsterSpawns[i];
      var mid = room.monsters[ms.letter];
      if (!mid) throw new Error('Engine.createBattle: letra sem monstro: ' + ms.letter);
      var md = JOGO.DATA.monsters[mid];
      if (!md) throw new Error('Engine.createBattle: monstro desconhecido: ' + mid);
      state.units.push(makeUnit(state, md, 'monster', 'enemy', ms.x, ms.y));
    }

    // ordem por iniciativa (desc); desempate estável pela ordem de criação
    var sorted = state.units.slice().sort(function (a, b) {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      return a._birth - b._birth;
    });
    for (i = 0; i < sorted.length; i++) state.order.push(sorted[i].uid);
    state.activeIdx = 0;

    Engine.state = state;
    emit({ type: 'battleStart', state: state });
    log(dungeon.name + ' — ' + room.name);
    emit({ type: 'roundStart', round: 1 });
    startTurn(state, 0);
    return state;
  };

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

  Engine.reachable = function (state, uid) {
    var u = Engine.findUnit(state, uid);
    if (!u || !u.alive || u.pm <= 0) return [];
    var r = bfs(state, u.x, u.y, u.pm);
    var out = [];
    for (var key in r.dist) {
      var c = r.dist[key];
      if (c === 0) continue;
      var parts = key.split(',');
      out.push({ x: parseInt(parts[0], 10), y: parseInt(parts[1], 10), cost: c });
    }
    return out;
  };

  Engine.path = function (state, uid, x, y) {
    var u = Engine.findUnit(state, uid);
    if (!u || !u.alive) return null;
    if (x === u.x && y === u.y) return null;
    if (!isWalkable(state, x, y)) return null;
    var r = bfs(state, u.x, u.y, u.pm);
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

  Engine.move = function (state, uid, x, y) {
    if (state.phase !== 'playing') return false;
    var u = Engine.findUnit(state, uid);
    if (!u || !u.alive) return false;
    var path = Engine.path(state, uid, x, y);
    if (!path || path.length > u.pm) return false;
    u.pm -= path.length;
    u.x = x; u.y = y;
    emit({ type: 'move', uid: uid, path: path });
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
        var t = tileAt(state, x, y);
        if (t && t.type === 'wall') return false;
      }
      if (x === x1 && y === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
    return true;
  };

  // --------------------------------------------------------------- feitiços
  function spellDef(spellId) { return JOGO.DATA.spells[spellId] || null; }
  function spellHasEffect(spell, type) {
    for (var i = 0; i < spell.effects.length; i++) {
      if (spell.effects[i].type === type) return true;
    }
    return false;
  }

  function canCastNow(state, unit, spell) {
    if (!unit.alive) return false;
    if (unit.spells.indexOf(spell.id) < 0) return false;
    if (unit.pa < spell.paCost) return false;
    if ((unit.cooldowns[spell.id] || 0) > 0) return false;
    if (spell.castsPerTurn > 0 &&
        (unit.castsThisTurn[spell.id] || 0) >= spell.castsPerTurn) return false;
    return true;
  }

  function validTargetCell(state, unit, spell, tx, ty) {
    if (!inBounds(state, tx, ty)) return false;
    if (!isFloor(state, tx, ty)) return false;
    var d = manhattan(unit.x, unit.y, tx, ty);
    if (d < spell.range.min || d > spell.range.max) return false;
    if (spell.range.line && !(tx === unit.x || ty === unit.y)) return false;
    if (spell.range.los && !Engine.los(state, unit.x, unit.y, tx, ty)) return false;
    var occupant = Engine.unitAt(state, tx, ty);
    if (spell.needsEmptyTile && occupant) return false;
    if (spellHasEffect(spell, 'swap') && (!occupant || occupant === unit)) return false;
    return true;
  }

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

  Engine.aoeTiles = function (state, spellId, casterX, casterY, tx, ty) {
    var spell = spellDef(spellId);
    if (!spell) return [];
    var shape = spell.aoe.shape, size = spell.aoe.size;
    var out = [];
    function add(x, y) {
      if (inBounds(state, x, y) && tileAt(state, x, y).type !== 'wall') {
        out.push({ x: x, y: y });
      }
    }
    if (shape === 'single') {
      add(tx, ty);
    } else if (shape === 'cross') {
      add(tx, ty);
      for (var s = 1; s <= size; s++) {
        add(tx + s, ty); add(tx - s, ty); add(tx, ty + s); add(tx, ty - s);
      }
    } else if (shape === 'circle') {
      for (var dy = -size; dy <= size; dy++) {
        for (var dx = -size; dx <= size; dx++) {
          if (Math.abs(dx) + Math.abs(dy) <= size) add(tx + dx, ty + dy);
        }
      }
    } else if (shape === 'line') {
      // linha de comprimento `size` a partir do alvo, afastando-se do conjurador
      var ddx = tx - casterX, ddy = ty - casterY;
      var sx = 0, sy = 0;
      if (Math.abs(ddx) >= Math.abs(ddy)) sx = ddx === 0 ? 1 : (ddx > 0 ? 1 : -1);
      else sy = ddy > 0 ? 1 : -1;
      for (var i = 0; i < Math.max(1, size); i++) add(tx + i * sx, ty + i * sy);
    }
    return out;
  };

  // --------------------------------------------------------------- dano
  function rollDamageAmount(state, min, max, power, resist) {
    var roll = rollInt(state, min, max);
    var amt = Math.round(roll * (100 + power) / 100 * (100 - resist) / 100);
    return Math.max(0, amt);
  }

  // Aplica dano já calculado: escudo absorve antes do HP. Retorna a perda de HP.
  function dealDamage(state, target, amount, element, sourceUid) {
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
      // remove escudos esgotados
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
    checkEnrage(state, target);
    if (target.hp <= 0) processDeath(state, target);
    return hpLoss;
  }

  function applyHeal(state, target, amount) {
    if (!target.alive || amount <= 0) return 0;
    var healed = Math.min(amount, target.hpMax - target.hp);
    target.hp += healed;
    emit({ type: 'heal', uid: target.uid, amount: healed });
    return healed;
  }

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
    var def = JOGO.DATA.monsters[monsterId];
    if (!def) return null;
    var u = makeUnit(state, def, kind, side, x, y);
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

    var explode = getTrait(unit, 'explodeOnDeath');
    if (explode) {
      log(unit.name + ' explode!');
      var victims = [];
      for (var i = 0; i < state.units.length; i++) {
        var v = state.units[i];
        if (v.alive && manhattan(unit.x, unit.y, v.x, v.y) <= explode.radius) victims.push(v);
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

  function sideHasCore(state, side) {
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.alive && u.side === side && u.kind !== 'summon') return true;
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
          // tenta o outro eixo antes de declarar colisão
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
        dealDamage(state, target, collisionDmg, 'neutral', caster.uid);
      }
    }
  }

  // --------------------------------------------------------------- cast
  Engine.cast = function (state, uid, spellId, x, y) {
    if (state.phase !== 'playing') return false;
    var caster = Engine.findUnit(state, uid);
    var spell = spellDef(spellId);
    if (!caster || !spell) return false;
    if (!canCastNow(state, caster, spell)) return false;
    if (!validTargetCell(state, caster, spell, x, y)) return false;

    caster.pa -= spell.paCost;
    caster.castsThisTurn[spellId] = (caster.castsThisTurn[spellId] || 0) + 1;
    if (spell.cooldown > 0) caster.cooldowns[spellId] = spell.cooldown + 1; // decrementa no fim do turno do dono

    emit({ type: 'cast', uid: uid, spellId: spellId, x: x, y: y,
           fxKey: spell.fxKey, element: spell.element });
    log(caster.name + ' conjura ' + spell.name + '.');

    // invisível quebra ao conjurar dano
    if (spellHasEffect(spell, 'damage') && Engine.unitHasEffect(caster, 'invisible')) {
      for (var r = caster.effects.length - 1; r >= 0; r--) {
        if (caster.effects[r].type === 'invisible') caster.effects.splice(r, 1);
      }
      log(caster.name + ' sai das sombras!');
    }

    var tiles = Engine.aoeTiles(state, spellId, caster.x, caster.y, x, y);

    function unitsInTiles(includeCaster) {
      var list = [];
      for (var i = 0; i < tiles.length; i++) {
        var u = Engine.unitAt(state, tiles[i].x, tiles[i].y);
        if (u && u.alive && (includeCaster || u !== caster)) list.push(u);
      }
      return list;
    }

    for (var e = 0; e < spell.effects.length; e++) {
      if (state.phase !== 'playing') break;
      var eff = spell.effects[e];
      var targets, t, u, applied;

      switch (eff.type) {
        case 'damage':
          targets = unitsInTiles(false); // AoE ofensiva não atinge o conjurador
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            var amt = rollDamageAmount(state, eff.min, eff.max,
              Engine.effPower(caster), Engine.effResist(u, eff.element));
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
            if (eff.stat === 'pm') u.pm = Math.max(0, u.pm + eff.value);
            if (eff.stat === 'initiative') u.initiative += eff.value; // não reordena a batalha
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
          targets = unitsInTiles(false);
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            applied = { type: 'poison', element: eff.element, min: eff.min, max: eff.max,
                        duration: eff.duration, sourceUid: caster.uid,
                        sourcePower: Engine.effPower(caster) };
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
          targets = unitsInTiles(false);
          targets.sort(function (a, b) { // mais distantes primeiro (liberam células)
            return manhattan(caster.x, caster.y, b.x, b.y) - manhattan(caster.x, caster.y, a.x, a.y);
          });
          for (t = 0; t < targets.length; t++) forcedMove(state, caster, targets[t], eff.tiles, 'push');
          break;

        case 'pull':
          targets = unitsInTiles(false);
          targets.sort(function (a, b) { // mais próximos primeiro (assentam primeiro)
            return manhattan(caster.x, caster.y, a.x, a.y) - manhattan(caster.x, caster.y, b.x, b.y);
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
            var cx = caster.x, cy = caster.y;
            caster.x = u.x; caster.y = u.y;
            u.x = cx; u.y = cy;
            emit({ type: 'teleport', uid: caster.uid, fromX: cx, fromY: cy, toX: caster.x, toY: caster.y });
            emit({ type: 'teleport', uid: u.uid, fromX: caster.x, fromY: caster.y, toX: cx, toY: cy });
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
      }
    }
    return true;
  };

  // --------------------------------------------------------------- turnos
  function startTurn(state, guard) {
    if (state.phase !== 'playing') return;
    if (guard > state.order.length + 2) return;
    var u = Engine.activeUnit(state);
    if (!u || !u.alive) { advanceTurn(state, guard + 1); return; }

    u.pa = Math.max(0, u.paMax + sumBuffs(u, 'pa'));
    u.pm = Math.max(0, u.pmMax + sumBuffs(u, 'pm'));
    u.castsThisTurn = {};
    emit({ type: 'turnStart', uid: u.uid });

    // aura de regeneração: cura aliados (exceto o portador) no início do turno dele
    var aura = getTrait(u, 'regenAura');
    if (aura) {
      for (var i = 0; i < state.units.length; i++) {
        var ally = state.units[i];
        if (ally.alive && ally !== u && ally.side === u.side &&
            manhattan(u.x, u.y, ally.x, ally.y) <= aura.radius && ally.hp < ally.hpMax) {
          applyHeal(state, ally, aura.value);
        }
      }
    }

    // poison/regen ticam no início do turno da vítima
    var effs = u.effects.slice();
    for (var e = 0; e < effs.length; e++) {
      if (!u.alive) break;
      var eff = effs[e];
      if (u.effects.indexOf(eff) < 0) continue;
      if (eff.type === 'poison') {
        var amt = rollDamageAmount(state, eff.min, eff.max,
          eff.sourcePower || 0, Engine.effResist(u, eff.element));
        if (amt > 0) log(u.name + ' sofre ' + amt + ' de veneno.');
        dealDamage(state, u, amt, eff.element, eff.sourceUid);
      } else if (eff.type === 'regen') {
        applyHeal(state, u, rollInt(state, eff.min, eff.max));
      }
    }

    if (!u.alive) advanceTurn(state, guard + 1);
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
      }
      steps++;
      if (steps > max) return; // ninguém vivo (o fim de batalha já deveria ter disparado)
      var u = Engine.findUnit(state, state.order[state.activeIdx]);
      if (u && u.alive) break;
    } while (true);
    startTurn(state, guard);
  }

  Engine.endTurn = function (state) {
    if (state.phase !== 'playing') return;
    var u = Engine.activeUnit(state);
    if (u) {
      // durações decrementam no fim do turno do dono do efeito (a vítima)
      for (var i = u.effects.length - 1; i >= 0; i--) {
        var eff = u.effects[i];
        eff.duration--;
        if (eff.duration <= 0) {
          u.effects.splice(i, 1);
          log(u.name + ': efeito ' + eff.type + ' expira.');
        }
      }
      recomputeShield(u);
      // recargas do dono decrementam no fim do turno dele
      for (var sid in u.cooldowns) {
        if (u.cooldowns[sid] > 0) u.cooldowns[sid]--;
      }
    }
    advanceTurn(state, 0);
  };
})();
