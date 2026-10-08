#!/usr/bin/env node
'use strict';
/* PROVA DO JUIZ — a sala fechada e paga no servidor (servidor/juiz/recompensa.js).
 *
 *   node tests/juiz_recompensa.js
 *
 * Um "cliente" joga uma sala de verdade como o jogo joga (escolhe a casa, a IA
 * decide os lances do herói, cada lance anotado). O servidor recebe só o
 * bilhete, os lances e o estado que ELE guarda, e tem de:
 *   - pagar EXATAMENTE o que o computeRewards do jogo pagaria com o mesmo sorteio;
 *   - devolver o estado novo com o hash batendo e os iids novos no saco;
 *   - não pagar nada numa sala que não terminou;
 *   - recusar herói que não é da conta;
 *   - aplicar o evento do mundo e o dízimo da guilda. */
const path = require('path');
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
const { fecha } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'recompensa.js'));
const { ehDoJogador } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}

const AGORA = Date.UTC(2026, 8, 13, 15, 0, 0);

/* a conta de partida: o estado novo do jogo, com o Bárbaro no nível pedido */
function contaCom(nivel) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 1 });
  est.poeEstado(w, null, null);
  const J = w.J;
  const tab = J.DATA.leveling.xpTable;
  const h = J.Progress.state.heroes.sumo;
  h.level = nivel;
  h.xp = tab[nivel - 1];
  return est.tiraEstado(w);
}

/* O cliente: joga a sala no mundo dele (o estado igual ao do servidor) e,
 * se `recompensaCom` vier, também roda o computeRewards dele com esse sorteio. */
function clienteJoga(conta, dungeonId, roomIndex, semente, dificuldade, recompensaCom) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: recompensaCom || 7,
                                 fatores: {}, guilda: {} });
  est.poeEstado(w, conta.progress, conta.db);
  const J = w.J, E = J.Engine;
  const party = J.Progress.battleParty(['sumo']);
  const st = E.createBattle(dungeonId, roomIndex, party, { seed: semente, dificuldade, escolhePosicao: true });
  E.events.length = 0;
  const lances = [];
  const op = E.placementOptions(st)[0];
  lances.push({ a: 'p', x: op.x, y: op.y, ok: !!E.place(st, op.x, op.y) });
  E.events.length = 0;
  let voltas = 0;
  while (st.phase === 'playing' && voltas++ < 3000) {
    const u = E.activeUnit(st);
    if (!u) break;
    const meu = ehDoJogador(st, u);
    const plano = J.AI.planTurn(st, u.uid) || [];
    let acabou = false;
    for (const a of (plano.length ? plano : [{ action: 'end' }])) {
      if (st.phase !== 'playing') break;
      if (a.action === 'move') {
        const ok = !!E.move(st, u.uid, a.x, a.y);
        if (meu) lances.push({ a: 'm', u: u.uid, x: a.x, y: a.y, ok });
      } else if (a.action === 'cast') {
        const ok = !!E.cast(st, u.uid, a.spellId, a.x, a.y);
        if (meu) lances.push({ a: 'c', u: u.uid, s: a.spellId, x: a.x, y: a.y, ok });
      } else if (a.action === 'end') {
        E.endTurn(st);
        if (meu) lances.push({ a: 'e', ok: true });
        acabou = true;
        break;
      }
      E.events.length = 0;
    }
    if (!acabou && st.phase === 'playing') { E.endTurn(st); if (meu) lances.push({ a: 'e', ok: true }); }
    E.events.length = 0;
  }
  let recompensaLocal = null;
  if (recompensaCom && st.phase === 'won') {
    const G = J.Game;
    G.state = st; G.party = ['sumo']; G.dungeonId = dungeonId; G.roomIndex = roomIndex;
    recompensaLocal = JSON.parse(JSON.stringify(G._computeRewards()));
  }
  return { lances, fase: st.phase, hash: E.hash(st), recompensaLocal };
}

function pedido(conta, dungeonId, roomIndex, semente, dificuldade, lances, hashFinal, extra) {
  return Object.assign({
    conta: { id: 1, gm: false },
    bilhete: { dungeonId, roomIndex, dificuldade, semente, herois: ['sumo'], carry: null },
    lances, hashFinal, progress: conta.progress, db: conta.db,
    contexto: { agoraMs: AGORA, fatores: {}, guilda: {} }
  }, extra || {});
}

