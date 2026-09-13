#!/usr/bin/env node
'use strict';
/* PROVA DO CLIENTE COM A AUTORIDADE — o jogo de verdade contra um servidor de mentira.
 *
 *   node tests/autoridade_cliente.js
 *
 * O "cliente" é o game.js + progress.js + db.js + autoridade.js num mundo do
 * Node, jogado pelas portas que a tela usa (Game.startRun, entrarNaSala,
 * onTileClicked, endTurn, update). O "servidor" é um objeto em memória que
 * responde as rotas da API chamando o JUIZ de verdade (recompensa.fecha e
 * economia.executa). Cobra:
 *   - a sala pede o bilhete e nasce da semente do servidor;
 *   - os lances são anotados e a vitória vai para o servidor, que paga;
 *   - a tela de recompensa mostra o recibo do servidor, e o estado do cliente
 *     fica IGUAL ao do servidor (o mesmo hash, a mesma carteira, as mesmas séries);
 *   - uma op (equipar) sobe e os dois hashes batem;
 *   - a forja espera o servidor e o cliente adota o resultado dele;
 *   - uma trapaça local (XP inventado) é desfeita na próxima op. */
const path = require('path');
const raiz = path.join(__dirname, '..');
const est = require(path.join(raiz, 'servidor', 'juiz', 'estado.js'));
const { mundo } = require(path.join(raiz, 'servidor', 'juiz', 'motor.js'));
const { fecha } = require(path.join(raiz, 'servidor', 'juiz', 'recompensa.js'));
const { executa } = require(path.join(raiz, 'servidor', 'juiz', 'economia.js'));
const nodeCrypto = require('crypto');

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a conta de partida (o estado inicial do jogo, Bárbaro nível 22, pedras)
function contaInicial() {
  const w = est.mundoEconomico({ agoraMs: Date.now(), semente: 1 });
  est.poeEstado(w, null, null);
  const J = w.J, P = J.Progress;
  P.state.heroes.sumo.level = 22;
  P.state.heroes.sumo.xp = J.DATA.leveling.xpTable[21];
  Object.keys(J.DATA.stones || {}).forEach((sid) => { P.state.stones[sid] = 300; });
  const peca = Object.keys(J.DATA.items).find((id) => {
    const it = J.DATA.items[id];
    return it && it.slot === 'punho' && (!P.nivelUsoDe || P.nivelUsoDe(id) <= 10);
  });
  P.addItem(peca, 'saque');
  P.save();
  return Object.assign(est.tiraEstado(w), { peca });
}

// ---- o servidor de mentira: guarda o estado e responde as rotas com o juiz
function servidor(inicial) {
  const s = { progress: inicial.progress, db: inicial.db, hash: inicial.hash, versao: 1, salas: {}, chamadas: [] };
  s.rota = async function (rota, op) {
    const corpo = (op && op.body) || {};
    s.chamadas.push(rota);
    if (rota === '/api/sala/abrir') {
      const bilhete = nodeCrypto.randomBytes(9).toString('hex');
      const semente = nodeCrypto.randomBytes(4).readUInt32BE(0) & 0x7fffffff;
      s.salas[bilhete] = { dungeonId: corpo.dungeonId, roomIndex: corpo.roomIndex, dificuldade: corpo.dificuldade,
                           semente, herois: corpo.herois, carry: null, estado: 'aberta' };
      return { ok: true, status: 200, bilhete, semente, carry: null };
    }
    if (rota === '/api/sala/fechar') {
      const sala = s.salas[corpo.bilhete];
      if (!sala || sala.estado !== 'aberta') return { ok: false, status: 409, erro: 'bilhete fechado' };
      try {
        const r = fecha({ conta: { id: 1, gm: false }, bilhete: sala, lances: corpo.lances, hashFinal: corpo.hashFinal,
                          progress: s.progress, db: s.db, contexto: { agoraMs: Date.now(), fatores: {}, guilda: {} } });
        sala.estado = r.fase === 'won' ? 'paga' : 'perdida';
        if (r.fase === 'won') { s.progress = r.progress; s.db = r.db; s.hash = r.hash; s.versao++; }
        return { ok: true, status: 200, fase: r.fase, recompensa: r.recompensa, versao: s.versao, hash: s.hash,
                 progress: s.progress, db: s.db };
      } catch (e) {
        sala.estado = 'recusada';
        return { ok: false, status: 422, erro: e.message, motivo: e.motivo };
      }
    }
    if (rota === '/api/op') {
      if (s.hash && corpo.hashAntes && corpo.hashAntes !== s.hash) {
        return { ok: false, status: 409, versao: s.versao, hash: s.hash, progress: s.progress, db: s.db };
      }
      try {
        const r = await executa({ conta: { id: 1, gm: false }, progress: s.progress, db: s.db, ops: corpo.ops,
                                  semente: 4242, contexto: { agoraMs: Date.now() } });
        s.progress = r.progress; s.db = r.db; s.hash = r.hash; s.versao++;
        const resp = { ok: true, status: 200, versao: s.versao, hash: s.hash, resultados: r.resultados };
        if (!corpo.hashDepois || corpo.hashDepois !== r.hash) { resp.progress = s.progress; resp.db = s.db; }
        return resp;
      } catch (e) {
        return { ok: false, status: 422, erro: e.message, motivo: e.motivo };
      }
    }
    if (rota === '/api/save') return { ok: true, status: 200, versao: s.versao, progress: s.progress, db: s.db };
    return { ok: false, status: 404, erro: 'rota de mentira desconhecida' };
  };
  return s;
}

