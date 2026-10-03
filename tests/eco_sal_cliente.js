#!/usr/bin/env node
'use strict';
/* PROVA DO SAL DE CADA RODADA NO CLIENTE (03/10) — o jogo de verdade contra um servidor de mentira e o JUIZ de verdade.
 *
 *   node tests/eco_sal_cliente.js
 *
 * O dono (03/10) mandou dificultar o ensaio da tentativa do Eco fora do jogo. A sorte da rodada 2 a 12 vem de um
 * sal que o servidor só dá contra o caminho dos lances até a virada (engine.js, "O SORTEIO RODADA A RODADA";
 * servidor/supremo.py). O "cliente" é o game.js + autoridade.js num mundo do Node (como tests/luta_aberta_cliente.js),
 * jogando pela entrada de verdade (onTileClicked, selectSpell, endTurn, update); o "servidor" faz a conta do sal da
 * API (a chave da tentativa, um caminho por rodada) e fecha refazendo a tentativa no juiz de verdade. Cobra:
 *   - na virada o jogo PARA: pede o sal com o caminho dos lances anotados até ali, e nada anda enquanto espera;
 *   - o sal que volta entra como lance logo depois desses lances, e a tentativa inteira fecha no juiz com o mesmo
 *     dano da tela (o caminho do navegador é o que o juiz recalcula);
 *   - sem rede, a tentativa ESPERA (o estado diz "sem rede"), pede de novo o MESMO caminho e segue quando volta;
 *   - a recusa de vez (a tentativa venceu) encerra a tentativa ali e fecha com os lances até a rodada que valeu;
 *   - largar no meio da espera fecha sem o sal, e o sal que chega depois não mexe em nada;
 *   - o treino (sem servidor) passa pela mesma parada com um sal daqui, sem pedir nada a ninguém. */
const path = require('path');
const raiz = path.join(__dirname, '..');
const est = require(path.join(raiz, 'servidor', 'juiz', 'estado.js'));
const { mundo } = require(path.join(raiz, 'servidor', 'juiz', 'motor.js'));
const { fecha: fechaJuiz, salDe } = require(path.join(raiz, 'servidor', 'juiz', 'supremo.js'));
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
  J.Progress.state.heroes.sumo.level = 26;
  J.Progress.state.heroes.sumo.xp = J.DATA.leveling.xpTable[25];
  J.Progress.save();
  return est.tiraEstado(w);
}