// ---- acha uma sala que o Bárbaro forte vence (a última sala tem chefe: pedras, selos, cartas)
let achado = null;
const conta = contaCom(22);
for (const dg of ['greenhouse', 'cistern']) {
  for (const ri of [2, 1, 0]) {
    for (const s of [11, 29, 53, 97]) {
      const jogo = clienteJoga(conta, dg, ri, s, 'normal');
      if (jogo.fase === 'won') { achado = { dg, ri, s, jogo }; break; }
    }
    if (achado) break;
  }
  if (achado) break;
}
check('o cliente de mentira vence uma sala de verdade (com colocação)', !!achado);
if (!achado) { console.log('\nRESUMO: FALHOU (sem sala vencida para provar)'); process.exit(1); }
const { dg, ri, s, jogo } = achado;
console.log('   sala: ' + dg + '#' + ri + ' semente ' + s + ' · ' + jogo.lances.length + ' lances');

// ---- o servidor fecha
let r = null;
try { r = fecha(pedido(conta, dg, ri, s, 'normal', jogo.lances, jogo.hash)); }
catch (e) { r = { erro: e.message, motivo: e.motivo }; }
check('o servidor refaz a sala e vê a vitória', r && r.ok && r.fase === 'won', JSON.stringify(r && (r.erro || r.fase)));
if (!r || !r.ok || r.fase !== 'won') { console.log('\nRESUMO: FALHOU ' + (falhas) + ' de ' + total); process.exit(1); }
const rw = r.recompensa || {};
check('a recompensa paga XP e vinténs', rw.xpGanho > 0 && rw.moedas > 0, JSON.stringify({ xp: rw.xpGanho, moedas: rw.moedas }));
check('os vinténs entram na carteira DO SERVIDOR', r.db.carteira.moedas === (conta.db.carteira.moedas || 0) + rw.moedas,
      r.db.carteira.moedas + ' × ' + rw.moedas);
const xpAntes = conta.progress.heroes.sumo.xp, xpDepois = r.progress.heroes.sumo.xp;
check('o XP entra no herói DO SERVIDOR', xpDepois > xpAntes, xpAntes + ' → ' + xpDepois);

// o hash é o mesmo que o cliente calcula sobre o mesmo estado
const wc = est.mundoEconomico({ agoraMs: AGORA });
check('o hash devolvido é o Economia.hash do estado devolvido',
      r.hash === wc.J.Economia.hash(r.progress, r.db), r.hash);
check('o estado mudou (hash antes ≠ depois)', r.hashAntes !== r.hash);

// iids: cada peça sorteada nasceu com série e está no saco
const drops = rw.drops || [];
const noSaco = new Set((r.progress.inventory || []).map((e) => e.iid));
check('cada peça sorteada nasce com número de série, no saco, com origem saque',
      r.iids.novos.length === drops.length && r.iids.novos.every((n) => noSaco.has(n.iid) && n.origem === 'saque'),
      JSON.stringify({ drops, novos: r.iids.novos }));
check('a fila de nascimentos sai vazia (o servidor registra, não o cliente)', r.progress.nascimentos.length === 0);
check('o PV que atravessa sai para a próxima sala', r.carry && typeof r.carry.sumo === 'number', JSON.stringify(r.carry));

// ---- o MESMO funil do jogo: com o mesmo sorteio o cliente pagaria igual
const semRec = est.sementeDe(s + ':recompensa:' + dg + ':' + ri);
const local = clienteJoga(conta, dg, ri, s, 'normal', semRec).recompensaLocal;
check('com o mesmo sorteio o computeRewards do jogo paga exatamente o mesmo (XP, vinténs, peças, cartas, pedras)',
      !!local && local.xpGanho === rw.xpGanho && local.moedas === rw.moedas &&
      JSON.stringify(local.drops) === JSON.stringify(rw.drops) &&
      JSON.stringify(local.cards) === JSON.stringify(rw.cards) &&
      JSON.stringify(local.stones) === JSON.stringify(rw.stones),
      JSON.stringify({ local: local && [local.xpGanho, local.moedas, local.drops], srv: [rw.xpGanho, rw.moedas, rw.drops] }));

// determinismo do servidor
const r2 = fecha(pedido(conta, dg, ri, s, 'normal', jogo.lances, jogo.hash));
check('o mesmo bilhete fechado de novo sorteia igual (o servidor é determinístico)',
      r2.recompensa.xpGanho === rw.xpGanho && JSON.stringify(r2.recompensa.drops) === JSON.stringify(rw.drops));

// ---- a sala que não terminou não paga
const metade = jogo.lances.slice(0, Math.max(2, Math.floor(jogo.lances.length / 3)));
const r3 = fecha(pedido(conta, dg, ri, s, 'normal', metade, undefined));
check('a sala que não terminou não paga nada e não muda o estado',
      r3.fase !== 'won' && r3.recompensa === null && r3.hash === r3.hashAntes, JSON.stringify({ fase: r3.fase }));

// ---- herói que não é da conta
let r4;
try { r4 = fecha(pedido(conta, dg, ri, s, 'normal', jogo.lances, jogo.hash,
  { bilhete: { dungeonId: dg, roomIndex: ri, dificuldade: 'normal', semente: s, herois: ['arqueiro'], carry: null } })); }
