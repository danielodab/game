#!/usr/bin/env node
'use strict';
/* PROVA DAS POÇÕES DE VIDA — o motor, a sala refeita, o fechamento e a banca no juiz.
 *
 *   node tests/juiz_pocoes.js
 *
 * O pedido do dono (13/09): "no mercadinho do jogo deve ter poções à venda por vinténs.
 * poções que carregam a vida vão para consumíveis no inventário". Cobra:
 *   - o motor (Engine.usePotion): cura o valor certo sem passar do PV máximo, gasta 2 PA,
 *     uma por turno, recusa sem PA, de PV cheio, fora da vez e no DUELO;
 *   - a sala refeita (sala.js) com o gole chega ao mesmo fim, e o gole mentido cai;
 *   - o fechamento (recompensa.js) desconta do estado DO SERVIDOR as poções bebidas — na
 *     vitória e na sala largada — e recusa a sala que bebeu mais do que a conta tinha;
 *   - em grupo cada membro gasta as próprias;
 *   - a op comprarPocao (economia.js) debita o saco e soma o contador, com o mesmo hash da
 *     tela; recusa sem vinténs no saco (o banco não conta) e acima do teto de 20. */
const path = require('path');
const { mundo } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'motor.js'));
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
const { refaz, ehDoJogador, aplicaCarry } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));
const { fecha, fechaGrupo } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'recompensa.js'));
const { executa } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'economia.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
function pega(fn) {
  try { return { ok: true, r: fn() }; } catch (e) { return { ok: false, motivo: e.motivo, msg: e.message }; }
}
const AGORA = Date.UTC(2026, 8, 13, 15, 0, 0);
const PEQ = 'pocao-pequena', MED = 'pocao-media', GRA = 'pocao-grande';

/* a IA dos outros até a vez voltar ao jogador */
function ateMinhaVez(J, st) {
  const E = J.Engine;
  let n = 0;
  while (st.phase === 'playing' && n++ < 500) {
    const u = E.activeUnit(st);
    if (!u || ehDoJogador(st, u)) return u;
    const plano = J.AI.planTurn(st, u.uid) || [];
    let acabou = false;
    for (const a of (plano.length ? plano : [{ action: 'end' }])) {
      if (st.phase !== 'playing') break;
      if (a.action === 'move') E.move(st, u.uid, a.x, a.y);
      else if (a.action === 'cast') E.cast(st, u.uid, a.spellId, a.x, a.y);
      else if (a.action === 'end') { E.endTurn(st); acabou = true; break; }
    }
    if (!acabou && st.phase === 'playing') E.endTurn(st);
    E.events.length = 0;
  }
  return null;
}

