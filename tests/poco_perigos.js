#!/usr/bin/env node
'use strict';
/* PROVA DO CHÃO DO POÇO E DOS COLOSSOS (02/10) — js/core/poco.js (Poco.regras).
 *
 *   node tests/poco_perigos.js
 *
 * Roda sobre o motor do juiz (servidor/juiz/motor.js): o jogo inteiro em Node.
 * Cobra a REGRA, não o número:
 *   · a semente decide tudo: o mesmo andar com a mesma semente é a mesma sala
 *     (palco, elenco, perigos, colosso) em mundos diferentes; outra semente muda;
 *   · posição válida: perigo só em chão comum, nunca em casa de monstro, nada
 *     do que ele alcança cai na ZONA DE ENTRADA (a do motor, state.placement),
 *     dois perigos não dividem casa, e a quantidade sobe com o andar;
 *   · o caminho sempre existe: com TODO chão rachado já caído, todo chão segue
 *     ligado a todo chão (o buraco nunca separa o mapa);
 *   · aviso antes do dano: todo disparo teve aviso da MESMA rodada-alvo, e toda
 *     unidade viva nos dois momentos teve uma vez inteira entre um e outro;
 *     cada um dos quatro tipos, num tabuleiro montado à mão, fere quem ficou e
 *     não fere quem saiu;
 *   · a IA evita: o caminho de mesmo custo desvia da placa, a IA não termina a
 *     vez numa casa avisada para a próxima rodada quando tinha casa sem aviso;
 *   · o colosso aparece no andar certo (5, 10, 15, 20 → fogo, água, terra, ar,
 *     e o 25 volta ao fogo), UM só, nunca no sorteio comum; o chefe do andar é
 *     UM só; o colosso sobe de vida com o andar e paga mais que um comum sem
 *     ser chefe (selo é só de chefe);
 *   · os quatro traços: rastro de brasa, maré, couraça, ventania;
 *   · o juiz refaz um andar com perigos e colosso a partir dos lances do
 *     cliente e chega ao mesmo hash;
 *   · Engine.VERSAO_REGRAS subiu (≥ 6). */
const path = require('path');
const { mundo } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'motor.js'));
const { refaz } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
function novo() { return mundo([]).JOGO; }
const J = novo();
const D = J.DATA, E = J.Engine, Po = J.Poco, AI = J.AI;
const md = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);
const ehChao = (ch) => ch !== '#' && ch !== '=' && ch !== '~';
const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

// ------------------------------------------------------------------ a semente
(function () {
  const B = novo().Poco;
  let iguais = 0, casos = 0, mudam = 0;
  for (let andar = 1; andar <= 30; andar++) {
    for (const s of [1, 77, 4242]) {
      casos++;
      const a = JSON.stringify(Po.salaSemeada(andar, s)), b = JSON.stringify(B.salaSemeada(andar, s));
      if (a === b && a.length > 20) iguais++;
      if (JSON.stringify(Po.salaSemeada(andar, s + 1)) !== a) mudam++;
    }
  }
  check('a mesma semente e o mesmo andar dão a MESMA sala, perigos e colosso inclusos (' + casos + ' casos, dois mundos)', iguais === casos, iguais + '/' + casos);
  check('outra semente muda a sala', mudam === casos, mudam + '/' + casos);
})();

