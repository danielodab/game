#!/usr/bin/env node
'use strict';
/* PROVA DA COROA DO MESTRE (05/10) — js/core/brasa.js, gm.js e rede.js num mundo de mentira do Node.
 *
 *   node tests/coroa_mestre.js
 *
 * O dono: "preciso que no menu do mestre ele consiga liberar [...] o ranking da coroa também".
 * O Mestre escolhe no painel qual das dez coroas carrega acima da cabeça. É só a arte. Cobra:
 *   1. a régua (Brasa.coroaDe): a escolha 7 desenha a Coroa VII com os pontos que for; 0 e lixo
 *      voltam à de verdade; a coroa escondida continua escondida por cima da escolha;
 *   2. quem escolhe (JOGO.GM): só o Mestre grava e lê — a conta comum com a marca no save lê 0;
 *   3. quem os outros veem (JOGO.Rede): o `coroaMestre` do resumo só fica em quem o relé carimbou
 *      mestre:true; forjado por conta comum, cai e a coroa dela é a dos pontos; trocar a escolha
 *      avisa `mudouCoroa` (a plaquinha repinta sem refazer o corpo).
 * O tier dos outros é o do hub3d (tierDoFantasma): coroaDe(..., perfil.mestre ? resumo.coroaMestre : 0)
 * — a mesma conta que `tierVisto` faz aqui, sobre o que a Rede entrega. O carimbo do relé está em
 * tests/rele_nomes_prova.py; o seletor do painel, em tests/painel_mestre.html. */
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

function mundo(sessao, cfgGm) {
  const local = new Map(), sockets = [];
  if (sessao) local.set('soterra-sessao', JSON.stringify(sessao));
  if (cfgGm) local.set('soterra-gm-v1', JSON.stringify(cfgGm));
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
  return { g, J: g.JOGO, local, sockets };
}
function ligaRede(m) {
  m.J.Rede.entrar({ id: 'h-eu', nome: 'Eu' });
  const ws = m.sockets[m.sockets.length - 1];
  const marca = /[?&]n=([0-9a-z]+)/.exec(ws.url)[1];
  ws.readyState = 1;
  ws.onopen();
  ws.onmessage({ data: JSON.stringify({ t: 'rele', v: 1, ident: true, n: marca, cx: 'abcd1234' }) });
  return ws;
}
const MESTRE = { token: 'a'.repeat(64), conta: { id: 1, nome: 'Oda', gm: true } };
const COMUM = { token: 'b'.repeat(64), conta: { id: 7, nome: 'Ana', gm: false } };

// ------------------------------------------------------------------ 1. a régua
(function () {
  const B = mundo(null).J.Brasa;
  const id = (t) => (t ? t.id : null);
  check('régua: sem escolha, 1000 pontos é a Coroa I (como sempre)', id(B.coroaDe(1000, 0, false, false)) === 'n1' && id(B.coroaDe(1000, 0, false, false, 0)) === 'n1');
  check('régua: a escolha 7 desenha a Coroa VII com os pontos que for', id(B.coroaDe(1000, 0, false, false, 7)) === 'n7');
  check('régua: a escolha 10 desenha a Coroa X sem exigir o topo do placar', id(B.coroaDe(1000, 0, false, false, 10)) === 'n10');
  check('régua: a coroa escondida continua escondida por cima da escolha', B.coroaDe(1000, 0, false, true, 7) === null);
  check('régua: escolha fora de 1..10 ou que não é número inteiro volta à de verdade',
        [11, -1, 2.5, '7', true, null, NaN, {}].every((x) => id(B.coroaDe(1000, 0, false, false, x)) === 'n1'));
  check('régua: a escolha não mexe na conta dos pontos (tierDe segue o mesmo)', id(B.tierDe(1650, false)) === 'n7' && id(B.tierDe(1000, false)) === 'n1');
})();

// ------------------------------------------------------------------ 2. quem escolhe
(function () {
  const m = mundo(MESTRE);
  const G = m.J.GM;
  check('Mestre: nasce em "a de verdade" (0)', G.ativo() === true && G.coroa() === 0);
  check('Mestre: escolhe a Coroa VII e ela fica gravada neste navegador',
        G.defineCoroa(7) === true && G.coroa() === 7 && JSON.parse(m.local.get('soterra-gm-v1')).coroa === 7);
  check('Mestre: "a de verdade" volta ao normal', G.defineCoroa(0) === true && G.coroa() === 0);
  check('Mestre: valor fora da escada vira "a de verdade"', G.defineCoroa(42) === true && G.coroa() === 0);

  const c = mundo(COMUM, { ligado: true, pa: 12, pp: 8, spells: [], coroa: 10 });
  check('conta comum com a marca forjada no save: lê 0 e não grava',
        c.J.GM.ativo() === false && c.J.GM.coroa() === 0 && c.J.GM.defineCoroa(9) === false &&
        JSON.parse(c.local.get('soterra-gm-v1')).coroa === 10);
})();

