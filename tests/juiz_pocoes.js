#!/usr/bin/env node
'use strict';
/* PROVA DAS POÇÕES DE VIDA E DA VIDA ENTRE AS SALAS — o juiz.
 *
 *   node tests/juiz_pocoes.js
 *
 * 13/09, o dono: "no mercadinho do jogo deve ter poções à venda por vinténs" e, depois,
 * "a poção não é para usar na batalha.. e sim para curar a vida após uma batalha na sala de
 * espera entre as salas.. carrega 1 pv a cada 2 segundos". Cobra:
 *   - os dados: as três poções, o teto, a regeneração (2000 ms por PV) e o motor sem ação de beber;
 *   - o PV da porta (aplicaCarry / aplicaCarryRede): entra como está, preso no máximo, piso 1;
 *   - a sala refeita com um lance de poção cai inteira (pocao-na-batalha) — solo, grupo e duelo;
 *   - o fechamento não mexe nas poções (vitória, sala largada, grupo) e devolve o PV máximo
 *     de cada herói (vidaMax) com a chave do carry;
 *   - a op INTERNA beberPocao: tira UMA, devolve a cura, recusa sem a poção e fora da API;
 *   - a banca (op comprarPocao) e o saneamento do load.
 * A conta do servidor, a regeneração pelo relógio e as rotas de beber estão em tests/pocoes_api.py. */
const path = require('path');
const { mundo } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'motor.js'));
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
const { refaz, aplicaCarry, aplicaCarryRede, ehDeGente } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));
const { fecha, fechaGrupo } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'recompensa.js'));
const { executa } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'economia.js'));
const { joga } = require(path.join(__dirname, 'juiz_jogador.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
function pega(fn) {
  try { return { ok: true, r: fn() }; } catch (e) { return { ok: false, motivo: e.motivo, msg: e.message }; }
}
const AGORA = Date.UTC(2026, 8, 13, 15, 0, 0);
const PEQ = 'pocao-pequena', MED = 'pocao-media', GRA = 'pocao-grande';

// ================================================================ a conta de partida
function conta(nivel, pocoes, moedas) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 1 });
  est.poeEstado(w, null, null);
  const J = w.J, P = J.Progress;
  const h = P.state.heroes.sumo;
  h.level = nivel; h.xp = J.DATA.leveling.xpTable[nivel - 1];
  P.save();
  Object.keys(pocoes || {}).forEach((id) => P.poeConsumivel(id, pocoes[id]));
  if (moedas) J.DB.ganharMoedas(moedas);
  return est.tiraEstado(w);
}
function mundoParty(c) {
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 1 });
  est.poeEstado(w, c.progress, c.db);
  return w.J.Progress.battleParty(['sumo']);
}
function pedido(c, dg, ri, s, carry, jogo) {
  return {
    conta: { id: 1, gm: false },
    bilhete: { dungeonId: dg, roomIndex: ri, dificuldade: 'normal', semente: s, herois: ['sumo'], carry },
    lances: jogo.lances, hashFinal: jogo.hash, progress: c.progress, db: c.db,
    contexto: { agoraMs: AGORA, fatores: {}, guilda: {} }
  };
}