// ================================================================ o motor
(function () {
  const J = mundo().JOGO, E = J.Engine;
  const D = J.DATA.consumiveis || {};
  check('os dados carregam no juiz: três poções de vida com 30/70/150 PV e 40/110/260 vinténs, teto 20, 2 PA',
        D[PEQ] && D[PEQ].cura === 30 && D[PEQ].preco === 40 && D[MED].cura === 70 && D[MED].preco === 110 &&
        D[GRA].cura === 150 && D[GRA].preco === 260 && J.DATA.consumiveisRegras.teto === 20 && E.pocaoPa() === 2);

  const party = [{ heroId: 'sumo', classId: 'sumo', element: 'neutro', level: 30 }];
  const st = E.createBattle('cistern', 0, party, { seed: 7, dificuldade: 'normal', escolhePosicao: false });
  E.events.length = 0;
  const u = ateMinhaVez(J, st);
  check('a vez chega ao herói', !!u && u.kind === 'hero');
  if (!u) return;
  u.hp = u.hpMax;
  check('de PV cheio a poção é recusada (o gole iria embora)', E.podePocao(st, u.uid, PEQ) === 'cheio' && !E.usePotion(st, u.uid, PEQ));
  u.hp = u.hpMax - 50;
  const pa0 = u.pa, hp0 = u.hp;
  E.events.length = 0;
  const ok1 = E.usePotion(st, u.uid, PEQ);
  const cura = E.events.find((ev) => ev.type === 'heal');
  check('a Pequena cura 30 PV e gasta 2 PA', ok1 && u.hp === hp0 + 30 && u.pa === pa0 - 2 && cura && cura.amount === 30,
        JSON.stringify({ ok1, hp: u.hp, hp0, pa: u.pa, pa0 }));
  check('o motor emite o evento da poção (o som e o FX da cura vêm do heal)', E.events.some((ev) => ev.type === 'pocao' && ev.pocaoId === PEQ));
  const hpA = u.hp, paA = u.pa;
  check('a segunda poção na mesma vez é recusada', E.podePocao(st, u.uid, MED) === 'usada' && !E.usePotion(st, u.uid, MED) &&
        u.hp === hpA && u.pa === paA);
  const outro = st.units.find((x) => x.side === 'enemy' && x.alive);
  check('a poção de quem não tem a vez é recusada', E.podePocao(st, outro.uid, PEQ) === 'vez' && !E.usePotion(st, outro.uid, PEQ));

  E.endTurn(st); E.events.length = 0;
  const u2 = ateMinhaVez(J, st);
  check('na vez seguinte pode beber de novo', !!u2 && u2.uid === u.uid && E.podePocao(st, u.uid, MED) !== 'usada');
  u.hp = u.hpMax - 10;
  const paB = u.pa;
  check('a Média com 10 PV faltando cura só 10 (não passa do máximo)', E.usePotion(st, u.uid, MED) && u.hp === u.hpMax && u.pa === paB - 2);
  E.endTurn(st); E.events.length = 0;
  ateMinhaVez(J, st);
  u.hp = 5; u.pa = 1;
  check('sem os 2 PA a poção é recusada', E.podePocao(st, u.uid, GRA) === 'pa' && !E.usePotion(st, u.uid, GRA) && u.hp === 5);
  u.pa = 6;
  check('poção que não existe é recusada', E.podePocao(st, u.uid, 'pocao-de-mentira') === 'pocao' && !E.usePotion(st, u.uid, 'pocao-de-mentira'));
  const h1 = E.hash(st);
  E.usePotion(st, u.uid, GRA);
  check('a Grande cura 150 e o gole muda o hash da batalha (PA, PV e a marca da vez)', u.hp === Math.min(u.hpMax, 155) && E.hash(st) !== h1);

  // ---- o duelo
  const dA = [{ heroId: 'sumo', classId: 'sumo', element: 'neutro', level: 20, dono: 'a' }];
  const dB = [{ heroId: 'curandeiro', classId: 'curandeiro', element: 'neutro', level: 20, dono: 'b' }];
  const du = E.createDuelSala('cistern', 0, dA, dB, { seed: 9 });
  const ud = E.activeUnit(du);
  ud.hp = ud.hpMax - 60;
  check('no DUELO o motor recusa a poção', du.pvp && E.podePocao(du, ud.uid, PEQ) === 'duelo' && !E.usePotion(du, ud.uid, PEQ));
})();

// ================================================================ a conta de partida
function conta(nivel, pocoes, moedas) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 1 });
  est.poeEstado(w, null, null);
  const J = w.J, P = J.Progress;
  const h = P.state.heroes.sumo;
  h.level = nivel; h.xp = J.DATA.leveling.xpTable[nivel - 1];
  P.save();
  Object.keys(pocoes || {}).forEach((id) => P.poeConsumivel(id, pocoes[id]));
  if (moedas) J.DB.ganharMoedas(moedas);
  return est.tiraEstado(w);
}

