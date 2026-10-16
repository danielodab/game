#!/usr/bin/env node
/* PROVA DO CARTÃO DE COMPARTILHAR (15/10): js/core/compartilhar.js, a parte pura.
 *
 *   node tests/compartilhar.js
 *
 * Um canvas de mentira anota o que o cartão desenha: o retrato entra centrado e enquadrado, o nome da
 * forma vai em serifa dourada, o rodapé leva o endereço do site, e sem retrato o cartão ainda sai. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const FONTE = fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'compartilhar.js'), 'utf8');
const sb = { globalThis: null, console, navigator: {}, document: undefined };
sb.globalThis = sb;
vm.runInNewContext(FONTE, sb);
const C = sb.JOGO.Compartilhar;

let ok = 0, falhas = [];
function check(nome, cond, det) { if (cond) ok++; else falhas.push(nome); console.log((cond ? 'PASSOU · ' : 'FALHOU · ') + nome + (det ? ' — ' + det : '')); }

function canvasDeMentira() {
  const chamadas = [];
  const g = new Proxy({ chamadas }, {
    get(t, k) {
      if (k === 'chamadas') return chamadas;
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return (s) => ({ width: s.length * 10 });
      return (...args) => { chamadas.push([k, args]); };
    },
    set() { return true; }
  });
  return { width: 0, height: 0, getContext: () => g, chamadas };
}
const retrato = { width: 400, height: 500 };
const c = C.cartao({ retrato, titulo: 'Rato Arcanista', sub: 'bruxo + invocador · fogo e água', linha: 'sala 3 da Estufa',
                     cor: '#ff8c3a', cor2: '#57c8ec', canvasFabrica: () => canvasDeMentira() });
check('o cartão é quadrado de ' + C.LADO, c.width === C.LADO && c.height === C.LADO);
const draws = c.chamadas.filter(x => x[0] === 'drawImage');
check('o retrato é desenhado uma vez', draws.length === 1);
if (draws.length) {
  const [, [img, x, y, w, h]] = draws[0];
  check('o retrato entra centrado e dentro do quadro', img === retrato && Math.abs((x + w / 2) - C.LADO / 2) < 1 && y > 0 && y + h < C.LADO * 0.8, `${x},${y} ${w}x${h}`);
}
const textos = c.chamadas.filter(x => x[0] === 'fillText').map(x => x[1][0]);
check('o título, a linha, o selo e o endereço estão no cartão',
      textos.includes('Rato Arcanista') && textos.includes('sala 3 da Estufa') && textos.includes('SOTERRA') && textos.includes('soterra.viidoo.io'), textos.join(' | '));
check('o título leva contorno escuro por baixo (strokeText antes do fillText)',
      c.chamadas.findIndex(x => x[0] === 'strokeText' && x[1][0] === 'Rato Arcanista') < c.chamadas.findIndex(x => x[0] === 'fillText' && x[1][0] === 'Rato Arcanista'));
const c2 = C.cartao({ titulo: 'Sala limpa', canvasFabrica: () => canvasDeMentira() });
check('sem retrato o cartão sai mesmo assim', !!c2 && c2.chamadas.filter(x => x[0] === 'drawImage').length === 0);
check('o rodapé pode ser trocado (o link de convite)', C.cartao({ rodape: 'soterra.viidoo.io/c/ABC123', canvasFabrica: () => canvasDeMentira() }).chamadas.some(x => x[0] === 'fillText' && x[1][0] === 'soterra.viidoo.io/c/ABC123'));
console.log((falhas.length ? 'FALHAS — ' : 'TUDO PASSOU — ') + ok + ' ok, ' + falhas.length + ' falharam' + (falhas.length ? ': ' + falhas.join('; ') : ''));
process.exit(falhas.length ? 1 : 0);
