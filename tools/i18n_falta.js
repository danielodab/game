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
 *  2. CÓDIGO: cada tr('…') / I18n.t('…') / I18n.n(q, '…', '…') com texto literal
 *     em js/ tem entrada em js/i18n/textos_<idioma>.js; e as variáveis {assim}
 *     da tradução são as mesmas da chave.
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
  ['dados_', 'textos_'].forEach((p) => {
    const f = 'js/i18n/' + p + idioma + '.js';
    if (fs.existsSync(path.join(RAIZ, f))) roda(f);
  });
  return ctx.JOGO;
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
  const reT = new RegExp('(?:\\btr|I18n\\.t|\\bId\\.t)\\(\\s*(' + LIT + ')', 'g');
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
  const re = new RegExp('(\\btr\\(\\s*|I18n\\.[tn]\\([^)\']*?)?(' + LIT + ')', 'g');
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
