#!/usr/bin/env node
'use strict';
/* PROVA DO JOGO GUARDADO NO APARELHO (06/10): sw.js e js/app_jogo.js.
 *
 *   node tests/app_jogo.js
 *
 * O pedido do dono: "o jogador pode ter a opção de salvar o jogo no celular, mas
 * só consegue conectar ao game com internet". Aqui fica a REGRA, com um cache e
 * uma rede de mentira (o service worker de verdade, num Chrome, está em
 * tests/app_jogo_sw.py):
 *   · FORA DO APLICATIVO nada é registrado nem guardado, e o index.html só
 *     escreve o js/app_jogo.js dentro do aplicativo;
 *   · no aplicativo, o arquivo pedido com o MESMO hash sai do aparelho; com hash
 *     DIFERENTE vai à rede, e o velho é apagado;
 *   · só fica guardado o que confere com o hash do endereço;
 *   · a página, o js/versao.js, /api/*, o site e o que não tem hash NUNCA são
 *     interceptados — é por isso que sem rede o jogo não abre;
 *   · cache quebrado → a rede, como hoje;
 *   · "Apagar o jogo guardado" e as duas válvulas (a linha do index.html e o
 *     DESLIGA do sw.js) tiram o service worker e o cache. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (extra !== undefined && !ok ? ' — ' + extra : ''));
}
const raiz = path.join(__dirname, '..');
const le = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const SW = le('sw.js');
const APP = le('js', 'app_jogo.js');
const ORIGEM = 'https://jogo.test';
const h12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

/* Um service worker de mentira: o sw.js roda num contexto com cache e rede falsos. */
function operario(op) {
  op = op || {};
  const ouv = {}, guardado = new Map(), rede = [];
  const arquivos = op.arquivos || {};                 // caminho -> conteúdo que o SERVIDOR tem
  const cache = {
    match: async (k) => { const u = typeof k === 'string' ? k : k.url; return guardado.has(u) ? guardado.get(u).clone() : undefined; },
    put: async (k, r) => { if (op.cheio) throw new Error('QuotaExceededError'); guardado.set(typeof k === 'string' ? k : k.url, r); },
    keys: async () => [...guardado.keys()].map((u) => ({ url: u })),
    delete: async (k) => guardado.delete(typeof k === 'string' ? k : k.url)
  };
  const st = { desregistrou: false, apagouCache: 0, guardado, rede };
  const self = {
    location: { origin: ORIGEM },
    registration: { scope: ORIGEM + '/', unregister: async () => { st.desregistrou = true; return true; } },
    clients: { claim: async () => {} },
    crypto: crypto.webcrypto,
    skipWaiting() {},
    addEventListener: (t, f) => { ouv[t] = f; }
  };
  const ctx = {
    self, URL, Response, Request, Promise, Uint8Array, String, console,
    caches: {
      open: async () => { if (op.quebrado) throw new Error('cache quebrado'); return cache; },
      delete: async () => { st.apagouCache++; guardado.clear(); return true; }
    },
    fetch: async (r) => {
      const u = new URL(typeof r === 'string' ? r : r.url);
      rede.push(u.pathname + u.search);
      if (op.semRede) throw new TypeError('Failed to fetch');
      if (!(u.pathname in arquivos)) return new Response('', { status: 404 });
      const resp = new Response(arquivos[u.pathname], { status: 200, headers: { 'Content-Type': 'text/javascript' } });
      Object.defineProperty(resp, 'type', { value: 'basic' });
      const clone = resp.clone.bind(resp);
      resp.clone = () => { const c = clone(); Object.defineProperty(c, 'type', { value: 'basic' }); return c; };
      return resp;
    }
  };
  vm.createContext(ctx);
  vm.runInContext(op.fonte || SW, ctx);
  /* Um pedido da página. Devolve { meu, texto }: meu=false → o navegador busca sozinho. */
  st.pede = async (caminho, extra) => {
    let resposta = null; const esperas = [];
    const ev = {
      request: Object.assign({ method: 'GET', url: ORIGEM + caminho }, extra || {}),
      respondWith: (p) => { resposta = p; },
      waitUntil: (p) => { esperas.push(p); }
    };
    ouv.fetch(ev);
    if (!resposta) return { meu: false };
    const r = await resposta;
    const texto = await r.text();
    await Promise.all(esperas);
    return { meu: true, texto, status: r.status };
  };
  st.recado = (msg) => new Promise((ok) => {
    const esperas = [];
    ouv.message({ data: msg, ports: [{ postMessage: ok }], waitUntil: (p) => esperas.push(p) });
  });
  st.ativa = async () => { let p; ouv.activate({ waitUntil: (x) => { p = x; } }); await p; };
  st.alvo = ctx.alvo;
  return st;
}

