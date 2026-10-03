#!/usr/bin/env node
'use strict';
/* PROVA DA INVISIBILIDADE E DA ARMADILHA (22/09). Dois pedidos do dono:
 *   "classe ladino a invisibilidade só fica no turno que ele usa, ou seja, não
 *    serve para nada.. tem que ficar 2 turnos completos" e "na invisibilidade
 *    ele deve sumir 100% pro adversário";
 *   "no xamã, as armadilhas jamais podem ficar visíveis para os inimigos ou
 *    adversários, assim eles desviam e nunca caem — deve ficar visível somente
 *    para o jogador e para quem estiver jogando no time dele".
 *
 *   node tests/invisivel_armadilha.js
 *
 * Roda sobre o motor do juiz (servidor/juiz/motor.js) e, para a tela, sobre o
 * mundo econômico (servidor/juiz/estado.js, que carrega o game.js). Cobra:
 *   · as três invisibilidades do Ladino atravessam DUAS vezes inteiras do
 *     inimigo e somem no fim do 2º turno dele depois do lance (antes: a Sombra
 *     Curta sumia antes de qualquer inimigo agir);
 *   · a invisibilidade posta num ALIADO fora do turno dele conta normal;
 *   · o golpe de dano tira das sombras, a armadilha do dono disparando não;
 *   · feitiço 'enemy' de casa única não mira o invisível do outro lado; o de
 *     casa 'any' e a área ainda pegam; o raio não salta para ele;
 *   · quem anda planeja pela casa dele, esbarra e para antes (sem gastar o PP do
 *     resto); a prévia não pinta âmbar por ele, mas ele ainda fixa;
 *   · pisar em armadilha do outro lado PARA o passo em cima dela e cobra só o
 *     trecho; a do próprio lado não para nem dispara;
 *   · a IA não desvia da armadilha do outro lado (antes: −60 e nunca pisava);
 *   · a marca do turno some no fim do turno e entra no hash enquanto vive;
 *   · Engine.VERSAO_REGRAS ≥ 5 (a que trouxe estas regras; outras subidas vêm depois);
 *   · a TELA: Game.ocultoNaTela / veArmadilha / eventoParaTela no solo (o lado
 *     'player' é o meu) — o monstro invisível some, a armadilha do monstro não
 *     aparece, a minha aparece, o lance de armadilha do outro lado perde a casa,
 *     e o duelo no mesmo teclado mostra tudo. */
const path = require('path');
const { mundo } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'motor.js'));
const { mundoEconomico } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (extra !== undefined && !ok ? ' — ' + extra : ''));
}

/* A sala de prova e os bonecos: um corredor aberto 11×7, um alvo parado (sem PP)
 * e um lobo que anda e morde. Os feitiços 'pv-' são sintéticos. */
function prepara(J) {
  const D = J.DATA;
  const RES = { neutro: 0, fogo: 0, agua: 0, terra: 0, ar: 0 };
  D.monsters['pv-alvo'] = { id: 'pv-alvo', name: 'Alvo', family: 'Prova', element: 'neutro', description: 'prova',
    stats: { hp: 1000, pa: 6, pp: 0, initiative: 1, power: 0, dodge: 0, lock: 0, resists: RES },
    spells: [], ai: 'melee', traits: [], boss: false };
  D.monsters['pv-lobo'] = { id: 'pv-lobo', name: 'Lobo', family: 'Prova', element: 'neutro', description: 'prova',
    stats: { hp: 1000, pa: 6, pp: 4, initiative: 2, power: 0, dodge: 0, lock: 0, resists: RES },
    spells: ['pv-mordida'], ai: 'melee', traits: [], boss: false };
  function sp(id, over) {
    const s = { id, name: id, element: 'neutro', classId: null, unlockLevel: 0, paCost: 1, cooldown: 0, castsPerTurn: 0,
      range: { min: 1, max: 8, line: false, los: true }, aoe: { shape: 'single', size: 0 }, needsEmptyTile: false,
      targetSide: 'any', effects: [], description: 'prova', flavor: '', fxKey: 'slam' };
    Object.assign(s, over);
    D.spells[id] = s;
    return s;
  }
  sp('pv-mordida', { range: { min: 1, max: 1, line: false, los: true }, targetSide: 'enemy',
    effects: [{ type: 'damage', element: 'neutro', min: 5, max: 5 }] });
  sp('pv-furo', { targetSide: 'enemy', effects: [{ type: 'damage', element: 'neutro', min: 10, max: 10 }] });
  sp('pv-tiro', { targetSide: 'any', effects: [{ type: 'damage', element: 'neutro', min: 10, max: 10 }] });
  sp('pv-bola', { targetSide: 'enemy', aoe: { shape: 'circle', size: 1 },
    effects: [{ type: 'damage', element: 'neutro', min: 10, max: 10 }] });
  sp('pv-raio', { targetSide: 'enemy', effects: [{ type: 'chain', element: 'neutro', min: 10, max: 10, jumps: 2, falloff: 1 }] });
  sp('pv-veu', { targetSide: 'ally', range: { min: 1, max: 4, line: false, los: true },
    effects: [{ type: 'invisible', duration: 2 }] });
  D.dungeons.push({
    id: 'prova-sombra', name: 'Prova da Sombra', theme: 'prova', description: 'prova', difficulty: 1, order: 99, palette: {},
    defaultWeather: 'calmo', weatherShiftEveryRounds: 0, tileEventRate: 0, lootTable: [], cardDrops: [],
    rooms: [
      { name: 'corredor', weather: 'calmo', sceneryTheme: 'prova', layout: [
        '###########',
        '#PP.......#',
        '#.........#',
        '#.........#',
        '#.........#',
        '#........a#',
        '###########'], monsters: { a: 'pv-alvo' } },
      { name: 'corredor com lobo', weather: 'calmo', sceneryTheme: 'prova', layout: [
        '###########',
        '#PP.......#',
        '#.........#',
        '#.........#',
        '#.........#',
        '#........a#',
        '###########'], monsters: { a: 'pv-lobo' } }
    ]
  });
}

