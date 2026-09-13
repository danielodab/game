#!/usr/bin/env node
'use strict';
/* PROVA DO JUIZ — a sala em GRUPO e o duelo ranqueado refeitos no servidor.
 *
 *   node tests/juiz_grupo.js
 *
 * GRUPO: duas contas (Ana lidera com o Bárbaro, Bia com a Curandeira) jogam uma
 * sala num motor só — como o lockstep deixa os dois motores iguais —, com UMA
 * queda da Bia no meio (o turno dela passa) e a volta. O registro tem os lances
 * dos dois com o dono e as marcas. O servidor refaz e paga cada um no mundo dele:
 *   - a mesma vitória, e cada estado com o hash do Economia;
 *   - a vez do saque é de UM dono só (a semente sorteia);
 *   - lance da Bia com o herói da Ana cai.
 * DUELO: duas contas duelam pela IA; o servidor refaz a arena, a Brasa sobe para
 * quem venceu e desce para quem perdeu, nos dois estados; um fim forjado cai. */
const path = require('path');
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
const { fechaGrupo, vezDoSaque } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'recompensa.js'));
const { fechaDuelo } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'duelo.js'));
const { ehDeGente } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
const AGORA = Date.now();

function conta(heroi, nivel) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 5 });
  est.poeEstado(w, null, null);
  const J = w.J;
  const h = J.Progress.state.heroes[heroi];
  h.level = nivel; h.xp = J.DATA.leveling.xpTable[nivel - 1];
  J.Progress.save();
  return Object.assign(est.tiraEstado(w), { heroi });
}
function partyDe(c, dono) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 5 });
  est.poeEstado(w, c.progress, c.db);
  return w.J.Progress.battleParty([c.heroi]).map((p) => Object.assign(p, { dono }));
}

/* joga uma sala em grupo num motor, com a IA pelos dois, anotando como o Coop anota */
function jogaGrupo(ana, bia, dungeonId, roomIndex, semente) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 5 });
  est.poeEstado(w, ana.progress, ana.db);
  const J = w.J, E = J.Engine;
  const party = partyDe(ana, 'ana').concat(partyDe(bia, 'bia'));
  const st = E.createBattle(dungeonId, roomIndex, JSON.parse(JSON.stringify(party)), { seed: semente, escolhePosicao: true });
  E.events.length = 0;
  const log = [];
  const op = E.placementOptions(st)[0];
  log.push({ a: 'p', x: op.x, y: op.y, ok: !!E.place(st, op.x, op.y), de: 'ana' });
  E.events.length = 0;
  let voltas = 0, turnosBia = 0, caiu = false, voltou = false;
  while (st.phase === 'playing' && voltas++ < 3000) {
    const u = E.activeUnit(st);
    if (!u) break;
    if (ehDeGente(u)) {
      if (u.ia) { E.endTurn(st); E.events.length = 0; continue; }      // o turno de quem caiu passa
      const plano = J.AI.planTurn(st, u.uid) || [];
      for (const a of plano) {
        if (st.phase !== 'playing') break;
        if (a.action === 'move') log.push({ a: 'm', u: u.uid, x: a.x, y: a.y, ok: !!E.move(st, u.uid, a.x, a.y), de: u.dono });
        else if (a.action === 'cast') log.push({ a: 'c', u: u.uid, s: a.spellId, x: a.x, y: a.y, ok: !!E.cast(st, u.uid, a.spellId, a.x, a.y), de: u.dono });
        else if (a.action === 'end') break;
        E.events.length = 0;
      }
      if (st.phase === 'playing') { E.endTurn(st); log.push({ a: 'e', ok: true, de: u.dono }); }
      E.events.length = 0;
      if (u.dono === 'bia') {
        turnosBia++;
        // a Bia cai depois do 1º turno dela e volta depois de algumas rodadas
        const herisBia = st.units.filter((x) => x.dono === 'bia' && (x.kind === 'hero' || x.kind === 'fusion') && x.alive && !x.offBoard);
        if (turnosBia === 1 && !caiu) {
          herisBia.forEach((x) => { x.ia = true; log.push({ a: 'x', ev: 'ia', u: x.uid, v: true, ok: true }); });
          caiu = true;
        }
      }
      if (caiu && !voltou && u.dono === 'ana' && st.round >= 3) {
        st.units.filter((x) => x.dono === 'bia' && x.ia).forEach((x) => { x.ia = false; log.push({ a: 'x', ev: 'ia', u: x.uid, v: false, ok: true }); });
        voltou = true;
      }
      continue;
    }
    const plano = J.AI.planTurn(st, u.uid) || [];
    let acabou = false;
    for (const a of (plano.length ? plano : [{ action: 'end' }])) {
      if (st.phase !== 'playing') break;
      if (a.action === 'move') E.move(st, u.uid, a.x, a.y);
      else if (a.action === 'cast') E.cast(st, u.uid, a.spellId, a.x, a.y);
      else if (a.action === 'end') { E.endTurn(st); acabou = true; break; }
      E.events.length = 0;
    }
    if (!acabou && st.phase === 'playing') E.endTurn(st);
    E.events.length = 0;
  }
  return { log, fase: st.phase, hash: E.hash(st), party, caiu, voltou };
}

