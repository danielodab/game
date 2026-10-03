#!/usr/bin/env node
'use strict';
/* PROVA DO MOTOR DO ECO PRIMORDIAL (02/10). O pedido: o chefe supremo "imóvel
 * no centro da arena, ocupa 2×2 casas", fases por vida perdida com troca de
 * elemento e resistência, Ecos Menores na troca, golpes grandes "avisados um
 * turno antes", 12 rodadas e o placar = o dano causado ao Eco.
 *
 *   node tests/eco_motor.js
 *
 * Roda sobre o motor do juiz (servidor/juiz/motor.js): o jogo inteiro em Node.
 * Cobra a REGRA, não o número — os números moram em js/core/data/eco.js:
 *   · o CORPO 2×2: as quatro casas devolvem o Eco; mirar qualquer uma acerta;
 *     a área que cobre as quatro acerta UMA vez; o corpo bloqueia passagem; não
 *     é empurrado, puxado nem trocado; quem encosta em qualquer casa fica fixado;
 *   · a VISÃO coerente: o herói mira o Eco se e só se vê alguma casa dele dentro
 *     do alcance, e o Eco mira o herói nas MESMAS condições (simétrico em toda
 *     casa da câmara);
 *   · sem brecha: o invisível não é marcado pelo golpe nem mirado pela IA dele,
 *     mas a área o pega; o raio salta do Eco pela casa mais perto e não o acerta
 *     duas vezes; a armadilha do herói dispara no Eco Menor que pisa nela;
 *   · as FASES: a 25% perdidos vira Água (fraco a Terra, resiste a Fogo, feitiços
 *     de Água) e chama 2 Ecos Menores de Água; um golpe que atravessa dois
 *     limiares vai direto à fase de chegada, uma troca só; a fase não volta;
 *   · o AVISO: no fim da 1ª vez dele as casas ficam marcadas; quem está nelas no
 *     começo da vez seguinte leva o golpe, quem saiu não; o ritmo é a cada 2;
 *   · o PLACAR: conta a vida que o grupo tirou (o excedente da morte não; o
 *     golpe de um Eco Menor nele não; o veneno do herói sim); derrubar soma o
 *     bônus e encerra; a 13ª rodada encerra com o placar intacto;
 *   · o hash muda com o placar e a mesma semente com os mesmos lances refaz a
 *     mesma tentativa (o juiz depende disso);
 *   · e a IA joga uma tentativa inteira sem nenhum lance recusado. */
const path = require('path');
const { mundo } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'motor.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (extra !== undefined && !ok ? ' — ' + extra : ''));
}

/* feitiços de prova (prefixo pv-), nos heróis por `spells` */
function prepara(J) {
  const D = J.DATA;
  function sp(id, over) {
    const s = { id, name: id, element: 'neutro', classId: null, unlockLevel: 0, paCost: 1, cooldown: 0, castsPerTurn: 0,
      range: { min: 1, max: 12, line: false, los: true }, aoe: { shape: 'single', size: 0 }, needsEmptyTile: false,
      targetSide: 'enemy', effects: [], description: 'prova', flavor: '', fxKey: 'slam' };
    Object.assign(s, over);
    D.spells[id] = s;
  }
  sp('pv-tiro', { effects: [{ type: 'damage', element: 'neutro', min: 50, max: 50 }] });
  sp('pv-tiro-terra', { element: 'terra', effects: [{ type: 'damage', element: 'terra', min: 50, max: 50 }] });
  sp('pv-bomba', { aoe: { shape: 'circle', size: 2 }, effects: [{ type: 'damage', element: 'neutro', min: 40, max: 40 }] });
  sp('pv-canhao', { effects: [{ type: 'damage', element: 'neutro', min: 9999, max: 9999 }] });
  sp('pv-empurra', { effects: [{ type: 'push', tiles: 3 }, { type: 'pull', tiles: 3 }] });
  sp('pv-troca', { targetSide: 'any', effects: [{ type: 'swap' }] });
  sp('pv-raio', { effects: [{ type: 'chain', jumps: 3, falloff: 1, element: 'neutro', min: 30, max: 30 }] });
  sp('pv-veneno', { effects: [{ type: 'poison', element: 'neutro', min: 20, max: 20, duration: 3 }] });
  sp('pv-sombra', { targetSide: 'self', range: { min: 0, max: 0, line: false, los: false },
    effects: [{ type: 'invisible', duration: 3 }] });
  sp('pv-armadilha', { targetSide: 'any', needsEmptyTile: true,
    effects: [{ type: 'trap', trapId: 'pv-carga', duration: 5 }] });
  D.monsterSpells['pv-carga'] = { id: 'pv-carga', name: 'Carga', element: 'neutro', classId: null, unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0, range: { min: 0, max: 1, line: false, los: true },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'any',
    effects: [{ type: 'damage', element: 'neutro', min: 25, max: 25 }], description: 'prova', flavor: '', fxKey: 'slam' };
}
const SPELLS = ['pv-tiro', 'pv-tiro-terra', 'pv-bomba', 'pv-canhao', 'pv-empurra', 'pv-troca', 'pv-raio', 'pv-veneno',
                'pv-sombra', 'pv-armadilha'];