function sala(E, roomIndex, party, seed) {
  const st = E.createBattle('prova-sombra', roomIndex, party, { seed: seed || 7, escolhePosicao: false });
  st.phase = 'playing';
  return st;
}
function invis(E, u) { return E.unitHasEffect(u, 'invisible'); }
// passa a vez até ser de `u` (sem ninguém fazer nada)
function ateAVezDe(E, st, u, limite) {
  for (let i = 0; i < (limite || 20); i++) {
    const a = E.activeUnit(st);
    if (a && a.uid === u.uid) return true;
    E.endTurn(st);
  }
  return false;
}

// ============================================================ o motor (juiz)
const J = mundo([]).JOGO;
prepara(J);
const E = J.Engine, AI = J.AI;

check('Engine.VERSAO_REGRAS é 5 ou maior (a invisibilidade e a armadilha mudaram o fim de uma sala; 03/10 o equilíbrio subiu para 6)', E.VERSAO_REGRAS >= 5, E.VERSAO_REGRAS);
check('Sombra Curta: invisível por 2 no dado (era 1)',
  (J.DATA.spells['espadachim-neutro-2'].effects || []).some((e) => e.type === 'invisible' && e.duration === 2));

/* 1. Quantas vezes do INIMIGO passam com o Ladino invisível, e em que fim de
 *    turno dele a invisibilidade some. */
function mede(spellId) {
  const st = sala(E, 0, [{ classId: 'espadachim', heroId: 'h1', level: 30 }]);
  const h = st.units.find((u) => u.kind === 'hero');
  const m = st.units.find((u) => u.defId === 'pv-alvo');
  if (!ateAVezDe(E, st, h)) return { erro: 'o herói nunca teve a vez' };
  if (h.spells.indexOf(spellId) < 0) h.spells.push(spellId);
  h.pa = 20; h.castsThisTurn = {}; h.cooldowns = {};
  const ok = E.cast(st, h.uid, spellId, h.x, h.y);
  const marcado = h.effects.some((e) => e.type === 'invisible' && e.lancadoNoTurno === (st.turno || 0));
  let vezesDoInimigo = 0, fimDoHeroi = 0, sumiuNoFimDoTurno = 0;
  for (let passos = 0; passos < 40 && invis(E, h); passos++) {
    const a = E.activeUnit(st);
    if (a.uid === m.uid) vezesDoInimigo++;
    const eraDoHeroi = a.uid === h.uid;
    E.endTurn(st);
    if (eraDoHeroi) { fimDoHeroi++; if (!invis(E, h)) sumiuNoFimDoTurno = fimDoHeroi; }
  }
  const sobrouMarca = h.effects.some((e) => e.lancadoNoTurno != null);
  return { ok, marcado, vezesDoInimigo, sumiuNoFimDoTurno, sobrouMarca };
}
for (const [id, nome] of [['espadachim-neutro-2', 'Sombra Curta'], ['espadachim-agua-10', 'Névoa Salgada'],
                          ['espadachim-terra-20', 'Emboscada Enterrada']]) {
  const r = mede(id);
  check(nome + ': lança, e a marca do turno vai no efeito', r.ok && r.marcado, JSON.stringify(r));
  check(nome + ': o inimigo joga DUAS vezes inteiras com o Ladino sumido', r.vezesDoInimigo === 2, JSON.stringify(r));
  check(nome + ': some no fim do 3º turno do Ladino (o do lance + 2 inteiros)', r.sumiuNoFimDoTurno === 3, JSON.stringify(r));
  check(nome + ': a marca do turno não sobra depois do fim do turno', r.sobrouMarca === false, JSON.stringify(r));
}

/* 2. Posta num aliado FORA da vez dele: conta normal, sem marca. */
(function () {
  const st = sala(E, 0, [{ classId: 'espadachim', heroId: 'h1' }, { classId: 'espadachim', heroId: 'h2' }]);
  const hs = st.units.filter((u) => u.kind === 'hero');
  const a = E.activeUnit(st).uid === hs[0].uid ? hs[0] : hs[1];
  const b = a === hs[0] ? hs[1] : hs[0];
  a.x = 2; a.y = 3; b.x = 4; b.y = 3;
  a.spells.push('pv-veu'); a.pa = 20;
  const ok = E.cast(st, a.uid, 'pv-veu', b.x, b.y);
  const ef = b.effects.find((e) => e.type === 'invisible');
  check('véu num aliado fora da vez dele: aplica sem marca de turno', ok && ef && ef.lancadoNoTurno == null, JSON.stringify(ef));
  let fins = 0, sumiu = 0;
  for (let p = 0; p < 30 && invis(E, b); p++) {
    const vez = E.activeUnit(st).uid === b.uid;
    E.endTurn(st);
    if (vez) { fins++; if (!invis(E, b)) sumiu = fins; }
  }
  check('véu num aliado: some no fim do 2º turno DELE (duração 2, conta normal)', sumiu === 2, 'sumiu no fim ' + sumiu);
})();

