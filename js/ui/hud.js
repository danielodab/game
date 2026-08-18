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
  var sheetEl = null, sheetName = null;
  var lastRewards = null;
  var invFilter = 'todos';
  var forgeSel = -1;
  var elemChoiceHero = null;

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
  function spellDef(id) { return (D().spells && D().spells[id]) || (D().fusionSpells && D().fusionSpells[id]) || null; }
  function itemDef(id) { return (D().items && D().items[id]) || null; }
  function setDef(id) { return (D().sets && D().sets[id]) || null; }
  function stoneDefs() { return D().stones || {}; }
  function petDef(id) { return (D().pets && D().pets[id]) || null; }
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
  function inventory() { return safe(function () { return P().state.inventory.slice(); }, []); }
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
  var SCREEN_NAMES = ['menu', 'heroSelect', 'dungeonSelect', 'elementChoice',
                      'battle', 'roomClear', 'dungeonComplete', 'defeat'];

  UI.init = function () {
    root = document.getElementById('ui-root');
    if (!root) {
      root = el('div');
      root.id = 'ui-root';
      document.body.appendChild(root);
    }
    clear(root);
    root.className = 'ui-root';

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

    document.addEventListener('click', function (ev) {
      if (tipOwner && tipEl && !tipEl.contains(ev.target) && !tipOwner.contains(ev.target)) hideTip();
    }, true);
    window.addEventListener('resize', function () { hideTip(); });

    UI.showScreen(safe(function () { return G().screen; }, 'menu'));
    return UI;
  };

  UI.showScreen = function (name, data) {
    if (!screens[name]) name = 'menu';
    hideTip();
    if (name !== 'battle') closeSheet();
    current = name;
    for (var k in screens) {
      if (screens.hasOwnProperty(k)) screens[k].classList.toggle('is-on', k === name);
    }
    root.classList.toggle('in-battle', name === 'battle');
    battleSig = '';
    if (name === 'menu') buildMenu();
    else if (name === 'heroSelect') buildHeroSelect();
    else if (name === 'dungeonSelect') buildDungeonSelect();
    else if (name === 'elementChoice') buildElementChoice(data);
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
    acts.appendChild(btn('Coleção', 'btn-ghost', function () { openSheet('collection'); }));
    acts.appendChild(btn('Inventário', 'btn-ghost', function () { openSheet('inventory'); }));
    acts.appendChild(btn('Forja', 'btn-ghost', function () { openSheet('forge'); }));
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
    s.appendChild(header('Quem desce', 'Escolha 1 ou 2 heróis. Sozinho, a sorte de saque é máxima.', 'menu'));

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
      navTo('dungeonSelect');
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
      var pick = btn(idx >= 0 ? 'Escolhido ' + (idx + 1) : 'Escolher', 'btn-mini ' + (idx >= 0 ? 'btn-primary' : ''), function () {
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
        info.appendChild(el('b', null, esc((d2 && d2.name) || sid)));
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
  function buildRewards(name, data) {
    var s = screens[name];
    clear(s);
    lastRewards = data || {};
    var fim = name === 'dungeonComplete';
    s.appendChild(header(fim ? 'Calabouço vencido' : 'Sala limpa',
      fim ? 'O fundo desta descida está seu.' : 'Respire. A próxima é pior.'));

    var body = el('div', 'ui-body');
    var box = el('div', 'rw-box');

    box.appendChild(rwBlock('Experiência', (function () {
      var w = el('div', 'rw-xp');
      // A HUD anunciava `xpGanho` — que `game.js` documenta como o valor ANTES
      // do corte do §9-D. Dava para o painel dizer "+4 XP" e o herói receber
      // ZERO. Aqui manda o valor REAL; quando houve corte, o número cheio
      // aparece riscado ao lado e uma linha explica o porquê. É esse feedback
      // que ensina o jogador a descer mais fundo em vez de moer o calabouço 1.
      var bruto = lastRewards.xpGanho || 0;
      var mult = lastRewards.xpMult == null ? 1 : lastRewards.xpMult;
      var real = lastRewards.xpPorHeroi == null ? Math.floor(bruto * mult) : lastRewards.xpPorHeroi;
      var cortou = mult < 0.999 && bruto > 0;

      var n = el('div', 'rw-xp-n' + (cortou ? ' is-cut' : ''), '+' + real + ' XP');
      if (cortou) {
        n.appendChild(el('span', 'rw-xp-was', '+' + bruto));
        n.appendChild(el('span', 'rw-xp-mult', '×' + mult.toFixed(2).replace('.', ',')));
      }
      w.appendChild(n);

      if (cortou) {
        var rec = null, ds2 = dungeons(), gi;
        var did = safe(function () { return G().dungeonId; }, null);
        for (gi = 0; gi < ds2.length; gi++) {
          if (ds2[gi].id === did && ds2[gi].recommendedLevel != null) rec = ds2[gi].recommendedLevel;
        }
        w.appendChild(el('div', 'rw-xp-why',
          'Conteúdo fácil demais para o seu nível' +
          (rec != null ? ' (recomendado: <b>' + rec + '</b>)' : '') +
          '. <b>Desça mais fundo</b> para a XP valer inteira.'));
      }
      (selHeroes.length ? selHeroes : heroIds()).forEach(function (hid) {
        var h = hero(hid); if (!h) return;
        var xi = xpInfo(hid);
        var r = el('div', 'rw-hero');
        r.appendChild(art('portrait', [h.classId || hid, { element: h.element, size: 40 }], 36));
        var t = el('div', 'rw-hero-t');
        t.appendChild(el('b', null, esc(className(h.classId || hid)) + ' — Nv ' + h.level));
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

    var cards = lastRewards.cards || [];
    if (cards.length) {
      box.appendChild(rwBlock('Cartas de personagem', (function () {
        var w = el('div', 'rw-cards');
        cards.forEach(function (c) {
          var cell = el('div', 'rw-card');
          cell.appendChild(art('cardIcon', [c.classId, 104, 146], 104));
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
    if (fim) foot.appendChild(btn('Voltar ao acampamento', 'btn-primary', function () { navTo('menu'); }));
    else foot.appendChild(btn('Próxima sala', 'btn-primary', function () {
      if (!safe(function () { return G().nextRoom(); }, false)) toast('Não deu para avançar.');
    }));
    s.appendChild(foot);
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
    var u = activeUnit();
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
    tipOn(ppw, 'Pontos de Passos', 'Cada célula andada gasta 1 PP. Sair de perto de um inimigo pode custar tudo.', '#7ef0d4');
    res.appendChild(ppw);
    info.appendChild(res);
    bt.active.appendChild(info);
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
      var d2 = spellDef(sid) || (u.spellDefs && u.spellDefs[sid]) || null;
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
      cell.appendChild(el('span', 'sp-name', esc((d2 && d2.name) || sid)));
      tap(cell, function () {
        if (cd > 0) { toast('Recarregando: ' + cd + (cd > 1 ? ' rodadas.' : ' rodada.')); return; }
        if (u.pa < cost) { toast('PA insuficiente (' + cost + ' necessários).'); return; }
        safe(function () { G().selectSpell(sid); }, null);
        battleSig = '';
        paintBattle(true);
      });
      // toque longo/segunda toque no nome abre a explicação
      var q = el('span', 'sp-info', 'i');
      tipOn(q, (d2 && d2.name) || sid, spellTipBody(d2, sid), d2 ? elemColor(d2.element) : '#ffd08a');
      cell.appendChild(q);
      bt.spells.appendChild(cell);
    });
  }

  function spellTipBody(d2, sid) {
    if (!d2) return 'Feitiço ' + esc(sid) + '.';
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
  function closeSheet() {
    if (!sheetEl) return;
    sheetEl.classList.remove('is-on');
    sheetName = null;
    hideTip();
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
    if (name === 'collection') sheetCollection(arg);
    else if (name === 'inventory') sheetInventory(arg);
    else if (name === 'forge') sheetForge(arg);
    else if (name === 'heroSheet') sheetHero(arg);
    else if (name === 'battleMenu') sheetBattleMenu();
    else closeSheet();
  }
  UI.openSheet = openSheet;
  UI.closeSheet = closeSheet;

  // -------------------------------------------------------------- COLEÇÃO
  // O cofre de recompensas: cartas por classe, custo, e a trilha de 5 estrelas
  // com o próximo bônus em destaque.
  function sheetCollection(focusId) {
    var body = sheetShell('Coleção',
      'Cartas caem dos chefes. Elas <b>liberam</b> a classe e, depois, viram <b>estrelas</b> permanentes.');
    var cfg = starsCfg();
    var legend = el('div', 'col-legend');
    for (var s = 1; s <= (cfg.max || 5); s++) {
      var bn = cfg.bonuses && (cfg.bonuses[s] || cfg.bonuses[String(s)]);
      legend.appendChild(el('span', 'chip', '★' + s + ' ' + esc(bonusText(bn))));
    }
    body.appendChild(legend);

    var ids = Object.keys(classes());
    ids.sort(function (a, b) { return cardInfo(a).unlockCost - cardInfo(b).unlockCost; });
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
        txt.appendChild(bar('bar-card', info.unlockCost ? info.cards / info.unlockCost : 0,
          info.cards + ' / ' + info.unlockCost + ' cartas'));
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

  function itemTipBody(itemId, level) {
    var it = itemDef(itemId);
    if (!it) return 'Item ' + esc(itemId) + '.';
    var lv = level == null ? safe(function () { return P().itemLevel(itemId); }, 0) : level;
    var mult = 1 + (upgradeCfg().bonusPerLevel || 0.12) * lv;
    var out = '<i>' + esc(SLOT_PT[slotOf(itemId)] || '') + ' · ' + esc(RAR_PT[it.rarity] || it.rarity) +
              (lv ? ' · <b>+' + lv + '</b> ' + esc(tierOf(lv)) : '') + '</i>';
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
      out += '<br>Concede: <b>' + esc((sp && sp.name) || it.grantsSpell) + '</b>';
    }
    if (it.setId) {
      var sd = setDef(it.setId);
      out += '<br>Conjunto: <b>' + esc((sd && sd.name) || it.setId) + '</b>';
    }
    if (it.description) out += '<br>' + esc(it.description);
    return out;
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

  // ------------------------------------------------------------ INVENTÁRIO
  // UM saco só para o grupo inteiro. Cada peça mostra raridade, nível +N, tier,
  // conjunto (com quantas peças estão equipadas) e QUEM está usando.
  function sheetInventory(preselect) {
    var body = sheetShell('Inventário',
      'Um saco só para todos os heróis. Uma peça equipada por um <b>não pode</b> estar em outro.');
    var inv = inventory();

    var tabs = el('div', 'inv-tabs');
    ['todos'].concat(SLOTS).forEach(function (f) {
      var b = btn(f === 'todos' ? 'Tudo' : SLOT_PT[f], 'btn-tab' + (invFilter === f ? ' is-on' : ''), function () {
        invFilter = f;
        sheetInventory(preselect);
      });
      tabs.appendChild(b);
    });
    body.appendChild(tabs);

    if (!inv.length) {
      body.appendChild(el('p', 'empty', 'Saco vazio. Os calabouços resolvem isso.'));
      return;
    }
    var grid = el('div', 'inv-grid');
    var shown = 0;
    inv.forEach(function (entry, idx) {
      var id = entry.itemId || entry;
      var lv = entry.level || 0;
      var it = itemDef(id);
      if (!it) return;
      var canon = slotOf(id);
      if (invFilter !== 'todos' && canon !== invFilter) return;
      shown++;
      var cell = el('div', 'inv-cell ' + tierClass(lv) + (preselect === id ? ' is-focus' : ''));
      markRarity(cell, it.rarity);

      var ic = el('div', 'inv-ic');
      ic.appendChild(art('itemIcon', [id, 54], 54));
      if (lv > 0) ic.appendChild(el('span', 'inv-lv', '+' + lv));
      var owner = equippedBy(id);
      if (owner) ic.appendChild(el('span', 'inv-worn', esc(className((hero(owner) || {}).classId || owner).slice(0, 3))));
      cell.appendChild(ic);

      var tx = el('div', 'inv-tx');
      tx.appendChild(el('b', null, esc(it.name)));
      tx.appendChild(el('span', 'inv-slot', esc(SLOT_PT[canon]) + ' · ' + esc(RAR_PT[it.rarity] || it.rarity) +
        (lv ? ' · ' + esc(tierOf(lv)) : '')));
      if (it.setId) {
        var n = setEquippedCount(it.setId), tot = setPieceCount(it.setId);
        var sd = setDef(it.setId);
        var sc = el('span', 'inv-set' + (n >= 2 ? ' is-live' : ''),
          esc((sd && sd.name) || it.setId) + ' <b>' + n + '/' + tot + '</b>');
        tipOn(sc, (sd && sd.name) || it.setId, setTipBody(it.setId), '#9fd8ff');
        tx.appendChild(sc);
      }
      if (owner) {
        tx.appendChild(el('span', 'inv-owner', 'em uso por <b>' +
          esc(className((hero(owner) || {}).classId || owner)) + '</b>'));
      }
      cell.appendChild(tx);

      var acts = el('div', 'inv-acts');
      var targets = heroIds().filter(function (hid) { return !!hero(hid); });
      targets.slice(0, 4).forEach(function (hid) {
        var h = hero(hid);
        var has = heroItem(h, canon) === id;
        acts.appendChild(btn(has ? 'Tirar' : className(h.classId || hid).split(' ')[0],
          'btn-mini' + (has ? ' btn-warn' : ''), function () {
            var ok;
            if (has) ok = safe(function () { return P().unequip(hid, slotRaw(canon)); }, false);
            else ok = safe(function () { return P().equip(hid, id); }, false);
            if (!ok) {
              var who = equippedBy(id);
              toast(who ? 'Já está com ' + className((hero(who) || {}).classId || who) + '.' : 'Não deu para equipar.');
            }
            sheetInventory(id);
          }));
      });
      var ui2 = safe(function () { return P().upgradeInfo(idx); }, null);
      if (ui2 && !ui2.maxed) {
        acts.appendChild(btn('Forjar', 'btn-mini btn-gold', function () { forgeSel = idx; openSheet('forge'); }));
      }
      cell.appendChild(acts);
      tipOn(ic, it.name, itemTipBody(id, lv), rarColor(it.rarity));
      grid.appendChild(cell);
    });
    if (!shown) grid.appendChild(el('p', 'empty', 'Nada nesse espaço ainda.'));
    body.appendChild(grid);
  }

  function setTipBody(setId) {
    var sd = setDef(setId);
    if (!sd) return 'Conjunto ' + esc(setId) + '.';
    var n = setEquippedCount(setId);
    var out = '<i>' + esc(ELEM_PT[sd.element] || sd.element || '') + ' · ' +
              setPieceCount(setId) + ' peças</i>';
    var b = sd.bonuses || {};
    ['2', '3', '4'].forEach(function (k) {
      if (!b[k]) return;
      out += '<br>' + (n >= +k ? '<b>' : '') + k + ' peças: ' + esc(bonusText(b[k])) + (n >= +k ? ' ✓</b>' : '');
    });
    if (sd.description) out += '<br>' + esc(sd.description);
    return out;
  }

  // ----------------------------------------------------------------- FORJA
  function sheetForge(preselect) {
    var body = sheetShell('Forja',
      'Melhorar é <b>determinístico</b>: nunca quebra, nunca regride. Consome pedras do elemento da peça.');

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

    var inv = inventory();
    if (!inv.length) { body.appendChild(el('p', 'empty', 'Nenhuma peça para forjar.')); return; }
    if (preselect != null) forgeSel = preselect;
    if (forgeSel < 0 || forgeSel >= inv.length) forgeSel = 0;

    var pick = el('div', 'forge-pick');
    inv.forEach(function (entry, i) {
      var id = entry.itemId || entry;
      var it = itemDef(id);
      if (!it) return;
      var lv = entry.level || 0;
      var c = el('button', 'forge-thumb ' + tierClass(lv) + (i === forgeSel ? ' is-on' : ''));
      c.type = 'button';
      c.appendChild(art('itemIcon', [id, 44], 44));
      if (lv) c.appendChild(el('span', 'inv-lv', '+' + lv));
      tap(c, function () { forgeSel = i; sheetForge(i); });
      pick.appendChild(c);
    });
    body.appendChild(pick);

    var entry = inv[forgeSel];
    var id2 = entry.itemId || entry;
    var it2 = itemDef(id2);
    var lv2 = entry.level || 0;
    var info = safe(function () { return P().upgradeInfo(forgeSel); }, null);

    var panel = el('div', 'forge-panel ' + tierClass(lv2));
    var head = el('div', 'forge-head');
    head.appendChild(art('itemIcon', [id2, 72], 72));
    var ht = el('div', 'forge-head-t');
    ht.appendChild(el('h3', null, esc((it2 && it2.name) || id2) + (lv2 ? ' <b>+' + lv2 + '</b>' : '')));
    ht.appendChild(el('span', 'forge-tier-nm', esc(tierOf(lv2)) + ' · ' + esc(SLOT_PT[slotOf(id2)] || '')));
    if (it2 && it2.element) {
      var ec = el('span', 'elem-badge e-' + it2.element, ELEM_PT[it2.element] || it2.element);
      ec.style.setProperty('--ec', elemColor(it2.element));
      ht.appendChild(ec);
    }
    head.appendChild(ht);
    panel.appendChild(head);

    // trilha 0..10 com os tiers marcados
    var maxLv = upgradeCfg().maxLevel || 10;
    var track = el('div', 'forge-track');
    for (var i3 = 0; i3 <= maxLv; i3++) {
      var stp = el('i', 'fg-step ' + tierClass(i3) + (i3 <= lv2 ? ' is-on' : '') + (i3 === lv2 + 1 ? ' is-next' : ''));
      track.appendChild(stp);
    }
    panel.appendChild(track);
    panel.appendChild(el('div', 'forge-legend',
      '+0–2 Comum · +3–5 Raro · +6–9 Supremo · <b>+10 Magnífico</b>'));

    // prévia do ganho
    var per = upgradeCfg().bonusPerLevel || 0.12;
    var prev = el('div', 'forge-prev');
    prev.appendChild(el('div', 'fp-col', '<i>agora</i>' + bonusPreview(it2, lv2, per)));
    prev.appendChild(el('div', 'fp-arrow', '→'));
    prev.appendChild(el('div', 'fp-col fp-next', '<i>+' + (lv2 + 1) + '</i>' + bonusPreview(it2, lv2 + 1, per)));
    if (lv2 < maxLv) panel.appendChild(prev);

    if (!info) {
      panel.appendChild(el('p', 'empty', 'A forja ainda não está disponível.'));
    } else if (info.maxed) {
      panel.appendChild(el('p', 'forge-max', 'No máximo: <b>Magnífico +' + maxLv + '</b>.'));
    } else {
      var sd2 = stoneDefs()[info.stoneId];
      var have = stoneCount(info.stoneId);
      var cost = el('div', 'forge-cost' + (info.temPedras ? '' : ' is-short'));
      cost.appendChild(art('stoneIcon', [info.stoneId, 38], 38));
      cost.appendChild(el('span', null, '<b>' + have + ' / ' + info.custo + '</b> ' +
        esc((sd2 && sd2.name) || info.stoneId)));
      panel.appendChild(cost);
      if (!info.temPedras) {
        panel.appendChild(el('p', 'forge-short',
          'Faltam <b>' + (info.custo - have) + '</b> de <b>' + esc((sd2 && sd2.name) || info.stoneId) +
          '</b>' + (sd2 ? ' (' + (ELEM_PT[sd2.element] || sd2.element) + ')' : '') +
          '. Monstros desse elemento derrubam.'));
      }
      var go = btn('Forjar para +' + (lv2 + 1), 'btn-primary btn-block' + (info.temPedras ? '' : ' is-off'), function () {
        var ok = safe(function () { return P().upgradeItem(forgeSel); }, false);
        if (ok) { toast('Forjado: +' + (lv2 + 1) + ' ' + tierOf(lv2 + 1) + '!', 'good'); sheetForge(forgeSel); }
        else toast('Pedras insuficientes.');
      });
      panel.appendChild(go);
    }
    body.appendChild(panel);
  }

  function bonusPreview(it, lv, per) {
    if (!it) return '—';
    var mult = 1 + per * lv;
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

    // ---- equipamento: 4 espaços + pet (adendo v2.2)
    body.appendChild(el('h3', 'hs-sec', 'Equipamento'));
    var slots = el('div', 'hs-slots');
    SLOTS.forEach(function (canon) {
      var itemId = heroItem(h, canon);
      var it = itemId ? itemDef(itemId) : null;
      var lv = itemId ? safe(function () { return P().itemLevel(itemId); }, 0) : 0;
      var cell = el('div', 'hs-slot' + (it ? ' has-item ' + tierClass(lv) : ' is-empty'));
      if (it) markRarity(cell, it.rarity);
      var ic = el('div', 'hs-slot-ic');
      ic.appendChild(it ? art('itemIcon', [itemId, 52], 52) : art('slotIcon', [canon, 52], 52));
      if (lv) ic.appendChild(el('span', 'inv-lv', '+' + lv));
      cell.appendChild(ic);
      cell.appendChild(el('span', 'hs-slot-nm', SLOT_PT[canon]));
      cell.appendChild(el('span', 'hs-slot-it', it ? esc(it.name) : 'vazio'));
      tipOn(ic, SLOT_PT[canon] + (it ? ' — ' + it.name : ''),
        it ? itemTipBody(itemId, lv) : esc(SLOT_HINT[canon]),
        it ? rarColor(it.rarity) : '#8b93a0');
      var act = btn(it ? 'Trocar' : 'Equipar', 'btn-mini', function () {
        closeSheet();
        invFilter = canon;
        openSheet('inventory', itemId);
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
      cell.appendChild(el('span', 'hs-slot-it', pd ? esc(pd.name) : 'nenhum'));
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

    // ---- feitiços
    body.appendChild(el('h3', 'hs-sec', 'Feitiços'));
    var sl = safe(function () { return P().spellsFor(heroId); }, h.spells || []);
    var sg = el('div', 'hs-spells');
    (sl || []).forEach(function (sid) {
      var d2 = spellDef(sid);
      var c = el('div', 'hs-spell');
      c.appendChild(art('spellIcon', [d2 || sid, 40], 40));
      c.appendChild(el('span', null, esc((d2 && d2.name) || sid)));
      tipOn(c, (d2 && d2.name) || sid, spellTipBody(d2, sid), d2 ? elemColor(d2.element) : '#ffd08a');
      sg.appendChild(c);
    });
    body.appendChild(sg);

    // ---- caminho ainda por abrir
    var def = classDef(cid) || {};
    if (h.element && h.element !== 'neutro' && def.paths && def.paths[h.element]) {
      var tiers = D().unlockTiers || [];
      var locked = def.paths[h.element].filter(function (sid, i) {
        var d3 = spellDef(sid);
        var need = (d3 && d3.unlockLevel) || tiers[i] || 99;
        return (h.level || 1) < need;
      });
      if (locked.length) {
        body.appendChild(el('h3', 'hs-sec', 'Ainda por abrir'));
        var lg = el('div', 'hs-spells is-locked');
        locked.forEach(function (sid) {
          var d3 = spellDef(sid);
          var i2 = def.paths[h.element].indexOf(sid);
          var need = (d3 && d3.unlockLevel) || tiers[i2] || '?';
          var c2 = el('div', 'hs-spell');
          c2.appendChild(art('spellIcon', [d3 || sid, 40], 40, 'silhouette'));
          c2.appendChild(el('span', null, esc((d3 && d3.name) || sid) + ' · Nv ' + need));
          lg.appendChild(c2);
        });
        body.appendChild(lg);
      }
    }
  }

  function petPicker(heroId) {
    var body = sheetShell('Chamar um bicho', 'Um bicho serve a um herói por vez.');
    var pets = ownedPets();
    var g = el('div', 'pet-grid');
    pets.forEach(function (pid) {
      var pd = petDef(pid);
      var c = el('button', 'pet-cell');
      c.type = 'button';
      c.appendChild(art('petIcon', [pid, 56], 56));
      c.appendChild(el('b', null, esc((pd && pd.name) || pid)));
      c.appendChild(el('span', null, esc(bonusText(pd && pd.bonuses))));
      tap(c, function () {
        safe(function () { P().equipPet(heroId, pid); }, null);
        sheetHero(heroId);
      });
      g.appendChild(c);
    });
    if (!pets.length) g.appendChild(el('p', 'empty', 'Nenhum bicho no saco.'));
    body.appendChild(g);
    body.appendChild(btn('Voltar', 'btn-ghost btn-block', function () { sheetHero(heroId); }));
  }

  function sheetBattleMenu() {
    var body = sheetShell('Pausa');
    var acts = el('div', 'menu-acts');
    acts.appendChild(btn('Inventário', 'btn-ghost', function () { openSheet('inventory'); }));
    acts.appendChild(btn('Coleção', 'btn-ghost', function () { openSheet('collection'); }));
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
    if (current !== 'battle') return;
    paintBattle(false);
    paintTimer();
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
