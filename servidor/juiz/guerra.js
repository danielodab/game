'use strict';
/* A GUERRA DE GUILDA 2×2 NO SERVIDOR (15/09) — POST /guerra/ata e POST /guerra/fecha (dono: servidor).
 *
 * O dono: "a guerra de guild que é 2x2 de cada guild é na sede de guild, isso dá pontos de experiência para
 * guild". Quatro jogadores, cada um com a DUPLA dele: oito heróis no Salão da Sede (js/core/data/arenas.js).
 *
 * /guerra/ata   corpo = { jogadores: [{ conta: {id, gm}, dono, lado: 'A'|'B', herois: [1 ou 2], progress, db }] }
 *   Os payloads de batalha de cada jogador saem do ESTADO DO SERVIDOR da conta dele (Progress.battleParty, o
 *   mesmo do duelo), com o `dono` de cada um; o lado A são os dois de quem se inscreveu primeiro, na ordem
 *   (quem inscreveu, quem se juntou). Saída { ok, A: [payloads], B: [payloads], regras } — `regras` é a versão das
 *   regras (Engine.VERSAO_REGRAS) que a API guarda na ata (versaoDasRegras, abaixo). É a ATA que os quatro clientes
 *   recebem da API: ninguém escolhe com que números luta.
 *
 * /guerra/fecha corpo = { ata: { mapa, sala, semente, A, B, carry }, lances, hashFinal,
 *                         perdeu?, fechou?, contas?, saidas? }   (19/09: ver fechaGuerra)
 *   Refaz a guerra com a ata guardada (os mesmos payloads, a vida de cada herói em `carry` = {dono:heroId: PV},
 *   aplicada como na sala em grupo — a chave heroId colide entre dois jogadores do mesmo lado) e o registro de
 *   lances com as marcas da rede (quem caiu, quem voltou, quem saiu — a marca `morte` sobre o adversário só com
 *   a saída declarada dele no servidor, senão 422 'marca-sem-prova'). Saída { ok, fase, venc, turnosJogador, forcado,
 *   vida: {dono: {heroId: PV}}, vidaMax: {dono: {heroId: PV}} } — a vida em QUALQUER fim refeito; sem fim
 *   (a guerra largada no meio) venc = null, e a API decide a espera. Quem ganha o XP é a API
 *   (servidor/guerra.py): o juiz só diz o que houve. */
const { mundo } = require('./motor');
const { mundoEconomico, poeEstado } = require('./estado');
const { refazEm, recusa } = require('./sala');

const FIM = { won: 'A', lost: 'B', empate: 'empate' };

/* 19/09 (a 2ª rodada de conserto): a versão das regras (Engine.VERSAO_REGRAS) vai na PRÓPRIA resposta da ata — a
 * API a guarda na ata sem perguntar de novo: o /regras guardado dela pode ser de um juiz de antes do deploy, e o
 * juiz que montou a ata é o que a refaz. O mesmo número de GET /regras e /saude (juiz.js). */
let regrasNum = null;
function versaoDasRegras() {
  if (regrasNum == null) {
    const E = mundo().JOGO.Engine;
    regrasNum = (E && typeof E.VERSAO_REGRAS === 'number') ? E.VERSAO_REGRAS : 1;
  }
  return regrasNum;
}

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
  return { ok: true, A: lados.A, B: lados.B, regras: versaoDasRegras() };
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

const objeto = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};

