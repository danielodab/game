#!/usr/bin/env node
'use strict';
/* A VELOCIDADE DA BATALHA (09/10, js/core/ritmo.js).
 *
 *   node tests/ritmo.js
 *
 * Três níveis por aparelho (normal ×1, rápida ×1,5, muito rápida ×2), guardados no armário; valor estranho
 * volta ao normal; o normal não ocupa o armário. */
const path = require('path');
const guardado = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(guardado, k) ? guardado[k] : null),
  setItem: (k, v) => { guardado[k] = String(v); },
  removeItem: (k) => { delete guardado[k]; }
};
require(path.join(__dirname, '..', 'js', 'core', 'ritmo.js'));
const R = globalThis.JOGO.Ritmo;
let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++; if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}
check('sem nada guardado o ritmo é normal, fator 1', R.nivel() === 'normal' && R.fator() === 1);
check('os três níveis na ordem: ×1, ×1,5, ×2', R.ORDEM.join() === 'normal,rapida,muito' && R.NIVEIS.rapida === 1.5 && R.NIVEIS.muito === 2);
check('definir "rapida" grava e vale na hora', R.define('rapida') === 1.5 && R.fator() === 1.5 && guardado[R.CHAVE] === 'rapida');
check('definir "muito" dá ×2', R.define('muito') === 2 && R.fator() === 2);
R._zera();
check('o que está no armário sobrevive a uma leitura nova', R.nivel() === 'muito' && R.fator() === 2);
check('um valor estranho volta ao normal (e sai do armário)', R.define('turbo') === 1 && R.fator() === 1 && !(R.CHAVE in guardado));
guardado[R.CHAVE] = 'lixo'; R._zera();
check('lixo no armário lê como normal', R.nivel() === 'normal' && R.fator() === 1);
check('os rótulos existem para os três', R.ORDEM.every((n) => typeof R.nome(n) === 'string' && R.nome(n).length > 3) && R.nome('x') === R.nome('normal'));
console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
