#!/usr/bin/env node
'use strict';
/* PROVA DAS REGRAS DO EQUILÍBRIO (03/10). A bancada do equilíbrio
 * (tests/equilibrio.js) achou regras erradas no motor e na IA, e elas foram
 * consertadas junto com o acerto dos números (docs/EQUILIBRIO.md §3). A
 * bancada só as enxerga pela média de centenas de jogos — esta prova cobra
 * cada regra direto, num lance só, para que um conserto futuro não as desfaça
 * calado:
 *
 *   node tests/regras_equilibrio.js
 *
 *   · FEITIÇO MISTO (Engine.feiticoMisto): o efeito hostil só pega o outro
 *     lado; o a favor só pega o lado de quem lança, e quem lança sempre;
 *     o buff negativo vai para o outro lado; a invocação nasce e o golpe da
 *     cravada não a mata (a Sentinela matava o próprio ídolo);
 *   · feitiço SÓ hostil continua com fogo amigo; SÓ a favor continua pegando
 *     quem estiver na área;
 *   · ARMADILHA AO PÉ DO MURO: o lance que mura a casa arma na primeira
 *     vizinha livre (norte, sul, oeste, leste), nunca em cima da pedra;
 *   · O PREÇO NO PRÓPRIO CORPO: o feitiço de alvo próprio e casa única
 *     (Sangue Fervente, Veias em Chamas) queima quem lança; a área em volta
 *     do corpo continua sem ferir quem lança;
 *   · a IA ergue o muro que corta a visão de quem atira nela, e o Ladino
 *     salta com o Passo do Vento para chegar perto (os dois valiam zero);
 *   · Engine.VERSAO_REGRAS ≥ 6.
 *
 * Roda sobre o motor do juiz (servidor/juiz/motor.js), como o juiz refaz. */
const path = require('path');
const { mundo } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'motor.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (extra !== undefined && !ok ? ' — ' + extra : ''));
}

/* A sala de prova: 13×7 aberta, dois bonecos de 1000 PV sem PP. Os feitiços
 * 'pe-' são sintéticos e de valor fixo (min = max), para o lado de cada efeito
 * se ler pela vida. */
function prepara(J) {
  const D = J.DATA;
  const RES = { neutro: 0, fogo: 0, agua: 0, terra: 0, ar: 0 };
  ['pe-alvo', 'pe-alvo2'].forEach((id) => {
    D.monsters[id] = { id, name: 'Alvo', family: 'Prova', element: 'neutro', description: 'prova',
      stats: { hp: 1000, pa: 6, pp: 0, initiative: 1, power: 0, dodge: 0, lock: 0, resists: RES },
      spells: [], ai: 'melee', traits: [], boss: false };
  });
  D.monsters['pe-atirador'] = { id: 'pe-atirador', name: 'Atirador', family: 'Prova', element: 'neutro', description: 'prova',
    stats: { hp: 1000, pa: 6, pp: 0, initiative: 1, power: 0, dodge: 0, lock: 0, resists: RES },
    spells: ['pe-tiro'], ai: 'ranged', traits: [], boss: false };
  function sp(id, over) {
    D.spells[id] = Object.assign({ id, name: id, element: 'neutro', classId: null, unlockLevel: 0, paCost: 1,
      cooldown: 0, castsPerTurn: 0, range: { min: 0, max: 8, line: false, los: true },
      aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'any', effects: [],
      description: 'prova', flavor: '', fxKey: 'slam' }, over);
  }
  sp('pe-misto', { effects: [{ type: 'damage', element: 'neutro', min: 20, max: 20 }, { type: 'heal', min: 15, max: 15 }] });
  sp('pe-misto-buff', { effects: [{ type: 'damage', element: 'neutro', min: 20, max: 20 },
    { type: 'shield', value: 30, duration: 2 }, { type: 'buff', stat: 'pp', value: -1, duration: 1 }] });
  sp('pe-bola', { effects: [{ type: 'damage', element: 'neutro', min: 20, max: 20 }] });
  sp('pe-cura', { effects: [{ type: 'heal', min: 15, max: 15 }] });
  sp('pe-cravada', { needsEmptyTile: true,
    effects: [{ type: 'summon', monsterId: 'fus-wall-watcher' }, { type: 'damage', element: 'neutro', min: 400, max: 400 }] });
  sp('pe-tiro', { range: { min: 1, max: 10, line: false, los: true }, aoe: { shape: 'single', size: 0 }, targetSide: 'enemy',
    effects: [{ type: 'damage', element: 'neutro', min: 10, max: 10 }] });
  D.dungeons.push({
    id: 'prova-equilibrio', name: 'Prova do Equilíbrio', theme: 'prova', description: 'prova', difficulty: 1, order: 0,
    palette: {}, defaultWeather: 'calmo', weatherShiftEveryRounds: 0, tileEventRate: 0, lootTable: [], cardDrops: [],
    rooms: [
      { name: 'campo', weather: 'calmo', sceneryTheme: 'prova', layout: [
        '#############',
        '#PP.........#',
        '#...........#',
        '#...........#',
        '#...........#',
        '#.........ab#',
        '#############'], monsters: { a: 'pe-alvo', b: 'pe-alvo2' } },
      { name: 'galeria', weather: 'calmo', sceneryTheme: 'prova', layout: [
        '#############',
        '#P..........#',
        '#...........#',
        '#...........#',
        '#...........#',
        '#..........a#',
        '#############'], monsters: { a: 'pe-atirador' } }
    ]
  });
}