catch (e) { r4 = { motivo: e.motivo }; }
check('herói que não é da conta é recusado', r4 && r4.motivo === 'herois', JSON.stringify(r4 && r4.motivo));

// ---- o cliente não escolhe os atributos: o grupo sai do estado do servidor
const inflado = JSON.parse(JSON.stringify(conta));
inflado.progress.heroes.sumo.level = 1;      // o servidor tem nível 1: o grupo dele é fraco
inflado.progress.heroes.sumo.xp = 0;
let r5;
try { r5 = fecha(pedido(inflado, dg, ri, s, 'normal', jogo.lances, jogo.hash)); }
catch (e) { r5 = { motivo: e.motivo }; }
// 07/10: 'depois-do-fim' também é a recusa certa — o herói fraco cai antes de os lances do forte acabarem (com o
// elite da sala, que tem mais vida, a sala do fraco termina mais cedo ainda)
check('os lances do herói forte não valem no herói fraco que o servidor tem (divergiu, depois do fim ou perdeu)',
      (r5 && (r5.motivo === 'divergiu' || r5.motivo === 'depois-do-fim')) || (r5 && r5.ok && r5.fase !== 'won'),
      JSON.stringify(r5 && (r5.motivo || r5.fase)));

// ---- o evento do mundo e o dízimo
const r6 = fecha(pedido(conta, dg, ri, s, 'normal', jogo.lances, jogo.hash,
  { contexto: { agoraMs: AGORA, fatores: { geral: { xp: 3, vintem: 2 } }, guilda: { dizimo: 50 } } }));
check('evento de XP ×3 no ar: o servidor paga ~3× o XP', r6.recompensa.xpGanho >= rw.xpGanho * 3 - 3,
      r6.recompensa.xpGanho + ' × ' + rw.xpGanho);
check('evento de vinténs ×2 no ar: ~2× os vinténs', r6.recompensa.moedas >= rw.moedas * 2 - 2,
      r6.recompensa.moedas + ' × ' + rw.moedas);
// dízimo de 50%: do XP bruto do herói (depois do corte por nível), a guilda leva floor(b/2) e o herói ceil(b/2)
const fica = (r6.recompensa.xpPorHeroi || {}).sumo || 0;
check('o dízimo da guilda sai do XP do herói e volta anotado para a guilda do servidor',
      fica >= 2 && (r6.guildaXp === fica || r6.guildaXp === fica - 1), JSON.stringify({ fica, guilda: r6.guildaXp }));

// ---- 08/10 à noite: o bônus de descanso (as três primeiras salas do dia em dobro) e a lista da plateia
check('a primeira sala do dia paga XP em dobro e conta no save (descanso 1 de 3)',
      rw.descanso && rw.descanso.fator === 2 && rw.descanso.usadas === 1 && rw.descanso.de === 3 &&
      r.progress.descanso && r.progress.descanso.salas === 1 && r.progress.descanso.dia === '2026-09-13',
      JSON.stringify([rw.descanso, r.progress.descanso]));
const contaUsada = { progress: Object.assign({}, conta.progress, { descanso: { dia: '2026-09-13', salas: 3 } }), db: conta.db };
let rU = null;
try { rU = fecha(pedido(contaUsada, dg, ri, s, 'normal', jogo.lances, jogo.hash)); } catch (e) { rU = { erro: e.message }; }
check('com o descanso de hoje gasto a MESMA sala paga a metade (e anota a 4ª vencida)',
      rU && rU.ok && Math.abs(rU.recompensa.xpGanho * 2 - rw.xpGanho) <= 1 && rU.recompensa.descanso &&
      rU.recompensa.descanso.fator === 1 && rU.progress.descanso.salas === 4,
      JSON.stringify(rU && (rU.erro || [rw.xpGanho, rU.recompensa.xpGanho, rU.recompensa.descanso, rU.progress.descanso])));
check('a recompensa traz a lista das peças épicas para a plateia (raros, só itemId e raridade)',
      Array.isArray(rw.raros) && rw.raros.every((x) => typeof x.itemId === 'string' && ['epico', 'lendario'].indexOf(x.raridade) >= 0),
      JSON.stringify(rw.raros));

// ---- o bônus da guilda confere com o do jogo
const fs = require('fs');
const txtGuilda = fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'guilda.js'), 'utf8');
const m = /BONUS_FATOR\s*=\s*([0-9.]+)/.exec(txtGuilda);
check('o fator do bônus de guilda do juiz é o de js/core/guilda.js', !!m && Number(m[1]) === est.GUILDA_BONUS_FATOR,
      m && m[1]);

console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
