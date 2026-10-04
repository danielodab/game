#!/usr/bin/env node
'use strict';
/* PROVA DA LINHA DE VISÃO EM TODOS OS MAPAS (19/09, o dono: "revise sobre o campo
 * de visão dos ataques dos personagens, lembre-se que obstáculos atrapalham —
 * isso valide em todos os mapas").
 *
 *   node tests/visao_mapas.js
 *
 * Roda sobre o motor do juiz (servidor/juiz/motor.js): o jogo inteiro em Node,
 * sem navegador. Para CADA sala de DATA.dungeons, DATA.especiais e DATA.arenas (e
 * os andares semeados do Poço) cobra a REGRA, não o número. As salas do Santuário
 * que têm pilar vivo entram DUAS vezes: com os pilares como nascem e trocados —
 * o muro que sobe e desce não pode abrir fresta em nenhuma das duas posições:
 *   · 0 vazamentos por muro reto — duas casas de chão em lados opostos de um '#'
 *     (reto, na vertical ou na diagonal exata) nunca se veem;
 *   · 0 pares assimétricos — Engine.los(A,B) === Engine.los(B,A) sempre;
 *   · 0 frestas de canto — nenhum traçado que passa dá passo diagonal entre dois
 *     '#' encostados pelo canto, e os dois chãos do quadrado 2×2 não se veem;
 *   · 0 pares ortogonais que cruzam SÓ '=' bloqueados — a cobertura baixa não
 *     tira a visão, só o dano;
 *   · a área não atravessa muro: círculo 3, cruz 2, anel 2, linha 5 e cone 3
 *     nunca têm casa sem Engine.los do centro do impacto, e a linha para no
 *     primeiro muro;
 *   · a cobertura −25% num caso construído (dano, evento com `coberto`/`reducao`,
 *     log; cura e corpo a corpo encostado não mudam);
 *   · Engine.casasSemVisao devolve exatamente o alcance menos a visão, com o muro;
 *   · o muro invocado fecha a visão enquanto vive e a devolve ao cair;
 *   · todo feitiço com alcance > 0 exige `los` (a única exceção nomeada é
 *     gm-julgamento) e nenhum feitiço nasce sem `range`;
 *   · a IA mira o chão entre dois heróis com uma área, e nenhuma conjuração que
 *     ela planeja é recusada por Engine.validTargetCell;
 *   · a versão das regras (Engine.VERSAO_REGRAS) é a que trouxe estas regras, e o
 *     juiz recusa um bilhete aberto sob outra versão ('regras-mudaram').
 * No fim imprime o EFEITO medido contra o traçado de um sentido só de antes. */
const path = require('path');
const { mundo } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'motor.js'));
const { refaz } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (extra !== undefined && !ok ? ' — ' + extra : ''));
}

const J = mundo([]).JOGO;
const D = J.DATA, E = J.Engine, AI = J.AI, Fusion = J.Fusion, Poco = J.Poco;
const classes = Object.keys(D.classes || {}).filter((c) => c !== 'gm');
const EXCECOES_LOS = { 'gm-julgamento': true };   // a arma do Mestre: global de propósito (gm.js)

