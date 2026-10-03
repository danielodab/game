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

console.log('\n' + (total - falhas) + ' / ' + total + ' passaram');
process.exitCode = falhas ? 1 : 0;
