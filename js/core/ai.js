var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* ============================================================================
 * SOTERRA — js/core/ai.js  (dono: Agente de Lógica)
 * AI.planTurn(state, uid) -> [ {action:'move',x,y} | {action:'cast',spellId,x,y} | {action:'end'} ]
 *
 * PURA: não muta o state e não executa nada — o Game executa via Engine.
 * Regras:
 *  - Nunca alveja unidades com efeito 'invisible' (nem as considera no valor
 *    de área — a IA "não as vê").
 *  - Se algum inimigo vivo e visível tem 'taunt', feitiços hostis
 *    (damage/poison/push/pull/debuff) só podem ter como CÉLULA-ALVO a célula
 *    de um provocador (respingos de AoE em terceiros são permitidos).
 *  - Papéis: melee aproxima do alvo mais acessível/fraco e bate; ranged
 *    mantém a distância ideal (alcance máx. do melhor feitiço) e recua se
 *    colado; support cura/bufa o aliado mais ferido e ataca se nada a fazer;
 *    boss avalia tudo (dano esperado, área, invocação, puxões) e usa o melhor
 *    feitiço na melhor posição.
 *  - O plano nunca excede PA/PM e SEMPRE termina com {action:'end'}.
 *  - teleport/swap não são planejados (valor 0) — decisão de design: nenhum
 *    monstro os possui; heróis em auto-play jogam sem eles.
 * ==========================================================================*/

