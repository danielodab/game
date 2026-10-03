'use strict';
/* A TENTATIVA DO ECO PRIMORDIAL REFEITA — o placar que vale (dono: servidor).
 *
 * POST /supremo/fecha. O pedido do dono: "placar de quem tirou mais dano", e
 * a regra da casa (docs/SEGURANCA.md): o número que o navegador mostrou não
 * entra em conta nenhuma. A API (servidor/supremo.py) manda a semente que ELA
 * sorteou ao abrir, os heróis da tentativa, os lances anotados pelo jogo e o
 * estado da conta que ela guarda; aqui:
 *   1. o grupo sai do Progress DAQUI (Progress.battleParty) — atributos,
 *      peças, pet e estrelas do estado do servidor, como na sala solo;
 *   2. a Câmara do Eco é refeita da semente e dos lances pelo MESMO refazer da
 *      sala (sala.js: a vez, o resultado de cada lance, o hash do meio e do
 *      fim — o que diverge derruba com 422 e a API não pontua);
 *   3. o placar sai do motor refeito (Engine.ecoPlacar): o dano que o grupo
 *      tirou do Eco e o bônus de quem o derrubou.
 * A tentativa que parou no meio (a aba fechada) vale até onde foi: os lances
 * conferidos são de verdade, e o dano deles também.
 *
 * corpo = { conta: {id, gm}, tentativa: {semente, herois, regras}, lances, hashFinal,
 *           progress, db, contexto: {agoraMs} } */
const { mundoEconomico, poeEstado, sementeDe } = require('./estado');
const { refazEm, recusa } = require('./sala');

function inteiro(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

function fecha(corpo) {
  const c = corpo || {};
  const t = c.tentativa || {};
  if (!inteiro(t.semente)) throw recusa('tentativa inválida', 'entrada');
  if (!Array.isArray(t.herois) || !t.herois.length || t.herois.length > 2 || t.herois.some((h) => typeof h !== 'string')) {
    throw recusa('heróis da tentativa inválidos', 'entrada');
  }
  const conta = c.conta || {};
  const ctxo = c.contexto || {};
  const w = mundoEconomico({
    gm: !!conta.gm, contaId: conta.id, agoraMs: ctxo.agoraMs,
    // o mundo econômico pede um sorteio; a tentativa não sorteia recompensa nenhuma
    semente: sementeDe(t.semente + ':eco')
  });
  poeEstado(w, c.progress, c.db);
  const J = w.J;
  const cfg = J.DATA && J.DATA.eco;
  if (!cfg || !cfg.arena) throw recusa('o Eco não existe nestas regras', 'entrada');
  for (const hid of t.herois) {
    if (!J.Progress.hero(hid)) throw recusa('o herói ' + hid + ' não é desta conta', 'herois');
  }
  const party = J.Progress.battleParty(t.herois);
  if (!party || !party.length) throw recusa('grupo vazio', 'herois');
  /* O Eco não usa a vida única (game.js, Game.startEco): todo herói entra cheio — a tentativa é placar,
   * e um herói ferido de outra luta desigualaria a disputa. Por isso o carry é nulo aqui. */
  const r = refazEm(J, {
    dungeonId: cfg.arena, roomIndex: 0, dificuldade: 'normal',
    semente: t.semente, party, carry: null, escolhePosicao: true,
    lances: c.lances, hashFinal: c.hashFinal,
    regras: t.regras            // a versão das regras guardada na abertura (sala.js confere)
  });
  if (!r.estado || !r.estado.eco) throw recusa('a sala refeita não é a do Eco', 'entrada');
  const placar = J.Engine.ecoPlacar(r.estado);
  return {
    ok: true,
    fase: r.fase,
    rodada: r.rodada,
    turnosJogador: r.turnosJogador,
    hash: r.hash,
    placar
  };
}

function rotas(registra) {
  registra('POST', '/supremo/fecha', (corpo) => fecha(corpo));
}

module.exports = { fecha, rotas };
