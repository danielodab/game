#!/usr/bin/env node
'use strict';
/* A LOJA FECHADA no JOGO (25/10, js/core/loja.js) — sem navegador.
 *
 *     node tests/loja_fechada.js
 *
 * O servidor com SOTERRA_LOJA=0 manda a vitrine com `fechada: true` (tests/loja_fechada_api.py). Aqui o js/core/loja.js
 * de verdade, numa janela de mentira, com a rede trocada pelo L._semRede:
 *   · a vitrine fechada liga L.fechada(), põe `loja-fechada` no <html> e guarda a resposta no aparelho;
 *   · a próxima abertura já nasce com a classe (sem o botão Loja piscar), antes de qualquer resposta;
 *   · a vitrine aberta desfaz tudo: sem classe e sem a marca guardada;
 *   · a vitrine fechada não tem ofertas nem Pacote de Boas-Vindas: a chamada da praça não tem o que mostrar;
 *   · NO IPHONE (25/10, docs/APP_STORE.md §8.2) a loja fica fechada SEMPRE, até a compra da Apple: com a vitrine
 *     aberta, sem resposta ou sem rede — e sem escrever a chave, que é a resposta do servidor. Com o JOGO.Mobile do
 *     Android (falta sempre falso) tudo segue como acima. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + JSON.stringify(extra) : ''));
}
const FONTE = fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'loja.js'), 'utf8');

function janela(cofre, mobile) {
  const classes = new Set();
  const eventos = [];
  const ctx = {
    console, Promise, JSON, Math, Number, String, Object, Array, Date, setTimeout, clearTimeout,
    setInterval() { return 1; }, clearInterval() {},
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(cofre, k) ? cofre[k] : null),
      setItem: (k, v) => { cofre[k] = String(v); },
      removeItem: (k) => { delete cofre[k]; }
    },
    document: {
      hidden: false,
      documentElement: { classList: {
        add: (n) => classes.add(n), contains: (n) => classes.has(n),
        toggle: (n, on) => { if (on) classes.add(n); else classes.delete(n); }
      } },
      addEventListener() {}
    },
    addEventListener() {},
    dispatchEvent(ev) { eventos.push(ev && ev.type); return true; },
    CustomEvent: function (tipo, op) { this.type = tipo; this.detail = op && op.detail; }
  };
  if (mobile) ctx.JOGO = { Mobile: mobile };      // o JOGO.Mobile.falta do js/mobile.js (carregado antes, no index.html)
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(FONTE, ctx);
  ctx._classes = classes; ctx._eventos = eventos;
  return ctx;
}
const VITRINE = { ok: true, agora: 1792900000, auras: { tem: [], escolhida: null, todas: [] },
                  molduras: { tem: [], escolhida: null, todas: [] }, barras: { saldo: 0 } };
function resposta(fechada) {
  return Object.assign({}, VITRINE, fechada
    ? { fechada: true, ofertas: { semana: 1, desconto: 0, inicio: 0, fim: 1792999999, itens: [] }, boasVindas: { disponivel: false } }
    : { ofertas: { semana: 1, desconto: 25, inicio: 0, fim: 1792999999, itens: [{ nome: 'Bônus de XP — 1 dia', preco: 30, precoCheio: 40 }] },
        boasVindas: { disponivel: true, preco: 300, precoCheio: 600 } });
}

(async function () {
  const cofre = {};
  let w = janela(cofre);
  let L = w.JOGO.Loja;
  check('sem resposta nenhuma ainda, a loja não está fechada (o jogo de sempre)', L.fechada() === false && !w._classes.has('loja-fechada'));

  L._semRede = () => resposta(true);
  let v = await L.vitrine(true);
  check('a vitrine FECHADA liga L.fechada()', !!v && v.fechada === true && L.fechada() === true);
  check('… põe a classe loja-fechada no <html> (o css esconde o botão Loja e a compra das Configurações)', w._classes.has('loja-fechada'));
  check('… e guarda no aparelho, na chave que o site também lê', cofre[L.CHAVE_FECHADA] === '1' && L.CHAVE_FECHADA === 'soterra-loja-fechada');
  check('a vitrine fechada não tem oferta nem Pacote de Boas-Vindas (a chamada da praça fica sem o que mostrar)',
        v.ofertas.itens.length === 0 && v.boasVindas.disponivel === false);
  check('o aviso soterra:vitrine segue saindo (a praça repinta)', w._eventos.indexOf('soterra:vitrine') >= 0);

  w = janela(cofre);
  L = w.JOGO.Loja;
  check('a PRÓXIMA abertura já nasce fechada, antes de qualquer resposta (o botão não pisca)',
        w._classes.has('loja-fechada') && L.fechada() === true);

  L._semRede = () => resposta(false);
  v = await L.vitrine(true);
  check('a vitrine ABERTA desliga: sem classe, sem marca guardada, L.fechada() falso',
        L.fechada() === false && !w._classes.has('loja-fechada') && !(L.CHAVE_FECHADA in cofre) && v.fechada === false);
  check('… e as ofertas voltam', v.ofertas.itens.length === 1 && v.boasVindas.disponivel === true);

  L._semRede = () => ({ ok: false, status: 0 });
  v = await L.vitrine(true);
  check('sem rede, vale a última resposta (aberta)', L.fechada() === false);

  // ---- 25/10: O IPHONE — a loja fechada até a compra da Apple, seja qual for o servidor
  const IPHONE = { falta: (r) => r === 'compra' || r === 'sair' || r === 'anuncio' };
  const ANDROID = { falta: () => false };
  let cofreI = {};
  w = janela(cofreI, IPHONE);
  L = w.JOGO.Loja;
  check('IPHONE: já nasce fechada, sem resposta nenhuma (o botão Loja nem aparece)',
        L.fechada() === true && w._classes.has('loja-fechada'));
  check('IPHONE: … sem escrever a chave do servidor no aparelho', !(L.CHAVE_FECHADA in cofreI));
  L._semRede = () => resposta(false);
  v = await L.vitrine(true);
  check('IPHONE: a vitrine ABERTA não abre a loja: L.fechada() segue verdadeiro e a classe fica',
        v.fechada === false && L.fechada() === true && w._classes.has('loja-fechada'));
  check('IPHONE: … e a chave segue sendo só a resposta do servidor (aberta: nada guardado)', !(L.CHAVE_FECHADA in cofreI));
  L._semRede = () => resposta(true);
  v = await L.vitrine(true);
  check('IPHONE: a vitrine fechada também fecha, e guarda a resposta como sempre',
        L.fechada() === true && w._classes.has('loja-fechada') && cofreI[L.CHAVE_FECHADA] === '1');

  // ---- 26/10: A COMPRA DA APPLE — a vitrine diz `apple`, e a loja do iPhone abre (o JOGO.Mobile de mentira lê e
  // grava a MESMA chave do js/mobile.js; a regra dele está provada em tests/app_casca.js)
  let cofreAp = {};
  const IPHONE_APPLE = {
    appleLigada(f) { if (f !== undefined) { if (f) cofreAp['soterra-apple-loja'] = '1'; else delete cofreAp['soterra-apple-loja']; }
                     return cofreAp['soterra-apple-loja'] === '1'; },
    falta(r) { return r === 'compra' ? !this.appleLigada() : (r === 'sair' || r === 'anuncio'); }
  };
  w = janela(cofreAp, IPHONE_APPLE);
  L = w.JOGO.Loja;
  check('IPHONE (26/10): sem resposta da Apple ainda, nasce fechada', L.fechada() === true && w._classes.has('loja-fechada'));
  L._semRede = () => Object.assign(resposta(false), { apple: true });
  await L.vitrine(true);
  check('IPHONE: a vitrine com `apple: true` abre a loja — a chave gravada e a classe tirada',
        L.fechada() === false && !w._classes.has('loja-fechada') && cofreAp['soterra-apple-loja'] === '1');
  w = janela(cofreAp, IPHONE_APPLE);
  check('IPHONE: a próxima abertura já nasce aberta (a chave ficou)', w.JOGO.Loja.fechada() === false && !w._classes.has('loja-fechada'));
  L = w.JOGO.Loja;
  L._semRede = () => Object.assign(resposta(false), { apple: false });
  await L.vitrine(true);
  check('IPHONE: a vitrine com `apple: false` fecha de novo', L.fechada() === true && w._classes.has('loja-fechada') &&
        !('soterra-apple-loja' in cofreAp));
  L._semRede = () => Object.assign(resposta(true), { apple: true });
  await L.vitrine(true);
  check('IPHONE: com a Apple ligada mas a loja FECHADA no servidor (SOTERRA_LOJA=0), fica fechada', L.fechada() === true &&
        w._classes.has('loja-fechada'));

  let cofreA = {};
  w = janela(cofreA, ANDROID);
  L = w.JOGO.Loja;
  check('ANDROID (com o JOGO.Mobile): nasce aberta, como sempre', L.fechada() === false && !w._classes.has('loja-fechada'));
  L._semRede = () => resposta(true);
  await L.vitrine(true);
  check('ANDROID: a vitrine fechada fecha', L.fechada() === true && w._classes.has('loja-fechada') && cofreA[L.CHAVE_FECHADA] === '1');
  L._semRede = () => resposta(false);
  await L.vitrine(true);
  check('ANDROID: a vitrine aberta abre de novo', L.fechada() === false && !w._classes.has('loja-fechada') && !(L.CHAVE_FECHADA in cofreA));

  console.log((falhas ? 'FALHOU' : 'tudo passou') + ' (' + (total - falhas) + ' de ' + total + ')');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHOU · a prova quebrou — ' + (e && e.stack || e)); process.exit(1); });