function T(st, x, y) { return (x >= 0 && y >= 0 && x < st.grid.w && y < st.grid.h) ? st.grid.tiles[y][x].type : null; }
function md(ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); }
// o Bresenham de um sentido só (o traçado de ANTES de 19/09), para o caminho e para medir o efeito
function caminho(x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0; const p = [];
  for (;;) {
    p.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return p;
}
function losVelho(st, x0, y0, x1, y1) {
  const p = caminho(x0, y0, x1, y1);
  for (let i = 1; i < p.length - 1; i++) if (T(st, p[i][0], p[i][1]) === 'wall') return false;
  return true;
}
function espremePorCanto(st, x0, y0, x1, y1) {
  const p = caminho(x0, y0, x1, y1);
  for (let q = 1; q < p.length; q++) {
    const [px, py] = p[q], [qx, qy] = p[q - 1];
    if (px !== qx && py !== qy && T(st, qx, py) === 'wall' && T(st, px, qy) === 'wall') return true;
  }
  return false;
}

// ------------------------------------------------------------------ as salas
const salas = [];
(D.dungeons || []).forEach((dg) => (dg.rooms || []).forEach((r, i) => salas.push({ dg: dg.id, i, room: r, tipo: 'calabouço' })));
// 03/10: os calabouços especiais (o Santuário dos Elementos) moram fora de DATA.dungeons, mas são salas de
// calabouço como as outras: as mesmas réguas, e a da IA mais abaixo. Sala com pilar vivo entra de novo com os
// pilares TROCADOS (a outra metade do relógio): a régua vale nas duas posições do muro.
(D.especiais || []).forEach((dg) => (dg.rooms || []).forEach((r, i) => {
  salas.push({ dg: dg.id, i, room: r, tipo: 'calabouço' });
  const pos = J.Santuario && J.Santuario.posicoesDosPilares(r);
  if (pos && Object.keys(pos[0]).length) salas.push({ dg: dg.id, i, room: r, tipo: 'calabouço', pilares: pos[1] });
}));
(D.arenas || []).forEach((dg) => (dg.rooms || []).forEach((r, i) => salas.push({ dg: dg.id, i, room: r, tipo: 'arena' })));
check('há salas de calabouço e de arena para conferir', salas.length >= 18 && salas.some((s) => s.tipo === 'arena'),
      salas.length + ' salas');
function comPilares(s, st) {
  // os pilares na outra posição: a casa do pilar é muro de pé e chão baixo (js/core/santuario.js)
  if (s.pilares) Object.keys(s.pilares).forEach((k) => {
    const [x, y] = k.split(',').map(Number);
    st.grid.tiles[y][x].type = s.pilares[k] ? 'wall' : 'floor';
  });
  return st;
}
function montar(s) {
  const party = [{ classId: classes[0], heroId: 'h1' }];
  try { return comPilares(s, E.createBattle(s.dg, s.i, party, {})); } catch (e) {
    return E.createDuelSala(s.dg, s.i, [{ classId: classes[0], heroId: 'a1' }], [{ classId: classes[0], heroId: 'b1' }], {});
  }
}

const efeito = { pares: 0, viamAntes: 0, veemAgora: 0, deixaramDeSeVer: 0, cantosAntes: 0,
                 area: {} };
const AREAS = [['circle', 3], ['cross', 2], ['ring', 2]];
for (const s of salas) {
  const nome = s.dg + '#' + s.i + (s.pilares ? ' (pilares trocados)' : '');
  let st = null;
  try { st = montar(s); } catch (e) { st = null; }
  check(nome + ': a sala monta', !!(st && st.grid && st.units), st ? '' : 'não montou');
  if (!st) continue;
  const w = st.grid.w, h = st.grid.h;
  const chao = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (T(st, x, y) === 'floor') chao.push({ x, y });

  // (b) muro reto: chão | '#' | chão, nas quatro direções de reta
  let vazou = 0, paresReto = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (T(st, x, y) !== 'wall') continue;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const lim = (dx && dy) ? 4 : 8;
      for (let k = 1; k <= lim; k++) for (let m = 1; m + k <= lim; m++) {
        const ax = x - k * dx, ay = y - k * dy, bx = x + m * dx, by = y + m * dy;
        if (T(st, ax, ay) !== 'floor' || T(st, bx, by) !== 'floor') continue;
        paresReto++;
        if (E.los(st, ax, ay, bx, by) || E.los(st, bx, by, ax, ay)) vazou++;
      }
    }
  }
  check(nome + ': 0 vazamentos por muro reto (' + paresReto + ' pares)', vazou === 0, vazou + ' vazaram');

  // (g) simetria, (c) fresta de canto, (d) cobertura não tira visão — todo par de chão a 2..8
  let assim = 0, fresta = 0, coverBloq = 0, coverPares = 0, pares = 0, viamAntes = 0, veemAgora = 0, perderam = 0;
  for (let i = 0; i < chao.length; i++) for (let j = i + 1; j < chao.length; j++) {
    const A = chao[i], B = chao[j];
    const dist = md(A.x, A.y, B.x, B.y);
    if (dist < 2 || dist > 8) continue;
    pares++;
    const ida = E.los(st, A.x, A.y, B.x, B.y), volta = E.los(st, B.x, B.y, A.x, A.y);
    if (ida !== volta) assim++;
    if (ida && (espremePorCanto(st, A.x, A.y, B.x, B.y) || espremePorCanto(st, B.x, B.y, A.x, A.y))) fresta++;
    if (A.x === B.x || A.y === B.y) {
      const p = caminho(A.x, A.y, B.x, B.y); let cov = false, wall = false;
      for (let q = 1; q < p.length - 1; q++) { const t = T(st, p[q][0], p[q][1]); if (t === 'cover') cov = true; if (t === 'wall') wall = true; }
      if (cov && !wall) { coverPares++; if (!ida) coverBloq++; }
    }
    const antes = losVelho(st, A.x, A.y, B.x, B.y) || losVelho(st, B.x, B.y, A.x, A.y);
    if (antes) viamAntes++;
    if (ida) veemAgora++;
    if (antes && !ida) perderam++;
    if (antes && (espremePorCanto(st, A.x, A.y, B.x, B.y) || espremePorCanto(st, B.x, B.y, A.x, A.y))) efeito.cantosAntes++;
  }
  check(nome + ': 0 pares assimétricos (' + pares + ' pares)', assim === 0, assim + ' assimétricos');
  check(nome + ': 0 frestas de canto', fresta === 0, fresta + ' pares espremem entre dois muros');
  check(nome + ': 0 pares por "=" bloqueados (' + coverPares + ' pares)', coverBloq === 0, coverBloq + ' bloqueados');
  efeito.pares += pares; efeito.viamAntes += viamAntes; efeito.veemAgora += veemAgora; efeito.deixaramDeSeVer += perderam;

  // (c') o quadrado 2×2 com '#' numa diagonal e chão na outra: os dois chãos não se veem
  let quadrados = 0, quadradosAbertos = 0;
  for (let y = 0; y + 1 < h; y++) for (let x = 0; x + 1 < w; x++) {
    const a = T(st, x, y), b = T(st, x + 1, y + 1), c = T(st, x + 1, y), d = T(st, x, y + 1);
    let f1 = null, f2 = null;
    if (a === 'wall' && b === 'wall' && c === 'floor' && d === 'floor') { f1 = [x + 1, y]; f2 = [x, y + 1]; }
    else if (c === 'wall' && d === 'wall' && a === 'floor' && b === 'floor') { f1 = [x, y]; f2 = [x + 1, y + 1]; }
    if (!f1) continue;
    quadrados++;
    if (E.los(st, f1[0], f1[1], f2[0], f2[1])) quadradosAbertos++;
  }
  check(nome + ': os cantos 2×2 fecham (' + quadrados + ' quadrados)', quadradosAbertos === 0, quadradosAbertos + ' abertos');

  // a área não atravessa muro: toda casa da área tem visão do centro
  let areaAtras = 0, areaCasas = 0, linhaPassaMuro = 0;
  for (const c of chao) {
    for (const [shape, size] of AREAS) {
      const ts = E.aoeTiles(st, { id: 'prova', aoe: { shape, size } }, c.x, c.y, c.x, c.y);
      const k = shape + size; efeito.area[k] = efeito.area[k] || { casas: 0 };
      efeito.area[k].casas += ts.length;
      for (const t of ts) { areaCasas++; if (!(t.x === c.x && t.y === c.y) && !E.los(st, c.x, c.y, t.x, t.y)) areaAtras++; }
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cx = c.x - 3 * dx, cy = c.y - 3 * dy;
      if (T(st, cx, cy) !== 'floor' || !E.los(st, cx, cy, c.x, c.y)) continue;
      for (const [shape, size] of [['line', 5], ['cone', 3]]) {
        const ts = E.aoeTiles(st, { id: 'prova', aoe: { shape, size } }, cx, cy, c.x, c.y);
        const k = shape + size; efeito.area[k] = efeito.area[k] || { casas: 0 };
        efeito.area[k].casas += ts.length;
        for (const t of ts) { areaCasas++; if (!(t.x === c.x && t.y === c.y) && !E.los(st, c.x, c.y, t.x, t.y)) areaAtras++; }
        if (shape === 'line') {
          // a linha para no primeiro muro: nenhuma casa depois de um '#' no eixo
          let muro = false;
          for (let i = 1; i < size; i++) {
            const lx = c.x + i * dx, ly = c.y + i * dy;
            if (T(st, lx, ly) === 'wall') muro = true;
            else if (muro && ts.some((t) => t.x === lx && t.y === ly)) linhaPassaMuro++;
          }
        }
      }
    }
  }
  check(nome + ': a área não atravessa muro (' + areaCasas + ' casas de área)', areaAtras === 0, areaAtras + ' casas sem visão do centro');
  check(nome + ': a linha para no primeiro muro', linhaPassaMuro === 0, linhaPassaMuro + ' casas depois do muro');
}

