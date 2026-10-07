#!/usr/bin/env node
'use strict';
/* PROVA DOS AFIXOS DE SALA (07/10, js/core/afixos.js — a decisão 22 do engine.js).
 *
 *   node tests/afixos.js
 *
 * Roda sobre o motor do juiz (servidor/juiz/motor.js): o jogo inteiro em Node.
 * Cobra:
 *   · o catálogo: ids únicos, e o afixo do dia é sempre um deles;
 *   · o dia de Brasília: o mesmo instante dá o mesmo afixo, 60 dias passam por
 *     todos os afixos, e a chave do dia vira às 00:00 de Brasília (03:00 UTC);
 *   · o Calabouço do Dia não muda quando a conta visita o Poço (o conserto do
 *     diario.js: a página e o servidor sorteiam entre os mesmos portais);
 *   · cada afixo faz o que diz: vida, passo, esquiva e dano do lado inimigo e
 *     só dele; o clima virado é outro clima da roda e não gira; o chão
 *     traiçoeiro põe perigos fora da zona de entrada, iguais com a mesma
 *     semente e outros com outra;
 *   · um id fora do catálogo não abre sala; sem o módulo, uma sala com afixo
 *     também não (nascer sem a regra e fechar no juiz com ela seria 'divergiu');
 *   · o juiz: a sala jogada com afixo refaz igual com o mesmo afixo, cai com
 *     outro e cai sem nenhum; o hash muda com o afixo;
 *   · a recompensa: a mesma sala vencida paga +25% de XP e vinténs com afixo
 *     (o Clima Virado num portal de clima parado: a luta é a mesma). */
const path = require('path');
const { mundo } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'motor.js'));
const { refaz, ehDoJogador } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'sala.js'));
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
const { fecha } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'recompensa.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (extra !== undefined && !ok ? ' — ' + extra : ''));
}

const J = mundo(['js/core/diario.js']).JOGO;
const Af = J.Afixos, E = J.Engine;
const PARTY = [{ heroId: 'sumo', classId: 'sumo', element: 'neutro', level: 20 }];
const DIA = Date.UTC(2026, 9, 7, 15, 0, 0);     // 07/10/2026 12:00 de Brasília

// ---- o catálogo e o dia
check('o módulo carrega com o motor e tem pelo menos seis afixos', !!Af && Af.LISTA.length >= 6);
const ids = Af.ids();
check('os ids são únicos', new Set(ids).size === ids.length, ids.join(','));
check('o afixo do dia é um do catálogo', ids.indexOf(Af.doDia(DIA)) >= 0, Af.doDia(DIA));
check('o mesmo instante dá o mesmo afixo', Af.doDia(DIA) === Af.doDia(DIA + 1000));
const vistos = new Set();
for (let d = 0; d < 60; d++) vistos.add(Af.doDia(DIA + d * 86400000));
check('60 dias passam por todos os afixos', vistos.size === ids.length, [...vistos].join(','));
const antesMeiaNoite = Date.UTC(2026, 9, 8, 2, 59, 0), depoisMeiaNoite = Date.UTC(2026, 9, 8, 3, 1, 0);
check('a chave do dia vira às 00:00 de Brasília (03:00 UTC)',
      Af.chaveDoDia(antesMeiaNoite) === 20261007 && Af.chaveDoDia(depoisMeiaNoite) === 20261008,
      Af.chaveDoDia(antesMeiaNoite) + ' / ' + Af.chaveDoDia(depoisMeiaNoite));
check('Engine.VERSAO_REGRAS subiu para 8 (o juiz refaz com o afixo)', E.VERSAO_REGRAS === 8, E.VERSAO_REGRAS);

// ---- o Calabouço do Dia não muda com o Poço na lista
const diaAntes = [0, 1, 2, 3, 4, 5, 6].map((d) => J.Diario.hoje(DIA + d * 86400000).dungeonId);
J.Poco.preparar(1);
const diaDepois = [0, 1, 2, 3, 4, 5, 6].map((d) => J.Diario.hoje(DIA + d * 86400000).dungeonId);
check('o Calabouço do Dia é o mesmo antes e depois de o Poço entrar em DATA.dungeons',
      diaAntes.join(',') === diaDepois.join(','), diaAntes.join(',') + ' / ' + diaDepois.join(','));
