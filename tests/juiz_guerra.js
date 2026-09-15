#!/usr/bin/env node
'use strict';
/* PROVA DO JUIZ — a guerra de guilda 2×2 refeita no servidor (15/09).
 *
 *   node tests/juiz_guerra.js            a prova
 *   node tests/juiz_guerra.js --joga     (para tests/guerra_api.py) lê {ata, op} do stdin, joga a guerra num motor
 *                                        com a IA pelos quatro e escreve {lances, hashFinal, fase, venc}
 *
 * Quatro contas (Ana e Bia pela guilda A, Cris e Duda pela B), cada uma com a DUPLA dela — e Ana e Bia com os
 * MESMOS heróis (o heroId é a classe e colide entre os dois jogadores do mesmo lado):
 *   - a ata sai do estado de cada conta, com o dono de cada herói; conta com três, herói de fora e dono repetido caem;
 *   - a vida de cada herói entra pela chave dono:heroId (a da Ana ferida, a da Bia cheia);
 *   - a guerra jogada num motor com os lances dos quatro (e a queda da Bia no meio: o turno dela passa, e a volta)
 *     é refeita com o mesmo fim e o mesmo hash, e a vida do fim vem POR DONO;
 *   - quem sai da guerra morre (a marca `morte`) e o replay acompanha;
 *   - lance do Cris na vez da Ana cai (422 vez); a vida trocada na ata diverge;
 *   - a guerra largada no meio (W.O.) é refeita sem vencedor, e a vida sai assim mesmo. */
const path = require('path');
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
const { mundo } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'motor.js'));
const { ataGuerra, fechaGuerra } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'guerra.js'));
const { ehDeGente, aplicaCarryRede } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));

const clone = (o) => JSON.parse(JSON.stringify(o));

/* joga a guerra da ata num motor NOVO, como os quatro clientes em lockstep jogariam: os heróis de gente pela IA
 * anotando cada lance com o dono, monstros/invocações na IA como o juiz roda. op = { cai: {dono, depois, volta},
 * sai: {dono, depois}, para: n (turnos de gente, e larga: o W.O.) } */
function jogaGuerra(ata, op) {
  op = op || {};
  const J = mundo().JOGO, E = J.Engine;
  const st = E.createDuelSala(ata.mapa, ata.sala, clone(ata.A), clone(ata.B), { seed: ata.semente });
  aplicaCarryRede(st, ata.carry || null);
  E.events.length = 0;
  const log = [];
  const turnos = {};
  let voltas = 0, gente = 0, largou = false;
  const deDono = (d) => st.units.filter((x) => x.dono === d && (x.kind === 'hero' || x.kind === 'fusion') && x.alive && !x.offBoard);
  while (st.phase === 'playing' && voltas++ < 5000) {
    const u = E.activeUnit(st);
    if (!u) break;
    if (ehDeGente(u)) {
      if (u.ia) { E.endTurn(st); E.events.length = 0; continue; }       // o turno de quem caiu passa
      if (op.para && gente >= op.para) { largou = true; break; }
      gente++;
      // op.passa: ninguém ataca (só encerra a vez) — o teto de rodadas decide, e com todos cheios é empate
      const plano = op.passa ? [] : (J.AI.planTurn(st, u.uid) || []);
      for (const a of plano) {
        if (st.phase !== 'playing') break;
        if (a.action === 'move') log.push({ a: 'm', u: u.uid, x: a.x, y: a.y, ok: !!E.move(st, u.uid, a.x, a.y), de: u.dono });
        else if (a.action === 'cast') log.push({ a: 'c', u: u.uid, s: a.spellId, x: a.x, y: a.y, ok: !!E.cast(st, u.uid, a.spellId, a.x, a.y), de: u.dono });
        else if (a.action === 'end') break;
        E.events.length = 0;
      }
      if (st.phase === 'playing') { E.endTurn(st); log.push({ a: 'e', ok: true, de: u.dono }); }
      E.events.length = 0;
      turnos[u.dono] = (turnos[u.dono] || 0) + 1;
      if (op.cai && u.dono === op.cai.dono && turnos[u.dono] === op.cai.depois && st.phase === 'playing') {
        deDono(op.cai.dono).forEach((x) => { x.ia = true; log.push({ a: 'x', ev: 'ia', u: x.uid, v: true, ok: true }); });
      }
      if (op.cai && op.cai.volta && gente === op.cai.volta && st.phase === 'playing') {
        st.units.filter((x) => x.dono === op.cai.dono && x.ia).forEach((x) => { x.ia = false; log.push({ a: 'x', ev: 'ia', u: x.uid, v: false, ok: true }); });
      }
      if (op.sai && u.dono !== op.sai.dono && gente === op.sai.depois && st.phase === 'playing') {
        deDono(op.sai.dono).forEach((x) => { if (x.alive && !x.offBoard) { log.push({ a: 'x', ev: 'morte', u: x.uid, ok: true }); E.processDeath(st, x); } });
        E.events.length = 0;
      }
      continue;
    }
    // a IA como o juiz a roda (sala.js, rodaIA)
    let plano = null;
    try { plano = J.AI.planTurn(st, u.uid); } catch (e) { plano = null; }
    if (!plano || !plano.length) plano = [{ action: 'end' }];
    let acabou = false;
    for (let i = 0; i < plano.length && st.phase === 'playing'; i++) {
      const a = plano[i];
      try {
        if (a.action === 'move') E.move(st, u.uid, a.x, a.y);
        else if (a.action === 'cast') E.cast(st, u.uid, a.spellId, a.x, a.y);
        else if (a.action === 'end') { E.endTurn(st); acabou = true; break; }
      } catch (e) {}
    }
    if (!acabou && st.phase === 'playing') E.endTurn(st);
    E.events.length = 0;
  }
  const FIM = { won: 'A', lost: 'B', empate: 'empate' };
  return { lances: log, hashFinal: largou ? null : E.hash(st), fase: st.phase, venc: FIM[st.phase] || null, estado: st };
}

