#!/usr/bin/env node
'use strict';
/* O QUE FALTA TRADUZIR (05/10, os idiomas — docs/IDIOMAS.md).
 *
 * O jogo nunca mostra chave crua: texto sem tradução aparece em português. É
 * seguro, e por isso mesmo é fácil esquecer um pedaço. Esta ferramenta é quem
 * cobra. Sem dependência nenhuma, só Node:
 *
 *   node tools/i18n_falta.js               o resumo dos dois idiomas (sai 1 se faltar algo)
 *   node tools/i18n_falta.js --lista       cada texto que falta, um por linha
 *   node tools/i18n_falta.js --candidatos  ESTIMATIVA do que ainda está em português puro
 *                                          no código (a fila da etapa 2), por arquivo
 *
 * O QUE ELA CONFERE
 *  1. DADOS: cada texto das tabelas de JOGO.I18n.TABELAS tem tradução em
 *     js/i18n/dados_<idioma>.js; e os NÚMEROS da tradução são os mesmos do
 *     português — a armadilha de verdade: alguém muda "Cura 30 PV" para 35 no
 *     arquivo de dados e a tradução segue dizendo 30. Tradução velha de registro
 *     que não existe mais também aparece (sobra).
 *  2. CÓDIGO: cada tr('…') / Tx('…') (o atalho fora do hud.js) / I18n.t('…') / I18n.n(q, '…', '…') com texto literal
 *     em js/ tem entrada em js/i18n/textos_<idioma>.js; e as variáveis {assim}
 *     da tradução são as mesmas da chave.
 *  3. SITE (etapa 3): cada frase dos site/*.html (colhida como o navegador a colhe:
 *     tools/i18n_site.js) e cada Tx('…') dos site/*.js tem entrada em
 *     site/i18n_<idioma>.js (ou i18n_juridico_<idioma>.js, os Termos e a
 *     Privacidade); as tags e as variáveis da tradução são as da chave.
 *  4. SERVIDOR (etapa 3): cada frase que o servidor manda ao jogador — as recusas
 *     de servidor/*.py e do juiz, e os nomes e descrições da loja, colhidos pela
 *     tools/erros_servidor.py (precisa de Python; sem ele, este item é pulado e a
 *     ferramenta avisa) — tem entrada em js/i18n/erros_<idioma>.js.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.resolve(__dirname, '..');
const DADOS = ['elements', 'classes', 'spells', 'progression', 'monsters', 'dungeons', 'arenas', 'campo_pvp',
  'fusions', 'pets', 'items', 'items_extra', 'items_selos', 'consumiveis', 'eco', 'santuario']
  .map((f) => 'js/core/data/' + f + '.js');
const IDIOMAS = ['en', 'es'];
const arg = (a) => process.argv.indexOf(a) >= 0;

function mundo(idioma) {
  const ctx = vm.createContext({ console });
  ctx.globalThis = ctx;
  const roda = (f) => vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f });
  DADOS.forEach(roda);
  roda('js/core/i18n.js');
  // registra SEM aplicar: aqui se quer o português de um lado e o dicionário do outro
  ctx.JOGO.I18n.usa('pt');
  ['js/i18n/dados_', 'js/i18n/textos_', 'js/i18n/erros_', 'site/i18n_', 'site/i18n_juridico_'].forEach((p) => {
    const f = p + idioma + '.js';
    if (fs.existsSync(path.join(RAIZ, f))) roda(f);
  });
  return ctx.JOGO;
}

// ---- etapa 3: o site e o servidor
const SITE = require('./i18n_site.js');
// as tags de uma frase; `semAtributos` para as do HTML (a chave leva <a>, não <a href>)
function tagsDe(s, semAtributos) {
  const t = String(s).match(/<[^<>]+>/g) || [];
  return (semAtributos ? t.filter((x) => x[1] !== '/') : t).sort().join(' ');
}
let SERVIDOR;
function doServidor() {
  if (SERVIDOR !== undefined) return SERVIDOR;
  SERVIDOR = null;
  for (const py of ['python', 'python3', 'py']) {
    try {
      const r = require('child_process').spawnSync(py, [path.join(__dirname, 'erros_servidor.py')],
        { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONUTF8: '1' }), maxBuffer: 16 * 1024 * 1024 });
      if (r.status === 0 && r.stdout) { SERVIDOR = JSON.parse(r.stdout); break; }
    } catch (e) { /* tenta o próximo nome */ }
  }
  return SERVIDOR;
}

// os números de um texto, na ordem em que aparecem não importa: importa o conjunto
function numeros(s) { return (String(s).match(/\d+(?:[.,]\d+)?/g) || []).sort().join(' '); }
function variaveis(s) { return (String(s).match(/\{[A-Za-z_]\w*\}/g) || []).sort().join(' '); }

