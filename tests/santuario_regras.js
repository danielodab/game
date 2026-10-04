#!/usr/bin/env node
'use strict';
/* PROVA DO SANTUÁRIO DOS ELEMENTOS (03/10) — js/core/santuario.js (Santuario.regras)
 * e js/core/data/santuario.js (o calabouço especial 'elementsanctum').
 *
 *   node tests/santuario_regras.js
 *
 * Roda sobre o motor do juiz (servidor/juiz/motor.js): o jogo inteiro em Node.
 * Cobra a REGRA, não o número (os números saem de DATA.santuario):
 *   · OS DADOS: cinco salas na régua dos mapas (a de tests/validate_world.html),
 *     a máscara de cada sala do tamanho do layout e cada letra dela em cima da
 *     casa certa, a entrada fora de toda regra, os oito guardiões com os ids
 *     fixos, o papel e o traço de cada um, nenhum chefe, fora do Poço;
 *   · FOGO: quem não é de Fogo só mira a casa escura a até `visao` casas; o de
 *     Fogo e o Vigia miram de longe; o braseiro aceso clareia o raio dele (só o
 *     que ele vê), o golpe de Fogo acende e o de Água apaga, e o braseiro só é
 *     alvo do golpe que o MUDA; o monstro no breu some para o grupo (ocultoDe)
 *     e nunca o contrário;
 *   · ÁGUA: entrar na casa alagada custa `custo` PP (`custoAgua` para quem é de
 *     Água), a ponte é seca, o caminho mais barato dá a volta; a correnteza
 *     leva 1 casa quem está na água no FIM da rodada, para onde a bica que
 *     verte aponta, e a bica troca a cada `trocaACada` rodadas;
 *   · TERRA: os pilares trocam no começo das rodadas 3, 5, 7…, o aviso sai no
 *     começo da rodada ANTERIOR, o pilar de pé fecha a visão e o passo, e com
 *     alguém em cima do soquete o pilar ESPERA (ninguém é esmagado nem ferido);
 *     em toda sala, com TODOS os pilares de pé, todo chão segue ligado a todo
 *     chão e todo soquete tem chão comum ao lado;
 *   · AR: a rajada leva 1 casa quem está na zona no fim da rodada, gira na
 *     ordem do dado a cada `giraACada` rodadas, não mexe na casa calma do
 *     respiro, em quem está fora da zona nem em quem é imune a empurrão; o
 *     feitiço de Ar lançado de dentro da zona alcança `alcance` casas a mais
 *     (e só o de Ar, e só de dentro);
 *   · O ALTAR tem as quatro, cada uma no seu canto;
 *   · NADA SORTEIA: a regra não gasta o rng da sala; a mesma semente com os
 *     mesmos lances dá o mesmo hash em dois mundos; a foto guarda os pilares;
 *   · AVISO ANTES DO EFEITO: em partidas inteiras jogadas pela IA, toda troca
 *     de pilar teve aviso na rodada anterior com as mesmas casas, e toda
 *     correnteza e toda rajada foi para onde o começo da rodada disse — e a
 *     virada foi anunciada uma rodada antes;
 *   · A IA NÃO FICA PRESA: com o grupo parado na entrada os monstros chegam e
 *     vencem em toda sala; com os monstros parados o grupo chega e vence; e a
 *     IA nunca planeja um golpe que o motor recusa por causa do escuro;
 *   · O JUIZ refaz cada sala com os lances do cliente e chega ao MESMO hash; o
 *     hash forjado e o lance que o escuro recusa caem como 'divergiu';
 *   · O SAQUE é o do Coração Partido (`saqueDe`): as quatro salas de quadrante
 *     sorteiam como a última sala comum de lá (nada épico nem lendário), o
 *     Altar como a do chefe; sem chefe, nenhuma carta de classe nem de bicho; o
 *     XP não é cortado para o herói do teto; e o que o juiz PAGA numa sala
 *     vencida é o que o funil do jogo pagaria (pedra do quadrante, sem selo,
 *     insígnia nem âncora);
 *   · Engine.VERSAO_REGRAS ≥ 7. */
const path = require('path');
const { mundo } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'motor.js'));
const { refaz } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));
try { require('os').setPriority(0, require('os').constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) { /* sem permissão: segue */ }

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
function novo() { return mundo([]).JOGO; }
const J = novo();
const D = J.DATA, E = J.Engine, Sa = J.Santuario, AI = J.AI;
const ID = 'elementsanctum';
const CFG = D.santuario;
const DG = D.especial(ID);
const md = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);
const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const VETOR = { n: [0, -1], s: [0, 1], l: [1, 0], o: [-1, 0] };
const SALA = { fogo: 0, agua: 1, terra: 2, ar: 3, altar: 4 };
const ehChao = (ch) => ch !== '#' && ch !== '=' && ch !== '~';

function heroi(classId, heroId, element) {
  // o grimório do caminho escolhido: os três de base e os seis do elemento (como o Progress monta)
  const spells = Object.keys(D.spells).filter((id) => D.spells[id].classId === classId &&
    (D.spells[id].element === 'neutro' || D.spells[id].element === element));
  return { classId, heroId, level: 30, element, spells };
}
/* uma sala já em jogo (sem a escolha da posição), no mundo `Jx` */
function sala(Jx, ri, party, seed) {
  const st = Jx.Engine.createBattle(ID, ri, JSON.parse(JSON.stringify(party)), { seed: seed || 7, escolhePosicao: false });
  st.phase = 'playing';
  Jx.Engine.events.length = 0;
  return st;
}
const herois = (st) => st.units.filter((u) => u.kind === 'hero');
const monstros = (st, defId) => st.units.filter((u) => u.side === 'enemy' && (!defId || u.defId === defId));
function poe(u, x, y) { u.x = x; u.y = y; return u; }
/* tira os monstros do caminho: todos para o canto leste, em casas de chão livres e fora de toda regra */
function guardaMonstros(Jx, st, fora) {
  const livres = [];
  const p = Jx.Santuario.planta(st);
  for (let x = st.grid.w - 2; x >= 0 && livres.length < 20; x--) {
    for (let y = 1; y < st.grid.h - 1; y++) {
      const t = st.grid.tiles[y][x];
      if (t.type !== 'floor' || t.pilar || Jx.Engine.unitAt(st, x, y)) continue;
      if (p.agua[x + ',' + y] || (fora && fora(x, y))) continue;
      livres.push([x, y]);
    }
  }
  monstros(st).forEach((m, i) => poe(m, livres[i][0], livres[i][1]));
}
/* passa a vez de todo mundo até a rodada virar (ninguém age: só o relógio do mapa anda) */
function viraRodada(Jx, st) {
  const r = st.round;
  for (let g = 0; st.phase === 'playing' && st.round === r && g < 200; g++) Jx.Engine.endTurn(st);
  const evs = Jx.Engine.events.slice();
  Jx.Engine.events.length = 0;
  return evs;
}
/* dá a vez a `u` (a ordem de iniciativa é do motor; a prova só precisa de quem age) */
function daVez(st, u) {
  st.activeIdx = st.order.indexOf(u.uid);
  u.pa = 12; u.pp = 6; u.castsThisTurn = {}; u.cooldowns = {};
}
function ligado(grade, de) {
  const h = grade.length, w = grade[0].length, visto = {}, fila = [de];
  visto[de[0] + ',' + de[1]] = true;
  while (fila.length) {
    const c = fila.shift();
    for (const d of DIRS) {
      const nx = c[0] + d[0], ny = c[1] + d[1], k = nx + ',' + ny;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || visto[k] || !grade[ny][nx]) continue;
      visto[k] = true; fila.push([nx, ny]);
    }
  }
  return visto;
}