// o Poço: andares semeados são salas reais (já cobertas acima). 02/10: o chefe
// e o colosso ganham casa com LETRA PRÓPRIA (js/core/poco.js) — o que a visão
// precisa é o TERRENO da sala real, então as letras de monstro viram uma só
if (Poco && Poco.salaSemeada) {
  const terreno = (layout) => layout.join('\n').replace(/[a-z]/g, 'm');
  const reais = new Set(salas.map((s) => terreno(s.room.layout)));
  let andares = 0, estranhos = 0;
  for (let andar = 1; andar <= 10; andar++) {
    const s = Poco.salaSemeada(andar, 12345 + andar);
    if (!s || !s.layout) continue;
    andares++;
    if (!reais.has(terreno(s.layout))) estranhos++;
  }
  check('o Poço: ' + andares + ' andares semeados, todos com o palco de uma sala real', andares === 10 && estranhos === 0,
        estranhos + ' andares com palco que não é de sala real');
}

// ------------------------------------------------------------------ o caso construído
/* Uma sala de prova: mureta '=' na linha do tiro, um canto diagonal de '#', e o
 * alvo encostado na mureta. Os feitiços são sintéticos (o id 'pv-') e entram
 * na unidade à mão, como a suíte do motor faz. */
D.monsters['pv-alvo'] = { id: 'pv-alvo', name: 'Alvo', family: 'Prova', element: 'neutro', description: 'prova',
  stats: { hp: 1000, pa: 6, pp: 0, initiative: 1, power: 0, dodge: 0, lock: 0, resists: { neutro: 0, fogo: 0, agua: 0, terra: 0, ar: 0 } },
  spells: [], ai: 'melee', traits: [], boss: false };
D.monsters['pv-bombardeiro'] = { id: 'pv-bombardeiro', name: 'Bombardeiro', family: 'Prova', element: 'neutro', description: 'prova',
  stats: { hp: 1000, pa: 6, pp: 0, initiative: 200, power: 0, dodge: 0, lock: 0, resists: { neutro: 0, fogo: 0, agua: 0, terra: 0, ar: 0 } },
  spells: ['pv-bola'], ai: 'ranged', traits: [], boss: false };
function sp(id, over) {
  const s = { id, name: id, element: 'neutro', classId: null, unlockLevel: 0, paCost: 1, cooldown: 0, castsPerTurn: 0,
    range: { min: 1, max: 8, line: false, los: true }, aoe: { shape: 'single', size: 0 }, needsEmptyTile: false,
    targetSide: 'any', effects: [], description: 'prova', flavor: '', fxKey: 'slam' };
  Object.assign(s, over);
  D.spells[id] = s;
  return s;
}
sp('pv-tiro', { effects: [{ type: 'damage', element: 'neutro', min: 20, max: 20 }] });
sp('pv-cura', { effects: [{ type: 'heal', min: 20, max: 20 }] });
sp('pv-bola', { paCost: 2, targetSide: 'enemy', range: { min: 1, max: 6, line: false, los: true },
  aoe: { shape: 'circle', size: 1 }, effects: [{ type: 'damage', element: 'neutro', min: 10, max: 10 }] });