// ------------------------------------------------------------------ posição válida
function pegada(p, grade) {
  const h = grade.length, w = grade[0].length;
  const chao = (x, y) => x >= 0 && y >= 0 && y < h && x < w && ehChao(grade[y][x]);
  if (p.tipo === 'placa') {
    const d = { n: [0, -1], s: [0, 1], o: [-1, 0], l: [1, 0] }[p.dir], out = [{ x: p.x, y: p.y }];
    for (let k = 1; k <= Po.PLACA_ALCANCE; k++) { const nx = p.x + d[0] * k, ny = p.y + d[1] * k; if (!chao(nx, ny)) break; out.push({ x: nx, y: ny }); }
    return out;
  }
  if (p.tipo === 'jato') return [{ x: p.x, y: p.y }].concat(DIRS.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).filter((c) => chao(c.x, c.y)));
  return [{ x: p.x, y: p.y }];
}
function heroi(classId, heroId) { return { classId, heroId, level: 20 }; }
(function () {
  let ruins = [], salas = 0, perigos = 0, zonaRuim = 0, porAndar = {}, tiposPorAndar = {};
  for (let andar = 1; andar <= 25; andar++) {
    for (let s = 1; s <= 40; s++) {
      const sala = Po.salaSemeada(andar, s * 7919);
      const grade = sala.layout.map((r) => r.split(''));
      salas++;
      porAndar[andar] = (porAndar[andar] || 0) + sala.perigos.length;
      const usadas = {};
      for (const p of sala.perigos) {
        perigos++;
        (tiposPorAndar[p.tipo] = tiposPorAndar[p.tipo] || []).push(andar);
        const ch = grade[p.y][p.x];
        if (!ehChao(ch) || ch === 'P' || (ch >= 'a' && ch <= 'z')) ruins.push('andar ' + andar + ' s' + s + ': ' + p.tipo + ' em "' + ch + '"');
        for (const c of pegada(p, grade)) {
          const k = c.x + ',' + c.y;
          if (usadas[k]) ruins.push('andar ' + andar + ' s' + s + ': casa ' + k + ' dividida');
          usadas[k] = true;
        }
      }
      // a zona de entrada DO MOTOR: a que a escolha da posição oferece
      if (s <= 6) {
        Po.poeSala(andar, sala);
        const st = E.createBattle('poco', andar - 1, [heroi('sumo', 'h1'), heroi('curandeiro', 'h2')], { seed: s, escolhePosicao: true });
        const zona = new Set(st.placement.zona.map((c) => c.x + ',' + c.y));
        for (const p of sala.perigos) for (const c of pegada(p, grade)) if (zona.has(c.x + ',' + c.y)) zonaRuim++;
      }
    }
  }
  check('perigo só em chão comum (nunca em P nem em casa de monstro) e sem casa dividida (' + perigos + ' perigos em ' + salas + ' andares)',
        ruins.length === 0, ruins.slice(0, 5).join(' | '));
  check('nada do que um perigo alcança cai na zona de entrada do motor (state.placement.zona)', zonaRuim === 0, zonaRuim + ' casas');
  const medias = Object.keys(porAndar).map((a) => porAndar[a] / 40);
  check('a quantidade de perigos sobe (ou se mantém) a cada andar, de ' + medias[0] + ' a ' + medias[medias.length - 1],
        medias.every((v, i) => i === 0 || v >= medias[i - 1] - 0.05) && medias[medias.length - 1] > medias[0], medias.join(' → '));
  check('cada tipo só aparece do andar em que abre (placa e runa 1, jato 2, rachado 3)',
        Object.keys(tiposPorAndar).every((t) => Math.min.apply(null, tiposPorAndar[t]) >= Po.TIPOS[t].desde) &&
        Object.keys(Po.TIPOS).every((t) => tiposPorAndar[t] && tiposPorAndar[t].length),
        JSON.stringify(Object.keys(tiposPorAndar).map((t) => [t, Math.min.apply(null, tiposPorAndar[t])])));
})();

// ------------------------------------------------------------------ o caminho sempre existe
(function () {
  let quebrados = 0, comRachado = 0;
  for (let andar = 3; andar <= 30; andar++) {
    for (let s = 1; s <= 30; s++) {
      const sala = Po.salaSemeada(andar, s * 104729);
      const rach = sala.perigos.filter((p) => p.tipo === 'rachado');
      if (!rach.length) continue;
      comRachado++;
      const grade = sala.layout.map((r) => r.split(''));
      rach.forEach((p) => { grade[p.y][p.x] = '~'; });
      const h = grade.length, w = grade[0].length, chao = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ehChao(grade[y][x])) chao.push(x + ',' + y);
      // de um P, todo o chão que o palco ligava continua ligado
      const p0 = (() => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grade[y][x] === 'P') return [x, y]; })();
      const vis = new Set([p0.join(',')]), fila = [p0];
      while (fila.length) {
        const [cx, cy] = fila.shift();
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx, ny = cy + dy, k = nx + ',' + ny;
          if (nx < 0 || ny < 0 || ny >= h || nx >= w || vis.has(k) || !ehChao(grade[ny][nx])) continue;
          vis.add(k); fila.push([nx, ny]);
        }
      }
      // as casas de monstro e de P: todas alcançáveis
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const ch = grade[y][x];
        if ((ch === 'P' || (ch >= 'a' && ch <= 'z')) && !vis.has(x + ',' + y)) quebrados++;
      }
    }
  }
  check('com todo chão rachado caído, toda casa de herói e de monstro segue alcançável (' + comRachado + ' andares com rachado)',
        quebrados === 0 && comRachado > 50, quebrados + ' casas isoladas');
})();

