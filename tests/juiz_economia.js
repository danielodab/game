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
 *   - a quebra (22/09) vira pedra pela régua do dado, a série sai em iids.fora
 *     e a cópia emprestada da guilda não se quebra;
 *   - a troca tira de um estado e põe no outro sem duplicar nem sumir;
 *   - o lote de pedras do mercadinho (22/09): mercadoTiraPedras e
 *     mercadoPoePedras só com contexto.interno, na régua dos lotes, e o lote
 *     local que a migração encontra volta ao estoque em vez de sumir;
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

/* uma conta com Bárbaro nível 22, pedras, selos e vinténs, e peças no saco com série.
 * `prepara(J, P)` (opcional) mexe no saco antes da foto — a quebra quer cópias iguais */
function conta(prepara) {
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
  if (prepara) prepara(J, P);
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

  // ---- a QUEBRA (22/09): cópias iguais viram pedras do elemento, sem sorteio.
  // A conta esperada é refeita AQUI com a régua do dado (não com o quebraInfo),
  // para a prova não aprovar o próprio erro.
  const qBase = conta((J, P) => { P.addItem(base.itens[1], 'saque'); P.addItem(base.itens[1], 'saque'); });
  const qId = base.itens[1];
  const qIdx = qBase.progress.inventory.findIndex((e) => e.itemId === qId);
  const qIid = qIdx >= 0 ? qBase.progress.inventory[qIdx].iid : null;
  const qCopias = qBase.progress.inventory.filter((e) => e.itemId === qId).length;
  const wq = est.mundoEconomico({ agoraMs: AGORA, semente: 5 });
  est.poeEstado(wq, qBase.progress, qBase.db);
  const dq = wq.J.DATA.items[qId], Qd = wq.J.DATA.quebra;
  const qT = Math.max(1, Math.ceil(wq.J.DATA.nivelUsoDe(dq) / Qd.degrauNivel));
  const qSid = Object.keys(wq.J.DATA.stones).find((s) => wq.J.DATA.stones[s].element === (dq.element || 'neutro'));
  const qPedras = Math.max(Qd.minimo, Qd.base[dq.rarity] * qT);                 // +0 e sem estrela
  check('a conta da quebra tem 3 cópias iguais com série', qCopias === 3 && !!qIid && !!qSid,
        JSON.stringify({ qId, qCopias, qIid, qSid }));

  const q1 = await tenta(qBase, [{ nome: 'quebrarPeca', args: { invIndex: qIdx } }]);
  const cq1 = await clienteFaz(qBase, (J) => { J.Progress.quebraPeca(qIdx); });
  check('quebrar no servidor dá o mesmo hash que quebrar na tela',
        q1.ok && q1.hash === cq1.hash && q1.hash !== qBase.hash,
        JSON.stringify({ srv: q1.hash || q1, cli: cq1.hash, base: qBase.hash }));
  check('... a série quebrada sai em iids.fora e nada nasce',
        q1.ok && q1.iids.fora.length === 1 && q1.iids.fora[0] === qIid && q1.iids.novos.length === 0 &&
        q1.resultados[0] && q1.resultados[0].iids[0] === qIid, JSON.stringify(q1.ok ? { iids: q1.iids, r: q1.resultados[0] } : q1));
  check('... e as pedras do elemento sobem pela régua (' + qPedras + ' de ' + qSid + ')',
        q1.ok && q1.progress.stones[qSid] === 200 + qPedras && q1.resultados[0].pedras === qPedras &&
        q1.resultados[0].stoneId === qSid, JSON.stringify(q1.ok ? { st: q1.progress.stones, r: q1.resultados[0] } : q1));

  const q2 = await tenta(qBase, [{ nome: 'quebrarPeca', args: { invIndex: qIdx, n: 2 } }]);
  const cq2 = await clienteFaz(qBase, (J) => { J.Progress.quebraPeca(qIdx, 2); });
  check('quebrar 2 de uma vez: duas séries saem, 2× as pedras, mesmo hash da tela',
        q2.ok && q2.hash === cq2.hash && q2.iids.fora.length === 2 && q2.iids.fora.indexOf(qIid) >= 0 &&
        q2.progress.stones[qSid] === 200 + 2 * qPedras &&
        q2.progress.inventory.filter((e) => e.itemId === qId).length === 1,
        JSON.stringify(q2.ok ? { fora: q2.iids.fora, st: q2.progress.stones[qSid] } : q2));

  const q3 = await tenta(qBase, [{ nome: 'quebrarPeca', args: { invIndex: qIdx, n: 4 } }]);
  check('pedir mais cópias do que tem: a regra recusa (false) e o hash não muda',
        q3.ok && q3.resultados[0] === false && q3.hash === qBase.hash && q3.iids.fora.length === 0,
        JSON.stringify(q3.ok ? { r: q3.resultados, h: q3.hash === qBase.hash } : q3));
  const q4 = await tenta(qBase, [{ nome: 'quebrarPeca', args: { invIndex: 9999 } }]);
  check('índice sem peça: false e o hash não muda', q4.ok && q4.resultados[0] === false && q4.hash === qBase.hash,
        JSON.stringify(q4.resultados || q4));
  const q5 = await tenta(qBase, [{ nome: 'quebrarPeca', args: { invIndex: -1 } }]);
  const q5b = await tenta(qBase, [{ nome: 'quebrarPeca', args: { invIndex: qIdx, n: 100 } }]);
  const q5c = await tenta(qBase, [{ nome: 'quebrarPeca', args: { invIndex: qIdx, n: 1.5 } }]);
  check('invIndex torto ou n fora de 1..99 derruba com motivo argumento',
        !q5.ok && q5.motivo === 'argumento' && !q5b.ok && q5b.motivo === 'argumento' &&
        !q5c.ok && q5c.motivo === 'argumento', JSON.stringify([q5, q5b, q5c]));
  // a cópia emprestada do banco da guilda: cópias iguais são intercambiáveis, então o
  // golpe quebra uma cópia LIVRE no lugar dela; só recusa quando as livres não bastam
  const q6 = await tenta(qBase, [{ nome: 'quebrarPeca', args: { invIndex: qIdx } }],
                         { contexto: { agoraMs: AGORA, bloqueados: [qIid] } });
  check('a emprestada na bancada: quebra uma cópia livre igual e a emprestada fica no saco',
        q6.ok && q6.resultados[0] && q6.iids.fora.length === 1 && q6.iids.fora[0] !== qIid &&
        q6.progress.inventory.some((e) => e.iid === qIid), JSON.stringify(q6.ok ? { fora: q6.iids.fora } : q6));
  const q6b = await tenta(qBase, [{ nome: 'quebrarPeca', args: { invIndex: qIdx, n: 3 } }],
                          { contexto: { agoraMs: AGORA, bloqueados: [qIid] } });
  check('pedir todas com uma emprestada no meio: recusa emprestada e nada sai',
        !q6b.ok && q6b.motivo === 'emprestada', JSON.stringify(q6b));
  const q6c = await tenta(qBase, [{ nome: 'quebrarPeca', args: { invIndex: qIdx, n: 2 } }],
                          { contexto: { agoraMs: AGORA, bloqueados: [qIid] } });
  check('pedir 2 com 2 livres e 1 emprestada: quebra as duas livres',
        q6c.ok && q6c.iids.fora.length === 2 && q6c.iids.fora.indexOf(qIid) < 0,
        JSON.stringify(q6c.ok ? { fora: q6c.iids.fora } : q6c));

  // a TRAVA DA SÉRIE: o índice aponta outra peça depois de uma adoção — a op recusa
  const outraIdx = qBase.progress.inventory.findIndex((e) => e.itemId !== qId);
  const q7 = await tenta(qBase, [{ nome: 'quebrarPeca', args: { invIndex: outraIdx, iid: qIid } }]);
  check('série diferente da do índice: a regra recusa (false) e o hash não muda',
        outraIdx >= 0 && q7.ok && q7.resultados[0] === false && q7.hash === qBase.hash && q7.iids.fora.length === 0,
        JSON.stringify(q7.ok ? { r: q7.resultados, h: q7.hash === qBase.hash } : q7));
  const q7b = await tenta(qBase, [{ nome: 'quebrarPeca', args: { invIndex: qIdx, iid: qIid } }]);
  const cq7b = await clienteFaz(qBase, (J) => { J.Progress.quebraPeca(qIdx, 1, { iid: qIid }); });
  check('série certa: quebra a mesma peça, com o mesmo hash da tela',
        q7b.ok && q7b.iids.fora[0] === qIid && q7b.hash === cq7b.hash, JSON.stringify(q7b.ok ? q7b.iids : q7b));
  const q7c = await tenta(qBase, [{ nome: 'quebrarPeca', args: { invIndex: qIdx, iid: 7 } }]);
  check('série que não é texto derruba com motivo argumento', !q7c.ok && q7c.motivo === 'argumento', JSON.stringify(q7c));

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

  // ---- o título do pódio de classe (13/09): só com a posição que a API mandou
  const t3 = await tenta(base, [{ nome: 'definirTitulo', args: { titulo: 'Top 1 Xamã' } }]);
  check('título de pódio de classe sem a posição não entra', t3.ok && t3.resultados[0].ok === false,
        JSON.stringify(t3.resultados || t3));
  const t4 = await tenta(base, [{ nome: 'definirTitulo', args: { titulo: 'Top 1 Xamã' } }],
                         { contexto: { agoraMs: AGORA, porClasse: { invocador: 1 } } });
  check('com o 1º lugar de Xamã vindo do servidor, "Top 1 Xamã" entra', t4.ok && t4.db.jogador.titulo === 'Top 1 Xamã',
        JSON.stringify(t4.ok ? t4.db.jogador.titulo : t4));

  // ---- o LOTE de pedras no mercadinho (22/09): as internas tiram e põem pedra, só com contexto.interno
  const INTERNO = { contexto: { agoraMs: AGORA, interno: true } };
  const lp1 = await tenta(base, [{ nome: 'mercadoTiraPedras', args: { stoneId: 'stone-ember', qtd: 10 } }]);
  const lp2 = await tenta(base, [{ nome: 'mercadoPoePedras', args: { stoneId: 'stone-ember', qtd: 10 } }]);
  check('mercadoTiraPedras e mercadoPoePedras pedidas por um cliente caem (interna)',
        !lp1.ok && lp1.motivo === 'interna' && !lp2.ok && lp2.motivo === 'interna', JSON.stringify([lp1, lp2]));
  const lp3 = await tenta(base, [{ nome: 'mercadoTiraPedras', args: { stoneId: 'stone-ember', qtd: 50 } }], INTERNO);
  check('mercadoTiraPedras tira o lote do estoque (200 → 150) e devolve {stoneId, qtd}',
        lp3.ok && lp3.progress.stones['stone-ember'] === 150 && lp3.resultados[0].stoneId === 'stone-ember' &&
        lp3.resultados[0].qtd === 50 && lp3.hash !== base.hash && lp3.iids.fora.length === 0,
        JSON.stringify(lp3.ok ? { st: lp3.progress.stones, r: lp3.resultados } : lp3));
  const lp4 = await tenta(base, [{ nome: 'mercadoTiraPedras', args: { stoneId: 'stone-ember', qtd: 100 } },
                                 { nome: 'mercadoTiraPedras', args: { stoneId: 'stone-ember', qtd: 100 } },
                                 { nome: 'mercadoTiraPedras', args: { stoneId: 'stone-ember', qtd: 1 } }], INTERNO);
  check('estoque curto derruba com falta, no índice da op que não coube (tudo ou nada)',
        !lp4.ok && lp4.motivo === 'falta' && lp4.indice === 2, JSON.stringify(lp4));
  const lp5 = await tenta(base, [{ nome: 'mercadoTiraPedras', args: { stoneId: 'stone-ember', qtd: 7 } }], INTERNO);
  const lp6 = await tenta(base, [{ nome: 'mercadoTiraPedras', args: { stoneId: 'pedra-de-mentira', qtd: 1 } }], INTERNO);
  const lp7 = await tenta(base, [{ nome: 'mercadoPoePedras', args: { stoneId: 'stone-ember', qtd: '10' } }], INTERNO);
  const lp8 = await tenta(base, [{ nome: 'mercadoPoePedras', args: { stoneId: 'stone-ember', qtd: 1000 } }], INTERNO);
  check('lote fora da régua (7, "10", 1000) ou pedra que o dado não conhece: argumento',
        [lp5, lp6, lp7, lp8].every((r) => !r.ok && r.motivo === 'argumento'), JSON.stringify([lp5, lp6, lp7, lp8]));
  const lp9 = await tenta(base, [{ nome: 'mercadoPoePedras', args: { stoneId: 'stone-anchor', qtd: 10 } },
                                 { nome: 'mercadoPoePedras', args: { stoneId: 'stone-tear', qtd: 1 } }], INTERNO);
  check('mercadoPoePedras põe no estoque (a âncora também) e devolve {ok, stoneId, qtd}',
        lp9.ok && lp9.progress.stones['stone-anchor'] === 210 && lp9.progress.stones['stone-tear'] === 201 &&
        lp9.resultados[0].ok === true && lp9.resultados[0].qtd === 10 && lp9.resultados[1].stoneId === 'stone-tear',
        JSON.stringify(lp9.ok ? { st: lp9.progress.stones, r: lp9.resultados } : lp9));
  // tira e põe de volta no mesmo pedido: o estado volta a ser o mesmo (o hash também)
  const lp10 = await tenta(base, [{ nome: 'mercadoTiraPedras', args: { stoneId: 'stone-root', qtd: 100 } },
                                  { nome: 'mercadoPoePedras', args: { stoneId: 'stone-root', qtd: 100 } }], INTERNO);
  check('tirar e pôr o mesmo lote: o hash volta ao de antes', lp10.ok && lp10.hash === base.hash,
        JSON.stringify(lp10.ok ? lp10.hash : lp10));

  // ---- a migração com um LOTE local: as pedras voltam ao estoque e o lote não vira anúncio
  const dbLegado = JSON.parse(JSON.stringify(base.db));
  dbLegado.mercado = { dia: '2026-09-21', ofertas: [
    { id: 'jg-a', vendedor: 'jogador', tipo: 'pedra', stoneId: 'stone-ember', qtd: 50, preco: 240 },
    { id: 'jg-b', vendedor: 'jogador', itemId: base.itens[0], level: 1, stars: 0, iid: null, preco: 90 },
    { id: 'jg-c', vendedor: 'jogador', tipo: 'pedra', stoneId: 'stone-ember', qtd: 7, preco: 9 },
    { id: 'mf-1', vendedor: 'mercador', itemId: base.itens[0], level: 0, stars: 0, preco: 9 }
  ] };
  const leg = await tenta({ progress: base.progress, db: dbLegado }, [{ nome: 'mercadoLegadoTira', args: {} }], INTERNO);
  check('mercadoLegadoTira: o lote de pedras volta ao estoque (+50) e só a peça vira oferta',
        leg.ok && leg.progress.stones['stone-ember'] === 250 && leg.resultados[0].ofertas.length === 1 &&
        leg.resultados[0].ofertas[0].itemId === base.itens[0] &&
        JSON.stringify(leg.resultados[0].pedras) === JSON.stringify([{ stoneId: 'stone-ember', qtd: 50 }]) &&
        leg.db.mercado.ofertas.length === 0,
        JSON.stringify(leg.ok ? { st: leg.progress.stones['stone-ember'], r: leg.resultados[0], mc: leg.db.mercado } : leg));
  const legCli = await tenta({ progress: base.progress, db: dbLegado }, [{ nome: 'mercadoLegadoTira', args: {} }]);
  check('... e a migração pedida por um cliente cai (interna)', !legCli.ok && legCli.motivo === 'interna', JSON.stringify(legCli));

  console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('a prova estourou:', e && e.stack); process.exit(1); });
