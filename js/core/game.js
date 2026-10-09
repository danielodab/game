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
 *      A UI recebe `{xpGanho, xpMult, xpPorHeroi, levelUps, drops, pets,
 *      cards, stones, elementChoices}`.
 *      `xpGanho` é a XP da sala já dividida pelo grupo e ANTES do corte de
 *      nível; `xpMult`/`xpPorHeroi` mostram, herói a herói, o multiplicador de
 *      §9-D e o que de fato entrou — é com isso que a UI explica "conteúdo
 *      fácil demais para o seu nível".
 *      ADENDO v2.1: carta repetida NÃO vira mais XP (o campo `xpCartas` foi
 *      removido) — agora ela acumula na coleção e vira estrela, e quem faz
 *      essa conta é o `Progress`. As PEDRAS DE FORJA são colhidas aqui: cada
 *      monstro inimigo morto com `stoneDrop {chance, min, max}` rende pedras
 *      do PRÓPRIO elemento (`DATA.stones` dá o id da pedra daquele elemento).
 *
 * [G10] O QUE CONTA COMO "UNIDADE DO JOGADOR". `isPlayerTurn`/`isPlayerUnit`
 *       aceitam `kind:'hero'` E `kind:'fusion'` do lado 'player'. O pet
 *       (`kind:'pet'`) e as invocações continuam de fora — são do lado do
 *       jogador mas quem os joga é a IA (contrato §5). Isto vale para tudo o
 *       que depende do turno do jogador: barra de feitiços, `selectSpell`,
 *       `onTileClicked`, cronômetro, `endTurn` e a decisão de entregar (ou
 *       não) a unidade para `AI.planTurn`. O registro de PV entre salas
 *       também considera a fusão, dividindo a vida dela entre os heróis que a
 *       formaram.
 *
 * [G8] GRUPO DE 1 OU 2 HERÓIS (§9-B). `startRun` recusa 3 ou mais; com dois
 *      heróis, a fusão vira a jogada de trocar economia de ações por poder.
 *
 * [G6] ESCOLHA DE ELEMENTO. Ao fim da sala, `elementChoices` lista os heróis
 *      que chegaram ao nível 5 sem elemento. A UI vai para a tela
 *      'elementChoice' (`Game.goTo`) e chama `Game.chooseElement`; quando não
 *      resta ninguém pendente, o jogo volta sozinho à tela anterior.
 *
 * [G11] A BATALHA EM REDE (11/09, multijogador): grupo de 2 jogadores (cada um
 *       com o SEU herói) e duelo pela Rede. Lockstep: o Coop (js/core/coop.js)
 *       monta a mesma batalha nos dois clientes e só os lances de gente
 *       viajam. Aqui: `donoDe`/`ladoDaTela`/`meuLado`, a PORTA ÚNICA (toda ação
 *       local que chega ao motor vira lance, mesmo a que falha), o GANCHO DE
 *       TURNO (depois de toda chamada ao motor, `Coop.aoTurno` se o
 *       `state.turno` mudou), o relógio de PAREDE do meu turno, a batalha da
 *       ata, o duelo em sala sorteada e a recompensa POR JOGADOR (partySize da
 *       ata, XP só do meu herói). Fora de rede, `rede` é null e nada disto roda.
 *
 * [G7] ROBUSTEZ v1 preservada: nada acessa Renderer/UI/Fusion/IA sem checar
 *      existência (headless roda liso); com Renderer, a IA executa 1 ação por
 *      vez, esperando `Renderer.isBusy() === false` e 250 ms entre ações; sem
 *      Renderer, o turno inteiro da IA roda numa chamada de `update()`.
 * ==========================================================================*/

