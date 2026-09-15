#!/usr/bin/env node
'use strict';
/* PROVA DO REGISTRO DA LUTA ABERTA NO CLIENTE (15/09) — o jogo de verdade contra um servidor de mentira.
 *
 *   node tests/luta_aberta_cliente.js
 *
 * O dono (15/09): "arrume as falhas conhecidas". Fechar a aba no meio de uma derrota fugia da vida zerada: o servidor
 * nunca recebia o fechar. O "cliente" é o game.js + autoridade.js num mundo do Node (como tests/autoridade_cliente.js),
 * e o "servidor" responde as rotas refazendo a sala com o JUIZ de verdade. Cobra:
 *   - a antessala não pede bilhete de antemão: bilhete aberto é "Entrar na batalha" apertado;
 *   - a luta com bilhete nasce no registro da conta ('soterra-luta-aberta-v1'), com os lances a cada lance;
 *   - a página fechada no meio: o jogo reaberto (outro mundo, o MESMO armário) fecha a luta guardada ANTES do
 *     próximo bilhete, com os lances guardados e sem o hash do fim — e o registro passa a ser o da luta nova;
 *   - o abandonar fecha a luta na hora;
 *   - a sala em grupo guardada fecha como `largou` antes de o duelo abrir, e a resposta com `largada` vira o aviso;
 *   - o duelo 'aguardando' pergunta de novo sozinho até a resposta de vez (e o keepalive só vai na primeira). */
const path = require('path');
const raiz = path.join(__dirname, '..');
const est = require(path.join(raiz, 'servidor', 'juiz', 'estado.js'));
const { mundo } = require(path.join(raiz, 'servidor', 'juiz', 'motor.js'));
const { fecha } = require(path.join(raiz, 'servidor', 'juiz', 'recompensa.js'));
const nodeCrypto = require('crypto');

const CHAVE = 'soterra-luta-aberta-v1';
let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function contaInicial() {
  const w = est.mundoEconomico({ agoraMs: Date.now(), semente: 1 });
  est.poeEstado(w, null, null);
  const J = w.J;
  J.Progress.state.heroes.sumo.level = 22;
  J.Progress.state.heroes.sumo.xp = J.DATA.leveling.xpTable[21];
  J.Progress.save();
  return est.tiraEstado(w);
}

function servidor(inicial) {
  const s = { progress: inicial.progress, db: inicial.db, hash: inicial.hash, versao: 1, salas: {}, pedidos: [], respostas: {} };
  s.rota = async function (rota, op) {
    const corpo = (op && op.body) || {};
    s.pedidos.push({ rota, corpo: JSON.parse(JSON.stringify(corpo)), keepalive: !!(op && op.keepalive) });
    if (s.respostas[rota]) return s.respostas[rota](corpo);
    if (rota === '/api/sala/abrir') {
      const bilhete = nodeCrypto.randomBytes(9).toString('hex');
      s.salas[bilhete] = { dungeonId: corpo.dungeonId, roomIndex: corpo.roomIndex, dificuldade: corpo.dificuldade,
                           semente: 4242, herois: corpo.herois, carry: null, estado: 'aberta' };
      return { ok: true, status: 200, bilhete, semente: 4242, carry: null };
    }
    if (rota === '/api/sala/fechar') {
      const sala = s.salas[corpo.bilhete];
      if (!sala || sala.estado !== 'aberta') return { ok: false, status: 409, erro: 'bilhete fechado' };
      try {
        const r = fecha({ conta: { id: 1, gm: false }, bilhete: sala, lances: corpo.lances, hashFinal: corpo.hashFinal,
                          progress: s.progress, db: s.db, contexto: { agoraMs: Date.now(), fatores: {}, guilda: {} } });
        sala.estado = r.fase === 'won' ? 'paga' : 'perdida';
        return { ok: true, status: 200, fase: r.fase, recompensa: null, versao: s.versao, hash: s.hash };
      } catch (e) {
        sala.estado = 'recusada';
        return { ok: false, status: 422, erro: e.message, motivo: e.motivo };
      }
    }
    if (rota === '/api/save') return { ok: true, status: 200, versao: s.versao, progress: s.progress, db: s.db };
    if (rota === '/api/vida') return { ok: true, status: 200, agoraMs: Date.now(), msPorPv: 2000, herois: {} };
    if (rota === '/api/op') return { ok: true, status: 200, versao: s.versao, hash: s.hash, resultados: [] };
    return { ok: false, status: 404, erro: 'rota de mentira desconhecida: ' + rota };
  };
  s.rotas = () => s.pedidos.map((p) => p.rota);
  return s;
}

