'use strict';
/* O DUELO RANQUEADO NO SERVIDOR — POST /duelo/fecha (dono: servidor).
 *
 * O duelo pela Rede era AMISTOSO (11/09, achado 20): a Brasa só mostrava "se
 * valesse", porque o resultado vinha dos dois navegadores e um cliente mexido
 * se dava pontos. Com o juiz, a arena é refeita no servidor com as duas duplas
 * montadas do estado de CADA conta e o registro de lances; só o resultado do
 * motor daqui muda a Brasa — e muda nos DOIS estados, na mesma resposta. Os
 * tetos contra combinar resultado entre duas contas (por par e por dia) são da
 * API, que sabe o histórico.
 *
 * corpo = { A: { conta, dono, herois, progress, db, vida? }, B: { ... },
 *           dungeonId, roomIndex, semente, lances, hashFinal, contexto: { agoraMs } }
 * O lado A é o 'player' do motor e o B o 'enemy' (game.js, _iniciaDueloRede). */
const { mundoEconomico, poeEstado, tiraEstado } = require('./estado');
const { refazEm, recusa, vidaMaxDoLado } = require('./sala');

const FIM = { won: 'A', lost: 'B', empate: 'empate' };

function fechaDuelo(corpo) {
  const c = corpo || {};
  const ctxo = c.contexto || {};
  const lados = ['A', 'B'].map((k) => {
    const m = c[k];
    if (!m || typeof m.dono !== 'string' || !m.dono || !Array.isArray(m.herois) || !m.herois.length || m.herois.length > 2) {
      throw recusa('lado ' + k + ' inválido', 'entrada');
    }
    const w = mundoEconomico({ gm: !!(m.conta && m.conta.gm), contaId: m.conta && m.conta.id, agoraMs: ctxo.agoraMs, semente: 1 });
    poeEstado(w, m.progress, m.db);
    for (const hid of m.herois) {
      if (!w.J.Progress.hero(hid)) throw recusa('o herói ' + hid + ' não é da conta do lado ' + k, 'herois');
    }
    const dupla = w.J.Progress.battleParty(m.herois).map((p) => Object.assign(p, { dono: m.dono }));
    return { k, m, w, dupla, antes: tiraEstado(w) };
  });
  if (lados[0].m.dono === lados[1].m.dono) throw recusa('os dois lados com o mesmo dono', 'entrada');
  if (lados[0].m.conta && lados[1].m.conta && lados[0].m.conta.id === lados[1].m.conta.id) {
    throw recusa('duelo contra a própria conta não vale', 'mesma-conta');
  }

  /* 14/09, A VIDA ÚNICA: cada lado entra com a vida que a API guardou no POST /api/duelo/abrir
   * (`A.vida` / `B.vida` = {heroId: PV}; null = cheio, a página de antes) e sai com a vida do fim
   * (`vidaFim`, Engine.vidaDoLado) e o máximo (`vidaMax`) — em QUALQUER fim refeito, ranqueado ou
   * não: a API grava os dois lados em vida_heroi */
  const r = refazEm(lados[0].w.J, {
    modo: 'duelo', dungeonId: c.dungeonId, roomIndex: c.roomIndex, semente: c.semente,
    duplaA: JSON.parse(JSON.stringify(lados[0].dupla)), duplaB: JSON.parse(JSON.stringify(lados[1].dupla)),
    vidaA: lados[0].m.vida || null, vidaB: lados[1].m.vida || null,
    escolhePosicao: false, lances: c.lances, hashFinal: c.hashFinal,
    regras: c.regras            // 19/09: a versão das regras da abertura, quando a API a guardar (sala.js confere)
  });
  const E = lados[0].w.J.Engine;
  const vida = {
    A: { vidaFim: E.vidaDoLado(r.estado, 'player'), vidaMax: vidaMaxDoLado(r.estado, 'player') },
    B: { vidaFim: E.vidaDoLado(r.estado, 'enemy'), vidaMax: vidaMaxDoLado(r.estado, 'enemy') }
  };
  let venc = FIM[r.fase] || null;
  let fase = r.fase;
  /* 15/09, AS FALHAS CONHECIDAS (o dono: "arrume as falhas conhecidas" — sair do duelo antes do fim fugia da
   * consequência). `perdeu` ('A' | 'B') é o lado que a API decidiu que perde um duelo SEM fim no replay: o que
   * DESISTIU (declarado pela conta dele mesma) ou o que SUMIU com a queda provada pelo relé (servidor/presenca.py).
   * O replay segue sendo o juiz dos lances até ali (os mesmos hashes); quem perde assim sai com TODOS os heróis a
   * 0 e o outro com a vida em que o replay parou. Duelo que acabou de verdade no replay ignora o `perdeu`. */
  const perdeu = (c.perdeu === 'A' || c.perdeu === 'B') ? c.perdeu : null;
  if (!venc && perdeu) {
    venc = perdeu === 'A' ? 'B' : 'A';
    fase = venc === 'A' ? 'won' : 'lost';
    const v = vida[perdeu], zerada = {};
    Object.keys(v.vidaFim || {}).concat(Object.keys(v.vidaMax || {})).forEach((h) => { zerada[h] = 0; });
    v.vidaFim = zerada;
  }
  const saida = { ok: true, fase, venc, ranqueado: !!venc, turnosJogador: r.turnosJogador, forcado: !!(perdeu && venc && !FIM[r.fase]) };
  if (!venc) {
    // não terminou (desistência, W.O., queda): não é resultado de arena — a Brasa não muda (a vida sim)
    lados.forEach((x) => {
      saida[x.k] = Object.assign({ progress: x.antes.progress, db: x.antes.db, hash: x.antes.hash, delta: 0 }, vida[x.k]);
    });
    return saida;
  }
  const B = lados[0].w.J.Brasa;
  const pts = lados.map((x) => {
    const b = (x.antes.db.jogador && x.antes.db.jogador.brasa) || {};
    return { pts: (typeof b.pts === 'number' && isFinite(b.pts)) ? b.pts : B.INICIAL,
             partidas: Math.max(0, Math.floor(Number(b.partidas) || 0)) };
  });
  lados.forEach((x, i) => {
    const eu = pts[i], ele = pts[1 - i];
    let novo = eu.pts, delta = 0;
    if (venc !== 'empate') {
      const e = B.elo(eu.pts, ele.pts, venc === x.k);
      novo = e.pts; delta = e.delta;
    }
    x.w.J.DB.definirBrasa(novo, eu.partidas + 1);
    const depois = tiraEstado(x.w);
    saida[x.k] = Object.assign({ progress: depois.progress, db: depois.db, hash: depois.hash, hashAntes: x.antes.hash, delta,
                                 pts: novo, partidas: eu.partidas + 1,
                                 // 08/10 à noite: a plateia — o degrau da coroa antes e depois (sem o topo: o placar é da API)
                                 coroa: { antes: B.tierDe(eu.pts, false).nivel, depois: B.tierDe(novo, false).nivel } }, vida[x.k]);
  });
  return saida;
}

function rotas(registra) {
  registra('POST', '/duelo/fecha', (corpo) => fechaDuelo(corpo));
}

module.exports = { fechaDuelo, rotas };