D.dungeons.push({
  id: 'prova-visao', name: 'Prova da Visão', theme: 'prova', description: 'prova', difficulty: 1, order: 99, palette: {},
  defaultWeather: 'calmo', weatherShiftEveryRounds: 0, tileEventRate: 0, lootTable: [], cardDrops: [],
  rooms: [{ name: 'mureta e canto', weather: 'calmo', sceneryTheme: 'prova', layout: [
    '###########',
    '#P..=a....#',
    '#.........#',
    '#..#......#',
    '#...#.....#',
    '#.........#',
    '###########'], monsters: { a: 'pv-alvo' } },
  { name: 'dois heróis e o chão', weather: 'calmo', sceneryTheme: 'prova', layout: [
    '###########',
    '#....a....#',
    '#.........#',
    '#.........#',
    '#.........#',
    '#..P.P....#',
    '###########'], monsters: { a: 'pv-bombardeiro' } }]
});
function evento(evs, tipo, pred) { return evs.find((e) => e.type === tipo && (!pred || pred(e))) || null; }
(function () {
  const st = E.createBattle('prova-visao', 0, [{ classId: classes[0], heroId: 'h1' }], { seed: 7, escolhePosicao: false });
  const h = st.units.find((u) => u.kind === 'hero'), a = st.units.find((u) => u.defId === 'pv-alvo');
  check('caso construído: herói em (1,1) e alvo em (5,1), mureta em (4,1)',
        h && a && h.x === 1 && h.y === 1 && a.x === 5 && a.y === 1 && T(st, 4, 1) === 'cover',
        JSON.stringify({ h: h && [h.x, h.y], a: a && [a.x, a.y], t: T(st, 4, 1) }));
  st.phase = 'playing';
  h.spells.push('pv-tiro', 'pv-cura');
  function tiro(feitico, tx, ty) {
    h.pa = 10; h.castsThisTurn = {}; E.events.length = 0;
    const ok = E.cast(st, h.uid, feitico, tx, ty);
    const evs = E.events.slice();
    return { ok, dano: evento(evs, 'damage', (e) => e.uid === a.uid), cura: evento(evs, 'heal', (e) => e.uid === a.uid),
             log: evs.filter((e) => e.type === 'log').map((e) => e.text).join(' | ') };
  }
  // o mesmo tiro sem mureta no caminho: o alvo um passo à frente (a mureta deixa de ser a última casa)
  a.x = 6;
  const livre = tiro('pv-tiro', 6, 1);
  check('sem cobertura: o tiro acerta cheio', livre.ok && livre.dano && livre.dano.amount > 0 && !livre.dano.coberto, JSON.stringify(livre.dano));
  const base = livre.dano ? livre.dano.amount : 0;
  a.x = 5;
  check('Engine.coberto: alvo encostado na mureta, traçado entra por ela', E.coberto(st, 1, 1, 5, 1) === true);
  check('Engine.coberto: um passo depois da mureta não é cobertura', E.coberto(st, 1, 1, 6, 1) === false);
  const cob = tiro('pv-tiro', 5, 1);
  const esperado = Math.max(1, Math.floor(base * 0.75));
  check('com cobertura: −25% arredondado para baixo (' + base + ' → ' + esperado + ')',
        cob.ok && cob.dano && cob.dano.amount === esperado && cob.dano.coberto === true && cob.dano.reducao === base - esperado,
        JSON.stringify(cob.dano));
  check('o log do motor diz "cobertura −25%"', /cobertura −25%/.test(cob.log), cob.log);
  const cura = tiro('pv-cura', 5, 1);
  check('a cura não muda com a cobertura', cura.ok && cura.cura && cura.cura.amount === 20 && !cura.cura.coberto, JSON.stringify(cura.cura));
  // corpo a corpo encostado: o traçado não cruza casa nenhuma
  h.x = 5; h.y = 2;
  check('Engine.coberto: corpo a corpo encostado nunca é coberto', E.coberto(st, 5, 2, 5, 1) === false);
  const perto = tiro('pv-tiro', 5, 1);
  check('corpo a corpo encostado acerta cheio', perto.ok && perto.dano && perto.dano.amount === base && !perto.dano.coberto, JSON.stringify(perto.dano));
  // a cobertura tem de ser ORTOGONAL ao alvo: em diagonal não vale
  h.x = 1; h.y = 4; a.x = 5; a.y = 2;                    // o traçado (1,4)→(5,2) chega por (4,2) ou (4,3), nunca por (4,1)
  check('cobertura só ortogonal: mureta na diagonal do alvo não cobre', E.coberto(st, 1, 4, 5, 2) === false);
  h.x = 1; h.y = 1; a.x = 5; a.y = 1;
  // a fresta de canto: '#' em (3,3) e (4,4), chão em (4,3) e (3,4)
  check('fresta de canto: os dois chãos do quadrado não se veem', E.los(st, 4, 3, 3, 4) === false && E.los(st, 3, 4, 4, 3) === false);
  check('fresta de canto: a diagonal longa pelo vão também fecha', E.los(st, 5, 2, 2, 5) === false && E.los(st, 6, 1, 1, 6) === false);
  check('o muro reto bloqueia e a mureta não', E.los(st, 2, 3, 4, 3) === false && E.los(st, 3, 1, 5, 1) === true);
  // simetria exaustiva na sala de prova
  let assim = 0;
  for (let y1 = 0; y1 < st.grid.h; y1++) for (let x1 = 0; x1 < st.grid.w; x1++) for (let y2 = 0; y2 < st.grid.h; y2++) for (let x2 = 0; x2 < st.grid.w; x2++) {
    if (T(st, x1, y1) !== 'floor' || T(st, x2, y2) !== 'floor') continue;
    if (E.los(st, x1, y1, x2, y2) !== E.los(st, x2, y2, x1, y1)) assim++;
  }
  check('simetria exaustiva na sala de prova', assim === 0, assim + ' pares');
  // casasSemVisao: exatamente o alcance (distância + linha) menos a visão, com o muro
  const alcance = E.spellRange(st, h.uid, 'pv-tiro');
  const semVisao = E.casasSemVisao(st, h.uid, 'pv-tiro');
  const chave = (c) => c.x + ',' + c.y;
  const vistos = new Set(alcance.map(chave)), cegos = new Set(semVisao.map(chave));
  let esperados = 0, cobertos = 0, muroTorto = 0, cruzam = 0;
  for (let y = 0; y < st.grid.h; y++) for (let x = 0; x < st.grid.w; x++) {
    if (T(st, x, y) !== 'floor') continue;
    const d = md(h.x, h.y, x, y);
    if (d < 1 || d > 8) continue;
    esperados++;
    if (vistos.has(x + ',' + y) || cegos.has(x + ',' + y)) cobertos++;
    if (vistos.has(x + ',' + y) && cegos.has(x + ',' + y)) cruzam++;
  }
  semVisao.forEach((c) => { if (!c.muro || T(st, c.muro.x, c.muro.y) !== 'wall' || E.los(st, h.x, h.y, c.x, c.y)) muroTorto++; });
  check('casasSemVisao ∪ spellRange = o alcance inteiro, sem cruzar (' + alcance.length + ' vistas + ' + semVisao.length + ' cegas)',
        semVisao.length > 0 && cobertos === esperados && cruzam === 0 && muroTorto === 0,
        JSON.stringify({ esperados, cobertos, cruzam, muroTorto }));
  check('casasSemVisao de feitiço sem `los` é vazio',
        E.casasSemVisao(st, h.uid, Object.assign({}, sp('pv-semlos', { range: { min: 1, max: 8, line: false, los: false } })).id).length === 0);
  // a área exceção: o Julgamento do Mestre atravessa (o id é a exceção nomeada)
  const julg = E.aoeTiles(st, { id: 'gm-julgamento', aoe: { shape: 'circle', size: 99 } }, 1, 1, 1, 1);
  const comum = E.aoeTiles(st, { id: 'pv-nova', aoe: { shape: 'circle', size: 99 } }, 1, 1, 1, 1);
  // (5,5) fica atrás dos dois '#' em diagonal: o Julgamento a pega, o feitiço comum não
  check('a área do gm-julgamento atravessa muro; a de um feitiço comum não', julg.length > comum.length &&
        julg.some((t) => t.x === 5 && t.y === 5) && !comum.some((t) => t.x === 5 && t.y === 5) &&
        comum.every((t) => (t.x === 1 && t.y === 1) || E.los(st, 1, 1, t.x, t.y)),
        julg.length + ' vs ' + comum.length);
  // o muro invocado: fecha a visão enquanto vive, devolve ao cair
  const antes = E.los(st, 1, 2, 6, 2);
  const cel = st.grid.tiles[2][3];
  st.walls.push({ x: 3, y: 2, antes: cel.type, deco: !!cel.deco, remaining: 2 }); cel.type = 'wall'; cel.invocado = true;
  const durante = E.los(st, 1, 2, 6, 2), alvoNoMuro = E.validTargetCell(st, h, D.spells['pv-tiro'], 3, 2);
  cel.type = st.walls[0].antes; cel.invocado = false; st.walls.length = 0;
  const depois = E.los(st, 1, 2, 6, 2);
  check('muro invocado: fecha a visão enquanto vive, não é alvo, devolve ao cair', antes && !durante && !alvoNoMuro && depois,
        JSON.stringify({ antes, durante, alvoNoMuro, depois }));
  // a armadilha no meio não bloqueia
  st.traps.push({ x: 2, y: 2, trapId: 'pv-tiro', ownerUid: h.uid, side: 'player', remaining: 3 });
  check('armadilha no caminho não bloqueia a visão', E.los(st, 1, 2, 6, 2) === true);
  st.traps.length = 0;
})();