/* o servidor de mentira do Eco: a conta do sal da API e o fechar pelo juiz de verdade */
function servidor(inicial) {
  const s = { pedidos: [], tentativas: {}, n: 0, modoSal: null, presos: [] };
  s.rota = async function (rota, op) {
    const corpo = (op && op.body) || {};
    s.pedidos.push({ rota, corpo: JSON.parse(JSON.stringify(corpo)) });
    return s.responde(rota, corpo);
  };
  // a resposta sem anotar o pedido (a resposta segurada pela prova sai por aqui quando ela solta)
  s.responde = async function (rota, corpo) {
    if (rota === '/api/supremo/abrir') {
      const tid = 'eco-sal-tentativa-' + (++s.n);
      s.tentativas[tid] = { semente: 900 + s.n, herois: corpo.herois, chave: nodeCrypto.randomBytes(32), sais: [], estado: 'aberta' };
      return { ok: true, status: 200, tentativa: tid, semente: 900 + s.n, restantes: 2 };
    }
    if (rota === '/api/supremo/sal') {
      if (typeof s.modoSal === 'function') {
        const r = s.modoSal(corpo);
        if (r) return r;
      }
      const t = s.tentativas[corpo.tentativa];
      if (!t || t.estado !== 'aberta') return { ok: false, status: 404, erro: 'tentativa não encontrada' };
      const ja = t.sais.find((x) => x.rodada === corpo.rodada);
      if (ja) {
        return ja.caminho === corpo.caminho ? { ok: true, status: 200, rodada: ja.rodada, sal: ja.sal }
          : { ok: false, status: 409, erro: 'caminho preso', motivo: 'caminho-preso' };
      }
      const esperada = t.sais.length + 2;
      if (corpo.rodada !== esperada) return { ok: false, status: 409, erro: 'rodada fora', motivo: 'rodada-fora' };
      const sal = salDe(t.chave, corpo.rodada, corpo.caminho);
      t.sais.push({ rodada: corpo.rodada, caminho: corpo.caminho, sal });
      return { ok: true, status: 200, rodada: corpo.rodada, sal };
    }
    if (rota === '/api/supremo/fechar') {
      const t = s.tentativas[corpo.tentativa];
      if (!t || t.estado !== 'aberta') return { ok: false, status: 409, erro: 'já fechada' };
      try {
        const r = fechaJuiz({ conta: { id: 1, gm: false },
                              tentativa: { semente: t.semente, herois: t.herois, chaveSal: t.chave.toString('hex'), sais: t.sais },
                              lances: corpo.lances, hashFinal: corpo.hashFinal, progress: inicial.progress, db: inicial.db,
                              contexto: { agoraMs: Date.now() } });
        t.estado = 'conferida';
        t.placar = r.placar;
        return { ok: true, status: 200, dano: r.placar.dano, pontos: r.placar.pontos, derrubou: r.placar.derrubou,
                 bonus: r.placar.bonus, rodada: r.placar.rodada, fase: r.fase, eu: { restantes: 2 } };
      } catch (e) {
        t.estado = 'recusada';
        t.recusa = e.motivo;
        return { ok: false, status: 422, erro: e.message, motivo: e.motivo };
      }
    }
    if (rota === '/api/save') return { ok: true, status: 200, versao: 1, progress: inicial.progress, db: inicial.db };
    if (rota === '/api/vida') return { ok: true, status: 200, agoraMs: Date.now(), msPorPv: 2000, herois: {} };
    if (rota === '/api/op') return { ok: true, status: 200, versao: 1, hash: inicial.hash, resultados: [] };
    return { ok: false, status: 404, erro: 'rota de mentira desconhecida: ' + rota };
  };
  s.dos = (rota) => s.pedidos.filter((p) => p.rota === rota);
  return s;
}

/* o jogo num mundo do Node, com relógio de verdade encurtado (a retentativa sem rede precisa dele) */
function cliente(inicial, srv, ligado) {
  const arqs = ['js/core/economia.js', 'js/core/progress.js', 'js/core/db.js', 'js/core/missoes.js',
                'js/core/diario.js', 'js/core/game.js', 'js/core/autoridade.js'];
  const ctx = mundo(arqs, (c) => {
    c.window = c;
    c.crypto = nodeCrypto.webcrypto;
    c.setTimeout = (fn, ms) => setTimeout(fn, Math.min(ms || 0, 20));
    c.clearTimeout = clearTimeout;
    c.addEventListener = () => {};
    c.JOGO = {
      Sessao: { ativa: () => ligado !== false, conta: () => ({ id: 1 }), api: (rota, op) => srv.rota(rota, op) },
      Nuvem: { estado: () => ({ ligada: ligado !== false, principal: true }), defineVersao() {} },
      UI: { toasts: [], toast(t) { this.toasts.push(t); }, repaint() {} }
    };
  });
  const J = ctx.JOGO;
  ctx.localStorage.setItem('soterra-save-v2', JSON.stringify(inicial.progress));
  J.Progress.load();
  J.DB.importar(inicial.db);
  J.Autoridade._fetch = (rota, op) => srv.rota(rota, op);
  J.Autoridade.adota(inicial.progress, inicial.db);
  return { ctx, J };
}
function registroDe(c) { try { return JSON.parse(c.ctx.localStorage.getItem(CHAVE) || 'null'); } catch (e) { return null; } }