// ================================================================ os dados e o motor
(function () {
  const J = mundo().JOGO, E = J.Engine;
  const D = J.DATA.consumiveis || {};
  check('os dados carregam no juiz: três poções de vida com 30/70/150 PV e 40/110/260 vinténs, teto 20',
        D[PEQ] && D[PEQ].cura === 30 && D[PEQ].preco === 40 && D[MED].cura === 70 && D[MED].preco === 110 &&
        D[GRA].cura === 150 && D[GRA].preco === 260 && J.DATA.consumiveisRegras.teto === 20);
  check('a vida entre as salas: 1 PV a cada 2000 ms (DATA.vidaEntreSalas)',
        !!J.DATA.vidaEntreSalas && J.DATA.vidaEntreSalas.msPorPv === 2000);
  check('a poção saiu da batalha: o motor não tem ação de beber nem custo em PA',
        typeof E.usePotion === 'undefined' && typeof E.podePocao === 'undefined' && typeof E.pocaoPa === 'undefined' &&
        !('pa' in J.DATA.consumiveisRegras) && !('porTurno' in J.DATA.consumiveisRegras));
  const G = est.mundoEconomico({ agoraMs: AGORA }).J.Game;
  check('o Game não oferece poção na barra da batalha; oferece na sala de espera',
        typeof G.usaPocao === 'undefined' && typeof G.pocoesNaBarra === 'undefined' && typeof G.bebeNaEspera === 'function' &&
        typeof G.vidaNaEspera === 'function' && typeof G.esperaVida === 'function' && typeof G._vidaMax === 'function');

  // ---- o PV da porta
  const party = [{ heroId: 'sumo', classId: 'sumo', element: 'neutro', level: 30 }];
  function nova() {
    const st = E.createBattle('cistern', 0, JSON.parse(JSON.stringify(party)), { seed: 7, dificuldade: 'normal', escolhePosicao: false });
    return { st, u: st.units.find((x) => x.kind === 'hero') };
  }
  let a = nova();
  const max = a.u.hpMax;
  check('a batalha nasce de vida cheia sem carry (a primeira sala da descida)', a.u.hp === max && max > 40, max);
  aplicaCarry(a.st, { sumo: 17 });
  check('o PV da porta entra como está (17 → 17): acabou a cura de 50% do que faltava', a.u.hp === 17, a.u.hp);
  a = nova(); aplicaCarry(a.st, { sumo: max + 500 });
  check('... preso no PV máximo da sala nova', a.u.hp === max, a.u.hp);
  a = nova(); aplicaCarry(a.st, { sumo: 0 });
  check('... com piso 1 (herói a 0 não chega: o servidor não abre a sala) — acabaram os 30% de quem caiu', a.u.hp === 1, a.u.hp);
  a = nova(); aplicaCarry(a.st, { sumo: 12.9 });
  check('... e sem fração (12,9 → 12)', a.u.hp === 12, a.u.hp);
  a = nova(); aplicaCarry(a.st, { sumo: 'muito' }); aplicaCarry(a.st, null);
  check('carry torto ou ausente: a vida fica cheia', a.u.hp === max, a.u.hp);
  const gp = [Object.assign({ dono: 'ana' }, party[0]),
              { heroId: 'curandeiro', classId: 'curandeiro', element: 'neutro', level: 30, dono: 'bia' }];
  const sg = E.createBattle('cistern', 0, gp, { seed: 7, escolhePosicao: false });
  aplicaCarryRede(sg, { 'ana:sumo': 25, 'bia:curandeiro': 3, sumo: 1 });
  const ua = sg.units.find((x) => x.dono === 'ana' && x.kind === 'hero');
  const ub = sg.units.find((x) => x.dono === 'bia' && x.kind === 'hero');
  check('em grupo a chave é dono:heroId (a chave de quem desce sozinho não vale)', ua && ub && ua.hp === 25 && ub.hp === 3,
        JSON.stringify([ua && ua.hp, ub && ub.hp]));
})();