function arquivosJs(dir, fora) {
  let out = [];
  for (const n of fs.readdirSync(path.join(RAIZ, dir))) {
    const rel = dir + '/' + n;
    if (fora.some((f) => rel.indexOf(f) === 0)) continue;
    const st = fs.statSync(path.join(RAIZ, rel));
    if (st.isDirectory()) out = out.concat(arquivosJs(rel, fora));
    else if (/\.js$/.test(n)) out.push(rel);
  }
  return out;
}

// o texto de um literal JS, como o motor o leria
function literal(bruto) {
  try { return vm.runInNewContext(bruto); } catch (e) { return null; }
}
const LIT = "'(?:[^'\\\\\\n]|\\\\.)*'|\"(?:[^\"\\\\\\n]|\\\\.)*\"";

function chavesDoCodigo() {
  const achadas = new Map();   // texto -> primeiro lugar
  const reT = new RegExp('(?:\\btr|\\bTx|I18n\\.t|\\bId\\.t)\\(\\s*(' + LIT + ')', 'g');
  const reN = new RegExp('(?:I18n\\.n|\\btrn)\\(\\s*[^,]+,\\s*(' + LIT + ')\\s*,\\s*(' + LIT + ')', 'g');
  for (const f of arquivosJs('js', ['js/i18n', 'js/core/data', 'js/core/i18n.js', 'js/assets_bundle.js'])) {
    // sem os comentários de bloco (o número das linhas não muda): exemplo de tr('…') em comentário não é texto do jogo
    const txt = fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    let m;
    const anota = (b, pos) => {
      const t = literal(b);
      if (typeof t === 'string' && t && !achadas.has(t)) achadas.set(t, f + ':' + txt.slice(0, pos).split('\n').length);
    };
    while ((m = reT.exec(txt))) anota(m[1], m.index);
    while ((m = reN.exec(txt))) { anota(m[1], m.index); anota(m[2], m.index); }
  }
  return achadas;
}

/* A FILA DA ETAPA 2, por estimativa: literais com cara de frase em português
 * que ainda não passam por tr()/I18n.t(). Não é exato (pega um ou outro
 * comentário-em-string e perde frase montada aos pedaços); serve para medir o
 * serviço e achar por onde começar. */
