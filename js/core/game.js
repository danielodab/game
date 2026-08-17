var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* ============================================================================
 * SOTERRA 2.0 — js/core/game.js   (dono: Lógica Meta)
 * Fluxo de telas, recompensas de sala, cronômetro do turno, cancelamento de
 * feitiço, declaração de fusão e condução do ritmo da IA.
 * LEI: docs/CONTRACT_V2.md §9 (`JOGO.Game`) e §4 (fusão).
 * Nomenclatura: pa = Pontos de Ataque, pp = Pontos de Passos.
 *
 * Telas: 'menu' | 'heroSelect' | 'elementChoice' | 'dungeonSelect' | 'battle'
 *        | 'roomClear' | 'defeat' | 'dungeonComplete'.
 *
 * ---------------------------------------------------------------------------
 * DECISÕES DE DESIGN (todas testadas em tests/test_progress_v2.html):
 *
 * [G1] ENTRE SALAS (regra aprovada na v1, mantida): heróis VIVOS curam 50% do
 *      PV perdido; heróis MORTOS revivem com 30% do `hpMax` — sem revive, uma
 *      morte cedo condenaria a descida inteira.
 *
 * [G2] CRONÔMETRO. `turnTime` = 30 s por turno de herói. O tempo NÃO usado é
 *      guardado em `banked` e só é consumido depois que os 30 s acabam
 *      ("gasto antes de expirar"). Quando `timeLeft()` chega a 0, o turno é
 *      encerrado automaticamente. O banco é ÚNICO para o lado do jogador
 *      (não por herói) e zera ao começar cada sala — acumular entre salas
 *      quebraria o ritmo. Teto de acúmulo: `bankMax` (120 s).
 *      O tempo é contado por `dt` acumulado em `update(dt)` — nunca por
 *      `setTimeout`/`rAF`, que sofrem estrangulamento com a aba oculta.
 *      `Game._setClock(fn)` injeta um relógio (função que devolve SEGUNDOS)
 *      para os testes: com relógio injetado, o delta vem dele e `dt` é
 *      ignorado. `_setClock(null)` volta ao modo `dt`.
 *      Enquanto o turno corre, emite `timerTick {remaining, banked}` na fila
 *      `JOGO.Engine.events` (1× por segundo cheio), se a fila existir.
 *
 * [G3] CANCELAMENTO DE FEITIÇO (proteção contra clique acidental): com um
 *      feitiço selecionado, clicar FORA dos alvos válidos apenas DESMARCA o
 *      feitiço e devolve o modo de movimento — não conjura, não move, não
 *      gasta PA nem PP. Só o segundo clique (já sem feitiço) move.
 *
 * [G4] FUSÃO pelo lado do jogador. `canFuse()` devolve os pares
 *      `{uidA, uidB}` em que A é o herói ATIVO (é ele quem paga os 2 PA) e B é
 *      um aliado herói vivo e adjacente (4-vizinhança). `declareFusion` chama
 *      `JOGO.Fusion.declare` e, dando certo, marca `mustEndTurn`: o turno é
 *      encerrado na próxima `update()` e a RESOLUÇÃO é do Engine/Fusion no fim
 *      do turno (se algum se afastar, não funde). Sem `JOGO.Fusion` carregado,
 *      `declareFusion` devolve false sem efeito colateral.
 *
 * [G5] RECOMPENSAS DA SALA. XP = soma do `xp` dos monstros INIMIGOS mortos
 *      dividida (piso) pelo tamanho do grupo; cada herói do grupo recebe esse
 *      valor (vivo ou morto).
 *      A UI recebe `{xpGanho, levelUps, drops, pets, cards, stones,
 *      elementChoices}`.
 *      ADENDO v2.1: carta repetida NÃO vira mais XP (o campo `xpCartas` foi
 *      removido) — agora ela acumula na coleção e vira estrela, e quem faz
 *      essa conta é o `Progress`. As PEDRAS DE FORJA são colhidas aqui: cada
 *      monstro inimigo morto com `stoneDrop {chance, min, max}` rende pedras
 *      do PRÓPRIO elemento (`DATA.stones` dá o id da pedra daquele elemento).
 *
 * [G8] GRUPO DE 1 OU 2 HERÓIS (§9-B). `startRun` recusa 3 ou mais; com dois
 *      heróis, a fusão vira a jogada de trocar economia de ações por poder.
 *
 * [G6] ESCOLHA DE ELEMENTO. Ao fim da sala, `elementChoices` lista os heróis
 *      que chegaram ao nível 5 sem elemento. A UI vai para a tela
 *      'elementChoice' (`Game.goTo`) e chama `Game.chooseElement`; quando não
 *      resta ninguém pendente, o jogo volta sozinho à tela anterior.
 *
 * [G7] ROBUSTEZ v1 preservada: nada acessa Renderer/UI/Fusion/IA sem checar
 *      existência (headless roda liso); com Renderer, a IA executa 1 ação por
 *      vez, esperando `Renderer.isBusy() === false` e 250 ms entre ações; sem
 *      Renderer, o turno inteiro da IA roda numa chamada de `update()`.
 * ==========================================================================*/

