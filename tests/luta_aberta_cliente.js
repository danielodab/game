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

/* `comRelogio` (19/09): o mundo do juiz tem um setTimeout que nunca dispara; a fila de retentativa do fechar da guerra
 * precisa de um de verdade (encurtado a 20 ms) — só nos clientes que a exercitam */
function cliente(inicial, srv, registro, comRelogio) {
  const arqs = ['js/core/economia.js', 'js/core/progress.js', 'js/core/db.js', 'js/core/missoes.js',
                'js/core/diario.js', 'js/core/game.js', 'js/core/autoridade.js'];
  const ctx = mundo(arqs, (c) => {
    c.window = c;
    c.crypto = nodeCrypto.webcrypto;
    if (comRelogio) { c.setTimeout = (fn, ms) => setTimeout(fn, Math.min(ms || 0, 20)); c.clearTimeout = clearTimeout; }
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

  // ---- 4b. 08/10 à noite: a sala em grupo que o grupo.js ainda pode RETOMAR (a recarga no meio da batalha) não é largada
  //          na abertura do jogo — só a chamada da abertura pergunta (`retomavel`); qualquer outro fechar é desistir de verdade
  A.abreLuta('grupo', 'gid-retomavel-0123456789');
  A.anotaLuta('gid-retomavel-0123456789', [{ a: 'p', x: 1, y: 1, ok: true, de: 'eu' }]);
  dois.J.Grupo = { retomavel: (ref) => ref === 'gid-retomavel-0123456789' };
  const antesRet = srv.pedidos.length;
  const rRet = await A.fechaPendente({ retomavel: true });
  check('a abertura do jogo NÃO larga a sala em grupo que o grupo.js diz retomável: nenhum fechar sai e o registro fica',
        rRet === null && srv.pedidos.length === antesRet && !!registroDe(dois) && registroDe(dois).ref === 'gid-retomavel-0123456789',
        JSON.stringify({ r: rRet, n: srv.pedidos.length - antesRet, reg: registroDe(dois) }));
  const rRet2 = await A.fechaPendente();
  check('...mas o fechar pendente de qualquer outra abertura (o jogador desistindo de verdade) a fecha como `largou`, como sempre',
        !!rRet2 && rRet2.fase === 'largou' && srv.pedidos.slice(antesRet).some((p) => p.rota === '/api/grupo/fechar' && p.corpo.largou === true) &&
        !registroDe(dois), JSON.stringify(rRet2));
  dois.J.Grupo = { retomavel: () => false };
  A.abreLuta('grupo', 'gid-nao-retomavel-01234567');
  const rRet3 = await A.fechaPendente({ retomavel: true });
  check('e a sala que o grupo.js não retoma (registro velho, outra sala) é largada na abertura como antes',
        !!rRet3 && rRet3.fase === 'largou' && !registroDe(dois), JSON.stringify(rRet3));
  delete dois.J.Grupo;

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

  // ---- 6. A GUERRA DE GUILDA NA LUTA ABERTA (19/09, o dono: "dê uma revisada na guerra de guild"): o corpo do fechar
  //         guardado reenvia ao abrir o jogo; 'aguardando' pergunta de novo; o servidor fora por instantes tenta de
  //         novo; o 422 do juiz com fase 'aguardando' não é final; quem SAIU declara a saída (keepalive) — e ao abrir
  const G1 = 'guerra-0000000000000000cafe', G2 = 'guerra-0000000000000000beef';
  A.abreLuta('guerra', G1);
  A.anotaLuta(G1, [{ a: 'e', ok: true, de: 'ana' }], true, { gid: G1, lances: [{ a: 'e', ok: true, de: 'ana' }], hashFinal: 4242, fotografada: false });
  reg = registroDe(dois);
  check('a guerra pronta entra no registro da conta como luta aberta, com o corpo do fechar (o hash do fim)',
        !!reg && reg.tipo === 'guerra' && reg.ref === G1 && reg.fim === true && reg.corpo && reg.corpo.hashFinal === 4242, JSON.stringify(reg));
  let vezG = 0;
  srv.respostas['/api/guerra/fechar'] = (corpo) => (++vezG < 3
    ? { ok: true, status: 200, gid: corpo.gid, fase: 'aguardando', esperaAte: Date.now() + 5 }
    : { ok: true, status: 200, gid: corpo.gid, fase: 'won', venc: 'A', lado: 'A', venceu: true, xp: 40, guilda: { id: 1, nome: 'Lanças do Norte' }, vida: {} });
  const tres = cliente(inicial, srv, dois.ctx.localStorage.getItem(CHAVE), true);   // a página foi embora nos 2,5 s de quem não manda
  tres.J.Autoridade._espera = (ms, fn) => setTimeout(fn, 1);
  const antesG = srv.pedidos.length;
  tres.J.Game.dificuldade = 'normal';
  tres.J.Game.startRun(['sumo'], 'cistern', {});
  await espera(20);
  tres.J.Game.entrarNaSala();
  for (let i = 0; i < 300 && tres.J.Game.screen !== 'battle'; i++) await espera(5);
  const doG = srv.pedidos.slice(antesG).map((p) => p.rota);
  const fechG = srv.pedidos.slice(antesG).filter((p) => p.rota === '/api/guerra/fechar');
  check('o jogo reaberto fecha a guerra guardada ANTES do bilhete novo, com o corpo guardado',
        doG.indexOf('/api/guerra/fechar') >= 0 && doG.indexOf('/api/sala/abrir') > doG.lastIndexOf('/api/guerra/fechar') &&
        fechG[0].corpo.gid === G1 && fechG[0].corpo.hashFinal === 4242 && fechG[0].corpo.lances.length === 1, doG.join(' '));
  reg = registroDe(tres);
  check('"aguardando" pergunta de novo até a resposta de vez (3 pedidos) e o registro passa a ser o da sala nova',
        fechG.length === 3 && tres.J.Game.screen === 'battle' && !!reg && reg.tipo === 'sala', fechG.length + ' · ' + JSON.stringify(reg));
  // o servidor fora por instantes: status 0 duas vezes, ok na terceira (a fila de retentativa; o keepalive só na primeira)
  let vez0 = 0;
  srv.respostas['/api/guerra/fechar'] = (corpo) => (++vez0 < 3 ? { ok: false, status: 0, erro: 'o servidor está fora (não respondeu)' }
                                                                : { ok: true, status: 200, gid: corpo.gid, fase: 'won', xp: 40 });
  tres.J.Autoridade.RETENTA_MS = 1;
  const antes0 = srv.pedidos.length;
  const r0 = await tres.J.Autoridade.fechaGuerra({ gid: G2, lances: [], hashFinal: null, fotografada: false }, { keepalive: true });
  const f0 = srv.pedidos.slice(antes0).filter((p) => p.rota === '/api/guerra/fechar');
  check('o servidor fora por instantes: o fechar da guerra tenta de novo até responder (status 0 duas vezes, ok na terceira)',
        r0 && r0.ok && r0.fase === 'won' && f0.length === 3 && f0[0].keepalive === true && !f0[1].keepalive && !f0[2].keepalive,
        JSON.stringify({ r0, n: f0.length, ka: f0.map((p) => p.keepalive) }));
  check('e a tela é avisada uma vez ("Conferindo a guerra com o servidor…")', tres.J.UI.toasts.filter((t) => /Conferindo a guerra/.test(t)).length === 1,
        JSON.stringify(tres.J.UI.toasts.slice(-2)));
  // o 422 do juiz (registro recusado) com fase 'aguardando' NÃO é final: o limpo de outro vence, e cada volta avisa a tela
  let vez4 = 0; const aguardos = [];
  srv.respostas['/api/guerra/fechar'] = (corpo) => (++vez4 < 2
    ? { ok: false, status: 422, erro: 'registro recusado', motivo: 'recusada', fase: 'aguardando', esperaAte: Date.now() + 5 }
    : { ok: true, status: 200, gid: corpo.gid, fase: 'won', xp: 40 });
  const r4 = await tres.J.Autoridade.fechaGuerra({ gid: G2, lances: [], hashFinal: null, fotografada: false }, null, (r) => aguardos.push(r));
  check('o 422 do juiz com fase "aguardando" não é final: pergunta de novo, e cada volta avisa a tela',
        r4 && r4.ok && r4.fase === 'won' && aguardos.length === 1 && aguardos[0].recusada === true && aguardos[0].fase === 'aguardando',
        JSON.stringify({ r4, aguardos }));
  // quem SAI da guerra pronta declara (POST /api/guerra/sair {gid}, keepalive): o registro guarda `saiu` até a resposta
  tres.J.Autoridade.abreLuta('guerra', G2);
  let vezS = 0;
  srv.respostas['/api/guerra/sair'] = (corpo) => (++vezS < 2 ? { ok: false, status: 0 } : { ok: true, status: 200, gid: corpo.gid, herois: ['sumo'] });
  const pS = tres.J.Autoridade.saiDaGuerra(G2);
  const regS = registroDe(tres);
  check('quem sai: o registro guarda `saiu` enquanto o servidor não responde', !!regS && regS.tipo === 'guerra' && regS.ref === G2 && regS.saiu === true, JSON.stringify(regS));
  const rS = await pS;
  const fS = srv.pedidos.filter((p) => p.rota === '/api/guerra/sair');
  check('a saída vai com keepalive e o gid, tenta de novo, e o registro some com a resposta',
        rS && rS.ok && fS.length === 2 && fS[0].keepalive === true && fS[0].corpo.gid === G2 && !registroDe(tres), JSON.stringify({ rS, n: fS.length, ka: fS[0] && fS[0].keepalive }));
  // a página que foi embora antes de a saída sair: o jogo reaberto declara a saída (não o fechar)
  tres.J.Autoridade.abreLuta('guerra', G2);
  const regRaw = JSON.parse(tres.ctx.localStorage.getItem(CHAVE)); regRaw.saiu = true;
  tres.ctx.localStorage.setItem(CHAVE, JSON.stringify(regRaw));
  srv.respostas['/api/guerra/sair'] = (corpo) => ({ ok: true, status: 200, gid: corpo.gid });
  const cinco = cliente(inicial, srv, tres.ctx.localStorage.getItem(CHAVE), true);
  const antes5 = srv.pedidos.length;
  await cinco.J.Autoridade.fechaPendente();
  const do5 = srv.pedidos.slice(antes5);
  check('o jogo reaberto com a saída pendente declara a saída (POST /api/guerra/sair {gid}), não o fechar, e esquece o registro',
        do5.length === 1 && do5[0].rota === '/api/guerra/sair' && do5[0].corpo.gid === G2 && !registroDe(cinco), JSON.stringify(do5.map((p) => p.rota)));

  // ---- 03/10 (revisão): a tentativa do Eco é luta aberta. A que ainda está sendo conferida não pode morrer no
  // próximo "Enfrentar o Eco" (o abrir do servidor vence a aberta como 'outra-aberta'), e a da aba fechada antes
  // da resposta fecha na volta com os lances guardados
  const srvE = servidor(inicial);
  let nTent = 0, soltaFechar = null;
  srvE.respostas['/api/supremo/abrir'] = () => ({ ok: true, status: 200, tentativa: 'eco-tent-' + (++nTent), semente: 77,
                                                  restantes: 3 - nTent });
  srvE.respostas['/api/supremo/fechar'] = () => new Promise((res) => {
    soltaFechar = () => res({ ok: true, status: 200, dano: 10, pontos: 10, derrubou: false, bonus: 0, rodada: 1 });
  });
  const seis = cliente(inicial, srvE);
  const rE = seis.J.Game.startEco(['sumo']);
  for (let i = 0; i < 60 && seis.J.Game.screen !== 'battle'; i++) await espera(5);
  let regE = registroDe(seis);
  check('a tentativa do Eco nasce no registro da conta como luta aberta', rE === 'esperando' && seis.J.Game.screen === 'battle' &&
        !!regE && regE.tipo === 'eco' && regE.ref === 'eco-tent-1', rE + ' ' + seis.J.Game.screen + ' ' + JSON.stringify(regE));
  seis.J.Game.abandonar();                       // o fechar sai e fica sem resposta (o servidor "pensando")
  await espera(10);
  const r2 = seis.J.Game.startEco(['sumo']);
  await espera(30);
  const rotasE = srvE.rotas().filter((r) => r.indexOf('/api/supremo/') === 0);
  check('com o fechar a caminho, o "Enfrentar o Eco" seguinte ESPERA: nenhum abrir sai antes da resposta',
        r2 === 'esperando' && rotasE.join(' ') === '/api/supremo/abrir /api/supremo/fechar', r2 + ' ' + rotasE.join(' '));
  soltaFechar();
  for (let i = 0; i < 60 && nTent < 2; i++) await espera(5);
  await espera(10);
  const rotasE2 = srvE.rotas().filter((r) => r.indexOf('/api/supremo/') === 0);
  regE = registroDe(seis);
  check('respondido o fechar, o abrir sai e o registro passa a ser a tentativa nova',
        rotasE2.join(' ') === '/api/supremo/abrir /api/supremo/fechar /api/supremo/abrir' && !!regE && regE.ref === 'eco-tent-2',
        rotasE2.join(' ') + ' ' + JSON.stringify(regE));
  // a aba fechada antes da resposta: o jogo reaberto (o mesmo armário) fecha a tentativa guardada
  const guardado = seis.ctx.localStorage.getItem(CHAVE);
  srvE.respostas['/api/supremo/fechar'] = () => ({ ok: true, status: 200, dano: 5, pontos: 5, derrubou: false, bonus: 0, rodada: 1 });
  const antes = srvE.pedidos.length;
  const sete = cliente(inicial, srvE, guardado);
  await sete.J.Autoridade.fechaPendente();
  const depoisE = srvE.pedidos.slice(antes).filter((p) => p.rota === '/api/supremo/fechar');
  check('o jogo reaberto fecha a tentativa guardada, com a tentativa e os lances, e esquece o registro',
        depoisE.length === 1 && depoisE[0].corpo.tentativa === 'eco-tent-2' && Array.isArray(depoisE[0].corpo.lances) &&
        !registroDe(sete), JSON.stringify(depoisE.map((p) => p.corpo.tentativa)));

  // ---- 08/10 à noite (o dono: "todas as XPs foram zeradas" numa sala em grupo): a SALA EM GRUPO 'aguardando' — o
  //      registro fotografado não refaz a sala; o servidor espera o limpo do outro — pergunta de novo sozinha até a
  //      resposta de vez (antes a tela zerava na primeira resposta), cada volta avisa a tela, e o teto de voltas segura
  const AG = tres.J.Autoridade;
  let vezAg = 0; const esperas = [];
  srv.respostas['/api/grupo/fechar'] = (corpo) => (++vezAg < 3
    ? { ok: true, status: 200, fase: 'aguardando', motivo: 'fotografada', recompensa: null, esperaAte: Math.floor(Date.now() / 1000) + 120, esperaMs: 5 }
    : { ok: true, status: 200, fase: 'won', recompensa: { xpGanho: 6, xpPorHeroi: { sumo: 6 } }, versao: 3, hash: 1 });
  const antesAg = srv.pedidos.length;
  const rAg = await AG.fechaGrupo({ gid: 'grupo-0000000000000000c0de', lances: [], hashFinal: 42, fotografada: true }, (r, n) => esperas.push([r.motivo, n]));
  const fAg = srv.pedidos.slice(antesAg).filter((p) => p.rota === '/api/grupo/fechar');
  check('a sala em grupo "aguardando" pergunta de novo até a resposta de vez (3 pedidos, o mesmo corpo) e resolve com a paga',
        rAg && rAg.ok && rAg.fase === 'won' && rAg.recompensa && rAg.recompensa.xpGanho === 6 && fAg.length === 3 &&
        fAg.every((p) => p.corpo.fotografada === true && p.corpo.hashFinal === 42), JSON.stringify({ rAg, n: fAg.length }));
  check('cada volta da espera avisa a tela com o motivo do servidor', JSON.stringify(esperas) === '[["fotografada",0],["fotografada",1]]', JSON.stringify(esperas));
  srv.respostas['/api/grupo/fechar'] = () => ({ ok: true, status: 200, fase: 'aguardando', motivo: 'fotografada', recompensa: null, esperaMs: 5 });
  const tetoAntes = AG.ESPERA_GRUPO_VEZES; AG.ESPERA_GRUPO_VEZES = 2;
  const antesTeto = srv.pedidos.length;
  const rTeto = await AG.fechaGrupo({ gid: 'grupo-0000000000000000c0de', lances: [], hashFinal: null, fotografada: true });
  AG.ESPERA_GRUPO_VEZES = tetoAntes;
  check('o teto de voltas segura a espera sem fim (2 voltas = 3 pedidos) e resolve com a última resposta',
        rTeto && rTeto.fase === 'aguardando' && srv.pedidos.slice(antesTeto).filter((p) => p.rota === '/api/grupo/fechar').length === 3,
        JSON.stringify(rTeto));
  srv.respostas['/api/grupo/fechar'] = () => ({ ok: false, status: 422, erro: 'a sala fechou rápido demais para ser de verdade', motivo: 'rapido-demais' });
  const antesR = srv.pedidos.length;
  const rR = await AG.fechaGrupo({ gid: 'grupo-0000000000000000c0de', lances: [], hashFinal: null, fotografada: false });
  check('a recusa de vez (422 rapido-demais) resolve na hora, com o motivo para a tela de recompensa',
        rR && !rR.ok && rR.recusada === true && rR.motivo === 'rapido-demais' && srv.pedidos.slice(antesR).length === 1, JSON.stringify(rR));

  console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('a prova estourou:', e && e.stack); process.exit(1); });
