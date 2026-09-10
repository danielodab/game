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
        // origem 'caixa' (10/09): o servidor só registra peça da Caixa na conta
        // marcada como Mestre; de qualquer outra, a subida é recusada
        try { P().addItem(i, 'caixa'); P().addItem(i, 'caixa'); P().addItem(i, 'caixa'); } catch (e) {}
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

    // --- linha do modo de efeitos, que só faz sentido dentro de uma batalha
    var emBatalha = !!(JOGO.Game && JOGO.Game.state && JOGO.Game.state.phase === 'playing');
    var linhaFx = el('div', 'dbg-acoes');
    var bFx = el('button', 'dbg-b ' + (modoAtivo ? 'dbg-b-warn' : 'dbg-b-ok'),
                 modoAtivo ? 'Desligar modo efeitos' : 'Modo TESTE DE EFEITOS');
    bFx.type = 'button';
    bFx.title = 'Todos os feitiços na mão, PA e passo cheios, sem recarga, e ninguém morre';
    bFx.onclick = function () {
      ligaModo(!modoAtivo);
      if (modoAtivo && JOGO.Game && JOGO.Game.state) aplicaModo(JOGO.Game.state);
      desenha();
    };
    linhaFx.appendChild(bFx);

    var bFundir = el('button', 'dbg-b', 'Fundir agora');
    bFundir.type = 'button';
    bFundir.title = 'Cola os dois heróis e resolve a fusão, para ver os ataques compostos';
    bFundir.onclick = function () {
      try {
        var st = JOGO.Game.state, F = JOGO.Fusion;
        var h = st.units.filter(function (u) { return u.side === 'player' && u.alive && u.kind !== 'fusion'; });
        if (h.length < 2) { alert('Precisa de dois heróis vivos em campo.'); return; }
        h[1].x = h[0].x; h[1].y = h[0].y + 1;
        if (!F.canFuse(st, h[0].uid, h[1].uid)) { alert('A fusão foi recusada aqui.'); return; }
        F.declare(st, h[0].uid, h[1].uid); F.resolve(st);
        if (modoAtivo) aplicaModo(st);
      } catch (e) { alert('Não deu para fundir: ' + e.message); }
      desenha();
    };
    linhaFx.appendChild(bFundir);

    if (!emBatalha) {
      linhaFx.appendChild(el('span', 'dbg-info', 'entre numa sala para usar estes dois'));
    }
    corpo.appendChild(linhaFx);

    // --- A BRASA: para VER cada degrau da chama sem jogar 60 duelos.
    // Grava na CONTA (soterra-conta-v1), não no save — o "Desfazer tudo"
    // não devolve a brasa; o botão Fagulha é o zero dela.
    var linhaBr = el('div', 'dbg-acoes');
    linhaBr.appendChild(el('span', 'dbg-info', 'Brasa: …'));
    var infoBr = linhaBr.firstChild;
    function pintaBrasa() {
      if (!JOGO.DB || !JOGO.DB.brasaVer || !JOGO.Brasa) {
        infoBr.textContent = 'Brasa: sem conta';
        return;
      }
      JOGO.DB.brasaVer().then(function (bz) {
        var t = JOGO.Brasa.tierDe(bz.pts, true);   // aqui o topo é suposto: é bancada
        infoBr.textContent = 'Brasa: ' + bz.pts + ' pts — ' + t.nome;
      });
    }
    function poeBrasa(pts, partidas) {
      var cadeia = (partidas != null)
        ? JOGO.DB.definirBrasa(pts, partidas)
        : JOGO.DB.brasaVer().then(function (bz) {
            // cravar um degrau conta como já ter lutado: a Fagulha ACENDE
            return JOGO.DB.definirBrasa(pts, Math.max(1, bz.partidas));
          });
      cadeia.then(function () {
        pintaBrasa();
        // se o Acampamento está na tela, renasce para a chama trocar JÁ
        try {
          if (document.querySelector('.screen-hub.is-on')) JOGO.UI.showScreen('hub');
        } catch (e) {}
      });
    }
    var bZero = el('button', 'dbg-b', 'Nunca lutou (zera)');
    bZero.type = 'button';
    bZero.title = 'Volta a 1000 pontos com ZERO partidas — sem fogo nenhum';
    bZero.onclick = function () { poeBrasa(1000, 0); };
    linhaBr.appendChild(bZero);
    // TODOS os dez degraus — cinco atalhos fizeram parecer que só havia
    // cinco ranks ("coloquei 10 coroas.. entao sao 10 rankings...")
    [['I', 1000], ['II', 1100], ['III', 1200], ['IV', 1300], ['V', 1400],
     ['VI', 1500], ['VII', 1600], ['VIII', 1700], ['IX', 1800],
     ['X', 1900]].forEach(function (par) {
      var bT = el('button', 'dbg-b', par[0] + ' (' + par[1] + ')');
      bT.type = 'button';
      bT.title = 'Crava ' + par[1] + ' pontos de Brasa — a chama na cabeça troca na hora';
      bT.onclick = function () { poeBrasa(par[1]); };
      linhaBr.appendChild(bT);
    });
    corpo.appendChild(linhaBr);

    var linhaBr2 = el('div', 'dbg-acoes');
    var bVit = el('button', 'dbg-b dbg-b-ok', 'Vitória de arena (Elo real)');
    bVit.type = 'button';
    bVit.title = 'Aplica a conta de Elo de uma vitória contra um adversário de pontos IGUAIS';
    bVit.onclick = function () {
      JOGO.DB.brasaVer().then(function (bz) {
        var r = JOGO.Brasa.elo(bz.pts, bz.pts, true);
        JOGO.DB.definirBrasa(r.pts, bz.partidas + 1).then(function () {
          pintaBrasa();
          try {
            if (document.querySelector('.screen-hub.is-on')) JOGO.UI.showScreen('hub');
          } catch (e) {}
        });
      });
    };
    linhaBr2.appendChild(bVit);
    var bDer = el('button', 'dbg-b dbg-b-warn', 'Derrota de arena (Elo real)');
    bDer.type = 'button';
    bDer.onclick = function () {
      JOGO.DB.brasaVer().then(function (bz) {
        var r = JOGO.Brasa.elo(bz.pts, bz.pts, false);
        JOGO.DB.definirBrasa(r.pts, bz.partidas + 1).then(function () {
          pintaBrasa();
          try {
            if (document.querySelector('.screen-hub.is-on')) JOGO.UI.showScreen('hub');
          } catch (e) {}
        });
      });
    };
    linhaBr2.appendChild(bDer);
    linhaBr2.appendChild(el('span', 'dbg-info',
      'a chama aparece na cabeça no Acampamento; o ranking, no Placar da Arena'));
    corpo.appendChild(linhaBr2);
    pintaBrasa();

    corpo.appendChild(el('p', 'dbg-aviso',
      'Este painel grava no save de verdade. Ao abrir, uma cópia foi guardada — ' +
      '"Desfazer tudo" devolve tudo como estava. O caminho elemental abre no nível ' +
      nivelDaEscolha() + ', mas aqui você troca em qualquer nível.'));

    Object.keys(D().classes || {}).forEach(function (c) {
      corpo.appendChild(linhaDoHeroi(c));
    });
  }

  // ====================================================== MODO TESTE DE EFEITOS
  // O objetivo do usuário não é só liberar as classes — é VER O EFEITO DE TODOS
  // OS ATAQUES. Em batalha isso esbarra em três coisas: PA acaba, feitiço entra
  // em recarga, e o herói só tem o caminho elemental que escolheu. Este modo
  // remove as três e deixa a sala de pé para conjurar à vontade.
  var modoAtivo = false;

  function todosOsFeiticos(classId) {
    var def = (D().classes || {})[classId] || {};
    var out = (def.baseSpells || []).slice();
    Object.keys(def.paths || {}).forEach(function (e) {
      (def.paths[e] || []).forEach(function (sid) { if (out.indexOf(sid) < 0) out.push(sid); });
    });
    return out;
  }

  function aplicaModo(st) {
    if (!st || !st.units) return;
    st.units.forEach(function (u) {
      if (!u.alive) return;
      if (u.side === 'player') {
        if (u.defId && (D().classes || {})[u.defId]) {
          var todos = todosOsFeiticos(u.defId);
          todos.forEach(function (sid) { if (u.spells.indexOf(sid) < 0) u.spells.push(sid); });
        }
        u.pa = Math.max(u.pa, 99);
        u.pp = Math.max(u.pp, 20);
        u.cooldowns = {};
        u.castsThisTurn = {};
        u.hpMax = Math.max(u.hpMax, 99999); u.hp = u.hpMax;
      } else {
        // o alvo não pode morrer no meio da demonstração
        u.hpMax = Math.max(u.hpMax, 99999); u.hp = u.hpMax;
      }
    });
  }

  function ligaModo(liga) {
    modoAtivo = !!liga;
    if (!modoAtivo) return;
    var laco = function () {
      if (!modoAtivo) return;
      try {
        var g = JOGO.Game;
        if (g && g.state && g.state.phase === 'playing') aplicaModo(g.state);
      } catch (e) {}
      setTimeout(laco, 400);
    };
    laco();
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

  function bloqueado() {
    var G = JOGO.GM;
    var noAr = !!(G && G.noAr && G.noAr());
    return noAr && !(G && G.ativo && G.ativo());
  }

  if (typeof window !== 'undefined') {
    var liga = function () {
      if (!JOGO.Progress || !JOGO.DATA || !JOGO.DATA.classes) { setTimeout(liga, 200); return; }
      // A cópia é tirada no CARREGAMENTO, não ao abrir o painel: assim
      // "desfazer" devolve o save como estava quando você abriu o jogo. Tirando
      // no clique, o que já tivesse sido mudado antes ficava para trás — no
      // primeiro teste as classes continuaram liberadas depois de desfazer.
      // SÓ O MESTRE (10/09: "a opção teste só deve estar disponível para mim").
      // No ar, o painel dá níveis, pedras e itens: só a conta que o servidor
      // marcou o vê. Em casa (file://, localhost) continua como sempre.
      if (bloqueado()) return;
      guardaCopia();
      botao();
    };
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', liga);
    else liga();
  }

  JOGO.Debug = { modoEfeitos: ligaModo, bloqueado: bloqueado,
                 abrir: function () { if (bloqueado()) return false; monta(); guardaCopia(); desenha(); painel.classList.add('is-on'); return true; },
                 desfazer: desfaz, poeNivel: poeNivel };
})();