check('o Poço nunca é o Calabouço do Dia', diaDepois.indexOf('poco') < 0 && diaDepois.indexOf(J.Poco.ID) < 0);

// ---- cada afixo faz o que diz
function sala(afixo, seed, dungeon, room) {
  return E.createBattle(dungeon || 'cistern', room || 0, PARTY,
    { seed: seed == null ? 11 : seed, dificuldade: 'normal', escolhePosicao: false, afixo: afixo || null });
}
function inimigos(st) { return st.units.filter((u) => u.side === 'enemy'); }
function herois(st) { return st.units.filter((u) => u.side === 'player'); }
const base = sala(null);
const hpBase = inimigos(base).map((u) => u.hpMax);
const couracados = sala('couracados');
check('Couraçados: +30% de PV máximo (e PV cheio) só do lado inimigo',
      inimigos(couracados).every((u, i) => u.hpMax === Math.round(hpBase[i] * 1.3) && u.hp === u.hpMax) &&
      herois(couracados)[0].hpMax === herois(base)[0].hpMax,
      inimigos(couracados).map((u) => u.hpMax).join('/'));
const ligeiros = sala('ligeiros');
check('Ligeiros: +1 PP só do lado inimigo',
      inimigos(ligeiros).every((u, i) => u.ppMax === inimigos(base)[i].ppMax + 1 && u.pp === u.ppMax) &&
      herois(ligeiros)[0].ppMax === herois(base)[0].ppMax);
const esquivos = sala('esquivos');
check('Esquivos: +15 de esquiva só do lado inimigo',
      inimigos(esquivos).every((u, i) => u.dodge === inimigos(base)[i].dodge + 15) &&
      herois(esquivos)[0].dodge === herois(base)[0].dodge);
check('a sala com afixo guarda state.afixo com nome e texto', couracados.afixo && couracados.afixo.id === 'couracados' &&
      typeof couracados.afixo.nome === 'string' && typeof couracados.afixo.texto === 'string');
check('a sala sem afixo não tem state.afixo', base.afixo === undefined);

// Ferozes: o mesmo golpe inimigo fere 20% a mais (o funil da dificuldade); o do herói não muda
function golpe(st, deInimigo) {
  const alvo = deInimigo ? herois(st)[0] : inimigos(st)[0];
  const quem = deInimigo ? inimigos(st)[0] : herois(st)[0];
  const antes = alvo.hp;
  alvo.shield = 0;
  const I = E._interno ? E._interno() : null;
  if (!I) return null;
  I.dano(st, alvo, 50, 'neutro', quem.uid, true);
  return antes - alvo.hp;
}
(function () {
  const f = sala('ferozes'), b2 = sala(null);
  const dIn = golpe(f, true), dInBase = golpe(b2, true);
  const dHe = golpe(f, false), dHeBase = golpe(b2, false);
  check('Ferozes: o golpe inimigo fere 20% a mais; o do herói, o mesmo',
        dIn === Math.round(dInBase * 1.2) && dHe === dHeBase && dInBase > 0,
        dIn + '/' + dInBase + ' · ' + dHe + '/' + dHeBase);
})();

// Clima Virado: outro clima da roda, e ele não gira (o Coração Partido gira a cada 3 rodadas)
const cv = sala('clima_virado', 5, 'brokenheart', 0), cvBase = sala(null, 5, 'brokenheart', 0);
check('Clima Virado: a sala abre com OUTRO clima da roda', cv.weather !== cvBase.weather && cv.afixo.climaPreso === true,
      cv.weather + ' / ' + cvBase.weather);
check('Clima Virado: a mesma semente dá o mesmo clima', sala('clima_virado', 5, 'brokenheart', 0).weather === cv.weather);
(function () {
  const climaInicial = cv.weather;
  let voltas = 0;
  while (cv.phase === 'playing' && cv.round < 8 && voltas++ < 600) {
    const u = E.activeUnit(cv);
    if (!u) break;
    E.endTurn(cv);
  }
  check('Clima Virado: o clima não gira até a rodada 8', cv.weather === climaInicial && cv.round >= 8,
        cv.weather + ' na rodada ' + cv.round);
  const cb = sala(null, 5, 'brokenheart', 0), c0 = cb.weather;
  voltas = 0;
  while (cb.phase === 'playing' && cb.round < 8 && voltas++ < 600) { const u = E.activeUnit(cb); if (!u) break; E.endTurn(cb); }
  check('(controle) sem afixo o Coração Partido gira o clima', cb.weather !== c0, cb.weather + ' / ' + c0);
})();

