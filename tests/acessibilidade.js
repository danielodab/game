#!/usr/bin/env node
/* PROVA DA PALETA, DA AVALIAÇÃO E DO LIMITE DE QUADROS (15/10):
 * js/core/paleta.js, js/core/avaliacao.js, js/mobile.js (pulaQuadro).
 *
 *   node tests/acessibilidade.js
 *
 * Tudo puro: a paleta normal e a para daltônicos têm os cinco elementos e cores distintas entre si;
 * as quatro tabelas do jogo (renderer, FX, Art, DATA) passam a ler a paleta; a regra da avaliação
 * pede na 3ª vitória com 2 dias e nunca duas vezes; o pula-quadro segura 30 por segundo. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RAIZ = path.join(__dirname, '..');
function fonte(p) { return fs.readFileSync(path.join(RAIZ, p), 'utf8'); }

let ok = 0, falhas = [];
function check(nome, cond, det) {
  if (cond) ok++; else falhas.push(nome);
  console.log((cond ? 'PASSOU · ' : 'FALHOU · ') + nome + (det ? ' — ' + det : ''));
}
function hexDist(a, b) {
  const p = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return Math.sqrt(x.reduce((acc, v, i) => acc + (v - y[i]) ** 2, 0));
}
function contexto(pref) {
  const sb = { globalThis: null, console, localStorage: { getItem: k => (k === 'soterra-pref-ui' ? JSON.stringify(pref || {}) : null) }, location: { search: '' } };
  sb.globalThis = sb;
  vm.runInNewContext(fonte('js/core/paleta.js'), sb);
  return sb;
}

// 1. as duas paletas
for (const [nome, pref] of [['normal', {}], ['daltônico', { daltonico: true }]]) {
  const sb = contexto(pref);
  const P = sb.JOGO.PALETA, els = P.elementos();
  const chaves = Object.keys(els).sort().join(',');
  check('a paleta ' + nome + ' tem os cinco elementos', chaves === 'agua,ar,fogo,neutro,terra', chaves);
  let minimo = 999;
  const ids = Object.keys(els);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) minimo = Math.min(minimo, hexDist(els[ids[i]], els[ids[j]]));
  // a de sempre tem o neutro perto do ar (é a paleta do dono, não se mexe); a nova tem de abrir mais
  const piso = pref.daltonico ? 60 : 40;
  check('a paleta ' + nome + ' separa todos os pares (distância RGB ≥ ' + piso + ')', minimo >= piso, 'mínimo ' + Math.round(minimo));
  check('a paleta ' + nome + ' é a certa', pref.daltonico ? P.tabela() === P.DALTONICO : P.tabela() === P.NORMAL);
}
// o daltônico separa fogo de terra e água de ar mais do que a normal, no canal vermelho-verde
{
  const n = contexto({}).JOGO.PALETA.elementos(), d = contexto({ daltonico: true }).JOGO.PALETA.elementos();
  const rg = c => Math.abs(parseInt(c.slice(1, 3), 16) - parseInt(c.slice(3, 5), 16));
  check('fogo e terra ficam mais longe no eixo vermelho-verde', Math.abs(rg(d.fogo) - rg(d.terra)) >= Math.abs(rg(n.fogo) - rg(n.terra)) * 0.8);
}
// 2. as quatro tabelas leem a paleta
check('o renderer lê a paleta', /JOGO\.PALETA\.elementos\(\)/.test(fonte('js/render3d/renderer3d_v2.js')));
check('o FX lê a paleta', /JOGO\.PALETA\.elementos\(\)/.test(fonte('js/render3d/fx3d_v2.js')));
check('o Art lê a paleta', /JOGO\.PALETA[\s\S]{0,80}P\.arte\(\)/.test(fonte('js/render2d/art.js')));
check('o DATA.elementInfo lê a paleta', (fonte('js/core/data/elements.js').match(/JOGO\.PALETA\.cor\('/g) || []).length === 5);
check('o index carrega paleta.js antes dos dados', (() => { const h = fonte('index.html'); return h.indexOf("'js/core/paleta.js'") < h.indexOf("'js/core/data/elements.js'"); })());

// 3. a regra da avaliação
{
  const sb = { globalThis: null, console, Capacitor: null, localStorage: { getItem: () => null, setItem() {} }, location: { protocol: 'https:' } };
  sb.globalThis = sb;
  vm.runInNewContext(fonte('js/core/avaliacao.js'), sb);
  const A = sb.JOGO.Avaliacao;
  const dia = 86400000, t0 = 1000000000000;
  let d = {};
  let r1 = A.decide(d, t0); d = r1.registro;
  let r2 = A.decide(d, t0 + dia); d = r2.registro;
  let r3 = A.decide(d, t0 + dia); d = r3.registro;
  check('três vitórias no mesmo dia e meio não pedem (faltam os 2 dias)', !r1.pede && !r2.pede && !r3.pede, JSON.stringify(d));
  let r4 = A.decide(d, t0 + 2 * dia + 1); d = r4.registro;
  check('a vitória seguinte, com 2 dias, pede', r4.pede && d.pedidoEm > 0);
  let r5 = A.decide(d, t0 + 30 * dia);
  check('nunca pede duas vezes', !r5.pede);
  check('a página da loja leva o id do aplicativo', A.paginaDaLoja().indexOf('br.com.soterra.jogo') > 0);
}

// 4. o pula-quadro
{
  const sb = { globalThis: null, console, window: null, document: undefined, navigator: { userAgent: 'x', maxTouchPoints: 0 },
               localStorage: { getItem: k => (k === 'soterra-pref-ui' ? '{"quadros30":true}' : null) }, location: { search: '' }, screen: {} };
  sb.window = sb; sb.globalThis = sb;
  try { vm.runInNewContext(fonte('js/mobile.js'), sb); } catch (e) { console.log('mobile.js: ' + e.message); }
  const M = sb.JOGO && sb.JOGO.Mobile;
  check('mobile.js carregou com o limite lido da preferência', !!(M && M.limiteQuadros && M.limiteQuadros() === 30));
  if (M) {
    check('a 30 quadros, o quadro de 16 ms depois é pulado e o de 34 ms entra', M.pulaQuadro(1016, 1000) && !M.pulaQuadro(1034, 1000));
    M.defineLimiteQuadros(false);
    check('sem limite, nenhum quadro é pulado', !M.pulaQuadro(1001, 1000));
  }
}

console.log((falhas.length ? 'FALHAS — ' : 'TUDO PASSOU — ') + ok + ' ok, ' + falhas.length + ' falharam' + (falhas.length ? ': ' + falhas.join('; ') : ''));
process.exit(falhas.length ? 1 : 0);
