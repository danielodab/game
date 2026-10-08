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
 *     ('regras-mudaram', que a API vence sem tratar como fraude);
 *   - O ENSAIO (03/10, o dono: "dificulte"): a sorte da rodada 2 a 12 vem de um
 *     sal que o servidor só dá contra o caminho dos lances até a virada. O
 *     servidor de mentira daqui faz a conta do de verdade (a chave da
 *     tentativa, um caminho por rodada) e o juiz tem de recusar quem tenta
 *     ensaiar: jogar outro caminho com o sal de um ('caminho-trocado'), inventar
 *     o sal ('sal-forjado'), pular a rodada sem sal ('sal-faltando'), trazer o
 *     sal fora da virada ou de outra rodada ('sal-fora-da-hora'), um sal que o
 *     servidor nunca deu ('sal-nao-pedido'), e a tentativa sem a chave. A conta
 *     do sal em Python é conferida com a daqui em tests/supremo_api.py. */
const path = require('path');
const nodeCrypto = require('crypto');
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
const { fecha, salDe } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'supremo.js'));
const { ehDoJogador, refaz } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));

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

/* O SERVIDOR DE MENTIRA do sal (a conta de servidor/supremo.py): a chave da tentativa e UM caminho por rodada.
 * `trava: false` dá o sal de qualquer caminho — o que o atacante queria que o servidor fizesse. */
function servidorDeSal(trava) {
  const chave = nodeCrypto.randomBytes(32);
  const sais = [];
  return {
    chaveHex: chave.toString('hex'),
    sais,
    pede(rodada, caminho) {
      const ja = sais.find((x) => x.rodada === rodada);
      if (ja && trava !== false) return ja.caminho === caminho ? ja.sal : null;
      const sal = salDe(chave, rodada, caminho);
      if (!ja) sais.push({ rodada, caminho, sal });
      return sal;
    }
  };
}
const CAMINHO = est.mundoEconomico({ agoraMs: AGORA, semente: 1 }).J.Engine.ecoCaminho;

/* o cliente: a tentativa inteira no mundo dele; `meio` guarda o placar e os lances até a metade. Na virada de
 * cada rodada ele pede o sal com o caminho dos lances até ali, como o game.js (pedeSalEco). `opcao` = a casa
 * da colocação (dois caminhos diferentes da mesma tentativa); `paraNoSal` = larga parado na virada dessa rodada */