// Chão Traiçoeiro: perigos do Poço na sala, fora da entrada, pela semente
const ct = sala('chao_traicoeiro', 11), ct2 = sala('chao_traicoeiro', 11), ct3 = sala('chao_traicoeiro', 12);
const ps = ct.perigos || [];
check('Chão Traiçoeiro: a sala nasce com perigos', ps.length >= 2, ps.length);
const Ps = [];
const lay = J.DATA.dungeons.find((d) => d.id === 'cistern').rooms[0].layout;
lay.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === 'P') Ps.push({ x, y }); });
check('Chão Traiçoeiro: nenhum perigo na zona de entrada (a até 3 de um P)',
      ps.every((p) => Ps.every((q) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) > 3)));
const desenho = (st) => (st.perigos || []).map((p) => p.tipo + '@' + p.x + ',' + p.y).join(' ');
check('Chão Traiçoeiro: a mesma semente dá o mesmo chão', desenho(ct) === desenho(ct2));
check('Chão Traiçoeiro: outra semente dá outro chão', desenho(ct) !== desenho(ct3));
check('a sala de sempre não ganha perigos', !base.perigos);

// ---- o que não abre
let caiu = null;
try { sala('lua'); } catch (e) { caiu = e.message; }
check('um id fora do catálogo não abre sala', !!caiu && /desconhecido/.test(caiu), caiu);
const Jsem = mundo().JOGO;
Jsem.Afixos = null;
let caiuSem = null;
try { Jsem.Engine.createBattle('cistern', 0, PARTY, { seed: 1, afixo: 'ferozes' }); } catch (e) { caiuSem = e.message; }
check('sem o módulo, uma sala com afixo não nasce (e a sem afixo nasce)',
      !!caiuSem && /afixos\.js/.test(caiuSem) && !!Jsem.Engine.createBattle('cistern', 0, PARTY, { seed: 1 }), caiuSem);

// ---- o juiz
function joga(afixo, seed) {
  const w = mundo();
  const Jw = w.JOGO, Ew = Jw.Engine;
  const st = Ew.createBattle('cistern', 0, PARTY, { seed, dificuldade: 'normal', escolhePosicao: false, afixo });
  Ew.events.length = 0;
  const lances = [];
  let voltas = 0;
  while (st.phase === 'playing' && voltas++ < 4000) {
    const u = Ew.activeUnit(st);
    if (!u) break;
    const plano = Jw.AI.planTurn(st, u.uid) || [];
    const meu = ehDoJogador(st, u);
    let acabou = false;
    for (const a of (plano.length ? plano : [{ action: 'end' }])) {
      if (st.phase !== 'playing') break;
      if (a.action === 'move') { const ok = !!Ew.move(st, u.uid, a.x, a.y); if (meu) lances.push({ a: 'm', u: u.uid, x: a.x, y: a.y, ok }); }
      else if (a.action === 'cast') { const ok = !!Ew.cast(st, u.uid, a.spellId, a.x, a.y); if (meu) lances.push({ a: 'c', u: u.uid, s: a.spellId, x: a.x, y: a.y, ok }); }
      else if (a.action === 'end') { Ew.endTurn(st); if (meu) lances.push({ a: 'e', ok: true }); acabou = true; break; }
    }
    if (!acabou && st.phase === 'playing') { Ew.endTurn(st); if (meu) lances.push({ a: 'e', ok: true }); }
    Ew.events.length = 0;
  }
  return { lances, fase: st.phase, hash: Ew.hash(st) };
}
function tenta(jogo, afixo) {
  try {
    const r = refaz({ dungeonId: 'cistern', roomIndex: 0, dificuldade: 'normal', semente: 11, party: PARTY,
                      escolhePosicao: false, lances: jogo.lances, hashFinal: jogo.hash, afixo });
    return { ok: true, r };
  } catch (e) { return { ok: false, motivo: e.motivo, msg: e.message }; }
}
['couracados', 'chao_traicoeiro', 'ferozes'].forEach((id) => {
  const jogo = joga(id, 11);
  const igual = tenta(jogo, id);
  check('o juiz refaz a sala jogada com ' + id + ' e chega ao mesmo fim (' + jogo.fase + ')',
        igual.ok && igual.r.fase === jogo.fase && igual.r.hash === jogo.hash, JSON.stringify(igual));
  const sem = tenta(jogo, null);
  check('a mesma sala refeita SEM o afixo ' + id + ' cai (divergiu)', !sem.ok && sem.motivo === 'divergiu', JSON.stringify(sem));
});
const jc = joga('couracados', 11);
const outro = tenta(jc, 'ligeiros');
check('refeita com OUTRO afixo cai (divergiu)', !outro.ok && outro.motivo === 'divergiu', JSON.stringify(outro));
const torto = tenta(jc, 'lua');
check('um afixo fora do catálogo é entrada torta', !torto.ok && torto.motivo === 'entrada', JSON.stringify(torto));
const tortoTipo = tenta(jc, 7);
check('um afixo que não é texto é entrada torta', !tortoTipo.ok && tortoTipo.motivo === 'entrada', JSON.stringify(tortoTipo));
check('o hash da sala muda com o afixo', E.hash(sala('ferozes')) !== E.hash(sala(null)));