const W = mundo([]);
const J = W.JOGO, E = J.Engine, AI = J.AI, D = J.DATA;
prepara(J);
const CFG = D.eco;

function heroi(id, extra) {
  return Object.assign({ classId: 'arqueiro', heroId: id, level: 30, element: 'neutro', spells: SPELLS.slice(),
    stats: { hp: 5000, pa: 99, pp: 30, initiative: 90, power: 0, dodge: 0, lock: 0,
             resists: { fogo: 0, agua: 0, terra: 0, ar: 0, neutro: 0 } } }, extra || {});
}
function camara(party, seed) {
  const st = E.createBattle(CFG.arena, 0, party || [heroi('h1')], { seed: seed || 11, escolhePosicao: false });
  E.events.length = 0;
  return st;
}
function eco(st) { return E.findUnit(st, st.eco.uid); }
function herois(st) { return st.units.filter((u) => u.kind === 'hero'); }
function poe(st, u, x, y) { u.x = x; u.y = y; }
// a vez de um herói: encerra quem estiver na vez até ser ele (a IA não joga aqui; os monstros só passam)
function vezDe(st, uid) {
  for (let i = 0; i < 200 && st.phase === 'playing'; i++) {
    const a = E.activeUnit(st);
    if (a && a.uid === uid) return true;
    E.endTurn(st);
  }
  return false;
}
function eventos(tipo) { return E.events.filter((e) => e.type === tipo); }

// ------------------------------------------------------------------- o corpo
(function () {
  const st = camara();
  const e = eco(st);
  check('a câmara nasce com o Eco de porte 2 e o estado da tentativa', !!st.eco && e.porte === 2 && st.eco.fase === 0,
        JSON.stringify(st.eco));
  check('a câmara não sorteia desafio de sala', !st.desafio);
  const casas = E.casasDe(e);
  check('o corpo ocupa 2×2 casas a partir do canto noroeste (8,8)',
        casas.length === 4 && casas.every((c) => E.unitAt(st, c.x, c.y) === e), JSON.stringify(casas));
  check('fora do quadrado não é ele', E.unitAt(st, 10, 8) !== e && E.unitAt(st, 8, 10) !== e && E.unitAt(st, 7, 7) !== e);
  check('as casas dele são chão no mapa (a letra marca o canto, o resto é "."): o corpo cabe',
        casas.every((c) => st.grid.tiles[c.y][c.x].type === 'floor'));
  check('nasce na fase de Fogo, fraco a Água e resistente a Ar (a roda)',
        e.element === 'fogo' && e.resists.agua === CFG.fracoFase && e.resists.ar === CFG.resisteFase, JSON.stringify(e.resists));
  check('o Eco não anda (PP 0) e é imune a empurrão por escrito', e.ppMax === 0 && E.unitHasTrait(e, 'pushImmune'));
})();

