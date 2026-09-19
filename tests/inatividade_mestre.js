#!/usr/bin/env node
'use strict';
/* PROVA DO RELÓGIO DE INATIVIDADE (19/09) — js/core/sessao.js num mundo de mentira do Node.
 *
 *   node tests/inatividade_mestre.js
 *
 * O dono (12/09): "15 min de inatividade a conta desloga para não consumir servidor"; e
 * (19/09): "a conta admin não tem limite de 15 min no game". Cobra:
 *   1. a conta comum: 15 min sem tocar → sai da sessão, a Rede fecha e a HUD é avisada;
 *   2. a conta do Mestre (conta.gm): o mesmo tempo parado NÃO desliga nada — o vigia
 *      continua ligado (a mesma aba pode trocar de conta) e um toque zera o relógio;
 *   3. sem sessão nenhuma o relógio segue fechando a Rede (a aba esquecida custa relé). */
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

function mundo(sessao) {
  const local = new Map();
  if (sessao) local.set('soterra-sessao', JSON.stringify(sessao));
  const intervalos = [], ouvDoc = {}, pedidos = [];
  let agora = 1000000;
  const g = {
    console, Promise, JSON, Math, Object, Array, String, Number, RegExp, Error,
    Date: { now: () => agora },
    localStorage: { getItem: (k) => (local.has(k) ? local.get(k) : null), setItem: (k, v) => local.set(k, String(v)), removeItem: (k) => local.delete(k) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { protocol: 'https:', hostname: 'soterra.test', host: 'soterra.test', search: '', hash: '', href: 'https://soterra.test/index.html' },
    document: { hidden: false, addEventListener: (t, f) => { (ouvDoc[t] = ouvDoc[t] || []).push(f); } },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    setTimeout: (f) => { f(); return 1; }, clearTimeout() {},
    setInterval: (f, ms) => { intervalos.push({ f, ms, parado: false }); return intervalos.length; },
    clearInterval: (id) => { if (intervalos[id - 1]) intervalos[id - 1].parado = true; },
    fetch: (url, pedido) => {
      pedidos.push({ rota: url.replace(/^https?:\/\/[^/]+/, ''), metodo: pedido && pedido.method });
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) });
    }
  };
  g.window = g;
  g.self = g;
  vm.createContext(g);
  const toques = { rede: 0, hud: 0 };
  g.JOGO = { Rede: { sair() { toques.rede++; } } };
  vm.runInContext(fs.readFileSync(path.join(raiz, 'js/core/sessao.js'), 'utf8'), g, { filename: 'js/core/sessao.js' });
  const S = g.JOGO.Sessao;
  S.aoInativo = function () { toques.hud++; };
  return { S, local, intervalos, pedidos, toques, ouvDoc, avanca: (ms) => { agora += ms; }, toca: () => { (ouvDoc.pointerdown || []).forEach((f) => f()); } };
}

const QUINZE = 15 * 60 * 1000;

// ---- 1. a conta comum cai
(function () {
  const m = mundo({ token: 'tk-comum', conta: { id: 7, nome: 'Aventureiro', gm: false } });
  check('1: o vigia liga e agenda um tique de 30 s', m.S.vigiaInatividade() === true && m.intervalos.some((i) => i.ms === 30000));
  check('1: a conta comum não é isenta', m.S.isentoDeInatividade() === false);
  m.avanca(QUINZE - 1000);
  m.intervalos[0].f();
  check('1: a 14:59 nada acontece', m.S.ativa() && m.toques.rede === 0 && m.toques.hud === 0);
  m.avanca(2000);
  m.intervalos[0].f();
  check('1: aos 15 min a sessão sai, a Rede fecha e a HUD é avisada',
        !m.S.ativa() && m.toques.rede === 1 && m.toques.hud === 1 && m.intervalos[0].parado,
        JSON.stringify({ ativa: m.S.ativa(), toques: m.toques }));
})();

// ---- 2. o Mestre não cai
(function () {
  const m = mundo({ token: 'tk-mestre', conta: { id: 1, nome: 'Mestre', gm: true } });
  m.S.vigiaInatividade();
  check('2: a conta do Mestre é isenta do relógio', m.S.isentoDeInatividade() === true);
  m.avanca(QUINZE * 4);
  const desligou = m.S._tiqueInatividade();
  check('2: uma hora parado e o tique não desliga nada',
        desligou === false && m.S.ativa() && m.toques.rede === 0 && m.toques.hud === 0 && !m.intervalos[0].parado,
        JSON.stringify({ desligou, ativa: m.S.ativa(), toques: m.toques }));
  check('2: o relógio continua contando (o ocioso passa de 15 min)', m.S.ociosoMs() >= QUINZE);
  m.toca();
  check('2: um toque zera o relógio do Mestre também', m.S.ociosoMs() === 0);
  // a mesma aba troca para uma conta comum: o vigia, que ficou ligado, volta a valer
  m.local.set('soterra-sessao', JSON.stringify({ token: 'tk-outro', conta: { id: 9, nome: 'Outro', gm: false } }));
  m.avanca(QUINZE + 1);
  check('2: trocou para uma conta comum na mesma aba — o vigia (ainda ligado) desliga',
        m.S._tiqueInatividade() === true && !m.S.ativa() && m.toques.rede === 1);
})();

// ---- 3. sem sessão a Rede ainda fecha
(function () {
  const m = mundo(null);
  m.S.vigiaInatividade();
  check('3: sem sessão não há isenção', m.S.isentoDeInatividade() === false);
  m.avanca(QUINZE + 1);
  check('3: sem sessão o tique fecha a Rede e avisa a HUD', m.S._tiqueInatividade() === true && m.toques.rede === 1 && m.toques.hud === 1);
})();

console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
