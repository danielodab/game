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
 *    Exceção (22/09): a INVISIBILIDADE posta na unidade durante o PRÓPRIO turno
 *    dela não conta o fim desse turno — "por 2 turnos" são 2 turnos inteiros
 *    depois do lance, como a recarga (ver `lancadoNoTurno` em tickDownEffects).
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
 *  - Invisibilidade (22/09, o dono: "ele deve sumir 100% pro adversário"): para
 *    quem é do OUTRO lado, a unidade invisível não existe — a IA não a mira,
 *    feitiço de alvo único 'enemy' não aceita a casa dela, o raio em cadeia não
 *    salta para ela e quem anda planeja o caminho como se a casa estivesse
 *    livre, esbarra e para na casa anterior. Área ainda pega quem estiver
 *    dentro, e ela ainda FIXA quem sai de perto (a emboscada). Quebra ao
 *    conjurar dano de propósito — não quando a armadilha dela dispara nem
 *    quando ela pisa num evento de chão. Esconder o corpo é da tela
 *    (Game.ocultoNaTela): o estado é o mesmo nos dois motores e no juiz.
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
 *     22/09 (o dono: "jamais podem ficar visíveis para os inimigos… assim eles
 *     desviam e nunca caem"): quem pisa numa armadilha do outro lado PARA na
 *     casa dela — antes o passo seguia, o PP era cobrado inteiro e a carga de
 *     casa única estourava na casa já vazia. Quem sabe dela é o lado de quem
 *     armou (Engine.armadilhaVisivel): a IA do outro lado não desvia e a tela
 *     não a desenha para ele (Game.veArmadilha). A exceção é a armadilha de
 *     monstro fora do PvP, que segue à vista do jogador como sempre foi.
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

  /* A VERSÃO DAS REGRAS (19/09). O juiz (servidor/juiz) refaz a sala com ESTE
   * arquivo; quando uma regra muda o resultado de uma sala já jogada (visão,
   * área, dano), um cliente com o engine.js velho e um juiz novo chegam a fins
   * diferentes da mesma semente — e a divergência viraria "cliente mentiu".
   * Este número sobe a cada mudança dessas: o juiz o anuncia em /saude e
   * /regras, o bilhete guarda o do juiz na abertura, o cliente pode mandar o
   * dele em versaoRegras (docs/SEGURANCA.md §4.1) e a sala aberta sob outra
   * versão vence em vez de ser recusada como fraude.
   *   1 — tudo até 18/09 (implícito: não havia número — o bilhete sem número
   *       guardado É desta versão, e a API o trata assim)
   *   2 — 19/09: visão simétrica e estrita, fresta de canto fechada, área que
   *       não atravessa muro, cobertura baixa −25% (cortada depois da escala da
   *       dificuldade e medida da MESMA casa de onde a visão do golpe é
   *       exigida: o conjurador para o alvo, o centro do impacto para as
   *       outras casas da área, a vítima anterior para cada salto do raio), o
   *       raio em cadeia não salta por cima de muro, a explosão de morte não
   *       fere quem está atrás de um, IA mirando o chão
   *   3 — 19/09: o Salão da Sede redesenhado ("A Arena do Trono", js/core/data/arenas.js):
   *       a guerra de guilda refeita no salão antigo não bate — o juiz recusa como
   *       'regras-mudaram' (vencida limpa), não como 'divergiu'
   *   4 — 21/09: a PREPARAÇÃO. O lance `p` passou a levar as casas escolhidas de
   *       TODOS em `l.e`, e quem tem casa marcada é posto antes de quem nasce ao
   *       acaso — uma sala aberta antes do deploy termina diferente se refeita
   *       aqui, então ela cai como 'regras-mudaram' e não como 'divergiu'
   *   5 — 22/09: a INVISIBILIDADE e a ARMADILHA. A invisibilidade posta no
   *       próprio turno não conta o fim dele (o Ladino some 2 turnos inteiros;
   *       a Sombra Curta foi de 1 para 2) e os feitiços de invisibilidade
   *       dividem a recarga; ela nunca vai para o outro lado (a fusão que bate
   *       e some esconde o conjurador, não o alvo); inimigo invisível não é
   *       alvo de feitiço 'enemy' de casa única nem de salto de raio, e quem
   *       anda esbarra nele e para antes; raio, veneno, empurrão e cia. também
   *       tiram das sombras, a armadilha do dono não; pisar em armadilha do
   *       outro lado PARA o passo na casa dela, e a carga dela não pega mais o
   *       dono vivo; a IA só desvia da armadilha que o lado dela enxerga
   *   6 — 03/10: o EQUILÍBRIO (docs/EQUILIBRIO.md). O feitiço misto (efeito a
   *       favor E hostil) manda o hostil só no outro lado e o a favor só no
   *       lado de quem lança (feiticoMisto); a armadilha do lance que muralhou
   *       a casa vai para a vizinha livre; dano, cura, escudo e alcance das
   *       classes mudaram (spells.js), as formas Sentinela/Vigia/Guarnição,
   *       Bote e Encontrão também (fusions.js), o PAIR_TUNE ganhou nível
   *       (fusion.js) e a IA passou a valorar muro e teleporte (ai.js) — uma
   *       sala aberta antes termina diferente se refeita aqui */
  Engine.VERSAO_REGRAS = 6;

  var DEFAULT_RIVALS = { fogo: 'agua', agua: 'fogo', terra: 'ar', ar: 'terra', neutro: null };
  var DEFAULT_WEATHERS = {
    calmo:     { id: 'calmo',     name: 'Calmo',     favors: null,    harms: null },
    chuva:     { id: 'chuva',     name: 'Chuva',     favors: 'agua',  harms: 'fogo' },
    estiagem:  { id: 'estiagem',  name: 'Estiagem',  favors: 'fogo',  harms: 'agua' },
    vendaval:  { id: 'vendaval',  name: 'Vendaval',  favors: 'ar',    harms: 'terra' },
    tremor:    { id: 'tremor',    name: 'Tremor',    favors: 'terra', harms: 'ar' }
  };

  function emit(ev) { Engine.events.push(ev); }
  // `uid` (22/09): de QUEM a linha fala, quando ela entrega que a unidade foi
  // atingida ali — a tela do adversário cala a linha de quem está invisível.
  function log(text, uid) {
    var ev = { type: 'log', text: text };
    if (uid != null) ev.uid = uid;
    emit(ev);
  }
  Engine.emit = emit;   // Fusion (mesmo dono) publica pela mesma fila
  Engine.log = log;

  function DATA() { return JOGO.DATA || {}; }

  /* OS MULTIPLICADORES DA SALA. Devolve sempre um objeto util — uma batalha
   * antiga, salva antes desta funcao existir, cai em `normal` e nao quebra. */
  Engine.dif = function (state) {
    var D = DATA().dificuldades || {};
    var id = (state && state.dificuldade) || DATA().dificuldadePadrao || 'normal';
    return D[id] || D.normal ||
           { id: 'normal', vida: 1, dano: 1, clima: 1, xp: 1, drop: 1 };
  };

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
  // 19/09: o padrão é los:TRUE, o mesmo do fusion.js — um feitiço sintético sem
  // `range` atirava através de tudo (era los:false aqui e true lá; o mais seguro
  // vale para os dois). Quem quer atravessar muro diz `los:false` por escrito.
  /* 19/09: o alcance do feitiço SEM `range` (as armadilhas e os eventos de chão
   * conjuram feitiços sintéticos). Exposto para as provas cobrarem o `los:true`
   * de verdade: com max 1 ele não decide nada hoje (casas encostadas sempre se
   * veem) — é o cinto de segurança para um `range` futuro sem `los`. A IA
   * (ai.js) e a fusão (fusion.js) usam o mesmo padrão. Ninguém o altera. */
  Engine.RANGE_PADRAO = { min: 0, max: 1, line: false, los: true };
  function sRange(sp) { return sp.range || Engine.RANGE_PADRAO; }
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
    // O MULTIPLICADOR ENTRA SO NO LADO QUE MACHUCA. Multiplicar tambem o que
    // cura faria o dificil CURAR mais — simetria que parece elegante no codigo
    // e e o oposto do que dificil significa.
    if (w.harms && els.indexOf(w.harms) >= 0) {
      amount -= Math.max(1, Math.round(Engine.WEATHER_TICK * (Engine.dif(state).clima || 1)));
    }
    if (amount === 0) return;                    // clima indiferente: sem evento
    if (amount > 0) {
      var gain = Math.min(amount, u.hpMax - u.hp);
      u.hp += gain;
      emit({ type: 'weatherTick', uid: u.uid, amount: gain });
      if (gain > 0) log(u.name + ' se fortalece com o clima (+' + gain + ').', u.uid);
    } else {
      // dano ambiental: ignora escudo e resistência, pode matar
      u.hp = Math.max(0, u.hp + amount);
      emit({ type: 'weatherTick', uid: u.uid, amount: amount });
      log(u.name + ' sofre com o clima (' + amount + ').', u.uid);
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
  // 11/09: no DUELO vale para os DOIS lados — só um lado ganhando força fazia
  // o teto de rodadas decidir o PvP pela cor do time.
  Engine.furyPower = function (state, unit) {
    if (!state || !unit) return 0;
    if (unit.side !== 'enemy' && !state.pvp) return 0;
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
  function vidaDe(state, side, base) {
    if (side !== 'enemy' || !base) return base;
    return Math.max(1, Math.round(base * (Engine.dif(state).vida || 1)));
  }

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
      // VIDA VEZES A DIFICULDADE, e SO no lado inimigo. Invocacao de heroi
      // usa o mesmo `makeUnit`, e escalar por `kind` em vez de por `side`
      // engordaria o rebanho do proprio jogador junto com o inimigo.
      hp: vidaDe(state, side, st.hp), hpMax: vidaDe(state, side, st.hp),
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
      conta: opts.conta || null,       // 03/09: a conta dona — fusão só entre os seus
      dono: opts.dono || null,         // 11/09: o jogador (id da Rede) que controla — lockstep
      ia: false,                       // 12/09: o dono não está aqui (caiu) — o turno desta unidade PASSA (game.js)
      fusionIntent: null,              // v2
      _birth: state._uidCounter
    };
  }

  function getDungeon(dungeonId) {
    var ds = DATA().dungeons || [];
    for (var i = 0; i < ds.length; i++) if (ds[i].id === dungeonId) return ds[i];
    // 14/09: os mapas de luta entre jogadores que não são calabouço (js/core/data/arenas.js — a praça)
    var ar = DATA().arenas || [];
    for (var j = 0; j < ar.length; j++) if (ar[j] && ar[j].id === dungeonId) return ar[j];
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

  Engine.createBattle = function (dungeonId, roomIndex, party, opts) {
    opts = opts || {};
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
      /* A DIFICULDADE E DA SALA, nao da partida. O jogador escolhe ao entrar em
       * cada uma, entao ela vive no estado da batalha — e uma sala salva
       * carrega junto a dificuldade em que foi jogada, sem depender de nada
       * fora dela. Batalha antiga, salva antes disto existir, cai em `normal`
       * por `Engine.dif`. */
      dificuldade: opts.dificuldade || DATA().dificuldadePadrao || 'normal',
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
      turno: 0,                                                      // 11/09: turnos começados
      /* 11/09: com `opts.seed` (a semente que o líder sorteia a cada sala, na
       * ata), o rng nasce dela; sem, a regra de sempre (sai dos ids). */
      _rng: (opts.seed != null)
        ? hashStr('sala:' + dungeonId + ':' + roomIndex + ':' + String(opts.seed))
        : hashStr(dungeonId + ':' + roomIndex + ':' + seedIds.join(','))
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
        conta: p.conta || null,            // 03/09: viaja do grupo para a unidade
        dono: p.dono || null,              // 11/09: o jogador que o controla (rede)
        name: p.name || def.name
      });
      state.units.push(unit);
      // 03/09: nível, multiplicador e poder do pet viajam com o grupo
      if (p.pet) pets.push({ ownerUnit: unit, petId: p.pet, level: p.petLevel || 1,
                             stars: p.petStars || 0,
                             mult: p.petMult || 1, power: p.petPower || 0 });
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
    for (i = 0; i < pets.length; i++) spawnPet(state, pets[i].ownerUnit, pets[i].petId, pets[i]);

    sorteiaDesafio(state);

    Engine.state = state;
    emit({ type: 'battleStart', state: state });
    log(dungeon.name + ' — ' + room.name);

    // A ESCOLHA DA POSIÇÃO (03/09, pedido do dono): "a posição no início da
    // batalha o usuário que escolhe. O jogo dá 4 opções aleatórias… quando
    // estiver com 2 personagens, o segundo nasce aleatoriamente; ele só
    // escolhe a posição do principal". A batalha nasce em `placing`: os
    // heróis já estão nos P do layout (é o que a cena mostra), as quatro
    // casas douradas esperam o toque, e a rodada 1 só começa em Engine.place.
    if (opts.escolhePosicao) {
      state.phase = 'placing';
      state.placement = montaEscolha(state, heroSpawns, pets);
      emit({ type: 'placement', uid: state.placement.uid, options: state.placement.options.slice() });
      return state;
    }

    emit({ type: 'roundStart', round: 1 });
    startTurn(state, 0);
    return state;
  };

  // ------------------------------------------------- a escolha da posição
  /* A ZONA DO JOGADOR: chão livre a até 3 passos de qualquer P do layout e a
   * 3 ou mais de todo monstro. Dela saem as QUATRO opções (sorteio pelo RNG
   * da sala — determinístico e testável) e, depois, a casa do segundo herói. */
  function zonaDoJogador(state, heroSpawns) {
    var w = state.grid.w, h = state.grid.h, out = [];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var t = state.grid.tiles[y][x];
        if (!t || t.type !== 'floor') continue;
        var perto = false, i;
        for (i = 0; i < heroSpawns.length; i++) {
          if (Math.abs(heroSpawns[i].x - x) + Math.abs(heroSpawns[i].y - y) <= 3) perto = true;
        }
        if (!perto) continue;
        var longe = true;
        for (i = 0; i < state.units.length; i++) {
          var u = state.units[i];
          if (u.side !== 'enemy' || !u.alive) continue;
          if (Math.abs(u.x - x) + Math.abs(u.y - y) < 3) longe = false;
        }
        if (!longe) continue;
        out.push({ x: x, y: y });
      }
    }
    return out;
  }
  function casaLivre(state, x, y, ignoraUid) {
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (!u.alive || u.offBoard || u.uid === ignoraUid) continue;
      if (u.x === x && u.y === y) return false;
    }
    return true;
  }
  /* CADA JOGADOR ESCOLHE A SUA CASA (21/09, pedido do dono: "quando um ou dois
   * jogadores entram na batalha e um escolhe o quadrado, a luta já inicia
   * automaticamente. Isso não pode acontecer"). Antes só o líder escolhia, e o
   * toque dele começava a rodada 1 na hora.
   *
   * As listas são DISJUNTAS e saem do MESMO saco embaralhado: fatias de quatro,
   * uma por DONO (o `dono` da unidade em rede; sozinho há um dono só). Precisam
   * ser disjuntas porque os dois escolhem ao mesmo tempo, sem falar um com o
   * outro — duas listas com a mesma casa dariam dois heróis no mesmo lugar, e o
   * desempate teria de viajar pela rede no meio da preparação. */
  function montaEscolha(state, heroSpawns, pets) {
    var herois = [], i;
    for (i = 0; i < state.units.length; i++) {
      if (state.units[i].kind === 'hero' && state.units[i].side === 'player') herois.push(state.units[i]);
    }
    var principal = herois[0];
    var zona = zonaDoJogador(state, heroSpawns);
    // embaralha pelo RNG da sala (determinístico e testável); a casa atual de
    // cada herói conta como livre, e a zona nunca deixa a lista vazia
    var meus = {};
    for (i = 0; i < herois.length; i++) meus[herois[i].uid] = true;
    var bolsa = zona.filter(function (c) {
      for (var j = 0; j < state.units.length; j++) {
        var u = state.units[j];
        if (!u.alive || u.offBoard || meus[u.uid]) continue;
        if (u.x === c.x && u.y === c.y) return false;
      }
      return true;
    });
    for (var k = bolsa.length - 1; k > 0; k--) {
      var j2 = Math.floor(nextRand(state) * (k + 1));
      var tmp = bolsa[k]; bolsa[k] = bolsa[j2]; bolsa[j2] = tmp;
    }
    // um DONO, uma lista: quem escolhe é o PRIMEIRO herói de cada dono
    var donos = [], vistos = {};
    for (i = 0; i < herois.length; i++) {
      var d = herois[i].dono || '';
      if (own(vistos, d)) continue;
      vistos[d] = true;
      donos.push(herois[i]);
    }
    var opcoes = {}, n = 0;
    for (i = 0; i < donos.length; i++) {
      var lista = bolsa.slice(n, n + OPCOES_POR_DONO);
      n += OPCOES_POR_DONO;
      if (!lista.length) lista = [{ x: donos[i].x, y: donos[i].y }];
      opcoes[donos[i].uid] = lista;
    }
    return {
      uid: principal.uid,
      options: opcoes[principal.uid] || opcoes[donos[0].uid],
      opcoes: opcoes,
      escolhas: {},                 // uid -> {x,y}: NUNCA entra no hash (ver Engine.escolhe)
      zona: zona,
      pets: pets.map(function (p) { return { ownerUid: p.ownerUnit.uid, petId: p.petId, extra: p }; })
    };
  }
  var OPCOES_POR_DONO = 4;
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function naLista(lista, x, y) {
    for (var i = 0; lista && i < lista.length; i++) if (lista[i].x === x && lista[i].y === y) return true;
    return false;
  }
  /* MARCAR A CASA NÃO É LANCE. `escolhe` só grava em `placement.escolhas`: não
   * move ninguém, não gasta `nextRand`, não entra no `Engine.hash` e não começa
   * a rodada. Tinha de ser assim — dois jogadores marcando ao mesmo tempo
   * disputariam a MESMA chave (T=0, k=0) da fila do lockstep e rachariam a sala.
   * O que viaja é o PRONTO (voz `prep` do Coop) e, no fim, o lance `p` único do
   * colocador, com as casas dos dois dentro. Marcar de novo TROCA a casa. */
  Engine.escolhe = function (state, uid, x, y) {
    if (!state || state.phase !== 'placing' || !state.placement) return false;
    var lista = state.placement.opcoes && state.placement.opcoes[uid];
    if (!naLista(lista, x, y)) return false;
    state.placement.escolhas[uid] = { x: x, y: y };
    return true;
  };
  Engine.escolhaDe = function (state, uid) {
    var e = state && state.placement && state.placement.escolhas;
    return (e && own(e, uid)) ? { x: e[uid].x, y: e[uid].y } : null;
  };
  Engine.opcoesDe = function (state, uid) {
    var o = state && state.placement && state.placement.opcoes;
    return (o && o[uid]) ? o[uid].slice() : [];
  };
  /* quem de fato pode marcar uma casa (o primeiro herói de cada dono) */
  Engine.quemEscolhe = function (state) {
    var o = state && state.placement && state.placement.opcoes;
    if (!o) return [];
    var out = [];
    for (var uid in o) if (own(o, uid)) out.push(uid);
    return out;
  };
  Engine.placementOptions = function (state) {
    return (state && state.placement && state.placement.options) ? state.placement.options.slice() : [];
  };
  /* O FIM DA PREPARAÇÃO: cada herói com casa marcada vai para a dele, quem
   * sobrou nasce ao acaso na zona, os pets renascem colados aos donos, e SÓ
   * ENTÃO a rodada 1 começa.
   *
   * QUEM CHAMA ISTO É O LANCE `p`, não o toque na casa. `opts.escolhas` é um
   * mapa {uid: {x,y}} com as casas de TODOS, e vem DENTRO do lance — nunca do
   * `placement.escolhas` local, que é de cada ponta e não viaja. Se lêssemos o
   * local, dois clientes do mesmo lockstep refariam a sala de jeitos diferentes.
   * `x`/`y` continuam valendo como a casa de quem manda (`opts.uid`, ou o
   * principal), para as bancadas antigas e para o solo de uma linha só.
   *
   * ORDEM: quem tem casa MARCADA é posto ANTES de quem nasce ao acaso. Na ordem
   * inversa o sorteio do herói sem marca roubava a casa que o parceiro tinha
   * escolhido e o parceiro caía noutro lugar. */
  Engine.place = function (state, x, y, opts) {
    if (!state || state.phase !== 'placing' || !state.placement) return false;
    var pl = state.placement, i, uid;
    opts = opts || {};
    var quem = opts.uid || pl.uid;
    var marcadas = {};
    var vindas = opts.escolhas || {};
    for (uid in vindas) {
      if (!own(vindas, uid) || !vindas[uid]) continue;
      if (!naLista(pl.opcoes && pl.opcoes[uid], vindas[uid].x, vindas[uid].y)) continue;   // casa do outro não vale
      marcadas[uid] = { x: vindas[uid].x, y: vindas[uid].y };
    }
    if (typeof x === 'number' && typeof y === 'number') {
      if (!naLista(pl.opcoes && pl.opcoes[quem], x, y)) return false;
      marcadas[quem] = { x: x, y: y };
    }
    var moves = [];
    // os pets saem antes: ocupam casas e renascem no fim, colados aos donos
    for (i = state.units.length - 1; i >= 0; i--) {
      if (state.units[i].kind === 'pet') state.units.splice(i, 1);
    }
    // 1ª volta: os MARCADOS, na ordem das unidades (a mesma nos dois clientes)
    var jaPosto = {};
    for (i = 0; i < state.units.length; i++) {
      var um = state.units[i];
      if (um.kind !== 'hero' || um.side !== 'player') continue;
      if (!own(marcadas, um.uid)) continue;
      var c1 = marcadas[um.uid];
      jaPosto[um.uid] = true;
      if (um.x !== c1.x || um.y !== c1.y) {
        moves.push({ uid: um.uid, fromX: um.x, fromY: um.y, toX: c1.x, toY: c1.y });
        um.x = c1.x; um.y = c1.y;
      }
    }
    // 2ª volta: quem não marcou nasce ao acaso, longe das casas já tomadas
    for (i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.kind !== 'hero' || u.side !== 'player' || jaPosto[u.uid]) continue;
      var casas = pl.zona.filter(function (c) { return casaLivre(state, c.x, c.y, u.uid); });
      if (!casas.length) continue;
      var c2 = casas[Math.floor(nextRand(state) * casas.length)];
      if (c2.x !== u.x || c2.y !== u.y) {
        moves.push({ uid: u.uid, fromX: u.x, fromY: u.y, toX: c2.x, toY: c2.y });
        u.x = c2.x; u.y = c2.y;
      }
    }
    for (i = 0; i < pl.pets.length; i++) {
      var dono = Engine.findUnit(state, pl.pets[i].ownerUid);
      if (dono) spawnPet(state, dono, pl.pets[i].petId, pl.pets[i].extra);
    }
    var minha = marcadas[pl.uid] || null;
    state.placement = null;
    state.phase = 'playing';
    emit({ type: 'placed', uid: pl.uid, x: minha ? minha.x : null, y: minha ? minha.y : null, moves: moves });
    emit({ type: 'roundStart', round: 1 });
    startTurn(state, 0);
    return true;
  };

  // --------------------------------------------------------- v2: pets
  /* `extra` (03/09) traz o nível do pet e o que ele vale: `mult` engorda a
   * vida do corpo, `power` entra no poder (e por ele no dano, na cura e nos
   * buffs dos feitiços do pet — ver petCastMult). Sem `extra` = nível 1. */
  function spawnPet(state, owner, petId, extra) {
    var pd = (DATA().pets || {})[petId];
    if (!pd) return null;
    var cells = freeAdjacentCells(state, owner.x, owner.y, 1);
    if (!cells.length) return null;
    var base = pd.stats || {};
    var ex = extra || {};
    var mult = (typeof ex.mult === 'number' && ex.mult > 0) ? ex.mult : 1;
    var st = {
      hp: Math.round((base.hp || 40) * mult), pa: base.pa || 3, pp: base.pp || 3,
      initiative: base.initiative || owner.initiative,
      power: (base.power || 0) + (ex.power || 0), dodge: base.dodge || 0, lock: base.lock || 0,
      resists: base.resists || {}
    };
    var u = makeUnit(state, { id: pd.id, name: pd.name, spells: pd.spells || [] },
      'pet', owner.side, cells[0].x, cells[0].y, {
        stats: st,
        spells: pd.spells || [],
        element: pd.element || 'neutro',
        ownerUid: owner.uid,
        petId: pd.id,
        level: ex.level || 1,
        behavior: pd.behavior || 'attack',
        range: pd.range || 1,
        followDistance: pd.followDistance || Engine.PET_FOLLOW_DEFAULT
      });
    u.petMult = mult;
    u.petStars = ex.stars || 0;        // 11/09: o corpo do pet cresce por estrela
    state.units.push(u);
    emit({ type: 'petSpawn', unit: u, ownerUid: owner.uid });
    return u;
  }

  // --------------------------------------------------------------- movimento
  /* O QUE UMA UNIDADE NÃO VÊ (22/09). Inimigo invisível não existe para quem é
   * do outro lado: a casa dele parece chão livre. É a mesma régua da IA
   * (ai.js isInvisible), agora no motor — e vale igual para gente, porque a
   * tela do adversário não desenha o corpo (Game.ocultoNaTela). */
  function ocultoDe(quem, o) {
    return !!(quem && o && o.side !== quem.side && Engine.unitHasEffect(o, 'invisible'));
  }
  Engine.ocultoDe = ocultoDe;

  // `mover` (22/09): quem anda. Sem ele, a casa ocupada bloqueia sempre — é o
  // corpo de verdade, que empurrão, invocação e deslize respeitam.
  function isWalkable(state, x, y, mover) {
    if (!isFloor(state, x, y)) return false;
    var o = Engine.unitAt(state, x, y);
    return !o || ocultoDe(mover, o);
  }
  var DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  function bfs(state, sx, sy, maxCost, mover) {
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
        if (!isWalkable(state, nx, ny, mover)) continue;
        dist[key] = d + 1;
        parent[key] = cur.x + ',' + cur.y;
        queue.push({ x: nx, y: ny });
      }
    }
    return { dist: dist, parent: parent };
  }

  // v2: inimigos vivos adjacentes a (x,y) que podem fixar `unit`.
  // `soVistos` (22/09): só os que `unit` enxerga — é o que a PRÉVIA pinta de
  // âmbar. O teste de verdade (worstLocker) conta o invisível também: ele fixa
  // quem sai de perto, e é assim que a emboscada se revela.
  function lockersAt(state, unit, x, y, soVistos) {
    var out = [];
    for (var i = 0; i < state.units.length; i++) {
      var e = state.units[i];
      if (!e.alive || e.offBoard || e === unit) continue;
      if (e.side === unit.side) continue;
      if (soVistos && ocultoDe(unit, e)) continue;
      if (manhattan(x, y, e.x, e.y) === 1) out.push(e);
    }
    return out;
  }

  // 22/09: armadilha do OUTRO lado nesta casa (a do próprio lado não dispara)
  function armadilhaInimiga(state, u, x, y) {
    var tr = state.traps || [];
    for (var i = 0; i < tr.length; i++) {
      if (tr[i].x === x && tr[i].y === y && tr[i].side !== u.side) return true;
    }
    return false;
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
    var r = bfs(state, u.x, u.y, u.pp, u);
    var lockers = lockersAt(state, u, u.x, u.y, true);    // v2 (22/09: só os que ela vê)
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
    if (!isWalkable(state, x, y, u)) return null;
    var r = bfs(state, u.x, u.y, u.pp, u);
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
    if (!isWalkable(state, x, y, u)) return;
    var need = bfs(state, u.x, u.y, -1, u).dist[x + ',' + y];
    if (need === undefined) return;                       // sem caminho: nada a dizer
    if (u.pp <= 0) log(u.name + ' não tem mais Pontos de Passos neste turno.', u.uid);
    else log(u.name + ' precisa de ' + need + ' PP para chegar aí e só tem ' + u.pp + '.', u.uid);
  }

  Engine.move = function (state, uid, x, y) {
    if (state.phase !== 'playing') return false;
    var u = Engine.findUnit(state, uid);
    if (!u || !u.alive || u.offBoard) return false;
    if (Engine.unitHasEffect(u, 'root')) {                // v2
      log(u.name + ' está preso ao chão.', u.uid);
      return false;
    }
    var path = Engine.path(state, uid, x, y);
    if (!path || path.length > u.pp) { explainNoStep(state, u, x, y); return false; }

    /* 22/09 — O CAMINHO PLANEJADO É O QUE A UNIDADE CONHECE. Ele atravessa a
     * casa de um inimigo invisível como se fosse chão (ocultoDe) e não sabe da
     * armadilha do outro lado; andando, o passo é cortado onde a verdade
     * aparece:
     *   - casa com alguém que ela não via: ESBARRA e para na casa anterior;
     *   - armadilha do outro lado: CAI nela e para em cima.
     * O PP cobrado é só o do trecho andado, e a fixação é testada contra a
     * casa onde ela de fato termina. Esbarrar já no primeiro passo não tira
     * ninguém do lugar e não gasta nada (devolve false, como passo recusado). */
    var esbarrou = null, corte = path.length;
    for (var pc = 0; pc < path.length; pc++) {
      var quem = Engine.unitAt(state, path[pc].x, path[pc].y);
      if (quem && quem !== u) { esbarrou = quem; corte = pc; break; }
      if (armadilhaInimiga(state, u, path[pc].x, path[pc].y)) { corte = pc + 1; break; }
    }
    if (corte < path.length) path = path.slice(0, corte);
    if (!path.length) {
      emit({ type: 'esbarrou', uid: uid, x: esbarrou.x, y: esbarrou.y });
      log(u.name + ' esbarra em alguém que não se vê.', u.uid);
      return false;
    }
    x = path[path.length - 1].x;
    y = path[path.length - 1].y;

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
        log(u.name + ' não escapa de ' + locker.name + (critical ? ' (falha crítica!)' : '') + '.', u.uid);
        return false;
      }
    }

    u.pp -= path.length;
    u.x = x; u.y = y;
    emit({ type: 'move', uid: uid, path: path });
    if (esbarrou) {
      emit({ type: 'esbarrou', uid: uid, x: esbarrou.x, y: esbarrou.y });
      log(u.name + ' esbarra em alguém que não se vê.', u.uid);
    }

    // desafio ESTÁTUA: cada célula andada por herói/fusão conta; empurrão e
    // puxão NÃO passam por aqui e não contam — ser jogado não é andar
    if (state.desafio && state.desafio.vivo && state.desafio.id === 'estatua' &&
        u.side === 'player' && (u.kind === 'hero' || u.kind === 'fusion')) {
      state.desafio.passos += path.length;
      if (state.desafio.passos > 6) desafioFalha(state, 'o grupo andou demais');
    }

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
  /* O TRAÇADO de uma casa à outra (Bresenham, centro a centro). Devolve null
   * quando nada bloqueia, ou a primeira casa de muro que o traçado encontra.
   *
   * A FRESTA DE CANTO (19/09, o dono: "obstáculos atrapalham"). Quando o
   * traçado dá um passo DIAGONAL entre dois muros encostados só pelo canto,
   * ele não pisa em nenhum dos dois e a visão "espremia" pela fresta — medido
   * em 325 pares nas 20 salas (greenhouse#0 118, quakemine#2 88…). Agora o
   * passo diagonal com muro nos DOIS vizinhos ortogonais bloqueia. Não é o
   * supercover (toda casa que o segmento toca): esse fecharia o mesmo canto
   * mas tiraria 8,9% da visão do jogo inteiro. */
  function traco(state, x0, y0, x1, y1) {
    var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    var dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    var err = dx + dy;
    var x = x0, y = y0;
    for (;;) {
      if (x === x1 && y === y1) return null;
      var px = x, py = y;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
      if (x !== px && y !== py && blocksSight(state, x, py) && blocksSight(state, px, y)) {
        return { x: x, y: py };                       // a fresta de canto
      }
      if (!(x === x1 && y === y1) && blocksSight(state, x, y)) return { x: x, y: y };
    }
  }
  /* O primeiro muro entre duas casas, ou null quando se veem. Simétrico como a
   * visão: o traçado de ida e o de volta. */
  Engine.muroNaLinha = function (state, x0, y0, x1, y1) {
    return traco(state, x0, y0, x1, y1) || traco(state, x1, y1, x0, y0);
  };
  /* A LINHA DE VISÃO É SIMÉTRICA E ESTRITA (19/09). O Bresenham escolhe para
   * que lado arredondar no meio-passo e a escolha depende do sentido: medido
   * nas 20 salas, 5.768 pares em 210.113 (2,7%) em que A via B e B não via A
   * — o arqueiro acertava o monstro e o monstro, da mesma casa, não acertava
   * o arqueiro. Agora os dois sentidos têm de passar: muro nunca fica mais
   * fraco, e quem vê é visto. O juiz (servidor/juiz) usa esta mesma função,
   * por isso a mudança sobe Engine.VERSAO_REGRAS. */
  Engine.los = function (state, x0, y0, x1, y1) {
    return !traco(state, x0, y0, x1, y1) && !traco(state, x1, y1, x0, y0);
  };

  /* A COBERTURA BAIXA (19/09). A doc prometia "atrás de um obstáculo baixo
   * você é atingível mas tem cobertura", e o motor só usava o '=' para barrar
   * o passo (4.791 pares ortogonais cruzavam um '=' e nenhum sentia nada).
   * Agora vale o que a doc diz: quando o ALVO está encostado (ortogonal) numa
   * casa de cobertura E o traçado de onde o golpe SAI até ele entra pela
   * cobertura (a última casa antes do alvo é o '='), o dano dos efeitos de dano
   * perde 25% (applyEffects; `cobre` diz de onde cada golpe sai). Corpo a
   * corpo encostado nunca é coberto: o traçado não cruza casa nenhuma. Cura,
   * controle, invocação e auto-alvo não mudam. */
  Engine.coberto = function (state, x0, y0, x1, y1) {
    if (x0 === x1 && y0 === y1) return false;
    var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    var dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    var err = dx + dy;
    var x = x0, y = y0, px = x0, py = y0;
    for (;;) {
      if (x === x1 && y === y1) break;
      px = x; py = y;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
    if (px === x0 && py === y0) return false;         // encostado: nada no meio
    if (manhattan(px, py, x1, y1) !== 1) return false; // a cobertura tem de ser ortogonal ao alvo
    var t = tileAt(state, px, py);
    return !!t && t.type === 'cover';
  };
  Engine.COBERTURA_PCT = 25;   // o quanto a cobertura baixa tira do dano

  // ------------------------------------------------------------------- duelo
  /* A ARENA (PvP hotseat). Uma sala propria, montada a mao: bordas de muro,
   * dois pilares no meio (a linha de visao PRECISA ter o que bloquear numa
   * arena, senao vira tiroteio de esquina a esquina), e os DOIS lados como
   * herois de verdade — quem os conduz e decisao do Game (state.pvp).
   *
   * SEM desafio de sala: o contrato do desafio e PvE (+xp/+saque), e duelo
   * nao paga nem xp nem saque. O clima e SORTEADO no proprio rng do estado:
   * a mesma dupla de duplas com a mesma semente repete o clima — testavel. */
  Engine.createDuel = function (duplaA, duplaB, opts) {
    opts = opts || {};
    if (!duplaA || !duplaA.length || !duplaB || !duplaB.length) {
      throw new Error('Engine.createDuel: duplas vazias');
    }
    var w = 13, h = 9;
    var tiles = [];
    for (var y = 0; y < h; y++) {
      tiles.push([]);
      for (var x = 0; x < w; x++) {
        var borda = (x === 0 || y === 0 || x === w - 1 || y === h - 1);
        var pilar = (y === 4 && (x === 4 || x === 8));
        tiles[y].push({ type: (borda || pilar) ? 'wall' : 'floor',
                        deco: !borda && !pilar && ((x * 3 + y) % 7 === 0) });
      }
    }

    var state = {
      dungeonId: opts.cenario || 'greenhouse',   // o tema visual da arena v1
      roomIndex: 0,
      pvp: true,
      dificuldade: 'normal',                     // multiplicadores neutros
      round: 1,
      phase: 'playing',
      grid: { w: w, h: h, tiles: tiles },
      units: [],
      order: [],
      activeIdx: 0,
      weather: 'calmo',
      tileEventsActive: [],
      traps: [],
      walls: [],
      pendingFusion: null,
      _weatherIdx: 0,
      _uidCounter: 0,
      turno: 0,
      _rng: hashStr('duelo:' + (opts.seed != null ? String(opts.seed) : String(Date.now())))
    };

    // o CLIMA da arena e sorteado — pedido de design desde o primeiro desenho
    var cyc = weatherCycle(state);
    state.weather = cyc[Math.floor(nextRand(state) * cyc.length)] || 'calmo';
    state._weatherIdx = Math.max(0, cyc.indexOf(state.weather));

    function poeLado(dupla, side, colX) {
      var vagasY = [3, 5, 2, 6];
      for (var i = 0; i < dupla.length && i < 2; i++) {
        var pd = dupla[i];
        var cls = (DATA().classes && DATA().classes[pd.classId]) || null;
        if (!cls) throw new Error('Engine.createDuel: classe desconhecida: ' + pd.classId);
        var st = heroStats(pd, cls);
        var unit = makeUnit(state, cls, 'hero', side, colX, vagasY[i], {
          stats: st,
          spells: pd.spells || cls.baseSpells || cls.spells || [],
          element: pd.element || 'neutro',
          level: pd.level || 1,
          classId: pd.classId,
          heroId: pd.heroId || pd.classId,
          dono: pd.dono || null,
          name: pd.name || cls.name
        });
        state.units.push(unit);
      }
    }
    poeLado(duplaA, 'player', 2);
    poeLado(duplaB, 'enemy', w - 3);

    var sorted = state.units.slice().sort(function (a, b) {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      return a._birth - b._birth;
    });
    for (var i2 = 0; i2 < sorted.length; i2++) state.order.push(sorted[i2].uid);
    state.activeIdx = 0;

    Engine.state = state;
    emit({ type: 'battleStart', state: state });
    log('Arena de Duelos — clima: ' + state.weather + '. Que vença o mais fundo.');
    emit({ type: 'roundStart', round: 1 });
    startTurn(state, 0);
    return state;
  };

  // ------------------------------------------------ 11/09: o duelo pela Rede
  /* A ARENA SORTEADA (duelo entre dois jogadores): uma sala DE VERDADE de um
   * calabouço aberto — a grade do layout, sem monstros, sem pets e sem desafio
   * (a regra do duelo de treino). A (quem desafiou) nasce nos P, em ordem de
   * leitura; B nas duas casas de letra MAIS LONGE dos P (a maior distância
   * mínima; desempate por y, depois x) — sem duas letras, no espelho dos P
   * pelo centro. O clima sai do rng, como no treino; o rng nasce da sala e da
   * semente dos dois (ninguém escolhe a semente sozinho: os sais estão presos
   * nos compromissos). Os lados no ESTADO são sempre A='player', B='enemy' —
   * a perspectiva de quem é B é só de tela (Game.meuLado/ladoDaTela). */
  Engine.createDuelSala = function (dungeonId, roomIndex, duplaA, duplaB, opts) {
    opts = opts || {};
    var dungeon = getDungeon(dungeonId);
    if (!dungeon) throw new Error('Engine.createDuelSala: calabouço desconhecido: ' + dungeonId);
    var room = dungeon.rooms[roomIndex];
    if (!room) throw new Error('Engine.createDuelSala: sala inválida: ' + roomIndex);
    if (!duplaA || !duplaA.length || !duplaB || !duplaB.length) {
      throw new Error('Engine.createDuelSala: duplas vazias');
    }
    var layout = room.layout, h = layout.length, w = layout[0].length;
    var tiles = [], ps = [], letras = [], x, y, ch, i;
    for (y = 0; y < h; y++) {
      var row = [];
      for (x = 0; x < w; x++) {
        ch = layout[y].charAt(x);
        if (ch === '#') row.push({ type: 'wall', deco: false });
        else if (ch === '=') row.push({ type: 'cover', deco: false });
        else if (ch === '~') row.push({ type: 'hole', deco: false });
        else if (ch === ',') row.push({ type: 'floor', deco: true });
        else row.push({ type: 'floor', deco: false });            // P e as letras viram chão
        if (ch === 'P') ps.push({ x: x, y: y });
        else if (ch >= 'a' && ch <= 'z') letras.push({ x: x, y: y });
      }
      tiles.push(row);
    }
    var state = {
      dungeonId: dungeonId,
      roomIndex: roomIndex,
      pvp: true,
      duelSala: true,
      dificuldade: 'normal',
      round: 1,
      turno: 0,
      phase: 'playing',
      grid: { w: w, h: h, tiles: tiles },
      units: [],
      order: [],
      activeIdx: 0,
      weather: 'calmo',
      tileEventsActive: [],
      traps: [],
      walls: [],
      pendingFusion: null,
      _weatherIdx: 0,
      _uidCounter: 0,
      _rng: hashStr('duelo:' + dungeonId + ':' + roomIndex + ':' + String(opts.seed != null ? opts.seed : 0))
    };
    var cyc = weatherCycle(state);
    state.weather = cyc[Math.floor(nextRand(state) * cyc.length)] || 'calmo';
    // 14/09: os mapas de luta que não são calabouço (a praça, o salão da Sede) têm o clima deles — sem chuva
    // sorteada dentro do salão. O sorteio acima fica (mesma sequência de números nos dois lados e no juiz)
    if (dungeon.id && JOGO.DATA && JOGO.DATA.arena && JOGO.DATA.arena(dungeon.id)) {
      state.weather = room.weather || dungeon.defaultWeather || 'calmo';
    }
    state._weatherIdx = Math.max(0, cyc.indexOf(state.weather));

    var usadas = {};
    function livre(c) {
      return !!c && c.y >= 0 && c.y < h && c.x >= 0 && c.x < w &&
             tiles[c.y][c.x].type === 'floor' && !usadas[c.x + ',' + c.y];
    }
    function toma(c) { usadas[c.x + ',' + c.y] = true; return { x: c.x, y: c.y }; }
    // 14/09: até 4 por lado — a guerra de guilda 2×2 leva a dupla de cada jogador (o duelo de sempre segue com 1 ou 2)
    var nA = Math.min(4, duplaA.length), nB = Math.min(4, duplaB.length);
    var casasA = [];
    for (i = 0; i < ps.length && casasA.length < nA; i++) if (livre(ps[i])) casasA.push(toma(ps[i]));
    var cand = [];
    for (i = 0; i < letras.length; i++) {
      var dm = -1;
      for (var j = 0; j < ps.length; j++) {
        var dd = manhattan(letras[i].x, letras[i].y, ps[j].x, ps[j].y);
        if (dm < 0 || dd < dm) dm = dd;
      }
      cand.push({ x: letras[i].x, y: letras[i].y, d: dm });
    }
    cand.sort(function (a, b) { return (b.d - a.d) || (a.y - b.y) || (a.x - b.x); });
    var casasB = [];
    for (i = 0; i < cand.length && casasB.length < nB; i++) if (livre(cand[i])) casasB.push(toma(cand[i]));
    for (i = 0; i < ps.length && casasB.length < nB; i++) {
      var esp = { x: w - 1 - ps[i].x, y: h - 1 - ps[i].y };
      if (livre(esp)) casasB.push(toma(esp));
    }
    // último recurso (sala sem P ou sem chão livre onde se esperava): o chão
    // livre mais perto da primeira casa do lado, em ordem de leitura
    function completa(casas, n, perto) {
      if (casas.length >= n) return;
      var chao = [];
      for (var yy = 0; yy < h; yy++) {
        for (var xx = 0; xx < w; xx++) {
          if (livre({ x: xx, y: yy })) chao.push({ x: xx, y: yy, d: perto ? manhattan(xx, yy, perto.x, perto.y) : 0 });
        }
      }
      chao.sort(function (a, b) { return (a.d - b.d) || (a.y - b.y) || (a.x - b.x); });
      for (var k = 0; k < chao.length && casas.length < n; k++) casas.push(toma(chao[k]));
    }
    completa(casasA, nA, casasA[0] || ps[0] || null);
    completa(casasB, nB, casasB[0] || null);

    /* A VIDA ÚNICA (14/09, o dono: "se o jogador estiver com a vida na metade e começar uma
     * batalha sendo pvp… a vida vai começar onde estava"). `opts.vidaA` / `opts.vidaB` =
     * {heroId: PV} de cada lado; herói fora do mapa entra cheio. Entra ANTES do primeiro
     * turno, para o jogo e o juiz (servidor/juiz/sala.js) nascerem com o mesmo hash. */
    function poe(dupla, side, casas, vida) {
      for (var q = 0; q < dupla.length && q < 4 && q < casas.length; q++) {
        var pd = dupla[q];
        var cls = (DATA().classes && DATA().classes[pd.classId]) || null;
        if (!cls) throw new Error('Engine.createDuelSala: classe desconhecida: ' + pd.classId);
        var st = heroStats(pd, cls);
        var un = makeUnit(state, cls, 'hero', side, casas[q].x, casas[q].y, {
          stats: st,
          spells: pd.spells || cls.baseSpells || cls.spells || [],
          element: pd.element || 'neutro',
          level: pd.level || 1,
          classId: pd.classId,
          heroId: pd.heroId || pd.classId,
          conta: pd.conta || null,
          dono: pd.dono || null,
          name: pd.name || cls.name
        });
        var pv = (vida && typeof vida === 'object') ? vida[un.heroId] : undefined;
        if (typeof pv === 'number' && isFinite(pv)) un.hp = Math.max(1, Math.min(un.hpMax, Math.floor(pv)));
        state.units.push(un);
      }
    }
    poe(duplaA, 'player', casasA, opts.vidaA);
    poe(duplaB, 'enemy', casasB, opts.vidaB);

    var sorted = state.units.slice().sort(function (a, b) {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      return a._birth - b._birth;
    });
    for (i = 0; i < sorted.length; i++) state.order.push(sorted[i].uid);
    state.activeIdx = 0;

    Engine.state = state;
    emit({ type: 'battleStart', state: state });
    log('Arena sorteada — ' + (dungeon.name || dungeonId) + ', ' + (room.name || ('sala ' + (roomIndex + 1))) +
        '. Clima: ' + state.weather + '.');
    emit({ type: 'roundStart', round: 1 });
    startTurn(state, 0);
    return state;
  };

  /* A VIDA COM QUE CADA HERÓI DE UM LADO SAI DA LUTA (14/09, a vida única): {heroId: PV} —
   * caído = 0; a unidade fundida divide o PV dela entre os heróis que a formaram (a regra do
   * carry da descida, game.js carrySolo/carryRede). O duelo usa por lado ('player' = A,
   * 'enemy' = B); o juiz (servidor/juiz/duelo.js) usa a mesma. */
  Engine.vidaDoLado = function (state, side) {
    var out = {};
    if (!state || !state.units) return out;
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.side !== side) continue;
      if (u.kind === 'hero') {
        if (u.fusedInto) continue;                 // conta pela fusão
        out[u.heroId || u.defId] = u.alive ? Math.max(0, Math.floor(u.hp)) : 0;
      } else if (u.kind === 'fusion') {
        var from = u.fusedFrom || [], srcs = [];
        for (var k = 0; k < from.length; k++) { var s0 = Engine.findUnit(state, from[k]); if (s0 && s0.kind === 'hero') srcs.push(s0); }
        if (!srcs.length) continue;
        var parte = u.alive ? Math.max(1, Math.floor(u.hp / srcs.length)) : 0;
        for (k = 0; k < srcs.length; k++) out[srcs[k].heroId || srcs[k].defId] = parte;
      }
    }
    return out;
  };

  /* O FIM FORA DO FLUXO DO MOTOR: desistência e W.O. do duelo. `vencedor` é
   * 'player' | 'enemy' | null (empate, só no PvP). */
  Engine.encerra = function (state, vencedor, motivo) {
    if (!state || (state.phase !== 'playing' && state.phase !== 'placing')) return false;
    var w = (vencedor === 'player' || vencedor === 'enemy') ? vencedor : null;
    if (!w && !state.pvp) w = 'enemy';
    state.phase = w === 'player' ? 'won' : (w === 'enemy' ? 'lost' : 'empate');
    state.placement = null;
    emit({ type: 'battleEnd', winner: w, reason: motivo || null });
    log(w ? 'A batalha foi encerrada (' + (motivo || 'fim') + ').' : 'A batalha terminou empatada.');
    return true;
  };

  // ------------------------------------------- 11/09: hash, foto e restauração
  /* O HASH DO ESTADO (FNV-1a de 32 bits, o mesmo `hashStr` da semente): tudo
   * o que decide a batalha dali para a frente — rng, rodada, turno, vez, fase,
   * clima, cada unidade (posição, PV, PA, PP, efeitos, recargas, `ia`, `dono`),
   * armadilhas, muros, eventos do chão, fusão pendente e o
   * desafio. Número que não é finito entra vazio: a foto passa por JSON, e o
   * JSON devolveria null — o hash de quem restaurou não pode mudar por isso. */
  function nh(v) { return (typeof v === 'number' && isFinite(v)) ? v : ''; }
  Engine.hash = function (st) {
    if (!st || !st.units) return 0;
    var p = [nh(st._rng), nh(st.round), nh(st.turno || 0), nh(st.activeIdx), st.phase, st.weather,
             nh(st._uidCounter), (st.order || []).join(',')];
    var i, j, u, ks, e, t;
    for (i = 0; i < st.units.length; i++) {
      u = st.units[i];
      p.push(u.uid, u.kind, u.side, nh(u.x), nh(u.y), nh(u.hp), nh(u.hpMax), nh(u.pa), nh(u.pp),
             nh(u.paMax), nh(u.ppMax), u.alive ? 1 : 0, u.offBoard ? 1 : 0, nh(u.shield),
             u.ia ? 1 : 0, u.dono || '', u.fusionIntent || '', u.enraged ? 1 : 0);
      var ef = u.effects || [];
      for (j = 0; j < ef.length; j++) {
        e = ef[j]; p.push(e.type, nh(e.duration), nh(e.remaining || 0), nh(e.value || 0));
        if (e.lancadoNoTurno != null) p.push('n' + nh(e.lancadoNoTurno));   // 22/09: só quando existe
      }
      ks = Object.keys(u.cooldowns || {}).sort();
      for (j = 0; j < ks.length; j++) p.push(ks[j] + '=' + nh(u.cooldowns[ks[j]]));
      ks = Object.keys(u.castsThisTurn || {}).sort();
      for (j = 0; j < ks.length; j++) p.push('c:' + ks[j] + '=' + nh(u.castsThisTurn[ks[j]]));
    }
    for (i = 0; i < (st.traps || []).length; i++) { t = st.traps[i]; p.push('T', nh(t.x), nh(t.y), nh(t.remaining)); }
    for (i = 0; i < (st.walls || []).length; i++) { t = st.walls[i]; p.push('W', nh(t.x), nh(t.y), nh(t.remaining)); }
    for (i = 0; i < (st.tileEventsActive || []).length; i++) {
      t = st.tileEventsActive[i]; p.push('E', nh(t.x), nh(t.y), t.eventId, nh(t.remaining));
    }
    if (st.pendingFusion) p.push('F', st.pendingFusion.a, st.pendingFusion.b);
    if (st.desafio) {
      p.push('D', st.desafio.vivo ? 1 : 0, nh(st.desafio.passos), st.desafio.executado ? 1 : 0,
             st.desafio.cumprido ? 1 : 0);
    }
    return hashStr(p.join('|'));
  };

  /* A FOTO: o JSON do estado SEM `grid.tiles` — no lugar, `gridStr` com 2
   * caracteres por casa (o tipo e um dígito: 1 = enfeite, 2 = muro invocado).
   * ~9 KB. Nunca em `placing` (o `placement` guarda referência de unidade). */
  var CASA_LETRA = { floor: 'f', wall: 'w', cover: 'c', hole: 'h' };
  var LETRA_CASA = { f: 'floor', w: 'wall', c: 'cover', h: 'hole' };
  Engine.foto = function (st) {
    if (!st || !st.grid || !st.grid.tiles || st.phase === 'placing') return null;
    var g = st.grid, gs = [], y, x, t, ch, cheia = false;
    for (y = 0; y < g.h; y++) {
      for (x = 0; x < g.w; x++) {
        t = (g.tiles[y] && g.tiles[y][x]) || {};
        ch = CASA_LETRA[t.type];
        if (!ch) { cheia = true; ch = 'f'; }
        gs.push(ch, String((t.deco ? 1 : 0) | (t.invocado ? 2 : 0)));
      }
    }
    var c = {}, k;
    for (k in st) if (Object.prototype.hasOwnProperty.call(st, k) && k !== 'grid') c[k] = st[k];
    if (cheia) c.grid = g;                               // casa de tipo novo: a grade inteira
    else { c.grid = { w: g.w, h: g.h }; c.gridStr = gs.join(''); }
    return JSON.stringify(c);
  };
  /* A RESTAURAÇÃO: remonta a grade, RE-REGISTRA os feitiços da fusão (moram no
   * registro em memória — quem nunca viu a fusão divergia no turno seguinte),
   * vira o estado do motor, esvazia a fila de eventos e avisa com battleStart
   * (o desenho refaz a sala do estado atual). */
  Engine.restaura = function (foto) {
    var st = (typeof foto === 'string') ? JSON.parse(foto) : JSON.parse(JSON.stringify(foto));
    if (st.gridStr != null && st.grid && !st.grid.tiles) {
      var w = st.grid.w, h = st.grid.h, s = String(st.gridStr), tiles = [];
      for (var y = 0; y < h; y++) {
        var row = [];
        for (var x = 0; x < w; x++) {
          var i = (y * w + x) * 2, f = parseInt(s.charAt(i + 1), 10) || 0;
          var t = { type: LETRA_CASA[s.charAt(i)] || 'floor', deco: !!(f & 1) };
          if (f & 2) t.invocado = true;
          row.push(t);
        }
        tiles.push(row);
      }
      st.grid = { w: w, h: h, tiles: tiles };
    }
    delete st.gridStr;
    if (JOGO.Fusion && JOGO.Fusion.spellsFor) {
      for (var u = 0; u < st.units.length; u++) {
        var un = st.units[u];
        if (un.kind !== 'fusion' || !un.classPair) continue;
        var sp = JOGO.Fusion.spellsFor(un.classPair, un.elemPair, un.level) || [];
        for (var q = 0; q < sp.length; q++) Engine.registerSpell(sp[q]);
      }
    }
    Engine.state = st;
    Engine.events.length = 0;
    emit({ type: 'battleStart', state: st, restaurada: true });
    return st;
  };

  // --------------------------------------------------------------- desafios
  /* O DESAFIO DA SALA: um contrato opcional sorteado por
   * batalha, com o rng SEMEADO da sala — mesma sala e mesmo grupo, mesmo
   * desafio, e o teste confere isso. Cumpriu e venceu: +25% de XP e de saque
   * (o multiplicador vive em game.js, junto do da dificuldade).
   *
   * A avaliacao mora nos MESMOS funis da dificuldade: dealDamage (intocado),
   * Engine.move (estatua), processDeath (executor), virada de rodada
   * (relampago) e checkBattleEnd (fundido + veredito final). Regra de motor,
   * nao de interface. */
  var DESAFIOS = {
    intocado:  { nome: 'Intocado',
                 texto: 'Nenhum herói leva dano de golpe inimigo.' },
    relampago: { nome: 'Relâmpago',
                 texto: 'Vença até o fim da rodada 5.' },
    executor:  { nome: 'Executor',
                 texto: 'Derrube {alvo} antes de qualquer outro monstro.' },
    estatua:   { nome: 'Estátua',
                 texto: 'Os heróis andam no máximo 6 células, somando a luta inteira.' },
    fundido:   { nome: 'Fundido',
                 texto: 'Vença com uma fusão viva em campo.' }
  };
  Engine.DESAFIOS = DESAFIOS;
  Engine.DESAFIO_BONUS = 0.25;

  function sorteiaDesafio(state) {
    var ids = ['intocado', 'relampago', 'executor', 'estatua', 'fundido'];
    // 03/09: "com o GM jamais pode dar a possibilidade de fusão" — com o
    // Mestre no grupo o desafio Fundido nem entra na roda
    for (var gi = 0; gi < state.units.length; gi++) {
      var gu = state.units[gi];
      if (gu.kind === 'hero' && gu.side === 'player' && gu.classId === 'gm') {
        ids = ids.filter(function (d0) { return d0 !== 'fundido'; });
        break;
      }
    }
    var id = ids[Math.floor(nextRand(state) * ids.length)];
    var d = { id: id, nome: DESAFIOS[id].nome, texto: DESAFIOS[id].texto,
              vivo: true, cumprido: false, passos: 0,
              alvoUid: null, alvoNome: null, executado: false };
    if (id === 'executor') {
      var monstros = [], m;
      for (var i = 0; i < state.units.length; i++) {
        m = state.units[i];
        if (m.side === 'enemy' && m.alive && m.kind === 'monster' && !m.boss) monstros.push(m);
      }
      if (!monstros.length) {
        for (i = 0; i < state.units.length; i++) {
          m = state.units[i];
          if (m.side === 'enemy' && m.alive && m.kind === 'monster') monstros.push(m);
        }
      }
      var alvo = monstros.length
        ? monstros[Math.floor(nextRand(state) * monstros.length)] : null;
      if (!alvo) {
        // sala sem monstro (bancada de teste): o executor nao tem sentido
        d.id = 'relampago'; d.nome = DESAFIOS.relampago.nome; d.texto = DESAFIOS.relampago.texto;
      } else {
        d.alvoUid = alvo.uid; d.alvoNome = alvo.name;
        d.texto = d.texto.replace('{alvo}', alvo.name);
      }
    }
    state.desafio = d;
    emit({ type: 'desafio', id: d.id, nome: d.nome, texto: d.texto });
    log('Desafio da sala: ' + d.nome + ' — ' + d.texto);
  }

  function desafioFalha(state, motivo) {
    var d = state.desafio;
    if (!d || !d.vivo) return;
    d.vivo = false;
    emit({ type: 'desafioFalhou', id: d.id });
    log('O desafio ' + d.nome + ' se perde' + (motivo ? ' — ' + motivo : '') + '.');
  }

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

  // `vazia` (22/09, só para a tela): julga a casa como se não houvesse ninguém
  // nela — é como quem mira vê a casa de um invisível do outro lado
  function validTargetCell(state, unit, spell, tx, ty, vazia) {
    if (!inBounds(state, tx, ty)) return false;
    if (!isFloor(state, tx, ty)) return false;
    var rg = sRange(spell);
    var d = manhattan(unit.x, unit.y, tx, ty);
    if (d < (rg.min || 0) || d > (rg.max != null ? rg.max : 1)) return false;
    if (rg.line && !(tx === unit.x || ty === unit.y)) return false;
    if (rg.los && !Engine.los(state, unit.x, unit.y, tx, ty)) return false;
    var occupant = vazia ? null : Engine.unitAt(state, tx, ty);
    // o corpo existe (a casa não está vazia para invocar ou saltar), mas quem
    // mira não vê inimigo invisível: para ele a casa está sem ninguém (22/09)
    if (spell.needsEmptyTile && occupant) return false;
    if (occupant && ocultoDe(unit, occupant)) occupant = null;
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

  /* AS CASAS NO ALCANCE MAS SEM VISÃO (19/09), para a tela pintar com cor
   * própria e dizer o porquê. `spellRange` já filtra pela visão, então a casa
   * atrás do muro simplesmente não era pintada e o jogador não sabia se era
   * distância, linha ou parede ("eu não consigo mas ele consegue"). Devolve
   * cada casa de chão que passa por distância e linha e cai só pela visão,
   * com o primeiro muro que a bloqueia. Feitiço sem `los` devolve vazio. */
  Engine.casasSemVisao = function (state, uid, spellId) {
    var u = Engine.findUnit(state, uid);
    var spell = spellDef(spellId);
    if (!u || !spell) return [];
    var rg = sRange(spell);
    var out = [];
    if (!rg.los) return out;
    for (var y = 0; y < state.grid.h; y++) {
      for (var x = 0; x < state.grid.w; x++) {
        if (!isFloor(state, x, y)) continue;
        var d = manhattan(u.x, u.y, x, y);
        if (d < (rg.min || 0) || d > (rg.max != null ? rg.max : 1)) continue;
        if (rg.line && !(x === u.x || y === u.y)) continue;
        var muro = Engine.muroNaLinha(state, u.x, u.y, x, y);
        if (muro) out.push({ x: x, y: y, muro: muro });
      }
    }
    return out;
  };

  // 22/09: a mesma porta de castTargets, para a tela saber se o feitiço SAI
  // agora (PA, recarga, vezes por turno) antes de pintar qualquer casa
  Engine.podeLancar = function (state, uid, spellId) {
    var u = Engine.findUnit(state, uid);
    var spell = spellDef(spellId);
    return !!(u && spell && canCastNow(state, u, spell));
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

  /* A ÁREA NÃO ATRAVESSA MURO (19/09, o dono: "obstáculos atrapalham").
   * A visão era exigida do conjurador até o CENTRO do impacto, e daí a área
   * seguia para o outro lado da parede: medido, 4,1% das casas de círculo 3 e
   * 5,1% das de linha 5 ficavam atrás de um '#' (emberlock#1: 14,6%) — o alvo
   * escondido levava a explosão sem que ninguém o visse. Agora toda casa da
   * área precisa de Engine.los do centro do impacto até ela, em todas as
   * formas; a casa do centro entra sempre. A linha para no primeiro muro. A
   * única exceção nomeada é o Julgamento do Mestre (gm.js), global de
   * propósito e fora do jogo em rede. */
  var AREA_ATRAVESSA = { 'gm-julgamento': true };

  // Aceita id de feitiço OU o objeto do feitiço (armadilhas e eventos de
  // terreno conjuram feitiços sintéticos que não existem em DATA).
  Engine.aoeTiles = function (state, spellOrId, casterX, casterY, tx, ty) {
    var spell = (spellOrId && typeof spellOrId === 'object') ? spellOrId : spellDef(spellOrId);
    if (!spell) return [];
    var aoe = sAoe(spell);
    var shape = aoe.shape, size = aoe.size || 0;
    var atravessa = !!(spell.id && AREA_ATRAVESSA[spell.id]);
    var out = [];
    function add(x, y) {
      if (!inBounds(state, x, y) || state.grid.tiles[y][x].type === 'wall') return false;
      if (!atravessa && !(x === tx && y === ty) && !Engine.los(state, tx, ty, x, y)) return false;
      out.push({ x: x, y: y });
      return true;
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
      // linha de comprimento `size` a partir do alvo, afastando-se do conjurador;
      // 19/09: para no primeiro muro (o que vem depois dele não existe para a linha)
      var ddx = tx - casterX, ddy = ty - casterY;
      var sx = 0, sy = 0;
      if (Math.abs(ddx) >= Math.abs(ddy)) sx = ddx === 0 ? 1 : (ddx > 0 ? 1 : -1);
      else sy = ddy > 0 ? 1 : -1;
      for (i = 0; i < Math.max(1, size); i++) {
        if (!atravessa && i > 0 && blocksSight(state, tx + i * sx, ty + i * sy)) break;
        add(tx + i * sx, ty + i * sy);
      }
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

  /* A COBERTURA NO DANO (19/09). Vale para os efeitos de dano direto (damage,
   * chain, detonateMarks) e é decidida da casa de onde o golpe SAI até a
   * VÍTIMA — e "de onde sai" é a MESMA casa de onde a visão daquele golpe é
   * exigida: o conjurador para o alvo (a casa do centro), o centro do impacto
   * para as outras casas da área (aoeTiles exige a visão dali), a vítima
   * anterior para cada salto do raio (chainDamage exige a visão dela). A
   * revisão de 19/09 pegou o contrário: uma mureta atrás de um '#' que o
   * conjurador nem via dando −25% a quem a explosão alcançava por outro lado,
   * e o salto do raio em linha reta "coberto" por uma mureta que só estava na
   * linha do conjurador. `cobre` só diz SE há cobertura; o corte de 25% mora
   * em dealDamage, DEPOIS da escala da dificuldade: a revisão pegou o log
   * dizendo "−3" num tiro de inimigo no difícil que perdera 5 — a cobertura
   * cortava o dano cru e o 1,35× vinha depois, arredondando duas vezes. Um
   * lugar só, com o número de verdade. */
  function cobre(state, cx, cy, target) {
    return Engine.coberto(state, cx, cy, target.x, target.y);
  }

  // Aplica dano já calculado: escudo absorve antes do PV. Retorna a perda de PV.
  // 19/09: `cob` (de `cobre`) diz que a vítima tem cobertura: o corte entra
  // aqui, depois da dificuldade, arredonda para baixo e nunca zera o golpe
  // (mínimo 1: a mureta ameniza, não anula). O evento de dano leva
  // `coberto: true` e a `reducao` de verdade, para a tela dizer "cobertura −25%".
  function dealDamage(state, target, amount, element, sourceUid, noReflect, cob) {
    /* DANO VEZES A DIFICULDADE, e so quando quem bate e INIMIGO.
     *
     * Aqui, e nao no calculo de cada feitico, porque `dealDamage` e o funil por
     * onde TODO dano passa — veneno, armadilha, reflexo e explosao de morte
     * inclusive. Escalar no calculo pegaria so os feiticos, e o dificil ficaria
     * pela metade sem ninguem perceber.
     *
     * Dano de clima nao passa por aqui (ele mexe em `hp` direto), e e escalado
     * no proprio `weatherTick`. */
    if (sourceUid && amount > 0) {
      var quem = Engine.findUnit(state, sourceUid);
      if (quem && quem.side === 'enemy') {
        amount = Math.max(1, Math.round(amount * (Engine.dif(state).dano || 1)));
      }
    }
    var cobertura = null;                       // 19/09: a cobertura baixa, sobre o dano já escalado
    if (cob && amount > 0) {
      var comCobertura = Math.max(1, Math.floor(amount * (100 - Engine.COBERTURA_PCT) / 100));
      if (comCobertura < amount) {
        cobertura = { reducao: amount - comCobertura };
        log(target.name + ' tem cobertura −' + Engine.COBERTURA_PCT + '% (−' + cobertura.reducao + ').', target.uid);
        amount = comCobertura;
      }
    }
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
    // desafio INTOCADO: só falha se um golpe de INIMIGO ferir um herói/fusão
    // de verdade — escudo que segura tudo não quebra o contrato, de propósito:
    // defender bem é a jogada que o desafio quer ensinar.
    if (hpLoss > 0 && sourceUid && state.desafio && state.desafio.vivo &&
        state.desafio.id === 'intocado' && target.side === 'player' &&
        (target.kind === 'hero' || target.kind === 'fusion')) {
      var qd2 = Engine.findUnit(state, sourceUid);
      if (qd2 && qd2.side === 'enemy') desafioFalha(state, target.name + ' foi ferido');
    }
    target.hp = Math.max(0, target.hp - hpLoss);
    var evDano = { type: 'damage', uid: target.uid, amount: amount, element: element,
                   absorbed: absorbed, hpLoss: hpLoss, sourceUid: sourceUid || null };
    if (cobertura) { evDano.coberto = true; evDano.reducao = cobertura.reducao; }
    emit(evDano);

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
            log(target.name + ' reflete ' + back + ' de dano.', target.uid);
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
      log(unit.name + ' se enfurece! (+' + t.power + ' de poder)', unit.uid);
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

  /* QUANTAS INVOCACOES ESTA UNIDADE PODE SUSTENTAR AO MESMO TEMPO.
   *
   * Base 1, +1 a cada degrau de nivel alcancado (15 e 30 por padrao), mais o
   * que um item conceder em `unit.summonBonus`. Monstro nao tem teto: chefe que
   * planta cria — a Jardineira e seus Brotinhos — ja e controlado por recarga e
   * pela duracao da sala, e por-lhe teto mudaria desenho de chefe.
   */
  Engine.summonCap = function (unit) {
    if (!unit) return 0;
    if (!unit.classId && unit.kind !== 'fusion') return 99;   // monstro: sem teto
    var C = (DATA().summonCap) || { base: 1, degraus: [15, 30] };
    var n = C.base || 1;
    var deg = C.degraus || [];
    for (var i = 0; i < deg.length; i++) if ((unit.level || 1) >= deg[i]) n++;
    return n + (unit.summonBonus || 0);
  };

  /* As invocacoes VIVAS desta unidade, da mais antiga para a mais nova, pelo
   * `_birth` (o contador de criacao). Ordenar pelo `uid` era 'u12' - 'u3' =
   * NaN e o sort ficava por conta do navegador (11/09): no lockstep, dois
   * clientes poderiam mandar embora invocacoes diferentes quando o teto enche. */
  Engine.summonsOf = function (state, unit) {
    var out = [];
    if (!state || !unit) return out;
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.kind === 'summon' && u.alive && !u.offBoard && u.summonerUid === unit.uid) out.push(u);
    }
    out.sort(function (a, b) { return (a._birth || 0) - (b._birth || 0); });
    return out;
  };

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

    // desafio EXECUTOR: a PRIMEIRA morte de monstro decide. Invocação inimiga
    // caindo antes não conta — não é culpa do jogador o que o inimigo chama.
    if (state.desafio && state.desafio.vivo && state.desafio.id === 'executor' &&
        unit.side === 'enemy' && unit.kind === 'monster' && !state.desafio.executado) {
      state.desafio.executado = true;
      if (unit.uid !== state.desafio.alvoUid) {
        desafioFalha(state, unit.name + ' caiu antes de ' + state.desafio.alvoNome);
      }
    }

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
        // 19/09: "obstáculos atrapalham" vale para a explosão também — quem
        // está atrás de um muro não é ferido (a revisão pegou a bomba ferindo
        // através de um '#'). A mesma Engine.los da área dos feitiços.
        if (v.alive && !v.offBoard && manhattan(unit.x, unit.y, v.x, v.y) <= explode.radius &&
            Engine.los(state, unit.x, unit.y, v.x, v.y)) victims.push(v);
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
      // o VEREDITO do desafio, antes do battleEnd: quem ouve o fim já ouve
      // o desafio decidido. `fundido` só se avalia aqui (é um estado final);
      // os outros quatro são o próprio `vivo` que os funis mantiveram.
      var dz = state.desafio;
      if (dz) {
        if (dz.id === 'fundido') {
          dz.cumprido = false;
          for (var fz = 0; fz < state.units.length; fz++) {
            var uz = state.units[fz];
            if (uz.alive && !uz.offBoard && uz.side === 'player' && uz.kind === 'fusion') {
              dz.cumprido = true; break;
            }
          }
          if (!dz.cumprido) dz.vivo = false;
        } else {
          dz.cumprido = !!dz.vivo;
        }
        if (dz.cumprido) {
          emit({ type: 'desafioCumprido', id: dz.id });
          log('Desafio cumprido: ' + dz.nome + '! O prêmio cresce.');
        }
      }
      emit({ type: 'battleEnd', winner: 'player' });
      log('Sala limpa!');
    }
  }
  Engine.checkBattleEnd = checkBattleEnd;

  // --------------------------------------------------------------- push/pull
  function forcedMove(state, caster, target, tiles, mode) {
    if (!target.alive || tiles <= 0) return;
    if (Engine.unitHasTrait(target, 'pushImmune')) {
      log(target.name + ' não se move um palmo.', target.uid);
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
        log(target.name + ' colide! (' + collisionDmg + ' de dano)', target.uid);
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
  /* QUEM SABE DE UMA ARMADILHA (22/09, o dono: "no xamã, as armadilhas jamais
   * podem ficar visíveis para os inimigos ou adversários… só para o jogador e
   * para quem estiver jogando no time dele"). O lado de quem armou, sempre; no
   * PvP, ninguém mais. Fora do PvP a armadilha de MONSTRO continua à vista do
   * jogador (e dos pets e invocações dele), como sempre foi — o pedido foi pela
   * do Xamã; a do lado do jogador é que os monstros não enxergam. A MESMA régua
   * serve à IA (ai.js) e à tela (Game.veArmadilha): quem não sabe não desvia. */
  Engine.armadilhaVisivel = function (state, lado, tr) {
    if (!tr) return false;
    if (tr.side === lado) return true;
    return !(state && state.pvp) && tr.side === 'enemy';
  };

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
        /* 22/09: `selfHarm` só quando o "conjurador" é a própria vítima (o dono
         * morreu). Com o dono vivo ao lado da armadilha em círculo, a carga o
         * pegava junto — era raro enquanto a IA desviava; com ela caindo, virou
         * o normal (o Xamã arma a casa da frente e leva a própria Brasa).
         * `armadilha`: o disparo não tira o dono das sombras (castCore). */
        castCore(state, owner, sp, x, y, { casterX: x, casterY: y, selfHarm: owner === u,
                                           armadilha: true, silent: true });
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
    if (!validTargetCell(state, caster, spell, x, y)) {
      // 22/09: quem mira uma casa que pede chão livre e acha um corpo que não
      // via fica sabendo ali mesmo — como quem anda e esbarra (nada é gasto)
      var ali = spell.needsEmptyTile ? Engine.unitAt(state, x, y) : null;
      if (ali && ocultoDe(caster, ali)) log(caster.name + ' não acha espaço ali: há alguém que não se vê.');
      return false;
    }

    caster.pa -= sPaCost(spell);
    caster.castsThisTurn[spellId] = (caster.castsThisTurn[spellId] || 0) + 1;
    if (sCooldown(spell) > 0) caster.cooldowns[spellId] = sCooldown(spell) + 1;
    /* 22/09 — A RECARGA DA INVISIBILIDADE É UMA SÓ. Com 2 turnos inteiros por
     * lance, a Sombra Curta e a Névoa Salgada (recarga 3 cada) alternadas
     * cobriam 100% das vezes do inimigo: a IA nunca mais achava o Ladino e a
     * sala só acabava na fúria da rodada 40 (medido na revisão). Lançar uma
     * põe as outras de invisibilidade na mesma recarga: 2 vezes do inimigo
     * escondido, 2 à vista. */
    if (sCooldown(spell) > 0 && spellHasEffect(spell, 'invisible')) {
      for (var q = 0; q < caster.spells.length; q++) {
        var outra = spellDef(caster.spells[q]);
        if (outra && outra.id !== spell.id && spellHasEffect(outra, 'invisible')) {
          caster.cooldowns[outra.id] = Math.max(caster.cooldowns[outra.id] || 0, sCooldown(spell) + 1);
        }
      }
    }

    castCore(state, caster, spell, x, y, {});
    return true;
  };

  /* O QUE TIRA DAS SOMBRAS (22/09). Ferir de propósito: dano, raio em cadeia e
   * detonar marcas sempre; veneno, empurrão, puxão, raiz, marca e quebrar
   * escudo quando o feitiço mira outro (o veneno em si mesmo das Veias em
   * Chamas não conta). Antes só 'damage' contava, e o Corte em Cadeia batia
   * sem aparecer. */
  var FERE = { damage: 1, chain: 1, detonateMarks: 1 };
  var HOSTIL = { poison: 1, push: 1, pull: 1, root: 1, mark: 1, dispelShield: 1 };
  function tiraDasSombras(spell) {
    var efs = sEffects(spell), mira = spell.targetSide;
    for (var i = 0; i < efs.length; i++) {
      var t = efs[i] && efs[i].type;
      if (FERE[t]) return true;
      if (HOSTIL[t] && mira !== 'self' && mira !== 'ally') return true;
    }
    return false;
  }

  // Conjuração sem custo/validação (usada por cast, armadilhas, pets e eventos).
  function castCore(state, caster, spell, x, y, opts) {
    opts = opts || {};
    /* invisível quebra ao ferir (tiraDasSombras). 22/09: só o golpe DE
     * PROPÓSITO — a armadilha que dispara no turno do outro chega aqui com
     * `armadilha` e não tira o dono das sombras. E a quebra vem ANTES do
     * evento `cast`: a tela do adversário decide pelo estado se mostra o
     * golpe, e o golpe que revela tem de aparecer. */
    var oculto = Engine.unitHasEffect(caster, 'invisible');
    var saiDasSombras = oculto && !opts.selfHarm && !opts.armadilha && tiraDasSombras(spell);
    if (saiDasSombras) {
      for (var r = caster.effects.length - 1; r >= 0; r--) {
        if (caster.effects[r].type === 'invisible') caster.effects.splice(r, 1);
      }
    }
    emit({ type: 'cast', uid: caster.uid, spellId: spell.id, x: x, y: y,
           fxKey: spell.fxKey, element: spell.element });
    // quem CONTINUA nas sombras não conta no diário do adversário o que lançou
    if (!opts.silent) log(caster.name + ' conjura ' + spell.name + '.', (oculto && !saiDasSombras) ? caster.uid : undefined);
    if (saiDasSombras) log(caster.name + ' sai das sombras!');
    applyEffects(state, caster, spell, x, y, opts);
  }
  Engine.castCore = castCore;

  /* A POÇÃO DE VIDA NÃO É DA BATALHA (13/09, o dono: "a poção não é para usar na
   * batalha.. e sim para curar a vida após uma batalha na sala de espera entre as
   * salas"). O motor não tem ação de beber: o gole mora na antessala (Game.bebeNaEspera)
   * e o lance {a:'po'} que chegar de uma página velha ou forjada é recusado pelo Game
   * (executa) e derruba a sala no juiz (servidor/juiz/sala.js). */

  /* O FEITIÇO MISTO (03/10, a bancada do equilíbrio — docs/EQUILIBRIO.md §3).
   *
   * Feitiço de classe segue a convenção de spells.js: área que fere carrega
   * SÓ efeito contra o inimigo, e o bônus próprio mora num feitiço de 'self'.
   * As formas de FUSÃO não seguem — e de propósito: "área que fere inimigo e
   * cura aliado dentro dela" é o desenho de meia tabela de duplas
   * (docs/CLASSES_V3.md §4). O motor aplicava cada efeito em QUEM estivesse na
   * área, de qualquer lado, e a medida achou o estrago: o Contrapeso dava
   * escudo e fixação ao inimigo que apanhava; o Hospício e a Botica feriam os
   * aliados que deviam curar; o Recuo e o Rastro davam esquiva e passo ao ALVO
   * do golpe; e a Sentinela cravava o ídolo e o matava no mesmo gesto (o dano
   * da cravada caía na casa do recém-nascido). Dezoito formas, e o PAIR_TUNE
   * de 3,83 do Muro Vivo existia para tapar isso.
   *
   * A regra, no mesmo espírito da invisibilidade de 22/09 ("no feitiço que
   * fere, quem some é o conjurador, esteja ele na área ou não"): num feitiço
   * que tem efeito A FAVOR (cura, escudo, regeneração, bênção ou resistência
   * positiva, reflexo, limpeza, invocação) E efeito HOSTIL, o hostil só pega o
   * outro lado, e o a favor só pega o lado de quem lança — e quem lança sempre,
   * esteja ou não na área. Feitiço só hostil continua com fogo amigo (a área do
   * Bruxo queima o parceiro, como sempre); feitiço só a favor continua pegando
   * quem estiver na área. Monstro, pet e invocação não têm feitiço misto
   * (medido), então o PvE dos monstros não muda. */
  var EF_A_FAVOR = { heal: 1, shield: 1, regen: 1, reflect: 1, cleanse: 1, summon: 1 };
  var EF_HOSTIL = { damage: 1, poison: 1, root: 1, push: 1, pull: 1, mark: 1,
                    detonateMarks: 1, dispelShield: 1, chain: 1 };
  function efeitoAFavor(ef) {
    return !!ef && (!!EF_A_FAVOR[ef.type] || ((ef.type === 'buff' || ef.type === 'resist') && ef.value > 0));
  }
  function efeitoHostil(ef) {
    return !!ef && (!!EF_HOSTIL[ef.type] || ((ef.type === 'buff' || ef.type === 'resist') && ef.value < 0));
  }
  function feiticoMisto(spell) {
    var efs = sEffects(spell), bom = false, mau = false;
    for (var i = 0; i < efs.length; i++) {
      if (efeitoAFavor(efs[i])) bom = true;
      if (efeitoHostil(efs[i])) mau = true;
    }
    return bom && mau;
  }
  Engine.feiticoMisto = feiticoMisto;
  Engine.efeitoAFavor = efeitoAFavor;
  Engine.efeitoHostil = efeitoHostil;

  function applyEffects(state, caster, spell, x, y, opts) {
    opts = opts || {};
    // armadilha e evento de chão (selfHarm) têm a vítima como "conjurador":
    // ali não há lado a respeitar
    var misto = !opts.selfHarm && feiticoMisto(spell);
    var cx = opts.casterX != null ? opts.casterX : caster.x;
    var cy = opts.casterY != null ? opts.casterY : caster.y;
    /* 19/09: DE ONDE O GOLPE SAI, para a cobertura. A armadilha e o evento de
     * chão mandam casterX/Y (a casa da vítima) e valem como vieram; o feitiço
     * que se move ANTES de bater (o Salto de Brasa: teleport > damage) fere de
     * onde o conjurador ESTÁ na hora do dano, não de onde partiu — a revisão
     * pegou o golpe de contato saindo com −25% porque a linha do ponto de
     * partida entrava por uma mureta ao lado do alvo. */
    function deOnde() {
      return opts.casterX != null ? { x: cx, y: cy } : { x: caster.x, y: caster.y };
    }
    /* 19/09 (a rodada de conserto): a cobertura de cada vítima é medida DA
     * MESMA casa de onde a visão daquele golpe é exigida. Quem está na casa do
     * centro leva o golpe do conjurador (deOnde); quem está nas outras casas
     * da área leva a explosão do CENTRO do impacto (aoeTiles só as inclui com
     * visão dali) — a revisão pegou uma mureta atrás de um '#' que o
     * conjurador nem via dando −25% a quem a explosão alcançava por outro lado. */
    function cobreDe(u) {
      var o = (u.x === x && u.y === y) ? deOnde() : { x: x, y: y };
      return cobre(state, o.x, o.y, u);
    }
    var tiles = Engine.aoeTiles(state, spell, cx, cy, x, y);
    var effects = sEffects(spell);
    // v2.2/v2.3: calculado UMA vez por conjuração — depende do conjurador e do
    // feitiço, não do alvo. Inclui buffs, bônus elemental e fúria da sala.
    var castPower = Engine.castPower(state, caster, spell);
    // 03/09: o PODER do pet (nível e estrelas) escala também a cura, o escudo
    // e o buff dos feitiços DELE — pelo mesmo número que já escala o dano.
    // Só para pets: mexer nisso para heróis mudaria o balanço das curas.
    var petMult = (caster.kind === 'pet') ? (100 + castPower) / 100 : 1;

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
    // 03/10: no feitiço misto, também não atingem o lado dele.
    function hostileTargets() {
      var l = unitsInTiles(!!opts.selfHarm);
      return misto ? l.filter(function (w) { return w.side !== caster.side; }) : l;
    }
    // 03/10: o efeito a favor de um feitiço misto vai para o lado de quem
    // lança, e para quem lança sempre (ver feiticoMisto)
    function favorTargets() {
      var l = unitsInTiles(true);
      if (!misto) return l;
      l = l.filter(function (w) { return w.side === caster.side; });
      if (caster.alive && !caster.offBoard && l.indexOf(caster) < 0) l.push(caster);
      return l;
    }
    // buff e resistência valem pelos dois lados: o sinal decide
    function porSinal(ef) { return (misto && ef.value < 0) ? hostileTargets() : favorTargets(); }
    var muroDesteLance = {};   // 03/10: as casas que este lance acabou de murar (a armadilha vai ao pé delas)

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
            var hpLoss = dealDamage(state, u, amt, eff.element, caster.uid, false, cobreDe(u));   // 19/09: a cobertura baixa
            if (eff.lifesteal && hpLoss > 0 && caster.alive) {
              var stolen = Math.round(hpLoss / 2);
              if (stolen > 0) {
                applyHeal(state, caster, stolen);
                log(caster.name + ' rouba ' + stolen + ' de vida.', caster.uid);
              }
            }
          }
          break;

        case 'heal':
          targets = favorTargets();
          for (t = 0; t < targets.length; t++) {
            applyHeal(state, targets[t], Math.round(rollInt(state, eff.min, eff.max) * petMult));
          }
          break;

        case 'shield':
          targets = favorTargets();
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            var vSh = Math.round(eff.value * petMult);
            applied = { type: 'shield', value: vSh, remaining: vSh,
                        duration: eff.duration, sourceUid: caster.uid };
            u.effects.push(applied);
            recomputeShield(u);
            emit({ type: 'shield', uid: u.uid, amount: vSh });
            emit({ type: 'effectApplied', uid: u.uid, effect: applied });
          }
          break;

        case 'buff':
          targets = porSinal(eff);
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            var vBf = Math.round(eff.value * petMult);
            applied = { type: 'buff', stat: eff.stat, value: vBf,
                        duration: eff.duration, sourceUid: caster.uid };
            u.effects.push(applied);
            // ajuste imediato para buffs de recursos valerem já neste turno
            if (eff.stat === 'pa') u.pa = Math.max(0, u.pa + vBf);
            if (eff.stat === 'pp') u.pp = Math.max(0, u.pp + vBf);
            if (eff.stat === 'initiative') u.initiative += vBf; // não reordena
            emit({ type: 'effectApplied', uid: u.uid, effect: applied });
          }
          break;

        case 'resist':
          targets = porSinal(eff);
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
          targets = favorTargets();
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
            /* O TETO, E A MAIS ANTIGA SAINDO PARA ABRIR VAGA.
             *
             * Mato ANTES de invocar, senao a contagem ficaria um a mais durante
             * o instante em que as duas coexistem — e um traco de morte que
             * olhasse o tabuleiro veria um corpo que ja nao devia estar la.
             *
             * MORRE DE VERDADE (processDeath roda inteiro), ao contrario do que
             * acontece na fusao. La as invocacoes SAEM sem disparar traco,
             * porque a explosao seria colateral de uma jogada cujo custo o
             * jogador nao teria como prever. Aqui ele escolheu conjurar estando
             * no teto, e a consequencia e aprendivel — de quebra nasce uma
             * jogada de verdade: invocar o CAO DE BRASA (explodeOnDeath, 20 de
             * fogo em raio 1) ao lado do inimigo e depois substitui-lo detona a
             * bomba de proposito.
             */
            var teto = Engine.summonCap(caster);
            var minhas = Engine.summonsOf(state, caster);
            while (minhas.length >= teto && minhas.length > 0) {
              var velha = minhas.shift();
              log(velha.name + ' se desfaz para abrir vaga.');
              velha.hp = 0;
              processDeath(state, velha);
            }
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
            log(u.name + ' provoca os inimigos!', u.uid);
          }
          break;

        case 'invisible':
          /* 22/09: a invisibilidade é de QUEM LANÇA e do time dele. As formas
           * de fusão que batem e somem (Epílogo, Espectro, Carrossel, Pesadelo,
           * Beco, Dédalo) punham o efeito em quem estava na área — os inimigos
           * atingidos. Quando isso só atrapalhava a IA não fazia diferença;
           * agora o invisível some da tela do outro lado e deixa de ser alvo,
           * e o golpe escondia o próprio alvo do resto do time. O texto delas
           * promete o contrário ("some de novo no mesmo movimento", "some junto
           * com ele"): o inimigo fica de fora e, no feitiço que fere, quem some
           * é o conjurador, esteja ele na área ou não. */
          targets = unitsInTiles(true).filter(function (w) { return w.side === caster.side; });
          if (caster.alive && !opts.selfHarm && targets.indexOf(caster) < 0 && tiraDasSombras(spell)) {
            targets.push(caster);
          }
          for (t = 0; t < targets.length; t++) {
            u = targets[t];
            applied = { type: 'invisible', duration: eff.duration, sourceUid: caster.uid };
            // 22/09: posta no PRÓPRIO turno, não conta o fim dele (tickDownEffects)
            if (u === Engine.activeUnit(state)) applied.lancadoNoTurno = state.turno || 0;
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
            log(u.name + ' fica preso ao chão.', u.uid);
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
            log(u.name + ': ' + stacks + ' marcas detonam (' + dmg + ').', u.uid);
            dealDamage(state, u, dmg, eff.element || spell.element || 'neutro', caster.uid, false, cobreDe(u));   // 19/09: a cobertura baixa
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
        case 'wall': {
          /* A AREA INTEIRA, e nao so o centro.
           *
           * `tiles` ja vem calculado la em cima e todo efeito de UNIDADE o usa.
           * Este aqui usava o `x, y` do centro, entao "Muralha", que promete
           * "tres muros em linha", erguia um. Sao OITO feiticos assim — todos
           * os de nivel 15 e 30 do Minotauro, metade do verbo BARRAR dele. Nao
           * dava erro: so entregava menos do que a descricao dizia.
           *
           * Cada casa e testada por si, com as mesmas regras de sempre. Um muro
           * em linha que encosta numa parede pula aquela casa em vez de falhar
           * inteiro. */
          var elMuro = eff.element || spell.element || 'neutro';
          var durMuro = eff.duration || 3;
          var subiram = 0;
          for (var wt = 0; wt < tiles.length; wt++) {
            var wx2 = tiles[wt].x, wy2 = tiles[wt].y;
            if (!isFloor(state, wx2, wy2) || Engine.unitAt(state, wx2, wy2)) continue;
            var jaTem = false;
            for (var wi = 0; wi < state.walls.length; wi++) {
              if (state.walls[wi].x === wx2 && state.walls[wi].y === wy2) { jaTem = true; break; }
            }
            if (jaTem) continue;
            var cel = tileAt(state, wx2, wy2);
            if (!cel) continue;
            // O ELEMENTO fica guardado no muro, nao so no evento. O
            // renderizador desenha a pedra pela lista `state.walls` (um muro
            // dura varios turnos e o evento passa uma vez so), e sem isso ele
            // nao teria como saber de que cor pintar o que ja estava de pe —
            // mesmo problema que a armadilha teve, resolvido do mesmo jeito.
            /* `defId` GUARDADO NO MURO, e nao so o `ownerUid`.
             *
             * O escudo agora tem arte por fusao, e quem desenha precisa saber
             * QUAL fusao o ergueu. Buscar pelo uid nao serve: o dono pode
             * morrer antes de o muro cair, e ai a busca devolveria nada e o
             * escudo trocaria de arte no meio da vida dele — na frente do
             * jogador, sem erro nenhum no console. */
            state.walls.push({ x: wx2, y: wy2, antes: cel.type, deco: !!cel.deco,
                               ownerUid: caster.uid, side: caster.side,
                               defId: caster.defId || null,
                               element: elMuro, remaining: durMuro });
            cel.type = 'wall';
            cel.deco = false;
            cel.invocado = true;
            muroDesteLance[wx2 + ',' + wy2] = true;
            emit({ type: 'wallRaised', uid: caster.uid, x: wx2, y: wy2,
                   element: elMuro, duration: durMuro });
            subiram++;
          }
          // DIZER QUANTOS SUBIRAM. Quem esperava tres e ve "ergue 2 muros"
          // entende na hora que uma casa estava ocupada; antes so via menos
          // pedra e nao tinha como saber por que.
          if (subiram === 1) log(caster.name + ' ergue um muro.');
          else if (subiram > 1) log(caster.name + ' ergue ' + subiram + ' muros.');
          else log(caster.name + ' não acha onde erguer o muro.');
          break;
        }

        case 'trap': {
          /* MESMA CORRECAO DO MURO: a armadilha e efeito de CASA e tambem
           * ignorava a area. Hoje nenhum feitico de armadilha tem area maior
           * que uma casa, entao isto nao muda nada AGORA — `tiles` vem com uma
           * casa so e o laco roda uma vez.
           *
           * Arrumo junto assim mesmo porque o defeito e o mesmo e esta na mesma
           * familia de efeito: deixar so um dos dois certo e plantar a mesma
           * armadilha para quem escrever um feitico de armadilha em linha
           * depois, e essa pessoa nao vai desconfiar do engine — vai desconfiar
           * do proprio feitico. */
          var nArm = 0;
          /* AO PÉ DO MURO (03/10). "Muro que deixa brasa acesa em volta", "deixa o
           * laço armado ao pé": o feitiço ergue o muro na casa e arma a
           * armadilha no MESMO lance — e a armadilha caía na casa que acabara de
           * virar pedra (isFloor falso) e sumia. Os três feitiços de nível 5 do
           * Minotauro e a Guarita do Muro Vivo nunca armaram nada. Agora a casa
           * murada por ESTE lance passa a armadilha para a primeira vizinha de
           * chão livre (norte, sul, oeste, leste — ordem fixa, o juiz refaz
           * igual), sem repetir casa. */
          var usadasArm = {};
          for (var tt = 0; tt < tiles.length; tt++) {
            var tx2 = tiles[tt].x, ty2 = tiles[tt].y;
            if (muroDesteLance[tx2 + ',' + ty2]) {
              var pe = null;
              for (var dq = 0; dq < DIRS.length && !pe; dq++) {
                var px2 = tx2 + DIRS[dq][0], py2 = ty2 + DIRS[dq][1];
                if (!isFloor(state, px2, py2) || usadasArm[px2 + ',' + py2] || Engine.trapsAt(state, px2, py2).length) continue;
                pe = { x: px2, y: py2 };
              }
              if (!pe) continue;
              tx2 = pe.x; ty2 = pe.y;
            }
            if (!isFloor(state, tx2, ty2) || usadasArm[tx2 + ',' + ty2]) continue;
            usadasArm[tx2 + ',' + ty2] = true;
            var trap = { x: tx2, y: ty2, trapId: eff.trapId, ownerUid: caster.uid,
                         side: caster.side, remaining: eff.duration || 3 };
            state.traps.push(trap);
            // `side` (22/09): a tela do outro lado cala este evento (Game.eventoParaTela)
            emit({ type: 'trapSet', uid: caster.uid, trapId: eff.trapId, x: tx2, y: ty2, side: caster.side });
            nArm++;
          }
          if (nArm === 1) log(caster.name + ' arma uma armadilha.');
          else if (nArm > 1) log(caster.name + ' arma ' + nArm + ' armadilhas.');
          break;
        }

        case 'weatherShift':
          setWeather(state, eff.weather);
          break;

        case 'cleanse':
          targets = favorTargets();
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
              log(u.name + ' se purifica.', u.uid);
            }
          }
          break;

        case 'reflect':
          targets = favorTargets();
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
              log(u.name + ' perde o escudo.', u.uid);
            }
          }
          break;

        case 'moveTo':
          slideTo(state, caster, x, y, eff.maxTiles || 0);
          break;

        case 'chain':
          var oC = deOnde();
          chainDamage(state, caster, eff, spell, x, y, castPower, oC.x, oC.y);
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

  // v2: raio em cadeia. 19/09: `cx, cy` é de onde o raio sai (o conjurador, ou
  // a casa da armadilha): a cobertura do PRIMEIRO golpe é medida de lá; a de
  // cada salto, da vítima anterior — a mesma casa de onde o salto exige a
  // visão (a revisão pegou um salto em linha reta "coberto" por uma mureta que
  // só estava na linha do conjurador).
  function chainDamage(state, caster, eff, spell, x, y, castPower, cx, cy) {
    var cur = Engine.unitAt(state, x, y);
    if (!cur || !cur.alive || cur.side === caster.side) return;
    var hit = {};
    var mult = 1;
    var falloff = eff.falloff != null ? eff.falloff : 0.7;
    var jumps = eff.jumps || 0;
    var element = eff.element || spell.element || 'neutro';
    var de = { x: cx != null ? cx : caster.x, y: cy != null ? cy : caster.y };   // de onde ESTE golpe sai
    for (var j = 0; j <= jumps; j++) {
      if (!cur || !cur.alive) break;
      hit[cur.uid] = true;
      var amt = rollDamageAmount(state, eff.min, eff.max,
        castPower != null ? castPower : Engine.effPower(caster),   // v2.2/v2.3
        Engine.effResist(cur, element), Engine.markMultiplier(cur) * mult);
      emit({ type: 'chainHop', uid: cur.uid, index: j });
      dealDamage(state, cur, amt, element, caster.uid, false, cobre(state, de.x, de.y, cur));   // 19/09: a cobertura baixa
      if (state.phase !== 'playing') break;
      mult *= falloff;
      de = { x: cur.x, y: cur.y };                        // o próximo salto sai desta vítima
      // próximo salto: inimigo vivo mais próximo ainda não atingido — e que a
      // vítima de agora VÊ (19/09: o raio não salta por cima de muro; a revisão
      // pegou o salto ferindo quem estava atrás de um '#' cheio. A IA valora o
      // raio com a mesma régua, ai.js chainValue).
      var next = null, bestD = 999;
      for (var i = 0; i < state.units.length; i++) {
        var u = state.units[i];
        if (!u.alive || u.offBoard || hit[u.uid]) continue;
        if (u.side === caster.side) continue;
        if (ocultoDe(caster, u)) continue;               // 22/09: o raio não acha quem não se vê
        var d = manhattan(cur.x, cur.y, u.x, u.y);
        if (d <= Engine.CHAIN_JUMP_RANGE && d < bestD && Engine.los(state, cur.x, cur.y, u.x, u.y)) { bestD = d; next = u; }
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
        if (amt > 0) log(u.name + ' sofre ' + amt + ' de veneno.', u.uid);
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
      /* 22/09 (o dono: "a invisibilidade só fica no turno que ele usa… tem que
       * ficar 2 turnos completos"). A invisibilidade posta durante o PRÓPRIO
       * turno da unidade pula o fim DESTE turno: sem isso a Sombra Curta (1)
       * sumia antes de qualquer inimigo agir, e "por 2" valia uma rodada só.
       * Compara com o número do turno, não com uma marca solta: se o pet do
       * dono o esconder DEPOIS deste tique (a vez do pet vem depois), o próximo
       * tique é de outro turno e conta normal. A marca some aqui de qualquer
       * jeito; enquanto vive, vai na foto (JSON) e no hash (Engine.hash). */
      if (eff.lancadoNoTurno != null) {
        var pula = eff.lancadoNoTurno === (state.turno || 0);
        delete eff.lancadoNoTurno;
        if (pula) continue;
      }
      eff.duration--;
      if (eff.duration <= 0) {
        u.effects.splice(i, 1);
        log(u.name + ' ' + (EFEITO_PT[eff.type] || ('perde o efeito ' + eff.type)) + '.', u.uid);
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
    // 11/09 — O NÚMERO DO TURNO (o T dos lances da Rede). Conta só o turno que
    // começa DE FATO, depois do salto de quem está morto ou fora do tabuleiro;
    // `round + activeIdx` não serve: uma invocação empurra o activeIdx.
    state.turno = (state.turno || 0) + 1;

    u.pa = Math.max(0, u.paMax + sumBuffs(u, 'pa'));
    u.pp = Math.max(0, u.ppMax + sumBuffs(u, 'pp'));
    if (Engine.unitHasEffect(u, 'root')) u.pp = 0;      // v2
    u.castsThisTurn = {};
    emit({ type: 'turnStart', uid: u.uid });

    runStartTicks(state, u);

    if (!u.alive) advanceTurn(state, guard + 1);
  }

  /* 11/09 — O TETO DE RODADAS NO DUELO. Na sala o teto é derrota (a sala cobra
   * a demora); no PvP isso decidiria pela cor do time. Vence a MAIOR fração de
   * vida somada (PV dos vivos / PV máximo dos heróis e fusões do lado, mortos
   * contando 0); fração igual é EMPATE (fase 'empate', só no PvP). A conta é
   * em produto cruzado de inteiros: ponto flutuante não decide resultado. */
  function vidaDoLado(state, side) {
    var hp = 0, max = 0;
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.side !== side || (u.kind !== 'hero' && u.kind !== 'fusion') || u.fusedInto) continue;
      max += Math.max(0, u.hpMax || 0);
      if (u.alive && !u.offBoard) hp += Math.max(0, u.hp || 0);
    }
    return { hp: hp, max: max };
  }
  function tetoDoDuelo(state, fcfg) {
    var a = vidaDoLado(state, 'player'), b = vidaDoLado(state, 'enemy');
    var ea = a.hp * Math.max(1, b.max), eb = b.hp * Math.max(1, a.max);
    var winner = ea > eb ? 'player' : (eb > ea ? 'enemy' : null);
    state.phase = winner === 'player' ? 'won' : (winner === 'enemy' ? 'lost' : 'empate');
    emit({ type: 'furyTimeout', round: state.round, maxRounds: fcfg.maxRounds });
    emit({ type: 'battleEnd', winner: winner, reason: 'fury' });
    log(winner ? 'O tempo da arena acabou: vence quem tem mais vida.' : 'O tempo da arena acabou: empate.');
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
      if (state.pvp) { tetoDoDuelo(state, fcfg); return; }
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
               x: state.traps[i].x, y: state.traps[i].y, side: state.traps[i].side });
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
        // desafio RELÂMPAGO: começou a rodada 6, o contrato já era — avisar
        // AGORA, não no fim, para o jogador parar de jogar em função dele
        if (state.desafio && state.desafio.vivo && state.desafio.id === 'relampago' &&
            state.round > 5) {
          desafioFalha(state, 'a rodada 5 passou');
        }
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