(function () {
  const st = camara();
  const h = herois(st)[0], e = eco(st);
  vezDe(st, h.uid);
  // mirar qualquer das quatro casas acerta, uma de cada vez
  const perdas = E.casasDe(e).map((c) => {
    poe(st, h, c.x, 13);
    h.pa = 99;
    E.events.length = 0;
    const antes = e.hp;
    const ok = E.cast(st, h.uid, 'pv-tiro', c.x, c.y);
    return ok ? antes - e.hp : -1;
  });
  check('mirar QUALQUER das quatro casas acerta o Eco, com o mesmo dano', perdas[0] > 0 && perdas.every((p) => p === perdas[0]),
        JSON.stringify(perdas));
  // a área em cima das quatro casas acerta uma vez
  poe(st, h, 8, 13);
  h.pa = 99;
  E.events.length = 0;
  const antes = e.hp;
  E.cast(st, h.uid, 'pv-bomba', 9, 9);
  const danosNele = eventos('damage').filter((ev) => ev.uid === e.uid);
  check('a área que cobre as quatro casas dele acerta UMA vez', danosNele.length === 1 && antes - e.hp === danosNele[0].hpLoss,
        danosNele.length + ' golpes, ' + (antes - e.hp) + ' de vida');
})();

(function () {
  const st = camara();
  const h = herois(st)[0], e = eco(st);
  vezDe(st, h.uid);
  poe(st, h, 7, 8);
  h.pp = 30;
  const reach = E.reachable(st, h.uid);
  const dentro = reach.filter((c) => E.casasDe(e).some((q) => q.x === c.x && q.y === c.y));
  check('nenhuma casa do corpo é alcançável a pé', dentro.length === 0, JSON.stringify(dentro));
  check('o caminho contorna o corpo (de (7,8) a (10,8) não atravessa)',
        (E.path(st, h.uid, 10, 8) || []).every((c) => !E.casasDe(e).some((q) => q.x === c.x && q.y === c.y)) &&
        (E.path(st, h.uid, 10, 8) || []).length > 3);
  // fixação: colado em qualquer casa do corpo
  const risco = E.reachable(st, h.uid).filter((c) => c.risky).length;
  check('encostado no corpo, sair arrisca o teste de fixação (o Eco fixa)', risco > 0, String(risco));
  // empurrão, puxão e troca não o movem
  h.pa = 99;
  const x0 = e.x, y0 = e.y;
  E.cast(st, h.uid, 'pv-empurra', 8, 8);
  E.cast(st, h.uid, 'pv-troca', 8, 9);
  check('empurrão, puxão e troca de lugar não movem o corpo grande', e.x === x0 && e.y === y0 && h.x === 7 && h.y === 8,
        e.x + ',' + e.y + ' / herói ' + h.x + ',' + h.y);
})();

