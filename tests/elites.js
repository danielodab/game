#!/usr/bin/env node
'use strict';
/* PROVA DOS ELITES DE SALA (07/10, js/core/elites.js — a decisão 23 do engine.js).
 *
 *   node tests/elites.js
 *
 * Roda sobre o motor do juiz (servidor/juiz/motor.js). Cobra:
 *   · onde cabe: calabouços e Poço sim; a 1ª sala da Estufa, a Câmara do Eco, a arena do PvP e o
 *     Santuário não (e nelas o rng da sala não gasta tirada: o hash é o de antes);
 *   · a chance: em muitas sementes, entre 25% e 55% das salas elegíveis nascem com elite — nunca o
 *     chefe, nunca um filhote, nunca o colosso; a mesma semente dá o mesmo elite, outra pode dar outro;
 *   · cada traço faz o que diz: +50% de vida; Couraçado corta o golpe pela metade e perde placas (ar
 *     arranca duas); Explosivo fere a casa vizinha ao cair; Enfurecido ganha +30 de poder na metade da
 *     vida; Veloz tem +1 PP e +1 PA; Regenerador cura 6% no começo da vez dele;
 *   · o juiz refaz a sala com elite e chega ao mesmo fim; sem o módulo no mundo do juiz, diverge;
 *   · a recompensa: o elite paga ×1,5 de XP e deixa pedra sempre (uma a mais). */
const path = require('path');
const { mundo } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'motor.js'));
const { refaz, ehDoJogador } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (extra !== undefined && !ok ? ' — ' + extra : ''));
}

const J = mundo().JOGO, E = J.Engine, Elx = J.Elites;
const PARTY = [{ heroId: 'sumo', classId: 'sumo', element: 'neutro', level: 20 }];
function sala(dungeon, room, seed, extra) {
  return E.createBattle(dungeon, room, PARTY, Object.assign({ seed, dificuldade: 'normal', escolhePosicao: false }, extra || {}));
}
function elite(st) { return st.units.find((u) => u.elite); }
function inimigos(st) { return st.units.filter((u) => u.side === 'enemy'); }

check('o módulo carrega com o motor, com cinco traços', !!Elx && Elx.TRACOS.length === 5);

// ---- onde cabe
check('a 1ª sala da Estufa nunca tem elite (30 sementes)', [...Array(30).keys()].every((s) => !elite(sala('greenhouse', 0, 100 + s))));
check('a Câmara do Eco não tem elite', !elite(sala('camara_eco', 0, 5)));
check('o Santuário não tem elite', !elite(sala('elementsanctum', 0, 5)));
// o hash sem o módulo é o mesmo nas salas que não cabem (nenhuma tirada gasta)
const Jsem = mundo().JOGO; Jsem.Elites = null;
const semMod = (d, r, s) => Jsem.Engine.createBattle(d, r, PARTY, { seed: s, dificuldade: 'normal', escolhePosicao: false });
check('na sala que não cabe, o rng não gasta tirada: o mesmo hash com e sem o módulo',
      E.hash(sala('greenhouse', 0, 7)) === Jsem.Engine.hash(semMod('greenhouse', 0, 7)));

// ---- a chance e quem
let comElite = 0, n = 0, tortos = 0;
const ms = J.DATA.monsters;
for (const d of J.DATA.dungeons) {
  for (let r = 0; r < d.rooms.length; r++) {
    if (d.id === 'greenhouse' && r === 0) continue;
    for (let s = 1; s <= 25; s++) {
      const st = sala(d.id, r, s * 13 + r);
      n++;
      const e = elite(st);
      if (!e) continue;
      comElite++;
      const def = ms[e.defId];
      if (e.boss || !def || def.colosso || def.summonOnly || e.side !== 'enemy' || e.kind !== 'monster') tortos++;
    }
  }
}
const frac = comElite / n;
check('entre 25% e 55% das salas elegíveis nascem com elite (' + comElite + ' de ' + n + ', ' + Math.round(frac * 100) + '%)',
      frac >= 0.25 && frac <= 0.55);
check('nunca o chefe, o colosso nem um filhote', tortos === 0, tortos);
check('a mesma semente dá o mesmo elite', (() => {
  for (let s = 1; s < 60; s++) {
    const a = sala('cistern', 1, s), b = sala('cistern', 1, s);
    const ea = elite(a), eb = elite(b);
    if (!!ea !== !!eb) return false;
    if (ea && (ea.uid !== eb.uid || ea.elite.id !== eb.elite.id)) return false;
  }
  return true;
})());
check('outra semente pode dar outro traço', (() => {
  const vistos = new Set();
  for (let s = 1; s < 200; s++) { const e = elite(sala('cistern', 1, s)); if (e) vistos.add(e.elite.id); }
  return vistos.size >= 3;
})());