function candidatos() {
  const re = new RegExp('(\\b(?:tr|Tx)\\(\\s*|I18n\\.[tn]\\([^)\']*?)?(' + LIT + ')', 'g');
  const linhas = [];
  let total = 0;
  for (const f of arquivosJs('js', ['js/i18n', 'js/core/data', 'js/assets_bundle.js', 'js/versao.js',
    'js/render3d', 'js/render2d', 'js/render/', 'js/core/i18n.js', 'js/ui/debug.js', 'js/ui/painel_mestre.js', 'js/core/gm.js'])) {
    const txt = fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:'"\\])\/\/[^\n]*/g, (c, a) => a);
    let m, n = 0;
    while ((m = re.exec(txt))) {
      if (m[1]) continue;                         // já embrulhado
      const t = literal(m[2]);
      if (typeof t !== 'string') continue;
      const limpo = t.replace(/<[^>]+>/g, ' ').trim();
      if (limpo.length < 3) continue;
      const acento = /[áàâãéêíóôõúçÁÉÍÓÚÂÊÔÃÕÇ]/.test(limpo);
      const frase = /[A-Za-zÀ-ÿ]{2,}\s+[A-Za-zÀ-ÿ]{2,}/.test(limpo) && !/^[a-z0-9_\- .#:>\[\]=()*,+~"']+$/.test(limpo);
      const palavra = /^[A-ZÀ-Ý][a-zà-ÿ]{2,}[.!?…:]?$/.test(limpo);
      if (acento || frase || palavra) n++;
    }
    if (n) { linhas.push([n, f]); total += n; }
  }
  linhas.sort((a, b) => b[0] - a[0]);
  console.log('Literais com cara de texto em português ainda fora do tr() — ESTIMATIVA:');
  linhas.forEach((l) => console.log('  ' + String(l[0]).padStart(5) + '  ' + l[1]));
  console.log('  ' + String(total).padStart(5) + '  total (fora o painel do Mestre, o debug e o 3D, que não se traduzem)');
}

function main() {
  if (arg('--candidatos')) { candidatos(); return 0; }
  const lista = arg('--lista');
  const doCodigo = chavesDoCodigo();
  let ruim = 0;
  for (const l of IDIOMAS) {
    const J = mundo(l), I = J.I18n, dic = I.dicionario(l);
    let campos = 0;
    const falta = [], numero = [], visto = {};
    I.percorre(J.DATA, (t, reg, campo, texto) => {
      campos++;
      visto[t + '|' + reg + '|' + campo] = 1;
      const e = dic.dados[t] && dic.dados[t][reg];
      const v = e && e[campo];
      if (typeof v !== 'string' || !v) { falta.push(t + ' · ' + reg + ' · ' + campo + ' — ' + texto.slice(0, 60)); return; }
      if (numeros(v) !== numeros(texto)) numero.push(t + ' · ' + reg + ' · ' + campo + ' — pt [' + numeros(texto) + '] ' + l + ' [' + numeros(v) + ']');
    });
    const sobra = [];
    for (const t in dic.dados) for (const reg in dic.dados[t]) for (const c in dic.dados[t][reg]) {
      if (!visto[t + '|' + reg + '|' + c]) sobra.push(t + ' · ' + reg + ' · ' + c);
    }
    const semTexto = [], varTorta = [];
    doCodigo.forEach((onde, pt) => {
      const v = dic.textos[pt];
      if (typeof v !== 'string' || !v) semTexto.push(onde + ' — ' + pt.slice(0, 70));
      else if (variaveis(v) !== variaveis(pt)) varTorta.push(onde + ' — ' + pt.slice(0, 50) + ' → ' + v.slice(0, 50));
    });
    console.log('[' + l + '] dados: ' + (campos - falta.length) + ' de ' + campos + ' textos traduzidos' +
      ' · números diferentes: ' + numero.length + ' · sobras: ' + sobra.length +
      ' | código: ' + (doCodigo.size - semTexto.length) + ' de ' + doCodigo.size + ' textos embrulhados traduzidos' +
      ' · variáveis diferentes: ' + varTorta.length);
    const mostra = (tit, a) => { if (a.length && (lista || a.length <= 12)) { console.log('  ' + tit + ':'); a.forEach((x) => console.log('    ' + x)); } };
    // ---- o site
    const st = SITE.colhe();
    const siteFalta = [], siteTorta = [];
    let siteTotal = 0;
    const confere = (mapa, doHtml) => mapa.forEach((onde, pt) => {
      siteTotal++;
      const v = dic.textos[pt];
      if (typeof v !== 'string' || !v) siteFalta.push(onde + ' — ' + pt.slice(0, 70));
      else if (variaveis(v) !== variaveis(pt)) siteTorta.push(onde + ' — variável: ' + pt.slice(0, 50) + ' → ' + v.slice(0, 50));
      else if (tagsDe(v, doHtml) !== tagsDe(pt, doHtml)) siteTorta.push(onde + ' — tags: ' + pt.slice(0, 50) + ' → ' + v.slice(0, 50));
    });
    confere(st.html, true); confere(st.juridico, true); confere(st.js, false);
    // ---- o servidor
    const sv = doServidor(), svFalta = [], svTorta = [];
    let svTotal = 0;
    if (sv) {
      Object.keys(sv.moldes).concat(sv.loja).forEach((pt) => {
        svTotal++;
        const v = dic.erros[pt];
        const onde = (sv.moldes[pt] && sv.moldes[pt][0]) || 'loja.py';
        if (typeof v !== 'string' || !v) svFalta.push(onde + ' — ' + pt.slice(0, 70));
        else if (variaveis(v) !== variaveis(pt)) svTorta.push(onde + ' — ' + pt.slice(0, 50) + ' → ' + v.slice(0, 50));
      });
    }
    console.log('     site: ' + (siteTotal - siteFalta.length) + ' de ' + siteTotal + ' frases traduzidas (' + st.html.size + ' do HTML, ' +
      st.juridico.size + ' dos Termos e da Privacidade, ' + st.js.size + ' dos scripts) · tags ou variáveis diferentes: ' + siteTorta.length +
      ' | servidor: ' + (sv ? (svTotal - svFalta.length) + ' de ' + svTotal + ' frases traduzidas (' + Object.keys(sv.moldes).length +
      ' recusas e avisos, ' + sv.loja.length + ' da loja; ' + sv.dinamicos.length + ' montadas na hora ficam de fora) · variáveis diferentes: ' + svTorta.length
        : 'PULADO (sem Python para rodar tools/erros_servidor.py)'));
    mostra('frase do site sem tradução', siteFalta);
    mostra('frase do site com tag ou variável diferente da chave', siteTorta);
    mostra('frase do servidor sem tradução', svFalta);
    mostra('frase do servidor com variável diferente', svTorta);
    ruim += siteFalta.length + siteTorta.length + svFalta.length + svTorta.length;
    mostra('dados sem tradução', falta);
    mostra('dados com número diferente do português', numero);
    mostra('tradução de registro que não existe mais', sobra);
    mostra('texto do código sem tradução', semTexto);
    mostra('variável {…} diferente da chave', varTorta);
    ruim += falta.length + numero.length + semTexto.length + varTorta.length;
  }
  if (ruim && !lista) console.log('(--lista mostra tudo)');
  return ruim ? 1 : 0;
}

process.exit(main());