// ====================================================================== OS DADOS
(function () {
  check('o calabouço especial existe pelo id, com cinco salas, e NÃO mora em DATA.dungeons',
        !!DG && DG.rooms.length === 5 && !D.dungeons.some((d) => d.id === ID) &&
        D.calabouco(ID) === DG && E.calabouco(ID) === DG && D.calabouco('cistern') === D.dungeons.find((d) => d.id === 'cistern'));
  check('DATA.dungeons continua com os seis portais (o Santuário não vira portal, arena do PvP nem Calabouço do Dia)',
        D.dungeons.filter((d) => d.order).length === 6, String(D.dungeons.length));
  check('nível recomendado no teto e sem chefe, carta nem evento de chão ao acaso',
        DG.recommendedLevel === 30 && Array.isArray(DG.cardDrops) && DG.cardDrops.length === 0 && DG.tileEventRate === 0);
  const regras = DG.rooms.map((r) => r.santuario && r.santuario.regra);
  check('as quatro primeiras salas são um quadrante cada e a quinta é o Altar', regras.join(',') === 'fogo,agua,terra,ar,altar', regras.join(','));

  const ESPERA = { B: '=', b: '=', a: 'chao', p: 'chao', N: '#', S: '#', L: '#', O: '#', V: '#', v: 'chao', r: '=', C: '#', M: '#' };
  const erros = [], regua = [];
  DG.rooms.forEach((room, ri) => {
    const lay = room.layout, mapa = room.santuario.mapa, h = lay.length, w = lay[0].length;
    if (mapa.length !== h || mapa.some((l) => l.length !== w) || lay.some((l) => l.length !== w)) erros.push('sala ' + ri + ': máscara de outro tamanho');
    let interior = 0, obst = 0, baixos = 0, P = [], M = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = lay[y][x], m = (mapa[y] || '')[x] || '.';
      if (m !== '.') {
        const e = ESPERA[m];
        if (!e) erros.push('sala ' + ri + ' (' + x + ',' + y + '): letra desconhecida ' + m);
        else if (e === 'chao' ? !ehChao(c) : c !== e) erros.push('sala ' + ri + ' (' + x + ',' + y + '): ' + m + ' sobre ' + c);
        // nada de mecânica em casa de nascimento: o monstro em cima do soquete seguraria o pilar na rodada 1
        if ((m === 'v' || m === 'V') && (c === 'P' || (c >= 'a' && c <= 'z'))) erros.push('sala ' + ri + ': unidade nasce em cima de um pilar');
      }
      if (c === '=') baixos++;
      if (c === 'P') P.push([x, y]);
      if (c >= 'a' && c <= 'z') M.push([x, y]);
      if (x > 0 && y > 0 && x < w - 1 && y < h - 1) { interior++; if (c === '#' || c === '=') obst++; }
    }
    // a régua dos mapas (a mesma da seção 5 de tests/validate_world.html)
    const dist = P.map((p) => Math.min.apply(null, M.map((m) => md(p[0], p[1], m[0], m[1]))));
    const media = dist.reduce((a, b) => a + b, 0) / dist.length, dens = obst / interior;
    if (!(w >= 21 && w <= 27 && h >= 17 && h <= 23)) regua.push('sala ' + ri + ': tamanho ' + w + '×' + h);
    if (P.length < 4) regua.push('sala ' + ri + ': ' + P.length + ' nascimentos de herói (o grupo pela Rede leva até quatro)');
    if (baixos < 6) regua.push('sala ' + ri + ': só ' + baixos + ' obstáculos baixos');
    if (!(dens >= 0.12 && dens <= 0.30)) regua.push('sala ' + ri + ': densidade ' + (dens * 100).toFixed(1) + '%');
    if (!(media >= 4 && media <= 7) || Math.max.apply(null, dist) > 10) regua.push('sala ' + ri + ': o primeiro monstro a ' + media.toFixed(2) + ' (pior ' + Math.max.apply(null, dist) + ')');
    if (M.length < 4) regua.push('sala ' + ri + ': ' + M.length + ' monstros');
    // a ENTRADA fica fora de toda regra: ninguém nasce no escuro, na água, no vento nem em cima de um soquete
    const p = Sa.leSala(room);
    P.forEach((c) => {
      const k = c[0] + ',' + c[1];
      const dentro = (rets) => rets.some((r) => c[0] >= r[0] && c[1] >= r[1] && c[0] <= r[2] && c[1] <= r[3]);
      if (dentro(p.escuro) || dentro(p.vento) || p.agua[k] || p.pilares.some((q) => q.x === c[0] && q.y === c[1])) erros.push('sala ' + ri + ': nascimento ' + k + ' dentro de uma regra');
    });
  });
  check('a máscara de cada sala tem o tamanho do layout, cada letra está sobre a casa certa e a entrada fica fora de toda regra',
        erros.length === 0, erros.slice(0, 6).join(' | '));
  check('as cinco salas passam na régua dos mapas (tamanho, densidade, obstáculo baixo, o primeiro monstro a 4–7 casas)',
        regua.length === 0, regua.join(' | '));
  const areas = DG.rooms.map((r) => r.layout.length * r.layout[0].length);
  check('o Altar é a maior sala (a arena do fim)', areas[4] >= Math.max.apply(null, areas.slice(0, 4)), areas.join(' · '));

  // os oito guardiões
  const ESPERADO = {
    el_fogo_1: ['fogo', 'ranged'], el_fogo_2: ['fogo', 'melee'], el_agua_1: ['agua', 'melee'], el_agua_2: ['agua', 'ranged'],
    el_terra_1: ['terra', 'melee'], el_terra_2: ['terra', 'melee'], el_ar_1: ['ar', 'ranged'], el_ar_2: ['ar', 'melee']
  };
  const ruins = [];
  Object.keys(ESPERADO).forEach((id) => {
    const m = D.monsters[id];
    if (!m) { ruins.push(id + ' não existe'); return; }
    if (m.element !== ESPERADO[id][0] || m.ai !== ESPERADO[id][1]) ruins.push(id + ': ' + m.element + '/' + m.ai);
    if (m.boss || m.summonOnly || m.colosso || m.dungeonId !== ID) ruins.push(id + ': chefe, invocação ou de outro calabouço');
    if (!m.stoneDrop || !(m.xp > 0)) ruins.push(id + ': sem pedra ou sem XP');
  });
  check('os oito guardiões existem com os ids fixos, o elemento e o papel de cada um; nenhum é chefe', ruins.length === 0, ruins.join(' | '));
  const tr = (id, t) => (D.monsters[id].traits || []).some((x) => x.type === t);
  check('só o Vigia de Pavio enxerga no escuro, e o Pilarete é imune a empurrão',
        tr('el_fogo_1', 'veNoEscuro') && Object.keys(ESPERADO).filter((id) => tr(id, 'veNoEscuro')).length === 1 && tr('el_terra_1', 'pushImmune'));
  // o tanque de cada par é o mais lento e o de mais vida; o de distância alcança de longe
  const alc = (id) => Math.max.apply(null, D.monsters[id].spells.map((s) => D.monsterSpells[s].range.max));
  check('quem é de distância alcança de longe (≥ 5) e quem é tanque tem mais vida e menos passo que o par',
        ['el_fogo_1', 'el_agua_2', 'el_ar_1'].every((id) => alc(id) >= 5) &&
        D.monsters.el_agua_1.stats.hp > D.monsters.el_agua_2.stats.hp && D.monsters.el_agua_1.stats.pp < D.monsters.el_agua_2.stats.pp &&
        D.monsters.el_terra_1.stats.hp > D.monsters.el_terra_2.stats.hp && D.monsters.el_terra_1.stats.pp < D.monsters.el_terra_2.stats.pp);
  const porSala = DG.rooms.map((r) => Object.keys(r.monsters).map((k) => r.monsters[k]).sort().join(','));
  check('cada quadrante tem os dois monstros dele e o Altar tem os oito',
        porSala[0] === 'el_fogo_1,el_fogo_2' && porSala[1] === 'el_agua_1,el_agua_2' && porSala[2] === 'el_terra_1,el_terra_2' &&
        porSala[3] === 'el_ar_1,el_ar_2' && porSala[4].split(',').length === 8, porSala.join(' | '));
  // fora do Poço: lá o Vigia enxergaria um escuro que não existe
  let noPoco = 0;
  if (J.Poco && J.Poco.salaSemeada) {
    for (let andar = 1; andar <= 30; andar++) for (let s = 1; s <= 12; s++) {
      const r = J.Poco.salaSemeada(andar, s * 977);
      Object.keys(r.monsters).forEach((k) => { if (/^el_/.test(r.monsters[k])) noPoco++; });
    }
  }
  check('nenhum guardião do Santuário entra no sorteio do Poço (360 andares semeados)', noPoco === 0, noPoco + ' aparições');
})();

// ====================================================================== FOGO
(function () {
  const party = [heroi('bruxo', 'h1', 'agua'), heroi('arqueiro', 'h2', 'fogo')];
  const st = sala(J, SALA.fogo, party);
  const p = Sa.planta(st), R = Sa.regras;
  const [agua, fogo] = herois(st);
  guardaMonstros(J, st);
  const vigia = monstros(st, 'el_fogo_1')[0], mariposa = monstros(st, 'el_fogo_2')[0];
  const zona = p.escuro[0];
  check('a sala começa com braseiros acesos E apagados, e a entrada tem luz',
        st.santuario.br.some((b) => b === 1) && st.santuario.br.some((b) => b === 0) &&
        herois(st).every((h) => !R.escura(st, h.x, h.y)));
  check('a casa da zona escura longe de todo braseiro aceso é escura; a casa ao pé do braseiro aceso, não',
        R.escura(st, 12, 4) && !R.escura(st, 6, 6) && R.iluminada(st, 6, 6) && !R.escura(st, 3, 9),
        JSON.stringify([R.escura(st, 12, 4), R.escura(st, 6, 6), R.escura(st, 3, 9)]));
  // a casa de prova: escura, ao alcance da luz de um braseiro APAGADO, com um corredor reto de chão a oeste
  let alvo = null, bi = -1;
  p.braseiros.forEach((bz, i) => {
    if (alvo || st.santuario.br[i]) return;
    for (let y = 1; y < st.grid.h - 1 && !alvo; y++) for (let x = 8; x < st.grid.w - 1 && !alvo; x++) {
      if (st.grid.tiles[y][x].type !== 'floor' || st.grid.tiles[y][x + 1].type !== 'floor' ||
          md(bz.x, bz.y, x, y) > CFG.escuro.raio || !E.los(st, bz.x, bz.y, x, y) || !R.escura(st, x, y)) continue;
      let reto = true;
      for (let k = 1; k <= 6; k++) if (!st.grid.tiles[y][x - k] || st.grid.tiles[y][x - k].type !== 'floor') reto = false;
      if (reto) { alvo = { x, y }; bi = i; }
    }
  });
  const b = p.braseiros[bi];
  check('há uma casa escura ao alcance de um braseiro apagado, com corredor reto até ela', !!alvo, JSON.stringify(p.braseiros));
  const perto = { x: alvo.x - CFG.escuro.visao, y: alvo.y }, longe = { x: alvo.x - CFG.escuro.visao - 1, y: alvo.y };
  const naoVe = (u, de) => { poe(u, de.x, de.y); return R.podeMirar(st, u, de.x, de.y, alvo.x, alvo.y); };
  check('quem NÃO é de Fogo mira a casa escura a ' + CFG.escuro.visao + ' casas e não mira a ' + (CFG.escuro.visao + 1),
        naoVe(agua, perto) === true && naoVe(agua, longe) === false);
  check('quem é do caminho do Fogo mira a casa escura de longe', naoVe(fogo, { x: alvo.x - 5, y: alvo.y }) === true);
  check('o Vigia de Pavio mira no escuro de longe; a Mariposa não',
        R.podeMirar(st, vigia, alvo.x + 6, alvo.y, alvo.x, alvo.y) === true && R.podeMirar(st, mariposa, alvo.x + 6, alvo.y, alvo.x, alvo.y) === false);
  // o motor recusa o golpe (e não gasta nada) e aceita o mesmo golpe de perto
  poe(mariposa, alvo.x, alvo.y);
  poe(fogo, 2, 10);
  poe(agua, alvo.x - 4, alvo.y);
  daVez(st, agua);
  const sp = 'bruxo-agua-5';                                // alvo único, alcance 2–5
  const pa0 = agua.pa;
  check('o motor recusa o feitiço na casa escura de longe (sem gastar PA) e a tela ganha a lista das casas que o escuro tira',
        E.cast(st, agua.uid, sp, alvo.x, alvo.y) === false && agua.pa === pa0 &&
        !E.castTargets(st, agua.uid, sp).some((c) => c.x === alvo.x && c.y === alvo.y) &&
        E.casasNoEscuro(st, agua.uid, sp).some((c) => c.x === alvo.x && c.y === alvo.y));
  check('com um herói de Fogo no grupo o monstro no breu aparece para o grupo (um vê por todos), mas quem não é de Fogo segue sem mirar',
        R.ocultoDoLado(st, 'player', mariposa) === false && E.ocultoDe(agua, mariposa, st) === false &&
        R.podeMirar(st, agua, agua.x, agua.y, alvo.x, alvo.y) === false);
  // sem ninguém de Fogo no grupo: o monstro no breu some, e aparece a 2 casas
  (function () {
    const s0 = sala(J, SALA.fogo, [heroi('bruxo', 'h1', 'agua'), heroi('sumo', 'h2', 'terra')]);
    const [a0, t0] = herois(s0);
    guardaMonstros(J, s0);
    const m0 = monstros(s0, 'el_fogo_2')[0];
    poe(m0, alvo.x, alvo.y); poe(a0, alvo.x - 4, alvo.y); poe(t0, 2, 10);
    check('sem ninguém de Fogo, o monstro na casa escura que ninguém vê SOME para o grupo (ocultoDe) — e o grupo nunca some para o monstro',
          E.ocultoDe(a0, m0, s0) === true && R.ocultoDoLado(s0, 'player', m0) === true &&
          E.ocultoDe(m0, a0, s0) === false && R.ocultoDoLado(s0, 'enemy', a0) === false);
    daVez(s0, a0);
    check('o passo do herói atravessa a casa de quem ele não vê e ESBARRA (não entra, e fica sabendo)',
          (function () {
            poe(a0, alvo.x - 3, alvo.y); a0.pp = 6;
            E.events.length = 0;
            const andou = E.move(s0, a0.uid, alvo.x + 1, alvo.y);
            const esb = E.events.some((e) => e.type === 'esbarrou');
            E.events.length = 0;
            return esb && !(a0.x === alvo.x && a0.y === alvo.y) && (andou ? a0.x === alvo.x - 1 : true);
          })());
    poe(a0, alvo.x - CFG.escuro.visao, alvo.y); daVez(s0, a0);
    check('a ' + CFG.escuro.visao + ' casas o monstro aparece e o mesmo feitiço sai',
          E.ocultoDe(a0, m0, s0) === false && E.cast(s0, a0.uid, sp, alvo.x, alvo.y) === true);
  })();

  // o braseiro apagado ao pé da casa de prova
  guardaMonstros(J, st);
  const fogoSp = E.spell('arqueiro-fogo-12'), aguaSp = E.spell('bruxo-agua-5');
  check('o braseiro APAGADO é alvo do golpe de Fogo (que o acende) e não do de Água (que não muda nada)',
        R.alvoFixo(st, fogoSp, b.x, b.y) === true && R.alvoFixo(st, aguaSp, b.x, b.y) === false);
  poe(fogo, b.x - 3, b.y); daVez(st, fogo);
  E.events.length = 0;
  const acendeu = E.cast(st, fogo.uid, 'arqueiro-fogo-12', b.x, b.y);
  const evAc = E.events.filter((e) => e.type === 'santuarioBraseiro');
  check('o golpe de Fogo no braseiro o acende (evento santuarioBraseiro) e a casa escura ao lado dele vira luz',
        acendeu === true && st.santuario.br[bi] === 1 && evAc.length === 1 && evAc[0].aceso === true &&
        !R.escura(st, alvo.x, alvo.y) && R.iluminada(st, alvo.x, alvo.y));
  poe(agua, alvo.x - 5, alvo.y);
  check('na luz do braseiro quem não é de Fogo volta a mirar de longe e o monstro aparece',
        R.podeMirar(st, agua, agua.x, agua.y, alvo.x, alvo.y) === true && E.ocultoDe(agua, mariposa, st) === false);
  check('o braseiro ACESO é alvo do golpe de Água e deixa de ser do de Fogo',
        R.alvoFixo(st, aguaSp, b.x, b.y) === true && R.alvoFixo(st, fogoSp, b.x, b.y) === false);
  poe(agua, b.x - 3, b.y); daVez(st, agua);
  E.events.length = 0;
  const apagou = E.cast(st, agua.uid, 'bruxo-agua-5', b.x, b.y);
  check('o golpe de Água o apaga e o escuro fecha de novo',
        apagou === true && st.santuario.br[bi] === 0 && R.escura(st, alvo.x, alvo.y) &&
        E.events.some((e) => e.type === 'santuarioBraseiro' && e.aceso === false));
  // a área que cobre o braseiro também serve (a explosão de Fogo ao lado dele)
  poe(fogo, b.x - 4, b.y); daVez(st, fogo);
  const centro = [[b.x - 1, b.y], [b.x, b.y - 1], [b.x, b.y + 1], [b.x + 1, b.y]].find((c) => st.grid.tiles[c[1]][c[0]].type === 'floor' &&
    E.validTargetCell(st, fogo, E.spell('arqueiro-fogo-10'), c[0], c[1]));
  const area = centro ? E.cast(st, fogo.uid, 'arqueiro-fogo-10', centro[0], centro[1]) : false;
  check('a ÁREA de Fogo que cobre o braseiro o acende sem precisar mirá-lo', area === true && st.santuario.br[bi] === 1, JSON.stringify(centro));
  // a luz não atravessa parede: a casa a 2 do braseiro aceso, do outro lado de um muro, segue escura
  const stL = sala(J, SALA.fogo, party);
  const pl = Sa.planta(stL);
  let atras = null;
  pl.braseiros.forEach((bz, i) => {
    stL.santuario.br[i] = 1;
  });
  for (let y = 0; y < stL.grid.h && !atras; y++) for (let x = zona[0]; x <= zona[2] && !atras; x++) {
    if (stL.grid.tiles[y][x].type !== 'floor') continue;
    const pertos = pl.braseiros.filter((bz) => md(bz.x, bz.y, x, y) <= CFG.escuro.raio);
    if (pertos.length && pertos.every((bz) => !E.los(stL, bz.x, bz.y, x, y))) atras = { x, y };
  }
  check('a luz do braseiro não atravessa muro: a casa no raio dele mas sem visão dele segue escura',
        !atras || R.escura(stL, atras.x, atras.y) === true, JSON.stringify(atras));
  check('com TODOS os braseiros acesos ainda sobra escuro na Câmara (a luz é poça, não interruptor da sala)',
        (function () { let n = 0; for (let y = 0; y < stL.grid.h; y++) for (let x = 0; x < stL.grid.w; x++) if (stL.grid.tiles[y][x].type === 'floor' && R.escura(stL, x, y)) n++; return n; })() > 20);
})();

