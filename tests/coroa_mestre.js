#!/usr/bin/env node
'use strict';
/* PROVA DA COROA DO MESTRE (05/10, refeita em 08/10 à noite) — js/core/brasa.js, gm.js e rede.js num
 * mundo de mentira do Node.
 *
 *   node tests/coroa_mestre.js
 *
 * O dono (08/10): "fiz a arte da coroa do GM que deve ser liberada somente para ele.. e o brilho no
 * meio deve ser vermelho". Até 08/10 o Mestre escolhia no painel qual das dez coroas do ranking
 * carregava (GM.coroa/defineCoroa, `coroaMestre` no resumo). Agora a coroa dele é a DELE, fixa:
 * JOGO.Brasa.MESTRE, um degrau fora da escada. Cobra:
 *   1. a régua (Brasa.coroaDe): com `mestre === true` sai a coroa do Mestre (id 'gm', modelo 'coroa_gm',
 *      brilho inteiro e VERMELHO), que não está em TIERS — ninguém chega nela por pontos; a coroa
 *      escondida continua escondida por cima; o número da escolha antiga não é mais lido;
 *   2. quem é o Mestre (JOGO.GM.ativo): a conta carimbada gm; o seletor saiu (GM.coroa/defineCoroa não
 *      existem mais) e a marca `coroa` de um save antigo não veste ninguém;
 *   3. quem os outros veem (JOGO.Rede): o tier é o do hub3d (tierDoFantasma): coroaDe(..., perfil.mestre)
 *      — só o `mestre: true` que o relé carimba pendura a coroa; o `coroaMestre` forjado por conta comum
 *      segue caindo (o campo nem é lido mais, mas um cliente antigo não pode nem sujar o cartão); esconder
 *      a coroa ainda avisa `mudouCoroa`.
 * O carimbo do relé está em tests/rele_nomes_prova.py; a praça de verdade, em tests/foto_coroa_gm.html. */
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
  check('régua: sem a marca, 1000 pontos é a Coroa I (como sempre)', id(B.coroaDe(1000, 0, false, false)) === 'n1' && id(B.coroaDe(1000, 0, false, false, false)) === 'n1');
  const M = B.coroaDe(1000, 0, false, false, true);
  check('régua: com `mestre === true` sai a COROA DO MESTRE — id gm, modelo coroa_gm, marcada `mestre`',
        !!M && M === B.MESTRE && M.id === 'gm' && M.modelo === 'coroa_gm' && M.mestre === true && M.nivel === 'gm', JSON.stringify(M));
  check('régua: o brilho dela é inteiro (o da Coroa X) e VERMELHO (o dono: "o brilho no meio deve ser vermelho")',
        M.brilho === 1 && /^#ff[0-3][0-9a-f][0-3][0-9a-f]$/i.test(M.cor), M.cor);
  check('régua: ela é do tamanho da Coroa X (diâmetro 1.42) — imponente como a maior do ranking', M.tam === B.TIERS[9].tam);
  check('régua: a coroa do Mestre NÃO está na escada (TIERS) — ninguém chega nela por pontos',
        B.TIERS.every((t) => t.id !== 'gm' && t !== M) && B.TIERS.length === 10 && id(B.tierDe(99999, true)) === 'n10');
  check('régua: a coroa escondida continua escondida por cima da marca', B.coroaDe(1000, 0, false, true, true) === null);
  check('régua: o número da escolha antiga (05/10) não é mais lido — 7, 10 ou lixo caem na coroa dos pontos',
        [7, 10, 11, -1, 2.5, '7', 'mestre', null, NaN, {}, 1].every((x) => id(B.coroaDe(1000, 0, false, false, x)) === 'n1'));
  check('régua: a marca não mexe na conta dos pontos (tierDe segue o mesmo)', id(B.tierDe(1650, false)) === 'n7' && id(B.tierDe(1000, false)) === 'n1');
  check('régua: a conta comum com muitos pontos continua na escada, nunca na do Mestre', id(B.coroaDe(1850, 40, false, false, false)) === 'n9');
})();

