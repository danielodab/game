#!/usr/bin/env node
'use strict';
/* PROVA DA GEMA ENTERRADA (08/10) — a pedra rara que engasta UM bônus a mais na peça.
 *
 *   node tests/gema.js
 *
 * Cobra, com o mesmo mundo do juiz (servidor/juiz/estado.js) que roda o progress.js do jogo:
 *   - 100 Fragmentos de Gema viram 1 Gema Enterrada (tudo ou nada; 99 não viram);
 *   - o engaste gasta 1 gema, sorteia pelos pesos (PA < PP < dano < vida) e grava `extra` na
 *     CÓPIA — a peça não aceita outra, e sem gema nada acontece;
 *   - o bônus entra nos stats do herói (hp, pa, pp, power) quando a peça está vestida, e some
 *     ao tirar; o teto da peça (+1 PA) não corta o +1 PA da gema;
 *   - a cópia leva o `extra` ao vestir, ao devolver ao saco, ao forjar vestida, ao cofre do
 *     Acampamento e pelo saneamento do save; a quebra de duas cópias "iguais" só vê a sem gema;
 *   - nem a Gema nem o Fragmento servem de pedra de forjar a peça neutra;
 *   - a peça engastada não funde (3 cópias) e não sai pela troca, pelo banco da guilda nem
 *     pelo mercadinho (o juiz recusa com motivo 'engastada');
 *   - as ops do juiz: `juntarFragmentos` e `engastarGema` (saco por índice + série; vestida por
 *     herói e espaço), determinísticas pela semente;
 *   - a loja entrega os Fragmentos como 'pedras' e recusa a Gema inteira;
 *   - o saque: um chefe morto num dos seis portais deixa fragmentos; fora deles, nunca. */
const path = require('path');
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
const { executa } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'economia.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
const AGORA = Date.UTC(2026, 9, 8, 15, 0, 0);

function mundo(semente) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: semente || 3 });
  est.poeEstado(w, null, null);
  return w;
}
/* uma conta com o Bárbaro no 22, uma peça de punho de +1 PA no saco (para o teto), gemas e fragmentos */
function conta(prepara) {
  const w = mundo();
  const J = w.J, P = J.Progress, D = J.DATA;
  const h = P.state.heroes.sumo;
  h.level = 22; h.xp = D.leveling.xpTable[21];
  const g = P.gemaCfg();
  P.state.stones = {}; P.state.stones[g.fragmento] = 250; P.state.stones[g.id] = 2;
  // a peça de +1 PA do jardim, duas cópias — e uma peça neutra qualquer
  const comPa = Object.keys(D.items).filter((id) => D.items[id].bonuses && D.items[id].bonuses.pa === 1 &&
    D.items[id].slot === 'punho' && (!P.nivelUsoDe || P.nivelUsoDe(id) <= 10))[0];
  const neutra = Object.keys(D.items).filter((id) => (D.items[id].element || 'neutro') === 'neutro' &&
    (!P.nivelUsoDe || P.nivelUsoDe(id) <= 10) && !D.items[id].noDrop)[0];
  P.addItem(comPa, 'saque'); P.addItem(comPa, 'saque'); P.addItem(comPa, 'saque');
  if (neutra) P.addItem(neutra, 'saque');
  if (prepara) prepara(J, P);
  P.save();
  const s = est.tiraEstado(w);
  return { w, J, P, comPa, neutra, progress: s.progress, db: s.db, hash: s.hash };
}
function pede(base, ops, extra) {
  return executa(Object.assign({ conta: { id: 1, gm: false }, progress: base.progress, db: base.db,
                                 ops, semente: 777, contexto: { agoraMs: AGORA } }, extra || {}));
}
async function tenta(base, ops, extra) {
  try { return await pede(base, ops, extra); } catch (e) { return { erro: e.message, motivo: e.motivo, indice: e.indice }; }
}