function sala(E, roomIndex, party, seed) {
  const st = E.createBattle('prova-equilibrio', roomIndex, party, { seed: seed || 11, escolhePosicao: false });
  st.phase = 'playing';
  return st;
}
function ateAVezDe(E, st, u) {
  for (let i = 0; i < 20; i++) {
    const a = E.activeUnit(st);
    if (a && a.uid === u.uid) return true;
    E.endTurn(st);
  }
  return false;
}
// a cena de sempre: quem lança em (2,3), o parceiro e o boneco lado a lado no
// meio, e o outro boneco longe; o parceiro, quem lança e o boneco já feridos
function cena(E, classe) {
  const st = sala(E, 0, [{ classId: classe || 'curandeiro', heroId: 'h1', level: 12 },
                         { classId: 'sumo', heroId: 'h2', level: 12 }]);
  const hs = st.units.filter((u) => u.kind === 'hero');
  const h = hs.find((u) => u.heroId === 'h1') || hs[0];
  const p = hs.find((u) => u !== h);
  const a = st.units.find((u) => u.defId === 'pe-alvo');
  const b = st.units.find((u) => u.defId === 'pe-alvo2');
  ateAVezDe(E, st, h);
  h.x = 2; h.y = 3; p.x = 5; p.y = 3; a.x = 6; a.y = 3; b.x = 11; b.y = 5;
  h.hp = h.hpMax - 40; p.hp = p.hpMax - 40; a.hp = 900;
  h.pa = 30; h.castsThisTurn = {}; h.cooldowns = {};
  return { st, h, p, a, b };
}
function lanca(E, c, id, x, y) {
  if (c.h.spells.indexOf(id) < 0) c.h.spells.push(id);
  return E.cast(c.st, c.h.uid, id, x, y);
}

const J = mundo(['js/core/progress.js']).JOGO;
prepara(J);
const E = J.Engine, AI = J.AI, D = J.DATA;

check('Engine.VERSAO_REGRAS é 6 ou maior (o equilíbrio mudou o fim de uma sala refeita)', E.VERSAO_REGRAS >= 6, E.VERSAO_REGRAS);
check('feiticoMisto: dano + cura é misto; só dano e só cura não são',
  E.feiticoMisto(D.spells['pe-misto']) && !E.feiticoMisto(D.spells['pe-bola']) && !E.feiticoMisto(D.spells['pe-cura']));

/* 1. O misto: a cura não vai ao inimigo, o dano não vai ao parceiro, e quem
 *    lança (fora da área) recebe a cura. */
(function () {
  const c = cena(E);
  const hp0 = { h: c.h.hp, p: c.p.hp, a: c.a.hp };
  const ok = lanca(E, c, 'pe-misto', 5, 3);
  check('misto: o lance sai', ok === true);
  check('misto: o inimigo na área só apanha (perde vida, não ganha a cura)', c.a.hp < hp0.a && hp0.a - c.a.hp >= 10, hp0.a + ' → ' + c.a.hp);
  check('misto: o parceiro na área não apanha e é curado', c.p.hp > hp0.p, hp0.p + ' → ' + c.p.hp);
  check('misto: quem lança, fora da área, recebe a parte que ajuda', c.h.hp > hp0.h, hp0.h + ' → ' + c.h.hp);
})();

/* 2. O misto com escudo e buff negativo: escudo só no próprio lado, o −1 PP
 *    só no outro. */
(function () {
  const c = cena(E);
  const ok = lanca(E, c, 'pe-misto-buff', 5, 3);
  const ppNeg = (u) => u.effects.some((e) => e.type === 'buff' && e.stat === 'pp' && e.value < 0);
  check('misto com escudo e −1 PP: o lance sai', ok === true);
  check('misto: o escudo vai ao parceiro e a quem lança, não ao inimigo', c.p.shield > 0 && c.h.shield > 0 && !(c.a.shield > 0),
    'parceiro ' + c.p.shield + ' · quem lança ' + c.h.shield + ' · inimigo ' + c.a.shield);
  check('misto: o −1 PP vai ao inimigo, não ao parceiro', ppNeg(c.a) && !ppNeg(c.p));
})();

/* 3. Só hostil: o fogo amigo continua (a área do Bruxo queima o parceiro). */
(function () {
  const c = cena(E);
  const hp0 = c.p.hp;
  lanca(E, c, 'pe-bola', 5, 3);
  check('só hostil: o parceiro na área apanha (fogo amigo existe)', c.p.hp < hp0, hp0 + ' → ' + c.p.hp);
})();

/* 4. Só a favor: pega quem estiver na área, de qualquer lado. */
(function () {
  const c = cena(E);
  const hp0 = { p: c.p.hp, a: c.a.hp, h: c.h.hp };
  lanca(E, c, 'pe-cura', 5, 3);
  check('só a favor: o parceiro na área é curado', c.p.hp > hp0.p);
  check('só a favor: o inimigo na área também (a regra do misto não vale aqui)', c.a.hp > hp0.a, hp0.a + ' → ' + c.a.hp);
  check('só a favor: quem lança fora da área não ganha nada', c.h.hp === hp0.h, hp0.h + ' → ' + c.h.hp);
})();