// ------------------------------------------------------------- a visão coerente
(function () {
  const st = camara();
  const h = herois(st)[0], e = eco(st);
  vezDe(st, h.uid);
  const tiroEco = 'm-eco-pulso';
  const alc = D.monsterSpells[tiroEco].range.max;
  let assim = 0, casasVistas = 0;
  for (let y = 0; y < st.grid.h; y++) {
    for (let x = 0; x < st.grid.w; x++) {
      if (st.grid.tiles[y][x].type !== 'floor' || E.unitAt(st, x, y)) continue;
      poe(st, h, x, y);
      // o herói pode mirar alguma casa do Eco (com o mesmo alcance do pulso)?
      const heroiVe = E.casasDe(e).some((c) => Math.abs(c.x - x) + Math.abs(c.y - y) <= alc && E.los(st, x, y, c.x, c.y));
      // o Eco pode mirar o herói?
      const ecoVe = E.validTargetCell(st, e, D.monsterSpells[tiroEco], x, y);
      if (heroiVe !== ecoVe) assim++;
      if (heroiVe) casasVistas++;
    }
  }
  check('a visão é simétrica em toda casa da câmara: o Eco mira quem o mira (alcance ' + alc + ')', assim === 0,
        assim + ' casas assimétricas');
  check('os pilares tiram casas da vista do núcleo (a câmara tem abrigo)', casasVistas > 0 && casasVistas < 220, String(casasVistas));
  // o golpe sai da casa dele que vê o alvo: herói a leste vê pelo lado leste
  poe(st, h, 13, 9);
  const o = E.origemPara(st, e.uid, tiroEco, 13, 9);
  check('o Eco conjura da casa dele mais perto que vê o alvo (a leste → x 9)', o && o.x === 9 && o.y === 9, JSON.stringify(o));
})();

// --------------------------------------------------------------------- sem brecha
(function () {
  const st = camara([heroi('h1'), heroi('h2')]);
  const [h1, h2] = herois(st), e = eco(st);
  vezDe(st, h1.uid);
  poe(st, h1, 8, 12); poe(st, h2, 12, 9);
  h1.pa = 99;
  E.cast(st, h1.uid, 'pv-sombra', h1.x, h1.y);
  check('o herói ficou invisível', E.unitHasEffect(h1, 'invisible'));
  const casas = E._casasDoGolpe(st, e, CFG.golpes.fogo);
  const marcaH1 = casas.some((c) => c.x === h1.x && c.y === h1.y);
  const marcaH2 = casas.some((c) => c.x === h2.x && c.y === h2.y);
  check('a Chuva do Núcleo marca o visível e NÃO o invisível (o Eco não o vê)', marcaH2 && !marcaH1);
  const plano = AI.planTurn(st, e.uid);
  st.phase = 'playing';
  const mira = plano.filter((a) => a.action === 'cast').some((a) => E.unitAt(st, a.x, a.y) === h1);
  check('a IA do Eco não mira o invisível', !mira, JSON.stringify(plano));
  // a área ainda pega o invisível: o golpe ONDA é área de chão
  const onda = E._casasDoGolpe(st, e, CFG.golpes.agua);
  check('o golpe de área marca casa, não gente: a casa do invisível entra quando está na onda',
        onda.some((c) => c.x === 8 && c.y === 12) === (E.los(st, 8, 9, 8, 12) && E.distA(e, 8, 12) >= CFG.golpes.agua.de &&
                                                        E.distA(e, 8, 12) <= CFG.golpes.agua.ate));
})();

(function () {
  const st = camara([heroi('h1')]);
  const h = herois(st)[0], e = eco(st);
  vezDe(st, h.uid);
  // um Eco Menor a 2 casas do lado LESTE do corpo (12,8): longe do canto noroeste (8,8), perto da casa (9,8)
  const m = J.Engine.monster('eco_menor_fogo');
  check('o Eco Menor existe para o motor (Engine.monster)', !!m);
  st._uidCounter++;
  const menor = { uid: 'u' + st._uidCounter, defId: 'eco_menor_fogo', kind: 'summon', side: 'enemy', name: 'Menor',
    x: 12, y: 8, hp: 500, hpMax: 500, pa: 0, paMax: 0, pp: 0, ppMax: 0, initiative: 0, power: 0, elemPower: 0, dodge: 0,
    lock: 0, element: 'fogo', resists: {}, spells: [], cooldowns: {}, castsThisTurn: {}, effects: [], shield: 0,
    alive: true, offBoard: false, traits: [], summonerUid: e.uid, _birth: st._uidCounter };
  st.units.push(menor);
  poe(st, h, 8, 13);
  h.pa = 99;
  E.events.length = 0;
  E.cast(st, h.uid, 'pv-raio', 8, 9);
  const hops = eventos('chainHop');
  check('o raio acerta o Eco UMA vez e salta para o Menor medindo da casa mais perto (3 de (9,8), 4 do canto)',
        hops.filter((x) => x.uid === e.uid).length === 1 && hops.some((x) => x.uid === menor.uid),
        JSON.stringify(hops));
  // armadilha do herói: o Menor que pisa dispara
  menor.pp = 4; menor.ppMax = 4;
  poe(st, h, 12, 13);
  E.cast(st, h.uid, 'pv-armadilha', 12, 10);
  check('a armadilha do herói foi posta', st.traps.some((t) => t.x === 12 && t.y === 10));
  const vidaM = menor.hp;
  st.activeIdx = st.order.indexOf(menor.uid) >= 0 ? st.order.indexOf(menor.uid) : st.activeIdx;
  E.move(st, menor.uid, 12, 11);
  check('o Eco Menor que pisa na armadilha do herói cai nela e para em cima', menor.hp < vidaM && menor.y === 10,
        menor.hp + ' em ' + menor.x + ',' + menor.y);
})();

