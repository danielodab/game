// ============================================================================
// SOTERRA — os IDIOMAS no SITE (05/10, etapa 3 — docs/IDIOMAS.md).
//
// O site é HTML estático escrito em português, e continua sendo: em português
// esta página não troca uma letra do que foi servido. Fora dele, este arquivo
// traduz POR CIMA, antes de a página aparecer:
//
//   · o IDIOMA é o mesmo do jogo — quem decide é o js/core/i18n.js (carregado
//     logo antes deste), com a MESMA chave `soterra-idioma` (mesma origem, mesmo
//     localStorage) e a mesma regra: `?lang=` só naquela abertura; depois o
//     gravado; no navegador virgem, o idioma do aparelho. Quem escolhe inglês
//     aqui abre o jogo em inglês.
//   · o HTML: a página é andada uma vez (SITE_I18N.traduz) e cada FRASE é
//     procurada no dicionário (site/i18n_<idioma>.js) pela própria frase em
//     português — o mesmo estilo do jogo, sem `data-i18n` para manter. A chave
//     de um parágrafo com marcação leva as tags SEM atributos
//     ("Leia os <a>Termos</a>."): a tradução devolve as mesmas tags, e os
//     elementos de verdade (com o href, o id, o que for) são reaproveitados.
//   · o que o JavaScript do site escreve passa pelo Tx de cada arquivo
//     (site.js, conta.js, loja.js…), como no jogo.
//   · o seletor (Português / English / Español) entra no cabeçalho de toda
//     página; trocar grava a chave e recarrega.
//
// Frase sem tradução fica em português — nunca vazio, nunca chave crua. O
// tools/i18n_falta.js lê os mesmos HTML com as funções daqui (por isso este
// arquivo também abre em Node) e cobra o que falta. O site/mestre* fica fora.
// ============================================================================
(function () {
  'use strict';
  var NO_NAVEGADOR = typeof window !== 'undefined' && typeof document !== 'undefined';
  var S = {};

  // ---------------------------------------------------------------- as chaves
  // o que conta como "no meio da frase": a tag vai na chave, sem atributos
  var EM_LINHA = { B: 1, I: 1, EM: 1, STRONG: 1, A: 1, SPAN: 1, KBD: 1, CODE: 1, BR: 1, SMALL: 1, U: 1, SUP: 1, SUB: 1,
                   ABBR: 1, MARK: 1, Q: 1, CITE: 1, TIME: 1, WBR: 1 };
  var VAZIA = { BR: 1, WBR: 1 };
  var FORA = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, SVG: 1, TEXTAREA: 1, TEMPLATE: 1, CANVAS: 1 };
  var ATRIBUTOS = ['title', 'placeholder', 'aria-label', 'alt'];
  // nome próprio: nunca se traduz, nem entra na conta do que falta
  var MARCA = { 'SOTERRA': 1 };

  function limpa(s) { return String(s == null ? '' : s).replace(/\s+/g, ' '); }
  function temLetra(s) { return /[A-Za-zÀ-ÿ]{2}/.test(s); }
  function nomeTag(e) { return String(e.tagName || '').toUpperCase(); }

  function soEmLinha(e) {
    var f = e.childNodes, i, c;
    for (i = 0; i < f.length; i++) {
      c = f[i];
      if (c.nodeType !== 1) continue;
      if (!EM_LINHA[nomeTag(c)] || c.getAttribute('translate') === 'no') return false;
      if (!soEmLinha(c)) return false;
    }
    return true;
  }
  function temElemento(e) {
    for (var i = 0; i < e.childNodes.length; i++) if (e.childNodes[i].nodeType === 1) return true;
    return false;
  }
  // a frase como chave: texto com os espaços juntos, tags sem atributos
  function serial(e) {
    var out = '', f = e.childNodes, i, c, t;
    for (i = 0; i < f.length; i++) {
      c = f[i];
      if (c.nodeType === 3) out += limpa(c.nodeValue);
      else if (c.nodeType === 1) {
        t = nomeTag(c).toLowerCase();
        out += VAZIA[nomeTag(c)] ? '<' + t + '>' : '<' + t + '>' + serial(c) + '</' + t + '>';
      }
    }
    return out;
  }
  S.limpa = limpa;

  /* Anda a página e chama fn(tipo, chave, alvo, nomeDoAtributo):
   *   'frase' — um elemento só com texto e tags de linha: a chave é o miolo inteiro;
   *   'texto' — um nó de texto solto no meio de blocos;
   *   'attr'  — title, placeholder, aria-label, alt e o value de botão.
   * `translate="no"` num elemento tira ele (e o que há dentro) da conta. */
  function anda(no, fn) {
    var f = no.childNodes, i, c, t, tag, k, a, v;
    for (i = 0; i < f.length; i++) {
      c = f[i];
      if (c.nodeType === 3) {
        t = limpa(c.nodeValue).replace(/^ | $/g, '');
        if (temLetra(t) && !MARCA[t]) fn('texto', t, c);
        continue;
      }
      if (c.nodeType !== 1) continue;
      tag = nomeTag(c);
      if (FORA[tag] || c.getAttribute('translate') === 'no') continue;
      for (k = 0; k < ATRIBUTOS.length; k++) {
        v = c.getAttribute(ATRIBUTOS[k]);
        if (v && temLetra(v) && !MARCA[limpa(v)]) fn('attr', limpa(v).replace(/^ | $/g, ''), c, ATRIBUTOS[k]);
      }
      if (tag === 'INPUT' && /^(button|submit|reset)$/i.test(c.getAttribute('type') || '')) {
        a = c.getAttribute('value');
        if (a && temLetra(a)) fn('attr', limpa(a), c, 'value');
      }
      if (tag === 'META') {
        a = c.getAttribute('name') || c.getAttribute('property') || '';
        v = c.getAttribute('content');
        if (/^(description|og:title|og:description|twitter:title|twitter:description)$/.test(a) && v && temLetra(v)) fn('attr', limpa(v), c, 'content');
        continue;
      }
      if (tag === 'TITLE') { t = limpa(serial(c)).replace(/^ | $/g, ''); if (temLetra(t)) fn('frase', t, c); continue; }
      if (temElemento(c) ? soEmLinha(c) : true) {
        t = serial(c).replace(/^ | $/g, '');
        if (temLetra(t.replace(/<[^>]*>/g, ' ')) && !MARCA[t]) { fn('frase', t, c); continue; }
        if (!temElemento(c)) continue;
      }
      anda(c, fn);
    }
  }
  S.anda = anda;

  if (!NO_NAVEGADOR) { module.exports = S; return; }

  // ------------------------------------------------------------- o idioma
  var I = (window.JOGO && window.JOGO.I18n) || null;
  var IDIOMA = I ? I.idioma : 'pt';
  var NOMES = (I && I.NOMES) || { pt: 'Português', en: 'English', es: 'Español' };
  S.idioma = IDIOMA;
  window.SITE_I18N = S;

  function Tx(pt) { return (I && I.t) ? I.t(pt) : pt; }
  function dicTem(pt) {
    if (!I || IDIOMA === 'pt') return null;
    var d = I.dicionario(IDIOMA).textos;
    return Object.prototype.hasOwnProperty.call(d, pt) && d[pt] ? d[pt] : null;
  }

  var pagina = (String(location.pathname).split('/').pop() || 'index.html').replace(/\.html?$/, '') || 'index';
  S.pagina = pagina;
  var JURIDICA = { termos: 1, privacidade: 1 };

  if (IDIOMA !== 'pt') {
    try { document.documentElement.lang = (I.TAG && I.TAG[IDIOMA]) || IDIOMA; } catch (e0) {}
    // os dicionários descem AQUI, no <head>, antes do corpo: a página nunca aparece em português.
    // O texto jurídico tem o seu arquivo, e só desce nas duas páginas dele.
    var url = window.SITE_URL || function (s) { return s; };
    var desce = ['i18n_' + IDIOMA + '.js', '../js/i18n/erros_' + IDIOMA + '.js'];
    if (JURIDICA[pagina]) desce.push('i18n_juridico_' + IDIOMA + '.js');
    for (var q = 0; q < desce.length; q++) document.write('<script src="' + url(desce[q]) + '"><\/script>');
  }

  // ------------------------------------------------------------- a troca
  /* Põe a tradução no elemento REAPROVEITANDO os elementos de linha que já estavam
   * lá (o <a> com o href, o <span id> que um script vai preencher): o k-ésimo <a>
   * da tradução é o k-ésimo <a> do original. Tag que a tradução não tem, some;
   * tag que ela tem a mais não existe para pôr — aí não mexe (devolve false). */
  function poe(el, tr) {
    var orig = {}, todos = el.getElementsByTagName('*'), i, t;
    for (i = 0; i < todos.length; i++) { t = nomeTag(todos[i]); (orig[t] = orig[t] || []).push(todos[i]); }
    var partes = tr.split(/(<\/?[a-z0-9]+>)/), usados = {}, raiz = document.createDocumentFragment(), pilha = [raiz], m, no, lista = [];
    for (i = 0; i < partes.length; i++) {
      if (!partes[i]) continue;
      m = /^<(\/?)([a-z0-9]+)>$/.exec(partes[i]);
      if (!m) { lista.push([pilha[pilha.length - 1], document.createTextNode(partes[i])]); continue; }
      t = m[2].toUpperCase();
      if (m[1]) { if (pilha.length > 1) pilha.pop(); continue; }
      usados[t] = (usados[t] || 0) + 1;
      no = orig[t] && orig[t][usados[t] - 1];
      if (!no) return false;
      lista.push([pilha[pilha.length - 1], no]);
      if (!VAZIA[t]) pilha.push(no);
    }
    var guard = [];
    for (t in orig) for (i = 0; i < orig[t].length; i++) guard.push(orig[t][i]);
    for (i = 0; i < guard.length; i++) while (guard[i].firstChild) guard[i].removeChild(guard[i].firstChild);
    while (el.firstChild) el.removeChild(el.firstChild);
    for (i = 0; i < lista.length; i++) lista[i][0].appendChild(lista[i][1]);
    el.appendChild(raiz);
    return true;
  }

  /* Traduz o que já está na página. Roda UMA vez por raiz, de preferência antes dos
   * scripts do fim do <body> (SITE_I18N.lista chama) — o que eles escrevem depois já
   * sai traduzido pelo Tx de cada um. `falta` guarda o que não achou (a prova lê). */
  S.falta = [];
  S.traduz = function (raiz) {
    if (IDIOMA === 'pt' || !I) return 0;
    var n = 0, fila = [];
    anda(raiz || document.documentElement, function (tipo, chave, alvo, attr) { fila.push([tipo, chave, alvo, attr]); });
    for (var i = 0; i < fila.length; i++) {
      var f = fila[i], tr = dicTem(f[1]);
      if (!tr) { S.falta.push(f[1]); continue; }
      if (f[0] === 'attr') f[2].setAttribute(f[3], tr);
      else if (f[0] === 'texto') f[2].nodeValue = f[2].nodeValue.replace(/^(\s*)[\s\S]*?(\s*)$/, function (x, a, b) { return a + tr + b; });
      else if (nomeTag(f[2]) === 'TITLE') document.title = tr;
      else if (!temElemento(f[2])) f[2].textContent = tr;
      else if (!poe(f[2], tr)) { S.falta.push(f[1]); continue; }
      n++;
    }
    return n;
  };

  // ------------------------------------------------------------- o seletor
  function trocaIdioma(l) {
    if (!I || !I.escolhe(l)) return;
    // o `?lang=` da prova mandaria mais que a escolha: sai do endereço
    var busca = String(location.search || '').replace(/([?&])lang=[a-z]{2}(&|$)/i, function (x, a, b) { return b ? a : ''; });
    try { location.replace(location.pathname + busca + location.hash); } catch (e) { location.reload(); }
  }
  S.escolhe = trocaIdioma;

  function poeSeletor() {
    if (document.getElementById('idioma-sel')) return;
    var topo = document.querySelector('header.topo .miolo');
    if (!topo) return;
    var sel = document.createElement('select');
    sel.id = 'idioma-sel'; sel.className = 'idioma-sel';
    sel.setAttribute('aria-label', 'Idioma · Language · Idioma');
    sel.setAttribute('translate', 'no');
    ['pt', 'en', 'es'].forEach(function (l) {
      var o = document.createElement('option');
      o.value = l; o.textContent = NOMES[l]; o.setAttribute('lang', l);
      if (l === IDIOMA) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { trocaIdioma(sel.value); });
    var sessao = topo.querySelector('.sessao');
    if (sessao) topo.insertBefore(sel, sessao); else topo.appendChild(sel);
  }

  /* TERMOS e PRIVACIDADE: a tradução é de cortesia, e a versão que vale é a em português (o dono
   * combinou em 05/10; a revisão jurídica das traduções está em docs/REVISAO_JURIDICA.md). O aviso
   * abre a página traduzida, com o caminho para o original. */
  function poeAvisoJuridico() {
    if (IDIOMA === 'pt' || !JURIDICA[pagina] || document.getElementById('aviso-traducao')) return;
    var alvo = document.querySelector('main .miolo, section .miolo, main, .legal') || document.body;
    var d = document.createElement('div');
    d.id = 'aviso-traducao'; d.className = 'aviso-traducao'; d.setAttribute('role', 'note');
    var b = document.createElement('b');
    b.textContent = Tx('Tradução de cortesia.');
    d.appendChild(b);
    d.appendChild(document.createTextNode(' ' + Tx('Este texto foi traduzido para facilitar a leitura. A versão em português é a única que vale: se houver diferença entre as duas, vale o que está escrito em português.') + ' '));
    var a = document.createElement('a');
    a.href = location.pathname + '?lang=pt';
    a.textContent = Tx('Ler a versão em português');
    d.appendChild(a);
    var h = alvo.querySelector('h1, h2');
    if (h && h.parentNode) h.parentNode.insertBefore(d, h.nextSibling); else alvo.insertBefore(d, alvo.firstChild);
  }

  var feito = false;
  function prepara() {
    if (feito) return;
    feito = true;
    try { S.traduz(document.documentElement); } catch (e) { if (window.console) console.warn('i18n do site:', e); }
    try { poeSeletor(); } catch (e2) {}
    try { poeAvisoJuridico(); } catch (e3) {}
  }
  S.prepara = prepara;

  /* A lista de scripts do fim do <body> passa por aqui (cada página: SITE_I18N.lista([...])).
   *  1. a página que já foi lida é traduzida AGORA, antes de qualquer script dela rodar;
   *  2. quem carrega arquivo do jogo (a wiki, as fusões, o ranking: js/core/data/*.js, o motor)
   *     ganha os dicionários do jogo no lugar certo — os textos antes de tudo (o motor traduz as
   *     tabelas dele na carga) e os dados logo depois do último js/core/data/*.js, como no index.html
   *     do jogo. Em português a lista volta como veio. */
  S.lista = function (arquivos) {
    prepara();
    if (IDIOMA === 'pt') return arquivos;
    var out = arquivos.slice(), ultimo = -1, doJogo = false, i;
    for (i = 0; i < out.length; i++) {
      if (out[i].indexOf('../js/core/data/') === 0) ultimo = i;
      else if (out[i].indexOf('../js/') === 0) doJogo = true;      // motor, missões, brasão: usam o Tx do jogo
    }
    if (ultimo >= 0) out.splice(ultimo + 1, 0, '../js/i18n/dados_' + IDIOMA + '.js');
    if (doJogo) out.unshift('../js/i18n/textos_' + IDIOMA + '.js');
    return out;
  };

  // página sem lista no fim (ou script que falhou antes): traduz quando o HTML acabar
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', prepara);
  else prepara();
})();