/* 19/09, A PROVA DAS MARCAS (a revisão da guerra — o dono: "dê uma revisada na guerra de guild do meu jogo e
 * ajuste o que for necessário"). As marcas de rede {a:'x', ev:'ia'|'morte', u} são escritas pelo cliente, e o
 * juiz aplicava qualquer uma sobre qualquer herói de gente: quatro marcas `morte` contra os heróis do adversário,
 * sem lance nenhum, davam 'won' 4 s depois da pronta (provado). Agora a marca `morte` sobre o herói de uma conta X
 * só vale se X está no MESMO lado de quem fecha (o parceiro de guilda é quem marca, por desenho do lockstep), ou
 * se o SERVIDOR tem a prova: a saída declarada de X (guerra_saidas, `saidas`).
 * A marca `ia` NÃO precisa de prova (2ª rodada da revisão): o parceiro marca quem caiu E quem estourou o prazo
 * parado (coop.js, assumeGuerra 'prazo' — sem queda nenhuma no Relé), a voz `ia` chega aos quatro motores e cada
 * um a anota no PRÓPRIO registro; exigir o 'caiu' do Relé recusava o registro limpo dos dois adversários
 * ('marca-sem-prova') e o lado que perdia vetava a guerra de graça (provado). E ela não compra segurança: marcar
 * `ia` só faz a vez de X passar, o mesmo que o lance {a:'e', de: X} que o juiz já aceita de quem for (o risco
 * aceito do replay). `fechou` = {conta, dono, lado} de quem fecha; `contas` = {dono: conta}; saidas = {conta: ms}.
 * Sem `fechou` (uma API de antes) nada se confere. Devolve o porquê de a marca NÃO valer, ou null. */
function confereMarcaDaGuerra(c) {
  const fechou = c.fechou && typeof c.fechou === 'object' ? c.fechou : null;
  if (!fechou || (fechou.lado !== 'A' && fechou.lado !== 'B')) return null;
  const contas = objeto(c.contas), saidas = objeto(c.saidas);
  return function (alvo, l) {
    if (l.ev !== 'morte') return null;
    const lado = alvo.side === 'player' ? 'A' : 'B';
    if (lado === fechou.lado) return null;
    const conta = contas[alvo.dono];
    if (conta != null && saidas[String(conta)] != null) return null;
    return 'marca morte sobre um herói do adversário (' + String(alvo.dono) + ') sem a saída declarada dele';
  };
}

/* corpo = { ata, lances, hashFinal, perdeu?, fechou?, contas?, saidas? }
 * 19/09: `perdeu` ('A' | 'B') é o lado que a API decidiu que perde uma guerra SEM fim no replay — os dois dele
 * saíram (a saída declarada), ou os dois sumiram com a queda provada pelo Relé (o W.O. do duelo, duelo.js). O replay
 * segue sendo o juiz dos lances até ali; quem perde assim sai com TODOS os heróis a 0 e o outro lado com a vida em
 * que o replay parou (`forcado: true`). Guerra que acabou de verdade no replay ignora o `perdeu`. */
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
    escolhePosicao: false, lances: c.lances, hashFinal: c.hashFinal,
    regras: ata.regras,         // 19/09: a versão das regras da ata, quando a API a guardar (sala.js confere)
    confereMarca: confereMarcaDaGuerra(c)
  });
  const v = vidaPorDono(J.Engine, r.estado);
  let venc = FIM[r.fase] || null, fase = r.fase, forcado = false;
  const perdeu = (c.perdeu === 'A' || c.perdeu === 'B') ? c.perdeu : null;
  if (!venc && perdeu) {
    venc = perdeu === 'A' ? 'B' : 'A';
    fase = venc === 'A' ? 'won' : 'lost';
    forcado = true;
    for (const p of (ata[perdeu] || [])) {
      const d = p.dono, zerada = {};
      Object.keys(v.fim[d] || {}).concat(Object.keys(v.max[d] || {})).forEach((h) => { zerada[h] = 0; });
      v.fim[d] = zerada;
    }
  }
  return { ok: true, fase, venc, turnosJogador: r.turnosJogador, hash: r.hash, vida: v.fim, vidaMax: v.max, forcado };
}

function rotas(registra) {
  registra('POST', '/guerra/ata', (corpo) => ataGuerra(corpo));
  registra('POST', '/guerra/fecha', (corpo) => fechaGuerra(corpo));
}

module.exports = { ataGuerra, fechaGuerra, vidaPorDono, confereMarcaDaGuerra, rotas };