/* 3. O golpe quebra, a armadilha do dono não. */
(function () {
  const st = sala(E, 0, [{ classId: 'espadachim', heroId: 'h1' }]);
  const h = st.units.find((u) => u.kind === 'hero');
  const m = st.units.find((u) => u.defId === 'pv-alvo');
  ateAVezDe(E, st, h);
  h.x = 4; h.y = 3; m.x = 5; m.y = 3;
  h.pa = 20; h.castsThisTurn = {}; h.cooldowns = {};
  E.cast(st, h.uid, 'espadachim-neutro-2', h.x, h.y);
  E.events.length = 0;
  const ok = E.cast(st, h.uid, 'espadachim-neutro-1', m.x, m.y);
  const evs = E.events.slice();
  const iCast = evs.findIndex((e) => e.type === 'cast' && e.uid === h.uid);
  check('golpe de dano do invisível: acerta e ele sai das sombras', ok && !invis(E, h) &&
        evs.some((e) => e.type === 'log' && /sai das sombras/.test(e.text)), JSON.stringify(evs.map((e) => e.type)));
  check('a quebra vem antes do evento cast (a tela do outro lado mostra o golpe que revela)', iCast >= 0);
})();
(function () {
  const st = sala(E, 1, [{ classId: 'invocador', heroId: 'x1', level: 30 }]);
  const x = st.units.find((u) => u.kind === 'hero');
  const lobo = st.units.find((u) => u.defId === 'pv-lobo');
  x.x = 2; x.y = 1; lobo.x = 8; lobo.y = 3;
  st.traps.push({ x: 5, y: 3, trapId: 'trap-terra-laco', ownerUid: x.uid, side: x.side, remaining: 3 });
  x.effects.push({ type: 'invisible', duration: 3, sourceUid: x.uid });
  lobo.pp = 4;
  E.move(st, lobo.uid, 4, 3);
  check('a armadilha do Xamã invisível dispara e ele CONTINUA invisível', st.traps.length === 0 && invis(E, x),
        JSON.stringify({ traps: st.traps.length, invis: invis(E, x) }));
})();

/* 4. Mirar o invisível: casa única 'enemy' não, 'any' e área sim, raio não salta. */
(function () {
  const st = sala(E, 0, [{ classId: 'espadachim', heroId: 'h1' }]);
  const h = st.units.find((u) => u.kind === 'hero');
  const m = st.units.find((u) => u.defId === 'pv-alvo');
  ateAVezDe(E, st, h);
  h.x = 2; h.y = 3; m.x = 5; m.y = 3;
  h.spells.push('pv-furo', 'pv-tiro', 'pv-bola', 'pv-raio');
  m.effects.push({ type: 'invisible', duration: 3, sourceUid: m.uid });
  check('feitiço \'enemy\' de casa única: a casa do invisível não é alvo', E.validTargetCell(st, h, J.DATA.spells['pv-furo'], 5, 3) === false);
  check('castTargets não pinta a casa do invisível', !E.castTargets(st, h.uid, 'pv-furo').some((c) => c.x === 5 && c.y === 3));
  h.pa = 20;
  check('Engine.cast recusa o furo no invisível', E.cast(st, h.uid, 'pv-furo', 5, 3) === false);
  const hp0 = m.hp;
  h.pa = 20;
  check('feitiço \'any\' na casa: pega às cegas', E.cast(st, h.uid, 'pv-tiro', 5, 3) === true && m.hp < hp0, m.hp + ' / ' + hp0);
  const hp1 = m.hp;
  h.pa = 20;
  check('área mirada ao lado: pega quem está dentro', E.cast(st, h.uid, 'pv-bola', 4, 3) === true && m.hp < hp1, m.hp + ' / ' + hp1);
  check('o golpe recebido não tira das sombras', invis(E, m));
  // o raio: um alvo visível em (4,3) e o invisível em (5,3), a 1 casa
  const st2 = sala(E, 0, [{ classId: 'espadachim', heroId: 'h1' }, { classId: 'espadachim', heroId: 'h2' }]);
  const hh = st2.units.find((u) => u.kind === 'hero' && u.uid === E.activeUnit(st2).uid) || st2.units.find((u) => u.kind === 'hero');
  const alvo = st2.units.find((u) => u.defId === 'pv-alvo');
  // o segundo "monstro": o outro herói trocado de lado não serve; usa um alvo a mais
  const extra = JSON.parse(JSON.stringify(alvo)); extra.uid = 'pv-extra'; extra.x = 6; extra.y = 3; st2.units.push(extra);
  hh.x = 2; hh.y = 3; alvo.x = 5; alvo.y = 3;
  extra.effects = [{ type: 'invisible', duration: 3, sourceUid: extra.uid }];
  hh.spells.push('pv-raio'); hh.pa = 20;
  E.events.length = 0;
  E.cast(st2, hh.uid, 'pv-raio', 5, 3);
  const saltos = E.events.filter((e) => e.type === 'chainHop').map((e) => e.uid);
  check('o raio em cadeia não salta para o invisível ao lado', saltos.indexOf(alvo.uid) >= 0 && saltos.indexOf('pv-extra') < 0,
        JSON.stringify(saltos));
})();

