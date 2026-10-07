// Os elites de sala — um monstro comum com um traço a mais (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É (07/10)
 * ====================
 * O dono: "tô achando meio repetitivo". Mapa fixo, elenco fixo: a jogada ótima de
 * cada sala é a mesma toda vez. Um ELITE é UM monstro comum da sala que nasce com
 * um traço a mais (e mais vida), sorteado pelo rng semeado da própria sala — o
 * Colosso do Poço é o molde: couraça, explosão, fúria, pressa, regeneração. A
 * sala é a mesma; quem é o perigo nela, não.
 *
 * ONDE ENTRA: em 40% das salas dos calabouços (os seis portais e o Poço), nunca
 * na primeira sala da Estufa (o tutorial), nunca na arena do PvP, no Eco nem no
 * Santuário (que têm regra própria). Nunca o chefe, o colosso nem um filhote.
 *
 * O QUE PAGA: o elite derrubado vale ×1,5 de XP (e os vinténs, que derivam da
 * XP) e deixa pedra do elemento dele SEMPRE, uma a mais (game.js, computeRewards
 * e collectStones).
 *
 * QUEM APLICA: o motor (engine.js, Engine.createBattle, por `Ex()`), no mesmo
 * instante nos dois lados — o juiz carrega este arquivo (motor.js) e chega ao
 * mesmo elite com a mesma semente. O sorteio GASTA o rng da sala (uma tirada
 * para a chance, duas para quem e qual), por isso a decisão 23 do engine.js
 * mora na mesma VERSAO_REGRAS 8 dos afixos. */
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

  var Elx = {};
  JOGO.Elites = Elx;

  Elx.CHANCE = 0.40;          // das salas elegíveis
  Elx.VIDA = 1.5;             // o PV máximo do elite
  Elx.XP = 1.5;               // o que ele paga a mais (game.js)
  Elx.PEDRAS_A_MAIS = 1;      // e a pedra garantida, uma a mais (game.js)
  Elx.EXPLOSAO_PCT = 0.25;    // o Explosivo: a explosão vale esta fração do PV máximo dele

  /* OS TRAÇOS. Cada um é um `trait` que o motor já conhece (couraca, explodeOnDeath,
   * enrage) ou um número (veloz); `regen` é novo e mora no runStartTicks do motor. */
  Elx.TRACOS = [
    { id: 'couracado', nome: Tx('Couraçado'), icone: '🛡',
      texto: Tx('Couraça de 3 placas: cada golpe entra pela metade até ela cair (golpe de ar arranca duas).') },
    { id: 'explosivo', nome: Tx('Explosivo'), icone: '💥',
      texto: Tx('Ao cair, explode nas casas em volta com o próprio elemento.') },
    { id: 'enfurecido', nome: Tx('Enfurecido'), icone: '🔥',
      texto: Tx('Com metade da vida, se enfurece: +30 de poder até o fim.') },
    { id: 'veloz', nome: Tx('Veloz'), icone: '💨',
      texto: Tx('Uma casa e um ponto de ação a mais por vez.') },
    { id: 'regenerador', nome: Tx('Regenerador'), icone: '✚',
      texto: Tx('Recupera 6% da vida no começo de cada vez dele.') }
  ];
  Elx.porId = function (id) {
    for (var i = 0; i < Elx.TRACOS.length; i++) if (Elx.TRACOS[i].id === id) return Elx.TRACOS[i];
    return null;
  };

  /* A sala pode ter elite? Os calabouços (DATA.dungeons, o Poço inclusive); fora: a primeira sala da
   * Estufa, o PvP, o Eco, o Santuário e qualquer mapa de arena. */
  Elx.cabe = function (state, room) {
    if (!state || state.pvp || state.eco || !room || room.santuario) return false;
    var D = JOGO.DATA || {};
    if (D.arena && D.arena(state.dungeonId)) return false;
    if (D.especial && D.especial(state.dungeonId)) return false;
    if (state.dungeonId === 'greenhouse' && state.roomIndex === 0) return false;
    var ds = D.dungeons || [];
    for (var i = 0; i < ds.length; i++) if (ds[i] && ds[i].id === state.dungeonId) return true;
    return false;
  };

  function candidatos(state) {
    var ms = (JOGO.DATA && JOGO.DATA.monsters) || {}, out = [];
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.kind !== 'monster' || u.side !== 'enemy' || !u.alive || u.boss) continue;
      var def = ms[u.defId];
      if (def && (def.colosso || def.summonOnly)) continue;
      if (u.porte > 1) continue;
      out.push(u);
    }
    return out;
  }

  /* SORTEAR, na sala recém-nascida (o motor chama, com o rng da sala em `rand()`
   * e o INTERNO em `I`). Devolve o elite ou null. Sempre gasta a tirada da
   * chance quando a sala cabe — a sala sem elite também é "decidida" pela semente. */
  Elx.sorteia = function (state, room, I, rand) {
    if (!Elx.cabe(state, room)) return null;
    if (rand() >= Elx.CHANCE) return null;
    var cand = candidatos(state);
    if (!cand.length) return null;
    var u = cand[Math.floor(rand() * cand.length)];
    var t = Elx.TRACOS[Math.floor(rand() * Elx.TRACOS.length)];
    Elx.veste(state, u, t.id, I);
    return u;
  };

  /* VESTIR o traço num monstro (separado do sorteio para as provas): a vida, o
   * traço e a marca `elite` que a tela, a recompensa e o hash leem. */
  Elx.veste = function (state, u, id, I) {
    var t = Elx.porId(id);
    if (!t || !u) return false;
    u.hpMax = Math.round(u.hpMax * Elx.VIDA);
    u.hp = u.hpMax;
    u.traits = (u.traits || []).slice();
    if (id === 'couracado') {
      u.traits.push({ type: 'couraca', pontos: 3, reducao: 0.5 });
      u.couraca = 3;
    } else if (id === 'explosivo') {
      u.traits.push({ type: 'explodeOnDeath', element: u.element || 'neutro',
                      damage: Math.max(10, Math.round(u.hpMax * Elx.EXPLOSAO_PCT)), radius: 1 });
    } else if (id === 'enfurecido') {
      u.traits.push({ type: 'enrage', hpPct: 0.5, power: 30 });
    } else if (id === 'veloz') {
      u.ppMax += 1; u.pp = u.ppMax;
      u.paMax += 1; u.pa = u.paMax;
    } else if (id === 'regenerador') {
      u.traits.push({ type: 'regen', pct: 0.06 });
    }
    u.elite = { id: t.id, nome: t.nome, texto: t.texto, icone: t.icone };
    if (I && I.log) I.log(Tx('Elite na sala: {name} é {traco} — {texto}', { name: u.name, traco: t.nome, texto: t.texto }), u.uid);
    return true;
  };
})();