/* 5. A cravada: a invocação nasce no centro e o golpe dela (400) não a mata;
 *    o boneco do lado apanha. */
(function () {
  const c = cena(E, 'invocador');
  const ok = lanca(E, c, 'pe-cravada', 6, 4);
  const idolo = c.st.units.find((u) => u.defId === 'fus-wall-watcher');
  check('cravada: o lance sai e o ídolo nasce', ok === true && !!idolo);
  check('cravada: o golpe da cravada não mata o próprio ídolo (a Sentinela matava)', !!idolo && idolo.alive, idolo && idolo.hp);
  check('cravada: o boneco ao lado apanha', c.a.hp < 900, c.a.hp);
  check('cravada: o parceiro ao lado não apanha', c.p.hp === c.p.hpMax - 40, c.p.hp);
})();

/* 6. A armadilha ao pé do muro (Muro em Brasa, minotauro-fogo-5: muro e
 *    brasa na mesma casa única). */
(function () {
  function muroEm(bloqueiaNorte) {
    const c = cena(E, 'minotauro');
    if (bloqueiaNorte) c.st.grid.tiles[3][3].type = 'wall';
    const antes = c.st.traps.length;
    const ok = lanca(E, c, 'minotauro-fogo-5', 3, 4);
    const novas = c.st.traps.slice(antes);
    return { ok, muro: c.st.grid.tiles[4][3].type, novas: novas.map((t) => t.x + ',' + t.y + ':' + t.trapId) };
  }
  const r = muroEm(false);
  check('Muro em Brasa: a casa vira muro', r.ok === true && r.muro === 'wall', JSON.stringify(r));
  check('Muro em Brasa: a brasa fica ao pé, na vizinha do NORTE (antes sumia em cima da pedra)',
    r.novas.length === 1 && r.novas[0] === '3,3:trap-fogo-brasa', JSON.stringify(r.novas));
  const r2 = muroEm(true);
  check('Muro em Brasa: com o norte fechado, a brasa vai para o SUL (ordem fixa, o juiz refaz igual)',
    r2.novas.length === 1 && r2.novas[0] === '3,5:trap-fogo-brasa', JSON.stringify(r2.novas));
})();

/* 7. O preço no próprio corpo. */
(function () {
  for (const [classe, id, nome] of [['sumo', 'sumo-fogo-15', 'Sangue Fervente'], ['espadachim', 'espadachim-fogo-12', 'Veias em Chamas']]) {
    const c = cena(E, classe);
    const ok = lanca(E, c, id, c.h.x, c.h.y);
    const quei = c.h.effects.find((e) => e.type === 'poison');
    check(nome + ': o bônus de poder entra', ok === true && c.h.effects.some((e) => e.type === 'buff' && e.stat === 'power'));
    check(nome + ': a queimadura própria que a descrição promete pega quem lança', !!quei && quei.sourceUid === c.h.uid,
      JSON.stringify(c.h.effects.map((e) => e.type)));
  }
  // a área em volta do corpo segue sem ferir quem lança
  const c = cena(E, 'sumo');
  c.a.x = 3; c.a.y = 3;            // encostado em quem lança
  c.p.x = 9; c.p.y = 1;
  const hp0 = c.h.hp, hpA = c.a.hp;
  const ok = lanca(E, c, 'sumo-fogo-12', c.h.x, c.h.y);
  check('área em volta do corpo (sumo-fogo-12): o boneco encostado apanha e quem lança não',
    ok === true && c.a.hp < hpA && c.h.hp >= hp0, 'lance ' + ok + ' · boneco ' + hpA + '→' + c.a.hp + ' · quem lança ' + hp0 + '→' + c.h.hp);
})();