/* 5. Andar: esbarra e para antes; a prévia não pinta âmbar por ele; ele fixa. */
(function () {
  const st = sala(E, 0, [{ classId: 'espadachim', heroId: 'h1' }]);
  const h = st.units.find((u) => u.kind === 'hero');
  const m = st.units.find((u) => u.defId === 'pv-alvo');
  ateAVezDe(E, st, h);
  h.x = 1; h.y = 3; m.x = 3; m.y = 3; h.pp = 6;
  m.effects.push({ type: 'invisible', duration: 3, sourceUid: m.uid });
  const alc = E.reachable(st, h.uid);
  check('a prévia do caminho inclui a casa do invisível (ela parece chão)', alc.some((c) => c.x === 3 && c.y === 3));
  const cam = E.path(st, h.uid, 5, 3);
  check('o caminho planejado atravessa a casa dele', !!cam && cam.some((c) => c.x === 3 && c.y === 3), JSON.stringify(cam));
  E.events.length = 0;
  const ok = E.move(st, h.uid, 5, 3);
  check('andando, esbarra e para na casa anterior', ok === true && h.x === 2 && h.y === 3, JSON.stringify([h.x, h.y]));
  check('só o trecho andado custa PP (6 → 5)', h.pp === 5, h.pp);
  check('o motor avisa o esbarrão (evento + diário)', E.events.some((e) => e.type === 'esbarrou') &&
        E.events.some((e) => e.type === 'log' && /esbarra/.test(e.text)));
  E.events.length = 0;
  const de2 = E.move(st, h.uid, 4, 3);
  check('colado nele, andar para a casa dele de novo: não sai do lugar e não gasta nada',
        de2 === false && h.x === 2 && h.pp === 5 && E.events.some((e) => e.type === 'esbarrou'), JSON.stringify([de2, h.x, h.pp]));
  const alc2 = E.reachable(st, h.uid);
  check('a prévia não pinta âmbar por quem ela não vê', alc2.length > 0 && alc2.every((c) => !c.risky));
  // ele fixa de verdade: trava a esquiva no mínimo e tenta sair de perto
  m.lock = 1000; m.stats && (m.stats.lock = 1000);
  const trava = E.effLock ? E.effLock(m) : 0;
  E.events.length = 0;
  const saiu = E.move(st, h.uid, 2, 5);
  const teste = E.events.find((e) => e.type === 'dodgeOk' || e.type === 'dodgeFail');
  check('o invisível ainda FIXA quem sai de perto (a emboscada)', !!teste && teste.lockerUid === m.uid,
        JSON.stringify({ saiu, trava, evs: E.events.map((e) => e.type) }));
  // a linha do diário da fixação é de QUEM ANDA (a revisão 2: "Ladino não
  // escapa de Minotauro" sem uid dizia ao adversário ao lado de quem ele está)
  if (teste && teste.type === 'dodgeFail') {
    const linha = E.events.find((e) => e.type === 'log' && /não escapa/.test(e.text));
    check('a linha "não escapa de" leva o uid de quem anda', !!linha && linha.uid === h.uid, JSON.stringify(linha));
  }
  // o inverso: o invisível tenta sair de perto de quem trava e falha
  m.effects = []; h.effects.push({ type: 'invisible', duration: 3, sourceUid: h.uid });
  h.lock = 0; m.dodge = -1000; m.stats && (m.stats.dodge = -1000);
  let falhou = null;
  for (let tent = 0; tent < 30 && !falhou; tent++) {
    const s2 = sala(E, 0, [{ classId: 'espadachim', heroId: 'h1' }], 100 + tent);
    const h2 = s2.units.find((u) => u.kind === 'hero'), m2 = s2.units.find((u) => u.defId === 'pv-alvo');
    ateAVezDe(E, s2, h2);
    h2.x = 2; h2.y = 3; m2.x = 3; m2.y = 3; h2.pp = 6;
    m2.lock = 1000; m2.stats && (m2.stats.lock = 1000);
    h2.effects.push({ type: 'invisible', duration: 3, sourceUid: h2.uid });
    E.events.length = 0;
    E.move(s2, h2.uid, 1, 5);
    if (E.events.some((e) => e.type === 'dodgeFail')) falhou = { h2, evs: E.events.slice() };
  }
  if (falhou) {
    const l2 = falhou.evs.find((e) => e.type === 'log' && /não escapa/.test(e.text));
    check('o invisível que não escapa: a linha leva o uid DELE (a tela do outro lado a cala)', !!l2 && l2.uid === falhou.h2.uid, JSON.stringify(l2));
  } else {
    check('achou uma fixação que falha para a prova da linha', false, '30 sementes sem dodgeFail');
  }
})();

/* 6. Armadilha: quem é do outro lado PARA em cima; o próprio lado passa. */
(function () {
  const st = sala(E, 1, [{ classId: 'invocador', heroId: 'x1', level: 30 }]);
  const x = st.units.find((u) => u.kind === 'hero');
  const lobo = st.units.find((u) => u.defId === 'pv-lobo');
  ateAVezDe(E, st, x);
  x.x = 3; x.y = 1; lobo.x = 8; lobo.y = 3;
  if (x.spells.indexOf('invocador-terra-5') < 0) x.spells.push('invocador-terra-5');
  x.pa = 20; x.castsThisTurn = {}; x.cooldowns = {};
  E.events.length = 0;
  const armou = E.cast(st, x.uid, 'invocador-terra-5', 5, 3);
  const set = E.events.find((e) => e.type === 'trapSet');
  check('o Xamã arma o Laço em (5,3), e o evento leva o lado de quem armou',
        armou && st.traps.length === 1 && set && set.side === x.side, JSON.stringify(set));
  // o lobo anda em linha reta de (8,3) para (4,3): passa por (5,3)
  E.endTurn(st);
  ateAVezDe(E, st, lobo);
  lobo.pp = 4;
  const hp0 = lobo.hp;
  E.events.length = 0;
  const andou = E.move(st, lobo.uid, 4, 3);
  check('quem pisa na armadilha do outro lado PARA na casa dela', andou && lobo.x === 5 && lobo.y === 3, JSON.stringify([lobo.x, lobo.y]));
  const passo = E.events.find((e) => e.type === 'move' && e.uid === lobo.uid);
  // o Laço prende (root zera o PP de vez): o que se mede é o trecho cobrado
  check('o passo cobrado é só até a armadilha (3 casas, não 4)', !!passo && passo.path.length === 3, JSON.stringify(passo && passo.path));
  check('a carga pega quem pisou (dano + preso)', lobo.hp < hp0 && E.unitHasEffect(lobo, 'root') && st.traps.length === 0,
        JSON.stringify({ hp: lobo.hp, hp0, root: E.unitHasEffect(lobo, 'root') }));
  // o próprio lado passa por cima sem parar nem disparar
  const st2 = sala(E, 1, [{ classId: 'invocador', heroId: 'x1' }]);
  const x2 = st2.units.find((u) => u.kind === 'hero');
  ateAVezDe(E, st2, x2);
  x2.x = 1; x2.y = 3; x2.pp = 6;
  st2.traps.push({ x: 3, y: 3, trapId: 'trap-terra-laco', ownerUid: x2.uid, side: x2.side, remaining: 3 });
  const passou = E.move(st2, x2.uid, 5, 3);
  check('a armadilha do próprio lado não para nem dispara', passou && x2.x === 5 && st2.traps.length === 1 && x2.pp === 2,
        JSON.stringify({ x: x2.x, traps: st2.traps.length, pp: x2.pp }));
})();