// ====================================================================== ÁGUA
(function () {
  const party = [heroi('sumo', 'h1', 'terra'), heroi('curandeiro', 'h2', 'agua')];
  const st = sala(J, SALA.agua, party);
  const p = Sa.planta(st), R = Sa.regras;
  const [seco, daAgua] = herois(st);
  guardaMonstros(J, st);
  const custo = CFG.agua.custo, custoAgua = CFG.agua.custoAgua;
  // uma casa alagada com chão seco a oeste dela e mais água a leste (a margem oeste do tanque)
  let m = null;
  for (let y = 1; y < st.grid.h - 1 && !m; y++) for (let x = 1; x < st.grid.w - 2 && !m; x++) {
    if (R.alagada(st, x, y) && R.alagada(st, x + 1, y) && !R.alagada(st, x - 1, y) && st.grid.tiles[y][x - 1].type === 'floor' &&
        st.grid.tiles[y][x].type === 'floor' && st.grid.tiles[y][x + 1].type === 'floor') m = { x, y };
  }
  check('a Galeria tem água, ponte seca e duas bicas que correm para lados opostos',
        !!m && p.temAgua && Object.keys(p.pontes).length > 0 && p.bicas.length === 2 &&
        VETOR[p.bicas[0].dir][0] === -VETOR[p.bicas[1].dir][0] && VETOR[p.bicas[0].dir][1] === -VETOR[p.bicas[1].dir][1],
        JSON.stringify(p.bicas));
  function alcance(u) { const o = {}; E.reachable(st, u.uid).forEach((c) => { o[c.x + ',' + c.y] = c.cost; }); return o; }
  poe(seco, m.x - 1, m.y); poe(daAgua, 1, 1); daVez(st, seco); seco.pp = 5;
  const a1 = alcance(seco);
  check('entrar na água custa ' + custo + ' PP por casa para quem não é de Água (1 casa = ' + custo + ', 2 casas = ' + (2 * custo) + ')',
        a1[m.x + ',' + m.y] === custo && a1[(m.x + 1) + ',' + m.y] === 2 * custo, JSON.stringify([a1[m.x + ',' + m.y], a1[(m.x + 1) + ',' + m.y]]));
  seco.pp = custo - 1;
  check('com menos PP que o custo a casa alagada nem entra no alcance, e o passo é recusado',
        alcance(seco)[m.x + ',' + m.y] === undefined && E.move(st, seco.uid, m.x, m.y) === false && seco.x === m.x - 1);
  seco.pp = 5;
  check('o passo cobra o custo da água (5 PP − ' + (2 * custo) + ' por duas casas alagadas)',
        E.move(st, seco.uid, m.x + 1, m.y) === true && seco.pp === 5 - 2 * custo, 'sobrou ' + seco.pp);
  poe(seco, 1, 2); poe(daAgua, m.x - 1, m.y); daVez(st, daAgua); daAgua.pp = 5;
  const a2 = alcance(daAgua);
  check('quem é de Água paga ' + custoAgua + ' por casa alagada',
        a2[m.x + ',' + m.y] === custoAgua && a2[(m.x + 1) + ',' + m.y] === 2 * custoAgua);
  // a ponte: seca para todo mundo
  const pk = Object.keys(p.pontes)[0].split(',').map(Number);
  const borda = DIRS.map((d) => [pk[0] + d[0], pk[1] + d[1]]).find((c) => !R.alagada(st, c[0], c[1]) && st.grid.tiles[c[1]][c[0]].type === 'floor');
  const pontes = Object.keys(p.pontes).map((k) => k.split(',').map(Number));
  check('a ponte é seca: não custa a mais e não é casa alagada', pontes.every((c) => !R.alagada(st, c[0], c[1])) &&
        R.custoPasso(st, seco)(pk[0], pk[1]) === 1);
  // o caminho mais barato dá a volta pela ponte em vez de cortar pela água
  let desvio = 0, casos = 0;
  pontes.forEach((c) => {
    // de uma ponta da fileira de pontes à outra: por cima custa o número de casas
    const fila = pontes.filter((q) => q[1] === c[1]).map((q) => q[0]).sort((a, b) => a - b);
    if (c[0] !== fila[0]) return;
    let fim = fila[0]; while (fila.indexOf(fim + 1) >= 0) fim++;
    if (st.grid.tiles[c[1]][fila[0] - 1].type !== 'floor' || st.grid.tiles[c[1]][fim + 1].type !== 'floor') return;
    if (E.unitAt(st, fila[0] - 1, c[1]) || E.unitAt(st, fim + 1, c[1])) return;
    casos++;
    poe(seco, fila[0] - 1, c[1]); daVez(st, seco); seco.pp = 6;
    const cam = E.path(st, seco.uid, fim + 1, c[1]);
    if (cam && cam.every((q) => !R.alagada(st, q.x, q.y)) && cam.length === fim - fila[0] + 2) desvio++;
  });
  check('atravessar pela ponte não paga água (o caminho escolhido não pisa em casa alagada)', casos > 0 && desvio === casos, desvio + '/' + casos);

  // a correnteza
  const st2 = sala(J, SALA.agua, party);
  const [s2, a2h] = herois(st2);
  guardaMonstros(J, st2);
  const car = monstros(st2, 'el_agua_1')[0], gar = monstros(st2, 'el_agua_2')[0];
  const dir1 = Sa.correntezaNa(st2, 1), v1 = VETOR[dir1];
  // quatro unidades na água com casa livre a jusante, uma na ponte, uma em seco
  const livres = [];
  for (let y = 2; y < st2.grid.h - 2; y++) for (let x = 2; x < st2.grid.w - 2; x++) {
    if (R.alagada(st2, x, y) && R.alagada(st2, x + v1[0], y + v1[1]) && st2.grid.tiles[y][x].type === 'floor' &&
        st2.grid.tiles[y + v1[1]][x + v1[0]].type === 'floor' &&
        !livres.some((c) => md(c[0], c[1], x, y) <= 2)) livres.push([x, y]);
  }
  poe(s2, livres[0][0], livres[0][1]); poe(car, livres[1][0], livres[1][1]); poe(gar, livres[2][0], livres[2][1]);
  poe(a2h, pk[0], pk[1]);                                   // na ponte
  const antes = st2.units.map((u) => [u.uid, u.x, u.y]);
  const hp0 = st2.units.map((u) => u.hp).join(',');
  const evs = viraRodada(J, st2);
  const mare = evs.filter((e) => e.type === 'santuarioMare');
  const foi = (u, i) => u.x === livres[i][0] + v1[0] && u.y === livres[i][1] + v1[1];
  check('no FIM da rodada a correnteza leva 1 casa, para onde a bica aponta, quem está na água — herói e monstro, de Água ou não',
        mare.length === 1 && mare[0].dir === dir1 && foi(s2, 0) && foi(car, 1) && foi(gar, 2) && mare[0].movidos.length === 3,
        JSON.stringify([dir1, [s2.x, s2.y], livres[0], mare[0] && mare[0].movidos]));
  check('quem está na ponte ou em seco fica onde está, e a correnteza não fere ninguém',
        a2h.x === pk[0] && a2h.y === pk[1] && st2.units.map((u) => u.hp).join(',') === hp0 &&
        st2.units.filter((u) => u !== s2 && u !== car && u !== gar).every((u) => { const a = antes.find((q) => q[0] === u.uid); return a[1] === u.x && a[2] === u.y; }));
  // a troca da bica
  const dirs = [];
  for (let r = 1; r <= 4 * CFG.agua.trocaACada; r++) dirs.push(Sa.correntezaNa(st2, r));
  const blocos = [];
  for (let i = 0; i < dirs.length; i += CFG.agua.trocaACada) blocos.push(dirs.slice(i, i + CFG.agua.trocaACada));
  check('a bica que verte troca a cada ' + CFG.agua.trocaACada + ' rodadas (e a direção só muda nessa virada)',
        blocos.every((b) => b.every((d) => d === b[0])) && blocos.every((b, i) => i === 0 || b[0] !== blocos[i - 1][0]), dirs.join(''));
  // parede a jusante: fica
  const st3 = sala(J, SALA.agua, party);
  const [s3] = herois(st3);
  guardaMonstros(J, st3);
  const d3 = VETOR[Sa.correntezaNa(st3, 1)];
  let preso = null;
  for (let y = 1; y < st3.grid.h - 1 && !preso; y++) for (let x = 1; x < st3.grid.w - 1 && !preso; x++) {
    if (R.alagada(st3, x, y) && st3.grid.tiles[y][x].type === 'floor' && st3.grid.tiles[y + d3[1]][x + d3[0]].type !== 'floor') preso = [x, y];
  }
  poe(s3, preso[0], preso[1]);
  const hp3 = s3.hp;
  viraRodada(J, st3);
  check('com parede (ou mureta) a jusante a unidade fica na casa e não é ferida: a correnteza desloca, não esmaga',
        s3.x === preso[0] && s3.y === preso[1] && s3.hp === hp3, JSON.stringify(preso));
})();

