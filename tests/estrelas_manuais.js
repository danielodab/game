#!/usr/bin/env node
'use strict';
/* PROVA DAS ESTRELAS MANUAIS E DAS INICIAIS LIVRES (08/10).
 *
 *   node tests/estrelas_manuais.js
 *
 * O dono: "os dois primeiros heróis livres, qualquer classe" e "quando dropar o suficiente o jogador
 * pode ir até o personagem e subir a estrela dele". Com o mundo do juiz (servidor/juiz/estado.js):
 *   - a conta NOVA pode escolher duas classes (Progress.escolheIniciais): as escolhidas entram liberadas
 *     e com custo 0, as comuns do dado que não foram escolhidas saem; a conta que já jogou não escolhe;
 *   - a carta é moeda: liberar pela carta gasta o custo; a estrela se compra à mão (subirEstrela) por
 *     5/10/20/30/45 e grava `estrelas`; sem cartas o bastante, recusa sem mexer;
 *   - os bônus de estrela entram nos stats na hora (★1 = +15 PV);
 *   - o save de ANTES (cartas acumuladas, estrelas derivadas) migra: as estrelas que a sobra dava
 *     viram `estrelas`, e o que faltava gastar fica na mão;
 *   - as ops do juiz `subirEstrela` e `escolherIniciais`;
 *   - a loja aceita as comuns como produto de classe (quem não as escolheu as compra). */
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
function mundo(semente, progress) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: semente || 3 });
  est.poeEstado(w, progress || null, null);
  return w;
}
function pede(base, ops, extra) {
  return executa(Object.assign({ conta: { id: 1, gm: false }, progress: base.progress, db: base.db,
                                 ops, semente: 777, contexto: { agoraMs: AGORA } }, extra || {}));
}
async function tenta(base, ops, extra) {
  try { return await pede(base, ops, extra); } catch (e) { return { erro: e.message, motivo: e.motivo, indice: e.indice }; }
}