function cliente(inicial, srv, registro) {
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
  if (registro) ctx.localStorage.setItem(CHAVE, registro);          // o MESMO navegador: o armário de antes
  J.Progress.load();
  J.DB.importar(inicial.db);
  J.Autoridade._fetch = (rota, op) => srv.rota(rota, op);
  J.Autoridade.adota(inicial.progress, inicial.db);
  return { ctx, J };
}
function registroDe(c) { try { return JSON.parse(c.ctx.localStorage.getItem(CHAVE) || 'null'); } catch (e) { return null; } }

async function entra(c) {
  const G = c.J.Game;
  G.dificuldade = 'normal';
  G.startRun(['sumo'], 'cistern', {});
  await espera(20);
  const antesDeEntrar = c.srvRotas ? c.srvRotas() : null;
  const r = G.entrarNaSala();
  for (let i = 0; i < 60 && G.screen !== 'battle'; i++) await espera(5);
  return { r, antesDeEntrar };
}

/* um pouco da batalha pela tela: a colocação e a primeira vez do herói */
async function algunsLances(c) {
  const G = c.J.Game, E = c.J.Engine;
  const op = E.placementOptions(G.state)[0];
  G.onTileClicked(op.x, op.y);
  for (let i = 0; i < 2000 && G.state && G.state.phase === 'playing' && !G.isPlayerTurn(); i++) G.update(0.05);
  if (G.state && G.state.phase === 'playing' && G.isPlayerTurn()) G.endTurn();
  await espera(5);
}

