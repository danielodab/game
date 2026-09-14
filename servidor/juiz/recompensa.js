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

/* A poção saiu da batalha (13/09, o dono: "a poção não é para usar na batalha.. e sim
 * para curar a vida após uma batalha na sala de espera entre as salas"): o fechamento
 * não desconta mais poção nenhuma — o gole é a op interna beberPocao (economia.js),
 * pedida pela API na sala de espera. Daqui sai, com o PV do fim (carry), o PV MÁXIMO de
 * cada herói (vidaMax, a mesma chave do carry): a API guarda os dois para a sala de
 * espera saber quando a vida enche e recusar a poção de quem já está cheio. */
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
  /* 14/09, A VIDA ÚNICA DO HERÓI (o dono: "isso vale para quando terminar calabouço, depois de um
   * pvp e assim por diante"): o PV do fim e o máximo saem em QUALQUER fim refeito — vitória,
   * derrota ou sala largada — e a API grava em vida_heroi. Quem cai não foge da vida zerada
   * largando a sala */
  let recompensa = null;
  const G = J.Game;
  const carry = G._carrySolo(r.estado);
  const vidaMax = G._vidaMax(r.estado, false);
  if (r.fase === 'won') {
    G.state = r.estado;
    G.party = b.herois.slice();
    G.dungeonId = b.dungeonId;
    G.roomIndex = b.roomIndex;
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
    carry,
    vidaMax
  };
}

/* A VEZ DO SAQUE NA SALA EM GRUPO — a regra de js/core/coop.js (Coop.vezDoSaque):
 * a semente da ata sorteia um DONO (não uma cadeira) entre os donos distintos da
 * lista, na ordem em que aparecem. A prova juiz_grupo.js confere contra o coop.js. */
function donosDe(party) {
  const fora = [];
  (party || []).forEach((p) => { if (p && p.dono && fora.indexOf(p.dono) < 0) fora.push(p.dono); });
  return fora;
}
function vezDoSaque(semente, party, dono) {
  const donos = donosDe(party);
  if (donos.length < 2) return null;
  const s = semente >>> 0;
  return donos[((s ^ (s >>> 11) ^ (s >>> 23)) >>> 0) % donos.length] === dono;
}

/* POST /grupo/fecha — a sala em GRUPO (docs/SEGURANCA.md §Fase 3).
 * corpo = { membros: [{ conta: {id, gm}, dono, herois, progress, db, guilda }],   (quem lidera primeiro)
 *           ata: { dungeonId, roomIndex, dificuldade, semente, carry },
 *           lances, hashFinal, contexto: { agoraMs, fatores } }
 * O grupo sai do estado de CADA conta no servidor, com o dono de cada herói; a
 * sala é refeita UMA vez com o registro de quem mandava na batalha (lances dos
 * dois e as marcas de queda/volta/saída); com vitória, cada membro é pago no
 * mundo dele pelo computeRewards do jogo, com o `rede` de grupo (a vez do saque
 * e a divisão de vinténs da dupla). */