// ---------------------------------------------------------------- o grupo
const ana = conta('sumo', 22), bia = conta('curandeiro', 22);
let jogo = null, sala = null;
for (const [dg, ri] of [['cistern', 0], ['greenhouse', 0], ['cistern', 1]]) {
  for (const s of [3, 17, 41, 77, 123]) {
    const j = jogaGrupo(ana, bia, dg, ri, s);
    if (j.fase === 'won' && j.caiu) { jogo = j; sala = { dg, ri, s }; break; }
  }
  if (jogo) break;
}
check('Ana e Bia vencem uma sala em grupo, com a queda da Bia no meio', !!jogo);
if (jogo) {
  const pedido = {
    membros: [{ conta: { id: 1 }, dono: 'ana', herois: ['sumo'], progress: ana.progress, db: ana.db },
              { conta: { id: 2 }, dono: 'bia', herois: ['curandeiro'], progress: bia.progress, db: bia.db }],
    ata: { dungeonId: sala.dg, roomIndex: sala.ri, dificuldade: 'normal', semente: sala.s, carry: null },
    lances: jogo.log, hashFinal: jogo.hash, contexto: { agoraMs: AGORA, fatores: {} }
  };
  let r;
  try { r = fechaGrupo(pedido); } catch (e) { r = { erro: e.message, motivo: e.motivo }; }
  check('o servidor refaz a sala em grupo (com as marcas de queda e volta) e vê a vitória', r && r.ok && r.fase === 'won',
        JSON.stringify(r && (r.erro || r.fase)));
  if (r && r.ok) {
    const wc = est.mundoEconomico({ agoraMs: AGORA });
    check('os dois membros são pagos, cada um com o hash do seu estado',
          r.membros.length === 2 && r.membros.every((m) => m.recompensa && m.recompensa.xpGanho > 0 &&
            m.hash === wc.J.Economia.hash(m.progress, m.db)),
          JSON.stringify(r.membros.map((m) => [m.dono, m.recompensa && m.recompensa.xpGanho])));
    const vezes = r.membros.map((m) => m.recompensa.saqueDupla && m.recompensa.saqueDupla.minha);
    check('a vez do saque é de UM dono só, pela semente da ata',
          vezes.filter(Boolean).length === 1 && r.membros.every((m) => m.recompensa.saqueDupla.pela === 'ata'),
          JSON.stringify(vezes));
    check('a vez que o servidor deu é a da regra do coop.js', vezes[0] === vezDoSaque(sala.s, jogo.party, 'ana'));
    check('o PV que atravessa sai com a chave dono:herói', r.carry && Object.keys(r.carry).some((k) => k.indexOf('ana:') === 0),
          JSON.stringify(r.carry));
  }
  // lance da Bia com o herói da Ana
  const torto = jogo.log.map((l) => Object.assign({}, l));
  const i = torto.findIndex((l) => l.a === 'm' && l.de === 'ana');
  if (i >= 0) torto[i].de = 'bia';
  let r2;
  try { r2 = fechaGrupo(Object.assign({}, pedido, { lances: torto })); } catch (e) { r2 = { motivo: e.motivo }; }
  check('lance da Bia com o herói da Ana cai (vez)', i >= 0 && r2 && r2.motivo === 'vez', JSON.stringify(r2 && (r2.motivo || r2.fase)));
}

