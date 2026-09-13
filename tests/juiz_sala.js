#!/usr/bin/env node
'use strict';
/* PROVA DO JUIZ — a sala refeita (servidor/juiz/sala.js).
 *
 *   node tests/juiz_sala.js
 *
 * Um "jogador" de mentira joga salas de verdade: a IA do jogo escolhe os lances
 * dos heróis, e cada lance é anotado no formato do cliente ({a,u,x,y,s,ok}).
 * Depois o juiz refaz a sala num mundo NOVO só com a semente, o grupo e os
 * lances, e tem de chegar ao MESMO fim (fase, hash, mortos). E um cliente
 * alterado — lance de outra unidade, resultado mentido, hash forjado, lance
 * depois do fim — cai com o porquê. */
const path = require('path');
const { mundo } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'motor.js'));
const { refaz, ehDoJogador } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (extra !== undefined && !ok ? ' — ' + extra : ''));
}

/* Joga a sala no mundo do "cliente" e devolve { lances, fase, hash, mortos }.
 * O herói joga com a IA; o log é o que o Game anotaria. Sem colocação (a
 * escolha de casa entra na prova do cliente). */
function joga(dungeonId, roomIndex, party, semente, dificuldade) {
  const w = mundo();
  const J = w.JOGO, E = J.Engine;
  const st = E.createBattle(dungeonId, roomIndex, party, { seed: semente, dificuldade, escolhePosicao: false });
  E.events.length = 0;
  const lances = [];
  let voltas = 0;
  while (st.phase === 'playing' && voltas++ < 4000) {
    const u = E.activeUnit(st);
    if (!u) break;
    const plano = J.AI.planTurn(st, u.uid) || [];
    const meu = ehDoJogador(st, u);
    let acabou = false;
    for (const a of (plano.length ? plano : [{ action: 'end' }])) {
      if (st.phase !== 'playing') break;
      if (a.action === 'move') {
        const ok = !!E.move(st, u.uid, a.x, a.y);
        if (meu) lances.push({ a: 'm', u: u.uid, x: a.x, y: a.y, ok });
      } else if (a.action === 'cast') {
        const ok = !!E.cast(st, u.uid, a.spellId, a.x, a.y);
        if (meu) lances.push({ a: 'c', u: u.uid, s: a.spellId, x: a.x, y: a.y, ok });
      } else if (a.action === 'end') {
        E.endTurn(st);
        if (meu) lances.push({ a: 'e', ok: true });
        acabou = true;
        break;
      }
      E.events.length = 0;
    }
    if (!acabou && st.phase === 'playing') {
      E.endTurn(st);
      if (meu) lances.push({ a: 'e', ok: true });
    }
    E.events.length = 0;
  }
  const mortos = st.units.filter((x) => x.side === 'enemy' && !x.alive).map((x) => x.defId);
  return { lances, fase: st.phase, hash: E.hash(st), mortos };
}

const J0 = mundo().JOGO;
const classes = Object.keys(J0.DATA.classes || {}).filter((c) => c !== 'gm');
const dungeons = (Array.isArray(J0.DATA.dungeons) ? J0.DATA.dungeons : Object.values(J0.DATA.dungeons))
  .filter((d) => d && d.id && d.rooms && d.rooms.length);
check('as regras carregam no Node (classes e calabouços)', classes.length >= 5 && dungeons.length >= 5,
      classes.length + ' classes, ' + dungeons.length + ' calabouços');

