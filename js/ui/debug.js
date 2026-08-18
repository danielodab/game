var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// PAINEL DE TESTE — libera as classes e ajusta nível, elemento e recursos
//
// Existe para o autor testar o jogo sem precisar jogar 30 níveis: libera as 6
// classes, põe o nível que quiser, escolhe o caminho elemental e enche o saco
// de pedras e itens. Assim dá para conferir TODOS os ataques, inclusive os de
// nível 30 e os de fusão.
//
// Fica num arquivo separado de propósito: não mexe em `hud.js`, então pode
// entrar e sair sem risco. Para tirar do jogo, basta remover a linha dele do
// `index.html`.
//
// AVISO: ele ESCREVE no save de verdade (`localStorage['soterra-save-v2']`).
// Guarda uma cópia antes de cada mudança, e o botão "desfazer" devolve o save
// como estava quando o painel foi aberto.
// ============================================================================

(function () {
  'use strict';

  var COPIA = 'soterra-save-v2--antes-do-teste';
  var ELEMS = ['neutro', 'fogo', 'agua', 'terra', 'ar'];
  var painel = null;

  function P() { return JOGO.Progress; }
  function D() { return JOGO.DATA || {}; }
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function guardaCopia() {
    try {
      var atual = localStorage.getItem('soterra-save-v2');
      if (atual != null && localStorage.getItem(COPIA) == null) {
        localStorage.setItem(COPIA, atual);
      }
    } catch (e) {}
  }
  function desfaz() {
    try {
      var c = localStorage.getItem(COPIA);
      if (c == null) return false;
      localStorage.setItem('soterra-save-v2', c);
      localStorage.removeItem(COPIA);
      P().load();
      return true;
    } catch (e) { return false; }
  }
  function maxNivel() { return ((D().leveling || {}).maxLevel) || 30; }
  function nivelDaEscolha() { return ((D().leveling || {}).elementChoiceLevel) || 5; }

  // Sobe o herói até o nível pedido. `addXp` é a porta oficial, mas ela exige
  // XP acumulada; aqui cravamos o nível e ressincronizamos os feitiços, que é
  // o que o painel de teste precisa.
  function poeNivel(heroId, nivel) {
    var h = P().hero(heroId);
    if (!h) return;
    h.level = Math.max(1, Math.min(maxNivel(), nivel | 0));
    var tab = (D().leveling || {}).xpTable || [];
    h.xp = tab[h.level - 1] != null ? tab[h.level - 1] : h.xp;
    h.spells = P().spellsFor(heroId);
    P().save();
  }

  function linhaDoHeroi(classId) {
    var liberada = P().isClassUnlocked(classId);
    var h = liberada ? P().hero(classId) : null;
    var def = (D().classes || {})[classId] || {};
    var linha = el('div', 'dbg-row');

    var nome = el('div', 'dbg-nome');
    nome.appendChild(el('b', null, def.name || classId));
    nome.appendChild(el('span', null, def.role || ''));
    linha.appendChild(nome);

    if (!liberada) {
      var bLib = el('button', 'dbg-b dbg-b-ok', 'Liberar');
      bLib.type = 'button';
      bLib.onclick = function () { guardaCopia(); P().unlockClass(classId); desenha(); };
      linha.appendChild(bLib);
      return linha;
    }

    // nível
    var cxN = el('div', 'dbg-campo');
    cxN.appendChild(el('label', null, 'nível'));
    var inp = document.createElement('input');
    inp.type = 'number'; inp.min = '1'; inp.max = String(maxNivel());
    inp.value = String(h.level || 1);
    inp.className = 'dbg-num';
    inp.onchange = function () { guardaCopia(); poeNivel(classId, +inp.value); desenha(); };
    cxN.appendChild(inp);
    linha.appendChild(cxN);

    // elemento
    var cxE = el('div', 'dbg-campo');
    cxE.appendChild(el('label', null, 'elemento'));
    var sel = document.createElement('select');
    sel.className = 'dbg-sel';
    ELEMS.forEach(function (e) {
      var o = document.createElement('option');
      o.value = e; o.textContent = e;
      if (h.element === e) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function () {
      guardaCopia();
      // `chooseElement` recusa se já houver elemento ou se o nível for baixo —
      // no painel de teste queremos trocar à vontade, então gravamos direto e
      // ressincronizamos os feitiços pela porta oficial.
      var hh = P().hero(classId);
      hh.element = sel.value;
      hh.spells = P().spellsFor(classId);
      P().save();
      desenha();
    };
    cxE.appendChild(sel);
    linha.appendChild(cxE);

    var n = (h.spells || []).length;
    linha.appendChild(el('span', 'dbg-info', n + ' feitiço' + (n === 1 ? '' : 's')));
    return linha;
  }

  function desenha() {
    if (!painel) return;
    var corpo = painel.querySelector('.dbg-corpo');
    corpo.innerHTML = '';

    var topo = el('div', 'dbg-acoes');
    var bTudo = el('button', 'dbg-b dbg-b-ok', 'Liberar as 6 classes');
    bTudo.type = 'button';
    bTudo.onclick = function () {
      guardaCopia();
      Object.keys(D().classes || {}).forEach(function (c) {
        try { P().unlockClass(c); } catch (e) {}
      });
      desenha();
    };
    topo.appendChild(bTudo);

    var bMax = el('button', 'dbg-b', 'Todos no nível ' + maxNivel());
    bMax.type = 'button';
    bMax.onclick = function () {
      guardaCopia();
      P().heroIds().forEach(function (id) { poeNivel(id, maxNivel()); });
      desenha();
    };
    topo.appendChild(bMax);

    var bPedras = el('button', 'dbg-b', 'Encher o saco');
    bPedras.type = 'button';
    bPedras.onclick = function () {
      guardaCopia();
      Object.keys(D().stones || {}).forEach(function (s) {
        try { P().addStones(s, 50); } catch (e) {}
      });
      Object.keys(D().items || {}).forEach(function (i) {
        try { P().addItem(i); P().addItem(i); P().addItem(i); } catch (e) {}
      });
      Object.keys(D().pets || {}).forEach(function (p) {
        try { P().addPet(p); } catch (e) {}
      });
      desenha();
    };
    topo.appendChild(bPedras);

    var bUndo = el('button', 'dbg-b dbg-b-warn', 'Desfazer tudo');
    bUndo.type = 'button';
    bUndo.title = 'Devolve o save como estava quando você abriu este painel';
    bUndo.onclick = function () {
      if (desfaz()) desenha();
      else alert('Nada para desfazer nesta sessão.');
    };
    topo.appendChild(bUndo);
    corpo.appendChild(topo);

    corpo.appendChild(el('p', 'dbg-aviso',
      'Este painel grava no save de verdade. Ao abrir, uma cópia foi guardada — ' +
      '"Desfazer tudo" devolve tudo como estava. O caminho elemental abre no nível ' +
      nivelDaEscolha() + ', mas aqui você troca em qualquer nível.'));

    Object.keys(D().classes || {}).forEach(function (c) {
      corpo.appendChild(linhaDoHeroi(c));
    });
  }

  function monta() {
    if (painel) return;
    painel = el('div', 'dbg-painel');
    var cab = el('div', 'dbg-cab');
    cab.appendChild(el('b', null, 'Painel de teste'));
    var fechar = el('button', 'dbg-x', '✕');
    fechar.type = 'button';
    fechar.onclick = function () { painel.classList.remove('is-on'); };
    cab.appendChild(fechar);
    painel.appendChild(cab);
    painel.appendChild(el('div', 'dbg-corpo'));
    document.body.appendChild(painel);
  }

  function botao() {
    var b = el('button', 'dbg-abrir', '🔧 teste');
    b.type = 'button';
    b.title = 'Liberar classes e ajustar nível para testar';
    b.onclick = function () {
      monta();
      guardaCopia();
      desenha();
      painel.classList.add('is-on');
    };
    document.body.appendChild(b);
  }

  if (typeof window !== 'undefined') {
    var liga = function () {
      if (!JOGO.Progress || !JOGO.DATA || !JOGO.DATA.classes) { setTimeout(liga, 200); return; }
      // A cópia é tirada no CARREGAMENTO, não ao abrir o painel: assim
      // "desfazer" devolve o save como estava quando você abriu o jogo. Tirando
      // no clique, o que já tivesse sido mudado antes ficava para trás — no
      // primeiro teste as classes continuaram liberadas depois de desfazer.
      guardaCopia();
      botao();
    };
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', liga);
    else liga();
  }

  JOGO.Debug = { abrir: function () { monta(); guardaCopia(); desenha(); painel.classList.add('is-on'); },
                 desfazer: desfaz, poeNivel: poeNivel };
})();