// ================================================================ a sala refeita e o fechamento (solo)
(function () {
  const c = conta(22, { [PEQ]: 5 });
  const party = mundoParty(c);
  const r1 = pega(() => refaz({ dungeonId: 'cistern', roomIndex: 0, dificuldade: 'normal', semente: 11, party,
                                lances: [{ a: 'po', u: 1, s: PEQ, ok: true }] }));
  check('o juiz recusa a sala com um lance de poção (pocao-na-batalha)', !r1.ok && r1.motivo === 'pocao-na-batalha', JSON.stringify(r1));

  const j = joga({ progress: c.progress, db: c.db, dungeonId: 'cistern', roomIndex: 0, semente: 11, dificuldade: 'normal', herois: ['sumo'] });
  check('a sala da prova é vencida pela IA (Cisterna, semente 11, nível 22)', j.fase === 'won', j.fase);
  if (j.fase !== 'won') return;
  const uid = (j.lances.find((l) => typeof l.u === 'number') || { u: 1 }).u;
  const comGole = j.lances.slice(0, 3).concat([{ a: 'po', u: uid, s: PEQ, ok: true }], j.lances.slice(3));
  const r2 = pega(() => fecha(pedido(c, 'cistern', 0, 11, null, { lances: comGole, hash: j.hash })));
  check('... e no meio da sala também: o fechamento não paga nada', !r2.ok && r2.motivo === 'pocao-na-batalha', JSON.stringify(r2));

  const r3 = pega(() => fecha(pedido(c, 'cistern', 0, 11, null, j)));
  check('a vitória é paga sem tocar nas poções da conta', r3.ok && r3.r.fase === 'won' && !!r3.r.recompensa &&
        (r3.r.progress.consumiveis || {})[PEQ] === 5, JSON.stringify(r3.ok ? r3.r.progress.consumiveis : r3));
  const vm = r3.ok ? r3.r.vidaMax : null, cy = r3.ok ? r3.r.carry : null;
  check('... e devolve o PV máximo de cada herói com a chave do carry (vidaMax)',
        !!vm && !!cy && Object.keys(vm).join() === Object.keys(cy).join() && vm.sumo > 0 && vm.sumo >= cy.sumo,
        JSON.stringify({ carry: cy, vidaMax: vm }));
  const wv = est.mundoEconomico({ agoraMs: AGORA });
  const stv = wv.J.Engine.createBattle('cistern', 0, mundoParty(c), { seed: 11, dificuldade: 'normal', escolhePosicao: true });
  check('... o mesmo máximo do herói montado do estado (Game._vidaMax lê a batalha)',
        !!vm && wv.J.Game._vidaMax(stv, false).sumo === vm.sumo, JSON.stringify([vm, wv.J.Game._vidaMax(stv, false)]));

  const r4 = pega(() => fecha(pedido(c, 'cistern', 0, 11, null, { lances: j.lances.slice(0, 1), hash: undefined })));
  check('a sala largada não paga e não muda nada (hash igual, sem carry nem vidaMax)',
        r4.ok && r4.r.fase !== 'won' && r4.r.recompensa === null && r4.r.hash === r4.r.hashAntes && r4.r.carry === null &&
        r4.r.vidaMax === null, JSON.stringify(r4.ok ? { f: r4.r.fase, c: r4.r.carry } : r4));

  // o PV da porta que o servidor pôs no bilhete é o que o juiz refaz
  if (!vm) return;
  const porta = { sumo: Math.max(1, Math.floor(vm.sumo * 0.7)) };
  const jc = joga({ progress: c.progress, db: c.db, dungeonId: 'cistern', roomIndex: 0, semente: 11, dificuldade: 'normal',
                   herois: ['sumo'], carry: porta });
  const r5 = pega(() => refaz({ dungeonId: 'cistern', roomIndex: 0, dificuldade: 'normal', semente: 11, party: mundoParty(c),
                                carry: porta, lances: jc.lances, hashFinal: jc.hash }));
  check('a sala jogada com o PV da porta (' + porta.sumo + ') se refaz igual no juiz com o mesmo carry',
        r5.ok && r5.r.hash === jc.hash && r5.r.fase === jc.fase, JSON.stringify(r5.ok ? r5.r.fase : r5));

  // ---- o duelo com um gole cai inteiro
  const dA = [{ heroId: 'sumo', classId: 'sumo', element: 'neutro', level: 20, dono: 'a' }];
  const dB = [{ heroId: 'curandeiro', classId: 'curandeiro', element: 'neutro', level: 20, dono: 'b' }];
  const r7 = pega(() => refaz({ modo: 'duelo', dungeonId: 'cistern', roomIndex: 0, semente: 9, duplaA: dA, duplaB: dB,
                                lances: [{ a: 'po', u: 1, s: PEQ, ok: false, de: 'a' }] }));
  check('no duelo o lance de poção também derruba a sala', !r7.ok && r7.motivo === 'pocao-na-batalha', JSON.stringify(r7));
})();