// ---------------------------------------------------------------- o duelo
function jogaDuelo(a, b, dungeonId, roomIndex, semente) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 5 });
  est.poeEstado(w, a.progress, a.db);
  const J = w.J, E = J.Engine;
  const st = E.createDuelSala(dungeonId, roomIndex, partyDe(a, 'ana'), partyDe(b, 'bia'), { seed: semente });
  E.events.length = 0;
  const log = [];
  let voltas = 0;
  while (st.phase === 'playing' && voltas++ < 3000) {
    const u = E.activeUnit(st);
    if (!u) break;
    const plano = J.AI.planTurn(st, u.uid) || [];
    const gente = ehDeGente(u);
    let acabou = false;
    for (const x of (plano.length ? plano : [{ action: 'end' }])) {
      if (st.phase !== 'playing') break;
      if (x.action === 'move') { const ok = !!E.move(st, u.uid, x.x, x.y); if (gente) log.push({ a: 'm', u: u.uid, x: x.x, y: x.y, ok, de: u.dono }); }
      else if (x.action === 'cast') { const ok = !!E.cast(st, u.uid, x.spellId, x.x, x.y); if (gente) log.push({ a: 'c', u: u.uid, s: x.spellId, x: x.x, y: x.y, ok, de: u.dono }); }
      else if (x.action === 'end') { E.endTurn(st); if (gente) log.push({ a: 'e', ok: true, de: u.dono }); acabou = true; break; }
      E.events.length = 0;
    }
    if (!acabou && st.phase === 'playing') { E.endTurn(st); if (gente) log.push({ a: 'e', ok: true, de: u.dono }); }
    E.events.length = 0;
  }
  return { log, fase: st.phase, hash: E.hash(st) };
}
const da = conta('sumo', 20), db2 = conta('curandeiro', 20);
const ds = jogaDuelo(da, db2, 'cistern', 0, 999);
check('o duelo de mentira termina (' + ds.fase + ')', ['won', 'lost', 'empate'].indexOf(ds.fase) >= 0, ds.fase);
const pedDuelo = {
  A: { conta: { id: 1 }, dono: 'ana', herois: ['sumo'], progress: da.progress, db: da.db },
  B: { conta: { id: 2 }, dono: 'bia', herois: ['curandeiro'], progress: db2.progress, db: db2.db },
  dungeonId: 'cistern', roomIndex: 0, semente: 999, lances: ds.log, hashFinal: ds.hash, contexto: { agoraMs: AGORA }
};
let rd;
try { rd = fechaDuelo(pedDuelo); } catch (e) { rd = { erro: e.message, motivo: e.motivo }; }
check('o servidor refaz o duelo e chega ao mesmo fim', rd && rd.ok && rd.fase === ds.fase, JSON.stringify(rd && (rd.erro || rd.fase)));
if (rd && rd.ok && rd.venc && rd.venc !== 'empate') {
  const ven = rd[rd.venc], per = rd[rd.venc === 'A' ? 'B' : 'A'];
  check('a Brasa sobe para quem venceu e desce para quem perdeu, nos DOIS estados',
        ven.delta > 0 && per.delta < 0 && ven.db.jogador.brasa.pts === ven.pts && per.db.jogador.brasa.partidas === 1,
        JSON.stringify({ ven: [ven.delta, ven.pts], per: [per.delta, per.pts] }));
}
let rf;
try { rf = fechaDuelo(Object.assign({}, pedDuelo, { hashFinal: (ds.hash + 7) >>> 0 })); } catch (e) { rf = { motivo: e.motivo }; }
check('o fim do duelo forjado cai (divergiu)', rf && rf.motivo === 'divergiu', JSON.stringify(rf));
let rm;
try { rm = fechaDuelo(Object.assign({}, pedDuelo, { B: Object.assign({}, pedDuelo.B, { conta: { id: 1 } }) })); } catch (e) { rm = { motivo: e.motivo }; }
check('duelo contra a própria conta não vale', rm && rm.motivo === 'mesma-conta', JSON.stringify(rm));

console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
