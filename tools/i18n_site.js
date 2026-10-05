'use strict';
/* AS FRASES DO SITE, colhidas dos arquivos (05/10, etapa 3 dos idiomas — docs/IDIOMAS.md).
 *
 * O site traduz o HTML por cima, pela própria frase em português (site/i18n.js). Para cobrar o
 * que falta sem abrir navegador, este módulo lê os site/*.html com um leitor de HTML mínimo e
 * passa a árvore pelas MESMAS funções que o navegador usa (o `anda` do site/i18n.js): a chave
 * que sai aqui é a chave que a página procura. O JavaScript do site entra pelo Tx('…') literal,
 * como o do jogo. Quem usa: tools/i18n_falta.js e tests/idiomas.js.
 *
 *   node tools/i18n_site.js            quantas frases por arquivo
 *   node tools/i18n_site.js --json     { html: {frase: 'arquivo'}, js: {frase: 'arquivo:linha'}, juridico: {…} }
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.resolve(__dirname, '..');
const SITE = require(path.join(RAIZ, 'site', 'i18n.js'));
// o painel do Mestre não se traduz
const FORA = /^mestre/;
const JURIDICAS = ['termos.html', 'privacidade.html'];

const VAZIAS = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
const CRUAS = { script: 1, style: 1 };
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', middot: '·', copy: '©' };
function ent(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, k) => {
    if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    if (Object.prototype.hasOwnProperty.call(ENT, k)) return ENT[k];
    throw new Error('entidade que o leitor não conhece: ' + m + ' (acrescente em tools/i18n_site.js)');
  });
}
function no(tag, attrs) {
  return { nodeType: 1, tagName: tag.toUpperCase(), childNodes: [], attrs: attrs || {},
           getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; } };
}
/* HTML bem formado, como o do site: tags fechadas, atributos entre aspas. Não é um navegador —
 * o que ele não entende, estoura (melhor que colher chave errada calado). */
function leHtml(txt) {
  const raiz = no('#raiz'), pilha = [raiz];
  const re = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([a-zA-Z][a-zA-Z0-9]*)\s*>|<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  let pos = 0, m;
  const texto = (s) => { if (s) pilha[pilha.length - 1].childNodes.push({ nodeType: 3, nodeValue: ent(s) }); };
  while ((m = re.exec(txt))) {
    texto(txt.slice(pos, m.index));
    pos = re.lastIndex;
    if (m[1]) {
      const t = m[1].toUpperCase();
      let i = pilha.length - 1;
      while (i > 0 && pilha[i].tagName !== t) i--;
      if (i > 0) pilha.length = i;
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase(), attrs = {};
    const ra = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a;
    while ((a = ra.exec(m[3] || ''))) attrs[a[1].toLowerCase()] = ent(a[2] != null ? a[2] : a[3] != null ? a[3] : a[4] != null ? a[4] : '');
    const e = no(tag, attrs);
    pilha[pilha.length - 1].childNodes.push(e);
    if (CRUAS[tag]) {
      const fim = txt.toLowerCase().indexOf('</' + tag, pos);
      const ate = fim < 0 ? txt.length : fim;
      e.cru = txt.slice(pos, ate);
      pos = txt.indexOf('>', ate) + 1 || txt.length;
      re.lastIndex = pos;
      continue;
    }
    if (!VAZIAS[tag] && !m[4]) pilha.push(e);
  }
  texto(txt.slice(pos));
  return raiz;
}

function literal(bruto) { try { return vm.runInNewContext(bruto); } catch (e) { return null; } }
const LIT = "'(?:[^'\\\\\\n]|\\\\.)*'|\"(?:[^\"\\\\\\n]|\\\\.)*\"";
function chavesDeJs(txt, onde, mapa) {
  const limpo = txt.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const re = new RegExp('\\bTx\\(\\s*(' + LIT + ')', 'g');
  let m;
  while ((m = re.exec(limpo))) {
    const t = literal(m[1]);
    if (typeof t === 'string' && t && !mapa.has(t)) mapa.set(t, onde + ':' + limpo.slice(0, m.index).split('\n').length);
  }
}
function scripts(arvore, fn) {
  for (const c of arvore.childNodes) {
    if (c.nodeType !== 1) continue;
    if (c.tagName === 'SCRIPT') { if (c.cru && !c.getAttribute('src')) fn(c.cru); } else scripts(c, fn);
  }
}

/* { html, js, juridico }: Map frase → onde. As duas páginas de texto jurídico vão num mapa à parte
 * (o dicionário delas é outro arquivo, site/i18n_juridico_<idioma>.js), fora o que elas têm de
 * comum com o resto do site (o topo, o rodapé), que fica em `html`. */
function colhe() {
  const html = new Map(), js = new Map(), juridico = new Map();
  const dir = path.join(RAIZ, 'site');
  const nomes = fs.readdirSync(dir).filter((n) => !FORA.test(n)).sort();
  const arvores = {};
  for (const n of nomes.filter((x) => /\.html$/.test(x))) {
    arvores[n] = leHtml(fs.readFileSync(path.join(dir, n), 'utf8'));
    if (JURIDICAS.indexOf(n) >= 0) continue;
    SITE.anda(arvores[n], (tipo, chave) => { if (!html.has(chave)) html.set(chave, 'site/' + n); });
  }
  for (const n of JURIDICAS) {
    if (!arvores[n]) continue;
    SITE.anda(arvores[n], (tipo, chave) => { if (!html.has(chave) && !juridico.has(chave)) juridico.set(chave, 'site/' + n); });
  }
  for (const n in arvores) scripts(arvores[n], (cru) => chavesDeJs(cru, 'site/' + n, js));
  for (const n of nomes.filter((x) => /\.js$/.test(x) && !/^i18n_/.test(x))) chavesDeJs(fs.readFileSync(path.join(dir, n), 'utf8'), 'site/' + n, js);
  return { html, js, juridico };
}

// as tags da frase, na ordem: a tradução tem de devolver as mesmas (a troca reaproveita os elementos)
function tags(s) { return (String(s).match(/<\/?[a-z0-9]+>/g) || []).filter((t) => t[1] !== '/').sort().join(' '); }

module.exports = { colhe, leHtml, tags, chavesDeJs };

if (require.main === module) {
  const c = colhe();
  if (process.argv.indexOf('--json') >= 0) {
    const o = (m) => { const r = {}; m.forEach((v, k) => { r[k] = v; }); return r; };
    process.stdout.write(JSON.stringify({ html: o(c.html), js: o(c.js), juridico: o(c.juridico) }, null, 0));
  } else {
    const soma = (m) => { let n = 0; m.forEach((v, k) => { n += k.length; }); return n; };
    console.log('HTML: ' + c.html.size + ' frases (' + soma(c.html) + ' letras) · JS: ' + c.js.size + ' (' + soma(c.js) + ') · jurídico: ' + c.juridico.size + ' (' + soma(c.juridico) + ')');
  }
}