// ------------------------------------------------------------------ o colosso e o chefe
(function () {
  const esperado = { 5: 'colosso_fogo', 10: 'colosso_agua', 15: 'colosso_terra', 20: 'colosso_ar', 25: 'colosso_fogo', 40: 'colosso_ar' };
  check('Poco.colossoDoAndar gira fogo → água → terra → ar a cada 5 andares',
        Object.keys(esperado).every((a) => Po.colossoDoAndar(+a) === esperado[a]) &&
        [1, 2, 4, 6, 9, 11, 14, 21].every((a) => Po.colossoDoAndar(a) === null));
  let errados = [], chefesErrados = [];
  for (let andar = 1; andar <= 40; andar++) {
    for (let s = 1; s <= 8; s++) {
      const sala = Po.salaSemeada(andar, s * 31);
      const cont = {};
      sala.layout.forEach((r) => { for (const ch of r) cont[ch] = (cont[ch] || 0) + 1; });
      let colossos = 0, chefes = 0;
      for (const le in sala.monsters) {
        const m = D.monsters[sala.monsters[le]];
        if (m.colosso) colossos += cont[le] || 0;
        if (m.boss) chefes += cont[le] || 0;
      }
      const quer = Po.colossoDoAndar(andar);
      if (quer ? (colossos !== 1 || sala.colosso !== quer || !Object.values(sala.monsters).includes(quer)) : colossos !== 0) {
        errados.push('andar ' + andar + ' s' + s + ': ' + colossos + ' colosso(s), ' + sala.colosso);
      }
      if (chefes !== (andar % 5 === 0 ? 1 : 0)) chefesErrados.push('andar ' + andar + ' s' + s + ': ' + chefes + ' chefes');
    }
  }
  check('o colosso aparece SÓ nos andares múltiplos de 5, UM por andar, o do elemento da vez', errados.length === 0, errados.slice(0, 4).join(' | '));
  check('o chefe do andar múltiplo de 5 é UM só (antes a letra dele se repetia na sala)', chefesErrados.length === 0, chefesErrados.slice(0, 4).join(' | '));
  const comuns = Po.elenco(false);
  check('nenhum colosso entra no sorteio comum do Poço', Po.COLOSSOS.every((id) => comuns.indexOf(id) < 0) && comuns.length > 20);

  const melhorXp = Math.max.apply(null, comuns.map((id) => D.monsters[id].xp));
  const melhorMin = Math.max.apply(null, comuns.map((id) => D.monsters[id].stoneDrop.min));
  check('o colosso paga mais que qualquer comum (XP e pedras) e NÃO é chefe (selo, insígnia e roleta seguem só de chefe)',
        Po.COLOSSOS.every((id) => { const m = D.monsters[id]; return m && !m.boss && !m.summonOnly && m.xp > melhorXp && m.stoneDrop.chance === 1 && m.stoneDrop.min > melhorMin; }),
        JSON.stringify(Po.COLOSSOS.map((id) => [id, D.monsters[id] && D.monsters[id].xp, D.monsters[id] && D.monsters[id].stoneDrop])) + ' melhor comum ' + melhorXp);

  // a vida sobe com o andar, pela mesma escalada
  const sala10 = Po.salaSemeada(10, 5);
  Po.poeSala(10, sala10);
  const st = E.createBattle('poco', 9, [heroi('sumo', 'h1')], { seed: 5 });
  const col = st.units.find((u) => u.defId === 'colosso_agua');
  const base = col && col.hpMax;
  Po.escalaEstado(st, 10);
  check('o colosso sobe de vida com o andar, pela mesma conta do resto do Poço (×' + Po.fator(10) + ')',
        !!col && col.hpMax === Math.round(base * Po.fator(10)), col && (base + ' → ' + col.hpMax));
})();

// ------------------------------------------------------------------ tabuleiro à mão
/* Uma sala de prova, empurrada em DATA.dungeons: layout, monstros e perigos
 * escritos aqui. A batalha nasce em `playing`; quem age é posto à mão. */
let nSala = 0;
function salaDeProva(Jx, layout, monsters, perigos) {
  const id = 'prova-poco-' + (++nSala);
  Jx.DATA.dungeons.push({ id, name: 'Prova', rooms: [{ name: 'Prova', layout, monsters, perigos }] });
  return id;
}
function daVez(st, u) { st.activeIdx = st.order.indexOf(u.uid); u.pa = u.paMax; u.pp = u.ppMax; u.castsThisTurn = {}; }
// fecha rodadas: todo mundo encerra a vez sem fazer nada, até a rodada `alvo` começar
function ateRodada(Ex, st, alvo) {
  let guarda = 0;
  while (st.phase === 'playing' && st.round < alvo && guarda++ < 400) Ex.endTurn(st);
}
function golpe(Ex, id, el, n) {
  Ex.registerSpell({ id, name: id, element: el, paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 1, max: 2, line: false, los: true, movable: false }, aoe: { shape: 'single', size: 0 },
    targetSide: 'enemy', effects: [{ type: 'damage', element: el, min: n, max: n }], description: 'prova', fxKey: 'slam' });
}

