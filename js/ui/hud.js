var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// JOGO.UI — toda a interface DOM (telas + HUD de batalha). Dono: Designer.
//   UI.init(); UI.update(dt); UI.showScreen(name, data); UI.handleEvent(ev)
// Telas: menu | heroSelect | dungeonSelect | battle | roomClear | defeat |
//        dungeonComplete
// Tudo chama JOGO.Game.* defensivamente. Texto em pt-BR. Sem alert().
// ============================================================================

(function () {
  var UI = {};

  var root = null;
  var els = {};             // referencias de tela
  var currentScreen = null;
  var uiT = 0;              // tempo p/ animar retratos
  var selHeroes = [];       // ids escolhidos na selecao
  var logLines = [];
  var battleSig = '';
  var portraitCanvases = []; // canvases animados da tela atual
  var tooltipEl = null;

  var ROLES = {
    'hero-toll': 'Tanque', 'hero-wick': 'Assassina', 'hero-morel': 'Invocadora',
    'hero-rose': 'Suporte', 'hero-whistle': 'Controle'
  };
  var ELEM_PT = {
    fire: 'Fogo', water: 'Água', earth: 'Terra', air: 'Ar',
    light: 'Luz', shadow: 'Sombra', neutral: 'Neutro'
  };
  var DIFF = ['Fácil', 'Média', 'Difícil'];
  var RAR_PT = { common: 'Comum', rare: 'Raro', epic: 'Épico' };
  var SLOT_PT = { weapon: 'Arma', armor: 'Armadura', trinket: 'Amuleto' };
  var SLOTS = ['weapon', 'armor', 'trinket'];
  // regra fixa do contrato: LUCK por tamanho do grupo
  var LUCK = { 1: 2.4, 2: 1.6, 3: 1.0 };

  function G() { return JOGO.Game || null; }
  function D() { return JOGO.DATA || null; }
  function S() { return JOGO.Sprites || null; }
  function P() { return JOGO.Progress || null; }   // pode NÃO existir (defensivo)

  function heroName(heroId) {
    var d = D(); if (!d) return heroId;
    for (var i = 0; i < d.heroes.length; i++) if (d.heroes[i].id === heroId) return d.heroes[i].name;
    return heroId;
  }
  function xpInfoOf(heroId) {
    var p = P();
    if (p && p.xpInfo) {
      try { var xi = p.xpInfo(heroId); if (xi) return xi; } catch (e) {}
    }
    return { level: 1, xp: 0, xpNext: null, pct: 0 };
  }
  function effStatsOf(hero) {
    var p = P();
    if (p && p.effectiveStats) {
      try { var st = p.effectiveStats(hero.id); if (st) return st; } catch (e) {}
    }
    return hero.stats;
  }
  function equippedOf(heroId) {
    var p = P();
    var eq = (p && p.state && p.state.equipped && p.state.equipped[heroId]) || {};
    return { weapon: eq.weapon || null, armor: eq.armor || null, trinket: eq.trinket || null };
  }
  function inventoryList() {
    var p = P();
    return (p && p.state && p.state.inventory) ? p.state.inventory.slice() : [];
  }
  function rarColor(rar) {
    var sp = S();
    if (sp && sp.rarityColor) return sp.rarityColor(rar);
    return rar === 'epic' ? '#ffd166' : rar === 'rare' ? '#54a8e8' : '#9a8264';
  }
  function itemBonusLines(item) {
    var out = [], b = item.bonuses || {};
    if (b.pa) out.push('+' + b.pa + ' PA');
    if (b.pm) out.push('+' + b.pm + ' PM');
    if (b.hp) out.push('+' + b.hp + ' PV');
    if (b.power) out.push('+' + b.power + ' de poder');
    if (b.initiative) out.push('+' + b.initiative + ' de iniciativa');
    if (b.resists) {
      for (var el2 in b.resists) out.push('+' + b.resists[el2] + '% resist. ' + (ELEM_PT[el2] || el2));
    }
    return out;
  }
  function makeItemIcon(itemId, size) {
    var sp = S();
    if (sp && sp.itemIcon) {
      var cv = sp.itemIcon(itemId, size);
      if (cv) { cv.className = 'item-icon-canvas'; return cv; }
    }
    var c = document.createElement('canvas');
    c.width = c.height = size;
    c.style.width = c.style.height = size + 'px';
    return c;
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function elemColor(e) {
    var sp = S();
    return (sp && sp.elements && sp.elements[e]) || '#d8d0c0';
  }

  // B1: navegação pré-batalha avisa o Game (Game.goTo chama UI.showScreen de
  // volta; showScreen é idempotente). Fallback direto para páginas de teste.
  function navTo(name) {
    var g = G();
    if (g && typeof g.goTo === 'function') g.goTo(name);
    if (currentScreen !== name) UI.showScreen(name);
  }

  function makePortrait(defId, size, animate) {
    var c = document.createElement('canvas');
    c.width = size * 2; c.height = size * 2;
    c.style.width = size + 'px'; c.style.height = size + 'px';
    c.className = 'portrait-canvas';
    var g = c.getContext('2d');
    function paint(t) {
      g.save(); g.scale(2, 2);
      if (S() && S().portrait) S().portrait(g, defId, size, { t: t });
      g.restore();
    }
    paint(0);
    if (animate) portraitCanvases.push({ paint: paint, defId: defId });
    return c;
  }
  function makeSpellIcon(spell, size) {
    var c = document.createElement('canvas');
    c.width = size * 2; c.height = size * 2;
    c.style.width = size + 'px'; c.style.height = size + 'px';
    var g = c.getContext('2d');
    g.save(); g.scale(2, 2);
    if (S() && S().spellIcon) S().spellIcon(g, spell, size);
    g.restore();
    return c;
  }

  // ---------------------------------------------------------------- init
  UI.init = function () {
    root = document.getElementById('ui-root');
    if (!root) return;
    root.innerHTML = '';
    buildMenu();
    buildHeroSelect();
    buildDungeonSelect();
    buildBattleHud();
    buildBanners();
    buildEquipPanel();
    tooltipEl = el('div', 'spell-tooltip hidden');
    root.appendChild(tooltipEl);
    UI.showScreen('menu');
  };

  // ---------------------------------------------------------------- telas
  function buildMenu() {
    var d = D();
    var scr = el('div', 'screen screen-menu hidden');
    scr.appendChild(el('div', 'menu-halo'));
    var box = el('div', 'menu-box');
    box.appendChild(el('div', 'menu-epigraph', 'Há mil anos, o céu virou pedra.'));
    box.appendChild(el('h1', 'game-title', esc((d && d.gameTitle) || 'SOTERRA')));
    box.appendChild(el('div', 'game-subtitle', esc((d && d.gameSubtitle) || '')));
    var btn = el('button', 'btn btn-primary btn-big', 'Descer ao Fecho');
    btn.addEventListener('click', function () { navTo('heroSelect'); });
    box.appendChild(btn);
    box.appendChild(el('div', 'menu-hint', 'Escolha de 1 a 3 heróis · atravesse 3 salas · retome o Coração'));
    scr.appendChild(box);
    root.appendChild(scr);
    els.menu = scr;
  }

  function buildHeroSelect() {
    var scr = el('div', 'screen screen-select hidden');
    scr.appendChild(el('h2', 'select-title', 'A Descida'));
    scr.appendChild(el('div', 'select-sub',
      'Escolha de <b>1 a 3</b> heróis dos povos soterrados — descer com menos é arriscado, mas os Fechos recompensam a imprudência'));
    var row = el('div', 'hero-cards');
    scr.appendChild(row);

    // ---- indicador de SORTE DE SAQUE (muda ao vivo com a contagem)
    var luck = el('div', 'luck-panel');
    luck.appendChild(el('div', 'luck-title', '☘ Sorte de Saque'));
    var meter = el('div', 'luck-meter');
    var fill = el('div', 'luck-fill');
    meter.appendChild(fill);
    luck.appendChild(meter);
    var stars = el('div', 'luck-stars', '');
    luck.appendChild(stars);
    var ltext = el('div', 'luck-text', '');
    luck.appendChild(ltext);
    scr.appendChild(luck);

    var footer = el('div', 'select-footer');
    var back = el('button', 'btn btn-ghost', 'Voltar');
    back.addEventListener('click', function () { navTo('menu'); });
    var count = el('span', 'select-count', '0 / 3 escolhidos');
    var confirm = el('button', 'btn btn-primary', 'Confirmar Descida');
    confirm.disabled = true;
    confirm.addEventListener('click', function () {
      if (selHeroes.length >= 1 && selHeroes.length <= 3) navTo('dungeonSelect');
    });
    footer.appendChild(back); footer.appendChild(count); footer.appendChild(confirm);
    scr.appendChild(footer);
    root.appendChild(scr);
    els.heroSelect = scr;
    els.heroRow = row;
    els.heroCount = count;
    els.heroConfirm = confirm;
    els.luckFill = fill;
    els.luckStars = stars;
    els.luckText = ltext;
    updateLuck();
  }

  // sorte por tamanho do grupo: peso raro ×LUCK, épico ×LUCK²
  function updateLuck() {
    if (!els.luckFill) return;
    var n = selHeroes.length;
    var lk = LUCK[n] || 1.0;
    var pct = n === 0 ? 0 : Math.round(((lk - 1.0) / 1.4) * 92 + 8);
    els.luckFill.style.width = pct + '%';
    els.luckFill.className = 'luck-fill' + (n === 1 ? ' hot' : n === 2 ? ' warm' : '');
    var starHtml = '';
    for (var s = 0; s < 3; s++) {
      var on = n > 0 && s < (4 - Math.max(n, 1));
      starHtml += '<span class="luck-star' + (on ? ' on' : '') + '">★</span>';
    }
    els.luckStars.innerHTML = starHtml;
    var txt;
    if (n === 0) txt = 'Escolha ao menos 1 herói para descer.';
    else if (n === 3) txt = 'Descida completa — sorte padrão. Itens raros ×1,0 · épicos ×1,0.';
    else if (n === 2) txt = 'Em dupla, os Fechos pagam melhor: raros ×1,6 · épicos ×2,6.';
    else txt = '<b>Sozinho: chance muito maior de itens raros</b> — raros ×2,4 · épicos ×5,8. E ninguém para te carregar de volta.';
    els.luckText.innerHTML = txt;
  }

  function fillHeroCards() {
    var d = D(); if (!d || !els.heroRow) return;
    els.heroRow.innerHTML = '';
    portraitCanvases = portraitCanvases.filter(function (p) { return false; });
    d.heroes.forEach(function (h) {
      var race = null;
      d.races.forEach(function (r) { if (r.id === h.raceId) race = r; });
      var card = el('div', 'hero-card');
      card.style.setProperty('--race-c', race ? race.palette.primary : '#888');
      card.style.setProperty('--race-a', race ? race.palette.accent : '#ddd');
      var port = el('div', 'hero-portrait');
      port.appendChild(makePortrait(h.id, 108, true));
      card.appendChild(port);
      card.appendChild(el('div', 'hero-name', esc(h.name)));
      card.appendChild(el('div', 'hero-title', esc(h.title)));
      var meta = el('div', 'hero-meta');
      meta.appendChild(el('span', 'hero-race', esc(race ? race.name : h.raceId)));
      meta.appendChild(el('span', 'hero-role', esc(ROLES[h.id] || '')));
      card.appendChild(meta);

      // nível + barra de XP (JOGO.Progress; defensivo se não existir)
      var xi = xpInfoOf(h.id);
      var lvlRow = el('div', 'hero-level');
      lvlRow.appendChild(el('span', 'lvl-badge', 'Nv ' + xi.level));
      var xpbar = el('div', 'xp-bar');
      var xpfill = el('div', 'xp-fill');
      xpfill.style.width = Math.round((xi.pct || 0) * 100) + '%';
      xpbar.appendChild(xpfill);
      xpbar.title = xi.xpNext != null
        ? 'XP: ' + xi.xp + ' / ' + xi.xpNext
        : 'Nível máximo';
      lvlRow.appendChild(xpbar);
      card.appendChild(lvlRow);

      var est = effStatsOf(h);
      var boosted = est.hp !== h.stats.hp || est.power !== h.stats.power ||
        est.pa !== h.stats.pa || est.pm !== h.stats.pm || est.initiative !== h.stats.initiative;
      var stats = el('div', 'hero-stats' + (boosted ? ' boosted' : ''),
        '<span title="Vida">❤ ' + est.hp + '</span>' +
        '<span title="Iniciativa">⚡ ' + est.initiative + '</span>' +
        '<span title="PA / PM">' + est.pa + ' PA · ' + est.pm + ' PM</span>');
      card.appendChild(stats);
      var trait = race ? race.trait : '';
      var tshort = trait.split('—')[0].trim();
      var tdesc = trait.indexOf('—') >= 0 ? trait.slice(trait.indexOf('—') + 1).trim() : '';
      var traitEl = el('div', 'hero-trait', '<b>' + esc(tshort) + '</b>' + (tdesc ? ' — ' + esc(tdesc) : ''));
      card.appendChild(traitEl);
      var spells = el('div', 'hero-spells');
      h.spells.forEach(function (sid) {
        var sp = d.spells[sid]; if (!sp) return;
        var chip = el('span', 'spell-chip', esc(sp.name));
        chip.style.setProperty('--el-c', elemColor(sp.element));
        chip.addEventListener('mouseenter', function (e) { showSpellTooltip(sp, chip); });
        chip.addEventListener('mouseleave', hideTooltip);
        spells.appendChild(chip);
      });
      card.appendChild(spells);

      // botão de EQUIPAMENTO (não seleciona o card)
      var eqBtn = el('button', 'btn btn-equip', '⚒ Equipamento');
      eqBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openEquipPanel(h.id);
      });
      card.appendChild(eqBtn);

      card.addEventListener('click', function (e) {
        if (e.target && e.target.classList.contains('spell-chip')) return;
        var idx = selHeroes.indexOf(h.id);
        if (idx >= 0) selHeroes.splice(idx, 1);
        else if (selHeroes.length < 3) selHeroes.push(h.id);
        card.classList.toggle('selected', selHeroes.indexOf(h.id) >= 0);
        els.heroCount.textContent = selHeroes.length + ' / 3 escolhidos';
        els.heroConfirm.disabled = selHeroes.length < 1 || selHeroes.length > 3;
        els.heroRow.querySelectorAll('.hero-card').forEach(function (cc) {
          cc.classList.toggle('locked', selHeroes.length >= 3 && !cc.classList.contains('selected'));
        });
        updateLuck();
      });
      els.heroRow.appendChild(card);
    });
  }

  function buildDungeonSelect() {
    var scr = el('div', 'screen screen-select hidden');
    scr.appendChild(el('h2', 'select-title', 'Os Fechos Doentes'));
    scr.appendChild(el('div', 'select-sub', 'Três Corações fraquejam. Escolha qual salvar primeiro.'));
    var row = el('div', 'dungeon-cards');
    scr.appendChild(row);
    var footer = el('div', 'select-footer');
    var back = el('button', 'btn btn-ghost', 'Voltar');
    back.addEventListener('click', function () { navTo('heroSelect'); });
    footer.appendChild(back);
    scr.appendChild(footer);
    root.appendChild(scr);
    els.dungeonSelect = scr;
    els.dungeonRow = row;
  }

  function fillDungeonCards() {
    var d = D(); if (!d || !els.dungeonRow) return;
    els.dungeonRow.innerHTML = '';
    d.dungeons.forEach(function (dg, di) {
      var card = el('div', 'dungeon-card theme-' + dg.theme);
      card.style.setProperty('--dg-p', dg.palette.primary);
      card.style.setProperty('--dg-s', dg.palette.secondary);
      card.style.setProperty('--dg-a', dg.palette.accent);
      // chefe da ultima sala
      var bossName = '';
      var lastRoom = dg.rooms[dg.rooms.length - 1];
      Object.keys(lastRoom.monsters || {}).forEach(function (k) {
        var m = d.monsters[lastRoom.monsters[k]];
        if (m && m.boss) bossName = m.name;
      });
      var banner = el('div', 'dungeon-banner');
      var bc = document.createElement('canvas');
      bc.width = 480; bc.height = 200;
      drawDungeonBanner(bc, dg);
      banner.appendChild(bc);
      card.appendChild(banner);
      card.appendChild(el('div', 'dungeon-name', esc(dg.name)));
      var diffEl = el('div', 'dungeon-diff');
      for (var s = 0; s < 3; s++) {
        diffEl.appendChild(el('span', 'diff-pip' + (s <= di ? ' on' : '')));
      }
      diffEl.appendChild(el('span', 'diff-label', DIFF[di] || ''));
      card.appendChild(diffEl);
      card.appendChild(el('div', 'dungeon-desc', esc(dg.description)));
      card.appendChild(el('div', 'dungeon-boss', 'Guardião: <b>' + esc(bossName) + '</b>'));
      var btn = el('button', 'btn btn-primary btn-block', 'Descer');
      btn.addEventListener('click', function () {
        var g = G();
        if (g && g.startRun) g.startRun(selHeroes.slice(), dg.id);
        else UI.showScreen('battle'); // paginas de teste
      });
      card.appendChild(btn);
      els.dungeonRow.appendChild(card);
    });
  }

  // cartaz procedural do calabouco
  function drawDungeonBanner(c, dg) {
    var g = c.getContext('2d');
    var w = c.width, h = c.height;
    var grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, dg.palette.secondary);
    grd.addColorStop(1, '#0a0a0c');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    // brilho de baixo
    var rg = g.createRadialGradient(w / 2, h * 1.1, 10, w / 2, h * 1.1, h);
    rg.addColorStop(0, dg.palette.accent + 'aa'); rg.addColorStop(1, dg.palette.accent + '00');
    g.fillStyle = rg; g.fillRect(0, 0, w, h);
    var i;
    if (dg.theme === 'garden' || dg.theme === 'greenhouse') {
      // silhuetas de vinhas
      g.strokeStyle = 'rgba(20,30,14,0.9)'; g.lineWidth = 7; g.lineCap = 'round';
      for (i = 0; i < 6; i++) {
        g.beginPath(); g.moveTo(i * w / 5 - 20, h);
        g.quadraticCurveTo(i * w / 5 + 40, h * 0.5, i * w / 5 + (i % 2 ? 80 : -10), 8);
        g.stroke();
      }
      for (i = 0; i < 14; i++) {
        g.fillStyle = 'rgba(255,215,107,' + (0.35 + (i % 5) * 0.1) + ')';
        g.beginPath(); g.arc((i * 97) % w, (i * 53) % (h - 20) + 8, 2.4, 0, Math.PI * 2); g.fill();
      }
    } else if (dg.theme === 'cistern') {
      // colunas refletidas
      g.fillStyle = 'rgba(6,12,18,0.9)';
      for (i = 0; i < 5; i++) {
        var cx = 30 + i * (w - 60) / 4;
        g.fillRect(cx - 12, 0, 24, h * 0.62);
      }
      g.fillStyle = 'rgba(126,240,212,0.14)';
      g.fillRect(0, h * 0.62, w, h * 0.38);
      for (i = 0; i < 5; i++) {
        var cx2 = 30 + i * (w - 60) / 4;
        g.fillStyle = 'rgba(6,12,18,0.4)';
        g.fillRect(cx2 - 12, h * 0.62, 24, h * 0.3);
      }
      g.strokeStyle = 'rgba(126,240,212,0.35)'; g.lineWidth = 1.4;
      for (i = 0; i < 3; i++) {
        g.beginPath(); g.ellipse(w * (0.25 + i * 0.25), h * 0.7 + i * 8, 30 + i * 14, 5, 0, 0, Math.PI * 2); g.stroke();
      }
    } else {
      // portao de ferro com grelha em brasa
      g.fillStyle = 'rgba(10,5,3,0.92)';
      g.fillRect(w * 0.18, 0, w * 0.64, h);
      g.fillStyle = 'rgba(255,140,60,0.85)';
      for (i = 0; i < 4; i++) g.fillRect(w * 0.24 + i * w * 0.14, h * 0.2, 8, h * 0.7);
      g.fillStyle = 'rgba(20,10,6,0.95)';
      for (i = 0; i < 3; i++) g.fillRect(w * 0.18, h * (0.25 + i * 0.22), w * 0.64, 12);
      for (i = 0; i < 16; i++) {
        g.fillStyle = 'rgba(255,179,71,' + (0.3 + (i % 4) * 0.15) + ')';
        g.beginPath(); g.arc((i * 137) % w, h - (i * 41) % h, 1.8, 0, Math.PI * 2); g.fill();
      }
    }
    // vinheta
    var vg = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
  }

  // ---------------------------------------------------------------- batalha
  function buildBattleHud() {
    var hud = el('div', 'battle-hud hidden');

    // timeline de iniciativa (topo)
    var tl = el('div', 'timeline');
    hud.appendChild(tl);
    els.timeline = tl;

    // log de combate (esquerda)
    var log = el('div', 'combat-log');
    hud.appendChild(log);
    els.log = log;

    // barra inferior
    var bottom = el('div', 'bottom-bar');
    var panel = el('div', 'active-panel');
    bottom.appendChild(panel);
    els.activePanel = panel;
    var spellbar = el('div', 'spell-bar');
    bottom.appendChild(spellbar);
    els.spellbar = spellbar;
    var right = el('div', 'turn-panel');
    var roundEl = el('div', 'round-label', 'Rodada 1');
    var endBtn = el('button', 'btn btn-endturn', 'Encerrar Turno');
    endBtn.addEventListener('click', function () {
      var g = G(); if (g && g.endTurn) g.endTurn();
    });
    right.appendChild(roundEl); right.appendChild(endBtn);
    bottom.appendChild(right);
    els.roundLabel = roundEl;
    els.endBtn = endBtn;
    hud.appendChild(bottom);

    root.appendChild(hud);
    els.battle = hud;
  }

  function battleSignature(st, g) {
    if (!st) return 'none';
    var s = st.round + '|' + st.activeIdx + '|' + (g ? g.selectedSpellId : '') + '|' + st.phase;
    for (var i = 0; i < st.units.length; i++) {
      var u = st.units[i];
      s += '|' + u.uid + ':' + u.hp + ':' + (u.shield | 0) + ':' + (u.alive ? 1 : 0) + ':' + u.pa + ':' + u.pm;
      if (u.cooldowns) { for (var k in u.cooldowns) s += k + u.cooldowns[k]; }
    }
    return s;
  }

  function refreshBattle(st) {
    var g = G(), d = D();
    if (!st || !d) return;
    var en = JOGO.Engine;
    var active = null;
    if (en && en.activeUnit) { try { active = en.activeUnit(st); } catch (e) { active = null; } }
    if (!active && st.units && st.order && st.order.length) {
      var auid = st.order[st.activeIdx % st.order.length];
      st.units.forEach(function (u) { if (u.uid === auid) active = u; });
    }

    // ---- timeline
    els.timeline.innerHTML = '';
    if (st.order) {
      var n = st.order.length;
      for (var i = 0; i < n; i++) {
        var uid = st.order[(st.activeIdx + i) % n];
        var u = null;
        st.units.forEach(function (x) { if (x.uid === uid) u = x; });
        if (!u || !u.alive) continue;
        var slot = el('div', 'tl-slot ' + (u.side === 'player' ? 'ally' : 'enemy') + (i === 0 ? ' active' : ''));
        slot.appendChild(makePortrait(u.defId, i === 0 ? 44 : 34, false));
        var hpbar = el('div', 'tl-hp');
        var fill = el('div', 'tl-hp-fill');
        fill.style.width = Math.max(0, Math.round(u.hp / u.hpMax * 100)) + '%';
        hpbar.appendChild(fill);
        slot.appendChild(hpbar);
        slot.title = u.name + ' — ' + u.hp + '/' + u.hpMax + ' PV';
        els.timeline.appendChild(slot);
      }
    }

    // ---- painel do ativo
    els.activePanel.innerHTML = '';
    if (active) {
      var ap = els.activePanel;
      var pwrap = el('div', 'ap-portrait');
      pwrap.appendChild(makePortrait(active.defId, 64, false));
      // nível do herói no retrato do ativo (Adendo v2)
      if (active.kind === 'hero' && P()) {
        pwrap.appendChild(el('span', 'ap-level', 'Nv ' + xpInfoOf(active.defId).level));
      }
      ap.appendChild(pwrap);
      var info = el('div', 'ap-info');
      info.appendChild(el('div', 'ap-name', esc(active.name)));
      var hpk = Math.max(0, active.hp / active.hpMax);
      var hpbar2 = el('div', 'ap-hpbar');
      var hf = el('div', 'ap-hp-fill');
      hf.style.width = Math.round(hpk * 100) + '%';
      hf.className += hpk > 0.5 ? '' : (hpk > 0.25 ? ' warn' : ' danger');
      hpbar2.appendChild(hf);
      if (active.shield > 0) {
        var sf = el('div', 'ap-shield-fill');
        sf.style.width = Math.min(100, Math.round(active.shield / active.hpMax * 100)) + '%';
        hpbar2.appendChild(sf);
      }
      hpbar2.appendChild(el('span', 'ap-hp-text', active.hp + ' / ' + active.hpMax + (active.shield ? ' +' + active.shield : '')));
      info.appendChild(hpbar2);
      var pips = el('div', 'ap-pips');
      var paBox = el('span', 'pip-group pa', '<label>PA</label>');
      for (var p2 = 0; p2 < active.paMax; p2++) paBox.appendChild(el('i', 'pip pa' + (p2 < active.pa ? ' on' : '')));
      var pmBox = el('span', 'pip-group pm', '<label>PM</label>');
      for (var p3 = 0; p3 < active.pmMax; p3++) pmBox.appendChild(el('i', 'pip pm' + (p3 < active.pm ? ' on' : '')));
      pips.appendChild(paBox); pips.appendChild(pmBox);
      info.appendChild(pips);
      ap.appendChild(info);
    }

    // ---- barra de feiticos
    els.spellbar.innerHTML = '';
    var isPlayer = active && active.side === 'player' && st.phase === 'playing';
    if (isPlayer && active.spells) {
      active.spells.forEach(function (sid) {
        var sp = d.spells[sid]; if (!sp) return;
        var cd = (active.cooldowns && active.cooldowns[sid]) || 0;
        var casts = (active.castsThisTurn && active.castsThisTurn[sid]) || 0;
        var noCasts = sp.castsPerTurn > 0 && casts >= sp.castsPerTurn;
        var disabled = cd > 0 || active.pa < sp.paCost || noCasts;
        var slot = el('button', 'spell-slot' + (disabled ? ' disabled' : '') +
          (g && g.selectedSpellId === sid ? ' selected' : ''));
        slot.style.setProperty('--el-c', elemColor(sp.element));
        slot.appendChild(makeSpellIcon(sp, 46));
        slot.appendChild(el('span', 'spell-cost', sp.paCost));
        if (cd > 0) slot.appendChild(el('span', 'spell-cd', cd));
        else if (noCasts) slot.appendChild(el('span', 'spell-cd used', '✕'));
        slot.addEventListener('click', function () {
          var gg = G(); if (gg && gg.selectSpell && !disabled) gg.selectSpell(sid);
        });
        slot.addEventListener('mouseenter', function () { showSpellTooltip(sp, slot, active); });
        slot.addEventListener('mouseleave', hideTooltip);
        els.spellbar.appendChild(slot);
      });
    }

    // ---- rodada e botao
    els.roundLabel.textContent = 'Rodada ' + (st.round || 1);
    var canEnd = isPlayer;
    els.endBtn.disabled = !canEnd;
  }

  // ---------------------------------------------------------------- tooltip
  function effectSummary(sp) {
    var out = [];
    (sp.effects || []).forEach(function (ef) {
      switch (ef.type) {
        case 'damage': out.push(ef.min + '–' + ef.max + ' de dano (' + (ELEM_PT[ef.element] || ef.element) + ')' + (ef.lifesteal ? ' com roubo de vida' : '')); break;
        case 'heal': out.push('cura ' + ef.min + '–' + ef.max); break;
        case 'shield': out.push('escudo de ' + ef.value + ' por ' + ef.duration + ' turno(s)'); break;
        case 'buff': out.push((ef.value > 0 ? '+' : '') + ef.value + ' ' + (ef.stat === 'power' ? 'poder' : ef.stat.toUpperCase()) + ' por ' + ef.duration + ' turno(s)'); break;
        case 'resist': out.push((ef.value > 0 ? '+' : '') + ef.value + '% resist. ' + (ELEM_PT[ef.element] || ef.element)); break;
        case 'push': out.push('empurra ' + ef.tiles + ' célula(s)'); break;
        case 'pull': out.push('puxa ' + ef.tiles + ' célula(s)'); break;
        case 'teleport': out.push('teleporta o conjurador'); break;
        case 'swap': out.push('troca de lugar com o alvo'); break;
        case 'poison': out.push('veneno ' + ef.min + '–' + ef.max + ' por ' + ef.duration + ' turno(s)'); break;
        case 'regen': out.push('regenera ' + ef.min + '–' + ef.max + ' por ' + ef.duration + ' turno(s)'); break;
        case 'summon': out.push('invoca uma criatura'); break;
        case 'taunt': out.push('provoca por ' + ef.duration + ' turno(s)'); break;
        case 'invisible': out.push('invisível por ' + ef.duration + ' turno(s)'); break;
      }
    });
    return out;
  }

  function showSpellTooltip(sp, anchor, caster) {
    if (!tooltipEl) return;
    var rangeTxt = sp.range.min === sp.range.max ? String(sp.range.max) : sp.range.min + '–' + sp.range.max;
    if (sp.range.max === 0) rangeTxt = 'si mesmo';
    var aoeTxt = '';
    if (sp.aoe && sp.aoe.shape !== 'single') {
      var shapes = { cross: 'cruz', circle: 'círculo', line: 'linha' };
      aoeTxt = ' · área: ' + (shapes[sp.aoe.shape] || sp.aoe.shape) + ' ' + sp.aoe.size;
    }
    var html = '<div class="tt-head" style="--el-c:' + elemColor(sp.element) + '">' +
      '<b>' + esc(sp.name) + '</b><span class="tt-elem">' + esc(ELEM_PT[sp.element] || sp.element) + '</span></div>' +
      '<div class="tt-meta">' + sp.paCost + ' PA · alcance ' + rangeTxt + aoeTxt +
      (sp.range.line ? ' · em linha' : '') +
      (sp.cooldown > 0 ? ' · recarga ' + sp.cooldown : '') +
      (sp.castsPerTurn > 0 ? ' · ' + sp.castsPerTurn + '×/turno' : '') + '</div>';
    var effs = effectSummary(sp);
    if (effs.length) {
      html += '<ul class="tt-effects">';
      effs.forEach(function (t) { html += '<li>' + esc(t) + '</li>'; });
      html += '</ul>';
    }
    html += '<div class="tt-desc">' + esc(sp.description || '') + '</div>';
    tooltipEl.innerHTML = html;
    tooltipEl.classList.remove('hidden');
    var r = anchor.getBoundingClientRect();
    var tw = tooltipEl.offsetWidth, th = tooltipEl.offsetHeight;
    var x = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2));
    var y = r.top - th - 10;
    if (y < 8) y = r.bottom + 10;
    tooltipEl.style.left = x + 'px';
    tooltipEl.style.top = y + 'px';
  }
  function hideTooltip() {
    if (tooltipEl) tooltipEl.classList.add('hidden');
  }

  // ------------------------------------------------- tooltip de ITEM
  function showItemTooltip(item, anchor, equippedNow) {
    if (!tooltipEl || !item) return;
    var rc = rarColor(item.rarity);
    var html = '<div class="tt-head" style="--el-c:' + rc + '">' +
      '<b>' + esc(item.name) + '</b>' +
      '<span class="tt-elem">' + esc(RAR_PT[item.rarity] || item.rarity) + ' · ' +
      esc(SLOT_PT[item.slot] || item.slot) + '</span></div>';
    var lines = itemBonusLines(item);
    if (lines.length) {
      html += '<ul class="tt-effects">';
      lines.forEach(function (t) { html += '<li>' + esc(t) + '</li>'; });
      html += '</ul>';
    }
    if (item.flavor) html += '<div class="tt-desc">“' + esc(item.flavor) + '”</div>';
    html += '<div class="tt-meta" style="border:none;margin:5px 0 0;padding:0">' +
      (equippedNow ? 'Clique para desequipar' : 'Clique para equipar') + '</div>';
    tooltipEl.innerHTML = html;
    tooltipEl.classList.remove('hidden');
    var r = anchor.getBoundingClientRect();
    var tw = tooltipEl.offsetWidth, th = tooltipEl.offsetHeight;
    var x = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2));
    var y = r.top - th - 10;
    if (y < 8) y = r.bottom + 10;
    tooltipEl.style.left = x + 'px';
    tooltipEl.style.top = y + 'px';
  }

  // ------------------------------------------------- painel de EQUIPAMENTO
  var equipHeroId = null;
  function buildEquipPanel() {
    var wrap = el('div', 'equip-wrap hidden');
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) closeEquipPanel();
    });
    var panel = el('div', 'equip-panel');
    wrap.appendChild(panel);
    root.appendChild(wrap);
    els.equipWrap = wrap;
    els.equipPanel = panel;
  }
  function openEquipPanel(heroId) {
    equipHeroId = heroId;
    renderEquipPanel();
    if (els.equipWrap) els.equipWrap.classList.remove('hidden');
  }
  function closeEquipPanel() {
    equipHeroId = null;
    hideTooltip();
    if (els.equipWrap) els.equipWrap.classList.add('hidden');
    // reflete stats/nível novos nos cards da seleção
    if (currentScreen === 'heroSelect') { portraitCanvases = []; fillHeroCards(); syncSelectedCards(); }
  }
  UI.openEquip = openEquipPanel;   // interno do Designer (páginas de teste)

  function renderEquipPanel() {
    var panel = els.equipPanel, d = D();
    if (!panel || !d || !equipHeroId) return;
    var hero = null;
    d.heroes.forEach(function (h) { if (h.id === equipHeroId) hero = h; });
    if (!hero) return;
    panel.innerHTML = '';
    var p = P();
    var xi = xpInfoOf(hero.id);

    // cabeçalho
    var head = el('div', 'equip-head');
    var hp = el('div', 'equip-portrait');
    hp.appendChild(makePortrait(hero.id, 56, false));
    head.appendChild(hp);
    var ht = el('div', 'equip-headtext');
    ht.appendChild(el('div', 'equip-name', esc(hero.name) + ' <span class="lvl-badge">Nv ' + xi.level + '</span>'));
    var exbar = el('div', 'xp-bar big');
    var exfill = el('div', 'xp-fill');
    exfill.style.width = Math.round((xi.pct || 0) * 100) + '%';
    exbar.appendChild(exfill);
    exbar.title = xi.xpNext != null ? 'XP: ' + xi.xp + ' / ' + xi.xpNext : 'Nível máximo';
    ht.appendChild(exbar);
    head.appendChild(ht);
    var close = el('button', 'equip-close', '✕');
    close.addEventListener('click', closeEquipPanel);
    head.appendChild(close);
    panel.appendChild(head);

    if (!p) {
      panel.appendChild(el('div', 'equip-empty',
        'A progressão ainda dorme — nenhum espólio para equipar.'));
      return;
    }

    // stats efetivos
    var est = effStatsOf(hero);
    var statsRow = el('div', 'equip-stats',
      '<span>❤ ' + est.hp + '</span><span>' + est.pa + ' PA</span><span>' + est.pm + ' PM</span>' +
      '<span>✦ ' + est.power + ' poder</span><span>⚡ ' + est.initiative + '</span>');
    panel.appendChild(statsRow);

    // 3 slots
    var eq = equippedOf(hero.id);
    var slotsRow = el('div', 'equip-slots');
    SLOTS.forEach(function (slot) {
      var box = el('div', 'equip-slot');
      box.appendChild(el('div', 'slot-label', SLOT_PT[slot]));
      var itemId = eq[slot];
      if (itemId && d.items && d.items[itemId]) {
        var item = d.items[itemId];
        box.classList.add('filled', 'rar-' + item.rarity);
        var ic = el('div', 'slot-icon');
        ic.appendChild(makeItemIcon(itemId, 46));
        box.appendChild(ic);
        box.appendChild(el('div', 'slot-item-name', esc(item.name)));
        box.addEventListener('mouseenter', function () { showItemTooltip(item, box, true); });
        box.addEventListener('mouseleave', hideTooltip);
        box.addEventListener('click', function () {
          if (p.unequip) { try { p.unequip(hero.id, slot); } catch (e) {} }
          hideTooltip(); renderEquipPanel();
        });
      } else {
        box.classList.add('empty');
        box.appendChild(el('div', 'slot-icon empty-icon', '·'));
        box.appendChild(el('div', 'slot-item-name dim', 'vazio'));
      }
      slotsRow.appendChild(box);
    });
    panel.appendChild(slotsRow);

    // inventário em grade
    panel.appendChild(el('div', 'inv-title', 'Inventário'));
    var grid = el('div', 'inv-grid');
    var inv = inventoryList();
    if (!inv.length) {
      grid.appendChild(el('div', 'inv-empty', 'Nada saqueado ainda. Os Fechos aguardam.'));
    } else {
      inv.forEach(function (itemId, idx) {
        var item = d.items && d.items[itemId];
        if (!item) return;
        var cell = el('div', 'inv-cell rar-' + item.rarity);
        cell.appendChild(makeItemIcon(itemId, 44));
        cell.addEventListener('mouseenter', function () { showItemTooltip(item, cell, false); });
        cell.addEventListener('mouseleave', hideTooltip);
        cell.addEventListener('click', function () {
          if (p.equip) { try { p.equip(hero.id, itemId); } catch (e) {} }
          hideTooltip(); renderEquipPanel();
        });
        grid.appendChild(cell);
      });
    }
    panel.appendChild(grid);
  }

  // ---------------------------------------------------------------- banners
  function buildBanners() {
    var wrap = el('div', 'banner-wrap hidden');
    var box = el('div', 'banner-box');
    var title = el('div', 'banner-title', '');
    var sub = el('div', 'banner-sub', '');
    var btns = el('div', 'banner-btns');
    box.appendChild(title); box.appendChild(sub); box.appendChild(btns);
    wrap.appendChild(box);
    root.appendChild(wrap);
    els.banner = wrap;
    els.bannerTitle = title;
    els.bannerSub = sub;
    els.bannerBtns = btns;
  }

  function showBanner(kind, data) {
    var t = '', s = '', btns = [];
    var g = G();
    if (kind === 'roomClear') {
      t = 'Sala limpa!'; s = 'Os heróis recuperam metade do que perderam. O Coração está mais perto.';
      btns.push(['Avançar', 'btn btn-primary', function () { if (g && g.nextRoom) g.nextRoom(); }]);
    } else if (kind === 'defeat') {
      t = 'Derrota…'; s = 'A Descida falhou. A Grande Lousa desce mais um palmo.';
      btns.push(['Tentar de novo', 'btn btn-primary', function () { if (g && g.restart) g.restart(); }]);
    } else if (kind === 'dungeonComplete') {
      t = 'Fecho selado!'; s = 'O Coração volta a bater. Em algum lugar lá em cima, a pedra range — e recua.';
      btns.push(['Voltar à superfície', 'btn btn-primary', function () { if (g && g.restart) g.restart(); }]);
    }
    els.bannerTitle.textContent = t;
    els.bannerSub.textContent = s;
    els.banner.className = 'banner-wrap banner-' + kind;
    // recompensas: {xpGanho, levelUps, drops} (Adendo v2)
    var oldRw = els.banner.querySelector('.banner-rewards');
    if (oldRw) oldRw.parentNode.removeChild(oldRw);
    if ((kind === 'roomClear' || kind === 'dungeonComplete') && data &&
        (data.xpGanho != null || (data.levelUps && data.levelUps.length) || (data.drops && data.drops.length))) {
      var rw = buildRewards(data);
      els.bannerSub.parentNode.insertBefore(rw, els.bannerBtns);
    }
    els.bannerBtns.innerHTML = '';
    btns.forEach(function (b) {
      var bt = el('button', b[1], b[0]);
      bt.addEventListener('click', b[2]);
      els.bannerBtns.appendChild(bt);
    });
  }

  // bloco de recompensas: XP animando, level-ups em destaque, espólios
  function buildRewards(data) {
    var d = D();
    var rw = el('div', 'banner-rewards');

    if (data.xpGanho != null) {
      var xpRow = el('div', 'reward-xp');
      xpRow.appendChild(el('span', 'reward-xp-num', '+' + data.xpGanho + ' XP'));
      xpRow.appendChild(el('span', 'reward-xp-label', 'para cada herói da Descida'));
      rw.appendChild(xpRow);
      // mini-barras por herói (quando a progressão existe)
      var g = G(), p = P();
      var party = (g && g.party) || [];
      if (p && party.length) {
        var bars = el('div', 'reward-xpbars');
        party.forEach(function (hid, bi) {
          var xi = xpInfoOf(hid);
          var row = el('div', 'reward-xprow');
          row.appendChild(el('span', 'reward-xpname', esc(heroName(hid))));
          row.appendChild(el('span', 'lvl-badge', 'Nv ' + xi.level));
          var bar = el('div', 'xp-bar');
          var fillEl = el('div', 'xp-fill anim');
          fillEl.style.width = '0%';
          bar.appendChild(fillEl);
          row.appendChild(bar);
          bars.appendChild(row);
          // anima até o pct real (transição CSS)
          (function (fe, pct) {
            setTimeout(function () { fe.style.width = Math.round(pct * 100) + '%'; }, 80 + bi * 140);
          })(fillEl, xi.pct || 0);
        });
        rw.appendChild(bars);
      }
    }

    if (data.levelUps && data.levelUps.length) {
      var lu = el('div', 'reward-levelups');
      data.levelUps.forEach(function (l, li) {
        var line = el('div', 'levelup-line',
          '▲ <b>' + esc(heroName(l.heroId)) + '</b> alcançou o nível <b>' + l.novoNivel + '</b>!');
        line.style.animationDelay = (0.25 + li * 0.18) + 's';
        lu.appendChild(line);
      });
      rw.appendChild(lu);
    }

    if (data.drops && data.drops.length) {
      rw.appendChild(el('div', 'reward-drops-title', '— Espólios —'));
      var dr = el('div', 'reward-drops');
      data.drops.forEach(function (itemId, di2) {
        var item = d && d.items && d.items[itemId];
        if (!item) return;
        var cardEl = el('div', 'drop-card rar-' + item.rarity + (item.rarity === 'epic' ? ' drop-epic' : ''));
        cardEl.style.animationDelay = (0.35 + di2 * 0.22) + 's';
        if (item.rarity === 'epic') {
          var spark = el('div', 'epic-sparks');
          for (var sp2 = 0; sp2 < 8; sp2++) {
            var s3 = el('i');
            s3.style.setProperty('--sa', (sp2 / 8 * 360) + 'deg');
            s3.style.animationDelay = (sp2 * 0.16) + 's';
            spark.appendChild(s3);
          }
          cardEl.appendChild(spark);
        }
        var ic = el('div', 'drop-icon');
        ic.appendChild(makeItemIcon(itemId, 56));
        cardEl.appendChild(ic);
        cardEl.appendChild(el('div', 'drop-name', esc(item.name)));
        cardEl.appendChild(el('div', 'drop-rarity', esc(RAR_PT[item.rarity] || item.rarity)));
        cardEl.addEventListener('mouseenter', function () { showItemTooltip(item, cardEl, false); });
        cardEl.addEventListener('mouseleave', hideTooltip);
        dr.appendChild(cardEl);
      });
      rw.appendChild(dr);
    }
    return rw;
  }

  // ---------------------------------------------------------------- showScreen
  UI.showScreen = function (name, data) {
    currentScreen = name;
    hideTooltip();
    if (!root) return;
    var battleVisible = (name === 'battle' || name === 'roomClear' || name === 'defeat' || name === 'dungeonComplete');
    if (els.menu) els.menu.classList.toggle('hidden', name !== 'menu');
    if (els.heroSelect) {
      var showHS = name === 'heroSelect';
      els.heroSelect.classList.toggle('hidden', !showHS);
      if (showHS) { portraitCanvases = []; fillHeroCards(); syncSelectedCards(); }
    }
    if (els.dungeonSelect) {
      var showDS = name === 'dungeonSelect';
      els.dungeonSelect.classList.toggle('hidden', !showDS);
      if (showDS) fillDungeonCards();
    }
    if (els.battle) {
      els.battle.classList.toggle('hidden', !battleVisible);
      if (name === 'battle') { logLines = []; renderLog(); battleSig = ''; }
    }
    if (els.banner) {
      if (name === 'roomClear' || name === 'defeat' || name === 'dungeonComplete') showBanner(name, data);
      else els.banner.className = 'banner-wrap hidden';
    }
    if (els.equipWrap && name !== 'heroSelect') {
      els.equipWrap.classList.add('hidden');
      equipHeroId = null;
    }
  };
  function syncSelectedCards() {
    if (!els.heroRow) return;
    var cards = els.heroRow.querySelectorAll('.hero-card');
    var d = D(); if (!d) return;
    d.heroes.forEach(function (h, i) {
      if (cards[i]) cards[i].classList.toggle('selected', selHeroes.indexOf(h.id) >= 0);
    });
    els.heroCount.textContent = selHeroes.length + ' / 3 escolhidos';
    els.heroConfirm.disabled = selHeroes.length < 1 || selHeroes.length > 3;
    updateLuck();
  }

  // ---------------------------------------------------------------- eventos
  UI.handleEvent = function (ev) {
    if (!ev) return;
    switch (ev.type) {
      case 'log':
        logLines.push(ev.text);
        if (logLines.length > 40) logLines.shift();
        renderLog();
        break;
      case 'battleStart':
        battleSig = '';
        break;
      case 'battleEnd':
        battleSig = '';
        break;
    }
  };
  function renderLog() {
    if (!els.log) return;
    var html = '';
    var start = Math.max(0, logLines.length - 8);
    for (var i = start; i < logLines.length; i++) {
      var age = logLines.length - i;
      html += '<div class="log-line" style="opacity:' + (0.45 + 0.55 * (1 - (age - 1) / 8)) + '">' + esc(logLines[i]) + '</div>';
    }
    els.log.innerHTML = html;
    els.log.scrollTop = els.log.scrollHeight;
  }

  // ---------------------------------------------------------------- update
  UI.update = function (dt) {
    uiT += dt || 0.016;
    // anima retratos das telas de selecao (~30fps)
    if (currentScreen === 'heroSelect' && portraitCanvases.length) {
      for (var i = 0; i < portraitCanvases.length; i++) portraitCanvases[i].paint(uiT);
    }
    // HUD de batalha: reconstroi apenas quando o estado muda
    if (currentScreen === 'battle' || currentScreen === 'roomClear' ||
        currentScreen === 'defeat' || currentScreen === 'dungeonComplete') {
      var g = G();
      var st = g && g.state;
      var sig = battleSignature(st, g);
      if (sig !== battleSig) {
        battleSig = sig;
        if (st) refreshBattle(st);
      }
    }
  };

  JOGO.UI = UI;
})();