(async () => {
  // ---------------------------------------------------------------- o dado
  const c0 = conta();
  const P = c0.P, J = c0.J, g = P.gemaCfg();
  check('DATA.gema e DATA.stones trazem a Gema e o Fragmento', !!J.DATA.gema && !!J.DATA.stones[g.id] && !!J.DATA.stones[g.fragmento] &&
        J.DATA.stones[g.id].element === 'gema' && J.DATA.stones[g.fragmento].element === 'fragmento');
  check('100 fragmentos por gema; os quatro bônus do dono (pa, pp, dano, vida) com os pesos crescentes',
        g.porGema === 100 && P.EXTRAS.join() === 'pa,pp,dano,vida' &&
        g.pesos.pa < g.pesos.pp && g.pesos.pp < g.pesos.dano && g.pesos.dano < g.pesos.vida, JSON.stringify(g.pesos));
  const ch = P.gemaChances();
  check('as chances somam 1 e seguem a ordem (PA a mais difícil, vida a mais fácil)',
        Math.abs(ch.pa + ch.pp + ch.dano + ch.vida - 1) < 1e-9 && ch.pa < ch.pp && ch.pp < ch.dano && ch.dano < ch.vida, JSON.stringify(ch));
  check('nem a Gema nem o Fragmento são pedra de forjar; as cinco de elemento são', !P.pedraDeForja(g.id) && !P.pedraDeForja(g.fragmento) &&
        P.pedraDeForja('stone-slate') && P.pedraDeForja('stone-ember') && !P.pedraDeForja('stone-anchor'));

  // ---------------------------------------------------------------- juntar
  check('com 250 fragmentos, juntar dá 1 gema e deixa 150', (() => {
    const r = P.juntaFragmentos();
    return r && r.gemas === 3 && r.fragmentos === 150 && P.stoneCount(g.fragmento) === 150;
  })());
  P.juntaFragmentos();
  check('com 50, juntar de novo recusa (false) e nada muda', P.juntaFragmentos() === false && P.stoneCount(g.fragmento) === 50 && P.stoneCount(g.id) === 4);

  // ---------------------------------------------------------------- engastar no saco
  const idx = P.state.inventory.findIndex((e) => e.itemId === c0.comPa);
  const iid0 = P.state.inventory[idx].iid;
  const info0 = P.gemaInfo({ invIndex: idx });
  check('gemaInfo da peça sem gema: pode, 4 gemas, sem motivo', info0 && info0.pode && info0.gemas === 4 && info0.motivo === null && info0.onde === 'saco');
  check('gemaInfo com a série errada é null (o saco pode ter mudado)', P.gemaInfo({ invIndex: idx, iid: 'outra' }) === null);
  // o dado cravado: 0.0 cai no primeiro (pa); 0.999 no último (vida)
  P._forjaRng = () => 0.0;
  const e1 = P.engastaGema({ invIndex: idx, iid: iid0 });
  check('engastar com o dado em 0 dá PA, gasta 1 gema e grava extra na cópia',
        e1 && e1.extra === 'pa' && P.stoneCount(g.id) === 3 && P.state.inventory[idx].extra === 'pa' && P.state.inventory[idx].iid === iid0,
        JSON.stringify(e1));
  check('a mesma peça não aceita outra (motivo ja-tem) e a gema não é gasta',
        P.engastaGema({ invIndex: idx }) === false && P.gemaInfo({ invIndex: idx }).motivo === 'ja-tem' && P.stoneCount(g.id) === 3);
  const idx2 = P.state.inventory.findIndex((e, i) => e.itemId === c0.comPa && i !== idx);
  P._forjaRng = () => 0.999;
  const e2 = P.engastaGema({ invIndex: idx2 });
  check('o dado em 0,999 dá vida (o mais fácil)', e2 && e2.extra === 'vida', JSON.stringify(e2));
  // o sorteio pelos pesos: muitas tiradas uniformes caem nas proporções
  const idx3 = P.state.inventory.findIndex((e) => e.itemId === c0.comPa && !e.extra);
  const cont = { pa: 0, pp: 0, dano: 0, vida: 0 };
  for (let k = 0; k < 400; k++) {
    P.state.stones[g.id] = 1;
    delete P.state.inventory[idx3].extra;
    P._forjaRng = () => (k + 0.5) / 400;
    cont[P.engastaGema({ invIndex: idx3 }).extra]++;
  }
  check('400 tiradas uniformes caem nos pesos 1:2:3:4 (40/80/120/160)', cont.pa === 40 && cont.pp === 80 && cont.dano === 120 && cont.vida === 160, JSON.stringify(cont));
  delete P.state.inventory[idx3].extra;
  P.state.stones[g.id] = 0;
  check('sem gema: motivo sem-gema e o engaste recusa', P.gemaInfo({ invIndex: idx3 }).motivo === 'sem-gema' && P.engastaGema({ invIndex: idx3 }) === false);
  P.state.stones[g.id] = 2;
  P._forjaRng = null;

  // ---------------------------------------------------------------- os stats e a cópia que viaja
  const antes = P.effectiveStats('sumo');
  check('a peça de +1 PA com a gema de PA vestida dá +2 PA (a gema é outra fonte, fora do teto da peça)', (() => {
    const ok = P.equip('sumo', c0.comPa, idx);
    const v = P.equippedVar('sumo', 'punho');
    const dep = P.effectiveStats('sumo');
    return ok && v.extra === 'pa' && dep.pa === antes.pa + 2;
  })(), JSON.stringify({ antes: antes.pa, depois: P.effectiveStats('sumo').pa, v: P.equippedVar('sumo', 'punho') }));
  check('invStacks separa a cópia com gema da sem gema', (() => {
    const pilhas = P.invStacks().filter((s) => s.itemId === c0.comPa);
    return pilhas.length === 2 && pilhas.some((s) => s.extra === 'vida') && pilhas.some((s) => !s.extra);
  })(), JSON.stringify(P.invStacks()));
  check('forjar a peça vestida mantém o extra', (() => {
    P.state.stones['stone-slate'] = 50; P.state.stones['stone-ember'] = 50; P.state.stones['stone-tear'] = 50;
    P.state.stones['stone-root'] = 50; P.state.stones['stone-breath'] = 50;
    const r = P.upgradeWorn('sumo', 'punho', false);
    return r && r.resultado === 'subiu' && P.equippedVar('sumo', 'punho').extra === 'pa';
  })());
  check('tirar a peça devolve a cópia com o extra ao saco, e os stats voltam', (() => {
    const ok = P.unequip('sumo', 'punho');
    const volta = P.state.inventory.find((e) => e.iid === iid0);
    return ok && volta && volta.extra === 'pa' && volta.level === 1 && P.effectiveStats('sumo').pa === antes.pa;
  })());
  check('o saneamento do save preserva o extra (no saco e vestida)', (() => {
    const i = P.state.inventory.findIndex((e) => e.iid === iid0);
    P.equip('sumo', c0.comPa, i);
    const cru = JSON.parse(JSON.stringify(P.state));
    const w2 = mundo(5);
    est.poeEstado(w2, cru, null);
    const P2 = w2.J.Progress;
    const v = P2.equippedVar('sumo', 'punho');
    const comVida = P2.state.inventory.find((e) => e.extra === 'vida');
    const lixo = JSON.parse(JSON.stringify(P2.state));
    lixo.inventory[0].extra = 'invencivel';
    const w3 = mundo(6); est.poeEstado(w3, lixo, null);
    return v && v.extra === 'pa' && !!comVida && !w3.J.Progress.state.inventory[0].extra;
  })());
  check('o cofre do Acampamento guarda e devolve o extra', await (async () => {
    const i = P.state.inventory.findIndex((e) => e.extra === 'vida');
    const copia = P.state.inventory.splice(i, 1)[0];
    const r = await J.DB.depositarItem(copia);
    const r2 = await J.DB.sacarItem(r.total - 1);
    const fim = r2.ok && r2.item.extra === 'vida';
    P.state.inventory.push(P.carimba(r2.item, 'banco'));
    return fim && P.state.inventory.some((e) => e.extra === 'vida' && e.iid === copia.iid);
  })());
  check('a neutra não gasta a Gema nem o Fragmento como pedra (stoneForItem)', (() => {
    if (!c0.neutra) return true;
    P.state.stones = { 'stone-slate': 1 }; P.state.stones[g.id] = 40; P.state.stones[g.fragmento] = 999;
    const i = P.state.inventory.findIndex((e) => e.itemId === c0.neutra);
    const info = P.upgradeInfo(i);
    return info && info.stoneId === 'stone-slate';
  })());
  check('a peça engastada não funde (fuseInfo.engastada) e a sem gema não a conta como cópia', (() => {
    P.unequip('sumo', 'punho');
    P.state.inventory.forEach((e) => { if (e.itemId === c0.comPa) e.level = 0; });
    const iCom = P.state.inventory.findIndex((e) => e.itemId === c0.comPa && e.extra);
    const iSem = P.state.inventory.findIndex((e) => e.itemId === c0.comPa && !e.extra);
    const fCom = P.fuseInfo(iCom), fSem = P.fuseInfo(iSem);
    return fCom && fCom.engastada && !fCom.pode && fSem && !fSem.engastada && fSem.copias === 1;
  })());
  check('a quebra só vê como "iguais" as cópias com o mesmo extra', (() => {
    const iSem = P.state.inventory.findIndex((e) => e.itemId === c0.comPa && !e.extra);
    const q = P.quebraInfo(iSem, 1);
    return q && q.copias === 1;
  })());

  // ---------------------------------------------------------------- o juiz
  const base = conta();
  const bIdx = base.progress.inventory.findIndex((e) => e.itemId === base.comPa);
  const bIid = base.progress.inventory[bIdx].iid;
  const r1 = await tenta(base, [{ nome: 'juntarFragmentos', args: {} }, { nome: 'juntarFragmentos', args: {} },
                                { nome: 'juntarFragmentos', args: {} }]);
  check('juiz: juntar 3 vezes com 250 fragmentos dá 2 gemas a mais e recusa a terceira (false)',
        r1.ok && r1.progress.stones[g.id] === 4 && r1.progress.stones[g.fragmento] === 50 && r1.resultados[2] === false, JSON.stringify(r1.resultados || r1));
  const r2 = await tenta(base, [{ nome: 'engastarGema', args: { invIndex: bIdx, iid: bIid } }]);
  const r2b = await tenta(base, [{ nome: 'engastarGema', args: { invIndex: bIdx, iid: bIid } }]);
  check('juiz: engastar pelo índice + série grava o extra e a mesma semente sorteia igual',
        r2.ok && r2.resultados[0] && P.EXTRAS.indexOf(r2.resultados[0].extra) >= 0 && r2.progress.inventory[bIdx].extra === r2.resultados[0].extra &&
        r2.progress.stones[g.id] === 1 && r2b.ok && r2b.hash === r2.hash, JSON.stringify(r2.resultados || r2));
  const r2c = await tenta(base, [{ nome: 'engastarGema', args: { invIndex: bIdx, iid: 'serie-errada' } }]);
  check('juiz: a série errada recusa (false) e nada muda', r2c.ok && r2c.resultados[0] === false && r2c.hash === r2c.hashAntes,
        JSON.stringify({ ok: r2c.ok, res: r2c.resultados, hash: r2c.hash, antes: r2c.hashAntes, base: base.hash, erro: r2c.erro }));
  const r3 = await tenta(base, [{ nome: 'equipar', args: { heroId: 'sumo', itemId: base.comPa, invIndex: bIdx } },
                                { nome: 'engastarGema', args: { heroId: 'sumo', slot: 'punho' } }]);
  check('juiz: engastar a peça VESTIDA pelo herói e espaço', r3.ok && r3.resultados[1] && r3.resultados[1].onde === 'vestida' &&
        !!r3.progress.heroes.sumo.itemVar.punho.extra, JSON.stringify(r3.resultados || r3));
  const presa = conta((Jx, Px) => { Px.state.inventory[0].extra = 'pp'; });
  const pIid = presa.progress.inventory[0].iid;
  const t1 = await tenta(presa, [{ nome: 'trocaTira', args: { iids: [pIid], pets: [], moedas: 0 } }], { contexto: { agoraMs: AGORA, interno: true } });
  const t2 = await tenta(presa, [{ nome: 'bancoGuildaTira', args: { iid: pIid } }], { contexto: { agoraMs: AGORA, interno: true } });
  const t3 = await tenta(presa, [{ nome: 'mercadoTira', args: { iid: pIid } }], { contexto: { agoraMs: AGORA, interno: true } });
  check('juiz: a peça engastada não sai pela troca, pelo banco da guilda nem pelo mercadinho (motivo engastada)',
        t1.motivo === 'engastada' && t2.motivo === 'engastada' && t3.motivo === 'engastada', JSON.stringify([t1, t2, t3]));

  // ---------------------------------------------------------------- a loja
  const L = c0.J.Loja;
  check('a loja entrega os Fragmentos como pedras e recusa a Gema inteira', (() => {
    if (!L || !L._confere) return true;
    return L._confere({ tipo: 'pedras', alvo: g.fragmento, qtd: 10 }) === null &&
           L._confere({ tipo: 'pedras', alvo: g.id, qtd: 1 }) === 'item-invalido';
  })());

  // ---------------------------------------------------------------- o saque
  check('o chefe morto num portal deixa fragmentos; fora dos seis portais, nunca', (() => {
    const G = c0.J.Game;
    if (!G || !G._collectStones) return true;
    const boss = Object.keys(c0.J.DATA.monsters).filter((m) => c0.J.DATA.monsters[m].boss)[0];
    const units = [{ side: 'enemy', alive: false, defId: boss }];
    G.dungeonId = c0.J.DATA.dungeons[0].id;
    const dentro = G._collectStones(units, c0.J.DATA.monsters, null, 1);
    G.dungeonId = 'poco';
    const fora = G._collectStones(units, c0.J.DATA.monsters, null, 1);
    return (dentro[g.fragmento] || 0) >= g.drop.chefeMin && !fora[g.fragmento];
  })());

  console.log('\nRESUMO: ' + (falhas ? falhas + ' falharam de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