// ================================================================ em grupo
(function () {
  function contaDe(heroi, pocoes) {
    const w = est.mundoEconomico({ agoraMs: AGORA, semente: 5 });
    est.poeEstado(w, null, null);
    const J = w.J, h = J.Progress.state.heroes[heroi];
    h.level = 22; h.xp = J.DATA.leveling.xpTable[21];
    J.Progress.save();
    Object.keys(pocoes).forEach((id) => J.Progress.poeConsumivel(id, pocoes[id]));
    return Object.assign(est.tiraEstado(w), { heroi });
  }
  function partyDe(c, dono) {
    const w = est.mundoEconomico({ agoraMs: AGORA, semente: 5 });
    est.poeEstado(w, c.progress, c.db);
    return w.J.Progress.battleParty([c.heroi]).map((p) => Object.assign(p, { dono }));
  }
  const ana = contaDe('sumo', { [PEQ]: 2 }), bia = contaDe('curandeiro', { [MED]: 2 });
  const membros = () => [{ conta: { id: 1 }, dono: 'ana', herois: ['sumo'], progress: ana.progress, db: ana.db },
                         { conta: { id: 2 }, dono: 'bia', herois: ['curandeiro'], progress: bia.progress, db: bia.db }];
  const ata = { dungeonId: 'cistern', roomIndex: 0, dificuldade: 'normal', semente: 17, carry: null };
  const J = est.mundoEconomico({ agoraMs: AGORA, semente: 5 }).J, E = J.Engine;
  const party = partyDe(ana, 'ana').concat(partyDe(bia, 'bia'));
  const st = E.createBattle('cistern', 0, JSON.parse(JSON.stringify(party)), { seed: 17, escolhePosicao: true });
  E.events.length = 0;
  const log = [];
  const op = E.placementOptions(st)[0];
  log.push({ a: 'p', x: op.x, y: op.y, ok: !!E.place(st, op.x, op.y), de: 'ana' });
  E.events.length = 0;
  const heroiAna = st.units.find((u) => u.dono === 'ana' && u.kind === 'hero');
  let voltas = 0;
  while (st.phase === 'playing' && voltas++ < 3000) {
    const u = E.activeUnit(st);
    if (!u) break;
    if (ehDeGente(u)) {
      for (const a of (J.AI.planTurn(st, u.uid) || [])) {
        if (st.phase !== 'playing') break;
        if (a.action === 'move') log.push({ a: 'm', u: u.uid, x: a.x, y: a.y, ok: !!E.move(st, u.uid, a.x, a.y), de: u.dono });
        else if (a.action === 'cast') log.push({ a: 'c', u: u.uid, s: a.spellId, x: a.x, y: a.y, ok: !!E.cast(st, u.uid, a.spellId, a.x, a.y), de: u.dono });
        else if (a.action === 'end') break;
        E.events.length = 0;
      }
      if (st.phase === 'playing') { E.endTurn(st); log.push({ a: 'e', ok: true, de: u.dono }); }
      E.events.length = 0;
      continue;
    }
    const plano = J.AI.planTurn(st, u.uid) || [];
    let acabou = false;
    for (const a of (plano.length ? plano : [{ action: 'end' }])) {
      if (st.phase !== 'playing') break;
      if (a.action === 'move') E.move(st, u.uid, a.x, a.y);
      else if (a.action === 'cast') E.cast(st, u.uid, a.spellId, a.x, a.y);
      else if (a.action === 'end') { E.endTurn(st); acabou = true; break; }
      E.events.length = 0;
    }
    if (!acabou && st.phase === 'playing') E.endTurn(st);
    E.events.length = 0;
  }
  const contexto = { agoraMs: AGORA, fatores: {} };
  const r0 = pega(() => fechaGrupo({ membros: membros(), ata, contexto,
    lances: [log[0], { a: 'po', u: heroiAna.uid, s: PEQ, ok: true, de: 'ana' }] }));
  check('em grupo o lance de poção derruba a sala (pocao-na-batalha)', !r0.ok && r0.motivo === 'pocao-na-batalha', JSON.stringify(r0));

  const r = pega(() => fechaGrupo({ membros: membros(), ata, lances: log, hashFinal: E.hash(st), contexto }));
  const pa = r.ok && r.r.membros[0].progress.consumiveis, pb = r.ok && r.r.membros[1].progress.consumiveis;
  check('o fechamento em grupo não mexe nas poções de ninguém (' + (r.ok ? r.r.fase : '?') + ')',
        r.ok && pa && pa[PEQ] === 2 && pb && pb[MED] === 2, JSON.stringify(r.ok ? { pa, pb } : r));
  const vm = r.ok ? r.r.vidaMax : undefined;
  check('... e o PV máximo sai com a chave dono:heroId (null se não venceu)',
        r.ok && (r.r.fase === 'won'
          ? (!!vm && vm['ana:sumo'] > 0 && vm['bia:curandeiro'] > 0 && Object.keys(vm).sort().join() === Object.keys(r.r.carry).sort().join())
          : vm === null), JSON.stringify(r.ok ? { carry: r.r.carry, vm } : r));
})();

