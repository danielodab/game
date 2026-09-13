#!/usr/bin/env node
'use strict';
/* O JOGADOR DE MENTIRA — ferramenta das provas (não é prova sozinho).
 *
 *   node tests/juiz_jogador.js < pedido.json > jogo.json
 *
 * Joga UMA sala como o cliente jogaria, com o estado da conta dado: monta o
 * grupo pelo Progress, escolhe a primeira casa da colocação e deixa a IA do
 * jogo decidir os lances do herói, anotando cada lance no formato do cliente.
 * As provas da API (Python) usam isto para fechar salas de verdade.
 *
 * Entrada (JSON): { progress, db, dungeonId, roomIndex, semente, dificuldade, herois,
 *                   carry?, cortaEm? }   (cortaEm: para depois de N lances)
 * Saída (JSON):   { lances, fase, hash } */
const path = require('path');
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
const { ehDoJogador, aplicaCarry } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));

function joga(p) {
  const w = est.mundoEconomico({ agoraMs: Date.now(), semente: 1 });
  est.poeEstado(w, p.progress, p.db);
  const J = w.J, E = J.Engine;
  const party = J.Progress.battleParty(p.herois);
  const andarPoco = p.dungeonId === 'poco' ? p.roomIndex + 1 : 0;
  if (andarPoco) J.Poco.poeSala(andarPoco, J.Poco.salaSemeada(andarPoco, p.semente));
  const st = E.createBattle(p.dungeonId, p.roomIndex, party,
    { seed: p.semente, dificuldade: p.dificuldade || 'normal', escolhePosicao: true });
  if (andarPoco) J.Poco.escalaEstado(st, andarPoco);
  aplicaCarry(st, p.carry || null);
  E.events.length = 0;
  const lances = [];
  const corta = (typeof p.cortaEm === 'number') ? p.cortaEm : Infinity;
  const op = E.placementOptions(st)[0];
  lances.push({ a: 'p', x: op.x, y: op.y, ok: !!E.place(st, op.x, op.y) });
  E.events.length = 0;
  let voltas = 0;
  fora: while (st.phase === 'playing' && voltas++ < 3000) {
    const u = E.activeUnit(st);
    if (!u) break;
    const meu = ehDoJogador(st, u);
    const plano = J.AI.planTurn(st, u.uid) || [];
    let acabou = false;
    for (const a of (plano.length ? plano : [{ action: 'end' }])) {
      if (st.phase !== 'playing') break;
      if (meu && lances.length >= corta) break fora;
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
    if (!acabou && st.phase === 'playing') {
      if (meu && lances.length >= corta) break;
      E.endTurn(st);
      if (meu) lances.push({ a: 'e', ok: true });
    }
    E.events.length = 0;
  }
  return { lances, fase: st.phase, hash: E.hash(st) };
}

if (require.main === module) {
  const pedacos = [];
  process.stdin.on('data', (c) => pedacos.push(c));
  process.stdin.on('end', () => {
    const p = JSON.parse(Buffer.concat(pedacos).toString('utf8'));
    process.stdout.write(JSON.stringify(joga(p)));
  });
}

module.exports = { joga };