(async () => {
  const inicial = contaInicial();
  const srv = servidor(inicial);

  // ---- 1. o bilhete só no "Entrar na batalha", e a luta no registro
  const um = cliente(inicial, srv);
  um.J.Game.dificuldade = 'normal';
  um.J.Game.startRun(['sumo'], 'cistern', {});
  await espera(30);
  check('a antessala não pede bilhete de antemão', srv.rotas().indexOf('/api/sala/abrir') < 0, srv.rotas().join(' '));
  const r1 = um.J.Game.entrarNaSala();
  for (let i = 0; i < 60 && um.J.Game.screen !== 'battle'; i++) await espera(5);
  check('"Entrar na batalha" pede o bilhete e a sala nasce dele', r1 === 'esperando' && um.J.Game.screen === 'battle' &&
        srv.rotas().filter((x) => x === '/api/sala/abrir').length === 1, r1 + ' · ' + um.J.Game.screen + ' · ' + srv.rotas().join(' '));
  const bilhete1 = Object.keys(srv.salas)[0];
  let reg = registroDe(um);
  check('a luta nasce no registro da conta, com o bilhete e sem lance', !!reg && reg.tipo === 'sala' && reg.ref === bilhete1 &&
        reg.lances.length === 0, JSON.stringify(reg));
  await algunsLances(um);
  reg = registroDe(um);
  const guardados = reg ? reg.lances.length : 0;
  check('cada lance vai para o registro (a colocação primeiro)', guardados >= 2 && reg.lances[0].a === 'p', JSON.stringify(reg && reg.lances.slice(0, 3)));

  // ---- 2. a aba fecha aqui: o jogo reaberto no mesmo navegador fecha a luta ANTES do próximo bilhete
  const dois = cliente(inicial, srv, um.ctx.localStorage.getItem(CHAVE));
  const desde = srv.pedidos.length;
  dois.J.Game.dificuldade = 'normal';
  dois.J.Game.startRun(['sumo'], 'cistern', {});
  await espera(20);
  dois.J.Game.entrarNaSala();
  for (let i = 0; i < 80 && dois.J.Game.screen !== 'battle'; i++) await espera(5);
  const depois = srv.pedidos.slice(desde).filter((p) => p.rota === '/api/sala/fechar' || p.rota === '/api/sala/abrir');
  check('o jogo reaberto fecha a luta guardada ANTES de pedir o bilhete novo',
        depois.length >= 2 && depois[0].rota === '/api/sala/fechar' && depois[1].rota === '/api/sala/abrir',
        depois.map((p) => p.rota).join(' '));
  check('com os lances guardados e sem o hash do fim (a sala para no meio)', !!depois[0] && depois[0].corpo.bilhete === bilhete1 &&
        depois[0].corpo.lances.length === guardados && depois[0].corpo.hashFinal === null,
        JSON.stringify(depois[0] && { b: depois[0].corpo.bilhete === bilhete1, n: depois[0].corpo.lances.length, h: depois[0].corpo.hashFinal }));
  check('o servidor refez a sala até ali (perdida, sem recompensa)', srv.salas[bilhete1].estado === 'perdida', srv.salas[bilhete1].estado);
  const bilhete2 = Object.keys(srv.salas).find((b) => b !== bilhete1);
  reg = registroDe(dois);
  check('o registro passa a ser o da luta nova', dois.J.Game.screen === 'battle' && !!reg && reg.ref === bilhete2, JSON.stringify(reg));

  // ---- 3. o abandonar fecha na hora
  await algunsLances(dois);
  const antesAbandono = srv.pedidos.length;
  dois.J.Game.abandonar();
  for (let i = 0; i < 40 && registroDe(dois); i++) await espera(5);
  const fechouAbandono = srv.pedidos.slice(antesAbandono).find((p) => p.rota === '/api/sala/fechar');
  check('abandonar a descida no meio fecha a luta já, com os lances até ali', !!fechouAbandono &&
        fechouAbandono.corpo.bilhete === bilhete2 && fechouAbandono.corpo.lances.length >= 2 && !registroDe(dois),
        JSON.stringify({ f: !!fechouAbandono, reg: registroDe(dois) }));

  // ---- 4. a sala em grupo guardada fecha como `largou` antes de o duelo abrir; a largada vira o aviso
  const A = dois.J.Autoridade;
  A.abreLuta('grupo', 'gid-de-prova-0123456789');
  A.anotaLuta('gid-de-prova-0123456789', [{ a: 'p', x: 1, y: 1, ok: true, de: 'eu' }]);
  srv.respostas['/api/grupo/fechar'] = () => ({ ok: true, status: 200, fase: 'largou', recompensa: null });
  srv.respostas['/api/duelo/abrir'] = () => ({ ok: false, status: 409, motivo: 'vida-zero', heroi: 'sumo', esperaS: 2,
                                               largada: { herois: ['sumo'] } });
  const antesDuelo = srv.pedidos.length;
  const rd = await A.abreDuelo({ did: 'duelo-de-prova-1', herois: ['sumo'] });
  const doDuelo = srv.pedidos.slice(antesDuelo).map((p) => p.rota);
  const grupoFechar = srv.pedidos.slice(antesDuelo).find((p) => p.rota === '/api/grupo/fechar');
  check('a sala em grupo pendente fecha ANTES de o duelo abrir', doDuelo.indexOf('/api/grupo/fechar') >= 0 &&
        doDuelo.indexOf('/api/grupo/fechar') < doDuelo.indexOf('/api/duelo/abrir'), doDuelo.join(' '));
  check('como `largou` (só a parte desta conta), com os lances guardados', !!grupoFechar && grupoFechar.corpo.largou === true &&
        grupoFechar.corpo.gid === 'gid-de-prova-0123456789' && grupoFechar.corpo.lances.length === 1 && !registroDe(dois),
        JSON.stringify(grupoFechar && grupoFechar.corpo));
  check('a resposta com `largada` vira o aviso curto da HUD', rd.ok === false && rd.motivo === 'vida-zero' &&
        dois.J.UI.toasts.some((t) => /Você saiu da última luta sem terminar: os heróis dela voltam do zero/.test(t)),
        JSON.stringify(dois.J.UI.toasts.slice(-3)));

  // ---- 5. o duelo 'aguardando' pergunta de novo sozinho
  let vez = 0;
  srv.respostas['/api/duelo/fechar'] = () => (++vez < 3
    ? { ok: true, status: 200, fase: 'aguardando', motivo: 'desistencia', esperaMs: 5 }
    : { ok: true, status: 200, fase: 'lost', venc: 'B', ranqueado: true, delta: -12, fim: 'desistencia' });
  A._espera = (ms, fn) => setTimeout(fn, 1);
  const antesFechar = srv.pedidos.length;
  const rf = await A.fechaDuelo({ did: 'duelo-de-prova-2', desistiu: true, lado: 'A', lances: [] }, { keepalive: true });
  const fechares = srv.pedidos.slice(antesFechar).filter((p) => p.rota === '/api/duelo/fechar');
  check('o duelo "aguardando" pergunta de novo até a resposta de vez', rf && rf.fase === 'lost' && rf.fim === 'desistencia' &&
        fechares.length === 3, JSON.stringify({ rf, n: fechares.length }));
  check('o keepalive vai só no primeiro pedido (a página ainda estava ali)',
        fechares.length === 3 && fechares[0].keepalive === true && !fechares[1].keepalive && !fechares[2].keepalive,
        JSON.stringify(fechares.map((p) => p.keepalive)));

  console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('a prova estourou:', e && e.stack); process.exit(1); });