/* o cliente joga no mundo dele: colocação, a IA decide, e o herói ferido bebe no começo da vez */
function clienteJoga(c, dg, ri, semente, carry, bebe, corta) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 7 });
  est.poeEstado(w, c.progress, c.db);
  const J = w.J, E = J.Engine;
  const st = E.createBattle(dg, ri, J.Progress.battleParty(['sumo']), { seed: semente, dificuldade: 'normal', escolhePosicao: true });
  aplicaCarry(st, carry);
  E.events.length = 0;
  const lances = [];
  const op = E.placementOptions(st)[0];
  lances.push({ a: 'p', x: op.x, y: op.y, ok: !!E.place(st, op.x, op.y) });
  E.events.length = 0;
  const resta = Object.assign({}, bebe || {}), bebidas = {};
  let voltas = 0;
  fora: while (st.phase === 'playing' && voltas++ < 3000) {
    const u = E.activeUnit(st);
    if (!u) break;
    const meu = ehDoJogador(st, u);
    if (meu) {
      const id = Object.keys(resta).find((k) => resta[k] > 0 && !E.podePocao(st, u.uid, k));
      if (id) {
        const ok = !!E.usePotion(st, u.uid, id);
        lances.push({ a: 'po', u: u.uid, s: id, ok });
        if (ok) { resta[id]--; bebidas[id] = (bebidas[id] || 0) + 1; }
        E.events.length = 0;
        if (corta && lances.length >= corta) break fora;
      }
    }
    const plano = J.AI.planTurn(st, u.uid) || [];
    let acabou = false;
    for (const a of (plano.length ? plano : [{ action: 'end' }])) {
      if (st.phase !== 'playing') break;
      if (a.action === 'move') { const ok = !!E.move(st, u.uid, a.x, a.y); if (meu) lances.push({ a: 'm', u: u.uid, x: a.x, y: a.y, ok }); }
      else if (a.action === 'cast') { const ok = !!E.cast(st, u.uid, a.spellId, a.x, a.y); if (meu) lances.push({ a: 'c', u: u.uid, s: a.spellId, x: a.x, y: a.y, ok }); }
      else if (a.action === 'end') { E.endTurn(st); if (meu) lances.push({ a: 'e', ok: true }); acabou = true; break; }
      E.events.length = 0;
    }
    if (!acabou && st.phase === 'playing') { E.endTurn(st); if (meu) lances.push({ a: 'e', ok: true }); }
    E.events.length = 0;
  }
  return { lances, fase: st.phase, hash: E.hash(st), bebidas };
}
function pedido(c, dg, ri, s, carry, jogo, extra) {
  return Object.assign({
    conta: { id: 1, gm: false },
    bilhete: { dungeonId: dg, roomIndex: ri, dificuldade: 'normal', semente: s, herois: ['sumo'], carry },
    lances: jogo.lances, hashFinal: jogo.hash, progress: c.progress, db: c.db,
    contexto: { agoraMs: AGORA, fatores: {}, guilda: {} }
  }, extra || {});
}

