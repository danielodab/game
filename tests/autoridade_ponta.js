#!/usr/bin/env node
'use strict';
/* PROVA DE PONTA A PONTA DA AUTORIDADE — o jogo de verdade, a API de verdade, o juiz de verdade.
 *
 *   node tests/autoridade_ponta.js
 *
 * Sobe o juiz (servidor/juiz/juiz.js) e a API (servidor/api.py --juiz) em portas
 * livres, com um banco descartável, e fala HTTP como o navegador falaria:
 *   1. cria uma conta e grava o primeiro save (a "anistia": o estado inicial);
 *   2. o jogo (game.js + progress.js + db.js + autoridade.js num mundo do Node,
 *      com Sessao.api fazendo fetch de verdade) adota o estado do servidor;
 *   3. desce uma sala pela tela: bilhete, colocação, lances, vitória, e o servidor
 *      paga — o estado do jogo e o GET /api/save têm o MESMO hash;
 *   4. equipa (a op sobe e bate), forja pelo servidor, e uma trapaça local some;
 *   5. o PUT do save com XP inventado não muda a economia no servidor.
 * Os processos rodam com prioridade abaixo do normal (a máquina é dividida). */
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const cp = require('child_process');
const nodeCrypto = require('crypto');
const raiz = path.join(__dirname, '..');
const est = require(path.join(raiz, 'servidor', 'juiz', 'estado.js'));
const { mundo } = require(path.join(raiz, 'servidor', 'juiz', 'motor.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function portaLivre() {
  return new Promise((res) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}
function baixa(proc) {
  try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) {}
}
async function esperaUrl(url, segundos) {
  const fim = Date.now() + segundos * 1000;
  while (Date.now() < fim) {
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) {}
    await espera(200);
  }
  return false;
}
async function pede(base, metodo, rota, corpo, token) {
  const r = await fetch(base + rota, {
    method: metodo,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  });
  let j = {};
  try { j = await r.json(); } catch (e) {}
  j.status = r.status;
  if (j.ok === undefined) j.ok = r.ok;
  return j;
}

