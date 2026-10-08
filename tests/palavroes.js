#!/usr/bin/env node
'use strict';
/* PROVA DO FILTRO DE PALAVRÕES (08/10 à noite, js/core/palavroes.js).
 *
 *   node tests/palavroes.js
 *
 * A palavra feia vira símbolos do mesmo tamanho (%$@!#), por palavra inteira, sem acento, com o
 * disfarce desfeito (p0rra, m3rd@) e as letras repetidas juntas; a pontuação das pontas fica; a
 * palavra inocente que carrega uma feia no meio (computador) passa. */
const path = require('path');
require(path.join(__dirname, '..', 'js', 'core', 'palavroes.js'));
const P = globalThis.JOGO.Palavroes;

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (!ok && extra !== undefined ? ' — ' + extra : ''));
}

check('a palavra feia vira símbolos do mesmo tamanho', P.limpa('que merda') === 'que %$@!#', P.limpa('que merda'));
check('a pontuação das pontas fica', P.limpa('pôrra!') === '%$@!#!', P.limpa('pôrra!'));
check('sem acento e sem caixa', P.limpa('MERDA Pôrra') === '%$@!# %$@!#', P.limpa('MERDA Pôrra'));
check('o disfarce é desfeito: p0rra, m3rd@, c@r@lho', P.limpa('p0rra m3rd@ c@r@lho') === '%$@!# %$@!# %$@!#%$', P.limpa('p0rra m3rd@ c@r@lho'));
check('as letras repetidas se juntam: meeerda, caraaaalho', P.tem('meeerda') && P.tem('caraaaalho') && P.limpa('caraaaalho').length === 10);
check('a inocente que carrega uma feia no meio passa: computador, cuidado, pauta', !P.tem('computador') && !P.tem('cuidado') && !P.tem('pauta') && P.limpa('computador') === 'computador');
check('o plural simples cai (putas, merdas)', P.tem('putas') && P.tem('merdas'));
check('as emendadas e as siglas: fodase, vaitomarnocu, vsf, pqp', ['fodase', 'vaitomarnocu', 'vsf', 'pqp'].every(P.tem));
check('inglês e espanhol também', ['fuck', 'shit', 'bitch', 'mierda', 'joder', 'cabron'].every(P.tem));
check('a frase limpa sai igual (com os espaços e a pontuação)', P.limpa('oi, tudo bem?  bora descer!') === 'oi, tudo bem?  bora descer!');
check('vazio e nulo não quebram', P.limpa('') === '' && P.limpa(null) === '' && !P.tem(undefined));
check('a palavra da lista com letra dobrada também cai esticada: porrrra, arrrombado, asshooole', ['porrrra', 'arrrombado', 'asshooole'].every(P.tem));

console.log('\nRESUMO: ' + (falhas ? 'FALHOU ' + falhas + ' de ' + total : 'tudo passou (' + total + ')'));
process.exit(falhas ? 1 : 0);