// ================================================================ a sala refeita e o fechamento
(function () {
  const c = conta(22, { [PEQ]: 20, [MED]: 1 });
  check('a conta guarda as poções no Progress (contadores, sem série)',
        c.progress.consumiveis && c.progress.consumiveis[PEQ] === 20 && c.progress.consumiveis[MED] === 1 &&
        !c.progress.inventory.some((e) => /pocao/.test(e.itemId)));
  // sem PV que atravessa (o herói se fere na sala mesmo) e com poção à vontade: dois goles só
  // custam 4 PA e a vitória; a IA ferida que bebe toda vez fecha a sala
  const carry = null;
  let achado = null;
  const tentativas = [];
  for (const [dg, ri] of [['cistern', 0], ['greenhouse', 0], ['cistern', 1], ['greenhouse', 1]]) {
    for (const s of [11, 29, 53, 97, 131]) {
      const j = clienteJoga(c, dg, ri, s, carry, { [PEQ]: 20 });
      tentativas.push(dg + '#' + ri + '/' + s + ':' + j.fase + ':' + JSON.stringify(j.bebidas));
      if (j.fase === 'won' && (j.bebidas[PEQ] || 0) >= 1) { achado = { dg, ri, s, j }; break; }
    }
    if (achado) break;
  }
  check('o cliente vence uma sala bebendo poção', !!achado, tentativas.join(' '));
  if (!achado) return;
  const { dg, ri, s, j } = achado;
  const n = j.bebidas[PEQ];
  console.log('   sala ' + dg + '#' + ri + ' semente ' + s + ' · bebeu ' + n + ' Pequena(s)');

  const rf = pega(() => refaz({ dungeonId: dg, roomIndex: ri, dificuldade: 'normal', semente: s,
                                party: mundoParty(c), carry, lances: j.lances, hashFinal: j.hash }));
  check('o juiz refaz a sala com o gole e chega ao MESMO fim, contando as poções bebidas',
        rf.ok && rf.r.fase === 'won' && rf.r.hash === j.hash && rf.r.pocoes[PEQ] === n, JSON.stringify(rf.ok ? rf.r.pocoes : rf));

  const r = pega(() => fecha(pedido(c, dg, ri, s, carry, j)));
  check('o fechamento paga a vitória e DESCONTA as poções do estado do servidor',
        r.ok && r.r.fase === 'won' && r.r.recompensa && ((r.r.progress.consumiveis || {})[PEQ] || 0) === 20 - n &&
        r.r.progress.consumiveis[MED] === 1, JSON.stringify(r.ok ? r.r.progress.consumiveis : r));
  if (r.ok) {
    const wc = est.mundoEconomico({ agoraMs: AGORA });
    check('o hash devolvido é o Economia.hash do estado com as poções descontadas', r.r.hash === wc.J.Economia.hash(r.r.progress, r.r.db));
  }

  const sem = conta(22, { [MED]: 1 });
  const r2 = pega(() => fecha(pedido(sem, dg, ri, s, carry, j)));
  check('a sala que bebeu mais Pequenas do que a conta tinha é recusada (pocoes)', !r2.ok && r2.motivo === 'pocoes', JSON.stringify(r2));
  const pouca = conta(22, { [PEQ]: Math.max(0, n - 1) });
  const r2b = pega(() => fecha(pedido(pouca, dg, ri, s, carry, j)));
  check('... e a que tinha uma a menos também', !r2b.ok && r2b.motivo === 'pocoes', JSON.stringify(r2b));

  const iPo = j.lances.findIndex((l) => l.a === 'po' && l.ok);
  const mentido = j.lances.slice(0, iPo + 1).concat([Object.assign({}, j.lances[iPo], { s: MED, ok: true })], j.lances.slice(iPo + 1));
  const r3 = pega(() => fecha(pedido(c, dg, ri, s, carry, { lances: mentido, hash: j.hash })));
  check('a segunda poção na mesma vez dita como certa cai (divergiu)', !r3.ok && r3.motivo === 'divergiu', JSON.stringify(r3));

  // a sala largada logo depois do gole: nada de recompensa, mas a poção foi bebida
  const largada = j.lances.slice(0, iPo + 1);
  const r4 = pega(() => fecha(pedido(c, dg, ri, s, carry, { lances: largada, hash: undefined })));
  check('a sala largada não paga, mas as poções bebidas saem do estado',
        r4.ok && r4.r.fase !== 'won' && r4.r.recompensa === null && (r4.r.progress.consumiveis || {})[PEQ] === 19 &&
        r4.r.hash !== r4.r.hashAntes, JSON.stringify(r4.ok ? { f: r4.r.fase, c: r4.r.progress.consumiveis } : r4));
  const semGole = j.lances.slice(0, 1);
  const r5 = pega(() => fecha(pedido(c, dg, ri, s, carry, { lances: semGole, hash: undefined })));
  check('a sala largada sem poção não muda o estado (hash igual)', r5.ok && r5.r.hash === r5.r.hashAntes);

  // a poção que acaba no meio: gastar tudo apaga o contador
  const uma = conta(22, { [PEQ]: 1 });
  const jUma = clienteJoga(uma, dg, ri, s, carry, { [PEQ]: 1 }, iPo + 1);
  const r6 = pega(() => fecha(pedido(uma, dg, ri, s, carry, { lances: jUma.lances, hash: undefined })));
  check('a última poção bebida some do estado (sem contador zerado)',
        r6.ok && !(r6.r.progress.consumiveis && r6.r.progress.consumiveis[PEQ]), JSON.stringify(r6.ok ? r6.r.progress.consumiveis : r6));

  // ---- o duelo refeito com um gole cai inteiro
  const dA = [{ heroId: 'sumo', classId: 'sumo', element: 'neutro', level: 20, dono: 'a' }];
  const dB = [{ heroId: 'curandeiro', classId: 'curandeiro', element: 'neutro', level: 20, dono: 'b' }];
  const J0 = mundo().JOGO;
  const du = J0.Engine.createDuelSala('cistern', 0, JSON.parse(JSON.stringify(dA)), JSON.parse(JSON.stringify(dB)), { seed: 9 });
  const ativo = J0.Engine.activeUnit(du);
  const r7 = pega(() => refaz({ modo: 'duelo', dungeonId: 'cistern', roomIndex: 0, semente: 9, duplaA: dA, duplaB: dB,
                                lances: [{ a: 'po', u: ativo.uid, s: PEQ, ok: false, de: ativo.dono }] }));
  check('o juiz recusa o duelo com lance de poção', !r7.ok && r7.motivo === 'duelo', JSON.stringify(r7));
})();