// ---- cada traço (vestido à mão, para não depender do sorteio)
function vestida(id, seed) {
  const st = sala('cistern', 0, seed || 3);
  st.units.forEach((u) => { delete u.elite; });     // o sorteado de verdade sai do caminho
  const alvo = inimigos(st).find((u) => !u.boss && !u.elite);
  const hpAntes = alvo.hpMax, ppAntes = alvo.ppMax, paAntes = alvo.paMax;
  Elx.veste(st, alvo, id, E._interno());
  return { st, u: alvo, hpAntes, ppAntes, paAntes };
}
const I = E._interno();
const v1 = vestida('couracado');
check('+50% de vida máxima (e cheia)', v1.u.hpMax === Math.round(v1.hpAntes * 1.5) && v1.u.hp === v1.u.hpMax);
(function () {
  const heroi = v1.st.units.find((u) => u.side === 'player');
  const antes = v1.u.hp;
  I.dano(v1.st, v1.u, 40, 'neutro', heroi.uid, true);
  const d1 = antes - v1.u.hp;
  check('Couraçado: o golpe entra pela metade e a couraça perde uma placa', d1 === 20 && v1.u.couraca === 2, d1 + ' / ' + v1.u.couraca);
  I.dano(v1.st, v1.u, 40, 'ar', heroi.uid, true);
  check('... o golpe de ar arranca duas placas (a couraça cai)', v1.u.couraca === 0, v1.u.couraca);
  const antes2 = v1.u.hp;
  I.dano(v1.st, v1.u, 40, 'neutro', heroi.uid, true);
  check('... sem couraça o golpe entra inteiro', antes2 - v1.u.hp === 40);
})();
const v2 = vestida('explosivo');
(function () {
  const heroi = v2.st.units.find((u) => u.side === 'player');
  // o herói cola no elite e o mata: a explosão o pega
  heroi.x = v2.u.x + 1; heroi.y = v2.u.y;
  if (!I.isFloor(v2.st, heroi.x, heroi.y)) { heroi.x = v2.u.x - 1; }
  const hpH = heroi.hp;
  I.dano(v2.st, v2.u, 99999, 'neutro', heroi.uid, true);
  check('Explosivo: ao cair, fere quem está na casa vizinha', !v2.u.alive && heroi.hp < hpH, hpH + ' → ' + heroi.hp);
})();
const v3 = vestida('enfurecido');
(function () {
  const heroi = v3.st.units.find((u) => u.side === 'player');
  I.dano(v3.st, v3.u, Math.ceil(v3.u.hpMax * 0.55), 'neutro', heroi.uid, true);
  check('Enfurecido: abaixo da metade da vida ganha +30 de poder', v3.u.enraged === true &&
        v3.u.effects.some((e) => e.type === 'buff' && e.stat === 'power' && e.value === 30), JSON.stringify(v3.u.effects));
})();
const v4 = vestida('veloz');
check('Veloz: +1 PP e +1 PA', v4.u.ppMax === v4.ppAntes + 1 && v4.u.paMax === v4.paAntes + 1 && v4.u.pp === v4.u.ppMax);
const v5 = vestida('regenerador');
(function () {
  const heroi = v5.st.units.find((u) => u.side === 'player');
  v5.st.weather = 'calmo';          // sem o clima: a chuva da Cisterna daria +5 PV ao monstro de água por cima
  I.dano(v5.st, v5.u, Math.round(v5.u.hpMax * 0.5), 'neutro', heroi.uid, true);
  const antes = v5.u.hp;
  // anda a ordem até a vez do elite
  let voltas = 0;
  while (E.activeUnit(v5.st) && E.activeUnit(v5.st).uid !== v5.u.uid && voltas++ < 20) E.endTurn(v5.st);
  check('Regenerador: no começo da vez dele cura 6% da vida máxima', v5.u.hp === Math.min(v5.u.hpMax, antes + Math.round(v5.u.hpMax * 0.06)),
        antes + ' → ' + v5.u.hp + ' de ' + v5.u.hpMax);
})();
check('o hash muda com o elite', (() => {
  const a = sala('cistern', 0, 3), b = sala('cistern', 0, 3);
  const alvo = inimigos(b).find((u) => !u.boss && !u.elite);
  Elx.veste(b, alvo, 'veloz', I);
  return E.hash(a) !== E.hash(b);
})());

