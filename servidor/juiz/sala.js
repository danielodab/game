'use strict';
/* A SALA REFEITA — o juiz confere a batalha (dono: servidor).
 *
 * O cliente joga a sala com a SEMENTE que o servidor deu no bilhete e anota
 * cada lance do jogador no mesmo formato da batalha em dupla (coop.js paraFio):
 *   { a: 'p'|'m'|'c'|'e'|'f', u, x, y, s, alvo, ok, h? }
 * No fim, o servidor manda a semente, o grupo (montado do save que ELE tem) e
 * os lances para cá. O juiz cria a MESMA batalha, joga os turnos da IA do
 * mesmo jeito que o Game faz sem tela (plano inteiro, executa, encerra) e
 * aplica cada lance. Dano, esquiva, morte e vitória saem do motor daqui — o
 * número que o navegador mostrou não entra em conta nenhuma.
 *
 * O que derruba a sala (422, e a API não paga nada):
 *   - lance de quem não tem a vez, ou de uma unidade que não é a da vez;
 *   - lance cujo resultado (ok) diverge do que o cliente anotou;
 *   - hash do meio ou do fim diferente do que o cliente viu;
 *   - lance depois do fim, ou uma sala que não termina (teto de passos).
 * O cliente honesto nunca cai aqui: ele roda o mesmo motor com a mesma semente. */
const { mundo } = require('./motor');

const FIM = { won: true, lost: true, empate: true };
const PASSOS_MAX = 5000;          // turnos inteiros (da IA ou do jogador); uma sala longa tem ~100
const LANCES_MAX = 6000;

function recusa(msg, motivo) {
  const e = new Error(msg);
  e.juiz = true;
  e.motivo = motivo || null;
  return e;
}

/* Quem o JOGADOR controla na sala solo: o herói e a fusão do lado dele — a
 * mesma regra do Game (isPlayerUnitLocal). Mascote e invocação são da IA. */
function ehDoJogador(st, u) {
  if (!u || (u.kind !== 'hero' && u.kind !== 'fusion')) return false;
  if (u.side === 'player') return true;
  return !!(st.pvp && u.side === 'enemy');
}

/* O HP que atravessa de uma sala para a outra, com a regra do Game.entrarNaSala:
 * vivo recupera metade do que falta; caído volta com 30%. */
function aplicaCarry(st, carry) {
  if (!carry || typeof carry !== 'object') return;
  for (const u of st.units) {
    if (u.kind !== 'hero') continue;
    const prev = carry[u.heroId || u.defId];
    if (typeof prev !== 'number' || !isFinite(prev)) continue;
    if (prev > 0) u.hp = Math.min(u.hpMax, prev + Math.round((u.hpMax - prev) * 0.5));
    else u.hp = Math.max(1, Math.round(u.hpMax * 0.3));
  }
}