(function placaJatoRachadoRuna() {
  const Jx = novo(), Ex = Jx.Engine;
  const layout = [
    '###########',
    '#P........#',
    '#.........#',
    '#.........#',
    '#.......a.#',
    '###########'
  ];
  const id = salaDeProva(Jx, layout, { a: 'cave-jaw' }, [
    { tipo: 'placa', x: 2, y: 2, dir: 'l' },                       // linha (3..7,2)
    { tipo: 'jato', x: 5, y: 3, elemento: 'fogo', periodo: 3, fase: 0 },   // dispara nas rodadas 3, 6…
    { tipo: 'rachado', x: 8, y: 1, desaba: 3 },
    { tipo: 'runa', x: 1, y: 3 }
  ]);
  // ---- a placa
  let st = Ex.createBattle(id, 0, [heroi('sumo', 'h1')], { seed: 3 });
  const h = st.units.find((u) => u.side === 'player'), m = st.units.find((u) => u.side === 'enemy');
  m.x = 7; m.y = 2;                                         // o monstro na linha da placa (longe do jato)
  daVez(st, h);
  Ex.events.length = 0;
  Ex.move(st, h.uid, 2, 2);                                 // o herói pisa na placa e fica em cima
  const av = Ex.events.find((e) => e.type === 'perigoAviso' && e.tipo === 'placa');
  check('a placa pisada arma e avisa a linha para o começo da 2ª rodada depois (rodada ' + (av && av.rodada) + ')',
        !!av && av.rodada === st.round + Po.PLACA_ATRASO && av.casas.length === 5 && av.casas.every((c) => c.y === 2 && c.x >= 3),
        JSON.stringify(av));
  const hp0 = m.hp, hh0 = h.hp;
  st.units.filter((u) => u !== h && u !== m).forEach((u) => { u.alive = false; });
  m.ppMax = 0; m.paMax = 0;                                 // o monstro fica parado na linha
  Ex.events.length = 0;
  ateRodada(Ex, st, av.rodada);
  const disp = Ex.events.find((e) => e.type === 'perigoDispara' && e.tipo === 'placa');
  check('as setas varrem a linha na rodada avisada: quem ficou na linha leva, quem está na placa não',
        !!disp && m.hp < hp0 && h.hp === hh0 && disp.atingidos.indexOf(m.uid) >= 0,
        JSON.stringify({ disp: !!disp, m: [hp0, m.hp], h: [hh0, h.hp] }));
  check('o dano da placa é a fração da vida máxima (' + Po.DANO.placa * 100 + '%), sem sorteio',
        hp0 - m.hp === Math.max(1, Math.round(m.hpMax * Po.DANO.placa)), (hp0 - m.hp) + ' de ' + m.hpMax);

  // ---- o jato, o rachado e a runa
  st = Ex.createBattle(id, 0, [heroi('sumo', 'h1')], { seed: 4 });
  const h2 = st.units.find((u) => u.side === 'player'), m2 = st.units.find((u) => u.side === 'enemy');
  m2.ppMax = 0; m2.paMax = 0;
  m2.x = 5; m2.y = 4;                                       // vizinho de baixo do respiro: dentro da área
  h2.x = 8; h2.y = 1;                                       // em cima do chão rachado
  Ex.events.length = 0;
  ateRodada(Ex, st, 2);
  const avJ = Ex.events.find((e) => e.type === 'perigoAviso' && e.tipo === 'jato');
  const avR = Ex.events.find((e) => e.type === 'perigoAviso' && e.tipo === 'rachado');
  check('o jato e o chão rachado avisam no COMEÇO da rodada anterior à do dano (rodada 2 → 3)',
        !!avJ && avJ.rodada === 3 && !!avR && avR.rodada === 3 && st.round === 2,
        JSON.stringify({ avJ, avR, r: st.round }));
  const hpM = m2.hp, hpH = h2.hp;
  Ex.events.length = 0;
  ateRodada(Ex, st, 3);
  const res = Ex.effResist(m2, 'fogo');
  check('o jato fere quem ficou na área com o elemento dele (a resistência conta)',
        hpM - m2.hp === Math.max(1, Math.round(m2.hpMax * Po.DANO.jato * (100 - res) / 100)), (hpM - m2.hp) + ' (resist ' + res + ')');
  const tile = st.grid.tiles[1][8];
  check('o chão rachado vira buraco; quem estava em cima cai, se fere e sobe na casa livre mais perto',
        tile.type === 'hole' && !(h2.x === 8 && h2.y === 1) && md(h2.x, h2.y, 8, 1) === 1 && h2.hp < hpH,
        JSON.stringify({ t: tile.type, h: [h2.x, h2.y, hpH, h2.hp] }));
  check('depois de cair, o buraco não é mais caminho', !Ex.reachable(st, h2.uid).some((c) => c.x === 8 && c.y === 1) || h2.pp === 0);
  // a runa: prende o passo e tira PP
  h2.x = 1; h2.y = 2;
  daVez(st, h2);
  const pp0 = h2.pp;
  Ex.events.length = 0;
  Ex.move(st, h2.uid, 1, 4);                                // o caminho passa pela runa em (1,3)
  const ru = Ex.events.find((e) => e.type === 'perigoRuna');
  check('a runa prende o passo em cima dela e tira ' + Po.RUNA_PP + ' PP',
        !!ru && h2.x === 1 && h2.y === 3 && h2.pp === Math.max(0, pp0 - 1 - Po.RUNA_PP), JSON.stringify({ ru, pos: [h2.x, h2.y], pp: [pp0, h2.pp] }));
})();