(async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'soterra-ponta-'));
  const procs = [];
  const fecha = () => { procs.forEach((p) => { try { p.kill(); } catch (e) {} }); };
  process.on('exit', fecha);
  try {
    // ---- o juiz e a API
    const pJuiz = await portaLivre(), pApi = await portaLivre();
    const juiz = cp.spawn(process.execPath, [path.join(raiz, 'servidor', 'juiz', 'juiz.js'), '--porta', String(pJuiz)],
                          { stdio: 'ignore' });
    procs.push(juiz); baixa(juiz);
    const env = Object.assign({}, process.env, { SOTERRA_SALA_MIN_S: '0', SOTERRA_SALA_S_POR_TURNO: '0',
                                                 PYTHONIOENCODING: 'utf-8' });
    const api = cp.spawn('python', [path.join(raiz, 'servidor', 'api.py'), '--porta', String(pApi),
                                    '--banco', path.join(pasta, 'dados', 'soterra.db'),
                                    '--juiz', 'http://127.0.0.1:' + pJuiz], { stdio: 'ignore', env });
    procs.push(api); baixa(api);
    const base = 'http://127.0.0.1:' + pApi;
    const subiu = (await esperaUrl('http://127.0.0.1:' + pJuiz + '/saude', 30)) && (await esperaUrl(base + '/api/saude', 30));
    check('o juiz e a API sobem', subiu);
    if (!subiu) throw new Error('não subiu');

    // ---- a conta e o primeiro save (o estado inicial do jogo, Bárbaro nível 22)
    const nome = 'Ponta' + nodeCrypto.randomBytes(3).toString('hex');
    // 02/10: o cadastro exige o aceite dos Termos (a versão de agora, lida do servidor/privacidade.py)
    const versaoTermos = /VERSAO_TERMOS = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, '..', 'servidor', 'privacidade.py'), 'utf8'))[1];
    const cad = await pede(base, 'POST', '/api/cadastro', { nome, email: nome.toLowerCase() + '@soterra.test', senha: 'segredo-bom-8',
                                                            aceiteTermos: versaoTermos });
    check('a conta nasce', cad.ok && !!cad.token, JSON.stringify(cad));
    const token = cad.token;
    const w0 = est.mundoEconomico({ agoraMs: Date.now(), semente: 1 });
    est.poeEstado(w0, null, null);
    const P0 = w0.J.Progress;
    P0.state.heroes.sumo.level = 22;
    P0.state.heroes.sumo.xp = w0.J.DATA.leveling.xpTable[21];
    Object.keys(w0.J.DATA.stones || {}).forEach((sid) => { P0.state.stones[sid] = 300; });
    const peca = Object.keys(w0.J.DATA.items).find((id) => {
      const it = w0.J.DATA.items[id];
      return it && it.slot === 'punho' && (!P0.nivelUsoDe || P0.nivelUsoDe(id) <= 10);
    });
    P0.addItem(peca, 'saque');
    P0.save();
    const nasc = (P0.state.nascimentos || []).map((n) => ({ iid: n.iid, itemId: n.itemId, origem: n.origem }));
    const ini = est.tiraEstado(w0);
    const put0 = await pede(base, 'PUT', '/api/save', { versao: 0, progress: ini.progress, db: ini.db, nascimentos: nasc }, token);
    check('o primeiro save é aceito inteiro', put0.ok, JSON.stringify(put0));

    // ---- o jogo, com a sessão ligada e fetch de verdade
    const ctx = mundo(['js/core/economia.js', 'js/core/progress.js', 'js/core/db.js', 'js/core/missoes.js',
                       'js/core/diario.js', 'js/core/game.js', 'js/core/autoridade.js'], (c) => {
      c.window = c;
      c.crypto = nodeCrypto.webcrypto;
      c.addEventListener = () => {};
      c.setTimeout = setTimeout;
      c.clearTimeout = clearTimeout;
      c.JOGO = {
        Sessao: { ativa: () => true, conta: () => cad.conta, contaId: () => cad.conta.id,
                  api: (rota, op) => pede(base, (op && op.method) || 'GET', rota, op && op.body, token) },
        Nuvem: { estado: () => ({ ligada: true, principal: true }), defineVersao() {} },
        UI: { toasts: [], toast(t) { this.toasts.push(t); }, repaint() {} }
      };
    });
    const J = ctx.JOGO, G = J.Game, E = J.Engine, A = J.Autoridade;
    await A.puxaEstado();
    const srv0 = await pede(base, 'GET', '/api/save', undefined, token);
    // logo depois do 1º save o servidor ainda guarda o JSON cru que o cliente mandou, sem hash (o
    // hash nasce na 1ª gravação do juiz). O jogo, ao adotar, passa o estado pelo saneamento do
    // Progress e do DB — e o juiz faz o mesmo antes de qualquer op. O hash que vale é o do estado
    // do servidor depois do mesmo saneamento
    const wSrv = est.mundoEconomico({ agoraMs: Date.now(), semente: 1 });
    est.poeEstado(wSrv, srv0.progress, srv0.db);
    const hashSrv0 = srv0.hash || est.tiraEstado(wSrv).hash;
    check('o jogo adota o estado do servidor (mesmo hash)', A.hashLocal() === hashSrv0,
          A.hashLocal() + ' × ' + hashSrv0);

    /* 15/09, a vida única: a sala perdida deixa o herói a 0 no servidor, e a próxima tentativa esbarrava no 409
     * vida-zero (e com 1 PV perdia de novo). A prova é da economia, não da espera: o banco descartável dela
     * devolve a vida cheia, depois que o fechar da sala perdida (assíncrono, chega depois do restart) assentou */
    const vidaCheia = async () => {
      await espera(400);
      cp.execFileSync('python', ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); '
        + 'c.execute("DELETE FROM vida_heroi"); c.execute("DELETE FROM luta_aberta"); c.commit()',
        path.join(pasta, 'dados', 'soterra.db')]);
      if (J.Vida && J.Vida._zera) J.Vida._zera();
    };
    // ---- uma sala pela tela
    let venceu = false;
    for (let tentativa = 0; tentativa < 8 && !venceu; tentativa++) {
      G.dificuldade = 'normal';
      G.startRun(['sumo'], 'cistern', {});
      for (let i = 0; i < 50 && G.screen === 'antessala'; i++) {
        if (G.esperaVida()) { await vidaCheia(); continue; }
        const r = G.entrarNaSala();
        if (G.screen === 'battle') break;
        await espera(r === 'esperando' ? 100 : 50);
      }
      if (G.screen !== 'battle') continue;
      const op = E.placementOptions(G.state)[0];
      G.onTileClicked(op.x, op.y);
      let voltas = 0;
      while (G.screen === 'battle' && G.state && G.state.phase === 'playing' && voltas++ < 3000) {
        if (G.isPlayerTurn()) {
          const u = E.activeUnit(G.state);
          for (const a of (J.AI.planTurn(G.state, u.uid) || [])) {
            if (G.state.phase !== 'playing' || !G.isPlayerTurn()) break;
            if (a.action === 'move') { G.selectedSpellId = null; G.onTileClicked(a.x, a.y); }
            else if (a.action === 'cast') { G.selectedSpellId = a.spellId; G.onTileClicked(a.x, a.y); G.selectedSpellId = null; }
            else if (a.action === 'end') break;
          }
          if (G.state.phase === 'playing' && G.isPlayerTurn()) G.endTurn();
        } else G.update(0.016);
      }
      for (let i = 0; i < 200 && G.screen === 'battle'; i++) { G.update(0.016); await espera(25); }
      venceu = G.screen === 'roomClear' || G.screen === 'dungeonComplete';
      if (!venceu) {
        G.restart('hub');
        /* 15/09, a vida única: a sala perdida deixa o herói a 0 no servidor, e a próxima tentativa esbarrava no
         * 409 vida-zero (e com 1 PV perdia de novo). A prova é da economia, não da espera: o banco descartável
         * dela devolve a vida cheia entre as tentativas, e a Vida local esquece o registro */
        await vidaCheia();
      }
    }
    check('o jogo vence uma sala com bilhete e o servidor paga', venceu, G.screen + ' ' + JSON.stringify(J.UI.toasts.slice(-3)));
    const srv1 = await pede(base, 'GET', '/api/save', undefined, token);
    check('depois da sala, o jogo e o servidor têm o MESMO hash', A.hashLocal() === srv1.hash, A.hashLocal() + ' × ' + srv1.hash);
    check('a carteira e o XP cresceram no SERVIDOR',
          srv1.db.carteira.moedas > ini.db.carteira.moedas && srv1.progress.heroes.sumo.xp > ini.progress.heroes.sumo.xp,
          JSON.stringify([srv1.db.carteira, srv1.progress.heroes.sumo.xp, ini.progress.heroes.sumo.xp]));

    // ---- a op, a forja e a trapaça
    const idx = J.Progress.state.inventory.findIndex((e) => e.itemId === peca);
    J.Progress.equip('sumo', peca, idx);
    await A.descarrega();
    const srv2 = await pede(base, 'GET', '/api/save', undefined, token);
    check('equipar sobe pela /api/op e os hashes batem', A.hashLocal() === srv2.hash && srv2.progress.heroes.sumo.items.punho === peca,
          A.hashLocal() + ' × ' + srv2.hash);
    const fj = await A.opAgora('forjarVestida', { heroId: 'sumo', slot: 'punho', usarGuarda: false });
    const srv3 = await pede(base, 'GET', '/api/save', undefined, token);
    check('a forja é sorteada no servidor e o jogo fica igual a ele', fj.ok && A.hashLocal() === srv3.hash,
          JSON.stringify(fj) + ' ' + A.hashLocal() + ' × ' + srv3.hash);
    J.Progress.state.heroes.sumo.xp += 999999;
    J.Progress.unequip('sumo', 'punho');
    await A.descarrega();
    await espera(50);
    const srv4 = await pede(base, 'GET', '/api/save', undefined, token);
    check('XP inventado na tela some: o jogo adota o servidor',
          J.Progress.state.heroes.sumo.xp === srv4.progress.heroes.sumo.xp && srv4.progress.heroes.sumo.xp < 999999,
          J.Progress.state.heroes.sumo.xp + ' × ' + srv4.progress.heroes.sumo.xp);

    // ---- o PUT com economia inventada
    const falso = JSON.parse(JSON.stringify(srv4.progress));
    falso.heroes.sumo.xp = 9999999;
    const dbFalso = JSON.parse(JSON.stringify(srv4.db));
    dbFalso.carteira.moedas = 1e9;
    dbFalso.jogador.nome = nome;
    const put1 = await pede(base, 'PUT', '/api/save', { versao: 0, progress: falso, db: dbFalso, nascimentos: [] }, token);
    const srv5 = await pede(base, 'GET', '/api/save', undefined, token);
    check('o PUT com XP e vinténs inventados não muda a economia no servidor',
          put1.ok && srv5.progress.heroes.sumo.xp === srv4.progress.heroes.sumo.xp && srv5.db.carteira.moedas === srv4.db.carteira.moedas,
          JSON.stringify([put1.status, srv5.progress.heroes.sumo.xp, srv5.db.carteira.moedas]));
  } catch (e) {
    check('a prova rodou até o fim', false, e && e.stack);
  } finally {
    fecha();
    await espera(300);
    try { fs.rmSync(pasta, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})();