function inteiro(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

/* Um lance como o Game.executa aplica (sem rede). */
function executa(J, st, l) {
  const E = J.Engine;
  if (l.a === 'p') return !!E.place(st, l.x, l.y);
  if (l.a === 'm') return !!E.move(st, l.u, l.x, l.y);
  if (l.a === 'c') return !!E.cast(st, l.u, l.s, l.x, l.y);
  if (l.a === 'e') { if (st.phase === 'playing') E.endTurn(st); return true; }
  if (l.a === 'f') {
    const fa = E.findUnit(st, l.u), fb = E.findUnit(st, l.alvo);
    const donoA = fa ? (fa.dono || null) : null, donoB = fb ? (fb.dono || null) : null;
    if (!fa || !fb || donoA !== donoB) return false;
    return !!(J.Fusion && J.Fusion.declare && J.Fusion.declare(st, l.u, l.alvo));
  }
  throw recusa('lance desconhecido: ' + String(l.a), 'lance');
}

/* entrada = { dungeonId, roomIndex, dificuldade, semente, party, carry,
 *             escolhePosicao (padrão true), lances, hashFinal }
 * Num mundo NOVO, só do combate. Quem precisa da economia no mesmo mundo (a
 * recompensa) chama refazEm com o mundo já montado. */
function refaz(entrada) {
  const r = refazEm(mundo((entrada && entrada.extras) || []).JOGO, entrada);
  delete r.estado;
  return r;
}

/* O mesmo refazer num mundo pronto (`J` = o JOGO dele). Devolve também
 * `estado` (a batalha no fim) e `turnosJogador` (quantas vezes o jogador
 * encerrou a vez: a régua do tempo mínimo da sala). */
function refazEm(J, entrada) {
  const c = entrada || {};
  if (typeof c.dungeonId !== 'string' || !inteiro(c.roomIndex) || c.roomIndex < 0) {
    throw recusa('sala inválida', 'entrada');
  }
  if (!inteiro(c.semente)) throw recusa('semente inválida', 'entrada');
  if (!Array.isArray(c.party) || !c.party.length || c.party.length > 4) throw recusa('grupo inválido', 'entrada');
  const lances = Array.isArray(c.lances) ? c.lances : [];
  if (lances.length > LANCES_MAX) throw recusa('lances demais', 'entrada');

  const E = J.Engine;
  let turnosJogador = 0;
  if (typeof c.preparar === 'function') c.preparar(J);    // provas: ganchos no mundo antes da sala

  // o Poço: o andar é montado da semente (poco.js), como o cliente faz ao entrar
  const andarPoco = (c.dungeonId === 'poco') ? c.roomIndex + 1 : 0;
  if (andarPoco) {
    if (!J.Poco || !J.Poco.salaSemeada || !J.Poco.poeSala(andarPoco, J.Poco.salaSemeada(andarPoco, c.semente))) {
      throw recusa('o Poço não montou o andar', 'entrada');
    }
  }
  let st;
  try {
    st = E.createBattle(c.dungeonId, c.roomIndex, c.party,
      { seed: c.semente, dificuldade: c.dificuldade || 'normal', escolhePosicao: c.escolhePosicao !== false });
  } catch (e) {
    throw recusa('a sala não existe nestas regras', 'entrada');
  }
  if (!st || !st.units) throw recusa('a sala não existe nestas regras', 'entrada');
  if (andarPoco) J.Poco.escalaEstado(st, andarPoco);        // a escalada antes do PV, como no Game
  aplicaCarry(st, c.carry);
  E.events.length = 0;

  let passos = 0;
  function conta() {
    if (++passos > PASSOS_MAX) throw recusa('a sala não termina', 'passos');
  }
  // os turnos da IA até a vez voltar ao jogador (ou a sala acabar): o Game sem tela
  function rodaIA() {
    while (st.phase === 'playing') {
      const u = E.activeUnit(st);
      if (!u || ehDoJogador(st, u)) return;
      let plano = null;
      try { plano = J.AI.planTurn(st, u.uid); } catch (e) { plano = null; }
      if (!plano || !plano.length) plano = [{ action: 'end' }];
      let acabou = false;
      for (let i = 0; i < plano.length && st.phase === 'playing'; i++) {
        const a = plano[i];
        try {
          if (a.action === 'move') E.move(st, u.uid, a.x, a.y);
          else if (a.action === 'cast') E.cast(st, u.uid, a.spellId, a.x, a.y);
          else if (a.action === 'end') { E.endTurn(st); acabou = true; break; }
        } catch (e) { /* o Game também engole erro de execução da IA */ }
      }
      if (!acabou && st.phase === 'playing') E.endTurn(st);
      E.events.length = 0;
      conta();
    }
  }

  for (let i = 0; i < lances.length; i++) {
    const l = lances[i];
    if (!l || typeof l !== 'object' || typeof l.a !== 'string') throw recusa('lance torto', 'lance');
    if (FIM[st.phase]) throw recusa('lance depois do fim da sala', 'depois-do-fim');
    if (l.a === 'p') {
      if (st.phase !== 'placing') throw recusa('colocação fora da hora', 'vez');
    } else {
      rodaIA();
      if (FIM[st.phase]) throw recusa('lance depois do fim da sala', 'depois-do-fim');
      const ativo = E.activeUnit(st);
      if (st.phase !== 'playing' || !ehDoJogador(st, ativo)) throw recusa('lance fora da vez', 'vez');
      // move, feitiço e fusão só com a unidade da vez; o 'e' encerra a vez dela
      if ((l.a === 'm' || l.a === 'c' || l.a === 'f') && l.u !== ativo.uid) {
        throw recusa('lance com uma unidade que não é a da vez', 'unidade');
      }
      if (l.a === 'e') { conta(); turnosJogador++; }
    }
    let ok;
    try { ok = executa(J, st, l); } catch (e) { if (e && e.juiz) throw e; ok = false; }
    E.events.length = 0;
    if (typeof l.ok === 'boolean' && l.ok !== ok) throw recusa('o lance ' + i + ' deu diferente aqui', 'divergiu');
    if (inteiro(l.h) && E.hash(st) !== l.h) throw recusa('o estado divergiu no lance ' + i, 'divergiu');
  }
  rodaIA();

  const hash = E.hash(st);
  if (inteiro(c.hashFinal) && c.hashFinal !== hash) throw recusa('o fim da sala divergiu', 'divergiu');

  const mortos = [], herois = [];
  for (const u of st.units) {
    if (u.side === 'enemy' && !u.alive && !st.pvp) mortos.push(u.defId);
    if (u.kind === 'hero' && u.side === 'player') {
      herois.push({ heroId: u.heroId || u.defId, hp: u.alive ? u.hp : 0, vivo: !!u.alive, fundido: !!u.fusedInto });
    }
  }
  return {
    ok: true,
    fase: st.phase,
    turno: st.turno || 0,
    rodada: st.round || 0,
    hash: hash,
    mortos: mortos,
    desafio: st.desafio ? { id: st.desafio.id || null, cumprido: !!st.desafio.cumprido } : null,
    herois: herois,
    passos: passos,
    turnosJogador: turnosJogador,
    estado: st
  };
}

function rotas(registra) {
  registra('POST', '/refaz', (corpo) => refaz(corpo));
}

module.exports = { refaz, refazEm, rotas, ehDoJogador, aplicaCarry, recusa };