/* abre a tentativa e começa a luta: a casa marcada e o PRONTO */
async function comeca(c) {
  const G = c.J.Game, E = c.J.Engine;
  const r = G.startEco(['sumo']);
  for (let i = 0; i < 100 && G.screen !== 'battle'; i++) await espera(2);
  const op = E.opcoesDe(G.state, G.state.placement.uid)[0];
  G.marcaCasa(op.x, op.y);
  G.prontoPrep(true);
  G.update(0.016);
  return r;
}
/* a vez do herói pela entrada de verdade: o plano da IA vira cliques (feitiço + casa, casa para andar, encerrar) */
function jogaAVez(c) {
  const G = c.J.Game, E = c.J.Engine;
  const u = E.activeUnit(G.state);
  const plano = c.J.AI.planTurn(G.state, u.uid) || [];
  for (const a of plano) {
    if (!G.state || G.state.phase !== 'playing' || !G.isPlayerTurn()) return;
    if (a.action === 'cast') { G.selectSpell(a.spellId); G.onTileClicked(a.x, a.y); G.selectedSpellId = null; }
    else if (a.action === 'move') G.onTileClicked(a.x, a.y);
    else if (a.action === 'end') break;
  }
  if (G.state && G.state.phase === 'playing' && G.isPlayerTurn()) G.endTurn();
}
/* anda o jogo até `para(G)` dizer chega (ou a luta sair da tela); a espera do sal deixa as promessas andarem. A
 * conferência vem DEPOIS de cada quadro: o quadro que acha a virada parada já é o que pede o sal (o update seguinte) */
async function anda(c, para, limite) {
  const G = c.J.Game;
  for (let i = 0; i < (limite || 20000); i++) {
    if (G.screen !== 'battle' || !G.state) return true;
    if (G.state.phase === 'playing' && G.isPlayerTurn()) jogaAVez(c);
    else G.update(0.05);
    if (G.ecoSalEstado && G.ecoSalEstado()) {
      G.update(0.05);                     // o quadro seguinte: o pedido do sal sai aqui
      await espera(1);
    }
    if (para && G.screen === 'battle' && G.state && para(G)) return true;
  }
  return false;
}

