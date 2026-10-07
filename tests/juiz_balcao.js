#!/usr/bin/env node
'use strict';
/* PROVA DO BALCÃO DE VINTÉNS (07/10, js/core/mercado.js M.BALCAO; as ops comprarReescrita e
 * comprarPedrasDoDia em servidor/juiz/economia.js).
 *
 *   node tests/juiz_balcao.js
 *
 * Cobra, no mundo econômico do juiz e no da "tela" (o mesmo código, o mesmo hash):
 *   · a vitrine (M.balcao): a Reescrita livre numa conta nova, as pedras do dia com o elemento do
 *     CHEFE do Calabouço do Dia e um lote por dia;
 *   · a Reescrita: debita 8.000 do saco (o banco não conta), guarda o pergaminho, trava por 30 dias
 *     (no relógio do SERVIDOR), e a segunda compra dentro da janela é recusada sem cobrar; depois de 30
 *     dias vende de novo; sem vintém, recusa sem mudar nada;
 *   · as pedras do dia: debita 1.500, soma 10 pedras do elemento do dia, trava o dia; no dia seguinte
 *     vende de novo (outro elemento, se o portal mudou); sem vintém, recusa;
 *   · o hash do servidor é o da tela, e as travas sobrevivem ao sanitize do load (o save recarregado
 *     não vende de novo);
 *   · a op não aceita relógio do cliente: o argumento é vazio e o instante é o do mundo. */
const path = require('path');
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
const { executa } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'economia.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
const DIA = Date.UTC(2026, 9, 7, 15, 0, 0);          // 07/10/2026, 12:00 de Brasília
const DIA_SEG = 86400000;

function conta(saco, agoraMs, prepara) {
  const w = est.mundoEconomico({ agoraMs: agoraMs || DIA, semente: 3 });
  est.poeEstado(w, null, null);
  if (prepara) prepara(w.J);
  w.J.Progress.save();
  return w.J.DB.ganharMoedas(saco).then(() => est.tiraEstado(w));
}
function pede(base, ops, agoraMs) {
  return executa({ conta: { id: 1, gm: false }, progress: base.progress, db: base.db, ops, semente: 777,
                   contexto: { agoraMs: agoraMs || DIA } });
}
async function tenta(base, ops, agoraMs) {
  try { return await pede(base, ops, agoraMs); } catch (e) { return { erro: e.message, motivo: e.motivo, indice: e.indice }; }
}
async function naTela(base, agoraMs, fn) {
  const w = est.mundoEconomico({ agoraMs: agoraMs || DIA, semente: 99 });
  est.poeEstado(w, base.progress, base.db);
  const r = await fn(w.J);
  return { r, estado: est.tiraEstado(w), J: w.J };
}

