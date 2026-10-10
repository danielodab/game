#!/usr/bin/env node
'use strict';
/* O TORNEIO DA ARENA NO PERFIL DA PRAÇA (10/10) — js/core/rede.js num mundo de mentira do Node.
 *
 *   node tests/torneio_perfil.js
 *
 * docs/TORNEIO.md, seção 3: o Relé carimba no envelope `arena: {n, vigente}` e, na guilda do perfil,
 * `campea` e `titulos`. A Rede só os deixa passar (limpos) até a tela; a página nunca os manda. Cobra:
 *   - o `arena` do oi chega ao par e ao evento de entrada (é dele que o hub3d tira o grau, as marcas e o
 *     louro da moldura do Campeão); torto vira null; sem conquista e sem vigência é null;
 *   - a moldura 'arena' viaja (as outras ids desconhecidas seguem virando 'auto');
 *   - ganhar um torneio sem sair do lugar avisa `mudouVisual` com o `arena` novo, uma vez;
 *   - a guilda campeã: `campea` e `titulos` valem dentro de `resumo.guilda` ou num `guilda` do envelope,
 *     e a tela os lê sempre de `resumo.guilda` (até 5 marcas);
 *   - o MEU cartão não leva `arena` (quem carimba é o Relé). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const raiz = path.join(__dirname, '..');
let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
function mundo() {
  const local = new Map(), sockets = [];
  local.set('soterra-sessao', JSON.stringify({ token: 'b'.repeat(64), conta: { id: 7, nome: 'Ana', gm: false } }));
  const g = {
    console, Promise, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, Uint8Array,
    localStorage: { getItem: (k) => (local.has(k) ? local.get(k) : null), setItem: (k, v) => local.set(k, String(v)), removeItem: (k) => local.delete(k) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { protocol: 'https:', hostname: 'soterra.test', host: 'soterra.test', search: '', hash: '', href: 'https://soterra.test/index.html' },
    document: { hidden: false, addEventListener() {} },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) })
  };
  g.WebSocket = class {
    constructor(url) { this.url = url; this.readyState = 0; this.enviados = []; sockets.push(this); }
    send(s) { this.enviados.push(JSON.parse(s)); }
    close() { this.readyState = 3; }
  };
  g.window = g;
  g.self = g;
  vm.createContext(g);
  g.JOGO = {};
  for (const arq of ['js/core/brasa.js', 'js/core/sessao.js', 'js/core/gm.js', 'js/core/rede.js']) {
    vm.runInContext(fs.readFileSync(path.join(raiz, arq), 'utf8'), g, { filename: arq });
  }
  return { g, J: g.JOGO, sockets };
}
const m = mundo();
const R = m.J.Rede;
const eventos = [];
R.aoEvento = (ev) => eventos.push(ev);
R.entrar({ id: 'h-eu', nome: 'Eu', moldura: 'arena', arena: { n: 9, vigente: true } });
const ws = m.sockets[m.sockets.length - 1];
const marca = /[?&]n=([0-9a-z]+)/.exec(ws.url)[1];
ws.readyState = 1;
ws.onopen();
ws.onmessage({ data: JSON.stringify({ t: 'rele', v: 1, ident: true, n: marca, cx: 'abcd1234' }) });
const chega = (o) => ws.onmessage({ data: JSON.stringify(o) });
const par = (id) => R.pares().filter((p) => p.id === id)[0];
const oi = (de, extra, resumo) => Object.assign({ t: 'oi', de: de, nome: 'Fulano', titulo: '', classe: 'sumo', x: 1, z: 1, sala: null, v: 2,
  resumo: Object.assign({ classes: { sumo: 22 }, total: 22, brasa: 1000, partidas: 0 }, resumo || {}) }, extra || {});

check('a limpeza do `arena`: {n, vigente} inteiros; torto, vazio ou zerado vira null',
      JSON.stringify(R._arenaDe({ n: 3, vigente: true })) === '{"n":3,"vigente":true}' &&
      JSON.stringify(R._arenaDe({ n: '2.9' })) === '{"n":2,"vigente":false}' &&
      R._arenaDe({ n: 0, vigente: false }) === null && R._arenaDe('3') === null && R._arenaDe(null) === null &&
      R._arenaDe({ n: -4 }) === null && R._arenaDe({ n: 99999, vigente: false }).n === 999);
check('a moldura "arena" viaja; id desconhecida segue virando "auto"', R._molduraDe('arena') === 'arena' && R._molduraDe('campeao3') === 'auto');
const meuOi = ws.enviados.filter((e) => e.t === 'oi' || e.nome === 'Eu')[0] || {};
check('o MEU cartão leva a moldura escolhida e NÃO leva `arena` (quem carimba é o Relé)',
      ws.enviados.some((e) => e.moldura === 'arena') && !ws.enviados.some((e) => 'arena' in e), JSON.stringify(meuOi));

chega(oi('jcamp001', { nome: 'Davi', moldura: 'arena', arena: { n: 3, vigente: true } }));
let p = par('jcamp001');
check('o campeão carimbado: o par chega com a moldura e as conquistas', !!p && p.moldura === 'arena' && p.arena && p.arena.n === 3 && p.arena.vigente === true, JSON.stringify(p));
const ent = eventos.filter((e) => e.tipo === 'entrou' && e.id === 'jcamp001')[0];
check('… e o evento de entrada (o que o hub3d desenha) traz o `arena`', !!ent && ent.arena && ent.arena.n === 3 && ent.arena.vigente === true);

eventos.length = 0;
chega(oi('jcamp001', { nome: 'Davi', moldura: 'arena', arena: { n: 3, vigente: true }, t: 'eco' }));
check('o mesmo cartão de novo não avisa nada', eventos.filter((e) => e.tipo === 'mudouVisual').length === 0);
chega(oi('jcamp001', { nome: 'Davi', moldura: 'arena', arena: { n: 4, vigente: true }, t: 'eco' }));
const mv = eventos.filter((e) => e.tipo === 'mudouVisual' && e.id === 'jcamp001');
check('ganhou outro torneio sem sair do lugar: um `mudouVisual` com o `arena` novo', mv.length === 1 && mv[0].arena.n === 4);
eventos.length = 0;
chega(oi('jcamp001', { nome: 'Davi', moldura: 'arena', arena: { n: 4, vigente: false }, t: 'eco' }));
check('deixou de ser o vigente: a plaquinha repinta (sem o louro)', eventos.filter((e) => e.tipo === 'mudouVisual' && e.arena.vigente === false).length === 1);

chega(oi('jcomum01', { nome: 'Bia' }));
check('quem nunca ganhou chega sem `arena`', par('jcomum01').arena === null);

chega(oi('jguild01', { nome: 'Caio' }, { guilda: { nome: 'Os Fundos', emblema: 'shield|1|2|3', campea: true, titulos: 9 } }));
p = par('jguild01');
check('a guilda campeã carimbada dentro de `resumo.guilda`: campeã, e as marcas param em 5',
      p.resumo.guilda.campea === true && p.resumo.guilda.titulos === 5 && p.resumo.guilda.nome === 'Os Fundos', JSON.stringify(p.resumo.guilda));
chega(oi('jguild02', { nome: 'Dudu', guilda: { id: 4, campea: false, titulos: 2 } }, { guilda: { nome: 'Os Fundos', emblema: 'shield|1|2|3' } }));
p = par('jguild02');
check('… ou num `guilda` do próprio envelope: a tela lê de `resumo.guilda` do mesmo jeito',
      p.resumo.guilda.campea === false && p.resumo.guilda.titulos === 2, JSON.stringify(p.resumo.guilda));
chega(oi('jguild03', { nome: 'Edu', guilda: { campea: true, titulos: 1 } }, {}));
check('sem guilda no resumo não nasce guilda nenhuma', !par('jguild03').resumo.guilda);
R.sair();

console.log('RESUMO: ' + (falhas ? 'FALHOU — ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