// ------------------------------------------------------------------ 3. quem os outros veem
(function () {
  const m = mundo(COMUM);
  const R = m.J.Rede, B = m.J.Brasa;
  const eventos = [];
  R.aoEvento = (ev) => eventos.push(ev);
  const ws = ligaRede(m);
  const chega = (o) => ws.onmessage({ data: JSON.stringify(o) });
  const par = (id) => R.pares().filter((p) => p.id === id)[0];
  // a conta do hub3d (tierDoFantasma), sobre o que a Rede entrega
  const tierVisto = (p) => {
    const t = B.coroaDe(p.resumo.brasa, p.resumo.partidas, false, p.resumo.coroaOculta === true,
                        p.mestre === true ? p.resumo.coroaMestre : 0);
    return t ? t.id : null;
  };
  const oi = (de, extra, resumo) => Object.assign({ t: 'oi', de: de, nome: 'Fulano', titulo: '', classe: 'sumo', x: 1, z: 1, sala: null, v: 2,
    resumo: Object.assign({ classes: { sumo: 3 }, total: 3, brasa: 1000, partidas: 0, coroaOculta: false }, resumo || {}) }, extra || {});

  chega(oi('jmestre1', { nome: 'GM', mestre: true }, { coroaMestre: 7 }));
  let p = par('jmestre1');
  check('o Mestre carimbado pelo relé com a Coroa VII: os outros o veem de Coroa VII',
        !!p && p.mestre === true && p.resumo.coroaMestre === 7 && tierVisto(p) === 'n7', JSON.stringify(p));

  chega(oi('jfalso01', { nome: 'Esperto' }, { coroaMestre: 10 }));
  p = par('jfalso01');
  check('conta comum com o campo forjado (sem o carimbo): o campo cai e a coroa é a dos pontos dela',
        !!p && p.mestre === false && !('coroaMestre' in p.resumo) && tierVisto(p) === 'n1', JSON.stringify(p));
  const ent = eventos.filter((e) => e.tipo === 'entrou' && e.id === 'jfalso01')[0];
  check('...e o evento de entrada (o que o hub3d desenha) também vem sem o campo', !!ent && !('coroaMestre' in ent.resumo));

  eventos.length = 0;
  chega(oi('jmestre1', { nome: 'GM', mestre: true, t: 'eco' }, { coroaMestre: 3 }));
  let mud = eventos.filter((e) => e.tipo === 'mudouCoroa');
  p = par('jmestre1');
  check('o Mestre troca para a Coroa III: um `mudouCoroa` (com a marca) e o tier visto vira o III',
        mud.length === 1 && mud[0].id === 'jmestre1' && mud[0].mestre === true && mud[0].resumo.coroaMestre === 3 && tierVisto(p) === 'n3',
        JSON.stringify(mud));

  eventos.length = 0;
  chega(oi('jmestre1', { nome: 'GM', mestre: true, t: 'eco' }, { coroaMestre: 3 }));
  check('o mesmo cartão de novo não avisa nada (não repinta em laço)', eventos.filter((e) => e.tipo === 'mudouCoroa').length === 0);

  chega(oi('jmestre1', { nome: 'GM', mestre: true, t: 'eco' }, {}));
  p = par('jmestre1');
  check('"a de verdade": o campo some do cartão e o Mestre volta à coroa dos pontos',
        eventos.filter((e) => e.tipo === 'mudouCoroa').length === 1 && tierVisto(p) === 'n1');

  chega(oi('jmestre1', { nome: 'GM', mestre: true, t: 'eco' }, { coroaMestre: 7, coroaOculta: true }));
  p = par('jmestre1');
  check('esconder a coroa ainda esconde, com escolha e tudo', tierVisto(p) === null);

  eventos.length = 0;
  chega(oi('jfalso01', { nome: 'Esperto', t: 'eco' }, { coroaMestre: 9 }));
  check('o forjado insistindo não gera nem o aviso de coroa', eventos.filter((e) => e.tipo === 'mudouCoroa').length === 0 &&
        tierVisto(par('jfalso01')) === 'n1');

  eventos.length = 0;
  chega(oi('jcomum02', { nome: 'Bia' }, {}));
  chega(oi('jcomum02', { nome: 'Bia', t: 'eco' }, { coroaOculta: true }));
  check('de carona: quem esconde a coroa também avisa `mudouCoroa` (os outros param de vê-la na hora)',
        eventos.filter((e) => e.tipo === 'mudouCoroa' && e.id === 'jcomum02').length === 1 && tierVisto(par('jcomum02')) === null);
  R.sair();
})();

console.log('RESUMO: ' + (falhas ? 'FALHOU — ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