/* 7. A IA não desvia da armadilha do outro lado. A única casa ao lado do Xamã
 *    que o lobo alcança é a armada; antes (−60) ele ficava longe. */
(function () {
  const st = sala(E, 1, [{ classId: 'invocador', heroId: 'x1' }]);
  const x = st.units.find((u) => u.kind === 'hero');
  const lobo = st.units.find((u) => u.defId === 'pv-lobo');
  x.x = 2; x.y = 3; lobo.x = 7; lobo.y = 3;
  st.traps.push({ x: 3, y: 3, trapId: 'trap-terra-laco', ownerUid: x.uid, side: x.side, remaining: 3 });
  ateAVezDe(E, st, lobo);
  lobo.pp = 4; lobo.pa = 6;
  const plano = AI.planTurn(st, lobo.uid) || [];
  const passo = plano.find((a) => a.action === 'move');
  check('a IA planeja o passo até a casa armada ao lado do Xamã', !!passo && passo.x === 3 && passo.y === 3, JSON.stringify(plano));
  E.events.length = 0;
  for (const a of plano) {
    if (a.action === 'move') E.move(st, lobo.uid, a.x, a.y);
    else if (a.action === 'cast') E.cast(st, lobo.uid, a.spellId, a.x, a.y);
    else if (a.action === 'end') break;
  }
  check('e cai: a armadilha dispara nele', E.events.some((e) => e.type === 'trapTriggered' && e.uid === lobo.uid) && st.traps.length === 0);
  // a própria armadilha, para a IA do mesmo lado, não muda nada (ela nem lê state.traps)
  const st2 = sala(E, 1, [{ classId: 'invocador', heroId: 'x1' }]);
  const x2 = st2.units.find((u) => u.kind === 'hero');
  const l2 = st2.units.find((u) => u.defId === 'pv-lobo');
  x2.x = 2; x2.y = 3; l2.x = 7; l2.y = 3;
  ateAVezDe(E, st2, l2);
  l2.pp = 4; l2.pa = 6;
  const semArmadilha = JSON.stringify(AI.planTurn(st2, l2.uid));
  st2.traps.push({ x: 3, y: 3, trapId: 'trap-terra-laco', ownerUid: l2.uid, side: l2.side, remaining: 3 });
  check('a armadilha do próprio lado não muda o plano da IA', JSON.stringify(AI.planTurn(st2, l2.uid)) === semArmadilha);
})();

/* 8. A marca do turno no hash: existe → entra; some no fim do turno. */
(function () {
  const st = sala(E, 0, [{ classId: 'espadachim', heroId: 'h1' }]);
  const h = st.units.find((u) => u.kind === 'hero');
  ateAVezDe(E, st, h);
  h.pa = 20; h.castsThisTurn = {}; h.cooldowns = {};
  E.cast(st, h.uid, 'espadachim-neutro-2', h.x, h.y);
  const com = E.hash(st);
  const ef = h.effects.find((e) => e.type === 'invisible');
  const guardada = ef.lancadoNoTurno; delete ef.lancadoNoTurno;
  const sem = E.hash(st);
  ef.lancadoNoTurno = guardada;
  check('a marca do turno entra no hash enquanto vive', com !== sem);
  const foto = JSON.parse(JSON.stringify(st));
  check('e vai na foto (JSON)', foto.units.find((u) => u.uid === h.uid).effects.some((e) => e.lancadoNoTurno === guardada));
})();

/* 9. A fusão que bate e some: a invisibilidade nunca vai para o outro lado, e
 *    quem some é o conjurador (a revisão: o Espectro escondia os monstros
 *    atingidos do próprio time). */
(function () {
  const F = J.Fusion;
  for (const [par, tier, nome] of [['espadachim+invocador', 15, 'Espectro'], ['espadachim+minotauro', 10, 'Beco']]) {
    const f = F.spellsFor(par, 'neutro+neutro', 30).find((s) => s.tier === tier);
    if (!f) { check(nome + ': a forma existe', false); continue; }
    E.registerSpell(f);
    const st = sala(E, 0, [{ classId: 'espadachim', heroId: 'h1', level: 30 }, { classId: 'arqueiro', heroId: 'h2', level: 30 }]);
    const hs = st.units.filter((u) => u.kind === 'hero');
    const A = hs[0], C = hs[1];
    ateAVezDe(E, st, A);
    const m = st.units.find((u) => u.defId === 'pv-alvo');
    A.x = 4; A.y = 3; C.x = 1; C.y = 1; m.x = 5; m.y = 3;
    if (nome === 'Beco') { A.x = 3; }
    A.spells.push(f.id); A.pa = 30; A.castsThisTurn = {}; A.cooldowns = {};
    const tx = nome === 'Beco' ? 4 : m.x, ty = m.y;
    const ok = E.cast(st, A.uid, f.id, tx, ty);
    C.spells.push('pv-furo');
    check(nome + ': lança, o monstro atingido NÃO fica invisível e o time segue mirando nele',
          ok && !invis(E, m) && !E.ocultoDe(C, m),       // (o muro do Beco pode tapar a visão: a régua é ocultoDe)
          JSON.stringify({ ok, m: invis(E, m) }));
    check(nome + ': quem some é o conjurador, como o texto promete', invis(E, A));
  }
})();

