#!/usr/bin/env node
'use strict';
/* PROVA DO BOTÃO DE TELA CHEIA NO APLICATIVO (06/10): js/ui/tela_cheia.js.
 *
 *   node tests/tela_cheia_app.js
 *
 * O dono: "no app não precisa ter o botão de tela cheia igual tem no chrome de pc e celular". A prova roda
 * o arquivo de verdade numa janela de mentira e olha o que ele pendura no <body>:
 *   · NA WEB (computador e navegador do celular) o botão nasce e o canto é reservado, como sempre;
 *   · NO APLICATIVO (window.Capacitor nativo, ou `?app=1`) não há botão nem canto reservado;
 *   · as Configurações só mostram a chave "Tela cheia" fora do aplicativo.
 * O botão por dentro (o toque, o ✕, o que ele não tapa) é da tests/tela_cheia.html. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (extra !== undefined && !ok ? ' — ' + extra : ''));
}
const raiz = path.join(__dirname, '..');
const FONTE = fs.readFileSync(path.join(raiz, 'js', 'ui', 'tela_cheia.js'), 'utf8');
const HUD = fs.readFileSync(path.join(raiz, 'js', 'ui', 'hud.js'), 'utf8');

/* op: { busca, capacitor, mobile: true|false (o JOGO.Mobile.app() já carregado) } */
function janela(op) {
  op = op || {};
  const classes = new Set(), filhos = [];
  function no(tag) {
    return { tag, style: {}, innerHTML: '', classList: { add() {}, toggle() {}, contains: () => false },
             setAttribute() {}, addEventListener() {} };
  }
  const ctx = {
    console, setTimeout() {}, Event: function () {},
    location: { search: op.busca || '' }, navigator: {}, matchMedia: () => ({ matches: false }),
    addEventListener() {}, dispatchEvent() {},
    document: {
      fullscreenEnabled: true, fullscreenElement: null,
      documentElement: { requestFullscreen() {}, classList: { add: (c) => classes.add(c), toggle(c, v) { if (v) classes.add(c); else classes.delete(c); } } },
      body: { appendChild(f) { filhos.push(f); } },
      createElement: no, addEventListener() {}
    },
    JOGO: {}
  };
  if (op.capacitor) ctx.Capacitor = { isNativePlatform: () => true };
  if (op.mobile !== undefined) ctx.JOGO.Mobile = { app: () => op.mobile };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(FONTE, ctx);
  return { TC: ctx.JOGO.TelaCheia, botoes: filhos.filter((f) => f.className === 'tc-botao').length, canto: classes.has('tem-canto') };
}

let w = janela({});
check('web: o botão de tela cheia nasce e reserva o canto, como sempre', w.botoes === 1 && w.canto && w.TC.noApp() === false);
w = janela({ mobile: false });
check('web com o mobile.js carregado (o caso real): igual', w.botoes === 1 && w.canto);
w = janela({ capacitor: true });
check('aplicativo (casca de Android): não há botão e o canto não é reservado', w.botoes === 0 && !w.canto && w.TC.noApp() === true);
w = janela({ mobile: true });
check('aplicativo visto pelo JOGO.Mobile.app(): não há botão e o canto não é reservado', w.botoes === 0 && !w.canto);
w = janela({ busca: '?app=1' });
check('?app=1 (as provas no navegador): não há botão', w.botoes === 0 && !w.canto);
check('aplicativo: a API segue no lugar (quem pergunta TC.cheia() ou TC.suporta() não quebra)',
      typeof w.TC.cheia === 'function' && w.TC.cheia() === false && typeof w.TC.alterna === 'function');
check('Configurações: a chave "Tela cheia" só aparece fora do aplicativo',
      /TC\.suporta\(\) && !\(TC\.noApp && TC\.noApp\(\)\)\) \{/.test(HUD));

console.log('\n' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
