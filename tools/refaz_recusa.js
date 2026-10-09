#!/usr/bin/env node
'use strict';
/* REFAZ UMA SALA RECUSADA PELO JUIZ, A PARTIR DA CAIXA-PRETA (09/10).
 *
 *   node tools/refaz_recusa.js <arquivo.json baixado do painel do Mestre › Auditoria › caixa-preta>
 *
 * O servidor guarda em <pasta do banco>/recusas/ o pedido inteiro de toda sala que o juiz recusou (a ata, os
 * lances dos dois clientes, o progress/db de cada conta, o contexto). Aqui o MESMO juiz refaz a sala com o
 * rastreio ligado (`global.__traceLance`, servidor/juiz/sala.js): lance a lance, quem é a unidade da vez, PA/PM,
 * a casa, o feitiço, o que o cliente disse que deu (`ok`) — e no lance que divergiu, o porquê (o alvo, o alcance,
 * o ocupante). O dono: "de novo não deu XP na luta, isso é inaceitável". */
const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const arquivo = process.argv[2];
if (!arquivo) { console.error('uso: node tools/refaz_recusa.js <arquivo.json>'); process.exit(2); }
const reg = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const pedido = reg.pedido || reg;
const tipo = reg.tipo || (pedido.membros ? 'grupo' : 'sala');
console.log('== caixa-preta:', reg.tipo, reg.ref, reg.quando ? new Date(reg.quando).toISOString() : '', '\n   o juiz disse:', reg.erro, '(' + reg.motivo + ')');
const ata = pedido.ata || {};
console.log('   ata:', JSON.stringify({ dungeonId: ata.dungeonId, roomIndex: ata.roomIndex, dificuldade: ata.dificuldade, semente: ata.semente,
                                       regras: ata.regras, afixo: ata.afixo, carry: ata.carry ? Object.keys(ata.carry).length + ' chaves' : null }));
if (pedido.membros) pedido.membros.forEach((m) => console.log('   membro', m.dono, 'conta', m.conta && m.conta.id, 'heróis', (m.herois || []).join(','),
  'níveis', (m.herois || []).map((h) => { const x = m.progress && m.progress.heroes && m.progress.heroes[h]; return x ? x.level : '?'; }).join(',')));
else console.log('   bilhete', pedido.bilhete, 'heróis', (pedido.herois || []).join(','));
const lances = pedido.lances || [];
console.log('   lances:', lances.length, '— os 8 primeiros:', JSON.stringify(lances.slice(0, 8)));

const { fechaGrupo, fecha } = require(path.join(RAIZ, 'servidor', 'juiz', 'recompensa.js'));
let ultimo = null;
global.__traceLance = function (i, l, st, J) {
  const E = J.Engine;
  const u = E.activeUnit ? E.activeUnit(st) : null;
  const lu = l.u ? E.findUnit(st, l.u) : null;
  const linha = { i, a: l.a, de: l.de, ok: l.ok, u: l.u, x: l.x, y: l.y, s: l.s, fase: st.phase, rodada: st.round, turno: st.turno,
                  daVez: u ? { uid: u.uid, dono: u.dono, kind: u.kind, pa: u.pa, pm: u.pm, x: u.x, y: u.y, hp: u.hp, ia: !!u.ia } : null };
  if (lu && lu !== u) linha.unidadeDoLance = { uid: lu.uid, dono: lu.dono, pa: lu.pa, x: lu.x, y: lu.y };
  if (l.a === 'c' && lu) {
    try {
      const alvos = E.castTargets ? E.castTargets(st, lu.uid, l.s) : null;
      linha.alvoValido = alvos ? alvos.some((c) => c.x === l.x && c.y === l.y) : 'castTargets ausente';
      linha.nAlvos = alvos ? alvos.length : null;
      const oc = st.units.find((z) => z.alive && !z.offBoard && z.x === l.x && z.y === l.y);
      linha.ocupante = oc ? { uid: oc.uid, kind: oc.kind, dono: oc.dono, invisivel: !!(E.unitHasEffect && E.unitHasEffect(oc, 'invisible')) } : null;
      linha.podeConjurar = E.canCast ? E.canCast(st, lu.uid, l.s) : undefined;
    } catch (e) { linha.erroAlvo = String(e && e.message); }
  }
  if (l.a === 'm' && lu) {
    try { const alc = E.reachable ? E.reachable(st, lu.uid) : null; linha.alcancavel = alc ? alc.some((c) => c.x === l.x && c.y === l.y) : 'reachable ausente'; } catch (e) { linha.erroMov = String(e && e.message); }
  }
  ultimo = linha;
  if (i < 12 || l.ok === false) console.log('  ', JSON.stringify(linha));
};
let r;
try {
  r = tipo === 'sala' ? fecha(pedido) : fechaGrupo(pedido);
  console.log('== o juiz AGORA aceitou:', JSON.stringify({ ok: r.ok, fase: r.fase, turnosJogador: r.turnosJogador }));
} catch (e) {
  console.log('== o juiz AGORA recusou:', e.message, '(' + (e.motivo || '?') + ')');
  if (ultimo) console.log('   o último lance refeito antes da recusa:', JSON.stringify(ultimo));
}
