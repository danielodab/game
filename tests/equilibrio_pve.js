#!/usr/bin/env node
'use strict';
/* A MEDIDA DO PvE (03/10, a revisão do equilíbrio). O dono pediu o equilíbrio
 * "para PvE e PvP"; a bancada (tests/equilibrio.js) mede o PvP com a IA dos dois
 * lados, e o acerto das classes mexeu no dano de todas (o Xamã a 0,7, o topo do
 * Bruxo a 0,63, o Ladino e o Bárbaro a 1,4) sem que o calabouço fosse medido.
 * Esta é a medida que faltava — MOSTRA, não cobra (como o um contra um da
 * bancada): o calabouço não tem faixa-alvo escrita, e o número serve para
 * comparar uma árvore com outra.
 *
 *   node tests/equilibrio_pve.js [raiz] [sementes]     (raiz: outra árvore, para o antes)
 *
 * O que joga: cada classe, nos seis calabouços, no NÍVEL RECOMENDADO de cada um
 * (`levelRange`), nas três salas, nos quatro caminhos, em DUPLA (o parceiro gira
 * pelas outras classes) e SOZINHA; herói nu (sem item, estrela nem pet, como a
 * bancada) e conduzido pela IA do jogo, como o herói que caiu da rede. Cada sala
 * nasce com o PV cheio — a vida única entre salas é do jogo, não da medida.
 * Determinística: a semente de cada sala é fixa.
 *
 * O que sai, por classe: a fração da vida dos monstros que o grupo tirou
 * (`tirou`, a medida contínua — nu e sozinho quase ninguém vence uma sala), a
 * taxa de vitória e a vida que sobrou. */
const path = require('path');
try { require('os').setPriority(0, require('os').constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) { /* sem permissão: segue */ }

const RAIZ = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const SEMENTES = +(process.argv[3] || 2);
const { mundo } = require(path.join(RAIZ, 'servidor', 'juiz', 'motor.js'));
const J = mundo(['js/core/progress.js']).JOGO;
// 07/10: a bancada mede o jogo BASE — o elite de sala (js/core/elites.js) é sorte por cima e não entra na régua
if (J.Elites) J.Elites.CHANCE = 0;
const E = J.Engine, P = J.Progress, D = J.DATA, AI = J.AI;
const CLASSES = Object.keys(D.classes).filter((c) => c !== 'gm').sort();
const ELEMS = ['fogo', 'agua', 'terra', 'ar'];

function grupo(classes, elem, nivel) {
  P.reset();
  for (const c of classes) {
    try { P.unlockClass(c); } catch (e) { /* as iniciais já nascem livres */ }
    const h = P.hero(c);
    h.level = nivel;
    h.element = nivel >= 5 ? elem : 'neutro';
  }
  return P.battleParty(classes);
}
// a mesma condução do duelo da bancada: o plano da IA, lance a lance
function joga(st) {
  for (let guarda = 0; st.phase === 'playing' && guarda < 3000 && st.round <= 40; guarda++) {
    const u = E.activeUnit(st);
    if (!u) { E.endTurn(st); continue; }
    let plano = null;
    try { plano = AI.planTurn(st, u.uid); } catch (e) { plano = null; }
    let fim = false;
    for (const a of (plano || [])) {
      if (st.phase !== 'playing') break;
      try {
        if (a.action === 'move') E.move(st, u.uid, a.x, a.y);
        else if (a.action === 'cast') E.cast(st, u.uid, a.spellId, a.x, a.y);
        else if (a.action === 'end') { E.endTurn(st); fim = true; break; }
      } catch (e) { /* o jogo também engole erro de execução da IA */ }
    }
    if (!fim && st.phase === 'playing') E.endTurn(st);
    if (E.events) E.events.length = 0;
  }
}
function mede(dupla) {
  const out = {};
  for (const c of CLASSES) {
    let n = 0, vit = 0, tirou = 0, sobra = 0;
    for (const dg of D.dungeons.filter((d) => d.order)) {
      const nivel = dg.levelRange || 1;
      for (let ei = 0; ei < ELEMS.length; ei++) {
        const outras = CLASSES.filter((x) => x !== c);
        const classes = dupla ? [c, outras[(CLASSES.indexOf(c) + ei) % outras.length]] : [c];
        for (let sala = 0; sala < dg.rooms.length; sala++) {
          for (let s = 0; s < SEMENTES; s++) {
            const st = E.createBattle(dg.id, sala, grupo(classes, ELEMS[ei], nivel), { seed: 1000 + s * 7 + sala, escolhePosicao: false });
            st.phase = 'playing';
            const monstros = st.units.filter((u) => u.side !== 'player').map((u) => [u, u.hpMax]);
            joga(st);
            n++;
            if (st.phase === 'won') vit++;
            const total = monstros.reduce((a, m) => a + m[1], 0);
            tirou += monstros.reduce((a, m) => a + (m[1] - (m[0].alive ? Math.max(0, m[0].hp) : 0)), 0) / total;
            const herois = st.units.filter((u) => u.side === 'player' && (u.kind === 'hero' || u.kind === 'fusion'));
            sobra += herois.reduce((a, u) => a + Math.max(0, u.hp) / u.hpMax, 0) / Math.max(1, herois.length);
          }
        }
      }
    }
    out[c] = { tirou: +(tirou / n).toFixed(3), vitoria: +(vit / n).toFixed(3), vidaQueSobrou: +(sobra / n).toFixed(3), jogos: n };
  }
  return out;
}
const t0 = Date.now();
const res = { dupla: mede(true), sozinho: mede(false) };
for (const modo of ['dupla', 'sozinho']) {
  console.log('\n' + modo.toUpperCase() + ' (nível recomendado de cada calabouço; ' + SEMENTES + ' sementes)');
  console.log('classe        tirou   vitória   vida que sobrou');
  let st = 0, sv = 0;
  for (const c of CLASSES) {
    const r = res[modo][c];
    st += r.tirou; sv += r.vitoria;
    console.log(c.padEnd(12) + (Math.round(r.tirou * 100) + '%').padStart(7) + (Math.round(r.vitoria * 100) + '%').padStart(10) + (Math.round(r.vidaQueSobrou * 100) + '%').padStart(18));
  }
  console.log('média'.padEnd(12) + (Math.round(st / CLASSES.length * 100) + '%').padStart(7) + (Math.round(sv / CLASSES.length * 100) + '%').padStart(10));
}
console.log('\n' + Math.round((Date.now() - t0) / 1000) + ' s');
