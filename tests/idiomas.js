#!/usr/bin/env node
'use strict';
/* PROVA DOS IDIOMAS (js/core/i18n.js, js/i18n/*) — 05/10.
 *
 *   node tests/idiomas.js
 *
 * A tradução é SÓ texto de exibição. Esta prova é quem garante isso:
 *  (a) em português o DATA sai igual, letra por letra, com ou sem o módulo;
 *  (b) em inglês e em espanhol TODO texto das tabelas tem tradução, com os
 *      mesmos números do português, e NADA que não é texto mudou (ids,
 *      números, estrutura, a família do monstro, o grau da forja);
 *  (c) I18n.t devolve o português quando não há tradução, e interpola;
 *  (d) o juiz não carrega dicionário nenhum, e uma sala jogada por um cliente
 *      em inglês é refeita por ele com o MESMO hash — o mesmo de um cliente em
 *      português;
 *  (e) a escolha do idioma: quem já joga fica em português, navegador virgem
 *      segue o aparelho, `?lang=` vale sem gravar, a escolha gravada manda. */
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const motor = require(path.join(RAIZ, 'servidor', 'juiz', 'motor.js'));
const { refaz, ehDoJogador } = require(path.join(RAIZ, 'servidor', 'juiz', 'sala.js'));

let total = 0, falhas = 0;
function check(nome, ok, extra) {
  total++;
  if (!ok) falhas++;
  console.log((ok ? 'PASSOU' : 'FALHOU') + ' · ' + nome + (extra !== undefined && !ok ? ' — ' + extra : ''));
}

const I18N = 'js/core/i18n.js';
const dic = (l) => ['js/i18n/dados_' + l + '.js', 'js/i18n/textos_' + l + '.js'];
/* Um mundo do CLIENTE: os dados e o motor, como o do juiz, mais o i18n e os
 * dicionários do idioma — na ordem do index.html não muda nada para a prova:
 * o que importa é o DATA estar trocado antes de a batalha nascer. */
function cliente(idioma, extra) {
  return motor.mundo([I18N].concat(idioma === 'pt' ? [] : dic(idioma), extra || []), (ctx) => {
    ctx.location = { search: idioma === 'pt' ? '' : '?lang=' + idioma };
  });
}
const foto = (D) => JSON.stringify(D);
const numeros = (s) => (String(s).match(/\d+(?:[.,]\d+)?/g) || []).sort().join(' ');

// ---- (a) português: nada muda
const cru = motor.mundo().JOGO.DATA;
const pt = cliente('pt').JOGO;
check('(a) em português o DATA é igual, letra por letra, ao do juiz', foto(pt.DATA) === foto(cru));
// os dicionários carregados com o idioma em 'pt' também não tocam em nada
const ptComDic = motor.mundo([I18N].concat(dic('en'), dic('es')), (ctx) => { ctx.location = { search: '' }; }).JOGO;
check('(a) dicionário registrado com o jogo em português não toca no DATA',
      ptComDic.I18n.idioma === 'pt' && foto(ptComDic.DATA) === foto(cru));

