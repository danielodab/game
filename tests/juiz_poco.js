#!/usr/bin/env node
'use strict';
/* PROVA DO JUIZ — o Poço sem Fundo semeado (js/core/poco.js + servidor/juiz/sala.js).
 *
 *   node tests/juiz_poco.js
 *
 *   - a mesma semente e o mesmo andar dão a MESMA sala (palco e elenco), em
 *     mundos diferentes; outra semente muda a sala;
 *   - o andar 5 tem chefe;
 *   - o cliente joga o andar semeado, e o servidor refaz, vê a vitória e paga
 *     (com a escalada de PV do andar e o recorde anotado). */
const path = require('path');
const est = require(path.join(__dirname, '..', 'servidor', 'juiz', 'estado.js'));
const { fecha } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'recompensa.js'));
const { joga } = require(path.join(__dirname, 'juiz_jogador.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}

function mundo() {
  const w = est.mundoEconomico({ agoraMs: Date.now(), semente: 1 });
  est.poeEstado(w, null, null);
  return w;
}
const a = mundo().J.Poco, b = mundo().J.Poco;
const s1 = JSON.stringify(a.salaSemeada(3, 123456)), s2 = JSON.stringify(b.salaSemeada(3, 123456));
check('a mesma semente e o mesmo andar dão a mesma sala em mundos diferentes', s1 === s2 && s1.length > 20);
check('outra semente muda a sala', JSON.stringify(a.salaSemeada(3, 654321)) !== s1);
const cinco = a.salaSemeada(5, 99);
const J0 = mundo().J;
check('o andar 5 tem chefe no elenco', Object.values(cinco.monsters).some((id) => J0.DATA.monsters[id] && J0.DATA.monsters[id].boss),
      JSON.stringify(cinco.monsters));

// ---- o cliente joga o andar semeado e o servidor paga
const w = mundo(), J = w.J;
J.Progress.state.heroes.sumo.level = 26;
J.Progress.state.heroes.sumo.xp = J.DATA.leveling.xpTable[25];
J.Progress.save();
const conta = est.tiraEstado(w);
let pago = null, tentou = 0;
for (let s = 7; s < 90 && !pago; s += 7) {
  tentou++;
  const jogo = joga({ progress: conta.progress, db: conta.db, dungeonId: 'poco', roomIndex: 0,
                      semente: s, dificuldade: 'normal', herois: ['sumo'] });
  if (jogo.fase !== 'won') continue;
  try {
    const r = fecha({ conta: { id: 1, gm: false },
                      bilhete: { dungeonId: 'poco', roomIndex: 0, dificuldade: 'normal', semente: s, herois: ['sumo'], carry: null },
                      lances: jogo.lances, hashFinal: jogo.hash, progress: conta.progress, db: conta.db,
                      contexto: { agoraMs: Date.now(), fatores: {}, guilda: {} } });
    pago = { r, s };
  } catch (e) { pago = { erro: e.message, motivo: e.motivo, s }; }
}
check('o cliente vence um andar do Poço semeado (' + tentou + ' sementes tentadas)', !!pago);
if (pago) {
  check('o servidor refaz o andar (com a escalada) e vê a vitória', pago.r && pago.r.fase === 'won', JSON.stringify(pago.erro || pago.r.fase));
  check('o Poço paga XP e anota o recorde da conta no servidor',
        pago.r && pago.r.recompensa && pago.r.recompensa.xpGanho > 0 && pago.r.db.jogador.poco.recorde >= 1,
        JSON.stringify(pago.r && [pago.r.recompensa && pago.r.recompensa.xpGanho, pago.r.db.jogador.poco]));
}

// ---- 07/10: o Poço EM GRUPO — o andar nasce da semente da ata nos dois motores, e o juiz refaz e paga os dois
{
  const { fechaGrupo } = require(path.join(__dirname, '..', 'servidor', 'juiz', 'recompensa.js'));
  const { jogaGrupo } = require(path.join(__dirname, 'juiz_grupo_jogador.js'));
  function contaDe(heroi, nivel, dono) {
    const wc = mundo(), Jc = wc.J;
    Jc.Progress.state.heroes[heroi].level = nivel;
    Jc.Progress.state.heroes[heroi].xp = Jc.DATA.leveling.xpTable[nivel - 1];
    Jc.Progress.save();
    const t = est.tiraEstado(wc);
    return { progress: t.progress, db: t.db, dono, herois: [heroi] };
  }
  const ana = contaDe('sumo', 26, 'ana'), bia = contaDe('curandeiro', 26, 'bia');
  let venc = null, tentadas = 0;
  for (let s = 11; s < 200 && !venc; s += 13) {
    tentadas++;
    const j = jogaGrupo({ membros: [ana, bia], dungeonId: 'poco', roomIndex: 2, semente: s });
    if (j.fase === 'won') venc = { j, s };
  }
  check('a dupla vence o andar 3 do Poço em grupo (' + tentadas + ' sementes tentadas)', !!venc);
  if (venc) {
    let r;
    try {
      r = fechaGrupo({ membros: [{ conta: { id: 1 }, dono: 'ana', herois: ['sumo'], progress: ana.progress, db: ana.db },
                                 { conta: { id: 2 }, dono: 'bia', herois: ['curandeiro'], progress: bia.progress, db: bia.db }],
                       ata: { dungeonId: 'poco', roomIndex: 2, dificuldade: 'normal', semente: venc.s, carry: null },
                       lances: venc.j.lances, hashFinal: venc.j.hash, contexto: { agoraMs: Date.now(), fatores: {} } });
    } catch (e) { r = { erro: e.message, motivo: e.motivo }; }
    check('o juiz refaz o andar do Poço em grupo da semente da ata e vê a vitória', r && r.ok && r.fase === 'won',
          JSON.stringify(r && (r.erro || r.fase)));
    if (r && r.ok) {
      check('os dois membros são pagos e o andar 3 fica anotado como recorde dos dois',
            r.membros.length === 2 && r.membros.every((m) => m.recompensa && m.recompensa.xpGanho > 0 && m.db.jogador.poco.recorde === 3),
            JSON.stringify(r.membros.map((m) => [m.dono, m.recompensa && m.recompensa.xpGanho, m.db.jogador.poco])));
    }
  }
}

console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
