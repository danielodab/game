#!/usr/bin/env node
'use strict';
/* PROVA DO CLIENTE: A ENTREGA DO MESTRE NUM JOGADOR ONLINE (03/10, o painel único do Mestre).
 *
 *   node tests/entregas_cliente.js
 *
 * O dono: o Mestre pode pôr itens no inventário de QUALQUER jogador. Se o jogador estiver online, o jogo
 * dele adota o estado novo SEM sobrescrever o que ele fez. O "cliente" é o jogo de verdade (progress.js,
 * db.js, autoridade.js…) num mundo do Node; o "servidor" é um objeto em memória que responde com o JUIZ de
 * verdade (economia.executa — a entrega é a op interna mestreDar*, como no servidor/moderacao.py) e sobe a
 * op do jogador por cima de uma corrente de entregas como o servidor/salas.py (economia_op, rebase; a regra
 * do servidor está provada em tests/moderacao_api.py, test_15). Cobra:
 *   - a op que o jogador fez com o hash de ANTES da entrega não se perde: volta o estado com as duas coisas;
 *   - a op feita ENQUANTO a leva viajava continua na fila e sobe depois (o jogo não a apaga);
 *   - Autoridade.sincroniza adota a entrega com a fila vazia;
 *   - e NÃO adota um estado lido enquanto o jogador fazia uma op nova (tenta de novo e chega às duas);
 *   - adotaDeFora (a resposta da entrega ao próprio Mestre) só adota se nada nasceu no meio. */
const path = require('path');
const raiz = path.join(__dirname, '..');
const est = require(path.join(raiz, 'servidor', 'juiz', 'estado.js'));
const { mundo } = require(path.join(raiz, 'servidor', 'juiz', 'motor.js'));
const { executa } = require(path.join(raiz, 'servidor', 'juiz', 'economia.js'));
const nodeCrypto = require('crypto');

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}

function contaInicial() {
  const w = est.mundoEconomico({ agoraMs: Date.now(), semente: 1 });
  est.poeEstado(w, null, null);
  return est.tiraEstado(w);
}

// ---- o servidor de mentira: o estado, a corrente de entregas e o rebase da op
function servidor(inicial) {
  const s = { progress: inicial.progress, db: inicial.db, hash: inicial.hash, versao: 1, entregas: [], chamadas: [],
              antesDeResponder: null };
  s.entrega = async function (nome, args) {
    const r = await executa({ conta: { id: 7, gm: false }, progress: s.progress, db: s.db,
                              ops: [{ nome, args }], semente: 1, contexto: { agoraMs: Date.now(), interno: true } });
    s.entregas.push({ antes: r.hashAntes, depois: r.hash });
    s.progress = r.progress; s.db = r.db; s.hash = r.hash; s.versao++;
    return r.resultados[0];
  };
  function rebase(hashCliente) {
    let atual = s.hash;
    for (let i = s.entregas.length - 1; i >= 0; i--) {
      if (s.entregas[i].depois !== atual) return false;
      atual = s.entregas[i].antes;
      if (atual === hashCliente) return true;
    }
    return false;
  }
  s.rota = async function (rota, op) {
    const corpo = (op && op.body) || {};
    s.chamadas.push(rota);
    if (s.antesDeResponder) { const f = s.antesDeResponder; s.antesDeResponder = null; await f(rota); }
    if (rota === '/api/op') {
      let reb = false;
      if (s.hash && corpo.hashAntes !== s.hash) {
        reb = rebase(corpo.hashAntes);
        if (!reb) return { ok: false, status: 409, versao: s.versao, hash: s.hash, progress: s.progress, db: s.db };
      }
      const r = await executa({ conta: { id: 7, gm: false }, progress: s.progress, db: s.db, ops: corpo.ops,
                                semente: 4242, contexto: { agoraMs: Date.now() } });
      s.progress = r.progress; s.db = r.db; s.hash = r.hash; s.versao++;
      const resp = { ok: true, status: 200, versao: s.versao, hash: s.hash, resultados: r.resultados };
      if (reb) resp.rebase = true;
      if (reb || !corpo.hashDepois || corpo.hashDepois !== r.hash) { resp.progress = s.progress; resp.db = s.db; }
      return resp;
    }
    if (rota === '/api/save') return { ok: true, status: 200, versao: s.versao, hash: s.hash, progress: s.progress, db: s.db };
    return { ok: false, status: 404, erro: 'rota de mentira desconhecida' };
  };
  return s;
}

