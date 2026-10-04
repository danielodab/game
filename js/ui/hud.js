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
  var forjaQuebrando = false;

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

  /* NÍVEL DE USO (10/09, pedido do dono): a régua é do dado (items.js) e a
   * cobrança é do Progress ([D19]); a ficha só MOSTRA o "Nv. N" de cada peça
   * e bicho, apaga (is-trancado) o que o herói escolhido ainda não veste e,
   * na tentativa, diz o motivo com nome e número. Sem régua nada aparece. */
  function nivelUsoDe(id) { return safe(function () { return P().nivelUsoDe(id); }, 0) || 0; }
  function nvBadge(id, cls) {
    var n = nivelUsoDe(id);
    return n > 0 ? el('span', cls || 'ig-nv', 'Nv. ' + n) : null;
  }
  function nvTxt(id) { var n = nivelUsoDe(id); return n > 0 ? ' · Nv. ' + n : ''; }
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
    if (!r) return 'Não deu para equipar essa peça.';
    var hh = hero(r.heroId);
    var quem = className((hh && hh.classId) || r.heroId);
    if (r.petId) {
      var pd = petDef(r.petId);
      return ((pd && pd.name) || r.petId) + ': pets a partir do nível ' + r.precisa +
             ' — o ' + quem + ' está no ' + r.nivel;
    }
    var it = itemDef(r.itemId);
    return ((it && it.name) || r.itemId) + ' pede o nível ' + r.precisa +
           ' — o ' + quem + ' está no ' + r.nivel;
  }
  function recusaAtual() { return safe(function () { return P().ultimaRecusa; }, null); }
  function limpaRecusa() { safe(function () { P().ultimaRecusa = null; return true; }, false); }
  /* O saneamento devolveu peças/bichos ao carregar (herói abaixo do nível
   * delas)? UM toast, consumindo a lista — o Acampamento avisa na entrada e a
   * ficha do inventário cobre as páginas sem praça. Consumir GRAVA a migração
   * (Progress.devolvidasPorNivel(true) salva): a abertura seguinte já não
   * acha a peça vestida e o toast não se repete. */
  function avisaDevolvidasPorNivel() {
    var lista = safe(function () { return P().devolvidasPorNivel(true); }, []) || [];
    if (!lista.length) return;
    var pecas = 0, bichos = 0;
    lista.forEach(function (d) { if (d.petId) bichos++; else pecas++; });
    var partes = [];
    if (pecas) partes.push(pecas + ' peça(s) voltaram ao saco');
    if (bichos) partes.push(bichos + ' bicho(s) voltaram à lista');
    toast(partes.join(' e ') + ': o herói ainda não tem o nível delas.');
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
    'sem-saldo': 'vinténs insuficientes neste jogo',
    'classe-ja-liberada': 'a classe já estava liberada',
    'item-invalido': 'o item não existe nesta versão do jogo',
    'erro-local': 'a entrega falhou aqui; os vinténs voltaram'
  };
  // o presente do Mestre não tem vintém para voltar
  var MOTIVO_PRESENTE = { 'erro-local': 'a entrega falhou aqui' };
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
    return z(d.getDate()) + '/' + z(d.getMonth() + 1) + ' às ' + z(d.getHours()) + ':' + z(d.getMinutes());
  }
  UI.avisoLojaTexto = function (d) {
    if (!d || typeof d !== 'object' || (d.tipo !== 'entregue' && d.tipo !== 'recusado')) return null;
    var ped = (d.pedido && typeof d.pedido === 'object') ? d.pedido : {};
    var nome = ped.nome ? String(ped.nome) : 'um pedido';
    var ent = (ped.entrega && typeof ped.entrega === 'object') ? ped.entrega : {};
    var origem = (d.origem === 'presente' || ped.origem === 'presente') ? 'presente'
      : ((d.origem === 'pagamento' || ped.origem === 'pagamento') ? 'pagamento'
      : ((d.origem === 'eco' || ped.origem === 'eco') ? 'eco' : 'loja'));
    // 02/10: o prêmio da semana do Eco Primordial (servidor/supremo.py) — vinténs, selos e o título
    if (origem === 'eco') {
      if (d.tipo !== 'entregue') return { texto: 'O prêmio do Eco não entrou aqui: ele volta na próxima abertura', tipo: null };
      if (ent.tipo === 'vintens') return { texto: 'Prêmio do Eco Primordial: ' + lojaMilhar(ent.qtd) + ' vinténs', tipo: 'good' };
      var partesEco = [];
      if (ent.titulo) partesEco.push('o título “' + String(ent.titulo) + '”');
      var nSelos = 0;
      if (ent.selos && typeof ent.selos === 'object') {
        Object.keys(ent.selos).forEach(function (k) { nSelos += Math.max(0, Math.floor(Number(ent.selos[k]) || 0)); });
      }
      if (nSelos) partesEco.push(nSelos + (nSelos === 1 ? ' selo' : ' selos') + ' de chefe');
      return { texto: 'Prêmio do Eco Primordial' + (ent.posicao ? ' (' + ent.posicao + 'º da semana)' : '') + ': ' +
                      (partesEco.join(' e ') || nome), tipo: 'good' };
    }
    if (d.tipo === 'entregue') {
      // 13/09: a troca de vinténs por barras de ouro não traz nada para o jogo — as barras vão para a conta do site
      var txt = (origem === 'pagamento') ? 'Chegaram ' + lojaMilhar(ent.qtd) + ' vinténs do seu pacote'
        : (ent.tipo === 'barras' && origem === 'loja') ? 'Troca feita: ' + nome + ' na sua conta do site'
        : (origem === 'presente' ? 'Presente do Mestre: ' : 'Chegou da loja: ') + nome;
      if (ent.tipo === 'bonus-xp') {
        var ate = (typeof d.ate === 'number' && d.ate > 0) ? d.ate : safe(function () { return P().bonusXpAte(); }, 0);
        var quando = (ate > 0) ? lojaQuando(ate) : '';
        if (quando) txt += ' — vale até ' + quando;
      }
      return { texto: txt, tipo: 'good' };
    }
    if (origem === 'pagamento') {
      return { texto: 'O pacote de vinténs não entrou aqui: ele volta na próxima abertura (' + nome + ')', tipo: null };
    }
    var mot = (origem === 'presente' && MOTIVO_PRESENTE[d.motivo]) || MOTIVO_LOJA[d.motivo] || 'recusado';
    return { texto: (origem === 'presente' ? 'Presente do Mestre devolvido: ' : 'Pedido devolvido: ') + mot + ' (' + nome + ')',
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
    if (r.ok) partes.push(r.ok === 1 ? 'Chegou mais 1 entrega da loja' : 'Chegaram mais ' + r.ok + ' entregas da loja');
    if (r.volta) partes.push((r.ok ? 'e ' : '') + (r.volta === 1 ? '1 pedido foi devolvido' : r.volta + ' pedidos foram devolvidos'));
    r.texto = partes.join(', ') + (r.volta ? ' — veja em "Seus pedidos", na loja do site.' : '.');
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
      cx.appendChild(el('h2', null, 'Você saiu por inatividade'));
      cx.appendChild(el('p', null, 'Ficou ' + Math.round((Se.INATIVO_MS || 900000) / 60000) +
        ' minutos sem jogar, então ' + (info && info.tinhaConta ? 'a sua conta saiu e ' : '') +
        'a conexão fechou para não ocupar o servidor. O seu progresso já está guardado.'));
      var b = el('button', 'btn btn-primary', 'Entrar de novo');
      b.type = 'button';
      tap(b, function () { try { location.reload(); } catch (e) {} });
      cx.appendChild(b);
      var a = el('a', 'btn btn-ghost', 'Ir para o site');
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
      tipOn(chip, defs[k].name, esc(defs[k].description || '') +
        '<br><i>Você tem ' + n + '.</i>', elemColor(defs[k].element));
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
        ? (pg.salasXp ? pg.salasXp + ' salas' : 'Sabedoria')
        : 'Pergaminho da Sabedoria' + (pg.salasXp ? ' (' + pg.salasXp + ' salas ativas)' : '')));
      c1.title = 'Pergaminho da Sabedoria ×' + pg.xp + (pg.salasXp ? ' (' + pg.salasXp + ' salas ativas)' : '');
      tap(c1, function () { lerSabedoria(aoMudar); });
      out.push(c1);
    }
    if (pg.elemento) {
      var c2 = chip('perg-el');
      c2.appendChild(el('span', 'perg-glifo', '↺'));
      c2.appendChild(el('span', 'stone-n', '×' + pg.elemento));
      c2.appendChild(el('span', 'stone-nm', compacto ? 'Reescrita' : 'Pergaminho da Reescrita'));
      c2.title = 'Pergaminho da Reescrita ×' + pg.elemento;
      tipOn(c2, 'Pergaminho da Reescrita ×' + pg.elemento,
        'Troca UM caminho elemental de um herói por outro que ele ainda não tem, no mesmo lugar. ' +
        'Use no Acampamento, na ficha do herói — bloco <b>Caminhos elementais</b>. ' +
        'Trocar o caminho ativo entre os liberados continua de graça.', '#7fd6c8');
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
    if (!(min >= 1)) return 'menos de 1 min';
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
    c.appendChild(el('span', 'stone-nm', 'Bônus de XP'));
    c.appendChild(el('span', 'stone-n', bonusFmt(fator)));
    c.appendChild(el('span', 'stone-nm', '· ' + bonusFalta(falta)));
    c.title = 'Bônus de XP ' + bonusFmt(fator) + ' · ' + bonusFalta(falta);
    tipOn(c, 'Bônus de XP ' + bonusFmt(fator),
      '+' + Math.round((fator - 1) * 100) + '% de experiência para o grupo até ' + esc(lojaQuando(ate)) + '. ' +
      'Não soma com o Pergaminho da Sabedoria; com evento de XP, os dois param em ×2.', '#e8c25a');
    return c;
  }
  function lerSabedoria(aoMudar) {
    var pg = safe(function () { return P().pergaminhos(); }, null) || {};
    var cfg = (D().pergaminhos || {}).xp || {};
    var salas = cfg.salas || 9, teto = cfg.tetoSalas || 27;
    var pct = Math.round(((cfg.fator || 1.5) - 1) * 100);
    var ativas = pg.salasXp || 0;
    if (!pg.xp) {
      toast('Nenhum Pergaminho da Sabedoria guardado — ' + ativas + ' salas ainda com o bônus.');
      return;
    }
    if (ativas + salas > teto) {
      toast('Já há ' + ativas + ' salas com o bônus (o teto é ' + teto + '). Leia depois de vencer mais salas.');
      return;
    }
    confirmSheet('Ler o Pergaminho da Sabedoria?',
      '<b>+' + pct + '% de experiência</b>: vale para o grupo nas próximas ' + salas + ' salas vencidas' +
      (ativas ? ' (somam às ' + ativas + ' que já estão ativas)' : '') + '; em calabouço raso para o nível, ' +
      'o corte de XP come o bônus. Com um evento de XP no ar, os dois juntos param em ×2. ' +
      'Derrota e abandono não gastam carga. Guardados: ' + pg.xp + '.',
      function () {
        var r = safe(function () { return P().lePergaminhoXp(); }, null);
        if (r && r.ok) toast('Pergaminho lido: ' + r.salas + ' salas com +' + pct + '% de XP.', 'good');
        else toast(r && r.motivo === 'cheio' ? 'O teto é ' + teto + ' salas ativas.' : 'Não há pergaminho para ler.');
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
    box.appendChild(el('p', 'game-sub', 'Desça. O fundo tem dono.'));

    /* O MENU É UMA PORTA DE ENTRADA (11/09, pedido do dono: "precisa ser um
     * menu de login, mais simples e mais para troca de personagem"). Ele
     * tinha virado um painel de gestão — inventário, forja, feitiços, avatar
     * e a prateleira de pedras — que só fazem sentido COM um grupo escolhido,
     * e todos já têm porta no cais do Acampamento. Aqui ficam três coisas:
     * DESCER (que é escolher quem desce), a COLEÇÃO (as cartas, que é o que
     * se olha antes de escolher) e a CONTA. Mais o resumo embaixo. */
    var acts = el('div', 'menu-acts');
    // 12/09: a conta do Mestre só tem o Mestre do Fundo — não há quem escolher
    acts.appendChild(btn('Descer', 'btn-primary btn-big', function () {
      if (soMestreDoFundo()) { selHeroes = ['gm']; navTo('hub'); return; }
      navTo('heroSelect');
    }));
    // O GAME MASTER (31/08): o botão só EXISTE com a chave do dono virada —
    // é a porta do Mestre e não entra na conta do "menu enxuto"
    if (JOGO.GM && JOGO.GM.ativo && JOGO.GM.ativo()) {
      acts.appendChild(btn('⚔ Painel do Mestre', 'btn-gold btn-big', function () {
        gmAbre();
      }));
    }
    var fichas = el('div', 'menu-fichas');
    fichas.appendChild(btn('Coleção', 'btn-mini btn-ghost', function () { sheetParty('colecao'); }));
    // o Banco de Contas (25/08): qual conta ESTA janela é, e a porta para
    // trocar/criar — duas janelas com contas diferentes = dois jogadores
    var rotuloConta = safe(function () { return JOGO.Contas.rotulo(); }, null);
    fichas.appendChild(btn(rotuloConta ? 'Conta: <b>' + esc(rotuloConta) + '</b>' : 'Conta',
      'btn-mini btn-ghost', function () { openSheet('contas'); }));
    // 02/10: a ficha das Configurações (som, tela, movimento) — antes não havia
    fichas.appendChild(btn('Configurações', 'btn-mini btn-ghost menu-config', function () { openSheet('config'); }));
    acts.appendChild(fichas);
    box.appendChild(acts);

    // resumo do cofre: quantas classes liberadas, quantas estrelas somadas
    var ids = Object.keys(classes());
    var libs = 0, stars = 0;
    ids.forEach(function (c) { var i = cardInfo(c); if (i.unlocked) libs++; stars += i.stars; });
    if (ids.length) {
      box.appendChild(el('p', 'menu-foot',
        libs + ' de ' + ids.length + ' classes liberadas · ' + stars + ' estrelas'));
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
  function botaoSair() {
    var a = el('a', 'btn btn-ghost menu-sair', 'Sair do jogo');
    a.href = safe(function () { return JOGO.Sessao.paginaSite(); }, 'site/index.html');
    a.title = 'Volta para o site — o seu progresso já está guardado';
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
      guardaDupla();          // 12/09: o próximo login já abre na praça com esta
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

    var ids = soMestre ? ['gm'] : Object.keys(classes());
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
    lastElementChoice = data;
    var s = screens.elementChoice;
    clear(s);
    var pend = (data && data.heroIds) || safe(function () { return G().elementChoices(); }, []);
    if (!pend.length) { s.appendChild(el('p', 'empty', 'Ninguém para escolher agora.')); return; }
    var hid = elemChoiceHero && pend.indexOf(elemChoiceHero) >= 0 ? elemChoiceHero : pend[0];
    elemChoiceHero = hid;
    var h = hero(hid) || {};
    var def = classDef(h.classId || hid) || {};

    s.appendChild(header('Escolha o caminho', esc(className(h.classId || hid)) +
      ' chegou ao nível 5. <b>A escolha é permanente — só o Pergaminho da Reescrita, da loja do site, troca um caminho depois.</b>'));

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
    // 14/09: quem desce a um calabouço (a antessala) deixou o Campo de PvP — a volta é à praça
    if (sala && campoHud) campoHud.dentro = false;
    if (sala && sedeHud) sedeHud.dentro = false;      // 04/10: e a sede da guilda também
    function perguntaSair() {
      // 11/09: a descida de grupo é dos dois (D16) — sair dela leva os dois
      if (emGrupo()) {
        confirmSheet('Sair do calabouço?', 'A descida acaba para vocês dois — o grupo continua.', function () {
          safe(function () { Gp().subir('saiu'); return true; }, null);
        });
        return;
      }
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
    // os pergaminhos da loja (Fase C): no Acampamento, onde se lê o da Sabedoria
    if (!sala) quem.appendChild(hubPergaminhos());
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
    // 12/09: o Painel do Mestre abre daqui, sem voltar ao Menu (também na batalha e na tecla M)
    if (mestreAtivo()) {
      var bGm = btn('⚔ Mestre', 'btn-mini btn-gold hub-gm', function () { alternaPainelMestre(); });
      bGm.title = 'Painel do Mestre (M ou F9)';
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

    var mundo = el('div', 'hub-mundo');
    s.appendChild(mundo);

    /* 13/09: na antessala, o quadro da vida no canto — a barra de cada herói subindo e as poções.
     * 14/09 (a vida única): na PRAÇA, o cartão de cada herói escolhido SEMPRE à vista (a foto, o
     * coração com o PV e o %, as poções para quem tem o anel — vidaPraca) — e a vida se acerta
     * com o servidor a cada chegada à praça */
    s.appendChild(sala ? vidaBloco('antessala') : vidaPraca());
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
    [{ ic: '🧍', ico: 'fc-personagem', rot: 'Personagem', abre: 'char' },
     { ic: '🎒', ico: 'fc-inventario', rot: 'Inventário', tecla: 'I', abre: 'inventory' },
     { ic: '📖', ico: 'fc-feiticos', rot: 'Feitiços', abre: 'spells' },
     { ic: '📜', ico: 'fc-missoes', rot: 'Missões', abre: 'missoes' },
     // 11/09: a Guilda é uma aba como as outras — SEMPRE no cais. Ela nascia
     // escondida e só aparecia se `resumoGuilda` já tivesse chegado quando a
     // conta foi pintada; como a guilda carrega por promessa, quase nunca
     // tinha. Resultado: quem ESTAVA numa guilda não via o botão dela. E
     // quem não está precisa da porta ainda mais — é por ela que se funda.
     // `remoto` avisa a ficha de que se está longe da Sede (cofre e banco
     // continuam só lá).
     { ic: '🛡️', ico: 'fc-guilda', rot: 'Guilda', abre: 'guilda', remoto: true },
     // 13/09 (dono): "no menu inferior deve ter uma lista de amigos e inimigos"
      { ic: '👥', ico: 'fc-amigos', rot: 'Amigos', abre: 'amigos' },
      // 02/10: o Eco Primordial — a porta é a ficha, não uma construção nova (o dono: "não amontoe a praça")
      { ic: '💠', ico: 'fc-eco', rot: 'Eco', abre: 'eco' },
      // 03/10: o Santuário dos Elementos — o calabouço especial também entra pela ficha (a praça não
      // ganha um sétimo portal). Com a 8ª porta o cais vira duas fileiras de quatro no celular (style.css)
      { ic: '🏛️', ico: 'fc-santuario', rot: 'Santuário', abre: 'santuario' }
    ].forEach(function (d) {
      var b = el('button', 'hub-dock-b');
      b.type = 'button';
      var svgD = safe(function () { return JOGO.IconesUI.svg(d.ico); }, '');
      var ic = el('span', 'hd-ic' + (svgD ? ' is-svg' : ''), svgD || d.ic);
      ic.setAttribute('aria-hidden', 'true');
      b.appendChild(ic);
      b.appendChild(el('span', 'hd-rot', d.rot +
        (d.tecla ? ' <span class="tecla">' + d.tecla + '</span>' : '')));
      tap(b, function () { openSheet(d.abre, d.remoto || undefined); });
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
        else {
          nomeEl.textContent = j.nome;
          // A LEI DOS NOMES (10/09): nome guardado de antes da trava que se
          // passa pela equipe do jogo pede batismo novo a cada entrada no
          // Acampamento. O Mestre do Fundo passa: o título é dele.
          if (nomeGuardadoReservado(j.nome)) {
            pedeNome('esse nome é reservado à equipe do jogo — escolha outro');
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
        // a plaquinha: nome, título — e a CHAMA DA BRASA. A Fagulha é uma
        // faísca de vagalume, mas SÓ para quem já pisou na arena: quem nunca
        // lutou segue sem fogo nenhum — a ausência também diz algo.
        var tier = null;
        resumoCoroaOculta = j.coroaOculta === true;
        if (brasa && JOGO.Brasa && !resumoCoroaOculta) {
          tier = JOGO.Brasa.tierDe(brasa.pts, souTopoDaArena());
          if (tier && tier.min === 0 && !(brasa.partidas > 0)) tier = null;
        }
        if (JOGO.Hub && JOGO.Hub.nomeia) {
          // o 4º arg é a GUILDA: a placa com emblema+nome acima do jogador.
          // `resumoGuilda` pode ainda não ter carregado (corrida com o
          // carregamento da guilda) — aí vai null e o refresco de quem
          // funda/entra chama nomeia de novo só com a guilda.
          // o título passa pela régua: o de ranking cai com a posição
          estadoDosTitulos().then(function () {
            JOGO.Hub.nomeia(j.nome || '', tituloPendurado(j.titulo), tier, resumoGuilda);
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
      painel.appendChild(el('h3', null, 'Como te chamam no fundo?'));
      if (aviso) painel.appendChild(el('p', 'hub-nota hub-nome-aviso', esc(aviso)));
      var inp = document.createElement('input');
      inp.className = 'hub-input';
      inp.maxLength = (JOGO.Nomes && JOGO.DB.NOME_MAX) || 24;   // a régua da conta: 3 a 20
      inp.placeholder = 'seu nome no acampamento';
      painel.appendChild(inp);
      painel.appendChild(btn('É assim que me chamam', 'btn-primary btn-block', function () {
        JOGO.DB.batizar(inp.value).then(function (r) {
          if (!r.ok) { toast(r.erro || 'Diz um nome.'); return; }
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
        painel.appendChild(el('p', 'hub-nota', '<b style="color:#ff8a8a">Portal fechado</b> — este calabouço ainda está sendo escavado. ' +
          'Enquanto isso, as peças dele aparecem nos calabouços abertos.'));
      } else if (lugar.tipo === 'portal') {
        painel.appendChild(el('h3', null, esc(lugar.nome)));
        // O CALABOUÇO DO DIA (25/08): o portal em promoção se anuncia
        var ehDia = !!(JOGO.Diario && JOGO.Diario.ehHoje && JOGO.Diario.ehHoje(lugar.id));
        if (ehDia) {
          // 10/09: o número vem do Diario — era um "+50%" escrito à mão
          painel.appendChild(el('p', 'hub-dia',
            '☀ <b>Calabouço do dia</b> — +' + Math.round((JOGO.Diario.BONUS_DROP - 1) * 100) +
            '% de saque até a meia-noite'));
        }
        // OS EVENTOS DO MUNDO que valem AQUI (10/09): os gerais e os deste portal
        linhasEventoPortal(lugar.id, ehDia).forEach(function (p) { painel.appendChild(p); });
        if (emGrupo()) painelPortalGrupo(painel, lugar);   // 11/09: quem lidera desce com o outro
        else {
          var sd = seletorDif();
          if (sd) painel.appendChild(sd);
          painel.appendChild(btn('Descer', 'btn-primary btn-block', function () {
            var ok = safe(function () { return G().startRun(selHeroes.slice(), lugar.id); }, false);
            if (!ok) toast('Não deu para começar essa descida.');
          }));
        }
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
        if (emGrupo()) painelPortaGrupo(painel);            // 11/09: a porta em grupo
        else {
          var sd2 = seletorDif();
          if (sd2) painel.appendChild(sd2);
          // 13/09: a vida na porta; herói a 0 PV apaga o botão e diz quanto falta (vidaTique)
          painel.appendChild(vidaBloco('porta'));
          var bEntrar = btn('Entrar na batalha', 'btn-primary btn-block vida-porta', function () {
            var ev = safe(function () { return G().esperaVida(); }, null);
            if (ev) { toast(textoEsperaVida(ev) + ' — ou beba uma poção.'); return; }
            if (!safe(function () { return G().entrarNaSala(); }, false)) toast('Não deu para entrar na sala.');
          });
          bEntrar.setAttribute('data-rotulo', 'Entrar na batalha');
          painel.appendChild(bEntrar);
          vidaTique();
        }
      } else if (lugar.tipo === 'saida') {
        painel.appendChild(el('h3', null, 'Sair do calabouço'));
        painel.appendChild(el('p', 'hub-nota',
          'A descida se perde: da próxima vez você começa da primeira sala.'));
        painel.appendChild(btn('Sair', 'btn-warn btn-block', perguntaSair));
      } else if (lugar.tipo === 'banco') {
        painel.appendChild(tituloPainel('Banco do Acampamento', 'fc-banco'));
        painel.appendChild(el('p', 'hub-nota',
          'O que está no cofre não desce com você — e por isso nunca se perde.'));
        painel.appendChild(btn('Abrir o cofre', 'btn-primary btn-block', function () {
          openSheet('banco');
        }));
      } else if (lugar.tipo === 'mercado') {
        painel.appendChild(tituloPainel('Mercadinho do Acampamento', 'fc-mercado'));
        painel.appendChild(el('p', 'hub-nota',
          'Peças à venda — só o que jogador anunciou. Toda venda sua paga 5% de taxa.'));
        painel.appendChild(btn('Abrir o balcão', 'btn-primary btn-block', function () {
          openSheet('mercado');
        }));
      } else if (lugar.tipo === 'arena') {
        painel.appendChild(tituloPainel('Arena de Duelos', 'fc-duelo'));
        painel.appendChild(el('p', 'hub-nota',
          '<b>Desafio amistoso</b>: toque em alguém na praça (no mapa da praça; a coroa não muda). ' +
          '<b>Ranqueado</b>: inscreva a sua dupla no quadro e espere um desafio — ou desafie um inscrito.'));
        painelArena(painel);          // 14/09: o quadro de inscritos da Arena
        // 11/09 (revisão): a volta para a ficha do duelo pela Rede que ficou para trás
        var deA = safe(function () { return Dl().estado(); }, null);
        if (deA && (deA.fase === 'escolhendo' || deA.fase === 'comprometido' || deA.fase === 'revelado')) {
          painel.appendChild(btn('Voltar à escolha do duelo', 'btn-gold btn-block', function () { openSheet('dueloRede'); }));
        }
        painel.appendChild(btn('Duelo de treino (mesmo teclado)', 'btn-primary btn-block', function () {
          openSheet('duelo');
        }));
        // o Poço sem Fundo morou aqui até 13/09 — agora tem corpo na praça
        painel.appendChild(btn('Ver o Placar', 'btn-ghost btn-block', function () {
          openSheet('placar');
        }));
        if (JOGO.DB) JOGO.DB.historicoPvp().then(function (h) {
          painel.appendChild(el('p', 'hub-nota', h.length + ' duelo(s) na conta.'));
        });
      } else if (lugar.tipo === 'poco') {
        // O POÇO SEM FUNDO (25/08; 13/09 saiu da Arena e ganhou a arte do dono)
        painel.appendChild(tituloPainel('Poço sem Fundo', 'fc-poco'));
        painel.appendChild(el('p', 'hub-nota',
          'A torre infinita: cada andar é uma sala emprestada dos calabouços, e cada andar a mais deixa os monstros mais duros.'));
        if (emGrupo()) {
          // 11/09 (D10): o Poço sorteia fora da semente — em grupo, só sozinho
          painel.appendChild(btn('Descer ao Poço sem Fundo', 'btn-warn btn-block is-apagado', function () {
            toast('O Poço é só para quem desce sozinho — por enquanto.');
          }));
          painel.appendChild(el('p', 'hub-nota', 'O Poço é só para quem desce sozinho — por enquanto.'));
        } else painel.appendChild(btn('Descer ao Poço sem Fundo', 'btn-warn btn-block', function () {
          if (!selHeroes.length) { toast('Escolha sua dupla primeiro.'); return; }
          if (!safe(function () { return G().startPoco(selHeroes.slice()); }, false)) {
            toast('O Poço não abriu.');
          }
        }));
        if (JOGO.DB.pocoVer) JOGO.DB.pocoVer().then(function (pv) {
          if (pv && (pv.recorde > 0 || pv.semanaMelhor > 0)) {
            painel.appendChild(el('p', 'hub-nota', 'Poço: andar <b>' + pv.semanaMelhor +
              '</b> na semana · recorde <b>' + pv.recorde + '</b>.'));
          }
        });
      } else if (lugar.tipo === 'sede') {
        painel.appendChild(tituloPainel('Sede das Guildas', 'fc-guilda'));
        painel.appendChild(el('p', 'hub-nota',
          'O estandarte dos clãs. A ficha resolve tudo daqui; quem é de uma guilda também entra no salão dela.'));
        painel.appendChild(btn('Abrir a ficha da guilda', 'btn-primary btn-block', function () {
          openSheet('guilda');
        }));
        // 04/10 (dono): a sede por dentro — só quem TEM guilda vê o botão
        if (resumoGuilda) painel.appendChild(btn('Entrar na sede', 'btn-gold btn-block sede-entrar', pedeEntrarNaSede));
        painelGuerra(painel);         // 15/09: a guerra de guilda 2×2 (a fila, os quatro confirmando)
      } else if (/^sede-/.test(lugar.tipo)) {
        painelSedeDentro(painel, lugar.tipo, tituloPainel);   // 04/10: os cinco pontos do salão da guilda
      } else if (lugar.tipo === 'loteria') {
        // A BARRAQUINHA DA SORTE (03/09): a roleta dos selos mora aqui
        painel.appendChild(tituloPainel('Barraquinha da Sorte', 'fc-loteria'));
        var sl = safe(function () { return P().roletaSaldo(); }, null);
        painel.appendChild(el('p', 'hub-nota', sl
          ? (sl.giros > 0 ? '<b>' + sl.total + '</b> selos no bolso — <b>' + sl.giros + '</b> giro(s) da sorte.'
                          : '<b>' + sl.total + '</b> selos no bolso — faltam <b>' + sl.faltam + '</b> para um giro.')
          : 'A roleta do Traje do Colecionador.'));
        painel.appendChild(btn('Girar a sorte', 'btn-primary btn-block', function () {
          openSheet('loteria');
        }));
      } else if (lugar.tipo === 'campo') {
        painelCampo(painel);          // 14/09: a entrada do Campo de PvP
      } else if (lugar.tipo === 'campo-saida') {
        painelCampoSaida(painel);     // 14/09: a saída do Campo (e a troca da dupla)
      } else if (lugar.tipo === 'forja') {
        // A BARRACA DO FERREIRO (30/08): a forja ganhou endereço na praça —
        // a bigorna continua no cais para quem prefere o atalho
        painel.appendChild(tituloPainel('Forja do Acampamento', 'fc-forja'));
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
    function chatLinha(quem, texto, cor, de) {
      if (!chatLog) return;
      var li = el('div', 'hub-chat-linha');
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
          JOGO.Guilda.contaAtiva(j2.id, j2.nome || 'Sem Nome');
          return JOGO.Guilda.minha();
        }).then(function (mg) {
          resumoGuilda = mg ? { nome: mg.nome, emblema: mg.emblema } : null;
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
        return { id: j.id, nome: j.nome || 'Sem Nome',
                 titulo: tituloPendurado(j.titulo),
                 // `classe` no protocolo sempre foi APARÊNCIA — agora pode ser
                 // uma fusão do guarda-roupa; o fantasma do outro lado veste igual
                 // 14/09: no Campo de PvP, a aparência do 1º da dupla do Campo (o 2º não viaja)
                 classe: aparenciaDaRede(),
                 resumo: safe(resumoDaConta, null),
                 aura: safe(temAuraSelos, false),
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
          if (campoDentro()) { ataqueNoCampo(par); return; }
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
          if (painelModo === 'convite' && !painel.classList.contains('is-off')) { toast('Responda o convite antes.'); return; }
          var id = par.id;
          clear(painel);
          painel.classList.remove('is-off');
          painelModo = 'jogador';
          painelPar = par;
          function fecha() { painel.classList.add('is-off'); painelModo = null; }
          var pg = parceiroG();
          var ehMeuPar = !!(pg && pg.id === id);
          cabecalhoPainel(painel, par.classe || 'sumo', 'neutro',
            esc(par.nome) + (par.titulo ? ' <i class="hub-tit">' + esc(par.titulo) + '</i>' : ''),
            ehMeuPar ? (souLider() ? '◆ no seu grupo' : '♛ lidera o seu grupo') : '');
          var grade = el('div', 'pn-grade');
          grade.appendChild(btn('Ver perfil', 'btn-primary', function () {
            fecha();
            openSheet('perfil', par);
          }));
          var pode = !!safe(function () { return Su().pode(); }, false);
          var bMsg = btn('Mensagem particular', 'btn-ghost' + (pode ? '' : ' is-apagado'), function () {
            if (!pode) { toast(textoMotivo('privado', null)); return; }
            fecha();
            armaSussurro(id, par.nome);
          });
          if (!pode) bMsg.title = 'precisa do servidor da Rede';
          grade.appendChild(bMsg);
          if (!sala && Gp()) {
            var cheio = (grupoEstado() || {}).fase === 'formado';
            // 11/09 (pedido do dono): o Mestre entra em grupo, mas só ele chama — no painel dele o botão avisa
            var soMestre = par.mestre === true && !ehMeuPar &&
                           !safe(function () { return JOGO.GM && JOGO.GM.ativo && JOGO.GM.ativo(); }, false);
            grade.appendChild(btn(ehMeuPar ? 'Já está no seu grupo'
                                           : (soMestre ? 'Só o Mestre chama para o grupo' : (cheio ? 'Você já está num grupo' : 'Chamar para o grupo')),
              'btn-ghost' + ((cheio || soMestre) ? ' is-apagado' : ''), function () {
                if (soMestre) { toast(textoMotivo('so-mestre-chama', null)); return; }
                if (cheio) { toast(ehMeuPar ? par.nome + ' já está no seu grupo.' : textoMotivo('em-grupo', null)); return; }
                var r = safe(function () { return Gp().convidar(id); }, null);
                if (r && r.ok) { fecha(); toast('Convite enviado a ' + par.nome + '. Esperando a resposta…'); }
                else toast(textoMotivo(r ? r.motivo : 'ocupado', null));
              }));
          }
          if (!sala && Dl()) {
            grade.appendChild(btn('Desafio amistoso', 'btn-ghost', function () {   // 14/09: o duelo na praça, sem coroa
              var r = safe(function () { return Dl().desafiar(id); }, null);
              if (r && r.ok) { fecha(); toast('Desafio enviado a ' + par.nome + '. Esperando a resposta…'); }
              else toast(textoMotivo(r ? r.motivo : 'ocupado', null));
            }));
          }
          if (JOGO.Troca) {
            grade.appendChild(btn('Propor troca', 'btn-ghost', function () {
              fecha();
              if (JOGO.Troca.convidar(id)) {
                toast('Convite de troca enviado. Esperando o outro lado…');
                openSheet('troca');
              } else toast('já há uma troca aberta');
            }));
          }
          // 13/09 (dono): amigos e inimigos — pela CONTA conferida na praça (o `nuvem`)
          var Am = JOGO.Amigos;
          if (Am && Am.pode() && typeof par.nuvem === 'number') {
            var ehAm = Am.ehAmigo(par.nuvem), ehIn = Am.ehInimigo(par.nuvem);
            grade.appendChild(btn(ehAm ? 'Tirar dos amigos' : 'Adicionar amigo', 'btn-ghost', function () {
              fecha();
              Am.definir({ conta: par.nuvem }, ehAm ? null : 'amigo').then(function (r) {
                toast(r.ok ? (ehAm ? par.nome + ' saiu dos amigos.' : par.nome + ' agora é seu amigo.')
                           : (r.erro || 'não deu'), r.ok ? 'good' : undefined);
              });
            }));
            grade.appendChild(btn(ehIn ? 'Tirar dos inimigos' : 'Marcar inimigo', 'btn-ghost', function () {
              fecha();
              Am.definir({ conta: par.nuvem }, ehIn ? null : 'inimigo').then(function (r) {
                toast(r.ok ? (ehIn ? par.nome + ' saiu dos inimigos.'
                                   : par.nome + ' é seu inimigo: sem mensagem particular nem troca.')
                           : (r.erro || 'não deu'), r.ok ? 'good' : undefined);
              });
            }));
          }
          var mudo = !!mutados[id];
          var bSil = btn(mudo ? 'Devolver a voz' : 'Silenciar', 'btn-ghost', function () {
            mutados[id] = !mudo;
            if (JOGO.DB.mutar) JOGO.DB.mutar(id, par.nome, !mudo);
            safe(function () { Gp().mutado(id, !mudo); return true; }, null);
            toast(!mudo ? par.nome + ' silenciado.' : par.nome + ' de volta ao chat.');
            fecha();
          });
          grade.appendChild(bSil);
          // 02/10: denunciar à Equipe, pela conta conferida (js/ui/moderacao.js)
          if (JOGO.Denuncia) grade.appendChild(JOGO.Denuncia.botao({ conta: par.nuvem, nome: par.nome, heroId: id, onde: 'praca' }, fecha));
          grade.appendChild(btn('Fechar', 'btn-ghost', fecha));
          painel.appendChild(grade);
          // CONVIDAR PARA A GUILDA (25/08): só quem lidera a guilda vê o botão
          if (JOGO.Guilda) {
            JOGO.Guilda.minha().then(function (mg) {
              // 11/09: líder e oficiais convidam (os mesmos que aceitam pedidos)
              if (!mg || !(mg.souLider || mg.meuCargo === 'oficial') || painel.classList.contains('is-off') || !grade.isConnected) return;
              grade.insertBefore(btn('Convidar para a ' + esc(txtGuilda(mg.emblema, mg.nome)),
                'btn-ghost pn-largo', function () {
                  fecha();
                  // 11/09: com a guilda no servidor, o convite é da CONTA dela (a que o relé
                  // conferiu, o `nuvem` da presença) — sem ele o "aceitar" do outro lado não entra
                  JOGO.Guilda.convidar(par.nuvem).then(function (rc) {
                    if (!rc || !rc.ok) { toast((rc && rc.erro) || 'não deu para convidar'); return; }
                    R.guildaManda(id, 'convite', { gid: mg.id, nome: mg.nome, emblema: mg.emblema });
                    toast('Convite de guilda enviado.');
                  });
                }), bSil);
            });
          }
        }
        painelJogadorFn = painelJogador;
        if (JOGO.Troca) {
          JOGO.Troca.aoConvite = function (c) {
            // 13/09 (dono): inimigo não propõe troca — recusa calada (o relé novo nem entrega)
            if (safe(function () { return JOGO.Amigos && JOGO.Amigos.inimigoPorHeroi(c.de); }, false)) {
              safe(function () { JOGO.Troca.responder(false); return true; }, null);
              return;
            }
            // 11/09 (revisão): um pedido de cada vez. Com um convite de grupo ou de
            // duelo na tela, a troca é recusada (o grupo e o duelo já recusam quem
            // está numa troca) — antes ela tomava o painel e o convite de 30 s sumia
            // sem volta; e, se ficasse esperando, o "Aceitar" do grupo daria "troca"
            if (painelModo === 'convite' && !painel.classList.contains('is-off')) {
              safe(function () { JOGO.Troca.responder(false); return true; }, null);
              toast(c.nome + ' quis trocar com você — recusado: responda antes o convite aberto.');
              return;
            }
            clear(painel);
            painel.classList.remove('is-off');
            // o convite de troca também é CONVITE: o passo perto de um lugar e o toque
            // noutra pessoa não o apagam, e o grupo/duelo que vence não o fecha
            painelModo = 'convite';
            painelConv = { tipo: 'troca', de: c.de };
            painel.appendChild(el('h3', null, 'Troca'));
            painel.appendChild(el('p', 'hub-nota',
              esc(c.nome) + ' quer trocar com você.'));
            painel.appendChild(btn('Aceitar', 'btn-primary btn-block', function () {
              JOGO.Troca.responder(true);
              fechaPainel();
              openSheet('troca');
            }));
            painel.appendChild(btn('Agora não', 'btn-ghost btn-block', function () {
              JOGO.Troca.responder(false);
              fechaPainel();
            }));
          };
          JOGO.Troca.aoMudar = function (est) {
            // o convite de troca na tela sai quando a mesa dele acaba (aceita, recusada, cancelada)
            if (painelModo === 'convite' && painelConv && painelConv.tipo === 'troca' &&
                !(est && est.fase === 'convidado' && est.par === painelConv.de)) fechaPainel();
            if (sheetName === 'troca') sheetTroca();
            if (est && est.fase === 'cancelada' && est.motivo) {   // 10/09: a troca que o cartório não espelharia
              closeSheet();
              toast(est.motivo);
              return;
            }
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
                esc(txtGuilda(ev.dados.emblema, ev.dados.nome || '?')) + '</b>.'));
              painel.appendChild(btn('Aceitar', 'btn-primary btn-block', function () {
                // 11/09: é o CONVITE que abre a porta (antes o entrar batia na porta fechada)
                JOGO.Guilda.entrar(ev.dados.gid, { convite: true }).then(function (res) {
                  painel.classList.add('is-off');
                  toast(res.ok ? 'Bem-vindo à ' + ev.dados.nome + '!' : (res.erro || 'não deu'),
                        res.ok ? 'good' : undefined);
                  if (res.ok && res.guilda) {               // a placa da guilda sobe na hora
                    resumoGuilda = { nome: res.guilda.nome, emblema: res.guilda.emblema };
                    reanunciaPerfil();          // o clã novo aparece para todos
                    if (JOGO.Hub && JOGO.Hub.nomeia) {
                      try { JOGO.Hub.nomeia(undefined, undefined, undefined, resumoGuilda); } catch (e) {}
                    }
                  }
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
              // 14/09: a mesma sala, outra zona (entrou ou saiu do Campo de PvP): o Hub mostra só a zona dele
              if (typeof JOGO.Hub.fantasmaZona === 'function') {
                safe(function () { return JOGO.Hub.fantasmaZona(ev.id, ev.zona || 'praca'); }, null);
              }
              chatLinha(null, ev.nome + (chaveSala ? ' chegou à sala.' : ' voltou ao acampamento.'));
            } else {
              JOGO.Hub.fantasmaSai(ev.id);
            }
          } else if (ev.tipo === 'alvo') {
            JOGO.Hub.fantasmaAlvo(ev.id, ev.x, ev.z);
          } else if (ev.tipo === 'pulso') {
            JOGO.Hub.fantasmaPulso(ev.id, ev.x, ev.z);
          } else if (ev.tipo === 'gchat') {
            // 13/09: o chat da guilda (/g) — só os membros recebem (o relé confere)
            if (mutados[ev.id]) return;
            chatLinha('[' + (ev.guilda || 'Guilda') + '] ' + ev.nome, R.filtra ? R.filtra(ev.texto) : ev.texto, '#7fc8ff', ev.id);
            // 04/10: no salão a fala da guilda também sai em balão, sobre quem falou
            if (sedeDentro()) safe(function () { return JOGO.Hub.fala(ev.id, R.filtra ? R.filtra(ev.texto) : ev.texto); }, null);
            safe(function () { return JOGO.Denuncia && JOGO.Denuncia.anota(ev.id, ev.nome, ev.texto); }, null);
          } else if (ev.tipo === 'gchat-nao') {
            toast(ev.motivo === 'sem-guilda' ? 'Você não está numa guilda: o /g não tem para quem ir.'
                                             : 'O chat da guilda precisa que você esteja na sua conta.');
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
        ci.placeholder = 'diga algo…  /g guilda · /Nome particular';
        ci.addEventListener('keydown', function (evk) {
          if (evk.key === 'Enter') {
            var t = ci.value.trim();
            // 13/09 (dono): "/Nome texto" é particular e "/g texto" vai à guilda; sem barra, a praça
            // 04/10: dentro da sede o padrão vira a guilda — sem barra é como se fosse "/g"
            if (t && t.charAt(0) !== '/' && !chatAlvo && sedeDentro()) t = '/g ' + t;
            if (t && t.charAt(0) === '/') {
              if (comandoDoChat(t, j, chatLinha)) ci.value = '';
              evk.stopPropagation();
              return;
            }
            if (t && chatAlvo) {
              var rs = safe(function () { return Su().manda(chatAlvo.id, t); }, null);
              if (rs && rs.ok) ci.value = '';
              else toast(textoMotivo(rs ? rs.motivo : 'privado', null));
            } else if (t && R.falar(t)) {
              chatLinha(j.nome || 'você', t, '#9bd06a');
              safe(function () { return JOGO.Hub.fala(null, t); }, null);   // 11/09: o meu balão também
              ci.value = '';
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
    if (!entrou) mundo.appendChild(el('p', 'empty', 'O acampamento precisa do modo 3D.'));
    pintaConta();
    avisaDevolvidasPorNivel();             // [D19] o que voltou ao saco na carga
  }

  /* ------------------------------------------------ OS EVENTOS DO MUNDO (10/09)
   * A faixa do Acampamento, as linhas do painel do portal e os chips da tela
   * de recompensa leem a agenda (js/core/agenda.js). Tudo defensivo: sem o
   * módulo, nada disto aparece e nada quebra. */
  var soltaFaixaEventos = null;
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
    return 'só ' + (m ? { A: 'na', O: 'no', As: 'nas', Os: 'nos' }[m[1]] + ' ' + m[2] : 'em ' + n);
  }
  function linhaEvento(e, agoraMs, comLugar) {
    var Ag = JOGO.Agenda;
    var termina = 'termina em ' + Ag.falta(e.fim * 1000 - agoraMs);
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
    ativos.slice(0, 3).forEach(function (e) {
      faixa.appendChild(el('span', 'hub-evento-item', linhaEvento(e, agoraMs, true)));
    });
    if (ativos.length > 3) faixa.appendChild(el('span', 'hub-evento-item', '+' + (ativos.length - 3) + ' outros'));
    var a = el('a', 'hub-evento-link', 'ver o calendário');
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
    soltaFaixaEventos = Ag.aoMudar(function () { if (faixa.isConnected) pintaFaixaEventos(faixa); });
    // ao entrar, busca de novo se a última tentativa tiver mais de 60 s
    // (em casa, só com sessão ou API apontada — Agenda.refresca decide)
    if (Ag.refresca) {
      Ag.refresca(60000).then(function (r) {
        if (r && !r.pulou && faixa.isConnected) pintaFaixaEventos(faixa);
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
      if (e.tipo === 'saque' && ehDia) txt += ' · junto do Calabouço do Dia, <b>vale o maior</b> (não somam)';
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
      var txtEv = '✦ ' + esc(e.titulo || 'Evento do mundo') + ' · ' + esc(rot);
      // o Pergaminho da Sabedoria (Fase C) vem no mesmo formato, com as cargas que restam
      if (e.origem === 'pergaminho') {
        txtEv = '❦ ' + esc(e.titulo || 'Pergaminho da Sabedoria') + ' · ' + esc(rot) +
                ' · restam ' + Math.max(0, Math.floor(Number(e.restam) || 0)) + ' salas';
      }
      // o bônus de XP por tempo (loja 2), com o que ainda falta do prazo
      if (e.origem === 'bonus-tempo') {
        var faltaB = (Number(e.ate) || 0) * 1000 - bonusAgoraMs();
        txtEv = '✦ ' + esc(e.titulo || 'Bônus de XP') + ' · ' + esc(bonusFmt(e.fator)) +
                (faltaB > 0 ? ' · faltam ' + esc(bonusFalta(faltaB)) : '');
      }
      var realce = (e.origem === 'pergaminho' || e.origem === 'bonus-tempo') ? ' rw-pergaminho' : '';
      w.appendChild(el('span', 'rw-evento' + realce, txtEv));
    });
    return w;
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
    body.appendChild(vidaBloco('fim'));      // 14/09: a vida com que cada herói saiu da sala, subindo
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
        w.appendChild(el('div', 'rw-xp-n is-cut', 'XP por herói'));
      }
      var chXp = chipsEvento('xp');          // 10/09: o evento do mundo de XP
      if (chXp) w.appendChild(chXp);

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
    /* 10/09: o bloco dos Vinténs morava DENTRO do `if (drops.length)` desde
     * 23/08 — sala sem peça (três em quatro, pela régua do saque) escondia a
     * moeda ganha, o chip do desafio e agora o do evento. Ele saiu para fora. */
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
        var chV = chipsEvento('vintem');     // 10/09: o evento do mundo de vinténs
        if (chV) w.appendChild(chV);
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

    if (drops.length) {
      box.appendChild(rwBlock('Saque', (function () {
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
      // 12/09: a escolha é na ficha de Feitiços, por cima desta tela — sem sair dela
      foot.appendChild(btn('Escolher caminho (' + pend.length + ')', 'btn-gold', function () {
        partyHero = pend[0];
        openSheet('spells');
      }));
    }
    foot.appendChild(btn('Inventário', 'btn-ghost', function () { openSheet('inventory'); }));
    // 11/09: a descida de GRUPO tem rodapé próprio (4.8) — quem lidera abre a
    // próxima sala, quem segue espera, e a dificuldade é de quem lidera (D9)
    var rg = noPoco ? false : rodapeGrupo(foot, fim);
    if (!rg) {
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

  function buildDefeat() {
    var s = screens.defeat;
    clear(s);
    var box = el('div', 'menu-box defeat-box');
    box.appendChild(el('h1', 'game-title defeat-title', 'Soterrados'));
    box.appendChild(el('p', 'game-sub', 'O calabouço ficou com o grupo. O que vocês já ganharam é seu — cartas, pedras e itens não se perdem.'));
    box.appendChild(vidaBloco('fim'));       // 14/09: quem caiu está a 0 e volta a subir — ou beba uma poção
    var acts = el('div', 'menu-acts');
    var estD = grupoEstado();
    if (emGrupo() || (estD && estD.descidaGrupo)) {     // 11/09: a derrota de grupo (4.8)
      derrotaGrupo(acts);
      box.appendChild(acts);
      s.appendChild(box);
      return;
    }
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

    // O PAINEL DO MESTRE no meio da luta (12/09): só existe para o Mestre
    if (mestreAtivo()) {
      bt.gm = btn('⚔', 'bt-gm', function () { alternaPainelMestre(); });
      bt.gm.title = 'Painel do Mestre (M ou F9)';
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
    tipOn(bt.tmBank, 'Tempo guardado',
      'O que você não gasta no turno vai para o banco (máx. ' + ((gT && gT.bankMax) || 120) +
      's) e é usado quando os ' + ((gT && gT.turnTime) || 30) + 's acabarem.', '#9fd8ff');
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
      bt.prepBotao = el('button', 'bt-prep-pronto', 'PRONTO');
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
      bt.prepRelogio.textContent = 'A luta começa em ' + seg + ' s';
      bt.prepRelogio.classList.toggle('urgente', seg <= 5);
    }
    if (bt.prepEle) {
      bt.prepEle.textContent = e.dupla
        ? (e.prontoEle ? nomeParceiro() + ' está pronto.' : 'Esperando ' + nomeParceiro() + '…')
        : '';
      bt.prepEle.style.display = e.dupla ? '' : 'none';
    }
    if (bt.prepBotao) {
      bt.prepBotao.disabled = !e.escolhi || e.pronto || e.fechada;
      bt.prepBotao.textContent = e.pronto ? 'PRONTO ✓' : 'PRONTO';
      bt.prepBotao.classList.toggle('feito', e.pronto);
      bt.prepBotao.title = e.escolhi ? '' : 'Marque antes onde nascer';
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
    bt.room.appendChild(el('span', 'round-chip', 'Rodada ' + s.round + (s.eco ? ' de ' + s.eco.rodadas : '')));
    if (s.eco) pintaEcoNaSala(s);
    if (s.santuario) pintaSantuarioNaSala(s);     // 03/10: as regras de terreno da sala, com o que vem na próxima rodada
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
      // 11/09: a cor vem do lado NA MINHA TELA (meu, do parceiro, inimigo) — e
      // conserta o 'hero' que nunca batia (todo mundo saía vermelho)
      var lado = ladoTela(u);
      var cell = el('div', 'tl-unit ' + (lado === 'meu' ? 's-hero' : (lado === 'aliado' ? 's-parceiro' : 's-enemy')) +
                           (i === 0 ? ' is-now' : ''));
      cell.appendChild(art('portrait', [u.defId, { element: u.element, size: 48 }], i === 0 ? 46 : 34));
      // 22/09: o invisível do outro lado continua na fila (a vez é de todos),
      // mas sem a vida — ela cair entregaria que a área o pegou ali
      var some = oculto(u);
      var hpPct = u.hpMax ? u.hp / u.hpMax : 0;
      var hb = el('div', 'tl-hp');
      var hf = el('i');
      hf.style.width = some ? '0%' : Math.max(0, Math.min(100, hpPct * 100)) + '%';
      hb.appendChild(hf);
      cell.appendChild(hb);
      if (some) cell.style.opacity = '0.55';
      if (u.boss) cell.appendChild(el('span', 'tl-boss', '♛'));
      tipOn(cell, u.name || u.defId, unitTipBody(u), lado === 'inimigo' ? '#ff9a7a' : (lado === 'aliado' ? '#9cc4ff' : '#7ef0d4'));
      bt.timeline.appendChild(cell);
    }
  }

  /* 22/09: o invisível do OUTRO lado — some desta tela (Game.ocultoNaTela) */
  function oculto(u) {
    var g = G();
    if (!u || !g || typeof g.ocultoNaTela !== 'function') return false;
    return !!safe(function () { return g.ocultoNaTela(u); }, false);
  }

  function unitTipBody(u) {
    if (oculto(u)) return '<i>Sumiu nas sombras — não dá para ver onde está.</i>';
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

    // 22/09: na vez do invisível do outro lado o cartão diz só que ele sumiu —
    // vida, PA e PP gastos contariam o que ele fez e onde apanhou
    if (oculto(u)) {
      var sumiu = el('div', 'ba-status');
      sumiu.setAttribute('style', 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px');
      sumiu.appendChild(chip('Invisível — sumiu nas sombras', EF_CHIP.invisible.cor));
      info.appendChild(sumiu);
      bt.active.appendChild(info);
      return;
    }

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
    bt.tmFill.style.transform = 'scaleY(' + pct.toFixed(4) + ')';
    var bk = (banked > 0 && !noBanco) ? '+' + Math.round(banked) + 's' : '';
    if (bt.tmBank.textContent !== bk) { bt.tmBank.textContent = bk; bt.tmBank.hidden = !bk; }
    // o pé da barra fica logo acima da barra de baixo, pela altura MEDIDA dela
    // (no celular ela cresce com a fusão): nunca por cima do "Encerrar turno"
    var hb = bt.bottomBar ? bt.bottomBar.offsetHeight : 0;
    var pe = hb ? (hb + 10) + 'px' : '';
    if (bt.timer.style.bottom !== pe) bt.timer.style.bottom = pe;
  }

  function paintSpells(s) {
    clear(bt.spells);
    var u = activeUnit();
    var mine = safe(function () { return G().isPlayerTurn(); }, false);
    if (!u || !mine) {
      bt.spells.appendChild(esperaNaBarra(u));      // 11/09: "Vez de Bia — esperando o lance…"
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
      tipOn(q, spellName(d2, sid), spellTipBody(d2, sid, u), d2 ? elemColor(d2.element) : '#ffd08a');
      cell.appendChild(q);
      bt.spells.appendChild(cell);
    });
    // 13/09: a barra da batalha não tem mais poção — ela se bebe fora da luta (vidaBloco, 14/09)
  }

  // `quem` (opcional): a unidade que vai lançar — só a barra da batalha o passa
  UI._spellTipBody = function (d2, sid, quem) { return spellTipBody(d2, sid, quem); };   // provas (muro_visual.html)
  function spellTipBody(d2, sid, quem) {
    if (!d2) return 'Este feitiço não pôde ser carregado.';
    var out = '<i>' + (d2.paCost || 0) + ' PA';
    if (d2.range) out += ' · alcance ' + (d2.range.min || 0) + '–' + (d2.range.max || 0);
    if (d2.cooldown) out += ' · recarga ' + d2.cooldown;
    if (d2.castsPerTurn) out += ' · ' + d2.castsPerTurn + '×/turno';
    out += '</i><br>' + esc(d2.description || '');
    /* 03/10: OS ESPINHOS (engine.js, "O MURO QUE FERE QUEM ENCOSTA"). O feitiço de classe já diz o
     * número na descrição; a forma de fusão tem uma descrição só para todas as misturas e níveis, e
     * o número dela muda com eles — a linha sai do próprio efeito, como o motor o usa. */
    var muroEf = null;
    (d2.effects || []).forEach(function (ef) { if (ef && ef.type === 'wall' && ef.fere > 0) muroEf = ef; });
    if (muroEf && d2.fusion) {
      out += '<br><b>Espinhos:</b> a pedra fere ' + muroEf.fere + ' (mais o poder) quem do outro lado terminar a vez ' +
             'encostado nela ou for jogado contra ela.';
    }
    /* 03/10 (revisão): o 30 da descrição é a BASE, como o "16–22" de qualquer golpe; o espinho que a
     * pedra leva é ele vezes o poder de quem ergue (34 no nível 5, 56 no 30). Na barra da batalha,
     * com quem vai erguer na mão, a ficha diz o número que a pedra vai ferir AGORA — a mesma conta do
     * motor (Engine.fereDoMuro), e não uma cópia dela. */
    if (muroEf && quem) {
      var fereAgora = safe(function () { return E().fereDoMuro(G().state, quem, d2, muroEf); }, 0);
      if (fereAgora > 0) out += '<br><b>Espinhos agora:</b> com o seu poder, a pedra fere ' + fereAgora + '.';
    }
    if (d2.aoe && d2.aoe.shape && d2.aoe.shape !== 'single') {
      out += '<br>Área: ' + esc(d2.aoe.shape) + ' ' + (d2.aoe.size || '');
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
      confirmSheet('Fundir os dois heróis?',
        'Vira <b>uma única unidade</b>: vida somada, +' + fusaoNum('BONUS_PA', 4) + ' PA, +' +
        fusaoNum('BONUS_PP', 1) + ' PP, +' + fusaoNum('BONUS_SHIELD', 50) + ' de escudo e feitiços de fusão. ' +
        'Custa ' + fusaoNum('FUSION_PA_COST', 2) + ' PA e <b>encerra o turno</b>. Se um deles se afastar antes do fim, não acontece nada.',
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
    var tinhaFoco = sheetEl.contains(document.activeElement);
    sheetEl.classList.remove('is-on');
    sheetName = null;
    marcaDock(null);
    hideTip();
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
    var nvB = nvBadge(pilha.itemId);
    if (nvB) cell.appendChild(nvB);
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

      // ---- AS DUAS GRADES, lado a lado
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

      // o filtro por elemento (e, desde 22/09, o por espaço) vale para AS
      // DUAS grades de uma vez — quem procura a peça de água não quer caçá-la
      // em dois lugares. Filtrar não mexe nos `indices` das pilhas: guardar e
      // sacar continuam achando a posição real no saco e no cofre.
      caixa.appendChild(filtrosDeItem(bancoSlotFiltro, function (s) {
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

      var colSaco = el('div', 'bk2-col');
      colSaco.dataset.lado = 'saco';
      var limSaco = safe(function () { return P().bagLimit(); }, 0);
      colSaco.appendChild(el('h3', 'bk-tit', 'No saco (' + unidadesSaco +
        (limSaco ? ' / ' + limSaco : '') + ')'));
      colSaco.appendChild(bancoGrade(pilhas, 'saco', function (pi) {
        var st2 = P().state;
        var entrada = st2.inventory[pi.indices[0]];
        if (!entrada) { toast('essa peça já saiu'); sheetBanco(); return; }
        // 13/09: com sessão, a mesma guarda roda no servidor (antes de o índice mudar aqui)
        if (JOGO.Autoridade) JOGO.Autoridade.op('depositarItem', { invIndex: pi.indices[0] });
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
        if (JOGO.Autoridade) JOGO.Autoridade.op('sacarItem', { indice: pi.indices[0] });
        DBc.sacarItem(pi.indices[0]).then(function (res) {
          if (!res.ok) { toast(res.erro || 'não deu'); sheetBanco(); return; }
          var st3 = P().state;
          st3.inventory.push(P().carimba ? P().carimba(res.item, 'banco') : res.item);
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

    Promise.all([Ms.carregar(),
                 JOGO.DB ? JOGO.DB.jogador() : Promise.resolve({})])
      .then(function (r) {
        var quadro = r[0], jog = r[1] || {};
        clear(caixa);
        if (!quadro) { caixa.appendChild(el('p', 'inv-dica', 'A conta local não carregou.')); return; }

        function linha(id, def, st2) {
          var row = el('div', 'ms-linha' + (st2.prog >= def.alvo ? ' is-feita' : ''));
          var tx = el('div', 'ms-tx');
          tx.appendChild(el('div', 'ms-nome', esc(def.texto)));
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
                if (!res.ok) toast(res.erro || 'não deu');
                else toast('+' + res.premio + ' vinténs', 'good');
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
    comprar: { ico: 'mc-comprar', rot: 'Comprar' },
    vender:  { ico: 'mc-vender',  rot: 'Vender' },
    meus:    { ico: 'mc-meus',    rot: 'Meus anúncios' },
    ofertas: { ico: 'mc-ofertas', rot: 'Minhas ofertas' },
    pocoes:  { ico: 'mc-pocoes',  rot: 'Poções' }
  };
  // mcAbas([{id, conta?}], aoMudar) -> div.mc-abas; a acesa é a do `mcAba`
  function mcAbas(lista, aoMudar) {
    return icoFila('mc-abas', lista.map(function (a) {
      var def = MC_ABAS[a.id];
      return { id: a.id, ico: def.ico, rot: def.rot, conta: a.conta, cls: 'btn-mini',
               clsTexto: mcAba === a.id ? 'btn-gold' : 'btn-ghost', data: { aba: a.id } };
    }), mcAba, aoMudar, true);
  }
  // as opções de cada fileira de filtro: {id, ico, rot, rc?, data} (o espaço
  // vem do slotOpcoes(), o mesmo do inventário)
  function mcOpRar() {
    return [['todas', 'Todas'], ['comum', 'Comum'], ['raro', 'Raro'], ['epico', 'Épico'],
            ['lendario', 'Lendário']].map(function (par) {
      return { id: par[0], ico: 'rar-' + par[0], rot: par[1],
               rc: par[0] === 'todas' ? null : rarColor(par[0]), data: { rar: par[0] } };
    });
  }
  function mcOpOrdem() {
    return [['preco', 'ord-preco-asc', 'Preço ↑'], ['precoDesc', 'ord-preco-desc', 'Preço ↓'],
            ['nome', 'ord-nome', 'Nome'], ['raridade', 'ord-raridade', 'Raridade']].map(function (t) {
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
    return (qtd === 1 ? '1 × ' : (inicio ? 'Lote de ' : 'lote de ') + qtd + ' × ') + mcNomePedra(sid);
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
      (qtd > 1 ? '<small>' + mcUnit(preco, qtd) + 'v cada</small>' : ''));
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
    var row = mcLinhaPedra(sid, esc(nome), esc(ELEM_PT[elP] || 'Forja') + ' · você tem <b class="mc-tem">' + tem + '</b>' +
      (regua ? ' · a régua sugere ' + regua + 'v a pedra' : ''));
    row.classList.add('mc-pedra-venda');
    var fila = el('span', 'mc-lotes');
    fila.setAttribute('role', 'group');
    var campo = document.createElement('input');
    campo.type = 'number'; campo.min = '1'; campo.max = String(teto); campo.step = '1';
    campo.className = 'bk2-qtd mc-qtd mc-lote-preco';
    campo.setAttribute('aria-label', 'preço do lote');
    var conta = el('span', 'mc-lote-conta', '');
    function preco() { return Math.floor(Number(campo.value || sugerido())) || 0; }
    function mostra() {
      campo.placeholder = String(sugerido());
      var p = preco();
      if (p <= 0) { conta.textContent = ''; return; }
      var tx = mcTaxa(p);
      conta.innerHTML = '<b>' + mcUnit(p, lote) + 'v</b> cada · recebe <b class="mc-recebe">' + (p - tx) +
        'v</b> <small>(taxa ' + tx + 'v)</small>';
    }
    lotes.forEach(function (n) {
      var falta = n > tem;
      var b = btn(String(n), 'btn-mini mc-chip mc-lote' + (n === lote ? ' is-on' : '') + (falta ? ' mc-falta' : ''), function () {
        if (n > tem) {
          toast('Você tem ' + tem + ' ' + nome + ' — o lote de ' + n + ' pede ' + n + '.');
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
      if (falta) b.title = 'Você tem ' + tem + ' — o lote de ' + n + ' pede ' + n + '.';
      fila.appendChild(b);
    });
    campo.addEventListener('input', mostra);
    mostra();
    var bA = btn('Anunciar lote', 'btn-mini btn-gold mc-lote-go', function () {
      var p = preco();
      if (lote > tem) { toast('Você tem ' + tem + ' ' + nome + ' — o lote de ' + lote + ' pede ' + lote + '.'); return; }
      if (!(p >= 1 && p <= teto)) { toast('Preço entre 1 e ' + teto + '.'); return; }
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
    return mcNomeLote(sid, qtd, true) + ' no balcão por ' + preco + 'v — você recebe ' + (preco - mcTaxa(preco)) + 'v na venda.';
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
    lista.appendChild(el('p', 'mc-resumo', '<b>' + somaV + '</b> ' + (somaV === 1 ? 'pedra' : 'pedras') +
      ' no estoque (' + pd.vistas.length + ' ' + (pd.vistas.length === 1 ? 'tipo' : 'tipos') + ')' +
      ' · em unidade ou lotes de 10, 50 e 100 · a taxa de 5% sai do preço do lote na venda'));
    if (!pd.vistas.length) {
      lista.appendChild(el('p', 'inv-dica', pd.todas.length ? 'Nenhuma pedra com esses filtros.'
        : 'Você não tem pedra de forja. Elas caem dos monstros e saem da quebra de peças na forja.'));
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
    var body = sheetShell('Mercadinho do Acampamento',
      'O balcão só tem o que jogador anunciou. A sua oferta fica até vender ou você retirar. Toda venda paga 5% de taxa.');
    if (!Mc) { body.appendChild(el('p', 'inv-dica', 'O mercado não carregou.')); return; }

    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);

    Promise.all([Mc.abrir(), JOGO.DB.moedas()]).then(function (r) {
      var mc = r[0], bolso = r[1];
      clear(caixa);
      if (!mc) { caixa.appendChild(el('p', 'inv-dica', 'A conta local não carregou.')); return; }
      var ofertas = mc.ofertas || [];
      var minhas = ofertas.filter(function (of) { return of.vendedor === 'jogador'; });
      var deOutros = ofertas.filter(function (of) { return of.vendedor !== 'jogador'; });

      var pBolso = el('p', 'mc-bolso', 'No bolso: <b>' + bolso + '</b> ' +
        (bolso === 1 ? 'vintém' : 'vinténs'));
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
        // 22/09: a categoria em cima (.mc-cats, fora da conta das .mc-filtros);
        // trocar de categoria limpa a busca — o nome de pedra não acha peça
        caixa.appendChild(mcCats(mcFiltro.cat, function (id) {
          if (id === mcFiltro.cat) return;
          mcFiltro.cat = id; mcFiltro.q = ''; sheetMercado();
        }));
        var busca = document.createElement('input');
        busca.className = 'hub-input';
        busca.placeholder = pedras ? 'buscar pedra por nome...' : 'buscar por nome...';
        busca.value = mcFiltro.q;
        busca.addEventListener('input', function () { mcFiltro.q = busca.value; pinta(); });
        caixa.appendChild(busca);
        if (pedras) {
          caixa.appendChild(chips('Elemento', 'el', mcOpElem()));
          return;
        }
        // a PRIMEIRA .mc-filtros é sempre a do espaço (as provas a acham assim)
        caixa.appendChild(chips('Espaço', 'slot', slotOpcoes()));
        caixa.appendChild(chips('Raridade', 'rar', mcOpRar()));
        if (comOrigem) {
          // 12/09: o mercador-fantasma saiu — com um vendedor só, filtrar por
          // vendedor não separava nada

          caixa.appendChild(chips('Ordem', 'ordem', mcOpOrdem()));
        }
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
        listaEl.appendChild(el('p', 'mc-resumo', '<b>' + lista.length + '</b> à venda' +
          (lista.length !== pecas.length ? ' (de ' + pecas.length + ')' : '')));
        if (!lista.length) {
          // 12/09: balcão vazio é o estado NORMAL do mercadinho agora — a
          // frase tem de explicar isso, e não parecer filtro mal posto
          listaEl.appendChild(el('p', 'inv-dica', pecas.length
            ? 'Nada com esses filtros.'
            : 'O balcão está vazio. Ele só enche quando alguém anuncia uma peça — ' +
              'e a sua oferta fica aqui até vender.'));
        }
        lista.forEach(function (of) {
          var row = linhaItem(of.itemId, of.level, of.stars,
            'de ' + esc(of.vendedorNome || 'jogador'));
          row.appendChild(el('span', 'mc-preco', of.preco + 'v'));
          var bC = btn('Comprar', 'btn-mini btn-gold', function () {
            if (!safe(function () { return P().bagFree(1); }, true)) {
              toast('O saco está cheio — não cabe mais nada.');
              return;
            }
            if (JOGO.Autoridade) JOGO.Autoridade.op('comprarMercado', { ofertaId: of.id });
            Mc.comprar(of.id).then(function (res) {
              if (!res.ok) { toast(res.erro || 'não deu'); sheetMercado(); return; }
              // o lote de pedras não devolve peça (22/09): nada de empurrar undefined no saco
              if (!res.item) { sheetMercado(); return; }
              /* A ORIGEM continua 'mercador' — é o nome que o servidor aceita
               * (ORIGENS em servidor/api.py) e trocá-lo faria o save novo ser
               * recusado na subida. O mercador-fantasma saiu do balcão; o
               * carimbo de procedência "veio do mercado" fica. */
              P().state.inventory.push(P().carimba ? P().carimba(res.item, 'mercador') : res.item);
              safe(function () { P().save(); }, null);
              toast('−' + res.pagou + ' vinténs — a peça é sua.', 'good');
              sheetMercado();
            });
          });
          if (bolso < of.preco) { bC.classList.add('is-off'); bC.title = 'faltam ' + (of.preco - bolso) + ' vinténs'; }
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
        listaEl.appendChild(el('p', 'mc-resumo', '<b>' + lista.length + '</b> ' + (lista.length === 1 ? 'lote' : 'lotes') +
          ' de pedra à venda' + (lista.length !== lotes.length ? ' (de ' + lotes.length + ')' : '') +
          ' · a pedra vai direto ao estoque, não ocupa o saco'));
        if (!lista.length) {
          listaEl.appendChild(el('p', 'inv-dica', lotes.length ? 'Nenhum lote com esses filtros.'
            : 'Nenhum lote de pedra à venda. O balcão só enche quando alguém anuncia — para vender as suas, ' +
              'vá em <b>Vender</b> › <b>Pedras</b> (em unidade ou lotes de 10, 50 e 100).'));
        }
        lista.forEach(function (of) {
          var sid = mcPedraDe(of);
          // o preço por pedra vai embaixo do preço do lote (mcPrecoLote)
          var row = mcLinhaPedra(sid, esc(mcNomeLote(sid, of.qtd, true)), 'de ' + esc(of.vendedorNome || 'jogador'));
          row.appendChild(mcPrecoLote(of.preco, of.qtd));
          var bC = btn('Comprar', 'btn-mini btn-gold', function () {
            // o lote local só existe com a autoridade desligada (o Progress não vai ao juiz)
            if (Mc.servidor && Mc.servidor.ligado()) { sheetMercado(); return; }
            bC.classList.add('is-off');
            Mc.comprar(of.id).then(function (res) {
              if (!res || !res.ok) { toast((res && res.erro) || 'não deu'); sheetMercado(); return; }
              var pd = res.pedras || { stoneId: sid, qtd: of.qtd };
              toast('−' + res.pagou + ' vinténs — +' + pd.qtd + ' ' + mcNomePedra(pd.stoneId) + ' no estoque.', 'good');
              sheetMercado();
            });
          });
          if (bolso < of.preco) { bC.classList.add('is-off'); bC.title = 'faltam ' + (of.preco - bolso) + ' vinténs'; }
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
              if (!res || !res.ok) { toast((res && res.erro) || 'não deu'); sheetMercado(); return; }
              toast(mcTextoLoteAnunciado(sid, qtd, preco), 'good');
              sheetMercado();
            });
          });
          return;
        }
        var pilhas = safe(function () { return P().invStacks(); }, [])
          .filter(function (s2) { return !!itemDef(s2.itemId) && passaFiltro(s2.itemId); });
        listaEl.appendChild(el('p', 'mc-resumo', '<b>' + pilhas.length + '</b> no saco · a taxa de 5% sai do preço na hora da venda'));
        if (!pilhas.length) listaEl.appendChild(el('p', 'inv-dica', 'Nada no saco com esses filtros.'));
        pilhas.forEach(function (pi) {
          var sugerido = Mc.precoSugerido(pi.itemId, pi.level, pi.stars);
          var row = linhaItem(pi.itemId, pi.level, pi.stars,
            (pi.count > 1 ? '×' + pi.count + ' · ' : '') + 'a régua sugere ' + sugerido + 'v');
          var campo = document.createElement('input');
          campo.type = 'number'; campo.min = '1'; campo.step = '1';
          campo.className = 'bk2-qtd mc-qtd';
          campo.placeholder = String(sugerido);
          var taxaEl = el('span', 'mc-taxa', '');
          function mostraTaxa() {
            var preco = Math.floor(Number(campo.value || sugerido)) || 0;
            if (preco <= 0) { taxaEl.textContent = ''; return; }
            var tx = mcTaxa(preco);
            taxaEl.innerHTML = 'recebe <b>' + (preco - tx) + 'v</b><small>taxa ' + tx + 'v</small>';
          }
          campo.addEventListener('input', mostraTaxa);
          mostraTaxa();
          row.appendChild(campo);
          row.appendChild(taxaEl);
          row.appendChild(btn('Anunciar', 'btn-mini btn-gold', function () {
            var preco = Math.floor(Number(campo.value || sugerido));
            var st2 = P().state;
            var entrada = st2.inventory[pi.indices[0]];
            if (!entrada) { toast('essa peça já saiu'); sheetMercado(); return; }
            if (JOGO.Autoridade) JOGO.Autoridade.op('anunciarMercado', { invIndex: pi.indices[0], preco: preco });
            Mc.anunciar(entrada, preco).then(function (res) {
              if (!res.ok) { toast(res.erro || 'não deu'); return; }
              st2.inventory.splice(pi.indices[0], 1);
              safe(function () { P().save(); }, null);
              toast('No balcão por ' + preco + 'v — você recebe ' + (preco - mcTaxa(preco)) + 'v na venda.', 'good');
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
          ? '<b>' + minhas.length + '</b> anúncio(s) · ' + totalPreco + 'v anunciados · recebe <b>' +
            (totalPreco - totalTaxa) + 'v</b> depois da taxa (' + totalTaxa + 'v)'
          : 'Você não tem nada anunciado. Vá em <b>Vender</b> para pôr uma peça ou um lote de pedras no balcão.'));
        minhas.forEach(function (of) {
          var lote = mcEhLote(of), sid = lote ? mcPedraDe(of) : null;
          var row = lote
            ? mcLinhaPedra(sid, esc(mcNomeLote(sid, of.qtd, true)), 'sua oferta' +
                (of.qtd > 1 ? ' · <b>' + mcUnit(of.preco, of.qtd) + 'v</b> a pedra' : ''))
            : linhaItem(of.itemId, of.level, of.stars, 'sua oferta');
          row.classList.add('is-minha');
          var pr = el('span', 'mc-preco', of.preco + 'v');
          row.appendChild(pr);
          row.appendChild(el('span', 'mc-taxa', 'recebe <b>' + (of.preco - mcTaxa(of.preco)) + 'v</b><small>taxa ' + mcTaxa(of.preco) + 'v</small>'));
          if (lote) {
            // o lote volta ao ESTOQUE (o módulo soma as pedras): o saco cheio não impede
            var bR = btn('Retirar', 'btn-mini', function () {
              if (Mc.servidor && Mc.servidor.ligado()) { sheetMercado(); return; }
              bR.classList.add('is-off');
              Mc.retirar(of.id).then(function (res) {
                if (!res || !res.ok) { toast((res && res.erro) || 'não deu'); sheetMercado(); return; }
                var pd = res.pedras || { stoneId: sid, qtd: of.qtd };
                toast('O lote voltou: +' + pd.qtd + ' ' + mcNomePedra(pd.stoneId) + ' no estoque.', 'good');
                sheetMercado();
              });
            });
            row.appendChild(bR);
            listaEl.appendChild(row);
            return;
          }
          row.appendChild(btn('Retirar', 'btn-mini', function () {
            if (!safe(function () { return P().bagFree(1); }, true)) {
              toast('O saco está cheio — não cabe mais nada.');
              return;
            }
            if (JOGO.Autoridade) JOGO.Autoridade.op('retirarMercado', { ofertaId: of.id });
            Mc.retirar(of.id).then(function (res) {
              if (!res.ok) { toast(res.erro || 'não deu'); sheetMercado(); return; }
              if (!res.item) { sheetMercado(); return; }
              P().state.inventory.push(P().carimba ? P().carimba(res.item, 'legado') : res.item);
              safe(function () { P().save(); }, null);
              toast('A peça voltou para o saco.', 'good');
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
      caixa.appendChild(el('p', 'inv-dica', 'A roleta dos selos mudou de endereço: fica na <b>Barraquinha da Sorte</b>, na praça.'));
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
  function mcBancaPocoes(caixa, sacoDe) {
    var Mc = JOGO.Mercado;
    var lista = el('div', 'mc-lista mc-banca');
    caixa.appendChild(lista);
    var pocoes = safe(function () { return Mc.pocoesDaBanca(); }, []) || [];
    var teto = safe(function () { return P().consumivelTeto(); }, 20) || 20;
    lista.appendChild(el('p', 'mc-resumo', 'A banca do mercador: estoque sem fim, preço fixo e sem taxa. Paga com os vinténs do <b>saco</b>; cabem <b>' +
      teto + '</b> de cada poção.'));
    if (!pocoes.length) { lista.appendChild(el('p', 'inv-dica', 'O mercador não trouxe poções.')); return; }
    pocoes.forEach(function (d) {
      var tem = safe(function () { return P().consumivelVer(d.id); }, 0) || 0;
      var row = el('div', 'mc-linha mc-pocao');
      row.setAttribute('data-pocao', d.id);
      var ic = el('span', 'mc-ic');
      ic.appendChild(art('pocaoIcon', [d.id, 34], 34));
      row.appendChild(ic);
      var tx = el('div', 'ms-tx');
      tx.appendChild(el('div', 'ms-nome', esc(d.name)));
      tx.appendChild(el('div', 'ms-prog', 'cura <b>' + d.cura + ' PV</b> · fora da batalha · você tem <b class="mc-tem">' +
        tem + '</b>/' + teto));
      row.appendChild(tx);
      row.appendChild(el('span', 'mc-preco', d.preco + 'v'));
      var campo = document.createElement('input');
      campo.type = 'number'; campo.min = '1'; campo.max = String(teto); campo.step = '1';
      campo.className = 'bk2-qtd mc-qtd';
      campo.value = String(mcPocaoQtd[d.id] || 1);
      var totalEl = el('span', 'mc-taxa', '');
      var bC = btn('Comprar', 'btn-mini btn-gold', function () { compra(); });
      function qtd() { return Math.max(0, Math.floor(Number(campo.value) || 0)); }
      function porque(q) {
        if (q < 1) return 'Escolha quantas poções.';
        if (tem + q > teto) return 'Cabem ' + teto + ' de cada poção — você já tem ' + tem + '.';
        if (sacoDe() < q * d.preco) return 'Faltam vinténs no saco: ' + q + '× ' + d.name + ' custa ' + (q * d.preco) + '.';
        return '';
      }
      function mostra() {
        var q = qtd();
        if (q > 0) mcPocaoQtd[d.id] = q;
        totalEl.innerHTML = 'total <b>' + (q * d.preco) + 'v</b>';
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
          if (!res || !res.ok) toast((res && res.erro) || 'não deu');
          else toast('−' + res.pagou + ' vinténs — ' + q + '× ' + d.name + ' em Consumíveis (' + res.total + '/' + teto + ').', 'good');
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
    lista.appendChild(el('p', 'inv-dica', 'As poções vão para <b>Consumíveis</b> no inventário e se bebem <b>fora da batalha</b> ' +
      '(na praça, na sala de espera): curam a vida na hora, para não esperar ela voltar sozinha.'));
  }
  var MC_ESTADO_PT = { aberta: 'esperando o vendedor', aceita: 'aceita — confirme', recusada: 'recusada',
                       concluida: 'negócio fechado', desistiu: 'desistiu', perdida: 'perdida', cancelada: 'cancelada' };
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
    return row;
  }
  function mcEstadoChip(estado) {
    return el('span', 'mc-estado e-' + estado, esc(MC_ESTADO_PT[estado] || estado));
  }

  function sheetMercadoServidor() {
    sheetName = 'mercado';
    var Srv = JOGO.Mercado.servidor;
    var body = sheetShell('Mercadinho do Acampamento',
      'O balcão de todos os jogadores. Compre pelo preço ou faça uma oferta; a taxa de 5% sai do preço final da venda.');
    var bolso = mcBolsoReal();
    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);
    var pBolso = el('p', 'mc-bolso', 'No saco: <b>' + bolso.saco + '</b> · no banco: <b>' + bolso.banco + '</b> vinténs');
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
    function carregando() { clear(area); area.appendChild(el('p', 'inv-dica', 'Consultando o balcão…')); }
    function falhou(r) {
      clear(area);
      area.appendChild(el('p', 'inv-dica', esc((r && r.erro) || 'O servidor não respondeu — tente de novo em instantes.')));
    }
    /* depois de uma ação: com estado adotado a repintura já refez a ficha; sem, refaz aqui */
    function depois(r, textoOk) {
      if (r && r.ok) { if (textoOk) toast(textoOk, 'good'); }
      else toast((r && r.erro) || 'não deu');
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
    function filtros(aoMudar, aoCat) {
      area.appendChild(mcCats(mcSrv.cat, function (id) {
        if (id === mcSrv.cat) return;
        mcSrv.cat = id; mcSrv.q = '';
        aoCat();
      }));
      var pedras = mcSrv.cat === 'pedras';
      var busca = document.createElement('input');
      busca.className = 'hub-input';
      busca.placeholder = pedras ? 'buscar pedra por nome...' : 'buscar por nome...';
      busca.value = mcSrv.q;
      busca.addEventListener('input', function () { mcSrv.q = busca.value; aoMudar(); });
      area.appendChild(busca);
      if (pedras) {
        area.appendChild(chipsSrv('Elemento', 'el', mcOpElem(), aoMudar));
        return;
      }
      // a PRIMEIRA .mc-filtros é sempre a do tipo (tests/mercado_hud.html a acha assim)
      area.appendChild(chipsSrv('Tipo', 'slot', slotOpcoes(), aoMudar));
      area.appendChild(chipsSrv('Raridade', 'rar', mcOpRar(), aoMudar));
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
    function pintaComprar() {
      if (mcSrv.item) { pintaItem(mcSrv.item); return; }
      carregando();
      Srv.resumo().then(function (r) {
        if (!ainda()) return;
        if (!r || !r.ok) { falhou(r); return; }
        monta();
        // a categoria troca AQUI, com o resumo que já veio (sem pedir de novo)
        function monta() {
          clear(area);
          var lista = el('div', 'mc-lista');
          function pintaLista() {
            clear(lista);
            if (mcSrv.cat === 'pedras') pintaPedras(lista); else pintaItens(lista);
          }
          filtros(pintaLista, monta);
          area.appendChild(lista);
          pintaLista();
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
          lista.appendChild(el('p', 'mc-resumo', '<b>' + nPedras + '</b> ' + (nPedras === 1 ? 'pedra' : 'pedras') +
            ' em ' + nLotes + ' ' + (nLotes === 1 ? 'lote' : 'lotes') + ' à venda · ' +
            vistas.length + ' ' + (vistas.length === 1 ? 'tipo' : 'tipos') +
            (vistas.length !== todas.length ? ' (de ' + todas.length + ')' : '') +
            ' · a pedra vai direto ao estoque, não ocupa o saco'));
          if (!vistas.length) {
            lista.appendChild(el('p', 'inv-dica', todas.length ? 'Nenhuma pedra com esses filtros.'
              : 'Nenhuma pedra à venda agora. Quem tem pedra sobrando anuncia em <b>Vender</b> › <b>Pedras</b> — ' +
                'em unidade ou lotes de 10, 50 e 100.'));
          }
          vistas.forEach(function (x) {
            var row = mcLinhaPedra(x.stoneId, esc(mcNomePedra(x.stoneId)), '<b>' + x.lotes + '</b> ' +
              (x.lotes === 1 ? 'lote' : 'lotes') + ' · ' + x.pedras + ' ' + (x.pedras === 1 ? 'pedra' : 'pedras') +
              (x.meus ? ' (' + x.meus + (x.meus === 1 ? ' seu' : ' seus') + ')' : ''));
            row.appendChild(el('span', 'mc-preco', 'desde ' + x.menor + 'v' +
              (x.menorUnit != null ? '<small>' + mcNum(x.menorUnit) + 'v cada</small>' : '')));
            row.appendChild(btn('Ver lotes', 'btn-mini btn-gold', function () {
              mcSrv.item = x.stoneId; mcSrv.oferta = null; pintaComprar();
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
          lista.appendChild(el('p', 'mc-resumo', '<b>' + itens.length + '</b> ' + (itens.length === 1 ? 'item' : 'itens') +
            ' · ' + qtd + ' à venda' + (itens.length !== todos.length ? ' (de ' + todos.length + ' itens)' : '')));
          if (!itens.length) {
            lista.appendChild(el('p', 'inv-dica', todos.length ? 'Nada com esses filtros.'
              : 'O balcão está vazio. Ele só enche quando alguém anuncia uma peça — e a sua oferta fica aqui até vender.'));
          }
          itens.forEach(function (x) {
            var row = mcLinhaSrv(x.itemId, 0, 0, '<b>' + x.qtd + '</b> à venda' +
              (x.meus ? ' (' + x.meus + (x.meus === 1 ? ' seu' : ' seus') + ')' : ''));
            row.appendChild(el('span', 'mc-preco', 'desde ' + x.menor + 'v'));
            row.appendChild(btn('Ver todos', 'btn-mini btn-gold', function () {
              mcSrv.item = x.itemId; mcSrv.oferta = null; pintaComprar();
            }));
            lista.appendChild(row);
          });
        }
      });
    }

    /* ---- COMPRAR: todos os anúncios de um item, com quem vende. 22/09: o mesmo
     * para uma PEDRA (o ?id= é o da pedra) — cada linha é um lote ("Lote de 50 ·
     * vende Fulano"), com o preço do lote e o preço por pedra, e "Comprar por X"
     * sem olhar o saco (a pedra vai ao estoque). A oferta vale igual para o lote. */
    function pintaItem(itemId) {
      var pedra = ehPedraId(itemId);
      carregando();
      Srv.item(itemId).then(function (r) {
        if (!ainda()) return;
        if (!r || !r.ok) { falhou(r); return; }
        clear(area);
        area.appendChild(btn(pedra ? '← Todas as pedras' : '← Todos os itens', 'btn-mini btn-ghost mc-voltar', function () {
          mcSrv.item = null; mcSrv.oferta = null; pintaComprar();
        }));
        var ans = r.anuncios || [];
        area.appendChild(el('p', 'mc-resumo', pedra
          ? '<b>' + ans.length + '</b> ' + (ans.length === 1 ? 'lote' : 'lotes') + ' de <b>' + esc(mcNomePedra(itemId)) +
            '</b> — do mais barato ao mais caro por pedra'
          : '<b>' + ans.length + '</b> ' + (ans.length === 1 ? 'anúncio' : 'anúncios') +
            ' de <b>' + mcPeca(itemId, 0, 0) + '</b> — do mais barato ao mais caro'));
        if (!ans.length) area.appendChild(el('p', 'inv-dica', pedra ? 'Os lotes dessa pedra acabaram de sair do balcão.'
          : 'Esse item acabou de sair do balcão.'));
        var tenho = bolso.saco + bolso.banco;
        ans.forEach(function (an) {
          var qtd = Math.max(1, Math.floor(Number(an.qtd)) || 1);
          var quem = an.meu ? 'seu anúncio' : 'vende <b>' + esc(an.vendedor || 'jogador') + '</b>';
          // o preço por pedra mora embaixo do preço do lote (mcPrecoLote), não na linha de quem vende
          var row = pedra
            ? mcLinhaPedra(itemId, qtd > 1 ? 'Lote de ' + qtd : '1 pedra', quem)
            : mcLinhaSrv(itemId, an.level, an.stars, quem, true);
          if (pedra) row.setAttribute('data-lote', String(qtd));
          if (an.meu) row.classList.add('is-minha');
          row.appendChild(pedra ? mcPrecoLote(an.preco, qtd) : el('span', 'mc-preco', an.preco + 'v'));
          var form = null;
          if (!an.meu) {
            var bC = btn('Comprar por ' + an.preco, 'btn-mini btn-gold', function () {
              if (!pedra && !safe(function () { return P().bagFree(1); }, true)) { toast('O saco está cheio — não cabe mais nada.'); return; }
              bC.classList.add('is-off');
              Srv.comprar(an.id).then(function (res) {
                var oque = pedra ? mcNomeLote(itemId, qtd) : (itemDef(itemId) || {}).name;
                depois(res, res && res.ok ? 'Comprado: ' + oque + ' por ' + res.valor + ' vinténs' +
                  (res.deBanco ? ' (' + res.deBanco + ' saíram do banco)' : '') +
                  (pedra ? ' — as pedras já estão no estoque.' : '.') : null);
              });
            });
            if (tenho < an.preco) { bC.classList.add('is-off'); bC.title = 'faltam ' + (an.preco - tenho) + ' vinténs (saco + banco)'; }
            row.appendChild(bC);
            if (an.preco > 1) {
              row.appendChild(btn(an.minhaProposta ? 'Nova oferta' : 'Fazer oferta', 'btn-mini', function () {
                if (form) form.hidden = !form.hidden;
                if (form && !form.hidden) { var c0 = form.querySelector('input'); if (c0) c0.focus(); }
              }));
            }
          }
          area.appendChild(row);
          if (an.minhaProposta) {
            var sub = el('div', 'mc-sub');
            var mp = an.minhaProposta;
            var lp = el('div', 'mc-prop' + (mp.estado === 'aceita' ? ' is-aceita' : ''));
            lp.appendChild(el('span', 'mc-prop-tx', 'Sua oferta: <b>' + mp.valor + 'v</b>'));
            lp.appendChild(mcEstadoChip(mp.estado));
            lp.appendChild(btn('Cancelar', 'btn-mini btn-ghost', function () {
              Srv.cancelar(mp.id).then(function (res) { depois(res, 'Oferta cancelada.'); });
            }));
            sub.appendChild(lp);
            area.appendChild(sub);
          }
          if (!an.meu && an.preco > 1) {
            form = el('div', 'mc-oferta');
            form.hidden = mcSrv.oferta !== an.id;
            var campo = document.createElement('input');
            campo.type = 'number'; campo.min = '1'; campo.max = String(an.preco - 1); campo.step = '1';
            campo.className = 'bk2-qtd mc-qtd';
            campo.placeholder = String(Math.max(1, Math.floor(an.preco * 0.8)));
            form.appendChild(el('span', 'mc-cmp', 'Quanto você oferece (menos de ' + an.preco + '):'));
            form.appendChild(campo);
            form.appendChild(btn('Enviar oferta', 'btn-mini btn-gold', function () {
              var v = Math.floor(Number(campo.value || campo.placeholder));
              if (!(v >= 1 && v < an.preco)) { toast('A oferta vai de 1 a ' + (an.preco - 1) + ' vinténs.'); return; }
              if (v > tenho) { toast('Você não tem ' + v + ' vinténs (somando saco e banco).'); return; }
              mcSrv.oferta = null;
              Srv.propor(an.id, v).then(function (res) {
                depois(res, 'Oferta de ' + v + ' vinténs enviada a ' + (an.vendedor || 'o vendedor') +
                  '. Se ele aceitar, você confirma aqui na praça.');
              });
            }));
            area.appendChild(form);
          }
        });
      });
    }

    // ---- VENDER: o saco, com a régua e a taxa antes de anunciar
    function pintaVender() {
      clear(area);
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
        lista.appendChild(el('p', 'mc-resumo', '<b>' + pilhas.length + '</b> no saco · a taxa de 5% sai do preço final da venda'));
        if (!pilhas.length) lista.appendChild(el('p', 'inv-dica', 'Nada no saco com esses filtros.'));
        pilhas.forEach(function (pi) {
          var sugerido = JOGO.Mercado.precoSugerido(pi.itemId, pi.level, pi.stars);
          var row = mcLinhaSrv(pi.itemId, pi.level, pi.stars,
            (pi.count > 1 ? '×' + pi.count + ' · ' : '') + 'a régua sugere ' + sugerido + 'v');
          var campo = document.createElement('input');
          campo.type = 'number'; campo.min = '1'; campo.max = String(JOGO.Mercado.PRECO_MAX); campo.step = '1';
          campo.className = 'bk2-qtd mc-qtd';
          campo.placeholder = String(sugerido);
          var taxaEl = el('span', 'mc-taxa', '');
          function mostraTaxa() {
            var preco = Math.floor(Number(campo.value || sugerido)) || 0;
            if (preco <= 0) { taxaEl.textContent = ''; return; }
            taxaEl.innerHTML = 'recebe <b>' + (preco - mcTaxa(preco)) + 'v</b><small>taxa ' + mcTaxa(preco) + 'v</small>';
          }
          campo.addEventListener('input', mostraTaxa);
          mostraTaxa();
          row.appendChild(campo);
          row.appendChild(taxaEl);
          var bA = btn('Anunciar', 'btn-mini btn-gold', function () {
            var preco = Math.floor(Number(campo.value || sugerido));
            if (!(preco >= 1 && preco <= JOGO.Mercado.PRECO_MAX)) { toast('Preço entre 1 e ' + JOGO.Mercado.PRECO_MAX + '.'); return; }
            var entrada = P().state.inventory[pi.indices[0]];
            if (!entrada) { toast('essa peça já saiu'); sheetMercado(); return; }
            bA.classList.add('is-off');
            Srv.anunciar(entrada, preco, pi.indices[0]).then(function (res) {
              depois(res, 'No balcão por ' + preco + 'v — você recebe ' + (preco - mcTaxa(preco)) + 'v se vender por esse preço.');
            });
          });
          row.appendChild(bA);
          lista.appendChild(row);
        });
      }
      filtros(pintaLista, pintaVender);
      area.appendChild(lista);
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
          ? '<b>' + ans.length + '</b> de ' + r.max + ' anúncios abertos · as propostas aparecem embaixo de cada um'
          : 'Você não tem nada anunciado. Vá em <b>Vender</b> para pôr uma peça ou um lote de pedras no balcão.'));
        var novas = [];
        ans.forEach(function (an) {
          // 22/09: o lote de pedras (tipo 'pedra') mostra a pedra e o preço por pedra
          var lote = mcEhLote(an), sid = lote ? mcPedraDe(an) : null;
          var row = lote
            ? mcLinhaPedra(sid, esc(mcNomeLote(sid, an.qtd, true)), 'sua oferta' +
                (an.qtd > 1 ? ' · <b>' + mcUnit(an.preco, an.qtd) + 'v</b> a pedra' : ''))
            : mcLinhaSrv(an.itemId, an.level, an.stars, 'sua oferta');
          row.classList.add('is-minha');
          row.appendChild(el('span', 'mc-preco', an.preco + 'v'));
          row.appendChild(el('span', 'mc-taxa', 'recebe <b>' + (an.preco - an.taxa) + 'v</b><small>taxa ' + an.taxa + 'v</small>'));
          var bR = btn('Retirar', 'btn-mini', function () {
            // o lote volta ao estoque: o saco cheio não impede
            if (!lote && !safe(function () { return P().bagFree(1); }, true)) { toast('O saco está cheio — não cabe mais nada.'); return; }
            bR.classList.add('is-off');
            Srv.retirar(an.id).then(function (res) {
              var pd = (res && res.pedras) || { stoneId: sid, qtd: an.qtd };
              depois(res, lote ? 'O lote voltou: +' + pd.qtd + ' ' + mcNomePedra(pd.stoneId) + ' no estoque.'
                               : 'A peça voltou para o saco.');
            });
          });
          row.appendChild(bR);
          area.appendChild(row);
          if (!an.propostas || !an.propostas.length) return;
          var sub = el('div', 'mc-sub');
          an.propostas.forEach(function (p) {
            if (p.estado === 'aberta' && !p.vistoVendedor) novas.push(p.id);
            var lp = el('div', 'mc-prop' + (p.estado === 'aceita' ? ' is-aceita' : ''));
            lp.appendChild(el('span', 'mc-prop-tx', '<b>' + esc(p.comprador || 'jogador') + '</b> oferece <b>' + p.valor +
              'v</b> (você recebe ' + (p.valor - p.taxa) + 'v)'));
            lp.appendChild(mcEstadoChip(p.estado === 'aceita' ? 'aceita' : p.estado));
            if (p.estado === 'aberta') {
              lp.appendChild(btn('Aceitar', 'btn-mini btn-gold', function () {
                Srv.responder(p.id, true).then(function (res) {
                  depois(res, 'Proposta aceita. Quando ' + (p.comprador || 'o comprador') +
                    ' confirmar, a venda sai por ' + p.valor + 'v — se ninguém comprar antes.');
                });
              }));
              lp.appendChild(btn('Recusar', 'btn-mini btn-ghost', function () {
                Srv.responder(p.id, false).then(function (res) { depois(res, 'Proposta recusada.'); });
              }));
            }
            sub.appendChild(lp);
          });
          area.appendChild(sub);
        });
        if (novas.length) Srv.visto({ recebidas: novas });
        var vendas = r.vendas || [];
        if (vendas.length) {
          area.appendChild(el('h3', 'bk-tit', 'Vendas recentes'));
          vendas.forEach(function (v) {
            var quem = 'para <b>' + esc(v.comprador || 'jogador') + '</b>' + (v.viaProposta ? ' · por proposta' : '');
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
          : 'Você não fez nenhuma oferta. Em <b>Comprar</b>, abra um item e toque em <b>Fazer oferta</b>.'));
        ps.forEach(function (p) {
          var deQuem = 'de <b>' + esc(p.vendedor || 'jogador') + '</b> · à venda por ' + p.preco + 'v';
          var row = mcEhLote(p) ? mcLinhaPedra(mcPedraDe(p), esc(mcNomeLote(mcPedraDe(p), p.qtd, true)), deQuem)
                                : mcLinhaSrv(p.itemId, p.level, p.stars, deQuem);
          row.appendChild(el('span', 'mc-preco', p.valor + 'v'));
          row.appendChild(mcEstadoChip(p.estado));
          if (p.estado === 'aceita' && p.anuncioAberto) {
            row.appendChild(btn('Conferir', 'btn-mini btn-gold', function () { openSheet('mercadoConfirma', p); }));
          }
          if (p.estado === 'aberta' || p.estado === 'aceita') {
            row.appendChild(btn('Cancelar', 'btn-mini btn-ghost', function () {
              Srv.cancelar(p.id).then(function (res) { depois(res, 'Oferta cancelada.'); });
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
    var b = sheetShell('Proposta aceita no Mercadinho');
    sheetName = 'mercadoConfirma';
    // 22/09: a proposta pode ser por um LOTE de pedras — o texto do dono diz "pelo lote"
    var lote = mcEhLote(p), sid = lote ? mcPedraDe(p) : null;
    b.appendChild(el('p', 'confirm-txt', 'O vendedor <b>' + esc(p.vendedor || 'jogador') + '</b> aceitou sua oferta de <b>' +
      p.valor + '</b> vinténs pel' + (lote ? 'o lote' : 'o item') + ' que estava à venda por <b>' + p.preco + '</b>.'));
    var card = lote
      ? mcLinhaPedra(sid, esc(mcNomeLote(sid, p.qtd, true)), (p.qtd > 1 ? '<b>' + mcUnit(p.valor, p.qtd) + 'v</b> a pedra · ' : '') +
          'as pedras vão direto ao estoque')
      : mcLinhaSrv(p.itemId, p.level, p.stars, null, true);
    card.classList.add('mc-card');
    card.appendChild(el('span', 'mc-preco', p.valor + 'v'));
    b.appendChild(card);
    var bolso = mcBolsoReal(), tem = bolso.saco + bolso.banco;
    b.appendChild(el('p', 'mc-saldo', 'Você tem <b>' + bolso.saco + '</b> no saco e <b>' + bolso.banco + '</b> no banco. ' +
      (tem < p.valor ? '<span class="is-falta">Faltam ' + (p.valor - tem) + ' vinténs.</span>'
                     : 'O valor sai primeiro do saco; o que faltar, do banco.')));
    b.appendChild(el('p', 'confirm-txt', '<b>Deseja aceitar essa negociação?</b>'));
    var acts = el('div', 'confirm-acts');
    function fim(desfecho) {
      if (sheetName === 'mercadoConfirma') closeSheet();
      Srv.respondeuConfirmacao(p, desfecho);
    }
    var bNeg = btn('Negar', 'btn-ghost', function () {
      bNeg.classList.add('is-off'); bSim.classList.add('is-off');
      Srv.confirmar(p.id, false).then(function (r) {
        if (r && r.ok) { toast('Você recusou a negociação. O ' + (lote ? 'lote' : 'item') + ' segue à venda.'); fim('feito'); return; }
        toast((r && r.erro) || 'não deu');
        fim(r && r.status === 0 ? 'adiado' : 'feito');
      });
    });
    var bSim = btn('Aceitar', 'btn-primary', function () {
      bNeg.classList.add('is-off'); bSim.classList.add('is-off');
      Srv.confirmar(p.id, true).then(function (r) {
        if (r && r.ok) {
          toast('Negócio fechado: ' + (lote ? mcNomeLote(sid, p.qtd) : ((itemDef(p.itemId) || {}).name || p.itemId)) +
            ' por ' + p.valor + ' vinténs' + (r.deBanco ? ' (' + r.deBanco + ' saíram do banco)' : '') + '.', 'good');
          fim('feito');
        } else if (r && r.motivo === 'perdeu') {
          toast(lote ? 'Esse lote já foi vendido — você perdeu essa negociação.'
                     : 'Esse item já foi vendido — você perdeu essa negociação.');
          fim('feito');
        } else if (r && r.motivo === 'saldo') {
          toast('Saldo insuficiente: ' + (r.erro || 'faltam vinténs') + '.');
          fim('adiado');
        } else {
          toast((r && r.erro) || 'não deu');
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
    var body = sheetShell('Barraquinha da Sorte',
      'Só chefes derrubam selos. Dez selos, de qualquer elemento, compram um giro — e a roleta não repete peça até fechar o traje.');
    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);
    (function pintaColecionador() {
        var cfgSel = D().selos;
        if (!cfgSel || !P().selosVer) { caixa.appendChild(el('p', 'inv-dica', 'A barraquinha não abriu.')); return; }
        var colec = el('div', 'colec-caixa');
        colec.appendChild(el('h3', 'bk-tit', 'A roleta do Traje do Colecionador'));
        var sl = safe(function () { return P().roletaSaldo(); }, { total: 0, precisa: cfgSel.porGiro, faltam: cfgSel.porGiro, giros: 0 });
        var faltamP = safe(function () { return P().roletaFaltamPecas(); }, []);
        colec.appendChild(el('p', 'inv-dica',
          '<b>' + sl.total + '</b> selos no bolso · <b>' + cfgSel.porGiro + '</b> por giro · ' +
          (sl.giros > 0 ? '<b>' + sl.giros + '</b> giro(s) prontos' : 'faltam <b>' + sl.faltam + '</b> para o próximo') +
          (faltamP.length ? ' · ainda faltam <b>' + faltamP.length + '</b> peça(s): ' +
            esc(faltamP.map(function (pid) { return ((itemDef(pid) || {}).name || pid) + nvTxt(pid); }).join(', '))
          : ' · <b>traje fechado</b> — a repetida vira matéria de estrela')));
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
        filaEl.appendChild(el('span', 'pt-trajes-rot', 'O traje responde por:'));
        var escolhas = icoFila('colec-elem-fila', elemOpcoes('btn-tab bt-elem').filter(function (o) {
          return o.id !== 'todos';
        }), elAtual, function (e4) {
          safe(function () { return P().escolheSeloElemento(e4); }, false);
          toast('O Traje do Colecionador agora responde por ' + (ELEM_PT[e4] || e4) + '.', 'good');
          sheetLoteria();
        }, true);
        filaEl.appendChild(escolhas);
        colec.appendChild(filaEl);
        var pronta = safe(function () { return P().roletaPronta(); }, false);
        colec.appendChild(btn('Girar a roleta', 'btn-gold btn-block' + (pronta ? '' : ' is-off'),
          function () {
            // 13/09 (a segurança): com sessão do site o giro é sorteado NO SERVIDOR
            var Aut = JOGO.Autoridade;
            if (Aut && Aut.ligada && Aut.ligada()) {
              Aut.opAgora('girarRoleta', {}).then(function (res) {
                if (!res.ok) { toast(res.erro || 'O servidor não girou a roleta.'); return; }
                giro(res.resultado || null);
              });
              return;
            }
            giro(safe(function () { return P().giraRoleta(); }, null));
            function giro(r2) {
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
              c2.appendChild(el('span', null, esc(((itemDef(pid) || {}).name || pid) + nvTxt(pid))));
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
                      (r2.repetida ? ' — repetida, matéria de estrela.' : '! Já está no saco.'), 'good');
                setTimeout(function () { sheetLoteria(); }, 900);
                return;
              }
              passo++;
              setTimeout(roda, 60 + passo * 16);        // desacelera até parar
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
      if (!lado.itens.length && !(lado.pets || []).length) linha.appendChild(el('p', 'inv-dica', 'nada ainda'));
      lado.itens.forEach(function (of, idx) {
        var d2 = (D().items || {})[of.itemId] || {};
        var chip = el('button', 'tr-item');
        chip.type = 'button';
        chip.appendChild(art('itemIcon', [of.itemId, 30], 30));
        chip.appendChild(el('span', null, esc(d2.name || of.itemId) +
          (of.level ? ' +' + of.level : '') + (of.stars ? ' ★' + of.stars : '') + nvTxt(of.itemId)));
        if (editavel) {
          chip.title = 'tirar da mesa';
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
        chip.appendChild(el('span', null, esc(dp.nome) + ' · Nv ' + dp.nivel +
          (dp.estrelas ? ' ' + new Array(dp.estrelas + 1).join('★') : '') +
          (repete ? ' — você já tem' : '')));
        if (editavel) {
          chip.title = 'tirar da mesa';
          tap(chip, function () { JOGO.Troca.tiraPet(idx); });
        } else if (repete) {
          chip.title = 'um bicho de cada: com este na mesa a troca não fecha';
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
    if (!todasPilhas.length) linhaS.appendChild(el('p', 'inv-dica', 'O saco está vazio.'));
    else if (!pilhas.length) linhaS.appendChild(el('p', 'inv-dica', 'Nada no saco com esses filtros.'));
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
        if (!peca) { toast('Todas as cópias dessa peça já estão na mesa.'); return; }
        JOGO.Troca.porItem({ itemId: peca.itemId, level: peca.level || 0, stars: peca.stars || 0, iid: peca.iid || null });
      });
      linhaS.appendChild(chip);
    });
    caixa.appendChild(linhaS);

    // ---- os bichos soltos, para por na mesa (12/09)
    caixa.appendChild(el('h3', 'bk-tit', 'Seus bichos — toque para pôr na mesa'));
    var naMesaP = {};
    (est.minha.pets || []).forEach(function (o) { naMesaP[o.petId] = true; });
    var todosSoltos = ownedPets().filter(function (pid) { return !!petDef(pid); });
    var soltos = todosSoltos.filter(function (pid) { return !naMesaP[pid]; });
    var linhaP = el('div', 'tr-itens');
    if (!soltos.length) {
      linhaP.appendChild(el('p', 'inv-dica', todosSoltos.length
        ? 'Todos os bichos soltos já estão na mesa.' : 'Nenhum bicho solto.'));
    }
    soltos.forEach(function (pid) {
      var pd = petDef(pid) || {};
      var chip = el('button', 'tr-item tr-pet');
      chip.type = 'button';
      chip.appendChild(art('petIcon', [pid, 30], 30));
      chip.appendChild(el('span', null, esc(pd.name || pid) + ' · ' + petNivelTxt(pid)));
      tap(chip, function () {
        if (!JOGO.Troca.porPet(pid)) toast('Esse bicho não pode ir à mesa agora (no máximo 6 por troca).');
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
        'Bicho vestido num herói não vai à mesa: solte-o na ficha do herói primeiro. ' +
        'O bicho vai com o nível e as estrelas; quem já tem aquele bicho não recebe outro.'));
    }

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
    { k: 'hp', rot: 'PV', cls: 's-hp' },
    { k: 'pa', rot: 'PA', cls: 's-pa' },
    { k: 'pp', rot: 'PP', cls: 's-pp' },
    { k: 'power', rot: 'poder' },
    { k: 'elemPower', rot: 'poder elem.', cls: 's-el' },
    { k: 'initiative', rot: 'iniciativa' },
    { k: 'dodge', rot: 'esquiva' },
    { k: 'lock', rot: 'fixação' }
  ];
  var CHAR_FONTES = [
    { id: 'itens', rot: 'Equipamento', dica: 'as peças que você está vestindo' },
    { id: 'conjuntos', rot: 'Conjuntos', dica: 'peças da mesma série vestidas juntas' },
    { id: 'pet', rot: 'Pet', dica: 'o bicho vestido, com o nível e as estrelas dele' },
    { id: 'estrelas', rot: 'Estrelas da classe',
      dica: 'as cartas de chefe que passaram do custo de liberar a classe' }
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

  function sheetChar() {
    sheetName = 'char';
    var body = sheetShell('Personagem',
      'A sua conta: o que você é, o que o equipamento está te dando e a sua coroa na arena.');
    var caixa = el('div', 'ms-caixa');
    body.appendChild(caixa);
    if (!JOGO.DB) { caixa.appendChild(el('p', 'inv-dica', 'A conta local não carregou.')); return; }

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
        esc(j.nome || 'Sem Nome')));
      var tituloVivo = tituloPendurado(j.titulo);
      if (tituloVivo) colT.appendChild(el('div', 'char-titulo', esc(tituloVivo)));
      if (souMestre3) colT.appendChild(el('span', 'chip chip-ok', 'Mestre do Fundo'));
      else if (brilho) {
        colT.appendChild(el('span', 'char-medalha is-' + brilho,
          'Top ' + estT.pvm + ' do ranking de XP'));
      }
      if (resumoGuilda && resumoGuilda.nome) {
        var lg = el('div', 'char-guilda');
        if (BR() && BR().ehCodigo(resumoGuilda.emblema)) lg.appendChild(elShield(resumoGuilda.emblema, 28));
        lg.appendChild(el('span', null, esc(txtGuilda(resumoGuilda.emblema, resumoGuilda.nome))));
        colT.appendChild(lg);
      }
      var somaN = safe(function () { return resumoDaConta().total; }, 0);
      colT.appendChild(el('div', 'char-sub', 'nível somado da conta: <b>' + somaN + '</b>'));
      topo.appendChild(colT);
      caixa.appendChild(topo);

      // ---- A ARENA e o interruptor da coroa
      caixa.appendChild(el('h3', 'bk-tit', 'Arena'));
      var pts = bz ? bz.pts : 1000, partidas = (bz && bz.partidas) || 0;
      var tierC = null;
      if (JOGO.Brasa) {
        tierC = JOGO.Brasa.tierDe(pts, souTopoDaArena());
        if (tierC && tierC.min === 0 && !(partidas > 0)) tierC = null;
      }
      var cx = el('div', 'char-arena');
      if (tierC && JOGO.COROAS_PVP && JOGO.COROAS_PVP[tierC.id]) {
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
        tierC ? esc(tierC.nome) : 'sem coroa — a arena ainda não te viu'));
      colA.appendChild(el('div', 'char-sub', '<b>' + pts + '</b> pontos · ' +
        partidas + ' partida' + (partidas === 1 ? '' : 's') +
        (JOGO.Brasa ? ' · temporada <b>' + JOGO.Brasa.temporadaDe(Date.now()) + '</b>' : '')));
      if (tierC && tierC.brilho > 0) {
        colA.appendChild(el('div', 'char-sub',
          'a coroa brilha — e o brilho cresce at\u00e9 a <b>Coroa X</b>'));
      } else if (tierC) {
        colA.appendChild(el('div', 'char-sub',
          'da <b>Coroa V</b> em diante ela come\u00e7a a brilhar'));
      }
      cx.appendChild(colA);
      caixa.appendChild(cx);

      var oculta = j.coroaOculta === true;
      if (campoDentro()) {
        // 14/09 (o dono): no Campo de PvP a coroa fica ligada "e lá não poderá desligar"
        var bTrava = btn('A coroa fica ligada no Campo de PvP', 'btn-mini btn-block btn-ghost is-apagado coroa-trava', function () {
          toast('No Campo de PvP a coroa não desliga — saia do Campo para escondê-la.');
        });
        bTrava.title = 'saia do Campo de PvP para esconder a coroa';
        caixa.appendChild(bTrava);
      } else caixa.appendChild(btn(oculta ? 'Mostrar a coroa acima da cabeça'
                                   : 'Esconder a coroa acima da cabeça',
        'btn-mini btn-block ' + (oculta ? 'btn-gold' : 'btn-ghost'), function () {
          JOGO.DB.definirCoroaOculta(!oculta).then(function () {
            toast(!oculta ? 'A coroa saiu da sua cabeça — os pontos ficam.'
                          : 'A coroa voltou para cima da sua cabeça.', 'good');
            resumoCoroaOculta = !oculta;      // o fantasma dos outros obedece o resumo
            reanunciaPerfil();
            if (JOGO.UI && JOGO.UI.repaint) JOGO.UI.repaint();
            sheetChar();
          });
        }));
      caixa.appendChild(el('p', 'inv-dica', oculta
        ? 'Escondida: nem você nem os outros veem o troféu na praça. Os pontos continuam no placar.'
        : 'Aparecendo para todo mundo na praça. Os pontos do placar não mudam com isto.'));

      /* ---- O TÍTULO DA PLAQUINHA (11/09, dono: "o título é editado na aba
       * do personagem"). 12/09: um MENU SUSPENSO dividido por fonte — ranking
       * de XP (Top 1, 2 e 3 PVM), ranking PvP (Top 1, 2 e 3 Pvp) e os chefes
       * (dez quedas no difícil e sozinho). O que ainda não é seu aparece
       * apagado no próprio menu; o "como ganhar" fica recolhido embaixo. Os de
       * ranking são emprestados: some o título no dia em que a posição some,
       * sem apagar a escolha. */
      caixa.appendChild(el('h3', 'bk-tit', 'Título na plaquinha'));
      var Tt = JOGO.Titulos;
      if (!Tt) {
        caixa.appendChild(el('p', 'inv-dica', 'Os títulos não carregaram.'));
      } else {
        var catal = Tt.catalogo(estT);
        var ganhos = catal.filter(function (t) { return t.ganho; });
        // 03/10: e o pódio do Eco Primordial — sem o grupo 'eco' no menu o título ganho não tinha onde ser escolhido
        var porFonte = { pvm: 'Ranking de XP (PvM)', pvp: 'Ranking PvP', classe: 'Ranking por classe',
                         eco: 'O Eco Primordial (pódio da semana)', chefe: 'Chefes, no difícil e sozinho' };
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
          esc(escolhidoT || '— sem título —') + '</span><span class="tit-seta">▾</span>';
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
            if (JOGO.Hub && JOGO.Hub.nomeia) JOGO.Hub.nomeia(undefined, tt);
            reanunciaPerfil();        // o título aparece para todos, não só aqui
            toast(tt ? 'Agora você é ' + (j.nome || 'você') + ', ' + tt + '.' : 'Sem título — só o nome.', 'good');
            sheetChar();
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
        listaT.appendChild(itemT('', '— sem título —', '', true));
        ['pvm', 'pvp', 'classe', 'eco', 'chefe'].forEach(function (f) {
          listaT.appendChild(el('div', 'tit-grupo', esc(porFonte[f])));
          // os pódios de classe são 21 (três por classe): no menu entram só os que já são seus
          var doGrupo = catal.filter(function (t) { return t.fonte === f && (f !== 'classe' || t.ganho); });
          if (!doGrupo.length) listaT.appendChild(itemT(null, 'nenhum pódio de classe ainda', '', false));
          doGrupo.forEach(function (t) {
            listaT.appendChild(itemT(t.titulo, t.titulo,
              t.ganho ? '' : (t.alvo ? t.prog + '/' + t.alvo + ' quedas' : 'ainda não é seu'), t.ganho));
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
            'Nenhum título ainda. Eles não vêm de missão: são pódio de ranking ou ' +
            'teimosia contra um chefe.'));
        }

        // como ganhar cada um — recolhido, para a aba não virar uma lista comprida
        var comoT = document.createElement('details');
        comoT.className = 'tit-como';
        comoT.appendChild(el('summary', null, 'Como ganhar cada título'));
        ['pvm', 'pvp', 'classe', 'eco', 'chefe'].forEach(function (f) {
          comoT.appendChild(el('div', 'char-fonte',
            '<span class="char-fonte-nm">' + esc(porFonte[f]) + '</span>'));
          if (f === 'classe') {
            comoT.appendChild(el('p', 'inv-dica', 'Seja o 1º, 2º ou 3º de uma classe no ranking do site ' +
              '(a XP daquela classe): "Top 1 Xamã", "Top 2 Bárbaro"… Vale para cada classe e não acende o nome — ' +
              'o nome brilhante é só do ranking geral de XP, que soma a conta inteira.'));
          }
          catal.filter(function (t) { return t.fonte === f && (f !== 'classe' || t.ganho); }).forEach(function (t) {
            var linha = el('div', 'tit-linha' + (t.ganho ? ' is-ganho' : ''));
            linha.appendChild(el('span', 'tit-nm', esc(t.titulo)));
            if (t.ganho) {
              linha.appendChild(el('span', 'tit-ok', t.emprestado ? 'seu enquanto durar' : 'seu para sempre'));
            } else if (t.alvo) {
              linha.appendChild(el('span', 'tit-falta',
                esc(t.de) + ' · <b>' + t.prog + '</b>/' + t.alvo + ' quedas'));
            } else {
              linha.appendChild(el('span', 'tit-falta', esc(t.comoGanhar)));
            }
            comoT.appendChild(linha);
          });
        });
        caixa.appendChild(comoT);
      }

      /* ---- OS NÚMEROS, herói por herói. Só os que DESCERAM (11/09, pedido
       * do dono: "ao abrir a aba personagem deve trazer somente dos
       * personagens selecionados") — a ficha é do grupo que está em jogo,
       * não do acervo. Fora de uma descida (no menu), mostra os liberados,
       * senão a aba abriria vazia. */
      var libs = selHeroes.length ? selHeroes.slice() : heroIds().filter(isUnlocked);
      if (!libs.length) {
        caixa.appendChild(el('p', 'inv-dica', 'Nenhuma classe liberada ainda.'));
        return;
      }
      if (libs.indexOf(charHeroi) < 0) charHeroi = libs[0];
      caixa.appendChild(el('h3', 'bk-tit', 'Características'));
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
      cab.appendChild(el('span', 'char-sub', 'nível <b>' + (h.level || 1) + '</b> · ' +
        esc(ELEM_PT[h.element] || 'Neutro')));
      caixa.appendChild(cab);
      charLinhaStats(caixa, tot, 'is-total');

      if (ext) {
        caixa.appendChild(el('p', 'inv-dica', 'De onde vem cada número:'));
        var nu = el('div', 'char-fonte');
        nu.appendChild(el('span', 'char-fonte-nm', 'Corpo no nível ' + (h.level || 1)));
        caixa.appendChild(nu);
        charLinhaStats(caixa, ext.base, 'is-base');
        CHAR_FONTES.forEach(function (f) {
          var d = ext.fontes[f.id];
          var cab2 = el('div', 'char-fonte');
          cab2.appendChild(el('span', 'char-fonte-nm', f.rot));
          cab2.appendChild(el('span', 'char-sub', esc(f.dica)));
          caixa.appendChild(cab2);
          if (!d || !charLinhaStats(caixa, d, 'is-ganho')) {
            caixa.appendChild(el('div', 'char-stats is-zero', 'nada ainda'));
          }
        });
      }
    });
  }

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

      caixa.appendChild(el('h3', 'bk-tit', 'Níveis (' + linhas.length +
        (linhas.length === 1 ? ' conta' : ' contas') + ')'));
      linhas.forEach(function (e2, i) {
        var row = el('div', 'pl-linha' + (e2.sou ? ' is-eu' : ''));
        row.appendChild(el('span', 'pl-pos', '#' + (i + 1)));
        var tx = el('div', 'ms-tx');
        tx.appendChild(el('div', 'ms-nome',
          '<span class="' + ('pl-nm' + classeDoNome(e2.nome, e2.sou)).trim() + '">' +
          esc(e2.nome) + '</span>' +
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

      /* O RANKING POR CLASSE: três degraus por classe, o nome de cada um já
       * na cor da medalha. É a tabela que explica de onde vem o brilho que
       * se vê na praça — sem ela, o jogador só veria nomes acesos. */
      var contasP = contasDoPlacar(lista, eu2.id, eu2.nome || 'Você');
      var porClasse = {};
      contasP.forEach(function (c) {
        var cls = (c.resumo && c.resumo.classes) || {};
        Object.keys(cls).forEach(function (cid) { if (cls[cid] > 0) porClasse[cid] = true; });
      });
      var cids = Object.keys(porClasse).sort(function (a3, b3) {
        return className(a3).localeCompare(className(b3));
      });
      if (cids.length) {
        caixa.appendChild(el('h3', 'bk-tit', 'Pódio por classe'));
        caixa.appendChild(el('p', 'inv-dica',
          'Os três primeiros de cada classe entre as contas que já cruzaram a sua praça. ' +
          'O nome aceso vem do ranking de XP do site: ouro, prata e bronze para o top 1, 2 e 3.'));
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

      caixa.appendChild(el('h3', 'bk-tit', 'Arena — a Brasa'));
      JOGO.DB.brasaVer().then(function (bz) {
        var arena = [{ id: eu2.id, nome: (eu2.nome || 'Você'), sou: true,
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
          /* A COROA I NÃO É DE GRAÇA (11/09, dono: "todos começam com a coroa
           * 1 liberada"). É a mesma regra do novato que a plaquinha da praça,
           * o perfil e a ficha do personagem já aplicavam — só esta lista
           * tinha ficado de fora e dava Coroa I a quem nunca duelou. Quem tem
           * zero partidas aparece no placar (os pontos são reais), mas sem
           * degrau: a coroa é de quem pisou na arena. */
          var tier = JOGO.Brasa ? JOGO.Brasa.tierDe(a.pts, i === 0) : null;
          if (tier && tier.min === 0 && !(a.partidas > 0)) tier = null;
          var row = el('div', 'pl-linha' + (a.sou ? ' is-eu' : ''));
          row.appendChild(el('span', 'pl-pos', '#' + (i + 1)));
          var tx = el('div', 'ms-tx');
          tx.appendChild(el('div', 'ms-nome',
            '<span class="' + ('pl-nm' + classeDoNome(a.id, a.sou)).trim() + '">' +
            esc(a.nome) + '</span>' +
            (a.sou ? ' <span class="pl-eu">você</span>' : '')));
          // a coroa acende do 5º degrau para cima — o mesmo halo da praça,
          // aqui como sombra colorida atrás do nome do degrau
          var degrau = el('div', 'ms-prog',
            tier ? esc(tier.nome) : 'ainda não pisou na arena');
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
    lastDuelFim = data;
    var s = screens.duelFim;
    clear(s);
    data = data || {};
    if (data.rede) { duelFimRede(s, data); return; }      // 11/09: o duelo contra outra pessoa
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
    box.appendChild(vidaBloco('fim'));       // 14/09: o treino não gasta vida, mas a da conta segue à vista
    box.appendChild(btn('Voltar ao Acampamento', 'btn-primary btn-block', function () {
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
    var chip = el('span', 'eco-chip', '💠 Dano no Eco: <b>' + ecoNum(e.dano) + '</b> (' + pct + '%)');
    tipOn(chip, 'O placar da tentativa', 'A vida que o seu grupo tirou do Eco Primordial. O servidor refaz a ' +
      'tentativa com os seus lances e é o número DELE que entra no ranking.' +
      (e.derrubou ? '<br><b>Derrubado:</b> +' + Math.round((D().eco || {}).bonusDerrubada * 100) + '% da vida máxima nos pontos.' : ''),
      '#9a7ad8');
    bt.room.appendChild(chip);
    if (eco) {
      var fase = el('span', 'eco-fase', esc(ELEM_PT[eco.element] || eco.element));
      fase.style.setProperty('--ec', elemColor(eco.element));
      var vence = (D().beatenBy || {})[eco.element];
      tipOn(fase, 'A fase do Eco: ' + (ELEM_PT[eco.element] || eco.element),
        'A cada 25% de vida perdida ele troca de elemento (Fogo → Água → Terra → Ar) e chama dois Ecos Menores.' +
        (vence ? '<br>Agora ele é <b>fraco a ' + esc(ELEM_PT[vence] || vence) + '</b>.' : ''), elemColor(eco.element));
      bt.room.appendChild(fase);
    }
    if (e.aviso) {
      var av = el('span', 'eco-aviso', '⚠ ' + esc(e.aviso.nome));
      tipOn(av, e.aviso.nome, 'As casas marcadas no chão explodem no começo da próxima vez do Eco. ' +
        'Saia delas — o pilar alto abriga da onda.', '#ff7a5a');
      bt.room.appendChild(av);
    }
  }

  function sheetEco() {
    var body = sheetShell('O Eco Primordial',
      'O chefe supremo da semana. O placar é o dano que o seu grupo tira dele — conferido pelo servidor.');
    sheetName = 'eco';
    var cfg = D().eco || {};
    var status = el('div', 'eco-status');
    body.appendChild(status);

    // a dupla de "Quem desce" e o botão
    var dupla = el('p', 'eco-dupla', '');
    body.appendChild(dupla);
    var rotulo = ecoOficial() ? 'Enfrentar o Eco' : 'Treinar contra o Eco (não conta no placar)';
    var bEnt = btn(rotulo, 'btn-warn btn-block eco-entra', function () { entra(); });
    body.appendChild(bEnt);
    function entra() {
      if (!selHeroes.length) { toast('Escolha a sua dupla em "Quem desce" primeiro.'); return; }
      var r = safe(function () {
        return G().startEco(selHeroes.slice(), function (res) {
          if (res && res.ok) { if (sheetName === 'eco') closeSheet(); return; }
          bEnt.disabled = false;
          bEnt.textContent = rotulo;
          toast((res && res.erro) || 'A Câmara do Eco não abriu.');
          ecoLer(true).then(function (r2) { if (sheetName === 'eco' && body.isConnected) pinta(r2); });
        });
      }, false);
      if (r === 'esperando') { bEnt.disabled = true; bEnt.textContent = 'Abrindo a Câmara…'; return; }
      if (!r) { toast('Essa dupla não enfrenta o Eco: o Mestre fica de fora, e em grupo pela Rede ainda não.'); return; }
      if (sheetName === 'eco') closeSheet();
    }
    function pintaDupla() {
      var nomes = selHeroes.map(function (hid) {
        var h = hero(hid);
        return esc(className((h && h.classId) || hid)) + (h && h.level ? ' <small>nv ' + h.level + '</small>' : '');
      });
      dupla.innerHTML = nomes.length ? 'Vai a dupla de <b>Quem desce</b>: ' + nomes.join(' e ') +
        '. Todos entram com a vida cheia (a tentativa não gasta a vida dos heróis).'
        : 'Escolha a dupla em <b>Quem desce</b> para entrar.';
    }
    pintaDupla();

    var regras = el('ul', 'eco-regras');
    [(cfg.rodadas || 12) + ' rodadas por tentativa, ou até o grupo cair. ' + (cfg.tentativasPorDia || 3) +
       ' tentativas por dia (o dia de Brasília).',
     'Ele ocupa 2×2 casas no centro da Câmara e não anda. A cada 25% da vida perdida troca de elemento ' +
       '(Fogo → Água → Terra → Ar), fica fraco a quem vence o elemento novo e chama dois Ecos Menores.',
     'O golpe grande é AVISADO: as casas marcadas no chão explodem no começo da vez seguinte dele. Os pilares abrigam.',
     // 03/10: o sal de cada rodada (engine.js, "O SORTEIO RODADA A RODADA") — quem joga precisa saber que a rede conta
     'A sorte de cada rodada vem do servidor quando ela começa: a tentativa precisa de internet do começo ao fim ' +
       '(sem rede ela espera, não acaba).',
     'Vale a melhor tentativa da semana (de segunda a domingo, 23:59). Derrubá-lo soma ' +
       Math.round((cfg.bonusDerrubada || 0) * 100) + '% da vida dele aos pontos.'
    ].forEach(function (t) { regras.appendChild(el('li', null, esc(t))); });
    body.appendChild(regras);

    var rank = el('div', 'eco-rank');
    body.appendChild(rank);
    var premios = el('div', 'eco-premios');
    body.appendChild(premios);
    var site = el('a', 'eco-site', 'ver o ranking completo no site');
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
          ? 'O servidor não respondeu agora — o placar volta com ele.'
          : 'Sem conexão com o servidor: dá para TREINAR contra o Eco, mas o treino não conta no placar.'));
        return;
      }
      var falta = ecoFaltaMs(r);
      status.appendChild(el('p', 'eco-linha eco-semana', '⏳ A semana fecha em <b>' +
        esc(safe(function () { return JOGO.Agenda.falta(falta); }, null) || bonusFalta(falta)) +
        '</b> (domingo, 23:59 de Brasília).'));
      var eu = r.eu;
      if (eu) {
        status.appendChild(el('p', 'eco-linha', 'Tentativas de hoje: <b>' + eu.restantes + ' de ' +
          r.tentativasPorDia + '</b>' + (eu.restantes ? '' : ' — o Eco volta a ouvir amanhã.')));
        if (eu.foraDoRanking) status.appendChild(el('p', 'eco-linha', 'Conta da equipe: você joga, mas não entra no ranking.'));
        else if (eu.melhor) {
          status.appendChild(el('p', 'eco-linha', 'Seu melhor da semana: <b>' + ecoNum(eu.melhor.pontos) + ' pontos</b>' +
            (eu.melhor.derrubou ? ' (derrubou!)' : '') + (eu.posicao ? ' · <b>' + eu.posicao + 'º</b> lugar' : '')));
        } else status.appendChild(el('p', 'eco-linha', 'Você ainda não tem tentativa conferida nesta semana.'));
        bEnt.disabled = !eu.restantes && ecoOficial();
        (eu.premios || []).slice(0, 2).forEach(function (pr) {
          status.appendChild(el('p', 'eco-linha eco-premio-meu', '🏅 Semana de ' + ecoDatasDaSemana(pr.semana) + ': ' + pr.posicao + 'º lugar' +
            (pr.titulo ? ' — o título “' + esc(pr.titulo) + '”' : '') + ' (o prêmio chega pela fila de entregas).'));
        });
      } else if (ecoOficial()) {
        status.appendChild(el('p', 'eco-linha', 'Entre na sua conta para ver as suas tentativas.'));
      }
      rank.appendChild(el('h3', 'hs-sec', 'Os primeiros da semana'));
      var linhas = (r.ranking || []).slice(0, 10);
      if (!linhas.length) rank.appendChild(el('p', 'empty', 'Ninguém pontuou ainda nesta semana. O primeiro lugar está livre.'));
      linhas.forEach(function (l) {
        var li = el('div', 'eco-rank-linha' + (l.posicao <= 3 ? ' is-podio' : ''));
        li.appendChild(el('span', 'eco-pos', l.posicao + 'º'));
        li.appendChild(el('span', 'eco-nome', esc(l.nome) + (l.derrubou ? ' <i title="derrubou o Eco">★</i>' : '')));
        li.appendChild(el('span', 'eco-pts', ecoNum(l.pontos)));
        rank.appendChild(li);
      });
      premios.appendChild(el('h3', 'hs-sec', 'Os prêmios no fechamento'));
      (r.faixas || []).forEach(function (f) {
        var partes = [];
        if (f.vintens) partes.push(ecoNum(f.vintens) + ' vinténs');
        if (f.selos) partes.push(f.selos + ' selos de chefe');
        if (f.titulo) partes.push('o título “' + esc(f.titulo) + '”');
        premios.appendChild(el('p', 'eco-faixa', '<b>' + esc(f.nome) + '</b>: ' + partes.join(' · ')));
      });
      premios.appendChild(el('p', 'inv-dica', 'Nada disso se compra. Os prêmios chegam pela fila de entregas da conta, ' +
        'como os presentes do Mestre.'));
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
    var titulo = data.parouNaRodada ? 'A tentativa parou na rodada ' + data.parouNaRodada
      : data.largou ? 'Você saiu da Câmara'
      : pl.derrubou ? 'O Eco Primordial caiu!'
      : (!heroisVivos ? 'O seu grupo caiu' : 'As ' + (pl.rodadas || cfg.rodadas || 12) + ' rodadas acabaram');
    var box = el('div', 'game-over eco-fim' + (pl.derrubou ? ' is-derrubou' : ''));
    box.appendChild(el('h1', null, esc(titulo)));
    var dano = of ? of.dano : (pl.dano || 0);
    var pontos = of ? of.pontos : (pl.pontos || 0);
    box.appendChild(el('div', 'eco-fim-num', ecoNum(dano)));
    box.appendChild(el('p', 'game-sub', 'de dano no Eco' + (pl.derrubou ? ' · ' + ecoNum(pontos) + ' pontos com o bônus de quem derruba' : '') +
      ' · rodada ' + (pl.rodada || 0) + ' de ' + (pl.rodadas || cfg.rodadas || 12)));
    if (data.semSal) {
      box.appendChild(el('p', 'eco-fim-sal', 'O servidor não deu o sorteio da rodada ' + (data.parouNaRodada || '') +
        ': ' + esc(data.semSal) + '. O que você jogou até ali foi junto para a conferência.'));
    }
    var linha = el('p', 'eco-fim-estado');
    if (data.treino) {
      linha.innerHTML = 'Treino: sem conexão com o servidor, esta tentativa <b>não conta no placar</b>.';
    } else if (data.conferindo) {
      linha.innerHTML = 'Conferindo com o servidor… (ele refaz a tentativa com os seus lances)';
    } else if (of) {
      var eu = of.eu || {};
      linha.innerHTML = 'Conferido pelo servidor: <b>' + ecoNum(of.pontos) + ' pontos</b>.' +
        (eu.foraDoRanking ? ' Conta da equipe: fora do ranking.'
          : (eu.melhor ? ' Seu melhor da semana: <b>' + ecoNum(eu.melhor.pontos) + '</b>' +
             (eu.posicao ? ' · <b>' + eu.posicao + 'º lugar</b>' : '') + '.' : '')) +
        (typeof eu.restantes === 'number' ? ' Tentativas de hoje: ' + eu.restantes + '.' : '');
      if (of.dano !== pl.dano && pl.dano != null) {
        linha.innerHTML += '<br><small>O número desta tela era ' + ecoNum(pl.dano) + '; vale o do servidor.</small>';
      }
    } else if (data.erro) {
      linha.className = 'eco-fim-estado is-erro';
      linha.innerHTML = 'O servidor não contou esta tentativa: ' + esc(data.erro);
    }
    box.appendChild(linha);
    var acts = el('div', 'menu-acts');
    var restam = data.treino ? 1 : (of && of.eu && typeof of.eu.restantes === 'number' ? of.eu.restantes : 0);
    if (restam > 0 && selHeroes.length) {
      acts.appendChild(btn('Tentar de novo', 'btn-primary', function () {
        var r = safe(function () {
          return G().startEco(selHeroes.slice(), function (res) {
            if (!(res && res.ok)) toast((res && res.erro) || 'A Câmara do Eco não abriu.');
          });
        }, false);
        if (!r) toast('Essa dupla não enfrenta o Eco.');
      }));
    }
    acts.appendChild(btn('Ver o ranking', 'btn-ghost', function () {
      safe(function () { return G().restart('hub'); }, null);
      openSheet('eco');
    }));
    acts.appendChild(btn('Voltar à praça', 'btn-ghost', function () {
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
      fogo: { sala: 'A Câmara Apagada', curto: 'Escuro',
        resumo: 'quem não é do <b>Fogo</b> só mira a casa escura a <b>' + visao + ' casas</b>, e o monstro no breu some. Braseiro aceso clareia.',
        texto: 'Aqui é escuro. Quem <b>não</b> é do caminho do <b>Fogo</b> só mira uma casa escura a <b>' + visao +
               ' casas</b> — e não vê o monstro que está no breu. O <b>braseiro aceso</b> clareia ' + raio +
               ' casas em volta: um golpe de <b>Fogo</b> acende, um de <b>Água</b> apaga.' },
      agua: { sala: 'A Galeria Alagada', curto: 'Água',
        resumo: 'entrar na água custa <b>' + custo + ' PP</b> (' + custoAgua + ' para quem é de <b>Água</b>) e a correnteza leva 1 casa no fim da rodada. A ponte é seca.',
        texto: 'Entrar numa casa com água custa <b>' + custo + ' PP</b> (' + custoAgua + ' para quem é do caminho da <b>Água</b>). ' +
               'No <b>fim de cada rodada</b> a correnteza leva 1 casa quem está na água, para onde os riscos correm; ' +
               'ela vira a cada ' + troca + ' rodadas, e a bica que vai verter avisa antes. A <b>ponte</b> é seca.' },
      terra: { sala: 'O Salão dos Pilares Vivos', curto: 'Pilares',
        resumo: 'os pilares <b>sobem e descem a cada ' + periodo + ' rodadas</b>; a seta ▲ ou ▼ avisa uma rodada antes. Quem está em cima segura o pilar.',
        texto: 'Os pilares <b>sobem e descem a cada ' + periodo + ' rodadas</b>. Uma rodada antes a casa pisca e a seta diz: ' +
               '<b>▲</b> vai subir, <b>▼</b> vai descer. Pilar de pé fecha o caminho e a visão. ' +
               'Ninguém é esmagado: quem está em cima do soquete <b>segura</b> o pilar até sair.' },
      ar: { sala: 'O Terraço da Ventania', curto: 'Vento',
        resumo: 'no fim da rodada a <b>rajada</b> empurra todo mundo 1 casa para onde o cata-vento aponta; feitiço de <b>Ar</b> alcança +' + alc + '. Ao lado do respiro o vento não pega.',
        texto: 'No <b>fim de cada rodada</b> a rajada empurra todo mundo 1 casa para onde o <b>cata-vento</b> e as setas do chão apontam; ' +
               'ela gira a cada ' + gira + ' rodadas, e as setas ficam âmbar na rodada antes de virar. ' +
               'Feitiço de <b>Ar</b> lançado do terraço alcança <b>' + alc + ' casa a mais</b>. Nas casas ao lado de um <b>respiro</b> o vento não pega.' },
      altar: { sala: 'O Altar dos Quatro', curto: 'As quatro',
        resumo: 'as quatro regras de uma vez, cada uma no seu canto.',
        texto: 'As quatro regras de uma vez, cada uma no seu canto: <b>escuro</b> a noroeste, <b>água</b> a nordeste, ' +
               '<b>pilares</b> a sudoeste e <b>vento</b> a sudeste, em volta do altar.' }
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
      chip('fogo', 'Escuro · <b>' + acesos + '</b> de ' + info.escuro.braseiros.length + ' braseiros acesos');
    }
    if (info.agua) {
      var vira = info.agua.proxima !== info.agua.dir;
      chip('agua', 'Correnteza <b>' + santSeta(info.agua.dir) + '</b>' +
        (vira ? ' · vira <b>' + santSeta(info.agua.proxima) + '</b> na próxima' : ''), vira);
    }
    if (info.pilares) {
      var jaAvisou = info.pilares.aviso === s.round + 1;
      var espera = info.pilares.lista.filter(function (p) { return p.espera; }).length;
      chip('terra', (jaAvisou ? 'Pilares trocam na <b>próxima rodada</b>' : 'Pilares trocam na rodada <b>' + info.pilares.trocaNa + '</b>') +
        (espera ? ' · ' + espera + ' esperando' : ''), jaAvisou);
    }
    if (info.vento) {
      var gira = info.vento.proxima !== info.vento.dir;
      chip('ar', 'Rajada <b>' + santSeta(info.vento.dir) + '</b>' +
        (gira ? ' · gira <b>' + santSeta(info.vento.proxima) + '</b> na próxima' : ''), gira);
    }
  }

  function sheetSantuario() {
    var dg = safe(function () { return D().especial(santCfg().id || 'elementsanctum'); }, null);
    var body = sheetShell('O Santuário dos Elementos',
      'O calabouço em que o mapa joga: cada sala tem uma regra de terreno, e quem conhece o elemento dela leva vantagem.');
    sheetName = 'santuario';
    if (!dg) { body.appendChild(el('p', 'empty', 'O Santuário não está nesta versão do jogo.')); return; }

    body.appendChild(el('p', 'sant-desc', esc(dg.description || '')));
    body.appendChild(el('p', 'sant-linha', '<b>' + dg.rooms.length + ' salas</b>, sem chefe · nível recomendado <b>' +
      dg.recommendedLevel + '</b> · vale em dupla e em grupo pela Rede'));

    // ---- quem desce, e o que a dupla enxerga
    var dupla = el('p', 'sant-dupla', '');
    body.appendChild(dupla);
    var avisos = el('div', 'sant-avisos');
    body.appendChild(avisos);
    (function () {
      var hs = selHeroes.map(hero).filter(Boolean);
      dupla.innerHTML = hs.length
        ? 'Desce a dupla de <b>Quem desce</b>: ' + hs.map(function (h) {
            return esc(className(h.classId)) + ' <small>nv ' + (h.level || 1) + ' · ' + esc(ELEM_PT[h.element || 'neutro'] || '') + '</small>';
          }).join(' e ') + '.'
        : 'Escolha a dupla em <b>Quem desce</b> para entrar.';
      if (!hs.length) return;
      if (!hs.some(function (h) { return h.element === 'fogo'; })) {
        avisos.appendChild(el('p', 'sant-aviso', 'Ninguém do <b>Fogo</b> na dupla: na Câmara Apagada vocês só miram a ' +
          ((santCfg().escuro || {}).visao || 2) + ' casas no escuro. Dá para vencer acendendo os braseiros — com golpe de Fogo — ou chegando perto.'));
      }
      var baixo = hs.filter(function (h) { return (h.level || 1) < dg.recommendedLevel - 4; });
      if (baixo.length) {
        avisos.appendChild(el('p', 'sant-aviso', 'Abaixo do nível recomendado (' + dg.recommendedLevel + '): os guardiões daqui batem mais forte que os do Coração Partido.'));
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
        acts.appendChild(btn('Descer ao Santuário com ' + esc(nome), 'btn-primary btn-block sant-entra', function () {
          var r = safe(function () { return Gp().descer(dg.id); }, null);
          if (!r || !r.ok) toast(textoMotivo(r ? r.motivo : 'ocupado', r && r.motivo === 'sumido' ? nome : null));
          else { toast('Chamando ' + nome + '…'); if (sheetName === 'santuario') closeSheet(); }
        }));
      } else {
        acts.appendChild(el('p', 'hub-nota', 'Só quem lidera (<b>' + esc(nome) + '</b>) escolhe o calabouço.'));
        acts.appendChild(btn('Descer ao Santuário', 'btn-primary btn-block sant-entra is-apagado', function () {
          toast('Só quem lidera (' + nome + ') escolhe o calabouço.');
        }));
      }
    } else {
      var sd = seletorDif();
      if (sd) acts.appendChild(sd);
      acts.appendChild(btn('Descer ao Santuário', 'btn-primary btn-block sant-entra', function () {
        if (!selHeroes.length) { toast('Escolha a sua dupla em "Quem desce" primeiro.'); return; }
        var ok = safe(function () { return G().startRun(selHeroes.slice(), dg.id); }, false);
        if (!ok) { toast('Não deu para começar essa descida.'); return; }
        if (sheetName === 'santuario') closeSheet();
      }));
    }

    // ---- as salas e as regras
    body.appendChild(el('h3', 'hs-sec', 'As cinco salas'));
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
        card.appendChild(el('p', 'sant-sala-quem', 'Guardiões: ' + quem.map(function (m) {
          return esc(m.name) + (m.qtd > 1 ? ' ×' + m.qtd : '');
        }).join(' · ')));
      }
      lista.appendChild(card);
    });
    body.appendChild(lista);

    // ---- o que paga
    body.appendChild(el('h3', 'hs-sec', 'O que o Santuário paga'));
    var paga = el('ul', 'sant-paga');
    ['Experiência de fim de jogo em cada sala (a descida inteira rende mais que a do Coração Partido).',
     'Pedras de forja do elemento de cada quadrante — é o melhor lugar para juntar pedra de um elemento só.',
     'Peças do Coração Partido: comuns e raras nas quatro primeiras salas; épicas e lendárias no Altar, com dois sorteios.',
     'Sem chefe: aqui não caem selo, insígnia, âncora nem carta.'
    ].forEach(function (t) { paga.appendChild(el('li', null, esc(t))); });
    body.appendChild(paga);
    body.appendChild(btn('Rever as dicas das salas', 'btn-ghost btn-mini sant-dicas', function () {
      var n = safe(function () { return JOGO.Tutor.reveSantuario(); }, 0);
      toast(n ? 'As dicas do Santuário voltam a aparecer na entrada de cada sala.' : 'As dicas estão desligadas neste aparelho.');
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
    char: 'fc-personagem', heroSheet: 'fc-personagem', amigos: 'fc-amigos', guilda: 'fc-guilda',
    banco: 'fc-banco', missoes: 'fc-missoes', mercado: 'fc-mercado', mercadoConfirma: 'fc-mercado',
    loteria: 'fc-loteria', placar: 'fc-placar', troca: 'fc-troca', contas: 'fc-contas',
    perfil: 'fc-perfil', duelo: 'fc-duelo', dueloRede: 'fc-duelo', escolheDupla: 'fc-duelo',
    arenaQuadro: 'fc-duelo', sussurro: 'fc-mensagem', battleMenu: 'fc-pausa', config: 'fc-config',
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
    fecha.setAttribute('aria-label', 'Fechar');
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
    acts.appendChild(btn('Cancelar', 'btn-ghost', function () {
      closeSheet();
      if (op.aoCancelar) op.aoCancelar();
    }));
    acts.appendChild(btn(op.sim || 'Confirmar', op.simCls || 'btn-primary', function () { closeSheet(); onYes(); }));
    b.appendChild(acts);
  }

  // 03/10: as fichas do Mestre de antes viraram abas do painel único (js/ui/painel_mestre.js)
  var GM_FICHA_ABA = { gm: 'grimorio', gmcaixa: 'caixa', gmagenda: 'eventos' };
  function openSheet(name, arg) {
    if (GM_FICHA_ABA.hasOwnProperty(name)) { gmAbre(GM_FICHA_ABA[name]); return; }
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
    else if (name === 'sussurro') sheetSussurro(arg && arg.id, arg && arg.nome);   // 11/09: a mensagem particular
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
      sub: 'Arraste a peça para a bancada e bata o martelo — ou quebre a peça em pedras do elemento dela. Embaixo, a Estrela funde 3 cópias.' },
    { id: 'feiticos', nome: 'Feitiços',
      sub: 'A árvore inteira da classe: o tronco que todos têm e os quatro galhos elementais.' },
    { id: 'colecao', nome: 'Coleção',
      sub: 'Cartas de chefe liberam classes e, depois, viram estrelas permanentes.' },
    /* 11/09: a aba do AVATAR saiu — o avatar deixou de ser escolha. Quem
     * anda no Acampamento é o PRIMEIRO herói de "Quem desce", e ponto. A
     * entrada 'avatar' fica aqui fora da lista para não quebrar quem ainda
     * chamar sheetParty('avatar') (o guarda-roupa segue no código, mudo). */
    { id: 'avatar', nome: 'Avatar', oculta: true,
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
    /* COMO FUNCIONA (11/09, dono: "de alguma forma o jogador precisa entender
     * sobre as estrelas da conta e liberação de outros personagens"). A regra
     * inteira em quatro linhas, no alto da ficha onde ela acontece — porque
     * até aqui ela só existia no código e na barra de progresso, e barra sem
     * frase não ensina ninguém: o jogador via "3 / 15 cartas" e não sabia de
     * onde vinham, nem que o excedente vira estrela sozinho. */
    var comoP = el('div', 'col-como');
    comoP.appendChild(el('h4', null, 'Como se libera um personagem'));
    comoP.appendChild(el('p', null,
      '<b>1.</b> Só <b>chefe</b> derruba carta — e nem sempre. Calabouço mais fundo ' +
      'derruba mais cartas de uma vez.<br>' +
      '<b>2.</b> A carta entra na coleção <b>sozinha</b>, na hora: não há nada para ' +
      'usar nem para juntar à mão.<br>' +
      '<b>3.</b> Ao completar o custo da classe, ela <b>libera na hora</b> e entra em ' +
      '"Quem desce".<br>' +
      '<b>4.</b> Carta repetida não se perde: tudo o que passa do custo vira ' +
      '<b>estrela</b> — bônus permanente daquela classe, que já conta nos números ' +
      'da ficha do Personagem.'));
    body.appendChild(comoP);

    var legend = el('div', 'col-legend');
    for (var s = 1; s <= (cfg.max || 5); s++) {
      var bn = cfg.bonuses && (cfg.bonuses[s] || cfg.bonuses[String(s)]);
      legend.appendChild(el('span', 'chip', '★' + s + ' ' + esc(bonusText(bn))));
    }
    body.appendChild(el('p', 'inv-dica', 'O que cada estrela dá, em qualquer classe:'));
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
              (sr ? ' · <b>★' + sr + '</b>' : '') +
              (nivelUsoDe(itemId) ? ' · <b>Nv. ' + nivelUsoDe(itemId) + '</b>' : '') + '</i>';
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
    avisaDevolvidasPorNivel();             // [D19] cobre a página sem praça
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
          var msgT;
          if (!r.faltas) msgT = 'Traje ' + n + ' vestido.';
          else if (r.porNivel && r.recusas && r.recusas.length) {
            msgT = 'Traje ' + n + ': ' + textoRecusa(r.recusas[0]) +
                   (r.faltas > 1 ? ' (+' + (r.faltas - 1) + ' peça(s) ficaram de fora)' : '');
          } else msgT = 'Traje ' + n + ': ' + r.faltas + ' peça(s) não estavam no saco.';
          toast(msgT, r.faltas ? undefined : 'good');
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
    // as abas e os filtros redondos (a fileira dos elementos mora lá dentro
    // desde 22/09: some nas abas sem elemento — Consumíveis e Pets)
    ladoSaco.appendChild(invFilterTabs());
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
        var nomesClasse = {}, porClasseEu = {};
        var defsC = (JOGO.DATA && JOGO.DATA.classes) || {};
        Object.keys(defsC).forEach(function (cid) {
          if (cid !== 'gm' && defsC[cid] && defsC[cid].name) nomesClasse[cid] = defsC[cid].name;
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
          // 02/10: o título do pódio do Eco Primordial é da conta, para sempre (Progress.titulosEco)
          eco: safe(function () { return P().titulosEco ? P().titulosEco() : []; }, []),
          porClasse: porClasseEu,
          classeNomes: nomesClasse,
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
    return T.valido(t, tituloEstado) ? t : '';
  }

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
    return { classes: classes2, classesXp: xps, total: total,
             brasa: resumoBrasaPts, partidas: resumoBrasaPartidas,
             // a coroa escondida viaja: o fantasma desta conta também não a usa
             coroaOculta: resumoCoroaOculta,
             // 14/09: o nível do herói mais forte da dupla da vez (a do Campo lá dentro) — a paridade do ataque
             forte: forteDaVez(),
             galeria: resumoGaleria, poco: resumoPoco, guilda: resumoGuilda };
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
    avisaHeroiAoGrupo();                  // 11/09: o grupo leva o principal
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
      cell.appendChild(el('span', 'pt-slot-it', it ? esc(it.name) + nvTxt(itemId) : 'vazio'));
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
    marcaTranca(wrap, hid, pilha.itemId);

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
      (nivelUsoDe(pilha.itemId) ? ' · <b>Nv. ' + nivelUsoDe(pilha.itemId) + '</b>' : '') +
      (pilha.level ? ' · pedra <b>+' + pilha.level + '</b> ' + esc(tierOf(pilha.level)) : '') +
      (pilha.stars ? ' · estrela <b>★' + pilha.stars + '</b>' : '')));
    if (hid && trancado(hid, pilha.itemId)) {
      var puP = safe(function () { return P().podeUsar(hid, pilha.itemId); }, null);
      if (puP) {
        tx.appendChild(el('div', 'inv-pick-tranca', '🔒 pede o nível <b>' + puP.precisa + '</b> — o ' +
          esc(className((hero(hid) || {}).classId || hid)) + ' está no ' + puP.nivel));
      }
    }
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
        limpaRecusa();
        var ok = safe(function () { return P().equip(hid, pilha.itemId, pilha.index); }, false);
        if (!ok) {
          var rc = recusaAtual();
          toast(rc ? textoRecusa(rc) : 'Não deu para equipar essa peça.');
        }
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
          forjaModo = 'forjar';
          forgeTarget = { kind: 'bag', itemId: pilha.itemId, level: pilha.level, stars: pilha.stars };
          sheetParty('forja');
        }));
    }
    // A QUEBRA (22/09): a outra porta da forja — já no modo Quebrar, com a
    // peça na bancada. Só aparece para o que se quebra (a Panóplia do Mestre
    // e a peça de elemento sem pedra não ganham o botão).
    var qb = safe(function () { return P().quebraInfoDe(pilha.itemId, pilha.level, pilha.stars); }, null);
    if (qb && qb.pode) {
      acts.appendChild(btn('Quebrar na forja', 'btn-mini inv-pick-quebra', function () {
        forjaModo = 'quebrar';
        forjaQuebraN = 1;
        forgeTarget = { kind: 'bag', itemId: pilha.itemId, level: pilha.level, stars: pilha.stars };
        sheetParty('forja');
      }));
    }
    wrap.appendChild(acts);
    return wrap;
  }

  /* As abas do SACO (22/09: redondas, com ícone): a categoria em cima — o
   * elmo, as pedras, a poção, a pata — e o nome da aberta escrito ao lado,
   * que no celular não há mouse para perguntar. Embaixo os filtros: espaço
   * (só nos equipamentos) e elemento (equipamentos e pedras — poção e bicho
   * não têm elemento, a fileira ali só enganaria). */
  var INV_CATS = [{ id: 'equip', ico: 'cat-equip', rot: 'Equipamentos' },
                  { id: 'pedras', ico: 'cat-pedras', rot: 'Pedras' },
                  { id: 'cons', ico: 'cat-cons', rot: 'Consumíveis' },
                  { id: 'pets', ico: 'cat-pets', rot: 'Pets' }];
  function invFilterTabs() {
    var cont = el('div', 'inv-tabs-container');

    // As abas principais (categorias)
    var mTabs = icoFila('inv-tabs-main', INV_CATS.map(function (t) {
      return { id: t.id, ico: t.ico, rot: t.rot, cls: 'btn-tab', data: { cat: t.id } };
    }), invMainTab, function (id) {
      invMainTab = id;
      invSel = null;
      sheetParty('inventario');
    }, true);
    cont.appendChild(mTabs);

    // Os filtros: espaço só nos Equipamentos; elemento nos Equipamentos e nas Pedras
    if (invMainTab === 'equip' || invMainTab === 'pedras') {
      var filtros = filtrosDeItem(invFilter, invMainTab === 'equip' ? function (f) {
        invFilter = f;
        sheetParty('inventario');
      } : null, invElemFiltro, function (e2) {
        invElemFiltro = e2;
        sheetParty('inventario');
      });
      var sub = filtros.querySelector('.slot-tabs');
      if (sub) sub.classList.add('inv-tabs-sub');
      cont.appendChild(filtros);
    }
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
      return { id: s, ico: 'slot-' + s, rot: s === 'todos' ? 'Tudo' : SLOT_PT[s],
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
      return { id: e2, ico: 'el-' + e2, rot: e2 === 'todos' ? 'Todos' : ELEM_PT[e2],
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
                  invSel.stars === pilha.stars;
        var cell = el('button', 'ig-cell ' + starClass(pilha.stars) + (sel ? ' is-sel' : ''));
        cell.type = 'button';
        markRarity(cell, it.rarity);
        marcaTranca(cell, hid, pilha.itemId);
        var plate = el('span', 'ig-plate');
        plate.appendChild(art('itemIcon', [pilha.itemId, 54], 54));
        var bs1 = setBadge(pilha.itemId);
        if (bs1) plate.appendChild(bs1);
        cell.appendChild(plate);
        if (pilha.count > 1) cell.appendChild(el('span', 'ig-n', '×' + pilha.count));
        if (pilha.level) cell.appendChild(el('span', 'ig-lv', '+' + pilha.level));
        if (pilha.stars) cell.appendChild(starPips(pilha.stars));
        cell.appendChild(el('span', 'ig-nm', esc(it.name)));
        var nvG = nvBadge(pilha.itemId);
        if (nvG) cell.appendChild(nvG);
        tap(cell, function () {
          invSel = sel ? null : { itemId: pilha.itemId, level: pilha.level, stars: pilha.stars };
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
        plate.appendChild(art('stoneIcon', [k, 54], 54));
        cell.appendChild(plate);
        cell.appendChild(el('span', 'ig-n', String(n)));
        cell.appendChild(el('span', 'ig-nm', esc(defs[k].name)));
        tap(cell, function () {
          // 22/09: a pedra sobrando tem saída — o Mercadinho vende em lote
          toast(defs[k].name + ': ' + (defs[k].description || 'Usada na forja.') +
                ' Sobrando? O Mercadinho vende avulsa ou em lotes de 10, 50 e 100.');
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
        plP.appendChild(art('pocaoIcon', [pid, 54], 54));
        cP.appendChild(plP);
        cP.appendChild(el('span', 'ig-n', '×' + nP));
        cP.appendChild(el('span', 'ig-nm', esc(dP.name)));
        cP.appendChild(el('span', 'ig-cura', 'cura ' + dP.cura + ' PV'));
        tap(cP, function () {
          toast(dP.name + ': cura ' + dP.cura + ' PV, sem passar do máximo. Beba fora da batalha (na praça, na sala de espera) — ' +
                'o quadro da vida mostra um botão por poção quando um herói está ferido.');
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
        cxp.appendChild(el('span', 'ig-nm', 'Pergaminho da Sabedoria'));
        tap(cxp, function () { lerSabedoria(function () { sheetParty('inventario'); }); });
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
        cel.appendChild(el('span', 'ig-nm', 'Pergaminho da Reescrita'));
        tap(cel, function () { toast('A Reescrita é usada no painel de Caminhos Elementais, dentro da ficha do herói.'); });
        grid.appendChild(cel);
      }
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
        plateP.appendChild(art('petIcon', [pid, 54], 54));
        cp.appendChild(plateP);
        if (n > 1) cp.appendChild(el('span', 'ig-n', '×' + n));
        cp.appendChild(el('span', 'ig-nm', esc(pdef ? pdef.name : pid)));
        tap(cp, function () {
          if (!hid) return;
          confirmSheet('Equipar ' + (pdef ? pdef.name : pid) + '?',
            'Deseja equipar este companheiro no herói atual?', function () {
              var ok = safe(function () { return P().equipPet(hid, pid); }, false);
              if (ok) {
                toast('Companheiro equipado.', 'good');
                sheetParty('inventario');
              } else {
                toast('Não foi possível equipar o companheiro.');
              }
            });
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
        ? 'Nenhuma pedra de ' + (ELEM_PT[invElemFiltro] || invElemFiltro) + ' no saco.'
        : invMainTab !== 'equip'
        ? 'Nenhum item desta categoria no momento.'
        : invElemFiltro !== 'todos'
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
        toast(forjaComGuarda ? 'A Âncora de Forja vai junto na próxima batida.' : 'A Âncora fica na prateleira.');
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
    body.appendChild(forjaModos());
    if (quebra) quebraBancada(body, atual, alvos, aceitaDrop);
    else bancadaDeForjar();

    // ===== A BANCADA (de forjar)
    function bancadaDeForjar() {
      var banca = el('div', 'forge-banca2' + (atual ? ' ' + tierClass(lv2) : ''));

      var sPeca = el('div', 'fg-slot fg-slot-peca' + (atual ? ' has' : ''));
      if (atual) {
        sPeca.appendChild(art('itemIcon', [atual.itemId, 56], 56));
        sPeca.appendChild(el('b', null, esc((it2 && it2.name) || atual.itemId) + (lv2 ? ' +' + lv2 : '')));
        sPeca.appendChild(el('span', null, (atual.stars ? '★' + atual.stars + ' · ' : '') +
          esc(tierOf(lv2)) + (atual.kind === 'worn'
            ? ' · vestida por ' + esc(className((hero(atual.heroId) || {}).classId || atual.heroId))
            : ' · no saco' + (atual.count > 1 ? ' ×' + atual.count : ''))));
        tap(sPeca, function () { forgeTarget = null; sheetParty('forja'); });
        tipOn(sPeca, 'A peça na bancada', 'Toque para tirar da bancada. Arraste outra da grade para trocar.', '#e8c25a');
      } else {
        sPeca.appendChild(el('span', 'fg-slot-ic', '⤓'));
        sPeca.appendChild(el('b', null, 'A peça'));
        sPeca.appendChild(el('span', null, 'arraste da grade — ou toque numa'));
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
          ? '<b>' + temN + ' / ' + info.custo + '</b> para esta batida'
          : temN + ' na prateleira'));
        tap(sPedra, function () { forjaPedra = null; sheetParty('forja'); });
        tipOn(sPedra, 'A pedra na bancada', 'Toque para devolver à prateleira.', '#e8c25a');
      } else {
        sPedra.appendChild(el('span', 'fg-slot-ic', '◈'));
        sPedra.appendChild(el('b', null, 'A pedra'));
        sPedra.appendChild(el('span', null, sdCerta
          ? 'esta peça pede <b>' + esc(sdCerta.name) + '</b>'
          : 'toque ou arraste da prateleira'));
      }
      aceitaDrop(sPedra, 'pedra', function (d) { escolhePedra(d.id); });
      banca.appendChild(sPedra);

      var seta = el('span', 'fg-op fg-seta', '→');
      banca.appendChild(seta);

      var sRes = el('div', 'fg-slot fg-slot-res' + (atual && info && !info.maxed ? ' has' : ''));
      if (atual && info && !info.maxed) {
        sRes.appendChild(art('itemIcon', [atual.itemId, 56], 56));
        sRes.appendChild(el('b', null, '+' + (lv2 + 1) + ' ' + esc(tierOf(lv2 + 1))));
        sRes.appendChild(el('span', null, bonusPreview(it2, lv2 + 1, atual.stars)));
      } else if (atual && info && info.maxed) {
        sRes.appendChild(el('span', 'fg-slot-ic', '✦'));
        sRes.appendChild(el('b', null, 'No máximo'));
        sRes.appendChild(el('span', null, 'Magnífico +' + maxLv));
      } else {
        sRes.appendChild(el('span', 'fg-slot-ic', '?'));
        sRes.appendChild(el('b', null, 'O resultado'));
        sRes.appendChild(el('span', null, 'aparece aqui'));
      }
      banca.appendChild(sRes);
      body.appendChild(banca);

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
        estado.appendChild(el('p', 'inv-dica', 'Ponha uma peça na bancada: arraste da grade abaixo ou toque nela.'));
      } else if (!info) {
        estado.appendChild(el('p', 'empty', 'A forja ainda não está disponível.'));
      } else if (info.maxed) {
        estado.appendChild(el('p', 'forge-max', 'No máximo: <b>Magnífico +' + maxLv + '</b>. Esta peça não sobe mais.'));
      } else if (!forjaPedra) {
        estado.appendChild(el('p', 'inv-dica', 'Agora a pedra: esta peça pede <b>' + esc((sdCerta || {}).name || pedraCerta) +
          '</b>' + (sdCerta ? ' (' + esc(ELEM_PT[sdCerta.element] || sdCerta.element) + ')' : '') +
          ' — está acesa na prateleira. Você tem <b>' + stoneCount(pedraCerta) + '</b>, a batida leva <b>' + info.custo + '</b>.'));
      } else if (errada) {
        var sdX = defs[forjaPedra] || {};
        estado.appendChild(el('p', 'forge-short', 'Pedra errada: <b>' + esc(sdX.name || forjaPedra) + '</b> é de ' +
          esc(ELEM_PT[sdX.element] || sdX.element || '?') + '; esta peça pede <b>' + esc((sdCerta || {}).name || pedraCerta) + '</b>.'));
      } else if (!info.temPedras) {
        estado.appendChild(el('p', 'forge-short', 'Faltam <b>' + (info.custo - stoneCount(pedraCerta)) + '</b> de <b>' +
          esc((sdCerta || {}).name || pedraCerta) + '</b>. Monstros de ' +
          esc(ELEM_PT[(sdCerta || {}).element] || '') + ' derrubam.'));
      } else {
        pronto = true;
        usarG = !!(info.arriscado && forjaComGuarda && info.guardas > 0);
        if (info.arriscado) {
          var pct = Math.round(info.chance * 100);
          estado.appendChild(el('p', 'forge-risco', 'Batida arriscada: <b>' + pct + '%</b> de subir — falhou, ' +
            (usarG ? 'a <b>Âncora segura</b> em +' + lv2 + '.' : 'a peça <b>volta para +' + Math.max(0, lv2 - 1) + '</b>.') +
            (info.guardas > 0 ? (usarG ? ' <i>(Âncora junto — toque nela para tirar)</i>' : ' <i>Toque na Âncora da prateleira para levá-la junto (' + info.guardas + ' no saco).</i>')
                              : ' <i>Sem Âncora no saco — só os chefes mais fundos derrubam.</i>')));
        } else {
          estado.appendChild(el('p', 'inv-dica', 'Batida segura: <b>' + stoneCount(pedraCerta) + '</b> ' +
            esc((sdCerta || {}).name || pedraCerta) + ' na prateleira, a batida leva <b>' + info.custo + '</b>.'));
        }
      }
      body.appendChild(estado);
      if (atual && info && !info.maxed) {
        var go = btn('🔨 Bater o martelo — vira +' + (lv2 + 1), 'btn-primary btn-block' + (pronto ? '' : ' is-off'), function () {
          if (!pronto) { toast(!forjaPedra ? 'Escolha a pedra primeiro.' : (errada ? 'Essa não é a pedra desta peça.' : 'Pedras insuficientes.')); return; }
          // 13/09 (a segurança): com sessão do site a batida é sorteada NO SERVIDOR
          var AutF = JOGO.Autoridade;
          if (AutF && AutF.ligada && AutF.ligada()) {
            var opF = atual.kind === 'worn'
              ? AutF.opAgora('forjarVestida', { heroId: atual.heroId, slot: slotRaw(atual.slot), usarGuarda: !!usarG })
              : AutF.opAgora('forjarPeca', { invIndex: atual.index, usarGuarda: !!usarG });
            opF.then(function (res) {
              if (!res.ok) { toast(res.erro || 'O servidor não forjou agora.'); return; }
              mostraForja(res.resultado);
            });
            return;
          }
          mostraForja(forjar(atual, usarG));
          function mostraForja(fim) {
          if (fim) {
            var nivelNovo = (typeof fim === 'object') ? fim.nivel : lv2 + 1;
            var como = (typeof fim === 'object') ? fim.resultado : 'subiu';
            if (como === 'subiu') toast('Forjado: +' + nivelNovo + ' ' + tierOf(nivelNovo) + '!', 'good');
            else if (como === 'segurou') toast('A batida falhou — a Âncora segurou em +' + nivelNovo + '.', 'good');
            else toast('A batida falhou: a peça voltou para +' + nivelNovo + '.');
            forgeTarget = { kind: atual.kind, itemId: atual.itemId, level: nivelNovo, stars: atual.stars,
                            heroId: atual.heroId, slot: atual.slot };
            if (invSel && invSel.itemId === atual.itemId && invSel.level === lv2 &&
                invSel.stars === atual.stars && atual.kind === 'bag') {
              invSel = { itemId: atual.itemId, level: nivelNovo, stars: atual.stars };
            }
            sheetParty('forja');
          } else toast('Pedras insuficientes.');
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
    body.appendChild(el('h4', 'fg-grupo', 'A prateleira de pedras'));
    var stock = el('div', 'forge-stock');
    for (k in defs) {
      if (!defs.hasOwnProperty(k)) continue;
      var n = stoneCount(k);
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
          ? '<br><i>Não sai de quebra nenhuma: é a guarda da forja.</i>'
          : '<br><i>Vem da quebra das peças de ' + esc(ELEM_PT[defs[k].element] || defs[k].element) + '.</i>'),
          elemColor(defs[k].element));
        stock.appendChild(chip);
        continue;
      }
      chip.appendChild(el('span', 'stone-nm', esc(defs[k].name) + (k === anchorId ? (forjaComGuarda ? ' · vai junto' : ' · opcional') : '')));
      tipOn(chip, defs[k].name, esc(defs[k].description || '') +
        (k === anchorId ? '<br><i>Toque para levar junto na batida arriscada.</i>' : '<br><i>Toque ou arraste para a bancada.</i>'),
        elemColor(defs[k].element));
      if (n) { arrastavel(chip, { tipo: 'pedra', id: k }); }
      (function (id2) { tap(chip, function () { escolhePedra(id2); }); })(k);
      stock.appendChild(chip);
    }
    body.appendChild(stock);

    if (!alvos.length) {
      body.appendChild(el('p', 'empty', quebra ? 'Nenhuma peça no saco para quebrar.'
                                               : 'Nenhuma peça para forjar — nem no saco, nem vestida.'));
      return;
    }

    // ===== A GRADE: as peças, arrastáveis para a bancada (toque também põe)
    function celDe(alvo, idx) {
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
      var nvF = nvBadge(alvo.itemId);
      if (nvF) c.appendChild(nvF);
      if (alvo.kind === 'worn') {
        c.appendChild(el('span', 'fg-worn',
          esc(className((hero(alvo.heroId) || {}).classId || alvo.heroId).slice(0, 3))));
      }
      c.appendChild(el('span', 'ig-nm', esc(it.name)));
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
      arrastavel(c, { tipo: 'peca', idx: idx });
      tap(c, function () {
        if (!mesmoAlvo(alvo, forgeTarget)) forjaQuebraN = 1;
        forgeTarget = alvo;
        sheetParty('forja');
      });
      return c;
    }
    // 22/09: espaço E elemento, redondos — valem para o saco e para as vestidas.
    // O `idx` de cada célula é a posição em `alvos` (a lista INTEIRA): o filtro
    // só esconde, e o arrasto até a bancada continua achando a peça certa.
    body.appendChild(filtrosDeItem(forjaSlotFiltro, function (s) {
      forjaSlotFiltro = s;
      sheetParty('forja');
    }, forjaElemFiltro, function (e2) {
      forjaElemFiltro = e2;
      sheetParty('forja');
    }));
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
    var paraQue = quebra ? 'para quebrar' : 'para forjar';
    if (!doSaco.length && !vestidas.length) {
      var oQue = [];
      if (forjaSlotFiltro !== 'todos') oQue.push(SLOT_PT[forjaSlotFiltro] || forjaSlotFiltro);
      if (forjaElemFiltro !== 'todos') oQue.push(ELEM_PT[forjaElemFiltro] || forjaElemFiltro);
      body.appendChild(el('p', 'inv-dica', oQue.length
        ? 'Nada de ' + esc(oQue.join(' de ')) + ' ' + paraQue + ' — o filtro está ligado.'
        : 'Nenhuma peça no saco ' + paraQue + '.'));
    }
    [[doSaco, 'No saco'], [vestidas, 'Vestidas']].forEach(function (par) {
      if (!par[0].length) return;
      body.appendChild(el('h4', 'fg-grupo', par[1] + ' (' + par[0].length + ')'));
      var grade = el('div', 'forge-pick' + (quebra ? ' fg-pick-quebra' : ''));
      par[0].forEach(function (pa) { grade.appendChild(celDe(pa[0], pa[1])); });
      body.appendChild(grade);
    });
    if (vestidasFora) {
      body.appendChild(el('p', 'inv-dica fg-vestidas-fora', vestidasFora === 1
        ? '1 peça vestida não aparece aqui: tire do herói para quebrar.'
        : vestidasFora + ' peças vestidas não aparecem aqui: tire do herói para quebrar.'));
    }

    // ===== A ESTRELA (fundir 3 cópias) — a outra trilha, só com peça na bancada
    // (e só no Forjar: no Quebrar a peça vai embora, não sobe)
    if (!atual || quebra) return;
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
    { id: 'forjar', ico: 'fg-forjar', rot: 'Forjar', tit: 'Forjar a peça',
      sub: 'a pedra do elemento e o martelo: a peça sobe um degrau' },
    { id: 'quebrar', ico: 'fg-quebrar', rot: 'Quebrar', tit: 'Quebrar a peça em pedras',
      sub: 'a peça some e vira pedras do elemento dela' }
  ];
  var MOTIVO_QUEBRA = {
    mestre: 'Peça do Mestre não se quebra.',
    'sem-pedra': 'O elemento desta peça não tem pedra: ela não se quebra.',
    copias: 'Não há tantas cópias iguais no saco.',
    n: 'Quantidade de cópias inválida.',
    emprestada: 'Peça emprestada do banco da guilda: devolva antes de quebrar.'
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
    var m = FORJA_MODOS[forjaModo === 'quebrar' ? 1 : 0];
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
      txt += ' × Nv. ' + q.nivelUso + ' (×' + p.degrau + ')';
      if (p.degrau > 1) multiplicou = true;
    }
    if (q.stars > 0) {
      txt += ' × ★' + q.stars + ' (×' + p.estrelas + ')';
      multiplicou = true;
    }
    var sub = Math.floor(p.base * p.degrau * p.estrelas);
    if (multiplicou) txt += ' = <b>' + sub + '</b>';
    if (q.level > 0) txt += ' · forja +' + q.level + ' devolve <b>' + p.forja + '</b>';
    if (q.pedras > sub + p.forja) txt += ' · o piso é ' + q.pedras;
    txt += ' → <b class="fg-conta-fim">' + q.pedras + ' ' + esc(nomePedra) + '</b>';
    if (q.n > 1) txt += ' × ' + q.n + ' cópias = <b class="fg-conta-fim">' + q.total + '</b>';
    return txt;
  }

  // a recusa do servidor em português — a 'emprestada' vem do juiz (a cópia
  // que a guilda emprestou não sai do saco), o resto como o martelo faz
  function recusaQuebraTxt(res) {
    var erro = (res && res.erro) || '';
    if ((res && res.motivo === 'emprestada') || /emprestad/i.test(erro)) return MOTIVO_QUEBRA.emprestada;
    if (res && res.foraDoAr) return 'O servidor não respondeu — nada foi quebrado.';
    if (res && res.motivo && MOTIVO_QUEBRA[res.motivo]) return MOTIVO_QUEBRA[res.motivo];
    return erro || 'O servidor não quebrou agora.';
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
          ? ' · vestida por ' + esc(className((hero(atual.heroId) || {}).classId || atual.heroId))
          : ' · no saco' + (atual.count > 1 ? ' ×' + atual.count : ''))));
      tap(sPeca, function () { forgeTarget = null; forjaQuebraN = 1; sheetParty('forja'); });
      tipOn(sPeca, 'A peça na bancada', 'Toque para tirar da bancada. Arraste outra da grade para trocar.', '#e8c25a');
    } else {
      sPeca.appendChild(el('span', 'fg-slot-ic', '⤓'));
      sPeca.appendChild(el('b', null, 'A peça'));
      sPeca.appendChild(el('span', null, 'arraste da grade — ou toque numa'));
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
      sPedras.appendChild(el('span', null, esc(nomePedra) + (vestida ? ' · se estivesse no saco' : '')));
    } else if (atual && q) {
      sPedras.appendChild(el('span', 'fg-slot-ic', '✕'));
      sPedras.appendChild(el('b', null, 'Não quebra'));
      sPedras.appendChild(el('span', null, q.motivo === 'mestre' ? 'peça do Mestre' : 'o elemento não tem pedra'));
    } else {
      sPedras.appendChild(el('span', 'fg-slot-ic', '◈'));
      sPedras.appendChild(el('b', null, 'As pedras'));
      sPedras.appendChild(el('span', null, 'aparecem aqui'));
    }
    banca.appendChild(sPedras);
    body.appendChild(banca);

    // ===== O ESTADO: a conta por partes, ou o porquê de não quebrar
    var estado = el('div', 'fg-estado');
    if (!atual) {
      estado.appendChild(el('p', 'inv-dica', 'Ponha uma peça na bancada: arraste da grade abaixo ou toque nela. ' +
        'Quanto mais rara, alta, estrelada e forjada, mais pedras ela vira.'));
    } else if (!q) {
      estado.appendChild(el('p', 'empty', 'A quebra ainda não está disponível.'));
    } else if (nunca) {
      estado.appendChild(el('p', 'forge-short fg-quebra-nao', esc(MOTIVO_QUEBRA[q.motivo])));
    } else if (vestida) {
      estado.appendChild(el('p', 'forge-short fg-quebra-nao', '<b>Vestida</b> — tire do herói para quebrar. ' +
        'No saco ela daria <b>' + q.pedras + ' ' + esc(nomePedra) + '</b>.'));
    } else if (!q.pode) {
      estado.appendChild(el('p', 'forge-short fg-quebra-nao', esc(MOTIVO_QUEBRA[q.motivo] || 'Esta peça não se quebra.')));
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
      qtd.appendChild(el('span', 'fg-qtd-rot', 'Quantas cópias iguais:'));
      [[1, '1'], ['todas', 'todas (×' + todas + ')']].forEach(function (op) {
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
    var go = btn(icoQ + (forjaQuebrando ? 'Quebrando…' : 'Quebrar — vira ' + q.total + ' ' + esc(nomePedra)),
      'btn-warn btn-block fg-quebrar-go' + (forjaQuebrando ? ' is-off' : ''), pergunta);
    body.appendChild(go);

    function pergunta() {
      var qual = '<b>' + esc((it && it.name) || atual.itemId) + (lv ? ' +' + lv : '') +
                 (atual.stars ? ' ★' + atual.stars : '') + '</b>';
      var viram = '<b>' + q.total + ' ' + esc(nomePedra) + '</b>';
      confirmSheet(n > 1 ? 'Quebrar ' + n + ' cópias?' : 'Quebrar a peça?',
        (n > 1 ? 'As <b>' + n + ' cópias</b> de ' + qual + ' somem <b>para sempre</b> e viram ' + viram + '.'
               : qual + ' some <b>para sempre</b> e vira ' + viram + '.') + ' Não tem volta.',
        golpe, { sim: 'Quebrar', simCls: 'btn-warn', aoCancelar: function () { sheetParty('forja'); } });
    }
    // a forja só se redesenha se ainda for a ficha aberta: a resposta do
    // servidor pode chegar com o jogador já em outra
    function refaz() { if (sheetName === 'party' && partyTab === 'forja') sheetParty('forja'); }
    function avisa(fim) {
      if (!fim) { toast('A peça não se quebrou.'); return; }
      var nomeF = (defs[fim.stoneId] || {}).name || nomePedra;
      toast('+' + (fim.pedras || q.total) + ' ' + nomeF +
            (fim.n > 1 ? ' — as ' + fim.n + ' peças viraram pedra.' : ' — a peça virou pedra.'), 'good');
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
          else if (!res.resultado) toast('O servidor não quebrou: o saco mudou. Confira a bancada.');
          else avisa(res.resultado);
          refaz();
        }, function () {
          forjaQuebrando = false;
          toast('O servidor não respondeu — nada foi quebrado.');
          refaz();
        });
        return;
      }
      avisa(safe(function () { return P().quebraPeca(idx, nAgora, { iid: serie }); }, false));
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
          ({ hp: 'PV', power: 'poder', initiative: 'inic.', dodge: 'esquiva', lock: 'fixação' }[k] || k));
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
    sem: 'Nenhum Pergaminho da Reescrita guardado.',
    descida: 'A Reescrita só se usa fora de descida, no Acampamento.',
    neutro: 'O herói ainda não tem caminho: a primeira escolha, no nível 5, é de graça.',
    nivel: 'Só a partir do nível 5.',
    classe: 'Esta classe não tem caminhos para reescrever.',
    elemento: 'Elemento inválido.',
    caminho: 'A classe não tem esse caminho.',
    'ja-tem': 'O herói já tem esse caminho.',
    velho: 'Esse caminho não está liberado.',
    heroi: 'Herói desconhecido.'
  };
  // `refaz` (12/09): a ficha de onde veio — a de Feitiços ou a do herói
  function escolheReescrita(heroId, novo, refaz) {
    refaz = refaz || function () { openSheet('heroSheet', heroId); };
    var lista = safe(function () { return P().heroElements(heroId); }, []);
    var h = hero(heroId) || {};
    if (lista.length <= 1) { confirmaReescrita(heroId, lista[0] || h.element, novo, refaz); return; }
    var nn = esc(ELEM_PT[novo] || novo);
    var b = sheetShell('Qual caminho sai?', 'Pergaminho da Reescrita — o de ' + nn + ' entra no lugar dele');
    sheetName = 'confirm';
    b.appendChild(el('p', 'confirm-txt', 'O herói tem ' + lista.length + ' caminhos liberados. ' +
      'Escolha qual deles dá a vaga ao de <b>' + nn + '</b>.'));
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
    acts.appendChild(btn('Voltar', 'btn-ghost', function () { refaz(); }));
    b.appendChild(acts);
  }
  function confirmaReescrita(heroId, velho, novo, refaz) {
    refaz = refaz || function () { openSheet('heroSheet', heroId); };
    var pode = safe(function () { return P().podeReescrever(heroId, velho, novo); }, null);
    if (!pode || !pode.ok) {
      toast((pode && MOTIVO_REESCRITA[pode.motivo]) || 'Não dá para reescrever agora.');
      return;
    }
    var h = hero(heroId) || {};
    var eraAtivo = h.element === velho;
    var tem = safe(function () { return P().pergaminhos().elemento; }, 1);
    var nv = esc(ELEM_PT[velho] || velho), nn = esc(ELEM_PT[novo] || novo);
    confirmSheet('Reescrever ' + (ELEM_PT[velho] || velho) + ' → ' + (ELEM_PT[novo] || novo) + '?',
      'Sai o caminho de <b>' + nv + '</b> e entra o de <b>' + nn + '</b>, no mesmo lugar' +
      (eraAtivo ? ' — e ele passa a ser o <b>ativo</b>: os feitiços do caminho trocam na hora'
                : ' (o caminho ativo continua o mesmo)') + '. ' +
      'Ficam: nível, XP, o dano elemental dos níveis, itens, bicho e estrelas. ' +
      'Gasta 1 Pergaminho da Reescrita (restam ' + Math.max(0, tem - 1) + '). Para desfazer, só outro pergaminho.',
      function () {
        if (safe(function () { return P().reescreveElemento(heroId, velho, novo); }, false)) {
          toast('Caminho reescrito: ' + (ELEM_PT[novo] || novo) + ' no lugar de ' + (ELEM_PT[velho] || velho) + '.', 'good');
          refaz();
        } else toast('Não deu para reescrever.');
      });
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

    // ---- os caminhos elementais: o mesmo painel da ficha de Feitiços (12/09)
    body.appendChild(el('h3', 'hs-sec', 'Caminhos elementais'));
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
        caixa.appendChild(el('p', 'hs-hint', 'No nível ' + lvEscolha + ' você escolhe o primeiro caminho aqui ' +
          'mesmo, de graça. Até lá os quatro galhos seguem abertos para você comparar.'));
        return caixa;
      }
      caixa.classList.add('is-escolha');
      caixa.appendChild(el('p', 'caminhos-tx', '<b>Escolha o caminho elemental.</b> ' +
        esc(className(cid)) + ' já chegou ao nível ' + lvEscolha + ': compare os galhos e toque no elemento. ' +
        'O primeiro é de graça; depois, só o Pergaminho da Reescrita troca.'));
      var fila0 = el('div', 'guilda-emblemas');
      elemsC.forEach(function (e) {
        var nome = ELEM_PT[e] || e;
        var b0 = btn('Seguir ' + nome, 'btn-mini btn-primary', function () {
          confirmSheet('Seguir o caminho de ' + nome + '?',
            'É <b>permanente</b> — só o Pergaminho da Reescrita troca depois. A partir daqui, cada nível dá ' +
            '+5 PV e +3 de dano de ' + nome + ', e os feitiços do galho vão abrindo com o nível.',
            function () {
              var ok = safe(function () { return G().chooseElement(heroId, e); }, false);
              if (!ok) ok = safe(function () { return P().chooseElement(heroId, e); }, false);
              if (ok) toast('Caminho de ' + nome + ' escolhido — os feitiços do galho já estão na mão.', 'good');
              else toast('Não deu para escolher agora.');
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
                toast('O caminho de ' + (ELEM_PT[e3] || e3) + ' assumiu — feitiços trocados.', 'good');
                refaz();
              }
              return;
            }
            if (!podeAbrir) {
              if (reescreve) { escolheReescrita(heroId, e3, refaz); return; }
              var alvoEstrela = { 2: 3, 3: 4, 4: 5 }[liberados.length + 1] || 3;
              toast('A ★' + alvoEstrela + ' da classe libera a próxima vaga — junte cartas.');
              return;
            }
            confirmSheet('Liberar o caminho de ' + (ELEM_PT[e3] || e3) + '?',
              'A escolha é permanente — a vaga veio das estrelas da classe.', function () {
                if (safe(function () { return P().liberaElemento(heroId, e3); }, false)) {
                  toast('Caminho de ' + (ELEM_PT[e3] || e3) + ' liberado!', 'good');
                  refaz();
                } else toast('não deu');
              });
          });
        b3.style.setProperty('--ec', elemColor(e3));
        filaEl.appendChild(b3);
      });
      caixa.appendChild(filaEl);
      caixa.appendChild(el('p', 'inv-dica',
        'Vagas de caminho: <b>' + liberados.length + ' / ' + vagas + '</b> — ' +
        '★3 abre a 2ª, ★4 a 3ª, ★5 a 4ª. Trocar o ativo troca os feitiços do caminho.' +
        ((pgRees > 0 && classeReescreve)
          ? (comReescrita
            ? ' <b>Pergaminho da Reescrita ×' + pgRees + '</b>: toque num caminho que ele não tem para trocar um dos seus por ele.'
            : ' O Pergaminho da Reescrita (×' + pgRees + ') se usa no Acampamento.')
          : '')));
    }
    return caixa;
  }

  // o resto da ficha do herói: equipamento, feitiços e o que ainda vem
  function corpoDoHeroi(body, heroId, h, cid) {
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
      // o "Nv." em linha própria: colado ao nome, as reticências o comiam
      var nvH = it ? nvBadge(itemId) : null;
      if (nvH) cell.appendChild(nvH);
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
    var nvBicho = safe(function () { return D().nivelUso.pet; }, 0) || 0;
    var body = sheetShell('Chamar um bicho', 'Um bicho serve a um herói por vez.' +
      (nvBicho ? ' Pets a partir do nível ' + nvBicho + '.' : ''));
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
          toast(rP ? textoRecusa(rP) : 'Não deu para chamar esse bicho.');
          return;
        }
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
  /* AS CONFIGURAÇÕES (02/10, a frente dos menus). O dono pediu "Configurações"
   * entre os menus a melhorar, e ela NÃO EXISTIA: o som só se desligava no
   * botãozinho 🔊 da batalha (sem volume), a tela cheia só no canto, e os
   * atalhos de teclado não estavam escritos em lugar nenhum. Esta ficha junta
   * o que é do APARELHO — nada daqui é progresso nem vai para a conta: o som
   * mora no js/audio.js (chave própria), o movimento numa chave soterra-* que
   * o save_sandbox das provas já blinda. */
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
    var body = sheetShell('Configurações',
      'O que vale para este aparelho: o som, a tela e o movimento da interface. Nada daqui mexe no seu progresso.');
    sheetName = 'config';
    var Au = JOGO.Audio;

    var som = el('section', 'cfg-sec');
    som.appendChild(el('h3', 'bk-tit', 'Som'));
    if (Au && Au.isMudo) {
      var volume = document.createElement('input');
      var lnVol = null;
      som.appendChild(linhaConfig('Som do jogo', 'Golpes, passos e a interface.',
        chaveConfig(!Au.isMudo(), 'Som do jogo', function (on) {
          Au.setMudo(!on);
          pintaBotaoSom();
          volume.disabled = !on;
          if (lnVol) lnVol.classList.toggle('is-apagado', !on);
        })));
      volume.type = 'range';
      volume.min = '0'; volume.max = '100'; volume.step = '5';
      volume.className = 'cfg-volume';
      volume.value = String(Math.round((Au.getVolume ? Au.getVolume() : 0.7) * 100));
      volume.setAttribute('aria-label', 'Volume');
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
      lnVol = linhaConfig('Volume', null, vol);
      if (Au.isMudo()) lnVol.classList.add('is-apagado');
      som.appendChild(lnVol);
    } else som.appendChild(el('p', 'empty', 'O som não carregou neste aparelho.'));
    body.appendChild(som);

    var tela = el('section', 'cfg-sec');
    tela.appendChild(el('h3', 'bk-tit', 'Tela'));
    var TC = JOGO.TelaCheia;
    if (TC && TC.suporta && TC.suporta()) {
      /* 03/10 (revisão): a chave segue a tela, não o toque. Ela virava na hora
       * e ficava "ligada" quando o navegador recusava (quadro sem permissão)
       * e também depois do Esc, que sai da tela cheia sem passar por aqui — e o
       * toque seguinte fazia o contrário do que a chave mostrava. */
      chaveTelaViva = chaveConfig(TC.cheia(), 'Tela cheia', function (on) {
        var p = on ? TC.entra() : TC.sai();
        if (p && typeof p.then === 'function') p.then(sincChaveTela, sincChaveTela);
      });
      tela.appendChild(linhaConfig('Tela cheia', 'Some a barra do navegador. Esc sai.', chaveTelaViva));
      if (!ouveTela) {
        ouveTela = true;
        document.addEventListener('fullscreenchange', sincChaveTela);
        document.addEventListener('webkitfullscreenchange', sincChaveTela);
      }
    }
    tela.appendChild(linhaConfig('Menos movimento', 'As fichas abrem sem deslizar e os botões não afundam.',
      chaveConfig(!!prefUi().menosMovimento, 'Menos movimento', function (on) {
        var p = prefUi(); p.menosMovimento = on; gravaPrefUi(p);
      })));
    body.appendChild(tela);

    // os atalhos só fazem sentido com teclado — no aparelho de toque a seção não aparece
    var toque = safe(function () { return !!(JOGO.Mobile && JOGO.Mobile.toque && JOGO.Mobile.toque()); }, false);
    if (!toque) {
      var at = el('section', 'cfg-sec');
      at.appendChild(el('h3', 'bk-tit', 'Atalhos de teclado'));
      var lista = el('dl', 'cfg-atalhos');
      [['I', 'abre e fecha o inventário'], ['Esc', 'fecha a ficha aberta'],
       ['Tab', 'anda pelos botões da ficha; Enter ou Espaço aperta']]
        .concat(mestreAtivo() ? [['M', 'abre e fecha o Painel do Mestre (a Caixa, os jogadores, os eventos, o grimório…)'],
                                 ['F9', 'o mesmo painel, de qualquer tela (também Ctrl+Alt+M)']] : [])
        .forEach(function (a) {
          lista.appendChild(el('dt', null, '<kbd class="tecla">' + a[0] + '</kbd>'));
          lista.appendChild(el('dd', null, a[1]));
        });
      at.appendChild(lista);
      body.appendChild(at);
    }

    var conta = el('section', 'cfg-sec');
    conta.appendChild(el('h3', 'bk-tit', 'Conta'));
    conta.appendChild(btn('Contas e nuvem', 'btn-ghost btn-block', function () { openSheet('contas'); }));
    body.appendChild(conta);
    var ver = safe(function () { return window.SOTERRA_VERSAO.versao; }, null);
    body.appendChild(el('p', 'cfg-versao', 'SOTERRA — Ecos do Mundo Enterrado' + (ver ? ' · versão ' + esc(ver) : '')));
  }

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
    // A NUVEM (10/09): o save no cartório do servidor — logado pelo site, o
    // jogo puxa ao abrir e sobe a cada gravação; aqui só o estado e as portas.
    var Sx = JOGO.Sessao, Nx = JOGO.Nuvem;
    if (Sx && Nx) {
      var estN = safe(function () { return Nx.estado(); }, null) || {};
      var caixaN = el('div', 'nuvem-caixa');
      caixaN.appendChild(el('h3', 'nuvem-titulo', '☁ Nuvem'));
      if (estN.sessao && estN.principal === false) {
        caixaN.appendChild(el('p', 'contas-nota',
          'A Nuvem vale só na conta <b>Principal</b> desta máquina. Esta conta é local: ' +
          'o save dela fica só aqui (serve para testar dois jogadores no mesmo PC).'));
      } else if (estN.sessao && estN.conta) {
        var txtN = 'Logado como <b>' + esc(estN.conta.nome || '?') + '</b> · save versão ' + (estN.versao || 0);
        if (estN.conta.gm === true) txtN += ' <span class="chip chip-ok">Mestre do Fundo</span>';
        if (estN.erro) txtN += '<br><span class="chip chip-diff">' + esc(estN.erro) + '</span>';
        else if (estN.pendente || estN.subindo) txtN += ' · <span class="chip">subindo…</span>';
        else if (estN.ultimaSubida) txtN += ' · <span class="chip chip-ok">em dia</span>';
        caixaN.appendChild(el('p', 'contas-nota', txtN));
        var linhaN = el('div', 'nuvem-botoes');
        linhaN.appendChild(btn(estN.parada ? 'Tentar de novo' : 'Sincronizar agora', 'btn-primary', function () {
          var pN = estN.parada ? Nx.retomar() : Nx.iniciar();
          pN.then(function () { if (sheetName === 'contas') sheetContas(); });
        }));
        linhaN.appendChild(btn('Sair da nuvem', '', function () {
          confirmSheet('Sair da nuvem?',
            'O save desta máquina fica como está, e o do servidor também. Para voltar, entre de novo pelo site.',
            function () { Nx.sair().then(function () { sheetContas(); }); });
        }));
        caixaN.appendChild(linhaN);
        // 02/10: os direitos do titular (servidor/privacidade.py): os documentos, baixar os dados, excluir
        caixaN.appendChild(linksLegais());
        var linhaP = el('div', 'nuvem-botoes');
        linhaP.appendChild(btn('Baixar meus dados', '', baixaMeusDados));
        linhaP.appendChild(btn('Excluir conta…', 'btn-warn', function () { sheetExcluirConta(estN.conta); }));
        caixaN.appendChild(linhaP);
      } else {
        caixaN.appendChild(el('p', 'contas-nota',
          'Sem conta no servidor: o save vive só nesta máquina. Crie a conta ou entre pelo site — ' +
          'o jogo passa a guardar o save lá e abre o mesmo em qualquer PC.'));
        var aN = el('a', 'btn btn-primary btn-block', 'Entrar ou criar conta');
        aN.href = safe(function () { return Sx.paginaConta(); }, 'site/conta.html');
        aN.target = '_blank';
        aN.rel = 'noopener';
        caixaN.appendChild(aN);
        caixaN.appendChild(linksLegais());
      }
      body.appendChild(caixaN);
    }
    body.appendChild(el('p', 'contas-nota',
      '<b>Dois jogadores na mesma máquina:</b> deixe esta janela numa conta, abra ' +
      'OUTRA janela do mesmo navegador no mesmo endereço e troque lá para outra ' +
      'conta — os dois se veem no Acampamento (fantasma, chat, troca, arena). ' +
      'Atalho: abrir a segunda janela já com <b>?conta=2</b> no fim do endereço.'));
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
    p.appendChild(liga('Termos de Uso', 'paginaTermos', 'site/termos.html'));
    p.appendChild(document.createTextNode(' · '));
    p.appendChild(liga('Política de Privacidade', 'paginaPrivacidade', 'site/privacidade.html'));
    return p;
  }
  function baixaMeusDados() {
    var Sx = JOGO.Sessao;
    if (!Sx || !Sx.meusDados) return;
    toast('juntando os seus dados…');
    Sx.meusDados().then(function (r) {
      if (!r || !r.ok || !r.dados) { toast((r && r.erro) || 'não deu para juntar os dados'); return; }
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
        toast('arquivo dos seus dados baixado');
      } catch (eB) {
        toast('o navegador não deixou salvar o arquivo');
      }
    });
  }
  function sheetExcluirConta(conta) {
    var Sx = JOGO.Sessao, Nx = JOGO.Nuvem;
    var nomeConta = (conta && typeof conta.nome === 'string') ? conta.nome : '';
    var body = sheetShell('Excluir a conta', 'Isto não tem volta.');
    sheetName = 'excluir-conta';
    body.appendChild(el('p', 'contas-nota',
      'O save no servidor, os itens, os personagens, as barras de ouro e os vinténs somem para sempre. ' +
      'Fica só o registro dos pagamentos, sem o seu nome e o seu e-mail. Se lidera uma guilda, a ' +
      'liderança passa ao membro mais antigo. Quer o arrependimento de uma compra? Peça <b>antes</b>.'));
    body.appendChild(el('p', 'contas-nota', 'Para confirmar, digite o nome da conta, <b>' + esc(nomeConta) +
      '</b>, e a senha.'));
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
    var nome = campo('text', 'nome da conta', 'off');
    var senha = campo('password', 'senha', 'current-password');
    var aviso = el('p', 'contas-nota excluir-aviso', '');
    body.appendChild(aviso);
    var ocupado = false;
    var acts = el('div', 'confirm-acts');
    acts.appendChild(btn('Voltar', 'btn-ghost', function () { sheetContas(); }));
    var vai = btn('Excluir para sempre', 'btn-warn', function () {
      if (desligado() || !Sx || !Sx.excluir) return;   // 03/10 (revisão): o apagado não dispara
      ocupado = true;
      confere();
      aviso.textContent = 'excluindo…';
      Sx.excluir(nome.value.trim(), senha.value).then(function (r) {
        ocupado = false;
        senha.value = '';
        if (!r || !r.ok) {
          aviso.textContent = (r && r.erro) || 'não deu para excluir a conta';
          confere();
          return;
        }
        // a sessão já saiu (Sessao.excluir); a Nuvem para de tentar subir o save
        safe(function () { if (Nx && Nx.sair) Nx.sair(); }, null);
        var fim = sheetShell('Conta excluída', 'A conta saiu do servidor.');
        sheetName = 'excluir-conta';
        fim.appendChild(el('p', 'contas-nota',
          'O save desta máquina continua aqui, só neste navegador. Para apagá-lo, limpe os dados do site no navegador.'));
        fim.appendChild(btn('Fechar', 'btn-primary btn-block', function () { sheetContas(); }));
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
    var body = sheetShell(par.nome || 'Jogador',
      par.titulo ? '«' + par.titulo + '»' : 'jogador da praça');
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
      var lnG = el('div', 'perfil-guilda');
      var B0 = BR();
      if (B0 && B0.ehCodigo(r.guilda.emblema)) lnG.appendChild(elShield(r.guilda.emblema, 20));
      lnG.appendChild(el('b', null, esc(txtGuilda(r.guilda.emblema, r.guilda.nome))));
      col.appendChild(lnG);
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
    var CAMPOS = [{ i: 2, nome: 'Fundo' }, { i: 4, nome: 'Símbolo' }, { i: 3, nome: 'Borda' }];
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

    secao('Forma', B.forma(p[1]).nome, B.FORMAS, function (fm) {
      return opcao(p[1] === fm.id, fm.nome, B.canvas(cod({ 1: fm.id }), 34), function () {
        p[1] = fm.id; salva(); pintaBrasaoEditor(box);
      });
    });
    secao('Campo', B.divisao(p[6]).nome, B.DIVISOES, function (dv) {
      // sem símbolo na amostra: o que se escolhe aqui é o corte do campo
      return opcao(p[6] === dv.id, dv.nome, B.canvas(cod({ 5: '-', 6: dv.id }), 34), function () {
        p[6] = dv.id; salva(); pintaBrasaoEditor(box);
      });
    });
    var comVazio = [{ id: '-', nome: 'Sem símbolo' }].concat(B.SIMBOLOS);
    var sbAtual = B.simbolo(p[5]);
    secao('Símbolo', sbAtual ? sbAtual.nome : 'Sem símbolo', comVazio, function (sb) {
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
    var body = sheetShell('Amigos', 'Quem está online e em batalha — e quem você não quer por perto.');
    sheetName = 'amigos';
    var Am = JOGO.Amigos, R = JOGO.Rede;
    if (!Am || !Am.pode()) {
      body.appendChild(el('p', 'empty', 'Entre na sua conta para ter amigos e inimigos.'));
      return;
    }
    // 02/10: as duas listas viram ABAS de verdade (mesma pílula das outras fichas)
    var abas = el('div', 'am-abas abas-fila');
    [['amigos', 'Amigos'], ['inimigos', 'Inimigos']].forEach(function (a) {
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
    inp.placeholder = amigosAba === 'amigos' ? 'nome de quem adicionar' : 'nome do inimigo';
    function adiciona() {
      var n = inp.value.trim();
      if (!n) return;
      Am.definir({ nome: n }, amigosAba === 'amigos' ? 'amigo' : 'inimigo').then(function (r) {
        toast(r.ok ? n + (amigosAba === 'amigos' ? ' entrou nos amigos.' : ' entrou nos inimigos.')
                   : (r.erro || 'não deu'), r.ok ? 'good' : undefined);
        if (r.ok) inp.value = '';
      });
    }
    inp.addEventListener('keydown', function (ev) {
      ev.stopPropagation();                             // a letra não abre atalho
      if (ev.key === 'Enter') adiciona();
    });
    add.appendChild(inp);
    add.appendChild(btn('Adicionar', 'btn-mini btn-gold', adiciona));
    body.appendChild(add);
    body.appendChild(el('p', 'inv-dica', amigosAba === 'amigos'
      ? 'Também dá para adicionar tocando na pessoa na praça. No chat: <b>/Nome mensagem</b> manda particular.'
      : 'Inimigo não manda mensagem particular nem propõe troca a você (nem você a ele) — mas duelo vale.'));

    var caixa = el('div', 'am-lista');
    body.appendChild(caixa);
    function pinta() {
      if (sheetName !== 'amigos' || !caixa.isConnected) return;
      clear(caixa);
      var L = Am.lista();
      var itens = (amigosAba === 'amigos' ? L.amigos : L.inimigos).slice();
      if (!itens.length) {
        caixa.appendChild(el('p', 'empty', amigosAba === 'amigos' ? 'Nenhum amigo ainda.' : 'Nenhum inimigo.'));
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
          !on ? 'offline' : luta ? '⚔ em batalha' : st.sala ? 'num calabouço' : 'na praça'));
        var acts = el('div', 'am-acts');
        if (amigosAba === 'amigos') {
          acts.appendChild(btn('Mensagem', 'btn-mini btn-ghost' + (on && st.id ? '' : ' is-apagado'), function () {
            if (!on || !st.id) { toast(a.nome + ' está offline.'); return; }
            closeSheet();
            armaSussurro(st.id, a.nome);
          }));
        } else {
          acts.appendChild(btn('Desafiar', 'btn-mini btn-ghost' + (on && st.id ? '' : ' is-apagado'), function () {
            if (!on || !st.id) { toast(a.nome + ' está offline.'); return; }
            var r = safe(function () { return Dl().desafiar(st.id); }, null);
            if (r && r.ok) toast('Desafio enviado a ' + a.nome + '. Esperando a resposta…');
            else toast(textoMotivo(r ? r.motivo : 'ocupado', null));
          }));
        }
        // 02/10: denunciar à Equipe direto da lista (js/ui/moderacao.js)
        if (JOGO.Denuncia) acts.appendChild(JOGO.Denuncia.botao({ conta: a.conta, nome: a.nome, onde: 'amigos' }, null, 'btn btn-mini btn-ghost'));
        acts.appendChild(btn('✕', 'btn-mini btn-ghost am-tira', function () {
          Am.definir({ conta: a.conta }, null).then(function (r) {
            toast(r.ok ? a.nome + ' saiu da lista.' : (r.erro || 'não deu'), r.ok ? 'good' : undefined);
          });
        }));
        linha.appendChild(acts);
        caixa.appendChild(linha);
      });
    }
    Am.aoMudar = pinta;
    Am.liga();
    Am.carrega().then(function (r) { if (!r.ok) toast(r.erro || 'não deu'); pinta(); });
    if (amigosTimer) clearInterval(amigosTimer);
    amigosTimer = setInterval(function () {
      if (sheetName !== 'amigos') { clearInterval(amigosTimer); amigosTimer = null; Am.aoMudar = null; return; }
      if (R && R.pedeAmigos) R.pedeAmigos();
    }, 10000);
    pinta();
  }

  function sheetGuilda() {
    var remoto = !!lastSheetArg;
    var body = sheetShell('Guilda', remoto 
      ? 'Lista de membros e informações do clã. O cofre e o banco só abrem na Sede.'
      : 'Cofre que só o líder gasta, bônus para todos, e um banco de empréstimos entre membros.');
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
        // 11/09: a guilda de antes (a do navegador) sobe para o servidor sem pagar de novo
        var antiga = Gd.guildaLocalLiderada ? Gd.guildaLocalLiderada() : null;
        if (antiga) {
          // 13/09: quem era da mesma guilda de antes e chega depois do líder VOLTA para ela
          caixa.appendChild(btn((antiga.existe ? 'Voltar para a ' : 'Trazer a ') + txtGuilda(antiga.emblema, antiga.nome) +
            (antiga.existe ? ' (você já era dela)' : ' para o servidor (sem pagar de novo)'),
            'btn-gold btn-block', function () {
              Gd.migrarLocal().then(function (res) {
                if (!res.ok) { toast(res.erro || 'não deu'); return; }
                resumoGuilda = { nome: res.guilda.nome, emblema: res.guilda.emblema };
                    reanunciaPerfil();          // o clã novo aparece para todos
                if (JOGO.Hub && JOGO.Hub.nomeia) {
                  try { JOGO.Hub.nomeia(undefined, undefined, undefined, resumoGuilda); } catch (e) {}
                }
                toast(res.como === 'voltou'
                  ? 'Você voltou para a ' + txtGuilda(res.guilda.emblema, res.guilda.nome) + '.'
                  : 'A ' + txtGuilda(res.guilda.emblema, res.guilda.nome) + ' agora mora no servidor — quem era dela volta pela ficha da guilda.', 'good');
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
          '<b>' + saldoIns + '/' + precoIns + '</b> insígnias de fundação — ' +
          (podePagar ? 'dá para fundar!' : 'só chefe derruba, uma por queda.'));
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
            toast('A ' + txtGuilda(res.guilda.emblema, res.guilda.nome) + ' existe — e você a lidera.', 'good');
            // a plaquinha da praça ganha a placa da guilda na hora — os
            // undefined preservam nome/título/coroa que já estão pendurados
            resumoGuilda = { nome: res.guilda.nome, emblema: res.guilda.emblema };
                    reanunciaPerfil();          // o clã novo aparece para todos
            if (JOGO.Hub && JOGO.Hub.nomeia) {
              try { JOGO.Hub.nomeia(undefined, undefined, undefined, resumoGuilda); } catch (e) {}
            }
            sheetGuilda();
          });
        }));
      } else {
        // 11/09: quem sou eu na ficha — no servidor, a CONTA (g.eu); em casa, o jogador local
        var euId = (g.eu != null) ? g.eu : contaJ.id;
        // ---- A FICHA
        var cab = el('div', 'guilda-cab');
        var emblemaPlaca = elShield(g.emblema, 48);
        emblemaPlaca.className = 'guilda-emblema';
        cab.appendChild(emblemaPlaca);
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

        /* ---- A MENSAGEM DA GUILDA (13/09, dono: "uma caixa com uma mensagem
         * inicial/orientações para membros"). Todo membro lê; líder e oficiais
         * escrevem (o servidor confere). O editor abre no lugar do texto. */
        var podeEscrever = g.meuCargo === 'lider' || g.meuCargo === 'oficial';
        var muralG = g.mural && g.mural.texto ? g.mural : null;
        var mural = el('div', 'guilda-mural');
        var muralCab = el('div', 'guilda-mural-cab');
        muralCab.appendChild(el('h3', 'bk-tit', 'Mensagem da guilda'));
        mural.appendChild(muralCab);
        var muralCorpo = el('div', 'guilda-mural-corpo');
        mural.appendChild(muralCorpo);
        function pintaMural() {
          clear(muralCorpo);
          muralCorpo.appendChild(el('div', 'guilda-mural-txt' + (muralG ? '' : ' is-vazio'), muralG
            ? esc(muralG.texto)
            : (podeEscrever ? 'Nenhuma mensagem ainda. Escreva as boas-vindas e as regras — todo membro lê aqui.'
                            : 'O líder ainda não deixou orientações.')));
          if (muralG && muralG.autorNome) {
            muralCorpo.appendChild(el('span', 'guilda-mural-autor', '— ' + esc(muralG.autorNome)));
          }
        }
        function editaMural() {
          clear(muralCorpo);
          var ta = document.createElement('textarea');
          ta.className = 'hub-input guilda-mural-edit';
          ta.maxLength = Gd.MURAL_MAX || 500;
          ta.placeholder = 'Boas-vindas, horários, o dízimo combinado, como pedir item emprestado…';
          ta.value = muralG ? muralG.texto : '';
          ta.addEventListener('keydown', function (ev) { ev.stopPropagation(); });   // a letra não abre atalho
          var contaTa = el('span', 'guilda-mural-conta', '');
          function conta() { contaTa.textContent = ta.value.length + '/' + ta.maxLength; }
          ta.addEventListener('input', conta);
          conta();
          var acts = el('div', 'guilda-mural-acts');
          acts.appendChild(contaTa);
          acts.appendChild(btn('Cancelar', 'btn-mini btn-ghost', pintaMural));
          acts.appendChild(btn('Salvar', 'btn-mini btn-gold', function () {
            Gd.definirMural(ta.value).then(function (res) {
              toast(res.ok ? 'Mensagem da guilda salva.' : (res.erro || 'não deu'), res.ok ? 'good' : undefined);
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
        ['#', 'Membro', 'Cargo', 'XP doado', 'Dízimo'].concat(g.souLider ? [''] : []).forEach(function (t, i) {
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
          if (ehEu) cel.appendChild(el('span', 'gg-eu', 'você'));
          cel.title = m.nome;
          linha.appendChild(cel);
          var celC = el('span', 'gg-cargo-col');
          celC.appendChild(el('span', 'gg-cargo' + (ehLider ? ' is-lider' : ehOficial ? ' is-oficial' : ''),
            ehLider ? 'Líder' : ehOficial ? 'Oficial' : 'Membro'));
          linha.appendChild(celC);
          linha.appendChild(el('span', 'gg-xp', Math.floor(m.xpDoado || 0).toLocaleString('pt-BR')));
          var dzM = typeof m.dizimo === 'number' ? Math.floor(m.dizimo) : dizimoPadrao;
          var celD = el('span', 'gg-dz');
          if (g.souLider) {
            var dz = document.createElement('input');
            dz.type = 'number'; dz.min = '0'; dz.max = String(Gd.DIZIMO_MAX || 25); dz.step = '1';
            dz.value = String(dzM);
            dz.className = 'hub-input gg-dz-inp' + (m.dizimoProprio ? ' is-proprio' : '');
            dz.title = m.dizimoProprio ? 'Dízimo próprio de ' + m.nome + ' (vazio volta ao padrão)'
                                       : 'Segue o padrão da guilda (' + dizimoPadrao + '%)';
            dz.setAttribute('aria-label', 'Dízimo de ' + m.nome);
            dz.addEventListener('keydown', function (ev) {
              ev.stopPropagation();                         // a letra não abre atalho
              if (ev.key === 'Enter') dz.blur();
            });
            dz.addEventListener('change', function () {
              var bruto = String(dz.value).trim();
              var novo = bruto === '' ? null : Math.floor(Number(bruto));
              if (novo !== null && !(novo >= 0 && novo <= (Gd.DIZIMO_MAX || 25))) {
                toast('o dízimo vai de 0 a ' + (Gd.DIZIMO_MAX || 25) + '%');
                dz.value = String(dzM);
                return;
              }
              Gd.definirDizimo(novo, m.id).then(function (res) {
                toast(res.ok ? (novo === null ? m.nome + ' volta ao dízimo padrão.'
                                              : 'Dízimo de ' + m.nome + ': ' + novo + '%.')
                             : (res.erro || 'não deu'), res.ok ? 'good' : undefined);
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
                        ? esc(m.nome) + ' agora é oficial — ganhou a chave do cofre.'
                        : esc(m.nome) + ' voltou a membro.')
                    : (res.erro || 'não deu'), res.ok ? 'good' : undefined);
                  sheetGuilda();
                });
              });
              bAcao.title = ehOficial ? 'Rebaixar a membro' : 'Promover a oficial';
              celA.appendChild(bAcao);
            }
            linha.appendChild(celA);
          }
          grade.appendChild(linha);
        });
        rolo.appendChild(grade);
        caixa.appendChild(rolo);
        caixa.appendChild(el('p', 'inv-dica', 'Ordem: cargo, depois o XP que cada um rendeu à guilda (dízimo, guerra e treino).' +
          (g.souLider ? ' Mude o dízimo de cada um direto na grade — campo vazio volta ao padrão.' : '')));

        // A OFERENDA (30/08: vinténs viravam XP da guilda, 2 por 1) morou aqui até 04/10. Dono:
        // "dinheiro não dará mais XP para guild; somente % de XP doada de batalha OU guerra de
        // guild" — o campo e o botão saíram; o servidor recusa a doação que não é o dízimo.
        caixa.appendChild(el('p', 'inv-dica guilda-xp-regra',
          'A guilda sobe pelo <b>dízimo</b> (a parte do XP de cada batalha que o membro doa) e pela <b>guerra de guilda</b>' +
          (Gu() ? ' (+' + Gu().XP + ' XP por vitória)' : '') + '. Vinténs não compram XP.'));

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
          // 13/09: o PADRÃO (quem não tem dízimo próprio) e o "aplicar a todos"
          var dzInp = document.createElement('input');
          dzInp.type = 'number'; dzInp.min = '0'; dzInp.max = String(Gd.DIZIMO_MAX || 25);
          dzInp.value = String(g.dizimo || 0);
          dzInp.className = 'hub-input';
          dzInp.style.cssText = 'width:70px;margin:0';
          dzInp.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
          gov.appendChild(el('span', 'inv-dica', 'dízimo padrão:'));
          gov.appendChild(dzInp);
          function mandaPadrao(todos) {
            Gd.definirDizimo(Math.floor(Number(dzInp.value) || 0), null, { todos: todos }).then(function (res) {
              toast(res.ok ? (todos ? 'Todos os membros doam ' + res.dizimo + '% do XP.'
                                    : 'Dízimo padrão em ' + res.dizimo + '% — quem tem um próprio segue com o dele.')
                           : (res.erro || 'não deu'), res.ok ? 'good' : undefined);
              sheetGuilda();
            });
          }
          gov.appendChild(btn('% definir padrão', 'btn-mini btn-gold', function () { mandaPadrao(false); }));
          gov.appendChild(btn('aplicar a todos', 'btn-mini btn-ghost', function () { mandaPadrao(true); }));
          caixa.appendChild(gov);
        } else {
          var euM = g.membros.filter(function (m) { return m.id === euId; })[0];
          var meuDz = euM && typeof euM.dizimo === 'number' ? Math.floor(euM.dizimo) : Math.floor(g.dizimo || 0);
          if (meuDz > 0) {
            caixa.appendChild(el('p', 'inv-dica',
              'O seu dízimo: <b>' + meuDz + '%</b> do XP de cada sala vira XP da guilda.'));
          }
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
        // ---- O COFRE: a moeda da guilda — líder e oficiais gastam
        if (!remoto) {
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
        }

        // ---- O BANCO DE EMPRÉSTIMOS — DUAS GRADES, como o cofre do Banco
        // (pedido 30/08: "igual ao cofre a maneira de transferir itens...
        // abre o inventário e o inventário da guild"). O gesto é o mesmo:
        // arrasto ou dois toques. As REGRAS de empréstimo continuam do core:
        //   saco → banco: DEVOLVE se você devia aquele item; senão DEPOSITA;
        //   banco → saco: sua peça volta DE VEZ; a dos outros sai EMPRESTADA
        //   (uma por conta); peça emprestada a alguém não sai.
        var bg = el('div', 'guilda-banco');
        if (!remoto) {
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
              if (eb.emprestadoPara === euId && eb.itemId === entrada.itemId &&
                  (eb.level || 0) === (entrada.level || 0) &&
                  (eb.stars || 0) === (entrada.stars || 0)) { devIdx = d2; break; }
            }
            var op = (devIdx >= 0) ? Gd.bancoDevolver(devIdx) : Gd.bancoDepositar(entrada);
            op.then(function (res) {
              if (!res.ok) { toast(res.erro || 'não deu'); sheetGuilda(); return; }
              // 13/09: com a autoridade, o servidor já tirou a peça do estado dele e mandou o estado novo
              if ((res.progress || res.db) && JOGO.Autoridade && JOGO.Autoridade.adota) {
                JOGO.Autoridade.adota(res.progress, res.db);
              } else {
                st2.inventory.splice(pi.indices[0], 1);
                safe(function () { P().save(); }, null);
              }
              toast(devIdx >= 0 ? 'Devolvida. Obrigado em nome da guilda.'
                                : 'No banco da guilda.', 'good');
              sheetGuilda();
            });
          }));

          var colBanco = el('div', 'bk2-col');
          colBanco.dataset.lado = 'cofre';
          colBanco.appendChild(el('h3', 'bk-tit', 'Banco da guilda (' + totalBanco + ')'));
          colBanco.appendChild(bancoGrade(pilhasBanco, 'cofre', function (pi) {
            var e2 = pi.entrada;
            if (e2.emprestadoPara && e2.emprestadoPara !== euId) {
              toast('Emprestada a ' + (e2.tomadorNome || 'alguém') + ' — espere devolver.');
              return;
            }
            if (e2.emprestadoPara === euId) {
              toast('Essa já está com você — devolva arrastando a cópia do saco.');
              return;
            }
            if (!safe(function () { return P().bagFree(1); }, true)) {
              toast('O saco está cheio — não cabe mais nada.');
              return;
            }
            Gd.bancoPegar(pi.indices[0]).then(function (res) {
              if (!res.ok) { toast(res.erro || 'não deu'); sheetGuilda(); return; }
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
              toast(res.definitivo ? 'Sua peça voltou para o saco.' :
                    'Emprestada — devolva uma cópia igual quando puder.', 'good');
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
            caixa.appendChild(el('h3', 'bk-tit', 'Ranking das guildas'));
            ranking.forEach(function (rg, ri) {
              var linhaR = el('div', 'guilda-rank' + (g && rg.id === g.id ? ' is-minha' : ''));
              if (BR() && BR().ehCodigo(rg.emblema)) linhaR.appendChild(elShield(rg.emblema, 20));
              linhaR.appendChild(el('span', null,
                '<b>' + (ri + 1) + 'º</b> ' + esc(txtGuilda(rg.emblema, rg.nome)) +
                ' · nível ' + rg.nivel + ' · ' + rg.xp + ' XP · ' + rg.membros + ' membro(s)'));
              caixa.appendChild(linhaR);
            });
          }
        });
        } else {
          caixa.appendChild(el('p', 'inv-dica', 'Para acessar o Banco da Guilda e o Cofre, dirija-se à Sede da Guilda no acampamento.'));
        }
      }

      // sem guilda o ranking também aparece — e é a PORTA DE ENTRADA
      // (30/08): guilda aberta entra na hora; a de convite recebe o pedido
      if (!g && ranking.length) {
        caixa.appendChild(el('h3', 'bk-tit', 'Guildas do acampamento'));
        ranking.forEach(function (rg, ri) {
          var linha = el('div', 'guilda-rank');
          if (BR() && BR().ehCodigo(rg.emblema)) linha.appendChild(elShield(rg.emblema, 20));
          linha.appendChild(el('span', null,
            '<b>' + (ri + 1) + 'º</b> ' + esc(txtGuilda(rg.emblema, rg.nome)) +
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
    toast('O painel do Mestre não carregou nesta página.');
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
      body.appendChild(el('p', 'inv-dica', 'A Caixa é do Mestre: entre com a conta dele (ou com a chave, em casa).'));
      return;
    }

    // 22/09: as sete abas redondas, com o nome de sempre escondido (a prova
    // tests/prova_gm_caixa.html acha a aba pelo texto exato) e o da aberta
    // escrito no fim da fileira
    var GM_ABAS = [['itens', 'gm-itens', 'Itens'], ['sets', 'gm-sets', 'Conjuntos'],
      ['bichos', 'gm-bichos', 'Bichos'], ['pedras', 'gm-pedras', 'Pedras'],
      ['moedas', 'gm-selos', 'Selos e insígnias'], ['cartas', 'gm-cartas', 'Cartas'],
      ['pergaminhos', 'gm-pergaminhos', 'Pergaminhos']];
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
    busca.placeholder = 'buscar por nome...';
    busca.value = gmCaixaBusca;
    body.appendChild(busca);
    var listaEl = el('div', 'ms-caixa');
    body.appendChild(listaEl);
    var D0 = D();
    var paraQuem = proprio ? '' : ' · vai para <b>' + esc(ctx.destino.nome) + '</b>';

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
    function tem(n) { return proprio ? 'você tem <b>' + n + '</b> · ' : ''; }
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
              pecas.length + ' peças: ' + esc(pecas.join(', ')) + paraQuem, 'Pegar o conjunto', function () {
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
          var qual = pd3.element === 'forja' ? 'segura o nível quando a batida da forja falha'
                   : 'forja as peças de ' + (ELEM_PT[pd3.element] || pd3.element);
          var row = linha(art('stoneIcon', [sid, 40], 40), pd3.name || sid, tem(n) + esc(qual) + paraQuem,
            '+10', function () { dar({ tipo: 'pedras', stoneId: sid, n: 10 }, '10× ' + pd3.name); });
          row.appendChild(btn('+100', 'btn-mini btn-primary', function () {
            dar({ tipo: 'pedras', stoneId: sid, n: 100 }, '100× ' + pd3.name);
          }));
          listaEl.appendChild(row);
        });
        if (vistas) {
          listaEl.appendChild(btn('+100 de cada pedra', 'btn-gold btn-block', function () {
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
          var nomeS = 'Selo de ' + (ELEM_PT[e4] || e4);
          if (!passa(nomeS, e4) || corta()) return;
          var row = linha(art('seloIcon', [e4, 40], 40, 'selo-moeda-img'), nomeS,
            tem(selos[e4] || 0) + porGiro + ' selos somados pagam um giro na roleta do Colecionador' + paraQuem,
            '+10', function () { dar({ tipo: 'selos', elemento: e4, n: 10 }, '10 ' + nomeS); });
          row.appendChild(btn('+100', 'btn-mini btn-primary', function () {
            dar({ tipo: 'selos', elemento: e4, n: 100 }, '100 ' + nomeS);
          }));
          listaEl.appendChild(row);
        });
        if (passa('Insígnia de Fundação', 'insignia') && !corta()) {
          var ins = safe(function () { return JOGO.Progress.insigniasVer(); }, 0) || 0;
          var porGuilda = (D0.insignias && D0.insignias.porGuilda) || 10;
          var rowI = linha(art('insigniaIcon', [40], 40, 'selo-moeda-img'), 'Insígnia de Fundação',
            tem(ins) + porGuilda + ' fundam uma guilda' + paraQuem,
            '+10', function () { dar({ tipo: 'insignias', n: 10 }, '10 Insígnias de Fundação'); });
          rowI.appendChild(btn('+100', 'btn-mini btn-primary', function () {
            dar({ tipo: 'insignias', n: 100 }, '100 Insígnias de Fundação');
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
            ? (ci.unlocked ? 'liberada' : 'trancada (' + (ci.unlockCost || 0) + ' cartas liberam)') +
              ' · <b>' + (ci.cards || 0) + '</b> cartas · ' + (ci.stars ? '★' + ci.stars : 'sem estrela')
            : 'cartas de classe' + paraQuem;
          var row = linha(art('portrait', [cid, { element: 'neutro', size: 80 }], 40), cd.name || cid, sub,
            '+10', function () { dar({ tipo: 'cartas', classId: cid, n: 10 }, '10 cartas de ' + cd.name); });
          row.appendChild(btn('Liberar e ★5', 'btn-mini btn-primary', function () {
            dar({ tipo: 'cartas', classId: cid, topo: true }, cd.name + ': liberada e no ★5');
          }));
          listaEl.appendChild(row);
        });
      } else if (gmCaixaAba === 'pergaminhos') {
        // os pergaminhos da loja (até o teto de cada um) e os dias de bônus de XP
        var pg = safe(function () { return JOGO.Progress.pergaminhos(); }, null) || {};
        var cfgP = D0.pergaminhos || {}, xpP = cfgP.xp || {};
        var tetoP = cfgP.tetoInventario || 99;
        [['xp', 'Pergaminho da Sabedoria', '×' + String(xpP.fator || 1.5).replace('.', ',') + ' de XP por ' +
          (xpP.salas || 9) + ' salas vencidas'],
         ['elemento', 'Pergaminho da Reescrita', 'troca um caminho de elemento do herói por outro']].forEach(function (pp) {
          if (!passa(pp[1], pp[0]) || corta()) return;
          var row = linha(glifo('📜'), pp[1], (proprio ? 'você tem <b>' + (pg[pp[0]] || 0) + '</b> de ' + tetoP + ' · '
                                                        : 'até ' + tetoP + ' · ') + esc(pp[2]) + paraQuem,
            '+1', function () { dar({ tipo: 'pergaminho', pergaminho: pp[0], n: 1 }, '1 ' + pp[1]); });
          row.appendChild(btn('Encher', 'btn-mini btn-primary', function () {
            dar({ tipo: 'pergaminho', pergaminho: pp[0], n: tetoP }, pp[1] + ' até o teto');
          }));
          listaEl.appendChild(row);
        });
        if (passa('Bônus de XP', 'bonus') && !corta()) {
          var ate = safe(function () { return JOGO.Progress.bonusXpAte(); }, 0) || 0;
          var agoraB = safe(function () { return JOGO.Agenda.agora(); }, null) || Date.now();
          var agoraSB = agoraB > 1e11 ? agoraB / 1000 : agoraB;
          var fatorB = String((D0.bonusXp && D0.bonusXp.fator) || 1.5).replace('.', ',');
          var estadoB = !proprio ? 'soma aos dias que a conta já tiver' : ate > agoraSB
            ? 'ligado até ' + new Date(ate * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            : 'desligado';
          var rowB = linha(glifo('⏳'), 'Bônus de XP (×' + fatorB + ')',
            estadoB + ' · o mesmo da loja; conta no relógio do servidor' + paraQuem,
            '+1 dia', function () { dar({ tipo: 'bonus-xp', dias: 1 }, '1 dia de bônus de XP'); });
          rowB.appendChild(btn('+7 dias', 'btn-mini btn-primary', function () {
            dar({ tipo: 'bonus-xp', dias: 7 }, '7 dias de bônus de XP');
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
            var sub = esc(bonusText(pd2.bonuses)) + (proprio ? ' · ' + (info.unlocked ? 'é seu — ' + petNivelTxt(pid2) : 'não é seu') : paraQuem);
            var row = linha(art('petIcon', [pid2, 40], 40), pd2.name || pid2, sub, 'Pegar', function () {
              dar({ tipo: 'pet', petId: pid2, topo: false }, pd2.name);
            });
            row.appendChild(btn('★3 nv10', 'btn-mini btn-primary', function () {
              dar({ tipo: 'pet', petId: pid2, topo: true }, pd2.name + ' no topo: ★3, nível 10');
            }));
            listaEl.appendChild(row);
          })(pids[p], pd);
        }
      }
      if (!vistas) listaEl.appendChild(el('p', 'inv-dica', 'Nada com esse nome.'));
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
  var gmAgendaRasc = { tipo: 'xp', mult: 2, cal: '', titulo: '', texto: '', horas: 2,
                       ini: '', fim: '', dias: [6], hora: '10:00', durH: 12 };
  // 12/09: o multiplicador é livre (mais de 1 até o teto do tipo); estes são só os atalhos
  var AG_MULTS = [1.5, 2, 3, 5, 10];
  var AG_DICA = {
    xp: 'Toda sala paga mais experiência (o corte por herói, o dízimo e o pet herdam).',
    vintem: 'Toda sala paga mais vinténs.',
    pedras: 'Mais pedras de forja ELEMENTAIS — a Âncora fica fora.',
    saque: 'Sai peça com mais frequência; a proporção entre as raridades não muda. Junto do Calabouço do Dia, vale o maior.',
    aviso: 'Só um anúncio no jogo e no site, sem mexer em nada.'
  };
  function gmAgendaEm(body, ctx0) {
    var GMod = JOGO.GM, Ag = JOGO.Agenda;
    var ctx = gmCtx(ctx0);
    // redesenha a aba (só se o painel ainda estiver nela: a resposta do servidor pode chegar depois)
    function refaz() { if (ctx.aberta()) ctx.refaz(); }
    if (!GMod || !GMod.ativo || !GMod.ativo()) {
      body.appendChild(el('p', 'inv-dica', 'Os eventos do mundo são do Mestre: entre com a conta dele.'));
      return;
    }
    body.appendChild(el('p', 'inv-dica ag-sub',
      'Liga agora, agenda ou põe no calendário de toda semana — vale para todos os jogadores, no jogo e no site.'));
    if (!Ag || !Ag.fator) {
      body.appendChild(el('p', 'inv-dica', 'A agenda do mundo não carregou nesta página.'));
      return;
    }
    var S = JOGO.Sessao;
    var comMarca = !!safe(function () { return S.ativa() && S.conta() && S.conta().gm === true; }, false);
    var servidor = !!safe(function () { return Ag.noAr(); }, false);
    var pode = comMarca && servidor;
    function dois(n) { return (n < 10 ? '0' : '') + n; }

    var abas = el('div', 'inv-filtros ag-abas');
    abas.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
    [['agora', 'Agora'], ['agendar', 'Agendar'], ['calendario', 'Calendário']].forEach(function (par) {
      abas.appendChild(btn(par[1], 'btn-mini ag-aba' + (gmAgendaAba === par[0] ? ' btn-gold' : ' btn-ghost'), function () {
        gmAgendaAba = par[0];
        refaz();
      }));
    });
    body.appendChild(abas);

    if (!comMarca) body.appendChild(el('p', 'ag-nota', esc(Ag.NOTA_MESTRE)));
    else if (!servidor) {
      body.appendChild(el('p', 'ag-nota', 'O servidor está fora (ou ainda não conhece os eventos do mundo): ' +
        'a lista abaixo é a última que chegou, só para leitura.'));
    }

    // sem a marca ou sem servidor, todo botão que grava fica desligado
    function desliga(b) { if (!pode) { b.disabled = true; b.classList.add('is-off'); } return b; }
    // a resposta do servidor: o erro dele vai inteiro para o toast; a ficha repinta
    function resposta(r, okMsg) {
      if (r && r.ok) ctx.aviso(okMsg, 'good');
      else ctx.aviso((r && r.erro) || 'não deu — o servidor não respondeu');
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
      form.appendChild(campo('Tipo', seletor(Ag.TIPOS.map(function (t) {
        return [t, Ag.NOMES[t] + (Ag.TETOS[t] > 1 ? ' (até ' + Ag.fmtFator(Ag.TETOS[t]) + ')' : '')];
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
        wMult.appendChild(el('span', 'inv-dica', esc('Multiplicador (de ×1,01 até ' + Ag.fmtFator(teto) + ')')));
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
      form.appendChild(campo('Calabouço', seletor([['', 'Todos os calabouços']].concat(
        Ag.calaboucosDoPainel().map(function (id) { return [id, Ag.nomeCalabouco(id)]; })),
        R.cal, function (v) { R.cal = v; })));
      form.appendChild(campo('Título (3 a 60 letras)', entrada('text', R.titulo, function (v) { R.titulo = v; },
        { maxlength: '60', placeholder: 'Quinta do XP' })));
      form.appendChild(campo('Texto (opcional, até 280)', entrada('textarea', R.texto, function (v) { R.texto = v; },
        { maxlength: '280', rows: '2', placeholder: 'Toda sala paga o dobro de experiência.' })));
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
      if (t.length < 3 || t.length > 60) { ctx.aviso('O título precisa de 3 a 60 letras.'); return false; }
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
        ctx.aviso('O multiplicador vai de ×1,01 até ' + Ag.fmtFator(teto) + '.');
        return false;
      }
      R.mult = m;
      return true;
    }
    // uma lista de eventos; o pontual ganha "encerrar" (no ar) ou "cancelar" (futuro)
    function listaEventos(titulo, evs, vazio) {
      body.appendChild(el('h3', 'hs-sec', esc(titulo)));
      var caixa = el('div', 'ms-caixa ag-lista');
      if (!evs.length) caixa.appendChild(el('p', 'inv-dica', esc(vazio)));
      var agoraMs = Ag.agora();
      evs.forEach(function (e) {
        var noArAgora = e.inicio * 1000 <= agoraMs;
        var row = el('div', 'ms-linha ag-linha');
        row.setAttribute('data-evento', e.id);
        var tx = el('div', 'ms-tx');
        tx.appendChild(el('div', 'ms-nome', '<b>' + esc(e.titulo) + '</b> <i>· ' + esc(Ag.rotulo(e)) +
          ' · ' + esc(Ag.nomeCalabouco(e.calabouco)) + '</i>'));
        var quando = noArAgora
          ? 'no ar · termina em ' + Ag.falta(e.fim * 1000 - agoraMs) + ' (' + Ag.quando(e.fim) + ')'
          : Ag.quando(e.inicio) + ' → ' + Ag.quando(e.fim) + ' (Brasília)';
        tx.appendChild(el('div', 'ms-prog', esc(quando) + (e.origem === 'calendario' ? ' · da regra semanal' : '') +
          (e.texto ? ' — ' + esc(e.texto) : '')));
        row.appendChild(tx);
        var alvo = Ag.alvoDe(e);
        if (alvo && alvo.alvo === 'evento') {
          row.appendChild(desliga(btn(noArAgora ? 'Encerrar' : 'Cancelar', 'btn-mini btn-ghost ag-cancela', function () {
            ctx.confirma(noArAgora ? 'Encerrar o evento agora?' : 'Cancelar o evento?',
              '<b>' + esc(e.titulo) + '</b> (' + esc(Ag.rotulo(e)) + ') sai do ar para todo mundo. ' +
              'Não há como desfazer — dá para ligar de novo.',
              function () {
                Ag.cancelar(alvo.alvo, alvo.id).then(function (r) {
                  resposta(r, noArAgora ? 'Evento encerrado.' : 'Evento cancelado.');
                });
              });
          })));
        }
        caixa.appendChild(row);
      });
      body.appendChild(caixa);
    }

    var R = gmAgendaRasc;
    if (gmAgendaAba === 'agora') {
      body.appendChild(el('h3', 'hs-sec', 'Ligar agora'));
      var fA = el('div', 'ag-form');
      camposComuns(fA);
      fA.appendChild(campo('Duração em horas (1 a 168)', entrada('number', R.horas, function (v) { R.horas = v; },
        { min: '1', max: '168', step: '1' })));
      body.appendChild(fA);
      body.appendChild(desliga(btn('Ligar agora', 'btn-gold btn-block ag-envia', function () {
        if (!tituloOk()) return;
        var h = Math.floor(Number(R.horas));
        if (!(h >= 1 && h <= 168)) { ctx.aviso('A duração vai de 1 a 168 horas.'); return; }
        var c = corpoComum();
        // sem `inicio`: o servidor liga no relógio DELE. As 168 h cheias perdem
        // 2 min para não passar dos 7 dias por um desvio de relógio de segundos.
        c.fim = Math.floor(Ag.agora() / 1000) + h * 3600 - (h >= 168 ? 120 : 0);
        Ag.criar(c).then(function (r) { resposta(r, 'Evento no ar: ' + c.titulo + '.'); });
      })));
      listaEventos('No ar agora', Ag.ativos(), 'Nenhum evento no ar.');
    } else if (gmAgendaAba === 'agendar') {
      body.appendChild(el('h3', 'hs-sec', 'Agendar (hora de Brasília)'));
      var fB = el('div', 'ag-form');
      camposComuns(fB);
      if (!R.ini || !R.fim) {
        var cheia = Math.ceil(Ag.agora() / 3600000) * 3600;            // a próxima hora cheia
        R.ini = Ag.paraBrasilia(cheia + 3600);
        R.fim = Ag.paraBrasilia(cheia + 5 * 3600);
      }
      fB.appendChild(campo('Começa', entrada('datetime-local', R.ini, function (v) { R.ini = v; })));
      fB.appendChild(campo('Termina', entrada('datetime-local', R.fim, function (v) { R.fim = v; })));
      body.appendChild(fB);
      body.appendChild(desliga(btn('Agendar', 'btn-gold btn-block ag-envia', function () {
        if (!tituloOk()) return;
        var ini = Ag.deBrasilia(R.ini), fim = Ag.deBrasilia(R.fim);
        if (ini == null || fim == null) { ctx.aviso('Diga quando começa e quando termina.'); return; }
        if (!(fim > ini)) { ctx.aviso('O fim tem de vir depois do começo.'); return; }
        if (fim - ini > 7 * 86400) { ctx.aviso('Um evento dura no máximo 7 dias.'); return; }
        var c = corpoComum();
        c.inicio = ini;
        c.fim = fim;
        Ag.criar(c).then(function (r) { resposta(r, 'Evento agendado: ' + c.titulo + '.'); });
      })));
      listaEventos('Agendados', Ag.proximos().filter(function (e) { return e.origem !== 'calendario'; }),
        'Nada agendado.');
    } else {
      body.appendChild(el('h3', 'hs-sec', 'Nova regra de toda semana'));
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
      wDias.appendChild(el('span', 'inv-dica', 'Dias'));
      wDias.appendChild(dias);
      fC.appendChild(wDias);
      fC.appendChild(campo('Hora de Brasília', entrada('time', R.hora, function (v) { R.hora = v; })));
      fC.appendChild(campo('Duração em horas (¼ a 24)', entrada('number', R.durH, function (v) { R.durH = v; },
        { min: '0.25', max: '24', step: '0.25' })));
      body.appendChild(fC);
      body.appendChild(desliga(btn('Pôr no calendário', 'btn-gold btn-block ag-envia', function () {
        if (!tituloOk()) return;
        if (!R.dias.length) { ctx.aviso('Escolha pelo menos um dia.'); return; }
        if (!/^\d{2}:\d{2}$/.test(String(R.hora || ''))) { ctx.aviso('A hora vai no formato 10:00.'); return; }
        var dur = Math.round(Number(R.durH) * 60);
        if (!(dur >= 15 && dur <= 1440)) { ctx.aviso('A duração vai de 15 minutos a 24 horas.'); return; }
        var c = corpoComum();
        c.dias = R.dias.slice().sort(function (a, b) { return a - b; });
        c.hora = R.hora;
        c.duracaoMin = dur;
        c.vigenteDe = null;
        c.vigenteAte = null;
        Ag.criarRegra(c).then(function (r) { resposta(r, 'No calendário: ' + Ag.textoRegra(c) + '.'); });
      })));

      body.appendChild(el('h3', 'hs-sec', 'Toda semana'));
      var cr = el('div', 'ms-caixa ag-lista');
      var rs = Ag.regras();
      if (!rs.length) cr.appendChild(el('p', 'inv-dica', 'Nenhuma regra no calendário.'));
      rs.forEach(function (rg) {
        var row = el('div', 'ms-linha ag-linha');
        row.setAttribute('data-regra', String(rg.id));
        var tx = el('div', 'ms-tx');
        tx.appendChild(el('div', 'ms-nome', '<b>' + esc(rg.titulo) + '</b> <i>· ' + esc(Ag.rotulo(rg)) +
          ' · ' + esc(Ag.nomeCalabouco(rg.calabouco)) + '</i>'));
        tx.appendChild(el('div', 'ms-prog', esc(Ag.textoRegra(rg))));
        row.appendChild(tx);
        row.appendChild(desliga(btn('Cancelar', 'btn-mini btn-ghost ag-cancela', function () {
          ctx.confirma('Tirar a regra do calendário?',
            '<b>' + esc(rg.titulo) + '</b> para de acontecer — e a ocorrência que estiver no ar sai junto.',
            function () {
              Ag.cancelar('regra', rg.id).then(function (r) { resposta(r, 'Regra cancelada.'); });
            });
        })));
        cr.appendChild(row);
      });
      body.appendChild(cr);

      listaEventos('No ar agora', Ag.ativos(), 'Nenhum evento no ar.');
      listaEventos('Próximos 14 dias', Ag.proximos(), 'Nada nos próximos 14 dias.');

      // os 14 dias pelo relógio LOCAL: é por ele que o Calabouço do Dia sorteia (diario.js)
      body.appendChild(el('h3', 'hs-sec', 'Os próximos 14 dias'));
      var grade = el('div', 'ag-dias14');
      var todos = Ag.ativos().concat(Ag.proximos());
      var meio0 = new Date(Ag.agora());
      meio0.setHours(12, 0, 0, 0);
      for (var d14 = 0; d14 < 14; d14++) {
        var meio = new Date(meio0.getTime() + d14 * 86400000);
        var ini0 = new Date(meio.getTime()); ini0.setHours(0, 0, 0, 0);
        var fim0 = ini0.getTime() + 86400000;
        var ts14 = meio.getTime();
        var doDia = safe(function () { return JOGO.Diario.hoje(ts14); }, null);
        var evs14 = todos.filter(function (e) { return e.inicio * 1000 < fim0 && e.fim * 1000 > ini0.getTime(); });
        var linha14 = el('div', 'ag-dia14' + (d14 === 0 ? ' is-hoje' : ''));
        linha14.appendChild(el('b', null, Ag.DIA_CURTO[meio.getDay()] + ' ' + dois(meio.getDate()) + '/' + dois(meio.getMonth() + 1)));
        linha14.appendChild(el('span', 'ag-dia14-dia',
          doDia ? '☀ ' + esc(Ag.nomeCalabouco(doDia.dungeonId)) + ' — Calabouço do Dia' : '—'));
        if (evs14.length) {
          linha14.appendChild(el('span', 'ag-dia14-ev', evs14.map(function (e) {
            return esc(Ag.rotulo(e)) + ' · ' + esc(e.titulo);
          }).join(' | ')));
        }
        grade.appendChild(linha14);
      }
      body.appendChild(grade);
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
      body.appendChild(el('p', 'inv-dica', 'O grimório é do Mestre: entre com a conta dele (ou com a chave, em casa).'));
      return;
    }
    body.appendChild(el('p', 'inv-dica',
      'O cofre não tem fundo: todo preço se paga sozinho enquanto o modo Mestre estiver ligado. ' +
      'A conta do Mestre entra direto com o <b>Mestre do Fundo</b>.'));

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
              ctx.refaz();
            }));
          listaEl.appendChild(row);
        })(sp);
      }
      if (!vistas) listaEl.appendChild(el('p', 'empty', 'Nada com esse nome no acervo.'));
    }
    busca.addEventListener('input', function () { gmBusca = busca.value; pinta(); });
    busca.addEventListener('keydown', function (ev) { ev.stopPropagation(); });   // o "m" digitado aqui não fecha o painel
    pinta();
  }
  UI.gmGrimorioEm = gmGrimorioEm;


  function sheetBattleMenu() {
    var body = sheetShell('Pausa');
    var acts = el('div', 'menu-acts');
    // com o menu dividido, a pausa aponta para as duas fichas que importam
    // no meio da luta: o saco e a árvore de feitiços
    acts.appendChild(btn('Inventário', 'btn-ghost', function () { openSheet('inventory'); }));
    acts.appendChild(btn('Feitiços', 'btn-ghost', function () { openSheet('spells'); }));
    var mr = modoRede();
    if (mr === 'grupo') {
      // 11/09: em grupo, sair da batalha é sair do grupo e da descida (D16)
      acts.appendChild(btn('Sair do grupo e da descida', 'btn-warn', function () {
        confirmSheet('Sair do grupo e da descida?',
          // 12/09 (dono): "sair da batalha/desistir, ele deve morrer" — o
          // aviso tem de dizer isso antes, e não depois
          'Seus heróis <b>morrem</b> nesta sala e você não recebe nada dela. ' +
          'Cair da internet é diferente: ali eles ficam de pé e o turno passa até você voltar.', function () {
            safe(function () { Cp().sairDaBatalha(); return true; }, null);
            safe(function () { Gp().sair('saiu'); return true; }, null);
            // 12/09 (dono): abandonar leva à PRAÇA, não ao menu
            safe(function () { return G().abandonar(); }, false);
          });
      }));
    } else if (mr === 'guerra') {
      // 15/09: sair da guerra de guilda é o mesmo de sair do grupo na batalha — os heróis caem
      acts.appendChild(btn('Sair da guerra', 'btn-warn', function () {
        confirmSheet('Sair da guerra de guilda?',
          'Os seus dois heróis <b>caem</b> nesta batalha e o seu parceiro segue sozinho pela guilda. ' +
          'Cair da internet é diferente: ali eles ficam de pé e o turno passa até você voltar.', function () {
            safe(function () { Cp().sairDaGuerra('saiu'); return true; }, null);
            navTo('hub');
          });
      }));
    } else if (mr === 'duelo') {
      acts.appendChild(btn('Desistir do duelo', 'btn-warn', function () {
        // 15/09 (as falhas conhecidas): desistir não foge da consequência — o aviso diz antes
        confirmSheet('Desistir do duelo?', 'Conta como <b>derrota</b>: os seus heróis saem da luta com a vida a 0 ' +
          'e, na Arena e no Campo de PvP, a coroa conta a derrota.', function () {
          safe(function () { Cp().desistir(); return true; }, null);
        });
      }));
    } else {
      acts.appendChild(btn('Abandonar a descida', 'btn-warn', function () {
        confirmSheet('Abandonar?',
          'O que você já ganhou fica. A sala em curso se perde e você volta ao Acampamento.',
          function () {
            // 12/09 (dono): abandonar leva à PRAÇA, não ao menu
            safe(function () { G().restart('hub'); }, null);
            navTo('hub');
          });
      }));
    }
    acts.appendChild(btn('Configurações', 'btn-ghost', function () { openSheet('config'); }));
    acts.appendChild(btn('Voltar à luta', 'btn-primary', closeSheet));
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
    return safe(function () { return Gp().textoMotivo(m, nome); }, null) || 'Não deu agora.';
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

  /* O CONVITE DE GRUPO que chega (4.2): no mesmo painel da troca e da guilda */
  function mostraConviteGrupo(c) {
    var p = abrePainel('convite');
    if (!p) { toast(c.nome + ' te chama para o grupo.'); return; }
    painelConv = { tipo: 'grupo', gid: c.gid };
    var h = c.heroi || {};
    cabecalhoPainel(p, h.classId, h.element, '<b>' + esc(c.nome) + '</b> te chama para o grupo.',
      h.classId ? esc(className(h.classId)) + ' · nv ' + (h.level || 1) : '');
    var meus = meusHeroisG();
    var lista = meus.map(function (x) {
      return esc(className(x.classId || '')) + ' nv ' + (x.level || 1);
    }).join(' e ');
    p.appendChild(el('p', 'hub-nota', esc(c.nome) + ' lidera: escolhe o calabouço e abre as portas. ' +
      (meus.length > 1 ? 'Você leva os seus dois: <b>' : 'Você leva o seu herói: <b>') + lista + '</b>.'));
    p.appendChild(barraPrazo(c.expira, function () { return Gp()._agora(); }));
    var duo = el('div', 'pn-duplo');
    duo.appendChild(btn('Aceitar', 'btn-primary', function () {
      var r = safe(function () { return Gp().responder(true); }, null);
      fechaPainel();
      if (r && r.ok) toast('Você entrou no grupo de ' + c.nome + '.', 'good');
      else toast(textoMotivo(r ? r.motivo : 'expirou', null));
    }));
    duo.appendChild(btn('Agora não', 'btn-ghost', function () {
      safe(function () { return Gp().responder(false); }, null);
      fechaPainel();
    }));
    p.appendChild(duo);
    if (sheetName) toast(c.nome + ' te chama para o grupo — veja o painel');
  }
  /* O DESAFIO que chega (4.2) */
  function mostraDesafio(c) {
    var p = abrePainel('convite');
    if (!p) { toast(c.nome + ' te desafia para um duelo.'); return; }
    painelConv = { tipo: 'duelo', did: c.did };
    cabecalhoPainel(p, classeDoPar(c.id), 'neutro', '<b>' + esc(c.nome) + '</b> te chama para um desafio amistoso.', '');
    // 14/09: o desafio é na praça e não mexe na coroa
    p.appendChild(el('p', 'hub-nota', '<b>Desafio amistoso — a coroa não muda.</b> Mapa: A Praça. ' +
      'Cada um leva 1 ou 2 heróis, escolhidos às cegas.'));
    p.appendChild(barraPrazo(c.expira, function () { return Dl()._agora(); }));
    var duo = el('div', 'pn-duplo');
    duo.appendChild(btn('Aceitar', 'btn-primary', function () {
      var r = safe(function () { return Dl().responder(true); }, null);
      fechaPainel();
      if (!r || !r.ok) toast(textoMotivo(r ? r.motivo : 'expirou', null));
    }));
    duo.appendChild(btn('Agora não', 'btn-ghost', function () {
      safe(function () { return Dl().responder(false); }, null);
      fechaPainel();
    }));
    p.appendChild(duo);
    if (sheetName) toast(c.nome + ' te desafia para um duelo — veja o painel');
  }

  /* O PORTAL em grupo (4.5): quem lidera desce com o outro; quem segue espera */
  function painelPortalGrupo(p, lugar) {
    var nome = nomeParceiro();
    var est = grupoEstado() || {};
    if (souLider()) {
      var sd = seletorDif();
      if (sd) p.appendChild(sd);
      var meusP = meusHeroisG();
      p.appendChild(el('p', 'hub-nota', (meusP.length > 1 ? 'Em grupo, cada um leva os seus dois: <b>'
                                                          : 'Em grupo, cada um leva o seu herói: <b>') +
        meusP.map(function (x) { return esc(className(x.classId || '')) + ' nv ' + (x.level || 1); }).join(' e ') +
        '</b>.'));
      if (est.descendo && est.descendo.dungeonId === lugar.id) {
        p.appendChild(btn('Chamando ' + esc(nome) + '…', 'btn-primary btn-block is-apagado', function () {}));
        return;
      }
      p.appendChild(btn('Descer com ' + esc(nome), 'btn-primary btn-block', function () {
        var r = safe(function () { return Gp().descer(lugar.id); }, null);
        if (!r || !r.ok) toast(textoMotivo(r ? r.motivo : 'ocupado', r && r.motivo === 'sumido' ? nome : null));
        else repintaLugar();
      }));
      return;
    }
    p.appendChild(el('p', 'hub-nota', 'Só quem lidera (<b>' + esc(nome) + '</b>) escolhe o calabouço.'));
    var lnDif = linhaDifGrupo();                    // 11/09 (revisão): e a dificuldade, antes de descer
    if (lnDif) p.appendChild(lnDif);
    p.appendChild(btn('Descer', 'btn-primary btn-block is-apagado', function () {
      toast('Só quem lidera (' + nome + ') escolhe o calabouço.');
    }));
    p.appendChild(btn('Sair do grupo para descer sozinho', 'btn-ghost btn-block', function () {
      confirmSheet('Sair do grupo?', 'Você deixa o grupo de ' + esc(nome) + ' e volta a descer sozinho.', function () {
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
    cheio: 'A vida desse herói já está cheia.', acabou: 'Essa poção acabou.', 'sem-pocao': 'Essa poção acabou.',
    pocao: 'Poção desconhecida.', heroi: 'Cada um cura os próprios heróis.',
    batalha: 'Na batalha não se bebe: a poção é para fora da luta (na praça ou na sala de espera).',
    fase: 'Na batalha não se bebe: a poção é para fora da luta (na praça ou na sala de espera).',
    servidor: 'O servidor não respondeu — tente num instante.', bebendo: 'Bebendo…',
    'outro-aparelho': 'Sua conta entrou em outro aparelho.'
  };
  function textoEsperaVida(ev) { return 'Esperando ' + ev.nome + ' recuperar… ' + ev.esperaS + ' s'; }
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
      box.appendChild(el('div', 'vida-tit', 'A vida volta sozinha: <b>+1 PV a cada ' + segPorPv() + ' s</b> — ou beba uma poção'));
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
            b.title = po.def.name + ': cura ' + po.def.cura + ' PV (você tem ' + po.n + ')';
            tap(b, function () { bebeVida(v.chave, po.id); });
            pp.appendChild(b);
          });
          row.appendChild(pp);
        }
        q.rows[v.chave] = { row: row, num: numEl, enche: enche, nota: nota };
        q.linhas.appendChild(row);
      });
      if (q.comPocoes && !pocoes.length) {
        q.linhas.appendChild(el('p', 'vh-sem', 'Sem poções: a banca do mercador vende no Mercadinho da praça.'));
      }
    }
    lista.forEach(function (v) {
      var r = q.rows[v.chave];
      if (!r) return;
      r.num.textContent = v.hp + '/' + v.max + ' PV';
      r.enche.style.width = (v.max > 0 ? Math.round(100 * v.hp / v.max) : 0) + '%';
      r.row.classList.toggle('is-zero', v.hp < 1);
      r.row.classList.toggle('is-cheio', v.hp >= v.max);
      r.nota.textContent = v.hp >= v.max ? 'vida cheia'
        : (v.hp < 1 ? 'sem vida — 1 PV em ' + v.ate1S + ' s'
          : '+1 PV a cada ' + segPorPv() + ' s · cheio em ' + mmss(v.cheioEmS));
      [].forEach.call(r.row.querySelectorAll('.vh-pocao'), function (b) {
        var m = safe(function () { return G().podeBeberEspera(v.chave, b.getAttribute('data-pocao')); }, 'batalha');
        b.classList.toggle('is-dim', !!m);
      });
    });
  }
  function bebeVida(chave, pocaoId) {
    var motivo = safe(function () { return G().podeBeberEspera(chave, pocaoId); }, 'batalha');
    if (motivo) { toast(BEBER_MOTIVO_PT[motivo] || 'Agora não dá para beber.'); return; }
    var pr = safe(function () { return G().bebeNaEspera(chave, pocaoId); }, null);
    if (!pr || typeof pr.then !== 'function') return;
    pr.then(function (res) {
      if (!res || !res.ok) toast((res && (BEBER_MOTIVO_PT[res.motivo] || res.erro)) || 'Não deu para beber.');
      else toast('+' + res.cura + ' PV' + (res.hp != null ? ' — ' + res.hp + '/' + res.max + ' PV' : '') + '.', 'good');
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
   * e classes, e mede o topo da praça para o cartão nunca ficar por baixo dele. */
  var vidaAlvoPraca = null;
  var CORACAO_SVG = '<svg viewBox="0 0 32 29" aria-hidden="true"><path d="M16 28 13.8 26C5.9 18.9 1 14.5 1 9 ' +
    '1 4.5 4.5 1 9 1c2.5 0 5 1.2 7 3.1C18 2.2 20.5 1 23 1c4.5 0 8 3.5 8 8 0 5.5-4.9 9.9-12.8 17z"/></svg>';
  function vidaPraca() {
    var box = el('div', 'vida-praca');
    var cartoes = el('div', 'vp-cartoes'), pocoesEl = el('div', 'vp-pocoes');
    box.appendChild(cartoes);
    box.appendChild(pocoesEl);
    var q = { box: box, cartoes: cartoes, pocoesEl: pocoesEl, para: null, sig: '', rows: {}, modo: 'praca',
              pinta: pintaVidaPraca, top: -1 };
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
          b.title = po.def.name + ': cura ' + po.def.cura + ' PV (você tem ' + po.n + ')';
          tap(b, function () { if (vidaAlvoPraca) bebeVida(vidaAlvoPraca, po.id); });
          q.pocoesEl.appendChild(b);
        });
      } else {
        q.pocoesEl.appendChild(el('p', 'vh-sem vp-sem', 'Sem poções: a banca do mercador vende no Mercadinho.'));
      }
    }
    var dois = lista.length > 1;
    lista.forEach(function (v) {
      var r = q.rows[v.chave];
      if (!r) return;
      var p = pctVida(v), cheio = v.hp >= v.max, zero = v.hp < 1, alvo = v.chave === vidaAlvoPraca;
      var n = v.hp + '/' + v.max, pt = zero ? '1 PV em ' + Math.max(1, v.ate1S) + ' s' : p + '%';
      if (r.num.textContent !== n) r.num.textContent = n;
      if (r.pct.textContent !== pt) r.pct.textContent = pt;
      if (r.enche.style.height !== p + '%') r.enche.style.height = p + '%';
      r.card.classList.toggle('is-cheio', cheio);
      r.card.classList.toggle('is-zero', zero);
      r.card.classList.toggle('is-baixo', !cheio && !zero && p < 35);
      r.card.classList.toggle('is-alvo', alvo);
      r.card.setAttribute('aria-pressed', alvo ? 'true' : 'false');
      var tt = v.nome + ': ' + n + ' PV' + (cheio ? ' — vida cheia'
        : (zero ? ' — 1 PV em ' + Math.max(1, v.ate1S) + ' s' : ' — +1 PV a cada ' + segPorPv() + ' s · cheio em ' + mmss(v.cheioEmS))) +
        (dois ? ' · toque para escolher quem bebe a poção' : '');
      if (r.card.title !== tt) r.card.title = tt;
      if (alvo && q.para) {
        var pr = 'Poção para <b>' + esc(v.nome) + '</b>:';
        if (q.para.innerHTML !== pr) q.para.innerHTML = pr;
      }
    });
    [].forEach.call(q.pocoesEl.querySelectorAll('.vp-pocao'), function (b) {
      var m = safe(function () { return G().podeBeberEspera(vidaAlvoPraca, b.getAttribute('data-pocao')); }, 'batalha');
      b.classList.toggle('is-dim', !!m);
    });
    posicionaVidaPraca(q);
  }
  /* o topo do cartão: logo abaixo do nome/moedas/Menu da praça (no celular os chips descem uma
   * linha) e, quando a faixa dos eventos está no ar e cruza a coluna do cartão, abaixo dela */
  function posicionaVidaPraca(q) {
    var tela = q.box.parentNode;
    if (!tela || !tela.getBoundingClientRect) return;
    var rt = tela.getBoundingClientRect();
    if (!rt.width) return;
    var fundo = 0, rb = q.box.getBoundingClientRect();
    ['.hub-top .hub-quem', '.hub-top .hub-acts', '.hub-evento:not(.is-off)'].forEach(function (sel) {
      var e = tela.querySelector(sel);
      if (!e) return;
      var r = e.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (r.left >= rb.left + Math.max(rb.width, 1) || r.right <= rb.left) return;   // não cruza a coluna
      fundo = Math.max(fundo, r.bottom - rt.top);
    });
    var top = Math.max(0, Math.round(fundo + 8));
    if (!fundo) top = -1;
    if (top === q.top) return;
    q.top = top;
    q.box.style.top = top < 0 ? '' : top + 'px';
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
        b.textContent = abrindo ? 'Conferindo a vida com o servidor…'
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
  function painelPortaGrupo(p) {
    var nome = nomeParceiro();
    // 13/09: a vida dos heróis do grupo (os meus com as poções; os do parceiro, sem)
    var vidaG = vidaBloco('porta');
    if (!souLider()) {
      // 11/09 (revisão): quem segue vê a dificuldade que vale (a da ata é a de quem lidera)
      var lnDif = linhaDifGrupo();
      if (lnDif) p.appendChild(lnDif);
      if (vidaG) p.appendChild(vidaG);
      p.appendChild(el('p', 'hub-nota', 'Quem abre a porta é quem lidera (<b>' + esc(nome) + '</b>). ' +
        (meusHeroisG().length > 1 ? 'Seus dois heróis estão prontos. ' : 'Seu herói está pronto. ') +
        '<b style="color:#7fe08a">✓</b>'));
      return;
    }
    var sd = seletorDif();
    if (sd) p.appendChild(sd);
    if (vidaG) p.appendChild(vidaG);
    var pe = safe(function () { return Cp().podeEntrar(); }, null) || { ok: false, motivo: 'sem-pronto' };
    var chamando = chamandoPorta && (Date.now() - chamandoPorta < 20000);
    var espera = (pe.motivo === 'vida' && pe.vida) ? textoEsperaVida(pe.vida) + ' — ou beba uma poção.' : esperaPorta(nome);
    if (chamando) p.appendChild(el('p', 'hub-nota', 'Chamando ' + esc(nome) + ' para a batalha…'));
    else if (!pe.ok) {
      p.appendChild(el('p', 'hub-nota hub-espera-par', pe.motivo === 'versao' ? esc(textoMotivo('versao', nome)) : esc(espera)));
    }
    p.appendChild(btn('Entrar na batalha com ' + esc(nome), 'btn-primary btn-block' + (pe.ok && !chamando ? '' : ' is-apagado'),
      function () {
        if (chamando) return;
        if (!pe.ok) { toast(pe.motivo === 'versao' ? textoMotivo('versao', nome) : espera); return; }
        var ok = safe(function () { return Cp().entrar(); }, false);
        if (!ok) { toast('Não deu para chamar ' + nome + ' agora.'); return; }
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
    return (pid && parSala && parSala === aqui) ? 'Esperando ' + nome + ' ficar pronto(a)…'
      : nome + ' ainda não entrou na antessala (na recompensa, é o botão "Seguir para a próxima sala").';
  }
  /* 11/09 (revisão): a dificuldade de quem lidera, para quem segue — ela chega no
   * estado do grupo e no "descer"; a que vale na batalha é a da ata, a de quem lidera */
  function linhaDifGrupo() {
    var dif = (grupoEstado() || {}).descidaDif;
    var cfg = dif ? ((JOGO.DATA && JOGO.DATA.dificuldades) || {})[dif] : null;
    if (!cfg) return null;
    var custo = Math.round(((cfg.vida || 1) - 1) * 100), premio = Math.round(((cfg.xp || 1) - 1) * 100);
    var num = (custo === 0 && premio === 0) ? '' : ' — ' + (custo === 0 ? 'monstros iguais' : (custo > 0 ? '+' : '') + custo + '% de vida') +
      ', ' + (premio === 0 ? 'xp normal' : (premio > 0 ? '+' : '') + premio + '% de xp');
    return el('p', 'hub-nota hub-dif-lider', 'Dificuldade escolhida por quem lidera: <b>' + esc(cfg.nome || dif) + '</b>' + esc(num));
  }

  // ------------------------------------------------ o painel do grupo (P4)
  var grupoLadoEl = null, glMenuEl = null, glSig = '', tickSocial = 0, ultConexao = null;
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
        return { u: u, h: h || {},
                 pv: u ? Math.round(100 * Math.max(0, u.hp) / Math.max(1, u.hpMax)) : null,
                 vez: !!(u && ativa && ativa.uid === u.uid) };
      });
      return {
        m: m, linhas: linhas, fora: fora, voltando: !!voltando, lider: m.id === est.lider,
        ia: us.some(function (u) { return !!u.ia; }) || (!m.eu && !!(ses && ses.parceiroIA)),
        vez: linhas.some(function (l) { return l.vez; }),
        semRede: !!m.eu && conexao === 'religando'
      };
    });
    var sig = current + '#' + cartas.map(function (c) {
      return [c.m.id, c.m.nome, c.fora, c.voltando, c.lider, c.ia, c.vez, c.semRede,
              c.linhas.map(function (l) {
                return [l.h.classId, l.h.element, l.h.level, l.pv, l.vez ? 1 : 0].join('.');
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
    var nome = String(m.nome || (m.eu ? 'Você' : '?'));
    tx.appendChild(el('span', 'gl-nome', esc(nome.length > 12 ? nome.slice(0, 11) + '…' : nome)));
    linhas.forEach(function (l) {
      var hh = l.h || {};
      tx.appendChild(el('span', 'gl-nv' + (l.vez ? ' is-vez' : ''),
                        esc(className(hh.classId || '')) + ' · nv ' + (hh.level || 1)));
      if (l.pv === null) return;
      var vb = el('div', 'gl-vida');
      var vi = el('i');
      vi.style.width = Math.max(0, Math.min(100, l.pv)) + '%';
      vb.appendChild(vi);
      tx.appendChild(vb);
    });
    var selos = el('div', 'gl-selos');
    if (c.vez) selos.appendChild(el('span', 'gl-selo s-vez', 'vez'));
    if (c.ia) selos.appendChild(el('span', 'gl-selo s-ia', 'fora'));
    if (c.voltando) selos.appendChild(el('span', 'gl-selo s-voltando', 'voltando…'));
    else if (c.fora) selos.appendChild(el('span', 'gl-selo s-caiu', m.saiu ? 'saiu' : 'caiu'));
    if (c.semRede) selos.appendChild(el('span', 'gl-selo s-caiu', 'sem conexão'));
    if (selos.childNodes.length) tx.appendChild(selos);
    card.appendChild(tx);
    card.title = nome + (c.lider ? ' — lidera' : '');
    tap(card, function () { abreGlMenu(m, card); });
    return card;
  }
  function fechaGlMenu() {
    if (glMenuEl) { glMenuEl.classList.remove('is-on'); glMenuEl.removeAttribute('data-de'); }
  }
  function confirmaSair(nome) {
    var naAntessala = current === 'antessala';
    confirmSheet('Sair do grupo?', naAntessala
      ? 'A descida acaba para vocês dois e o grupo se desfaz.'
      : 'Você deixa o grupo' + (nome ? ' de ' + esc(nome) : '') + '.', function () {
        safe(function () { Gp().sair('saiu'); return true; }, null);
      });
  }
  /* o menu de um cartão do painel do grupo (4.3) */
  function abreGlMenu(m, card) {
    if (!glMenuEl) return;
    if (glMenuEl.classList.contains('is-on') && glMenuEl.getAttribute('data-de') === m.id) { fechaGlMenu(); return; }
    clear(glMenuEl);
    glMenuEl.setAttribute('data-de', m.id);
    var est = grupoEstado() || {};
    var naLuta = current === 'battle' || current === 'roomClear' || current === 'dungeonComplete';
    glMenuEl.appendChild(el('h4', null, esc(m.nome || '') + (m.id === est.lider ? ' <span class="gl-coroa-t">♛</span>' : '')));
    function op(rot, cls, fn) {
      glMenuEl.appendChild(btn(rot, 'btn-mini ' + (cls || 'btn-ghost'), function () { fechaGlMenu(); fn(); }));
    }
    if (!m.eu) {
      op('Mensagem particular', 'btn-ghost', function () { armaSussurro(m.id, m.nome); });
      if (!naLuta && souLider()) {
        op('Passar a liderança', 'btn-gold', function () {
          var r = safe(function () { return Gp().passarLideranca(); }, null);
          toast(r && r.ok ? m.nome + ' agora lidera o grupo.' : textoMotivo(r ? r.motivo : 'ocupado', r && r.motivo === 'sumido' ? m.nome : null),
                r && r.ok ? 'good' : undefined);
        });
        op('Desfazer o grupo', 'btn-warn', function () { confirmaSair(null); });
      } else if (!naLuta) {
        op('Sair do grupo', 'btn-warn', function () { confirmaSair(m.nome); });
      }
    } else if (!naLuta) {
      op('Sair do grupo', 'btn-warn', function () { confirmaSair(nomeParceiro()); });
    } else {
      glMenuEl.appendChild(el('p', 'hub-nota', 'Para sair da batalha, use o menu de pausa (☰).'));
    }
    op('Fechar', 'btn-ghost', function () {});
    var r = card.getBoundingClientRect(), rr = root.getBoundingClientRect();
    glMenuEl.style.top = Math.max(8, Math.min(rr.height - 250, r.top - rr.top)) + 'px';
    glMenuEl.style.right = Math.max(8, rr.right - r.left + 8) + 'px';
    glMenuEl.classList.add('is-on');
  }

  // ------------------------------------------- a mensagem particular (4.4)
  var chatUI = null;               // { log, input, chip } do chat da tela aberta
  var chatAlvo = null;             // { id, nome }: o sussurro armado no chat
  var sussurroAlvo = null;         // o destinatário da ficha de sussurro
  var suHist = null, suInput = null, suInputDe = null;   // a ficha aberta: o histórico e o campo (a linha nova entra sem redesenhar)
  function chatVivo() { return (chatUI && naTelaAberta(chatUI.log)) ? chatUI : null; }
  function linhaSussurro(l) {
    var li = el('div', 'hub-chat-linha chat-sussurro' + (l.meu ? ' is-meu' : '') + (l.sistema ? ' is-falhou' : ''));
    if (l.sistema) li.textContent = l.texto;
    else if (l.meu) li.innerHTML = '→ <b>' + esc(l.nome) + ':</b> ' + esc(l.texto);
    else li.innerHTML = '<b>' + esc(l.nome) + '</b> (particular): ' + esc(l.texto);
    if (!l.meu && !l.sistema) {
      // 03/10: o particular é onde o assédio mais acontece — a linha também se denuncia (js/ui/moderacao.js)
      li.setAttribute('data-de', l.de);
      li.setAttribute('data-nome', l.nome || '');
      li.title = 'toque para responder';
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
    c.input.placeholder = chatAlvo ? 'para ' + chatAlvo.nome + '… (Enter)'
      : naSede ? 'fale com a guilda…  /p praça · /Nome particular' : 'diga algo…  /g guilda · /Nome particular';
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
      if (!txtG) { toast('Escreva a mensagem depois do /g — por exemplo: /g bora descer?'); return false; }
      if (!R || !R.falarGuilda || !R.falarGuilda(txtG)) { toast(textoMotivo('privado', null)); return false; }
      if (linha) linha('[Guilda] ' + (j.nome || 'você'), txtG, '#7fc8ff');
      if (sedeDentro()) safe(function () { return JOGO.Hub.fala(null, txtG); }, null);   // no salão, o meu balão também
      return true;
    }
    // 04/10: dentro da sede a fala sem barra é da guilda — "/p texto" ainda alcança a praça
    var mP = sedeDentro() ? /^p(?:\s+([\s\S]*))?$/i.exec(corpo) : null;
    if (mP) {
      var txtP0 = (mP[1] || '').trim();
      if (!txtP0) { toast('Escreva a mensagem depois do /p — ela vai para a praça.'); return false; }
      if (!R || !R.falar || !R.falar(txtP0)) return false;
      if (linha) linha('[Praça] ' + (j.nome || 'você'), txtP0, '#9bd06a');
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
      toast(pedaco ? 'Ninguém chamado ' + pedaco + ' por perto nem entre os amigos online.'
                   : 'Use /Nome mensagem (particular) ou /g mensagem (guilda).');
      return false;
    }
    if (achado.conta && JOGO.Amigos && JOGO.Amigos.ehInimigo(achado.conta)) {
      toast(achado.nome + ' está na sua lista de inimigos: sem mensagem particular.');
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
    var body = sheetShell('Mensagem particular', 'para ' + esc(a.nome));
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
    inp.placeholder = 'mensagem para ' + a.nome + '…';
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
    body.appendChild(btn('Mandar', 'btn-primary btn-block', manda));
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
      return '<b>Escolha onde nascer</b> — toque numa das suas casas douradas. ' +
             esc(nomeParceiro()) + ' escolhe as dele ao mesmo tempo, de casas diferentes.';
    }
    return '<b>Escolha onde nascer</b> — toque numa das quatro casas douradas. ' +
           'O segundo herói nasce ao acaso perto de você.';
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
          ? 'Sem resposta do servidor — a rodada ' + sal.rodada + ' espera, tentando de novo…'
          : 'A rodada ' + sal.rodada + ' vem do servidor…');
      }
      return el('div', 'bt-wait', 'Aguarde…');
    }
    if (modoRede() && (u.kind === 'hero' || u.kind === 'fusion')) {
      if (donoDe(u) === 'parceiro') {
        bt.espera = el('div', 'bt-wait bt-espera', '');
        pintaEspera();
        return bt.espera;
      }
      // 12/09: quem caiu nao e jogado pela IA — o turno dele PASSA
      if (u.ia && u.dono && u.dono !== meuIdRede()) {
        return el('div', 'bt-wait', esc(nomeDoDono(u.dono)) + ' está fora — o turno passa.');
      }
      // o outro lado me deu por fora (um engasgo de conexão): o MEU turno passa
      // até a conexão se acertar — dizer isso em vez de congelar calado
      if (u.ia && u.dono && u.dono === meuIdRede()) {
        return el('div', 'bt-wait', 'Sua conexão engasgou — o turno passa até ela se acertar.');
      }
    }
    return el('div', 'bt-wait', 'Turno de ' + esc(u.name || '') + '…');
  }
  /* a derrota numa descida de grupo (4.8) */
  function derrotaGrupo(acts) {
    var nome = nomeParceiro();
    if (emGrupo() && souLider()) {
      acts.appendChild(btn('Descer de novo com ' + esc(nome), 'btn-primary btn-big', function () {
        var dg = safe(function () { return G().dungeonId; }, null);
        var r = safe(function () { return Gp().descer(dg); }, null);
        if (!r || !r.ok) toast(textoMotivo(r ? r.motivo : 'ocupado', r && r.motivo === 'sumido' ? nome : null));
        else toast('Chamando ' + nome + '…');
      }));
    } else if (emGrupo()) {
      acts.appendChild(btn('Esperando ' + esc(nome) + '…', 'btn-primary btn-big is-apagado', function () {
        toast('Quem lidera (' + nome + ') decide se vocês descem de novo.');
      }));
    }
    acts.appendChild(btn('Voltar ao acampamento', 'btn-ghost', function () {
      safe(function () { G().restart(); }, null);
      navTo('hub');
    }));
  }
  function pintaEspera() {
    if (!bt.espera || !bt.espera.isConnected) return;
    var ses = coopSessao();
    var u = activeUnit();
    var nome = nomeDoDono(u && u.dono);
    var resta = '';
    if (ses && ses.esperando && ses.esperando.prazo) {
      var agora = safe(function () { return Cp()._agora(); }, null) || Date.now();
      resta = ' ' + relogioTxt(ses.esperando.prazo - agora);
    }
    var txt = '<b>Vez de ' + esc(nome) + '</b> — esperando o lance…' + resta;
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
      if (!a.parceiroIA && ses.parceiroIA) toast(nome + ' caiu — o turno dele passa até voltar.');
      if (!a.sincronizando && ses.sincronizando) {
        // 19/09: na guerra a foto vem de quem MANDA, que tem nome (A1, A2, B1, B2 pela ordem — pode ser da outra guilda)
        var quem = ses.tipo === 'duelo' ? nome : (ses.tipo === 'guerra' && ses.guerra ? ses.guerra.autoridadeNome : null);
        toast(quem ? 'Sincronizando com ' + quem + '…' : 'Sincronizando com quem lidera…');
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
    var rede = !!(lastRewards && lastRewards.rede) || !!(est && est.descidaGrupo);
    if (!rede) return false;
    var nome = emGrupo() ? nomeParceiro()
             : ((est && est.ultimoParceiro && est.ultimoParceiro.nome) || 'O parceiro');
    function voltaSo() {
      safe(function () { G().restart(); return true; }, null);
      navTo('hub');
    }
    if (fim) {
      foot.appendChild(btn('Voltar ao acampamento', 'btn-primary', voltaSo));
      return 'fim';
    }
    var acabou = !emGrupo() || !!(lastRewards && lastRewards.descidaAcabou) || !!(est && est.descidaAcabou);
    if (acabou) {
      foot.appendChild(el('p', 'foot-count', esc(nome) + ' não voltou — a descida acabou.'));
      foot.appendChild(btn('Voltar ao Acampamento', 'btn-primary', voltaSo));
      return 'acabou';
    }
    foot.appendChild(btn('Voltar ao acampamento', 'btn-ghost', function () {
      confirmSheet('Voltar ao acampamento?', 'A descida acaba para vocês dois — o grupo continua.', function () {
        safe(function () { Gp().subir('voltou'); return true; }, null);
      });
    }));
    if (souLider()) {
      foot.appendChild(btn('Próxima sala (com ' + esc(nome) + ')', 'btn-primary', function () {
        if (!safe(function () { return Cp().proxima(); }, false)) toast('Não deu para avançar.');
      }));
      return 'lider';
    }
    var ses = coopSessao();
    if (ses && ses.proximaLiberada) {
      // 11/09 (revisão): quem lidera já está na antessala da próxima sala, esperando
      foot.appendChild(el('p', 'foot-count', esc(nome) + ' abriu a próxima sala e espera você lá.'));
      foot.appendChild(btn('Seguir para a próxima sala', 'btn-primary', function () {
        if (!safe(function () { return Cp().seguir(); }, false)) toast('Não deu para seguir.');
      }));
    } else {
      foot.appendChild(btn('Esperando ' + esc(nome) + ' abrir a próxima sala…', 'btn-primary is-apagado', function () {
        toast('Quem lidera (' + nome + ') abre a próxima sala.');
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
    var nome = (est.oponente && est.oponente.nome) || 'o outro lado';
    // 14/09: por aqui só passa o desafio amistoso (a Arena e o Campo escolhem sozinhos)
    var body = sheetShell('Desafio amistoso com ' + nome, est.escolhi
      ? 'A sua dupla está guardada. Mapa: A Praça — a coroa não muda.'
      : 'Mapa: A Praça — a coroa não muda. Escolha 1 ou 2 heróis seus: ' + esc(nome) + ' não vê a sua dupla até as duas estarem escolhidas.');
    sheetName = 'dueloRede';
    var caixa = el('div', 'ms-caixa du-rede');
    body.appendChild(caixa);
    if (est.fase === 'batalha') {
      caixa.appendChild(el('p', 'du-espera', (est.modo === 'desafio' ? 'Mapa: <b>' : 'Arena sorteada: <b>') +
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
        vbar.title = vd.hp + '/' + vd.max + ' PV';
        card.appendChild(vbar);
      }
      if (clicavel) {
        tap(card, function () {
          var i = dueloEscolha.indexOf(hid);
          if (i >= 0) dueloEscolha.splice(i, 1);
          else if (dueloEscolha.length < 2) dueloEscolha.push(hid);
          else { toast('A dupla é de dois, no máximo.'); return; }
          sheetDueloRede();
        });
      }
      return card;
    }
    var fila = el('div', 'av-fila');
    if (est.escolhi) {
      (est.minhaDupla || []).forEach(function (hid) { fila.appendChild(carta(hid, true, false)); });
      caixa.appendChild(fila);
      caixa.appendChild(el('p', 'du-espera', est.eleEscolheu ? 'Revelando as duplas…'
        : 'Esperando ' + esc(nome) + ' escolher… <b class="du-relogio"></b>'));
    } else {
      var herois = safe(function () { return Dl().herois(); }, []) || [];
      dueloEscolha = dueloEscolha.filter(function (h) { return herois.indexOf(h) >= 0; });
      herois.forEach(function (hid) { fila.appendChild(carta(hid, dueloEscolha.indexOf(hid) >= 0, true)); });
      if (!herois.length) fila.appendChild(el('p', 'empty', 'Nenhum herói seu pode duelar.'));
      caixa.appendChild(fila);
      caixa.appendChild(el('p', 'du-espera', 'Tempo para escolher: <b class="du-relogio"></b>'));
      var pronto = dueloEscolha.length >= 1;
      var rotuloPronto = 'Pronto' + (pronto ? ' (' + dueloEscolha.length + ')' : '');
      var bPronto = btn(rotuloPronto, 'btn-primary btn-block du-pronto' + (pronto ? '' : ' is-off'), function () {
        // 14/09: herói a 0 PV não entra no duelo — o botão espera como a porta da sala
        var evD = dueloEscolha.length ? safe(function () { return G().esperaVida(dueloEscolha.slice()); }, null) : null;
        if (evD) { toast(textoEsperaVida(evD) + ' — ou beba uma poção.'); return; }
        var r = safe(function () { return Dl().escolher(dueloEscolha.slice()); }, null);
        if (r && r.ok && r.esperando) { vidaTique(); return; }
        if (r && !r.ok && r.motivo === 'vida-zero') {
          toast('Esse herói está sem vida: espere ' + (r.esperaS || 1) + ' s ou beba uma poção.');
          return;
        }
        if (!r || !r.ok) toast(textoMotivo(r ? r.motivo : 'ocupado', null));
      });
      bPronto.setAttribute('data-rotulo', rotuloPronto);
      caixa.appendChild(bPronto);
      caixa.appendChild(vidaBloco('duelo'));   // 14/09: a vida dos heróis que podem duelar, com as poções
      vidaTique();
    }
    caixa.appendChild(btn('Desistir do duelo', 'btn-ghost btn-block', function () {
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
    return (classes || []).map(function (c) { return className((c && c.classId) || '?') + ' nv ' + ((c && c.nivel) || 1); }).join(' e ');
  }
  function nomeHeroiNv(hid) { var h = hero(hid) || {}; return className(h.classId || hid) + ' nv ' + (h.level || 1); }

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
    var body = sheetShell(op.titulo || 'Escolha os dois heróis', op.sub || 'Toque na ordem: o 1º e o 2º.');
    sheetName = 'escolheDupla';
    var caixa = el('div', 'ms-caixa du-rede dupla-escolha');
    body.appendChild(caixa);
    var fila = el('div', 'av-fila');
    herois.forEach(function (hid) {
      fila.appendChild(cartaDupla(hid, escolhaDupla.ids.indexOf(hid), function () {
        var j = escolhaDupla.ids.indexOf(hid);
        if (j >= 0) escolhaDupla.ids.splice(j, 1);
        else if (escolhaDupla.ids.length < 2) escolhaDupla.ids.push(hid);
        else { toast('São dois: tire um antes de pôr outro.'); return; }
        sheetEscolheDupla();
      }));
    });
    if (!herois.length) fila.appendChild(el('p', 'empty', 'Nenhum herói seu pode lutar.'));
    caixa.appendChild(fila);
    if (herois.length === 1) caixa.appendChild(el('p', 'du-espera', 'Você só tem um herói que pode lutar: ele vai sozinho.'));
    else if (op.ordem) caixa.appendChild(el('p', 'du-espera', 'O <b>1º</b> é o que todos veem; o <b>2º</b> fica em segredo até a luta.'));
    var pronto = precisa > 0 && escolhaDupla.ids.length >= precisa;
    var rot = (op.rotulo || 'Pronto') + (pronto ? '' : ' (' + escolhaDupla.ids.length + '/' + precisa + ')');
    caixa.appendChild(btn(rot, 'btn-primary btn-block dupla-pronto' + (pronto ? '' : ' is-off'), function () {
      if (!pronto) { toast(precisa > 1 ? 'Escolha os dois heróis.' : 'Escolha o herói.'); return; }
      var ev = safe(function () { return G().esperaVida(escolhaDupla.ids.slice()); }, null);
      if (ev) { toast(textoEsperaVida(ev) + ' — ou beba uma poção.'); return; }
      if (typeof op.aoEscolher === 'function') safe(function () { return op.aoEscolher(escolhaDupla.ids.slice()); }, null);
    }));
    caixa.appendChild(btn('Cancelar', 'btn-ghost btn-block', closeSheet));
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
      vbar.title = vd.hp + '/' + vd.max + ' PV';
      card.appendChild(vbar);
    }
    tap(card, aoTocar);
    return card;
  }

  // ---- a Arena: o bloco do painel do lugar, a inscrição e o quadro
  function textoArena(r) {
    if (!r) return 'A Arena não respondeu.';
    var m = r.motivo;
    if (m === 'vida-zero') return 'Um herói da dupla está sem vida' + (r.esperaS ? ': espere ' + r.esperaS + ' s' : '') + ' ou beba uma poção.';
    if (m === 'vida-zero-alvo') return 'Um herói dessa inscrição está sem vida agora.';
    if (m === 'paridade') return 'A diferença de nível entre os heróis mais fortes passa de ' + paridadeArena() + ': não vale.';
    if (m === 'sem-inscricao') return 'Essa inscrição saiu do quadro.';
    if (m === 'inscrito') return 'Saia da sua inscrição antes de desafiar outra.';
    if (m === 'casada') return 'Você já tem uma partida da Arena em andamento.';
    if (m === 'sem-partida') return 'O prazo da partida passou.';
    if (r.erro && ['sem-sessao', 'arquivo', 'servidor', 'rede', 'arena'].indexOf(m) >= 0) return r.erro;
    return textoMotivo(m, null);
  }
  function painelArena(p) {
    var A = Ar();
    if (!A) return;
    var e = A.estado();
    var caixa = el('div', 'arena-bloco');
    p.appendChild(caixa);
    if (e.desligada) { caixa.appendChild(el('p', 'hub-nota arena-off', '⚔ ' + esc(e.desligada))); return; }
    if (e.fase === 'livre') {
      caixa.appendChild(btn('Inscrever minha dupla', 'btn-gold btn-block arena-inscrever', pedeInscricao));
    } else if (e.fase === 'inscrito') {
      caixa.appendChild(el('p', 'hub-nota arena-inscrito', 'Inscrito com <b>' + esc(nomesDupla(e.classes)) +
        '</b> · esperando há <b class="arena-relogio" data-desde="' + e.desdeMs + '">' + relogioTxt(agoraArena() - e.desdeMs) +
        '</b>. Pode andar pela praça.'));
      caixa.appendChild(btn('Sair da inscrição', 'btn-warn btn-block arena-sair', function () {
        A.sair();
        toast('Você saiu do quadro da Arena.');
      }));
    } else if (e.fase === 'casada') {
      caixa.appendChild(btn('Ver o adversário encontrado', 'btn-gold btn-block', function () { mostraArenaCasada(A.estado()); }));
    } else if (e.fase === 'pronta') {
      caixa.appendChild(el('p', 'hub-nota', 'Partida pronta — a luta abre em instantes…'));
    }
    caixa.appendChild(btn('Ver o quadro de inscritos', 'btn-ghost btn-block arena-ver-quadro', function () { openSheet('arenaQuadro'); }));
  }
  function pedeInscricao() {
    openSheet('escolheDupla', { titulo: 'Inscrição na Arena', rotulo: 'Inscrever no quadro',
      sub: 'Escolha os dois heróis, em ordem. Quem olhar o quadro vê as duas classes — e quem desafiar mostra as dele. Vale coroa.',
      inicial: selHeroes.slice(),
      aoEscolher: function (ids) {
        return Ar().inscrever(ids).then(function (r) {
          if (r.ok) { closeSheet(); toast('A sua dupla está no quadro da Arena. Pode andar pela praça esperando.', 'good'); repintaLugar(); }
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
    var body = sheetShell('Quadro da Arena', 'Quem espera desafio. Vale coroa: até ' + paridadeArena() + ' níveis entre os heróis mais fortes de cada lado.');
    sheetName = 'arenaQuadro';
    var caixa = el('div', 'ms-caixa arena-quadro');
    body.appendChild(caixa);
    var e = A ? A.estado() : { desligada: 'A Arena não carregou.' };
    if (e.desligada) { caixa.appendChild(el('p', 'empty arena-off', esc(e.desligada))); return; }
    var meu = forteDeIds(selHeroes);
    caixa.appendChild(el('p', 'du-espera', 'A sua dupla escolhida chega a <b>nv ' + meu + '</b>: quem está fora da paridade fica apagado.'));
    if (e.fase === 'livre') caixa.appendChild(btn('Inscrever minha dupla', 'btn-gold btn-block', pedeInscricao));
    else if (e.fase === 'inscrito') caixa.appendChild(el('p', 'hub-nota', 'Você está no quadro — espere um desafio.'));
    var lista = el('div', 'aq-lista');
    caixa.appendChild(lista);
    if (quadroArena.lista === null) lista.appendChild(el('p', 'empty', quadroArena.erro ? esc(quadroArena.erro) : 'Lendo o quadro…'));
    else if (!quadroArena.lista.length) lista.appendChild(el('p', 'empty', 'Ninguém inscrito agora. Inscreva a sua dupla e espere um desafio!'));
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
      else quadroArena.erro = (r && r.erro) || 'o servidor não respondeu';
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
    tx.appendChild(el('span', 'aq-desde', 'esperando há ' + relogioTxt(agoraArena() - x.desdeMs)));
    ln.appendChild(tx);
    if (x.eu) ln.appendChild(el('span', 'aq-tag', 'sua inscrição'));
    else if (fora) {
      ln.appendChild(btn('Fora da paridade', 'btn-mini btn-ghost is-apagado aq-desafiar', function () {
        toast('A diferença de nível passa de ' + par + ' (você nv ' + meu + ', ' + x.nome + ' nv ' + x.nivel + '): não vale.');
      }));
    } else if (e.fase !== 'livre') {
      ln.appendChild(btn('Desafiar', 'btn-mini btn-ghost is-apagado aq-desafiar', function () {
        toast(e.fase === 'inscrito' ? 'Saia da sua inscrição antes de desafiar outra.' : 'Você já tem uma partida da Arena em andamento.');
      }));
    } else ln.appendChild(btn('Desafiar', 'btn-mini btn-gold aq-desafiar', function () { pedeDesafioArena(x); }));
    return ln;
  }
  function pedeDesafioArena(x) {
    openSheet('escolheDupla', { titulo: 'Desafiar ' + x.nome, rotulo: 'Desafiar',
      sub: 'A dupla de ' + esc(x.nome) + ': <b>' + esc(nomesDupla(x.classes)) + '</b> (nv ' + x.nivel + '). Escolha os seus dois — ' +
           esc(x.nome) + ' vê as suas classes antes de confirmar.',
      inicial: selHeroes.slice(),
      aoEscolher: function (ids) {
        var nv = forteDeIds(ids);
        if (Math.abs(nv - x.nivel) > paridadeArena()) {
          toast('Com essa dupla (nv ' + nv + ') a diferença para nv ' + x.nivel + ' passa do limite.');
          return null;
        }
        return Ar().desafiar(x.conta, ids).then(function (r) {
          if (r.ok) { closeSheet(); toast('Desafio enviado a ' + x.nome + '. Os dois confirmam em 30 s.', 'good'); }
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
    if (!p) { toast('Arena: adversário encontrado — confirme o duelo na praça!'); return; }
    painelConv = { tipo: 'arena' };
    pintaArenaCasada(p, e);
    if (sheetName) toast('Adversário encontrado na Arena — veja o painel');
  }
  function pintaArenaCasada(p, e) {
    clear(p);
    p.classList.add('arena-casada');
    var ad = e.adversario || { classes: [] };
    cabecalhoPainel(p, ((ad.classes[0] || {}).classId) || 'sumo', 'neutro',
      'Adversário encontrado: <b>' + esc(ad.nome) + '</b> · nv ' + ad.nivel + ' · ' + esc(coroaNome(ad.brasa)),
      e.papel === 'inscrito' ? 'desafiou a sua inscrição' : 'você desafiou');
    p.appendChild(el('p', 'hub-nota', 'A dupla de ' + esc(ad.nome) + ': <b>' + esc(nomesDupla(ad.classes)) + '</b>.<br>A sua: <b>' +
      esc(nomesDupla(e.classes)) + '</b>. Vale coroa; o mapa é sorteado.'));
    p.appendChild(barraPrazo(e.prazoMs, agoraArena));
    var resta = Math.max(0, Math.ceil((e.prazoMs - agoraArena()) / 1000));
    if (e.confirmei) {
      p.appendChild(el('p', 'du-espera', 'Você confirmou. Esperando ' + esc(ad.nome) + '… <b class="arena-relogio" data-prazo="' +
        e.prazoMs + '">' + resta + ' s</b>'));
      p.appendChild(btn('Desistir', 'btn-ghost btn-block', function () { Ar().recusar(); fechaPainel(); }));
    } else {
      var duo = el('div', 'pn-duplo');
      var bOk = btn('Confirmar (' + resta + ' s)', 'btn-primary arena-confirma', function () {
        Ar().confirmar().then(function (r) { if (!r.ok) toast(textoArena(r)); });
      });
      bOk.setAttribute('data-prazo', String(e.prazoMs));
      duo.appendChild(bOk);
      duo.appendChild(btn('Recusar', 'btn-ghost arena-recusa', function () { Ar().recusar(); fechaPainel(); }));
      p.appendChild(duo);
    }
    if (e.eleConfirmou) p.appendChild(el('p', 'du-espera', esc(ad.nome) + ' já confirmou.'));
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
    if (e && e.fase === 'inscrito') txt = '⚔ Arena · inscrito ' + relogioTxt(agoraArena() - e.desdeMs);
    else if (e && e.fase === 'casada') txt = '⚔ Arena · adversário encontrado!';
    else if (e && e.fase === 'pronta') txt = '⚔ Arena · abrindo a luta…';
    if (campoDentro()) txt = (txt ? txt + ' · ' : '') + '☠ Campo de PvP';
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

  // ---- a guerra de guilda 2×2 (15/09): o bloco da Sede, a escolha das duplas, os adversários, o topo e o fim
  /* O dono: "a guerra de guild que é 2x2 de cada guild é na sede de guild, isso dá pontos de experiência para guild".
   * Quem decide é o JOGO.Guerra (grupo.js: a fila no servidor) e a batalha é do Coop; aqui só se desenha. */
  function Gu() { return JOGO.Guerra || null; }
  function agoraGuerra() { return safe(function () { return Gu()._agora(); }, Date.now()); }
  function nomesIds(ids) { return (ids || []).map(nomeHeroiNv).join(' e '); }
  function textoGuerra(r) {
    if (!r) return 'A guerra de guilda não respondeu.';
    var m = r.motivo;
    var T = {
      'sem-grupo': 'Forme um grupo de 2 com alguém da sua guilda.',
      'nao-lider': 'Quem inscreve o grupo na guerra é quem lidera.',
      'sem-conta-par': 'O servidor ainda não conferiu a conta do seu parceiro — ele precisa entrar na conta e recarregar a página.',
      'sem-guilda': 'A guerra é de guilda: vocês dois precisam estar numa guilda.',
      'outra-guilda': 'Os dois do grupo precisam ser da mesma guilda.',
      'sem-convite': 'O prazo para pôr a sua dupla passou — peça para quem lidera inscrever de novo.',
      'arena': 'Saia do quadro da Arena antes de entrar na guerra.',
      'casada': 'Já há uma guerra em andamento para vocês.',
      'inscrito': 'Um de vocês já está noutra inscrição da guerra.',
      'sem-partida': 'O prazo da guerra passou.',
      'vida-zero': 'Um herói da dupla está sem vida' + (r.esperaS ? ': espere ' + r.esperaS + ' s' : '') + ' ou beba uma poção.',
      // 19/09: os motivos curtos do contrato servidor↔jogo da guerra
      'dois': 'Escolha os dois heróis que vão à guerra, em ordem.',
      'mestre': 'O Mestre não vai à guerra de guilda.',
      'sem-estado-parceiro': 'O servidor ainda não tem o estado do seu parceiro — ele precisa entrar na conta e recarregar a página.',
      'sem-estado-lider': 'O servidor ainda não tem o estado de quem lidera — ele precisa entrar na conta e recarregar a página.',
      'mesmo-dono': 'Vocês dois estão com o mesmo nome na Rede — um de vocês precisa recarregar a página.',
      'parceiro': 'O parceiro não é o do seu grupo — forme o grupo de novo.',
      'desistencia-alheia': 'Só quem sai declara a própria saída.',
      'marca-sem-prova': 'O servidor não viu a queda ou a saída marcada no registro — a guerra espera o registro de outro jogador.',
      'wo-sem-prova': 'O servidor não viu a queda do outro lado: o W.O. valeu só a vida da luta, sem XP.',
      'paridade': 'A diferença de nível entre as duplas passou do limite da guerra.',
      'teto': 'O teto de guerras de hoje já foi — esta não rende XP.',
      'largada': 'Você saiu da última luta sem terminar: os heróis dela voltam do zero.'
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
    caixa.appendChild(el('h4', 'guerra-tit', '⚔ Guerra de Guilda 2×2'));
    caixa.appendChild(el('p', 'hub-nota guerra-explica', 'Dois da mesma guilda, cada um com a sua dupla, contra dois de outra guilda — ' +
      'oito heróis no Salão da Sede. A guilda que vence ganha <b>+' + W.XP + ' XP</b>; a coroa não muda.'));
    if (e.desligada) { caixa.appendChild(el('p', 'hub-nota guerra-off', '⚔ ' + esc(e.desligada))); return; }
    var nomePar = esc(nomeParceiro());
    // 19/09: a partida 'pronta'/'em-luta' já entregue ao Coop (a guerra acabou aqui e o servidor ainda assenta os
    // fechamentos) não é "abre em instantes" nem prende a fila: diz o que é, e a inscrição volta quando ela assentar
    var esperandoServidor = (e.fase === 'pronta' || e.fase === 'em-luta') && e.entregue;
    if (esperandoServidor) {
      caixa.appendChild(el('p', 'hub-nota guerra-conferindo', 'A última guerra ainda está sendo conferida pelo servidor — a inscrição volta em instantes…'));
      return;
    }
    if (e.fase === 'livre' || e.fase === 'fechada') {
      if (!emGrupo()) caixa.appendChild(el('p', 'hub-nota guerra-sem-grupo', 'Forme um grupo de 2 com alguém da sua guilda para entrar na fila.'));
      else if (souLider()) caixa.appendChild(btn('Inscrever o grupo na guerra', 'btn-gold btn-block guerra-inscrever', pedeGuerraInscricao));
      else caixa.appendChild(el('p', 'hub-nota guerra-espera-lider', 'Quem lidera o grupo (<b>' + nomePar + '</b>) inscreve; aí você escolhe a sua dupla.'));
    } else if (e.fase === 'aguardando') {
      caixa.appendChild(el('p', 'hub-nota guerra-aguardando', 'Inscrito com <b>' + esc(nomesIds(e.herois)) + '</b> · esperando <b>' +
        esc((e.parceiro || {}).nome || nomeParceiro()) + '</b> escolher a dupla dele…'));
      caixa.appendChild(btn('Sair da fila', 'btn-warn btn-block guerra-sair', function () { W.sair(); toast('Vocês saíram da fila da guerra.'); }));
    } else if (e.fase === 'convite') {
      caixa.appendChild(el('p', 'hub-nota guerra-convite', '<b>' + esc((e.lider || {}).nome || nomeParceiro()) +
        '</b> inscreveu o grupo na guerra de guilda. Escolha os dois heróis que você leva.'));
      caixa.appendChild(btn('Escolher a minha dupla', 'btn-gold btn-block guerra-juntar', pedeGuerraJuntar));
      caixa.appendChild(btn('Não vou', 'btn-ghost btn-block guerra-sair', function () { W.sair(); }));
    } else if (e.fase === 'inscrito') {
      caixa.appendChild(el('p', 'hub-nota guerra-inscrito', 'Na fila com <b>' + esc(nomesIds(e.herois)) + '</b> · há <b class="arena-relogio" data-desde="' +
        e.desdeMs + '">' + relogioTxt(agoraGuerra() - e.desdeMs) + '</b>. Procurando uma dupla de outra guilda (até ' + W.PARIDADE +
        ' níveis de diferença)…'));
      caixa.appendChild(btn('Sair da fila', 'btn-warn btn-block guerra-sair', function () { W.sair(); toast('Vocês saíram da fila da guerra.'); }));
    } else if (e.fase === 'casada') {
      pintaGuerraCasada(caixa, e);
    } else if (e.fase === 'pronta') {
      caixa.appendChild(el('p', 'hub-nota guerra-pronta', 'Os quatro confirmaram — a guerra abre em instantes…'));
    } else if (e.fase === 'em-luta') {
      caixa.appendChild(el('p', 'hub-nota guerra-em-luta', 'Há uma guerra desta conta em andamento noutra página — ela fecha sozinha ao terminar.'));
    }
  }
  function nomesConfirma(lista) {
    return (lista || []).map(function (x) { return esc(x.nome) + (x.confirmou ? ' ✓' : ''); }).join(' e ');
  }
  function pintaGuerraCasada(p, e) {
    var W = Gu(), gAd = (e.guildas || {})[e.lado === 'A' ? 'B' : 'A'] || {};
    var box = el('div', 'guerra-casada');
    box.appendChild(el('p', 'guerra-achados', 'Adversários encontrados: <b>' + esc(gAd.emblema || '⚑') + ' ' + esc(gAd.nome || '?') + '</b>'));
    box.appendChild(el('p', 'hub-nota guerra-nomes', nomesConfirma(e.adversarios) + ' — as duplas deles só aparecem na batalha.'));
    box.appendChild(el('p', 'hub-nota guerra-aliados', 'Do seu lado: ' + nomesConfirma(e.aliados) + '.'));
    box.appendChild(barraPrazo(e.prazoMs, agoraGuerra));
    // 19/09: os tetos de hoje já estouraram (o servidor manda `semXp`): quem confirma sabe ANTES que não rende XP
    if (e.semXp) box.appendChild(el('p', 'hub-nota guerra-sem-xp', '⚠ Esta guerra <b>não vai render XP</b>: o teto de guerras de hoje (entre essas guildas, ou da sua guilda) já foi. A vida dos heróis vale do mesmo jeito.'));
    var resta = Math.max(0, Math.ceil((e.prazoMs - agoraGuerra()) / 1000));
    if (e.confirmei) {
      box.appendChild(el('p', 'du-espera', 'Você confirmou. Esperando os outros… <b class="arena-relogio" data-prazo="' + e.prazoMs + '">' +
        resta + ' s</b>'));
      box.appendChild(btn('Desistir', 'btn-ghost btn-block guerra-recusa', function () { W.recusar(); fechaPainelGuerra(); }));
    } else {
      var duo = el('div', 'pn-duplo');
      var bOk = btn('Confirmar (' + resta + ' s)', 'btn-primary arena-confirma guerra-confirma', function () {
        W.confirmar().then(function (r) { if (!r.ok) toast(textoGuerra(r)); });
      });
      bOk.setAttribute('data-prazo', String(e.prazoMs));
      duo.appendChild(bOk);
      duo.appendChild(btn('Recusar', 'btn-ghost guerra-recusa', function () { W.recusar(); fechaPainelGuerra(); }));
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
    if (!p) { toast('Guerra de guilda: adversários encontrados — confirme em 30 s!'); return; }
    painelConv = { tipo: 'guerra' };
    clear(p);
    p.appendChild(el('h3', null, 'Guerra de Guilda'));
    pintaGuerraCasada(p, e);
    if (sheetName) toast('Adversários encontrados na guerra de guilda — veja o painel');
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
      if (e.fase === 'casada' && pv) { clear(pv); pv.appendChild(el('h3', null, 'Guerra de Guilda')); pintaGuerraCasada(pv, e); }
      else fechaPainel();
    }
    if (painelModo === 'lugar' && painelLugar && lugarDaGuerra(painelLugar)) repintaLugar();
    if (current === 'duelFim' && lastDuelFim && lastDuelFim.guerra) buildDuelFim(lastDuelFim);
  }
  function pedeGuerraInscricao() {
    openSheet('escolheDupla', { titulo: 'Guerra de Guilda — a sua dupla', rotulo: 'Entrar na fila',
      sub: 'Escolha os dois heróis que vão à guerra, em ordem. ' + nomeParceiro() + ' escolhe a dupla dele em seguida. ' +
           'As duplas dos adversários só aparecem na batalha.',
      inicial: selHeroes.slice(),
      aoEscolher: function (ids) {
        return Gu().inscrever(ids).then(function (r) {
          if (r.ok) { closeSheet(); toast('Grupo inscrito. Esperando ' + nomeParceiro() + ' escolher a dupla dele.', 'good'); repintaLugar(); }
          else toast(textoGuerra(r));
          return r;
        });
      } });
  }
  function pedeGuerraJuntar() {
    openSheet('escolheDupla', { titulo: 'Guerra de Guilda — a sua dupla', rotulo: 'Entrar na fila',
      sub: 'Escolha os dois heróis que vão à guerra, em ordem. As duplas dos adversários só aparecem na batalha.',
      inicial: selHeroes.slice(),
      aoEscolher: function (ids) {
        return Gu().juntar(ids).then(function (r) {
          if (r.ok) { closeSheet(); toast(r.fase === 'casada' ? 'Adversários encontrados — confirme!' : 'A sua dupla está na fila da guerra.', 'good'); repintaLugar(); }
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
        '</b><span class="bg-guilda">' + esc(g.nome || ('Guilda ' + L)) + '</span><span class="bg-nomes">' + nomes + '</span></div>';
    }
    var html = lado(meu) + '<i class="bg-vs">×</i>' + lado(meu === 'A' ? 'B' : 'A');
    // 19/09: quem manda (a foto de resgate) marcado com a coroa, e os DOIS adversários fora = a contagem do W.O.
    // ("o lado deles tem N s para voltar") — antes era um minuto de tela parada sem dizer quanto faltava
    if (gq && gq.wo && gq.wo.desde) {
      var ag = safe(function () { return Cp()._agora(); }, Date.now());
      var sg = Math.max(0, Math.ceil((gq.wo.desde + gq.wo.prazo - ag) / 1000));
      html += '<span class="bg-wo">o lado deles tem <b>' + sg + ' s</b> para voltar</span>';
    }
    if (bt.guerra.__html !== html) { bt.guerra.innerHTML = html; bt.guerra.__html = html; }
  }
  function porqueSemXp(res) {
    var m = res.motivo;
    if (res.fase === 'recusada') return 'A luta não bateu com a conferência do servidor — a guerra não rendeu XP.';
    if (res.fase === 'nao-conferida') return 'A batalha sincronizou por foto e ninguém mandou um registro limpo — a guerra não rendeu XP.';
    if (m === 'empate') return 'Empate — nenhuma guilda ganha XP.';
    if (m === 'sem-fim') return 'A guerra ficou sem fim conferido (ninguém mandou um registro com o fim em 2 min): vale a vida do ponto em que parou, sem XP.';
    if (m === 'wo-sem-prova') return 'O servidor não viu a queda do outro lado: o W.O. valeu só a vida da luta, sem XP.';
    if (m === 'teto') return 'A guerra valeu, mas sem XP: o teto de guerras de hoje (entre essas guildas, ou da guilda) já foi.';
    if (m === 'sem-guilda') return 'A guilda vencedora não existe mais — sem XP.';
    return 'Sem XP desta vez.';
  }
  function guerraFim(s, data) {
    var box = el('div', 'game-over du-fim du-rede guerra-fim');
    var gs = data.guildas || {}, meu = data.lado === 'B' ? 'B' : 'A', outro = meu === 'A' ? 'B' : 'A';
    var res = data.resultado;
    var W = Gu(), ult = W ? W.resultado() : null;
    if (ult && ult.gid === data.gid) res = ult;
    if (res && res.gid && data.gid && res.gid !== data.gid) res = null;
    var gV = data.empate ? null : (data.venci ? gs[meu] : gs[outro]);
    box.appendChild(el('h1', null, data.empate ? 'Empate na guerra.' : 'A guilda ' + esc((gV && gV.nome) || '?') + ' venceu!'));
    if (data.wo) {
      box.appendChild(el('p', 'game-sub', data.venci ? 'Os dois adversários saíram do salão — vitória por W.O.' : 'O seu lado ficou fora — derrota por W.O.'));
    }
    var linha;
    if (!res) linha = 'O servidor está conferindo a guerra…';
    else if (res.fase === 'aguardando') {
      // 19/09: a espera do servidor tem três caras — o W.O. sem a prova de queda ainda, o registro sem fim (ou
      // fotografado, ou recusado) esperando o de outro dos quatro; a Autoridade pergunta de novo a cada 5 s
      linha = (data.wo || res.motivo === 'wo') ? 'Esperando o servidor confirmar a queda do outro lado (a prova do relé)…'
            : 'Esperando o registro de outro jogador para conferir a guerra…';
    }
    else if (!res.ok) linha = 'O servidor não conferiu a guerra: ' + (res.erro || 'sem resposta') + '.';
    else if (res.xp > 0 && res.guilda) linha = 'A guilda ' + res.guilda.nome + ' venceu — +' + res.xp + ' XP para a guilda.';
    else linha = porqueSemXp(res);
    box.appendChild(el('p', 'du-valeria guerra-xp', esc(linha)));
    var jog = data.jogadores || [];
    [meu, outro].forEach(function (L) {
      var g = gs[L] || {};
      var nomes = jog.filter(function (j) { return j.lado === L; }).map(function (j) { return esc(j.nome); }).join(' e ');
      var classes = (L === 'A' ? data.duplaA : data.duplaB) || [];
      box.appendChild(el('p', 'game-sub guerra-lado-fim', '<b>' + esc(g.emblema || '⚑') + ' ' + esc(g.nome || ('Guilda ' + L)) + '</b>: ' + nomes +
        (classes.length ? ' · ' + esc(classes.map(function (c) { return className(c); }).join(', ')) : '')));
    });
    box.appendChild(el('p', 'game-sub', 'Salão da Sede · clima: ' + esc(nomeClima(data.clima)) + ' · a coroa não muda na guerra de guilda.'));
    box.appendChild(vidaBloco('fim'));
    box.appendChild(btn('Voltar à Sede', 'btn-primary btn-block', function () {
      // 19/09: fecha a sessão como os outros fins fazem — só trocar de tela deixava o Game em modo 'guerra', o Coop
      // com o gid e a fila da Sede presa em "abre em instantes", sem botão para inscrever de novo até recarregar
      safe(function () { G().restart('hub'); return true; }, null);
      navTo('hub');
    }));
    s.appendChild(box);
  }

  // ---- o Campo de PvP: a entrada, a saída, a dupla do Campo e o toque que ataca
  function painelCampo(p) {
    p.appendChild(el('h3', null, 'Campo de PvP'));
    p.appendChild(el('p', 'hub-nota', 'Só com a <b>coroa ligada</b>; lá dentro ela não desliga. <b>Qualquer um pode te atacar ' +
      'sem aviso</b> — e você também. Vale coroa (até 10 níveis de diferença).'));
    p.appendChild(el('p', 'hub-nota', 'Na entrada você escolhe a dupla do Campo, em ordem: o 1º é a sua aparência lá dentro; ' +
      'o 2º fica em segredo até a luta.'));
    if (emGrupo()) { p.appendChild(el('p', 'hub-nota', 'Saia do grupo para entrar no Campo.')); return; }
    var oculta = resumoCoroaOculta === true;
    p.appendChild(btn(oculta ? 'Ligar a coroa e entrar' : 'Entrar', 'btn-warn btn-block campo-entrar', function () {
      pedeDuplaCampo(oculta, false);
    }));
  }
  function painelCampoSaida(p) {
    p.appendChild(el('h3', null, 'Sair do Campo de PvP'));
    p.appendChild(el('p', 'hub-nota', 'A dupla do Campo: <b>' + esc(campoHud.dupla.map(nomeHeroiNv).join(' e ') || '—') +
      '</b> (o 1º é a sua aparência aqui).'));
    p.appendChild(btn('Trocar dupla', 'btn-ghost btn-block campo-trocar', function () { pedeDuplaCampo(false, true); }));
    p.appendChild(btn('Voltar à praça', 'btn-primary btn-block campo-sair', saiDoCampo));
  }
  function pedeDuplaCampo(ligarCoroa, trocando) {
    openSheet('escolheDupla', { titulo: trocando ? 'Trocar a dupla do Campo' : 'A dupla do Campo de PvP', ordem: true,
      rotulo: trocando ? 'Trocar a dupla' : (ligarCoroa ? 'Ligar a coroa e entrar' : 'Entrar no Campo'),
      sub: 'Toque na ordem. O <b>1º</b> é a aparência que todos veem no Campo; o <b>2º</b> é a surpresa — só aparece na luta.',
      inicial: (campoHud.dupla.length ? campoHud.dupla : selHeroes).slice(),
      aoEscolher: function (ids) { entraNoCampo(ids, ligarCoroa, trocando); } });
  }
  function entraNoCampo(ids, ligarCoroa, trocando) {
    var H = JOGO.Hub;
    if (!H || typeof H.entraCampo !== 'function') { toast('O Campo de PvP ainda está sendo construído.'); return; }
    if (safe(function () { return Dl().estado().fase; }, 'livre') !== 'livre') { toast('Termine o duelo antes.'); return; }
    function vai() {
      campoHud.dupla = safe(function () { return Dl().defineDuplaCampo(ids); }, null) || ids.slice();
      campoHud.dentro = true;
      closeSheet();
      if (painelModo === 'lugar') fechaPainel();
      safe(function () { H.entraCampo({ aparencia: aparenciaDe(campoHud.dupla[0]) }); return true; }, null);
      reanunciaPerfil();
      safe(function () { return JOGO.Rede._tique(); }, null);
      pintaSeloArena();
      toast(trocando ? 'A dupla do Campo mudou.' : 'Você entrou no Campo de PvP. Cuidado: aqui qualquer um ataca.', trocando ? 'good' : 'bad');
    }
    if (ligarCoroa && JOGO.DB && JOGO.DB.definirCoroaOculta) {
      JOGO.DB.definirCoroaOculta(false).then(function () { resumoCoroaOculta = false; vai(); });
    } else vai();
  }
  function saiDoCampo() {
    if (safe(function () { return Dl().estado().fase; }, 'livre') !== 'livre') { toast('Termine a luta antes de sair.'); return; }
    campoHud.dentro = false;
    fechaPainel();
    safe(function () { JOGO.Hub.saiCampo(); return true; }, null);
    reanunciaPerfil();
    safe(function () { return JOGO.Rede._tique(); }, null);
    pintaSeloArena();
    toast('Você voltou à praça.');
  }
  /* ------------------------------------------- A SEDE DA GUILDA POR DENTRO (04/10)
   * Dono: "os jogadores da mesma guild entrar nesse mapa … e lá dentro ser o banco da guild
   * e o pessoal ter um chat". A Sede da praça segue abrindo os menus de sempre e ganhou um
   * botão, "Entrar na sede" — só para quem tem guilda. Lá dentro (Hub.entraSede, a zona é
   * 'sede:<id da guilda>') cinco pontos abrem as MESMAS fichas: banco, cofre e mural são a
   * ficha da guilda já rolada até a parte certa; a mesa do conselho é a fila da guerra; a
   * porta devolve à praça. E o chat sem barra passa a ser o da guilda. */
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
    if (!Gd || !H || typeof H.entraSede !== 'function') { toast('A sede ainda está sendo construída.'); return; }
    if (safe(function () { return Dl().estado().fase; }, 'livre') !== 'livre') { toast('Termine o duelo antes.'); return; }
    // quem diz se você É da guilda é a ficha de agora (o servidor), não o que a tela lembra
    Gd.minha().then(function (g) {
      if (!g || g.id == null) { toast('Só quem é de uma guilda entra na sede.'); return; }
      entraNaSede(g);
    });
  }
  function entraNaSede(g) {
    var info = infoDaSede(g);
    if (!safe(function () { return JOGO.Hub.entraSede(info); }, false)) { toast('Não deu para entrar na sede.'); return; }
    sedeHud.dentro = true;
    sedeHud.g = info;
    closeSheet();
    if (painelModo === 'lugar') fechaPainel();
    reanunciaPerfil();
    safe(function () { return JOGO.Rede._tique(); }, null);
    pintaChip();
    toast('Você entrou na sede da ' + txtGuilda(g.emblema, g.nome) + '. Aqui o chat é da guilda.', 'good');
  }
  function saiDaSede() {
    sedeHud.dentro = false;
    fechaPainel();
    safe(function () { JOGO.Hub.saiSede(); return true; }, null);
    reanunciaPerfil();
    safe(function () { return JOGO.Rede._tique(); }, null);
    pintaChip();
    toast('Você voltou à praça.');
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
      p.appendChild(tituloPainel('Banco da guilda', 'fc-banco'));
      p.appendChild(el('p', 'hub-nota', 'As peças que os membros deixam para emprestar uns aos outros.'));
      p.appendChild(btn('Abrir o banco da guilda', 'btn-primary btn-block sede-ponto', function () { abreGuildaEm('banco'); }));
    } else if (tipo === 'sede-cofre') {
      p.appendChild(tituloPainel('Cofre da guilda', 'fc-guilda'));
      p.appendChild(el('p', 'hub-nota', 'As marcas da guilda: todos doam, só o líder gasta nos bônus.'));
      p.appendChild(btn('Abrir o cofre da guilda', 'btn-primary btn-block sede-ponto', function () { abreGuildaEm('cofre'); }));
    } else if (tipo === 'sede-mural') {
      p.appendChild(tituloPainel('Mural da guilda', 'fc-guilda'));
      p.appendChild(el('p', 'hub-nota', 'A mensagem que o líder e os oficiais deixam para todos.'));
      p.appendChild(btn('Ler o mural', 'btn-primary btn-block sede-ponto', function () { abreGuildaEm('mural'); }));
    } else if (tipo === 'sede-guerra') {
      p.appendChild(tituloPainel('Mesa do conselho', 'fc-guilda'));
      painelGuerra(p);
    } else if (tipo === 'sede-saida') {
      p.appendChild(el('h3', null, 'Sair da sede'));
      p.appendChild(el('p', 'hub-nota', 'A porta dá na praça, em frente à Sede das Guildas.'));
      p.appendChild(btn('Voltar à praça', 'btn-warn btn-block sede-sair', saiDaSede));
    }
  }
  // provas (tests/sede_visita.html): o estado, e o `guilda` que finge a resposta da ficha
  UI._sede = function (guilda) {
    if (guilda !== undefined) resumoGuilda = guilda ? { nome: guilda.nome, emblema: guilda.emblema } : null;
    return { dentro: sedeHud.dentro, g: sedeHud.g, temGuilda: !!resumoGuilda, foco: guildaFoco };
  };
  function reentraCampo() {
    var H = JOGO.Hub;
    if (!campoHud.dentro || !H || typeof H.entraCampo !== 'function' || campoDentro()) return;
    safe(function () { H.entraCampo({ aparencia: aparenciaDe(campoHud.dupla[0]) }); return true; }, null);
    safe(function () { return JOGO.Rede._tique(); }, null);
  }
  function ataqueNoCampo(par) {
    var r = safe(function () { return Dl().atacar(par.id); }, null);
    if (r && r.ok) { toast('Você atacou ' + par.nome + '!', 'bad'); return; }
    var m = r ? r.motivo : 'ocupado';
    if (m === 'vida-zero') toast('A sua dupla está sem vida' + (r.esperaS ? ': espere ' + r.esperaS + ' s' : '') + ' ou beba uma poção.');
    else if (m === 'paridade') toast('A diferença de nível passa de 10 (você nv ' + r.meu + ', ' + par.nome + ' nv ' + r.dele + '): aqui não dá.');
    else if (m === 'alvo-fora' || m === 'alvo-luta') toast(textoMotivo(m, par.nome));
    else toast(textoMotivo(m, null));
  }
  UI._campo = function () { return { dentro: campoHud.dentro, dupla: campoHud.dupla.slice() }; };   // provas

  function aoDueloMudou(est) {
    var p = painelVivo();
    if (p && painelModo === 'convite' && painelConv && painelConv.tipo === 'duelo' &&
        !(est && est.fase === 'desafiado' && est.did === painelConv.did)) fechaPainel();
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
    var nomeOp = (typeof op === 'string' ? op : op.nome) || 'O outro lado';
    var tit = data.contestado ? 'Duelo anulado.'
            : (data.empate ? 'Empate.' : (data.venci ? 'Você venceu!' : nomeOp + ' venceu.'));
    box.appendChild(el('h1', null, esc(tit)));
    if (data.contestado) {
      // 11/09 (revisão): as duas batalhas não bateram (ou chegou um lance/fim que não valia): sem vencedor
      box.appendChild(el('p', 'game-sub', 'As duas batalhas não bateram — o duelo ficou sem vencedor.'));
    } else if (data.wo) {
      // 15/09: o W.O. só vale com a queda que o servidor confirma — e aí custa como a desistência
      box.appendChild(el('p', 'game-sub', data.venci ? esc(nomeOp) + ' saiu da arena — vitória por W.O. (o servidor confere a queda).'
                                                     : 'Você ficou fora da arena — derrota por W.O.: com a queda confirmada, os seus heróis saem com a vida a 0.'));
    } else if (data.desistencia) {
      // 15/09: desistir conta como derrota — a vida a 0 e, onde vale coroa, a derrota na Brasa
      var coroa = (data.modo === 'arena' || data.modo === 'campo') ? ' e a coroa conta a derrota' : '';
      box.appendChild(el('p', 'game-sub', data.venci ? esc(nomeOp) + ' desistiu do duelo — conta como derrota dele.'
                                                     : 'Você desistiu do duelo — conta como derrota: os seus heróis saem com a vida a 0' + coroa + '.'));
    }
    var nomes = function (lista) {
      return (lista || []).map(function (c) {
        return className((c && typeof c === 'object') ? (c.classId || c.heroId) : c);
      }).join(' e ');
    };
    box.appendChild(el('p', 'game-sub', 'Você: ' + esc(nomes(data.duplaMinha)) + ' · ' + esc(nomeOp) + ': ' +
      esc(nomes(data.duplaDele))));
    var ar = data.arena || {};
    box.appendChild(el('p', 'game-sub', (ar.nome ? 'Arena: ' + esc(ar.nome) + ' · ' : '') + 'clima: ' + esc(nomeClima(data.clima))));
    // 14/09: o que valeu depende do modo — o desafio nunca mexe na coroa; a Arena e o Campo o servidor confere
    box.appendChild(el('p', 'du-valeria', data.modo === 'desafio'
      ? 'Desafio amistoso — a coroa não muda.'
      : (data.modo === 'arena' || data.modo === 'campo')
        ? (data.modo === 'arena' ? 'Arena ranqueada' : 'Campo de PvP') + ' — o servidor confere a luta e a coroa muda (o aviso chega em instantes).'
        : 'Amistoso — a Brasa de verdade acende quando o servidor apitar o duelo.' +
          (data.seValesse != null ? ' Se valesse: +' + esc(data.seValesse) + '.' : '')));
    box.appendChild(vidaBloco('fim'));       // 14/09: o meu lado sai do duelo com a vida com que terminou
    var ult = safe(function () { return Dl().ultimo(); }, null);
    var opId = (op && op.id) || (ult && ult.id) || null;
    var naPraca = !!opId && !!safe(function () {
      return JOGO.Rede.pares().some(function (p) { return p.id === opId && !p.sala; });
    }, false);
    if (naPraca && data.modo !== 'arena' && data.modo !== 'campo') {
      box.appendChild(btn('Desafiar de novo', 'btn-gold btn-block', function () {
        navTo('hub');
        var r = safe(function () { return Dl().desafiar(opId); }, null);
        toast(r && r.ok ? 'Desafio enviado a ' + nomeOp + '. Esperando a resposta…' : textoMotivo(r ? r.motivo : 'ocupado', null));
      }));
    }
    // 14/09: do Campo de PvP se volta ao Campo (buildHub → reentraCampo)
    box.appendChild(btn(data.modo === 'campo' && campoHud.dentro ? 'Voltar ao Campo de PvP' : 'Voltar ao Acampamento',
      'btn-primary btn-block', function () { navTo('hub'); }));
    s.appendChild(box);
  }

  // ------------------------------------------------ os ganchos, UMA vez
  var grupoSigTela = '';
  function aoGrupoMudou(est) {
    var p = painelVivo();
    if (p && painelModo === 'convite' && painelConv && painelConv.tipo === 'grupo' &&
        !(est && est.pendente && !est.pendente.meu && est.pendente.gid === painelConv.gid)) fechaPainel();
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
      Gr.aoConvite = mostraConviteGrupo;
      Gr.aoAviso = function (t, k) { toast(t, k); };
      Gr.aoSubiu = function () {
        closeSheet();
        var t = safe(function () { return G().screen; }, '');
        if (t === 'antessala') safe(function () { return G().abandonar(); }, false);
        else if (t !== 'hub' && t !== 'menu' && t !== 'heroSelect') safe(function () { G().restart('hub'); return true; }, null);
        navTo('hub');
      };
    }
    if (Du) { Du.aoMudar = aoDueloMudou; Du.aoDesafio = mostraDesafio; }
    // 14/09: o quadro da Arena — o selo, o painel do adversário encontrado e os relógios
    var Aq = Ar();
    if (Aq) {
      Aq.aoMudar = aoArenaMudou;
      Aq.aoCasou = mostraArenaCasada;
      if (!arenaRelogio) arenaRelogio = setInterval(function () { safe(function () { tiqueArenaTela(); return true; }, null); }, 1000);
    }
    // 15/09: a guerra de guilda — o painel da Sede, os adversários encontrados e o fim que o servidor confere
    var Wg = Gu();
    if (Wg) {
      Wg.aoMudar = aoGuerraMudou;
      Wg.aoCasou = mostraGuerraCasada;
      Wg.aoConvite = function (e) {
        toast(esc(((e && e.lider) || {}).nome || 'Quem lidera') + ' inscreveu o grupo na guerra de guilda — vá à Sede escolher a sua dupla.', 'good');
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
    // 11/09 (revisão): a ficha da escolha do duelo fechada sem querer (o ✕, o toque
    // no fundo escuro, outra ficha por cima) volta sozinha enquanto falta a minha
    // dupla — ela só abria quando o estado MUDAVA, e o duelo morria no prazo de 90 s.
    // Sair continua sendo o "Desistir do duelo" da própria ficha.
    var de = safe(function () { return Dl().estado(); }, null);
    if (current === 'hub' && !sheetName && de && de.fase === 'escolhendo' && !de.escolhi) openSheet('dueloRede');
    var ec = safe(function () { return JOGO.Rede.estadoConexao(); }, null);
    if (ec !== ultConexao) {
      if (ec === 'religando' && (emGrupo() || modoRede())) toast('Sem conexão — tentando de novo…', 'bad');
      ultConexao = ec;
    }
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

  var avisouEspinhos = false;        // 03/10: o aviso dos espinhos sai uma vez por batalha
  UI.handleEvent = function (ev) {
    if (!ev || !ev.type) return;
    if (ev.type === 'timerTick') { paintTimer(); return; }
    if (ev.type === 'prepTick') { pintaPrep(); return; }      // 21/09: o relógio da preparação
    if (ev.type === 'battleStart') avisouEspinhos = false;
    if (current !== 'battle') return;
    /* 03/10 — OS ESPINHOS DO MURO. A primeira vez que um dos MEUS encosta no muro de espinhos do
     * outro lado, o porquê vai à torrada (a linha do diário é miúda e o número parece só mais um
     * golpe); depois disso o vermelho das casas de passo já ensina. */
    if (ev.type === 'muroFere' && !avisouEspinhos) {
      var vEsp = unitByUid(ev.uid);
      var meuLado = safe(function () { return G().meuLado(); }, 'player');
      if (vEsp && vEsp.side === meuLado) {
        avisouEspinhos = true;
        toast((vEsp.name || vEsp.defId) + (ev.motivo === 'empurrado' ? ' foi jogado contra o' : ' terminou a vez encostado no') +
              ' muro de espinhos: −' + ev.amount + '. Casa vizinha de muro com espinhos fere no fim da vez.', 'bad');
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
        toast((vit.name || vit.defId) + ' foi fixado: perdeu todo o PP' +
              (ev.critical ? ' e 1 PA' : '') + ' sem sair do lugar.', 'bad');
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
  UI.version = '2.2';
})();