// ---------------------------------------------------------------------- as fases
(function () {
  const st = camara();
  const h = herois(st)[0], e = eco(st);
  vezDe(st, h.uid);
  poe(st, h, 8, 13);
  h.pa = 999;
  const quarto = Math.ceil(e.hpMax / 4);
  let n = 0;
  while (e.hpMax - e.hp < quarto && n++ < 999) E.cast(st, h.uid, 'pv-tiro', 8, 9);
  check('a 25% de vida perdida ele vira Água', st.eco.fase === 1 && e.element === 'agua', e.element + ' fase ' + st.eco.fase);
  check('na Água: fraco a Terra (a roda: terra vence água) e resiste a Fogo',
        e.resists.terra === CFG.fracoFase && e.resists.fogo === CFG.resisteFase && !(e.resists.ar), JSON.stringify(e.resists));
  check('na Água: os feitiços passam a ser os da fase + o comum',
        JSON.stringify(e.spells) === JSON.stringify(CFG.comuns.concat(CFG.feiticosFase.agua)), JSON.stringify(e.spells));
  const menores = st.units.filter((u) => u.kind === 'summon' && u.alive);
  check('a troca chama ' + CFG.menoresPorTroca + ' Ecos Menores de Água, colados no corpo (até 3 passos), na ordem depois dele',
        menores.length === CFG.menoresPorTroca && menores.every((m) => m.defId === CFG.menores.agua && E.distA(e, m.x, m.y) <= 3) &&
        menores.every((m) => st.order.indexOf(m.uid) === st.order.indexOf(e.uid) + 1 || st.order.indexOf(m.uid) === st.order.indexOf(e.uid) + 2),
        JSON.stringify(menores.map((m) => [m.defId, m.x, m.y])));
  // o dano de terra agora entra mais forte
  const a1 = e.hp; E.cast(st, h.uid, 'pv-tiro-terra', 8, 9);
  check('o elemento que vence o da fase fere mais (50 de terra → ' + Math.round(50 * (100 - CFG.fracoFase) / 100) + ')',
        a1 - e.hp === Math.round(50 * (100 - CFG.fracoFase) / 100), String(a1 - e.hp));
  // um golpe que atravessa DOIS limiares (de 49% perdidos a 80%): troca uma vez, direto para o Ar
  E.events.length = 0;
  e.hp = Math.ceil(e.hpMax * 0.51);
  const golpao = { id: 'pv-golpao', name: 'golpão', element: 'fogo', aoe: { shape: 'single', size: 0 },
                   effects: [{ type: 'damage', element: 'fogo', min: 1, max: 1 }] };
  const queda = e.hp - Math.floor(e.hpMax * 0.20);
  golpao.effects[0].min = golpao.effects[0].max = Math.ceil(queda / ((100 - E.effResist(e, 'fogo')) / 100)) + 2;
  E.castCore(st, h, golpao, 8, 9, {});
  const trocas = eventos('ecoFase');
  const menoresAr = st.units.filter((u) => u.kind === 'summon' && u.alive && u.defId === CFG.menores.ar).length;
  const menoresTerra = st.units.filter((u) => u.kind === 'summon' && u.defId === CFG.menores.terra).length;
  check('o golpe que atravessa dois limiares troca UMA vez, direto para a fase de chegada (Ar), e chama só os Menores dela',
        trocas.length === 1 && st.eco.fase === 3 && e.element === 'ar' && menoresAr === CFG.menoresPorTroca && menoresTerra === 0,
        JSON.stringify(trocas) + ' ar=' + menoresAr + ' terra=' + menoresTerra);
  // a fase não volta com cura
  e.hp = e.hpMax;
  E.cast(st, h.uid, 'pv-tiro', 8, 9);
  check('a fase não volta quando ele cura', st.eco.fase === 3 && e.element === 'ar');
})();

