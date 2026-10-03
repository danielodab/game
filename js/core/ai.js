var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* ============================================================================
 * SOTERRA 2.0 — js/core/ai.js  (dono: Lógica Combate)
 * AI.planTurn(state, uid) -> [ {action:'move',x,y} | {action:'cast',spellId,x,y} | {action:'end'} ]
 *
 * PURA: não muta o state e não executa nada — o Game executa via Engine.
 *
 * Regras herdadas da v1 (mantidas):
 *  - Nunca alveja unidades com efeito 'invisible' (nem as considera na área).
 *  - Havendo provocador vivo e visível, feitiços hostis só podem ter como
 *    CÉLULA-ALVO a célula de um provocador (respingo de AoE é permitido).
 *  - Papéis: melee aproxima e bate; ranged mantém a distância ideal e recua se
 *    colado; support cura/bufa o aliado mais ferido; boss avalia tudo.
 *  - O plano nunca excede PA/PP e SEMPRE termina com {action:'end'}.
 *  - swap não é planejado (valor 0). O teleporte vale como a investida
 *    (03/10): aproximar, para quem bate de perto.
 *
 * Novidades v2 (decisões de design documentadas):
 *  - Todos os feitiços são resolvidos por `Engine.spell(id)` (classes, monstros,
 *    pets, itens e fusões).
 *  - CLIMA: alvo que o clima prejudica vale um pouco mais (vai perder 5 PV por
 *    turno de qualquer forma); `weatherShift` é avaliado pelo saldo de elementos
 *    favorecidos/prejudicados dos dois lados.
 *  - MARCAS: aplicar marca vale dano futuro; `detonateMarks` é avaliado pelo
 *    dano REAL (pilhas × mult), então a IA só detona quando compensa.
 *  - ARMADILHAS (22/09, o dono: "jamais podem ficar visíveis para os inimigos
 *    ou adversários, assim eles desviam e nunca caem"): a IA só desvia da
 *    armadilha do outro lado que o lado DELA enxerga (Engine.armadilhaVisivel).
 *    O monstro não vê a do Xamã (nem nenhuma do lado do jogador) e cai nela; no
 *    PvP ninguém vê a do outro. Fora do PvP a armadilha de monstro segue à
 *    vista do jogador, então pet e invocação dele ainda desviam dela (−60).
 *  - O CHÃO DO POÇO (02/10): o peso de cada casa vem de Poco.regras.pesoCasas
 *    (js/core/poco.js) — a casa avisada para o começo da próxima rodada pesa
 *    −80, mais que armadilha, porque a unidade VAI estar lá quando o golpe vier.
 *  - EVENTOS DE TERRENO: bônus por terminar em evento bom (buff/fountain) e
 *    penalidade por evento ruim (drain); mystery vale um pouco (aposta).
 *  - ESQUIVA: recuar de uma célula fixada é penalizado pelo risco real
 *    (1 − chance de esquiva), usando `Engine.dodgeChance`.
 *  - A IA NÃO declara fusões: a Fusão é uma decisão do jogador (o auto-play
 *    IA×IA continua determinístico e comparável com a v1).
 *  - OS ESPINHOS DO MURO (03/10, engine.js "O MURO QUE FERE QUEM ENCOSTA"): quem
 *    anda pesa terminar a vez encostado no muro de espinhos do outro lado; quem
 *    ergue pesa quem vai ficar preso ao lado da pedra e o APERTO (a pedra atrás
 *    do inimigo, antes do empurrão que o joga nela) — valorDoMuro.
 *  - CORPO GRANDE (02/10, o Eco Primordial 2×2): o mapa de unidades marca as
 *    QUATRO casas dele (mirar qualquer uma vale), a área que cobre várias
 *    conta ele uma vez, as distâncias medem da casa mais perto (Engine.distA,
 *    Engine.distEntre) e, quando ELE conjura, o golpe sai da casa que o motor
 *    escolheria (Engine.origemPara) — a IA nunca planeja o que o motor recusa.
 *  - GANHO ELEMENTAL (v2.2): o valor de um feitiço de dano usa o MESMO
 *    `Engine.elementalBonus` da engine, então a IA prefere naturalmente os
 *    feitiços do próprio caminho elemental — sem regra ad hoc.
 *  - FÚRIA DA SALA (v2.3): dano usa `Engine.furyPower` e cura é escalada por
 *    `Engine.healScale`. Assim, quando a sala esquenta, a IA para sozinha de
 *    gastar turno numa cura que já não cura — de novo, sem regra ad hoc.
 * ==========================================================================*/

(function () {
  'use strict';

  var AI = {};
  JOGO.AI = AI;

  function E() { return JOGO.Engine; }
  function DATA() { return JOGO.DATA || {}; }
  function spellOf(id) { return E().spell(id); }

  function manhattan(x0, y0, x1, y1) {
    return Math.abs(x1 - x0) + Math.abs(y1 - y0);
  }
  function isInvisible(u) { return E().unitHasEffect(u, 'invisible'); }
  function isTaunter(u) { return E().unitHasEffect(u, 'taunt'); }

  var HOSTILE = { damage: 1, poison: 1, push: 1, pull: 1, root: 1, mark: 1,
                  detonateMarks: 1, dispelShield: 1, chain: 1 };
  function spellIsHostile(spell) {
    var effs = spell.effects || [];
    for (var i = 0; i < effs.length; i++) {
      var e = effs[i];
      if (HOSTILE[e.type]) return true;
      if (e.type === 'buff' && e.value < 0) return true;
      if (e.type === 'resist' && e.value < 0) return true;
    }
    return false;
  }
  // 19/09: o mesmo padrão do motor (Engine.RANGE_PADRAO, los:true) — a IA não pode
  // enxergar por um feitiço sem `range` o que o Engine.cast depois recusa
  function sRange(sp) { return sp.range || (JOGO.Engine && JOGO.Engine.RANGE_PADRAO) || { min: 0, max: 1, line: false, los: true }; }
  function sAoe(sp) { return sp.aoe || { shape: 'single', size: 0 }; }

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
    var hasHeal = false, bestDmg = 0, bestDmgRange = 1;
    for (var i = 0; i < unit.spells.length; i++) {
      var sp = spellOf(unit.spells[i]);
      if (!sp) continue;
      var effs = sp.effects || [];
      for (var j = 0; j < effs.length; j++) {
        var e = effs[j];
        if (e.type === 'heal') hasHeal = true;
        if (e.type === 'damage' || e.type === 'chain') {
          var avg = (e.min + e.max) / 2;
          if (avg > bestDmg) { bestDmg = avg; bestDmgRange = sRange(sp).max; }
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

  /* 02/10: de onde a unidade conjura. O corpo grande (que não anda) conjura da
   * casa que o motor escolhe; os outros, da casa hipotética de sempre. */
  function origem(state, unit, spell, cx, cy, tx, ty) {
    var En = E();
    if (!En.porteDe || En.porteDe(unit) === 1 || cx !== unit.x || cy !== unit.y) return { x: cx, y: cy };
    return En.origemPara(state, unit.uid, spell.id, tx, ty) || { x: cx, y: cy };
  }
  function distAte(u, x, y) { return E().distA ? E().distA(u, x, y) : manhattan(u.x, u.y, x, y); }

  // valida se `unit`, hipoteticamente em (cx,cy), pode conjurar spell em (tx,ty)
  function validFrom(state, unit, spell, cx, cy, tx, ty, ctx) {
    if (!isFloor(state, tx, ty)) return false;
    var rg = sRange(spell);
    var o0 = origem(state, unit, spell, cx, cy, tx, ty);
    cx = o0.x; cy = o0.y;
    var d = manhattan(cx, cy, tx, ty);
    if (d < (rg.min || 0) || d > (rg.max != null ? rg.max : 1)) return false;
    if (rg.line && !(tx === cx || ty === cy)) return false;
    if (rg.los && !E().los(state, cx, cy, tx, ty)) return false;
    var occ = ctx.uAt(tx, ty);
    if (occ === unit) occ = null; // a própria unidade estará em (cx,cy)
    var self = (tx === cx && ty === cy);
    var occupied = !!occ || self;
    if (spell.needsEmptyTile && occupied) return false;
    if (ctx.spellHasSwap(spell) && !occ) return false;
    // v2: targetSide
    var ts = spell.targetSide;
    /* FEITIÇO DE ÁREA MIRA O CHÃO — a mesma exceção do motor (validTargetCell).
     * 19/09: a IA exigia um inimigo NA casa, então os candidatos vizinhos que
     * targetCandidates acrescenta para as áreas eram todos reprovados aqui, e
     * o monstro nunca largava a explosão entre dois heróis. A valoração
     * (castValue) já soma os atingidos pela área; só faltava deixar passar. */
    var ar = spell.aoe;
    var temArea = !!(ar && ar.shape && ar.shape !== 'single' && (ar.size || 0) > 0);
    if (temArea && (ts === 'enemy' || ts === 'ally')) return true;
    if (ts === 'enemy' && (!occ || occ.side === unit.side)) return false;
    if (ts === 'ally' && !((occ && occ.side === unit.side) || self)) return false;
    if (ts === 'self' && !self) return false;
    return true;
  }

  // `extraPower` é o que a engine soma ao poder base nesta conjuração: o
  // `elemPower` quando o feitiço é do elemento do conjurador (v2.2) e a fúria da
  // sala (v2.3). Sem isso a IA subestimaria os feitiços do próprio caminho
  // elemental e não perceberia que a sala enfurecida a deixou letal.
  function expectDamage(unit, victim, eff, extraPower) {
    var avg = (eff.min + eff.max) / 2;
    var power = E().effPower(unit) + (extraPower || 0);
    var resist = E().effResist(victim, eff.element);
    var marks = E().markMultiplier ? E().markMultiplier(victim) : 1;
    return Math.max(0, avg * (100 + power) / 100 * (100 - resist) / 100 * marks);
  }

  // estimativa do dano de colisão de um empurrão (direção fixa, eixo dominante)
  // 03/10: bater no muro de espinhos do lado de quem empurra soma o dano do muro
  // (engine.js, "O MURO QUE FERE QUEM ENCOSTA") — é assim que o Minotauro aperta
  function shoveCollision(state, cx, cy, victim, tiles, ctx) {
    var ddx = victim.x - cx, ddy = victim.y - cy;
    if (ddx === 0 && ddy === 0) return 0;
    var sx = 0, sy = 0;
    if (Math.abs(ddx) >= Math.abs(ddy)) sx = ddx >= 0 ? 1 : -1;
    else sy = ddy > 0 ? 1 : -1;
    var x = victim.x, y = victim.y, moved = 0, bateu = null;
    for (var i = 0; i < tiles; i++) {
      var nx = x + sx, ny = y + sy;
      if (!isFloor(state, nx, ny) || ctx.uAt(nx, ny)) { bateu = { x: nx, y: ny }; break; }
      x = nx; y = ny; moved++;
    }
    var dano = 10 * (tiles - moved);
    if (bateu && E().muroFereAoBater) dano += E().muroFereAoBater(state, victim, bateu.x, bateu.y);
    return dano;
  }

  // v2: quanto o clima castiga/beneficia um elemento
  function weatherBiasFor(ctx, unit) {
    var w = ctx.weather;
    if (!w) return 0;
    var els = E().unitElements(unit);
    var v = 0;
    if (w.favors && els.indexOf(w.favors) >= 0) v += 1;
    if (w.harms && els.indexOf(w.harms) >= 0) v -= 1;
    return v;
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

    var o0 = origem(state, unit, spell, cx, cy, tx, ty);    // 02/10: o corpo grande conjura daqui
    cx = o0.x; cy = o0.y;
    var tiles = E().aoeTiles(state, spell.id, cx, cy, tx, ty);
    var unitsHit = [];
    for (var i = 0; i < tiles.length; i++) {
      var u = ctx.uAt(tiles[i].x, tiles[i].y);
      // 02/10: o corpo 2×2 conta uma vez, como no motor (unitsInTiles)
      if (u && u.alive && unitsHit.indexOf(u) < 0) unitsHit.push(u);
    }

    /* 03/10: O FEITIÇO MISTO (engine.js, feiticoMisto). Num feitiço que tem
     * efeito a favor E efeito hostil, o motor manda o hostil só no outro lado
     * e o a favor só no lado de quem lança — e em quem lança sempre. A IA
     * mede com a mesma régua: sem fogo amigo nesses, e sem descontar a cura
     * "dada ao inimigo" que o motor já não dá. */
    var misto = !!(E().feiticoMisto && E().feiticoMisto(spell));
    var hitHostil = unitsHit, hitFavor = unitsHit;
    if (misto) {
      hitHostil = unitsHit.filter(function (w) { return w.side !== unit.side; });
      hitFavor = unitsHit.filter(function (w) { return w.side === unit.side; });
      if (hitFavor.indexOf(unit) < 0) hitFavor.push(unit);
    }

    var effs = spell.effects || [];
    var value = 0;
    // v2.2/v2.3: o que a engine somará ao poder nesta conjuração, e o quanto a
    // fúria da sala já encolheu a cura (curar por 0 não pode valer pontos).
    var elemBonus = (E().elementalBonus ? E().elementalBonus(unit, spell) : 0) +
                    (E().furyPower ? E().furyPower(state, unit) : 0);
    var healScale = E().healScale ? E().healScale(state) : 1;
    for (var e = 0; e < effs.length; e++) {
      var eff = effs[e];
      var t, u2, dmg;
      switch (eff.type) {
        case 'damage':
          for (t = 0; t < hitHostil.length; t++) {
            u2 = hitHostil[t];
            if (u2 === unit) continue; // engine exclui o conjurador
            dmg = expectDamage(unit, u2, eff, elemBonus);
            if (u2.side !== unit.side) {
              if (isInvisible(u2)) continue;
              value += dmg;
              if (dmg >= u2.hp + u2.shield) value += 40; // abate
              value += (1 - u2.hp / u2.hpMax) * 8;      // prefere feridos
              value -= weatherBiasFor(ctx, u2) * 2;     // v2: clima já o castiga
              if (eff.lifesteal) {
                value += Math.min((dmg / 2) * healScale, unit.hpMax - unit.hp) * 0.6;
              }
            } else {
              value -= dmg * 1.6; // fogo amigo
            }
          }
          break;
        case 'poison':
          for (t = 0; t < hitHostil.length; t++) {
            u2 = hitHostil[t];
            if (u2 === unit) continue;
            dmg = expectDamage(unit, u2, eff, elemBonus) * eff.duration;
            if (u2.side !== unit.side) { if (!isInvisible(u2)) value += dmg * 0.8; }
            else value -= dmg * 1.2;
          }
          break;
        case 'heal':
          for (t = 0; t < hitFavor.length; t++) {
            u2 = hitFavor[t];
            var healed = Math.min(((eff.min + eff.max) / 2) * healScale, u2.hpMax - u2.hp);
            if (u2.side === unit.side) value += healed * (ctx.role === 'support' ? 1.3 : 0.9);
            else value -= healed;
          }
          break;
        case 'regen':
          for (t = 0; t < hitFavor.length; t++) {
            u2 = hitFavor[t];
            if (u2.side !== unit.side) continue;
            value += Math.min(((eff.min + eff.max) / 2) * eff.duration * healScale,
                              u2.hpMax - u2.hp) * 0.6;
          }
          break;
        case 'shield':
          for (t = 0; t < hitFavor.length; t++) {
            u2 = hitFavor[t];
            if (u2.side !== unit.side) continue;
            var engaged = ctx.nearestEnemyDistTo(u2.x, u2.y) <= 3;
            value += eff.value * ((engaged || u2.hp < u2.hpMax) ? 0.6 : 0.05);
          }
          break;
        case 'buff':
          var lista = eff.value < 0 ? hitHostil : hitFavor;   // o sinal decide o lado
          for (t = 0; t < lista.length; t++) {
            u2 = lista[t];
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
          lista = eff.value < 0 ? hitHostil : hitFavor;
          for (t = 0; t < lista.length; t++) {
            u2 = lista[t];
            if (eff.value >= 0) value += (u2.side === unit.side) ? 4 : -4;
            else value += (u2.side !== unit.side && !isInvisible(u2)) ? 5 : -4;
          }
          break;
        case 'push':
          for (t = 0; t < hitHostil.length; t++) {
            u2 = hitHostil[t];
            if (u2 === unit || u2.side === unit.side || isInvisible(u2)) continue;
            if (E().unitHasTrait(u2, 'pushImmune')) continue;
            value += 3 + shoveCollision(state, cx, cy, u2, eff.tiles, ctx);
          }
          break;
        case 'pull':
          for (t = 0; t < hitHostil.length; t++) {
            u2 = hitHostil[t];
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
        case 'wall':
          value += valorDoMuro(state, unit, cx, cy, tiles, ctx, spell, eff, hitHostil);
          break;

        // ---------------------------------------------------------------- v2
        case 'root':
          for (t = 0; t < hitHostil.length; t++) {
            u2 = hitHostil[t];
            if (u2 === unit) continue;
            if (u2.side === unit.side) { value -= 14; continue; }
            if (isInvisible(u2)) continue;
            if (E().unitHasEffect(u2, 'root')) { value += 1; continue; }
            // prender vale mais contra quem depende de chegar perto
            value += 9 + Math.min(6, u2.ppMax) * (ctx.role === 'ranged' ? 2.0 : 1.0);
          }
          break;
        case 'mark':
          for (t = 0; t < hitHostil.length; t++) {
            u2 = hitHostil[t];
            if (u2 === unit || u2.side === unit.side || isInvisible(u2)) continue;
            var maxSt = eff.max || 5;
            var cur = E().markStacks(u2);
            if (cur >= maxSt) { value += 1; continue; }   // só renova
            value += 6 + (eff.value || 5) * 0.8;
          }
          break;
        case 'detonateMarks':
          for (t = 0; t < hitHostil.length; t++) {
            u2 = hitHostil[t];
            if (u2 === unit || u2.side === unit.side || isInvisible(u2)) continue;
            var st = E().markStacks(u2);
            if (st <= 0) continue;                         // sem marcas, não vale
            var boom = st * (eff.mult || 0);
            value += boom;
            if (boom >= u2.hp + u2.shield) value += 40;
          }
          break;
        case 'trap':
          // armadilha vale por onde o inimigo VAI passar, não onde já está
          if (!occ) {
            var dNear = ctx.nearestEnemyDistTo(tx, ty);
            if (dNear <= 4) value += 14 - dNear * 1.5;
          }
          break;
        case 'weatherShift':
          value += weatherShiftValue(state, unit, eff.weather, ctx);
          break;
        case 'cleanse':
          for (t = 0; t < hitFavor.length; t++) {
            u2 = hitFavor[t];
            if (u2.side !== unit.side) continue;
            var kinds = eff.kinds || [];
            var n = 0;
            for (var ci = 0; ci < u2.effects.length; ci++) {
              if (kinds.indexOf(u2.effects[ci].type) >= 0) n++;
            }
            value += n * 7;
          }
          break;
        case 'reflect':
          for (t = 0; t < hitFavor.length; t++) {
            u2 = hitFavor[t];
            if (u2.side !== unit.side) { value -= 6; continue; }
            if (E().unitHasEffect(u2, 'reflect')) continue;
            value += (ctx.nearestEnemyDistTo(u2.x, u2.y) <= 2 ? 12 : 3) + (eff.pct || 0) * 0.1;
          }
          break;
        case 'dispelShield':
          for (t = 0; t < hitHostil.length; t++) {
            u2 = hitHostil[t];
            if (u2 === unit || u2.side === unit.side || isInvisible(u2)) continue;
            value += u2.shield * 0.8;
          }
          break;
        case 'moveTo':
        case 'teleport':
          // investida: aproximar interessa a quem bate de perto. 03/10: o
          // TELEPORTE entra pela mesma régua — valia zero, e o Ladino do Ar
          // (Passo do Vento) e o Bruxo do Ar nunca saltavam: o caminho inteiro
          // jogava sem o verbo dele quando a IA conduzia (o herói que caiu da
          // rede, a bancada do equilíbrio). Nenhum monstro teleporta (medido).
          if (ctx.role === 'melee' || ctx.role === 'boss') {
            var before = ctx.nearestEnemyDistTo(cx, cy);
            var after = ctx.nearestEnemyDistTo(tx, ty);
            value += Math.max(0, before - after) * 2.5;
          }
          break;
        case 'chain':
          value += chainValue(state, unit, eff, occ, ctx, elemBonus);
          break;
        // swap: valor 0 — a IA não o planeja
      }
    }
    return value;
  }

  // v2: dano esperado de um raio em cadeia (alvo + saltos com falloff)
  function chainValue(state, unit, eff, first, ctx, elemBonus) {
    if (!first || first.side === unit.side || isInvisible(first)) return 0;
    var range = E().CHAIN_JUMP_RANGE || 3;
    var falloff = eff.falloff != null ? eff.falloff : 0.7;
    var hit = {};
    var cur = first, mult = 1, total = 0;
    for (var j = 0; j <= (eff.jumps || 0); j++) {
      if (!cur) break;
      hit[cur.uid] = true;
      var dmg = expectDamage(unit, cur, eff, elemBonus) * mult;
      total += dmg;
      if (dmg >= cur.hp + cur.shield) total += 20;
      mult *= falloff;
      var next = null, best = 999;
      for (var i = 0; i < ctx.enemies.length; i++) {
        var u = ctx.enemies[i];
        if (hit[u.uid]) continue;
        // 19/09: o motor só salta para quem a vítima de agora vê (chainDamage); 02/10: pela casa
        // mais perto entre os dois corpos, a mesma Engine.ligacao do motor
        var lg = E().ligacao ? E().ligacao(state, cur, u)
               : { d: manhattan(cur.x, cur.y, u.x, u.y), los: E().los(state, cur.x, cur.y, u.x, u.y) };
        if (lg.los && lg.d <= range && lg.d < best) { best = lg.d; next = u; }
      }
      cur = next;
    }
    return total;
  }

  /* 03/10 — O MURO DO MINOTAURO VALIA ZERO PARA A IA. O `switch` de castValue
   * não tinha o caso 'wall', então o muro puro (Primeira Pedra, Menir, Muralha…) nunca
   * saía, e o muro que vem junto de dano valia só o dano: o verbo inteiro da
   * classe (BARRAR, docs/CLASSES_V3.md) sumia de toda batalha jogada pela IA —
   * o herói que caiu da rede (`ia`) e a bancada do equilíbrio, que mede as
   * classes com a IA dos dois lados. Monstro nenhum ergue muro (medido), então
   * o PvE não muda.
   * O que o muro vale aqui é o que ele faz de fato no motor: cortar a VISÃO de
   * um inimigo até um dos nossos (o tiro que não sai no turno dele) e fechar a
   * casa ao lado de um inimigo (o passo que ele não dá). Mede a visão com o
   * muro posto de verdade na grade e devolve a casa como estava — a função
   * continua pura para quem a chama. Teto de 30: um feitiço de dano médio.
   *
   * 03/10 — OS ESPINHOS (engine.js, "O MURO QUE FERE QUEM ENCOSTA"). O muro
   * que fere vale também o dano em quem vai TERMINAR a vez encostado nele: o
   * inimigo vizinho de uma pedra nova leva o dano inteiro se não puder sair
   * (preso pela raiz do mesmo lance ou de antes, ou sem passo nenhum) e um
   * terço dele se puder — sair custa a vez, ficar custa a vida, e a IA do
   * outro lado pesa a mesma conta (planTurn). Fora do teto de 30: é dano. */
  function valorDoMuro(state, unit, cx, cy, tiles, ctx, spell, eff, hitHostil) {
    var novas = [], i, j;
    for (i = 0; i < tiles.length; i++) {
      var c = tiles[i];
      if (!isFloor(state, c.x, c.y)) continue;
      var occ = ctx.uAt(c.x, c.y);
      if (occ && occ !== unit) continue;
      if (c.x === cx && c.y === cy) continue;
      novas.push(c);
    }
    if (!novas.length) return 0;
    var espinhos = valorDosEspinhos(state, unit, cx, cy, novas, ctx, spell, eff, hitHostil);
    var meus = [{ u: unit, x: cx, y: cy }];
    for (i = 0; i < ctx.allies.length; i++) meus.push({ u: ctx.allies[i], x: ctx.allies[i].x, y: ctx.allies[i].y });
    var pares = [];
    for (i = 0; i < ctx.enemies.length; i++) {
      for (j = 0; j < meus.length; j++) {
        var e = ctx.enemies[i], a = meus[j];
        if (E().los(state, e.x, e.y, a.x, a.y)) pares.push([e, a]);
      }
    }
    var antes = [];
    for (i = 0; i < novas.length; i++) {
      antes.push(state.grid.tiles[novas[i].y][novas[i].x].type);
      state.grid.tiles[novas[i].y][novas[i].x].type = 'wall';
    }
    var v = 0;
    try {
      for (i = 0; i < pares.length; i++) {
        if (!E().los(state, pares[i][0].x, pares[i][0].y, pares[i][1].x, pares[i][1].y)) {
          v += pares[i][1].u === unit ? 6 : 8;
        }
      }
      for (i = 0; i < novas.length; i++) {
        for (j = 0; j < ctx.enemies.length; j++) {
          if (manhattan(novas[i].x, novas[i].y, ctx.enemies[j].x, ctx.enemies[j].y) === 1) v += 2;
        }
      }
    } finally {
      for (i = 0; i < novas.length; i++) state.grid.tiles[novas[i].y][novas[i].x].type = antes[i];
    }
    return Math.min(30, v) + espinhos;
  }

  /* a parte dos espinhos de valorDoMuro: quem fica encostado numa pedra nova, e O APERTO.
   *
   * O APERTO: a pedra que sobe logo ATRÁS de um inimigo, na direção em que um empurrão de quem ergue
   * ainda sai neste turno, vira bigorna — o empurrão o joga contra os espinhos (a colisão de sempre e
   * o dano do muro, engine.js forcedMove). É a jogada que um jogador faz com o Minotauro: pedra,
   * Marrada. A IA planeja os lances do estado do começo da vez (não simula o próprio golpe), então a
   * pedra só vale isso aqui, onde ela ainda não existe; e o valor a põe ANTES do empurrão na fila
   * (valendo mais que o golpe sozinho), que é a ordem em que a jogada funciona. Só o empurrão que
   * ainda cabe no PA depois da pedra, fora de recarga e da cota do turno. */
  var CHANCE_DE_FICAR = 1 / 3;
  function empurroesQueSaem(unit, muro) {
    var out = [], custoDoMuro = muro ? (muro.paCost || 0) : 0;
    for (var s = 0; s < unit.spells.length; s++) {
      var sp = spellOf(unit.spells[s]);
      if (!sp || (muro && sp.id === muro.id)) continue;     // o próprio feitiço da pedra não sai de novo
      if ((unit.cooldowns[sp.id] || 0) > 0) continue;
      if ((sp.paCost || 0) + (custoDoMuro || 0) > unit.pa) continue;
      var cpt = sp.castsPerTurn || 0;
      if (cpt > 0 && ((unit.castsThisTurn || {})[sp.id] || 0) >= cpt) continue;
      var tiles = 0;
      (sp.effects || []).forEach(function (ef) { if (ef.type === 'push' && ef.tiles > tiles) tiles = ef.tiles; });
      if (tiles > 0 && (sp.targetSide === 'enemy' || sp.targetSide === 'any' || !sp.targetSide)) out.push({ sp: sp, tiles: tiles });
    }
    return out;
  }
  function valorDosEspinhos(state, unit, cx, cy, novas, ctx, spell, eff, hitHostil) {
    var En = E();
    if (!eff || !(eff.fere > 0) || !En.fereDoMuro) return 0;
    var fere = En.fereDoMuro(state, unit, spell, eff);
    if (fere <= 0) return 0;
    var prende = false, k;
    var effs = (spell && spell.effects) || [];
    for (k = 0; k < effs.length; k++) if (effs[k].type === 'root') prende = true;
    var el = eff.element || (spell && spell.element) || 'neutro';
    var nova = {};
    for (k = 0; k < novas.length; k++) nova[novas[k].x + ',' + novas[k].y] = true;
    var empurroes = null;
    var v = 0;
    for (var i = 0; i < ctx.enemies.length; i++) {
      var e = ctx.enemies[i];
      var encosta = false;
      for (var j = 0; j < novas.length && !encosta; j++) {
        if (distAte(e, novas[j].x, novas[j].y) === 1) encosta = true;
      }
      if (!encosta) continue;
      // a mesma conta do motor (danoDoMuro): o `fere` da pedra menos a resistência ao elemento dela
      var dano = Math.max(1, Math.round(fere * (100 - En.effResist(e, el)) / 100));
      var semPasso = En.unitHasEffect(e, 'root') ||
                     (prende && hitHostil && hitHostil.indexOf(e) >= 0) ||
                     (e.ppMax || 0) <= 0;
      var p = semPasso ? 1 : CHANCE_DE_FICAR;
      var ve = dano * p;
      if (dano >= e.hp + (e.shield || 0)) ve += 25 * p;
      // O APERTO: o empurrão que sai depois joga o inimigo nesta pedra (corpo grande não é empurrado)
      if ((!En.porteDe || En.porteDe(e) === 1) && !E().unitHasTrait(e, 'pushImmune')) {
        if (empurroes === null) empurroes = empurroesQueSaem(unit, spell);
        for (var q = 0; q < empurroes.length; q++) {
          var ps = empurroes[q].sp, rg = sRange(ps);
          var d = manhattan(cx, cy, e.x, e.y);
          if (d < (rg.min || 0) || d > (rg.max != null ? rg.max : 1) || d === 0) continue;
          if (rg.line && !(e.x === cx || e.y === cy)) continue;
          if (rg.los && !En.los(state, cx, cy, e.x, e.y)) continue;
          // a direção do empurrão do motor: o eixo dominante de quem empurra até a vítima
          var ddx = e.x - cx, ddy = e.y - cy, sx = 0, sy = 0;
          if (Math.abs(ddx) >= Math.abs(ddy)) sx = ddx >= 0 ? 1 : -1; else sy = ddy > 0 ? 1 : -1;
          if (!nova[(e.x + sx) + ',' + (e.y + sy)]) continue;
          ve = Math.max(ve, 10 * empurroes[q].tiles + dano);
        }
      }
      v += ve;
    }
    return v;
  }

  // v2: saldo elemental de trocar o clima
  function weatherShiftValue(state, unit, weatherId, ctx) {
    var table = (DATA().weathers) || null;
    var w = table ? table[weatherId] : null;
    if (!w) return 2;
    if (state.weather === weatherId) return -1;
    var score = 0, i;
    var mine = [unit].concat(ctx.allies);
    for (i = 0; i < mine.length; i++) {
      var els = E().unitElements(mine[i]);
      if (w.favors && els.indexOf(w.favors) >= 0) score += 6;
      if (w.harms && els.indexOf(w.harms) >= 0) score -= 8;
    }
    for (i = 0; i < ctx.enemies.length; i++) {
      var eels = E().unitElements(ctx.enemies[i]);
      if (w.harms && eels.indexOf(w.harms) >= 0) score += 6;
      if (w.favors && eels.indexOf(w.favors) >= 0) score -= 6;
    }
    return score;
  }

  // células-alvo candidatas para um feitiço a partir de (cx,cy)
  function targetCandidates(state, unit, spell, cx, cy, ctx) {
    var out = [], seen = {}, i, u;
    function add(x, y) {
      var k = x + ',' + y;
      if (!seen[k]) { seen[k] = true; out.push({ x: x, y: y }); }
    }
    var rg = sRange(spell);
    if (spell.needsEmptyTile || ctx.spellHasType(spell, 'trap')) {
      var r = rg.max != null ? rg.max : 1;
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
      // 02/10: toda casa do corpo é alvo (a do canto noroeste pode estar sem visão)
      var cs = E().casasDe ? E().casasDe(u) : [{ x: u.x, y: u.y }];
      for (var ci = 0; ci < cs.length; ci++) {
        add(cs[ci].x, cs[ci].y);
        if (sAoe(spell).shape !== 'single' && u.side !== unit.side) {
          add(cs[ci].x + 1, cs[ci].y); add(cs[ci].x - 1, cs[ci].y); add(cs[ci].x, cs[ci].y + 1); add(cs[ci].x, cs[ci].y - 1);
        }
      }
    }
    if ((rg.min || 0) === 0) add(cx, cy); // auto-alvo
    return out;
  }

  function bestCastFrom(state, unit, cx, cy, paLeft, counts, ctx, usedCd) {
    var best = null;
    for (var s = 0; s < unit.spells.length; s++) {
      var spell = spellOf(unit.spells[s]);
      if (!spell) continue;
      var cost = spell.paCost || 0;
      if (cost > paLeft) continue;
      if ((unit.cooldowns[spell.id] || 0) > 0) continue;
      if (usedCd && usedCd[spell.id]) continue;
      var cpt = spell.castsPerTurn || 0;
      if (cpt > 0 && (counts[spell.id] || 0) >= cpt) continue;
      var cands = targetCandidates(state, unit, spell, cx, cy, ctx);
      for (var c = 0; c < cands.length; c++) {
        var tx = cands[c].x, ty = cands[c].y;
        if (!validFrom(state, unit, spell, cx, cy, tx, ty, ctx)) continue;
        var v = castValue(state, unit, spell, cx, cy, tx, ty, ctx);
        if (v > 0.5 && (!best || v > best.value)) {
          best = { value: v, spellId: spell.id, x: tx, y: ty, paCost: cost };
        }
      }
    }
    return best;
  }

  AI.planTurn = function (state, uid) {
    var unit = E().findUnit(state, uid);
    if (!unit || !unit.alive || unit.offBoard || state.phase !== 'playing') {
      return [{ action: 'end' }];
    }

    var role = inferRole(unit);
    var enemies = [], allies = [], taunters = [], tauntersSet = {}, living = [];
    var unitMap = {};
    var i, u;
    for (i = 0; i < state.units.length; i++) {
      u = state.units[i];
      if (!u.alive || u.offBoard) continue;
      living.push(u);
      // 02/10: o corpo grande aparece nas quatro casas dele
      var csm = E().casasDe ? E().casasDe(u) : [{ x: u.x, y: u.y }];
      for (var cm = 0; cm < csm.length; cm++) unitMap[csm[cm].x + ',' + csm[cm].y] = u;
      if (u === unit) continue;
      if (u.side === unit.side) allies.push(u);
      else if (!isInvisible(u)) {
        enemies.push(u);
        if (isTaunter(u)) { taunters.push(u); tauntersSet[u.uid] = true; }
      }
    }
    if (enemies.length === 0) return [{ action: 'end' }];

    var typeCache = {};
    var ctx = {
      role: role,
      enemies: enemies,
      allies: allies,
      taunters: taunters,
      tauntersSet: tauntersSet,
      living: living,
      weather: E().weatherDef ? E().weatherDef(state) : null,
      uAt: function (x, y) { return unitMap[x + ',' + y] || null; },
      spellHasType: function (spell, type) {
        var k = spell.id + '|' + type;
        if (typeCache[k] === undefined) {
          typeCache[k] = false;
          var effs = spell.effects || [];
          for (var m = 0; m < effs.length; m++) if (effs[m].type === type) typeCache[k] = true;
        }
        return typeCache[k];
      },
      spellHasSwap: function (spell) { return ctx.spellHasType(spell, 'swap'); },
      nearestEnemyDistTo: function (x, y) {
        var m = 999;
        for (var k = 0; k < enemies.length; k++) {
          var d = distAte(enemies[k], x, y);
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
      var key = (E().distEntre ? E().distEntre(unit, u) : manhattan(unit.x, unit.y, u.x, u.y)) * 2 + (u.hp / u.hpMax) * 10;
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
      var sp = spellOf(unit.spells[i]);
      if (!sp) continue;
      var effs = sp.effects || [];
      for (var j = 0; j < effs.length; j++) {
        if ((effs[j].type === 'damage' || effs[j].type === 'chain') &&
            sRange(sp).max > idealRange) idealRange = sRange(sp).max;
      }
    }

    // v2: risco de esquiva ao deixar a célula atual (pior fixador)
    var worstDodge = 1;
    for (i = 0; i < enemies.length; i++) {
      if (distAte(enemies[i], unit.x, unit.y) !== 1) continue;
      var ch = E().dodgeChance(state, unit.uid, enemies[i].uid);
      if (ch < worstDodge) worstDodge = ch;
    }
    var dodgeRisk = 1 - worstDodge;   // 0 = sem risco

    // v2: mapas de armadilha do outro lado e de evento de terreno. 22/09: só a
    // armadilha que o lado desta unidade ENXERGA — quem não sabe não desvia.
    var trapCells = {};
    for (i = 0; i < (state.traps || []).length; i++) {
      var tr = state.traps[i];
      if (tr.side !== unit.side && E().armadilhaVisivel(state, unit.side, tr)) trapCells[tr.x + ',' + tr.y] = true;
    }
    var eventCells = {};
    var TE = DATA().tileEvents || {};
    for (i = 0; i < (state.tileEventsActive || []).length; i++) {
      var te = state.tileEventsActive[i];
      var def = TE[te.eventId] || {};
      var kind = te.kind || def.kind;
      var w = 0;
      if (kind === 'buff') w = 14;
      else if (kind === 'fountain') w = unit.hp < unit.hpMax ? 16 : 2;
      else if (kind === 'drain') w = -18;
      else if (kind === 'mystery') w = 3;
      else if (kind === 'portal') w = 0;
      eventCells[te.x + ',' + te.y] = w;
    }
    /* 02/10: o chão do Poço (js/core/poco.js, Poco.regras.pesoCasas). A casa
     * avisada para o começo da próxima rodada pesa mais que armadilha: a
     * unidade VAI estar nela quando o golpe vier. Sem `state.perigos` (todo
     * calabouço que não é o Poço) nada muda. */
    var PR = (state.perigos && JOGO.Poco && JOGO.Poco.regras) ? JOGO.Poco.regras : null;
    var pesoChao = PR ? PR.pesoCasas(state, unit) : null;
    /* 03/10: OS ESPINHOS DO MURO do outro lado (engine.js, "O MURO QUE FERE QUEM
     * ENCOSTA"). Terminar a vez encostado custa o dano do muro — pesado como
     * dano que se toma (1,2×, um pouco mais que o que se dá, para o empate ir
     * para longe da pedra), e muito mais quando mata. O muro está à vista de
     * todos, então os dois lados pesam igual; ficar continua possível quando o
     * golpe dali vale mais que a ferida. Sem muro que fere, nada muda. */
    var temEspinhos = false;
    for (i = 0; i < (state.walls || []).length; i++) {
      if (state.walls[i].fere > 0 && state.walls[i].side !== unit.side) { temEspinhos = true; break; }
    }

    // candidatos de posição: célula atual + alcançáveis com o PP atual
    var candidates = [{ x: unit.x, y: unit.y, cost: 0, risky: false }]
      .concat(E().reachable(state, uid));
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

      // v2: risco de fixação ao sair, armadilhas que ela vê e eventos de terreno
      if (cell.risky) score -= 18 * dodgeRisk;
      if (trapCells[cell.x + ',' + cell.y]) score -= 60;
      var ev = eventCells[cell.x + ',' + cell.y];
      if (ev) score += ev;
      if (pesoChao && pesoChao[cell.x + ',' + cell.y]) score += pesoChao[cell.x + ',' + cell.y];
      if (temEspinhos) {
        var ferida = E().muroFerePrevisto(state, unit, cell.x, cell.y);
        if (ferida > 0) score -= ferida * 1.2 + (ferida >= unit.hp + (unit.shield || 0) ? 60 : 0);
      }

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
      var sd = spellOf(pick.spellId);
      if (sd && (sd.cooldown || 0) > 0) usedCd[pick.spellId] = true;
    }

    plan.push({ action: 'end' });
    return plan;
  };
})();