// ------------------------------------------------------------------ a rodada de conserto (19/09)
/* Os achados da revisão: a cobertura cortava o dano CRU e o difícil multiplicava
 * depois (o log dizia −3 num tiro que perdera 5); o Salto de Brasa media a
 * cobertura da casa de onde partiu, não de onde caiu; o raio em cadeia saltava
 * por cima de muro e a explosão de morte feria através dele. */
D.monsters['pv-bomba'] = { id: 'pv-bomba', name: 'Bomba', family: 'Prova', element: 'neutro', description: 'prova',
  stats: { hp: 1000, pa: 6, pp: 0, initiative: 1, power: 0, dodge: 0, lock: 0, resists: { neutro: 0, fogo: 0, agua: 0, terra: 0, ar: 0 } },
  spells: [], ai: 'melee', traits: [{ type: 'explodeOnDeath', element: 'fogo', damage: 30, radius: 3 }], boss: false };
sp('pv-raio', { effects: [{ type: 'chain', jumps: 3, falloff: 1, element: 'neutro', min: 10, max: 10 }] });
sp('pv-mata', { effects: [{ type: 'damage', element: 'neutro', min: 100, max: 100 }] });
D.dungeons.find((d) => d.id === 'prova-visao').rooms.push({ name: 'raio e bomba', weather: 'calmo', sceneryTheme: 'prova', layout: [
    '###########',
    '#P..a#b...#',
    '#.........#',
    '#...c.....#',
    '###########'], monsters: { a: 'pv-bomba', b: 'pv-alvo', c: 'pv-alvo' } });
(function () {
  // a cobertura DEPOIS da dificuldade: o inimigo atira por cima da mureta, no difícil
  const st = E.createBattle('prova-visao', 0, [{ classId: classes[0], heroId: 'h1' }], { seed: 7, escolhePosicao: false });
  st.phase = 'playing'; st.dificuldade = 'dificil';
  const h = st.units.find((u) => u.kind === 'hero'), a = st.units.find((u) => u.defId === 'pv-alvo');
  const escala = E.dif(st).dano || 1;
  check('o difícil multiplica o dano do inimigo (' + escala + ')', escala > 1);
  a.spells.push('pv-tiro'); h.hp = 500; h.hpMax = 500;
  function tiroDoAlvo(tx, ty) {
    a.pa = 10; a.cooldowns = {}; a.castsThisTurn = {}; E.events.length = 0;
    const ok = E.cast(st, a.uid, 'pv-tiro', tx, ty);
    return { ok, dano: evento(E.events, 'damage', (e) => e.uid === h.uid), log: E.events.filter((e) => e.type === 'log').map((e) => e.text).join(' | ') };
  }
  a.x = 1; a.y = 1; h.x = 6; h.y = 1;                       // sem mureta na última casa: o dano escalado inteiro
  const cheio = tiroDoAlvo(6, 1);
  check('difícil, sem cobertura: o tiro leva a escala inteira', cheio.ok && cheio.dano && cheio.dano.amount > 10 && !cheio.dano.coberto, JSON.stringify(cheio.dano));
  h.x = 5;                                                  // encostado na mureta (4,1): coberto
  const cob = tiroDoAlvo(5, 1);
  const esc = cheio.dano ? cheio.dano.amount : 0, esperadoEsc = Math.max(1, Math.floor(esc * 0.75));
  check('difícil, com cobertura: o corte é sobre o dano já escalado (' + esc + ' → ' + esperadoEsc + ', −' + (esc - esperadoEsc) + ')',
        cob.ok && cob.dano && cob.dano.coberto === true && cob.dano.amount === esperadoEsc && cob.dano.reducao === esc - esperadoEsc,
        JSON.stringify(cob.dano));
  check('e o log diz o mesmo número que o evento', cob.dano && cob.log.indexOf('(−' + cob.dano.reducao + ')') >= 0, cob.log);
  // o Salto de Brasa (teleport > damage): o herói parte de (1,1), cai em (6,1) e bate em (5,1) encostado — sem cobertura
  st.dificuldade = 'normal';
  h.x = 1; h.y = 1; a.x = 5; a.y = 1; a.hp = 1000;
  h.spells.push('is-cinder-leap'); h.pa = 10; h.cooldowns = {}; h.castsThisTurn = {}; E.events.length = 0;
  const okL = E.cast(st, h.uid, 'is-cinder-leap', 6, 1);
  const dL = evento(E.events, 'damage', (e) => e.uid === a.uid);
  check('o Salto de Brasa bate de onde o herói CAIU: encostado, sem cobertura', okL && h.x === 6 && h.y === 1 && dL && dL.amount > 0 && !dL.coberto,
        JSON.stringify({ okL, h: [h.x, h.y], dL }));
})();
(function () {
  // o raio em cadeia e a explosão de morte: bomba em (4,1), '#' em (5,1), b em (6,1) atrás dele, c em (4,3) à vista
  const st = E.createBattle('prova-visao', 2, [{ classId: classes[0], heroId: 'h1' }], { seed: 7, escolhePosicao: false });
  st.phase = 'playing';
  const h = st.units.find((u) => u.kind === 'hero'), bomba = st.units.find((u) => u.defId === 'pv-bomba');
  const b = E.unitAt(st, 6, 1), c = E.unitAt(st, 4, 3);
  check('raio: a bomba em (4,1), b em (6,1) atrás do #, c em (4,3) à vista', bomba && bomba.x === 4 && bomba.y === 1 && b && c &&
        E.los(st, 4, 1, 6, 1) === false && E.los(st, 4, 1, 4, 3) === true, JSON.stringify({ bomba: bomba && [bomba.x, bomba.y], b: !!b, c: !!c }));
  h.spells.push('pv-raio', 'pv-mata'); h.pa = 10; h.cooldowns = {}; h.castsThisTurn = {}; E.events.length = 0;
  const okR = E.cast(st, h.uid, 'pv-raio', 4, 1);
  const saltos = E.events.filter((e) => e.type === 'chainHop').length;
  check('o raio não salta por cima do muro: b intacto, c ferido, 2 saltos (a bomba e c)', okR && b.hp === b.hpMax && c.hp < c.hpMax && saltos === 2,
        JSON.stringify({ okR, b: [b.hp, b.hpMax], c: [c.hp, c.hpMax], saltos }));
  bomba.hp = 5; const hb = b.hp, hc = c.hp;
  h.pa = 10; h.castsThisTurn = {}; E.events.length = 0;
  const okM = E.cast(st, h.uid, 'pv-mata', 4, 1);
  check('a explosão de morte não fere atrás do muro: a bomba morre, b intacto, c ferido', okM && !bomba.alive && b.hp === hb && c.hp < hc,
        JSON.stringify({ okM, viva: bomba.alive, b: [hb, b.hp], c: [hc, c.hp] }));
})();

