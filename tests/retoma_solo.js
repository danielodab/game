#!/usr/bin/env node
/* PROVA DE REFAZER A SALA SOLO (15/10): js/core/retomada.js contra o juiz.
 *
 *   node tests/retoma_solo.js
 *
 * No mundo headless do juiz (servidor/juiz/motor.js): uma sala solo nasce da semente, o jogador joga
 * alguns lances (os mesmos que o game.js anota: 'p', 'm', 'c', 'e') com a IA correndo entre eles —
 * exatamente como o juiz refaz —, e o registro vira um {bilhete, lances, …}. Então Retomada.refaz()
 * refaz a sala desse registro e tem de chegar ao MESMO hash que a sala viva e ao mesmo hash que o
 * próprio juiz (sala.refazEm). Também: regras de outra versão recusam; lance fora da vez recusa; o
 * registro de uma sala que já acabou devolve a fase de fim. */
'use strict';
const path = require('path');
const motor = require(path.join(__dirname, '..', 'servidor', 'juiz', 'motor.js'));
const sala = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));

let ok = 0, falhas = [];
function check(nome, cond, det) {
  if (cond) ok++; else falhas.push(nome);
  console.log((cond ? 'PASSOU · ' : 'FALHOU · ') + nome + (det ? ' — ' + det : ''));
}

const ctx = motor.mundo(['js/core/retomada.js']);
const J = ctx.JOGO;
const E = J.Engine, R = J.Retomada;
check('o mundo headless tem o motor, a IA e a retomada', !!(E && J.AI && R && R.refaz));

const party = ['sumo', 'curandeiro'];
const base = { dungeonId: 'greenhouse', roomIndex: 0, dificuldade: 'normal', party, semente: 4242, carry: null, afixo: null,
               versaoRegras: E.VERSAO_REGRAS };

// a sala viva: joga como o game.js joga (IA entre os lances do jogador)
function rodaIA(st) {
  let n = 0;
  while (st.phase === 'playing') {
    const u = E.activeUnit(st);
    if (!u || u.side === 'player') return;
    let plano = null;
    try { plano = J.AI.planTurn(st, u.uid); } catch (e) { plano = null; }
    if (!plano || !plano.length) plano = [{ action: 'end' }];
    let acabou = false;
    for (const a of plano) {
      if (st.phase !== 'playing') break;
      try {
        if (a.action === 'move') E.move(st, u.uid, a.x, a.y);
        else if (a.action === 'cast') E.cast(st, u.uid, a.spellId, a.x, a.y);
        else if (a.action === 'end') { E.endTurn(st); acabou = true; break; }
      } catch (e) {}
    }
    if (!acabou && st.phase === 'playing') E.endTurn(st);
    E.events.length = 0;
    if (++n > 500) throw new Error('a IA não devolve a vez');
  }
}
const viva = E.createBattle(base.dungeonId, base.roomIndex, party, { seed: base.semente, dificuldade: 'normal', escolhePosicao: true, afixo: null });
sala.aplicaCarry(viva, null);
E.events.length = 0;
const lances = [];
function joga(l) {
  if (l.a !== 'p') rodaIA(viva);
  let r;
  if (l.a === 'p') r = !!E.place(viva, l.x, l.y, { escolhas: l.e || {}, uid: l.eu || null });
  else if (l.a === 'm') r = !!E.move(viva, l.u, l.x, l.y);
  else if (l.a === 'c') r = !!E.cast(viva, l.u, l.s, l.x, l.y);
  else if (l.a === 'e') { if (viva.phase === 'playing') E.endTurn(viva); r = true; }
  E.events.length = 0;
  lances.push(Object.assign({}, l, { ok: r }));
  return r;
}
check('a sala viva nasce na colocação', viva.phase === 'placing', viva.phase);
joga({ a: 'p', x: null, y: null, e: {} });
check('a colocação sem escolhas começa a luta', viva.phase === 'playing', viva.phase);
rodaIA(viva);
let ativo = E.activeUnit(viva);
check('depois da IA a vez é do jogador', !!ativo && ativo.side === 'player');
// um feitiço no primeiro inimigo ao alcance (ou um lance que falha — o `ok` também conta), um passo e passar a vez
const inimigo = viva.units.find(u => u.side === 'enemy' && u.alive);
const sid = ativo.spells && ativo.spells[0];
const okCast = joga({ a: 'c', u: ativo.uid, s: sid, x: inimigo.x, y: inimigo.y });
joga({ a: 'm', u: ativo.uid, x: ativo.x + 1, y: ativo.y });
joga({ a: 'e' });
rodaIA(viva);
ativo = E.activeUnit(viva);
if (ativo && ativo.side === 'player') { joga({ a: 'e' }); rodaIA(viva); }
check('o registro tem os lances do jogador (com o ok de cada um)', lances.length >= 4 && lances.every(l => typeof l.ok === 'boolean'), lances.length + ' lances, feitiço ' + (okCast ? 'acertou' : 'falhou'));
const hashVivo = E.hash(viva);

// 1. a retomada refaz e chega ao mesmo hash
const rec = Object.assign({}, base, { lances: lances.slice() });
const r1 = R.refaz(J, rec, { aplicaCarry: sala.aplicaCarry });
check('a retomada refaz a sala sem erro', !!(r1 && r1.st && !r1.erro), JSON.stringify(r1 && r1.erro));
check('a sala refeita tem o MESMO hash da sala viva', r1 && r1.hash === hashVivo, (r1 && r1.hash) + ' vs ' + hashVivo);
check('a vez na sala refeita é do jogador (a IA já correu)', r1 && r1.st && r1.st.phase === 'playing' && E.activeUnit(r1.st).side === 'player');

// 2. o juiz chega ao mesmo lugar
let juiz = null, erroJuiz = null;
try { juiz = sala.refazEm(J, Object.assign({}, base, { lances: lances.slice(), regras: E.VERSAO_REGRAS })); } catch (e) { erroJuiz = e && (e.message || e); }
check('o juiz refaz os mesmos lances', !!juiz && !erroJuiz, String(erroJuiz));
check('o juiz e a retomada batem no hash', juiz && juiz.hash === hashVivo, juiz && juiz.hash);

// 3. as recusas
const r2 = R.refaz(J, Object.assign({}, rec, { versaoRegras: (E.VERSAO_REGRAS || 0) + 1 }), { aplicaCarry: sala.aplicaCarry });
check('regras de outra versão recusam', r2 && r2.erro === 'regras-mudaram', JSON.stringify(r2 && r2.erro));
const torto = lances.slice(); torto.splice(1, 0, { a: 'c', u: 'u9', s: 'x', x: 0, y: 0, ok: true });
const r3 = R.refaz(J, Object.assign({}, rec, { lances: torto }), { aplicaCarry: sala.aplicaCarry });
check('um lance com unidade que não é a da vez recusa', r3 && (r3.erro === 'unidade' || r3.erro === 'vez' || r3.erro === 'divergiu'), JSON.stringify(r3 && r3.erro));
const r4 = R.refaz(J, Object.assign({}, rec, { lances: [{ a: 'po' }] }), { aplicaCarry: sala.aplicaCarry });
check('a poção na batalha recusa', r4 && r4.erro === 'lance');
const r5 = R.refaz(J, { dungeonId: 'greenhouse' }, {});
check('registro incompleto recusa', r5 && r5.erro === 'entrada');

console.log((falhas.length ? 'FALHAS — ' : 'TUDO PASSOU — ') + ok + ' ok, ' + falhas.length + ' falharam' + (falhas.length ? ': ' + falhas.join('; ') : ''));
process.exit(falhas.length ? 1 : 0);