// ====================================================================== TERRA
(function () {
  const party = [heroi('sumo', 'h1', 'terra'), heroi('arqueiro', 'h2', 'ar')];
  const Jt = novo(), Et = Jt.Engine, St = Jt.Santuario;
  const st = sala(Jt, SALA.terra, party);
  const p = St.planta(st);
  guardaMonstros(Jt, st, (x, y) => p.pilares.some((q) => md(q.x, q.y, x, y) <= 1));
  const periodo = CFG.pilares.periodo;
  const dePe = () => st.santuario.pl.join('');
  const inicial = dePe();
  check('o Salão começa com pilares de pé E baixos, e a casa de cada um diz o que ele é (parede ou chão)',
        /1/.test(inicial) && /0/.test(inicial) &&
        p.pilares.every((q, i) => st.grid.tiles[q.y][q.x].pilar === true && st.grid.tiles[q.y][q.x].type === (st.santuario.pl[i] ? 'wall' : 'floor')));
  // visão e passo: um pilar de pé entre duas casas fecha as duas coisas; baixo, abre
  const iAlto = p.pilares.findIndex((q) => q.alto && st.grid.tiles[q.y][q.x - 1].type === 'floor' && st.grid.tiles[q.y][q.x + 1].type === 'floor' &&
    !p.pilares.some((o) => (o.x === q.x - 1 || o.x === q.x + 1) && o.y === q.y));
  const qa = p.pilares[iAlto];
  check('o pilar de pé fecha a visão e o passo entre as duas casas ao lado dele',
        iAlto >= 0 && Et.los(st, qa.x - 1, qa.y, qa.x + 1, qa.y) === false, JSON.stringify(qa));
  const linha = [];          // [rodada, evento]
  function vira() { const evs = viraRodada(Jt, st); evs.forEach((e) => { if (/^santuario/.test(e.type)) linha.push([st.round, e]); }); return evs; }
  const evs2 = vira();                                      // começa a rodada 2
  const aviso2 = evs2.filter((e) => e.type === 'santuarioAviso' && e.regra === 'terra');
  check('no começo da rodada ' + periodo + ' sai o AVISO da troca (para a rodada ' + (periodo + 1) + '), e nenhum pilar se mexeu ainda',
        st.round === 2 && aviso2.length === 1 && aviso2[0].rodada === periodo + 1 && dePe() === inicial &&
        aviso2[0].sobem.length + aviso2[0].descem.length === p.pilares.length,
        JSON.stringify(aviso2[0] && [aviso2[0].rodada, aviso2[0].sobem.length, aviso2[0].descem.length]));
  const info2 = St.info(st);
  check('a tela sabe quais pilares vão subir e quais vão descer (Santuario.info: `vai`) e em que rodada',
        info2.pilares.aviso === periodo + 1 && info2.pilares.lista.every((q) => q.vai === (q.alto ? 'desce' : 'sobe')));
  const evs3 = vira();                                      // começa a rodada 3: troca
  const troca3 = evs3.filter((e) => e.type === 'santuarioPilares');
  const invertido = inicial.split('').map((c) => (c === '1' ? '0' : '1')).join('');
  check('no começo da rodada ' + (periodo + 1) + ' os pilares TROCAM: o de pé desce, o baixo sobe (as mesmas casas do aviso)',
        st.round === 3 && troca3.length === 1 && dePe() === invertido &&
        JSON.stringify(troca3[0].sobem) === JSON.stringify(aviso2[0].sobem) && JSON.stringify(troca3[0].descem) === JSON.stringify(aviso2[0].descem));
  check('o pilar que desceu abre a visão e o passo; a casa dele volta a ser chão',
        Et.los(st, qa.x - 1, qa.y, qa.x + 1, qa.y) === true && st.grid.tiles[qa.y][qa.x].type === 'floor');
  vira(); vira();                                            // rodada 5: volta
  check('duas rodadas depois eles voltam à posição de antes (o compasso é de ' + periodo + ' rodadas)', st.round === 5 && dePe() === inicial);

  // NUNCA ESMAGA: o herói em cima do soquete segura o pilar
  const Jn = novo(), En = Jn.Engine;
  const sn = sala(Jn, SALA.terra, party);
  const pn = Jn.Santuario.planta(sn);
  guardaMonstros(Jn, sn, (x, y) => pn.pilares.some((q) => md(q.x, q.y, x, y) <= 1));
  const [hn, h2n] = herois(sn);
  const iBaixo = pn.pilares.findIndex((q) => !q.alto);
  const qb = pn.pilares[iBaixo];
  poe(hn, qb.x, qb.y);
  const hpN = hn.hp;
  viraRodada(Jn, sn);                                        // rodada 2 (aviso)
  const evsN = viraRodada(Jn, sn);                           // rodada 3 (troca)
  const trocaN = evsN.find((e) => e.type === 'santuarioPilares');
  check('com alguém em cima do soquete o pilar ESPERA: não sobe, não fere, não desloca — e os outros trocam',
        sn.round === 3 && sn.santuario.pl[iBaixo] === 0 && sn.santuario.es[iBaixo] === 1 && hn.x === qb.x && hn.y === qb.y && hn.hp === hpN &&
        sn.grid.tiles[qb.y][qb.x].type === 'floor' && trocaN && trocaN.esperam.length === 1 && trocaN.sobem.length === pn.pilares.filter((q) => !q.alto).length - 1,
        JSON.stringify(trocaN && [trocaN.sobem.length, trocaN.esperam]));
  // sai de cima: o pilar sobe no começo da rodada seguinte (a casa ao lado é chão comum)
  const viz = DIRS.map((d) => [qb.x + d[0], qb.y + d[1]]).find((c) => sn.grid.tiles[c[1]][c[0]].type === 'floor' && !sn.grid.tiles[c[1]][c[0]].pilar && !En.unitAt(sn, c[0], c[1]));
  poe(hn, viz[0], viz[1]);
  viraRodada(Jn, sn);                                        // rodada 4
  check('quando a casa esvazia o pilar que esperava sobe no começo da rodada seguinte',
        sn.round === 4 && sn.santuario.pl[iBaixo] === 1 && sn.santuario.es[iBaixo] === 0 && sn.grid.tiles[qb.y][qb.x].type === 'wall');
  // monstro também segura; e a armadilha no soquete some debaixo do bloco
  const Jm = novo();
  const sm = sala(Jm, SALA.terra, party);
  const pm = Jm.Santuario.planta(sm);
  guardaMonstros(Jm, sm, (x, y) => pm.pilares.some((q) => md(q.x, q.y, x, y) <= 1));
  const bx = pm.pilares.filter((q) => !q.alto);
  const mm = monstros(sm)[0];
  poe(mm, bx[0].x, bx[0].y);
  sm.traps.push({ x: bx[1].x, y: bx[1].y, side: 'player', spellId: 'x', turns: 9, uid: 'h1' });
  viraRodada(Jm, sm); viraRodada(Jm, sm);
  check('o monstro em cima também segura o pilar, e a armadilha no soquete some debaixo do bloco que sobe',
        sm.santuario.pl[pm.pilares.indexOf(bx[0])] === 0 && sm.santuario.pl[pm.pilares.indexOf(bx[1])] === 1 && sm.traps.length === 0);

  // o caminho sempre existe — as duas posições, e a pior de todas (todos de pé), nas cinco salas
  const quebras = [], semSaida = [];
  let comPilar = 0;
  DG.rooms.forEach((room, ri) => {
    const pp = Sa.leSala(room);
    if (!pp.pilares.length) return;
    comPilar++;
    const h = room.layout.length, w = room.layout[0].length;
    const ehPilar = {};
    pp.pilares.forEach((q) => { ehPilar[q.x + ',' + q.y] = q; });
    const posicoes = Sa.posicoesDosPilares(room).concat([null]);       // null = TODOS de pé
    posicoes.forEach((alto, pi) => {
      const grade = [];
      for (let y = 0; y < h; y++) { grade.push([]); for (let x = 0; x < w; x++) {
        const k = x + ',' + y;
        grade[y].push(ehPilar[k] ? (alto ? !alto[k] : false) : ehChao(room.layout[y][x]));
      } }
      let de = null;
      for (let y = 0; y < h && !de; y++) for (let x = 0; x < w && !de; x++) if (room.layout[y][x] === 'P') de = [x, y];
      const visto = ligado(grade, de);
      let fora = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grade[y][x] && !visto[x + ',' + y]) fora++;
      if (fora) quebras.push('sala ' + ri + ' posição ' + (pi === 2 ? 'todos de pé' : pi) + ': ' + fora + ' casas isoladas');
    });
    pp.pilares.forEach((q) => {
      const temChao = DIRS.some((d) => { const x = q.x + d[0], y = q.y + d[1]; return ehChao(room.layout[y][x]) && !ehPilar[x + ',' + y]; });
      if (!temChao) semSaida.push('sala ' + ri + ' (' + q.x + ',' + q.y + ')');
    });
  });
  check('os pilares NUNCA fecham o único caminho: nas duas posições e com TODOS de pé, todo chão segue ligado a todo chão (' + comPilar + ' salas com pilar)',
        comPilar === 2 && quebras.length === 0, quebras.join(' | '));
  check('todo soquete tem chão comum ao lado: quem está em cima sempre tem para onde sair', semSaida.length === 0, semSaida.join(' | '));
})();

