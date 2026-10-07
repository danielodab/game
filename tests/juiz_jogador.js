#!/usr/bin/env node
'use strict';
/* O JOGADOR DE MENTIRA — ferramenta das provas (não é prova sozinho).
 *
 *   node tests/juiz_jogador.js < pedido.json > jogo.json
 *   node tests/juiz_jogador.js --ao-vivo        (a Câmara do Eco com o servidor de verdade: ver abaixo)
 *
 * Joga UMA sala como o cliente jogaria, com o estado da conta dado: monta o
 * grupo pelo Progress, escolhe a primeira casa da colocação e deixa a IA do
 * jogo decidir os lances do herói, anotando cada lance no formato do cliente.
 * As provas da API (Python) usam isto para fechar salas de verdade.
 *
 * Entrada (JSON): { progress, db, dungeonId, roomIndex, semente, dificuldade, herois,
 *                   carry?, cortaEm?, sais?, opcao? }   (cortaEm: para depois de N lances; opcao: a casa da colocação)
 * (13/09: o herói não bebe mais poção na batalha — ela é da sala de espera entre as salas)
 * Saída (JSON):   { lances, fase, hash, pedidos }
 *
 * O SAL DA RODADA (03/10, a Câmara do Eco): na virada de cada rodada o motor para e espera o sal dela, que o
 * servidor só dá contra o caminho dos lances até ali. Este jogador pede como o game.js pede (pedeSalEco): o
 * lance { a: 'r', r, s } entra depois do pedido. Sem servidor, `sais` ({rodada: sal}) responde; sem o sal da
 * rodada a partida para ali (a largada na virada). Com `--ao-vivo` a primeira linha da entrada é o pedido, e a
 * cada virada sai uma linha {"pede": {rodada, caminho}} e entra uma {"sal": N | null} — a prova em Python pede
 * ao servidor de verdade (POST /api/supremo/sal) no meio. No fim sai {"fim": {...}}. */
const path = require('path');
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
const { ehDoJogador, aplicaCarry } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));

/* a partida inteira como gerador: cada virada da Câmara do Eco cede {rodada, caminho} e recebe o sal (ou null) */
function* partida(p) {
  const w = est.mundoEconomico({ agoraMs: Date.now(), semente: 1 });
  est.poeEstado(w, p.progress, p.db);
  const J = w.J, E = J.Engine;
  const party = J.Progress.battleParty(p.herois);
  const andarPoco = p.dungeonId === 'poco' ? p.roomIndex + 1 : 0;
  if (andarPoco) J.Poco.poeSala(andarPoco, J.Poco.salaSemeada(andarPoco, p.semente));
  const st = E.createBattle(p.dungeonId, p.roomIndex, party,
    { seed: p.semente, dificuldade: p.dificuldade || 'normal', escolhePosicao: true,
      afixo: p.afixo || null });            // 07/10: o afixo do bilhete, como o Game faz ao entrar
  if (andarPoco) J.Poco.escalaEstado(st, andarPoco);
  aplicaCarry(st, p.carry || null);
  E.events.length = 0;
  const lances = [];
  const pedidos = [];
  const corta = (typeof p.cortaEm === 'number') ? p.cortaEm : Infinity;
  const ops = E.placementOptions(st);
  const op = ops[(typeof p.opcao === 'number' && ops[p.opcao]) ? p.opcao : 0];    // `opcao`: outra casa, outro caminho
  lances.push({ a: 'p', x: op.x, y: op.y, ok: !!E.place(st, op.x, op.y) });
  E.events.length = 0;
  let voltas = 0;
  fora: while (st.phase === 'playing' && voltas++ < 3000) {
    const espera = E.ecoEsperaSal ? E.ecoEsperaSal(st) : 0;
    if (espera) {
      if (lances.length >= corta) break;
      const caminho = E.ecoCaminho(lances);
      const sal = yield { rodada: espera, caminho };
      pedidos.push({ rodada: espera, caminho, sal: (typeof sal === 'number') ? sal : null });
      if (typeof sal !== 'number') break;               // sem o sal a rodada não começa: a largada na virada
      lances.push({ a: 'r', r: espera, s: sal, ok: !!E.ecoSal(st, espera, sal) });
      E.events.length = 0;
      continue;
    }
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
    if (!acabou && st.phase === 'playing' && !(E.ecoEsperaSal && E.ecoEsperaSal(st))) {
      if (meu && lances.length >= corta) break;
      E.endTurn(st);
      if (meu) lances.push({ a: 'e', ok: true });
    }
    E.events.length = 0;
  }
  return { lances, fase: st.phase, hash: E.hash(st), pedidos };
}

/* sem servidor: o sal vem de `p.sais` ({rodada: sal}); a rodada sem sal ali para a partida */
function joga(p) {
  const g = partida(p);
  const sais = (p && p.sais && typeof p.sais === 'object') ? p.sais : {};
  let passo = g.next();
  while (!passo.done) passo = g.next(Object.prototype.hasOwnProperty.call(sais, passo.value.rodada) ? sais[passo.value.rodada] : null);
  return passo.value;
}

/* ao vivo: uma linha de JSON por mensagem, nos dois sentidos */
function aoVivo() {
  const rl = require('readline').createInterface({ input: process.stdin });
  let g = null;
  function manda(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
  function anda(valor) {
    const passo = g.next(valor);
    if (passo.done) { manda({ fim: passo.value }); rl.close(); return; }
    manda({ pede: passo.value });
  }
  rl.on('line', (linha) => {
    if (!linha.trim()) return;
    const m = JSON.parse(linha);
    if (!g) { g = partida(m); anda(undefined); return; }
    anda(m.sal);
  });
}

if (require.main === module) {
  if (process.argv.indexOf('--ao-vivo') >= 0) aoVivo();
  else {
    const pedacos = [];
    process.stdin.on('data', (c) => pedacos.push(c));
    process.stdin.on('end', () => {
      const p = JSON.parse(Buffer.concat(pedacos).toString('utf8'));
      process.stdout.write(JSON.stringify(joga(p)));
    });
  }
}

module.exports = { joga, partida };