// ---- o juiz
function joga(seed) {
  const w = mundo();
  const Jw = w.JOGO, Ew = Jw.Engine;
  const st = Ew.createBattle('cistern', 1, PARTY, { seed, dificuldade: 'normal', escolhePosicao: false });
  Ew.events.length = 0;
  const lances = [];
  let voltas = 0;
  while (st.phase === 'playing' && voltas++ < 4000) {
    const u = Ew.activeUnit(st);
    if (!u) break;
    const plano = Jw.AI.planTurn(st, u.uid) || [];
    const meu = ehDoJogador(st, u);
    let acabou = false;
    for (const a of (plano.length ? plano : [{ action: 'end' }])) {
      if (st.phase !== 'playing') break;
      if (a.action === 'move') { const ok = !!Ew.move(st, u.uid, a.x, a.y); if (meu) lances.push({ a: 'm', u: u.uid, x: a.x, y: a.y, ok }); }
      else if (a.action === 'cast') { const ok = !!Ew.cast(st, u.uid, a.spellId, a.x, a.y); if (meu) lances.push({ a: 'c', u: u.uid, s: a.spellId, x: a.x, y: a.y, ok }); }
      else if (a.action === 'end') { Ew.endTurn(st); if (meu) lances.push({ a: 'e', ok: true }); acabou = true; break; }
    }
    if (!acabou && st.phase === 'playing') { Ew.endTurn(st); if (meu) lances.push({ a: 'e', ok: true }); }
    Ew.events.length = 0;
  }
  return { lances, fase: st.phase, hash: Ew.hash(st), elite: !!elite(st) };
}
let seedCom = null;
for (let s = 1; s < 80 && seedCom == null; s++) if (elite(sala('cistern', 1, s))) seedCom = s;
const jogo = joga(seedCom);
let r = null;
try { r = refaz({ dungeonId: 'cistern', roomIndex: 1, dificuldade: 'normal', semente: seedCom, party: PARTY, escolhePosicao: false,
                  lances: jogo.lances, hashFinal: jogo.hash }); } catch (e) { r = { erro: e.message, motivo: e.motivo }; }
check('o juiz refaz a sala com elite (semente ' + seedCom + ') e chega ao mesmo fim (' + jogo.fase + ')',
      jogo.elite && r && r.ok && r.fase === jogo.fase && r.hash === jogo.hash, JSON.stringify(r));

// ---- a recompensa: ×1,5 de XP e pedra garantida (medido no funil do jogo, com o Math.random semeado)
(function () {
  const w = est.mundoEconomico({ agoraMs: Date.UTC(2026, 9, 7, 15), semente: 5 });
  est.poeEstado(w, null, null);
  const Jw = w.J, G = Jw.Game;
  function recompensaDe(comElite) {
    const st = Jw.Engine.createBattle('cistern', 0, PARTY, { seed: 3, dificuldade: 'normal', escolhePosicao: false });
    st.units.forEach((u) => { delete u.elite; });
    const alvo = inimigos(st).find((u) => !u.boss);
    if (comElite) Jw.Elites.veste(st, alvo, 'veloz', Jw.Engine._interno());
    // todos os inimigos caem: a sala "vencida"
    st.units.forEach((u) => { if (u.side === 'enemy') { u.alive = false; u.hp = 0; } });
    st.phase = 'won';
    G.state = st; G.party = ['sumo']; G.dungeonId = 'cistern'; G.roomIndex = 0;
    const antes = Jw.Progress.stoneCount('stone-tear') + Jw.Progress.stoneCount('stone-root');
    const rw = G._computeRewards();
    return { xp: rw.xpGanho, pedras: rw.stones, alvo, ganhouPedra: Object.keys(rw.stones || {}).length > 0, antes };
  }
  const sem = recompensaDe(false);
  const com = recompensaDe(true);
  const def = Jw.DATA.monsters[com.alvo.defId];
  const esperado = Math.floor((sem.xp * 1 + def.xp * 0.5) / 1 * 1) ;   // só o elite paga 0,5 a mais
  check('o elite paga ×1,5 de XP (' + sem.xp + ' → ' + com.xp + ')', com.xp >= sem.xp + Math.floor(def.xp * 0.5) - 1 && com.xp > sem.xp,
        'esperado ~' + esperado);
  check('o elite deixa pedra sempre', com.ganhouPedra, JSON.stringify(com.pedras));
})();

console.log('\n' + (total - falhas) + ' de ' + total + ' passaram' + (falhas ? ' — ' + falhas + ' FALHARAM' : ''));
process.exit(falhas ? 1 : 0);
