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
 *   · a vitrine fechada não tem ofertas nem Pacote de Boas-Vindas: a chamada da praça não tem o que mostrar. */
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

function janela(cofre) {
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

  console.log((falhas ? 'FALHOU' : 'tudo passou') + ' (' + (total - falhas) + ' de ' + total + ')');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHOU · a prova quebrou — ' + (e && e.stack || e)); process.exit(1); });