function fechaGrupo(corpo) {
  const c = corpo || {};
  const ata = c.ata || {};
  const membros = Array.isArray(c.membros) ? c.membros : [];
  if (membros.length < 2 || membros.length > 4) throw recusa('o grupo precisa de 2 a 4 membros', 'entrada');
  if (typeof ata.dungeonId !== 'string' || !inteiro(ata.roomIndex) || !inteiro(ata.semente)) {
    throw recusa('ata inválida', 'entrada');
  }
  const ctxo = c.contexto || {};
  // os mundos de cada membro, com o estado dele; o grupo em ordem, com os donos
  const mundos = membros.map((m, i) => {
    if (!m || typeof m.dono !== 'string' || !m.dono || !Array.isArray(m.herois) || !m.herois.length || m.herois.length > 2) {
      throw recusa('membro ' + i + ' inválido', 'entrada');
    }
    const w = mundoEconomico({
      gm: !!(m.conta && m.conta.gm), contaId: m.conta && m.conta.id, agoraMs: ctxo.agoraMs,
      semente: sementeDe(ata.semente + ':grupo:' + ata.dungeonId + ':' + ata.roomIndex + ':' + m.dono),
      fatores: ctxo.fatores, guilda: m.guilda
    });
    poeEstado(w, m.progress, m.db);
    for (const hid of m.herois) {
      if (!w.J.Progress.hero(hid)) throw recusa('o herói ' + hid + ' não é da conta do membro ' + i, 'herois');
    }
    const party = w.J.Progress.battleParty(m.herois).map((p) => Object.assign(p, { dono: m.dono }));
    return { m, w, party, antes: tiraEstado(w) };
  });
  const donosVistos = new Set();
  mundos.forEach((x) => {
    if (donosVistos.has(x.m.dono)) throw recusa('dois membros com o mesmo dono', 'entrada');
    donosVistos.add(x.m.dono);
  });
  const party = [].concat(...mundos.map((x) => x.party));
  if (party.length > 4) throw recusa('a sala em grupo tem no máximo 4 heróis', 'entrada');

  // a sala refeita, no mundo de quem lidera (a economia dele não muda por refazer)
  const lider = mundos[0];
  const r = refazEm(lider.w.J, {
    modo: 'grupo', colocador: lider.m.dono,
    dungeonId: ata.dungeonId, roomIndex: ata.roomIndex, dificuldade: ata.dificuldade || 'normal',
    semente: ata.semente, party: JSON.parse(JSON.stringify(party)), carry: ata.carry || null,
    carryRede: true, escolhePosicao: true, lances: c.lances, hashFinal: c.hashFinal
  });
  const final = JSON.stringify(r.estado);
  // 14/09, a vida única: o PV do fim (dono:heroId) e o máximo em qualquer fim refeito, não só na vitória
  const carry = lider.w.J.Game._carryRede(r.estado);
  const vidaMax = lider.w.J.Game._vidaMax(r.estado, true);
  const pagos = mundos.map((x) => {
    let recompensa = null;
    if (r.fase === 'won') {
      const J = x.w.J, G = J.Game;
      J.Coop = {
        partySize: () => party.length,
        vezDoSaque: () => vezDoSaque(ata.semente, party, x.m.dono)
      };
      G._defineRede({ tipo: 'grupo', eu: x.m.dono, lado: null, colocador: false });
      G.state = JSON.parse(final);
      G.party = x.m.herois.slice();
      G.dungeonId = ata.dungeonId;
      G.roomIndex = ata.roomIndex;
      const rw = G._computeRewards();
      recompensa = JSON.parse(JSON.stringify(rw));
      if (rw && rw.drops && rw.drops.perdidos) recompensa.dropsPerdidos = rw.drops.perdidos.slice();
      G._defineRede(null);
    }
    const fila = (x.w.J.Progress.state && x.w.J.Progress.state.nascimentos) ? x.w.J.Progress.state.nascimentos.slice() : [];
    const depois = tiraEstado(x.w);
    return {
      contaId: x.m.conta && x.m.conta.id, dono: x.m.dono, recompensa,
      progress: depois.progress, db: depois.db, hash: depois.hash, hashAntes: x.antes.hash,
      guildaXp: x.w.anotado.guildaXp,
      iids: diferencaIids(iidsDe(x.antes.progress, x.antes.db), iidsDe(depois.progress, depois.db), fila)
    };
  });
  const refeito = Object.assign({}, r);
  delete refeito.estado;
  return { ok: true, fase: r.fase, turnosJogador: r.turnosJogador, refeito, membros: pagos, carry, vidaMax };
}

function rotas(registra) {
  registra('POST', '/sala/fecha', (corpo) => fecha(corpo));
  registra('POST', '/grupo/fecha', (corpo) => fechaGrupo(corpo));
}

module.exports = { fecha, fechaGrupo, rotas, vezDoSaque };