// ---- (b) inglês e espanhol: tudo traduzido, e só o texto mudou
const contagem = {};
['en', 'es'].forEach((l) => {
  const J = cliente(l).JOGO, I = J.I18n;
  check('(b) ' + l + ': o idioma em uso é ' + l + ' e os dados foram aplicados', I.idioma === l && I.aplicado && I.aplicado.trocados > 0);
  check('(b) ' + l + ': nenhum texto das tabelas ficou sem tradução', I.aplicado && I.aplicado.faltam === 0,
        I.aplicado && I.aplicado.faltam + ' sem tradução — node tools/i18n_falta.js --lista');
  contagem[l] = I.aplicado ? I.aplicado.trocados : 0;

  // o mesmo passeio nos dois mundos: os textos lado a lado
  const a = [], b = [];
  pt.I18n.percorre(pt.DATA, (t, reg, campo, texto) => a.push([t + ' · ' + reg + ' · ' + campo, texto]));
  I.percorre(J.DATA, (t, reg, campo, texto) => b.push([t + ' · ' + reg + ' · ' + campo, texto]));
  let torto = null, semNome = null, numTorto = null, iguais = 0;
  if (a.length !== b.length) torto = a.length + ' textos em pt, ' + b.length + ' em ' + l;
  for (let i = 0; i < a.length && !torto; i++) {
    if (a[i][0] !== b[i][0]) torto = a[i][0] + ' ≠ ' + b[i][0];
    else if (typeof b[i][1] !== 'string' || !b[i][1]) semNome = a[i][0];
    else if (!numTorto && numeros(a[i][1]) !== numeros(b[i][1])) numTorto = a[i][0] + ' [' + numeros(a[i][1]) + '] ≠ [' + numeros(b[i][1]) + ']';
    if (a[i][1] === b[i][1]) iguais++;
  }
  check('(b) ' + l + ': os mesmos registros e campos, na mesma ordem', !torto, torto);
  check('(b) ' + l + ': nenhum nome ou descrição vazio', !semNome, semNome);
  check('(b) ' + l + ': os números de cada texto são os do português', !numTorto, numTorto);
  check('(b) ' + l + ': a tradução não é o português repetido (menos de 1 em 5 textos iguais)', iguais < a.length / 5,
        iguais + ' de ' + a.length + ' iguais');

  // tudo o que NÃO é texto: apaga os textos dos dois lados e compara o resto
  const semTexto = (JJ) => {
    const c = JSON.parse(foto(JJ.DATA));
    JJ.I18n.percorre(c, (t, reg, campo, texto, dono) => { dono[campo] = ''; });
    return JSON.stringify(c);
  };
  check('(b) ' + l + ': fora os textos, o DATA é igual ao português (ids, números, estrutura)', semTexto(J) === semTexto(pt));
  const fam = (D) => Object.keys(D.monsters).map((k) => D.monsters[k].family).join('|') +
                     '#' + D.upgrade.tiers.map((t) => t.name).join('|');
  check('(b) ' + l + ': família de monstro e grau de forja seguem em português (são chave do 3D e do CSS)',
        fam(J.DATA) === fam(cru));
  // … e têm tradução pronta para a hora de mostrar
  const faltaExib = [];
  Object.keys(cru.monsters).forEach((k) => { const f = cru.monsters[k].family; if (f && I.t(f) === f && f !== 'Flora Voraz') faltaExib.push(f); });
  cru.upgrade.tiers.forEach((t) => { if (l === 'en' && I.t(t.name) === t.name) faltaExib.push(t.name); });
  check('(b) ' + l + ': família e grau têm tradução para a hora de mostrar (I18n.t)', faltaExib.length === 0, faltaExib.join(', '));
});

// ---- (c) I18n.t
(function () {
  const P = pt.I18n, E = cliente('en').JOGO.I18n;
  const semTrad = 'Um texto que ninguém traduziu ainda, com {n} coisas.';
  check('(c) em português, t() devolve o próprio texto', P.t('Configurações') === 'Configurações');
  check('(c) sem tradução, t() devolve o português (nunca chave crua, nunca vazio)',
        E.t(semTrad, { n: 3 }) === 'Um texto que ninguém traduziu ainda, com 3 coisas.' && E.t('') === '' && E.t(null) === '');
  check('(c) com tradução, t() devolve a do idioma', E.t('Configurações') === 'Settings', E.t('Configurações'));
  check('(c) {variável} é trocada na tradução, e a que não veio fica à vista',
        E.t(' · versão {v}', { v: '9' }) === ' · version 9' && P.t('{a} e {b}', { a: 1 }) === '1 e {b}');
  check('(c) plural simples: n() escolhe a forma pelo número', P.n(1, '{n} sala', '{n} salas') === '1 sala' && P.n(4, '{n} sala', '{n} salas') === '4 salas');
})();

// ---- (d) o juiz
check('(d) o juiz não carrega o i18n nem dicionário: as listas dele só têm dados e combate',
      motor.DADOS.concat(motor.COMBATE).every((f) => f.indexOf('i18n') < 0));
