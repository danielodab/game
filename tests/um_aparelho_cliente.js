#!/usr/bin/env node
'use strict';
/* PROVA DO CLIENTE DO "UM APARELHO SÓ" (13/09) — js/core/sessao.js, nuvem.js,
 * autoridade.js e rede.js num mundo de mentira do Node (vm), sem navegador.
 *
 *   node tests/um_aparelho_cliente.js
 *
 * PEDIDO DO DONO: "uma conta só pode estar logada em um dispositivo.. se outro
 * tentar logar, no que estava logado cai o jogo". O servidor responde 401 com
 * motivo 'outro-aparelho' ao token derrubado, e o relé manda {t:'derrubado'} e
 * fecha com 4001. Cobra:
 *   A. 401 com o motivo num PUT da Nuvem: a capa bloqueante (com a frase e o
 *      "Entrar de novo"), a Nuvem parada (nenhum pedido mais, nem na descarga
 *      do pagehide), a Autoridade parada, a Rede/praça/agenda desligadas, as
 *      teclas presas, nenhum alert(); o "Entrar de novo" esquece a sessão e
 *      guarda a frase para a tela de entrar.
 *   B. token NOVO da mesma conta no localStorage: adota, repete o pedido com
 *      ele e NÃO derruba; token de OUTRA conta: derruba.
 *   C. sem sessão: nada muda (sem vigia, sem capa, a Nuvem nem liga).
 *   D. a olhada em /api/eu: parada com a aba escondida, olha na hora ao voltar.
 *   E. a Rede: {t:'derrubado} do relé derruba e não religa; com token novo da
 *      mesma conta, religa e se identifica com ele. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');
const raiz = path.join(__dirname, '..');

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const FRASE = 'sua conta entrou em outro aparelho';
const SES_VELHA = { token: 'a'.repeat(64), conta: { id: 7, nome: 'Ana', gm: false } };
const SES_NOVA = { token: 'b'.repeat(64), conta: { id: 7, nome: 'Ana', gm: false } };
const SES_OUTRA = { token: 'c'.repeat(64), conta: { id: 9, nome: 'Bia', gm: false } };

class El {
  constructor(tag) { this.tagName = tag; this.children = []; this.style = { cssText: '' }; this.attrs = {}; this.ouv = {}; this.className = ''; this.textContent = ''; this.parentNode = null; this.id = ''; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.ouv[t] = this.ouv[t] || []).push(f); }
  contains(x) { return x === this || this.children.some((c) => c.contains(x)); }
  focus() {}
  click() { (this.ouv.click || []).forEach((f) => f({})); }
  get texto() { return [this.textContent].concat(this.children.map((c) => c.texto)).join(' '); }
  acha(fn) { if (fn(this)) return this; for (const c of this.children) { const a = c.acha(fn); if (a) return a; } return null; }
}

/* o mundo: window/document/localStorage/fetch/timers de mentira, e o servidor `responde(rota, token, pedido)` */
function mundo(op) {
  const local = new Map(), sessao = new Map();
  if (op.sessao) local.set('soterra-sessao', JSON.stringify(op.sessao));
  const ouvWin = {}, ouvDoc = {};
  const pedidos = [], intervalos = [], adiados = [], sockets = [];
  const uiRoot = new El('div'); uiRoot.id = 'ui-root';
  const g = {
    console, Promise, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, Uint8Array,
    alerts: 0, recargas: 0,
    alert() { g.alerts++; }, confirm() { g.alerts++; return true; },
    localStorage: { getItem: (k) => (local.has(k) ? local.get(k) : null), setItem: (k, v) => local.set(k, String(v)), removeItem: (k) => local.delete(k) },
    sessionStorage: { getItem: (k) => (sessao.has(k) ? sessao.get(k) : null), setItem: (k, v) => sessao.set(k, String(v)), removeItem: (k) => sessao.delete(k) },
    location: { protocol: 'https:', hostname: 'soterra.test', host: 'soterra.test', search: '', hash: '', href: 'https://soterra.test/index.html', reload() { g.recargas++; } },
    document: {
      hidden: !!op.escondida, readyState: 'complete', body: new El('body'),
      createElement: (t) => new El(t), getElementById: (id) => (id === 'ui-root' ? uiRoot : null),
      addEventListener: (t, f) => { (ouvDoc[t] = ouvDoc[t] || []).push(f); }
    },
    addEventListener: (t, f) => { (ouvWin[t] = ouvWin[t] || []).push(f); },
    removeEventListener() {},
    dispatchEvent: (ev) => { (ouvWin[ev.type] || []).forEach((f) => f(ev)); return true; },
    getComputedStyle: () => ({ position: 'absolute' }),
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    crypto: { getRandomValues: (a) => nodeCrypto.webcrypto.getRandomValues(a) },
    setTimeout: (f, ms) => { if (ms >= 3000) { adiados.push({ f, ms }); return -adiados.length; } return setTimeout(f, ms); },
    clearTimeout: (id) => { if (typeof id === 'number' && id < 0) { if (adiados[-id - 1]) adiados[-id - 1].parado = true; } else clearTimeout(id); },
    setInterval: (f, ms) => { intervalos.push({ f, ms, parado: false }); return intervalos.length; },
    clearInterval: (id) => { if (intervalos[id - 1]) intervalos[id - 1].parado = true; },
    fetch: (url, pedido) => {
      const tk = ((pedido.headers || {}).Authorization || '').replace(/^Bearer /, '') || null;
      const rota = url.replace(/^https?:\/\/[^/]+/, '');
      pedidos.push({ rota, token: tk, metodo: pedido.method, keepalive: !!pedido.keepalive });
      const r = op.responde(rota, tk, pedido) || { status: 200, corpo: { ok: true } };
      return Promise.resolve({ status: r.status, json: () => Promise.resolve(JSON.parse(JSON.stringify(r.corpo))) });
    }
  };
  g.WebSocket = class {
    constructor(url) { this.url = url; this.readyState = 0; this.enviados = []; this.fechou = false; sockets.push(this); }
    send(s) { this.enviados.push(JSON.parse(s)); }
    close() { this.fechou = true; this.readyState = 3; }
  };
  g.window = g;
  g.self = g;
  vm.createContext(g);
  g.JOGO = { Rede: op.semRede ? undefined : undefined };
  const toques = { rede: 0, hub: 0, agenda: 0 };
  if (!op.redeDeVerdade) g.JOGO.Rede = { sair() { toques.rede++; } };
  g.JOGO.Hub = { sair() { toques.hub++; } };
  g.JOGO.Agenda = { parar() { toques.agenda++; } };
  g.JOGO.Contas = { sufixo: () => '', ativa: () => 'principal', chaveSave: () => 'soterra-save-v2', chaveConta: () => 'soterra-conta-v1' };
  g.JOGO.Progress = { state: { heroes: {} }, save() {}, load() {}, nascimentos: () => [], podaNascimentos() {}, limpaNascimentos() {} };
  g.JOGO.DB = { exportar: () => ({ versao: 1 }), importar() {} };
  for (const arq of op.arquivos || ['js/core/sessao.js', 'js/core/nuvem.js', 'js/core/autoridade.js']) {
    vm.runInContext(fs.readFileSync(path.join(raiz, arq), 'utf8'), g, { filename: arq });
  }
  return { g, J: g.JOGO, pedidos, intervalos, adiados, sockets, uiRoot, ouvWin, ouvDoc, local, sessao, toques };
}