// ====================================================================== AR
(function () {
  const party = [heroi('bruxo', 'h1', 'ar'), heroi('arqueiro', 'h2', 'fogo')];
  const Ja = novo(), Ea = Ja.Engine, S = Ja.Santuario, R = S.regras;
  const st = sala(Ja, SALA.ar, party);
  const p = S.planta(st);
  const [doAr, doFogo] = herois(st);
  const ordem = CFG.vento.ordem, gira = CFG.vento.giraACada;
  const dirs = [];
  for (let r = 1; r <= ordem.length * gira; r++) dirs.push(S.ventoNa(st, r));
  const i0 = ordem.indexOf(p.ventoInicial);
  check('a rajada gira na ordem do dado (' + ordem.join(' → ') + '), uma direção a cada ' + gira + ' rodadas, a partir da inicial',
        dirs.every((d, i) => d === ordem[(i0 + Math.floor(i / gira)) % ordem.length]), dirs.join(''));
  // quem é levado
  const zona = p.vento[0];
  const dir = S.ventoNa(st, 1), v = VETOR[dir];
  const calma = Object.keys(p.calmas).map((k) => k.split(',').map(Number)).find((c) => st.grid.tiles[c[1]][c[0]].type === 'floor');
  const livre = (x, y) => st.grid.tiles[y][x].type === 'floor' && !p.calmas[x + ',' + y];
  const abertas = [];
  for (let y = 2; y < st.grid.h - 2; y++) for (let x = zona[0] + 1; x < st.grid.w - 2; x++) {
    if (livre(x, y) && livre(x + v[0], y + v[1]) && !abertas.some((c) => md(c[0], c[1], x, y) <= 3) && md(x, y, calma[0], calma[1]) > 3) abertas.push([x, y]);
  }
  // os monstros fora da zona (o pórtico da entrada), menos dois
  const ms = monstros(st);
  const portico = [];
  for (let y = 1; y < st.grid.h - 1; y++) for (let x = 1; x < zona[0]; x++) if (st.grid.tiles[y][x].type === 'floor' && !Ea.unitAt(st, x, y)) portico.push([x, y]);
  ms.forEach((m, i) => poe(m, portico[i][0], portico[i][1]));
  const cata = monstros(st, 'el_ar_1')[0], arraia = monstros(st, 'el_ar_2')[0];
  poe(doAr, abertas[0][0], abertas[0][1]); poe(cata, abertas[1][0], abertas[1][1]);
  poe(doFogo, calma[0], calma[1]);
  // dois em fila na direção do vento: os dois andam (o da frente primeiro)
  const fila = abertas.find((c) => livre(c[0] - v[0], c[1] - v[1]) && c !== abertas[0] && c !== abertas[1]);
  poe(arraia, fila[0], fila[1]);
  const outra = monstros(st, 'el_ar_2')[1];
  poe(outra, fila[0] - v[0], fila[1] - v[1]);
  const foraX = portico[portico.length - 1];
  const hp0 = st.units.map((u) => u.hp).join(',');
  const evs = viraRodada(Ja, st);
  const raj = evs.filter((e) => e.type === 'santuarioRajada');
  check('no FIM da rodada a rajada leva 1 casa, na direção do cata-vento, todo mundo que está na zona (herói, monstro, e a fila inteira)',
        raj.length === 1 && raj[0].dir === dir && doAr.x === abertas[0][0] + v[0] && doAr.y === abertas[0][1] + v[1] &&
        cata.x === abertas[1][0] + v[0] && cata.y === abertas[1][1] + v[1] &&
        arraia.x === fila[0] + v[0] && arraia.y === fila[1] + v[1] && outra.x === fila[0] && outra.y === fila[1],
        JSON.stringify([dir, [doAr.x, doAr.y], abertas[0], [arraia.x, arraia.y], [outra.x, outra.y], fila]));
  check('a casa CALMA ao lado do respiro não é soprada, quem está fora da zona (o pórtico) também não, e a rajada não fere',
        doFogo.x === calma[0] && doFogo.y === calma[1] && st.units.map((u) => u.hp).join(',') === hp0 &&
        ms.filter((m) => m !== cata && m !== arraia && m !== outra).every((m, i) => R.noVento(st, m.x, m.y) === false));
  check('cada unidade é levada no máximo UMA casa por fim de rodada', raj[0].movidos.length === 4 &&
        evs.filter((e) => e.type === 'pushed' && e.causa === 'rajada').every((e) => md(e.fromX, e.fromY, e.toX, e.toY) === 1));
  // o imune a empurrão
  const Jp = novo();
  const sp = sala(Jp, SALA.altar, party);
  const pil = monstros(sp, 'el_terra_1')[0], zp = Jp.Santuario.planta(sp).vento[0];
  const livreP = (x, y) => sp.grid.tiles[y][x].type === 'floor' && !Jp.Santuario.planta(sp).calmas[x + ',' + y] && !Jp.Engine.unitAt(sp, x, y);
  const vp = VETOR[Jp.Santuario.ventoNa(sp, 1)];
  let casaP = null;
  for (let y = zp[1] + 1; y < zp[3] && !casaP; y++) for (let x = zp[0] + 1; x < zp[2] && !casaP; x++) if (livreP(x, y) && livreP(x + vp[0], y + vp[1])) casaP = [x, y];
  poe(pil, casaP[0], casaP[1]);
  viraRodada(Jp, sp);
  check('quem é imune a empurrão (o Pilarete) não é levado pela rajada', pil.x === casaP[0] && pil.y === casaP[1]);

  // +1 de alcance do feitiço de Ar, de dentro da zona
  const Jr = novo(), Er = Jr.Engine;
  const sr = sala(Jr, SALA.ar, party);
  const pr = Jr.Santuario.planta(sr);
  const [hr, hf] = herois(sr);
  const arSp = Er.spell('bruxo-ar-5'), fogoSp = Er.spell('arqueiro-fogo-5'), proprio = Er.spell('sumo-ar-12');
  const mais = CFG.vento.alcance;
  // um corredor reto de chão dentro da zona, do tamanho do alcance + 1, e o mesmo no pórtico
  monstros(sr).forEach((m, i) => poe(m, sr.grid.w - 2, 2 + i));
  const alvoM = monstros(sr)[0];
  let cor = null;
  const reto = (x, y, n) => { for (let k = 0; k <= n; k++) if (sr.grid.tiles[y][x + k].type !== 'floor') return false; return true; };
  for (let y = 2; y < sr.grid.h - 2 && !cor; y++) for (let x = pr.vento[0][0]; x + arSp.range.max + mais < sr.grid.w - 3 && !cor; x++) if (reto(x, y, arSp.range.max + mais)) cor = [x, y];
  poe(hr, cor[0], cor[1]); poe(alvoM, cor[0] + arSp.range.max + mais, cor[1]);
  check('de DENTRO da zona do vento o feitiço de Ar alcança ' + mais + ' casa a mais (' + arSp.range.max + ' → ' + (arSp.range.max + mais) + ')',
        Er.alcance(sr, hr, arSp).max === arSp.range.max + mais && Er.validTargetCell(sr, hr, arSp, alvoM.x, alvoM.y) === true &&
        Er.spellRange(sr, hr.uid, 'bruxo-ar-5').some((c) => c.x === alvoM.x && c.y === alvoM.y));
  poe(hf, cor[0], cor[1] + 1 < sr.grid.h && sr.grid.tiles[cor[1] + 1][cor[0]].type === 'floor' ? cor[1] + 1 : cor[1] - 1);
  check('o feitiço que não é de Ar não ganha nada, e o de alcance 0 (em si mesmo) também não',
        Er.alcance(sr, hf, fogoSp).max === fogoSp.range.max && Er.alcance(sr, hr, proprio).max === 0);
  // de fora da zona: o alcance do dado
  let fora = null;
  for (let y = 1; y < sr.grid.h - 1 && !fora; y++) for (let x = 1; x < pr.vento[0][0] && !fora; x++) if (sr.grid.tiles[y][x].type === 'floor' && !Er.unitAt(sr, x, y)) fora = [x, y];
  poe(hr, fora[0], fora[1]);
  check('de FORA da zona (o pórtico) o feitiço de Ar tem o alcance do dado', Er.alcance(sr, hr, arSp).max === arSp.range.max && Jr.Santuario.regras.noVento(sr, hr.x, hr.y) === false);
  // o Cata-Vento também ganha (a regra é do mapa, não do lado)
  const cv = monstros(sr, 'el_ar_1')[0], sopro = Er.spell('m-catavento-sopro');
  poe(cv, cor[0], cor[1]);
  check('a regra vale para os dois lados: o sopro do Cata-Vento também alcança ' + mais + ' a mais no terraço',
        Er.alcance(sr, cv, sopro).max === sopro.range.max + mais);
})();

// ====================================================================== O ALTAR
(function () {
  const Jq = novo(), S = Jq.Santuario, R = S.regras;
  const party = [heroi('sumo', 'h1', 'terra'), heroi('curandeiro', 'h2', 'agua')];
  const st = sala(Jq, SALA.altar, party);
  const p = S.planta(st), q = p.quadrantes;
  const info = S.info(st);
  check('o Altar tem as quatro regras de uma vez (escuro, água, pilares e vento) e o altar no meio',
        info.regras.join(',') === 'fogo,agua,terra,ar' && !!info.escuro && !!info.agua && !!info.pilares && !!info.vento && info.altar.length === 9);
  const dentro = (r, x, y) => x >= r[0] && y >= r[1] && x <= r[2] && y <= r[3];
  let erros = [];
  for (let y = 0; y < st.grid.h; y++) for (let x = 0; x < st.grid.w; x++) {
    if (st.grid.tiles[y][x].type !== 'floor') continue;
    const quad = S.quadranteDe(DG.rooms[SALA.altar], x, y);
    if (p.escuro.some((r) => dentro(r, x, y)) && quad !== 'fogo') erros.push('escuro fora do Fogo em ' + x + ',' + y);
    if (R.alagada(st, x, y) && quad !== 'agua') erros.push('água fora da Água em ' + x + ',' + y);
    if (R.noVento(st, x, y) && quad !== 'ar') erros.push('vento fora do Ar em ' + x + ',' + y);
  }
  p.pilares.forEach((pl) => { if (S.quadranteDe(DG.rooms[SALA.altar], pl.x, pl.y) !== 'terra') erros.push('pilar fora da Terra'); });
  check('cada regra mora no canto dela: o escuro só no quadrante do Fogo, a água no da Água, os pilares no da Terra, o vento no do Ar',
        erros.length === 0 && Object.keys(q).length === 4, erros.slice(0, 4).join(' | '));
  // os quadrantes não se pisam e o cruzeiro do meio é livre de regra
  const ks = Object.keys(q);
  let sobrepoe = 0;
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const a = q[ks[i]], b = q[ks[j]];
    if (a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]) sobrepoe++;
  }
  check('os quatro quadrantes não se sobrepõem', sobrepoe === 0);
})();

