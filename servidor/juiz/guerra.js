'use strict';
/* A GUERRA DE GUILDA 2×2 NO SERVIDOR (15/09) — POST /guerra/ata e POST /guerra/fecha (dono: servidor).
 *
 * O dono: "a guerra de guild que é 2x2 de cada guild é na sede de guild, isso dá pontos de experiência para
 * guild". Quatro jogadores, cada um com a DUPLA dele: oito heróis no Salão da Sede (js/core/data/arenas.js).
 *
 * /guerra/ata   corpo = { jogadores: [{ conta: {id, gm}, dono, lado: 'A'|'B', herois: [1 ou 2], progress, db }] }
 *   Os payloads de batalha de cada jogador saem do ESTADO DO SERVIDOR da conta dele (Progress.battleParty, o
 *   mesmo do duelo), com o `dono` de cada um; o lado A são os dois de quem se inscreveu primeiro, na ordem
 *   (quem inscreveu, quem se juntou). Saída { ok, A: [payloads], B: [payloads] }. É a ATA que os quatro clientes
 *   recebem da API: ninguém escolhe com que números luta.
 *
 * /guerra/fecha corpo = { ata: { mapa, sala, semente, A, B, carry }, lances, hashFinal }
 *   Refaz a guerra com a ata guardada (os mesmos payloads, a vida de cada herói em `carry` = {dono:heroId: PV},
 *   aplicada como na sala em grupo — a chave heroId colide entre dois jogadores do mesmo lado) e o registro de
 *   lances com as marcas da rede (quem caiu, quem voltou, quem saiu). Saída { ok, fase, venc, turnosJogador,
 *   vida: {dono: {heroId: PV}}, vidaMax: {dono: {heroId: PV}} } — a vida em QUALQUER fim refeito; sem fim
 *   (W.O., desistência) venc = null. Quem ganha o XP é a API (servidor/guerra.py): o juiz só diz o que houve. */
const { mundo } = require('./motor');
const { mundoEconomico, poeEstado } = require('./estado');
const { refazEm, recusa } = require('./sala');

const FIM = { won: 'A', lost: 'B', empate: 'empate' };

function ataGuerra(corpo) {
  const js = (corpo && Array.isArray(corpo.jogadores)) ? corpo.jogadores : null;
  if (!js || js.length !== 4) throw recusa('a guerra é de quatro jogadores', 'entrada');
  const lados = { A: [], B: [] }, donos = {}, contas = {};
  js.forEach((m, i) => {
    if (!m || typeof m.dono !== 'string' || !m.dono || (m.lado !== 'A' && m.lado !== 'B') ||
        !Array.isArray(m.herois) || !m.herois.length || m.herois.length > 2) {
      throw recusa('jogador ' + i + ' inválido', 'entrada');
    }
    if (donos[m.dono]) throw recusa('dois jogadores com o mesmo dono', 'entrada');
    donos[m.dono] = true;
    const cid = m.conta && m.conta.id;
    if (cid != null && contas[cid]) throw recusa('a mesma conta duas vezes', 'mesma-conta');
    contas[cid] = true;
    const w = mundoEconomico({ gm: !!(m.conta && m.conta.gm), contaId: cid, agoraMs: Date.now(), semente: 1 });
    poeEstado(w, m.progress, m.db);
    for (const hid of m.herois) {
      const h = w.J.Progress.hero(hid);
      if (!h) throw recusa('o herói ' + hid + ' não é da conta ' + cid, 'herois');
      if (h.classId === 'gm') throw recusa('o Mestre do Fundo não vai à guerra', 'mestre');
    }
    const ps = w.J.Progress.battleParty(m.herois).map((p) => {
      const c = JSON.parse(JSON.stringify(p));
      delete c.items; delete c.itemVar;       // o motor não lê (o mesmo corte do Coop.payloadMeu)
      c.dono = m.dono;
      return c;
    });
    lados[m.lado].push.apply(lados[m.lado], ps);
  });
  if (!lados.A.length || !lados.B.length || lados.A.length > 4 || lados.B.length > 4) {
    throw recusa('cada lado precisa de dois jogadores', 'entrada');
  }
  return { ok: true, A: lados.A, B: lados.B };
}

/* {dono: {heroId: PV}} do fim (caído = 0; a fusão divide o PV dela entre os heróis que a formaram — a regra do
 * Engine.vidaDoLado, só que por DONO e dos dois lados) e {dono: {heroId: PV máximo}} */
function vidaPorDono(E, st) {
  const fim = {}, max = {};
  const de = (o, d) => (o[d] = o[d] || {});
  for (const u of st.units) {
    if (u.kind === 'hero' && u.dono) {
      const hid = u.heroId || u.defId;
      if (typeof u.hpMax === 'number' && isFinite(u.hpMax) && u.hpMax > 0) de(max, u.dono)[hid] = Math.floor(u.hpMax);
      if (u.fusedInto) continue;
      de(fim, u.dono)[hid] = u.alive ? Math.max(0, Math.floor(u.hp)) : 0;
    } else if (u.kind === 'fusion') {
      const srcs = (u.fusedFrom || []).map((x) => E.findUnit(st, x)).filter((s) => s && s.kind === 'hero' && s.dono);
      if (!srcs.length) continue;
      const parte = u.alive ? Math.max(1, Math.floor(u.hp / srcs.length)) : 0;
      srcs.forEach((s) => { de(fim, s.dono)[s.heroId || s.defId] = parte; });
    }
  }
  return { fim, max };
}

function fechaGuerra(corpo) {
  const c = corpo || {};
  const ata = c.ata || {};
  const dupla = (d) => Array.isArray(d) && d.length >= 1 && d.length <= 4 && d.every((p) => p && typeof p.dono === 'string');
  if (!dupla(ata.A) || !dupla(ata.B)) throw recusa('a ata da guerra está torta', 'entrada');
  const J = mundo().JOGO;
  const r = refazEm(J, {
    modo: 'duelo', dungeonId: ata.mapa, roomIndex: ata.sala, semente: ata.semente,
    duplaA: JSON.parse(JSON.stringify(ata.A)), duplaB: JSON.parse(JSON.stringify(ata.B)),
    carryRede: true, carry: (ata.carry && typeof ata.carry === 'object') ? ata.carry : null,
    escolhePosicao: false, lances: c.lances, hashFinal: c.hashFinal
  });
  const v = vidaPorDono(J.Engine, r.estado);
  return { ok: true, fase: r.fase, venc: FIM[r.fase] || null, turnosJogador: r.turnosJogador, hash: r.hash,
           vida: v.fim, vidaMax: v.max };
}

function rotas(registra) {
  registra('POST', '/guerra/ata', (corpo) => ataGuerra(corpo));
  registra('POST', '/guerra/fecha', (corpo) => fechaGuerra(corpo));
}

module.exports = { ataGuerra, fechaGuerra, vidaPorDono, rotas };