// ------------------------------------------------------------------ de onde a cobertura é medida (a 2ª rodada, 19/09)
/* O achado: a cobertura dos saltos do raio e das casas da área era medida do
 * CONJURADOR, e a visão desses golpes é medida de outro lugar (a vítima
 * anterior; o centro do impacto). A mureta "errada" concedia ou negava os −25%:
 * o salto em linha reta saía coberto por uma mureta que só estava na linha do
 * conjurador, e uma mureta atrás de um '#' que o conjurador nem via cobria quem
 * a explosão alcançava por outro lado. Agora cada golpe mede da casa de onde a
 * visão dele é exigida. Quatro palcos: dois com a mureta fora da linha do golpe
 * (sem cobertura) e dois com ela entre o golpe e a vítima (−25%). */
sp('pv-bola2', { paCost: 2, targetSide: 'enemy', range: { min: 1, max: 6, line: false, los: true },
  aoe: { shape: 'circle', size: 2 }, effects: [{ type: 'damage', element: 'neutro', min: 20, max: 20 }] });
D.dungeons.find((d) => d.id === 'prova-visao').rooms.push(
  { name: 'raio: a mureta só na linha do conjurador', weather: 'calmo', sceneryTheme: 'prova', layout: [
    '#########',
    '#P..=b..#',
    '#.......#',
    '#....a..#',
    '#########'], monsters: { a: 'pv-alvo', b: 'pv-alvo' } },
  { name: 'raio: a mureta entre a vítima e o salto', weather: 'calmo', sceneryTheme: 'prova', layout: [
    '#########',
    '#P...b..#',
    '#....=..#',
    '#....a..#',
    '#########'], monsters: { a: 'pv-alvo', b: 'pv-alvo' } },
  { name: 'área: a mureta atrás do muro que o conjurador não vê', weather: 'calmo', sceneryTheme: 'prova', layout: [
    '#########',
    '#P.#=v..#',
    '#.......#',
    '#.......#',
    '#########'], monsters: { v: 'pv-alvo' } },
  { name: 'área: a mureta entre o centro e a vítima', weather: 'calmo', sceneryTheme: 'prova', layout: [
    '#########',
    '#P.#.v..#',
    '#....=..#',
    '#.......#',
    '#########'], monsters: { v: 'pv-alvo' } });
