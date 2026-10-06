#!/usr/bin/env node
'use strict';
/* A REGRA DO PORTEIRO (06/10, o dono: somente online, "tem que exigir conta sempre!!").
 *
 *   node tests/porteiro.js
 *
 * No ar o jogo não abre sem sessão; em casa (file://, localhost, 127.0.0.1, [::1]) abre, porque
 * centenas de provas abrem o jogo sem servidor. A regra é pelo ENDEREÇO. Esta prova roda o
 * <script id="porteiro"> LIDO DO index.html (não uma cópia) numa janela de mentira e cobra:
 *   - domínio de produção, IP de rede, o aplicativo → exige; a casa → não exige;
 *   - parâmetro de URL nenhum afrouxa, nem endereço que só PARECE de casa;
 *   - o `exigeConta` do js/versao.js (o jeito de as provas verem "no ar" em 127.0.0.1) só APERTA;
 *   - sem sessão: vai para a tela de entrar, com a marca de volta, e a página não pede mais nada;
 *   - com sessão: abre, e pergunta ao servidor — só o 401 manda embora;
 *   - o js/core/contas.js no ar: a janela é sempre a Principal (`?conta=` não vale, nem a visitante).
 * O caminho inteiro, num Chrome com a API de verdade: tests/sessao_navegador.py. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.resolve(__dirname, '..');
const IDX = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const CONTAS = fs.readFileSync(path.join(RAIZ, 'js/core/contas.js'), 'utf8');
let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (ok || extra === undefined ? '' : ' — ' + JSON.stringify(extra)));
}
const m = /<script id="porteiro">([\s\S]*?)<\/script>/.exec(IDX);
check('o index.html tem o <script id="porteiro">, no <head> e antes de qualquer arquivo do jogo',
  !!m && m.index < IDX.indexOf('</head>') && m.index < IDX.indexOf("window.__url('js/assets_bundle.js')") &&
  m.index > IDX.indexOf('js/versao.js?t='));
const BLOCO = m ? m[1] : '';

function armazem(ini) {
  const d = Object.assign({}, ini || {});
  return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); },
           removeItem: (k) => { delete d[k]; }, _d: d };
}
const SESSAO = JSON.stringify({ token: 'tok-1', conta: { id: 7, nome: 'Ana' } });
/* Abre a "página": url, o que o servidor mandou no js/versao.js, o Capacitor, a sessão, a resposta do /api/eu. */
function abre(url, op) {
  op = op || {};
  const u = new URL(url);
  const w = { navegou: [], pedidos: [], recarregando: [] };
  w.location = { protocol: u.protocol, hostname: u.hostname, search: u.search, pathname: u.pathname,
                 replace: (x) => w.navegou.push(x) };
  w.localStorage = armazem(Object.assign(op.sessao ? { 'soterra-sessao': op.sessao } : {}, op.local || {}));
  w.sessionStorage = armazem();
  w.document = { documentElement: { atr: {}, setAttribute(k, v) { this.atr[k] = v; } } };
  w.__boot = { recarregando: (x) => w.recarregando.push(x) };
  if (op.versao !== undefined) w.SOTERRA_VERSAO = op.versao;
  if (op.nativo) w.Capacitor = { isNativePlatform: () => true };
  if (op.eu !== undefined) {
    w.fetch = (end, ped) => {
      w.pedidos.push({ end, auth: ped && ped.headers && ped.headers.Authorization });
      return op.eu === 'fora' ? Promise.reject(new Error('rede')) : Promise.resolve({ status: op.eu });
    };
  }
  w.window = w;
  vm.runInNewContext(BLOCO, w);
  return w;
}
const espera = () => new Promise((r) => setTimeout(r, 5));
const foiEntrar = (w) => w.navegou.length === 1 && w.navegou[0] === 'site/conta.html#entrar' && w.__portao === true;