/* 10. Raio em cadeia tira das sombras; o veneno em si mesmo não. */
(function () {
  const st = sala(E, 0, [{ classId: 'espadachim', heroId: 'h1' }]);
  const h = st.units.find((u) => u.kind === 'hero');
  const m = st.units.find((u) => u.defId === 'pv-alvo');
  ateAVezDe(E, st, h);
  h.x = 4; h.y = 3; m.x = 5; m.y = 3;
  h.spells.push('pv-raio'); h.pa = 20;
  h.effects.push({ type: 'invisible', duration: 2, sourceUid: h.uid });
  E.cast(st, h.uid, 'pv-raio', m.x, m.y);
  check('raio em cadeia do invisível: acerta e ele sai das sombras', !invis(E, h));
  const veias = J.DATA.spells['espadachim-fogo-12'];
  if (veias && veias.targetSide === 'self') {
    h.effects.push({ type: 'invisible', duration: 2, sourceUid: h.uid });
    h.spells.push(veias.id); h.pa = 20; h.cooldowns = {}; h.castsThisTurn = {};
    E.cast(st, h.uid, veias.id, h.x, h.y);
    check('veneno em si mesmo (Veias em Chamas) não tira das sombras', invis(E, h));
  }
})();

/* 11. A recarga da invisibilidade é uma só: Sombra e Névoa alternadas não
 *     cobrem mais 100% das vezes do inimigo. */
(function () {
  const st = sala(E, 0, [{ classId: 'espadachim', heroId: 'h1', level: 30 }]);
  const h = st.units.find((u) => u.kind === 'hero');
  const m = st.units.find((u) => u.defId === 'pv-alvo');
  ateAVezDe(E, st, h);
  for (const s of ['espadachim-neutro-2', 'espadachim-agua-10']) if (h.spells.indexOf(s) < 0) h.spells.push(s);
  h.pa = 20; h.cooldowns = {}; h.castsThisTurn = {};
  E.cast(st, h.uid, 'espadachim-neutro-2', h.x, h.y);
  check('lançar a Sombra põe a Névoa na mesma recarga', (h.cooldowns['espadachim-agua-10'] || 0) === (h.cooldowns['espadachim-neutro-2'] || 0) &&
        h.cooldowns['espadachim-agua-10'] > 0, JSON.stringify(h.cooldowns));
  // tenta cobrir tudo lançando a que estiver pronta em todo turno dele
  let vezes = 0, vistas = 0;
  for (let p = 0; p < 60; p++) {
    const a = E.activeUnit(st);
    if (a.uid === m.uid) { vezes++; if (!invis(E, h)) vistas++; }
    if (a.uid === h.uid) {
      h.pa = 20;
      for (const s of ['espadachim-neutro-2', 'espadachim-agua-10']) if (E.cast(st, h.uid, s, h.x, h.y)) break;
    }
    E.endTurn(st);
  }
  check('alternando as duas, o Ladino ainda aparece em metade das vezes do inimigo', vezes >= 20 && vistas * 2 >= vezes - 2,
        vistas + ' de ' + vezes + ' à vista');
})();

/* 12. A armadilha em círculo não pega o próprio Xamã vivo ao lado dela. */
(function () {
  const st = sala(E, 1, [{ classId: 'invocador', heroId: 'x1', level: 30 }]);
  const x = st.units.find((u) => u.kind === 'hero');
  const lobo = st.units.find((u) => u.defId === 'pv-lobo');
  x.x = 3; x.y = 3; lobo.x = 7; lobo.y = 3;
  st.traps.push({ x: 4, y: 3, trapId: 'trap-fogo-brasa', ownerUid: x.uid, side: x.side, remaining: 3 });
  ateAVezDe(E, st, lobo);
  lobo.pp = 4;
  const hpX = x.hp, hpL = lobo.hp;
  E.move(st, lobo.uid, 4, 3);
  check('a Brasa em círculo pega quem pisou e não o Xamã ao lado', lobo.hp < hpL && x.hp === hpX,
        JSON.stringify({ xamã: [hpX, x.hp], lobo: [hpL, lobo.hp] }));
})();

/* 13. Mirar às cegas a casa do invisível com feitiço de casa vazia: o motor
 *     recusa sem gastar nada e avisa; a tela julga a casa como vazia. */
(function () {
  const st = sala(E, 0, [{ classId: 'invocador', heroId: 'x1', level: 30 }]);
  const x = st.units.find((u) => u.kind === 'hero');
  const m = st.units.find((u) => u.defId === 'pv-alvo');
  ateAVezDe(E, st, x);
  x.x = 2; x.y = 3; m.x = 4; m.y = 3;
  m.effects.push({ type: 'invisible', duration: 3, sourceUid: m.uid });
  const est = J.DATA.spells['invocador-neutro-3'];
  if (x.spells.indexOf(est.id) < 0) x.spells.push(est.id);
  x.pa = 20; x.cooldowns = {}; x.castsThisTurn = {};
  check('Engine.podeLancar existe e diz se o feitiço sai agora', typeof E.podeLancar === 'function' && E.podeLancar(st, x.uid, est.id) === true);
  check('validTargetCell(..., vazia): a casa do invisível vale como chão livre', E.validTargetCell(st, x, est, 4, 3, true) === true &&
        E.validTargetCell(st, x, est, 4, 3) === false);
  const pa0 = x.pa;
  E.events.length = 0;
  const ok = E.cast(st, x.uid, est.id, 4, 3);
  check('lançar ali é recusado, sem gastar PA e sem armadilha, com o aviso', ok === false && x.pa === pa0 && st.traps.length === 0 &&
        E.events.some((e) => e.type === 'log' && /não se vê/.test(e.text)), JSON.stringify(E.events));
})();

/* 14. A IA do lado do jogador (pet, invocação) ainda desvia da armadilha de
 *     MONSTRO fora do PvP — ela está à vista do jogador. */
