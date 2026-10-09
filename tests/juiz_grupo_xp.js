#!/usr/bin/env node
'use strict';
/* PROVA DO JUIZ — a XP da sala em GRUPO com o bônus de XP do Mestre (08/10 à noite).
 *
 *   node tests/juiz_grupo_xp.js
 *
 * O dono: "acho que os XPs dos calabouços estão bugados.. fui na Cisterna dos Afogados primeira sala em modo
 * normal com duas contas, 4 personagens level 1 e ativei x3 o bônus de xp ou seja x30 e todas as XPs foram
 * zeradas". Esta prova refaz EXATAMENTE essa sala no juiz (servidor/juiz/recompensa.js, fechaGrupo): duas
 * contas com dois heróis nível 1 cada, a Cisterna sala 0 em 'normal', a IA jogando pelos quatro até vencer, e o
 * fechar com os fatores do evento ×1, ×3, ×10 e ×30. O que ela cobra:
 *   - sem evento, cada um dos QUATRO heróis ganha XP (nunca zero), e as duas contas são pagas;
 *   - com o evento ×3 a XP sobe; com ×10 sobe mais; ×30 vale o TETO (AGENDA_TETOS xp = 10: o ×30 do dono vira ×10,
 *     não zero) e o fator anunciado na recompensa é o que valeu;
 *   - o descanso (×2 do dia) entra, e o nível sobe quando a XP dá.
 * Logo o zero do dono NÃO vem da conta do juiz: vem de o servidor não confirmar a sala (a resposta 'aguardando' do
 * registro fotografado, a recusa, a sala vencida) — e é isso que a tela de recompensa passa a dizer (hud.js,
 * porqueSemRecompensa) e o servidor passa a registrar no log (grupo.py, _grupo_marca).
 * Também imprime a régua do 'rapido-demais' para ESTA sala (as vezes encerradas pelos quatro × 0,35 s, mínimo 4 s):
 * a conta que o servidor faz contra o tempo desde a abertura da sala. */
const path = require('path');
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
const { fechaGrupo } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'recompensa.js'));
const { ehDeGente } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
const AGORA = Date.UTC(2026, 9, 8, 20, 0, 0);
const SALA_MIN_S = 4.0, SALA_S_POR_TURNO = 0.35;      // servidor/salas.py (a régua do tempo mínimo)

function conta(herois, nivel) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 5 });
  est.poeEstado(w, null, null);
  const J = w.J;
  herois.forEach((h) => { const x = J.Progress.state.heroes[h]; x.level = nivel; x.xp = J.DATA.leveling.xpTable[nivel - 1]; });
  J.Progress.save();
  return Object.assign(est.tiraEstado(w), { herois });
}
function partyDe(c, dono) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 5 });
  est.poeEstado(w, c.progress, c.db);
  return w.J.Progress.battleParty(c.herois).map((p) => Object.assign(p, { dono }));
}
/* joga a sala num motor só, a IA pelos quatro, anotando como o Coop anota (o dono em cada lance) */
function joga(ana, bia, dg, ri, semente) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 5 });
  est.poeEstado(w, ana.progress, ana.db);
  const J = w.J, E = J.Engine;
  const party = partyDe(ana, 'ana').concat(partyDe(bia, 'bia'));
  const st = E.createBattle(dg, ri, JSON.parse(JSON.stringify(party)), { seed: semente, escolhePosicao: true });
  E.events.length = 0;
  const log = [];
  const op = E.placementOptions(st)[0];
  log.push({ a: 'p', x: op.x, y: op.y, ok: !!E.place(st, op.x, op.y), de: 'ana' });
  E.events.length = 0;
  let voltas = 0;
  while (st.phase === 'playing' && voltas++ < 3000) {
    const u = E.activeUnit(st);
    if (!u) break;
    const plano = J.AI.planTurn(st, u.uid) || [];
    const gente = ehDeGente(u);
    let acabou = false;
    for (const a of (plano.length ? plano : [{ action: 'end' }])) {
      if (st.phase !== 'playing') break;
      if (a.action === 'move') { const ok = !!E.move(st, u.uid, a.x, a.y); if (gente) log.push({ a: 'm', u: u.uid, x: a.x, y: a.y, ok, de: u.dono }); }
      else if (a.action === 'cast') { const ok = !!E.cast(st, u.uid, a.spellId, a.x, a.y); if (gente) log.push({ a: 'c', u: u.uid, s: a.spellId, x: a.x, y: a.y, ok, de: u.dono }); }
      else if (a.action === 'end') { E.endTurn(st); if (gente) log.push({ a: 'e', ok: true, de: u.dono }); acabou = true; break; }
      E.events.length = 0;
    }
    if (!acabou && st.phase === 'playing') { E.endTurn(st); if (gente) log.push({ a: 'e', ok: true, de: u.dono }); }
    E.events.length = 0;
  }
  return { log, fase: st.phase, hash: E.hash(st) };
}

const ana = conta(['sumo', 'curandeiro'], 1), bia = conta(['sumo', 'curandeiro'], 1);
let jogo = null, sem = null;
for (const s of [3, 17, 41, 77, 123, 200, 301, 404, 555, 666]) {
  const j = joga(ana, bia, 'cistern', 0, s);
  if (j.fase === 'won') { jogo = j; sem = s; break; }
}
check('a Cisterna sala 0 (normal) é vencida por quatro heróis nível 1 pela IA', !!jogo, 'nenhuma semente venceu');
if (!jogo) { console.log('\nRESUMO: FALHOU 1 de 1'); process.exit(1); }