const R401 = { status: 401, corpo: { ok: false, erro: FRASE, motivo: 'outro-aparelho' } };
const capaDe = (m) => m.uiRoot.acha((e) => /inativo-capa/.test(e.className));

async function cenaA() {
  let derrubada = false;
  const m = mundo({
    sessao: SES_VELHA,
    responde: (rota, tk, p) => {
      if (derrubada && tk === SES_VELHA.token) return R401;
      if (rota === '/api/eu') return { status: 200, corpo: { ok: true, conta: SES_VELHA.conta } };
      if (rota === '/api/save' && p.method === 'GET') return { status: 200, corpo: { ok: true, versao: 0, progress: null } };
      if (rota === '/api/save') return { status: 200, corpo: { ok: true, versao: 1 } };
      return { status: 200, corpo: { ok: true } };
    }
  });
  const { J } = m;
  J.Nuvem.ESPERA_MS = 5;
  J.Nuvem.semRecarga = true;
  J.Autoridade.FILA_MS = 5;
  await J.Nuvem.iniciar();
  await espera(30);
  check('A: com sessão, a Nuvem liga, sobe o save e a Autoridade liga', J.Nuvem.estado().ligada && J.Autoridade.ligada() &&
        m.pedidos.some((x) => x.rota === '/api/save' && x.metodo === 'PUT'), JSON.stringify(m.pedidos));
  check('A: a olhada de 30 s em /api/eu ligou (a aba está à vista)', m.intervalos.some((x) => x.ms === 30000 && !x.parado));
  derrubada = true;                       // a conta entrou em outro aparelho
  J.Progress.save();                      // uma gravação local agenda o PUT
  await espera(60);
  const capa = capaDe(m);
  check('A: o PUT com o token derrubado leva 401 com motivo e o jogo cai (Sessao.derrubadaJa)', J.Sessao.derrubadaJa());
  check('A: a capa bloqueante cobre o #ui-root com a frase', !!capa && /Sua conta entrou em outro aparelho\./.test(capa.texto) &&
        /Este jogo foi encerrado aqui\./.test(capa.texto) && capa.attrs['aria-modal'] === 'true', capa && capa.texto);
  const botao = capa && capa.acha((e) => e.tagName === 'button');
  check('A: com o botão "Entrar de novo"', !!botao && botao.textContent === 'Entrar de novo');
  check('A: a Nuvem parou de vez e a Autoridade também', J.Nuvem.encerrada() && !J.Nuvem.estado().ligada && !J.Autoridade.ligada());
  check('A: a Rede saiu, a praça e a agenda pararam', m.toques.rede === 1 && m.toques.hub === 1 && m.toques.agenda === 1, JSON.stringify(m.toques));
  check('A: a Nuvem NÃO esqueceu a sessão sozinha (quem esquece é o "Entrar de novo")', !!m.local.get('soterra-sessao'));
  check('A: a olhada de 30 s parou', m.intervalos.filter((x) => x.ms === 30000).every((x) => x.parado));
  const antes = m.pedidos.length;
  J.Progress.save();
  J.Nuvem.descarrega();
  (m.ouvWin.pagehide || []).forEach((f) => f({}));
  (m.ouvDoc.visibilitychange || []).forEach((f) => f({}));
  await J.Nuvem.retomar();
  await J.Nuvem.puxar();
  await J.Nuvem.iniciar();
  J.Autoridade.op('equipar', { heroId: 'sumo', itemId: 'x' });
  await espera(60);
  check('A: depois da queda NENHUM pedido sai (save, descarga do pagehide, retomar, op, olhada)', m.pedidos.length === antes,
        JSON.stringify(m.pedidos.slice(antes)));
  let prevenido = false, parado = false;
  const ev = { type: 'keydown', key: 'i', target: {}, preventDefault() { prevenido = true; }, stopPropagation() { parado = true; }, stopImmediatePropagation() {} };
  (m.ouvWin.keydown || []).forEach((f) => f(ev));
  check('A: as teclas não chegam mais ao jogo (presas na captura)', prevenido && parado);
  check('A: nada de alert() nem confirm()', m.g.alerts === 0);
  J.Sessao.semRecarga = true;
  botao.click();
  check('A: "Entrar de novo" esquece a sessão morta e guarda a frase para a tela de entrar',
        !m.local.get('soterra-sessao') && m.sessao.get('soterra-aviso-entrar') === J.Sessao.FRASE_DERRUBADA);
}