/* A página de mentira para o js/app_jogo.js. op: { capacitor, busca, host, versao, pref, valvula, semSW } */
function janela(op) {
  op = op || {};
  const cofre = {}; if (op.pref) cofre['soterra-app-jogo'] = op.pref;
  const st = { registros: [], desregistros: 0, conferencias: 0, consultas: 0, apagados: [], recados: [] };
  const reg = {
    active: { scriptURL: 'https://x/sw.js', postMessage: (m, portas) => { st.recados.push(m); portas[0].postMessage({ n: 3, bytes: 3 * 1048576 }); } },
    unregister: async () => { st.desregistros++; return true; },
    update: async () => { st.conferencias++; }
  };
  const ctx = {
    console, Promise, JSON, Math, Number, String, Object, setTimeout, clearTimeout,
    MessageChannel: function () {
      const c = this; c.port1 = {}; c.port2 = { postMessage: (d) => setTimeout(() => c.port1.onmessage({ data: d }), 0) };
    },
    location: { search: op.busca || '', hostname: op.host || 'soterra.viidoo.io' },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(cofre, k) ? cofre[k] : null),
      setItem: (k, v) => { cofre[k] = String(v); },
      removeItem: (k) => { delete cofre[k]; }
    },
    navigator: op.semSW ? {} : { serviceWorker: {
      register: async (u, o) => { st.registros.push([u, o]); return reg; },
      ready: Promise.resolve(reg),
      getRegistration: async () => reg,
      getRegistrations: async () => { st.consultas++; return [reg]; }
    } },
    caches: { delete: async (n) => { st.apagados.push(n); return true; } },
    SOTERRA_VERSAO: op.versao || { versao: 'abc', peso: 13 * 1048576, arquivos: {
      'js/main.js': 'aaaaaaaaaaaa', 'css/style.css': 'bbbbbbbbbbbb', 'site/site.js': 'cccccccccccc',
      'sw.js': 'dddddddddddd', 'assets/models/bundle/manifest.json': 'eeeeeeeeeeee', 'js/novo.js': 'sem-hash' } }
  };
  if (op.capacitor) ctx.Capacitor = { isNativePlatform: () => true };
  if (op.valvula === false) ctx.__guardaJogo = false;
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(APP, ctx);
  st.G = ctx.JOGO.AppJogo; st.cofre = cofre;
  return st;
}

