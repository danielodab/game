var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* ============================================================================
 * SOTERRA — js/core/game.js  (dono: Agente de Lógica)
 * Fluxo de telas e condução dos turnos de IA.
 *
 * Telas: 'menu' | 'heroSelect' | 'dungeonSelect' | 'battle' | 'roomClear' |
 *        'defeat' | 'dungeonComplete'.
 *
 * DECISÕES DE DESIGN (documentadas):
 *  - Entre salas: heróis VIVOS curam 50% do HP perdido; heróis MORTOS
 *    revivem com 30% do hpMax (o contrato manda curar/limpar entre salas mas
 *    é omisso sobre mortos — sem revive, uma morte cedo condenaria a run).
 *    Efeitos são limpos automaticamente (unidades novas por sala).
 *  - Invocações do lado do jogador (Esporinho) são conduzidas pela IA:
 *    isPlayerTurn() só é true quando a unidade ativa é um HERÓI.
 *  - Clique em célula com unidade sem feitiço selecionado não faz nada
 *    (o Renderer/UI pode ler Game.state para exibir info).
 *  - Após conjurar com sucesso, o feitiço selecionado é desmarcado.
 *  - Game.goTo(name) permite ao UI navegar entre telas pré-batalha
 *    ('menu'|'heroSelect'|'dungeonSelect') — extensão amigável ao contrato.
 *  - Com Renderer presente: 1 ação de IA por vez, esperando
 *    Renderer.isBusy() === false e um mínimo de 250ms entre ações.
 *    Sem Renderer (headless): o turno inteiro da IA roda de uma vez por
 *    chamada de update().
 *  - Nada aqui acessa Renderer/UI sem checar existência (trabalho paralelo
 *    do Designer e testes headless).
 * ==========================================================================*/

