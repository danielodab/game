#!/usr/bin/env node
'use strict';
/* PROVA DO JUIZ DO ECO PRIMORDIAL — a tentativa refeita e o placar que vale
 * (servidor/juiz/supremo.js).
 *
 *   node tests/juiz_supremo.js
 *
 * Um "cliente" joga a Câmara do Eco como o jogo joga (escolhe a casa, a IA
 * decide os lances do herói, cada lance anotado) no mundo com o estado da
 * conta. O juiz recebe só a semente, os heróis, os lances e o estado que o
 * SERVIDOR guarda, e tem de:
 *   - refazer a tentativa e chegar ao MESMO dano e aos mesmos pontos do cliente
 *     (o placar sai do replay, nunca de um número mandado);
 *   - devolver o placar de uma tentativa largada no meio, até onde ela foi;
 *   - recusar ('divergiu') o lance trocado e o hash do fim mentido — a API não
 *     pontua essas;
 *   - recusar herói que não é da conta e a versão das regras de outra época
 *     ('regras-mudaram', que a API vence sem tratar como fraude). */
const path = require('path');
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
const { fecha } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'supremo.js'));
const { ehDoJogador } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}

const AGORA = Date.UTC(2026, 9, 2, 15, 0, 0);

function contaCom(nivel) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 1 });
  est.poeEstado(w, null, null);
  const J = w.J;
  const tab = J.DATA.leveling.xpTable;
  ['sumo', 'curandeiro'].forEach((hid) => {
    const h = J.Progress.state.heroes[hid];
    h.level = nivel;
    h.xp = tab[nivel - 1];
  });
  return est.tiraEstado(w);
}

/* o cliente: a tentativa inteira no mundo dele; `meio` guarda o placar e os lances até a metade */
function clienteJoga(conta, herois, semente) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 3 });
  est.poeEstado(w, conta.progress, conta.db);
  const J = w.J, E = J.Engine;
  const party = J.Progress.battleParty(herois);
  const st = E.createBattle(J.DATA.eco.arena, 0, party, { seed: semente, dificuldade: 'normal', escolhePosicao: true });
  E.events.length = 0;
  const lances = [];
  const op = E.placementOptions(st)[0];
  lances.push({ a: 'p', x: op.x, y: op.y, ok: !!E.place(st, op.x, op.y) });
  E.events.length = 0;
  let voltas = 0, meio = null;
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
    // a metade: na volta da vez para o jogador depois da 6ª rodada (o juiz para no último lance e
    // roda a IA até a vez voltar — é exatamente este ponto)
    if (!meio && st.round >= 7 && st.phase === 'playing' && ehDoJogador(st, E.activeUnit(st))) {
      meio = { lances: lances.slice(), placar: JSON.parse(JSON.stringify(E.ecoPlacar(st))) };
    }
  }
  return { lances, fase: st.phase, hash: E.hash(st), placar: E.ecoPlacar(st), meio };
}

function pedido(conta, herois, semente, lances, hashFinal, extra) {
  return Object.assign({
    conta: { id: 1, gm: false },
    tentativa: { semente, herois, regras: undefined },
    lances, hashFinal, progress: conta.progress, db: conta.db,
    contexto: { agoraMs: AGORA }
  }, extra || {});
}
function tenta(p) {
  try { return fecha(p); } catch (e) { return { erro: e.message, motivo: e.motivo, juiz: !!e.juiz }; }
}

const conta = contaCom(24);
const HEROIS = ['sumo', 'curandeiro'];
const SEMENTE = 4242;
const jogo = clienteJoga(conta, HEROIS, SEMENTE);
console.log('   tentativa: ' + jogo.lances.length + ' lances · ' + jogo.fase + ' · dano ' + jogo.placar.dano);
check('o cliente de mentira joga a tentativa até o fim e tira dano do Eco', jogo.fase !== 'playing' && jogo.placar.dano > 0,
      jogo.fase + ' ' + jogo.placar.dano);

const r = tenta(pedido(conta, HEROIS, SEMENTE, jogo.lances, jogo.hash));
check('o juiz refaz a tentativa sem recusar', r && r.ok === true, JSON.stringify(r).slice(0, 300));
check('o dano do replay é o mesmo do cliente', r && r.placar && r.placar.dano === jogo.placar.dano,
      (r && r.placar && r.placar.dano) + ' / ' + jogo.placar.dano);
check('os pontos e o derrubou também', r && r.placar && r.placar.pontos === jogo.placar.pontos &&
      r.placar.derrubou === jogo.placar.derrubou);
check('o hash do fim bate', r && r.hash === jogo.hash);
check('o juiz conta as vezes do jogador (a régua do tempo mínimo da API)', r && r.turnosJogador > 0, r && r.turnosJogador);

// o número que o cliente mandaria não entra: o placar sai do replay
const r2 = tenta(pedido(conta, HEROIS, SEMENTE, jogo.lances, jogo.hash, { dano: 999999, placar: { dano: 999999 } }));
check('um "dano" mandado junto é ignorado: o placar continua o do replay', r2 && r2.ok && r2.placar.dano === jogo.placar.dano,
      r2 && r2.placar && r2.placar.dano);

// a tentativa largada no meio vale até onde foi
if (jogo.meio) {
  const r3 = tenta(pedido(conta, HEROIS, SEMENTE, jogo.meio.lances, null));
  check('a tentativa largada no meio pontua o dano até ali', r3 && r3.ok && r3.placar.dano === jogo.meio.placar.dano &&
        r3.fase === 'playing', JSON.stringify(r3 && r3.placar) + ' / ' + jogo.meio.placar.dano);
} else {
  check('a tentativa teve uma metade para provar a largada', false, 'acabou antes da 7ª rodada');
}

// o lance trocado diverge
const torto = JSON.parse(JSON.stringify(jogo.lances));
const iCast = torto.findIndex((l) => l.a === 'c' && l.ok);
if (iCast >= 0) torto[iCast].x = (torto[iCast].x + 3) % 18;
const r4 = tenta(pedido(conta, HEROIS, SEMENTE, torto, jogo.hash));
check('o lance trocado é recusado como divergência (a API não pontua)', r4 && r4.juiz && r4.motivo === 'divergiu',
      JSON.stringify(r4).slice(0, 200));
const r5 = tenta(pedido(conta, HEROIS, SEMENTE, jogo.lances, jogo.hash + 1));
check('o hash do fim mentido é recusado', r5 && r5.juiz && r5.motivo === 'divergiu', JSON.stringify(r5).slice(0, 200));
const r6 = tenta(pedido(conta, ['bruxo'], SEMENTE, jogo.lances, jogo.hash));
check('herói que não é da conta é recusado', r6 && r6.juiz && r6.motivo === 'herois', JSON.stringify(r6).slice(0, 200));
const p7 = pedido(conta, HEROIS, SEMENTE, jogo.lances, jogo.hash);
p7.tentativa.regras = 1;
const r7 = tenta(p7);
check('a tentativa aberta sob outra versão das regras cai como regras-mudaram (não como fraude)',
      r7 && r7.juiz && r7.motivo === 'regras-mudaram', JSON.stringify(r7).slice(0, 200));
const r8 = tenta(pedido(conta, HEROIS, SEMENTE + 1, jogo.lances, jogo.hash));
check('a mesma jogada com OUTRA semente não fecha (a semente é do servidor)', r8 && r8.juiz && r8.motivo === 'divergiu',
      JSON.stringify(r8).slice(0, 200));

console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
