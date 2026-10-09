#!/usr/bin/env node
'use strict';
/* O `p` QUE VAI AO SERVIDOR LEVA AS CASAS MARCADAS (09/10).
 *
 *   node tests/coop_registro_p.js
 *
 * O dono: "de novo não deu XP na luta, isso é inaceitável". Toda sala em grupo em que alguém marcava a casa na
 * preparação caía no juiz como "o lance 1 deu diferente aqui": as casas (`e`, `eu`) iam ao outro cliente mas não ao
 * registro do servidor, e o juiz colocava todo mundo ao acaso. Aqui: o que o Coop anota para o servidor, de um lance
 * meu (registra) e de um que veio do outro (aplicado), leva `e` e `eu` quando o lance os tem — e o juiz, com eles,
 * refaz a colocação igual à do cliente. */
const path = require('path');
require(path.join(__dirname, '..', 'js', 'core', 'coop.js'));
const C = globalThis.JOGO.Coop;
let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++; if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
const p = { a: 'p', x: null, y: null, e: { u1: { x: 1, y: 2 }, u3: { x: 4, y: 5 } }, eu: 'u1', T: 0 };
const meu = C._entradaSrv(p, true, 'ana');
check('o `p` meu leva as casas marcadas (e) e quem marcou (eu)', meu.a === 'p' && meu.e && meu.e.u1.x === 1 && meu.e.u3.y === 5 && meu.eu === 'u1' && meu.ok === true && meu.de === 'ana', JSON.stringify(meu));
const dele = C._entradaSrv(Object.assign({}, p, { de: 'bia' }), true, 'bia');
check('o `p` que veio do outro (aplicado) leva as mesmas casas', dele.e && dele.e.u1.y === 2 && dele.eu === 'u1' && dele.de === 'bia', JSON.stringify(dele));
const m = C._entradaSrv({ a: 'm', u: 'u2', x: 3, y: 3, T: 1 }, false, 'ana');
check('um lance sem casas marcadas não ganha `e` nem `eu` (undefined, e o anotaSrv os deixa de fora)', m.e === undefined && m.eu === undefined && m.ok === false && m.u === 'u2');

// o juiz, com as casas, refaz a colocação do cliente — e sem elas, não
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
const AGORA = Date.UTC(2026, 9, 9, 15);
const w = est.mundoEconomico({ agoraMs: AGORA, semente: 5 });
est.poeEstado(w, null, null);
const J = w.J, E = J.Engine;
const party = J.Progress.battleParty(['sumo', 'curandeiro']).map((x) => Object.assign(x, { dono: 'ana' }));
const st = E.createBattle('cistern', 0, JSON.parse(JSON.stringify(party)), { seed: 7, escolhePosicao: true });
const herois = st.units.filter((u) => u.kind === 'hero' && u.side === 'player');
const op = st.placement.opcoes;
const escolhas = {};
herois.forEach((u) => { const lista = op[u.uid] || []; if (lista.length) escolhas[u.uid] = { x: lista[lista.length - 1].x, y: lista[lista.length - 1].y }; });
const marcados = herois.filter((u) => escolhas[u.uid]);
check('a sala tem casa marcável para ao menos um herói (o principal; os outros nascem ao redor)', marcados.length >= 1, JSON.stringify(escolhas));
const st1 = JSON.parse(JSON.stringify(st)), st2 = JSON.parse(JSON.stringify(st));
E.place(st1, null, null, { escolhas });
E.place(st2, null, null, { escolhas: {} });
const pos = (s) => herois.map((u) => { const v = E.findUnit(s, u.uid); return u.uid + '@' + v.x + ',' + v.y; }).join(' ');
check('com as casas marcadas o herói nasce onde marcou', marcados.every((u) => { const v = E.findUnit(st1, u.uid); return v.x === escolhas[u.uid].x && v.y === escolhas[u.uid].y; }), pos(st1));
check('sem as casas o juiz os poria noutro lugar (era a divergência)', pos(st1) !== pos(st2), pos(st1) + ' vs ' + pos(st2));
console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