(function () {
  const st = sala(E, 1, [{ classId: 'invocador', heroId: 'x1' }]);
  const alvo = st.units.find((u) => u.kind === 'hero');
  const lobo = st.units.find((u) => u.defId === 'pv-lobo');
  // o lobo passa para o lado do jogador (uma invocação, para a IA) e o herói
  // vira o alvo do outro lado
  lobo.side = 'player'; alvo.side = 'enemy';
  alvo.x = 2; alvo.y = 3; lobo.x = 7; lobo.y = 3;
  st.traps.push({ x: 3, y: 3, trapId: 'm-cinder-trap', ownerUid: alvo.uid, side: 'enemy', remaining: 3 });
  check('fora do PvP a armadilha de monstro está à vista do jogador',
        E.armadilhaVisivel(st, 'player', st.traps[0]) === true && E.armadilhaVisivel(st, 'enemy', { side: 'player' }) === false);
  ateAVezDe(E, st, lobo);
  lobo.pp = 4; lobo.pa = 6;
  const plano = AI.planTurn(st, lobo.uid) || [];
  const passo = plano.find((a) => a.action === 'move');
  check('e a IA do lado do jogador desvia dela (não termina o passo na casa armada)', !passo || !(passo.x === 3 && passo.y === 3),
        JSON.stringify(plano));
  st.pvp = true;
  check('no PvP ninguém do outro lado a vê', E.armadilhaVisivel(st, 'player', st.traps[0]) === false);
})();

// ============================================================ a tela (game.js)
(function () {
  const W = mundoEconomico({ semente: 5, agoraMs: 1758500000000 });
  const JG = W.J;
  prepara(JG);
  const EG = JG.Engine, G = JG.Game;
  check('Game expõe ocultoNaTela, veArmadilha, eventoParaTela, alvosNaTela e telaVeTudo',
        typeof G.ocultoNaTela === 'function' && typeof G.veArmadilha === 'function' &&
        typeof G.eventoParaTela === 'function' && typeof G.alvosNaTela === 'function' && typeof G.telaVeTudo === 'function');
  const st = EG.createBattle('prova-sombra', 1, [{ classId: 'invocador', heroId: 'x1' }], { seed: 3, escolhePosicao: false });
  st.phase = 'playing';
  G.state = st;
  const x = st.units.find((u) => u.kind === 'hero');
  const lobo = st.units.find((u) => u.defId === 'pv-lobo');
  check('no solo o meu lado é o player', G.meuLado() === 'player' && G.telaVeTudo() === false);
  const minha = { x: 3, y: 3, trapId: 'trap-terra-laco', ownerUid: x.uid, side: x.side, remaining: 3 };
  const doMonstro = { x: 6, y: 3, trapId: 'm-cinder-trap', ownerUid: lobo.uid, side: lobo.side, remaining: 3 };
  check('a minha armadilha aparece na minha tela', G.veArmadilha(minha) === true);
  check('fora do PvP a armadilha de MONSTRO segue aparecendo (o pedido foi pela do Xamã)', G.veArmadilha(doMonstro) === true);
  check('e o lance dela mostra a casa', !!G.eventoParaTela({ type: 'trapSet', uid: lobo.uid, x: 6, y: 3, side: 'enemy' }));
  const golpe = { type: 'cast', uid: lobo.uid, spellId: 'pv-mordida', x: 2, y: 3 };
  check('um golpe comum do outro lado mostra a casa', G.eventoParaTela(golpe) === golpe);
  // o invisível do outro lado
  check('monstro visível não some', G.ocultoNaTela(lobo) === false);
  lobo.effects.push({ type: 'invisible', duration: 2, sourceUid: lobo.uid });
  check('monstro invisível some desta tela', G.ocultoNaTela(lobo) === true);
  for (const tipo of ['move', 'cast', 'damage', 'heal', 'shield', 'effectApplied', 'dodgeFail', 'pushed', 'teleport', 'markStack', 'fusion']) {
    check('evento \'' + tipo + '\' do invisível: calado', G.eventoParaTela({ type: tipo, uid: lobo.uid, x: 1, y: 1, path: [] }) === null);
  }
  check('linha do diário que fala dele (uid): calada', G.eventoParaTela({ type: 'log', text: 'Lobo fica preso ao chão.', uid: lobo.uid }) === null);
  check('linha do diário sem uid: passa', !!G.eventoParaTela({ type: 'log', text: 'Lobo conjura Véu.' }));
  for (const tipo of ['turnStart', 'death', 'trapTriggered', 'tileEvent', 'battleEnd']) {
    check('evento \'' + tipo + '\' é público mesmo do invisível', !!G.eventoParaTela({ type: tipo, uid: lobo.uid }));
  }
  x.effects.push({ type: 'invisible', duration: 2, sourceUid: x.uid });
  check('o MEU invisível continua na minha tela (o vulto de 30%)', G.ocultoNaTela(x) === false &&
        !!G.eventoParaTela({ type: 'move', uid: x.uid, path: [] }));
  x.effects = [];
  lobo.alive = false;
  check('morto não é oculto (a morte aparece)', G.ocultoNaTela(lobo) === false);
  lobo.alive = true;
  // o destaque de alvo e o toque: a casa do invisível é chão livre para esta tela
  x.x = 2; x.y = 3; lobo.x = 4; lobo.y = 3;
  st.activeIdx = st.order.indexOf(x.uid);
  x.pa = 20; x.pp = 6; x.cooldowns = {}; x.castsThisTurn = {};
  const est = 'invocador-neutro-3';
  if (x.spells.indexOf(est) < 0) x.spells.push(est);
  const naTela = G.alvosNaTela(x.uid, est), doMotor = EG.castTargets(st, x.uid, est);
  check('Estaca-Alarme: o destaque inclui a casa do invisível (sem buraco)', naTela.some((c) => c.x === 4 && c.y === 3) &&
        !doMotor.some((c) => c.x === 4 && c.y === 3) && naTela.length === doMotor.length + 1);
  x.pa = 0;
  check('sem PA o feitiço não sai: nenhuma casa, nem a dele', G.alvosNaTela(x.uid, est).length === 0);
  x.pa = 20;
  G.screen = 'battle'; G.selectedSpellId = null;
  if (typeof G.isPlayerTurn === 'function' && G.isPlayerTurn()) {
    EG.events.length = 0;
    G.onTileClicked(4, 3);
    check('tocar na casa do invisível para andar: esbarra e para antes (o passo sai)', x.x === 3 && x.y === 3 &&
          EG.events.some((e) => e.type === 'esbarrou'), JSON.stringify({ x: [x.x, x.y], evs: EG.events.map((e) => e.type) }));
  } else {
    check('é a vez do herói para a prova do toque', false, 'isPlayerTurn falso');
  }
  lobo.effects = [];
  // o duelo no mesmo teclado: não há de quem esconder
  st.pvp = true;
  lobo.effects.push({ type: 'invisible', duration: 2, sourceUid: lobo.uid });
  check('duelo no mesmo teclado: tudo aparece', G.telaVeTudo() === true && G.ocultoNaTela(lobo) === false &&
        G.veArmadilha({ side: 'enemy' }) === true && !!G.eventoParaTela({ type: 'trapSet', uid: lobo.uid, side: 'enemy' }));
  G.state = null;
  check('sem batalha, o evento passa como veio', !!G.eventoParaTela({ type: 'move', uid: 'x' }));
})();