(function () {
  function palco(i, feitico, tx, ty) {
    const st = E.createBattle('prova-visao', i, [{ classId: classes[0], heroId: 'h1' }], { seed: 7, escolhePosicao: false });
    st.phase = 'playing';
    const h = st.units.find((u) => u.kind === 'hero');
    h.spells.push(feitico); h.pa = 10; h.cooldowns = {}; h.castsThisTurn = {}; E.events.length = 0;
    const ok = E.cast(st, h.uid, feitico, tx, ty);
    const dano = {};
    E.events.filter((e) => e.type === 'damage').forEach((e) => { dano[e.uid] = { amount: e.amount, coberto: !!e.coberto, reducao: e.reducao }; });
    return { st, h, ok, dano, de: (x, y) => E.unitAt(st, x, y) };
  }
  // (3) o raio: P(1,1) → a(5,3) → b(5,1). A mureta (4,1) está na linha P→b, não na do salto a→b (que sobe por (5,2))
  let r = palco(3, 'pv-raio', 5, 3);
  let a = r.de(5, 3), b = r.de(5, 1);
  check('raio: a mureta só na linha do conjurador — coberto(P→b) mas não coberto(a→b)',
        a && b && E.coberto(r.st, 1, 1, 5, 1) === true && E.coberto(r.st, 5, 3, 5, 1) === false);
  check('raio: o salto a→b sai da vítima anterior: b leva o golpe inteiro, sem cobertura',
        r.ok && r.dano[a.uid] && r.dano[a.uid].amount === 10 && !r.dano[a.uid].coberto &&
        r.dano[b.uid] && r.dano[b.uid].amount === 10 && !r.dano[b.uid].coberto, JSON.stringify(r.dano));
  // (4) a mureta (5,2) entre a(5,3) e b(5,1): o salto entra por ela — cobertura de verdade
  r = palco(4, 'pv-raio', 5, 3);
  a = r.de(5, 3); b = r.de(5, 1);
  check('raio: a mureta entre a vítima e o salto cobre o salto (10 → 7, −3) e o primeiro golpe não',
        r.ok && a && b && r.dano[a.uid] && r.dano[a.uid].amount === 10 && !r.dano[a.uid].coberto &&
        r.dano[b.uid] && r.dano[b.uid].amount === 7 && r.dano[b.uid].coberto === true && r.dano[b.uid].reducao === 3, JSON.stringify(r.dano));
  // (5) a área: P(1,1) não vê v(5,1) ('#' em (3,1)); o círculo 2 no chão (5,3) chega a v por (5,2), que é chão
  r = palco(5, 'pv-bola2', 5, 3);
  let v = r.de(5, 1);
  check('área: P não vê v, o centro vê; coberto(P→v) atravessa o muro, coberto(centro→v) não',
        v && E.los(r.st, 1, 1, 5, 1) === false && E.los(r.st, 5, 3, 5, 1) === true &&
        E.coberto(r.st, 1, 1, 5, 1) === true && E.coberto(r.st, 5, 3, 5, 1) === false);
  check('área: a vítima fora do centro mede do CENTRO do impacto: sem cobertura, 20 inteiros',
        r.ok && v && r.dano[v.uid] && r.dano[v.uid].amount === 20 && !r.dano[v.uid].coberto, JSON.stringify(r.dano));
  // (6) a mureta (5,2) entre o centro (5,3) e v(5,1): a explosão entra por ela — cobertura de verdade
  r = palco(6, 'pv-bola2', 5, 3);
  v = r.de(5, 1);
  check('área: a mureta entre o centro e a vítima cobre (20 → 15, −5)',
        r.ok && v && r.dano[v.uid] && r.dano[v.uid].amount === 15 && r.dano[v.uid].coberto === true && r.dano[v.uid].reducao === 5,
        JSON.stringify(r.dano));
  // e o alvo NA casa do centro segue medindo do conjurador: sala 0, P(1,1), mureta (4,1), alvo (5,1) — o círculo 2 em cima dele
  r = palco(0, 'pv-bola2', 5, 1);
  a = r.de(5, 1);
  check('área: quem está na casa do centro mede do conjurador (a mureta (4,1) cobre: 20 → 15)',
        r.ok && a && r.dano[a.uid] && r.dano[a.uid].amount === 15 && r.dano[a.uid].coberto === true, JSON.stringify(r.dano));
})();

// ------------------------------------------------------------------ a IA mira o chão
(function () {
  const st = E.createBattle('prova-visao', 1, [{ classId: classes[0], heroId: 'h1' }, { classId: classes[1 % classes.length], heroId: 'h2' }],
                            { seed: 3, escolhePosicao: false });
  st.phase = 'playing';
  const b = st.units.find((u) => u.defId === 'pv-bombardeiro');
  const hs = st.units.filter((u) => u.kind === 'hero');
  check('IA: o bombardeiro em (5,1) e os heróis em (3,5) e (5,5)',
        b && b.x === 5 && b.y === 1 && hs.length === 2 && hs.some((u) => u.x === 3 && u.y === 5) && hs.some((u) => u.x === 5 && u.y === 5),
        JSON.stringify({ b: b && [b.x, b.y], hs: hs.map((u) => [u.x, u.y]) }));
  b.pa = 6; b.pp = 0;
  const plano = AI.planTurn(st, b.uid) || [];
  const chao = plano.find((a) => a.action === 'cast' && a.spellId === 'pv-bola' && a.x === 4 && a.y === 5);
  check('IA: a área vai para o CHÃO entre os dois heróis (4,5), acertando os dois', !!chao, JSON.stringify(plano));
  if (chao) {
    check('IA: a conjuração no chão passa por Engine.validTargetCell', E.validTargetCell(st, b, D.spells['pv-bola'], 4, 5) === true);
    E.events.length = 0;
    const ok = E.cast(st, b.uid, 'pv-bola', 4, 5);
    const feridos = E.events.filter((e) => e.type === 'damage' && e.amount > 0).map((e) => e.uid);
    check('IA: a explosão no chão fere os dois heróis', ok && feridos.length === 2, JSON.stringify(feridos));
  }
})();
// e em TODAS as salas de calabouço: nenhuma conjuração planejada é recusada pelo motor nem mira sem visão
(function () {
  let planos = 0, casts = 0, invalidos = 0, semVisao = 0; const ex = [];
  for (const s of salas) {
    if (s.tipo !== 'calabouço' || s.pilares) continue;
    let st;
    try { st = E.createBattle(s.dg, s.i, classes.slice(0, 4).map((c, i) => ({ classId: c, heroId: 'h' + i, level: 20 })), { seed: 1 }); }
    catch (e) { continue; }
    st.phase = 'playing';
    for (let rodada = 0; rodada < 3; rodada++) {
      for (const u of st.units.slice()) {
        if (!u.alive || u.offBoard) continue;
        let plan; try { plan = AI.planTurn(st, u.uid); } catch (e) { continue; }
        planos++;
        let cx = u.x, cy = u.y;
        for (const p of plan) {
          if (p.action === 'move') { cx = p.x; cy = p.y; }
          if (p.action !== 'cast') continue;
          casts++;
          const ox = u.x, oy = u.y; u.x = cx; u.y = cy;
          const spd = E.spell(p.spellId);
          const ok = E.validTargetCell(st, u, spd, p.x, p.y);
          const vis = E.los(st, cx, cy, p.x, p.y);
          u.x = ox; u.y = oy;
          if (!ok) { invalidos++; if (ex.length < 3) ex.push(s.dg + '#' + s.i + ' ' + u.defId + ' ' + p.spellId + ' → (' + p.x + ',' + p.y + ')'); }
          if (!vis && spd && spd.range && spd.range.los) semVisao++;
        }
        const mv = plan.find((p) => p.action === 'move');
        if (mv && !E.unitAt(st, mv.x, mv.y)) { u.x = mv.x; u.y = mv.y; }
      }
    }
  }
  check('IA nas salas reais: ' + casts + ' conjurações em ' + planos + ' planos, 0 recusadas pelo motor e 0 sem visão',
        planos > 100 && invalidos === 0 && semVisao === 0, JSON.stringify({ invalidos, semVisao, ex }));
})();