// ---- o cliente: o jogo de verdade num mundo, com a sessão ligada
function cliente(inicial, srv) {
  const arqs = ['js/core/economia.js', 'js/core/progress.js', 'js/core/db.js', 'js/core/missoes.js',
                'js/core/diario.js', 'js/core/game.js', 'js/core/autoridade.js'];
  const ctx = mundo(arqs, (c) => {
    c.window = c;
    c.crypto = nodeCrypto.webcrypto;
    c.addEventListener = () => {};
    c.JOGO = {
      Sessao: { ativa: () => true, conta: () => ({ id: 1 }), api: (rota, op) => srv.rota(rota, op) },
      Nuvem: { estado: () => ({ ligada: true, principal: true }), defineVersao() {} },
      UI: { toasts: [], toast(t) { this.toasts.push(t); }, repaint() {} }
    };
  });
  const J = ctx.JOGO;
  ctx.localStorage.setItem('soterra-save-v2', JSON.stringify(inicial.progress));
  J.Progress.load();
  J.DB.importar(inicial.db);
  J.Autoridade._fetch = (rota, op) => srv.rota(rota, op);
  J.Autoridade.adota(inicial.progress, inicial.db);      // o hash conhecido parte do do servidor
  return { ctx, J };
}

/* joga a batalha pela porta da tela: a IA decide, o "dedo" toca */
async function jogaPelaTela(J) {
  const G = J.Game, E = J.Engine;
  const st0 = G.state;
  const op = E.placementOptions(st0)[0];
  G.onTileClicked(op.x, op.y);
  let voltas = 0;
  while (G.screen === 'battle' && G.state && G.state.phase === 'playing' && voltas++ < 3000) {
    if (G.isPlayerTurn()) {
      const u = E.activeUnit(G.state);
      const plano = J.AI.planTurn(G.state, u.uid) || [];
      for (const a of plano) {
        if (G.state.phase !== 'playing' || !G.isPlayerTurn()) break;
        if (a.action === 'move') { G.selectedSpellId = null; G.onTileClicked(a.x, a.y); }
        else if (a.action === 'cast') { G.selectedSpellId = a.spellId; G.onTileClicked(a.x, a.y); G.selectedSpellId = null; }
        else if (a.action === 'end') break;
      }
      if (G.state.phase === 'playing' && G.isPlayerTurn()) G.endTurn();
    } else {
      G.update(0.016);
    }
  }
  // a vitória: o update chama o fim da sala, que vai ao servidor
  for (let i = 0; i < 50 && G.screen === 'battle'; i++) { G.update(0.016); await espera(5); }
}