// ------------------------------------------------------------------ a IA e o caminho
(function () {
  const Jx = novo(), Ex = Jx.Engine;
  const layout = [
    '#######',
    '#P....#',
    '#.###.#',
    '#....a#',
    '#######'
  ];
  const id = salaDeProva(Jx, layout, { a: 'cave-jaw' }, []);
  const st = Ex.createBattle(id, 0, [heroi('sumo', 'h1')], { seed: 1 });
  const h = st.units.find((u) => u.side === 'player');
  const m = st.units.find((u) => u.side === 'enemy');
  m.x = 3; m.y = 2; m.alive = false;                        // fora do caminho
  h.ppMax = 9; daVez(st, h);
  const antes = Ex.path(st, h.uid, 5, 3);
  const meio = antes[2];                                    // uma casa do caminho de sempre
  st.perigos.push({ id: 'pt', tipo: 'placa', x: meio.x, y: meio.y, dir: 'n', casas: [], armada: false, aviso: 0 });
  const depois = Ex.path(st, h.uid, 5, 3);
  check('o caminho de mesmo custo desvia da placa (' + antes.length + ' passos dos dois jeitos)',
        depois.length === antes.length && !depois.some((c) => c.x === meio.x && c.y === meio.y),
        JSON.stringify({ antes, depois }));
})();
(function () {
  const Jx = novo(), Ex = Jx.Engine, AIx = Jx.AI;
  const layout = [
    '#########',
    '#P......#',
    '#.......#',
    '#.......#',
    '#......a#',
    '#########'
  ];
  const id = salaDeProva(Jx, layout, { a: 'pick-revenant' }, [{ tipo: 'jato', x: 4, y: 2, elemento: 'ar', periodo: 3, fase: 0 }]);
  const st = Ex.createBattle(id, 0, [heroi('sumo', 'h1')], { seed: 2 });
  const h = st.units.find((u) => u.side === 'player'), m = st.units.find((u) => u.side === 'enemy');
  h.x = 3; h.y = 2;                                          // o herói colado na área do jato
  m.x = 6; m.y = 2;
  ateRodada(Ex, st, 2);
  daVez(st, m);
  const area = new Set(Jx.Poco.regras.avisos(st).filter((c) => c.rodada === st.round + 1).map((c) => c.x + ',' + c.y));
  const plano = AIx.planTurn(st, m.uid) || [];
  const mv = plano.find((a) => a.action === 'move');
  const fim = mv ? mv.x + ',' + mv.y : m.x + ',' + m.y;
  check('a IA não termina a vez numa casa avisada para a próxima rodada (havendo outra que serve)',
        area.size > 0 && !area.has(fim), JSON.stringify({ area: [...area], fim }));
})();