// ------------------------------------------------------------------ os feitiços exigem visão
(function () {
  const fontes = { 'DATA.spells': D.spells, 'DATA.monsterSpells': D.monsterSpells, 'DATA.petSpells': D.petSpells,
                   'DATA.itemSpells': D.itemSpells, 'DATA.fusionSpells': D.fusionSpells };
  const fus = {};
  const elems = ['fogo', 'agua', 'terra', 'ar', 'neutro'];
  let formasSemRange = 0;
  Object.keys(D.fusionForms || {}).forEach((cp) => {
    (D.fusionForms[cp] || []).forEach((f) => { if (!f.range) formasSemRange++; });
    elems.forEach((a) => elems.forEach((b) => (Fusion.spellsFor(cp, a + '+' + b, 30) || []).forEach((s) => { fus[s.id] = s; })));
  });
  fontes['Fusion.spellsFor (21 pares × 25 misturas, nível 30)'] = fus;
  let n = 0, semRange = [], semLos = [], alc0 = 0;
  for (const nome in fontes) for (const id in (fontes[nome] || {})) {
    const s = fontes[nome][id]; if (!s || id.indexOf('pv-') === 0) continue;
    n++;
    if (!s.range) { semRange.push(nome + ':' + id); continue; }
    const max = s.range.max != null ? s.range.max : 1;
    if (max <= 0) { alc0++; continue; }
    if (s.range.los !== true && !EXCECOES_LOS[id]) semLos.push(nome + ':' + id);
  }
  check(n + ' feitiços de todas as fontes têm `range`', n > 3000 && semRange.length === 0, semRange.slice(0, 10).join(', '));
  check('todo feitiço com alcance > 0 exige los:true (exceção nomeada: gm-julgamento); ' + alc0 + ' são de alcance 0',
        semLos.length === 0, semLos.slice(0, 10).join(', '));
  check('nenhuma forma de fusão sem `range`', formasSemRange === 0, formasSemRange + ' formas');
  // 19/09 (a rodada de conserto): o padrão é lido de verdade (Engine.RANGE_PADRAO). Com max 1 o `los:true` não
  // decide nada hoje — casas encostadas sempre se veem, e a prova de antes passava com qualquer valor (o caso
  // "negativo" caía pela DISTÂNCIA). O que se cobra é o número, e que o feitiço sem `range` cubra exatamente o
  // chão a distância ≤ 1, sem casa nenhuma caindo pela visão; a IA e a fusão usam o mesmo objeto
  const p = E.RANGE_PADRAO;
  check('Engine.RANGE_PADRAO (feitiço sem `range`) é {min:0, max:1, line:false, los:true}',
        !!p && p.min === 0 && p.max === 1 && p.line === false && p.los === true, JSON.stringify(p));
  const st = E.createBattle('prova-visao', 0, [{ classId: classes[0], heroId: 'h1' }], { seed: 7, escolhePosicao: false });
  const h = st.units.find((u) => u.kind === 'hero');
  h.x = 2; h.y = 3;                                    // o '#' de (3,3) está encostado: é muro, não chão
  delete sp('pv-sem-range', { effects: [] }).range;
  const alc = E.spellRange(st, h.uid, 'pv-sem-range').map((c) => c.x + ',' + c.y).sort();
  const chao1 = [];
  for (let y = 0; y < st.grid.h; y++) for (let x = 0; x < st.grid.w; x++) if (T(st, x, y) === 'floor' && md(2, 3, x, y) <= 1) chao1.push(x + ',' + y);
  check('sem `range`: o alcance é exatamente o chão a distância ≤ 1 (' + chao1.length + ' casas; o # encostado fica fora)',
        chao1.length === 4 && JSON.stringify(alc) === JSON.stringify(chao1.sort()), JSON.stringify({ alc, chao1 }));
  check('sem `range`: nenhuma casa cai pela visão (casasSemVisao = [])', E.casasSemVisao(st, h.uid, 'pv-sem-range').length === 0);
  delete D.spells['pv-sem-range'];
})();

// ------------------------------------------------------------------ a versão das regras
check('Engine.VERSAO_REGRAS é a versão que trouxe estas regras (≥ 2)', typeof E.VERSAO_REGRAS === 'number' && E.VERSAO_REGRAS >= 2, String(E.VERSAO_REGRAS));
(function () {
  const dg = salas[0];
  const base = { dungeonId: dg.dg, roomIndex: dg.i, semente: 5, party: [{ classId: classes[0], heroId: 'h1' }], lances: [] };
  let outra = null, mesma = null, sem = null;
  try { refaz(Object.assign({}, base, { regras: E.VERSAO_REGRAS + 1 })); } catch (e) { outra = e; }
  try { mesma = refaz(Object.assign({}, base, { regras: E.VERSAO_REGRAS })); } catch (e) { mesma = { erro: e.message }; }
  try { sem = refaz(base); } catch (e) { sem = { erro: e.message }; }
  check("o juiz recusa o bilhete aberto sob outra versão de regras ('regras-mudaram')", !!(outra && outra.juiz && outra.motivo === 'regras-mudaram'),
        outra ? outra.message : 'não recusou');
  check('o juiz refaz o bilhete da mesma versão, e o bilhete sem versão (de antes)', !!(mesma && mesma.ok && sem && sem.ok),
        JSON.stringify({ mesma: mesma && (mesma.ok || mesma.erro), sem: sem && (sem.ok || sem.erro) }));
})();

// ------------------------------------------------------------------ o efeito medido
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
console.log('\nEFEITO MEDIDO (contra o traçado de um sentido só, de antes de 19/09):');
console.log('  pares de chão a 2–8: ' + efeito.pares + ' · viam-se antes (algum sentido): ' + efeito.viamAntes +
            ' · veem-se agora: ' + efeito.veemAgora + ' · deixaram de se ver: ' + efeito.deixaramDeSeVer +
            ' (' + pct(efeito.deixaramDeSeVer, efeito.viamAntes) + '), dos quais ' + efeito.cantosAntes + ' pela fresta de canto');
console.log('  casas de área (todas as salas, todo centro de chão): ' +
            Object.keys(efeito.area).map((k) => k + ' ' + efeito.area[k].casas).join(' · '));

console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