function mundoParty(c) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 1 });
  est.poeEstado(w, c.progress, c.db);
  return w.J.Progress.battleParty(['sumo']);
}

// ================================================================ em grupo: cada um gasta as próprias
(function () {
  function contaDe(heroi, pocoes) {
    const w = est.mundoEconomico({ agoraMs: AGORA, semente: 5 });
    est.poeEstado(w, null, null);
    const J = w.J, h = J.Progress.state.heroes[heroi];
    h.level = 22; h.xp = J.DATA.leveling.xpTable[21];
    J.Progress.save();
    Object.keys(pocoes).forEach((id) => J.Progress.poeConsumivel(id, pocoes[id]));
    return Object.assign(est.tiraEstado(w), { heroi });
  }
  function partyDe(c, dono) {
    const w = est.mundoEconomico({ agoraMs: AGORA, semente: 5 });
    est.poeEstado(w, c.progress, c.db);
    return w.J.Progress.battleParty([c.heroi]).map((p) => Object.assign(p, { dono }));
  }
  const ana = contaDe('sumo', { [PEQ]: 2 }), bia = contaDe('curandeiro', { [MED]: 2 });
  const bebeDe = { ana: PEQ, bia: MED };
  const carry = { 'ana:sumo': 1, 'bia:curandeiro': 1 };
  const J = est.mundoEconomico({ agoraMs: AGORA, semente: 5 }).J, E = J.Engine;
  const party = partyDe(ana, 'ana').concat(partyDe(bia, 'bia'));
  const st = E.createBattle('cistern', 0, JSON.parse(JSON.stringify(party)), { seed: 17, escolhePosicao: true });
  require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js')).aplicaCarryRede(st, carry);
  E.events.length = 0;
  const log = [];
  const op = E.placementOptions(st)[0];
  log.push({ a: 'p', x: op.x, y: op.y, ok: !!E.place(st, op.x, op.y), de: 'ana' });
  E.events.length = 0;
  const bebeu = { ana: 0, bia: 0 };
  let voltas = 0;
  while (st.phase === 'playing' && voltas++ < 3000) {
    const u = E.activeUnit(st);
    if (!u) break;
    if (u.dono && (u.kind === 'hero' || u.kind === 'fusion')) {
      if (bebeu[u.dono] < 1 && !E.podePocao(st, u.uid, bebeDe[u.dono])) {
        const ok = !!E.usePotion(st, u.uid, bebeDe[u.dono]);
        log.push({ a: 'po', u: u.uid, s: bebeDe[u.dono], ok, de: u.dono });
        if (ok) bebeu[u.dono]++;
        E.events.length = 0;
      }
      for (const a of (J.AI.planTurn(st, u.uid) || [])) {
        if (st.phase !== 'playing') break;
        if (a.action === 'move') log.push({ a: 'm', u: u.uid, x: a.x, y: a.y, ok: !!E.move(st, u.uid, a.x, a.y), de: u.dono });
        else if (a.action === 'cast') log.push({ a: 'c', u: u.uid, s: a.spellId, x: a.x, y: a.y, ok: !!E.cast(st, u.uid, a.spellId, a.x, a.y), de: u.dono });
        else if (a.action === 'end') break;
        E.events.length = 0;
      }
      if (st.phase === 'playing') { E.endTurn(st); log.push({ a: 'e', ok: true, de: u.dono }); }
      E.events.length = 0;
      continue;
    }
    const plano = J.AI.planTurn(st, u.uid) || [];
    let acabou = false;
    for (const a of (plano.length ? plano : [{ action: 'end' }])) {
      if (st.phase !== 'playing') break;
      if (a.action === 'move') E.move(st, u.uid, a.x, a.y);
      else if (a.action === 'cast') E.cast(st, u.uid, a.spellId, a.x, a.y);
      else if (a.action === 'end') { E.endTurn(st); acabou = true; break; }
      E.events.length = 0;
    }
    if (!acabou && st.phase === 'playing') E.endTurn(st);
    E.events.length = 0;
  }
  check('em grupo Ana bebe uma Pequena e Bia uma Média', bebeu.ana === 1 && bebeu.bia === 1, JSON.stringify(bebeu));
  const r = pega(() => fechaGrupo({
    membros: [{ conta: { id: 1 }, dono: 'ana', herois: ['sumo'], progress: ana.progress, db: ana.db },
              { conta: { id: 2 }, dono: 'bia', herois: ['curandeiro'], progress: bia.progress, db: bia.db }],
    ata: { dungeonId: 'cistern', roomIndex: 0, dificuldade: 'normal', semente: 17, carry },
    lances: log, hashFinal: E.hash(st), contexto: { agoraMs: AGORA, fatores: {} }
  }));
  const pa = r.ok && r.r.membros[0].progress.consumiveis, pb = r.ok && r.r.membros[1].progress.consumiveis;
  check('o fechamento em grupo desconta de CADA membro só as poções dele (' + (r.ok ? r.r.fase : '?') + ')',
        r.ok && pa && pa[PEQ] === 1 && !pa[MED] && pb && pb[MED] === 1 && !pb[PEQ], JSON.stringify(r.ok ? { pa, pb } : r));
  const biaSem = contaDe('curandeiro', { [PEQ]: 5 });
  const r2 = pega(() => fechaGrupo({
    membros: [{ conta: { id: 1 }, dono: 'ana', herois: ['sumo'], progress: ana.progress, db: ana.db },
              { conta: { id: 2 }, dono: 'bia', herois: ['curandeiro'], progress: biaSem.progress, db: biaSem.db }],
    ata: { dungeonId: 'cistern', roomIndex: 0, dificuldade: 'normal', semente: 17, carry },
    lances: log, hashFinal: E.hash(st), contexto: { agoraMs: AGORA, fatores: {} }
  }));
  check('o membro que bebeu a Média sem ter nenhuma derruba a sala (as Pequenas dele não pagam por ela)',
        !r2.ok && r2.motivo === 'pocoes', JSON.stringify(r2));
})();