// ---------------------------------------------------------------------- o aviso
(function () {
  const st = camara([heroi('h1'), heroi('h2')], 5);
  const [h1, h2] = herois(st), e = eco(st);
  // os heróis só passam a vez; até a vez do Eco
  vezDe(st, e.uid);
  check('é a vez do Eco', E.activeUnit(st) === e);
  check('antes da 1ª vez dele não há golpe marcado', !st.eco.aviso);
  E.endTurn(st);                        // a 1ª vez dele termina: o aviso sai
  const av = st.eco.aviso;
  check('no fim da 1ª vez dele o golpe da fase fica marcado no chão (a Chuva do Núcleo em volta dos heróis)',
        !!av && av.golpe === CFG.golpes.fogo.id && av.casas.length > 0, JSON.stringify(av));
  check('as casas marcadas são chão e nunca o corpo dele',
        av.casas.every((c) => st.grid.tiles[c.y][c.x].type === 'floor' && !E.ocupa(e, c.x, c.y)));
  const emH1 = av.casas.some((c) => c.x === h1.x && c.y === h1.y);
  check('o herói visível está numa casa marcada', emH1);
  // h1 fica; h2 sai da marca (para uma casa que não está marcada)
  vezDe(st, h2.uid);
  const livre = E.reachable(st, h2.uid).find((c) => !av.casas.some((q) => q.x === c.x && q.y === c.y));
  E.move(st, h2.uid, livre.x, livre.y);
  const vida1 = h1.hp, vida2 = h2.hp;
  E.events.length = 0;
  vezDe(st, e.uid);                     // o começo da vez seguinte dele: o golpe cai
  const golpe = eventos('ecoGolpe');
  check('o golpe cai no começo da vez SEGUINTE dele, uma vez', golpe.length === 1 && !st.eco.aviso, JSON.stringify(golpe));
  check('quem ficou na marca leva, quem saiu não', h1.hp < vida1 && h2.hp === vida2, vida1 + '→' + h1.hp + ' / ' + vida2 + '→' + h2.hp);
  E.endTurn(st);                        // 2ª vez: sem aviso novo (o ritmo é a cada 2)
  check('no fim da 2ª vez não marca outro (a cada ' + CFG.golpeACada + ')', !st.eco.aviso);
  vezDe(st, e.uid); E.endTurn(st);      // 3ª vez: marca de novo
  check('no fim da 3ª vez marca de novo', !!st.eco.aviso);
  check('o golpe marcado entra no hash (os dois motores e o juiz comparam)', (function () {
    const h0 = E.hash(st); const guarda = st.eco.aviso; st.eco.aviso = null; const h1x = E.hash(st); st.eco.aviso = guarda;
    return h0 !== h1x;
  })());
})();