(async () => {
  const base = await conta(10000);
  const { J } = await naTela(base, DIA, async () => null);
  const M = J.Mercado;
  check('o balcão existe com a Reescrita (8.000, 30 dias) e as pedras do dia (1.500, 10)',
        M.BALCAO.reescrita.preco === 8000 && M.BALCAO.reescrita.diasEntre === 30 &&
        M.BALCAO.pedrasDia.preco === 1500 && M.BALCAO.pedrasDia.qtd === 10);
  const v = M.balcao(DIA);
  const dia = J.Diario.hoje(DIA);
  const chefe = Object.keys(J.DATA.monsters).find((id) => J.DATA.monsters[id].boss && J.DATA.monsters[id].dungeonId === dia.dungeonId);
  const elChefe = J.DATA.monsters[chefe].element;
  check('a vitrine: Reescrita livre numa conta nova', v.reescrita.pode === true && v.reescrita.liberaEm === 0);
  check('a vitrine: as pedras do dia são do elemento do chefe do Calabouço do Dia (' + dia.dungeonId + ' → ' + elChefe + ')',
        v.pedrasDia.dungeonId === dia.dungeonId && v.pedrasDia.elemento === elChefe &&
        J.DATA.stones[v.pedrasDia.stoneId].element === elChefe && v.pedrasDia.pode === true, JSON.stringify(v.pedrasDia));

  // ---- a Reescrita
  const r1 = await tenta(base, [{ nome: 'comprarReescrita', args: {} }]);
  const t1 = await naTela(base, DIA, (Jt) => Jt.Mercado.comprarReescrita());
  check('comprarReescrita debita 8.000 do saco e guarda o pergaminho',
        r1.ok && r1.resultados[0].ok && r1.db.carteira.moedas === 2000 && r1.progress.pergaminhos && r1.progress.pergaminhos.elemento === 1,
        JSON.stringify(r1.erro || r1.resultados));
  check('... trava por 30 dias no relógio do servidor', r1.ok && r1.progress.balcao && r1.progress.balcao.reescritaEm === Math.floor(DIA / 1000) &&
        r1.resultados[0].liberaEm === Math.floor(DIA / 1000) + 30 * 86400, JSON.stringify(r1.progress && r1.progress.balcao));
  check('... com o mesmo hash que a compra na tela', t1.r.ok && r1.hash === t1.estado.hash && r1.hash !== base.hash);
  const depois1 = { progress: r1.progress, db: r1.db };
  const r2 = await tenta(depois1, [{ nome: 'comprarReescrita', args: {} }], DIA + 29 * DIA_SEG);
  check('a segunda Reescrita em 29 dias é recusada sem cobrar', r2.ok && r2.resultados[0].ok === false && r2.resultados[0].espera === true &&
        r2.db.carteira.moedas === 2000 && r2.hash === r2.hashAntes, JSON.stringify(r2.resultados || r2));
  const rica = { progress: r1.progress, db: JSON.parse(JSON.stringify(r1.db)) };
  rica.db.carteira.moedas = 9000;
  const r3 = await tenta(rica, [{ nome: 'comprarReescrita', args: {} }], DIA + 30 * DIA_SEG);
  check('aos 30 dias vende de novo (e a trava anda)', r3.ok && r3.resultados[0].ok && r3.progress.pergaminhos.elemento === 2 &&
        r3.progress.balcao.reescritaEm === Math.floor((DIA + 30 * DIA_SEG) / 1000), JSON.stringify(r3.erro || r3.resultados));
  const pobre = await conta(7999);
  const r4 = await tenta(pobre, [{ nome: 'comprarReescrita', args: {} }]);
  check('sem 8.000 no saco a Reescrita é recusada e nada muda', r4.ok && r4.resultados[0].ok === false && r4.resultados[0].semVintem === true &&
        r4.hash === r4.hashAntes, JSON.stringify(r4.resultados || r4));
  const noBanco = await conta(0, DIA, null);
  const wb = est.mundoEconomico({ agoraMs: DIA, semente: 3 });
  est.poeEstado(wb, noBanco.progress, noBanco.db);
  await wb.J.DB.ganharMoedas(8000); await wb.J.DB.depositarMoedas(8000);
  const sóBanco = est.tiraEstado(wb);
  const r5 = await tenta(sóBanco, [{ nome: 'comprarReescrita', args: {} }]);
  check('o banco não conta: 8.000 no cofre e 0 no saco não compram', r5.ok && r5.resultados[0].ok === false && r5.hash === r5.hashAntes);

  // ---- as pedras do dia
  const p1 = await tenta(base, [{ nome: 'comprarPedrasDoDia', args: {} }]);
  const tp = await naTela(base, DIA, (Jt) => Jt.Mercado.comprarPedrasDoDia());
  const sid = v.pedrasDia.stoneId;
  check('comprarPedrasDoDia debita 1.500 e soma 10 pedras do elemento do dia', p1.ok && p1.resultados[0].ok && p1.db.carteira.moedas === 8500 &&
        p1.progress.stones[sid] === 10 && p1.resultados[0].stoneId === sid, JSON.stringify(p1.erro || p1.resultados));
  check('... trava o dia (AAAAMMDD de Brasília) e bate com a tela', p1.progress.balcao.pedrasDia === 20261007 && tp.r.ok && p1.hash === tp.estado.hash);
  const p2 = await tenta({ progress: p1.progress, db: p1.db }, [{ nome: 'comprarPedrasDoDia', args: {} }], DIA + 3 * 3600 * 1000);
  check('o segundo lote no mesmo dia é recusado sem cobrar', p2.ok && p2.resultados[0].ok === false && p2.resultados[0].espera === true &&
        p2.hash === p2.hashAntes, JSON.stringify(p2.resultados || p2));
  const amanha = DIA + DIA_SEG;
  const p3 = await tenta({ progress: p1.progress, db: p1.db }, [{ nome: 'comprarPedrasDoDia', args: {} }], amanha);
  const vA = M.balcao(amanha);
  check('no dia seguinte vende de novo, com o elemento do portal de amanhã (' + vA.pedrasDia.elemento + ')',
        p3.ok && p3.resultados[0].ok && p3.resultados[0].stoneId === vA.pedrasDia.stoneId && p3.progress.balcao.pedrasDia === 20261008,
        JSON.stringify(p3.erro || p3.resultados));
  const p4 = await tenta(await conta(1499), [{ nome: 'comprarPedrasDoDia', args: {} }]);
  check('sem 1.500 no saco o lote é recusado', p4.ok && p4.resultados[0].ok === false && p4.resultados[0].semVintem === true);

  // ---- a trava sobrevive ao load (o sanitize conhece `balcao`) e um campo torto não entra
  const recarregado = await naTela({ progress: p1.progress, db: p1.db }, DIA, async (Jt) => Jt.Progress.balcao());
  check('o save recarregado mantém a trava do dia', recarregado.r.pedrasDia === 20261007);
  const torto = JSON.parse(JSON.stringify(p1.progress));
  torto.balcao = { pedrasDia: 'ontem', reescritaEm: -5, lua: 1 };
  const lido = await naTela({ progress: torto, db: p1.db }, DIA, async (Jt) => Jt.Progress.state.balcao);
  check('um balcao torto no save é descartado inteiro (nada entra)', lido.r === undefined, JSON.stringify(lido.r));
  // o argumento do cliente não leva relógio: um `agora` mandado é ignorado (a op não lê args)
  const p5 = await tenta({ progress: p1.progress, db: p1.db }, [{ nome: 'comprarPedrasDoDia', args: { agoraMs: amanha, dia: 20261009 } }], DIA);
  check('o relógio do cliente não entra: no mesmo dia do servidor continua recusado', p5.ok && p5.resultados[0].ok === false);

  console.log('\n' + (total - falhas) + ' de ' + total + ' passaram' + (falhas ? ' — ' + falhas + ' FALHARAM' : ''));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