/* 8. A IA: o muro que corta a visão de quem atira, e o salto para chegar. */
(function () {
  // o Minotauro só com a Primeira Pedra, e um atirador que o vê em linha reta
  const st = sala(E, 1, [{ classId: 'minotauro', heroId: 'h1', level: 5 }]);
  const h = st.units.find((u) => u.kind === 'hero');
  const m = st.units.find((u) => u.defId === 'pe-atirador');
  ateAVezDe(E, st, h);
  h.x = 2; h.y = 3; m.x = 10; m.y = 3;
  h.spells = ['minotauro-neutro-3']; h.pa = 6; h.pp = 0; h.castsThisTurn = {}; h.cooldowns = {};
  const plano = AI.planTurn(st, h.uid);
  const muro = plano.find((a) => a.action === 'cast' && a.spellId === 'minotauro-neutro-3');
  check('IA: o Minotauro ergue a Primeira Pedra entre ele e o atirador (o muro valia zero)', !!muro, JSON.stringify(plano));
  if (muro) {
    const t = st.grid.tiles[muro.y][muro.x].type;
    st.grid.tiles[muro.y][muro.x].type = 'wall';
    check('IA: a pedra que ela escolhe corta a visão do atirador', !E.los(st, m.x, m.y, h.x, h.y), muro.x + ',' + muro.y);
    st.grid.tiles[muro.y][muro.x].type = t;
  }
  check('IA: planejar não deixa muro na grade (a função continua pura)',
    st.grid.tiles.every((linha, y) => linha.every((c, x) => c.type !== 'wall' || x === 0 || y === 0 || x === 12 || y === 6)));
})();
(function () {
  const st = sala(E, 0, [{ classId: 'espadachim', heroId: 'h1', level: 12 }]);
  const h = st.units.find((u) => u.kind === 'hero');
  const a = st.units.find((u) => u.defId === 'pe-alvo');
  const b = st.units.find((u) => u.defId === 'pe-alvo2');
  ateAVezDe(E, st, h);
  h.x = 1; h.y = 1; a.x = 7; a.y = 4; b.x = 11; b.y = 5;
  // só o Passo do Vento e o golpe de perto; sem PP, só o salto aproxima
  h.spells = ['espadachim-ar-10', 'espadachim-neutro-1']; h.pa = 6; h.pp = 0; h.castsThisTurn = {}; h.cooldowns = {};
  const plano = AI.planTurn(st, h.uid);
  check('IA: o Ladino sem passo salta com o Passo do Vento para perto do alvo (o teleporte valia zero)',
    plano.some((x) => x.action === 'cast' && x.spellId === 'espadachim-ar-10'), JSON.stringify(plano));
})();

/* 9. O MURO QUE FERE QUEM ENCOSTA (03/10, a escolha do dono para o Minotauro —
 *    docs/EQUILIBRIO.md §3.6; engine.js, "O MURO QUE FERE QUEM ENCOSTA"). */
function muroEm(st, x, y) { return st.walls.find((w) => w.x === x && w.y === y) || null; }
// encerra a vez de `u` (as dos outros passam antes, sem jogar) e devolve os eventos dela
function fechaAVezDe(st, u) {
  ateAVezDe(E, st, u);
  E.events.length = 0;
  E.endTurn(st);
  const evs = E.events.slice();
  E.events.length = 0;
  return evs;
}
const doMuro = (evs, u) => evs.filter((e) => e.type === 'muroFere' && e.uid === u.uid);

// 9a. Os dados: todo muro do Minotauro e das fusões dele tem espinhos, com o número na descrição
(function () {
  const comMuro = (sp) => (sp.effects || []).some((e) => e.type === 'wall');
  const muroDe = (sp) => sp.effects.find((e) => e.type === 'wall');
  const daClasse = Object.keys(D.spells).filter((id) => D.spells[id].classId === 'minotauro' && comMuro(D.spells[id]));
  const fora = [];
  ['spells', 'monsterSpells', 'petSpells', 'itemSpells'].forEach((t) => Object.keys(D[t] || {}).forEach((id) => {
    const sp = D[t][id];
    if (comMuro(sp) && sp.classId !== 'minotauro') fora.push(t + ':' + id);
  }));
  check('muro só existe no Minotauro (feitiço de classe): nenhum monstro, pet ou item ergue muro', fora.length === 0, fora.join(', '));
  check('o Minotauro tem os seus treze feitiços de muro', daClasse.length === 13, daClasse.length);
  const semEspinho = daClasse.filter((id) => !(muroDe(D.spells[id]).fere > 0));
  check('todo muro do Minotauro tem espinhos (fere > 0)', semEspinho.length === 0, semEspinho.join(', '));
  const numeros = Array.from(new Set(daClasse.map((id) => muroDe(D.spells[id]).fere)));
  check('os espinhos são um número só para a classe toda (o texto e a régua dizem um)', numeros.length === 1, numeros.join(', '));
  const N = numeros[0];
  const FRASE = 'Os espinhos ferem ' + N + ' o inimigo que terminar a vez encostado ou for jogado contra a pedra.';
  const semTexto = daClasse.filter((id) => (D.spells[id].description || '').indexOf(FRASE) < 0);
  check('a descrição de cada feitiço de muro diz a regra com o número certo ("' + FRASE + '")',
    semTexto.length === 0, semTexto.join(', '));
  // as formas de fusão com muro: todas de dupla do Minotauro, todas com o mesmo número de base
  const formas = [];
  Object.keys(D.fusionForms).forEach((par) => D.fusionForms[par].forEach((f) => {
    const w = (f.mechanic || []).find((e) => e.type === 'wall');
    if (w) formas.push({ par, nome: f.formName, fere: w.fere });
  }));
  check('as formas de fusão com muro são todas de dupla do Minotauro', formas.length > 0 && formas.every((f) => f.par.split('+').indexOf('minotauro') >= 0),
    formas.filter((f) => f.par.indexOf('minotauro') < 0).map((f) => f.nome).join(', '));
  check('todo muro de fusão do Minotauro tem os mesmos espinhos de base da classe', formas.every((f) => f.fere === N),
    formas.filter((f) => f.fere !== N).map((f) => f.nome + '=' + f.fere).join(', '));
  // o espinho da fusão é o MESMO da classe: não passa pelo fator da forma (o PAIR_TUNE chega a 3,1 e a
  // pedra feriria 120 de base no nível 5) — o poder da fusão entra na hora de erguer, como em todo muro
  const fs = [];
  Object.keys(D.fusionForms).filter((par) => par.indexOf('minotauro') >= 0).forEach((par) => [5, 12, 30].forEach((nv) => {
    J.Fusion.spellsFor(par, 'terra+fogo', nv).filter((sp) => comMuro(sp)).forEach((sp) => fs.push(sp));
  }));
  check('o espinho do muro de fusão é o da classe em toda dupla e nível (o PAIR_TUNE não o toca)',
    fs.length > 0 && fs.every((sp) => muroDe(sp).fere === N), fs.filter((sp) => muroDe(sp).fere !== N).map((sp) => sp.id + '=' + muroDe(sp).fere).join(', '));
})();