function joga(J, dungeonId, roomIndex, party, semente) {
  const E = J.Engine;
  const st = E.createBattle(dungeonId, roomIndex, party, { seed: semente, dificuldade: 'normal', escolhePosicao: false });
  E.events.length = 0;
  const lances = [];
  let voltas = 0;
  while (st.phase === 'playing' && voltas++ < 4000) {
    const u = E.activeUnit(st);
    if (!u) break;
    const plano = J.AI.planTurn(st, u.uid) || [];
    const meu = ehDoJogador(st, u);
    let acabou = false;
    for (const a of (plano.length ? plano : [{ action: 'end' }])) {
      if (st.phase !== 'playing') break;
      if (a.action === 'move') { const ok = !!E.move(st, u.uid, a.x, a.y); if (meu) lances.push({ a: 'm', u: u.uid, x: a.x, y: a.y, ok }); }
      else if (a.action === 'cast') { const ok = !!E.cast(st, u.uid, a.spellId, a.x, a.y); if (meu) lances.push({ a: 'c', u: u.uid, s: a.spellId, x: a.x, y: a.y, ok }); }
      else if (a.action === 'end') { E.endTurn(st); if (meu) lances.push({ a: 'e', ok: true }); acabou = true; break; }
      E.events.length = 0;
    }
    if (!acabou && st.phase === 'playing') { E.endTurn(st); if (meu) lances.push({ a: 'e', ok: true }); }
    E.events.length = 0;
  }
  return { lances, fase: st.phase, hash: E.hash(st), nomes: st.units.map((x) => x.name).join('|') };
}
(function () {
  const classes = Object.keys(cru.classes).filter((c) => c !== 'gm');
  const casos = cru.dungeons.slice(0, 3).map((d, i) => ({
    dungeonId: d.id, roomIndex: i % d.rooms.length, semente: 4200 + i * 11,
    party: [0, 1].map((k) => ({ heroId: classes[(i + k) % classes.length], classId: classes[(i + k) % classes.length], element: 'neutro', level: 30 }))
  }));
  let iguais = 0, juizOk = 0, nomesMudaram = 0, dif = null;
  casos.forEach((cs) => {
    const p = joga(cliente('pt').JOGO, cs.dungeonId, cs.roomIndex, cs.party, cs.semente);
    const e = joga(cliente('en').JOGO, cs.dungeonId, cs.roomIndex, cs.party, cs.semente);
    if (p.hash === e.hash && p.fase === e.fase && JSON.stringify(p.lances) === JSON.stringify(e.lances)) iguais++;
    else if (!dif) dif = cs.dungeonId + ' pt ' + p.hash + ' en ' + e.hash;
    if (p.nomes !== e.nomes) nomesMudaram++;
    let r = null;
    try {
      r = refaz({ dungeonId: cs.dungeonId, roomIndex: cs.roomIndex, dificuldade: 'normal', semente: cs.semente,
                  party: cs.party, escolhePosicao: false, lances: e.lances, hashFinal: e.hash });
    } catch (err) { r = { erro: err.message }; }
    if (r && r.ok && r.hash === e.hash && r.fase === e.fase) juizOk++;
    else if (!dif) dif = cs.dungeonId + ' juiz ' + JSON.stringify(r).slice(0, 200);
  });
  check('(d) ' + casos.length + ' salas: o cliente em inglês joga os MESMOS lances e chega ao MESMO hash do cliente em português', iguais === casos.length, dif);
  check('(d) o juiz refaz as salas do cliente em inglês e chega ao mesmo fim e hash', juizOk === casos.length, dif);
  check('(d) e a prova não é vazia: os nomes das unidades mudaram de idioma na batalha', nomesMudaram === casos.length);
  check('(d) VERSAO_REGRAS segue 7', cliente('en').JOGO.Engine.VERSAO_REGRAS === 7);
})();

// ---- (e) a escolha do idioma
function decide(chaves, lingua, busca) {
  const m = new Map(Object.entries(chaves || {}));
  const ctx = {
    localStorage: { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); },
                    key: (i) => Array.from(m.keys())[i] || null, get length() { return m.size; } },
    navigator: { language: lingua }, location: { search: busca || '' }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, I18N), 'utf8'), ctx);
  return { idioma: ctx.JOGO.I18n.idioma, gravado: m.get('soterra-idioma') || null, I: ctx.JOGO.I18n };
}
(function () {
  let r = decide({ 'soterra-save-v2': '{}' }, 'en-US');
  check('(e) quem já tem save neste navegador segue em português, mesmo com o aparelho em inglês', r.idioma === 'pt' && r.gravado === 'pt');
  r = decide({ 'soterra-sessao': '{}', 'soterra-boot': 'x' }, 'es-MX');
  check('(e) quem já tem conta (sessão) neste navegador também', r.idioma === 'pt');
  r = decide({ 'soterra-boot': 'x', 'soterra-som': '1' }, 'en-GB');
  check('(e) navegador virgem em inglês abre em inglês, e a decisão fica gravada', r.idioma === 'en' && r.gravado === 'en');
  check('(e) navegador virgem: es-AR → es, pt-PT → pt, fr-FR → en, sem resposta → pt',
        decide({}, 'es-AR').idioma === 'es' && decide({}, 'pt-PT').idioma === 'pt' && decide({}, 'fr-FR').idioma === 'en' &&
        decide({}, '').idioma === 'pt');
  r = decide({ 'soterra-idioma': 'en', 'soterra-save-v2': '{}' }, 'pt-BR');
  check('(e) a escolha gravada manda mais que o save e que o aparelho', r.idioma === 'en');
  r = decide({ 'soterra-save-v2': '{}' }, 'pt-BR', '?conta=2&lang=es');
  check('(e) ?lang=es vale para aquela abertura e NÃO grava', r.idioma === 'es' && r.gravado === null);
  r = decide({ 'soterra-idioma': 'xx' }, 'pt-BR', '?lang=zz');
  check('(e) idioma que não existe (gravado ou na URL) cai no caminho normal', r.idioma === 'pt');
  r = decide({}, 'pt-BR');
  check('(e) escolhe() grava o idioma e recusa o que não existe', r.I.escolhe('es') === true && r.I.escolhe('de') === false &&
        decide({ 'soterra-idioma': 'es' }, 'pt-BR').idioma === 'es');
})();

console.log('\n' + (total - falhas) + ' de ' + total + ' passaram' +
  ' · textos de dados traduzidos: en ' + contagem.en + ', es ' + contagem.es);
process.exit(falhas ? 1 : 0);
