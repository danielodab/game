#!/usr/bin/env node
'use strict';
/* PROVA DOS FEITOS DE COLEÇÃO (07/10, Progress.feitos / anotaBestiario / anotaFusaoVencida; game.js computeRewards).
 *
 *   node tests/feitos.js
 *
 * No mundo econômico do juiz (o mesmo código do jogo):
 *   · a conta nova tem os feitos todos a zero: um bestiário por portal aberto, "chefes" (6) e "fusoes" (21);
 *   · a sala vencida anota no bestiário cada monstro caído (uma vez por corpo) e a dupla fundida viva no fim;
 *   · o bestiário completo de um portal dá +10% de saque LÁ e em nenhum outro; os seis chefes e as 21 fusões
 *     dão +5% de XP cada (os dois, +10%), e a XP da sala sobe de acordo;
 *   · o sanitize guarda os contadores e descarta id que o dado não conhece e número torto;
 *   · o hash da economia muda com os contadores (o estado é do servidor). */
const path = require('path');
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
const DIA = Date.UTC(2026, 9, 7, 15);
function mundoNovo(semente) {
  const w = est.mundoEconomico({ agoraMs: DIA, semente: semente || 5 });
  est.poeEstado(w, null, null);
  return w;
}

(function () {
  const w = mundoNovo();
  const J = w.J, P = J.Progress;
  const fs = P.feitos();
  const abertos = J.DATA.dungeons.filter((d) => d.id !== 'poco' && !(J.DATA.portalFechado && J.DATA.portalFechado(d.id))).length;
  check('a conta nova tem um bestiário por portal aberto (' + abertos + '), os chefes e as fusões, todos a zero',
        fs.filter((f) => f.tipo === 'bestiario').length === abertos && fs.some((f) => f.id === 'chefes' && f.alvo === 6) &&
        fs.some((f) => f.id === 'fusoes' && f.alvo === 21) && fs.every((f) => f.prog === 0 && !f.feito), JSON.stringify(fs.map((f) => [f.id, f.prog, f.alvo])));
  check('sem feito, os fatores são 1', P.feitoXp() === 1 && P.feitoSaque('cistern') === 1);

  // ---- a sala vencida anota
  const G = J.Game, E = J.Engine;
  const party = [{ heroId: 'sumo', classId: 'sumo', element: 'neutro', level: 20 }];
  const st = E.createBattle('cistern', 0, party, { seed: 3, dificuldade: 'normal', escolhePosicao: false });
  st.units.forEach((u) => { if (u.side === 'enemy') { u.alive = false; u.hp = 0; } });
  st.phase = 'won';
  G.state = st; G.party = ['sumo']; G.dungeonId = 'cistern'; G.roomIndex = 0;
  G._computeRewards();
  const caidos = st.units.filter((u) => u.side === 'enemy' && u.kind === 'monster').map((u) => u.defId);
  const bst = P.state.bestiario || {};
  const soma = [...new Set(caidos)].reduce((n, id) => n + (bst[id] || 0), 0);
  check('a sala vencida anota cada monstro caído no bestiário (' + caidos.length + ' corpos)', soma === caidos.length && Object.keys(bst).length >= 1,
        JSON.stringify(bst));
  const hashAntes = J.Economia.hash(P.state, J.DB.exportar());
  check('o bestiário da Cisterna anda (' + P.feitos().find((f) => f.id === 'bestiario-cistern').prog + ' de ' +
        P.feitos().find((f) => f.id === 'bestiario-cistern').alvo + ')', P.feitos().find((f) => f.id === 'bestiario-cistern').prog > 0);

  // ---- a fusão vencedora
  const st2 = E.createBattle('cistern', 0, party.concat([{ heroId: 'bruxo', classId: 'bruxo', element: 'neutro', level: 20 }]),
                             { seed: 4, dificuldade: 'normal', escolhePosicao: false });
  const a = st2.units.find((u) => u.heroId === 'sumo'), b = st2.units.find((u) => u.heroId === 'bruxo');
  st2.units.push({ uid: 'uF', kind: 'fusion', side: 'player', alive: true, heroIds: [a.uid, b.uid], hp: 100, hpMax: 100, effects: [] });
  st2.units.forEach((u) => { if (u.side === 'enemy') { u.alive = false; u.hp = 0; } });
  st2.phase = 'won';
  G.state = st2; G.party = ['sumo', 'bruxo'];
  G._computeRewards();
  check('a dupla fundida viva no fim conta uma sala vencida (bruxo+sumo)', (P.state.fusoes || {})['bruxo+sumo'] === 1, JSON.stringify(P.state.fusoes));

  // ---- os bônus
  const ms = J.DATA.monsters;
  Object.keys(ms).forEach((id) => { if (ms[id].dungeonId === 'cistern' && !ms[id].summonOnly && !ms[id].colosso) P.anotaBestiario(id, 1); });
  check('o bestiário completo da Cisterna dá +10% de saque lá e 1 na Estufa',
        P.feitoSaque('cistern') === 1.1 && P.feitoSaque('greenhouse') === 1 && P.feitos().find((f) => f.id === 'bestiario-cistern').feito);
  Object.keys(ms).forEach((id) => { if (ms[id].boss && ms[id].dungeonId && !(J.DATA.especial && J.DATA.especial(ms[id].dungeonId))) P.anotaBestiario(id, 1); });
  check('os seis chefes dão +5% de XP', Math.abs(P.feitoXp() - 1.05) < 1e-9 && P.feitos().find((f) => f.id === 'chefes').feito, P.feitoXp());
  const cls = Object.keys(J.DATA.classes).filter((c) => c !== 'gm');
  for (let i = 0; i < cls.length; i++) for (let j = i + 1; j < cls.length; j++) P.anotaFusaoVencida(cls[i], cls[j]);
  check('as 21 fusões dão mais +5% (os dois, +10%)', Math.abs(P.feitoXp() - 1.10) < 1e-9 && P.feitos().find((f) => f.id === 'fusoes').feito, P.feitoXp());
  P.save();
  check('o hash da economia muda com os contadores', J.Economia.hash(P.state, J.DB.exportar()) !== hashAntes);

  // a XP da sala sobe com o feito (a mesma sala, mundo novo sem feito contra este)
  function xpDe(Jx) {
    const Gx = Jx.Game, Ex = Jx.Engine;
    const s = Ex.createBattle('greenhouse', 1, party, { seed: 7, dificuldade: 'normal', escolhePosicao: false });
    s.units.forEach((u) => { if (u.side === 'enemy') { u.alive = false; u.hp = 0; } });
    s.phase = 'won';
    Gx.state = s; Gx.party = ['sumo']; Gx.dungeonId = 'greenhouse'; Gx.roomIndex = 1;
    return Gx._computeRewards().xpGanho;
  }
  const semFeito = xpDe(mundoNovo(9).J);
  const comFeito = xpDe(J);
  check('a sala paga +10% de XP com os dois feitos (' + semFeito + ' → ' + comFeito + ')', comFeito === Math.floor(semFeito * 1.10) || Math.abs(comFeito - semFeito * 1.10) <= 1);

  // ---- o sanitize
  const estado = est.tiraEstado(w);
  const w2 = est.mundoEconomico({ agoraMs: DIA, semente: 1 });
  const bruto = JSON.parse(JSON.stringify(estado.progress));
  bruto.bestiario['monstro-de-mentira'] = 3;
  bruto.bestiario['glub-evolved-x'] = -2;
  bruto.fusoes['Sumo+Bruxo!'] = 1;
  est.poeEstado(w2, bruto, estado.db);
  const P2 = w2.J.Progress;
  check('o save recarregado mantém os contadores', Math.abs(P2.feitoXp() - 1.10) < 1e-9 && P2.feitoSaque('cistern') === 1.1);
  check('o id que o dado não conhece e a chave torta saem no load',
        !(P2.state.bestiario || {})['monstro-de-mentira'] && !(P2.state.bestiario || {})['glub-evolved-x'] && !(P2.state.fusoes || {})['Sumo+Bruxo!']);
})();

console.log('\n' + (total - falhas) + ' de ' + total + ' passaram' + (falhas ? ' — ' + falhas + ' FALHARAM' : ''));
process.exit(falhas ? 1 : 0);