// 9b. Quem termina a vez encostado se fere — só o outro lado, só de lado (não de quina), uma vez
(function () {
  const c = cena(E, 'minotauro');
  c.h.x = 4; c.h.y = 4; c.a.x = 6; c.a.y = 3; c.p.x = 7; c.p.y = 2; c.b.x = 7; c.b.y = 1;
  const ok = lanca(E, c, 'minotauro-neutro-3', 6, 2);        // a Primeira Pedra: vizinha norte do boneco a
  const w = muroEm(c.st, 6, 2);
  if (w) w.remaining = 99;                                    // a prova atravessa rodadas: a pedra fica
  const sp = D.spells['minotauro-neutro-3'];
  const esperado = E.fereDoMuro(c.st, c.h, sp, sp.effects.find((e) => e.type === 'wall'));
  check('espinhos: a pedra sobe com o dano congelado nela (o `fere` do feitiço vezes o poder de quem ergueu)',
    ok === true && !!w && w.fere === esperado && w.fere > sp.effects[0].fere - 1 && w.side === c.h.side, JSON.stringify(w));
  const hp = { a: c.a.hp, p: c.p.hp, b: c.b.hp, h: c.h.hp };
  const evA = fechaAVezDe(c.st, c.a);
  check('espinhos: o inimigo que termina a vez encostado (norte) leva o dano do muro, uma vez',
    doMuro(evA, c.a).length === 1 && hp.a - c.a.hp === w.fere && doMuro(evA, c.a)[0].motivo === 'encostou',
    (hp.a - c.a.hp) + ' contra ' + w.fere);
  const evB = fechaAVezDe(c.st, c.b);
  check('espinhos: encostado só de QUINA (diagonal) não se fere', doMuro(evB, c.b).length === 0 && c.b.hp === hp.b, hp.b + ' → ' + c.b.hp);
  const evP = fechaAVezDe(c.st, c.p);
  check('espinhos: o próprio lado encostado nunca se fere', doMuro(evP, c.p).length === 0 && c.p.hp === hp.p, hp.p + ' → ' + c.p.hp);
  // dois muros encostados: uma vez só, o que fere mais
  c.st.walls.push(Object.assign({}, w, { x: 5, y: 3, fere: w.fere + 7 }));
  c.st.grid.tiles[3][5].type = 'wall';
  const hp2 = c.a.hp;
  const evA2 = fechaAVezDe(c.st, c.a);
  check('espinhos: encostado em dois muros, fere UMA vez, o que fere mais', doMuro(evA2, c.a).length === 1 && hp2 - c.a.hp === w.fere + 7,
    (hp2 - c.a.hp) + ' contra ' + (w.fere + 7));
  check('espinhos: a previsão da IA e da tela (Engine.muroFerePrevisto) é o dano de verdade',
    E.muroFerePrevisto(c.st, c.a, c.a.x, c.a.y) === w.fere + 7 && E.muroFerePrevisto(c.st, c.a, 9, 5) === 0 &&
    E.muroFerePrevisto(c.st, c.p, c.p.x, c.p.y) === 0);
  // a resistência ao elemento do muro entra
  c.a.resists = Object.assign({}, c.a.resists, { neutro: 50 });
  check('espinhos: a resistência da vítima ao elemento do muro corta o dano', E.muroFerePrevisto(c.st, c.a, c.a.x, c.a.y) === Math.round((w.fere + 7) / 2),
    E.muroFerePrevisto(c.st, c.a, c.a.x, c.a.y));
  // o muro sem espinhos (feitiço que não declara `fere`) não fere
  c.a.resists.neutro = 0;
  c.st.walls.forEach((m) => { delete m.fere; });
  const hp3 = c.a.hp;
  const evA3 = fechaAVezDe(c.st, c.a);
  check('espinhos: muro sem `fere` é só pedra', doMuro(evA3, c.a).length === 0 && c.a.hp === hp3);
})();