async function cenaB() {
  const caixa = {};
  const m = mundo({
    sessao: SES_VELHA,
    responde: (rota, tk) => {
      if (tk === SES_NOVA.token) return { status: 200, corpo: { ok: true, conta: SES_NOVA.conta } };
      // enquanto o pedido com o token velho viajava, a mesma conta entrou de novo por outra aba deste navegador
      caixa.m.local.set('soterra-sessao', JSON.stringify(SES_NOVA));
      return R401;
    }
  });
  caixa.m = m;
  const { J } = m;
  let adotou = 0;
  m.g.addEventListener('soterra:sessao', (ev) => { if (ev.detail.tipo === 'adotou') adotou++; });
  const r = await J.Sessao.api('/api/eu');
  check('B: token novo da MESMA conta no localStorage: a página adota e o pedido sai de novo com ele (200)',
        r.status === 200 && m.pedidos.length === 2 && m.pedidos[0].token === SES_VELHA.token && m.pedidos[1].token === SES_NOVA.token,
        JSON.stringify(m.pedidos));
  check('B: ...e o jogo NÃO cai (sem capa, sem Rede desligada)', !J.Sessao.derrubadaJa() && !capaDe(m) && m.toques.rede === 0 && adotou === 1);
  const r2 = await J.Sessao.api('/api/eu');
  check('B: os pedidos seguintes já saem com o token novo', r2.status === 200 && m.pedidos[2].token === SES_NOVA.token);

  const caixa2 = {};
  const m2 = mundo({ sessao: SES_VELHA, responde: () => {
    caixa2.m.local.set('soterra-sessao', JSON.stringify(SES_OUTRA));    // outra CONTA entrou neste navegador
    return R401;
  } });
  caixa2.m = m2;
  const r3 = await m2.J.Sessao.api('/api/eu');
  check('B: token novo de OUTRA conta não é adotado: o jogo desta aba cai', m2.J.Sessao.derrubadaJa() && !!capaDe(m2) &&
        r3.derrubada === true && m2.pedidos.length === 1);
  m2.J.Sessao.semRecarga = true;
  check('B: e o "Entrar de novo" aí só recarrega (não apaga a sessão da outra conta)',
        m2.J.Sessao.entrarDeNovo() === 'recarrega' && JSON.parse(m2.local.get('soterra-sessao')).token === SES_OUTRA.token);
}