function fecha(fatores) {
  return fechaGrupo({
    membros: [{ conta: { id: 1 }, dono: 'ana', herois: ana.herois, progress: ana.progress, db: ana.db },
              { conta: { id: 2 }, dono: 'bia', herois: bia.herois, progress: bia.progress, db: bia.db }],
    ata: { dungeonId: 'cistern', roomIndex: 0, dificuldade: 'normal', semente: sem, carry: null },
    lances: jogo.log, hashFinal: jogo.hash, contexto: { agoraMs: AGORA, fatores }
  });
}
function xpDe(r) {
  // {ana: {sumo, curandeiro}, bia: {...}} — a XP REAL de cada herói (xpPorHeroi), como a tela mostra
  const o = {};
  for (const m of r.membros) o[m.dono] = m.recompensa ? m.recompensa.xpPorHeroi : null;
  return o;
}
function todosPositivos(x) {
  return ['ana', 'bia'].every((d) => x[d] && ['sumo', 'curandeiro'].every((h) => typeof x[d][h] === 'number' && x[d][h] > 0));
}
function fatorAnunciado(r) {
  const ev = (r.membros[0].recompensa.eventos || []).filter((e) => e && e.tipo === 'xp');
  return ev.length ? ev[0].fator : 1;
}

const r1 = fecha({});
check('sem evento: a sala fecha vencida e as DUAS contas são pagas', r1.ok && r1.fase === 'won' && r1.membros.length === 2 &&
      r1.membros.every((m) => m.recompensa && m.progress), JSON.stringify({ ok: r1.ok, fase: r1.fase }));
const x1 = xpDe(r1);
check('sem evento: cada um dos quatro heróis nível 1 ganha XP (nunca zero)', todosPositivos(x1), JSON.stringify(x1));
check('o descanso do dia (×2) entra na conta', r1.membros.every((m) => m.recompensa.descanso && m.recompensa.descanso.fator === 2),
      JSON.stringify(r1.membros.map((m) => m.recompensa.descanso)));

const r3 = fecha({ geral: { xp: 3 } });
const x3 = xpDe(r3);
check('o bônus ×3 do Mestre sobe a XP de todos (e é o fator anunciado na recompensa)',
      r3.ok && todosPositivos(x3) && ['ana', 'bia'].every((d) => ['sumo', 'curandeiro'].every((h) => x3[d][h] > x1[d][h])) && fatorAnunciado(r3) === 3,
      JSON.stringify({ x1, x3, fator: fatorAnunciado(r3) }));
check('com ×3 os heróis nível 1 sobem de nível', r3.membros.every((m) => (m.recompensa.levelUps || []).length === 2),
      JSON.stringify(r3.membros.map((m) => m.recompensa.levelUps)));

const r10 = fecha({ geral: { xp: 10 } });
const x10 = xpDe(r10);
check('o bônus ×10 sobe ainda mais', r10.ok && todosPositivos(x10) && ['ana', 'bia'].every((d) => ['sumo', 'curandeiro'].every((h) => x10[d][h] > x3[d][h])) &&
      fatorAnunciado(r10) === 10, JSON.stringify({ x3, x10 }));

const r30 = fecha({ geral: { xp: 30 } });
const x30 = xpDe(r30);
// 09/10 (o dono: "o Mestre pode pôr evento de até ×20 de XP"): o teto do XP é 20; o "×30" vale ×20, nunca zero
const r20 = fecha({ geral: { xp: 20 } });
const x20 = xpDe(r20);
check('o "×30" do dono vale o TETO (×20): a mesma XP de ×20, mais que a de ×10, nunca zero', r30.ok && todosPositivos(x30) &&
      JSON.stringify(x30) === JSON.stringify(x20) && ['ana', 'bia'].every((d) => ['sumo', 'curandeiro'].every((h) => x20[d][h] > x10[d][h])) &&
      fatorAnunciado(r30) === 20, JSON.stringify({ x10, x20, x30, fator: fatorAnunciado(r30) }));

// a régua do tempo mínimo desta sala (servidor/grupo.py: max(SALA_MIN_S, SALA_S_POR_TURNO × turnosJogador))
const turnos = r1.turnosJogador;
const minimo = Math.max(SALA_MIN_S, SALA_S_POR_TURNO * turnos);
check('o juiz conta as vezes encerradas pelos quatro heróis (as duas contas), e o mínimo da sala é de segundos, não de minutos',
      turnos === jogo.log.filter((l) => l.a === 'e').length && turnos > 0 && minimo < 60,
      JSON.stringify({ turnos, minimo }));
console.log('  (esta sala: ' + turnos + ' vezes encerradas → o servidor exige pelo menos ' + minimo.toFixed(1) + ' s desde a abertura; ' +
            'XP por herói: ×1 ' + x1.ana.sumo + ', ×3 ' + x3.ana.sumo + ', ×10 ' + x10.ana.sumo + ', ×30 ' + x30.ana.sumo + ')');

console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