(async function () {
  const P = abre('http://127.0.0.1:8100/index.html').JOGO.Porteiro;
  // ---- a regra pura
  const exige = [['https:', 'soterra.viidoo.io'], ['http:', 'soterra.viidoo.io'], ['https:', 'exemplo.com'],
    ['http:', '192.168.0.10'], ['http:', '10.0.0.5'], ['https:', 'localhost.exemplo.com'], ['https:', '127.0.0.1.exemplo.com'],
    ['http:', 'meu.localhost'], ['http:', '0.0.0.0'], ['http:', ''], ['capacitor:', 'app']];
  const casa = [['file:', ''], ['http:', 'localhost'], ['https:', 'localhost'], ['http:', '127.0.0.1'], ['http:', '[::1]'],
    ['http:', 'LOCALHOST']];
  check('domínio de verdade, IP de rede e endereço que só parece de casa → exige conta',
    exige.every((e) => P.exigeEm(e[0], e[1], undefined, false) === true), exige.filter((e) => !P.exigeEm(e[0], e[1])));
  check('file://, localhost, 127.0.0.1 e [::1] → não exige', casa.every((e) => P.exigeEm(e[0], e[1], undefined, false) === false),
    casa.filter((e) => P.exigeEm(e[0], e[1])));
  check('o exigeConta do js/versao.js faz a casa exigir (é assim que a prova vê "no ar")',
    P.exigeEm('http:', '127.0.0.1', { versao: 'dev', exigeConta: true }, false) === true &&
    P.exigeEm('file:', '', { exigeConta: true }, false) === true);
  check('…e só APERTA: no domínio de verdade, exigeConta false (ou qualquer outro valor) não afrouxa',
    [false, 0, null, 'nao', undefined].every((v) => P.exigeEm('https:', 'soterra.viidoo.io', { versao: 'x', exigeConta: v }, false) === true) &&
    P.exigeEm('http:', '127.0.0.1', { exigeConta: 'true' }, false) === false);
  check('o aplicativo (Capacitor nativo) exige mesmo servido do https://localhost do pacote',
    P.exigeEm('https:', 'localhost', undefined, true) === true);

  // ---- no ar, sem sessão
  let w = abre('https://soterra.viidoo.io/index.html');
  check('produção sem sessão: vai para a tela de entrar e o resto da página não pede nada (window.__portao)', foiEntrar(w), w.navegou);
  check('…com a marca de volta na aba, a marca do portão e a marca de abertura limpa',
    w.sessionStorage._d['soterra-volta-jogo'] === '1' && w.document.documentElement.atr['data-portao-conta'] === '1' &&
    w.recarregando.length === 1);
  const burlas = ['?conta=2', '?conta=visitante', '?conta=seguro', '?local=1', '?exigeConta=0', '?dev=1&sandbox=1', '?app=1',
    '?api=http://127.0.0.1:8300', '?gm=1', '?host=localhost'];
  check('parâmetro de URL nenhum abre o jogo sem conta no ar',
    burlas.every((q) => foiEntrar(abre('https://soterra.viidoo.io/index.html' + q))), burlas);
  check('sessão estragada no disco (sem token, sem conta, lixo) não é sessão',
    ['{"token":"","conta":{}}', '{"token":"x"}', '{"conta":{"id":1}}', 'lixo', 'null', '{"token":"x","conta":"y"}']
      .every((s) => foiEntrar(abre('https://soterra.viidoo.io/index.html', { sessao: s }))));
  check('o aplicativo sem sessão vai para a tela de entrar (endereço relativo: fica no WebView)',
    foiEntrar(abre('https://soterra.viidoo.io/index.html', { nativo: true })) &&
    foiEntrar(abre('https://localhost/index.html', { nativo: true })));
  check('127.0.0.1 com o servidor mandando exigir: sem sessão vai para a tela de entrar',
    foiEntrar(abre('http://127.0.0.1:8147/index.html', { versao: { versao: 'dev', arquivos: {}, exigeConta: true } })));

  const EM_DIA = { 'soterra-nuvem-v1': JSON.stringify({ versao: 3, conta: 9, sujo: false }), 'soterra-save-v2': '{"a":1}',
    'soterra-conta-v1': '{}', 'soterra-save-v2:visitante': '{"v":1}', 'soterra-conta-v1:visitante': '{}' };
  w = abre('https://soterra.viidoo.io/index.html', { local: EM_DIA });
  const w2 = abre('https://soterra.viidoo.io/index.html', { local: Object.assign({}, EM_DIA,
    { 'soterra-nuvem-v1': JSON.stringify({ versao: 3, conta: 9, sujo: true }) }) });
  check('sair é sair: sem sessão, o save em dia de uma conta sai do disco; o pendente fica guardado; o de visitante não é tocado',
    foiEntrar(w) && !('soterra-save-v2' in w.localStorage._d) && !('soterra-nuvem-v1' in w.localStorage._d) &&
    w.localStorage._d['soterra-save-v2:visitante'] === '{"v":1}' && 'soterra-conta-v1:visitante' in w.localStorage._d &&
    foiEntrar(w2) && w2.localStorage._d['soterra-save-v2'] === '{"a":1}', Object.keys(w.localStorage._d));

  // ---- no ar, com sessão
  w = abre('https://soterra.viidoo.io/index.html', { sessao: SESSAO, eu: 200 });
  await espera();
  check('produção com sessão: o jogo abre, e a sessão é conferida no servidor da MESMA origem, com o token no cabeçalho',
    w.navegou.length === 0 && !w.__portao && w.pedidos.length === 1 && w.pedidos[0].end === '/api/eu' &&
    w.pedidos[0].auth === 'Bearer tok-1', w.pedidos);
  w = abre('https://soterra.viidoo.io/index.html?api=http://fora.exemplo', { sessao: SESSAO, eu: 200, local: { 'soterra-api-base': 'http://fora.exemplo' } });
  check('no ar a pergunta nunca vai para uma API de fora (nem pelo ?api=, nem pela lembrada)', w.pedidos[0].end === '/api/eu', w.pedidos);
  w = abre('https://soterra.viidoo.io/index.html', { sessao: SESSAO, eu: 401 });
  await espera();
  check('sessão que morreu no servidor (401): sai do navegador e a página vai para a tela de entrar',
    foiEntrar(w) && !('soterra-sessao' in w.localStorage._d), w.navegou);
  w = abre('https://soterra.viidoo.io/index.html', { sessao: SESSAO, eu: 401 });
  w.localStorage.setItem('soterra-sessao', JSON.stringify({ token: 'tok-2', conta: { id: 7 } }));   // outra aba entrou no meio
  await espera();
  check('401 do token velho com um token novo já no navegador: a sessão nova fica', w.navegou.length === 0 && 'soterra-sessao' in w.localStorage._d);
  let ficou = true;
  for (const eu of ['fora', 500, 502, 403, 200]) {
    w = abre('https://soterra.viidoo.io/index.html', { sessao: SESSAO, eu });
    await espera();
    if (w.navegou.length || !('soterra-sessao' in w.localStorage._d)) ficou = false;
  }
  check('servidor fora, 5xx, 403 (o banimento tem a tela dele): o porteiro não derruba ninguém', ficou);

  // ---- em casa
  let casaAbre = true;
  for (const url of ['file:///C:/Jogo/index.html', 'http://localhost:8100/index.html', 'http://127.0.0.1:8100/index.html?conta=2',
    'http://[::1]:8100/index.html', 'http://127.0.0.1:8100/index.html']) {
    w = abre(url, { versao: { versao: 'dev', arquivos: {} }, eu: 401 });
    if (w.navegou.length || w.__portao || w.pedidos.length || w.JOGO.Porteiro.exige()) casaAbre = false;
  }
  check('em casa (file://, localhost, 127.0.0.1, [::1]) o jogo abre sem conta e o porteiro não pergunta nada', casaAbre);

  // ---- o js/core/contas.js: no ar a janela é a Principal
  function contas(busca, noAr, local) {
    const g = { JOGO: {}, navegou: null };
    g.location = { search: busca };
    Object.defineProperty(g.location, 'search', { get: () => busca, set: (v) => { g.navegou = v; } });
    g.localStorage = armazem(local || {});
    if (noAr !== null) g.JOGO.Porteiro = { exige: () => noAr };
    g.window = g;
    g.globalThis = g;
    vm.runInNewContext(CONTAS, g);
    return g;
  }
  const SUJO = { 'soterra-nuvem-v1': JSON.stringify({ versao: 3, conta: 9, sujo: true }), 'soterra-save-v2': '{}' };
  const REG = { 'soterra-contas-v1': JSON.stringify({ ativa: 'c2', lista: [{ id: 'principal' }, { id: 'c2' }] }) };
  let g = contas('?conta=2', true, { 'soterra-sessao': SESSAO });
  check('no ar, `?conta=2` não vale: a janela é a Principal e a conta 2 nem nasce',
    g.JOGO.Contas.ativa() === 'principal' && g.JOGO.Contas.sufixo() === '' && !('soterra-contas-v1' in g.localStorage._d));
  g = contas('', true, Object.assign({ 'soterra-sessao': SESSAO }, REG));
  g.JOGO.Contas.trocar('c2');
  check('no ar, a última conta local escolhida não vale e o trocar não navega', g.JOGO.Contas.ativa() === 'principal' && g.navegou === null);
  g = contas('', true, SUJO);
  check('no ar não existe a visitante, e o save com gravação pendente segue guardado para a dona',
    g.JOGO.Contas.ativa() === 'principal' && 'soterra-save-v2' in g.localStorage._d);
  g = contas('?conta=2', false, {});
  const g2 = contas('', null, SUJO);
  check('em casa nada mudou: `?conta=2` prende a janela, e sem sessão o save de outra conta leva à visitante',
    g.JOGO.Contas.ativa() === '2' && g2.JOGO.Contas.ativa() === 'visitante' && g2.JOGO.Contas.noAr() === false);

  // ---- a página: com o portão fechado nada desce
  const depois = IDX.slice(IDX.indexOf('</head>'));
  const blocos = depois.match(/<script>[\s\S]*?<\/script>/g) || [];
  check('todo bloco do <body> que pede arquivo olha window.__portao antes',
    blocos.length >= 3 && blocos.every((b) => b.indexOf('document.write') < 0 || /window\.__portao/.test(b)),
    blocos.filter((b) => !/window\.__portao/.test(b)).map((b) => b.slice(0, 80)));

  console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
  process.exit(falhas ? 1 : 0);
})();
