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
 * O SAL DE CADA RODADA (03/10, o dono: "dificulte" o ensaio fora do jogo). Da
 * 2ª rodada em diante a sorte vem de um sal que a API só deu depois de travar
 * o CAMINHO (o hash dos lances até a virada; engine.js, "O SORTEIO RODADA A
 * RODADA"). Cada lance { a: 'r', r, s } passa por `confereSal`: o caminho é
 * recalculado AQUI dos lances que chegaram, tem de ser o que a API travou
 * para aquela rodada (`sais`), e o sal tem de ser o HMAC dele com a chave da
 * tentativa (`chaveSal`, que a API deriva do segredo do servidor e só manda
 * para cá). Jogar outro caminho com o sal de um, inventar o sal ou pular a
 * rodada derruba a tentativa (422, a API não pontua).
 *
 * corpo = { conta: {id, gm}, tentativa: {semente, herois, regras, chaveSal, sais: [{rodada, caminho, sal}]},
 *           lances, hashFinal, progress, db, contexto: {agoraMs} }
 * ou, EM GRUPO (07/10): { membros: [{conta: {id, gm}, dono, herois, progress, db}] (quem lidera primeiro),
 *           tentativa: {semente, regras, chaveSal, sais}, lances, hashFinal, contexto } — um placar só para os dois */
const nodeCrypto = require('crypto');
const { mundoEconomico, poeEstado, sementeDe } = require('./estado');
const { refazEm, recusa } = require('./sala');

function inteiro(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

/* O SAL de uma rodada: HMAC-SHA-256(chave da tentativa, "rodada:caminho"), os 31 bits de cima do
 * começo. A MESMA conta de servidor/supremo.py (sal_da_rodada) — tests/supremo_api.py (test_14) confere as duas. */
function salDe(chave, rodada, caminho) {
  const hex = nodeCrypto.createHmac('sha256', chave).update(String(rodada) + ':' + caminho, 'utf8').digest('hex');
  return parseInt(hex.slice(0, 8), 16) & 0x7fffffff;
}

function fecha(corpo) {
  const c = corpo || {};
  const t = c.tentativa || {};
  if (!inteiro(t.semente)) throw recusa('tentativa inválida', 'entrada');
  const ctxo = c.contexto || {};
  /* A TENTATIVA EM GRUPO (07/10, "descida em grupo com tudo que o solo tem"): `membros` em vez de `conta` —
   * dois a quatro heróis de DUAS contas, cada um com o `dono` (a chave do lockstep), o grupo montado no mundo de
   * cada conta com o estado que a API guardou na abertura; a Câmara é refeita UMA vez, no modo da sala em grupo
   * (sala.js: a vez pelo dono, as marcas de queda e volta, a colocação de quem lidera), e o placar é um só. */
  const emGrupo = Array.isArray(c.membros);
  let J, party, colocador = null;
  if (emGrupo) {
    const membros = c.membros;
    if (membros.length < 2 || membros.length > 4) throw recusa('o grupo precisa de 2 a 4 membros', 'entrada');
    const donos = new Set();
    const mundos = membros.map((m, i) => {
      if (!m || typeof m.dono !== 'string' || !m.dono || !Array.isArray(m.herois) || !m.herois.length || m.herois.length > 2) {
        throw recusa('membro ' + i + ' inválido', 'entrada');
      }
      if (donos.has(m.dono)) throw recusa('dois membros com o mesmo dono', 'entrada');
      donos.add(m.dono);
      const w = mundoEconomico({ gm: !!(m.conta && m.conta.gm), contaId: m.conta && m.conta.id, agoraMs: ctxo.agoraMs,
                                 semente: sementeDe(t.semente + ':eco:' + m.dono) });
      poeEstado(w, m.progress, m.db);
      for (const hid of m.herois) {
        if (!w.J.Progress.hero(hid)) throw recusa('o herói ' + hid + ' não é da conta do membro ' + i, 'herois');
      }
      return { m, w, party: w.J.Progress.battleParty(m.herois).map((p) => Object.assign(p, { dono: m.dono })) };
    });
    J = mundos[0].w.J;
    colocador = mundos[0].m.dono;
    party = [].concat(...mundos.map((x) => x.party));
    if (party.length > 4) throw recusa('a tentativa em grupo tem no máximo 4 heróis', 'entrada');
  } else {
    if (!Array.isArray(t.herois) || !t.herois.length || t.herois.length > 2 || t.herois.some((h) => typeof h !== 'string')) {
      throw recusa('heróis da tentativa inválidos', 'entrada');
    }
    const conta = c.conta || {};
    const w = mundoEconomico({
      gm: !!conta.gm, contaId: conta.id, agoraMs: ctxo.agoraMs,
      // o mundo econômico pede um sorteio; a tentativa não sorteia recompensa nenhuma
      semente: sementeDe(t.semente + ':eco')
    });
    poeEstado(w, c.progress, c.db);
    J = w.J;
    for (const hid of t.herois) {
      if (!J.Progress.hero(hid)) throw recusa('o herói ' + hid + ' não é desta conta', 'herois');
    }
    party = J.Progress.battleParty(t.herois);
  }
  const cfg = J.DATA && J.DATA.eco;
  if (!cfg || !cfg.arena) throw recusa('o Eco não existe nestas regras', 'entrada');
  if (!party || !party.length) throw recusa('grupo vazio', 'herois');
  // a chave da tentativa e os caminhos que a API travou, rodada a rodada
  if (typeof t.chaveSal !== 'string' || !/^[0-9a-f]{64}$/.test(t.chaveSal)) {
    throw recusa('a tentativa veio sem a chave do sorteio das rodadas', 'entrada');
  }
  const chave = Buffer.from(t.chaveSal, 'hex');
  const travados = new Map();
  for (const s of (Array.isArray(t.sais) ? t.sais : [])) {
    if (s && inteiro(s.rodada) && typeof s.caminho === 'string' && inteiro(s.sal)) travados.set(s.rodada, s);
  }
  function confereSal(l, i, lances) {
    if (!inteiro(l.r) || !inteiro(l.s)) return { msg: 'o sal do lance ' + i + ' veio torto', motivo: 'sal-forjado' };
    const linha = travados.get(l.r);
    if (!linha) return { msg: 'o servidor não deu sal para a rodada ' + l.r, motivo: 'sal-nao-pedido' };
    // o caminho é recalculado dos lances que chegaram: o que o cliente DISSE ao pedir só vale se bater
    const caminho = J.Engine.ecoCaminho(lances.slice(0, i));
    if (caminho !== linha.caminho) {
      return { msg: 'os lances até a rodada ' + l.r + ' não são os que o servidor travou', motivo: 'caminho-trocado' };
    }
    const certo = salDe(chave, l.r, caminho);
    if (l.s !== certo || linha.sal !== certo) return { msg: 'o sal da rodada ' + l.r + ' não é o do servidor', motivo: 'sal-forjado' };
    return null;
  }
  /* O Eco não usa a vida única (game.js, Game.startEco): todo herói entra cheio — a tentativa é placar,
   * e um herói ferido de outra luta desigualaria a disputa. Por isso o carry é nulo aqui. */
  const r = refazEm(J, {
    dungeonId: cfg.arena, roomIndex: 0, dificuldade: 'normal',
    semente: t.semente, party: JSON.parse(JSON.stringify(party)), carry: null, escolhePosicao: true,
    lances: c.lances, hashFinal: c.hashFinal,
    regras: t.regras,           // a versão das regras guardada na abertura (sala.js confere)
    confereSal,
    // 07/10: em grupo, a sala refeita como a sala em grupo (a vez pelo dono; a colocação de quem lidera)
    modo: emGrupo ? 'grupo' : undefined, colocador, carryRede: emGrupo
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

module.exports = { fecha, rotas, salDe };