// ================================================================ a banca no juiz (op comprarPocao)
(async () => {
  const w0 = est.mundoEconomico({ agoraMs: AGORA, semente: 3 });
  est.poeEstado(w0, null, null);
  await w0.J.DB.ganharMoedas(1500);
  await w0.J.DB.depositarMoedas(1000);           // 500 no saco, 1000 no banco
  const base = est.tiraEstado(w0);
  function pede(b, ops) {
    return executa({ conta: { id: 1, gm: false }, progress: b.progress, db: b.db, ops, semente: 1, contexto: { agoraMs: AGORA } });
  }
  async function tenta(b, ops) { try { return await pede(b, ops); } catch (e) { return { erro: e.message, motivo: e.motivo }; } }
  check('a conta da banca tem 500 no saco e 1000 no banco', base.db.carteira.moedas === 500 && base.db.banco.moedas === 1000);

  const r1 = await tenta(base, [{ nome: 'comprarPocao', args: { id: MED, qtd: 3 } }]);
  const wc = est.mundoEconomico({ agoraMs: AGORA, semente: 99 });
  est.poeEstado(wc, base.progress, base.db);
  const rc = await wc.J.Mercado.comprarPocao(MED, 3);
  const c1 = est.tiraEstado(wc);
  check('comprarPocao debita 330 do saco e soma 3 Médias', r1.ok && r1.resultados[0].ok && r1.db.carteira.moedas === 170 &&
        r1.db.banco.moedas === 1000 && r1.progress.consumiveis[MED] === 3, JSON.stringify(r1.erro || r1.resultados));
  check('... com o mesmo hash que a compra na tela', rc.ok && r1.hash === c1.hash && r1.hash !== base.hash);

  const r2 = await tenta(base, [{ nome: 'comprarPocao', args: { id: GRA, qtd: 2 } }]);
  check('sem vinténs no SACO (o banco não conta) a compra é recusada e nada muda',
        r2.ok && r2.resultados[0].ok === false && r2.hash === r2.hashAntes, JSON.stringify(r2.resultados || r2));

  const wr = est.mundoEconomico({ agoraMs: AGORA, semente: 3 });
  est.poeEstado(wr, null, null);
  await wr.J.DB.ganharMoedas(2000);
  const rica = est.tiraEstado(wr);
  const r3 = await tenta(rica, [{ nome: 'comprarPocao', args: { id: PEQ, qtd: 12 } }, { nome: 'comprarPocao', args: { id: PEQ, qtd: 9 } },
                                { nome: 'comprarPocao', args: { id: PEQ, qtd: 8 } }]);
  check('acima do teto de 20 por tipo a compra é recusada sem cobrar (12 + 9 não, 12 + 8 sim)',
        r3.ok && r3.resultados[0].ok && r3.resultados[1].ok === false && r3.resultados[1].cheio && r3.resultados[2].ok &&
        r3.progress.consumiveis[PEQ] === 20 && r3.db.carteira.moedas === 2000 - 20 * 40, JSON.stringify(r3.resultados || r3));

  const r4 = await tenta(base, [{ nome: 'comprarPocao', args: { id: PEQ, qtd: 0 } }]);
  check('quantidade torta derruba o pedido (argumento)', r4.motivo === 'argumento', JSON.stringify(r4));
  const r5 = await tenta(base, [{ nome: 'comprarPocao', args: { id: 'escudo-de-mentira', qtd: 1 } }]);
  check('o mercador não vende o que não é poção', r5.ok && r5.resultados[0].ok === false && r5.hash === r5.hashAntes);

  // o saneamento: teto e id desconhecido no load
  const torto = JSON.parse(JSON.stringify(base.progress));
  torto.consumiveis = { [PEQ]: 999, 'pocao-falsa': 3, [MED]: -2, [GRA]: 2.7 };
  const ws = est.mundoEconomico({ agoraMs: AGORA });
  est.poeEstado(ws, torto, base.db);
  const cs = ws.J.Progress.state.consumiveis;
  check('o load saneia: preso no teto, sem poção falsa, sem negativo', cs && cs[PEQ] === 20 && !cs['pocao-falsa'] && !cs[MED] && cs[GRA] === 2,
        JSON.stringify(cs));
  const semNada = est.mundoEconomico({ agoraMs: AGORA });
  est.poeEstado(semNada, null, null);
  check('a conta sem poção não ganha campo novo (o hash de antes das poções fica)', !('consumiveis' in semNada.J.Progress.state));

  console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})();