// ------------------------------------------------------------------ 2. quem é o Mestre
(function () {
  const m = mundo(MESTRE);
  const G = m.J.GM;
  check('Mestre: a conta carimbada gm está ativa — é ela que a HUD pendura com a coroa do Mestre', G.ativo() === true);
  check('Mestre: o seletor de 05/10 saiu — GM.coroa e GM.defineCoroa não existem mais', G.coroa === undefined && G.defineCoroa === undefined);

  const c = mundo(COMUM, { ligado: true, pa: 12, pp: 8, spells: [], coroa: 10 });
  check('conta comum com a marca antiga forjada no save (coroa: 10): não é Mestre, e a marca não veste ninguém',
        c.J.GM.ativo() === false && c.J.GM.coroa === undefined);
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
    const t = B.coroaDe(p.resumo.brasa, p.resumo.partidas, false, p.resumo.coroaOculta === true, p.mestre === true);
    return t ? t.id : null;
  };
  const oi = (de, extra, resumo) => Object.assign({ t: 'oi', de: de, nome: 'Fulano', titulo: '', classe: 'sumo', x: 1, z: 1, sala: null, v: 2,
    resumo: Object.assign({ classes: { sumo: 3 }, total: 3, brasa: 1000, partidas: 0, coroaOculta: false }, resumo || {}) }, extra || {});

  chega(oi('jmestre1', { nome: 'GM', mestre: true }, {}));
  let p = par('jmestre1');
  check('o Mestre carimbado pelo relé: os outros o veem com a coroa do Mestre (gm), sem campo nenhum no resumo',
        !!p && p.mestre === true && tierVisto(p) === 'gm', JSON.stringify(p));

  // o `mestre` que chega pelo relé É o carimbo (o cliente não o manda: rele_ident.carimba joga fora o do
  // cliente e põe o seu só na conta gm — tests/rele_nomes_prova.py); quem vem sem ele é conta comum
  chega(oi('jfalso01', { nome: 'Esperto' }, {}));
  p = par('jfalso01');
  check('conta comum (sem o carimbo do relé): a coroa é a dos pontos dela, nunca a do Mestre',
        !!p && p.mestre === false && tierVisto(p) === 'n1', JSON.stringify(p));

  chega(oi('jfalso02', { nome: 'Esperto2' }, { coroaMestre: 10 }));
  p = par('jfalso02');
  check('o `coroaMestre` de um cliente antigo (05/10) forjado por conta comum: cai do cartão e a coroa é a dos pontos',
        !!p && p.mestre === false && !('coroaMestre' in p.resumo) && tierVisto(p) === 'n1', JSON.stringify(p));
  const ent = eventos.filter((e) => e.tipo === 'entrou' && e.id === 'jfalso02')[0];
  check('...e o evento de entrada (o que o hub3d desenha) também vem sem o campo', !!ent && !('coroaMestre' in ent.resumo));

  eventos.length = 0;
  chega(oi('jmestre1', { nome: 'GM', mestre: true, t: 'eco' }, { coroaOculta: true }));
  p = par('jmestre1');
  check('o Mestre esconde a coroa: um `mudouCoroa` (com a marca) e os outros param de vê-la',
        eventos.filter((e) => e.tipo === 'mudouCoroa' && e.id === 'jmestre1' && e.mestre === true).length === 1 && tierVisto(p) === null,
        JSON.stringify(eventos));

  eventos.length = 0;
  chega(oi('jmestre1', { nome: 'GM', mestre: true, t: 'eco' }, { coroaOculta: true }));
  check('o mesmo cartão de novo não avisa nada (não repinta em laço)', eventos.filter((e) => e.tipo === 'mudouCoroa').length === 0);

  chega(oi('jmestre1', { nome: 'GM', mestre: true, t: 'eco' }, {}));
  p = par('jmestre1');
  check('mostra de novo: `mudouCoroa` e a coroa do Mestre volta', eventos.filter((e) => e.tipo === 'mudouCoroa').length === 1 && tierVisto(p) === 'gm');

  eventos.length = 0;
  chega(oi('jcomum02', { nome: 'Bia' }, {}));
  chega(oi('jcomum02', { nome: 'Bia', t: 'eco' }, { coroaOculta: true }));
  check('de carona: quem esconde a coroa também avisa `mudouCoroa` (os outros param de vê-la na hora)',
        eventos.filter((e) => e.tipo === 'mudouCoroa' && e.id === 'jcomum02').length === 1 && tierVisto(par('jcomum02')) === null);
  R.sair();
})();

console.log('RESUMO: ' + (falhas ? 'FALHOU — ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