(function () {
  'use strict';
  /* O TEXTO NO IDIOMA DO JOGADOR (docs/IDIOMAS.md): a chave é o próprio português. Sem o JOGO.I18n
   * (o juiz do servidor e as provas em Node não o carregam) volta o português, com as {variáveis}. */
  function Tx(s, v) {
    var I = (typeof JOGO !== 'undefined' && JOGO) ? JOGO.I18n : null;
    if (I && I.t) return I.t(s, v);
    if (!v) return s;
    return String(s).replace(/\{([A-Za-z_]\w*)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m;
    });
  }

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
  /* A VIDA ÚNICA (14/09, ver "A VIDA DE CADA HERÓI" mais abaixo): a vida mora em JOGO.Vida e
   * não zera mais com a descida. Aqui só o gole que está no servidor e o PV com que a última
   * sala em grupo terminou (Game._carry, que a prova do motor compara nos dois clientes). */
  var bebendo = false;         // a poção que está no servidor: não sai outra até a resposta
  var carryFimRede = null;     // {dono:heroId: PV} do fim da última sala em grupo
  // A SEGURANÇA (13/09): a sala solo com bilhete do servidor — o bilhete e os lances anotados
  var ataSolo = null;          // { bilhete, lances: [] }
  var conferindoSala = false;  // a vitória está no servidor: a tela espera o recibo
  // internos do cronômetro
  var turnElapsed = 0, timerUid = null, lastTickSec = -1;
  var clockFn = null, lastClock = 0;
  // [G11] a batalha em rede: quem sou eu nela e o gancho de turno
  var rede = null;          // { tipo:'grupo'|'duelo'|'guerra', eu, lado:'A'|'B'|null, colocador }
  var ultimoTurno = null;   // o state.turno visto por último (o gancho chama Coop.aoTurno quando muda)
  var timerTurno = null, turnoIniMs = 0;   // o relógio de PAREDE do meu turno em rede
  /* A PREPARAÇÃO (21/09, pedido do dono: "quando um ou dois jogadores entram na
   * batalha e um escolhe o quadrado, a luta já inicia automaticamente. Isso não
   * pode acontecer... só quando o tempo de preparação terminar ou ele colocar
   * pronto (quando for 2 jogadores, os dois colocarem prontos)"). São 30 s,
   * iguais sozinho e em dupla. O relógio é de PAREDE e CONGELA enquanto o relé
   * está calado: quem perdeu o sinal e continuasse contando largaria o `p` dele
   * aos 30 s ao mesmo tempo que o outro lado, que já assumiu a colocação, larga
   * o dele — dois `p` no mesmo (T,k) racham a sala. */
  var prepIniMs = 0, prepVistoMs = 0;   // começo e último instante contado
  var prepPronto = false;               // eu apertei PRONTO
  var prepEle = false;                  // o parceiro apertou (voz `prep` do Coop)
  var prepEleCasa = null;               // e a casa que ele marcou
  var prepFechada = false;              // o `p` já saiu desta sala: não sai outro
  // tela para onde voltar depois de 'elementChoice' [G6]
  var returnScreen = 'menu';

  function E() { return JOGO.Engine; }
  function P() { return JOGO.Progress; }
  function C() { return JOGO.Coop || null; }
  function num(v, def) { return (typeof v === 'number' && isFinite(v)) ? v : def; }

  function setScreen(name, data) {
    Game.screen = name;
    // 11/09: de volta à praça (ou ao menu), a ficha do Mestre emprestada para a
    // batalha em grupo sai do DATA desta página (js/core/gm.js)
    if ((name === 'hub' || name === 'menu') && JOGO.GM && JOGO.GM.devolveFicha) {
      try { JOGO.GM.devolveFicha(); } catch (e0) {}
    }
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

  /* `tela` (12/09): para onde ir depois de zerar a partida. O padrão é o
   * menu (é o boot do jogo); abandonar uma descida passa 'hub', porque o
   * dono pediu que abandonar leve à PRAÇA e não ao menu — quem desistiu de
   * uma sala quer o Acampamento, não a tela de título. */
  Game.init = function (tela) {
    Game.screen = 'menu';
    Game.state = null;
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    Game.party = [];
    Game.dungeonId = null;
    Game.roomIndex = 0;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    carryFimRede = null;         // 14/09: a vida dos heróis NÃO zera aqui (é única, JOGO.Vida)
    ataSolo = null;
    ataEco = null;               // 02/10: a tentativa do Eco (quem larga fecha antes: Game.abandonar)
    salEco = null;               // 03/10: o sal que estava a caminho fica sem dono (pedeSalEco confere)
    conferindoSala = false;
    resetAiState();
    resetTimer(true);
    returnScreen = 'menu';
    rede = null; ultimoTurno = null; timerTurno = null;
    returnScreen = (tela === 'hub') ? 'hub' : 'menu';
    setScreen(tela === 'hub' ? 'hub' : 'menu');
    // [G11] a batalha em rede acaba com a volta ao menu/Acampamento
    var c = C();
    if (c && c._gameInit) { try { c._gameInit(); } catch (e) {} }
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
    // 08/09: portal FECHADO não desce — nem por atalho de teste
    if (JOGO.DATA && JOGO.DATA.portalFechado && JOGO.DATA.portalFechado(dungeonId)) return false;
    var ds = (JOGO.DATA && JOGO.DATA.dungeons) || [];
    for (var i = 0; i < ds.length; i++) if (ds[i] && ds[i].id === dungeonId) return true;
    // 03/10: o calabouço ESPECIAL (js/core/data/santuario.js — o Santuário dos Elementos) desce como os seis
    if (JOGO.DATA && JOGO.DATA.especial && JOGO.DATA.especial(dungeonId)) return true;
    // 07/10: a Câmara do Eco desce em GRUPO pela Rede (Grupo.descer(arena)) — sozinho é Game.startEco
    return !!(JOGO.DATA && JOGO.DATA.eco && dungeonId === JOGO.DATA.eco.arena && E().calabouco(dungeonId));
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
  /* A DIFICULDADE ESCOLHIDA. Chave propria no armazenamento: dificuldade nao e
   * progresso — misturar as duas faria um save corrompido levar a preferencia
   * junto, e faria a preferencia participar de qualquer migracao de save. */
  var CHAVE_DIF = 'soterra-dificuldade';
  Game.dificuldade = (function () {
    try {
      var v = window.localStorage && window.localStorage.getItem(CHAVE_DIF);
      var D = (JOGO.DATA && JOGO.DATA.dificuldades) || {};
      if (v && D[v]) return v;
    } catch (e) {}
    return (JOGO.DATA && JOGO.DATA.dificuldadePadrao) || 'normal';
  })();
  Game.setDificuldade = function (id) {
    var D = (JOGO.DATA && JOGO.DATA.dificuldades) || {};
    if (!D[id]) return false;
    Game.dificuldade = id;
    try { if (window.localStorage) window.localStorage.setItem(CHAVE_DIF, id); } catch (e) {}
    return true;
  };
  Game.difAtual = function () {
    var D = (JOGO.DATA && JOGO.DATA.dificuldades) || {};
    return D[Game.dificuldade] || D.normal || { vida: 1, dano: 1, clima: 1, xp: 1, drop: 1 };
  };

  /* CARGA SOB DEMANDA (10/09): no jogo servido, cada descida baixa os modelos
   * dela na hora de descer, atrás da tela de carga (JOGO.Bundle.segura), e
   * chama `deNovo` quando chegarem. Com tudo na mão — ou em casa, file:// —
   * devolve false e a descida segue na hora, como sempre. */
  function seguraParaModelos(pedido, deNovo) {
    var B = JOGO.Bundle;
    try { return !!(B && B.segura && B.segura(pedido, deNovo)); } catch (e) { return false; }
  }

  Game.startRun = function (heroIds, dungeonId, opts) {
    // [G11] `opts.grupo`: a descida em dupla pela Rede — 1 herói (o meu), nada
    // de Poço nem de Mestre; os modelos do herói do parceiro vêm junto
    var emGrupo = !!(opts && opts.grupo);
    if (emGrupo && !podeDescerEmGrupo(heroIds, dungeonId)) return false;
    // 07/10: o Poço em grupo entra por aqui (Grupo.descer('poco')) — o calabouço sintético tem de existir
    if (dungeonId === 'poco' && (!JOGO.Poco || !JOGO.Poco.preparar(2))) return false;
    if (!validParty(heroIds) || !validDungeon(dungeonId)) return false;
    var pedidoModelos = { dungeonId: dungeonId, party: emGrupo ? comParceiro(heroIds) : heroIds,
                          duplas: emGrupo ? duplasDaDescida(heroIds) : null, sala: 0 };
    if (!(opts && opts.direto && !emGrupo) && seguraParaModelos(pedidoModelos,
        function () { Game.startRun(heroIds, dungeonId, opts); })) return true;
    Game.party = heroIds.slice();
    Game.dungeonId = dungeonId;
    Game.roomIndex = 0;
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    carryFimRede = null;
    resetAiState();
    resetTimer(true);
    rede = emGrupo ? { tipo: 'grupo', eu: meuIdRede(), lado: null, colocador: false } : null;
    ultimoTurno = null; timerTurno = null;
    // `opts.direto` é o caminho antigo (bancadas de teste): batalha na hora,
    // sem antessala nem escolha de posição
    if (opts && opts.direto && !emGrupo) {
      Game.state = E().createBattle(dungeonId, 0, partyPayload(), { dificuldade: Game.dificuldade });
      setScreen('battle');
      return true;
    }
    /* A ANTESSALA (03/09, pedido do dono): "todo fim de batalha deve abrir em
     * um mapa da sala; os usuários que estão no calabouço naquela sala se
     * encontram naquele mapa — podem fazer trocas, seguir para a batalha ou
     * sair". A descida começa nela; a batalha só nasce em entrarNaSala. */
    Game.state = null;
    ataSolo = null;
    setScreen('antessala', Game.salaInfo());
    if (emGrupo) avisaAntessala();       // [G11] o parceiro manda o `pronto`
    preparaBilhete();                    // a semente da sala vem do servidor (13/09), já pedida
    return true;
  };

  /* O BILHETE DA SALA (13/09, docs/SEGURANCA.md). Com sessão do site, o
   * servidor manda na economia: a sala nasce da semente que ELE sorteou e,
   * no fim, ele refaz a batalha com os lances e paga. Vale na descida solo
   * dos calabouços e do Poço (o andar sai da semente); a descida em grupo tem
   * a semente da ata (coop.js). */
  function autoridadeNaSala() {
    var A = JOGO.Autoridade;
    return !rede && !!Game.dungeonId && !!(A && A.ligada && A.ligada());
  }
  function pedidoDaSala() {
    return { dungeonId: Game.dungeonId, roomIndex: Game.roomIndex,
             dificuldade: Game.dificuldade || 'normal', herois: Game.party.slice(),
             afixo: afixoProposto(Game.dungeonId),       // 07/10: o que esta página acha; o servidor decide
             escuro: Game.podeEscuro() && Game.escuro }; // 07/10: o caminho escuro, pedido na porta
  }
  /* O CAMINHO ESCURO (07/10): da segunda sala da descida em diante, o jogador pode pedir na porta um afixo
   * sorteado (+25% de XP e saque) — a escolha entre a sala de sempre e a sala que muda. Com sessão o servidor
   * sorteia e guarda no bilhete; sem servidor a proposta sorteia aqui, pela sala e pelo dia. No Calabouço do
   * Dia não se oferece (o do dia já manda). A escolha é de cada porta: entrar na sala a apaga. */
  Game.escuro = false;
  Game.podeEscuro = function () {
    var Af = JOGO.Afixos, Dd = JOGO.Diario;
    if (!Af || !Af.LISTA || !Af.LISTA.length || !Game.dungeonId || !(Game.roomIndex >= 1)) return false;
    // o Poço tem os perigos dele. Em grupo (07/10 à noite) a porta é de quem lidera: a escolha vai no
    // abrir da sala do grupo (coop.js, Aut.abreGrupo `escuro`) e o afixo que o servidor sorteou volta na ata
    if (Game.dungeonId === 'poco') return false;
    try { if (Dd && Dd.ehHoje && Dd.ehHoje(Game.dungeonId)) return false; } catch (e) {}
    return true;
  };
  Game.escuroDaSala = function () { return !!(Game.podeEscuro() && Game.escuro); };
  Game.defineEscuro = function (liga) { Game.escuro = !!liga; return Game.escuroDaSala(); };
  function afixoEscuro(dungeonId) {
    var Af = JOGO.Afixos;
    if (!Af || !Af.LISTA || !Af.LISTA.length) return null;
    var txt = 'escuro:' + dungeonId + ':' + Game.roomIndex + ':' + Af.chaveDoDia(Date.now());
    var h = 2166136261 >>> 0;
    for (var i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Af.LISTA[(h >>> 0) % Af.LISTA.length].id;
  }
  /* O AFIXO DA SALA (07/10, js/core/afixos.js): no Calabouço do Dia a sala abre com o afixo do dia. Esta é
   * a PROPOSTA da página (o relógio do servidor, pela Agenda, quando medido); com sessão o servidor decide e
   * devolve no bilhete (o que vale é o de lá); sem servidor, em casa, a proposta é a regra. */
  function afixoProposto(dungeonId) {
    var Af = JOGO.Afixos, Dd = JOGO.Diario;
    if (!Af || !Af.doDia || !Dd || !Dd.ehHoje) return null;
    var ts = Date.now();
    try { if (JOGO.Agenda && JOGO.Agenda.agora) ts = JOGO.Agenda.agora(); } catch (e0) { ts = Date.now(); }
    try { if (Dd.ehHoje(dungeonId || Game.dungeonId, ts)) return Af.doDia(ts); } catch (e) { return null; }
    // 07/10: o caminho escuro sem servidor — a proposta é a regra (com sessão o servidor sorteia o dele)
    if (Game.escuroDaSala() && (dungeonId || Game.dungeonId) === Game.dungeonId) return afixoEscuro(Game.dungeonId);
    return null;
  }
  Game.afixoDaSala = afixoProposto;      // a HUD (o painel do portal, a porta) e o Coop (a ata) perguntam
  function preparaBilhete() {
    /* 13/09: com a vida subindo o bilhete NÃO é pedido de antemão — o servidor soma a vida
     * que voltou até o instante em que o bilhete abre, e um bilhete pedido na chegada à
     * antessala levaria a vida de quando se chegou. 14/09: a vida é única, então a regra
     * vale em TODA sala: só com os heróis todos cheios o bilhete sai já; senão, no "Entrar
     * na batalha". */
    /* 15/09, A LUTA LARGADA: nem com os heróis cheios o bilhete sai mais de antemão. O servidor LARGA a luta que
     * a conta deixou aberta quando ela abre outra (os heróis dela a 0: servidor/salas.py); um bilhete pedido na
     * chegada à antessala e nunca usado — a aba fechada ali, o jogo aberto depois em outro aparelho — seria uma
     * luta "largada" sem ter começado. Agora bilhete aberto é "Entrar na batalha" apertado (entrarNaSala). */
  }

  /* O POÇO SEM FUNDO (25/08): a torre infinita. JOGO.Poco monta o calabouço
   * sintético e as salas (sempre uma à frente); daqui é um startRun normal
   * no id 'poco', com a escalada aplicada no estado logo depois. */
  Game.startPoco = function (heroIds) {
    // o caminho SOLO. Em grupo a descida ao Poço é Grupo.descer('poco') → startRun com `grupo` (07/10):
    // o andar sai da semente da ata, e não do Math.random daqui
    var cp = C();
    try { if (cp && cp.emGrupo && cp.emGrupo()) return false; } catch (e) {}
    if (!JOGO.Poco || !JOGO.Poco.preparar(2)) return false;
    if (!Game.startRun(heroIds, JOGO.Poco.ID)) return false;
    // 03/09: com a antessala no meio o estado ainda não existe aqui — a
    // escalada do andar acontece ao ENTRAR na sala (entrarNaSala)
    if (Game.state) JOGO.Poco.escalaEstado(Game.state, 1);
    return true;
  };

  /* O DUELO DE TREINO: duas duplas da MESMA conta, no mesmo teclado. As
   * escolhas às cegas são da ficha; aqui só se monta a arena. */
  Game.startDuel = function (duplaA, duplaB) {
    if (!duplaA || !duplaA.length || !duplaB || !duplaB.length) return false;
    if (seguraParaModelos({ duplas: [duplaA, duplaB], duelo: true },
        function () { Game.startDuel(duplaA, duplaB); })) return true;
    Game.party = duplaA.slice();
    rede = null; ultimoTurno = null; timerTurno = null;   // o treino é no mesmo teclado
    Game.dungeonId = null;               // duelo não pertence a calabouço
    Game.roomIndex = 0;
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    /* 14/09: o TREINO não usa nem gasta a vida única — os dois lados são a mesma conta, no
     * mesmo teclado (o mesmo herói pode estar dos dois lados), e é treino: nasce cheio e o
     * fim não grava nada (handleBattleOver, o ramo do pvp sem rede) */
    resetAiState();
    resetTimer(true);
    var prog = P();
    function payloadDe(ids) {
      if (prog && prog.battleParty) {
        try {
          var pl = prog.battleParty(ids);
          if (pl && pl.length) return pl;
        } catch (e) {}
      }
      return ids.slice();
    }
    Game.state = E().createDuel(payloadDe(duplaA), payloadDe(duplaB), {});
    Game._duplas = { a: duplaA.slice(), b: duplaB.slice() };
    setScreen('battle');
    return true;
  };

  /* O ECO PRIMORDIAL (02/10) — o chefe supremo da semana (js/core/data/eco.js; a tentativa, o placar
   * e a semana moram em servidor/supremo.py). A tentativa é uma batalha SOLO na Câmara do Eco:
   *   - com sessão do site (Autoridade ligada) a semente vem do servidor (POST /api/supremo/abrir, 3 por
   *     dia), os lances são anotados como na sala solo (anotaSolo) e o fechar manda tudo para o juiz
   *     refazer — o placar que vale é o dele, nunca o número desta tela;
   *   - sem sessão (em casa, file://) é TREINO: semente daqui, e a tela diz que não conta no placar;
   *   - NÃO usa nem gasta a vida única: todo herói entra cheio e o fim não grava vida. A tentativa é
   *     placar, e um herói ferido de outra luta desigualaria a disputa — o juiz refaz do mesmo jeito;
   *   - dificuldade sempre 'normal' (a mesma régua para todo mundo no ranking), sem desafio de sala;
   *   - só a dupla da própria conta (a sala em grupo pela Rede fica para depois: a semente e o placar
   *     de dois jogadores pedem uma ata própria no servidor);
   *   - 03/10: a semente decide só a colocação e a rodada 1. Na virada de cada rodada o motor PARA
   *     (Engine.ecoEsperaSal) e o jogo pede o sal dela ao servidor com o caminho dos lances até ali
   *     (pedeSalEco); sem rede a tentativa espera e o pedido sai de novo; o treino usa um sal daqui.
   * O fim (Eco derrubado, grupo caído ou a 13ª rodada) vai para a tela 'ecoFim': o dano daqui na hora
   * e, quando o servidor responde, o dano conferido, a posição e as tentativas que restam. */
  var ataEco = null;           // { tentativa, treino, restantes } da tentativa em curso
  var fimEco = null;           // o que a tela 'ecoFim' mostra
  var abrindoEco = false;      // o pedido da semente está no servidor: não sai outro
  var salEco = null;           // 03/10: { rodada, pedindo, dormindo, semRede, tentativas } do sal pedido agora
  Game.SAL_PRAZO_MS = 10000;   // o pedido do sal sem resposta nenhuma em 10 s conta como sem rede (pedeSalEco)
  Game.ecoTentativa = function () {
    return ataEco ? { tentativa: ataEco.tentativa, treino: !!ataEco.treino, restantes: ataEco.restantes, grupo: !!ataEco.grupo } : null;
  };
  Game.ecoFim = function () { return fimEco; };
  Game.ecoAbrindo = function () { return abrindoEco; };
  function ehMestre(hid) {
    var prog = P(), h = null;
    try { h = prog && prog.hero ? prog.hero(hid) : null; } catch (e) { h = null; }
    return !!(h && (h.classId === 'gm' || hid === 'gm'));
  }
  /* Devolve true (a batalha nasceu, ou os modelos estão descendo e ela nasce sozinha), 'esperando' (a
   * semente está no servidor; `aoAbrir(r)` roda com a resposta) ou false (grupo inválido, em grupo pela
   * Rede, o Mestre, sem o dado do Eco). */
  Game.startEco = function (heroIds, aoAbrir) {
    var cfg = JOGO.DATA && JOGO.DATA.eco;
    if (!cfg || !cfg.arena || !validParty(heroIds)) return false;
    var cp = C();
    try { if (cp && cp.emGrupo && cp.emGrupo()) return false; } catch (e) {}
    // (08/10 à noite: o Mestre do Fundo passou a enfrentar o Eco — o dono quer testar; a conta da equipe
    // segue fora do ranking, no servidor)
    if (abrindoEco) return 'esperando';
    var A = JOGO.Autoridade;
    var oficial = !!(A && A.ligada && A.ligada() && A.abreEco);
    function abre() {
      if (!oficial) {
        // TREINO: a semente daqui — nada vai ao servidor
        var sem = (Date.now() ^ Math.floor(Math.random() * 2147483647)) >>> 0;
        comecaEco(heroIds, sem, { treino: true });
        if (aoAbrir) { try { aoAbrir({ ok: true, treino: true }); } catch (e1) {} }
        return;
      }
      abrindoEco = true;
      A.abreEco({ herois: heroIds.slice() }).then(function (r) {
        abrindoEco = false;
        if (r && r.ok && typeof r.semente === 'number' && typeof r.tentativa === 'string') {
          comecaEco(heroIds, r.semente, { tentativa: r.tentativa, restantes: r.restantes });
        }
        if (aoAbrir) { try { aoAbrir(r); } catch (e2) {} }
      });
    }
    // os modelos da Câmara (o Eco e os Ecos Menores) descem antes, atrás da tela de carga
    if (seguraParaModelos({ dungeonId: cfg.arena, party: heroIds, sala: 0 }, abre)) return true;
    abre();
    return oficial ? 'esperando' : true;
  };
  function comecaEco(heroIds, semente, info) {
    var cfg = JOGO.DATA.eco;
    Game.party = heroIds.slice();
    Game.dungeonId = cfg.arena;
    Game.roomIndex = 0;
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    carryFimRede = null;
    resetAiState();
    resetTimer(true);
    rede = null; ultimoTurno = null; timerTurno = null;
    // os lances vão no formato da sala solo; sem `bilhete` não há registro de luta aberta (a vida não entra)
    ataSolo = info.treino ? null : { bilhete: null, lances: [], eco: info.tentativa };
    ataEco = { tentativa: info.tentativa || null, treino: !!info.treino, restantes: info.restantes };
    fimEco = null;
    salEco = null;
    Game.state = E().createBattle(cfg.arena, 0, partyPayload(),
      { seed: semente, dificuldade: 'normal', escolhePosicao: true });
    zeraPrep();                                    // os 30 s da preparação, como em toda sala
    setScreen('battle');
    return true;
  }
  /* O FIM DA TENTATIVA: a tela na hora com o dano daqui; o fechar no servidor em seguida (com
   * retentativa sem rede, como a sala). `largou` = o jogador saiu no meio: os lances até ali valem. */
  function fechaEco(largou) {
    var eco = ataEco, ata = ataSolo, st = Game.state;
    ataEco = null;
    ataSolo = null;
    salEco = null;               // o sal que ainda vinha não serve a mais nada (pedeSalEco confere a tentativa)
    if (!eco) return null;
    var placar = null;
    try { placar = st ? E().ecoPlacar(st) : null; } catch (e) { placar = null; }
    fimEco = { placar: placar, treino: eco.treino, conferindo: !eco.treino && !!ata, oficial: null, erro: null,
               fase: st ? st.phase : null, largou: !!largou, restantes: eco.restantes };
    /* EM DUPLA (07/10): o fechar é o da sala em grupo — o gid e o registro do lockstep (os lances dos dois) pelo
     * POST /api/grupo/fechar; o servidor vê que o gid é de uma dupla do Eco e refaz a Câmara (grupo.py →
     * supremo.py). A resposta tem o placar conferido, como a solo. Quem larga no meio manda `largou`: só a marca. */
    if (!eco.treino && eco.grupo && JOGO.Autoridade && JOGO.Autoridade.fechaGrupo) {
      var cg = C(), regG = null;
      try { regG = (cg && cg.logServidor) ? cg.logServidor() : null; } catch (eG) { regG = null; }
      var gidG = regG && regG.ata && regG.ata.gid;
      if (!gidG) { fimEco.conferindo = false; fimEco.erro = Tx('a sala do grupo não tem registro no servidor'); return fimEco; }
      fimEco.conferindo = true;
      fimEco.dupla = true;
      var hashG = null;
      try { hashG = largou ? null : E().hash(st); } catch (eH) { hashG = null; }
      var meuG = fimEco;
      try { if (JOGO.Autoridade.anotaLuta) JOGO.Autoridade.anotaLuta(gidG, regG.lances, !largou); } catch (eA2) {}
      JOGO.Autoridade.fechaGrupo({ gid: gidG, lances: regG.lances, hashFinal: hashG, fotografada: !!regG.fotografada,
                                   autoridade: !!regG.autoridade, largou: !!largou })
        .then(function (r) {
          meuG.conferindo = false;
          if (r && r.ok && typeof r.pontos === 'number') meuG.oficial = r;
          else if (r && r.ok && r.fase === 'largou') meuG.erro = Tx('a tentativa segue com {a}: o placar sai quando ela fechar a dela', { a: Tx('o parceiro') });
          else meuG.erro = (r && r.erro) || Tx('o servidor não conferiu a tentativa');
          if (Game.screen === 'ecoFim' && fimEco === meuG) setScreen('ecoFim', meuG);
        });
      return fimEco;
    }
    if (!eco.treino && ata && JOGO.Autoridade && JOGO.Autoridade.fechaEco) {
      var hashFinal = null;
      try { hashFinal = largou ? null : E().hash(st); } catch (e2) { hashFinal = null; }
      var meu = fimEco;
      var corpoEco = { tentativa: eco.tentativa, lances: ata.lances, hashFinal: hashFinal };
      // 03/10: o registro da luta aberta guarda o fim — a aba que fechar antes da resposta reenvia este corpo
      try { if (JOGO.Autoridade.anotaLuta) JOGO.Autoridade.anotaLuta(eco.tentativa, ata.lances, !largou, corpoEco); } catch (eA) {}
      JOGO.Autoridade.fechaEco(corpoEco)
        .then(function (r) {
          meu.conferindo = false;
          if (r && r.ok) meu.oficial = r;
          else meu.erro = (r && r.erro) || Tx('o servidor não conferiu a tentativa');
          if (Game.screen === 'ecoFim' && fimEco === meu) setScreen('ecoFim', meu);
        });
    }
    return fimEco;
  }
  Game._fechaEco = fechaEco;                     // provas

  /* O SAL DA RODADA (03/10, o dono: "dificulte" o ensaio da tentativa fora do jogo; engine.js, "O SORTEIO
   * RODADA A RODADA"; docs/SEGURANCA.md §4.8). Na virada, o motor para e a vez é de ninguém até o sal entrar.
   *   - TENTATIVA OFICIAL: o caminho (Engine.ecoCaminho dos lances anotados até aqui) vai ao servidor
   *     (Autoridade.salEco) e o sal que volta entra como lance {a:'r', r, s} — o juiz refaz com ele.
   *   - SEM REDE: a tentativa ESPERA (nada anda sem o sal; a barra diz "sem resposta") e o pedido sai de novo a
   *     cada Autoridade.RETENTA_MS. O mesmo caminho recebe o mesmo sal: a resposta perdida não estraga nada.
   *   - RECUSA DE VEZ (a tentativa venceu, a semana fechou, outro caminho já travado): a tentativa acaba
   *     ali e fecha com os lances até a rodada que valeu — a largada conta até onde foi, como sempre.
   *   - TREINO (sem servidor): a mesma parada com um sal daqui, para o treino ser o mesmo jogo; não pontua. */
  Game.ecoSalEstado = function () {
    if (!Game.state || !Game.state.eco) return null;
    var r = E().ecoEsperaSal ? E().ecoEsperaSal(Game.state) : 0;
    if (!r) return null;
    return { rodada: r, treino: !ataEco || !!ataEco.treino, semRede: !!(salEco && salEco.rodada === r && salEco.semRede),
             tentativas: (salEco && salEco.rodada === r && salEco.tentativas) || 0 };
  };
  function pedeSalEco() {
    var st = Game.state, eng = E();
    var r = (st && eng.ecoEsperaSal) ? eng.ecoEsperaSal(st) : 0;
    if (!r) return;
    if (salEco && salEco.rodada === r && (salEco.pedindo || salEco.dormindo)) return;
    // treino (ou uma Câmara sem tentativa nenhuma, como nas bancadas): o sal daqui, sem servidor e sem placar
    var emDupla = !!(ataEco && ataEco.grupo && rede);
    if (!ataEco || ataEco.treino || (!ataSolo && !emDupla)) {
      aplicaSalEco(r, Math.floor(Math.random() * (eng.SAL_MAX || 0x7fffffff)));
      return;
    }
    var A = JOGO.Autoridade;
    if (!A || !A.salEco) { encerraEcoSemSal({ erro: Tx('este jogo não sabe pedir o sorteio da rodada') }); return; }
    var tent = ataEco.tentativa;
    var antes = (salEco && salEco.rodada === r) ? salEco : null;
    var pedido = { rodada: r, pedindo: true, dormindo: false, semRede: !!(antes && antes.semRede),
                   tentativas: (antes ? antes.tentativas : 0) + 1 };
    salEco = pedido;
    // o caminho dos lances ATÉ AQUI: o juiz recalcula o mesmo, com o lance do sal logo depois deles
    // (07/10: em dupla, o registro do lockstep — os lances dos dois e as marcas, como o Coop os manda ao servidor)
    var caminho = eng.ecoCaminho(emDupla ? lancesDaDupla() : ataSolo.lances);
    /* O PEDIDO PENDURADO (revisão de 03/10). O fetch não tem prazo: a conexão que morreu calada (o celular que
     * trocou de antena, o túnel, o Wi-Fi que caiu sem avisar) deixa o pedido sem resposta e sem erro por minutos,
     * e a rodada ficava parada dizendo "vem do servidor…" sem pedir de novo — provado em tests/eco_sal_cliente.js.
     * Passado Game.SAL_PRAZO_MS, o pedido conta como sem rede (a barra diz) e o próximo quadro pede outro: o MESMO
     * caminho recebe o MESMO sal, então o pedido em dobro não estraga nada no servidor. */
    setTimeout(function () {
      if (salEco === pedido && pedido.pedindo) { pedido.pedindo = false; pedido.semRede = true; }
    }, Game.SAL_PRAZO_MS || 10000);
    A.salEco({ tentativa: tent, rodada: r, caminho: caminho }).then(function (resp) {
      // a tentativa acabou (ou outra começou) enquanto o pedido viajava: a resposta não serve mais
      if (!ataEco || ataEco.tentativa !== tent || Game.state !== st) return;
      // o sal vale mesmo vindo do pedido que passou do prazo (os lances não mudam na espera: o caminho é o
      // mesmo), desde que a rodada dele ainda espere — o segundo sal da mesma rodada não entra
      if (resp && resp.ok && typeof resp.sal === 'number') {
        if (eng.ecoEsperaSal(st) !== r) return;
        salEco = null;
        aplicaSalEco(r, resp.sal);
        return;
      }
      if (salEco !== pedido) return;      // a falha de um pedido que outro já substituiu não decide nada
      if (resp && resp.foraDoAr) {
        pedido.pedindo = false;
        pedido.dormindo = true;
        pedido.semRede = true;
        setTimeout(function () { if (salEco === pedido) pedido.dormindo = false; }, A.RETENTA_MS || 4000);
        return;
      }
      salEco = null;
      encerraEcoSemSal(resp);
    });
  }
  function aplicaSalEco(r, sal) {
    // 07/10: em dupla o sal é um LANCE do lockstep — aplicado aqui e mandado ao outro (Coop.registra), e o juiz
    // o refaz na mesma posição do registro dos dois
    if (rede && rede.tipo === 'grupo') {
      var l = { a: 'r', r: r, s: sal, T: Game.state.turno || 0 };
      var okR = executa(l);
      var cR = C();
      if (cR && cR.registra) { try { cR.registra(l, okR); } catch (e) {} }
      posMotor();
      if (Game.state && Game.state.phase !== 'playing' && !travadoRede()) handleBattleOver();
      return;
    }
    var ok = !!E().ecoSal(Game.state, r, sal);
    anotaSolo({ a: 'r', r: r, s: sal, ok: ok });
    if (Game.state.phase !== 'playing') handleBattleOver();
  }
  function lancesDaDupla() {
    var c = C(), reg = null;
    try { reg = (c && c.logServidor) ? c.logServidor() : null; } catch (e) { reg = null; }
    return (reg && reg.lances) ? reg.lances : [];
  }
  function encerraEcoSemSal(resp) {
    var rodada = (Game.state && E().ecoEsperaSal) ? E().ecoEsperaSal(Game.state) : 0;
    resetAiState();
    resetTimer(true);
    Game.selectedSpellId = null;
    Game.mustEndTurn = false;
    Game.pendingFusion = null;
    var fim = fechaEco(true);
    if (!fim) return;
    fim.parouNaRodada = rodada || null;
    fim.semSal = (resp && resp.erro) || Tx('o servidor não deu o sorteio da rodada');
    setScreen('ecoFim', fim);
  }
  Game._pedeSalEco = pedeSalEco;                 // provas

  Game.nextRoom = function () {
    if (Game.screen !== 'roomClear' || !Game.dungeonId) return false;
    // [G11] em grupo o líder libera a sala seguinte (manda `proxima`) e o
    // parceiro só segue depois dela; se a descida acabou, ninguém segue
    var emGrupo = !!(rede && rede.tipo === 'grupo');
    if (emGrupo) {
      var cg = C();
      if (!cg || !cg._liberaNextRoom || !cg._liberaNextRoom()) return false;
    }
    if (seguraParaModelos({ dungeonId: Game.dungeonId, party: emGrupo ? comParceiro(Game.party) : Game.party,
                           duplas: emGrupo ? duplasDaDescida(Game.party) : null,
                           sala: Game.roomIndex + 1 },
        function () { Game.nextRoom(); })) return true;
    Game.roomIndex++;
    // O POÇO: a sala seguinte nasce ANTES de o pé chegar nela
    if (Game.dungeonId === 'poco' && JOGO.Poco) JOGO.Poco.preparar(Game.roomIndex + 2);
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    resetAiState();
    resetTimer(true);
    // 03/09: a sala seguinte abre na ANTESSALA; o PV carregado espera lá
    Game.state = null;
    ataSolo = null;
    setScreen('antessala', Game.salaInfo());
    if (emGrupo) avisaAntessala();
    preparaBilhete();
    return true;
  };

  /* ENTRAR NA SALA (03/09): da antessala para a batalha — que nasce em
   * `placing`, com as quatro casas para o jogador escolher onde o principal
   * nasce. O PV carregado da sala anterior entra aqui. */
  Game.entrarNaSala = function () {
    if (Game.screen !== 'antessala' || !Game.dungeonId) return false;
    // 13/09: herói a 0 PV não entra — espera a vida voltar ou bebe uma poção (a HUD diz quanto falta).
    // 14/09: vale em TODA sala, a primeira da descida também (a vida é única)
    if (Game.esperaVida()) return false;
    // [G11] em grupo quem abre a porta é o líder, pela ata (Coop.entrar): a
    // batalha dele nasce no `dentro` do parceiro, com a mesma semente
    if (rede && rede.tipo === 'grupo') {
      var ce = C();
      try { return !!(ce && ce.entrar && ce.entrar()); } catch (e) { return false; }
    }
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    resetAiState();
    resetTimer(true);
    // A SEGURANÇA (13/09): com sessão do site a sala nasce da SEMENTE do servidor.
    // Sem o bilhete pronto (a dificuldade mudou na porta, ou a rede demorou), pede
    // e entra sozinha quando ele chegar — 'esperando' é verdadeiro: a HUD não reclama
    var bil = null;
    // 14/09: a vida de AGORA de cada herói (a única, JOGO.Vida); null = todos cheios
    var carryPorta = vidaCarrySolo();
    if (autoridadeNaSala()) {
      var pedido = pedidoDaSala();
      bil = JOGO.Autoridade.tomaBilhete(pedido);
      if (!bil) {
        JOGO.Autoridade.prepara(pedido, function () { if (Game.screen === 'antessala') Game.entrarNaSala(); });
        return 'esperando';
      }
      // o PV que o SERVIDOR somou ao abrir o bilhete: é com ele que a sala se refaz igual
      // lá (a vida daqui só mostra; o relógio que conta é o dele)
      carryPorta = bil.carry || null;
      // o andar do Poço sai da semente do bilhete: a mesma sala que o servidor refaz
      if (Game.dungeonId === 'poco' && JOGO.Poco && JOGO.Poco.salaSemeada) {
        JOGO.Poco.poeSala(Game.roomIndex + 1, JOGO.Poco.salaSemeada(Game.roomIndex + 1, bil.semente));
      }
    }
    ataSolo = bil ? { bilhete: bil.bilhete, lances: [] } : null;
    // 07/10: o afixo é o do BILHETE (o servidor decidiu); sem bilhete, a proposta da página
    var afixoSala = bil ? (bil.afixo || null) : afixoProposto(Game.dungeonId);
    Game.escuro = false;                 // 07/10: o caminho escuro é de cada porta — a próxima pergunta de novo
    Game.state = E().createBattle(Game.dungeonId, Game.roomIndex, partyPayload(),
      bil ? { seed: bil.semente, dificuldade: Game.dificuldade, escolhePosicao: true, afixo: afixoSala }
          : { dificuldade: Game.dificuldade, escolhePosicao: true, afixo: afixoSala });
    if (Game.dungeonId === 'poco' && JOGO.Poco) {
      JOGO.Poco.escalaEstado(Game.state, Game.roomIndex + 1);
    }
    // 13/09: a vida da porta entra como está (era "vivos curam 50%, mortos voltam com 30%")
    aplicaCarry(Game.state, carryPorta, false);
    zeraPrep();                                    // 21/09: 30 s limpos nesta sala
    setScreen('battle');
    return true;
  };

  /* SAIR DO CALABOUÇO: "depois terá que começar do zero" — a descida se
   * perde e o jogo volta à PRAÇA (12/09: era o menu, e o dono corrigiu —
   * "quando eu abandonar partida deve ir para a praça e não para o menu").
   * Vale da antessala E da batalha: desistir no meio da sala é a mesma
   * desistência. */
  Game.abandonar = function () {
    if (Game.screen !== 'antessala' && Game.screen !== 'battle') return false;
    // 02/10: a tentativa do Eco largada no meio fecha com os lances até aqui (o dano feito vale)
    if (ataEco) fechaEco(true);
    Game.init('hub');
    // 15/09: a luta largada no meio fecha já no servidor, com os lances até aqui (a vida do ponto em que parou)
    try {
      var A = JOGO.Autoridade;
      if (A && A.fechaPendente && A.ligada && A.ligada()) A.fechaPendente();
    } catch (e) {}
    return true;
  };

  /* A DESCIDA QUE VIRA SÓ MINHA (06/10; o dono: "se um dos membros do grupo volta ao acampamento, os outros
   * voltam também.. essa decisão deve ser individual"). O parceiro voltou ao acampamento (ou saiu do grupo) FORA
   * de uma batalha: eu fico onde estou — a antessala, a recompensa — e a descida segue só com os MEUS heróis, pelo
   * caminho de quem desce sozinho. Não há regra nova: `Game.party` já são só os meus (a ata é que juntava os do
   * parceiro), a porta pede o bilhete da sala ao servidor (ele abre qualquer sala do calabouço para os heróis da
   * conta, com a vida de agora — servidor/salas.py, _sala_abrir) e o juiz refaz a batalha solo de sempre. Na
   * batalha em curso não vale (lá quem sai morre e o grupo se desfaz no fim da sala: Coop.sairDaBatalha). O Coop
   * solta o que chamava pelo parceiro e fecha, sem lance, a sala em grupo que já estivesse aberta no servidor. */
  Game.segueSozinho = function () {
    if (!rede || rede.tipo !== 'grupo' || !Game.dungeonId) return false;
    if (Game.screen !== 'antessala' && Game.screen !== 'roomClear' && Game.screen !== 'elementChoice') return false;
    rede = null; ultimoTurno = null; timerTurno = null;
    carryFimRede = null;
    ataSolo = null;
    var c = C();
    if (c && c.soltaDescida) { try { c.soltaDescida(); } catch (e) {} }
    return true;
  };

  /* QUEM CAI VOLTA PARA A LUTA (08/10 à noite; o dono: "um personagem caiu na luta e quando voltou, voltou na
   * praça e bugou na luta permanecendo lá... caso caia em qualquer conexão ele deve ficar na batalha"). A
   * queda na MESMA aba já voltava pela foto de resgate; a aba recarregada (ou o aplicativo reaberto) perdia
   * tudo: o estado do grupo e do Coop vivem na memória. Agora o grupo.js guarda a sessão do grupo por conta
   * (gid, chave, o par, os meus heróis, a descida e a ATA da sala em curso) e, ao entrar na praça de novo,
   * retoma: esta função refaz a descida de grupo a partir da praça — os modelos, a antessala da sala da ata,
   * a batalha nascida da MESMA ata (o mesmo estado inicial, os mesmos uids) — e o Coop pede a foto de resgate
   * ao parceiro, que devolve os corpos onde estiverem. Sem ata (a recarga foi fora da batalha), a descida
   * refeita para na antessala da sala 0 e o Coop pergunta ao parceiro onde o time está (retomaNaAntessala).
   * `pronto` é chamado quando a tela existe (os modelos podem segurar um instante). Da praça, só. */
  Game.retomaDescida = function (heroIds, dungeonId, ata, dif, pronto) {
    if (Game.screen !== 'hub' && Game.screen !== 'menu') return false;
    var ids = (Object.prototype.toString.call(heroIds) === '[object Array]') ? heroIds.slice(0, 2) : [];
    if (!validParty(ids) || !validDungeon(dungeonId)) return false;
    if (ata && (ata.dungeonId !== dungeonId || typeof ata.roomIndex !== 'number' || ata.roomIndex < 0 ||
                Object.prototype.toString.call(ata.party) !== '[object Array]')) return false;
    var sala = ata ? ata.roomIndex : 0;
    if (dungeonId === 'poco' && (!JOGO.Poco || !JOGO.Poco.preparar(sala + 2))) return false;
    if (seguraParaModelos({ dungeonId: dungeonId, party: comParceiro(ids), duplas: duplasDaDescida(ids), sala: sala },
        function () { Game.retomaDescida(heroIds, dungeonId, ata, dif, pronto); })) return true;
    Game.party = ids.slice();
    Game.dungeonId = dungeonId;
    Game.roomIndex = sala;
    Game.dificuldade = (dif === 'facil' || dif === 'normal' || dif === 'dificil') ? dif : ((ata && ata.dificuldade) || Game.dificuldade || 'normal');
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    carryFimRede = null;
    ataSolo = null;
    resetAiState();
    resetTimer(true);
    rede = { tipo: 'grupo', eu: meuIdRede(), lado: null, colocador: false };
    ultimoTurno = null; timerTurno = null;
    Game.state = null;
    setScreen('antessala', Game.salaInfo());
    avisaAntessala();
    if (ata && !Game._criaDaAta(ata)) { Game.init('hub'); return false; }
    if (pronto) { try { pronto(); } catch (e) {} }
    return true;
  };
  /* ...e a sala seguinte que o time já concluiu (o dono: "caso esteja em calabouço ele volta para a próxima sala
   * que seu time concluiu... ele caiu na sala 1, aí quando voltou meu time já havia entrado na luta da sala dois,
   * ele pode continuar na dois e reencontrar na sala 3"): o parceiro disse (a voz `aqui`) que está na ANTESSALA
   * da sala N; quem retoma larga a batalha refeita (ou a antessala em que parou) e vai para a antessala dessa
   * sala, de onde manda o `pronto` de sempre — e a ata do parceiro abre a batalha para os dois. */
  /* ...e a BATALHA em que o time está (quem ficou mandou a ata dela com `retoma`): a batalha refeita (ou a antessala
   * em que parei) dá lugar à da ata — nascida igual nos dois motores — e o Coop pede a foto dela. `pronto` é
   * chamado quando a tela existe. */
  Game.retomaBatalhaDaAta = function (ata, pronto) {
    if (!rede || rede.tipo !== 'grupo' || !ata || !Game.dungeonId || ata.dungeonId !== Game.dungeonId) return false;
    if (Game.screen !== 'battle' && Game.screen !== 'antessala' && Game.screen !== 'roomClear') return false;
    if (typeof ata.roomIndex !== 'number' || ata.roomIndex < Game.roomIndex) return false;
    if (Game.dungeonId === 'poco' && (!JOGO.Poco || !JOGO.Poco.preparar(ata.roomIndex + 2))) return false;
    if (seguraParaModelos({ dungeonId: Game.dungeonId, party: comParceiro(Game.party), duplas: duplasDaDescida(Game.party), sala: ata.roomIndex },
        function () { Game.retomaBatalhaDaAta(ata, pronto); })) return true;
    Game.roomIndex = ata.roomIndex;
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    resetAiState();
    resetTimer(true);
    timerTurno = null; ultimoTurno = null;
    Game.state = null;
    ataSolo = null;
    Game.screen = 'antessala';                   // a porta da sala da ata, sem a tela (a batalha vem logo atrás)
    if (!Game._criaDaAta(ata)) { setScreen('antessala', Game.salaInfo()); avisaAntessala(); return false; }
    if (pronto) { try { pronto(); } catch (e) {} }
    return true;
  };
  Game.retomaNaAntessala = function (roomIndex) {
    if (!rede || rede.tipo !== 'grupo' || !Game.dungeonId) return false;
    if (Game.screen !== 'battle' && Game.screen !== 'antessala' && Game.screen !== 'roomClear') return false;
    if (typeof roomIndex !== 'number' || roomIndex < 0 || roomIndex < Game.roomIndex) return false;
    var d = dungeonDefDe(Game.dungeonId), n = (d && d.rooms) ? d.rooms.length : 0;
    if (Game.dungeonId !== 'poco' && roomIndex >= n) return false;
    if (Game.dungeonId === 'poco' && JOGO.Poco) JOGO.Poco.preparar(roomIndex + 2);
    if (seguraParaModelos({ dungeonId: Game.dungeonId, party: comParceiro(Game.party), duplas: duplasDaDescida(Game.party), sala: roomIndex },
        function () { Game.retomaNaAntessala(roomIndex); })) return true;
    Game.roomIndex = roomIndex;
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    resetAiState();
    resetTimer(true);
    timerTurno = null; ultimoTurno = null;
    Game.state = null;
    ataSolo = null;
    setScreen('antessala', Game.salaInfo());
    avisaAntessala();
    return true;
  };

  function dungeonDefDe(dungeonId) {
    var ds = (JOGO.DATA && JOGO.DATA.dungeons) || [];
    var lista = Array.isArray(ds) ? ds : Object.keys(ds).map(function (k) { return ds[k]; });
    for (var k = 0; k < lista.length; k++) if (lista[k] && lista[k].id === dungeonId) return lista[k];
    // 03/10: os calabouços especiais moram fora de DATA.dungeons (o porquê está em js/core/data/santuario.js)
    var esp = (JOGO.DATA && JOGO.DATA.especial) ? JOGO.DATA.especial(dungeonId) : null;
    if (esp) return esp;
    // 07/10: a Câmara do Eco, na descida em grupo (a antessala a chama pelo nome e conta uma sala)
    if (JOGO.DATA && JOGO.DATA.eco && dungeonId === JOGO.DATA.eco.arena) { try { return E().calabouco(dungeonId); } catch (e) {} }
    return null;
  }
  /* A ÚLTIMA SALA da descida (a que fecha o calabouço): 2 nos seis portais, 4 no Santuário. Era a
   * mesma busca em DATA.dungeons escrita três vezes — e as três davam "2" para um calabouço que não
   * estivesse lá: o Santuário acabaria na terceira sala. */
  function ultimaSalaDe(dungeonId) {
    var d = dungeonDefDe(dungeonId);
    return (d && d.rooms && d.rooms.length) ? d.rooms.length - 1 : 2;
  }
  /* Quem espera na sala — "mostrará os monstros ao confirmar a batalha":
   * [{id, name, qtd, boss, element}] lido do layout (letras → room.monsters). */
  Game.monstrosDaSala = function (dungeonId, roomIndex) {
    var d = dungeonDefDe(dungeonId);
    var room = d && d.rooms ? d.rooms[roomIndex] : null;
    if (!room || !room.layout) return [];
    var cont = {}, ordem = [];
    for (var y = 0; y < room.layout.length; y++) {
      for (var x = 0; x < room.layout[y].length; x++) {
        var ch = room.layout[y].charAt(x);
        if (ch < 'a' || ch > 'z') continue;
        var mid = room.monsters ? room.monsters[ch] : null;
        if (!mid) continue;
        if (!cont[mid]) { cont[mid] = 0; ordem.push(mid); }
        cont[mid]++;
      }
    }
    return ordem.map(function (mid) {
      var md = null;
      try { md = E().monster(mid); } catch (e) { md = null; }
      return { id: mid, name: (md && md.name) || mid, qtd: cont[mid],
               boss: !!(md && md.boss), element: (md && md.element) || 'neutro' };
    });
  };
  /* O que a antessala precisa saber da sala atual. */
  Game.salaInfo = function () {
    var d = dungeonDefDe(Game.dungeonId);
    var n = (d && d.rooms) ? d.rooms.length : 3;
    var room = (d && d.rooms) ? d.rooms[Game.roomIndex] : null;
    return { dungeonId: Game.dungeonId, roomIndex: Game.roomIndex, total: n,
             nome: (room && room.name) || (Tx('Sala {a}', { a: Game.roomIndex + 1 })),
             tema: (d && d.theme) || null, calabouco: (d && d.name) || Game.dungeonId,
             // 03/10: a regra de terreno da sala do Santuário ('fogo' | 'agua' | 'terra' | 'ar' | 'altar'):
             // a porta da antessala a diz ANTES de a luta começar
             regra: (room && room.santuario && room.santuario.regra) || null,
             // 07/10: o afixo com que a sala deve abrir (o do dia, no Calabouço do Dia) — a porta o diz
             afixo: afixoProposto(Game.dungeonId),
             // 07/10: o caminho escuro: se a porta o oferece e se está pedido
             podeEscuro: Game.podeEscuro(), escuro: Game.escuroDaSala(),
             monstros: Game.monstrosDaSala(Game.dungeonId, Game.roomIndex) };
  };

  Game.restart = function (tela) { Game.init(tela); };

  // =====================================================================
  // [G11] A BATALHA EM REDE (11/09) — grupo de 2 jogadores e duelo.
  //
  // O Game continua sendo a porta de TODA ação que chega ao motor. Em rede:
  //  - cada herói/fusão tem `dono` (o id da Rede de quem o controla):
  //    `donoDe(u)` diz 'eu' | 'parceiro' | 'ia', e `isPlayerUnit/isPlayerTurn`
  //    viram "é meu" — a HUD e o desenho escondem barra e casas no turno do
  //    outro sem mudar nada lá;
  //  - a ação local vira LANCE: aplica no motor e o Coop manda — mesmo a que
  //    falha (a esquiva que falha gasta sorteio);
  //  - o turno do parceiro espera os lances dele (a fila do Coop), aplicados
  //    pelo MESMO caminho; a IA roda igual nos dois clientes;
  //  - depois de TODA chamada ao motor, se o `state.turno` mudou, o
  //    Coop.aoTurno guarda o hash (e a foto do começo do turno);
  //  - o meu turno anda pelo relógio de PAREDE (o setInterval do Coop); com a
  //    aba escondida o Game anda "sem tela" (IA e lances sem esperar o desenho).
  // Fora de rede, `rede` é null e todo caminho é o de sempre.
  // =====================================================================
  function meuIdRede() {
    var c = C();
    try { if (c && c.meuId) { var id = c.meuId(); if (id) return id; } } catch (e) {}
    var r = JOGO.Rede;
    try { return r && r.meuId ? r.meuId() : null; } catch (e2) { return null; }
  }
  function travadoRede() {
    var c = C();
    try { return !!(c && c.bloqueado && c.bloqueado()); } catch (e) { return false; }
  }
  function agoraMs() {
    var c = C();
    try { if (c && c._agora) { var t = +c._agora(); if (isFinite(t)) return t; } } catch (e) {}
    return Date.now();
  }
  function podeDescerEmGrupo(heroIds, dungeonId) {
    var c = C();
    try { if (!c || !c.emGrupo || !c.emGrupo()) return false; } catch (e0) { return false; }
    /* 12/09 (pedido do dono): "quando forem para um calabouco podem ir com os
     * dois personagens selecionados... no caso 4 personagens no maximo". Antes
     * a descida em grupo exigia UM heroi; agora aceita os selecionados (um ou
     * dois), e a sala nasce com ate quatro. 07/10 à noite: o Poço desce em
     * grupo também — o andar nasce da semente da ata (Poco.salaSemeada), igual
     * nos dois motores, e o juiz o refaz do mesmo jeito (sala.js). */
    if (!heroIds || heroIds.length < 1 || heroIds.length > 2) return false;
    if (dungeonId === 'poco' && !JOGO.Poco) return false;
    var prog = P(), temGm = false;
    for (var i = 0; i < heroIds.length; i++) {
      var h = null;
      try { h = prog && prog.hero ? prog.hero(heroIds[i]) : null; } catch (e) { h = null; }
      if (!h) return false;
      if (h.classId === 'gm') temGm = true;
    }
    // 11/09 (pedido do dono): o Mestre desce em grupo — só com o modo ligado aqui
    if (!temGm) return true;
    try { return !!(JOGO.GM && JOGO.GM.ativo && JOGO.GM.ativo()); } catch (e2) { return false; }
  }
  /* OS MODELOS QUE A DESCIDA EM GRUPO PRECISA (12/09): os meus herois mais os
   * do parceiro — ate quatro corpos, porque cada lado desce com os dois
   * selecionados. Sem a lista dele (versao antiga do grupo), cai no principal. */
  function comParceiro(ids) {
    var c = C(), cps = [];
    try { cps = (c && c.classesParceiro) ? (c.classesParceiro() || []) : []; } catch (e) { cps = []; }
    if (!cps.length) {
      var um = null;
      try { um = c && c.classeParceiro ? c.classeParceiro() : null; } catch (e2) { um = null; }
      if (um) cps = [um];
    }
    if (!cps.length || !ids || !ids.length) return ids;
    return ids.concat(cps);
  }
  /* AS DUAS DUPLAS DA DESCIDA (12/09): o plano de modelos (JOGO.Bundle) só
   * reconhece o corpo da FUSÃO quando recebe um par; com a lista achatada de
   * quatro ele não planejava fusão nenhuma. Cada lado vai como o seu par. */
  function duplasDaDescida(ids) {
    var c = C(), cps = [];
    try { cps = (c && c.classesParceiro) ? (c.classesParceiro() || []) : []; } catch (e) { cps = []; }
    var out = [];
    if (ids && ids.length) out.push(ids.slice());
    if (cps.length) out.push(cps.slice());
    return out.length ? out : null;
  }
  function avisaAntessala() {
    var c = C();
    if (c && c.naAntessala) { try { c.naAntessala(Game.salaInfo()); } catch (e) {} }
  }
  function partySizeRede() {
    var c = C(), n = 2;
    try { n = c && c.partySize ? c.partySize() : 2; } catch (e) { n = 2; }
    return (typeof n === 'number' && isFinite(n) && n >= 1) ? n : 2;
  }

  Game.modoRede = function () { return rede ? rede.tipo : null; };
  // o lado do estado que é MEU: no duelo, quem aceitou (B) é o lado 'enemy'
  Game.meuLado = function () {
    // 15/09: na guerra de guilda, a guilda que entrou na fila depois (B) também é o lado 'enemy' do estado
    return (rede && (rede.tipo === 'duelo' || rede.tipo === 'guerra') && rede.lado === 'B') ? 'enemy' : 'player';
  };
  // na colocação em grupo só o líder toca (o herói do parceiro nasce pela semente)
  Game.podeColocar = function () { return !rede || !!rede.colocador; };

  // ------------------------------------------------------- a preparação
  Game.PREP_SEGUNDOS = 30;
  /* O PRONTO É DESTA SALA. Sem zerar aqui, o reenvio do tique mandava o PRONTO
   * da sala anterior já com o `bid` novo, e o parceiro nascia pronto na sala
   * seguinte — a preparação dele acabava antes de ele ver o mapa. */
  function zeraPrep() {
    prepIniMs = agoraMs();
    prepVistoMs = prepIniMs;
    prepPronto = false;
    prepEle = false;
    prepEleCasa = null;
    prepFechada = false;
    prepUltSec = -1;
    var c = C();
    if (c && c.zeraPrep) { try { c.zeraPrep(); } catch (e) {} }
  }
  Game._zeraPrep = zeraPrep;                       // provas
  /* o herói por quem EU escolho: o primeiro meu que tem lista de opções */
  function meuEscolhedor() {
    var st = Game.state;
    if (!st || st.phase !== 'placing' || !st.placement) return null;
    var uids = E().quemEscolhe(st), i;
    for (i = 0; i < uids.length; i++) {
      var u = E().findUnit(st, uids[i]);
      if (!u) continue;
      if (!rede) { if (u.side === 'player' && u.kind === 'hero') return u; continue; }
      if (Game.donoDe(u) === 'eu') return u;
    }
    return null;
  }
  Game.meuEscolhedor = meuEscolhedor;
  Game.minhasOpcoes = function () {
    var u = meuEscolhedor();
    return u ? E().opcoesDe(Game.state, u.uid) : [];
  };
  Game.minhaEscolha = function () {
    var u = meuEscolhedor();
    return u ? E().escolhaDe(Game.state, u.uid) : null;
  };
  /* MARCAR A CASA. Não começa nada: só grava, avisa o parceiro e redesenha. */
  Game.marcaCasa = function (x, y) {
    var u = meuEscolhedor();
    if (!u || prepFechada) return false;
    if (!E().escolhe(Game.state, u.uid, x, y)) return false;
    avisaPrep();
    return true;
  };
  /* O PRONTO. Só vale depois de marcar a casa — quem não escolheu ainda não
   * tem o que confirmar (a HUD deixa o botão apagado até lá). */
  Game.prontoPrep = function (v) {
    if (!Game.state || Game.state.phase !== 'placing' || prepFechada) return false;
    if (!Game.minhaEscolha()) return false;
    prepPronto = v === undefined ? true : !!v;
    avisaPrep();
    return true;
  };
  function avisaPrep() {
    var c = C();
    var e = Game.minhaEscolha();
    if (c && c.mandaPrep) { try { c.mandaPrep({ x: e ? e.x : null, y: e ? e.y : null, v: prepPronto }); } catch (err) {} }
    emitePrepTick(true);
  }
  Game._prepDoParceiro = function (d) {           // o Coop entrega o que chegou
    if (!d) return;
    prepEle = !!d.v;
    prepEleCasa = (typeof d.x === 'number' && typeof d.y === 'number') ? { x: d.x, y: d.y } : null;
    emitePrepTick(true);
  };
  function parceiroEhIA() {
    var c = C();
    try { return !!(c && c.parceiroIA && c.parceiroIA()); } catch (e) { return false; }
  }
  function emDupla() { return !!(rede && rede.tipo === 'grupo' && !parceiroEhIA()); }
  Game.prepRestante = function () {
    if (!Game.state || Game.state.phase !== 'placing') return 0;
    if (!prepIniMs) return Game.PREP_SEGUNDOS;
    return Math.max(0, Game.PREP_SEGUNDOS - (prepVistoMs - prepIniMs) / 1000);
  };
  Game.prepEstado = function () {
    return {
      restante: Game.prepRestante(),
      pronto: prepPronto,
      prontoEle: prepEle,
      escolhi: !!Game.minhaEscolha(),
      dupla: emDupla(),
      colocador: Game.podeColocar(),
      fechada: prepFechada
    };
  };
  var prepUltSec = -1;
  function emitePrepTick(forca) {
    var eng = E(), sec = Math.ceil(Game.prepRestante());
    if (!forca && sec === prepUltSec) return;
    prepUltSec = sec;
    if (!eng || !eng.events) return;
    try { eng.events.push({ type: 'prepTick', remaining: sec, pronto: prepPronto, prontoEle: prepEle }); } catch (e) {}
  }
  /* O TIQUE DA PREPARAÇÃO: anda o relógio de parede e, quando dá a hora (ou
   * todo mundo está pronto), manda o ÚNICO lance `p`. Quem manda é o colocador
   * — os dois relógios podem zerar em instantes diferentes sem risco, porque
   * só um lado larga o lance. */
  function tickPrep() {
    var st = Game.state;
    if (!st || st.phase !== 'placing') return;
    if (!prepIniMs) zeraPrep();
    if (travadoRede()) { prepIniMs += Math.max(0, agoraMs() - prepVistoMs); prepVistoMs = agoraMs(); return; }
    prepVistoMs = agoraMs();
    emitePrepTick(false);
    if (prepFechada) return;
    var acabou = Game.prepRestante() <= 0;
    var todosProntos = emDupla() ? (prepPronto && prepEle) : prepPronto;
    if (!acabou && !todosProntos) return;
    if (!Game.podeColocar()) return;             // quem não coloca só espera o `p` chegar
    comecaBatalha();
  }
  Game._tickPrep = tickPrep;                     // provas
  /* AS CASAS DE TODOS, dentro do lance. `Engine.place` NUNCA lê o
   * `placement.escolhas` local (é de cada ponta e não viaja): o que vale é o
   * que está aqui, e é isto que o juiz do servidor refaz. */
  function escolhasDoLance() {
    var st = Game.state, e = {};
    if (!st || !st.placement) return e;
    var locais = st.placement.escolhas || {}, uid;
    for (uid in locais) if (Object.prototype.hasOwnProperty.call(locais, uid)) e[uid] = locais[uid];
    // a casa que o parceiro marcou chegou pela voz `prep`, não pelo estado
    if (prepEleCasa) {
      var uids = E().quemEscolhe(st), i;
      for (i = 0; i < uids.length; i++) {
        var u = E().findUnit(st, uids[i]);
        if (u && Game.donoDe(u) === 'parceiro') e[u.uid] = { x: prepEleCasa.x, y: prepEleCasa.y };
      }
    }
    return e;
  }
  function comecaBatalha() {
    var st = Game.state;
    if (!st || st.phase !== 'placing') return false;
    prepFechada = true;
    var e = escolhasDoLance();
    if (!rede) {
      var okp = !!E().place(st, null, null, { escolhas: e });
      anotaSolo({ a: 'p', x: null, y: null, e: e, ok: okp });
      posMotor();
      return okp;
    }
    return !!aplicaLocal({ a: 'p', x: null, y: null, e: e });
  }
  Game._comecaBatalha = comecaBatalha;            // provas
  /* 04/10, o dono: "ao clicar no quadrado meu personagem se mova na hora, e eu posso trocar de quadrado até
   * que a luta se inicie". As casas marcadas de todos (a minha e a do parceiro), para o tabuleiro PÔR O BONECO
   * nelas já na preparação. É só tela: o estado continua sem mexer até o lance `p` (ver Engine.escolhe). */
  Game.casasMarcadas = function () {
    var st = Game.state;
    return (st && st.phase === 'placing' && st.placement) ? escolhasDoLance() : {};
  };

  function donoIdDe(u, fundo) {
    if (!u || fundo > 4) return null;
    if (u.kind === 'hero' || u.kind === 'fusion') return u.dono || null;
    var st = Game.state;
    if (!st) return null;
    if (u.kind === 'pet' && u.ownerUid) return donoIdDe(E().findUnit(st, u.ownerUid), fundo + 1);
    if (u.summonerUid) return donoIdDe(E().findUnit(st, u.summonerUid), fundo + 1);
    return null;
  }
  Game.donoDe = function (u) {
    if (!u) return 'ia';
    if (!rede) return isPlayerUnitLocal(u) ? 'eu' : 'ia';
    if (u.kind !== 'hero' && u.kind !== 'fusion') return 'ia';
    if (u.ia || !u.dono) return 'ia';
    return u.dono === rede.eu ? 'eu' : 'parceiro';
  };
  // a perspectiva de TELA (o estado é igual nos dois motores; só a cor muda)
  Game.ladoDaTela = function (u) {
    if (!u) return 'inimigo';
    if (u.side !== Game.meuLado()) return 'inimigo';
    if (rede) {
      var d = donoIdDe(u, 0);
      if (d && d !== rede.eu) return 'aliado';
    }
    return 'meu';
  };

  /* 22/09 — O QUE ESTA TELA NÃO PODE VER. Dois pedidos do dono: "na
   * invisibilidade ele deve sumir 100% pro adversário" e "as armadilhas jamais
   * podem ficar visíveis para os inimigos ou adversários… só para o jogador e
   * para quem estiver jogando no time dele". O motor é o mesmo nos dois
   * aparelhos (lockstep) e no juiz: esconder é SÓ da tela, e a régua é o lado
   * do estado que é meu (meuLado) — no solo e no calabouço em dupla é 'player'
   * (o monstro invisível some); no duelo e na guerra cada guilda vê as suas
   * armadilhas e as do outro lado não. Quem sabe de qual armadilha é regra do
   * motor (Engine.armadilhaVisivel, a mesma da IA): fora do PvP a de monstro
   * segue à vista. O duelo de treino no MESMO teclado mostra tudo: não há de
   * quem esconder quem está sentado ao lado. */
  Game.telaVeTudo = function () {
    return !rede && !!(Game.state && Game.state.pvp);
  };
  Game.ocultoNaTela = function (u) {
    if (!u || !u.alive || u.offBoard || Game.telaVeTudo()) return false;
    if (u.side === Game.meuLado()) return false;
    if (E().unitHasEffect(u, 'invisible')) return true;
    return Game.ocultoPeloEscuro(u);
  };
  /* 03/10 — O ESCURO DO SANTUÁRIO (a Câmara Apagada; js/core/santuario.js). O monstro numa casa
   * escura que ninguém do meu lado vê some desta tela pelo MESMO caminho do invisível (corpo, barra,
   * anel, câmera, a casa dele pintada como chão livre). Quem decide é a regra do motor
   * (Santuario.regras.ocultoDoLado): só o lado do grupo deixa de ver, e basta um herói de Fogo —
   * ou alguém a duas casas — para o monstro aparecer para todos. */
  Game.ocultoPeloEscuro = function (u) {
    var st = Game.state, S = JOGO.Santuario;
    if (!u || !st || !st.santuario || !S || !S.regras || Game.telaVeTudo()) return false;
    if (!u.alive || u.offBoard || u.side === Game.meuLado()) return false;
    try { return !!S.regras.ocultoDoLado(st, Game.meuLado(), u); } catch (e) { return false; }
  };
  Game.veArmadilha = function (tr) {
    if (!tr) return false;
    if (Game.telaVeTudo()) return true;
    var en = E();
    if (en && en.armadilhaVisivel) return !!en.armadilhaVisivel(Game.state, Game.meuLado(), tr);
    return tr.side === Game.meuLado();
  };
  /* AS CASAS QUE ESTA TELA PINTA COMO ALVO (e aceita no toque). O motor recusa
   * chão livre ocupado por um corpo que ele sabe que existe; para quem mira, a
   * casa do invisível do outro lado é chão livre. Sem isto, o feitiço que pede
   * casa vazia (as armadilhas do Xamã, invocação, salto) pintava todo o alcance
   * menos ELA — o buraco entregava o Ladino sem gastar nada. Com ela no
   * destaque, o toque vai ao motor, que recusa e avisa "há alguém que não se
   * vê", como o esbarrão do passo.
   * 08/10 à noite (engine.js, decisão 24): o feitiço 'enemy' que fere aceita a
   * casa vazia no PRÓPRIO motor (castTargets já a traz, com ou sem invisível
   * nela), então esta volta só faz diferença para quem pede chão livre. */
  Game.alvosNaTela = function (uid, spellId) {
    var st = Game.state, en = E(), alvos = [];
    if (!st || !en) return alvos;
    try { alvos = en.castTargets(st, uid, spellId) || []; } catch (e) { alvos = []; }
    if (!en.podeLancar || !en.spellRange || !en.podeLancar(st, uid, spellId)) return alvos;
    var u = en.findUnit(st, uid), sp = null, alc = [];
    try { sp = en.spell(spellId); alc = en.spellRange(st, uid, spellId) || []; } catch (e2) { return alvos; }
    if (!u || !sp) return alvos;
    var tem = {};
    for (var i = 0; i < alvos.length; i++) tem[alvos[i].x + ',' + alvos[i].y] = true;
    for (var j = 0; j < alc.length; j++) {
      var c = alc[j], o = en.unitAt(st, c.x, c.y);
      if (!o || o === u || tem[c.x + ',' + c.y] || !Game.ocultoNaTela(o)) continue;
      // a casa entra se valeria VAZIA — do jeito que esta tela a vê
      if (en.validTargetCell(st, u, sp, c.x, c.y, true)) alvos.push({ x: c.x, y: c.y });
    }
    return alvos;
  };
  /* O evento como ESTA tela o percebe: o próprio `ev`, uma cópia sem a casa
   * (x/y null) ou null — ninguém nesta tela (efeito, som, HUD) deve saber dele.
   * O renderizador recebe `tela || ev` e esconde o corpo pelo estado; ele
   * precisa do passo do invisível para saber onde o corpo está quando voltar
   * a aparecer. Estes tipos são públicos mesmo com invisível no meio: a vez, a
   * morte, pisar em armadilha ou em evento de chão (o chão entrega) e o que
   * não é de ninguém. A FUSÃO não: o fundido segue invisível, e o clarão e a
   * câmera dela iam direto à casa dele. */
  var EV_PUBLICO = {
    battleStart: 1, battleEnd: 1, roundStart: 1, turnStart: 1, turnEnd: 1,
    death: 1, trapTriggered: 1, tileEvent: 1, summon: 1,
    placed: 1, placement: 1, petSpawn: 1, timerTick: 1, prepTick: 1
  };
  // arma armadilha? QUALQUER efeito 'trap' — a fusão sempre junta outro
  // efeito (cura, bênção, clima), e a casa dela vazava pelo lance
  function armaArmadilha(sp) {
    var ef = (sp && sp.effects) || [];
    for (var i = 0; i < ef.length; i++) if (ef[i] && ef[i].type === 'trap') return true;
    return false;
  }
  Game.eventoParaTela = function (ev) {
    var st = Game.state;
    if (!ev || !st || !st.units || Game.telaVeTudo()) return ev;
    var eu = Game.meuLado();
    if (ev.type === 'trapSet' || ev.type === 'trapExpired') {
      var lado = ev.side;
      if (lado == null && ev.uid != null) { var dono = E().findUnit(st, ev.uid); lado = dono && dono.side; }
      return (lado != null && !Game.veArmadilha({ side: lado })) ? null : ev;
    }
    if (EV_PUBLICO[ev.type] || ev.uid == null) return ev;
    var u = E().findUnit(st, ev.uid);
    /* 03/10: o golpe que sai do ESCURO aparece (o clarão do feitiço entrega de onde veio; o corpo
     * segue escondido pelo estado). Sem isto o herói perdia vida sem a tela mostrar por quê — o
     * escuro esconde quem está parado nele, não o tiro. O invisível continua mudo: lá o golpe já
     * o tira das sombras. */
    if (u && ev.type === 'cast' && !E().unitHasEffect(u, 'invisible') && Game.ocultoPeloEscuro(u)) return ev;
    if (u && Game.ocultoNaTela(u)) return null;
    // quem arma do outro lado aparece conjurando, mas a casa escolhida não:
    // sem x/y o efeito toca no conjurador e o corpo não se vira para ela
    if (ev.type === 'cast' && ev.x != null && u && u.side !== eu && !Game.veArmadilha({ side: u.side })) {
      var sp = null;
      try { sp = E().spell(ev.spellId); } catch (e) { sp = null; }
      if (armaArmadilha(sp)) {
        var c = {};
        for (var k in ev) if (Object.prototype.hasOwnProperty.call(ev, k)) c[k] = ev[k];
        c.x = null; c.y = null;
        return c;
      }
    }
    return ev;
  };

  // o GANCHO DE TURNO: depois de toda chamada ao motor
  function posMotor() {
    if (!rede || !Game.state) return;
    var t = Game.state.turno || 0;
    if (t === ultimoTurno) return;
    ultimoTurno = t;
    var c = C();
    if (c && c.aoTurno) { try { c.aoTurno(Game.state); } catch (e) {} }
  }
  // um lance no motor, sem mandar nada
  function executa(l) {
    var st = Game.state, ok = false;
    if (!st || !l) return false;
    try {
      if (l.a === 'p') ok = !!E().place(st, l.x, l.y, { escolhas: l.e || {}, uid: l.eu || null });
      else if (l.a === 'm') ok = !!E().move(st, l.u, l.x, l.y);
      else if (l.a === 'c') ok = !!E().cast(st, l.u, l.s, l.x, l.y);
      else if (l.a === 'e') { if (st.phase === 'playing') E().endTurn(st); ok = true; }
      // 07/10: o sal da rodada do Eco em dupla — a autoridade o pediu ao servidor e mandou pelo lockstep
      else if (l.a === 'r') ok = !!E().ecoSal(st, l.r, l.s);
      // 13/09: a poção saiu da batalha (é da sala de espera): o gole de uma página velha não cura
      else if (l.a === 'po') ok = false;
      else if (l.a === 'f') {
        /* O `f` DE FORA (12/09). Fundir é só com os personagens do MESMO
         * jogador, então um lance que junte heróis de donos diferentes não
         * funde — venha de onde vier. `Fusion.declare` já recusaria (a regra
         * mora lá), e a conferência aqui é a segunda tranca: assim um cliente
         * alterado nem chega a mexer no estado, e o lance falho entra no log
         * dos dois motores como falho, que é o que mantém o lockstep.
         * Também cai por aqui o `f` de fora que mexe num herói MEU: o dono da
         * unidade é o único que a declara. */
        var fa = E().findUnit(st, l.u), fb = E().findUnit(st, l.alvo);
        var donoA = fa ? (fa.dono || null) : null, donoB = fb ? (fb.dono || null) : null;
        if (!fa || !fb || donoA !== donoB) ok = false;
        else if (rede && l.de && donoA && l.de !== donoA) ok = false;
        else ok = !!(JOGO.Fusion && JOGO.Fusion.declare && JOGO.Fusion.declare(st, l.u, l.alvo));
      }
    } catch (e) { ok = false; }
    return ok;
  }
  // os lances MEUS que voltaram para a fila depois de uma foto saem antes de um novo
  function drenaMeus() {
    var c = C();
    if (!c || !c.proximoLance) return;
    for (var n = 0; n < 64; n++) {
      var st = Game.state;
      if (!st || st.phase !== 'playing') return;
      var u = E().activeUnit(st);
      if (!u || Game.donoDe(u) !== 'eu') return;
      var l = c.proximoLance(u.uid);
      if (!l) return;
      aplicaRemoto(l);
    }
  }
  // A PORTA ÚNICA em rede: aplica e o Coop manda (a tentativa que falha também)
  function aplicaLocal(l) {
    if (!Game.state || !l) return false;
    if (l.a !== 'p') {
      drenaMeus();
      if (!Game.state || Game.state.phase !== 'playing' || !Game.isPlayerTurn()) return false;
    }
    l.T = Game.state.turno || 0;
    var ok = executa(l);
    var c = C();
    if (c && c.registra) { try { c.registra(l, ok); } catch (e) {} }
    posMotor();
    var st = Game.state;
    // a sala só acaba com a batalha em dia: quem acabou de acusar a divergência
    // espera a foto (o restauraFoto chama o fim, do estado certo)
    if (st && st.phase !== 'playing' && st.phase !== 'placing' && !travadoRede()) handleBattleOver();
    return ok;
  }
  // um lance que veio da fila (do outro, ou um meu reaplicado depois da foto)
  function aplicaRemoto(l) {
    if (l.a === 'e') { timerUid = null; timerTurno = null; }
    var ok = executa(l);
    posMotor();
    var c = C();
    if (c && c.aplicado) { try { c.aplicado(l, ok); } catch (e) {} }
    var st = Game.state;
    if (st && st.phase !== 'playing' && st.phase !== 'placing' && !travadoRede()) handleBattleOver();
    return ok;
  }

  // o meu turno anda pelo relógio de PAREDE (não para com a aba escondida) —
  // e PARA enquanto a batalha está travada (sincronizando, esperando o outro
  // entrar): sem poder tocar em nada, o turno não pode correr
  var relogioVisto = 0;
  function congelaRelogio() {
    if (caido) caido.visto = agoraMs();            // 08/10 à noite: a vez de quem caiu também não corre travada
    if (!rede || timerTurno === null) return;
    var ag = agoraMs();
    if (relogioVisto) turnoIniMs += Math.max(0, ag - relogioVisto);
    relogioVisto = ag;
  }
  function atualizaRelogioRede(soMede) {
    var st = Game.state;
    if (!rede || !st || st.phase !== 'playing') return;
    var u = E().activeUnit(st);
    if (!u || Game.donoDe(u) !== 'eu') return;
    if (timerUid !== u.uid || timerTurno !== (st.turno || 0)) {
      timerUid = u.uid; timerTurno = st.turno || 0;
      turnoIniMs = agoraMs(); lastTickSec = -1; turnElapsed = 0;
      relogioVisto = turnoIniMs;
    }
    if (travadoRede()) { congelaRelogio(); return; }
    relogioVisto = agoraMs();
    turnElapsed = Math.max(0, (agoraMs() - turnoIniMs) / 1000);
    if (soMede) return;
    emitTimerTick();
    if (Game.timeLeft() <= 0) Game.endTurn();
  }
  Game._gastoRede = function () { return turnElapsed; };      // provas: o quanto do meu turno já correu
  /* QUEM CAIU E VOLTOU JOGA COM 30 S LIMPOS (14/09, pedido do dono: "quando um
   * usuário desconecta no meio da partida sua vez passa, e quando ele entra
   * novamente e chega seu turno o tempo começa sem acúmulo, em 30 segundos").
   * O banco era a sobra dos turnos de ANTES da queda e ficava de pé: quem volta
   * tinha 30 s + banco, e o parceiro que ficou esperava por esse prazo inteiro.
   * Agora o banco zera na volta. O relógio só zera se a vez não é minha agora —
   * uma queda curta no meio do MEU turno não ganha 30 s novos; o turno segue de
   * onde estava, sem o banco. */
  Game._voltouDaQueda = function () {
    Game.banked = 0;
    var st = Game.state;
    var u = (st && st.phase === 'playing') ? E().activeUnit(st) : null;
    if (!u || Game.donoDe(u) !== 'eu') {
      timerUid = null; timerTurno = null;
      turnElapsed = 0;
    }
    lastTickSec = -1;
    emitTimerTick();
  };

  function updateRede(d, semTela) {
    var st = Game.state, c = C();
    if (travadoRede()) { congelaRelogio(); return; }
    if (st.phase === 'placing') {
      tickPrep();                                  // 21/09: a preparação corre dos DOIS lados
      if (rede.colocador) { if (c && c._pilotoPasso) { try { c._pilotoPasso(); } catch (e) {} } }
      else aplicaFila(semTela);
      return;
    }
    if (st.phase !== 'playing') { handleBattleOver(); return; }
    /* O SAL DA RODADA EM DUPLA (07/10): a rodada nova do Eco parou esperando o sal — a vez é de ninguém. Quem
     * tem a AUTORIDADE do lockstep pede ao servidor (pedeSalEco) e aplica como lance {a:'r'}, que vai ao outro;
     * quem segue só tira da fila o lance que chegar. Um lance meu devolvido à fila pela foto sai antes. */
    if (st.eco && E().ecoEsperaSal && E().ecoEsperaSal(st)) {
      resetAiState();
      timerUid = null;
      var lr = (c && c.proximoLance) ? c.proximoLance(null) : null;
      if (lr) { aplicaRemoto(lr); return; }
      var souAut = false;
      try { souAut = !!(c && c.souAutoridade && c.souAutoridade()); } catch (eA) { souAut = false; }
      if (souAut) pedeSalEco();
      return;
    }
    var u = E().activeUnit(st);
    if (!u) return;
    var dono = Game.donoDe(u);
    if (dono === 'eu') {
      resetAiState();
      var l = (c && c.proximoLance) ? c.proximoLance(u.uid) : null;   // lance meu reaplicado depois da foto
      if (l) { aplicaRemoto(l); return; }
      if (Game.mustEndTurn) { Game.endTurn(); return; }                 // fusão declarada [G4]
      atualizaRelogioRede(false);
      if (Game.state === st && st.phase === 'playing' && c && c._pilotoPasso) {
        try { c._pilotoPasso(); } catch (e2) {}
      }
      return;
    }
    timerUid = null;
    if (dono === 'parceiro') { resetAiState(); aplicaFila(semTela); return; }
    /* O TURNO DE QUEM CAIU PASSA (12/09, pedido do dono: "enquanto ele ta off
     * seu turno passara"). A marca `ia` num heroi de GENTE quer dizer "o dono
     * nao esta aqui" — e nao "a IA joga por ele", que era o que acontecia
     * antes: a IA movia e lancava com o heroi do parceiro caido, jogando o
     * personagem de alguem que nao pediu isso. O corpo fica de pe na sala (e
     * pode ser atingido), o turno dele so nao acontece. Monstro, pet e
     * invocacao seguem na IA: `u.dono` so existe em heroi de gente. */
    if (u.dono && (u.kind === 'hero' || u.kind === 'fusion')) {
      resetAiState();
      if (st.phase === 'playing' && !vezDoCaidoAcabou(st, u)) return;
      caido = null;
      if (st.phase === 'playing') { E().endTurn(st); posMotor(); }
      if (Game.state && Game.state.phase !== 'playing' && !travadoRede()) handleBattleOver();
      return;
    }
    iaPasso(u, d, semTela);
  }
  /* A VEZ DE QUEM CAIU CORRE NO RELÓGIO (08/10 à noite, o dono: "caso caia em qualquer conexão ele deve
   * ficar na batalha e seu turno e tempo correr normal até ele desconectar ou perder"). Até aqui a marca
   * `ia` num herói de gente passava a vez DELE na hora, no primeiro quadro: quem recarregou a página (ou
   * cuja conexão piscou) voltava e encontrava os heróis com três ou quatro vezes puladas. Agora a vez do
   * herói marcado corre pelos mesmos 30 s de uma vez normal (`turnTime`, sem banco: o banco é de quem está
   * aqui), no relógio de PAREDE deste motor, e só então passa — é o tempo que uma recarga ou a reabertura
   * do aplicativo leva para o dono voltar e retomar os corpos (Coop.retomaBatalha). Dois cuidados:
   *   - o relógio PARA enquanto a batalha está travada (sincronizando): o quadro não chega aqui, e o
   *     `visto` é empurrado em updateRede para o tempo travado não contar;
   *   - a QUEDA CONFIRMADA (Coop.quedaConfirmada: o parceiro fora há mais de Coop.QUEDA_MS sem sinal, ou
   *     quem SAIU de vez) volta a passar a vez na hora — quem fechou o jogo para sempre não prende o
   *     parceiro em 30 s por vez até o fim da sala.
   * É um relógio local de quem simula; o estado continua igual nos dois motores (os dois passam a MESMA
   * vez, a fila por (T, k) acomoda o atraso), e o juiz passa a vez marcada sem tempo nenhum. */
  var caido = null;          // { uid, T, gasto, visto } — a vez em curso de um herói de gente marcado fora
  function vezDoCaidoAcabou(st, u) {
    var c = C(), ag = agoraMs(), T = st.turno || 0;
    var confirmada = true;
    try { if (c && c.quedaConfirmada) confirmada = !!c.quedaConfirmada(u.dono); } catch (e) { confirmada = true; }
    if (confirmada) return true;
    if (!caido || caido.uid !== u.uid || caido.T !== T) caido = { uid: u.uid, T: T, gasto: 0, visto: ag };
    caido.gasto += Math.max(0, ag - caido.visto);
    caido.visto = ag;
    return caido.gasto >= Game.turnTime * 1000;
  }
  /* a HUD: a vez de quem caiu, e quanto falta para ela passar ({ uid, resta } em ms), ou null */
  Game.relogioCaido = function () {
    if (!caido || !Game.state) return null;
    var u = (Game.state.phase === 'playing') ? E().activeUnit(Game.state) : null;
    if (!u || u.uid !== caido.uid || (Game.state.turno || 0) !== caido.T) return null;
    return { uid: caido.uid, resta: Math.max(0, Game.turnTime * 1000 - caido.gasto) };
  };
  // os lances do parceiro: um por quadro livre com o desenho; todos sem ele
  function aplicaFila(semTela) {
    var c = C();
    if (!c || !c.proximoLance) return;
    var ren = JOGO.Renderer;
    var comTela = !semTela && !!(ren && ren.isBusy);
    for (var n = 0; n < 500; n++) {
      var st = Game.state;
      if (!st) return;
      if (st.phase !== 'playing' && st.phase !== 'placing') { handleBattleOver(); return; }
      if (comTela && ren.isBusy()) return;
      var u = null;
      if (st.phase === 'placing') { if (rede.colocador) return; }
      else {
        u = E().activeUnit(st);
        if (!u || Game.donoDe(u) !== 'parceiro') return;
      }
      var l = c.proximoLance(u ? u.uid : null);
      if (!l) return;
      aplicaRemoto(l);
      if (comTela) return;
    }
  }
  // a IA em rede: o MESMO plano, calculado no começo do turno da unidade,
  // executado inteiro sem tela ou uma ação por quadro com tela (e, se a aba
  // some no meio, o resto do mesmo plano — nunca um plano novo no meio)
  function iaPasso(u, d, semTela) {
    var ren = JOGO.Renderer;
    var comTela = !semTela && !!(ren && ren.isBusy);
    if (comTela) {
      if (ren.isBusy()) { aiTimer = 0; return; }
      aiTimer += d;
      if (aiPlan && aiUid === u.uid && aiTimer < AI_ACTION_DELAY) return;
      if (!aiPlan || aiUid !== u.uid) { aiPlan = getPlanFor(u.uid); aiIdx = 0; aiUid = u.uid; aiTimer = 0; return; }
      iaUmaAcao(u);
      return;
    }
    if (!aiPlan || aiUid !== u.uid) { aiPlan = getPlanFor(u.uid); aiIdx = 0; aiUid = u.uid; aiTimer = 0; }
    for (var n = 0; n < 64 && aiPlan && aiUid === u.uid; n++) {
      if (!iaUmaAcao(u)) break;
    }
  }
  function iaUmaAcao(u) {
    var st = Game.state;
    if (aiIdx >= aiPlan.length) {
      resetAiState();
      if (st.phase === 'playing') { E().endTurn(st); posMotor(); }
      if (Game.state && Game.state.phase !== 'playing' && !travadoRede()) handleBattleOver();
      return false;
    }
    var action = aiPlan[aiIdx++];
    execAction(action, u.uid);
    posMotor();
    aiTimer = 0;
    if (action.action === 'end') resetAiState();
    if (Game.state && Game.state.phase !== 'playing') {
      resetAiState();
      if (!travadoRede()) handleBattleOver();
      return false;
    }
    return !!aiPlan;
  }

  // o PV da sala seguinte, com a chave `dono:heroId`; a fusão divide entre os dois
  function carryRede(st) {
    var out = {}, i, k, u;
    for (i = 0; i < st.units.length; i++) {
      u = st.units[i];
      if (u.side !== 'player') continue;
      if (u.kind === 'hero') {
        if (u.fusedInto) continue;                 // a metade B de uma fusão conta pela fusão
        out[(u.dono || '') + ':' + (u.heroId || u.defId)] = u.alive ? u.hp : 0;
      } else if (u.kind === 'fusion') {
        var from = u.fusedFrom || [], srcs = [];
        for (k = 0; k < from.length; k++) { var s0 = E().findUnit(st, from[k]); if (s0) srcs.push(s0); }
        if (!srcs.length) srcs = [u];
        var parte = u.alive ? Math.max(1, Math.floor(u.hp / srcs.length)) : 0;
        for (k = 0; k < srcs.length; k++) out[(srcs[k].dono || '') + ':' + (srcs[k].heroId || srcs[k].defId)] = parte;
      }
    }
    return out;
  }
  /* O PV DA PORTA na batalha nova (13/09, a regra do juiz: servidor/juiz/sala.js,
   * aplicaCarry). O número já traz a espera e as poções; aqui só se prende ao PV máximo
   * da sala nova, com o piso de 1 (herói a 0 não chega: a porta não abre). Chave `heroId`
   * sozinho, `dono:heroId` em grupo. */
  function aplicaCarry(st, carry, emRede) {
    if (!carry || !st || !st.units) return;
    for (var i = 0; i < st.units.length; i++) {
      var u = st.units[i];
      if (u.kind !== 'hero') continue;
      var prev = carry[emRede ? (u.dono || '') + ':' + (u.heroId || u.defId) : (u.heroId || u.defId)];
      if (typeof prev !== 'number' || !isFinite(prev)) continue;
      u.hp = Math.max(1, Math.min(u.hpMax, Math.floor(prev)));
    }
  }
  // o PV que o líder põe na próxima ata
  /* A SEGURANÇA (13/09): o juiz do servidor paga a sala em GRUPO pelo mesmo
   * computeRewards — e ele lê o `rede` (partySize e a vez do saque vêm do Coop).
   * No juiz não há Rede: o gancho põe o `rede` do membro que está sendo pago. */
  Game._defineRede = function (r) { rede = r || null; };
  Game._carryRede = function (st) { return carryRede(st || Game.state); };
  // o PV com que cada herói TERMINOU a última sala em grupo (igual nos dois clientes)
  Game._carry = function () { return (rede && carryFimRede) ? JSON.parse(JSON.stringify(carryFimRede)) : null; };
  // 14/09: o PV da PORTA agora (a minha vida única e a do parceiro pelo `pronto`): o da ata sem servidor
  Game._carryPorta = function () { return carryDaPortaGrupo(); };

  /* A BATALHA DA ATA (o Coop chama): a mesma semente, a mesma dificuldade, o
   * mesmo grupo ao pé da letra e o mesmo PV carregado nos dois clientes. */
  Game._criaDaAta = function (ata) {
    if (!rede || rede.tipo !== 'grupo' || !ata || Game.screen !== 'antessala') return false;
    if (ata.dungeonId !== Game.dungeonId || ata.roomIndex !== Game.roomIndex) return false;
    var st;
    try {
      // 07/10: o Poço em grupo — o andar nasce da semente da ata nos dois motores (e no juiz: sala.js)
      if (ata.dungeonId === 'poco') {
        if (!JOGO.Poco || !JOGO.Poco.poeSala(ata.roomIndex + 1, JOGO.Poco.salaSemeada(ata.roomIndex + 1, ata.semente >>> 0))) return false;
      }
      st = E().createBattle(ata.dungeonId, ata.roomIndex, JSON.parse(JSON.stringify(ata.party)),
                            { seed: ata.semente, dificuldade: ata.dificuldade || 'normal', escolhePosicao: true,
                              afixo: ata.afixo || null });     // 07/10: o afixo da ata, igual nos dois clientes
      if (ata.dungeonId === 'poco') JOGO.Poco.escalaEstado(st, ata.roomIndex + 1);   // a escalada antes do PV, como no solo
    } catch (e) { return false; }
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    resetAiState();
    resetTimer(true);
    timerTurno = null;
    aplicaCarry(st, ata.carry, true);
    Game.state = st;
    Game.escuro = false;                 // 07/10: o caminho escuro é de cada porta — a próxima pergunta de novo
    /* A TENTATIVA DO ECO EM DUPLA (07/10): a ata traz a tentativa que o servidor abriu junto com a sala do grupo
     * (grupo.py → supremo.py). Os dois clientes a guardam; o sal de cada rodada é pedido pela AUTORIDADE do
     * lockstep e viaja como lance {a:'r'} (updateRede); o fechar vai pelo gid (fechaEco). Sem `eco` na ata — a
     * Câmara aberta sem servidor — é treino em dupla: o sal sai daqui e nada pontua. */
    if (st.eco) {
      ataEco = { tentativa: (typeof ata.eco === 'string' && ata.eco) ? ata.eco : null, treino: !ata.eco,
                 restantes: ata.restantes, grupo: true };
      fimEco = null;
      salEco = null;
    } else ataEco = null;
    rede.colocador = !!(ata.party && ata.party[0] && ata.party[0].dono === rede.eu);
    ultimoTurno = st.turno || 0;
    zeraPrep();                                    // 21/09: o PRONTO é DESTA sala
    setScreen('battle');
    return true;
  };

  // {heroId: PV} do `vida` de cada payload da dupla (inteiro ≥ 1; sem ele, o herói entra cheio)
  function vidaDaDupla(dupla) {
    var out = {};
    (dupla || []).forEach(function (p) {
      if (p && typeof p.vida === 'number' && isFinite(p.vida) && p.vida >= 1) out[p.heroId || p.classId] = Math.floor(p.vida);
    });
    return out;
  }
  /* O DUELO PELA REDE (o Coop chama depois da revelação): a sala sorteada,
   * as duas duplas, a semente dos dois. `pronto` é chamado quando a batalha
   * existe (os modelos podem segurar a descida um instante). */
  Game._iniciaDueloRede = function (d, pronto) {
    if (!d || !d.duplaA || !d.duplaB) return false;
    function classes(dp) { return dp.map(function (p) { return p.classId; }); }
    function ids(dp) { return dp.map(function (p) { return p.heroId || p.classId; }); }
    if (seguraParaModelos({ dungeonId: d.dungeonId, sala: d.roomIndex, duelo: true,
                            duplas: [classes(d.duplaA), classes(d.duplaB)] },
        function () {
          // os modelos chegaram: a arena só nasce se o duelo AINDA existe (a
          // carga lenta pode ter passado do teto e o Coop ter cancelado)
          var cd = C(), ses = null;
          try { ses = (cd && cd.sessao) ? cd.sessao() : null; } catch (e0) { ses = null; }
          if (ses && ses.tipo === 'duelo' && ses.bid === d.did) Game._iniciaDueloRede(d, pronto);
        })) return true;
    var st;
    try {
      /* 14/09: cada herói da dupla traz a `vida` com que entra (a do compromisso: presa no
       * hash que o outro lado conferiu; ausente = cheio) — os dois motores nascem iguais */
      st = E().createDuelSala(d.dungeonId, d.roomIndex, JSON.parse(JSON.stringify(d.duplaA)),
                              JSON.parse(JSON.stringify(d.duplaB)),
                              { seed: d.semente, vidaA: vidaDaDupla(d.duplaA), vidaB: vidaDaDupla(d.duplaB) });
    } catch (e) { return false; }
    Game.party = ids(d.eu === 'B' ? d.duplaB : d.duplaA);
    Game.dungeonId = null;               // duelo não pertence a calabouço
    Game.roomIndex = 0;
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    resetAiState();
    resetTimer(true);
    timerTurno = null;
    Game._duplas = { a: ids(d.duplaA), b: ids(d.duplaB) };
    rede = { tipo: 'duelo', eu: d.meuId || meuIdRede(), lado: d.eu === 'B' ? 'B' : 'A', colocador: false,
             arena: d.arena || null, oponente: d.oponente || '' };
    Game.state = st;
    ultimoTurno = null;
    posMotor();                          // o duelo já nasce no turno 1: hash e foto dele
    setScreen('battle');
    if (typeof pronto === 'function') { try { pronto(); } catch (e2) {} }
    return true;
  };

  /* A GUERRA DE GUILDA 2×2 (15/09, o Coop chama com a ata do SERVIDOR): o Salão da Sede, as duas duplas de cada
   * guilda (até quatro por lado, cada payload com o `dono`) e a semente do servidor. A vida entra pela chave
   * `dono:heroId` depois de montar o salão — a mesma ordem do juiz (servidor/juiz/guerra.js: createDuelSala e
   * aplicaCarryRede), porque o heroId colide entre os dois jogadores do mesmo lado. */
  Game._iniciaGuerraRede = function (d, pronto) {
    if (!d || !d.A || !d.B || !d.gid) return false;
    function porDono(lista) {
      var ordem = [], m = {};
      lista.forEach(function (p) { if (!m[p.dono]) { m[p.dono] = []; ordem.push(p.dono); } m[p.dono].push(p.classId); });
      return ordem.map(function (k) { return m[k]; });
    }
    function ids(lista) { return lista.map(function (p) { return p.heroId || p.classId; }); }
    if (seguraParaModelos({ dungeonId: d.mapa, sala: d.sala, duelo: true, duplas: porDono(d.A).concat(porDono(d.B)) },
        function () {
          var cd = C(), ses = null;
          try { ses = (cd && cd.sessao) ? cd.sessao() : null; } catch (e0) { ses = null; }
          if (ses && ses.tipo === 'guerra' && ses.bid === d.gid) Game._iniciaGuerraRede(d, pronto);
        })) return true;
    var st;
    try {
      st = E().createDuelSala(d.mapa, d.sala, JSON.parse(JSON.stringify(d.A)), JSON.parse(JSON.stringify(d.B)),
                              { seed: d.semente });
    } catch (e) { return false; }
    aplicaCarry(st, d.carry, true);
    var meuId = d.meuId || meuIdRede();
    Game.party = ids(d.A.concat(d.B).filter(function (p) { return p.dono === meuId; }));
    Game.dungeonId = null;
    Game.roomIndex = 0;
    Game.selectedSpellId = null;
    Game.hoverTile = null;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    resetAiState();
    resetTimer(true);
    timerTurno = null;
    Game._duplas = { a: ids(d.A), b: ids(d.B) };
    rede = { tipo: 'guerra', eu: meuId, lado: d.eu === 'B' ? 'B' : 'A', colocador: false, arena: d.arena || null,
             gid: d.gid, guildas: d.guildas || null, jogadores: d.jogadores || [] };
    Game.state = st;
    ultimoTurno = null;
    posMotor();
    setScreen('battle');
    if (typeof pronto === 'function') { try { pronto(); } catch (e2) {} }
    return true;
  };
  Game.guerraInfo = function () {
    return (rede && rede.tipo === 'guerra')
      ? { gid: rede.gid, lado: rede.lado, guildas: rede.guildas, jogadores: rede.jogadores, eu: rede.eu } : null;
  };

  // a porta do piloto automático das provas: um lance como se fosse um toque
  Game._local = function (l) {
    if (!rede || !Game.state || !l) return false;
    if (l.a === 'e') { Game.endTurn(); return true; }
    // 21/09: o `p` guardado refaz a COLOCAÇÃO inteira (as casas vêm em `l.e`),
    // e não o toque — tocar de novo só marcaria a casa
    if (l.a === 'p') return !!E().place(Game.state, l.x, l.y, { escolhas: l.e || {}, uid: l.eu || null });
    if (!Game.isPlayerTurn()) return false;
    return aplicaLocal({ a: l.a, u: l.u, x: l.x, y: l.y, s: l.s, alvo: l.alvo });
  };
  // o tique do Coop (500 ms): o relógio do meu turno; sem tela, o jogo anda
  Game._tique = function (semTela) {
    if (!rede || Game.screen !== 'battle' || !Game.state) return;
    if (travadoRede()) { congelaRelogio(); return; }
    if (semTela) { Game.update(0, true); return; }
    atualizaRelogioRede(false);
  };
  /* A FOTO DE RESGATE (quem divergiu ou voltou): o estado vira o da foto e os
   * lances do turno que ela já tinha são reaplicados; os que faltam (meus e
   * do outro) o Coop devolveu à fila. Só na batalha (a sala que já acabou não
   * se reescreve), cada lance da foto só se for do dono da vez, e o relógio
   * do meu turno segue de onde estava se a vez e o turno são os mesmos. */
  Game.restauraFoto = function (foto) {
    if (!rede || !foto || !foto.estado || Game.screen !== 'battle') return false;
    var antesUid = timerUid, antesT = timerTurno, antesIni = turnoIniMs;
    var st;
    try { st = E().restaura(foto.estado); } catch (e) { return false; }
    // o `ia` que entrou depois da foto do começo do turno (a autoridade manda a lista).
    // 19/09: a lista é a VERDADE INTEIRA de quem está fora agora — herói de gente que não está nela sai da marca
    // (a foto do começo do turno ainda tinha quem voltou como fora, e a vez dele passava sozinha no motor dele).
    // Sem lista (a foto do fim) nada muda.
    var iaFoto = Object.prototype.toString.call(foto.ia) === '[object Array]' ? foto.ia : null;
    if (iaFoto) {
      for (var q = 0; q < st.units.length; q++) {
        var ui = st.units[q];
        if ((ui.kind === 'hero' || ui.kind === 'fusion') && ui.dono) ui.ia = iaFoto.indexOf(ui.uid) >= 0;
      }
    }
    Game.state = st;
    resetAiState();
    timerUid = null; timerTurno = null;
    Game.selectedSpellId = null;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    ultimoTurno = st.turno || 0;
    var c = C(), ls = foto.lances || [];
    for (var i = 0; i < ls.length; i++) {
      if (!(c && c._donoCerto && c._donoCerto(ls[i], Game.state))) break;
      var ok = executa(ls[i]);
      posMotor();
      if (c && c.aplicado) { try { c.aplicado(ls[i], ok, true); } catch (e2) {} }
    }
    var vez = (Game.state.phase === 'playing') ? E().activeUnit(Game.state) : null;
    if (vez && antesUid && antesT !== null && vez.uid === antesUid && (Game.state.turno || 0) === antesT) {
      timerUid = antesUid; timerTurno = antesT; turnoIniMs = antesIni; relogioVisto = agoraMs();
    }
    // a fusão que EU declarei neste turno já está na foto: o turno ainda tem de acabar
    var at = (Game.state.phase === 'playing') ? E().activeUnit(Game.state) : null;
    if (at && Game.state.pendingFusion && Game.state.pendingFusion.a === at.uid && Game.donoDe(at) === 'eu') {
      Game.mustEndTurn = true;
    }
    if (Game.state.phase !== 'playing' && Game.state.phase !== 'placing') handleBattleOver();
    return true;
  };
  // o fim fora do fluxo do motor (desistência, W.O.)
  Game._encerra = function (vencedor, motivo) {
    if (!Game.state || !E().encerra) return false;
    var ok = !!E().encerra(Game.state, vencedor, motivo);
    if (ok) handleBattleOver();
    return ok;
  };
  // o duelo que não começou: de volta ao Acampamento, sem resultado
  Game._saiDaRede = function () {
    rede = null; ultimoTurno = null; timerTurno = null;
    Game.state = null;
    resetAiState();
    resetTimer(true);
    Game.selectedSpellId = null;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    setScreen('hub');
  };
  // quem ficou (o líder caiu na colocação) passa a escolher a casa
  Game._assumeColocacao = function () { if (rede) rede.colocador = true; };
  // a ata que a líder não confirmou (a `cancela` dela): a parceira volta à
  // antessala da mesma sala, e a próxima ata vale
  Game._voltaAntessala = function () {
    if (!rede || rede.tipo !== 'grupo' || Game.screen !== 'battle' || !Game.dungeonId) return false;
    if (Game.state && Game.state.phase !== 'placing') return false;
    Game.state = null;
    resetAiState();
    resetTimer(false);
    timerTurno = null;
    ultimoTurno = null;
    Game.selectedSpellId = null;
    Game.pendingFusion = null;
    Game.mustEndTurn = false;
    setScreen('antessala', Game.salaInfo());
    avisaAntessala();
    return true;
  };

  function marcaRecompensaRede(rewards) {
    var c = C(), info = null;
    try { info = (c && c.aoFim) ? c.aoFim({ fase: 'won', roomIndex: Game.roomIndex }) : null; } catch (e) { info = null; }
    info = info || {};
    rewards.rede = true;
    rewards.lider = !!info.lider;
    rewards.parceiroVoltou = info.parceiroVoltou !== false;
    rewards.descidaAcabou = !!info.descidaAcabou;
    return rewards;
  }
  function fimGrupoPerdido() {
    var c = C(), info = null;
    try { info = (c && c.aoFim) ? c.aoFim({ fase: 'lost', roomIndex: Game.roomIndex }) : null; } catch (e) { info = null; }
    info = info || {};
    return { rede: true, lider: !!info.lider, parceiroVoltou: info.parceiroVoltou !== false,
             descidaAcabou: !!info.descidaAcabou };
  }
  /* O FIM DO DUELO EM REDE: venci pela perspectiva do MEU lado; o Coop manda o
   * `fim` e anota no histórico (amistoso: a Brasa só mostra "se valesse"). */
  function fimDueloRede() {
    var st = Game.state;
    registraFimVida(st);                 // 14/09: o meu lado sai do duelo com a vida com que terminou
    resetAiState();
    resetTimer(true);
    Game.selectedSpellId = null;
    Game.mustEndTurn = false;
    Game.pendingFusion = null;
    var lado = Game.meuLado(), fase = st.phase;
    var empate = fase === 'empate';
    var venci = !empate && ((fase === 'won' && lado === 'player') || (fase === 'lost' && lado === 'enemy'));
    var venc = empate ? 'empate' : (fase === 'won' ? 'A' : 'B');
    var h = 0;
    try { h = E().hash(st); } catch (e) { h = 0; }
    var c = C(), info = null;
    try {
      info = (c && c.aoFim) ? c.aoFim({ fase: fase, venc: venc, h: h, venci: venci, empate: empate,
                                        clima: st.weather }) : null;
    } catch (e2) { info = null; }
    info = info || {};
    var duplas = Game._duplas || { a: [], b: [] };
    var seValesse = null;
    try {
      // amistoso: a Brasa só MOSTRA quanto seria, com os pontos dos dois (1000 sem dado)
      if (JOGO.Brasa && JOGO.Brasa.elo && !empate) {
        var ptsEu = (typeof info.ptsMeus === 'number') ? info.ptsMeus : 1000;
        var ptsOutro = (typeof info.ptsDele === 'number') ? info.ptsDele : 1000;
        seValesse = JOGO.Brasa.elo(ptsEu, ptsOutro, venci).delta;
      }
    } catch (e3) {}
    setScreen('duelFim', {
      rede: true, venci: venci, empate: empate, wo: !!info.wo, desistencia: !!info.desistencia,
      contestado: !!info.contestado,       // anulado (divergência, lance ou fim forjado): sem vencedor
      oponente: info.oponente || (rede && rede.oponente) || '',
      duplaMinha: lado === 'player' ? duplas.a : duplas.b,
      duplaDele: lado === 'player' ? duplas.b : duplas.a,
      arena: info.arena || (rede && rede.arena) || null,
      modo: info.modo || null,             // 14/09: 'desafio' | 'arena' | 'campo' — a tela diz se valeu coroa e para onde volta
      clima: st.weather, seValesse: seValesse,
      // os campos do duelo de treino: a tela de hoje continua de pé
      venceuA: fase === 'won', duplaA: duplas.a, duplaB: duplas.b
    });
  }

  /* A VIDA DE UM DONO (15/09, a guerra): {heroId: PV do fim} (caído = 0; a fusão divide o PV dela) e o máximo —
   * a mesma conta do juiz (servidor/juiz/guerra.js, vidaPorDono), por dono e não por lado */
  function vidaDoDono(st, dono) {
    var fim = {}, maximos = {};
    for (var i = 0; st && st.units && i < st.units.length; i++) {
      var u = st.units[i];
      if (u.kind === 'hero' && u.dono === dono) {
        var hid = u.heroId || u.defId;
        if (typeof u.hpMax === 'number' && isFinite(u.hpMax) && u.hpMax > 0) maximos[hid] = Math.floor(u.hpMax);
        if (u.fusedInto) continue;
        fim[hid] = u.alive ? Math.max(0, Math.floor(u.hp)) : 0;
      } else if (u.kind === 'fusion') {
        var srcs = (u.fusedFrom || []).map(function (x) { return E().findUnit(st, x); })
          .filter(function (s) { return s && s.kind === 'hero' && s.dono; });
        if (!srcs.length) continue;
        var parte = u.alive ? Math.max(1, Math.floor(u.hp / srcs.length)) : 0;
        srcs.forEach(function (s) { if (s.dono === dono) fim[s.heroId || s.defId] = parte; });
      }
    }
    return { fim: fim, maximos: maximos };
  }
  Game._vidaDoDono = vidaDoDono;
  /* O FIM DA GUERRA DE GUILDA (15/09): a vitória é da GUILDA do meu lado. O Coop fecha no servidor (o XP da guilda
   * é de lá) e a tela mostra o resultado quando ele chega. */
  function fimGuerraRede() {
    var st = Game.state;
    registraFimVida(st);
    resetAiState();
    resetTimer(true);
    Game.selectedSpellId = null;
    Game.mustEndTurn = false;
    Game.pendingFusion = null;
    var lado = Game.meuLado(), fase = st.phase;
    var empate = fase === 'empate';
    var venci = !empate && ((fase === 'won' && lado === 'player') || (fase === 'lost' && lado === 'enemy'));
    var venc = empate ? 'empate' : (fase === 'won' ? 'A' : 'B');
    var h = 0;
    try { h = E().hash(st); } catch (e) { h = 0; }
    var c = C(), info = null;
    try {
      info = (c && c.aoFim) ? c.aoFim({ fase: fase, venc: venc, h: h, venci: venci, empate: empate, clima: st.weather }) : null;
    } catch (e2) { info = null; }
    info = info || {};
    var duplas = Game._duplas || { a: [], b: [] };
    setScreen('duelFim', {
      rede: true, guerra: true, venci: venci, empate: empate, venc: venc, wo: !!info.wo, desistencia: !!info.desistencia,
      gid: info.gid || (rede && rede.gid) || null, lado: rede ? rede.lado : 'A',
      guildas: info.guildas || (rede && rede.guildas) || null, jogadores: info.jogadores || (rede && rede.jogadores) || [],
      duplaA: duplas.a, duplaB: duplas.b, arena: (rede && rede.arena) || null, clima: st.weather,
      resultado: info.resultado || null
    });
  }

  /* [G10] QUEM O JOGADOR CONTROLA. Não basta ser do lado 'player': o pet e as
   * invocações são do lado do jogador e continuam sendo conduzidos pela IA
   * (contrato §5). O jogador controla o HERÓI e a UNIDADE FUNDIDA — a fusão é
   * o herói em outra forma, com feitiços próprios, e deixá-la de fora tirava o
   * controle do jogo até o fim da batalha (barra de feitiços vazia, cliques
   * ignorados e a IA jogando no lugar do jogador). */
  function isPlayerUnitLocal(u) {
    if (!u || (u.kind !== 'hero' && u.kind !== 'fusion')) return false;
    if (u.side === 'player') return true;
    // DUELO (hotseat): o lado enemy também é gente — o teclado passa de mão
    // e a IA fica só com mascotes e invocações dos dois lados
    return !!(Game.state && Game.state.pvp && u.side === 'enemy');
  }
  // [G11] em rede, "do jogador" é "MEU" (o dono é o meu id e não está na IA),
  // e nada é meu enquanto a batalha sincroniza ou o duelo espera os dois
  function isPlayerUnit(u) {
    if (rede) return Game.donoDe(u) === 'eu' && !travadoRede();
    return isPlayerUnitLocal(u);
  }
  Game.isPlayerUnit = isPlayerUnit;      // a UI usa para decidir o que desenhar

  Game.isPlayerTurn = function () {
    if (!Game.state || Game.state.phase !== 'playing') return false;
    var u = E() && E().activeUnit ? E().activeUnit(Game.state) : null;
    return isPlayerUnit(u);
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

  /* OS LANCES DA SALA SOLO (13/09): cada lance do jogador fica anotado no
   * formato da batalha em dupla, com o resultado — o que falha também, porque
   * a esquiva que falha gasta sorteio. O servidor refaz a sala com eles. */
  function anotaSolo(l) {
    if (ataSolo && !rede) {
      ataSolo.lances.push(l);
      // 15/09: o registro da luta aberta (autoridade.js) — a aba que fechar no meio fecha a sala daqui na volta
      // (a tentativa do Eco não tem bilhete: o registro dela é pela tentativa, 03/10)
      try { if (JOGO.Autoridade && JOGO.Autoridade.anotaLuta) JOGO.Autoridade.anotaLuta(ataSolo.bilhete || ataSolo.eco, ataSolo.lances); } catch (e) {}
    }
  }
  function castSolo(uid, spellId, x, y) {
    var ok = !!E().cast(Game.state, uid, spellId, x, y);
    anotaSolo({ a: 'c', u: uid, s: spellId, x: x, y: y, ok: ok });
    return ok;
  }

  Game.onTileClicked = function (x, y) {
    if (Game.screen !== 'battle' || !Game.state) return;
    /* 21/09: na preparação o toque na casa dourada só MARCA. Começar a luta é
     * do relógio (30 s) ou do PRONTO de todo mundo — antes o toque do líder
     * derrubava a rodada 1 na hora, e o parceiro nem via o mapa. Em dupla cada
     * um marca a SUA casa, das opções dele: não é mais coisa só de quem lidera. */
    if (Game.state.phase === 'placing') {
      Game.marcaCasa(x, y);
      return;
    }
    if (Game.state.phase !== 'playing' || !Game.isPlayerTurn()) return;
    var u = E().activeUnit(Game.state);
    if (!u) return;

    if (Game.selectedSpellId) {
      // 22/09: as casas que a TELA mostra como alvo (Game.alvosNaTela): a do
      // invisível do outro lado vai ao motor, que recusa e avisa
      var targets = [];
      try { targets = Game.alvosNaTela(u.uid, Game.selectedSpellId) || []; }
      catch (err) { targets = []; }
      for (var i = 0; i < targets.length; i++) {
        if (targets[i].x === x && targets[i].y === y) {
          var lancou = rede
            ? aplicaLocal({ a: 'c', u: u.uid, s: Game.selectedSpellId, x: x, y: y })
            : castSolo(u.uid, Game.selectedSpellId, x, y);
          if (lancou) Game.selectedSpellId = null;
          return;
        }
      }
      // [G3] fora da zona válida: só desmarca e volta ao modo de movimento
      Game.selectedSpellId = null;
      return;
    }

    // clique em unidade que se vê: nada. 22/09: a casa do invisível do outro
    // lado parece livre (Engine.reachable a pinta de azul) e vira o passo
    // normal — o motor esbarra e para antes, igual nos dois aparelhos e no juiz
    var ocup = E().unitAt(Game.state, x, y);
    if (ocup && !E().ocultoDe(u, ocup)) return;
    // [G11] em rede a tentativa viaja mesmo quando falha (a esquiva que falha
    // gasta sorteio e zera o PP: o outro motor precisa fazer o mesmo)
    if (rede) aplicaLocal({ a: 'm', u: u.uid, x: x, y: y });
    else {
      var okm = !!E().move(Game.state, u.uid, x, y);
      anotaSolo({ a: 'm', u: u.uid, x: x, y: y, ok: okm });
    }
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
    if (rede) {
      // [G11] o fim do turno é um lance `e` (botão, tempo ou fusão declarada)
      atualizaRelogioRede(true);
      closeTurnTimer();
      timerUid = null; timerTurno = null;
      var ua = E().activeUnit(Game.state);
      aplicaLocal({ a: 'e', u: ua ? ua.uid : null });
      return;
    }
    closeTurnTimer();
    timerUid = null;
    E().endTurn(Game.state);
    anotaSolo({ a: 'e', ok: true });
  };

  /* ============================================ A VIDA DE CADA HERÓI (14/09)
   * O pedido do dono: "hoje nas salas de espera a vida vai recuperando aos poucos até encher
   * ou o jogador usa pote; isso vale para quando terminar calabouço (na praça), depois de um
   * pvp e assim por diante; e se o jogador estiver com a vida na metade e começar uma batalha
   * sendo pvp, poço, desafio ou outro calabouço, a vida vai começar onde estava, na metade".
   *
   * A vida mora em JOGO.Vida (js/core/vida.js): UMA por herói da conta, contínua. Este bloco
   * é a ponte com a batalha:
   *   - TODA luta que acaba (vitória ou derrota; sala solo, Poço, sala em grupo e duelo em
   *     rede) grava a vida do fim dos MEUS heróis (registraFimVida) — quem caiu fica a 0 e
   *     volta a subir 1 PV a cada DATA.vidaEntreSalas.msPorPv;
   *   - TODA luta que começa nasce com a vida de agora (o carry: Vida.carry na sala solo,
   *     _carryPorta na ata do grupo, o `vida` da dupla no duelo). Com a autoridade ligada
   *     quem diz o número é o servidor (o carry do bilhete, do grupo_abrir, do duelo_abrir);
   *   - herói a 0 não entra (Game.esperaVida segura a porta; o servidor recusa com
   *     'vida-zero');
   *   - a poção se bebe FORA da batalha, em qualquer tela (Game.bebeNaEspera).
   * O DUELO DE TREINO (startDuel: a mesma conta dos dois lados, no mesmo teclado) não usa nem
   * gasta vida — é treino, e a mesma vida dos dois lados faria um herói lutar contra si mesmo.
   * Sem JOGO.Vida (as provas antigas, o juiz do servidor) todo herói está cheio. */
  function V() { return JOGO.Vida || null; }
  function msPorPv() {
    var v = (JOGO.DATA && JOGO.DATA.vidaEntreSalas) || {};
    return (typeof v.msPorPv === 'number' && isFinite(v.msPorPv) && v.msPorPv > 0) ? v.msPorPv : 2000;
  }
  /* {chave: PV máximo} dos heróis do jogador no fim da sala — a chave do carry. O juiz usa
   * a mesma (servidor/juiz/recompensa.js) para a API guardar o teto da vida. */
  function vidaMaxDe(st, emRede) {
    var out = {};
    for (var i = 0; st && st.units && i < st.units.length; i++) {
      var u = st.units[i];
      if (u.kind !== 'hero' || u.side !== 'player') continue;
      var k = emRede ? (u.dono || '') + ':' + (u.heroId || u.defId) : (u.heroId || u.defId);
      if (typeof u.hpMax === 'number' && isFinite(u.hpMax) && u.hpMax > 0) out[k] = Math.floor(u.hpMax);
    }
    return out;
  }
  Game._vidaMax = function (st, emRede) { return vidaMaxDe(st || Game.state, !!emRede); };

  // o servidor fechou (ou recusou) a luta: a vida daqui se acerta com a de lá
  function sincronizaVida() {
    var v = V();
    if (v && v.sincroniza) { try { v.sincroniza(); } catch (e) {} }
  }

  /* O FIM DE UMA LUTA NA VIDA ÚNICA: {heroId: PV do fim} só dos MEUS heróis (em grupo, as
   * chaves `dono:heroId` do meu dono viram heroId; no duelo em rede, o meu lado), com o PV
   * máximo de cada um. O treino hotseat não passa por aqui. */
  function registraFimVida(st) {
    var v = V();
    if (!v || !v.fim || !st || !st.units) return;
    var fim = {}, maximos = {};
    if (rede && rede.tipo === 'grupo') {
      if (!rede.eu) return;
      var pre = rede.eu + ':', cr = carryRede(st), mr = vidaMaxDe(st, true);
      Object.keys(cr).forEach(function (k) {
        if (k.indexOf(pre) !== 0) return;
        var hid = k.slice(pre.length);
        fim[hid] = cr[k];
        if (mr[k]) maximos[hid] = mr[k];
      });
    } else if (rede && rede.tipo === 'guerra') {
      // 15/09: os MEUS heróis são os do meu dono, e o meu parceiro de guilda está do mesmo lado
      var vd = vidaDoDono(st, rede.eu);
      fim = vd.fim; maximos = vd.maximos;
    } else if (rede && rede.tipo === 'duelo') {
      var lado = Game.meuLado();
      try { fim = E().vidaDoLado ? E().vidaDoLado(st, lado) : {}; } catch (e0) { fim = {}; }
      for (var i = 0; i < st.units.length; i++) {
        var u = st.units[i];
        if (u.kind === 'hero' && u.side === lado && typeof u.hpMax === 'number' && u.hpMax > 0) {
          maximos[u.heroId || u.defId] = Math.floor(u.hpMax);
        }
      }
    } else if (!st.pvp) {
      var cs = carrySolo(st), ms = vidaMaxDe(st, false);
      Object.keys(cs).forEach(function (hid) {
        if (Game.party.length && Game.party.indexOf(hid) < 0) return;
        fim[hid] = cs[hid];
        if (ms[hid]) maximos[hid] = ms[hid];
      });
    } else return;
    try { v.fim(fim, maximos); } catch (e) {}
  }

  /* o PV máximo de um herói CHEIO (sem registro): o do payload de batalha de agora, guardado
   * uns segundos — a HUD pergunta a cada tique */
  var maxGuardado = {};
  function maxDoHeroi(hid) {
    var t = Date.now(), g = maxGuardado[hid];
    if (g && t - g.t < 3000) return g.mx;
    var mx = 0;
    try {
      var pl = P() && P().battleParty ? P().battleParty([hid]) : null;
      var st0 = pl && pl[0] && pl[0].stats;
      if (st0 && typeof st0.hp === 'number' && isFinite(st0.hp)) mx = Math.floor(st0.hp);
    } catch (e) { mx = 0; }
    maxGuardado[hid] = { t: t, mx: mx };
    return mx;
  }
  function nomeDoHeroi(heroId) {
    var hid = String(heroId || ''), classe = hid.split('#')[0];
    try { var h = P() && P().hero ? P().hero(hid) : null; if (h && h.classId) classe = h.classId; } catch (e) {}
    var d = JOGO.DATA && JOGO.DATA.classes && JOGO.DATA.classes[classe];
    return (d && d.name) || hid;
  }
  function emGrupoRede() { return !!(rede && rede.tipo === 'grupo'); }
  /* a chave de um herói MEU → o heroId; null se é do parceiro ou não é da conta */
  function heroiDaChaveMinha(chave) {
    if (typeof chave !== 'string' || !chave) return null;
    var hid = chave;
    if (emGrupoRede() && rede.eu && chave.indexOf(rede.eu + ':') === 0) hid = chave.slice(rede.eu.length + 1);
    else if (chave.indexOf(':') >= 0) return null;
    try { return (P() && P().hero && P().hero(hid)) ? hid : null; } catch (e) { return null; }
  }
  // a vida dos heróis do PARCEIRO no grupo: [{chave, heroId, hp, max, cheioEmMs, ate1Ms}] (o `pronto` dele)
  function vidaDoParceiro() {
    var c = C(), l = null;
    try { l = (c && c.vidaParceiroDetalhe) ? c.vidaParceiroDetalhe() : null; } catch (e) { l = null; }
    return Object.prototype.toString.call(l) === '[object Array]' ? l : [];
  }
  function vidaMudou() {
    var c = C();
    if (emGrupoRede() && c && c.vidaMudou) { try { c.vidaMudou(); } catch (e) {} }
  }
  /* {chave: PV} dos MEUS heróis não cheios na sala solo (null = todos cheios) */
  function vidaCarrySolo() {
    var v = V();
    return v && v.carry ? v.carry(Game.party) : null;
  }
  /* O PV DA PORTA na ata do grupo sem servidor: os meus (Vida) e os do parceiro (o `pronto`) */
  function carryDaPortaGrupo() {
    if (!emGrupoRede()) return null;
    var out = null, v = V(), pre = (rede.eu || '') + ':';
    if (v && v.agora) {
      Game.party.forEach(function (hid) {
        var a = v.agora(hid);
        if (a) (out = out || {})[pre + hid] = a.hp;
      });
    }
    vidaDoParceiro().forEach(function (p) {
      if (p.hp < p.max) (out = out || {})[p.chave] = p.hp;
    });
    return out;
  }

  /* [{chave, heroId, nome, meu, hp, max, cheioEmS, ate1S, conferindo}] — a vida de cada herói
   * da tela AGORA, os meus primeiro. `heroIds` = os heróis da tela (a praça e as telas de fim
   * passam os escolhidos); sem ele, os da descida (Game.party) e, em grupo, os do parceiro.
   * O herói cheio também vem (hp = max): a HUD decide se mostra. */
  Game.vidaNaEspera = function (heroIds) {
    var v = V(), meus = [], deles = [];
    var dados = Object.prototype.toString.call(heroIds) === '[object Array]';
    var lista = dados ? heroIds : Game.party;
    var grupo = emGrupoRede();
    var vistos = {};
    (lista || []).forEach(function (hid) {
      if (typeof hid !== 'string' || !hid || vistos[hid]) return;
      vistos[hid] = true;
      var a = (v && v.agora) ? v.agora(hid) : null;
      var mx = a ? a.max : maxDoHeroi(hid);
      if (!mx) return;
      meus.push({ chave: grupo ? (rede.eu || '') + ':' + hid : hid, heroId: hid, nome: nomeDoHeroi(hid), meu: true,
                  hp: a ? a.hp : mx, max: mx, cheioEmS: a ? Math.ceil(a.cheioEmMs / 1000) : 0,
                  ate1S: a ? Math.ceil(a.ate1Ms / 1000) : 0, conferindo: false });
    });
    if (grupo && !dados) {
      vidaDoParceiro().forEach(function (p) {
        deles.push({ chave: p.chave, heroId: p.heroId, nome: nomeDoHeroi(p.heroId), meu: false, hp: p.hp, max: p.max,
                     cheioEmS: Math.ceil(p.cheioEmMs / 1000), ate1S: Math.ceil(p.ate1Ms / 1000), conferindo: false });
      });
    }
    return meus.concat(deles);
  };
  /* null = todos de pé; senão {chave, heroId, nome, meu, esperaS} do primeiro herói a 0 PV */
  Game.esperaVida = function (heroIds) {
    var lista = Game.vidaNaEspera(heroIds);
    for (var i = 0; i < lista.length; i++) {
      var x = lista[i];
      if (x.hp < 1) return { chave: x.chave, heroId: x.heroId, nome: x.nome, meu: x.meu, esperaS: Math.max(1, x.ate1S) };
    }
    return null;
  };
  function pocaoDef(id) {
    var c = (JOGO.DATA && JOGO.DATA.consumiveis) || {};
    var d = (typeof id === 'string' && Object.prototype.hasOwnProperty.call(c, id)) ? c[id] : null;
    return (d && d.tipo === 'vida' && typeof d.cura === 'number' && d.cura > 0) ? d : null;
  }
  /* [{id, def, n}] as poções de vida que a conta tem, da menor cura para a maior */
  Game.pocoesNaEspera = function () {
    var out = [], prog = P(), c = (JOGO.DATA && JOGO.DATA.consumiveis) || {};
    if (!prog || !prog.consumivelVer) return out;
    Object.keys(c).forEach(function (id) {
      var d = pocaoDef(id), n = d ? prog.consumivelVer(id) : 0;
      if (n > 0) out.push({ id: id, def: d, n: n });
    });
    out.sort(function (a, b) { return a.def.cura - b.def.cura; });
    return out;
  };
  /* null = pode beber; senão o porquê: 'batalha' (na luta não se bebe), 'heroi' (não é herói
   * meu), 'pocao', 'acabou', 'cheio', 'bebendo' (a anterior ainda está no servidor) */
  Game.podeBeberEspera = function (chave, pocaoId) {
    if (Game.screen === 'battle') return 'batalha';
    var hid = heroiDaChaveMinha(chave);
    if (!hid) return 'heroi';
    if (!pocaoDef(pocaoId)) return 'pocao';
    var prog = P();
    if (!prog || !prog.consumivelVer || prog.consumivelVer(pocaoId) < 1) return 'acabou';
    var v = V();
    if (!v || !v.agora || !v.agora(hid)) return 'cheio';
    if (bebendo) return 'bebendo';
    return null;
  };
  /* BEBER FORA DA BATALHA. Sem servidor, a poção sai do contador daqui e a cura entra na
   * vida na hora. Com a autoridade ligada, o servidor faz as duas coisas numa transação
   * (POST /api/vida/pocao), a página adota o estado dele, põe o PV que ELE devolveu e se
   * acerta com o GET /api/vida. Resolve {ok, cura, hp, max} ou {ok:false, motivo, erro}. */
  Game.bebeNaEspera = function (chave, pocaoId) {
    var motivo = Game.podeBeberEspera(chave, pocaoId);
    if (motivo) return Promise.resolve({ ok: false, motivo: motivo });
    var hid = heroiDaChaveMinha(chave), def = pocaoDef(pocaoId), A = JOGO.Autoridade, v = V();
    var antes = v.agora(hid), mx = antes ? antes.max : maxDoHeroi(hid);
    function feito(n) {
      var depois = v.agora(hid);
      vidaMudou();
      return { ok: true, cura: n, hp: depois ? depois.hp : mx, max: depois ? depois.max : mx };
    }
    if (!(A && A.ligada && A.ligada() && A.bebeVida)) {
      if (!P().gastaConsumivel(pocaoId, 1)) return Promise.resolve({ ok: false, motivo: 'acabou' });
      v.cura(hid, def.cura);
      return Promise.resolve(feito(def.cura));
    }
    bebendo = true;
    return A.bebeVida({ heroId: hid, pocaoId: pocaoId }).then(function (r) {
      bebendo = false;
      if (r && r.ok) {
        var n = (typeof r.cura === 'number' && r.cura > 0) ? r.cura : def.cura;
        if (typeof r.hp === 'number' && isFinite(r.hp)) {
          if (typeof r.hpMax === 'number' && r.hpMax >= 1) mx = Math.floor(r.hpMax);
          v.poe(hid, r.hp, mx);
        } else v.cura(hid, n);
        sincronizaVida();
        return feito(n);
      }
      if (r && r.motivo === 'cheio') sincronizaVida();     // o servidor já tinha a vida cheia
      return { ok: false, motivo: (r && r.motivo) || 'servidor', erro: (r && r.erro) || null };
    }, function () {
      bebendo = false;
      return { ok: false, motivo: 'servidor', erro: Tx('o servidor não respondeu') };
    });
  };
  /* {meuDono:heroId: PV agora} dos MEUS heróis da descida que não estão cheios — o `pronto`
   * leva ao parceiro (quem lidera põe na ata e espera todos com 1 PV) */
  Game.vidaMinhaNoGrupo = function () {
    var out = {}, v = V();
    if (!emGrupoRede() || !v || !v.agora) return out;
    Game.party.forEach(function (hid) {
      var a = v.agora(hid);
      if (a) out[(rede.eu || '') + ':' + hid] = a.hp;
    });
    return out;
  };

  // ------------------------------------------------------------- fusão [G4]
  function adjacent(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
  }

  Game.canFuse = function () {
    var out = [];
    if (Game.screen !== 'battle' || !Game.state || !Game.isPlayerTurn()) return out;
    var a = E().activeUnit(Game.state);
    // aqui `hero` é proposital e NÃO vira `isPlayerUnit`: quem já está fundido
    // não funde de novo (contrato §4 — "nenhum já fundido")
    if (!a || a.kind !== 'hero' || a.fused) return out;
    var F = JOGO.Fusion;
    var units = Game.state.units || [];
    for (var i = 0; i < units.length; i++) {
      var b = units[i];
      if (b === a || b.uid === a.uid) continue;
      if (b.kind !== 'hero' || !b.alive || b.side !== a.side || b.fused) continue;
      if (!adjacent(a, b)) continue;
      /* SÓ COM OS MEUS (12/09, pedido do dono): a fusão entre heróis de
       * JOGADORES diferentes não existe mais — nem com os dois aceitando, que
       * era a regra de 11/09. Quem decide é `Fusion.canFuse` (a mesma porta do
       * lance que vem pela Rede); aqui só não se oferece o que ele recusaria.
       * Em grupo, o herói do parceiro fica ao lado sem oferecer nada. */
      if (rede && (a.dono || null) !== (b.dono || null)) continue;
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
    var found = null;
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i].uidA === uidA && pairs[i].uidB === uidB) { found = pairs[i]; break; }
    }
    if (!found) return false;
    var F = JOGO.Fusion;
    if (!F || !F.declare) return false;
    var ok = false;
    if (rede) {
      // [G11] a declaração viaja como o lance `f` (os dois motores fundem
      // igual). Sem consentimento nenhum: 12/09, fundir é só com os MEUS.
      ok = aplicaLocal({ a: 'f', u: uidA, alvo: uidB });
    } else {
      try { ok = !!F.declare(Game.state, uidA, uidB); } catch (e) { ok = false; }
      anotaSolo({ a: 'f', u: uidA, alvo: uidB, ok: ok });
    }
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
  // id da pedra de forja do elemento pedido (DATA.stones; senão o próprio nome)
  function stoneIdFor(element) {
    var el = element || 'neutro';
    var defs = (JOGO.DATA && JOGO.DATA.stones) || {};
    for (var id in defs) {
      if (defs.hasOwnProperty(id) && defs[id] && defs[id].element === el) return id;
    }
    return el;
  }

  /* OS EVENTOS DO MUNDO (10/09): o fator de cada tipo vem da agenda
   * (js/core/agenda.js), já preso nos tetos e lido NA HORA da recompensa —
   * um instante só (`ts`) para todos os tipos da mesma sala. Defensivo de
   * ponta a ponta: sem o módulo (as páginas de teste que não o carregam) ou
   * com erro, o fator é 1 e o funil é exatamente o de antes. */
  function agendaAgora() {
    try { return (JOGO.Agenda && JOGO.Agenda.agora) ? JOGO.Agenda.agora() : undefined; }
    catch (e) { return undefined; }
  }
  function fAg(tipo, ts) {
    try {
      var v = (JOGO.Agenda && JOGO.Agenda.fator) ? JOGO.Agenda.fator(tipo, Game.dungeonId, ts) : 1;
      return (typeof v === 'number' && isFinite(v) && v > 1) ? v : 1;
    } catch (e) { return 1; }
  }
  // o evento que pesou, para a tela de recompensa dizer QUAL foi
  function evAg(tipo, fator, ts) {
    var v = null;
    try { v = (JOGO.Agenda && JOGO.Agenda.vencedor) ? JOGO.Agenda.vencedor(tipo, Game.dungeonId, ts) : null; }
    catch (e) { v = null; }
    return { id: v ? v.id : null, titulo: v ? v.titulo : '', tipo: tipo, fator: fator };
  }

  /* O PERGAMINHO DA SABEDORIA (Fase C, 10/09): o fator dele NESTA sala — 1
   * sem carga, e 1 também quando ninguém do grupo sobe mais de nível (XP
   * para quem está no teto só engordaria o pet e o dízimo de graça, sem o
   * pergaminho gastar nada). Defensivo como a agenda: sem o Progress novo,
   * ou com erro, é 1 e o funil é exatamente o de antes. */
  function pergaminhoXp(prog) {
    try {
      if (!prog || !prog.fatorPergaminhoXp) return 1;
      var f = prog.fatorPergaminhoXp();
      if (!(typeof f === 'number' && isFinite(f) && f > 1)) return 1;
      var lv = (JOGO.DATA && JOGO.DATA.leveling) || {};
      var teto = Math.min(num(lv.maxLevel, 30), (lv.xpTable && lv.xpTable.length) || 30);
      for (var i = 0; i < Game.party.length; i++) {
        var h = prog.hero ? prog.hero(Game.party[i]) : null;
        if (h && num(h.level, 1) < teto) return f;
      }
      return 1;
    } catch (e) { return 1; }
  }
  // o teto do XP comprado (2,0): pergaminho/bônus e evento juntos não passam
  // dele. 12/09: não é mais o teto do evento (que o Mestre sobe até ×20 desde 09/10) —
  // um evento acima de ×2 vale sozinho e o comprado pausa
  function tetoXp() {
    var t = null;
    try { t = JOGO.Agenda ? JOGO.Agenda.TETO_XP_COMPRADO : null; } catch (e) { t = null; }
    return (typeof t === 'number' && isFinite(t) && t >= 1) ? t : 2.0;
  }
  /* O BÔNUS DE XP POR TEMPO (loja 2, 10/09): o fator dele NESTA sala. `ts` é
   * o relógio do SERVIDOR que a agenda mede (ms); sem a agenda, o da máquina.
   * Não olha nível (não tem carga a poupar). Defensivo como o pergaminho: sem
   * o Progress novo, ou com erro, é 1 e o funil é exatamente o de antes. */
  function bonusTempoXp(prog, ts) {
    try {
      if (!prog || !prog.fatorBonusXp) return 1;
      // conserto da loja 2, 11/09: o prazo corre no relógio do SERVIDOR — sem ele medido NESTA
      // página (a agenda sem resposta ainda, ou fora do ar), o bônus pago não pesa; senão o cache
      // velho mais a hora do aparelho atrasada esticavam o prazo
      if (!(JOGO.Agenda && typeof JOGO.Agenda.medido === 'function' && JOGO.Agenda.medido())) return 1;
      var f = prog.fatorBonusXp((typeof ts === 'number' && isFinite(ts)) ? ts : Date.now());
      return (typeof f === 'number' && isFinite(f) && f > 1) ? f : 1;
    } catch (e) { return 1; }
  }

  // pedras derrubadas pelos inimigos mortos desta sala [G5]
  // `fPedras` (10/09) é o fator do evento do mundo de pedras. Só as pedras
  // ELEMENTAIS multiplicam — a Âncora fica fora, é a pedra rara da forja — e
  // o arredondamento é SORTEADO: floor(q·f + U) tem média exata q·f. Mas o
  // sorteio a mais só existe COM evento: sem ele, a contagem de Math.random
  // (e portanto todo o resto da sala) é a de sempre.
  var pedrasComEvento = false;
  Game._collectStones = function (u, m, p, f) { return collectStones(u, m, p, f); };   // prova (tests/gema.js)
  function collectStones(units, monsters, prog, fPedras) {
    var ganho = {}, i, algum = false;
    pedrasComEvento = false;
    for (i = 0; i < units.length; i++) {
      var u = units[i];
      if (u.side !== 'enemy' || u.alive) continue;
      var def = monsters[u.defId];
      var sd = def && def.stoneDrop;
      if (!sd) continue;
      // 07/10: o elite deixa pedra SEMPRE, uma a mais (js/core/elites.js). O sorteio da chance é
      // tirado do mesmo jeito (o gerador semeado do juiz anda igual nos dois lados)
      var ehElite = !!(u.elite && JOGO.Elites);
      var tirada = Math.random();
      if (!ehElite && tirada >= num(sd.chance, 0)) continue;
      var min = Math.max(0, Math.floor(num(sd.min, 1)));
      var max = Math.max(min, Math.floor(num(sd.max, min)));
      var qtd = min + Math.floor(Math.random() * (max - min + 1));
      if (ehElite) qtd = Math.max(1, qtd) + Math.max(0, Math.floor(num(JOGO.Elites.PEDRAS_A_MAIS, 1)));
      if (fPedras > 1 && qtd > 0) {
        qtd = Math.floor(qtd * fPedras + Math.random());
        pedrasComEvento = true;
      }
      if (qtd <= 0) continue;
      var sid = stoneIdFor(def.element);
      ganho[sid] = (ganho[sid] || 0) + qtd;
      algum = true;
    }
    // A ÂNCORA DE FORJA: só CHEFE derruba, e os mais fundos pagam mais —
    // é a pedra que segura o nível na batida arriscada (DATA.upgrade)
    // `D()` não existe neste arquivo — era um ReferenceError a CADA vitória
    // (03/09: o Julgamento do Mestre TRAVOU o jogo na tela de batalha)
    var upCfg = (JOGO.DATA && JOGO.DATA.upgrade) || {};
    var taxas = upCfg.guardDropByDungeon || {};
    for (i = 0; i < units.length; i++) {
      var ub = units[i];
      if (ub.side !== 'enemy' || ub.alive) continue;
      var db2 = monsters[ub.defId];
      if (!db2 || !db2.boss) continue;
      var taxa = num(taxas[Game.dungeonId], 0);
      if (taxa > 0 && Math.random() < taxa) {
        ganho[upCfg.guardStone || 'stone-anchor'] =
          (ganho[upCfg.guardStone || 'stone-anchor'] || 0) + 1;
        algum = true;
      }
    }
    /* 08/10: os FRAGMENTOS DE GEMA (DATA.gema.drop) — só nos SEIS PORTAIS (DATA.dungeons; o
     * Poço, o Eco, o Santuário e o PvP ficam fora): o chefe deixa sempre, o comum às vezes, o
     * elite um a mais. Sorteados DEPOIS de tudo o que já se sorteava, para não mexer no que
     * vinha antes; o que vem depois (itens, selos) anda — Engine.VERSAO_REGRAS subiu com isto. */
    var gcfg = (JOGO.DATA && JOGO.DATA.gema) || null, gdrop = gcfg && gcfg.drop;
    var dgs = (JOGO.DATA && JOGO.DATA.dungeons) || [], portalComum = false;
    for (var di = 0; di < dgs.length; di++) if (dgs[di] && dgs[di].id === Game.dungeonId) { portalComum = true; break; }
    if (gcfg && gdrop && gcfg.fragmento && portalComum) {
      for (i = 0; i < units.length; i++) {
        var uf = units[i];
        if (uf.side !== 'enemy' || uf.alive) continue;
        var df = monsters[uf.defId];
        if (!df) continue;
        var frag = 0;
        if (df.boss) {
          var cMin = Math.max(0, Math.floor(num(gdrop.chefeMin, 2))), cMax = Math.max(cMin, Math.floor(num(gdrop.chefeMax, cMin)));
          frag = cMin + Math.floor(Math.random() * (cMax - cMin + 1));
        } else if (Math.random() < num(gdrop.chance, 0)) {
          var fMin = Math.max(0, Math.floor(num(gdrop.min, 1))), fMax = Math.max(fMin, Math.floor(num(gdrop.max, fMin)));
          frag = fMin + Math.floor(Math.random() * (fMax - fMin + 1));
        }
        if (uf.elite && JOGO.Elites) frag += 1;
        if (frag <= 0) continue;
        ganho[gcfg.fragmento] = (ganho[gcfg.fragmento] || 0) + frag;
        algum = true;
      }
    }
    if (algum && prog && prog.addStones) {
      for (var sid2 in ganho) {
        if (!ganho.hasOwnProperty(sid2)) continue;
        try { prog.addStones(sid2, ganho[sid2]); } catch (err) { /* sem storage */ }
      }
    }
    return ganho;
  }

  /* A DUPLA PELA REDE NO SAQUE (11/09, achado 19 da revisão do multijogador).
   * Cada cliente da dupla sorteava o saque inteiro de quem joga sozinho com
   * dupla — e nada impede UMA pessoa de abrir dois navegadores (dois ids
   * locais, ou duas contas), chamar a si mesma para o grupo e jogar a sala com
   * um herói em cada janela: a mesma batalha, com o esforço de uma dupla solo,
   * rendia DOIS sorteios de item, de cartas, de pedras, selos e insígnias e o
   * dobro de vinténs (e a troca entre contas junta tudo numa só). A regra
   * agora é a dupla render o que UMA dupla solo rende:
   *   - o SAQUE da sala é um só para o grupo: a semente da ata (a mesma nos
   *     dois motores) diz de quem é a vez (Coop.vezDoSaque), e só esse cliente
   *     sorteia o item, as cartas, a carta de pet, as pedras, os selos e as
   *     insígnias, com as chances de sempre de quem joga sozinho com dupla;
   *   - os VINTÉNS se dividem: cada um leva FATOR_DUPLA (a metade);
   *   - o XP já se dividia (xpTotal / 2, só no meu herói).
   * Quem joga sozinho não muda em nada. Sem a vez da ata (o Coop sem ata),
   * vale a metade da chance, pelo sorteio local. */
  Game.FATOR_DUPLA = 0.5;
  function vezDoSaqueRede() {
    var c = C(), v = null;
    try { v = (c && c.vezDoSaque) ? c.vezDoSaque() : null; } catch (e) { v = null; }
    if (v === true || v === false) return { minha: v, pela: 'ata' };
    return { minha: Math.random() < 0.5, pela: 'sorte' };
  }

  /* O PV que atravessa para a próxima sala na descida SOZINHO (a do grupo é o
   * carryRede): herói vivo leva o que tem, caído leva 0, e a unidade FUNDIDA
   * divide o PV dela entre os heróis que a formaram. Função pura desde 13/09:
   * o juiz do servidor (servidor/juiz/recompensa.js) usa a mesma, e a próxima
   * sala só se refaz igual se o PV de entrada for o mesmo dos dois lados. */
  function carrySolo(st) {
    var out = {};
    for (var i = 0; i < st.units.length; i++) {
      var u = st.units[i];
      if (u.kind === 'hero') {
        out[u.heroId || u.defId] = u.alive ? u.hp : 0;
      } else if (u.kind === 'fusion' && u.side === 'player') {
        var donos = fusionHeroIds(u);
        if (!donos.length) continue;
        var parte = u.alive ? Math.max(1, Math.floor(u.hp / donos.length)) : 0;
        for (var f = 0; f < donos.length; f++) out[donos[f]] = parte;
      }
    }
    return out;
  }
  /* A SEGURANÇA (13/09): o juiz roda ESTE game.js no servidor e pede a
   * recompensa da sala refeita pelo mesmo funil — sem segunda cópia das regras. */
  Game._carrySolo = function (st) { return carrySolo(st || Game.state); };
  Game._computeRewards = function () { return computeRewards(); };

  function computeRewards() {
    var st = Game.state;
    var prog = P();
    // [G11] em grupo pela Rede o grupo é o da ATA (2 heróis de gente), nunca o
    // Game.party (que é só o meu): saque, cartas e XP com as MESMAS chances de
    // quem joga sozinho com dupla — jogar em dupla não multiplica item bom
    var partySize = (rede && rede.tipo === 'grupo') ? partySizeRede() : (Game.party.length || 1);
    // 11/09 (achado 19): na dupla pela Rede a sala tem UM saque para o grupo (a
    // vez da ata) e os vinténs se dividem; fora dela, nada muda (×1 no fim)
    var saqueDupla = (rede && rede.tipo === 'grupo') ? vezDoSaqueRede() : null;
    var rolaSaque = !saqueDupla || saqueDupla.minha;
    var fDupla = saqueDupla ? Game.FATOR_DUPLA : 1;
    var monsters = (JOGO.DATA && JOGO.DATA.monsters) || {};
    var xpTotal = 0, i;

    for (i = 0; i < st.units.length; i++) {
      var u = st.units[i];
      if (u.side !== 'enemy' || u.alive) continue;
      var def = monsters[u.defId];
      // 07/10: o elite da sala paga ×1,5 (js/core/elites.js, Elx.XP) — e os vinténs, que derivam daqui
      var fElite = (u.elite && JOGO.Elites) ? num(JOGO.Elites.XP, 1.5) : 1;
      if (def && typeof def.xp === 'number') xpTotal += def.xp * fElite;
    }
    /* A DIFICULDADE ENTRA AQUI, sobre o total ja somado.
     *
     * `DATA.leveling` esta congelada por coordenacao com o `xp` dos monstros, e
     * o multiplicador nao encosta nela: a economia base fica intacta e o que
     * muda e so o que ESTA sala pagou. Uma sala jogada no dificil paga 60% mais
     * pela mesma lista de mortos. */
    var difSala = E().dif(st);
    /* O DESAFIO CUMPRIDO paga +25% de XP e de saque — multiplicador ao lado
     * do da dificuldade, no mesmo lugar, pela mesma razão: a economia base
     * (DATA.leveling, congelada) não é tocada; o que muda é o que ESTA sala
     * pagou. */
    var desafioSala = st.desafio || null;
    var bonusDesafio = (desafioSala && desafioSala.cumprido)
      ? (1 + (E().DESAFIO_BONUS || 0.25)) : 1;
    /* O AFIXO DA SALA (07/10, js/core/afixos.js) paga +25% de XP e de saque, ao lado do desafio e pela
     * mesma razão: a economia base não é tocada, muda só o que ESTA sala pagou. O número mora em Af.BONUS. */
    var afixoSala = st.afixo || null;
    var bonusAfixo = (afixoSala && JOGO.Afixos) ? (1 + num(JOGO.Afixos.BONUS, 0.25)) : 1;
    bonusDesafio *= bonusAfixo;
    /* O POÇO paga na moeda da escalada (25/08): o mesmo fator que engordou
     * os inimigos multiplica o XP — andar 11 rende o dobro do andar 1. */
    var fatorPoco = (Game.dungeonId === 'poco' && JOGO.Poco)
      ? JOGO.Poco.fator(Game.roomIndex + 1) : 1;
    // o BÔNUS DE GUILDA comprado pelo líder (25/08): +15% de XP por 24h
    var fatorGuildaXp = (JOGO.Guilda && JOGO.Guilda.bonusAtivo && JOGO.Guilda.bonusAtivo('xp'))
      ? JOGO.Guilda.BONUS_FATOR : 1;
    /* O EVENTO DO MUNDO de XP (10/09) entra no mesmo produto, por ÚLTIMO: o
     * corte por herói, o dízimo e a fatia do pet herdam sozinhos. Sem evento
     * o fator é 1, e ×1 no fim do produto não mexe em bit nenhum. */
    var tAg = agendaAgora();
    var fEvXp = fAg('xp', tAg);
    /* O PERGAMINHO DA SABEDORIA (Fase C) entra no MESMO lugar do evento,
     * sem passar do teto dele: fXp = max(fEvXp, min(TETO_XP, fEvXp × fPerg)).
     * Com evento ×2,0 no ar o pergaminho pausa sozinho; com ×1,5, os dois
     * juntos dão ×2,0. Dificuldade, desafio, Poço e guilda seguem por fora,
     * como sempre — o teto absoluto (4,6×) não sobe. Sem carga, fXp É fEvXp
     * (o mesmo número): o funil sem pergaminho não muda um bit. */
    /* O BÔNUS DE XP POR TEMPO (loja 2, 10/09): 1, 3 ou 7 dias de ×1,5 no
     * relógio do SERVIDOR — o mesmo instante `tAg` da agenda. Ele e o
     * pergaminho NÃO se multiplicam: com o bônus no ar o pergaminho PAUSA
     * (fPerg = 1: não multiplica nem gasta carga) e o bônus entra no lugar
     * dele, pela mesma regra do teto. Sem bônus, fTempo = 1 e o funil é o de
     * antes, bit a bit. */
    var fTempo = bonusTempoXp(prog, tAg);
    var fPerg = (fTempo > 1) ? 1 : pergaminhoXp(prog);
    var fBonus = Math.max(fTempo, fPerg);
    var fXp = (fBonus > 1) ? Math.max(fEvXp, Math.min(tetoXp(), fEvXp * fBonus)) : fEvXp;
    /* OS FEITOS DE COLEÇÃO (07/10, Progress.feitos): os seis chefes e as 21 fusões dão +5% de XP cada, em toda
     * sala; o bestiário completo de um portal dá +10% de saque LÁ (abaixo, no rollDrops). Fator 1 sem feito. */
    var fFeitoXp = 1, fFeitoSaque = 1;
    try { if (prog && prog.feitoXp) fFeitoXp = num(prog.feitoXp(), 1); } catch (eF1) { fFeitoXp = 1; }
    try { if (prog && prog.feitoSaque) fFeitoSaque = num(prog.feitoSaque(Game.dungeonId), 1); } catch (eF2) { fFeitoSaque = 1; }
    /* O BÔNUS DE DESCANSO (08/10 à noite): XP em DOBRO nas três primeiras salas vencidas do dia (Progress.descanso,
     * no dia de Brasília pelo relógio do servidor). Fora do teto do comprado: é regra do jogo, não compra. Sem a
     * agenda medida nesta página o fator é 1 — o juiz, que tem o relógio, decide, e o cliente adota o estado dele. */
    var fDescanso = 1, descansoAntes = null;
    try {
      if (prog && prog.descanso && typeof tAg === 'number' && JOGO.Agenda && JOGO.Agenda.medido && JOGO.Agenda.medido()) {
        descansoAntes = prog.descanso(tAg);
        if (descansoAntes) fDescanso = descansoAntes.fator;
      }
    } catch (eD) { fDescanso = 1; descansoAntes = null; }
    var xpGanho = Math.floor(xpTotal / partySize * (difSala.xp || 1) * bonusDesafio *
                             fatorPoco * fatorGuildaXp * fXp * fFeitoXp * fDescanso);
    /* a carga só se gasta quando o pergaminho ACRESCENTOU XP nesta sala
     * (o grupo ganhou mais do que ganharia sem ele); o bônus por tempo não
     * tem carga — quando ele pesou, só se anota, para a tela dizer */
    var pergaminhoSala = null, bonusTempoSala = null;
    if (fXp > fEvXp) {
      var xpSemPerg = Math.floor(xpTotal / partySize * (difSala.xp || 1) * bonusDesafio *
                                 fatorPoco * fatorGuildaXp * fEvXp * fFeitoXp * fDescanso);
      if (xpGanho > xpSemPerg && xpGanho > 0) {
        if (fPerg > 1) {
          var restamPerg = 0;
          try { restamPerg = prog.gastaCargaXp(); } catch (eP) { restamPerg = 0; }
          pergaminhoSala = { fator: fXp / fEvXp, restam: restamPerg };
        } else if (fTempo > 1) {
          var ateBonus = 0;
          try { ateBonus = prog.bonusXpAte(); } catch (eB) { ateBonus = 0; }
          bonusTempoSala = { fator: fXp / fEvXp, ate: ateBonus };
        }
      }
    }

    /* VINTENS — a moeda, derivada do MESMO xpTotal.
     *
     * 0,30 por ponto de xp, vezes o multiplicador de drop da dificuldade.
     * Amarrar ao xp herda toda a calibragem de economia ja feita: monstro que
     * paga mais xp paga mais vintem, sala funda paga mais que rasa — sem uma
     * segunda tabela para manter em paralelo.
     *
     * SEM dividir por partySize: a carteira e DO GRUPO. E uma so, e e o que
     * permite banco e troca sem contabilidade por personagem. */
    // o evento de VINTÉNS (10/09), teto 1,5: mais moeda só compra do mercador, que vende comum e raro
    var fEvVintem = fAg('vintem', tAg);
    var moedasGanhas = Math.floor(xpTotal * 0.30 * (difSala.drop || 1) * bonusDesafio * fEvVintem * fDupla);
    if (moedasGanhas > 0 && JOGO.DB && JOGO.DB.ganharMoedas) {
      // e-assincrono e o resultado nao bloqueia a tela de recompensa: o numero
      // ganho vem no payload; o TOTAL a tela busca por conta propria no DB.
      try { JOGO.DB.ganharMoedas(moedasGanhas); } catch (e) {}
    }

    // cartas do chefe: acumulam na coleção e podem virar estrela (§9-B)
    var cards = [];
    if (prog && prog.rollCards && rolaSaque) {
      try { cards = prog.rollCards(Game.dungeonId, Game.roomIndex, partySize) || []; }
      catch (err) { cards = []; }
    }

    var fEvPedras = fAg('pedras', tAg);   // 10/09: só as elementais; a Âncora fica fora
    var stones = {};
    if (rolaSaque) stones = collectStones(st.units, monsters, prog, fEvPedras);
    else pedrasComEvento = false;         // achado 19: a vez do saque desta sala é do parceiro

    /* OS SELOS DO COLECIONADOR (25/08): SÓ chefe derruba, e derruba o selo
     * do PRÓPRIO elemento (os seis chefes cobrem os cinco; no Poço eles
     * revezam). A chance é UMA e mora em DATA.selos — calibragem do dono. */
    var selosGanhos = {};
    var cfgSelos = (JOGO.DATA && JOGO.DATA.selos) || null;
    if (cfgSelos && prog && prog.addSelo && rolaSaque) {
      for (i = 0; i < st.units.length; i++) {
        var us = st.units[i];
        if (us.side !== 'enemy' || us.alive) continue;
        var ds2 = monsters[us.defId];
        if (!ds2 || !ds2.boss || !ds2.element) continue;
        if (Math.random() >= num(cfgSelos.chance, 0.5)) continue;
        if (prog.addSelo(ds2.element, 1)) {
          selosGanhos[ds2.element] = (selosGanhos[ds2.element] || 0) + 1;
        }
      }
    }

    /* A INSÍGNIA DE FUNDAÇÃO (30/08): o bloco irmão dos selos — SÓ chefe
     * derruba, sorteio próprio (DATA.insignias), e 10 fundam uma guilda.
     * Sorteio separado de propósito: um chefe pode pagar selo E insígnia na
     * mesma queda, ou nenhum dos dois — moedas com donos diferentes não
     * dividem a mesma rolagem. */
    var insigniasGanhas = 0;
    var cfgIns = (JOGO.DATA && JOGO.DATA.insignias) || null;
    if (cfgIns && prog && prog.addInsignia && rolaSaque) {
      for (i = 0; i < st.units.length; i++) {
        var ui2 = st.units[i];
        if (ui2.side !== 'enemy' || ui2.alive) continue;
        var ds3 = monsters[ui2.defId];
        if (!ds3 || !ds3.boss) continue;
        if (Math.random() >= num(cfgIns.chance, 0.5)) continue;
        if (prog.addInsignia(1)) insigniasGanhas++;
      }
    }

    // [G9] rendimento decrescente por herói (§9-D): conteúdo fácil paga menos.
    // Vale só para XP — item, pedra e carta seguem suas próprias raridades.
    // O DÍZIMO DA GUILDA (30/08): o líder define a % do XP que cada membro
    // doa — o desconto é REAL (o herói fica com o resto) e a soma vai para a
    // guilda no mesmo funil, fire-and-forget como os vinténs.
    var levelUps = [], xpMult = {}, xpPorHeroi = {};
    var petXp = {}, petLevelUps = [];   // 03/09: a fatia do pet e os níveis dele
    var dizimoPct = 0, dizimoSoma = 0;
    try {
      if (JOGO.Guilda && JOGO.Guilda.dizimoAtual) {
        dizimoPct = num(JOGO.Guilda.dizimoAtual(), 0);
      }
    } catch (ed) { dizimoPct = 0; }
    if (!(dizimoPct > 0 && dizimoPct <= 50)) dizimoPct = 0;
    if (prog && prog.addXp) {
      for (var h = 0; h < Game.party.length; h++) {
        var heroId = Game.party[h];
        var mult = 1;
        try { if (prog.xpMultiplier) mult = prog.xpMultiplier(heroId, Game.dungeonId); }
        catch (err) { mult = 1; }
        if (typeof mult !== 'number' || !isFinite(mult) || mult < 0) mult = 1;
        var xpHeroi = Math.floor(xpGanho * mult);
        if (dizimoPct > 0 && xpHeroi > 0) {
          var doa = Math.floor(xpHeroi * dizimoPct / 100);
          dizimoSoma += doa;
          xpHeroi -= doa;
        }
        xpMult[heroId] = mult;
        xpPorHeroi[heroId] = xpHeroi;
        var gained = 0;
        try { gained = prog.addXp(heroId, xpHeroi); } catch (err2) { gained = 0; }
        if (gained > 0) {
          var hero = prog.hero ? prog.hero(heroId) : null;
          levelUps.push({ heroId: heroId, niveis: gained, novoNivel: hero ? hero.level : null });
        }
        // o pet vestido leva a fatia dele do XP (03/09) — e pode subir de nível
        if (prog.addPetXpFromOwner) {
          try {
            var pxp = prog.addPetXpFromOwner(heroId, xpHeroi);
            if (pxp) { petXp[heroId] = pxp; if (pxp.niveis > 0) petLevelUps.push(pxp); }
          } catch (err3) {}
        }
      }
    }
    if (dizimoSoma > 0) {
      try { JOGO.Guilda.doarXp(dizimoSoma); } catch (eg) {}
    }

    // O POÇO anota o andar limpo (25/08): melhor da semana + recorde da conta
    if (Game.dungeonId === 'poco' && JOGO.DB && JOGO.DB.pocoAnota && JOGO.Poco) {
      try { JOGO.DB.pocoAnota(Game.roomIndex + 1, JOGO.Poco.semanaDe()); } catch (ep) {}
    }

    var drops = [], pets = [];
    var fSaque = 1, saqueDoEvento = false;
    if (prog && prog.rollDrops && rolaSaque) {
      // O CALABOUÇO DO DIA (25/08): o portal marcado paga +50% de saque
      var bonusDia = (JOGO.Diario && JOGO.Diario.ehHoje &&
                      JOGO.Diario.ehHoje(Game.dungeonId)) ? JOGO.Diario.BONUS_DROP : 1;
      /* O EVENTO DE SAQUE (10/09) NÃO EMPILHA com o Dia: vale o maior dos
       * dois (decisão D2 do dono), e o teto absoluto do saque segue nos
       * 3,23× de sempre (difícil × desafio × Dia × guilda). É o único tipo
       * que aumenta as peças boas por hora: divide o peso do "nada" e nunca
       * mexe na proporção entre as raridades. */
      fSaque = fAg('saque', tAg);
      var bonusSaque = Math.max(bonusDia, fSaque);
      saqueDoEvento = fSaque > bonusDia;
      // e o bônus de guilda de SAQUE, no mesmo funil dos outros (25/08)
      var bonusGuilda = (JOGO.Guilda && JOGO.Guilda.bonusAtivo && JOGO.Guilda.bonusAtivo('drop'))
        ? JOGO.Guilda.BONUS_FATOR : 1;
      try { drops = prog.rollDrops(Game.dungeonId, Game.roomIndex, partySize,
                                   (difSala.drop || 1) * bonusDesafio * bonusSaque * bonusGuilda * fFeitoSaque) || []; }
      catch (err) { drops = []; }
    }
    /* OS CONTADORES DOS FEITOS (07/10): cada monstro caído entra no bestiário, e cada dupla fundida viva no fim
     * conta uma sala vencida. Antes do save, no mesmo funil — o juiz anota o mesmo (o estado é do servidor). */
    if (prog && prog.anotaBestiario) {
      for (i = 0; i < st.units.length; i++) {
        var ub2 = st.units[i];
        if (ub2.side !== 'enemy' || ub2.alive || ub2.kind !== 'monster') continue;
        try { prog.anotaBestiario(ub2.defId, 1); } catch (eB) {}
      }
    }
    if (prog && prog.anotaFusaoVencida) {
      for (i = 0; i < st.units.length; i++) {
        var uf2 = st.units[i];
        if (uf2.side !== 'player' || uf2.kind !== 'fusion' || !uf2.alive) continue;
        var par2 = fusionHeroIds(uf2);
        if (par2.length === 2) { try { prog.anotaFusaoVencida(par2[0], par2[1]); } catch (eU) {} }
      }
    }
    /* CARTAS DE PET (03/09): o chefe não entrega mais o bicho inteiro — derruba
     * UMA carta do pet daquele calabouço, e com 5 o pet é seu (a gramática das
     * cartas de personagem). `pets` segue listando o bicho NOVO para a tela. */
    var petCards = [];
    if (prog && prog.rollPetCards && rolaSaque) {
      try { petCards = prog.rollPetCards(Game.dungeonId, Game.roomIndex, partySize) || []; }
      catch (err) { petCards = []; }
      for (i = 0; i < petCards.length; i++) if (petCards[i].novoPet) pets.push(petCards[i].petId);
    }

    /* OS TÍTULOS DE CHEFE (11/09): dez quedas do mesmo chefe, no DIFÍCIL e
     * SOZINHO, valem um título (js/core/titulos.js). A conta é anotada aqui
     * porque é aqui que se sabe, ao mesmo tempo, QUAL chefe caiu, em que
     * dificuldade e com quanta gente — `partySize` já cobre o grupo da Rede.
     * Fire-and-forget, como as missões: troféu não segura recompensa. */
    if (JOGO.DB && JOGO.DB.chefeAbatido && partySize === 1 &&
        (difSala.id || 'normal') === 'dificil') {
      for (i = 0; i < st.units.length; i++) {
        var uc = st.units[i];
        if (uc.side !== 'enemy' || uc.alive) continue;
        var dc = monsters[uc.defId];
        if (!dc || !dc.boss) continue;
        try { JOGO.DB.chefeAbatido(uc.defId); } catch (eT) {}
      }
    }

    /* O QUADRO DE MISSÕES ouve a vitória por evento explícito — este é o único
     * lugar que sabe, ao mesmo tempo, a dificuldade, o desafio e se havia
     * fusão viva. Fire-and-forget: recompensa não espera missão. */
    if (JOGO.Missoes && JOGO.Missoes.registra) {
      var comFusao = false;
      for (i = 0; i < st.units.length; i++) {
        var uf = st.units[i];
        if (uf.side === 'player' && uf.kind === 'fusion' && uf.alive) comFusao = true;
      }
      try {
        JOGO.Missoes.registra({ tipo: 'vitoria', dungeon: Game.dungeonId,
          dificuldade: difSala.id || 'normal',
          desafioCumprido: !!(desafioSala && desafioSala.cumprido),
          fundido: comFusao });
      } catch (e) {}
    }

    var elementChoices = Game.elementChoices();

    /* os eventos do mundo que PESARAM nesta sala, para a tela dizer por quê
     * (10/09) — no saque, só quando o evento venceu o Dia */
    var eventos = [];
    if (fEvXp > 1 && xpGanho > 0) eventos.push(evAg('xp', fEvXp, tAg));
    // o pergaminho que pesou, no mesmo formato: a chipsEvento('xp') da HUD mostra
    if (pergaminhoSala) {
      eventos.push({ id: null, titulo: Tx('Pergaminho da Sabedoria'), tipo: 'xp',
                     fator: pergaminhoSala.fator, origem: 'pergaminho', restam: pergaminhoSala.restam });
    }
    // o bônus de XP por tempo que pesou (loja 2): o chip diz quanto ainda falta
    if (bonusTempoSala) {
      eventos.push({ id: null, titulo: Tx('Bônus de XP'), tipo: 'xp', fator: bonusTempoSala.fator,
                     origem: 'bonus-tempo', ate: bonusTempoSala.ate });
    }
    if (fEvVintem > 1 && moedasGanhas > 0) eventos.push(evAg('vintem', fEvVintem, tAg));
    if (fEvPedras > 1 && pedrasComEvento) eventos.push(evAg('pedras', fEvPedras, tAg));
    if (saqueDoEvento) eventos.push(evAg('saque', fSaque, tAg));

    // 08/10 à noite: a sala vencida conta para o descanso de hoje (antes do save, no mesmo funil do juiz)
    var descansoSala = null;
    if (descansoAntes && prog && prog.anotaDescanso) {
      try {
        var dDepois = prog.anotaDescanso(tAg);
        if (dDepois) {
          descansoSala = { fator: fDescanso, usadas: Math.min(prog.DESCANSO_SALAS, dDepois.salas), de: prog.DESCANSO_SALAS,
                           restam: dDepois.restam };
        }
      } catch (eD2) { descansoSala = null; }
    }
    if (prog && prog.save) { try { prog.save(); } catch (err) { /* sem storage */ } }

    return {
      xpGanho: xpGanho,          // XP da sala já dividida pelo grupo, ANTES do corte
      xpMult: xpMult,            // multiplicador aplicado a cada herói (§9-D)
      xpPorHeroi: xpPorHeroi,    // o que cada herói realmente recebeu
      levelUps: levelUps,
      moedas: moedasGanhas,
      saqueDupla: saqueDupla,    // 11/09 (achado 19): na dupla pela Rede, {minha, pela}: de quem foi a vez do saque; senão null
      dificuldade: difSala.id || 'normal',
      difNome: difSala.nome || Tx('Normal'),
      desafio: desafioSala ? { id: desafioSala.id, nome: desafioSala.nome,
                               texto: desafioSala.texto,
                               cumprido: !!desafioSala.cumprido } : null,
      // 07/10: o afixo com que a sala foi jogada (pagou +25% de XP e saque), para a tela dizer
      afixo: afixoSala ? { id: afixoSala.id, nome: afixoSala.nome, texto: afixoSala.texto,
                           icone: afixoSala.icone || '', bonus: bonusAfixo } : null,
      drops: drops,
      pets: pets,
      petCards: petCards,        // 03/09: as cartas de bicho do chefe
      petXp: petXp,              // a fatia do pet, por herói
      petLevelUps: petLevelUps,  // [{petId, niveis, novoNivel}]
      cards: cards,
      stones: stones,
      selos: selosGanhos,
      insignias: insigniasGanhas,
      dizimo: dizimoSoma > 0 ? { pct: dizimoPct, doado: dizimoSoma } : null,
      eventos: eventos,          // 10/09: [{id, titulo, tipo, fator}] — os eventos do mundo que pesaram
      pergaminho: pergaminhoSala, // Fase C: {fator, restam} quando o Pergaminho da Sabedoria gastou carga; senão null
      bonusXp: bonusTempoSala,    // loja 2: {fator, ate} quando o bônus de XP por tempo pesou; senão null
      descanso: descansoSala,     // 08/10 à noite: {fator, usadas, de, restam} — o bônus de descanso desta sala (fator 1 = já usado hoje)
      elementChoices: elementChoices
    };
  }

  /* Heróis que formaram uma unidade fundida. O Engine é de outro dono, então
   * aceitamos as formas plausíveis: `heroIds`, `from` (uids ou heroIds) ou o
   * `heroId` simples. Sem nenhuma, devolve lista vazia e nada se perde. */
  function fusionHeroIds(u) {
    var out = [], i, v;
    var fonte = null;
    if (Object.prototype.toString.call(u.heroIds) === '[object Array]') fonte = u.heroIds;
    else if (Object.prototype.toString.call(u.from) === '[object Array]') fonte = u.from;
    if (fonte) {
      for (i = 0; i < fonte.length; i++) {
        v = fonte[i];
        if (typeof v !== 'string') continue;
        var alvo = null;
        for (var k = 0; k < Game.state.units.length; k++) {
          if (Game.state.units[k].uid === v) { alvo = Game.state.units[k]; break; }
        }
        out.push(alvo ? (alvo.heroId || alvo.defId) : v);   // uid vira heroId; senão é o próprio
      }
    } else if (typeof u.heroId === 'string') out.push(u.heroId);
    return out;
  }

  /* A SALA FECHADA NO SERVIDOR (13/09, a segurança): quem paga é o servidor.
   * Vão o bilhete, os lances e o hash do fim; volta a recompensa (o MESMO
   * objeto do computeRewards, calculado lá com o estado do servidor) e o
   * estado novo, que a Autoridade já adotou. A derrota também vai (a sala
   * fecha lá), sem esperar. */
  /* 08/10 à noite (o dono: "fui na Cisterna dos Afogados com duas contas, 4 personagens nível 1, ativei
   * x3 o bônus de XP e todas as XPs foram zeradas"): o juiz paga certo (tests/juiz_grupo_xp.js); o zero vem
   * de quando o servidor NÃO confirma a vitória — e o porquê só passava num toast que some. Agora a
   * recompensa vazia leva o `recusadaMotivo` (o código do servidor: rapido-demais, regras-mudaram,
   * fotografada/nao-conferida, vencida, divergiu…, ou sem-resposta) e a frase dele em `recusada`; a tela
   * de recompensa (hud.js, o bloco Experiência) imprime uma linha fixa dizendo por que a sala não rendeu. */
  function recompensaVazia(motivo, codigo) {
    return { xpGanho: 0, xpMult: {}, xpPorHeroi: {}, levelUps: [], moedas: 0, saqueDupla: null,
             dificuldade: Game.dificuldade || 'normal', difNome: '', desafio: null, drops: [], pets: [],
             petCards: [], petXp: {}, petLevelUps: [], cards: [], stones: {}, selos: {}, insignias: 0,
             dizimo: null, eventos: [], pergaminho: null, bonusXp: null,
             elementChoices: Game.elementChoices(), recusada: motivo || null, recusadaMotivo: codigo || null };
  }
  /* o código da recusa do servidor: o `motivo` (rapido-demais, regras-mudaram, vencida, vez, divergiu, outro-aparelho…),
   * senão a `fase` da sala já fechada (recusada, perdida, nao-conferida), senão a resposta que não veio */
  function codigoDaRecusa(r) {
    if (!r) return 'sem-resposta';
    if (typeof r.motivo === 'string' && r.motivo) return r.motivo;
    if (typeof r.fase === 'string' && r.fase && r.fase !== 'won') return r.fase;
    if (r.ok && r.fase === 'won') return 'sem-recompensa';
    return 'recusada';
  }
  function fechaNoServidor(fase) {
    var ata = ataSolo;
    ataSolo = null;
    if (!ata || !JOGO.Autoridade) return;
    var hashFinal = 0;
    try { hashFinal = E().hash(Game.state); } catch (e) { hashFinal = 0; }
    var promessa = JOGO.Autoridade.fecha(ata.bilhete, ata.lances, hashFinal);
    promessa.then(sincronizaVida);                     // 14/09: o servidor gravou a vida do fim (vitória e derrota)
    // 07/10: os pontos da trilha da temporada e a meta da semana da guilda que esta sala rendeu (a HUD avisa)
    promessa.then(function (r) {
      try { if (r && r.ok && r.trilha && JOGO.Trilha && JOGO.Trilha.anota) JOGO.Trilha.anota(r.trilha); } catch (e1) {}
      try {
        if (r && r.ok && r.guildaMeta && r.guildaMeta.cumpriuAgora) {
          window.dispatchEvent(new CustomEvent('soterra:guilda-meta', { detail: r.guildaMeta }));
        }
      } catch (e2) {}
    });
    if (fase !== 'won') return;
    conferindoSala = true;
    var lastRoom = ultimaSalaDe(Game.dungeonId);
    var tela = (Game.roomIndex >= lastRoom) ? 'dungeonComplete' : 'roomClear';
    try { if (JOGO.UI && JOGO.UI.toast) JOGO.UI.toast(Tx('Conferindo a vitória com o servidor…')); } catch (eT) {}
    promessa.then(function (r) {
      conferindoSala = false;
      if (Game.screen !== 'battle') return;            // saiu no meio (abandonou)
      returnScreen = tela;
      if (r && r.ok && r.fase === 'won') {
        setScreen(tela, r.recompensa || recompensaVazia(Tx('o servidor não confirmou a vitória'), 'sem-recompensa'));
        return;
      }
      var motivo = (r && r.erro) || Tx('o servidor não confirmou a vitória');
      try { if (JOGO.UI && JOGO.UI.toast) JOGO.UI.toast(Tx('A sala não rendeu recompensa: {motivo}', { motivo: motivo })); } catch (eT2) {}
      setScreen(tela, recompensaVazia(motivo, codigoDaRecusa(r)));   // 08/10 à noite: o porquê fica na tela
    });
  }

  /* A SALA EM GRUPO NO SERVIDOR (13/09): a ata tem `gid` quando a semente veio
   * do servidor. Cada membro fecha com o registro do motor dele (Coop.logServidor:
   * os lances dos dois e as marcas de queda/volta/saída); o servidor refaz uma
   * vez e paga os dois. A tela de recompensa segue a do grupo (marcaRecompensaRede). */
  function grupoNoServidor() {
    if (!rede || rede.tipo !== 'grupo') return false;
    var c = C(), reg = null;
    try { reg = (c && c.logServidor) ? c.logServidor() : null; } catch (e) { reg = null; }
    return !!(reg && reg.ata && reg.ata.gid && JOGO.Autoridade && JOGO.Autoridade.ligada && JOGO.Autoridade.ligada());
  }
  function fechaGrupoNoServidor(fase) {
    var c = C(), reg = null;
    try { reg = c.logServidor(); } catch (e) { reg = null; }
    if (!reg || !reg.ata || !reg.ata.gid) return;
    var hashFinal = 0;
    try { hashFinal = E().hash(Game.state); } catch (e2) { hashFinal = 0; }
    // 15/09: a sala acabou — se a página for embora antes do recibo, o registro fecha como fim (e não como `largou`)
    try { if (JOGO.Autoridade.anotaLuta) JOGO.Autoridade.anotaLuta(reg.ata.gid, reg.lances, true); } catch (e3) {}
    var lastRoom = ultimaSalaDe(Game.dungeonId);
    var tela = (Game.roomIndex >= lastRoom) ? 'dungeonComplete' : 'roomClear';
    var mostrouEspera = false, marcaRede = null;
    /* 08/10 à noite: a resposta 'aguardando' (o MEU registro sincronizou por foto e não refaz a sala; o servidor
     * espera o registro limpo do outro membro até `esperaAte`) deixava a tela zerada na hora — "o servidor não
     * confirmou a vitória do grupo" — enquanto o outro ainda ia pagar a sala para os dois. A Autoridade agora
     * pergunta de novo até a resposta de vez (esperaGrupo); aqui, na primeira volta, a tela de recompensa sai
     * já, dizendo que ESPERA (`conferindo`), e a resposta de vez a refaz se o jogador ainda estiver nela. */
    var aoAguardar = function (ra) {
      if (fase !== 'won' || mostrouEspera || Game.screen !== 'battle') return;
      mostrouEspera = true;
      conferindoSala = false;
      returnScreen = tela;
      var rwE = recompensaVazia(null, null);
      rwE.conferindo = { motivo: (ra && ra.motivo) || 'fotografada', esperaAte: (ra && ra.esperaAte) || null,
                         esperaMs: (ra && typeof ra.esperaMs === 'number') ? ra.esperaMs : null };
      marcaRede = marcaRecompensaRede(rwE);
      setScreen(tela, rwE);
    };
    var promessa = JOGO.Autoridade.fechaGrupo({ gid: reg.ata.gid, lances: reg.lances, hashFinal: hashFinal,
                                                fotografada: reg.fotografada, autoridade: reg.autoridade }, aoAguardar);
    promessa.then(sincronizaVida);                     // 14/09: o servidor gravou a vida do fim dos dois
    if (fase !== 'won') return;
    conferindoSala = true;
    try { if (JOGO.UI && JOGO.UI.toast) JOGO.UI.toast(Tx('Conferindo a vitória do grupo com o servidor…')); } catch (eT) {}
    promessa.then(function (r) {
      conferindoSala = false;
      var pagou = !!(r && r.ok && r.fase === 'won' && r.recompensa);
      // saiu no meio (abandonou) — ou, depois da espera, já foi para a próxima sala: a recompensa de vez entra
      // sozinha no estado (a Autoridade adotou o progress) e só o aviso diz
      if (Game.screen !== (mostrouEspera ? tela : 'battle')) {
        if (mostrouEspera) {
          try {
            if (JOGO.UI && JOGO.UI.toast) {
              JOGO.UI.toast(pagou ? Tx('A sala do grupo foi conferida: a recompensa entrou.')
                                  : Tx('A sala não rendeu recompensa: {motivo}', { motivo: (r && r.erro) || Tx('o servidor não confirmou a vitória do grupo') }));
            }
          } catch (eT3) {}
        }
        return;
      }
      returnScreen = tela;
      var rw;
      if (pagou) rw = r.recompensa;
      else {
        var motivo = (r && r.erro) || Tx('o servidor não confirmou a vitória do grupo');
        try { if (JOGO.UI && JOGO.UI.toast) JOGO.UI.toast(Tx('A sala não rendeu recompensa: {motivo}', { motivo: motivo })); } catch (eT2) {}
        rw = recompensaVazia(motivo, codigoDaRecusa(r));   // 08/10 à noite: o porquê fica na tela
      }
      // a marca de rede sai uma vez só (o aoFim do Coop avisa "{a} não voltou" ao ser chamado)
      if (marcaRede) {
        rw.rede = true; rw.lider = marcaRede.lider; rw.parceiroVoltou = marcaRede.parceiroVoltou; rw.descidaAcabou = marcaRede.descidaAcabou;
      } else marcaRecompensaRede(rw);
      setScreen(tela, rw);
    });
  }

  function handleBattleOver() {
    if (!Game.state || Game.screen !== 'battle') return;
    if (conferindoSala) return;          // o recibo da vitória ainda está vindo do servidor
    // 02/10: o fim da tentativa do Eco não é vitória nem derrota de sala: sem recompensa, sem vida gravada
    if (Game.state.eco && ataEco) {
      // 07/10: em dupla, quem não é a autoridade confere o fim com ela (o hash do estado final) antes de fechar
      if (rede && rede.tipo === 'grupo') {
        var cfe = C();
        try { if (cfe && cfe.fimGrupo && !cfe.fimGrupo(Game.state)) return; } catch (efe) {}
      }
      resetAiState();
      resetTimer(true);
      Game.selectedSpellId = null;
      Game.mustEndTurn = false;
      Game.pendingFusion = null;
      setScreen('ecoFim', fechaEco(false));
      return;
    }
    // [G11] no grupo, quem não é a autoridade confere o FIM da sala com ela (o
    // hash do estado final) antes da recompensa; enquanto isso, segue na tela
    // da batalha — o update chama de novo a cada quadro
    if (rede && rede.tipo === 'grupo' && (Game.state.phase === 'won' || Game.state.phase === 'lost')) {
      var cfim = C();
      try { if (cfim && cfim.fimGrupo && !cfim.fimGrupo(Game.state)) return; } catch (efim) {}
    }

    /* DUELO: nada de xp, saque ou moeda — o prêmio é o resultado. O treino
     * entra no histórico de PvP, e a Brasa é só MOSTRADA ("se valesse"):
     * Elo contra si mesmo é fábrica de fumaça, e fumaça não é brasa.
     * 14/09: o treino também não grava a vida única (ver startDuel); o duelo em
     * rede grava, no fimDueloRede. */
    if (Game.state.pvp) {
      if (rede && rede.tipo === 'duelo') { fimDueloRede(); return; }   // [G11]
      if (rede && rede.tipo === 'guerra') { fimGuerraRede(); return; } // 15/09: a guerra de guilda
      resetAiState();
      resetTimer(true);
      Game.selectedSpellId = null;
      Game.mustEndTurn = false;
      Game.pendingFusion = null;
      var venceuA = Game.state.phase === 'won';
      var empateT = Game.state.phase === 'empate';   // 11/09: o teto de rodadas pode empatar
      var duplas = Game._duplas || { a: [], b: [] };
      var seValesse = null;
      try {
        if (JOGO.Brasa) seValesse = JOGO.Brasa.elo(1000, 1000, true).delta;
      } catch (e) {}
      if (JOGO.DB && JOGO.DB.registrarPvp) {
        try {
          JOGO.DB.registrarPvp({ oponente: 'treino (mesmo teclado)',
            minhaDupla: duplas.a, duplaDele: duplas.b,
            resultado: empateT ? 'empate-treino' : (venceuA ? 'vitoria-ladoA' : 'vitoria-ladoB'),
            clima: Game.state.weather });
        } catch (e2) {}
      }
      // A GUILDA bebe do treino (25/08) — pouco de propósito: a competição
      // de verdade (2 jogadores pela Rede) chega com o servidor
      if (JOGO.Guilda && JOGO.Guilda.registraTreino) {
        try { JOGO.Guilda.registraTreino(); } catch (eg) {}
      }
      setScreen('duelFim', { venceuA: venceuA, empate: empateT, duplaA: duplas.a, duplaB: duplas.b,
                             clima: Game.state.weather, seValesse: seValesse });
      return;
    }

    if (Game.state.phase === 'won') {
      // [G10] PV para a próxima sala. A unidade FUNDIDA também precisa entrar
      // na conta: sem isso, quem venceu a sala fundido chegava à seguinte com
      // vida cheia de graça. O PV da fusão é dividido entre os heróis que a
      // formaram (ela é a soma dos dois), lendo defensivamente os campos que o
      // Engine expuser — sem eles, cai no comportamento antigo.
      // [G11] em grupo a chave é `dono:heroId` (o heroId é a classe e colide)
      // 14/09: a vida única dos MEUS heróis parte daqui (vale na praça, na próxima sala, no duelo)
      registraFimVida(Game.state);
      if (rede && rede.tipo === 'grupo') carryFimRede = carryRede(Game.state);
      resetAiState();
      resetTimer(true);
      Game.selectedSpellId = null;
      Game.mustEndTurn = false;
      Game.pendingFusion = null;
      if (ataSolo) { fechaNoServidor('won'); return; }   // 13/09: com bilhete, quem paga é o servidor
      if (grupoNoServidor()) { fechaGrupoNoServidor('won'); return; }
      var rewards = computeRewards();
      var lastRoom = ultimaSalaDe(Game.dungeonId);
      returnScreen = (Game.roomIndex >= lastRoom) ? 'dungeonComplete' : 'roomClear';
      if (rede && rede.tipo === 'grupo') marcaRecompensaRede(rewards);
      setScreen(returnScreen, rewards);
    } else if (Game.state.phase === 'lost') {
      // 14/09: a derrota também grava a vida — quem caiu fica a 0 e volta a subir
      registraFimVida(Game.state);
      if (rede && rede.tipo === 'grupo') carryFimRede = carryRede(Game.state);
      if (ataSolo) fechaNoServidor('lost');                 // a sala perdida fecha no servidor também
      else if (grupoNoServidor()) fechaGrupoNoServidor('lost');
      resetAiState();
      resetTimer(true);
      Game.selectedSpellId = null;
      Game.mustEndTurn = false;
      Game.pendingFusion = null;
      returnScreen = 'defeat';
      if (rede && rede.tipo === 'grupo') setScreen('defeat', fimGrupoPerdido());
      else setScreen('defeat');
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

  Game.update = function (dt, semTela) {
    var d = tickDelta(dt);
    if (Game.screen !== 'battle' || !Game.state) return;
    // [G11] em rede a vez tem TRÊS donos (eu, o parceiro, a IA) e a colocação
    // é do líder; `semTela` = aba escondida (o setInterval do Coop)
    if (rede) { updateRede(d, !!semTela); return; }
    if (Game.state.phase === 'placing') { tickPrep(); return; }   // 21/09: o relógio da preparação

    if (Game.state.phase !== 'playing') { handleBattleOver(); return; }

    // 03/10: a rodada nova do Eco espera o sal dela — a vez é de ninguém até ele chegar (pedeSalEco)
    if (Game.state.eco && E().ecoEsperaSal && E().ecoEsperaSal(Game.state)) {
      resetAiState();
      pedeSalEco();
      return;
    }

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
