var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* ============================================================================
 * SOTERRA 2.0 — js/ui/hud.js   (dono: Designer Arte)
 * Interface MOBILE-FIRST. Retrato de 360 px a 1920 px, tudo por toque, alvos
 * >= 44 px, nada dependente de :hover (tooltip abre no toque e fecha no toque
 * fora). LEI: docs/CONTRACT_V2.md §9 (JOGO.UI), §9-B (adendo v2.1) e §9-C
 * (adendo v2.2 — espaços punho/passo/casca/lume e ganho elemental por nível).
 * Nomenclatura: pa = Pontos de Ataque, pp = Pontos de Passos.
 *
 * ---------------------------------------------------------------------------
 * API (chamada pelo js/main.js e pelo JOGO.Game)
 *   UI.init()                    monta o DOM dentro de #ui-root
 *   UI.showScreen(name, data)    'menu' | 'heroSelect' | 'elementChoice' |
 *                                'dungeonSelect' | 'battle' | 'roomClear' |
 *                                'defeat' | 'dungeonComplete'
 *   UI.handleEvent(ev)           eventos do Engine (log, cronômetro, fusão…)
 *   UI.update(dt)                repinta o HUD de batalha quando algo mudou
 *
 * ---------------------------------------------------------------------------
 * DECISÕES DE DESIGN
 *
 * [U1] TUDO DEFENSIVO. Progress/Game/Engine/Art podem não existir (a galeria e
 *      os testes carregam só parte do jogo). Toda leitura passa por acessador
 *      com try/catch e valor de reserva — a UI nunca derruba o jogo.
 *
 * [U2] REPINTURA POR ASSINATURA. O HUD de batalha só se redesenha quando a
 *      "assinatura" do estado muda (uid ativo, pv/pa/pp, feitiço escolhido,
 *      fusão disponível…). Fora isso, `update` só mexe no cronômetro. Assim o
 *      DOM não é reconstruído 60×/s no celular.
 *
 * [U3] ARTE VEM DO Art E É CÓPIA. `Art.node(canvas)` devolve uma cópia — os
 *      canvases do cache são compartilhados e inserir o original no DOM o
 *      arrancaria do lugar anterior.
 *
 * [U4] ESPAÇOS (adendo v2.2). A UI fala punho/passo/casca/lume. Os dados podem
 *      ainda estar com os ids antigos (pa/pp/vida/especial): `slotRaw()`
 *      descobre o id de verdade olhando DATA.items, e `Art.slotKey` traduz.
 *
 * [U5] TOQUE. `tap(el, fn)` usa 'click' (que o navegador já sintetiza a partir
 *      do toque) + prevenção de duplo disparo; nenhuma informação depende de
 *      passar o mouse por cima. Tooltip = toque no ícone.
 * ==========================================================================*/