// ------------------------------------------------------------------ os quatro traços
(function () {
  const Jx = novo(), Ex = Jx.Engine;
  const layout = [
    '###########',
    '#P........#',
    '#.........#',
    '#.....a...#',
    '#.........#',
    '###########'
  ];
  golpe(Ex, 'prova-golpe', 'neutro', 20);
  golpe(Ex, 'prova-vento', 'ar', 20);
  function batalha(colosso) {
    const id = salaDeProva(Jx, layout, { a: colosso }, []);
    const st = Ex.createBattle(id, 0, [heroi('sumo', 'h1')], { seed: 9 });
    const h = st.units.find((u) => u.side === 'player'), c = st.units.find((u) => u.side === 'enemy');
    h.spells = h.spells.concat(['prova-golpe', 'prova-vento']);
    return { st, h, c };
  }
  // ---- fogo: o rastro
  let { st, h, c } = batalha('colosso_fogo');
  daVez(st, c);
  c.x = 6; c.y = 3;
  Ex.move(st, c.uid, 8, 3);
  const brasas = st.traps.filter((t) => t.ownerUid === c.uid).map((t) => t.x + ',' + t.y).sort();
  check('Colosso de Brasa: as casas por onde passou ficam em brasa (armadilha do lado dele), a casa onde parou não',
        JSON.stringify(brasas) === JSON.stringify(['6,3', '7,3']) && st.traps.every((t) => t.side === 'enemy'), JSON.stringify(brasas));
  h.x = 7; h.y = 2; daVez(st, h);
  const hp0 = h.hp;
  Ex.events.length = 0;
  Ex.move(st, h.uid, 7, 4);
  check('quem pisa na brasa se queima (e para em cima, como em toda armadilha do outro lado)',
        h.hp < hp0 && h.x === 7 && h.y === 3 && Ex.events.some((e) => e.type === 'trapTriggered'), JSON.stringify({ hp: [hp0, h.hp], pos: [h.x, h.y] }));

  // ---- água: a poça e a cura parado
  ({ st, h, c } = batalha('colosso_agua'));
  c.hp = Math.round(c.hpMax / 2);
  daVez(st, c);
  Ex.endTurn(st);                                           // 1ª vez parado: nasce a poça, ainda sem cura
  const poca = st.perigos.find((p) => p.tipo === 'poca');
  const hp1 = c.hp;
  daVez(st, c);
  Ex.endTurn(st);                                           // 2ª vez parado em cima da poça: cura
  const cura = c.hp - hp1;
  check('Colosso da Maré: onde termina a vez nasce uma poça', !!poca && poca.x === c.x && poca.y === c.y, JSON.stringify(poca));
  check('parado em cima da poça, ele se refaz (' + Math.round(D.monsters.colosso_agua.traits[0].cura * 100) + '% da vida)',
        cura === Math.round(c.hpMax * D.monsters.colosso_agua.traits[0].cura), cura + ' de ' + c.hpMax);
  daVez(st, c);
  Ex.move(st, c.uid, c.x + 1, c.y);
  Ex.move(st, c.uid, c.x - 1, c.y);                         // anda e volta para a poça
  const hp2 = c.hp;
  Ex.endTurn(st);
  check('quem andou no turno não se cura, mesmo terminando na poça', c.hp === hp2, hp2 + ' → ' + c.hp);

  // ---- terra: a couraça
  ({ st, h, c } = batalha('colosso_terra'));
  h.x = c.x - 1; h.y = c.y;
  daVez(st, h);
  const pontos = c.couraca;
  const esperado = (sp, el) => Math.round(20 * (100 + Ex.castPower(st, h, Ex.spell(sp))) / 100 * (100 - Ex.effResist(c, el)) / 100);
  let a = c.hp;
  Ex.cast(st, h.uid, 'prova-golpe', c.x, c.y);
  const comCouraca = a - c.hp;
  check('Colosso de Rocha: com a couraça, o golpe entra pela metade', comCouraca === Math.max(1, Math.round(esperado('prova-golpe', 'neutro') * 0.5)),
        comCouraca + ' (cheio seria ' + esperado('prova-golpe', 'neutro') + ')');
  check('cada golpe arranca uma placa da couraça', c.couraca === pontos - 1, pontos + ' → ' + c.couraca);
  Ex.cast(st, h.uid, 'prova-vento', c.x, c.y);
  check('o golpe de AR arranca duas', c.couraca === pontos - 3, String(c.couraca));
  Ex.events.length = 0;
  let guarda = 0;
  while (c.couraca > 0 && guarda++ < 10) Ex.cast(st, h.uid, 'prova-golpe', c.x, c.y);
  const caiu = Ex.events.some((e) => e.type === 'couracaCaiu' && e.uid === c.uid);
  a = c.hp;
  Ex.cast(st, h.uid, 'prova-golpe', c.x, c.y);
  check('sem couraça, o golpe entra inteiro (e a queda foi anunciada)', caiu && a - c.hp === esperado('prova-golpe', 'neutro'), (a - c.hp) + ' caiu=' + caiu);

  // ---- ar: a ventania
  ({ st, h, c } = batalha('colosso_ar'));
  h.x = c.x - 1; h.y = c.y;
  daVez(st, h);
  Ex.events.length = 0;
  Ex.cast(st, h.uid, 'prova-golpe', c.x, c.y);
  check('Colosso da Ventania: quem o golpeia de perto é soprado 2 casas para longe',
        md(h.x, h.y, c.x, c.y) === 3 && Ex.events.some((e) => e.type === 'ventania'), JSON.stringify([h.x, h.y, c.x, c.y]));
  h.x = c.x - 2; h.y = c.y;
  daVez(st, h);
  Ex.cast(st, h.uid, 'prova-golpe', c.x, c.y);
  check('de longe, ninguém é soprado', h.x === c.x - 2, JSON.stringify([h.x, h.y]));
  // o veneno de quem está colado não sopra (não é o golpe de quem está na vez)
  h.x = c.x - 1; h.y = c.y;
  c.effects.push({ type: 'poison', element: 'neutro', min: 5, max: 5, duration: 2, sourceUid: h.uid, sourcePower: 0 });
  daVez(st, c);
  ateRodada(Ex, st, st.round + 1);
  check('o veneno que fere o colosso na vez dele não sopra ninguém', h.x === c.x - 1 || !h.alive, JSON.stringify([h.x, h.y, c.x, c.y]));
})();