async function cenaC() {
  const m = mundo({ responde: () => R401 });
  const { J } = m;
  const r = await J.Nuvem.iniciar();
  check('C: sem sessão a Nuvem nem liga e não pede nada', r.erro === 'sem sessão' && m.pedidos.length === 0);
  check('C: sem sessão não há olhada de 30 s', J.Sessao.vigiaOutroAparelho() === false && m.intervalos.length === 0);
  await J.Sessao.api('/api/saude');
  check('C: sem token, nem um 401 com motivo derruba (não há sessão para cair)', !J.Sessao.derrubadaJa() && !capaDe(m) && m.toques.rede === 0);
}

async function cenaD() {
  let derrubada = false;
  const m = mundo({ sessao: SES_VELHA, escondida: true,
    responde: (rota, tk) => (derrubada ? R401 : { status: 200, corpo: { ok: true, conta: SES_VELHA.conta } }) });
  const { J, g } = m;
  check('D: com a aba escondida a olhada liga sem relógio correndo', J.Sessao.vigiaOutroAparelho() === true && m.intervalos.length === 0);
  derrubada = true;
  g.document.hidden = false;
  (m.ouvDoc.visibilitychange || []).forEach((f) => f({}));
  await espera(20);
  check('D: a aba volta: olha /api/eu NA HORA e religa o relógio de 30 s',
        m.pedidos.length === 1 && m.pedidos[0].rota === '/api/eu' && m.intervalos.some((x) => x.ms === 30000));
  check('D: ...e o 401 com motivo da olhada derruba o jogo', J.Sessao.derrubadaJa() && !!capaDe(m));
  const m2 = mundo({ sessao: SES_VELHA, responde: () => ({ status: 200, corpo: { ok: true } }) });
  m2.J.Sessao.vigiaOutroAparelho();
  m2.g.document.hidden = true;
  (m2.ouvDoc.visibilitychange || []).forEach((f) => f({}));
  check('D: a aba escondida para o relógio', m2.intervalos.length === 1 && m2.intervalos[0].parado);
  m2.intervalos[0].f();
  check('D: 401 sem o motivo (logout, sessão vencida) não derruba nada', !m2.J.Sessao.derrubadaJa());
}