// 9c. Jogado contra o muro: a colisão e os espinhos
(function () {
  const c = cena(E, 'minotauro');
  c.h.x = 4; c.h.y = 3; c.a.x = 5; c.a.y = 3; c.p.x = 2; c.p.y = 5; c.b.x = 11; c.b.y = 5;
  lanca(E, c, 'minotauro-neutro-3', 6, 3);                   // a pedra logo atrás do boneco
  const w = muroEm(c.st, 6, 3);
  E.events.length = 0;
  const ok = lanca(E, c, 'minotauro-neutro-1', 5, 3);         // a Marrada: golpe e 1 casa de empurrão
  const evs = E.events.slice();
  const fere = doMuro(evs, c.a), emp = evs.find((e) => e.type === 'pushed' && e.uid === c.a.uid);
  check('jogado contra o muro de espinhos: a colisão de sempre (10) E os espinhos',
    ok === true && !!w && !!emp && emp.collision === 10 && fere.length === 1 && fere[0].motivo === 'empurrado' && fere[0].amount === w.fere,
    JSON.stringify({ emp, fere }));
  // a mesma pedra, sendo do outro lado: só a colisão
  w.side = 'enemy';
  c.a.x = 5; c.a.y = 3;
  E.events.length = 0;
  lanca(E, c, 'minotauro-neutro-1', 5, 3);
  check('jogado contra o muro do PRÓPRIO lado: só a colisão, sem espinhos', doMuro(E.events, c.a).length === 0);
})();

// 9d. O invisível encostado sangra e continua sumido; o lance e o log levam o uid (a tela do outro lado cala)
(function () {
  const c = cena(E, 'minotauro');
  c.h.x = 4; c.h.y = 4; c.a.x = 6; c.a.y = 3; c.p.x = 2; c.p.y = 5; c.b.x = 11; c.b.y = 5;
  lanca(E, c, 'minotauro-neutro-3', 6, 2);
  const w = muroEm(c.st, 6, 2);
  if (w) w.remaining = 99;
  c.a.effects.push({ type: 'invisible', duration: 30, sourceUid: c.a.uid });
  const hp = c.a.hp;
  const evs = fechaAVezDe(c.st, c.a);
  const linha = evs.find((e) => e.type === 'log' && /espinhos/.test(e.text));
  check('invisível encostado: leva o dano e continua invisível (quem se fere não sai das sombras)',
    hp - c.a.hp === w.fere && E.unitHasEffect(c.a, 'invisible'), (hp - c.a.hp) + ' · ' + JSON.stringify(c.a.effects.map((e) => e.type)));
  check('invisível encostado: o evento e a linha do diário levam o uid dele (Game.eventoParaTela e o log calam para o outro lado)',
    doMuro(evs, c.a).length === 1 && doMuro(evs, c.a)[0].uid === c.a.uid && !!linha && linha.uid === c.a.uid &&
    evs.filter((e) => e.type === 'damage' && e.uid === c.a.uid).length === 1);
  // a IA do Minotauro não enxerga o invisível: nenhum valor de espinho por ele. O outro boneco sai de cena,
  // e a mesma cena com ele À VISTA é o controle (a pedra vai encostar nele)
  c.st.walls.length = 0; c.st.grid.tiles[2][6].type = 'floor';
  c.b.alive = false;
  ateAVezDe(E, c.st, c.h);
  c.h.x = 4; c.h.y = 4; c.a.x = 6; c.a.y = 3;
  c.h.spells = ['minotauro-neutro-3']; c.h.pa = 6; c.h.pp = 0; c.h.castsThisTurn = {}; c.h.cooldowns = {};
  c.a.ppMax = 0; c.a.pp = 0;
  const encosta = (pl) => pl.some((x) => x.action === 'cast' && Math.abs(x.x - c.a.x) + Math.abs(x.y - c.a.y) === 1);
  const sombra = c.a.effects.filter((e) => e.type === 'invisible');
  c.a.effects = c.a.effects.filter((e) => e.type !== 'invisible');
  const planoVisto = AI.planTurn(c.st, c.h.uid);
  c.a.effects = c.a.effects.concat(sombra);
  const planoOculto = AI.planTurn(c.st, c.h.uid);
  check('invisível: À VISTA e preso, a IA ergue a pedra encostada nele (o controle)', encosta(planoVisto), JSON.stringify(planoVisto));
  check('invisível: sumido, a IA do outro lado não ergue pedra para apertar quem ela não vê', !encosta(planoOculto), JSON.stringify(planoOculto));
})();