(async function () {
  // ------------------------------------------------------------ a regra do que é interceptado
  const A = 'aaaaaaaaaaaa';
  let o = operario();
  const al = (u, m) => o.alvo(m || 'GET', ORIGEM + u, ORIGEM);
  check('script com hash é do aparelho', al('/js/main.js?v=' + A) === A);
  check('folha com hash é do aparelho', al('/css/style.css?v=' + A) === A);
  check('a página nunca', al('/') === null && al('/index.html') === null && al('/index.html?v=' + A) === null);
  check('o js/versao.js nunca', al('/js/versao.js?t=1759700000000') === null && al('/js/versao.js?v=' + A) === null);
  check('/api nunca, nem com hash e cara de script', al('/api/conta') === null && al('/api/x.js?v=' + A) === null);
  check('o relé e o site nunca', al('/rele/x.js?v=' + A) === null && al('/site/site.js?v=' + A) === null);
  check('sem hash (carimbo do instante, sem nada) nunca', al('/js/main.js') === null && al('/js/main.js?v=1759700000000') === null);
  check('modelo, manifesto e imagem nunca', al('/assets/models/bundle/a.glb?h=' + A) === null &&
        al('/assets/models/bundle/manifest.json?v=' + A) === null && al('/site/img/a.webp?v=' + A) === null);
  check('POST nunca', al('/js/main.js?v=' + A, 'POST') === null);
  check('outra origem nunca', o.alvo('GET', 'https://outro.test/js/main.js?v=' + A, ORIGEM) === null);
  check('o próprio sw.js nunca', al('/sw.js?v=' + A) === null);

  // ------------------------------------------------------------ mesma versão: do aparelho; versão nova: da rede
  const v1 = 'console.log(1)', v2 = 'console.log(2)';
  o = operario({ arquivos: { '/js/main.js': v1 } });
  let r = await o.pede('/js/main.js?v=' + h12(v1));
  check('1ª vez: vem da rede e fica guardado', r.meu && r.texto === v1 && o.rede.length === 1 && o.guardado.size === 1);
  r = await o.pede('/js/main.js?v=' + h12(v1));
  check('mesma versão: sai do aparelho, sem ir à rede', r.meu && r.texto === v1 && o.rede.length === 1);
  r = await o.pede('/', { mode: 'navigate' });
  check('a navegação não é interceptada (sem rede, a página não abre)', r.meu === false && o.rede.length === 1);
  r = await o.pede('/api/conta');
  check('/api não é interceptado', r.meu === false);
  r = await o.pede('/js/versao.js?t=1');
  check('o js/versao.js não é interceptado', r.meu === false);

  // o servidor mudou o arquivo: a página (que veio da rede) pede o hash novo
  o = operario({ arquivos: { '/js/main.js': v1 } });
  await o.pede('/js/main.js?v=' + h12(v1));
  const srv = operario({ arquivos: { '/js/main.js': v2 } });
  for (const [k, x] of o.guardado) srv.guardado.set(k, x);
  r = await srv.pede('/js/main.js?v=' + h12(v2));
  check('versão nova: vai à rede e entrega o NOVO', r.meu && r.texto === v2 && srv.rede.length === 1);
  check('…e o novo fica guardado ao lado do velho, até o acerto', srv.guardado.size === 2);
  let e = await srv.recado({ tipo: 'acerta', urls: ['/js/main.js?v=' + h12(v2)], completar: false });
  check('o acerto apaga a versão velha', srv.guardado.size === 1 && [...srv.guardado.keys()][0].endsWith(h12(v2)) && e.n === 1);
  check('…e conta os bytes guardados', e.bytes === v2.length, JSON.stringify(e));

  // rolling update: o hash novo caiu no contêiner velho, que devolve o arquivo antigo
  o = operario({ arquivos: { '/js/main.js': v1 } });
  r = await o.pede('/js/main.js?v=' + h12(v2));
  check('conteúdo que não bate com o hash NÃO fica guardado', r.meu && r.texto === v1 && o.guardado.size === 0);
  r = await o.pede('/js/main.js?v=' + h12(v2));
  check('…e a vez seguinte pergunta à rede de novo', o.rede.length === 2);

  // ------------------------------------------------------------ falhas: a rede, como hoje
  o = operario({ arquivos: { '/js/main.js': v1 }, quebrado: true });
  r = await o.pede('/js/main.js?v=' + h12(v1));
  check('cache quebrado: o arquivo vem da rede', r.meu && r.texto === v1);
  o = operario({ arquivos: { '/js/main.js': v1 }, cheio: true });
  r = await o.pede('/js/main.js?v=' + h12(v1));
  check('cache cheio: o arquivo vem da rede e nada trava', r.meu && r.texto === v1 && o.guardado.size === 0);
  o = operario({ arquivos: {} });
  r = await o.pede('/js/sumiu.js?v=' + A);
  check('404 passa como veio e não é guardado', r.meu && r.status === 404 && o.guardado.size === 0);

  // ------------------------------------------------------------ baixar tudo, apagar, a válvula
  o = operario({ arquivos: { '/js/a.js': 'a', '/js/b.js': 'b', '/api/c.js': 'c' } });
  e = await o.recado({ tipo: 'acerta', completar: true,
    urls: ['/js/a.js?v=' + h12('a'), '/js/b.js?v=' + h12('b'), '/api/c.js?v=' + h12('c'), '/js/falta.js?v=' + A] });
  check('"Baixar tudo" guarda o que falta — e só o que é do jogo', e.n === 2 && o.guardado.size === 2, JSON.stringify(e));
  const antes = o.rede.length;
  e = await o.recado({ tipo: 'acerta', completar: true, urls: ['/js/a.js?v=' + h12('a'), '/js/b.js?v=' + h12('b')] });
  check('o que já está guardado não desce de novo', o.rede.length === antes && e.n === 2);
  e = await o.recado({ tipo: 'estado' });
  check('o estado diz arquivos e bytes', e.n === 2 && e.bytes === 2);
  e = await o.recado({ tipo: 'apaga' });
  check('apagar esvazia', e.n === 0 && o.guardado.size === 0 && o.apagouCache === 1);

  o = operario({ arquivos: { '/js/main.js': v1 } });
  await o.ativa();
  check('ligado: ativar não desregistra', !o.desregistrou);
  o = operario({ arquivos: { '/js/main.js': v1 }, fonte: SW.replace('var DESLIGA = false;', 'var DESLIGA = true;') });
  check('a válvula existe no sw.js', SW.indexOf('var DESLIGA = false;') > 0);
  o.guardado.set('x', 1);
  await o.ativa();
  check('VÁLVULA do sw.js: ao assumir apaga o cache e se desregistra', o.desregistrou && o.apagouCache === 1 && o.guardado.size === 0);
  r = await o.pede('/js/main.js?v=' + h12(v1));
  check('…e não intercepta mais nada', r.meu === false);

  // ------------------------------------------------------------ a página: js/app_jogo.js
  let w = janela({});
  check('WEB: não é o aplicativo, não pode, não está ligado', !w.G.noApp() && !w.G.pode() && !w.G.ligado());
  await w.G.abre();
  check('WEB: abrir não registra, não consulta e não apaga nada', w.registros.length === 0 && w.consultas === 0 && w.apagados.length === 0);
  check('WEB: sem seção nas Configurações', w.G.secaoConfig() === null);
  w = janela({ busca: '?app=1' });
  await w.G.abre();
  check('WEB com ?app=1 no domínio do jogo: também não registra', !w.G.noApp() && w.registros.length === 0 && w.consultas === 0);
  w = janela({ busca: '?app=1', host: 'localhost' });
  check('?app=1 em endereço local (as provas) vale como aplicativo', w.G.noApp() && w.G.ligado());

  w = janela({ capacitor: true });
  check('APLICATIVO: ligado por padrão', w.G.noApp() && w.G.pode() && w.G.ligado());
  check('a lista leva só .js/.css do jogo, com hash', w.G.lista(w.SOTERRA_VERSAO || undefined).length === 0 &&
        JSON.stringify(w.G.lista({ versao: 'x', arquivos: { 'js/main.js': A, 'site/s.js': A, 'sw.js': A, 'js/versao.js': A, 'a/manifest.json': A, 'js/n.js': 'dev' } })) === JSON.stringify(['/js/main.js?v=' + A]));
  await w.G.abre();
  check('APLICATIVO: registra o /sw.js na raiz, sem cache no meio', w.registros.length === 1 && w.registros[0][0] === '/sw.js' &&
        w.registros[0][1].scope === '/' && w.registros[0][1].updateViaCache === 'none');
  check('…e manda conferir o /sw.js com o servidor (é por onde a válvula chega)', w.conferencias === 1);
  check('…e manda a lista de agora, sem completar (Jogar agora)', w.recados.length === 1 && w.recados[0].tipo === 'acerta' &&
        w.recados[0].completar === false && w.recados[0].urls.join(' ') === '/css/style.css?v=bbbbbbbbbbbb /js/main.js?v=aaaaaaaaaaaa', JSON.stringify(w.recados));
  check('o peso vem do build', w.G.peso() === 13 * 1048576);
  await w.G.apaga();
  check('"Apagar o jogo guardado": desregistra, apaga o cache e lembra', w.desregistros === 1 && w.apagados.join() === 'soterra-jogo-1' &&
        w.cofre['soterra-app-jogo'] === 'nao' && !w.G.ligado());
  await w.G.guarda();
  check('"Guardar o jogo": volta a registrar', w.G.ligado() && w.registros.length === 2);

  w = janela({ capacitor: true, pref: 'nao' });
  await w.G.abre();
  check('quem apagou: a abertura não registra e garante que nada ficou', w.registros.length === 0 && w.desregistros === 1 && w.apagados.length === 1);
  w = janela({ capacitor: true, valvula: false });
  await w.G.abre();
  check('VÁLVULA do index.html: não registra, desregistra e apaga', !w.G.pode() && w.registros.length === 0 && w.desregistros === 1 && w.apagados.length === 1);
  check('…e a seção das Configurações some', w.G.secaoConfig() === null);
  w = janela({ capacitor: true, versao: { versao: 'dev', arquivos: {} } });
  await w.G.abre();
  check('sem o mapa do build (em casa, --embutida): não registra', !w.G.pode() && w.registros.length === 0);
  w = janela({ capacitor: true, semSW: true });
  check('WebView sem service worker: nada acontece, o jogo abre da rede', !w.G.pode() && (await w.G.abre()) === null && (await w.G.completa()) === null);

  // ------------------------------------------------------------ onde está escrito
  const idx = le('index.html');
  const iApp = idx.indexOf("/[?&]app=1(&|$)/.test(location.search) ||"), iFim = idx.indexOf('} catch (eApp) {}');
  const bloco = idx.slice(iApp, iFim);
  check('o index.html só escreve o js/app_jogo.js dentro do aplicativo', iApp > 0 && iFim > iApp &&
        bloco.indexOf("window.__url('js/app_jogo.js')") > 0 && idx.split('app_jogo.js').length === bloco.split('app_jogo.js').length);
  check('a válvula e a limpeza estão na própria página, dentro do aplicativo', bloco.indexOf('window.__guardaJogo = true;') > 0 &&
        bloco.indexOf("window.caches.delete('soterra-jogo-1')") > 0 && idx.split('serviceWorker').length === bloco.split('serviceWorker').length);
  const quemRegistra = [];
  (function anda(d) {
    for (const n of fs.readdirSync(path.join(raiz, d))) {
      const rel = d + '/' + n;
      if (fs.statSync(path.join(raiz, rel)).isDirectory()) anda(rel);
      else if (/\.(js|html)$/.test(n) && /serviceWorker\s*\.\s*register|\.register\(SW/.test(le(rel))) quemRegistra.push(rel);
    }
  })('js');
  for (const d of ['site', 'app']) (function anda(p) {
    for (const n of fs.readdirSync(path.join(raiz, p))) {
      const rel = p + '/' + n;
      if (fs.statSync(path.join(raiz, rel)).isDirectory()) anda(rel);
      else if (/\.(js|html)$/.test(n) && /serviceWorker/.test(le(rel))) quemRegistra.push(rel);
    }
  })(d);
  check('só o js/app_jogo.js registra service worker (o site e a casca não)', quemRegistra.join() === 'js/app_jogo.js', quemRegistra.join());
  const cad = le('servidor', 'coolify', 'Caddyfile');
  check('o Caddy não manda guardar o /sw.js (só o que tem marca ?v=/?h=)', /header Cache-Control "no-cache"/.test(cad) && !/sw\.js/.test(cad));
  const hud = le('js', 'ui', 'hud.js');
  check('a seção das Configurações só entra com o AppJogo', hud.indexOf('JOGO.AppJogo && JOGO.AppJogo.secaoConfig()') > 0);

  console.log('\n' + (total - falhas) + ' de ' + total + ' passaram');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