(function () {
  // cada padrão desenha o que promete
  const st = camara();
  const e = eco(st);
  const onda = E._casasDoGolpe(st, e, CFG.golpes.agua);
  check('a Maré Funda só marca casas de ' + CFG.golpes.agua.de + ' a ' + CFG.golpes.agua.ate + ' passos com visão do núcleo',
        onda.length > 0 && onda.every((c) => { const d = E.distA(e, c.x, c.y); const p = E.pontoDe(e, c.x, c.y);
          return d >= CFG.golpes.agua.de && d <= CFG.golpes.agua.ate && E.los(st, p.x, p.y, c.x, c.y); }));
  check('o pilar abriga da Maré Funda (a casa atrás do pilar norte (8,2) não é marcada)',
        !onda.some((c) => c.x === 8 && c.y === 2) && E.distA(e, 8, 2) <= CFG.golpes.agua.ate);
  const cruz = E._casasDoGolpe(st, e, CFG.golpes.terra);
  check('a Rachadura corre nos eixos do corpo e para no pilar (8,3): marca (8,4), não (8,2)',
        cruz.some((c) => c.x === 8 && c.y === 4) && !cruz.some((c) => c.x === 8 && c.y === 2) &&
        cruz.every((c) => (c.x >= 8 && c.x <= 9) || (c.y >= 8 && c.y <= 9)));
  const anel = E._casasDoGolpe(st, e, CFG.golpes.ar);
  check('as Correntes Rompidas pegam quem está colado (1 a 2 passos)',
        anel.some((c) => c.x === 7 && c.y === 8) && anel.every((c) => E.distA(e, c.x, c.y) <= CFG.golpes.ar.ate));
})();

// ---------------------------------------------------------------------- o placar
(function () {
  const st = camara([heroi('h1')]);
  const h = herois(st)[0], e = eco(st);
  vezDe(st, h.uid);
  poe(st, h, 8, 13);
  h.pa = 99;
  const v0 = e.hp;
  E.cast(st, h.uid, 'pv-tiro', 8, 9);
  check('o tiro do herói conta no placar exatamente a vida que tirou', st.eco.dano === v0 - e.hp && st.eco.dano > 0,
        st.eco.dano + ' / ' + (v0 - e.hp));
  // o golpe de alguém do lado dele não pontua
  const antes = st.eco.dano, vida = e.hp;
  E.applyEffects(st, e, { id: 'x', element: 'neutro', aoe: { shape: 'single', size: 0 },
    effects: [{ type: 'damage', element: 'neutro', min: 30, max: 30 }] }, 8, 8, { selfHarm: true, casterX: 8, casterY: 8 });
  check('o dano que vem do lado DELE fere mas não pontua', e.hp < vida && st.eco.dano === antes, e.hp + ' / ' + st.eco.dano);
  // o veneno do herói conta no tique
  E.cast(st, h.uid, 'pv-veneno', 8, 9);
  const d0 = st.eco.dano, vv = e.hp;
  vezDe(st, e.uid);
  check('o veneno do herói conta no placar quando tica na vez dele', st.eco.dano - d0 === vv - e.hp && vv > e.hp,
        (st.eco.dano - d0) + ' / ' + (vv - e.hp));
})();

(function () {
  const st = camara([heroi('h1')]);
  const h = herois(st)[0], e = eco(st);
  vezDe(st, h.uid);
  poe(st, h, 8, 13);
  h.pa = 99;
  e.hp = 120;
  const d0 = st.eco.dano;
  E.cast(st, h.uid, 'pv-canhao', 8, 9);
  const pl = E.ecoPlacar(st);
  check('o golpe que derruba conta só a vida que restava (o excedente não pontua)', pl.dano - d0 === 120, String(pl.dano - d0));
  check('derrubado: a tentativa acaba em vitória e o placar soma o bônus',
        st.phase === 'won' && pl.derrubou && pl.bonus === Math.round(e.hpMax * CFG.bonusDerrubada) && pl.pontos === pl.dano + pl.bonus,
        st.phase + ' ' + JSON.stringify(pl));
})();