// ------------------------------------------------------------------ andares de verdade, jogados pela IA
/* Os dois lados jogados pela IA do jogo, em andares sorteados: vale para
 * conferir o AVISO ANTES DO DANO e que a IA não para em casa avisada. Os
 * lances do lado do herói são anotados, e o juiz refaz o andar com eles. */
function joga(Jx, andar, semente, party) {
  const Ex = Jx.Engine;
  Jx.Poco.poeSala(andar, Jx.Poco.salaSemeada(andar, semente));
  const st = Ex.createBattle('poco', andar - 1, party, { seed: semente, escolhePosicao: true });
  Jx.Poco.escalaEstado(st, andar);
  Ex.events.length = 0;
  const lances = [];
  const op = Ex.placementOptions(st)[0];
  lances.push({ a: 'p', x: op.x, y: op.y, ok: !!Ex.place(st, op.x, op.y) });
  const log = [];          // [evento, rodada, índice] na ordem
  const avisos = {}, turnos = {};
  let k = 0, violacoes = 0, decisoes = 0, voltas = 0;
  function drena() {
    for (const ev of Ex.events) {
      k++;
      if (ev.type === 'perigoAviso') avisos[ev.id + '@' + ev.rodada] = { k, vivos: st.units.filter((u) => u.alive && !u.offBoard).map((u) => u.uid) };
      if (ev.type === 'turnStart') (turnos[ev.uid] = turnos[ev.uid] || []).push(k);
      if (ev.type === 'perigoDispara') log.push({ ev, k, rodada: st.round });
    }
    Ex.events.length = 0;
  }
  drena();
  while (st.phase === 'playing' && voltas++ < 3000) {
    const u = Ex.activeUnit(st);
    if (!u) break;
    const meu = u.side === 'player' && (u.kind === 'hero' || u.kind === 'fusion');
    const avisadas = new Set(Jx.Poco.regras.avisos(st).filter((c) => c.rodada === st.round + 1).map((c) => c.x + ',' + c.y));
    const tinhaSaida = avisadas.size && [{ x: u.x, y: u.y }].concat(Ex.reachable(st, u.uid)).some((c) => !avisadas.has(c.x + ',' + c.y));
    const plano = Jx.AI.planTurn(st, u.uid) || [];
    let acabou = false;
    for (const a of (plano.length ? plano : [{ action: 'end' }])) {
      if (st.phase !== 'playing') break;
      if (a.action === 'move') { const ok = !!Ex.move(st, u.uid, a.x, a.y); if (meu) lances.push({ a: 'm', u: u.uid, x: a.x, y: a.y, ok }); }
      else if (a.action === 'cast') { const ok = !!Ex.cast(st, u.uid, a.spellId, a.x, a.y); if (meu) lances.push({ a: 'c', u: u.uid, s: a.spellId, x: a.x, y: a.y, ok }); }
      else if (a.action === 'end') {
        if (avisadas.size && tinhaSaida && u.alive) { decisoes++; if (avisadas.has(u.x + ',' + u.y)) violacoes++; }
        Ex.endTurn(st); if (meu) lances.push({ a: 'e', ok: true }); acabou = true; break;
      }
      drena();
    }
    if (!acabou && st.phase === 'playing') {
      if (avisadas.size && tinhaSaida && u.alive) { decisoes++; if (avisadas.has(u.x + ',' + u.y)) violacoes++; }
      Ex.endTurn(st); if (meu) lances.push({ a: 'e', ok: true });
    }
    drena();
  }
  return { st, lances, log, avisos, turnos, violacoes, decisoes, hash: Ex.hash(st) };
}
(function () {
  const Jx = novo();
  const party = [heroi('sumo', 'h1'), heroi('curandeiro', 'h2')];
  let disparos = 0, semAviso = [], injustos = [], violacoes = 0, decisoes = 0, colossosVistos = {};
  const andares = [3, 4, 5, 7, 9, 10, 12, 15, 18, 20];
  for (const andar of andares) {
    for (let s = 1; s <= 5; s++) {
      const r = joga(Jx, andar, s * 1013, party);
      violacoes += r.violacoes; decisoes += r.decisoes;
      r.st.units.forEach((u) => { if (Jx.DATA.monsters[u.defId] && Jx.DATA.monsters[u.defId].colosso) colossosVistos[u.defId] = true; });
      for (const d of r.log) {
        disparos++;
        const av = r.avisos[d.ev.id + '@' + d.rodada];
        if (!av) { semAviso.push(andar + '/' + s + ' ' + d.ev.id + ' r' + d.rodada); continue; }
        // toda unidade viva no aviso e no disparo teve uma vez inteira entre os dois
        const vivasAgora = new Set(r.st.units.filter((u) => u.alive).map((u) => u.uid));
        for (const uid of av.vivos) {
          const u = r.st.units.find((x) => x.uid === uid);
          if (!u || u.kind === 'pet') continue;
          if (!d.ev.atingidos.includes(uid) && !vivasAgora.has(uid)) continue;
          const teve = (r.turnos[uid] || []).some((kk) => kk > av.k && kk < d.k);
          if (!teve && d.ev.atingidos.includes(uid)) injustos.push(andar + '/' + s + ' ' + d.ev.id + ' ' + uid);
        }
      }
    }
  }
  check('todo disparo de perigo teve aviso para a MESMA rodada (' + disparos + ' disparos em ' + andares.length * 5 + ' andares)',
        disparos > 30 && semAviso.length === 0, semAviso.slice(0, 5).join(' | '));
  check('ninguém foi ferido por um perigo sem ter tido uma vez inteira depois do aviso', injustos.length === 0, injustos.slice(0, 5).join(' | '));
  check('a IA não termina a vez em casa avisada para a próxima rodada quando tinha casa sem aviso (' + decisoes + ' decisões)',
        decisoes > 20 && violacoes === 0, violacoes + ' violações');
  check('os colossos dos andares 5, 10, 15 e 20 entraram em batalha (fogo, água, terra, ar)',
        ['colosso_fogo', 'colosso_agua', 'colosso_terra', 'colosso_ar'].every((id) => colossosVistos[id]), JSON.stringify(Object.keys(colossosVistos)));

  // ---- o juiz refaz o andar com os lances do cliente e chega ao mesmo fim
  let refeitos = 0, iguais = 0, erros = [];
  for (const [andar, s] of [[5, 11], [10, 12], [7, 13], [15, 14], [20, 15]]) {
    const r = joga(novo(), andar, s, party);
    refeitos++;
    try {
      const out = refaz({ dungeonId: 'poco', roomIndex: andar - 1, semente: s, party: JSON.parse(JSON.stringify(party)),
                          lances: r.lances, hashFinal: r.hash, regras: E.VERSAO_REGRAS });
      if (out.ok && out.hash === r.hash && out.fase === r.st.phase) iguais++;
      else erros.push(andar + ': ' + out.fase + '/' + r.st.phase);
    } catch (e) { erros.push(andar + ': ' + (e.motivo || '') + ' ' + e.message); }
  }
  check('o juiz refaz andares com perigos e colosso a partir dos lances do cliente e chega ao MESMO hash (' + iguais + '/' + refeitos + ')',
        iguais === refeitos, erros.join(' | '));
})();

check('Engine.VERSAO_REGRAS subiu com o chão do Poço (≥ 6)', E.VERSAO_REGRAS >= 6, String(E.VERSAO_REGRAS));

console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