// 9e. A IA: quem anda evita terminar encostado; quem ergue aperta quem não pode sair
(function () {
  // um atirador que anda, encostado num muro de espinhos do herói, com tiro de qualquer casa por perto
  D.monsters['pe-andarilho'] = Object.assign({}, D.monsters['pe-atirador'], { id: 'pe-andarilho',
    stats: Object.assign({}, D.monsters['pe-atirador'].stats, { pp: 3 }) });
  const st = sala(E, 1, [{ classId: 'minotauro', heroId: 'h1', level: 12 }]);
  const h = st.units.find((u) => u.kind === 'hero');
  const m = st.units.find((u) => u.defId === 'pe-atirador');
  m.defId = 'pe-andarilho'; m.ppMax = 3;
  ateAVezDe(E, st, h);
  // o atirador já na distância ideal dele (10, o alcance do tiro): sem espinho, nada o tira do lugar
  h.x = 1; h.y = 1; m.x = 9; m.y = 3;
  // a pedra de espinhos do herói encostada no atirador (norte dele), posta à mão
  st.walls.push({ x: 9, y: 2, antes: 'floor', deco: false, ownerUid: h.uid, side: h.side, defId: h.defId, element: 'neutro', remaining: 3, fere: 20 });
  st.grid.tiles[2][9].type = 'wall'; st.grid.tiles[2][9].invocado = true;
  ateAVezDe(E, st, m);
  m.pp = 3; m.pa = 6;
  const plano = AI.planTurn(st, m.uid);
  const mv = plano.find((x) => x.action === 'move');
  const fim = mv ? { x: mv.x, y: mv.y } : { x: m.x, y: m.y };
  check('IA: o inimigo que pode sair NÃO termina a vez encostado no muro de espinhos',
    E.muroFerePrevisto(st, m, fim.x, fim.y) === 0, JSON.stringify(plano));
  // a mesma cena sem os espinhos: ele fica (parar custa menos e o tiro sai dali)
  delete st.walls[0].fere;
  const plano2 = AI.planTurn(st, m.uid);
  check('IA: sem os espinhos, a mesma pedra não o tira do lugar (é o espinho que pesa, não a pedra)',
    !plano2.some((x) => x.action === 'move'), JSON.stringify(plano2));
})();
(function () {
  // o Minotauro com a Primeira Pedra e dois bonecos presos (sem PP): a pedra entre os dois encosta nos dois
  const st = sala(E, 0, [{ classId: 'minotauro', heroId: 'h1', level: 12 }]);
  const h = st.units.find((u) => u.kind === 'hero');
  const a = st.units.find((u) => u.defId === 'pe-alvo'), b = st.units.find((u) => u.defId === 'pe-alvo2');
  ateAVezDe(E, st, h);
  h.x = 3; h.y = 3; a.x = 6; a.y = 3; b.x = 6; b.y = 5;
  h.spells = ['minotauro-neutro-3']; h.pa = 6; h.pp = 0; h.castsThisTurn = {}; h.cooldowns = {};
  const plano = AI.planTurn(st, h.uid);
  const muro = plano.find((x) => x.action === 'cast');
  check('IA: o Minotauro ergue a pedra onde aperta — encostada nos DOIS inimigos que não podem sair (6,4)',
    !!muro && muro.x === 6 && muro.y === 4, JSON.stringify(plano));
})();

(function () {
  // O APERTO: com a Primeira Pedra e a Marrada na mão, a pedra sobe ATRÁS do inimigo encostado e a Marrada o
  // joga nela — a jogada de gente com o Minotauro. O inimigo pode andar (o valor não vem de ele estar preso).
  const st = sala(E, 0, [{ classId: 'minotauro', heroId: 'h1', level: 12 }]);
  const h = st.units.find((u) => u.kind === 'hero');
  const a = st.units.find((u) => u.defId === 'pe-alvo'), b = st.units.find((u) => u.defId === 'pe-alvo2');
  ateAVezDe(E, st, h);
  h.x = 4; h.y = 3; a.x = 5; a.y = 3; a.ppMax = 3; b.x = 11; b.y = 5;
  h.spells = ['minotauro-neutro-3', 'minotauro-neutro-1']; h.pa = 6; h.pp = 0; h.castsThisTurn = {}; h.cooldowns = {};
  const plano = AI.planTurn(st, h.uid);
  const iMuro = plano.findIndex((x) => x.action === 'cast' && x.spellId === 'minotauro-neutro-3');
  const iMarrada = plano.findIndex((x) => x.action === 'cast' && x.spellId === 'minotauro-neutro-1');
  check('IA, o aperto: a pedra sobe ATRÁS do inimigo encostado (6,3) e ANTES da Marrada',
    iMuro >= 0 && iMarrada > iMuro && plano[iMuro].x === 6 && plano[iMuro].y === 3, JSON.stringify(plano));
  E.events.length = 0;
  plano.forEach((x) => { if (x.action === 'cast') E.cast(st, h.uid, x.spellId, x.x, x.y); });
  check('IA, o aperto: jogado como planejado, o inimigo bate nos espinhos',
    E.events.some((e) => e.type === 'muroFere' && e.uid === a.uid && e.motivo === 'empurrado'));
})();

// 9e'. O pet também termina a vez dele: preso ao lado da pedra do outro lado, se fere; podendo sair, sai
(function () {
  const st = sala(E, 0, [{ classId: 'sumo', heroId: 'h1', level: 12, pet: 'pet-lodestone' }]);
  const h = st.units.find((u) => u.kind === 'hero');
  const pet = st.units.find((u) => u.kind === 'pet');
  const a = st.units.find((u) => u.defId === 'pe-alvo'), b = st.units.find((u) => u.defId === 'pe-alvo2');
  check('pet: a sala de prova tem o pet do herói', !!pet, st.units.map((u) => u.kind).join(','));
  if (!pet) return;
  ateAVezDe(E, st, h);
  h.x = 3; h.y = 3; pet.x = 4; pet.y = 3; a.x = 10; a.y = 5; b.x = 11; b.y = 1;
  // uma pedra de espinhos do OUTRO lado (o lado dos bonecos), encostada no pet (norte dele)
  st.walls.push({ x: 4, y: 2, antes: 'floor', deco: false, ownerUid: a.uid, side: a.side, defId: a.defId, element: 'neutro', remaining: 9, fere: 25 });
  st.grid.tiles[2][4].type = 'wall'; st.grid.tiles[2][4].invocado = true;
  const ppMax0 = pet.ppMax;
  pet.ppMax = 0;                                  // preso: a vez dele acaba ali
  const hp = pet.hp;
  E.events.length = 0;
  E.endTurn(st);                                  // a vez do dono acaba; o pet age logo depois
  const f = E.events.filter((e) => e.type === 'muroFere' && e.uid === pet.uid);
  check('pet: preso ao lado da pedra do outro lado, se fere no fim da vez dele', f.length === 1 && hp - pet.hp === 25, (hp - pet.hp) + ' · ' + JSON.stringify(f));
  // podendo andar, o pet não termina encostado (a pedra fica onde está)
  pet.ppMax = ppMax0 || 3; pet.x = 4; pet.y = 3;
  ateAVezDe(E, st, h);
  h.x = 3; h.y = 3;
  E.events.length = 0;
  E.endTurn(st);
  check('pet: podendo andar, não termina a vez encostado na pedra de espinhos',
    E.muroFerePrevisto(st, pet, pet.x, pet.y) === 0 && !E.events.some((e) => e.type === 'muroFere' && e.uid === pet.uid),
    pet.x + ',' + pet.y);
})();