function cliente(inicial, srv) {
  const arqs = ['js/core/economia.js', 'js/core/progress.js', 'js/core/db.js', 'js/core/missoes.js',
                'js/core/diario.js', 'js/core/game.js', 'js/core/autoridade.js'];
  const ctx = mundo(arqs, (c) => {
    c.window = c;
    c.crypto = nodeCrypto.webcrypto;
    c.addEventListener = () => {};
    c.JOGO = {
      Sessao: { ativa: () => true, conta: () => ({ id: 7 }), api: (rota, op) => srv.rota(rota, op) },
      Nuvem: { estado: () => ({ ligada: true, principal: true }), defineVersao() {} },
      UI: { toasts: [], toast(t) { this.toasts.push(t); }, repaint() {} }
    };
  });
  const J = ctx.JOGO;
  ctx.localStorage.setItem('soterra-save-v2', JSON.stringify(inicial.progress));
  J.Progress.load();
  J.DB.importar(inicial.db);
  J.Autoridade._fetch = (rota, op) => srv.rota(rota, op);
  // como o puxaEstado da abertura: o estado E o hash do servidor (a op seguinte sobe com ele no hashAntes)
  J.Autoridade.adotaResposta({ versao: 1, hash: inicial.hash, progress: inicial.progress, db: inicial.db });
  return J;
}