// ====================================================================== NADA SORTEIA
(function () {
  const party = [heroi('sumo', 'h1', 'terra'), heroi('curandeiro', 'h2', 'agua')];
  // a mesma sala em dois estados: num o grupo está na água e no vento (é levado), no outro não. Só passar a
  // vez não gasta sorteio — se a regra gastasse, o rng dos dois divergiria
  let iguais = 0, casos = 0;
  [SALA.agua, SALA.ar, SALA.terra, SALA.altar].forEach((ri) => {
    const Ja = novo(), Jb = novo();
    const a = sala(Ja, ri, party, 99), b = sala(Jb, ri, party, 99);
    const pa = Ja.Santuario.planta(a);
    // em `a`, os heróis vão para casas de regra (água/vento/soquete baixo)
    const alvos = [];
    for (let y = 1; y < a.grid.h - 1; y++) for (let x = 1; x < a.grid.w - 1; x++) {
      if (a.grid.tiles[y][x].type !== 'floor' || Ja.Engine.unitAt(a, x, y)) continue;
      if (pa.agua[x + ',' + y] || Ja.Santuario.regras.noVento(a, x, y) || pa.pilares.some((q) => q.x === x && q.y === y)) alvos.push([x, y]);
    }
    herois(a).forEach((h, i) => poe(h, alvos[i * 7][0], alvos[i * 7][1]));
    for (let r = 0; r < 5; r++) { viraRodada(Ja, a); viraRodada(Jb, b); }
    casos++;
    if (a._rng === b._rng && a.round === 6 && b.round === 6) iguais++;
  });
  check('a regra do Santuário não gasta o sorteio da sala: cinco rodadas com e sem gente levada deixam o rng igual (' + casos + ' salas)',
        iguais === casos, iguais + '/' + casos);
  // a foto guarda o que muda
  const Jf = novo(), Ef = Jf.Engine;
  const f = sala(Jf, SALA.altar, party, 5);
  viraRodada(Jf, f); viraRodada(Jf, f);
  f.santuario.br[0] = 1;
  const h0 = Ef.hash(f);
  const volta = Ef.restaura(JSON.parse(JSON.stringify(Ef.foto(f))));
  const pf = Jf.Santuario.planta(f);
  check('a foto da batalha guarda braseiros, pilares e a marca da casa do pilar: restaurada, o hash é o mesmo',
        !!volta && Ef.hash(volta) === h0 && JSON.stringify(volta.santuario) === JSON.stringify(f.santuario) &&
        pf.pilares.every((q) => volta.grid.tiles[q.y][q.x].pilar === true && volta.grid.tiles[q.y][q.x].type === f.grid.tiles[q.y][q.x].type));
  const h1 = Ef.hash(f);
  f.santuario.pl[0] = f.santuario.pl[0] ? 0 : 1;
  check('o hash muda quando um pilar muda (o juiz confere o mapa, não só as unidades)', Ef.hash(f) !== h1);
})();

// ====================================================================== PARTIDAS INTEIRAS
/* Uma sala inteira jogada pela IA dos dois lados, anotando os lances do grupo como o cliente anota e os
 * eventos do Santuário com a rodada em que saíram. `quieto`: 'grupo' ou 'monstros' só passam a vez. */
function joga(Jx, ri, seed, party, quieto, dificuldade) {
  const Ex = Jx.Engine;
  Ex.events.length = 0;
  const st = Ex.createBattle(ID, ri, JSON.parse(JSON.stringify(party)), { seed, escolhePosicao: true, dificuldade: dificuldade || 'normal' });
  const lances = [];
  const log = [];
  let recusas = 0, planos = 0;
  const RS = Jx.Santuario.regras;
  drena();                                 // o anúncio da rodada 1 sai na MONTAGEM da sala, antes da colocação
  const op = Ex.placementOptions(st)[0];
  lances.push({ a: 'p', x: op.x, y: op.y, ok: !!Ex.place(st, op.x, op.y) });
  function drena() {
    for (const ev of Ex.events) if (/^santuario/.test(ev.type) || (ev.type === 'pushed' && ev.causa)) log.push({ ev, rodada: st.round });
    Ex.events.length = 0;
  }
  drena();
  let voltas = 0;
  while (st.phase === 'playing' && voltas++ < 4000) {
    const u = Ex.activeUnit(st);
    if (!u) break;
    const meu = u.side === 'player' && (u.kind === 'hero' || u.kind === 'fusion');
    const parado = (quieto === 'grupo' && u.side === 'player') || (quieto === 'monstros' && u.side === 'enemy');
    const plano = parado ? [] : (Jx.AI.planTurn(st, u.uid) || []);
    let acabou = false, comoPlanejado = true;
    for (const a of (plano.length ? plano : [{ action: 'end' }])) {
      if (st.phase !== 'playing') break;
      if (a.action === 'move') {
        const ok = !!Ex.move(st, u.uid, a.x, a.y);
        // a fixação que falha ou o esbarrão deixam a unidade fora da casa planejada: o resto do plano não conta
        if (!ok || u.x !== a.x || u.y !== a.y) comoPlanejado = false;
        if (meu) lances.push({ a: 'm', u: u.uid, x: a.x, y: a.y, ok });
      }
      else if (a.action === 'cast') {
        // o golpe planejado, da casa planejada, é um que a REGRA DO SANTUÁRIO deixa: a casa escura só de
        // perto, e o alcance com o +1 do vento só para o Ar e só de dentro da zona
        if (comoPlanejado && u.alive) {
          planos++;
          const sp = Ex.spell(a.spellId), rg = Ex.alcance(st, u, sp), dd = md(u.x, u.y, a.x, a.y);
          if (!RS.podeMirar(st, u, u.x, u.y, a.x, a.y) || dd > rg.max) recusas++;
        }
        const ux = u.x, uy = u.y;
        const ok = !!Ex.cast(st, u.uid, a.spellId, a.x, a.y);
        // o golpe que tira quem lança do lugar (salto, troca, investida) muda de onde saem os seguintes
        if (u.x !== ux || u.y !== uy) comoPlanejado = false;
        if (meu) lances.push({ a: 'c', u: u.uid, s: a.spellId, x: a.x, y: a.y, ok });
      } else if (a.action === 'end') { Ex.endTurn(st); if (meu) lances.push({ a: 'e', ok: true }); acabou = true; break; }
      drena();
    }
    if (!acabou && st.phase === 'playing') { Ex.endTurn(st); if (meu) lances.push({ a: 'e', ok: true }); }
    drena();
  }
  return { st, lances, log, hash: Ex.hash(st), recusas, planos, voltas };
}

const DUPLAS = [
  [heroi('sumo', 'h1', 'terra'), heroi('curandeiro', 'h2', 'agua')],
  [heroi('arqueiro', 'h1', 'ar'), heroi('bruxo', 'h2', 'fogo')],
  [heroi('espadachim', 'h1', 'agua'), heroi('minotauro', 'h2', 'terra')]
];

// ---- o aviso antes do efeito, em partidas de verdade
(function () {
  let trocas = 0, semAviso = [], mares = 0, rajadas = 0, erradas = [], viradas = 0, semVirada = [], recusas = 0, planos = 0, partidas = 0;
  for (let ri = 0; ri < 5; ri++) for (let d = 0; d < DUPLAS.length; d++) for (const seed of [3, 41]) {
    const r = joga(novo(), ri, seed + ri * 13 + d, DUPLAS[d]);
    partidas++;
    recusas += r.recusas; planos += r.planos;
    const avisos = {}, anuncio = { correnteza: {}, vento: {} };
    for (const l of r.log) {
      const ev = l.ev;
      if (ev.type === 'santuarioAviso') avisos[ev.rodada] = { naRodada: l.rodada, sobem: ev.sobem, descem: ev.descem };
      if (ev.type === 'santuarioCorrenteza') anuncio.correnteza[ev.rodada] = ev;
      if (ev.type === 'santuarioVento') anuncio.vento[ev.rodada] = ev;
      if (ev.type === 'santuarioPilares' && (ev.sobem.length || ev.descem.length)) {
        trocas++;
        // a troca do relógio (rodada ímpar) tem de ter sido avisada na rodada anterior; o pilar que esperava
        // e sobe numa rodada qualquer já tinha sido avisado na troca dele
        const av = avisos[ev.rodada];
        const doRelogio = ev.rodada % CFG.pilares.periodo === 1;
        if (doRelogio) {
          if (!av || av.naRodada !== ev.rodada - 1) semAviso.push('sala ' + ri + ' r' + ev.rodada);
          else {
            const avisadas = new Set(av.sobem.concat(av.descem).map((c) => c.x + ',' + c.y));
            if (!ev.sobem.concat(ev.descem).every((c) => avisadas.has(c.x + ',' + c.y))) semAviso.push('sala ' + ri + ' r' + ev.rodada + ' casa fora do aviso');
          }
        }
      }
      if (ev.type === 'santuarioMare' || ev.type === 'santuarioRajada') {
        const tipo = ev.type === 'santuarioMare' ? 'correnteza' : 'vento';
        if (tipo === 'correnteza') mares++; else rajadas++;
        const an = anuncio[tipo][ev.rodada];
        if (!an || an.dir !== ev.dir) erradas.push('sala ' + ri + ' ' + tipo + ' r' + ev.rodada);
        // a virada: se a direção desta rodada não é a da anterior, a anterior avisou (`proxima`)
        const ant = anuncio[tipo][ev.rodada - 1];
        if (ant && ant.dir !== ev.dir) { viradas++; if (ant.proxima !== ev.dir) semVirada.push('sala ' + ri + ' ' + tipo + ' r' + ev.rodada); }
      }
    }
  }
  check('toda troca de pilar do relógio teve AVISO na rodada anterior, com as mesmas casas (' + trocas + ' trocas em ' + partidas + ' partidas)',
        trocas > 10 && semAviso.length === 0, semAviso.slice(0, 5).join(' | '));
  check('toda correnteza e toda rajada foi para onde o começo da MESMA rodada disse (' + mares + ' correntezas, ' + rajadas + ' rajadas)',
        mares > 20 && rajadas > 20 && erradas.length === 0, erradas.slice(0, 5).join(' | '));
  check('toda virada de direção foi anunciada UMA RODADA ANTES (' + viradas + ' viradas)', viradas > 10 && semVirada.length === 0, semVirada.slice(0, 5).join(' | '));
  check('a IA dos dois lados nunca planeja um golpe que o motor recusa — nem na casa escura, nem fora do alcance do vento (' + planos + ' golpes)',
        planos > 300 && recusas === 0, recusas + ' recusados');
})();