(function () {
  'use strict';

  var Game = {};
  JOGO.Game = Game;

  var AI_ACTION_DELAY = 0.25;   // segundos entre ações da IA (com Renderer)
  var PRE_SCREENS = ['menu', 'heroSelect', 'dungeonSelect', 'elementChoice'];

  Game.screen = 'menu';
  Game.state = null;
  Game.selectedSpellId = null;
  Game.hoverTile = null;
  Game.party = [];
  Game.dungeonId = null;
  Game.roomIndex = 0;

  // ---- cronômetro [G2]
  Game.turnTime = 30;    // segundos por turno de herói
  Game.banked = 0;       // segundos acumulados do lado do jogador
  Game.bankMax = 120;    // teto do acúmulo

  // ---- fusão [G4]
  Game.pendingFusion = null;
  Game.mustEndTurn = false;

  // internos da condução de IA
  var aiPlan = null, aiIdx = 0, aiUid = null, aiTimer = 0;
  // PV dos heróis ao fim da sala vencida: { heroId: hp } (0 = morto)
  var carryHp = null;
  // internos do cronômetro
  var turnElapsed = 0, timerUid = null, lastTickSec = -1;
  var clockFn = null, lastClock = 0;
  // tela para onde voltar depois de 'elementChoice' [G6]
  var returnScreen = 'menu';

  function E() { return JOGO.Engine; }
  function P() { return JOGO.Progress; }
  function num(v, def) { return (typeof v === 'number' && isFinite(v)) ? v : def; }

  function setScreen(name, data) {
    Game.screen = name;
    if (JOGO.UI && JOGO.UI.showScreen) {
      try { JOGO.UI.showScreen(name, data); } catch (err) { /* nunca crashar por UI */ }
    }
  }

  function resetAiState() { aiPlan = null; aiIdx = 0; aiUid = null; aiTimer = 0; }

  function resetTimer(clearBank) {
    turnElapsed = 0;
    timerUid = null;
    lastTickSec = -1;
    if (clearBank) Game.banked = 0;
    if (clockFn) { try { lastClock = num(clockFn(), 0); } catch (e) { lastClock = 0; } }
  }

  Game.init = function () {
    Game.screen = 'menu';
    Game.state = null;
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    Game.party = [];
    Game.dungeonId = null;
    Game.roomIndex = 0;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    carryHp = null;
    resetAiState();
    resetTimer(true);
    returnScreen = 'menu';
    setScreen('menu');
  };

  // navegação pré-batalha para o UI
  Game.goTo = function (name) {
    for (var i = 0; i < PRE_SCREENS.length; i++) {
      if (PRE_SCREENS[i] === name) {
        if (name === 'elementChoice') returnScreen = Game.screen;
        setScreen(name, name === 'elementChoice' ? { heroIds: Game.elementChoices() } : null);
        return true;
      }
    }
    return false;
  };

  // ------------------------------------------------------ escolha de elemento [G6]
  Game.elementChoices = function (heroIds) {
    var prog = P();
    if (!prog || !prog.pendingElementChoices) return [];
    try {
      return prog.pendingElementChoices(heroIds || (Game.party.length ? Game.party : null));
    } catch (e) { return []; }
  };

  Game.chooseElement = function (heroId, element) {
    var prog = P();
    if (!prog || !prog.chooseElement) return false;
    var ok = false;
    try { ok = prog.chooseElement(heroId, element); } catch (e) { ok = false; }
    if (ok && Game.screen === 'elementChoice' && !Game.elementChoices().length) {
      setScreen(returnScreen || 'menu');
    }
    return ok;
  };

  // ------------------------------------------------------------- validações
  function heroExists(heroId) {
    var prog = P();
    if (prog && prog.hero) return !!prog.hero(heroId);
    return false;
  }

  function validParty(heroIds) {
    if (!heroIds || heroIds.length < 1 || heroIds.length > 2) return false;  // grupo de 1 ou 2 [G8]
    var seen = {};
    for (var i = 0; i < heroIds.length; i++) {
      var id = heroIds[i];
      if (typeof id !== 'string' || seen[id]) return false;
      seen[id] = true;
      if (!heroExists(id)) return false;
    }
    return true;
  }

  function validDungeon(dungeonId) {
    var ds = (JOGO.DATA && JOGO.DATA.dungeons) || [];
    for (var i = 0; i < ds.length; i++) if (ds[i] && ds[i].id === dungeonId) return true;
    return false;
  }

  // grupo no formato do Engine (contrato §9); sem Progress, cai nos ids crus
  function partyPayload() {
    var prog = P();
    if (prog && prog.battleParty) {
      try {
        var p = prog.battleParty(Game.party);
        if (p && p.length) return p;
      } catch (e) { /* cai no fallback */ }
    }
    return Game.party.slice();
  }

  // ------------------------------------------------------------- fluxo de run
  Game.startRun = function (heroIds, dungeonId) {
    if (!validParty(heroIds) || !validDungeon(dungeonId)) return false;
    Game.party = heroIds.slice();
    Game.dungeonId = dungeonId;
    Game.roomIndex = 0;
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    carryHp = null;
    resetAiState();
    resetTimer(true);
    Game.state = E().createBattle(dungeonId, 0, partyPayload());
    setScreen('battle');
    return true;
  };

  Game.nextRoom = function () {
    if (Game.screen !== 'roomClear' || !Game.dungeonId) return false;
    Game.roomIndex++;
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    resetAiState();
    resetTimer(true);
    Game.state = E().createBattle(Game.dungeonId, Game.roomIndex, partyPayload());
    // [G1] vivos curam 50% do PV perdido; mortos revivem com 30% do hpMax
    if (carryHp && Game.state && Game.state.units) {
      for (var i = 0; i < Game.state.units.length; i++) {
        var u = Game.state.units[i];
        if (u.kind !== 'hero') continue;
        var key = u.heroId || u.defId;
        var prev = carryHp[key];
        if (prev === undefined) continue;
        if (prev > 0) u.hp = Math.min(u.hpMax, prev + Math.round((u.hpMax - prev) * 0.5));
        else u.hp = Math.max(1, Math.round(u.hpMax * 0.3));
      }
    }
    carryHp = null;
    setScreen('battle');
    return true;
  };

  Game.restart = function () { Game.init(); };

  Game.isPlayerTurn = function () {
    if (!Game.state || Game.state.phase !== 'playing') return false;
    var u = E() && E().activeUnit ? E().activeUnit(Game.state) : null;
    return !!u && u.kind === 'hero';
  };

  // ------------------------------------------------------------- cronômetro [G2]
  Game._setClock = function (fn) {
    clockFn = (typeof fn === 'function') ? fn : null;
    if (clockFn) { try { lastClock = num(clockFn(), 0); } catch (e) { lastClock = 0; } }
    return clockFn;
  };

  function tickDelta(dt) {
    if (clockFn) {
      var now = 0;
      try { now = num(clockFn(), lastClock); } catch (e) { now = lastClock; }
      var d = now - lastClock;
      lastClock = now;
      return d > 0 ? d : 0;
    }
    var v = num(dt, 0);
    return v > 0 ? v : 0;
  }

  // tempo restante do turno atual = (30 − gasto) + banco, nunca negativo.
  // Fora do turno do jogador, devolve o tempo que o próximo turno terá.
  Game.timeLeft = function () {
    return Math.max(0, Game.turnTime - turnElapsed + Game.banked);
  };

  function emitTimerTick() {
    var eng = E();
    if (!eng || !eng.events || typeof eng.events.push !== 'function') return;
    var sec = Math.ceil(Game.timeLeft());
    if (sec === lastTickSec) return;
    lastTickSec = sec;
    try { eng.events.push({ type: 'timerTick', remaining: sec, banked: Game.banked }); }
    catch (e) { /* fila indisponível */ }
  }

  // fecha a conta do turno: sobra vira banco, excesso consome banco
  function closeTurnTimer() {
    var rest = Game.turnTime - turnElapsed;
    if (rest >= 0) Game.banked = Math.min(Game.bankMax, Game.banked + rest);
    else Game.banked = Math.max(0, Game.banked + rest);
    turnElapsed = 0;
    lastTickSec = -1;
  }

  function updateTimer(d) {
    var u = E() && E().activeUnit ? E().activeUnit(Game.state) : null;
    if (!u) return;
    if (timerUid !== u.uid) {          // turno novo: relógio zerado
      timerUid = u.uid;
      turnElapsed = 0;
      lastTickSec = -1;
    }
    turnElapsed += d;
    emitTimerTick();
    if (Game.timeLeft() <= 0) {        // expirou: encerra sozinho
      Game.endTurn();
    }
  }

  // ------------------------------------------------------------- entrada
  Game.selectSpell = function (spellId) {
    if (Game.screen !== 'battle') return;
    if (spellId === null || spellId === Game.selectedSpellId) Game.selectedSpellId = null;
    else Game.selectedSpellId = spellId;
  };

  Game.onTileClicked = function (x, y) {
    if (Game.screen !== 'battle' || !Game.state) return;
    if (Game.state.phase !== 'playing' || !Game.isPlayerTurn()) return;
    var u = E().activeUnit(Game.state);
    if (!u) return;

    if (Game.selectedSpellId) {
      var targets = [];
      try { targets = E().castTargets(Game.state, u.uid, Game.selectedSpellId) || []; }
      catch (err) { targets = []; }
      for (var i = 0; i < targets.length; i++) {
        if (targets[i].x === x && targets[i].y === y) {
          if (E().cast(Game.state, u.uid, Game.selectedSpellId, x, y)) Game.selectedSpellId = null;
          return;
        }
      }
      // [G3] fora da zona válida: só desmarca e volta ao modo de movimento
      Game.selectedSpellId = null;
      return;
    }

    if (E().unitAt(Game.state, x, y)) return;   // clique em unidade: nada
    E().move(Game.state, u.uid, x, y);
  };

  Game.onTileHover = function (x, y) {
    if (typeof x !== 'number' || typeof y !== 'number' || !Game.state ||
        x < 0 || y < 0 || x >= Game.state.grid.w || y >= Game.state.grid.h) {
      Game.hoverTile = null;
      return;
    }
    Game.hoverTile = { x: x, y: y };
  };

  Game.endTurn = function () {
    if (Game.screen !== 'battle' || !Game.state) return;
    if (!Game.isPlayerTurn()) return;
    Game.selectedSpellId = null;
    Game.mustEndTurn = false;
    Game.pendingFusion = null;
    closeTurnTimer();
    timerUid = null;
    E().endTurn(Game.state);
  };

  // ------------------------------------------------------------- fusão [G4]
  function adjacent(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
  }

  Game.canFuse = function () {
    var out = [];
    if (Game.screen !== 'battle' || !Game.state || !Game.isPlayerTurn()) return out;
    var a = E().activeUnit(Game.state);
    if (!a || a.kind !== 'hero' || a.fused) return out;
    var F = JOGO.Fusion;
    var units = Game.state.units || [];
    for (var i = 0; i < units.length; i++) {
      var b = units[i];
      if (b === a || b.uid === a.uid) continue;
      if (b.kind !== 'hero' || !b.alive || b.side !== a.side || b.fused) continue;
      if (!adjacent(a, b)) continue;
      if (F && F.canFuse) {
        var ok = false;
        try { ok = !!F.canFuse(Game.state, a.uid, b.uid); } catch (e) { ok = false; }
        if (!ok) continue;
      }
      out.push({ uidA: a.uid, uidB: b.uid });
    }
    return out;
  };

  Game.declareFusion = function (uidA, uidB) {
    var pairs = Game.canFuse();
    var found = false;
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i].uidA === uidA && pairs[i].uidB === uidB) { found = true; break; }
    }
    if (!found) return false;
    var F = JOGO.Fusion;
    if (!F || !F.declare) return false;
    var ok = false;
    try { ok = !!F.declare(Game.state, uidA, uidB); } catch (e) { ok = false; }
    if (!ok) return false;
    Game.pendingFusion = { uidA: uidA, uidB: uidB };
    Game.mustEndTurn = true;            // resolução: Engine/Fusion no fim do turno
    Game.selectedSpellId = null;
    return true;
  };

  // ------------------------------------------------------------- eventos
  Game.handleEvent = function (ev) {
    if (ev && ev.type === 'battleEnd') handleBattleOver();
  };

  // ------------------------------------------------------------- recompensas [G5]
  function computeRewards() {
    var st = Game.state;
    var prog = P();
    var partySize = Game.party.length || 1;
    var monsters = (JOGO.DATA && JOGO.DATA.monsters) || {};
    var xpTotal = 0, i;

    for (i = 0; i < st.units.length; i++) {
      var u = st.units[i];
      if (u.side !== 'enemy' || u.alive) continue;
      var def = monsters[u.defId];
      if (def && typeof def.xp === 'number') xpTotal += def.xp;
    }
    var xpGanho = Math.floor(xpTotal / partySize);

    // cartas primeiro: a repetida vira XP e entra na mesma conta de níveis
    var cards = [], xpCartas = 0;
    if (prog && prog.rollCards) {
      try { cards = prog.rollCards(Game.dungeonId, Game.roomIndex, partySize) || []; }
      catch (err) { cards = []; }
      for (i = 0; i < cards.length; i++) xpCartas += num(cards[i].xpBonus, 0);
    }

    var levelUps = [];
    if (prog && prog.addXp) {
      for (var h = 0; h < Game.party.length; h++) {
        var heroId = Game.party[h];
        var gained = 0;
        try { gained = prog.addXp(heroId, xpGanho + xpCartas); } catch (err) { gained = 0; }
        if (gained > 0) {
          var hero = prog.hero ? prog.hero(heroId) : null;
          levelUps.push({ heroId: heroId, niveis: gained, novoNivel: hero ? hero.level : null });
        }
      }
    }

    var drops = [], pets = [];
    if (prog && prog.rollDrops) {
      try { drops = prog.rollDrops(Game.dungeonId, Game.roomIndex, partySize) || []; }
      catch (err) { drops = []; }
    }
    if (prog && prog.rollPet) {
      try {
        var pet = prog.rollPet(Game.dungeonId, Game.roomIndex, partySize);
        if (pet) pets.push(pet);
      } catch (err) { pets = []; }
    }

    var elementChoices = Game.elementChoices();

    if (prog && prog.save) { try { prog.save(); } catch (err) { /* sem storage */ } }

    return {
      xpGanho: xpGanho,
      xpCartas: xpCartas,
      levelUps: levelUps,
      drops: drops,
      pets: pets,
      cards: cards,
      elementChoices: elementChoices
    };
  }

  function handleBattleOver() {
    if (!Game.state || Game.screen !== 'battle') return;
    if (Game.state.phase === 'won') {
      carryHp = {};
      for (var i = 0; i < Game.state.units.length; i++) {
        var u = Game.state.units[i];
        if (u.kind === 'hero') carryHp[u.heroId || u.defId] = u.alive ? u.hp : 0;
      }
      resetAiState();
      resetTimer(true);
      Game.selectedSpellId = null;
      Game.mustEndTurn = false;
      Game.pendingFusion = null;
      var rewards = computeRewards();
      var lastRoom = 2;
      var d = null, ds = (JOGO.DATA && JOGO.DATA.dungeons) || [];
      for (var k = 0; k < ds.length; k++) if (ds[k] && ds[k].id === Game.dungeonId) d = ds[k];
      if (d && d.rooms && d.rooms.length) lastRoom = d.rooms.length - 1;
      returnScreen = (Game.roomIndex >= lastRoom) ? 'dungeonComplete' : 'roomClear';
      setScreen(returnScreen, rewards);
    } else if (Game.state.phase === 'lost') {
      resetAiState();
      resetTimer(true);
      Game.selectedSpellId = null;
      Game.mustEndTurn = false;
      Game.pendingFusion = null;
      returnScreen = 'defeat';
      setScreen('defeat');
    }
  }

  // ------------------------------------------------------------- ritmo da IA [G7]
  function execAction(action, uid) {
    var st = Game.state;
    try {
      if (action.action === 'move') E().move(st, uid, action.x, action.y);
      else if (action.action === 'cast') E().cast(st, uid, action.spellId, action.x, action.y);
      else if (action.action === 'end') E().endTurn(st);
    } catch (err) { /* nunca travar por erro de execução */ }
  }

  function getPlanFor(uid) {
    var plan;
    try { plan = JOGO.AI && JOGO.AI.planTurn ? JOGO.AI.planTurn(Game.state, uid) : null; }
    catch (err) { plan = null; }
    if (!plan || !plan.length) plan = [{ action: 'end' }];
    return plan;
  }

  Game.update = function (dt) {
    var d = tickDelta(dt);
    if (Game.screen !== 'battle' || !Game.state) return;

    if (Game.state.phase !== 'playing') { handleBattleOver(); return; }

    if (Game.isPlayerTurn()) {
      resetAiState();
      if (Game.mustEndTurn) { Game.endTurn(); return; }   // fusão declarada [G4]
      updateTimer(d);
      return;
    }

    var u = E().activeUnit(Game.state);
    if (!u) return;
    timerUid = null;                 // turno de IA não consome o cronômetro
    var renderer = JOGO.Renderer;

    if (!renderer || !renderer.isBusy) {
      // headless: turno inteiro da IA nesta chamada
      var plan = getPlanFor(u.uid);
      var ended = false;
      for (var i = 0; i < plan.length && Game.state.phase === 'playing'; i++) {
        execAction(plan[i], u.uid);
        if (plan[i].action === 'end') { ended = true; break; }
      }
      if (!ended && Game.state.phase === 'playing') E().endTurn(Game.state);
      if (Game.state.phase !== 'playing') handleBattleOver();
      return;
    }

    // com Renderer: 1 ação por vez
    if (renderer.isBusy()) { aiTimer = 0; return; }
    aiTimer += d;
    if (aiPlan && aiUid === u.uid && aiTimer < AI_ACTION_DELAY) return;

    if (!aiPlan || aiUid !== u.uid) {
      aiPlan = getPlanFor(u.uid);
      aiIdx = 0;
      aiUid = u.uid;
      aiTimer = 0;
      return;                      // primeira ação no próximo quadro elegível
    }

    if (aiIdx >= aiPlan.length) {
      resetAiState();
      if (Game.state.phase === 'playing') E().endTurn(Game.state);
      return;
    }

    var action = aiPlan[aiIdx++];
    execAction(action, u.uid);
    aiTimer = 0;
    if (action.action === 'end') resetAiState();
    if (Game.state.phase !== 'playing') { resetAiState(); handleBattleOver(); }
  };
})();