function ligaRede(m) {
  const R = m.J.Rede;
  R.entrar({ id: 'h-ana', nome: 'Ana' });
  const ws = m.sockets[m.sockets.length - 1];
  const marca = /[?&]n=([0-9a-z]+)/.exec(ws.url)[1];
  ws.readyState = 1;
  ws.onopen();
  ws.onmessage({ data: JSON.stringify({ t: 'rele', v: 1, ident: true, n: marca, cx: 'abcd1234' }) });
  return ws;
}

async function cenaE() {
  const arquivos = ['js/core/sessao.js', 'js/core/rede.js'];
  const m = mundo({ sessao: SES_VELHA, redeDeVerdade: true, arquivos, responde: () => ({ status: 200, corpo: { ok: true } }) });
  const ws = ligaRede(m);
  const ident = ws.enviados.find((x) => x.t === 'ident');
  check('E: a Rede de verdade manda o ident com o token da sessão', !!ident && ident.token === SES_VELHA.token, JSON.stringify(ws.enviados));
  ws.onmessage({ data: JSON.stringify({ t: 'derrubado', motivo: 'outro-aparelho' }) });
  check('E: {t:derrubado} do relé derruba o jogo (capa) e fecha o socket', m.J.Sessao.derrubadaJa() && !!capaDe(m) && ws.fechou);
  ws.onclose({ code: 4001 });
  check('E: o fechamento 4001 depois disso NÃO agenda religar', m.adiados.filter((x) => !x.parado).length === 0 && m.sockets.length === 1,
        JSON.stringify(m.adiados.map((x) => x.ms)));
  check('E: e a Rede não liga de novo nesta aba', m.J.Rede.entrar({ id: 'h-ana', nome: 'Ana' }) === false && m.sockets.length === 1);

  const m2 = mundo({ sessao: SES_VELHA, redeDeVerdade: true, arquivos, responde: () => ({ status: 200, corpo: { ok: true } }) });
  const ws2 = ligaRede(m2);
  m2.local.set('soterra-sessao', JSON.stringify(SES_NOVA));   // a mesma conta entrou por outra aba
  ws2.onmessage({ data: JSON.stringify({ t: 'derrubado', motivo: 'outro-aparelho' }) });
  ws2.onclose({ code: 4001 });
  const religa = m2.adiados.filter((x) => !x.parado);
  check('E: com token novo da mesma conta: não cai e agenda religar', !m2.J.Sessao.derrubadaJa() && !capaDe(m2) && religa.length === 1);
  religa[0].f();
  const ws3 = m2.sockets[m2.sockets.length - 1];
  const marca = /[?&]n=([0-9a-z]+)/.exec(ws3.url)[1];
  ws3.readyState = 1;
  ws3.onopen();
  ws3.onmessage({ data: JSON.stringify({ t: 'rele', v: 1, ident: true, n: marca, cx: 'abcd5678' }) });
  const id3 = ws3.enviados.find((x) => x.t === 'ident');
  check('E: ...e a conexão nova se identifica com o token NOVO', ws3 !== ws2 && !!id3 && id3.token === SES_NOVA.token, JSON.stringify(ws3.enviados));
  m2.J.Rede.sair();

  const m3 = mundo({ sessao: SES_VELHA, redeDeVerdade: true, arquivos, responde: () => ({ status: 200, corpo: { ok: true } }) });
  const ws4 = ligaRede(m3);
  ws4.onclose({ code: 4001 });
  check('E: só o fechamento 4001 (a mensagem se perdeu) também derruba', m3.J.Sessao.derrubadaJa() && m3.adiados.filter((x) => !x.parado).length === 0);
}

(async function () {
  try {
    await cenaA();
    await cenaB();
    await cenaC();
    await cenaD();
    await cenaE();
  } catch (e) {
    check('a prova rodou até o fim', false, e && e.stack);
  }
  console.log('RESUMO: ' + (falhas ? 'FALHOU — ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})();