(async () => {
  // ---------------------------------------------------------------- a conta nova escolhe
  let w = mundo(), P = w.J.Progress;
  check('a conta nova nasce com as duas do dado e PODE escolher', P.isClassUnlocked('sumo') && P.isClassUnlocked('curandeiro') &&
        P.podeEscolherIniciais() === true);
  check('escolher a mesma duas vezes, o Mestre ou uma só: recusa', P.escolheIniciais(['bruxo', 'bruxo']) === false &&
        P.escolheIniciais(['gm', 'bruxo']) === false && P.escolheIniciais(['bruxo']) === false && P.podeEscolherIniciais());
  check('escolher Ladino e Minotauro: os dois liberados no nível 1, custo 0, e as comuns saem', (() => {
    const ok = P.escolheIniciais(['espadachim', 'minotauro']);
    const i1 = P.cardInfo('espadachim'), i2 = P.cardInfo('minotauro');
    return ok && i1.unlocked && i2.unlocked && i1.unlockCost === 0 && i2.unlockCost === 0 &&
           P.state.heroes.espadachim.level === 1 && !P.isClassUnlocked('sumo') && !P.isClassUnlocked('curandeiro') &&
           !P.state.heroes.sumo && P.state.escolhidas.join() === 'espadachim,minotauro';
  })());
  check('depois de escolher não se escolhe de novo, e o Bárbaro passa a custar 5 cartas',
        P.podeEscolherIniciais() === false && P.escolheIniciais(['sumo', 'bruxo']) === false && P.cardInfo('sumo').unlockCost === 5);
  check('a escolha sobrevive ao save + load (sanitize)', (() => {
    const cru = JSON.parse(JSON.stringify(P.state));
    const w2 = mundo(4, cru), P2 = w2.J.Progress;
    return P2.state.escolhidas.join() === 'espadachim,minotauro' && P2.isClassUnlocked('minotauro') && !P2.isClassUnlocked('sumo') &&
           P2.cardInfo('minotauro').unlockCost === 0;
  })());
  check('a conta que JÁ JOGOU (XP) não escolhe mais', (() => {
    const w3 = mundo(5), P3 = w3.J.Progress;
    P3.addXp('sumo', 50);
    return P3.podeEscolherIniciais() === false && P3.escolheIniciais(['bruxo', 'arqueiro']) === false;
  })());

  // ---------------------------------------------------------------- a carta é moeda; a estrela à mão
  w = mundo(6); P = w.J.Progress;
  check('5 cartas do Bárbaro (inicial, custo 0) ficam na mão e NÃO viram estrela sozinhas', (() => {
    const i = P.addCards('sumo', 5);
    return i.cards === 5 && i.stars === 0 && i.podeSubir === true && i.next.star === 1 && i.next.custo === 5;
  })(), JSON.stringify(P.cardInfo('sumo')));
  const hpAntes = P.effectiveStats('sumo').hp;
  check('subir a ★1 gasta as 5 e dá +15 PV na hora', (() => {
    const r = P.subirEstrela('sumo');
    return r && r.stars === 1 && r.cards === 0 && P.effectiveStats('sumo').hp === hpAntes + 15 && P.state.estrelas.sumo === 1;
  })(), JSON.stringify({ info: P.cardInfo('sumo'), hp: [hpAntes, P.effectiveStats('sumo').hp] }));
  check('sem cartas a ★2 recusa (false) sem mexer', P.subirEstrela('sumo') === false && P.cardInfo('sumo').stars === 1);
  check('a escada: ★2 custa 10, ★3 20, ★4 30, ★5 45 — e no topo para', (() => {
    const custos = [];
    for (let k = 2; k <= 5; k++) {
      const c = P.cardInfo('sumo').next.custo; custos.push(c);
      P.addCards('sumo', c);
      if (!P.subirEstrela('sumo')) return false;
    }
    return custos.join() === '10,20,30,45' && P.cardInfo('sumo').stars === 5 && P.cardInfo('sumo').next === null &&
           P.subirEstrela('sumo') === false;
  })(), JSON.stringify(P.cardInfo('sumo')));
  check('a classe trancada libera pela carta GASTANDO o custo (Xamã: 10 → 12 cartas deixam 2 na mão)', (() => {
    const i = P.addCards('invocador', 12);
    return i.unlocked && i.cards === 2 && i.stars === 0 && !!P.state.heroes.invocador;
  })(), JSON.stringify(P.cardInfo('invocador')));
  check('a classe trancada NÃO compra estrela antes de liberar', (() => {
    P.addCards('bruxo', 6);                                   // custa 10: segue trancada
    return !P.isClassUnlocked('bruxo') && P.cardInfo('bruxo').podeSubir === false && P.subirEstrela('bruxo') === false;
  })());

  // ---------------------------------------------------------------- a migração do save de antes
  check('o save de ANTES migra: cartas acumuladas viram estrelas + a sobra na mão', (() => {
    const w4 = mundo(7), P4 = w4.J.Progress;
    const cru = JSON.parse(JSON.stringify(P4.state));
    delete cru.estrelas;                                       // o campo não existia
    cru.cards = { sumo: 38, invocador: 10 + 7, bruxo: 4 };     // sumo: ★3 (35) e sobram 3; Xamã liberada com 7 de sobra (★1, sobram 2); Bruxo trancado
    cru.unlockedClasses = ['sumo', 'curandeiro', 'invocador'];
    cru.heroes.invocador = JSON.parse(JSON.stringify(cru.heroes.sumo)); cru.heroes.invocador.classId = 'invocador';
    const w5 = mundo(8, cru), P5 = w5.J.Progress;
    const a = P5.cardInfo('sumo'), b = P5.cardInfo('invocador'), c = P5.cardInfo('bruxo');
    return a.stars === 3 && a.cards === 3 && b.unlocked && b.stars === 1 && b.cards === 2 && !c.unlocked && c.cards === 4 && c.stars === 0;
  })());
  check('o save de antes SEM cartas não muda ao recarregar (nada a migrar: nem `escolhidas` entra)', (() => {
    const w6 = mundo(9), P6 = w6.J.Progress;
    P6.addXp('sumo', 30);
    const s1 = est.tiraEstado(w6);
    // (o primeiro load de um save novo acrescenta campos vazios de sempre, como `selos`; a prova compara
    //  o segundo load com o terceiro — o que a migração desta frente NÃO pode mudar)
    const s2 = est.tiraEstado(mundo(10, s1.progress));
    const s3 = est.tiraEstado(mundo(11, s2.progress));
    return JSON.stringify(s3.progress) === JSON.stringify(s2.progress) && s2.progress.escolhidas === undefined &&
           s2.progress.estrelas && Object.keys(s2.progress.estrelas).length === 0;
  })());

  // ---------------------------------------------------------------- o juiz
  const w8 = mundo(11); est.poeEstado(w8, null, null);
  const P8 = w8.J.Progress;
  P8.addCards('sumo', 5); P8.save();
  const s8 = est.tiraEstado(w8);
  const base = { progress: s8.progress, db: s8.db, hash: s8.hash };
  const r1 = await tenta(base, [{ nome: 'subirEstrela', args: { classId: 'sumo' } }, { nome: 'subirEstrela', args: { classId: 'sumo' } }]);
  check('juiz: subirEstrela compra a ★1 e a segunda recusa (false)', r1.ok && r1.resultados[0] && r1.resultados[0].stars === 1 &&
        r1.resultados[1] === false && r1.progress.estrelas.sumo === 1 && !r1.progress.cards.sumo, JSON.stringify(r1.resultados || r1));
  const w9 = mundo(12); est.poeEstado(w9, null, null);
  const s9 = est.tiraEstado(w9);
  const base2 = { progress: s9.progress, db: s9.db, hash: s9.hash };
  const r2 = await tenta(base2, [{ nome: 'escolherIniciais', args: { ids: ['arqueiro', 'bruxo'] } }]);
  check('juiz: escolherIniciais libera as duas e tira as comuns', r2.ok && r2.resultados[0] === true &&
        r2.progress.unlockedClasses.join() === 'arqueiro,bruxo' && !!r2.progress.heroes.arqueiro && !r2.progress.heroes.sumo,
        JSON.stringify(r2.ok ? r2.progress.unlockedClasses : r2));
  const r3 = await tenta(base2, [{ nome: 'escolherIniciais', args: { ids: ['a', 'b', 'c'] } }]);
  check('juiz: três ids derrubam o pedido (argumento)', !r3.ok && r3.motivo === 'argumento', JSON.stringify(r3));

  // ---------------------------------------------------------------- a loja
  check('a loja aceita o Bárbaro como produto de classe para quem não o tem', (() => {
    const w10 = mundo(13), P10 = w10.J.Progress, L = w10.J.Loja;
    if (!L || !L._confere) return true;
    P10.escolheIniciais(['bruxo', 'arqueiro']);
    return L._confere({ tipo: 'classe', alvo: 'sumo', qtd: 1 }) === null &&
           L._confere({ tipo: 'classe', alvo: 'bruxo', qtd: 1 }) === 'classe-ja-liberada' &&
           L._confere({ tipo: 'classe', alvo: 'gm', qtd: 1 }) === 'item-invalido';
  })());

  console.log('\nRESUMO: ' + (falhas ? falhas + ' falharam de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
