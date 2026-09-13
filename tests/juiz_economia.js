#!/usr/bin/env node
'use strict';
/* PROVA DO JUIZ — as operações de economia no servidor (servidor/juiz/economia.js).
 *
 *   node tests/juiz_economia.js
 *
 * Cobra, com a MESMA função do jogo dos dois lados:
 *   - o servidor chega ao mesmo estado (o mesmo hash) que o jogo chega ao
 *     aplicar a op na tela — equipar, cofre, elemento;
 *   - forja e roleta sorteiam com o gerador do servidor, e a mesma semente
 *     sorteia igual;
 *   - a peça nova nasce com série e origem;
 *   - a troca tira de um estado e põe no outro sem duplicar nem sumir;
 *   - op interna ou do Mestre pedida por um cliente comum cai; op desconhecida
 *     ou com argumento torto derruba o pedido inteiro com o índice. */
const path = require('path');
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
const { executa } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'economia.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
const AGORA = Date.UTC(2026, 8, 13, 15, 0, 0);

/* uma conta com Bárbaro nível 22, pedras, selos e vinténs, e peças no saco com série */
function conta() {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 3 });
  est.poeEstado(w, null, null);
  const J = w.J, P = J.Progress;
  const h = P.state.heroes.sumo;
  h.level = 22; h.xp = J.DATA.leveling.xpTable[21];
  Object.keys(J.DATA.stones || {}).forEach((sid) => { P.state.stones[sid] = 200; });
  const els = ['fogo', 'agua', 'terra', 'ar', 'neutro'];
  P.state.selos = {}; els.forEach((e) => { P.state.selos[e] = 20; });
  // três peças de mão (punho) diferentes, sem exigência alta, no saco
  const itens = Object.keys(J.DATA.items).filter((id) => {
    const it = J.DATA.items[id];
    return it && it.slot === 'punho' && (!P.nivelUsoDe || P.nivelUsoDe(id) <= 10);
  }).slice(0, 3);
  itens.forEach((id) => P.addItem(id, 'saque'));
  P.save();
  J.DB.ganharMoedas(500);
  const s = est.tiraEstado(w);
  return { progress: s.progress, db: s.db, hash: s.hash, itens };
}

/* aplica a mesma coisa "na tela" (no mundo do cliente) e devolve o hash */
async function clienteFaz(base, fn) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 99 });
  est.poeEstado(w, base.progress, base.db);
  await fn(w.J);
  return est.tiraEstado(w);
}

function pede(base, ops, extra) {
  return executa(Object.assign({ conta: { id: 1, gm: false }, progress: base.progress, db: base.db,
                                 ops, semente: 777, contexto: { agoraMs: AGORA } }, extra || {}));
}
async function tenta(base, ops, extra) {
  try { return await pede(base, ops, extra); } catch (e) { return { erro: e.message, motivo: e.motivo, indice: e.indice }; }
}