// ================================================================ as ops: beber (interna), comprar e o load
(async () => {
  async function tenta(b, ops, interno) {
    try {
      return await executa({ conta: { id: 1, gm: false }, progress: b.progress, db: b.db, ops, semente: 1,
                             contexto: { agoraMs: AGORA, interno: !!interno } });
    } catch (e) { return { erro: e.message, motivo: e.motivo, indice: e.indice }; }
  }

  // ---- beberPocao: a op que a API pede na sala de espera
  const duas = conta(22, { [MED]: 2, [PEQ]: 1 });
  const b1 = await tenta(duas, [{ nome: 'beberPocao', args: { id: MED } }], true);
  check('beberPocao (interna) tira UMA Média e devolve a cura dos dados (70)',
        b1.ok && b1.resultados[0].ok && b1.resultados[0].cura === 70 && b1.resultados[0].resta === 1 &&
        b1.progress.consumiveis[MED] === 1 && b1.progress.consumiveis[PEQ] === 1, JSON.stringify(b1.erro || b1.resultados));
  const wc = est.mundoEconomico({ agoraMs: AGORA });
  check('... com o hash do estado novo (Economia.hash), diferente do de antes',
        b1.ok && b1.hash === wc.J.Economia.hash(b1.progress, b1.db) && b1.hash !== b1.hashAntes);
  const b2 = await tenta(conta(22, { [PEQ]: 1 }), [{ nome: 'beberPocao', args: { id: PEQ } }], true);
  check('a última poção bebida some do estado (sem contador zerado)', b2.ok && !(b2.progress.consumiveis && b2.progress.consumiveis[PEQ]),
        JSON.stringify(b2.erro || b2.progress.consumiveis));
  const b3 = await tenta(conta(22, { [PEQ]: 3 }), [{ nome: 'beberPocao', args: { id: GRA } }], true);
  check('sem a poção a op cai inteira (sem-pocao)', b3.motivo === 'sem-pocao' && b3.indice === 0, JSON.stringify(b3));
  const b4 = await tenta(duas, [{ nome: 'beberPocao', args: { id: 'pocao-de-mentira' } }], true);
  check('poção desconhecida cai (pocao)', b4.motivo === 'pocao', JSON.stringify(b4));
  const b5 = await tenta(duas, [{ nome: 'beberPocao', args: { id: MED } }], false);
  check('fora da API (sem contexto.interno) ninguém bebe por op (interna)', b5.motivo === 'interna', JSON.stringify(b5));
  const b6 = await tenta(duas, [{ nome: 'beberPocao', args: { id: PEQ } }, { nome: 'beberPocao', args: { id: GRA } }], true);
  check('tudo ou nada: o gole recusado derruba também o gole de antes no mesmo pedido', b6.motivo === 'sem-pocao' && b6.indice === 1,
        JSON.stringify(b6));

  // ---- a banca (op comprarPocao)
  const w0 = est.mundoEconomico({ agoraMs: AGORA, semente: 3 });
  est.poeEstado(w0, null, null);
  await w0.J.DB.ganharMoedas(1500);
  await w0.J.DB.depositarMoedas(1000);           // 500 no saco, 1000 no banco
  const base = est.tiraEstado(w0);
  check('a conta da banca tem 500 no saco e 1000 no banco', base.db.carteira.moedas === 500 && base.db.banco.moedas === 1000);

  const r1 = await tenta(base, [{ nome: 'comprarPocao', args: { id: MED, qtd: 3 } }]);
  const wm = est.mundoEconomico({ agoraMs: AGORA, semente: 99 });
  est.poeEstado(wm, base.progress, base.db);
  const rc = await wm.J.Mercado.comprarPocao(MED, 3);
  const c1 = est.tiraEstado(wm);
  check('comprarPocao debita 330 do saco e soma 3 Médias', r1.ok && r1.resultados[0].ok && r1.db.carteira.moedas === 170 &&
        r1.db.banco.moedas === 1000 && r1.progress.consumiveis[MED] === 3, JSON.stringify(r1.erro || r1.resultados));
  check('... com o mesmo hash que a compra na tela', rc.ok && r1.hash === c1.hash && r1.hash !== base.hash);

  const r2 = await tenta(base, [{ nome: 'comprarPocao', args: { id: GRA, qtd: 2 } }]);
  check('sem vinténs no SACO (o banco não conta) a compra é recusada e nada muda',
        r2.ok && r2.resultados[0].ok === false && r2.hash === r2.hashAntes, JSON.stringify(r2.resultados || r2));

  const wr = est.mundoEconomico({ agoraMs: AGORA, semente: 3 });
  est.poeEstado(wr, null, null);
  await wr.J.DB.ganharMoedas(2000);
  const rica = est.tiraEstado(wr);
  const r3 = await tenta(rica, [{ nome: 'comprarPocao', args: { id: PEQ, qtd: 12 } }, { nome: 'comprarPocao', args: { id: PEQ, qtd: 9 } },
                                { nome: 'comprarPocao', args: { id: PEQ, qtd: 8 } }]);
  check('acima do teto de 20 por tipo a compra é recusada sem cobrar (12 + 9 não, 12 + 8 sim)',
        r3.ok && r3.resultados[0].ok && r3.resultados[1].ok === false && r3.resultados[1].cheio && r3.resultados[2].ok &&
        r3.progress.consumiveis[PEQ] === 20 && r3.db.carteira.moedas === 2000 - 20 * 40, JSON.stringify(r3.resultados || r3));

  const r4 = await tenta(base, [{ nome: 'comprarPocao', args: { id: PEQ, qtd: 0 } }]);
  check('quantidade torta derruba o pedido (argumento)', r4.motivo === 'argumento', JSON.stringify(r4));
  const r5 = await tenta(base, [{ nome: 'comprarPocao', args: { id: 'escudo-de-mentira', qtd: 1 } }]);
  check('o mercador não vende o que não é poção', r5.ok && r5.resultados[0].ok === false && r5.hash === r5.hashAntes);

  // ---- o saneamento: teto e id desconhecido no load
  const torto = JSON.parse(JSON.stringify(base.progress));
  torto.consumiveis = { [PEQ]: 999, 'pocao-falsa': 3, [MED]: -2, [GRA]: 2.7 };
  const ws = est.mundoEconomico({ agoraMs: AGORA });
  est.poeEstado(ws, torto, base.db);
  const cs = ws.J.Progress.state.consumiveis;
  check('o load saneia: preso no teto, sem poção falsa, sem negativo', cs && cs[PEQ] === 20 && !cs['pocao-falsa'] && !cs[MED] && cs[GRA] === 2,
        JSON.stringify(cs));
  const semNada = est.mundoEconomico({ agoraMs: AGORA });
  est.poeEstado(semNada, null, null);
  check('a conta sem poção não ganha campo novo (o hash de antes das poções fica)', !('consumiveis' in semNada.J.Progress.state));

  console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})();