// ---- várias salas, grupos e sementes: o juiz chega ao mesmo fim
let iguais = 0, rodadas = 0, vitorias = 0, primeiroDiferente = null;
const casos = [];
dungeons.slice(0, 6).forEach((d, di) => {
  [0, d.rooms.length - 1].forEach((ri) => {
    const heroi = (k) => ({ heroId: classes[k % classes.length], classId: classes[k % classes.length],
                            element: 'neutro', level: 30 });
    const party = (di % 2) ? [heroi(di), heroi(di + 1)] : [heroi(di)];
    const semente = 1000 + di * 37 + ri;
    casos.push({ dungeonId: d.id, roomIndex: ri, party, semente, dificuldade: ['facil', 'normal', 'dificil'][di % 3] });
  });
});
casos.forEach((cs) => {
  const jogo = joga(cs.dungeonId, cs.roomIndex, cs.party, cs.semente, cs.dificuldade);
  rodadas++;
  if (jogo.fase === 'won') vitorias++;
  let r = null;
  try {
    r = refaz({ dungeonId: cs.dungeonId, roomIndex: cs.roomIndex, dificuldade: cs.dificuldade,
                semente: cs.semente, party: cs.party, escolhePosicao: false, lances: jogo.lances,
                hashFinal: jogo.hash });
  } catch (e) { r = { erro: e.message }; }
  const igual = r && r.ok && r.fase === jogo.fase && r.hash === jogo.hash &&
                JSON.stringify(r.mortos) === JSON.stringify(jogo.mortos);
  if (igual) iguais++;
  else if (!primeiroDiferente) primeiroDiferente = cs.dungeonId + '#' + cs.roomIndex + ' ' + JSON.stringify(r);
});
check('o juiz refaz ' + rodadas + ' salas (' + vitorias + ' vitórias) e chega ao MESMO fim, hash e mortos',
      iguais === rodadas, primeiroDiferente);

// ---- um cliente alterado
const base = casos.find((cs) => joga(cs.dungeonId, cs.roomIndex, cs.party, cs.semente, cs.dificuldade).lances
  .some((l) => l.a === 'c' && l.ok)) || casos[0];
const jb = joga(base.dungeonId, base.roomIndex, base.party, base.semente, base.dificuldade);
function tenta(lances, extra) {
  try {
    const r = refaz(Object.assign({ dungeonId: base.dungeonId, roomIndex: base.roomIndex, dificuldade: base.dificuldade,
                                    semente: base.semente, party: base.party, escolhePosicao: false, lances }, extra || {}));
    return { ok: true, r };
  } catch (e) { return { ok: false, motivo: e.motivo, msg: e.message, juiz: !!e.juiz }; }
}
const iCast = jb.lances.findIndex((l) => l.a === 'c' && l.ok);
if (iCast >= 0) {
  const mentido = jb.lances.map((l) => Object.assign({}, l));
  mentido[iCast].ok = false;
  const t1 = tenta(mentido);
  check('lance com o resultado mentido cai (divergiu)', !t1.ok && t1.motivo === 'divergiu', JSON.stringify(t1));

  const outraUnidade = jb.lances.map((l) => Object.assign({}, l));
  outraUnidade[iCast].u = 'u999';
  const t2 = tenta(outraUnidade);
  check('lance com uma unidade que não é a da vez cai', !t2.ok && t2.motivo === 'unidade', JSON.stringify(t2));
} else {
  check('a sala de base tem um feitiço que acerta (para as provas de alteração)', false, 'nenhum cast ok');
}
const t3 = tenta(jb.lances, { hashFinal: (jb.hash + 1) >>> 0 });
check('hash do fim forjado cai (divergiu)', !t3.ok && t3.motivo === 'divergiu', JSON.stringify(t3));
const t4 = tenta(jb.lances.concat([{ a: 'e', ok: true }]));
check('lance depois do fim cai', jb.fase === 'playing' || (!t4.ok && t4.motivo === 'depois-do-fim'), JSON.stringify(t4));
const t5 = tenta([{ a: 'm', u: 'u1', x: 0, y: 0, ok: true }], { semente: 1.5 });
check('semente torta é recusada', !t5.ok && t5.motivo === 'entrada', JSON.stringify(t5));
const t6 = tenta(jb.lances, { dungeonId: 'lua' });
check('sala que não existe é recusada', !t6.ok && t6.motivo === 'entrada', JSON.stringify(t6));

// ---- a sala interrompida não é vitória
const metade = jb.lances.slice(0, Math.max(1, Math.floor(jb.lances.length / 3)));
const t7 = tenta(metade);
check('a sala refeita só até a metade não termina em vitória', t7.ok && t7.r.fase !== 'won', JSON.stringify(t7.ok ? t7.r.fase : t7));

console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