(async () => {
  const inicial = contaInicial();
  let venceu = null;
  for (const [dg, ri] of [['cistern', 0], ['greenhouse', 0], ['cistern', 1], ['greenhouse', 1]]) {
    for (let tentativa = 0; tentativa < 6 && !venceu; tentativa++) {
      const srv = servidor(inicial);
      const { J } = cliente(inicial, srv);
      const G = J.Game;
      G.dificuldade = 'normal';
      G.startRun(['sumo'], dg, {});
      await espera(10);                                    // o bilhete pedido na antessala
      const entrou = G.entrarNaSala();
      await espera(10);
      if (G.screen !== 'battle') { if (entrou === 'esperando') { await espera(20); G.entrarNaSala(); } }
      if (G.screen !== 'battle' || !G.state) continue;
      await jogaPelaTela(J);
      if (G.screen === 'roomClear' || G.screen === 'dungeonComplete') venceu = { J, srv, dg, ri };
    }
    if (venceu) break;
  }
  check('o cliente vence uma sala pela tela, com bilhete do servidor', !!venceu);
  if (!venceu) { console.log('\nRESUMO: FALHOU (sem vitória para provar)'); process.exit(1); }
  const { J, srv } = venceu;
  check('a sala pediu o bilhete antes de nascer e fechou no servidor',
        srv.chamadas.indexOf('/api/sala/abrir') >= 0 && srv.chamadas.indexOf('/api/sala/fechar') > srv.chamadas.indexOf('/api/sala/abrir'),
        srv.chamadas.join(' '));
  const rec = J.Game._ultimaTela || null;
  const hashCli = J.Autoridade.hashLocal();
  check('depois da vitória o estado do cliente é IGUAL ao do servidor (mesmo hash)', hashCli === srv.hash,
        hashCli + ' × ' + srv.hash);
  check('a carteira do cliente é a do servidor, e cresceu', J.DB.exportar().carteira.moedas === srv.db.carteira.moedas &&
        srv.db.carteira.moedas > inicial.db.carteira.moedas, JSON.stringify([J.DB.exportar().carteira, srv.db.carteira]));
  check('o XP do Bárbaro do cliente é o do servidor, e cresceu',
        J.Progress.state.heroes.sumo.xp === srv.progress.heroes.sumo.xp &&
        srv.progress.heroes.sumo.xp > inicial.progress.heroes.sumo.xp);
  const seriesCli = J.Progress.state.inventory.map((e) => e.iid).sort().join(',');
  const seriesSrv = srv.progress.inventory.map((e) => e.iid).sort().join(',');
  check('as séries do saco do cliente são as que o servidor cunhou', seriesCli === seriesSrv, seriesCli + ' × ' + seriesSrv);

  // ---- uma op: equipar a peça
  const idx = J.Progress.state.inventory.findIndex((e) => e.itemId === inicial.peca);
  const okEq = J.Progress.equip('sumo', inicial.peca, idx);
  await J.Autoridade.descarrega();
  check('equipar roda na tela e sobe: os dois hashes batem', okEq === true && J.Autoridade.hashLocal() === srv.hash &&
        srv.progress.heroes.sumo.items.punho === inicial.peca, JSON.stringify([okEq, J.Autoridade.hashLocal(), srv.hash]));

  // ---- a forja espera o servidor
  const r = await J.Autoridade.opAgora('forjarVestida', { heroId: 'sumo', slot: 'punho', usarGuarda: false });
  check('a forja da peça vestida é sorteada no servidor e o cliente adota', r.ok && r.resultado &&
        J.Progress.state.heroes.sumo.itemVar.punho.level === srv.progress.heroes.sumo.itemVar.punho.level &&
        J.Autoridade.hashLocal() === srv.hash, JSON.stringify(r));

  // ---- a trapaça local some na próxima op
  J.Progress.state.heroes.sumo.xp += 999999;           // o console do navegador
  J.Progress.unequip('sumo', 'punho');
  await J.Autoridade.descarrega();
  await espera(10);
  check('XP inventado na tela é desfeito: o cliente adota o estado do servidor',
        J.Progress.state.heroes.sumo.xp === srv.progress.heroes.sumo.xp && J.Autoridade.hashLocal() === srv.hash,
        J.Progress.state.heroes.sumo.xp + ' × ' + srv.progress.heroes.sumo.xp);

  console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('a prova estourou:', e && e.stack); process.exit(1); });
