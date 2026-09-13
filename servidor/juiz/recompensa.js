'use strict';
/* A SALA FECHADA NO SERVIDOR — refaz e paga (dono: servidor).
 *
 * POST /sala/fecha (docs/SEGURANCA.md §5.2). Num mundo econômico com o estado
 * da conta:
 *   1. o grupo sai do Progress DAQUI (Progress.battleParty) — atributos,
 *      peças, pet e estrelas do estado do servidor, nunca do que o cliente diz;
 *   2. a sala é refeita da semente do bilhete e dos lances (sala.js);
 *   3. com vitória, o Game DAQUI recebe a batalha refeita e roda o próprio
 *      computeRewards do jogo, com o Math.random semeado pelo servidor.
 * O resultado é o estado novo da conta, o recibo (o mesmo objeto que a tela de
 * recompensa do jogo usa), os iids que nasceram e o PV que atravessa. */
const { mundoEconomico, poeEstado, tiraEstado, iidsDe, diferencaIids, sementeDe } = require('./estado');
const { refazEm, recusa } = require('./sala');

function inteiro(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

function fecha(corpo) {
  const c = corpo || {};
  const b = c.bilhete || {};
  if (typeof b.dungeonId !== 'string' || !inteiro(b.roomIndex) || !inteiro(b.semente)) {
    throw recusa('bilhete inválido', 'entrada');
  }
  if (!Array.isArray(b.herois) || !b.herois.length || b.herois.length > 2 ||
      b.herois.some((h) => typeof h !== 'string')) {
    throw recusa('heróis do bilhete inválidos', 'entrada');
  }
  const conta = c.conta || {};
  const ctxo = c.contexto || {};
  const w = mundoEconomico({
    gm: !!conta.gm,
    agoraMs: ctxo.agoraMs,
    semente: sementeDe(b.semente + ':recompensa:' + b.dungeonId + ':' + b.roomIndex),
    fatores: ctxo.fatores,
    guilda: ctxo.guilda
  });
  poeEstado(w, c.progress, c.db);
  const J = w.J;
  const antes = tiraEstado(w);
  const iidsAntes = iidsDe(antes.progress, antes.db);

  // 1. o grupo do estado do servidor
  for (const hid of b.herois) {
    if (!J.Progress.hero(hid)) throw recusa('o herói ' + hid + ' não é desta conta', 'herois');
  }
  const party = J.Progress.battleParty(b.herois);
  if (!party || !party.length) throw recusa('grupo vazio', 'herois');

  // 2. a sala refeita
  const r = refazEm(J, {
    dungeonId: b.dungeonId, roomIndex: b.roomIndex, dificuldade: b.dificuldade || 'normal',
    semente: b.semente, party, carry: b.carry || null,
    escolhePosicao: b.escolhePosicao !== false,
    lances: c.lances, hashFinal: c.hashFinal
  });

  // 3. a recompensa pelo funil do jogo
  let recompensa = null, carry = null;
  if (r.fase === 'won') {
    const G = J.Game;
    G.state = r.estado;
    G.party = b.herois.slice();
    G.dungeonId = b.dungeonId;
    G.roomIndex = b.roomIndex;
    carry = G._carrySolo(r.estado);
    const rw = G._computeRewards();
    recompensa = JSON.parse(JSON.stringify(rw));
    if (rw && rw.drops && rw.drops.perdidos) recompensa.dropsPerdidos = rw.drops.perdidos.slice();
  }

  const fila = (J.Progress.state && J.Progress.state.nascimentos) ? J.Progress.state.nascimentos.slice() : [];
  const depois = tiraEstado(w);
  const iids = diferencaIids(iidsAntes, iidsDe(depois.progress, depois.db), fila);
  const refeito = Object.assign({}, r);
  delete refeito.estado;
  return {
    ok: true,
    fase: r.fase,
    turnosJogador: r.turnosJogador,
    refeito,
    recompensa,
    progress: depois.progress,
    db: depois.db,
    hash: depois.hash,
    hashAntes: antes.hash,
    guildaXp: w.anotado.guildaXp,
    iids,
    carry
  };
}

function rotas(registra) {
  registra('POST', '/sala/fecha', (corpo) => fecha(corpo));
}

module.exports = { fecha, rotas };