(function () {
  'use strict';

  var UI = {};
  JOGO.UI = UI;

  // ---------------------------------------------------------------- estado
  var root = null;                 // #ui-root
  var screens = {};                // name -> elemento
  var current = null;              // tela ativa
  var selHeroes = [];              // heróis escolhidos (1 ou 2)
  var logLines = [];               // log compacto da batalha
  var battleSig = '';              // assinatura de repintura [U2]
  var tipEl = null, tipOwner = null;
  var sheetEl = null, sheetName = null, lastSheetArg = null;
  var lastRewards = null;
  var invFilter = 'todos';
  /* filtros por ELEMENTO (pedido 25/08: "facilita a busca") — um por ficha,
   * porque cada uma guarda a própria busca entre redesenhos */
  var invElemFiltro = 'todos';
  var forjaElemFiltro = 'todos';
  var bancoElemFiltro = 'todos';
  var invBusca = '';               // busca por nome (25/08) — vive entre redesenhos
  var bancoBusca = '';
  var elemChoiceHero = null;
  // ---- tela "Personagens" [U6]
  var partyTab = 'inventario';     // aba corrente: inventario | forja | colecao
  var partyHero = null;            // herói do carrossel (só classes liberadas)
  var invSel = null;               // peça escolhida na grade: {itemId, level, stars}
  var forgeTarget = null;          // alvo da forja: do saco ou vestido por alguém

  var LUCK = { 1: 2.4, 2: 1.6 };
  var ELEM_PT = { neutro: 'Neutro', fogo: 'Fogo', agua: 'Água', terra: 'Terra', ar: 'Ar' };
  var RAR_PT = { comum: 'Comum', raro: 'Raro', epico: 'Épico', lendario: 'Lendário' };
  var DIFF_PT = ['Fácil', 'Média', 'Difícil', 'Brutal', 'Cruel', 'Final'];
  var SLOTS = ['punho', 'passo', 'casca', 'lume'];
  var SLOT_PT = { punho: 'Punho', passo: 'Passo', casca: 'Casca', lume: 'Lume' };
  var SLOT_HINT = {
    punho: 'o que golpeia — dá PA',
    passo: 'o que anda — dá PP',
    casca: 'o que protege — vida e resistências',
    lume: 'a relíquia acesa — concede um feitiço'
  };

  // ------------------------------------------------------------ acessadores [U1]
  function D() { return JOGO.DATA || {}; }
  function G() { return JOGO.Game || null; }
  function P() { return JOGO.Progress || null; }
  function E() { return JOGO.Engine || null; }
  function A() { return JOGO.Art || null; }
  function safe(fn, def) { try { var v = fn(); return v === undefined ? def : v; } catch (e) { return def; } }

  function classes() { return D().classes || {}; }
  function classDef(id) { return classes()[id] || null; }
  function className(id) { var c = classDef(id); return (c && c.name) || id; }
  // FONTE ÚNICA de feitiço — a mesma porta que o motor usa.
  // `Engine.spell(id)` resolve DATA.spells + monsterSpells + petSpells +
  // itemSpells + fusionSpells + os feitiços GERADOS de fusão (que só existem em
  // memória e nunca estiveram em DATA). Ler só `DATA.spells`/`fusionSpells`
  // fazia os 12 itens de Lume e a barra INTEIRA da unidade fundida saírem com
  // id cru e custo zero — "0 is-seed-bomb" no lugar de "Bomba de Sementes · 3 PA".
  // Justamente as duas mecânicas mais especiais do jogo.
  function spellDef(id, unit) {
    if (!id) return null;
    if (typeof id === 'object') return id;                     // já veio resolvido
    var d = safe(function () { return JOGO.Engine.spell(id); }, null);
    if (d) return d;
    // rede de segurança: a unidade fundida carrega as próprias definições
    if (unit && unit.spellDefs && unit.spellDefs[id]) return unit.spellDefs[id];
    return (D().spells && D().spells[id]) || (D().fusionSpells && D().fusionSpells[id]) ||
           (D().itemSpells && D().itemSpells[id]) || (D().petSpells && D().petSpells[id]) ||
           (D().monsterSpells && D().monsterSpells[id]) || null;
  }
  // Nenhum id cru pode chegar à tela: sem definição, texto genérico legível.
  function spellName(d2, id) { return (d2 && d2.name) || 'Feitiço desconhecido'; }
  function spellCost(d2) { return (d2 && d2.paCost) || 0; }
  function itemDef(id) { return (D().items && D().items[id]) || null; }
  function setDef(id) { return (D().sets && D().sets[id]) || null; }
  function stoneDefs() { return D().stones || {}; }
  function petDef(id) { return (D().pets && D().pets[id]) || null; }
  // ---- PETS COM NÍVEL E CARTAS (03/09): os mesmos helpers das classes
  function petCardInfo(pid) {
    return safe(function () { return P().petCardInfo(pid); }, null) ||
           { petId: pid, cards: 0, unlockCost: 5, stars: 0, maxStars: 3, unlocked: false,
             level: 1, mult: 1, next: null };
  }
  function petXpInfo(pid) {
    return safe(function () { return P().petXpInfo(pid); }, null) ||
           { level: 1, xp: 0, next: null, faltam: 0, frac: 0, max: false, maxLevel: 10 };
  }
  // 'Nv 3 ★★' — o rótulo curto do bicho, para os slots e o seletor
  function petNivelTxt(pid) {
    var i = petCardInfo(pid);
    return 'Nv ' + i.level + (i.stars ? ' ' + new Array(i.stars + 1).join('★') : '');
  }
  function petStarRow(n, size) {
    var w = el('span', 'star-row');
    for (var i = 0; i < 3; i++) w.appendChild(art('starIcon', [i < n, size || 14], size || 14));
    return w;
  }
  function dungeons() { return D().dungeons || []; }
  function starsCfg() { return D().stars || { max: 5, bonuses: {} }; }
  function upgradeCfg() { return D().upgrade || { maxLevel: 10, tiers: [], stoneCost: [] }; }

  function hero(id) { return safe(function () { return P().hero(id); }, null); }
  function heroIds() { return safe(function () { return P().heroIds(); }, []); }
  function isUnlocked(cid) { return safe(function () { return P().isClassUnlocked(cid); }, !!(classDef(cid) && classDef(cid).startsUnlocked)); }
  function cardInfo(cid) {
    return safe(function () { return P().cardInfo(cid); },
      { classId: cid, name: className(cid), cards: 0, unlocked: isUnlocked(cid), unlockCost: 0, stars: 0, next: null });
  }
  function xpInfo(hid) { return safe(function () { return P().xpInfo(hid); }, null); }
  function effStats(hid) { return safe(function () { return P().effectiveStats(hid); }, null); }
  function stoneCount(sid) { return safe(function () { return P().stoneCount(sid); }, 0); }
  function equippedBy(itemId) { return safe(function () { return P().equippedBy(itemId); }, null); }
  function ownedPets() { return safe(function () { return P().state.pets.slice(); }, []); }

  // [U4] id de espaço realmente usado pelos dados (v2.2 ou o antigo)
  var _slotRaw = null;
  function slotRaw(canon) {
    if (!_slotRaw) {
      _slotRaw = { punho: 'punho', passo: 'passo', casca: 'casca', lume: 'lume' };
      var art = A(), items = D().items || {}, k, it;
      for (k in items) {
        if (!items.hasOwnProperty(k)) continue;
        it = items[k];
        if (!it || !it.slot) continue;
        var c = art && art.slotKey ? art.slotKey(it.slot) : it.slot;
        if (_slotRaw.hasOwnProperty(c)) _slotRaw[c] = it.slot;
      }
    }
    return _slotRaw[canon] || canon;
  }
  function slotOf(itemId) {
    var it = itemDef(itemId), art = A();
    var s = (it && it.slot) || 'casca';
    return (art && art.slotKey) ? art.slotKey(s) : s;
  }
  function heroItem(h, canon) { return (h && h.items && h.items[slotRaw(canon)]) || null; }

  // -------------------------------------------------------------- DOM helpers
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  // [U5] toque = clique sintetizado; bloqueia repique e o "clique fantasma"
  function tap(node, fn) {
    if (!node) return node;
    node.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (node.classList.contains('is-off')) return;
      fn(ev);
    });
    return node;
  }
  function btn(label, cls, fn) {
    var b = el('button', 'btn ' + (cls || ''), label);
    b.type = 'button';
    if (fn) tap(b, fn);
    return b;
  }
  // [U3] canvas do Art SEMPRE por cópia
  function art(fnName, args, cssW, cls) {
    var a = A();
    if (!a || typeof a[fnName] !== 'function') return el('div', 'art-missing ' + (cls || ''));
    var cv = safe(function () { return a[fnName].apply(a, args); }, null);
    if (!cv) return el('div', 'art-missing ' + (cls || ''));
    return a.node(cv, cssW, cls);
  }
  function elemColor(e) { return safe(function () { return A().elementColor(e); }, '#d8dee4'); }
  function rarColor(r) { return safe(function () { return A().rarityColor(r); }, '#9aa4ae'); }
  function rarGlow(r) { return safe(function () { return A().rarityGlow(r); }, rarColor(r)); }
  // Marca a célula com a raridade: cor da borda, cor do halo e a classe que o
  // CSS usa para acender a LENDÁRIA. Um lugar só — antes cada tela repetia o
  // `--rc` na mão e a 4ª raridade não existia em nenhuma delas.
  function markRarity(cell, rarity) {
    if (!cell) return cell;
    var r = rarity || 'comum';
    cell.style.setProperty('--rc', rarColor(r));
    cell.style.setProperty('--rc-halo', rarGlow(r));
    cell.setAttribute('data-rar', r);
    if (safe(function () { return A().rarityRank(r); }, 0) >= 3) cell.classList.add('is-lendario');
    return cell;
  }

  // ----------------------------------------------------------------- tooltip [U5]
  function hideTip() {
    if (tipEl) { tipEl.classList.remove('is-on'); tipOwner = null; }
  }
  function showTip(anchor, title, body, accent) {
    if (!tipEl) return;
    if (tipOwner === anchor) { hideTip(); return; }
    tipOwner = anchor;
    tipEl.innerHTML = '<b style="color:' + (accent || '#ffd08a') + '">' + esc(title) + '</b>' +
      (body ? '<span>' + body + '</span>' : '');
    tipEl.classList.add('is-on');
    // posiciona acima do alvo, preso à tela (celular estreito)
    var r = anchor.getBoundingClientRect();
    var w = Math.min(280, window.innerWidth - 20);
    tipEl.style.width = w + 'px';
    var left = Math.max(10, Math.min(window.innerWidth - w - 10, r.left + r.width / 2 - w / 2));
    tipEl.style.left = left + 'px';
    var h = tipEl.offsetHeight || 90;
    var top = r.top - h - 10;
    if (top < 8) top = Math.min(window.innerHeight - h - 8, r.bottom + 10);
    tipEl.style.top = top + 'px';
  }
  function tipOn(node, title, body, accent) {
    tap(node, function () { showTip(node, title, body, accent); });
    return node;
  }

  // ------------------------------------------------------------------- toast
  var toastEl = null, toastT = 0;
  function toast(msg, kind) {
    if (!toastEl) return;
    toastEl.className = 'ui-toast is-on' + (kind ? ' t-' + kind : '');
    toastEl.innerHTML = esc(msg);
    toastT = 2.4;
  }

  /* ------------------------------------------------------------ dica da MIRA
   * No toque não existe "passar por cima": o primeiro toque MIRA e o segundo
   * CONFIRMA (ver renderer3d_v2.js). O jogador precisa saber disso na primeira
   * vez que acontece com ele — senão o primeiro toque parece um toque perdido.
   * Some sozinha depois de três vezes: quem já entendeu não quer mais o aviso. */
  var miraEl = null, miraT = 0, miraVistas = 0;
  UI.dicaMira = function (tipo) {
    if (!miraEl || miraVistas >= 3) return;
    miraVistas++;
    miraEl.textContent = (tipo === 'feitico')
      ? 'toque de novo para lançar'
      : 'toque de novo para andar até aqui';
    miraEl.classList.add('is-on');
    miraT = 2.0;
  };

  // ------------------------------------------------------------ barras e pips
  function bar(cls, pct, label) {
    var b = el('div', 'bar ' + cls);
    var f = el('div', 'bar-fill');
    f.style.width = Math.max(0, Math.min(100, pct * 100)) + '%';
    b.appendChild(f);
    if (label != null) b.appendChild(el('span', 'bar-txt', label));
    return b;
  }
  function pips(n, max, cls) {
    var w = el('div', 'pips ' + cls);
    var total = Math.max(n, max || 0), i;
    for (i = 0; i < total; i++) w.appendChild(el('i', i < n ? 'pip on' : 'pip'));
    return w;
  }
  function statLine(txt) { return el('div', 'stat-line', txt); }

  // texto do ganho por nível (adendo v2.2): +5 PV e +3 no elemento escolhido
  function perLevelText(element) {
    var lv = D().leveling || {};
    var pe = lv.perLevelElement || { hp: 5, elemPower: 3 };
    var pl = lv.perLevel || { hp: 5, power: 3 };
    if (element && element !== 'neutro') {
      return 'Cada nível: +' + (pe.hp || 5) + ' PV e +' + (pe.elemPower || 3) +
             ' de dano de ' + (ELEM_PT[element] || element) + '.';
    }
    return 'Cada nível: +' + (pl.hp || 5) + ' PV e +' + (pl.power || 3) +
           ' de poder — a partir do nível 5 o ganho passa a ser do elemento escolhido.';
  }

  // ==========================================================================
  // ESQUELETO
  // ==========================================================================
  var SCREEN_NAMES = ['menu', 'heroSelect', 'hub', 'dungeonSelect', 'elementChoice', 'duelFim',
                      'battle', 'roomClear', 'dungeonComplete', 'defeat', 'antessala'];

  UI.init = function () {
    root = document.getElementById('ui-root');
    if (!root) {
      root = el('div');
      root.id = 'ui-root';
      document.body.appendChild(root);
    }
    clear(root);
    root.className = 'ui-root';
    // A CONTA DO MESTRE (03/09) já nasce aparelhada — idempotente, custa nada
    if (JOGO.GM && JOGO.GM.prepararConta) safe(function () { return JOGO.GM.prepararConta(); }, null);

    for (var i = 0; i < SCREEN_NAMES.length; i++) {
      var n = SCREEN_NAMES[i];
      var s = el('div', 'ui-screen screen-' + n);
      screens[n] = s;
      root.appendChild(s);
    }

    sheetEl = el('div', 'ui-sheet');
    root.appendChild(sheetEl);
    tap(sheetEl, function (ev) { if (ev.target === sheetEl) closeSheet(); });

    tipEl = el('div', 'ui-tip');
    root.appendChild(tipEl);
    toastEl = el('div', 'ui-toast');
    root.appendChild(toastEl);
    miraEl = el('div', 'ui-mira');
    root.appendChild(miraEl);

    document.addEventListener('click', function (ev) {
      if (tipOwner && tipEl && !tipEl.contains(ev.target) && !tipOwner.contains(ev.target)) hideTip();
    }, true);
    window.addEventListener('resize', function () { hideTip(); });

    /* ATALHOS DE TECLADO, à moda MMORPG — o primeiro listener de tecla do
     * jogo. I abre o saco de QUALQUER lugar (a aba Inventário já é o menu de
     * MMORPG: o herói com as setas, o equipamento vestido, a grade do saco) —
     * e fecha, se já está aberto. ESC fecha a ficha aberta.
     * Digitar num campo NUNCA dispara atalho: o i de um nome no meio da
     * palavra não pode abrir o saco. Ctrl/Alt/Meta também não — Ctrl+I é do
     * navegador, não nosso. */
    document.addEventListener('keydown', function (ev) {
      if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
      var alvo = ev.target;
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' ||
                   alvo.isContentEditable)) return;
      var k = String(ev.key || '').toLowerCase();
      if (k === 'escape') {
        if (sheetName) { closeSheet(); ev.preventDefault(); }
        return;
      }
      if (k === 'i') {
        ev.preventDefault();
        if (sheetName === 'party' && partyTab === 'inventario') closeSheet();
        else openSheet('inventory');
      }
    });

    UI.showScreen(safe(function () { return G().screen; }, 'menu'));
    return UI;
  };

  UI.showScreen = function (name, data) {
    if (!screens[name]) name = 'menu';
    hideTip();
    if (name !== 'battle') closeSheet();
    current = name;
    // o laço de desenho do Acampamento não pode continuar rodando escondido
    if (name !== 'hub' && JOGO.Hub && JOGO.Hub.sair) JOGO.Hub.sair();
    for (var k in screens) {
      if (screens.hasOwnProperty(k)) screens[k].classList.toggle('is-on', k === name);
    }
    root.classList.toggle('in-battle', name === 'battle');
    // fora da batalha o tabuleiro volta a ter a tela inteira
    if (name !== 'battle' && JOGO.Renderer && JOGO.Renderer.setMoldura) {
      JOGO.Renderer.setMoldura(0, 0);
    }
    battleSig = '';
    if (name === 'menu') buildMenu();
    else if (name === 'heroSelect') buildHeroSelect();
    else if (name === 'hub') buildHub(null);
    // A ANTESSALA (03/09): a mesma máquina da praça, no pátio da sala
    else if (name === 'antessala') buildHub(data || safe(function () { return G().salaInfo(); }, null));
    else if (name === 'dungeonSelect') buildDungeonSelect();
    else if (name === 'elementChoice') buildElementChoice(data);
    else if (name === 'duelFim') buildDuelFim(data);
    else if (name === 'battle') { logLines = []; buildBattle(); }
    else if (name === 'roomClear' || name === 'dungeonComplete') buildRewards(name, data);
    else if (name === 'defeat') buildDefeat();
  };

  function navTo(name) { if (!safe(function () { return G().goTo(name); }, false)) UI.showScreen(name); }

  // ---------------------------------------------------------- cabeçalho comum
  function header(title, sub, backTo) {
    var h = el('header', 'ui-head');
    if (backTo) h.appendChild(btn('‹', 'btn-icon btn-back', function () { navTo(backTo); }));
    var t = el('div', 'ui-head-txt');
    t.appendChild(el('h1', null, esc(title)));
    if (sub) t.appendChild(el('p', null, sub));
    h.appendChild(t);
    return h;
  }

  // tira de recursos (pedras) — aparece no menu e nas telas de meta
  function stonesStrip() {
    var wrap = el('div', 'stones-strip');
    var defs = stoneDefs(), k, any = false;
    for (k in defs) {
      if (!defs.hasOwnProperty(k)) continue;
      any = true;
      var n = stoneCount(k);
      var chip = el('div', 'stone-chip' + (n ? '' : ' is-empty'));
      chip.appendChild(art('stoneIcon', [k, 34], 34));
      chip.appendChild(el('span', 'stone-n', String(n)));
      tipOn(chip, defs[k].name, esc(defs[k].description || '') +
        '<br><i>Você tem ' + n + '.</i>', elemColor(defs[k].element));
      wrap.appendChild(chip);
    }
    return any ? wrap : el('div', 'stones-strip is-hidden');
  }

  // ==========================================================================
  // TELA: MENU
  // ==========================================================================
  function buildMenu() {
    var s = screens.menu;
    clear(s);
    var box = el('div', 'menu-box');
    box.appendChild(el('h1', 'game-title', 'SOTERRA'));
    box.appendChild(el('p', 'game-sub', 'Desça. O fundo tem dono.'));

    var acts = el('div', 'menu-acts');
    acts.appendChild(btn('Descer', 'btn-primary btn-big', function () { navTo('heroSelect'); }));
    // O GAME MASTER (31/08): o botão só EXISTE com a chave do dono virada
    if (JOGO.GM && JOGO.GM.ativo && JOGO.GM.ativo()) {
      acts.appendChild(btn('⚔ Painel do Mestre', 'btn-gold btn-big', function () {
        openSheet('gm');
      }));
    }
    // [25/08] o menu único "Personagens" foi dividido a pedido: cada ficha
    // tem porta própria — aqui numa fileira compacta, no Acampamento o cais.
    var fichas = el('div', 'menu-fichas');
    PARTY_TABS.forEach(function (t) {
      fichas.appendChild(btn(t.nome, 'btn-mini btn-ghost', function () { sheetParty(t.id); }));
    });
    acts.appendChild(fichas);
    // o Banco de Contas (25/08): qual conta ESTA janela é, e a porta para
    // trocar/criar — duas janelas com contas diferentes = dois jogadores
    var rotuloConta = safe(function () { return JOGO.Contas.rotulo(); }, null);
    if (rotuloConta) {
      acts.appendChild(btn('Conta: <b>' + esc(rotuloConta) + '</b>', 'btn-mini btn-ghost',
        function () { openSheet('contas'); }));
    }
    box.appendChild(acts);
    box.appendChild(stonesStrip());

    // resumo do cofre: quantas classes liberadas, quantas estrelas somadas
    var ids = Object.keys(classes());
    var libs = 0, stars = 0;
    ids.forEach(function (c) { var i = cardInfo(c); if (i.unlocked) libs++; stars += i.stars; });
    if (ids.length) {
      box.appendChild(el('p', 'menu-foot',
        libs + ' de ' + ids.length + ' classes liberadas · ' + stars + ' estrelas'));
    }
    s.appendChild(box);
  }

  // ==========================================================================
  // TELA: ESCOLHA DE HERÓIS (1 ou 2) — §9-B
  // ==========================================================================
  function buildHeroSelect() {
    var s = screens.heroSelect;
    clear(s);
    // A CONTA DO MESTRE já vem com o Mestre escolhido como avatar (03/09)
    if (!selHeroes.length && JOGO.GM && JOGO.GM.contaMestre &&
        safe(function () { return JOGO.GM.contaMestre(); }, false) && hero('gm')) selHeroes = ['gm'];
    s.appendChild(header('Quem desce',
      'Escolha 1 ou 2 heróis — o PRIMEIRO é o seu avatar e anda no Acampamento. ' +
      'Sozinho, a sorte de saque é máxima.', 'menu'));

    var body = el('div', 'ui-body');
    var luck = el('div', 'luck-panel');
    body.appendChild(luck);

    var grid = el('div', 'hero-grid');
    body.appendChild(grid);
    s.appendChild(body);

    var foot = el('footer', 'ui-foot');
    var cnt = el('span', 'foot-count', '');
    var go = btn('Confirmar', 'btn-primary', function () {
      if (!selHeroes.length) { toast('Escolha ao menos um herói.'); return; }
      navTo('hub');
    });
    foot.appendChild(cnt);
    foot.appendChild(go);
    s.appendChild(foot);

    function paintFoot() {
      var n = selHeroes.length;
      cnt.innerHTML = n === 0 ? 'Nenhum escolhido'
        : n === 1 ? '<b>1 herói</b> · sorte de saque <b class="luck-hi">máxima</b>'
                  : '<b>2 heróis</b> · sorte <b class="luck-mid">média</b>, mas podem <b>fundir</b>';
      go.classList.toggle('is-off', n === 0);
      paintLuck(luck, n);
    }

    var ids = Object.keys(classes());
    if (!ids.length) ids = heroIds();
    ids.forEach(function (cid) { grid.appendChild(heroCard(cid, paintFoot)); });
    paintFoot();
  }

  // medidor de Sorte de Saque em DOIS estados (solo = máxima, dupla = média)
  function paintLuck(box, n) {
    clear(box);
    var lk = LUCK[n] || 0;
    box.appendChild(el('div', 'luck-title', 'Sorte de Saque'));
    var track = el('div', 'luck-track');
    var mSolo = el('div', 'luck-mark m-solo' + (n === 1 ? ' is-on' : ''), '<b>Sozinho</b><span>×2,4</span>');
    var mDupla = el('div', 'luck-mark m-dupla' + (n === 2 ? ' is-on' : ''), '<b>Dupla</b><span>×1,6</span>');
    var fill = el('div', 'luck-fill');
    fill.style.width = (n === 1 ? 100 : n === 2 ? 58 : 0) + '%';
    track.appendChild(fill);
    box.appendChild(track);
    var marks = el('div', 'luck-marks');
    marks.appendChild(mDupla);
    marks.appendChild(mSolo);
    box.appendChild(marks);
    box.appendChild(el('div', 'luck-note', n === 1
      ? 'Item raro e épico caem muito mais. Você luta sem rede.'
      : n === 2 ? 'Menos saque, mais ação: dois turnos por rodada e a fusão na manga.'
                : 'Escolha os heróis para ver a sorte.'));
    if (lk) box.style.setProperty('--luck', String(lk));
  }

  function heroCard(cid, onChange) {
    var def = classDef(cid) || {};
    var info = cardInfo(cid);
    var unlocked = info.unlocked;
    var h = unlocked ? hero(cid) : null;
    var card = el('div', 'hero-card' + (unlocked ? '' : ' is-locked'));
    var idx = selHeroes.indexOf(cid);
    if (idx >= 0) card.classList.add('is-sel');

    var pic = el('div', 'hero-pic');
    if (unlocked) {
      pic.appendChild(art('unit', [cid, { element: (h && h.element) || 'neutro', dir: 0, scale: 0.62 }], 100));
    } else {
      var sil = art('unit', [cid, { element: 'neutro', dir: 0, scale: 0.62 }], 100, 'silhouette');
      pic.appendChild(sil);
      pic.appendChild(el('div', 'lock-badge', '🔒'));
    }
    card.appendChild(pic);

    var name = el('div', 'hero-name', esc(def.name || cid));
    card.appendChild(name);
    card.appendChild(el('div', 'hero-role', esc(def.role || '')));

    if (unlocked && h) {
      var xi = xpInfo(cid);
      var st = effStats(cid) || def.stats || {};
      var row = el('div', 'hero-lv');
      row.appendChild(el('span', 'lv-badge', 'Nv ' + (h.level || 1)));
      var eb = el('span', 'elem-badge e-' + (h.element || 'neutro'), ELEM_PT[h.element] || 'Neutro');
      eb.style.setProperty('--ec', elemColor(h.element || 'neutro'));
      row.appendChild(eb);
      if (info.stars) row.appendChild(starRow(info.stars, 13));
      card.appendChild(row);
      card.appendChild(bar('bar-xp', xi ? xi.pct : 0, xi && xi.xpNext ? 'XP ' + xi.xp + '/' + xi.xpNext : 'nível máximo'));
      card.appendChild(el('div', 'hero-stats',
        '<span class="s-hp">' + (st.hp || 0) + ' PV</span>' +
        '<span class="s-pa">' + (st.pa || 0) + ' PA</span>' +
        '<span class="s-pp">' + (st.pp || 0) + ' PP</span>'));
      var acts = el('div', 'hero-acts');
      acts.appendChild(btn('Ficha', 'btn-mini', function () { openSheet('heroSheet', cid); }));
      var pick = btn(idx === 0 ? '① Avatar' : idx > 0 ? '② Escolhido' : 'Escolher',
                     'btn-mini ' + (idx >= 0 ? 'btn-primary' : ''), function () {
        var i = selHeroes.indexOf(cid);
        if (i >= 0) selHeroes.splice(i, 1);
        else if (selHeroes.length >= 2) { toast('O grupo é de no máximo 2 heróis.'); return; }
        else selHeroes.push(cid);
        buildHeroSelect();
      });
      acts.appendChild(pick);
      card.appendChild(acts);
    } else {
      // trancada: mostra o progresso de cartas
      var pct = info.unlockCost ? Math.min(1, info.cards / info.unlockCost) : 0;
      card.appendChild(bar('bar-card', pct, info.cards + ' / ' + info.unlockCost + ' cartas'));
      card.appendChild(el('div', 'hero-locked-note',
        'Cartas caem dos chefes. Faltam <b>' + Math.max(0, info.unlockCost - info.cards) + '</b>.'));
      var see = btn('Ver na Coleção', 'btn-mini', function () { openSheet('collection', cid); });
      card.appendChild(see);
    }
    return card;
  }

  function starRow(n, size) {
    var max = starsCfg().max || 5;
    var w = el('span', 'star-row');
    for (var i = 0; i < max; i++) w.appendChild(art('starIcon', [i < n, size || 14], size || 14));
    return w;
  }

  // ==========================================================================
  // TELA: ESCOLHA DE CALABOUÇO
  // ==========================================================================
  function buildDungeonSelect() {
    var s = screens.dungeonSelect;
    clear(s);
    var who = selHeroes.map(className).join(' e ') || '—';
    s.appendChild(header('Onde descer', 'Grupo: ' + esc(who), 'heroSelect'));
    var body = el('div', 'ui-body');
    var selDif = seletorDif();
    if (selDif) body.appendChild(selDif);
    var list = el('div', 'dg-list');
    body.appendChild(list);
    s.appendChild(body);

    var ds = dungeons();
    if (!ds.length) { list.appendChild(el('p', 'empty', 'Nenhum calabouço carregado.')); return; }
    ds.forEach(function (dg) {
      var card = el('div', 'dg-card');
      var ban = el('div', 'dg-banner');
      // faixa do tema montada com as próprias texturas do jogo
      var strip = el('div', 'dg-strip');
      for (var i = 0; i < 5; i++) strip.appendChild(art('tile', [dg.theme || dg.id, i], 62));
      ban.appendChild(strip);
      var props = el('div', 'dg-props');
      props.appendChild(art('obstacleHigh', [dg.theme || dg.id], 76));
      props.appendChild(art('prop', [dg.theme || dg.id, null], 62));
      props.appendChild(art('obstacleLow', [dg.theme || dg.id], 68));
      ban.appendChild(props);
      card.appendChild(ban);

      var txt = el('div', 'dg-txt');
      txt.appendChild(el('h2', null, esc(dg.name || dg.id)));
      var meta = el('div', 'dg-meta');
      meta.appendChild(el('span', 'chip chip-diff',
        esc(DIFF_PT[Math.max(0, Math.min(5, (dg.order || 0)))] || 'Média')));
      if (dg.defaultWeather) {
        var wd = (D().weathers && D().weathers[dg.defaultWeather]) || null;
        meta.appendChild(el('span', 'chip', esc((wd && wd.name) || dg.defaultWeather)));
      }
      meta.appendChild(el('span', 'chip', (dg.rooms ? dg.rooms.length : 3) + ' salas'));
      txt.appendChild(meta);
      txt.appendChild(el('p', 'dg-desc', esc(dg.description || '')));

      // chefe do fim
      var boss = null, last = dg.rooms && dg.rooms[dg.rooms.length - 1];
      if (last && last.monsters) {
        for (var k in last.monsters) {
          var md = D().monsters && D().monsters[last.monsters[k]];
          if (md && md.boss) { boss = md; break; }
        }
      }
      if (boss) {
        var brow = el('div', 'dg-boss');
        brow.appendChild(art('portrait', [boss.id || '', { element: boss.element, size: 44 }], 40, 'boss-face'));
        brow.appendChild(el('span', null, '<i>Chefe</i><b>' + esc(boss.name) + '</b>'));
        txt.appendChild(brow);
      }
      txt.appendChild(btn('Descer aqui', 'btn-primary btn-block', function () {
        var ok = safe(function () { return G().startRun(selHeroes.slice(), dg.id); }, false);
        if (!ok) toast('Não deu para começar essa descida.');
      }));
      card.appendChild(txt);
      list.appendChild(card);
    });
  }

  // ==========================================================================
  // TELA: ESCOLHA DE ELEMENTO (nível 5) — a tela que explica por que importa
  // ==========================================================================
  function buildElementChoice(data) {
    var s = screens.elementChoice;
    clear(s);
    var pend = (data && data.heroIds) || safe(function () { return G().elementChoices(); }, []);
    if (!pend.length) { s.appendChild(el('p', 'empty', 'Ninguém para escolher agora.')); return; }
    var hid = elemChoiceHero && pend.indexOf(elemChoiceHero) >= 0 ? elemChoiceHero : pend[0];
    elemChoiceHero = hid;
    var h = hero(hid) || {};
    var def = classDef(h.classId || hid) || {};

    s.appendChild(header('Escolha o caminho', esc(className(h.classId || hid)) +
      ' chegou ao nível 5. <b>A escolha é para sempre.</b>'));

    var body = el('div', 'ui-body');
    if (pend.length > 1) {
      var tabs = el('div', 'ec-tabs');
      pend.forEach(function (p) {
        var t = btn(className((hero(p) || {}).classId || p), 'btn-tab' + (p === hid ? ' is-on' : ''), function () {
          elemChoiceHero = p; buildElementChoice(data);
        });
        tabs.appendChild(t);
      });
      body.appendChild(tabs);
    }

    var grid = el('div', 'ec-grid');
    var elems = (D().elements || ['neutro', 'fogo', 'agua', 'terra', 'ar'])
      .filter(function (e) { return e !== 'neutro'; });
    elems.forEach(function (e) {
      var path = (def.paths && def.paths[e]) || [];
      var col = elemColor(e);
      var card = el('div', 'ec-card e-' + e);
      card.style.setProperty('--ec', col);

      var top = el('div', 'ec-top');
      top.appendChild(art('unit', [h.classId || hid, { element: e, dir: 0, scale: 0.55 }], 88));
      var ti = el('div', 'ec-title');
      ti.appendChild(el('h3', null, ELEM_PT[e] || e));
      ti.appendChild(el('p', 'ec-gain', perLevelText(e)));
      top.appendChild(ti);
      card.appendChild(top);

      var sp = el('div', 'ec-spells');
      var tiers = D().unlockTiers || [5, 10, 12, 15, 20, 30];
      path.forEach(function (sid, i) {
        var d2 = spellDef(sid);
        var row = el('div', 'ec-spell');
        row.appendChild(art('spellIcon', [d2 || sid, 34], 34));
        var info = el('div', 'ec-spell-txt');
        info.appendChild(el('b', null, esc(spellName(d2, sid))));
        info.appendChild(el('i', null, 'Nv ' + ((d2 && d2.unlockLevel) || tiers[i] || '?') +
          ((d2 && d2.paCost != null) ? ' · ' + d2.paCost + ' PA' : '')));
        row.appendChild(info);
        if (d2 && d2.description) tipOn(row, d2.name, esc(d2.description), col);
        sp.appendChild(row);
      });
      if (!path.length) sp.appendChild(el('p', 'empty', 'Caminho ainda não escrito.'));
      card.appendChild(sp);

      card.appendChild(btn('Seguir ' + (ELEM_PT[e] || e), 'btn-primary btn-block', function () {
        confirmSheet('Seguir o caminho de ' + (ELEM_PT[e] || e) + '?',
          'É <b>irreversível</b>. A partir daqui, cada nível dá +5 PV e +3 de dano de ' +
          (ELEM_PT[e] || e) + ' — e os feitiços acima vão abrindo com o nível.',
          function () {
            var ok = safe(function () { return G().chooseElement(hid, e); }, false);
            if (!ok) ok = safe(function () { return P().chooseElement(hid, e); }, false);
            if (!ok) { toast('Não deu para escolher agora.'); return; }
            elemChoiceHero = null;
            var rest = safe(function () { return G().elementChoices(); }, []);
            if (rest.length) buildElementChoice({ heroIds: rest });
            else if (current === 'elementChoice') UI.showScreen('menu');
          });
      }));
      grid.appendChild(card);
    });
    body.appendChild(grid);
    s.appendChild(body);
  }

  // ==========================================================================
  // TELAS: RECOMPENSA E DERROTA
  // ==========================================================================
  /* O ACAMPAMENTO — a tela do mapa aberto.
   *
   * O 3D é do JOGO.Hub; aqui mora só a camada de interface: a barra com nome e
   * vinténs, o pedido de nome na primeira visita, e o painel que aparece quando
   * o herói se APROXIMA de um lugar. A regra do painel é a do mundo: nada abre
   * por menu — o corpo anda até o portal, e a porta aparece quando se chega.
   */
  function buildHub(sala) {
    var s = sala ? screens.antessala : screens.hub;
    clear(s);
    var chaveSala = sala ? (sala.dungeonId + ':' + sala.roomIndex) : null;
    function perguntaSair() {
      confirmSheet('Sair do calabouço?',
        'O que você já limpou não fica guardado — a próxima descida começa da primeira sala.',
        function () {
          safe(function () { return G().abandonar(); }, false);
          navTo('hub');
        });
    }

    var top = el('div', 'hub-top');
    var quem = el('div', 'hub-quem');
    var nomeEl = el('span', 'hub-nome', '…');
    var moedasEl = el('span', 'hub-moedas', '');
    quem.appendChild(nomeEl);
    quem.appendChild(moedasEl);
    top.appendChild(quem);
    var acts = el('div', 'hub-acts');
    if (sala) {
      // a placa da sala no lugar do Menu: daqui só se sai pela saída do
      // pátio ou por este botão — sempre com a pergunta
      quem.appendChild(el('span', 'hub-sala-tag', esc(sala.calabouco || '') + ' · sala ' +
        (sala.roomIndex + 1) + '/' + (sala.total || '?') + ' — ' + esc(sala.nome || '')));
      acts.appendChild(btn('Sair do calabouço', 'btn-mini btn-ghost', perguntaSair));
    } else {
      acts.appendChild(btn('Menu', 'btn-mini btn-ghost', function () { navTo('menu'); }));
    }
    top.appendChild(acts);
    s.appendChild(top);

    var mundo = el('div', 'hub-mundo');
    s.appendChild(mundo);

    var painel = el('div', 'hub-painel is-off');
    s.appendChild(painel);

    /* O CAIS (pedido do usuário, 25/08): "queria dividir o menu… pode ser um
     * menu inferior centralizado". Cada ficha com porta própria, sempre à
     * mão, à moda MMORPG — e as Missões, que moravam soltas no topo, descem
     * para cá. O painel de aproximação mora um degrau acima para não taparem
     * um ao outro (css .hub-painel). */
    var dock = el('div', 'hub-dock');
    // o cais agora ACENDE a aba aberta (30/08): sem isso, no celular o menu
    // principal não dizia onde o jogador estava
    dockBotoes = {};
    [{ ic: '🎒', rot: 'Inventário', tecla: 'I', abre: 'inventory' },
     { ic: '🔨', rot: 'Forja', abre: 'forge' },
     { ic: '📖', rot: 'Feitiços', abre: 'spells' },
     { ic: '🃏', rot: 'Coleção', abre: 'collection' },
     { ic: '🎭', rot: 'Avatar', abre: 'avatar' },
     { ic: '📜', rot: 'Missões', abre: 'missoes' }
    ].forEach(function (d) {
      var b = el('button', 'hub-dock-b');
      b.type = 'button';
      b.appendChild(el('span', 'hd-ic', d.ic));
      b.appendChild(el('span', 'hd-rot', d.rot +
        (d.tecla ? ' <span class="tecla">' + d.tecla + '</span>' : '')));
      tap(b, function () { openSheet(d.abre); });
      dock.appendChild(b);
      dockBotoes[d.abre] = b;
    });
    s.appendChild(dock);

    function pintaConta() {
      if (!JOGO.DB) { nomeEl.textContent = ''; return; }
      Promise.all([JOGO.DB.jogador(),
                   JOGO.DB.brasaVer ? JOGO.DB.brasaVer() : Promise.resolve(null),
                   JOGO.DB.placarLista ? JOGO.DB.placarLista() : Promise.resolve([])])
        .then(function (rj) {
        var j = rj[0], brasa = rj[1], fotos = rj[2] || [];
        // o TOPO da arena calculado AQUI, na hora — sozinho na praca = topo.
        // Antes ele vinha do cache da ficha do placar, que so enchia ao
        // VISITAR o placar: a Coroa caia em Labareda e "so tinha 1 efeito".
        if (brasa) {
          var maiorVizinho = -1;
          fotos.forEach(function (f2) {
            if (f2.id === j.id) return;
            if (f2.resumo && typeof f2.resumo.brasa === 'number' &&
                f2.resumo.brasa > maiorVizinho) maiorVizinho = f2.resumo.brasa;
          });
          topoArenaCache = { souEu: brasa.pts >= maiorVizinho };
        }
        /* A VIRADA DE TEMPORADA (25/08), aplicada na entrada da praça: conta
         * de antes das temporadas ganha só o carimbo (sem punir); virada de
         * verdade comprime os pontos e manda a coroa para a GALERIA. */
        if (brasa && JOGO.Brasa && JOGO.Brasa.temporadaDe && JOGO.DB.brasaVirar) {
          var tempAtual = JOGO.Brasa.temporadaDe(Date.now());
          if (brasa.temporada !== tempAtual) {
            var soCarimbo = (brasa.temporada == null);
            var tierAntes = JOGO.Brasa.tierDe(brasa.pts, souTopoDaArena());
            JOGO.DB.brasaVirar({
              temporada: tempAtual,
              pts: soCarimbo ? brasa.pts : JOGO.Brasa.comprime(brasa.pts),
              galeriaDe: soCarimbo ? null : brasa.temporada,
              nivel: (!soCarimbo && brasa.partidas > 0 && tierAntes) ? tierAntes.nivel : null
            }).then(function (rv) {
              if (rv && rv.virou && !soCarimbo) {
                toast('Nova temporada da arena! A coroa foi para a galeria e os pontos comprimiram.', 'good');
              }
              pintaConta();
            });
            return;                       // repinta com a temporada carimbada
          }
        }
        if (!j.nome) { nomeEl.textContent = '—'; pedeNome(); }
        else nomeEl.textContent = j.nome;
        // O AVATAR: a conta pode vestir uma fusão do guarda-roupa — o
        // re-entrar troca o corpo (e o guarda do laço segura o rAF único)
        if (j.avatar && JOGO.Hub && JOGO.Hub.entrar) {
          JOGO.Hub.entrar(mundo, j.avatar);
        }
        // a plaquinha: nome, título — e a CHAMA DA BRASA. A Fagulha é uma
        // faísca de vagalume, mas SÓ para quem já pisou na arena: quem nunca
        // lutou segue sem fogo nenhum — a ausência também diz algo.
        var tier = null;
        if (brasa && JOGO.Brasa) {
          tier = JOGO.Brasa.tierDe(brasa.pts, souTopoDaArena());
          if (tier && tier.min === 0 && !(brasa.partidas > 0)) tier = null;
        }
        if (JOGO.Hub && JOGO.Hub.nomeia) {
          // o 4º arg é a GUILDA: a placa com emblema+nome acima do jogador.
          // `resumoGuilda` pode ainda não ter carregado (corrida com o
          // carregamento da guilda) — aí vai null e o refresco de quem
          // funda/entra chama nomeia de novo só com a guilda.
          JOGO.Hub.nomeia(j.nome || '', j.titulo || '', tier, resumoGuilda);
        }
        // A AURA do Traje do Colecionador fechado (25/08)
        if (JOGO.Hub && JOGO.Hub.aura) JOGO.Hub.aura(safe(temAuraSelos, false));
      });
      JOGO.DB.moedas().then(function (m) {
        // a moeda desenhada antes do número (arte do dono, 03/09)
        clear(moedasEl);
        moedasEl.appendChild(art('vintemIcon', [16], 16, 'moeda-inline'));
        moedasEl.appendChild(document.createTextNode(m + (m === 1 ? ' vintém' : ' vinténs')));
      });
    }

    /* O NOME, pedido UMA vez. É a primeira peça de identidade pública — chat,
     * troca e PvP vão usá-lo — e pedir na entrada do acampamento (e não num
     * formulário de opções) é o que dá o cheiro de jogo online. */
    function pedeNome() {
      clear(painel);
      painel.classList.remove('is-off');
      painel.appendChild(el('h3', null, 'Como te chamam no fundo?'));
      var inp = document.createElement('input');
      inp.className = 'hub-input';
      inp.maxLength = 24;
      inp.placeholder = 'seu nome no acampamento';
      painel.appendChild(inp);
      painel.appendChild(btn('É assim que me chamam', 'btn-primary btn-block', function () {
        JOGO.DB.batizar(inp.value).then(function (r) {
          if (!r.ok) { toast('Diz um nome.'); return; }
          painel.classList.add('is-off');
          pintaConta();
        });
      }));
      setTimeout(function () { try { inp.focus(); } catch (e) {} }, 60);
    }

    if (JOGO.Hub) JOGO.Hub.aoAproximar = function (lugar) {
      if (!lugar) { painel.classList.add('is-off'); return; }
      clear(painel);
      painel.classList.remove('is-off');
      if (lugar.tipo === 'portal') {
        painel.appendChild(el('h3', null, esc(lugar.nome)));
        // O CALABOUÇO DO DIA (25/08): o portal em promoção se anuncia
        if (JOGO.Diario && JOGO.Diario.ehHoje && JOGO.Diario.ehHoje(lugar.id)) {
          painel.appendChild(el('p', 'hub-dia',
            '☀ <b>Calabouço do dia</b> — +50% de saque até a meia-noite'));
        }
        var sd = seletorDif();
        if (sd) painel.appendChild(sd);
        painel.appendChild(btn('Descer', 'btn-primary btn-block', function () {
          var ok = safe(function () { return G().startRun(selHeroes.slice(), lugar.id); }, false);
          if (!ok) toast('Não deu para começar essa descida.');
        }));
      } else if (lugar.tipo === 'porta') {
        // A PORTA DA SALA (03/09): "seguir para a batalha (que mostrará os
        // monstros ao confirmar)" — quem espera, a dificuldade, e a entrada
        painel.appendChild(el('h3', null, esc((sala && sala.nome) || 'A sala')));
        var lista = el('div', 'sala-monstros');
        ((sala && sala.monstros) || []).forEach(function (m) {
          var c = el('div', 'sala-monstro' + (m.boss ? ' is-boss' : ''));
          c.appendChild(art('unit', [m.id, { element: m.element || 'neutro', dir: 0, scale: 0.5 }], 44));
          c.appendChild(el('span', null, esc(m.name) + (m.qtd > 1 ? ' ×' + m.qtd : '') +
            (m.boss ? ' — <b>chefe</b>' : '')));
          lista.appendChild(c);
        });
        if (!lista.childNodes.length) lista.appendChild(el('p', 'hub-nota', 'Ninguém à vista… ainda.'));
        painel.appendChild(lista);
        var sd2 = seletorDif();
        if (sd2) painel.appendChild(sd2);
        painel.appendChild(btn('Entrar na batalha', 'btn-primary btn-block', function () {
          if (!safe(function () { return G().entrarNaSala(); }, false)) toast('Não deu para entrar na sala.');
        }));
      } else if (lugar.tipo === 'saida') {
        painel.appendChild(el('h3', null, 'Sair do calabouço'));
        painel.appendChild(el('p', 'hub-nota',
          'A descida se perde: da próxima vez você começa da primeira sala.'));
        painel.appendChild(btn('Sair', 'btn-warn btn-block', perguntaSair));
      } else if (lugar.tipo === 'banco') {
        painel.appendChild(el('h3', null, 'Banco do Acampamento'));
        painel.appendChild(el('p', 'hub-nota',
          'O que está no cofre não desce com você — e por isso nunca se perde.'));
        painel.appendChild(btn('Abrir o cofre', 'btn-primary btn-block', function () {
          openSheet('banco');
        }));
      } else if (lugar.tipo === 'mercado') {
        painel.appendChild(el('h3', null, 'Mercadinho do Acampamento'));
        painel.appendChild(el('p', 'hub-nota',
          'Peças à venda — as suas e as do mercador. Toda venda sua paga 5% de taxa.'));
        painel.appendChild(btn('Abrir o balcão', 'btn-primary btn-block', function () {
          openSheet('mercado');
        }));
      } else if (lugar.tipo === 'arena') {
        painel.appendChild(el('h3', null, 'Arena de Duelos'));
        painel.appendChild(el('p', 'hub-nota',
          'Ainda selada. Os duelos chegam com a Rede: cada um escolhe a própria ' +
          'dupla sem ver a do outro, e o clima da arena é sorteado.'));
        painel.appendChild(btn('Duelo de treino (mesmo teclado)', 'btn-primary btn-block', function () {
          openSheet('duelo');
        }));
        // O POÇO SEM FUNDO (25/08): a torre infinita mora na arena
        painel.appendChild(btn('Descer ao Poço sem Fundo', 'btn-warn btn-block', function () {
          if (!selHeroes.length) { toast('Escolha sua dupla primeiro.'); return; }
          if (!safe(function () { return G().startPoco(selHeroes.slice()); }, false)) {
            toast('O Poço não abriu.');
          }
        }));
        painel.appendChild(btn('Ver o Placar', 'btn-ghost btn-block', function () {
          openSheet('placar');
        }));
        if (JOGO.DB.pocoVer) JOGO.DB.pocoVer().then(function (pv) {
          if (pv && (pv.recorde > 0 || pv.semanaMelhor > 0)) {
            painel.appendChild(el('p', 'hub-nota', 'Poço: andar <b>' + pv.semanaMelhor +
              '</b> na semana · recorde <b>' + pv.recorde + '</b>.'));
          }
        });
        if (JOGO.DB) JOGO.DB.historicoPvp().then(function (h) {
          painel.appendChild(el('p', 'hub-nota', h.length + ' duelo(s) na conta.'));
        });
      } else if (lugar.tipo === 'sede') {
        painel.appendChild(el('h3', null, 'Sede das Guildas'));
        painel.appendChild(el('p', 'hub-nota',
          'O estandarte dos clãs. A casa própria de cada guilda vem com o lobby — por ora, a ficha resolve tudo.'));
        painel.appendChild(btn('Abrir a ficha da guilda', 'btn-primary btn-block', function () {
          openSheet('guilda');
        }));
      } else if (lugar.tipo === 'forja') {
        // A BARRACA DO FERREIRO (30/08): a forja ganhou endereço na praça —
        // a bigorna continua no cais para quem prefere o atalho
        painel.appendChild(el('h3', null, 'Forja do Acampamento'));
        painel.appendChild(el('p', 'hub-nota',
          'Ponha a peça na bancada, a pedra do elemento ao lado — e bata o martelo.'));
        painel.appendChild(btn('Chegar na bancada', 'btn-primary btn-block', function () {
          openSheet('forge');
        }));
      }
    };

    var entrou = JOGO.Hub && JOGO.Hub.entrar(mundo, selHeroes[0] || 'sumo',
      sala ? { sala: { dungeonId: sala.dungeonId, roomIndex: sala.roomIndex,
                       tema: sala.tema || null, nome: sala.nome || '' } } : null);

    /* A REDE GANHA CORPO: entrar no Acampamento liga a presença (perfil do
     * DB), os eventos da Rede viram fantasmas de corpo inteiro, e quem já
     * estava é reconstruído de pares() — voltar da batalha não apaga
     * ninguém. O chat mora no canto: Enter fala, as últimas oito linhas
     * ficam. Em file:// a Rede é no-op e nada disto aparece. */
    var chatLog = null;
    function chatLinha(quem, texto, cor) {
      if (!chatLog) return;
      var li = el('div', 'hub-chat-linha');
      li.innerHTML = (quem ? '<b style="color:' + (cor || '#e8c25a') + '">' +
        esc(quem) + ':</b> ' : '') + esc(texto);
      chatLog.appendChild(li);
      while (chatLog.children.length > 8) chatLog.removeChild(chatLog.firstChild);
      chatLog.scrollTop = chatLog.scrollHeight;
    }
    if (JOGO.Rede && entrou) {
      var R = JOGO.Rede;
      if (JOGO.DB.brasaVer) {
        JOGO.DB.brasaVer().then(function (bz) {
          if (bz) {
            resumoBrasaPts = bz.pts;
            resumoBrasaPartidas = bz.partidas || 0;
            resumoGaleria = bz.galeria || null;
          }
        });
      }
      if (JOGO.DB.pocoVer) {
        JOGO.DB.pocoVer().then(function (pv) { resumoPoco = pv || null; });
      }
      if (JOGO.Guilda) {
        JOGO.DB.jogador().then(function (j2) {
          JOGO.Guilda.contaAtiva(j2.id, j2.nome || 'Sem Nome');
          return JOGO.Guilda.minha();
        }).then(function (mg) {
          resumoGuilda = mg ? { nome: mg.nome, emblema: mg.emblema } : null;
          // a plaquinha pode ter sido pendurada ANTES desta resposta — a
          // corrida de sempre. Os undefined preservam nome/título/coroa.
          if (resumoGuilda && JOGO.Hub && JOGO.Hub.nomeia) {
            try { JOGO.Hub.nomeia(undefined, undefined, undefined, resumoGuilda); } catch (e) {}
          }
        });
      }
      JOGO.DB.jogador().then(function (j) {
        var e0 = (JOGO.Hub._estado && JOGO.Hub._estado()) || {};
        var pos = e0.pos || { x: 0, z: 9 };
        // `classe` no protocolo sempre foi APARÊNCIA — agora pode ser uma
        // fusão do guarda-roupa; o fantasma do outro lado veste igual
        var ligou = R.entrar({ id: j.id, nome: j.nome || 'Sem Nome',
                               titulo: j.titulo || '',
                               classe: j.avatar || selHeroes[0] || 'sumo',
                               resumo: safe(resumoDaConta, null),
                               aura: safe(temAuraSelos, false),
                               sala: chaveSala,          // 03/09: a antessala (null = praça)
                               x: pos.x, z: pos.z });
        if (!ligou) return;                    // file://: o jogo segue solo

        JOGO.Hub.aoAndar = function (x, z) { R.mover(x, z); };
        /* O ENCONTRO (25/08): tocar num fantasma abre o painel da pessoa —
         * perfil, troca e silêncio — em vez de disparar convite direto. */
        var mutados = {};
        if (JOGO.DB.mutados) {
          JOGO.DB.mutados().then(function (lst) {
            (lst || []).forEach(function (m) { mutados[m.id] = true; });
          });
        }
        JOGO.Hub.aoTocarFantasma = function (id) {
          var par = null;
          R.pares().forEach(function (p2) { if (p2.id === id) par = p2; });
          if (!par) return;
          clear(painel);
          painel.classList.remove('is-off');
          painel.appendChild(el('h3', null, esc(par.nome) +
            (par.titulo ? ' <i class="hub-tit">' + esc(par.titulo) + '</i>' : '')));
          painel.appendChild(btn('Ver perfil', 'btn-primary btn-block', function () {
            painel.classList.add('is-off');
            openSheet('perfil', par);
          }));
          if (JOGO.Troca) {
            painel.appendChild(btn('Propor troca', 'btn-ghost btn-block', function () {
              painel.classList.add('is-off');
              if (JOGO.Troca.convidar(id)) {
                toast('Convite de troca enviado. Esperando o outro lado…');
                openSheet('troca');
              } else toast('já há uma troca aberta');
            }));
          }
          // CONVIDAR PARA A GUILDA (25/08): só o líder vê o botão
          if (JOGO.Guilda) {
            JOGO.Guilda.minha().then(function (mg) {
              if (!mg || !mg.souLider || painel.classList.contains('is-off')) return;
              painel.insertBefore(btn('Convidar para a ' + mg.emblema + ' ' + esc(mg.nome),
                'btn-ghost btn-block', function () {
                  painel.classList.add('is-off');
                  R.guildaManda(id, 'convite', { gid: mg.id, nome: mg.nome, emblema: mg.emblema });
                  toast('Convite de guilda enviado.');
                }), painel.lastChild);
            });
          }
          var mudo = !!mutados[id];
          painel.appendChild(btn(mudo ? 'Devolver a voz no chat' : 'Silenciar no chat',
            'btn-ghost btn-block', function () {
              mutados[id] = !mudo;
              if (JOGO.DB.mutar) JOGO.DB.mutar(id, par.nome, !mudo);
              toast(!mudo ? par.nome + ' silenciado.' : par.nome + ' de volta ao chat.');
              painel.classList.add('is-off');
            }));
          painel.appendChild(btn('Fechar', 'btn-ghost btn-block', function () {
            painel.classList.add('is-off');
          }));
        };
        if (JOGO.Troca) {
          JOGO.Troca.aoConvite = function (c) {
            clear(painel);
            painel.classList.remove('is-off');
            painel.appendChild(el('h3', null, 'Troca'));
            painel.appendChild(el('p', 'hub-nota',
              esc(c.nome) + ' quer trocar com você.'));
            painel.appendChild(btn('Aceitar', 'btn-primary btn-block', function () {
              JOGO.Troca.responder(true);
              painel.classList.add('is-off');
              openSheet('troca');
            }));
            painel.appendChild(btn('Agora não', 'btn-ghost btn-block', function () {
              JOGO.Troca.responder(false);
              painel.classList.add('is-off');
            }));
          };
          JOGO.Troca.aoMudar = function (est) {
            if (sheetName === 'troca') sheetTroca();
            if (est && est.fase === 'feita') {
              closeSheet();
              toast(est.resultado === 'mesma-conta'
                ? 'Troca encerrada — mesma conta nas duas abas: nada se move. Entre contas, tudo se move.'
                : 'Troca feita! O que veio já está no saco.', 'good');
            }
          };
        }

        R.aoEvento = function (ev) {
          if (ev.tipo === 'troca' && JOGO.Troca) {
            JOGO.Troca.aoEvento(ev);
            return;
          }
          // O CONVITE DE GUILDA (25/08): chega pela praça, decide-se no painel
          if (ev.tipo === 'guilda') {
            if (ev.acao === 'convite' && ev.dados && JOGO.Guilda) {
              clear(painel);
              painel.classList.remove('is-off');
              painel.appendChild(el('h3', null, 'Convite de guilda'));
              painel.appendChild(el('p', 'hub-nota', esc(ev.nome) + ' te chama para a <b>' +
                esc(ev.dados.emblema || '⚑') + ' ' + esc(ev.dados.nome || '?') + '</b>.'));
              painel.appendChild(btn('Aceitar', 'btn-primary btn-block', function () {
                JOGO.Guilda.entrar(ev.dados.gid).then(function (res) {
                  painel.classList.add('is-off');
                  toast(res.ok ? 'Bem-vindo à ' + ev.dados.nome + '!' : (res.erro || 'não deu'),
                        res.ok ? 'good' : undefined);
                  R.guildaManda(ev.de, 'resposta', { ok: !!res.ok });
                });
              }));
              painel.appendChild(btn('Agora não', 'btn-ghost btn-block', function () {
                painel.classList.add('is-off');
                R.guildaManda(ev.de, 'resposta', { ok: false });
              }));
            } else if (ev.acao === 'resposta') {
              toast(ev.dados && ev.dados.ok ? ev.nome + ' entrou na guilda!'
                                            : ev.nome + ' recusou o convite.');
            }
            return;
          }
          if (ev.tipo === 'entrou') {
            // só quem está NA MESMA SALA ganha corpo (03/09); os outros ficam
            // no papel, na lista da Rede
            if ((ev.sala || null) !== chaveSala) return;
            JOGO.Hub.fantasmaEntra(ev.id, ev);
            chatLinha(null, ev.nome + (chaveSala ? ' chegou à sala.' : ' chegou ao acampamento.'));
            // a foto do vizinho vai para o PLACAR — é assim que o ranking
            // local se enche: de todo mundo que já cruzou a praça
            if (ev.resumo && JOGO.DB.placarAnota) {
              JOGO.DB.placarAnota(ev.id, { nome: ev.nome, titulo: ev.titulo,
                                           resumo: ev.resumo });
            }
          } else if (ev.tipo === 'mudouSala') {
            // 03/09: desceu para outra sala (some) ou chegou à minha (aparece)
            if ((ev.sala || null) === chaveSala) {
              JOGO.Hub.fantasmaEntra(ev.id, ev);
              chatLinha(null, ev.nome + (chaveSala ? ' chegou à sala.' : ' voltou ao acampamento.'));
            } else {
              JOGO.Hub.fantasmaSai(ev.id);
            }
          } else if (ev.tipo === 'alvo') {
            JOGO.Hub.fantasmaAlvo(ev.id, ev.x, ev.z);
          } else if (ev.tipo === 'pulso') {
            JOGO.Hub.fantasmaPulso(ev.id, ev.x, ev.z);
          } else if (ev.tipo === 'chat') {
            if (mutados[ev.id]) return;               // silenciado: nem uma linha
            chatLinha(ev.nome, R.filtra ? R.filtra(ev.texto) : ev.texto);
          } else if (ev.tipo === 'saiu') {
            JOGO.Hub.fantasmaSai(ev.id);
          }
        };
        // quem ja estava na praca (ou nesta sala) antes de mim
        R.pares().forEach(function (par) {
          if ((par.sala || null) !== chaveSala) return;
          JOGO.Hub.fantasmaEntra(par.id, par);
        });

        // ---- o chat do canto
        var chat = el('div', 'hub-chat');
        chatLog = el('div', 'hub-chat-log');
        chat.appendChild(chatLog);
        var ci = document.createElement('input');
        ci.className = 'hub-chat-input';
        ci.maxLength = 240;
        ci.placeholder = 'diga algo… (Enter)';
        ci.addEventListener('keydown', function (evk) {
          if (evk.key === 'Enter') {
            var t = ci.value.trim();
            if (t && R.falar(t)) {
              chatLinha(j.nome || 'você', t, '#9bd06a');
              ci.value = '';
            }
          } else if (evk.key === 'Escape') { ci.blur(); }
          evk.stopPropagation();               // o i digitado aqui não abre o saco
        });
        chat.appendChild(ci);
        mundo.appendChild(chat);
      });
    }
    if (!entrou) mundo.appendChild(el('p', 'empty', 'O acampamento precisa do modo 3D.'));
    pintaConta();
  }

  function buildRewards(name, data) {
    var s = screens[name];
    clear(s);
    lastRewards = data || {};
    var fim = name === 'dungeonComplete';
    // no POÇO (25/08) a tela fala em andares — e ele nunca "completa"
    var noPoco = safe(function () { return G().dungeonId === 'poco'; }, false);
    var andarPoco = noPoco ? safe(function () { return G().roomIndex + 1; }, 0) : 0;
    s.appendChild(header(
      noPoco ? 'Andar ' + andarPoco + ' vencido' : (fim ? 'Calabouço vencido' : 'Sala limpa'),
      noPoco ? 'O Poço continua. Ele sempre continua.'
             : (fim ? 'O fundo desta descida está seu.' : 'Respire. A próxima é pior.')));

    var body = el('div', 'ui-body');
    var box = el('div', 'rw-box');

    box.appendChild(rwBlock('Experiência', (function () {
      var w = el('div', 'rw-xp');
      // A HUD anunciava `xpGanho` — que `game.js` documenta como o valor ANTES
      // do corte do §9-D. Dava para o painel dizer "+4 XP" e o herói receber
      // ZERO. Aqui manda o valor REAL; quando houve corte, o número cheio
      // aparece riscado ao lado e uma linha explica o porquê. É esse feedback
      // que ensina o jogador a descer mais fundo em vez de moer o calabouço 1.
      // `xpMult` e `xpPorHeroi` vêm INDEXADOS POR heroId (cada herói tem o seu
      // corte, porque depende do nível DELE contra o `recommendedLevel`).
      // Imprimir o objeto direto daria '[object Object]'.
      var bruto = lastRewards.xpGanho || 0;
      var mults = lastRewards.xpMult, reais = lastRewards.xpPorHeroi;
      function multDe(hid) {
        if (mults == null) return 1;
        if (typeof mults === 'number') return mults;             // formato simples
        var v = mults[hid];
        return (typeof v === 'number') ? v : 1;
      }
      function realDe(hid) {
        if (reais != null) {
          if (typeof reais === 'number') return reais;
          if (typeof reais[hid] === 'number') return reais[hid];
        }
        return Math.floor(bruto * multDe(hid));
      }
      function fmtMult(m) { return '×' + m.toFixed(2).replace('.', ','); }

      // nível recomendado do calabouço em que estamos
      var rec = null;
      (function () {
        var ds2 = dungeons(), gi;
        var did = safe(function () { return G().dungeonId; }, null);
        for (gi = 0; gi < ds2.length; gi++) {
          if (ds2[gi].id === did && ds2[gi].recommendedLevel != null) rec = ds2[gi].recommendedLevel;
        }
      })();

      var lista = (selHeroes.length ? selHeroes : heroIds()).filter(function (hid) { return !!hero(hid); });
      var valores = lista.map(realDe);
      var uniforme = valores.length > 0 && valores.every(function (v) { return v === valores[0]; });
      var algumCorte = lista.some(function (hid) { return multDe(hid) < 0.999; }) && bruto > 0;
      var noPiso = lista.some(function (hid) { return multDe(hid) <= 0.101; }) && bruto > 0;

      // número grande: só pode existir se TODOS receberam o mesmo, senão mente
      if (uniforme) {
        var n = el('div', 'rw-xp-n' + (algumCorte ? ' is-cut' : ''), '+' + valores[0] + ' XP');
        if (algumCorte) {
          n.appendChild(el('span', 'rw-xp-was', '+' + bruto));
          n.appendChild(el('span', 'rw-xp-mult', fmtMult(multDe(lista[0]))));
        }
        w.appendChild(n);
      } else {
        w.appendChild(el('div', 'rw-xp-n is-cut', 'XP por herói'));
      }

      if (algumCorte) {
        w.appendChild(el('div', 'rw-xp-why',
          'Conteúdo fácil demais para o seu nível' +
          (rec != null ? ' (recomendado: <b>' + rec + '</b>)' : '') + '.' +
          (noPiso ? ' <b>Desça um Fecho mais fundo</b> para a XP valer inteira.'
                  : ' Quanto mais fundo, mais a XP rende.')));
      }

      lista.forEach(function (hid) {
        var h = hero(hid);
        var xi = xpInfo(hid);
        var m = multDe(hid), ganho = realDe(hid), cortou = m < 0.999 && bruto > 0;
        var r = el('div', 'rw-hero');
        r.appendChild(art('portrait', [h.classId || hid, { element: h.element, size: 40 }], 36));
        var t = el('div', 'rw-hero-t');
        var lin = el('b', null, esc(className(h.classId || hid)) + ' — Nv ' + h.level);
        // o ganho REAL deste herói, ao lado do nome
        lin.appendChild(el('span', 'rw-hero-xp' + (cortou ? ' is-cut' : ''), '+' + ganho + ' XP'));
        if (cortou) {
          lin.appendChild(el('span', 'rw-xp-was', '+' + bruto));
          lin.appendChild(el('span', 'rw-xp-mult', fmtMult(m)));
        }
        t.appendChild(lin);
        t.appendChild(bar('bar-xp', xi ? xi.pct : 0, xi && xi.xpNext ? xi.xp + '/' + xi.xpNext : 'máximo'));
        r.appendChild(t);
        w.appendChild(r);
      });
      return w;
    })()));

    if ((lastRewards.levelUps || []).length) {
      box.appendChild(rwBlock('Subiu de nível', (function () {
        var w = el('div', 'rw-chips');
        lastRewards.levelUps.forEach(function (lu) {
          w.appendChild(el('span', 'chip chip-up',
            esc(className((hero(lu.heroId) || {}).classId || lu.heroId)) + ' → Nv ' + lu.novoNivel));
        });
        return w;
      })()));
    }

    var drops = lastRewards.drops || [];
    if (drops.length) {
    if (lastRewards.moedas > 0) {
      box.appendChild(rwBlock('Vinténs', (function () {
        var w = el('div', 'rw-moedas');
        if (lastRewards.desafio) {
          var dsf = lastRewards.desafio;
          w.appendChild(el('span',
            'rw-desafio' + (dsf.cumprido ? ' is-cumprido' : ''),
            dsf.cumprido ? '☆ ' + esc(dsf.nome) + ' cumprido · +25%'
                         : '☆ ' + esc(dsf.nome) + ' se perdeu'));
        }
        var g = lastRewards.moedas || 0;
        var ganhoM = el('span', 'rw-moedas-ganho', '+' + g + (g === 1 ? ' vintém' : ' vinténs'));
        ganhoM.insertBefore(art('vintemIcon', [18], 18, 'moeda-inline'), ganhoM.firstChild);
        w.appendChild(ganhoM);
        // o TOTAL vem do DB, assincrono — a tela nasce sem ele e preenche
        // quando a resposta chega, como fara quando o DB for um servidor
        var tot = el('span', 'rw-moedas-total', '…');
        if (JOGO.DB && JOGO.DB.moedas) {
          JOGO.DB.moedas().then(function (m) { tot.textContent = 'no bolso: ' + m; });
        } else tot.textContent = '';
        w.appendChild(tot);
        return w;
      })()));
    }

      box.appendChild(rwBlock('Saque', (function () {
        var w = el('div', 'rw-items');
        drops.forEach(function (d) {
          var id = (typeof d === 'string') ? d : (d.itemId || d.id);
          var it = itemDef(id);
          var cell = el('div', 'rw-item');
          cell.appendChild(art('itemIcon', [id, 52], 52));
          cell.appendChild(el('span', null, esc((it && it.name) || id)));
          if (it) {
            markRarity(cell, it.rarity);
            tipOn(cell, it.name, itemTipBody(id), rarColor(it.rarity));
          }
          w.appendChild(cell);
        });
        return w;
      })()));
    }

    // O SACO ENCHEU no meio da descida (25/08): o que ficou para trás é
    // dito com nome — perda calada viraria bug report, não regra de jogo.
    if (drops.perdidos && drops.perdidos.length) {
      box.appendChild(el('p', 'rw-perdidos', '⚠ O saco encheu — ficou para trás: <b>' +
        drops.perdidos.map(function (id) {
          var it2 = itemDef(id);
          return esc((it2 && it2.name) || id);
        }).join(', ') + '</b>. Guarde peças no cofre do banco antes de descer.'));
    }

    var stones = lastRewards.stones || {};
    var anyStone = false; for (var sk in stones) { if (stones.hasOwnProperty(sk)) anyStone = true; }
    if (anyStone) {
      box.appendChild(rwBlock('Pedras de forja', (function () {
        var w = el('div', 'rw-items');
        for (var sid in stones) {
          if (!stones.hasOwnProperty(sid)) continue;
          var sd = stoneDefs()[sid];
          var cell = el('div', 'rw-item');
          cell.appendChild(art('stoneIcon', [sid, 48], 48));
          cell.appendChild(el('span', null, '+' + stones[sid] + ' ' + esc((sd && sd.name) || sid)));
          w.appendChild(cell);
        }
        return w;
      })()));
    }

    // OS SELOS DE CHEFE (25/08): a moeda do Colecionador, um ❂ por elemento
    var selosG = lastRewards.selos || {};
    var algumSelo = false;
    for (var slk in selosG) { if (selosG.hasOwnProperty(slk)) algumSelo = true; }
    if (algumSelo) {
      box.appendChild(rwBlock('Selos de chefe', (function () {
        var w = el('div', 'rw-items');
        for (var se in selosG) {
          if (!selosG.hasOwnProperty(se)) continue;
          var cell = el('div', 'rw-item rw-selo');
          cell.style.setProperty('--ec', elemColor(se));
          cell.appendChild(art('seloIcon', [se, 30], 30, 'selo-moeda-img'));   // a arte do dono (03/09)
          cell.appendChild(el('span', null, '+' + selosG[se] + ' Selo de ' + (ELEM_PT[se] || se)));
          w.appendChild(cell);
        }
        return w;
      })()));
    }

    // A INSÍGNIA DE FUNDAÇÃO (30/08): a outra moeda de chefe — 10 fundam
    // uma guilda. Bloco irmão dos selos, com o saldo junto do ganho para o
    // jogador saber quanto falta sem abrir a ficha.
    var insigniasG = lastRewards.insignias || 0;
    if (insigniasG > 0) {
      box.appendChild(rwBlock('Insígnia de fundação', (function () {
        var w = el('div', 'rw-items');
        var cell = el('div', 'rw-item rw-selo');
        cell.style.setProperty('--ec', '#c9a227');
        cell.appendChild(art('insigniaIcon', [30], 30, 'selo-moeda-img'));   // a arte do dono (03/09)
        var saldo = 0;
        try { saldo = P().insigniasVer(); } catch (e) {}
        var meta = (JOGO.DATA && JOGO.DATA.insignias && JOGO.DATA.insignias.porGuilda) || 10;
        cell.appendChild(el('span', null, '+' + insigniasG + ' Insígnia — ' +
                            saldo + '/' + meta + ' para fundar uma guilda'));
        w.appendChild(cell);
        return w;
      })()));
    }

    var cards = lastRewards.cards || [];
    if (cards.length) {
      box.appendChild(rwBlock('Cartas de personagem', (function () {
        var w = el('div', 'rw-cards');
        cards.forEach(function (c) {
          var cell = el('div', 'rw-card');
          // A CARTA COM A CARA DO PERSONAGEM (30/08, pedido do dono): a
          // moldura de carta fica, o miolo é o retrato de corpo inteiro —
          // quem dropa a carta do Minotauro VÊ o Minotauro.
          var carta = el('div', 'rw-card-foto');
          carta.style.cssText = 'width:104px;height:146px;border:2px solid #c9a227;' +
            'border-radius:10px;background:linear-gradient(180deg,#1a2029,#0e1319);' +
            'display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative';
          carta.appendChild(art('unit', [c.classId, { element: 'neutro', dir: 0, scale: 0.62 }], 96));
          var nomeCarta = el('span', null, esc(className(c.classId)));
          nomeCarta.style.cssText = 'position:absolute;bottom:4px;left:0;right:0;text-align:center;' +
            'font-size:11px;color:#e8c25a;text-shadow:0 1px 3px #000;pointer-events:none';
          carta.appendChild(nomeCarta);
          cell.appendChild(carta);
          var t = el('div', 'rw-card-t');
          t.appendChild(el('b', null, '+' + (c.amount || 1) + ' ' + esc(c.name || className(c.classId))));
          var ci = cardInfo(c.classId);
          t.appendChild(el('span', null, ci.unlocked
            ? 'Liberada · ' + ci.cards + ' cartas'
            : ci.cards + ' / ' + ci.unlockCost + ' para liberar'));
          t.appendChild(starRow(ci.stars, 14));
          if (c.starUp) t.appendChild(el('span', 'rw-starup', '★ Nova estrela!'));
          cell.appendChild(t);
          w.appendChild(cell);
        });
        return w;
      })()));
    }

    // CARTAS DE BICHO (03/09): a carta com a cara do bicho, como a de classe
    var petCards = lastRewards.petCards || [];
    if (petCards.length) {
      box.appendChild(rwBlock('Cartas de bicho', (function () {
        var w = el('div', 'rw-cards');
        petCards.forEach(function (c) {
          var cell = el('div', 'rw-card');
          var carta = el('div', 'rw-card-foto');
          carta.style.cssText = 'width:104px;height:146px;border:2px solid #c9a227;' +
            'border-radius:10px;background:linear-gradient(180deg,#1a2029,#0e1319);' +
            'display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative';
          carta.appendChild(art('petIcon', [c.petId, 96], 96));
          var nomeCarta = el('span', null, esc(c.name || c.petId));
          nomeCarta.style.cssText = 'position:absolute;bottom:4px;left:0;right:0;text-align:center;' +
            'font-size:11px;color:#e8c25a;text-shadow:0 1px 3px #000;pointer-events:none';
          carta.appendChild(nomeCarta);
          cell.appendChild(carta);
          var t = el('div', 'rw-card-t');
          t.appendChild(el('b', null, '+' + (c.amount || 1) + ' ' + esc(c.name || c.petId)));
          var pci = petCardInfo(c.petId);
          t.appendChild(el('span', null, pci.unlocked
            ? 'É seu · ' + pci.cards + ' cartas'
            : pci.cards + ' / ' + pci.unlockCost + ' para o bicho'));
          t.appendChild(petStarRow(pci.stars, 14));
          if (c.starUp) t.appendChild(el('span', 'rw-starup', '★ Nova estrela!'));
          if (c.novoPet) t.appendChild(el('span', 'rw-starup', 'O bicho é seu!'));
          cell.appendChild(t);
          w.appendChild(cell);
        });
        return w;
      })()));
    }
    var petUps = lastRewards.petLevelUps || [];
    if (petUps.length) {
      box.appendChild(rwBlock('O bicho cresceu', (function () {
        var w = el('div', 'rw-items');
        petUps.forEach(function (u) {
          var pdu = petDef(u.petId);
          var cell = el('div', 'rw-item');
          cell.appendChild(art('petIcon', [u.petId, 52], 52));
          cell.appendChild(el('span', null, esc((pdu && pdu.name) || u.petId) + ' → Nv ' + u.novoNivel));
          w.appendChild(cell);
        });
        return w;
      })()));
    }

    var pets = lastRewards.pets || [];
    if (pets.length) {
      box.appendChild(rwBlock('Bicho novo', (function () {
        var w = el('div', 'rw-items');
        pets.forEach(function (pid) {
          var pd = petDef(pid);
          var cell = el('div', 'rw-item');
          cell.appendChild(art('petIcon', [pid, 52], 52));
          cell.appendChild(el('span', null, esc((pd && pd.name) || pid)));
          if (pd) tipOn(cell, pd.name, esc(pd.description || ''), elemColor(pd.element));
          w.appendChild(cell);
        });
        return w;
      })()));
    }

    body.appendChild(box);
    s.appendChild(body);

    var foot = el('footer', 'ui-foot');
    var pend = lastRewards.elementChoices || [];
    if (pend.length) {
      foot.appendChild(btn('Escolher caminho (' + pend.length + ')', 'btn-gold', function () {
        elemChoiceHero = pend[0];
        navTo('elementChoice');
      }));
    }
    foot.appendChild(btn('Inventário', 'btn-ghost', function () { openSheet('inventory'); }));
    if (noPoco) {
      // subir É vitória: o recorde já foi anotado a cada andar limpo
      foot.appendChild(btn('Subir (o recorde fica)', 'btn-ghost', function () {
        safe(function () { return G().restart(); }, null);
        navTo('hub');
      }));
    }
    if (fim) foot.appendChild(btn('Voltar ao acampamento', 'btn-primary', function () { navTo('hub'); }));
    else foot.appendChild(btn(noPoco ? 'Descer mais um andar' : 'Próxima sala', 'btn-primary', function () {
      if (!safe(function () { return G().nextRoom(); }, false)) toast('Não deu para avançar.');
    }));
    // O seletor vai ANTES do rodape: a escolha e sobre a proxima sala, e tem de
    // ser vista antes do botao que leva a ela.
    if (!fim) {
      var selDif2 = seletorDif();
      if (selDif2) s.appendChild(selDif2);
    }
    s.appendChild(foot);
  }

  /* SELETOR DE DIFICULDADE — o mesmo nas duas telas que levam a uma sala.
   *
   * Mostra o CUSTO e o PREMIO lado a lado, porque escolher sem os dois numeros
   * e escolher no escuro: "+40% vida, +35% dano" contra "+60% xp, +50% drop".
   * Sem isso o jogador so ve tres palavras e chuta.
   *
   * A escolha vai direto para `Game.setDificuldade`, que a guarda entre sessoes.
   * A tela nao mantem estado proprio — dois donos do mesmo dado divergem, e o
   * que diverge aqui apareceria como "escolhi dificil e veio normal". */
  function seletorDif() {
    var G2 = G();
    var D = (JOGO.DATA && JOGO.DATA.dificuldades) || {};
    if (!G2 || !G2.setDificuldade || !D.normal) return null;

    var caixa = el('div', 'dif-caixa');
    var rot = el('div', 'dif-rot', 'Dificuldade desta sala');
    caixa.appendChild(rot);
    var linha = el('div', 'dif-linha');

    ['facil', 'normal', 'dificil'].forEach(function (id) {
      var d = D[id];
      if (!d) return;
      var b = el('button', 'dif-op' + (G2.dificuldade === id ? ' is-sel' : ''));
      b.type = 'button';
      b.appendChild(el('span', 'dif-icone', d.icone || ''));
      b.appendChild(el('span', 'dif-nome', d.nome || id));
      // o custo e o premio, um em cima do outro
      var custo = Math.round((d.vida - 1) * 100), premio = Math.round((d.xp - 1) * 100);
      b.appendChild(el('span', 'dif-num',
        (custo === 0 ? 'monstros iguais' : (custo > 0 ? '+' : '') + custo + '% de vida')));
      b.appendChild(el('span', 'dif-num dif-premio',
        (premio === 0 ? 'xp normal' : (premio > 0 ? '+' : '') + premio + '% de xp')));
      b.title = d.resumo || '';
      tap(b, function () {
        G2.setDificuldade(id);
        var irmaos = linha.querySelectorAll('.dif-op');
        for (var i = 0; i < irmaos.length; i++) irmaos[i].classList.remove('is-sel');
        b.classList.add('is-sel');
      });
      linha.appendChild(b);
    });
    caixa.appendChild(linha);
    return caixa;
  }

  function rwBlock(title, node) {
    var b = el('section', 'rw-block');
    b.appendChild(el('h3', null, esc(title)));
    b.appendChild(node);
    return b;
  }

  function buildDefeat() {
    var s = screens.defeat;
    clear(s);
    var box = el('div', 'menu-box defeat-box');
    box.appendChild(el('h1', 'game-title defeat-title', 'Soterrados'));
    box.appendChild(el('p', 'game-sub', 'O calabouço ficou com o grupo. O que vocês já ganharam é seu — cartas, pedras e itens não se perdem.'));
    var acts = el('div', 'menu-acts');
    acts.appendChild(btn('Tentar de novo', 'btn-primary btn-big', function () {
      var ok = safe(function () { return G().startRun(selHeroes.slice(), G().dungeonId); }, false);
      if (!ok) navTo('heroSelect');
    }));
    acts.appendChild(btn('Voltar ao acampamento', 'btn-ghost', function () {
      safe(function () { return G().restart(); }, null);
      UI.showScreen('menu');
    }));
    box.appendChild(acts);
    s.appendChild(box);
  }

  // ==========================================================================
  // TELA: BATALHA
  // ==========================================================================
  var bt = {};   // referências vivas do HUD de batalha

  function st() { return safe(function () { return G().state; }, null); }
  function activeUnit() {
    var s = st();
    return s ? safe(function () { return E().activeUnit(s); }, null) : null;
  }
  function unitByUid(uid) {
    var s = st();
    if (!s || !s.units) return null;
    for (var i = 0; i < s.units.length; i++) if (s.units[i].uid === uid) return s.units[i];
    return null;
  }

  function buildBattle() {
    var s = screens.battle;
    clear(s);
    bt = {};

    // ---- topo: sala/clima + linha de iniciativa
    var top = el('div', 'bt-top');
    bt.room = el('div', 'bt-room');
    top.appendChild(bt.room);

    // INTERRUPTOR DE SOM. Fica no topo, junto do nome da sala, porque vale para
    // a partida inteira e nao para o turno. Nao guarda estado proprio: quem
    // lembra e `JOGO.Audio`, que grava em localStorage — o botao so mostra.
    if (JOGO.Audio) {
      bt.som = btn(JOGO.Audio.isMudo() ? '🔇' : '🔊', 'bt-som', function () {
        JOGO.Audio.setMudo(!JOGO.Audio.isMudo());
        bt.som.textContent = JOGO.Audio.isMudo() ? '🔇' : '🔊';
        bt.som.title = JOGO.Audio.isMudo() ? 'som desligado' : 'som ligado';
      });
      bt.som.title = JOGO.Audio.isMudo() ? 'som desligado' : 'som ligado';
      top.appendChild(bt.som);
    }

    // RECENTRAR A CAMERA. Camera livre sem volta e camera perdida — e quem se
    // perde no meio de uma sala de 27x23 nao volta sozinho. So aparece quando o
    // jogador REALMENTE mexeu: botao que nunca faz nada ensina a ser ignorado.
    if (JOGO.Renderer && JOGO.Renderer.recentrar) {
      bt.cam = btn('⌖', 'bt-cam', function () { JOGO.Renderer.recentrar(); });
      bt.cam.title = 'recentrar a camera';
      bt.cam.classList.add('is-off');
      top.appendChild(bt.cam);
    }

    // CADEADO DA CÂMERA. Fechado, arrastar e a roda não mexem mais no
    // enquadramento — tocar numa casa continua funcionando, porque isso é
    // jogar. Ao contrário do recentrar, este fica SEMPRE visível: ele é um
    // ESTADO que o jogador precisa poder ler de relance, não uma ação.
    if (JOGO.Renderer && JOGO.Renderer.travarCamera) {
      bt.trava = btn(JOGO.Renderer.cameraTravada() ? '\uD83D\uDD12' : '\uD83D\uDD13',
                     'bt-trava', function () {
        var t = JOGO.Renderer.travarCamera();
        bt.trava.textContent = t ? '\uD83D\uDD12' : '\uD83D\uDD13';
        bt.trava.title = t ? 'câmera travada — toque para soltar'
                           : 'travar a câmera nesta posição';
        bt.trava.classList.toggle('is-on', t);
      });
      bt.trava.title = 'travar a câmera nesta posição';
      top.appendChild(bt.trava);
    }
    bt.timeline = el('div', 'bt-timeline');
    top.appendChild(bt.timeline);
    s.appendChild(top);

    // ---- coluna esquerda: unidade ativa + cronômetro
    var left = el('div', 'bt-left');
    bt.active = el('div', 'bt-active');
    left.appendChild(bt.active);
    bt.timer = el('div', 'bt-timer');
    left.appendChild(bt.timer);
    s.appendChild(left);

    // ---- log compacto (fechado por padrão; toque abre)
    bt.log = el('div', 'bt-log');
    bt.logList = el('div', 'bt-log-list');
    bt.log.appendChild(bt.logList);
    tap(bt.log, function () { bt.log.classList.toggle('is-open'); });
    s.appendChild(bt.log);

    // ---- barra de baixo: feitiços + ações
    var bottom = el('div', 'bt-bottom');
    bt.fusion = el('div', 'bt-fusion');
    bottom.appendChild(bt.fusion);
    bt.spells = el('div', 'bt-spells');
    bottom.appendChild(bt.spells);
    var acts = el('div', 'bt-acts');
    bt.endBtn = btn('Encerrar turno', 'btn-primary btn-end', function () {
      safe(function () { G().endTurn(); }, null);
      battleSig = '';
    });
    acts.appendChild(bt.endBtn);
    bt.menuBtn = btn('☰', 'btn-icon', function () { openSheet('battleMenu'); });
    acts.appendChild(bt.menuBtn);
    bottom.appendChild(acts);
    s.appendChild(bottom);

    paintBattle(true);
  }

  // assinatura: só repinta quando alguma coisa visível mudou [U2]
  function battleSignature() {
    var s = st();
    if (!s) return 'none';
    var u = activeUnit();
    var parts = [s.round, s.activeIdx, s.weather, s.phase,
                 safe(function () { return G().selectedSpellId; }, ''),
                 safe(function () { return G().canFuse().length; }, 0)];
    for (var i = 0; i < s.units.length; i++) {
      var x = s.units[i];
      parts.push(x.uid + ':' + x.hp + ':' + x.pa + ':' + x.pp + ':' + (x.alive ? 1 : 0) +
                 ':' + (x.shield || 0) + ':' + (x.offBoard ? 1 : 0));
    }
    if (u) {
      for (var k = 0; k < (u.spells || []).length; k++) {
        parts.push((u.cooldowns && u.cooldowns[u.spells[k]]) || 0);
      }
      // [U6] os EFEITOS da unidade ativa entram na assinatura: sem eles, ganhar
      // ou perder `root`/provocação/marca não repintava a faixa de estado — e é
      // ela que explica um PP zerado.
      for (var q = 0; q < (u.effects || []).length; q++) {
        var ef = u.effects[q];
        parts.push(ef.type + (ef.stat || '') + (ef.value != null ? ef.value : '') + 'x' + ef.duration);
      }
    }
    return parts.join('|');
  }

  function paintBattle(force) {
    var s = st();
    if (!s || !bt.room) return;
    var sig = battleSignature();
    if (!force && sig === battleSig) return;
    battleSig = sig;

    paintRoom(s);
    paintTimeline(s);
    paintActive(s);
    paintSpells(s);
    paintFusion(s);
    paintTimer();
    paintPlacement(s);
    avisaMoldura();
  }

  /* A ESCOLHA DA POSIÇÃO (03/09): em `placing` a batalha mostra a faixa e
   * apaga a barra de ações — o toque numa casa dourada é a única entrada. */
  function paintPlacement(s) {
    var placing = s.phase === 'placing';
    screens.battle.classList.toggle('is-placing', placing);
    if (placing && !bt.placing) {
      bt.placing = el('div', 'bt-placing',
        '<b>Escolha onde nascer</b> — toque numa das quatro casas douradas. ' +
        'O segundo herói nasce ao acaso perto de você.');
      screens.battle.appendChild(bt.placing);
    } else if (!placing && bt.placing) {
      bt.placing.remove();
      bt.placing = null;
    }
  }

  /* Diz ao renderizador quanto da tela a HUD está tapando.
   *
   * Em retrato de celular a barra de cima e a de feitiços somam ~324 px de 844,
   * e o tabuleiro era enquadrado no centro do CANVAS — 67 px abaixo do centro
   * da faixa que sobra. A fileira de baixo do mapa nascia ATRÁS dos feitiços.
   * O renderizador sabe corrigir (`R.setMoldura`), mas só o HUD sabe a medida,
   * e ela muda quando a barra de fusão aparece ou some.
   *
   * Fora do celular não mexemos em nada: a HUD de mesa não some com o mapa, e
   * mudar o enquadramento lá quebraria as fotos de todas as páginas de teste. */
  function avisaMoldura() {
    var R = JOGO.Renderer;
    if (!R || !R.setMoldura) return;
    if (!(JOGO.Mobile && JOGO.Mobile.celular())) { R.setMoldura(0, 0); return; }
    var topo = screens.battle.querySelector('.bt-top');
    var base = screens.battle.querySelector('.bt-bottom');
    var ht = topo ? Math.round(topo.getBoundingClientRect().height) : 0;
    var hb = base ? Math.round(base.getBoundingClientRect().height) : 0;
    R.setMoldura(ht, hb);
  }

  function paintRoom(s) {
    clear(bt.room);
    var dg = null, ds = dungeons();
    for (var i = 0; i < ds.length; i++) if (ds[i].id === s.dungeonId) dg = ds[i];
    var room = dg && dg.rooms && dg.rooms[s.roomIndex];
    bt.room.appendChild(el('b', null, esc((room && room.name) || (dg && dg.name) || 'Sala')));
    var wd = (D().weathers && D().weathers[s.weather]) || null;
    if (wd) {
      var wc = el('span', 'weather-chip w-' + s.weather, esc(wd.name));
      if (wd.favors) wc.style.setProperty('--ec', elemColor(wd.favors));
      tipOn(wc, wd.name, esc(wd.description || '') +
        (wd.favors ? '<br><b>+5 PV</b> por turno para ' + (ELEM_PT[wd.favors] || wd.favors) : '') +
        (wd.harms ? '<br><b>−5 PV</b> por turno para ' + (ELEM_PT[wd.harms] || wd.harms) : ''),
        wd.favors ? elemColor(wd.favors) : '#ffd08a');
      bt.room.appendChild(wc);
    }
    bt.room.appendChild(el('span', 'round-chip', 'Rodada ' + s.round));
    // O DESAFIO DA SALA: dourado enquanto vale, riscado quando se perde.
    // Mora aqui porque esta linha já é redesenhada a cada atualização.
    if (s.desafio) {
      var dch = el('span', 'desafio-chip' + (s.desafio.vivo ? ' is-vivo' : ' is-perdido'),
        '☆ ' + esc(s.desafio.nome));
      tipOn(dch, 'Desafio: ' + s.desafio.nome,
        esc(s.desafio.texto) + '<br>' +
        (s.desafio.vivo ? 'Valendo: +25% de XP e saque na vitória.'
                        : 'Perdido nesta luta — a sala paga o de sempre.'),
        s.desafio.vivo ? '#e8c25a' : '#8895a6');
      bt.room.appendChild(dch);
    }
  }

  function paintTimeline(s) {
    clear(bt.timeline);
    var order = s.order || [];
    var n = order.length, shown = 0;
    for (var i = 0; i < n && shown < 8; i++) {
      var uid = order[(s.activeIdx + i) % n];
      var u = unitByUid(uid);
      if (!u || !u.alive || u.offBoard) continue;
      shown++;
      var cell = el('div', 'tl-unit ' + (u.side === 'hero' ? 's-hero' : 's-enemy') + (i === 0 ? ' is-now' : ''));
      cell.appendChild(art('portrait', [u.defId, { element: u.element, size: 48 }], i === 0 ? 46 : 34));
      var hpPct = u.hpMax ? u.hp / u.hpMax : 0;
      var hb = el('div', 'tl-hp');
      var hf = el('i');
      hf.style.width = Math.max(0, Math.min(100, hpPct * 100)) + '%';
      hb.appendChild(hf);
      cell.appendChild(hb);
      if (u.boss) cell.appendChild(el('span', 'tl-boss', '♛'));
      tipOn(cell, u.name || u.defId, unitTipBody(u), u.side === 'hero' ? '#7ef0d4' : '#ff9a7a');
      bt.timeline.appendChild(cell);
    }
  }

  function unitTipBody(u) {
    var out = '<i>' + (u.hp + ' / ' + u.hpMax + ' PV · ' + u.pa + ' PA · ' + u.pp + ' PP') + '</i>';
    if (u.shield) out += '<br>Escudo: ' + u.shield;
    if (u.element && u.element !== 'neutro') out += '<br>Elemento: ' + (ELEM_PT[u.element] || u.element);
    if (u.elemPower) out += ' (+' + u.elemPower + ' de dano)';
    var ef = (u.effects || []).filter(function (e) { return e && e.type; });
    if (ef.length) {
      out += '<br>' + ef.map(function (e) {
        return esc(e.type) + (e.duration ? ' (' + e.duration + ')' : '');
      }).join(' · ');
    }
    return out;
  }

  function paintActive(s) {
    clear(bt.active);
    // na ESCOLHA DA POSIÇÃO (03/09) o cartão é do SEU principal — a fila de
    // iniciativa ainda não começou, e mostrar um monstro ali confundia
    var u = (s && s.phase === 'placing' && s.placement) ? unitByUid(s.placement.uid) : activeUnit();
    if (!u) return;
    bt.active.className = 'bt-active ' + (u.side === 'hero' ? 's-hero' : 's-enemy');
    var pic = el('div', 'ba-pic');
    pic.appendChild(art('portrait', [u.defId, { element: u.element, size: 64 }], 56));
    bt.active.appendChild(pic);

    var info = el('div', 'ba-info');
    var nm = el('div', 'ba-name', esc(u.name || u.defId));
    if (u.element && u.element !== 'neutro') {
      var e2 = el('span', 'elem-dot');
      e2.style.background = elemColor(u.element);
      nm.appendChild(e2);
    }
    info.appendChild(nm);

    var hp = el('div', 'ba-hp');
    var hpb = bar('bar-hp', u.hpMax ? u.hp / u.hpMax : 0, u.hp + ' / ' + u.hpMax);
    if (u.shield) {
      var shd = el('span', 'shield-chip', '🛡 ' + u.shield);
      hpb.appendChild(shd);
    }
    hp.appendChild(hpb);
    info.appendChild(hp);

    var res = el('div', 'ba-res');
    var paw = el('div', 'res pa-res');
    paw.appendChild(el('span', 'res-lb', 'PA'));
    paw.appendChild(pips(u.pa, u.paMax, 'p-pa'));
    tipOn(paw, 'Pontos de Ataque', 'Cada feitiço custa PA. Voltam ao máximo no começo do seu turno.', '#ffb15c');
    res.appendChild(paw);
    var ppw = el('div', 'res pp-res');
    ppw.appendChild(el('span', 'res-lb', 'PP'));
    ppw.appendChild(pips(u.pp, u.ppMax, 'p-pp'));
    // [U6] PP zerado com motivo à vista. Sem isto o jogador via "0 / 3" no
    // começo do próprio turno e concluía que o PP não recarrega — quando o que
    // houve foi `root` (prende o turno inteiro) ou uma FIXAÇÃO mal-sucedida,
    // que leva todo o PP restante sem tirar ninguém do lugar (contrato §2).
    if (u.pp <= 0) {
      var why = el('span', 'res-why', hasEff(u, 'root') ? 'preso' : 'sem passo');
      why.setAttribute('style', 'font:700 10px var(--ui-sans);color:#e2665a;margin-left:4px');
      ppw.appendChild(why);
    }
    tipOn(ppw, 'Pontos de Passos',
      'Cada célula andada gasta 1 PP. Voltam ao máximo no começo do seu turno — ' +
      'salvo se você estiver <b>preso</b> (0 PP o turno todo). ' +
      'Sair de célula colada num inimigo é um teste de esquiva: falhando, você ' +
      '<b>perde todo o PP e não sai do lugar</b>.', '#7ef0d4');
    res.appendChild(ppw);
    info.appendChild(res);

    var status = statusRow(u);          // [U6] faixa de estado da unidade ativa
    if (status) info.appendChild(status);
    bt.active.appendChild(info);
  }

  /* [U6] FAIXA DE ESTADO. O painel da unidade ativa mostrava PV/PA/PP e mais
   * nada: um herói enraizado era indistinguível de um herói com o PP quebrado.
   * As fichas abaixo dão nome, em português, ao que está agindo sobre ela — o
   * `type` do efeito é vocabulário fechado do contrato e não vai para a tela. */
  var EF_CHIP = {
    root:      { txt: 'Preso',      cor: '#e2665a' },
    poison:    { txt: 'Veneno',     cor: '#8fd14f' },
    regen:     { txt: 'Regen',      cor: '#7ef0d4' },
    taunt:     { txt: 'Provocado',  cor: '#ffb15c' },
    invisible: { txt: 'Invisível',  cor: '#9be0ff' },
    reflect:   { txt: 'Reflexo',    cor: '#c8a2ff' },
    resist:    { txt: 'Resist.',    cor: '#9be0ff' }
  };
  function hasEff(u, type) {
    var l = (u && u.effects) || [];
    for (var i = 0; i < l.length; i++) if (l[i].type === type) return true;
    return false;
  }
  function chip(txt, cor) {
    var c = el('span', 'st-chip', esc(txt));
    c.setAttribute('style', 'display:inline-block;padding:1px 6px;border-radius:999px;' +
      'font:700 10px var(--ui-sans);color:' + cor + ';border:1px solid ' + cor + '66;' +
      'background:' + cor + '1f');
    return c;
  }
  function statusRow(u) {
    var list = (u && u.effects) || [];
    if (!list.length) return null;
    var row = el('div', 'ba-status');
    row.setAttribute('style', 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px');
    var marcas = 0, vistos = {}, n = 0, i;
    for (i = 0; i < list.length; i++) {
      var ef = list[i];
      if (ef.type === 'mark') { marcas++; continue; }
      if (ef.type === 'shield') continue;                 // já aparece na barra de PV
      if (ef.type === 'buff') {
        var v = (ef.value > 0 ? '+' : '') + ef.value;
        row.appendChild(chip(v + ' ' + String(ef.stat || '').toUpperCase(),
                             ef.value < 0 ? '#e2665a' : '#8fd14f'));
        n++;
        continue;
      }
      var d = EF_CHIP[ef.type];
      if (!d || vistos[ef.type]) continue;
      vistos[ef.type] = true;
      row.appendChild(chip(d.txt, d.cor));
      n++;
    }
    if (marcas) { row.appendChild(chip('Marcado ×' + marcas, '#ff8a24')); n++; }
    return n ? row : null;
  }

  function paintTimer() {
    if (!bt.timer) return;
    var g = G();
    if (!g) return;
    var isMine = safe(function () { return g.isPlayerTurn(); }, false);
    var left = safe(function () { return g.timeLeft(); }, 0);
    var banked = g.banked || 0;
    var turn = g.turnTime || 30;
    var pct = Math.max(0, Math.min(1, left / turn));
    clear(bt.timer);
    bt.timer.className = 'bt-timer' + (isMine ? '' : ' is-idle') + (left <= 5 && isMine ? ' is-low' : '');
    var t = el('div', 'tm-num', String(Math.ceil(left)) + 's');
    bt.timer.appendChild(t);
    var trk = el('div', 'tm-track');
    var fil = el('i');
    fil.style.width = (pct * 100) + '%';
    trk.appendChild(fil);
    bt.timer.appendChild(trk);
    if (banked > 0) {
      var bk = el('div', 'tm-bank', '+' + Math.round(banked) + 's guardados');
      tipOn(bk, 'Tempo guardado',
        'O que você não gasta no turno vai para o banco (máx. ' + (g.bankMax || 120) +
        's) e é usado quando os ' + turn + 's acabarem.', '#9fd8ff');
      bt.timer.appendChild(bk);
    }
  }

  function paintSpells(s) {
    clear(bt.spells);
    var u = activeUnit();
    var mine = safe(function () { return G().isPlayerTurn(); }, false);
    if (!u || !mine) {
      bt.spells.appendChild(el('div', 'bt-wait', u ? 'Turno de ' + esc(u.name || '') + '…' : 'Aguarde…'));
      bt.endBtn.classList.add('is-off');
      return;
    }
    bt.endBtn.classList.remove('is-off');
    var sel = safe(function () { return G().selectedSpellId; }, null);
    var list = u.spells || [];
    if (!list.length) bt.spells.appendChild(el('div', 'bt-wait', 'Sem feitiços.'));
    list.forEach(function (sid) {
      var d2 = spellDef(sid, u);
      var cd = (u.cooldowns && u.cooldowns[sid]) || 0;
      var cost = d2 ? (d2.paCost || 0) : 0;
      var can = cd <= 0 && u.pa >= cost;
      var cell = el('button', 'spell' + (sel === sid ? ' is-sel' : '') + (can ? '' : ' is-dim'));
      cell.type = 'button';
      cell.appendChild(art('spellIcon', [d2 || sid, 52], 48));
      cell.appendChild(el('span', 'sp-cost', String(cost)));
      if (d2 && d2.element && d2.element !== 'neutro') {
        cell.style.setProperty('--ec', elemColor(d2.element));
        cell.classList.add('has-elem');
      }
      if (cd > 0) cell.appendChild(el('span', 'sp-cd', String(cd)));
      cell.appendChild(el('span', 'sp-name', esc(spellName(d2, sid))));
      tap(cell, function () {
        if (cd > 0) { toast('Recarregando: ' + cd + (cd > 1 ? ' rodadas.' : ' rodada.')); return; }
        if (u.pa < cost) { toast('PA insuficiente (' + cost + ' necessários).'); return; }
        safe(function () { G().selectSpell(sid); }, null);
        battleSig = '';
        paintBattle(true);
      });
      // toque longo/segunda toque no nome abre a explicação
      var q = el('span', 'sp-info', 'i');
      tipOn(q, spellName(d2, sid), spellTipBody(d2, sid), d2 ? elemColor(d2.element) : '#ffd08a');
      cell.appendChild(q);
      bt.spells.appendChild(cell);
    });
  }

  function spellTipBody(d2, sid) {
    if (!d2) return 'Este feitiço não pôde ser carregado.';
    var out = '<i>' + (d2.paCost || 0) + ' PA';
    if (d2.range) out += ' · alcance ' + (d2.range.min || 0) + '–' + (d2.range.max || 0);
    if (d2.cooldown) out += ' · recarga ' + d2.cooldown;
    if (d2.castsPerTurn) out += ' · ' + d2.castsPerTurn + '×/turno';
    out += '</i><br>' + esc(d2.description || '');
    if (d2.aoe && d2.aoe.shape && d2.aoe.shape !== 'single') {
      out += '<br>Área: ' + esc(d2.aoe.shape) + ' ' + (d2.aoe.size || '');
    }
    if (d2.flavor) out += '<br><em>' + esc(d2.flavor) + '</em>';
    return out;
  }

  // botão de FUSÃO com prévia do resultado
  function paintFusion(s) {
    clear(bt.fusion);
    var pairs = safe(function () { return G().canFuse(); }, []);
    if (!pairs.length) { bt.fusion.classList.remove('is-on'); return; }
    bt.fusion.classList.add('is-on');
    var pr = pairs[0];
    var a = unitByUid(pr.uidA), b = unitByUid(pr.uidB);
    if (!a || !b) { bt.fusion.classList.remove('is-on'); return; }
    var ca = a.classId || a.defId, cb = b.classId || b.defId;
    var pair = [ca, cb].sort();
    var defId = 'fus:' + pair[0] + '+' + pair[1];
    var cell = el('button', 'fusion-btn');
    cell.type = 'button';
    cell.appendChild(art('unit', [defId, { elements: [a.element, b.element], dir: 0, scale: 0.4 }], 60));
    var t = el('div', 'fu-txt');
    t.appendChild(el('b', null, 'FUNDIR'));
    t.appendChild(el('span', null, esc(className(ca)) + ' + ' + esc(className(cb))));
    cell.appendChild(t);
    tap(cell, function () {
      confirmSheet('Fundir os dois heróis?',
        'Vira <b>uma única unidade</b>: vida somada, +2 PA, +1 PP, +50 de escudo e feitiços de fusão. ' +
        'Custa 2 PA e <b>encerra o turno</b>. Se um deles se afastar antes do fim, não acontece nada.',
        function () {
          var ok = safe(function () { return G().declareFusion(pr.uidA, pr.uidB); }, false);
          if (!ok) toast('A fusão não pôde ser declarada.');
          else toast('Fusão declarada — encerrando o turno.', 'good');
          battleSig = '';
        });
    });
    bt.fusion.appendChild(cell);
  }

  // ==========================================================================
  // FOLHAS (modais): coleção · inventário · forja · ficha do herói
  // ==========================================================================
  /* os botões do cais, por nome de porta — preenchido no buildHub; o
   * openSheet/closeSheet acendem e apagam a aba correspondente */
  var dockBotoes = {};
  function marcaDock(name) {
    for (var k in dockBotoes) {
      if (!dockBotoes.hasOwnProperty(k)) continue;
      dockBotoes[k].classList.toggle('is-on', !!name && k === name);
    }
  }

  function closeSheet() {
    if (!sheetEl) return;
    sheetEl.classList.remove('is-on');
    sheetName = null;
    marcaDock(null);
    hideTip();
  }
  /* O BANCO — agora do jeito do DOFUS, a pedido: o saco do grupo de um lado,
   * o cofre do outro, as DUAS grades na mesma tela, e a peça ATRAVESSA —
   * arrastada com o mouse ou o dedo, ou com dois toques rápidos. O dinheiro
   * tem campo DIGITADO: "guardar 500" é uma intenção que os quatro botões de
   * ±10/±100 nunca expressaram.
   *
   * Toda leitura vem do DB por Promise e a ficha REDESENHA quando a resposta
   * chega: é o mesmo desenho que vai valer quando o DB for um servidor, então
   * a ficha já nasce sabendo esperar. Nenhum número aqui é lido de cache
   * próprio — dois donos do mesmo saldo divergem, e saldo divergente num jogo
   * com moeda é o tipo de defeito que jogador percebe na hora.
   *
   * ITENS: cada viagem leva UMA unidade da pilha, e a forma inteira — nível e
   * estrelas — viaja junto, senão o jogador sacaria um item pior do que
   * guardou. Item EQUIPADO não aparece: o inventário já é só o saco solto.
   * No cofre, iguais empilham com ×N como na grade do inventário, guardando
   * os índices reais de cada unidade para o saque.
   */
  var bancoQtd = '';               // o valor digitado sobrevive ao redesenho

  /* A célula é a MESMA da grade do inventário (ig-cell): icone, raridade,
   * forja, estrelas, ×N. O que ela ganha aqui é o ARRASTO: pointer capture
   * prende o dedo à célula, um fantasma com o nome segue o cursor, a coluna
   * de destino acende (is-alvo), e soltar sobre ela transfere. Menos de 8 px
   * de movimento é toque — e o segundo toque em menos de 350 ms também
   * transfere. */
  function bancoCelula(pilha, lado, transferir) {
    var it = itemDef(pilha.itemId) || {};
    var cell = el('div', 'ig-cell bk2-cel ' + starClass(pilha.stars));
    markRarity(cell, it.rarity);
    var plate = el('span', 'ig-plate');
    plate.appendChild(art('itemIcon', [pilha.itemId, 44], 44));
    var bset = setBadge(pilha.itemId, true);   // mudo: o gesto da célula é o arrasto
    if (bset) plate.appendChild(bset);
    cell.appendChild(plate);
    if (pilha.count > 1) cell.appendChild(el('span', 'ig-n', '×' + pilha.count));
    if (pilha.level) cell.appendChild(el('span', 'ig-lv', '+' + pilha.level));
    if (pilha.stars) cell.appendChild(starPips(pilha.stars));
    cell.appendChild(el('span', 'ig-nm', esc(it.name || pilha.itemId)));
    tipOn(cell, it.name || pilha.itemId,
      itemTipBody(pilha.itemId, pilha.level, pilha.stars), rarColor(it.rarity));

    var draga = null;
    function limpaAlvo() {
      var m = document.querySelector('.bk2-col.is-alvo');
      if (m) m.classList.remove('is-alvo');
    }
    cell.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      draga = { x: ev.clientX, y: ev.clientY, fantasma: null };
      try { cell.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    cell.addEventListener('pointermove', function (ev) {
      if (!draga) return;
      if (!draga.fantasma && Math.hypot(ev.clientX - draga.x, ev.clientY - draga.y) > 8) {
        draga.fantasma = el('div', 'bk2-fantasma', esc(it.name || pilha.itemId));
        draga.fantasma.style.borderColor = rarColor(it.rarity);
        document.body.appendChild(draga.fantasma);
        var alvo = document.querySelector(
          '.bk2-col[data-lado="' + (lado === 'saco' ? 'cofre' : 'saco') + '"]');
        if (alvo) alvo.classList.add('is-alvo');
      }
      if (draga.fantasma) {
        draga.fantasma.style.left = ev.clientX + 'px';
        draga.fantasma.style.top = ev.clientY + 'px';
      }
    });
    cell.addEventListener('pointerup', function (ev) {
      if (!draga) return;
      var arrastou = !!draga.fantasma;
      if (draga.fantasma) draga.fantasma.remove();
      draga = null;
      limpaAlvo();
      if (arrastou) {
        // o fantasma tem pointer-events:none, então o ponto enxerga o que há
        // DEBAIXO dele — a coluna onde o jogador soltou
        var sob = document.elementFromPoint(ev.clientX, ev.clientY);
        var col = sob && sob.closest ? sob.closest('.bk2-col') : null;
        if (col && col.dataset.lado && col.dataset.lado !== lado) transferir();
        return;
      }
      var agora = Date.now();
      // O TERCEIRO TOQUE ABRE A QUANTIDADE (30/08, pedido: "ao dar 3 cliques
      // no item... deve aparecer a quantidade que ele quer transferir").
      // O gesto de sempre fica: dois toques movem UMA; quem emenda o
      // terceiro está dizendo "quero mais" — e ganha o campo.
      if (cell.__toque && agora - cell.__toque < 420) {
        cell.__seq = (cell.__seq || 1) + 1;
        cell.__toque = agora;
        if (cell.__seq === 2) transferir();
        else if (cell.__seq >= 3) {
          cell.__seq = 0; cell.__toque = 0;
          if (pilha.count > 1) abreQuantidade();
        }
      } else { cell.__toque = agora; cell.__seq = 1; }
    });

    // o mini-campo da quantidade, ancorado na própria célula
    function abreQuantidade() {
      var velho = document.querySelector('.bk2-qtd-pop');
      if (velho) velho.remove();
      var pop = el('div', 'bk2-qtd-pop');
      pop.style.cssText = 'position:absolute;left:50%;top:-8px;transform:translate(-50%,-100%);' +
        'background:#151b24;border:1px solid #c9a227;border-radius:8px;padding:8px;z-index:60;' +
        'display:flex;gap:6px;align-items:center;box-shadow:0 6px 18px rgba(0,0,0,.55)';
      var inp = document.createElement('input');
      inp.type = 'number'; inp.min = '1'; inp.max = String(pilha.count);
      inp.value = String(pilha.count);
      inp.style.cssText = 'width:64px;background:#0e1319;color:#e8eef6;border:1px solid #2b3542;' +
        'border-radius:6px;padding:5px 7px;font:13px system-ui';
      pop.appendChild(inp);
      var ok = el('button', 'btn-mini btn-gold', 'Mover');
      ok.type = 'button';
      tap(ok, function () {
        var n = Math.max(1, Math.min(pilha.count, Math.floor(Number(inp.value) || 1)));
        pop.remove();
        transferir(n);
      });
      pop.appendChild(ok);
      cell.style.position = 'relative';
      cell.appendChild(pop);
      inp.focus();
      inp.select();
    }
    cell.addEventListener('pointercancel', function () {
      if (draga && draga.fantasma) draga.fantasma.remove();
      draga = null;
      limpaAlvo();
    });
    return cell;
  }

  /* Grade FIXA como a do inventário: as casas vazias mostram quanto ainda
   * cabe, e sempre sobra ao menos uma fileira — uma grade cheia até a borda
   * diz "não cabe mais", e cabe. */
  function bancoGrade(pilhas, lado, aoTransferir) {
    var grid = el('div', 'bk2-grid');
    pilhas.forEach(function (pi) {
      grid.appendChild(bancoCelula(pi, lado, function () { aoTransferir(pi); }));
    });
    var alvo = Math.max(12, Math.ceil((pilhas.length + 1) / 4) * 4);
    for (var vz = pilhas.length; vz < alvo; vz++) {
      grid.appendChild(el('div', 'ig-cell is-vazia bk2-cel'));
    }
    return grid;
  }

  function sheetBanco() {
    sheetName = 'banco';
    var body = sheetShell('Banco do Acampamento',
      'O que está no cofre não desce com você — e por isso nunca se perde.');
    // duas grades em 720px viram espremido; a ficha do banco alarga
    var painel = sheetEl.querySelector('.sheet-panel');
    if (painel) painel.classList.add('sheet-larga');
    var DBc = JOGO.DB;
    if (!DBc) { body.appendChild(el('p', 'inv-dica', 'A conta local não carregou.')); return; }

    var caixa = el('div', 'bk-caixa');
    body.appendChild(caixa);

    Promise.all([DBc.moedas(), DBc.banco()]).then(function (r) {
      var bolso = r[0], cofre = r[1];
      clear(caixa);

      // ---- O DINHEIRO: bolso | quantia digitada + guardar/sacar | cofre
      var moedas = el('div', 'bk-moedas');
      var ladoBolso = el('div', 'bk-lado');
      ladoBolso.appendChild(el('h3', null, 'No bolso'));
      ladoBolso.appendChild(el('div', 'bk-valor', String(bolso)));
      var ladoCofre = el('div', 'bk-lado');
      ladoCofre.appendChild(el('h3', null, 'No cofre'));
      ladoCofre.appendChild(el('div', 'bk-valor', String(cofre.moedas)));

      var meio = el('div', 'bk-meio bk2-meio');
      var campo = document.createElement('input');
      campo.type = 'number'; campo.min = '1'; campo.step = '1';
      campo.placeholder = 'quantia';
      campo.className = 'bk2-qtd';
      campo.value = bancoQtd;
      campo.addEventListener('input', function () { bancoQtd = campo.value; });
      meio.appendChild(campo);

      function quantia() {
        var n2 = Math.floor(Number(campo.value));
        if (!isFinite(n2) || n2 <= 0) { toast('digite a quantia'); campo.focus(); return 0; }
        return n2;
      }
      function moveMoedas(op, valorDeposito) {
        op.then(function (res) {
          if (!res.ok) toast(res.erro || 'não deu');
          else {
            bancoQtd = '';                 // deu certo: o campo limpa, como no Dofus
            // depósito conta para as missões ("guarde N no cofre") — saque não
            if (valorDeposito && JOGO.Missoes && JOGO.Missoes.registra) {
              JOGO.Missoes.registra({ tipo: 'deposito', valor: valorDeposito,
                                      cofreTotal: res.banco || 0 });
            }
          }
          sheetBanco();
        });
      }
      var linhaB = el('div', 'bk2-botoes');
      linhaB.appendChild(btn('Guardar →', 'btn-mini', function () {
        var n2 = quantia(); if (n2) moveMoedas(DBc.depositarMoedas(n2), n2);
      }));
      linhaB.appendChild(btn('← Sacar', 'btn-mini', function () {
        var n2 = quantia(); if (n2) moveMoedas(DBc.sacarMoedas(n2));
      }));
      meio.appendChild(linhaB);
      var linhaT = el('div', 'bk2-botoes');
      linhaT.appendChild(btn('tudo →', 'btn-mini bk2-tudo', function () {
        if (bolso > 0) moveMoedas(DBc.depositarMoedas(bolso), bolso);
        else toast('o bolso está vazio');
      }));
      linhaT.appendChild(btn('← tudo', 'btn-mini bk2-tudo', function () {
        if (cofre.moedas > 0) moveMoedas(DBc.sacarMoedas(cofre.moedas));
        else toast('o cofre está vazio');
      }));
      meio.appendChild(linhaT);

      moedas.appendChild(ladoBolso);
      moedas.appendChild(meio);
      moedas.appendChild(ladoCofre);
      caixa.appendChild(moedas);

      // ---- AS DUAS GRADES, lado a lado — o desenho do Dofus
      caixa.appendChild(el('p', 'inv-dica',
        'Arraste uma peça de uma grade para a outra — cada viagem leva uma unidade. ' +
        'Dois toques rápidos também transferem.'));

      var pilhas = safe(function () { return P().invStacks(); }, [])
        .filter(function (s2) { return !!itemDef(s2.itemId); });
      var unidadesSaco = 0;
      pilhas.forEach(function (pi) { unidadesSaco += pi.count; });

      // o cofre empilha iguais como o inventário, com os índices reais juntos
      var mapa2 = {}, pilhasCofre = [];
      cofre.itens.forEach(function (it2, idx) {
        var ch = it2.itemId + '|' + (it2.level || 0) + '|' + (it2.stars || 0);
        if (mapa2[ch]) { mapa2[ch].count++; mapa2[ch].indices.push(idx); return; }
        mapa2[ch] = { itemId: it2.itemId, level: it2.level || 0,
                      stars: it2.stars || 0, count: 1, indices: [idx] };
        pilhasCofre.push(mapa2[ch]);
      });

      // o filtro por elemento vale para AS DUAS grades de uma vez — quem
      // procura a peça de água não quer caçá-la em dois lugares
      caixa.appendChild(elemTabs(bancoElemFiltro, function (e2) {
        bancoElemFiltro = e2;
        sheetBanco();
      }));
      // busca ao vivo nas DUAS grades (o `duplo` é atribuído logo abaixo,
      // antes de qualquer tecla poder chegar)
      caixa.appendChild(buscaInput(bancoBusca, function (t) {
        bancoBusca = t;
        aplicaBusca(duplo, t);
      }));
      if (bancoElemFiltro !== 'todos') {
        pilhas = pilhas.filter(function (pi) { return passaElemento(pi.itemId, bancoElemFiltro); });
        pilhasCofre = pilhasCofre.filter(function (pi) { return passaElemento(pi.itemId, bancoElemFiltro); });
      }
      var duplo = el('div', 'bk2-duplo');

      var colSaco = el('div', 'bk2-col');
      colSaco.dataset.lado = 'saco';
      var limSaco = safe(function () { return P().bagLimit(); }, 0);
      colSaco.appendChild(el('h3', 'bk-tit', 'No saco (' + unidadesSaco +
        (limSaco ? ' / ' + limSaco : '') + ')'));
      colSaco.appendChild(bancoGrade(pilhas, 'saco', function (pi) {
        var st2 = P().state;
        var entrada = st2.inventory[pi.indices[0]];
        if (!entrada) { toast('essa peça já saiu'); sheetBanco(); return; }
        st2.inventory.splice(pi.indices[0], 1);
        safe(function () { P().save(); }, null);
        DBc.depositarItem(entrada).then(function () { sheetBanco(); });
      }));

      var colCofre = el('div', 'bk2-col');
      colCofre.dataset.lado = 'cofre';
      colCofre.appendChild(el('h3', 'bk-tit', 'No cofre (' + cofre.itens.length + ')'));
      colCofre.appendChild(bancoGrade(pilhasCofre, 'cofre', function (pi) {
        // o saco tem fundo (25/08): sacar do cofre só com vaga
        if (!safe(function () { return P().bagFree(1); }, true)) {
          toast('O saco está cheio — não cabe mais nada.');
          return;
        }
        DBc.sacarItem(pi.indices[0]).then(function (res) {
          if (!res.ok) { toast(res.erro || 'não deu'); sheetBanco(); return; }
          var st3 = P().state;
          st3.inventory.push(res.item);
          safe(function () { P().save(); }, null);
          sheetBanco();
        });
      }));

      duplo.appendChild(colSaco);
      duplo.appendChild(colCofre);
      caixa.appendChild(duplo);
      if (bancoBusca) aplicaBusca(duplo, bancoBusca);
    });
  }

  /* O QUADRO DE MISSÕES — diárias em cima, conquistas embaixo, e o seletor
   * de título no pé. Toda leitura vem de JOGO.Missoes por Promise e a ficha
   * redesenha quando a resposta chega, como o banco. */
  function sheetMissoes() {
    sheetName = 'missoes';
    var body = sheetShell('Quadro de Missões',
      'As diárias mudam a cada dia; as conquistas ficam. Prêmio em vinténs — e as conquistas dão TÍTULO.');
    var Ms = JOGO.Missoes;
    if (!Ms) { body.appendChild(el('p', 'inv-dica', 'O quadro não carregou.')); return; }

    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);

    Promise.all([Ms.carregar(), Ms.titulos(),
                 JOGO.DB ? JOGO.DB.jogador() : Promise.resolve({})])
      .then(function (r) {
        var quadro = r[0], titulos = r[1] || [], jog = r[2] || {};
        clear(caixa);
        if (!quadro) { caixa.appendChild(el('p', 'inv-dica', 'A conta local não carregou.')); return; }

        function linha(id, def, st2) {
          var row = el('div', 'ms-linha' + (st2.prog >= def.alvo ? ' is-feita' : ''));
          var tx = el('div', 'ms-tx');
          tx.appendChild(el('div', 'ms-nome', esc(def.texto) +
            (def.titulo ? ' <span class="ms-titulo">título: ' + esc(def.titulo) + '</span>' : '')));
          var barra = el('div', 'ms-barra');
          var cheio = el('i', null, '');
          cheio.style.width = Math.min(100, Math.round(100 * st2.prog / def.alvo)) + '%';
          barra.appendChild(cheio);
          tx.appendChild(barra);
          tx.appendChild(el('div', 'ms-prog', st2.prog + ' de ' + def.alvo));
          row.appendChild(tx);
          if (st2.pago) {
            row.appendChild(el('span', 'ms-pago', '✓ recebido'));
          } else if (st2.prog >= def.alvo) {
            row.appendChild(btn('Receber ' + def.premio + 'v', 'btn-mini btn-gold', function () {
              Ms.reivindicar(id).then(function (res) {
                if (!res.ok) { toast(res.erro || 'não deu'); }
                else {
                  toast('+' + res.premio + ' vinténs' +
                        (res.titulo ? ' · título novo: ' + res.titulo : ''), 'good');
                }
                sheetMissoes();
              });
            }));
          } else {
            row.appendChild(el('span', 'ms-premio', def.premio + 'v'));
          }
          return row;
        }

        caixa.appendChild(el('h3', 'bk-tit', 'Diárias de hoje (' + quadro.dia + ')'));
        quadro.lista.forEach(function (mi) {
          var def = Ms.DIARIAS[mi.id];
          if (def) caixa.appendChild(linha(mi.id, def, mi));
        });

        caixa.appendChild(el('h3', 'bk-tit', 'Conquistas'));
        Object.keys(Ms.CONQUISTAS).forEach(function (id) {
          var def = Ms.CONQUISTAS[id];
          var st2 = quadro.conquistas[id] || { prog: 0, pago: false };
          caixa.appendChild(linha(id, def, st2));
        });

        // ---- o seletor de título: só os ganhos aparecem
        caixa.appendChild(el('h3', 'bk-tit', 'Título na plaquinha'));
        if (!titulos.length) {
          caixa.appendChild(el('p', 'inv-dica',
            'Nenhum título ainda — as conquistas com "título:" dão um.'));
        } else {
          var fila = el('div', 'ms-titulos');
          ['— sem título —'].concat(titulos).forEach(function (t, ti) {
            var valor = ti === 0 ? null : t;
            var ativo = (jog.titulo || null) === valor;
            fila.appendChild(btn(esc(t), 'btn-mini' + (ativo ? ' is-on' : ''), function () {
              JOGO.DB.definirTitulo(valor).then(function (res) {
                if (JOGO.Hub && JOGO.Hub.nomeia) JOGO.Hub.nomeia(jog.nome || '', res.titulo || '');
                toast(res.titulo ? 'Agora você é ' + jog.nome + ', ' + res.titulo + '.'
                                 : 'Sem título — só o nome.', 'good');
                sheetMissoes();
              });
            }));
          });
          caixa.appendChild(fila);
        }
      });
  }

  /* O MERCADINHO — o balcão de compra em cima, a venda do saco embaixo.
   * Toda leitura vem de JOGO.Mercado por Promise, redesenho a cada resposta,
   * como o banco. A peça comprada entra no saco AQUI (o módulo devolve; a
   * ficha guarda) — mesmo contrato do saque do cofre. */
  var mercadoPreco = '';           // o preço digitado sobrevive ao redesenho

  function sheetMercado() {
    sheetName = 'mercado';
    var body = sheetShell('Mercadinho do Acampamento',
      'As ofertas do mercador trocam a cada dia; as suas ficam até vender. Venda paga 5% de taxa.');
    var Mc = JOGO.Mercado;
    if (!Mc) { body.appendChild(el('p', 'inv-dica', 'O mercado não carregou.')); return; }

    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);

    Promise.all([Mc.abrir(), JOGO.DB.moedas()]).then(function (r) {
      var mc = r[0], bolso = r[1];
      clear(caixa);
      if (!mc) { caixa.appendChild(el('p', 'inv-dica', 'A conta local não carregou.')); return; }

      var pBolso = el('p', 'mc-bolso', 'No bolso: <b>' + bolso + '</b> ' +
        (bolso === 1 ? 'vintém' : 'vinténs'));
      pBolso.insertBefore(art('vintemIcon', [18], 18, 'moeda-inline'), pBolso.firstChild);
      caixa.appendChild(pBolso);

      // ---- o balcão: tudo à venda, as do jogador marcadas
      caixa.appendChild(el('h3', 'bk-tit', 'À venda (' + mc.ofertas.length + ')'));
      if (!mc.ofertas.length) caixa.appendChild(el('p', 'inv-dica', 'O balcão amanheceu vazio.'));
      mc.ofertas.forEach(function (of) {
        var it = (D().items || {})[of.itemId] || {};
        var row = el('div', 'mc-linha' + (of.vendedor === 'jogador' ? ' is-minha' : ''));
        var ic = el('span', 'mc-ic');
        ic.appendChild(art('itemIcon', [of.itemId, 34], 34));
        row.appendChild(ic);
        var tx = el('div', 'ms-tx');
        tx.appendChild(el('div', 'ms-nome', esc(it.name || of.itemId) +
          (of.level ? ' +' + of.level : '') + (of.stars ? ' ★' + of.stars : '')));
        tx.appendChild(el('div', 'ms-prog',
          of.vendedor === 'jogador' ? 'sua oferta' : 'do mercador'));
        row.appendChild(tx);
        row.appendChild(el('span', 'mc-preco', of.preco + 'v'));
        if (of.vendedor === 'jogador') {
          row.appendChild(btn('Retirar', 'btn-mini', function () {
            if (!safe(function () { return P().bagFree(1); }, true)) {
              toast('O saco está cheio — não cabe mais nada.');
              return;
            }
            Mc.retirar(of.id).then(function (res) {
              if (!res.ok) { toast(res.erro || 'não deu'); sheetMercado(); return; }
              P().state.inventory.push(res.item);
              safe(function () { P().save(); }, null);
              toast('A peça voltou para o saco.', 'good');
              sheetMercado();
            });
          }));
        } else {
          var bC = btn('Comprar', 'btn-mini btn-gold', function () {
            if (!safe(function () { return P().bagFree(1); }, true)) {
              toast('O saco está cheio — não cabe mais nada.');
              return;
            }
            Mc.comprar(of.id).then(function (res) {
              if (!res.ok) { toast(res.erro || 'não deu'); sheetMercado(); return; }
              P().state.inventory.push(res.item);
              safe(function () { P().save(); }, null);
              toast('−' + res.pagou + ' vinténs — a peça é sua.', 'good');
              sheetMercado();
            });
          });
          if (bolso < of.preco) bC.classList.add('is-off');
          row.appendChild(bC);
        }
        caixa.appendChild(row);
      });

      // ---- vender do saco: pilha + preço digitado com sugestão da régua
      var pilhas = safe(function () { return P().invStacks(); }, [])
        .filter(function (s2) { return !!itemDef(s2.itemId); });
      caixa.appendChild(el('h3', 'bk-tit', 'Vender do saco (' + pilhas.length + ')'));
      if (!pilhas.length) caixa.appendChild(el('p', 'inv-dica', 'O saco está vazio.'));
      pilhas.forEach(function (pi) {
        var it = itemDef(pi.itemId) || {};
        var row = el('div', 'mc-linha');
        var ic = el('span', 'mc-ic');
        ic.appendChild(art('itemIcon', [pi.itemId, 34], 34));
        row.appendChild(ic);
        var tx = el('div', 'ms-tx');
        tx.appendChild(el('div', 'ms-nome', esc(it.name || pi.itemId) +
          (pi.level ? ' +' + pi.level : '') + (pi.stars ? ' ★' + pi.stars : '') +
          (pi.count > 1 ? ' ×' + pi.count : '')));
        var sugerido = Mc.precoSugerido(pi.itemId, pi.level, pi.stars);
        tx.appendChild(el('div', 'ms-prog', 'a régua sugere ' + sugerido + 'v'));
        row.appendChild(tx);
        var campo = document.createElement('input');
        campo.type = 'number'; campo.min = '1'; campo.step = '1';
        campo.className = 'bk2-qtd mc-qtd';
        campo.placeholder = String(sugerido);
        row.appendChild(campo);
        row.appendChild(btn('Anunciar', 'btn-mini', function () {
          var preco = Math.floor(Number(campo.value || sugerido));
          var st2 = P().state;
          var entrada = st2.inventory[pi.indices[0]];
          if (!entrada) { toast('essa peça já saiu'); sheetMercado(); return; }
          Mc.anunciar(entrada, preco).then(function (res) {
            if (!res.ok) { toast(res.erro || 'não deu'); return; }
            st2.inventory.splice(pi.indices[0], 1);
            safe(function () { P().save(); }, null);
            toast('No balcão por ' + preco + 'v.', 'good');
            sheetMercado();
          });
        }));
        caixa.appendChild(row);
      });

      /* O COLECIONADOR DE SELOS (25/08): o NPC que não regateia. Só chefes
       * derrubam selos; 10 de cada elemento compram UM giro na roleta — uma
       * peça do Traje do Colecionador. A animação NÃO decide nada: o giro
       * (Progress.giraRoleta) resolve primeiro, a roleta só conta a história
       * parando na casa certa. */
      var cfgSel = D().selos;
      if (cfgSel && P().selosVer) {
        var colec = el('div', 'colec-caixa');
        colec.appendChild(el('h3', 'bk-tit', 'O Colecionador de Selos'));
        colec.appendChild(el('p', 'inv-dica',
          'Só chefes derrubam selos — um por elemento. <b>' + cfgSel.porGiro +
          ' de cada</b> compram um giro na roleta: uma peça do <b>Traje do Colecionador</b>. ' +
          'Peça repetida vira matéria de estrela.'));
        var saldo = safe(function () { return P().selosVer(); }, {});
        var fila = el('div', 'colec-selos');
        ['fogo', 'agua', 'terra', 'ar', 'neutro'].forEach(function (e3) {
          var chip = el('div', 'colec-selo' +
            ((saldo[e3] || 0) >= cfgSel.porGiro ? ' is-cheio' : ''));
          chip.style.setProperty('--ec', elemColor(e3));
          chip.appendChild(art('seloIcon', [e3, 18], 18, 'selo-inline'));
          chip.appendChild(el('span', null, '<b>' + (saldo[e3] || 0) + '</b>/' + cfgSel.porGiro +
            ' ' + esc(ELEM_PT[e3] || e3)));
          fila.appendChild(chip);
        });
        colec.appendChild(fila);
        // O ELEMENTO DO TRAJE é seu (pedido 25/08): escolha — e troque — aqui.
        // A escolha reescreve o traje inteiro: filtro, pedra de forja, resists.
        var elAtual = safe(function () { return P().seloElemento(); }, 'neutro');
        var filaEl = el('div', 'colec-elem');
        filaEl.appendChild(el('span', 'pt-trajes-rot', 'O traje responde por:'));
        ['fogo', 'agua', 'terra', 'ar', 'neutro'].forEach(function (e4) {
          var b4 = btn(ELEM_PT[e4] || e4,
            'btn-tab bt-elem' + (elAtual === e4 ? ' is-on' : ''), function () {
              safe(function () { return P().escolheSeloElemento(e4); }, false);
              toast('O Traje do Colecionador agora responde por ' + (ELEM_PT[e4] || e4) + '.', 'good');
              sheetMercado();
            });
          b4.style.setProperty('--ec', elemColor(e4));
          filaEl.appendChild(b4);
        });
        colec.appendChild(filaEl);
        var pronta = safe(function () { return P().roletaPronta(); }, false);
        colec.appendChild(btn('Girar a roleta', 'btn-gold btn-block' + (pronta ? '' : ' is-off'),
          function () {
            var r2 = safe(function () { return P().giraRoleta(); }, null);
            if (!r2) {
              toast(!safe(function () { return P().bagFree(1); }, true)
                ? 'O saco está cheio — abra espaço para o prêmio.'
                : 'Faltam selos para o giro.');
              return;
            }
            var sd3 = setDef(cfgSel.setId);
            var pecas = (sd3 && sd3.pieces) || [];
            var alvoIdx = Math.max(0, pecas.indexOf(r2.itemId));
            var faixa = el('div', 'colec-roleta');
            var cels = pecas.map(function (pid) {
              var c2 = el('div', 'colec-peca');
              c2.appendChild(art('itemIcon', [pid, 48], 48));
              c2.appendChild(el('span', null, esc((itemDef(pid) || {}).name || pid)));
              faixa.appendChild(c2);
              return c2;
            });
            colec.appendChild(faixa);
            var passo = 0, ultimo = 12 + alvoIdx;      // dá as voltas e para no alvo
            (function roda() {
              cels.forEach(function (c3, i4) {
                c3.classList.toggle('is-on', i4 === (passo % cels.length));
              });
              if (passo >= ultimo) {
                toast('A roleta parou: ' + esc((itemDef(r2.itemId) || {}).name) +
                      '! Já está no saco.', 'good');
                setTimeout(function () { sheetMercado(); }, 900);
                return;
              }
              passo++;
              setTimeout(roda, 60 + passo * 16);        // desacelera até parar
            })();
          }));
        caixa.appendChild(colec);
      }
    });
  }

  /* A MESA DE TROCA — duas colunas à la Dofus: a minha oferta (editável) e
   * a dele (espelho). Travar quando satisfeito; os dois travados liberam o
   * Confirmar; QUALQUER mudança destrava os dois. A ficha só desenha o que
   * JOGO.Troca diz — o estado mora lá, e a Rede o carrega. */
  function sheetTroca() {
    sheetName = 'troca';
    var est = JOGO.Troca ? JOGO.Troca.estado() : null;
    var body = sheetShell('Mesa de Troca',
      est ? ('Com ' + (est.nomePar || '?') +
             (est.mesmaConta ? ' — MESMA CONTA: o fluxo anda, nada se move.' : '')) : '');
    if (!est) {
      body.appendChild(el('p', 'inv-dica', 'Nenhuma troca aberta. Toque num jogador na praça.'));
      return;
    }
    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);

    if (est.fase === 'convidei') {
      caixa.appendChild(el('p', 'inv-dica', 'Convite enviado. Esperando ' + esc(est.nomePar) + '…'));
      caixa.appendChild(btn('Cancelar', 'btn-ghost btn-block', function () {
        JOGO.Troca.cancelar(); closeSheet();
      }));
      return;
    }
    if (est.fase !== 'aberta') { closeSheet(); return; }

    function ladoCaixa(rotulo, lado, editavel) {
      var cx = el('div', 'tr-lado' + (lado.travada ? ' is-travada' : ''));
      cx.appendChild(el('h3', 'bk-tit', rotulo +
        (lado.travada ? ' 🔒' : '') + (lado.confirmada ? ' ✓' : '')));
      var linha = el('div', 'tr-itens');
      if (!lado.itens.length) linha.appendChild(el('p', 'inv-dica', 'nada ainda'));
      lado.itens.forEach(function (of, idx) {
        var d2 = (D().items || {})[of.itemId] || {};
        var chip = el('button', 'tr-item');
        chip.type = 'button';
        chip.appendChild(art('itemIcon', [of.itemId, 30], 30));
        chip.appendChild(el('span', null, esc(d2.name || of.itemId) +
          (of.level ? ' +' + of.level : '') + (of.stars ? ' ★' + of.stars : '')));
        if (editavel) {
          chip.title = 'tirar da mesa';
          tap(chip, function () { JOGO.Troca.tiraItem(idx); });
        }
        linha.appendChild(chip);
      });
      cx.appendChild(linha);
      var pTr = el('p', 'tr-moedas', lado.moedas + ' vinténs');
      pTr.insertBefore(art('vintemIcon', [16], 16, 'moeda-inline'), pTr.firstChild);
      cx.appendChild(pTr);
      return cx;
    }

    var duplo = el('div', 'bk2-duplo');
    duplo.appendChild(ladoCaixa('Você dá', est.minha, true));
    duplo.appendChild(ladoCaixa(esc(est.nomePar) + ' dá', est.dele, false));
    caixa.appendChild(duplo);

    // ---- por moedas na mesa
    var linhaM = el('div', 'bk2-botoes');
    var campoM = document.createElement('input');
    campoM.type = 'number'; campoM.min = '0'; campoM.step = '1';
    campoM.className = 'bk2-qtd'; campoM.placeholder = 'vinténs';
    campoM.value = est.minha.moedas || '';
    linhaM.appendChild(campoM);
    linhaM.appendChild(btn('Pôr vinténs', 'btn-mini', function () {
      var n2 = Math.floor(Number(campoM.value || 0));
      if (isFinite(n2) && n2 >= 0) JOGO.Troca.porMoedas(n2);
    }));
    caixa.appendChild(linhaM);

    // ---- o saco, para por itens
    caixa.appendChild(el('h3', 'bk-tit', 'Seu saco — toque para pôr na mesa'));
    var pilhas = safe(function () { return P().invStacks(); }, [])
      .filter(function (s2) { return !!itemDef(s2.itemId); });
    var linhaS = el('div', 'tr-itens');
    if (!pilhas.length) linhaS.appendChild(el('p', 'inv-dica', 'O saco está vazio.'));
    pilhas.forEach(function (pi) {
      var it = itemDef(pi.itemId) || {};
      var chip = el('button', 'tr-item');
      chip.type = 'button';
      chip.appendChild(art('itemIcon', [pi.itemId, 30], 30));
      chip.appendChild(el('span', null, esc(it.name || pi.itemId) +
        (pi.count > 1 ? ' ×' + pi.count : '')));
      tap(chip, function () {
        JOGO.Troca.porItem({ itemId: pi.itemId, level: pi.level, stars: pi.stars });
      });
      linhaS.appendChild(chip);
    });
    caixa.appendChild(linhaS);

    // ---- travar · confirmar · cancelar
    var acoes = el('div', 'bk2-botoes');
    if (!est.minha.travada) {
      acoes.appendChild(btn('Travar minha oferta', 'btn-primary', function () {
        JOGO.Troca.travar();
      }));
    } else if (est.minha.travada && est.dele.travada && !est.minha.confirmada) {
      acoes.appendChild(btn('CONFIRMAR a troca', 'btn-gold', function () {
        JOGO.Troca.confirmar();
      }));
    } else if (est.minha.confirmada) {
      acoes.appendChild(el('span', 'ms-pago', 'esperando o outro confirmar…'));
    } else {
      acoes.appendChild(el('span', 'inv-dica', 'travado — esperando o outro travar'));
    }
    acoes.appendChild(btn('Cancelar', 'btn-ghost', function () {
      JOGO.Troca.cancelar(); closeSheet();
    }));
    caixa.appendChild(acoes);
  }

  /* O PLACAR — os níveis de todo mundo que já cruzou a sua praça, você
   * incluído. A aba Arena espera a Brasa (os duelos): promessa dita, não
   * escondida. */
  function sheetPlacar() {
    sheetName = 'placar';
    var body = sheetShell('Placar do Acampamento',
      'Todo jogador que já cruzou a sua praça deixa a foto da conta aqui.');
    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);
    if (!JOGO.DB) { caixa.appendChild(el('p', 'inv-dica', 'A conta local não carregou.')); return; }

    Promise.all([JOGO.DB.jogador(), JOGO.DB.placarLista(),
                 JOGO.DB.brasaVer ? JOGO.DB.brasaVer() : Promise.resolve(null),
                 JOGO.DB.pocoVer ? JOGO.DB.pocoVer() : Promise.resolve(null)])
    .then(function (r) {
      var eu2 = r[0], lista = r[1] || [], bz = r[2], pv = r[3];
      clear(caixa);

      // A TEMPORADA (25/08): qual é, quando vira, e a GALERIA das já vividas
      if (JOGO.Brasa && JOGO.Brasa.temporadaDe) {
        var linhaT = 'Temporada <b>' + JOGO.Brasa.temporadaDe(Date.now()) +
          '</b> da arena · vira em <b>' + JOGO.Brasa.viraEmDias(Date.now()) + '</b> dia(s)';
        var gal = (bz && bz.galeria) || {};
        var tGal = Object.keys(gal).sort(function (a, b2) { return a - b2; });
        if (tGal.length) {
          linhaT += ' · galeria: ' + tGal.map(function (t2) {
            var nomeC = 'Coroa ' + gal[t2];
            (JOGO.Brasa.TIERS || []).forEach(function (tr) {
              if (tr.nivel === gal[t2]) nomeC = tr.nome;
            });
            return '<b>' + nomeC + '</b> (T' + t2 + ')';
          }).join(' · ');
        }
        if (pv && (pv.recorde > 0 || pv.semanaMelhor > 0)) {
          linhaT += '<br>Poço sem Fundo: andar <b>' + pv.semanaMelhor +
            '</b> nesta semana · recorde da conta <b>' + pv.recorde + '</b>';
        }
        caixa.appendChild(el('p', 'placar-temporada', linhaT));
      }

      var linhas = [{ id: eu2.id, nome: (eu2.nome || 'Você'), titulo: eu2.titulo || '',
                      resumo: safe(resumoDaConta, { classes: {}, total: 0 }), sou: true }];
      lista.forEach(function (e2) {
        if (e2.id === eu2.id) return;              // a minha linha é a viva, não a foto
        linhas.push(e2);
      });
      linhas.sort(function (a, b) {
        return ((b.resumo && b.resumo.total) || 0) - ((a.resumo && a.resumo.total) || 0);
      });

      caixa.appendChild(el('h3', 'bk-tit', 'Níveis (' + linhas.length +
        (linhas.length === 1 ? ' conta' : ' contas') + ')'));
      linhas.forEach(function (e2, i) {
        var row = el('div', 'pl-linha' + (e2.sou ? ' is-eu' : ''));
        row.appendChild(el('span', 'pl-pos', '#' + (i + 1)));
        var tx = el('div', 'ms-tx');
        tx.appendChild(el('div', 'ms-nome', esc(e2.nome) +
          (e2.titulo ? ' <span class="ms-titulo">' + esc(e2.titulo) + '</span>' : '') +
          (e2.sou ? ' <span class="pl-eu">você</span>' : '')));
        var det = [];
        var cls = (e2.resumo && e2.resumo.classes) || {};
        Object.keys(cls).forEach(function (cid) {
          det.push(esc(className(cid)) + ' ' + cls[cid]);
        });
        tx.appendChild(el('div', 'ms-prog', det.length ? det.join(' · ') : 'conta recém-nascida'));
        row.appendChild(tx);
        row.appendChild(el('span', 'pl-total', String((e2.resumo && e2.resumo.total) || 0)));
        caixa.appendChild(row);
      });

      caixa.appendChild(el('h3', 'bk-tit', 'Arena — a Brasa'));
      JOGO.DB.brasaVer().then(function (bz) {
        var arena = [{ id: eu2.id, nome: (eu2.nome || 'Você'), sou: true,
                       pts: bz ? bz.pts : 1000 }];
        lista.forEach(function (e2) {
          if (e2.id === eu2.id) return;
          if (e2.resumo && typeof e2.resumo.brasa === 'number') {
            arena.push({ id: e2.id, nome: e2.nome, pts: e2.resumo.brasa });
          }
        });
        arena.sort(function (a, b) { return b.pts - a.pts; });
        anotaTopoArena(arena.map(function (a) {
          return { id: a.id, resumo: { brasa: a.pts } };
        }), eu2.id);
        arena.forEach(function (a, i) {
          var tier = JOGO.Brasa
            ? JOGO.Brasa.tierDe(a.pts, i === 0) : null;
          var row = el('div', 'pl-linha' + (a.sou ? ' is-eu' : ''));
          row.appendChild(el('span', 'pl-pos', '#' + (i + 1)));
          var tx = el('div', 'ms-tx');
          tx.appendChild(el('div', 'ms-nome', esc(a.nome) +
            (a.sou ? ' <span class="pl-eu">você</span>' : '')));
          tx.appendChild(el('div', 'ms-prog', tier ? tier.nome : '—'));
          row.appendChild(tx);
          row.appendChild(el('span', 'pl-total', String(a.pts)));
          caixa.appendChild(row);
        });
        caixa.appendChild(el('p', 'inv-dica',
          'Elo de verdade: ganhar de quem vale menos paga quase nada, e a Coroa ' +
          'de Fogo exige os pontos E o 1º lugar — não é um número, é um reinado. ' +
          'A Brasa acende em duelo contra OUTRA conta; o duelo de treino mostra ' +
          'quanto valeria.'));
      });
    });
  }

  /* O DUELO DE TREINO — a escolha ÀS CEGAS em três fases no mesmo teclado:
   * A escolhe a dupla, a ficha ESCONDE e pede o teclado, B escolhe, começa.
   * Ninguém vê a dupla do outro: a surpresa é a regra desde o desenho. */
  var dueloFase = null;            // { fase: 'A'|'passe'|'B', duplaA, escolha }
  function sheetDuelo() {
    sheetName = 'duelo';
    if (!dueloFase) dueloFase = { fase: 'A', duplaA: null, escolha: [] };
    var f = dueloFase;
    var body = sheetShell('Arena — duelo de treino',
      f.fase === 'A' ? 'Jogador A: escolha a sua dupla. O B não olha.' :
      f.fase === 'passe' ? 'Dupla escondida. Passe o teclado.' :
      'Jogador B: escolha a sua dupla. A dupla do A está escondida.');
    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);

    if (f.fase === 'passe') {
      caixa.appendChild(el('p', 'du-passe', '🤝'));
      caixa.appendChild(el('p', 'inv-dica',
        'A dupla do Jogador A está guardada. Agora o Jogador B escolhe a dele.'));
      caixa.appendChild(btn('Sou o Jogador B — escolher', 'btn-primary btn-block', function () {
        f.fase = 'B'; f.escolha = [];
        sheetDuelo();
      }));
      return;
    }

    var livres = Object.keys(classes()).filter(isUnlocked);
    var fila = el('div', 'av-fila');
    livres.forEach(function (cid) {
      var card = el('button', 'av-carta' + (f.escolha.indexOf(cid) >= 0 ? ' is-on' : ''));
      card.type = 'button';
      card.appendChild(art('portrait', [cid, { size: 168 }], 84, 'av-pic'));
      card.appendChild(el('span', 'av-nome', esc(className(cid))));
      tap(card, function () {
        var i = f.escolha.indexOf(cid);
        if (i >= 0) f.escolha.splice(i, 1);
        else if (f.escolha.length < 2) f.escolha.push(cid);
        else { toast('A dupla é de dois.'); return; }
        sheetDuelo();
      });
      fila.appendChild(card);
    });
    caixa.appendChild(fila);

    var pronto = f.escolha.length === 2;
    var rotuloBt = f.fase === 'A' ? 'Esconder e passar o teclado' : 'Começar o duelo';
    var bt2 = btn(rotuloBt, 'btn-primary btn-block' + (pronto ? '' : ' is-off'), function () {
      if (!pronto) return;
      if (f.fase === 'A') {
        f.duplaA = f.escolha.slice();
        f.fase = 'passe'; f.escolha = [];
        sheetDuelo();
      } else {
        var a = f.duplaA.slice(), b = f.escolha.slice();
        dueloFase = null;
        closeSheet();
        var ok = safe(function () { return G().startDuel(a, b); }, false);
        if (!ok) toast('a arena não abriu');
      }
    });
    caixa.appendChild(bt2);
  }

  /* O FIM DO DUELO: quem venceu, o clima, e quanto a Brasa teria pago —
   * treino não acende fogo, mas mostra a conta para dar gosto do que vem. */
  function buildDuelFim(data) {
    var s = screens.duelFim;
    clear(s);
    data = data || {};
    var box = el('div', 'game-over du-fim');
    box.appendChild(el('h1', null, data.venceuA ? 'O Lado A venceu!' : 'O Lado B venceu!'));
    var nomes = function (ids) {
      return (ids || []).map(function (c) { return className(c); }).join(' e ');
    };
    box.appendChild(el('p', 'game-sub',
      'Lado A: ' + esc(nomes(data.duplaA)) + ' · Lado B: ' + esc(nomes(data.duplaB)) +
      ' · clima: ' + esc(data.clima || 'calmo')));
    if (data.seValesse != null) {
      box.appendChild(el('p', 'du-valeria',
        'Se valesse a Brasa, o vencedor levaria +' + data.seValesse +
        ' pontos. O fogo de verdade acende em duelo contra outra conta.'));
    }
    box.appendChild(btn('Voltar ao Acampamento', 'btn-primary btn-block', function () {
      navTo('hub');
    }));
    s.appendChild(box);
  }

  function sheetShell(title, sub) {
    clear(sheetEl);
    var panel = el('div', 'sheet-panel');
    var head = el('div', 'sheet-head');
    var t = el('div', 'sheet-head-txt');
    t.appendChild(el('h2', null, esc(title)));
    if (sub) t.appendChild(el('p', null, sub));
    head.appendChild(t);
    head.appendChild(btn('✕', 'btn-icon btn-close', closeSheet));
    panel.appendChild(head);
    var body = el('div', 'sheet-body');
    panel.appendChild(body);
    sheetEl.appendChild(panel);
    sheetEl.classList.add('is-on');
    return body;
  }
  function confirmSheet(title, body, onYes) {
    var b = sheetShell(title);
    sheetName = 'confirm';
    b.appendChild(el('p', 'confirm-txt', body));
    var acts = el('div', 'confirm-acts');
    acts.appendChild(btn('Cancelar', 'btn-ghost', closeSheet));
    acts.appendChild(btn('Confirmar', 'btn-primary', function () { closeSheet(); onYes(); }));
    b.appendChild(acts);
  }

  function openSheet(name, arg) {
    sheetName = name;
    lastSheetArg = arg;          // guardado para UI.repaint() saber o que reabrir
    marcaDock(name);             // o cais acende a aba aberta (30/08)
    // [U6 desfeito a pedido, 25/08] As fichas de meta voltaram a ser MENUS
    // SEPARADOS — "tudo centralizado em um menu só" ficou ruim de usar. Os
    // nomes antigos continuam valendo ('party' abre a última ficha visitada);
    // o cais do Acampamento e o menu inicial chamam cada porta pelo nome.
    if (name === 'gm') { sheetGM(); return; }
    if (name === 'gmcaixa') { sheetGMCaixa(); return; }
    if (name === 'party') sheetParty(null, arg);
    else if (name === 'collection') sheetParty('colecao', arg);
    else if (name === 'inventory') sheetParty('inventario', arg);
    else if (name === 'forge') sheetParty('forja', arg);
    else if (name === 'spells') sheetParty('feiticos', arg);
    else if (name === 'avatar') sheetParty('avatar', arg);
    else if (name === 'heroSheet') sheetHero(arg);
    else if (name === 'battleMenu') sheetBattleMenu();
    else if (name === 'contas') sheetContas();
    else if (name === 'perfil') sheetPerfil(arg);
    else if (name === 'guilda') sheetGuilda();
    else if (name === 'banco') sheetBanco();
    else if (name === 'missoes') sheetMissoes();
    else if (name === 'mercado') sheetMercado();
    else if (name === 'placar') sheetPlacar();
    else if (name === 'troca') sheetTroca();
    else if (name === 'duelo') sheetDuelo();
    else closeSheet();
  }
  UI.openSheet = openSheet;
  UI.closeSheet = closeSheet;

  // ==========================================================================
  // AS FICHAS DE META — inventário · forja · feitiços · coleção · avatar
  // ==========================================================================
  // Já foram abas de uma tela "Personagens" única [U6]; o usuário achou ruim
  // "tudo centralizado em um menu só" (25/08) e cada ficha virou um MENU
  // PRÓPRIO, aberto pelo cais (a barra inferior do Acampamento) ou pela
  // fileira do menu inicial. PARTY_TABS segue sendo a lista canônica: o nome
  // e o subtítulo de cada ficha, e a ordem em que as portas aparecem.
  var PARTY_TABS = [
    { id: 'inventario', nome: 'Inventário',
      sub: 'Um saco só para o grupo. Toque numa peça para vestir no herói ao lado.' },
    { id: 'forja', nome: 'Forja',
      sub: 'Escolha a peça em cima; embaixo, cada caminho no seu cartão — a Pedra sobe o nível, a Estrela funde 3 cópias.' },
    { id: 'feiticos', nome: 'Feitiços',
      sub: 'A árvore inteira da classe: o tronco que todos têm e os quatro galhos elementais.' },
    { id: 'colecao', nome: 'Coleção',
      sub: 'Cartas de chefe liberam classes e, depois, viram estrelas permanentes.' },
    { id: 'avatar', nome: 'Avatar',
      sub: 'O corpo com que você anda no Acampamento. Cada dupla de classes liberadas põe a fusão no guarda-roupa.' }
  ];

  function partyTabDef(id) {
    for (var i = 0; i < PARTY_TABS.length; i++) if (PARTY_TABS[i].id === id) return PARTY_TABS[i];
    return PARTY_TABS[0];
  }

  /* Só entram no carrossel os heróis de classe LIBERADA (pedido do usuário). */
  function partyHeroes() {
    return heroIds().filter(function (hid) {
      var h = hero(hid);
      return !!h && isUnlocked(h.classId || hid);
    });
  }
  /* O carrossel navega SÓ A DUPLA (30/08: "o inventário está meio confuso
   * com todos os personagens") — quem não desce não aparece vestindo peça.
   * Sem dupla escolhida (página de teste, atalho), cai nos liberados. */
  function duplaViva() {
    return selHeroes.filter(function (hid) { return !!hero(hid); });
  }
  function ensurePartyHero() {
    var lista = duplaViva();
    if (!lista.length) lista = partyHeroes();
    if (!lista.length) { partyHero = null; return null; }
    if (partyHero === null || lista.indexOf(partyHero) < 0) partyHero = lista[0];
    return partyHero;
  }

  function sheetParty(tab, arg) {
    if (tab) partyTab = tab;
    sheetName = 'party';
    var def = partyTabDef(partyTab);
    var body = sheetShell(def.nome, def.sub);
    // larga SEMPRE: os saltos internos (saco → forja, ficha → inventário)
    // não podem fazer o painel pular de tamanho debaixo do dedo
    var painelP = sheetEl.querySelector('.sheet-panel');
    if (painelP) painelP.classList.add('sheet-larga');

    if (partyTab === 'forja') forgeBody(body, arg);
    else if (partyTab === 'colecao') collectionBody(body, arg);
    else if (partyTab === 'feiticos') spellTreeBody(body, arg);
    else if (partyTab === 'avatar') avatarBody(body);
    else inventoryBody(body, arg);
  }
  // ------------------------------------------------- ÁRVORE DE FEITIÇOS
  // A ficha do herói já listava "o que vem depois", mas em lista corrida: dava
  // para ler o próximo degrau e não dava para ENXERGAR a escada inteira nem
  // comparar os quatro elementos lado a lado. Aqui a mesma informação vira
  // grade — tronco em cima, quatro galhos embaixo, um nível por linha.
  var TREE_ELEMS = ['fogo', 'agua', 'terra', 'ar'];

  /* Os degraus saem dos DADOS (unlockLevel de cada feitiço do caminho), não de
   * uma lista fixa aqui: quando a escada da classe ganhou os degraus 10 e 15,
   * esta grade acompanhou sozinha. */
  function tiersDaClasse(def) {
    var vistos = {}, fora = [];
    TREE_ELEMS.forEach(function (e) {
      ((def.paths || {})[e] || []).forEach(function (sid) {
        var d2 = spellDef(sid);
        var lv = (d2 && d2.unlockLevel) || 0;
        if (lv && !vistos[lv]) { vistos[lv] = 1; fora.push(lv); }
      });
    });
    return fora.sort(function (a, b) { return a - b; });
  }
  function feiticoDoDegrau(def, elemento, lv) {
    var caminho = (def.paths || {})[elemento] || [];
    for (var i = 0; i < caminho.length; i++) {
      var d2 = spellDef(caminho[i]);
      if (d2 && d2.unlockLevel === lv) return caminho[i];
    }
    return null;
  }

  function spellTreeBody(body) {
    var hid = ensurePartyHero();
    body.appendChild(heroCarousel(hid));
    if (!hid) return;

    var h = hero(hid) || {};
    var cid = h.classId || hid;
    var def = classDef(cid) || {};
    var nivel = h.level || 1;
    var escolhido = (h.element && h.element !== 'neutro') ? h.element : null;
    var lvEscolha = (D().leveling || {}).elementChoiceLevel || 5;

    // ---- legenda: o que cada cor quer dizer
    var leg = el('div', 'tree-legend');
    [['aberto', 'já sabe'], ['proximo', 'o próximo'],
     ['trancado', 'falta nível'], ['descartado', 'outro caminho']].forEach(function (p) {
      var t = el('span', 'tl-item');
      t.appendChild(el('i', 'tl-dot is-' + p[0]));
      t.appendChild(el('span', null, esc(p[1])));
      leg.appendChild(t);
    });
    body.appendChild(leg);
    body.appendChild(el('p', 'hs-hint',
      'Toque num feitiço para ler a descrição completa.'));

    // ---- tronco: o que a classe tem de saída, valha qual elemento valer
    var base = (def.baseSpells || def.spells || []);
    if (base.length) {
      body.appendChild(el('h3', 'hs-sec', 'Tronco · todo ' + className(cid) + ' tem'));
      var tronco = el('div', 'arv-tronco');
      base.forEach(function (sid) { tronco.appendChild(chipDoTronco(sid)); });
      body.appendChild(tronco);
    }

    // ---- galhos
    body.appendChild(el('h3', 'hs-sec', escolhido
      ? 'Galho de ' + (ELEM_PT[escolhido] || escolhido)
      : 'Quatro galhos · a escolha é no nível ' + lvEscolha));
    if (!escolhido) {
      body.appendChild(el('p', 'hs-hint',
        'Enquanto o elemento não é escolhido os quatro caminhos seguem abertos. ' +
        'Depois da escolha, ela é permanente.'));
    }

    /* A ÁRVORE de verdade: quatro COLUNAS verticais, uma por elemento, cada
     * uma tingida pela cor dele — cabeçalho colorido, nós encadeados por um
     * FIO. O degrau vai num SELO em cada nó (Nv 3), não numa régua à
     * esquerda: régua alinhada obrigava casas vazias tracejadas onde o galho
     * não tem feitiço, e a grade lia como planilha, não como árvore. */
    var proximo = {};
    var degraus = tiersDaClasse(def);
    TREE_ELEMS.forEach(function (e) {
      for (var i = 0; i < degraus.length; i++) {
        if (nivel < degraus[i]) { proximo[e] = degraus[i]; break; }
      }
    });

    var arv = el('div', 'arv');
    TREE_ELEMS.forEach(function (e) {
      var col = el('div', 'arv-col');
      col.style.setProperty('--ec', elemColor(e));
      if (escolhido && e !== escolhido) col.classList.add('is-descartada');
      if (escolhido && e === escolhido) col.classList.add('is-atual');
      col.appendChild(el('div', 'arv-cab', esc(ELEM_PT[e] || e)));
      var fio = el('div', 'arv-fio');
      degraus.forEach(function (lv) {
        var sid = feiticoDoDegrau(def, e, lv);
        if (!sid) return;              // degrau sem feitiço NESTE galho: nada de casa vazia
        // Sem elemento escolhido NADA do galho está aberto, mesmo que o nível
        // já dê: o feitiço só entra na mão depois da escolha.
        var estado;
        if (escolhido && e !== escolhido) estado = 'descartado';
        else if (escolhido && nivel >= lv) estado = 'aberto';
        else if (proximo[e] === lv) estado = 'proximo';
        else estado = 'trancado';
        fio.appendChild(noDaArvore(sid, lv, estado));
      });
      col.appendChild(fio);
      arv.appendChild(col);
    });
    body.appendChild(arv);
  }

  /* A ficha CURTA de um feitiço: custo, alcance, área. É o que cabe num nó
   * sem virar muro de texto — a descrição completa vive no tooltip, que abre
   * por toque (o aviso debaixo da legenda ensina). */
  function fichaCurta(d2) {
    if (!d2) return '';
    var f = (d2.paCost || 0) + ' PA';
    if (d2.range) f += ' · ' + (d2.range.min || 0) + '–' + (d2.range.max || 0);
    if (d2.aoe && d2.aoe.shape && d2.aoe.shape !== 'single') {
      f += ' · ' + d2.aoe.shape + (d2.aoe.size ? ' ' + d2.aoe.size : '');
    }
    return f;
  }

  /* Um NÓ do galho: ícone num anel da cor do elemento, nome, ficha curta e o
   * SELO do degrau — dourado quando é "o próximo", que é o que o jogador
   * procura na árvore. */
  function noDaArvore(sid, lv, estado) {
    var d2 = spellDef(sid);
    var no = el('div', 'arv-no is-' + estado);
    if (d2 && d2.element) no.style.setProperty('--ec', elemColor(d2.element));
    var anel = el('div', 'arv-anel');
    anel.appendChild(art('spellIcon', [d2 || sid, 40], 40,
      estado === 'aberto' ? '' : 'silhouette'));
    no.appendChild(anel);
    var tx = el('div', 'arv-tx');
    tx.appendChild(el('div', 'arv-nm', esc(spellName(d2, sid))));
    var f = fichaCurta(d2);
    if (f) tx.appendChild(el('div', 'arv-fi', esc(f)));
    no.appendChild(tx);
    no.appendChild(el('span', 'arv-lv', 'Nv ' + lv));
    if (d2) tipOn(no, spellName(d2, sid), spellTipBody(d2, sid), elemColor(d2.element));
    return no;
  }

  /* Um chip do TRONCO: todo mundo da classe tem, então não há estado — só
   * ícone, nome e ficha curta, lado a lado. */
  function chipDoTronco(sid) {
    var d2 = spellDef(sid);
    var chip = el('div', 'arv-chip');
    if (d2 && d2.element) chip.style.setProperty('--ec', elemColor(d2.element));
    chip.appendChild(art('spellIcon', [d2 || sid, 34], 34));
    var tx = el('div', 'arv-tx');
    tx.appendChild(el('div', 'arv-nm', esc(spellName(d2, sid))));
    var f = fichaCurta(d2);
    if (f) tx.appendChild(el('div', 'arv-fi', esc(f)));
    chip.appendChild(tx);
    if (d2) tipOn(chip, spellName(d2, sid), spellTipBody(d2, sid), elemColor(d2.element));
    return chip;
  }

  // -------------------------------------------------------------- COLEÇÃO
  // O cofre de recompensas: cartas por classe, custo, e a trilha de 5 estrelas
  // com o próximo bônus em destaque. ORDEM (pedido do usuário): liberadas
  // primeiro; as trancadas em seguida, da que menos falta para a que mais falta.
  function collectionBody(body, focusId) {
    var cfg = starsCfg();
    var legend = el('div', 'col-legend');
    for (var s = 1; s <= (cfg.max || 5); s++) {
      var bn = cfg.bonuses && (cfg.bonuses[s] || cfg.bonuses[String(s)]);
      legend.appendChild(el('span', 'chip', '★' + s + ' ' + esc(bonusText(bn))));
    }
    body.appendChild(legend);

    var ids = Object.keys(classes());
    ids.sort(function (a, b) {
      var A = cardInfo(a), B = cardInfo(b);
      if (A.unlocked !== B.unlocked) return A.unlocked ? -1 : 1;   // liberadas na frente
      if (!A.unlocked) {                                           // depois, por quanto falta
        var fa = Math.max(0, A.unlockCost - A.cards);
        var fb = Math.max(0, B.unlockCost - B.cards);
        if (fa !== fb) return fa - fb;
      }
      return A.unlockCost - B.unlockCost;
    });
    var list = el('div', 'col-list');
    ids.forEach(function (cid) {
      var info = cardInfo(cid);
      var row = el('div', 'col-row' + (info.unlocked ? '' : ' is-locked') +
                          (cid === focusId ? ' is-focus' : ''));
      var pic = el('div', 'col-pic');
      pic.appendChild(art('cardIcon', [cid, 92, 130], 92));
      if (!info.unlocked) pic.classList.add('silhouette');
      row.appendChild(pic);

      var txt = el('div', 'col-txt');
      var h3 = el('h3', null, esc(info.name));
      if (info.unlocked) h3.appendChild(el('span', 'chip chip-ok', 'liberada'));
      txt.appendChild(h3);
      var def = classDef(cid) || {};
      txt.appendChild(el('p', 'col-role', esc(def.role || '') + (def.description ? ' — ' + esc(def.description) : '')));

      // progresso de desbloqueio
      if (!info.unlocked) {
        var faltam = Math.max(0, info.unlockCost - info.cards);
        txt.appendChild(bar('bar-card', info.unlockCost ? info.cards / info.unlockCost : 0,
          info.cards + ' / ' + info.unlockCost + ' cartas'));
        txt.appendChild(el('p', 'col-faltam', 'Faltam <b>' + faltam + '</b> carta' +
          (faltam === 1 ? '' : 's') + ' para liberar.'));
      } else {
        txt.appendChild(el('div', 'col-cards', '<b>' + info.cards + '</b> cartas guardadas' +
          (info.unlockCost ? ' · custou ' + info.unlockCost : '')));
      }

      // trilha de estrelas com o próximo bônus
      var tr = el('div', 'star-track');
      var costs = (D().cards && D().cards[cid] && D().cards[cid].starCosts) || [5, 15, 30, 55, 90];
      for (var i2 = 0; i2 < (cfg.max || 5); i2++) {
        var on = i2 < info.stars;
        var stp = el('div', 'star-step' + (on ? ' is-on' : '') +
                     (info.next && info.next.star === i2 + 1 ? ' is-next' : ''));
        stp.appendChild(art('starIcon', [on, 26], 26));
        var bn2 = cfg.bonuses && (cfg.bonuses[i2 + 1] || cfg.bonuses[String(i2 + 1)]);
        stp.appendChild(el('span', 'star-b', esc(bonusText(bn2))));
        tipOn(stp, '★' + (i2 + 1), 'Custa <b>' + costs[i2] + '</b> cartas além do desbloqueio.<br>Dá: ' +
          esc(bonusText(bn2)) + '.', on ? '#ffc44d' : '#8b93a0');
        tr.appendChild(stp);
      }
      txt.appendChild(tr);
      if (info.next) {
        txt.appendChild(el('p', 'col-next', 'Faltam <b>' + info.next.faltam + '</b> cartas para a ★' + info.next.star + '.'));
      } else if (info.unlocked) {
        txt.appendChild(el('p', 'col-next is-max', 'Todas as estrelas conquistadas.'));
      }
      row.appendChild(txt);
      list.appendChild(row);
    });
    body.appendChild(list);

    // ---- OS BICHOS (03/09): cartas, estrelas (máx 3) e nível (máx 10) de
    // cada pet — a mesma gramática das classes, na mesma tela
    var pdefs = D().pets || {};
    var pids = Object.keys(pdefs);
    if (pids.length) {
      var hb = el('h3', 'col-sub', 'Bichos');
      hb.style.cssText = 'margin:14px 0 6px;font:700 15px Georgia,serif;color:var(--gold-2,#e8c25a)';
      body.appendChild(hb);
      body.appendChild(el('p', 'col-role', 'Cartas de bicho caem só do chefe — e é difícil. ' +
        '5 cartas: o bicho é seu. Depois, +10 / +15 / +20 viram estrelas; o nível sobe com o XP do dono, até o 10.'));
      var lp = el('div', 'col-list');
      var custos = safe(function () { return P().PET_STAR_COSTS; }, null) || [10, 25, 45];
      pids.forEach(function (pid) {
        var pdx = pdefs[pid], info = petCardInfo(pid), xi = petXpInfo(pid);
        var row = el('div', 'col-row' + (info.unlocked ? '' : ' is-locked'));
        var pic = el('div', 'col-pic');
        pic.appendChild(art('petIcon', [pid, 92], 92));
        if (!info.unlocked) pic.classList.add('silhouette');
        row.appendChild(pic);
        var txt = el('div', 'col-txt');
        var h3 = el('h3', null, esc(pdx.name));
        if (info.unlocked) h3.appendChild(el('span', 'chip chip-ok', 'Nv ' + info.level));
        txt.appendChild(h3);
        txt.appendChild(el('p', 'col-role', esc(bonusText(pdx.bonuses)) +
          (info.mult > 1 ? ' × ' + info.mult.toFixed(2) : '')));
        if (!info.unlocked) {
          var faltamP = Math.max(0, info.unlockCost - info.cards);
          txt.appendChild(bar('bar-card', info.unlockCost ? info.cards / info.unlockCost : 0,
            info.cards + ' / ' + info.unlockCost + ' cartas'));
          txt.appendChild(el('p', 'col-faltam', 'Faltam <b>' + faltamP + '</b> carta' +
            (faltamP === 1 ? '' : 's') + ' para o bicho.'));
        } else {
          txt.appendChild(bar('bar-xp', xi.frac, xi.max ? 'Nv 10 — no topo' : 'Nv ' + xi.level + ' · faltam ' + xi.faltam + ' XP'));
          txt.appendChild(el('div', 'col-cards', '<b>' + info.cards + '</b> cartas guardadas'));
        }
        var tr = el('div', 'star-track');
        for (var s2 = 0; s2 < info.maxStars; s2++) {
          var on2 = s2 < info.stars;
          var stp2 = el('div', 'star-step' + (on2 ? ' is-on' : '') +
                        (info.next && info.next.star === s2 + 1 ? ' is-next' : ''));
          stp2.appendChild(art('starIcon', [on2, 26], 26));
          stp2.appendChild(el('span', 'star-b', '+15% bônus'));
          tipOn(stp2, '★' + (s2 + 1), 'Custa <b>' + custos[s2] + '</b> cartas além das 5 do bicho.<br>' +
            'Dá: +15% nos bônus ao dono e +15 de poder ao corpo dele.', on2 ? '#ffc44d' : '#8b93a0');
          tr.appendChild(stp2);
        }
        txt.appendChild(tr);
        if (info.next) txt.appendChild(el('p', 'col-next', 'Faltam <b>' + info.next.faltam + '</b> cartas para a ★' + info.next.star + '.'));
        else txt.appendChild(el('p', 'col-next is-max', 'Todas as estrelas conquistadas.'));
        row.appendChild(txt);
        lp.appendChild(row);
      });
      body.appendChild(lp);
    }
    if (focusId) {
      var f = list.querySelector('.is-focus');
      if (f && f.scrollIntoView) f.scrollIntoView({ block: 'center' });
    }
  }

  function bonusText(b) {
    if (!b) return '—';
    var out = [];
    if (b.hp) out.push('+' + b.hp + ' PV');
    if (b.pa) out.push('+' + b.pa + ' PA');
    if (b.pp) out.push('+' + b.pp + ' PP');
    if (b.power) out.push('+' + b.power + ' poder');
    if (b.initiative) out.push('+' + b.initiative + ' iniciativa');
    if (b.dodge) out.push('+' + b.dodge + ' esquiva');
    if (b.lock) out.push('+' + b.lock + ' fixação');
    if (b.resists) {
      for (var e in b.resists) {
        if (b.resists.hasOwnProperty(e)) out.push('+' + b.resists[e] + '% ' + (ELEM_PT[e] || e));
      }
    }
    return out.join(' · ') || '—';
  }

  // ------------------------------------------------------- tier da forja
  function tierOf(level) {
    var tiers = upgradeCfg().tiers || [];
    for (var i = 0; i < tiers.length; i++) {
      if (level >= tiers[i].from && level <= tiers[i].to) return tiers[i].name;
    }
    return 'Comum';
  }
  function tierClass(level) {
    return 't-' + String(tierOf(level)).toLowerCase().replace('í', 'i').replace('é', 'e');
  }

  function itemTipBody(itemId, level, stars) {
    var it = itemDef(itemId);
    if (!it) return 'Item ' + esc(itemId) + '.';
    var lv = level == null ? safe(function () { return P().itemLevel(itemId); }, 0) : level;
    var sr = stars == null ? safe(function () { return P().itemStars(itemId); }, 0) : stars;
    var mult = itemMult(lv, sr);
    var out = '<i>' + esc(SLOT_PT[slotOf(itemId)] || '') + ' · ' + esc(RAR_PT[it.rarity] || it.rarity) +
              (lv ? ' · <b>+' + lv + '</b> ' + esc(tierOf(lv)) : '') +
              (sr ? ' · <b>★' + sr + '</b>' : '') + '</i>';
    var b = it.bonuses || {}, lines = [];
    for (var k in b) {
      if (!b.hasOwnProperty(k)) continue;
      if (k === 'resists') {
        for (var e in b.resists) {
          if (b.resists.hasOwnProperty(e)) lines.push('+' + Math.round(b.resists[e] * mult) + '% ' + (ELEM_PT[e] || e));
        }
      } else {
        var v = (k === 'pa' || k === 'pp') ? b[k] : Math.round(b[k] * mult);
        lines.push('+' + v + ' ' + ({ hp: 'PV', pa: 'PA', pp: 'PP', power: 'poder',
                                      initiative: 'iniciativa', dodge: 'esquiva', lock: 'fixação' }[k] || k));
      }
    }
    if (lines.length) out += '<br>' + lines.join(' · ');
    if (it.grantsSpell) {
      var sp = spellDef(it.grantsSpell);
      out += '<br>Concede: <b>' + esc(spellName(sp, it.grantsSpell)) + '</b>' +
             (sp && sp.paCost ? ' <i>(' + sp.paCost + ' PA)</i>' : '');
    }
    if (it.setId) {
      var sd = setDef(it.setId);
      out += '<br>Conjunto: <b>' + esc((sd && sd.name) || it.setId) + '</b> · ' +
             setEquippedCount(it.setId) + '/' + setPieceCount(it.setId) + ' vestidas';
    }
    if (it.description) out += '<br>' + esc(it.description);
    return out;
  }

  /* o Traje do Colecionador está FECHADO? (acende a aura e viaja na Rede) */
  function temAuraSelos() {
    var cfg = D().selos;
    if (!cfg || !cfg.setId) return false;
    return setEquippedCount(cfg.setId) >= setPieceCount(cfg.setId);
  }

  // quantas peças do conjunto estão equipadas (por qualquer herói)
  function setEquippedCount(setId) {
    var sd = setDef(setId);
    var pieces = (sd && sd.pieces) || [];
    var n = 0;
    for (var i = 0; i < pieces.length; i++) if (equippedBy(pieces[i])) n++;
    if (!pieces.length) {
      // sem lista de peças: conta pelos itens que declaram o mesmo setId
      var items = D().items || {};
      for (var k in items) {
        if (items.hasOwnProperty(k) && items[k].setId === setId && equippedBy(k)) n++;
      }
    }
    return n;
  }
  function setPieceCount(setId) {
    var sd = setDef(setId);
    if (sd && sd.pieces) return sd.pieces.length;
    var items = D().items || {}, n = 0;
    for (var k in items) if (items.hasOwnProperty(k) && items[k].setId === setId) n++;
    return n || 4;
  }
  // quantas cópias (somando pilhas) existem no SACO — para o painel do conjunto
  function bagCountOf(itemId) {
    var pilhas = safe(function () { return P().invStacks(); }, []);
    var n = 0;
    for (var i = 0; i < pilhas.length; i++) {
      if (pilhas[i].itemId === itemId) n += (pilhas[i].count || 1);
    }
    return n;
  }

  /* O ❖ DO CONJUNTO (pedido do usuário, 24/08): toda peça de traje ganha o
   * símbolo no canto inferior do ícone. Cinza = nenhum bônus valendo, azul =
   * 2+ vestidas (bônus ativo), dourado = traje fechado. Tocar abre o painel
   * com as peças e os bônus; `mudo` desliga o toque onde a célula já tem
   * gesto próprio (o arrasto do banco) — lá o símbolo é só leitura. */
  function setBadge(itemId, mudo) {
    var it = itemDef(itemId);
    var sd = it && it.setId ? setDef(it.setId) : null;
    if (!sd || !sd.bonuses) return null;
    var n = setEquippedCount(it.setId);
    var cls = n >= setPieceCount(it.setId) ? ' is-cheio' : (n >= 2 ? ' is-meio' : '');
    var bg = el('span', 'ig-set' + cls + (mudo ? ' is-mudo' : ''), '❖');
    if (!mudo) {
      tap(bg, function () {
        showTip(bg, sd.name || it.setId, setTipBody(it.setId), elemColor(sd.element));
      });
    }
    return bg;
  }

  // ------------------------------------------------------------ INVENTÁRIO
  // Uma GRADE grande: um espaço por variante de peça, com contador ×N quando há
  // repetidas. Em cima dela, o herói da vez (setas para passar de um para outro,
  // só os liberados) com os quatro espaços e o do bicho.
  // Equipar TIRA a peça da grade — ela passa a pertencer àquele herói até ser
  // desequipada, e desequipar devolve a MESMA cópia (com forja e estrelas).
  //
  // DUAS CORES NO MESMO ITEM, e elas não podem brigar [U7]:
  //   · RARIDADE  → borda e halo (`markRarity`, como no resto do jogo);
  //   · ESTRELA   → FUNDO da célula (★1 cinza · ★2 azul · ★3 amarelo).
  // O ícone senta numa placa escura por cima do fundo colorido, para a borda
  // dourada da lendária não sumir no amarelo do ★3.
  function starClass(stars) { return 'sq' + Math.max(0, Math.min(3, Math.floor(stars || 0))); }
  function starPips(stars) {
    var w = el('span', 'item-stars');
    var n = Math.max(0, Math.floor(stars || 0));
    for (var i = 0; i < n; i++) w.appendChild(el('i', null, '★'));
    return w;
  }
  function itemMult(level, stars) {
    return safe(function () { return P().itemMult(level, stars); },
                1 + (upgradeCfg().bonusPerLevel || 0.12) * (level || 0));
  }
  var STAT_PT = { hp: 'PV', pa: 'PA', pp: 'PP', power: 'poder', initiative: 'iniciativa',
                  dodge: 'esquiva', lock: 'fixação' };
  // O que a peça dá, JÁ com forja e estrelas — texto, não balãozinho: no celular
  // ninguém passa o mouse, e esta é a informação que decide o toque.
  function itemBonusText(it, level, stars) {
    if (!it) return '—';
    var mult = itemMult(level, stars);
    var b = it.bonuses || {}, out = [], k;
    for (k in b) {
      if (!b.hasOwnProperty(k)) continue;
      if (k === 'resists') {
        for (var e in b.resists) {
          if (b.resists.hasOwnProperty(e)) out.push('+' + Math.round(b.resists[e] * mult) + '% ' + (ELEM_PT[e] || e));
        }
      } else {
        var v = (k === 'pa' || k === 'pp') ? b[k] : Math.round(b[k] * mult);
        out.push('+' + v + ' ' + (STAT_PT[k] || k));
      }
    }
    return out.join(' · ') || '—';
  }

  function inventoryBody(body, preselect) {
    var hid = ensurePartyHero();
    if (typeof preselect === 'string' && preselect) {
      var pilha0 = pilhaDe(preselect);
      if (pilha0) invSel = { itemId: pilha0.itemId, level: pilha0.level, stars: pilha0.stars };
    }
    /* O desenho clássico de MMORPG: o PERSONAGEM à esquerda — retrato com as
     * setas ‹ ›, nível, e o equipamento vestido em boneco — e o SACO à
     * direita. No estreito as colunas voltam a ser pilha (CSS). */
    var duo = el('div', 'pt-mmo');
    var ladoHeroi = el('div', 'pt-mmo-heroi');
    ladoHeroi.appendChild(heroCarousel(hid));
    if (hid) ladoHeroi.appendChild(equipRow(hid));
    // TRAJES (25/08): duas fotos do equipamento por herói — vestir com um
    // toque, guardar o atual com outro
    if (hid) {
      var tr = el('div', 'pt-trajes');
      tr.appendChild(el('span', 'pt-trajes-rot', 'Trajes:'));
      [1, 2].forEach(function (n) {
        var tem = safe(function () {
          var hh = hero(hid);
          return !!(hh && hh.trajes && hh.trajes['t' + n]);
        }, false);
        var b = btn('Vestir ' + n, 'btn-mini' + (tem ? '' : ' is-off'), function () {
          var r = safe(function () { return P().wearTraje(hid, n); }, null);
          if (!r) return;
          toast(r.faltas
            ? 'Traje ' + n + ': ' + r.faltas + ' peça(s) não estavam no saco.'
            : 'Traje ' + n + ' vestido.', r.faltas ? undefined : 'good');
          sheetParty('inventario');
        });
        if (!tem) b.title = 'Guarde o traje ' + n + ' primeiro';
        tr.appendChild(b);
      });
      tr.appendChild(el('span', 'pt-trajes-rot', 'guardar o atual em:'));
      [1, 2].forEach(function (n) {
        tr.appendChild(btn(String(n), 'btn-mini btn-ghost', function () {
          safe(function () { return P().saveTraje(hid, n); }, false);
          toast('Equipamento atual guardado como traje ' + n + '.', 'good');
          sheetParty('inventario');
        }));
      });
      ladoHeroi.appendChild(tr);
    }
    var ladoSaco = el('div', 'pt-mmo-saco');
    ladoSaco.appendChild(pickBar(hid));
    ladoSaco.appendChild(invFilterTabs());
    ladoSaco.appendChild(elemTabs(invElemFiltro, function (e2) {
      invElemFiltro = e2;
      sheetParty('inventario');
    }));
    // O FUNDO DO SACO à vista (25/08): unidades / limite, amarelando perto
    // do fim e avermelhando cheio — e a regra dita, para o limite não
    // parecer castigo: ele cresce com as classes.
    var lot = safe(function () {
      return { n: P().state.inventory.length, max: P().bagLimit() };
    }, null);
    if (lot) {
      ladoSaco.appendChild(el('div',
        'inv-lotacao' + (lot.n >= lot.max ? ' is-cheio'
                        : (lot.n >= lot.max * 0.85 ? ' is-quase' : '')),
        'Saco: <b>' + lot.n + ' / ' + lot.max + '</b> — o limite cresce ao liberar classes'));
    }
    var g = invGrid(hid);
    ladoSaco.appendChild(buscaInput(invBusca, function (t) {
      invBusca = t;
      aplicaBusca(g, t);
    }));
    if (g.dataset && g.dataset.vazio) {
      ladoSaco.appendChild(el('p', 'inv-dica', g.dataset.vazio));
    }
    ladoSaco.appendChild(g);
    if (invBusca) aplicaBusca(g, invBusca);
    duo.appendChild(ladoHeroi);
    duo.appendChild(ladoSaco);
    body.appendChild(duo);
  }

  // ------------------------------------------------- O GUARDA-ROUPA (avatar)
  /* Toda dupla de classes LIBERADAS oferece o corpo da fusão; o padrão é o
   * líder da dupla. A escolha grava na conta e, se o Acampamento está na
   * tela, ele renasce com o corpo novo na hora — ver é o ponto. */
  /* A foto da conta para o PLACAR: classes liberadas com nível, e a soma.
   * É o que viaja no oi/eco da Rede e o que a ficha do placar mostra. */
  /* O PORTÃO DA COROA: só o 1º do placar da arena carrega a Coroa de Fogo.
   * A resposta vem do último placar LIDO (cache síncrono): quem acabou de
   * virar topo vê a Coroa na próxima visita ao Acampamento — atraso de uma
   * tela, e o portão continua de pé. */
  var topoArenaCache = null;         // { souEu } da última leitura do placar
  function souTopoDaArena() {
    return !!(topoArenaCache && topoArenaCache.souEu);
  }
  function anotaTopoArena(linhas, meuId) {
    var melhor = null;
    linhas.forEach(function (e2) {
      var pts = (e2.resumo && typeof e2.resumo.brasa === 'number') ? e2.resumo.brasa : null;
      if (pts === null) return;
      if (!melhor || pts > melhor.pts) melhor = { id: e2.id, pts: pts };
    });
    topoArenaCache = { souEu: !!(melhor && melhor.id === meuId) };
  }

  function resumoDaConta() {
    var classes2 = {}, total = 0;
    heroIds().forEach(function (hid) {
      var hh = hero(hid);
      if (!hh || !isUnlocked(hh.classId || hid)) return;
      var lv = hh.level || 1;
      classes2[hh.classId || hid] = lv;
      total += lv;
    });
    return { classes: classes2, total: total,
             brasa: resumoBrasaPts, partidas: resumoBrasaPartidas,
             galeria: resumoGaleria, poco: resumoPoco, guilda: resumoGuilda };
  }
  /* os pontos de brasa entram no resumo por fora (são assíncronos no DB);
   * buildHub os carrega antes de ligar a Rede */
  var resumoBrasaPts = 1000, resumoBrasaPartidas = 0, resumoGaleria = null,
      resumoPoco = null, resumoGuilda = null;

  function paresDeAvatar() {
    var ids = Object.keys(classes()).filter(isUnlocked).sort();
    var fora = [];
    for (var a = 0; a < ids.length; a++) {
      for (var b = a + 1; b < ids.length; b++) {
        fora.push('fus:' + ids[a] + '+' + ids[b]);
      }
    }
    return fora;
  }
  function nomeDoPar(defId) {
    var par = String(defId).slice(4).split('+');
    return className(par[0]) + ' + ' + className(par[1]);
  }

  function avatarBody(body) {
    var caixa = el('div', 'av-caixa');
    body.appendChild(caixa);
    var DBc = JOGO.DB;
    if (!DBc) { caixa.appendChild(el('p', 'inv-dica', 'A conta local não carregou.')); return; }

    DBc.jogador().then(function (j) {
      clear(caixa);
      var atual = j.avatar || null;

      function cartao(valor, rotulo, defIdRetrato) {
        var card = el('button', 'av-carta' + ((atual === valor) ? ' is-on' : ''));
        card.type = 'button';
        card.appendChild(art('portrait', [defIdRetrato, { size: 168 }], 84, 'av-pic'));
        card.appendChild(el('span', 'av-nome', esc(rotulo)));
        if (valor) card.appendChild(el('span', 'av-porte', '3,00 m'));
        tap(card, function () {
          DBc.definirAvatar(valor).then(function (res) {
            toast(res.avatar
              ? 'Agora você anda como ' + nomeDoPar(res.avatar) + '.'
              : 'De volta ao corpo do líder.', 'good');
            // se o Acampamento está na tela, o corpo troca AGORA — ver é o ponto
            if (current === 'hub') UI.showScreen('hub');
            else sheetParty('avatar');
          });
        });
        return card;
      }

      var fila = el('div', 'av-fila');
      var lider = selHeroes[0] || ensurePartyHero() || 'sumo';
      fila.appendChild(cartao(null, 'Seu líder — ' + className(lider), lider));
      paresDeAvatar().forEach(function (defId) {
        fila.appendChild(cartao(defId, nomeDoPar(defId), defId));
      });
      caixa.appendChild(fila);
      if (fila.children.length === 1) {
        caixa.appendChild(el('p', 'inv-dica',
          'Liberou duas classes? A fusão delas entra aqui.'));
      }
    });
  }

  function pilhaDe(itemId) {
    var pilhas = safe(function () { return P().invStacks(); }, []);
    for (var i = 0; i < pilhas.length; i++) if (pilhas[i].itemId === itemId) return pilhas[i];
    return null;
  }
  function pilhaSel() {
    if (!invSel) return null;
    var pilhas = safe(function () { return P().invStacks(); }, []);
    for (var i = 0; i < pilhas.length; i++) {
      var s = pilhas[i];
      if (s.itemId === invSel.itemId && s.level === invSel.level && s.stars === invSel.stars) return s;
    }
    return null;
  }

  // ---- carrossel de heróis: SÓ os liberados, com seta para os lados
  /* Depois de mexer na dupla: se o LÍDER mudou e o Acampamento está na tela,
   * ele renasce com o corpo novo andando (Hub.entrar troca o corpo; a ficha
   * fecha, porque o que o jogador quer ver agora é o herói lá fora). Nas
   * trocas que não mudam quem anda, a ficha só redesenha. */
  function duplaMudou(liderAntes) {
    var liderAgora = selHeroes[0] || null;
    if (current === 'hub' && liderAgora && liderAgora !== liderAntes) {
      UI.showScreen('hub');
      toast(className(liderAgora) + ' agora anda no acampamento.', 'good');
    } else {
      sheetParty(partyTab);
    }
  }

  /* O slot em troca: null fechado; 0/1 = trocar o membro; 'add' = pôr o 2º */
  var duplaTrocaAberta = null;

  function heroCarousel(hid) {
    var dupla = duplaViva();
    var soltos = !dupla.length;               // página sem dupla: liberados
    var lista = soltos ? partyHeroes() : dupla;
    var wrap = el('div', 'pt-hero-caixa');
    if (!lista.length || !hid) {
      wrap.appendChild(el('p', 'empty', 'Nenhuma classe liberada ainda. As cartas dos chefes abrem as outras.'));
      return wrap;
    }
    var h = hero(hid) || {};
    var cid = h.classId || hid;
    var info = cardInfo(cid);
    var stats = effStats(hid) || (classDef(cid) || {}).stats || {};

    /* SÓ A DUPLA NO INVENTÁRIO (30/08): a fileira com os sete confundia.
     * Agora a foto é GRANDE, a seta passa para o outro da dupla, o "+"
     * adiciona o segundo quando se desceu sozinho, e o botão de troca mora
     * no canto inferior da própria foto — como o dono desenhou. */
    var naDupla = lista.indexOf(hid);
    // todo o visual mora no CSS agora (.pt-carrossel/.pt-moldura/.pt-troca):
    // foi daqui que saiu o botão branco de sistema da foto do dono
    var care = el('div', 'pt-carrossel');

    function setaPara(dirN) {
      var alvo = lista[(naDupla + dirN + lista.length) % lista.length];
      var b = btn(dirN > 0 ? '›' : '‹', 'btn-mini btn-ghost pt-seta', function () {
        partyHero = alvo;
        invSel = null;
        duplaTrocaAberta = null;
        sheetParty(partyTab);
      });
      return b;
    }
    if (lista.length > 1) care.appendChild(setaPara(-1));

    // a FOTO grande na moldura, com o selo de avatar e a troca no pé
    var moldura = el('div', 'pt-moldura');
    moldura.appendChild(art('unit', [cid, { element: h.element || 'neutro', dir: 0, scale: 0.95 }], 160));
    if (!soltos && naDupla === 0) {
      moldura.appendChild(el('span', 'pt-dupla-tag is-lider', 'AVATAR'));
    }
    var trocaB = btn('⇄ Trocar', 'btn-mini pt-troca', function () {
      duplaTrocaAberta = (duplaTrocaAberta === naDupla) ? null : naDupla;
      sheetParty(partyTab);
    });
    moldura.appendChild(trocaB);
    care.appendChild(moldura);

    if (lista.length > 1) care.appendChild(setaPara(1));

    // desceu sozinho? o "+" convida o segundo
    if (!soltos && dupla.length === 1 && partyHeroes().length > 1) {
      var mais = el('button', 'pt-mais');
      mais.type = 'button';
      mais.textContent = '+';
      mais.title = 'Adicionar o segundo da dupla';
      tap(mais, function () {
        duplaTrocaAberta = (duplaTrocaAberta === 'add') ? null : 'add';
        sheetParty(partyTab);
      });
      care.appendChild(mais);
    }
    wrap.appendChild(care);

    // o SELETOR da troca: os liberados de fora da dupla, um clique resolve
    if (duplaTrocaAberta !== null && !soltos) {
      var fora = partyHeroes().filter(function (o) { return dupla.indexOf(o) < 0; });
      var fila = el('div', 'pt-fila');
      if (!fora.length) {
        fila.appendChild(el('p', 'inv-dica', 'Não há outra classe liberada para pôr aqui.'));
      }
      fora.forEach(function (outro) {
        var oh = hero(outro) || {};
        var ocid = oh.classId || outro;
        var chip = el('button', 'pt-retrato');
        chip.type = 'button';
        chip.appendChild(art('unit', [ocid, { element: oh.element || 'neutro', dir: 0, scale: 0.42 }], 44));
        chip.appendChild(el('span', 'pt-retrato-nm', esc(className(ocid))));
        tap(chip, function () {
          var antes = selHeroes[0] || null;
          if (duplaTrocaAberta === 'add') selHeroes.push(outro);
          else selHeroes[duplaTrocaAberta] = outro;
          duplaTrocaAberta = null;
          partyHero = outro;
          invSel = null;
          duplaMudou(antes);
        });
        fila.appendChild(chip);
      });
      wrap.appendChild(fila);
    }

    var card = el('div', 'pt-hero-card');

    var col = el('div', 'pt-hero-txt');
    col.appendChild(el('div', 'pt-hero-nm', esc(className(cid))));
    var linha = el('div', 'pt-hero-lv');
    linha.appendChild(el('span', 'lv-badge', 'Nv ' + (h.level || 1)));
    var eb = el('span', 'elem-badge e-' + (h.element || 'neutro'), ELEM_PT[h.element] || 'Neutro');
    eb.style.setProperty('--ec', elemColor(h.element || 'neutro'));
    linha.appendChild(eb);
    if (info.stars) linha.appendChild(starRow(info.stars, 12));
    col.appendChild(linha);
    col.appendChild(el('div', 'pt-hero-st',
      '<span class="s-hp">' + (stats.hp || 0) + ' PV</span>' +
      '<span class="s-pa">' + (stats.pa || 0) + ' PA</span>' +
      '<span class="s-pp">' + (stats.pp || 0) + ' PP</span>' +
      '<span>' + (stats.power || 0) + ' poder</span>' +
      '<span>' + (stats.dodge || 0) + ' esq.</span>'));
    /* O LUGAR NA DUPLA, dito e mudável daqui — sem voltar à tela de seleção. */
    var naDupla = selHeroes.indexOf(hid);
    var acoes = el('div', 'pt-dupla');
    if (naDupla === 0) {
      acoes.appendChild(el('span', 'pt-dupla-tag is-lider', 'Na dupla · anda no acampamento'));
    } else if (naDupla > 0) {
      acoes.appendChild(el('span', 'pt-dupla-tag', 'Na dupla'));
      acoes.appendChild(btn('Andar com este no acampamento', 'btn-mini', function () {
        var antes = selHeroes[0] || null;
        selHeroes.splice(naDupla, 1);
        selHeroes.unshift(hid);
        duplaMudou(antes);
      }));
    } else if (selHeroes.length < 2) {
      acoes.appendChild(btn('Entrar na dupla', 'btn-mini', function () {
        var antes = selHeroes[0] || null;
        selHeroes.push(hid);
        duplaMudou(antes);
      }));
    } else {
      selHeroes.forEach(function (quem, qi) {
        acoes.appendChild(btn('Entrar no lugar de ' + esc(className(quem)), 'btn-mini', function () {
          var antes = selHeroes[0] || null;
          selHeroes[qi] = hid;
          duplaMudou(antes);
        }));
      });
    }
    col.appendChild(acoes);
    card.appendChild(col);
    var ficha = btn('Ficha', 'btn-mini pt-ficha', function () { openSheet('heroSheet', hid); });
    card.appendChild(ficha);
    wrap.appendChild(card);
    return wrap;
  }

  // ---- os quatro espaços do herói + o do bicho
  function equipRow(hid) {
    var h = hero(hid) || {};
    var wrap = el('div', 'pt-slots');
    SLOTS.forEach(function (canon) {
      var v = safe(function () { return P().equippedVar(hid, slotRaw(canon)); }, null);
      var itemId = v ? v.itemId : heroItem(h, canon);
      var it = itemId ? itemDef(itemId) : null;
      var lv = v ? v.level : 0, sr = v ? v.stars : 0;
      var cell = el('div', 'pt-slot ' + starClass(sr) + (it ? ' has-item' : ' is-empty') +
                            (invFilter === canon ? ' is-focus' : ''));
      if (it) markRarity(cell, it.rarity);
      var ic = el('div', 'pt-slot-ic');
      ic.appendChild(it ? art('itemIcon', [itemId, 46], 46) : art('slotIcon', [canon, 46], 46));
      if (lv) ic.appendChild(el('span', 'ig-lv', '+' + lv));
      if (it) { var bs2 = setBadge(itemId); if (bs2) ic.appendChild(bs2); }
      cell.appendChild(ic);
      cell.appendChild(el('span', 'pt-slot-nm', SLOT_PT[canon]));
      cell.appendChild(el('span', 'pt-slot-it', it ? esc(it.name) : 'vazio'));
      if (sr) cell.appendChild(starPips(sr));
      if (it) {
        cell.appendChild(el('span', 'pt-slot-b', esc(itemBonusText(it, lv, sr))));
        cell.appendChild(btn('Tirar', 'btn-mini btn-warn', function () {
          var ok = safe(function () { return P().unequip(hid, slotRaw(canon)); }, false);
          if (ok) {
            invSel = { itemId: itemId, level: lv, stars: sr };     // volta selecionada na grade
            toast('Voltou para o inventário.', 'good');
          } else if (!safe(function () { return P().bagFree(1); }, true)) {
            toast('O saco está cheio — a peça fica vestida.');
          }
          sheetParty('inventario');
        }));
      } else {
        cell.appendChild(el('span', 'pt-slot-b', esc(SLOT_HINT[canon])));
        cell.appendChild(btn('Ver peças', 'btn-mini', function () {
          invFilter = canon;
          sheetParty('inventario');
        }));
      }
      wrap.appendChild(cell);
    });

    // espaço do bicho, separado dos quatro
    var pid = h.pet;
    var pd = pid ? petDef(pid) : null;
    var cp = el('div', 'pt-slot pt-pet' + (pd ? ' has-item' : ' is-empty'));
    var cic = el('div', 'pt-slot-ic');
    cic.appendChild(pd ? art('petIcon', [pid, 46], 46) : el('div', 'pet-empty', '☾'));
    cp.appendChild(cic);
    cp.appendChild(el('span', 'pt-slot-nm', 'Bicho'));
    cp.appendChild(el('span', 'pt-slot-it', pd ? esc(pd.name) + ' · ' + petNivelTxt(pid) : 'nenhum'));
    cp.appendChild(el('span', 'pt-slot-b', pd ? esc(bonusText(pd.bonuses)) : 'age depois do dono'));
    var pets = ownedPets();
    if (pd) {
      cp.appendChild(btn('Soltar', 'btn-mini btn-warn', function () {
        safe(function () { P().unequipPet(hid); }, null);
        sheetParty('inventario');
      }));
    } else if (pets.length) {
      cp.appendChild(btn('Chamar', 'btn-mini', function () { petPicker(hid, 'party'); }));
    } else {
      cp.appendChild(el('span', 'hs-none', 'nenhum no saco'));
    }
    wrap.appendChild(cp);
    return wrap;
  }

  // ---- barra da peça escolhida: fica grudada no topo enquanto se rola a grade,
  // e é ela que carrega TODA a informação e TODAS as ações (nada de balãozinho).
  function pickBar(hid) {
    var wrap = el('div', 'inv-pick');
    var pilha = pilhaSel();
    if (!pilha) {
      wrap.classList.add('is-idle');
      wrap.appendChild(el('p', null, 'Toque numa peça da grade para ver o que ela dá e equipar.'));
      return wrap;
    }
    var it = itemDef(pilha.itemId);
    var canon = slotOf(pilha.itemId);
    wrap.classList.add(starClass(pilha.stars));
    markRarity(wrap, it && it.rarity);

    var ic = el('div', 'inv-pick-ic');
    ic.appendChild(art('itemIcon', [pilha.itemId, 52], 52));
    if (pilha.count > 1) ic.appendChild(el('span', 'ig-n', '×' + pilha.count));
    if (pilha.level) ic.appendChild(el('span', 'ig-lv', '+' + pilha.level));
    var bsp = setBadge(pilha.itemId);
    if (bsp) ic.appendChild(bsp);
    wrap.appendChild(ic);

    var tx = el('div', 'inv-pick-tx');
    var h3 = el('div', 'inv-pick-nm', esc((it && it.name) || pilha.itemId));
    if (pilha.stars) h3.appendChild(starPips(pilha.stars));
    tx.appendChild(h3);
    tx.appendChild(el('div', 'inv-pick-sub',
      esc(SLOT_PT[canon] || '') + ' · ' + esc(RAR_PT[(it || {}).rarity] || (it || {}).rarity || '') +
      (pilha.level ? ' · pedra <b>+' + pilha.level + '</b> ' + esc(tierOf(pilha.level)) : '') +
      (pilha.stars ? ' · estrela <b>★' + pilha.stars + '</b>' : '')));
    tx.appendChild(el('div', 'inv-pick-b', esc(itemBonusText(it, pilha.level, pilha.stars))));
    var cmp = comparaComVestida(pilha.itemId, pilha.level, pilha.stars, hid);
    if (cmp) tx.appendChild(el('div', 'inv-pick-cmp', cmp));
    if (it && it.grantsSpell) {
      var sp = spellDef(it.grantsSpell);
      tx.appendChild(el('div', 'inv-pick-sp', 'Concede <b>' + esc(spellName(sp, it.grantsSpell)) + '</b>' +
        (sp && sp.paCost ? ' (' + sp.paCost + ' PA)' : '')));
    }
    if (it && it.setId) {
      var sd = setDef(it.setId);
      var lnSet = el('div', 'inv-pick-set is-toque', 'Conjunto <b>' + esc((sd && sd.name) || it.setId) + '</b> · ' +
        setEquippedCount(it.setId) + '/' + setPieceCount(it.setId) + ' vestidas · <u>ver</u>');
      tap(lnSet, function () {
        showTip(lnSet, (sd && sd.name) || it.setId, setTipBody(it.setId), elemColor(sd && sd.element));
      });
      tx.appendChild(lnSet);
    }
    var donos = safe(function () { return P().equippedByAll(pilha.itemId); }, []);
    if (donos.length) {
      tx.appendChild(el('div', 'inv-pick-us', 'Outra cópia em uso por <b>' +
        donos.map(function (d) { return esc(className((hero(d) || {}).classId || d)); }).join(', ') + '</b>'));
    }
    wrap.appendChild(tx);

    var acts = el('div', 'inv-pick-acts');
    if (hid) {
      var nome = className((hero(hid) || {}).classId || hid).split(' ')[0];
      acts.appendChild(btn('Equipar em ' + esc(nome), 'btn-primary btn-mini', function () {
        var ok = safe(function () { return P().equip(hid, pilha.itemId, pilha.index); }, false);
        if (!ok) { toast('Não deu para equipar essa peça.'); }
        else {
          toast(esc((it && it.name) || 'Peça') + ' no ' + (SLOT_PT[canon] || 'espaço') + '.', 'good');
          // o Traje do Colecionador FECHOU nesta peça? A aura acende agora
          if (it && D().selos && it.setId === D().selos.setId && safe(temAuraSelos, false)) {
            toast('O Traje do Colecionador FECHOU — a aura acende na praça e o Selinho se junta a você!', 'good');
            if (JOGO.Hub && JOGO.Hub.aura) safe(function () { JOGO.Hub.aura(true); }, null);
          }
          if (pilha.count <= 1) invSel = null;
        }
        sheetParty('inventario');
      }));
    }
    // UMA porta só para a forja (reorganização 25/08: "Forjar" e "Fundir na
    // forja" eram dois botões indo ao MESMO lugar — confundia). Quando há
    // fusão pronta, o rótulo adianta a boa notícia e o botão fica dourado.
    var fu = safe(function () { return P().fuseInfo(pilha.index); }, null);
    var fi = safe(function () { return P().upgradeInfo(pilha.index); }, null);
    var fundePronto = !!(fu && !fu.maxed && fu.pode);
    if ((fi && !fi.maxed) || (fu && !fu.maxed)) {
      acts.appendChild(btn(
        fundePronto ? 'Levar à forja — dá ★' + fu.proxima + '!' : 'Levar à forja',
        'btn-mini' + (fundePronto ? ' btn-gold' : ''), function () {
          forgeTarget = { kind: 'bag', itemId: pilha.itemId, level: pilha.level, stars: pilha.stars };
          sheetParty('forja');
        }));
    }
    wrap.appendChild(acts);
    return wrap;
  }

  function invFilterTabs() {
    var tabs = el('div', 'inv-tabs');
    ['todos'].concat(SLOTS).forEach(function (f) {
      tabs.appendChild(btn(f === 'todos' ? 'Tudo' : SLOT_PT[f],
        'btn-tab' + (invFilter === f ? ' is-on' : ''), function () {
          invFilter = f;
          sheetParty('inventario');
        }));
    });
    return tabs;
  }

  /* COMPARAR COM A VESTIDA (pedido 25/08): o delta entre a peça escolhida e
   * a que o herói do carrossel usa no MESMO espaço — verde ganha, vermelho
   * perde. Some quando o espaço está vazio (aí tudo é ganho) ou quando a
   * escolhida É a vestida. */
  function comparaComVestida(itemId, lv, sr, hid) {
    if (!hid) return null;
    var it = itemDef(itemId);
    if (!it) return null;
    var canon = slotOf(itemId);
    var v = safe(function () { return P().equippedVar(hid, slotRaw(canon)); }, null);
    if (!v || !v.itemId) return null;
    if (v.itemId === itemId && (v.level || 0) === (lv || 0) && (v.stars || 0) === (sr || 0)) return null;
    var atual = itemDef(v.itemId);
    if (!atual) return null;
    function tabela(def, mult) {
      var m = {}, b = def.bonuses || {};
      for (var k in b) {
        if (!b.hasOwnProperty(k)) continue;
        if (k === 'resists') {
          for (var e in b.resists) {
            if (b.resists.hasOwnProperty(e)) m['r:' + e] = Math.round(b.resists[e] * mult);
          }
        } else if (k === 'pa' || k === 'pp') m[k] = b[k];
        else m[k] = Math.round(b[k] * mult);
      }
      return m;
    }
    var nova = tabela(it, itemMult(lv, sr));
    var velha = tabela(atual, itemMult(v.level || 0, v.stars || 0));
    var chaves = {}, k2, out = [];
    for (k2 in nova) if (nova.hasOwnProperty(k2)) chaves[k2] = 1;
    for (k2 in velha) if (velha.hasOwnProperty(k2)) chaves[k2] = 1;
    var NOME = { hp: 'PV', pa: 'PA', pp: 'PP', power: 'poder',
                 initiative: 'inic.', dodge: 'esq.', lock: 'fix.' };
    for (k2 in chaves) {
      if (!chaves.hasOwnProperty(k2)) continue;
      var d = (nova[k2] || 0) - (velha[k2] || 0);
      if (!d) continue;
      var rot = k2.indexOf('r:') === 0
        ? '% ' + (ELEM_PT[k2.slice(2)] || k2.slice(2)) : ' ' + (NOME[k2] || k2);
      out.push('<em class="' + (d > 0 ? 'cmp-mais' : 'cmp-menos') + '">' +
               (d > 0 ? '+' : '') + d + rot + '</em>');
    }
    if (!out.length) return null;
    return 'contra a vestida (' + esc(atual.name) + '): ' + out.join(' · ');
  }

  /* BUSCA POR NOME (pedido 25/08): filtra AO VIVO escondendo células — nada
   * de redesenhar a ficha a cada tecla, o campo perderia o foco. O estado
   * sobrevive ao redesenho e é reaplicado na grade nova. */
  function normaliza(s) {
    s = String(s || '').toLowerCase();
    try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    return s;
  }
  function aplicaBusca(raiz, termo) {
    if (!raiz) return;
    var t = normaliza(termo);
    raiz.querySelectorAll('.ig-cell').forEach(function (c) {
      if (c.classList.contains('is-vazia')) return;
      var nm = c.querySelector('.ig-nm');
      c.classList.toggle('is-fora-busca',
        !!t && (!nm || normaliza(nm.textContent).indexOf(t) < 0));
    });
  }
  function buscaInput(valor, aoTexto) {
    var w = el('div', 'inv-busca');
    var i2 = document.createElement('input');
    i2.type = 'search';
    i2.placeholder = 'buscar por nome…';
    i2.className = 'inv-busca-campo';
    i2.value = valor || '';
    i2.addEventListener('input', function () { aoTexto(i2.value); });
    w.appendChild(i2);
    return w;
  }

  /* A fileira dos ELEMENTOS (pedido 25/08: "nos menus onde aparecem os itens
   * precisa ter uma forma de filtrar por elemento"): filtra qualquer grade
   * de itens pelo elemento da peça — inventário, forja e banco usam a mesma.
   * Cada chip acende com a cor do próprio elemento. */
  var ELEM_FILTROS = ['todos', 'fogo', 'agua', 'terra', 'ar', 'neutro'];
  function elemTabs(atual, aoMudar) {
    var tabs = el('div', 'inv-tabs elem-tabs');
    ELEM_FILTROS.forEach(function (e2) {
      var b = btn(e2 === 'todos' ? 'Todos' : ELEM_PT[e2],
        'btn-tab bt-elem' + (atual === e2 ? ' is-on' : ''), function () { aoMudar(e2); });
      if (e2 !== 'todos') b.style.setProperty('--ec', elemColor(e2));
      tabs.appendChild(b);
    });
    return tabs;
  }
  function passaElemento(itemId, filtro) {
    if (filtro === 'todos') return true;
    var it = itemDef(itemId);
    return ((it && it.element) || 'neutro') === filtro;
  }

  // ---- A GRADE. Iguais empilham num espaço só, com ×N.
  /* Quantas casas a grade mostra no mínimo. Doze colunas cabem em tela larga e
   * seis em celular, então 48 fecha fileira nos dois. */
  var INV_CELULAS_MIN = 48;

  function invGrid(hid) {
    var pilhas = safe(function () { return P().invStacks(); }, []);
    var grid = el('div', 'inv-big');
    var ordem = {};
    SLOTS.forEach(function (s, i) { ordem[s] = i; });
    pilhas = pilhas.filter(function (s) { return !!itemDef(s.itemId); });
    pilhas.sort(function (a, b) {
      var sa = ordem[slotOf(a.itemId)], sb = ordem[slotOf(b.itemId)];
      if (sa !== sb) return sa - sb;
      if (a.stars !== b.stars) return b.stars - a.stars;
      if (a.level !== b.level) return b.level - a.level;
      return String((itemDef(a.itemId) || {}).name || '').localeCompare(String((itemDef(b.itemId) || {}).name || ''));
    });
    var mostrou = 0;
    pilhas.forEach(function (pilha) {
      var canon = slotOf(pilha.itemId);
      if (invFilter !== 'todos' && canon !== invFilter) return;
      if (!passaElemento(pilha.itemId, invElemFiltro)) return;
      mostrou++;
      var it = itemDef(pilha.itemId);
      var sel = invSel && invSel.itemId === pilha.itemId && invSel.level === pilha.level &&
                invSel.stars === pilha.stars;
      var cell = el('button', 'ig-cell ' + starClass(pilha.stars) + (sel ? ' is-sel' : ''));
      cell.type = 'button';
      markRarity(cell, it.rarity);
      var plate = el('span', 'ig-plate');
      plate.appendChild(art('itemIcon', [pilha.itemId, 54], 54));
      var bs1 = setBadge(pilha.itemId);
      if (bs1) plate.appendChild(bs1);
      cell.appendChild(plate);
      if (pilha.count > 1) cell.appendChild(el('span', 'ig-n', '×' + pilha.count));
      if (pilha.level) cell.appendChild(el('span', 'ig-lv', '+' + pilha.level));
      if (pilha.stars) cell.appendChild(starPips(pilha.stars));
      cell.appendChild(el('span', 'ig-nm', esc(it.name)));
      tap(cell, function () {
        invSel = sel ? null : { itemId: pilha.itemId, level: pilha.level, stars: pilha.stars };
        sheetParty('inventario');
      });
      grid.appendChild(cell);
    });
    // ---- GRADE FIXA (pedido do usuário, com a foto do Dofus na mão)
    // Antes a grade desenhava UMA célula por pilha existente, então ela encolhia
    // e crescia conforme o saco: com três itens virava uma tirinha de três
    // quadrados, e a tela inteira dançava a cada peça equipada. No Dofus a grade
    // é FIXA — os espaços vazios continuam lá, e é isso que dá a leitura de
    // "quanto ainda cabe".
    //
    // Cresce de doze em doze para nunca terminar numa fileira quebrada. Como o
    // CSS usa auto-fill, o número de colunas muda com a largura da tela; por
    // isso o passo é um múltiplo com muitos divisores (12 = 2·3·4·6), que fecha
    // fileira em quase toda largura.
    var alvo = Math.max(INV_CELULAS_MIN, Math.ceil(mostrou / 12) * 12);
    for (var vz = mostrou; vz < alvo; vz++) {
      grid.appendChild(el('div', 'ig-cell is-vazia'));
    }

    // O aviso vira DICA acima da grade, não substituto dela: a grade fixa já
    // mostra sozinha que está vazia, e trocá-la por um parágrafo era justamente
    // o que fazia a tela pular de tamanho.
    if (!mostrou) {
      var vestidas = 0;
      partyHeroes().forEach(function (id) {
        SLOTS.forEach(function (c) { if (heroItem(hero(id), c)) vestidas++; });
      });
      grid.dataset.vazio = invElemFiltro !== 'todos'
        ? 'Nada de ' + (ELEM_PT[invElemFiltro] || invElemFiltro) +
          (invFilter !== 'todos' ? ' em ' + SLOT_PT[invFilter] : '') + ' no saco.'
        : vestidas
          ? (invFilter === 'todos'
              ? 'Tudo o que você tem já está vestido.'
              : 'Nenhuma peça de ' + SLOT_PT[invFilter] + ' no saco.')
          : 'Saco vazio. Os calabouços resolvem isso.';
    }
    grid.dataset.cheio = mostrou + ' de ' + alvo;
    return grid;
  }

  /* O PAINEL DO CONJUNTO: cada peça com sua situação (vestida / no saco /
   * faltando, com o ícone) e os degraus de bônus 2/3/4 — os que já valem
   * levam ✓. Os ícones entram por toDataURL porque o tooltip é innerHTML. */
  function setTipBody(setId) {
    var sd = setDef(setId);
    if (!sd) return 'Conjunto ' + esc(setId) + '.';
    var n = setEquippedCount(setId);
    var out = '<i>' + esc(ELEM_PT[sd.element] || sd.element || '') + ' · ' +
              n + '/' + setPieceCount(setId) + ' vestidas</i>';
    out += '<span class="tip-set-pcs">';
    (sd.pieces || []).forEach(function (pid) {
      var pit = itemDef(pid) || {};
      var vest = !!equippedBy(pid);
      var saco = !vest && bagCountOf(pid) > 0;
      var url = safe(function () { return A().itemIcon(pid, 22).toDataURL(); }, '');
      out += '<em class="tip-set-pc ' + (vest ? 'is-vest' : (saco ? 'is-saco' : 'is-falta')) + '">' +
             (url ? '<img src="' + url + '" alt="">' : '') + esc(pit.name || pid) +
             '<b>' + (vest ? 'vestida' : (saco ? 'no saco' : 'faltando')) + '</b></em>';
    });
    out += '</span>';
    var b = sd.bonuses || {};
    ['2', '3', '4'].forEach(function (k) {
      if (!b[k]) return;
      var vale = n >= +k;
      out += '<br>' + (vale ? '<b>' : '') + k + ' peças: ' + esc(bonusText(b[k]));
      if (b[k].grantsSpell) {
        var sp = spellDef(b[k].grantsSpell);
        out += ' + feitiço ' + esc(spellName(sp, b[k].grantsSpell));
      }
      out += (vale ? ' ✓</b>' : '');
    });
    if (sd.description) out += '<br><i>' + esc(sd.description) + '</i>';
    return out;
  }

  // ----------------------------------------------------------------- FORJA
  // Agora a forja alcança TAMBÉM a peça vestida: no modelo novo equipar tira a
  // cópia do saco, e sem isso o jogador teria de desequipar para melhorar.
  // Um alvo é `{kind:'bag'|'worn', ...}` e é descrito por VALOR (item, nível,
  // estrelas), nunca por índice cru — fundir e forjar remexem o saco.
  function forgeAlvos() {
    var out = [];
    var pilhas = safe(function () { return P().invStacks(); }, []);
    pilhas.forEach(function (s) {
      if (!itemDef(s.itemId)) return;
      out.push({ kind: 'bag', itemId: s.itemId, level: s.level, stars: s.stars,
                 count: s.count, index: s.index, quem: null });
    });
    partyHeroes().forEach(function (hid) {
      SLOTS.forEach(function (canon) {
        var v = safe(function () { return P().equippedVar(hid, slotRaw(canon)); }, null);
        if (!v || !itemDef(v.itemId)) return;
        out.push({ kind: 'worn', itemId: v.itemId, level: v.level, stars: v.stars,
                   count: 1, heroId: hid, slot: canon, quem: hid });
      });
    });
    return out;
  }
  function mesmoAlvo(a, b) {
    if (!a || !b || a.kind !== b.kind || a.itemId !== b.itemId) return false;
    if (a.kind === 'worn') return a.heroId === b.heroId && a.slot === b.slot;
    return a.level === b.level && a.stars === b.stars;
  }
  function forgeInfoDe(alvo) {
    if (!alvo) return null;
    if (alvo.kind === 'worn') {
      return safe(function () { return P().upgradeInfoWorn(alvo.heroId, slotRaw(alvo.slot)); }, null);
    }
    return safe(function () { return P().upgradeInfo(alvo.index); }, null);
  }
  var forjaComGuarda = false;      // a escolha da Âncora sobrevive ao redesenho
  function forjar(alvo, usarGuarda) {
    if (!alvo) return false;
    if (alvo.kind === 'worn') {
      return safe(function () {
        return P().upgradeWorn(alvo.heroId, slotRaw(alvo.slot), usarGuarda); }, false);
    }
    return safe(function () { return P().upgradeItem(alvo.index, usarGuarda); }, false);
  }

  function forgeBody(body, preselect) {
    // estoque de pedras
    var stock = el('div', 'forge-stock');
    var defs = stoneDefs(), k;
    for (k in defs) {
      if (!defs.hasOwnProperty(k)) continue;
      var n = stoneCount(k);
      var chip = el('div', 'stone-chip' + (n ? '' : ' is-empty'));
      chip.appendChild(art('stoneIcon', [k, 40], 40));
      chip.appendChild(el('span', 'stone-n', String(n)));
      chip.appendChild(el('span', 'stone-nm', esc(defs[k].name)));
      tipOn(chip, defs[k].name, esc(defs[k].description || ''), elemColor(defs[k].element));
      stock.appendChild(chip);
    }
    body.appendChild(stock);

    var alvos = forgeAlvos();
    if (!alvos.length) {
      body.appendChild(el('p', 'empty', 'Nenhuma peça para forjar — nem no saco, nem vestida.'));
      return;
    }
    if (preselect && typeof preselect === 'object') forgeTarget = preselect;
    var atual = null, i;
    for (i = 0; i < alvos.length; i++) if (mesmoAlvo(alvos[i], forgeTarget)) { atual = alvos[i]; break; }
    if (!atual) atual = alvos[0];
    forgeTarget = atual;

    /* A ESCOLHA DA PEÇA, em grupos com nome (reorganização 25/08: "forjar e
     * upgrade está meio confuso" — a fileira única de miniaturas sem nome
     * misturava saco e vestidas). Cada célula é a MESMA da grade do
     * inventário — ícone, nome, ×N, forja, estrelas, ❖ — porque leitura já
     * aprendida não se reensina. */
    function celDe(alvo) {
      var it = itemDef(alvo.itemId);
      var c = el('button', 'ig-cell fg-cel ' + starClass(alvo.stars) +
                            (mesmoAlvo(alvo, atual) ? ' is-sel' : ''));
      c.type = 'button';
      markRarity(c, it.rarity);
      var plate = el('span', 'ig-plate');
      plate.appendChild(art('itemIcon', [alvo.itemId, 44], 44));
      var bs = setBadge(alvo.itemId, true);
      if (bs) plate.appendChild(bs);
      c.appendChild(plate);
      if (alvo.count > 1) c.appendChild(el('span', 'ig-n', '×' + alvo.count));
      if (alvo.level) c.appendChild(el('span', 'ig-lv', '+' + alvo.level));
      if (alvo.stars) c.appendChild(starPips(alvo.stars));
      if (alvo.kind === 'worn') {
        c.appendChild(el('span', 'fg-worn',
          esc(className((hero(alvo.heroId) || {}).classId || alvo.heroId).slice(0, 3))));
      }
      c.appendChild(el('span', 'ig-nm', esc(it.name)));
      tap(c, function () { forgeTarget = alvo; sheetParty('forja'); });
      return c;
    }
    body.appendChild(elemTabs(forjaElemFiltro, function (e2) {
      forjaElemFiltro = e2;
      sheetParty('forja');
    }));
    var doSaco = alvos.filter(function (a) {
      return a.kind === 'bag' && passaElemento(a.itemId, forjaElemFiltro);
    });
    var vestidas = alvos.filter(function (a) {
      return a.kind === 'worn' && passaElemento(a.itemId, forjaElemFiltro);
    });
    if (!doSaco.length && !vestidas.length) {
      body.appendChild(el('p', 'inv-dica', 'Nada de ' +
        (ELEM_PT[forjaElemFiltro] || forjaElemFiltro) + ' para forjar — o filtro está ligado.'));
    }
    [[doSaco, 'No saco'], [vestidas, 'Vestidas']].forEach(function (par) {
      if (!par[0].length) return;
      body.appendChild(el('h4', 'fg-grupo', par[1] + ' (' + par[0].length + ')'));
      var grade = el('div', 'forge-pick');
      par[0].forEach(function (a) { grade.appendChild(celDe(a)); });
      body.appendChild(grade);
    });

    var it2 = itemDef(atual.itemId);
    var lv2 = atual.level;
    var info = forgeInfoDe(atual);

    var panel = el('div', 'forge-panel ' + tierClass(lv2) + ' ' + starClass(atual.stars));
    var head = el('div', 'forge-head');
    head.appendChild(art('itemIcon', [atual.itemId, 72], 72));
    var ht = el('div', 'forge-head-t');
    ht.appendChild(el('h3', null, esc((it2 && it2.name) || atual.itemId) + (lv2 ? ' <b>+' + lv2 + '</b>' : '')));
    ht.appendChild(el('span', 'forge-tier-nm', esc(tierOf(lv2)) + ' · ' + esc(SLOT_PT[slotOf(atual.itemId)] || '')));
    if (atual.stars) {
      var se = el('span', 'fg-stars ' + starClass(atual.stars));
      se.appendChild(starPips(atual.stars));
      se.appendChild(el('span', null, 'de fundir iguais'));
      ht.appendChild(se);
    }
    if (it2 && it2.element) {
      var ec = el('span', 'elem-badge e-' + it2.element, ELEM_PT[it2.element] || it2.element);
      ec.style.setProperty('--ec', elemColor(it2.element));
      ht.appendChild(ec);
    }
    ht.appendChild(el('span', 'fg-onde', atual.kind === 'worn'
      ? 'vestida por <b>' + esc(className((hero(atual.heroId) || {}).classId || atual.heroId)) + '</b>'
      : 'no saco' + (atual.count > 1 ? ' · ×' + atual.count + ' (sobe UMA cópia)' : '')));
    head.appendChild(ht);
    panel.appendChild(head);

    /* OS DOIS CAMINHOS, um cartão para cada (reorganização 25/08): a PEDRA
     * (nível, pedras, risco, Âncora) e a ESTRELA (fundir cópias) são regras
     * diferentes e moravam empilhadas numa parede só, com uma legenda densa
     * tentando explicar tudo. Agora cada caminho tem sua parede, com a
     * própria regra escrita no alto — e a legenda morreu. */
    var cards = el('div', 'forge-cards');

    // ===== cartão A PEDRA
    var cp = el('div', 'forge-card fc-pedra');
    cp.appendChild(el('h4', null, 'A Pedra' +
      '<i>sobe o nível com pedras do elemento · +0–2 Comum · +3–5 Raro · +6–9 Supremo · +10 Magnífico</i>'));
    var maxLv = upgradeCfg().maxLevel || 10;
    var track = el('div', 'forge-track');
    for (var i3 = 0; i3 <= maxLv; i3++) {
      var stp = el('i', 'fg-step ' + tierClass(i3) + (i3 <= lv2 ? ' is-on' : '') + (i3 === lv2 + 1 ? ' is-next' : ''));
      track.appendChild(stp);
    }
    cp.appendChild(track);
    // prévia do ganho (com as estrelas já dentro da conta)
    if (lv2 < maxLv) {
      var prev = el('div', 'forge-prev');
      prev.appendChild(el('div', 'fp-col', '<i>agora</i>' + bonusPreview(it2, lv2, atual.stars)));
      prev.appendChild(el('div', 'fp-arrow', '→'));
      prev.appendChild(el('div', 'fp-col fp-next', '<i>+' + (lv2 + 1) + '</i>' + bonusPreview(it2, lv2 + 1, atual.stars)));
      cp.appendChild(prev);
    }
    if (!info) {
      cp.appendChild(el('p', 'empty', 'A forja ainda não está disponível.'));
    } else if (info.maxed) {
      cp.appendChild(el('p', 'forge-max', 'No máximo: <b>Magnífico +' + maxLv + '</b>.'));
    } else {
      var sd2 = stoneDefs()[info.stoneId];
      var have = stoneCount(info.stoneId);
      // A BANCADA DO FERREIRO (30/08, pedido: "o personagem coloca o item e
      // a pedra e forja"): a peça num encaixe, a pedra do elemento no outro,
      // a seta diz no que vira. A linha de custo virou gesto de ofício.
      function encaixe(icone, rot, curto) {
        var cx = el('div', 'forge-cost' + (curto ? ' is-short' : ''));
        cx.style.cssText = 'flex-direction:column;align-items:center;gap:4px;' +
                           'padding:10px 14px;min-width:86px;text-align:center';
        cx.appendChild(icone);
        cx.appendChild(el('span', null, rot));
        return cx;
      }
      var banca = el('div', 'forge-banca');
      banca.style.cssText = 'display:flex;align-items:center;justify-content:center;' +
                            'gap:10px;margin:10px 0;flex-wrap:wrap';
      banca.appendChild(encaixe(art('itemIcon', [atual.itemId, 46], 46),
        '<b>' + esc((it2 && it2.name) || atual.itemId) + '</b>' + (lv2 ? ' +' + lv2 : ''), false));
      var mais = el('span', null, '+');
      mais.style.cssText = 'font-size:22px;color:#8895a6';
      banca.appendChild(mais);
      banca.appendChild(encaixe(art('stoneIcon', [info.stoneId, 46], 46),
        '<b>' + have + ' / ' + info.custo + '</b> ' + esc((sd2 && sd2.name) || info.stoneId),
        !info.temPedras));
      var seta = el('span', null, '→');
      seta.style.cssText = 'font-size:22px;color:#e8c25a';
      banca.appendChild(seta);
      banca.appendChild(encaixe(art('itemIcon', [atual.itemId, 46], 46),
        '<b>+' + (lv2 + 1) + '</b> ' + esc(tierOf(lv2 + 1)), false));
      cp.appendChild(banca);
      if (!info.temPedras) {
        cp.appendChild(el('p', 'forge-short',
          'Faltam <b>' + (info.custo - have) + '</b> de <b>' + esc((sd2 && sd2.name) || info.stoneId) +
          '</b>' + (sd2 ? ' (' + (ELEM_PT[sd2.element] || sd2.element) + ')' : '') +
          '. Monstros desse elemento derrubam.'));
      }
      // O RISCO, dito antes da batida: a chance e o preço da falha — e a
      // Âncora, quando há alguma no saco, com a escolha nas mãos do jogador.
      if (info.arriscado) {
        var pct = Math.round(info.chance * 100);
        cp.appendChild(el('p', 'forge-risco',
          'Batida arriscada: <b>' + pct + '%</b> de subir — falhou, ' +
          (forjaComGuarda && info.guardas > 0
            ? 'a <b>Âncora segura</b> em +' + lv2 + '.'
            : 'a peça <b>volta para +' + Math.max(0, lv2 - 1) + '</b>.')));
        var linhaG = el('label', 'forge-guarda' + (info.guardas > 0 ? '' : ' is-off'));
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = forjaComGuarda && info.guardas > 0;
        cb.disabled = info.guardas < 1;
        cb.addEventListener('change', function () {
          forjaComGuarda = cb.checked;
          sheetParty('forja');
        });
        linhaG.appendChild(cb);
        linhaG.appendChild(el('span', null,
          'Pôr a <b>Âncora de Forja</b> junto (' + info.guardas + ' no saco)' +
          (info.guardas < 1 ? ' — só os chefes mais fundos derrubam' : '')));
        cp.appendChild(linhaG);
      }
      var go = btn('🔨 Bater o martelo — vira +' + (lv2 + 1),
                   'btn-primary btn-block' + (info.temPedras ? '' : ' is-off'), function () {
        var usarG = info.arriscado && forjaComGuarda && info.guardas > 0;
        var fim = forjar(atual, usarG);
        if (fim) {
          var nivelNovo = (typeof fim === 'object') ? fim.nivel : lv2 + 1;
          var como = (typeof fim === 'object') ? fim.resultado : 'subiu';
          if (como === 'subiu') {
            toast('Forjado: +' + nivelNovo + ' ' + tierOf(nivelNovo) + '!', 'good');
          } else if (como === 'segurou') {
            toast('A batida falhou — a Âncora segurou em +' + nivelNovo + '.', 'good');
          } else {
            toast('A batida falhou: a peça voltou para +' + nivelNovo + '.');
          }
          forgeTarget = { kind: atual.kind, itemId: atual.itemId, level: nivelNovo, stars: atual.stars,
                          heroId: atual.heroId, slot: atual.slot };
          if (invSel && invSel.itemId === atual.itemId && invSel.level === lv2 &&
              invSel.stars === atual.stars && atual.kind === 'bag') {
            invSel = { itemId: atual.itemId, level: nivelNovo, stars: atual.stars };
          }
          sheetParty('forja');
        } else toast('Pedras insuficientes.');
      });
      cp.appendChild(go);
    }
    cards.appendChild(cp);

    // ===== cartão A ESTRELA (fundir mora na forja desde 24/08)
    var ce = el('div', 'forge-card fc-estrela');
    ce.appendChild(el('h4', null, 'A Estrela' +
      '<i>3 cópias iguais do saco viram ★ — no nível médio, para baixo</i>'));
    if (atual.kind === 'worn') {
      ce.appendChild(el('p', 'fc-nota', 'Para fundir, a peça precisa estar no <b>saco</b> — ' +
        'as cópias soltas é que se juntam. Esta está vestida.'));
    } else {
      var fu = safe(function () { return P().fuseInfo(atual.index); }, null);
      if (!fu || fu.maxed) {
        ce.appendChild(el('p', 'fc-nota', atual.stars >= 3
          ? 'No topo: <b>★3</b>. Daqui não sobe mais.'
          : 'Esta peça não funde.'));
      } else if (fu.pode) {
        ce.appendChild(el('p', 'fc-nota', 'Três cópias no saco: <b>+' +
          fu.niveisEscolhidos.join(' +') + '</b> viram <b>★' + fu.proxima +
          ' +' + fu.nivelResultado + '</b>.'));
        // A PRÉVIA DO FUNDIR (pedido 25/08: "não consigo ver a previsão") —
        // a mesma leitura agora → depois do cartão da Pedra, com a estrela
        // nova e o nível médio já dentro da conta.
        var prevE = el('div', 'forge-prev');
        prevE.appendChild(el('div', 'fp-col', '<i>agora ' +
          (atual.stars ? '★' + atual.stars + ' ' : '') + '+' + lv2 + '</i>' +
          bonusPreview(it2, lv2, atual.stars)));
        prevE.appendChild(el('div', 'fp-arrow', '→'));
        prevE.appendChild(el('div', 'fp-col fp-next', '<i>★' + fu.proxima +
          ' +' + fu.nivelResultado + '</i>' +
          bonusPreview(it2, fu.nivelResultado, fu.proxima)));
        ce.appendChild(prevE);
        ce.appendChild(btn('Fundir → ★' + fu.proxima + ' +' + fu.nivelResultado,
          'btn-gold btn-block', function () {
            var nova = safe(function () { return P().fuseItem(atual.index); }, null);
            if (nova) {
              toast('Fundiu ' + fu.precisa + ': agora é ★' + nova.stars +
                    ' +' + nova.level + ' (a média das três).', 'good');
              forgeTarget = { kind: 'bag', itemId: nova.itemId,
                              level: nova.level, stars: nova.stars };
              if (invSel && invSel.itemId === atual.itemId) {
                invSel = { itemId: nova.itemId, level: nova.level, stars: nova.stars };
              }
            }
            sheetParty('forja');
          }));
      } else {
        ce.appendChild(el('p', 'fc-nota', (fu.faltam > 1
          ? 'Faltam <b>' + fu.faltam + '</b> cópias iguais'
          : 'Falta <b>1</b> cópia igual') +
          ' no saco para a ★' + fu.proxima + '.'));
        // mesmo sem as cópias, a prévia mostra O QUE a estrela renderia
        // neste nível — é o que faz valer a caça às outras duas
        var prevF = el('div', 'forge-prev');
        prevF.appendChild(el('div', 'fp-col', '<i>agora ' +
          (atual.stars ? '★' + atual.stars + ' ' : '') + '+' + lv2 + '</i>' +
          bonusPreview(it2, lv2, atual.stars)));
        prevF.appendChild(el('div', 'fp-arrow', '→'));
        prevF.appendChild(el('div', 'fp-col fp-next', '<i>★' + fu.proxima +
          ' (no +' + lv2 + ')</i>' + bonusPreview(it2, lv2, fu.proxima)));
        ce.appendChild(prevF);
      }
    }
    cards.appendChild(ce);

    panel.appendChild(cards);
    body.appendChild(panel);
  }

  // prévia de bônus de uma peça num certo degrau das DUAS trilhas [D18]
  function bonusPreview(it, lv, stars) {
    if (!it) return '—';
    var mult = itemMult(lv, stars);
    var b = it.bonuses || {}, out = [], k;
    for (k in b) {
      if (!b.hasOwnProperty(k)) continue;
      if (k === 'resists') {
        for (var e in b.resists) {
          if (b.resists.hasOwnProperty(e)) out.push('+' + Math.round(b.resists[e] * mult) + '% ' + (ELEM_PT[e] || e));
        }
      } else if (k === 'pa' || k === 'pp') {
        out.push('+' + b[k] + ' ' + k.toUpperCase());
      } else {
        out.push('+' + Math.round(b[k] * mult) + ' ' +
          ({ hp: 'PV', power: 'poder', initiative: 'inic.', dodge: 'esquiva', lock: 'fixação' }[k] || k));
      }
    }
    return out.length ? out.join('<br>') : '—';
  }

  // ------------------------------------------------------ FICHA DO HERÓI
  function sheetHero(heroId) {
    var h = hero(heroId);
    if (!h) { closeSheet(); return; }
    var cid = h.classId || heroId;
    var info = cardInfo(cid);
    var stats = effStats(heroId) || (classDef(cid) || {}).stats || {};
    var body = sheetShell(className(cid), 'Nível ' + (h.level || 1) + ' · ' +
      (ELEM_PT[h.element] || 'Neutro') + (info.stars ? ' · ★' + info.stars : ''));

    var top = el('div', 'hs-top');
    top.appendChild(art('unit', [cid, { element: h.element, dir: 0, scale: 0.7 }], 110));
    var col = el('div', 'hs-col');
    var xi = xpInfo(heroId);
    col.appendChild(bar('bar-xp', xi ? xi.pct : 0, xi && xi.xpNext ? 'XP ' + xi.xp + ' / ' + xi.xpNext : 'nível máximo'));
    col.appendChild(el('div', 'hs-stats',
      '<span class="s-hp">' + (stats.hp || 0) + ' PV</span>' +
      '<span class="s-pa">' + (stats.pa || 0) + ' PA</span>' +
      '<span class="s-pp">' + (stats.pp || 0) + ' PP</span>' +
      '<span>' + (stats.power || 0) + ' poder</span>' +
      (stats.elemPower ? '<span class="s-el">+' + stats.elemPower + ' ' + (ELEM_PT[h.element] || '') + '</span>' : '') +
      '<span>' + (stats.initiative || 0) + ' inic.</span>' +
      '<span>' + (stats.dodge || 0) + ' esq.</span>' +
      '<span>' + (stats.lock || 0) + ' fix.</span>'));
    col.appendChild(el('p', 'hs-gain', perLevelText(h.element)));
    if (info.stars) {
      var sr = el('div', 'hs-stars');
      sr.appendChild(starRow(info.stars, 18));
      sr.appendChild(el('span', null, 'bônus de estrela já contam nos números acima'));
      col.appendChild(sr);
    }
    top.appendChild(col);
    body.appendChild(top);

    if (h.element === 'neutro' && (h.level || 1) >= ((D().leveling || {}).elementChoiceLevel || 5)) {
      body.appendChild(btn('Escolher caminho elemental', 'btn-gold btn-block', function () {
        closeSheet();
        elemChoiceHero = heroId;
        navTo('elementChoice');
      }));
    }

    // ---- OS CAMINHOS ELEMENTAIS POR ESTRELA (30/08): "da terceira estrela
    // em diante o jogador poderá escolher outro elemento" — ★3 abre a 2ª
    // vaga, ★4 a 3ª, ★5 a 4ª. O ativo acende; liberado troca com um toque
    // (os feitiços do caminho trocam juntos); vaga aberta escolhe; o resto
    // mostra a estrela que falta.
    if (h.element !== 'neutro') {
      body.appendChild(el('h3', 'hs-sec', 'Caminhos elementais'));
      var liberados = safe(function () { return P().heroElements(heroId); }, [h.element]);
      var vagas = safe(function () { return P().elementSlots(heroId); }, 1);
      var filaEl = el('div', 'guilda-emblemas');
      ['fogo', 'agua', 'terra', 'ar'].forEach(function (e3) {
        var def3 = classDef(cid);
        if (def3 && def3.paths && !def3.paths[e3]) return;   // classe sem esse caminho
        var tem = liberados.indexOf(e3) >= 0;
        var ativo = h.element === e3;
        var podeAbrir = !tem && liberados.length < vagas;
        // a vaga N abre na estrela N+1 (2ª vaga → ★3, 3ª → ★4, 4ª → ★5)
        var rot = (ELEM_PT[e3] || e3) + (ativo ? ' · ATIVO' : tem ? '' :
                  podeAbrir ? ' · liberar' : ' · ★' + Math.min(5, vagas + 2));
        var b3 = btn(rot, 'btn-mini ' + (ativo ? 'btn-gold' : tem ? 'btn-primary' : 'btn-ghost'),
          function () {
            if (ativo) return;
            if (tem) {
              if (safe(function () { return P().trocaElemento(heroId, e3); }, false)) {
                toast('O caminho de ' + (ELEM_PT[e3] || e3) + ' assumiu — feitiços trocados.', 'good');
                sheetHero(heroId);
              }
              return;
            }
            if (!podeAbrir) {
              var alvoEstrela = { 2: 3, 3: 4, 4: 5 }[liberados.length + 1] || 3;
              toast('A ★' + alvoEstrela + ' da classe libera a próxima vaga — junte cartas.');
              return;
            }
            confirmSheet('Liberar o caminho de ' + (ELEM_PT[e3] || e3) + '?',
              'A escolha é permanente — a vaga veio das estrelas da classe.', function () {
                if (safe(function () { return P().liberaElemento(heroId, e3); }, false)) {
                  toast('Caminho de ' + (ELEM_PT[e3] || e3) + ' liberado!', 'good');
                  sheetHero(heroId);
                } else toast('não deu');
              });
          });
        b3.style.setProperty('--ec', elemColor(e3));
        filaEl.appendChild(b3);
      });
      body.appendChild(filaEl);
      body.appendChild(el('p', 'inv-dica',
        'Vagas de caminho: <b>' + liberados.length + ' / ' + vagas + '</b> — ' +
        '★3 abre a 2ª, ★4 a 3ª, ★5 a 4ª. Trocar o ativo troca os feitiços do caminho.'));
    }

    // ---- equipamento: 4 espaços + pet (adendo v2.2)
    body.appendChild(el('h3', 'hs-sec', 'Equipamento'));
    var slots = el('div', 'hs-slots');
    SLOTS.forEach(function (canon) {
      var v = safe(function () { return P().equippedVar(heroId, slotRaw(canon)); }, null);
      var itemId = v ? v.itemId : heroItem(h, canon);
      var it = itemId ? itemDef(itemId) : null;
      var lv = v ? v.level : 0;
      var estrelas = v ? v.stars : 0;
      var cell = el('div', 'hs-slot ' + starClass(estrelas) +
                            (it ? ' has-item ' + tierClass(lv) : ' is-empty'));
      if (it) markRarity(cell, it.rarity);
      var ic = el('div', 'hs-slot-ic');
      ic.appendChild(it ? art('itemIcon', [itemId, 52], 52) : art('slotIcon', [canon, 52], 52));
      if (lv) ic.appendChild(el('span', 'inv-lv', '+' + lv));
      cell.appendChild(ic);
      cell.appendChild(el('span', 'hs-slot-nm', SLOT_PT[canon]));
      if (estrelas) cell.appendChild(starPips(estrelas));
      cell.appendChild(el('span', 'hs-slot-it', it ? esc(it.name) : 'vazio'));
      if (it) cell.appendChild(el('span', 'pt-slot-b', esc(itemBonusText(it, lv, estrelas))));
      tipOn(ic, SLOT_PT[canon] + (it ? ' — ' + it.name : ''),
        it ? itemTipBody(itemId, lv, estrelas) : esc(SLOT_HINT[canon]),
        it ? rarColor(it.rarity) : '#8b93a0');
      // a troca acontece na tela "Personagens", com este herói já no carrossel
      var act = btn(it ? 'Trocar' : 'Equipar', 'btn-mini', function () {
        invFilter = canon;
        partyHero = heroId;
        invSel = null;
        openSheet('inventory');
      });
      cell.appendChild(act);
      slots.appendChild(cell);
    });
    // espaço do pet, separado dos quatro
    (function () {
      var pid = h.pet;
      var pd = pid ? petDef(pid) : null;
      var cell = el('div', 'hs-slot hs-pet' + (pd ? ' has-item' : ' is-empty'));
      var ic = el('div', 'hs-slot-ic');
      ic.appendChild(pd ? art('petIcon', [pid, 52], 52) : el('div', 'pet-empty', '☾'));
      cell.appendChild(ic);
      cell.appendChild(el('span', 'hs-slot-nm', 'Bicho'));
      cell.appendChild(el('span', 'hs-slot-it', pd ? esc(pd.name) + ' · ' + petNivelTxt(pid) : 'nenhum'));
      if (pd) tipOn(ic, pd.name, esc(pd.description || '') + '<br><i>' + esc(bonusText(pd.bonuses)) + '</i>',
        elemColor(pd.element));
      var pets = ownedPets();
      if (pd) {
        cell.appendChild(btn('Soltar', 'btn-mini btn-warn', function () {
          safe(function () { P().unequipPet(heroId); }, null);
          sheetHero(heroId);
        }));
      } else if (pets.length) {
        cell.appendChild(btn('Chamar', 'btn-mini', function () { petPicker(heroId); }));
      } else {
        cell.appendChild(el('span', 'hs-none', 'nenhum no saco'));
      }
      slots.appendChild(cell);
    })();
    body.appendChild(slots);

    // ---- feitiços, com o que faz e o que cada um custa
    // Antes esta lista era só ícone + nome, e a descrição vivia no balãozinho —
    // que no celular ninguém vê, porque não existe passar o mouse.
    body.appendChild(el('h3', 'hs-sec', 'Feitiços'));
    var sl = safe(function () { return P().spellsFor(heroId); }, h.spells || []);
    var sg = el('div', 'hs-spell-list');
    (sl || []).forEach(function (sid) { sg.appendChild(linhaDeFeitico(sid, 0)); });
    body.appendChild(sg);

    // ---- o que ainda vem, e em que nível
    var def = classDef(cid) || {};
    var nivel = h.level || 1;
    var escolha = (D().leveling || {}).elementChoiceLevel || 5;

    function listaDoCaminho(elemento, titulo) {
      var caminho = (def.paths || {})[elemento] || [];
      if (!caminho.length) return null;
      var pendentes = caminho.filter(function (sid) {
        var dd = spellDef(sid);
        return nivel < ((dd && dd.unlockLevel) || 99);
      });
      if (!pendentes.length) return null;
      var bloco = el('div', 'hs-path');
      if (titulo) {
        var cab = el('div', 'hs-path-h', esc(titulo));
        cab.style.color = elemColor(elemento);
        bloco.appendChild(cab);
      }
      var lst = el('div', 'hs-spell-list is-locked');
      pendentes.forEach(function (sid) {
        var dd = spellDef(sid);
        lst.appendChild(linhaDeFeitico(sid, (dd && dd.unlockLevel) || 0));
      });
      bloco.appendChild(lst);
      return bloco;
    }

    if (h.element && h.element !== 'neutro') {
      var b1 = listaDoCaminho(h.element, null);
      if (b1) {
        body.appendChild(el('h3', 'hs-sec', 'Ainda por abrir'));
        body.appendChild(b1);
      }
    } else {
      // Sem elemento escolhido não há UM caminho — há QUATRO. Mostramos os
      // quatro para o jogador poder decidir antes de chegar no nível da escolha.
      body.appendChild(el('h3', 'hs-sec', 'O que vem depois'));
      body.appendChild(el('p', 'hs-hint',
        'O caminho elemental abre no nível ' + escolha +
        '. Estes são os feitiços de cada elemento, e o nível em que chegam.'));
      ['fogo', 'agua', 'terra', 'ar'].forEach(function (e) {
        var bl = listaDoCaminho(e, ELEM_PT[e] || e);
        if (bl) body.appendChild(bl);
      });
    }
  }

  // Uma linha de feitiço: ícone, nome, nível de abertura, custo e o que faz.
  function linhaDeFeitico(sid, nivelAbre) {
    var d2 = spellDef(sid);
    var linha = el('div', 'hs-spell-row');
    linha.appendChild(art('spellIcon', [d2 || sid, 38], 38, nivelAbre ? 'silhouette' : ''));
    var txt = el('div', 'hs-spell-txt');
    var cab = el('div', 'hs-spell-h');
    cab.appendChild(el('b', null, esc(spellName(d2, sid))));
    if (nivelAbre) cab.appendChild(el('span', 'hs-lv', 'Nv ' + nivelAbre));
    txt.appendChild(cab);
    if (d2) {
      var ficha = (d2.paCost || 0) + ' PA';
      if (d2.range) ficha += ' · alcance ' + (d2.range.min || 0) + '–' + (d2.range.max || 0);
      if (d2.aoe && d2.aoe.shape && d2.aoe.shape !== 'single') {
        ficha += ' · área ' + d2.aoe.shape + ' ' + (d2.aoe.size || '');
      }
      if (d2.cooldown) ficha += ' · recarga ' + d2.cooldown;
      txt.appendChild(el('div', 'hs-spell-n', esc(ficha)));
      if (d2.description) txt.appendChild(el('p', 'hs-spell-d', esc(d2.description)));
    }
    linha.appendChild(txt);
    if (d2) tipOn(linha, spellName(d2, sid), spellTipBody(d2, sid), elemColor(d2.element));
    return linha;
  }

  function petPicker(heroId, origem) {
    function volta() {
      if (origem === 'party') { partyHero = heroId; sheetParty('inventario'); }
      else sheetHero(heroId);
    }
    var body = sheetShell('Chamar um bicho', 'Um bicho serve a um herói por vez.');
    var pets = ownedPets();
    var g = el('div', 'pet-grid');
    pets.forEach(function (pid) {
      var pd = petDef(pid);
      var c = el('button', 'pet-cell');
      c.type = 'button';
      c.appendChild(art('petIcon', [pid, 56], 56));
      c.appendChild(el('b', null, esc((pd && pd.name) || pid)));
      c.appendChild(el('span', null, petNivelTxt(pid)));
      c.appendChild(el('span', null, esc(bonusText(pd && pd.bonuses))));
      tap(c, function () {
        safe(function () { P().equipPet(heroId, pid); }, null);
        volta();
      });
      g.appendChild(c);
    });
    if (!pets.length) g.appendChild(el('p', 'empty', 'Nenhum bicho no saco.'));
    body.appendChild(g);
    body.appendChild(btn('Voltar', 'btn-ghost btn-block', volta));
  }

  /* O BANCO DE CONTAS (pedido do usuário, 25/08). Cada conta tem id próprio,
   * seu save solo e seu cofre; trocar é recarregar a página com `?conta=` na
   * URL — a conta é decidida no boot, antes de db/progress carregarem. A
   * ficha também ensina o teste de DOIS JOGADORES: duas janelas, duas contas. */
  function sheetContas() {
    var body = sheetShell('Contas',
      'Cada conta tem seu save e seu cofre. Trocar recarrega a página.');
    sheetName = 'contas';
    var C = JOGO.Contas;
    if (!C) { body.appendChild(el('p', 'empty', 'O Banco de Contas não carregou.')); return; }
    var atual = C.ativa();
    var caixa = el('div', 'contas-lista');
    C.lista().forEach(function (c) {
      var linha = el('button', 'conta-linha' + (c.id === atual ? ' is-on' : ''));
      linha.type = 'button';
      linha.appendChild(el('b', null, esc(c.rotulo || c.id)));
      if (C.ehMestre && C.ehMestre(c.id)) linha.appendChild(el('span', 'chip chip-ok', 'GM'));
      linha.appendChild(el('span', null,
        c.id === atual ? 'esta janela' : 'tocar para trocar'));
      tap(linha, function () {
        if (c.id === atual) return;
        confirmSheet('Trocar para “' + esc(c.rotulo || c.id) + '”?',
          'A página recarrega com a outra conta. O que está aberto agora não se perde — cada conta guarda o seu.',
          function () { C.trocar(c.id); });
      });
      caixa.appendChild(linha);
    });
    body.appendChild(caixa);
    body.appendChild(btn('Criar conta nova', 'btn-primary btn-block', function () {
      var id = safe(function () { return C.cria(); }, null);
      if (id) C.trocar(id);
    }));
    // A CONTA DO MESTRE (03/09): só aparece com o modo GM já ligado nesta
    // máquina (a chave também a registra sozinha — este é o caminho manual)
    if (JOGO.GM && safe(function () { return JOGO.GM.ativo(); }, false) && C.criaMestre &&
        !(C.ehMestre && C.ehMestre(C.MESTRE))) {
      body.appendChild(btn('⚔ Criar a conta do Mestre do Fundo', 'btn-gold btn-block', function () {
        var idM = safe(function () { return C.criaMestre(); }, null);
        if (idM) C.trocar(idM);
      }));
    }
    body.appendChild(el('p', 'contas-nota',
      '<b>Dois jogadores na mesma máquina:</b> deixe esta janela numa conta, abra ' +
      'OUTRA janela do mesmo navegador no mesmo endereço e troque lá para outra ' +
      'conta — os dois se veem no Acampamento (fantasma, chat, troca, arena). ' +
      'Atalho: abrir a segunda janela já com <b>?conta=2</b> no fim do endereço.'));
  }

  /* O PERFIL PÚBLICO (pedido 25/08): a ficha de outro jogador da praça —
   * tudo o que o `resumo` da Rede carrega: classes com níveis, total, brasa
   * (com a coroa do degrau) e partidas. É o que transforma um boneco andando
   * em uma pessoa. `par` vem de R.pares() pelo toque no fantasma. */
  function sheetPerfil(par) {
    if (!par) { closeSheet(); return; }
    var body = sheetShell(par.nome || 'Jogador',
      par.titulo ? '«' + par.titulo + '»' : 'jogador da praça');
    sheetName = 'perfil';
    var r = par.resumo || {};

    var topo = el('div', 'perfil-topo');
    topo.appendChild(art('unit', [par.classe, { element: 'neutro', dir: 0, scale: 0.7 }], 110));
    var col = el('div', 'perfil-col');

    // a coroa da arena — o mesmo portão do novato da plaquinha
    var tier = null;
    if (JOGO.Brasa && typeof r.brasa === 'number') {
      tier = JOGO.Brasa.tierDe(r.brasa, false);
      if (tier && tier.min === 0 && !(r.partidas > 0)) tier = null;
    }
    if (tier && JOGO.COROAS_PVP && JOGO.COROAS_PVP[tier.id]) {
      var lc = el('div', 'perfil-coroa');
      var img = document.createElement('img');
      img.src = 'data:image/png;base64,' + JOGO.COROAS_PVP[tier.id];
      img.alt = tier.nome;
      lc.appendChild(img);
      lc.appendChild(el('span', null, '<b>' + esc(tier.nome) + '</b> · ' +
        r.brasa + ' pts · ' + (r.partidas || 0) + ' partida' + ((r.partidas || 0) === 1 ? '' : 's')));
      col.appendChild(lc);
    } else {
      col.appendChild(el('div', 'perfil-coroa is-sem',
        (r.partidas > 0 ? (r.brasa || '?') + ' pts na arena' : 'nunca pisou na arena')));
    }
    // a GALERIA de temporadas (25/08): a melhor coroa que a conta já teve
    var gal = r.galeria || {};
    var melhorG = 0;
    Object.keys(gal).forEach(function (t2) { if (gal[t2] > melhorG) melhorG = gal[t2]; });
    if (melhorG > 0) {
      var nomeG = 'Coroa ' + melhorG;
      ((JOGO.Brasa && JOGO.Brasa.TIERS) || []).forEach(function (tr) {
        if (tr.nivel === melhorG) nomeG = tr.nome;
      });
      col.appendChild(el('div', 'perfil-galeria',
        'galeria: já alcançou <b>' + esc(nomeG) + '</b>'));
    }
    // a guilda (25/08): o clã com que essa pessoa anda
    if (r.guilda && r.guilda.nome) {
      col.appendChild(el('div', 'perfil-guilda',
        esc(r.guilda.emblema || '⚑') + ' <b>' + esc(r.guilda.nome) + '</b>'));
    }
    // o Poço sem Fundo (25/08): o quão fundo essa pessoa já foi
    if (r.poco && (r.poco.recorde > 0 || r.poco.semanaMelhor > 0)) {
      col.appendChild(el('div', 'perfil-poco',
        'Poço: andar <b>' + (r.poco.semanaMelhor || 0) + '</b> na semana · recorde <b>' +
        (r.poco.recorde || 0) + '</b>'));
    }
    col.appendChild(el('div', 'perfil-total',
      'nível somado: <b>' + (r.total || 0) + '</b>'));
    topo.appendChild(col);
    body.appendChild(topo);

    var cls = r.classes || {};
    var tem = false;
    var caixa = el('div', 'perfil-classes');
    Object.keys(cls).sort(function (a, b) { return cls[b] - cls[a]; }).forEach(function (cid) {
      tem = true;
      var row = el('div', 'perfil-classe');
      row.appendChild(el('b', null, esc(className(cid))));
      row.appendChild(el('span', null, 'Nv ' + cls[cid]));
      caixa.appendChild(row);
    });
    body.appendChild(el('h3', 'perfil-h', 'Classes liberadas'));
    body.appendChild(tem ? caixa : el('p', 'empty', 'nada que a Rede saiba contar'));
  }

  /* A GUILDA (pedido 25/08): a ficha inteira — criar, membros, cofre com os
   * bônus do líder, o banco de empréstimos e o ranking das guildas da
   * máquina. A conta da janela entra no espelho do Guilda antes de tudo
   * (o DB é assíncrono; o resto da ficha depende dele). */
  var GUILDA_EMBLEMAS = ['⚑', '🛡️', '🔥', '💧', '🌿', '🌪️', '⭐', '💀',
                         '⚔️', '🐺', '🦅', '🐍', '👑', '⚒️', '🌙', '⚓'];
  var guildaEmblemaEscolhido = '⚑';
  /* O rascunho do nome vive FORA da ficha: clicar num emblema repinta a
   * ficha inteira e recria o <input> — sem isto, o nome digitado sumia. */
  var guildaNomeRascunho = '';
  /* O GERADOR DE NOMES (30/08): "dê bastante opção de criação de nome".
   * 20 × 20 = 400 combinações com o cheiro do mundo enterrado; o sorteio
   * mostra 4 por vez e o ↻ re-sorteia — clicar numa põe no input, que
   * continua livre para escrever qualquer outra coisa. */
  var GUILDA_NOMES_A = ['Lâminas', 'Filhos', 'Guarda', 'Coro', 'Mãos', 'Olhos',
    'Sombras', 'Herdeiros', 'Vigias', 'Cães', 'Corvos', 'Reis', 'Ecos',
    'Chamas', 'Raízes', 'Presas', 'Martelos', 'Escudos', 'Andarilhos', 'Sentinelas'];
  var GUILDA_NOMES_B = ['do Fundo', 'da Lousa', 'da Brasa', 'do Poço',
    'da Cisterna', 'da Estufa', 'do Coração', 'da Descida', 'do Turno',
    'do Vento', 'da Salmoura', 'do Mundo Enterrado', 'da Forja', 'do Sal',
    'do Breu', 'da Maré', 'do Andaime', 'da Mina', 'da Aurora Cega', 'do Último Fecho'];
  function sorteiaNomesGuilda(n) {
    var fora = [], usados = {};
    var guarda = 0;
    while (fora.length < (n || 4) && guarda++ < 80) {
      var a = GUILDA_NOMES_A[Math.floor(Math.random() * GUILDA_NOMES_A.length)];
      var b = GUILDA_NOMES_B[Math.floor(Math.random() * GUILDA_NOMES_B.length)];
      var nome = a + ' ' + b;
      if (usados[nome]) continue;
      usados[nome] = true;
      fora.push(nome);
    }
    return fora;
  }
  function sheetGuilda() {
    var body = sheetShell('Guilda',
      'Cofre que só o líder gasta, bônus para todos, e um banco de empréstimos entre membros.');
    sheetName = 'guilda';
    var Gd = JOGO.Guilda;
    if (!Gd || !JOGO.DB) { body.appendChild(el('p', 'empty', 'A guilda não carregou.')); return; }
    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);

    var contaJ = null;               // sobrevive ao primeiro .then (o banco usa)
    JOGO.DB.jogador().then(function (j) {
      contaJ = j;
      Gd.contaAtiva(j.id, j.nome || 'Sem Nome');
      return Promise.all([Gd.minha(), Gd.lista()]);
    }).then(function (r) {
      var g = r[0], ranking = r[1] || [];
      clear(caixa);

      if (!g) {
        // ---- SEM GUILDA: fundar uma, ou esperar convite na praça
        caixa.appendChild(el('p', 'inv-dica',
          'Funde a sua — ou espere um convite: líderes convidam tocando no seu fantasma na praça.'));

        // O PREÇO: 10 insígnias de fundação, a moeda que só chefe derruba.
        // O saldo aparece aqui para o jogador saber quanto falta ANTES de
        // escolher nome — a recusa do core vira toast, mas ninguém gosta de
        // batizar uma guilda que não pode pagar.
        var precoIns = (JOGO.DATA && JOGO.DATA.insignias && JOGO.DATA.insignias.porGuilda) || 10;
        var saldoIns = 0;
        try { saldoIns = P().insigniasVer(); } catch (e) {}
        var podePagar = saldoIns >= precoIns;
        var linhaIns = el('p', 'inv-dica',
          '<b>' + saldoIns + '/' + precoIns + '</b> insígnias de fundação — ' +
          (podePagar ? 'dá para fundar!' : 'só chefe derruba, uma por queda.'));
        linhaIns.insertBefore(art('insigniaIcon', [18], 18, 'selo-inline'), linhaIns.firstChild);
        linhaIns.style.color = podePagar ? '#7fe08a' : '#c9a227';
        caixa.appendChild(linhaIns);

        var fila = el('div', 'guilda-emblemas');
        GUILDA_EMBLEMAS.forEach(function (em) {
          var b = btn(em, 'btn-mini' + (guildaEmblemaEscolhido === em ? ' btn-gold' : ' btn-ghost'),
            function () { guildaEmblemaEscolhido = em; sheetGuilda(); });
          fila.appendChild(b);
        });
        caixa.appendChild(fila);
        var inp = document.createElement('input');
        inp.className = 'hub-input';
        inp.maxLength = 24;
        inp.placeholder = 'nome da guilda';
        inp.value = guildaNomeRascunho;
        inp.oninput = function () { guildaNomeRascunho = inp.value; };
        caixa.appendChild(inp);

        // as SUGESTÕES: quatro nomes sorteados, um clique põe no input
        var sug = el('div', 'guilda-sugestoes');
        function pintaSugestoes() {
          clear(sug);
          sorteiaNomesGuilda(4).forEach(function (nome) {
            sug.appendChild(btn(nome, 'btn-mini btn-ghost', function () {
              guildaNomeRascunho = nome;
              inp.value = nome;
            }));
          });
          sug.appendChild(btn('↻ outros nomes', 'btn-mini btn-gold', pintaSugestoes));
        }
        pintaSugestoes();
        caixa.appendChild(sug);

        caixa.appendChild(btn('Fundar a guilda  (' + precoIns + ' insígnias)', 'btn-primary btn-block', function () {
          Gd.criar(inp.value, guildaEmblemaEscolhido).then(function (res) {
            if (!res.ok) { toast(res.erro || 'não deu'); return; }
            guildaNomeRascunho = '';
            toast('A ' + res.guilda.emblema + ' ' + res.guilda.nome + ' existe — e você a lidera.', 'good');
            // a plaquinha da praça ganha a placa da guilda na hora — os
            // undefined preservam nome/título/coroa que já estão pendurados
            resumoGuilda = { nome: res.guilda.nome, emblema: res.guilda.emblema };
            if (JOGO.Hub && JOGO.Hub.nomeia) {
              try { JOGO.Hub.nomeia(undefined, undefined, undefined, resumoGuilda); } catch (e) {}
            }
            sheetGuilda();
          });
        }));
      } else {
        // ---- A FICHA
        var cab = el('div', 'guilda-cab');
        cab.appendChild(el('span', 'guilda-emblema', esc(g.emblema)));
        var ct = el('div', 'guilda-cab-t');
        ct.appendChild(el('h3', null, esc(g.nome) + ' <i>nível ' + g.nivel + '</i>'));
        var alvoNivel = 60 * g.nivel * (g.nivel + 1) / 2;
        var baseNivel = g.nivel > 1 ? 60 * (g.nivel - 1) * g.nivel / 2 : 0;
        ct.appendChild(bar('bar-xp', (g.xp - baseNivel) / Math.max(1, alvoNivel - baseNivel),
          'XP da guilda ' + g.xp + ' / ' + alvoNivel));
        ct.appendChild(el('span', 'guilda-sub', g.membros.length + ' membro(s) · ' +
          g.treinos + ' treino(s) na arena'));
        cab.appendChild(ct);
        caixa.appendChild(cab);

        // ---- MEMBROS E CARGOS (30/08): líder ⚑, oficiais ★, membros. O
        // líder promove e rebaixa daqui; oficial ganha a chave do cofre.
        var lm = el('div', 'guilda-membros');
        g.membros.forEach(function (m) {
          var ehLider = m.cargo === 'lider';
          var ehOficial = m.cargo === 'oficial';
          var chip = el('span', 'guilda-membro' + (ehLider ? ' is-lider' : ''),
            (ehLider ? '⚑ ' : ehOficial ? '★ ' : '') + esc(m.nome) +
            (ehOficial ? ' <i>oficial</i>' : ''));
          if (g.souLider && !ehLider) {
            var bAcao = btn(ehOficial ? '▾' : '▴', 'btn-mini btn-ghost', function () {
              var op = ehOficial ? Gd.rebaixar(m.id) : Gd.promover(m.id);
              op.then(function (res) {
                toast(res.ok
                  ? (res.cargo === 'oficial'
                      ? esc(m.nome) + ' agora é oficial — ganhou a chave do cofre.'
                      : esc(m.nome) + ' voltou a membro.')
                  : (res.erro || 'não deu'), res.ok ? 'good' : undefined);
                sheetGuilda();
              });
            });
            bAcao.title = ehOficial ? 'Rebaixar a membro' : 'Promover a oficial';
            chip.appendChild(bAcao);
          }
          lm.appendChild(chip);
        });
        caixa.appendChild(lm);

        // ---- A OFERENDA (30/08): "a guild upa conforme os usuários doam
        // xp" — vinténs da conta viram XP da guilda, 2 por 1. Qualquer
        // membro doa; o dreno de moeda é o preço da vaidade coletiva.
        var of = el('div', 'guilda-oferenda');
        of.style.cssText = 'display:flex;gap:8px;align-items:center;margin:8px 0';
        var ofInp = document.createElement('input');
        ofInp.type = 'number'; ofInp.min = '2'; ofInp.step = '2';
        ofInp.placeholder = 'vinténs';
        ofInp.className = 'hub-input';
        ofInp.style.cssText = 'width:110px;margin:0';
        of.appendChild(ofInp);
        of.appendChild(btn('Doar à guilda (2 vinténs = 1 XP)', 'btn-mini btn-gold', function () {
          var v = Math.floor(Number(ofInp.value) || 0);
          if (v < 2) { toast('doe ao menos 2 vinténs'); return; }
          v -= v % 2;
          JOGO.DB.gastarMoedas(v).then(function (res) {
            if (!res.ok) { toast(res.erro || 'vinténs insuficientes'); return; }
            Gd.doarXp(v / 2).then(function (r2) {
              toast(r2.ok ? 'A guilda recebeu ' + (v / 2) + ' XP — nível ' + r2.nivel + '.'
                          : (r2.erro || 'não deu'), r2.ok ? 'good' : undefined);
              sheetGuilda();
            });
          });
        }));
        caixa.appendChild(of);

        // ---- A PORTA E O DÍZIMO (30/08): governo do líder. A porta decide
        // se a sede aceita qualquer um ou só pedido; o dízimo é a % do XP
        // que cada membro doa à guilda no fim de cada sala.
        if (g.souLider) {
          var gov = el('div', 'guilda-governo');
          gov.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0';
          var portaAtual = g.porta === 'convite' ? 'convite' : 'aberta';
          gov.appendChild(btn('Porta: ' + (portaAtual === 'convite' ? 'por convite' : 'aberta') + ' ⇄',
            'btn-mini btn-ghost', function () {
              Gd.definirPorta(portaAtual === 'convite' ? 'aberta' : 'convite').then(function (res) {
                toast(res.ok ? 'A porta agora é ' +
                      (res.porta === 'convite' ? 'por convite.' : 'aberta.') : (res.erro || 'não deu'),
                      res.ok ? 'good' : undefined);
                sheetGuilda();
              });
            }));
          var dzInp = document.createElement('input');
          dzInp.type = 'number'; dzInp.min = '0'; dzInp.max = String(Gd.DIZIMO_MAX || 25);
          dzInp.value = String(g.dizimo || 0);
          dzInp.className = 'hub-input';
          dzInp.style.cssText = 'width:70px;margin:0';
          gov.appendChild(el('span', 'inv-dica', 'dízimo de XP:'));
          gov.appendChild(dzInp);
          gov.appendChild(btn('% definir', 'btn-mini btn-gold', function () {
            Gd.definirDizimo(Math.floor(Number(dzInp.value) || 0)).then(function (res) {
              toast(res.ok ? 'Dízimo em ' + res.dizimo + '% — cada membro doa essa fatia do XP.'
                           : (res.erro || 'não deu'), res.ok ? 'good' : undefined);
              sheetGuilda();
            });
          }));
          caixa.appendChild(gov);
        } else if (g.dizimo > 0) {
          caixa.appendChild(el('p', 'inv-dica',
            'Dízimo da guilda: <b>' + g.dizimo + '%</b> do XP de cada sala vira XP da guilda.'));
        }

        // ---- A FILA DE PEDIDOS: líder e oficiais decidem quem entra
        var fila = g.pedidos || [];
        if (fila.length && (g.meuCargo === 'lider' || g.meuCargo === 'oficial')) {
          var fp = el('div', 'guilda-pedidos');
          fp.appendChild(el('h3', 'bk-tit', 'Pedidos de entrada (' + fila.length + ')'));
          fila.forEach(function (p) {
            var lp = el('div', 'guilda-rank');
            lp.appendChild(el('span', null, esc(p.nome)));
            lp.appendChild(btn('Aceitar', 'btn-mini btn-primary', function () {
              Gd.aceitarPedido(p.id).then(function (res) {
                toast(res.ok ? esc(p.nome) + ' entrou na guilda!' : (res.erro || 'não deu'),
                      res.ok ? 'good' : undefined);
                sheetGuilda();
              });
            }));
            lp.appendChild(btn('Recusar', 'btn-mini btn-ghost', function () {
              Gd.recusarPedido(p.id).then(function () { sheetGuilda(); });
            }));
            fp.appendChild(lp);
          });
          caixa.appendChild(fp);
        }

        // ---- O COFRE: a moeda da guilda — líder e oficiais gastam
        var cofre = el('div', 'guilda-cofre');
        cofre.appendChild(el('h3', 'bk-tit', 'Cofre da guilda — <b>' + g.moedas + '</b> marcas'));
        cofre.appendChild(el('p', 'inv-dica',
          'Marcas nascem das competições da guilda (o treino paga ' + Gd.MOEDA_TREINO +
          '; a competição de verdade chega com o servidor). Líder e oficiais gastam — em bônus de 24h para TODOS.'));
        ['drop', 'xp'].forEach(function (tipo) {
          var rot = tipo === 'drop' ? '+15% de saque' : '+15% de XP';
          var ate = g.bonus && g.bonus[tipo];
          var vivo = ate && ate > Date.now();
          var linha = el('div', 'guilda-bonus' + (vivo ? ' is-vivo' : ''));
          linha.appendChild(el('span', null, '<b>' + rot + '</b>' +
            (vivo ? ' · vivo por mais ' + Math.ceil((ate - Date.now()) / 3600000) + 'h' : '')));
          if (g.souLider) {
            linha.appendChild(btn((vivo ? 'Estender' : 'Comprar') + ' (' + Gd.CUSTO_BONUS + ')',
              'btn-mini' + (g.moedas >= Gd.CUSTO_BONUS ? ' btn-gold' : ' is-off'), function () {
                Gd.compraBonus(tipo).then(function (res) {
                  toast(res.ok ? 'O bônus de ' + rot + ' vale para toda a guilda!' : (res.erro || 'não deu'),
                        res.ok ? 'good' : undefined);
                  sheetGuilda();
                });
              }));
          }
          cofre.appendChild(linha);
        });
        caixa.appendChild(cofre);

        // ---- O BANCO DE EMPRÉSTIMOS — DUAS GRADES, como o cofre do Banco
        // (pedido 30/08: "igual ao cofre a maneira de transferir itens...
        // abre o inventário e o inventário da guild"). O gesto é o mesmo:
        // arrasto ou dois toques. As REGRAS de empréstimo continuam do core:
        //   saco → banco: DEVOLVE se você devia aquele item; senão DEPOSITA;
        //   banco → saco: sua peça volta DE VEZ; a dos outros sai EMPRESTADA
        //   (uma por conta); peça emprestada a alguém não sai.
        var bg = el('div', 'guilda-banco');
        bg.appendChild(el('h3', 'bk-tit', 'Banco da guilda'));
        bg.appendChild(el('p', 'inv-dica',
          'Arraste (ou dois toques) entre o saco e o banco, como no cofre. ' +
          'Peça de outro dono sai <b>emprestada</b> — uma por vez — e se devolve ' +
          'arrastando uma cópia igual de volta.'));
        Gd.bancoLista().then(function (itens) {
          // a ficha da guilda alarga como a do banco: duas grades pedem chão
          var painelG = sheetEl.querySelector('.sheet-panel');
          if (painelG) painelG.classList.add('sheet-larga');

          var pilhas = safe(function () { return P().invStacks(); }, [])
            .filter(function (s2) { return !!itemDef(s2.itemId); });
          var unidadesSaco = 0;
          pilhas.forEach(function (pu) { unidadesSaco += pu.count; });

          // no banco cada ENTRADA é uma pilha própria (count 1): dono e
          // estado de empréstimo são por peça — empilhar mentiria
          var pilhasBanco = itens.map(function (e2, idx) {
            return { itemId: e2.itemId, level: e2.level || 0, stars: e2.stars || 0,
                     count: 1, indices: [idx], entrada: e2 };
          });

          var duplo = el('div', 'bk2-duplo');
          var colSaco = el('div', 'bk2-col');
          colSaco.dataset.lado = 'saco';
          colSaco.appendChild(el('h3', 'bk-tit', 'No saco (' + unidadesSaco + ')'));
          colSaco.appendChild(bancoGrade(pilhas, 'saco', function (pi) {
            var st2 = P().state;
            var entrada = st2.inventory[pi.indices[0]];
            if (!entrada) { toast('essa peça já saiu'); sheetGuilda(); return; }
            // DEVOLUÇÃO PELO GESTO: se você deve ESTE item ao banco, levar a
            // cópia até lá é devolver — não criar um segundo depósito
            var devIdx = -1;
            for (var d2 = 0; d2 < itens.length; d2++) {
              var eb = itens[d2];
              if (eb.emprestadoPara === contaJ.id && eb.itemId === entrada.itemId &&
                  (eb.level || 0) === (entrada.level || 0) &&
                  (eb.stars || 0) === (entrada.stars || 0)) { devIdx = d2; break; }
            }
            var op = (devIdx >= 0) ? Gd.bancoDevolver(devIdx) : Gd.bancoDepositar(entrada);
            op.then(function (res) {
              if (!res.ok) { toast(res.erro || 'não deu'); sheetGuilda(); return; }
              st2.inventory.splice(pi.indices[0], 1);
              safe(function () { P().save(); }, null);
              toast(devIdx >= 0 ? 'Devolvida. Obrigado em nome da guilda.'
                                : 'No banco da guilda.', 'good');
              sheetGuilda();
            });
          }));

          var colBanco = el('div', 'bk2-col');
          colBanco.dataset.lado = 'cofre';
          colBanco.appendChild(el('h3', 'bk-tit', 'Banco da guilda (' + itens.length + ')'));
          colBanco.appendChild(bancoGrade(pilhasBanco, 'cofre', function (pi) {
            var e2 = pi.entrada;
            if (e2.emprestadoPara && e2.emprestadoPara !== contaJ.id) {
              toast('Emprestada a ' + (e2.tomadorNome || 'alguém') + ' — espere devolver.');
              return;
            }
            if (e2.emprestadoPara === contaJ.id) {
              toast('Essa já está com você — devolva arrastando a cópia do saco.');
              return;
            }
            if (!safe(function () { return P().bagFree(1); }, true)) {
              toast('O saco está cheio — não cabe mais nada.');
              return;
            }
            Gd.bancoPegar(pi.indices[0]).then(function (res) {
              if (!res.ok) { toast(res.erro || 'não deu'); sheetGuilda(); return; }
              P().state.inventory.push({ itemId: e2.itemId, level: e2.level || 0,
                                         stars: e2.stars || 0 });
              safe(function () { P().save(); }, null);
              toast(res.definitivo ? 'Sua peça voltou para o saco.' :
                    'Emprestada — devolva uma cópia igual quando puder.', 'good');
              sheetGuilda();
            });
          }));

          duplo.appendChild(colSaco);
          duplo.appendChild(colBanco);
          bg.appendChild(duplo);

          // o extrato: quem deve o quê — a grade não conta essa história
          var emprestadas = itens.filter(function (e3) { return !!e3.emprestadoPara; });
          if (emprestadas.length) {
            var ext = el('p', 'inv-dica');
            ext.innerHTML = emprestadas.map(function (e3) {
              var it3 = itemDef(e3.itemId) || {};
              return '⚑ <b>' + esc(it3.name || e3.itemId) + '</b> de ' +
                     esc(e3.donoNome || '?') + ' está com ' + esc(e3.tomadorNome || '?');
            }).join(' · ');
            bg.appendChild(ext);
          }
          caixa.appendChild(bg);

          caixa.appendChild(btn('Sair da guilda', 'btn-warn btn-block', function () {
            confirmSheet('Sair da ' + g.nome + '?',
              g.membros.length === 1
                ? 'Você é o último membro — a guilda se dissolve.'
                : 'A liderança passa ao membro mais antigo, se for sua.', function () {
                Gd.sair().then(function (res) {
                  toast(res.ok ? 'Você saiu da guilda.' : (res.erro || 'não deu'));
                  openSheet('guilda');
                });
              });
          }));

          // ---- o ranking, no pé
          if (ranking.length) {
            caixa.appendChild(el('h3', 'bk-tit', 'Ranking das guildas'));
            ranking.forEach(function (rg, ri) {
              caixa.appendChild(el('div', 'guilda-rank' + (g && rg.id === g.id ? ' is-minha' : ''),
                '<b>' + (ri + 1) + 'º</b> ' + esc(rg.emblema) + ' ' + esc(rg.nome) +
                ' · nível ' + rg.nivel + ' · ' + rg.xp + ' XP · ' + rg.membros + ' membro(s)'));
            });
          }
        });
      }

      // sem guilda o ranking também aparece — e é a PORTA DE ENTRADA
      // (30/08): guilda aberta entra na hora; a de convite recebe o pedido
      if (!g && ranking.length) {
        caixa.appendChild(el('h3', 'bk-tit', 'Guildas do acampamento'));
        ranking.forEach(function (rg, ri) {
          var linha = el('div', 'guilda-rank');
          linha.appendChild(el('span', null,
            '<b>' + (ri + 1) + 'º</b> ' + esc(rg.emblema) + ' ' + esc(rg.nome) +
            ' · nível ' + rg.nivel + ' · ' + rg.membros + ' membro(s) · porta ' +
            (rg.porta === 'convite' ? 'por convite' : 'aberta')));
          linha.appendChild(btn(rg.porta === 'convite' ? 'Pedir para entrar' : 'Entrar',
            'btn-mini ' + (rg.porta === 'convite' ? 'btn-ghost' : 'btn-primary'), function () {
              var op = rg.porta === 'convite' ? Gd.pedirEntrada(rg.id) : Gd.entrar(rg.id);
              op.then(function (res) {
                if (!res.ok) { toast(res.erro || 'não deu'); return; }
                toast(res.entrou === false
                  ? 'Pedido enviado — o líder da ' + rg.nome + ' decide.'
                  : 'Bem-vindo à ' + rg.nome + '!', 'good');
                sheetGuilda();
              });
            }));
          caixa.appendChild(linha);
        });
      }
    });
  }

  /* O PAINEL DO MESTRE (31/08): só existe com a chave do dono. PA/PP à
   * escolha, o set e os quatro caminhos com um toque, e o GRIMÓRIO —
   * qualquer feitiço do jogo entra na barra do GM. O Julgamento vai sempre. */
  var gmBusca = '';
  /* A CAIXA DO MESTRE (03/09, pedido do dono): "o GM pode abrir uma caixa
   * para pegar qualquer item do jogo pra ele equipar; terá um menu exclusivo
   * para pegar pet ou set para seu inventário". Três abas — Itens, Conjuntos,
   * Bichos — com busca; tudo entra direto no saco. Só com a chave virada. */
  var gmCaixaAba = 'itens', gmCaixaBusca = '';
  function sheetGMCaixa() {
    var GMod = JOGO.GM;
    if (!GMod || !GMod.ativo || !GMod.ativo()) { closeSheet(); return; }
    var body = sheetShell('A Caixa do Mestre',
      'Qualquer item, conjunto ou bicho do jogo — direto para o saco, sem sorteio.');
    sheetName = 'gmcaixa';

    var abas = el('div', 'inv-filtros');
    abas.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
    [['itens', 'Itens'], ['sets', 'Conjuntos'], ['bichos', 'Bichos']].forEach(function (par) {
      var b = btn(par[1], 'btn-mini' + (gmCaixaAba === par[0] ? ' btn-gold' : ' btn-ghost'), function () {
        gmCaixaAba = par[0]; sheetGMCaixa();
      });
      abas.appendChild(b);
    });
    body.appendChild(abas);
    var busca = document.createElement('input');
    busca.className = 'hub-input';
    busca.placeholder = 'buscar por nome...';
    busca.value = gmCaixaBusca;
    body.appendChild(busca);
    var listaEl = el('div', 'ms-caixa');
    body.appendChild(listaEl);
    var D0 = D();

    function linha(icone, titulo, sub, rotuloBtn, aoPegar) {
      var row = el('div', 'ms-linha');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 4px;border-bottom:1px solid var(--line,#262d38)';
      row.appendChild(icone);
      var txt = el('div', null);
      txt.style.cssText = 'flex:1 1 auto;min-width:0';
      txt.appendChild(el('b', null, esc(titulo)));
      txt.appendChild(el('div', 'inv-dica', sub));
      row.appendChild(txt);
      row.appendChild(btn(rotuloBtn, 'btn-mini btn-gold', aoPegar));
      return row;
    }
    function pinta() {
      clear(listaEl);
      var tq = (gmCaixaBusca || '').toLowerCase();
      var vistas = 0, TETO = 48;
      function passa(nome, id) {
        return !tq || (nome || '').toLowerCase().indexOf(tq) >= 0 || (id || '').toLowerCase().indexOf(tq) >= 0;
      }
      function corta() {
        if (++vistas > TETO) { listaEl.appendChild(el('p', 'inv-dica', '… e mais — afine a busca.')); return true; }
        return false;
      }
      if (gmCaixaAba === 'itens') {
        var ids = Object.keys(D0.items || {}).sort(function (a, b) {
          return (D0.items[a].name || a).localeCompare(D0.items[b].name || b);
        });
        for (var i = 0; i < ids.length; i++) {
          var it = D0.items[ids[i]];
          if (!it || !passa(it.name, ids[i])) continue;
          if (corta()) break;
          (function (id2, it2) {
            var sub = esc(SLOT_PT[slotOf(id2)] || '') + ' · ' + esc(RAR_PT[it2.rarity] || it2.rarity || '') +
                      (it2.setId ? ' · ' + esc((setDef(it2.setId) || {}).name || it2.setId) : '') +
                      ' · ' + esc(bonusText(it2.bonuses));
            listaEl.appendChild(linha(art('itemIcon', [id2, 40], 40), it2.name || id2, sub, 'Pegar', function () {
              if (GMod.pegaItem(id2)) toast(it2.name + ' está no saco.', 'good');
              else toast('não deu');
            }));
          })(ids[i], it);
        }
      } else if (gmCaixaAba === 'sets') {
        var sids = Object.keys(D0.sets || {}).sort(function (a, b) {
          return (D0.sets[a].name || a).localeCompare(D0.sets[b].name || b);
        });
        for (var s = 0; s < sids.length; s++) {
          var sd = D0.sets[sids[s]];
          if (!sd || !passa(sd.name, sids[s])) continue;
          if (corta()) break;
          (function (sid2, sd2) {
            var pecas = (sd2.pieces || []).map(function (pid) { return (itemDef(pid) || {}).name || pid; });
            var ic = art('itemIcon', [(sd2.pieces || [])[0], 40], 40);
            listaEl.appendChild(linha(ic, sd2.name || sid2,
              pecas.length + ' peças: ' + esc(pecas.join(', ')), 'Pegar o conjunto', function () {
                var n = GMod.pegaSet(sid2);
                toast(n ? (sd2.name + ': ' + n + ' peças no saco.') : 'não deu', n ? 'good' : undefined);
              }));
          })(sids[s], sd);
        }
      } else {
        var pids = Object.keys(D0.pets || {}).sort(function (a, b) {
          return (D0.pets[a].name || a).localeCompare(D0.pets[b].name || b);
        });
        for (var p = 0; p < pids.length; p++) {
          var pd = D0.pets[pids[p]];
          if (!pd || !passa(pd.name, pids[p])) continue;
          if (corta()) break;
          (function (pid2, pd2) {
            var info = petCardInfo(pid2);
            var sub = esc(bonusText(pd2.bonuses)) + ' · ' + (info.unlocked ? 'é seu — ' + petNivelTxt(pid2) : 'não é seu');
            var row = linha(art('petIcon', [pid2, 40], 40), pd2.name || pid2, sub, 'Pegar', function () {
              if (GMod.pegaPet(pid2, false)) { toast(pd2.name + ' está no saco de bichos.', 'good'); sheetGMCaixa(); }
              else toast('não deu');
            });
            row.appendChild(btn('★3 nv10', 'btn-mini btn-primary', function () {
              if (GMod.pegaPet(pid2, true)) { toast(pd2.name + ' no topo: ★3, nível 10.', 'good'); sheetGMCaixa(); }
              else toast('não deu');
            }));
            listaEl.appendChild(row);
          })(pids[p], pd);
        }
      }
      if (!vistas) listaEl.appendChild(el('p', 'inv-dica', 'Nada com esse nome.'));
    }
    busca.addEventListener('input', function () { gmCaixaBusca = busca.value; pinta(); });
    pinta();
    body.appendChild(btn('Voltar ao Painel do Mestre', 'btn-ghost btn-block', function () { openSheet('gm'); }));
  }

  function sheetGM() {
    var GMod = JOGO.GM;
    if (!GMod || !GMod.ativo || !GMod.ativo()) { closeSheet(); return; }
    var body = sheetShell('Painel do Mestre',
      'O mundo é seu. PA/PP à sua palavra, o grimório inteiro à mão, e o cofre sem fundo.');
    sheetName = 'gm';

    var pp3 = GMod.paPp();
    var linhaP = el('div', 'guilda-governo');
    linhaP.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
    function campoNum(valor) {
      var i2 = document.createElement('input');
      i2.type = 'number'; i2.min = '1'; i2.max = '30';
      i2.value = String(valor);
      i2.className = 'hub-input';
      i2.style.cssText = 'width:64px;margin:0';
      return i2;
    }
    var inPa = campoNum(pp3.pa), inPp = campoNum(pp3.pp);
    linhaP.appendChild(el('span', 'inv-dica', 'PA:'));
    linhaP.appendChild(inPa);
    linhaP.appendChild(el('span', 'inv-dica', 'PP:'));
    linhaP.appendChild(inPp);
    linhaP.appendChild(btn('Aplicar', 'btn-mini btn-gold', function () {
      GMod.definePaPp(inPa.value, inPp.value);
      toast('O Mestre decidiu: ' + GMod.paPp().pa + ' PA e ' + GMod.paPp().pp + ' PP.', 'good');
    }));
    linhaP.appendChild(btn('Aparelhar o Mestre', 'btn-mini btn-primary', function () {
      if (GMod.aparelha()) toast('Panóplia no saco e os quatro caminhos abertos.', 'good');
      else toast('não deu — o Progress não respondeu');
    }));
    body.appendChild(linhaP);
    // A CAIXA DO MESTRE (03/09): qualquer item, conjunto ou bicho do jogo
    body.appendChild(btn('📦 Abrir a Caixa do Mestre — itens, conjuntos e bichos', 'btn-gold btn-block', function () {
      openSheet('gmcaixa');
    }));
    body.appendChild(el('p', 'inv-dica',
      'O cofre não tem fundo: todo preço se paga sozinho enquanto a chave estiver virada. ' +
      'Escolha o <b>Mestre do Fundo</b> na tela Quem Desce para levá-lo à batalha.'));

    // ---- o GRIMÓRIO
    body.appendChild(el('h3', 'hs-sec', 'Grimório — qualquer feitiço do jogo'));
    var fontes = [JOGO.DATA.spells, JOGO.DATA.monsterSpells, JOGO.DATA.petSpells, JOGO.DATA.itemSpells];
    var todos = [];
    fontes.forEach(function (src) {
      if (!src) return;
      for (var id in src) {
        if (src.hasOwnProperty(id) && src[id] && src[id].name && id !== 'gm-julgamento') {
          todos.push(src[id]);
        }
      }
    });
    todos.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    var escolhidos = GMod.grimorio().length - 1;      // sem contar o Julgamento
    body.appendChild(el('p', 'inv-dica',
      '<b>' + escolhidos + '</b> escolhido(s) + o Julgamento do Mestre (sempre na barra). ' +
      todos.length + ' feitiços no acervo — busque e toque para ligar/desligar.'));
    var busca = document.createElement('input');
    busca.className = 'hub-input';
    busca.placeholder = 'buscar feitiço por nome...';
    busca.value = gmBusca;
    body.appendChild(busca);
    var listaEl = el('div', 'ms-caixa');
    body.appendChild(listaEl);

    function pinta() {
      clear(listaEl);
      var t = (gmBusca || '').toLowerCase();
      var vistas = 0;
      for (var i = 0; i < todos.length; i++) {
        var sp = todos[i];
        var casa = !t || (sp.name || '').toLowerCase().indexOf(t) >= 0 ||
                   (sp.id || '').toLowerCase().indexOf(t) >= 0;
        if (!casa) continue;
        if (++vistas > 40) {
          listaEl.appendChild(el('p', 'inv-dica', '… e mais — afine a busca.'));
          break;
        }
        (function (sp2) {
          var tem = GMod.temSpell(sp2.id);
          var row = el('div', 'ms-linha' + (tem ? ' is-feita' : ''));
          var tx = el('div', 'ms-tx');
          tx.appendChild(el('div', 'ms-nome', esc(sp2.name) +
            ' <i>· ' + (ELEM_PT[sp2.element] || sp2.element || '?') + ' · ' +
            (sp2.paCost || 0) + ' PA</i>'));
          if (sp2.description) {
            tx.appendChild(el('div', 'ms-prog', esc(String(sp2.description).slice(0, 90))));
          }
          row.appendChild(tx);
          row.appendChild(btn(tem ? 'Tirar' : 'Pôr na barra',
            'btn-mini ' + (tem ? 'btn-ghost' : 'btn-gold'), function () {
              GMod.alternaSpell(sp2.id);
              sheetGM();
            }));
          listaEl.appendChild(row);
        })(sp);
      }
      if (!vistas) listaEl.appendChild(el('p', 'empty', 'Nada com esse nome no acervo.'));
    }
    busca.addEventListener('input', function () { gmBusca = busca.value; pinta(); });
    pinta();
  }

  function sheetBattleMenu() {
    var body = sheetShell('Pausa');
    var acts = el('div', 'menu-acts');
    // com o menu dividido, a pausa aponta para as duas fichas que importam
    // no meio da luta: o saco e a árvore de feitiços
    acts.appendChild(btn('Inventário', 'btn-ghost', function () { openSheet('inventory'); }));
    acts.appendChild(btn('Feitiços', 'btn-ghost', function () { openSheet('spells'); }));
    acts.appendChild(btn('Abandonar a descida', 'btn-warn', function () {
      confirmSheet('Abandonar?', 'O que você já ganhou fica. A sala em curso se perde.', function () {
        safe(function () { G().restart(); }, null);
        UI.showScreen('menu');
      });
    }));
    acts.appendChild(btn('Voltar à luta', 'btn-primary', closeSheet));
    body.appendChild(acts);
  }

  // ==========================================================================
  // EVENTOS DO ENGINE  →  log compacto
  // ==========================================================================
  var EV_TEXT = {
    dodgeFail: function (ev) { return nameOf(ev.uid) + ' foi fixado e perdeu o passo.'; },
    dodgeOk: function (ev) { return nameOf(ev.uid) + ' escapou.'; },
    weatherShift: function (ev) {
      var w = (D().weathers && D().weathers[ev.weather]) || null;
      return 'O clima vira ' + ((w && w.name) || ev.weather) + '.';
    },
    weatherTick: function (ev) {
      return nameOf(ev.uid) + (ev.amount > 0 ? ' se recupera (+' : ' sofre com o clima (') +
             Math.abs(ev.amount) + ' PV)' + (ev.amount > 0 ? '' : '');
    },
    tileEvent: function (ev) { return ev.text || (nameOf(ev.uid) + ' pisou em algo.'); },
    trapTriggered: function (ev) { return nameOf(ev.uid) + ' pisou numa armadilha!'; },
    markStack: function (ev) { return nameOf(ev.uid) + ' está marcado (' + ev.stacks + ').'; },
    petAct: function (ev) { return nameOf(ev.uid) + ' agiu sozinho.'; },
    fusion: function (ev) { return 'FUSÃO! ' + nameOf(ev.uid) + ' entra em campo.'; }
  };
  function nameOf(uid) {
    var u = unitByUid(uid);
    return esc((u && (u.name || u.defId)) || 'alguém');
  }

  function pushLog(text, cls) {
    if (!text) return;
    logLines.push({ t: text, c: cls || '' });
    if (logLines.length > 40) logLines.shift();
    if (!bt.logList) return;
    var line = el('div', 'log-line ' + (cls || ''), text);
    bt.logList.appendChild(line);
    while (bt.logList.childNodes.length > 40) bt.logList.removeChild(bt.logList.firstChild);
    bt.logList.scrollTop = bt.logList.scrollHeight;
  }

  UI.handleEvent = function (ev) {
    if (!ev || !ev.type) return;
    if (ev.type === 'timerTick') { paintTimer(); return; }
    if (current !== 'battle') return;
    if (ev.type === 'log') { pushLog(esc(ev.text)); return; }
    var f = EV_TEXT[ev.type];
    if (f) {
      var cls = ev.type === 'fusion' ? 'l-fusion'
              : ev.type === 'dodgeFail' || ev.type === 'trapTriggered' ? 'l-bad'
              : ev.type === 'dodgeOk' ? 'l-good' : '';
      pushLog(safe(function () { return f(ev); }, ''), cls);
    }
    // [U6] a fixação leva TODO o PP e não tira ninguém do lugar: a linha do
    // diário (canto, 11px) passava despercebida e o jogador só via o PP sumir.
    if (ev.type === 'dodgeFail') {
      var vit = unitByUid(ev.uid);
      if (vit && vit.side === 'player') {
        toast((vit.name || vit.defId) + ' foi fixado: perdeu todo o PP' +
              (ev.critical ? ' e 1 PA' : '') + ' sem sair do lugar.', 'bad');
      }
    }
    if (ev.type === 'fusion' || ev.type === 'turnStart' || ev.type === 'turnEnd') battleSig = '';
  };

  // ==========================================================================
  // LOOP
  // ==========================================================================
  UI.update = function (dt) {
    if (toastEl && toastT > 0) {
      toastT -= (dt || 0.016);
      if (toastT <= 0) toastEl.classList.remove('is-on');
    }
    if (miraEl && miraT > 0) {
      miraT -= (dt || 0.016);
      if (miraT <= 0) miraEl.classList.remove('is-on');
    }
    if (current !== 'battle') return;

    // O RECENTRAR SO APARECE QUANDO HA O QUE RECENTRAR. Ele nasce escondido e
    // surge no instante em que o jogador mexe na camera; some de novo quando
    // ela volta ao lugar. Botao que fica na tela sem nunca fazer nada ensina a
    // ser ignorado — e ai nao e visto quando faz falta.
    if (bt && bt.cam && JOGO.Renderer && JOGO.Renderer.cameraManual) {
      // Some também quando a câmera está TRAVADA: dois botões lado a lado
      // dizendo coisas opostas — «não mexa» e «mexa de volta» — são uma
      // escolha que ninguém quer ter de fazer. Travado, o caminho de volta
      // é destravar, que é uma decisão só.
      var travada = JOGO.Renderer.cameraTravada && JOGO.Renderer.cameraTravada();
      bt.cam.classList.toggle('is-off', travada || !JOGO.Renderer.cameraManual());
    }

    paintBattle(false);
    paintTimer();
  };

  /* Repinta o que está na tela AGORA.
   *
   * A arte 3D (retratos e bonecos de corpo inteiro) decodifica em segundo plano.
   * Quem pintou antes dela ficar pronta recebeu o desenho 2D de emergência — e
   * ficava com ele para sempre, porque a tela só se redesenha quando o jogador
   * sai e volta. É a causa da queixa "os cards estão em 2D": não era o desenho
   * errado, era o desenho CERTO chegando tarde demais para ser usado. */
  UI.repaint = function () {
    var eraNome = sheetName, eraArg = lastSheetArg;
    try { if (current && screens[current]) UI.showScreen(current); } catch (e) {}
    if (eraNome && eraNome !== 'confirm') {
      try { openSheet(eraNome, eraArg); } catch (e2) {}
    }
  };

  // acesso para testes/galeria
  UI.screens = screens;
  UI.selection = function (ids) {
    if (ids) selHeroes = ids.slice(0, 2);
    return selHeroes.slice();
  };
  UI.toast = toast;
  UI.version = '2.2';
})();
