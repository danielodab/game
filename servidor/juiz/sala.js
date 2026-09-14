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
/* NA SALA EM GRUPO (e no duelo pela Rede) o herói é de GENTE quando tem dono;
 * com `ia` marcada o dono caiu, e o turno dele PASSA (game.js, updateRede) —
 * ninguém joga por ele. Mascote e invocação seguem com a IA. */
function ehDeGente(u) {
  return !!(u && (u.kind === 'hero' || u.kind === 'fusion') && u.dono);
}

/* O HP que atravessa de uma sala para a outra (13/09, a vida entre as salas; a mesma
 * regra do Game.entrarNaSala). O número do carry JÁ É o da porta: o servidor somou ao PV
 * do fim da sala anterior a vida que voltou na sala de espera (1 PV a cada 2 s) e as
 * poções bebidas lá, ao abrir o bilhete (servidor/salas.py, vida_heroi — 14/09, a vida única). Aqui ele
 * só se prende ao PV máximo da sala nova. Herói a 0 não chega (o servidor não abre a
 * sala); o piso de 1 é só para a sala nunca nascer com um herói vivo sem vida. Era
 * "vivo recupera metade do que falta; caído volta com 30%" até o dono pedir a espera. */
function vidaDaPorta(u, prev) {
  if (typeof prev !== 'number' || !isFinite(prev)) return;
  u.hp = Math.max(1, Math.min(u.hpMax, Math.floor(prev)));
}
function aplicaCarry(st, carry) {
  if (!carry || typeof carry !== 'object') return;
  for (const u of st.units) {
    if (u.kind !== 'hero') continue;
    vidaDaPorta(u, carry[u.heroId || u.defId]);
  }
}

/* O PV da sala em GRUPO: a mesma regra, com a chave `dono:heroId` (o heroId é a
 * classe e colide entre os dois jogadores) — game.js, aplicaCarry. */
function aplicaCarryRede(st, carry) {
  if (!carry || typeof carry !== 'object') return;
  for (const u of st.units) {
    if (u.kind !== 'hero') continue;
    vidaDaPorta(u, carry[(u.dono || '') + ':' + (u.heroId || u.defId)]);
  }
}

function inteiro(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
function objetoOuNull(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; }

/* {heroId: PV máximo} dos heróis de UM lado da batalha (14/09, o duelo e a vida única): a API
 * guarda com o PV do fim (Engine.vidaDoLado) para saber quando a vida do herói enche. */
function vidaMaxDoLado(st, side) {
  const out = {};
  for (const u of (st && st.units) || []) {
    if (u.kind !== 'hero' || u.side !== side) continue;
    if (typeof u.hpMax === 'number' && isFinite(u.hpMax) && u.hpMax > 0) out[u.heroId || u.defId] = Math.floor(u.hpMax);
  }
  return out;
}

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
  if (c.modo === 'duelo') {
    const dupla = (d) => Array.isArray(d) && d.length >= 1 && d.length <= 2;
    if (!dupla(c.duplaA) || !dupla(c.duplaB)) throw recusa('duplas inválidas', 'entrada');
  } else if (!Array.isArray(c.party) || !c.party.length || c.party.length > 4) {
    throw recusa('grupo inválido', 'entrada');
  }
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
    if (c.modo === 'duelo') {
      // o duelo pela Rede: a arena sorteada, as duas duplas e a semente dos dois (game.js, _iniciaDueloRede).
      // 14/09, a vida única (o dono: "se o jogador estiver com a vida na metade e começar uma batalha sendo
      // pvp… a vida vai começar onde estava"): vidaA / vidaB = {heroId: PV} que a API guardou no
      // POST /api/duelo/abrir de cada lado; o motor aplica ANTES do primeiro turno (o aplicaCarry não
      // serve aqui: a chave heroId colide entre os dois lados). Sem a vida, o lado entra cheio
      st = E.createDuelSala(c.dungeonId, c.roomIndex, c.duplaA, c.duplaB,
        { seed: c.semente, vidaA: objetoOuNull(c.vidaA), vidaB: objetoOuNull(c.vidaB) });
    } else {
      st = E.createBattle(c.dungeonId, c.roomIndex, c.party,
        { seed: c.semente, dificuldade: c.dificuldade || 'normal', escolhePosicao: c.escolhePosicao !== false });
    }
  } catch (e) {
    throw recusa('a sala não existe nestas regras', 'entrada');
  }
  if (!st || !st.units) throw recusa('a sala não existe nestas regras', 'entrada');
  if (andarPoco) J.Poco.escalaEstado(st, andarPoco);        // a escalada antes do PV, como no Game
  if (c.carryRede) aplicaCarryRede(st, c.carry);
  else if (c.modo !== 'duelo') aplicaCarry(st, c.carry);
  E.events.length = 0;

  let passos = 0;
  function conta() {
    if (++passos > PASSOS_MAX) throw recusa('a sala não termina', 'passos');
  }
  const emRede = c.modo === 'grupo' || c.modo === 'duelo';
  // os turnos da IA até a vez voltar ao jogador (ou a sala acabar): o Game sem tela
  function rodaIA() {
    while (st.phase === 'playing') {
      const u = E.activeUnit(st);
      if (!u) return;
      if (emRede && ehDeGente(u)) {
        if (!u.ia) return;                       // a vez é de gente conectada: espera o lance
        E.endTurn(st);                            // o dono caiu: o turno dele passa
        E.events.length = 0;
        conta();
        continue;
      }
      if (!emRede && ehDoJogador(st, u)) return;
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
    /* O GOLE NA BATALHA (13/09): a poção saiu da batalha e foi para a sala de espera entre
     * as salas (pedido do dono). O lance {a:'po'} de uma página velha ou forjada derruba a
     * sala inteira — solo, grupo ou duelo —, com um motivo que diz o que houve */
    if (l.a === 'po') throw recusa('poção não se bebe na batalha: é na sala de espera entre as salas', 'pocao-na-batalha');
    // AS MARCAS DA REDE (13/09): o que muda a batalha fora dos lances, anotado no
    // ponto em que aconteceu no motor de quem manda — o dono que caiu (ia), que
    // voltou, e o herói de quem saiu da batalha, que morre
    if (l.a === 'x') {
      if (!emRede) throw recusa('marca de rede numa sala solo', 'lance');
      const alvo = E.findUnit(st, l.u);
      if (!alvo || !ehDeGente(alvo)) throw recusa('marca numa unidade que não é de gente', 'lance');
      if (l.ev === 'ia') alvo.ia = !!l.v;
      else if (l.ev === 'morte') { if (alvo.alive && !alvo.offBoard && E.processDeath) E.processDeath(st, alvo); }
      else throw recusa('marca desconhecida: ' + String(l.ev), 'lance');
      E.events.length = 0;
      continue;
    }
    if (l.a === 'p') {
      if (st.phase !== 'placing') throw recusa('colocação fora da hora', 'vez');
      if (emRede && c.colocador && l.de !== c.colocador) throw recusa('a colocação é de quem lidera', 'vez');
    } else {
      rodaIA();
      if (FIM[st.phase]) throw recusa('lance depois do fim da sala', 'depois-do-fim');
      const ativo = E.activeUnit(st);
      const daVez = emRede ? (ehDeGente(ativo) && !ativo.ia && ativo.dono === l.de) : ehDoJogador(st, ativo);
      if (st.phase !== 'playing' || !daVez) throw recusa('lance fora da vez', 'vez');
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

module.exports = { refaz, refazEm, rotas, ehDoJogador, ehDeGente, aplicaCarry, aplicaCarryRede, recusa, vidaMaxDoLado };