(async () => {
  const base = conta();
  check('a conta de prova tem peças com série no saco', base.itens.length >= 1 &&
        base.progress.inventory.every((e) => !!e.iid), JSON.stringify(base.itens));

  // ---- equipar: o servidor e a tela chegam ao mesmo estado
  const idx = base.progress.inventory.findIndex((e) => e.itemId === base.itens[0]);
  const r1 = await tenta(base, [{ nome: 'equipar', args: { heroId: 'sumo', itemId: base.itens[0], invIndex: idx } }]);
  const c1 = await clienteFaz(base, (J) => { J.Progress.equip('sumo', base.itens[0], idx); });
  check('equipar no servidor dá o mesmo hash que equipar na tela', r1.ok && r1.hash === c1.hash && r1.hash !== base.hash,
        JSON.stringify({ srv: r1.hash || r1.erro, cli: c1.hash, base: base.hash }));
  check('... e a peça está vestida no estado do servidor',
        r1.ok && r1.progress.heroes.sumo.items.punho === base.itens[0] && r1.resultados[0] === true);

  // ---- cofre: depositar vinténs (e a missão de cofre anda nos dois)
  const r2 = await tenta(base, [{ nome: 'depositarMoedas', args: { n: 200 } }]);
  const c2 = await clienteFaz(base, (J) => J.DB.depositarMoedas(200).then((r) =>
    J.Missoes.registra({ tipo: 'deposito', valor: 200, cofreTotal: r.banco })));
  check('depositar vinténs: carteira −200, cofre +200, mesmo hash da tela',
        r2.ok && r2.db.carteira.moedas === 300 && r2.db.banco.moedas === 200 && r2.hash === c2.hash,
        JSON.stringify({ srv: r2.ok ? [r2.db.carteira, r2.db.banco, r2.hash] : r2, cli: c2.hash }));
  const r2b = await tenta(base, [{ nome: 'depositarMoedas', args: { n: 99999 } }]);
  check('depositar mais do que tem: a regra recusa (ok:false) e nada muda', r2b.ok && r2b.resultados[0].ok === false &&
        r2b.hash === base.hash, JSON.stringify(r2b.resultados || r2b));

  // ---- peça no cofre e de volta: a MESMA série
  const iid0 = base.progress.inventory[idx].iid;
  const r3 = await tenta(base, [{ nome: 'depositarItem', args: { invIndex: idx } },
                                { nome: 'sacarItem', args: { indice: 0 } }]);
  check('guardar a peça no cofre e sacar: volta com a MESMA série, sem nascer nada',
        r3.ok && r3.progress.inventory.some((e) => e.iid === iid0) && r3.iids.novos.length === 0 && r3.iids.fora.length === 0,
        JSON.stringify(r3.iids || r3));

  // ---- elemento
  const r4 = await tenta(base, [{ nome: 'escolherElemento', args: { heroId: 'sumo', elemento: 'fogo' } }]);
  const c4 = await clienteFaz(base, (J) => { J.Progress.chooseElement('sumo', 'fogo'); });
  check('escolher o elemento: mesmo hash nos dois lados', r4.ok && r4.hash === c4.hash && r4.progress.heroes.sumo.element === 'fogo');

  // ---- forja: o sorteio é do servidor, e a mesma semente sorteia igual
  const forjas = [];
  for (let k = 0; k < 8; k++) forjas.push({ nome: 'forjarPeca', args: { invIndex: idx, usarGuarda: false } });
  const f1 = await tenta(base, forjas);
  const f2 = await tenta(base, forjas);
  check('forjar 8 vezes: a peça sobe e as pedras descem',
        f1.ok && f1.progress.inventory[idx] && f1.progress.inventory[idx].level > 0 &&
        Object.keys(f1.progress.stones).some((s) => f1.progress.stones[s] < 200),
        JSON.stringify(f1.ok ? f1.resultados : f1));
  check('a mesma semente sorteia a mesma forja (o servidor é determinístico)', f1.ok && f2.ok && f1.hash === f2.hash);
  const f3 = await tenta(base, forjas, { semente: 12345 });
  check('forja com risco usa o gerador do servidor (outra semente pode dar outro resultado; a peça e a série seguem)',
        f3.ok && f3.progress.inventory[idx].iid === iid0, JSON.stringify(f3.ok ? f3.resultados.map((r) => r && r.resultado) : f3));

  // ---- roleta: nasce uma peça com série e origem roleta
  const r5 = await tenta(base, [{ nome: 'girarRoleta', args: {} }]);
  check('a roleta tira selos e a peça nova nasce com série e origem roleta',
        r5.ok && r5.resultados[0] && r5.resultados[0].itemId && r5.iids.novos.length === 1 &&
        r5.iids.novos[0].origem === 'roleta' && r5.iids.novos[0].itemId === r5.resultados[0].itemId,
        JSON.stringify(r5.ok ? { res: r5.resultados[0], novos: r5.iids.novos } : r5));

  // ---- a troca: tira de A, põe em B, sem duplicar
  const b = conta();
  const tira = await tenta(base, [{ nome: 'trocaTira', args: { iids: [iid0], pets: [], moedas: 50 } }],
                           { contexto: { agoraMs: AGORA, interno: true } });
  check('trocaTira: a peça e os vinténs saem do estado de quem dá',
        tira.ok && !tira.progress.inventory.some((e) => e.iid === iid0) && tira.db.carteira.moedas === 450 &&
        tira.iids.fora.indexOf(iid0) >= 0, JSON.stringify(tira.ok ? tira.resultados : tira));
  const poe = await tenta(b, [{ nome: 'trocaPoe', args: tira.ok ? tira.resultados[0] : {} }],
                          { contexto: { agoraMs: AGORA, interno: true } });
  check('trocaPoe: a MESMA série e os vinténs entram em quem recebe, sem nascer cópia nova',
        poe.ok && poe.progress.inventory.some((e) => e.iid === iid0) && poe.db.carteira.moedas === 550 &&
        poe.iids.novos.length === 1 && poe.iids.novos[0].iid === iid0, JSON.stringify(poe.ok ? poe.iids : poe));
  const semVintem = await tenta(base, [{ nome: 'trocaTira', args: { iids: [], moedas: 999999 } }],
                                { contexto: { agoraMs: AGORA, interno: true } });
  check('trocaTira sem vinténs suficientes derruba a troca', !semVintem.ok && semVintem.motivo === 'moedas',
        JSON.stringify(semVintem));

  // ---- as travas
  const interna = await tenta(base, [{ nome: 'trocaPoe', args: { itens: [], pets: [], moedas: 1e9 } }]);
  check('op interna pedida por um cliente cai (interna)', !interna.ok && interna.motivo === 'interna', JSON.stringify(interna));
  const mestre = await tenta(base, [{ nome: 'gmPegaItem', args: { itemId: base.itens[0] } }]);
  check('op da Caixa do Mestre numa conta comum cai (gm)', !mestre.ok && mestre.motivo === 'gm', JSON.stringify(mestre));
  const tudoOuNada = await tenta(base, [{ nome: 'depositarMoedas', args: { n: 10 } },
                                        { nome: 'inventaVintens', args: { n: 1e9 } }]);
  check('op desconhecida derruba o pedido inteiro com o índice dela',
        !tudoOuNada.ok && tudoOuNada.motivo === 'desconhecida' && tudoOuNada.indice === 1, JSON.stringify(tudoOuNada));
  const torto = await tenta(base, [{ nome: 'forjarPeca', args: { invIndex: 'zero' } }]);
  check('argumento torto derruba com motivo argumento', !torto.ok && torto.motivo === 'argumento' && torto.indice === 0,
        JSON.stringify(torto));

  // ---- o título só entra se a régua der
  const t1 = await tenta(base, [{ nome: 'definirTitulo', args: { titulo: 'Top 1 PVM' } }]);
  check('título de pódio sem a posição não entra', t1.ok && t1.resultados[0].ok === false && !t1.db.jogador.titulo,
        JSON.stringify(t1.resultados || t1));
  const t2 = await tenta(base, [{ nome: 'definirTitulo', args: { titulo: 'Top 1 PVM' } }],
                         { contexto: { agoraMs: AGORA, pvm: 1 } });
  check('com a posição 1 vinda do ranking do servidor, entra', t2.ok && t2.db.jogador.titulo === 'Top 1 PVM',
        JSON.stringify(t2.ok ? t2.db.jogador.titulo : t2));

  console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('a prova estourou:', e && e.stack); process.exit(1); });