(async () => {
  const inicial = contaInicial();

  // ---- 1. a tentativa oficial: a parada na virada, o pedido com o caminho, nada anda na espera
  const srv = servidor(inicial);
  let solta = null;
  srv.modoSal = (corpo) => (corpo.rodada === 2 && !solta)
    ? new Promise((res) => { solta = () => { srv.modoSal = null; res(srv.responde('/api/supremo/sal', corpo)); }; })
    : null;
  const um = cliente(inicial, srv);
  const G = um.J.Game, E = um.J.Engine;
  await comeca(um);
  check('a tentativa oficial começa na rodada 1 com a semente do servidor', G.screen === 'battle' && G.state.round === 1 &&
        !!G.ecoTentativa() && !G.ecoTentativa().treino, G.screen);
  await anda(um, (g) => !!g.ecoSalEstado());
  const pedidos2 = srv.dos('/api/supremo/sal');
  const reg = registroDe(um);
  check('no fim da rodada 1 o jogo para e pede o sal da rodada 2 (um pedido só)', pedidos2.length === 1 &&
        pedidos2[0].corpo.rodada === 2 && pedidos2[0].corpo.tentativa === G.ecoTentativa().tentativa,
        JSON.stringify(pedidos2.map((p) => p.corpo.rodada)));
  check('o caminho do pedido é o SHA-256 dos lances anotados até ali (o registro da luta aberta)',
        !!reg && pedidos2[0].corpo.caminho === E.ecoCaminho(reg.lances) && /^[0-9a-f]{64}$/.test(pedidos2[0].corpo.caminho));
  const h0 = E.hash(G.state);
  for (let i = 0; i < 80; i++) { G.update(0.05); G.endTurn(); }
  await espera(5);
  check('enquanto o sal não chega nada anda: a vez é de ninguém, o estado é o mesmo, nenhum pedido a mais',
        E.hash(G.state) === h0 && !G.isPlayerTurn() && G.state.round === 1 && srv.dos('/api/supremo/sal').length === 1 &&
        JSON.stringify(G.ecoSalEstado()) === JSON.stringify({ rodada: 2, treino: false, semRede: false, tentativas: 1 }),
        JSON.stringify(G.ecoSalEstado()));
  const nAntes = registroDe(um).lances.length;
  solta();
  for (let i = 0; i < 50 && G.state.round === 1; i++) { await espera(1); G.update(0.05); }
  const lancesDepois = registroDe(um).lances;
  const salLance = lancesDepois[nAntes];
  const tent1 = srv.tentativas[G.ecoTentativa().tentativa];
  check('o sal entra como lance logo depois dos lances do caminho, e a rodada 2 começa',
        G.state.round === 2 && !!salLance && salLance.a === 'r' && salLance.r === 2 && salLance.s === tent1.sais[0].sal &&
        salLance.ok === true && !G.ecoSalEstado(), JSON.stringify(salLance) + ' rodada ' + G.state.round);
  // a tentativa inteira, e o fechar no juiz de verdade
  await anda(um);
  for (let i = 0; i < 200 && tent1.estado === 'aberta'; i++) await espera(2);
  const fim = G.ecoFim();
  const rodadasSal = srv.dos('/api/supremo/sal').map((p) => p.corpo.rodada);
  check('a tentativa inteira chega ao fim (tela ecoFim) pedindo as rodadas em ordem, uma vez cada',
        G.screen === 'ecoFim' && rodadasSal.join(',') === Array.from({ length: rodadasSal.length }, (x, i) => i + 2).join(',') &&
        rodadasSal.length === (fim && fim.placar && fim.placar.rodada) - 1, G.screen + ' ' + rodadasSal.join(','));
  check('o juiz de verdade refaz a tentativa com os sais e chega ao MESMO dano da tela',
        tent1.estado === 'conferida' && !!tent1.placar && !!fim && tent1.placar.dano === fim.placar.dano && fim.placar.dano > 0,
        tent1.estado + ' ' + tent1.recusa + ' ' + JSON.stringify(tent1.placar) + ' / ' + JSON.stringify(fim && fim.placar));

  // ---- 2. a rede cai na virada: a tentativa espera e pede de novo o MESMO caminho
  const srv2 = servidor(inicial);
  let quedas = 0;
  srv2.modoSal = (corpo) => (corpo.rodada === 2 && quedas < 3) ? (quedas++, { ok: false, status: 0, erro: 'sem rede' }) : null;
  const dois = cliente(inicial, srv2);
  const G2 = dois.J.Game, E2 = dois.J.Engine;
  await comeca(dois);
  await anda(dois, (g) => !!g.ecoSalEstado());
  for (let i = 0; i < 10 && quedas < 1; i++) await espera(1);
  const semRede = G2.ecoSalEstado();
  check('sem rede a tentativa ESPERA e diz que está sem rede (não acaba, não anda)',
        !!semRede && semRede.semRede === true && semRede.rodada === 2 && G2.screen === 'battle' && G2.state.round === 1,
        JSON.stringify(semRede));
  for (let i = 0; i < 400 && G2.state && G2.state.round === 1; i++) { await espera(2); G2.update(0.05); }
  const ped2 = srv2.dos('/api/supremo/sal').filter((p) => p.corpo.rodada === 2);
  const regs2 = registroDe(dois).lances.filter((l) => l.a === 'r');
  check('a volta da rede: o pedido saiu de novo com o MESMO caminho (4 vezes), e um lance de sal só',
        ped2.length === 4 && ped2.every((p) => p.corpo.caminho === ped2[0].corpo.caminho) && G2.state.round === 2 &&
        regs2.length === 1 && regs2[0].r === 2, ped2.length + ' pedidos, rodada ' + (G2.state && G2.state.round));
  await anda(dois);
  const t2 = srv2.tentativas[G2.ecoFim() ? Object.keys(srv2.tentativas)[0] : ''];
  for (let i = 0; i < 200 && t2 && t2.estado === 'aberta'; i++) await espera(2);
  check('... e a tentativa que esperou a rede fecha limpa no juiz', !!t2 && t2.estado === 'conferida',
        t2 && (t2.estado + ' ' + t2.recusa));

  // ---- 3. a recusa de vez: a tentativa venceu no meio — ela acaba na virada e fecha com o que valeu
  const srv3 = servidor(inicial);
  srv3.modoSal = (corpo) => corpo.rodada === 3 ? { ok: false, status: 410, erro: 'essa tentativa venceu (prazo)', motivo: 'vencida' } : null;
  const tres = cliente(inicial, srv3);
  const G3 = tres.J.Game;
  await comeca(tres);
  await anda(tres);
  for (let i = 0; i < 100 && srv3.dos('/api/supremo/fechar').length === 0; i++) await espera(2);
  const f3 = G3.ecoFim(), fech3 = srv3.dos('/api/supremo/fechar');
  check('a recusa do sal encerra a tentativa na virada: a tela do fim diz a rodada e o porquê',
        G3.screen === 'ecoFim' && !!f3 && f3.parouNaRodada === 3 && /venceu/.test(f3.semSal || '') && f3.largou === true,
        G3.screen + ' ' + JSON.stringify(f3 && { r: f3.parouNaRodada, s: f3.semSal }));
  check('... e fecha no servidor com os lances até a rodada que valeu (o sal da 2 dentro, nenhum da 3)',
        fech3.length === 1 && fech3[0].corpo.hashFinal === null &&
        fech3[0].corpo.lances.filter((l) => l.a === 'r').map((l) => l.r).join(',') === '2',
        JSON.stringify(fech3.map((p) => p.corpo.lances.filter((l) => l.a === 'r'))));

  // ---- 4. largar no meio da espera: fecha sem o sal, e o sal atrasado não mexe em nada
  const srv4 = servidor(inicial);
  let solta4 = null;
  srv4.modoSal = (corpo) => (corpo.rodada === 2 && !solta4)
    ? new Promise((res) => { solta4 = () => { srv4.modoSal = null; res(srv4.responde('/api/supremo/sal', corpo)); }; })
    : null;
  const quatro = cliente(inicial, srv4);
  const G4 = quatro.J.Game;
  await comeca(quatro);
  await anda(quatro, (g) => !!g.ecoSalEstado());
  G4.abandonar();
  await espera(5);
  const fech4 = srv4.dos('/api/supremo/fechar');
  solta4();
  await espera(10);
  check('largar esperando o sal fecha com os lances até a virada (sem sal nenhum) e volta à praça',
        fech4.length === 1 && fech4[0].corpo.lances.every((l) => l.a !== 'r') && G4.screen === 'hub' && !G4.state,
        fech4.length + ' ' + G4.screen);
  check('o sal que chega depois de largar não mexe em nada', !G4.state && G4.screen === 'hub');

  // ---- 5. o treino (sem servidor): a mesma parada, com o sal daqui
  const srv5 = servidor(inicial);
  const cinco = cliente(inicial, srv5, false);
  const G5 = cinco.J.Game;
  const r5 = await comeca(cinco);
  let paradas = 0;
  cinco.J.Engine.events.length = 0;
  await anda(cinco, (g) => { paradas += cinco.J.Engine.events.filter((ev) => ev.type === 'ecoEsperaSal').length; cinco.J.Engine.events.length = 0; return false; });
  check('o treino passa pelas mesmas paradas com o sal daqui e chega ao fim sem pedir nada ao servidor',
        r5 === true && G5.screen === 'ecoFim' && G5.ecoFim().treino === true && paradas >= 1 && srv5.pedidos.length === 0,
        r5 + ' ' + G5.screen + ' paradas ' + paradas + ' pedidos ' + srv5.pedidos.length);

  console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('a prova estourou:', e && e.stack); process.exit(1); });