(function () {
  'use strict';

  var AI = {};
  JOGO.AI = AI;

  function E() { return JOGO.Engine; }
  function DATA() { return JOGO.DATA; }

  function manhattan(x0, y0, x1, y1) {
    return Math.abs(x1 - x0) + Math.abs(y1 - y0);
  }
  function isInvisible(u) { return E().unitHasEffect(u, 'invisible'); }
  function isTaunter(u) { return E().unitHasEffect(u, 'taunt'); }

  var HOSTILE = { damage: 1, poison: 1, push: 1, pull: 1 };
  function spellIsHostile(spell) {
    for (var i = 0; i < spell.effects.length; i++) {
      var e = spell.effects[i];
      if (HOSTILE[e.type]) return true;
      if (e.type === 'buff' && e.value < 0) return true;
      if (e.type === 'resist' && e.value < 0) return true;
    }
    return false;
  }

  // campo de distâncias BFS a partir de (tx,ty), atravessando chão
  // (unidades contam como passáveis — evita impasses de pathing)
  function distField(state, tx, ty) {
    var field = {};
    var queue = [{ x: tx, y: ty }];
    field[tx + ',' + ty] = 0;
    var head = 0;
    var DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    while (head < queue.length) {
      var c = queue[head++];
      var d = field[c.x + ',' + c.y];
      for (var i = 0; i < 4; i++) {
        var nx = c.x + DIRS[i][0], ny = c.y + DIRS[i][1];
        var key = nx + ',' + ny;
        if (field[key] !== undefined) continue;
        if (nx < 0 || ny < 0 || nx >= state.grid.w || ny >= state.grid.h) continue;
        if (state.grid.tiles[ny][nx].type !== 'floor') continue;
        field[key] = d + 1;
        queue.push({ x: nx, y: ny });
      }
    }
    return field;
  }

  function inferRole(unit) {
    if (unit.aiRole) return unit.aiRole;
    // heróis: heurística pelo kit
    var hasHeal = false, bestDmg = 0, bestDmgRange = 1;
    for (var i = 0; i < unit.spells.length; i++) {
      var sp = DATA().spells[unit.spells[i]];
      if (!sp) continue;
      for (var j = 0; j < sp.effects.length; j++) {
        var e = sp.effects[j];
        if (e.type === 'heal') hasHeal = true;
        if (e.type === 'damage') {
          var avg = (e.min + e.max) / 2;
          if (avg > bestDmg) { bestDmg = avg; bestDmgRange = sp.range.max; }
        }
      }
    }
    if (hasHeal) return 'support';
    return bestDmgRange <= 2 ? 'melee' : 'ranged';
  }

  function isFloor(state, x, y) {
    return x >= 0 && y >= 0 && x < state.grid.w && y < state.grid.h &&
      state.grid.tiles[y][x].type === 'floor';
  }

  // valida se `unit`, hipoteticamente em (cx,cy), pode conjurar spell em (tx,ty)
  function validFrom(state, unit, spell, cx, cy, tx, ty, ctx) {
    if (!isFloor(state, tx, ty)) return false;
    var d = manhattan(cx, cy, tx, ty);
    if (d < spell.range.min || d > spell.range.max) return false;
    if (spell.range.line && !(tx === cx || ty === cy)) return false;
    if (spell.range.los && !E().los(state, cx, cy, tx, ty)) return false;
    var occ = ctx.uAt(tx, ty);
    if (occ === unit) occ = null; // a própria unidade estará em (cx,cy)
    var occupied = !!occ || (tx === cx && ty === cy);
    if (spell.needsEmptyTile && occupied) return false;
    if (ctx.spellHasSwap(spell) && !occ) return false;
    return true;
  }

  function expectDamage(unit, victim, eff) {
    var avg = (eff.min + eff.max) / 2;
    var power = E().effPower(unit);
    var resist = E().effResist(victim, eff.element);
    return Math.max(0, avg * (100 + power) / 100 * (100 - resist) / 100);
  }

  // estimativa do dano de colisão de um empurrão (direção fixa, eixo dominante)
  function shoveCollision(state, cx, cy, victim, tiles, ctx) {
    var ddx = victim.x - cx, ddy = victim.y - cy;
    if (ddx === 0 && ddy === 0) return 0;
    var sx = 0, sy = 0;
    if (Math.abs(ddx) >= Math.abs(ddy)) sx = ddx >= 0 ? 1 : -1;
    else sy = ddy > 0 ? 1 : -1;
    var x = victim.x, y = victim.y, moved = 0;
    for (var i = 0; i < tiles; i++) {
      var nx = x + sx, ny = y + sy;
      if (!isFloor(state, nx, ny) || ctx.uAt(nx, ny)) break;
      x = nx; y = ny; moved++;
    }
    return 10 * (tiles - moved);
  }

  // valor de conjurar spell em (tx,ty) estando em (cx,cy). <= 0 = "não vale".
  function castValue(state, unit, spell, cx, cy, tx, ty, ctx) {
    var occ = ctx.uAt(tx, ty);

    // taunt: feitiço hostil só pode MIRAR a célula de um provocador
    if (ctx.taunters.length > 0 && spellIsHostile(spell)) {
      if (!occ || !ctx.tauntersSet[occ.uid]) return -1;
    }
    // nunca mirar diretamente um invisível
    if (occ && occ.side !== unit.side && isInvisible(occ)) return -1;

    var tiles = E().aoeTiles(state, spell.id, cx, cy, tx, ty);
    var unitsHit = [];
    for (var i = 0; i < tiles.length; i++) {
      var u = ctx.uAt(tiles[i].x, tiles[i].y);
      if (u && u.alive) unitsHit.push(u);
    }

    var value = 0;
    for (var e = 0; e < spell.effects.length; e++) {
      var eff = spell.effects[e];
      var t, u2, dmg;
      switch (eff.type) {
        case 'damage':
          for (t = 0; t < unitsHit.length; t++) {
            u2 = unitsHit[t];
            if (u2 === unit) continue; // engine exclui o conjurador
            dmg = expectDamage(unit, u2, eff);
            if (u2.side !== unit.side) {
              if (isInvisible(u2)) continue;
              value += dmg;
              if (dmg >= u2.hp + u2.shield) value += 40; // abate
              value += (1 - u2.hp / u2.hpMax) * 8;      // prefere feridos
              if (eff.lifesteal) value += Math.min(dmg / 2, unit.hpMax - unit.hp) * 0.6;
            } else {
              value -= dmg * 1.6; // fogo amigo
            }
          }
          break;
        case 'poison':
          for (t = 0; t < unitsHit.length; t++) {
            u2 = unitsHit[t];
            if (u2 === unit) continue;
            dmg = expectDamage(unit, u2, eff) * eff.duration;
            if (u2.side !== unit.side) { if (!isInvisible(u2)) value += dmg * 0.8; }
            else value -= dmg * 1.2;
          }
          break;
        case 'heal':
          for (t = 0; t < unitsHit.length; t++) {
            u2 = unitsHit[t];
            var healed = Math.min((eff.min + eff.max) / 2, u2.hpMax - u2.hp);
            if (u2.side === unit.side) value += healed * (ctx.role === 'support' ? 1.3 : 0.9);
            else value -= healed;
          }
          break;
        case 'regen':
          for (t = 0; t < unitsHit.length; t++) {
            u2 = unitsHit[t];
            if (u2.side !== unit.side) continue;
            value += Math.min(((eff.min + eff.max) / 2) * eff.duration, u2.hpMax - u2.hp) * 0.6;
          }
          break;
        case 'shield':
          for (t = 0; t < unitsHit.length; t++) {
            u2 = unitsHit[t];
            if (u2.side !== unit.side) continue;
            var engaged = ctx.nearestEnemyDistTo(u2.x, u2.y) <= 3;
            value += eff.value * ((engaged || u2.hp < u2.hpMax) ? 0.6 : 0.05);
          }
          break;
        case 'buff':
          for (t = 0; t < unitsHit.length; t++) {
            u2 = unitsHit[t];
            if (eff.value >= 0) {
              if (u2.side !== unit.side) { value -= 10; continue; }
              value += (eff.stat === 'power') ? 10 : 5;
            } else {
              if (u2.side === unit.side) { value -= 10; continue; }
              if (isInvisible(u2)) continue;
              value += 5 + Math.abs(eff.value) * 2;
            }
          }
          break;
        case 'resist':
          for (t = 0; t < unitsHit.length; t++) {
            u2 = unitsHit[t];
            if (eff.value >= 0) value += (u2.side === unit.side) ? 4 : -4;
            else value += (u2.side !== unit.side && !isInvisible(u2)) ? 5 : -4;
          }
          break;
        case 'push':
          for (t = 0; t < unitsHit.length; t++) {
            u2 = unitsHit[t];
            if (u2 === unit || u2.side === unit.side || isInvisible(u2)) continue;
            if (E().unitHasTrait(u2, 'pushImmune')) continue;
            value += 3 + shoveCollision(state, cx, cy, u2, eff.tiles, ctx);
          }
          break;
        case 'pull':
          for (t = 0; t < unitsHit.length; t++) {
            u2 = unitsHit[t];
            if (u2 === unit || u2.side === unit.side || isInvisible(u2)) continue;
            if (E().unitHasTrait(u2, 'pushImmune')) continue;
            var gain = Math.min(eff.tiles, Math.max(0, manhattan(cx, cy, u2.x, u2.y) - 1));
            value += 2 + gain * ((ctx.role === 'boss' || ctx.role === 'melee') ? 2.5 : 1);
          }
          break;
        case 'summon':
          value += (ctx.role === 'boss' ? 28 : 22) - 0.4 * ctx.nearestEnemyDistTo(tx, ty);
          break;
        case 'taunt':
          if (!isTaunter(unit)) {
            var near = 0;
            for (t = 0; t < ctx.enemies.length; t++) {
              if (manhattan(cx, cy, ctx.enemies[t].x, ctx.enemies[t].y) <= 4) near++;
            }
            value += 6 + near * 4;
          }
          break;
        case 'invisible':
          if (!isInvisible(unit)) value += (unit.hp / unit.hpMax < 0.6) ? 8 : 1;
          break;
        // teleport/swap: valor 0 — a IA não os planeja
      }
    }
    return value;
  }

  // células-alvo candidatas para um feitiço a partir de (cx,cy)
  function targetCandidates(state, unit, spell, cx, cy, ctx) {
    var out = [], seen = {}, i, u;
    function add(x, y) {
      var k = x + ',' + y;
      if (!seen[k]) { seen[k] = true; out.push({ x: x, y: y }); }
    }
    if (spell.needsEmptyTile) {
      var r = spell.range.max;
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) + Math.abs(dy) > r) continue;
          add(cx + dx, cy + dy);
        }
      }
      return out;
    }
    for (i = 0; i < ctx.living.length; i++) {
      u = ctx.living[i];
      add(u.x, u.y);
      if (spell.aoe.shape !== 'single' && u.side !== unit.side) {
        add(u.x + 1, u.y); add(u.x - 1, u.y); add(u.x, u.y + 1); add(u.x, u.y - 1);
      }
    }
    if (spell.range.min === 0) add(cx, cy); // auto-alvo
    return out;
  }

  function bestCastFrom(state, unit, cx, cy, paLeft, counts, ctx, usedCd) {
    var best = null;
    for (var s = 0; s < unit.spells.length; s++) {
      var spell = DATA().spells[unit.spells[s]];
      if (!spell) continue;
      if (spell.paCost > paLeft) continue;
      if ((unit.cooldowns[spell.id] || 0) > 0) continue;
      if (usedCd && usedCd[spell.id]) continue;
      if (spell.castsPerTurn > 0 && (counts[spell.id] || 0) >= spell.castsPerTurn) continue;
      var cands = targetCandidates(state, unit, spell, cx, cy, ctx);
      for (var c = 0; c < cands.length; c++) {
        var tx = cands[c].x, ty = cands[c].y;
        if (!validFrom(state, unit, spell, cx, cy, tx, ty, ctx)) continue;
        var v = castValue(state, unit, spell, cx, cy, tx, ty, ctx);
        if (v > 0.5 && (!best || v > best.value)) {
          best = { value: v, spellId: spell.id, x: tx, y: ty, paCost: spell.paCost };
        }
      }
    }
    return best;
  }

  AI.planTurn = function (state, uid) {
    var unit = E().findUnit(state, uid);
    if (!unit || !unit.alive || state.phase !== 'playing') return [{ action: 'end' }];

    var role = inferRole(unit);
    var enemies = [], allies = [], taunters = [], tauntersSet = {}, living = [];
    var unitMap = {};
    var i, u;
    for (i = 0; i < state.units.length; i++) {
      u = state.units[i];
      if (!u.alive) continue;
      living.push(u);
      unitMap[u.x + ',' + u.y] = u;
      if (u === unit) continue;
      if (u.side === unit.side) allies.push(u);
      else if (!isInvisible(u)) {
        enemies.push(u);
        if (isTaunter(u)) { taunters.push(u); tauntersSet[u.uid] = true; }
      }
    }
    if (enemies.length === 0) return [{ action: 'end' }];

    var swapCache = {};
    var ctx = {
      role: role,
      enemies: enemies,
      allies: allies,
      taunters: taunters,
      tauntersSet: tauntersSet,
      living: living,
      uAt: function (x, y) { return unitMap[x + ',' + y] || null; },
      spellHasSwap: function (spell) {
        if (swapCache[spell.id] === undefined) {
          swapCache[spell.id] = false;
          for (var k = 0; k < spell.effects.length; k++) {
            if (spell.effects[k].type === 'swap') swapCache[spell.id] = true;
          }
        }
        return swapCache[spell.id];
      },
      nearestEnemyDistTo: function (x, y) {
        var m = 999;
        for (var k = 0; k < enemies.length; k++) {
          var d = manhattan(x, y, enemies[k].x, enemies[k].y);
          if (d < m) m = d;
        }
        return m;
      }
    };

    // alvo primário: provocador obrigatório > mais perto/mais ferido
    var pool = taunters.length ? taunters : enemies;
    var primary = pool[0], bestKey = Infinity;
    for (i = 0; i < pool.length; i++) {
      u = pool[i];
      var key = manhattan(unit.x, unit.y, u.x, u.y) * 2 + (u.hp / u.hpMax) * 10;
      if (key < bestKey) { bestKey = key; primary = u; }
    }
    var field = distField(state, primary.x, primary.y);

    // aliado mais ferido (âncora do support)
    var wounded = null, woundedPct = 1;
    for (i = 0; i < allies.length; i++) {
      var pct = allies[i].hp / allies[i].hpMax;
      if (pct < woundedPct) { woundedPct = pct; wounded = allies[i]; }
    }

    // alcance ideal do ranged = maior alcance entre feitiços de dano
    var idealRange = 1;
    for (i = 0; i < unit.spells.length; i++) {
      var sp = DATA().spells[unit.spells[i]];
      if (!sp) continue;
      for (var j = 0; j < sp.effects.length; j++) {
        if (sp.effects[j].type === 'damage' && sp.range.max > idealRange) idealRange = sp.range.max;
      }
    }

    // candidatos de posição: célula atual + alcançáveis com o PM atual
    var candidates = [{ x: unit.x, y: unit.y, cost: 0 }].concat(E().reachable(state, uid));
    var bestCell = candidates[0], bestScore = -Infinity, bestFirstCast = null;

    for (i = 0; i < candidates.length; i++) {
      var cell = candidates[i];
      var cast = bestCastFrom(state, unit, cell.x, cell.y, unit.pa, unit.castsThisTurn, ctx, null);
      var score = cast ? cast.value : 0;
      var dNear = ctx.nearestEnemyDistTo(cell.x, cell.y);
      var fd = field[cell.x + ',' + cell.y];
      if (fd === undefined) fd = 50;

      if (role === 'melee') {
        score += -1.2 * fd;
      } else if (role === 'ranged') {
        score += -1.5 * Math.abs(dNear - idealRange);
        if (dNear <= 1) score -= 6;
      } else if (role === 'support') {
        var anchor = wounded || allies[0];
        if (anchor) score += -0.8 * manhattan(cell.x, cell.y, anchor.x, anchor.y);
        else score += -0.4 * fd;
        if (dNear <= 1) score -= 4;
      } else { // boss
        score += -0.8 * fd;
      }
      score += -0.05 * cell.cost;
      if (cell.x === unit.x && cell.y === unit.y) score += 0.1;

      if (score > bestScore) { bestScore = score; bestCell = cell; bestFirstCast = cast; }
    }

    var plan = [];
    if (bestCell.x !== unit.x || bestCell.y !== unit.y) {
      plan.push({ action: 'move', x: bestCell.x, y: bestCell.y });
    }

    // conjurações gulosas a partir da célula escolhida (orçamento local de PA)
    var paLeft = unit.pa;
    var counts = {};
    var usedCd = {}; // feitiços com recarga já planejados neste turno
    for (var k in unit.castsThisTurn) counts[k] = unit.castsThisTurn[k];
    for (var it = 0; it < 8; it++) {
      var pick = (it === 0 && bestFirstCast) ? bestFirstCast
        : bestCastFrom(state, unit, bestCell.x, bestCell.y, paLeft, counts, ctx, usedCd);
      if (!pick || pick.paCost > paLeft) break;
      plan.push({ action: 'cast', spellId: pick.spellId, x: pick.x, y: pick.y });
      paLeft -= pick.paCost;
      counts[pick.spellId] = (counts[pick.spellId] || 0) + 1;
      var sd = DATA().spells[pick.spellId];
      if (sd && sd.cooldown > 0) usedCd[pick.spellId] = true;
    }

    plan.push({ action: 'end' });
    return plan;
  };
})();