(async () => {
  // o servidor começa com o hash que o juiz mede (o jogo, sem ele, mede o mesmo no estado que adotou)
  const base = contaInicial();
  base.hash = (await executa({ conta: { id: 7, gm: false }, progress: base.progress, db: base.db,
                               ops: [{ nome: 'escolherSeloElemento', args: { elemento: 'fogo' } }], semente: 1,
                               contexto: { agoraMs: Date.now() } }));
  const inicial = { progress: base.hash.progress, db: base.hash.db, hash: base.hash.hash };

  // ---- 1. a op com o hash de antes de DUAS entregas sobe por cima delas
  {
    const srv = servidor(inicial);
    const J = cliente(inicial, srv);
    check('o cliente parte do hash do servidor', J.Autoridade.hashLocal() === srv.hash);
    await srv.entrega('mestreDarPedras', { stoneId: 'stone-ember', n: 100 });
    await srv.entrega('mestreDarItem', { itemId: 'gh-wasp-sting', estrelas: 2, nivel: 1, qtd: 2 });
    J.Progress.escolheSeloElemento('agua');                         // o jogador, sem saber da entrega
    await J.Autoridade.descarrega();
    const P = J.Progress.state;
    check('a op do jogador não se perde: o estado tem as duas entregas E a escolha dele',
          P.seloElemento === 'agua' && (P.stones['stone-ember'] || 0) === 100 &&
          P.inventory.filter((e) => e.itemId === 'gh-wasp-sting' && e.stars === 2 && e.level === 1).length === 2,
          JSON.stringify([P.seloElemento, P.stones, P.inventory.length]));
    check('... e o cliente fica com o MESMO hash do servidor', J.Autoridade.hashLocal() === srv.hash);
    check('... sem nenhum 409 no caminho (nenhum aviso de recusa)', J.UI.toasts.length === 0, J.UI.toasts.join(' | '));
  }

  // ---- 2. a op feita enquanto a leva viajava continua na fila e sobe depois
  {
    const srv = servidor(inicial);
    const J = cliente(inicial, srv);
    await srv.entrega('mestreDarSelos', { elemento: 'terra', n: 12 });
    J.Progress.escolheSeloElemento('agua');
    srv.antesDeResponder = async () => { J.Progress.escolheSeloElemento('ar'); };    // o dedo ainda mexendo
    await J.Autoridade.descarrega();
    check('a resposta com rebase guardou a fila nova (o jogo não a apagou)', J.Autoridade.estado().fila === 1,
          JSON.stringify(J.Autoridade.estado()));
    await J.Autoridade.descarrega();
    check('a segunda leva subiu: o servidor tem a ÚLTIMA escolha e os selos da entrega',
          srv.progress.seloElemento === 'ar' && srv.progress.selos.terra === 12 &&
          J.Progress.state.seloElemento === 'ar' && J.Autoridade.hashLocal() === srv.hash,
          JSON.stringify([srv.progress.seloElemento, J.Progress.state.seloElemento]));
  }

  // ---- 3. sincroniza: a fila vazia adota a entrega
  {
    const srv = servidor(inicial);
    const J = cliente(inicial, srv);
    await srv.entrega('mestreDarPet', { petId: 'pet-galehawk', topo: true });
    await J.Autoridade.sincroniza();
    check('sincroniza adota a entrega (o bicho entrou) e os hashes batem',
          (J.Progress.state.petCards['pet-galehawk'] || 0) > 5 && J.Autoridade.hashLocal() === srv.hash);
  }

  // ---- 4. sincroniza não adota um estado lido enquanto o jogador fazia uma op nova
  {
    const srv = servidor(inicial);
    const J = cliente(inicial, srv);
    await srv.entrega('mestreDarInsignias', { n: 10 });
    let lidas = 0;
    srv.antesDeResponder = async (rota) => {
      if (rota === '/api/save') { lidas++; J.Progress.escolheSeloElemento('terra'); }
    };
    await J.Autoridade.sincroniza();
    check('a leitura que cruzou com uma op nova NÃO foi adotada: a op subiu e o estado tem as duas coisas',
          lidas === 1 && J.Progress.state.seloElemento === 'terra' && J.Progress.state.insignias === 10 &&
          srv.progress.seloElemento === 'terra' && J.Autoridade.hashLocal() === srv.hash,
          JSON.stringify([lidas, J.Progress.state.seloElemento, J.Progress.state.insignias, srv.chamadas.join(' ')]));
  }

  // ---- 5. a resposta da entrega ao PRÓPRIO Mestre: adota só se nada nasceu no meio
  {
    const srv = servidor(inicial);
    const J = cliente(inicial, srv);
    const marca = J.Autoridade.marca();
    await srv.entrega('mestreDarPedras', { stoneId: 'stone-tear', n: 10 });
    const resposta = { ok: true, versao: srv.versao, hash: srv.hash, progress: srv.progress, db: srv.db };
    check('sem op no meio, adotaDeFora adota a resposta', J.Autoridade.adotaDeFora(resposta, marca) === true &&
          J.Progress.state.stones['stone-tear'] === 10 && J.Autoridade.hashLocal() === srv.hash);
    const marca2 = J.Autoridade.marca();
    await srv.entrega('mestreDarPedras', { stoneId: 'stone-tear', n: 5 });
    const resposta2 = { ok: true, versao: srv.versao, hash: srv.hash, progress: srv.progress, db: srv.db };
    J.Progress.escolheSeloElemento('ar');                            // o Mestre clicou outra coisa enquanto isso
    const adotou = J.Autoridade.adotaDeFora(resposta2, marca2);
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    check('com op no meio, a resposta velha não apaga a op: sincroniza e chega às duas',
          adotou === false && J.Progress.state.seloElemento === 'ar' && J.Progress.state.stones['stone-tear'] === 15 &&
          J.Autoridade.hashLocal() === srv.hash, JSON.stringify([adotou, J.Progress.state.seloElemento, J.Progress.state.stones]));
  }

  console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('a prova estourou:', e && e.stack); process.exit(1); });
