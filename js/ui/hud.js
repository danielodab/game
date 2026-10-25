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
  // os dados das telas que o UI.repaint precisa redesenhar iguais (10/09)
  var lastElementChoice, lastDuelFim;
  var invMainTab = 'equip';              // a aba principal do inventário
  var invFilter = 'todos';               // a sub-aba de espaço de equipamento
  /* filtros por ELEMENTO (pedido 25/08: "facilita a busca") — um por ficha,
   * porque cada uma guarda a própria busca entre redesenhos */
  var invElemFiltro = 'todos';
  var forjaElemFiltro = 'todos';
  var bancoElemFiltro = 'todos';
  var invBusca = '';               // busca por nome (25/08) — vive entre redesenhos
  var bancoBusca = '';
  /* 22/09 (os menus de item ganharam ícones): o filtro por ESPAÇO chegou à
   * forja, aos dois bancos e à troca; o banco da guilda e a troca ganharam
   * também o de elemento, e a guilda a busca. Um estado por ficha, como os
   * de cima — cada uma lembra a própria busca entre redesenhos. */
  var forjaSlotFiltro = 'todos';
  var bancoSlotFiltro = 'todos';
  var guildaSlotFiltro = 'todos', guildaElemFiltro = 'todos', guildaBusca = '';
  var trocaSlotFiltro = 'todos', trocaElemFiltro = 'todos';
  var elemChoiceHero = null;
  // ---- tela "Personagens" [U6]
  var partyTab = 'inventario';     // aba corrente: inventario | forja | colecao
  var partyHero = null;            // herói do carrossel (só classes liberadas)
  var invSel = null;               // peça escolhida na grade: {itemId, level, stars}
  var forgeTarget = null;          // alvo da forja: do saco ou vestido por alguém
  /* A QUEBRA (22/09, pedido do dono: "na forja o jogador poderá quebrar os
   * itens, que darão pedras daquele elemento"): a forja ganhou dois modos,
   * 'forjar' (o de sempre) e 'quebrar'. `forjaQuebraN` é quantas cópias
   * iguais a bancada quebra de uma vez — 1 ou 'todas'; `forjaQuebrando`
   * segura o botão enquanto a quebra está no servidor (o índice da peça
   * muda depois do golpe: um segundo toque quebraria a vizinha). */
  var forjaModo = 'forjar';
  var forjaQuebraN = 1;
  var forjaVarios = false, forjaMarcadas = {};     // 08/10 à noite: o modo quebrar várias e as pilhas marcadas (pela chave da pilha)
  function chaveDoAlvo(a) { return a.itemId + '|' + (a.level || 0) + '|' + (a.stars || 0) + '|' + (a.extra || ''); }
  var forjaQuebrando = false;

  var LUCK = { 1: 2.4, 2: 1.6 };
  var ELEM_PT = { neutro: tr('Neutro'), fogo: tr('Fogo'), agua: tr('Água'), terra: tr('Terra'), ar: 'Ar' };
  var RAR_PT = { comum: tr('Comum'), raro: tr('Raro'), epico: tr('Épico'), lendario: tr('Lendário') };
  var DIFF_PT = [tr('Fácil'), tr('Média'), tr('Difícil'), tr('Brutal'), tr('Cruel'), tr('Final')];
  var SLOTS = ['punho', 'passo', 'casca', 'lume'];
  var SLOT_PT = { punho: tr('Punho'), passo: tr('Passo'), casca: tr('Casca'), lume: tr('Lume') };
  var SLOT_HINT = {
    punho: tr('o que golpeia — dá PA'),
    passo: tr('o que anda — dá PP'),
    casca: tr('o que protege — vida e resistências'),
    lume: tr('a relíquia acesa — concede um feitiço')
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
  function spellName(d2, id) { return (d2 && d2.name) || tr('Feitiço desconhecido'); }
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
    return tr('Nv') + ' ' + i.level + (i.stars ? ' ' + new Array(i.stars + 1).join('★') : '');
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

  /* NÍVEL DE USO (10/09, pedido do dono): a régua é do dado (items.js) e a
   * cobrança é do Progress ([D19]); a ficha só MOSTRA o "Nv. N" de cada peça
   * e bicho, apaga (is-trancado) o que o herói escolhido ainda não veste e,
   * na tentativa, diz o motivo com nome e número. Sem régua nada aparece. */
  function nivelUsoDe(id) { return safe(function () { return P().nivelUsoDe(id); }, 0) || 0; }
  function nvBadge(id, cls) {
    var n = nivelUsoDe(id);
    return n > 0 ? el('span', cls || 'ig-nv', tr('Nv.') + ' ' + n) : null;
  }
  function nvTxt(id) { var n = nivelUsoDe(id); return n > 0 ? ' · ' + tr('Nv.') + ' ' + n : ''; }
  // o herói está abaixo da peça (ou do bicho)?
  function trancado(hid, id, ehPet) {
    if (!hid) return false;
    var r = safe(function () {
      return ehPet ? P().podeUsarPet(hid, id) : P().podeUsar(hid, id);
    }, null);
    return !!(r && !r.ok);
  }
  function marcaTranca(cell, hid, id, ehPet) {
    if (cell && trancado(hid, id, ehPet)) cell.classList.add('is-trancado');
    return cell;
  }
  // "Estribos de Hera pede o nível 5 — o Sumo está no 3" (texto cru: o toast escapa)
  function textoRecusa(r) {
    if (!r) return tr('Não deu para equipar essa peça.');
    var hh = hero(r.heroId);
    var quem = className((hh && hh.classId) || r.heroId);
    if (r.petId) {
      var pd = petDef(r.petId);
      return tr('{a}: pets a partir do nível {precisa} — o {quem} está no {nivel}', { a: (pd && pd.name) || r.petId, precisa: r.precisa, quem: quem, nivel: r.nivel });
    }
    var it = itemDef(r.itemId);
    return tr('{a} pede o nível {precisa} — o {quem} está no {nivel}', { a: (it && it.name) || r.itemId, precisa: r.precisa, quem: quem, nivel: r.nivel });
  }
  function recusaAtual() { return safe(function () { return P().ultimaRecusa; }, null); }
  function limpaRecusa() { safe(function () { P().ultimaRecusa = null; return true; }, false); }
  /* O saneamento devolveu peças/bichos ao carregar (herói abaixo do nível
   * delas)? UM toast, consumindo a lista — o Acampamento avisa na entrada e a
   * ficha do inventário cobre as páginas sem praça. Consumir GRAVA a migração
   * (Progress.devolvidasPorNivel(true) salva): a abertura seguinte já não
   * acha a peça vestida e o toast não se repete. */
  function avisaDevolvidasPorNivel() {
    // 04/10: primeiro só OLHA. Consumir (true) é uma operação que sobe ao servidor (js/core/autoridade.js),
    // e toda entrada na praça mandava uma, mesmo sem nada devolvido: o servidor respondia com o estado
    // dele, a tela inteira era refeita, a praça nova mandava outra — coroa e cartão de vida piscando
    var ha = safe(function () { return P().devolvidasPorNivel(false); }, []) || [];
    if (!ha.length) return;
    var lista = safe(function () { return P().devolvidasPorNivel(true); }, []) || [];
    if (!lista.length) return;
    var pecas = 0, bichos = 0;
    lista.forEach(function (d) { if (d.petId) bichos++; else pecas++; });
    var partes = [];
    if (pecas) partes.push(tr('{pecas} peça(s) voltaram ao saco', { pecas: pecas }));
    if (bichos) partes.push(tr('{bichos} bicho(s) voltaram à lista', { bichos: bichos }));
    toast(tr('{a}: o herói ainda não tem o nível delas.', { a: partes.join(tr(' e ')) }));
    toastT = 6;                                   // aviso de entrada fica mais
  }

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
  /* 08/10: a explicação que se vê SEGURANDO (dono: "para ver o detalhe do ataque precisa manter
   * pressionado em cima; no PC passar o mouse e deixar parado"). O toque curto continua sendo o
   * clique do botão (tap); segurar o dedo ~0,4 s abre o balão, soltar fecha — e o clique que o
   * soltar dispara é ENGOLIDO na captura, para a leitura não escolher o feitiço sem querer. Com o
   * mouse, parar em cima ~0,5 s abre, sair de cima fecha; clicar fecha e segue o clique. Arrastar
   * o dedo (rolar a barra) cancela. Nada é dono do nó: a barra é refeita a cada pintura. */
  var SEGURA_MS = 420, PAIRA_MS = 500, SEGURA_PX = 10;
  function seguraParaVer(node, title, body, accent) {
    var relogio = 0, engole = false, x0 = 0, y0 = 0, aberto = false;
    function para() { if (relogio) { clearTimeout(relogio); relogio = 0; } }
    function mostra() { if (tipOwner !== node) showTip(node, title, body, accent); aberto = true; }
    function fecha() { para(); if (aberto) { aberto = false; if (tipOwner === node) hideTip(); } }
    node.addEventListener('pointerdown', function (ev) {
      engole = false;
      para();
      if (ev.pointerType === 'mouse') return;
      x0 = ev.clientX; y0 = ev.clientY;
      relogio = setTimeout(function () { relogio = 0; engole = true; mostra(); }, SEGURA_MS);
    });
    node.addEventListener('pointermove', function (ev) {
      if (relogio && ev.pointerType !== 'mouse' &&
          (Math.abs(ev.clientX - x0) > SEGURA_PX || Math.abs(ev.clientY - y0) > SEGURA_PX)) para();
    });
    node.addEventListener('pointerenter', function (ev) {
      if (ev.pointerType !== 'mouse') return;
      para();
      relogio = setTimeout(function () { relogio = 0; mostra(); }, PAIRA_MS);
    });
    node.addEventListener('pointerup', fecha);
    node.addEventListener('pointercancel', fecha);
    node.addEventListener('pointerleave', fecha);
    node.addEventListener('keydown', function () { engole = false; });
    node.addEventListener('click', function (ev) {
      if (!engole) { fecha(); return; }
      engole = false;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }, true);
    node.addEventListener('contextmenu', function (ev) {
      if (engole || relogio || aberto) ev.preventDefault();
    });
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

  /* A LOJA DO SITE (Fase C, 10/09; loja 2): o aviso de que um pedido chegou
   * ou voltou (js/core/loja.js dispara 'soterra:loja'). A tira de recursos da
   * tela aberta se repinta no lugar — sem fechar a ficha que estiver aberta.
   * O TEXTO sai de `UI.avisoLojaTexto(detail)` → {texto, tipo} | null, função
   * PURA (as provas a chamam sem UI.init): a compra da loja, o PRESENTE DO
   * MESTRE, o PACOTE PAGO de vinténs e, no bônus de XP, até quando ele vale. */
  var MOTIVO_LOJA = {
    'sem-saldo': tr('vinténs insuficientes neste jogo'),
    'classe-ja-liberada': tr('a classe já estava liberada'),
    'item-invalido': tr('o item não existe nesta versão do jogo'),
    'erro-local': tr('a entrega falhou aqui; os vinténs voltaram')
  };
  // o presente do Mestre não tem vintém para voltar
  var MOTIVO_PRESENTE = { 'erro-local': tr('a entrega falhou aqui') };
  // 12000 → "12.000"
  function lojaMilhar(n) {
    var v = Math.max(0, Math.floor(Number(n) || 0));
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  // epoch em SEGUNDOS → "14/09 às 21:05" (no relógio de parede desta máquina)
  function lojaQuando(seg) {
    var d = new Date(Number(seg) * 1000);
    if (!isFinite(d.getTime())) return '';
    function z(n) { return (n < 10 ? '0' : '') + n; }
    return z(d.getDate()) + '/' + z(d.getMonth() + 1) + tr(' às ') + z(d.getHours()) + ':' + z(d.getMinutes());
  }
  UI.avisoLojaTexto = function (d) {
    if (!d || typeof d !== 'object' || (d.tipo !== 'entregue' && d.tipo !== 'recusado')) return null;
    var ped = (d.pedido && typeof d.pedido === 'object') ? d.pedido : {};
    var nome = ped.nome ? String(ped.nome) : tr('um pedido');
    var ent = (ped.entrega && typeof ped.entrega === 'object') ? ped.entrega : {};
    var origem = (d.origem === 'presente' || ped.origem === 'presente') ? 'presente'
      : ((d.origem === 'pagamento' || ped.origem === 'pagamento') ? 'pagamento'
      : ((d.origem === 'eco' || ped.origem === 'eco') ? 'eco'
      : ((d.origem === 'trilha' || ped.origem === 'trilha' || ent.origem === 'trilha') ? 'trilha'
      : ((d.origem === 'diario' || ped.origem === 'diario' || ent.origem === 'diario') ? 'diario'
      : ((d.origem === 'amigo' || ped.origem === 'amigo') ? 'amigo' : 'loja')))));
    // 10/10: o prêmio do campeão do Torneio da Arena (servidor/torneio.py: os vinténs e as Gemas Enterradas
    // chegam pela fila da loja com origem 'torneio') — "Prêmio do torneio", e não "Chegou da loja"
    if (d.origem === 'torneio' || ped.origem === 'torneio' || ent.origem === 'torneio' || /^torneio(-|$)/.test(String(ped.sku || ''))) {
      if (d.tipo !== 'entregue') return { texto: tr('O prêmio do torneio não entrou aqui: ele volta na próxima abertura'), tipo: null };
      return { texto: ent.tipo === 'vintens' ? tr('Prêmio do torneio: {a} vinténs', { a: lojaMilhar(ent.qtd) })
                    : ent.tipo === 'pedras' ? tr('Prêmio do torneio: {n} Gema(s) Enterrada(s)', { n: Math.max(1, Math.floor(Number(ent.qtd) || 1)) })
                    : tr('Prêmio do torneio: {a}', { a: esc(nome) }), tipo: 'good' };
    }
    // 15/10: o prêmio do convite (servidor/convites.py): os vinténs dos dois na primeira vitória do convidado
    if (d.origem === 'convite' || ped.origem === 'convite' || ent.origem === 'convite' || String(ped.sku || '') === 'convite-vintens') {
      if (d.tipo !== 'entregue') return { texto: tr('O prêmio do convite não entrou aqui: ele volta na próxima abertura'), tipo: null };
      return { texto: tr('Prêmio do convite: {a} vinténs', { a: lojaMilhar(ent.qtd) }), tipo: 'good' };
    }
    // 08/10: o prêmio diário de resgate (servidor/premio_diario.py)
    if (origem === 'diario') {
      if (d.tipo !== 'entregue') return { texto: tr('O prêmio diário não entrou aqui: ele volta na próxima abertura'), tipo: null };
      var nomeD = safe(function () { return JOGO.PremioDiario.nomeDoPremio(ent); }, '') || nome;
      return { texto: tr('Prêmio diário: {a}', { a: esc(nomeD) }), tipo: 'good' };
    }
    // 04/10: o presente de um amigo (servidor/loja.py, loja_presentear) — o pedido traz quem mandou
    var deQuem = (origem === 'amigo' && ped.de) ? String(ped.de) : '';
    // 07/10: o prêmio de um degrau da trilha da temporada (servidor/trilha.py)
    if (origem === 'trilha') {
      if (d.tipo !== 'entregue') return { texto: tr('O prêmio da trilha não entrou aqui: ele volta na próxima abertura'), tipo: null };
      var nomeT = safe(function () { return JOGO.Trilha.nomeDoPremio(ent); }, '') || nome;
      return { texto: tr('Prêmio da trilha da temporada: {a}', { a: esc(nomeT) }), tipo: 'good' };
    }
    // 02/10: o prêmio da semana do Eco Primordial (servidor/supremo.py) — vinténs, selos e o título
    if (origem === 'eco') {
      if (d.tipo !== 'entregue') return { texto: tr('O prêmio do Eco não entrou aqui: ele volta na próxima abertura'), tipo: null };
      if (ent.tipo === 'vintens') return { texto: tr('Prêmio do Eco Primordial: {a} vinténs', { a: lojaMilhar(ent.qtd) }), tipo: 'good' };
      var partesEco = [];
      if (ent.titulo) partesEco.push(tr('o título “{a}”', { a: titExibe(String(ent.titulo)) }));
      var nSelos = 0;
      if (ent.selos && typeof ent.selos === 'object') {
        Object.keys(ent.selos).forEach(function (k) { nSelos += Math.max(0, Math.floor(Number(ent.selos[k]) || 0)); });
      }
      if (nSelos) partesEco.push((nSelos === 1
        ? tr('{nSelos} selo de chefe', { nSelos: nSelos })
        : tr('{nSelos} selos de chefe', { nSelos: nSelos })));
      return { texto: tr('Prêmio do Eco Primordial{a}: {b}', { a: ent.posicao ? ' ' + tr('({posicao}º da semana)', { posicao: ent.posicao }) : '', b: partesEco.join(tr(' e ')) || nome }), tipo: 'good' };
    }
    if (d.tipo === 'entregue') {
      // 13/09: a troca de vinténs por barras de ouro não traz nada para o jogo — as barras vão para a conta do site
      var txt = (origem === 'pagamento') ? tr('Chegaram {a} vinténs do seu pacote', { a: lojaMilhar(ent.qtd) })
        : (ent.tipo === 'barras' && origem === 'loja') ? tr('Troca feita: {nome} na sua conta do site', { nome: nome })
        : (origem === 'amigo') ? tr('Presente de {a}: {nome}', { a: deQuem || tr('um amigo'), nome: nome })
        : (origem === 'presente' ? tr('Presente do Mestre: ') : tr('Chegou da loja: ')) + nome;
      // 04/10: a aura não vai para o inventário — diz onde ela se liga
      if (ent.tipo === 'aura' || ent.tipo === 'pacote') txt += tr(' — a aura se liga na ficha do Personagem');
      if (ent.tipo === 'bonus-xp') {
        var ate = (typeof d.ate === 'number' && d.ate > 0) ? d.ate : safe(function () { return P().bonusXpAte(); }, 0);
        var quando = (ate > 0) ? lojaQuando(ate) : '';
        if (quando) txt += ' ' + tr('— vale até {quando}', { quando: quando });
      }
      return { texto: txt, tipo: 'good' };
    }
    if (origem === 'pagamento') {
      return { texto: tr('O pacote de vinténs não entrou aqui: ele volta na próxima abertura ({nome})', { nome: nome }), tipo: null };
    }
    var mot = ((origem === 'presente' || origem === 'amigo') && MOTIVO_PRESENTE[d.motivo]) || MOTIVO_LOJA[d.motivo] || 'recusado';
    if (origem === 'amigo') {            // as barras voltam para quem deu, não para cá
      return { texto: tr('O presente de {a} não entrou: {mot} ({nome})', { a: deQuem || tr('um amigo'), mot: mot, nome: nome }), tipo: null };
    }
    return { texto: (origem === 'presente'
      ? tr('Presente do Mestre devolvido: {mot} ({nome})', { mot: mot, nome: nome })
      : tr('Pedido devolvido: {mot} ({nome})', { mot: mot, nome: nome })),
             tipo: null };
  };
  /* Os avisos da loja em FILA (conserto da loja 2, 11/09): uma retirada entrega tudo de uma
   * vez (o crédito do pacote e o personagem comprado com ele saem no mesmo
   * milissegundo) e o toast troca o texto na hora — sem a fila, só o último
   * aparecia. Cada um fica 3 s na tela; um toast de outra coisa no meio passa
   * na frente e a fila segue depois.
   * 11/09 (bateria): a fila não cresce sem fim. Uma retirada grande (a abertura
   * depois de muitas compras e presentes) punha dezenas de avisos em fila, 3 s
   * cada — minutos de toasts, um atrás do outro. Até LOJA_UM_A_UM esperam a vez
   * um por um; o que passa disso vira UM aviso de resumo no fim da fila. */
  var LOJA_AVISO_MS = 3200, LOJA_UM_A_UM = 3, filaLoja = [], lojaVez = null, lojaMostrados = [];
  function somaResumoLoja(r, t) {
    if (t.tipo === 'good') r.ok++; else r.volta++;
    var partes = [];
    if (r.ok) partes.push(r.ok === 1 ? tr('Chegou mais 1 entrega da loja') : tr('Chegaram mais {ok} entregas da loja', { ok: r.ok }));
    if (r.volta) partes.push((r.ok ? 'e ' : '') + (r.volta === 1 ? tr('1 pedido foi devolvido') : r.volta + ' pedidos foram devolvidos'));
    r.texto = partes.join(', ') + (r.volta ? tr(' — veja em "Seus pedidos", na loja do site.') : '.');
    r.tipo = r.volta ? null : 'good';
  }
  function proximoLoja() {
    var t = filaLoja.shift();
    if (!t) { lojaVez = null; return; }
    toast(t.texto, t.tipo || undefined);
    toastT = 3;
    lojaMostrados.push(t.texto);
    if (lojaMostrados.length > 20) lojaMostrados.shift();
    lojaVez = setTimeout(proximoLoja, LOJA_AVISO_MS);
  }
  function avisoLoja(ev) {
    var t = safe(function () { return UI.avisoLojaTexto(ev && ev.detail); }, null);
    if (!t) return;
    safe(function () { refrescaRecursos(); return true; }, false);
    var fimFila = filaLoja[filaLoja.length - 1];
    if (fimFila && fimFila.resumo) somaResumoLoja(fimFila, t);          // o resumo que já espera soma mais um
    else if (filaLoja.length >= LOJA_UM_A_UM) {
      var r = { resumo: true, ok: 0, volta: 0, texto: '', tipo: null };
      somaResumoLoja(r, t);
      filaLoja.push(r);
    } else filaLoja.push(t);
    if (!lojaVez) proximoLoja();
  }
  // só as provas (tests/loja.html): o que já apareceu, o que espera a vez e se há um na tela
  UI._avisosLoja = function () {
    return { mostrados: lojaMostrados.slice(), fila: filaLoja.map(function (x) { return x.texto; }), ocupado: !!lojaVez };
  };
  try { window.addEventListener('soterra:loja', avisoLoja); } catch (eLj) {}

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
      ? tr('toque de novo para lançar')
      : tr('toque de novo para andar até aqui');
    miraEl.classList.add('is-on');
    miraT = 2.0;
  };

  // ------------------------------------------------------------ barras e pips
  /* `esc` (09/10, opcional): a fração do ESCUDO, pintada em azul (.bar-esc) encostada no fim do
   * preenchimento — a barra de PV da batalha mostra vida + escudo como uma só (fracoesVida). */
  function bar(cls, pct, label, esc) {
    var b = el('div', 'bar ' + cls);
    var f = el('div', 'bar-fill');
    var wPv = Math.max(0, Math.min(100, pct * 100));
    f.style.width = wPv + '%';
    b.appendChild(f);
    if (esc > 0) {
      var e = el('div', 'bar-esc');
      e.style.left = wPv + '%';
      e.style.width = Math.max(0, Math.min(100 - wPv, esc * 100)) + '%';
      b.appendChild(e);
    }
    if (label != null) b.appendChild(el('span', 'bar-txt', label));
    return b;
  }
  /* 09/10 — A BARRA DE VIDA COM O ESCUDO EM AZUL (o dono: "o escudo que o Minotauro dá deve somar à
   * vida do personagem, mas a barra de vida deve ficar azul proporcionalmente ao tamanho da
   * quantidade de escudo"). Vida e escudo numa barra só: a escala é max(hpMax, hp + escudo) — o
   * escudo ocupa o trecho vazio e, quando hp + escudo passa de hpMax, a barra estica em vez de
   * cortar. Sem escudo é exatamente a barra de antes. Gêmea de `barraVida` do renderer 3D
   * (renderer3d_v2.js, R.barraVida): as duas têm de dar o mesmo desenho. Devolve frações em [0,1]
   * (pv, esc) e `rot`, o texto do PV ("110 +30 / 150" quando há escudo). */
  function fracoesVida(u) {
    var pv = Math.max(0, u.hp || 0), esc = Math.max(0, u.shield || 0), max = Math.max(1, u.hpMax || 1);
    var total = Math.max(max, pv + esc);
    return { pv: Math.min(1, pv / total), esc: Math.min(1, esc / total), total: total,
             rot: u.hp + (esc > 0 ? ' +' + esc : '') + ' / ' + u.hpMax };
  }
  // a barra de PV da unidade na batalha (o cartão da vez); as provas (tests/foto_escudo_barra.html) a montam direto
  function barraPv(u) {
    var fr = fracoesVida(u);
    return bar('bar-hp', fr.pv, fr.rot, fr.esc);
  }
  UI._fracoesVida = fracoesVida;
  UI._barraPv = barraPv;
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
      return tr('Cada nível: +{a} PV e +{b} de dano de {c}.', { a: pe.hp || 5, b: pe.elemPower || 3, c: ELEM_PT[element] || element });
    }
    return tr('Cada nível: +{a} PV e +{b} de poder — a partir do nível 5 o ganho passa a ser do elemento escolhido.', { a: pl.hp || 5, b: pl.power || 3 });
  }

  // ==========================================================================
  // ESQUELETO
  // ==========================================================================
  var SCREEN_NAMES = ['menu', 'heroSelect', 'hub', 'dungeonSelect', 'elementChoice', 'duelFim',
                      'battle', 'roomClear', 'dungeonComplete', 'defeat', 'antessala',
                      'ecoFim'];       // 02/10: o fim da tentativa do Eco Primordial

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
    /* 03/10 (revisão): a ficha se anuncia como diálogo MODAL (aria-modal) — o
     * leitor de tela passa a tratar o resto da página como inerte. O Tab, não:
     * do último botão ele saía para o cais e os botões ATRÁS do véu, e o
     * jogador de teclado se perdia num lugar que nem enxerga. O Tab dá a volta
     * dentro da ficha (do último ao primeiro, e Shift+Tab do primeiro ao último). */
    sheetEl.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Tab' || !sheetEl.classList.contains('is-on')) return;
      var pn = sheetEl.querySelector('.sheet-panel');
      if (!pn) return;
      var foc = [].filter.call(pn.querySelectorAll(
        'button, a[href], input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])'),
        function (n) { return !n.disabled && n.tabIndex >= 0 && n.getClientRects().length > 0; });
      if (!foc.length) return;
      var prim = foc[0], ult = foc[foc.length - 1], at = document.activeElement, vai = null;
      if (ev.shiftKey && (at === prim || at === pn)) vai = ult;
      else if (!ev.shiftKey && at === ult) vai = prim;
      if (!vai) return;
      ev.preventDefault();
      try { vai.focus(); } catch (e) {}
    });

    tipEl = el('div', 'ui-tip');
    root.appendChild(tipEl);
    toastEl = el('div', 'ui-toast');
    root.appendChild(toastEl);
    // 06/10: o cartão dos PEDIDOS entre jogadores (grupo, desafio, troca, guilda) — fora das telas e por
    // cima das fichas: a praça remontada e a ficha aberta não o tiram da frente (pintaPedido)
    pedidoEl = el('div', 'ui-pedido');
    pedidoEl.setAttribute('role', 'status');
    pedidoEl.setAttribute('aria-live', 'polite');
    root.appendChild(pedidoEl);
    // 10/10: a CHAMADA do Torneio da Arena — outro cartão fora das telas e por cima das fichas: enquanto a luta
    // está sendo chamada ele não some, esteja o jogador onde estiver (pintaChamada)
    torneioEl = el('div', 'ui-torneio');
    torneioEl.setAttribute('role', 'alert');
    torneioEl.setAttribute('aria-live', 'assertive');
    root.appendChild(torneioEl);
    document.addEventListener('visibilitychange', voltaDoFundo);
    window.addEventListener('focus', voltaDoFundo);
    window.addEventListener('pageshow', voltaDoFundo);
    miraEl = el('div', 'ui-mira');
    root.appendChild(miraEl);
    // 11/09: o painel do grupo (canto direito) e o menu dos cartões — camadas
    // fixas fora das telas, sobrevivem às trocas de tela; e os ganchos do
    // Grupo, do Duelo, dos Sussurros e do Coop, pendurados uma vez
    grupoLadoEl = el('div', 'grupo-lado');
    root.appendChild(grupoLadoEl);
    glMenuEl = el('div', 'gl-menu');
    root.appendChild(glMenuEl);
    document.addEventListener('click', function (ev) {
      if (glMenuEl && glMenuEl.classList.contains('is-on') && !glMenuEl.contains(ev.target) &&
          !(grupoLadoEl && grupoLadoEl.contains(ev.target))) fechaGlMenu();
    }, true);
    ligaSocial();

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
      // M: o Painel do Mestre de qualquer tela (12/09) — só para o Mestre; 03/10: o painel único
      if (k === 'm' && mestreAtivo()) {
        ev.preventDefault();
        alternaPainelMestre();
      }
    });

    UI.showScreen(safe(function () { return G().screen; }, 'menu'));
    // 12/09: com uma dupla lembrada, o jogo abre no Acampamento (login rápido)
    entraDiretoNaPraca();
    ligaInatividade();
    return UI;
  };

  /* 15 MINUTOS SEM JOGAR (12/09, pedido do dono: "15 min de inatividade a
   * conta desloga para não consumir servidor"). O relógio e o desligamento
   * moram na Sessao; aqui fica só o aviso na tela, porque a aba NÃO se manda
   * embora sozinha: quem estava com a ficha aberta perderia o que fazia. O
   * botão recarrega a página, que é o caminho de sempre para entrar de novo. */
  function ligaInatividade() {
    var Se = JOGO.Sessao;
    if (!Se || !Se.vigiaInatividade) return;
    Se.aoInativo = function (info) {
      var caixa = el('div', 'inativo-capa');
      var cx = el('div', 'inativo-cx');
      cx.appendChild(el('h2', null, tr('Você saiu por inatividade')));
      cx.appendChild(el('p', null, (info && info.tinhaConta
        ? tr('Ficou {a} minutos sem jogar, então a sua conta saiu e a conexão fechou para não ocupar o servidor. O seu progresso já está guardado.', { a: Math.round((Se.INATIVO_MS || 900000) / 60000) })
        : tr('Ficou {a} minutos sem jogar, então a conexão fechou para não ocupar o servidor. O seu progresso já está guardado.', { a: Math.round((Se.INATIVO_MS || 900000) / 60000) }))));
      var b = el('button', 'btn btn-primary', tr('Entrar de novo'));
      b.type = 'button';
      // 04/10: quem tinha conta saiu dela — "entrar de novo" é a tela de entrar, com a senha. Recarregar
      // abria o jogo sem conta (e, antes, com o save da conta que tinha acabado de sair)
      tap(b, function () {
        try {
          if (info && info.tinhaConta && !Se.semRecarga) {
            if (Se.marcaVolta) Se.marcaVolta();          // 06/10: no ar, entrar de novo volta ao jogo
            location.href = Se.paginaConta() + '#entrar';
          }
          else location.reload();
        } catch (e) {}
      });
      cx.appendChild(b);
      var a = el('a', 'btn btn-ghost', tr('Ir para o site'));
      a.href = safe(function () { return Se.paginaSite(); }, 'site/index.html');
      cx.appendChild(a);
      caixa.appendChild(cx);
      if (root) root.appendChild(caixa);
    };
    safe(function () { return Se.vigiaInatividade(); }, null);
  }

  UI.showScreen = function (name, data) {
    if (!screens[name]) name = 'menu';
    hideTip();
    // 24/10: a batalha que começa (o grupo desceu, a porta abriu) fecha a aba do site que estava por cima
    if (name === 'battle') safe(function () { if (JOGO.SiteAba && JOGO.SiteAba.aberta()) JOGO.SiteAba.fecha(); return true; }, null);
    if (name !== 'battle') closeSheet();
    // 06/10: a batalha que começa encerra a troca que ficou pendurada (o pedido ou a mesa): na luta ela
    // não tem tela, e ficava de pé recusando todo pedido seguinte. O outro lado é avisado (a voz `cancela`)
    else if (current !== 'battle') safe(function () { if (JOGO.Troca.estado()) JOGO.Troca.cancelar(); return true; }, null);
    current = name;
    // 06/10: a música segue a TELA — luta na batalha, a da praça em todo o resto (js/audio.js); ficha não é tela
    safe(function () { if (JOGO.Audio && JOGO.Audio.musica) JOGO.Audio.musica.tela(name); }, null);
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
    else if (name === 'hub') { buildHub(null); ofereceRetomada(); }
    // A ANTESSALA (03/09): a mesma máquina da praça, no pátio da sala
    else if (name === 'antessala') {
      // 15/10: a primeira luta de uma conta nova entra sem o pátio — a porta abre sozinha
      if (safe(function () { return !!G().primeiraLuta; }, false)) buildPrimeiraLuta();
      else buildHub(data || safe(function () { return G().salaInfo(); }, null));
    }
    else if (name === 'dungeonSelect') buildDungeonSelect();
    else if (name === 'elementChoice') buildElementChoice(data);
    else if (name === 'duelFim') buildDuelFim(data);
    else if (name === 'battle') {
      logLines = []; buildBattle();
      // 15/10: a primeira batalha da conta é GUIADA (js/ui/tutor.js, três passos); a marca sai aqui
      if (safe(function () { return !!G().primeiraLuta; }, false)) {
        G().primeiraLuta = false;
        safe(function () { JOGO.Tutor.guiar(); return true; }, null);
      }
    }
    else if (name === 'roomClear' || name === 'dungeonComplete') buildRewards(name, data);
    else if (name === 'defeat') buildDefeat();
    else if (name === 'ecoFim') buildEcoFim(data);
    socialNaTela(name);
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
      tipOn(chip, defs[k].name, tr('{a}<br><i>Você tem {n}.</i>', { a: esc(defs[k].description || ''), n: n }), elemColor(defs[k].element));
      wrap.appendChild(chip);
    }
    // os PERGAMINHOS da loja (Fase C) entram na mesma tira, depois das pedras
    var pgs = pergaminhoChips(function () {
      var nova = stonesStrip();
      if (wrap.parentNode) wrap.parentNode.replaceChild(nova, wrap);
    }, false);
    for (var ip = 0; ip < pgs.length; ip++) { wrap.appendChild(pgs[ip]); any = true; }
    return any ? wrap : el('div', 'stones-strip is-hidden');
  }

  /* OS PERGAMINHOS DA LOJA DO SITE (Fase C, 10/09): chips na tira de recursos
   * (menu) e, compactos, no topo do Acampamento. Ainda sem arte — o dono paga
   * os ícones depois —, um glifo num disco. O da SABEDORIA se LÊ com um toque
   * (confirmação antes); o da REESCRITA se usa na ficha do herói, no bloco
   * "Caminhos elementais". Sem nenhum pergaminho e sem carga, nada aparece. */
  function pergaminhoChips(aoMudar, compacto) {
    var pg = safe(function () { return P().pergaminhos(); }, null);
    if (!pg || (!pg.xp && !pg.elemento && !pg.salasXp)) return [];
    var out = [];
    function chip(cls) {
      var c = el(compacto ? 'button' : 'div', (compacto ? 'perg-mini' : 'stone-chip') + ' perg-chip ' + cls);
      if (compacto) c.type = 'button';
      return c;
    }
    if (pg.xp || pg.salasXp) {
      var c1 = chip('perg-xp' + (pg.xp ? '' : ' is-empty'));
      c1.appendChild(el('span', 'perg-glifo', '❦'));
      c1.appendChild(el('span', 'stone-n', '×' + pg.xp));
      c1.appendChild(el('span', 'stone-nm', compacto
        ? (pg.salasXp ? pg.salasXp + ' salas' : tr('Sabedoria'))
        : tr('Pergaminho da Sabedoria{a}', { a: pg.salasXp ? ' (' + pg.salasXp + ' salas ativas)' : '' })));
      c1.title = tr('Pergaminho da Sabedoria ×{xp}{a}', { xp: pg.xp, a: pg.salasXp ? ' (' + pg.salasXp + ' salas ativas)' : '' });
      tap(c1, function () { lerSabedoria(aoMudar); });
      out.push(c1);
    }
    if (pg.elemento) {
      var c2 = chip('perg-el');
      c2.appendChild(el('span', 'perg-glifo', '↺'));
      c2.appendChild(el('span', 'stone-n', '×' + pg.elemento));
      c2.appendChild(el('span', 'stone-nm', compacto ? tr('Reescrita') : tr('Pergaminho da Reescrita')));
      c2.title = tr('Pergaminho da Reescrita ×{elemento}', { elemento: pg.elemento });
      tipOn(c2, tr('Pergaminho da Reescrita ×{elemento}', { elemento: pg.elemento }),
        tr('Troca UM caminho elemental de um herói por outro que ele ainda não tem, no mesmo lugar. Use no Acampamento, na ficha do herói — bloco <b>Caminhos elementais</b>. Trocar o caminho ativo entre os liberados continua de graça.'), '#7fd6c8');
      out.push(c2);
    }
    return out;
  }
  // a versão compacta, no topo do Acampamento (repinta a si mesma depois de
  // ler). Loja 2: a caixa é dos DOIS — o bônus de XP por tempo vem na frente,
  // com o tempo que falta, repintado a cada minuto enquanto houver bônus e a
  // caixa estiver na tela (fora dela, o relógio para sozinho)
  function hubPergaminhos() {
    var w = el('span', 'hub-perg');
    var relogio = null;
    function para() { if (relogio) { clearInterval(relogio); relogio = null; } }
    function pinta() {
      clear(w);
      var cs = pergaminhoChips(pinta, true);
      var cb = bonusXpChip();
      if (cb) cs.unshift(cb);
      for (var i = 0; i < cs.length; i++) w.appendChild(cs[i]);
      w.classList.toggle('is-off', !cs.length);
      if (!cb) para();
      else if (!relogio) {
        relogio = setInterval(function () {
          if (!w.isConnected) { para(); return; }
          pinta();
        }, BONUS_TIQUE_MS);
      }
    }
    pinta();
    return w;
  }
  UI._hubPergaminhos = hubPergaminhos;   // só as provas (tests/loja.html): a caixa do topo do Acampamento

  /* O BÔNUS DE XP POR TEMPO (loja 2, 10/09): o chip "✦ Bônus de XP ×1,5 ·
   * 2 d 3 h". O tempo que falta é pelo relógio do SERVIDOR (JOGO.Agenda.agora;
   * sem a agenda, o desta máquina) — o mesmo que o game.js usa na recompensa.
   * Acabou o prazo, o chip some. Toque: a dica com a data e a regra. */
  var BONUS_TIQUE_MS = 60 * 1000;
  function bonusAgoraMs() {
    var t = safe(function () { return JOGO.Agenda.agora(); }, NaN);
    return (typeof t === 'number' && isFinite(t)) ? t : Date.now();
  }
  // "2 d 3 h", "5 h 20 min", "12 min", "menos de 1 min" (o que FALTA: arredonda para baixo)
  function bonusFalta(ms) {
    var min = Math.floor(Number(ms) / 60000);
    if (!(min >= 1)) return tr('menos de 1 min');
    var d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
    if (d > 0) return d + ' d' + (h ? ' ' + h + ' h' : '');
    if (h > 0) return h + ' h' + (m ? ' ' + m + ' min' : '');
    return m + ' min';
  }
  function bonusFmt(f) {
    var n = Math.round(Number(f) * 100) / 100;
    return '×' + String(isFinite(n) ? n : 1).replace('.', ',');
  }
  function bonusXpChip() {
    var ate = safe(function () { return P().bonusXpAte(); }, 0);
    if (!(ate > 0)) return null;
    var falta = ate * 1000 - bonusAgoraMs();
    if (!(falta > 0)) return null;
    var fator = safe(function () { return D().bonusXp.fator; }, 1.5);
    if (!(fator > 1)) fator = 1.5;
    var c = el('button', 'perg-mini perg-chip perg-bonus');
    c.type = 'button';
    c.appendChild(el('span', 'perg-glifo', '✦'));
    c.appendChild(el('span', 'stone-nm', tr('Bônus de XP')));
    c.appendChild(el('span', 'stone-n', bonusFmt(fator)));
    c.appendChild(el('span', 'stone-nm', '· ' + bonusFalta(falta)));
    c.title = tr('Bônus de XP {a} · {b}', { a: bonusFmt(fator), b: bonusFalta(falta) });
    tipOn(c, tr('Bônus de XP {a}', { a: bonusFmt(fator) }),
      tr('+{a}% de experiência para o grupo até {b}. Não soma com o Pergaminho da Sabedoria; com evento de XP, os dois param em ×2.', { a: Math.round((fator - 1) * 100), b: esc(lojaQuando(ate)) }), '#e8c25a');
    return c;
  }
  function lerSabedoria(aoMudar) {
    var pg = safe(function () { return P().pergaminhos(); }, null) || {};
    var cfg = (D().pergaminhos || {}).xp || {};
    var salas = cfg.salas || 9, teto = cfg.tetoSalas || 27;
    var pct = Math.round(((cfg.fator || 1.5) - 1) * 100);
    var ativas = pg.salasXp || 0;
    if (!pg.xp) {
      toast(tr('Nenhum Pergaminho da Sabedoria guardado — {ativas} salas ainda com o bônus.', { ativas: ativas }));
      return;
    }
    if (ativas + salas > teto) {
      toast(tr('Já há {ativas} salas com o bônus (o teto é {teto}). Leia depois de vencer mais salas.', { ativas: ativas, teto: teto }));
      return;
    }
    confirmSheet(tr('Ler o Pergaminho da Sabedoria?'),
      tr('<b>+{pct}% de experiência</b>: vale para o grupo nas próximas {salas} salas vencidas{a}; em calabouço raso para o nível, o corte de XP come o bônus. Com um evento de XP no ar, os dois juntos param em ×2. Derrota e abandono não gastam carga. Guardados: {xp}.', { pct: pct, salas: salas, a: ativas ? ' ' + tr('(somam às {ativas} que já estão ativas)', { ativas: ativas }) : '', xp: pg.xp }),
      function () {
        var r = safe(function () { return P().lePergaminhoXp(); }, null);
        if (r && r.ok) toast(tr('Pergaminho lido: {salas} salas com +{pct}% de XP.', { salas: r.salas, pct: pct }), 'good');
        else toast(r && r.motivo === 'cheio' ? tr('O teto é {teto} salas ativas.', { teto: teto }) : tr('Não há pergaminho para ler.'));
        if (aoMudar) safe(function () { aoMudar(); return true; }, false);
      });
  }
  // depois de uma entrega da loja: as tiras da tela aberta mostram o saldo novo
  function refrescaRecursos() {
    var s = current ? screens[current] : null;
    if (!s || !s.querySelectorAll) return;
    var tiras = s.querySelectorAll('.stones-strip');
    for (var i = 0; i < tiras.length; i++) {
      if (tiras[i].parentNode) tiras[i].parentNode.replaceChild(stonesStrip(), tiras[i]);
    }
    var pgs = s.querySelectorAll('.hub-perg');
    for (var j = 0; j < pgs.length; j++) {
      if (pgs[j].parentNode) pgs[j].parentNode.replaceChild(hubPergaminhos(), pgs[j]);
    }
  }

  // ==========================================================================
  // TELA: MENU
  // ==========================================================================
  function buildMenu() {
    var s = screens.menu;
    clear(s);
    var box = el('div', 'menu-box');
    box.appendChild(el('h1', 'game-title', 'SOTERRA'));
    box.appendChild(el('p', 'game-sub', tr('Desça. O fundo tem dono.')));

    /* O MENU É UMA PORTA DE ENTRADA (11/09, pedido do dono: "precisa ser um
     * menu de login, mais simples e mais para troca de personagem"). Ele
     * tinha virado um painel de gestão — inventário, forja, feitiços, avatar
     * e a prateleira de pedras — que só fazem sentido COM um grupo escolhido,
     * e todos já têm porta no cais do Acampamento. Aqui ficam três coisas:
     * DESCER (que é escolher quem desce), a COLEÇÃO (as cartas, que é o que
     * se olha antes de escolher) e a CONTA. Mais o resumo embaixo. */
    var acts = el('div', 'menu-acts');
    // 12/09: a conta do Mestre só tem o Mestre do Fundo — não há quem escolher
    acts.appendChild(btn(tr('Descer'), 'btn-primary btn-big', function () {
      if (soMestreDoFundo()) { selHeroes = ['gm']; navTo('hub'); return; }
      navTo('heroSelect');
    }));
    // O GAME MASTER (31/08): o botão só EXISTE com a chave do dono virada —
    // é a porta do Mestre e não entra na conta do "menu enxuto"
    if (JOGO.GM && JOGO.GM.ativo && JOGO.GM.ativo()) {
      acts.appendChild(btn(tr('⚔ Painel do Mestre'), 'btn-gold btn-big', function () {
        gmAbre();
      }));
    }
    var fichas = el('div', 'menu-fichas');
    fichas.appendChild(btn(tr('Coleção'), 'btn-mini btn-ghost', function () { sheetParty('colecao'); }));
    // o Banco de Contas (25/08): qual conta ESTA janela é, e a porta para
    // trocar/criar — duas janelas com contas diferentes = dois jogadores
    var rotuloConta = safe(function () { return JOGO.Contas.rotulo(); }, null);
    fichas.appendChild(btn(rotuloConta ? tr('Conta: <b>{a}</b>', { a: esc(rotuloConta) }) : tr('Conta'),
      'btn-mini btn-ghost', function () { openSheet('contas'); }));
    // 02/10: a ficha das Configurações (som, tela, movimento) — antes não havia
    fichas.appendChild(btn(tr('Configurações'), 'btn-mini btn-ghost menu-config', function () { openSheet('config'); }));
    // 24/10 (o dono): a LOJA e o SITE abrem numa aba DENTRO do jogo (js/ui/site_aba.js) — a loja já compra ali
    fichas.appendChild(botaoLoja('btn-mini btn-ghost menu-loja'));
    fichas.appendChild(botaoSite('btn-mini btn-ghost menu-site'));
    // 08/10 (o dono): sair da conta DIRETO do menu, sem passar por Configurações → Conta e nuvem
    if (safe(function () { return JOGO.Sessao && JOGO.Sessao.ativa && JOGO.Sessao.ativa(); }, false)) {
      fichas.appendChild(btn(tr('Sair da conta'), 'btn-mini btn-ghost menu-sair-conta', function () { sairDaConta(); }));
    }
    acts.appendChild(fichas);
    box.appendChild(acts);

    // resumo do cofre: quantas classes liberadas, quantas estrelas somadas
    var ids = Object.keys(classes());
    var libs = 0, stars = 0;
    ids.forEach(function (c) { var i = cardInfo(c); if (i.unlocked) libs++; stars += i.stars; });
    if (ids.length) {
      box.appendChild(el('p', 'menu-foot',
        tr('{libs} de {length} classes liberadas · {stars} estrelas', { libs: libs, length: ids.length, stars: stars })));
    }
    box.appendChild(botaoSair());
    s.appendChild(box);
  }

  /* SAIR DO JOGO (11/09, pedido do dono: "precisa ter um botão de sair do
   * jogo também, que vai para a página do site do sistema"). Fecha a aba do
   * jogo? Não: navegador nenhum deixa uma página se fechar sozinha, e um
   * botão que às vezes não faz nada é pior que botão nenhum. Ele LEVA para o
   * site — que é onde se cuida da conta, da loja e do ranking — e o save já
   * está gravado a cada passo, então sair é só sair. */
  /* O "SITE" COM O GLOBO (24/10, o dono: "dentro do jogo deve ter um ícone de um globo com nome Site, que leva pro
   * site do jogo e abre uma aba do site no próprio jogo"). É um link para a capa do site, que o js/ui/site_aba.js
   * abre na aba de dentro do jogo (no aplicativo e na web). Sem aquele arquivo, o mesmo link, sem o desenho. */
  function botaoSite(cls) { return botaoDoSite(cls, tr('Site'), null, 'site/index.html'); }
  /* A "LOJA" COM O SACO (24/10, o dono: "onde o usuário consegue abrir a loja dentro do jogo e já comprar ali,
   * pagando pela Google ou pelo Mercado Pago"): a mesma aba, aberta direto na loja do site. No aplicativo a loja
   * compra pela Google Play do jogo; na web, pelo Mercado Pago, que abre numa aba nova do navegador. */
  function botaoLoja(cls) {
    // 25/10: `loja-jogo` some com a loja fechada (SOTERRA_LOJA=0; css/style.css, html.loja-fechada)
    return botaoDoSite((cls || '') + ' loja-jogo', tr('Loja'), { pagina: 'loja.html', icone: 'loja',
      titulo: tr('A loja do SOTERRA: barras de ouro, personagens e aparência') }, 'site/loja.html');
  }
  function botaoDoSite(cls, rotulo, op, reserva) {
    var SA = JOGO.SiteAba;
    if (SA && SA.botao) { var b = safe(function () { return SA.botao(cls, rotulo, op); }, null); if (b) return b; }
    var a = el('a', 'btn bt-site ' + (cls || ''), esc(rotulo));
    a.href = reserva;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }
  function botaoSair() {
    var a = el('a', 'btn btn-ghost menu-sair', tr('Sair do jogo'));
    a.href = safe(function () { return JOGO.Sessao.paginaSite(); }, 'site/index.html');
    a.title = tr('Volta para o site — o seu progresso já está guardado');
    return a;
  }

  // ==========================================================================
  // TELA: ESCOLHA DE HERÓIS (1 ou 2) — §9-B
  // ==========================================================================
  function buildHeroSelect() {
    var s = screens.heroSelect;
    clear(s);
    // A CONTA DO MESTRE só tem o Mestre do Fundo (12/09: "conta de gm só terá o
    // personagem GM") — já escolhido, e o único cartão da tela
    var soMestre = soMestreDoFundo();
    if (soMestre) selHeroes = ['gm'];
    // 08/10 (o dono): a conta NOVA escolhe os seus DOIS primeiros heróis, de qualquer classe — as sete
    // aparecem abertas, e a escolha se grava uma vez só (Progress.escolheIniciais)
    var escolhendo = !soMestre && safe(function () { return P().podeEscolherIniciais(); }, false);
    if (escolhendo) selHeroes = selHeroes.filter(function (c) { return !!classDef(c) && c !== 'gm'; }).slice(0, 2);
    s.appendChild(header(tr('Quem desce'), escolhendo
      ? tr('Bem-vindo! Escolha os seus DOIS primeiros heróis, de qualquer classe — o primeiro é o seu avatar e anda no Acampamento. As outras classes vêm depois, pelas cartas dos chefes.')
      : tr('Escolha 1 ou 2 heróis — o PRIMEIRO é o seu avatar e anda no Acampamento. Sozinho, a sorte de saque é máxima.'), 'menu'));

    var body = el('div', 'ui-body');
    var luck = el('div', 'luck-panel');
    body.appendChild(luck);

    var grid = el('div', 'hero-grid');
    body.appendChild(grid);
    s.appendChild(body);

    var foot = el('footer', 'ui-foot');
    var cnt = el('span', 'foot-count', '');
    var go = btn(tr('Confirmar'), 'btn-primary', function () {
      if (escolhendo) {
        if (selHeroes.length !== 2) { toast(tr('Escolha dois heróis para começar.')); return; }
        var okE = safe(function () { return P().escolheIniciais(selHeroes.slice()); }, false);
        if (!okE) { toast(tr('Não deu para gravar a escolha. Tente de novo.')); return; }
        toast(tr('{a} e {b} são os seus heróis. Boa descida!', { a: esc(className(selHeroes[0])), b: esc(className(selHeroes[1])) }), 'good');
        /* 15/10 — A PRIMEIRA LUTA ANTES DA PRAÇA (a análise de mercado: quem não chega à primeira luta em
         * um ou dois minutos desinstala). A escolha das iniciais só acontece UMA vez por conta, então
         * este é, por definição, o primeiro jogador: em vez da praça (a cena mais pesada, com a pré-busca),
         * os dois descem direto para a primeira sala do primeiro calabouço — a antessala vira um aviso de
         * um instante e a porta abre sozinha (buildPrimeiraLuta). A praça vem depois da primeira vitória. */
        guardaDupla();
        var primeiro = safe(function () { return (JOGO.DATA.dungeons[0] || {}).id; }, null) || 'greenhouse';
        G().primeiraLuta = true;
        safe(function () { JOGO.EventosUso.anota('primeira_luta_direta'); }, null);
        if (safe(function () { return G().startRun(selHeroes.slice(), primeiro); }, false)) return;
        G().primeiraLuta = false;      // não deu (portal fechado?): a praça de sempre
      }
      if (!selHeroes.length) { toast(tr('Escolha ao menos um herói.')); return; }
      guardaDupla();          // 12/09: o próximo login já abre na praça com esta
      navTo('hub');
    });
    foot.appendChild(cnt);
    foot.appendChild(go);
    s.appendChild(foot);

    function paintFoot() {
      var n = selHeroes.length;
      if (escolhendo) {
        cnt.innerHTML = n < 2 ? tr('Escolha <b>{a}</b> de 2', { a: n }) : tr('<b>2 heróis</b> escolhidos — confirme');
        go.classList.toggle('is-off', n !== 2);
        paintLuck(luck, n);
        return;
      }
      cnt.innerHTML = n === 0 ? tr('Nenhum escolhido')
        : n === 1 ? tr('<b>1 herói</b> · sorte de saque <b class="luck-hi">máxima</b>')
                  : tr('<b>2 heróis</b> · sorte <b class="luck-mid">média</b>, mas podem <b>fundir</b>');
      go.classList.toggle('is-off', n === 0);
      paintLuck(luck, n);
    }

    var ids = soMestre ? ['gm'] : Object.keys(classes());
    if (!ids.length) ids = heroIds();
    if (escolhendo) ids = ids.filter(function (c) { return c !== 'gm'; });
    ids.forEach(function (cid) { grid.appendChild(heroCard(cid, paintFoot, escolhendo)); });
    paintFoot();
  }

  // medidor de Sorte de Saque em DOIS estados (solo = máxima, dupla = média)
  function paintLuck(box, n) {
    clear(box);
    var lk = LUCK[n] || 0;
    box.appendChild(el('div', 'luck-title', tr('Sorte de Saque')));
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
      ? tr('Item raro e épico caem muito mais. Você luta sem rede.')
      : n === 2 ? tr('Menos saque, mais ação: dois turnos por rodada e a fusão na manga.')
                : tr('Escolha os heróis para ver a sorte.')));
    if (lk) box.style.setProperty('--luck', String(lk));
  }

  function heroCard(cid, onChange, escolhendo) {
    var def = classDef(cid) || {};
    var info = cardInfo(cid);
    var unlocked = info.unlocked;
    var h = unlocked ? hero(cid) : null;
    var idx = selHeroes.indexOf(cid);
    // 08/10: na ESCOLHA das duas iniciais toda classe é um cartão aberto — a prévia (os números do dado,
    // a raridade da carta) e o botão de escolher; nada de cadeado, nada de ficha
    if (escolhendo) {
      var cp = el('div', 'hero-card is-previa' + (idx >= 0 ? ' is-sel' : ''));
      var picP = el('div', 'hero-pic');
      picP.appendChild(art('unit', [cid, { element: 'neutro', dir: 0, scale: 0.62 }], 100));
      cp.appendChild(picP);
      cp.appendChild(el('div', 'hero-name', esc(def.name || cid)));
      cp.appendChild(el('div', 'hero-role', esc(def.role ? tr(def.role) : '')));
      var rarP = def.cardRarity || 'comum';
      var chipP = el('span', 'chip hero-rar', esc(RAR_PT[rarP] || rarP));
      chipP.style.color = rarColor(rarP);
      cp.appendChild(chipP);
      var stP = def.stats || {};
      cp.appendChild(el('div', 'hero-stats',
        tr('<span class="s-hp">{a} PV</span><span class="s-pa">{b} PA</span><span class="s-pp">{c} PP</span>', { a: stP.hp || 0, b: stP.pa || 0, c: stP.pp || 0 })));
      var actsP = el('div', 'hero-acts');
      actsP.appendChild(btn(idx === 0 ? tr('① Avatar') : idx > 0 ? tr('② Escolhido') : tr('Escolher'),
                            'btn-mini ' + (idx >= 0 ? 'btn-primary' : ''), function () {
        var i = selHeroes.indexOf(cid);
        if (i >= 0) selHeroes.splice(i, 1);
        else if (selHeroes.length >= 2) { toast(tr('São dois heróis: tire um para trocar.')); return; }
        else selHeroes.push(cid);
        buildHeroSelect();
      }));
      cp.appendChild(actsP);
      return cp;
    }
    var card = el('div', 'hero-card' + (unlocked ? '' : ' is-locked'));
    if (idx >= 0) card.classList.add('is-sel');

    var pic = el('div', 'hero-pic');
    if (unlocked) {
      pic.appendChild(art('unit', [cid, { element: (h && h.element) || 'neutro', dir: 0, scale: 0.62 }], 100));
      // 07/10 (o dono): as estrelas da classe em cima da imagem, com a quantidade — quem já tem estrela se vê na hora
      if (info.stars) {
        var selo = el('div', 'hero-estrelas', '★' + info.stars);
        tipOn(selo, tr('★{a}', { a: info.stars }), tr('{a} estrela(s) desta classe — bônus permanente, já contado na ficha.', { a: info.stars }));
        pic.appendChild(selo);
      }
    } else {
      var sil = art('unit', [cid, { element: 'neutro', dir: 0, scale: 0.62 }], 100, 'silhouette');
      pic.appendChild(sil);
      pic.appendChild(el('div', 'lock-badge', '🔒'));
    }
    card.appendChild(pic);

    var name = el('div', 'hero-name', esc(def.name || cid));
    card.appendChild(name);
    card.appendChild(el('div', 'hero-role', esc(def.role ? tr(def.role) : '')));

    if (unlocked && h) {
      var xi = xpInfo(cid);
      var st = effStats(cid) || def.stats || {};
      var row = el('div', 'hero-lv');
      row.appendChild(el('span', 'lv-badge', tr('Nv') + ' ' + (h.level || 1)));
      var eb = el('span', 'elem-badge e-' + (h.element || 'neutro'), ELEM_PT[h.element] || tr('Neutro'));
      eb.style.setProperty('--ec', elemColor(h.element || 'neutro'));
      row.appendChild(eb);
      if (info.stars) row.appendChild(starRow(info.stars, 13));
      card.appendChild(row);
      card.appendChild(bar('bar-xp', xi ? xi.pct : 0, xi && xi.xpNext ? 'XP ' + xi.xp + '/' + xi.xpNext : tr('nível máximo')));
      card.appendChild(el('div', 'hero-stats',
        tr('<span class="s-hp">{a} PV</span><span class="s-pa">{b} PA</span><span class="s-pp">{c} PP</span>', { a: st.hp || 0, b: st.pa || 0, c: st.pp || 0 })));
      // 08/10: as cartas na mão e a próxima estrela — e o botão de subir, quando já dá
      if (info.cards > 0 || info.next) {
        var lc = el('div', 'hero-cartas' + (info.podeSubir ? ' is-pronto' : ''));
        lc.innerHTML = info.next
          ? tr('<b>{a}</b> cartas · ★{b} custa <b>{c}</b>', { a: info.cards, b: info.next.star, c: info.next.custo })
          : tr('<b>{a}</b> cartas · ★ no topo', { a: info.cards });
        card.appendChild(lc);
      }
      var acts = el('div', 'hero-acts');
      acts.appendChild(btn(tr('Ficha'), 'btn-mini', function () { openSheet('heroSheet', cid); }));
      if (info.podeSubir) {
        acts.appendChild(btn(tr('★ Subir'), 'btn-mini btn-gold hero-subir', function () {
          subirEstrela(cid, function () { buildHeroSelect(); });
        }));
      }
      var pick = btn(idx === 0 ? tr('① Avatar') : idx > 0 ? tr('② Escolhido') : tr('Escolher'),
                     'btn-mini ' + (idx >= 0 ? 'btn-primary' : ''), function () {
        var i = selHeroes.indexOf(cid);
        if (i >= 0) selHeroes.splice(i, 1);
        else if (selHeroes.length >= 2) { toast(tr('O grupo é de no máximo 2 heróis.')); return; }
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
        tr('Cartas caem dos chefes. Faltam <b>{a}</b>.', { a: Math.max(0, info.unlockCost - info.cards) })));
      var see = btn(tr('Ver na Coleção'), 'btn-mini', function () { openSheet('collection', cid); });
      card.appendChild(see);
    }
    return card;
  }

  /* SUBIR UMA ESTRELA (08/10, o dono: "quando dropar o suficiente o jogador pode ir até o personagem e
   * subir a estrela dele"): gasta as cartas do degrau (Progress.subirEstrela, que sobe como op com
   * sessão) e avisa o bônus que entrou. `depois` redesenha a tela de quem chamou. */
  function subirEstrela(cid, depois) {
    var antes = cardInfo(cid);
    if (!antes.podeSubir) { toast(tr('Ainda faltam cartas para a próxima estrela.')); return; }
    var r = safe(function () { return P().subirEstrela(cid); }, false);
    if (!r) { toast(tr('Não deu para subir a estrela agora.')); return; }
    var b = safe(function () { return (starsCfg().bonuses || {})[r.stars]; }, null) || {};
    var partes = [];
    for (var k in b) if (b.hasOwnProperty(k) && k !== 'resists') partes.push('+' + b[k] + ' ' + (STAT_PT[k] || k));
    toast(tr('★{a} de {b}! {c}', { a: r.stars, b: esc(className(cid)), c: partes.length ? partes.join(' · ') : '' }), 'good');
    if (depois) depois();
  }

  /* AS CRÔNICAS DO MUNDO ENTERRADO (07/10, js/core/cronicas.js; o dono: "quase nada do mundo chega ao jogador").
   * Na Coleção: todas, na ordem do dado — a aberta se lê no toque (e deixa de ser "nova"); a fechada mostra o
   * título e o que falta para abrir. `focusId` = a crônica que a recompensa mandou abrir. */
  function cronicasComo(c) {
    var k = c.como;
    if (!k) return '';
    if (k.tipo === 'bestiario') return tr('Complete o bestiário de {a}.', { a: esc(k.nome) });
    if (k.tipo === 'chefe') return tr('Derrube {a}.', { a: esc(k.nome) });
    if (k.tipo === 'fusoes') return tr('Vença com as 21 fusões.');
    return '';
  }
  function cronicasBloco(body, focusId) {
    var lista = safe(function () { return JOGO.Cronicas.lista(); }, []) || [];
    if (!lista.length) return;
    var abertas = lista.filter(function (c) { return c.aberta; }).length;
    body.appendChild(el('h3', 'hs-sec', tr('Crônicas do mundo enterrado') + ' <small>' + abertas + '/' + lista.length + '</small>'));
    body.appendChild(el('p', 'inv-dica', tr('A história de cada Fecho, de cada chefe e das duplas — uma crônica por feito. Toque numa aberta para ler.')));
    var gr = el('div', 'cronicas');
    lista.forEach(function (c) {
      var ln = el('div', 'cronica' + (c.aberta ? ' is-aberta' : ' is-fechada') + (c.nova ? ' is-nova' : '') + (c.id === focusId ? ' is-lendo' : ''));
      var cab = el('div', 'cronica-cab');
      cab.appendChild(el('span', 'cronica-tit', (c.aberta ? '📜 ' : '🔒 ') + esc(tr(c.titulo))));
      if (c.nova) cab.appendChild(el('span', 'chip chip-ok cronica-nova', tr('nova')));
      ln.appendChild(cab);
      if (c.aberta) {
        var tx = el('p', 'cronica-texto', esc(tr(c.texto)));
        tx.hidden = c.id !== focusId;
        ln.appendChild(tx);
        tap(cab, function () {
          tx.hidden = !tx.hidden;
          ln.classList.toggle('is-lendo', !tx.hidden);
          if (!tx.hidden && c.nova) { safe(function () { return JOGO.Cronicas.marcaVista(c.id); }, false); ln.classList.remove('is-nova'); var nv = cab.querySelector('.cronica-nova'); if (nv) nv.remove(); }
        });
        if (c.id === focusId) safe(function () { return JOGO.Cronicas.marcaVista(c.id); }, false);
      } else {
        ln.appendChild(el('p', 'cronica-como', cronicasComo(c)));
      }
      gr.appendChild(ln);
    });
    body.appendChild(gr);
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
    var who = selHeroes.map(className).join(tr(' e ')) || '—';
    s.appendChild(header(tr('Onde descer'), tr('Grupo: {a}', { a: esc(who) }), 'heroSelect'));
    var body = el('div', 'ui-body');
    var selDif = seletorDif();
    if (selDif) body.appendChild(selDif);
    var list = el('div', 'dg-list');
    body.appendChild(list);
    s.appendChild(body);

    var ds = dungeons();
    if (!ds.length) { list.appendChild(el('p', 'empty', tr('Nenhum calabouço carregado.'))); return; }
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
        esc(DIFF_PT[Math.max(0, Math.min(5, (dg.order || 0)))] || tr('Média'))));
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
        brow.appendChild(el('span', null, tr('<i>Chefe</i><b>{a}</b>', { a: esc(boss.name) })));
        txt.appendChild(brow);
      }
      txt.appendChild(btn(tr('Descer aqui'), 'btn-primary btn-block', function () {
        var ok = safe(function () { return G().startRun(selHeroes.slice(), dg.id); }, false);
        if (!ok) toast(tr('Não deu para começar essa descida.'));
      }));
      card.appendChild(txt);
      list.appendChild(card);
    });
  }

  // ==========================================================================
  // TELA: ESCOLHA DE ELEMENTO (nível 5) — a tela que explica por que importa
  // ==========================================================================
  function buildElementChoice(data) {
    lastElementChoice = data;
    var s = screens.elementChoice;
    clear(s);
    var pend = (data && data.heroIds) || safe(function () { return G().elementChoices(); }, []);
    if (!pend.length) { s.appendChild(el('p', 'empty', tr('Ninguém para escolher agora.'))); return; }
    var hid = elemChoiceHero && pend.indexOf(elemChoiceHero) >= 0 ? elemChoiceHero : pend[0];
    elemChoiceHero = hid;
    var h = hero(hid) || {};
    var def = classDef(h.classId || hid) || {};

    s.appendChild(header(tr('Escolha o caminho'), tr('{a} chegou ao nível 5. <b>A escolha é permanente — só o Pergaminho da Reescrita, da loja do site, troca um caminho depois.</b>', { a: esc(className(h.classId || hid)) })));

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
        info.appendChild(el('i', null, tr('Nv') + ' ' + ((d2 && d2.unlockLevel) || tiers[i] || '?') +
          ((d2 && d2.paCost != null) ? ' ' + tr('· {paCost} PA', { paCost: d2.paCost }) : '')));
        row.appendChild(info);
        if (d2 && d2.description) tipOn(row, d2.name, esc(d2.description), col);
        sp.appendChild(row);
      });
      if (!path.length) sp.appendChild(el('p', 'empty', tr('Caminho ainda não escrito.')));
      card.appendChild(sp);

      card.appendChild(btn(tr('Seguir {a}', { a: ELEM_PT[e] || e }), 'btn-primary btn-block', function () {
        confirmSheet(tr('Seguir o caminho de {a}?', { a: ELEM_PT[e] || e }),
          tr('É <b>irreversível</b>. A partir daqui, cada nível dá +5 PV e +3 de dano de {a} — e os feitiços acima vão abrindo com o nível.', { a: ELEM_PT[e] || e }),
          function () {
            var ok = safe(function () { return G().chooseElement(hid, e); }, false);
            if (!ok) ok = safe(function () { return P().chooseElement(hid, e); }, false);
            if (!ok) { toast(tr('Não deu para escolher agora.')); return; }
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
   * O 3D é do JOGO.Hub; aqui mora só a camada de interface: a barra com o nome,
   * os heróis escolhidos e o grupo, o pedido de nome na primeira visita, e o painel que aparece quando
   * o herói se APROXIMA de um lugar. A regra do painel é a do mundo: nada abre
   * por menu — o corpo anda até o portal, e a porta aparece quando se chega.
   */
  function buildHub(sala) {
    var s = sala ? screens.antessala : screens.hub;
    clear(s);
    var chaveSala = sala ? (sala.dungeonId + ':' + sala.roomIndex) : null;
    // 14/09: quem desce a um calabouço (a antessala) deixou o Campo de PvP — a volta é à praça
    if (sala && campoHud) campoHud.dentro = false;
    if (sala && sedeHud) sedeHud.dentro = false;      // 04/10: e a sede da guilda também
    hubEhSala = !!sala;                                // a ficha da guilda só oferece o salão a quem está na praça
    function perguntaSair() {
      // 06/10 (o dono: "essa decisão deve ser individual"): na descida de grupo sai só QUEM sai — o outro fica
      // onde está e decide por si (antes, 11/09, a descida era dos dois e sair levava os dois)
      if (descidaDeGrupo()) {
        confirmSheet(tr('Sair do calabouço?'), tr('Só você sai: {a} fica e decide por si. O grupo continua.', { a: esc(nomeParceiro()) }), function () {
          safe(function () { Gp().subir('saiu'); return true; }, null);
        });
        return;
      }
      confirmSheet(tr('Sair do calabouço?'),
        tr('O que você já limpou não fica guardado — a próxima descida começa da primeira sala.'),
        function () {
          safe(function () { return G().abandonar(); }, false);
          navTo('hub');
        });
    }

    var top = el('div', 'hub-top');
    var quem = el('div', 'hub-quem');
    var nomeEl = el('span', 'hub-nome', '…');
    quem.appendChild(nomeEl);
    /* A PRAÇA ENXUTA (06/10). O dono, com a praça no aparelho: "veja se não está muito poluída: membros do
     * grupo em cima dos botões, isso no PC também; o ícone dos membros do grupo deve ser menor... Os vinténs
     * devem mostrar somente dentro do inventário, e os personagens selecionados da conta devem ficar ao lado
     * do nome." O canto de cima à esquerda vira UM bloco em fluxo (css .screen-hub .hub-quem), de cima para
     * baixo: o nome e, na mesma linha, os cartões de vida dos heróis escolhidos (as poções logo abaixo deles);
     * os pergaminhos; e a fila do grupo (pintaGrupoLado muda o painel do grupo para cá enquanto a tela é a
     * praça). Como é fluxo, um vizinho empurra o outro: nada fica por cima de nada, e não há topo medido.
     * Os vinténs saíram do topo (praça e antessala): o saldo mora no Inventário e nas telas de compra. */
    if (!sala) {
      quem.appendChild(vidaPraca());
      // os pergaminhos da loja (Fase C): no Acampamento, onde se lê o da Sabedoria
      quem.appendChild(hubPergaminhos());
      grupoCasaPraca = quem;
    }
    top.appendChild(quem);
    var acts = el('div', 'hub-acts');
    if (sala) {
      // a placa da sala no lugar do Menu: daqui só se sai pela saída do
      // pátio ou por este botão — sempre com a pergunta
      quem.appendChild(el('span', 'hub-sala-tag', tr('{a} · sala {b}/{c} — {d}', { a: esc(sala.calabouco || ''), b: sala.roomIndex + 1, c: sala.total || '?', d: esc(sala.nome || '') })));
      acts.appendChild(btn(tr('Sair do calabouço'), 'btn-mini btn-ghost', perguntaSair));
    } else {
      // 24/10: a Loja (o saco) e o Site (o globo) ao lado do Menu — a praça é onde se passa o tempo
      acts.appendChild(botaoLoja('btn-mini btn-ghost hub-loja-bt'));
      acts.appendChild(botaoSite('btn-mini btn-ghost hub-site'));
      acts.appendChild(btn(tr('Menu'), 'btn-mini btn-ghost', function () { navTo('menu'); }));
    }
    // 12/09: o Painel do Mestre abre daqui, sem voltar ao Menu (também na batalha e na tecla M)
    if (mestreAtivo()) {
      var bGm = btn(tr('⚔ Mestre'), 'btn-mini btn-gold hub-gm', function () { alternaPainelMestre(); });
      bGm.title = tr('Painel do Mestre (M ou F9)');
      acts.insertBefore(bGm, acts.firstChild);
    }
    top.appendChild(acts);
    s.appendChild(top);

    /* OS EVENTOS DO MUNDO (10/09): a faixa do que o Mestre ligou, logo abaixo
     * do topo do Acampamento. Some quando não há nada no ar e repinta quando a
     * agenda muda — com UM ouvinte só: esta tela é remontada a cada entrada. */
    var faixaEv = sala ? null : el('div', 'hub-evento is-off');
    if (faixaEv) s.appendChild(faixaEv);
    ligaFaixaEventos(faixaEv);
    /* A CHAMADA DA LOJA (04/10): uma pílula discreta no canto direito (abaixo da dos eventos), só na praça — o Pacote de
     * Boas-Vindas para quem ainda não o comprou; senão, as ofertas da semana com o tempo que falta. */
    var chamaLj = sala ? null : el('a', 'hub-loja is-off');
    if (chamaLj) { s.appendChild(chamaLj); ligaChamadaLoja(chamaLj); }
    /* O SINO DOS AVISOS (06/10): no toque, as duas pílulas acima viram um sino só, com o selo da contagem
     * (montaSino). Entra antes da moeda de propósito: é pelo irmão que o css da moeda sabe onde ficar. */
    if (!sala) montaSino(s);
    // 08/10 (o dono: "ao logar já deve aparecer a aba do prêmio diário"): a ficha do prêmio abre sozinha
    // ao chegar à praça com o prêmio de hoje esperando — uma vez por dia nesta aba
    if (!sala) safe(function () {
      var Dd = JOGO.PremioDiario;          // 08/10 à noite: o prêmio diário (JOGO.Diario é o Calabouço do Dia)
      if (!Dd || !Dd.ler) return;
      Dd.ler().then(function (d) {
        if (!d || !d.hoje || d.hoje.resgatado || diarioAvisado === d.dia) return;
        diarioAvisado = d.dia;
        if (sheetName) return;                   // outra ficha aberta: o Quadro de Missões ainda o mostra
        openSheet('diario');
      });
    }, null);
    /* A MOEDA "PRÊMIO GRÁTIS!" (06/10): o atalho da área de prêmios, só no aplicativo (na web o
     * `JOGO.PremioAnuncio` nem existe) e só na praça. É um botão do jogo: quem o desenha, lê o que resta hoje e
     * o esconde é o js/core/premio_anuncio.js — nada de anúncio sai daqui, e a praça não é repintada por ele. */
    if (!sala && JOGO.PremioAnuncio && JOGO.PremioAnuncio.atalho) safe(function () { return JOGO.PremioAnuncio.atalho(s); }, null);

    var mundo = el('div', 'hub-mundo');
    s.appendChild(mundo);

    /* 13/09: na antessala, o quadro da vida no canto — a barra de cada herói subindo e as poções.
     * 14/09 (a vida única): na PRAÇA, o cartão de cada herói escolhido SEMPRE à vista (a foto, o
     * coração com o PV e o %, as poções para quem tem o anel — vidaPraca) — e a vida se acerta
     * com o servidor a cada chegada à praça */
    if (sala) s.appendChild(vidaBloco('antessala'));
    else pintaGrupoLado();                 // 06/10: a fila do grupo entra no bloco novo da praça já nesta montagem
    if (!sala) safe(function () { return JOGO.Vida.sincroniza(); }, null);

    var painel = el('div', 'hub-painel is-off');
    s.appendChild(painel);
    hubPainelEl = painel;          // 11/09: os convites e o painel do jogador desenham aqui
    painelModo = null; painelLugar = null; painelPar = null; painelConv = null;

    /* O CAIS (pedido do usuário, 25/08): "queria dividir o menu… pode ser um
     * menu inferior centralizado". Cada ficha com porta própria, sempre à
     * mão, à moda MMORPG — e as Missões, que moravam soltas no topo, descem
     * para cá. O painel de aproximação mora um degrau acima para não taparem
     * um ao outro (css .hub-painel). */
    var dock = el('div', 'hub-dock');
    // o cais agora ACENDE a aba aberta (30/08): sem isso, no celular o menu
    // principal não dizia onde o jogador estava
    dockBotoes = {};
    // 02/10: o ícone (ico) é o desenho do icones_ui.js — o mesmo medalhão do
    // cabeçalho da ficha que a porta abre; o emoji (ic) fica de reserva para
    // quando o icones_ui.js não carregou
    [{ ic: '🧍', ico: 'fc-personagem', rot: tr('Personagem'), abre: 'char' },
     { ic: '🎒', ico: 'fc-inventario', rot: tr('Inventário'), tecla: 'I', abre: 'inventory' },
     { ic: '📖', ico: 'fc-feiticos', rot: tr('Feitiços'), abre: 'spells' },
     { ic: '📜', ico: 'fc-missoes', rot: tr('Missões'), abre: 'missoes' },
     // 11/09: a Guilda é uma aba como as outras — SEMPRE no cais. Ela nascia
     // escondida e só aparecia se `resumoGuilda` já tivesse chegado quando a
     // conta foi pintada; como a guilda carrega por promessa, quase nunca
     // tinha. Resultado: quem ESTAVA numa guilda não via o botão dela. E
     // quem não está precisa da porta ainda mais — é por ela que se funda.
     // 04/10: fora do salão a ficha de quem tem guilda é só a PORTA (entrar
     // no salão); a gestão inteira abre lá dentro (sheetGuilda decide pelo
     // lugar onde o herói está, não por quem chamou).
     { ic: '🛡️', ico: 'fc-guilda', rot: tr('Guilda'), abre: 'guilda' },
     // 13/09 (dono): "no menu inferior deve ter uma lista de amigos e inimigos"
      { ic: '👥', ico: 'fc-amigos', rot: tr('Amigos'), abre: 'amigos' },
      // 02/10: o Eco Primordial — a porta é a ficha, não uma construção nova (o dono: "não amontoe a praça")
      { ic: '💠', ico: 'fc-eco', rot: tr('Eco'), abre: 'eco' },
      // 03/10: o Santuário dos Elementos — o calabouço especial também entra pela ficha (a praça não
      // ganha um sétimo portal). Com a 8ª porta o cais vira duas fileiras de quatro no celular (style.css)
      { ic: '🏛️', ico: 'fc-santuario', rot: tr('Santuário'), abre: 'santuario' }
    ].forEach(function (d) {
      var b = el('button', 'hub-dock-b');
      b.type = 'button';
      var svgD = safe(function () { return JOGO.IconesUI.svg(d.ico); }, '');
      var ic = el('span', 'hd-ic' + (svgD ? ' is-svg' : ''), svgD || d.ic);
      ic.setAttribute('aria-hidden', 'true');
      b.appendChild(ic);
      b.appendChild(el('span', 'hd-rot', d.rot +
        (d.tecla ? ' <span class="tecla">' + d.tecla + '</span>' : '')));
      tap(b, function () { openSheet(d.abre); });
      dock.appendChild(b);
      dockBotoes[d.abre] = b;
    });
    s.appendChild(dock);
    pintaDockGuilda();           // 06/10: sem guilda, o botão da Guilda nasce apagado (o que já se sabe da conta)

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
            }).then(function () {
              // 08/10 à noite: SEM aviso (o dono: "não quero isso"). A frase repetia a cada entrada na praça
              // porque a virada só valia na tela e o servidor a desfazia (hoje é op do juiz, autoridade.js);
              // mesmo virando uma vez só por temporada, o dono não quer o toast.
              pintaConta();
            });
            return;                       // repinta com a temporada carimbada
          }
        }
        if (!j.nome) { nomeEl.textContent = '—'; pedeNome(); }
        else {
          nomeEl.textContent = j.nome;
          // A LEI DOS NOMES (10/09): nome guardado de antes da trava que se
          // passa pela equipe do jogo pede batismo novo a cada entrada no
          // Acampamento. O Mestre do Fundo passa: o título é dele.
          if (nomeGuardadoReservado(j.nome)) {
            pedeNome(tr('esse nome é reservado à equipe do jogo — escolha outro'));
          }
        }
        // O AVATAR: a conta pode vestir uma fusão do guarda-roupa — o
        // re-entrar troca o corpo (e o guarda do laço segura o rAF único)
        // 11/09: o corpo da praça é o PRIMEIRO herói escolhido em "Quem
        // desce" — o guarda-roupa saiu, e com ele a escolha separada
        if (selHeroes[0] && JOGO.Hub && JOGO.Hub.entrar) {
          JOGO.Hub.entrar(mundo, selHeroes[0], { sala: sala });
          if (!sala) reentraCampo();    // 14/09: quem lutou no Campo volta ao Campo
          if (!sala) reentraSede();     // 04/10: e quem saiu da sede para a guerra volta ao salão
        }
        // a plaquinha: nome, título — e a COROA da arena. 04/10 (o dono: "em todos os
        // níveis deve aparecer"): quem nunca jogou a Arena carrega a Coroa I; só quem a
        // escondeu na ficha fica sem (JOGO.Brasa.coroaDe é a régua única).
        var tier = null;
        resumoCoroaOculta = j.coroaOculta === true;
        if (brasa && JOGO.Brasa) {
          // 08/10 à noite: o Mestre carrega a COROA DELE (JOGO.Brasa.MESTRE), fixa — a arte do dono
          tier = JOGO.Brasa.coroaDe(brasa.pts, brasa.partidas, souTopoDaArena(), resumoCoroaOculta, coroaDoMestre());
        }
        if (JOGO.Hub && JOGO.Hub.nomeia) {
          // o 4º arg é a GUILDA: a placa com emblema+nome acima do jogador.
          // `resumoGuilda` pode ainda não ter carregado (corrida com o
          // carregamento da guilda) — aí vai null e o refresco de quem
          // funda/entra chama nomeia de novo só com a guilda.
          // o título passa pela régua: o de ranking cai com a posição
          estadoDosTitulos().then(function () {
            JOGO.Hub.nomeia(j.nome || '', titExibe(tituloPendurado(j.titulo)), tier, resumoGuilda, molduraDaLoja() || 'auto');
          });
        }
        // O NOME ACESO (12/09): o top 1, 2 e 3 do ranking de XP anda com o nome
        // em ouro, prata e bronze. Pinta já com o que se sabe, e de novo quando
        // o ranking do servidor responder.
        if (JOGO.Hub && JOGO.Hub.medalhas) {
          var contasM = contasDoPlacar(fotos, j.id, j.nome);
          JOGO.Hub.medalhas(mapaDeMedalhas(contasM));
          rankingDoServidor().then(function (rk) {
            if (rk && JOGO.Hub && JOGO.Hub.medalhas) JOGO.Hub.medalhas(mapaDeMedalhas(contasM));
          });
        }

        // A AURA do Traje do Colecionador fechado (25/08)
        // 04/10: e a aura COMPRADA na loja, que tem a cor do elemento e vale mais que a branca
        aplicaAuraPraca();
      });
    }

    /* O NOME, pedido UMA vez. É a primeira peça de identidade pública — chat,
     * troca e PvP vão usá-lo — e pedir na entrada do acampamento (e não num
     * formulário de opções) é o que dá o cheiro de jogo online. */
    /* A LEI DOS NOMES (10/09): o nome guardado se passa pela equipe do jogo?
     * Sem js/core/nomes.js na página, nunca; o Mestre do Fundo, nunca. */
    function nomeGuardadoReservado(nome) {
      var Nm = JOGO.Nomes;
      if (!nome || !Nm || typeof Nm.reservado !== 'function') return false;
      try { if (JOGO.GM && JOGO.GM.ativo && JOGO.GM.ativo()) return false; } catch (e) {}
      return !!Nm.reservado(nome);
    }
    /* `aviso` (opcional) diz por que o nome voltou a ser pedido; a recusa do
     * batismo mostra o MOTIVO que o core devolveu (reservado, caractere,
     * tamanho) — antes dizia sempre "Diz um nome.". */
    function pedeNome(aviso) {
      clear(painel);
      painel.classList.remove('is-off');
      painelModo = 'nome';
      painel.appendChild(el('h3', null, tr('Como te chamam no fundo?')));
      if (aviso) painel.appendChild(el('p', 'hub-nota hub-nome-aviso', esc(aviso)));
      var inp = document.createElement('input');
      inp.className = 'hub-input';
      inp.maxLength = (JOGO.Nomes && JOGO.DB.NOME_MAX) || 24;   // a régua da conta: 3 a 20
      inp.placeholder = tr('seu nome no acampamento');
      painel.appendChild(inp);
      painel.appendChild(btn(tr('É assim que me chamam'), 'btn-primary btn-block', function () {
        JOGO.DB.batizar(inp.value).then(function (r) {
          if (!r.ok) { toast(r.erro || tr('Diz um nome.')); return; }
          painel.classList.add('is-off');
          pintaConta();
        });
      }));
      setTimeout(function () { try { inp.focus(); } catch (e) {} }, 60);
    }

    /* 02/10: o título do painel de aproximação leva o MESMO medalhão da
     * ficha que o botão abre (o baú no banco, o poço no Poço) — o painel e a
     * ficha passam a ser a mesma porta. Sem o icones_ui.js, só o texto. */
    function tituloPainel(texto, ico) {
      var h = el('h3', 'hp-tit', esc(texto));
      var svg = safe(function () { return JOGO.IconesUI.svg(ico); }, '');
      if (svg) {
        var m = el('span', 'hp-ico', svg);
        m.setAttribute('aria-hidden', 'true');
        h.insertBefore(m, h.firstChild);
      }
      return h;
    }
    if (JOGO.Hub) JOGO.Hub.aoAproximar = function (lugar) {
      // 11/09: o convite (grupo/duelo) em aberto não some por um passo
      if (painelModo === 'convite' && !painel.classList.contains('is-off')) return;
      if (!lugar) { painel.classList.add('is-off'); painelModo = null; painelLugar = null; return; }
      clear(painel);
      painel.classList.remove('is-off');
      painelModo = 'lugar';
      painelLugar = lugar;
      if (lugar.tipo === 'portal' && lugar.fechado) {
        // 08/09: o portal trancado — sem descida; as peças dele caem nos abertos
        painel.appendChild(el('h3', null, esc(lugar.nome)));
        painel.appendChild(el('p', 'hub-nota', tr('<b style="color:#ff8a8a">Portal fechado</b> — este calabouço ainda está sendo escavado. Enquanto isso, as peças dele aparecem nos calabouços abertos.')));
      } else if (lugar.tipo === 'portal') {
        painel.appendChild(el('h3', null, esc(lugar.nome)));
        // O CALABOUÇO DO DIA (25/08): o portal em promoção se anuncia
        var ehDia = !!(JOGO.Diario && JOGO.Diario.ehHoje && JOGO.Diario.ehHoje(lugar.id));
        if (ehDia) {
          // 10/09: o número vem do Diario — era um "+50%" escrito à mão
          painel.appendChild(el('p', 'hub-dia',
            tr('☀ <b>Calabouço do dia</b> — +{a}% de saque até a meia-noite', { a: Math.round((JOGO.Diario.BONUS_DROP - 1) * 100) })));
          // 07/10: o AFIXO do dia — a regra a mais com que as salas de hoje abrem (js/core/afixos.js)
          var afxP = afixoDe(safe(function () { return G().afixoDaSala ? G().afixoDaSala(lugar.id) : null; }, null));
          if (afxP) painel.appendChild(linhaAfixo(afxP));
        }
        // OS EVENTOS DO MUNDO que valem AQUI (10/09): os gerais e os deste portal
        linhasEventoPortal(lugar.id, ehDia).forEach(function (p) { painel.appendChild(p); });
        if (emGrupo()) painelPortalGrupo(painel, lugar);   // 11/09: quem lidera desce com o outro
        else {
          var sd = seletorDif();
          if (sd) painel.appendChild(sd);
          painel.appendChild(btn(tr('Descer'), 'btn-primary btn-block', function () {
            var ok = safe(function () { return G().startRun(selHeroes.slice(), lugar.id); }, false);
            if (!ok) toast(tr('Não deu para começar essa descida.'));
          }));
        }
      } else if (lugar.tipo === 'porta') {
        // A PORTA DA SALA (03/09): "seguir para a batalha (que mostrará os
        // monstros ao confirmar)" — quem espera, a dificuldade, e a entrada
        painel.appendChild(el('h3', null, esc((sala && sala.nome) || tr('A sala'))));
        var lista = el('div', 'sala-monstros');
        ((sala && sala.monstros) || []).forEach(function (m) {
          var c = el('div', 'sala-monstro' + (m.boss ? ' is-boss' : ''));
          c.appendChild(art('unit', [m.id, { element: m.element || 'neutro', dir: 0, scale: 0.5 }], 44));
          c.appendChild(el('span', null, esc(m.name) + (m.qtd > 1 ? ' ×' + m.qtd : '') +
            (m.boss ? ' — <b>chefe</b>' : '')));
          lista.appendChild(c);
        });
        if (!lista.childNodes.length) lista.appendChild(el('p', 'hub-nota', tr('Ninguém à vista… ainda.')));
        painel.appendChild(lista);
        // 07/10: a sala do Calabouço do Dia (ou o caminho escuro pedido) diz o afixo dela ANTES de a luta começar —
        // lido AO VIVO do Game: o `sala` daqui é a foto da chegada à antessala, e a escolha da porta muda depois
        var afxPorta = afixoDe(safe(function () { return G().afixoDaSala ? G().afixoDaSala(sala && sala.dungeonId) : null; }, null) || (sala && sala.afixo));
        if (afxPorta) painel.appendChild(linhaAfixo(afxPorta, safe(function () { return !!G().escuroDaSala(); }, false)));
        // 03/10: a sala do Santuário diz a regra dela ANTES de a luta começar
        if (sala && sala.regra) {
          var regrasPorta = sala.regra === 'altar' ? ['fogo', 'agua', 'terra', 'ar'] : [sala.regra];
          var cxR = el('div', 'sant-porta');
          regrasPorta.forEach(function (rg) {
            var t = SANT_REGRA[rg];
            if (!t) return;
            var ln = el('p', 'sant-porta-ln', '<b>' + esc(t.curto) + ':</b> ' + t.resumo);
            ln.style.setProperty('--ec', elemColor(rg));
            cxR.appendChild(ln);
          });
          painel.appendChild(cxR);
        }
        if (descidaDeGrupo()) painelPortaGrupo(painel);     // 11/09: a porta em grupo (06/10: só na descida DE grupo)
        else {
          var sd2 = seletorDif();
          if (sd2) painel.appendChild(sd2);
          blocoDescanso(painel);             // 08/10 à noite: as salas com XP em dobro que ainda há hoje
          blocoEscuro(painel);               // 07/10: o caminho escuro, da segunda sala em diante
          // 13/09: a vida na porta; herói a 0 PV apaga o botão e diz quanto falta (vidaTique)
          painel.appendChild(vidaBloco('porta'));
          var bEntrar = btn(tr('Entrar na batalha'), 'btn-primary btn-block vida-porta', function () {
            var ev = safe(function () { return G().esperaVida(); }, null);
            if (ev) { toast(tr('{a} — ou beba uma poção.', { a: textoEsperaVida(ev) })); return; }
            if (!safe(function () { return G().entrarNaSala(); }, false)) toast(tr('Não deu para entrar na sala.'));
          });
          bEntrar.setAttribute('data-rotulo', tr('Entrar na batalha'));
          painel.appendChild(bEntrar);
          vidaTique();
        }
      } else if (lugar.tipo === 'saida') {
        painel.appendChild(el('h3', null, tr('Sair do calabouço')));
        painel.appendChild(el('p', 'hub-nota',
          tr('A descida se perde: da próxima vez você começa da primeira sala.')));
        painel.appendChild(btn(tr('Sair'), 'btn-warn btn-block', perguntaSair));
      } else if (lugar.tipo === 'banco') {
        painel.appendChild(tituloPainel(tr('Banco do Acampamento'), 'fc-banco'));
        painel.appendChild(el('p', 'hub-nota',
          tr('O que está no cofre não desce com você — e por isso nunca se perde.')));
        painel.appendChild(btn(tr('Abrir o cofre'), 'btn-primary btn-block', function () {
          openSheet('banco');
        }));
      } else if (lugar.tipo === 'mercado') {
        painel.appendChild(tituloPainel(tr('Mercadinho do Acampamento'), 'fc-mercado'));
        painel.appendChild(el('p', 'hub-nota',
          tr('Peças à venda — só o que jogador anunciou. Toda venda sua paga 5% de taxa.')));
        painel.appendChild(btn(tr('Abrir o balcão'), 'btn-primary btn-block', function () {
          openSheet('mercado');
        }));
      } else if (lugar.tipo === 'arena') {
        /* O PAINEL DA ARENA LIMPO (10/10; o dono, com a foto do painel: "está bem confuso isso, e o duelo de treino
         * (mesmo teclado) pode sair; arrume esse menu da Arena"). Eram um parágrafo comprido, dois botões, três
         * linhas de torneio, outro botão dourado, o treino e o placar, tudo com o mesmo peso. Agora são DOIS blocos
         * com nome — o Ranqueado (a coroa) e o Torneio (só o PRÓXIMO, numa linha) — e o placar num botão discreto
         * no pé, já com a conta dos duelos. O duelo de treino no mesmo teclado saiu do painel (o jogo é online). */
        painel.appendChild(tituloPainel(tr('Arena'), 'fc-duelo'));
        painel.classList.add('arena-painel');
        painelArena(painel);          // 14/09: o quadro de inscritos da Arena
        painelTorneio(painel);        // 10/10: o Torneio da Arena
        // 11/09 (revisão): a volta para a ficha do duelo pela Rede que ficou para trás
        var deA = safe(function () { return Dl().estado(); }, null);
        if (deA && (deA.fase === 'escolhendo' || deA.fase === 'comprometido' || deA.fase === 'revelado')) {
          painel.appendChild(btn(tr('Voltar à escolha do duelo'), 'btn-gold btn-block', function () { openSheet('dueloRede'); }));
        }
        var bPlacar = btn(tr('Ver o Placar'), 'btn-ghost btn-block arena-placar', function () { openSheet('placar'); });
        painel.appendChild(bPlacar);
        if (JOGO.DB) JOGO.DB.historicoPvp().then(function (h) {
          if (h.length && bPlacar.isConnected) bPlacar.textContent = tr('Ver o Placar · {n} duelo(s)', { n: h.length });
        });
        painel.appendChild(el('p', 'hub-nota arena-dica', tr('Desafio amistoso: toque em alguém na praça.')));
      } else if (lugar.tipo === 'poco') {
        // O POÇO SEM FUNDO (25/08; 13/09 saiu da Arena e ganhou a arte do dono)
        painel.appendChild(tituloPainel(tr('Poço sem Fundo'), 'fc-poco'));
        painel.appendChild(el('p', 'hub-nota',
          tr('A torre infinita: cada andar é uma sala emprestada dos calabouços, e cada andar a mais deixa os monstros mais duros.')));
        if (emGrupo()) {
          // 07/10: o Poço desce em grupo como os seis portais — o andar nasce da semente da ata
          painelPortalGrupo(painel, { id: 'poco' });
        } else painel.appendChild(btn(tr('Descer ao Poço sem Fundo'), 'btn-warn btn-block', function () {
          if (!selHeroes.length) { toast(tr('Escolha sua dupla primeiro.')); return; }
          if (!safe(function () { return G().startPoco(selHeroes.slice()); }, false)) {
            toast(tr('O Poço não abriu.'));
          }
        }));
        if (JOGO.DB.pocoVer) JOGO.DB.pocoVer().then(function (pv) {
          if (pv && (pv.recorde > 0 || pv.semanaMelhor > 0)) {
            painel.appendChild(el('p', 'hub-nota', tr('Poço: andar <b>{semanaMelhor}</b> na semana · recorde <b>{recorde}</b>.', { semanaMelhor: pv.semanaMelhor, recorde: pv.recorde })));
          }
        });
      } else if (lugar.tipo === 'sede') {
        painel.appendChild(tituloPainel(tr('Sede das Guildas'), 'fc-guilda'));
        /* 04/10 (dono: "quando chegar na sede só deve perguntar de entrar no salão ou se inscrever
         * para batalha; o restante fica dentro do salão"). Quem TEM guilda vê só as duas ações: a
         * porta do salão e a fila da guerra 2×2. A ficha (membros, mural, cofre, banco, governo) não
         * abre mais daqui — mora no salão. Quem NÃO tem guilda não tem salão nem guerra: para ele a
         * Sede segue sendo o lugar de fundar uma guilda ou entrar numa. */
        if (resumoGuilda) {
          painel.appendChild(el('p', 'hub-nota',
            tr('O salão da sua guilda fica atrás desta porta: lá dentro estão os membros, o mural, o cofre, o banco e o trono.')));
          painel.appendChild(btn(tr('Entrar no salão'), 'btn-primary btn-block sede-entrar', pedeEntrarNaSede));
          painelGuerra(painel);       // 15/09: a guerra de guilda 2×2 (a fila, os quatro confirmando)
        } else {
          painel.appendChild(el('p', 'hub-nota',
            tr('O estandarte dos clãs. Você ainda não é de uma guilda: funde a sua ou entre numa que esteja de porta aberta.')));
          painel.appendChild(btn(tr('Fundar ou entrar numa guilda'), 'btn-primary btn-block sede-fundar', function () {
            openSheet('guilda', 'sede');      // 06/10: só a Sede abre a ficha de fundar/entrar (guildaPelaSede)
          }));
        }
      } else if (/^sede-/.test(lugar.tipo)) {
        painelSedeDentro(painel, lugar.tipo, tituloPainel);   // 04/10: os seis pontos do salão da guilda
      } else if (lugar.tipo === 'loteria') {
        // A BARRAQUINHA DA SORTE (03/09): a roleta dos selos mora aqui
        painel.appendChild(tituloPainel(tr('Barraquinha da Sorte'), 'fc-loteria'));
        var sl = safe(function () { return P().roletaSaldo(); }, null);
        painel.appendChild(el('p', 'hub-nota', sl
          ? (sl.giros > 0 ? tr('<b>{total}</b> selos no bolso — <b>{giros}</b> giro(s) da sorte.', { total: sl.total, giros: sl.giros })
                          : tr('<b>{total}</b> selos no bolso — faltam <b>{faltam}</b> para um giro.', { total: sl.total, faltam: sl.faltam }))
          : tr('A roleta do Traje do Colecionador.')));
        painel.appendChild(btn(tr('Girar a sorte'), 'btn-primary btn-block', function () {
          openSheet('loteria');
        }));
      } else if (lugar.tipo === 'campo') {
        painelCampo(painel);          // 14/09: a entrada do Campo de PvP
      } else if (lugar.tipo === 'campo-saida') {
        painelCampoSaida(painel);     // 14/09: a saída do Campo (e a troca da dupla)
      } else if (lugar.tipo === 'forja') {
        // A BARRACA DO FERREIRO (30/08): a forja ganhou endereço na praça —
        // a bigorna continua no cais para quem prefere o atalho
        painel.appendChild(tituloPainel(tr('Forja do Acampamento'), 'fc-forja'));
        painel.appendChild(el('p', 'hub-nota',
          tr('Ponha a peça na bancada, a pedra do elemento ao lado — e bata o martelo.')));
        painel.appendChild(btn(tr('Chegar na bancada'), 'btn-primary btn-block', function () {
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
    /* 08/10 à noite, A PLATEIA (o dono: "drop raro, gema com +1 PA, coroa nova: anunciar no chat da praça com o
     * nome de quem conseguiu; inveja saudável é o motor de MMO"): a frase de cada feito, com os nomes do DATA (já
     * no idioma de quem lê). O texto vai cru: chatLinha escapa. */
    function frasePlateia(ev) {
      var d = ev.dados || {}, D0 = JOGO.DATA || {}, nome = ev.nome;
      if (ev.feito === 'drop') {
        var it = D0.items && D0.items[d.itemId];
        var dg = null;
        (D0.dungeons || []).forEach(function (x) { if (x && x.id === d.dungeon) dg = x; });   // o DATA.dungeons é lista
        if (!it) return '';
        var rar = d.raridade === 'lendario' ? tr('lendária') : tr('épica');
        return dg ? tr('{nome} achou {item} ({rar}) em {portal}!', { nome: nome, item: it.name, rar: rar, portal: dg.name || d.dungeon })
                  : tr('{nome} achou {item} ({rar})!', { nome: nome, item: it.name, rar: rar });
      }
      if (ev.feito === 'gema') {
        var it2 = D0.items && D0.items[d.itemId];
        return it2 ? tr('{nome} engastou uma Gema de +1 PA em {item}!', { nome: nome, item: it2.name })
                   : tr('{nome} engastou uma Gema de +1 PA!', { nome: nome });
      }
      if (ev.feito === 'coroa') {
        var T = (JOGO.Brasa && JOGO.Brasa.TIERS) || [];
        var t = T[Math.max(0, Math.min(T.length - 1, Math.floor(Number(d.nivel) || 1) - 1))];
        return t ? tr('{nome} chegou à {coroa} na Arena!', { nome: nome, coroa: t.nome }) : '';
      }
      // 10/10: o campeão do Torneio da Arena — o nome do torneio sai do tipo e da faixa (o título só vale no do Mestre)
      if (ev.feito === 'torneio') {
        var fx = /^(\d+)-(\d+)$/.exec(String(d.faixa || ''));
        var qual = d.tipo === 'guilda' ? tr('Torneio das Guildas')
                 : fx ? tr('Torneio de PvP · nível {a} a {b}', { a: fx[1], b: fx[2] }) : tr('Torneio da Arena');
        return (d.tipo === 'guilda' && d.guilda)
          ? tr('🏆 {guilda} venceu o {torneio} — {nome} lutou por ela!', { guilda: String(d.guilda), torneio: qual, nome: nome })
          : tr('🏆 {a} venceu o {b}!', { a: nome, b: qual });
      }
      return '';
    }
    function chatLinha(quem, texto, cor, de, classe) {
      if (!chatLog) return;
      var li = el('div', 'hub-chat-linha' + (classe ? ' ' + classe : ''));
      // 02/10: a linha de OUTRO jogador leva quem falou — o toque longo / clique direito denuncia (js/ui/moderacao.js)
      if (de) { li.setAttribute('data-de', de); li.setAttribute('data-nome', quem || ''); }
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
          // 06/10: outra conta — o que se sabia da guilda era da de antes; o cais volta a "não se sabe"
          if (guildaLidaDe !== j2.id) { guildaLidaDe = j2.id; guildaLida = false; pintaDockGuilda(); }
          JOGO.Guilda.contaAtiva(j2.id, j2.nome || tr('Sem Nome'));
          return JOGO.Guilda.minha();
        }).then(function (mg) {
          // 04/10: a leitura que FALHOU (servidor fora) não é "sem guilda": fica o que a tela já sabia
          if (!mg && JOGO.Guilda.falhaDaFicha && JOGO.Guilda.falhaDaFicha()) return;
          resumoGuilda = mg ? { nome: mg.nome, emblema: mg.emblema } : null;
          guildaSoube();
          // a plaquinha pode ter sido pendurada ANTES desta resposta — a
          // corrida de sempre. Os undefined preservam nome/título/coroa.
          if (resumoGuilda && JOGO.Hub && JOGO.Hub.nomeia) {
            try { JOGO.Hub.nomeia(undefined, undefined, undefined, resumoGuilda); } catch (e) {}
          }
          // e a Rede também: sem isto o meu clã só existia na MINHA tela
          reanunciaPerfil();
        });
      }
      /* O CARTÃO QUE VIAJA (12/09). Era montado inline, uma vez, no `R.entrar`
       * — e aí estava o defeito que o dono viu com duas janelas abertas: "a
       * guild de um não aparece para o outro". A guilda carrega por promessa
       * e quase sempre chega DEPOIS do `entrar`, então o resumo que os outros
       * recebiam ia sem ela: a minha plaquinha mostrava o clã (Hub.nomeia é
       * local) e o meu fantasma na tela do vizinho, não. O mesmo valia para
       * título e coroa.
       * Agora o cartão é uma função e `reanunciaPerfil()` o manda de novo —
       * `R.entrar` com o MESMO id cai em `atualiza` na rede.js, que é
       * exatamente o "mudei de roupa, avisa todo mundo". Quem funda, entra
       * ou sai de guilda, e quem troca de título, chama. */
      function cartaoDaRede(j) {
        var e0 = (JOGO.Hub._estado && JOGO.Hub._estado()) || {};
        var pos = e0.pos || { x: 0, z: 9 };
        return { id: j.id, nome: j.nome || tr('Sem Nome'),
                 titulo: tituloPendurado(j.titulo),
                 // `classe` no protocolo sempre foi APARÊNCIA — agora pode ser
                 // uma fusão do guarda-roupa; o fantasma do outro lado veste igual
                 // 14/09: no Campo de PvP, a aparência do 1º da dupla do Campo (o 2º não viaja)
                 classe: aparenciaDaRede(),
                 resumo: safe(resumoDaConta, null),
                 aura: safe(temAuraSelos, false),
                 auraCor: auraDaLoja(),    // 04/10: a aura comprada (o relé confere no banco e carimba)
                 moldura: molduraDaLoja() || 'auto',   // 08/10: a moldura premium (idem)
                 sala: chaveSala,          // 03/09: a antessala (null = praça)
                 x: pos.x, z: pos.z };
      }
      reanunciaPerfil = function () {
        if (!JOGO.DB || !R || !R.entrar) return;
        JOGO.DB.jogador().then(function (j) {
          try { R.entrar(cartaoDaRede(j)); } catch (e) {}
        });
      };
      JOGO.DB.jogador().then(function (j) {
        var ligou = R.entrar(cartaoDaRede(j));
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
          // 14/09 (o dono): no Campo de PvP "ao clicar em cima o jogador pode atacar sem aviso prévio" — sem menu
          if (campoDentro()) { ataqueNoCampo(par); return; }        // 08/10 à noite: com a pergunta "Atacar?"
          painelJogador(par);
        };
        /* O PAINEL DO JOGADOR (11/09, pedido do dono): retrato, nome e título,
         * e os gestos numa grade de 2 colunas — perfil, mensagem particular,
         * grupo e duelo (só na praça), troca, guilda (só quem lidera a
         * guilda) e silêncio. Na antessala, sem grupo nem duelo. */
        function painelJogador(par) {
          // 11/09 (revisão): o convite em aberto (grupo, duelo ou troca) não some por
          // um toque noutra pessoa — no celular se anda tocando o chão da praça, e o
          // convite de 30 s sumia da tela sem volta (quem chamou via "expirou")
          if (painelModo === 'convite' && !painel.classList.contains('is-off')) { toast(tr('Responda o convite antes.')); return; }
          var id = par.id;
          clear(painel);
          painel.classList.remove('is-off');
          painelModo = 'jogador';
          painelPar = par;
          function fecha() { painel.classList.add('is-off'); painelModo = null; }
          var pg = parceiroG();
          var ehMeuPar = !!(pg && pg.id === id);
          cabecalhoPainel(painel, par.classe || 'sumo', 'neutro',
            esc(par.nome) + (par.titulo ? ' <i class="hub-tit">' + esc(titExibe(par.titulo)) + '</i>' : ''),
            ehMeuPar ? (souLider() ? tr('◆ no seu grupo') : tr('♛ lidera o seu grupo')) : '');
          var grade = el('div', 'pn-grade');
          grade.appendChild(btn(tr('Ver perfil'), 'btn-primary', function () {
            fecha();
            openSheet('perfil', par);
          }));
          var pode = !!safe(function () { return Su().pode(); }, false);
          var bMsg = btn(tr('Mensagem particular'), 'btn-ghost' + (pode ? '' : ' is-apagado'), function () {
            if (!pode) { toast(textoMotivo('privado', null)); return; }
            fecha();
            armaSussurro(id, par.nome);
          });
          if (!pode) bMsg.title = tr('precisa do servidor da Rede');
          grade.appendChild(bMsg);
          if (!sala && Gp()) {
            var cheio = (grupoEstado() || {}).fase === 'formado';
            // 11/09 (pedido do dono): o Mestre entra em grupo, mas só ele chama — no painel dele o botão avisa
            var soMestre = par.mestre === true && !ehMeuPar &&
                           !safe(function () { return JOGO.GM && JOGO.GM.ativo && JOGO.GM.ativo(); }, false);
            grade.appendChild(btn(ehMeuPar ? tr('Já está no seu grupo')
                                           : (soMestre ? tr('Só o Mestre chama para o grupo') : (cheio ? tr('Você já está num grupo') : tr('Chamar para o grupo'))),
              'btn-ghost' + ((cheio || soMestre) ? ' is-apagado' : ''), function () {
                if (soMestre) { toast(textoMotivo('so-mestre-chama', null)); return; }
                if (cheio) { toast(ehMeuPar ? tr('{nome} já está no seu grupo.', { nome: par.nome }) : textoMotivo('em-grupo', null)); return; }
                retiraMeusPedidos();
                var r = safe(function () { return Gp().convidar(id); }, null);
                if (r && r.ok) { fecha(); toast(tr('Convite enviado a {nome}. Esperando a resposta…', { nome: par.nome })); }
                else toast(textoMotivo(r ? r.motivo : 'ocupado', null));
              }));
          }
          if (!sala && Dl()) {
            grade.appendChild(btn(tr('Desafio amistoso'), 'btn-ghost', function () {   // 14/09: o duelo na praça, sem coroa
              retiraMeusPedidos();
              var r = safe(function () { return Dl().desafiar(id); }, null);
              if (r && r.ok) { fecha(); toast(tr('Desafio enviado a {nome}. Esperando a resposta…', { nome: par.nome })); }
              else toast(textoMotivo(r ? r.motivo : 'ocupado', null));
            }));
          }
          if (JOGO.Troca) {
            grade.appendChild(btn(tr('Propor troca'), 'btn-ghost', function () {
              fecha();
              retiraMeusPedidos();
              // 06/10: a espera mora no cartão do pedido (com o tempo e o Cancelar), não mais numa ficha que,
              // fechada, deixava a troca de pé sem tela; a mesa abre sozinha quando o outro aceita
              if (JOGO.Troca.convidar(id)) toast(tr('Convite de troca enviado. Esperando o outro lado…'));
              else toast(tr('já há uma troca aberta'));
            }));
          }
          // 13/09 (dono): amigos e inimigos — pela CONTA conferida na praça (o `nuvem`)
          var Am = JOGO.Amigos;
          if (Am && Am.pode() && typeof par.nuvem === 'number') {
            var ehAm = Am.ehAmigo(par.nuvem), ehIn = Am.ehInimigo(par.nuvem);
            grade.appendChild(btn(ehAm ? tr('Tirar dos amigos') : tr('Adicionar amigo'), 'btn-ghost', function () {
              fecha();
              Am.definir({ conta: par.nuvem }, ehAm ? null : 'amigo').then(function (r) {
                toast(r.ok ? (ehAm ? tr('{nome} saiu dos amigos.', { nome: par.nome }) : tr('{nome} agora é seu amigo.', { nome: par.nome }))
                           : (r.erro || tr('não deu')), r.ok ? 'good' : undefined);
              });
            }));
            grade.appendChild(btn(ehIn ? tr('Tirar dos inimigos') : tr('Marcar inimigo'), 'btn-ghost', function () {
              fecha();
              Am.definir({ conta: par.nuvem }, ehIn ? null : 'inimigo').then(function (r) {
                toast(r.ok ? (ehIn ? tr('{nome} saiu dos inimigos.', { nome: par.nome })
                                   : tr('{nome} é seu inimigo: sem mensagem particular nem troca.', { nome: par.nome }))
                           : (r.erro || tr('não deu')), r.ok ? 'good' : undefined);
              });
            }));
          }
          var mudo = !!mutados[id];
          var bSil = btn(mudo ? tr('Devolver a voz') : tr('Silenciar'), 'btn-ghost', function () {
            mutados[id] = !mudo;
            if (JOGO.DB.mutar) JOGO.DB.mutar(id, par.nome, !mudo);
            safe(function () { Gp().mutado(id, !mudo); return true; }, null);
            toast(!mudo ? par.nome + ' silenciado.' : tr('{nome} de volta ao chat.', { nome: par.nome }));
            fecha();
          });
          grade.appendChild(bSil);
          // 02/10: denunciar à Equipe, pela conta conferida (js/ui/moderacao.js)
          if (JOGO.Denuncia) grade.appendChild(JOGO.Denuncia.botao({ conta: par.nuvem, nome: par.nome, heroId: id, onde: 'praca' }, fecha));
          grade.appendChild(btn(tr('Fechar'), 'btn-ghost', fecha));
          painel.appendChild(grade);
          // CONVIDAR PARA A GUILDA (25/08): só quem lidera a guilda vê o botão
          if (JOGO.Guilda) {
            JOGO.Guilda.minha().then(function (mg) {
              // 11/09: líder e oficiais convidam (os mesmos que aceitam pedidos)
              if (!mg || !(mg.souLider || mg.meuCargo === 'oficial') || painel.classList.contains('is-off') || !grade.isConnected) return;
              grade.insertBefore(btn(tr('Convidar para a {a}', { a: esc(txtGuilda(mg.emblema, mg.nome)) }),
                'btn-ghost pn-largo', function () {
                  fecha();
                  // 11/09: com a guilda no servidor, o convite é da CONTA dela (a que o relé
                  // conferiu, o `nuvem` da presença) — sem ele o "aceitar" do outro lado não entra
                  JOGO.Guilda.convidar(par.nuvem).then(function (rc) {
                    if (!rc || !rc.ok) { toast((rc && rc.erro) || tr('não deu para convidar')); return; }
                    R.guildaManda(id, 'convite', { gid: mg.id, nome: mg.nome, emblema: mg.emblema });
                    toast(tr('Convite de guilda enviado.'));
                  });
                }), bSil);
            });
          }
        }
        painelJogadorFn = painelJogador;

        R.aoEvento = function (ev) {
          if (ev.tipo === 'troca' && JOGO.Troca) {
            JOGO.Troca.aoEvento(ev);
            return;
          }
          // O CONVITE DE GUILDA (25/08): chega pela praça, decide-se no painel
          if (ev.tipo === 'guilda') {
            if (ev.acao === 'convite' && ev.dados && JOGO.Guilda) {
              // 06/10: o convite de guilda vai para o cartão dos pedidos — desenhado no painel da praça, ele
              // sumia na primeira remontagem dela, como o de grupo. Vale 60 s na tela (o convite em si fica
              // no servidor: quem perdeu o cartão ainda entra pela Sede)
              conviteGuilda = { de: ev.de, nome: ev.nome, guilda: txtGuilda(ev.dados.emblema, ev.dados.nome || '?'),
                                chave: String(ev.de) + ':' + String(ev.dados.gid), expira: Date.now() + 60000 };
              conviteGuilda.recusa = function () { R.guildaManda(ev.de, 'resposta', { ok: false }); };
              conviteGuilda.aceita = function () {
                // 11/09: é o CONVITE que abre a porta (antes o entrar batia na porta fechada)
                JOGO.Guilda.entrar(ev.dados.gid, { convite: true }).then(function (res) {
                  toast(res.ok ? tr('Bem-vindo à {nome}!', { nome: ev.dados.nome }) : (res.erro || tr('não deu')),
                        res.ok ? 'good' : undefined);
                  if (res.ok && res.guilda) {               // a placa da guilda sobe na hora
                    resumoGuilda = { nome: res.guilda.nome, emblema: res.guilda.emblema };
                    guildaSoube();
                    reanunciaPerfil();          // o clã novo aparece para todos
                    if (JOGO.Hub && JOGO.Hub.nomeia) {
                      try { JOGO.Hub.nomeia(undefined, undefined, undefined, resumoGuilda); } catch (e) {}
                    }
                  }
                  R.guildaManda(ev.de, 'resposta', { ok: !!res.ok });
                });
              };
              pintaPedido();
            } else if (ev.acao === 'resposta') {
              toast(ev.dados && ev.dados.ok ? tr('{nome} entrou na guilda!', { nome: ev.nome })
                                            : tr('{nome} recusou o convite.', { nome: ev.nome }));
            }
            return;
          }
          if (ev.tipo === 'entrou') {
            // só quem está NA MESMA SALA ganha corpo (03/09); os outros ficam
            // no papel, na lista da Rede
            if ((ev.sala || null) !== chaveSala) return;
            JOGO.Hub.fantasmaEntra(ev.id, ev);
            chatLinha(null, ev.nome + (chaveSala ? tr(' chegou à sala.') : tr(' chegou ao acampamento.')));
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
              // 14/09: a mesma sala, outra zona (entrou ou saiu do Campo de PvP): o Hub mostra só a zona dele
              if (typeof JOGO.Hub.fantasmaZona === 'function') {
                safe(function () { return JOGO.Hub.fantasmaZona(ev.id, ev.zona || 'praca'); }, null);
              }
              chatLinha(null, ev.nome + (chaveSala ? tr(' chegou à sala.') : tr(' voltou ao acampamento.')));
            } else {
              JOGO.Hub.fantasmaSai(ev.id);
            }
          } else if (ev.tipo === 'mudouCoroa') {
            // 05/10: escondeu/mostrou a coroa, ou o Mestre trocou a dele — só a plaquinha repinta
            if (typeof JOGO.Hub.fantasmaCoroa === 'function') {
              safe(function () { return JOGO.Hub.fantasmaCoroa(ev.id, ev.resumo, ev.mestre === true); }, null);
            }
          } else if (ev.tipo === 'mudouVisual') {
            // 08/10: trocou de título, de aura ou de moldura sem sair do lugar — a plaquinha e a aura repintam
            if (typeof JOGO.Hub.fantasmaVisual === 'function') {
              safe(function () { return JOGO.Hub.fantasmaVisual(ev.id, ev); }, null);
            }
            if (JOGO.DB.placarAnota && ev.titulo !== undefined) {
              safe(function () { return JOGO.DB.placarAnota(ev.id, { titulo: ev.titulo }); }, null);
            }
          } else if (ev.tipo === 'alvo') {
            JOGO.Hub.fantasmaAlvo(ev.id, ev.x, ev.z);
          } else if (ev.tipo === 'pulso') {
            JOGO.Hub.fantasmaPulso(ev.id, ev.x, ev.z);
          } else if (ev.tipo === 'gchat') {
            // 13/09: o chat da guilda (/g) — só os membros recebem (o relé confere)
            if (mutados[ev.id]) return;
            chatLinha('[' + (ev.guilda || tr('Guilda')) + '] ' + ev.nome, R.filtra ? R.filtra(ev.texto) : ev.texto, '#7fc8ff', ev.id);
            // 04/10: no salão a fala da guilda também sai em balão, sobre quem falou
            if (sedeDentro()) safe(function () { return JOGO.Hub.fala(ev.id, R.filtra ? R.filtra(ev.texto) : ev.texto); }, null);
            safe(function () { return JOGO.Denuncia && JOGO.Denuncia.anota(ev.id, ev.nome, ev.texto); }, null);
          } else if (ev.tipo === 'gchat-nao') {
            toast(ev.motivo === 'sem-guilda' ? tr('Você não está numa guilda: o /g não tem para quem ir.')
                                             : tr('O chat da guilda precisa que você esteja na sua conta.'));
          } else if (ev.tipo === 'plateia') {
            var fraseP = frasePlateia(ev);               // 08/10 à noite: a plateia no chat
            if (fraseP) chatLinha(null, '✦ ' + fraseP, null, null, 'is-plateia');
          } else if (ev.tipo === 'chat') {
            if (mutados[ev.id]) return;               // silenciado: nem uma linha
            var textoC = R.filtra ? R.filtra(ev.texto) : ev.texto;
            chatLinha(ev.nome, textoC, null, ev.id);
            // 02/10: o que ESTE jogador viu vai anexado à denúncia (o servidor não guarda o chat)
            safe(function () { return JOGO.Denuncia && JOGO.Denuncia.anota(ev.id, ev.nome, ev.texto); }, null);
            // 11/09 (pedido do dono): a frase sobe num balão em cima de quem falou
            safe(function () { return JOGO.Hub.fala(ev.id, textoC); }, null);
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
        // 11/09: a MENSAGEM PARTICULAR — as últimas linhas voltam a cada tela (o
        // chat nasce vazio), e o chip "para Bia ✕" arma o sussurro
        (safe(function () { return Su().lista(); }, []) || []).slice(-6).forEach(function (l) {
          chatLog.appendChild(linhaSussurro(l));
        });
        var chip = el('div', 'chat-chip');
        tap(chip, function () { chatAlvo = null; pintaChip(); });
        chat.appendChild(chip);
        var ci = document.createElement('input');
        ci.className = 'hub-chat-input';
        ci.maxLength = 240;
        ci.placeholder = tr('diga algo…  /g guilda · /Nome particular');
        ci.setAttribute('enterkeyhint', 'send');
        // 06/10 (o dono, no celular): mandada a mensagem, o campo seguia "selecionado" — o teclado fechava,
        // o toque seguinte na praça só tirava o foco e o teclado reabria. No toque, mandar SOLTA o campo;
        // no teclado de verdade ele segue no campo, para quem conversa em sequência.
        var soltaNoToque = function () {
          var toque = safe(function () { return window.matchMedia('(pointer: coarse)').matches; }, false);
          if (toque) safe(function () { ci.blur(); return true; }, false);
        };
        ci.addEventListener('keydown', function (evk) {
          if (evk.key === 'Enter') {
            var t = ci.value.trim();
            // 13/09 (dono): "/Nome texto" é particular e "/g texto" vai à guilda; sem barra, a praça
            // 04/10: dentro da sede o padrão vira a guilda — sem barra é como se fosse "/g"
            if (t && t.charAt(0) !== '/' && !chatAlvo && sedeDentro()) t = '/g ' + t;
            if (t && t.charAt(0) === '/') {
              if (comandoDoChat(t, j, chatLinha)) { ci.value = ''; soltaNoToque(); }
              evk.stopPropagation();
              return;
            }
            if (t && chatAlvo) {
              var rs = safe(function () { return Su().manda(chatAlvo.id, t); }, null);
              if (rs && rs.ok) { ci.value = ''; soltaNoToque(); }
              else toast(textoMotivo(rs ? rs.motivo : 'privado', null));
            } else if (t && R.falar(t)) {
              chatLinha(j.nome || tr('você'), t, '#9bd06a');
              safe(function () { return JOGO.Hub.fala(null, t); }, null);   // 11/09: o meu balão também
              ci.value = '';
              soltaNoToque();
            }
          } else if (evk.key === 'Escape') {
            if (chatAlvo) { chatAlvo = null; pintaChip(); } else ci.blur();
          }
          evk.stopPropagation();               // o i digitado aqui não abre o saco
        });
        chat.appendChild(ci);
        mundo.appendChild(chat);
        chatUI = { log: chatLog, input: ci, chip: chip };
        pintaChip();
      });
    }
    if (!entrou) mundo.appendChild(el('p', 'empty', tr('O acampamento precisa do modo 3D.')));
    pintaConta();
    avisaDevolvidasPorNivel();             // [D19] o que voltou ao saco na carga
  }

  /* ------------------------------------------------ A LOJA NO JOGO (04/10)
   * O jogo não vende nada (a compra é no site, em barras de ouro) e não repete preço nenhum: mostra
   * o que o SERVIDOR diz em GET /api/loja/vitrine (js/core/loja.js). Duas coisas moram aqui:
   *   - a CHAMADA na praça: uma pílula que leva à loja do site — o Pacote de Boas-Vindas enquanto a
   *     conta não o comprou; depois, as ofertas da semana com a contagem regressiva;
   *   - a AURA: a comprada acende no herói (Hub.aura com a cor) e viaja no perfil da Rede; a ficha do
   *     Personagem liga, desliga e troca (secaoAura). */
  var AURA_PT = { fogo: tr('Brasa'), agua: tr('Maré'), terra: tr('Raiz'), ar: tr('Vento'), neutra: tr('Lousa'), mestre: tr('Chama do Mestre'),
                  sombra: tr('Sombra'), gelo: tr('Geada'), ouro: tr('Dourada') };   // 08/10: as três novas
  // o que cada aura FAZ na praça (o mesmo que o js/render3d/hub3d.js desenha e que a loja do site descreve)
  var AURA_EFEITO = {
    fogo: tr('labaredas que sobem dos pés, fagulhas que estalam e um clarão quente no chão'),
    agua: tr('anéis de água que se abrem no chão como onda, e gotas que orbitam e caem'),
    terra: tr('folhas e pétalas girando devagar, e brotos que nascem do chão e recolhem'),
    ar: tr('fitas de ar em espiral subindo em volta do corpo, e um rastro ao andar'),
    neutra: tr('lascas de pedra em órbita lenta, runas no ar e um círculo rúnico de luz pálida'),
    mestre: tr('labaredas negras com miolo carmesim, um selo de runas vermelho-sangue no chão, lâminas em órbita e brasas em espiral'),
    sombra: tr('fumaça roxa e lenta subindo em volta do corpo, e uma mancha escura que respira no chão'),
    gelo: tr('estacas de gelo que nascem do chão, cristais em órbita, um floco de neve de luz no chão e neve caindo'),
    ouro: tr('moedas de ouro girando em espiral, uma coroa de sol no chão e brilhos que piscam em volta do corpo')
  };
  // 08/10: as molduras da plaquinha — as dos títulos (automáticas) e as premium (da loja)
  var MOLDURA_CAMPEAO = tr('Campeão da Arena');      // 10/10: a do Torneio (a vitrine a chama 'arena'; a automática do pódio é a "da Arena")
  var MOLDURA_PT = { auto: tr('Automática (a do título)'), arena: tr('da Arena'), eco: tr('do Eco'), chefe: tr('dos Chefes'), classe: tr('do pódio de classe'),
                     ouro: tr('Dourada'), rubi: tr('de Rubi'), esmeralda: tr('de Esmeralda'), obsidiana: tr('de Obsidiana'),
                     mestre: tr('do Mestre') };
  function molduraDaLoja() {
    return safe(function () { return (JOGO.Loja && JOGO.Loja.molduraEscolhida) ? JOGO.Loja.molduraEscolhida() : null; }, null);
  }
  /* a moldura do herói na praça: a premium escolhida, senão a automática do título */
  function aplicaMolduraPraca() {
    if (!JOGO.Hub || !JOGO.Hub.moldura) return;
    safe(function () { JOGO.Hub.moldura(molduraDaLoja() || 'auto'); return true; }, false);
  }
  /* 25/10: a loja fechada (SOTERRA_LOJA=0; js/core/loja.js, L.fechada): as frases que mandam à loja do site somem */
  function lojaFechada() { return safe(function () { return !!(JOGO.Loja && JOGO.Loja.fechada && JOGO.Loja.fechada()); }, false); }
  function paginaLoja() {
    var raiz = String(location.href || '').split('#')[0].split('?')[0].replace(/[^\/\\]*$/, '');
    return raiz + 'site/loja.html';
  }
  function auraDaLoja() {
    return safe(function () { return (JOGO.Loja && JOGO.Loja.auraEscolhida) ? JOGO.Loja.auraEscolhida() : null; }, null);
  }
  /* a aura do herói na praça: a comprada (com a cor) se a conta escolheu uma; senão a branca do
   * Traje do Colecionador fechado; senão nenhuma */
  function aplicaAuraPraca() {
    if (!JOGO.Hub || !JOGO.Hub.aura) return;
    var cor = auraDaLoja();
    safe(function () { JOGO.Hub.aura(!!cor || !!safe(temAuraSelos, false), cor); return true; }, false);
  }
  // 200000 s → "2 d 7 h"; 5000 s → "1 h 23 min"; 50 s → "menos de 1 min"
  function faltaCurta(seg) {
    seg = Math.max(0, Math.floor(Number(seg) || 0));
    var d = Math.floor(seg / 86400), h = Math.floor((seg % 86400) / 3600), m = Math.floor((seg % 3600) / 60);
    if (d > 0) return d + ' d' + (h ? ' ' + h + ' h' : '');
    if (h > 0) return h + ' h' + (m ? ' ' + m + ' min' : '');
    return m > 0 ? m + ' min' : tr('menos de 1 min');
  }
  /* O texto da chamada, função PURA (as provas a chamam sem a tela): {chave, html, dica} ou null quando não
   * há o que chamar. `v` é a vitrine (Loja.vitrineAtual) e `agoraS` os segundos do servidor. A `chave` diz
   * QUAL chamada é (o pacote, ou as ofertas DESTA semana): é por ela que o sino sabe se o aviso é novo. */
  UI.chamadaLojaTexto = function (v, agoraS) {
    if (!v || typeof v !== 'object' || v.fechada) return null;      // 25/10: a loja fechada não chama ninguém
    var bv = v.boasVindas || {};
    if (bv.disponivel && bv.preco > 0 && bv.precoCheio > bv.preco) {
      var menos = Math.round((1 - bv.preco / bv.precoCheio) * 100);
      return { chave: 'bv', html: '🎁 <b>Boas-vindas</b> −' + menos + '%',
               dica: tr('Pacote de Boas-Vindas na loja do site: um personagem raro, pedras de forja e uma aura, uma vez por conta') };
    }
    var of = v.ofertas || {}, itens = of.itens || [];
    var falta = (of.fim || 0) - (agoraS || 0);
    if (!itens.length || !(falta > 0)) return null;
    return { chave: 'of:' + (of.fim || 0), html: '🏷 <b>Ofertas</b> −' + (of.desconto || 0) + '% · ' + faltaCurta(falta),
             dica: tr('Ofertas da semana na loja do site: {a} — terminam em {b}', { a: itens.map(function (i) { return i.nome; }).join(', '), b: faltaCurta(falta) }) };
  };
  var chamadaLojaEl = null, chamadaLojaTimer = null;
  function pintaChamadaLoja() {
    var a = chamadaLojaEl, Lj = JOGO.Loja;
    if (!a || !a.isConnected) {
      if (chamadaLojaTimer) { clearInterval(chamadaLojaTimer); chamadaLojaTimer = null; }
      chamadaLojaEl = null;
      return;
    }
    var t = (Lj && Lj.vitrineAtual) ? UI.chamadaLojaTexto(Lj.vitrineAtual(), Lj.agoraServidor()) : null;
    if (!t) { a.classList.add('is-off'); return; }
    a.classList.remove('is-off');
    a.innerHTML = t.html;
    a.title = t.dica;
    a.setAttribute('aria-label', t.dica);
  }
  function ligaChamadaLoja(a) {
    var Lj = JOGO.Loja;
    if (!a || !Lj || !Lj.vitrine) return;
    a.href = paginaLoja();
    a.target = '_blank';
    a.rel = 'noopener';
    chamadaLojaEl = a;
    pintaChamadaLoja();
    // a contagem regressiva anda de minuto em minuto; o relógio morre com a tela (pintaChamadaLoja)
    if (!chamadaLojaTimer) chamadaLojaTimer = setInterval(function () { pintaChamadaLoja(); pintaSino(); }, 60000);
    Lj.vitrine();                       // a resposta chega pelo 'soterra:vitrine' (ouvinte abaixo)
  }
  /* ------------------------------------------------ O SINO DOS AVISOS (06/10)
   * O dono, olhando a praça no celular deitado: "essas ofertas e evento pode ficar um ícone, não acha? tipo a
   * notificação fixa em um sino sem ficar ocupando a tela". NO TOQUE (o css decide: ponteiro grosso ou
   * html.celular) as duas pílulas da coluna da direita — a dos eventos e a da loja — somem e fica UM sino com o
   * selo da contagem; no PC o sino nem aparece e as pílulas seguem como eram. As pílulas continuam no DOM
   * (escondidas): quem lê o texto delas, as provas da agenda e da loja, lê o mesmo de antes.
   *   - o selo conta os avisos: cada evento no ar e a chamada da loja (o pacote ou as ofertas da semana);
   *   - aviso que ainda não foi visto deixa o selo VERMELHO; abrir o painel marca tudo como visto e o selo fica
   *     neutro. "Visto" é por navegador (localStorage; sem ele, vale até recarregar);
   *   - sem aviso nenhum o sino SOME (e a moeda "Prêmio Grátis!" sobe para o lugar dele — o css do
   *     js/core/premio_anuncio.js);
   *   - o painel fecha no toque fora, no ✕ e no voltar do aparelho (UI.voltar).
   * Quem mexe é só o botão: a praça não é repintada por causa dele, e com o painel fechado o relógio da
   * contagem regressiva só toca no DOM quando a contagem ou o "novo" MUDAM (sinoAssin). */
  // os avisos de agora, função PURA: [{chave, evento}] dos eventos no ar e, por último, {chave, loja}
  UI.sinoAvisos = function (ativos, vitrine, agoraS) {
    var l = [];
    (ativos || []).forEach(function (e) { if (e && e.id != null && e.id !== '') l.push({ chave: 'ev:' + e.id, evento: e }); });
    var t = UI.chamadaLojaTexto(vitrine, agoraS);
    if (t) l.push({ chave: 'loja:' + t.chave, loja: t });
    return l;
  };
  // quantos desses a conta ainda não viu (PURA): as chaves que não estão entre as vistas
  UI.sinoNovos = function (avisos, vistas) {
    vistas = vistas || [];
    return (avisos || []).filter(function (a) { return vistas.indexOf(a.chave) < 0; }).length;
  };
  /* as vistas depois de abrir o painel (PURA): as de antes e as de agora, as mais novas no fim e no máximo
   * SINO_GUARDA — evento que saiu do ar e voltou (o da semana) não vira "novo" de novo, e a lista não cresce
   * para sempre */
  var SINO_GUARDA = 40;
  UI.sinoVistas = function (vistas, avisos) {
    var l = (vistas || []).map(String);
    (avisos || []).forEach(function (a) {
      var i = l.indexOf(a.chave);
      if (i >= 0) l.splice(i, 1);
      l.push(a.chave);
    });
    return l.slice(-SINO_GUARDA);
  };
  var SINO_VISTO = 'soterra-sino-visto';
  var SINO_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v3.6L4.2 16.2c-.4.8.2 1.8 1.1 1.8h13.4c.9 0 1.5-1 1.1-1.8L18 12.6V9a6 6 0 0 0-6-6z" ' +
    'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.8 20.2a2.3 2.3 0 0 0 4.4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var sinoEl = null, sinoPainelEl = null, sinoAberto = false, sinoAssin = null, sinoMem = null;
  function sinoLeVistas() {
    if (sinoMem) return sinoMem;
    var l = [];
    try { l = JSON.parse(localStorage.getItem(SINO_VISTO) || '[]'); } catch (e) { l = []; }
    sinoMem = Array.isArray(l) ? l.map(String) : [];
    return sinoMem;
  }
  function sinoMarcaVistas(avisos) {
    if (!UI.sinoNovos(avisos, sinoLeVistas())) return;
    sinoMem = UI.sinoVistas(sinoLeVistas(), avisos);
    try { localStorage.setItem(SINO_VISTO, JSON.stringify(sinoMem)); } catch (e) {}
  }
  function sinoLista() {
    var Ag = JOGO.Agenda, Lj = JOGO.Loja;
    var ativos = (Ag && Ag.ativos) ? (safe(function () { return Ag.ativos(); }, []) || []) : [];
    var v = (Lj && Lj.vitrineAtual) ? safe(function () { return Lj.vitrineAtual(); }, null) : null;
    return UI.sinoAvisos(ativos, v, v ? safe(function () { return Lj.agoraServidor(); }, 0) : 0);
  }
  function pintaSinoPainel(avisos) {
    var p = sinoPainelEl, Ag = JOGO.Agenda;
    clear(p);
    var cab = el('div', 'hub-sino-cab', '<b>' + tr('Avisos') + '</b>');
    var x = el('button', 'hub-sino-x', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', tr('Fechar os avisos'));
    x.addEventListener('click', function (ev) { ev.stopPropagation(); fechaSino(); });
    cab.appendChild(x);
    p.appendChild(cab);
    var agoraMs = safe(function () { return Ag.agora(); }, Date.now());
    avisos.forEach(function (a) {
      // cada linha leva aonde a pílula levava: o evento ao calendário do site, a chamada à loja do site
      var l = el('a', 'hub-sino-linha' + (a.evento ? '' : ' is-loja'),
        a.evento ? linhaEvento(a.evento, agoraMs, true) : a.loja.html + '<small>' + esc(a.loja.dica) + '</small>');
      l.href = a.evento ? paginaEventos() : paginaLoja();
      l.target = '_blank';
      l.rel = 'noopener';
      l.setAttribute('data-sino', a.chave);
      l.addEventListener('click', function () { setTimeout(fechaSino, 0); });
      p.appendChild(l);
    });
  }
  function pintaSino() {
    var b = sinoEl;
    if (!b) return;
    if (!b.isConnected) {                 // a praça foi desmontada: o sino morre com ela
      if (sinoAberto) fechaSino();
      sinoEl = null; sinoPainelEl = null;
      return;
    }
    var avisos = sinoLista();
    if (sinoAberto && !avisos.length) { fechaSino(); return; }
    if (sinoAberto) sinoMarcaVistas(avisos);
    var novos = UI.sinoNovos(avisos, sinoLeVistas());
    var assin = avisos.map(function (a) { return a.chave; }).join('|') + '#' + novos;
    if (assin !== sinoAssin) {
      sinoAssin = assin;
      b.className = 'hub-sino' + (avisos.length ? '' : ' is-off') + (novos ? ' is-novo' : '');
      b.setAttribute('aria-label', novos ? tr('Avisos: {a} (novos: {b})', { a: avisos.length, b: novos })
                                         : tr('Avisos: {a}', { a: avisos.length }));
      b.innerHTML = SINO_SVG + '<span class="hub-sino-selo" data-sino-conta>' + avisos.length + '</span>';
    }
    if (sinoAberto) pintaSinoPainel(avisos);
  }
  /* onde o painel abre, medido na hora: sem tapar a COLUNA da direita (o sino e, abaixo dele, a moeda "Prêmio
   * Grátis!" do aplicativo, quando ela existe) nem descer sobre o chat e o cais. Deitado, abre à esquerda da
   * coluna, na altura do sino; em pé (não há largura para isso), logo abaixo da coluna. */
  function sinoLugar() {
    var b = sinoEl, p = sinoPainelEl, tela = b && b.parentNode;
    if (!p || !tela || !tela.getBoundingClientRect) return;
    var rt = tela.getBoundingClientRect(), rs = b.getBoundingClientRect();
    if (!rt.width || !rs.width) return;
    var m = tela.querySelector('.pan-atalho'), rm = m ? m.getBoundingClientRect() : null;
    if (rm && !rm.width) rm = null;
    var margem = Math.max(8, Math.round(rt.right - rs.right));
    var emPe = rt.height > rt.width;
    var topo = Math.round((emPe ? (rm ? Math.max(rs.bottom, rm.bottom) : rs.bottom) + 8 : rs.top) - rt.top);
    var direita = emPe ? margem : Math.round(rt.right - (rm ? Math.min(rs.left, rm.left) : rs.left) + 8);
    var chao = rt.bottom;
    [tela.querySelector('.hub-dock'), document.querySelector('.hub-chat')].forEach(function (e) {
      var r = e ? e.getBoundingClientRect() : null;
      if (r && r.width && r.top > rt.top + topo) chao = Math.min(chao, r.top);
    });
    p.style.top = topo + 'px';
    p.style.right = direita + 'px';
    p.style.maxWidth = Math.max(160, Math.min(340, Math.round(rt.width - direita - margem))) + 'px';
    p.style.maxHeight = Math.max(96, Math.round(chao - rt.top - topo - 8)) + 'px';
  }
  function sinoFora(ev) {
    var t = ev.target;
    if (sinoPainelEl && sinoPainelEl.isConnected && t && (sinoPainelEl.contains(t) || (sinoEl && sinoEl.contains(t)))) return;
    fechaSino();
  }
  function abreSino() {
    if (!sinoEl || !sinoPainelEl || sinoAberto) return;
    sinoAberto = true;
    sinoPainelEl.classList.remove('is-off');
    sinoEl.setAttribute('aria-expanded', 'true');
    pintaSino();
    if (!sinoAberto) return;              // não havia aviso: o painel nem abriu
    sinoLugar();
    // os ouvintes só existem enquanto o painel está aberto (o toque na praça não vira `click`: por isso o
    // pointerdown; o aparelho que gira muda a coluna de lugar: por isso o resize)
    document.addEventListener('pointerdown', sinoFora, true);
    window.addEventListener('resize', sinoLugar);
  }
  function fechaSino() {
    if (!sinoAberto) return false;
    sinoAberto = false;
    document.removeEventListener('pointerdown', sinoFora, true);
    window.removeEventListener('resize', sinoLugar);
    if (sinoPainelEl) { sinoPainelEl.classList.add('is-off'); clear(sinoPainelEl); }
    if (sinoEl) sinoEl.setAttribute('aria-expanded', 'false');
    pintaSino();
    return true;
  }
  // a praça chama isto UMA vez ao ser montada, depois das pílulas e ANTES da moeda (o css dela olha o irmão)
  function montaSino(tela) {
    if (sinoAberto) fechaSino();
    var b = el('button', 'hub-sino is-off');
    b.type = 'button';
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', function (ev) { ev.stopPropagation(); if (sinoAberto) fechaSino(); else abreSino(); });
    var p = el('div', 'hub-sino-painel is-off');
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', tr('Avisos'));
    tela.appendChild(b);
    tela.appendChild(p);
    sinoEl = b; sinoPainelEl = p; sinoAssin = null;
    pintaSino();
  }
  UI._sino = { monta: montaSino, abre: abreSino, fecha: fechaSino, pinta: pintaSino, aberto: function () { return sinoAberto; },
               esquece: function () { sinoMem = null; sinoAssin = null; } };   // só as provas

  var reanuncioAura = null, auraAnunciada = null, molduraAnunciada = null;
  try {
    window.addEventListener('soterra:vitrine', function () {
      aplicaAuraPraca();
      aplicaMolduraPraca();           // 08/10
      // o perfil só volta à Rede quando a aura (ou a moldura) MUDOU (a vitrine é relida a cada entrada na praça)
      var corV = auraDaLoja(), molV = molduraDaLoja();
      if (corV !== auraAnunciada || molV !== molduraAnunciada) {
        auraAnunciada = corV; molduraAnunciada = molV;
        safe(function () { reanunciaPerfil(); return true; }, false);
      }
      pintaChamadaLoja();
      pintaSino();
    });
  } catch (eVit) {}
  /* a seção da ficha do Personagem: "Sem aura" e uma pastilha por aura. A que a conta não tem fica
   * apagada e leva à loja; a posse e a escolha são do servidor (Loja.escolheAura). */
  function secaoAura(caixa) {
    var Lj = JOGO.Loja;
    if (!Lj || !Lj.vitrine) return;
    caixa.appendChild(el('h3', 'bk-tit', tr('Aura na praça')));
    var cx = el('div', 'char-aura');
    caixa.appendChild(cx);
    function escolhe(cor, nome) {
      Lj.escolheAura(cor).then(function (r) {
        if (!r || !r.ok) { toast(esc((r && r.erro) || tr('Não deu para trocar a aura agora.'))); return; }
        toast(cor ? tr('Aura de {nome} acesa — os outros passam a ver em até uns 2 minutos.', { nome: nome }) : tr('Aura desligada.'), 'good');
        // o relé relê a conta a cada minuto e pouco: um segundo anúncio depois disso leva a aura nova
        if (reanuncioAura) clearTimeout(reanuncioAura);
        reanuncioAura = setTimeout(function () { safe(function () { reanunciaPerfil(); return true; }, false); }, 130000);
        if (cx.isConnected) pinta();
      });
    }
    function pinta() {
      clear(cx);
      var v = Lj.vitrineAtual();
      if (!v) {
        var comConta = safe(function () { return JOGO.Sessao.ativa(); }, false);
        cx.appendChild(el('p', 'inv-dica', comConta ? tr('Buscando as suas auras…')
          : tr('Entre na sua conta (ficha Contas) para usar as auras da loja.')));
        return;
      }
      var tem = v.auras.tem, atual = v.auras.escolhida;
      var fila = el('div', 'char-aura-fila');
      var b0 = btn(tr('Sem aura'), 'btn-mini char-aura-b' + (atual ? '' : ' is-on'), function () { if (atual) escolhe(null, ''); });
      b0.setAttribute('aria-pressed', atual ? 'false' : 'true');
      fila.appendChild(b0);
      // 08/10 (o dono: "só aparece para o jogador as que ele possui"): as trancadas ficam na loja
      var minhas = v.auras.todas.filter(function (a) { return tem.indexOf(a.cor) >= 0; });
      minhas.forEach(function (a) {
        var minha = tem.indexOf(a.cor) >= 0, nome = AURA_PT[a.cor] || a.cor;
        var b = btn('<span class="char-aura-cor is-' + a.cor + '"></span>' + esc(nome),
          'btn-mini char-aura-b' + (atual === a.cor ? ' is-on' : '') + (minha ? '' : ' is-falta'), function () {
            if (!minha) { toast(tr('A {a} está na loja do site, na seção Aparência.', { a: esc(a.nome) })); return; }
            if (atual !== a.cor) escolhe(a.cor, nome);
          });
        b.setAttribute('data-aura', a.cor);
        b.setAttribute('aria-pressed', atual === a.cor ? 'true' : 'false');
        b.title = a.nome + (AURA_EFEITO[a.cor] ? ': ' + AURA_EFEITO[a.cor] : '') + (minha ? '' : tr(' — na loja do site'));
        fila.appendChild(b);
      });
      cx.appendChild(fila);
      var faltam = v.auras.todas.length - minhas.length;
      var dica = el('p', 'inv-dica', tem.length
        ? tr('{a}Todo mundo na praça vê. Só aparência: não muda nada em batalha.', { a: atual && AURA_EFEITO[atual] ? tr('Aura de {a}: {b}.', { a: esc(AURA_PT[atual] || atual), b: AURA_EFEITO[atual] }) + ' ' : tr('Cada aura é um efeito diferente em volta do herói. ') }) +
          (faltam > 0 && !lojaFechada() ? ' ' + tr('Mais {a} aura(s) na <a class="char-aura-link" target="_blank" rel="noopener">loja do site</a>, na seção Aparência.', { a: faltam }) : '')
        : lojaFechada() ? tr('Você ainda não tem aura. Ela é só aparência, nada de poder.')
        : tr('Você ainda não tem aura. Elas ficam na <a class="char-aura-link" target="_blank" rel="noopener">loja do site</a>, na seção Aparência — só aparência, nada de poder.'));
      var lk = dica.querySelector('a');
      if (lk) lk.href = paginaLoja();
      cx.appendChild(dica);
    }
    pinta();
    Lj.vitrine(true).then(function () { if (cx.isConnected) pinta(); });
  }
  UI._secaoAura = secaoAura;            // só as provas (tests/loja_novidades.html)
  /* 08/10: a MOLDURA da plaquinha — "Automática" (a do título que está na placa) e as premium que a conta
   * TEM (as outras ficam na loja). A escolha é do servidor (Loja.escolheMoldura), como a aura. */
  function secaoMoldura(caixa, tituloVivo) {
    var Lj = JOGO.Loja;
    if (!Lj || !Lj.vitrine) return;
    caixa.appendChild(el('h3', 'bk-tit', tr('Moldura da plaquinha')));
    var cx = el('div', 'char-mol');
    caixa.appendChild(cx);
    function escolhe(id, nome) {
      Lj.escolheMoldura(id).then(function (r) {
        if (!r || !r.ok) { toast(esc((r && r.erro) || tr('Não deu para trocar a moldura agora.'))); return; }
        aplicaMolduraPraca();
        toast(id ? tr('Moldura {a} na sua plaquinha — os outros passam a ver em até uns 2 minutos.', { a: nome }) : tr('Moldura automática: a do seu título.'), 'good');
        if (reanuncioAura) clearTimeout(reanuncioAura);
        reanuncioAura = setTimeout(function () { safe(function () { reanunciaPerfil(); return true; }, false); }, 130000);
        safe(function () { reanunciaPerfil(); return true; }, false);
        if (cx.isConnected) pinta();
      });
    }
    function pinta() {
      clear(cx);
      var v = Lj.vitrineAtual();
      if (!v || !v.molduras) { cx.appendChild(el('p', 'inv-dica', tr('Buscando as suas molduras…'))); return; }
      var tem = v.molduras.tem, atual = v.molduras.escolhida;
      var doTitulo = safe(function () { return JOGO.Hub && JOGO.Hub.molduraDoTitulo ? JOGO.Hub.molduraDoTitulo(tituloVivo) : null; }, null);
      var fila = el('div', 'char-aura-fila char-mol-fila');
      var b0 = btn('<span class="char-mol-cor is-' + (doTitulo || 'simples') + '"></span>' + esc(MOLDURA_PT.auto) +
                   (doTitulo ? ' <small>· ' + esc(MOLDURA_PT[doTitulo] || doTitulo) + '</small>' : ''),
                   'btn-mini char-aura-b char-mol-b' + (atual ? '' : ' is-on'), function () { if (atual) escolhe(null, ''); });
      b0.setAttribute('data-moldura', 'auto');
      fila.appendChild(b0);
      /* 10/10 — a do CAMPEÃO DA ARENA (docs/TORNEIO.md): não é da loja — vem com o primeiro torneio vencido em
       * chave de 8 ou 16 e fica na conta para sempre; a vitrine a chama de 'arena'. O grau (I, II, III) sai das
       * conquistas. Se a vitrine ainda não a lista mas o Torneio diz que a conta a tem, o botão aparece do mesmo
       * jeito (quem confere a posse na hora de escolher é o servidor). */
      var arP = safe(function () { return JOGO.Torneio.arenaDoPerfil(); }, null) || { n: 0, vigente: false, moldura: false };
      var grauA = safe(function () { return JOGO.Torneio.grau(Math.max(1, arP.n)); }, 1) || 1;
      var lista = v.molduras.todas.filter(function (m) { return tem.indexOf(m.id) >= 0; });
      if ((tem.indexOf('arena') >= 0 || arP.moldura) && !lista.some(function (m) { return m.id === 'arena'; })) {
        lista.push({ id: 'arena', nome: 'Campeão da Arena' });
      }
      lista.forEach(function (m) {
        var daArena = m.id === 'arena';
        var nome = daArena ? MOLDURA_CAMPEAO + ' ' + ['I', 'I', 'II', 'III'][grauA] : (MOLDURA_PT[m.id] || m.nome);
        var b = btn('<span class="char-mol-cor is-' + (daArena ? 'campeao' + grauA : m.id) + '"></span>' + esc(daArena ? nome : m.nome),
          'btn-mini char-aura-b char-mol-b' + (atual === m.id ? ' is-on' : ''), function () { if (atual !== m.id) escolhe(m.id, nome); });
        b.setAttribute('data-moldura', m.id);
        if (daArena) b.title = tr('{n} conquista(s) no Torneio da Arena{a}', { n: arP.n, a: arP.vigente ? tr(' · campeão vigente (o louro)') : '' });
        fila.appendChild(b);
      });
      cx.appendChild(fila);
      // as que faltam são as da LOJA que a conta não tem (a do Campeão da Arena não se compra: fica fora da conta)
      var faltam = v.molduras.todas.filter(function (m) { return m.id !== 'arena' && tem.indexOf(m.id) < 0; }).length;
      var dica = el('p', 'inv-dica', (doTitulo
        ? tr('Com o título de agora a placa leva a moldura {a} sozinha. ', { a: esc(MOLDURA_PT[doTitulo] || doTitulo) })
        : tr('Sem título de pódio, a placa é a de sempre. ')) +
        tr('A moldura premium vale por cima da automática.') +
        (faltam > 0 && !lojaFechada() ? ' ' + tr('Mais {a} moldura(s) na <a class="char-aura-link" target="_blank" rel="noopener">loja do site</a>, na seção Aparência.', { a: faltam }) : ''));
      var lk = dica.querySelector('a');
      if (lk) lk.href = paginaLoja();
      cx.appendChild(dica);
    }
    pinta();
    Lj.vitrine(true).then(function () { if (cx.isConnected) pinta(); });
  }
  UI._secaoMoldura = secaoMoldura;

  /* ------------------------------------------------ OS EVENTOS DO MUNDO (10/09)
   * A faixa do Acampamento, as linhas do painel do portal e os chips da tela
   * de recompensa leem a agenda (js/core/agenda.js). Tudo defensivo: sem o
   * módulo, nada disto aparece e nada quebra. */
  var soltaFaixaEventos = null;
  var faixaEvAberta = false;          // a faixa de eventos nasce minimizada no canto (04/10)
  function paginaEventos() {
    // a página do site, relativa ao jogo (raiz/site/eventos.html), como Sessao.paginaConta
    var raiz = String(location.href || '').split('#')[0].split('?')[0].replace(/[^\/\\]*$/, '');
    return raiz + 'site/eventos.html';
  }
  // "✦ XP ×2 — Quinta do XP · termina em 5 h"
  /* "só na Estufa Soterrada", "só no Poço sem Fundo": o nome do calabouço vem
   * com o artigo, e a contração é a do português (o site faz igual). */
  function soEm(id) {
    var n = String(JOGO.Agenda.nomeCalabouco(id) || id);
    var m = /^(A|O|As|Os) (.*)$/.exec(n);
    return tr('só {a}', { a: m ? { A: 'na', O: 'no', As: 'nas', Os: 'nos' }[m[1]] + ' ' + m[2] : tr('em {n}', { n: n }) });
  }
  function linhaEvento(e, agoraMs, comLugar) {
    var Ag = JOGO.Agenda;
    var termina = tr('termina em {a}', { a: Ag.falta(e.fim * 1000 - agoraMs) });
    var lugar = (comLugar && e.calabouco) ? ' · ' + esc(soEm(e.calabouco)) : '';
    if (e.tipo === 'aviso') {
      return '📣 <b>' + esc(e.titulo) + '</b>' + (e.texto ? ' — ' + esc(e.texto) : '') + lugar + ' · ' + termina;
    }
    return '✦ <b>' + esc(Ag.rotulo(e)) + '</b> — ' + esc(e.titulo) + lugar + ' · ' + termina;
  }
  function pintaFaixaEventos(faixa) {
    var Ag = JOGO.Agenda;
    if (!faixa || !Ag || !Ag.ativos) return;
    clear(faixa);
    var ativos = safe(function () { return Ag.ativos(); }, []) || [];
    if (!ativos.length) { faixa.classList.add('is-off'); return; }
    faixa.classList.remove('is-off');
    var agoraMs = safe(function () { return Ag.agora(); }, Date.now());
    /* 04/10, o dono: "essa mensagem tem que ficar minimizada em um canto... em mobile atrapalha demais, ocupa
     * metade da tela". A faixa nasce FECHADA numa pílula no canto ("📣 2 eventos") e abre no toque; as linhas
     * continuam no DOM (só escondidas), então quem lê o texto dela — as provas da agenda — lê o mesmo de antes. */
    if (faixaEvAberta) faixa.classList.remove('is-mini'); else faixa.classList.add('is-mini');
    var temBonus = ativos.some(function (e) { return e.tipo !== 'aviso'; });
    var pil = el('button', 'hub-evento-pilula', (temBonus ? '✦ ' : '📣 ') +
      (ativos.length === 1 ? tr('<b>{n}</b> evento', { n: ativos.length }) : tr('<b>{n}</b> eventos', { n: ativos.length })) +
      '<span class="hub-evento-seta">' + (faixaEvAberta ? ' ▴' : ' ▾') + '</span>');
    pil.type = 'button';
    pil.setAttribute('aria-expanded', faixaEvAberta ? 'true' : 'false');
    pil.setAttribute('aria-label', (faixaEvAberta
      ? tr('Fechar os eventos do mundo')
      : tr('Ver os eventos do mundo')));
    pil.addEventListener('click', function (ev) { ev.stopPropagation(); faixaEvAberta = !faixaEvAberta; pintaFaixaEventos(faixa); });
    faixa.appendChild(pil);
    ativos.slice(0, 3).forEach(function (e) {
      faixa.appendChild(el('span', 'hub-evento-item', linhaEvento(e, agoraMs, true)));
    });
    if (ativos.length > 3) faixa.appendChild(el('span', 'hub-evento-item', tr('+{n} outros', { n: ativos.length - 3 })));
    /* A SEMANA DO SOTERRA (07/10): com a faixa aberta, os sete dias do programa fixo numa linha só, o de hoje
     * aceso — o jogador comum vê o que vem amanhã sem abrir o site (a ficha dos eventos é do Mestre) */
    var prog = safe(function () { return Ag.programa ? Ag.programa() : []; }, []) || [];
    if (prog.length) {
      var hojeDia = new Date(agoraMs + (Ag.FUSO_MIN || -180) * 60000).getUTCDay();
      var sem = el('span', 'hub-evento-semana');
      prog.slice().sort(function (x, y) { return x.dia - y.dia; }).forEach(function (p) {
        var d = el('span', 'hub-evento-dia' + (p.dia === hojeDia ? ' is-hoje' : ''),
          '<b>' + esc(Ag.DIA_CURTO[p.dia] || '') + '</b> ' + esc(p.titulo));
        tipOn(d, esc(p.titulo), esc(Ag.rotulo({ tipo: p.tipo, multiplicador: p.multiplicador })) +
          (p.calabouco ? ' · ' + esc(p.calabouco === 'dia' ? tr('Calabouço do Dia') : Ag.nomeCalabouco(p.calabouco)) : '') +
          (p.texto ? '<br>' + esc(p.texto) : ''), p.dia === hojeDia ? '#ffc44d' : '#9fd3ff');
        sem.appendChild(d);
      });
      faixa.appendChild(sem);
    }
    var a = el('a', 'hub-evento-link', tr('ver o calendário'));
    a.href = paginaEventos();
    a.target = '_blank';
    a.rel = 'noopener';
    faixa.appendChild(a);
  }
  function ligaFaixaEventos(faixa) {
    var Ag = JOGO.Agenda;
    if (soltaFaixaEventos) { try { soltaFaixaEventos(); } catch (e) {} soltaFaixaEventos = null; }
    if (!faixa || !Ag || !Ag.aoMudar) return;
    pintaFaixaEventos(faixa);
    soltaFaixaEventos = Ag.aoMudar(function () { if (faixa.isConnected) pintaFaixaEventos(faixa); pintaSino(); });
    // ao entrar, busca de novo se a última tentativa tiver mais de 60 s
    // (em casa, só com sessão ou API apontada — Agenda.refresca decide)
    if (Ag.refresca) {
      Ag.refresca(60000).then(function (r) {
        if (r && !r.pulou && faixa.isConnected) pintaFaixaEventos(faixa);
        pintaSino();
      });
    }
  }
  /* uma linha por evento no ar que vale neste portal (o aviso geral mora na
   * faixa); saque junto do Calabouço do Dia não soma: vale o maior (D2) */
  function linhasEventoPortal(dungeonId, ehDia) {
    var Ag = JOGO.Agenda;
    if (!Ag || !Ag.valemEm) return [];
    var agoraMs = safe(function () { return Ag.agora(); }, Date.now());
    var evs = safe(function () { return Ag.valemEm(dungeonId); }, []) || [];
    return evs.filter(function (e) { return e.tipo !== 'aviso' || e.calabouco; }).map(function (e) {
      var txt = linhaEvento(e, agoraMs, false);
      if (e.tipo === 'saque' && ehDia) txt += tr(' · junto do Calabouço do Dia, <b>vale o maior</b> (não somam)');
      return el('p', 'hub-evento-linha', txt);
    });
  }
  /* o chip do evento que PESOU nesta sala, no bloco que ele multiplicou —
   * a recompensa diz por que veio mais (game.js devolve `eventos`) */
  function chipsEvento(tipo) {
    var evs = ((lastRewards && lastRewards.eventos) || []).filter(function (e) { return e && e.tipo === tipo; });
    if (!evs.length) return null;
    var w = el('div', 'rw-eventos');
    evs.forEach(function (e) {
      var rot = safe(function () { return JOGO.Agenda.rotulo(e); }, null) ||
                (String(e.tipo) + ' ×' + String(e.fator).replace('.', ','));
      var txtEv = '✦ ' + esc(e.titulo || tr('Evento do mundo')) + ' · ' + esc(rot);
      // o Pergaminho da Sabedoria (Fase C) vem no mesmo formato, com as cargas que restam
      if (e.origem === 'pergaminho') {
        txtEv = tr('❦ {a} · {b} · restam {c} salas', { a: esc(e.titulo || tr('Pergaminho da Sabedoria')), b: esc(rot), c: Math.max(0, Math.floor(Number(e.restam) || 0)) });
      }
      // o bônus de XP por tempo (loja 2), com o que ainda falta do prazo
      if (e.origem === 'bonus-tempo') {
        var faltaB = (Number(e.ate) || 0) * 1000 - bonusAgoraMs();
        txtEv = '✦ ' + esc(e.titulo || tr('Bônus de XP')) + ' · ' + esc(bonusFmt(e.fator)) +
                (faltaB > 0 ? ' ' + tr('· faltam {a}', { a: esc(bonusFalta(faltaB)) }) : '');
      }
      var realce = (e.origem === 'pergaminho' || e.origem === 'bonus-tempo') ? ' rw-pergaminho' : '';
      w.appendChild(el('span', 'rw-evento' + realce, txtEv));
    });
    return w;
  }

  /* 08/10 à noite: POR QUE a sala não rendeu — pelo código do servidor (`recusadaMotivo`, js/core/game.js
   * codigoDaRecusa), com a frase dele (`recusada`, já traduzida pelo funil) como complemento ou como última saída.
   * A linha é fixa na tela de recompensa: o toast somia, e o dono só via "+0 XP" sem saber de quê. */
  function porqueSemRecompensa(rw) {
    var m = rw.recusadaMotivo || '', erro = rw.recusada ? esc(rw.recusada) : '';
    var grupo = !!rw.rede;
    if (m === 'rapido-demais') return tr('<b>A sala não rendeu:</b> fechou rápido demais para ser de verdade — o servidor não pagou.');
    if (m === 'regras-mudaram') {
      return grupo ? tr('<b>A sala não rendeu:</b> as regras do jogo mudaram no meio da sala (o servidor atualizou) — abram a sala de novo.')
                   : tr('<b>A sala não rendeu:</b> as regras do jogo mudaram no meio da sala (o servidor atualizou) — abra a sala de novo.');
    }
    if (m === 'fotografada' || m === 'nao-conferida') {
      return tr('<b>A sala não rendeu:</b> a batalha sincronizou por foto e nenhum registro limpo chegou a tempo — o servidor não pôde conferir a vitória. Se a conexão cair de novo, espere o parceiro antes de seguir.');
    }
    if (m === 'vencida' || m === 'validade' || m === 'outra-aberta') return tr('<b>A sala não rendeu:</b> a sala venceu no servidor (passou da validade, ou outra foi aberta por cima) — abram de novo.');
    if (m === 'perdida') return tr('<b>A sala não rendeu:</b> o registro que o servidor refez não chegou à vitória (parou antes do fim).');
    if (m === 'outro-aparelho') return tr('<b>A sala não rendeu:</b> sua conta entrou em outro aparelho e esta sala não foi conferida.');
    if (m === 'sem-resposta') return tr('<b>A sala não rendeu:</b> o servidor não respondeu à conferência.');
    if (m === 'sem-recompensa') return tr('<b>A sala não rendeu:</b> o servidor confirmou a vitória mas não mandou a recompensa.');
    if (m === 'divergiu' || m === 'vez' || m === 'unidade' || m === 'depois-do-fim' || m === 'entrada' || m === 'herois' ||
        m === 'juiz' || m === 'recusada' || m === 'sal-faltando') {
      return tr('<b>A sala não rendeu:</b> o servidor recusou a conferência da batalha ({erro}).', { erro: erro || esc(m) });
    }
    return tr('<b>A sala não rendeu:</b> o servidor não confirmou a vitória ({erro}).', { erro: erro || esc(m) || tr('sem resposta') });
  }
  function porqueEspera(c) {
    var s = (c && typeof c.esperaMs === 'number') ? Math.max(0, Math.ceil(c.esperaMs / 1000)) : null;
    var ate = s != null ? ' ' + tr('(até {s} s)', { s: s }) : '';
    return tr('<b>Esperando a conferência do servidor…</b> a sua batalha sincronizou por foto e é o registro limpo do outro jogador que confirma a sala{ate}. A recompensa entra sozinha quando ele chegar.', { ate: ate });
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
      noPoco ? tr('Andar {andarPoco} vencido', { andarPoco: andarPoco }) : (fim ? tr('Calabouço vencido') : tr('Sala limpa')),
      noPoco ? tr('O Poço continua. Ele sempre continua.')
             : (fim ? tr('O fundo desta descida está seu.') : tr('Respire. A próxima é pior.'))));

    var body = el('div', 'ui-body');
    body.appendChild(vidaBloco('fim'));      // 14/09: a vida com que cada herói saiu da sala, subindo
    var box = el('div', 'rw-box');

    box.appendChild(rwBlock(tr('Experiência'), (function () {
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
        // 03/10: o calabouço especial (o Santuário) mora fora de DATA.dungeons
        var esp = safe(function () { return D().especial(did); }, null);
        if (rec == null && esp && esp.recommendedLevel != null) rec = esp.recommendedLevel;
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
        w.appendChild(el('div', 'rw-xp-n is-cut', tr('XP por herói')));
      }
      var chXp = chipsEvento('xp');          // 10/09: o evento do mundo de XP
      if (chXp) w.appendChild(chXp);
      // 08/10 à noite (o dono: "todas as XPs foram zeradas"): a sala que o servidor NÃO pagou diz POR QUÊ aqui,
      // numa linha fixa (antes o motivo só passava num toast que some); e a que ainda ESPERA a conferência diz que espera
      if (lastRewards.conferindo) w.appendChild(el('div', 'rw-xp-why rw-xp-espera', porqueEspera(lastRewards.conferindo)));
      else if (lastRewards.recusada || lastRewards.recusadaMotivo) {
        w.appendChild(el('div', 'rw-xp-why rw-xp-recusa', porqueSemRecompensa(lastRewards)));
      }

      if (algumCorte) {
        w.appendChild(el('div', 'rw-xp-why',
          (noPiso
            ? tr('Conteúdo fácil demais para o seu nível{a}. <b>Desça um Fecho mais fundo</b> para a XP valer inteira.', { a: rec != null ? ' (recomendado: <b>' + rec + '</b>)' : '' })
            : tr('Conteúdo fácil demais para o seu nível{a}. Quanto mais fundo, mais a XP rende.', { a: rec != null ? ' (recomendado: <b>' + rec + '</b>)' : '' }))));
      }

      lista.forEach(function (hid) {
        var h = hero(hid);
        var xi = xpInfo(hid);
        var m = multDe(hid), ganho = realDe(hid), cortou = m < 0.999 && bruto > 0;
        var r = el('div', 'rw-hero');
        r.appendChild(art('portrait', [h.classId || hid, { element: h.element, size: 40 }], 36));
        var t = el('div', 'rw-hero-t');
        var lin = el('b', null, esc(className(h.classId || hid)) + ' — ' + tr('Nv') + ' ' + h.level);
        // o ganho REAL deste herói, ao lado do nome
        lin.appendChild(el('span', 'rw-hero-xp' + (cortou ? ' is-cut' : ''), '+' + ganho + ' XP'));
        if (cortou) {
          lin.appendChild(el('span', 'rw-xp-was', '+' + bruto));
          lin.appendChild(el('span', 'rw-xp-mult', fmtMult(m)));
        }
        t.appendChild(lin);
        t.appendChild(bar('bar-xp', xi ? xi.pct : 0, xi && xi.xpNext ? xi.xp + '/' + xi.xpNext : tr('máximo')));
        r.appendChild(t);
        w.appendChild(r);
      });
      return w;
    })()));

    if ((lastRewards.levelUps || []).length) {
      box.appendChild(rwBlock(tr('Subiu de nível'), (function () {
        var w = el('div', 'rw-chips');
        lastRewards.levelUps.forEach(function (lu) {
          w.appendChild(el('span', 'chip chip-up',
            esc(className((hero(lu.heroId) || {}).classId || lu.heroId)) + ' → ' + tr('Nv') + ' ' + lu.novoNivel));
        });
        return w;
      })()));
    }

    var drops = lastRewards.drops || [];
    /* 10/09: o bloco dos Vinténs morava DENTRO do `if (drops.length)` desde
     * 23/08 — sala sem peça (três em quatro, pela régua do saque) escondia a
     * moeda ganha, o chip do desafio e agora o do evento. Ele saiu para fora. */
    if (lastRewards.moedas > 0) {
      box.appendChild(rwBlock(tr('Vinténs'), (function () {
        var w = el('div', 'rw-moedas');
        if (lastRewards.desafio) {
          var dsf = lastRewards.desafio;
          w.appendChild(el('span',
            'rw-desafio' + (dsf.cumprido ? ' is-cumprido' : ''),
            dsf.cumprido ? tr('☆ {a} cumprido · +25%', { a: esc(dsf.nome) })
                         : tr('☆ {a} se perdeu', { a: esc(dsf.nome) })));
        }
        // 07/10: o afixo com que a sala foi jogada pagou junto
        if (lastRewards.afixo) {
          w.appendChild(el('span', 'rw-desafio is-cumprido rw-afixo',
            tr('{icone} {nome} · +{pct}%', { icone: esc(lastRewards.afixo.icone || '✦'), nome: esc(lastRewards.afixo.nome),
                                             pct: Math.round(((lastRewards.afixo.bonus || 1.25) - 1) * 100) })));
        }
        // 08/10 à noite: o bônus de descanso pesou nesta sala
        if (lastRewards.descanso && lastRewards.descanso.fator > 1) {
          w.appendChild(el('span', 'rw-desafio is-cumprido rw-descanso',
            tr('☀ Descanso · XP ×{f} ({u} de {de} hoje)', { f: lastRewards.descanso.fator, u: lastRewards.descanso.usadas,
                                                           de: lastRewards.descanso.de })));
        }
        var chV = chipsEvento('vintem');     // 10/09: o evento do mundo de vinténs
        if (chV) w.appendChild(chV);
        var g = lastRewards.moedas || 0;
        var ganhoM = el('span', 'rw-moedas-ganho', (g === 1
          ? tr('+{g} vintém', { g: g })
          : tr('+{g} vinténs', { g: g })));
        ganhoM.insertBefore(art('vintemIcon', [18], 18, 'moeda-inline'), ganhoM.firstChild);
        w.appendChild(ganhoM);
        // o TOTAL vem do DB, assincrono — a tela nasce sem ele e preenche
        // quando a resposta chega, como fara quando o DB for um servidor
        var tot = el('span', 'rw-moedas-total', '…');
        if (JOGO.DB && JOGO.DB.moedas) {
          JOGO.DB.moedas().then(function (m) { tot.textContent = tr('no bolso: {m}', { m: m }); });
        } else tot.textContent = '';
        w.appendChild(tot);
        return w;
      })()));
    }

    if (drops.length) {
      box.appendChild(rwBlock(tr('Saque'), (function () {
        var w = el('div', 'rw-items');
        drops.forEach(function (d) {
          var id = (typeof d === 'string') ? d : (d.itemId || d.id);
          var it = itemDef(id);
          var cell = el('div', 'rw-item');
          cell.appendChild(art('itemIcon', [id, 52], 52));
          cell.appendChild(el('span', null, esc((it && it.name) || id)));
          var nvR = nvBadge(id);
          if (nvR) cell.appendChild(nvR);
          if (it) {
            markRarity(cell, it.rarity);
            tipOn(cell, it.name, itemTipBody(id), rarColor(it.rarity));
          }
          w.appendChild(cell);
        });
        // 10/09: o evento de saque, só quando ele venceu o Calabouço do Dia
        var chS = chipsEvento('saque');
        if (!chS) return w;
        var comChipS = el('div', 'rw-saque');
        comChipS.appendChild(chS);
        comChipS.appendChild(w);
        return comChipS;
      })()));
    }

    // O SACO ENCHEU no meio da descida (25/08): o que ficou para trás é
    // dito com nome — perda calada viraria bug report, não regra de jogo.
    if (drops.perdidos && drops.perdidos.length) {
      box.appendChild(el('p', 'rw-perdidos', tr('⚠ O saco encheu — ficou para trás: <b>{a}</b>. Guarde peças no cofre do banco antes de descer.', { a: drops.perdidos.map(function (id) {
          var it2 = itemDef(id);
          return esc((it2 && it2.name) || id);
        }).join(', ') })));
    }

    var stones = lastRewards.stones || {};
    var anyStone = false; for (var sk in stones) { if (stones.hasOwnProperty(sk)) anyStone = true; }
    if (anyStone) {
      box.appendChild(rwBlock(tr('Pedras de forja'), (function () {
        var w = el('div', 'rw-items');
        for (var sid in stones) {
          if (!stones.hasOwnProperty(sid)) continue;
          var sd = stoneDefs()[sid];
          var cell = el('div', 'rw-item');
          cell.appendChild(art('stoneIcon', [sid, 48], 48));
          cell.appendChild(el('span', null, '+' + stones[sid] + ' ' + esc((sd && sd.name) || sid)));
          w.appendChild(cell);
        }
        // 10/09: o evento de pedras (só as elementais; a Âncora fica fora)
        var chP = chipsEvento('pedras');
        if (!chP) return w;
        var comChipP = el('div', 'rw-pedras');
        comChipP.appendChild(chP);
        comChipP.appendChild(w);
        return comChipP;
      })()));
    }

    // OS SELOS DE CHEFE (25/08): a moeda do Colecionador, um ❂ por elemento
    var selosG = lastRewards.selos || {};
    var algumSelo = false;
    for (var slk in selosG) { if (selosG.hasOwnProperty(slk)) algumSelo = true; }
    if (algumSelo) {
      box.appendChild(rwBlock(tr('Selos de chefe'), (function () {
        var w = el('div', 'rw-items');
        for (var se in selosG) {
          if (!selosG.hasOwnProperty(se)) continue;
          var cell = el('div', 'rw-item rw-selo');
          cell.style.setProperty('--ec', elemColor(se));
          cell.appendChild(art('seloIcon', [se, 30], 30, 'selo-moeda-img'));   // a arte do dono (03/09)
          cell.appendChild(el('span', null, tr('+{a} Selo de {b}', { a: selosG[se], b: ELEM_PT[se] || se })));
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
      box.appendChild(rwBlock(tr('Insígnia de fundação'), (function () {
        var w = el('div', 'rw-items');
        var cell = el('div', 'rw-item rw-selo');
        cell.style.setProperty('--ec', '#c9a227');
        cell.appendChild(art('insigniaIcon', [30], 30, 'selo-moeda-img'));   // a arte do dono (03/09)
        var saldo = 0;
        try { saldo = P().insigniasVer(); } catch (e) {}
        var meta = (JOGO.DATA && JOGO.DATA.insignias && JOGO.DATA.insignias.porGuilda) || 10;
        cell.appendChild(el('span', null, tr('+{insigniasG} Insígnia — {saldo}/{meta} para fundar uma guilda', { insigniasG: insigniasG, saldo: saldo, meta: meta })));
        w.appendChild(cell);
        return w;
      })()));
    }

    var cards = lastRewards.cards || [];
    if (cards.length) {
      box.appendChild(rwBlock(tr('Cartas de personagem'), (function () {
        var w = el('div', 'rw-cards');
        cards.forEach(function (c) {
          var cell = el('div', 'rw-card');
          // A CARTA COM A CARA DO PERSONAGEM (30/08, pedido do dono): a
          // moldura de carta fica, o miolo é o retrato de corpo inteiro —
          // quem dropa a carta do Minotauro VÊ o Minotauro.
          // 04/10: é o MESMO cartão do Inventário e da Coleção (retrato, moldura da raridade, nome) com
          // o +N do que caiu — antes a moldura era sempre dourada, qualquer que fosse a raridade
          var carta = cartaClasse(c.classId, 104, '+' + (c.amount || 1));
          carta.classList.add('rw-card-foto');
          cell.appendChild(carta);
          var t = el('div', 'rw-card-t');
          t.appendChild(el('b', null, '+' + (c.amount || 1) + ' ' + esc(c.name || className(c.classId))));
          var ci = cardInfo(c.classId);
          t.appendChild(el('span', null, ci.unlocked
            ? tr('Liberada · {cards} cartas', { cards: ci.cards })
            : tr('{a} / {b} para liberar', { a: ci.cards, b: ci.unlockCost })));
          t.appendChild(starRow(ci.stars, 14));
          if (c.starUp) t.appendChild(el('span', 'rw-starup', tr('★ Nova estrela!')));
          else if (ci.unlocked && ci.next) t.appendChild(el('span', 'rw-card-prox', tr('faltam {faltam} para a ★{star}', { faltam: ci.next.faltam, star: ci.next.star })));
          cell.appendChild(t);
          w.appendChild(cell);
        });
        return w;
      })()));
    }

    // 07/10: A CRÔNICA QUE ACABOU DE ABRIR (js/core/cronicas.js) — o chefe derrubado, o bestiário completo, as
    // fusões: a recompensa avisa e leva à Coleção, onde ela se lê (e deixa de ser nova)
    var novasCr = safe(function () { return JOGO.Cronicas.novas(); }, []) || [];
    if (novasCr.length) {
      box.appendChild(rwBlock(tr('Crônica desbloqueada'), (function () {
        var w = el('div', 'rw-cronicas');
        novasCr.forEach(function (c) {
          var cell = el('div', 'rw-cronica');
          cell.appendChild(el('b', null, '📜 ' + esc(tr(c.titulo))));
          cell.appendChild(el('span', null, tr('Uma página do mundo enterrado abriu na Coleção.')));
          cell.appendChild(btn(tr('Ler agora'), 'btn-mini btn-gold', function () { openSheet('collection', c.id); }));
          w.appendChild(cell);
        });
        return w;
      })()));
    }

    // CARTAS DE BICHO (03/09): a carta com a cara do bicho, como a de classe
    var petCards = lastRewards.petCards || [];
    if (petCards.length) {
      box.appendChild(rwBlock(tr('Cartas de bicho'), (function () {
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
            ? tr('É seu · {cards} cartas', { cards: pci.cards })
            : pci.cards + ' / ' + pci.unlockCost + ' para o bicho'));
          t.appendChild(petStarRow(pci.stars, 14));
          if (c.starUp) t.appendChild(el('span', 'rw-starup', tr('★ Nova estrela!')));
          if (c.novoPet) t.appendChild(el('span', 'rw-starup', tr('O bicho é seu!')));
          cell.appendChild(t);
          w.appendChild(cell);
        });
        return w;
      })()));
    }
    var petUps = lastRewards.petLevelUps || [];
    if (petUps.length) {
      box.appendChild(rwBlock(tr('O bicho cresceu'), (function () {
        var w = el('div', 'rw-items');
        petUps.forEach(function (u) {
          var pdu = petDef(u.petId);
          var cell = el('div', 'rw-item');
          cell.appendChild(art('petIcon', [u.petId, 52], 52));
          cell.appendChild(el('span', null, esc((pdu && pdu.name) || u.petId) + ' → ' + tr('Nv') + ' ' + u.novoNivel));
          w.appendChild(cell);
        });
        return w;
      })()));
    }

    var pets = lastRewards.pets || [];
    if (pets.length) {
      box.appendChild(rwBlock(tr('Bicho novo'), (function () {
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
      // 12/09: a escolha é na ficha de Feitiços, por cima desta tela — sem sair dela
      foot.appendChild(btn(tr('Escolher caminho ({length})', { length: pend.length }), 'btn-gold', function () {
        partyHero = pend[0];
        openSheet('spells');
      }));
    }
    foot.appendChild(btn(tr('Inventário'), 'btn-ghost', function () { openSheet('inventory'); }));
    // 15/10: o fim da sala também sai como cartão (js/core/compartilhar.js)
    if (JOGO.Compartilhar) foot.appendChild(btn(tr('Compartilhar'), 'btn-ghost', function () { compartilhaSala(name); }));
    // 11/09: a descida de GRUPO tem rodapé próprio (4.8) — quem lidera abre a
    // próxima sala, quem segue espera, e a dificuldade é de quem lidera (D9)
    var rg = noPoco ? false : rodapeGrupo(foot, fim);
    if (!rg) {
      if (noPoco) {
        // subir É vitória: o recorde já foi anotado a cada andar limpo
        foot.appendChild(btn(tr('Subir (o recorde fica)'), 'btn-ghost', function () {
          safe(function () { return G().restart(); }, null);
          navTo('hub');
        }));
      }
      if (fim) foot.appendChild(btn(tr('Voltar ao acampamento'), 'btn-primary', function () { navTo('hub'); }));
      else foot.appendChild(btn(noPoco ? tr('Descer mais um andar') : tr('Próxima sala'), 'btn-primary', function () {
        if (!safe(function () { return G().nextRoom(); }, false)) toast(tr('Não deu para avançar.'));
      }));
    }
    // O seletor vai ANTES do rodape: a escolha e sobre a proxima sala, e tem de
    // ser vista antes do botao que leva a ela.
    if (!fim && (!rg || rg === 'lider')) {
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
    var rot = el('div', 'dif-rot', tr('Dificuldade desta sala'));
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
        (custo === 0 ? tr('monstros iguais') : tr('{a}{custo}% de vida', { a: custo > 0 ? '+' : '', custo: custo }))));
      b.appendChild(el('span', 'dif-num dif-premio',
        (premio === 0 ? tr('xp normal') : tr('{a}{premio}% de xp', { a: premio > 0 ? '+' : '', premio: premio }))));
      b.title = d.resumo || '';
      tap(b, function () {
        G2.setDificuldade(id);
        // 11/09 (revisão): em grupo, quem segue fica sabendo (vai no estado do grupo)
        if (emGrupo() && souLider()) safe(function () { return Gp().avisaDificuldade(); }, null);
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

  /* 15/10 — COMPARTILHAR (js/core/compartilhar.js). A fusão é o que o jogador mostra: o cartão com o corpo
   * da forma, o nome da identidade da dupla (DATA.fusionIdentities), as classes e os elementos, e o link de
   * convite no rodapé. O fim da sala sai com o retrato do primeiro herói e os números. */
  function retratoDe(defId, opts) {
    var M2 = JOGO.Models3D2;
    return safe(function () { return M2 && M2.isReady() ? M2.portrait(defId, opts) : null; }, null)
        || safe(function () { return A().unit(defId, { elements: opts.elements, size: 512 }); }, null)
        || safe(function () { return A().portrait(defId, { elements: opts.elements, element: opts.elements && opts.elements[0], size: 512 }); }, null);
  }
  function rodapeConvite() {
    var l = safe(function () { return JOGO.Convite.link(); }, null);
    return l ? l.replace(/^https?:\/\//, '') : null;
  }
  function nomesDosElementos(els) {
    return (els || []).map(function (e) { return safe(function () { return D().elementInfo[e].name; }, e); }).join(' + ');
  }
  function cartaoFusao(u) {
    var C = JOGO.Compartilhar;
    if (!C || !u) return null;
    var par = String(u.classPair || String(u.defId || '').slice(4)), cls = par.split('+');
    var els = (u.elements && u.elements.length) ? u.elements : [u.element || 'neutro'];
    var titulo = safe(function () { return D().fusionIdentities[par].name; }, null) || nomeDoPar(u.defId);
    return C.cartao({
      retrato: retratoDe(u.defId, { elements: els, size: 768, corpoInteiro: true }),
      titulo: titulo,
      sub: cls.map(function (c) { return className(c); }).join(' + ') + ' · ' + nomesDosElementos(els),
      linha: tr('Nível {n} — uma fusão do SOTERRA', { n: u.level || 1 }),
      cor: elemColor(els[0]), cor2: elemColor(els[1] || els[0]),
      rodape: rodapeConvite() || undefined
    });
  }
  UI.cartaoFusao = cartaoFusao;
  function textoDeCompartilhar(frase) {
    var l = safe(function () { return JOGO.Convite.link(); }, null) || JOGO.Compartilhar.SITE;
    return frase + ' ' + l;
  }
  var faixaShare = null;
  function fechaFaixa() { if (faixaShare && faixaShare.parentNode) faixaShare.parentNode.removeChild(faixaShare); faixaShare = null; }
  function ofereceCompartilharFusao(u) {
    var meuLado = safe(function () { return G().meuLado(); }, 'player');
    if (u.side !== meuLado) return;
    if (emGrupo() && u.dono && u.dono !== meuIdRede()) return;
    fechaFaixa();
    var par = String(u.classPair || String(u.defId || '').slice(4));
    var nome = safe(function () { return D().fusionIdentities[par].name; }, null) || nomeDoPar(u.defId);
    faixaShare = el('div', 'share-faixa');
    faixaShare.appendChild(el('b', null, tr('FUSÃO! {a}', { a: esc(nome) })));
    faixaShare.appendChild(btn(tr('Compartilhar'), 'btn-mini btn-gold', function () {
      var cv = cartaoFusao(u);
      fechaFaixa();
      if (!cv) { toast(tr('Não deu para montar o cartão.')); return; }
      safe(function () { JOGO.EventosUso.anota('compartilhou:fusao'); }, null);
      JOGO.Compartilhar.manda(cv, { titulo: 'SOTERRA — ' + nome, texto: textoDeCompartilhar(tr('Minha fusão no SOTERRA: {a}.', { a: nome })), nome: 'soterra-fusao.png' })
        .then(function (como) { if (como === 'baixou') toast(tr('Imagem baixada e texto copiado — é só colar.'), 'good'); });
    }));
    faixaShare.appendChild(btn('✕', 'btn-mini btn-ghost share-fecha', fechaFaixa));
    document.body.appendChild(faixaShare);
    setTimeout(fechaFaixa, 12000);
  }
  function cartaoSalaLimpa(name) {
    var C = JOGO.Compartilhar;
    if (!C) return null;
    var info = safe(function () { return G().salaInfo(); }, null) || {};
    var noPoco = safe(function () { return G().dungeonId === 'poco'; }, false);
    var fim = name === 'dungeonComplete';
    var hid = selHeroes[0], h = hid ? hero(hid) : null;
    var r = lastRewards || {};
    var titulo = noPoco ? tr('Andar {n} vencido', { n: safe(function () { return G().roomIndex + 1; }, 0) }) : (fim ? tr('Calabouço vencido') : tr('Sala limpa'));
    return C.cartao({
      retrato: h ? retratoDe(h.classId, { element: h.element, elements: [h.element], size: 768, corpoInteiro: true, classId: h.classId }) : null,
      titulo: titulo,
      sub: [info.calabouco, info.nome].filter(Boolean).join(' · '),
      linha: tr('XP +{x} · vinténs +{v}', { x: r.xpGanho || 0, v: r.moedas || 0 }),
      cor: elemColor(h ? h.element : 'neutro'), cor2: elemColor(h ? h.element : 'neutro'),
      rodape: rodapeConvite() || undefined
    });
  }
  UI.cartaoSalaLimpa = cartaoSalaLimpa;
  function compartilhaSala(name) {
    var cv = cartaoSalaLimpa(name);
    if (!cv) { toast(tr('Não deu para montar o cartão.')); return; }
    safe(function () { JOGO.EventosUso.anota('compartilhou:sala'); }, null);
    JOGO.Compartilhar.manda(cv, { titulo: 'SOTERRA', texto: textoDeCompartilhar(tr('Mais uma sala vencida no SOTERRA.')), nome: 'soterra-sala.png' })
      .then(function (como) { if (como === 'baixou') toast(tr('Imagem baixada e texto copiado — é só colar.'), 'good'); });
  }
  /* O BLOCO DO CONVITE (js/core/convite.js) na ficha de amigos: o link, copiar, mandar, e a contagem */
  function blocoConvite() {
    var V = JOGO.Convite;
    var box = el('div', 'cv-bloco');
    box.appendChild(el('b', 'cfg-tit', tr('Convide um amigo')));
    if (!V || !V.disponivel()) {
      box.appendChild(el('p', 'inv-dica', tr('O convite precisa da conta do site.')));
      return box;
    }
    var texto = el('p', 'inv-dica', tr('Quem entrar pelo seu link e vencer a primeira sala ganha vinténs — e você também.'));
    box.appendChild(texto);
    var inp = document.createElement('input');
    inp.className = 'hub-input cv-link'; inp.readOnly = true; inp.value = '…'; inp.setAttribute('aria-label', tr('Link de convite'));
    inp.addEventListener('focus', function () { try { inp.select(); } catch (e) {} });
    box.appendChild(inp);
    var acts = el('div', 'cv-acts');
    acts.appendChild(btn(tr('Copiar'), 'btn-mini btn-ghost', function () { V.copia().then(function (ok) { toast(ok ? tr('Convite copiado — cole onde quiser.') : tr('Não deu para copiar; selecione o link.'), ok ? 'good' : undefined); }); }));
    acts.appendChild(btn(tr('Mandar'), 'btn-mini btn-gold', function () { V.manda().then(function (como) { if (como === 'copiou') toast(tr('Convite copiado — cole onde quiser.'), 'good'); }); }));
    box.appendChild(acts);
    var conta = el('p', 'inv-dica cv-conta', '');
    box.appendChild(conta);
    V.carrega().then(function (d) {
      if (!d) { inp.value = tr('sem convite agora'); return; }
      inp.value = d.link;
      texto.innerHTML = tr('Quem entrar pelo seu link e vencer a primeira sala ganha <b>{a}</b> vinténs — e você ganha <b>{b}</b> (até {c} por dia).', { a: d.premioConvidado, b: d.premio, c: d.limiteDia });
      conta.textContent = tr('{n} convidado(s) · {p} prêmio(s) pago(s)', { n: d.convidados, p: d.pagos });
    });
    return box;
  }

  /* 15/10 — CONTINUAR A LUTA QUE FICOU ABERTA (js/core/retomada.js): ao chegar à praça, se o registro da
   * última vez é uma sala solo que dá para refazer, pergunta uma vez. Continuar refaz e volta à batalha;
   * desistir fecha a sala como sempre (os heróis com a vida do ponto em que parou). */
  var ofereceuRetomada = false;
  function ofereceRetomada() {
    if (ofereceuRetomada) return;
    var A = JOGO.Autoridade;
    var v = safe(function () { return A && A.salaRetomavel ? A.salaRetomavel() : null; }, null);
    if (!v) return;
    ofereceuRetomada = true;
    var d = v.retomada || {};
    confirmSheet(tr('Continuar a luta?'),
      tr('A sua última luta ficou aberta: a sala {n}, com {k} lance(s) até onde parou. Continuar volta para ela do mesmo ponto; desistir fecha a sala e os heróis ficam com a vida de onde pararam.',
         { n: (d.roomIndex || 0) + 1, k: (v.lances || []).length }),
      function () {
        var ok = safe(function () { return G().retomaSolo(v); }, false);
        if (!ok) { toast(tr('Não deu para refazer a luta: a sala fechou.')); safe(function () { A.fechaPendente(); return true; }, null); }
      },
      { sim: tr('Continuar'), aoCancelar: function () { safe(function () { A.fechaPendente(); return true; }, null); } });
  }

  /* 15/10 — A ANTESSALA DA PRIMEIRA LUTA: um aviso de um instante no lugar do pátio 3D, e a porta
   * abre sozinha (Game.entrarNaSala pede o bilhete ao servidor e entra quando ele chega). Se a porta
   * não abrir (vida, portal), o botão leva à praça de sempre. */
  function buildPrimeiraLuta() {
    var s = screens.antessala;
    clear(s);
    var box = el('div', 'menu-box');
    box.appendChild(el('h1', 'game-title', tr('A primeira descida')));
    box.appendChild(el('p', 'game-sub', tr('Os seus dois heróis descem agora para a primeira sala. A praça, o cais e os portais vêm logo depois desta luta.')));
    box.appendChild(el('p', 'inv-dica', tr('Abrindo a porta…')));
    var acts = el('div', 'menu-acts');
    acts.appendChild(btn(tr('Ir para a praça'), 'btn-ghost', function () { G().primeiraLuta = false; safe(function () { G().abandonar(); return true; }, null); navTo('hub'); }));
    box.appendChild(acts);
    s.appendChild(box);
    setTimeout(function () {
      var r = safe(function () { return G().entrarNaSala(); }, false);
      if (r === false) { G().primeiraLuta = false; navTo('hub'); }
    }, 60);
  }

  function buildDefeat() {
    var s = screens.defeat;
    clear(s);
    var box = el('div', 'menu-box defeat-box');
    box.appendChild(el('h1', 'game-title defeat-title', tr('Soterrados')));
    box.appendChild(el('p', 'game-sub', tr('O calabouço ficou com o grupo. O que vocês já ganharam é seu — cartas, pedras e itens não se perdem.')));
    box.appendChild(vidaBloco('fim'));       // 14/09: quem caiu está a 0 e volta a subir — ou beba uma poção
    var acts = el('div', 'menu-acts');
    var estD = grupoEstado();
    if (emGrupo() || (estD && estD.descidaGrupo)) {     // 11/09: a derrota de grupo (4.8)
      derrotaGrupo(acts);
      box.appendChild(acts);
      s.appendChild(box);
      return;
    }
    acts.appendChild(btn(tr('Tentar de novo'), 'btn-primary btn-big', function () {
      var ok = safe(function () { return G().startRun(selHeroes.slice(), G().dungeonId); }, false);
      if (!ok) navTo('heroSelect');
    }));
    acts.appendChild(btn(tr('Voltar ao acampamento'), 'btn-ghost', function () {
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

    // O PAINEL DO MESTRE no meio da luta (12/09): só existe para o Mestre
    if (mestreAtivo()) {
      bt.gm = btn('⚔', 'bt-gm', function () { alternaPainelMestre(); });
      bt.gm.title = tr('Painel do Mestre (M ou F9)');
      top.appendChild(bt.gm);
    }

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
      bt.cam.title = tr('recentrar a camera');
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
        bt.trava.title = t ? tr('câmera travada — toque para soltar')
                           : tr('travar a câmera nesta posição');
        bt.trava.classList.toggle('is-on', t);
      });
      bt.trava.title = tr('travar a câmera nesta posição');
      top.appendChild(bt.trava);
    }
    bt.timeline = el('div', 'bt-timeline');
    top.appendChild(bt.timeline);
    s.appendChild(top);
    // 15/09: a guerra de guilda — as duas guildas (emblema e nome) e os quatro nomes, logo abaixo do topo
    if (modoRede() === 'guerra') {
      bt.guerra = el('div', 'bt-guerra');
      s.appendChild(bt.guerra);
      pintaGuerraTopo();
    }

    // ---- coluna esquerda: unidade ativa
    var left = el('div', 'bt-left');
    bt.active = el('div', 'bt-active');
    left.appendChild(bt.active);
    s.appendChild(left);
    /* 06/10: no celular deitado o cartão é uma LINHA no vão da fila de turnos (css "A LUTA NO CELULAR
     * DEITADO"): tocar nela abre o que a linha esconde — as fichas de estado inteiras e o motivo do PP
     * zerado — e tocar de novo fecha; a vez seguinte fecha sozinha (paintActive). No PC e em pé a classe
     * não tem regra nenhuma: o cartão já é o inteiro. */
    bt.left = left;
    // ouvinte simples, e não o tap(): o toque segue subindo (quem fecha balão ao tocar fora continua ouvindo)
    bt.active.addEventListener('click', function () { left.classList.toggle('is-aberto'); });

    // ---- o tempo do turno: a barra de pé na lateral esquerda (11/09, pedido do
    // dono). Montada uma vez; o paintTimer só mexe no número, na altura e na cor.
    bt.timer = el('div', 'bt-timer');
    bt.tmNum = el('div', 'tm-num');
    bt.tmTrack = el('div', 'tm-track');
    bt.tmFill = el('i');
    bt.tmTrack.appendChild(bt.tmFill);
    bt.tmBank = el('div', 'tm-bank');
    bt.tmBank.hidden = true;
    var gT = G();
    tipOn(bt.tmBank, tr('Tempo guardado'),
      tr('O que você não gasta no turno vai para o banco (máx. {a}s) e é usado quando os {b}s acabarem.', { a: (gT && gT.bankMax) || 120, b: (gT && gT.turnTime) || 30 }), '#9fd8ff');
    bt.timer.appendChild(bt.tmNum);
    bt.timer.appendChild(bt.tmTrack);
    bt.timer.appendChild(bt.tmBank);
    s.appendChild(bt.timer);

    // ---- log compacto (fechado por padrão; toque abre)
    bt.log = el('div', 'bt-log');
    bt.logList = el('div', 'bt-log-list');
    bt.log.appendChild(bt.logList);
    tap(bt.log, function () { bt.log.classList.toggle('is-open'); });
    s.appendChild(bt.log);

    // ---- barra de baixo: feitiços + ações
    var bottom = el('div', 'bt-bottom');
    bt.bottomBar = bottom;                // o pé da barra do tempo fica logo acima dela
    bt.fusion = el('div', 'bt-fusion');
    bottom.appendChild(bt.fusion);
    bt.spells = el('div', 'bt-spells');
    bottom.appendChild(bt.spells);
    var acts = el('div', 'bt-acts');
    bt.endBtn = btn(tr('Encerrar turno'), 'btn-primary btn-end', function () {
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
                 safe(function () { return G().canFuse().length; }, 0), coopSig()];
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
    // 03/10: no Santuário a linha da sala diz braseiros acesos, pilares e a direção NA TELA (gira com a câmera)
    if (s.santuario) {
      parts.push('sa:' + s.santuario.br.join('') + s.santuario.pl.join('') + s.santuario.es.join('') + s.santuario.av +
                 ':' + safe(function () { return JOGO.Renderer.rotation(); }, 0));
    }
    // 03/10: a rodada do Eco esperando o sal do servidor (e a rede que caiu no meio) muda a barra
    if (s.eco) {
      var sal = safe(function () { return G().ecoSalEstado(); }, null);
      parts.push('sal:' + (sal ? sal.rodada + (sal.semRede ? 'x' + sal.tentativas : '') : 0));
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
    pintaGrupoLado();                     // 11/09: a vida no painel do grupo
    pintaGuerraTopo();                    // 15/09: quem está fora na guerra de guilda
  }

  /* A PREPARAÇÃO (03/09 a escolha da casa, 21/09 o relógio e o PRONTO): em
   * `placing` a batalha mostra a faixa e apaga a barra de ações — o toque numa
   * casa dourada MARCA onde nascer, e a luta só começa quando os 30 s acabam ou
   * todo mundo aperta PRONTO. O botão fica apagado enquanto ninguém marcou: sem
   * casa escolhida não há o que confirmar. */
  function paintPlacement(s) {
    var placing = s.phase === 'placing';
    screens.battle.classList.toggle('is-placing', placing);
    if (!placing) {
      if (bt.placing) { bt.placing.remove(); bt.placing = null; }
      bt.prepBotao = null; bt.prepRelogio = null; bt.prepTexto = null; bt.prepEle = null;
      return;
    }
    if (!bt.placing) {
      bt.placing = el('div', 'bt-placing');
      bt.prepTexto = el('div', 'bt-prep-tx', textoColocacao());
      bt.prepRelogio = el('div', 'bt-prep-relogio', '');
      bt.prepEle = el('div', 'bt-prep-ele', '');
      bt.prepBotao = el('button', 'bt-prep-pronto', tr('PRONTO'));
      bt.prepBotao.type = 'button';
      bt.prepBotao.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var g = G();
        if (g && g.prontoPrep) g.prontoPrep(true);
        pintaPrep();
      });
      bt.placing.appendChild(bt.prepTexto);
      bt.placing.appendChild(bt.prepRelogio);
      bt.placing.appendChild(bt.prepEle);
      bt.placing.appendChild(bt.prepBotao);
      screens.battle.appendChild(bt.placing);
    }
    pintaPrep();
  }
  function pintaPrep() {
    var g = G();
    if (!bt.placing || !g || !g.prepEstado) return;
    var e = g.prepEstado();
    var seg = Math.ceil(e.restante);
    if (bt.prepRelogio) {
      bt.prepRelogio.textContent = tr('A luta começa em {seg} s', { seg: seg });
      bt.prepRelogio.classList.toggle('urgente', seg <= 5);
    }
    if (bt.prepEle) {
      bt.prepEle.textContent = e.dupla
        ? (e.prontoEle ? tr('{a} está pronto.', { a: nomeParceiro() }) : tr('Esperando {a}', { a: nomeParceiro() }) + '…')
        : '';
      bt.prepEle.style.display = e.dupla ? '' : 'none';
    }
    if (bt.prepBotao) {
      bt.prepBotao.disabled = !e.escolhi || e.pronto || e.fechada;
      bt.prepBotao.textContent = e.pronto ? tr('PRONTO ✓') : tr('PRONTO');
      bt.prepBotao.classList.toggle('feito', e.pronto);
      bt.prepBotao.title = e.escolhi ? '' : tr('Marque antes onde nascer');
    }
  }
  UI._pintaPrep = pintaPrep;               // provas

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
    /* 06/10: no celular EM PÉ a linha da sala quebra em duas e a fila de turnos descia para baixo do cartão
     * da vez, do relógio e do diário, que tinham o topo fixo. O css de em pé lê daqui a altura medida da
     * barra de cima (--bt-topo); só escreve quando ela muda. */
    if (ht && bt.topoPx !== ht) { bt.topoPx = ht; screens.battle.style.setProperty('--bt-topo', ht + 'px'); }
  }

  /* O AFIXO DE SALA na tela (07/10, js/core/afixos.js): a entrada do catálogo pelo id (ou o próprio
   * objeto do estado), a linha do painel e o chip da batalha — um desenho só para o portal, a porta,
   * a linha da sala e a recompensa. */
  function afixoDe(ref) {
    if (!ref) return null;
    if (typeof ref === 'object') return ref;
    return safe(function () { return JOGO.Afixos ? JOGO.Afixos.porId(ref) : null; }, null);
  }
  function afixoBonusPct() {
    return Math.round(safe(function () { return JOGO.Afixos.BONUS; }, 0.25) * 100);
  }
  function linhaAfixo(a, escuro) {
    return el('p', 'hub-afixo',
      tr(escuro ? '{icone} <b>Caminho escuro: {nome}</b> — {texto} Vale +{pct}% de XP e saque.'
                : '{icone} <b>Afixo de hoje: {nome}</b> — {texto} Vale +{pct}% de XP e saque.',
         { icone: esc(a.icone || '✦'), nome: esc(a.nome), texto: esc(a.texto), pct: afixoBonusPct() }));
  }
  function chipAfixo(a) {
    var ch = el('span', 'afixo-chip', esc(a.icone || '✦') + ' ' + esc(a.nome));
    tipOn(ch, tr('Afixo: {nome}', { nome: a.nome }),
      tr('{a}<br>Valendo: +{pct}% de XP e saque na vitória.', { a: esc(a.texto), pct: afixoBonusPct() }),
      '#9ad8ff');
    return ch;
  }

  function paintRoom(s) {
    clear(bt.room);
    var dg = null, ds = dungeons();
    for (var i = 0; i < ds.length; i++) if (ds[i].id === s.dungeonId) dg = ds[i];
    // 02/10: os mapas de DATA.arenas (a Câmara do Eco, a Praça, o Salão da Sede) também têm nome
    if (!dg) dg = safe(function () { return D().arena ? D().arena(s.dungeonId) : null; }, null);
    // 03/10: e os calabouços especiais (o Santuário dos Elementos)
    if (!dg) dg = safe(function () { return D().especial ? D().especial(s.dungeonId) : null; }, null);
    var room = dg && dg.rooms && dg.rooms[s.roomIndex];
    bt.room.appendChild(el('b', null, esc((room && room.name) || (dg && dg.name) || tr('Sala'))));
    var wd = (D().weathers && D().weathers[s.weather]) || null;
    if (wd) {
      var wc = el('span', 'weather-chip w-' + s.weather, esc(wd.name));
      if (wd.favors) wc.style.setProperty('--ec', elemColor(wd.favors));
      tipOn(wc, wd.name, esc(wd.description || '') +
        (wd.favors ? '<br>' + tr('<b>+5 PV</b> por turno para {a}', { a: ELEM_PT[wd.favors] || wd.favors }) : '') +
        (wd.harms ? '<br>' + tr('<b>−5 PV</b> por turno para {a}', { a: ELEM_PT[wd.harms] || wd.harms }) : ''),
        wd.favors ? elemColor(wd.favors) : '#ffd08a');
      bt.room.appendChild(wc);
    }
    bt.room.appendChild(el('span', 'round-chip', tr('Rodada {round}{a}', { round: s.round, a: s.eco ? ' ' + tr('de {rodadas}', { rodadas: s.eco.rodadas }) : '' })));
    if (s.eco) pintaEcoNaSala(s);
    if (s.santuario) pintaSantuarioNaSala(s);     // 03/10: as regras de terreno da sala, com o que vem na próxima rodada
    // O DESAFIO DA SALA: dourado enquanto vale, riscado quando se perde.
    // Mora aqui porque esta linha já é redesenhada a cada atualização.
    if (s.desafio) {
      var dch = el('span', 'desafio-chip' + (s.desafio.vivo ? ' is-vivo' : ' is-perdido'),
        '☆ ' + esc(s.desafio.nome));
      tipOn(dch, tr('Desafio: {nome}', { nome: s.desafio.nome }),
        (s.desafio.vivo
          ? tr('{a}<br>Valendo: +25% de XP e saque na vitória.', { a: esc(s.desafio.texto) })
          : tr('{a}<br>Perdido nesta luta — a sala paga o de sempre.', { a: esc(s.desafio.texto) })),
        s.desafio.vivo ? '#e8c25a' : '#8895a6');
      bt.room.appendChild(dch);
    }
    // 07/10: o afixo da sala, ao lado do desafio (a regra a mais com que ela abriu)
    if (s.afixo) bt.room.appendChild(chipAfixo(s.afixo));
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
      // 11/09: a cor vem do lado NA MINHA TELA (meu, do parceiro, inimigo) — e
      // conserta o 'hero' que nunca batia (todo mundo saía vermelho)
      var lado = ladoTela(u);
      var cell = el('div', 'tl-unit ' + (lado === 'meu' ? 's-hero' : (lado === 'aliado' ? 's-parceiro' : 's-enemy')) +
                           (i === 0 ? ' is-now' : ''));
      cell.appendChild(art('portrait', [u.defId, { element: u.element, size: 48 }], i === 0 ? 46 : 34));
      // 22/09: o invisível do outro lado continua na fila (a vez é de todos),
      // mas sem a vida — ela cair entregaria que a área o pegou ali
      var some = oculto(u);
      // 09/10: vida + escudo na mesma barrinha (fracoesVida): o escudo em azul depois do verde
      var frv = fracoesVida(u);
      var hb = el('div', 'tl-hp');
      var hf = el('i');
      var wPv = some ? 0 : Math.max(0, Math.min(100, frv.pv * 100));
      hf.style.width = wPv + '%';
      hb.appendChild(hf);
      if (!some && frv.esc > 0) {
        var he = el('i', 'esc');
        he.style.left = wPv + '%';
        he.style.width = Math.max(0, Math.min(100 - wPv, frv.esc * 100)) + '%';
        hb.appendChild(he);
      }
      cell.appendChild(hb);
      if (some) cell.style.opacity = '0.55';
      if (u.boss) cell.appendChild(el('span', 'tl-boss', '♛'));
      else if (u.elite) cell.appendChild(el('span', 'tl-elite', '★'));     // 07/10: o elite da sala
      // 08/10 (dono): com um ataque escolhido, o toque no CARD da fila lança nele — sem ir à casa
      // do mapa. Só se a casa dele é alvo válido desta tela (Game.alvosNaTela); fora do alcance
      // avisa e mantém o ataque escolhido; sem ataque escolhido, o toque abre a ficha como antes.
      (function (u, cell, titulo, cor) {
        tap(cell, function () {
          if (!lancaNoCard(u)) showTip(cell, titulo, unitTipBody(u), cor);
        });
      })(u, cell, (u.name || u.defId) + (u.elite ? ' ★ ' + esc(u.elite.nome) : ''),
         lado === 'inimigo' ? '#ff9a7a' : (lado === 'aliado' ? '#9cc4ff' : '#7ef0d4'));
      bt.timeline.appendChild(cell);
    }
  }

  /* O lance pelo card (08/10): devolve true se o toque foi consumido como ataque (lançado ou
   * recusado por alcance); false quando não há ataque escolhido ou não é a vez do jogador. */
  function lancaNoCard(u) {
    var g = G();
    if (!g || !u || !u.alive || u.offBoard) return false;
    var sid = safe(function () { return g.selectedSpellId; }, null);
    if (!sid || !safe(function () { return g.isPlayerTurn(); }, false)) return false;
    var at = activeUnit();
    if (!at) return false;
    if (oculto(u)) return false;
    var alvos = safe(function () { return g.alvosNaTela(at.uid, sid) || []; }, []);
    var vale = false;
    for (var i = 0; i < alvos.length; i++) if (alvos[i].x === u.x && alvos[i].y === u.y) { vale = true; break; }
    if (!vale) { toast(tr('{a}: fora do alcance.', { a: u.name || u.defId })); return true; }
    hideTip();
    try { if (JOGO.Renderer && JOGO.Renderer.limpaMira) JOGO.Renderer.limpaMira(); } catch (eM) {}
    safe(function () { g.onTileClicked(u.x, u.y); }, null);
    battleSig = '';
    paintBattle(true);
    return true;
  }

  /* 22/09: o invisível do OUTRO lado — some desta tela (Game.ocultoNaTela) */
  function oculto(u) {
    var g = G();
    if (!u || !g || typeof g.ocultoNaTela !== 'function') return false;
    return !!safe(function () { return g.ocultoNaTela(u); }, false);
  }

  function unitTipBody(u) {
    if (oculto(u)) return tr('<i>Sumiu nas sombras — não dá para ver onde está.</i>');
    var out = '<i>' + (u.hp + ' / ' + u.hpMax + tr(' PV · ') + u.pa + tr(' PA · ') + u.pp + tr(' PP')) + '</i>';
    // 07/10: o elite da sala diz o traço dele (js/core/elites.js)
    if (u.elite) out += '<br><b>' + esc(u.elite.icone || '★') + ' ' + tr('Elite {a}', { a: esc(u.elite.nome) }) + '</b> — ' + esc(u.elite.texto) +
                        (u.couraca > 0 ? ' ' + tr('(couraça: {a})', { a: u.couraca }) : '');
    if (u.shield) out += '<br>' + tr('Escudo: {shield}', { shield: u.shield });
    if (u.element && u.element !== 'neutro') out += '<br>' + tr('Elemento: {a}', { a: ELEM_PT[u.element] || u.element });
    if (u.elemPower) out += ' ' + tr('(+{elemPower} de dano)', { elemPower: u.elemPower });
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
    if (bt.ativaUid !== u.uid) {          // 06/10: outra unidade na vez — o cartão aberto no toque volta a ser a linha
      bt.ativaUid = u.uid;
      if (bt.left) bt.left.classList.remove('is-aberto');
    }
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

    // 22/09: na vez do invisível do outro lado o cartão diz só que ele sumiu —
    // vida, PA e PP gastos contariam o que ele fez e onde apanhou
    if (oculto(u)) {
      var sumiu = el('div', 'ba-status');
      sumiu.setAttribute('style', 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px');
      sumiu.appendChild(chip(tr('Invisível — sumiu nas sombras'), EF_CHIP.invisible.cor));
      info.appendChild(sumiu);
      bt.active.appendChild(info);
      return;
    }

    var hp = el('div', 'ba-hp');
    // 09/10: o escudo deixou de ser um chip "N" com o escudinho no canto — é o trecho AZUL da
    // própria barra (barraPv), e o texto diz "110 +30 / 150"
    hp.appendChild(barraPv(u));
    info.appendChild(hp);

    var res = el('div', 'ba-res');
    var paw = el('div', 'res pa-res');
    paw.appendChild(el('span', 'res-lb', tr('PA')));
    paw.appendChild(pips(u.pa, u.paMax, 'p-pa'));
    tipOn(paw, tr('Pontos de Ataque'), tr('Cada feitiço custa PA. Voltam ao máximo no começo do seu turno.'), '#ffb15c');
    res.appendChild(paw);
    var ppw = el('div', 'res pp-res');
    ppw.appendChild(el('span', 'res-lb', tr('PP')));
    ppw.appendChild(pips(u.pp, u.ppMax, 'p-pp'));
    // [U6] PP zerado com motivo à vista. Sem isto o jogador via "0 / 3" no
    // começo do próprio turno e concluía que o PP não recarrega — quando o que
    // houve foi `root` (prende o turno inteiro) ou uma FIXAÇÃO mal-sucedida,
    // que leva todo o PP restante sem tirar ninguém do lugar (contrato §2).
    if (u.pp <= 0) {
      var why = el('span', 'res-why', hasEff(u, 'root') ? 'preso' : tr('sem passo'));
      why.setAttribute('style', 'font:700 10px var(--ui-sans);color:#e2665a;margin-left:4px');
      ppw.appendChild(why);
    }
    tipOn(ppw, tr('Pontos de Passos'),
      tr('Cada célula andada gasta 1 PP. Voltam ao máximo no começo do seu turno — salvo se você estiver <b>preso</b> (0 PP o turno todo). Sair de célula colada num inimigo é um teste de esquiva: falhando, você <b>perde todo o PP e não sai do lugar</b>.'), '#7ef0d4');
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
    root:      { txt: tr('Preso'),      cor: '#e2665a' },
    poison:    { txt: tr('Veneno'),     cor: '#8fd14f' },
    regen:     { txt: tr('Regen'),      cor: '#7ef0d4' },
    taunt:     { txt: tr('Provocado'),  cor: '#ffb15c' },
    invisible: { txt: tr('Invisível'),  cor: '#9be0ff' },
    reflect:   { txt: tr('Reflexo'),    cor: '#c8a2ff' },
    resist:    { txt: tr('Resist.'),    cor: '#9be0ff' }
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
      if (ef.type === 'shield') continue;                 // já aparece na barra de PV (o trecho azul, 09/10)
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
    if (marcas) { row.appendChild(chip(tr('Marcado ×{marcas}', { marcas: marcas }), '#ff8a24')); n++; }
    return n ? row : null;
  }

  /* O TEMPO DO TURNO NA LATERAL (11/09, pedido do dono: "na lateral do jogo
   * apareça a barra do tempo do turno passando e o tempo decrescendo"). Roda a
   * cada quadro (UI.update). A barra ESVAZIA com os segundos do turno; o tempo
   * guardado aparece à parte ("+12s") e, acabados os segundos do turno, a barra
   * vira o banco (azul) e esvazia de novo. Antes a barra media o total contra
   * os 30 s e ficava cheia enquanto houvesse banco — parecia parada. */
  function paintTimer() {
    pintaEspera();                        // 11/09: o relógio estimado da vez do parceiro
    if (!bt.timer || !bt.tmNum) return;
    var g = G();
    if (!g) return;
    var isMine = !!safe(function () { return g.isPlayerTurn(); }, false);
    var left = Math.max(0, safe(function () { return g.timeLeft(); }, 0) || 0);
    var banked = Math.max(0, g.banked || 0);
    var turn = g.turnTime || 30;
    var doTurno = left - banked;          // o que ainda resta dos segundos do turno
    var noBanco = isMine && doTurno <= 0 && banked > 0;
    var pct = Math.max(0, Math.min(1, noBanco ? left / banked : doTurno / turn));
    var cls = 'bt-timer' + (isMine ? '' : ' is-idle') + (noBanco ? ' is-banco' : '') +
              (isMine && left <= 5 ? ' is-low' : (isMine && !noBanco && pct <= 0.5 ? ' is-meio' : ''));
    if (bt.timer.className !== cls) bt.timer.className = cls;
    var txt = Math.ceil(left) + 's';
    if (bt.tmNum.textContent !== txt) bt.tmNum.textContent = txt;
    var fr = pct.toFixed(4);
    bt.tmFill.style.transform = 'scaleY(' + fr + ')';
    // 06/10: no celular deitado a barra é DEITADA, no alto do cartão da vez — o css lê a mesma fração daqui
    // (só no toque: no PC esta linha não escreve nada)
    if (bt.tmFr !== fr && JOGO.Mobile && JOGO.Mobile.toque && JOGO.Mobile.toque()) { bt.tmFr = fr; bt.tmFill.style.setProperty('--tm-p', fr); }
    var bk = (banked > 0 && !noBanco) ? '+' + Math.round(banked) + 's' : '';
    if (bt.tmBank.textContent !== bk) { bt.tmBank.textContent = bk; bt.tmBank.hidden = !bk; }
    // o pé da barra fica logo acima da barra de baixo, pela altura MEDIDA dela
    // (no celular ela cresce com a fusão): nunca por cima do "Encerrar turno"
    var hb = bt.bottomBar ? bt.bottomBar.offsetHeight : 0;
    var pe = hb ? (hb + 10) + 'px' : '';
    if (bt.timer.style.bottom !== pe) bt.timer.style.bottom = pe;
  }

  function paintSpells(s) {
    // a barra é refeita: um balão preso a um botão que vai sumir fecha junto
    if (tipOwner && bt.spells && bt.spells.contains(tipOwner)) hideTip();
    clear(bt.spells);
    var u = activeUnit();
    var mine = safe(function () { return G().isPlayerTurn(); }, false);
    if (!u || !mine) {
      bt.spells.appendChild(esperaNaBarra(u));      // 11/09: "Vez de Bia — esperando o lance…"
      bt.endBtn.classList.add('is-off');
      marcaRolagemFeiticos();
      return;
    }
    bt.endBtn.classList.remove('is-off');
    var sel = safe(function () { return G().selectedSpellId; }, null);
    var list = u.spells || [];
    if (!list.length) bt.spells.appendChild(el('div', 'bt-wait', tr('Sem feitiços.')));
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
        if (cd > 0) { toast(tr('Recarregando: {cd}{a}', { cd: cd, a: cd > 1 ? ' rodadas.' : ' rodada.' })); return; }
        if (u.pa < cost) { toast(tr('PA insuficiente ({cost} necessários).', { cost: cost })); return; }
        safe(function () { G().selectSpell(sid); }, null);
        battleSig = '';
        paintBattle(true);
      });
      // 08/10: o botãozinho "i" saiu (o dono acertava nele ao escolher o ataque); a explicação
      // abre SEGURANDO o botão (dedo) ou parando o mouse em cima — seguraParaVer
      seguraParaVer(cell, spellName(d2, sid), spellTipBody(d2, sid, u), d2 ? elemColor(d2.element) : '#ffd08a');
      bt.spells.appendChild(cell);
    });
    // 13/09: a barra da batalha não tem mais poção — ela se bebe fora da luta (vidaBloco, 14/09)
    marcaRolagemFeiticos();
  }
  /* 06/10: no celular deitado os feitiços moram numa fileira só, entre o "Encerrar turno" e o ☰. Quando não
   * cabem, a faixa rola de lado — e a ponta da direita esmaece (css .bt-spells.is-rola) para dizer que há
   * mais; chegando ao fim, o esmaecido sai. Medido aqui, a cada pintura dos feitiços e a cada rolagem do
   * dedo: nada de relógio. */
  function marcaRolagemFeiticos() {
    var c = bt.spells;
    if (!c) return;
    if (!c._rola) {
      c._rola = true;
      c.addEventListener('scroll', marcaRolagemFeiticos, { passive: true });
    }
    var sobra = c.scrollWidth - c.clientWidth - c.scrollLeft;
    c.classList.toggle('is-rola', c.scrollWidth > c.clientWidth + 2 && sobra > 4);
  }

  // `quem` (opcional): a unidade que vai lançar — só a barra da batalha o passa
  UI._spellTipBody = function (d2, sid, quem) { return spellTipBody(d2, sid, quem); };   // provas (muro_visual.html)
  function spellTipBody(d2, sid, quem) {
    if (!d2) return tr('Este feitiço não pôde ser carregado.');
    var out = '<i>' + tr('{a} PA', { a: d2.paCost || 0 });
    if (d2.range) out += ' ' + tr('· alcance {a}–{b}', { a: d2.range.min || 0, b: d2.range.max || 0 });
    if (d2.cooldown) out += ' ' + tr('· recarga {cooldown}', { cooldown: d2.cooldown });
    if (d2.castsPerTurn) out += ' · ' + d2.castsPerTurn + '×/turno';
    out += '</i><br>' + esc(d2.description || '');
    /* 03/10: OS ESPINHOS (engine.js, "O MURO QUE FERE QUEM ENCOSTA"). O feitiço de classe já diz o
     * número na descrição; a forma de fusão tem uma descrição só para todas as misturas e níveis, e
     * o número dela muda com eles — a linha sai do próprio efeito, como o motor o usa. */
    var muroEf = null;
    (d2.effects || []).forEach(function (ef) { if (ef && ef.type === 'wall' && ef.fere > 0) muroEf = ef; });
    if (muroEf && d2.fusion) {
      out += '<br>' +
        tr('<b>Espinhos:</b> a pedra fere {fere} (mais o poder) quem do outro lado terminar a vez encostado nela ou for jogado contra ela.', { fere: muroEf.fere });
    }
    /* 03/10 (revisão): o 30 da descrição é a BASE, como o "16–22" de qualquer golpe; o espinho que a
     * pedra leva é ele vezes o poder de quem ergue (34 no nível 5, 56 no 30). Na barra da batalha,
     * com quem vai erguer na mão, a ficha diz o número que a pedra vai ferir AGORA — a mesma conta do
     * motor (Engine.fereDoMuro), e não uma cópia dela. */
    if (muroEf && quem) {
      var fereAgora = safe(function () { return E().fereDoMuro(G().state, quem, d2, muroEf); }, 0);
      if (fereAgora > 0) out += '<br>' + tr('<b>Espinhos agora:</b> com o seu poder, a pedra fere {fereAgora}.', { fereAgora: fereAgora });
    }
    if (d2.aoe && d2.aoe.shape && d2.aoe.shape !== 'single') {
      out += '<br>' + tr('Área: {a} {b}', { a: esc(d2.aoe.shape), b: d2.aoe.size || '' });
    }
    if (d2.flavor) out += '<br><em>' + esc(d2.flavor) + '</em>';
    return out;
  }

  /* os números da fusão vêm do motor dela (10/09, decisão D7): a HUD dizia
   * "+2 PA" e a fusão dá +4 — texto copiado à mão envelhece calado */
  function fusaoNum(k, def) {
    var F = JOGO.Fusion;
    return (F && typeof F[k] === 'number' && isFinite(F[k])) ? F[k] : def;
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
    /* 12/09: o botão só aparece para heróis do MESMO jogador. A fusão com o
     * herói do parceiro — que de 11/09 até aqui era um pedido com os dois
     * aceitando — não existe mais, então o `Game.canFuse` nem devolve o par e
     * não há mais nada a desenhar aqui. */
    var t = el('div', 'fu-txt');
    t.appendChild(el('b', null, 'FUNDIR'));
    t.appendChild(el('span', null, esc(className(ca)) + ' + ' + esc(className(cb))));
    cell.appendChild(t);
    tap(cell, function () {
      confirmSheet(tr('Fundir os dois heróis?'),
        tr('Vira <b>uma única unidade</b>: vida somada, +{a} PA, +{b} PP, +{c} de escudo e feitiços de fusão. Custa {d} PA e <b>encerra o turno</b>. Se um deles se afastar antes do fim, não acontece nada.', { a: fusaoNum('BONUS_PA', 4), b: fusaoNum('BONUS_PP', 1), c: fusaoNum('BONUS_SHIELD', 50), d: fusaoNum('FUSION_PA_COST', 2) }),
        function () {
          var ok = safe(function () { return G().declareFusion(pr.uidA, pr.uidB); }, false);
          if (!ok) toast(tr('A fusão não pôde ser declarada.'));
          else toast(tr('Fusão declarada — encerrando o turno.'), 'good');
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
    var tinhaFoco = sheetEl.contains(document.activeElement);
    sheetEl.classList.remove('is-on');
    sheetName = null;
    marcaDock(null);
    hideTip();
    pintaPedido();                 // 06/10: a mesa de troca que ficou aberta ganha o caminho de volta
    // 02/10: o foco volta a quem abriu a ficha — só se ele estava DENTRO
    // dela (fechar por um clique lá fora não rouba o foco de ninguém)
    var volta = sheetDeQuem;
    sheetDeQuem = null;
    if (tinhaFoco) {
      try {
        if (volta && volta.isConnected) volta.focus({ preventScroll: true });
        else document.activeElement.blur();
      } catch (e) {}
    }
  }
  /* O BANCO — agora do jeito pedido: o saco do grupo de um lado,
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
  /* SELECIONAR VÁRIAS (08/10 à noite — o dono: "tem que ter um jeito de transferir vários itens para o banco
   * ou quebrar vários de uma vez, não um por um"). No banco: o botão "Selecionar várias" liga o modo; o toque
   * marca a pilha (✓) em vez de arrastar; a barra de cada coluna diz quantas e guarda/saca TODAS as cópias das
   * marcadas de uma vez (índices em ordem decrescente, uma op da autoridade por cópia). `bancoMarcadas` guarda
   * as chaves (lado|itemId|level|stars|extra) e sobrevive ao redesenho. */
  var bancoVarios = false, bancoMarcadas = {};
  function chaveDaPilha(lado, pilha) { return lado + '|' + pilha.itemId + '|' + (pilha.level || 0) + '|' + (pilha.stars || 0) + '|' + (pilha.extra || ''); }
  function bancoCelula(pilha, lado, transferir) {
    var it = itemDef(pilha.itemId) || {};
    var marcada = bancoVarios && !!bancoMarcadas[chaveDaPilha(lado, pilha)];
    var cell = el('div', 'ig-cell bk2-cel ' + starClass(pilha.stars) + (bancoVarios ? ' is-marcavel' : '') + (marcada ? ' is-marcada' : ''));
    if (marcada) cell.appendChild(el('i', 'bk2-marca', '✓'));
    if (bancoVarios) {
      // no modo de seleção o toque só marca/desmarca (sem arrasto, sem os dois toques)
      tap(cell, function () {
        var k = chaveDaPilha(lado, pilha);
        if (bancoMarcadas[k]) delete bancoMarcadas[k]; else bancoMarcadas[k] = true;
        cell.classList.toggle('is-marcada', !!bancoMarcadas[k]);
        var m = cell.querySelector('.bk2-marca');
        if (bancoMarcadas[k] && !m) cell.appendChild(el('i', 'bk2-marca', '✓'));
        else if (!bancoMarcadas[k] && m) m.remove();
        var ev = document.createEvent('Event'); ev.initEvent('bancomarca', true, false); cell.dispatchEvent(ev);
      });
    }
    markRarity(cell, it.rarity);
    var plate = el('span', 'ig-plate');
    plate.appendChild(art('itemIcon', [pilha.itemId, 44], 44));
    var bset = setBadge(pilha.itemId, true);   // mudo: o gesto da célula é o arrasto
    if (bset) plate.appendChild(bset);
    cell.appendChild(plate);
    if (pilha.count > 1) cell.appendChild(el('span', 'ig-n', '×' + pilha.count));
    if (pilha.level) cell.appendChild(el('span', 'ig-lv', '+' + pilha.level));
    if (pilha.extra) cell.appendChild(el('span', 'ig-gema', '◆'));
    if (pilha.stars) cell.appendChild(starPips(pilha.stars));
    cell.appendChild(el('span', 'ig-nm', esc(it.name || pilha.itemId)));
    cell.setAttribute('data-rot', (itemDef(pilha.itemId) || {}).name || pilha.itemId);   // 08/10 à noite: o nome no balão (a grade compacta o esconde)
    legendaNoToque(cell);
    var nvB = nvBadge(pilha.itemId);
    if (nvB) cell.appendChild(nvB);
    tipOn(cell, it.name || pilha.itemId,
      itemTipBody(pilha.itemId, pilha.level, pilha.stars, pilha.extra), rarColor(it.rarity));

    var draga = null;
    function limpaAlvo() {
      var m = document.querySelector('.bk2-col.is-alvo');
      if (m) m.classList.remove('is-alvo');
    }
    cell.addEventListener('pointerdown', function (ev) {
      if (bancoVarios) return;                     // 08/10 à noite: no modo de seleção o toque só marca
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
      if (bancoVarios || !draga) return;
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
      var ok = el('button', 'btn-mini btn-gold', tr('Mover'));
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
    var grid = el('div', 'bk2-grid grade-icones');     // 08/10 à noite: só ícones, como o inventário limpo
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
    var body = sheetShell(tr('Banco do Acampamento'),
      tr('O que está no cofre não desce com você — e por isso nunca se perde.'));
    // duas grades em 720px viram espremido; a ficha do banco alarga
    var painel = sheetEl.querySelector('.sheet-panel');
    if (painel) painel.classList.add('sheet-larga');
    var DBc = JOGO.DB;
    if (!DBc) { body.appendChild(el('p', 'inv-dica', tr('A conta local não carregou.'))); return; }

    var caixa = el('div', 'bk-caixa');
    body.appendChild(caixa);

    Promise.all([DBc.moedas(), DBc.banco()]).then(function (r) {
      var bolso = r[0], cofre = r[1];
      clear(caixa);

      // ---- O DINHEIRO: bolso | quantia digitada + guardar/sacar | cofre
      var moedas = el('div', 'bk-moedas');
      var ladoBolso = el('div', 'bk-lado');
      ladoBolso.appendChild(el('h3', null, tr('No bolso')));
      ladoBolso.appendChild(el('div', 'bk-valor', String(bolso)));
      var ladoCofre = el('div', 'bk-lado');
      ladoCofre.appendChild(el('h3', null, tr('No cofre')));
      ladoCofre.appendChild(el('div', 'bk-valor', String(cofre.moedas)));

      var meio = el('div', 'bk-meio bk2-meio');
      var campo = document.createElement('input');
      campo.type = 'number'; campo.min = '1'; campo.step = '1';
      campo.placeholder = tr('quantia');
      campo.className = 'bk2-qtd';
      campo.value = bancoQtd;
      campo.addEventListener('input', function () { bancoQtd = campo.value; });
      meio.appendChild(campo);

      function quantia() {
        var n2 = Math.floor(Number(campo.value));
        if (!isFinite(n2) || n2 <= 0) { toast(tr('digite a quantia')); campo.focus(); return 0; }
        return n2;
      }
      function moveMoedas(op, valorDeposito) {
        op.then(function (res) {
          if (!res.ok) toast(res.erro || tr('não deu'));
          else {
            bancoQtd = '';                 // deu certo: o campo limpa
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
      linhaB.appendChild(btn(tr('Guardar →'), 'btn-mini', function () {
        var n2 = quantia(); if (n2) moveMoedas(DBc.depositarMoedas(n2), n2);
      }));
      linhaB.appendChild(btn(tr('← Sacar'), 'btn-mini', function () {
        var n2 = quantia(); if (n2) moveMoedas(DBc.sacarMoedas(n2));
      }));
      meio.appendChild(linhaB);
      var linhaT = el('div', 'bk2-botoes');
      linhaT.appendChild(btn(tr('tudo →'), 'btn-mini bk2-tudo', function () {
        if (bolso > 0) moveMoedas(DBc.depositarMoedas(bolso), bolso);
        else toast(tr('o bolso está vazio'));
      }));
      linhaT.appendChild(btn(tr('← tudo'), 'btn-mini bk2-tudo', function () {
        if (cofre.moedas > 0) moveMoedas(DBc.sacarMoedas(cofre.moedas));
        else toast(tr('o cofre está vazio'));
      }));
      meio.appendChild(linhaT);

      moedas.appendChild(ladoBolso);
      moedas.appendChild(meio);
      moedas.appendChild(ladoCofre);
      caixa.appendChild(moedas);

      // ---- AS DUAS GRADES, lado a lado
      var dicaB = el('p', 'inv-dica bk2-dica', bancoVarios
        ? tr('Toque nas peças para marcar; a barra de cada lado guarda ou saca todas as marcadas de uma vez.')
        : tr('Arraste uma peça de uma grade para a outra — cada viagem leva uma unidade. Dois toques rápidos também transferem.'));
      dicaB.appendChild(btn(bancoVarios ? tr('Sair da seleção') : tr('Selecionar várias'), 'btn-mini bk2-varios' + (bancoVarios ? ' is-on' : ''), function () {
        bancoVarios = !bancoVarios;
        bancoMarcadas = {};
        sheetBanco();
      }));
      caixa.appendChild(dicaB);

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

      // o filtro por elemento (e, desde 22/09, o por espaço) vale para AS
      // DUAS grades de uma vez — quem procura a peça de água não quer caçá-la
      // em dois lugares. Filtrar não mexe nos `indices` das pilhas: guardar e
      // sacar continuam achando a posição real no saco e no cofre.
      // 08/10 à noite: os mesmos seletores do inventário limpo (espaço e elemento)
      caixa.appendChild(seletoresDeItem(bancoSlotFiltro, function (s) {
        bancoSlotFiltro = s;
        sheetBanco();
      }, bancoElemFiltro, function (e2) {
        bancoElemFiltro = e2;
        sheetBanco();
      }));
      // busca ao vivo nas DUAS grades (o `duplo` é atribuído logo abaixo,
      // antes de qualquer tecla poder chegar)
      caixa.appendChild(buscaInput(bancoBusca, function (t) {
        bancoBusca = t;
        aplicaBusca(duplo, t);
      }));
      function passaBanco(pi) {
        return passaSlot(pi.itemId, bancoSlotFiltro) && passaElemento(pi.itemId, bancoElemFiltro);
      }
      pilhas = pilhas.filter(passaBanco);
      pilhasCofre = pilhasCofre.filter(passaBanco);
      var duplo = el('div', 'bk2-duplo');

      // 08/10 à noite: a barra das marcadas de cada coluna (quantas, e o botão que move todas)
      function barraMarcadas(lado, pilhasDoLado, aoMover) {
        var barra = el('div', 'bk2-barra-varios');
        function pinta() {
          clear(barra);
          var marc = pilhasDoLado.filter(function (pi) { return !!bancoMarcadas[chaveDaPilha(lado, pi)]; });
          var n = 0;
          marc.forEach(function (pi) { n += pi.count; });
          barra.appendChild(el('span', 'bk2-varios-n', marc.length
            ? tr('<b>{a}</b> pilha(s) · <b>{n}</b> peça(s) marcada(s)', { a: marc.length, n: n })
            : tr('Toque nas peças para marcar.')));
          var b = btn(lado === 'saco' ? tr('Guardar as marcadas →') : tr('← Sacar as marcadas'), 'btn-mini btn-gold' + (marc.length ? '' : ' is-off'), function () {
            if (!marc.length) return;
            b.classList.add('is-off');
            aoMover(marc, n);
          });
          barra.appendChild(b);
        }
        pinta();
        barra.addEventListener('bancomarca', pinta);
        return barra;
      }
      var colSaco = el('div', 'bk2-col');
      colSaco.dataset.lado = 'saco';
      var limSaco = safe(function () { return P().bagLimit(); }, 0);
      colSaco.appendChild(el('h3', 'bk-tit', tr('No saco ({unidadesSaco}{a})', { unidadesSaco: unidadesSaco, a: limSaco ? ' / ' + limSaco : '' })));
      if (bancoVarios) {
        colSaco.appendChild(barraMarcadas('saco', pilhas, function (marc) {
          // todas as cópias das pilhas marcadas, do índice maior para o menor (o splice não desloca o que falta)
          var st2 = P().state, idxs = [];
          marc.forEach(function (pi) { pi.indices.forEach(function (i) { idxs.push(i); }); });
          idxs.sort(function (a, b2) { return b2 - a; });
          var fila = Promise.resolve(), movidas = 0;
          idxs.forEach(function (idx) {
            fila = fila.then(function () {
              var entrada = st2.inventory[idx];
              if (!entrada) return null;
              if (JOGO.Autoridade) JOGO.Autoridade.op('depositarItem', { invIndex: idx });
              st2.inventory.splice(idx, 1);
              movidas++;
              return DBc.depositarItem(entrada);
            });
          });
          fila.then(function () {
            safe(function () { P().save(); }, null);
            bancoMarcadas = {};
            toast(tr('{n} peça(s) guardada(s) no cofre.', { n: movidas }), 'good');
            sheetBanco();
          });
        }));
      }
      colSaco.appendChild(bancoGrade(pilhas, 'saco', function (pi) {
        var st2 = P().state;
        var entrada = st2.inventory[pi.indices[0]];
        if (!entrada) { toast(tr('essa peça já saiu')); sheetBanco(); return; }
        // 13/09: com sessão, a mesma guarda roda no servidor (antes de o índice mudar aqui)
        if (JOGO.Autoridade) JOGO.Autoridade.op('depositarItem', { invIndex: pi.indices[0] });
        st2.inventory.splice(pi.indices[0], 1);
        safe(function () { P().save(); }, null);
        DBc.depositarItem(entrada).then(function () { sheetBanco(); });
      }));

      var colCofre = el('div', 'bk2-col');
      colCofre.dataset.lado = 'cofre';
      colCofre.appendChild(el('h3', 'bk-tit', tr('No cofre ({length})', { length: cofre.itens.length })));
      if (bancoVarios) {
        colCofre.appendChild(barraMarcadas('cofre', pilhasCofre, function (marc, n) {
          if (!safe(function () { return P().bagFree(n); }, true)) {
            toast(tr('O saco não tem {n} vaga(s) — guarde ou quebre alguma coisa antes.', { n: n }));
            sheetBanco();
            return;
          }
          var idxs = [];
          marc.forEach(function (pi) { pi.indices.forEach(function (i) { idxs.push(i); }); });
          idxs.sort(function (a, b2) { return b2 - a; });
          var fila = Promise.resolve(), movidas = 0;
          idxs.forEach(function (idx) {
            fila = fila.then(function () {
              if (JOGO.Autoridade) JOGO.Autoridade.op('sacarItem', { indice: idx });
              return DBc.sacarItem(idx).then(function (res) {
                if (!res || !res.ok || !res.item) return;
                P().state.inventory.push(P().carimba ? P().carimba(res.item, 'banco') : res.item);
                movidas++;
              });
            });
          });
          fila.then(function () {
            safe(function () { P().save(); }, null);
            bancoMarcadas = {};
            toast(tr('{n} peça(s) de volta no saco.', { n: movidas }), 'good');
            sheetBanco();
          });
        }));
      }
      colCofre.appendChild(bancoGrade(pilhasCofre, 'cofre', function (pi) {
        // o saco tem fundo (25/08): sacar do cofre só com vaga
        if (!safe(function () { return P().bagFree(1); }, true)) {
          toast(tr('O saco está cheio — não cabe mais nada.'));
          return;
        }
        if (JOGO.Autoridade) JOGO.Autoridade.op('sacarItem', { indice: pi.indices[0] });
        DBc.sacarItem(pi.indices[0]).then(function (res) {
          if (!res.ok) { toast(res.erro || tr('não deu')); sheetBanco(); return; }
          var st3 = P().state;
          st3.inventory.push(P().carimba ? P().carimba(res.item, 'banco') : res.item);
          safe(function () { P().save(); }, null);
          sheetBanco();
        });
      }));

      // 08/10 à noite (o dono: "os itens do banco do lado esquerdo e o inventário do lado direito, como
      // se fosse dois inventários"): o cofre à esquerda, o saco à direita
      duplo.appendChild(colCofre);
      duplo.appendChild(colSaco);
      caixa.appendChild(duplo);
      if (bancoBusca) aplicaBusca(duplo, bancoBusca);
    });
  }

  /* O QUADRO DE MISSÕES — diárias em cima, conquistas embaixo, e o seletor
   * de título no pé. Toda leitura vem de JOGO.Missoes por Promise e a ficha
   * redesenha quando a resposta chega, como o banco. */
  /* A TRILHA DA TEMPORADA (07/10, js/core/trilha.js ↔ servidor/trilha.py): a trilha gratuita de recompensas
   * por jogar — os pontos nascem no servidor (sala vencida, duelo ranqueado, tentativa do Eco, missão
   * reivindicada) e cada degrau de 150 se resgata aqui. Mora no quadro de Missões, acima das diárias: é o
   * mesmo "o que eu vim fazer hoje". Sem sessão do site, nada aparece. */
  function trilhaBloco(caixa) {
    var T = JOGO.Trilha;
    if (!T || !T.ler) return;
    var bloco = el('div', 'trilha');
    caixa.appendChild(bloco);
    function pinta(t) {
      clear(bloco);
      if (!t || !Array.isArray(t.degraus)) { bloco.remove(); return; }
      var alcancados = t.degraus.filter(function (d) { return d.alcancado; }).length;
      var proximo = t.degraus.filter(function (d) { return !d.alcancado; })[0] || null;
      var prontos = t.degraus.filter(function (d) { return d.alcancado && !d.resgatado; });
      var cab = el('div', 'trilha-cab');
      cab.appendChild(el('h3', 'hs-sec', tr('Trilha da temporada {n}', { n: t.temporada })));
      cab.appendChild(el('span', 'trilha-pts', tr('<b>{a}</b> pontos · {b} de {c} degraus', { a: t.pontos, b: alcancados, c: t.degraus.length })));
      bloco.appendChild(cab);
      var barra = el('div', 'trilha-barra');
      var topo = t.degraus[t.degraus.length - 1].pontos;
      var cheio = el('i'); cheio.style.width = Math.max(0, Math.min(100, 100 * t.pontos / Math.max(1, topo))) + '%';
      barra.appendChild(cheio);
      bloco.appendChild(barra);
      var fila = el('div', 'trilha-degraus');
      t.degraus.forEach(function (d) {
        var cel = el('button', 'trilha-degrau' + (d.resgatado ? ' is-resgatado' : (d.alcancado ? ' is-pronto' : '')) +
                                (d.n % 5 === 0 ? ' is-grande' : ''));
        cel.type = 'button';
        cel.innerHTML = '<b>' + d.n + '</b>' + (d.resgatado ? '<span>✓</span>' : (d.alcancado ? '<span>★</span>' : '<span>' + d.pontos + '</span>'));
        var premios = (d.premios || []).map(function (p) { return esc(T.nomeDoPremio(p)); }).join(' · ');
        tipOn(cel, tr('Degrau {n} — {p} pontos', { n: d.n, p: d.pontos }), premios + (d.resgatado ? '<br>' + tr('Já resgatado.') : (d.alcancado ? '<br>' + tr('Toque para resgatar.') : '')),
              d.resgatado ? '#7fe08a' : (d.alcancado ? '#ffc44d' : '#9fd3ff'));
        if (d.alcancado && !d.resgatado) {
          cel.addEventListener('click', function () {
            cel.classList.add('is-off');
            T.resgatar(d.n).then(function (r) {
              if (!r || !r.ok) { toast((r && r.erro) || tr('não deu')); cel.classList.remove('is-off'); return; }
              toast(tr('Degrau {n} resgatado: {p}', { n: d.n, p: premios }), 'good');
              pinta(r);
            });
          });
        }
        fila.appendChild(cel);
      });
      bloco.appendChild(fila);
      var v = t.valores || {};
      var sub = proximo
        ? tr('Faltam <b>{a}</b> pontos para o degrau {n}: {p}', { a: proximo.pontos - t.pontos, n: proximo.n,
            p: (proximo.premios || []).map(function (p) { return esc(T.nomeDoPremio(p)); }).join(' · ') })
        : tr('Trilha completa nesta temporada!');
      if (prontos.length) sub = tr('<b>{a}</b> {b} para resgatar — toque na estrela. ', { a: prontos.length, b: prontos.length === 1 ? tr('degrau') : tr('degraus') }) + sub;
      bloco.appendChild(el('p', 'inv-dica', sub));
      bloco.appendChild(el('p', 'trilha-regra', tr('Sala vencida +{s} (desafio, difícil e afixo: +{x} cada) · duelo ranqueado +{d} (+{dv} se vencer) · tentativa do Eco +{e} · missão diária +{m}. A temporada vira em {dias} dias.',
        { s: v.sala || 10, x: v.desafio || 5, d: v.duelo || 15, dv: v['duelo-venceu'] || 10, e: v.eco || 20, m: v.missao || 5,
          dias: Math.max(0, Math.ceil((t.fim - Date.now()) / 86400000)) })));
    }
    bloco.appendChild(el('p', 'inv-dica', tr('Lendo a trilha…')));
    T.ler().then(pinta, function () { bloco.remove(); });
  }

  /* O PRÊMIO DIÁRIO (08/10, o dono: "prêmios diários de resgate para quem entra todos os dias — vinténs,
   * 10 dias seguidos barra de ouro"). Um bloco no alto do Quadro: a sequência, os dez dias da dezena
   * atual como cartõezinhos (o de hoje aceso, os feitos riscados) e o botão de resgatar. Tudo vem do
   * servidor (js/core/premio_diario.js); sem sessão o bloco nem aparece. */
  var diarioAvisado = null;
  /* a ficha própria do prêmio (abre sozinha ao chegar à praça; também pela Missões) */
  function sheetDiario() {
    sheetName = 'diario';
    var body = sheetShell(tr('Prêmio diário'), tr('Um prêmio por dia, na ordem do calendário — resgate o de hoje e veja os próximos.'));
    diarioBloco(body);
    body.appendChild(btn(tr('Ver o Quadro de Missões'), 'btn-ghost btn-block', function () { openSheet('missoes'); }));
  }
  function diarioBloco(caixa) {
    var Dd = JOGO.PremioDiario;            // 08/10 à noite: o prêmio diário (JOGO.Diario é o Calabouço do Dia)
    if (!Dd || !Dd.ler) return;
    var bloco = el('div', 'diario');
    caixa.appendChild(bloco);
    function temBarra(c) { return (c.premios || []).some(function (p) { return p.tipo === 'barras'; }); }
    function pinta(d) {
      if (!d) { bloco.remove(); return; }
      clear(bloco);
      var h = d.hoje || {};
      var cab = el('div', 'diario-cab');
      cab.appendChild(el('h3', 'hs-sec', tr('Prêmio diário') + ' <small>' + tr('dia {a} de {b}', { a: h.dia, b: d.ciclo }) + '</small>'));
      cab.appendChild(el('span', 'diario-seq', d.sequencia > 0
        ? tr('<b>{a}</b> resgate(s) neste mês', { a: d.sequencia })
        : tr('comece hoje')));
      bloco.appendChild(cab);
      bloco.appendChild(el('p', 'inv-dica', tr('Um resgate por dia, na ordem: os vinténs crescem a cada resgate, fragmentos no 3º e no 7º, pedras no 5º e uma barra de ouro no 10º, no 20º e no 30º. A ordem segue de onde parou e recomeça no dia 1 de cada mês.')));
      var ini = Math.floor((h.dia - 1) / 10) * 10;
      var fila = el('div', 'diario-dias');
      (d.calendario || []).slice(ini, ini + 10).forEach(function (c) {
        var cel = el('button', 'diario-dia' + (c.feito ? ' is-feito' : '') + (c.hoje ? ' is-hoje' : '') + (temBarra(c) ? ' is-grande' : ''));
        cel.type = 'button';
        cel.appendChild(el('b', null, String(c.dia)));
        var ic = temBarra(c) ? '\uD83E\uDD47'
               : (c.premios || []).some(function (p) { return p.tipo === 'pedras' && /gem-frag/.test(p.alvo); }) ? '\u25C6'
               : (c.premios || []).some(function (p) { return p.tipo === 'pedras'; }) ? '\u25C8' : '\u25CF';
        cel.appendChild(el('span', 'diario-ic', ic));
        tipOn(cel, tr('Dia {a}', { a: c.dia }), esc(Dd.nomesDoDia(c)) + (c.feito ? '<br><i>' + tr('resgatado') + '</i>' : ''), '#ffd36a');
        fila.appendChild(cel);
      });
      bloco.appendChild(fila);
      var rodape = el('div', 'diario-rodape');
      rodape.appendChild(el('span', 'diario-hoje', tr('Hoje: <b>{a}</b>', { a: esc(Dd.nomesDoDia(h)) })));
      if (h.resgatado) {
        rodape.appendChild(el('span', 'chip chip-ok', tr('resgatado — volte amanhã')));
      } else {
        var go = btn(tr('Resgatar'), 'btn-primary btn-mini diario-go', function () {
          go.classList.add('is-off');
          Dd.resgatar().then(function (r) {
            if (!r || !r.ok) {
              toast((r && r.motivo === 'ja-resgatado') ? tr('O prêmio de hoje já foi resgatado. Volte amanhã!') : ((r && r.erro) || tr('Não deu para resgatar agora.')));
              Dd.ler(true).then(pinta);
              return;
            }
            toast(tr('Prêmio do dia {a}: {b}', { a: r.resgatou, b: esc(Dd.nomesDoDia({ premios: r.premios })) }), 'good');
            pinta(r);
          });
        });
        rodape.appendChild(go);
      }
      bloco.appendChild(rodape);
    }
    Dd.ler().then(pinta);
  }

  function sheetMissoes() {
    sheetName = 'missoes';
    var body = sheetShell(tr('Quadro de Missões'),
      tr('As diárias mudam a cada dia; as conquistas ficam. Prêmio em vinténs — e as conquistas dão TÍTULO.'));
    var Ms = JOGO.Missoes;
    if (!Ms) { body.appendChild(el('p', 'inv-dica', tr('O quadro não carregou.'))); return; }

    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);

    Promise.all([Ms.carregar(),
                 JOGO.DB ? JOGO.DB.jogador() : Promise.resolve({})])
      .then(function (r) {
        var quadro = r[0], jog = r[1] || {};
        clear(caixa);
        diarioBloco(caixa);           // 08/10: o prêmio diário de resgate, no alto (só com o servidor)
        trilhaBloco(caixa);           // 07/10: a trilha da temporada, acima das diárias (só com o servidor)
        if (!quadro) { caixa.appendChild(el('p', 'inv-dica', tr('A conta local não carregou.'))); return; }

        function linha(id, def, st2) {
          var row = el('div', 'ms-linha' + (st2.prog >= def.alvo ? ' is-feita' : ''));
          var tx = el('div', 'ms-tx');
          tx.appendChild(el('div', 'ms-nome', esc(def.texto)));
          var barra = el('div', 'ms-barra');
          var cheio = el('i', null, '');
          cheio.style.width = Math.min(100, Math.round(100 * st2.prog / def.alvo)) + '%';
          barra.appendChild(cheio);
          tx.appendChild(barra);
          tx.appendChild(el('div', 'ms-prog', tr('{prog} de {alvo}', { prog: st2.prog, alvo: def.alvo })));
          row.appendChild(tx);
          if (st2.pago) {
            row.appendChild(el('span', 'ms-pago', '✓ recebido'));
          } else if (st2.prog >= def.alvo) {
            row.appendChild(btn(tr('Receber {premio}', { premio: def.premio }) + 'v', 'btn-mini btn-gold', function () {
              Ms.reivindicar(id).then(function (res) {
                if (!res.ok) toast(res.erro || tr('não deu'));
                else toast(tr('+{premio} vinténs', { premio: res.premio }), 'good');
                sheetMissoes();
              });
            }));
          } else {
            row.appendChild(el('span', 'ms-premio', def.premio + 'v'));
          }
          return row;
        }

        caixa.appendChild(el('h3', 'bk-tit', tr('Diárias de hoje ({dia})', { dia: quadro.dia })));
        quadro.lista.forEach(function (mi) {
          var def = Ms.DIARIAS[mi.id];
          if (def) caixa.appendChild(linha(mi.id, def, mi));
        });

        caixa.appendChild(el('h3', 'bk-tit', tr('Conquistas')));
        Object.keys(Ms.CONQUISTAS).forEach(function (id) {
          var def = Ms.CONQUISTAS[id];
          var st2 = quadro.conquistas[id] || { prog: 0, pago: false };
          caixa.appendChild(linha(id, def, st2));
        });

        /* 11/09: o seletor de TÍTULO saiu daqui. Título deixou de ser prêmio
         * de missão (decisão do dono) e passou a ser posição no ranking ou
         * dez quedas do mesmo chefe no difícil, sozinho — escolhe-se na
         * ficha do Personagem, que é onde a conta se lê inteira. */
      });
  }

  /* O MERCADINHO — o balcão de compra em cima, a venda do saco embaixo.
   * Toda leitura vem de JOGO.Mercado por Promise, redesenho a cada resposta,
   * como o banco. A peça comprada entra no saco AQUI (o módulo devolve; a
   * ficha guarda) — mesmo contrato do saque do cofre. */
  var mercadoPreco = '';           // o preço digitado sobrevive ao redesenho

  /* O MERCADINHO (03/09, pedido do dono): "pesquisa melhor por filtro; um
   * local onde eu consiga ver o que eu anunciei de forma simplificada; uma
   * parte para buscar itens de forma geral; taxa de 5% do valor da venda".
   * Quatro abas — Comprar (busca + filtros de espaço, raridade, vendedor e
   * ordem), Vender (o saco com a régua e a TAXA à vista antes de anunciar),
   * Meus anúncios (só o seu, com o que recebe depois da taxa) e o
   * Colecionador (selos e roleta). A taxa é a do módulo: 5%, mínimo 1. */
  var mcAba = 'comprar';
  // 22/09: `cat` (equip | pedras) e `el` (o elemento do balcão de pedras)
  var mcFiltro = { q: '', slot: 'todos', rar: 'todas', origem: 'todos', ordem: 'preco', cat: 'equip', el: 'todos' };

  /* AS ABAS E OS FILTROS REDONDOS DOS DOIS MERCADINHOS (22/09, pedido do
   * dono). O nome escondido de cada botão é a palavra de antes, sem a conta
   * ("Comprar", "Meus anúncios", "Poções" — as provas acham as abas assim); a
   * conta de anúncios foi para a pílula do canto (data-conta). A aba aberta
   * acende com is-on; o texto dela fica escrito no fim da fileira. */
  var MC_ABAS = {
    comprar: { ico: 'mc-comprar', rot: tr('Comprar') },
    vender:  { ico: 'mc-vender',  rot: tr('Vender') },
    meus:    { ico: 'mc-meus',    rot: tr('Meus anúncios') },
    ofertas: { ico: 'mc-ofertas', rot: tr('Minhas ofertas') },
    pocoes:  { ico: 'mc-pocoes',  rot: tr('Poções') }
  };
  // mcAbas([{id, conta?}], aoMudar) -> div.mc-abas; a acesa é a do `mcAba`
  /* 08/10 à noite (o dono: "o mercadinho dá para melhorar o layout"): as abas viraram PÍLULAS com o ícone E o
   * nome escrito (as redondas só diziam o nome no toque longo); a conta segue na pílula do canto (data-conta).
   * O textContent continua sendo o nome, letra por letra — as provas acham "Meus anúncios" pelo texto. */
  function mcAbas(lista, aoMudar) {
    var fila = el('div', 'mc-abas');
    fila.setAttribute('role', 'tablist');
    lista.forEach(function (a) {
      var def = MC_ABAS[a.id], ligado = mcAba === a.id;
      var svg = safe(function () { return JOGO.IconesUI ? JOGO.IconesUI.svg(def.ico) : ''; }, '') || '';
      var b = btn(svg + '<span class="mc-aba-nm">' + esc(def.rot) + '</span>',
                  'btn-mini mc-aba' + (ligado ? ' is-on' : ''), function () { aoMudar(a.id); });
      b.setAttribute('data-aba', a.id);
      b.setAttribute('aria-pressed', ligado ? 'true' : 'false');
      if (a.conta != null && a.conta !== '' && Number(a.conta) > 0) b.setAttribute('data-conta', String(a.conta));
      fila.appendChild(b);
    });
    return fila;
  }
  /* A BARRA DE FILTROS do mercadinho (08/10 à noite): UMA linha — o seletor da categoria (Equipamentos | Pedras),
   * a busca e, por categoria, os seletores de espaço, raridade e ordem (ou o de elemento, nas pedras) — no lugar
   * das três fileiras de botões redondos. `cfg` = { cat, aoCat, q, aoQ, placeholder, slot, aoSlot, rar, aoRar,
   * ordem, aoOrdem, el, aoEl }; `ao*` null = sem aquele seletor. Cada seletor leva data-filtro. */
  var MC_RAR_OP = [['todas', tr('Todas as raridades')], ['comum', tr('Comum')], ['raro', tr('Raro')], ['epico', tr('Épico')], ['lendario', tr('Lendário')]];
  var MC_ORD_OP = [['preco', tr('Preço ↑')], ['precoDesc', tr('Preço ↓')], ['nome', tr('Nome')], ['raridade', tr('Raridade')]];
  function mcBarra(cfg) {
    var w = el('div', 'mc-barra');
    function seletor(cls, filtro, opcoes, atual, aoMudar) {
      var s = document.createElement('select');
      s.className = 'hub-input inv2-select ' + cls;
      s.setAttribute('data-filtro', filtro);
      opcoes.forEach(function (o) {
        var op = document.createElement('option');
        op.value = o[0]; op.textContent = o[1];
        if (o[0] === atual) op.selected = true;
        s.appendChild(op);
      });
      s.addEventListener('change', function () { aoMudar(s.value); });
      s.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
      w.appendChild(s);
      return s;
    }
    if (cfg.aoCat) seletor('mc-sel-cat', 'cat', [['equip', tr('Equipamentos')], ['pedras', tr('Pedras')]], cfg.cat || 'equip', cfg.aoCat);
    var busca = document.createElement('input');
    busca.className = 'hub-input mc-busca';
    busca.type = 'search';
    busca.placeholder = cfg.placeholder || tr('buscar por nome...');
    busca.value = cfg.q || '';
    busca.addEventListener('input', function () { cfg.aoQ(busca.value); });
    busca.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
    w.appendChild(busca);
    if (cfg.cat === 'pedras') {
      if (cfg.aoEl) {
        var els = ['fogo', 'agua', 'terra', 'ar', 'neutro'];
        seletor('inv2-sel-elem', 'el', [['todos', tr('Todos os elementos')]].concat(els.map(function (e) { return [e, ELEM_PT[e] || e]; })), cfg.el || 'todos', cfg.aoEl);
      }
      return w;
    }
    if (cfg.aoSlot) seletor('inv2-sel-espaco', 'slot', [['todos', tr('Todos os espaços')]].concat(SLOTS.map(function (c) { return [c, SLOT_PT[c]]; })), cfg.slot || 'todos', cfg.aoSlot);
    if (cfg.aoRar) seletor('mc-sel-rar', 'rar', MC_RAR_OP, cfg.rar || 'todas', cfg.aoRar);
    if (cfg.aoOrdem) seletor('mc-sel-ord', 'ordem', MC_ORD_OP, cfg.ordem || 'preco', cfg.aoOrdem);
    return w;
  }
  /* AS DUAS COLUNAS do mercadinho (08/10 à noite), como a forja e o banco: à esquerda o balcão (a barra de filtros
   * e a grade só de ícones, com o preço embaixo de cada peça), à direita a ficha da peça tocada com quem vende e
   * os botões. `mc2Molde(pai)` devolve {esq, dir}; `mc2Dica(dir, texto)` escreve a dica quando nada foi tocado. */
  function mc2Molde(pai) {
    var m = el('div', 'mc2'), esq = el('div', 'mc2-esq'), dir = el('div', 'mc2-dir');
    m.appendChild(esq); m.appendChild(dir); pai.appendChild(m);
    return { esq: esq, dir: dir };
  }
  function mc2Dica(dir, texto) {
    clear(dir);
    dir.appendChild(el('p', 'inv-dica mc2-dica', texto));
  }
  /* a CÉLULA do balcão: o ícone com a borda da raridade, ×N e o preço (ou a régua) embaixo; o nome no balão */
  function mcCelula(itemId, op) {
    op = op || {};
    var it = itemDef(itemId) || {};
    var c = el('button', 'ig-cell mc-cel ' + starClass(op.stars || 0) + (op.sel ? ' is-sel' : ''));
    c.type = 'button';
    c.setAttribute('data-item', itemId);
    markRarity(c, it.rarity);
    var plate = el('span', 'ig-plate');
    plate.appendChild(art('itemIcon', [itemId, INV_ICONE], INV_ICONE));
    c.appendChild(plate);
    if (op.n > 1) c.appendChild(el('span', 'ig-n', '×' + op.n));
    if (op.level) c.appendChild(el('span', 'ig-lv', '+' + op.level));
    if (op.stars) c.appendChild(starPips(op.stars));
    c.appendChild(el('span', 'ig-nm', esc(it.name || itemId)));
    if (op.preco != null) c.appendChild(el('span', 'mc-cel-preco' + (op.precoCls ? ' ' + op.precoCls : ''), esc(String(op.preco))));
    c.setAttribute('data-rot', it.name || itemId);
    legendaNoToque(c);
    if (op.aoTocar) tap(c, op.aoTocar);
    return c;
  }
  // as opções de cada fileira de filtro: {id, ico, rot, rc?, data} (o espaço
  // vem do slotOpcoes(), o mesmo do inventário)
  function mcOpRar() {
    return [['todas', tr('Todas')], ['comum', tr('Comum')], ['raro', tr('Raro')], ['epico', tr('Épico')],
            ['lendario', tr('Lendário')]].map(function (par) {
      return { id: par[0], ico: 'rar-' + par[0], rot: par[1],
               rc: par[0] === 'todas' ? null : rarColor(par[0]), data: { rar: par[0] } };
    });
  }
  function mcOpOrdem() {
    return [['preco', 'ord-preco-asc', tr('Preço ↑')], ['precoDesc', 'ord-preco-desc', tr('Preço ↓')],
            ['nome', 'ord-nome', tr('Nome')], ['raridade', 'ord-raridade', tr('Raridade')]].map(function (t) {
      return { id: t[0], ico: t[1], rot: t[2], data: { ord: t[0] } };
    });
  }
  /* Uma fileira de filtro do mercadinho: a legenda (.mc-filtro-rot) e os
   * botões redondos com a classe de sempre (.mc-chip). `noLugar` = acende o
   * tocado ali mesmo, sem redesenhar (o mercadinho entre contas filtra a
   * lista que já tem, e redesenhar pediria o balcão ao servidor de novo). */
  function mcFiltroFila(rotulo, chave, opcoes, atual, aoMudar, noLugar) {
    var linha = el('div', 'mc-filtros ico-fila');
    linha.setAttribute('data-filtro', chave);
    linha.appendChild(el('span', 'mc-filtro-rot', rotulo));
    var botoes = [];
    opcoes.forEach(function (o) {
      var b = icoBotao(o.ico, o.rot, atual === o.id, function () {
        if (noLugar) {
          botoes.forEach(function (x) {
            x.classList.toggle('is-on', x === b);
            x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
          });
        }
        aoMudar(o.id);
      }, { cls: 'btn-mini mc-chip', rc: o.rc, cor: o.cor, data: o.data });
      botoes.push(b);
      linha.appendChild(b);
    });
    return linha;
  }
  function mcTaxa(preco) {
    var Mc = JOGO.Mercado;
    // 13/09: a conta inteira do módulo (a mesma do servidor); o ponto flutuante cobrava 4 de 60
    if (Mc && Mc.taxaDe) return Mc.taxaDe(preco);
    return Math.max(1, Math.ceil(preco * 5 / 100));
  }

  /* AS PEDRAS NO MERCADINHO (22/09, pedido do dono: "o jogador poderá colocar
   * pedras para vender também, em unidade ou lotes de 10, 50 e 100"). Nos dois
   * balcões, Comprar e Vender ganham a fileira de CATEGORIA — Equipamentos (as
   * fileiras de sempre: espaço, raridade, ordem) ou Pedras (o elemento e a busca
   * pelo nome da pedra). A fileira é .mc-cats e NÃO .mc-filtros: a primeira
   * .mc-filtros continua sendo a do espaço (tests/mercado_hud.html e a
   * prova_mercado a acham assim). Cada categoria filtra a SUA coisa: peça nunca
   * aparece em Pedras, lote nunca aparece em Equipamentos.
   * O lote é a oferta com tipo 'pedra' (JOGO.Mercado.ehLote) — a local traz
   * `stoneId`, a do servidor traz a pedra no `itemId` (e às vezes `stoneId`
   * também). A linha dele mostra a pedra, o tamanho e o preço POR PEDRA; comprar
   * e retirar não olham o saco: pedra vai direto ao estoque, não ocupa casa. */
  var mcLoteQtd = {};              // o lote escolhido de cada pedra sobrevive ao redesenho
  // as duas categorias do balcão: as mesmas do saco (o elmo e as pedras)
  function mcCats(atual, aoMudar) {
    return icoFila('mc-cats', INV_CATS.filter(function (c) { return c.id === 'equip' || c.id === 'pedras'; })
      .map(function (c) {
        return { id: c.id, ico: c.ico, rot: c.rot, cls: 'btn-mini',
                 clsTexto: atual === c.id ? 'btn-gold' : 'btn-ghost', data: { cat: c.id } };
      }), atual, aoMudar, true);
  }
  // a fileira dos elementos do balcão de pedras (a Âncora, do elemento 'forja', só no Todos)
  function mcOpElem() {
    return elemOpcoes().map(function (o) { return { id: o.id, ico: o.ico, rot: o.rot, cor: o.cor, data: o.data }; });
  }
  function mcEhLote(x) {
    var Mc = JOGO.Mercado;
    return Mc && Mc.ehLote ? Mc.ehLote(x) : !!(x && x.tipo === 'pedra');
  }
  // a pedra de um lote: a oferta local diz stoneId; o anúncio do servidor, itemId
  function mcPedraDe(x) { return (x && (x.stoneId || x.itemId)) || ''; }
  // o id é de PEDRA (e não de peça)? — o balcão entre contas abre os dois pelo mesmo ?id=
  function ehPedraId(id) { return !!id && !itemDef(id) && stoneDefs().hasOwnProperty(id); }
  function mcNomePedra(sid) { var d = stoneDefs()[sid]; return (d && d.name) || String(sid || ''); }
  function mcCorPedra(sid) { return elemColor(elementoDe(sid)); }
  /* "Lote de 50 × Brasa Coagulada" (`inicio` = começa a frase; no meio dela o
   * "lote" vem minúsculo); a pedra avulsa é "1 × Brasa Coagulada". Texto puro:
   * quem põe em HTML passa pelo esc(). */
  function mcNomeLote(sid, qtd, inicio) {
    qtd = Math.floor(Number(qtd)) || 1;
    return (qtd === 1 ? '1 × ' : (inicio
      ? tr('Lote de {qtd} ×', { qtd: qtd }) + ' '
      : tr('lote de {qtd} ×', { qtd: qtd }) + ' ')) + mcNomePedra(sid);
  }
  // o número com vírgula e no máximo duas casas: 4,8 · 0,07 · 5
  function mcNum(v) {
    var n = Math.round((Number(v) || 0) * 100) / 100;
    return String(n).replace('.', ',');
  }
  function mcUnit(preco, qtd) { return mcNum((Number(preco) || 0) / Math.max(1, Math.floor(Number(qtd)) || 1)); }
  // a busca e o elemento do balcão de pedras (a pedra que o dado não conhece passa no Todos)
  function passaPedra(sid, q, elFiltro) {
    var tq = normaliza(q);
    if (tq && normaliza(mcNomePedra(sid)).indexOf(tq) < 0) return false;
    return passaElemento(sid, elFiltro || 'todos');
  }
  /* a linha de uma PEDRA: o ícone, o nome na cor do elemento (--ec) e a linha de
   * baixo. `titulo` e `sub` já vêm em HTML (escapados por quem chama). */
  function mcLinhaPedra(sid, titulo, sub) {
    var row = el('div', 'mc-linha mc-pedra');
    row.setAttribute('data-pedra', sid);
    row.style.setProperty('--ec', mcCorPedra(sid));
    var ic = el('span', 'mc-ic');
    ic.appendChild(art('stoneIcon', [sid, 34], 34));
    row.appendChild(ic);
    var tx = el('div', 'ms-tx');
    tx.appendChild(el('div', 'ms-nome', titulo));
    if (sub) tx.appendChild(el('div', 'ms-prog', sub));
    row.appendChild(tx);
    return row;
  }
  // o preço do lote e, embaixo, o preço por pedra
  function mcPrecoLote(preco, qtd, prefixo) {
    return el('span', 'mc-preco', (prefixo || '') + preco + 'v' +
      (qtd > 1 ? '<small>' + tr('{a}v cada', { a: mcUnit(preco, qtd) }) + '</small>' : ''));
  }
  /* VENDER › PEDRAS: a linha de UMA pedra do estoque, igual nos dois balcões.
   * Os lotes (1 · 10 · 50 · 100) são botões de texto, como os atalhos das
   * poções; o que passa do estoque fica apagado (mc-falta) mas TOCÁVEL — no
   * celular não há title, e o toque diz por que não dá. O preço começa vazio
   * com a régua do lote no placeholder; a conta embaixo (o preço por pedra, o
   * que recebe e a taxa) acompanha a digitação. Trocar de lote acende o botão
   * NO LUGAR e limpa o preço (o digitado era do lote de antes).
   * `anuncia(qtd, preco, botao)` é de quem chama: o balcão local chama o
   * JOGO.Mercado.anunciarPedras, o entre contas o servidor.anunciarPedras. */
  function mcVendaPedra(sid, anuncia) {
    var Mc = JOGO.Mercado;
    var tem = stoneCount(sid);
    var nome = mcNomePedra(sid);
    var lotes = (Mc && Mc.LOTES_PEDRA) || [1, 10, 50, 100];
    var teto = (Mc && Mc.PRECO_MAX) || 9999;
    var lote = mcLoteQtd[sid];
    if (lotes.indexOf(lote) < 0 || lote > tem) lote = lotes[0];
    function sugerido() {
      return safe(function () { return Mc.precoSugeridoPedra(sid, lote); }, 0) || Math.max(2, 4 * lote);
    }
    var elP = elementoDe(sid);
    var regua = safe(function () { return Mc.precoSugeridoPedra(sid, 1); }, 0);
    var row = mcLinhaPedra(sid, esc(nome), tr('{a} · você tem <b class="mc-tem">{tem}</b>{b}', { a: esc(ELEM_PT[elP] || tr('Forja')), tem: tem, b: regua ? ' ' + tr('· a régua sugere {regua}v a pedra', { regua: regua }) : '' }));
    row.classList.add('mc-pedra-venda');
    var fila = el('span', 'mc-lotes');
    fila.setAttribute('role', 'group');
    var campo = document.createElement('input');
    campo.type = 'number'; campo.min = '1'; campo.max = String(teto); campo.step = '1';
    campo.className = 'bk2-qtd mc-qtd mc-lote-preco';
    campo.setAttribute('aria-label', tr('preço do lote'));
    var conta = el('span', 'mc-lote-conta', '');
    function preco() { return Math.floor(Number(campo.value || sugerido())) || 0; }
    function mostra() {
      campo.placeholder = String(sugerido());
      var p = preco();
      if (p <= 0) { conta.textContent = ''; return; }
      var tx = mcTaxa(p);
      conta.innerHTML = tr('<b>{a}v</b> cada · recebe <b class="mc-recebe">{b}v</b> <small>(taxa {tx}v)</small>', { a: mcUnit(p, lote), b: p - tx, tx: tx });
    }
    lotes.forEach(function (n) {
      var falta = n > tem;
      var b = btn(String(n), 'btn-mini mc-chip mc-lote' + (n === lote ? ' is-on' : '') + (falta ? ' mc-falta' : ''), function () {
        if (n > tem) {
          toast(tr('Você tem {tem} {nome} — o lote de {n} pede {n}.', { tem: tem, nome: nome, n: n }));
          return;
        }
        lote = n;
        mcLoteQtd[sid] = n;
        [].forEach.call(fila.children, function (x) {
          x.classList.toggle('is-on', x === b);
          x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
        });
        campo.value = '';
        mostra();
      });
      b.setAttribute('data-lote', String(n));
      b.setAttribute('aria-pressed', n === lote ? 'true' : 'false');
      if (falta) b.title = tr('Você tem {tem} — o lote de {n} pede {n}.', { tem: tem, n: n });
      fila.appendChild(b);
    });
    campo.addEventListener('input', mostra);
    mostra();
    var bA = btn(tr('Anunciar lote'), 'btn-mini btn-gold mc-lote-go', function () {
      var p = preco();
      if (lote > tem) { toast(tr('Você tem {tem} {nome} — o lote de {lote} pede {lote}.', { tem: tem, nome: nome, lote: lote })); return; }
      if (!(p >= 1 && p <= teto)) { toast(tr('Preço entre 1 e {teto}.', { teto: teto })); return; }
      anuncia(lote, p, bA);
    });
    row.appendChild(fila);
    row.appendChild(campo);
    row.appendChild(conta);
    row.appendChild(bA);
    return row;
  }
  // o toast do anúncio do lote, igual nos dois balcões
  function mcTextoLoteAnunciado(sid, qtd, preco) {
    return tr('{a} no balcão por {preco}v — você recebe {b}v na venda.', { a: mcNomeLote(sid, qtd, true), preco: preco, b: preco - mcTaxa(preco) });
  }
  // o resumo e a dica de Vender › Pedras (as pedras do estoque que passam no filtro)
  function mcPedrasDoEstoque(q, elFiltro) {
    var defs = stoneDefs();
    var todas = Object.keys(defs).filter(function (k) { return stoneCount(k) > 0; });
    var vistas = todas.filter(function (k) { return passaPedra(k, q, elFiltro); });
    vistas.sort(function (a, b) { return mcNomePedra(a).localeCompare(mcNomePedra(b)); });
    return { todas: todas, vistas: vistas };
  }
  function mcPintaVendaPedras(lista, q, elFiltro, anuncia) {
    var pd = mcPedrasDoEstoque(q, elFiltro);
    // o número é de PEDRAS de verdade (a soma do estoque); os tipos vão entre parênteses
    var somaV = 0;
    pd.vistas.forEach(function (sid) { somaV += stoneCount(sid); });
    lista.appendChild(el('p', 'mc-resumo', (somaV === 1
      ? (pd.vistas.length === 1 ? tr('<b>{somaV}</b> pedra no estoque ({length} tipo) · em unidade ou lotes de 10, 50 e 100 · a taxa de 5% sai do preço do lote na venda', { somaV: somaV, length: pd.vistas.length }) : tr('<b>{somaV}</b> pedra no estoque ({length} tipos) · em unidade ou lotes de 10, 50 e 100 · a taxa de 5% sai do preço do lote na venda', { somaV: somaV, length: pd.vistas.length }))
      : (pd.vistas.length === 1 ? tr('<b>{somaV}</b> pedras no estoque ({length} tipo) · em unidade ou lotes de 10, 50 e 100 · a taxa de 5% sai do preço do lote na venda', { somaV: somaV, length: pd.vistas.length }) : tr('<b>{somaV}</b> pedras no estoque ({length} tipos) · em unidade ou lotes de 10, 50 e 100 · a taxa de 5% sai do preço do lote na venda', { somaV: somaV, length: pd.vistas.length })))));
    if (!pd.vistas.length) {
      lista.appendChild(el('p', 'inv-dica', pd.todas.length ? tr('Nenhuma pedra com esses filtros.')
        : tr('Você não tem pedra de forja. Elas caem dos monstros e saem da quebra de peças na forja.')));
    }
    pd.vistas.forEach(function (sid) {
      lista.appendChild(mcVendaPedra(sid, function (qtd, preco, bA) { anuncia(sid, qtd, preco, bA); }));
    });
  }

  function sheetMercado() {
    sheetName = 'mercado';
    var Mc = JOGO.Mercado;
    // 13/09: com sessão e a autoridade ligada, o balcão é ENTRE CONTAS (servidor/mercado.py)
    if (Mc && Mc.servidor && Mc.servidor.ligado()) { sheetMercadoServidor(); return; }
    var body = sheetShell(tr('Mercadinho do Acampamento'),
      tr('O balcão só tem o que jogador anunciou. A sua oferta fica até vender ou você retirar. Toda venda paga 5% de taxa.'));
    if (!Mc) { body.appendChild(el('p', 'inv-dica', tr('O mercado não carregou.'))); return; }

    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);

    Promise.all([Mc.abrir(), JOGO.DB.moedas()]).then(function (r) {
      var mc = r[0], bolso = r[1];
      clear(caixa);
      if (!mc) { caixa.appendChild(el('p', 'inv-dica', tr('A conta local não carregou.'))); return; }
      var ofertas = mc.ofertas || [];
      var minhas = ofertas.filter(function (of) { return of.vendedor === 'jogador'; });
      var deOutros = ofertas.filter(function (of) { return of.vendedor !== 'jogador'; });

      var pBolso = el('p', 'mc-bolso', (bolso === 1
        ? tr('No bolso: <b>{bolso}</b> vintém', { bolso: bolso })
        : tr('No bolso: <b>{bolso}</b> vinténs', { bolso: bolso })));
      pBolso.insertBefore(art('vintemIcon', [18], 18, 'moeda-inline'), pBolso.firstChild);
      caixa.appendChild(pBolso);

      // ---- as abas (22/09: redondas; a conta vai na pílula do canto)
      caixa.appendChild(mcAbas([
        { id: 'comprar', conta: deOutros.length }, { id: 'vender' },
        { id: 'meus', conta: minhas.length }, { id: 'pocoes' }], function (id) {
        mcAba = id; sheetMercado();
      }));

      // ---- a barra de filtros (Comprar e Vender)
      function chips(rotulo, chave, opcoes) {
        return mcFiltroFila(rotulo, chave, opcoes, mcFiltro[chave], function (id) {
          mcFiltro[chave] = id; sheetMercado();
        });
      }
      var pedras = mcFiltro.cat === 'pedras';
      function barraFiltros(comOrigem) {
        // 08/10 à noite: a barra de seletores (categoria, busca, espaço, raridade, ordem | elemento) no lugar das
        // fileiras redondas; trocar de categoria limpa a busca — o nome de pedra não acha peça
        caixa.appendChild(mcBarra({
          cat: mcFiltro.cat, aoCat: function (id) { if (id === mcFiltro.cat) return; mcFiltro.cat = id; mcFiltro.q = ''; sheetMercado(); },
          q: mcFiltro.q, aoQ: function (v) { mcFiltro.q = v; pinta(); },
          placeholder: pedras ? tr('buscar pedra por nome...') : tr('buscar por nome...'),
          el: mcFiltro.el, aoEl: function (v) { mcFiltro.el = v; sheetMercado(); },
          slot: mcFiltro.slot, aoSlot: function (v) { mcFiltro.slot = v; sheetMercado(); },
          rar: mcFiltro.rar, aoRar: function (v) { mcFiltro.rar = v; sheetMercado(); },
          ordem: mcFiltro.ordem, aoOrdem: comOrigem ? function (v) { mcFiltro.ordem = v; sheetMercado(); } : null
        }));
      }
      var ORDEM_RAR = { comum: 0, raro: 1, epico: 2, lendario: 3 };
      function passaFiltro(itemId) {
        // a pedra não é peça: não entra em Equipamentos (22/09)
        if (!itemId || ehPedraId(itemId)) return false;
        var it = itemDef(itemId) || {};
        var tq = (mcFiltro.q || '').toLowerCase();
        if (tq && (it.name || itemId).toLowerCase().indexOf(tq) < 0) return false;
        if (mcFiltro.slot !== 'todos' && slotOf(itemId) !== mcFiltro.slot) return false;
        if (mcFiltro.rar !== 'todas' && (it.rarity || 'comum') !== mcFiltro.rar) return false;
        return true;
      }
      // a oferta passa na categoria aberta? o lote só em Pedras; a peça só em Equipamentos
      function passaOferta(of) {
        if (mcEhLote(of)) return pedras && passaPedra(mcPedraDe(of), mcFiltro.q, mcFiltro.el);
        return !pedras && passaFiltro(of.itemId);
      }
      function linhaItem(itemId, level, stars, sub) {
        var it = itemDef(itemId) || {};
        var row = el('div', 'mc-linha');
        var ic = el('span', 'mc-ic');
        ic.appendChild(art('itemIcon', [itemId, 34], 34));
        row.appendChild(ic);
        var tx = el('div', 'ms-tx');
        tx.appendChild(el('div', 'ms-nome', esc(it.name || itemId) +
          (level ? ' +' + level : '') + (stars ? ' ★' + stars : '')));
        tx.appendChild(el('div', 'ms-prog', esc(SLOT_PT[slotOf(itemId)] || '') + ' · ' +
          esc(RAR_PT[it.rarity] || it.rarity || '') + nvTxt(itemId) + (sub ? ' · ' + sub : '')));
        row.appendChild(tx);
        // 08/10 à noite: o toque no nome abre, debaixo da linha, a MESMA ficha do inventário (e fecha no segundo)
        tx.classList.add('is-toque');
        tap(tx, function () {
          var aberta = row.nextSibling;
          if (aberta && aberta.classList && aberta.classList.contains('mc-ficha')) { aberta.parentNode.removeChild(aberta); return; }
          var f = fichaItem({ itemId: itemId, level: level || 0, stars: stars || 0 }, { hid: ensurePartyHero(), compacto: true });
          f.classList.add('mc-ficha');
          if (row.parentNode) row.parentNode.insertBefore(f, row.nextSibling);
        });
        return row;
      }
      var listaEl = null;

      function pinta() {
        if (!listaEl) return;
        clear(listaEl);
        if (mcAba === 'comprar') pintaComprar();
        else if (mcAba === 'vender') pintaVender();
        else if (mcAba === 'meus') pintaMeus();
      }

      // ---- COMPRAR: o balcão dos outros, filtrado e ordenado
      function pintaComprar() {
        if (pedras) { pintaComprarPedras(); return; }
        var lista = deOutros.filter(function (of) {
          if (!passaOferta(of)) return false;

          return true;
        });
        var pecas = deOutros.filter(function (of) { return !mcEhLote(of); });
        lista.sort(function (a, b) {
          var ia = itemDef(a.itemId) || {}, ib = itemDef(b.itemId) || {};
          if (mcFiltro.ordem === 'precoDesc') return b.preco - a.preco;
          if (mcFiltro.ordem === 'nome') return (ia.name || '').localeCompare(ib.name || '');
          if (mcFiltro.ordem === 'raridade') return (ORDEM_RAR[ib.rarity] || 0) - (ORDEM_RAR[ia.rarity] || 0) || a.preco - b.preco;
          return a.preco - b.preco;
        });
        listaEl.appendChild(el('p', 'mc-resumo', tr('<b>{length}</b> à venda{a}', { length: lista.length, a: lista.length !== pecas.length ? ' ' + tr('(de {length})', { length: pecas.length }) : '' })));
        if (!lista.length) {
          // 12/09: balcão vazio é o estado NORMAL do mercadinho agora — a
          // frase tem de explicar isso, e não parecer filtro mal posto
          listaEl.appendChild(el('p', 'inv-dica', pecas.length
            ? tr('Nada com esses filtros.')
            : tr('O balcão está vazio. Ele só enche quando alguém anuncia uma peça — e a sua oferta fica aqui até vender.')));
        }
        lista.forEach(function (of) {
          var row = linhaItem(of.itemId, of.level, of.stars,
            tr('de {a}', { a: esc(of.vendedorNome || 'jogador') }));
          row.appendChild(el('span', 'mc-preco', of.preco + 'v'));
          var bC = btn(tr('Comprar'), 'btn-mini btn-gold', function () {
            if (!safe(function () { return P().bagFree(1); }, true)) {
              toast(tr('O saco está cheio — não cabe mais nada.'));
              return;
            }
            if (JOGO.Autoridade) JOGO.Autoridade.op('comprarMercado', { ofertaId: of.id });
            Mc.comprar(of.id).then(function (res) {
              if (!res.ok) { toast(res.erro || tr('não deu')); sheetMercado(); return; }
              // o lote de pedras não devolve peça (22/09): nada de empurrar undefined no saco
              if (!res.item) { sheetMercado(); return; }
              /* A ORIGEM continua 'mercador' — é o nome que o servidor aceita
               * (ORIGENS em servidor/api.py) e trocá-lo faria o save novo ser
               * recusado na subida. O mercador-fantasma saiu do balcão; o
               * carimbo de procedência "veio do mercado" fica. */
              P().state.inventory.push(P().carimba ? P().carimba(res.item, 'mercador') : res.item);
              safe(function () { P().save(); }, null);
              toast(tr('−{pagou} vinténs — a peça é sua.', { pagou: res.pagou }), 'good');
              sheetMercado();
            });
          });
          if (bolso < of.preco) { bC.classList.add('is-off'); bC.title = tr('faltam {a} vinténs', { a: of.preco - bolso }); }
          row.appendChild(bC);
          listaEl.appendChild(row);
        });
      }

      /* ---- COMPRAR › PEDRAS: os lotes dos outros, do mais barato POR PEDRA.
       * No balcão local o vendedor de fora quase nunca existe (sem servidor, quem
       * anuncia é você) — a frase do vazio diz isso e aponta o Vender. A compra
       * não olha o saco: o módulo põe as pedras direto no estoque. */
      function pintaComprarPedras() {
        var lotes = deOutros.filter(function (of) { return mcEhLote(of); });
        var lista = lotes.filter(passaOferta);
        lista.sort(function (a, b) { return a.preco / a.qtd - b.preco / b.qtd || a.preco - b.preco; });
        listaEl.appendChild(el('p', 'mc-resumo', (lista.length === 1
          ? tr('<b>{length}</b> lote de pedra à venda{a} · a pedra vai direto ao estoque, não ocupa o saco', { length: lista.length, a: lista.length !== lotes.length ? ' ' + tr('(de {length})', { length: lotes.length }) : '' })
          : tr('<b>{length}</b> lotes de pedra à venda{a} · a pedra vai direto ao estoque, não ocupa o saco', { length: lista.length, a: lista.length !== lotes.length ? ' ' + tr('(de {length})', { length: lotes.length }) : '' }))));
        if (!lista.length) {
          listaEl.appendChild(el('p', 'inv-dica', lotes.length ? tr('Nenhum lote com esses filtros.')
            : tr('Nenhum lote de pedra à venda. O balcão só enche quando alguém anuncia — para vender as suas, vá em <b>Vender</b> › <b>Pedras</b> (em unidade ou lotes de 10, 50 e 100).')));
        }
        lista.forEach(function (of) {
          var sid = mcPedraDe(of);
          // o preço por pedra vai embaixo do preço do lote (mcPrecoLote)
          var row = mcLinhaPedra(sid, esc(mcNomeLote(sid, of.qtd, true)), tr('de {a}', { a: esc(of.vendedorNome || 'jogador') }));
          row.appendChild(mcPrecoLote(of.preco, of.qtd));
          var bC = btn(tr('Comprar'), 'btn-mini btn-gold', function () {
            // o lote local só existe com a autoridade desligada (o Progress não vai ao juiz)
            if (Mc.servidor && Mc.servidor.ligado()) { sheetMercado(); return; }
            bC.classList.add('is-off');
            Mc.comprar(of.id).then(function (res) {
              if (!res || !res.ok) { toast((res && res.erro) || tr('não deu')); sheetMercado(); return; }
              var pd = res.pedras || { stoneId: sid, qtd: of.qtd };
              toast(tr('−{pagou} vinténs — +{qtd} {a} no estoque.', { pagou: res.pagou, qtd: pd.qtd, a: mcNomePedra(pd.stoneId) }), 'good');
              sheetMercado();
            });
          });
          if (bolso < of.preco) { bC.classList.add('is-off'); bC.title = tr('faltam {a} vinténs', { a: of.preco - bolso }); }
          row.appendChild(bC);
          listaEl.appendChild(row);
        });
      }

      // ---- VENDER: o saco com a régua e a taxa antes de anunciar
      function pintaVender() {
        if (pedras) {
          // VENDER › PEDRAS: o lote sai do estoque no módulo (anunciarPedras), não aqui
          mcPintaVendaPedras(listaEl, mcFiltro.q, mcFiltro.el, function (sid, qtd, preco, bA) {
            if (Mc.servidor && Mc.servidor.ligado()) { sheetMercado(); return; }
            bA.classList.add('is-off');
            Mc.anunciarPedras(sid, qtd, preco).then(function (res) {
              if (!res || !res.ok) { toast((res && res.erro) || tr('não deu')); sheetMercado(); return; }
              toast(mcTextoLoteAnunciado(sid, qtd, preco), 'good');
              sheetMercado();
            });
          });
          return;
        }
        var pilhas = safe(function () { return P().invStacks(); }, [])
          .filter(function (s2) { return !!itemDef(s2.itemId) && passaFiltro(s2.itemId); });
        listaEl.appendChild(el('p', 'mc-resumo', tr('<b>{length}</b> no saco · a taxa de 5% sai do preço na hora da venda', { length: pilhas.length })));
        if (!pilhas.length) listaEl.appendChild(el('p', 'inv-dica', tr('Nada no saco com esses filtros.')));
        pilhas.forEach(function (pi) {
          var sugerido = Mc.precoSugerido(pi.itemId, pi.level, pi.stars);
          var row = linhaItem(pi.itemId, pi.level, pi.stars,
            tr('{a}a régua sugere {sugerido}v', { a: pi.count > 1 ? '×' + pi.count + ' · ' : '', sugerido: sugerido }));
          var campo = document.createElement('input');
          campo.type = 'number'; campo.min = '1'; campo.step = '1';
          campo.className = 'bk2-qtd mc-qtd';
          campo.placeholder = String(sugerido);
          var taxaEl = el('span', 'mc-taxa', '');
          function mostraTaxa() {
            var preco = Math.floor(Number(campo.value || sugerido)) || 0;
            if (preco <= 0) { taxaEl.textContent = ''; return; }
            var tx = mcTaxa(preco);
            taxaEl.innerHTML = tr('recebe <b>{a}v</b><small>taxa {b}v</small>', { a: preco - tx, b: tx });
          }
          campo.addEventListener('input', mostraTaxa);
          mostraTaxa();
          row.appendChild(campo);
          row.appendChild(taxaEl);
          row.appendChild(btn(tr('Anunciar'), 'btn-mini btn-gold', function () {
            var preco = Math.floor(Number(campo.value || sugerido));
            var st2 = P().state;
            var entrada = st2.inventory[pi.indices[0]];
            if (!entrada) { toast(tr('essa peça já saiu')); sheetMercado(); return; }
            if (JOGO.Autoridade) JOGO.Autoridade.op('anunciarMercado', { invIndex: pi.indices[0], preco: preco });
            Mc.anunciar(entrada, preco).then(function (res) {
              if (!res.ok) { toast(res.erro || tr('não deu')); return; }
              st2.inventory.splice(pi.indices[0], 1);
              safe(function () { P().save(); }, null);
              toast(tr('No balcão por {preco}v — você recebe {a}v na venda.', { preco: preco, a: preco - mcTaxa(preco) }), 'good');
              sheetMercado();
            });
          }));
          listaEl.appendChild(row);
        });
      }

      // ---- MEUS ANÚNCIOS: só o seu, enxuto, com o que recebe
      function pintaMeus() {
        var totalPreco = 0, totalTaxa = 0;
        minhas.forEach(function (of) { totalPreco += of.preco; totalTaxa += mcTaxa(of.preco); });
        listaEl.appendChild(el('p', 'mc-resumo', minhas.length
          ? tr('<b>{length}</b> anúncio(s) · {totalPreco}v anunciados · recebe <b>{a}v</b> depois da taxa ({totalTaxa}v)', { length: minhas.length, totalPreco: totalPreco, a: totalPreco - totalTaxa, totalTaxa: totalTaxa })
          : tr('Você não tem nada anunciado. Vá em <b>Vender</b> para pôr uma peça ou um lote de pedras no balcão.')));
        minhas.forEach(function (of) {
          var lote = mcEhLote(of), sid = lote ? mcPedraDe(of) : null;
          var row = lote
            ? mcLinhaPedra(sid, esc(mcNomeLote(sid, of.qtd, true)), tr('sua oferta{a}', { a: of.qtd > 1 ? ' ' + tr('· <b>{a}v</b> a pedra', { a: mcUnit(of.preco, of.qtd) }) : '' }))
            : linhaItem(of.itemId, of.level, of.stars, tr('sua oferta'));
          row.classList.add('is-minha');
          var pr = el('span', 'mc-preco', of.preco + 'v');
          row.appendChild(pr);
          row.appendChild(el('span', 'mc-taxa', 'recebe <b>' + (of.preco - mcTaxa(of.preco)) + 'v</b><small>taxa ' + mcTaxa(of.preco) + 'v</small>'));
          if (lote) {
            // o lote volta ao ESTOQUE (o módulo soma as pedras): o saco cheio não impede
            var bR = btn(tr('Retirar'), 'btn-mini', function () {
              if (Mc.servidor && Mc.servidor.ligado()) { sheetMercado(); return; }
              bR.classList.add('is-off');
              Mc.retirar(of.id).then(function (res) {
                if (!res || !res.ok) { toast((res && res.erro) || tr('não deu')); sheetMercado(); return; }
                var pd = res.pedras || { stoneId: sid, qtd: of.qtd };
                toast(tr('O lote voltou: +{qtd} {a} no estoque.', { qtd: pd.qtd, a: mcNomePedra(pd.stoneId) }), 'good');
                sheetMercado();
              });
            });
            row.appendChild(bR);
            listaEl.appendChild(row);
            return;
          }
          row.appendChild(btn(tr('Retirar'), 'btn-mini', function () {
            if (!safe(function () { return P().bagFree(1); }, true)) {
              toast(tr('O saco está cheio — não cabe mais nada.'));
              return;
            }
            if (JOGO.Autoridade) JOGO.Autoridade.op('retirarMercado', { ofertaId: of.id });
            Mc.retirar(of.id).then(function (res) {
              if (!res.ok) { toast(res.erro || tr('não deu')); sheetMercado(); return; }
              if (!res.item) { sheetMercado(); return; }
              P().state.inventory.push(P().carimba ? P().carimba(res.item, 'legado') : res.item);
              safe(function () { P().save(); }, null);
              toast(tr('A peça voltou para o saco.'), 'good');
              sheetMercado();
            });
          }));
          listaEl.appendChild(row);
        });
      }

      if (mcAba === 'pocoes') {
        mcBancaPocoes(caixa, function () { return bolso; });
      } else if (mcAba === 'comprar' || mcAba === 'vender') {
        barraFiltros(mcAba === 'comprar');
        listaEl = el('div', 'mc-lista');
        caixa.appendChild(listaEl);
        pinta();
      } else {
        if (mcAba !== 'meus') mcAba = 'meus';
        listaEl = el('div', 'mc-lista');
        caixa.appendChild(listaEl);
        pinta();
      }
      caixa.appendChild(el('p', 'inv-dica', tr('A roleta dos selos mudou de endereço: fica na <b>Barraquinha da Sorte</b>, na praça.')));
    });
  }

  /* O MERCADINHO ENTRE CONTAS (13/09, pedido do dono): "o mercadinho deve classificar
   * por tipo de item, podendo ser pesquisado pelo nome e mostrar por item também, pois
   * pode ter mais de um mesmo item à venda pelos outros jogadores, aí precisa mostrar
   * todos e quem está vendendo" — e a proposta: "outro usuário pode dar a proposta de
   * comprar pelo valor Y".
   * Quatro abas: COMPRAR (tipo = o espaço da peça, raridade, busca ao vivo, a lista por
   * ITEM com quantos e o menor preço; tocar abre TODOS os anúncios dele, com quem vende,
   * "Comprar por X" e "Fazer oferta"), VENDER (o saco, como antes), MEUS ANÚNCIOS (as
   * propostas recebidas com Aceitar/Recusar) e MINHAS OFERTAS (o estado de cada uma).
   * Cada ação vai ao servidor (JOGO.Mercado.servidor) e o estado novo é ADOTADO — a
   * repintura reabre esta ficha na mesma aba, com os filtros guardados aqui.
   * 22/09: Comprar e Vender ganham a categoria Equipamentos | Pedras (AS PEDRAS NO
   * MERCADINHO, junto do mcTaxa); o lote vem do servidor com tipo 'pedra' e a pedra
   * no itemId, e Meus anúncios, Minhas ofertas e a confirmação o mostram como lote. */
  // 22/09: `cat` (equip | pedras) e `el` (o elemento das pedras); `item` guarda o id
  // aberto — de peça ou de pedra (ehPedraId diz qual)
  var mcSrv = { q: '', slot: 'todos', rar: 'todas', item: null, oferta: null, cat: 'equip', el: 'todos' };

  /* A BANCA DO MERCADOR (13/09, pedido do dono: "no mercadinho do jogo deve ter poções à
   * venda por vinténs. poções que carregam a vida vão para consumíveis no inventário").
   * A mesma aba nos dois mercadinhos (o local e o entre contas): cada poção com o ícone, a
   * cura, o preço, a quantidade (campo e atalhos 1/5/10) e Comprar. O vintém é o do SACO;
   * a regra (teto por tipo, vintém que falta) é a de JOGO.Mercado.comprarPocao, que com a
   * autoridade ligada sobe como a op comprarPocao. `sacoDe()` = os vinténs no saco agora. */
  var mcPocaoQtd = {};
  /* O BALCÃO DE VINTÉNS (07/10, js/core/mercado.js M.BALCAO): a Reescrita a cada 30 dias e o lote de
   * pedras do dia — as duas coisas que o vintém compra sem passar pela loja do site. Mora na aba das
   * poções, acima da banca, com a mesma linha. */
  function mcBalcaoVintens(lista, sacoDe) {
    var Mc = JOGO.Mercado;
    var b = safe(function () { return Mc.balcao(); }, null);
    if (!b) return;
    lista.appendChild(el('p', 'mc-resumo', tr('<b>O balcão de vinténs</b>: o que o mercador vende só por vintém — o preço é o mesmo para todo mundo, e a espera também.')));
    function linha(opts) {
      var row = el('div', 'mc-linha mc-balcao');
      var ic = el('span', 'mc-ic');
      ic.appendChild(opts.icone);
      row.appendChild(ic);
      var tx = el('div', 'ms-tx');
      tx.appendChild(el('div', 'ms-nome', opts.nome));
      tx.appendChild(el('div', 'ms-prog', opts.sub));
      row.appendChild(tx);
      row.appendChild(el('span', 'mc-preco', opts.preco + 'v'));
      var bC = btn(tr('Comprar'), 'btn-mini btn-gold', function () {
        var motivo = opts.porque();
        if (motivo) { toast(motivo); return; }
        bC.classList.add('is-off');
        opts.compra().then(function (res) {
          if (!res || !res.ok) toast((res && res.erro) || tr('não deu'));
          else toast(opts.feito(res), 'good');
          if (sheetName === 'mercado') sheetMercado();
        });
      });
      var motivo0 = opts.porque();
      bC.classList.toggle('mc-falta', !!motivo0);
      bC.title = motivo0;
      row.appendChild(bC);
      lista.appendChild(row);
    }
    // a Reescrita
    var r = b.reescrita;
    var icoR = el('span', 'perg-glifo', '↺');
    var esperaR = (!r.pode && r.liberaEm) ? tr('a próxima em {a}', { a: esc(dataCurta(r.liberaEm * 1000)) }) : tr('uma a cada {dias} dias', { dias: r.diasEntre });
    linha({ icone: icoR, nome: tr('Pergaminho da Reescrita'), preco: r.preco,
            sub: tr('troca um caminho elemental de um herói · {a}', { a: esperaR }),
            porque: function () {
              if (!r.pode) return tr('O mercador vende uma Reescrita a cada {dias} dias — a próxima só depois.', { dias: r.diasEntre });
              if (sacoDe() < r.preco) return tr('Faltam vinténs no saco: a Reescrita custa {preco}.', { preco: r.preco });
              return '';
            },
            compra: function () { return Mc.comprarReescrita(); },
            feito: function (res) { return tr('−{pagou} vinténs — um Pergaminho da Reescrita guardado na conta.', { pagou: res.pagou }); } });
    // as pedras do dia
    var p = b.pedrasDia;
    if (p.stoneId) {
      var sd = (D().stones || {})[p.stoneId] || {};
      linha({ icone: art('stoneIcon', [p.stoneId, 34], 34), nome: tr('Pedras do dia: {qtd}× {nome}', { qtd: p.qtd, nome: esc(sd.name || p.stoneId) }),
              preco: p.preco,
              sub: tr('o elemento do Calabouço do Dia ({a}) · um lote por dia · você tem <b>{tem}</b>',
                      { a: esc(nomeCalabouco(p.dungeonId)), tem: safe(function () { return P().stoneCount(p.stoneId); }, 0) || 0 }),
              porque: function () {
                if (p.compradoHoje) return tr('O lote de pedras do dia é um por dia — volte amanhã.');
                if (sacoDe() < p.preco) return tr('Faltam vinténs no saco: o lote custa {preco}.', { preco: p.preco });
                return '';
              },
              compra: function () { return Mc.comprarPedrasDoDia(); },
              feito: function (res) { return tr('−{pagou} vinténs — {qtd}× {nome} na prateleira da forja.', { pagou: res.pagou, qtd: res.qtd, nome: esc(sd.name || res.stoneId) }); } });
    }
  }
  function dataCurta(ms) {
    var d = new Date(ms);
    function d2(n) { return (n < 10 ? '0' : '') + n; }
    return d2(d.getDate()) + '/' + d2(d.getMonth() + 1);
  }
  function nomeCalabouco(id) {
    var ds = dungeons();
    for (var i = 0; i < ds.length; i++) if (ds[i].id === id) return ds[i].name || id;
    return id || '';
  }
  function mcBancaPocoes(caixa, sacoDe) {
    var Mc = JOGO.Mercado;
    var lista = el('div', 'mc-lista mc-banca');
    caixa.appendChild(lista);
    mcBalcaoVintens(lista, sacoDe);        // 07/10: a Reescrita e as pedras do dia, só por vintém
    var pocoes = safe(function () { return Mc.pocoesDaBanca(); }, []) || [];
    var teto = safe(function () { return P().consumivelTeto(); }, 20) || 20;
    lista.appendChild(el('p', 'mc-resumo', tr('A banca do mercador: estoque sem fim, preço fixo e sem taxa. Paga com os vinténs do <b>saco</b>; cabem <b>{teto}</b> de cada poção.', { teto: teto })));
    if (!pocoes.length) { lista.appendChild(el('p', 'inv-dica', tr('O mercador não trouxe poções.'))); return; }
    pocoes.forEach(function (d) {
      var tem = safe(function () { return P().consumivelVer(d.id); }, 0) || 0;
      var row = el('div', 'mc-linha mc-pocao');
      row.setAttribute('data-pocao', d.id);
      var ic = el('span', 'mc-ic');
      ic.appendChild(art('pocaoIcon', [d.id, 34], 34));
      row.appendChild(ic);
      var tx = el('div', 'ms-tx');
      tx.appendChild(el('div', 'ms-nome', esc(d.name)));
      tx.appendChild(el('div', 'ms-prog', tr('cura <b>{cura} PV</b> · fora da batalha · você tem <b class="mc-tem">{tem}</b>/{teto}', { cura: d.cura, tem: tem, teto: teto })));
      row.appendChild(tx);
      row.appendChild(el('span', 'mc-preco', d.preco + 'v'));
      var campo = document.createElement('input');
      campo.type = 'number'; campo.min = '1'; campo.max = String(teto); campo.step = '1';
      campo.className = 'bk2-qtd mc-qtd';
      campo.value = String(mcPocaoQtd[d.id] || 1);
      var totalEl = el('span', 'mc-taxa', '');
      var bC = btn(tr('Comprar'), 'btn-mini btn-gold', function () { compra(); });
      function qtd() { return Math.max(0, Math.floor(Number(campo.value) || 0)); }
      function porque(q) {
        if (q < 1) return tr('Escolha quantas poções.');
        if (tem + q > teto) return tr('Cabem {teto} de cada poção — você já tem {tem}.', { teto: teto, tem: tem });
        if (sacoDe() < q * d.preco) return tr('Faltam vinténs no saco: {q}× {name} custa {a}.', { q: q, name: d.name, a: q * d.preco });
        return '';
      }
      function mostra() {
        var q = qtd();
        if (q > 0) mcPocaoQtd[d.id] = q;
        totalEl.innerHTML = tr('total <b>{a}v</b>', { a: q * d.preco });
        var motivo = porque(q);
        // apagado mas TOCÁVEL: o is-off engole o toque (tap), e no celular não há title — o
        // toque no botão apagado diz por que não compra
        bC.classList.toggle('mc-falta', !!motivo);
        bC.title = motivo;
      }
      campo.addEventListener('input', mostra);
      var atalhos = el('span', 'mc-atalhos');
      [1, 5, 10].forEach(function (n) {
        atalhos.appendChild(btn(String(n), 'btn-mini mc-chip', function () { campo.value = String(n); mostra(); }));
      });
      function compra() {
        var q = qtd(), motivo = porque(q);
        if (motivo) { toast(motivo); return; }
        bC.classList.add('is-off');
        Mc.comprarPocao(d.id, q).then(function (res) {
          if (!res || !res.ok) toast((res && res.erro) || tr('não deu'));
          else toast(tr('−{pagou} vinténs — {q}× {name} em Consumíveis ({total}/{teto}).', { pagou: res.pagou, q: q, name: d.name, total: res.total, teto: teto }), 'good');
          if (sheetName === 'mercado') sheetMercado();
        });
      }
      row.appendChild(atalhos);
      row.appendChild(campo);
      row.appendChild(totalEl);
      row.appendChild(bC);
      mostra();
      lista.appendChild(row);
    });
    // 14/09: a vida é única e a poção se bebe fora da luta em qualquer lugar
    lista.appendChild(el('p', 'inv-dica', tr('As poções vão para <b>Consumíveis</b> no inventário e se bebem <b>fora da batalha</b> (na praça, na sala de espera): curam a vida na hora, para não esperar ela voltar sozinha.')));
  }
  var MC_ESTADO_PT = { aberta: 'esperando o vendedor', aceita: 'aceita — confirme', recusada: 'recusada',
                       concluida: tr('negócio fechado'), desistiu: 'desistiu', perdida: 'perdida', cancelada: 'cancelada' };
  function mcBolsoReal() {
    // os números de verdade (DB.moedas responde alto para o bolso sem fundo do Mestre)
    var d = safe(function () { return JOGO.DB.exportar(); }, null) || {};
    return { saco: Math.floor(Number((d.carteira || {}).moedas) || 0), banco: Math.floor(Number((d.banco || {}).moedas) || 0) };
  }
  function mcPeca(itemId, lv, st) {
    var it = itemDef(itemId) || {};
    return esc(it.name || itemId) + (lv ? ' +' + lv : '') + (st ? ' ★' + st : '');
  }
  /* a linha de uma peça com a cor da raridade, o que ela dá (com forja e estrela) e a
   * comparação com a vestida do herói da ficha */
  function mcLinhaSrv(itemId, lv, st, sub, comBonus) {
    var it = itemDef(itemId) || {};
    var row = el('div', 'mc-linha');
    markRarity(row, it.rarity);
    var ic = el('span', 'mc-ic');
    ic.appendChild(art('itemIcon', [itemId, 34], 34));
    row.appendChild(ic);
    var tx = el('div', 'ms-tx');
    tx.appendChild(el('div', 'ms-nome', mcPeca(itemId, lv, st)));
    tx.appendChild(el('div', 'ms-prog', esc(SLOT_PT[slotOf(itemId)] || '') + ' · ' +
      esc(RAR_PT[it.rarity] || it.rarity || '') + nvTxt(itemId) + (sub ? ' · ' + sub : '')));
    if (comBonus) {
      tx.appendChild(el('div', 'mc-cmp', esc(itemBonusText(it, lv, st))));
      var cmp = safe(function () { return comparaComVestida(itemId, lv, st, ensurePartyHero()); }, null);
      if (cmp) tx.appendChild(el('div', 'mc-cmp', cmp));
    }
    row.appendChild(tx);
    // 08/10 à noite: o toque no nome abre, debaixo da linha, a MESMA ficha do inventário (e fecha no segundo)
    tx.classList.add('is-toque');
    tap(tx, function () {
      var aberta = row.nextSibling;
      if (aberta && aberta.classList && aberta.classList.contains('mc-ficha')) { aberta.parentNode.removeChild(aberta); return; }
      var f = fichaItem({ itemId: itemId, level: lv || 0, stars: st || 0 }, { hid: ensurePartyHero(), compacto: true });
      f.classList.add('mc-ficha');
      if (row.parentNode) row.parentNode.insertBefore(f, row.nextSibling);
    });
    return row;
  }
  function mcEstadoChip(estado) {
    return el('span', 'mc-estado e-' + estado, esc(MC_ESTADO_PT[estado] || estado));
  }

  function sheetMercadoServidor() {
    sheetName = 'mercado';
    var Srv = JOGO.Mercado.servidor;
    var body = sheetShell(tr('Mercadinho do Acampamento'),
      tr('O balcão de todos os jogadores. Compre pelo preço ou faça uma oferta; a taxa de 5% sai do preço final da venda.'));
    var bolso = mcBolsoReal();
    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);
    var pBolso = el('p', 'mc-bolso', tr('No saco: <b>{saco}</b> · no banco: <b>{banco}</b> vinténs', { saco: bolso.saco, banco: bolso.banco }));
    pBolso.insertBefore(art('vintemIcon', [18], 18, 'moeda-inline'), pBolso.firstChild);
    caixa.appendChild(pBolso);
    if (['comprar', 'vender', 'meus', 'ofertas', 'pocoes'].indexOf(mcAba) < 0) mcAba = 'comprar';
    caixa.appendChild(mcAbas([{ id: 'comprar' }, { id: 'vender' }, { id: 'meus' }, { id: 'ofertas' },
                              { id: 'pocoes' }], function (id) {
      mcAba = id; mcSrv.item = null; mcSrv.oferta = null; sheetMercado();
    }));
    var area = el('div', 'mc-lista');
    caixa.appendChild(area);

    function ainda() { return sheetName === 'mercado' && document.body.contains(area); }
    function carregando() { clear(area); area.appendChild(el('p', 'inv-dica', tr('Consultando o balcão…'))); }
    function falhou(r) {
      clear(area);
      area.appendChild(el('p', 'inv-dica', esc((r && r.erro) || tr('O servidor não respondeu — tente de novo em instantes.'))));
    }
    /* depois de uma ação: com estado adotado a repintura já refez a ficha; sem, refaz aqui */
    function depois(r, textoOk) {
      if (r && r.ok) { if (textoOk) toast(textoOk, 'good'); }
      else toast((r && r.erro) || tr('não deu'));
      if (!(r && (r.progress || r.db)) && sheetName === 'mercado') sheetMercado();
    }
    // os filtros acendem NO LUGAR (sem redesenhar): a lista já veio do servidor
    function chipsSrv(rotulo, chave, opcoes, aoMudar) {
      return mcFiltroFila(rotulo, chave, opcoes, mcSrv[chave], function (id) {
        mcSrv[chave] = id;
        aoMudar();
      }, true);
    }
    /* `aoMudar` repinta a lista que já veio; `aoCat` remonta a área na outra
     * categoria (as fileiras de filtro são outras) — nenhum dos dois pede ao
     * servidor de novo */
    function filtros(aoMudar, aoCat, onde) {
      // 08/10 à noite: a barra de seletores; os de espaço/raridade/elemento filtram NO LUGAR (a lista já veio)
      var pedras = mcSrv.cat === 'pedras';
      (onde || area).appendChild(mcBarra({
        cat: mcSrv.cat, aoCat: function (id) { if (id === mcSrv.cat) return; mcSrv.cat = id; mcSrv.q = ''; aoCat(); },
        q: mcSrv.q, aoQ: function (v) { mcSrv.q = v; aoMudar(); },
        placeholder: pedras ? tr('buscar pedra por nome...') : tr('buscar por nome...'),
        el: mcSrv.el, aoEl: function (v) { mcSrv.el = v; aoMudar(); },
        slot: mcSrv.slot, aoSlot: function (v) { mcSrv.slot = v; aoMudar(); },
        rar: mcSrv.rar, aoRar: function (v) { mcSrv.rar = v; aoMudar(); }
      }));
    }
    // a pedra não tem itemDef: nunca passa em Equipamentos (22/09)
    function passa(itemId) {
      var it = itemDef(itemId);
      if (!it) return false;
      var tq = normaliza(mcSrv.q);
      if (tq && normaliza(it.name || itemId).indexOf(tq) < 0) return false;
      if (mcSrv.slot !== 'todos' && slotOf(itemId) !== mcSrv.slot) return false;
      if (mcSrv.rar !== 'todas' && (it.rarity || 'comum') !== mcSrv.rar) return false;
      return true;
    }

    // ---- COMPRAR: a lista por item
    var mc2 = null;                       // as duas colunas da aba aberta ({esq, dir})
    function pintaComprar() {
      carregando();
      Srv.resumo().then(function (r) {
        if (!ainda()) return;
        if (!r || !r.ok) { falhou(r); return; }
        monta();
        // a categoria troca AQUI, com o resumo que já veio (sem pedir de novo)
        function monta() {
          clear(area);
          mc2 = mc2Molde(area);
          var lista = el('div', 'mc-lista');
          function pintaLista() {
            clear(lista);
            if (mcSrv.cat === 'pedras') pintaPedras(lista); else pintaItens(lista);
          }
          filtros(pintaLista, monta, mc2.esq);
          mc2.esq.appendChild(lista);
          pintaLista();
          // 08/10 à noite: o item tocado abre à DIREITA, com a lista ainda à vista
          if (mcSrv.item) pintaItem(mcSrv.item, mc2.dir);
          else mc2Dica(mc2.dir, mcSrv.cat === 'pedras' ? tr('Toque numa pedra para ver os lotes à venda.') : tr('Toque numa peça para ver quem vende, o preço e fazer a sua oferta.'));
        }
        /* COMPRAR › PEDRAS: uma linha por PEDRA (o resumo.pedras do servidor):
         * quantos lotes, quantas pedras somadas, o lote mais barato e o menor
         * preço por pedra — os dois podem ser de lotes diferentes */
        function pintaPedras(lista) {
          var todas = r.pedras || [];
          var vistas = todas.filter(function (x) { return passaPedra(x.stoneId, mcSrv.q, mcSrv.el); });
          vistas.sort(function (a, b) { return mcNomePedra(a.stoneId).localeCompare(mcNomePedra(b.stoneId)); });
          var nLotes = 0, nPedras = 0;
          vistas.forEach(function (x) { nLotes += x.lotes; nPedras += x.pedras; });
          // PEDRAS é a soma dos lotes; TIPOS, quantas pedras diferentes aparecem
          lista.appendChild(el('p', 'mc-resumo', tr('<b>{nPedras}</b> {a} em {nLotes} {b} à venda · {length} {c}{d} · a pedra vai direto ao estoque, não ocupa o saco', { nPedras: nPedras, a: nPedras === 1 ? 'pedra' : 'pedras', nLotes: nLotes, b: nLotes === 1 ? 'lote' : 'lotes', length: vistas.length, c: vistas.length === 1 ? 'tipo' : 'tipos', d: vistas.length !== todas.length ? ' ' + tr('(de {length})', { length: todas.length }) : '' })));
          if (!vistas.length) {
            lista.appendChild(el('p', 'inv-dica', todas.length ? tr('Nenhuma pedra com esses filtros.')
              : tr('Nenhuma pedra à venda agora. Quem tem pedra sobrando anuncia em <b>Vender</b> › <b>Pedras</b> — em unidade ou lotes de 10, 50 e 100.')));
          }
          vistas.forEach(function (x) {
            var row = mcLinhaPedra(x.stoneId, esc(mcNomePedra(x.stoneId)), (x.lotes === 1
              ? (x.pedras === 1 ? tr('<b>{lotes}</b> lote · {pedras} pedra{a}', { lotes: x.lotes, pedras: x.pedras, a: x.meus ? ' (' + x.meus + (x.meus === 1 ? ' seu' : ' seus') + ')' : '' }) : tr('<b>{lotes}</b> lote · {pedras} pedras{a}', { lotes: x.lotes, pedras: x.pedras, a: x.meus ? ' (' + x.meus + (x.meus === 1 ? ' seu' : ' seus') + ')' : '' }))
              : (x.pedras === 1 ? tr('<b>{lotes}</b> lotes · {pedras} pedra{a}', { lotes: x.lotes, pedras: x.pedras, a: x.meus ? ' (' + x.meus + (x.meus === 1 ? ' seu' : ' seus') + ')' : '' }) : tr('<b>{lotes}</b> lotes · {pedras} pedras{a}', { lotes: x.lotes, pedras: x.pedras, a: x.meus ? ' (' + x.meus + (x.meus === 1 ? ' seu' : ' seus') + ')' : '' }))));
            row.appendChild(el('span', 'mc-preco', 'desde ' + x.menor + 'v' +
              (x.menorUnit != null ? '<small>' + tr('{a}v cada', { a: mcNum(x.menorUnit) }) + '</small>' : '')));
            if (mcSrv.item === x.stoneId) row.classList.add('is-sel');
            row.appendChild(btn(tr('Ver lotes'), 'btn-mini btn-gold', function () {
              mcSrv.item = x.stoneId; mcSrv.oferta = null;
              [].forEach.call(lista.querySelectorAll('.mc-linha'), function (l) { l.classList.toggle('is-sel', l === row); });
              pintaItem(x.stoneId, mc2 && mc2.dir);
            }));
            lista.appendChild(row);
          });
        }
        function pintaItens(lista) {
          // o servidor já tira os lotes de `itens`; a pedra que vier ali mesmo assim não é peça
          var todos = (r.itens || []).filter(function (x) { return !ehPedraId(x.itemId); });
          var itens = todos.filter(function (x) { return passa(x.itemId); });
          itens.sort(function (a, b) {
            return ((itemDef(a.itemId) || {}).name || '').localeCompare((itemDef(b.itemId) || {}).name || '');
          });
          var qtd = 0;
          itens.forEach(function (x) { qtd += x.qtd; });
          lista.appendChild(el('p', 'mc-resumo', (itens.length === 1
            ? tr('<b>{length}</b> item · {qtd} à venda{a}', { length: itens.length, qtd: qtd, a: itens.length !== todos.length ? ' ' + tr('(de {length} itens)', { length: todos.length }) : '' })
            : tr('<b>{length}</b> itens · {qtd} à venda{a}', { length: itens.length, qtd: qtd, a: itens.length !== todos.length ? ' ' + tr('(de {length} itens)', { length: todos.length }) : '' }))));
          if (!itens.length) {
            lista.appendChild(el('p', 'inv-dica', todos.length ? tr('Nada com esses filtros.')
              : tr('O balcão está vazio. Ele só enche quando alguém anuncia uma peça — e a sua oferta fica aqui até vender.')));
          }
          // 08/10 à noite: a grade só de ícones — ×N à venda e "desde Xv" embaixo; o toque abre à direita
          var grade = el('div', 'mc-grade grade-icones');
          itens.forEach(function (x) {
            grade.appendChild(mcCelula(x.itemId, { n: x.qtd, preco: x.menor + 'v', sel: mcSrv.item === x.itemId,
              aoTocar: function () {
                mcSrv.item = x.itemId; mcSrv.oferta = null;
                [].forEach.call(grade.querySelectorAll('.mc-cel'), function (c) { c.classList.toggle('is-sel', c.getAttribute('data-item') === x.itemId); });
                pintaItem(x.itemId, mc2 && mc2.dir);
              } }));
          });
          if (itens.length) lista.appendChild(grade);
        }
      });
    }

    /* ---- COMPRAR: todos os anúncios de um item, com quem vende. 22/09: o mesmo
     * para uma PEDRA (o ?id= é o da pedra) — cada linha é um lote ("Lote de 50 ·
     * vende Fulano"), com o preço do lote e o preço por pedra, e "Comprar por X"
     * sem olhar o saco (a pedra vai ao estoque). A oferta vale igual para o lote. */
    function pintaItem(itemId, alvo) {
      var pedra = ehPedraId(itemId);
      var alvo2 = alvo || area;
      clear(alvo2);
      alvo2.appendChild(el('p', 'inv-dica', tr('Consultando o balcão…')));
      Srv.item(itemId).then(function (r) {
        if (!ainda()) return;
        if (!r || !r.ok) { falhou(r); return; }
        clear(alvo2);
        // 08/10 à noite: a ficha da peça no alto da coluna (a pedra tem a linha dela)
        if (!pedra) alvo2.appendChild(fichaItem({ itemId: itemId, level: 0, stars: 0 }, { hid: ensurePartyHero(), compacto: true }));
        alvo2.appendChild(btn(pedra ? tr('← Todas as pedras') : tr('← Todos os itens'), 'btn-mini btn-ghost mc-voltar', function () {
          mcSrv.item = null; mcSrv.oferta = null;
          if (alvo) { mc2Dica(alvo, pedra ? tr('Toque numa pedra para ver os lotes à venda.') : tr('Toque numa peça para ver quem vende, o preço e fazer a sua oferta.')); [].forEach.call(area.querySelectorAll('.is-sel'), function (c) { c.classList.remove('is-sel'); }); }
          else pintaComprar();
        }));
        var ans = r.anuncios || [];
        alvo2.appendChild(el('p', 'mc-resumo', pedra
          ? (ans.length === 1
            ? tr('<b>{length}</b> lote de <b>{a}</b> — do mais barato ao mais caro por pedra', { length: ans.length, a: esc(mcNomePedra(itemId)) })
            : tr('<b>{length}</b> lotes de <b>{a}</b> — do mais barato ao mais caro por pedra', { length: ans.length, a: esc(mcNomePedra(itemId)) }))
          : (ans.length === 1
            ? tr('<b>{length}</b> anúncio de <b>{a}</b> — do mais barato ao mais caro', { length: ans.length, a: mcPeca(itemId, 0, 0) })
            : tr('<b>{length}</b> anúncios de <b>{a}</b> — do mais barato ao mais caro', { length: ans.length, a: mcPeca(itemId, 0, 0) }))));
        var listaDir = el('div', 'mc-lista');      // as linhas dos anúncios (as provas acham .mc-lista .mc-linha)
        alvo2.appendChild(listaDir);
        if (!ans.length) listaDir.appendChild(el('p', 'inv-dica', pedra ? tr('Os lotes dessa pedra acabaram de sair do balcão.')
          : tr('Esse item acabou de sair do balcão.')));
        var tenho = bolso.saco + bolso.banco;
        ans.forEach(function (an) {
          var qtd = Math.max(1, Math.floor(Number(an.qtd)) || 1);
          var quem = an.meu ? tr('seu anúncio') : 'vende <b>' + esc(an.vendedor || 'jogador') + '</b>';
          // o preço por pedra mora embaixo do preço do lote (mcPrecoLote), não na linha de quem vende
          var row = pedra
            ? mcLinhaPedra(itemId, qtd > 1 ? tr('Lote de {qtd}', { qtd: qtd }) : '1 pedra', quem)
            : mcLinhaSrv(itemId, an.level, an.stars, quem, true);
          if (pedra) row.setAttribute('data-lote', String(qtd));
          if (an.meu) row.classList.add('is-minha');
          row.appendChild(pedra ? mcPrecoLote(an.preco, qtd) : el('span', 'mc-preco', an.preco + 'v'));
          var form = null;
          if (!an.meu) {
            var bC = btn(tr('Comprar por {preco}', { preco: an.preco }), 'btn-mini btn-gold', function () {
              if (!pedra && !safe(function () { return P().bagFree(1); }, true)) { toast(tr('O saco está cheio — não cabe mais nada.')); return; }
              bC.classList.add('is-off');
              Srv.comprar(an.id).then(function (res) {
                var oque = pedra ? mcNomeLote(itemId, qtd) : (itemDef(itemId) || {}).name;
                depois(res, res && res.ok ? (pedra
                  ? tr('Comprado: {oque} por {valor} vinténs{a} — as pedras já estão no estoque.', { oque: oque, valor: res.valor, a: res.deBanco ? ' ' + tr('({deBanco} saíram do banco)', { deBanco: res.deBanco }) : '' })
                  : tr('Comprado: {oque} por {valor} vinténs{a}.', { oque: oque, valor: res.valor, a: res.deBanco ? ' ' + tr('({deBanco} saíram do banco)', { deBanco: res.deBanco }) : '' })) : null);
              });
            });
            if (tenho < an.preco) { bC.classList.add('is-off'); bC.title = tr('faltam {a} vinténs (saco + banco)', { a: an.preco - tenho }); }
            row.appendChild(bC);
            if (an.preco > 1) {
              row.appendChild(btn(an.minhaProposta ? tr('Nova oferta') : tr('Fazer oferta'), 'btn-mini', function () {
                if (form) form.hidden = !form.hidden;
                if (form && !form.hidden) { var c0 = form.querySelector('input'); if (c0) c0.focus(); }
              }));
            }
          }
          listaDir.appendChild(row);
          if (an.minhaProposta) {
            var sub = el('div', 'mc-sub');
            var mp = an.minhaProposta;
            var lp = el('div', 'mc-prop' + (mp.estado === 'aceita' ? ' is-aceita' : ''));
            lp.appendChild(el('span', 'mc-prop-tx', tr('Sua oferta: <b>{valor}v</b>', { valor: mp.valor })));
            lp.appendChild(mcEstadoChip(mp.estado));
            lp.appendChild(btn(tr('Cancelar'), 'btn-mini btn-ghost', function () {
              Srv.cancelar(mp.id).then(function (res) { depois(res, tr('Oferta cancelada.')); });
            }));
            sub.appendChild(lp);
            listaDir.appendChild(sub);
          }
          if (!an.meu && an.preco > 1) {
            form = el('div', 'mc-oferta');
            form.hidden = mcSrv.oferta !== an.id;
            var campo = document.createElement('input');
            campo.type = 'number'; campo.min = '1'; campo.max = String(an.preco - 1); campo.step = '1';
            campo.className = 'bk2-qtd mc-qtd';
            campo.placeholder = String(Math.max(1, Math.floor(an.preco * 0.8)));
            form.appendChild(el('span', 'mc-cmp', tr('Quanto você oferece (menos de {preco}):', { preco: an.preco })));
            form.appendChild(campo);
            form.appendChild(btn(tr('Enviar oferta'), 'btn-mini btn-gold', function () {
              var v = Math.floor(Number(campo.value || campo.placeholder));
              if (!(v >= 1 && v < an.preco)) { toast(tr('A oferta vai de 1 a {a} vinténs.', { a: an.preco - 1 })); return; }
              if (v > tenho) { toast(tr('Você não tem {v} vinténs (somando saco e banco).', { v: v })); return; }
              mcSrv.oferta = null;
              Srv.propor(an.id, v).then(function (res) {
                depois(res, tr('Oferta de {v} vinténs enviada a {a}. Se ele aceitar, você confirma aqui na praça.', { v: v, a: an.vendedor || 'o vendedor' }));
              });
            }));
            listaDir.appendChild(form);
          }
        });
      });
    }

    // ---- VENDER: o saco, com a régua e a taxa antes de anunciar
    var mcVenda = null;                   // a pilha do saco escolhida para vender ({itemId, level, stars, extra})
    function pintaVender() {
      clear(area);
      mc2 = mc2Molde(area);
      var lista = el('div', 'mc-lista');
      function pintaLista() {
        clear(lista);
        if (mcSrv.cat === 'pedras') {
          // VENDER › PEDRAS: o servidor tira as pedras do estado dele e devolve o estado novo
          mcPintaVendaPedras(lista, mcSrv.q, mcSrv.el, function (sid, qtd, preco, bA) {
            bA.classList.add('is-off');
            Srv.anunciarPedras(sid, qtd, preco).then(function (res) {
              depois(res, mcTextoLoteAnunciado(sid, qtd, preco));
            });
          });
          return;
        }
        var pilhas = safe(function () { return P().invStacks(); }, [])
          .filter(function (s2) { return passa(s2.itemId); });
        lista.appendChild(el('p', 'mc-resumo', tr('<b>{length}</b> no saco · a taxa de 5% sai do preço final da venda', { length: pilhas.length })));
        if (!pilhas.length) lista.appendChild(el('p', 'inv-dica', tr('Nada no saco com esses filtros.')));
        // 08/10 à noite: a grade do saco; a peça tocada abre à direita com o preço e o Anunciar
        var grade = el('div', 'mc-grade grade-icones');
        function mesma(pi) { return !!(mcVenda && mcVenda.itemId === pi.itemId && mcVenda.level === pi.level && mcVenda.stars === pi.stars && (mcVenda.extra || null) === (pi.extra || null)); }
        var escolhida = null;
        pilhas.forEach(function (pi) {
          if (mesma(pi)) escolhida = pi;
          grade.appendChild(mcCelula(pi.itemId, { n: pi.count, level: pi.level, stars: pi.stars, sel: mesma(pi),
            preco: '~' + JOGO.Mercado.precoSugerido(pi.itemId, pi.level, pi.stars) + 'v',
            aoTocar: function () {
              mcVenda = { itemId: pi.itemId, level: pi.level, stars: pi.stars, extra: pi.extra || null };
              [].forEach.call(grade.querySelectorAll('.mc-cel'), function (c) { c.classList.remove('is-sel'); });
              pintaLista();
            } }));
        });
        if (pilhas.length) lista.appendChild(grade);
        if (!escolhida) { mc2Dica(mc2.dir, tr('Toque numa peça do saco para pôr o preço e anunciar.')); return; }
        clear(mc2.dir);
        [escolhida].forEach(function (pi) {
          var sugerido = JOGO.Mercado.precoSugerido(pi.itemId, pi.level, pi.stars);
          mc2.dir.appendChild(fichaItem({ itemId: pi.itemId, level: pi.level, stars: pi.stars, extra: pi.extra || null, count: pi.count, index: pi.indices ? pi.indices[0] : pi.index },
                                        { hid: ensurePartyHero(), compacto: true }));
          var row = el('div', 'mc-linha mc-venda');
          row.appendChild(el('span', 'mc-cmp', tr('{a}a régua sugere {sugerido}v', { a: pi.count > 1 ? '×' + pi.count + ' · ' : '', sugerido: sugerido })));
          var campo = document.createElement('input');
          campo.type = 'number'; campo.min = '1'; campo.max = String(JOGO.Mercado.PRECO_MAX); campo.step = '1';
          campo.className = 'bk2-qtd mc-qtd';
          campo.placeholder = String(sugerido);
          var taxaEl = el('span', 'mc-taxa', '');
          function mostraTaxa() {
            var preco = Math.floor(Number(campo.value || sugerido)) || 0;
            if (preco <= 0) { taxaEl.textContent = ''; return; }
            taxaEl.innerHTML = tr('recebe <b>{a}v</b><small>taxa {b}v</small>', { a: preco - mcTaxa(preco), b: mcTaxa(preco) });
          }
          campo.addEventListener('input', mostraTaxa);
          mostraTaxa();
          row.appendChild(campo);
          row.appendChild(taxaEl);
          var bA = btn(tr('Anunciar'), 'btn-mini btn-gold', function () {
            var preco = Math.floor(Number(campo.value || sugerido));
            if (!(preco >= 1 && preco <= JOGO.Mercado.PRECO_MAX)) { toast(tr('Preço entre 1 e {PRECO_MAX}.', { PRECO_MAX: JOGO.Mercado.PRECO_MAX })); return; }
            var entrada = P().state.inventory[pi.indices[0]];
            if (!entrada) { toast(tr('essa peça já saiu')); sheetMercado(); return; }
            bA.classList.add('is-off');
            Srv.anunciar(entrada, preco, pi.indices[0]).then(function (res) {
              depois(res, tr('No balcão por {preco}v — você recebe {a}v se vender por esse preço.', { preco: preco, a: preco - mcTaxa(preco) }));
            });
          });
          row.appendChild(bA);
          mc2.dir.appendChild(row);
        });
      }
      filtros(pintaLista, pintaVender, mc2.esq);
      mc2.esq.appendChild(lista);
      pintaLista();
    }

    // ---- MEUS ANÚNCIOS: cada um com as propostas recebidas, e as vendas recentes
    function pintaMeus() {
      carregando();
      Srv.meus().then(function (r) {
        if (!ainda()) return;
        if (!r || !r.ok) { falhou(r); return; }
        clear(area);
        var ans = r.anuncios || [];
        area.appendChild(el('p', 'mc-resumo', ans.length
          ? tr('<b>{length}</b> de {max} anúncios abertos · as propostas aparecem embaixo de cada um', { length: ans.length, max: r.max })
          : tr('Você não tem nada anunciado. Vá em <b>Vender</b> para pôr uma peça ou um lote de pedras no balcão.')));
        var novas = [];
        ans.forEach(function (an) {
          // 22/09: o lote de pedras (tipo 'pedra') mostra a pedra e o preço por pedra
          var lote = mcEhLote(an), sid = lote ? mcPedraDe(an) : null;
          var row = lote
            ? mcLinhaPedra(sid, esc(mcNomeLote(sid, an.qtd, true)), tr('sua oferta{a}', { a: an.qtd > 1 ? ' ' + tr('· <b>{a}v</b> a pedra', { a: mcUnit(an.preco, an.qtd) }) : '' }))
            : mcLinhaSrv(an.itemId, an.level, an.stars, tr('sua oferta'));
          row.classList.add('is-minha');
          row.appendChild(el('span', 'mc-preco', an.preco + 'v'));
          row.appendChild(el('span', 'mc-taxa', 'recebe <b>' + (an.preco - an.taxa) + 'v</b><small>taxa ' + an.taxa + 'v</small>'));
          var bR = btn(tr('Retirar'), 'btn-mini', function () {
            // o lote volta ao estoque: o saco cheio não impede
            if (!lote && !safe(function () { return P().bagFree(1); }, true)) { toast(tr('O saco está cheio — não cabe mais nada.')); return; }
            bR.classList.add('is-off');
            Srv.retirar(an.id).then(function (res) {
              var pd = (res && res.pedras) || { stoneId: sid, qtd: an.qtd };
              depois(res, lote ? tr('O lote voltou: +{qtd} {a} no estoque.', { qtd: pd.qtd, a: mcNomePedra(pd.stoneId) })
                               : tr('A peça voltou para o saco.'));
            });
          });
          row.appendChild(bR);
          area.appendChild(row);
          if (!an.propostas || !an.propostas.length) return;
          var sub = el('div', 'mc-sub');
          an.propostas.forEach(function (p) {
            if (p.estado === 'aberta' && !p.vistoVendedor) novas.push(p.id);
            var lp = el('div', 'mc-prop' + (p.estado === 'aceita' ? ' is-aceita' : ''));
            lp.appendChild(el('span', 'mc-prop-tx', tr('<b>{a}</b> oferece <b>{valor}v</b> (você recebe {b}v)', { a: esc(p.comprador || 'jogador'), valor: p.valor, b: p.valor - p.taxa })));
            lp.appendChild(mcEstadoChip(p.estado === 'aceita' ? 'aceita' : p.estado));
            if (p.estado === 'aberta') {
              lp.appendChild(btn(tr('Aceitar'), 'btn-mini btn-gold', function () {
                Srv.responder(p.id, true).then(function (res) {
                  depois(res, tr('Proposta aceita. Quando {a} confirmar, a venda sai por {valor}v — se ninguém comprar antes.', { a: p.comprador || 'o comprador', valor: p.valor }));
                });
              }));
              lp.appendChild(btn(tr('Recusar'), 'btn-mini btn-ghost', function () {
                Srv.responder(p.id, false).then(function (res) { depois(res, tr('Proposta recusada.')); });
              }));
            }
            sub.appendChild(lp);
          });
          area.appendChild(sub);
        });
        if (novas.length) Srv.visto({ recebidas: novas });
        var vendas = r.vendas || [];
        if (vendas.length) {
          area.appendChild(el('h3', 'bk-tit', tr('Vendas recentes')));
          vendas.forEach(function (v) {
            var quem = (v.viaProposta
              ? tr('para <b>{a}</b> · por proposta', { a: esc(v.comprador || 'jogador') })
              : tr('para <b>{a}</b>', { a: esc(v.comprador || 'jogador') }));
            var row = mcEhLote(v) ? mcLinhaPedra(mcPedraDe(v), esc(mcNomeLote(mcPedraDe(v), v.qtd, true)), quem)
                                  : mcLinhaSrv(v.itemId, v.level, v.stars, quem);
            row.appendChild(el('span', 'mc-preco', v.valor + 'v'));
            row.appendChild(el('span', 'mc-taxa', 'recebeu <b>' + v.recebeu + 'v</b><small>taxa ' + v.taxa + 'v</small>'));
            area.appendChild(row);
          });
        }
      });
    }

    // ---- MINHAS OFERTAS: o estado de cada proposta
    function pintaOfertas() {
      carregando();
      Srv.propostas().then(function (r) {
        if (!ainda()) return;
        if (!r || !r.ok) { falhou(r); return; }
        clear(area);
        var ps = r.propostas || [];
        area.appendChild(el('p', 'mc-resumo', ps.length ? '<b>' + ps.length + '</b> ofertas recentes'
          : tr('Você não fez nenhuma oferta. Em <b>Comprar</b>, abra um item e toque em <b>Fazer oferta</b>.')));
        ps.forEach(function (p) {
          var deQuem = tr('de <b>{a}</b> · à venda por {preco}v', { a: esc(p.vendedor || 'jogador'), preco: p.preco });
          var row = mcEhLote(p) ? mcLinhaPedra(mcPedraDe(p), esc(mcNomeLote(mcPedraDe(p), p.qtd, true)), deQuem)
                                : mcLinhaSrv(p.itemId, p.level, p.stars, deQuem);
          row.appendChild(el('span', 'mc-preco', p.valor + 'v'));
          row.appendChild(mcEstadoChip(p.estado));
          if (p.estado === 'aceita' && p.anuncioAberto) {
            row.appendChild(btn(tr('Conferir'), 'btn-mini btn-gold', function () { openSheet('mercadoConfirma', p); }));
          }
          if (p.estado === 'aberta' || p.estado === 'aceita') {
            row.appendChild(btn(tr('Cancelar'), 'btn-mini btn-ghost', function () {
              Srv.cancelar(p.id).then(function (res) { depois(res, tr('Oferta cancelada.')); });
            }));
          }
          area.appendChild(row);
        });
      });
    }

    if (mcAba === 'pocoes') mcBancaPocoes(area, function () { return mcBolsoReal().saco; });
    else if (mcAba === 'vender') pintaVender();
    else if (mcAba === 'meus') pintaMeus();
    else if (mcAba === 'ofertas') pintaOfertas();
    else pintaComprar();
  }

  /* A CONFIRMAÇÃO DO COMPRADOR (13/09, o texto do dono): "O vendedor Fulano aceitou sua
   * oferta de Y valor pelo item que estava a venda pelo valor X." + o item para conferir +
   * "deseja aceitar essa negociação?". Uma por vez, só na praça (o vigia do
   * js/core/mercado.js decide quando); fechar no ✕ adia, e ela volta depois. */
  function sheetMercadoConfirma(p) {
    var Srv = JOGO.Mercado && JOGO.Mercado.servidor;
    if (!p || !Srv) { closeSheet(); return; }
    var b = sheetShell(tr('Proposta aceita no Mercadinho'));
    sheetName = 'mercadoConfirma';
    // 22/09: a proposta pode ser por um LOTE de pedras — o texto do dono diz "pelo lote"
    var lote = mcEhLote(p), sid = lote ? mcPedraDe(p) : null;
    b.appendChild(el('p', 'confirm-txt', (lote
      ? tr('O vendedor <b>{a}</b> aceitou sua oferta de <b>{valor}</b> vinténs pelo lote que estava à venda por <b>{preco}</b>.', { a: esc(p.vendedor || 'jogador'), valor: p.valor, preco: p.preco })
      : tr('O vendedor <b>{a}</b> aceitou sua oferta de <b>{valor}</b> vinténs pelo item que estava à venda por <b>{preco}</b>.', { a: esc(p.vendedor || 'jogador'), valor: p.valor, preco: p.preco }))));
    var card = lote
      ? mcLinhaPedra(sid, esc(mcNomeLote(sid, p.qtd, true)), tr('{a}as pedras vão direto ao estoque', { a: p.qtd > 1 ? tr('<b>{a}v</b> a pedra ·', { a: mcUnit(p.valor, p.qtd) }) + ' ' : '' }))
      : mcLinhaSrv(p.itemId, p.level, p.stars, null, true);
    card.classList.add('mc-card');
    card.appendChild(el('span', 'mc-preco', p.valor + 'v'));
    b.appendChild(card);
    var bolso = mcBolsoReal(), tem = bolso.saco + bolso.banco;
    b.appendChild(el('p', 'mc-saldo', tr('Você tem <b>{saco}</b> no saco e <b>{banco}</b> no banco. {a}', { saco: bolso.saco, banco: bolso.banco, a: tem < p.valor ? '<span class="is-falta">' + tr('Faltam {a} vinténs.', { a: p.valor - tem }) + '</span>'
                     : tr('O valor sai primeiro do saco; o que faltar, do banco.') })));
    b.appendChild(el('p', 'confirm-txt', tr('<b>Deseja aceitar essa negociação?</b>')));
    var acts = el('div', 'confirm-acts');
    function fim(desfecho) {
      if (sheetName === 'mercadoConfirma') closeSheet();
      Srv.respondeuConfirmacao(p, desfecho);
    }
    var bNeg = btn(tr('Negar'), 'btn-ghost', function () {
      bNeg.classList.add('is-off'); bSim.classList.add('is-off');
      Srv.confirmar(p.id, false).then(function (r) {
        if (r && r.ok) { toast((lote
          ? tr('Você recusou a negociação. O lote segue à venda.')
          : tr('Você recusou a negociação. O item segue à venda.'))); fim('feito'); return; }
        toast((r && r.erro) || tr('não deu'));
        fim(r && r.status === 0 ? 'adiado' : 'feito');
      });
    });
    var bSim = btn(tr('Aceitar'), 'btn-primary', function () {
      bNeg.classList.add('is-off'); bSim.classList.add('is-off');
      Srv.confirmar(p.id, true).then(function (r) {
        if (r && r.ok) {
          toast(tr('Negócio fechado: {a} por {valor} vinténs{b}.', { a: lote ? mcNomeLote(sid, p.qtd) : ((itemDef(p.itemId) || {}).name || p.itemId), valor: p.valor, b: r.deBanco ? ' ' + tr('({deBanco} saíram do banco)', { deBanco: r.deBanco }) : '' }), 'good');
          fim('feito');
        } else if (r && r.motivo === 'perdeu') {
          toast(lote ? tr('Esse lote já foi vendido — você perdeu essa negociação.')
                     : tr('Esse item já foi vendido — você perdeu essa negociação.'));
          fim('feito');
        } else if (r && r.motivo === 'saldo') {
          toast(tr('Saldo insuficiente: {a}.', { a: r.erro || tr('faltam vinténs') }));
          fim('adiado');
        } else {
          toast((r && r.erro) || tr('não deu'));
          fim((r && (r.status === 0 || r.status >= 500 || r.motivo === 'saco')) ? 'adiado' : 'feito');
        }
      });
    });
    acts.appendChild(bNeg);
    acts.appendChild(bSim);
    b.appendChild(acts);
  }

  /* O VIGIA DO MERCADINHO: a HUD diz ao js/core/mercado.js como mostrar. A confirmação
   * só aparece na praça e com a tela livre (ou o Mercadinho aberto); as notícias entram
   * na mesma fila de avisos da loja (um de cada vez, 3 s cada). */
  safe(function () {
    var Srv = JOGO.Mercado && JOGO.Mercado.servidor;
    if (!Srv || !Srv.vigia) return false;
    Srv.vigia({
      confirma: function (p) { openSheet('mercadoConfirma', p); },
      estaMostrando: function () { return sheetName === 'mercadoConfirma'; },
      podeMostrar: function () {
        return !!toastEl && UI.telaAtual() === 'hub' && (!sheetName || sheetName === 'mercado');
      },
      avisa: function (textos) {
        (textos || []).forEach(function (t) { filaLoja.push({ texto: t.texto, tipo: t.tipo }); });
        if (!lojaVez) proximoLoja();
      },
      mudou: function () {
        if (sheetName === 'mercado' && (mcAba === 'meus' || mcAba === 'ofertas')) sheetMercado();
      }
    });
    return true;
  }, false);

  /* A BARRAQUINHA DA SORTE (03/09): a roleta do Traje do Colecionador saiu
   * do Mercadinho e ganhou tenda própria na praça. A regra nova (aprovada
   * pelo dono depois da medição): 10 selos DE QUALQUER ELEMENTO compram um
   * giro, e a roleta NÃO repete peça até fechar as 4. A animação NÃO decide
   * nada: o giro (Progress.giraRoleta) resolve primeiro, a roleta só conta a
   * história parando na casa certa. */
  function sheetLoteria() {
    sheetName = 'loteria';
    var body = sheetShell(tr('Barraquinha da Sorte'),
      tr('Só chefes derrubam selos. Dez selos, de qualquer elemento, compram um giro — e a roleta não repete peça até fechar o traje.'));
    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);
    (function pintaColecionador() {
        var cfgSel = D().selos;
        if (!cfgSel || !P().selosVer) { caixa.appendChild(el('p', 'inv-dica', tr('A barraquinha não abriu.'))); return; }
        var colec = el('div', 'colec-caixa');
        colec.appendChild(el('h3', 'bk-tit', tr('A roleta do Traje do Colecionador')));
        var sl = safe(function () { return P().roletaSaldo(); }, { total: 0, precisa: cfgSel.porGiro, faltam: cfgSel.porGiro, giros: 0 });
        var faltamP = safe(function () { return P().roletaFaltamPecas(); }, []);
        colec.appendChild(el('p', 'inv-dica',
          tr('<b>{total}</b> selos no bolso · <b>{porGiro}</b> por giro · {a}{b}', { total: sl.total, porGiro: cfgSel.porGiro, a: sl.giros > 0 ? '<b>' + sl.giros + '</b> giro(s) prontos' : tr('faltam <b>{faltam}</b> para o próximo', { faltam: sl.faltam }), b: faltamP.length ? ' ' +
            tr('· ainda faltam <b>{length}</b> peça(s): {a}', { length: faltamP.length, a: esc(faltamP.map(function (pid) { return ((itemDef(pid) || {}).name || pid) + nvTxt(pid); }).join(', ')) })
          : tr(' · <b>traje fechado</b> — a repetida vira matéria de estrela') })));
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
        // 22/09: os cinco elementos redondos, como nos filtros — aqui é ESCOLHA
        // (grava no traje), então o nome do escolhido fica escrito no fim
        var filaEl = el('div', 'colec-elem');
        filaEl.appendChild(el('span', 'pt-trajes-rot', tr('O traje responde por:')));
        var escolhas = icoFila('colec-elem-fila', elemOpcoes('btn-tab bt-elem').filter(function (o) {
          return o.id !== 'todos';
        }), elAtual, function (e4) {
          safe(function () { return P().escolheSeloElemento(e4); }, false);
          toast(tr('O Traje do Colecionador agora responde por {a}.', { a: ELEM_PT[e4] || e4 }), 'good');
          sheetLoteria();
        }, true);
        filaEl.appendChild(escolhas);
        colec.appendChild(filaEl);
        /* 08/10 à noite (o dono: "os prêmios que estão em jogo devem aparecer mais escuros, e aleatoriamente
         * passa um círculo em volta acendendo o item quando passa e sorteando"): a fileira do traje fica
         * SEMPRE à vista — a peça ainda em jogo escura, a que o traje já tem com ✓ — e o giro corre o anel
         * de luz aos saltos, ao acaso, devagar no fim, até parar na sorteada. */
        var sdF = setDef(cfgSel.setId);
        var pecasF = (sdF && sdF.pieces) || [];
        var faixa = el('div', 'colec-roleta');
        var cels = pecasF.map(function (pid) {
          var tem = faltamP.indexOf(pid) < 0;
          var c2 = el('div', 'colec-peca ' + (tem ? 'is-tem' : 'is-escura'));
          c2.setAttribute('data-peca', pid);
          c2.appendChild(art('itemIcon', [pid, 48], 48));
          c2.appendChild(el('span', null, esc(((itemDef(pid) || {}).name || pid) + nvTxt(pid))));
          if (tem) c2.appendChild(el('i', 'colec-tem', '✓'));
          faixa.appendChild(c2);
          return c2;
        });
        if (pecasF.length) {
          colec.appendChild(el('p', 'inv-dica colec-premios', tr('Os prêmios em jogo ficam escuros; o ✓ marca o que o traje já tem.')));
          colec.appendChild(faixa);
        }
        var girando = false;
        var pronta = safe(function () { return P().roletaPronta(); }, false);
        colec.appendChild(btn(tr('Girar a roleta'), 'btn-gold btn-block' + (pronta ? '' : ' is-off'),
          function () {
            // 13/09 (a segurança): com sessão do site o giro é sorteado NO SERVIDOR
            var Aut = JOGO.Autoridade;
            if (Aut && Aut.ligada && Aut.ligada()) {
              Aut.opAgora('girarRoleta', {}).then(function (res) {
                if (!res.ok) { toast(res.erro || tr('O servidor não girou a roleta.')); return; }
                giro(res.resultado || null);
              });
              return;
            }
            giro(safe(function () { return P().giraRoleta(); }, null));
            function giro(r2) {
            if (!r2) {
              toast(!safe(function () { return P().bagFree(1); }, true)
                ? tr('O saco está cheio — abra espaço para o prêmio.')
                : tr('Faltam selos para o giro.'));
              return;
            }
            if (girando) return;
            girando = true;
            var alvoIdx = Math.max(0, pecasF.indexOf(r2.itemId));
            // o anel SALTA ao acaso (nunca para a mesma casa duas vezes), rápido no começo e devagar no fim,
            // e o último salto cai na sorteada; `window.__roletaRapida` (provas) encurta a espera
            var total = 14 + Math.floor(Math.random() * 6), passo = 0, atual = -1;
            var rapida = !!(window.__roletaRapida);
            (function roda() {
              var i4;
              if (passo >= total) i4 = alvoIdx;
              else {
                do { i4 = Math.floor(Math.random() * cels.length); } while (cels.length > 1 && i4 === atual);
              }
              atual = i4;
              cels.forEach(function (c3, k4) { c3.classList.toggle('is-on', k4 === i4); });
              if (passo >= total) {
                cels[alvoIdx].classList.add('is-ganhou');
                toast((r2.repetida
                  ? tr('A roleta parou: {a} — repetida, matéria de estrela.', { a: esc((itemDef(r2.itemId) || {}).name) })
                  : tr('A roleta parou: {a}! Já está no saco.', { a: esc((itemDef(r2.itemId) || {}).name) })), 'good');
                setTimeout(function () { sheetLoteria(); }, rapida ? 100 : 1500);
                return;
              }
              passo++;
              setTimeout(roda, rapida ? 5 : 70 + Math.pow(passo, 1.7) * 5);
            })();
            }
          }));
        caixa.appendChild(colec);
    })();
  }

  /* A MESA DE TROCA — duas colunas: a minha oferta (editável) e
   * a dele (espelho). Travar quando satisfeito; os dois travados liberam o
   * Confirmar; QUALQUER mudança destrava os dois. A ficha só desenha o que
   * JOGO.Troca diz — o estado mora lá, e a Rede o carrega. */
  function sheetTroca() {
    sheetName = 'troca';
    var est = JOGO.Troca ? JOGO.Troca.estado() : null;
    var body = sheetShell(tr('Mesa de Troca'),
      est ? ((est.mesmaConta
        ? tr('Com {a} — MESMA CONTA: o fluxo anda, nada se move.', { a: est.nomePar || '?' })
        : tr('Com {a}', { a: est.nomePar || '?' }))) : '');
    if (!est) {
      body.appendChild(el('p', 'inv-dica', tr('Nenhuma troca aberta. Toque num jogador na praça.')));
      return;
    }
    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);

    if (est.fase === 'convidei') {
      caixa.appendChild(el('p', 'inv-dica', tr('Convite enviado. Esperando {a}…', { a: esc(est.nomePar) })));
      caixa.appendChild(btn(tr('Cancelar'), 'btn-ghost btn-block', function () {
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
      if (!lado.itens.length && !(lado.pets || []).length) linha.appendChild(el('p', 'inv-dica', tr('nada ainda')));
      lado.itens.forEach(function (of, idx) {
        var d2 = (D().items || {})[of.itemId] || {};
        var chip = el('button', 'tr-item');
        chip.type = 'button';
        chip.appendChild(art('itemIcon', [of.itemId, 30], 30));
        chip.appendChild(el('span', null, esc(d2.name || of.itemId) +
          (of.level ? ' +' + of.level : '') + (of.stars ? ' ★' + of.stars : '') + nvTxt(of.itemId)));
        if (editavel) {
          chip.title = tr('tirar da mesa');
          tap(chip, function () { JOGO.Troca.tiraItem(idx); });
        }
        linha.appendChild(chip);
      });
      // os bichos da mesa (12/09): nível e estrelas vão junto
      (lado.pets || []).forEach(function (of, idx) {
        var dp = JOGO.Troca.descrevePet(of);
        var repete = !editavel && JOGO.Troca.jaTenhoPet(of.petId);
        var chip = el('button', 'tr-item tr-pet' + (repete ? ' is-repete' : ''));
        chip.type = 'button';
        chip.appendChild(art('petIcon', [of.petId, 30], 30));
        chip.appendChild(el('span', null, esc(dp.nome) + ' · ' + tr('Nv') + ' ' + dp.nivel +
          (dp.estrelas ? ' ' + new Array(dp.estrelas + 1).join('★') : '') +
          (repete ? tr(' — você já tem') : '')));
        if (editavel) {
          chip.title = tr('tirar da mesa');
          tap(chip, function () { JOGO.Troca.tiraPet(idx); });
        } else if (repete) {
          chip.title = tr('um bicho de cada: com este na mesa a troca não fecha');
        }
        linha.appendChild(chip);
      });
      cx.appendChild(linha);
      var pTr = el('p', 'tr-moedas', tr('{moedas} vinténs', { moedas: lado.moedas }));
      pTr.insertBefore(art('vintemIcon', [16], 16, 'moeda-inline'), pTr.firstChild);
      cx.appendChild(pTr);
      return cx;
    }

    var duplo = el('div', 'bk2-duplo');
    duplo.appendChild(ladoCaixa(tr('Você dá'), est.minha, true));
    duplo.appendChild(ladoCaixa(tr('{a} dá', { a: esc(est.nomePar) }), est.dele, false));
    caixa.appendChild(duplo);

    // ---- por moedas na mesa
    var linhaM = el('div', 'bk2-botoes');
    var campoM = document.createElement('input');
    campoM.type = 'number'; campoM.min = '0'; campoM.step = '1';
    campoM.className = 'bk2-qtd'; campoM.placeholder = tr('vinténs');
    campoM.value = est.minha.moedas || '';
    linhaM.appendChild(campoM);
    linhaM.appendChild(btn(tr('Pôr vinténs'), 'btn-mini', function () {
      var n2 = Math.floor(Number(campoM.value || 0));
      if (isFinite(n2) && n2 >= 0) JOGO.Troca.porMoedas(n2);
    }));
    caixa.appendChild(linhaM);

    // ---- o saco, para por itens
    caixa.appendChild(el('h3', 'bk-tit', tr('Seu saco — toque para pôr na mesa')));
    var todasPilhas = safe(function () { return P().invStacks(); }, [])
      .filter(function (s2) { return !!itemDef(s2.itemId); });
    // 22/09: espaço e elemento, redondos como nos outros menus de item — só
    // escolhem o que se mostra; a peça que vai à mesa é achada como sempre
    if (todasPilhas.length) {
      caixa.appendChild(filtrosDeItem(trocaSlotFiltro, function (s) {
        trocaSlotFiltro = s;
        sheetTroca();
      }, trocaElemFiltro, function (e2) {
        trocaElemFiltro = e2;
        sheetTroca();
      }));
    }
    var pilhas = todasPilhas.filter(function (pi) {
      return passaSlot(pi.itemId, trocaSlotFiltro) && passaElemento(pi.itemId, trocaElemFiltro);
    });
    var linhaS = el('div', 'tr-itens');
    if (!todasPilhas.length) linhaS.appendChild(el('p', 'inv-dica', tr('O saco está vazio.')));
    else if (!pilhas.length) linhaS.appendChild(el('p', 'inv-dica', tr('Nada no saco com esses filtros.')));
    pilhas.forEach(function (pi) {
      var it = itemDef(pi.itemId) || {};
      var chip = el('button', 'tr-item');
      chip.type = 'button';
      chip.appendChild(art('itemIcon', [pi.itemId, 30], 30));
      chip.appendChild(el('span', null, esc(it.name || pi.itemId) +
        (pi.count > 1 ? ' ×' + pi.count : '') + nvTxt(pi.itemId)));
      tap(chip, function () {
        // 11/09 (a troca "bugada" no ar): vai à mesa a PEÇA do saco, com o número
        // de série. Só com a forma (item, forja, estrelas), a execução procurava
        // uma cópia SEM série — no ar toda peça tem série — e a troca caía no fim
        var inv = safe(function () { return P().state.inventory; }, null) || [];
        var mesa = ((JOGO.Troca.estado() || {}).minha || {}).itens || [];
        var naMesa = {}, pular = 0;
        mesa.forEach(function (o) {
          if (o.iid) naMesa[o.iid] = true;
          else if (o.itemId === pi.itemId && (o.level || 0) === pi.level && (o.stars || 0) === pi.stars) pular++;
        });
        var peca = null;
        for (var k = 0; k < (pi.indices || []).length && !peca; k++) {
          var e = inv[pi.indices[k]];
          if (!e) continue;
          if (e.iid) { if (!naMesa[e.iid]) peca = e; }
          else if (pular > 0) pular--;
          else peca = e;
        }
        if (!peca) { toast(tr('Todas as cópias dessa peça já estão na mesa.')); return; }
        JOGO.Troca.porItem({ itemId: peca.itemId, level: peca.level || 0, stars: peca.stars || 0, iid: peca.iid || null });
      });
      linhaS.appendChild(chip);
    });
    caixa.appendChild(linhaS);

    // ---- os bichos soltos, para por na mesa (12/09)
    caixa.appendChild(el('h3', 'bk-tit', tr('Seus bichos — toque para pôr na mesa')));
    var naMesaP = {};
    (est.minha.pets || []).forEach(function (o) { naMesaP[o.petId] = true; });
    var todosSoltos = ownedPets().filter(function (pid) { return !!petDef(pid); });
    var soltos = todosSoltos.filter(function (pid) { return !naMesaP[pid]; });
    var linhaP = el('div', 'tr-itens');
    if (!soltos.length) {
      linhaP.appendChild(el('p', 'inv-dica', todosSoltos.length
        ? tr('Todos os bichos soltos já estão na mesa.') : tr('Nenhum bicho solto.')));
    }
    soltos.forEach(function (pid) {
      var pd = petDef(pid) || {};
      var chip = el('button', 'tr-item tr-pet');
      chip.type = 'button';
      chip.appendChild(art('petIcon', [pid, 30], 30));
      chip.appendChild(el('span', null, esc(pd.name || pid) + ' · ' + petNivelTxt(pid)));
      tap(chip, function () {
        if (!JOGO.Troca.porPet(pid)) toast(tr('Esse bicho não pode ir à mesa agora (no máximo 6 por troca).'));
      });
      linhaP.appendChild(chip);
    });
    caixa.appendChild(linhaP);
    var vestidos = safe(function () {
      var hs = P().state.heroes, n = 0;
      for (var hk in hs) if (hs.hasOwnProperty(hk) && hs[hk] && hs[hk].pet) n++;
      return n;
    }, 0);
    if (vestidos) {
      caixa.appendChild(el('p', 'inv-dica',
        tr('Bicho vestido num herói não vai à mesa: solte-o na ficha do herói primeiro. O bicho vai com o nível e as estrelas; quem já tem aquele bicho não recebe outro.')));
    }

    // ---- travar · confirmar · cancelar
    var acoes = el('div', 'bk2-botoes');
    if (!est.minha.travada) {
      acoes.appendChild(btn(tr('Travar minha oferta'), 'btn-primary', function () {
        JOGO.Troca.travar();
      }));
    } else if (est.minha.travada && est.dele.travada && !est.minha.confirmada) {
      acoes.appendChild(btn(tr('CONFIRMAR a troca'), 'btn-gold', function () {
        JOGO.Troca.confirmar();
      }));
    } else if (est.minha.confirmada) {
      acoes.appendChild(el('span', 'ms-pago', tr('esperando o outro confirmar…')));
    } else {
      acoes.appendChild(el('span', 'inv-dica', tr('travado — esperando o outro travar')));
    }
    acoes.appendChild(btn(tr('Cancelar'), 'btn-ghost', function () {
      JOGO.Troca.cancelar(); closeSheet();
    }));
    caixa.appendChild(acoes);
  }

  /* O PLACAR — os níveis de todo mundo que já cruzou a sua praça, você
   * incluído. A aba Arena espera a Brasa (os duelos): promessa dita, não
   * escondida. */
  /* ==========================================================  PERSONAGEM
   * A FICHA DA CONTA (11/09, pedido do dono: "no menu inferior deve ter uma
   * opção de char — ali o usuário vê sua conta, o que seu equipamento dá de
   * vantagens, total de vida, PA, PP etc., e o ranking PvP, e se ele quer
   * esconder a coroa ou mostrar").
   *
   * O que ela responde, nesta ordem: QUEM eu sou (nome, título, medalha),
   * COMO eu estou na arena (coroa, pontos e o interruptor do troféu) e DE
   * ONDE vêm os meus números — corpo nu, equipamento, conjuntos, pet e
   * estrelas, cada fonte com o que ela soma. A ficha do herói (sheetHero)
   * mostra UM herói por dentro; esta mostra a CONTA e o extrato.
   *
   * Um herói por vez, escolhido nos chips da seção — no celular, oito
   * colunas de números lado a lado não se leem. */
  var charHeroi = null;              // qual herói a ficha está mostrando
  var CHAR_STATS = [
    { k: 'hp', rot: tr('PV'), cls: 's-hp' },
    { k: 'pa', rot: tr('PA'), cls: 's-pa' },
    { k: 'pp', rot: tr('PP'), cls: 's-pp' },
    { k: 'power', rot: 'poder' },
    { k: 'elemPower', rot: 'poder elem.', cls: 's-el' },
    { k: 'initiative', rot: 'iniciativa' },
    { k: 'dodge', rot: 'esquiva' },
    { k: 'lock', rot: tr('fixação') }
  ];
  var CHAR_FONTES = [
    { id: 'itens', rot: tr('Equipamento'), dica: tr('as peças que você está vestindo') },
    { id: 'conjuntos', rot: tr('Conjuntos'), dica: tr('peças da mesma série vestidas juntas') },
    { id: 'pet', rot: tr('Pet'), dica: tr('o bicho vestido, com o nível e as estrelas dele') },
    { id: 'estrelas', rot: tr('Estrelas da classe'),
      dica: tr('as cartas de chefe que passaram do custo de liberar a classe') }
  ];
  /* Uma fileira de números; devolve false quando não havia nada a mostrar
   * (é assim que a ficha sabe escrever "nada ainda" no lugar). */
  function charLinhaStats(caixa, obj, cls) {
    var g = el('div', 'char-stats' + (cls ? ' ' + cls : ''));
    var algum = false;
    CHAR_STATS.forEach(function (d) {
      var v = obj ? obj[d.k] : 0;
      if (!v) return;
      algum = true;
      g.appendChild(el('span', d.cls || null,
        (v > 0 && cls === 'is-ganho' ? '+' : '') + v + ' ' + d.rot));
    });
    // as RESISTÊNCIAS entram na mesma fileira: item e pet dão (e tiram) delas,
    // e uma resistência negativa escondida é a que mata sem explicar por quê
    var res = obj && obj.resists;
    if (res) {
      Object.keys(res).forEach(function (e2) {
        if (!res[e2]) return;
        algum = true;
        g.appendChild(el('span', 'is-res',
          (res[e2] > 0 ? '+' : '') + res[e2] + '% ' + esc(ELEM_PT[e2] || e2)));
      });
    }
    if (!algum) return false;
    caixa.appendChild(g);
    return true;
  }

  /* o TÍTULO da plaquinha (11/09, 12/09, 13/09) — desde 08/10 mora na ficha Customizar */
  function secaoTitulo(caixa, j, estT, tituloVivo) {
    function refazCustomizar() { if (sheetName === 'customizar') sheetCustomizar(); else sheetChar(); }
      caixa.appendChild(el('h3', 'bk-tit', tr('Título na plaquinha')));
      var Tt = JOGO.Titulos;
      if (!Tt) {
        caixa.appendChild(el('p', 'inv-dica', tr('Os títulos não carregaram.')));
      } else {
        var catal = Tt.catalogo(estT);
        var ganhos = catal.filter(function (t) { return t.ganho; });
        // 03/10: e o pódio do Eco Primordial — sem o grupo 'eco' no menu o título ganho não tinha onde ser escolhido
        var porFonte = { pvm: tr('Ranking de XP (PvM)'), pvp: tr('Ranking PvP'), classe: tr('Ranking por classe'),
                         arena: tr('Torneio da Arena'),
                         eco: tr('O Eco Primordial (pódio da semana)'), chefe: tr('Chefes, no difícil e sozinho') };
        /* 10/10 — os títulos do TORNEIO DA ARENA (docs/TORNEIO.md): a escada das conquistas (Campeão, Bicampeão,
         * Tricampeão, Lenda, Imortal) e o Campeão das Guildas, permanentes. A régua é a do js/core/titulos.js
         * (fonte 'arena', lida com estado.arena = {pvp, guilda}); se o catálogo desta página ainda não os traz
         * (o titulos.js de antes), a ficha mostra a escada mesmo assim, só para ler — escolher, só o que a régua dá. */
        if (!catal.some(function (t) { return t.fonte === 'arena'; })) {
          var arE = (estT && estT.arena) || { pvp: 0, guilda: 0 };
          var escada = (Tt.ARENA && Tt.ARENA.length) ? Tt.ARENA
            : [{ n: 1, titulo: 'Campeão da Arena' }, { n: 2, titulo: 'Bicampeão da Arena' }, { n: 3, titulo: 'Tricampeão da Arena' },
               { n: 5, titulo: 'Lenda da Arena' }, { n: 10, titulo: 'Imortal da Arena' }];
          escada.forEach(function (d) {
            var alvoA = Math.max(1, Math.floor(Number(d.n != null ? d.n : d.conquistas) || 1));
            catal.push({ titulo: d.titulo, fonte: 'arena', de: tr('Torneio da Arena'), ganho: false, emprestado: false, soLeitura: true,
                         prog: Math.min(arE.pvp || 0, alvoA), alvo: alvoA,
                         comoGanhar: tr('Vença {n} torneio(s) de PvP da Arena com chave de 4 ou mais.', { n: alvoA }) });
          });
          catal.push({ titulo: Tt.ARENA_GUILDA || 'Campeão das Guildas', fonte: 'arena', de: tr('Torneio das Guildas'), ganho: false, emprestado: false,
                       soLeitura: true, prog: Math.min(arE.guilda || 0, 1), alvo: 1,
                       comoGanhar: tr('Seja o representante da guilda campeã do torneio de guilda.') });
        }
        /* 13/09, dono: "esse menu branco está ruim". O <select> nativo abria a
         * lista BRANCA do sistema; agora é um menu nosso, escuro, que abre
         * embaixo do botão (dentro da ficha, sem ser cortado pela rolagem). */
        var escolhidoT = tituloVivo || '';
        var dropT = el('div', 'tit-drop');
        var botaoT = document.createElement('button');
        botaoT.type = 'button';
        botaoT.className = 'tit-botao';
        botaoT.setAttribute('aria-expanded', 'false');
        botaoT.innerHTML = '<span class="tit-atual' + (escolhidoT ? '' : ' is-vazio') + '">' +
          esc(escolhidoT || tr('— sem título —')) + '</span><span class="tit-seta">▾</span>';
        var listaT = el('div', 'tit-lista');
        listaT.hidden = true;
        function abreListaT(abre) {
          listaT.hidden = !abre;
          botaoT.setAttribute('aria-expanded', abre ? 'true' : 'false');
        }
        function escolheT(valor) {
          abreListaT(false);
          if (valor === escolhidoT) return;
          JOGO.DB.definirTitulo(valor || null).then(function (res) {
            var tt = (res && res.titulo) || '';
            if (JOGO.Hub && JOGO.Hub.nomeia) JOGO.Hub.nomeia(undefined, titExibe(tt));
            reanunciaPerfil();        // o título aparece para todos, não só aqui
            toast(tt ? tr('Agora você é {a}, {tt}.', { a: j.nome || tr('você'), tt: titExibe(tt) }) : tr('Sem título — só o nome.'), 'good');
            refazCustomizar();
          });
        }
        function itemT(valor, rotulo, dica, livre) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'tit-item' + (valor === escolhidoT ? ' is-on' : '');
          b.disabled = !livre;
          b.innerHTML = '<span class="tit-item-nm">' + esc(rotulo) + '</span>' +
            (dica ? '<span class="tit-item-dica">' + esc(dica) + '</span>' : '');
          if (livre) b.addEventListener('click', function () { escolheT(valor); });
          return b;
        }
        listaT.appendChild(itemT('', tr('— sem título —'), '', true));
        // 08/10 à noite (o dono: "o Mestre pode escolher o título que ele quiser"): na conta do Mestre, um campo livre
        if (mestreAtivo()) {
          var livreT = el('div', 'tit-livre');
          var campoT = document.createElement('input');
          campoT.className = 'hub-input';
          campoT.maxLength = 23;
          campoT.placeholder = tr('título à sua escolha (até 23 letras)');
          campoT.value = (escolhidoT && !catal.some(function (t) { return t.titulo === escolhidoT; })) ? escolhidoT : '';
          campoT.addEventListener('keydown', function (ev) { ev.stopPropagation(); if (ev.key === 'Enter') bUsar.click(); });
          var bUsar = btn(tr('Usar'), 'btn-mini btn-gold', function () {
            var v = String(campoT.value || '').trim().slice(0, 23);
            if (!v) { toast(tr('Escreva o título.')); return; }
            escolheT(v);
          });
          livreT.appendChild(campoT);
          livreT.appendChild(bUsar);
          listaT.appendChild(el('div', 'tit-grupo', tr('O Mestre escolhe')));
          listaT.appendChild(livreT);
        }
        ['pvm', 'pvp', 'classe', 'arena', 'eco', 'chefe'].forEach(function (f) {
          var gT = el('div', 'tit-grupo', esc(porFonte[f]));
          gT.setAttribute('data-fonte', f);
          listaT.appendChild(gT);
          // os pódios de classe são 21 (três por classe): no menu entram só os que já são seus
          var doGrupo = catal.filter(function (t) { return t.fonte === f && (f !== 'classe' || t.ganho); });
          if (!doGrupo.length) listaT.appendChild(itemT(null, tr('nenhum pódio de classe ainda'), '', false));
          doGrupo.forEach(function (t) {
            listaT.appendChild(itemT(t.titulo, titExibe(t.titulo),
              t.ganho ? '' : (t.alvo ? (f === 'arena' ? tr('{a}/{b} conquista(s)', { a: t.prog || 0, b: t.alvo }) : t.prog + '/' + t.alvo + ' quedas')
                                     : tr('ainda não é seu')), t.ganho));
          });
        });
        botaoT.addEventListener('click', function () { abreListaT(listaT.hidden); });
        dropT.addEventListener('keydown', function (ev) {
          ev.stopPropagation();                               // a letra não abre atalho
          if (ev.key === 'Escape' && !listaT.hidden) { ev.preventDefault(); abreListaT(false); botaoT.focus(); }
        });
        dropT.appendChild(botaoT);
        dropT.appendChild(listaT);
        caixa.appendChild(dropT);
        if (!ganhos.length) {
          caixa.appendChild(el('p', 'inv-dica',
            tr('Nenhum título ainda. Eles não vêm de missão: são pódio de ranking ou teimosia contra um chefe.')));
        }

        // como ganhar cada um — recolhido, para a aba não virar uma lista comprida
        var comoT = document.createElement('details');
        comoT.className = 'tit-como';
        comoT.appendChild(el('summary', null, tr('Como ganhar cada título')));
        ['pvm', 'pvp', 'classe', 'arena', 'eco', 'chefe'].forEach(function (f) {
          comoT.appendChild(el('div', 'char-fonte',
            '<span class="char-fonte-nm">' + esc(porFonte[f]) + '</span>'));
          if (f === 'arena') {
            comoT.appendChild(el('p', 'inv-dica', tr('Cada torneio de PvP vencido com chave de 4 ou mais soma uma conquista, para sempre. Os títulos mais baixos seguem seus; a moldura Campeão da Arena vem com a primeira vitória em chave de 8 ou 16.')));
          }
          if (f === 'classe') {
            comoT.appendChild(el('p', 'inv-dica', tr('Seja o 1º, 2º ou 3º de uma classe no ranking do site (a XP daquela classe): "Top 1 Xamã", "Top 2 Bárbaro"… Vale para cada classe e não acende o nome — o nome brilhante é só do ranking geral de XP, que soma a conta inteira.')));
          }
          catal.filter(function (t) { return t.fonte === f && (f !== 'classe' || t.ganho); }).forEach(function (t) {
            var linha = el('div', 'tit-linha' + (t.ganho ? ' is-ganho' : ''));
            linha.appendChild(el('span', 'tit-nm', esc(titExibe(t.titulo))));
            if (t.ganho) {
              linha.appendChild(el('span', 'tit-ok', t.emprestado ? tr('seu enquanto durar') : tr('seu para sempre')));
            } else if (t.alvo && f === 'arena') {
              linha.appendChild(el('span', 'tit-falta',
                tr('<b>{prog}</b>/{alvo} conquista(s)', { prog: t.prog || 0, alvo: t.alvo })));
            } else if (t.alvo) {
              linha.appendChild(el('span', 'tit-falta',
                tr('{a} · <b>{prog}</b>/{alvo} quedas', { a: esc(t.de), prog: t.prog, alvo: t.alvo })));
            } else {
              linha.appendChild(el('span', 'tit-falta', esc(t.comoGanhar)));
            }
            comoT.appendChild(linha);
          });
        });
        caixa.appendChild(comoT);
      }
  }
  /* A FICHA CUSTOMIZAR (08/10): o título, a aura e a moldura da plaquinha, num lugar só */
  function sheetCustomizar() {
    sheetName = 'customizar';
    var body = sheetShell(tr('Customizar'), tr('O que todo mundo vê na praça: o título, a aura e a moldura da sua plaquinha.'));
    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);
    if (!JOGO.DB) { caixa.appendChild(el('p', 'inv-dica', tr('A conta local não carregou.'))); return; }
    Promise.all([JOGO.DB.jogador(), estadoDosTitulos()]).then(function (r) {
      var j = r[0], estT = r[1];
      clear(caixa);
      var tituloVivo = tituloPendurado(j.titulo);
      secaoTitulo(caixa, j, estT, tituloVivo);
      secaoAura(caixa);
      secaoMoldura(caixa, tituloVivo);
      caixa.appendChild(btn(tr('Voltar ao Personagem'), 'btn-ghost btn-block', function () { openSheet('char'); }));
    });
  }
  function sheetChar() {
    sheetName = 'char';
    var body = sheetShell(tr('Personagem'),
      tr('A sua conta: o que você é, o que o equipamento está te dando e a sua coroa na arena.'));
    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);
    if (!JOGO.DB) { caixa.appendChild(el('p', 'inv-dica', tr('A conta local não carregou.'))); return; }

    Promise.all([JOGO.DB.jogador(),
                 JOGO.DB.brasaVer ? JOGO.DB.brasaVer() : Promise.resolve(null),
                 JOGO.DB.placarLista ? JOGO.DB.placarLista() : Promise.resolve([]),
                 estadoDosTitulos()])
    .then(function (r) {
      var j = r[0], bz = r[1], fotos = r[2] || [], estT = r[3];
      clear(caixa);

      // ---- QUEM SOU EU
      var souMestre3 = safe(function () { return !!(JOGO.GM && JOGO.GM.ativo()); }, false);
      var brilho = souMestre3 ? 'admin' : medalhaDaPosicao(estT && estT.pvm);
      var topo = el('div', 'char-topo');
      var corpoAv = charHeroi || selHeroes[0] || heroIds().filter(isUnlocked)[0] || 'sumo';
      topo.appendChild(art('unit', [corpoAv, { element: 'neutro', dir: 0, scale: 0.7 }], 96));
      var colT = el('div', 'char-col');
      colT.appendChild(el('div', 'char-nome' + (brilho ? ' pl-brilho is-' + brilho : ''),
        esc(j.nome || tr('Sem Nome'))));
      var tituloVivo = tituloPendurado(j.titulo);
      if (tituloVivo) colT.appendChild(el('div', 'char-titulo', esc(titExibe(tituloVivo))));
      if (souMestre3) colT.appendChild(el('span', 'chip chip-ok', tr('Mestre do Fundo')));
      else if (brilho) {
        colT.appendChild(el('span', 'char-medalha is-' + brilho,
          tr('Top {pvm} do ranking de XP', { pvm: estT.pvm })));
      }
      if (resumoGuilda && resumoGuilda.nome) {
        var lg = el('div', 'char-guilda');
        if (BR() && BR().ehCodigo(resumoGuilda.emblema)) lg.appendChild(elShield(resumoGuilda.emblema, 28));
        lg.appendChild(el('span', null, esc(txtGuilda(resumoGuilda.emblema, resumoGuilda.nome))));
        colT.appendChild(lg);
      }
      var somaN = safe(function () { return resumoDaConta().total; }, 0);
      colT.appendChild(el('div', 'char-sub', tr('nível somado da conta: <b>{somaN}</b>', { somaN: somaN })));
      topo.appendChild(colT);
      caixa.appendChild(topo);

      // ---- A ARENA e o interruptor da coroa
      caixa.appendChild(el('h3', 'bk-tit', tr('Arena')));
      var pts = bz ? bz.pts : 1000, partidas = (bz && bz.partidas) || 0;
      // 04/10: a ficha mostra a coroa da conta em TODO nível — sem partida, é a Coroa I (a mesma
      // que o "Mostrar a coroa acima da cabeça" pendura na praça). Antes dizia "sem coroa".
      var tierC = JOGO.Brasa ? JOGO.Brasa.coroaDe(pts, partidas, souTopoDaArena(), false, coroaDoMestre()) : null;
      var cx = el('div', 'char-arena');
      if (tierC && tierC.mestre) {
        // 08/10 à noite: a coroa do Mestre não tem bilhete PNG (é só 3D, na praça) — a ficha
        // mostra a marca em vermelho, a cor do brilho dela
        cx.appendChild(el('div', 'char-coroa char-coroa-mestre', '♛'));
      } else if (tierC && JOGO.COROAS_PVP && JOGO.COROAS_PVP[tierC.id]) {
        var imgC = document.createElement('img');
        imgC.src = 'data:image/png;base64,' + JOGO.COROAS_PVP[tierC.id];
        imgC.alt = tierC.nome;
        imgC.className = 'char-coroa';
        // do 5º degrau para cima a coroa ACENDE — aqui como halo de CSS, na
        // mesma cor e na mesma força do halo que a praça pendura
        if (tierC.brilho > 0) {
          imgC.style.filter = 'drop-shadow(0 0 ' + Math.round(4 + 16 * tierC.brilho) + 'px ' +
            (tierC.cor || '#ffd36a') + ')';
        }
        cx.appendChild(imgC);
      }
      var colA = el('div', 'char-col');
      colA.appendChild(el('div', 'char-coroa-nm',
        tierC ? esc(tierC.nome) + ((partidas > 0 || tierC.mestre) ? '' : tr(' — a arena ainda não te viu lutar')) : tr('Arena')));
      colA.appendChild(el('div', 'char-sub', (partidas === 1
        ? tr('<b>{pts}</b> pontos · {partidas} partida{a}', { pts: pts, partidas: partidas, a: JOGO.Brasa ? ' ' + tr('· temporada <b>{a}</b>', { a: JOGO.Brasa.temporadaDe(Date.now()) }) : '' })
        : tr('<b>{pts}</b> pontos · {partidas} partidas{a}', { pts: pts, partidas: partidas, a: JOGO.Brasa ? ' ' + tr('· temporada <b>{a}</b>', { a: JOGO.Brasa.temporadaDe(Date.now()) }) : '' }))));
      if (tierC && tierC.mestre) {
        colA.appendChild(el('div', 'char-sub',
          tr('a coroa do Mestre é fixa — só a sua conta a carrega, com o brilho vermelho')));
      } else if (tierC && tierC.brilho > 0) {
        colA.appendChild(el('div', 'char-sub',
          tr('a coroa brilha — e o brilho cresce at\u00e9 a <b>Coroa X</b>')));
      } else if (tierC) {
        colA.appendChild(el('div', 'char-sub',
          tr('da <b>Coroa V</b> em diante ela come\u00e7a a brilhar')));
      }
      cx.appendChild(colA);
      caixa.appendChild(cx);

      var oculta = j.coroaOculta === true;
      if (campoDentro()) {
        // 14/09 (o dono): no Campo de PvP a coroa fica ligada "e lá não poderá desligar"
        var bTrava = btn(tr('A coroa fica ligada no Campo de PvP'), 'btn-mini btn-block btn-ghost is-apagado coroa-trava', function () {
          toast(tr('No Campo de PvP a coroa não desliga — saia do Campo para escondê-la.'));
        });
        bTrava.title = tr('saia do Campo de PvP para esconder a coroa');
        caixa.appendChild(bTrava);
      } else caixa.appendChild(btn(oculta ? tr('Mostrar a coroa acima da cabeça')
                                   : tr('Esconder a coroa acima da cabeça'),
        'btn-mini btn-block ' + (oculta ? 'btn-gold' : 'btn-ghost'), function () {
          JOGO.DB.definirCoroaOculta(!oculta).then(function () {
            toast(!oculta ? tr('A coroa saiu da sua cabeça — os pontos ficam.')
                          : tr('A coroa voltou para cima da sua cabeça.'), 'good');
            resumoCoroaOculta = !oculta;      // o fantasma dos outros obedece o resumo
            reanunciaPerfil();
            if (JOGO.UI && JOGO.UI.repaint) JOGO.UI.repaint();
            sheetChar();
          });
        }));
      caixa.appendChild(el('p', 'inv-dica', oculta
        ? tr('Escondida: nem você nem os outros veem o troféu na praça. Os pontos continuam no placar.')
        : tr('Aparecendo para todo mundo na praça. Os pontos do placar não mudam com isto.')));

      /* ---- O TÍTULO DA PLAQUINHA (11/09, dono: "o título é editado na aba
       * do personagem"). 12/09: um MENU SUSPENSO dividido por fonte — ranking
       * de XP (Top 1, 2 e 3 PVM), ranking PvP (Top 1, 2 e 3 Pvp) e os chefes
       * (dez quedas no difícil e sozinho). O que ainda não é seu aparece
       * apagado no próprio menu; o "como ganhar" fica recolhido embaixo. Os de
       * ranking são emprestados: some o título no dia em que a posição some,
       * sem apagar a escolha. */
      /* 08/10 (o dono: "um painel dentro da aba do personagem onde o usuário clica para customizar; lá ele
       * escolhe título, aura e moldura para o nome"): a ficha mostra o que está na placa e um botão que abre
       * a ficha Customizar (sheetCustomizar) — o título, a aura e a moldura moram lá. */
      caixa.appendChild(el('h3', 'bk-tit', tr('A sua plaquinha')));
      var resumoV = el('p', 'inv-dica char-plaquinha');
      var molV = molduraDaLoja();
      var molAuto = safe(function () { return JOGO.Hub && JOGO.Hub.molduraDoTitulo ? JOGO.Hub.molduraDoTitulo(tituloVivo) : null; }, null);
      resumoV.innerHTML = tr('Título: <b>{a}</b> · Aura: <b>{b}</b> · Moldura: <b>{c}</b>', {
        a: tituloVivo ? esc(titExibe(tituloVivo)) : tr('nenhum'),
        b: auraDaLoja() ? esc(AURA_PT[auraDaLoja()] || auraDaLoja()) : tr('nenhuma'),
        c: molV ? esc(molV === 'arena' ? MOLDURA_CAMPEAO : (MOLDURA_PT[molV] || molV)) : (molAuto ? esc(MOLDURA_PT[molAuto] || molAuto) + ' ' + tr('(do título)') : tr('a de sempre')) });
      caixa.appendChild(resumoV);
      caixa.appendChild(btn(tr('Customizar: título, aura e moldura'), 'btn-primary btn-block char-customizar', function () { openSheet('customizar'); }));

      /* ---- OS NÚMEROS, herói por herói. Só os que DESCERAM (11/09, pedido
       * do dono: "ao abrir a aba personagem deve trazer somente dos
       * personagens selecionados") — a ficha é do grupo que está em jogo,
       * não do acervo. Fora de uma descida (no menu), mostra os liberados,
       * senão a aba abriria vazia. */
      var libs = selHeroes.length ? selHeroes.slice() : heroIds().filter(isUnlocked);
      if (!libs.length) {
        caixa.appendChild(el('p', 'inv-dica', tr('Nenhuma classe liberada ainda.')));
        return;
      }
      if (libs.indexOf(charHeroi) < 0) charHeroi = libs[0];
      caixa.appendChild(el('h3', 'bk-tit', tr('Características')));
      // 02/10: a escolha do herói é uma fileira de ABAS (a pílula dourada é a
      // aberta, aria-pressed para o leitor de tela) — era um par de botões
      // soltos de 18 px, com o tamanho de letra dos emblemas da guilda
      var chips = el('div', 'abas-fila char-abas');
      libs.forEach(function (hid) {
        var on = hid === charHeroi;
        var bA = btn(className(hero(hid).classId || hid), 'btn-tab' + (on ? ' is-on' : ''), function () {
          charHeroi = hid;
          sheetChar();
        });
        bA.setAttribute('aria-pressed', on ? 'true' : 'false');
        chips.appendChild(bA);
      });
      caixa.appendChild(chips);

      var h = hero(charHeroi);
      var ext = safe(function () { return P().statsBreakdown(charHeroi); }, null);
      var tot = (ext && ext.total) || effStats(charHeroi) || {};
      var cab = el('div', 'char-heroi');
      cab.appendChild(el('span', 'char-heroi-nm', esc(className(h.classId || charHeroi))));
      cab.appendChild(el('span', 'char-sub', tr('nível <b>{a}</b> · {b}', { a: h.level || 1, b: esc(ELEM_PT[h.element] || tr('Neutro')) })));
      caixa.appendChild(cab);
      charLinhaStats(caixa, tot, 'is-total');

      if (ext) {
        caixa.appendChild(el('p', 'inv-dica', tr('De onde vem cada número:')));
        var nu = el('div', 'char-fonte');
        nu.appendChild(el('span', 'char-fonte-nm', tr('Corpo no nível {a}', { a: h.level || 1 })));
        caixa.appendChild(nu);
        charLinhaStats(caixa, ext.base, 'is-base');
        CHAR_FONTES.forEach(function (f) {
          var d = ext.fontes[f.id];
          var cab2 = el('div', 'char-fonte');
          cab2.appendChild(el('span', 'char-fonte-nm', f.rot));
          cab2.appendChild(el('span', 'char-sub', esc(f.dica)));
          caixa.appendChild(cab2);
          if (!d || !charLinhaStats(caixa, d, 'is-ganho')) {
            caixa.appendChild(el('div', 'char-stats is-zero', tr('nada ainda')));
          }
        });
      }
    });
  }

  function sheetPlacar() {
    sheetName = 'placar';
    var body = sheetShell(tr('Placar do Acampamento'),
      tr('Todo jogador que já cruzou a sua praça deixa a foto da conta aqui.'));
    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);
    if (!JOGO.DB) { caixa.appendChild(el('p', 'inv-dica', tr('A conta local não carregou.'))); return; }

    Promise.all([JOGO.DB.jogador(), JOGO.DB.placarLista(),
                 JOGO.DB.brasaVer ? JOGO.DB.brasaVer() : Promise.resolve(null),
                 JOGO.DB.pocoVer ? JOGO.DB.pocoVer() : Promise.resolve(null)])
    .then(function (r) {
      var eu2 = r[0], lista = r[1] || [], bz = r[2], pv = r[3];
      clear(caixa);

      // A TEMPORADA (25/08): qual é, quando vira, e a GALERIA das já vividas
      if (JOGO.Brasa && JOGO.Brasa.temporadaDe) {
        var linhaT = tr('Temporada <b>{a}</b> da arena · vira em <b>{b}</b> dia(s)', { a: JOGO.Brasa.temporadaDe(Date.now()), b: JOGO.Brasa.viraEmDias(Date.now()) });
        var gal = (bz && bz.galeria) || {};
        var tGal = Object.keys(gal).sort(function (a, b2) { return a - b2; });
        if (tGal.length) {
          linhaT += ' ' +
            tr('· galeria: {a}', { a: tGal.map(function (t2) {
            var nomeC = tr('Coroa {a}', { a: gal[t2] });
            (JOGO.Brasa.TIERS || []).forEach(function (tie) {
              if (tie.nivel === gal[t2]) nomeC = tie.nome;
            });
            return '<b>' + nomeC + '</b> (T' + t2 + ')';
          }).join(' · ') });
        }
        if (pv && (pv.recorde > 0 || pv.semanaMelhor > 0)) {
          linhaT += '<br>' +
            tr('Poço sem Fundo: andar <b>{semanaMelhor}</b> nesta semana · recorde da conta <b>{recorde}</b>', { semanaMelhor: pv.semanaMelhor, recorde: pv.recorde });
        }
        caixa.appendChild(el('p', 'placar-temporada', linhaT));
      }

      var linhas = [{ id: eu2.id, nome: (eu2.nome || tr('Você')), titulo: eu2.titulo || '',
                      resumo: safe(resumoDaConta, { classes: {}, total: 0 }), sou: true }];
      lista.forEach(function (e2) {
        if (e2.id === eu2.id) return;              // a minha linha é a viva, não a foto
        linhas.push(e2);
      });
      linhas.sort(function (a, b) {
        return ((b.resumo && b.resumo.total) || 0) - ((a.resumo && a.resumo.total) || 0);
      });

      /* O PÓDIO POR CLASSE acende o nome aqui também — na ficha e na praça
       * a mesma conta, a mesma cor. O branco do Mestre do Fundo só aparece
       * na MINHA linha: a foto do placar não guarda quem é da equipe, e
       * quem confere isso é o relé (a praça mostra o dos outros). */
      var medalhas = mapaDeMedalhas(contasDoPlacar(lista, eu2.id, eu2.nome));
      var souMestre2 = safe(function () { return !!(JOGO.GM && JOGO.GM.ativo()); }, false);
      function classeDoNome(nome, sou) {
        if (sou && souMestre2) return ' pl-brilho is-admin';
        var m = medalhas[chaveNome(nome)];
        return m ? ' pl-brilho is-' + m : '';
      }

      caixa.appendChild(el('h3', 'bk-tit', (linhas.length === 1
        ? tr('Níveis ({length} conta)', { length: linhas.length })
        : tr('Níveis ({length} contas)', { length: linhas.length }))));
      linhas.forEach(function (e2, i) {
        var row = el('div', 'pl-linha' + (e2.sou ? ' is-eu' : ''));
        row.appendChild(el('span', 'pl-pos', '#' + (i + 1)));
        var tx = el('div', 'ms-tx');
        tx.appendChild(el('div', 'ms-nome',
          '<span class="' + ('pl-nm' + classeDoNome(e2.nome, e2.sou)).trim() + '">' +
          esc(e2.nome) + '</span>' +
          (e2.titulo ? ' <span class="ms-titulo">' + esc(titExibe(e2.titulo)) + '</span>' : '') +
          (e2.sou ? tr(' <span class="pl-eu">você</span>') : '')));
        var det = [];
        var cls = (e2.resumo && e2.resumo.classes) || {};
        Object.keys(cls).forEach(function (cid) {
          det.push(esc(className(cid)) + ' ' + cls[cid]);
        });
        tx.appendChild(el('div', 'ms-prog', det.length ? det.join(' · ') : tr('conta recém-nascida')));
        row.appendChild(tx);
        row.appendChild(el('span', 'pl-total', String((e2.resumo && e2.resumo.total) || 0)));
        caixa.appendChild(row);
      });

      /* O RANKING POR CLASSE: três degraus por classe, o nome de cada um já
       * na cor da medalha. É a tabela que explica de onde vem o brilho que
       * se vê na praça — sem ela, o jogador só veria nomes acesos. */
      var contasP = contasDoPlacar(lista, eu2.id, eu2.nome || tr('Você'));
      var porClasse = {};
      contasP.forEach(function (c) {
        var cls = (c.resumo && c.resumo.classes) || {};
        Object.keys(cls).forEach(function (cid) { if (cls[cid] > 0) porClasse[cid] = true; });
      });
      var cids = Object.keys(porClasse).sort(function (a3, b3) {
        return className(a3).localeCompare(className(b3));
      });
      if (cids.length) {
        caixa.appendChild(el('h3', 'bk-tit', tr('Pódio por classe')));
        caixa.appendChild(el('p', 'inv-dica',
          tr('Os três primeiros de cada classe entre as contas que já cruzaram a sua praça. O nome aceso vem do ranking de XP do site: ouro, prata e bronze para o top 1, 2 e 3.')));
        cids.forEach(function (cid) {
          var fila = filaDaClasse(contasP, cid).slice(0, 3);
          var linha = el('div', 'pl-classe');
          linha.appendChild(el('span', 'pl-classe-nm', esc(className(cid))));
          var pod = el('span', 'pl-podio');
          fila.forEach(function (q, qi) {
            pod.appendChild(el('span', 'pl-nm',
              (qi + 1) + 'º ' + esc(q.nome || '?') + ' <i>' + q.nv + '</i>'));
          });
          linha.appendChild(pod);
          caixa.appendChild(linha);
        });
      }

      caixa.appendChild(el('h3', 'bk-tit', tr('Arena — a Brasa')));
      JOGO.DB.brasaVer().then(function (bz) {
        var arena = [{ id: eu2.id, nome: (eu2.nome || tr('Você')), sou: true,
                       pts: bz ? bz.pts : 1000, partidas: (bz && bz.partidas) || 0 }];
        lista.forEach(function (e2) {
          if (e2.id === eu2.id) return;
          if (e2.resumo && typeof e2.resumo.brasa === 'number') {
            arena.push({ id: e2.id, nome: e2.nome, pts: e2.resumo.brasa,
                         partidas: e2.resumo.partidas || 0 });
          }
        });
        arena.sort(function (a, b) { return b.pts - a.pts; });
        anotaTopoArena(arena.map(function (a) {
          return { id: a.id, resumo: { brasa: a.pts } };
        }), eu2.id);
        arena.forEach(function (a, i) {
          /* 04/10 (o dono: "em todos os níveis deve aparecer"): a Coroa I é de todo mundo,
           * inclusive de quem ainda não tem partida — a mesma régua da plaquinha da praça, do
           * perfil e da ficha (JOGO.Brasa.coroaDe). A regra de 11/09, que deixava o novato sem
           * degrau, fazia o "Mostrar a coroa" não mostrar nada numa conta nova. */
          var tier = JOGO.Brasa ? JOGO.Brasa.coroaDe(a.pts, a.partidas, i === 0, false) : null;
          var row = el('div', 'pl-linha' + (a.sou ? ' is-eu' : ''));
          row.appendChild(el('span', 'pl-pos', '#' + (i + 1)));
          var tx = el('div', 'ms-tx');
          tx.appendChild(el('div', 'ms-nome',
            '<span class="' + ('pl-nm' + classeDoNome(a.id, a.sou)).trim() + '">' +
            esc(a.nome) + '</span>' +
            (a.sou ? tr(' <span class="pl-eu">você</span>') : '')));
          // a coroa acende do 5º degrau para cima — o mesmo halo da praça,
          // aqui como sombra colorida atrás do nome do degrau
          var degrau = el('div', 'ms-prog',
            tier ? esc(tier.nome) : tr('ainda não pisou na arena'));
          if (tier && tier.brilho > 0) {
            degrau.className = 'ms-prog pl-coroa-acesa';
            degrau.style.color = tier.cor || '#ffd36a';
            degrau.style.textShadow = '0 0 ' + Math.round(4 + 12 * tier.brilho) + 'px ' +
              (tier.cor || '#ffd36a');
          }
          tx.appendChild(degrau);
          row.appendChild(tx);
          row.appendChild(el('span', 'pl-total', String(a.pts)));
          caixa.appendChild(row);
        });
        caixa.appendChild(el('p', 'inv-dica',
          tr('Elo de verdade: ganhar de quem vale menos paga quase nada, e a Coroa de Fogo exige os pontos E o 1º lugar — não é um número, é um reinado. A Brasa acende em duelo contra OUTRA conta; o duelo de treino mostra quanto valeria.')));
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
    var body = sheetShell(tr('Arena — duelo de treino'),
      f.fase === 'A' ? tr('Jogador A: escolha a sua dupla. O B não olha.') :
      f.fase === 'passe' ? tr('Dupla escondida. Passe o teclado.') :
      tr('Jogador B: escolha a sua dupla. A dupla do A está escondida.'));
    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);

    if (f.fase === 'passe') {
      caixa.appendChild(el('p', 'du-passe', '🤝'));
      caixa.appendChild(el('p', 'inv-dica',
        tr('A dupla do Jogador A está guardada. Agora o Jogador B escolhe a dele.')));
      caixa.appendChild(btn(tr('Sou o Jogador B — escolher'), 'btn-primary btn-block', function () {
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
        else { toast(tr('A dupla é de dois.')); return; }
        sheetDuelo();
      });
      fila.appendChild(card);
    });
    caixa.appendChild(fila);

    var pronto = f.escolha.length === 2;
    var rotuloBt = f.fase === 'A' ? tr('Esconder e passar o teclado') : tr('Começar o duelo');
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
        if (!ok) toast(tr('a arena não abriu'));
      }
    });
    caixa.appendChild(bt2);
  }

  /* O FIM DO DUELO: quem venceu, o clima, e quanto a Brasa teria pago —
   * treino não acende fogo, mas mostra a conta para dar gosto do que vem. */
  function buildDuelFim(data) {
    lastDuelFim = data;
    var s = screens.duelFim;
    clear(s);
    data = data || {};
    if (data.rede) { duelFimRede(s, data); return; }      // 11/09: o duelo contra outra pessoa
    var box = el('div', 'game-over du-fim');
    box.appendChild(el('h1', null, data.venceuA ? tr('O Lado A venceu!') : tr('O Lado B venceu!')));
    var nomes = function (ids) {
      return (ids || []).map(function (c) { return className(c); }).join(tr(' e '));
    };
    box.appendChild(el('p', 'game-sub',
      tr('Lado A: {a} · Lado B: {b} · clima: {c}', { a: esc(nomes(data.duplaA)), b: esc(nomes(data.duplaB)), c: esc(data.clima || 'calmo') })));
    if (data.seValesse != null) {
      box.appendChild(el('p', 'du-valeria',
        tr('Se valesse a Brasa, o vencedor levaria +{seValesse} pontos. O fogo de verdade acende em duelo contra outra conta.', { seValesse: data.seValesse })));
    }
    box.appendChild(vidaBloco('fim'));       // 14/09: o treino não gasta vida, mas a da conta segue à vista
    box.appendChild(btn(tr('Voltar ao Acampamento'), 'btn-primary btn-block', function () {
      navTo('hub');
    }));
    s.appendChild(box);
  }

  // ==========================================================================
  // O ECO PRIMORDIAL (02/10) — a ficha, a linha da batalha e o fim da tentativa
  // ==========================================================================
  /* A PORTA é a ficha 'eco', aberta pelo cais — a praça não ganha construção
   * nova (o dono: "não amontoe a praça"). Ela mostra a semana com a contagem
   * regressiva no relógio do SERVIDOR (GET /api/supremo), as tentativas de
   * hoje, o melhor e a posição, os 10 primeiros, as faixas de prêmio e o botão
   * que leva a dupla de "Quem desce" para a Câmara do Eco. Sem servidor (em
   * casa, file://) ela oferece o TREINO, que não conta no placar. O jogo nunca
   * calcula posição nem prêmio: só mostra o que o servidor disse. */
  var ecoResp = null, ecoPedido = null, ecoEm = 0;
  function ecoLer(forca) {
    var S = JOGO.Sessao;
    if (!S || typeof S.api !== 'function') return Promise.resolve(null);
    var emCasa = safe(function () { return location.protocol === 'file:'; }, true);
    if (emCasa && !safe(function () { return S.ativa && S.ativa(); }, false)) return Promise.resolve(null);
    if (!forca && ecoResp && Date.now() - ecoEm < 20000) return Promise.resolve(ecoResp);
    if (ecoPedido) return ecoPedido;
    var p = null;
    try { p = S.api('/api/supremo'); } catch (e) { p = null; }
    if (!p || typeof p.then !== 'function') return Promise.resolve(ecoResp);
    ecoPedido = p.then(function (r) {
      ecoPedido = null;
      if (r && r.ok === true && r.semana) { r._recebidoEm = Date.now(); ecoResp = r; ecoEm = Date.now(); }
      return ecoResp;
    }, function () { ecoPedido = null; return ecoResp; });
    return ecoPedido;
  }
  UI._ecoLer = ecoLer;                      // provas
  // o que falta até o fim da semana, pelo relógio do servidor da última resposta
  function ecoFaltaMs(r) {
    if (!r || !r.semana) return 0;
    var agoraSrv = r.agora * 1000 + (Date.now() - (r._recebidoEm || Date.now()));
    return (r.semana.fim + 1) * 1000 - agoraSrv;
  }
  function ecoNum(n) { return lojaMilhar(n); }
  /* 03/10 (revisão): a semana do prêmio pelas datas (de Brasília), não pelo número interno do servidor — um
   * contador desde 05/01/2026 (servidor/supremo.py EPOCA) que não é a semana do calendário */
  function ecoDatasDaSemana(w) {
    var epoca = Date.UTC(2026, 0, 5) / 1000, semana = 7 * 86400, fuso = -3 * 3600;
    var ini = epoca + w * semana - fuso;
    function dia(t) {
      var d = new Date((t + fuso) * 1000);
      return ('0' + d.getUTCDate()).slice(-2) + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2);
    }
    return dia(ini) + '–' + dia(ini + semana - 1);
  }
  function ecoOficial() {
    var A = JOGO.Autoridade;
    return !!safe(function () { return A && A.ligada && A.ligada(); }, false);
  }

  /* a linha da sala na batalha do Eco: o placar ao vivo, a fase e o golpe marcado */
  function pintaEcoNaSala(s) {
    var e = s.eco, eco = unitByUid(e.uid);
    var pct = (e.hpMax > 0) ? Math.round(100 * e.dano / e.hpMax) : 0;
    var chip = el('span', 'eco-chip', tr('💠 Dano no Eco: <b>{a}</b> ({pct}%)', { a: ecoNum(e.dano), pct: pct }));
    tipOn(chip, tr('O placar da tentativa'), tr('A vida que o seu grupo tirou do Eco Primordial. O servidor refaz a tentativa com os seus lances e é o número DELE que entra no ranking.{a}', { a: e.derrubou ? '<br>' + tr('<b>Derrubado:</b> +{a}% da vida máxima nos pontos.', { a: Math.round((D().eco || {}).bonusDerrubada * 100) }) : '' }),
      '#9a7ad8');
    bt.room.appendChild(chip);
    if (eco) {
      var fase = el('span', 'eco-fase', esc(ELEM_PT[eco.element] || eco.element));
      fase.style.setProperty('--ec', elemColor(eco.element));
      var vence = (D().beatenBy || {})[eco.element];
      tipOn(fase, tr('A fase do Eco: {a}', { a: ELEM_PT[eco.element] || eco.element }),
        tr('A cada 25% de vida perdida ele troca de elemento (Fogo → Água → Terra → Ar) e chama dois Ecos Menores.{a}', { a: vence ? '<br>' + tr('Agora ele é <b>fraco a {a}</b>.', { a: esc(ELEM_PT[vence] || vence) }) : '' }), elemColor(eco.element));
      bt.room.appendChild(fase);
    }
    if (e.aviso) {
      var av = el('span', 'eco-aviso', '⚠ ' + esc(e.aviso.nome));
      tipOn(av, e.aviso.nome, tr('As casas marcadas no chão explodem no começo da próxima vez do Eco. Saia delas — o pilar alto abriga da onda.'), '#ff7a5a');
      bt.room.appendChild(av);
    }
  }

  function sheetEco() {
    var body = sheetShell(tr('O Eco Primordial'),
      tr('O chefe supremo da semana. O placar é o dano que o seu grupo tira dele — conferido pelo servidor.'));
    sheetName = 'eco';
    var cfg = D().eco || {};
    var status = el('div', 'eco-status');
    body.appendChild(status);

    // a dupla de "Quem desce" e o botão
    var dupla = el('p', 'eco-dupla', '');
    body.appendChild(dupla);
    var rotulo = ecoOficial() ? tr('Enfrentar o Eco') : tr('Treinar contra o Eco (não conta no placar)');
    if (emGrupo()) rotulo = souLider() ? tr('Enfrentar o Eco com {a}', { a: esc(nomeParceiro()) }) : tr('Só quem lidera ({a}) abre a Câmara', { a: esc(nomeParceiro()) });
    var bEnt = btn(rotulo, 'btn-warn btn-block eco-entra' + (emGrupo() && !souLider() ? ' is-apagado' : ''), function () { entra(); });
    body.appendChild(bEnt);
    function entra() {
      /* EM DUPLA (07/10): a Câmara abre pela descida em grupo — quem lidera chama, os dois vão à antessala e a porta
       * abre a sala do grupo com a tentativa dos dois (grupo.py). Cada conta gasta a vez do dia; o placar é um só. */
      if (emGrupo()) {
        if (!souLider()) { toast(tr('Só quem lidera ({nome}) abre a Câmara do Eco.', { nome: nomeParceiro() })); return; }
        var rG = safe(function () { return Gp().descer(cfg.arena); }, null);
        if (!rG || !rG.ok) toast(textoMotivo(rG ? rG.motivo : 'ocupado', rG && rG.motivo === 'sumido' ? nomeParceiro() : null));
        else { toast(tr('Chamando {nome}', { nome: nomeParceiro() }) + '…'); if (sheetName === 'eco') closeSheet(); }
        return;
      }
      if (!selHeroes.length) { toast(tr('Escolha a sua dupla em "Quem desce" primeiro.')); return; }
      var r = safe(function () {
        return G().startEco(selHeroes.slice(), function (res) {
          if (res && res.ok) { if (sheetName === 'eco') closeSheet(); return; }
          bEnt.disabled = false;
          bEnt.textContent = rotulo;
          toast((res && res.erro) || tr('A Câmara do Eco não abriu.'));
          ecoLer(true).then(function (r2) { if (sheetName === 'eco' && body.isConnected) pinta(r2); });
        });
      }, false);
      if (r === 'esperando') { bEnt.disabled = true; bEnt.textContent = tr('Abrindo a Câmara…'); return; }
      if (!r) { toast(tr('Essa dupla não abre a Câmara do Eco agora.')); return; }
      if (sheetName === 'eco') closeSheet();
    }
    function pintaDupla() {
      var nomes = selHeroes.map(function (hid) {
        var h = hero(hid);
        return esc(className((h && h.classId) || hid)) + (h && h.level ? ' <small>nv ' + h.level + '</small>' : '');
      });
      dupla.innerHTML = nomes.length ? tr('Vai a dupla de <b>Quem desce</b>: {a}. Todos entram com a vida cheia (a tentativa não gasta a vida dos heróis).', { a: nomes.join(tr(' e ')) })
        : tr('Escolha a dupla em <b>Quem desce</b> para entrar.');
    }
    pintaDupla();

    var regras = el('ul', 'eco-regras');
    [tr('{a} rodadas por tentativa, ou até o grupo cair. {b} tentativas por dia (o dia de Brasília).', { a: cfg.rodadas || 12, b: cfg.tentativasPorDia || 3 }),
     tr('Ele ocupa 2×2 casas no centro da Câmara e não anda. A cada 25% da vida perdida troca de elemento (Fogo → Água → Terra → Ar), fica fraco a quem vence o elemento novo e chama dois Ecos Menores.'),
     tr('O golpe grande é AVISADO: as casas marcadas no chão explodem no começo da vez seguinte dele. Os pilares abrigam.'),
     // 03/10: o sal de cada rodada (engine.js, "O SORTEIO RODADA A RODADA") — quem joga precisa saber que a rede conta
     tr('A sorte de cada rodada vem do servidor quando ela começa: a tentativa precisa de internet do começo ao fim (sem rede ela espera, não acaba).'),
     tr('Vale a melhor tentativa da semana (de segunda a domingo, 23:59). Derrubá-lo soma {a}% da vida dele aos pontos.', { a: Math.round((cfg.bonusDerrubada || 0) * 100) }),
     // 07/10: a tentativa em dupla pela Rede
     tr('Em grupo pela Rede os dois entram com os seus heróis (até quatro): o placar é o mesmo para as duas contas e cada uma gasta uma tentativa do dia.')
    ].forEach(function (t) { regras.appendChild(el('li', null, esc(t))); });
    body.appendChild(regras);

    var rank = el('div', 'eco-rank');
    body.appendChild(rank);
    var premios = el('div', 'eco-premios');
    body.appendChild(premios);
    var site = el('a', 'eco-site', tr('ver o ranking completo no site'));
    site.href = safe(function () { return paginaEventos().replace(/eventos\.html$/, 'ranking.html#eco'); }, 'site/ranking.html#eco');
    site.target = '_blank';
    site.rel = 'noopener';
    body.appendChild(site);

    function pinta(r) {
      clear(status);
      clear(rank);
      clear(premios);
      if (!r) {
        status.appendChild(el('p', 'eco-linha', ecoOficial()
          ? tr('O servidor não respondeu agora — o placar volta com ele.')
          : tr('Sem conexão com o servidor: dá para TREINAR contra o Eco, mas o treino não conta no placar.')));
        return;
      }
      var falta = ecoFaltaMs(r);
      status.appendChild(el('p', 'eco-linha eco-semana', tr('⏳ A semana fecha em <b>{a}</b> (domingo, 23:59 de Brasília).', { a: esc(safe(function () { return JOGO.Agenda.falta(falta); }, null) || bonusFalta(falta)) })));
      var eu = r.eu;
      if (eu) {
        status.appendChild(el('p', 'eco-linha', (eu.restantes
          ? tr('Tentativas de hoje: <b>{restantes} de {a}</b>', { restantes: eu.restantes, a: r.tentativasPorDia })
          : tr('Tentativas de hoje: <b>{restantes} de {a}</b> — o Eco volta a ouvir amanhã.', { restantes: eu.restantes, a: r.tentativasPorDia }))));
        if (eu.foraDoRanking) status.appendChild(el('p', 'eco-linha', tr('Conta da equipe: você joga, mas não entra no ranking.')));
        else if (eu.melhor) {
          status.appendChild(el('p', 'eco-linha', (eu.melhor.derrubou
            ? tr('Seu melhor da semana: <b>{a} pontos</b> (derrubou!){b}', { a: ecoNum(eu.melhor.pontos), b: eu.posicao ? ' ' + tr('· <b>{posicao}º</b> lugar', { posicao: eu.posicao }) : '' })
            : tr('Seu melhor da semana: <b>{a} pontos</b>{b}', { a: ecoNum(eu.melhor.pontos), b: eu.posicao ? ' ' + tr('· <b>{posicao}º</b> lugar', { posicao: eu.posicao }) : '' }))));
        } else status.appendChild(el('p', 'eco-linha', tr('Você ainda não tem tentativa conferida nesta semana.')));
        bEnt.disabled = !eu.restantes && ecoOficial();
        (eu.premios || []).slice(0, 2).forEach(function (pr) {
          status.appendChild(el('p', 'eco-linha eco-premio-meu', tr('🏅 Semana de {a}: {posicao}º lugar{b} (o prêmio chega pela fila de entregas).', { a: ecoDatasDaSemana(pr.semana), posicao: pr.posicao, b: pr.titulo ? ' ' + tr('— o título “{a}”', { a: esc(titExibe(pr.titulo)) }) : '' })));
        });
      } else if (ecoOficial()) {
        status.appendChild(el('p', 'eco-linha', tr('Entre na sua conta para ver as suas tentativas.')));
      }
      rank.appendChild(el('h3', 'hs-sec', tr('Os primeiros da semana')));
      var linhas = (r.ranking || []).slice(0, 10);
      if (!linhas.length) rank.appendChild(el('p', 'empty', tr('Ninguém pontuou ainda nesta semana. O primeiro lugar está livre.')));
      linhas.forEach(function (l) {
        var li = el('div', 'eco-rank-linha' + (l.posicao <= 3 ? ' is-podio' : ''));
        li.appendChild(el('span', 'eco-pos', l.posicao + 'º'));
        li.appendChild(el('span', 'eco-nome', esc(l.nome) + (l.derrubou ? ' <i title="derrubou o Eco">★</i>' : '')));
        li.appendChild(el('span', 'eco-pts', ecoNum(l.pontos)));
        rank.appendChild(li);
      });
      premios.appendChild(el('h3', 'hs-sec', tr('Os prêmios no fechamento')));
      (r.faixas || []).forEach(function (f) {
        var partes = [];
        if (f.vintens) partes.push(tr('{a} vinténs', { a: ecoNum(f.vintens) }));
        if (f.selos) partes.push(tr('{selos} selos de chefe', { selos: f.selos }));
        if (f.titulo) partes.push(tr('o título “{a}”', { a: esc(titExibe(f.titulo)) }));
        premios.appendChild(el('p', 'eco-faixa', '<b>' + esc(f.nome) + '</b>: ' + partes.join(' · ')));
      });
      premios.appendChild(el('p', 'inv-dica', tr('Nada disso se compra. Os prêmios chegam pela fila de entregas da conta, como os presentes do Mestre.')));
    }
    pinta(ecoResp);
    ecoLer(true).then(function (r) { if (sheetName === 'eco' && body.isConnected) pinta(r); });
  }

  /* O FIM DA TENTATIVA: o dano daqui na hora; o conferido, a posição e as tentativas que restam quando o
   * servidor responder (Game.ecoFim, que a própria tela relê — UI.repaint não precisa guardar nada). */
  function buildEcoFim(data) {
    var s = screens.ecoFim;
    clear(s);
    data = data || safe(function () { return G().ecoFim(); }, null) || {};
    var pl = data.placar || {}, of = data.oficial, cfg = D().eco || {};
    var st0 = st(), heroisVivos = 0;
    ((st0 && st0.units) || []).forEach(function (u) {
      if ((u.kind === 'hero' || u.kind === 'fusion') && u.side === 'player' && u.alive && !u.offBoard) heroisVivos++;
    });
    // 03/10: a rodada que o servidor não deu (a tentativa venceu, a semana fechou) encerra a tentativa ali
    var titulo = data.parouNaRodada ? tr('A tentativa parou na rodada {parouNaRodada}', { parouNaRodada: data.parouNaRodada })
      : data.largou ? tr('Você saiu da Câmara')
      : pl.derrubou ? tr('O Eco Primordial caiu!')
      : (!heroisVivos ? tr('O seu grupo caiu') : tr('As {a} rodadas acabaram', { a: pl.rodadas || cfg.rodadas || 12 }));
    var box = el('div', 'game-over eco-fim' + (pl.derrubou ? ' is-derrubou' : ''));
    box.appendChild(el('h1', null, esc(titulo)));
    var dano = of ? of.dano : (pl.dano || 0);
    var pontos = of ? of.pontos : (pl.pontos || 0);
    box.appendChild(el('div', 'eco-fim-num', ecoNum(dano)));
    box.appendChild(el('p', 'game-sub', tr('de dano no Eco{a} · rodada {b} de {c}', { a: pl.derrubou ? ' ' + tr('· {a} pontos com o bônus de quem derruba', { a: ecoNum(pontos) }) : '', b: pl.rodada || 0, c: pl.rodadas || cfg.rodadas || 12 })));
    if (data.semSal) {
      box.appendChild(el('p', 'eco-fim-sal', tr('O servidor não deu o sorteio da rodada {a}: {b}. O que você jogou até ali foi junto para a conferência.', { a: data.parouNaRodada || '', b: esc(data.semSal) })));
    }
    var linha = el('p', 'eco-fim-estado');
    if (data.treino) {
      linha.innerHTML = tr('Treino: sem conexão com o servidor, esta tentativa <b>não conta no placar</b>.');
    } else if (data.conferindo) {
      linha.innerHTML = tr('Conferindo com o servidor… (ele refaz a tentativa com os seus lances)');
    } else if (of) {
      var eu = of.eu || {};
      linha.innerHTML = tr('Conferido pelo servidor: <b>{a} pontos</b>.{b}{c}', { a: ecoNum(of.pontos), b: eu.foraDoRanking ? tr(' Conta da equipe: fora do ranking.')
          : (eu.melhor ? ' ' +
            tr('Seu melhor da semana: <b>{a}</b>{b}.', { a: ecoNum(eu.melhor.pontos), b: eu.posicao ? ' ' + tr('· <b>{posicao}º lugar</b>', { posicao: eu.posicao }) : '' }) : ''), c: typeof eu.restantes === 'number' ? ' ' + tr('Tentativas de hoje: {restantes}.', { restantes: eu.restantes }) : '' });
      if (of.dano !== pl.dano && pl.dano != null) {
        linha.innerHTML += '<br><small>' + tr('O número desta tela era {a}; vale o do servidor.', { a: ecoNum(pl.dano) }) + '</small>';
      }
    } else if (data.erro) {
      linha.className = 'eco-fim-estado is-erro';
      linha.innerHTML = tr('O servidor não contou esta tentativa: {a}', { a: esc(data.erro) });
    }
    box.appendChild(linha);
    var acts = el('div', 'menu-acts');
    if (data.dupla) box.appendChild(el('p', 'eco-fim-linha', tr('Tentativa em dupla com <b>{a}</b>: o placar vale para as duas contas.', { a: esc(nomeParceiro()) })));
    var restam = data.treino ? 1 : (of && of.eu && typeof of.eu.restantes === 'number' ? of.eu.restantes : 0);
    if (restam > 0 && selHeroes.length && !data.dupla && !emGrupo()) {
      acts.appendChild(btn(tr('Tentar de novo'), 'btn-primary', function () {
        var r = safe(function () {
          return G().startEco(selHeroes.slice(), function (res) {
            if (!(res && res.ok)) toast((res && res.erro) || tr('A Câmara do Eco não abriu.'));
          });
        }, false);
        if (!r) toast(tr('Essa dupla não enfrenta o Eco.'));
      }));
    }
    acts.appendChild(btn(tr('Ver o ranking'), 'btn-ghost', function () {
      safe(function () { return G().restart('hub'); }, null);
      openSheet('eco');
    }));
    acts.appendChild(btn(tr('Voltar à praça'), 'btn-ghost', function () {
      safe(function () { return G().restart('hub'); }, null);
    }));
    box.appendChild(acts);
    s.appendChild(box);
  }
  UI._buildEcoFim = buildEcoFim;            // provas

  // ==========================================================================
  // O SANTUÁRIO DOS ELEMENTOS (03/10) — a ficha, a linha da sala e os textos
  // ==========================================================================
  /* A PORTA é a ficha 'santuario', aberta pelo cais (como a do Eco: a praça não
   * ganha portal novo). Ela diz o que é, as quatro regras em português simples,
   * quem mora lá, o que paga e quem desce — e avisa quando a dupla de "Quem
   * desce" não tem ninguém do Fogo (a Câmara Apagada fica cega para ela). A
   * descida é a de qualquer calabouço: antessala, bilhete do servidor, vida
   * única, recompensa por sala. Em grupo pela Rede, quem lidera desce com o outro.
   *
   * OS TEXTOS das regras moram AQUI (SANT_REGRA) e servem à ficha, à porta da
   * antessala, à linha da sala na batalha e ao cartão de primeira visita
   * (js/ui/tutor.js lê UI.santuarioTexto) — uma frase só para cada regra. Os
   * números saem de DATA.santuario: mudar o dado muda o texto. */
  function santCfg() { return D().santuario || {}; }
  var SANT_REGRA = (function () {
    var c = safe(function () { return JOGO.DATA.santuario; }, null) || {};
    var visao = (c.escuro || {}).visao || 2, raio = (c.escuro || {}).raio || 2;
    var custo = (c.agua || {}).custo || 2, custoAgua = (c.agua || {}).custoAgua || 1, troca = (c.agua || {}).trocaACada || 2;
    var periodo = (c.pilares || {}).periodo || 2, gira = (c.vento || {}).giraACada || 2, alc = (c.vento || {}).alcance || 1;
    return {
      fogo: { sala: tr('A Câmara Apagada'), curto: tr('Escuro'),
        resumo: tr('quem não é do <b>Fogo</b> só mira a casa escura a <b>{visao} casas</b>, e o monstro no breu some. Braseiro aceso clareia.', { visao: visao }),
        texto: tr('Aqui é escuro. Quem <b>não</b> é do caminho do <b>Fogo</b> só mira uma casa escura a <b>{visao} casas</b> — e não vê o monstro que está no breu. O <b>braseiro aceso</b> clareia {raio} casas em volta: um golpe de <b>Fogo</b> acende, um de <b>Água</b> apaga.', { visao: visao, raio: raio }) },
      agua: { sala: tr('A Galeria Alagada'), curto: tr('Água'),
        resumo: tr('entrar na água custa <b>{custo} PP</b> ({custoAgua} para quem é de <b>Água</b>) e a correnteza leva 1 casa no fim da rodada. A ponte é seca.', { custo: custo, custoAgua: custoAgua }),
        texto: tr('Entrar numa casa com água custa <b>{custo} PP</b> ({custoAgua} para quem é do caminho da <b>Água</b>). No <b>fim de cada rodada</b> a correnteza leva 1 casa quem está na água, para onde os riscos correm; ela vira a cada {troca} rodadas, e a bica que vai verter avisa antes. A <b>ponte</b> é seca.', { custo: custo, custoAgua: custoAgua, troca: troca }) },
      terra: { sala: tr('O Salão dos Pilares Vivos'), curto: tr('Pilares'),
        resumo: tr('os pilares <b>sobem e descem a cada {periodo} rodadas</b>; a seta ▲ ou ▼ avisa uma rodada antes. Quem está em cima segura o pilar.', { periodo: periodo }),
        texto: tr('Os pilares <b>sobem e descem a cada {periodo} rodadas</b>. Uma rodada antes a casa pisca e a seta diz: <b>▲</b> vai subir, <b>▼</b> vai descer. Pilar de pé fecha o caminho e a visão. Ninguém é esmagado: quem está em cima do soquete <b>segura</b> o pilar até sair.', { periodo: periodo }) },
      ar: { sala: tr('O Terraço da Ventania'), curto: tr('Vento'),
        resumo: tr('no fim da rodada a <b>rajada</b> empurra todo mundo 1 casa para onde o cata-vento aponta; feitiço de <b>Ar</b> alcança +{alc}. Ao lado do respiro o vento não pega.', { alc: alc }),
        texto: tr('No <b>fim de cada rodada</b> a rajada empurra todo mundo 1 casa para onde o <b>cata-vento</b> e as setas do chão apontam; ela gira a cada {gira} rodadas, e as setas ficam âmbar na rodada antes de virar. Feitiço de <b>Ar</b> lançado do terraço alcança <b>{alc} casa a mais</b>. Nas casas ao lado de um <b>respiro</b> o vento não pega.', { gira: gira, alc: alc }) },
      altar: { sala: tr('O Altar dos Quatro'), curto: tr('As quatro'),
        resumo: tr('as quatro regras de uma vez, cada uma no seu canto.'),
        texto: tr('As quatro regras de uma vez, cada uma no seu canto: <b>escuro</b> a noroeste, <b>água</b> a nordeste, <b>pilares</b> a sudoeste e <b>vento</b> a sudeste, em volta do altar.') }
    };
  })();
  UI.santuarioTexto = function (regra) { return SANT_REGRA[regra] || null; };

  /* A direção do motor ('n' | 's' | 'l' | 'o') como seta NA TELA. O tabuleiro é visto de quina: na
   * câmera de sempre o leste do mapa sobe para a direita (↗), o sul desce para a direita (↘), e cada
   * quarto de volta da câmera (R.rotation) gira tudo 90° no sentido do relógio. A conta sai do
   * QUADRANTE da câmera, e não de projetar um ponto: a linha da sala repinta quando o quadrante
   * muda, no meio do giro animado, e a projeção daquele quadro daria a seta de meio caminho —
   * que ficaria na tela até a próxima repintura (a prova da tela confere a tabela contra a projeção). */
  var SANT_SETAS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  var SANT_BASE = { l: 7, s: 1, o: 3, n: 5 };
  function santSeta(dir) {
    if (SANT_BASE[dir] == null) return '';
    var rot = safe(function () { return JOGO.Renderer.rotation(); }, 0) || 0;
    return SANT_SETAS[(SANT_BASE[dir] + 2 * rot) % 8];
  }
  UI._santSeta = santSeta;                  // provas

  /* a linha da sala na batalha: uma pílula por regra, com o que vale AGORA e o que muda na rodada que vem */
  function pintaSantuarioNaSala(s) {
    var info = safe(function () { return JOGO.Santuario.info(s); }, null);
    if (!info) return;
    function chip(regra, html, urgente) {
      var c = el('span', 'sant-chip' + (urgente ? ' is-aviso' : ''), html);
      c.setAttribute('data-regra', regra);
      c.style.setProperty('--ec', elemColor(regra));
      tipOn(c, SANT_REGRA[regra].sala, SANT_REGRA[regra].texto, elemColor(regra));
      bt.room.appendChild(c);
    }
    if (info.escuro) {
      var acesos = info.escuro.braseiros.filter(function (b) { return b.aceso; }).length;
      chip('fogo', tr('Escuro · <b>{acesos}</b> de {length} braseiros acesos', { acesos: acesos, length: info.escuro.braseiros.length }));
    }
    if (info.agua) {
      var vira = info.agua.proxima !== info.agua.dir;
      chip('agua', tr('Correnteza <b>{a}</b>{b}', { a: santSeta(info.agua.dir), b: vira ? ' ' + tr('· vira <b>{a}</b> na próxima', { a: santSeta(info.agua.proxima) }) : '' }), vira);
    }
    if (info.pilares) {
      var jaAvisou = info.pilares.aviso === s.round + 1;
      var espera = info.pilares.lista.filter(function (p) { return p.espera; }).length;
      chip('terra', (jaAvisou ? tr('Pilares trocam na <b>próxima rodada</b>') : tr('Pilares trocam na rodada <b>{trocaNa}</b>', { trocaNa: info.pilares.trocaNa })) +
        (espera ? ' ' + tr('· {espera} esperando', { espera: espera }) : ''), jaAvisou);
    }
    if (info.vento) {
      var gira = info.vento.proxima !== info.vento.dir;
      chip('ar', tr('Rajada <b>{a}</b>{b}', { a: santSeta(info.vento.dir), b: gira ? ' ' + tr('· gira <b>{a}</b> na próxima', { a: santSeta(info.vento.proxima) }) : '' }), gira);
    }
  }

  function sheetSantuario() {
    var dg = safe(function () { return D().especial(santCfg().id || 'elementsanctum'); }, null);
    var body = sheetShell(tr('O Santuário dos Elementos'),
      tr('O calabouço em que o mapa joga: cada sala tem uma regra de terreno, e quem conhece o elemento dela leva vantagem.'));
    sheetName = 'santuario';
    if (!dg) { body.appendChild(el('p', 'empty', tr('O Santuário não está nesta versão do jogo.'))); return; }

    body.appendChild(el('p', 'sant-desc', esc(dg.description || '')));
    body.appendChild(el('p', 'sant-linha', tr('<b>{length} salas</b>, sem chefe · nível recomendado <b>{a}</b> · vale em dupla e em grupo pela Rede', { length: dg.rooms.length, a: dg.recommendedLevel })));

    // ---- quem desce, e o que a dupla enxerga
    var dupla = el('p', 'sant-dupla', '');
    body.appendChild(dupla);
    var avisos = el('div', 'sant-avisos');
    body.appendChild(avisos);
    (function () {
      var hs = selHeroes.map(hero).filter(Boolean);
      dupla.innerHTML = hs.length
        ? tr('Desce a dupla de <b>Quem desce</b>: {a}.', { a: hs.map(function (h) {
            return esc(className(h.classId)) + ' <small>nv ' + (h.level || 1) + ' · ' + esc(ELEM_PT[h.element || 'neutro'] || '') + '</small>';
          }).join(tr(' e ')) })
        : tr('Escolha a dupla em <b>Quem desce</b> para entrar.');
      if (!hs.length) return;
      if (!hs.some(function (h) { return h.element === 'fogo'; })) {
        avisos.appendChild(el('p', 'sant-aviso', tr('Ninguém do <b>Fogo</b> na dupla: na Câmara Apagada vocês só miram a {a} casas no escuro. Dá para vencer acendendo os braseiros — com golpe de Fogo — ou chegando perto.', { a: (santCfg().escuro || {}).visao || 2 })));
      }
      var baixo = hs.filter(function (h) { return (h.level || 1) < dg.recommendedLevel - 4; });
      if (baixo.length) {
        avisos.appendChild(el('p', 'sant-aviso', tr('Abaixo do nível recomendado ({a}): os guardiões daqui batem mais forte que os do Coração Partido.', { a: dg.recommendedLevel })));
      }
    })();

    // ---- descer
    var acts = el('div', 'sant-acts');
    body.appendChild(acts);
    if (emGrupo()) {
      var nome = nomeParceiro();
      if (souLider()) {
        var sdG = seletorDif();
        if (sdG) acts.appendChild(sdG);
        acts.appendChild(btn(tr('Descer ao Santuário com {a}', { a: esc(nome) }), 'btn-primary btn-block sant-entra', function () {
          var r = safe(function () { return Gp().descer(dg.id); }, null);
          if (!r || !r.ok) toast(textoMotivo(r ? r.motivo : 'ocupado', r && r.motivo === 'sumido' ? nome : null));
          else { toast(tr('Chamando {nome}', { nome: nome }) + '…'); if (sheetName === 'santuario') closeSheet(); }
        }));
      } else {
        acts.appendChild(el('p', 'hub-nota', tr('Só quem lidera (<b>{a}</b>) escolhe o calabouço.', { a: esc(nome) })));
        acts.appendChild(btn(tr('Descer ao Santuário'), 'btn-primary btn-block sant-entra is-apagado', function () {
          toast(tr('Só quem lidera ({nome}) escolhe o calabouço.', { nome: nome }));
        }));
      }
    } else {
      var sd = seletorDif();
      if (sd) acts.appendChild(sd);
      acts.appendChild(btn(tr('Descer ao Santuário'), 'btn-primary btn-block sant-entra', function () {
        if (!selHeroes.length) { toast(tr('Escolha a sua dupla em "Quem desce" primeiro.')); return; }
        var ok = safe(function () { return G().startRun(selHeroes.slice(), dg.id); }, false);
        if (!ok) { toast(tr('Não deu para começar essa descida.')); return; }
        if (sheetName === 'santuario') closeSheet();
      }));
    }

    // ---- as salas e as regras
    body.appendChild(el('h3', 'hs-sec', tr('As cinco salas')));
    var lista = el('div', 'sant-salas');
    dg.rooms.forEach(function (room, i) {
      var regra = room.santuario && room.santuario.regra, t = SANT_REGRA[regra];
      if (!t) return;
      var card = el('div', 'sant-sala');
      card.style.setProperty('--ec', regra === 'altar' ? '#e8c25a' : elemColor(regra));
      card.appendChild(el('div', 'sant-sala-tit', '<span class="sant-n">' + (i + 1) + '</span> ' + esc(room.name) +
        (regra !== 'altar' ? ' <small>' + esc(ELEM_PT[regra] || '') + '</small>' : '')));
      card.appendChild(el('p', 'sant-sala-tx', t.texto));
      var quem = safe(function () { return G().monstrosDaSala(dg.id, i); }, []) || [];
      if (quem.length) {
        card.appendChild(el('p', 'sant-sala-quem', tr('Guardiões: {a}', { a: quem.map(function (m) {
          return esc(m.name) + (m.qtd > 1 ? ' ×' + m.qtd : '');
        }).join(' · ') })));
      }
      lista.appendChild(card);
    });
    body.appendChild(lista);

    // ---- o que paga
    body.appendChild(el('h3', 'hs-sec', tr('O que o Santuário paga')));
    var paga = el('ul', 'sant-paga');
    [tr('Experiência de fim de jogo em cada sala (a descida inteira rende mais que a do Coração Partido).'),
     tr('Pedras de forja do elemento de cada quadrante — é o melhor lugar para juntar pedra de um elemento só.'),
     tr('Peças do Coração Partido: comuns e raras nas quatro primeiras salas; épicas e lendárias no Altar, com dois sorteios.'),
     tr('Sem chefe: aqui não caem selo, insígnia, âncora nem carta.')
    ].forEach(function (t) { paga.appendChild(el('li', null, esc(t))); });
    body.appendChild(paga);
    body.appendChild(btn(tr('Rever as dicas das salas'), 'btn-ghost btn-mini sant-dicas', function () {
      var n = safe(function () { return JOGO.Tutor.reveSantuario(); }, 0);
      toast(n ? tr('As dicas do Santuário voltam a aparecer na entrada de cada sala.') : tr('As dicas estão desligadas neste aparelho.'));
    }));
  }
  UI._sheetSantuario = sheetSantuario;      // provas

  /* O MEDALHÃO DE CADA FICHA (02/10, a frente dos menus): o cabeçalho ganha o
   * ícone da porta que abriu a ficha — o mesmo desenho do cais — para o
   * jogador saber onde está sem ler o título. Quem decide é o NOME da ficha
   * (o openSheet o põe antes de chamar a função de desenho; os redesenhos de
   * dentro mantêm o nome) e, nas fichas de meta, a aba. Ficha sem entrada
   * aqui sai com o losango de sempre: nenhum cabeçalho fica sem marca. */
  var ICONE_FICHA = {
    char: 'fc-personagem', heroSheet: 'fc-personagem', customizar: 'fc-personagem', amigos: 'fc-amigos', guilda: 'fc-guilda',
    banco: 'fc-banco', missoes: 'fc-missoes', mercado: 'fc-mercado', mercadoConfirma: 'fc-mercado',
    loteria: 'fc-loteria', placar: 'fc-placar', troca: 'fc-troca', contas: 'fc-contas',
    perfil: 'fc-perfil', duelo: 'fc-duelo', dueloRede: 'fc-duelo', escolheDupla: 'fc-duelo',
    arenaQuadro: 'fc-duelo', torneio: 'fc-duelo', torneioCampeao: 'fc-duelo',
    sussurro: 'fc-mensagem', battleMenu: 'fc-pausa', config: 'fc-config',
    confirm: 'fc-alerta',
    eco: 'fc-eco',  // 03/10, a junção com a frente do Eco Primordial
    santuario: 'fc-santuario'   // 03/10: o Santuário dos Elementos
  };
  var ICONE_ABA = { inventario: 'fc-inventario', forja: 'fc-forja', feiticos: 'fc-feiticos',
                    colecao: 'fc-colecao', avatar: 'fc-personagem' };
  function iconeDaFicha() {
    if (sheetName === 'party') return ICONE_ABA[partyTab] || null;
    return ICONE_FICHA[sheetName] || null;
  }
  /* quem tinha o foco quando a ficha abriu: o foco volta para ele ao fechar
   * (quem navega pelo teclado não pode ser jogado no começo da página) */
  var sheetDeQuem = null;

  function sheetShell(title, sub, ico) {
    var jaAberta = sheetEl.classList.contains('is-on');
    var focoDentro = jaAberta && sheetEl.contains(document.activeElement);
    /* 03/10 (revisão): quem está DIGITANDO num campo fora da ficha (o chat da
     * praça) não perde o campo. Há ficha que abre sozinha, pela rede — a
     * escolha do duelo (aoDueloMudou) —, e o foco puxado para o painel no meio
     * da frase fazia o resto dela virar atalho: o "i" de "aí" trocava a
     * escolha do duelo pelo inventário, o Esc fechava a ficha, e no celular o
     * teclado sumia. Antes da ficha virar diálogo o campo ficava com o foco. */
    var ativo = document.activeElement;
    var digitando = !!ativo && !sheetEl.contains(ativo) &&
      (ativo.tagName === 'INPUT' || ativo.tagName === 'TEXTAREA' || ativo.isContentEditable);
    if (!jaAberta) {
      var at = document.activeElement;
      sheetDeQuem = (at && at !== document.body && !sheetEl.contains(at)) ? at : null;
    }
    clear(sheetEl);
    var panel = el('div', 'sheet-panel');
    // a ficha é um diálogo: o leitor de tela anuncia o título ao abrir, e o
    // painel aceita o foco (tabindex -1) para o Tab começar DENTRO dela
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'sheet-titulo');
    panel.tabIndex = -1;
    var head = el('div', 'sheet-head');
    var svg = safe(function () { return JOGO.IconesUI.svg(ico || iconeDaFicha() || ''); }, '');
    if (svg) {
      head.classList.add('tem-ico');
      var med = el('span', 'sheet-ico', svg);
      med.setAttribute('aria-hidden', 'true');
      head.appendChild(med);
    }
    var t = el('div', 'sheet-head-txt');
    var h2 = el('h2', null, esc(title));
    h2.id = 'sheet-titulo';
    t.appendChild(h2);
    if (sub) t.appendChild(el('p', null, sub));
    head.appendChild(t);
    var fecha = btn('✕', 'btn-icon btn-close', closeSheet);
    fecha.setAttribute('aria-label', tr('Fechar'));
    head.appendChild(fecha);
    panel.appendChild(head);
    var body = el('div', 'sheet-body');
    panel.appendChild(body);
    sheetEl.appendChild(panel);
    sheetEl.classList.add('is-on');
    // a ficha que acabou de abrir (ou que se redesenhou com o foco dentro,
    // que o clear acabou de apagar) segura o foco; quem desenha um campo
    // depois disto (a mensagem particular) toma o foco para o campo
    if (!digitando && (!jaAberta || focoDentro || document.activeElement === document.body)) {
      try { panel.focus({ preventScroll: true }); } catch (e) {}
    }
    return body;
  }
  /* `op` (22/09, opcional — a quebra da forja é quem pede): {sim, simCls,
   * aoCancelar}. O rótulo e a cor do botão que confirma (quebrar pede um
   * "Quebrar" vermelho, não um "Confirmar" dourado) e para onde o Cancelar
   * volta — sem `aoCancelar` ele só fecha, como sempre. */
  function confirmSheet(title, body, onYes, op) {
    op = op || {};
    var b = sheetShell(title, null, 'fc-alerta');
    sheetName = 'confirm';
    b.appendChild(el('p', 'confirm-txt', body));
    var acts = el('div', 'confirm-acts');
    acts.appendChild(btn(tr('Cancelar'), 'btn-ghost', function () {
      closeSheet();
      if (op.aoCancelar) op.aoCancelar();
    }));
    acts.appendChild(btn(op.sim || tr('Confirmar'), op.simCls || 'btn-primary', function () { closeSheet(); onYes(); }));
    b.appendChild(acts);
  }

  // 03/10: as fichas do Mestre de antes viraram abas do painel único (js/ui/painel_mestre.js)
  var GM_FICHA_ABA = { gm: 'grimorio', gmcaixa: 'caixa', gmagenda: 'eventos' };
  function openSheet(name, arg) {
    if (GM_FICHA_ABA.hasOwnProperty(name)) { gmAbre(GM_FICHA_ABA[name]); return; }
    /* 06/10: a conta SEM guilda (lido do servidor) não abre a ficha da guilda pelo cais, por atalho nem por
     * outra ficha — só avisa aonde ir; fundar e entrar é pela Sede da praça, que abre com 'sede'. Enquanto
     * não se sabe, abre: a própria ficha lê o servidor e decide (sheetGuilda). */
    if (name === 'guilda') {
      if (arg !== 'sede' && semGuildaSabido()) {
        if (sheetName === 'guilda') closeSheet();     // a ficha que ficou aberta de quando havia guilda
        toast(avisoSemGuilda());
        return;
      }
      guildaPelaSede = arg === 'sede';
    }
    sheetName = name;
    lastSheetArg = arg;          // guardado para UI.repaint() saber o que reabrir
    marcaDock(name);             // o cais acende a aba aberta (30/08)
    // [U6 desfeito a pedido, 25/08] As fichas de meta voltaram a ser MENUS
    // SEPARADOS — "tudo centralizado em um menu só" ficou ruim de usar. Os
    // nomes antigos continuam valendo ('party' abre a última ficha visitada);
    // o cais do Acampamento e o menu inicial chamam cada porta pelo nome.
    if (name === 'char') { sheetChar(); return; }   // 11/09: a ficha da conta
    if (name === 'amigos') { sheetAmigos(); return; }   // 13/09: amigos e inimigos
    if (name === 'eco') { sheetEco(); return; }         // 02/10: o Eco Primordial (o chefe supremo da semana)
    if (name === 'santuario') { sheetSantuario(); return; }   // 03/10: o Santuário dos Elementos (o calabouço especial)
    if (name === 'party') sheetParty(null, arg);
    else if (name === 'collection') sheetParty('colecao', arg);
    else if (name === 'inventory') sheetParty('inventario', arg);
    // a porta da forja (a barraca do ferreiro) abre SEMPRE no Forjar: quebrar
    // é o modo que destrói, e não se chega nele sem escolher (22/09). Os
    // redesenhos de dentro (sheetParty) guardam o modo.
    else if (name === 'forge') { forjaModo = 'forjar'; sheetParty('forja', arg); }
    else if (name === 'spells') sheetParty('feiticos', arg);
    else if (name === 'avatar') sheetParty('avatar', arg);
    else if (name === 'heroSheet') sheetHero(arg);
    else if (name === 'diario') sheetDiario();          // 08/10: o prêmio diário de resgate
    else if (name === 'customizar') sheetCustomizar();  // 08/10: título, aura e moldura
    else if (name === 'battleMenu') sheetBattleMenu();
    else if (name === 'contas') sheetContas();
    else if (name === 'config') sheetConfig();                             // 02/10: som, tela, movimento e atalhos
    else if (name === 'perfil') sheetPerfil(arg);
    else if (name === 'guilda') sheetGuilda(arg);
    else if (name === 'banco') sheetBanco();
    else if (name === 'missoes') sheetMissoes();
    else if (name === 'mercado') sheetMercado();
    else if (name === 'mercadoConfirma') sheetMercadoConfirma(arg);   // 13/09: a proposta aceita, para o comprador conferir
    else if (name === 'loteria') sheetLoteria();
    else if (name === 'placar') sheetPlacar();
    else if (name === 'troca') sheetTroca();
    else if (name === 'duelo') sheetDuelo();
    else if (name === 'dueloRede') sheetDueloRede();                       // 11/09: o duelo pela Rede
    else if (name === 'escolheDupla') sheetEscolheDupla(arg);              // 14/09: escolha os dois heróis (Arena, Campo…)
    else if (name === 'arenaQuadro') sheetArenaQuadro();                   // 14/09: o quadro de inscritos da Arena
    else if (name === 'torneio') sheetTorneio(arg);                        // 10/10: o Torneio da Arena
    else if (name === 'torneioCampeao') sheetTorneioCampeao(arg);          // 10/10: a tela do campeão
    else if (name === 'sussurro') sheetSussurro(arg && arg.id, arg && arg.nome);   // 11/09: a mensagem particular
    else closeSheet();
    pintaPedido();                 // 06/10: o cartão da mesa de troca fechada sai quando uma ficha abre
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
    { id: 'inventario', nome: tr('Inventário'),
      sub: tr('Um saco só para o grupo. Toque numa peça para vestir no herói ao lado.') },
    { id: 'forja', nome: tr('Forja'),
      sub: tr('Arraste a peça para a bancada e bata o martelo — ou quebre a peça em pedras do elemento dela. Embaixo, a Estrela funde 3 cópias.') },
    { id: 'feiticos', nome: tr('Feitiços'),
      sub: tr('A árvore inteira da classe: o tronco que todos têm e os quatro galhos elementais.') },
    { id: 'colecao', nome: tr('Coleção'),
      sub: tr('Cartas de chefe liberam classes e, depois, viram estrelas permanentes.') },
    /* 11/09: a aba do AVATAR saiu — o avatar deixou de ser escolha. Quem
     * anda no Acampamento é o PRIMEIRO herói de "Quem desce", e ponto. A
     * entrada 'avatar' fica aqui fora da lista para não quebrar quem ainda
     * chamar sheetParty('avatar') (o guarda-roupa segue no código, mudo). */
    { id: 'avatar', nome: tr('Avatar'), oculta: true,
      sub: tr('O corpo com que você anda no Acampamento. Cada dupla de classes liberadas põe a fusão no guarda-roupa.') }
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

    if (partyTab === 'forja') { forgeBody(body, arg); forjaEmDuasColunas(body); }
    else if (partyTab === 'colecao') collectionBody(body, arg);
    else if (partyTab === 'feiticos') spellTreeBody(body, arg);
    else if (partyTab === 'avatar') avatarBody(body);
    else inventoryBody(body, arg);
  }
  /* A FORJA EM DUAS COLUNAS (08/10 à noite — o dono: "precisa ser o inventário do lado direito e a forja
   * do lado esquerdo, como se fosse dois inventários; fica mais organizado"). forgeBody segue montando tudo
   * em sequência; aqui os nós marcados `fg-dir` (os seletores, os grupos "No saco"/"Vestidas" com as grades
   * e as dicas da grade) vão para a coluna da direita, e o resto (a bancada, a ficha, a trilha, o estado,
   * o martelo, a prateleira, a Estrela) para a da esquerda. A fileira dos modos fica em cima, inteira. */
  function forjaEmDuasColunas(body) {
    var modos = body.querySelector('.fg-modos');
    var wrap = el('div', 'fg2'), esq = el('div', 'fg2-esq'), dir = el('div', 'fg2-dir');
    dir.appendChild(el('h3', 'bk-tit fg2-tit', tr('Inventário')));
    [].slice.call(body.childNodes).forEach(function (n) {
      if (n === modos) return;
      (n.classList && n.classList.contains('fg-dir') ? dir : esq).appendChild(n);
    });
    wrap.appendChild(esq);
    wrap.appendChild(dir);
    body.appendChild(wrap);
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
    [['aberto', tr('já sabe')], ['proximo', tr('o próximo')],
     ['trancado', tr('falta nível')], ['descartado', tr('outro caminho')]].forEach(function (p) {
      var t = el('span', 'tl-item');
      t.appendChild(el('i', 'tl-dot is-' + p[0]));
      t.appendChild(el('span', null, esc(p[1])));
      leg.appendChild(t);
    });
    body.appendChild(leg);
    body.appendChild(el('p', 'hs-hint',
      tr('Toque num feitiço para ler a descrição completa.')));

    // ---- tronco: o que a classe tem de saída, valha qual elemento valer
    var base = (def.baseSpells || def.spells || []);
    if (base.length) {
      body.appendChild(el('h3', 'hs-sec', tr('Tronco · todo {a} tem', { a: className(cid) })));
      var tronco = el('div', 'arv-tronco');
      base.forEach(function (sid) { tronco.appendChild(chipDoTronco(sid)); });
      body.appendChild(tronco);
    }

    // ---- galhos
    body.appendChild(el('h3', 'hs-sec', escolhido
      ? tr('Galho de {a}', { a: ELEM_PT[escolhido] || escolhido })
      : tr('Quatro galhos · a escolha é no nível {lvEscolha}', { lvEscolha: lvEscolha })));
    // 12/09: escolher, trocar, liberar e reescrever o caminho é AQUI, sem tela à parte
    body.appendChild(painelCaminhos(hid, function () { openSheet('spells'); }));

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
    var f = tr('{a} PA', { a: d2.paCost || 0 });
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
    no.appendChild(el('span', 'arv-lv', tr('Nv') + ' ' + lv));
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
    /* COMO FUNCIONA (11/09, dono: "de alguma forma o jogador precisa entender
     * sobre as estrelas da conta e liberação de outros personagens"). A regra
     * inteira em quatro linhas, no alto da ficha onde ela acontece — porque
     * até aqui ela só existia no código e na barra de progresso, e barra sem
     * frase não ensina ninguém: o jogador via "3 / 15 cartas" e não sabia de
     * onde vinham, nem que o excedente vira estrela sozinho. */
    var comoP = el('div', 'col-como');
    comoP.appendChild(el('h4', null, tr('Como se libera um personagem')));
    comoP.appendChild(el('p', null,
      tr('<b>1.</b> Só <b>chefe</b> derruba carta — e nem sempre. Calabouço mais fundo derruba mais cartas de uma vez.<br><b>2.</b> A carta entra na coleção <b>sozinha</b>, na hora: não há nada para usar nem para juntar à mão.<br><b>3.</b> Ao completar o custo da classe, ela <b>libera na hora</b> e entra em "Quem desce".<br><b>4.</b> Carta repetida não se perde: tudo o que passa do custo vira <b>estrela</b> — bônus permanente daquela classe, que já conta nos números da ficha do Personagem.')));
    body.appendChild(comoP);

    var legend = el('div', 'col-legend');
    for (var s = 1; s <= (cfg.max || 5); s++) {
      var bn = cfg.bonuses && (cfg.bonuses[s] || cfg.bonuses[String(s)]);
      legend.appendChild(el('span', 'chip', '★' + s + ' ' + esc(bonusText(bn))));
    }
    body.appendChild(el('p', 'inv-dica', tr('O que cada estrela dá, em qualquer classe:')));
    body.appendChild(legend);

    /* OS FEITOS DE COLEÇÃO (07/10, Progress.feitos): o bestiário de cada portal (+10% de saque lá), os seis
     * chefes e as 21 fusões (+5% de XP cada). A Coleção passa a pagar por ser completada. */
    var feitos = safe(function () { return P().feitos(); }, []) || [];
    if (feitos.length) {
      body.appendChild(el('h3', 'hs-sec', tr('Feitos da coleção')));
      body.appendChild(el('p', 'inv-dica', tr('Completar a coleção paga: o bestiário de um portal dá <b>+10% de saque</b> nele; os seis chefes e as 21 fusões vencedoras dão <b>+5% de XP</b> cada, em toda sala.')));
      var grF = el('div', 'feitos');
      feitos.forEach(function (f) {
        var nome = f.tipo === 'bestiario' ? tr('Bestiário: {a}', { a: esc(f.nome) })
                 : (f.tipo === 'chefes' ? tr('Os seis chefes derrubados') : tr('As 21 fusões vencedoras'));
        var premio = f.tipo === 'bestiario' ? tr('+{a}% de saque lá', { a: Math.round(f.bonus * 100) }) : tr('+{a}% de XP', { a: Math.round(f.bonus * 100) });
        var ln = el('div', 'feito' + (f.feito ? ' is-feito' : ''));
        ln.appendChild(el('span', 'feito-nome', (f.feito ? '✓ ' : '') + nome));
        var barra = el('div', 'ms-barra');
        var cheio = el('i'); cheio.style.width = Math.min(100, Math.round(100 * f.prog / Math.max(1, f.alvo))) + '%';
        barra.appendChild(cheio);
        ln.appendChild(barra);
        ln.appendChild(el('span', 'feito-prog', tr('{prog} de {alvo}', { prog: f.prog, alvo: f.alvo }) + ' · ' + premio));
        grF.appendChild(ln);
      });
      body.appendChild(grF);
    }
    cronicasBloco(body, focusId);     // 07/10: as crônicas do mundo enterrado, abaixo dos feitos

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
      // 04/10: a carta é item — o cartão leva a contagem ×N (a mesma pilha da aba Cartas do Inventário)
      pic.appendChild(cartaClasse(cid, 92, info.cards ? '×' + info.cards : null));
      if (!info.unlocked) pic.classList.add('silhouette');
      row.appendChild(pic);

      var txt = el('div', 'col-txt');
      var h3 = el('h3', null, esc(info.name));
      if (info.unlocked) h3.appendChild(el('span', 'chip chip-ok', tr('liberada')));
      txt.appendChild(h3);
      var def = classDef(cid) || {};
      txt.appendChild(el('p', 'col-role', esc(def.role ? tr(def.role) : '') + (def.description ? ' — ' + esc(def.description) : '')));

      // progresso de desbloqueio
      if (!info.unlocked) {
        var faltam = Math.max(0, info.unlockCost - info.cards);
        txt.appendChild(bar('bar-card', info.unlockCost ? info.cards / info.unlockCost : 0,
          info.cards + ' / ' + info.unlockCost + ' cartas'));
        txt.appendChild(el('p', 'col-faltam', (faltam === 1
          ? tr('Faltam <b>{faltam}</b> carta para liberar.', { faltam: faltam })
          : tr('Faltam <b>{faltam}</b> cartas para liberar.', { faltam: faltam }))));
      } else {
        txt.appendChild(el('div', 'col-cards', '<b>' + info.cards + '</b> cartas guardadas' +
          (info.unlockCost ? ' ' + tr('· custou {unlockCost}', { unlockCost: info.unlockCost }) : '')));
      }

      // trilha de estrelas com o próximo bônus
      var trilha = el('div', 'star-track');
      var costs = (D().cards && D().cards[cid] && D().cards[cid].starCosts) || [5, 15, 30, 55, 90];
      for (var i2 = 0; i2 < (cfg.max || 5); i2++) {
        var on = i2 < info.stars;
        var stp = el('div', 'star-step' + (on ? ' is-on' : '') +
                     (info.next && info.next.star === i2 + 1 ? ' is-next' : ''));
        stp.appendChild(art('starIcon', [on, 26], 26));
        var bn2 = cfg.bonuses && (cfg.bonuses[i2 + 1] || cfg.bonuses[String(i2 + 1)]);
        stp.appendChild(el('span', 'star-b', esc(bonusText(bn2))));
        tipOn(stp, '★' + (i2 + 1), tr('Custa <b>{a}</b> cartas além do desbloqueio.<br>Dá: {b}.', { a: costs[i2], b: esc(bonusText(bn2)) }), on ? '#ffc44d' : '#8b93a0');
        trilha.appendChild(stp);
      }
      txt.appendChild(trilha);
      if (info.next) {
        txt.appendChild(el('p', 'col-next', tr('Faltam <b>{faltam}</b> cartas para a ★{star}.', { faltam: info.next.faltam, star: info.next.star })));
      } else if (info.unlocked) {
        txt.appendChild(el('p', 'col-next is-max', tr('Todas as estrelas conquistadas.')));
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
      var hb = el('h3', 'col-sub', tr('Bichos'));
      hb.style.cssText = 'margin:14px 0 6px;font:700 15px Georgia,serif;color:var(--gold-2,#e8c25a)';
      body.appendChild(hb);
      body.appendChild(el('p', 'col-role', tr('Cartas de bicho caem só do chefe — e é difícil. 5 cartas: o bicho é seu. Depois, +10 / +15 / +20 viram estrelas; o nível sobe com o XP do dono, até o 10.')));
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
        if (info.unlocked) h3.appendChild(el('span', 'chip chip-ok', tr('Nv') + ' ' + info.level));
        txt.appendChild(h3);
        txt.appendChild(el('p', 'col-role', esc(bonusText(pdx.bonuses)) +
          (info.mult > 1 ? ' × ' + info.mult.toFixed(2) : '')));
        if (!info.unlocked) {
          var faltamP = Math.max(0, info.unlockCost - info.cards);
          txt.appendChild(bar('bar-card', info.unlockCost ? info.cards / info.unlockCost : 0,
            info.cards + ' / ' + info.unlockCost + ' cartas'));
          txt.appendChild(el('p', 'col-faltam', (faltamP === 1
            ? tr('Faltam <b>{faltamP}</b> carta para o bicho.', { faltamP: faltamP })
            : tr('Faltam <b>{faltamP}</b> cartas para o bicho.', { faltamP: faltamP }))));
        } else {
          txt.appendChild(bar('bar-xp', xi.frac, xi.max ? tr('Nv 10 — no topo') : tr('Nv {level} · faltam {faltam} XP', { level: xi.level, faltam: xi.faltam })));
          txt.appendChild(el('div', 'col-cards', '<b>' + info.cards + '</b> cartas guardadas'));
        }
        var trilha = el('div', 'star-track');
        for (var s2 = 0; s2 < info.maxStars; s2++) {
          var on2 = s2 < info.stars;
          var stp2 = el('div', 'star-step' + (on2 ? ' is-on' : '') +
                        (info.next && info.next.star === s2 + 1 ? ' is-next' : ''));
          stp2.appendChild(art('starIcon', [on2, 26], 26));
          stp2.appendChild(el('span', 'star-b', tr('+15% bônus')));
          tipOn(stp2, '★' + (s2 + 1), tr('Custa <b>{a}</b> cartas além das 5 do bicho.<br>Dá: +15% nos bônus ao dono e +15 de poder ao corpo dele.', { a: custos[s2] }), on2 ? '#ffc44d' : '#8b93a0');
          trilha.appendChild(stp2);
        }
        txt.appendChild(trilha);
        if (info.next) txt.appendChild(el('p', 'col-next', tr('Faltam <b>{faltam}</b> cartas para a ★{star}.', { faltam: info.next.faltam, star: info.next.star })));
        else txt.appendChild(el('p', 'col-next is-max', tr('Todas as estrelas conquistadas.')));
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
    if (b.hp) out.push(tr('+{hp} PV', { hp: b.hp }));
    if (b.pa) out.push(tr('+{pa} PA', { pa: b.pa }));
    if (b.pp) out.push(tr('+{pp} PP', { pp: b.pp }));
    if (b.power) out.push('+' + b.power + ' poder');
    if (b.initiative) out.push('+' + b.initiative + ' iniciativa');
    if (b.dodge) out.push('+' + b.dodge + ' esquiva');
    if (b.lock) out.push(tr('+{lock} fixação', { lock: b.lock }));
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
  // o grau NA TELA (o tierOf é chave: a classe de CSS sai dele)
  function tierNome(level) { return tr(tierOf(level)); }
  function tierClass(level) {
    return 't-' + String(tierOf(level)).toLowerCase().replace('í', 'i').replace('é', 'e');
  }

  function itemTipBody(itemId, level, stars, extra) {
    var it = itemDef(itemId);
    if (!it) return tr('Item {a}', { a: esc(itemId) }) + '.';
    var lv = level == null ? safe(function () { return P().itemLevel(itemId); }, 0) : level;
    var sr = stars == null ? safe(function () { return P().itemStars(itemId); }, 0) : stars;
    var mult = itemMult(lv, sr);
    var out = '<i>' + esc(SLOT_PT[slotOf(itemId)] || '') + ' · ' + esc(RAR_PT[it.rarity] || it.rarity) +
              (lv ? ' · <b>+' + lv + '</b> ' + esc(tierNome(lv)) : '') +
              (sr ? ' · <b>★' + sr + '</b>' : '') +
              (nivelUsoDe(itemId) ? ' · <b>' + tr('Nv.') + ' ' + nivelUsoDe(itemId) + '</b>' : '') + '</i>';
    var b = it.bonuses || {}, lines = [];
    for (var k in b) {
      if (!b.hasOwnProperty(k)) continue;
      if (k === 'resists') {
        for (var e in b.resists) {
          if (b.resists.hasOwnProperty(e)) lines.push('+' + Math.round(b.resists[e] * mult) + '% ' + (ELEM_PT[e] || e));
        }
      } else {
        var v = (k === 'pa' || k === 'pp') ? b[k] : Math.round(b[k] * mult);
        lines.push('+' + v + ' ' + ({ hp: tr('PV'), pa: tr('PA'), pp: tr('PP'), power: 'poder',
                                      initiative: 'iniciativa', dodge: 'esquiva', lock: tr('fixação') }[k] || k));
      }
    }
    if (lines.length) out += '<br>' + lines.join(' · ');
    // 08/10: a Gema engastada nesta cópia
    if (extra && extraTxt(extra)) out += '<br>' + tr('◆ Gema engastada: <b>{a}</b>', { a: esc(extraTxt(extra)) });
    if (it.grantsSpell) {
      var sp = spellDef(it.grantsSpell);
      out += '<br>' +
        tr('Concede: <b>{a}</b>{b}', { a: esc(spellName(sp, it.grantsSpell)), b: sp && sp.paCost ? ' <i>' + tr('({paCost} PA)', { paCost: sp.paCost }) + '</i>' : '' });
    }
    if (it.setId) {
      var sd = setDef(it.setId);
      out += '<br>' +
        tr('{a}</b> · {b}/{c} vestidas', { a: tr('Conjunto: <b>{a}', { a: esc((sd && sd.name) || it.setId) }), b: setEquippedCount(it.setId), c: setPieceCount(it.setId) });
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
  var STAT_PT = { hp: tr('PV'), pa: tr('PA'), pp: tr('PP'), power: 'poder', initiative: 'iniciativa',
                  dodge: 'esquiva', lock: tr('fixação') };
  // O que a peça dá, JÁ com forja e estrelas — texto, não balãozinho: no celular
  // ninguém passa o mouse, e esta é a informação que decide o toque.
  /* 08/10: o BÔNUS DA GEMA de uma cópia (`extra`: 'pa'|'pp'|'dano'|'vida'), escrito — "+1 PA",
   * "+30 PV"… Lê os números do Progress (DATA.gema.bonus): sem número aqui. */
  function extraTxt(x) {
    var b = safe(function () { return P().extraBonus(x); }, null);
    if (!b) return '';
    var out = [], k;
    for (k in b) if (b.hasOwnProperty(k) && b[k]) out.push('+' + b[k] + ' ' + (STAT_PT[k] || k));
    return out.join(' · ');
  }
  function extraNome(x) {
    return { pa: tr('PA'), pp: tr('PP'), dano: tr('dano'), vida: tr('vida') }[x] || x;
  }
  function itemBonusText(it, level, stars, extra) {
    if (!it) return '—';
    var mult = itemMult(level, stars);
    var b = it.bonuses || {}, out = [], k;
    if (extra && extraTxt(extra)) out.push('◆ ' + extraTxt(extra));
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

  /* O INVENTÁRIO LIMPO (08/10 à noite — o dono, com uma foto de referência na mão: "na hora de clicar em um
   * item e ver as características fica bem confuso no menu do inventário, os filtros também; queria mais
   * clean"). O desenho: o BONECO à esquerda — os espaços vestidos em quadradinhos dos dois lados do retrato,
   * sem texto —, o SACO à direita — as cinco categorias, DOIS seletores (espaço e elemento) no lugar das
   * fileiras de botões, a lupa que abre a busca, e a grade só de ícones — e, embaixo, UMA ficha para o que
   * foi tocado (fichaItem: Efeitos, Condições, Carac., a descrição e as ações). No estreito as colunas
   * viram pilha (CSS .inv2). */
  var INV_ICONE = 44;                        // o ícone da grade compacta (era 54 com o nome embaixo)
  function inventoryBody(body, preselect) {
    var hid = ensurePartyHero();
    avisaDevolvidasPorNivel();             // [D19] cobre a página sem praça
    if (typeof preselect === 'string' && preselect) {
      var pilha0 = pilhaDe(preselect);
      if (pilha0) invSel = { itemId: pilha0.itemId, level: pilha0.level, stars: pilha0.stars, extra: pilha0.extra || null };
    }
    var raiz = el('div', 'inv2 pt-mmo');
    var topo = el('div', 'inv2-top');

    // ---- o boneco: os espaços dos dois lados do retrato
    var ladoHeroi = el('div', 'inv2-boneco pt-mmo-heroi');
    ladoHeroi.appendChild(invBoneco(hid));
    if (hid) ladoHeroi.appendChild(invTrajes(hid));
    topo.appendChild(ladoHeroi);

    // ---- o saco
    var ladoSaco = el('div', 'inv2-saco pt-mmo-saco');
    if (JOGO.DB && JOGO.DB.moedas) {
      var saldoV = el('div', 'inv-vintens', '');
      ladoSaco.appendChild(saldoV);
      safe(function () {
        return JOGO.DB.moedas().then(function (m) {
          if (!saldoV.isConnected) return;
          saldoV.appendChild(art('vintemIcon', [20], 20, 'moeda-inline'));
          saldoV.appendChild(el('b', null, String(m)));
          saldoV.appendChild(document.createTextNode(m === 1 ? tr(' vintém') : tr(' vinténs')));
        });
      }, null);
    }
    ladoSaco.appendChild(invFilterTabs());
    var g = invGrid(hid);
    var lot = safe(function () { return { n: P().state.inventory.length, max: P().bagLimit() }; }, null);
    var barra = el('div', 'inv2-barra');
    barra.appendChild(invSeletores());
    var busca = buscaInput(invBusca, function (t) { invBusca = t; aplicaBusca(g, t); });
    busca.classList.add('inv2-busca' + (invBusca ? ' is-aberta' : ''));
    var lupa = icoBotao('busca', tr('Buscar'), !!invBusca, function () {
      busca.classList.toggle('is-aberta');
      lupa.classList.toggle('is-on', busca.classList.contains('is-aberta'));
      var campo = busca.querySelector('input');
      if (busca.classList.contains('is-aberta') && campo) campo.focus();
    }, { cls: 'btn-mini inv2-lupa' });
    barra.appendChild(lupa);
    if (lot) {
      barra.appendChild(el('span',
        'inv-lotacao inv2-lotacao' + (lot.n >= lot.max ? ' is-cheio' : (lot.n >= lot.max * 0.85 ? ' is-quase' : '')),
        '<b>' + lot.n + ' / ' + lot.max + '</b>'));
    }
    ladoSaco.appendChild(barra);
    ladoSaco.appendChild(busca);
    if (g.dataset && g.dataset.vazio) ladoSaco.appendChild(el('p', 'inv-dica', g.dataset.vazio));
    ladoSaco.appendChild(g);
    if (invBusca) aplicaBusca(g, invBusca);
    topo.appendChild(ladoSaco);

    // ---- a ficha do que foi tocado: debaixo do boneco (no estreito, depois da grade — CSS)
    var fichaArea = el('div', 'inv2-ficha-area');
    fichaArea.appendChild(invFichaAtual(hid));
    topo.appendChild(fichaArea);
    raiz.appendChild(topo);
    body.appendChild(raiz);
  }

  /* os seletores do saco: espaço (só nos equipamentos) e elemento (equipamentos e pedras) */
  function invSeletores() {
    return seletoresDeItem(invMainTab === 'equip' ? invFilter : null,
      invMainTab === 'equip' ? function (v) { invFilter = v; invSel = null; sheetParty('inventario'); } : null,
      (invMainTab === 'equip' || invMainTab === 'pedras') ? invElemFiltro : null,
      (invMainTab === 'equip' || invMainTab === 'pedras') ? function (v) { invElemFiltro = v; invSel = null; sheetParty('inventario'); } : null);
  }
  /* 08/10 à noite: os DOIS seletores (espaço e elemento) dos menus de item — o inventário, a forja e o banco
   * usam os mesmos (classes .inv2-sel-espaco / .inv2-sel-elem; as provas escolhem com `escolhe`). `aoSlot`
   * null = sem o seletor de espaço; `aoElem` null = sem o de elemento. */
  function seletoresDeItem(slotAtual, aoSlot, elemAtual, aoElem) {
    var w = el('div', 'inv2-sel');
    function seletor(cls, opcoes, atual, aoMudar) {
      var s = document.createElement('select');
      s.className = 'hub-input inv2-select ' + cls;
      opcoes.forEach(function (o) {
        var op = document.createElement('option');
        op.value = o[0]; op.textContent = o[1];
        if (o[0] === atual) op.selected = true;
        s.appendChild(op);
      });
      s.addEventListener('change', function () { aoMudar(s.value); });
      s.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
      return s;
    }
    if (aoSlot) {
      w.appendChild(seletor('inv2-sel-espaco', [['todos', tr('Todos os espaços')]].concat(SLOTS.map(function (c) { return [c, SLOT_PT[c]]; })),
        slotAtual || 'todos', aoSlot));
    }
    if (aoElem) {
      var els = ['fogo', 'agua', 'terra', 'ar', 'neutro'];
      w.appendChild(seletor('inv2-sel-elem', [['todos', tr('Todos os elementos')]].concat(els.map(function (e) { return [e, ELEM_PT[e] || e]; })),
        elemAtual || 'todos', aoElem));
    }
    return w;
  }

  /* os trajes, numa linha só */
  function invTrajes(hid) {
    var trj = el('div', 'pt-trajes inv2-trajes');
    trj.appendChild(el('span', 'pt-trajes-rot', tr('Trajes:')));
    [1, 2].forEach(function (n) {
      var tem = safe(function () {
        var hh = hero(hid);
        return !!(hh && hh.trajes && hh.trajes['t' + n]);
      }, false);
      var b = btn(tr('Vestir {n}', { n: n }), 'btn-mini' + (tem ? '' : ' is-off'), function () {
        var r = safe(function () { return P().wearTraje(hid, n); }, null);
        if (!r) return;
        var msgT;
        if (!r.faltas) msgT = tr('Traje {n} vestido.', { n: n });
        else if (r.porNivel && r.recusas && r.recusas.length) {
          msgT = tr('Traje {n}', { n: n }) + ': ' + textoRecusa(r.recusas[0]) +
                 (r.faltas > 1 ? ' ' + tr('(+{a} peça(s) ficaram de fora)', { a: r.faltas - 1 }) : '');
        } else msgT = tr('Traje {n}: {faltas} peça(s) não estavam no saco.', { n: n, faltas: r.faltas });
        toast(msgT, r.faltas ? undefined : 'good');
        sheetParty('inventario');
      });
      if (!tem) b.title = tr('Guarde o traje {n} primeiro', { n: n });
      trj.appendChild(b);
    });
    trj.appendChild(el('span', 'pt-trajes-rot', tr('guardar em:')));
    [1, 2].forEach(function (n) {
      trj.appendChild(btn(String(n), 'btn-mini btn-ghost', function () {
        safe(function () { return P().saveTraje(hid, n); }, false);
        toast(tr('Equipamento atual guardado como traje {n}.', { n: n }), 'good');
        sheetParty('inventario');
      }));
    });
    return trj;
  }

  /* a ficha de baixo: a peça do saco, a vestida tocada, ou o outro tipo de coisa (pedra, poção, pergaminho,
   * carta, bicho); sem nada tocado, a dica */
  function invFichaAtual(hid) {
    var pilha = pilhaSel();
    if (pilha) {
      var ref = { itemId: pilha.itemId, level: pilha.level, stars: pilha.stars, extra: pilha.extra || null,
                  count: pilha.count, index: pilha.index };
      return fichaItem(ref, { hid: hid, acoes: acoesDoSaco(pilha, hid) });
    }
    if (invSel && invSel.vestida && hid) {
      var canon = invSel.slot;
      var v = safe(function () { return P().equippedVar(hid, slotRaw(canon)); }, null);
      var itemId = v ? v.itemId : heroItem(hero(hid), canon);
      if (itemId) {
        var refV = { itemId: itemId, level: v ? v.level : 0, stars: v ? v.stars : 0, extra: (v && v.extra) || null, vestida: true, heroId: hid };
        var tirar = btn(tr('Tirar'), 'btn-mini btn-warn', function () {
          var ok = safe(function () { return P().unequip(hid, slotRaw(canon)); }, false);
          if (ok) {
            invSel = { itemId: refV.itemId, level: refV.level, stars: refV.stars, extra: refV.extra };     // volta selecionada na grade
            toast(tr('Voltou para o inventário.'), 'good');
          } else if (!safe(function () { return P().bagFree(1); }, true)) {
            toast(tr('O saco está cheio — a peça fica vestida.'));
          }
          sheetParty('inventario');
        });
        var acoesV = [tirar];
        if (!refV.extra) {
          acoesV.push(btn(tr('◆ Engastar Gema'), 'btn-mini inv-pick-gema', function () {
            forjaModo = 'gema';
            forgeTarget = { kind: 'worn', heroId: hid, slot: slotRaw(canon), itemId: refV.itemId, level: refV.level, stars: refV.stars, extra: null };
            sheetParty('forja');
          }));
        }
        return fichaItem(refV, { hid: hid, acoes: acoesV });
      }
    }
    if (invSel && invSel.tipo) return fichaOutro(invSel, hid);
    var w = el('div', 'inv-pick inv2-ficha is-idle');
    w.appendChild(el('p', null, invMainTab === 'equip'
      ? (invFilter !== 'todos' ? tr('Peças de {a}. Toque numa para ver o que ela dá e equipar.', { a: esc(SLOT_PT[invFilter] || '') })
                               : tr('Toque numa peça da grade para ver o que ela dá e equipar.'))
      : tr('Toque num item da grade para ver o que ele faz.')));
    return w;
  }

  /* as ações da peça do saco (as mesmas de sempre: equipar, a forja, a Gema, a quebra) */
  function acoesDoSaco(pilha, hid) {
    var acts = [];
    var it = itemDef(pilha.itemId), canon = slotOf(pilha.itemId);
    if (hid) {
      var nome = className((hero(hid) || {}).classId || hid).split(' ')[0];
      acts.push(btn(tr('Equipar em {a}', { a: esc(nome) }), 'btn-primary btn-mini', function () {
        limpaRecusa();
        var ok = safe(function () { return P().equip(hid, pilha.itemId, pilha.index); }, false);
        if (!ok) {
          var rc = recusaAtual();
          toast(rc ? textoRecusa(rc) : tr('Não deu para equipar essa peça.'));
        } else {
          toast(tr('{a} no {b}.', { a: esc((it && it.name) || tr('Peça')), b: SLOT_PT[canon] || tr('espaço') }), 'good');
          // o Traje do Colecionador FECHOU nesta peça? A aura acende agora
          if (it && D().selos && it.setId === D().selos.setId && safe(temAuraSelos, false)) {
            toast(tr('O Traje do Colecionador FECHOU — a aura acende na praça e o Selinho se junta a você!'), 'good');
            aplicaAuraPraca();
          }
          if (pilha.count <= 1) invSel = null;
        }
        sheetParty('inventario');
      }));
    }
    // UMA porta só para a forja (reorganização 25/08). Com fusão pronta, o rótulo adianta a boa notícia
    var fu = safe(function () { return P().fuseInfo(pilha.index); }, null);
    var fi = safe(function () { return P().upgradeInfo(pilha.index); }, null);
    var fundePronto = !!(fu && !fu.maxed && fu.pode);
    if ((fi && !fi.maxed) || (fu && !fu.maxed)) {
      acts.push(btn(
        fundePronto ? tr('Levar à forja — dá ★{proxima}!', { proxima: fu.proxima }) : tr('Levar à forja'),
        'btn-mini' + (fundePronto ? ' btn-gold' : ''), function () {
          forjaModo = 'forjar';
          forgeTarget = { kind: 'bag', itemId: pilha.itemId, level: pilha.level, stars: pilha.stars, extra: pilha.extra || null };
          sheetParty('forja');
        }));
    }
    // 08/10: a GEMA — a terceira porta da forja, só para a peça que ainda não tem a sua
    if (!pilha.extra) {
      acts.push(btn(tr('◆ Engastar Gema'), 'btn-mini inv-pick-gema', function () {
        forjaModo = 'gema';
        forgeTarget = { kind: 'bag', itemId: pilha.itemId, level: pilha.level, stars: pilha.stars, extra: null };
        sheetParty('forja');
      }));
    }
    // A QUEBRA (22/09): a outra porta da forja — só para o que se quebra
    var qb = safe(function () { return P().quebraInfoDe(pilha.itemId, pilha.level, pilha.stars); }, null);
    if (qb && qb.pode) {
      acts.push(btn(tr('Quebrar na forja'), 'btn-mini inv-pick-quebra', function () {
        forjaModo = 'quebrar';
        forjaQuebraN = 1;
        forgeTarget = { kind: 'bag', itemId: pilha.itemId, level: pilha.level, stars: pilha.stars, extra: pilha.extra || null };
        sheetParty('forja');
      }));
    }
    return acts;
  }

  /* a ficha das outras coisas do saco: pedra, poção, pergaminho, carta, bicho */
  function fichaOutro(sel, hid) {
    var w = el('div', 'inv-pick inv2-ficha inv2-ficha-outro');
    var cab = el('div', 'fi-cab'), ic = el('div', 'inv-pick-ic fi-ic'), tx = el('div', 'fi-tx');
    var corpo = el('div', 'fi-corpo'), acts = el('div', 'inv-pick-acts fi-acoes');
    function linha(html, cls) { corpo.appendChild(el('div', 'fi-ln' + (cls ? ' ' + cls : ''), html)); }
    if (sel.tipo === 'pedra') {
      var sdP = stoneDefs()[sel.id] || {};
      ic.appendChild(art('stoneIcon', [sel.id, 64], 64));
      tx.appendChild(el('div', 'inv-pick-nm fi-nm', esc(sdP.name || sel.id)));
      tx.appendChild(el('div', 'inv-pick-sub fi-sub', tr('Pedra de forja') + ' · ×' + stoneCount(sel.id)));
      linha(esc(sdP.description || tr('Usada na forja.')));
      linha(tr('Sobrando? O Mercadinho vende avulsa ou em lotes de 10, 50 e 100.'), 'fi-nota');
    } else if (sel.tipo === 'pocao') {
      var dP = (D().consumiveis || {})[sel.id] || {};
      ic.appendChild(art('pocaoIcon', [sel.id, 64], 64));
      tx.appendChild(el('div', 'inv-pick-nm fi-nm', esc(dP.name || sel.id)));
      tx.appendChild(el('div', 'inv-pick-sub fi-sub', tr('Poção') + ' · ×' + (safe(function () { return P().consumivelVer(sel.id); }, 0) || 0)));
      linha(tr('Cura <b>{cura} PV</b>, sem passar do máximo.', { cura: dP.cura || 0 }), 'is-mais');
      linha(tr('Beba fora da batalha (na praça, na sala de espera): o quadro da vida mostra um botão por poção quando um herói está ferido.'), 'fi-nota');
    } else if (sel.tipo === 'perg') {
      var pg = safe(function () { return P().pergaminhos(); }, null) || {};
      ic.appendChild(el('span', 'perg-glifo fi-perg', sel.id === 'xp' ? '❦' : '↺'));
      tx.appendChild(el('div', 'inv-pick-nm fi-nm', sel.id === 'xp' ? tr('Pergaminho da Sabedoria') : tr('Pergaminho da Reescrita')));
      tx.appendChild(el('div', 'inv-pick-sub fi-sub', tr('Pergaminho') + ' · ×' + (pg[sel.id === 'xp' ? 'xp' : 'elemento'] || 0)));
      if (sel.id === 'xp') {
        linha(tr('Lido, multiplica o XP das próximas salas enquanto a carga durar.'));
        acts.appendChild(btn(tr('Ler'), 'btn-primary btn-mini', function () { lerSabedoria(function () { sheetParty('inventario'); }); }));
      } else {
        linha(tr('A Reescrita é usada no painel de Caminhos Elementais, dentro da ficha do herói.'));
        if (hid) acts.appendChild(btn(tr('Ficha do herói'), 'btn-mini', function () { openSheet('heroSheet', hid); }));
      }
    } else if (sel.tipo === 'carta') {
      w.appendChild(cartaDetalhe(sel.id));
      return w;
    } else if (sel.tipo === 'pet') {
      var pdef = (D().pets || {})[sel.id] || {};
      ic.appendChild(art('petIcon', [sel.id, 64], 64));
      tx.appendChild(el('div', 'inv-pick-nm fi-nm', esc(pdef.name || sel.id)));
      tx.appendChild(el('div', 'inv-pick-sub fi-sub', tr('Bicho') + (pdef.bonuses ? ' · ' + esc(bonusText(pdef.bonuses)) : '')));
      if (pdef.description) linha(esc(pdef.description));
      linha(tr('Age depois do dono, na batalha.'), 'fi-nota');
      if (hid) {
        acts.appendChild(btn(tr('Chamar para {a}', { a: esc(className((hero(hid) || {}).classId || hid).split(' ')[0]) }), 'btn-primary btn-mini', function () {
          var ok = safe(function () { return P().equipPet(hid, sel.id); }, false);
          toast(ok ? tr('Companheiro equipado.') : tr('Não foi possível equipar o companheiro.'), ok ? 'good' : undefined);
          if (ok) invSel = null;
          sheetParty('inventario');
        }));
      }
    }
    cab.appendChild(ic); cab.appendChild(tx);
    w.appendChild(cab); w.appendChild(corpo);
    if (acts.childNodes.length) w.appendChild(acts);
    return w;
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
  /* A COROA DO MESTRE (05/10 → 08/10 à noite): `true` quando esta conta é o Mestre (JOGO.GM.ativo —
   * no ar, só a conta que o servidor marcou) e a régua (Brasa.coroaDe) devolve a coroa DELE,
   * JOGO.Brasa.MESTRE, fixa; `false` para toda conta comum, que segue na escada dos pontos. Até
   * 08/10 era o número da coroa do ranking escolhida no painel. Só aparência. */
  function coroaDoMestre() {
    return !!(JOGO.GM && JOGO.GM.ativo && safe(function () { return JOGO.GM.ativo(); }, false));
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

  /* O PÓDIO POR CLASSE (11/09, pedido do dono: "os usuários top 1, 2 e 3 do
   * ranking por classe terão o nome brilhante — o 1º dourado, o 2º prateado,
   * o 3º bronze").
   *
   * A régua é o NÍVEL daquela classe, classe por classe: quem é o Bárbaro
   * mais alto da praça leva ouro, mesmo que a conta dele some menos que a de
   * outro. Uma conta só usa a MELHOR medalha que tiver — ouro numa classe
   * vale mais que prata em três, e um nome só tem uma cor.
   *
   * Função PURA: entra [{id, resumo:{classes}}], sai { id: 'ouro'|'prata'|
   * 'bronze' }. Cada jogador calcula com o placar que ele mesmo viu — é a
   * mesma conta que o ranking da ficha mostra, e nada disso viaja pela Rede
   * (um cliente mexido não se dá medalha na tela dos outros). */
  var MEDALHAS = ['ouro', 'prata', 'bronze'];
  /* A ORDEM DO PÓDIO é a MESMA do ranking do site (servidor/api.py: ORDER BY
   * rc.xp DESC, rc.nivel DESC, r.nome): primeiro a XP, depois o nível, depois
   * o nome — e o id no fim, só para o pódio não dançar entre dois redesenhos.
   * 11/09: antes daqui o critério era só o nível, e dois heróis de nível 1 na
   * mesma classe empatavam; o desempate caía no id e dava prata a quem o site
   * mostrava em primeiro. Ranking que diverge de si mesmo não é ranking. */
  function comparaPorClasse(a2, b2) {
    return (b2.xp - a2.xp) || (b2.nv - a2.nv) ||
           String(a2.nome || '').localeCompare(String(b2.nome || '')) ||
           String(a2.id).localeCompare(String(b2.id));
  }
  /* As fichas de uma classe, a partir das contas do placar. */
  function filaDaClasse(contas, cid) {
    var fora = [];
    (contas || []).forEach(function (c) {
      var cls = (c && c.resumo && c.resumo.classes) || {};
      if (!(cls[cid] > 0)) return;                // classe não liberada não disputa
      var xps = (c.resumo && c.resumo.classesXp) || {};
      fora.push({ id: c.id, nome: c.nome || '', nv: cls[cid], xp: xps[cid] || 0 });
    });
    return fora.sort(comparaPorClasse);
  }
  function chaveNome(n) { return String(n == null ? '' : n).trim().toLowerCase(); }
  function medalhaDaPosicao(pos) {
    var T = JOGO.Titulos;
    return (T && T.medalhaDe) ? T.medalhaDe(pos) : null;
  }
  /* O NOME ACESO (12/09, pedido do dono): ouro, prata e bronze para o top 1, 2
   * e 3 do RANKING DE XP — o do site, igual para todo mundo, casado pelo nome
   * (é só o nome que ele publica). Sem servidor (em casa), o placar da praça
   * ordenado pelo nível somado, a mesma régua do "Top N PVM" dali. Sai
   * { nome em minúsculas: 'ouro'|'prata'|'bronze' }. */
  function mapaDeMedalhas(contas) {
    var fora = {};
    if (rankingSrv && rankingSrv.pvm) {
      Object.keys(rankingSrv.pvm).forEach(function (k) {
        var m = medalhaDaPosicao(rankingSrv.pvm[k]);
        if (m) fora[k] = m;
      });
      return fora;
    }
    (contas || []).slice().sort(function (a, b) {
      return ((b.resumo && b.resumo.total) || 0) - ((a.resumo && a.resumo.total) || 0);
    }).slice(0, 3).forEach(function (c, i) {
      var k = chaveNome(c && c.nome);
      if (k && !fora[k]) fora[k] = MEDALHAS[i];
    });
    return fora;
  }
  /* A lista de contas que o pódio enxerga: as fotos do placar mais EU (a
   * minha linha é viva, não foto). */
  function contasDoPlacar(fotos, meuId, meuNome) {
    var linhas = [{ id: meuId, nome: meuNome || '',
                    resumo: safe(resumoDaConta, { classes: {}, total: 0 }) }];
    (fotos || []).forEach(function (e2) {
      if (e2.id === meuId) return;
      linhas.push({ id: e2.id, nome: e2.nome, resumo: e2.resumo });
    });
    return linhas;
  }

  /* O ESTADO DOS TÍTULOS (11/09): o que a régua de js/core/titulos.js precisa
   * saber para dizer o que esta conta pode pendurar — as quedas de chefe (o
   * DB conta) e as posições nos dois pódios do placar (níveis e arena). Sai
   * por Promise porque o DB é assíncrono; as três leituras são locais e
   * baratas. Pódio de arena só conta quem JÁ duelou: a mesma regra do novato
   * que vale para a coroa. */
  /* O RANKING DO SERVIDOR (12/09, pedido do dono: o top 1, 2 e 3 do ranking de
   * XP ganham "Top N PVM" e o nome em ouro, prata e bronze; o do PvP, só o
   * título "Top N Pvp"). A régua é o ranking do SITE (GET /api/ranking,
   * público e guardado 30 s no servidor), casado pelo nome. Pedido no máximo a
   * cada 2 min. Em casa sem conta (file://) não pede: vale o placar da praça. */
  var rankingSrv = null, rankingEm = 0, rankingPromessa = null;
  var RANKING_MS = 120000;
  function rankingDoServidor() {
    var S = JOGO.Sessao, T = JOGO.Titulos;
    if (!S || typeof S.api !== 'function' || !T || !T.posicoesPorNome) return Promise.resolve(null);
    var emCasa = safe(function () { return location.protocol === 'file:'; }, true);
    if (emCasa && !safe(function () { return S.ativa && S.ativa(); }, false)) return Promise.resolve(null);
    if (rankingSrv && Date.now() - rankingEm < RANKING_MS) return Promise.resolve(rankingSrv);
    if (rankingPromessa) return rankingPromessa;
    var p = null;
    try { p = S.api('/api/ranking', { semToken: true }); } catch (e) { p = null; }
    if (!p || typeof p.then !== 'function') return Promise.resolve(rankingSrv);
    rankingPromessa = p.then(function (r) {
      rankingPromessa = null;
      if (r && r.ok === true && Object.prototype.toString.call(r.jogadores) === '[object Array]') {
        // 13/09: o pódio de cada classe também (os títulos "Top N <classe>", sem brilho)
        var pc = {}, lc = (r.porClasse && typeof r.porClasse === 'object') ? r.porClasse : {};
        Object.keys(lc).forEach(function (cid) {
          if (Object.prototype.toString.call(lc[cid]) === '[object Array]') pc[cid] = T.posicoesPorNome(lc[cid]);
        });
        rankingSrv = { pvm: T.posicoesPorNome(r.jogadores), pvp: T.posicoesPorNome(r.pvp || []), porClasse: pc };
        rankingEm = Date.now();
      }
      return rankingSrv;
    }, function () { rankingPromessa = null; return rankingSrv; });
    return rankingPromessa;
  }

  var tituloEstado = null;            // a última leitura, para a plaquinha
  function estadoDosTitulos() {
    var vazio = { chefes: {}, pvm: null, pvp: null };
    if (!JOGO.DB) return Promise.resolve(vazio);
    return Promise.all([JOGO.DB.jogador(),
                        JOGO.DB.placarLista ? JOGO.DB.placarLista() : Promise.resolve([]),
                        JOGO.DB.brasaVer ? JOGO.DB.brasaVer() : Promise.resolve(null),
                        JOGO.DB.chefesVer ? JOGO.DB.chefesVer() : Promise.resolve({}),
                        rankingDoServidor()])
      .then(function (r) {
        var eu = r[0], fotos = r[1] || [], bz = r[2], chefes = r[3] || {}, rk = r[4];
        var T = JOGO.Titulos;
        if (!T) return vazio;
        var niveis = contasDoPlacar(fotos, eu.id, eu.nome).sort(function (a, b) {
          return ((b.resumo && b.resumo.total) || 0) - ((a.resumo && a.resumo.total) || 0);
        });
        var arena = [{ id: eu.id, pts: bz ? bz.pts : 1000, partidas: (bz && bz.partidas) || 0 }];
        fotos.forEach(function (f) {
          if (f.id === eu.id || !f.resumo || typeof f.resumo.brasa !== 'number') return;
          arena.push({ id: f.id, pts: f.resumo.brasa, partidas: f.resumo.partidas || 0 });
        });
        arena = arena.filter(function (a) { return a.partidas > 0; })
                     .sort(function (a, b) { return b.pts - a.pts; });
        var chaveEu = chaveNome(eu.nome);
        // 13/09: o pódio de cada classe (os nomes do DATA.classes, sem o Mestre)
        var nomesClasse = {}, nomesVista = {}, porClasseEu = {};
        var defsC = (JOGO.DATA && JOGO.DATA.classes) || {};
        Object.keys(defsC).forEach(function (cid) {
          if (cid !== 'gm' && defsC[cid] && defsC[cid].name) {
            // 05/10: o DATA pode estar em inglês ou espanhol; o título "Top 1 Bárbaro" é chave e fica em português
            nomesClasse[cid] = (JOGO.I18n && JOGO.I18n.pt) ? JOGO.I18n.pt('classes', cid, 'name', defsC[cid].name) : defsC[cid].name;
            nomesVista[cid] = defsC[cid].name;
          }
        });
        var contasPC = rk ? null : contasDoPlacar(fotos, eu.id, eu.nome);
        Object.keys(nomesClasse).forEach(function (cid) {
          var posC = rk
            ? ((rk.porClasse && rk.porClasse[cid] && chaveEu) ? (rk.porClasse[cid][chaveEu] || null) : null)
            : T.posicaoDe(filaDaClasse(contasPC, cid).map(function (q) { return q.id; }), eu.id);
          if (posC) porClasseEu[cid] = posC;
        });
        tituloEstado = {
          chefes: chefes,
          // 10/10: as conquistas do Torneio da Arena ({pvp, guilda}) — o MEU do torneio as traz; sem ele, zero
          arena: safe(function () { var cq = JOGO.Torneio.meu().conquistas; return { pvp: cq.pvp || 0, guilda: cq.guilda || 0 }; }, { pvp: 0, guilda: 0 }),
          // 02/10: o título do pódio do Eco Primordial é da conta, para sempre (Progress.titulosEco)
          eco: safe(function () { return P().titulosEco ? P().titulosEco() : []; }, []),
          porClasse: porClasseEu,
          classeNomes: nomesClasse,
          classeNomesVista: nomesVista,
          // com o ranking do servidor é ELE que manda (o do site); sem, o placar da praça
          pvm: rk ? ((chaveEu && rk.pvm[chaveEu]) || null)
                  : T.posicaoDe(niveis.map(function (l) { return l.id; }), eu.id),
          pvp: rk ? ((chaveEu && rk.pvp[chaveEu]) || null)
                  : T.posicaoDe(arena.map(function (a) { return a.id; }), eu.id)
        };
        return tituloEstado;
      });
  }
  /* O título que a plaquinha pode mostrar. Os de ranking são EMPRESTADOS:
   * perdida a posição, some sozinho — sem apagar a escolha da conta, que
   * volta a valer no dia em que a posição voltar. Sem estado lido ainda,
   * não se apaga nada: corrige-se no primeiro `pintaConta`. */
  function tituloPendurado(t) {
    if (!t) return '';
    var T = JOGO.Titulos;
    if (!T || !tituloEstado) return t;
    if (mestreAtivo()) return t;                    // 08/10 à noite: o título do Mestre é o que ele quis
    if (T.valido(t, tituloEstado)) return t;
    // 08/10 (o dono: "se ele é top 1 pvp e perde o posto, não terá mais esse título; passa para o top 1
    // atual"): o título de pódio ACOMPANHA a posição — caiu para o 2º, a placa diz Top 2; saiu do pódio,
    // some. O relé faz o mesmo para os outros (servidor/rele_ident.py, titulo_do_podio)
    var m = /^Top [123] (.+)$/.exec(String(t));
    if (!m) return '';
    var resto = m[1], e = tituloEstado;
    if (resto === 'PVM') return e.pvm ? 'Top ' + e.pvm + ' PVM' : '';
    if (resto === 'Pvp') return e.pvp ? 'Top ' + e.pvp + ' Pvp' : '';
    var nomes = e.classeNomes || {};
    for (var cid in nomes) {
      if (nomes.hasOwnProperty(cid) && nomes[cid] === resto) {
        var pos = (e.porClasse || {})[cid];
        return pos ? T.tituloDeClasse(pos, resto) : '';
      }
    }
    return '';
  }
  UI._tituloPendurado = tituloPendurado;   // provas
  /* 08/10: a VIGIA do título — de 3 em 3 minutos na praça o ranking é relido e, se a posição mudou, a
   * plaquinha e o perfil da Rede acompanham (antes só ao entrar na praça ou abrir a ficha) */
  var tituloVigiado = null;
  try {
    setInterval(function () {
      if (current !== 'hub' || !JOGO.DB || !JOGO.Hub || !JOGO.Hub.nomeia) return;
      JOGO.DB.jogador().then(function (j) {
        if (!j || !j.titulo) return;
        rankingEm = 0;                                          // força a releitura do ranking
        return estadoDosTitulos().then(function () {
          var tt = tituloPendurado(j.titulo);
          if (tituloVigiado === null) { tituloVigiado = tt; return; }
          if (tt === tituloVigiado) return;
          tituloVigiado = tt;
          JOGO.Hub.nomeia(undefined, titExibe(tt));
          safe(function () { reanunciaPerfil(); return true; }, false);
          toast(tt ? tr('O seu título agora é {a}.', { a: titExibe(tt) }) : tr('Você saiu do pódio: o título de ranking saiu da plaquinha.'));
        });
      });
    }, 180000);
  } catch (eVig) {}

  function resumoDaConta() {
    var classes2 = {}, xps = {}, total = 0;
    heroIds().forEach(function (hid) {
      var hh = hero(hid);
      if (!hh || !isUnlocked(hh.classId || hid)) return;
      var cid = hh.classId || hid;
      var lv = hh.level || 1;
      // a MELHOR ficha da classe, como o servidor conta (herois_por_classe):
      // maior XP, depois maior nível. No jogo há uma ficha por classe, mas a
      // regra fica escrita — e é ela que o pódio usa para desempatar.
      var xp = Math.max(0, Math.floor(hh.xp || 0));
      if (classes2[cid] === undefined || xp > (xps[cid] || 0)) {
        classes2[cid] = lv;
        xps[cid] = xp;
      }
      total += lv;
    });
    var resumo = { classes: classes2, classesXp: xps, total: total,
             brasa: resumoBrasaPts, partidas: resumoBrasaPartidas,
             // a coroa escondida viaja: o fantasma desta conta também não a usa
             coroaOculta: resumoCoroaOculta,
             // 14/09: o nível do herói mais forte da dupla da vez (a do Campo lá dentro) — a paridade do ataque
             forte: forteDaVez(),
             galeria: resumoGaleria, poco: resumoPoco, guilda: resumoGuilda };
    // 05/10–08/10: a coroa que o Mestre escolhia no painel viajava aqui (`coroaMestre`). Desde 08/10 à
    // noite a coroa dele é fixa e quem a pendura nos outros é o `mestre: true` que o Relé carimba
    // no perfil — nada mais viaja no resumo (o Relé e a Rede seguem tirando o campo de quem o forjar)
    return resumo;
  }
  /* os pontos de brasa entram no resumo por fora (são assíncronos no DB);
   * buildHub os carrega antes de ligar a Rede */
  var resumoBrasaPts = 1000, resumoBrasaPartidas = 0, resumoGaleria = null,
      resumoPoco = null, resumoGuilda = null, resumoCoroaOculta = false;
  /* Reanuncia o meu cartão para a Rede (guilda nova, título novo, coroa
   * escondida). Só existe de verdade dentro do Acampamento — fora dele é
   * no-op, e é isso que o `function () {}` diz. */
  var reanunciaPerfil = function () {};

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
    if (!DBc) { caixa.appendChild(el('p', 'inv-dica', tr('A conta local não carregou.'))); return; }

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
              ? tr('Agora você anda como {a}.', { a: nomeDoPar(res.avatar) })
              : tr('De volta ao corpo do líder.'), 'good');
            // se o Acampamento está na tela, o corpo troca AGORA — ver é o ponto
            if (current === 'hub') UI.showScreen('hub');
            else sheetParty('avatar');
          });
        });
        return card;
      }

      var fila = el('div', 'av-fila');
      var lider = selHeroes[0] || ensurePartyHero() || 'sumo';
      fila.appendChild(cartao(null, tr('Seu líder — {a}', { a: className(lider) }), lider));
      // SOB DEMANDA (10/09): no jogo servido o corpo próprio de cada fusão
      // desce agora; até chegar, a composta segura o retrato — e a ficha se
      // repinta quando algum chegar, se ainda estiver aberta
      var Bav = JOGO.Bundle;
      if (Bav && Bav.pede && Bav.corpoDe) {
        try {
          Bav.pede(paresDeAvatar().map(Bav.corpoDe), function (falhas, n) {
            if (falhas.length < n && sheetName === 'party' && partyTab === 'avatar' &&
                document.body.contains(caixa)) sheetParty('avatar');
          });
        } catch (eAv) {}
      }
      paresDeAvatar().forEach(function (defId) {
        fila.appendChild(cartao(defId, nomeDoPar(defId), defId));
      });
      caixa.appendChild(fila);
      if (fila.children.length === 1) {
        caixa.appendChild(el('p', 'inv-dica',
          tr('Liberou duas classes? A fusão delas entra aqui.')));
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
    avisaHeroiAoGrupo();                  // 11/09: o grupo leva o principal
    if (current === 'hub' && liderAgora && liderAgora !== liderAntes) {
      UI.showScreen('hub');
      toast(tr('{a} agora anda no acampamento.', { a: className(liderAgora) }), 'good');
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
      wrap.appendChild(el('p', 'empty', tr('Nenhuma classe liberada ainda. As cartas dos chefes abrem as outras.')));
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
    var trocaB = btn(tr('⇄ Trocar'), 'btn-mini pt-troca', function () {
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
      mais.title = tr('Adicionar o segundo da dupla');
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
        fila.appendChild(el('p', 'inv-dica', tr('Não há outra classe liberada para pôr aqui.')));
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
    linha.appendChild(el('span', 'lv-badge', tr('Nv') + ' ' + (h.level || 1)));
    var eb = el('span', 'elem-badge e-' + (h.element || 'neutro'), ELEM_PT[h.element] || tr('Neutro'));
    eb.style.setProperty('--ec', elemColor(h.element || 'neutro'));
    linha.appendChild(eb);
    if (info.stars) linha.appendChild(starRow(info.stars, 12));
    col.appendChild(linha);
    col.appendChild(el('div', 'pt-hero-st',
      tr('<span class="s-hp">{a} PV</span><span class="s-pa">{b} PA</span><span class="s-pp">{c} PP</span><span>{d} poder</span><span>{e} esq.</span>', { a: stats.hp || 0, b: stats.pa || 0, c: stats.pp || 0, d: stats.power || 0, e: stats.dodge || 0 })));
    /* O LUGAR NA DUPLA, dito e mudável daqui — sem voltar à tela de seleção. */
    var naDupla = selHeroes.indexOf(hid);
    var acoes = el('div', 'pt-dupla');
    if (naDupla === 0) {
      acoes.appendChild(el('span', 'pt-dupla-tag is-lider', tr('Na dupla · anda no acampamento')));
    } else if (naDupla > 0) {
      acoes.appendChild(el('span', 'pt-dupla-tag', tr('Na dupla')));
      acoes.appendChild(btn(tr('Andar com este no acampamento'), 'btn-mini', function () {
        var antes = selHeroes[0] || null;
        selHeroes.splice(naDupla, 1);
        selHeroes.unshift(hid);
        duplaMudou(antes);
      }));
    } else if (selHeroes.length < 2) {
      acoes.appendChild(btn(tr('Entrar na dupla'), 'btn-mini', function () {
        var antes = selHeroes[0] || null;
        selHeroes.push(hid);
        duplaMudou(antes);
      }));
    } else {
      selHeroes.forEach(function (quem, qi) {
        acoes.appendChild(btn(tr('Entrar no lugar de {a}', { a: esc(className(quem)) }), 'btn-mini', function () {
          var antes = selHeroes[0] || null;
          selHeroes[qi] = hid;
          duplaMudou(antes);
        }));
      });
    }
    col.appendChild(acoes);
    card.appendChild(col);
    var ficha = btn(tr('Ficha'), 'btn-mini pt-ficha', function () { openSheet('heroSheet', hid); });
    card.appendChild(ficha);
    wrap.appendChild(card);
    return wrap;
  }

  // ---- o BONECO: os quatro espaços e o do bicho, em quadradinhos dos dois lados do retrato
  function invSlotCompacto(hid, canon) {
    var h = hero(hid) || {};
    var v = safe(function () { return P().equippedVar(hid, slotRaw(canon)); }, null);
    var itemId = v ? v.itemId : heroItem(h, canon);
    var it = itemId ? itemDef(itemId) : null;
    var lv = v ? v.level : 0, sr = v ? v.stars : 0;
    var selV = !!(invSel && invSel.vestida && invSel.slot === canon);
    var cell = el('button', 'pt-slot inv2-slot ' + starClass(sr) + (it ? ' has-item' : ' is-empty') +
                            (invFilter === canon && !it ? ' is-focus' : '') + (selV ? ' is-sel' : ''));
    cell.type = 'button';
    cell.setAttribute('data-slot', canon);
    cell.setAttribute('aria-label', SLOT_PT[canon] + (it ? ': ' + it.name : ''));
    cell.setAttribute('data-rot', it ? it.name : SLOT_PT[canon]);
    if (it) markRarity(cell, it.rarity);
    var ic = el('div', 'pt-slot-ic');
    ic.appendChild(it ? art('itemIcon', [itemId, INV_ICONE], INV_ICONE) : art('slotIcon', [canon, INV_ICONE], INV_ICONE));
    if (lv) ic.appendChild(el('span', 'ig-lv', '+' + lv));
    if (it) { var bs2 = setBadge(itemId); if (bs2) ic.appendChild(bs2); }
    if (v && v.extra) ic.appendChild(el('span', 'ig-gema', '◆'));
    cell.appendChild(ic);
    if (sr) cell.appendChild(starPips(sr));
    cell.appendChild(el('span', 'pt-slot-nm rot-oculto', SLOT_PT[canon]));
    legendaNoToque(cell);
    tap(cell, function () {
      if (it) invSel = selV ? null : { vestida: true, slot: canon, heroId: hid };
      else { invFilter = (invFilter === canon) ? 'todos' : canon; invMainTab = 'equip'; invSel = null; }
      sheetParty('inventario');
    });
    return cell;
  }
  function invSlotBicho(hid) {
    var h = hero(hid) || {};
    var pid = h.pet, pd = pid ? petDef(pid) : null;
    var selP = !!(invSel && invSel.tipo === 'bicho-vestido');
    var cp = el('button', 'pt-slot pt-pet inv2-slot' + (pd ? ' has-item' : ' is-empty') + (selP ? ' is-sel' : ''));
    cp.type = 'button';
    cp.setAttribute('data-slot', 'bicho');
    cp.setAttribute('data-rot', pd ? pd.name : tr('Bicho'));
    cp.setAttribute('aria-label', tr('Bicho') + (pd ? ': ' + pd.name : ''));
    var cic = el('div', 'pt-slot-ic');
    cic.appendChild(pd ? art('petIcon', [pid, INV_ICONE], INV_ICONE) : el('div', 'pet-empty', '☾'));
    cp.appendChild(cic);
    cp.appendChild(el('span', 'pt-slot-nm rot-oculto', tr('Bicho')));
    legendaNoToque(cp);
    tap(cp, function () {
      if (pd) {
        confirmSheet(tr('Soltar {a}?', { a: esc(pd.name) }), tr('O bicho volta para o saco.'), function () {
          safe(function () { P().unequipPet(hid); }, null);
          sheetParty('inventario');
        });
      } else if (ownedPets().length) petPicker(hid, 'party');
      else toast(tr('Nenhum bicho no saco — eles caem dos chefes.'));
    });
    return cp;
  }
  function invBoneco(hid) {
    var w = el('div', 'inv2-boneco-caixa');
    if (hid) {
      var esq = el('div', 'inv2-col inv2-col-esq');
      esq.appendChild(invSlotCompacto(hid, 'punho'));
      esq.appendChild(invSlotCompacto(hid, 'passo'));
      w.appendChild(esq);
    }
    w.appendChild(heroCarousel(hid));
    if (hid) {
      var dir = el('div', 'inv2-col inv2-col-dir');
      dir.appendChild(invSlotCompacto(hid, 'casca'));
      dir.appendChild(invSlotCompacto(hid, 'lume'));
      dir.appendChild(invSlotBicho(hid));
      w.appendChild(dir);
    }
    return w;
  }

  /* ================================================================ A FICHA DO ITEM (08/10 à noite)
   * O dono (com uma foto de referência na mão): "na hora de clicar em um item e ver as características fica
   * bem confuso... queria mais clean; e que todos os menus (forja, mercado...) sejam nesse estilo". UMA ficha
   * para a peça escolhida, em todo lugar: o retrato à esquerda, o nome e o nível de uso, e três abas —
   * Efeitos (o que ela dá, com o ganho/perda contra a vestida), Condições (nível, quem usa, conjunto) e
   * Carac. (espaço, raridade, pedra, estrela, cópias, fusão, quebra, de onde vem) — e a descrição embaixo.
   * `ref` = {itemId, level, stars, extra, count, index, vestida, heroId}; `op` = {hid, acoes: [botões],
   * compacto}. Guarda as classes de antes (.inv-pick, .inv-pick-nm, .inv-pick-ic, .inv-pick-tranca,
   * .inv-pick-acts) que as provas e o CSS conhecem. A aba aberta sobrevive ao redesenho (fichaAba). */
  var fichaAba = 'efeitos';
  function tabelaBonus(def, mult) {
    var m = {}, b = (def && def.bonuses) || {};
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
  function nomeStat(k) {
    if (k.indexOf('r:') === 0) return '% ' + (ELEM_PT[k.slice(2)] || k.slice(2));
    return STAT_PT[k] || k;
  }
  function portalDe(dungeonId) {
    var nome = null;
    (D().dungeons || []).forEach(function (x) { if (x && x.id === dungeonId) nome = x.name || x.id; });
    return nome;
  }
  function fichaItem(ref, op) {
    op = op || {};
    var it = itemDef(ref.itemId);
    var hid = op.hid || null;
    var wrap = el('div', 'inv-pick inv2-ficha ' + starClass(ref.stars) + (op.compacto ? ' is-compacta' : ''));
    if (!it) { wrap.appendChild(el('p', null, esc(ref.itemId))); return wrap; }
    markRarity(wrap, it.rarity);
    if (hid && !ref.vestida) marcaTranca(wrap, hid, ref.itemId);
    var canon = slotOf(ref.itemId);
    var nv = nivelUsoDe(ref.itemId);
    var puP = (hid && nv) ? safe(function () { return P().podeUsar(hid, ref.itemId); }, null) : null;
    var travada = !!(puP && puP.precisa > puP.nivel);

    // ---- o cabeçalho: o retrato, o nome, o nível de uso
    var cab = el('div', 'fi-cab');
    var ic = el('div', 'inv-pick-ic fi-ic');
    ic.appendChild(art('itemIcon', [ref.itemId, 64], 64));
    if (ref.count > 1) ic.appendChild(el('span', 'ig-n', '×' + ref.count));
    if (ref.level) ic.appendChild(el('span', 'ig-lv', '+' + ref.level));
    if (ref.extra) ic.appendChild(el('span', 'ig-gema', '◆'));
    var bsp = setBadge(ref.itemId);
    if (bsp) ic.appendChild(bsp);
    cab.appendChild(ic);
    var tx = el('div', 'fi-tx');
    var nm = el('div', 'inv-pick-nm fi-nm', esc(it.name));
    if (ref.stars) nm.appendChild(starPips(ref.stars));
    tx.appendChild(nm);
    tx.appendChild(el('div', 'inv-pick-sub fi-sub',
      esc(SLOT_PT[canon] || '') + ' · ' + esc(RAR_PT[it.rarity] || it.rarity || '') +
      (ref.level ? ' · +' + ref.level + ' ' + esc(tierNome(ref.level)) : '') +
      (ref.vestida ? ' · ' + tr('vestida por {a}', { a: esc(className((hero(ref.heroId || hid) || {}).classId || ref.heroId || hid)) }) : '')));
    if (travada) {
      tx.appendChild(el('div', 'inv-pick-tranca', tr('🔒 pede o nível <b>{precisa}</b> — o {a} está no {nivel}', { precisa: puP.precisa, a: esc(className((hero(hid) || {}).classId || hid)), nivel: puP.nivel })));
    }
    cab.appendChild(tx);
    cab.appendChild(el('span', 'fi-nivel' + (travada ? ' is-trancado' : ''), tr('Nv.') + ' ' + (nv || 1)));
    wrap.appendChild(cab);

    // ---- as abas
    var abas = el('div', 'fi-abas');
    var corpo = el('div', 'fi-corpo');
    var botoes = {};
    [['efeitos', tr('Efeitos')], ['condicoes', tr('Condições')], ['carac', tr('Carac.')]].forEach(function (a2) {
      var b = btn(a2[1], 'fi-aba' + (fichaAba === a2[0] ? ' is-on' : ''), function () {
        fichaAba = a2[0];
        for (var k in botoes) if (botoes.hasOwnProperty(k)) botoes[k].classList.toggle('is-on', k === a2[0]);
        pintaAba();
      });
      b.setAttribute('data-aba', a2[0]);
      botoes[a2[0]] = b;
      abas.appendChild(b);
    });
    wrap.appendChild(abas);
    wrap.appendChild(corpo);
    function linha(cls, html) { corpo.appendChild(el('div', 'fi-ln' + (cls ? ' ' + cls : ''), html)); }
    function pintaAba() {
      clear(corpo);
      var mult = itemMult(ref.level, ref.stars), k;
      if (fichaAba === 'efeitos') {
        var nova = tabelaBonus(it, mult), velha = null, atual = null;
        if (hid && !ref.vestida) {
          var v = safe(function () { return P().equippedVar(hid, slotRaw(canon)); }, null);
          if (v && v.itemId && !(v.itemId === ref.itemId && (v.level || 0) === (ref.level || 0) && (v.stars || 0) === (ref.stars || 0))) {
            atual = itemDef(v.itemId);
            if (atual) velha = tabelaBonus(atual, itemMult(v.level || 0, v.stars || 0));
          }
        }
        var algum = false;
        for (k in nova) {
          if (!nova.hasOwnProperty(k)) continue;
          algum = true;
          var d = velha ? nova[k] - (velha[k] || 0) : 0;
          linha('is-mais', '+' + nova[k] + ' ' + esc(nomeStat(k)) +
            (velha && d ? ' <em class="' + (d > 0 ? 'cmp-mais' : 'cmp-menos') + '">(' + (d > 0 ? '+' : '') + d + ')</em>' : ''));
        }
        if (velha) {
          for (k in velha) {
            if (velha.hasOwnProperty(k) && !nova.hasOwnProperty(k)) linha('is-menos', tr('perde +{a} {b} da vestida', { a: velha[k], b: esc(nomeStat(k)) }));
          }
        }
        if (ref.extra && extraTxt(ref.extra)) linha('is-gema', '◆ ' + esc(extraTxt(ref.extra)) + ' <i>' + tr('(Gema engastada)') + '</i>');
        if (it.grantsSpell) {
          var sp = spellDef(it.grantsSpell);
          linha('is-feitico', tr('Concede <b>{a}</b>{b}', { a: esc(spellName(sp, it.grantsSpell)), b: sp && sp.paCost ? ' ' + tr('({paCost} PA)', { paCost: sp.paCost }) : '' }));
        }
        if (!algum && !it.grantsSpell && !ref.extra) linha('', tr('Sem bônus de atributo.'));
        if (velha && atual) corpo.appendChild(el('p', 'fi-nota', tr('Entre parênteses: a diferença para {a}, a vestida no mesmo espaço.', { a: esc(atual.name) })));
      } else if (fichaAba === 'condicoes') {
        if (nv) {
          linha(travada ? 'is-menos' : 'is-ok', tr('Nível {a} ou mais', { a: nv }) +
            (travada ? ' — ' + tr('🔒 o {a} está no {nivel}', { a: esc(className((hero(hid) || {}).classId || hid)), nivel: puP.nivel }) : (hid ? ' ✓' : '')));
        } else linha('is-ok', tr('Sem exigência de nível'));
        linha('', tr('Espaço: <b>{a}</b> — {b}', { a: esc(SLOT_PT[canon] || ''), b: esc(SLOT_HINT[canon] || '') }));
        if (it.setId) {
          var sd = setDef(it.setId);
          var lnSet = el('div', 'fi-ln inv-pick-set is-toque', tr('{a}</b> · {b}/{c} vestidas · <u>ver</u>', { a: tr('Conjunto <b>{a}', { a: esc((sd && sd.name) || it.setId) }), b: setEquippedCount(it.setId), c: setPieceCount(it.setId) }));
          tap(lnSet, function () { showTip(lnSet, (sd && sd.name) || it.setId, setTipBody(it.setId), elemColor(sd && sd.element)); });
          corpo.appendChild(lnSet);
        }
        var donos = safe(function () { return P().equippedByAll(ref.itemId); }, []);
        if (donos.length) {
          linha('inv-pick-us', tr('Outra cópia em uso por <b>{a}</b>', { a: donos.map(function (d2) { return esc(className((hero(d2) || {}).classId || d2)); }).join(', ') }));
        }
        if (ref.extra) linha('fi-nota', tr('Com a Gema engastada a peça fica presa à conta: não vai ao mercadinho, à troca nem ao banco da guilda.'));
      } else {
        linha('', tr('Espaço: <b>{a}</b>', { a: esc(SLOT_PT[canon] || '') }));
        var rarL = el('div', 'fi-ln', tr('Raridade: <b>{a}</b>', { a: esc(RAR_PT[it.rarity] || it.rarity || '') }));
        rarL.style.setProperty('--rc', rarColor(it.rarity));
        corpo.appendChild(rarL);
        linha('', ref.level ? tr('Pedra: <b>+{a}</b> {b}', { a: ref.level, b: esc(tierNome(ref.level)) }) : tr('Pedra: <b>+0</b> — ainda não forjada'));
        linha('', ref.stars ? tr('Estrela: <b>★{a}</b>', { a: ref.stars }) : tr('Estrela: <b>nenhuma</b>'));
        if (ref.count > 1) linha('', tr('Cópias iguais no saco: <b>×{a}</b>', { a: ref.count }));
        if (typeof ref.index === 'number') {
          var fu = safe(function () { return P().fuseInfo(ref.index); }, null);
          if (fu && !fu.maxed) {
            linha(fu.pode ? 'is-mais' : '', fu.engastada
              ? tr('Fusão: a cópia com Gema não funde')
              : (fu.pode ? tr('Fusão pronta na forja: dá <b>★{a}</b>', { a: fu.proxima })
                         : tr('Fusão: <b>{a}/{b}</b> cópias iguais para a ★{c}', { a: fu.copias, b: fu.precisa, c: fu.proxima })));
          }
          var qb = safe(function () { return P().quebraInfoDe(ref.itemId, ref.level, ref.stars); }, null);
          if (qb && qb.pode) {
            var sdQ = stoneDefs()[qb.stoneId] || {};
            linha('', tr('Quebra: dá <b>{a}</b> {b}', { a: qb.pedras, b: esc(sdQ.name || qb.stoneId || '') }));
          }
        }
        var portal = it.dungeonId ? portalDe(it.dungeonId) : null;
        if (portal) linha('', tr('Cai em: <b>{a}</b>', { a: esc(portal) }));
      }
    }
    pintaAba();
    if (it.description) wrap.appendChild(el('p', 'fi-desc', esc(it.description)));
    var acts = el('div', 'inv-pick-acts fi-acoes');
    (op.acoes || []).forEach(function (b2) { if (b2) acts.appendChild(b2); });
    if (acts.childNodes.length) wrap.appendChild(acts);
    return wrap;
  }

  /* As abas do SACO (22/09: redondas, com ícone): a categoria em cima — o
   * elmo, as pedras, a poção, a pata — e o nome da aberta escrito ao lado,
   * que no celular não há mouse para perguntar. Embaixo os filtros: espaço
   * (só nos equipamentos) e elemento (equipamentos e pedras — poção e bicho
   * não têm elemento, a fileira ali só enganaria). */
  var INV_CATS = [{ id: 'equip', ico: 'cat-equip', rot: tr('Equipamentos') },
                  { id: 'pedras', ico: 'cat-pedras', rot: tr('Pedras') },
                  { id: 'cons', ico: 'cat-cons', rot: tr('Consumíveis') },
                  { id: 'pets', ico: 'cat-pets', rot: tr('Pets') },
                  { id: 'cartas', ico: 'cat-cartas', rot: tr('Cartas') }];

  /* A CARTA DE CLASSE COMO ITEM (04/10). O dono: "a carta de classe, essas devem ter o desenho do
   * personagem, ser um item... essa carta que dá estrela para o personagem". A regra NÃO muda — a conta
   * continua sendo `state.cards[classe]`, que libera a classe e sobe as estrelas sozinha (Progress.addCards,
   * [D9]); o que muda é o que o jogador VÊ: um cartão com o retrato do personagem (o retrato 3D que o jogo
   * já gera, dentro da moldura do Art.cardIcon), a borda na cor da raridade, o nome e a contagem ×N.
   * Aparece no Inventário (aba Cartas, uma pilha por classe), na recompensa, na Coleção e na ficha do herói.
   * O retrato vem do cache do art.js/portraits3d — um canvas por classe, do tamanho de um ícone. */
  var invCartaSel = null;              // a carta aberta na aba Cartas (id da classe)
  function cartaRaridade(cid) { return (classDef(cid) || {}).cardRarity || 'comum'; }
  function cartaClasse(cid, larg, marca) {
    var c = el('span', 'carta-cl');
    markRarity(c, cartaRaridade(cid));
    c.setAttribute('data-carta', cid);
    c.appendChild(art('cardIcon', [cid, 92, 130], larg || 92));
    if (marca) c.appendChild(el('span', 'carta-cl-n', esc(marca)));
    return c;
  }
  /* o que a pilha FAZ e quanto falta: liberar a classe, depois a próxima estrela (as cartas além do
   * custo de liberar é que contam para estrela — a mesma conta do Progress.cardInfo) */
  function cartaProgresso(cid) {
    var info = cardInfo(cid), nome = esc(info.name || className(cid));
    if (!info.unlocked && info.cards < info.unlockCost) {
      var f = info.unlockCost - info.cards;
      return { info: info, pct: info.unlockCost ? info.cards / info.unlockCost : 0,
               rot: info.cards + ' / ' + info.unlockCost + tr(' para liberar'),
               faz: (f === 1
                 ? tr('Junte <b>{unlockCost}</b> cartas para liberar {nome}. Falta <b>{f}</b>.', { unlockCost: info.unlockCost, nome: nome, f: f })
                 : tr('Junte <b>{unlockCost}</b> cartas para liberar {nome}. Faltam <b>{f}</b>.', { unlockCost: info.unlockCost, nome: nome, f: f })) };
    }
    if (info.next) {
      // 08/10: a estrela se compra à mão — a barra mostra as cartas na mão contra o custo do degrau
      return { info: info, pct: info.next.custo ? Math.min(1, info.cards / info.next.custo) : 0,
               rot: info.cards + ' / ' + info.next.custo + ' para a ★' + info.next.star,
               faz: info.podeSubir
                 ? tr('Já dá: a ★{star} de {nome} custa <b>{custo}</b> cartas — suba na ficha do herói.', { star: info.next.star, nome: nome, custo: info.next.custo })
                 : (info.next.faltam === 1
                   ? tr('Junte mais <b>{faltam}</b> carta para a ★{star} de {nome}.', { faltam: info.next.faltam, star: info.next.star, nome: nome })
                   : tr('Junte mais <b>{faltam}</b> cartas para a ★{star} de {nome}.', { faltam: info.next.faltam, star: info.next.star, nome: nome })) };
    }
    return { info: info, pct: 1, rot: tr('todas as estrelas'), faz: tr('Todas as estrelas de {nome} já foram conquistadas.', { nome: nome }) };
  }
  function cartasDoSaco() {
    return Object.keys(classes()).filter(function (cid) { return cardInfo(cid).cards > 0; })
      .sort(function (a, b) { return String(className(a)).localeCompare(String(className(b))); });
  }
  /* o painel da carta escolhida: o cartão grande, o que ela faz, o progresso e o caminho para a Coleção.
   * Não há botão "usar": a carta conta sozinha na hora em que cai (liberar e subir estrela é automático). */
  function cartaDetalhe(cid) {
    var pr = cartaProgresso(cid), info = pr.info, rar = cartaRaridade(cid);
    var cx = el('div', 'carta-det');
    cx.setAttribute('data-carta', cid);
    cx.appendChild(cartaClasse(cid, 104, '×' + info.cards));
    var t = el('div', 'carta-det-t');
    var h3 = el('h3', null, tr('Carta de {a}', { a: esc(info.name || className(cid)) }));
    var chip = el('span', 'chip carta-det-rar', esc(RAR_PT[rar] || rar));
    chip.style.color = rarColor(rar);
    h3.appendChild(chip);
    t.appendChild(h3);
    var linha = el('div', 'carta-det-tem', (info.unlocked
      ? tr('<b>×{cards}</b> no saco · classe liberada', { cards: info.cards })
      : tr('<b>×{cards}</b> no saco · classe trancada', { cards: info.cards })));
    if (info.stars) linha.appendChild(starRow(info.stars, 14));
    t.appendChild(linha);
    t.appendChild(el('p', 'carta-det-faz', pr.faz));
    t.appendChild(bar('bar-card', pr.pct, pr.rot));
    t.appendChild(el('p', 'carta-det-nota', tr('A classe libera sozinha ao juntar as cartas; a estrela é você quem sobe, gastando cartas, aqui ou na ficha do herói. Cai dos chefes; não se troca nem se vende.')));
    if (info.podeSubir) {
      t.appendChild(btn(tr('★ Subir estrela ({a} cartas)', { a: info.next.custo }), 'btn-mini btn-gold carta-subir', function () {
        subirEstrela(cid, function () { sheetParty('inventario'); });
      }));
    }
    t.appendChild(btn(tr('Ver as estrelas na Coleção'), 'btn-mini', function () { openSheet('collection', cid); }));
    cx.appendChild(t);
    return cx;
  }
  function invFilterTabs() {
    var cont = el('div', 'inv-tabs-container');
    // As abas principais (categorias); os filtros de espaço e elemento viraram os seletores da barra (invSeletores)
    var mTabs = icoFila('inv-tabs-main', INV_CATS.map(function (t) {
      return { id: t.id, ico: t.ico, rot: t.rot, cls: 'btn-tab', data: { cat: t.id } };
    }), invMainTab, function (id) {
      invMainTab = id;
      invSel = null;
      sheetParty('inventario');
    }, true);
    cont.appendChild(mTabs);
    return cont;
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
    var NOME = { hp: tr('PV'), pa: tr('PA'), pp: tr('PP'), power: 'poder',
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
    return tr('contra a vestida ({a}): {b}', { a: esc(atual.name), b: out.join(' · ') });
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
    i2.placeholder = tr('buscar por nome…');
    i2.className = 'inv-busca-campo';
    i2.value = valor || '';
    i2.addEventListener('input', function () { aoTexto(i2.value); });
    w.appendChild(i2);
    return w;
  }

  /* OS BOTÕES REDONDOS (22/09, pedido do dono: "assim fica mais bonito e
   * organizado"): toda aba e todo chip de filtro dos menus de item —
   * inventário, forja, banco, banco da guilda, mercado, troca, caixa do GM —
   * trocou o TEXTO por um ícone redondo (o desenho mora em js/ui/icones_ui.js).
   * O nome não saiu do botão: fica num span escondido (.rot-oculto), no
   * aria-label e no data-rot, e o textContent do botão continua sendo o
   * rótulo antigo letra por letra — as provas que acham "Pedras" ou /^Poções$/
   * pelo texto seguem achando. O nome VISÍVEL é o balão do data-rot (CSS):
   * no mouse aparece no :hover; no toque, no toque LONGO (legendaNoToque).
   * Nada de `title`: no mouse ele abriria um segundo balão, o do sistema, por
   * cima do nosso.
   *
   * icoBotao(icoId, rotulo, ligado, aoTocar, op) -> <button>
   *   op.cls       classes de sempre, que ficam como gancho ('btn-tab', 'bt-elem',
   *                'mc-chip', 'btn-mini')
   *   op.clsTexto  classes SÓ do botão de texto da reserva (a aba acesa dos
   *                mercados era 'btn-gold', a apagada 'btn-ghost')
   *   op.cor       cor do elemento (--ec) · op.rc cor da raridade (--rc) — as
   *                duas acendem o botão na cor dele (.ico-cor)
   *   op.conta     número na pílula do canto (data-conta; "0" some). Vai no
   *                ATRIBUTO e não num span: um span somaria "3" ao textContent
   *                e "Comprar" viraria "Comprar3"
   *   op.data      {chave: valor} -> data-chave="valor" (data-cat, data-slot,
   *                data-el, data-rar, data-ord, data-aba)
   * Sem o icones_ui.js carregado (página que só puxa o hud.js) ou sem desenho
   * para o id, sai o botão de TEXTO de antes, com as mesmas classes menos a
   * btn-ico — nenhum botão fica mudo. */
  function icoBotao(icoId, rotulo, ligado, aoTocar, op) {
    op = op || {};
    var IU = JOGO.IconesUI;
    var svg = safe(function () { return IU.svg(icoId); }, '') || '';
    var temConta = op.conta != null && op.conta !== '';
    var cls = (op.cls || '') + (ligado ? ' is-on' : '');
    var b;
    if (svg) {
      b = btn(svg + '<span class="rot-oculto">' + esc(rotulo) + '</span>',
        'btn-ico ' + cls + ((op.cor || op.rc) ? ' ico-cor' : ''), aoTocar);
      b.setAttribute('data-rot', rotulo);
      // o leitor de tela ouve a conta ("Comprar (3)"); o textContent segue só o rótulo
      b.setAttribute('aria-label', temConta ? rotulo + ' (' + op.conta + ')' : rotulo);
      if (temConta) b.setAttribute('data-conta', String(op.conta));
      legendaNoToque(b);
    } else {
      b = btn(esc(rotulo) + (temConta ? ' (' + esc(op.conta) + ')' : ''),
        cls + (op.clsTexto ? ' ' + op.clsTexto : ''), aoTocar);
    }
    b.setAttribute('aria-pressed', ligado ? 'true' : 'false');
    if (op.cor) b.style.setProperty('--ec', op.cor);
    if (op.rc) b.style.setProperty('--rc', op.rc);
    var dd = op.data || {};
    for (var k in dd) if (dd.hasOwnProperty(k)) b.setAttribute('data-' + k, String(dd[k]));
    return b;
  }

  /* O NOME NO TOQUE LONGO: no celular não há :hover, então segurar o dedo
   * ~0,45 s acende o balão (.is-legenda) por 1,4 s — e o clique que o soltar
   * do dedo dispara é ENGOLIDO na captura, antes do tap() do botão: quem só
   * queria ler o nome não troca de aba sem querer. Soltar antes do tempo é
   * toque comum; o mouse nem entra aqui (ele tem o :hover). */
  var LEGENDA_MS = 450, LEGENDA_FICA_MS = 1400;
  function legendaNoToque(b) {
    var relogio = 0, apaga = 0, engole = false;
    function para() { if (relogio) { clearTimeout(relogio); relogio = 0; } }
    b.addEventListener('pointerdown', function (ev) {
      engole = false;
      para();
      if (ev.pointerType === 'mouse') return;
      relogio = setTimeout(function () {
        relogio = 0;
        engole = true;
        // um balão por vez: o do botão vizinho apaga
        [].forEach.call(document.querySelectorAll('.btn-ico.is-legenda'), function (x) {
          if (x !== b) x.classList.remove('is-legenda');
        });
        b.classList.add('is-legenda');
        clearTimeout(apaga);
        apaga = setTimeout(function () { b.classList.remove('is-legenda'); }, LEGENDA_FICA_MS);
      }, LEGENDA_MS);
    });
    b.addEventListener('pointerup', para);
    b.addEventListener('pointercancel', para);
    b.addEventListener('pointerleave', para);
    // o dedo que saiu do botão não solta clique; a tecla (Enter/espaço) não
    // pode ser engolida por um toque longo de antes
    b.addEventListener('keydown', function () { engole = false; });
    b.addEventListener('click', function (ev) {
      if (!engole) return;
      engole = false;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }, true);
    // o toque longo abriria o menu do sistema (copiar/abrir) por cima do balão
    b.addEventListener('contextmenu', function (ev) {
      if (engole || relogio) ev.preventDefault();
    });
  }

  /* Uma FILEIRA de botões redondos, uma escolha acesa:
   *   icoFila(clsExtra, opcoes, atual, aoMudar, comNome) -> div 'inv-tabs ico-fila <clsExtra>'
   *   opcoes = [{id, ico, rot, cls?, clsTexto?, cor?, rc?, conta?, data?}]
   * O toque chama aoMudar(id) — quem chamou guarda o estado e redesenha.
   * `comNome`: as fileiras de ABA (categoria do saco, abas dos mercados e da
   * caixa do GM) escrevem o nome da aberta no fim (span.ico-fila-nome) — no
   * celular não há mouse para perguntar "onde estou?". Os filtros não: a
   * grade e o resumo embaixo já dizem o que o filtro fez. */
  function icoFila(clsExtra, opcoes, atual, aoMudar, comNome) {
    var fila = el('div', 'inv-tabs ico-fila' + (clsExtra ? ' ' + clsExtra : ''));
    fila.setAttribute('role', 'group');
    var aberta = null;
    opcoes.forEach(function (o) {
      var b = icoBotao(o.ico, o.rot, atual === o.id, function () { aoMudar(o.id); }, o);
      if (atual === o.id) aberta = { b: b, rot: o.rot };
      fila.appendChild(b);
    });
    if (comNome && aberta && aberta.b.classList.contains('btn-ico')) {
      fila.appendChild(el('span', 'ico-fila-nome', esc(aberta.rot)));
    }
    return fila;
  }

  /* A fileira dos ESPAÇOS (Tudo · Punho · Passo · Casca · Lume) — a mesma
   * no inventário, na forja, nos dois bancos e na troca. */
  var SLOT_FILTROS = ['todos'].concat(SLOTS);
  function slotOpcoes(cls) {
    return SLOT_FILTROS.map(function (s) {
      return { id: s, ico: 'slot-' + s, rot: s === 'todos' ? tr('Tudo') : SLOT_PT[s],
               cls: cls, data: { slot: s } };
    });
  }
  function slotTabs(atual, aoMudar) {
    return icoFila('slot-tabs', slotOpcoes('btn-tab'), atual, aoMudar);
  }
  function passaSlot(itemId, filtro) {
    return filtro === 'todos' || slotOf(itemId) === filtro;
  }

  /* A fileira dos ELEMENTOS (pedido 25/08: "nos menus onde aparecem os itens
   * precisa ter uma forma de filtrar por elemento"): filtra qualquer grade
   * de itens pelo elemento da peça — inventário, forja e os bancos usam a
   * mesma. Cada botão acende com a cor do próprio elemento; o "Todos" é o
   * anel das cinco tintas. (22/09: virou ícone; a assinatura é a de sempre.) */
  var ELEM_FILTROS = ['todos', 'fogo', 'agua', 'terra', 'ar', 'neutro'];
  function elemOpcoes(cls) {
    return ELEM_FILTROS.map(function (e2) {
      return { id: e2, ico: 'el-' + e2, rot: e2 === 'todos' ? tr('Todos') : ELEM_PT[e2],
               cls: cls, cor: e2 === 'todos' ? null : elemColor(e2), data: { el: e2 } };
    });
  }
  function elemTabs(atual, aoMudar) {
    return icoFila('elem-tabs', elemOpcoes('btn-tab bt-elem'), atual, aoMudar);
  }
  /* O elemento de uma peça OU de uma pedra. 22/09: a pedra não é item — o
   * itemDef dela dava null e TODA pedra caía em "neutro" (Fogo não mostrava
   * nenhuma, Neutro mostrava as seis). A Âncora de Forja é do elemento
   * 'forja': só aparece em "Todos". */
  function elementoDe(id) {
    var it = itemDef(id);
    if (it) return it.element || 'neutro';
    var sd = stoneDefs()[id];
    if (sd) return sd.element || 'neutro';
    return 'neutro';
  }
  function passaElemento(itemId, filtro) {
    return filtro === 'todos' || elementoDe(itemId) === filtro;
  }
  /* As duas fileiras de filtro lado a lado (espaço | elemento): numa tela
   * larga dividem uma linha, no celular a de elementos desce sozinha. */
  function filtrosDeItem(slotAtual, aoSlot, elemAtual, aoElem) {
    var w = el('div', 'ico-filtros');
    if (aoSlot) w.appendChild(slotTabs(slotAtual, aoSlot));
    if (aoElem) w.appendChild(elemTabs(elemAtual, aoElem));
    return w;
  }

  // ---- A GRADE. Iguais empilham num espaço só, com ×N.
  /* Quantas casas a grade mostra no mínimo. Doze colunas cabem em tela larga e
   * seis em celular, então 48 fecha fileira nos dois. */
  var INV_CELULAS_MIN = 48;

  function invGrid(hid) {
    var grid = el('div', 'inv-big');
    var mostrou = 0;
    
    if (invMainTab === 'equip') {
      var pilhas = safe(function () { return P().invStacks(); }, []);
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
      pilhas.forEach(function (pilha) {
        var canon = slotOf(pilha.itemId);
        if (invFilter !== 'todos' && canon !== invFilter) return;
        if (!passaElemento(pilha.itemId, invElemFiltro)) return;
        mostrou++;
        var it = itemDef(pilha.itemId);
        var sel = invSel && invSel.itemId === pilha.itemId && invSel.level === pilha.level &&
                  invSel.stars === pilha.stars && (invSel.extra || null) === (pilha.extra || null);
        var cell = el('button', 'ig-cell ' + starClass(pilha.stars) + (sel ? ' is-sel' : ''));
        cell.type = 'button';
        markRarity(cell, it.rarity);
        marcaTranca(cell, hid, pilha.itemId);
        cell.setAttribute('data-rot', it.name);     // 08/10 à noite: a grade compacta esconde o nome; fica no balão
        legendaNoToque(cell);
        var plate = el('span', 'ig-plate');
        plate.appendChild(art('itemIcon', [pilha.itemId, INV_ICONE], INV_ICONE));
        var bs1 = setBadge(pilha.itemId);
        if (bs1) plate.appendChild(bs1);
        cell.appendChild(plate);
        if (pilha.count > 1) cell.appendChild(el('span', 'ig-n', '×' + pilha.count));
        if (pilha.level) cell.appendChild(el('span', 'ig-lv', '+' + pilha.level));
        if (pilha.extra) cell.appendChild(el('span', 'ig-gema', '◆'));     // 08/10: a Gema engastada
        if (pilha.stars) cell.appendChild(starPips(pilha.stars));
        cell.appendChild(el('span', 'ig-nm', esc(it.name)));
        var nvG = nvBadge(pilha.itemId);
        if (nvG) cell.appendChild(nvG);
        tap(cell, function () {
          invSel = sel ? null : { itemId: pilha.itemId, level: pilha.level, stars: pilha.stars, extra: pilha.extra || null };
          sheetParty('inventario');
        });
        grid.appendChild(cell);
      });
    } else if (invMainTab === 'pedras') {
      var defs = stoneDefs();
      var ks = Object.keys(defs).sort();
      ks.forEach(function (k) {
        var n = stoneCount(k);
        if (n <= 0) return;
        if (!passaElemento(k, invElemFiltro)) return;
        mostrou++;
        var cell = el('button', 'ig-cell is-pedra');
        cell.type = 'button';
        var plate = el('span', 'ig-plate');
        plate.appendChild(art('stoneIcon', [k, INV_ICONE], INV_ICONE));
        cell.appendChild(plate);
        cell.appendChild(el('span', 'ig-n', String(n)));
        cell.appendChild(el('span', 'ig-nm', esc(defs[k].name)));
        if (invSel && invSel.tipo === 'pedra' && invSel.id === k) cell.classList.add('is-sel');
        tap(cell, function () {
          // 08/10 à noite: a ficha de baixo diz o que é (e que o Mercadinho vende o que sobra)
          invSel = (invSel && invSel.tipo === 'pedra' && invSel.id === k) ? null : { tipo: 'pedra', id: k };
          sheetParty('inventario');
        });
        grid.appendChild(cell);
      });
    } else if (invMainTab === 'cons') {
      // 13/09: as POÇÕES DE VIDA da banca do mercador — contador por tipo, bebidas fora da batalha (14/09)
      var consD = D().consumiveis || {};
      Object.keys(consD).sort(function (a, b) { return (consD[a].cura || 0) - (consD[b].cura || 0); }).forEach(function (pid) {
        var nP = safe(function () { return P().consumivelVer(pid); }, 0) || 0;
        if (nP <= 0) return;
        var dP = consD[pid];
        mostrou++;
        var cP = el('button', 'ig-cell is-cons is-pocao');
        cP.type = 'button';
        cP.setAttribute('data-pocao', pid);
        var plP = el('span', 'ig-plate');
        plP.appendChild(art('pocaoIcon', [pid, INV_ICONE], INV_ICONE));
        cP.appendChild(plP);
        cP.appendChild(el('span', 'ig-n', '×' + nP));
        cP.appendChild(el('span', 'ig-nm', esc(dP.name)));
        cP.appendChild(el('span', 'ig-cura', tr('cura {cura} PV', { cura: dP.cura })));
        if (invSel && invSel.tipo === 'pocao' && invSel.id === pid) cP.classList.add('is-sel');
        tap(cP, function () {
          invSel = (invSel && invSel.tipo === 'pocao' && invSel.id === pid) ? null : { tipo: 'pocao', id: pid };
          sheetParty('inventario');
        });
        grid.appendChild(cP);
      });
      var pg = safe(function () { return P().pergaminhos(); }, null) || {};
      if (pg.xp) {
        mostrou++;
        var cxp = el('button', 'ig-cell is-cons');
        cxp.type = 'button';
        var plateXp = el('span', 'ig-plate');
        plateXp.appendChild(el('span', 'perg-glifo ig-perg', '❦'));
        cxp.appendChild(plateXp);
        cxp.appendChild(el('span', 'ig-n', '×' + pg.xp));
        cxp.appendChild(el('span', 'ig-nm', tr('Pergaminho da Sabedoria')));
        if (invSel && invSel.tipo === 'perg' && invSel.id === 'xp') cxp.classList.add('is-sel');
        tap(cxp, function () { invSel = (invSel && invSel.tipo === 'perg' && invSel.id === 'xp') ? null : { tipo: 'perg', id: 'xp' }; sheetParty('inventario'); });
        grid.appendChild(cxp);
      }
      if (pg.elemento) {
        mostrou++;
        var cel = el('button', 'ig-cell is-cons');
        cel.type = 'button';
        var plateEl = el('span', 'ig-plate');
        plateEl.appendChild(el('span', 'perg-glifo ig-perg', '↺'));
        cel.appendChild(plateEl);
        cel.appendChild(el('span', 'ig-n', '×' + pg.elemento));
        cel.appendChild(el('span', 'ig-nm', tr('Pergaminho da Reescrita')));
        if (invSel && invSel.tipo === 'perg' && invSel.id === 'elemento') cel.classList.add('is-sel');
        tap(cel, function () { invSel = (invSel && invSel.tipo === 'perg' && invSel.id === 'elemento') ? null : { tipo: 'perg', id: 'elemento' }; sheetParty('inventario'); });
        grid.appendChild(cel);
      }
    } else if (invMainTab === 'cartas') {
      // 04/10: uma pilha por classe — o cartão com o retrato, ×N e o risco do progresso
      var cids = cartasDoSaco();
      if (invCartaSel && cids.indexOf(invCartaSel) < 0) invCartaSel = null;
      if (invCartaSel && !(invSel && invSel.tipo === 'carta')) invSel = { tipo: 'carta', id: invCartaSel };
      cids.forEach(function (cid) {
        mostrou++;
        var pr = cartaProgresso(cid);
        var cc = el('button', 'ig-cell is-carta' + (invCartaSel === cid ? ' is-sel' : ''));
        cc.type = 'button';
        cc.setAttribute('data-carta', cid);
        markRarity(cc, cartaRaridade(cid));
        var plateC = el('span', 'ig-plate');
        plateC.appendChild(cartaClasse(cid, INV_ICONE));
        cc.appendChild(plateC);
        cc.appendChild(el('span', 'ig-n', '×' + pr.info.cards));
        cc.appendChild(el('span', 'ig-nm', esc(pr.info.name || className(cid))));
        var risco = el('span', 'ig-prog');
        var cheio = el('i');
        cheio.style.width = Math.round(Math.max(0, Math.min(1, pr.pct)) * 100) + '%';
        risco.appendChild(cheio);
        risco.title = pr.rot;
        cc.appendChild(risco);
        tap(cc, function () {
          invCartaSel = (invCartaSel === cid) ? null : cid;
          invSel = invCartaSel ? { tipo: 'carta', id: cid } : null;     // 08/10 à noite: a carta abre na ficha de baixo
          sheetParty('inventario');
        });
        grid.appendChild(cc);
      });
    } else if (invMainTab === 'pets') {
      var pets = safe(function () { return P().state.pets || []; }, []);
      var pdefs = D().pets || {};
      // agrupar pets iguais para não encher a tela (mostrar quantidade)
      var pmap = {};
      pets.forEach(function (pid) { pmap[pid] = (pmap[pid] || 0) + 1; });
      var pks = Object.keys(pmap).sort(function (a, b) {
        return String((pdefs[a]||{}).name).localeCompare(String((pdefs[b]||{}).name));
      });
      pks.forEach(function (pid) {
        mostrou++;
        var pdef = pdefs[pid];
        var n = pmap[pid];
        var cp = el('button', 'ig-cell is-pet');
        cp.type = 'button';
        markRarity(cp, 'epic');
        var plateP = el('span', 'ig-plate');
        plateP.appendChild(art('petIcon', [pid, INV_ICONE], INV_ICONE));
        cp.appendChild(plateP);
        if (n > 1) cp.appendChild(el('span', 'ig-n', '×' + n));
        cp.appendChild(el('span', 'ig-nm', esc(pdef ? pdef.name : pid)));
        if (invSel && invSel.tipo === 'pet' && invSel.id === pid) cp.classList.add('is-sel');
        tap(cp, function () {
          invSel = (invSel && invSel.tipo === 'pet' && invSel.id === pid) ? null : { tipo: 'pet', id: pid };
          sheetParty('inventario');
        });
        grid.appendChild(cp);
      });
    }

    // ---- GRADE FIXA (pedido do usuário, com uma foto de referência na mão)
    // Antes a grade desenhava UMA célula por pilha existente, então ela encolhia
    // e crescia conforme o saco: com três itens virava uma tirinha de três
    // quadrados, e a tela inteira dançava a cada peça equipada. Na referência a grade
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
      grid.dataset.vazio = (invMainTab === 'pedras' && invElemFiltro !== 'todos')
        ? tr('Nenhuma pedra de {a} no saco.', { a: ELEM_PT[invElemFiltro] || invElemFiltro })
        : invMainTab === 'cartas'
        ? tr('Nenhuma carta de personagem ainda. Elas caem dos chefes: juntando o bastante, liberam a classe e sobem as estrelas dela.')
        : invMainTab !== 'equip'
        ? tr('Nenhum item desta categoria no momento.')
        : invElemFiltro !== 'todos'
          ? tr('Nada de {a}{b} no saco.', { a: ELEM_PT[invElemFiltro] || invElemFiltro, b: invFilter !== 'todos' ? ' ' + tr('em {a}', { a: SLOT_PT[invFilter] }) : '' })
          : vestidas
            ? (invFilter === 'todos'
                ? tr('Tudo o que você tem já está vestido.')
                : tr('Nenhuma peça de {a} no saco.', { a: SLOT_PT[invFilter] }))
            : tr('Saco vazio. Os calabouços resolvem isso.');
    }
    grid.dataset.cheio = tr('{mostrou} de {alvo}', { mostrou: mostrou, alvo: alvo });
    return grid;
  }

  /* O PAINEL DO CONJUNTO: cada peça com sua situação (vestida / no saco /
   * faltando, com o ícone) e os degraus de bônus 2/3/4 — os que já valem
   * levam ✓. Os ícones entram por toDataURL porque o tooltip é innerHTML. */
  function setTipBody(setId) {
    var sd = setDef(setId);
    if (!sd) return tr('Conjunto {a}', { a: esc(setId) }) + '.';
    var n = setEquippedCount(setId);
    var out = '<i>' + tr('{a} · {n}/{b} vestidas', { a: esc(ELEM_PT[sd.element] || sd.element || ''), n: n, b: setPieceCount(setId) }) + '</i>';
    out += '<span class="tip-set-pcs">';
    (sd.pieces || []).forEach(function (pid) {
      var pit = itemDef(pid) || {};
      var vest = !!equippedBy(pid);
      var saco = !vest && bagCountOf(pid) > 0;
      var url = safe(function () { return A().itemIcon(pid, 22).toDataURL(); }, '');
      out += '<em class="tip-set-pc ' + (vest ? 'is-vest' : (saco ? 'is-saco' : 'is-falta')) + '">' +
             (url ? '<img src="' + url + '" alt="">' : '') + esc(pit.name || pid) +
             '<b>' + (vest ? 'vestida' : (saco ? tr('no saco') : 'faltando')) + '</b></em>';
    });
    out += '</span>';
    var b = sd.bonuses || {};
    ['2', '3', '4'].forEach(function (k) {
      if (!b[k]) return;
      var vale = n >= +k;
      out += '<br>' + tr('{a}{k} peças: {b}', { a: vale ? '<b>' : '', k: k, b: esc(bonusText(b[k])) });
      if (b[k].grantsSpell) {
        var sp = spellDef(b[k].grantsSpell);
        out += ' ' + tr('+ feitiço {a}', { a: esc(spellName(sp, b[k].grantsSpell)) });
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
      out.push({ kind: 'bag', itemId: s.itemId, level: s.level, stars: s.stars, extra: s.extra || null,
                 count: s.count, index: s.index, quem: null });
    });
    partyHeroes().forEach(function (hid) {
      SLOTS.forEach(function (canon) {
        var v = safe(function () { return P().equippedVar(hid, slotRaw(canon)); }, null);
        if (!v || !itemDef(v.itemId)) return;
        out.push({ kind: 'worn', itemId: v.itemId, level: v.level, stars: v.stars, extra: v.extra || null,
                   count: 1, heroId: hid, slot: canon, quem: hid });
      });
    });
    return out;
  }
  function mesmoAlvo(a, b) {
    if (!a || !b || a.kind !== b.kind || a.itemId !== b.itemId) return false;
    if (a.kind === 'worn') return a.heroId === b.heroId && a.slot === b.slot;
    return a.level === b.level && a.stars === b.stars && (a.extra || null) === (b.extra || null);
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

  /* A BANCADA DE ARRASTAR (03/09, pedido do dono: "o usuário arrasta seu
   * item para um local e seleciona a pedra que deseja fazer o craft"). Três
   * encaixes — a PEÇA, a PEDRA e o RESULTADO — no alto da Forja; a peça vem
   * arrastada da grade (ou tocada, no celular), a pedra vem arrastada ou
   * tocada na prateleira. A bancada diz o que falta em cada passo: sem peça,
   * sem pedra, pedra errada, pedras a menos, risco — e só então o martelo.
   * A Âncora de Forja não entra no encaixe: tocá-la na prateleira liga/desliga
   * "vai junto" (ela segura o nível numa batida arriscada). */
  var forjaPedra = null;           // a pedra escolhida na bancada (id da pedra)
  function forgeBody(body, preselect) {
    var defs = stoneDefs(), k;
    var up = upgradeCfg();
    var maxLv = up.maxLevel || 10;
    var anchorId = up.guardStone || 'stone-anchor';
    var alvos = forgeAlvos();
    if (preselect && typeof preselect === 'object') forgeTarget = preselect;
    var atual = null, i;
    for (i = 0; i < alvos.length; i++) if (mesmoAlvo(alvos[i], forgeTarget)) { atual = alvos[i]; break; }
    forgeTarget = atual;                       // pode ser null: bancada vazia
    var it2 = atual ? itemDef(atual.itemId) : null;
    var lv2 = atual ? atual.level : 0;
    var info = atual ? forgeInfoDe(atual) : null;
    var pedraCerta = (info && !info.maxed) ? info.stoneId : null;
    var sdCerta = pedraCerta ? defs[pedraCerta] : null;
    if (forjaPedra && !defs[forjaPedra]) forjaPedra = null;
    /* 10/10 (o dono, com a foto da forja dizendo "Pedra errada: Lasca da Lousa…": "não deve nem aparecer a lasca
     * ali na forja, pra evitar confusão"). Com uma peça na bancada, a pedra que serve é UMA só — então ela já
     * vai escolhida, e a prateleira (abaixo) mostra só ela e a Âncora. Uma pedra de outro elemento que tinha
     * ficado escolhida de uma peça anterior sai sozinha: a "pedra errada" deixa de existir como estado. */
    if (pedraCerta && forjaPedra !== pedraCerta) forjaPedra = pedraCerta;

    function dados(e) {
      try { return JSON.parse(e.dataTransfer.getData('text/plain') || 'null'); } catch (err) { return null; }
    }
    function aceitaDrop(slot, tipoEsperado, aoCair) {
      slot.addEventListener('dragover', function (e) { e.preventDefault(); slot.classList.add('is-over'); });
      slot.addEventListener('dragleave', function () { slot.classList.remove('is-over'); });
      slot.addEventListener('drop', function (e) {
        e.preventDefault(); slot.classList.remove('is-over');
        var d = dados(e);
        if (!d || d.tipo !== tipoEsperado) return;
        aoCair(d);
      });
    }
    function arrastavel(node, carga) {
      node.setAttribute('draggable', 'true');
      node.addEventListener('dragstart', function (e) {
        try { e.dataTransfer.setData('text/plain', JSON.stringify(carga)); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
        node.classList.add('is-dragging');
      });
      node.addEventListener('dragend', function () { node.classList.remove('is-dragging'); });
    }
    function escolhePedra(id) {
      if (id === anchorId) {
        // a Âncora não é a pedra da batida: ela VAI JUNTO
        forjaComGuarda = !forjaComGuarda;
        toast(forjaComGuarda ? tr('A Âncora de Forja vai junto na próxima batida.') : tr('A Âncora fica na prateleira.'));
      } else {
        forjaPedra = (forjaPedra === id) ? null : id;
      }
      sheetParty('forja');
    }

    /* ===== OS DOIS MODOS (22/09): Forjar | Quebrar, redondos, no alto da ficha.
     * A bancada de FORJAR é a de sempre (03/09) e mora numa função só para o
     * modo Quebrar poder trocá-la pela dele; a prateleira e a grade embaixo
     * são das duas, com o que muda marcado por `quebra`. */
    var quebra = forjaModo === 'quebrar';
    var gemaModo = forjaModo === 'gema';          // 08/10: a terceira porta — a Gema Enterrada
    body.appendChild(forjaModos());
    if (quebra) quebraBancada(body, atual, alvos, aceitaDrop);
    else if (gemaModo) gemaBancada(body, atual, alvos, aceitaDrop);
    else bancadaDeForjar();

    // ===== A BANCADA (de forjar)
    function bancadaDeForjar() {
      var banca = el('div', 'forge-banca2' + (atual ? ' ' + tierClass(lv2) : ''));

      var sPeca = el('div', 'fg-slot fg-slot-peca' + (atual ? ' has' : ''));
      if (atual) {
        sPeca.appendChild(art('itemIcon', [atual.itemId, 56], 56));
        sPeca.appendChild(el('b', null, esc((it2 && it2.name) || atual.itemId) + (lv2 ? ' +' + lv2 : '')));
        sPeca.appendChild(el('span', null, (atual.stars ? '★' + atual.stars + ' · ' : '') +
          esc(tierNome(lv2)) + (atual.kind === 'worn'
            ? ' ' + tr('· vestida por {a}', { a: esc(className((hero(atual.heroId) || {}).classId || atual.heroId)) })
            : ' ' + tr('· no saco{a}', { a: atual.count > 1 ? ' ×' + atual.count : '' }))));
        tap(sPeca, function () { forgeTarget = null; sheetParty('forja'); });
        tipOn(sPeca, tr('A peça na bancada'), tr('Toque para tirar da bancada. Arraste outra da grade para trocar.'), '#e8c25a');
      } else {
        sPeca.appendChild(el('span', 'fg-slot-ic', '⤓'));
        sPeca.appendChild(el('b', null, tr('A peça')));
        sPeca.appendChild(el('span', null, tr('arraste da grade — ou toque numa')));
      }
      aceitaDrop(sPeca, 'peca', function (d) {
        var alvo = alvos[d.idx];
        if (!alvo) return;
        forgeTarget = alvo; sheetParty('forja');
      });
      banca.appendChild(sPeca);

      var mais = el('span', 'fg-op', '+');
      banca.appendChild(mais);

      var errada = !!(forjaPedra && pedraCerta && forjaPedra !== pedraCerta);
      var sPedra = el('div', 'fg-slot fg-slot-pedra' + (forjaPedra ? ' has' : '') + (errada ? ' is-errada' : ''));
      if (forjaPedra) {
        var sdE = defs[forjaPedra] || {};
        var temN = stoneCount(forjaPedra);
        sPedra.appendChild(art('stoneIcon', [forjaPedra, 56], 56));
        sPedra.appendChild(el('b', null, esc(sdE.name || forjaPedra)));
        sPedra.appendChild(el('span', null, (info && !info.maxed && !errada)
          ? '<b>' + temN + ' / ' + info.custo + tr('</b> para esta batida')
          : tr('{temN} na prateleira', { temN: temN })));
        tap(sPedra, function () { forjaPedra = null; sheetParty('forja'); });
        tipOn(sPedra, tr('A pedra na bancada'), tr('Toque para devolver à prateleira.'), '#e8c25a');
      } else {
        sPedra.appendChild(el('span', 'fg-slot-ic', '◈'));
        sPedra.appendChild(el('b', null, tr('A pedra')));
        sPedra.appendChild(el('span', null, sdCerta
          ? tr('esta peça pede <b>{a}</b>', { a: esc(sdCerta.name) })
          : tr('toque ou arraste da prateleira')));
      }
      aceitaDrop(sPedra, 'pedra', function (d) { escolhePedra(d.id); });
      banca.appendChild(sPedra);

      var seta = el('span', 'fg-op fg-seta', '→');
      banca.appendChild(seta);

      var sRes = el('div', 'fg-slot fg-slot-res' + (atual && info && !info.maxed ? ' has' : ''));
      if (atual && info && !info.maxed) {
        sRes.appendChild(art('itemIcon', [atual.itemId, 56], 56));
        sRes.appendChild(el('b', null, '+' + (lv2 + 1) + ' ' + esc(tierNome(lv2 + 1))));
        sRes.appendChild(el('span', null, bonusPreview(it2, lv2 + 1, atual.stars)));
      } else if (atual && info && info.maxed) {
        sRes.appendChild(el('span', 'fg-slot-ic', '✦'));
        sRes.appendChild(el('b', null, tr('No máximo')));
        sRes.appendChild(el('span', null, tr('Magnífico +{maxLv}', { maxLv: maxLv })));
      } else {
        sRes.appendChild(el('span', 'fg-slot-ic', '?'));
        sRes.appendChild(el('b', null, tr('O resultado')));
        sRes.appendChild(el('span', null, tr('aparece aqui')));
      }
      banca.appendChild(sRes);
      body.appendChild(banca);
      // 08/10 à noite: a MESMA ficha do inventário (Efeitos / Condições / Carac.) para a peça na bancada
      if (atual) {
        body.appendChild(fichaItem({ itemId: atual.itemId, level: lv2, stars: atual.stars || 0, extra: atual.extra || null,
                                     count: atual.count, index: atual.kind === 'bag' ? atual.index : undefined,
                                     vestida: atual.kind === 'worn', heroId: atual.heroId || null },
                                   { hid: atual.kind === 'worn' ? atual.heroId : ensurePartyHero(), compacto: true }));
      }

      // a trilha de níveis e o estado da bancada
      if (atual) {
        var track = el('div', 'forge-track');
        for (var i3 = 0; i3 <= maxLv; i3++) {
          track.appendChild(el('i', 'fg-step ' + tierClass(i3) + (i3 <= lv2 ? ' is-on' : '') + (i3 === lv2 + 1 ? ' is-next' : '')));
        }
        body.appendChild(track);
      }
      var estado = el('div', 'fg-estado');
      var pronto = false, usarG = false;
      if (!atual) {
        estado.appendChild(el('p', 'inv-dica', tr('Ponha uma peça na bancada: arraste da grade abaixo ou toque nela.')));
      } else if (!info) {
        estado.appendChild(el('p', 'empty', tr('A forja ainda não está disponível.')));
      } else if (info.maxed) {
        estado.appendChild(el('p', 'forge-max', tr('No máximo: <b>Magnífico +{maxLv}</b>. Esta peça não sobe mais.', { maxLv: maxLv })));
      } else if (!forjaPedra) {
        estado.appendChild(el('p', 'inv-dica', tr('Agora a pedra: esta peça pede <b>{a}</b>{b} — está acesa na prateleira. Você tem <b>{c}</b>, a batida leva <b>{custo}</b>.', { a: esc((sdCerta || {}).name || pedraCerta), b: sdCerta ? ' (' + esc(ELEM_PT[sdCerta.element] || sdCerta.element) + ')' : '', c: stoneCount(pedraCerta), custo: info.custo })));
      } else if (errada) {
        var sdX = defs[forjaPedra] || {};
        estado.appendChild(el('p', 'forge-short', tr('Pedra errada: <b>{a}</b> é de {b}; esta peça pede <b>{c}</b>.', { a: esc(sdX.name || forjaPedra), b: esc(ELEM_PT[sdX.element] || sdX.element || '?'), c: esc((sdCerta || {}).name || pedraCerta) })));
      } else if (!info.temPedras) {
        estado.appendChild(el('p', 'forge-short', tr('Faltam <b>{a}</b> de <b>{b}</b>. Monstros de {c} derrubam.', { a: info.custo - stoneCount(pedraCerta), b: esc((sdCerta || {}).name || pedraCerta), c: esc(ELEM_PT[(sdCerta || {}).element] || '') })));
      } else {
        pronto = true;
        usarG = !!(info.arriscado && forjaComGuarda && info.guardas > 0);
        if (info.arriscado) {
          var pct = Math.round(info.chance * 100);
          estado.appendChild(el('p', 'forge-risco', tr('Batida arriscada: <b>{pct}%</b> de subir — falhou, {a}{b}', { pct: pct, a: usarG ? tr('a <b>Âncora segura</b> em +{lv2}.', { lv2: lv2 }) : tr('a peça <b>volta para +{a}</b>.', { a: Math.max(0, lv2 - 1) }), b: info.guardas > 0 ? (usarG ? tr(' <i>(Âncora junto — toque nela para tirar)</i>') : ' <i>' + tr('Toque na Âncora da prateleira para levá-la junto ({guardas} no saco).', { guardas: info.guardas }) + '</i>')
                              : tr(' <i>Sem Âncora no saco — só os chefes mais fundos derrubam.</i>') })));
        } else {
          estado.appendChild(el('p', 'inv-dica', tr('Batida segura: <b>{a}</b> {b} na prateleira, a batida leva <b>{custo}</b>.', { a: stoneCount(pedraCerta), b: esc((sdCerta || {}).name || pedraCerta), custo: info.custo })));
        }
      }
      body.appendChild(estado);
      if (atual && info && !info.maxed) {
        var go = btn(tr('🔨 Bater o martelo — vira +{a}', { a: lv2 + 1 }), 'btn-primary btn-block' + (pronto ? '' : ' is-off'), function () {
          if (!pronto) { toast(!forjaPedra ? tr('Escolha a pedra primeiro.') : (errada ? tr('Essa não é a pedra desta peça.') : tr('Pedras insuficientes.'))); return; }
          // 13/09 (a segurança): com sessão do site a batida é sorteada NO SERVIDOR
          var AutF = JOGO.Autoridade;
          if (AutF && AutF.ligada && AutF.ligada()) {
            var opF = atual.kind === 'worn'
              ? AutF.opAgora('forjarVestida', { heroId: atual.heroId, slot: slotRaw(atual.slot), usarGuarda: !!usarG })
              : AutF.opAgora('forjarPeca', { invIndex: atual.index, usarGuarda: !!usarG });
            opF.then(function (res) {
              if (!res.ok) { toast(res.erro || tr('O servidor não forjou agora.')); return; }
              mostraForja(res.resultado);
            });
            return;
          }
          mostraForja(forjar(atual, usarG));
          function mostraForja(fim) {
          if (fim) {
            var nivelNovo = (typeof fim === 'object') ? fim.nivel : lv2 + 1;
            var como = (typeof fim === 'object') ? fim.resultado : 'subiu';
            if (como === 'subiu') toast(tr('Forjado: +{nivel} {grau}!', { nivel: nivelNovo, grau: tierNome(nivelNovo) }), 'good');
            else if (como === 'segurou') toast(tr('A batida falhou — a Âncora segurou em +{nivelNovo}.', { nivelNovo: nivelNovo }), 'good');
            else toast(tr('A batida falhou: a peça voltou para +{nivelNovo}.', { nivelNovo: nivelNovo }));
            forgeTarget = { kind: atual.kind, itemId: atual.itemId, level: nivelNovo, stars: atual.stars,
                            heroId: atual.heroId, slot: atual.slot };
            if (invSel && invSel.itemId === atual.itemId && invSel.level === lv2 &&
                invSel.stars === atual.stars && atual.kind === 'bag') {
              invSel = { itemId: atual.itemId, level: nivelNovo, stars: atual.stars };
            }
            sheetParty('forja');
          } else toast(tr('Pedras insuficientes.'));
          }
        });
        body.appendChild(go);
      }
    }

    // ===== A PRATELEIRA: as pedras, arrastáveis; a certa acesa; a Âncora liga/desliga.
    // No Quebrar ela só MOSTRA — não há pedra a escolher: acende a pedra em que
    // a peça da bancada vira (is-destino, na cor do elemento) e o toque abre a
    // descrição. Fica nos dois modos: é aqui que se vê o monte crescer.
    var qDestino = (quebra && atual) ? quebraInfoAlvo(atual, 1) : null;
    var pedraDestino = (qDestino && QUEBRA_NUNCA.indexOf(qDestino.motivo) < 0) ? qDestino.stoneId : null;
    body.appendChild(el('h4', 'fg-grupo', gemaModo ? tr('A gema e os fragmentos') : tr('A prateleira de pedras')));
    var stock = el('div', 'forge-stock');
    for (k in defs) {
      if (!defs.hasOwnProperty(k)) continue;
      // 08/10: a Gema e o Fragmento só aparecem no modo Gema; as pedras de forjar, nos outros dois
      var deForja = k === anchorId || safe(function () { return P().pedraDeForja(k); }, true);
      if (gemaModo ? deForja : !deForja) continue;
      // 10/10: no Forjar, com a peça na bancada, só a pedra dela e a Âncora (as outras confundiam: "pedra errada")
      if (!gemaModo && !quebra && pedraCerta && k !== pedraCerta && k !== anchorId) continue;
      var n = stoneCount(k);
      if (gemaModo) {
        var chipG = el('div', 'stone-chip is-gema' + (n ? '' : ' is-empty'));
        chipG.appendChild(art('stoneIcon', [k, 40], 40));
        chipG.appendChild(el('span', 'stone-n', String(n)));
        chipG.appendChild(el('span', 'stone-nm', esc(defs[k].name)));
        tipOn(chipG, defs[k].name, esc(defs[k].description || ''), elemColor(defs[k].element));
        stock.appendChild(chipG);
        continue;
      }
      var chip = el('div', 'stone-chip' + (n ? '' : ' is-empty') + (quebra
        ? (k === pedraDestino ? ' is-destino' : '')
        : (k === pedraCerta ? ' is-certa' : '') + (k === forjaPedra ? ' is-sel' : '') +
          (k === anchorId && forjaComGuarda ? ' is-sel' : '')));
      chip.appendChild(art('stoneIcon', [k, 40], 40));
      chip.appendChild(el('span', 'stone-n', String(n)));
      if (quebra) {
        chip.style.setProperty('--ec', elemColor(defs[k].element));
        chip.appendChild(el('span', 'stone-nm', esc(defs[k].name)));
        tipOn(chip, defs[k].name, esc(defs[k].description || '') + (k === anchorId
          ? tr('<br><i>Não sai de quebra nenhuma: é a guarda da forja.</i>')
          : '<br><i>' + tr('Vem da quebra das peças de {a}.', { a: esc(ELEM_PT[defs[k].element] || defs[k].element) }) + '</i>'),
          elemColor(defs[k].element));
        stock.appendChild(chip);
        continue;
      }
      chip.appendChild(el('span', 'stone-nm', esc(defs[k].name) + (k === anchorId ? (forjaComGuarda ? tr(' · vai junto') : tr(' · opcional')) : '')));
      tipOn(chip, defs[k].name, esc(defs[k].description || '') +
        (k === anchorId ? tr('<br><i>Toque para levar junto na batida arriscada.</i>') : tr('<br><i>Toque ou arraste para a bancada.</i>')),
        elemColor(defs[k].element));
      if (n) { arrastavel(chip, { tipo: 'pedra', id: k }); }
      (function (id2) { tap(chip, function () { escolhePedra(id2); }); })(k);
      stock.appendChild(chip);
    }
    body.appendChild(stock);

    if (!alvos.length) {
      body.appendChild(el('p', 'empty fg-dir', quebra ? tr('Nenhuma peça no saco para quebrar.')
                                                      : tr('Nenhuma peça para forjar — nem no saco, nem vestida.')));
      return;
    }

    // ===== A GRADE: as peças, arrastáveis para a bancada (toque também põe)
    function celDe(alvo, idx) {
      var it = itemDef(alvo.itemId);
      var marcavel = quebra && forjaVarios && alvo.kind === 'bag';
      var marcada = marcavel && !!forjaMarcadas[chaveDoAlvo(alvo)];
      var c = el('button', 'ig-cell fg-cel ' + starClass(alvo.stars) +
                            (mesmoAlvo(alvo, atual) && !forjaVarios ? ' is-sel' : '') +
                            (marcavel ? ' is-marcavel' : '') + (marcada ? ' is-marcada' : ''));
      if (marcada) c.appendChild(el('i', 'bk2-marca', '✓'));
      c.type = 'button';
      markRarity(c, it.rarity);
      var plate = el('span', 'ig-plate');
      plate.appendChild(art('itemIcon', [alvo.itemId, 44], 44));
      var bs = setBadge(alvo.itemId, true);
      if (bs) plate.appendChild(bs);
      c.appendChild(plate);
      if (alvo.count > 1) c.appendChild(el('span', 'ig-n', '×' + alvo.count));
      if (alvo.level) c.appendChild(el('span', 'ig-lv', '+' + alvo.level));
      if (alvo.extra) c.appendChild(el('span', 'ig-gema', '◆'));     // 08/10: já tem a Gema
      if (alvo.stars) c.appendChild(starPips(alvo.stars));
      var nvF = nvBadge(alvo.itemId);
      if (nvF) c.appendChild(nvF);
      if (alvo.kind === 'worn') {
        c.appendChild(el('span', 'fg-worn',
          esc(className((hero(alvo.heroId) || {}).classId || alvo.heroId).slice(0, 3))));
      }
      c.appendChild(el('span', 'ig-nm', esc(it.name)));
      c.setAttribute('data-rot', it.name);     // 08/10 à noite: a grade compacta esconde o nome; fica no balão
      legendaNoToque(c);
      // no Quebrar, cada célula diz quanto rende UMA cópia (→N, na cor da
      // pedra); a que não se quebra fica apagada com ✕ — o toque ainda a põe
      // na bancada, que diz o porquê
      if (quebra) {
        var qc = quebraInfoAlvo(alvo, 1);
        var rende = el('span', 'fg-rende', (qc && qc.pode) ? '→' + qc.pedras : '✕');
        if (qc && qc.pode) {
          rende.style.setProperty('--ec', elemColor((stoneDefs()[qc.stoneId] || {}).element));
          rende.setAttribute('data-pedra', qc.stoneId);
        } else {
          c.classList.add('is-nao-quebra');
        }
        c.appendChild(rende);
      }
      if (marcavel) {
        // 08/10 à noite: no modo "várias" o toque marca a pilha (a que não se quebra não marca)
        tap(c, function () {
          var qm = quebraInfoAlvo(alvo, 1);
          if (!qm || !qm.pode) { toast(tr('Essa peça não se quebra.')); return; }
          var k = chaveDoAlvo(alvo);
          if (forjaMarcadas[k]) delete forjaMarcadas[k]; else forjaMarcadas[k] = true;
          sheetParty('forja');
        });
        return c;
      }
      arrastavel(c, { tipo: 'peca', idx: idx });
      tap(c, function () {
        if (!mesmoAlvo(alvo, forgeTarget)) forjaQuebraN = 1;
        forgeTarget = alvo;
        sheetParty('forja');
      });
      return c;
    }
    // 08/10 à noite: no Quebrar, o botão do modo "várias" e a barra do golpe em lote (vão para a coluna da direita)
    if (quebra) {
      var modoV = el('div', 'fg-varios fg-dir');
      modoV.appendChild(btn(forjaVarios ? tr('Sair da seleção') : tr('Selecionar várias'), 'btn-mini fg-varios-b' + (forjaVarios ? ' is-on' : ''), function () {
        forjaVarios = !forjaVarios;
        forjaMarcadas = {};
        sheetParty('forja');
      }));
      if (forjaVarios) {
        var marcadosF = [];
        alvos.forEach(function (a2) {
          if (a2.kind !== 'bag') return;
          if (forjaMarcadas[chaveDoAlvo(a2)]) marcadosF.push(a2);
        });
        var somaPedras = {}, nPecas = 0, maxNQ = safe(function () { return P().quebraCfg().maxN; }, 99) || 99;
        marcadosF.forEach(function (a2) {
          var nQ = Math.min(a2.count || 1, maxNQ);
          var qq = quebraInfoAlvo(a2, nQ);
          if (!qq || !qq.pode) return;
          nPecas += nQ;
          somaPedras[qq.stoneId] = (somaPedras[qq.stoneId] || 0) + (qq.total || 0);
        });
        var viramTxt = Object.keys(somaPedras).map(function (sid) { return '<b>' + somaPedras[sid] + ' ' + esc((defs[sid] || {}).name || sid) + '</b>'; }).join(' + ');
        modoV.appendChild(el('span', 'fg-varios-n', marcadosF.length
          ? tr('<b>{a}</b> pilha(s) marcada(s) · <b>{n}</b> peça(s) · viram {b}', { a: marcadosF.length, n: nPecas, b: viramTxt || '—' })
          : tr('Toque nas peças para marcar; todas as cópias da pilha vão juntas.')));
        if (marcadosF.length) {
          modoV.appendChild(btn(forjaQuebrando ? tr('Quebrando…') : tr('Quebrar as {n} marcadas', { n: nPecas }), 'btn-warn btn-mini fg-varios-go' + (forjaQuebrando ? ' is-off' : ''), function () {
            confirmSheet(tr('Quebrar {n} peças?', { n: nPecas }),
              tr('As <b>{n} peças</b> marcadas somem <b>para sempre</b> e viram {b}. Não tem volta.', { n: nPecas, b: viramTxt }),
              function () { quebraVarias(marcadosF); }, { sim: tr('Quebrar'), simCls: 'btn-warn', aoCancelar: function () { sheetParty('forja'); } });
          }));
        }
      }
      body.appendChild(modoV);
    }
    /* o golpe em lote: uma peça de cada vez, de novo achando o índice pela série (o estado do servidor é
     * adotado entre uma e outra, e o índice muda); com sessão do site quem quebra é o servidor */
    function quebraVarias(lista) {
      var AutQ = JOGO.Autoridade, comServidor = !!(AutQ && AutQ.ligada && AutQ.ligada());
      var maxNQ = safe(function () { return P().quebraCfg().maxN; }, 99) || 99;
      var fila = Promise.resolve(), feitas = 0, pedrasTotal = 0;
      forjaQuebrando = true;
      sheetParty('forja');
      lista.forEach(function (a2) {
        fila = fila.then(function () {
          // a pilha não tem série: acha-se a PRIMEIRA cópia dela no saco de agora (o estado pode ter sido adotado)
          var inv = P().state.inventory, idx = -1;
          for (var i3 = 0; i3 < inv.length; i3++) {
            var e3 = inv[i3];
            if (e3 && e3.itemId === a2.itemId && (e3.level || 0) === (a2.level || 0) && (e3.stars || 0) === (a2.stars || 0) &&
                (e3.extra || null) === (a2.extra || null)) { idx = i3; break; }
          }
          if (idx < 0) return null;
          var nQ = Math.min(a2.count || 1, maxNQ);
          var args = { invIndex: idx, n: nQ };
          if (inv[idx].iid) args.iid = inv[idx].iid;
          if (comServidor) {
            return AutQ.opAgora('quebrarPeca', args).then(function (res) {
              if (res && res.ok && res.resultado) { feitas += res.resultado.n || nQ; pedrasTotal += res.resultado.pedras || 0; }
            }, function () { return null; });
          }
          var fim = safe(function () { return P().quebraPeca(idx, nQ, { iid: args.iid || null }); }, false);
          if (fim) { feitas += fim.n || nQ; pedrasTotal += fim.pedras || 0; }
          return null;
        });
      });
      fila.then(function () {
        forjaQuebrando = false;
        forjaMarcadas = {};
        forgeTarget = null;
        toast(feitas ? tr('{n} peça(s) viraram pedra: +{p} pedras na prateleira.', { n: feitas, p: pedrasTotal }) : tr('Nenhuma peça se quebrou.'), feitas ? 'good' : undefined);
        if (sheetName === 'party' && partyTab === 'forja') sheetParty('forja');
      });
    }
    // 22/09: espaço E elemento, redondos — valem para o saco e para as vestidas.
    // O `idx` de cada célula é a posição em `alvos` (a lista INTEIRA): o filtro
    // só esconde, e o arrasto até a bancada continua achando a peça certa.
    var selF = seletoresDeItem(forjaSlotFiltro, function (s) {
      forjaSlotFiltro = s;
      sheetParty('forja');
    }, forjaElemFiltro, function (e2) {
      forjaElemFiltro = e2;
      sheetParty('forja');
    });
    selF.classList.add('fg-dir');
    body.appendChild(selF);
    // No Quebrar só o SACO entra na grade: a vestida não está nele (o Progress
    // nem a alcança) — em vez do grupo, uma linha diz como trazê-la.
    var doSaco = [], vestidas = [], vestidasFora = 0;
    alvos.forEach(function (a, idx) {
      if (!passaSlot(a.itemId, forjaSlotFiltro)) return;
      if (!passaElemento(a.itemId, forjaElemFiltro)) return;
      if (a.kind === 'bag') doSaco.push([a, idx]);
      else if (quebra) vestidasFora++;
      else vestidas.push([a, idx]);
    });
    var paraQue = quebra ? tr('para quebrar') : gemaModo ? tr('para engastar') : tr('para forjar');
    if (!doSaco.length && !vestidas.length) {
      var oQue = [];
      if (forjaSlotFiltro !== 'todos') oQue.push(SLOT_PT[forjaSlotFiltro] || forjaSlotFiltro);
      if (forjaElemFiltro !== 'todos') oQue.push(ELEM_PT[forjaElemFiltro] || forjaElemFiltro);
      body.appendChild(el('p', 'inv-dica fg-dir', oQue.length
        ? tr('Nada de {a} {paraQue} — o filtro está ligado.', { a: esc(oQue.join(' de ')), paraQue: paraQue })
        : tr('Nenhuma peça no saco {paraQue}.', { paraQue: paraQue })));
    }
    [[doSaco, tr('No saco')], [vestidas, tr('Vestidas')]].forEach(function (par) {
      if (!par[0].length) return;
      body.appendChild(el('h4', 'fg-grupo fg-dir', par[1] + ' (' + par[0].length + ')'));
      var grade = el('div', 'forge-pick grade-icones fg-dir' + (quebra ? ' fg-pick-quebra' : ''));
      par[0].forEach(function (pa) { grade.appendChild(celDe(pa[0], pa[1])); });
      body.appendChild(grade);
    });
    if (vestidasFora) {
      body.appendChild(el('p', 'inv-dica fg-vestidas-fora fg-dir', vestidasFora === 1
        ? tr('1 peça vestida não aparece aqui: tire do herói para quebrar.')
        : tr('{vestidasFora} peças vestidas não aparecem aqui: tire do herói para quebrar.', { vestidasFora: vestidasFora })));
    }

    // ===== A ESTRELA (fundir 3 cópias) — a outra trilha, só com peça na bancada
    // (e só no Forjar: no Quebrar a peça vai embora, não sobe; no Gema a bancada é outra)
    if (!atual || quebra || gemaModo) return;
    var ce = el('div', 'forge-card fc-estrela');
    ce.appendChild(el('h4', null, tr('A Estrela<i>3 cópias iguais do saco viram ★ — no nível médio, para baixo</i>')));
    if (atual.kind === 'worn') {
      ce.appendChild(el('p', 'fc-nota', tr('Para fundir, a peça precisa estar no <b>saco</b> — as cópias soltas é que se juntam. Esta está vestida.')));
    } else {
      var fu = safe(function () { return P().fuseInfo(atual.index); }, null);
      if (!fu || fu.maxed) {
        ce.appendChild(el('p', 'fc-nota', atual.stars >= 3
          ? tr('No topo: <b>★3</b>. Daqui não sobe mais.')
          : tr('Esta peça não funde.')));
      } else if (fu.engastada) {
        ce.appendChild(el('p', 'fc-nota', tr('A peça com a <b>Gema engastada</b> não funde: a cópia nova nasceria sem o bônus.')));
      } else if (fu.pode) {
        ce.appendChild(el('p', 'fc-nota', tr('Três cópias no saco: <b>+{a}</b> viram <b>★{proxima} +{nivelResultado}</b>.', { a: fu.niveisEscolhidos.join(' +'), proxima: fu.proxima, nivelResultado: fu.nivelResultado })));
        var prevE = el('div', 'forge-prev');
        prevE.appendChild(el('div', 'fp-col', tr('<i>agora {a}+{lv2}</i>{b}', { a: atual.stars ? '★' + atual.stars + ' ' : '', lv2: lv2, b: bonusPreview(it2, lv2, atual.stars) })));
        prevE.appendChild(el('div', 'fp-arrow', '→'));
        prevE.appendChild(el('div', 'fp-col fp-next', '<i>★' + fu.proxima +
          ' +' + fu.nivelResultado + '</i>' +
          bonusPreview(it2, fu.nivelResultado, fu.proxima)));
        ce.appendChild(prevE);
        ce.appendChild(btn('Fundir → ★' + fu.proxima + ' +' + fu.nivelResultado,
          'btn-gold btn-block', function () {
            var nova = safe(function () { return P().fuseItem(atual.index); }, null);
            if (nova) {
              toast(tr('Fundiu {precisa}: agora é ★{stars} +{level} (a média das três).', { precisa: fu.precisa, stars: nova.stars, level: nova.level }), 'good');
              forgeTarget = { kind: 'bag', itemId: nova.itemId,
                              level: nova.level, stars: nova.stars };
              if (invSel && invSel.itemId === atual.itemId) {
                invSel = { itemId: nova.itemId, level: nova.level, stars: nova.stars };
              }
            }
            sheetParty('forja');
          }));
      } else {
        ce.appendChild(el('p', 'fc-nota', tr('{a} no saco para a ★{proxima}.', { a: fu.faltam > 1
          ? tr('Faltam <b>{faltam}</b> cópias iguais', { faltam: fu.faltam })
          : tr('Falta <b>1</b> cópia igual'), proxima: fu.proxima })));
        var prevF = el('div', 'forge-prev');
        prevF.appendChild(el('div', 'fp-col', tr('<i>agora {a}+{lv2}</i>{b}', { a: atual.stars ? '★' + atual.stars + ' ' : '', lv2: lv2, b: bonusPreview(it2, lv2, atual.stars) })));
        prevF.appendChild(el('div', 'fp-arrow', '→'));
        prevF.appendChild(el('div', 'fp-col fp-next', tr('<i>★{proxima} (no +{lv2})</i>{a}', { proxima: fu.proxima, lv2: lv2, a: bonusPreview(it2, lv2, fu.proxima) })));
        ce.appendChild(prevF);
      }
    }
    body.appendChild(ce);
  }

  // ----------------------------------------------------------------- A QUEBRA
  /* A BANCADA DE QUEBRAR (22/09, pedido do dono: "na forja o jogador poderá
   * quebrar os itens, que darão pedras daquele elemento"). A mesma bancada de
   * arrastar da forja, com dois encaixes — A PEÇA → AS PEDRAS — e os mesmos
   * gestos: arrastar da grade, tocar numa célula, tocar no encaixe para
   * esvaziar. A CONTA é toda do Progress ([D20], quebraInfo); a linha
   * embaixo da bancada só a escreve por partes, para o jogador ver POR QUE a
   * épica +5 vale 83 pedras e a comum 1. Só o SACO se quebra: a vestida
   * explica e não ganha botão. O golpe pergunta antes (a peça some para
   * sempre) e, com sessão do site, quem quebra é o servidor ('quebrarPeca',
   * como a batida do martelo). */
  var FORJA_MODOS = [
    { id: 'forjar', ico: 'fg-forjar', rot: tr('Forjar'), tit: tr('Forjar a peça'),
      sub: tr('a pedra do elemento e o martelo: a peça sobe um degrau') },
    { id: 'quebrar', ico: 'fg-quebrar', rot: tr('Quebrar'), tit: tr('Quebrar a peça em pedras'),
      sub: tr('a peça some e vira pedras do elemento dela') },
    // 08/10 (dono): a Gema Enterrada — um bônus a mais na peça, sorteado: PA, PP, dano ou vida
    { id: 'gema', ico: 'fg-gema', rot: tr('Gema'), tit: tr('Engastar a Gema Enterrada'),
      sub: tr('um bônus a mais na peça: +1 PA, +1 PP, dano ou vida — sorteado') }
  ];
  var MOTIVO_QUEBRA = {
    mestre: tr('Peça do Mestre não se quebra.'),
    'sem-pedra': tr('O elemento desta peça não tem pedra: ela não se quebra.'),
    copias: tr('Não há tantas cópias iguais no saco.'),
    n: tr('Quantidade de cópias inválida.'),
    emprestada: tr('Peça emprestada do banco da guilda: devolva antes de quebrar.')
  };
  // os motivos que são da PEÇA, e não do pedido: esta nunca se quebra
  var QUEBRA_NUNCA = ['mestre', 'sem-pedra'];

  // a fileira dos dois modos, com o nome do aberto escrito ao lado
  function forjaModos() {
    var w = el('div', 'fg-modos');
    w.appendChild(icoFila('fg-modos-fila', FORJA_MODOS.map(function (m) {
      return { id: m.id, ico: m.ico, rot: m.rot, cls: 'btn-tab', data: { modo: m.id } };
    }), forjaModo, function (id) {
      if (id === forjaModo) return;
      forjaModo = id;
      forjaQuebraN = 1;
      sheetParty('forja');
    }));
    var m = FORJA_MODOS[0];
    for (var mi = 0; mi < FORJA_MODOS.length; mi++) if (FORJA_MODOS[mi].id === forjaModo) m = FORJA_MODOS[mi];
    w.appendChild(el('h3', 'fg-modo-tit', esc(m.tit) + '<i>' + esc(m.sub) + '</i>'));
    return w;
  }

  /* A conta de um alvo da forja: a do SACO pelo índice (com as cópias e o
   * total de n); a da VESTIDA pela variante (quebraInfoDe) — só para a tela
   * dizer quanto ela daria no saco, o Progress nunca a quebra. */
  function quebraInfoAlvo(alvo, n) {
    if (!alvo) return null;
    if (alvo.kind === 'bag') return safe(function () { return P().quebraInfo(alvo.index, n); }, null);
    return safe(function () { return P().quebraInfoDe(alvo.itemId, alvo.level, alvo.stars); }, null);
  }

  /* A linha da conta, por partes (todo número vem do Progress):
   *   "Épico 8 × Nv. 30 (×3) × ★1 (×3) = 72 · forja +5 devolve 11 → 83 Brasa Coagulada"
   * O "= subtotal" só entra quando algo multiplicou de verdade; o piso só
   * quando foi ele que valeu; com n cópias o fim diz "× n cópias = total". */
  function quebraContaTxt(q, nomePedra) {
    var p = q.partes || {};
    var txt = esc(RAR_PT[q.rarity] || q.rarity || '') + ' <b>' + p.base + '</b>';
    var multiplicou = false;
    if (q.nivelUso > 0) {
      txt += ' × ' + tr('Nv.') + ' ' + q.nivelUso + ' (×' + p.degrau + ')';
      if (p.degrau > 1) multiplicou = true;
    }
    if (q.stars > 0) {
      txt += ' × ★' + q.stars + ' (×' + p.estrelas + ')';
      multiplicou = true;
    }
    var sub = Math.floor(p.base * p.degrau * p.estrelas);
    if (multiplicou) txt += ' = <b>' + sub + '</b>';
    if (q.level > 0) txt += ' ' + tr('· forja +{level} devolve <b>{forja}</b>', { level: q.level, forja: p.forja });
    if (q.pedras > sub + p.forja) txt += ' ' + tr('· o piso é {pedras}', { pedras: q.pedras });
    txt += ' → <b class="fg-conta-fim">' + q.pedras + ' ' + esc(nomePedra) + '</b>';
    if (q.n > 1) txt += ' ' + tr('× {n} cópias = <b class="fg-conta-fim">{total}</b>', { n: q.n, total: q.total });
    return txt;
  }

  // a recusa do servidor em português — a 'emprestada' vem do juiz (a cópia
  // que a guilda emprestou não sai do saco), o resto como o martelo faz
  function recusaQuebraTxt(res) {
    var erro = (res && res.erro) || '';
    if ((res && res.motivo === 'emprestada') || /emprestad/i.test(erro)) return MOTIVO_QUEBRA.emprestada;
    if (res && res.foraDoAr) return tr('O servidor não respondeu — nada foi quebrado.');
    if (res && res.motivo && MOTIVO_QUEBRA[res.motivo]) return MOTIVO_QUEBRA[res.motivo];
    return erro || tr('O servidor não quebrou agora.');
  }

  function quebraBancada(body, atual, alvos, aceitaDrop) {
    var defs = stoneDefs();
    var it = atual ? itemDef(atual.itemId) : null;
    var lv = atual ? atual.level : 0;
    var vestida = !!(atual && atual.kind === 'worn');
    // a conta de UMA cópia traz quantas iguais há; "todas" pede a de todas
    var q = quebraInfoAlvo(atual, 1);
    var copias = (q && !vestida) ? (q.copias || 1) : 1;
    var maxN = safe(function () { return P().quebraCfg().maxN; }, 99) || 99;
    var todas = Math.min(copias, maxN);
    var n = (forjaQuebraN === 'todas' && todas > 1) ? todas : 1;
    if (n > 1) q = quebraInfoAlvo(atual, n) || q;
    var sd = q ? (defs[q.stoneId] || {}) : {};
    var nomePedra = sd.name || (q && q.stoneId) || '';
    var corPedra = elemColor(sd.element);
    var nunca = !!(q && QUEBRA_NUNCA.indexOf(q.motivo) >= 0);
    var pode = !!(q && q.pode && !vestida);

    // ===== A BANCADA: a peça → as pedras
    var banca = el('div', 'forge-banca2 fg-banca-quebra');
    var sPeca = el('div', 'fg-slot fg-slot-peca' + (atual ? ' has' : '') + ((vestida || nunca) ? ' is-errada' : ''));
    if (atual) {
      sPeca.appendChild(art('itemIcon', [atual.itemId, 56], 56));
      sPeca.appendChild(el('b', null, esc((it && it.name) || atual.itemId) + (lv ? ' +' + lv : '')));
      // aqui vale a RARIDADE (é ela que abre a conta), não o degrau da forja
      var rar = (q && q.rarity) || (it && it.rarity) || '';
      sPeca.appendChild(el('span', null, (atual.stars ? '★' + atual.stars + ' · ' : '') +
        esc(RAR_PT[rar] || rar) + (vestida
          ? ' ' + tr('· vestida por {a}', { a: esc(className((hero(atual.heroId) || {}).classId || atual.heroId)) })
          : ' ' + tr('· no saco{a}', { a: atual.count > 1 ? ' ×' + atual.count : '' }))));
      tap(sPeca, function () { forgeTarget = null; forjaQuebraN = 1; sheetParty('forja'); });
      tipOn(sPeca, tr('A peça na bancada'), tr('Toque para tirar da bancada. Arraste outra da grade para trocar.'), '#e8c25a');
    } else {
      sPeca.appendChild(el('span', 'fg-slot-ic', '⤓'));
      sPeca.appendChild(el('b', null, tr('A peça')));
      sPeca.appendChild(el('span', null, tr('arraste da grade — ou toque numa')));
    }
    aceitaDrop(sPeca, 'peca', function (d) {
      var alvo = alvos[d.idx];
      if (!alvo) return;
      if (!mesmoAlvo(alvo, forgeTarget)) forjaQuebraN = 1;
      forgeTarget = alvo;
      sheetParty('forja');
    });
    banca.appendChild(sPeca);
    banca.appendChild(el('span', 'fg-op fg-seta', '→'));

    // as pedras: o ícone, "×N" e o nome — na cor do elemento. A vestida mostra
    // o que daria (apagada); a que nunca se quebra, o ✕ e o porquê curto.
    var mostraPedra = !!(atual && q && !nunca);
    var vira = q ? (vestida ? q.pedras : q.total) : 0;
    var sPedras = el('div', 'fg-slot fg-slot-pedras' + (mostraPedra ? ' has' : '') +
                            ((atual && q && !pode) ? ' is-errada' : ''));
    if (mostraPedra) {
      sPedras.style.setProperty('--ec', corPedra);
      sPedras.setAttribute('data-pedra', q.stoneId);
      sPedras.setAttribute('data-total', String(vira));
      sPedras.appendChild(art('stoneIcon', [q.stoneId, 56], 56));
      sPedras.appendChild(el('b', null, '×' + vira));
      sPedras.appendChild(el('span', null, esc(nomePedra) + (vestida ? tr(' · se estivesse no saco') : '')));
    } else if (atual && q) {
      sPedras.appendChild(el('span', 'fg-slot-ic', '✕'));
      sPedras.appendChild(el('b', null, tr('Não quebra')));
      sPedras.appendChild(el('span', null, q.motivo === 'mestre' ? tr('peça do Mestre') : tr('o elemento não tem pedra')));
    } else {
      sPedras.appendChild(el('span', 'fg-slot-ic', '◈'));
      sPedras.appendChild(el('b', null, tr('As pedras')));
      sPedras.appendChild(el('span', null, tr('aparecem aqui')));
    }
    banca.appendChild(sPedras);
    body.appendChild(banca);

    // ===== O ESTADO: a conta por partes, ou o porquê de não quebrar
    var estado = el('div', 'fg-estado');
    if (!atual) {
      estado.appendChild(el('p', 'inv-dica', tr('Ponha uma peça na bancada: arraste da grade abaixo ou toque nela. Quanto mais rara, alta, estrelada e forjada, mais pedras ela vira.')));
    } else if (!q) {
      estado.appendChild(el('p', 'empty', tr('A quebra ainda não está disponível.')));
    } else if (nunca) {
      estado.appendChild(el('p', 'forge-short fg-quebra-nao', esc(MOTIVO_QUEBRA[q.motivo])));
    } else if (vestida) {
      estado.appendChild(el('p', 'forge-short fg-quebra-nao', tr('<b>Vestida</b> — tire do herói para quebrar. No saco ela daria <b>{pedras} {a}</b>.', { pedras: q.pedras, a: esc(nomePedra) })));
    } else if (!q.pode) {
      estado.appendChild(el('p', 'forge-short fg-quebra-nao', esc(MOTIVO_QUEBRA[q.motivo] || tr('Esta peça não se quebra.'))));
    } else {
      var conta = el('p', 'fg-conta', quebraContaTxt(q, nomePedra));
      conta.style.setProperty('--ec', corPedra);
      estado.appendChild(conta);
    }
    body.appendChild(estado);

    // ===== QUANTAS: com cópias iguais no saco, uma ou todas (os números ficam
    // TEXTO, como os atalhos 1/5/10 das poções)
    if (atual && q && !vestida && !nunca && copias > 1) {
      var qtd = el('div', 'fg-qtd');
      qtd.appendChild(el('span', 'fg-qtd-rot', tr('Quantas cópias iguais:')));
      [[1, '1'], ['todas', tr('todas (×{todas})', { todas: todas })]].forEach(function (op) {
        var acesa = (op[0] === 'todas') === (n > 1);
        var b = btn(op[1], 'btn-mini fg-qtd-b' + (acesa ? ' is-on' : ''), function () {
          if (forjaQuebraN === op[0]) return;
          forjaQuebraN = op[0];
          sheetParty('forja');
        });
        b.setAttribute('data-n', String(op[0]));
        b.setAttribute('aria-pressed', acesa ? 'true' : 'false');
        qtd.appendChild(b);
      });
      body.appendChild(qtd);
    }

    // ===== O GOLPE: pergunta antes — a peça não volta
    if (!pode) return;
    var icoQ = safe(function () { return JOGO.IconesUI.svg('fg-quebrar'); }, '') || '';
    var go = btn(icoQ + (forjaQuebrando ? tr('Quebrando…') : tr('Quebrar — vira {total} {a}', { total: q.total, a: esc(nomePedra) })),
      'btn-warn btn-block fg-quebrar-go' + (forjaQuebrando ? ' is-off' : ''), pergunta);
    body.appendChild(go);

    function pergunta() {
      var qual = '<b>' + esc((it && it.name) || atual.itemId) + (lv ? ' +' + lv : '') +
                 (atual.stars ? ' ★' + atual.stars : '') + '</b>';
      var viram = '<b>' + q.total + ' ' + esc(nomePedra) + '</b>';
      confirmSheet(n > 1 ? tr('Quebrar {n} cópias?', { n: n }) : tr('Quebrar a peça?'),
        tr('{a} Não tem volta.', { a: n > 1 ? tr('As <b>{n} cópias</b> de {qual} somem <b>para sempre</b> e viram {viram}.', { n: n, qual: qual, viram: viram })
               : tr('{qual} some <b>para sempre</b> e vira {viram}.', { qual: qual, viram: viram }) }),
        golpe, { sim: tr('Quebrar'), simCls: 'btn-warn', aoCancelar: function () { sheetParty('forja'); } });
    }
    // a forja só se redesenha se ainda for a ficha aberta: a resposta do
    // servidor pode chegar com o jogador já em outra
    function refaz() { if (sheetName === 'party' && partyTab === 'forja') sheetParty('forja'); }
    function avisa(fim) {
      if (!fim) { toast(tr('A peça não se quebrou.')); return; }
      var nomeF = (defs[fim.stoneId] || {}).name || nomePedra;
      toast('+' + (fim.pedras || q.total) + ' ' + nomeF +
            (fim.n > 1 ? ' ' + tr('— as {n} peças viraram pedra.', { n: fim.n }) : tr(' — a peça virou pedra.')), 'good');
      forjaQuebraN = 1;
      // forgeTarget fica como está (é descrito por VALOR): se sobrou cópia
      // igual, ela continua na bancada; se não, a bancada esvazia sozinha
    }
    function golpe() {
      // a SÉRIE vai junto do índice: se o estado for adotado no caminho (a fila
      // que sobe antes da op, um 409), o índice aponta outra peça — e a trava
      // do Progress recusa em vez de quebrar a errada
      var idx = atual.index, nAgora = n, serie = q.iid || null;
      var args = { invIndex: idx, n: nAgora };
      if (serie) args.iid = serie;
      // com sessão do site, é o servidor quem quebra (o estado dele é adotado)
      var AutQ = JOGO.Autoridade;
      if (AutQ && AutQ.ligada && AutQ.ligada()) {
        forjaQuebrando = true;
        sheetParty('forja');                         // volta à forja, o botão esperando
        AutQ.opAgora('quebrarPeca', args).then(function (res) {
          forjaQuebrando = false;
          if (!res || !res.ok) toast(recusaQuebraTxt(res));
          else if (!res.resultado) toast(tr('O servidor não quebrou: o saco mudou. Confira a bancada.'));
          else avisa(res.resultado);
          refaz();
        }, function () {
          forjaQuebrando = false;
          toast(tr('O servidor não respondeu — nada foi quebrado.'));
          refaz();
        });
        return;
      }
      avisa(safe(function () { return P().quebraPeca(idx, nAgora, { iid: serie }); }, false));
      sheetParty('forja');
    }
  }

  // ----------------------------------------------------------------- A GEMA
  /* A BANCADA DA GEMA (08/10, pedido do dono: "uma pedra rara que ao levar na forja
   * com um item dá um bônus a mais: +1 PA, +1 PM, vida ou dano; cada item pode ter
   * até 1 bônus especial; do mais difícil pro mais fácil: PA, PP, dano, vida").
   * A mesma bancada de arrastar: A PEÇA + A GEMA → O BÔNUS (os quatro, com a
   * chance de cada um). A conta é toda do Progress (gemaInfo, gemaChances); com
   * sessão do site quem sorteia é o servidor ('engastarGema'). Embaixo, o botão
   * de juntar 100 fragmentos numa gema. Vale para a peça do saco e para a vestida. */
  var forjaEngastando = false;
  function gemaArgs(alvo) {
    if (!alvo) return null;
    if (alvo.kind === 'worn') return { heroId: alvo.heroId, slot: slotRaw(alvo.slot) };
    return { invIndex: alvo.index };
  }
  function gemaBancada(body, atual, alvos, aceitaDrop) {
    var defs = stoneDefs();
    var gcfg = safe(function () { return P().gemaCfg(); }, null) || { id: 'stone-gem', fragmento: 'stone-gem-frag', porGema: 100 };
    var sdG = defs[gcfg.id] || { name: 'Gema Enterrada' }, sdF = defs[gcfg.fragmento] || { name: 'Fragmento de Gema' };
    var it = atual ? itemDef(atual.itemId) : null;
    var lv = atual ? atual.level : 0;
    var g = atual ? safe(function () { return P().gemaInfo(gemaArgs(atual)); }, null) : null;
    var gemas = stoneCount(gcfg.id), frags = stoneCount(gcfg.fragmento);
    var chances = safe(function () { return P().gemaChances(); }, null) || {};
    var extras = safe(function () { return P().EXTRAS; }, null) || ['pa', 'pp', 'dano', 'vida'];
    var pode = !!(g && g.pode);

    // ===== A BANCADA: a peça + a gema → o bônus
    var banca = el('div', 'forge-banca2 fg-banca-gema');
    var sPeca = el('div', 'fg-slot fg-slot-peca' + (atual ? ' has' : '') + ((g && g.motivo === 'ja-tem') ? ' is-errada' : ''));
    if (atual) {
      sPeca.appendChild(art('itemIcon', [atual.itemId, 56], 56));
      sPeca.appendChild(el('b', null, esc((it && it.name) || atual.itemId) + (lv ? ' +' + lv : '')));
      sPeca.appendChild(el('span', null, (atual.stars ? '★' + atual.stars + ' · ' : '') +
        (atual.extra ? '<b class="fg-gema-tem">◆ ' + esc(extraTxt(atual.extra)) + '</b> ' : '') +
        (atual.kind === 'worn'
          ? tr('· vestida por {a}', { a: esc(className((hero(atual.heroId) || {}).classId || atual.heroId)) })
          : tr('· no saco{a}', { a: atual.count > 1 ? ' ×' + atual.count : '' }))));
      tap(sPeca, function () { forgeTarget = null; sheetParty('forja'); });
      tipOn(sPeca, tr('A peça na bancada'), tr('Toque para tirar da bancada. Arraste outra da grade para trocar.'), '#e8c25a');
    } else {
      sPeca.appendChild(el('span', 'fg-slot-ic', '⤓'));
      sPeca.appendChild(el('b', null, tr('A peça')));
      sPeca.appendChild(el('span', null, tr('arraste da grade — ou toque numa')));
    }
    aceitaDrop(sPeca, 'peca', function (d) {
      var alvo = alvos[d.idx];
      if (!alvo) return;
      forgeTarget = alvo;
      sheetParty('forja');
    });
    banca.appendChild(sPeca);
    banca.appendChild(el('span', 'fg-op', '+'));

    var sGema = el('div', 'fg-slot fg-slot-gema' + (gemas > 0 ? ' has' : ''));
    sGema.appendChild(art('stoneIcon', [gcfg.id, 56], 56));
    sGema.appendChild(el('b', null, esc(sdG.name)));
    sGema.appendChild(el('span', null, gemas > 0 ? tr('<b>{a}</b> na prateleira · gasta 1', { a: gemas }) : tr('nenhuma — junte {a} fragmentos', { a: gcfg.porGema })));
    tipOn(sGema, sdG.name, esc(sdG.description || ''), elemColor('gema'));
    banca.appendChild(sGema);
    banca.appendChild(el('span', 'fg-op fg-seta', '→'));

    var sRes = el('div', 'fg-slot fg-slot-res' + (pode ? ' has' : ''));
    if (atual && atual.extra) {
      sRes.appendChild(el('span', 'fg-slot-ic', '◆'));
      sRes.appendChild(el('b', null, tr('Já engastada')));
      sRes.appendChild(el('span', null, esc(extraTxt(atual.extra))));
    } else {
      sRes.appendChild(el('span', 'fg-slot-ic', '?'));
      sRes.appendChild(el('b', null, tr('Um destes')));
      var odds = el('ul', 'fg-gema-odds');
      extras.forEach(function (x) {
        odds.appendChild(el('li', null, esc(extraTxt(x)) + '<i>' + Math.round((chances[x] || 0) * 100) + '%</i>'));
      });
      sRes.appendChild(odds);
    }
    banca.appendChild(sRes);
    body.appendChild(banca);

    // ===== O ESTADO
    var estado = el('div', 'fg-estado');
    if (!atual) {
      estado.appendChild(el('p', 'inv-dica', tr('Ponha uma peça na bancada: arraste da grade abaixo ou toque nela. A gema dá a ela <b>um</b> bônus a mais, sorteado — do mais difícil ao mais fácil: PA, PP, dano, vida. Cada peça aceita uma gema só.')));
    } else if (!g) {
      estado.appendChild(el('p', 'empty', tr('A Gema ainda não está disponível.')));
    } else if (g.motivo === 'ja-tem') {
      estado.appendChild(el('p', 'forge-short fg-quebra-nao', tr('Esta peça <b>já tem a sua Gema</b> ({a}). Cada peça aceita uma só.', { a: esc(extraTxt(g.extra)) })));
    } else if (g.motivo === 'sem-gema') {
      estado.appendChild(el('p', 'forge-short', tr('Sem Gema na prateleira. Você tem <b>{a}</b> de {b} fragmentos para a próxima — eles caem nos seis portais, vêm da loja do site e do anúncio premiado.', { a: frags, b: gcfg.porGema })));
    } else {
      estado.appendChild(el('p', 'inv-dica', tr('Pronto: <b>1 {a}</b> engasta um bônus nesta peça, sorteado na hora. O bônus fica na peça para sempre (vestida ou no saco) — e a peça engastada não vai ao mercadinho, à troca nem ao banco da guilda.', { a: esc(sdG.name) })));
    }
    body.appendChild(estado);

    // ===== JUNTAR OS FRAGMENTOS: 100 viram 1 — sem sorteio
    var juntar = el('div', 'fg-qtd');
    juntar.appendChild(el('span', 'fg-qtd-rot', tr('{a}: <b>{b}</b> / {c}', { a: esc(sdF.name), b: frags, c: gcfg.porGema })));
    var podeJuntar = frags >= gcfg.porGema;
    var bJ = btn(tr('Juntar {a} → 1 gema', { a: gcfg.porGema }), 'btn-mini' + (podeJuntar ? ' btn-gold' : ' is-off'), function () {
      if (!podeJuntar) { toast(tr('Faltam {a} fragmentos.', { a: gcfg.porGema - frags })); return; }
      var r = safe(function () { return P().juntaFragmentos(); }, false);
      if (r) toast(tr('Uma {a} nova na prateleira ({b}).', { a: esc(sdG.name), b: r.gemas }), 'good');
      else toast(tr('Não deu para juntar os fragmentos.'));
      sheetParty('forja');
    });
    bJ.setAttribute('data-juntar', '1');
    juntar.appendChild(bJ);
    body.appendChild(juntar);

    // ===== O ENGASTE: pergunta antes — a gema vai embora e o bônus é sorteado
    if (!pode) return;
    var go = btn((forjaEngastando ? tr('Engastando…') : tr('◆ Engastar a Gema — gasta 1')),
      'btn-primary btn-block fg-gema-go' + (forjaEngastando ? ' is-off' : ''), pergunta);
    body.appendChild(go);

    function pergunta() {
      var qual = '<b>' + esc((it && it.name) || atual.itemId) + (lv ? ' +' + lv : '') + (atual.stars ? ' ★' + atual.stars : '') + '</b>';
      confirmSheet(tr('Engastar a Gema?'),
        tr('Uma {a} some e {qual} ganha <b>um</b> bônus sorteado — PA, PP, dano ou vida. Não tem volta, e a peça não aceita outra.', { a: esc(sdG.name), qual: qual }),
        engasta, { sim: tr('Engastar'), simCls: 'btn-primary', aoCancelar: function () { sheetParty('forja'); } });
    }
    function refaz() { if (sheetName === 'party' && partyTab === 'forja') sheetParty('forja'); }
    function avisa(fim) {
      if (!fim || !fim.extra) { toast(tr('A gema não foi engastada.')); return; }
      toast(tr('◆ A Gema deu <b>{a}</b> à peça!', { a: esc(extraTxt(fim.extra)) }), 'good');
      forgeTarget = { kind: atual.kind, itemId: atual.itemId, level: atual.level, stars: atual.stars, extra: fim.extra,
                      heroId: atual.heroId, slot: atual.slot };
      if (invSel && invSel.itemId === atual.itemId && atual.kind === 'bag') {
        invSel = { itemId: atual.itemId, level: atual.level, stars: atual.stars, extra: fim.extra };
      }
    }
    function engasta() {
      var args = gemaArgs(atual);
      if (atual.kind === 'bag' && g.iid) args.iid = g.iid;     // a série vai junto do índice (como na quebra)
      var AutG = JOGO.Autoridade;
      if (AutG && AutG.ligada && AutG.ligada()) {
        forjaEngastando = true;
        sheetParty('forja');
        AutG.opAgora('engastarGema', args).then(function (res) {
          forjaEngastando = false;
          if (!res || !res.ok) toast((res && res.foraDoAr) ? tr('O servidor não respondeu — nada foi engastado.') : ((res && res.erro) || tr('O servidor não engastou agora.')));
          else if (!res.resultado) toast(tr('O servidor não engastou: o saco mudou. Confira a bancada.'));
          else avisa(res.resultado);
          refaz();
        }, function () {
          forjaEngastando = false;
          toast(tr('O servidor não respondeu — nada foi engastado.'));
          refaz();
        });
        return;
      }
      avisa(safe(function () { return P().engastaGema(args); }, false));
      sheetParty('forja');
    }
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
          ({ hp: tr('PV'), power: 'poder', initiative: 'inic.', dodge: 'esquiva', lock: tr('fixação') }[k] || k));
      }
    }
    return out.length ? out.join('<br>') : '—';
  }

  /* O PERGAMINHO DA REESCRITA (Fase C, 10/09): só fora de descida — a HUD só
   * oferece no Acampamento (e o Progress ainda recusa na batalha e na
   * antessala). Com mais de um caminho liberado, o jogador escolhe qual sai;
   * a confirmação diz o que troca e o que fica. Trocar o ATIVO segue grátis. */
  function foraDeDescida() { return current === 'hub'; }
  var MOTIVO_REESCRITA = {
    sem: tr('Nenhum Pergaminho da Reescrita guardado.'),
    descida: tr('A Reescrita só se usa fora de descida, no Acampamento.'),
    neutro: tr('O herói ainda não tem caminho: a primeira escolha, no nível 5, é de graça.'),
    nivel: tr('Só a partir do nível 5.'),
    classe: tr('Esta classe não tem caminhos para reescrever.'),
    elemento: tr('Elemento inválido.'),
    caminho: tr('A classe não tem esse caminho.'),
    'ja-tem': tr('O herói já tem esse caminho.'),
    velho: tr('Esse caminho não está liberado.'),
    heroi: tr('Herói desconhecido.')
  };
  // `refaz` (12/09): a ficha de onde veio — a de Feitiços ou a do herói
  function escolheReescrita(heroId, novo, refaz) {
    refaz = refaz || function () { openSheet('heroSheet', heroId); };
    var lista = safe(function () { return P().heroElements(heroId); }, []);
    var h = hero(heroId) || {};
    if (lista.length <= 1) { confirmaReescrita(heroId, lista[0] || h.element, novo, refaz); return; }
    var nn = esc(ELEM_PT[novo] || novo);
    var b = sheetShell(tr('Qual caminho sai?'), tr('Pergaminho da Reescrita — o de {nn} entra no lugar dele', { nn: nn }));
    sheetName = 'confirm';
    b.appendChild(el('p', 'confirm-txt', tr('O herói tem {length} caminhos liberados. Escolha qual deles dá a vaga ao de <b>{nn}</b>.', { length: lista.length, nn: nn })));
    var fila = el('div', 'guilda-emblemas');
    lista.forEach(function (v) {
      var bv = btn(esc(ELEM_PT[v] || v) + (h.element === v ? ' · ATIVO' : ''), 'btn-mini btn-primary', function () {
        confirmaReescrita(heroId, v, novo, refaz);
      });
      bv.style.setProperty('--ec', elemColor(v));
      fila.appendChild(bv);
    });
    b.appendChild(fila);
    var acts = el('div', 'confirm-acts');
    acts.appendChild(btn(tr('Voltar'), 'btn-ghost', function () { refaz(); }));
    b.appendChild(acts);
  }
  function confirmaReescrita(heroId, velho, novo, refaz) {
    refaz = refaz || function () { openSheet('heroSheet', heroId); };
    var pode = safe(function () { return P().podeReescrever(heroId, velho, novo); }, null);
    if (!pode || !pode.ok) {
      toast((pode && MOTIVO_REESCRITA[pode.motivo]) || tr('Não dá para reescrever agora.'));
      return;
    }
    var h = hero(heroId) || {};
    var eraAtivo = h.element === velho;
    var tem = safe(function () { return P().pergaminhos().elemento; }, 1);
    var nv = esc(ELEM_PT[velho] || velho), nn = esc(ELEM_PT[novo] || novo);
    confirmSheet(tr('Reescrever {a}', { a: ELEM_PT[velho] || velho }) + ' → ' + (ELEM_PT[novo] || novo) + '?',
      (eraAtivo
        ? tr('Sai o caminho de <b>{nv}</b> e entra o de <b>{nn}</b>, no mesmo lugar — e ele passa a ser o <b>ativo</b>: os feitiços do caminho trocam na hora. Ficam: nível, XP, o dano elemental dos níveis, itens, bicho e estrelas. Gasta 1 Pergaminho da Reescrita (restam {a}). Para desfazer, só outro pergaminho.', { nv: nv, nn: nn, a: Math.max(0, tem - 1) })
        : tr('Sai o caminho de <b>{nv}</b> e entra o de <b>{nn}</b>, no mesmo lugar (o caminho ativo continua o mesmo). Ficam: nível, XP, o dano elemental dos níveis, itens, bicho e estrelas. Gasta 1 Pergaminho da Reescrita (restam {a}). Para desfazer, só outro pergaminho.', { nv: nv, nn: nn, a: Math.max(0, tem - 1) })),
      function () {
        if (safe(function () { return P().reescreveElemento(heroId, velho, novo); }, false)) {
          toast(tr('Caminho reescrito: {a} no lugar de {b}.', { a: ELEM_PT[novo] || novo, b: ELEM_PT[velho] || velho }), 'good');
          refaz();
        } else toast(tr('Não deu para reescrever.'));
      });
  }

  // ------------------------------------------------------ FICHA DO HERÓI
  function sheetHero(heroId) {
    var h = hero(heroId);
    if (!h) { closeSheet(); return; }
    var cid = h.classId || heroId;
    var info = cardInfo(cid);
    var stats = effStats(heroId) || (classDef(cid) || {}).stats || {};
    var body = sheetShell(className(cid), tr('Nível {a} · {b}{c}', { a: h.level || 1, b: ELEM_PT[h.element] || tr('Neutro'), c: info.stars ? ' · ★' + info.stars : '' }));

    var top = el('div', 'hs-top');
    top.appendChild(art('unit', [cid, { element: h.element, dir: 0, scale: 0.7 }], 110));
    var col = el('div', 'hs-col');
    var xi = xpInfo(heroId);
    col.appendChild(bar('bar-xp', xi ? xi.pct : 0, xi && xi.xpNext ? 'XP ' + xi.xp + ' / ' + xi.xpNext : tr('nível máximo')));
    col.appendChild(el('div', 'hs-stats',
      tr('<span class="s-hp">{a} PV</span><span class="s-pa">{b} PA</span><span class="s-pp">{c} PP</span><span>{d} poder</span>{e}<span>{f} inic.</span><span>{g} esq.</span><span>{h} fix.</span>', { a: stats.hp || 0, b: stats.pa || 0, c: stats.pp || 0, d: stats.power || 0, e: stats.elemPower ? '<span class="s-el">+' + stats.elemPower + ' ' + (ELEM_PT[h.element] || '') + '</span>' : '', f: stats.initiative || 0, g: stats.dodge || 0, h: stats.lock || 0 })));
    col.appendChild(el('p', 'hs-gain', perLevelText(h.element)));
    // 08/10: as estrelas da classe SEMPRE aparecem (★0 vazio), com as cartas na mão, o custo da próxima
    // e o botão de subir — é aqui que o jogador gasta as cartas que caíram
    var sr = el('div', 'hs-stars' + (info.podeSubir ? ' is-pronto' : ''));
    sr.appendChild(starRow(info.stars, 18));
    var srT = el('span', 'hs-stars-t', info.next
      ? tr('<b>{a}</b> cartas na mão · a ★{b} custa <b>{c}</b>{d}', { a: info.cards, b: info.next.star, c: info.next.custo,
            d: info.stars ? ' · ' + tr('bônus de estrela já contam nos números acima') : '' })
      : tr('★ no topo · <b>{a}</b> cartas na mão · bônus de estrela já contam nos números acima', { a: info.cards }));
    sr.appendChild(srT);
    if (info.podeSubir) {
      sr.appendChild(btn(tr('★ Subir estrela'), 'btn-mini btn-gold hs-subir', function () {
        subirEstrela(cid, function () { sheetHero(heroId); });
      }));
    } else if (info.next) {
      sr.appendChild(el('span', 'hs-stars-falta', tr('faltam {a} — caem dos chefes', { a: info.next.faltam })));
    }
    col.appendChild(sr);
    // 04/10: as cartas da classe, como item — o cartão com ×N e o que falta para a próxima estrela
    if (info.cards > 0) {
      var prC = cartaProgresso(cid);
      var lc = el('button', 'hs-carta');
      lc.type = 'button';
      lc.appendChild(cartaClasse(cid, 40, '×' + info.cards));
      var lct = el('span', 'hs-carta-t');
      lct.appendChild(el('span', null, prC.faz));
      lct.appendChild(bar('bar-card', prC.pct, prC.rot));
      lc.appendChild(lct);
      tap(lc, function () { openSheet('collection', cid); });
      col.appendChild(lc);
    }
    top.appendChild(col);
    body.appendChild(top);

    // ---- os caminhos elementais: o mesmo painel da ficha de Feitiços (12/09)
    body.appendChild(el('h3', 'hs-sec', tr('Caminhos elementais')));
    body.appendChild(painelCaminhos(heroId, function () { sheetHero(heroId); }));
    corpoDoHeroi(body, heroId, h, cid);
  }

  /* OS CAMINHOS ELEMENTAIS NUM LUGAR SÓ (12/09, pedido do dono: "a escolha
   * elementar, mudança, quando for liberando deve ser por aqui e não ter que
   * ir no menu"). Escolher o primeiro no nível 5, trocar o ativo, liberar a
   * vaga que a estrela abriu e reescrever com o pergaminho — o mesmo painel na
   * ficha de Feitiços e na do herói. `refaz` redesenha a ficha de onde veio. */
  function painelCaminhos(heroId, refaz) {
    var h = hero(heroId) || {};
    var cid = h.classId || heroId;
    var caixa = el('div', 'caminhos');
    var lvEscolha = (D().leveling || {}).elementChoiceLevel || 5;
    var defC = classDef(cid);
    var elemsC = ['fogo', 'agua', 'terra', 'ar'].filter(function (e) {
      return !(defC && defC.paths && !defC.paths[e]);          // classe sem esse caminho
    });

    if (!h.element || h.element === 'neutro') {
      if ((h.level || 1) < lvEscolha) {
        caixa.appendChild(el('p', 'hs-hint', tr('No nível {lvEscolha} você escolhe o primeiro caminho aqui mesmo, de graça. Até lá os quatro galhos seguem abertos para você comparar.', { lvEscolha: lvEscolha })));
        return caixa;
      }
      caixa.classList.add('is-escolha');
      caixa.appendChild(el('p', 'caminhos-tx', tr('<b>Escolha o caminho elemental.</b> {a} já chegou ao nível {lvEscolha}: compare os galhos e toque no elemento. O primeiro é de graça; depois, só o Pergaminho da Reescrita troca.', { a: esc(className(cid)), lvEscolha: lvEscolha })));
      var fila0 = el('div', 'guilda-emblemas');
      elemsC.forEach(function (e) {
        var nome = ELEM_PT[e] || e;
        var b0 = btn(tr('Seguir {nome}', { nome: nome }), 'btn-mini btn-primary', function () {
          confirmSheet(tr('Seguir o caminho de {nome}?', { nome: nome }),
            tr('É <b>permanente</b> — só o Pergaminho da Reescrita troca depois. A partir daqui, cada nível dá +5 PV e +3 de dano de {nome}, e os feitiços do galho vão abrindo com o nível.', { nome: nome }),
            function () {
              var ok = safe(function () { return G().chooseElement(heroId, e); }, false);
              if (!ok) ok = safe(function () { return P().chooseElement(heroId, e); }, false);
              if (ok) toast(tr('Caminho de {nome} escolhido — os feitiços do galho já estão na mão.', { nome: nome }), 'good');
              else toast(tr('Não deu para escolher agora.'));
              refaz();
            });
        });
        b0.style.setProperty('--ec', elemColor(e));
        fila0.appendChild(b0);
      });
      caixa.appendChild(fila0);
      return caixa;
    }

    // ---- OS CAMINHOS ELEMENTAIS POR ESTRELA (30/08): "da terceira estrela
    // em diante o jogador poderá escolher outro elemento" — ★3 abre a 2ª
    // vaga, ★4 a 3ª, ★5 a 4ª. O ativo acende; liberado troca com um toque
    // (os feitiços do caminho trocam juntos); vaga aberta escolhe; o resto
    // mostra a estrela que falta.
    {
      var liberados = safe(function () { return P().heroElements(heroId); }, [h.element]);
      var vagas = safe(function () { return P().elementSlots(heroId); }, 1);
      // o PERGAMINHO DA REESCRITA (Fase C): com ele, e só no Acampamento, o
      // caminho que o herói não tem (e a classe tem) ganha a ação "reescrever"
      var pgRees = safe(function () { return P().pergaminhos().elemento; }, 0);
      var defRees = classDef(cid);
      var classeReescreve = !!(defRees && defRees.paths);
      var comReescrita = pgRees > 0 && classeReescreve && foraDeDescida();
      var filaEl = el('div', 'guilda-emblemas');
      elemsC.forEach(function (e3) {
        var tem = liberados.indexOf(e3) >= 0;
        var ativo = h.element === e3;
        var podeAbrir = !tem && liberados.length < vagas;
        var reescreve = !tem && !podeAbrir && comReescrita;
        // a vaga N abre na estrela N+1 (2ª vaga → ★3, 3ª → ★4, 4ª → ★5)
        var rot = (ELEM_PT[e3] || e3) + (ativo ? ' · ATIVO' : tem ? '' :
                  podeAbrir ? ' · liberar' : reescreve ? ' · reescrever' : ' · ★' + Math.min(5, vagas + 2));
        var b3 = btn(rot, 'btn-mini ' + (ativo ? 'btn-gold' : tem ? 'btn-primary' : 'btn-ghost') +
                          (reescreve ? ' btn-reescreve' : ''),
          function () {
            if (ativo) return;
            if (tem) {
              if (safe(function () { return P().trocaElemento(heroId, e3); }, false)) {
                toast(tr('O caminho de {a} assumiu — feitiços trocados.', { a: ELEM_PT[e3] || e3 }), 'good');
                refaz();
              }
              return;
            }
            if (!podeAbrir) {
              if (reescreve) { escolheReescrita(heroId, e3, refaz); return; }
              var alvoEstrela = { 2: 3, 3: 4, 4: 5 }[liberados.length + 1] || 3;
              toast(tr('A ★{alvoEstrela} da classe libera a próxima vaga — junte cartas.', { alvoEstrela: alvoEstrela }));
              return;
            }
            confirmSheet(tr('Liberar o caminho de {a}?', { a: ELEM_PT[e3] || e3 }),
              tr('A escolha é permanente — a vaga veio das estrelas da classe.'), function () {
                if (safe(function () { return P().liberaElemento(heroId, e3); }, false)) {
                  toast(tr('Caminho de {a} liberado!', { a: ELEM_PT[e3] || e3 }), 'good');
                  refaz();
                } else toast(tr('não deu'));
              });
          });
        b3.style.setProperty('--ec', elemColor(e3));
        filaEl.appendChild(b3);
      });
      caixa.appendChild(filaEl);
      caixa.appendChild(el('p', 'inv-dica',
        tr('Vagas de caminho: <b>{length} / {vagas}</b> — ★3 abre a 2ª, ★4 a 3ª, ★5 a 4ª. Trocar o ativo troca os feitiços do caminho.{a}', { length: liberados.length, vagas: vagas, a: (pgRees > 0 && classeReescreve)
          ? (comReescrita
            ? ' ' +
              tr('<b>Pergaminho da Reescrita ×{pgRees}</b>: toque num caminho que ele não tem para trocar um dos seus por ele.', { pgRees: pgRees })
            : ' ' + tr('O Pergaminho da Reescrita (×{pgRees}) se usa no Acampamento.', { pgRees: pgRees }))
          : '' })));
    }
    return caixa;
  }

  // o resto da ficha do herói: equipamento, feitiços e o que ainda vem
  function corpoDoHeroi(body, heroId, h, cid) {
    // ---- equipamento: 4 espaços + pet (adendo v2.2)
    body.appendChild(el('h3', 'hs-sec', tr('Equipamento')));
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
      cell.appendChild(el('span', 'hs-slot-it', it ? esc(it.name) : tr('vazio')));
      // o "Nv." em linha própria: colado ao nome, as reticências o comiam
      var nvH = it ? nvBadge(itemId) : null;
      if (nvH) cell.appendChild(nvH);
      if (it) cell.appendChild(el('span', 'pt-slot-b', esc(itemBonusText(it, lv, estrelas, v && v.extra))));
      if (v && v.extra) ic.appendChild(el('span', 'ig-gema', '◆'));
      tipOn(ic, SLOT_PT[canon] + (it ? ' — ' + it.name : ''),
        it ? itemTipBody(itemId, lv, estrelas, v && v.extra) : esc(SLOT_HINT[canon]),
        it ? rarColor(it.rarity) : '#8b93a0');
      // a troca acontece na tela "Personagens", com este herói já no carrossel
      var act = btn(it ? tr('Trocar') : tr('Equipar'), 'btn-mini', function () {
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
      cell.appendChild(el('span', 'hs-slot-nm', tr('Bicho')));
      cell.appendChild(el('span', 'hs-slot-it', pd ? esc(pd.name) + ' · ' + petNivelTxt(pid) : tr('nenhum')));
      if (pd) tipOn(ic, pd.name, esc(pd.description || '') + '<br><i>' + esc(bonusText(pd.bonuses)) + '</i>',
        elemColor(pd.element));
      var pets = ownedPets();
      if (pd) {
        cell.appendChild(btn(tr('Soltar'), 'btn-mini btn-warn', function () {
          safe(function () { P().unequipPet(heroId); }, null);
          sheetHero(heroId);
        }));
      } else if (pets.length) {
        cell.appendChild(btn(tr('Chamar'), 'btn-mini', function () { petPicker(heroId); }));
      } else {
        cell.appendChild(el('span', 'hs-none', tr('nenhum no saco')));
      }
      slots.appendChild(cell);
    })();
    body.appendChild(slots);

    // ---- feitiços, com o que faz e o que cada um custa
    // Antes esta lista era só ícone + nome, e a descrição vivia no balãozinho —
    // que no celular ninguém vê, porque não existe passar o mouse.
    body.appendChild(el('h3', 'hs-sec', tr('Feitiços')));
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
        body.appendChild(el('h3', 'hs-sec', tr('Ainda por abrir')));
        body.appendChild(b1);
      }
    } else {
      // Sem elemento escolhido não há UM caminho — há QUATRO. Mostramos os
      // quatro para o jogador poder decidir antes de chegar no nível da escolha.
      body.appendChild(el('h3', 'hs-sec', tr('O que vem depois')));
      body.appendChild(el('p', 'hs-hint',
        tr('O caminho elemental abre no nível {escolha}. Estes são os feitiços de cada elemento, e o nível em que chegam.', { escolha: escolha })));
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
    if (nivelAbre) cab.appendChild(el('span', 'hs-lv', tr('Nv') + ' ' + nivelAbre));
    txt.appendChild(cab);
    if (d2) {
      var ficha = tr('{a} PA', { a: d2.paCost || 0 });
      if (d2.range) ficha += ' ' + tr('· alcance {a}–{b}', { a: d2.range.min || 0, b: d2.range.max || 0 });
      if (d2.aoe && d2.aoe.shape && d2.aoe.shape !== 'single') {
        ficha += ' ' + tr('· área {shape} {a}', { shape: d2.aoe.shape, a: d2.aoe.size || '' });
      }
      if (d2.cooldown) ficha += ' ' + tr('· recarga {cooldown}', { cooldown: d2.cooldown });
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
    var nvBicho = safe(function () { return D().nivelUso.pet; }, 0) || 0;
    var body = sheetShell(tr('Chamar um bicho'), tr('Um bicho serve a um herói por vez.{a}', { a: nvBicho ? ' ' + tr('Pets a partir do nível {nvBicho}.', { nvBicho: nvBicho }) : '' }));
    var pets = ownedPets();
    var g = el('div', 'pet-grid');
    pets.forEach(function (pid) {
      var pd = petDef(pid);
      var c = el('button', 'pet-cell');
      c.type = 'button';
      marcaTranca(c, heroId, pid, true);
      c.appendChild(art('petIcon', [pid, 56], 56));
      c.appendChild(el('b', null, esc((pd && pd.name) || pid)));
      c.appendChild(el('span', null, petNivelTxt(pid)));
      c.appendChild(el('span', null, esc(bonusText(pd && pd.bonuses))));
      var nvP = nvBadge(pid, 'pet-nv');
      if (nvP) c.appendChild(nvP);
      tap(c, function () {
        limpaRecusa();
        var okP = safe(function () { return P().equipPet(heroId, pid); }, false);
        if (!okP) {
          var rP = recusaAtual();
          toast(rP ? textoRecusa(rP) : tr('Não deu para chamar esse bicho.'));
          return;
        }
        volta();
      });
      g.appendChild(c);
    });
    if (!pets.length) g.appendChild(el('p', 'empty', tr('Nenhum bicho no saco.')));
    body.appendChild(g);
    body.appendChild(btn(tr('Voltar'), 'btn-ghost btn-block', volta));
  }

  /* O BANCO DE CONTAS (pedido do usuário, 25/08). Cada conta tem id próprio,
   * seu save solo e seu cofre; trocar é recarregar a página com `?conta=` na
   * URL — a conta é decidida no boot, antes de db/progress carregarem. A
   * ficha também ensina o teste de DOIS JOGADORES: duas janelas, duas contas. */
  /* AS CONFIGURAÇÕES (02/10, a frente dos menus). O dono pediu "Configurações"
   * entre os menus a melhorar, e ela NÃO EXISTIA: o som só se desligava no
   * botãozinho 🔊 da batalha (sem volume), a tela cheia só no canto, e os
   * atalhos de teclado não estavam escritos em lugar nenhum. Esta ficha junta
   * o que é do APARELHO — nada daqui é progresso nem vai para a conta: o som
   * mora no js/audio.js (chave própria), o movimento numa chave soterra-* que
   * o save_sandbox das provas já blinda. */
  /* O TEXTO NO IDIOMA DO JOGADOR (05/10). `tr('Texto em português', { v: valor })` é o JOGO.I18n.t com
   * rede: a chave é o próprio texto em português, e sem tradução (ou sem o módulo) volta o português.
   * A etapa 2 (05/10) embrulhou o arquivo inteiro: frase montada aos pedaços virou UMA chave com
   * {variáveis}, e por isso a rede tem de preencher as variáveis mesmo sem o módulo — há página de prova
   * que carrega o hud.js sem o js/core/i18n.js, e em português o texto sai byte a byte o de antes. */
  function tr(s, v) {
    var I = JOGO.I18n;
    if (I && I.t) return I.t(s, v);
    if (!v) return s;
    return String(s).replace(/\{([A-Za-z_]\w*)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m;
    });
  }
  /* O TÍTULO NA TELA. O texto do título é CHAVE (o save e o relé o guardam e comparam em português —
   * js/core/titulos.js), então ele só é traduzido aqui, na hora de desenhar. Os fixos estão no
   * dicionário; "Top 2 Bárbaro" é montado com o nome da classe e se traduz pelo molde. */
  function titExibe(t) {
    var I = JOGO.I18n;
    if (!t || !I || I.idioma === 'pt') return t;
    var d = tr(t);
    if (d !== t) return d;
    var m = /^Top ([123]) (.+)$/.exec(String(t));
    if (!m) return t;
    var defs = (JOGO.DATA && JOGO.DATA.classes) || {}, achou = null;
    Object.keys(defs).forEach(function (cid) {
      if (defs[cid] && I.pt && I.pt('classes', cid, 'name', defs[cid].name) === m[2]) achou = defs[cid].name;
    });
    return achou ? tr('Top {pos} {classe}', { pos: m[1], classe: achou }) : t;
  }
  var PREF_UI = 'soterra-pref-ui';
  function prefUi() {
    try { return JSON.parse(localStorage.getItem(PREF_UI) || '{}') || {}; } catch (e) { return {}; }
  }
  function gravaPrefUi(p) {
    try { localStorage.setItem(PREF_UI, JSON.stringify(p)); } catch (e) {}
    aplicaPrefUi(p);
  }
  // "menos movimento": a ficha não sobe deslizando, o botão não afunda —
  // para quem enjoa, e para o celular fraco que engasga na animação
  function aplicaPrefUi(p) {
    try { document.documentElement.classList.toggle('menos-movimento', !!(p || prefUi()).menosMovimento); } catch (e) {}
  }
  aplicaPrefUi();
  // o 🔊 da batalha acompanha o que a ficha mudou
  function pintaBotaoSom() {
    if (!bt.som || !JOGO.Audio) return;
    bt.som.textContent = JOGO.Audio.isMudo() ? '🔇' : '🔊';
    bt.som.title = JOGO.Audio.isMudo() ? 'som desligado' : 'som ligado';
  }
  /* A CHAVE (o interruptor): um <button role="switch"> com o aria-checked —
   * o leitor de tela diz "ligado/desligado", o teclado liga com Espaço, e o
   * alvo tem 44 px de altura, não a bolinha de 20. */
  function linhaConfig(titulo, dica, controle) {
    var ln = el('div', 'cfg-linha');
    var tx = el('div', 'cfg-tx');
    tx.appendChild(el('b', 'cfg-tit', titulo));
    if (dica) tx.appendChild(el('span', 'cfg-dica', dica));
    ln.appendChild(tx);
    ln.appendChild(controle);
    return ln;
  }
  function chaveConfig(ligada, rotulo, aoMudar) {
    var b = el('button', 'cfg-chave' + (ligada ? ' is-on' : ''));
    b.type = 'button';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', ligada ? 'true' : 'false');
    b.setAttribute('aria-label', rotulo);
    b.appendChild(el('span', 'cfg-bola'));
    tap(b, function () {
      var on = b.getAttribute('aria-checked') !== 'true';
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.classList.toggle('is-on', on);
      aoMudar(on);
    });
    return b;
  }
  var chaveTelaViva = null, ouveTela = false;
  function sincChaveTela() {
    var c = chaveTelaViva, TC = JOGO.TelaCheia;
    if (!c || !c.isConnected || !TC) return;
    var on = !!TC.cheia();
    c.setAttribute('aria-checked', on ? 'true' : 'false');
    c.classList.toggle('is-on', on);
  }
  function sheetConfig() {
    var body = sheetShell(tr('Configurações'),
      tr('O que vale para este aparelho: o som, a tela e o movimento da interface. Nada daqui mexe no seu progresso.'));
    sheetName = 'config';
    var Au = JOGO.Audio;

    /* IDIOMA (05/10, o dono: "quero que o jogo tenha os principais idiomas para poder mudar: inglês,
     * espanhol ou português"). É a PRIMEIRA seção de propósito: quem caiu num idioma que não lê precisa
     * achá-la sem ler o resto — por isso o título traz as três palavras e cada opção vem escrita no
     * próprio idioma. A escolha é do NAVEGADOR (JOGO.I18n, chave própria): não entra no save, não vai ao
     * servidor e não tira ninguém da conta. Trocar RECARREGA: metade das telas já leu o DATA, e trocar a
     * quente deixaria a tela meio a meio. No meio de uma batalha não recarrega sozinho — avisa e espera. */
    var Id = JOGO.I18n;
    if (Id && Id.escolhe) {
      var isec = el('section', 'cfg-sec');
      isec.appendChild(el('h3', 'bk-tit', 'Idioma · Language · Idioma'));
      var selI = document.createElement('select');
      selI.className = 'cfg-select';
      selI.setAttribute('aria-label', 'Idioma / Language');
      selI.setAttribute('lang', 'mul');
      Id.IDIOMAS.forEach(function (l) {
        var op = document.createElement('option'); op.value = l; op.textContent = Id.NOMES[l];
        op.setAttribute('lang', Id.TAG[l]);
        if (l === Id.idioma) op.selected = true;
        selI.appendChild(op);
      });
      var avisoI = el('div', 'cfg-recarrega');
      // o `?lang=` da URL manda mais que a escolha gravada: se ele ficasse, a recarga voltaria ao idioma do link
      var recarregaIdioma = function () {
        try {
          var u = String(location.href), limpa = u.replace(/([?&])lang=[a-z]{2}(&|(?=#)|$)/i, function (m, a, b) { return b === '&' ? a : ''; });
          if (limpa !== u) location.replace(limpa); else location.reload();
        } catch (e) {}
      };
      selI.addEventListener('change', function () {
        if (!Id.escolhe(selI.value)) return;
        clear(avisoI);
        if (selI.value === Id.idioma) return;
        if (root.classList.contains('in-battle')) {
          avisoI.appendChild(el('span', 'inv-dica', tr('Vale depois de recarregar o jogo.')));
          avisoI.appendChild(btn(tr('Recarregar agora'), 'btn-mini btn-gold', recarregaIdioma));
        } else recarregaIdioma();
      });
      selI.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
      isec.appendChild(linhaConfig(tr('Idioma do jogo'), tr('Nomes de jogador, guilda e o chat ficam como foram escritos.'), selI));
      isec.appendChild(avisoI);
      body.appendChild(isec);
    }

    var som = el('section', 'cfg-sec');
    som.appendChild(el('h3', 'bk-tit', tr('Som')));
    if (Au && Au.isMudo) {
      var volume = document.createElement('input');
      var lnVol = null, pintaMus = null;
      som.appendChild(linhaConfig(tr('Som do jogo'), tr('Golpes, passos e a interface.'),
        chaveConfig(!Au.isMudo(), tr('Som do jogo'), function (on) {
          Au.setMudo(!on);
          pintaBotaoSom();
          volume.disabled = !on;
          if (lnVol) lnVol.classList.toggle('is-apagado', !on);
          if (pintaMus) pintaMus();
        })));
      volume.type = 'range';
      volume.min = '0'; volume.max = '100'; volume.step = '5';
      volume.className = 'cfg-volume';
      volume.value = String(Math.round((Au.getVolume ? Au.getVolume() : 0.7) * 100));
      volume.setAttribute('aria-label', tr('Volume'));
      volume.disabled = Au.isMudo();
      var vNum = el('output', 'cfg-num', volume.value + '%');
      volume.addEventListener('input', function () {
        vNum.textContent = volume.value + '%';
        Au.setVolume(Number(volume.value) / 100);
      });
      // a seta do teclado mexe no volume, não num atalho do jogo
      volume.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
      var vol = el('div', 'cfg-vol');
      vol.appendChild(volume);
      vol.appendChild(vNum);
      lnVol = linhaConfig(tr('Volume'), null, vol);
      if (Au.isMudo()) lnVol.classList.add('is-apagado');
      som.appendChild(lnVol);
      /* MÚSICA (06/10, o dono: "algumas músicas de ação (só sonoro de fundo nas lutas) e uma para a
       * praça, mas bem de leve"). Canal próprio (JOGO.Audio.musica): a chave e a régua dela não mexem
       * nos efeitos; a chave "Som do jogo" de cima — e o 🔊 da batalha — cala os dois, e por
       * isso apaga estas linhas também. */
      var Mu = Au.musica;
      if (Mu && Mu.isLigada) {
        var volM = document.createElement('input'), lnMus = null, lnVolM = null;
        pintaMus = function () {
          var mudo = Au.isMudo(), ligada = Mu.isLigada();
          volM.disabled = mudo || !ligada;
          if (lnMus) lnMus.classList.toggle('is-apagado', mudo);
          if (lnVolM) lnVolM.classList.toggle('is-apagado', mudo || !ligada);
        };
        lnMus = linhaConfig(tr('Música'), tr('Fundo bem leve na praça e nas lutas. Cada faixa (cerca de 1 MB) só é baixada quando toca.'),
          chaveConfig(Mu.isLigada(), tr('Música'), function (on) { Mu.setLigada(on); pintaMus(); }));
        som.appendChild(lnMus);
        volM.type = 'range';
        volM.min = '0'; volM.max = '100'; volM.step = '5';
        volM.className = 'cfg-volume';
        volM.value = String(Math.round(Mu.getVolume() * 100));
        volM.setAttribute('aria-label', tr('Volume da música'));
        var mNum = el('output', 'cfg-num', volM.value + '%');
        volM.addEventListener('input', function () {
          mNum.textContent = volM.value + '%';
          Mu.setVolume(Number(volM.value) / 100);
        });
        volM.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
        var volMx = el('div', 'cfg-vol');
        volMx.appendChild(volM);
        volMx.appendChild(mNum);
        lnVolM = linhaConfig(tr('Volume da música'), null, volMx);
        som.appendChild(lnVolM);
        pintaMus();
      }
    } else som.appendChild(el('p', 'empty', tr('O som não carregou neste aparelho.')));
    body.appendChild(som);

    /* A VELOCIDADE DA BATALHA (09/10; o dono: "um modo de colocar a velocidade mais rápida um pouco dos monstros
     * de cada luta, para agilizar as lutas"). Por aparelho (JOGO.Ritmo): a pausa entre os passos dos monstros e as
     * animações de andar e golpear correm ×1, ×1,5 ou ×2. Não muda o motor, o juiz, nem o relógio da sua vez. */
    var Rt = JOGO.Ritmo;
    if (Rt && Rt.define) {
      var bsec = el('section', 'cfg-sec');
      bsec.appendChild(el('h3', 'bk-tit', tr('Batalha')));
      var selR = document.createElement('select');
      selR.className = 'cfg-select cfg-ritmo';
      selR.setAttribute('aria-label', tr('Velocidade da batalha'));
      Rt.ORDEM.forEach(function (n) {
        var op = document.createElement('option'); op.value = n; op.textContent = tr(Rt.nome(n));
        if (n === Rt.nivel()) op.selected = true;
        selR.appendChild(op);
      });
      selR.addEventListener('change', function () {
        Rt.define(selR.value);
        toast(tr('Velocidade da batalha: {a}.', { a: tr(Rt.nome(Rt.nivel())) }), 'good');
      });
      selR.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
      bsec.appendChild(linhaConfig(tr('Velocidade da batalha'), tr('A pausa entre os passos dos monstros e as animações de andar e golpear. Não muda as regras nem o relógio da sua vez.'), selR));
      body.appendChild(bsec);
    }
    var tela = el('section', 'cfg-sec');
    tela.appendChild(el('h3', 'bk-tit', tr('Tela')));
    var TC = JOGO.TelaCheia;
    // 06/10: no aplicativo não há chave (nem botão no canto): a casca já é tela cheia
    if (TC && TC.suporta && TC.suporta() && !(TC.noApp && TC.noApp())) {
      /* 03/10 (revisão): a chave segue a tela, não o toque. Ela virava na hora
       * e ficava "ligada" quando o navegador recusava (quadro sem permissão)
       * e também depois do Esc, que sai da tela cheia sem passar por aqui — e o
       * toque seguinte fazia o contrário do que a chave mostrava. */
      chaveTelaViva = chaveConfig(TC.cheia(), tr('Tela cheia'), function (on) {
        var p = on ? TC.entra() : TC.sai();
        if (p && typeof p.then === 'function') p.then(sincChaveTela, sincChaveTela);
      });
      tela.appendChild(linhaConfig(tr('Tela cheia'), tr('Some a barra do navegador. Esc sai.'), chaveTelaViva));
      if (!ouveTela) {
        ouveTela = true;
        document.addEventListener('fullscreenchange', sincChaveTela);
        document.addEventListener('webkitfullscreenchange', sincChaveTela);
      }
    }
    tela.appendChild(linhaConfig(tr('Menos movimento'), tr('As fichas abrem sem deslizar e os botões não afundam.'),
      chaveConfig(!!prefUi().menosMovimento, tr('Menos movimento'), function (on) {
        var p = prefUi(); p.menosMovimento = on; gravaPrefUi(p);
      })));
    // 15/10: o MODO PARA DALTÔNICOS (js/core/paleta.js) — troca a paleta dos elementos; vale ao recarregar
    var avisoD = el('div', 'cfg-recarrega');
    var pintaAvisoD = function () {
      clear(avisoD);
      var ligadoAgora = safe(function () { return !!(JOGO.PALETA && JOGO.PALETA.ligado()); }, false);
      var ligadoNaFicha = !!prefUi().daltonico;
      var emUso = safe(function () { return JOGO.PALETA && JOGO.PALETA.tabela() === JOGO.PALETA.DALTONICO; }, false);
      if (ligadoNaFicha === emUso) return;
      void ligadoAgora;
      avisoD.appendChild(el('span', 'inv-dica', tr('Vale depois de recarregar o jogo.')));
      avisoD.appendChild(btn(tr('Recarregar agora'), 'btn-mini btn-gold', function () { try { location.reload(); } catch (e) {} }));
    };
    tela.appendChild(linhaConfig(tr('Modo para daltônicos'), tr('Troca as cores dos elementos por outras que quem não separa vermelho de verde distingue.'),
      chaveConfig(!!prefUi().daltonico, tr('Modo para daltônicos'), function (on) {
        var p = prefUi(); p.daltonico = on; gravaPrefUi(p); pintaAvisoD();
      })));
    tela.appendChild(avisoD);
    pintaAvisoD();
    // 15/10: LIMITAR A 30 QUADROS (js/mobile.js) — vale na hora, nos dois laços
    var Mq = JOGO.Mobile;
    if (Mq && Mq.defineLimiteQuadros) {
      tela.appendChild(linhaConfig(tr('Limitar a 30 quadros'), tr('Poupa bateria e esquenta menos; o jogo fica um pouco menos fluido.'),
        chaveConfig(!!prefUi().quadros30, tr('Limitar a 30 quadros'), function (on) {
          var p = prefUi(); p.quadros30 = on; gravaPrefUi(p); Mq.defineLimiteQuadros(on);
        })));
    }
    // 08/10: os AVISOS do aparelho (só no aplicativo): o prêmio diário, o Eco e a saudade de três dias
    var Nt = JOGO.Notificacoes;
    if (Nt && Nt.disponivel && Nt.disponivel()) {
      tela.appendChild(linhaConfig(tr('Avisos do aparelho'), tr('Lembretes do prêmio diário (10h), do Eco Primordial (segunda, 12h) e de três dias sem descer. Nada vem de fora do aparelho.'),
        chaveConfig(!!Nt.ativas(), tr('Avisos do aparelho'), function (on) {
          Nt.define(on).then(function () { toast(on ? tr('Avisos ligados.') : tr('Avisos desligados.')); });
        })));
    }
    body.appendChild(tela);

    /* GRÁFICOS (04/10, o dono: "teria como um usuário conseguir definir a resolução? assim para pc ou celular
     * mais fraco ele consiga jogar"). Três níveis (JOGO.Mobile.grafico): resolução do 3D, tamanho das texturas
     * e o brilho. Vale ao recarregar — modelo aberto não reabre em outro tamanho. */
    var Mb = JOGO.Mobile;
    if (Mb && Mb.qualidade) {
      var gsec = el('section', 'cfg-sec');
      gsec.appendChild(el('h3', 'bk-tit', tr('Gráficos')));
      // sem escolha gravada, a lista mostra o padrão DESTE lugar (web: alta; aplicativo: média ou baixa)
      var escolhida = prefUi().graficos || (Mb.padraoGrafico ? Mb.padraoGrafico() : 'alta'), emUso = Mb.qualidade();
      var selG = document.createElement('select');
      selG.className = 'cfg-select';
      selG.setAttribute('aria-label', tr('Qualidade gráfica'));
      [['alta', tr('Alta — tudo no máximo')], ['media', tr('Média — resolução e relevo menores')], ['baixa', tr('Baixa — para aparelho fraco')]].forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1];
        if (o[0] === escolhida) op.selected = true;
        selG.appendChild(op);
      });
      var avisoG = el('div', 'cfg-recarrega');
      var pintaAvisoG = function () {
        clear(avisoG);
        if (selG.value === emUso) return;
        avisoG.appendChild(el('span', 'inv-dica', tr('Vale depois de recarregar o jogo.')));
        avisoG.appendChild(btn(tr('Recarregar agora'), 'btn-mini btn-gold', function () { try { location.reload(); } catch (e) {} }));
      };
      selG.addEventListener('change', function () { var p = prefUi(); p.graficos = selG.value; gravaPrefUi(p); pintaAvisoG(); });
      selG.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
      gsec.appendChild(linhaConfig(tr('Qualidade'), tr('Menos qualidade usa menos memória e roda melhor em PC ou celular fraco.'), selG));
      gsec.appendChild(avisoG);
      pintaAvisoG();
      body.appendChild(gsec);
    }

    /* MODELOS NO APARELHO (04/10): só existe no aplicativo de Android — na web `JOGO.AppModelos` não é
     * carregado. Mostra o espaço usado, baixa o pacote inteiro e apaga (js/app_modelos.js). */
    var secModelos = safe(function () { return JOGO.AppModelos && JOGO.AppModelos.secaoConfig(); }, null);
    if (secModelos) body.appendChild(secModelos);
    /* JOGO NO APARELHO (06/10): também só no aplicativo. O código do jogo fica guardado para abrir mais
     * rápido — o jogo segue somente online — e é aqui que o jogador apaga ou volta a guardar (js/app_jogo.js). */
    var secJogo = safe(function () { return JOGO.AppJogo && JOGO.AppJogo.secaoConfig(); }, null);
    if (secJogo) body.appendChild(secJogo);

    /* BARRAS DE OURO PELA GOOGLE PLAY (04/10): só no aplicativo — na web `JOGO.CompraPlay` não é carregado e
     * as barras continuam na loja do site. A Play exige que, dentro do aplicativo, a compra seja pela cobrança dela. */
    if (JOGO.CompraPlay && JOGO.CompraPlay.noApp()) {
      var secBarras = el('section', 'cfg-sec loja-jogo');      // 25/10: some com a loja fechada
      secBarras.appendChild(el('h3', 'bk-tit', tr('Barras de ouro')));
      secBarras.appendChild(el('p', 'inv-dica', tr('A moeda da loja: personagens, auras, pedras de forja e presentes. A compra é feita pela Google Play.')));
      secBarras.appendChild(btn(tr('Comprar barras de ouro'), 'btn-ghost btn-block', function () { JOGO.CompraPlay.abre(); }));
      body.appendChild(secBarras);
    }
    /* GANHAR PRÊMIOS (06/10): o anúncio premiado, também só no aplicativo (na web `JOGO.PremioAnuncio` não é
     * carregado). A regra do dono: anúncio SÓ para quem entra nesta área e toca no botão — nada de anúncio é
     * carregado, ligado ou mostrado antes disso (js/core/premio_anuncio.js; o prêmio é do servidor). */
    if (JOGO.PremioAnuncio && JOGO.PremioAnuncio.noApp()) {
      var secPremio = el('section', 'cfg-sec');
      secPremio.appendChild(el('h3', 'bk-tit', tr('Ganhar prêmios')));
      secPremio.appendChild(el('p', 'inv-dica', tr('Opcional: assista a um anúncio e ganhe vinténs, uma barra de ouro ou Fragmentos de Gema. Até 5 de cada por dia. O jogo não mostra anúncio em nenhum outro lugar.')));
      secPremio.appendChild(btn(tr('Ganhar prêmios'), 'btn-ghost btn-block', function () { JOGO.PremioAnuncio.abre(); }));
      body.appendChild(secPremio);
    }

    // os atalhos só fazem sentido com teclado — no aparelho de toque a seção não aparece
    var toque = safe(function () { return !!(JOGO.Mobile && JOGO.Mobile.toque && JOGO.Mobile.toque()); }, false);
    if (!toque) {
      var at = el('section', 'cfg-sec');
      at.appendChild(el('h3', 'bk-tit', tr('Atalhos de teclado')));
      var lista = el('dl', 'cfg-atalhos');
      [['I', tr('abre e fecha o inventário')], [tr('Esc'), tr('fecha a ficha aberta')],
       [tr('Tab'), tr('anda pelos botões da ficha; Enter ou Espaço aperta')]]
        .concat(mestreAtivo() ? [['M', tr('abre e fecha o Painel do Mestre (a Caixa, os jogadores, os eventos, o grimório…)')],
                                 ['F9', tr('o mesmo painel, de qualquer tela (também Ctrl+Alt+M)')]] : [])
        .forEach(function (a) {
          lista.appendChild(el('dt', null, '<kbd class="tecla">' + a[0] + '</kbd>'));
          lista.appendChild(el('dd', null, a[1]));
        });
      at.appendChild(lista);
      body.appendChild(at);
    }

    /* 15/10: COMUNIDADE E AJUDA (js/core/avaliacao.js) — avaliar na loja (a caixa nativa no app, a página da
     * Play na web), falar com a equipe por e-mail, e a comunidade quando o dono puser o endereço */
    var Av = JOGO.Avaliacao;
    if (Av) {
      var com = el('section', 'cfg-sec');
      com.appendChild(el('h3', 'bk-tit', tr('Comunidade e ajuda')));
      com.appendChild(btn(tr('Avaliar na Google Play'), 'btn-ghost btn-block', function () {
        Av.avaliar().then(function (como) {
          if (como === 'nativo') toast(tr('Obrigado! Se a caixa não abriu, a Play decide quando mostrar.'));
          safe(function () { JOGO.EventosUso.anota('avaliacao_botao'); }, null);
        });
      }));
      if (safe(function () { return JOGO.Convite && JOGO.Convite.disponivel(); }, false)) {
        com.appendChild(btn(tr('Convidar um amigo'), 'btn-ghost btn-block', function () {
          JOGO.Convite.carrega().then(function (d) {
            if (!d) { toast(tr('O convite precisa da conta do site.')); return; }
            JOGO.Convite.manda().then(function (como) { if (como === 'copiou') toast(tr('Convite copiado — cole onde quiser.'), 'good'); });
          });
        }));
      }
      var mail = el('a', 'btn btn-ghost btn-block', tr('Falar com a equipe'));
      mail.href = 'mailto:' + Av.LINKS.email + '?subject=' + encodeURIComponent('SOTERRA');
      com.appendChild(mail);
      if (Av.LINKS.comunidade) {
        var cm = el('a', 'btn btn-ghost btn-block', tr('Entrar na comunidade'));
        cm.href = Av.LINKS.comunidade; cm.target = '_blank'; cm.rel = 'noopener';
        com.appendChild(cm);
      }
      body.appendChild(com);
    }
    var conta = el('section', 'cfg-sec');
    conta.appendChild(el('h3', 'bk-tit', tr('Conta')));
    conta.appendChild(btn(tr('Contas e nuvem'), 'btn-ghost btn-block', function () { openSheet('contas'); }));
    // 08/10: sair da conta sem entrar na ficha (o dono pediu o atalho direto)
    if (safe(function () { return JOGO.Sessao && JOGO.Sessao.ativa && JOGO.Sessao.ativa(); }, false)) {
      conta.appendChild(btn(tr('Sair da conta'), 'btn-ghost btn-block menu-sair-conta', function () { sairDaConta(); }));
    }
    body.appendChild(conta);
    var ver = safe(function () { return window.SOTERRA_VERSAO.versao; }, null);
    body.appendChild(el('p', 'cfg-versao', tr('SOTERRA — Ecos do Mundo Enterrado{a}', { a: ver ? tr(' · versão {v}', { v: esc(ver) }) : '' })));
  }

  /* SAIR DA CONTA (04/10, "sair é sair"; 08/10, o dono: "achei muito ruim trocar de conta: tem que ir em
   * Configurações → Conta e nuvem → Sair — queria um botão no menu direto"): a mesma saída, num lugar só,
   * chamada pela ficha Contas e pelo botão do menu. Pergunta antes; o save da conta sai deste navegador
   * junto com a sessão e a página vai para a tela de entrar. */
  function sairDaConta() {
    var Sx = JOGO.Sessao, Nx = JOGO.Nuvem;
    if (!Sx || !Nx || !Nx.sair) { toast(tr('Sem conta do site para sair.')); return; }
    confirmSheet(tr('Sair da conta?'),
      tr('Você sai desta conta neste navegador e o jogo dela fecha aqui. O progresso fica guardado no servidor: para voltar, entre de novo com a sua senha.'),
      function () {
        Nx.sair().then(function () {
          if (Sx.semRecarga) { if (sheetName === 'contas') sheetContas(); return; }
          safe(function () { return Sx.marcaVolta && Sx.marcaVolta(); }, false);   // no ar: entrar de novo volta ao jogo
          safe(function () { window.sessionStorage.setItem(Sx.CHAVE_AVISO, Sx.FRASE_SAIU); return true; }, false);
          safe(function () { if (window.__boot && window.__boot.recarregando) window.__boot.recarregando('sessao'); return true; }, false);
          safe(function () { location.href = Sx.paginaConta() + '#entrar'; return true; }, false);
        });
      });
  }
  function sheetContas() {
    // 06/10 (somente online, "tem que exigir conta sempre"): NO AR não existe conta local — a lista, o
    // "Criar conta nova" e a conta local do Mestre são de casa e das provas (JOGO.Contas.noAr)
    var noAr = safe(function () { return !!(JOGO.Contas && JOGO.Contas.noAr && JOGO.Contas.noAr()); }, false);
    var body = sheetShell(noAr ? tr('Conta') : tr('Contas'),
      noAr ? tr('A sua conta e o save dela, guardado no servidor.')
           : tr('Cada conta tem seu save e seu cofre. Trocar recarrega a página.'));
    sheetName = 'contas';
    var C = JOGO.Contas;
    if (!C) { body.appendChild(el('p', 'empty', tr('O Banco de Contas não carregou.'))); return; }
    var atual = C.ativa();
    if (!noAr) {
    var caixa = el('div', 'contas-lista');
    C.lista().forEach(function (c) {
      var linha = el('button', 'conta-linha' + (c.id === atual ? ' is-on' : ''));
      linha.type = 'button';
      linha.appendChild(el('b', null, esc(c.rotulo || c.id)));
      if (C.ehMestre && C.ehMestre(c.id)) linha.appendChild(el('span', 'chip chip-ok', 'GM'));
      linha.appendChild(el('span', null,
        c.id === atual ? tr('esta janela') : tr('tocar para trocar')));
      tap(linha, function () {
        if (c.id === atual) return;
        confirmSheet(tr('Trocar para “{a}”?', { a: esc(c.rotulo || c.id) }),
          tr('A página recarrega com a outra conta. O que está aberto agora não se perde — cada conta guarda o seu.'),
          function () { C.trocar(c.id); });
      });
      caixa.appendChild(linha);
    });
    body.appendChild(caixa);
    body.appendChild(btn(tr('Criar conta nova'), 'btn-primary btn-block', function () {
      var id = safe(function () { return C.cria(); }, null);
      if (id) C.trocar(id);
    }));
    // A CONTA DO MESTRE (03/09): só aparece com o modo GM já ligado nesta
    // máquina (a chave também a registra sozinha — este é o caminho manual)
    if (JOGO.GM && safe(function () { return JOGO.GM.ativo(); }, false) && C.criaMestre &&
        !(C.ehMestre && C.ehMestre(C.MESTRE))) {
      body.appendChild(btn(tr('⚔ Criar a conta do Mestre do Fundo'), 'btn-gold btn-block', function () {
        var idM = safe(function () { return C.criaMestre(); }, null);
        if (idM) C.trocar(idM);
      }));
    }
    }
    // A NUVEM (10/09): o save no cartório do servidor — logado pelo site, o
    // jogo puxa ao abrir e sobe a cada gravação; aqui só o estado e as portas.
    var Sx = JOGO.Sessao, Nx = JOGO.Nuvem;
    if (Sx && Nx) {
      var estN = safe(function () { return Nx.estado(); }, null) || {};
      var caixaN = el('div', 'nuvem-caixa');
      caixaN.appendChild(el('h3', 'nuvem-titulo', tr('☁ Nuvem')));
      if (estN.sessao && estN.principal === false) {
        caixaN.appendChild(el('p', 'contas-nota',
          tr('A Nuvem vale só na conta <b>Principal</b> desta máquina. Esta conta é local: o save dela fica só aqui (serve para testar dois jogadores no mesmo PC).')));
      } else if (estN.sessao && estN.conta) {
        var txtN = tr('Logado como <b>{a}</b> · save versão {b}', { a: esc(estN.conta.nome || '?'), b: estN.versao || 0 });
        if (estN.conta.gm === true) txtN += tr(' <span class="chip chip-ok">Mestre do Fundo</span>');
        if (estN.erro) txtN += '<br><span class="chip chip-diff">' + esc(estN.erro) + '</span>';
        else if (estN.pendente || estN.subindo) txtN += ' · <span class="chip">subindo…</span>';
        else if (estN.ultimaSubida) txtN += tr(' · <span class="chip chip-ok">em dia</span>');
        caixaN.appendChild(el('p', 'contas-nota', txtN));
        var linhaN = el('div', 'nuvem-botoes');
        linhaN.appendChild(btn(estN.parada ? tr('Tentar de novo') : tr('Sincronizar agora'), 'btn-primary', function () {
          var pN = estN.parada ? Nx.retomar() : Nx.iniciar();
          pN.then(function () { if (sheetName === 'contas') sheetContas(); });
        }));
        // 04/10, "sair é sair": o save da conta sai deste navegador junto com a sessão (antes ficava, e o
        // jogo sem conta abria com ele); a página vai para a tela de entrar
        linhaN.appendChild(btn(tr('Sair da conta'), '', function () { sairDaConta(); }));
        caixaN.appendChild(linhaN);
        // 02/10: os direitos do titular (servidor/privacidade.py): os documentos, baixar os dados, excluir
        caixaN.appendChild(linksLegais());
        var linhaP = el('div', 'nuvem-botoes');
        linhaP.appendChild(btn(tr('Baixar meus dados'), '', baixaMeusDados));
        linhaP.appendChild(btn(tr('Excluir conta…'), 'btn-warn', function () { sheetExcluirConta(estN.conta); }));
        caixaN.appendChild(linhaP);
      } else {
        caixaN.appendChild(el('p', 'contas-nota',
          tr('Sem conta no servidor: o save vive só nesta máquina. Crie a conta ou entre pelo site — o jogo passa a guardar o save lá e abre o mesmo em qualquer PC.')));
        var aN = el('a', 'btn btn-primary btn-block', tr('Entrar ou criar conta'));
        aN.href = safe(function () { return Sx.paginaConta(); }, 'site/conta.html');
        aN.target = '_blank';
        aN.rel = 'noopener';
        caixaN.appendChild(aN);
        caixaN.appendChild(linksLegais());
      }
      body.appendChild(caixaN);
    }
    if (!noAr) body.appendChild(el('p', 'contas-nota',
      tr('<b>Dois jogadores na mesma máquina:</b> deixe esta janela numa conta, abra OUTRA janela do mesmo navegador no mesmo endereço e troque lá para outra conta — os dois se veem no Acampamento (fantasma, chat, troca, arena). Atalho: abrir a segunda janela já com <b>?conta=2</b> no fim do endereço.')));
  }

  /* OS DIREITOS DO TITULAR NO JOGO (02/10, LGPD; servidor/privacidade.py). A ficha
   * Contas, logada, ganha os links dos Termos e da Política (abrem no site, noutra
   * aba), "Baixar meus dados" (o JSON de tudo o que o servidor guarda, entregue como
   * arquivo) e "Excluir conta…", que abre a ficha de confirmação forte: o nome EXATO
   * da conta e a senha, conferidos de novo no servidor. Excluída, a Nuvem para (a
   * sessão já morreu lá) e o save LOCAL desta máquina fica como está — a ficha diz.
   * Os campos são da ficha (sheet), que já decide pointer-events: nenhuma camada nova. */
  function linksLegais() {
    var Sx = JOGO.Sessao;
    var p = el('p', 'contas-nota contas-legal');
    function liga(rotulo, fn, reserva) {
      var a = el('a', null, rotulo);
      a.href = safe(function () { return Sx[fn](); }, reserva);
      a.target = '_blank';
      a.rel = 'noopener';
      return a;
    }
    p.appendChild(liga(tr('Termos de Uso'), 'paginaTermos', 'site/termos.html'));
    p.appendChild(document.createTextNode(' · '));
    p.appendChild(liga(tr('Política de Privacidade'), 'paginaPrivacidade', 'site/privacidade.html'));
    return p;
  }
  function baixaMeusDados() {
    var Sx = JOGO.Sessao;
    if (!Sx || !Sx.meusDados) return;
    toast(tr('juntando os seus dados…'));
    Sx.meusDados().then(function (r) {
      if (!r || !r.ok || !r.dados) { toast((r && r.erro) || tr('não deu para juntar os dados')); return; }
      try {
        var blob = new Blob([JSON.stringify(r.dados, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        var d = new Date();
        a.href = URL.createObjectURL(blob);
        a.download = 'soterra-meus-dados-' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) +
          ('0' + d.getDate()).slice(-2) + '.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 1000);
        toast(tr('arquivo dos seus dados baixado'));
      } catch (eB) {
        toast(tr('o navegador não deixou salvar o arquivo'));
      }
    });
  }
  function sheetExcluirConta(conta) {
    var Sx = JOGO.Sessao, Nx = JOGO.Nuvem;
    var nomeConta = (conta && typeof conta.nome === 'string') ? conta.nome : '';
    var body = sheetShell(tr('Excluir a conta'), tr('Isto não tem volta.'));
    sheetName = 'excluir-conta';
    body.appendChild(el('p', 'contas-nota',
      tr('O save no servidor, os itens, os personagens, as barras de ouro e os vinténs somem para sempre. Fica só o registro dos pagamentos, sem o seu nome e o seu e-mail. Se lidera uma guilda, a liderança passa ao membro mais antigo. Quer o arrependimento de uma compra? Peça <b>antes</b>.')));
    body.appendChild(el('p', 'contas-nota', tr('Para confirmar, digite o nome da conta, <b>{a}</b>, e a senha.', { a: esc(nomeConta) })));
    function campo(tipo, rotulo, ac) {
      var c = document.createElement('input');
      c.type = tipo;
      c.className = 'bk2-qtd excluir-campo';
      c.placeholder = rotulo;
      c.setAttribute('aria-label', rotulo);
      c.setAttribute('autocomplete', ac);
      c.spellcheck = false;
      body.appendChild(c);
      return c;
    }
    var nome = campo('text', tr('nome da conta'), 'off');
    var senha = campo('password', 'senha', 'current-password');
    var aviso = el('p', 'contas-nota excluir-aviso', '');
    body.appendChild(aviso);
    var ocupado = false;
    var acts = el('div', 'confirm-acts');
    acts.appendChild(btn(tr('Voltar'), 'btn-ghost', function () { sheetContas(); }));
    var vai = btn(tr('Excluir para sempre'), 'btn-warn', function () {
      if (desligado() || !Sx || !Sx.excluir) return;   // 03/10 (revisão): o apagado não dispara
      ocupado = true;
      confere();
      aviso.textContent = tr('excluindo…');
      Sx.excluir(nome.value.trim(), senha.value).then(function (r) {
        ocupado = false;
        senha.value = '';
        if (!r || !r.ok) {
          aviso.textContent = (r && r.erro) || tr('não deu para excluir a conta');
          confere();
          return;
        }
        // a sessão já saiu (Sessao.excluir); a Nuvem para de tentar subir o save
        safe(function () { if (Nx && Nx.sair) Nx.sair(); }, null);
        var fim = sheetShell(tr('Conta excluída'), tr('A conta saiu do servidor.'));
        sheetName = 'excluir-conta';
        fim.appendChild(el('p', 'contas-nota',
          tr('O save desta máquina continua aqui, só neste navegador. Para apagá-lo, limpe os dados do site no navegador.')));
        fim.appendChild(btn(tr('Fechar'), 'btn-primary btn-block', function () { sheetContas(); }));
      });
    });
    acts.appendChild(vai);
    body.appendChild(acts);
    function desligado() { return ocupado || !nomeConta || nome.value.trim() !== nomeConta || !senha.value; }
    // 03/10 (revisão): o is-off é só aparência (sem pointer-events: none); o disabled faz o botão apagado não
    // disparar e o leitor de tela anunciar que está desligado — como o site (site/conta_privacidade.js)
    function confere() {
      var off = desligado();
      vai.classList.toggle('is-off', off);
      vai.disabled = off;
    }
    nome.addEventListener('input', confere);
    senha.addEventListener('input', confere);
    confere();
  }

  /* O PERFIL PÚBLICO (pedido 25/08): a ficha de outro jogador da praça —
   * tudo o que o `resumo` da Rede carrega: classes com níveis, total, brasa
   * (com a coroa do degrau) e partidas. É o que transforma um boneco andando
   * em uma pessoa. `par` vem de R.pares() pelo toque no fantasma. */
  function sheetPerfil(par) {
    if (!par) { closeSheet(); return; }
    var body = sheetShell(par.nome || tr('Jogador'),
      par.titulo ? '«' + titExibe(par.titulo) + '»' : tr('jogador da praça'));
    sheetName = 'perfil';
    var r = par.resumo || {};

    var topo = el('div', 'perfil-topo');
    // SOB DEMANDA: o corpo próprio da fusão do visitante desce agora, e a
    // ficha se repinta quando ele chegar (se ainda for esta ficha)
    var Bpf = JOGO.Bundle;
    if (Bpf && Bpf.pede && Bpf.corpoDe) {
      try {
        Bpf.pede([Bpf.corpoDe(par.classe)], function (falhas) {
          if (!falhas.length && sheetName === 'perfil' && document.body.contains(topo)) sheetPerfil(par);
        });
      } catch (ePf) {}
    }
    topo.appendChild(art('unit', [par.classe, { element: 'neutro', dir: 0, scale: 0.7 }], 110));
    var col = el('div', 'perfil-col');

    // a coroa da arena — 04/10: em todo nível (sem partida, a Coroa I), como na plaquinha
    var tier = null;
    if (JOGO.Brasa && typeof r.brasa === 'number') {
      // 08/10 à noite: o Mestre conferido (o `mestre` que o Relé carimba) aparece com a coroa DELE, fixa
      tier = JOGO.Brasa.coroaDe(r.brasa, r.partidas, false, false, par.mestre === true);
    }
    if (tier && tier.mestre) {
      // a coroa do Mestre não tem bilhete PNG: a marca em vermelho e o nome dela
      var lcM = el('div', 'perfil-coroa perfil-coroa-mestre');
      lcM.appendChild(el('span', 'perfil-coroa-marca', '♛'));
      lcM.appendChild(el('span', null, tr('<b>{a}</b> · fixa, só do Mestre', { a: esc(tier.nome) })));
      col.appendChild(lcM);
    } else if (tier && JOGO.COROAS_PVP && JOGO.COROAS_PVP[tier.id]) {
      var lc = el('div', 'perfil-coroa');
      var img = document.createElement('img');
      img.src = 'data:image/png;base64,' + JOGO.COROAS_PVP[tier.id];
      img.alt = tier.nome;
      lc.appendChild(img);
      lc.appendChild(el('span', null, ((r.partidas || 0) === 1
        ? tr('<b>{a}</b> · {brasa} pts · {b} partida', { a: esc(tier.nome), brasa: r.brasa, b: r.partidas || 0 })
        : tr('<b>{a}</b> · {brasa} pts · {b} partidas', { a: esc(tier.nome), brasa: r.brasa, b: r.partidas || 0 }))));
      col.appendChild(lc);
    } else {
      col.appendChild(el('div', 'perfil-coroa is-sem',
        (r.partidas > 0 ? tr('{a} pts na arena', { a: r.brasa || '?' }) : tr('nunca pisou na arena'))));
    }
    // a GALERIA de temporadas (25/08): a melhor coroa que a conta já teve
    var gal = r.galeria || {};
    var melhorG = 0;
    Object.keys(gal).forEach(function (t2) { if (gal[t2] > melhorG) melhorG = gal[t2]; });
    if (melhorG > 0) {
      var nomeG = tr('Coroa {melhorG}', { melhorG: melhorG });
      ((JOGO.Brasa && JOGO.Brasa.TIERS) || []).forEach(function (tie) {
        if (tie.nivel === melhorG) nomeG = tie.nome;
      });
      col.appendChild(el('div', 'perfil-galeria',
        tr('galeria: já alcançou <b>{a}</b>', { a: esc(nomeG) })));
    }
    // a guilda (25/08): o clã com que essa pessoa anda
    if (r.guilda && r.guilda.nome) {
      var lnG = el('div', 'perfil-guilda');
      var B0 = BR();
      if (B0 && B0.ehCodigo(r.guilda.emblema)) lnG.appendChild(elShield(r.guilda.emblema, 20));
      lnG.appendChild(el('b', null, esc(txtGuilda(r.guilda.emblema, r.guilda.nome))));
      col.appendChild(lnG);
    }
    // o Poço sem Fundo (25/08): o quão fundo essa pessoa já foi
    if (r.poco && (r.poco.recorde > 0 || r.poco.semanaMelhor > 0)) {
      col.appendChild(el('div', 'perfil-poco',
        tr('Poço: andar <b>{a}</b> na semana · recorde <b>{b}</b>', { a: r.poco.semanaMelhor || 0, b: r.poco.recorde || 0 })));
    }
    col.appendChild(el('div', 'perfil-total',
      tr('nível somado: <b>{a}</b>', { a: r.total || 0 })));
    topo.appendChild(col);
    body.appendChild(topo);

    var cls = r.classes || {};
    var tem = false;
    var caixa = el('div', 'perfil-classes');
    Object.keys(cls).sort(function (a, b) { return cls[b] - cls[a]; }).forEach(function (cid) {
      tem = true;
      var row = el('div', 'perfil-classe');
      row.appendChild(el('b', null, esc(className(cid))));
      row.appendChild(el('span', null, tr('Nv') + ' ' + cls[cid]));
      caixa.appendChild(row);
    });
    body.appendChild(el('h3', 'perfil-h', tr('Classes liberadas')));
    body.appendChild(tem ? caixa : el('p', 'empty', tr('nada que a Rede saiba contar')));
    // 02/10: denunciar à Equipe (js/ui/moderacao.js)
    if (JOGO.Denuncia && typeof par.nuvem === 'number') {
      body.appendChild(JOGO.Denuncia.botao({ conta: par.nuvem, nome: par.nome, heroId: par.id, onde: 'perfil' }, null, 'btn btn-ghost'));
    }
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
  var GUILDA_NOMES_A = [tr('Lâminas'), tr('Filhos'), tr('Guarda'), tr('Coro'), tr('Mãos'), tr('Olhos'),
    tr('Sombras'), tr('Herdeiros'), tr('Vigias'), tr('Cães'), tr('Corvos'), tr('Reis'), tr('Ecos'),
    tr('Chamas'), tr('Raízes'), tr('Presas'), tr('Martelos'), tr('Escudos'), tr('Andarilhos'), tr('Sentinelas')];
  var GUILDA_NOMES_B = [tr('do Fundo'), tr('da Lousa'), tr('da Brasa'), tr('do Poço'),
    tr('da Cisterna'), tr('da Estufa'), tr('do Coração'), tr('da Descida'), tr('do Turno'),
    tr('do Vento'), tr('da Salmoura'), tr('do Mundo Enterrado'), tr('da Forja'), tr('do Sal'),
    tr('do Breu'), tr('da Maré'), tr('do Andaime'), tr('da Mina'), tr('da Aurora Cega'), tr('do Último Fecho')];
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
  /* O BRASÃO: o desenho mora em js/ui/brasao.js — a ficha, a plaquinha da
   * praça e o ranking pintam o MESMO escudo. Sem o arquivo (páginas velhas
   * que carregam só a HUD), sobra o texto do emblema. */
  function BR() { return JOGO.Brasao || null; }
  function elShield(code, size) {
    var B = BR();
    if (B && B.ehCodigo(code)) return B.canvas(code, size);
    // guilda de antes dos vetores (um emoji) — ou página sem o brasao.js
    var sp = el('span', null, esc(code == null ? '' : code));
    sp.style.cssText = 'display:inline-block;width:' + size + 'px;text-align:center;font-size:' +
      Math.round(size * 0.7) + 'px;';
    return sp;
  }
  /* Emblema + nome numa LINHA DE TEXTO (toast, convite, ranking): o código do
   * brasão não é para ser lido — some da frase, e quem pode desenhar desenha. */
  function txtGuilda(emblema, nome) {
    var B = BR();
    if (B) return B.nomeComEmblema(emblema, nome);
    return (emblema ? emblema + ' ' : '') + (nome == null ? '' : nome);
  }

  /* A OFICINA DO BRASÃO (11/09) — "não consigo mudar a cor da borda, símbolo
   * e fundo".
   *
   * O <input type="color"> foi tentado duas vezes e não abre em todo lugar
   * que o jogo roda (a janela nativa de cor simplesmente não sobe dentro do
   * APK e de algumas janelas embutidas), então o jogador ficava preso nas
   * cores de fábrica. A escolha de cor agora é NOSSA: uma fileira de campos
   * (fundo, símbolo, borda, 2ª cor), a paleta de 40 toques e três cursores
   * de matiz/saturação/brilho para qualquer cor que a paleta não tenha.
   * Nada de janela do sistema, nada de plataforma para dar errado.
   *
   * A grade repinta só a si mesma; os cursores nem isso — mexem o desenho
   * sem refazer a página, senão o dedo perde o cursor no meio do arrasto. */
  var guildaCorAtiva = 2;          // qual campo do código as cores mexem (2 = fundo)
  function pintaBrasaoEditor(box) {
    var B = BR();
    if (!B) return;
    guildaEmblemaEscolhido = B.ehCodigo(guildaEmblemaEscolhido)
      ? B.normaliza(guildaEmblemaEscolhido) : B.PADRAO;
    var p = B.partes(guildaEmblemaEscolhido);
    function salva() { guildaEmblemaEscolhido = p.join('|'); }
    function cod(troca) {          // uma variação do brasão atual, para as amostras
      var q = p.slice();
      for (var k in troca) if (Object.prototype.hasOwnProperty.call(troca, k)) q[k] = troca[k];
      return q.join('|');
    }
    clear(box);

    var previa = B.canvas(guildaEmblemaEscolhido, 96);
    previa.className = 'brasao-previa';
    box.appendChild(previa);
    function repinta() {
      var nova = B.canvas(guildaEmblemaEscolhido, 96);
      nova.className = 'brasao-previa';
      box.replaceChild(nova, previa);
      previa = nova;
    }

    // ---- as CORES: o campo escolhido, a paleta e os três cursores
    var CAMPOS = [{ i: 2, nome: tr('Fundo') }, { i: 4, nome: tr('Símbolo') }, { i: 3, nome: tr('Borda') }];
    if (p[6] !== '0') CAMPOS.push({ i: 7, nome: '2ª cor' });   // só há 2ª cor com campo partido
    var vivo = false;
    CAMPOS.forEach(function (c) { if (c.i === guildaCorAtiva) vivo = true; });
    if (!vivo) guildaCorAtiva = 2;

    var linhaC = el('div', 'brasao-campos');
    var amostras = {};
    CAMPOS.forEach(function (c) {
      var b = btn('', 'brasao-campo' + (c.i === guildaCorAtiva ? ' is-on' : ''), function () {
        guildaCorAtiva = c.i;
        pintaBrasaoEditor(box);
      });
      var quad = el('span', 'brasao-quad');
      quad.style.background = p[c.i];
      b.appendChild(quad);
      b.appendChild(el('span', 'brasao-campo-nm', c.nome));
      amostras[c.i] = quad;
      linhaC.appendChild(b);
    });
    box.appendChild(linhaC);

    var hexTxt = el('span', 'brasao-hex', esc(p[guildaCorAtiva]));
    function poeCor(cor) {
      p[guildaCorAtiva] = cor;
      salva();
      if (amostras[guildaCorAtiva]) amostras[guildaCorAtiva].style.background = cor;
      hexTxt.innerHTML = esc(cor);
      repinta();
    }

    var grade = el('div', 'brasao-paleta');
    B.PALETA.forEach(function (cor) {
      // repinta inteiro: as amostras de forma, campo e símbolo também usam a
      // cor nova — se só a prévia mudasse, a grade ficaria mentindo
      var b = btn('', 'brasao-cor', function () { poeCor(cor); pintaBrasaoEditor(box); });
      b.style.background = cor;
      b.title = cor;
      grade.appendChild(b);
    });
    box.appendChild(grade);

    var hsl0 = B.hexParaHsl(p[guildaCorAtiva]);
    function cursor(cls, max, val) {
      var r = document.createElement('input');
      r.type = 'range'; r.min = '0'; r.max = String(max); r.value = String(Math.round(val));
      r.className = 'brasao-cursor ' + cls;
      // no ARRASTO, só a prévia muda (refazer a grade no meio do gesto tira o
      // cursor de baixo do dedo); ao SOLTAR, as amostras se acertam
      r.addEventListener('input', function () {
        poeCor(B.hslParaHex(+curH.value, curS.value / 100, curL.value / 100));
      });
      r.addEventListener('change', function () { pintaBrasaoEditor(box); });
      return r;
    }
    var curH = cursor('is-matiz', 360, hsl0.h);
    var curS = cursor('is-sat', 100, hsl0.s * 100);
    var curL = cursor('is-luz', 100, hsl0.l * 100);
    var caixaCur = el('div', 'brasao-cursores');
    caixaCur.appendChild(curH); caixaCur.appendChild(curS); caixaCur.appendChild(curL);
    caixaCur.appendChild(hexTxt);
    box.appendChild(caixaCur);

    // ---- FORMA, DIVISÃO e SÍMBOLO: cada botão é o brasão de verdade com
    // aquela peça trocada — escolhe-se vendo, não lendo
    function secao(titulo, escolhido, itens, monta) {
      // o nome do que está escolhido ao lado do título: no toque não existe
      // passar o mouse por cima para descobrir como a peça se chama
      box.appendChild(el('div', 'brasao-tit',
        esc(titulo) + ' <span class="brasao-tit-nm">' + esc(escolhido) + '</span>'));
      var linha = el('div', 'brasao-linha');
      itens.forEach(function (it) { linha.appendChild(monta(it)); });
      box.appendChild(linha);
    }
    function opcao(ligado, titulo, amostra, aoTocar) {
      var b = btn('', 'brasao-op' + (ligado ? ' is-on' : ''), aoTocar);
      b.title = titulo;
      b.appendChild(amostra);
      return b;
    }

    secao(tr('Forma'), B.forma(p[1]).nome, B.FORMAS, function (fm) {
      return opcao(p[1] === fm.id, fm.nome, B.canvas(cod({ 1: fm.id }), 34), function () {
        p[1] = fm.id; salva(); pintaBrasaoEditor(box);
      });
    });
    secao(tr('Campo'), B.divisao(p[6]).nome, B.DIVISOES, function (dv) {
      // sem símbolo na amostra: o que se escolhe aqui é o corte do campo
      return opcao(p[6] === dv.id, dv.nome, B.canvas(cod({ 5: '-', 6: dv.id }), 34), function () {
        p[6] = dv.id; salva(); pintaBrasaoEditor(box);
      });
    });
    var comVazio = [{ id: '-', nome: tr('Sem símbolo') }].concat(B.SIMBOLOS);
    var sbAtual = B.simbolo(p[5]);
    secao(tr('Símbolo'), sbAtual ? sbAtual.nome : tr('Sem símbolo'), comVazio, function (sb) {
      return opcao(p[5] === sb.id, sb.nome, B.canvas(cod({ 5: sb.id }), 34), function () {
        p[5] = sb.id; salva(); pintaBrasaoEditor(box);
      });
    });
  }

  /* ---- AMIGOS E INIMIGOS (13/09, dono: "no menu inferior deve ter uma lista
   * de amigos e inimigos; os amigos mostram quando estão online e se estão em
   * batalha; os inimigos não podem mandar mensagem nem troca, mas podem
   * desafiar pvp"). A lista vem do cartório (JOGO.Amigos); o online, do relé
   * (R.pedeAmigos), pedido de novo a cada 10 s enquanto a ficha está aberta. */
  var amigosAba = 'amigos', amigosTimer = null;
  function sheetAmigos() {
    var body = sheetShell(tr('Amigos'), tr('Quem está online e em batalha — e quem você não quer por perto.'));
    sheetName = 'amigos';
    var Am = JOGO.Amigos, R = JOGO.Rede;
    if (!Am || !Am.pode()) {
      body.appendChild(el('p', 'empty', tr('Entre na sua conta para ter amigos e inimigos.')));
      return;
    }
    // 02/10: as duas listas viram ABAS de verdade (mesma pílula das outras fichas)
    var abas = el('div', 'am-abas abas-fila');
    [['amigos', tr('Amigos')], ['inimigos', tr('Inimigos')]].forEach(function (a) {
      var on = amigosAba === a[0];
      var bA = btn(a[1], 'btn-tab' + (on ? ' is-on' : ''), function () {
        amigosAba = a[0];
        sheetAmigos();
      });
      bA.setAttribute('aria-pressed', on ? 'true' : 'false');
      abas.appendChild(bA);
    });
    body.appendChild(abas);

    var add = el('div', 'am-add');
    var inp = document.createElement('input');
    inp.className = 'hub-input';
    inp.maxLength = 40;
    inp.placeholder = amigosAba === 'amigos' ? tr('nome de quem adicionar') : tr('nome do inimigo');
    function adiciona() {
      var n = inp.value.trim();
      if (!n) return;
      Am.definir({ nome: n }, amigosAba === 'amigos' ? 'amigo' : 'inimigo').then(function (r) {
        toast(r.ok ? n + (amigosAba === 'amigos' ? tr(' entrou nos amigos.') : tr(' entrou nos inimigos.'))
                   : (r.erro || tr('não deu')), r.ok ? 'good' : undefined);
        if (r.ok) inp.value = '';
      });
    }
    inp.addEventListener('keydown', function (ev) {
      ev.stopPropagation();                             // a letra não abre atalho
      if (ev.key === 'Enter') adiciona();
    });
    add.appendChild(inp);
    add.appendChild(btn(tr('Adicionar'), 'btn-mini btn-gold', adiciona));
    body.appendChild(add);
    body.appendChild(el('p', 'inv-dica', amigosAba === 'amigos'
      ? tr('Também dá para adicionar tocando na pessoa na praça. No chat: <b>/Nome mensagem</b> manda particular.')
      : tr('Inimigo não manda mensagem particular nem propõe troca a você (nem você a ele) — mas duelo vale.')));
    if (amigosAba === 'amigos') body.appendChild(blocoConvite());   // 15/10: o link que chama um amigo

    var caixa = el('div', 'am-lista');
    body.appendChild(caixa);
    function pinta() {
      if (sheetName !== 'amigos' || !caixa.isConnected) return;
      clear(caixa);
      var L = Am.lista();
      var itens = (amigosAba === 'amigos' ? L.amigos : L.inimigos).slice();
      if (!itens.length) {
        caixa.appendChild(el('p', 'empty', amigosAba === 'amigos' ? tr('Nenhum amigo ainda.') : tr('Nenhum inimigo.')));
        return;
      }
      itens.sort(function (a, b) {                       // quem está online primeiro
        var sa = Am.status(a.conta), sb = Am.status(b.conta);
        return (sb && sb.online ? 1 : 0) - (sa && sa.online ? 1 : 0);
      });
      itens.forEach(function (a) {
        var st = Am.status(a.conta);
        var on = !!(st && st.online);
        var luta = on && st.luta;
        var linha = el('div', 'am-linha' + (on ? ' is-on' : ''));
        var nm = el('div', 'am-nome');
        nm.appendChild(el('i', 'am-bola' + (luta ? ' is-luta' : on ? ' is-on' : ''), ''));
        nm.appendChild(el('span', 'am-nm', esc(a.nome || '?')));
        if (a.nivel) nm.appendChild(el('span', 'am-nv', 'nv ' + a.nivel));
        linha.appendChild(nm);
        linha.appendChild(el('span', 'am-estado' + (luta ? ' is-luta' : on ? ' is-on' : ''),
          !on ? 'offline' : luta ? tr('⚔ em batalha') : st.sala ? tr('num calabouço') : tr('na praça')));
        var acts = el('div', 'am-acts');
        if (amigosAba === 'amigos') {
          acts.appendChild(btn(tr('Mensagem'), 'btn-mini btn-ghost' + (on && st.id ? '' : ' is-apagado'), function () {
            if (!on || !st.id) { toast(tr('{nome} está offline.', { nome: a.nome })); return; }
            closeSheet();
            armaSussurro(st.id, a.nome);
          }));
        } else {
          acts.appendChild(btn(tr('Desafiar'), 'btn-mini btn-ghost' + (on && st.id ? '' : ' is-apagado'), function () {
            if (!on || !st.id) { toast(tr('{nome} está offline.', { nome: a.nome })); return; }
            var r = safe(function () { return Dl().desafiar(st.id); }, null);
            if (r && r.ok) toast(tr('Desafio enviado a {nome}. Esperando a resposta…', { nome: a.nome }));
            else toast(textoMotivo(r ? r.motivo : 'ocupado', null));
          }));
        }
        // 02/10: denunciar à Equipe direto da lista (js/ui/moderacao.js)
        if (JOGO.Denuncia) acts.appendChild(JOGO.Denuncia.botao({ conta: a.conta, nome: a.nome, onde: 'amigos' }, null, 'btn btn-mini btn-ghost'));
        acts.appendChild(btn('✕', 'btn-mini btn-ghost am-tira', function () {
          Am.definir({ conta: a.conta }, null).then(function (r) {
            toast(r.ok ? tr('{nome} saiu da lista.', { nome: a.nome }) : (r.erro || tr('não deu')), r.ok ? 'good' : undefined);
          });
        }));
        linha.appendChild(acts);
        caixa.appendChild(linha);
      });
    }
    Am.aoMudar = pinta;
    Am.liga();
    Am.carrega().then(function (r) { if (!r.ok) toast(r.erro || tr('não deu')); pinta(); });
    if (amigosTimer) clearInterval(amigosTimer);
    amigosTimer = setInterval(function () {
      if (sheetName !== 'amigos') { clearInterval(amigosTimer); amigosTimer = null; Am.aoMudar = null; return; }
      if (R && R.pedeAmigos) R.pedeAmigos();
    }, 10000);
    pinta();
  }

  /* A PORTA (04/10, dono: "a personalização da guilda deve ser dentro do salão … o restante
   * fica dentro do salão"). Fora do salão, quem tem guilda não vê a ficha: vê o nome dela e o
   * caminho para o salão. A inscrição na guerra não vem para cá — ela é viva (fila, prazo,
   * confirmação) e mora nos dois painéis que se repintam: a Sede da praça e a mesa do conselho. */
  var hubEhSala = false;
  /* 08/10 à noite: "12/15 membros" — as vagas vêm da ficha (`vagas`; null na guilda da equipe) ou da régua local */
  function vagasDaGuilda(x) {
    if (!x) return null;
    if (x.vagas === null) return null;
    if (typeof x.vagas === 'number') return x.vagas;
    var Gd = JOGO.Guilda;
    return (Gd && Gd.vagasDe && typeof x.nivel === 'number') ? Gd.vagasDe(x.nivel) : null;
  }
  function membrosDeN(n, vagas) { return vagas ? (n + '/' + vagas) : String(n); }
  function portaDaGuilda(caixa, g) {
    caixa.classList.add('guilda-porta');
    var cab = el('div', 'guilda-cab');
    var placa = elShield(g.emblema, 48);
    placa.className = 'guilda-emblema';
    cab.appendChild(placa);
    var ct = el('div', 'guilda-cab-t');
    ct.appendChild(el('h3', null, tr('{a} <i>nível {nivel}</i>', { a: esc(g.nome), nivel: g.nivel })));
    ct.appendChild(el('span', 'guilda-sub', tr('{a} membro(s)', { a: membrosDeN(g.membros.length, vagasDaGuilda(g)) })));
    cab.appendChild(ct);
    caixa.appendChild(cab);
    caixa.appendChild(el('p', 'inv-dica',
      tr('Os membros estão aqui embaixo (o líder e os oficiais mudam o dízimo de cada um). O resto se resolve <b>dentro do salão</b>: os cargos, o mural, o cofre, o banco de empréstimos e a porta ficam no trono e nos pontos de lá.')));
    var naPraca = !hubEhSala && !campoDentro() && !!(JOGO.Hub && typeof JOGO.Hub.entraSede === 'function');
    if (naPraca) {
      caixa.appendChild(btn(tr('Entrar no salão'), 'btn-primary btn-block sede-entrar', pedeEntrarNaSede));
      caixa.appendChild(el('p', 'inv-dica',
        tr('A inscrição na <b>guerra de guilda</b> fica na Sede das Guildas, na praça, e na mesa do conselho do salão.')));
    } else {
      caixa.appendChild(el('p', 'inv-dica', tr('O salão abre pela Sede das Guildas, na praça do acampamento.')));
    }
  }
  /* 04/10: o `resumoGuilda` (o que a Sede da praça e a plaquinha usam para saber se você tem
   * guilda) só era lido ao entrar no Acampamento e ao fundar. Quem entrava numa guilda pela lista,
   * tinha o pedido aceito ou saía ficava com a praça dizendo o contrário da ficha: a Sede oferecia
   * "fundar ou entrar" a quem já era membro, e "Entrar no salão" a quem já tinha saído. Toda vez
   * que a ficha chega do servidor, a praça acompanha. */
  /* O CAIS E A GUILDA (06/10, o dono: "se o jogador não tem guilda, o ícone dele no menu não deve ser
   * clicável; ele só pode criar uma guilda na sede da guilda"). São TRÊS estados — o do meio existe por causa
   * do defeito de 04/10, em que a leitura que falhava virava "sem guilda":
   *   - TEM guilda (resumoGuilda): o botão do cais abre a ficha, como sempre;
   *   - NÃO SE SABE (nenhuma leitura boa desta conta ainda, ou a leitura falhou): o botão fica ACESO — não se
   *     apaga o botão de quem pode ter guilda. O toque abre a ficha, que lê o servidor: com guilda é a porta
   *     do salão; sem guilda ela só diz aonde ir (nada de fundar por ali) e o botão se apaga;
   *   - SEM guilda, respondido pelo servidor (guildaLida): o botão fica apagado (aria-disabled, não `disabled`:
   *     o toque ainda precisa chegar para dar o aviso) e não abre ficha nenhuma.
   * Fundar e entrar é só pela Sede das Guildas da praça: é ela que abre a ficha com 'sede' (guildaPelaSede).
   * A conta do Mestre nunca apaga. Quem muda o `resumoGuilda` chama guildaSoube() e o botão acompanha na hora:
   * fundou, entrou, saiu, foi tirado, a guilda foi desfeita. */
  var guildaLida = false, guildaLidaDe = null, guildaPelaSede = false;
  function avisoSemGuilda() {
    return tr('Você ainda não tem guilda. Vá até a Sede das Guildas, na praça, para fundar ou entrar em uma.');
  }
  function semGuildaSabido() { return guildaLida && !resumoGuilda && !mestreAtivo(); }
  function pintaDockGuilda() {
    var b = dockBotoes && dockBotoes.guilda;
    if (!b) return;
    var apaga = semGuildaSabido();
    b.classList.toggle('is-apagada', apaga);
    if (apaga) { b.setAttribute('aria-disabled', 'true'); b.title = avisoSemGuilda(); }
    else { b.removeAttribute('aria-disabled'); b.removeAttribute('title'); }
  }
  // chegou uma resposta BOA sobre a guilda desta conta (tem ou não tem): o cais acende ou apaga
  function guildaSoube() { guildaLida = true; pintaDockGuilda(); }
  UI._guildaEsquece = function () { guildaLida = false; pintaDockGuilda(); };   // só as provas: volta a "não se sabe"
  function anotaGuilda(g) {
    var era = resumoGuilda ? resumoGuilda.nome + '|' + resumoGuilda.emblema : '';
    resumoGuilda = g ? { nome: g.nome, emblema: g.emblema } : null;
    guildaSoube();
    var eh = resumoGuilda ? resumoGuilda.nome + '|' + resumoGuilda.emblema : '';
    if (era === eh) return;
    if (JOGO.Hub && JOGO.Hub.nomeia) {
      try { JOGO.Hub.nomeia(undefined, undefined, undefined, resumoGuilda); } catch (e) {}
    }
    safe(function () { reanunciaPerfil(); return true; }, null);
  }
  function sheetGuilda() {
    var dentro = sedeDentro();
    var body = sheetShell(tr('Guilda'), dentro
      ? tr('Cofre que só o líder gasta, bônus para todos, e um banco de empréstimos entre membros.')
      : tr('Sem guilda, é aqui que se funda ou se entra numa. Com guilda, tudo se resolve dentro do salão dela.'));
    sheetName = 'guilda';
    var Gd = JOGO.Guilda;
    if (!Gd || !JOGO.DB) { body.appendChild(el('p', 'empty', tr('A guilda não carregou.'))); return; }
    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);

    var contaJ = null;               // sobrevive ao primeiro .then (o banco usa)
    /* 08/10 à noite (o dono: "no menu da guilda, fora dela, os membros podem ver os outros membros, e o chefe e o
 * vice-líder podem mexer nos XP doados"): a grade dos membros aparece também FORA do salão (a porta + a grade);
 * o dízimo de cada um (a parte do XP que ele doa) é do líder E dos oficiais; promover/rebaixar segue do líder. */
    function gradeDosMembros(caixa, g, euId) {
      var podeDizimo = g.meuCargo === 'lider' || g.meuCargo === 'oficial' || !!g.souLider;
        /* ---- OS MEMBROS EM GRADE (13/09, dono: "deve aparecer como se fosse uma
         * grid, ordenado pela classificação do cargo de cada um e depois pela xp
         * doada para a guild"). Colunas: posição, membro, cargo, XP doado e o
         * dízimo — que o LÍDER muda ali mesmo, membro a membro (quem não tem um
         * próprio segue o padrão, com o campo apagado). O líder promove e rebaixa
         * na última coluna; oficial ganha a chave do cofre. */
        var ORDEM_CARGO = { lider: 0, oficial: 1, membro: 2 };
        var dizimoPadrao = Math.floor(g.dizimo || 0);
        var membrosOrd = g.membros.slice().sort(function (a, b) {
          var ca = ORDEM_CARGO[a.cargo] != null ? ORDEM_CARGO[a.cargo] : 2;
          var cb = ORDEM_CARGO[b.cargo] != null ? ORDEM_CARGO[b.cargo] : 2;
          if (ca !== cb) return ca - cb;
          var xa = a.xpDoado || 0, xb = b.xpDoado || 0;
          if (xa !== xb) return xb - xa;
          return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
        });
        var rolo = el('div', 'guilda-grade-rolo');
        var grade = el('div', 'guilda-grade' + (g.souLider ? ' com-acao' : ''));
        var cabG = el('div', 'gg-linha is-cab');
        ['#', tr('Membro'), tr('Cargo'), tr('XP doado'), tr('Dízimo')].concat(g.souLider ? [''] : []).forEach(function (t, i) {
          cabG.appendChild(el('span', ['gg-pos', 'gg-membro', 'gg-cargo-col', 'gg-xp', 'gg-dz', 'gg-acao-col'][i], t));
        });
        grade.appendChild(cabG);
        membrosOrd.forEach(function (m, i) {
          var ehLider = m.cargo === 'lider';
          var ehOficial = m.cargo === 'oficial';
          var ehEu = m.id === euId;
          var linha = el('div', 'gg-linha' + (ehEu ? ' is-eu' : ''));
          linha.appendChild(el('span', 'gg-pos', String(i + 1)));
          var cel = el('span', 'gg-membro');
          cel.appendChild(el('i', 'gg-marca', ehLider ? '⚑' : ehOficial ? '★' : '·'));
          cel.appendChild(el('span', 'gg-nome', esc(m.nome)));
          if (ehEu) cel.appendChild(el('span', 'gg-eu', tr('você')));
          cel.title = m.nome;
          linha.appendChild(cel);
          var celC = el('span', 'gg-cargo-col');
          celC.appendChild(el('span', 'gg-cargo' + (ehLider ? ' is-lider' : ehOficial ? ' is-oficial' : ''),
            ehLider ? tr('Líder') : ehOficial ? tr('Oficial') : tr('Membro')));
          linha.appendChild(celC);
          linha.appendChild(el('span', 'gg-xp', Math.floor(m.xpDoado || 0).toLocaleString('pt-BR')));
          var dzM = typeof m.dizimo === 'number' ? Math.floor(m.dizimo) : dizimoPadrao;
          var celD = el('span', 'gg-dz');
          if (podeDizimo) {
            var dz = document.createElement('input');
            dz.type = 'number'; dz.min = '0'; dz.max = String(Gd.DIZIMO_MAX || 25); dz.step = '1';
            dz.value = String(dzM);
            dz.className = 'hub-input gg-dz-inp' + (m.dizimoProprio ? ' is-proprio' : '');
            dz.title = m.dizimoProprio ? tr('Dízimo próprio de {nome} (vazio volta ao padrão)', { nome: m.nome })
                                       : tr('Segue o padrão da guilda ({dizimoPadrao}%)', { dizimoPadrao: dizimoPadrao });
            dz.setAttribute('aria-label', tr('Dízimo de {nome}', { nome: m.nome }));
            dz.addEventListener('keydown', function (ev) {
              ev.stopPropagation();                         // a letra não abre atalho
              if (ev.key === 'Enter') dz.blur();
            });
            dz.addEventListener('change', function () {
              var bruto = String(dz.value).trim();
              var novo = bruto === '' ? null : Math.floor(Number(bruto));
              if (novo !== null && !(novo >= 0 && novo <= (Gd.DIZIMO_MAX || 25))) {
                toast(tr('o dízimo vai de 0 a {a}%', { a: Gd.DIZIMO_MAX || 25 }));
                dz.value = String(dzM);
                return;
              }
              Gd.definirDizimo(novo, m.id).then(function (res) {
                toast(res.ok ? (novo === null ? tr('{nome} volta ao dízimo padrão.', { nome: m.nome })
                                              : tr('Dízimo de {nome}: {novo}%.', { nome: m.nome, novo: novo }))
                             : (res.erro || tr('não deu')), res.ok ? 'good' : undefined);
                sheetGuilda();
              });
            });
            celD.appendChild(dz);
            celD.appendChild(el('span', 'gg-pct', '%'));
          } else {
            celD.textContent = dzM + '%';
          }
          linha.appendChild(celD);
          if (g.souLider) {
            var celA = el('span', 'gg-acao-col');
            if (!ehLider) {
              var bAcao = btn(ehOficial ? '▾' : '▴', 'btn-mini btn-ghost gg-acao', function () {
                var op = ehOficial ? Gd.rebaixar(m.id) : Gd.promover(m.id);
                op.then(function (res) {
                  toast(res.ok
                    ? (res.cargo === 'oficial'
                        ? tr('{a} agora é oficial — ganhou a chave do cofre.', { a: esc(m.nome) })
                        : tr('{a} voltou a membro.', { a: esc(m.nome) }))
                    : (res.erro || tr('não deu')), res.ok ? 'good' : undefined);
                  sheetGuilda();
                });
              });
              bAcao.title = ehOficial ? tr('Rebaixar a membro') : tr('Promover a oficial');
              celA.appendChild(bAcao);
            }
            linha.appendChild(celA);
          }
          grade.appendChild(linha);
        });
        rolo.appendChild(grade);
        caixa.appendChild(rolo);
        caixa.appendChild(el('p', 'inv-dica', (podeDizimo
          ? tr('Ordem: cargo, depois o XP que cada um rendeu à guilda (dízimo, guerra e treino). Mude o dízimo de cada um direto na grade — campo vazio volta ao padrão.')
          : tr('Ordem: cargo, depois o XP que cada um rendeu à guilda (dízimo, guerra e treino).'))));

    }
    JOGO.DB.jogador().then(function (j) {
      contaJ = j;
      Gd.contaAtiva(j.id, j.nome || tr('Sem Nome'));
      return Promise.all([Gd.minha(), Gd.lista()]);
    }).then(function (r) {
      var g = r[0], ranking = r[1] || [];
      clear(caixa);
      // 04/10 (dono: "analise a guilda, está confuso; a da minha conta teste sumiu"): o servidor não
      // respondeu — isto NÃO é "você não tem guilda". Antes a tela caía no formulário de fundar
      var falhaG = !g && Gd.falhaDaFicha ? Gd.falhaDaFicha() : null;
      if (falhaG) {
        caixa.appendChild(el('p', 'empty guilda-falha', tr('Não deu para ler a sua guilda agora ({a}). Ela continua lá: é só a leitura que falhou.', { a: esc(falhaG) })));
        caixa.appendChild(btn(tr('Tentar de novo'), 'btn-primary btn-block', sheetGuilda));
        return;
      }
      anotaGuilda(g);

      // 06/10: fundar e entrar é só pela Sede da praça. Aberta por outro caminho (o cais antes de se saber, a
      // ficha que ficou aberta depois de sair da guilda), a ficha de quem não tem guilda só diz aonde ir
      if (!g && !guildaPelaSede && !mestreAtivo()) {
        caixa.appendChild(el('p', 'empty guilda-so-na-sede', avisoSemGuilda()));
        return;
      }
      if (!g) {
        // ---- SEM GUILDA: fundar uma, ou esperar convite na praça
        caixa.appendChild(el('p', 'inv-dica',
          tr('Funde a sua — ou espere um convite: líderes convidam tocando no seu fantasma na praça.')));
        // 11/09: a guilda de antes (a do navegador) sobe para o servidor sem pagar de novo
        var antiga = Gd.guildaLocalLiderada ? Gd.guildaLocalLiderada() : null;
        if (antiga) {
          // 13/09: quem era da mesma guilda de antes e chega depois do líder VOLTA para ela
          caixa.appendChild(btn((antiga.existe ? tr('Voltar para a ') : 'Trazer a ') + txtGuilda(antiga.emblema, antiga.nome) +
            (antiga.existe ? tr(' (você já era dela)') : tr(' para o servidor (sem pagar de novo)')),
            'btn-gold btn-block', function () {
              Gd.migrarLocal().then(function (res) {
                if (!res.ok) { toast(res.erro || tr('não deu')); return; }
                resumoGuilda = { nome: res.guilda.nome, emblema: res.guilda.emblema };
                guildaSoube();
                    reanunciaPerfil();          // o clã novo aparece para todos
                if (JOGO.Hub && JOGO.Hub.nomeia) {
                  try { JOGO.Hub.nomeia(undefined, undefined, undefined, resumoGuilda); } catch (e) {}
                }
                toast(res.como === 'voltou'
                  ? tr('Você voltou para a {a}.', { a: txtGuilda(res.guilda.emblema, res.guilda.nome) })
                  : tr('A {a} agora mora no servidor — quem era dela volta pela ficha da guilda.', { a: txtGuilda(res.guilda.emblema, res.guilda.nome) }), 'good');
                sheetGuilda();
              });
            }));
        }

        // O PREÇO: 10 insígnias de fundação, a moeda que só chefe derruba.
        // O saldo aparece aqui para o jogador saber quanto falta ANTES de
        // escolher nome — a recusa do core vira toast, mas ninguém gosta de
        // batizar uma guilda que não pode pagar.
        var precoIns = (JOGO.DATA && JOGO.DATA.insignias && JOGO.DATA.insignias.porGuilda) || 10;
        var saldoIns = 0;
        try { saldoIns = P().insigniasVer(); } catch (e) {}
        var podePagar = saldoIns >= precoIns;
        var linhaIns = el('p', 'inv-dica',
          '<b>' + saldoIns + '/' + precoIns + tr('</b> insígnias de fundação — ') +
          (podePagar ? tr('dá para fundar!') : tr('só chefe derruba, uma por queda.')));
        linhaIns.insertBefore(art('insigniaIcon', [18], 18, 'selo-inline'), linhaIns.firstChild);
        linhaIns.style.color = podePagar ? '#7fe08a' : '#c9a227';
        caixa.appendChild(linhaIns);

        // O BRASÃO: a oficina inteira num só lugar (forma, campo partido,
        // símbolo e as cores). Ela se repinta sozinha — chamar sheetGuilda()
        // a cada toque refazia a consulta ao banco e apagava o nome digitado.
        var oficina = el('div', 'brasao-ed');
        caixa.appendChild(oficina);
        pintaBrasaoEditor(oficina);

        var inp = document.createElement('input');
        inp.className = 'hub-input';
        inp.maxLength = 24;
        inp.placeholder = tr('nome da guilda');
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
          sug.appendChild(btn(tr('↻ outros nomes'), 'btn-mini btn-gold', pintaSugestoes));
        }
        pintaSugestoes();
        caixa.appendChild(sug);

        caixa.appendChild(btn(tr('Fundar a guilda  ({precoIns} insígnias)', { precoIns: precoIns }), 'btn-primary btn-block', function () {
          Gd.criar(inp.value, guildaEmblemaEscolhido).then(function (res) {
            if (!res.ok) { toast(res.erro || tr('não deu')); return; }
            guildaNomeRascunho = '';
            toast(tr('A {a} existe — e você a lidera.', { a: txtGuilda(res.guilda.emblema, res.guilda.nome) }), 'good');
            // a plaquinha da praça ganha a placa da guilda na hora — os
            // undefined preservam nome/título/coroa que já estão pendurados
            resumoGuilda = { nome: res.guilda.nome, emblema: res.guilda.emblema };
            guildaSoube();
                    reanunciaPerfil();          // o clã novo aparece para todos
            if (JOGO.Hub && JOGO.Hub.nomeia) {
              try { JOGO.Hub.nomeia(undefined, undefined, undefined, resumoGuilda); } catch (e) {}
            }
            sheetGuilda();
          });
        }));
      } else if (!sedeDentro()) {
        // 04/10: fora do salão, a porta — a ficha de gestão abre nos pontos de dentro.
        // 08/10 à noite: e a grade dos membros (o líder e os oficiais mudam o dízimo ali mesmo)
        portaDaGuilda(caixa, g);
        gradeDosMembros(caixa, g, (g.eu != null) ? g.eu : contaJ.id);
      } else {
        // 11/09: quem sou eu na ficha — no servidor, a CONTA (g.eu); em casa, o jogador local
        var euId = (g.eu != null) ? g.eu : contaJ.id;
        // ---- A FICHA
        var cab = el('div', 'guilda-cab');
        var emblemaPlaca = elShield(g.emblema, 48);
        emblemaPlaca.className = 'guilda-emblema';
        cab.appendChild(emblemaPlaca);
        var ct = el('div', 'guilda-cab-t');
        ct.appendChild(el('h3', null, tr('{a} <i>nível {nivel}</i>', { a: esc(g.nome), nivel: g.nivel })));
        var alvoNivel = 60 * g.nivel * (g.nivel + 1) / 2;
        var baseNivel = g.nivel > 1 ? 60 * (g.nivel - 1) * g.nivel / 2 : 0;
        ct.appendChild(bar('bar-xp', (g.xp - baseNivel) / Math.max(1, alvoNivel - baseNivel),
          tr('XP da guilda {xp} / {alvoNivel}', { xp: g.xp, alvoNivel: alvoNivel })));
        ct.appendChild(el('span', 'guilda-sub', tr('{length} membro(s) · {treinos} treino(s) na arena', { length: membrosDeN(g.membros.length, vagasDaGuilda(g)), treinos: g.treinos })));
        cab.appendChild(ct);
        caixa.appendChild(cab);

        /* ---- NOME E BRASÃO (08/10 à noite, o dono: "pergaminho para renomear guilda e outro para alterar
         * brasão, vendidos somente na loja do site"). Só o líder vê. Os pergaminhos são pedidos da loja
         * (g.pergaminhos, contados pelo servidor); cada troca gasta um. Sem nenhum, o link da loja. */
        if (g.souLider) {
          var perg = g.pergaminhos || { nome: 0, brasao: 0 };
          var blocoNB = el('div', 'guilda-mural guilda-nb');
          var nbCab = el('div', 'guilda-mural-cab');
          nbCab.appendChild(el('h3', 'bk-tit', tr('Nome e brasão')));
          blocoNB.appendChild(nbCab);
          var nbDica = el('p', 'inv-dica',
            lojaFechada() ? tr('Pergaminho do Novo Nome: <b>{a}</b> · Pergaminho do Brasão: <b>{b}</b>. Cada troca gasta um.',
               { a: perg.nome || 0, b: perg.brasao || 0 })
            : tr('Pergaminho do Novo Nome: <b>{a}</b> · Pergaminho do Brasão: <b>{b}</b>. Cada troca gasta um. Eles se vendem só na <a class="char-aura-link" target="_blank" rel="noopener">loja do site</a>, na seção Guilda.',
               { a: perg.nome || 0, b: perg.brasao || 0 }));
          var lkNB = nbDica.querySelector('a');
          if (lkNB) lkNB.href = paginaLoja();
          blocoNB.appendChild(nbDica);
          var nbCorpo = el('div', 'guilda-nb-corpo');
          blocoNB.appendChild(nbCorpo);
          function depoisDaTroca(res, frase) {
            if (!res.ok) { toast(res.erro || tr('não deu')); return; }
            resumoGuilda = { nome: res.guilda.nome, emblema: res.guilda.emblema };
            guildaSoube();
            reanunciaPerfil();                       // a praça inteira vê o nome/brasão novo
            if (JOGO.Hub && JOGO.Hub.nomeia) {
              try { JOGO.Hub.nomeia(undefined, undefined, undefined, resumoGuilda); } catch (e) {}
            }
            toast(frase, 'good');
            sheetGuilda();
          }
          function pintaNB() {
            clear(nbCorpo);
            var acts = el('div', 'guilda-mural-acts');
            var bN = btn(tr('Renomear a guilda'), 'btn-mini btn-gold', function () {
              clear(nbCorpo);
              var inpN = document.createElement('input');
              inpN.className = 'hub-input';
              inpN.maxLength = 24;
              inpN.placeholder = tr('nome novo da guilda');
              inpN.value = g.nome;
              inpN.addEventListener('keydown', function (ev) { ev.stopPropagation(); if (ev.key === 'Enter') bOk.click(); });
              nbCorpo.appendChild(inpN);
              var acts2 = el('div', 'guilda-mural-acts');
              acts2.appendChild(btn(tr('Cancelar'), 'btn-mini btn-ghost', pintaNB));
              var bOk = btn(tr('Trocar o nome (gasta 1 pergaminho)'), 'btn-mini btn-gold', function () {
                Gd.renomear(inpN.value).then(function (res) {
                  depoisDaTroca(res, res.ok ? tr('A guilda agora se chama {a}.', { a: esc(res.guilda.nome) }) : '');
                });
              });
              acts2.appendChild(bOk);
              nbCorpo.appendChild(acts2);
              inpN.focus();
            });
            if (!(perg.nome > 0)) bN.disabled = true;
            acts.appendChild(bN);
            var bB = btn(tr('Trocar o brasão'), 'btn-mini btn-gold', function () {
              clear(nbCorpo);
              guildaEmblemaEscolhido = g.emblema;      // a oficina abre no brasão de hoje
              var oficinaNB = el('div', 'brasao-ed');
              nbCorpo.appendChild(oficinaNB);
              pintaBrasaoEditor(oficinaNB);
              var acts3 = el('div', 'guilda-mural-acts');
              acts3.appendChild(btn(tr('Cancelar'), 'btn-mini btn-ghost', pintaNB));
              acts3.appendChild(btn(tr('Trocar o brasão (gasta 1 pergaminho)'), 'btn-mini btn-gold', function () {
                Gd.trocarBrasao(guildaEmblemaEscolhido).then(function (res) {
                  depoisDaTroca(res, res.ok ? tr('O brasão da {a} mudou.', { a: esc(res.guilda.nome) }) : '');
                });
              }));
              nbCorpo.appendChild(acts3);
            });
            if (!(perg.brasao > 0)) bB.disabled = true;
            acts.appendChild(bB);
            nbCorpo.appendChild(acts);
          }
          pintaNB();
          caixa.appendChild(blocoNB);
        }

        /* ---- A MENSAGEM DA GUILDA (13/09, dono: "uma caixa com uma mensagem
         * inicial/orientações para membros"). Todo membro lê; líder e oficiais
         * escrevem (o servidor confere). O editor abre no lugar do texto. */
        var podeEscrever = g.meuCargo === 'lider' || g.meuCargo === 'oficial';
        var muralG = g.mural && g.mural.texto ? g.mural : null;
        var mural = el('div', 'guilda-mural');
        var muralCab = el('div', 'guilda-mural-cab');
        muralCab.appendChild(el('h3', 'bk-tit', tr('Mensagem da guilda')));
        mural.appendChild(muralCab);
        var muralCorpo = el('div', 'guilda-mural-corpo');
        mural.appendChild(muralCorpo);
        function pintaMural() {
          clear(muralCorpo);
          muralCorpo.appendChild(el('div', 'guilda-mural-txt' + (muralG ? '' : ' is-vazio'), muralG
            ? esc(muralG.texto)
            : (podeEscrever ? tr('Nenhuma mensagem ainda. Escreva as boas-vindas e as regras — todo membro lê aqui.')
                            : tr('O líder ainda não deixou orientações.'))));
          if (muralG && muralG.autorNome) {
            muralCorpo.appendChild(el('span', 'guilda-mural-autor', '— ' + esc(muralG.autorNome)));
          }
        }
        function editaMural() {
          clear(muralCorpo);
          var ta = document.createElement('textarea');
          ta.className = 'hub-input guilda-mural-edit';
          ta.maxLength = Gd.MURAL_MAX || 500;
          ta.placeholder = tr('Boas-vindas, horários, o dízimo combinado, como pedir item emprestado…');
          ta.value = muralG ? muralG.texto : '';
          ta.addEventListener('keydown', function (ev) { ev.stopPropagation(); });   // a letra não abre atalho
          var contaTa = el('span', 'guilda-mural-conta', '');
          function conta() { contaTa.textContent = ta.value.length + '/' + ta.maxLength; }
          ta.addEventListener('input', conta);
          conta();
          var acts = el('div', 'guilda-mural-acts');
          acts.appendChild(contaTa);
          acts.appendChild(btn(tr('Cancelar'), 'btn-mini btn-ghost', pintaMural));
          acts.appendChild(btn(tr('Salvar'), 'btn-mini btn-gold', function () {
            Gd.definirMural(ta.value).then(function (res) {
              toast(res.ok ? tr('Mensagem da guilda salva.') : (res.erro || tr('não deu')), res.ok ? 'good' : undefined);
              if (res.ok) sheetGuilda();
            });
          }));
          muralCorpo.appendChild(ta);
          muralCorpo.appendChild(acts);
          ta.focus();
        }
        if (podeEscrever) muralCab.appendChild(btn(muralG ? '✎ editar' : '✎ escrever', 'btn-mini btn-ghost', editaMural));
        pintaMural();
        caixa.appendChild(mural);

        gradeDosMembros(caixa, g, euId);

        // A OFERENDA (30/08: vinténs viravam XP da guilda, 2 por 1) morou aqui até 04/10. Dono:
        // "dinheiro não dará mais XP para guild; somente % de XP doada de batalha OU guerra de
        // guild" — o campo e o botão saíram; o servidor recusa a doação que não é o dízimo.
        caixa.appendChild(el('p', 'inv-dica guilda-xp-regra',
          tr('A guilda sobe pelo <b>dízimo</b> (a parte do XP de cada batalha que o membro doa) e pela <b>guerra de guilda</b>{a}. Vinténs não compram XP.', { a: Gu() ? ' ' + tr('(+{XP} XP por vitória)', { XP: Gu().XP }) : '' })));

        // ---- A PORTA E O DÍZIMO (30/08): governo do líder. A porta decide
        // se a sede aceita qualquer um ou só pedido; o dízimo é a % do XP
        // que cada membro doa à guilda no fim de cada sala.
        if (g.souLider) {
          var gov = el('div', 'guilda-governo');
          gov.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0';
          var portaAtual = g.porta === 'convite' ? 'convite' : 'aberta';
          gov.appendChild(btn(tr('Porta: {a}', { a: portaAtual === 'convite' ? tr('por convite') : 'aberta' }) + ' ⇄',
            'btn-mini btn-ghost', function () {
              Gd.definirPorta(portaAtual === 'convite' ? 'aberta' : 'convite').then(function (res) {
                toast(res.ok ? (res.porta === 'convite'
                  ? tr('A porta agora é por convite.')
                  : tr('A porta agora é aberta.')) : (res.erro || tr('não deu')),
                      res.ok ? 'good' : undefined);
                sheetGuilda();
              });
            }));
          // 13/09: o PADRÃO (quem não tem dízimo próprio) e o "aplicar a todos"
          var dzInp = document.createElement('input');
          dzInp.type = 'number'; dzInp.min = '0'; dzInp.max = String(Gd.DIZIMO_MAX || 25);
          dzInp.value = String(g.dizimo || 0);
          dzInp.className = 'hub-input';
          dzInp.style.cssText = 'width:70px;margin:0';
          dzInp.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
          gov.appendChild(el('span', 'inv-dica', tr('dízimo padrão:')));
          gov.appendChild(dzInp);
          function mandaPadrao(todos) {
            Gd.definirDizimo(Math.floor(Number(dzInp.value) || 0), null, { todos: todos }).then(function (res) {
              toast(res.ok ? (todos ? tr('Todos os membros doam {dizimo}% do XP.', { dizimo: res.dizimo })
                                    : tr('Dízimo padrão em {dizimo}% — quem tem um próprio segue com o dele.', { dizimo: res.dizimo }))
                           : (res.erro || tr('não deu')), res.ok ? 'good' : undefined);
              sheetGuilda();
            });
          }
          gov.appendChild(btn(tr('% definir padrão'), 'btn-mini btn-gold', function () { mandaPadrao(false); }));
          gov.appendChild(btn('aplicar a todos', 'btn-mini btn-ghost', function () { mandaPadrao(true); }));
          caixa.appendChild(gov);
        } else {
          var euM = g.membros.filter(function (m) { return m.id === euId; })[0];
          var meuDz = euM && typeof euM.dizimo === 'number' ? Math.floor(euM.dizimo) : Math.floor(g.dizimo || 0);
          if (meuDz > 0) {
            caixa.appendChild(el('p', 'inv-dica',
              tr('O seu dízimo: <b>{meuDz}%</b> do XP de cada sala vira XP da guilda.', { meuDz: meuDz })));
          }
        }

        // ---- A FILA DE PEDIDOS: líder e oficiais decidem quem entra
        var fila = g.pedidos || [];
        if (fila.length && (g.meuCargo === 'lider' || g.meuCargo === 'oficial')) {
          var fp = el('div', 'guilda-pedidos');
          fp.appendChild(el('h3', 'bk-tit', tr('Pedidos de entrada ({length})', { length: fila.length })));
          fila.forEach(function (p) {
            var lp = el('div', 'guilda-rank');
            lp.appendChild(el('span', null, esc(p.nome)));
            lp.appendChild(btn(tr('Aceitar'), 'btn-mini btn-primary', function () {
              Gd.aceitarPedido(p.id).then(function (res) {
                toast(res.ok ? tr('{a} entrou na guilda!', { a: esc(p.nome) }) : (res.erro || tr('não deu')),
                      res.ok ? 'good' : undefined);
                sheetGuilda();
              });
            }));
            lp.appendChild(btn(tr('Recusar'), 'btn-mini btn-ghost', function () {
              Gd.recusarPedido(p.id).then(function () { sheetGuilda(); });
            }));
            fp.appendChild(lp);
          });
          caixa.appendChild(fp);
        }

        /* 10/10 — A CAMPEÃ DO TORNEIO DE GUILDA: XP em dobro para todos os membros por 7 dias (entra no lugar
         * do +15% do cofre enquanto durar) e os títulos que a guilda já soma */
        var gt = safe(function () { return JOGO.Guilda.torneio(); }, null);
        if (gt && (gt.campea || gt.titulos > 0 || gt.xpDobroAteMs > Date.now())) {
          var cxT = el('div', 'guilda-meta guilda-torneio' + (gt.xpDobroAteMs > Date.now() ? ' is-cumprida' : ''));
          cxT.appendChild(el('div', 'guilda-meta-cab', '<b>' + tr('Torneio das Guildas') + '</b>' +
            '<span>' + (gt.campea ? tr('campeã vigente') : '') + (gt.titulos ? (gt.campea ? ' · ' : '') + tr('{n} título(s)', { n: gt.titulos }) : '') + '</span>'));
          if (gt.xpDobroAteMs > Date.now()) {
            cxT.appendChild(el('p', 'inv-dica', tr('<b>XP em dobro</b> para todos os membros até {a} (no lugar do +15% do cofre enquanto durar).', { a: esc(quandoTorneio(gt.xpDobroAteMs)) })));
          }
          caixa.appendChild(cxT);
        }

        /* A META DA SEMANA (07/10, servidor/guilda.py soma_meta): as salas que os membros vencem enchem a
         * barra; cheia, +15% de XP e de saque para todos até domingo e XP para a guilda. Só vem do servidor. */
        if (g.meta && typeof g.meta.alvo === 'number') {
          var mt = g.meta, pct = Math.max(0, Math.min(100, Math.round(100 * (mt.salas || 0) / Math.max(1, mt.alvo))));
          var caixaMeta = el('div', 'guilda-meta' + (mt.cumprida ? ' is-cumprida' : ''));
          caixaMeta.appendChild(el('h3', 'bk-tit', mt.cumprida
            ? tr('Meta da semana cumprida — <b>+15% de XP e de saque</b> para todos até domingo')
            : tr('Meta da semana — <b>{a}</b> de <b>{b}</b> salas vencidas', { a: mt.salas || 0, b: mt.alvo })));
          var barra = el('div', 'guilda-meta-barra');
          var cheio = el('i'); cheio.style.width = pct + '%';
          barra.appendChild(cheio);
          caixaMeta.appendChild(barra);
          caixaMeta.appendChild(el('p', 'inv-dica', tr('Toda sala que um membro vence (sozinho ou em grupo) conta. Cheia, a guilda ganha XP e o bônus de +15% de XP e de saque para todos até o fim da semana. Zera na segunda.')));
          caixa.appendChild(caixaMeta);
        }

        // ---- O COFRE: a moeda da guilda — líder e oficiais gastam
        var cofre = el('div', 'guilda-cofre');
        cofre.appendChild(el('h3', 'bk-tit', tr('Cofre da guilda — <b>{moedas}</b> marcas', { moedas: g.moedas })));
        cofre.appendChild(el('p', 'inv-dica',
          tr('Marcas nascem das competições da guilda (o treino paga {MOEDA_TREINO}; a competição de verdade chega com o servidor). Líder e oficiais gastam — em bônus de 24h para TODOS.', { MOEDA_TREINO: Gd.MOEDA_TREINO })));
        ['drop', 'xp'].forEach(function (tipo) {
          var rot = tipo === 'drop' ? tr('+15% de saque') : tr('+15% de XP');
          var ate = g.bonus && g.bonus[tipo];
          var vivo = ate && ate > Date.now();
          var linha = el('div', 'guilda-bonus' + (vivo ? ' is-vivo' : ''));
          linha.appendChild(el('span', null, '<b>' + rot + '</b>' +
            (vivo ? ' ' + tr('· vivo por mais {a}h', { a: Math.ceil((ate - Date.now()) / 3600000) }) : '')));
          if (g.souLider) {
            linha.appendChild(btn((vivo ? tr('Estender') : tr('Comprar')) + ' (' + Gd.CUSTO_BONUS + ')',
              'btn-mini' + (g.moedas >= Gd.CUSTO_BONUS ? ' btn-gold' : ' is-off'), function () {
                Gd.compraBonus(tipo).then(function (res) {
                  toast(res.ok ? tr('O bônus de {rot} vale para toda a guilda!', { rot: rot }) : (res.erro || tr('não deu')),
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
        bg.appendChild(el('h3', 'bk-tit', tr('Banco da guilda')));
        bg.appendChild(el('p', 'inv-dica',
          tr('Arraste (ou dois toques) entre o saco e o banco, como no cofre. Peça de outro dono sai <b>emprestada</b> — uma por vez — e se devolve arrastando uma cópia igual de volta.')));
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

          /* OS FILTROS DO BANCO DA GUILDA (22/09, junto com os ícones): espaço,
           * elemento e a busca por nome, nas DUAS colunas, como no cofre.
           * Filtrar só escolhe o que se DESENHA: cada pilha leva a posição
           * ORIGINAL (`indices`, do saco e da lista do banco) e a devolução
           * procura o empréstimo na lista `itens` inteira — pegar, depositar
           * e devolver não sabem que houve filtro. */
          bg.appendChild(filtrosDeItem(guildaSlotFiltro, function (s) {
            guildaSlotFiltro = s;
            sheetGuilda();
          }, guildaElemFiltro, function (e2) {
            guildaElemFiltro = e2;
            sheetGuilda();
          }));
          bg.appendChild(buscaInput(guildaBusca, function (t) {
            guildaBusca = t;
            aplicaBusca(duplo, t);
          }));
          function passaGuilda(pi) {
            return passaSlot(pi.itemId, guildaSlotFiltro) && passaElemento(pi.itemId, guildaElemFiltro);
          }
          var totalBanco = pilhasBanco.length;
          pilhas = pilhas.filter(passaGuilda);
          pilhasBanco = pilhasBanco.filter(passaGuilda);

          var duplo = el('div', 'bk2-duplo');
          var colSaco = el('div', 'bk2-col');
          colSaco.dataset.lado = 'saco';
          colSaco.appendChild(el('h3', 'bk-tit', tr('No saco ({unidadesSaco})', { unidadesSaco: unidadesSaco })));
          colSaco.appendChild(bancoGrade(pilhas, 'saco', function (pi) {
            var st2 = P().state;
            var entrada = st2.inventory[pi.indices[0]];
            if (!entrada) { toast(tr('essa peça já saiu')); sheetGuilda(); return; }
            // DEVOLUÇÃO PELO GESTO: se você deve ESTE item ao banco, levar a
            // cópia até lá é devolver — não criar um segundo depósito
            var devIdx = -1;
            for (var d2 = 0; d2 < itens.length; d2++) {
              var eb = itens[d2];
              if (eb.emprestadoPara === euId && eb.itemId === entrada.itemId &&
                  (eb.level || 0) === (entrada.level || 0) &&
                  (eb.stars || 0) === (entrada.stars || 0)) { devIdx = d2; break; }
            }
            var op = (devIdx >= 0) ? Gd.bancoDevolver(devIdx) : Gd.bancoDepositar(entrada);
            op.then(function (res) {
              if (!res.ok) { toast(res.erro || tr('não deu')); sheetGuilda(); return; }
              // 13/09: com a autoridade, o servidor já tirou a peça do estado dele e mandou o estado novo
              if ((res.progress || res.db) && JOGO.Autoridade && JOGO.Autoridade.adota) {
                JOGO.Autoridade.adota(res.progress, res.db);
              } else {
                st2.inventory.splice(pi.indices[0], 1);
                safe(function () { P().save(); }, null);
              }
              toast(devIdx >= 0 ? tr('Devolvida. Obrigado em nome da guilda.')
                                : tr('No banco da guilda.'), 'good');
              sheetGuilda();
            });
          }));

          var colBanco = el('div', 'bk2-col');
          colBanco.dataset.lado = 'cofre';
          colBanco.appendChild(el('h3', 'bk-tit', tr('Banco da guilda ({totalBanco})', { totalBanco: totalBanco })));
          colBanco.appendChild(bancoGrade(pilhasBanco, 'cofre', function (pi) {
            var e2 = pi.entrada;
            if (e2.emprestadoPara && e2.emprestadoPara !== euId) {
              toast(tr('Emprestada a {a} — espere devolver.', { a: e2.tomadorNome || tr('alguém') }));
              return;
            }
            if (e2.emprestadoPara === euId) {
              toast(tr('Essa já está com você — devolva arrastando a cópia do saco.'));
              return;
            }
            if (!safe(function () { return P().bagFree(1); }, true)) {
              toast(tr('O saco está cheio — não cabe mais nada.'));
              return;
            }
            Gd.bancoPegar(pi.indices[0]).then(function (res) {
              if (!res.ok) { toast(res.erro || tr('não deu')); sheetGuilda(); return; }
              // a emprestada é cópia NOVA no cartório (origem banco). 11/09: a SUA peça,
              // retirada de vez, volta com a série dela — no servidor ela ficou guardada
              // no banco da guilda, sem ser varrida do cartório
              if ((res.progress || res.db) && JOGO.Autoridade && JOGO.Autoridade.adota) {
                // 13/09: com a autoridade, a peça (ou a cópia do empréstimo) já entrou no estado do servidor
                JOGO.Autoridade.adota(res.progress, res.db);
              } else {
                var volta = (res.definitivo && e2.iid)
                  ? { itemId: e2.itemId, level: e2.level || 0, stars: e2.stars || 0, iid: e2.iid }
                  : (P().novaCopia ? P().novaCopia(e2.itemId, 'banco', e2.level || 0, e2.stars || 0)
                                   : { itemId: e2.itemId, level: e2.level || 0, stars: e2.stars || 0 });
                P().state.inventory.push(volta);
                safe(function () { P().save(); }, null);
              }
              toast(res.definitivo ? tr('Sua peça voltou para o saco.') :
                    tr('Emprestada — devolva uma cópia igual quando puder.'), 'good');
              sheetGuilda();
            });
          }));

          duplo.appendChild(colSaco);
          duplo.appendChild(colBanco);
          bg.appendChild(duplo);
          if (guildaBusca) aplicaBusca(duplo, guildaBusca);

          // o extrato: quem deve o quê — a grade não conta essa história
          var emprestadas = itens.filter(function (e3) { return !!e3.emprestadoPara; });
          if (emprestadas.length) {
            var ext = el('p', 'inv-dica');
            ext.innerHTML = emprestadas.map(function (e3) {
              var it3 = itemDef(e3.itemId) || {};
              return tr('⚑ <b>{a}</b> de {b} está com {c}', { a: esc(it3.name || e3.itemId), b: esc(e3.donoNome || '?'), c: esc(e3.tomadorNome || '?') });
            }).join(' · ');
            bg.appendChild(ext);
          }
          caixa.appendChild(bg);

          caixa.appendChild(btn(tr('Sair da guilda'), 'btn-warn btn-block', function () {
            confirmSheet(tr('Sair da {nome}?', { nome: g.nome }),
              g.membros.length === 1
                ? tr('Você é o último membro — a guilda se dissolve.')
                : tr('A liderança passa ao membro mais antigo, se for sua.'), function () {
                Gd.sair().then(function (res) {
                  toast(res.ok ? tr('Você saiu da guilda.') : (res.erro || tr('não deu')));
                  openSheet('guilda');
                });
              });
          }));

          // 04/10: aberta de um ponto da sede (banco, cofre, mural), a ficha já rola até ele
          if (guildaFoco) {
            var focoG = guildaFoco, alvoG = caixa.querySelector('.guilda-' + focoG);
            guildaFoco = null;
            caixa.setAttribute('data-foco', focoG);
            if (alvoG && alvoG.scrollIntoView) {
              setTimeout(function () { try { alvoG.scrollIntoView({ block: 'start' }); } catch (eF) {} }, 60);
            }
          }
          // ---- o ranking, no pé
          if (ranking.length) {
            caixa.appendChild(el('h3', 'bk-tit', tr('Ranking das guildas')));
            ranking.forEach(function (rg, ri) {
              var linhaR = el('div', 'guilda-rank' + (g && rg.id === g.id ? ' is-minha' : ''));
              if (BR() && BR().ehCodigo(rg.emblema)) linhaR.appendChild(elShield(rg.emblema, 20));
              linhaR.appendChild(el('span', null,
                tr('<b>{a}º</b> {b} · nível {nivel} · {xp} XP · {membros} membro(s)', { a: ri + 1, b: esc(txtGuilda(rg.emblema, rg.nome)), nivel: rg.nivel, xp: rg.xp, membros: membrosDeN(rg.membros, vagasDaGuilda(rg)) })));
              caixa.appendChild(linhaR);
            });
          }
        });
      }

      // sem guilda o ranking também aparece — e é a PORTA DE ENTRADA
      // (30/08): guilda aberta entra na hora; a de convite recebe o pedido
      if (!g && ranking.length) {
        caixa.appendChild(el('h3', 'bk-tit', tr('Guildas do acampamento')));
        ranking.forEach(function (rg, ri) {
          var linha = el('div', 'guilda-rank');
          if (BR() && BR().ehCodigo(rg.emblema)) linha.appendChild(elShield(rg.emblema, 20));
          linha.appendChild(el('span', null,
            (rg.porta === 'convite'
              ? tr('<b>{a}º</b> {b} · nível {nivel} · {membros} membro(s) · porta por convite', { a: ri + 1, b: esc(txtGuilda(rg.emblema, rg.nome)), nivel: rg.nivel, membros: membrosDeN(rg.membros, vagasDaGuilda(rg)) })
              : tr('<b>{a}º</b> {b} · nível {nivel} · {membros} membro(s) · porta aberta', { a: ri + 1, b: esc(txtGuilda(rg.emblema, rg.nome)), nivel: rg.nivel, membros: membrosDeN(rg.membros, vagasDaGuilda(rg)) }))));
          // 08/10 à noite: a guilda nas vagas do nível dela não recebe mais ninguém até subir
          var vagasR = vagasDaGuilda(rg), cheiaR = !!(vagasR && rg.membros >= vagasR);
          linha.appendChild(btn(cheiaR ? tr('Cheia') : (rg.porta === 'convite' ? tr('Pedir para entrar') : tr('Entrar')),
            'btn-mini ' + (cheiaR ? 'btn-ghost is-apagado' : (rg.porta === 'convite' ? 'btn-ghost' : 'btn-primary')), function () {
              if (cheiaR) { toast(tr('A {nome} está cheia ({a}/{b}): ela abre mais vagas ao subir de nível.', { nome: rg.nome, a: rg.membros, b: vagasR })); return; }
              var op = rg.porta === 'convite' ? Gd.pedirEntrada(rg.id) : Gd.entrar(rg.id);
              op.then(function (res) {
                if (!res.ok) { toast(res.erro || tr('não deu')); return; }
                toast(res.entrou === false
                  ? tr('Pedido enviado — o líder da {nome} decide.', { nome: rg.nome })
                  : tr('Bem-vindo à {nome}!', { nome: rg.nome }), 'good');
                sheetGuilda();
              });
            }));
          caixa.appendChild(linha);
        });
      }
    });
  }

  /* O MESTRE NO PAINEL ÚNICO (03/10, o dono: "junte" o painel do Mestre de antes — a tecla M: o grimório, a
   * Caixa, os eventos do mundo — com o painel novo do F9). As três fichas que moravam aqui (gm, gmcaixa,
   * gmagenda) viraram ABAS do js/ui/painel_mestre.js: Caixa, Eventos e Grimório. O corpo de cada uma
   * continua sendo desenhado AQUI (ele usa o miúdo da HUD: o desenho dos ícones, os nomes de slot e de
   * raridade, a agenda), mas dentro do corpo do painel, por estas três portas:
   *   UI.gmCaixaEm(alvo, ctx)    a Caixa (as sete abas redondas de sempre)
   *   UI.gmAgendaEm(alvo, ctx)   os eventos do mundo (Agora, Agendar, Calendário)
   *   UI.gmGrimorioEm(alvo, ctx) o grimório (qualquer feitiço na barra do Mestre)
   * `ctx` é do painel: entrega(pedido, rotulo) → Promise (PELO SERVIDOR na conta marcada, ou no save local
   * com a chave em casa), destino (null = o próprio Mestre, ou {id, nome} de um jogador), aviso(texto,
   * tipo), confirma(titulo, html, fn), refaz() (redesenha a aba), aberta() (a aba ainda está na tela) e
   * itensEm(alvo) (a busca de peças com estrelas, forja e quantidade, que é do painel). O openSheet com os
   * nomes de antes abre a aba certa do painel (as provas e quem mais chamar seguem funcionando). O PA/PP e
   * o "Aparelhar o Mestre" foram para as Ferramentas do painel — um lugar só. */
  var gmBusca = '';
  function gmAbre(qual) {
    var PM = JOGO.PainelMestre;
    if (PM && PM.abrir) return PM.abrir(qual);
    toast(tr('O painel do Mestre não carregou nesta página.'));
    return false;
  }
  function gmCtx(ctx) {
    ctx = ctx || {};
    return {
      entrega: ctx.entrega || function () { return Promise.resolve(null); },
      destino: ctx.destino || null,
      aviso: ctx.aviso || toast,
      confirma: ctx.confirma || function (t, h, fn) { confirmSheet(t, h, fn); },
      refaz: ctx.refaz || function () {},
      aberta: ctx.aberta || function () { return true; },
      itensEm: ctx.itensEm || null
    };
  }

  /* A CAIXA DO MESTRE (03/09, pedido do dono): "o GM pode abrir uma caixa
   * para pegar qualquer item do jogo pra ele equipar; terá um menu exclusivo
   * para pegar pet ou set para seu inventário". Três abas — Itens, Conjuntos,
   * Bichos — com busca; tudo entra direto no saco. Só com a chave virada.
   * 11/09 ("quero liberar pedras e as outras coisas também"): mais quatro —
   * Pedras, Selos e insígnias, Cartas (de classe) e Pergaminhos (com os dias
   * de bônus de XP) —, cada linha com o que a conta já tem.
   * 03/10 (o painel único): a Caixa entrega também no inventário de QUALQUER
   * jogador (o "Para:" do painel escolhe), pelo servidor. Cada botão manda um
   * pedido {tipo, …} ao ctx.entrega — o mesmo formato do POST /api/mestre/dar
   * (servidor/moderacao.py, TIPOS_DAR). "Você tem N" só aparece quando a Caixa
   * entrega ao próprio Mestre: do jogador, o painel não tem o saco na mão. */
  var gmCaixaAba = 'itens', gmCaixaBusca = '';
  function gmCaixaEm(body, ctx0) {
    var GMod = JOGO.GM;
    var ctx = gmCtx(ctx0);
    var proprio = !ctx.destino;
    if (!GMod || !GMod.ativo || !GMod.ativo()) {
      body.appendChild(el('p', 'inv-dica', tr('A Caixa é do Mestre: entre com a conta dele (ou com a chave, em casa).')));
      return;
    }

    // 22/09: as sete abas redondas, com o nome de sempre escondido (a prova
    // tests/prova_gm_caixa.html acha a aba pelo texto exato) e o da aberta
    // escrito no fim da fileira
    var GM_ABAS = [['itens', 'gm-itens', tr('Itens')], ['sets', 'gm-sets', tr('Conjuntos')],
      ['bichos', 'gm-bichos', tr('Bichos')], ['pedras', 'gm-pedras', tr('Pedras')],
      ['moedas', 'gm-selos', tr('Selos e insígnias')], ['cartas', 'gm-cartas', tr('Cartas')],
      ['pergaminhos', 'gm-pergaminhos', tr('Pergaminhos')]];
    var abas = icoFila('inv-filtros gm-abas', GM_ABAS.map(function (t) {
      return { id: t[0], ico: t[1], rot: t[2], cls: 'btn-mini',
               clsTexto: gmCaixaAba === t[0] ? 'btn-gold' : 'btn-ghost', data: { aba: t[0] } };
    }), gmCaixaAba, function (id) {
      gmCaixaAba = id; ctx.refaz();
    }, true);
    body.appendChild(abas);
    // as peças: a busca do painel (nome, slot, raridade, elemento, nível; estrelas, forja e quantidade)
    if (gmCaixaAba === 'itens') {
      if (ctx.itensEm) ctx.itensEm(body);
      return;
    }
    var busca = document.createElement('input');
    busca.className = 'hub-input';
    busca.placeholder = tr('buscar por nome...');
    busca.value = gmCaixaBusca;
    body.appendChild(busca);
    var listaEl = el('div', 'ms-caixa');
    body.appendChild(listaEl);
    var D0 = D();
    var paraQuem = proprio ? '' : ' ' + tr('· vai para <b>{a}</b>', { a: esc(ctx.destino.nome) });

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
    // entrega pelo painel; deu certo, repinta (a linha mostra o que a conta tem agora)
    function dar(pedido, rotulo) {
      return ctx.entrega(pedido, rotulo).then(function (r) {
        if (r && r.ok && ctx.aberta()) pinta();
        return r;
      });
    }
    function glifo(txt) {
      var g = el('span', null, txt);
      g.style.cssText = 'width:40px;flex:none;text-align:center;font-size:26px;line-height:40px';
      return g;
    }
    function tem(n) { return proprio ? tr('você tem <b>{n}</b> ·', { n: n }) + ' ' : ''; }
    function pinta() {
      clear(listaEl);
      var tq = (gmCaixaBusca || '').toLowerCase();
      var vistas = 0, TETO = 48;
      function passa(nome, id) {
        return !tq || (nome || '').toLowerCase().indexOf(tq) >= 0 || (id || '').toLowerCase().indexOf(tq) >= 0;
      }
      function corta() {
        if (++vistas > TETO) { listaEl.appendChild(el('p', 'inv-dica', tr('… e mais — afine a busca.'))); return true; }
        return false;
      }
      if (gmCaixaAba === 'sets') {
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
              tr('{length} peças: {a}{paraQuem}', { length: pecas.length, a: esc(pecas.join(', ')), paraQuem: paraQuem }), tr('Pegar o conjunto'), function () {
                dar({ tipo: 'set', setId: sid2 }, sd2.name || sid2);
              }));
          })(sids[s], sd);
        }
      } else if (gmCaixaAba === 'pedras') {
        // as pedras de forja: as cinco dos elementos e a Âncora
        var pedras = D0.stones || {};
        Object.keys(pedras).forEach(function (sid) {
          var pd3 = pedras[sid];
          if (!pd3 || !passa(pd3.name, sid) || corta()) return;
          var n = safe(function () { return JOGO.Progress.stoneCount(sid); }, 0) || 0;
          var qual = pd3.element === 'forja' ? tr('segura o nível quando a batida da forja falha')
                   : tr('forja as peças de {a}', { a: ELEM_PT[pd3.element] || pd3.element });
          var row = linha(art('stoneIcon', [sid, 40], 40), pd3.name || sid, tem(n) + esc(qual) + paraQuem,
            '+10', function () { dar({ tipo: 'pedras', stoneId: sid, n: 10 }, '10× ' + pd3.name); });
          row.appendChild(btn('+100', 'btn-mini btn-primary', function () {
            dar({ tipo: 'pedras', stoneId: sid, n: 100 }, '100× ' + pd3.name);
          }));
          listaEl.appendChild(row);
        });
        if (vistas) {
          listaEl.appendChild(btn(tr('+100 de cada pedra'), 'btn-gold btn-block', function () {
            // uma entrega por pedra, uma depois da outra (o servidor confere cada uma)
            Object.keys(pedras).reduce(function (p, sid) {
              return p.then(function () { return ctx.entrega({ tipo: 'pedras', stoneId: sid, n: 100 }, '100× ' + pedras[sid].name); });
            }, Promise.resolve()).then(function () { if (ctx.aberta()) pinta(); });
          }));
        }
      } else if (gmCaixaAba === 'moedas') {
        // os selos do Colecionador (um por elemento) e as insígnias de fundação
        var selos = safe(function () { return JOGO.Progress.selosVer(); }, null) || {};
        var porGiro = (D0.selos && D0.selos.porGiro) || 10;
        (D0.elements || Object.keys(selos)).forEach(function (e4) {
          var nomeS = tr('Selo de {a}', { a: ELEM_PT[e4] || e4 });
          if (!passa(nomeS, e4) || corta()) return;
          var row = linha(art('seloIcon', [e4, 40], 40, 'selo-moeda-img'), nomeS,
            tr('{a} selos somados pagam um giro na roleta do Colecionador{paraQuem}', { a: tem(selos[e4] || 0) + porGiro, paraQuem: paraQuem }),
            '+10', function () { dar({ tipo: 'selos', elemento: e4, n: 10 }, '10 ' + nomeS); });
          row.appendChild(btn('+100', 'btn-mini btn-primary', function () {
            dar({ tipo: 'selos', elemento: e4, n: 100 }, '100 ' + nomeS);
          }));
          listaEl.appendChild(row);
        });
        if (passa(tr('Insígnia de Fundação'), 'insignia') && !corta()) {
          var ins = safe(function () { return JOGO.Progress.insigniasVer(); }, 0) || 0;
          var porGuilda = (D0.insignias && D0.insignias.porGuilda) || 10;
          var rowI = linha(art('insigniaIcon', [40], 40, 'selo-moeda-img'), tr('Insígnia de Fundação'),
            tr('{a} fundam uma guilda{paraQuem}', { a: tem(ins) + porGuilda, paraQuem: paraQuem }),
            '+10', function () { dar({ tipo: 'insignias', n: 10 }, tr('10 Insígnias de Fundação')); });
          rowI.appendChild(btn('+100', 'btn-mini btn-primary', function () {
            dar({ tipo: 'insignias', n: 100 }, tr('100 Insígnias de Fundação'));
          }));
          listaEl.appendChild(rowI);
        }
      } else if (gmCaixaAba === 'cartas') {
        // as cartas de classe: liberam a classe e compram as estrelas
        Object.keys(D0.classes || {}).forEach(function (cid) {
          var cd = D0.classes[cid];
          if (!cd || cid === 'gm' || !passa(cd.name, cid) || corta()) return;
          var ci = safe(function () { return JOGO.Progress.cardInfo(cid); }, null) || {};
          var sub = proprio
            ? tr('{a} · <b>{b}</b> cartas · {c}', { a: ci.unlocked ? tr('liberada') : tr('trancada ({n} cartas liberam)', { n: ci.unlockCost || 0 }), b: ci.cards || 0, c: ci.stars ? '★' + ci.stars : tr('sem estrela') })
            : tr('cartas de classe{paraQuem}', { paraQuem: paraQuem });
          var row = linha(art('portrait', [cid, { element: 'neutro', size: 80 }], 40), cd.name || cid, sub,
            '+10', function () { dar({ tipo: 'cartas', classId: cid, n: 10 }, tr('10 cartas de {name}', { name: cd.name })); });
          row.appendChild(btn('Liberar e ★5', 'btn-mini btn-primary', function () {
            dar({ tipo: 'cartas', classId: cid, topo: true }, tr('{name}: liberada e no ★5', { name: cd.name }));
          }));
          listaEl.appendChild(row);
        });
      } else if (gmCaixaAba === 'pergaminhos') {
        // os pergaminhos da loja (até o teto de cada um) e os dias de bônus de XP
        var pg = safe(function () { return JOGO.Progress.pergaminhos(); }, null) || {};
        var cfgP = D0.pergaminhos || {}, xpP = cfgP.xp || {};
        var tetoP = cfgP.tetoInventario || 99;
        [['xp', tr('Pergaminho da Sabedoria'), tr('×{a} de XP por {b} salas vencidas', { a: String(xpP.fator || 1.5).replace('.', ','), b: xpP.salas || 9 })],
         ['elemento', tr('Pergaminho da Reescrita'), tr('troca um caminho de elemento do herói por outro')]].forEach(function (pp) {
          if (!passa(pp[1], pp[0]) || corta()) return;
          var row = linha(glifo('📜'), pp[1], (proprio ? tr('você tem <b>{a}</b> de {tetoP} ·', { a: pg[pp[0]] || 0, tetoP: tetoP }) + ' '
                                                        : tr('até {tetoP} ·', { tetoP: tetoP }) + ' ') + esc(pp[2]) + paraQuem,
            '+1', function () { dar({ tipo: 'pergaminho', pergaminho: pp[0], n: 1 }, '1 ' + pp[1]); });
          row.appendChild(btn(tr('Encher'), 'btn-mini btn-primary', function () {
            dar({ tipo: 'pergaminho', pergaminho: pp[0], n: tetoP }, tr('{a} até o teto', { a: pp[1] }));
          }));
          listaEl.appendChild(row);
        });
        if (passa(tr('Bônus de XP'), 'bonus') && !corta()) {
          var ate = safe(function () { return JOGO.Progress.bonusXpAte(); }, 0) || 0;
          var agoraB = safe(function () { return JOGO.Agenda.agora(); }, null) || Date.now();
          var agoraSB = agoraB > 1e11 ? agoraB / 1000 : agoraB;
          var fatorB = String((D0.bonusXp && D0.bonusXp.fator) || 1.5).replace('.', ',');
          var estadoB = !proprio ? tr('soma aos dias que a conta já tiver') : ate > agoraSB
            ? tr('ligado até {a}', { a: new Date(ate * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) })
            : 'desligado';
          var rowB = linha(glifo('⏳'), tr('Bônus de XP (×{fatorB})', { fatorB: fatorB }),
            tr('{estadoB} · o mesmo da loja; conta no relógio do servidor{paraQuem}', { estadoB: estadoB, paraQuem: paraQuem }),
            '+1 dia', function () { dar({ tipo: 'bonus-xp', dias: 1 }, tr('1 dia de bônus de XP')); });
          rowB.appendChild(btn('+7 dias', 'btn-mini btn-primary', function () {
            dar({ tipo: 'bonus-xp', dias: 7 }, tr('7 dias de bônus de XP'));
          }));
          listaEl.appendChild(rowB);
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
            var sub = esc(bonusText(pd2.bonuses)) + (proprio ? ' · ' + (info.unlocked ? tr('é seu — {a}', { a: petNivelTxt(pid2) }) : tr('não é seu')) : paraQuem);
            var row = linha(art('petIcon', [pid2, 40], 40), pd2.name || pid2, sub, tr('Pegar'), function () {
              dar({ tipo: 'pet', petId: pid2, topo: false }, pd2.name);
            });
            row.appendChild(btn('★3 nv10', 'btn-mini btn-primary', function () {
              dar({ tipo: 'pet', petId: pid2, topo: true }, tr('{name} no topo: ★3, nível 10', { name: pd2.name }));
            }));
            listaEl.appendChild(row);
          })(pids[p], pd);
        }
      }
      if (!vistas) listaEl.appendChild(el('p', 'inv-dica', tr('Nada com esse nome.')));
    }
    busca.addEventListener('input', function () { gmCaixaBusca = busca.value; pinta(); });
    busca.addEventListener('keydown', function (ev) { ev.stopPropagation(); });   // o "i" digitado aqui não abre o saco
    pinta();
  }
  UI.gmCaixaEm = gmCaixaEm;
  UI.gmCaixaAba = function (id) { gmCaixaAba = id; };     // o painel abre a Caixa já numa aba ('itens')

  /* OS EVENTOS DO MUNDO (10/09, pedido do dono: "eventos ligados pelo jogo +
   * calendário automático, mostrados no site"). Três abas no molde da Caixa:
   * AGORA (liga já, por N horas), AGENDAR (começo e fim na hora de Brasília)
   * e CALENDÁRIO (as regras de toda semana, o que está no ar e o que vem, e
   * os 14 dias com o Calabouço do Dia). Quem grava é o SERVIDOR, e só para a
   * conta com a marca de Mestre (contas.gm = 1): sem essa sessão — a chave
   * local abre a ficha, mas não liga evento de ninguém — ou com o servidor
   * fora, a ficha fica só de leitura e diz o que falta. Os tetos são os da
   * agenda (xp 2 · vintém 1,5 · pedras 2 · saque 1,5 · aviso 1).
   * 03/10: é a aba Eventos do painel único do Mestre (UI.gmAgendaEm). */
  var gmAgendaAba = 'agora';
  /* 08/10 à noite: o estado do CALENDÁRIO EM GRADE — o mês à vista (Brasília), o dia tocado (chave
   * 'AAAA-MM-DD') e se o formulário da regra nova está aberto. Mês/dia nulos = os de hoje, decididos
   * na pintura (o relógio do servidor pode chegar depois do primeiro desenho). */
  var gmAgendaCal = { ano: null, mes: null, dia: null, form: false };
  var gmAgendaRasc = { tipo: 'xp', mult: 2, cal: '', titulo: '', texto: '', horas: 2,
                       ini: '', fim: '', dias: [6], hora: '10:00', durH: 12 };
  // 12/09: o multiplicador é livre (mais de 1 até o teto do tipo); estes são só os atalhos
  var AG_MULTS = [1.5, 2, 3, 5, 10];
  var AG_DICA = {
    xp: tr('Toda sala paga mais experiência (o corte por herói, o dízimo e o pet herdam).'),
    vintem: tr('Toda sala paga mais vinténs.'),
    pedras: tr('Mais pedras de forja ELEMENTAIS — a Âncora fica fora.'),
    saque: tr('Sai peça com mais frequência; a proporção entre as raridades não muda. Junto do Calabouço do Dia, vale o maior.'),
    aviso: tr('Só um anúncio no jogo e no site, sem mexer em nada.')
  };
  function gmAgendaEm(body, ctx0) {
    var GMod = JOGO.GM, Ag = JOGO.Agenda;
    var ctx = gmCtx(ctx0);
    // redesenha a aba (só se o painel ainda estiver nela: a resposta do servidor pode chegar depois)
    function refaz() { if (ctx.aberta()) ctx.refaz(); }
    if (!GMod || !GMod.ativo || !GMod.ativo()) {
      body.appendChild(el('p', 'inv-dica', tr('Os eventos do mundo são do Mestre: entre com a conta dele.')));
      return;
    }
    body.appendChild(el('p', 'inv-dica ag-sub',
      tr('Liga agora, agenda ou põe no calendário de toda semana — vale para todos os jogadores, no jogo e no site.')));
    if (!Ag || !Ag.fator) {
      body.appendChild(el('p', 'inv-dica', tr('A agenda do mundo não carregou nesta página.')));
      return;
    }
    var S = JOGO.Sessao;
    var comMarca = !!safe(function () { return S.ativa() && S.conta() && S.conta().gm === true; }, false);
    var servidor = !!safe(function () { return Ag.noAr(); }, false);
    var pode = comMarca && servidor;
    function dois(n) { return (n < 10 ? '0' : '') + n; }

    var abas = el('div', 'inv-filtros ag-abas');
    abas.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
    [['agora', tr('Agora')], ['agendar', tr('Agendar')], ['calendario', tr('Calendário')]].forEach(function (par) {
      abas.appendChild(btn(par[1], 'btn-mini ag-aba' + (gmAgendaAba === par[0] ? ' btn-gold' : ' btn-ghost'), function () {
        gmAgendaAba = par[0];
        refaz();
      }));
    });
    body.appendChild(abas);

    if (!comMarca) body.appendChild(el('p', 'ag-nota', esc(Ag.NOTA_MESTRE)));
    else if (!servidor) {
      body.appendChild(el('p', 'ag-nota', tr('O servidor está fora (ou ainda não conhece os eventos do mundo): a lista abaixo é a última que chegou, só para leitura.')));
    }

    // sem a marca ou sem servidor, todo botão que grava fica desligado
    function desliga(b) { if (!pode) { b.disabled = true; b.classList.add('is-off'); } return b; }
    // a resposta do servidor: o erro dele vai inteiro para o toast; a ficha repinta
    function resposta(r, okMsg) {
      if (r && r.ok) ctx.aviso(okMsg, 'good');
      else ctx.aviso((r && r.erro) || tr('não deu — o servidor não respondeu'));
      refaz();
    }
    function campo(txt, controle) {
      var w = el('label', 'ag-campo');
      w.appendChild(el('span', 'inv-dica', esc(txt)));
      w.appendChild(controle);
      return w;
    }
    function seletor(opcoes, valor, aoMudar) {
      var sel = document.createElement('select');
      sel.className = 'hub-input ag-sel';
      opcoes.forEach(function (o) {
        var op = document.createElement('option');
        op.value = String(o[0]);
        op.textContent = o[1];
        if (String(o[0]) === String(valor)) op.selected = true;
        sel.appendChild(op);
      });
      sel.addEventListener('change', function () { aoMudar(sel.value); });
      return sel;
    }
    function entrada(tipo, valor, aoMudar, attrs) {
      var i = document.createElement(tipo === 'textarea' ? 'textarea' : 'input');
      if (tipo !== 'textarea') i.type = tipo;
      i.className = 'hub-input ag-in';
      i.value = (valor == null) ? '' : String(valor);
      for (var k in (attrs || {})) if (attrs.hasOwnProperty(k)) i.setAttribute(k, attrs[k]);
      i.addEventListener('input', function () { aoMudar(i.value); });
      i.addEventListener('keydown', function (ev) { ev.stopPropagation(); });   // o "i" digitado aqui não abre o saco
      return i;
    }
    function multsDe(tipo) {
      var teto = Ag.TETOS[tipo] || 1;
      return AG_MULTS.filter(function (m) { return m <= teto + 1e-9 && m > 1; });
    }
    // tipo, multiplicador (filtrado pelo teto do tipo), calabouço, título e texto
    function camposComuns(form) {
      var R = gmAgendaRasc;
      if (!Ag.TETOS[R.tipo]) R.tipo = 'xp';
      form.appendChild(campo(tr('Tipo'), seletor(Ag.TIPOS.map(function (t) {
        return [t, Ag.NOMES[t] + (Ag.TETOS[t] > 1 ? ' ' + tr('(até {a})', { a: Ag.fmtFator(Ag.TETOS[t]) }) : '')];
      }), R.tipo, function (v) {
        R.tipo = v;
        refaz();
      })));
      var teto = Ag.TETOS[R.tipo] || 1;
      if (teto > 1) {
        var mR = multLido(R.mult);
        if (!(mR > 1 && mR <= teto)) R.mult = Math.min(2, teto);
        // div, não label: o toque num atalho não pode cair no campo
        var wMult = el('div', 'ag-campo');
        wMult.appendChild(el('span', 'inv-dica', esc(tr('Multiplicador (de ×1,01 até {a})', { a: Ag.fmtFator(teto) }))));
        wMult.appendChild(entrada('number', R.mult, function (v) { R.mult = v; },
          { min: '1.01', max: String(teto), step: '0.01', inputmode: 'decimal' }));
        var atalhos = el('div', 'ag-dias ag-atalhos');
        multsDe(R.tipo).forEach(function (m) {
          atalhos.appendChild(btn(Ag.fmtFator(m), 'btn-mini ag-mult-b' + (multLido(R.mult) === m ? ' btn-gold' : ' btn-ghost'),
            function () { R.mult = m; refaz(); }));
        });
        wMult.appendChild(atalhos);
        form.appendChild(wMult);
      }
      form.appendChild(el('p', 'inv-dica ag-dica', esc(AG_DICA[R.tipo] || '')));
      form.appendChild(campo(tr('Calabouço'), seletor([['', tr('Todos os calabouços')]].concat(
        Ag.calaboucosDoPainel().map(function (id) { return [id, Ag.nomeCalabouco(id)]; })),
        R.cal, function (v) { R.cal = v; })));
      form.appendChild(campo(tr('Título (3 a 60 letras)'), entrada('text', R.titulo, function (v) { R.titulo = v; },
        { maxlength: '60', placeholder: tr('Quinta do XP') })));
      form.appendChild(campo(tr('Texto (opcional, até 280)'), entrada('textarea', R.texto, function (v) { R.texto = v; },
        { maxlength: '280', rows: '2', placeholder: tr('Toda sala paga o dobro de experiência.') })));
    }
    function corpoComum() {
      var R = gmAgendaRasc;
      var c = { tipo: R.tipo, calabouco: R.cal || null,
                titulo: String(R.titulo || '').trim(), texto: String(R.texto || '').trim() };
      if (R.tipo !== 'aviso') c.multiplicador = Number(R.mult);
      return c;
    }
    function tituloOk() {
      var t = String(gmAgendaRasc.titulo || '').trim();
      if (t.length < 3 || t.length > 60) { ctx.aviso(tr('O título precisa de 3 a 60 letras.')); return false; }
      return multOk();
    }
    // "1,5" ou "1.5" → 1.5, em 2 casas (o servidor arredonda igual); lixo → NaN
    function multLido(v) {
      var n = Number(String(v == null ? '' : v).trim().replace(',', '.'));
      return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
    }
    function multOk() {
      var R = gmAgendaRasc;
      if (R.tipo === 'aviso') return true;
      var teto = Ag.TETOS[R.tipo] || 1, m = multLido(R.mult);
      if (!(m > 1 && m <= teto)) {
        ctx.aviso(tr('O multiplicador vai de ×1,01 até {a}.', { a: Ag.fmtFator(teto) }));
        return false;
      }
      R.mult = m;
      return true;
    }
    // uma linha de evento; o pontual ganha "encerrar" (no ar) ou "cancelar" (futuro)
    function linhaEvento(e) {
      var agoraMs = Ag.agora();
      var noArAgora = e.inicio * 1000 <= agoraMs;
      var row = el('div', 'ms-linha ag-linha');
      row.setAttribute('data-evento', e.id);
      var tx = el('div', 'ms-tx');
      tx.appendChild(el('div', 'ms-nome', '<b>' + esc(e.titulo) + '</b> <i>· ' + esc(Ag.rotulo(e)) +
        ' · ' + esc(Ag.nomeCalabouco(e.calabouco)) + '</i>'));
      var quando = noArAgora
        ? tr('no ar · termina em {a} ({b})', { a: Ag.falta(e.fim * 1000 - agoraMs), b: Ag.quando(e.fim) })
        : tr('{a} → {b} (Brasília)', { a: Ag.quando(e.inicio), b: Ag.quando(e.fim) });
      tx.appendChild(el('div', 'ms-prog', esc(quando) + (e.origem === 'calendario' ? tr(' · da regra semanal') : '') +
        (e.texto ? ' — ' + esc(e.texto) : '')));
      row.appendChild(tx);
      var alvo = Ag.alvoDe(e);
      if (alvo && alvo.alvo === 'evento') {
        row.appendChild(desliga(btn(noArAgora ? tr('Encerrar') : tr('Cancelar'), 'btn-mini btn-ghost ag-cancela', function () {
          ctx.confirma(noArAgora ? tr('Encerrar o evento agora?') : tr('Cancelar o evento?'),
            tr('<b>{a}</b> ({b}) sai do ar para todo mundo. Não há como desfazer — dá para ligar de novo.', { a: esc(e.titulo), b: esc(Ag.rotulo(e)) }),
            function () {
              Ag.cancelar(alvo.alvo, alvo.id).then(function (r) {
                resposta(r, noArAgora ? tr('Evento encerrado.') : tr('Evento cancelado.'));
              });
            });
        })));
      }
      return row;
    }
    // uma lista de eventos com título, em `alvo` (o corpo da aba quando não vem — 08/10: os detalhes
    // do dia tocado no calendário em grade reaproveitam as mesmas linhas)
    function listaEventos(titulo, evs, vazio, alvo) {
      var onde = alvo || body;
      onde.appendChild(el('h3', 'hs-sec', esc(titulo)));
      var caixa = el('div', 'ms-caixa ag-lista');
      if (!evs.length) caixa.appendChild(el('p', 'inv-dica', esc(vazio)));
      evs.forEach(function (e) { caixa.appendChild(linhaEvento(e)); });
      onde.appendChild(caixa);
    }
    // uma linha de regra de toda semana, com o Cancelar (a lista "Toda semana" e os detalhes do dia)
    function linhaRegra(rg) {
      var row = el('div', 'ms-linha ag-linha');
      row.setAttribute('data-regra', String(rg.id));
      var tx = el('div', 'ms-tx');
      tx.appendChild(el('div', 'ms-nome', '<b>' + esc(rg.titulo) + '</b> <i>· ' + esc(Ag.rotulo(rg)) +
        ' · ' + esc(Ag.nomeCalabouco(rg.calabouco)) + '</i>'));
      tx.appendChild(el('div', 'ms-prog', esc(Ag.textoRegra(rg))));
      row.appendChild(tx);
      row.appendChild(desliga(btn(tr('Cancelar'), 'btn-mini btn-ghost ag-cancela', function () {
        ctx.confirma(tr('Tirar a regra do calendário?'),
          tr('<b>{a}</b> para de acontecer — e a ocorrência que estiver no ar sai junto.', { a: esc(rg.titulo) }),
          function () {
            Ag.cancelar('regra', rg.id).then(function (r) { resposta(r, tr('Regra cancelada.')); });
          });
      })));
      return row;
    }

    var R = gmAgendaRasc;
    if (gmAgendaAba === 'agora') {
      body.appendChild(el('h3', 'hs-sec', tr('Ligar agora')));
      var fA = el('div', 'ag-form');
      camposComuns(fA);
      fA.appendChild(campo(tr('Duração em horas (1 a 168)'), entrada('number', R.horas, function (v) { R.horas = v; },
        { min: '1', max: '168', step: '1' })));
      body.appendChild(fA);
      body.appendChild(desliga(btn(tr('Ligar agora'), 'btn-gold btn-block ag-envia', function () {
        if (!tituloOk()) return;
        var h = Math.floor(Number(R.horas));
        if (!(h >= 1 && h <= 168)) { ctx.aviso(tr('A duração vai de 1 a 168 horas.')); return; }
        var c = corpoComum();
        // sem `inicio`: o servidor liga no relógio DELE. As 168 h cheias perdem
        // 2 min para não passar dos 7 dias por um desvio de relógio de segundos.
        c.fim = Math.floor(Ag.agora() / 1000) + h * 3600 - (h >= 168 ? 120 : 0);
        Ag.criar(c).then(function (r) { resposta(r, tr('Evento no ar: {titulo}.', { titulo: c.titulo })); });
      })));
      listaEventos(tr('No ar agora'), Ag.ativos(), tr('Nenhum evento no ar.'));
    } else if (gmAgendaAba === 'agendar') {
      body.appendChild(el('h3', 'hs-sec', tr('Agendar (hora de Brasília)')));
      var fB = el('div', 'ag-form');
      camposComuns(fB);
      if (!R.ini || !R.fim) {
        var cheia = Math.ceil(Ag.agora() / 3600000) * 3600;            // a próxima hora cheia
        R.ini = Ag.paraBrasilia(cheia + 3600);
        R.fim = Ag.paraBrasilia(cheia + 5 * 3600);
      }
      fB.appendChild(campo(tr('Começa'), entrada('datetime-local', R.ini, function (v) { R.ini = v; })));
      fB.appendChild(campo(tr('Termina'), entrada('datetime-local', R.fim, function (v) { R.fim = v; })));
      body.appendChild(fB);
      body.appendChild(desliga(btn(tr('Agendar'), 'btn-gold btn-block ag-envia', function () {
        if (!tituloOk()) return;
        var ini = Ag.deBrasilia(R.ini), fim = Ag.deBrasilia(R.fim);
        if (ini == null || fim == null) { ctx.aviso(tr('Diga quando começa e quando termina.')); return; }
        if (!(fim > ini)) { ctx.aviso(tr('O fim tem de vir depois do começo.')); return; }
        if (fim - ini > 7 * 86400) { ctx.aviso(tr('Um evento dura no máximo 7 dias.')); return; }
        var c = corpoComum();
        c.inicio = ini;
        c.fim = fim;
        Ag.criar(c).then(function (r) { resposta(r, tr('Evento agendado: {titulo}.', { titulo: c.titulo })); });
      })));
      listaEventos(tr('Agendados'), Ag.proximos().filter(function (e) { return e.origem !== 'calendario'; }),
        tr('Nada agendado.'));
    } else {
      /* O CALENDÁRIO EM GRADE (08/10 à noite — o dono: "no painel do Mestre, em Eventos, faça um
       * calendário em formato de calendário, não em linhas.. melhor para visualizar"). Até aqui a
       * sub-aba era uma pilha de listas (toda semana, no ar, próximos 14 dias, a semana do SOTERRA e os
       * 14 dias do Calabouço do Dia). Agora é UM MÊS por vez: 7 colunas (dom … sáb), uma linha por
       * semana, setas ‹ › e o nome do mês no alto, o dia de hoje aceso — tudo no relógio de BRASÍLIA
       * lido pelo relógio do servidor (Ag.agora + FUSO_MIN: é o fuso das regras e o do sorteio do
       * Calabouço do Dia em diario.js, então o PC com a hora torta não desloca nenhum dia). Cada célula
       * é compacta, para caber em 390 px: o número, a sigla do Calabouço do Dia (☀ + iniciais), um chip
       * colorido por tipo para cada ocorrência de regra semanal (a hora) e para cada evento agendado que
       * toca o dia (o fator; "!" no aviso), e a faixa de cor do bônus fixo da semana do SOTERRA no pé.
       * O toque num dia abre os detalhes embaixo da grade — as linhas de sempre (linhaRegra/linhaEvento),
       * com Encerrar/Cancelar. As ocorrências que o servidor já expandiu (origem 'calendario' e
       * 'programa') NÃO entram pela lista de eventos: a regra e o programa desenham o dia delas em
       * qualquer mês, inclusive além dos 14 dias da janela do servidor; só os pontuais (e os fixos do
       * Eco) vêm da lista — e esses só existem dentro da janela. O formulário da regra nova fica
       * recolhido no botão "Nova regra de toda semana", para a grade ter espaço. */
      var C = gmAgendaCal;
      var FUSO = (typeof Ag.FUSO_MIN === 'number') ? Ag.FUSO_MIN : -180;
      var DIA_MS = 86400000;
      function chaveDia(a, m, d) { return a + '-' + dois(m + 1) + '-' + dois(d); }
      // a meia-noite de Brasília de (ano, mês 0–11, dia), em ms de epoch
      function meiaNoite(a, m, d) { return Date.UTC(a, m, d, 0, 0, 0) - FUSO * 60000; }
      var hojeB = new Date(Ag.agora() + FUSO * 60000);                 // os campos getUTC* são os de Brasília
      var hojeA = hojeB.getUTCFullYear(), hojeM = hojeB.getUTCMonth(), hojeD = hojeB.getUTCDate();
      var hojeChave = chaveDia(hojeA, hojeM, hojeD);
      if (C.ano == null || C.mes == null) { C.ano = hojeA; C.mes = hojeM; }
      if (!C.dia) C.dia = hojeChave;
      var MESES = [tr('janeiro'), tr('fevereiro'), tr('março'), tr('abril'), tr('maio'), tr('junho'),
                   tr('julho'), tr('agosto'), tr('setembro'), tr('outubro'), tr('novembro'), tr('dezembro')];
      var regrasTodas = Ag.regras();
      var progTodo = safe(function () { return Ag.programa(); }, []) || [];
      var pontuais = Ag.ativos().concat(Ag.proximos()).filter(function (e) {
        return e.origem !== 'calendario' && e.origem !== 'programa';
      });
      // tudo o que cai num dia: as regras daquele dia da semana (vigentes), os eventos que tocam o dia,
      // o bônus fixo, o Calabouço do Dia e o afixo (os dois sorteiam pela chave do dia de Brasília)
      function doDiaDe(a, m, d) {
        var ini = meiaNoite(a, m, d), fim = ini + DIA_MS;
        var dow = new Date(ini + FUSO * 60000).getUTCDay();
        var ts = ini + DIA_MS / 2;                                       // o meio-dia de Brasília
        return {
          chave: chaveDia(a, m, d), ini: ini, fim: fim, dow: dow, ts: ts,
          calabouco: safe(function () { return JOGO.Diario.hoje(ts); }, null),
          afixo: afixoDe(safe(function () { return JOGO.Afixos.doDia(ts); }, null)),
          regras: regrasTodas.filter(function (rg) {
            if (!rg.dias || rg.dias.indexOf(dow) < 0) return false;
            if (rg.vigenteDe != null && rg.vigenteDe * 1000 >= fim) return false;
            if (rg.vigenteAte != null && rg.vigenteAte * 1000 <= ini) return false;
            return true;
          }),
          eventos: pontuais.filter(function (e) { return e.inicio * 1000 < fim && e.fim * 1000 > ini; }),
          programa: progTodo.filter(function (p) { return p.dia === dow; })[0] || null
        };
      }
      // a sigla do calabouço na célula: as iniciais sem os artigos ("A Cisterna dos Afogados" → CA)
      var SEM_SIGLA = { a: 1, o: 1, as: 1, os: 1, de: 1, do: 1, da: 1, dos: 1, das: 1, e: 1, sem: 1,
                        the: 1, of: 1, el: 1, la: 1, los: 1, las: 1, del: 1, sin: 1, y: 1 };
      function sigla(nome) {
        var ps = String(nome || '').split(/\s+/).filter(function (p) { return p && !SEM_SIGLA[p.toLowerCase()]; });
        return ps.map(function (p) { return p.charAt(0).toUpperCase(); }).join('').slice(0, 3) || '?';
      }
      // o chip colorido por tipo (a cor vem do CSS: .ag-t-xp … .ag-t-aviso)
      function chip(tipo, texto, titulo) {
        var c = el('span', 'ag-cal-chip ag-t-' + esc(Ag.TETOS[tipo] ? tipo : 'aviso'), esc(texto));
        if (titulo) c.title = titulo;
        return c;
      }
      function mudaMes(n) {
        var m = C.mes + n;
        C.ano += Math.floor(m / 12);
        C.mes = ((m % 12) + 12) % 12;
        C.dia = (C.ano === hojeA && C.mes === hojeM) ? hojeChave : chaveDia(C.ano, C.mes, 1);
        refaz();
      }

      // ---- a regra nova, recolhida num botão (o formulário é o de sempre)
      body.appendChild(btn(C.form ? tr('Recolher a regra nova') : tr('Nova regra de toda semana'),
        'btn-mini ag-cal-nova ' + (C.form ? 'btn-ghost' : 'btn-gold'), function () { C.form = !C.form; refaz(); }));
      if (C.form) {
        var fC = el('div', 'ag-form');
        camposComuns(fC);
        var dias = el('div', 'ag-dias');
        Ag.DIA_CURTO.forEach(function (nome, d) {
          var on = R.dias.indexOf(d) >= 0;
          dias.appendChild(btn(nome, 'btn-mini ag-dia-b' + (on ? ' btn-gold' : ' btn-ghost'), function () {
            var i = R.dias.indexOf(d);
            if (i >= 0) R.dias.splice(i, 1); else R.dias.push(d);
            refaz();
          }));
        });
        var wDias = el('div', 'ag-campo');          // div, não label: o toque no rótulo apertaria o domingo
        wDias.appendChild(el('span', 'inv-dica', tr('Dias')));
        wDias.appendChild(dias);
        fC.appendChild(wDias);
        fC.appendChild(campo(tr('Hora de Brasília'), entrada('time', R.hora, function (v) { R.hora = v; })));
        fC.appendChild(campo(tr('Duração em horas (¼ a 24)'), entrada('number', R.durH, function (v) { R.durH = v; },
          { min: '0.25', max: '24', step: '0.25' })));
        body.appendChild(fC);
        body.appendChild(desliga(btn(tr('Pôr no calendário'), 'btn-gold btn-block ag-envia', function () {
          if (!tituloOk()) return;
          if (!R.dias.length) { ctx.aviso(tr('Escolha pelo menos um dia.')); return; }
          if (!/^\d{2}:\d{2}$/.test(String(R.hora || ''))) { ctx.aviso(tr('A hora vai no formato 10:00.')); return; }
          var dur = Math.round(Number(R.durH) * 60);
          if (!(dur >= 15 && dur <= 1440)) { ctx.aviso(tr('A duração vai de 15 minutos a 24 horas.')); return; }
          var c = corpoComum();
          c.dias = R.dias.slice().sort(function (a, b) { return a - b; });
          c.hora = R.hora;
          c.duracaoMin = dur;
          c.vigenteDe = null;
          c.vigenteAte = null;
          Ag.criarRegra(c).then(function (r) {
            if (r && r.ok) C.form = false;                                // entrou: a grade volta a ter o espaço
            resposta(r, tr('No calendário: {a}.', { a: Ag.textoRegra(c) }));
          });
        })));
      }

      // ---- o mês: ‹ nome ›, e "Hoje" quando se saiu do mês de hoje
      var topo = el('div', 'ag-cal-topo');
      topo.appendChild(btn('‹', 'btn-mini btn-ghost ag-cal-ant', function () { mudaMes(-1); }));
      topo.appendChild(el('b', 'ag-cal-mes', esc(MESES[C.mes] + ' ' + C.ano)));
      if (C.ano !== hojeA || C.mes !== hojeM) {
        topo.appendChild(btn(tr('Hoje'), 'btn-mini btn-ghost ag-cal-hoje', function () {
          C.ano = hojeA; C.mes = hojeM; C.dia = hojeChave;
          refaz();
        }));
      }
      topo.appendChild(btn('›', 'btn-mini btn-ghost ag-cal-prox', function () { mudaMes(1); }));
      body.appendChild(topo);

      // ---- a grade: 7 cabeças, as células vazias antes do dia 1 e depois do último, e os dias
      var grade = el('div', 'ag-cal-grade');
      grade.setAttribute('data-mes', C.ano + '-' + dois(C.mes + 1));
      Ag.DIA_CURTO.forEach(function (nome) { grade.appendChild(el('div', 'ag-cal-cab', esc(nome))); });
      var nDias = new Date(Date.UTC(C.ano, C.mes + 1, 0)).getUTCDate();
      var colIni = new Date(Date.UTC(C.ano, C.mes, 1)).getUTCDay();
      var nCel = Math.ceil((colIni + nDias) / 7) * 7;
      for (var i = 0; i < nCel; i++) {
        var d = i - colIni + 1;
        if (d < 1 || d > nDias) { grade.appendChild(el('div', 'ag-cal-dia is-vazio')); continue; }
        var info = doDiaDe(C.ano, C.mes, d);
        var cel = el('button', 'ag-cal-dia' + (info.chave === hojeChave ? ' is-hoje' : '') +
          (info.chave === C.dia ? ' is-sel' : '') + (info.dow === 0 || info.dow === 6 ? ' is-fds' : ''));
        cel.type = 'button';
        cel.setAttribute('data-dia', info.chave);
        cel.setAttribute('data-calabouco', info.calabouco ? info.calabouco.dungeonId : '');
        cel.appendChild(el('span', 'ag-cal-num', String(d)));
        if (info.calabouco) {
          var nomeC = Ag.nomeCalabouco(info.calabouco.dungeonId);
          var sC = el('span', 'ag-cal-cal', '☀ ' + esc(sigla(nomeC)));
          sC.title = tr('Calabouço do Dia: {a}', { a: nomeC });
          cel.appendChild(sC);
        }
        var chips = [];
        info.regras.forEach(function (rg) {
          chips.push(chip(rg.tipo, rg.hora || '', rg.titulo + ' · ' + Ag.rotulo(rg) + ' · ' + Ag.textoRegra(rg)));
        });
        info.eventos.forEach(function (e) {
          chips.push(chip(e.tipo, e.tipo === 'aviso' ? '!' : Ag.fmtFator(e.multiplicador), e.titulo + ' · ' + Ag.rotulo(e)));
        });
        chips.slice(0, 3).forEach(function (c) { cel.appendChild(c); });
        if (chips.length > 3) cel.appendChild(el('span', 'ag-cal-mais', '+' + (chips.length - 3)));
        if (info.programa) {
          var faixa = el('span', 'ag-cal-prog ag-t-' + esc(Ag.TETOS[info.programa.tipo] ? info.programa.tipo : 'aviso'));
          faixa.title = info.programa.titulo + ' · ' + Ag.rotulo({ tipo: info.programa.tipo, multiplicador: info.programa.multiplicador });
          cel.appendChild(faixa);
        }
        (function (ch) { tap(cel, function () { C.dia = ch; refaz(); }); })(info.chave);
        grade.appendChild(cel);
      }
      body.appendChild(grade);

      // ---- a legenda: a cor de cada tipo, a sigla e a faixa
      var leg = el('div', 'ag-cal-legenda');
      Ag.TIPOS.forEach(function (t) { leg.appendChild(chip(t, Ag.NOMES[t])); });
      leg.appendChild(el('span', 'ag-cal-legenda-tx', esc(tr('☀ sigla = Calabouço do Dia · faixa no pé = a semana do SOTERRA · toque num dia para ver os detalhes'))));
      body.appendChild(leg);

      // ---- os detalhes do dia tocado: o Calabouço do Dia e o afixo, o bônus fixo, as regras e os eventos
      var pm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(C.dia));
      if (pm) {
        var sel = doDiaDe(+pm[1], +pm[2] - 1, +pm[3]);
        body.appendChild(el('h3', 'hs-sec ag-cal-det-tit',
          esc(Ag.DIA_CURTO[sel.dow] + ' ' + pm[3] + '/' + pm[2] + '/' + pm[1]) + (sel.chave === hojeChave ? ' · ' + tr('hoje') : '')));
        var det = el('div', 'ms-caixa ag-lista ag-cal-det');
        det.setAttribute('data-dia-det', sel.chave);
        det.appendChild(el('p', 'ag-cal-det-dia', sel.calabouco
          ? tr('☀ {a} — Calabouço do Dia', { a: esc(Ag.nomeCalabouco(sel.calabouco.dungeonId)) }) +
            (sel.afixo ? ' · ' + esc(sel.afixo.icone || '✦') + ' ' + esc(sel.afixo.nome) : '')
          : '—'));
        if (sel.programa) {
          var p = sel.programa;
          var ln = el('div', 'ag-semana-dia' + (sel.chave === hojeChave ? ' is-hoje' : ''));
          ln.appendChild(el('b', null, esc(Ag.DIA_CURTO[p.dia] || '')));
          ln.appendChild(el('span', 'ag-semana-tit', esc(p.titulo) + ' <i>· ' + esc(Ag.rotulo({ tipo: p.tipo, multiplicador: p.multiplicador })) +
            (p.calabouco ? ' · ' + esc(p.calabouco === 'dia' ? tr('Calabouço do Dia') : Ag.nomeCalabouco(p.calabouco)) : '') +
            ' · ' + esc(tr('A semana do SOTERRA')) + '</i>'));
          if (p.texto) ln.appendChild(el('span', 'ag-semana-tx', esc(p.texto)));
          det.appendChild(ln);
        }
        sel.regras.forEach(function (rg) { det.appendChild(linhaRegra(rg)); });
        sel.eventos.forEach(function (e) { det.appendChild(linhaEvento(e)); });
        if (!sel.regras.length && !sel.eventos.length) det.appendChild(el('p', 'inv-dica', tr('Nenhuma regra nem evento neste dia.')));
        body.appendChild(det);
      }

      // ---- todas as regras, para ver as de vários dias de uma vez (e cancelar sem procurar o dia)
      body.appendChild(el('h3', 'hs-sec', tr('Toda semana')));
      var cr = el('div', 'ms-caixa ag-lista');
      if (!regrasTodas.length) cr.appendChild(el('p', 'inv-dica', tr('Nenhuma regra no calendário.')));
      regrasTodas.forEach(function (rg) { cr.appendChild(linhaRegra(rg)); });
      body.appendChild(cr);
    }

    // ao abrir, busca de novo se a última tentativa tiver mais de 60 s
    // (em casa, só com sessão ou API apontada — Agenda.refresca decide)
    if (Ag.refresca) {
      Ag.refresca(60000).then(function (r) {
        if (r && !r.pulou && (r.mudou || !!r.ok !== servidor)) refaz();
      });
    }
  }
  UI.gmAgendaEm = gmAgendaEm;

  /* O GRIMÓRIO DO MESTRE (31/08): qualquer feitiço do jogo entra na barra do Mestre do Fundo; o
   * Julgamento vai sempre. 03/10: a aba Grimório do painel único (UI.gmGrimorioEm); o PA/PP e o
   * "Aparelhar o Mestre" moram nas Ferramentas do painel. */
  function gmGrimorioEm(body, ctx0) {
    var GMod = JOGO.GM;
    var ctx = gmCtx(ctx0);
    if (!GMod || !GMod.ativo || !GMod.ativo()) {
      body.appendChild(el('p', 'inv-dica', tr('O grimório é do Mestre: entre com a conta dele (ou com a chave, em casa).')));
      return;
    }
    body.appendChild(el('p', 'inv-dica',
      tr('O cofre não tem fundo: todo preço se paga sozinho enquanto o modo Mestre estiver ligado. A conta do Mestre entra direto com o <b>Mestre do Fundo</b>.')));

    // ---- o GRIMÓRIO
    body.appendChild(el('h3', 'hs-sec', tr('Grimório — qualquer feitiço do jogo')));
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
      tr('<b>{escolhidos}</b> escolhido(s) + o Julgamento do Mestre (sempre na barra). {length} feitiços no acervo — busque e toque para ligar/desligar.', { escolhidos: escolhidos, length: todos.length })));
    var busca = document.createElement('input');
    busca.className = 'hub-input';
    busca.placeholder = tr('buscar feitiço por nome...');
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
          listaEl.appendChild(el('p', 'inv-dica', tr('… e mais — afine a busca.')));
          break;
        }
        (function (sp2) {
          var tem = GMod.temSpell(sp2.id);
          var row = el('div', 'ms-linha' + (tem ? ' is-feita' : ''));
          var tx = el('div', 'ms-tx');
          tx.appendChild(el('div', 'ms-nome', tr('{a} <i>· {b} · {c} PA</i>', { a: esc(sp2.name), b: ELEM_PT[sp2.element] || sp2.element || '?', c: sp2.paCost || 0 })));
          if (sp2.description) {
            tx.appendChild(el('div', 'ms-prog', esc(String(sp2.description).slice(0, 90))));
          }
          row.appendChild(tx);
          row.appendChild(btn(tem ? tr('Tirar') : tr('Pôr na barra'),
            'btn-mini ' + (tem ? 'btn-ghost' : 'btn-gold'), function () {
              GMod.alternaSpell(sp2.id);
              ctx.refaz();
            }));
          listaEl.appendChild(row);
        })(sp);
      }
      if (!vistas) listaEl.appendChild(el('p', 'empty', tr('Nada com esse nome no acervo.')));
    }
    busca.addEventListener('input', function () { gmBusca = busca.value; pinta(); });
    busca.addEventListener('keydown', function (ev) { ev.stopPropagation(); });   // o "m" digitado aqui não fecha o painel
    pinta();
  }
  UI.gmGrimorioEm = gmGrimorioEm;


  function sheetBattleMenu() {
    var body = sheetShell(tr('Pausa'));
    var acts = el('div', 'menu-acts');
    // com o menu dividido, a pausa aponta para as duas fichas que importam
    // no meio da luta: o saco e a árvore de feitiços
    acts.appendChild(btn(tr('Inventário'), 'btn-ghost', function () { openSheet('inventory'); }));
    acts.appendChild(btn(tr('Feitiços'), 'btn-ghost', function () { openSheet('spells'); }));
    var mr = modoRede();
    if (mr === 'grupo') {
      // 11/09: em grupo, sair da batalha é sair do grupo e da descida (D16)
      acts.appendChild(btn(tr('Sair do grupo e da descida'), 'btn-warn', function () {
        confirmSheet(tr('Sair do grupo e da descida?'),
          // 12/09 (dono): "sair da batalha/desistir, ele deve morrer" — o
          // aviso tem de dizer isso antes, e não depois
          tr('Seus heróis <b>morrem</b> nesta sala e você não recebe nada dela. Cair da internet é diferente: ali eles ficam de pé e o turno passa até você voltar.'), function () {
            safe(function () { Cp().sairDaBatalha(); return true; }, null);
            safe(function () { Gp().sair('saiu'); return true; }, null);
            // 12/09 (dono): abandonar leva à PRAÇA, não ao menu
            safe(function () { return G().abandonar(); }, false);
          });
      }));
    } else if (mr === 'guerra') {
      // 15/09: sair da guerra de guilda é o mesmo de sair do grupo na batalha — os heróis caem
      acts.appendChild(btn(tr('Sair da guerra'), 'btn-warn', function () {
        confirmSheet(tr('Sair da guerra de guilda?'),
          tr('Os seus dois heróis <b>caem</b> nesta batalha e o seu parceiro segue sozinho pela guilda. Cair da internet é diferente: ali eles ficam de pé e o turno passa até você voltar.'), function () {
            safe(function () { Cp().sairDaGuerra('saiu'); return true; }, null);
            navTo('hub');
          });
      }));
    } else if (mr === 'duelo') {
      acts.appendChild(btn(tr('Desistir do duelo'), 'btn-warn', function () {
        // 15/09 (as falhas conhecidas): desistir não foge da consequência — o aviso diz antes
        confirmSheet(tr('Desistir do duelo?'), tr('Conta como <b>derrota</b>: os seus heróis saem da luta com a vida a 0 e, na Arena e no Campo de PvP, a coroa conta a derrota.'), function () {
          safe(function () { Cp().desistir(); return true; }, null);
        });
      }));
    } else {
      acts.appendChild(btn(tr('Abandonar a descida'), 'btn-warn', function () {
        confirmSheet(tr('Abandonar?'),
          tr('O que você já ganhou fica. A sala em curso se perde e você volta ao Acampamento.'),
          function () {
            // 12/09 (dono): abandonar leva à PRAÇA, não ao menu
            safe(function () { G().restart('hub'); }, null);
            navTo('hub');
          });
      }));
    }
    acts.appendChild(btn(tr('Configurações'), 'btn-ghost', function () { openSheet('config'); }));
    acts.appendChild(btn(tr('Voltar à luta'), 'btn-primary', closeSheet));
    body.appendChild(acts);
  }

  // ==========================================================================
  // O GRUPO, O DUELO E A MENSAGEM PARTICULAR (11/09, pedido do dono de 10/09)
  // ==========================================================================
  /* A HUD só DESENHA: quem decide é o js/core/grupo.js (JOGO.Grupo, JOGO.Duelo,
   * JOGO.Sussurros) e a batalha em dupla é do JOGO.Coop. Os callbacks deles são
   * pendurados UMA vez, no UI.init (ligaSocial); o painel da praça
   * (hubPainelEl) e o chat (chatUI) são os da tela aberta, renovados a cada
   * buildHub. Tudo defensivo: sem os módulos, nada disto aparece.
   * A forma de "líder" na tela é sempre a neutra, "quem lidera" (4.11). */
  function Gp() { return JOGO.Grupo || null; }
  function Dl() { return JOGO.Duelo || null; }
  function Su() { return JOGO.Sussurros || null; }
  function Cp() { return JOGO.Coop || null; }
  function emGrupo() { return !!safe(function () { return Gp().emGrupo(); }, false); }
  /* 06/10: a descida em curso é DE GRUPO? Quem ficou depois que o parceiro voltou ao acampamento segue em grupo
   * (o grupo continua), mas a descida dele é solo: a porta, a saída e a recompensa são as de quem desce sozinho */
  function descidaDeGrupo() { return emGrupo() && modoRede() === 'grupo'; }
  function souLider() { return !!safe(function () { return Gp().souLider(); }, false); }
  function grupoEstado() { return safe(function () { return Gp().estado(); }, null); }
  function parceiroG() { return safe(function () { return Gp().parceiro(); }, null); }
  function nomeParceiro() {
    var p = parceiroG();
    if (p && p.nome) return p.nome;
    var ses = coopSessao();
    return (ses && ses.parceiro && ses.parceiro.nome) || 'o parceiro';
  }
  function coopSessao() { return safe(function () { return Cp().sessao(); }, null); }
  function meuIdRede() { return safe(function () { return JOGO.Rede.meuId(); }, null); }
  function textoMotivo(m, nome) {
    return safe(function () { return Gp().textoMotivo(m, nome); }, null) || tr('Não deu agora.');
  }
  /* o modo da batalha: 'grupo' | 'duelo' | null (o Game decide; sem ele, o grupo) */
  function modoRede() {
    var g = G();
    if (g && typeof g.modoRede === 'function') return safe(function () { return g.modoRede(); }, null);
    return (emGrupo() && safe(function () { return Gp().estado().descidaGrupo; }, null)) ? 'grupo' : null;
  }
  /* de que lado a unidade está NA MINHA TELA: 'meu' | 'aliado' | 'inimigo' */
  function ladoTela(u) {
    var g = G();
    if (g && typeof g.ladoDaTela === 'function') {
      var l = safe(function () { return g.ladoDaTela(u); }, null);
      if (l) return l;
    }
    return (u && u.side === 'player') ? 'meu' : 'inimigo';
  }
  function donoDe(u) { return u ? safe(function () { return G().donoDe(u); }, null) : null; }
  /* o nome de quem manda numa unidade (u.dono): eu, o parceiro do grupo ou o
   * oponente do duelo */
  function nomeDoDono(id) {
    if (!id) return nomeParceiro();
    var p = parceiroG();
    if (p && p.id === id) return p.nome;
    var ses = coopSessao();
    if (ses && ses.parceiro && ses.parceiro.id === id && ses.parceiro.nome) return ses.parceiro.nome;
    var gq = ses && ses.guerra;                    // 15/09: os quatro da guerra de guilda
    for (var i = 0; gq && i < gq.jogadores.length; i++) if (gq.jogadores[i].id === id) return gq.jogadores[i].nome;
    return safe(function () { return JOGO.Rede.nomeDe(id); }, null) || nomeParceiro();
  }
  function classeDoPar(id) {
    var c = null;
    safe(function () { JOGO.Rede.pares().forEach(function (p) { if (p.id === id) c = p.classe; }); return true; }, null);
    return c || 'sumo';
  }
  function meuHeroiG() {
    var hid = safe(function () { return Gp().meuHeroi(); }, null) || selHeroes[0] || null;
    return hid ? (hero(hid) || { classId: hid, level: 1 }) : null;
  }
  /* OS MEUS, para o texto do convite (12/09): a descida em grupo leva os dois
   * selecionados de cada lado. */
  function meusHeroisG() {
    var ids = safe(function () { return Gp().meusHerois(); }, null);
    if (!ids || !ids.length) ids = selHeroes.slice();
    var out = [];
    ids.forEach(function (hid) {
      if (hid) out.push(hero(hid) || { classId: hid, level: 1 });
    });
    return out;
  }
  function relogioTxt(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  // ---------------------------------------------------- o painel da praça
  var hubPainelEl = null;          // o .hub-painel da tela aberta (buildHub)
  var painelModo = null;           // 'lugar' | 'jogador' | 'convite' | 'nome' | null
  var painelLugar = null;          // o último lugar aproximado (para repintar)
  var painelPar = null;            // o jogador do painel aberto
  var painelConv = null;           // { tipo:'grupo', gid } | { tipo:'duelo', did }
  var painelJogadorFn = null;      // o desenhista do painel do jogador (vive no buildHub)
  var chamandoPorta = 0;           // quando quem lidera tocou "Entrar na batalha com…"
  /* 11/09 (revisão): "vivo" é o que está na tela ABERTA, não só no DOM. O buildHub
   * limpa só a própria tela e o showScreen só troca a classe: o painel e o chat da
   * praça (ou da antessala) seguem no DOM, escondidos, na batalha, na recompensa e
   * na derrota — a mensagem particular virava linha num chat que ninguém via, e o
   * "Mensagem particular" do cartão do grupo não abria ficha nenhuma. */
  function naTelaAberta(n) { var s = screens[current]; return !!(n && n.isConnected && s && s.contains(n)); }
  function painelVivo() { return naTelaAberta(hubPainelEl) ? hubPainelEl : null; }
  /* O botão VOLTAR do aplicativo (js/mobile.js, M.voltar): fecha o que está aberto por cima — a ficha,
   * depois o painel da praça — e diz se fechou. Falso = não havia nada, e aí o aplicativo pergunta se
   * é para sair. Na web ninguém chama. */
  UI.voltar = function () {
    // a tela da compra pela Google Play (só no aplicativo) fica por cima de tudo: fecha primeiro
    if (JOGO.CompraPlay && JOGO.CompraPlay.aberto && JOGO.CompraPlay.aberto()) { JOGO.CompraPlay.fecha(); return true; }
    // 24/10: a aba do site (js/ui/site_aba.js) cobre o jogo inteiro: o voltar anda nela e, na primeira página, a fecha
    if (JOGO.SiteAba && JOGO.SiteAba.aberta && JOGO.SiteAba.aberta()) return JOGO.SiteAba.voltar();
    if (JOGO.PremioAnuncio && JOGO.PremioAnuncio.aberto && JOGO.PremioAnuncio.aberto()) { JOGO.PremioAnuncio.fecha(); return true; }
    if (sheetName) { closeSheet(); return true; }
    if (fechaSino()) return true;       // o painel do sino dos avisos (só existe no toque)
    var p = painelVivo();
    if (p && !p.classList.contains('is-off')) { fechaPainel(); return true; }
    return false;
  };
  function abrePainel(modo) {
    var p = painelVivo();
    if (!p) return null;
    clear(p);
    p.classList.remove('is-off');
    painelModo = modo;
    return p;
  }
  function fechaPainel() {
    var p = painelVivo();
    if (p) p.classList.add('is-off');
    painelModo = null;
    painelConv = null;
  }
  /* o painel aberto se redesenha quando o grupo muda (o botão do portal, a
   * porta da antessala, os botões do painel do jogador) */
  function repintaLugar() {
    var p = painelVivo();
    if (!p || p.classList.contains('is-off')) return;
    if (painelModo === 'lugar' && painelLugar && JOGO.Hub && JOGO.Hub.aoAproximar) {
      safe(function () { JOGO.Hub.aoAproximar(painelLugar); return true; }, null);
    } else if (painelModo === 'jogador' && painelPar && painelJogadorFn) {
      safe(function () { painelJogadorFn(painelPar); return true; }, null);
    }
  }
  function cabecalhoPainel(p, classe, element, titulo, sub) {
    var cab = el('div', 'pn-cab');
    cab.appendChild(art('portrait', [classe || 'sumo', { element: element || 'neutro', size: 48 }], 40));
    var tx = el('div', 'pn-cab-tx');
    tx.appendChild(el('h3', null, titulo));
    if (sub) tx.appendChild(el('span', 'pn-cab-sub', sub));
    cab.appendChild(tx);
    p.appendChild(cab);
  }
  function barraPrazo(expira, agoraFn) {
    var b = el('div', 'conv-prazo');
    var i = el('i');
    var agora = safe(function () { return agoraFn(); }, Date.now());
    i.style.animationDuration = Math.max(0, expira - agora) + 'ms';
    b.appendChild(i);
    return b;
  }

  /* O CARTÃO DOS PEDIDOS (06/10). O dono, com dois celulares no aplicativo e contas diferentes: "se eu dou troca ou
   * qualquer comando com outro jogador, buga e não consigo de novo. Eu mandei grupo pro jogador e sumiu a solicitação
   * e não consegui mandar de novo até expirar... troca acontece o mesmo."
   *
   * A CAUSA: o convite de grupo, o desafio, o pedido de troca e o convite de guilda eram desenhados UMA vez, quando
   * chegavam, dentro do .hub-painel — e a praça é remontada do zero (buildHub: painel novo, vazio, painelConv = null) a
   * cada UI.repaint: a adoção do estado do servidor (autoridade.js), a chegada dos modelos 3D (portraits3d.js), o
   * painel do Mestre, a troca do herói que anda. O pedido seguia de pé no grupo.js/troca.js ('convidado') sem tela
   * para responder; quem enviou só tinha um aviso de 2,4 s e nenhum cancelar, e ficava em 'convidei' — "ocupado" a
   * cada nova tentativa — até o prazo. Na troca nem prazo havia: os dois lados ficavam presos até recarregar.
   *
   * O CONSERTO: o ESTADO é a fonte. pedidoAtual() lê o Grupo, o Duelo e a Troca (e o convite de guilda, guardado
   * aqui) e pintaPedido() redesenha o cartão a partir dele — no que muda, a cada tique e na volta do segundo plano.
   * O cartão mora numa camada própria, fora das telas e por cima das fichas: remontar a praça, abrir ou fechar uma
   * ficha e tocar em outra coisa não o tiram da frente. Quem RECEBEU tem o Aceitar e o Agora não (44 px); quem
   * ENVIOU vê o pedido pendente com o tempo que falta e o Cancelar — e pedir de novo troca o pedido anterior. */
  var pedidoEl = null;             // a camada do cartão (UI.init)
  var pedidoSig = null;            // o que está desenhado (para não redesenhar a cada tique)
  var pedidoRel = null;            // { no, expira, agora }: o relógio do cartão
  var conviteGuilda = null;        // { de, nome, guilda, chave, expira, aceita(), recusa() } — a guilda não tem estado no núcleo
  var trocaFaseAntes = null;       // a fase da troca no último aviso (a mesa abre sozinha quando o outro aceita)
  function agoraDe(fn) { var t = safe(fn, null); return (typeof t === 'number' && isFinite(t)) ? t : Date.now(); }
  function agoraG() { return agoraDe(function () { return Gp()._agora(); }); }
  function agoraD() { return agoraDe(function () { return Dl()._agora(); }); }
  function agoraT() { return agoraDe(function () { return JOGO.Troca._agora(); }); }
  /* o pedido que a tela tem de mostrar AGORA, lido do estado: primeiro o que espera a MINHA resposta */
  function pedidoAtual() {
    var g = grupoEstado(), p = g && g.pendente;
    var d = safe(function () { return Dl().estado(); }, null);
    var t = safe(function () { return JOGO.Troca.estado(); }, null);
    if (conviteGuilda && Date.now() > conviteGuilda.expira) conviteGuilda = null;
    if (p && !p.meu) return { tipo: 'grupo', meu: false, chave: p.gid, id: p.id, nome: p.nome, heroi: p.heroi, expira: p.expira, agora: agoraG };
    if (d && d.fase === 'desafiado' && d.modo === 'desafio' && d.oponente) {
      return { tipo: 'duelo', meu: false, chave: d.did, id: d.oponente.id, nome: d.oponente.nome, expira: d.prazo, agora: agoraD };
    }
    if (t && t.fase === 'convidado') return { tipo: 'troca', meu: false, chave: t.par, id: t.par, nome: t.nomePar, expira: t.expira, agora: agoraT };
    if (conviteGuilda) {
      return { tipo: 'guilda', meu: false, chave: conviteGuilda.chave, id: conviteGuilda.de, nome: conviteGuilda.nome,
               expira: conviteGuilda.expira, agora: Date.now };
    }
    if (p && p.meu) return { tipo: 'grupo', meu: true, chave: p.gid, id: p.id, nome: p.nome, expira: p.expira, agora: agoraG };
    if (d && d.fase === 'desafiei' && d.modo === 'desafio' && d.oponente) {
      return { tipo: 'duelo', meu: true, chave: d.did, id: d.oponente.id, nome: d.oponente.nome, expira: d.prazo, agora: agoraD };
    }
    if (t && t.fase === 'convidei') return { tipo: 'troca', meu: true, chave: t.par, id: t.par, nome: t.nomePar, expira: t.expira, agora: agoraT };
    // 06/10: o parceiro voltou ao acampamento e eu fiquei: a escolha fica na tela até eu decidir
    if (g && g.ficouSo && !sheetName && (current === 'antessala' || current === 'roomClear' || current === 'elementChoice')) {
      return { tipo: 'so', meu: true, chave: (g.ficouSo.nome || '') + (g.ficouSo.saiu ? ':saiu' : ''), id: (parceiroG() || {}).id || null, nome: g.ficouSo.nome,
               saiu: g.ficouSo.saiu, expira: 0, agora: Date.now };
    }
    // a mesa de troca aberta com a ficha FECHADA (o ✕, o voltar do aparelho): o caminho de volta fica na tela
    if (t && t.fase === 'aberta' && !sheetName) return { tipo: 'mesa', meu: true, chave: t.par, id: t.par, nome: t.nomePar, expira: 0, agora: Date.now };
    return null;
  }
  /* um pedido MEU que ainda espera resposta não segura o próximo: pedir outra coisa retira o que estava no ar */
  function retiraMeusPedidos() {
    var g = grupoEstado();
    if (g && g.pendente && g.pendente.meu) safe(function () { return Gp().cancelar(); }, null);
    var d = safe(function () { return Dl().estado(); }, null);
    if (d && d.fase === 'desafiei' && d.modo === 'desafio') safe(function () { return Dl().cancelar('retirou'); }, null);
    var t = safe(function () { return JOGO.Troca.estado(); }, null);
    if (t && t.fase === 'convidei') safe(function () { JOGO.Troca.cancelar(); return true; }, null);
  }
  function pintaPedido() {
    if (!pedidoEl) return;
    var q = pedidoAtual();
    var sig = q ? [q.tipo, q.meu ? 1 : 0, q.chave, q.expira || 0].join('|') : '';
    if (sig !== pedidoSig) { pedidoSig = sig; desenhaPedido(q); }
    if (pedidoRel && pedidoRel.no.isConnected) pedidoRel.no.textContent = relogioTxt(pedidoRel.expira - pedidoRel.agora());
  }
  function desenhaPedido(q) {
    clear(pedidoEl);
    pedidoRel = null;
    if (!q) { pedidoEl.className = 'ui-pedido'; return; }
    pedidoEl.className = 'ui-pedido is-on' + (q.meu ? ' is-meu' : '') + ' pd-' + q.tipo;
    var nome = esc(q.nome || tr('Aventureiro'));
    var h = q.heroi || {};
    var titulo, sub = '', nota = '';
    if (q.tipo === 'mesa') {
      titulo = tr('Mesa de troca com <b>{a}</b>', { a: nome });
      sub = tr('A mesa segue aberta.');
    } else if (q.tipo === 'so') {
      titulo = q.saiu ? tr('<b>{a}</b> saiu do grupo.', { a: nome }) : tr('<b>{a}</b> voltou ao acampamento.', { a: nome });
      sub = tr('A descida segue só com os seus heróis.');
    } else if (q.meu) {
      titulo = q.tipo === 'grupo' ? tr('Convite de grupo para <b>{a}</b>', { a: nome })
             : q.tipo === 'duelo' ? tr('Desafio amistoso para <b>{a}</b>', { a: nome })
             : tr('Pedido de troca para <b>{a}</b>', { a: nome });
      sub = tr('Esperando a resposta…');
    } else if (q.tipo === 'grupo') {
      titulo = tr('<b>{a}</b> te chama para o grupo.', { a: nome });
      sub = h.classId ? esc(className(h.classId)) + ' · nv ' + (h.level || 1) : '';
      var meus = meusHeroisG();
      var lista = meus.map(function (x) { return esc(className(x.classId || '')) + tr(' nv ') + (x.level || 1); }).join(tr(' e '));
      nota = meus.length > 1
        ? tr('{a} lidera: escolhe o calabouço e abre as portas. Você leva os seus dois: <b>{lista}</b>.', { a: nome, lista: lista })
        : tr('{a} lidera: escolhe o calabouço e abre as portas. Você leva o seu herói: <b>{lista}</b>.', { a: nome, lista: lista });
    } else if (q.tipo === 'duelo') {
      titulo = tr('<b>{a}</b> te chama para um desafio amistoso.', { a: nome });
      // 14/09: o desafio é na praça e não mexe na coroa
      nota = tr('<b>Desafio amistoso — a coroa não muda.</b> Mapa: A Praça. Cada um leva 1 ou 2 heróis, escolhidos às cegas.');
    } else if (q.tipo === 'troca') {
      titulo = tr('{a} quer trocar com você.', { a: nome });
    } else {
      titulo = tr('{a} te chama para a <b>{b}</b>.', { a: nome, b: esc(conviteGuilda ? conviteGuilda.guilda : '?') });
    }
    var cab = el('div', 'pd-cab');
    cab.appendChild(art('portrait', [h.classId || classeDoPar(q.id) || 'sumo', { element: h.element || 'neutro', size: 48 }], 40));
    var tx = el('div', 'pd-tx');
    tx.appendChild(el('span', 'pd-tit', titulo));
    if (sub) tx.appendChild(el('span', 'pd-sub', sub));
    cab.appendChild(tx);
    if (q.expira) {
      var rel = el('span', 'pd-rel', relogioTxt(q.expira - q.agora()));
      rel.title = tr('o tempo que falta para o pedido expirar');
      cab.appendChild(rel);
      pedidoRel = { no: rel, expira: q.expira, agora: q.agora };
    }
    pedidoEl.appendChild(cab);
    if (nota) pedidoEl.appendChild(el('p', 'pd-nota', nota));
    if (q.expira) pedidoEl.appendChild(barraPrazo(q.expira, q.agora));
    var acts = el('div', 'pd-acts');
    if (q.tipo === 'mesa') {
      acts.appendChild(btn(tr('Abrir a mesa'), 'btn-primary', function () { openSheet('troca'); pintaPedido(); }));
      acts.appendChild(btn(tr('Cancelar a troca'), 'btn-ghost', function () { safe(function () { JOGO.Troca.cancelar(); return true; }, null); }));
    } else if (q.tipo === 'so') {
      // 06/10: quem ficou decide por si — seguir sozinho (a porta e a próxima sala já são as de quem desce só) ou voltar também
      acts.appendChild(btn(tr('Continuar sozinho'), 'btn-primary', function () {
        safe(function () { return Gp().cienteSozinho(); }, null);
        pintaPedido();
      }));
      acts.appendChild(btn(tr('Voltar ao acampamento'), 'btn-ghost', function () {
        confirmSheet(tr('Sair do calabouço?'),
          tr('O que você já limpou não fica guardado — a próxima descida começa da primeira sala.'),
          function () {
            safe(function () { return Gp().cienteSozinho(); }, null);
            if (!safe(function () { return G().abandonar(); }, false)) safe(function () { G().restart('hub'); return true; }, null);
            navTo('hub');
          });
      }));
    } else if (q.meu) {
      acts.appendChild(btn(tr('Cancelar'), 'btn-ghost', function () {
        if (q.tipo === 'grupo') safe(function () { return Gp().cancelar(); }, null);
        else if (q.tipo === 'duelo') safe(function () { return Dl().cancelar('retirou'); }, null);
        else { safe(function () { JOGO.Troca.cancelar(); return true; }, null); if (sheetName === 'troca') closeSheet(); }
        pintaPedido();
        toast(tr('Pedido cancelado.'));
      }));
    } else {
      acts.appendChild(btn(tr('Aceitar'), 'btn-primary', function () { respondePedido(q, true); }));
      acts.appendChild(btn(tr('Agora não'), 'btn-ghost', function () { respondePedido(q, false); }));
    }
    pedidoEl.appendChild(acts);
  }
  function respondePedido(q, sim) {
    var r;
    if (q.tipo === 'grupo') {
      r = safe(function () { return Gp().responder(sim); }, null);
      if (sim) {
        if (r && r.ok) toast(tr('Você entrou no grupo de {nome}.', { nome: q.nome }), 'good');
        else toast(textoMotivo(r ? r.motivo : 'expirou', null));
      }
    } else if (q.tipo === 'duelo') {
      r = safe(function () { return Dl().responder(sim); }, null);
      if (sim && (!r || !r.ok)) toast(textoMotivo(r ? r.motivo : 'expirou', null));
    } else if (q.tipo === 'troca') {
      safe(function () { JOGO.Troca.responder(sim); return true; }, null);
      if (sim && safe(function () { return JOGO.Troca.estado().fase; }, null) === 'aberta') openSheet('troca');
    } else if (q.tipo === 'guilda' && conviteGuilda) {
      var cg = conviteGuilda;
      conviteGuilda = null;
      safe(function () { if (sim) cg.aceita(); else cg.recusa(); return true; }, null);
    }
    pintaPedido();
  }
  /* a volta do segundo plano (o celular que apagou a tela, o aplicativo que ficou para trás): os relógios do
   * núcleo andam já — o que venceu solta e avisa o outro lado — e o cartão se redesenha do estado */
  function voltaDoFundo() {
    if (typeof document !== 'undefined' && document.hidden) return;
    safe(function () { Gp()._tique(); return true; }, null);
    safe(function () { JOGO.Troca._tique(); return true; }, null);
    pedidoSig = null;
    pintaPedido();
  }
  /* os ganchos da troca, pendurados UMA vez (ligaSocial): antes viviam no buildHub e desenhavam no painel dele */
  function aoTrocaConvite(c) {
    // 13/09 (dono): inimigo não propõe troca — recusa calada (o relé novo nem entrega)
    if (safe(function () { return JOGO.Amigos && JOGO.Amigos.inimigoPorHeroi(c.de); }, false)) {
      safe(function () { JOGO.Troca.responder(false); return true; }, null);
      return;
    }
    // 11/09 (revisão): um pedido de cada vez. Com um convite de grupo ou de duelo esperando a minha resposta (ou
    // o da Arena e o da guerra no painel), a troca é recusada — o grupo e o duelo já recusam quem está numa troca
    var g = grupoEstado(), d = safe(function () { return Dl().estado(); }, null);
    var outro = !!(g && g.pendente && !g.pendente.meu) || !!(d && d.fase === 'desafiado') || !!conviteGuilda ||
                (painelModo === 'convite' && !!painelVivo() && !painelVivo().classList.contains('is-off'));
    if (outro) {
      safe(function () { JOGO.Troca.responder(false); return true; }, null);
      toast(tr('{nome} quis trocar com você — recusado: responda antes o convite aberto.', { nome: c.nome }));
      return;
    }
    pintaPedido();
  }
  function aoTrocaMudou(est) {
    var antes = trocaFaseAntes;
    trocaFaseAntes = est ? est.fase : null;
    pintaPedido();
    if (sheetName === 'troca') sheetTroca();
    if (est && est.fase === 'cancelada' && est.motivo) {   // 10/09: a troca que o cartório não espelharia
      if (sheetName === 'troca') closeSheet();              // 06/10: só a ficha da troca (o pedido recusado não fecha o saco aberto)
      toast(est.motivo);
      return;
    }
    if (est && est.fase === 'feita') {
      closeSheet();
      toast(est.resultado === 'mesma-conta'
        ? tr('Troca encerrada — mesma conta nas duas abas: nada se move. Entre contas, tudo se move.')
        : tr('Troca feita! O que veio já está no saco.'), 'good');
      return;
    }
    // 06/10: o outro lado aceitou o MEU pedido: a mesa abre sozinha (com outra ficha aberta, fica o cartão)
    if (est && est.fase === 'aberta' && antes === 'convidei' && !sheetName && (current === 'hub' || current === 'antessala')) openSheet('troca');
  }

  /* O PORTAL em grupo (4.5): quem lidera desce com o outro; quem segue espera */
  function painelPortalGrupo(p, lugar) {
    var nome = nomeParceiro();
    var est = grupoEstado() || {};
    if (souLider()) {
      var sd = seletorDif();
      if (sd) p.appendChild(sd);
      var meusP = meusHeroisG();
      p.appendChild(el('p', 'hub-nota', (meusP.length > 1
        ? tr('Em grupo, cada um leva os seus dois: <b>{a}</b>.', { a: meusP.map(function (x) { return esc(className(x.classId || '')) + tr(' nv ') + (x.level || 1); }).join(tr(' e ')) })
        : tr('Em grupo, cada um leva o seu herói: <b>{a}</b>.', { a: meusP.map(function (x) { return esc(className(x.classId || '')) + tr(' nv ') + (x.level || 1); }).join(tr(' e ')) }))));
      if (est.descendo && est.descendo.dungeonId === lugar.id) {
        p.appendChild(btn(tr('Chamando {a}', { a: esc(nome) }) + '…', 'btn-primary btn-block is-apagado', function () {}));
        return;
      }
      p.appendChild(btn(tr('Descer com {a}', { a: esc(nome) }), 'btn-primary btn-block', function () {
        var r = safe(function () { return Gp().descer(lugar.id); }, null);
        if (!r || !r.ok) toast(textoMotivo(r ? r.motivo : 'ocupado', r && r.motivo === 'sumido' ? nome : null));
        else repintaLugar();
      }));
      return;
    }
    p.appendChild(el('p', 'hub-nota', tr('Só quem lidera (<b>{a}</b>) escolhe o calabouço.', { a: esc(nome) })));
    var lnDif = linhaDifGrupo();                    // 11/09 (revisão): e a dificuldade, antes de descer
    if (lnDif) p.appendChild(lnDif);
    p.appendChild(btn(tr('Descer'), 'btn-primary btn-block is-apagado', function () {
      toast(tr('Só quem lidera ({nome}) escolhe o calabouço.', { nome: nome }));
    }));
    p.appendChild(btn(tr('Sair do grupo para descer sozinho'), 'btn-ghost btn-block', function () {
      confirmSheet(tr('Sair do grupo?'), tr('Você deixa o grupo de {a} e volta a descer sozinho.', { a: esc(nome) }), function () {
        safe(function () { Gp().sair('saiu'); return true; }, null);
        repintaLugar();
      });
    }));
  }
  /* ================================================ A VIDA NA TELA (13/09 e 14/09)
   * 13/09, o dono: "a poção não é para usar na batalha.. e sim para curar a vida após uma batalha
   * na sala de espera entre as salas.. carrega 1 pv a cada 2 segundos" — nasceu o quadro da
   * vida na antessala.
   * 14/09, o dono: "hoje nas salas de espera a vida vai recuperando aos poucos até encher ou o
   * jogador usa pote; isso vale para quando terminar calabouço (na praça), depois de um pvp e
   * assim por diante". A vida virou UMA por herói (js/core/vida.js) e o quadro mora onde se
   * está fora da luta — nunca na batalha:
   *   'antessala' — fixo no canto, com as poções (os heróis da descida e os do parceiro);
   *   'porta'     — no painel da porta, compacto (as poções ficam no quadro do canto);
   *   (a PRAÇA tem o cartão dela desde 14/09 à noite — vidaPraca, logo abaixo —, sempre à vista);
   *   'fim'      — nas telas de fim (sala limpa, calabouço vencido, derrota, fim do duelo);
   *   'duelo'     — na ficha da escolha do duelo em rede, com os heróis que podem duelar.
   * Todo quadro só aparece enquanto algum herói dele não está cheio (some quando todos enchem).
   * Cada linha tem a barra de PV subindo AO VIVO ("+1 PV a cada 2 s · cheio em m:ss") e, nos
   * MEUS heróis, um botão por poção que a conta tem — tocar cura aquele herói na hora
   * (Game.bebeNaEspera), quantas quiser, sem passar do máximo. UM relógio só (vidaTique)
   * repinta os quadros no lugar: a 250 ms com algum à vista, a 1 s com todos escondidos
   * (esperando a escolha mudar ou o servidor responder), parado sem quadro na tela; e a
   * JOGO.Vida avisa quando muda (poção, fim de luta, resposta do servidor). */
  var vidaQuadros = [], vidaTimer = null, vidaPortaChave = '';
  var VIDA_TELAS = { hub: 1, antessala: 1, roomClear: 1, dungeonComplete: 1, defeat: 1, duelFim: 1 };
  var BEBER_MOTIVO_PT = {
    cheio: tr('A vida desse herói já está cheia.'), acabou: tr('Essa poção acabou.'), 'sem-pocao': tr('Essa poção acabou.'),
    pocao: tr('Poção desconhecida.'), heroi: tr('Cada um cura os próprios heróis.'),
    batalha: tr('Na batalha não se bebe: a poção é para fora da luta (na praça ou na sala de espera).'),
    fase: tr('Na batalha não se bebe: a poção é para fora da luta (na praça ou na sala de espera).'),
    servidor: tr('O servidor não respondeu — tente num instante.'), bebendo: tr('Bebendo…'),
    'outro-aparelho': tr('Sua conta entrou em outro aparelho.')
  };
  function textoEsperaVida(ev) { return tr('Esperando {nome} recuperar… {esperaS} s', { nome: ev.nome, esperaS: ev.esperaS }); }
  function segPorPv() {
    var ms = safe(function () { return D().vidaEntreSalas.msPorPv; }, 2000);
    return (typeof ms === 'number' && ms > 0) ? ms / 1000 : 2;
  }
  function mmss(s) {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  // os heróis de cada quadro; null = os da descida (e os do parceiro), que o Game conhece
  function heroisDaVida(modo) {
    if (modo === 'duelo') return safe(function () { return Dl().herois(); }, []) || [];
    if (modo === 'fim') {
      var pt = safe(function () { return G().party; }, null);
      return (pt && pt.length) ? pt.slice() : selHeroes.slice();
    }
    return null;
  }
  function listaVida(modo) {
    var ids = heroisDaVida(modo);
    return safe(function () { return ids ? G().vidaNaEspera(ids) : G().vidaNaEspera(); }, []) || [];
  }
  /* o quadro (escondido enquanto todos estão cheios) */
  function vidaBloco(modo) {
    var fixo = modo === 'antessala';
    var box = el('div', 'vida-bloco is-' + modo + (fixo ? ' is-fixo' : '') + (modo === 'porta' ? ' is-compacto' : ''));
    if (modo !== 'porta') {
      box.appendChild(el('div', 'vida-tit', tr('A vida volta sozinha: <b>+1 PV a cada {a} s</b> — ou beba uma poção', { a: segPorPv() })));
    }
    var linhas = el('div', 'vida-lista');
    box.appendChild(linhas);
    box.hidden = true;
    var q = { box: box, linhas: linhas, sig: '', rows: {}, modo: modo, comPocoes: modo !== 'porta' };
    vidaQuadros.push(q);
    pintaVida(q);
    ligaVidaTique();
    return box;
  }
  function pintaVida(q) {
    var lista = listaVida(q.modo);
    var ferido = lista.some(function (v) { return v.hp < v.max; });
    q.box.hidden = !ferido;
    if (!ferido) return;
    var pocoes = q.comPocoes ? (safe(function () { return G().pocoesNaEspera(); }, []) || []) : [];
    var sig = lista.map(function (v) { return v.chave; }).join('|') + '#' +
              pocoes.map(function (po) { return po.id + 'x' + po.n; }).join(',');
    if (sig !== q.sig) {
      q.sig = sig;
      clear(q.linhas);
      q.rows = {};
      lista.forEach(function (v) {
        var row = el('div', 'vida-heroi' + (v.meu ? '' : ' is-parceiro'));
        row.setAttribute('data-chave', v.chave);
        var cab = el('div', 'vh-cab');
        cab.appendChild(el('span', 'vh-nome', esc(v.nome) +
          (v.meu ? '' : ' <i>(' + esc(safe(function () { return nomeParceiro(); }, 'parceiro')) + ')</i>')));
        var numEl = el('span', 'vh-num', '');
        cab.appendChild(numEl);
        row.appendChild(cab);
        var barra = el('div', 'vh-barra'), enche = el('div', 'vh-enche');
        barra.appendChild(enche);
        row.appendChild(barra);
        var nota = el('div', 'vh-nota', '');
        row.appendChild(nota);
        if (v.meu && pocoes.length) {
          var pp = el('div', 'vh-pocoes');
          pocoes.forEach(function (po) {
            var b = el('button', 'vh-pocao');
            b.type = 'button';
            b.setAttribute('data-pocao', po.id);
            b.appendChild(art('pocaoIcon', [po.id, 22], 22));
            b.appendChild(el('span', 'vh-cura', '+' + po.def.cura));
            b.appendChild(el('span', 'vh-qtd', '×' + po.n));
            b.title = tr('{name}: cura {cura} PV (você tem {n})', { name: po.def.name, cura: po.def.cura, n: po.n });
            tap(b, function () { bebeVida(v.chave, po.id); });
            pp.appendChild(b);
          });
          row.appendChild(pp);
        }
        q.rows[v.chave] = { row: row, num: numEl, enche: enche, nota: nota };
        q.linhas.appendChild(row);
      });
      if (q.comPocoes && !pocoes.length) {
        q.linhas.appendChild(el('p', 'vh-sem', tr('Sem poções: a banca do mercador vende no Mercadinho da praça.')));
      }
    }
    lista.forEach(function (v) {
      var r = q.rows[v.chave];
      if (!r) return;
      r.num.textContent = v.hp + '/' + v.max + tr(' PV');
      r.enche.style.width = (v.max > 0 ? Math.round(100 * v.hp / v.max) : 0) + '%';
      r.row.classList.toggle('is-zero', v.hp < 1);
      r.row.classList.toggle('is-cheio', v.hp >= v.max);
      r.nota.textContent = v.hp >= v.max ? 'vida cheia'
        : (v.hp < 1 ? tr('sem vida — 1 PV em {ate1S} s', { ate1S: v.ate1S })
          : tr('+1 PV a cada {a} s · cheio em {b}', { a: segPorPv(), b: mmss(v.cheioEmS) }));
      [].forEach.call(r.row.querySelectorAll('.vh-pocao'), function (b) {
        var m = safe(function () { return G().podeBeberEspera(v.chave, b.getAttribute('data-pocao')); }, 'batalha');
        b.classList.toggle('is-dim', !!m);
      });
    });
  }
  function bebeVida(chave, pocaoId) {
    var motivo = safe(function () { return G().podeBeberEspera(chave, pocaoId); }, 'batalha');
    if (motivo) { toast(BEBER_MOTIVO_PT[motivo] || tr('Agora não dá para beber.')); return; }
    var pr = safe(function () { return G().bebeNaEspera(chave, pocaoId); }, null);
    if (!pr || typeof pr.then !== 'function') return;
    pr.then(function (res) {
      if (!res || !res.ok) toast((res && (BEBER_MOTIVO_PT[res.motivo] || res.erro)) || tr('Não deu para beber.'));
      else toast(tr('+{cura} PV{a}.', { cura: res.cura, a: res.hp != null ? ' ' + tr('— {hp}/{max} PV', { hp: res.hp, max: res.max }) : '' }), 'good');
      vidaTique();
    });
  }

  /* A VIDA NA PRAÇA (14/09, o dono: "de alguma forma deve aparecer essa vida na praça também, pro
   * jogador saber quando está cheia ou não. Pode ser um coração com o total e % pequeno abaixo,
   * localizado no canto superior esquerdo, com a foto do personagem. No caso, se ele desceu com 2
   * personagens deve aparecer a foto e vida dos dois, e ele pode selecionar para quem quer
   * carregar a vida com pote").
   * No lugar do quadro compacto que só aparecia com alguém ferido: o cartão fica SEMPRE à vista
   * (cheio também, 100%). Um cartão por herói escolhido (selHeroes) — em grupo só os MEUS, a vida
   * do parceiro já mora no painel do grupo e na antessala —: a foto, o coração que enche com o PV
   * e muda de cor (cheio brilha; abaixo de 35% alaranja; a 0 fica cinza e pulsa), "132/170" e o %
   * pequeno embaixo (a 0, os segundos até 1 PV). TOCAR num cartão escolhe PARA QUEM vão as poções
   * (o anel dourado); os botões de baixo curam esse (bebeVida: recusa com o motivo, ex. cheio).
   * O PV cheio é o do Game.vidaNaEspera: o máximo do registro da Vida, ou — cheio, sem registro —
   * o hp do Progress.battleParty, o mesmo número com que a batalha o poria em campo.
   * O DOM só se refaz quando muda a dupla ou as poções; o tique (vidaTique) troca números, alturas
   * e classes. 06/10: o cartão fica na MESMA LINHA do nome do jogador, logo à direita dele, e as poções
   * logo abaixo (buildHub o põe dentro do .hub-quem) — o lugar é do fluxo, nada é medido. */
  var vidaAlvoPraca = null;
  var CORACAO_SVG = '<svg viewBox="0 0 32 29" aria-hidden="true"><path d="M16 28 13.8 26C5.9 18.9 1 14.5 1 9 ' +
    '1 4.5 4.5 1 9 1c2.5 0 5 1.2 7 3.1C18 2.2 20.5 1 23 1c4.5 0 8 3.5 8 8 0 5.5-4.9 9.9-12.8 17z"/></svg>';
  function vidaPraca() {
    var box = el('div', 'vida-praca');
    var cartoes = el('div', 'vp-cartoes'), pocoesEl = el('div', 'vp-pocoes');
    box.appendChild(cartoes);
    box.appendChild(pocoesEl);
    var q = { box: box, cartoes: cartoes, pocoesEl: pocoesEl, para: null, sig: '', rows: {}, modo: 'praca',
              pinta: pintaVidaPraca };
    vidaQuadros.push(q);
    pintaVidaPraca(q);
    ligaVidaTique();
    return box;
  }
  function pctVida(v) {
    if (!(v.max > 0) || v.hp < 1) return 0;
    if (v.hp >= v.max) return 100;
    return Math.max(1, Math.min(99, Math.round(100 * v.hp / v.max)));
  }
  function pintaVidaPraca(q) {
    var lista = (safe(function () { return G().vidaNaEspera(selHeroes.slice()); }, []) || [])
      .filter(function (v) { return v && v.meu; });
    q.box.hidden = !lista.length;          // o jogo sem Game, ou o Mestre sem herói da conta
    if (!lista.length) return;
    if (!lista.some(function (v) { return v.chave === vidaAlvoPraca; })) vidaAlvoPraca = lista[0].chave;
    var pocoes = safe(function () { return G().pocoesNaEspera(); }, []) || [];
    var sig = lista.map(function (v) { return v.chave; }).join('|') + '#' +
              pocoes.map(function (po) { return po.id + 'x' + po.n; }).join(',');
    if (sig !== q.sig) {
      q.sig = sig;
      clear(q.cartoes);
      clear(q.pocoesEl);
      q.rows = {};
      q.para = null;
      lista.forEach(function (v) {
        var h = hero(v.heroId) || {};
        var card = el('button', 'vp-heroi');
        card.type = 'button';
        card.setAttribute('data-chave', v.chave);
        card.setAttribute('data-heroi', v.heroId);
        var foto = el('span', 'vp-foto');
        foto.appendChild(art('portrait', [h.classId || String(v.heroId).split('#')[0],
          { element: h.element || 'neutro', size: 64 }], 40));
        // 07/10 (o dono): a quantidade de estrelas da classe no retratinho da praça
        var estrelasV = safe(function () { return cardInfo(h.classId || String(v.heroId).split('#')[0]).stars; }, 0);
        if (estrelasV) foto.appendChild(el('i', 'vp-estrelas', '★' + estrelasV));
        card.appendChild(foto);
        var cor = el('span', 'vp-cor', '<span class="vp-cor-fundo">' + CORACAO_SVG + '</span>' +
                                        '<span class="vp-cor-enche">' + CORACAO_SVG + '</span>');
        card.appendChild(cor);
        var tx = el('span', 'vp-tx');
        var num = el('b', 'vp-num', ''), pct = el('small', 'vp-pct', '');
        tx.appendChild(num);
        tx.appendChild(pct);
        card.appendChild(tx);
        tap(card, function () { vidaAlvoPraca = v.chave; vidaTique(); });
        q.rows[v.chave] = { card: card, num: num, pct: pct, enche: cor.querySelector('.vp-cor-enche'), nome: v.nome };
        q.cartoes.appendChild(card);
      });
      if (pocoes.length) {
        if (lista.length > 1) { q.para = el('span', 'vp-para', ''); q.pocoesEl.appendChild(q.para); }
        pocoes.forEach(function (po) {
          var b = el('button', 'vh-pocao vp-pocao');
          b.type = 'button';
          b.setAttribute('data-pocao', po.id);
          b.appendChild(art('pocaoIcon', [po.id, 22], 22));
          b.appendChild(el('span', 'vh-cura', '+' + po.def.cura));
          b.appendChild(el('span', 'vh-qtd', '×' + po.n));
          b.title = tr('{name}: cura {cura} PV (você tem {n})', { name: po.def.name, cura: po.def.cura, n: po.n });
          tap(b, function () { if (vidaAlvoPraca) bebeVida(vidaAlvoPraca, po.id); });
          q.pocoesEl.appendChild(b);
        });
      } else {
        q.pocoesEl.appendChild(el('p', 'vh-sem vp-sem', tr('Sem poções: a banca do mercador vende no Mercadinho.')));
      }
    }
    var dois = lista.length > 1;
    lista.forEach(function (v) {
      var r = q.rows[v.chave];
      if (!r) return;
      var p = pctVida(v), cheio = v.hp >= v.max, zero = v.hp < 1, alvo = v.chave === vidaAlvoPraca;
      var n = v.hp + '/' + v.max, pt = zero ? tr('1 PV em {a} s', { a: Math.max(1, v.ate1S) }) : p + '%';
      if (r.num.textContent !== n) r.num.textContent = n;
      if (r.pct.textContent !== pt) r.pct.textContent = pt;
      if (r.enche.style.height !== p + '%') r.enche.style.height = p + '%';
      r.card.classList.toggle('is-cheio', cheio);
      r.card.classList.toggle('is-zero', zero);
      r.card.classList.toggle('is-baixo', !cheio && !zero && p < 35);
      r.card.classList.toggle('is-alvo', alvo);
      r.card.setAttribute('aria-pressed', alvo ? 'true' : 'false');
      var tt = (dois
        ? tr('{nome}: {n} PV{a} · toque para escolher quem bebe a poção', { nome: v.nome, n: n, a: cheio ? tr(' — vida cheia')
        : (zero ? ' ' + tr('— 1 PV em {a} s', { a: Math.max(1, v.ate1S) }) : ' ' + tr('— +1 PV a cada {a} s · cheio em {b}', { a: segPorPv(), b: mmss(v.cheioEmS) })) })
        : tr('{nome}: {n} PV{a}', { nome: v.nome, n: n, a: cheio ? tr(' — vida cheia')
        : (zero ? ' ' + tr('— 1 PV em {a} s', { a: Math.max(1, v.ate1S) }) : ' ' + tr('— +1 PV a cada {a} s · cheio em {b}', { a: segPorPv(), b: mmss(v.cheioEmS) })) }));
      if (r.card.title !== tt) r.card.title = tt;
      if (alvo && q.para) {
        var pr = tr('Poção para <b>{a}</b>:', { a: esc(v.nome) });
        if (q.para.innerHTML !== pr) q.para.innerHTML = pr;
      }
    });
    [].forEach.call(q.pocoesEl.querySelectorAll('.vp-pocao'), function (b) {
      var m = safe(function () { return G().podeBeberEspera(vidaAlvoPraca, b.getAttribute('data-pocao')); }, 'batalha');
      b.classList.toggle('is-dim', !!m);
    });
    // 06/10: o cartão mora na linha do nome (o bloco em fluxo de buildHub): o topo não é mais medido, e por
    // isso nem o tique mexe em posição — só em número, altura do coração e classe
  }
  function ligaVidaTique() {
    if (!vidaTimer) vidaTimer = setTimeout(vidaTique, 250);
  }
  function vidaTique() {
    if (vidaTimer) { clearTimeout(vidaTimer); vidaTimer = null; }
    vidaQuadros = vidaQuadros.filter(function (q) { return document.body.contains(q.box); });
    if (!VIDA_TELAS[current]) return;
    vidaQuadros.forEach(function (q) { (q.pinta || pintaVida)(q); });   // a praça pinta o cartão dela
    // o botão da porta (solo): apagado enquanto houver herói a 0 PV, com os segundos que faltam
    var portas = document.querySelectorAll('.vida-porta');
    var ev = portas.length ? safe(function () { return G().esperaVida(); }, null) : null;
    [].forEach.call(portas, function (b) {
      b.classList.toggle('is-apagado', !!ev);
      b.textContent = ev ? textoEsperaVida(ev) : (b.getAttribute('data-rotulo') || b.textContent);
    });
    // 14/09: o "Pronto" do duelo em rede espera o herói escolhido a 0 (e o servidor abrir o duelo)
    var prontos = document.querySelectorAll('.du-pronto');
    if (prontos.length) {
      var evD = dueloEscolha.length ? safe(function () { return G().esperaVida(dueloEscolha.slice()); }, null) : null;
      var abrindo = !!safe(function () { return Dl().estado().abrindo; }, false);
      [].forEach.call(prontos, function (b) {
        b.classList.toggle('is-apagado', !!evD || abrindo);
        b.textContent = abrindo ? tr('Conferindo a vida com o servidor…')
          : (evD ? textoEsperaVida(evD) : (b.getAttribute('data-rotulo') || b.textContent));
      });
    }
    // em grupo o botão de quem lidera é do Coop (podeEntrar): quando a espera muda, o painel repinta
    if (current === 'antessala') {
      var chave = ev ? ev.chave : '';
      if (!portas.length) {
        var evG = safe(function () { return G().esperaVida(); }, null);
        chave = evG ? evG.chave : '';
      }
      if (chave !== vidaPortaChave) {
        vidaPortaChave = chave;
        if (painelModo === 'lugar' && painelLugar && painelLugar.tipo === 'porta' && emGrupo()) repintaLugar();
      }
    }
    if (!vidaQuadros.length && !portas.length && !prontos.length) return;
    var aVista = portas.length || prontos.length || vidaQuadros.some(function (q) { return !q.box.hidden; });
    vidaTimer = setTimeout(vidaTique, aVista ? 250 : 1000);
  }
  // a vida mudou fora da tela (poção, fim de luta, a resposta do servidor, outra aba): repinta já
  safe(function () {
    return JOGO.Vida && JOGO.Vida.aoMudar(function () { if (VIDA_TELAS[current] && vidaQuadros.length) vidaTique(); });
  }, null);

  /* A PORTA DA ANTESSALA em grupo (4.6): quem lidera abre quando o outro está
   * pronto na porta; quem segue só espera */
  /* O CAMINHO ESCURO NA PORTA (07/10, game.js Game.podeEscuro): da segunda sala em diante a porta oferece a
   * escolha — a sala de sempre, ou a sala com um afixo sorteado que paga +25% de XP e saque. Sozinho e, desde
   * 07/10 à noite, em grupo: quem lidera escolhe (a escolha vai no abrir da sala do grupo) e quem segue vê. */
  /* 08/10 à noite: o BÔNUS DE DESCANSO na porta — quantas salas vencidas com XP em dobro ainda há hoje
   * (Progress.descanso, no dia de Brasília pelo relógio do servidor; sem a agenda medida, nada se promete) */
  function blocoDescanso(painel) {
    var r = safe(function () {
      if (!(JOGO.Agenda && JOGO.Agenda.medido && JOGO.Agenda.medido())) return null;
      return P().descanso ? P().descanso(JOGO.Agenda.agora()) : null;
    }, null);
    if (!r) return;
    painel.appendChild(el('p', 'hub-nota porta-descanso' + (r.restam > 0 ? ' is-on' : ''), r.restam > 0
      ? tr('☀ <b>Descanso</b>: XP em dobro nas próximas {n} sala(s) vencida(s) de hoje.', { n: r.restam })
      : tr('☀ O descanso de hoje já foi usado ({de} salas em dobro). Amanhã volta.', { de: P().DESCANSO_SALAS || 3 })));
  }
  function blocoEscuro(painel) {
    if (!safe(function () { return !!(G().podeEscuro && G().podeEscuro()); }, false)) return;
    var ligado = safe(function () { return !!G().escuroDaSala(); }, false);
    var cxE = el('div', 'porta-escuro' + (ligado ? ' is-on' : ''));
    cxE.appendChild(el('p', 'hub-nota', ligado
      ? tr('🕯 <b>Caminho escuro</b>: a sala abre com um afixo sorteado — vale +{pct}% de XP e saque.', { pct: afixoBonusPct() })
      : tr('🕯 <b>Caminho escuro</b>: quer a sala com um afixo sorteado? Vale +{pct}% de XP e saque, e o perigo que vier.', { pct: afixoBonusPct() })));
    cxE.appendChild(btn(ligado ? tr('Voltar ao caminho de sempre') : tr('Descer pelo caminho escuro'),
      'btn-mini ' + (ligado ? 'btn-ghost' : 'btn-gold'), function () {
        safe(function () { return G().defineEscuro(!ligado); }, false);
        safe(function () { return Gp().avisaDificuldade(); }, false);   // em grupo, quem segue fica sabendo
        repintaLugar();
      }));
    painel.appendChild(cxE);
  }
  function painelPortaGrupo(p) {
    var nome = nomeParceiro();
    // 13/09: a vida dos heróis do grupo (os meus com as poções; os do parceiro, sem)
    var vidaG = vidaBloco('porta');
    if (!souLider()) {
      // 11/09 (revisão): quem segue vê a dificuldade que vale (a da ata é a de quem lidera)
      var lnDif = linhaDifGrupo();
      if (lnDif) p.appendChild(lnDif);
      // 07/10: e o caminho escuro, se quem lidera o pediu nesta porta (o afixo sorteado vem na ata)
      if (safe(function () { return !!(G().podeEscuro() && (grupoEstado() || {}).descidaEscuro); }, false)) {
        p.appendChild(el('p', 'hub-nota porta-escuro is-on',
          tr('🕯 <b>Caminho escuro</b>: {a} pediu a sala com um afixo sorteado — vale +{pct}% de XP e saque.', { a: esc(nome), pct: afixoBonusPct() })));
      }
      if (vidaG) p.appendChild(vidaG);
      p.appendChild(el('p', 'hub-nota', (meusHeroisG().length > 1
        ? tr('Quem abre a porta é quem lidera (<b>{a}</b>). Seus dois heróis estão prontos. <b style="color:#7fe08a">✓</b>', { a: esc(nome) })
        : tr('Quem abre a porta é quem lidera (<b>{a}</b>). Seu herói está pronto. <b style="color:#7fe08a">✓</b>', { a: esc(nome) }))));
      return;
    }
    var sd = seletorDif();
    if (sd) p.appendChild(sd);
    blocoDescanso(p);                     // 08/10 à noite: o descanso de QUEM olha (cada conta tem o seu)
    blocoEscuro(p);                       // 07/10: quem lidera escolhe o caminho escuro
    if (vidaG) p.appendChild(vidaG);
    var pe = safe(function () { return Cp().podeEntrar(); }, null) || { ok: false, motivo: 'sem-pronto' };
    var chamando = chamandoPorta && (Date.now() - chamandoPorta < 20000);
    var espera = (pe.motivo === 'vida' && pe.vida) ? tr('{a} — ou beba uma poção.', { a: textoEsperaVida(pe.vida) }) : esperaPorta(nome);
    if (chamando) p.appendChild(el('p', 'hub-nota', tr('Chamando {a} para a batalha…', { a: esc(nome) })));
    else if (!pe.ok) {
      p.appendChild(el('p', 'hub-nota hub-espera-par', pe.motivo === 'versao' ? esc(textoMotivo('versao', nome)) : esc(espera)));
    }
    p.appendChild(btn(tr('Entrar na batalha com {a}', { a: esc(nome) }), 'btn-primary btn-block' + (pe.ok && !chamando ? '' : ' is-apagado'),
      function () {
        if (chamando) return;
        if (!pe.ok) { toast(pe.motivo === 'versao' ? textoMotivo('versao', nome) : espera); return; }
        var ok = safe(function () { return Cp().entrar(); }, false);
        if (!ok) { toast(tr('Não deu para chamar {nome} agora.', { nome: nome })); return; }
        chamandoPorta = Date.now();
        repintaLugar();
      }));
  }

  /* 11/09 (revisão): O QUE QUEM LIDERA ESPERA. Quem segue nunca anda até a porta:
   * o `pronto` sai sozinho ao chegar na antessala (e se repete a cada 5 s). O que
   * segura, da sala 2 em diante, é ainda estar na recompensa — "chegar à porta"
   * mandava pedir no chat uma coisa que a outra pessoa não tinha como fazer. Onde
   * ela está vem da presença da Rede: a antessala é uma sala, e só quem está nela
   * tem a mesma chave (dungeonId:roomIndex) que a minha. */
  function esperaPorta(nome) {
    var pid = (parceiroG() || {}).id, parSala = null;
    safe(function () { JOGO.Rede.pares().forEach(function (q) { if (q && q.id === pid) parSala = q.sala || null; }); return true; }, null);
    var aqui = safe(function () { return G().dungeonId + ':' + G().roomIndex; }, '');
    return (pid && parSala && parSala === aqui) ? tr('Esperando {nome} ficar pronto(a)…', { nome: nome })
      : tr('{nome} ainda não entrou na antessala (na recompensa, é o botão "Seguir para a próxima sala").', { nome: nome });
  }
  /* 11/09 (revisão): a dificuldade de quem lidera, para quem segue — ela chega no
   * estado do grupo e no "descer"; a que vale na batalha é a da ata, a de quem lidera */
  function linhaDifGrupo() {
    var dif = (grupoEstado() || {}).descidaDif;
    var cfg = dif ? ((JOGO.DATA && JOGO.DATA.dificuldades) || {})[dif] : null;
    if (!cfg) return null;
    var custo = Math.round(((cfg.vida || 1) - 1) * 100), premio = Math.round(((cfg.xp || 1) - 1) * 100);
    var num = (custo === 0 && premio === 0) ? '' : ' — ' + (custo === 0 ? tr('monstros iguais') : tr('{a}{custo}% de vida', { a: custo > 0 ? '+' : '', custo: custo })) +
      ', ' + (premio === 0 ? tr('xp normal') : tr('{a}{premio}% de xp', { a: premio > 0 ? '+' : '', premio: premio }));
    return el('p', 'hub-nota hub-dif-lider', tr('Dificuldade escolhida por quem lidera: <b>{a}</b>{b}', { a: esc(cfg.nome || dif), b: esc(num) }));
  }

  // ------------------------------------------------ o painel do grupo (P4)
  var grupoLadoEl = null, glMenuEl = null, glSig = '', tickSocial = 0, ultConexao = null;
  /* 06/10: NA PRAÇA o painel do grupo deixa o canto direito — onde ficava por cima das pílulas dos eventos e
   * da loja (o sino, no toque) e encostado na moeda "Prêmio Grátis!" — e entra, como a última fila, no bloco
   * do canto de cima à esquerda (grupoCasaPraca = o .hub-quem da praça, posto por buildHub). É o MESMO
   * elemento, só mudado de casa: fora da praça (antessala, batalha, recompensa) volta para a raiz, como era.
   * Lá ele é compacto (css .hub-quem > .grupo-lado): por membro, o retratinho com a coroa de quem lidera e o
   * ponto de online, e o nome curto; classes, níveis, o estado e as ações abrem no toque (abreGlMenu). */
  var grupoCasaPraca = null;
  var GL_TELAS = ['hub', 'antessala', 'battle', 'roomClear', 'dungeonComplete', 'defeat'];
  /* AS UNIDADES DE UM MEMBRO (12/09): agora sao ATE DUAS, porque cada lado
   * desce com os dois selecionados. Vem na ordem da lista do motor, as de pe
   * antes das que sairam do tabuleiro (a fusao entra como uma so). */
  function unidadesDoMembro(m, s) {
    if (!s || !s.units) return [];
    var achadas = [], i, u;
    for (i = 0; i < s.units.length; i++) {
      u = s.units[i];
      if ((u.kind !== 'hero' && u.kind !== 'fusion') || !u.dono || u.dono !== m.id) continue;
      if (u.fusedInto) continue;               // a metade que virou fusao nao conta duas vezes
      achadas.push(u);
    }
    if (achadas.length || !m.eu) {
      achadas.sort(function (a, b) {
        var va = (a.alive && !a.offBoard) ? 0 : 1, vb = (b.alive && !b.offBoard) ? 0 : 1;
        return va - vb;
      });
      return achadas;
    }
    // motor sem `dono` (fora de rede): os MEUS herois pelo heroId
    var ids = safe(function () { return Gp().meusHerois(); }, null);
    if (!ids || !ids.length) {
      var um = safe(function () { return Gp().meuHeroi(); }, null);
      ids = um ? [um] : [];
    }
    for (i = 0; i < s.units.length; i++) {
      u = s.units[i];
      if (u.kind === 'hero' && u.heroId && ids.indexOf(u.heroId) >= 0) achadas.push(u);
    }
    return achadas;
  }
  function pintaGrupoLado() {
    if (!grupoLadoEl) return;
    var naPraca = current === 'hub' && !!grupoCasaPraca && grupoCasaPraca.isConnected;
    var casa = naPraca ? grupoCasaPraca : root;
    if (casa && grupoLadoEl.parentNode !== casa) { fechaGlMenu(); casa.appendChild(grupoLadoEl); }
    grupoLadoEl.classList.toggle('is-praca', naPraca);
    var est = grupoEstado();
    var vis = !!(est && est.fase === 'formado' && est.membros && est.membros.length === 2) &&
              GL_TELAS.indexOf(current) >= 0;
    grupoLadoEl.classList.toggle('is-on', vis);
    // 11/09 (revisão): na batalha, na MINHA vez (e na colocação de quem escolhe a
    // casa), o painel deixa o toque passar para o tabuleiro — no celular ele fica
    // em cima da borda direita da sala, e o toque numa casa ali abria o menu do
    // cartão em vez de mover ou mirar. Na vez do parceiro (ou de um monstro) os
    // cartões voltam a ser tocáveis (o menu deles é a "Mensagem particular").
    var passa = vis && current === 'battle' && !!safe(function () {
      var g = G();
      // 21/09: na preparação TODO jogador marca a sua casa — não é mais só de quem lidera
      return g.isPlayerTurn() || (g.state && g.state.phase === 'placing' && !!(g.minhasOpcoes && g.minhasOpcoes().length));
    }, false);
    if (passa !== grupoLadoEl.classList.contains('is-passa')) {
      grupoLadoEl.classList.toggle('is-passa', passa);
      if (passa) fechaGlMenu();
    }
    if (!vis) {
      if (glSig) { clear(grupoLadoEl); glSig = ''; }
      fechaGlMenu();
      return;
    }
    var naLuta = current === 'battle';
    // na batalha o painel mora logo acima da barra de baixo, pela altura MEDIDA
    // dela (no celular ela cresce com a fusão): nunca por cima do "Encerrar turno"
    var base = naLuta && screens.battle ? screens.battle.querySelector('.bt-bottom') : null;
    var hb = base ? Math.round(base.getBoundingClientRect().height) : 0;
    grupoLadoEl.style.bottom = (naLuta && hb) ? (hb + 12) + 'px' : '';
    var ses = naLuta ? coopSessao() : null;
    var s = naLuta ? st() : null;
    var ativa = naLuta ? activeUnit() : null;
    var agoraG = safe(function () { return Gp()._agora(); }, Date.now());
    var conexao = safe(function () { return JOGO.Rede.estadoConexao(); }, null);
    var cartas = est.membros.map(function (m) {
      var us = naLuta ? unidadesDoMembro(m, s) : [];
      var fora = !m.eu && !m.on;
      var voltando = fora && !m.saiu && m.sumidoDesde && (agoraG - m.sumidoDesde) < (est.graca || 15000);
      // os dois herois do membro, cada um com o corpo dele (quando ha corpo)
      var hs = (m.herois && m.herois.length) ? m.herois : (m.heroi ? [m.heroi] : []);
      var linhas = (us.length ? us : hs).map(function (x, i) {
        var u = us[i] || null, h = hs[i] || (u ? { classId: u.classId || u.defId, element: u.element, level: u.level } : {});
        // 09/10: `pv` e `esc` em % da MESMA escala (fracoesVida): o escudo em azul depois da vida
        var frv = u ? fracoesVida(u) : null;
        return { u: u, h: h || {},
                 pv: frv ? Math.round(100 * frv.pv) : null,
                 esc: frv ? Math.round(100 * frv.esc) : 0,
                 vez: !!(u && ativa && ativa.uid === u.uid) };
      });
      return {
        m: m, linhas: linhas, fora: fora, voltando: !!voltando, lider: m.id === est.lider,
        ia: us.some(function (u) { return !!u.ia; }) || (!m.eu && !!(ses && ses.parceiroIA)),
        vez: linhas.some(function (l) { return l.vez; }),
        semRede: !!m.eu && conexao === 'religando'
      };
    });
    var sig = current + (naPraca ? '@praca' : '') + '#' + cartas.map(function (c) {
      return [c.m.id, c.m.nome, c.fora, c.voltando, c.lider, c.ia, c.vez, c.semRede,
              c.linhas.map(function (l) {
                return [l.h.classId, l.h.element, l.h.level, l.pv, l.esc, l.vez ? 1 : 0].join('.');
              }).join('+')].join(',');
    }).join('|');
    if (sig === glSig) return;
    glSig = sig;
    clear(grupoLadoEl);
    cartas.forEach(function (c) { grupoLadoEl.appendChild(cartaoMembro(c)); });
  }
  function cartaoMembro(c) {
    var m = c.m;
    var linhas = c.linhas.length ? c.linhas : [{ h: m.heroi || {}, u: null, pv: null, vez: false }];
    var h = linhas[0].h || {};
    var card = el('button', 'gl-membro' + (c.lider ? ' is-lider' : '') + (c.vez ? ' is-vez' : '') + (c.fora ? ' is-fora' : ''));
    card.type = 'button';
    var pic = el('div', 'gl-pic' + (linhas.length > 1 ? ' tem-dois' : ''));
    pic.appendChild(art('portrait', [h.classId || 'sumo', { element: h.element || 'neutro', size: 40 }], 36));
    // 12/09: o SEGUNDO heroi do membro, num retrato menor encostado no canto
    if (linhas.length > 1) {
      var h2 = linhas[1].h || {};
      var p2 = el('span', 'gl-pic2');
      p2.appendChild(art('portrait', [h2.classId || 'sumo', { element: h2.element || 'neutro', size: 28 }], 20));
      pic.appendChild(p2);
    }
    if (c.lider) pic.appendChild(el('span', 'gl-coroa', '♛'));
    pic.appendChild(el('i', 'gl-on' + ((c.fora || c.semRede) ? ' is-off' : (c.ia ? ' is-ia' : ''))));
    card.appendChild(pic);
    var tx = el('div', 'gl-tx');
    var nome = String(m.nome || (m.eu ? tr('Você') : '?'));
    tx.appendChild(el('span', 'gl-nome', esc(nome.length > 12 ? nome.slice(0, 11) + '…' : nome)));
    linhas.forEach(function (l) {
      var hh = l.h || {};
      tx.appendChild(el('span', 'gl-nv' + (l.vez ? ' is-vez' : ''),
                        esc(className(hh.classId || '')) + ' · nv ' + (hh.level || 1)));
      if (l.pv === null) return;
      var vb = el('div', 'gl-vida');
      var vi = el('i');
      var wPv = Math.max(0, Math.min(100, l.pv));
      vi.style.width = wPv + '%';
      vb.appendChild(vi);
      if (l.esc > 0) {                      // 09/10: o escudo em azul, encostado na vida
        var ve = el('i', 'esc');
        ve.style.left = wPv + '%';
        ve.style.width = Math.max(0, Math.min(100 - wPv, l.esc)) + '%';
        vb.appendChild(ve);
      }
      tx.appendChild(vb);
    });
    var selos = el('div', 'gl-selos');
    if (c.vez) selos.appendChild(el('span', 'gl-selo s-vez', 'vez'));
    if (c.ia) selos.appendChild(el('span', 'gl-selo s-ia', 'fora'));
    if (c.voltando) selos.appendChild(el('span', 'gl-selo s-voltando', 'voltando…'));
    else if (c.fora) selos.appendChild(el('span', 'gl-selo s-caiu', m.saiu ? 'saiu' : 'caiu'));
    if (c.semRede) selos.appendChild(el('span', 'gl-selo s-caiu', tr('sem conexão')));
    if (selos.childNodes.length) tx.appendChild(selos);
    card.appendChild(tx);
    card.title = nome + (c.lider ? ' — lidera' : '');
    tap(card, function () { abreGlMenu(m, card, c); });
    return card;
  }
  function fechaGlMenu() {
    if (glMenuEl) { glMenuEl.classList.remove('is-on'); glMenuEl.removeAttribute('data-de'); }
  }
  function confirmaSair(nome) {
    var naAntessala = current === 'antessala';
    confirmSheet(tr('Sair do grupo?'), naAntessala
      ? tr('A descida acaba para vocês dois e o grupo se desfaz.')
      : tr('Você deixa o grupo{a}.', { a: nome ? ' ' + tr('de {a}', { a: esc(nome) }) : '' }), function () {
        safe(function () { Gp().sair('saiu'); return true; }, null);
      });
  }
  /* o menu de um cartão do painel do grupo (4.3) */
  function abreGlMenu(m, card, c) {
    if (!glMenuEl) return;
    if (glMenuEl.classList.contains('is-on') && glMenuEl.getAttribute('data-de') === m.id) { fechaGlMenu(); return; }
    clear(glMenuEl);
    glMenuEl.setAttribute('data-de', m.id);
    var est = grupoEstado() || {};
    var naLuta = current === 'battle' || current === 'roomClear' || current === 'dungeonComplete';
    glMenuEl.appendChild(el('h4', null, esc(m.nome || '') + (m.id === est.lider ? ' <span class="gl-coroa-t">♛</span>' : '')));
    // 06/10: o que o cartão grande dizia — as classes com o nível e o estado — vem para cá: na praça o cartão
    // é só o retratinho e o nome
    if (c) {
      var det = (c.linhas || []).map(function (l) {
        var hh = l.h || {};
        return hh.classId ? esc(className(hh.classId)) + ' · nv ' + (hh.level || 1) : '';
      }).filter(function (x) { return !!x; });
      if (c.lider) det.push(tr('lidera o grupo'));
      if (c.voltando) det.push(tr('voltando…'));
      else if (c.fora) det.push(m.saiu ? tr('saiu') : tr('caiu'));
      else if (c.ia) det.push(tr('fora'));
      if (c.semRede) det.push(tr('sem conexão'));
      if (det.length) glMenuEl.appendChild(el('p', 'gl-menu-det', det.join('<br>')));
    }
    function op(rot, cls, fn) {
      glMenuEl.appendChild(btn(rot, 'btn-mini ' + (cls || 'btn-ghost'), function () { fechaGlMenu(); fn(); }));
    }
    if (!m.eu) {
      op(tr('Mensagem particular'), 'btn-ghost', function () { armaSussurro(m.id, m.nome); });
      if (!naLuta && souLider()) {
        op(tr('Passar a liderança'), 'btn-gold', function () {
          var r = safe(function () { return Gp().passarLideranca(); }, null);
          toast(r && r.ok ? tr('{nome} agora lidera o grupo.', { nome: m.nome }) : textoMotivo(r ? r.motivo : 'ocupado', r && r.motivo === 'sumido' ? m.nome : null),
                r && r.ok ? 'good' : undefined);
        });
        op(tr('Desfazer o grupo'), 'btn-warn', function () { confirmaSair(null); });
      } else if (!naLuta) {
        op(tr('Sair do grupo'), 'btn-warn', function () { confirmaSair(m.nome); });
      }
    } else if (!naLuta) {
      op(tr('Sair do grupo'), 'btn-warn', function () { confirmaSair(nomeParceiro()); });
    } else {
      glMenuEl.appendChild(el('p', 'hub-nota', tr('Para sair da batalha, use o menu de pausa (☰).')));
    }
    op(tr('Fechar'), 'btn-ghost', function () {});
    var r = card.getBoundingClientRect(), rr = root.getBoundingClientRect();
    var naFila = grupoLadoEl.classList.contains('is-praca');
    glMenuEl.classList.toggle('is-praca', naFila);
    glMenuEl.classList.add('is-on');
    if (naFila) {
      /* na praça a fila mora no canto de cima à esquerda e o balão não a tapa: com altura (PC, celular em pé
       * largo) abre logo ABAIXO do retrato tocado; deitado no celular (pouca altura) abre à DIREITA da fila, na
       * altura dela. A altura é a medida do balão, para ele não sair por baixo. (≤ 480 px de largura o css faz
       * dele a folha de baixo, como já era.) */
      var alt = glMenuEl.offsetHeight || 250, larg = glMenuEl.offsetWidth || 214;
      var baixo = rr.height >= 520, fimDaFila = r.right, topoDaFila = r.top;
      [].forEach.call(grupoLadoEl.children, function (k) {
        var rk = k.getBoundingClientRect();
        if (rk.width) { fimDaFila = Math.max(fimDaFila, rk.right); topoDaFila = Math.min(topoDaFila, rk.top); }
      });
      glMenuEl.style.top = Math.max(8, Math.min(rr.height - alt - 8, (baixo ? r.bottom + 6 : topoDaFila) - rr.top)) + 'px';
      glMenuEl.style.left = Math.max(8, Math.min(rr.width - larg - 8, (baixo ? r.left : fimDaFila + 8) - rr.left)) + 'px';
      glMenuEl.style.right = 'auto';
    } else {
      glMenuEl.style.top = Math.max(8, Math.min(rr.height - 250, r.top - rr.top)) + 'px';
      glMenuEl.style.left = '';
      glMenuEl.style.right = Math.max(8, rr.right - r.left + 8) + 'px';
    }
  }

  // ------------------------------------------- a mensagem particular (4.4)
  var chatUI = null;               // { log, input, chip } do chat da tela aberta
  var chatAlvo = null;             // { id, nome }: o sussurro armado no chat
  var sussurroAlvo = null;         // o destinatário da ficha de sussurro
  var suHist = null, suInput = null, suInputDe = null;   // a ficha aberta: o histórico e o campo (a linha nova entra sem redesenhar)
  function chatVivo() { return (chatUI && naTelaAberta(chatUI.log)) ? chatUI : null; }
  function linhaSussurro(l) {
    var li = el('div', 'hub-chat-linha chat-sussurro' + (l.meu ? ' is-meu' : '') + (l.sistema ? ' is-falhou' : ''));
    var textoS = (JOGO.Rede && JOGO.Rede.filtra) ? JOGO.Rede.filtra(l.texto) : l.texto;   // 08/10 à noite: o filtro
    if (l.sistema) li.textContent = l.texto;
    else if (l.meu) li.innerHTML = '→ <b>' + esc(l.nome) + ':</b> ' + esc(textoS);
    else li.innerHTML = '<b>' + esc(l.nome) + '</b> (particular): ' + esc(textoS);
    if (!l.meu && !l.sistema) {
      // 03/10: o particular é onde o assédio mais acontece — a linha também se denuncia (js/ui/moderacao.js)
      li.setAttribute('data-de', l.de);
      li.setAttribute('data-nome', l.nome || '');
      li.title = tr('toque para responder');
      tap(li, function () { armaSussurro(l.de, l.nome); });
    }
    return li;
  }
  function chatSussurro(l) {
    var c = chatVivo();
    if (!c) return false;
    c.log.appendChild(linhaSussurro(l));
    while (c.log.children.length > 8) c.log.removeChild(c.log.firstChild);
    c.log.scrollTop = c.log.scrollHeight;
    return true;
  }
  function pintaChip() {
    var c = chatVivo();
    if (!c) return;
    clear(c.chip);
    c.chip.classList.toggle('is-on', !!chatAlvo);
    c.input.classList.toggle('is-privado', !!chatAlvo);
    // 04/10: na sede a caixa diz para quem a fala vai (a faixa "Chat da guilda" é do CSS)
    var naSede = sedeDentro();
    if (c.input.parentNode) c.input.parentNode.classList.toggle('is-guilda', naSede);
    c.input.classList.toggle('is-guilda', naSede && !chatAlvo);
    c.input.placeholder = chatAlvo ? tr('para {nome}… (Enter)', { nome: chatAlvo.nome })
      : naSede ? tr('fale com a guilda…  /p praça · /Nome particular') : tr('diga algo…  /g guilda · /Nome particular');
    if (!chatAlvo) return;
    c.chip.appendChild(el('span', null, 'para'));
    c.chip.appendChild(el('span', 'chat-chip-nm', esc(chatAlvo.nome)));
    c.chip.appendChild(el('span', 'chat-chip-x', '✕'));
  }
  /* OS COMANDOS DO CHAT (13/09, dono: "o chat precisa ser normal — /Nome_usuario
   * manda mensagem particular, /g manda mensagem pra guild"). Sem barra é a
   * praça, como sempre. O nome pode ter espaço ("Sem Nome"): vale o MAIS LONGO
   * que casa com alguém que se pode achar — quem está na praça ou na sala, e
   * os amigos online (o relé deu o herói deles). "/Nome" sem texto arma o chip
   * da conversa. `linha` é o chatLinha da tela aberta. Devolve se saiu. */
  function comandoDoChat(t, j, linha) {
    var R = JOGO.Rede;
    var corpo = t.slice(1);
    var mG = /^g(?:\s+([\s\S]*))?$/i.exec(corpo);
    if (mG) {
      var txtG = (mG[1] || '').trim();
      if (!txtG) { toast(tr('Escreva a mensagem depois do /g — por exemplo: /g bora descer?')); return false; }
      if (!R || !R.falarGuilda || !R.falarGuilda(txtG)) { toast(textoMotivo('privado', null)); return false; }
      if (linha) linha('[Guilda] ' + (j.nome || tr('você')), txtG, '#7fc8ff');
      if (sedeDentro()) safe(function () { return JOGO.Hub.fala(null, txtG); }, null);   // no salão, o meu balão também
      return true;
    }
    // 04/10: dentro da sede a fala sem barra é da guilda — "/p texto" ainda alcança a praça
    var mP = sedeDentro() ? /^p(?:\s+([\s\S]*))?$/i.exec(corpo) : null;
    if (mP) {
      var txtP0 = (mP[1] || '').trim();
      if (!txtP0) { toast(tr('Escreva a mensagem depois do /p — ela vai para a praça.')); return false; }
      if (!R || !R.falar || !R.falar(txtP0)) return false;
      if (linha) linha(tr('[Praça] {a}', { a: j.nome || tr('você') }), txtP0, '#9bd06a');
      return true;
    }
    var baixo = corpo.toLowerCase(), achado = null;
    conhecidosDoChat().forEach(function (a) {
      var n = String(a.nome || '').toLowerCase();
      if (!n || !(baixo === n || baixo.indexOf(n + ' ') === 0)) return;
      if (!achado || n.length > achado.nome.length) achado = a;
    });
    if (!achado) {
      var pedaco = corpo.split(/\s+/)[0] || '';
      toast(pedaco ? tr('Ninguém chamado {pedaco} por perto nem entre os amigos online.', { pedaco: pedaco })
                   : tr('Use /Nome mensagem (particular) ou /g mensagem (guilda).'));
      return false;
    }
    if (achado.conta && JOGO.Amigos && JOGO.Amigos.ehInimigo(achado.conta)) {
      toast(tr('{nome} está na sua lista de inimigos: sem mensagem particular.', { nome: achado.nome }));
      return false;
    }
    var txtP = corpo.slice(achado.nome.length).trim();
    if (!txtP) { armaSussurro(achado.id, achado.nome); return true; }
    var rs = safe(function () { return Su().manda(achado.id, txtP); }, null);
    if (rs && rs.ok) return true;
    toast(textoMotivo(rs ? rs.motivo : 'privado', null));
    return false;
  }
  function conhecidosDoChat() {
    var fora = [], vistos = {};
    (safe(function () { return JOGO.Rede.pares(); }, []) || []).forEach(function (p) {
      if (!p || !p.id || !p.nome || vistos[p.id]) return;
      vistos[p.id] = 1;
      fora.push({ id: p.id, nome: p.nome, conta: (typeof p.nuvem === 'number') ? p.nuvem : null });
    });
    var Am = JOGO.Amigos;
    if (Am) {
      (Am.lista().amigos || []).forEach(function (a) {
        var st = Am.status(a.conta);
        if (!st || !st.online || !st.id || vistos[st.id]) return;
        vistos[st.id] = 1;
        fora.push({ id: st.id, nome: a.nome, conta: a.conta });
      });
    }
    return fora;
  }

  /* "Mensagem particular": no chat do canto com o chip; sem chat (batalha,
   * recompensa), numa ficha pequena */
  function armaSussurro(id, nome) {
    if (!id) return;
    if (!safe(function () { return Su().pode(); }, false)) { toast(textoMotivo('privado', null)); return; }
    var c = chatVivo();
    if (!c) { openSheet('sussurro', { id: id, nome: nome }); return; }
    chatAlvo = { id: id, nome: nome || '?' };
    pintaChip();
    try { c.input.focus(); } catch (e) {}
  }
  /* A LINHA QUE CHEGA (ou a que eu mando: o Su().manda devolve a minha na hora).
   * 11/09 (revisão): na ficha aberta com essa pessoa ela só ENTRA no histórico —
   * redesenhar a ficha a cada linha apagava o que estava sendo digitado e, no
   * celular, tirava do DOM o campo focado (o teclado fechava a cada envio). Fora
   * da ficha: no chat do canto, se ele está na tela; e o toast COM o texto quando
   * não há chat (batalha, recompensa, derrota) ou uma ficha está por cima dele. */
  function aoSussurroChegou(l) {
    if (!l) return;
    // 03/10: o particular recebido entra nas falas que a denúncia anexa (o servidor não guarda o chat)
    if (!l.meu && !l.sistema) safe(function () { return JOGO.Denuncia && JOGO.Denuncia.anota(l.de, l.nome, l.texto); }, null);
    if (sheetName === 'sussurro' && sussurroAlvo && suHist && suHist.isConnected &&
        (l.de === sussurroAlvo.id || l.para === sussurroAlvo.id)) {
      suHist.appendChild(linhaSussurro(l));
      while (suHist.children.length > 8) suHist.removeChild(suHist.firstChild);
      suHist.scrollTop = suHist.scrollHeight;
      return;
    }
    var noChat = chatSussurro(l);
    var tapado = noChat && !!sheetName;          // o chat está na tela, mas uma ficha o cobre
    if (l.sistema) { if (!noChat || tapado) toast(l.texto, 'bad'); return; }
    if (l.meu) return;
    if (!noChat || tapado) avisoSussurro(l);
  }
  function avisoSussurro(l) {
    var t = String(l.texto || '').replace(/\s+/g, ' ');
    if (t.length > 90) t = t.slice(0, 89) + '…';
    toast(l.nome + ' (particular): ' + t);
    toastT = 5;                                  // dá para ler; a conversa inteira fica na ficha
  }
  function sheetSussurro(id, nome) {
    if (id) sussurroAlvo = { id: id, nome: nome || '?' };
    var a = sussurroAlvo;
    if (!a) { closeSheet(); return; }
    // o rascunho sobrevive a um redesenho da mesma ficha (o UI.repaint da volta dos modelos 3D)
    var rascunho = (suInput && suInput.isConnected && suInputDe === a.id) ? suInput.value : '';
    var body = sheetShell(tr('Mensagem particular'), tr('para {a}', { a: esc(a.nome) }));
    sheetName = 'sussurro';
    var hist = el('div', 'hub-chat-log su-hist');
    (safe(function () { return Su().lista(); }, []) || []).filter(function (l) {
      return l.de === a.id || l.para === a.id;
    }).slice(-8).forEach(function (l) { hist.appendChild(linhaSussurro(l)); });
    body.appendChild(hist);
    suHist = hist; suInput = null; suInputDe = null;
    if (!safe(function () { return Su().pode(); }, false)) {
      body.appendChild(el('p', 'inv-dica', esc(textoMotivo('privado', null))));
      return;
    }
    var inp = document.createElement('input');
    inp.className = 'hub-input su-input';
    inp.maxLength = 240;
    inp.placeholder = tr('mensagem para {nome}…', { nome: a.nome });
    inp.value = rascunho;
    suInput = inp; suInputDe = a.id;
    function manda() {
      var r = safe(function () { return Su().manda(a.id, inp.value); }, null);
      // síncrono, dentro do gesto: o campo é o MESMO e o teclado do celular não fecha
      if (r && r.ok) { inp.value = ''; try { inp.focus(); } catch (e) {} }
      else toast(textoMotivo(r ? r.motivo : 'privado', null));
    }
    inp.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') manda();
      ev.stopPropagation();                 // o i digitado aqui não abre o saco
    });
    body.appendChild(inp);
    body.appendChild(btn(tr('Mandar'), 'btn-primary btn-block', manda));
    hist.scrollTop = hist.scrollHeight;
    // no gesto que abriu a ficha (o toque em "Mensagem particular") o foco já abre o
    // teclado do iOS; o setTimeout fica para quem chegou aqui por outro caminho
    try { inp.focus(); } catch (e0) {}
    setTimeout(function () { try { if (inp.isConnected && document.activeElement !== inp) inp.focus(); } catch (e) {} }, 60);
  }

  // -------------------------------------------------- a batalha em dupla
  /* a faixa da colocação (4.7): em grupo, quem lidera toca a casa; quem segue assiste */
  function textoColocacao() {
    if (modoRede() === 'grupo') {
      return tr('<b>Escolha onde nascer</b> — toque numa das suas casas douradas. {a} escolhe as dele ao mesmo tempo, de casas diferentes.', { a: esc(nomeParceiro()) });
    }
    return tr('<b>Escolha onde nascer</b> — toque numa das quatro casas douradas. O segundo herói nasce ao acaso perto de você.');
  }
  /* o que a barra de feitiços diz quando não é a minha vez: "Vez de Bia —
   * esperando o lance… 0:23" (o relógio estimado do Coop), o herói de quem
   * está fora (o turno dele passa), ou o turno de sempre */
  function esperaNaBarra(u) {
    bt.espera = null;
    if (!u) {
      /* 03/10: a vez de ninguém na Câmara do Eco é a rodada esperando o sorteio dela, que vem do servidor
       * (engine.js, "O SORTEIO RODADA A RODADA"): dizer isso, e dizer quando a rede caiu — a tentativa
       * espera, não acabou */
      var sal = safe(function () { return G().ecoSalEstado(); }, null);
      if (sal && !sal.treino) {
        return el('div', 'bt-wait eco-sal' + (sal.semRede ? ' is-sem-rede' : ''), sal.semRede
          ? tr('Sem resposta do servidor — a rodada {rodada} espera, tentando de novo…', { rodada: sal.rodada })
          : tr('A rodada {rodada} vem do servidor…', { rodada: sal.rodada }));
      }
      return el('div', 'bt-wait', tr('Aguarde…'));
    }
    if (modoRede() && (u.kind === 'hero' || u.kind === 'fusion')) {
      if (donoDe(u) === 'parceiro') {
        bt.espera = el('div', 'bt-wait bt-espera', '');
        pintaEspera();
        return bt.espera;
      }
      // 12/09: quem caiu nao e jogado pela IA — o turno dele PASSA. 08/10 à noite: antes de passar, a vez
      // dele CORRE no relógio (Game.relogioCaido): a barra mostra o tempo descendo, repintada no paintTimer
      if (u.ia && u.dono && u.dono !== meuIdRede()) {
        bt.espera = el('div', 'bt-wait bt-espera is-caido', '');
        pintaEspera();
        return bt.espera;
      }
      // o outro lado me deu por fora (um engasgo de conexão): o MEU turno passa
      // até a conexão se acertar — dizer isso em vez de congelar calado
      if (u.ia && u.dono && u.dono === meuIdRede()) {
        return el('div', 'bt-wait', tr('Sua conexão engasgou — o turno passa até ela se acertar.'));
      }
    }
    return el('div', 'bt-wait', tr('Turno de {a}…', { a: esc(u.name || '') }));
  }
  /* a derrota numa descida de grupo (4.8) */
  function derrotaGrupo(acts) {
    var nome = nomeParceiro();
    if (emGrupo() && souLider()) {
      acts.appendChild(btn(tr('Descer de novo com {a}', { a: esc(nome) }), 'btn-primary btn-big', function () {
        var dg = safe(function () { return G().dungeonId; }, null);
        var r = safe(function () { return Gp().descer(dg); }, null);
        if (!r || !r.ok) toast(textoMotivo(r ? r.motivo : 'ocupado', r && r.motivo === 'sumido' ? nome : null));
        else toast(tr('Chamando {nome}', { nome: nome }) + '…');
      }));
    } else if (emGrupo()) {
      acts.appendChild(btn(tr('Esperando {a}', { a: esc(nome) }) + '…', 'btn-primary btn-big is-apagado', function () {
        toast(tr('Quem lidera ({nome}) decide se vocês descem de novo.', { nome: nome }));
      }));
    }
    acts.appendChild(btn(tr('Voltar ao acampamento'), 'btn-ghost', function () {
      safe(function () { G().restart(); }, null);
      navTo('hub');
    }));
  }
  function pintaEspera() {
    if (!bt.espera || !bt.espera.isConnected) return;
    var ses = coopSessao();
    var u = activeUnit();
    var nome = nomeDoDono(u && u.dono);
    var resta = '', txt;
    if (u && u.ia && u.dono && u.dono !== meuIdRede()) {
      // 08/10 à noite: a vez de quem caiu corre no relógio de 30 s; confirmada a queda, passa na hora
      var rc = safe(function () { return G().relogioCaido(); }, null);
      txt = (rc && rc.uid === u.uid)
        ? tr('<b>{a} está fora</b> — a vez dele corre no relógio… {resta}', { a: esc(nome), resta: relogioTxt(rc.resta) })
        : tr('{a} está fora — o turno passa.', { a: esc(nome) });
    } else {
      if (ses && ses.esperando && ses.esperando.prazo) {
        var agora = safe(function () { return Cp()._agora(); }, null) || Date.now();
        resta = ' ' + relogioTxt(ses.esperando.prazo - agora);
      }
      txt = tr('<b>Vez de {a}</b> — esperando o lance…{resta}', { a: esc(nome), resta: resta });
    }
    if (bt.espera._txt !== txt) { bt.espera.innerHTML = txt; bt.espera._txt = txt; }
  }
  function coopSig() {
    var ses = coopSessao();
    if (!ses) return '';
    var e = ses.esperando;
    return [ses.parceiroOn ? 1 : 0, ses.parceiroIA ? 1 : 0, ses.sincronizando ? 1 : 0,
            e ? e.uid : ''].join(':');
  }
  var ultSes = null;
  function aoCoopMudou(ses) {
    var a = ultSes || {};
    ultSes = ses ? { parceiroIA: !!ses.parceiroIA, sincronizando: !!ses.sincronizando,
                     proximaLiberada: !!ses.proximaLiberada, prontoParceiro: !!ses.prontoParceiro,
                     fase: ses.fase || null } : null;
    if (ses) {
      var nome = (ses.parceiro && ses.parceiro.nome) || nomeParceiro();
      if (!a.parceiroIA && ses.parceiroIA) toast(tr('{nome} caiu — os heróis dele ficam, e a vez deles corre no relógio até ele voltar.', { nome: nome }));
      if (!a.sincronizando && ses.sincronizando) {
        // 19/09: na guerra a foto vem de quem MANDA, que tem nome (A1, A2, B1, B2 pela ordem — pode ser da outra guilda)
        var quem = ses.tipo === 'duelo' ? nome : (ses.tipo === 'guerra' && ses.guerra ? ses.guerra.autoridadeNome : null);
        toast(quem ? tr('Sincronizando com {quem}…', { quem: quem }) : tr('Sincronizando com quem lidera…'));
      }
    }
    if (current === 'battle') battleSig = '';
    pintaGrupoLado();
    var b = ultSes || {};
    if (current === 'antessala' && (a.prontoParceiro !== b.prontoParceiro || a.fase !== b.fase)) repintaLugar();
    if (current === 'roomClear' && !!a.proximaLiberada !== !!b.proximaLiberada) buildRewards(current, lastRewards);
  }

  // ---------------------------------------- recompensa e derrota em grupo
  /* o rodapé da recompensa numa descida de grupo (4.8). Devolve false (solo),
   * 'fim', 'acabou', 'lider' ou 'parceiro'. */
  function rodapeGrupo(foot, fim) {
    var est = grupoEstado();
    if (modoRede() !== 'grupo') return false;             // 06/10: a descida que virou só minha tem o rodapé de quem desce sozinho
    var rede = !!(lastRewards && lastRewards.rede) || !!(est && est.descidaGrupo);
    if (!rede) return false;
    var nome = emGrupo() ? nomeParceiro()
             : ((est && est.ultimoParceiro && est.ultimoParceiro.nome) || tr('O parceiro'));
    function voltaSo() {
      safe(function () { G().restart(); return true; }, null);
      navTo('hub');
    }
    if (fim) {
      foot.appendChild(btn(tr('Voltar ao acampamento'), 'btn-primary', voltaSo));
      return 'fim';
    }
    var acabou = !emGrupo() || !!(lastRewards && lastRewards.descidaAcabou) || !!(est && est.descidaAcabou);
    if (acabou) {
      foot.appendChild(el('p', 'foot-count', tr('{a} não voltou — a descida acabou.', { a: esc(nome) })));
      foot.appendChild(btn(tr('Voltar ao Acampamento'), 'btn-primary', voltaSo));
      return 'acabou';
    }
    foot.appendChild(btn(tr('Voltar ao acampamento'), 'btn-ghost', function () {
      // 06/10: volta só quem volta (ver perguntaSair)
      confirmSheet(tr('Voltar ao acampamento?'), tr('Só você volta: {a} fica e decide por si. O grupo continua.', { a: esc(nome) }), function () {
        safe(function () { Gp().subir('voltou'); return true; }, null);
      });
    }));
    if (souLider()) {
      foot.appendChild(btn(tr('Próxima sala (com {a})', { a: esc(nome) }), 'btn-primary', function () {
        if (!safe(function () { return Cp().proxima(); }, false)) toast(tr('Não deu para avançar.'));
      }));
      return 'lider';
    }
    var ses = coopSessao();
    if (ses && ses.proximaLiberada) {
      // 11/09 (revisão): quem lidera já está na antessala da próxima sala, esperando
      foot.appendChild(el('p', 'foot-count', tr('{a} abriu a próxima sala e espera você lá.', { a: esc(nome) })));
      foot.appendChild(btn(tr('Seguir para a próxima sala'), 'btn-primary', function () {
        if (!safe(function () { return Cp().seguir(); }, false)) toast(tr('Não deu para seguir.'));
      }));
    } else {
      foot.appendChild(btn(tr('Esperando {a} abrir a próxima sala…', { a: esc(nome) }), 'btn-primary is-apagado', function () {
        toast(tr('Quem lidera ({nome}) abre a próxima sala.', { nome: nome }));
      }));
    }
    return 'parceiro';
  }

  // ------------------------------------------------ o duelo pela Rede (4.9)
  var dueloEscolha = [], dueloDid = null, dueloRelogio = null;
  function sheetDueloRede() {
    var est = safe(function () { return Dl().estado(); }, null);
    if (!est || est.fase === 'livre' || est.fase === 'desafiei' || est.fase === 'desafiado') {
      if (sheetName === 'dueloRede') closeSheet();
      return;
    }
    if (est.did !== dueloDid) { dueloDid = est.did; dueloEscolha = []; }
    var nome = (est.oponente && est.oponente.nome) || tr('o outro lado');
    // 14/09: por aqui só passa o desafio amistoso (a Arena e o Campo escolhem sozinhos)
    var body = sheetShell(tr('Desafio amistoso com {nome}', { nome: nome }), est.escolhi
      ? tr('A sua dupla está guardada. Mapa: A Praça — a coroa não muda.')
      : tr('Mapa: A Praça — a coroa não muda. Escolha 1 ou 2 heróis seus: {a} não vê a sua dupla até as duas estarem escolhidas.', { a: esc(nome) }));
    sheetName = 'dueloRede';
    var caixa = el('div', 'ms-caixa du-rede');
    body.appendChild(caixa);
    if (est.fase === 'batalha') {
      caixa.appendChild(el('p', 'du-espera', (est.modo === 'desafio' ? tr('Mapa: <b>') : tr('Arena sorteada: <b>')) +
        esc(est.arena ? est.arena.nome : '') + '</b>. Abrindo…'));
      return;
    }
    function carta(hid, marcada, clicavel) {
      var h = hero(hid) || {};
      var cid = h.classId || hid;
      // 14/09: a vida única — o herói ferido mostra a barra, e o que está a 0 fica apagado
      var vd = safe(function () { return G().vidaNaEspera([hid])[0]; }, null);
      var card = el('button', 'av-carta' + (marcada ? ' is-on' : '') + (vd && vd.hp < 1 ? ' is-zero' : ''));
      card.type = 'button';
      card.appendChild(art('portrait', [cid, { element: h.element || 'neutro', size: 168 }], 84, 'av-pic'));
      card.appendChild(el('span', 'av-nome', esc(className(cid)) + '<small>nv ' + (h.level || 1) + '</small>'));
      if (vd && vd.hp < vd.max) {
        var vbar = el('span', 'av-vida'), vfill = el('i');
        vfill.style.width = Math.round(100 * vd.hp / vd.max) + '%';
        vbar.appendChild(vfill);
        vbar.title = vd.hp + '/' + vd.max + tr(' PV');
        card.appendChild(vbar);
      }
      if (clicavel) {
        tap(card, function () {
          var i = dueloEscolha.indexOf(hid);
          if (i >= 0) dueloEscolha.splice(i, 1);
          else if (dueloEscolha.length < 2) dueloEscolha.push(hid);
          else { toast(tr('A dupla é de dois, no máximo.')); return; }
          sheetDueloRede();
        });
      }
      return card;
    }
    var fila = el('div', 'av-fila');
    if (est.escolhi) {
      (est.minhaDupla || []).forEach(function (hid) { fila.appendChild(carta(hid, true, false)); });
      caixa.appendChild(fila);
      caixa.appendChild(el('p', 'du-espera', est.eleEscolheu ? tr('Revelando as duplas…')
        : tr('Esperando {a} escolher… <b class="du-relogio"></b>', { a: esc(nome) })));
    } else {
      var herois = safe(function () { return Dl().herois(); }, []) || [];
      dueloEscolha = dueloEscolha.filter(function (h) { return herois.indexOf(h) >= 0; });
      herois.forEach(function (hid) { fila.appendChild(carta(hid, dueloEscolha.indexOf(hid) >= 0, true)); });
      if (!herois.length) fila.appendChild(el('p', 'empty', tr('Nenhum herói seu pode duelar.')));
      caixa.appendChild(fila);
      caixa.appendChild(el('p', 'du-espera', tr('Tempo para escolher: <b class="du-relogio"></b>')));
      var pronto = dueloEscolha.length >= 1;
      var rotuloPronto = tr('Pronto{a}', { a: pronto ? ' (' + dueloEscolha.length + ')' : '' });
      var bPronto = btn(rotuloPronto, 'btn-primary btn-block du-pronto' + (pronto ? '' : ' is-off'), function () {
        // 14/09: herói a 0 PV não entra no duelo — o botão espera como a porta da sala
        var evD = dueloEscolha.length ? safe(function () { return G().esperaVida(dueloEscolha.slice()); }, null) : null;
        if (evD) { toast(tr('{a} — ou beba uma poção.', { a: textoEsperaVida(evD) })); return; }
        var r = safe(function () { return Dl().escolher(dueloEscolha.slice()); }, null);
        if (r && r.ok && r.esperando) { vidaTique(); return; }
        if (r && !r.ok && r.motivo === 'vida-zero') {
          toast(tr('Esse herói está sem vida: espere {a} s ou beba uma poção.', { a: r.esperaS || 1 }));
          return;
        }
        if (!r || !r.ok) toast(textoMotivo(r ? r.motivo : 'ocupado', null));
      });
      bPronto.setAttribute('data-rotulo', rotuloPronto);
      caixa.appendChild(bPronto);
      caixa.appendChild(vidaBloco('duelo'));   // 14/09: a vida dos heróis que podem duelar, com as poções
      vidaTique();
    }
    caixa.appendChild(btn(tr('Desistir do duelo'), 'btn-ghost btn-block', function () {
      safe(function () { return Dl().cancelar('desistiu'); }, null);
      closeSheet();
    }));
    function anda() {
      var rel = sheetEl && sheetEl.querySelector('.du-relogio');
      if (sheetName !== 'dueloRede' || !rel) { clearInterval(dueloRelogio); dueloRelogio = null; return; }
      var e2 = safe(function () { return Dl().estado(); }, null);
      var agora = safe(function () { return Dl()._agora(); }, Date.now());
      rel.textContent = e2 && e2.prazo ? relogioTxt(e2.prazo - agora) : '';
    }
    if (dueloRelogio) clearInterval(dueloRelogio);
    dueloRelogio = setInterval(anda, 500);
    anda();
  }
  /* ======================================================= 14/09: A ARENA E O CAMPO DE PVP NA TELA
   * O dono: "na inscrição de pvp onde ele se inscreve na arena para esperar que alguém aceite o desafio... esse
   * ele pré-seleciona as duas classes já e quem vai desafiar consegue ver.. essa inscrição dá ranking na coroa
   * também"; e o Campo: "esse mapa os jogadores só vão entrar com a coroa ligada e lá não poderá desligar, e lá
   * ao clicar em cima o jogador pode atacar sem aviso prévio", com a dupla em ordem — "sendo o 1º a selecionar
   * que fica a aparência e o segundo fica selecionado, é o elemento surpresa pro inimigo". */
  function Ar() { return JOGO.Arena || null; }
  var arenaRelogio = null, arenaSig = '';
  var campoHud = { dentro: false, dupla: [] };
  function campoDentro() {
    var H = JOGO.Hub;
    return !!(H && typeof H.naCampo === 'function' && safe(function () { return H.naCampo(); }, false));
  }
  function aparenciaDe(hid) { var h = hid ? hero(hid) : null; return (h && h.classId) || hid || 'sumo'; }
  function aparenciaDaRede() {
    return (campoDentro() && campoHud.dupla[0]) ? aparenciaDe(campoHud.dupla[0]) : (selHeroes[0] || 'sumo');
  }
  function forteDeIds(ids) {
    var m = 1;
    (ids || []).forEach(function (hid) { var h = hero(hid); if (h && (h.level || 1) > m) m = h.level || 1; });
    return m;
  }
  function forteDaVez() { return forteDeIds((campoDentro() && campoHud.dupla.length) ? campoHud.dupla : selHeroes); }
  function agoraArena() { return safe(function () { return Ar()._agora(); }, Date.now()); }
  function coroaNome(pts) {
    var t = safe(function () { return JOGO.Brasa.tierDe(pts, false); }, null);
    return (t && t.nome) || 'Coroa I';
  }
  function nomesDupla(classes) {
    return (classes || []).map(function (c) { return className((c && c.classId) || '?') + tr(' nv ') + ((c && c.nivel) || 1); }).join(tr(' e '));
  }
  function nomeHeroiNv(hid) { var h = hero(hid) || {}; return className(h.classId || hid) + tr(' nv ') + (h.level || 1); }

  /* ESCOLHA OS DOIS HERÓIS (a ficha reaproveitável: a Arena, o Campo e — depois — a guerra de guilda 2×2).
   * op = { titulo, sub, rotulo, inicial: [ids], ordem: bool (diz o que é o 1º), aoEscolher(ids) }. Pede
   * DOIS (um só quando a conta só tem um herói que pode lutar), na ordem dos toques, e espera a vida. */
  var escolhaDupla = { op: null, ids: [] };
  function sheetEscolheDupla(op) {
    if (op && op !== escolhaDupla.op) {
      escolhaDupla.op = op;
      escolhaDupla.ids = [];
      (op.inicial || []).forEach(function (h) {
        if (h && escolhaDupla.ids.length < 2 && escolhaDupla.ids.indexOf(h) < 0) escolhaDupla.ids.push(h);
      });
    }
    op = escolhaDupla.op || {};
    var herois = safe(function () { return Dl().herois(); }, []) || [];
    escolhaDupla.ids = escolhaDupla.ids.filter(function (h) { return herois.indexOf(h) >= 0; });
    var precisa = Math.min(2, herois.length);
    var body = sheetShell(op.titulo || tr('Escolha os dois heróis'), op.sub || tr('Toque na ordem: o 1º e o 2º.'));
    sheetName = 'escolheDupla';
    var caixa = el('div', 'ms-caixa du-rede dupla-escolha');
    body.appendChild(caixa);
    var fila = el('div', 'av-fila');
    herois.forEach(function (hid) {
      fila.appendChild(cartaDupla(hid, escolhaDupla.ids.indexOf(hid), function () {
        var j = escolhaDupla.ids.indexOf(hid);
        if (j >= 0) escolhaDupla.ids.splice(j, 1);
        else if (escolhaDupla.ids.length < 2) escolhaDupla.ids.push(hid);
        else { toast(tr('São dois: tire um antes de pôr outro.')); return; }
        sheetEscolheDupla();
      }));
    });
    if (!herois.length) fila.appendChild(el('p', 'empty', tr('Nenhum herói seu pode lutar.')));
    caixa.appendChild(fila);
    if (herois.length === 1) caixa.appendChild(el('p', 'du-espera', tr('Você só tem um herói que pode lutar: ele vai sozinho.')));
    else if (op.ordem) caixa.appendChild(el('p', 'du-espera', tr('O <b>1º</b> é o que todos veem; o <b>2º</b> fica em segredo até a luta.')));
    var pronto = precisa > 0 && escolhaDupla.ids.length >= precisa;
    var rot = (op.rotulo || tr('Pronto')) + (pronto ? '' : ' (' + escolhaDupla.ids.length + '/' + precisa + ')');
    caixa.appendChild(btn(rot, 'btn-primary btn-block dupla-pronto' + (pronto ? '' : ' is-off'), function () {
      if (!pronto) { toast(precisa > 1 ? tr('Escolha os dois heróis.') : tr('Escolha o herói.')); return; }
      // 10/10: `semVida` — a inscrição no Torneio não espera a vida (a luta de lá começa com a vida cheia)
      var ev = op.semVida ? null : safe(function () { return G().esperaVida(escolhaDupla.ids.slice()); }, null);
      if (ev) { toast(tr('{a} — ou beba uma poção.', { a: textoEsperaVida(ev) })); return; }
      if (typeof op.aoEscolher === 'function') safe(function () { return op.aoEscolher(escolhaDupla.ids.slice()); }, null);
    }));
    // 10/10: `aoCancelar` — quem abriu a escolha de dentro de outra ficha (o Torneio) volta para ela
    caixa.appendChild(btn(tr('Cancelar'), 'btn-ghost btn-block', function () {
      if (typeof op.aoCancelar === 'function') op.aoCancelar(); else closeSheet();
    }));
  }
  UI.escolheDupla = function (op) { openSheet('escolheDupla', op); };
  function cartaDupla(hid, ordem, aoTocar) {
    var h = hero(hid) || {};
    var cid = h.classId || hid;
    var vd = safe(function () { return G().vidaNaEspera([hid])[0]; }, null);
    var card = el('button', 'av-carta' + (ordem >= 0 ? ' is-on' : '') + (vd && vd.hp < 1 ? ' is-zero' : ''));
    card.type = 'button';
    card.setAttribute('data-heroi', hid);
    card.appendChild(art('portrait', [cid, { element: h.element || 'neutro', size: 168 }], 84, 'av-pic'));
    card.appendChild(el('span', 'av-nome', esc(className(cid)) + '<small>nv ' + (h.level || 1) + '</small>'));
    if (ordem >= 0) card.appendChild(el('b', 'dupla-ordem', (ordem + 1) + 'º'));
    if (vd && vd.hp < vd.max) {
      var vbar = el('span', 'av-vida'), vfill = el('i');
      vfill.style.width = Math.round(100 * vd.hp / vd.max) + '%';
      vbar.appendChild(vfill);
      vbar.title = vd.hp + '/' + vd.max + tr(' PV');
      card.appendChild(vbar);
    }
    tap(card, aoTocar);
    return card;
  }

  // ---- a Arena: o bloco do painel do lugar, a inscrição e o quadro
  function textoArena(r) {
    if (!r) return tr('A Arena não respondeu.');
    var m = r.motivo;
    if (m === 'vida-zero') return tr('Um herói da dupla está sem vida{a} ou beba uma poção.', { a: r.esperaS ? ': espere ' + r.esperaS + ' s' : '' });
    if (m === 'vida-zero-alvo') return tr('Um herói dessa inscrição está sem vida agora.');
    if (m === 'paridade') return tr('A diferença de nível entre os heróis mais fortes passa de {a}: não vale.', { a: paridadeArena() });
    if (m === 'sem-inscricao') return tr('Essa inscrição saiu do quadro.');
    if (m === 'inscrito') return tr('Saia da sua inscrição antes de desafiar outra.');
    if (m === 'casada') return tr('Você já tem uma partida da Arena em andamento.');
    if (m === 'sem-partida') return tr('O prazo da partida passou.');
    if (r.erro && ['sem-sessao', 'arquivo', 'servidor', 'rede', 'arena'].indexOf(m) >= 0) return r.erro;
    return textoMotivo(m, null);
  }
  function painelArena(p) {
    var A = Ar();
    if (!A) return;
    var e = A.estado();
    var caixa = el('div', 'arena-bloco');
    p.appendChild(caixa);
    caixa.appendChild(el('h4', 'arena-sec', tr('Ranqueado')));          // 10/10: o painel em blocos com nome
    caixa.appendChild(el('p', 'hub-nota arena-sub', tr('Vale coroa. Inscreva a dupla e espere um desafio, ou desafie quem está no quadro.')));
    if (e.desligada) { caixa.appendChild(el('p', 'hub-nota arena-off', '⚔ ' + esc(e.desligada))); return; }
    if (e.fase === 'livre') {
      caixa.appendChild(btn(tr('Inscrever minha dupla'), 'btn-gold btn-block arena-inscrever', pedeInscricao));
    } else if (e.fase === 'inscrito') {
      caixa.appendChild(el('p', 'hub-nota arena-inscrito', tr('Inscrito com <b>{a}</b> · esperando há <b class="arena-relogio" data-desde="{desdeMs}">{b}</b>. Pode andar pela praça.', { a: esc(nomesDupla(e.classes)), desdeMs: e.desdeMs, b: relogioTxt(agoraArena() - e.desdeMs) })));
      caixa.appendChild(btn(tr('Sair da inscrição'), 'btn-warn btn-block arena-sair', function () {
        A.sair();
        toast(tr('Você saiu do quadro da Arena.'));
      }));
    } else if (e.fase === 'casada') {
      caixa.appendChild(btn(tr('Ver o adversário encontrado'), 'btn-gold btn-block', function () { mostraArenaCasada(A.estado()); }));
    } else if (e.fase === 'pronta') {
      caixa.appendChild(el('p', 'hub-nota', tr('Partida pronta — a luta abre em instantes…')));
    }
    caixa.appendChild(btn(tr('Ver o quadro de inscritos'), 'btn-ghost btn-block arena-ver-quadro', function () { openSheet('arenaQuadro'); }));
  }
  function pedeInscricao() {
    openSheet('escolheDupla', { titulo: tr('Inscrição na Arena'), rotulo: tr('Inscrever no quadro'),
      sub: tr('Escolha os dois heróis, em ordem. Quem olhar o quadro vê as duas classes — e quem desafiar mostra as dele. Vale coroa.'),
      inicial: selHeroes.slice(),
      aoEscolher: function (ids) {
        return Ar().inscrever(ids).then(function (r) {
          if (r.ok) { closeSheet(); toast(tr('A sua dupla está no quadro da Arena. Pode andar pela praça esperando.'), 'good'); repintaLugar(); }
          else toast(textoArena(r));
          return r;
        });
      } });
  }
  var quadroArena = { lista: null, erro: null, pedindo: false, t: 0, paridade: null };
  /* 03/10 (o dono): a paridade da Arena é 3 níveis. Quem decide é o servidor (PARIDADE['arena'] em
   * servidor/grupo.py): o número que o quadro devolveu vale primeiro, o do cliente (Arena.PARIDADE) até ele
   * chegar — nenhum texto da tela crava o número. */
  function paridadeArena() {
    return quadroArena.paridade || (Ar() && Ar().PARIDADE) || 3;
  }
  function sheetArenaQuadro(semPedir) {
    var A = Ar();
    var body = sheetShell(tr('Quadro da Arena'), tr('Quem espera desafio. Vale coroa: até {a} níveis entre os heróis mais fortes de cada lado.', { a: paridadeArena() }));
    sheetName = 'arenaQuadro';
    abasArena(body, 'arenaQuadro');      // 10/10: a Arena tem duas abas — os desafios e o Torneio
    var caixa = el('div', 'ms-caixa arena-quadro');
    body.appendChild(caixa);
    var e = A ? A.estado() : { desligada: tr('A Arena não carregou.') };
    if (e.desligada) { caixa.appendChild(el('p', 'empty arena-off', esc(e.desligada))); return; }
    var meu = forteDeIds(selHeroes);
    caixa.appendChild(el('p', 'du-espera', tr('A sua dupla escolhida chega a <b>nv {meu}</b>: quem está fora da paridade fica apagado.', { meu: meu })));
    if (e.fase === 'livre') caixa.appendChild(btn(tr('Inscrever minha dupla'), 'btn-gold btn-block', pedeInscricao));
    else if (e.fase === 'inscrito') caixa.appendChild(el('p', 'hub-nota', tr('Você está no quadro — espere um desafio.')));
    var lista = el('div', 'aq-lista');
    caixa.appendChild(lista);
    if (quadroArena.lista === null) lista.appendChild(el('p', 'empty', quadroArena.erro ? esc(quadroArena.erro) : tr('Lendo o quadro…')));
    else if (!quadroArena.lista.length) lista.appendChild(el('p', 'empty', tr('Ninguém inscrito agora. Inscreva a sua dupla e espere um desafio!')));
    else quadroArena.lista.forEach(function (x) { lista.appendChild(linhaQuadro(x, meu, e)); });
    if (!semPedir) atualizaQuadro();
  }
  function atualizaQuadro() {
    var A = Ar();
    if (!A || quadroArena.pedindo) return;
    quadroArena.pedindo = true;
    quadroArena.t = Date.now();
    A.quadro().then(function (r) {
      quadroArena.pedindo = false;
      if (r && r.ok) {
        quadroArena.lista = r.inscritos; quadroArena.erro = null;
        if (typeof r.paridade === 'number' && r.paridade > 0) quadroArena.paridade = r.paridade;
      }
      else quadroArena.erro = (r && r.erro) || tr('o servidor não respondeu');
      if (sheetName === 'arenaQuadro') sheetArenaQuadro(true);
    });
  }
  function linhaQuadro(x, meu, e) {
    var par = paridadeArena();
    var fora = !x.eu && Math.abs(meu - x.nivel) > par;
    var ln = el('div', 'aq-linha' + (x.eu ? ' is-eu' : '') + (fora ? ' is-fora' : ''));
    ln.setAttribute('data-conta', String(x.conta));
    ln.appendChild(art('portrait', [((x.classes[0] || {}).classId) || 'sumo', { element: 'neutro', size: 48 }], 36));
    var tx = el('div', 'aq-tx');
    tx.appendChild(el('b', 'aq-nome', esc(x.nome) + ' <small>nv ' + x.nivel + ' · ' + esc(coroaNome(x.brasa)) + '</small>'));
    tx.appendChild(el('span', 'aq-dupla', esc(nomesDupla(x.classes))));
    tx.appendChild(el('span', 'aq-desde', tr('esperando há {a}', { a: relogioTxt(agoraArena() - x.desdeMs) })));
    ln.appendChild(tx);
    if (x.eu) ln.appendChild(el('span', 'aq-tag', tr('sua inscrição')));
    else if (fora) {
      ln.appendChild(btn(tr('Fora da paridade'), 'btn-mini btn-ghost is-apagado aq-desafiar', function () {
        toast(tr('A diferença de nível passa de {par} (você nv {meu}, {nome} nv {nivel}): não vale.', { par: par, meu: meu, nome: x.nome, nivel: x.nivel }));
      }));
    } else if (e.fase !== 'livre') {
      ln.appendChild(btn(tr('Desafiar'), 'btn-mini btn-ghost is-apagado aq-desafiar', function () {
        toast(e.fase === 'inscrito' ? tr('Saia da sua inscrição antes de desafiar outra.') : tr('Você já tem uma partida da Arena em andamento.'));
      }));
    } else ln.appendChild(btn(tr('Desafiar'), 'btn-mini btn-gold aq-desafiar', function () { pedeDesafioArena(x); }));
    return ln;
  }
  function pedeDesafioArena(x) {
    openSheet('escolheDupla', { titulo: tr('Desafiar {nome}', { nome: x.nome }), rotulo: tr('Desafiar'),
      sub: tr('A dupla de {a}: <b>{b}</b> (nv {nivel}). Escolha os seus dois — {a} vê as suas classes antes de confirmar.', { a: esc(x.nome), b: esc(nomesDupla(x.classes)), nivel: x.nivel }),
      inicial: selHeroes.slice(),
      aoEscolher: function (ids) {
        var nv = forteDeIds(ids);
        if (Math.abs(nv - x.nivel) > paridadeArena()) {
          toast(tr('Com essa dupla (nv {nv}) a diferença para nv {nivel} passa do limite.', { nv: nv, nivel: x.nivel }));
          return null;
        }
        return Ar().desafiar(x.conta, ids).then(function (r) {
          if (r.ok) { closeSheet(); toast(tr('Desafio enviado a {nome}. Os dois confirmam em 30 s.', { nome: x.nome }), 'good'); }
          else { toast(textoArena(r)); if (r.motivo === 'sem-inscricao' || r.motivo === 'paridade') atualizaQuadro(); }
          return r;
        });
      } });
  }
  /* a partida casada: "Adversário encontrado: Nome · nv X · Coroa Y — Confirmar (30 s)" — no painel, em qualquer
   * ponto da praça (o inscrito estava andando) */
  function mostraArenaCasada(e) {
    e = e || (Ar() && Ar().estado());
    if (!e || e.fase !== 'casada') return;
    var p = abrePainel('convite');
    if (!p) { toast(tr('Arena: adversário encontrado — confirme o duelo na praça!')); return; }
    painelConv = { tipo: 'arena' };
    pintaArenaCasada(p, e);
    if (sheetName) toast(tr('Adversário encontrado na Arena — veja o painel'));
  }
  function pintaArenaCasada(p, e) {
    clear(p);
    p.classList.add('arena-casada');
    var ad = e.adversario || { classes: [] };
    cabecalhoPainel(p, ((ad.classes[0] || {}).classId) || 'sumo', 'neutro',
      tr('Adversário encontrado: <b>{a}</b> · nv {nivel} · {b}', { a: esc(ad.nome), nivel: ad.nivel, b: esc(coroaNome(ad.brasa)) }),
      e.papel === 'inscrito' ? tr('desafiou a sua inscrição') : tr('você desafiou'));
    p.appendChild(el('p', 'hub-nota', tr('A dupla de {a}: <b>{b}</b>.<br>A sua: <b>{c}</b>. Vale coroa; o mapa é sorteado.', { a: esc(ad.nome), b: esc(nomesDupla(ad.classes)), c: esc(nomesDupla(e.classes)) })));
    p.appendChild(barraPrazo(e.prazoMs, agoraArena));
    var resta = Math.max(0, Math.ceil((e.prazoMs - agoraArena()) / 1000));
    if (e.confirmei) {
      p.appendChild(el('p', 'du-espera', tr('Você confirmou. Esperando {a}… <b class="arena-relogio" data-prazo="{prazoMs}">{resta} s</b>', { a: esc(ad.nome), prazoMs: e.prazoMs, resta: resta })));
      p.appendChild(btn(tr('Desistir'), 'btn-ghost btn-block', function () { Ar().recusar(); fechaPainel(); }));
    } else {
      var duo = el('div', 'pn-duplo');
      var bOk = btn('Confirmar (' + resta + ' s)', 'btn-primary arena-confirma', function () {
        Ar().confirmar().then(function (r) { if (!r.ok) toast(textoArena(r)); });
      });
      bOk.setAttribute('data-prazo', String(e.prazoMs));
      duo.appendChild(bOk);
      duo.appendChild(btn(tr('Recusar'), 'btn-ghost arena-recusa', function () { Ar().recusar(); fechaPainel(); }));
      p.appendChild(duo);
    }
    if (e.eleConfirmou) p.appendChild(el('p', 'du-espera', tr('{a} já confirmou.', { a: esc(ad.nome) })));
  }
  function aoArenaMudou(e) {
    e = e || {};
    var sig = [e.fase, e.confirmei, e.eleConfirmou, e.did, (e.herois || []).join('+'), !!e.desligada].join('|');
    var mudou = sig !== arenaSig;
    arenaSig = sig;
    pintaSeloArena();
    if (!mudou) return;
    if (painelModo === 'convite' && painelConv && painelConv.tipo === 'arena') {
      var pv = painelVivo();
      if (e.fase === 'casada' && pv) pintaArenaCasada(pv, e);
      else fechaPainel();
    }
    if (painelModo === 'lugar' && painelLugar && painelLugar.tipo === 'arena') repintaLugar();
    if (sheetName === 'arenaQuadro') sheetArenaQuadro(true);
  }
  /* O SELO pequeno no canto da praça: inscrito na Arena (e há quanto tempo), o adversário encontrado, o Campo */
  function pintaSeloArena() {
    var s = safe(function () { return screens.hub; }, null);
    if (!s) return;
    var e = Ar() ? Ar().estado() : null, txt = '';
    if (e && e.fase === 'inscrito') txt = tr('⚔ Arena · inscrito {a}', { a: relogioTxt(agoraArena() - e.desdeMs) });
    else if (e && e.fase === 'casada') txt = tr('⚔ Arena · adversário encontrado!');
    else if (e && e.fase === 'pronta') txt = tr('⚔ Arena · abrindo a luta…');
    if (campoDentro()) txt = tr('{a}☠ Campo de PvP', { a: txt ? txt + ' · ' : '' });
    var selo = s.querySelector('.arena-selo');
    if (!txt) { if (selo && selo.parentNode) selo.parentNode.removeChild(selo); return; }
    if (!selo) {
      selo = el('button', 'arena-selo');
      selo.type = 'button';
      tap(selo, function () {
        var e2 = Ar() && Ar().estado();
        if (e2 && e2.fase === 'casada') mostraArenaCasada(e2);
        else if (e2 && e2.fase !== 'livre') openSheet('arenaQuadro');
      });
      s.appendChild(selo);
    }
    if (selo.textContent !== txt) selo.textContent = txt;
  }
  function tiqueArenaTela() {
    pintaSeloArena();
    safe(function () { tiqueTorneioTela(); return true; }, null);     // 10/10: a chamada do Torneio e as contagens
    var agora = agoraArena();
    [].forEach.call(document.querySelectorAll('.arena-relogio[data-desde]'), function (x) {
      x.textContent = relogioTxt(agora - Number(x.getAttribute('data-desde')));
    });
    [].forEach.call(document.querySelectorAll('.arena-relogio[data-prazo], .arena-confirma[data-prazo]'), function (x) {
      var sg = Math.max(0, Math.ceil((Number(x.getAttribute('data-prazo')) - agora) / 1000));
      x.textContent = x.classList.contains('arena-confirma') ? 'Confirmar (' + sg + ' s)' : sg + ' s';
    });
    if (sheetName === 'arenaQuadro' && Date.now() - quadroArena.t > 4000) atualizaQuadro();
    // 19/09: a contagem do W.O. no topo da guerra anda a cada segundo (o paintBattle só repinta quando o estado muda)
    if (current === 'battle' && bt && bt.guerra) {
      var gq = safe(function () { return (Cp().sessao() || {}).guerra; }, null);
      if (gq && gq.wo && gq.wo.desde) pintaGuerraTopo();
    }
  }

  /* ======================================================= 10/10: O TORNEIO DA ARENA NA TELA
   * O dono: "a arena é o maior item do mapa e tem que ir além de procurar desafios, deve ter torneio; todo sábado
   * terá torneio de PvP e todo domingo torneio de guilda (ou quando o adm marcar)". Quem decide é o servidor e o
   * JOGO.Torneio (js/core/torneio.js) é o cliente dele (docs/TORNEIO.md é o contrato); aqui só se desenha:
   *   · a ficha 'torneio' — a segunda aba da Arena (a primeira é o quadro de desafios): os próximos torneios
   *     (as duas faixas do PvP e o de guilda) com a data no fuso do jogador, a contagem, as vagas que abrem aos
   *     pares, o prêmio de agora e o do torneio cheio, os inscritos, inscrever/trocar/sair; depois do sorteio, a
   *     CHAVE (uma coluna por rodada, quem passou, W.O./passe/sorteio marcados, a previsão de cada luta, a minha
   *     linha destacada); para a guilda, os voluntários e a escolha do representante;
   *   · a CHAMADA — um cartão fora das telas e por cima das fichas, que não some enquanto a luta está sendo
   *     chamada: "Sua luta do torneio: contra X — Estou aqui", os 3 minutos correndo, quem já confirmou, e o
   *     aviso de que a luta vai começar (a luta em si é o duelo de sempre, pela Arena);
   *   · o fim: a tela do campeão (o prêmio recebido) e um aviso para os outros. */
  function Tn() { return JOGO.Torneio || null; }
  var torneioHud = { sel: null, sig: '', lutaSig: '', pendente: null, t: 0, guildaSig: '' };
  var torneioEl = null;
  function agoraTorneio() { return safe(function () { return Tn().agora(); }, Date.now()); }
  function minhaContaTorneio() { return safe(function () { return JOGO.Sessao.contaId(); }, null); }
  function doisT(n) { return (n < 10 ? '0' : '') + n; }
  /* a data e a hora no fuso do APARELHO (o servidor marca em Brasília; quem joga de fora lê a sua hora) */
  function quandoTorneio(ms) {
    var d = new Date(ms);
    var dias = [tr('dom'), tr('seg'), tr('ter'), tr('qua'), tr('qui'), tr('sex'), tr('sáb')];
    return dias[d.getDay()] + ' ' + doisT(d.getDate()) + '/' + doisT(d.getMonth() + 1) + ' · ' + horaTorneio(ms);
  }
  function horaTorneio(ms) { var d = new Date(ms); return doisT(d.getHours()) + ':' + doisT(d.getMinutes()); }
  function faltaTorneio(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d > 0) return tr('{d} d {h} h', { d: d, h: h });
    if (h > 0) return tr('{h} h {m} min', { h: h, m: m });
    if (m > 0) return tr('{m} min', { m: m });
    return tr('menos de 1 min');
  }
  function nomeTorneio(t) {
    if (t.origem === 'mestre' && t.titulo) return t.titulo;
    return t.tipo === 'guilda' ? tr('Torneio das Guildas')
                               : tr('Torneio de PvP · nível {a} a {b}', { a: t.nivelMin, b: t.nivelMax });
  }
  /* "5 de 8 — enche e abrem mais 8": as vagas abrem aos pares (2 → 4 → 8 → 16, o teto) */
  function textoVagas(t) {
    var n = t.inscritos.length;
    if (t.vagas >= 16) return n >= 16 ? tr('{n} de 16 — cheio', { n: n }) : tr('{n} de 16 — é o teto', { n: n });
    return tr('{n} de {v} — enche e abrem mais {v}', { n: n, v: t.vagas });
  }
  function textoPremio(p, t, cheio) {
    var partes = [];
    if (p.barras) partes.push(tr('{n} barra(s) de ouro', { n: p.barras }));
    if (p.vintens) partes.push(tr('{n} vinténs', { n: p.vintens }));
    if (p.gemas) partes.push(tr('{n} Gema(s) Enterrada(s)', { n: p.gemas }));
    if (t.tipo === 'guilda') {
      if (p.xpGuilda) partes.push(tr('{n} XP para a guilda', { n: p.xpGuilda }));
      if (!cheio) partes.push(tr('XP em dobro para todos os membros por 7 dias'));
      if (p.conquista) partes.push(tr('o título Campeão das Guildas e a marca na placa'));
    } else {
      if (p.conquista) partes.push(tr('conta como conquista (título)'));
      if (p.moldura) partes.push(tr('a moldura Campeão da Arena'));
    }
    return partes.length ? partes.join(' · ') : tr('sem prêmio');
  }
  /* o que o torneio está fazendo agora, com a contagem (o <b> anda a cada segundo: tiqueTorneioTela) */
  function linhaEstado(t) {
    var agora = agoraTorneio();
    if (t.estado === 'cancelado') return tr('Cancelado.');
    if (t.estado === 'encerrado') return t.campeao ? tr('Encerrado — campeão: <b>{a}</b>', { a: esc(nomeNaChave(t, t.campeao)) }) : tr('Encerrado.');
    if (t.estado === 'andamento') {
      return tr('Em andamento — {a}', { a: esc(Tn().nomeDaRodada(t.chave ? t.chave.tamanho : 2, t.chave ? t.chave.rodada : 0)) });
    }
    if (t.estado === 'sorteado') {
      return tr('Chave sorteada — começa em <b class="tor-rel" data-ate="{ms}">{a}</b>', { ms: t.inicioMs, a: faltaTorneio(t.inicioMs - agora) });
    }
    if (t.inscricaoAteMs > agora) {
      return tr('Inscrições abertas — fecham em <b class="tor-rel" data-ate="{ms}">{a}</b>', { ms: t.inscricaoAteMs, a: faltaTorneio(t.inscricaoAteMs - agora) });
    }
    return tr('Inscrições fechadas — o sorteio sai em instantes.');
  }
  function nomeNaChave(t, p) {
    if (!p) return '';
    return (t.tipo === 'guilda' && p.guilda && p.guilda.nome) ? p.guilda.nome : p.nome;
  }
  /* as duas abas da Arena: o quadro de desafios e o torneio */
  function abasArena(body, qual) {
    var abas = el('div', 'abas-fila arena-abas');
    [['arenaQuadro', tr('Desafios')], ['torneio', tr('Torneio')]].forEach(function (a) {
      var on = qual === a[0];
      var b = btn(a[1], 'btn-tab' + (on ? ' is-on' : ''), function () { if (!on) openSheet(a[0]); });
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('data-aba', a[0]);
      abas.appendChild(b);
    });
    body.appendChild(abas);
  }
  /* o bloco do painel da Arena (o lugar da praça): o próximo torneio numa linha e a porta para a ficha */
  function painelTorneio(p) {
    var T = Tn();
    if (!T) return;
    var caixa = el('div', 'arena-bloco tor-bloco');
    p.appendChild(caixa);
    var e = T.estado();
    caixa.appendChild(el('h4', 'arena-sec', tr('Torneio')));             // 10/10: o painel em blocos com nome
    var nProx = 0;
    if (!e.desligado) {
      safe(function () { T.busca(); return true; }, null);
      var prox = T.proximos();
      nProx = prox.length;
      // só o PRÓXIMO, numa linha (eram três linhas iguais; a lista inteira mora na ficha)
      if (prox.length) {
        caixa.appendChild(el('p', 'hub-nota tor-linha',
          tr('Próximo: <b>{a}</b> · {b}', { a: esc(nomeTorneio(prox[0])), b: esc(quandoTorneio(prox[0].inicioMs)) }) + '<br>' +
          esc(tr('{n} de {v} vagas preenchidas', { n: prox[0].inscritos.length, v: prox[0].vagas }))));
      } else caixa.appendChild(el('p', 'hub-nota tor-linha', e.semRota ? esc(e.erro || '') : tr('Todo sábado (PvP) e todo domingo (guildas), às 14:00 de Brasília.')));
    }
    caixa.appendChild(btn(nProx > 1 ? tr('Ver os {n} torneios', { n: nProx }) : tr('Ver o torneio'), 'btn-gold btn-block arena-torneio', function () { openSheet('torneio'); }));
  }

  // ---- a ficha do torneio
  function sheetTorneio(arg) {
    var T = Tn();
    if (arg && typeof arg === 'object' && arg.id !== undefined) torneioHud.sel = arg.id;
    else if (arg === 'lista') torneioHud.sel = null;
    // o redesenho no lugar (arg === true: a lista mudou com a ficha aberta) não joga a rolagem para o topo
    var rolagem = (arg === true && sheetEl) ? safe(function () { return sheetEl.querySelector('.sheet-body').scrollTop; }, 0) : 0;
    var body = sheetShell(tr('Torneio da Arena'), tr('Todo sábado, PvP em duas faixas de nível; todo domingo, as guildas. As chaves são sorteadas e ficam públicas no site.'));
    sheetName = 'torneio';
    abasArena(body, 'torneio');
    var caixa = el('div', 'ms-caixa tor-ficha');
    body.appendChild(caixa);
    if (!T) { caixa.appendChild(el('p', 'empty', tr('O Torneio não carregou.'))); return; }
    var e = T.estado();
    if (e.desligado) { caixa.appendChild(el('p', 'empty arena-off', esc(e.desligado))); return; }
    if (!e.lido) {
      caixa.appendChild(el('p', 'empty', e.erro ? esc(e.erro) : tr('Lendo os torneios…')));
      if (arg !== true) atualizaTorneio(true);
      return;
    }
    var sel = torneioHud.sel != null ? T.torneio(torneioHud.sel) : null;
    if (torneioHud.sel != null && !sel) torneioHud.sel = null;
    if (sel) fichaDeUmTorneio(caixa, sel, e);
    else listaDeTorneios(caixa, e);
    if (arg !== true) atualizaTorneio(false);
    if (rolagem) safe(function () { sheetEl.querySelector('.sheet-body').scrollTop = rolagem; return true; }, null);
  }
  function atualizaTorneio(forca) {
    var T = Tn();
    if (!T) return;
    torneioHud.t = Date.now();
    safe(function () { T.busca(forca); return true; }, null);
    safe(function () { T.consulta(); return true; }, null);
  }
  function listaDeTorneios(caixa, e) {
    var T = Tn();
    var prox = T.proximos();
    if (!prox.length) {
      caixa.appendChild(el('p', 'empty', e.erro ? esc(e.erro) : tr('Nenhum torneio marcado agora. O próximo aparece aqui assim que o servidor o criar.')));
    }
    prox.forEach(function (t) { caixa.appendChild(cartaoTorneio(t, e)); });
    var ult = T.encerrados();
    if (ult.length) {
      caixa.appendChild(el('h3', 'bk-tit', tr('Últimos campeões')));
      var lista = el('div', 'aq-lista tor-ultimos');
      ult.forEach(function (t) {
        var ln = el('button', 'aq-linha tor-ultimo');
        ln.type = 'button';
        ln.setAttribute('data-torneio', String(t.id));
        var tx = el('div', 'aq-tx');
        tx.appendChild(el('b', 'aq-nome', '🏆 ' + esc(t.campeao ? nomeNaChave(t, t.campeao) : tr('sem campeão'))));
        tx.appendChild(el('span', 'aq-desde', esc(nomeTorneio(t)) + ' · ' + esc(quandoTorneio(t.inicioMs))));
        ln.appendChild(tx);
        ln.appendChild(el('span', 'aq-tag', tr('ver a chave')));
        tap(ln, function () { openSheet('torneio', { id: t.id }); });
        lista.appendChild(ln);
      });
      caixa.appendChild(lista);
    }
  }
  /* o cartão de um torneio na lista: quando, a contagem, as vagas, os dois prêmios, a minha situação */
  function cartaoTorneio(t, e) {
    var T = Tn();
    var c = el('div', 'tor-cartao is-' + t.tipo + ' is-' + t.estado);
    c.setAttribute('data-torneio', String(t.id));
    c.appendChild(el('h3', 'tor-tit', '🏆 ' + esc(nomeTorneio(t))));
    c.appendChild(el('p', 'tor-quando', '<b>' + esc(quandoTorneio(t.inicioMs)) + '</b> <small>' + tr('(no horário do seu aparelho)') + '</small>'));
    c.appendChild(el('p', 'tor-estado', linhaEstado(t)));
    var tam = t.chave ? t.chave.tamanho : T.tamanhoCom(t.inscritos.length);
    if (t.estado === 'inscricoes') c.appendChild(el('p', 'tor-vagas', tr('Vagas: <b>{a}</b>', { a: esc(textoVagas(t)) })));
    else c.appendChild(el('p', 'tor-vagas', tr('Chave de <b>{a}</b> · {n} inscrito(s)', { a: tam, n: t.inscritos.length })));
    c.appendChild(el('p', 'tor-premio', tr('Prêmio de agora (chave de {a}): <b>{b}</b>', { a: tam, b: esc(textoPremio(t.premio, t, false)) })));
    if (tam < 16 && t.estado === 'inscricoes') {
      var cheio = T.premioDe(16);
      if (t.tipo === 'guilda' && !t.premio.barras) { cheio.barras = 0; cheio.vintens = 0; cheio.gemas = 0; }
      c.appendChild(el('p', 'tor-premio is-cheio', tr('Com o torneio cheio (16): <b>{a}</b>', { a: esc(textoPremio(cheio, t, true)) })));
    }
    blocoMinhaVez(c, t, e);
    c.appendChild(btn(t.chave ? tr('Ver a chave e os inscritos') : tr('Ver os inscritos ({n})', { n: t.inscritos.length }),
      'btn-ghost btn-block tor-ver', function () { openSheet('torneio', { id: t.id }); }));
    return c;
  }
  /* a MINHA situação num torneio: inscrito (trocar/sair), inscrever, ou — no de guilda — os voluntários */
  function blocoMinhaVez(c, t, e) {
    var T = Tn();
    if (t.tipo === 'guilda') { blocoGuildaTorneio(c, t, e); return; }
    var minha = T.inscricao(t.id);
    var aberto = t.estado === 'inscricoes' && t.inscricaoAteMs > agoraTorneio();
    if (minha) {
      c.appendChild(el('p', 'hub-nota tor-inscrito', tr('Você está inscrito com <b>{a}</b>.', { a: esc(nomesDupla(minha.classes)) })));
      if (aberto) {
        var duo = el('div', 'pn-duplo');
        duo.appendChild(btn(tr('Trocar a dupla'), 'btn-ghost tor-trocar', function () { pedeInscricaoTorneio(t); }));
        duo.appendChild(btn(tr('Sair do torneio'), 'btn-warn tor-sair', function () {
          confirmSheet(tr('Sair do torneio?'), tr('A sua vaga fica livre. Você pode se inscrever de novo até o fechamento das inscrições.'), function () {
            T.sair(t.id).then(function (r) {
              toast(r.ok ? tr('Você saiu do torneio.') : T.textoRecusa(r), r.ok ? 'good' : undefined);
              openSheet('torneio');
            });
          }, { sim: tr('Sair'), simCls: 'btn-warn', aoCancelar: function () { openSheet('torneio'); } });
        }));
        c.appendChild(duo);
      }
      return;
    }
    if (!aberto) return;
    if (t.inscritos.length >= 16) { c.appendChild(el('p', 'hub-nota', tr('O torneio está cheio: os 16 lugares já têm dono.'))); return; }
    var nv = forteDeIds(selHeroes);
    var cabe = T.cabeNaFaixa(t, nv);
    if (!cabe) {
      c.appendChild(el('p', 'hub-nota tor-fora', tr('A dupla escolhida na praça chega a <b>nv {nv}</b>: esta chave é do nível {a} ao {b}. Com outra dupla pode dar — quem confere é o servidor.', { nv: nv, a: t.nivelMin, b: t.nivelMax })));
    }
    c.appendChild(btn(tr('Inscrever minha dupla'), (cabe ? 'btn-gold' : 'btn-ghost') + ' btn-block tor-inscrever', function () { pedeInscricaoTorneio(t); }));
  }
  function pedeInscricaoTorneio(t) {
    var T = Tn();
    var minha = T.inscricao(t.id);
    openSheet('escolheDupla', { titulo: tr('Inscrição no Torneio'), rotulo: tr('Inscrever a dupla'), semVida: true,
      sub: tr('Escolha os dois heróis, em ordem. Vale o nível do mais forte: esta chave é do nível {a} ao {b}. A luta do torneio começa com a vida cheia.', { a: t.nivelMin, b: t.nivelMax }),
      inicial: (minha && minha.herois.length) ? minha.herois.slice() : selHeroes.slice(),
      aoCancelar: function () { openSheet('torneio'); },
      aoEscolher: function (ids) {
        return T.inscrever(t.id, ids).then(function (r) {
          if (r.ok) { toast(tr('A sua dupla está no torneio. Esteja na praça na hora: você terá 3 minutos para dizer "estou aqui".'), 'good'); openSheet('torneio'); }
          else toast(T.textoRecusa(r));
          return r;
        });
      } });
  }
  /* O TORNEIO DE GUILDA: qualquer membro de nível 20 a 30 se voluntaria com a dupla; o líder ou um oficial
   * escolhe o representante entre os voluntários (sem escolha, vai o voluntário de maior nível) */
  function blocoGuildaTorneio(c, t, e) {
    var T = Tn();
    var g = e.meu.guilda;
    var aberto = t.estado === 'inscricoes' && t.inscricaoAteMs > agoraTorneio();
    if (!g || String(g.torneio) !== String(t.id)) {
      if (aberto) c.appendChild(el('p', 'hub-nota tor-fora', tr('Uma vaga por guilda: quem é de uma guilda se voluntaria com a dupla, e o líder ou um oficial escolhe quem a representa. Entre numa guilda para participar.')));
      return;
    }
    var eu = minhaContaTorneio();
    var cx = el('div', 'tor-guilda');
    c.appendChild(cx);
    cx.appendChild(el('p', 'hub-nota', g.voluntarios.length
      ? tr('Voluntários da sua guilda: <b>{n}</b>. {a}', { n: g.voluntarios.length, a: g.representante != null ? tr('O representante já foi escolhido.') : tr('Sem escolha, vai o voluntário de maior nível.') })
      : tr('Ninguém da sua guilda se voluntariou ainda. Guilda sem voluntário não entra.')));
    var lista = el('div', 'aq-lista tor-voluntarios');
    g.voluntarios.forEach(function (v) {
      var rep = g.representante != null && g.representante === v.conta;
      var ln = el('div', 'aq-linha tor-voluntario' + (rep ? ' is-eu' : ''));
      ln.setAttribute('data-conta', String(v.conta));
      ln.appendChild(art('portrait', [((v.classes[0] || {}).classId) || 'sumo', { element: 'neutro', size: 48 }], 36));
      var tx = el('div', 'aq-tx');
      tx.appendChild(el('b', 'aq-nome', esc(v.nome) + ' <small>nv ' + (v.nivel || '?') + (v.conta === eu ? ' · ' + tr('você') : '') + '</small>'));
      tx.appendChild(el('span', 'aq-dupla', esc(nomesDupla(v.classes))));
      ln.appendChild(tx);
      if (rep) ln.appendChild(el('span', 'aq-tag', tr('representante')));
      if (g.possoEscolher && aberto) {
        ln.appendChild(btn(rep ? tr('Desfazer') : tr('Escolher'), 'btn-mini ' + (rep ? 'btn-ghost' : 'btn-gold') + ' tor-escolher', function () {
          T.representante(t.id, rep ? null : v.conta).then(function (r) {
            toast(r.ok ? (rep ? tr('Escolha desfeita: sem escolha, vai o voluntário de maior nível.') : tr('{a} representa a guilda no torneio.', { a: v.nome })) : T.textoRecusa(r), r.ok ? 'good' : undefined);
            if (sheetName === 'torneio') sheetTorneio(true);
          });
        }));
      }
      lista.appendChild(ln);
    });
    if (g.voluntarios.length) cx.appendChild(lista);
    if (!aberto) return;
    if (g.souVoluntario) {
      var duo = el('div', 'pn-duplo');
      duo.appendChild(btn(tr('Trocar a dupla'), 'btn-ghost tor-trocar', function () { pedeVoluntario(t); }));
      duo.appendChild(btn(tr('Retirar meu nome'), 'btn-warn tor-desvoluntariar', function () {
        T.desvoluntariar(t.id).then(function (r) {
          toast(r.ok ? tr('Você não é mais voluntário.') : T.textoRecusa(r), r.ok ? 'good' : undefined);
          if (sheetName === 'torneio') sheetTorneio(true);
        });
      }));
      cx.appendChild(duo);
    } else {
      cx.appendChild(btn(tr('Voluntariar minha dupla'), 'btn-gold btn-block tor-voluntariar', function () { pedeVoluntario(t); }));
    }
  }
  function pedeVoluntario(t) {
    var T = Tn();
    openSheet('escolheDupla', { titulo: tr('Voluntário da guilda'), rotulo: tr('Voluntariar a dupla'), semVida: true,
      sub: tr('Escolha os dois heróis, em ordem. O herói mais forte tem de estar entre o nível {a} e o {b}. Se a guilda te escolher, é você quem luta por ela.', { a: t.nivelMin, b: t.nivelMax }),
      inicial: selHeroes.slice(),
      aoCancelar: function () { openSheet('torneio'); },
      aoEscolher: function (ids) {
        return T.voluntariar(t.id, ids).then(function (r) {
          if (r.ok) { toast(tr('Você é voluntário da guilda no torneio.'), 'good'); openSheet('torneio'); }
          else toast(T.textoRecusa(r));
          return r;
        });
      } });
  }
  /* um torneio aberto: os inscritos e, depois do sorteio, a chave */
  function fichaDeUmTorneio(caixa, t, e) {
    var T = Tn();
    var eu = minhaContaTorneio();
    caixa.appendChild(btn(tr('‹ Todos os torneios'), 'btn-ghost tor-voltar', function () { openSheet('torneio', 'lista'); }));
    var cab = el('div', 'tor-cartao is-' + t.tipo + ' is-' + t.estado + ' is-aberto');
    cab.setAttribute('data-torneio', String(t.id));
    cab.appendChild(el('h3', 'tor-tit', '🏆 ' + esc(nomeTorneio(t))));
    cab.appendChild(el('p', 'tor-quando', '<b>' + esc(quandoTorneio(t.inicioMs)) + '</b> <small>' + tr('(no horário do seu aparelho)') + '</small>'));
    cab.appendChild(el('p', 'tor-estado', linhaEstado(t)));
    if (t.estado === 'encerrado' && t.campeao) {
      cab.appendChild(el('p', 'tor-premio', tr('Prêmio do campeão: <b>{a}</b>', { a: esc(textoPremio(t.premio, t, false)) })));
    }
    caixa.appendChild(cab);
    if (t.chave) {
      caixa.appendChild(el('h3', 'bk-tit', tr('A chave ({a})', { a: t.chave.tamanho })));
      caixa.appendChild(el('p', 'inv-dica tor-dica', tr('Cada rodada começa 2 minutos depois de a anterior acabar; a hora de cada luta é a previsão. Deslize para os lados para ver as rodadas.')));
      caixa.appendChild(desenhaChave(t, eu));
    }
    caixa.appendChild(el('h3', 'bk-tit', tr('Inscritos ({n})', { n: t.inscritos.length })));
    var lista = el('div', 'aq-lista tor-inscritos');
    if (!t.inscritos.length) lista.appendChild(el('p', 'empty', tr('Ninguém inscrito ainda. Seja o primeiro!')));
    t.inscritos.forEach(function (x) {
      var ln = el('div', 'aq-linha' + (x.conta === eu ? ' is-eu' : ''));
      ln.setAttribute('data-conta', String(x.conta));
      ln.appendChild(art('portrait', [((x.classes[0] || {}).classId) || 'sumo', { element: 'neutro', size: 48 }], 36));
      var tx = el('div', 'aq-tx');
      tx.appendChild(el('b', 'aq-nome', esc(x.nome) + ' <small>nv ' + (x.nivel || '?') + '</small>'));
      tx.appendChild(el('span', 'aq-dupla', esc(nomesDupla(x.classes))));
      if (x.guilda && x.guilda.nome) tx.appendChild(el('span', 'aq-desde', '⚑ ' + esc(x.guilda.nome)));
      ln.appendChild(tx);
      if (x.conta === eu) ln.appendChild(el('span', 'aq-tag', tr('você')));
      lista.appendChild(ln);
    });
    caixa.appendChild(lista);
    if (t.estado !== 'encerrado' && t.estado !== 'cancelado') {
      var minha = el('div', 'tor-cartao tor-minha');
      blocoMinhaVez(minha, t, e);
      if (minha.firstChild) caixa.appendChild(minha);
    }
  }
  /* A CHAVE: uma coluna por rodada (rola para os lados no celular), cada luta com os dois lados, quem passou
   * marcado, como foi decidida (W.O., passe, sorteio, desistência) ou a previsão da hora, e a minha linha destacada */
  function desenhaChave(t, eu) {
    var T = Tn();
    var cx = el('div', 'tor-chave');
    cx.tabIndex = 0;                                   // quem navega pelo teclado rola a chave com as setas
    cx.setAttribute('role', 'group');
    cx.setAttribute('aria-label', tr('A chave do torneio'));
    t.chave.rodadas.forEach(function (rd, ri) {
      var naVez = t.estado === 'andamento' && ri === t.chave.rodada;
      var col = el('div', 'tor-col' + (naVez ? ' is-vez' : ''));
      col.setAttribute('data-rodada', String(ri));
      col.appendChild(el('div', 'tor-col-tit', esc(T.nomeDaRodada(t.chave.tamanho, ri))));
      rd.forEach(function (l) { col.appendChild(lutaDaChave(t, l, eu)); });
      cx.appendChild(col);
    });
    if (t.campeao) {
      var fim = el('div', 'tor-col tor-col-campeao');
      fim.appendChild(el('div', 'tor-col-tit', tr('Campeão')));
      fim.appendChild(el('div', 'tor-campeao' + (eu != null && t.campeao.conta === eu ? ' is-eu' : ''), '🏆 ' + esc(nomeNaChave(t, t.campeao))));
      cx.appendChild(fim);
    }
    return cx;
  }
  var COMO_LUTA = null;
  function lutaDaChave(t, l, eu) {
    if (!COMO_LUTA) COMO_LUTA = { luta: tr('na luta'), wo: tr('W.O.'), bye: tr('passe livre'), sorteio: tr('por sorteio'), desistencia: tr('desistência') };
    var meu = eu != null && ((l.a && l.a.conta === eu) || (l.b && l.b.conta === eu));
    var d = el('div', 'tor-luta is-' + l.estado + (meu ? ' is-eu' : '') + (l.como ? ' is-' + l.como : ''));
    d.setAttribute('data-pos', String(l.pos));
    ['a', 'b'].forEach(function (lado) {
      var p = l[lado];
      var venceu = l.vencedor === lado, caiu = !!l.vencedor && !venceu;
      var passe = !p && l.rodada === 0 && (l.como === 'bye' || l.estado === 'decidida');
      var ln = el('div', 'tor-lado' + (venceu ? ' is-venceu' : '') + (caiu ? ' is-caiu' : '') + (!p ? ' is-vazio' : '') +
                         (p && eu != null && p.conta === eu ? ' is-meu' : ''));
      var nome = p ? nomeNaChave(t, p) : (passe ? tr('— passe —') : tr('a definir'));
      ln.appendChild(el('span', 'tor-nome', esc(nome) + ((p && t.tipo === 'guilda' && p.guilda && p.guilda.nome) ? ' <small>' + esc(p.nome) + '</small>' : '')));
      if (venceu) ln.appendChild(el('span', 'tor-ok', '✔'));
      d.appendChild(ln);
    });
    var pe = '';
    if (l.estado === 'decidida') pe = COMO_LUTA[l.como] || '';
    else if (l.estado === 'chamada') pe = tr('chamando…');
    else if (l.estado === 'luta') pe = tr('lutando agora');
    else if (l.previstoMs) pe = tr('previsão {a}', { a: horaTorneio(l.previstoMs) });
    d.appendChild(el('div', 'tor-pe', esc(pe)));
    return d;
  }

  // ---- a chamada: o cartão que não some
  function pintaChamada() {
    if (!torneioEl) return;
    var T = Tn();
    var l = T ? safe(function () { return T.luta(); }, null) : null;
    // a luta já abriu: o cartão sai da frente enquanto se luta (volta se a luta do torneio seguir de pé depois)
    var some = !l || (l.entregue && (current === 'battle' || current === 'duelFim'));
    var sig = some ? '' : [l.torneio, l.rodada, l.pos, l.presente, l.elePresente, l.did, l.entregue, l.bloqueio, l.prazoMs, l.revanche].join('|');
    if (sig !== torneioHud.lutaSig) { torneioHud.lutaSig = sig; desenhaChamada(some ? null : l); }
    var rel = torneioEl.querySelector('.tc-rel');
    if (rel) rel.textContent = relogioTxt(Number(rel.getAttribute('data-prazo')) - agoraTorneio());
  }
  function desenhaChamada(l) {
    clear(torneioEl);
    if (!l) { torneioEl.className = 'ui-torneio'; return; }
    var T = Tn();
    torneioEl.className = 'ui-torneio is-on' + (l.did ? ' is-pronta' : (l.presente ? ' is-presente' : ' is-chamando'));
    var ad = l.adversario || { classes: [] };
    var t = T.torneio(l.torneio);
    var cab = el('div', 'pd-cab');
    cab.appendChild(art('portrait', [((ad.classes[0] || {}).classId) || 'sumo', { element: 'neutro', size: 48 }], 40));
    var tx = el('div', 'pd-tx');
    tx.appendChild(el('span', 'pd-tit', l.revanche ? tr('Revanche do torneio: contra <b>{a}</b>', { a: esc(ad.nome) })
                                                  : tr('Sua luta do torneio: contra <b>{a}</b>', { a: esc(ad.nome) })));
    var rodada = t && t.chave ? T.nomeDaRodada(t.chave.tamanho, l.rodada) : '';
    tx.appendChild(el('span', 'pd-sub', (rodada ? esc(rodada) + ' · ' : '') + (ad.nivel ? 'nv ' + ad.nivel + ' · ' : '') + esc(nomesDupla(ad.classes))));
    cab.appendChild(tx);
    if (!l.did) {
      var rel = el('span', 'pd-rel tc-rel', relogioTxt(l.prazoMs - agoraTorneio()));
      rel.setAttribute('data-prazo', String(l.prazoMs));
      cab.appendChild(rel);
    }
    torneioEl.appendChild(cab);
    if (l.did) {
      var txt = l.bloqueio === 'fora-da-praca' ? tr('Os dois confirmaram: a luta está pronta. <b>Volte à praça</b> para ela abrir.')
              : l.bloqueio === 'ocupado' ? tr('Os dois confirmaram: a luta está pronta. Feche o duelo aberto para ela começar.')
              : tr('Os dois confirmaram — <b>a luta vai começar!</b> Vida cheia para os dois lados.');
      torneioEl.appendChild(el('p', 'pd-nota tc-nota', txt));
      return;
    }
    torneioEl.appendChild(barraPrazo(l.prazoMs, agoraTorneio));
    if (!l.presente) {
      torneioEl.appendChild(el('p', 'pd-nota tc-nota', (l.revanche ? tr('A luta fechou sem vencedor: esta é a revanche (sem vencedor de novo, decide o sorteio). ') : '') +
        (l.elePresente ? tr('<b>{a} já confirmou.</b> ', { a: esc(ad.nome) }) : '') +
        tr('Você tem 3 minutos para dizer que está aqui. Sem a sua confirmação, a vitória vai para o outro lado por W.O.')));
      var acts = el('div', 'pd-acts');
      var bAqui = btn(tr('Estou aqui'), 'btn-primary tc-aqui', function () {
        bAqui.classList.add('is-off');
        T.presente(l.torneio).then(function (r) {
          if (!r.ok) { bAqui.classList.remove('is-off'); toast(T.textoRecusa(r)); }
        });
      });
      acts.appendChild(bAqui);
      torneioEl.appendChild(acts);
    } else {
      torneioEl.appendChild(el('p', 'pd-nota tc-nota', l.elePresente
        ? tr('<b>Você confirmou.</b> {a} também — a luta abre em instantes.', { a: esc(ad.nome) })
        : tr('<b>Você confirmou.</b> Esperando {a}… Se o prazo acabar sem a confirmação, você passa por W.O.', { a: esc(ad.nome) })));
    }
  }

  // ---- o fim: a tela do campeão e o aviso para os outros
  function aoTorneioCampeao(t, quem) {
    if (!t) return;
    if (quem && quem.eu) {
      torneioHud.pendente = t;
      abreCampeaoPendente();
      return;
    }
    var nome = t.campeao ? nomeNaChave(t, t.campeao) : '';
    if (nome) toast(tr('🏆 {a} venceu o {b}!', { a: nome, b: nomeTorneio(t) }), 'good');
  }
  /* a tela do campeão abre na praça, sem passar por cima de outra ficha (espera a vez no tique) */
  function abreCampeaoPendente() {
    if (!torneioHud.pendente || current !== 'hub' || (sheetName && sheetName !== 'torneio')) return;
    var t = torneioHud.pendente;
    torneioHud.pendente = null;
    openSheet('torneioCampeao', t);
  }
  function sheetTorneioCampeao(t) {
    var T = Tn();
    t = t || {};
    var body = sheetShell(tr('Campeão do Torneio!'), esc(nomeTorneio(t)));
    sheetName = 'torneioCampeao';
    torneioHud.campeaoT = t;          // a lista e o MEU chegam em pedidos separados: a tela se refaz quando as conquistas chegam
    var caixa = el('div', 'ms-caixa tor-campeao-ficha');
    body.appendChild(caixa);
    var p = t.premio || {};
    var tam = t.chave ? t.chave.tamanho : 2;
    caixa.appendChild(el('p', 'tor-trofeu', '🏆'));
    caixa.appendChild(el('p', 'tor-campeao-txt', tr('Você venceu a chave de <b>{a}</b>. O prêmio já está na sua conta:', { a: tam })));
    var lista = el('div', 'tor-premios');
    function linha(txt) { lista.appendChild(el('div', 'tor-premio-linha', txt)); }
    if (p.barras) linha(tr('<b>+{n}</b> barra(s) de ouro', { n: p.barras }));
    if (p.vintens) linha(tr('<b>+{n}</b> vinténs', { n: p.vintens }));
    if (p.gemas) linha(tr('<b>+{n}</b> Gema(s) Enterrada(s)', { n: p.gemas }));
    if (t.tipo === 'guilda') {
      if (p.xpGuilda) linha(tr('<b>+{n}</b> XP para a guilda', { n: p.xpGuilda }));
      linha(tr('<b>XP em dobro</b> para todos os membros da guilda por 7 dias'));
      if (p.conquista) linha(tr('O título <b>Campeão das Guildas</b> (em Customizar)'));
      else linha(tr('Chave de 2 não dá o título nem a marca da guilda: com 4 ou mais guildas eles valem.'));
      linha(tr('A placa da guilda com o filete da campeã até o próximo torneio de guilda'));
    } else {
      var m = T ? T.meu() : { conquistas: { pvp: 0 } };
      if (p.conquista) linha(tr('Uma <b>conquista</b> a mais: são {n} — os títulos estão em Customizar', { n: Math.max(1, m.conquistas.pvp) }));
      else linha(tr('Chave de 2 não conta como conquista: com 4 ou mais inscritos ela vale título.'));
      if (p.moldura) linha(tr('A moldura <b>Campeão da Arena</b> (em Customizar › Moldura)'));
      linha(tr('O <b>louro</b> do campeão vigente na sua plaquinha, até o próximo torneio desta faixa acabar'));
    }
    caixa.appendChild(lista);
    caixa.appendChild(btn(tr('Customizar a plaquinha'), 'btn-primary btn-block tor-customizar', function () { openSheet('customizar'); }));
    caixa.appendChild(btn(tr('Ver a chave'), 'btn-ghost btn-block', function () { openSheet('torneio', { id: t.id }); }));
  }

  // ---- os ganchos e o relógio
  /* a minha guilda no torneio: campeã vigente e quantos títulos tem — da ficha da guilda quando o servidor os
   * manda; senão, a campeã sai do último torneio de guilda encerrado (pelo nome) */
  function guildaNoTorneio() {
    if (!resumoGuilda) return null;
    var f = safe(function () { return JOGO.Guilda._ficha(); }, null) || {};
    // a ficha do servidor traz `torneio: {campea, titulos, fatorXp, xpDobroAteMs}` (docs/TORNEIO.md §4.3)
    var ft = safe(function () { return JOGO.Guilda.torneio(); }, null);
    if (ft) return { campea: ft.campea, titulos: Math.min(5, ft.titulos) };
    var campea = f.campea === true, titulos = Math.max(0, Math.floor(Number(f.titulos != null ? f.titulos : f.guildaTitulos) || 0));
    if (f.campea === undefined) {
      var ult = safe(function () { return Tn().encerrados().filter(function (t) { return t.tipo === 'guilda' && t.campeao; })[0]; }, null);
      var gc = ult && ult.campeao.guilda;
      campea = !!(gc && ((f.id != null && gc.id === f.id) || (f.id == null && gc.nome === resumoGuilda.nome)));
      if (campea && !titulos) titulos = 1;
    }
    return { campea: campea, titulos: Math.min(5, titulos) };
  }
  function aplicaTorneioPraca() {
    var T = Tn(), H = JOGO.Hub;
    if (!T || !H) return;
    if (H.arena) safe(function () { H.arena(T.arenaDoPerfil()); return true; }, null);
    if (H.guildaCampea) {
      var g = guildaNoTorneio();
      var sig = g ? (g.campea ? 'c' : '') + g.titulos : '';
      if (sig !== torneioHud.guildaSig) { torneioHud.guildaSig = sig; safe(function () { H.guildaCampea(g); return true; }, null); }
    }
  }
  function aoTorneioMudou() {
    pintaChamada();
    aplicaTorneioPraca();
    // as conquistas mudaram (ou acabaram de ser lidas): a régua dos títulos é refeita e a plaquinha confere o dela
    var cq = safe(function () { var c = Tn().meu().conquistas; return c.pvp + '|' + c.guilda; }, '');
    if (cq !== torneioHud.conqSig) {
      torneioHud.conqSig = cq;
      if (JOGO.DB && current === 'hub') safe(function () {
        estadoDosTitulos().then(function () { return JOGO.DB.jogador(); }).then(function (j) {
          if (j && JOGO.Hub && JOGO.Hub.nomeia && current === 'hub') JOGO.Hub.nomeia(undefined, titExibe(tituloPendurado(j.titulo)));
        });
        return true;
      }, null);
    }
    if (painelModo === 'lugar' && painelLugar && painelLugar.tipo === 'arena') repintaLugar();
    if (sheetName === 'torneio') sheetTorneio(true);
    else if (sheetName === 'torneioCampeao' && torneioHud.campeaoT) sheetTorneioCampeao(torneioHud.campeaoT);
  }
  function tiqueTorneioTela() {
    pintaChamada();
    abreCampeaoPendente();
    var agora = agoraTorneio();
    [].forEach.call(document.querySelectorAll('.tor-rel[data-ate]'), function (x) {
      var txt = faltaTorneio(Number(x.getAttribute('data-ate')) - agora);
      if (x.textContent !== txt) x.textContent = txt;
    });
    // com a ficha aberta a lista é relida a cada 10 s (a chave anda, as vagas enchem)
    if (sheetName === 'torneio' && Date.now() - torneioHud.t > 10000) atualizaTorneio(true);
  }
  UI._torneio = function () { return { sel: torneioHud.sel, chamada: !!(torneioEl && torneioEl.classList.contains('is-on')) }; };   // provas
  // ---- a guerra de guilda 2×2 (15/09): o bloco da Sede, a escolha das duplas, os adversários, o topo e o fim
  /* O dono: "a guerra de guild que é 2x2 de cada guild é na sede de guild, isso dá pontos de experiência para guild".
   * Quem decide é o JOGO.Guerra (grupo.js: a fila no servidor) e a batalha é do Coop; aqui só se desenha. */
  function Gu() { return JOGO.Guerra || null; }
  function agoraGuerra() { return safe(function () { return Gu()._agora(); }, Date.now()); }
  function nomesIds(ids) { return (ids || []).map(nomeHeroiNv).join(tr(' e ')); }
  function textoGuerra(r) {
    if (!r) return tr('A guerra de guilda não respondeu.');
    var m = r.motivo;
    var T = {
      'sem-grupo': tr('Forme um grupo de 2 com alguém da sua guilda.'),
      'nao-lider': tr('Quem inscreve o grupo na guerra é quem lidera.'),
      'sem-conta-par': tr('O servidor ainda não conferiu a conta do seu parceiro — ele precisa entrar na conta e recarregar a página.'),
      'sem-guilda': tr('A guerra é de guilda: vocês dois precisam estar numa guilda.'),
      'outra-guilda': tr('Os dois do grupo precisam ser da mesma guilda.'),
      'sem-convite': tr('O prazo para pôr a sua dupla passou — peça para quem lidera inscrever de novo.'),
      'arena': tr('Saia do quadro da Arena antes de entrar na guerra.'),
      'casada': tr('Já há uma guerra em andamento para vocês.'),
      'inscrito': tr('Um de vocês já está noutra inscrição da guerra.'),
      'sem-partida': tr('O prazo da guerra passou.'),
      'vida-zero': tr('Um herói da dupla está sem vida{a} ou beba uma poção.', { a: r.esperaS ? ': espere ' + r.esperaS + ' s' : '' }),
      // 19/09: os motivos curtos do contrato servidor↔jogo da guerra
      'dois': tr('Escolha os dois heróis que vão à guerra, em ordem.'),
      'mestre': tr('O Mestre não vai à guerra de guilda.'),
      'sem-estado-parceiro': tr('O servidor ainda não tem o estado do seu parceiro — ele precisa entrar na conta e recarregar a página.'),
      'sem-estado-lider': tr('O servidor ainda não tem o estado de quem lidera — ele precisa entrar na conta e recarregar a página.'),
      'mesmo-dono': tr('Vocês dois estão com o mesmo nome na Rede — um de vocês precisa recarregar a página.'),
      'parceiro': tr('O parceiro não é o do seu grupo — forme o grupo de novo.'),
      'desistencia-alheia': tr('Só quem sai declara a própria saída.'),
      'marca-sem-prova': tr('O servidor não viu a queda ou a saída marcada no registro — a guerra espera o registro de outro jogador.'),
      'wo-sem-prova': tr('O servidor não viu a queda do outro lado: o W.O. valeu só a vida da luta, sem XP.'),
      'paridade': tr('A diferença de nível entre as duplas passou do limite da guerra.'),
      'teto': tr('O teto de guerras de hoje já foi — esta não rende XP.'),
      'largada': tr('Você saiu da última luta sem terminar: os heróis dela voltam do zero.')
    };
    if (T[m]) return T[m];
    if (r.erro && ['sem-sessao', 'arquivo', 'servidor', 'rede'].indexOf(m) >= 0) return r.erro;
    return r.erro || textoMotivo(m, null);
  }
  function painelGuerra(p) {
    var W = Gu();
    if (!W) return;
    var e = W.estado();
    var caixa = el('div', 'guerra-bloco');
    p.appendChild(caixa);
    caixa.appendChild(el('h4', 'guerra-tit', tr('⚔ Guerra de Guilda 2×2')));
    caixa.appendChild(el('p', 'hub-nota guerra-explica', tr('Dois da mesma guilda, cada um com a sua dupla, contra dois de outra guilda — oito heróis no Salão da Sede. A guilda que vence ganha <b>+{XP} XP</b>; a coroa não muda.', { XP: W.XP })));
    if (e.desligada) { caixa.appendChild(el('p', 'hub-nota guerra-off', '⚔ ' + esc(e.desligada))); return; }
    var nomePar = esc(nomeParceiro());
    // 19/09: a partida 'pronta'/'em-luta' já entregue ao Coop (a guerra acabou aqui e o servidor ainda assenta os
    // fechamentos) não é "abre em instantes" nem prende a fila: diz o que é, e a inscrição volta quando ela assentar
    var esperandoServidor = (e.fase === 'pronta' || e.fase === 'em-luta') && e.entregue;
    if (esperandoServidor) {
      caixa.appendChild(el('p', 'hub-nota guerra-conferindo', tr('A última guerra ainda está sendo conferida pelo servidor — a inscrição volta em instantes…')));
      return;
    }
    if (e.fase === 'livre' || e.fase === 'fechada') {
      if (!emGrupo()) caixa.appendChild(el('p', 'hub-nota guerra-sem-grupo', tr('Forme um grupo de 2 com alguém da sua guilda para entrar na fila.')));
      else if (souLider()) caixa.appendChild(btn(tr('Inscrever o grupo na guerra'), 'btn-gold btn-block guerra-inscrever', pedeGuerraInscricao));
      else caixa.appendChild(el('p', 'hub-nota guerra-espera-lider', tr('Quem lidera o grupo (<b>{nomePar}</b>) inscreve; aí você escolhe a sua dupla.', { nomePar: nomePar })));
    } else if (e.fase === 'aguardando') {
      caixa.appendChild(el('p', 'hub-nota guerra-aguardando', tr('Inscrito com <b>{a}</b> · esperando <b>{b}</b> escolher a dupla dele…', { a: esc(nomesIds(e.herois)), b: esc((e.parceiro || {}).nome || nomeParceiro()) })));
      caixa.appendChild(btn(tr('Sair da fila'), 'btn-warn btn-block guerra-sair', function () { W.sair(); toast(tr('Vocês saíram da fila da guerra.')); }));
    } else if (e.fase === 'convite') {
      caixa.appendChild(el('p', 'hub-nota guerra-convite', tr('<b>{a}</b> inscreveu o grupo na guerra de guilda. Escolha os dois heróis que você leva.', { a: esc((e.lider || {}).nome || nomeParceiro()) })));
      caixa.appendChild(btn(tr('Escolher a minha dupla'), 'btn-gold btn-block guerra-juntar', pedeGuerraJuntar));
      caixa.appendChild(btn(tr('Não vou'), 'btn-ghost btn-block guerra-sair', function () { W.sair(); }));
    } else if (e.fase === 'inscrito') {
      caixa.appendChild(el('p', 'hub-nota guerra-inscrito', tr('Na fila com <b>{a}</b> · há <b class="arena-relogio" data-desde="{desdeMs}">{b}</b>. Procurando uma dupla de outra guilda (até {PARIDADE} níveis de diferença)…', { a: esc(nomesIds(e.herois)), desdeMs: e.desdeMs, b: relogioTxt(agoraGuerra() - e.desdeMs), PARIDADE: W.PARIDADE })));
      caixa.appendChild(btn(tr('Sair da fila'), 'btn-warn btn-block guerra-sair', function () { W.sair(); toast(tr('Vocês saíram da fila da guerra.')); }));
    } else if (e.fase === 'casada') {
      pintaGuerraCasada(caixa, e);
    } else if (e.fase === 'pronta') {
      caixa.appendChild(el('p', 'hub-nota guerra-pronta', tr('Os quatro confirmaram — a guerra abre em instantes…')));
    } else if (e.fase === 'em-luta') {
      caixa.appendChild(el('p', 'hub-nota guerra-em-luta', tr('Há uma guerra desta conta em andamento noutra página — ela fecha sozinha ao terminar.')));
    }
  }
  function nomesConfirma(lista) {
    return (lista || []).map(function (x) { return esc(x.nome) + (x.confirmou ? ' ✓' : ''); }).join(tr(' e '));
  }
  function pintaGuerraCasada(p, e) {
    var W = Gu(), gAd = (e.guildas || {})[e.lado === 'A' ? 'B' : 'A'] || {};
    var box = el('div', 'guerra-casada');
    box.appendChild(el('p', 'guerra-achados', tr('Adversários encontrados: <b>{a} {b}</b>', { a: esc(gAd.emblema || '⚑'), b: esc(gAd.nome || '?') })));
    box.appendChild(el('p', 'hub-nota guerra-nomes', tr('{a} — as duplas deles só aparecem na batalha.', { a: nomesConfirma(e.adversarios) })));
    box.appendChild(el('p', 'hub-nota guerra-aliados', tr('Do seu lado: {a}.', { a: nomesConfirma(e.aliados) })));
    box.appendChild(barraPrazo(e.prazoMs, agoraGuerra));
    // 19/09: os tetos de hoje já estouraram (o servidor manda `semXp`): quem confirma sabe ANTES que não rende XP
    if (e.semXp) box.appendChild(el('p', 'hub-nota guerra-sem-xp', tr('⚠ Esta guerra <b>não vai render XP</b>: o teto de guerras de hoje (entre essas guildas, ou da sua guilda) já foi. A vida dos heróis vale do mesmo jeito.')));
    var resta = Math.max(0, Math.ceil((e.prazoMs - agoraGuerra()) / 1000));
    if (e.confirmei) {
      box.appendChild(el('p', 'du-espera', tr('Você confirmou. Esperando os outros… <b class="arena-relogio" data-prazo="{prazoMs}">{resta} s</b>', { prazoMs: e.prazoMs, resta: resta })));
      box.appendChild(btn(tr('Desistir'), 'btn-ghost btn-block guerra-recusa', function () { W.recusar(); fechaPainelGuerra(); }));
    } else {
      var duo = el('div', 'pn-duplo');
      var bOk = btn('Confirmar (' + resta + ' s)', 'btn-primary arena-confirma guerra-confirma', function () {
        W.confirmar().then(function (r) { if (!r.ok) toast(textoGuerra(r)); });
      });
      bOk.setAttribute('data-prazo', String(e.prazoMs));
      duo.appendChild(bOk);
      duo.appendChild(btn(tr('Recusar'), 'btn-ghost guerra-recusa', function () { W.recusar(); fechaPainelGuerra(); }));
      box.appendChild(duo);
    }
    p.appendChild(box);
  }
  function fechaPainelGuerra() {
    if (painelModo === 'convite' && painelConv && painelConv.tipo === 'guerra') fechaPainel();
  }
  function mostraGuerraCasada(e) {
    e = e || (Gu() && Gu().estado());
    if (!e || e.fase !== 'casada') return;
    if (painelModo === 'lugar' && painelLugar && lugarDaGuerra(painelLugar) && painelVivo()) { repintaLugar(); return; }
    var p = abrePainel('convite');
    if (!p) { toast(tr('Guerra de guilda: adversários encontrados — confirme em 30 s!')); return; }
    painelConv = { tipo: 'guerra' };
    clear(p);
    p.appendChild(el('h3', null, tr('Guerra de Guilda')));
    pintaGuerraCasada(p, e);
    if (sheetName) toast(tr('Adversários encontrados na guerra de guilda — veja o painel'));
  }
  var guerraSig = '';
  function aoGuerraMudou(e) {
    e = e || {};
    var conf = function (l) { return (l || []).map(function (x) { return x.confirmou ? 1 : 0; }).join(''); };
    var r = e.resultado;
    var sig = [e.fase, e.confirmei, conf(e.aliados), conf(e.adversarios), e.gid, !!e.desligada, (e.herois || []).join('+'),
               r ? [r.gid, r.fase, r.xp, r.motivo].join(':') : ''].join('|');
    if (sig === guerraSig) return;
    guerraSig = sig;
    if (painelModo === 'convite' && painelConv && painelConv.tipo === 'guerra') {
      var pv = painelVivo();
      if (e.fase === 'casada' && pv) { clear(pv); pv.appendChild(el('h3', null, tr('Guerra de Guilda'))); pintaGuerraCasada(pv, e); }
      else fechaPainel();
    }
    if (painelModo === 'lugar' && painelLugar && lugarDaGuerra(painelLugar)) repintaLugar();
    if (current === 'duelFim' && lastDuelFim && lastDuelFim.guerra) buildDuelFim(lastDuelFim);
  }
  function pedeGuerraInscricao() {
    openSheet('escolheDupla', { titulo: tr('Guerra de Guilda — a sua dupla'), rotulo: tr('Entrar na fila'),
      sub: tr('Escolha os dois heróis que vão à guerra, em ordem. {a} escolhe a dupla dele em seguida. As duplas dos adversários só aparecem na batalha.', { a: nomeParceiro() }),
      inicial: selHeroes.slice(),
      aoEscolher: function (ids) {
        return Gu().inscrever(ids).then(function (r) {
          if (r.ok) { closeSheet(); toast(tr('Grupo inscrito. Esperando {a} escolher a dupla dele.', { a: nomeParceiro() }), 'good'); repintaLugar(); }
          else toast(textoGuerra(r));
          return r;
        });
      } });
  }
  function pedeGuerraJuntar() {
    openSheet('escolheDupla', { titulo: tr('Guerra de Guilda — a sua dupla'), rotulo: tr('Entrar na fila'),
      sub: tr('Escolha os dois heróis que vão à guerra, em ordem. As duplas dos adversários só aparecem na batalha.'),
      inicial: selHeroes.slice(),
      aoEscolher: function (ids) {
        return Gu().juntar(ids).then(function (r) {
          if (r.ok) { closeSheet(); toast(r.fase === 'casada' ? tr('Adversários encontrados — confirme!') : tr('A sua dupla está na fila da guerra.'), 'good'); repintaLugar(); }
          else toast(textoGuerra(r));
          return r;
        });
      } });
  }
  /* o topo da batalha: as duas guildas (a minha primeiro) com os dois nomes de cada — quem caiu fica apagado */
  function pintaGuerraTopo() {
    if (!bt || !bt.guerra) return;
    var ses = coopSessao(), gq = ses && ses.guerra;
    var info = gq || safe(function () { return G().guerraInfo(); }, null);
    if (!info) return;
    var guildas = info.guildas || {};
    var jog = gq ? gq.jogadores : (info.jogadores || []).map(function (j) {
      return { id: j.dono, nome: j.nome, lado: j.lado, eu: j.dono === info.eu, on: true };
    });
    var meu = info.lado === 'B' ? 'B' : 'A';
    var aut = gq ? gq.autoridade : null;
    function lado(L) {
      var g = guildas[L] || {};
      var nomes = jog.filter(function (j) { return j.lado === L; }).map(function (j) {
        var cls = 'bg-nome' + (j.eu ? ' is-eu' : '') + (j.saiu ? ' is-saiu' : ((j.on === false || j.fora) ? ' is-fora' : '')) +
                  (aut && j.id === aut ? ' is-manda' : '');    // 19/09: quem manda (a foto de resgate) leva a coroa
        return '<span class="' + cls + '"' + (aut && j.id === aut ? ' title="quem manda na guerra"' : '') + '>' + esc(j.nome) + '</span>';
      }).join('<i>·</i>');
      return '<div class="bg-lado ' + (L === meu ? 'is-meu' : 'is-inimigo') + '"><b class="bg-emblema">' + esc(g.emblema || '⚑') +
        '</b><span class="bg-guilda">' + esc(g.nome || (tr('Guilda {L}', { L: L }))) + '</span><span class="bg-nomes">' + nomes + '</span></div>';
    }
    var html = lado(meu) + '<i class="bg-vs">×</i>' + lado(meu === 'A' ? 'B' : 'A');
    // 19/09: quem manda (a foto de resgate) marcado com a coroa, e os DOIS adversários fora = a contagem do W.O.
    // ("o lado deles tem N s para voltar") — antes era um minuto de tela parada sem dizer quanto faltava
    if (gq && gq.wo && gq.wo.desde) {
      var ag = safe(function () { return Cp()._agora(); }, Date.now());
      var sg = Math.max(0, Math.ceil((gq.wo.desde + gq.wo.prazo - ag) / 1000));
      html += '<span class="bg-wo">' + tr('o lado deles tem <b>{sg} s</b> para voltar', { sg: sg }) + '</span>';
    }
    if (bt.guerra.__html !== html) { bt.guerra.innerHTML = html; bt.guerra.__html = html; }
  }
  function porqueSemXp(res) {
    var m = res.motivo;
    if (res.fase === 'recusada') return tr('A luta não bateu com a conferência do servidor — a guerra não rendeu XP.');
    if (res.fase === 'nao-conferida') return tr('A batalha sincronizou por foto e ninguém mandou um registro limpo — a guerra não rendeu XP.');
    if (m === 'empate') return tr('Empate — nenhuma guilda ganha XP.');
    if (m === 'sem-fim') return tr('A guerra ficou sem fim conferido (ninguém mandou um registro com o fim em 2 min): vale a vida do ponto em que parou, sem XP.');
    if (m === 'wo-sem-prova') return tr('O servidor não viu a queda do outro lado: o W.O. valeu só a vida da luta, sem XP.');
    if (m === 'teto') return tr('A guerra valeu, mas sem XP: o teto de guerras de hoje (entre essas guildas, ou da guilda) já foi.');
    if (m === 'sem-guilda') return tr('A guilda vencedora não existe mais — sem XP.');
    return tr('Sem XP desta vez.');
  }
  function guerraFim(s, data) {
    var box = el('div', 'game-over du-fim du-rede guerra-fim');
    var gs = data.guildas || {}, meu = data.lado === 'B' ? 'B' : 'A', outro = meu === 'A' ? 'B' : 'A';
    var res = data.resultado;
    var W = Gu(), ult = W ? W.resultado() : null;
    if (ult && ult.gid === data.gid) res = ult;
    if (res && res.gid && data.gid && res.gid !== data.gid) res = null;
    var gV = data.empate ? null : (data.venci ? gs[meu] : gs[outro]);
    box.appendChild(el('h1', null, data.empate ? tr('Empate na guerra.') : tr('A guilda {a} venceu!', { a: esc((gV && gV.nome) || '?') })));
    if (data.wo) {
      box.appendChild(el('p', 'game-sub', data.venci ? tr('Os dois adversários saíram do salão — vitória por W.O.') : tr('O seu lado ficou fora — derrota por W.O.')));
    }
    var linha;
    if (!res) linha = tr('O servidor está conferindo a guerra…');
    else if (res.fase === 'aguardando') {
      // 19/09: a espera do servidor tem três caras — o W.O. sem a prova de queda ainda, o registro sem fim (ou
      // fotografado, ou recusado) esperando o de outro dos quatro; a Autoridade pergunta de novo a cada 5 s
      linha = (data.wo || res.motivo === 'wo') ? tr('Esperando o servidor confirmar a queda do outro lado (a prova do relé)…')
            : tr('Esperando o registro de outro jogador para conferir a guerra…');
    }
    else if (!res.ok) linha = tr('O servidor não conferiu a guerra: {a}.', { a: res.erro || tr('sem resposta') });
    else if (res.xp > 0 && res.guilda) linha = tr('A guilda {nome} venceu — +{xp} XP para a guilda.', { nome: res.guilda.nome, xp: res.xp });
    else linha = porqueSemXp(res);
    box.appendChild(el('p', 'du-valeria guerra-xp', esc(linha)));
    var jog = data.jogadores || [];
    [meu, outro].forEach(function (L) {
      var g = gs[L] || {};
      var nomes = jog.filter(function (j) { return j.lado === L; }).map(function (j) { return esc(j.nome); }).join(tr(' e '));
      var classes = (L === 'A' ? data.duplaA : data.duplaB) || [];
      box.appendChild(el('p', 'game-sub guerra-lado-fim', '<b>' + esc(g.emblema || '⚑') + ' ' + esc(g.nome || (tr('Guilda {L}', { L: L }))) + '</b>: ' + nomes +
        (classes.length ? ' · ' + esc(classes.map(function (c) { return className(c); }).join(', ')) : '')));
    });
    box.appendChild(el('p', 'game-sub', tr('Salão da Sede · clima: {a} · a coroa não muda na guerra de guilda.', { a: esc(nomeClima(data.clima)) })));
    box.appendChild(vidaBloco('fim'));
    box.appendChild(btn(tr('Voltar à Sede'), 'btn-primary btn-block', function () {
      // 19/09: fecha a sessão como os outros fins fazem — só trocar de tela deixava o Game em modo 'guerra', o Coop
      // com o gid e a fila da Sede presa em "abre em instantes", sem botão para inscrever de novo até recarregar
      safe(function () { G().restart('hub'); return true; }, null);
      navTo('hub');
    }));
    s.appendChild(box);
  }

  // ---- o Campo de PvP: a entrada, a saída, a dupla do Campo e o toque que ataca
  function painelCampo(p) {
    p.appendChild(el('h3', null, tr('Campo de PvP')));
    p.appendChild(el('p', 'hub-nota', tr('Só com a <b>coroa ligada</b>; lá dentro ela não desliga. <b>Qualquer um pode te atacar sem aviso</b> — e você também. Vale coroa (até 10 níveis de diferença).')));
    p.appendChild(el('p', 'hub-nota', tr('Na entrada você escolhe a dupla do Campo, em ordem: o 1º é a sua aparência lá dentro; o 2º fica em segredo até a luta.')));
    if (emGrupo()) { p.appendChild(el('p', 'hub-nota', tr('Saia do grupo para entrar no Campo.'))); return; }
    var oculta = resumoCoroaOculta === true;
    p.appendChild(btn(oculta ? tr('Ligar a coroa e entrar') : tr('Entrar'), 'btn-warn btn-block campo-entrar', function () {
      pedeDuplaCampo(oculta, false);
    }));
  }
  function painelCampoSaida(p) {
    p.appendChild(el('h3', null, tr('Sair do Campo de PvP')));
    p.appendChild(el('p', 'hub-nota', tr('A dupla do Campo: <b>{a}</b> (o 1º é a sua aparência aqui).', { a: esc(campoHud.dupla.map(nomeHeroiNv).join(tr(' e ')) || '—') })));
    p.appendChild(btn(tr('Trocar dupla'), 'btn-ghost btn-block campo-trocar', function () { pedeDuplaCampo(false, true); }));
    p.appendChild(btn(tr('Voltar à praça'), 'btn-primary btn-block campo-sair', saiDoCampo));
  }
  function pedeDuplaCampo(ligarCoroa, trocando) {
    openSheet('escolheDupla', { titulo: trocando ? tr('Trocar a dupla do Campo') : tr('A dupla do Campo de PvP'), ordem: true,
      rotulo: trocando ? tr('Trocar a dupla') : (ligarCoroa ? tr('Ligar a coroa e entrar') : tr('Entrar no Campo')),
      sub: tr('Toque na ordem. O <b>1º</b> é a aparência que todos veem no Campo; o <b>2º</b> é a surpresa — só aparece na luta.'),
      inicial: (campoHud.dupla.length ? campoHud.dupla : selHeroes).slice(),
      aoEscolher: function (ids) { entraNoCampo(ids, ligarCoroa, trocando); } });
  }
  function entraNoCampo(ids, ligarCoroa, trocando) {
    var H = JOGO.Hub;
    if (!H || typeof H.entraCampo !== 'function') { toast(tr('O Campo de PvP ainda está sendo construído.')); return; }
    if (safe(function () { return Dl().estado().fase; }, 'livre') !== 'livre') { toast(tr('Termine o duelo antes.')); return; }
    function vai() {
      campoHud.dupla = safe(function () { return Dl().defineDuplaCampo(ids); }, null) || ids.slice();
      campoHud.dentro = true;
      closeSheet();
      if (painelModo === 'lugar') fechaPainel();
      safe(function () { H.entraCampo({ aparencia: aparenciaDe(campoHud.dupla[0]) }); return true; }, null);
      reanunciaPerfil();
      safe(function () { return JOGO.Rede._tique(); }, null);
      pintaSeloArena();
      toast(trocando ? tr('A dupla do Campo mudou.') : tr('Você entrou no Campo de PvP. Cuidado: aqui qualquer um ataca.'), trocando ? 'good' : 'bad');
    }
    if (ligarCoroa && JOGO.DB && JOGO.DB.definirCoroaOculta) {
      JOGO.DB.definirCoroaOculta(false).then(function () { resumoCoroaOculta = false; vai(); });
    } else vai();
  }
  function saiDoCampo() {
    if (safe(function () { return Dl().estado().fase; }, 'livre') !== 'livre') { toast(tr('Termine a luta antes de sair.')); return; }
    campoHud.dentro = false;
    fechaPainel();
    safe(function () { JOGO.Hub.saiCampo(); return true; }, null);
    reanunciaPerfil();
    safe(function () { return JOGO.Rede._tique(); }, null);
    pintaSeloArena();
    toast(tr('Você voltou à praça.'));
  }
  /* ------------------------------------------- A SEDE DA GUILDA POR DENTRO (04/10)
   * Dono: "os jogadores da mesma guild entrar nesse mapa … e lá dentro ser o banco da guild
   * e o pessoal ter um chat". A Sede da praça ganhou um botão para entrar — só para quem tem
   * guilda — e, no mesmo dia, perdeu a ficha: para quem tem guilda ela só oferece o salão e a
   * guerra. Lá dentro (Hub.entraSede, a zona é 'sede:<id da guilda>') seis pontos abrem a ficha:
   * o TRONO é a guilda inteira (membros, cargos, porta, dízimo — o governo); banco, cofre e
   * mural são a mesma ficha já rolada até a parte certa; a mesa do conselho é a fila da guerra;
   * a porta devolve à praça. E o chat sem barra passa a ser o da guilda. */
  var sedeHud = { dentro: false, g: null };
  var guildaFoco = null;
  function sedeDentro() {
    var H = JOGO.Hub;
    return !!(H && typeof H.naSede === 'function' && safe(function () { return H.naSede(); }, null));
  }
  function lugarDaGuerra(l) { return l.tipo === 'sede' || l.tipo === 'sede-guerra'; }
  // o que a cena precisa da guilda: o id (a zona), e a cor e o emblema dos estandartes
  function infoDaSede(g) {
    var B = JOGO.Brasao, cod = g.emblema || '', cor = null, emb = '';
    // 04/10: o brasão desenhado vai INTEIRO para o pano (o dono: "o estandarte deve ter o brasão da guild")
    if (B && B.ehCodigo && B.ehCodigo(cod)) { cor = safe(function () { return B.partes(cod)[2]; }, null); emb = cod; }
    else emb = String(cod).slice(0, 2);
    return { id: g.id, nome: g.nome || '', cor: cor, emblema: emb };
  }
  function pedeEntrarNaSede() {
    var Gd = JOGO.Guilda, H = JOGO.Hub;
    if (!Gd || !H || typeof H.entraSede !== 'function') { toast(tr('A sede ainda está sendo construída.')); return; }
    if (safe(function () { return Dl().estado().fase; }, 'livre') !== 'livre') { toast(tr('Termine o duelo antes.')); return; }
    // quem diz se você É da guilda é a ficha de agora (o servidor), não o que a tela lembra
    Gd.minha().then(function (g) {
      var falha = !g && Gd.falhaDaFicha ? Gd.falhaDaFicha() : null;
      if (falha) { toast(tr('Não deu para ler a sua guilda agora ({falha}). Tente de novo.', { falha: falha })); return; }
      anotaGuilda(g && g.id != null ? g : null);
      if (!g || g.id == null) {
        toast(tr('Só quem é de uma guilda entra na sede.'));
        if (painelModo === 'lugar') fechaPainel();        // a Sede reabre já dizendo a verdade
        return;
      }
      entraNaSede(g);
    });
  }
  /* 04/10: a guilda pode ACABAR com você dentro do salão (a equipe a desfez, o líder te tirou).
   * O salão de uma guilda que não é mais a sua não tem dono nem ficha: cada ponto responderia
   * "sem guilda" e a pessoa ficaria presa numa sala morta. De tempos em tempos o salão confere a
   * ficha; se o servidor RESPONDEU que você não é mais dela, a porta te devolve à praça. A leitura
   * que falha não tira ninguém (Gd.minha devolve a ficha guardada). */
  var SEDE_VIGIA_MS = 20000, sedeVigia = null;
  function vigiaSede() {
    var Gd = JOGO.Guilda;
    if (!sedeHud.dentro || !Gd || !Gd.minha) return Promise.resolve(false);
    return Gd.minha().then(function (g) {
      if (!sedeHud.dentro || !sedeHud.g) return false;
      if (!g && Gd.falhaDaFicha && Gd.falhaDaFicha()) return false;
      if (g && String(g.id) === String(sedeHud.g.id)) return false;
      var nome = sedeHud.g.nome || 'guilda';
      anotaGuilda(g || null);
      if (sheetName === 'guilda') closeSheet();
      saiDaSede();
      toast(g ? tr('Você não é mais da {nome}: a porta do salão te devolveu à praça.', { nome: nome })
              : tr('A {nome} não existe mais: você voltou à praça.', { nome: nome }), 'info');
      return true;
    }, function () { return false; });
  }
  UI._vigiaSede = vigiaSede;                                // provas (tests/sede_visita.html)
  function entraNaSede(g) {
    var info = infoDaSede(g);
    if (!safe(function () { return JOGO.Hub.entraSede(info); }, false)) { toast(tr('Não deu para entrar na sede.')); return; }
    sedeHud.dentro = true;
    sedeHud.g = info;
    if (sedeVigia) clearInterval(sedeVigia);
    sedeVigia = setInterval(vigiaSede, SEDE_VIGIA_MS);
    closeSheet();
    if (painelModo === 'lugar') fechaPainel();
    reanunciaPerfil();
    safe(function () { return JOGO.Rede._tique(); }, null);
    pintaChip();
    toast(tr('Você entrou na sede da {a}. Aqui o chat é da guilda.', { a: txtGuilda(g.emblema, g.nome) }), 'good');
  }
  function saiDaSede() {
    sedeHud.dentro = false;
    if (sedeVigia) { clearInterval(sedeVigia); sedeVigia = null; }
    fechaPainel();
    safe(function () { JOGO.Hub.saiSede(); return true; }, null);
    reanunciaPerfil();
    safe(function () { return JOGO.Rede._tique(); }, null);
    pintaChip();
    toast(tr('Você voltou à praça.'));
  }
  function reentraSede() {
    var H = JOGO.Hub;
    if (!sedeHud.dentro || !sedeHud.g || !H || typeof H.entraSede !== 'function' || sedeDentro()) return;
    safe(function () { H.entraSede(sedeHud.g); return true; }, null);
    safe(function () { return JOGO.Rede._tique(); }, null);
  }
  function abreGuildaEm(foco) { guildaFoco = foco; openSheet('guilda'); }
  function painelSedeDentro(p, tipo, tituloPainel) {
    if (tipo === 'sede-banco') {
      p.appendChild(tituloPainel(tr('Banco da guilda'), 'fc-banco'));
      p.appendChild(el('p', 'hub-nota', tr('As peças que os membros deixam para emprestar uns aos outros.')));
      p.appendChild(btn(tr('Abrir o banco da guilda'), 'btn-primary btn-block sede-ponto', function () { abreGuildaEm('banco'); }));
    } else if (tipo === 'sede-cofre') {
      p.appendChild(tituloPainel(tr('Cofre da guilda'), 'fc-guilda'));
      p.appendChild(el('p', 'hub-nota', tr('As marcas da guilda: nascem das competições, e líder e oficiais gastam nos bônus de todos.')));
      p.appendChild(btn(tr('Abrir o cofre da guilda'), 'btn-primary btn-block sede-ponto', function () { abreGuildaEm('cofre'); }));
    } else if (tipo === 'sede-mural') {
      p.appendChild(tituloPainel(tr('Mural da guilda'), 'fc-guilda'));
      p.appendChild(el('p', 'hub-nota', tr('A mensagem que o líder e os oficiais deixam para todos.')));
      p.appendChild(btn(tr('Ler o mural'), 'btn-primary btn-block sede-ponto', function () { abreGuildaEm('mural'); }));
    } else if (tipo === 'sede-trono') {
      // 04/10 (dono: "a personalização da guilda deve ser dentro do salão"): o trono é o governo
      p.appendChild(tituloPainel('Trono — a guilda', 'fc-guilda'));
      p.appendChild(el('p', 'hub-nota', tr('Os membros e os cargos, a porta aberta ou por convite, o dízimo e os pedidos de entrada.')));
      p.appendChild(btn(tr('Abrir a ficha da guilda'), 'btn-primary btn-block sede-ponto', function () { abreGuildaEm('cab'); }));
    } else if (tipo === 'sede-guerra') {
      p.appendChild(tituloPainel(tr('Mesa do conselho'), 'fc-guilda'));
      painelGuerra(p);
      // 10/10: o torneio de guilda também se resolve daqui — os voluntários e a escolha do representante
      if (Tn()) {
        p.appendChild(btn(tr('Torneio das Guildas'), 'btn-ghost btn-block sede-torneio', function () {
          var tg = safe(function () { return Tn().proximos().filter(function (t) { return t.tipo === 'guilda'; })[0]; }, null);
          openSheet('torneio', tg ? { id: tg.id } : 'lista');
        }));
      }
    } else if (tipo === 'sede-saida') {
      p.appendChild(el('h3', null, tr('Sair da sede')));
      p.appendChild(el('p', 'hub-nota', tr('A porta dá na praça, em frente à Sede das Guildas.')));
      p.appendChild(btn(tr('Voltar à praça'), 'btn-warn btn-block sede-sair', saiDaSede));
    }
  }
  // provas (tests/sede_visita.html): o estado, e o `guilda` que finge a resposta da ficha
  UI._sede = function (guilda) {
    if (guilda !== undefined) { resumoGuilda = guilda ? { nome: guilda.nome, emblema: guilda.emblema } : null; guildaSoube(); }
    return { dentro: sedeHud.dentro, g: sedeHud.g, temGuilda: !!resumoGuilda, foco: guildaFoco, sabe: guildaLida };
  };
  function reentraCampo() {
    var H = JOGO.Hub;
    if (!campoHud.dentro || !H || typeof H.entraCampo !== 'function' || campoDentro()) return;
    safe(function () { H.entraCampo({ aparencia: aparenciaDe(campoHud.dupla[0]) }); return true; }, null);
    safe(function () { return JOGO.Rede._tique(); }, null);
  }
  /* 08/10 à noite (o dono: "no Campo de PvP só clicando em cima agride? não deveria aparecer uma mensagem para
   * confirmar?"): o toque abre a pergunta — o ataque só sai no "Atacar". A recusa (paridade, fora do Campo, sem
   * vida) continua curta, depois da confirmação. */
  function ataqueNoCampo(par) {
    confirmSheet(tr('Atacar {nome}?', { nome: esc(par.nome) }),
      tr('A luta começa na hora e <b>{nome}</b> não pode recusar. Vocês dois precisam estar no Campo, com a dupla viva e dentro da paridade.', { nome: esc(par.nome) }),
      function () { disparaAtaqueNoCampo(par); }, { sim: tr('Atacar'), simCls: 'btn-warn' });
  }
  function disparaAtaqueNoCampo(par) {
    var r = safe(function () { return Dl().atacar(par.id); }, null);
    if (r && r.ok) { toast(tr('Você atacou {nome}!', { nome: par.nome }), 'bad'); return; }
    var m = r ? r.motivo : 'ocupado';
    if (m === 'vida-zero') toast(tr('A sua dupla está sem vida{a} ou beba uma poção.', { a: r.esperaS ? ': espere ' + r.esperaS + ' s' : '' }));
    else if (m === 'paridade') toast(tr('A diferença de nível passa de 10 (você nv {meu}, {nome} nv {dele}): aqui não dá.', { meu: r.meu, nome: par.nome, dele: r.dele }));
    else if (m === 'alvo-fora' || m === 'alvo-luta') toast(textoMotivo(m, par.nome));
    else toast(textoMotivo(m, null));
  }
  UI._campo = function () { return { dentro: campoHud.dentro, dupla: campoHud.dupla.slice() }; };   // provas

  function aoDueloMudou(est) {
    pintaPedido();                 // 06/10: o desafio que chega, o meu que espera e o que acabou
    var f = est ? est.fase : 'livre';
    // 14/09: a Arena (duplas do quadro) e o Campo (a dupla do Campo) não têm ficha de escolha
    if (est && (est.modo === 'arena' || est.modo === 'campo')) { if (sheetName === 'dueloRede') closeSheet(); return; }
    if (f === 'escolhendo' || f === 'comprometido' || f === 'revelado' || (f === 'batalha' && sheetName === 'dueloRede')) {
      if (current === 'hub') openSheet('dueloRede');
    } else if (sheetName === 'dueloRede') closeSheet();
  }
  function nomeClima(id) {
    var w = (D().weathers && D().weathers[id]) || null;
    return (w && w.name) || id || 'calmo';
  }
  function duelFimRede(s, data) {
    if (data.guerra) { guerraFim(s, data); return; }        // 15/09: a guerra de guilda
    var box = el('div', 'game-over du-fim du-rede');
    var op = data.oponente || {};
    var nomeOp = (typeof op === 'string' ? op : op.nome) || tr('O outro lado');
    var tit = data.contestado ? tr('Duelo anulado.')
            : (data.empate ? tr('Empate.') : (data.venci ? tr('Você venceu!') : nomeOp + ' venceu.'));
    box.appendChild(el('h1', null, esc(tit)));
    if (data.contestado) {
      // 11/09 (revisão): as duas batalhas não bateram (ou chegou um lance/fim que não valia): sem vencedor
      box.appendChild(el('p', 'game-sub', tr('As duas batalhas não bateram — o duelo ficou sem vencedor.')));
    } else if (data.wo) {
      // 15/09: o W.O. só vale com a queda que o servidor confirma — e aí custa como a desistência
      box.appendChild(el('p', 'game-sub', data.venci ? tr('{a} saiu da arena — vitória por W.O. (o servidor confere a queda).', { a: esc(nomeOp) })
                                                     : tr('Você ficou fora da arena — derrota por W.O.: com a queda confirmada, os seus heróis saem com a vida a 0.')));
    } else if (data.desistencia) {
      // 15/09: desistir conta como derrota — a vida a 0 e, onde vale coroa, a derrota na Brasa
      var coroa = (data.modo === 'arena' || data.modo === 'campo') ? tr(' e a coroa conta a derrota') : '';
      box.appendChild(el('p', 'game-sub', data.venci ? tr('{a} desistiu do duelo — conta como derrota dele.', { a: esc(nomeOp) })
                                                     : tr('Você desistiu do duelo — conta como derrota: os seus heróis saem com a vida a 0{coroa}.', { coroa: coroa })));
    }
    var nomes = function (lista) {
      return (lista || []).map(function (c) {
        return className((c && typeof c === 'object') ? (c.classId || c.heroId) : c);
      }).join(tr(' e '));
    };
    box.appendChild(el('p', 'game-sub', tr('Você: {a} · {b}: {c}', { a: esc(nomes(data.duplaMinha)), b: esc(nomeOp), c: esc(nomes(data.duplaDele)) })));
    var ar = data.arena || {};
    box.appendChild(el('p', 'game-sub', (ar.nome ? tr('Arena: {a}', { a: esc(ar.nome) }) + ' · ' : '') + 'clima: ' + esc(nomeClima(data.clima))));
    // 14/09: o que valeu depende do modo — o desafio nunca mexe na coroa; a Arena e o Campo o servidor confere
    // 10/10: a luta do Torneio da Arena é um duelo no modo 'arena' que NÃO mexe na coroa nem na vida única
    var doTorneio = data.modo === 'arena' && !!safe(function () {
      var le = JOGO.Torneio.lutaEntregue(data.did || undefined);
      return le && (data.did || Date.now() - le.t < 45 * 60 * 1000);
    }, false);
    box.appendChild(el('p', 'du-valeria', data.modo === 'desafio'
      ? tr('Desafio amistoso — a coroa não muda.')
      : doTorneio ? tr('Luta do Torneio da Arena — o servidor confere a luta e a chave anda; a coroa não muda e a vida fica como estava antes da luta.')
      : (data.modo === 'arena' || data.modo === 'campo')
        ? (data.modo === 'arena'
          ? tr('Arena ranqueada — o servidor confere a luta e a coroa muda (o aviso chega em instantes).')
          : tr('Campo de PvP — o servidor confere a luta e a coroa muda (o aviso chega em instantes).'))
        : tr('Amistoso — a Brasa de verdade acende quando o servidor apitar o duelo.{a}', { a: data.seValesse != null ? ' ' + tr('Se valesse: +{a}.', { a: esc(data.seValesse) }) : '' })));
    box.appendChild(vidaBloco('fim'));       // 14/09: o meu lado sai do duelo com a vida com que terminou
    var ult = safe(function () { return Dl().ultimo(); }, null);
    var opId = (op && op.id) || (ult && ult.id) || null;
    var naPraca = !!opId && !!safe(function () {
      return JOGO.Rede.pares().some(function (p) { return p.id === opId && !p.sala; });
    }, false);
    if (naPraca && data.modo !== 'arena' && data.modo !== 'campo') {
      box.appendChild(btn(tr('Desafiar de novo'), 'btn-gold btn-block', function () {
        navTo('hub');
        var r = safe(function () { return Dl().desafiar(opId); }, null);
        toast(r && r.ok ? tr('Desafio enviado a {nomeOp}. Esperando a resposta…', { nomeOp: nomeOp }) : textoMotivo(r ? r.motivo : 'ocupado', null));
      }));
    }
    // 14/09: do Campo de PvP se volta ao Campo (buildHub → reentraCampo)
    box.appendChild(btn(data.modo === 'campo' && campoHud.dentro ? tr('Voltar ao Campo de PvP') : tr('Voltar ao Acampamento'),
      'btn-primary btn-block', function () { navTo('hub'); }));
    s.appendChild(box);
  }

  // ------------------------------------------------ os ganchos, UMA vez
  var grupoSigTela = '', ficouSoTela = false;
  function aoGrupoMudou(est) {
    /* 06/10: o parceiro voltou ao acampamento e a minha descida virou solo (Grupo.ficaSozinho): a antessala se
     * refaz inteira — o quadro da vida, a porta e a saída são montados para o grupo ou para quem desce sozinho — e a
     * recompensa troca o rodapé. Ninguém é levado: a tela é a mesma, só deixa de esperar por ele. */
    var soAgora = !!(est && est.ficouSo);
    if (soAgora && !ficouSoTela) {
      ficouSoTela = true;
      if (current === 'antessala') safe(function () { UI.repaint(); return true; }, null);
      else if (current === 'roomClear') { if (lastRewards) lastRewards.rede = false; buildRewards(current, lastRewards); }
    }
    ficouSoTela = soAgora;
    pintaPedido();                 // 06/10: o convite que chega, o meu que espera e o que acabou
    pintaGrupoLado();
    var sig = est ? [est.fase, est.lider, (est.membros || []).map(function (m) {
      var hsS = (m.herois && m.herois.length) ? m.herois : (m.heroi ? [m.heroi] : []);
      return m.id + (m.on ? 1 : 0) + hsS.map(function (h) { return (h.classId || '') + (h.level || ''); }).join('+');
    }).join(','), est.descendo ? 1 : 0, est.descidaGrupo, est.descidaAcabou, est.descidaDif || ''].join('|') : '';
    if (sig === grupoSigTela) return;
    grupoSigTela = sig;
    if (current === 'hub' || current === 'antessala') repintaLugar();
    else if (current === 'roomClear' || current === 'dungeonComplete') buildRewards(current, lastRewards);
    else if (current === 'defeat') buildDefeat();
    else if (current === 'battle') battleSig = '';
  }
  function ligaSocial() {
    var Gr = Gp(), Du = Dl(), S = Su(), C = Cp();
    if (Gr) {
      Gr.aoMudar = aoGrupoMudou;
      Gr.aoConvite = function () { pintaPedido(); };          // 06/10: o cartão sai do estado (pintaPedido)
      Gr.aoAviso = function (t, k) { toast(t, k); };
      Gr.aoSubiu = function () {
        closeSheet();
        var t = safe(function () { return G().screen; }, '');
        if (t === 'antessala') safe(function () { return G().abandonar(); }, false);
        else if (t !== 'hub' && t !== 'menu' && t !== 'heroSelect') safe(function () { G().restart('hub'); return true; }, null);
        navTo('hub');
      };
    }
    if (Du) { Du.aoMudar = aoDueloMudou; Du.aoDesafio = function () { pintaPedido(); }; }
    // 06/10: a troca também (antes os ganchos dela eram refeitos a cada buildHub, presos ao painel daquela montagem)
    if (JOGO.Troca) { JOGO.Troca.aoConvite = aoTrocaConvite; JOGO.Troca.aoMudar = aoTrocaMudou; }
    // 14/09: o quadro da Arena — o selo, o painel do adversário encontrado e os relógios
    var Aq = Ar();
    if (Aq) {
      Aq.aoMudar = aoArenaMudou;
      Aq.aoCasou = mostraArenaCasada;
      if (!arenaRelogio) arenaRelogio = setInterval(function () { safe(function () { tiqueArenaTela(); return true; }, null); }, 1000);
    }
    // 10/10: o Torneio da Arena — a ficha, a chamada que não some e a tela do campeão
    var Tq = Tn();
    if (Tq) {
      Tq.aoMudar = aoTorneioMudou;
      Tq.aoCampeao = aoTorneioCampeao;
      Tq.aoChamada = function (l) {
        pintaChamada();
        if (l && l.adversario) toast(tr('Torneio: a sua luta contra {a} foi chamada — diga que está aqui!', { a: l.adversario.nome }), 'good');
      };
      if (!arenaRelogio) arenaRelogio = setInterval(function () { safe(function () { tiqueArenaTela(); return true; }, null); }, 1000);
    }
    // 15/09: a guerra de guilda — o painel da Sede, os adversários encontrados e o fim que o servidor confere
    var Wg = Gu();
    if (Wg) {
      Wg.aoMudar = aoGuerraMudou;
      Wg.aoCasou = mostraGuerraCasada;
      Wg.aoConvite = function (e) {
        toast(tr('{a} inscreveu o grupo na guerra de guilda — vá à Sede escolher a sua dupla.', { a: esc(((e && e.lider) || {}).nome || tr('Quem lidera')) }), 'good');
      };
      if (!arenaRelogio) arenaRelogio = setInterval(function () { safe(function () { tiqueArenaTela(); return true; }, null); }, 1000);
    }
    if (S) S.aoChegar = aoSussurroChegou;
    if (C) {
      C.aoMudar = aoCoopMudou;
      // os avisos da batalha em dupla ("Bia caiu…", "Bia não respondeu"): toast,
      // com a cor pelo tipo que o Coop manda ('ok' | 'aviso' | 'info')
      C.aoAviso = function (t, k) { toast(t, k === 'ok' ? 'good' : (k === 'aviso' ? 'bad' : undefined)); };
    }
  }
  /* OS DOIS SELECIONADOS VAO AO GRUPO (12/09, pedido do dono: "quando forem
   * para um calabouco podem ir com os dois personagens selecionados... no caso
   * 4 personagens no maximo"). Antes ia so o principal, e a descida em grupo
   * nascia com um heroi de cada lado. */
  function avisaHeroiAoGrupo() {
    var Gr = Gp();
    if (!Gr || !selHeroes[0]) return;
    if (Gr.defineHerois) safe(function () { Gr.defineHerois(selHeroes.slice()); return true; }, null);
    else if (Gr.defineHeroi) safe(function () { Gr.defineHeroi(selHeroes[0]); return true; }, null);
    guardaDupla();
  }
  /* A DUPLA LEMBRADA (12/09, pedido do dono: "sempre que um jogador logar
   * novamente deve vir automaticamente para a praça com os últimos personagens
   * selecionados"). Guardada a cada troca de tela — junto do aviso ao grupo,
   * que é o outro lugar onde a escolha importa fora desta tela —, e nunca
   * quando está vazia (senão uma tela de boot apagaria a escolha de ontem). */
  var duplaGuardada = '';
  function guardaDupla() {
    if (!selHeroes.length || !JOGO.DB || !JOGO.DB.definirDupla) return;
    var chave = selHeroes.join(',');
    if (chave === duplaGuardada) return;
    duplaGuardada = chave;
    safe(function () { JOGO.DB.definirDupla(selHeroes.slice()); return true; }, null);
  }
  /* ENTRAR DIRETO NA PRAÇA (12/09). Uma vez por carregamento da página: se a
   * conta já tem uma dupla lembrada e ela ainda serve (as classes existem e
   * seguem liberadas), a tela de escolha é pulada e o jogo abre no
   * Acampamento. Quem quiser trocar vai no Menu, que é o que o dono pediu.
   * Só age se o jogador ainda não saiu do menu por conta própria — um clique
   * durante a leitura do save (que é uma promessa) manda mais que isto. */
  var tentouEntrarDireto = false;
  /* O MESTRE (12/09, pedido do dono): o modo ligado, e a CONTA do Mestre com o
   * herói dele no save — essa conta só tem o Mestre do Fundo, então entra
   * direto na praça com ele e nunca vê a tela de escolha. */
  function mestreAtivo() {
    return !!(JOGO.GM && JOGO.GM.ativo && safe(function () { return JOGO.GM.ativo(); }, false));
  }
  function soMestreDoFundo() {
    return mestreAtivo() && !!(JOGO.GM.contaMestre && safe(function () { return JOGO.GM.contaMestre(); }, false)) &&
      !!hero('gm');
  }
  // abre o painel único do Mestre por cima da tela em que está (na última aba aberta); aberto, fecha
  function alternaPainelMestre() {
    if (!mestreAtivo()) return;
    var PM = JOGO.PainelMestre;
    if (PM && PM.alterna) PM.alterna();
    else gmAbre('grimorio');
  }
  /* Quem NÃO entra direto: as provas (tests/*.html abrem o jogo num iframe e
   * esperam o menu para dirigir a partir dele — com a dupla lembrada no save
   * da origem de testes, o jogo pulava o menu e as provas esperavam para
   * sempre) e quem pede o menu pelo endereço (`?menu`). */
  function pulaEntradaDireta() {
    try { if (window.top !== window) return true; } catch (e) { return true; }
    try { return /[?&](menu|sandbox|prova)/.test(String(location.search || '')); } catch (e2) { return false; }
  }
  function entraDiretoNaPraca() {
    if (tentouEntrarDireto || !JOGO.DB || !JOGO.DB.jogador) return;
    tentouEntrarDireto = true;
    if (pulaEntradaDireta()) return;
    JOGO.DB.jogador().then(function (j) {
      // a conta do Mestre não precisa de dupla lembrada: é sempre o Mestre do Fundo.
      // Aqui dentro, e não antes da promessa: síncrono, o boot ainda repunha o menu depois
      if (soMestreDoFundo()) {
        if (current === 'menu') { selHeroes = ['gm']; duplaGuardada = 'gm'; navTo('hub'); }
        return;
      }
      var lista = (j && j.dupla) || [];
      if (!lista.length || current !== 'menu' || selHeroes.length) return;
      var boa = [];
      lista.forEach(function (hid) {
        if (hid && hero(hid) && isUnlocked(hid) && boa.length < 2) boa.push(hid);
      });
      if (!boa.length) return;
      selHeroes = boa;
      duplaGuardada = boa.join(',');
      navTo('hub');
    }).catch(function () {});
  }
  /* a cada tela: o herói principal ao grupo, o painel do canto, o menu fechado */
  function socialNaTela(name) {
    avisaHeroiAoGrupo();
    if (name !== 'antessala') chamandoPorta = 0;
    fechaGlMenu();
    glSig = '';
    pintaGrupoLado();
  }
  /* o tique de ~1 s do UI.update: o painel do canto (carência, conexão) */
  function tiqueSocial(dt) {
    tickSocial += (dt || 0.016);
    if (tickSocial < 1) return;
    tickSocial = 0;
    pintaGrupoLado();
    pintaPedido();                 // 06/10: o relógio do cartão — e o que mudou sem avisar
    // 11/09 (revisão): a ficha da escolha do duelo fechada sem querer (o ✕, o toque
    // no fundo escuro, outra ficha por cima) volta sozinha enquanto falta a minha
    // dupla — ela só abria quando o estado MUDAVA, e o duelo morria no prazo de 90 s.
    // Sair continua sendo o "Desistir do duelo" da própria ficha.
    var de = safe(function () { return Dl().estado(); }, null);
    if (current === 'hub' && !sheetName && de && de.fase === 'escolhendo' && !de.escolhi) openSheet('dueloRede');
    var ec = safe(function () { return JOGO.Rede.estadoConexao(); }, null);
    if (ec !== ultConexao) {
      if (ec === 'religando' && (emGrupo() || modoRede())) toast(tr('Sem conexão — tentando de novo…'), 'bad');
      ultConexao = ec;
    }
  }

  // ==========================================================================
  // EVENTOS DO ENGINE  →  log compacto
  // ==========================================================================
  var EV_TEXT = {
    dodgeFail: function (ev) { return tr('{a} foi fixado e perdeu o passo.', { a: nameOf(ev.uid) }); },
    dodgeOk: function (ev) { return nameOf(ev.uid) + ' escapou.'; },
    weatherShift: function (ev) {
      var w = (D().weathers && D().weathers[ev.weather]) || null;
      return tr('O clima vira {a}.', { a: (w && w.name) || ev.weather });
    },
    weatherTick: function (ev) {
      return (ev.amount > 0
        ? tr('{a} se recupera (+{b} PV){c}', { a: nameOf(ev.uid), b: Math.abs(ev.amount), c: ev.amount > 0 ? '' : '' })
        : tr('{a} sofre com o clima ({b} PV){c}', { a: nameOf(ev.uid), b: Math.abs(ev.amount), c: ev.amount > 0 ? '' : '' }));
    },
    tileEvent: function (ev) { return ev.text || (tr('{a} pisou em algo.', { a: nameOf(ev.uid) })); },
    trapTriggered: function (ev) { return tr('{a} pisou numa armadilha!', { a: nameOf(ev.uid) }); },
    markStack: function (ev) { return tr('{a} está marcado ({stacks}).', { a: nameOf(ev.uid), stacks: ev.stacks }); },
    petAct: function (ev) { return nameOf(ev.uid) + ' agiu sozinho.'; },
    fusion: function (ev) { return tr('FUSÃO! {a} entra em campo.', { a: nameOf(ev.uid) }); }
  };
  function nameOf(uid) {
    var u = unitByUid(uid);
    return esc((u && (u.name || u.defId)) || tr('alguém'));
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

  var avisouEspinhos = false;        // 03/10: o aviso dos espinhos sai uma vez por batalha
  UI.handleEvent = function (ev) {
    if (!ev || !ev.type) return;
    if (ev.type === 'timerTick') { paintTimer(); return; }
    if (ev.type === 'prepTick') { pintaPrep(); return; }      // 21/09: o relógio da preparação
    if (ev.type === 'battleStart') avisouEspinhos = false;
    if (current !== 'battle') return;
    // 15/10: a FUSÃO é o que o jogador mostra — a faixa com "Compartilhar" (só a minha, na dupla)
    if (ev.type === 'fusion') {
      var ufu = unitByUid(ev.uid);
      if (ufu && JOGO.Compartilhar) safe(function () { ofereceCompartilharFusao(ufu); return true; }, null);
    }
    /* 03/10 — OS ESPINHOS DO MURO. A primeira vez que um dos MEUS encosta no muro de espinhos do
     * outro lado, o porquê vai à torrada (a linha do diário é miúda e o número parece só mais um
     * golpe); depois disso o vermelho das casas de passo já ensina. */
    if (ev.type === 'muroFere' && !avisouEspinhos) {
      var vEsp = unitByUid(ev.uid);
      var meuLado = safe(function () { return G().meuLado(); }, 'player');
      if (vEsp && vEsp.side === meuLado) {
        avisouEspinhos = true;
        toast((ev.motivo === 'empurrado'
          ? tr('{a} foi jogado contra o muro de espinhos: −{amount}. Casa vizinha de muro com espinhos fere no fim da vez.', { a: vEsp.name || vEsp.defId, amount: ev.amount })
          : tr('{a} terminou a vez encostado no muro de espinhos: −{amount}. Casa vizinha de muro com espinhos fere no fim da vez.', { a: vEsp.name || vEsp.defId, amount: ev.amount })), 'bad');
      }
    }
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
        toast((ev.critical
          ? tr('{a} foi fixado: perdeu todo o PP e 1 PA sem sair do lugar.', { a: vit.name || vit.defId })
          : tr('{a} foi fixado: perdeu todo o PP sem sair do lugar.', { a: vit.name || vit.defId })), 'bad');
      }
    }
    if (ev.type === 'fusion' || ev.type === 'turnStart' || ev.type === 'turnEnd') battleSig = '';
    // 11/09 (revisão): o painel do grupo solta (ou volta a segurar) o toque na
    // virada do turno, sem esperar o tique de 1 s
    if (ev.type === 'turnStart' || ev.type === 'turnEnd') pintaGrupoLado();
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
    tiqueSocial(dt);
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
    // 10/09: com os dados que a tela já tinha. Sem eles, o redesenho de quando os
    // modelos 3D terminam de carregar zerava a recompensa (+0 XP, sem os chips
    // dos eventos) — o ganho de verdade já estava aplicado; o erro era só de tela.
    var dados;
    if (current === 'roomClear' || current === 'dungeonComplete') dados = lastRewards;
    else if (current === 'elementChoice') dados = lastElementChoice;
    else if (current === 'duelFim') dados = lastDuelFim;
    try { if (current && screens[current]) UI.showScreen(current, dados); } catch (e) {}
    // 02/10: a ficha de excluir a conta tem o nome e a senha digitados — redesenhar a
    // apagaria (e o openSheet não a conhece: fecharia); ela fica como está, como a confirmação
    if (eraNome && eraNome !== 'confirm' && eraNome !== 'excluir-conta') {
      try { openSheet(eraNome, eraArg); } catch (e2) {}
    }
  };

  // acesso para testes/galeria
  UI.screens = screens;
  UI.telaAtual = function () { return current; };   // 11/09: o 'hub' não existe no Game.screen
  UI.selection = function (ids) {
    if (ids) { selHeroes = ids.slice(0, 2); avisaHeroiAoGrupo(); }
    return selHeroes.slice();
  };
  UI.toast = toast;
  UI.titExibe = titExibe;   // 05/10: a plaquinha dos outros jogadores (hud3d) mostra o título no idioma de quem olha
  /* 07/10: os avisos da trilha da temporada e da meta da semana da guilda (game.js dispara ao fechar a sala
   * no servidor). O toast só, fora da batalha; a ficha das Missões e a da guilda mostram o resto. */
  try {
    window.addEventListener('soterra:trilha', function (ev) {
      var t = ev && ev.detail;
      if (!t || !(t.ganhou > 0)) return;
      var motivo = { sala: tr('sala vencida'), duelo: tr('duelo ranqueado'), eco: tr('tentativa do Eco'), missao: tr('missão diária') }[t.motivo] || t.motivo || '';
      toast(tr('+{a} pontos na trilha da temporada ({b})', { a: t.ganhou, b: motivo }), 'good');
    });
    window.addEventListener('soterra:guilda-meta', function () {
      toast(tr('Meta da semana da guilda cumprida! +15% de XP e de saque para todos até domingo.'), 'good');
    });
  } catch (eTr) {}
  UI.version = '2.2';
})();