// 9f. O Eco (corpo 2×2): encosta por qualquer casa, de quina não, e não é jogado contra a pedra
(function () {
  const W2 = mundo(['js/core/progress.js']);
  const J2 = W2.JOGO, E2 = J2.Engine;
  const st = E2.createBattle(J2.DATA.eco.arena, 0, [{ classId: 'minotauro', heroId: 'h1', level: 30, element: 'terra' }],
    { seed: 11, escolhePosicao: false });
  st.phase = 'playing';
  const eco = E2.findUnit(st, st.eco.uid);
  const h = st.units.find((u) => u.kind === 'hero');
  for (let i = 0; i < 40 && E2.activeUnit(st) !== h; i++) E2.endTurn(st);
  h.x = eco.x + 4; h.y = eco.y + 1; h.pa = 30; h.castsThisTurn = {}; h.cooldowns = {};
  if (h.spells.indexOf('minotauro-neutro-3') < 0) h.spells.push('minotauro-neutro-3');
  // a pedra a leste da casa (x+1, y+1) do Eco — encosta na casa de baixo à direita
  const okC = E2.cast(st, h.uid, 'minotauro-neutro-3', eco.x + 2, eco.y + 1);
  h.castsThisTurn = {}; h.cooldowns = {};
  // e uma na QUINA (x+2, y+2): não encosta
  const ok2 = E2.cast(st, h.uid, 'minotauro-neutro-3', eco.x + 2, eco.y + 2);
  const prev = E2.muroFerePrevisto(st, eco, eco.x, eco.y);
  const dano0 = st.eco.dano, hp0 = eco.hp;
  for (let i = 0; i < 40 && E2.activeUnit(st) !== eco; i++) E2.endTurn(st);
  E2.events.length = 0;
  E2.endTurn(st);
  const f = E2.events.filter((e) => e.type === 'muroFere' && e.uid === eco.uid);
  check('Eco 2×2: a pedra encostada numa casa dele fere no fim da vez dele, uma vez (a da quina não soma)',
    okC === true && ok2 === true && prev > 0 && f.length === 1 && f[0].amount === prev && hp0 - eco.hp === prev, JSON.stringify(f));
  check('Eco 2×2: o placar conta o dano do muro do herói (a fonte é quem ergueu)', st.eco.dano - dano0 === prev, (st.eco.dano - dano0) + ' contra ' + prev);
})();

// 9g. O juiz: a mesma semente com os mesmos lances chega ao mesmo fim, com espinhos no meio
(function () {
  function joga() {
    const W3 = mundo(['js/core/progress.js']);
    const J3 = W3.JOGO, E3 = J3.Engine, A3 = J3.AI, B3 = require(path.join(__dirname, 'equilibrio_bancada.js')).cria(J3);
    const st = E3.createDuelSala('praca', 0, [B3.heroi('minotauro', 'terra', 30)], [B3.heroi('espadachim', 'fogo', 30)], { seed: 'espinhos' });
    let fere = 0, guarda = 0;
    while (st.phase === 'playing' && guarda++ < 400) {
      const u = E3.activeUnit(st);
      const plano = A3.planTurn(st, u.uid);
      for (const a of plano) {
        if (st.phase !== 'playing') break;
        if (a.action === 'move') E3.move(st, u.uid, a.x, a.y);
        else if (a.action === 'cast') E3.cast(st, u.uid, a.spellId, a.x, a.y);
        else break;
      }
      if (st.phase === 'playing') E3.endTurn(st);
      fere += E3.events.filter((e) => e.type === 'muroFere').length;
      E3.events.length = 0;
    }
    return { hash: E3.hash(st), fase: st.phase, rodada: st.round, fere };
  }
  const r1 = joga(), r2 = joga();
  check('juiz: duas partidas da mesma semente com o Minotauro chegam ao MESMO hash (o espinho não sorteia nada)',
    r1.hash === r2.hash && r1.fase === r2.fase && r1.rodada === r2.rodada, JSON.stringify([r1, r2]));
})();

console.log('\n' + (total - falhas) + ' / ' + total + ' passaram');
process.exitCode = falhas ? 1 : 0;