// ---- a IA não fica presa
(function () {
  let chegaram = 0, casos = 0, lentos = [];
  for (let ri = 0; ri < 5; ri++) for (const seed of [5, 17]) {
    casos++;
    const r = joga(novo(), ri, seed, DUPLAS[0], 'grupo');
    if (r.st.phase === 'lost' && r.st.round <= 25) chegaram++;
    else lentos.push('sala ' + ri + ' semente ' + seed + ': ' + r.st.phase + ' na rodada ' + r.st.round);
  }
  check('com o grupo parado na entrada, os monstros atravessam a sala (água, pilares, vento, escuro) e vencem em até 25 rodadas (' + casos + ' partidas)',
        chegaram === casos, lentos.join(' | '));
  let venceram = 0, casos2 = 0, presos = [];
  // (a dupla de tanque e curandeiro fica de fora: ela vence devagar demais para o teto de 40 rodadas do Altar)
  const CACADORES = [DUPLAS[1], DUPLAS[2], [heroi('arqueiro', 'h1', 'agua'), heroi('bruxo', 'h2', 'terra')]];
  for (let ri = 0; ri < 5; ri++) for (let d = 0; d < CACADORES.length; d++) {
    casos2++;
    const r = joga(novo(), ri, 23 + d, CACADORES[d], 'monstros', 'facil');
    if (r.st.phase === 'won') venceram++;
    else presos.push('sala ' + ri + ' dupla ' + d + ': ' + r.st.phase + ' na rodada ' + r.st.round +
      ' (' + r.st.units.filter((u) => u.side === 'enemy' && u.alive).length + ' monstros vivos)');
  }
  check('com os monstros parados, o grupo conduzido pela IA acha e derruba todos — nenhum fica escondido para sempre no escuro (' + casos2 + ' partidas)',
        venceram === casos2, presos.join(' | '));
  // o monstro lento não fica indo e voltando no vão do pilar: a rota é medida com os pilares de pé
  const Jl = novo();
  const st = Jl.Engine.createBattle(ID, SALA.terra, JSON.parse(JSON.stringify(DUPLAS[0])), { seed: 9, escolhePosicao: false });
  st.phase = 'playing';
  const pil = st.units.filter((u) => u.defId === 'el_terra_1');
  const alvo = st.units.find((u) => u.kind === 'hero');
  const dist0 = pil.map((u) => md(u.x, u.y, alvo.x, alvo.y));
  let voltas = 0, recuos = 0;
  const ultima = pil.map((u) => md(u.x, u.y, alvo.x, alvo.y));
  while (st.phase === 'playing' && st.round <= 8 && voltas++ < 400) {
    const u = Jl.Engine.activeUnit(st);
    if (!u) break;
    if (u.side === 'enemy') {
      for (const a of (Jl.AI.planTurn(st, u.uid) || [])) {
        if (st.phase !== 'playing') break;
        if (a.action === 'move') Jl.Engine.move(st, u.uid, a.x, a.y);
        else if (a.action === 'cast') Jl.Engine.cast(st, u.uid, a.spellId, a.x, a.y);
      }
      const i = pil.indexOf(u);
      if (i >= 0 && u.alive) { const dAg = md(u.x, u.y, alvo.x, alvo.y); if (dAg > ultima[i] + 1) recuos++; ultima[i] = dAg; }
    }
    if (st.phase === 'playing') Jl.Engine.endTurn(st);
    Jl.Engine.events.length = 0;
  }
  check('o tanque lento (o Pilarete, 2 PP) avança rodada a rodada até o grupo sem recuar por causa de um vão que fechou',
        recuos === 0 && pil.every((u, i) => !u.alive || md(u.x, u.y, alvo.x, alvo.y) < dist0[i]), recuos + ' recuos · ' + JSON.stringify([dist0, ultima]));

  /* A ROTA NÃO DEPENDE DE ONDE OS PILARES ESTÃO AGORA. O vão que abre e fecha a cada 2 rodadas não é
   * caminho com que se conte: se a IA medisse a rota pelo vão aberto, o monstro lento andaria até ele,
   * o acharia fechado e voltaria para o outro — para sempre. A mesma sala nas DUAS posições dos pilares,
   * o mesmo monstro e o mesmo alvo: o passo planejado tem de ser o mesmo (fora de quando há um pilar ao
   * alcance do passo desta vez — aí o baixo é atalho de verdade, e o plano pode mudar). */
  const Ja = novo(), Jb = novo();
  const a = Ja.Engine.createBattle(ID, SALA.terra, JSON.parse(JSON.stringify(DUPLAS[0])), { seed: 9, escolhePosicao: false });
  const b = Jb.Engine.createBattle(ID, SALA.terra, JSON.parse(JSON.stringify(DUPLAS[0])), { seed: 9, escolhePosicao: false });
  a.phase = b.phase = 'playing';
  const pb = Jb.Santuario.planta(b);
  pb.pilares.forEach((q, i) => {                              // `b` é `a` com todos os pilares virados
    b.santuario.pl[i] = b.santuario.pl[i] ? 0 : 1;
    b.grid.tiles[q.y][q.x].type = b.santuario.pl[i] ? 'wall' : 'floor';
  });
  const prepara = (Jx, sx) => {
    const m = sx.units.find((u) => u.defId === 'el_terra_1');
    sx.units.filter((u) => u.side === 'enemy' && u !== m).forEach((u) => { u.alive = false; u.offBoard = true; });
    sx.units.filter((u) => u.kind === 'hero').forEach((u, i) => { if (i) { u.alive = false; u.offBoard = true; } });
    sx.activeIdx = sx.order.indexOf(m.uid);
    return { m, h: sx.units.find((u) => u.kind === 'hero') };
  };
  const ua = prepara(Ja, a), ub = prepara(Jb, b);
  let casosR = 0, difsR = [];
  const chaoComum = (x, y) => DG.rooms[SALA.terra].layout[y] && ehChao(DG.rooms[SALA.terra].layout[y][x]) && !pb.pilares.some((q) => q.x === x && q.y === y);
  for (const alvoH of [[2, 3], [22, 3], [2, 17], [22, 17], [12, 10]]) {
    for (let y = 2; y < a.grid.h - 2; y += 2) for (let x = 2; x < a.grid.w - 2; x += 3) {
      if (!chaoComum(x, y) || (x === alvoH[0] && y === alvoH[1]) || md(x, y, alvoH[0], alvoH[1]) < 6) continue;
      if (pb.pilares.some((q) => md(q.x, q.y, x, y) <= ua.m.pp + 1)) continue;          // pilar ao alcance do passo: fora
      casosR++;
      [[ua, a], [ub, b]].forEach(([u, sx]) => { poe(u.m, x, y); poe(u.h, alvoH[0], alvoH[1]); u.m.pp = 2; u.m.pa = 5; u.m.cooldowns = {}; u.m.castsThisTurn = {}; });
      const pa = JSON.stringify(Ja.AI.planTurn(a, ua.m.uid)), pbn = JSON.stringify(Jb.AI.planTurn(b, ub.m.uid));
      if (pa !== pbn) difsR.push('(' + x + ',' + y + ')→(' + alvoH + '): ' + pa.slice(0, 40) + ' ≠ ' + pbn.slice(0, 40));
    }
  }
  check('a rota da IA não depende da posição dos pilares de AGORA: o mesmo passo com eles de pé e virados (' + casosR + ' casos)',
        casosR > 40 && difsR.length === 0, difsR.length + ' diferentes · ' + difsR.slice(0, 3).join(' | '));
})();

// ---- o determinismo e o juiz
(function () {
  let iguais = 0, casos = 0, difs = [];
  for (let ri = 0; ri < 5; ri++) {
    casos++;
    const a = joga(novo(), ri, 77 + ri, DUPLAS[ri % DUPLAS.length]);
    const b = joga(novo(), ri, 77 + ri, DUPLAS[ri % DUPLAS.length]);
    const c = joga(novo(), ri, 78 + ri, DUPLAS[ri % DUPLAS.length]);
    if (a.hash === b.hash && JSON.stringify(a.lances) === JSON.stringify(b.lances) && a.hash !== c.hash) iguais++;
    else difs.push('sala ' + ri);
  }
  check('a mesma semente dá a MESMA partida em dois mundos (lances e hash), e outra semente dá outra (' + casos + ' salas)', iguais === casos, difs.join(' | '));

  let refeitos = 0, bate = 0, erros = [], forjado = 0, mentido = 0;
  for (let ri = 0; ri < 5; ri++) for (let d = 0; d < DUPLAS.length; d++) {
    const party = DUPLAS[d], seed = 500 + ri * 7 + d;
    const r = joga(novo(), ri, seed, party);
    refeitos++;
    const pedido = { dungeonId: ID, roomIndex: ri, semente: seed, party: JSON.parse(JSON.stringify(party)),
                     lances: r.lances, hashFinal: r.hash, regras: E.VERSAO_REGRAS };
    try {
      const out = refaz(pedido);
      if (out.ok && out.hash === r.hash && out.fase === r.st.phase) bate++;
      else erros.push('sala ' + ri + ' dupla ' + d + ': ' + out.fase + '/' + r.st.phase);
    } catch (e) { erros.push('sala ' + ri + ' dupla ' + d + ': ' + (e.motivo || '') + ' ' + e.message); }
    if (d === 0) {
      try { refaz(Object.assign({}, pedido, { hashFinal: (r.hash + 1) | 0 })); } catch (e) { if (e.motivo === 'divergiu') forjado++; }
      // o lance mentido: um passo recusado anotado como aceito (o cliente que atravessa a água sem pagar)
      const i = r.lances.findIndex((l) => l.a === 'm' && l.ok === false);
      const j = i >= 0 ? i : r.lances.findIndex((l) => l.a === 'c' && l.ok === false);
      if (j >= 0) {
        const lm = r.lances.map((l, k) => (k === j ? Object.assign({}, l, { ok: true }) : l));
        try { refaz(Object.assign({}, pedido, { lances: lm })); } catch (e) { if (e.motivo === 'divergiu') mentido++; }
      } else mentido++;
    }
  }
  check('o juiz refaz as cinco salas com os lances do cliente e chega ao MESMO hash e ao mesmo fim (' + bate + '/' + refeitos + ')',
        bate === refeitos, erros.slice(0, 4).join(' | '));
  check('o hash do fim forjado cai como divergiu nas cinco salas', forjado === 5, forjado + '/5');
  check('o lance recusado anotado como aceito cai como divergiu', mentido === 5, mentido + '/5');

  // o lance que só existe SEM a regra: mirar a casa escura de longe. O juiz recusa como o motor do cliente.
  const Jz = novo(), Ez = Jz.Engine;
  const party = [heroi('bruxo', 'h1', 'agua')];
  const st = Ez.createBattle(ID, SALA.fogo, JSON.parse(JSON.stringify(party)), { seed: 31, escolhePosicao: true });
  const op = Ez.placementOptions(st)[0];
  const lances = [{ a: 'p', x: op.x, y: op.y, ok: !!Ez.place(st, op.x, op.y) }];
  // joga até a vez do herói e tenta o golpe numa casa escura fora do alcance de 2
  let g = 0;
  while (st.phase === 'playing' && g++ < 50) {
    const u = Ez.activeUnit(st);
    if (u.kind === 'hero') break;
    for (const a of (Jz.AI.planTurn(st, u.uid) || [])) {
      if (a.action === 'move') Ez.move(st, u.uid, a.x, a.y); else if (a.action === 'cast') Ez.cast(st, u.uid, a.spellId, a.x, a.y);
    }
    if (st.phase === 'playing') Ez.endTurn(st);
  }
  const h = Ez.activeUnit(st);
  let escura = null;
  for (let y = 1; y < st.grid.h - 1 && !escura; y++) for (let x = 1; x < st.grid.w - 1 && !escura; x++) {
    const dd = md(h.x, h.y, x, y);
    if (st.grid.tiles[y][x].type === 'floor' && Jz.Santuario.regras.escura(st, x, y) && dd >= 3 && dd <= 6 && Ez.los(st, h.x, h.y, x, y)) escura = { x, y };
  }
  const ok = escura ? Ez.cast(st, h.uid, 'bruxo-neutro-2', escura.x, escura.y) : null;      // área: mira o chão
  lances.push({ a: 'c', u: h.uid, s: 'bruxo-neutro-2', x: escura ? escura.x : 0, y: escura ? escura.y : 0, ok: true });   // o cliente MENTE
  let motivo = null;
  try { refaz({ dungeonId: ID, roomIndex: SALA.fogo, semente: 31, party, lances, regras: Ez.VERSAO_REGRAS }); } catch (e) { motivo = e.motivo; }
  check('mirar a casa escura de longe é recusado no cliente E no juiz: o lance anotado como aceito cai como divergiu',
        ok === false && motivo === 'divergiu', JSON.stringify([escura, ok, motivo]));
})();

