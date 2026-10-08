#!/usr/bin/env node
'use strict';
/* PROVA DO BÔNUS DE DESCANSO (08/10 à noite, js/core/progress.js Progress.descanso/anotaDescanso).
 *
 *   node tests/descanso.js
 *
 * A régua pura, no mundo do juiz (o mesmo Progress do jogo): o dia é o de Brasília (UTC−3); as três primeiras
 * salas vencidas do dia valem fator 2 e a quarta vale 1; o dia que vira recomeça do zero; o campo só nasce na
 * primeira sala (o save de antes fica sem ele — o hash não muda) e sobrevive ao saneamento. O funil da sala
 * (game.js) é provado em tests/juiz_recompensa.js. */
const path = require('path');
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}

const w = est.mundoEconomico({ agoraMs: Date.UTC(2026, 8, 13, 15, 0, 0), semente: 1 });
est.poeEstado(w, null, null);
const P = w.J.Progress;

check('o dia é o de Brasília: 02:59 UTC ainda é o dia anterior, 03:00 já é o novo',
      P.diaBrasilia(Date.UTC(2026, 8, 14, 2, 59)) === '2026-09-13' && P.diaBrasilia(Date.UTC(2026, 8, 14, 3, 0)) === '2026-09-14');
const T = Date.UTC(2026, 8, 13, 15, 0, 0);
check('a conta nova não tem o campo (o hash do save de antes não muda)', P.state.descanso === undefined);
const d0 = P.descanso(T);
check('sem sala hoje: 0 vencidas, restam 3, fator 2', d0 && d0.salas === 0 && d0.restam === 3 && d0.fator === 2 && d0.dia === '2026-09-13', JSON.stringify(d0));
check('sem instante válido, nada se promete', P.descanso(undefined) === null && P.descanso(NaN) === null);
const d1 = P.anotaDescanso(T), d2 = P.anotaDescanso(T), d3 = P.anotaDescanso(T);
check('três salas vencidas: restam 2, 1, 0 e o fator cai a 1 na terceira anotada',
      d1.restam === 2 && d1.fator === 2 && d2.restam === 1 && d2.fator === 2 && d3.restam === 0 && d3.fator === 1, JSON.stringify([d1, d2, d3]));
const d4 = P.anotaDescanso(T);
check('a quarta conta (4 vencidas) e segue sem bônus', d4.salas === 4 && d4.fator === 1 && P.state.descanso.salas === 4);
const amanha = P.descanso(Date.UTC(2026, 8, 14, 3, 0, 0));
check('o dia que vira recomeça do zero', amanha.salas === 0 && amanha.restam === 3 && amanha.fator === 2);
const d5 = P.anotaDescanso(Date.UTC(2026, 8, 14, 3, 0, 0));
check('... e a primeira sala do dia novo troca o carimbo', d5.dia === '2026-09-14' && d5.salas === 1 && P.state.descanso.dia === '2026-09-14');
// o saneamento
const foto = est.tiraEstado(w);
check('o campo sai no save', foto.progress.descanso && foto.progress.descanso.dia === '2026-09-14' && foto.progress.descanso.salas === 1);
const w2 = est.mundoEconomico({ agoraMs: T, semente: 1 });
est.poeEstado(w2, foto.progress, foto.db);
const foto2 = est.tiraEstado(w2);
const w2b = est.mundoEconomico({ agoraMs: T, semente: 1 });
est.poeEstado(w2b, foto2.progress, foto2.db);
// (a 1ª carga de um save novo migra campos; a régua do hash é entre a 2ª e a 3ª, como em tests/juiz_economia.js)
check('... e volta inteiro pelo saneamento (o mesmo hash entre duas cargas)',
      w2.J.Progress.state.descanso.salas === 1 && est.tiraEstado(w2b).hash === foto2.hash && w2b.J.Progress.state.descanso.dia === '2026-09-14');
const w3 = est.mundoEconomico({ agoraMs: T, semente: 1 });
const semCampo = JSON.parse(JSON.stringify(foto.progress));
delete semCampo.descanso;
est.poeEstado(w3, semCampo, foto.db);
check('o save de antes (sem o campo) segue sem ele depois do saneamento', w3.J.Progress.state.descanso === undefined);
const w4 = est.mundoEconomico({ agoraMs: T, semente: 1 });
est.poeEstado(w4, Object.assign({}, semCampo, { descanso: { dia: 'ontem', salas: -2 } }), foto.db);
check('campo torto (dia que não é data) cai fora', w4.J.Progress.state.descanso === undefined);

console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