function clienteJoga(conta, herois, semente, srv, opcao, paraNoSal) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 3 });
  est.poeEstado(w, conta.progress, conta.db);
  const J = w.J, E = J.Engine;
  const party = J.Progress.battleParty(herois);
  const st = E.createBattle(J.DATA.eco.arena, 0, party, { seed: semente, dificuldade: 'normal', escolhePosicao: true });
  E.events.length = 0;
  const lances = [];
  const op = E.placementOptions(st)[opcao || 0];
  lances.push({ a: 'p', x: op.x, y: op.y, ok: !!E.place(st, op.x, op.y) });
  E.events.length = 0;
  let voltas = 0, meio = null, parada = null;
  const caminhos = {};
  while (st.phase === 'playing' && voltas++ < 3000) {
    const r = E.ecoEsperaSal(st);
    if (r) {
      if (r === paraNoSal) { parada = { lances: lances.slice(), placar: JSON.parse(JSON.stringify(E.ecoPlacar(st))) }; break; }
      const caminho = E.ecoCaminho(lances);
      caminhos[r] = caminho;
      const sal = srv.pede(r, caminho);
      lances.push({ a: 'r', r, s: sal, ok: !!E.ecoSal(st, r, sal) });
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
  return { lances, fase: st.phase, hash: E.hash(st), placar: E.ecoPlacar(st), meio, parada, caminhos };
}

/* o pedido da API ao juiz: a chave DESTA tentativa e os sais que o servidor deu (as linhas de supremo_sais) */
function pedido(conta, herois, semente, lances, hashFinal, extra, srv) {
  const s = srv || SRV;
  return Object.assign({
    conta: { id: 1, gm: false },
    tentativa: { semente, herois, regras: undefined, chaveSal: s.chaveHex, sais: JSON.parse(JSON.stringify(s.sais)) },
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
const SRV = servidorDeSal();
const jogo = clienteJoga(conta, HEROIS, SEMENTE, SRV);
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

// o lance trocado diverge. 08/10 à noite (engine.js, decisão 24): o golpe 'enemy' mirado numa
// casa VAZIA agora SAI — então "x + 3" já não garante um lance recusado (ok trocado → 'divergiu'):
// o replay segue e cai mais adiante no caminho travado da rodada ('caminho-trocado'). A casa fora
// do mapa é recusada em qualquer regra, e é ela que prova o 'divergiu' pelo `ok` do lance.
const torto = JSON.parse(JSON.stringify(jogo.lances));
const iCast = torto.findIndex((l) => l.a === 'c' && l.ok);
if (iCast >= 0) torto[iCast].x = -1;
const r4 = tenta(pedido(conta, HEROIS, SEMENTE, torto, jogo.hash));
check('o lance trocado é recusado como divergência (a API não pontua)', r4 && r4.juiz && r4.motivo === 'divergiu',
      JSON.stringify(r4).slice(0, 200));
const torto2 = JSON.parse(JSON.stringify(jogo.lances));
if (iCast >= 0) torto2[iCast].x = (torto2[iCast].x + 3) % 18;
const r4b = tenta(pedido(conta, HEROIS, SEMENTE, torto2, jogo.hash));
check('o golpe trocado para outra casa (que pode sair no vazio, 08/10) TAMBÉM é recusado: divergência ou caminho travado',
      r4b && r4b.juiz && (r4b.motivo === 'divergiu' || r4b.motivo === 'caminho-trocado'), JSON.stringify(r4b).slice(0, 200));
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

// ------------------------------------------------------------- o sal de cada rodada (03/10)
const nSais = jogo.lances.filter((l) => l.a === 'r').length;
const ultimaRodada = jogo.placar.rodada;
check('a tentativa honesta levou um sal por rodada jogada depois da 1ª (' + nSais + ' sais, até a rodada ' + ultimaRodada + ')',
      nSais === ultimaRodada - 1 && SRV.sais.length === nSais && nSais >= 2, nSais + ' / ' + ultimaRodada);
check('cada sal saiu do caminho dos lances até a virada dele (o caminho que o juiz recalcula)',
      jogo.lances.every((l, i) => l.a !== 'r' || SRV.sais.find((x) => x.rodada === l.r).caminho === CAMINHO(jogo.lances.slice(0, i))));

// O ENSAIO, como um atacante faria: a mesma tentativa jogada por OUTRO caminho na rodada 1 (outra casa na
// colocação). O servidor travou o caminho A na rodada 2; o caminho B pede o sal dele e é recusado
const caminhoB = clienteJoga(conta, HEROIS, SEMENTE, servidorDeSal(false), 1, 2);
const cB = caminhoB.parada ? CAMINHO(caminhoB.parada.lances) : null;
check('o caminho B (outra casa na colocação) é outro caminho até a rodada 2', !!cB && cB !== jogo.caminhos[2]);
check('o servidor que trava não dá o sal de um 2º caminho na mesma rodada (o pedido do ensaio) e repete o do 1º',
      SRV.pede(2, cB) === null && SRV.pede(2, jogo.caminhos[2]) === SRV.sais.find((x) => x.rodada === 2).sal);
// ... e o que o atacante faria com o sal do caminho A: jogar o B com ele
const salA = jogo.lances.find((l) => l.a === 'r' && l.r === 2).s;
const r9 = tenta(pedido(conta, HEROIS, SEMENTE, caminhoB.parada.lances.concat([{ a: 'r', r: 2, s: salA, ok: true }]), null));
check('jogar outro caminho com o sal travado no primeiro é recusado (caminho-trocado: o ensaio não pontua)',
      r9 && r9.juiz && r9.motivo === 'caminho-trocado', JSON.stringify(r9).slice(0, 200));
// o sal de B feito com a chave (se alguém a tivesse), mas que o servidor nunca deu para a rodada travada em A
const salB = salDe(Buffer.from(SRV.chaveHex, 'hex'), 2, cB);
const loteB = caminhoB.parada.lances.concat([{ a: 'r', r: 2, s: salB, ok: true }]);
const r10 = tenta(pedido(conta, HEROIS, SEMENTE, loteB, null));
check('nem com o sal certo de B: a rodada 2 já está travada no caminho A (caminho-trocado)',
      r10 && r10.juiz && r10.motivo === 'caminho-trocado', JSON.stringify(r10).slice(0, 200));
const r11 = tenta(pedido(conta, HEROIS, SEMENTE, loteB, null, null, { chaveHex: SRV.chaveHex, sais: [] }));
check('um sal que o servidor nunca deu é recusado (sal-nao-pedido), mesmo feito com a chave',
      r11 && r11.juiz && r11.motivo === 'sal-nao-pedido', JSON.stringify(r11).slice(0, 200));
// o sal inventado
const forjado = JSON.parse(JSON.stringify(jogo.lances));
const iSal = forjado.findIndex((l) => l.a === 'r');
forjado[iSal].s = (forjado[iSal].s + 1) % 0x7fffffff;
const r12 = tenta(pedido(conta, HEROIS, SEMENTE, forjado, null));
check('o sal inventado é recusado (sal-forjado)', r12 && r12.juiz && r12.motivo === 'sal-forjado', JSON.stringify(r12).slice(0, 200));
// pular a rodada: jogar a rodada 2 sem o sal dela
const pulada = jogo.lances.filter((l, i) => i !== iSal);
const r13 = tenta(pedido(conta, HEROIS, SEMENTE, pulada, null));
check('jogar a rodada sem o sal dela é recusado (sal-faltando)', r13 && r13.juiz && r13.motivo === 'sal-faltando',
      JSON.stringify(r13).slice(0, 200));
// o sal adiantado (o da rodada 3 no lugar do da 2) e o sal no meio da rodada
const adiantado = JSON.parse(JSON.stringify(jogo.lances));
adiantado[iSal].r = 3;
const r14 = tenta(pedido(conta, HEROIS, SEMENTE, adiantado, null));
check('o sal de outra rodada na virada da 2 é recusado (sal-fora-da-hora)', r14 && r14.juiz && r14.motivo === 'sal-fora-da-hora',
      JSON.stringify(r14).slice(0, 200));
const noMeio = jogo.lances.slice(0, 2).concat([{ a: 'r', r: 2, s: salA, ok: true }]);
const r15 = tenta(pedido(conta, HEROIS, SEMENTE, noMeio, null));
check('o sal no meio da rodada 1 (sem virada esperando) é recusado (sal-fora-da-hora)',
      r15 && r15.juiz && r15.motivo === 'sal-fora-da-hora', JSON.stringify(r15).slice(0, 200));
const semChave = pedido(conta, HEROIS, SEMENTE, jogo.lances, jogo.hash);
delete semChave.tentativa.chaveSal;
const r16 = tenta(semChave);
check('a tentativa sem a chave do sorteio não é refeita', r16 && r16.juiz && r16.motivo === 'entrada', JSON.stringify(r16).slice(0, 200));
// a largada parada na virada (a aba fechou esperando o sal da rodada 4) pontua até ali
const parou = clienteJoga(conta, HEROIS, SEMENTE, SRV, 0, 4);
const r17 = parou.parada ? tenta(pedido(conta, HEROIS, SEMENTE, parou.parada.lances, null)) : null;
check('a tentativa largada esperando o sal pontua o dano até a virada', !!parou.parada && r17 && r17.ok &&
      r17.fase === 'playing' && r17.placar.dano === parou.parada.placar.dano && r17.placar.rodada === 3,
      JSON.stringify(r17 && (r17.placar || r17)).slice(0, 200));
// o lance de sal fora da Câmara (a sala de calabouço não sorteia por rodada)
let r18;
try {
  r18 = refaz({ dungeonId: 'cistern', roomIndex: 0, semente: 11, party: [{ classId: 'sumo', heroId: 'sumo', level: 22 }],
                lances: [{ a: 'r', r: 2, s: 1 }] });
} catch (e) { r18 = { motivo: e.motivo, juiz: !!e.juiz }; }
check('o lance de sal numa sala de calabouço é recusado', r18 && r18.juiz && r18.motivo === 'lance', JSON.stringify(r18).slice(0, 200));

// ---- 07/10: A TENTATIVA EM DUPLA — duas contas, a Câmara refeita como a sala em grupo, UM placar
{
  const { partidaEco } = require(path.join(__dirname, 'juiz_grupo_jogador.js'));
  function membro(nivel, dono, heroi) {
    const w = est.mundoEconomico({ agoraMs: AGORA, semente: 1 });
    est.poeEstado(w, null, null);
    const J = w.J, h = J.Progress.state.heroes[heroi];
    h.level = nivel; h.xp = J.DATA.leveling.xpTable[nivel - 1];
    const t = est.tiraEstado(w);
    return { progress: t.progress, db: t.db, dono, herois: [heroi] };
  }
  const ana = membro(24, 'ana', 'sumo'), bia = membro(24, 'bia', 'curandeiro');
  const srvD = servidorDeSal();
  const g = partidaEco({ membros: [ana, bia], semente: 777 });
  let passo = g.next();
  while (!passo.done) passo = g.next(srvD.pede(passo.value.rodada, passo.value.caminho));
  const jogoD = passo.value;
  console.log('   em dupla: ' + jogoD.lances.length + ' lances · ' + jogoD.fase + ' · dano ' + jogoD.placar.dano);
  check('a dupla joga a Câmara até o fim e tira dano do Eco', jogoD.fase !== 'playing' && jogoD.placar.dano > 0);
  check('os lances da dupla têm os dois donos (o sal é de quem lidera)',
        jogoD.lances.some((l) => l.de === 'bia') && jogoD.lances.filter((l) => l.a === 'r').every((l) => l.de === 'ana'));
  function pedidoD(lances, hashFinal, extra) {
    return Object.assign({
      membros: [{ conta: { id: 1, gm: false }, dono: 'ana', herois: ['sumo'], progress: ana.progress, db: ana.db },
                { conta: { id: 2, gm: false }, dono: 'bia', herois: ['curandeiro'], progress: bia.progress, db: bia.db }],
      tentativa: { semente: 777, chaveSal: srvD.chaveHex, sais: JSON.parse(JSON.stringify(srvD.sais)) },
      lances, hashFinal, contexto: { agoraMs: AGORA }
    }, extra || {});
  }
  const rD = tenta(pedidoD(jogoD.lances, jogoD.hash));
  check('o juiz refaz a tentativa em dupla sem recusar', rD && rD.ok === true, JSON.stringify(rD).slice(0, 300));
  check('o placar da dupla é o do replay (um só para as duas contas)', rD && rD.placar && rD.placar.dano === jogoD.placar.dano &&
        rD.placar.pontos === jogoD.placar.pontos, rD && rD.placar && rD.placar.dano + ' / ' + jogoD.placar.dano);
  check('o hash do fim bate em dupla', rD && rD.hash === jogoD.hash);
  // o lance da Bia com o herói da Ana cai (a vez pelo dono, como na sala em grupo)
  const torto = JSON.parse(JSON.stringify(jogoD.lances));
  const i = torto.findIndex((l) => l.de === 'ana' && (l.a === 'm' || l.a === 'c'));
  if (i >= 0) torto[i].de = 'bia';
  const rT = tenta(pedidoD(torto, jogoD.hash));
  check('o lance de um com o herói do outro derruba a tentativa em dupla', rT && !rT.ok && rT.motivo === 'vez', JSON.stringify(rT).slice(0, 200));
  // o registro é UM: trocar o dono anotado no lance do sal muda o caminho, e o juiz vê que não é o travado
  const comBia = JSON.parse(JSON.stringify(jogoD.lances)).map((l) => (l.a === 'r' ? Object.assign(l, { de: 'bia' }) : l));
  const rB = tenta(pedidoD(comBia, jogoD.hash));
  check('o registro com outro dono no lance do sal não é o caminho travado (cai)', rB && !rB.ok && rB.motivo === 'caminho-trocado',
        JSON.stringify(rB).slice(0, 200));
  check('três membros com o mesmo dono caem', !tenta(pedidoD(jogoD.lances, jogoD.hash, { membros: [
    { conta: { id: 1 }, dono: 'ana', herois: ['sumo'], progress: ana.progress, db: ana.db },
    { conta: { id: 2 }, dono: 'ana', herois: ['curandeiro'], progress: bia.progress, db: bia.db }] })).ok);
}

console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