/* O duelo EM REDE, visto da tela de B: o Ladino e o Xamã de A. */
(function () {
  const W = mundoEconomico({ semente: 7, agoraMs: 1758500000000 });
  const JG = W.J;
  prepara(JG);
  const EG = JG.Engine, G = JG.Game, F = JG.Fusion;
  const dg = (JG.DATA.dungeons || [])[0];
  const mk = (cls, id, dono) => ({ classId: cls, heroId: id, level: 30, element: 'neutro', dono });
  const ok = G._iniciaDueloRede({ did: 'prova', dungeonId: dg.id, roomIndex: 0, semente: 9,
    duplaA: [mk('espadachim', 'a1', 'A'), mk('invocador', 'a2', 'A')],
    duplaB: [mk('invocador', 'b1', 'B'), mk('arqueiro', 'b2', 'B')],
    eu: 'B', meuId: 'B', oponente: 'A' });
  const st = G.state;
  check('duelo em rede montado; esta tela é a de B (lado enemy), sem ver tudo',
        ok && st && st.pvp === true && G.meuLado() === 'enemy' && G.telaVeTudo() === false);
  if (!st) return;
  st.phase = 'playing';
  const a1 = st.units.find((u) => u.heroId === 'a1'), a2 = st.units.find((u) => u.heroId === 'a2');
  const b1 = st.units.find((u) => u.heroId === 'b1');
  const trA = { x: 3, y: 3, trapId: 'trap-terra-laco', ownerUid: a2.uid, side: a2.side, remaining: 3 };
  const trB = { x: 5, y: 3, trapId: 'trap-terra-laco', ownerUid: b1.uid, side: b1.side, remaining: 3 };
  check('a armadilha do Xamã de A NÃO aparece na tela de B', G.veArmadilha(trA) === false);
  check('a do meu Xamã aparece', G.veArmadilha(trB) === true);
  check('trapSet de A: calado na tela de B', G.eventoParaTela({ type: 'trapSet', uid: a2.uid, x: 3, y: 3, side: a2.side }) === null);
  check('trapSet de A sem `side` (evento velho): acha o lado pelo uid', G.eventoParaTela({ type: 'trapSet', uid: a2.uid, x: 3, y: 3 }) === null);
  check('trapExpired de A: calado', G.eventoParaTela({ type: 'trapExpired', x: 3, y: 3, side: a2.side }) === null);
  const lanceA = { type: 'cast', uid: a2.uid, spellId: 'invocador-terra-5', x: 3, y: 3, fxKey: 'snareTrapSet' };
  const visto = G.eventoParaTela(lanceA);
  check('o lance de armadilha de A aparece conjurando, sem a casa', !!visto && visto !== lanceA && visto.x === null &&
        visto.y === null && lanceA.x === 3, JSON.stringify(visto));
  const lanceB = { type: 'cast', uid: b1.uid, spellId: 'invocador-terra-5', x: 5, y: 3 };
  check('o lance do meu Xamã mostra a casa', G.eventoParaTela(lanceB) === lanceB);
  // a fusão com armadilha: a forma sempre junta outro efeito (cura, bênção…)
  const fusTrap = F.spellsFor('espadachim+invocador', 'neutro+neutro', 30)
    .find((s) => (s.effects || []).some((e) => e.type === 'trap') && (s.effects || []).some((e) => e.type !== 'trap'));
  if (fusTrap) {
    EG.registerSpell(fusTrap);
    const lf = G.eventoParaTela({ type: 'cast', uid: a1.uid, spellId: fusTrap.id, x: 4, y: 4 });
    check('fusão com armadilha (' + fusTrap.name + ', ' + fusTrap.effects.map((e) => e.type).join('+') + '): a casa também some',
          !!lf && lf.x === null && lf.y === null, JSON.stringify(lf));
  } else {
    check('há forma de fusão com armadilha e outro efeito para a prova', false);
  }
  // o Ladino de A invisível
  a1.effects.push({ type: 'invisible', duration: 2, sourceUid: a1.uid });
  check('o Ladino invisível de A some da tela de B', G.ocultoNaTela(a1) === true);
  check('o passo, o golpe e a fusão dele: calados', ['move', 'cast', 'damage', 'fusion'].every((t) =>
        G.eventoParaTela({ type: t, uid: a1.uid, x: 1, y: 1, path: [] }) === null));
  check('Engine.ocultoDe(b1, a1): para a unidade de B ele não existe', EG.ocultoDe(b1, a1) === true && EG.ocultoDe(a2, a1) === false);
  G.state = null;
})();

console.log('\n' + (total - falhas) + ' / ' + total + ' passaram' + (falhas ? ' — ' + falhas + ' FALHARAM' : ''));
process.exit(falhas ? 1 : 0);