// ====================================================================== O SAQUE E A PAGA
(function () {
  const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
  const { fecha } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'recompensa.js'));
  const { ehDoJogador } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));
  const AGORA = Date.UTC(2026, 9, 3, 15, 0, 0);
  const w = est.mundoEconomico({ agoraMs: AGORA, semente: 1 });
  est.poeEstado(w, null, null);
  const Jw = w.J, P = Jw.Progress, Dw = Jw.DATA;
  const esp = Dw.especial(ID), FONTE = esp.saqueDe;
  const ult = Dw.calabouco(FONTE).rooms.length - 1;
  const chave = (info) => JSON.stringify(info.itens.map((e) => [e.id, Math.round(e.w * 1e6), e.vazado]).sort());
  const raras = (info) => info.itens.filter((e) => /^(epico|lendario)$/.test(Dw.items[e.id].rarity)).length;
  let comuns = 0, semRaro = 0;
  for (let r = 0; r < 4; r++) for (const n of [1, 2]) {
    const meu = P.lootPoolInfo(ID, r, n);
    if (chave(meu) === chave(P.lootPoolInfo(FONTE, ult - 1, n)) && meu.itens.length > 0) comuns++;
    if (raras(meu) === 0) semRaro++;
  }
  check('as quatro salas de quadrante sorteiam as peças da última sala COMUM do Coração Partido (sozinho e em dupla)', comuns === 8, comuns + '/8');
  check('nenhuma peça épica nem lendária cai antes do Altar', semRaro === 8, semRaro + '/8');
  const altar = P.lootPoolInfo(ID, 4, 1), chefe = P.lootPoolInfo(FONTE, ult, 1);
  check('o Altar sorteia como a sala do chefe do Coração Partido — com as épicas e as lendárias de lá',
        chave(altar) === chave(chefe) && raras(altar) > 0 && raras(altar) === raras(chefe), raras(altar) + ' raras de ' + altar.itens.length);
  check('toda peça da piscina é do Coração Partido ou vazada de um portal fechado, nunca "do Santuário"',
        altar.itens.every((e) => e.vazado || Dw.items[e.id].dungeonId === FONTE) && !Object.keys(Dw.items).some((k) => Dw.items[k].dungeonId === ID));
  // sem chefe: carta de classe e de bicho nunca, nem no Altar (que conta como sala de chefe para a PEÇA)
  let cartas = 0, bichos = 0;
  for (let i = 0; i < 300; i++) { cartas += P.rollCards(ID, 4, 1).length; bichos += P.rollPetCards(ID, 4, 1).length; }
  check('em 300 Altares vencidos: nenhuma carta de classe e nenhuma carta de bicho', cartas === 0 && bichos === 0, cartas + ' / ' + bichos);
  check('o XP do Santuário não é cortado para o herói do teto (e é para ninguém: é o calabouço de nível mais alto)',
        P.xpMultiplier(30, ID) === 1 && P.xpMultiplier(1, ID) === 1);
  // o sorteio de verdade: 400 salas comuns e 400 Altares. A sala comum dá no máximo 1 peça e nunca rara; o
  // Altar dá até 2, e em 400 sai pelo menos uma épica ou lendária (dois sorteios por descida)
  const saco = () => { P.state.inventory.length = 0; };
  let maxComum = 0, raraComum = 0, maxAltar = 0, raraAltar = 0;
  for (let i = 0; i < 400; i++) {
    saco(); const a = P.rollDrops(ID, i % 4, 1, 1);
    maxComum = Math.max(maxComum, a.length); raraComum += a.filter((id) => /^(epico|lendario)$/.test(Dw.items[id].rarity)).length;
    saco(); const b = P.rollDrops(ID, 4, 1, 1);
    maxAltar = Math.max(maxAltar, b.length); raraAltar += b.filter((id) => /^(epico|lendario)$/.test(Dw.items[id].rarity)).length;
  }
  saco();
  check('sorteado 400 vezes: a sala de quadrante dá 1 peça no máximo e nunca rara demais; o Altar dá até 2 e solta épica ou lendária',
        maxComum === 1 && raraComum === 0 && maxAltar === 2 && raraAltar > 0, JSON.stringify({ maxComum, raraComum, maxAltar, raraAltar }));

  // a paga inteira, pelo juiz: a dupla do teto vence a Câmara Apagada (fácil) e o servidor paga o que o funil manda
  const conta = (function () {
    const w2 = est.mundoEconomico({ agoraMs: AGORA, semente: 1 });
    est.poeEstado(w2, null, null);
    const tab = w2.J.DATA.leveling.xpTable;
    [['sumo', 'terra'], ['curandeiro', 'agua']].forEach(([h, el]) => {
      const x = w2.J.Progress.state.heroes[h]; x.level = 30; x.xp = tab[29]; x.element = el;
    });
    return est.tiraEstado(w2);
  })();
  const wc = est.mundoEconomico({ agoraMs: AGORA, semente: 7, fatores: {}, guilda: {} });
  est.poeEstado(wc, conta.progress, conta.db);
  const Jc = wc.J, Ec = Jc.Engine;
  const st = Ec.createBattle(ID, 0, Jc.Progress.battleParty(['sumo', 'curandeiro']), { seed: 1, dificuldade: 'facil', escolhePosicao: true });
  const op = Ec.placementOptions(st)[0];
  const lances = [{ a: 'p', x: op.x, y: op.y, ok: !!Ec.place(st, op.x, op.y) }];
  for (let g = 0; st.phase === 'playing' && g < 3000; g++) {
    const u = Ec.activeUnit(st); if (!u) break;
    const meu = ehDoJogador(st, u); let acabou = false;
    const plano = Jc.AI.planTurn(st, u.uid) || [];
    for (const a of (plano.length ? plano : [{ action: 'end' }])) {
      if (st.phase !== 'playing') break;
      if (a.action === 'move') { const ok = !!Ec.move(st, u.uid, a.x, a.y); if (meu) lances.push({ a: 'm', u: u.uid, x: a.x, y: a.y, ok }); }
      else if (a.action === 'cast') { const ok = !!Ec.cast(st, u.uid, a.spellId, a.x, a.y); if (meu) lances.push({ a: 'c', u: u.uid, s: a.spellId, x: a.x, y: a.y, ok }); }
      else if (a.action === 'end') { Ec.endTurn(st); if (meu) lances.push({ a: 'e', ok: true }); acabou = true; break; }
    }
    if (!acabou && st.phase === 'playing') { Ec.endTurn(st); if (meu) lances.push({ a: 'e', ok: true }); }
  }
  let r = null, erro = null;
  try {
    r = fecha({ progress: conta.progress, db: conta.db, conta: { id: 1, gm: false },
                bilhete: { dungeonId: ID, roomIndex: 0, dificuldade: 'facil', semente: 1, herois: ['sumo', 'curandeiro'],
                           carry: null, escolhePosicao: true, regras: Ec.VERSAO_REGRAS },
                lances, hashFinal: Ec.hash(st),
                contexto: { agoraMs: AGORA, fatores: {}, guilda: {} } });
  } catch (e) { erro = (e.motivo || '') + ' ' + e.message; }
  const rw = r && r.recompensa;
  check('a dupla do teto vence a Câmara Apagada no fácil (semente 1) e o juiz fecha a sala como vencida', st.phase === 'won' && !!r && r.fase === 'won' && !!rw,
        st.phase + ' / ' + erro);
  if (rw) {
    const pedras = Object.keys(rw.stones || {});
    check('a paga da sala: XP e vinténs, pedra SÓ do elemento do quadrante, e nada do que é de chefe (selo, insígnia, âncora, carta)',
          rw.xpGanho > 0 && rw.moedas > 0 && pedras.length > 0 && pedras.every((s) => Dw.stones[s].element === 'fogo') &&
          Object.keys(rw.selos).length === 0 && rw.insignias === 0 && rw.cards.length === 0 && rw.petCards.length === 0 &&
          !pedras.includes((Dw.upgrade || {}).guardStone), JSON.stringify({ xp: rw.xpGanho, moedas: rw.moedas, stones: rw.stones, selos: rw.selos }));
    check('a peça que cai (quando cai) é do Coração Partido e não é épica nem lendária',
          rw.drops.every((id) => Dw.items[id].dungeonId === FONTE && !/^(epico|lendario)$/.test(Dw.items[id].rarity)), JSON.stringify(rw.drops));
    check('o XP do herói do teto não é cortado (xpMult 1)', Object.keys(rw.xpMult).every((h) => rw.xpMult[h] === 1), JSON.stringify(rw.xpMult));
  }
})();

check('Engine.VERSAO_REGRAS subiu com o Santuário (≥ 7)', E.VERSAO_REGRAS >= 7, String(E.VERSAO_REGRAS));

console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