// ---- a recompensa: +25% de XP e vinténs na mesma luta
function fechaCom(afixo) {
  const w = est.mundoEconomico({ agoraMs: DIA, semente: 1 });
  est.poeEstado(w, null, null);
  const Jw = w.J;
  Jw.Progress.state.heroes.sumo.level = 22;
  Jw.Progress.state.heroes.sumo.xp = Jw.DATA.leveling.xpTable[21];
  const estado = est.tiraEstado(w);
  // a mesma sala, jogada pelo "jogador" de juiz_jogador: a IA com a semente que vence
  const jog = require(path.join(__dirname, 'juiz_jogador.js'));
  const jogo = jog.joga({ progress: estado.progress, db: estado.db, dungeonId: 'cistern', roomIndex: 0,
                          semente: 11, dificuldade: 'normal', herois: ['sumo'], carry: null, afixo });
  const saida = fecha({ conta: { id: 1, gm: false },
                        bilhete: { dungeonId: 'cistern', roomIndex: 0, dificuldade: 'normal', semente: 11, herois: ['sumo'],
                                   carry: null, afixo },
                        lances: jogo.lances, hashFinal: jogo.hash, progress: estado.progress, db: estado.db,
                        contexto: { agoraMs: DIA, fatores: {} } });
  return saida;
}
let recSem = null, recCom = null, erroRec = null;
try { recSem = fechaCom(null); recCom = fechaCom('clima_virado'); } catch (e) { erroRec = e && (e.stack || e.message); }
if (erroRec || !recSem || !recCom || recSem.fase !== 'won' || recCom.fase !== 'won') {
  check('a recompensa (a sala com Clima Virado venceu nos dois mundos)', false,
        erroRec || ('fases ' + (recSem && recSem.fase) + ' / ' + (recCom && recCom.fase)));
} else {
  const xs = recSem.recompensa.xpGanho, xc = recCom.recompensa.xpGanho;
  check('a sala com afixo paga +25% de XP (' + xs + ' → ' + xc + ')', xc === Math.floor(xs * 1.25) || xc === Math.floor(xs * 1.25) + 1 || Math.abs(xc - xs * 1.25) <= 1, xs + ' / ' + xc);
  check('e +25% de vinténs', Math.abs(recCom.recompensa.moedas - recSem.recompensa.moedas * 1.25) <= 1,
        recSem.recompensa.moedas + ' / ' + recCom.recompensa.moedas);
  check('o recibo diz o afixo', recCom.recompensa.afixo && recCom.recompensa.afixo.id === 'clima_virado' && !recSem.recompensa.afixo);
}

console.log('\n' + (total - falhas) + ' de ' + total + ' passaram' + (falhas ? ' — ' + falhas + ' FALHARAM' : ''));
process.exit(falhas ? 1 : 0);