if (require.main === module && process.argv.indexOf('--joga') >= 0) {
  let txt = '';
  process.stdin.on('data', (c) => { txt += c; });
  process.stdin.on('end', () => {
    const e = JSON.parse(txt);
    const r = jogaGuerra(e.ata, e.op || {});
    delete r.estado;
    process.stdout.write(JSON.stringify(r));
  });
} else if (require.main === module) {
  prova();
}
module.exports = { jogaGuerra };

function prova() {
  let total = 0, falhas = 0;
  function check(nome, ok, extra) {
    total++;
    if (!ok) falhas++;
    console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
  }
  function conta(niveis) {
    const w = est.mundoEconomico({ agoraMs: Date.now(), semente: 5 });
    est.poeEstado(w, null, null);
    const J = w.J;
    Object.keys(niveis).forEach((h) => {
      J.Progress.state.heroes[h].level = niveis[h];
      J.Progress.state.heroes[h].xp = J.DATA.leveling.xpTable[niveis[h] - 1];
    });
    J.Progress.save();
    return est.tiraEstado(w);
  }
  function jogador(c, id, dono, lado) {
    return { conta: { id, gm: false }, dono, lado, herois: ['sumo', 'curandeiro'], progress: c.progress, db: c.db };
  }
  function cai(fn) { try { fn(); return null; } catch (e) { return e; } }

  const ana = conta({ sumo: 18, curandeiro: 16 }), bia = conta({ sumo: 17, curandeiro: 15 });
  const cris = conta({ sumo: 18, curandeiro: 16 }), duda = conta({ sumo: 16, curandeiro: 17 });
  const js = [jogador(ana, 1, 'ana', 'A'), jogador(bia, 2, 'bia', 'A'), jogador(cris, 3, 'cris', 'B'), jogador(duda, 4, 'duda', 'B')];
  const saida = ataGuerra({ jogadores: js });
  check('a ata tem quatro heróis por lado, dos donos certos e na ordem (quem inscreveu, quem se juntou)',
        saida.ok && saida.A.length === 4 && saida.B.length === 4 &&
        saida.A.map((p) => p.dono).join() === 'ana,ana,bia,bia' && saida.B.map((p) => p.dono).join() === 'cris,cris,duda,duda',
        JSON.stringify([saida.A.map((p) => p.dono), saida.B.map((p) => p.dono)]));
  check('o payload sai do estado do servidor (o nível da conta) e sem as peças', saida.A[0].level === 18 && saida.A[2].level === 17 &&
        saida.A[0].items === undefined, saida.A[0].level + '/' + saida.A[2].level);
  let e = cai(() => ataGuerra({ jogadores: js.slice(0, 3) }));
  check('a ata com três jogadores cai', e && e.juiz && e.motivo === 'entrada', e && e.message);
  e = cai(() => ataGuerra({ jogadores: [js[0], Object.assign({}, js[1], { herois: ['inexistente'] }), js[2], js[3]] }));
  check('herói que não é da conta cai', e && e.juiz && e.motivo === 'herois', e && e.message);
  e = cai(() => ataGuerra({ jogadores: [js[0], Object.assign({}, js[1], { dono: 'ana' }), js[2], js[3]] }));
  check('dois jogadores com o mesmo dono caem', e && e.juiz, e && e.message);

  const ata = { mapa: 'sede', sala: 0, semente: 424242, A: saida.A, B: saida.B, carry: { 'ana:sumo': 9 } };
  const J0 = mundo().JOGO;
  const st0 = J0.Engine.createDuelSala('sede', 0, clone(ata.A), clone(ata.B), { seed: ata.semente });
  aplicaCarryRede(st0, ata.carry);
  const sumoAna = st0.units.find((u) => u.dono === 'ana' && u.heroId === 'sumo');
  const sumoBia = st0.units.find((u) => u.dono === 'bia' && u.heroId === 'sumo');
  check('a vida entra por dono:heroId — o Sumo da Ana a 9 PV, o da Bia (o MESMO heroId) cheio',
        sumoAna && sumoAna.hp === 9 && sumoBia && sumoBia.hp === sumoBia.hpMax, sumoAna && sumoAna.hp + ' / ' + (sumoBia && sumoBia.hp));
  check('oito heróis no Salão da Sede, quatro de cada lado', st0.units.filter((u) => u.kind === 'hero').length === 8 &&
        st0.units.filter((u) => u.side === 'player').length === 4, st0.units.length);

  const jogo = jogaGuerra(ata, { cai: { dono: 'bia', depois: 1, volta: 10 } });
  const marcas = jogo.lances.filter((l) => l.a === 'x').length;
  check('a guerra jogada num motor chega ao fim (com a queda e a volta da Bia)', !!jogo.venc && marcas >= 2,
        jogo.fase + ' · ' + jogo.lances.length + ' lances · ' + marcas + ' marcas');
  const r = fechaGuerra({ ata, lances: jogo.lances, hashFinal: jogo.hashFinal });
  check('o juiz refaz com o MESMO fim e o mesmo hash', r.ok && r.fase === jogo.fase && r.venc === jogo.venc && r.hash === jogo.hashFinal,
        JSON.stringify({ fase: r.fase, venc: r.venc }));
  check('a vida do fim vem POR DONO (os dois Sumos do lado A separados) e com o máximo de cada um',
        ['ana', 'bia', 'cris', 'duda'].every((d) => r.vida[d] && typeof r.vida[d].sumo === 'number' && typeof r.vida[d].curandeiro === 'number' &&
          r.vidaMax[d] && r.vidaMax[d].sumo >= 1) &&
        r.vida.ana.sumo === Engine0Vida(jogo.estado, 'ana', 'sumo') && r.vida.bia.sumo === Engine0Vida(jogo.estado, 'bia', 'sumo'),
        JSON.stringify(r.vida));
  check('turnos de gente contados (a régua do tempo mínimo)', r.turnosJogador > 0, r.turnosJogador);

  const saiu = jogaGuerra(ata, { sai: { dono: 'duda', depois: 3 } });
  const rs = fechaGuerra({ ata, lances: saiu.lances, hashFinal: saiu.hashFinal });
  check('quem sai da guerra morre (a marca morte) e o replay acompanha', rs.fase === saiu.fase && rs.hash === saiu.hashFinal &&
        rs.vida.duda.sumo === 0 && rs.vida.duda.curandeiro === 0, JSON.stringify(rs.vida.duda));

  const forjado = clone(jogo.lances);
  const iAna = forjado.findIndex((l) => l.de === 'ana' && l.a !== 'x');
  forjado[iAna].de = 'cris';
  e = cai(() => fechaGuerra({ ata, lances: forjado, hashFinal: jogo.hashFinal }));
  check('o lance do Cris na vez da Ana cai (422 vez)', e && e.juiz && e.motivo === 'vez', e && (e.motivo + ' ' + e.message));
  /* a vida está presa ao hash desde o primeiro turno: a mesma ata com todos cheios nasce com OUTRO hash (o
   * registro não leva hash por lance; se a luta com outra vida acabar igual por acaso, não houve vantagem) */
  const stCheio = J0.Engine.createDuelSala('sede', 0, clone(ata.A), clone(ata.B), { seed: ata.semente });
  aplicaCarryRede(stCheio, null);
  check('a vida trocada na ata (todos cheios) muda o hash desde o começo', J0.Engine.hash(stCheio) !== J0.Engine.hash(st0),
        J0.Engine.hash(stCheio) + ' / ' + J0.Engine.hash(st0));

  const wo = jogaGuerra(ata, { para: 6 });
  const rw = fechaGuerra({ ata, lances: wo.lances, hashFinal: null });
  check('a guerra largada no meio (W.O.) é refeita sem vencedor, com a vida', rw.ok && rw.venc === null && rw.fase === 'playing' &&
        rw.vida.cris && typeof rw.vida.cris.sumo === 'number', rw.fase + ' ' + rw.venc);

  console.log((falhas ? 'FALHOU — ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exitCode = falhas ? 1 : 0;
}

function Engine0Vida(st, dono, hid) {
  const u = st.units.find((x) => x.kind === 'hero' && x.dono === dono && x.heroId === hid);
  if (!u) return -1;
  if (u.fusedInto) {
    const f = st.units.find((x) => x.kind === 'fusion' && (x.fusedFrom || []).indexOf(u.uid) >= 0);
    return f ? (f.alive ? Math.max(1, Math.floor(f.hp / 2)) : 0) : -1;
  }
  return u.alive ? Math.max(0, Math.floor(u.hp)) : 0;
}