(function () {
  const st = camara([heroi('h1')]);
  const h = herois(st)[0];
  let n = 0;
  while (st.phase === 'playing' && n++ < 5000) E.endTurn(st);
  const pl = E.ecoPlacar(st);
  check('passadas as ' + CFG.rodadas + ' rodadas a tentativa acaba (a 13ª não começa)',
        st.phase === 'lost' && st.round === CFG.rodadas + 1 && pl.rodada === CFG.rodadas, st.phase + ' r' + st.round);
  check('o placar fica como estava (0, ninguém bateu)', pl.dano === 0 && pl.pontos === 0 && h.alive !== undefined);
})();

// ------------------------------------------------- determinismo, hash e a IA inteira
function partidaIA(seed, guarda) {
  const party = [heroi('h1', { classId: 'sumo', stats: undefined, spells: undefined, level: 30, element: 'agua' }),
                 heroi('h2', { classId: 'arqueiro', stats: undefined, spells: undefined, level: 30, element: 'fogo' })];
  const st = E.createBattle(CFG.arena, 0, party, { seed, escolhePosicao: false });
  E.events.length = 0;
  let recusas = 0, n = 0;
  while (st.phase === 'playing' && n++ < 3000) {
    const u = E.activeUnit(st);
    const plano = AI.planTurn(st, u.uid);
    let acabou = false;
    for (const a of plano) {
      if (st.phase !== 'playing') break;
      if (a.action === 'cast') {
        // a IA planeja o turno inteiro de uma vez: o 2º tiro num alvo que o 1º derrubou é recusado em
        // qualquer sala (não é do corpo grande). Conta só a recusa com o alvo ainda de pé ali: essa
        // seria da geometria (alcance, visão, a casa de onde o Eco conjura)
        const alvo = E.unitAt(st, a.x, a.y), sp = E.spell(a.spellId);
        const temArea = sp.aoe && sp.aoe.shape !== 'single' && sp.aoe.size > 0;
        if ((temArea || (alvo && alvo.alive)) && !E.validTargetCell(st, u, sp, a.x, a.y)) recusas++;
        E.cast(st, u.uid, a.spellId, a.x, a.y);
      } else if (a.action === 'move') E.move(st, u.uid, a.x, a.y);
      else if (a.action === 'end') { E.endTurn(st); acabou = true; break; }
    }
    if (!acabou && st.phase === 'playing') E.endTurn(st);
    if (guarda) guarda(st);
    E.events.length = 0;
  }
  return { st, recusas };
}
(function () {
  const a = partidaIA(21), b = partidaIA(21);
  check('a mesma semente, jogada igual, termina no mesmo hash e no mesmo placar',
        E.hash(a.st) === E.hash(b.st) && a.st.eco.dano === b.st.eco.dano, a.st.eco.dano + ' / ' + b.st.eco.dano);
  check('a IA (heróis e Eco) joga a tentativa inteira sem lance que o motor recuse por geometria', a.recusas === 0, String(a.recusas));
  check('a tentativa da IA termina (tempo, derrubada ou grupo caído) e pontua', a.st.phase !== 'playing' && a.st.eco.dano > 0,
        a.st.phase + ' ' + a.st.eco.dano);
  const h0 = E.hash(a.st);
  a.st.eco.dano += 1;
  check('o placar entra no hash', E.hash(a.st) !== h0);
  a.st.eco.dano -= 1;
  // o corpo nunca dividiu casa com ninguém em nenhum momento da partida
  let colado = 0;
  partidaIA(33, (st) => {
    const e = eco(st);
    if (!e.alive) return;
    st.units.forEach((u) => { if (u !== e && u.alive && !u.offBoard && E.ocupa(e, u.x, u.y)) colado++; });
  });
  check('em toda a partida da IA ninguém pisou numa casa do corpo', colado === 0, String(colado));
})();

console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
