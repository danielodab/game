#!/usr/bin/env node
'use strict';
/* OS JOGADORES DE MENTIRA DO GRUPO E DO DUELO — ferramenta das provas (não é prova sozinho).
 *
 *   node tests/juiz_grupo_jogador.js < pedido.json > jogo.json
 *
 * As simulações de tests/juiz_grupo.js (jogaGrupo e jogaDuelo) numa linha de comando,
 * para a prova da API (tests/grupo_duelo_api.py) fechar salas em grupo e duelos de
 * verdade: a IA do jogo decide os lances das pessoas, cada lance anotado com o dono.
 *
 * Entrada (JSON):
 *   { modo: 'grupo', membros: [{progress, db, dono, herois}] (líder primeiro),
 *     dungeonId, roomIndex, semente, dificuldade?, carry? }
 *   { modo: 'procura-grupo', membros, candidatos: [[dungeonId, roomIndex, semente], …] }
 *        → a primeira candidata que o grupo vence, com o jogo dela
 *   { modo: 'duelo', A: {progress, db, dono, herois}, B: {…}, dungeonId, roomIndex, semente, vidaA?, vidaB?, cortaEm? }
 *        (15/09: `cortaEm` = pára o duelo no começo da primeira vez de gente depois de tantos lances — o ponto
 *        em que o juiz também pára, então o hash devolvido é o do fim que ele confere: a desistência e o W.O.)
 * Saída (JSON): { lances, fase, hash } (e dungeonId, roomIndex, semente na procura; no duelo também
 *               vidaFimA / vidaFimB = {heroId: PV do fim} de cada lado). */
const path = require('path');
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
const { ehDeGente } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));

function partyDe(m) {
  const w = est.mundoEconomico({ semente: 5 });
  est.poeEstado(w, m.progress, m.db);
  return w.J.Progress.battleParty(m.herois).map((p) => Object.assign(p, { dono: m.dono }));
}

function jogaGrupo(p) {
  const lider = p.membros[0];
  const w = est.mundoEconomico({ semente: 5 });
  est.poeEstado(w, lider.progress, lider.db);
  const J = w.J, E = J.Engine;
  const party = [].concat(...p.membros.map(partyDe));
  // 07/10: o Poço em grupo — o andar nasce da semente da ata (como o Game e o juiz fazem)
  if (p.dungeonId === 'poco') J.Poco.poeSala(p.roomIndex + 1, J.Poco.salaSemeada(p.roomIndex + 1, p.semente));
  const st = E.createBattle(p.dungeonId, p.roomIndex, JSON.parse(JSON.stringify(party)),
    { seed: p.semente, dificuldade: p.dificuldade || 'normal', escolhePosicao: true });
  if (p.dungeonId === 'poco') J.Poco.escalaEstado(st, p.roomIndex + 1);
  E.events.length = 0;
  const log = [];
  const op = E.placementOptions(st)[0];
  log.push({ a: 'p', x: op.x, y: op.y, ok: !!E.place(st, op.x, op.y), de: lider.dono });
  E.events.length = 0;
  let voltas = 0;
  while (st.phase === 'playing' && voltas++ < 3000) {
    const u = E.activeUnit(st);
    if (!u) break;
    if (ehDeGente(u)) {
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
  return { lances: log, fase: st.phase, hash: E.hash(st) };
}

function jogaDuelo(p) {
  const w = est.mundoEconomico({ semente: 5 });
  est.poeEstado(w, p.A.progress, p.A.db);
  const J = w.J, E = J.Engine;
  // 14/09: a vida única — cada lado com a vida que o servidor guardou no duelo/abrir (vidaA / vidaB)
  const st = E.createDuelSala(p.dungeonId, p.roomIndex, partyDe(p.A), partyDe(p.B),
    { seed: p.semente, vidaA: p.vidaA || null, vidaB: p.vidaB || null });
  E.events.length = 0;
  const log = [];
  let voltas = 0;
  while (st.phase === 'playing' && voltas++ < 3000) {
    const u = E.activeUnit(st);
    if (!u) break;
    if (typeof p.cortaEm === 'number' && log.length >= p.cortaEm && ehDeGente(u)) break;   // 15/09: o duelo cortado
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
  // 14/09: a vida com que cada lado sai (a mesma conta do juiz: Engine.vidaDoLado), para a prova da API conferir
  return { lances: log, fase: st.phase, hash: E.hash(st),
           vidaFimA: E.vidaDoLado(st, 'player'), vidaFimB: E.vidaDoLado(st, 'enemy') };
}

function executa(p) {
  if (p.modo === 'duelo') return jogaDuelo(p);
  if (p.modo === 'procura-grupo') {
    for (const [dungeonId, roomIndex, semente] of p.candidatos || []) {
      const j = jogaGrupo(Object.assign({}, p, { dungeonId, roomIndex, semente }));
      if (j.fase === 'won') return Object.assign(j, { dungeonId, roomIndex, semente });
    }
    return { fase: 'nenhuma' };
  }
  return jogaGrupo(p);
}

if (require.main === module) {
  const pedacos = [];
  process.stdin.on('data', (c) => pedacos.push(c));
  process.stdin.on('end', () => {
    process.stdout.write(JSON.stringify(executa(JSON.parse(Buffer.concat(pedacos).toString('utf8')))));
  });
}

module.exports = { jogaGrupo, jogaDuelo };