(function () {
  'use strict';

  var Game = {};
  JOGO.Game = Game;

  var AI_ACTION_DELAY = 0.25; // segundos entre ações da IA (com Renderer)

  Game.screen = 'menu';
  Game.state = null;
  Game.selectedSpellId = null;
  Game.hoverTile = null;
  Game.party = [];
  Game.dungeonId = null;
  Game.roomIndex = 0;

  // internos da condução de IA
  var aiPlan = null, aiIdx = 0, aiUid = null, aiTimer = 0;
  // HP dos heróis ao fim da sala vencida: { heroId: hp } (0 = morto)
  var carryHp = null;

  function E() { return JOGO.Engine; }

  function setScreen(name, data) {
    Game.screen = name;
    if (JOGO.UI && JOGO.UI.showScreen) {
      try { JOGO.UI.showScreen(name, data); } catch (err) { /* nunca crashar */ }
    }
  }

  function resetAiState() {
    aiPlan = null; aiIdx = 0; aiUid = null; aiTimer = 0;
  }

  Game.init = function () {
    Game.screen = 'menu';
    Game.state = null;
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    Game.party = [];
    Game.dungeonId = null;
    Game.roomIndex = 0;
    carryHp = null;
    resetAiState();
    setScreen('menu');
  };

  // navegação pré-batalha para o UI (extensão, ver cabeçalho)
  Game.goTo = function (name) {
    if (name === 'menu' || name === 'heroSelect' || name === 'dungeonSelect') {
      setScreen(name);
      return true;
    }
    return false;
  };

  function validParty(heroIds) {
    // ADENDO v2: o grupo pode ter 1 a 3 heróis (era exatamente 3)
    if (!heroIds || heroIds.length < 1 || heroIds.length > 3) return false;
    var seen = {};
    for (var i = 0; i < heroIds.length; i++) {
      var id = heroIds[i];
      if (seen[id]) return false;
      seen[id] = true;
      var found = false;
      for (var j = 0; j < JOGO.DATA.heroes.length; j++) {
        if (JOGO.DATA.heroes[j].id === id) { found = true; break; }
      }
      if (!found) return false;
    }
    return true;
  }

  function validDungeon(dungeonId) {
    for (var i = 0; i < JOGO.DATA.dungeons.length; i++) {
      if (JOGO.DATA.dungeons[i].id === dungeonId) return true;
    }
    return false;
  }

  Game.startRun = function (heroIds, dungeonId) {
    if (!validParty(heroIds) || !validDungeon(dungeonId)) return false;
    Game.party = heroIds.slice();
    Game.dungeonId = dungeonId;
    Game.roomIndex = 0;
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    carryHp = null;
    resetAiState();
    Game.state = E().createBattle(dungeonId, 0, Game.party);
    setScreen('battle');
    return true;
  };

  Game.nextRoom = function () {
    if (Game.screen !== 'roomClear' || !Game.dungeonId) return false;
    Game.roomIndex++;
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    resetAiState();
    Game.state = E().createBattle(Game.dungeonId, Game.roomIndex, Game.party);
    // regra entre salas: vivos curam 50% do HP perdido; mortos revivem com 30%
    if (carryHp) {
      for (var i = 0; i < Game.state.units.length; i++) {
        var u = Game.state.units[i];
        if (u.kind !== 'hero') continue;
        var prev = carryHp[u.defId];
        if (prev === undefined) continue;
        if (prev > 0) {
          u.hp = Math.min(u.hpMax, prev + Math.round((u.hpMax - prev) * 0.5));
        } else {
          u.hp = Math.max(1, Math.round(u.hpMax * 0.3)); // revive (decisão de design)
        }
      }
    }
    carryHp = null;
    setScreen('battle');
    return true;
  };

  Game.restart = function () {
    Game.init();
  };

  Game.isPlayerTurn = function () {
    if (!Game.state || Game.state.phase !== 'playing') return false;
    var u = E().activeUnit(Game.state);
    return !!u && u.kind === 'hero';
  };

  Game.selectSpell = function (spellId) {
    if (Game.screen !== 'battle') return;
    if (spellId === null || spellId === Game.selectedSpellId) {
      Game.selectedSpellId = null;
    } else {
      Game.selectedSpellId = spellId;
    }
  };

  Game.onTileClicked = function (x, y) {
    if (Game.screen !== 'battle' || !Game.state) return;
    if (Game.state.phase !== 'playing' || !Game.isPlayerTurn()) return;
    var u = E().activeUnit(Game.state);
    if (!u) return;

    if (Game.selectedSpellId) {
      var targets = E().castTargets(Game.state, u.uid, Game.selectedSpellId);
      for (var i = 0; i < targets.length; i++) {
        if (targets[i].x === x && targets[i].y === y) {
          if (E().cast(Game.state, u.uid, Game.selectedSpellId, x, y)) {
            Game.selectedSpellId = null;
          }
          return;
        }
      }
      return; // célula fora dos alvos: não faz nada (mantém a seleção)
    }

    if (E().unitAt(Game.state, x, y)) return; // clique em unidade: nada
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
    E().endTurn(Game.state);
  };

  Game.handleEvent = function (ev) {
    if (ev && ev.type === 'battleEnd') handleBattleOver();
  };

  // ADENDO v2: XP + saque ao vencer uma sala.
  //  - XP da sala = soma do xp dos monstros do lado INIMIGO que morreram
  //    (summons inimigos mortos contam; invocações do próprio jogador não —
  //    são side 'player'). Cada herói do grupo (vivo ou morto) recebe
  //    floor(total / tamanho do grupo).
  //  - Drops: Progress.rollDrops (1 sorteio + 1 extra na sala do chefe).
  //  - Tudo protegido por existência de JOGO.Progress (headless/testes
  //    podem rodar sem progressão); saves são automáticos no Progress.
  function computeRewards() {
    var st = Game.state;
    var xpTotal = 0;
    for (var i = 0; i < st.units.length; i++) {
      var u = st.units[i];
      if (u.side !== 'enemy' || u.alive) continue;
      var def = JOGO.DATA.monsters[u.defId];
      if (def && typeof def.xp === 'number') xpTotal += def.xp;
    }
    var partySize = Game.party.length || 1;
    var xpGanho = Math.floor(xpTotal / partySize);
    var levelUps = [];
    var drops = [];
    var P = JOGO.Progress;
    if (P && P.addXp) {
      for (var h = 0; h < Game.party.length; h++) {
        var heroId = Game.party[h];
        var gained = 0;
        try { gained = P.addXp(heroId, xpGanho); } catch (err) { gained = 0; }
        if (gained > 0) {
          levelUps.push({ heroId: heroId, novoNivel: P.state.heroes[heroId].level });
        }
      }
    }
    if (P && P.rollDrops) {
      try {
        drops = P.rollDrops(Game.dungeonId, Game.roomIndex, partySize) || [];
      } catch (err) { drops = []; }
    }
    if (P && P.save) { try { P.save(); } catch (err) { /* storage indisponível */ } }
    return { xpGanho: xpGanho, levelUps: levelUps, drops: drops };
  }

  function handleBattleOver() {
    if (!Game.state || Game.screen !== 'battle') return;
    if (Game.state.phase === 'won') {
      // registra HP dos heróis para a regra entre salas
      carryHp = {};
      for (var i = 0; i < Game.state.units.length; i++) {
        var u = Game.state.units[i];
        if (u.kind === 'hero') carryHp[u.defId] = u.alive ? u.hp : 0;
      }
      resetAiState();
      Game.selectedSpellId = null;
      var rewards = computeRewards();
      if (Game.roomIndex >= 2) setScreen('dungeonComplete', rewards);
      else setScreen('roomClear', rewards);
    } else if (Game.state.phase === 'lost') {
      resetAiState();
      Game.selectedSpellId = null;
      setScreen('defeat');
    }
  }

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
    try {
      plan = JOGO.AI && JOGO.AI.planTurn ? JOGO.AI.planTurn(Game.state, uid) : null;
    } catch (err) { plan = null; }
    if (!plan || !plan.length) plan = [{ action: 'end' }];
    return plan;
  }

  Game.update = function (dt) {
    if (Game.screen !== 'battle' || !Game.state) return;

    if (Game.state.phase !== 'playing') {
      handleBattleOver();
      return;
    }
    if (Game.isPlayerTurn()) { resetAiState(); return; }

    var u = E().activeUnit(Game.state);
    if (!u) return;
    var renderer = JOGO.Renderer;

    if (!renderer || !renderer.isBusy) {
      // headless: executa o turno inteiro da IA nesta chamada
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

    // com Renderer: ritmo de 1 ação por vez
    if (renderer.isBusy()) { aiTimer = 0; return; }
    aiTimer += (typeof dt === 'number' ? dt : 0);
    if (aiPlan && aiUid === u.uid && aiTimer < AI_ACTION_DELAY) return;

    if (!aiPlan || aiUid !== u.uid) {
      aiPlan = getPlanFor(u.uid);
      aiIdx = 0;
      aiUid = u.uid;
      aiTimer = 0;
      return; // primeira ação no próximo frame elegível
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
