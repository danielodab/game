var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// SOTERRA — O GAME MASTER (31/08, pedido do dono: "só eu vou possuir isso")
//
// O Cavaleiro Negro do dono: uma classe que NÃO EXISTE até a chave virar.
// Com o modo ligado, o jogo ganha:
//   · a classe `gm` (liberada, todos os elementos, PA/PP que o GM definir);
//   · o GRIMÓRIO — qualquer feitiço do jogo, escolhido na ficha do GM;
//   · o JULGAMENTO DO MESTRE — um golpe que mata todos os monstros da sala;
//   · vinténs sem fundo (o db curto-circuita quando o GM está de pé);
//   · o SET DO MESTRE (4 peças, arte por chegar — os prompts foram dados).
//
// O PORTÃO: `?gm=<chave>` na URL liga e fica ligado NESTA conta/janela
// (localStorage); `?gm=off` desliga. A chave mora aqui embaixo — troque à
// vontade, é sua. Enquanto o jogo é local isto basta ("só eu" = só quem tem
// a chave e o disco); quando a conta subir ao servidor, o portão migra para
// uma flag de conta assinada no servidor — nunca confie no cliente lá.
//
// Sem a chave, NADA deste arquivo deixa rastro: classe, feitiço, itens e
// painel simplesmente não existem — e um save que já teve `gm` perde o
// herói no load (o sanitize descarta classe sem def), sem quebrar nada.
// ============================================================================

(function () {
  'use strict';

  var GM = {};
  JOGO.GM = GM;

  var CHAVE = 'mestre-do-fundo';          // <== a sua senha; troque aqui
  // POR CONTA (03/09): a conta do Mestre guarda o seu; a principal usa a chave nua de sempre
  var STORE = 'soterra-gm-v1' + ((JOGO.Contas && JOGO.Contas.sufixo) ? JOGO.Contas.sufixo() : '');

  function armazem() {
    try { if (typeof window !== 'undefined' && window.localStorage) return window.localStorage; }
    catch (e) {}
    return null;
  }
  function leConfig() {
    var s = armazem();
    try {
      var d = JSON.parse((s && s.getItem(STORE)) || '');
      if (d && typeof d === 'object') return d;
    } catch (e) {}
    return { ligado: false, pa: 12, pp: 8, spells: [] };
  }
  function gravaConfig(cfg) {
    var s = armazem();
    try { if (s) s.setItem(STORE, JSON.stringify(cfg)); } catch (e) {}
  }

  // ------------------------------------------------------------- o portão
  var cfg = leConfig();
  (function portao() {
    if (typeof window === 'undefined') return;
    var m = /[?&]gm=([^&]+)/.exec(window.location.search || '');
    if (!m) return;
    var v = decodeURIComponent(m[1]);
    if (v === CHAVE) {
      cfg.ligado = true; gravaConfig(cfg);
      // a chave também REGISTRA a conta do Mestre na lista de Contas (03/09)
      if (JOGO.Contas && JOGO.Contas.criaMestre) JOGO.Contas.criaMestre();
    }
    else if (v === 'off') { cfg.ligado = false; gravaConfig(cfg); }
  })();

  /* A CONTA DO MESTRE liga o modo sozinha (03/09: "uma conta local onde eu
   * seleciono e já vem o GM"): a conta 'mestre' MARCADA no registro — e só a
   * chave (ou o botão com o modo já ligado) marca. */
  function contaMestre() {
    var C = JOGO.Contas;
    return !!(C && C.ativa && C.ativa() === C.MESTRE && C.ehMestre && C.ehMestre(C.MESTRE));
  }
  GM.contaMestre = contaMestre;
  GM.ativo = function () { return cfg.ligado === true || contaMestre(); };
  /* Prepara a conta do Mestre na primeira visita — aparelha (Panóplia e os
   * quatro caminhos) e marca no cofre dela. A HUD chama no boot; idempotente. */
  GM.prepararConta = function () {
    if (!contaMestre() || cfg.aparelhado === true) return false;
    if (!JOGO.Progress || !GM.aparelha()) return false;
    cfg.aparelhado = true; gravaConfig(cfg);
    return true;
  };

  // -------------------------------------------------- a configuração do GM
  GM.paPp = function () {
    return { pa: clampa(cfg.pa, 1, 30, 12), pp: clampa(cfg.pp, 1, 30, 8) };
  };
  GM.definePaPp = function (pa, pp) {
    if (!GM.ativo()) return false;
    cfg.pa = clampa(pa, 1, 30, cfg.pa || 12);
    cfg.pp = clampa(pp, 1, 30, cfg.pp || 8);
    gravaConfig(cfg);
    injetaClasse();                        // os stats do def mudam na hora
    return true;
  };
  function clampa(v, lo, hi, def) {
    v = Math.floor(Number(v));
    if (!isFinite(v)) return def;
    return Math.max(lo, Math.min(hi, v));
  }

  /* o GRIMÓRIO: ids de feitiço escolhidos. O Julgamento vai sempre junto. */
  GM.grimorio = function () {
    var fora = ['gm-julgamento'];
    var vistos = { 'gm-julgamento': true };
    var lista = Array.isArray(cfg.spells) ? cfg.spells : [];
    for (var i = 0; i < lista.length; i++) {
      var id = lista[i];
      if (typeof id !== 'string' || vistos[id]) continue;
      vistos[id] = true;
      fora.push(id);
    }
    return fora;
  };
  GM.alternaSpell = function (spellId) {
    if (!GM.ativo() || typeof spellId !== 'string' || spellId === 'gm-julgamento') return false;
    if (!Array.isArray(cfg.spells)) cfg.spells = [];
    var i = cfg.spells.indexOf(spellId);
    if (i >= 0) cfg.spells.splice(i, 1);
    else cfg.spells.push(spellId);
    gravaConfig(cfg);
    return true;
  };
  GM.temSpell = function (spellId) {
    return Array.isArray(cfg.spells) && cfg.spells.indexOf(spellId) >= 0;
  };

  // ------------------------------------ a injeção (só roda com a chave)
  function rng(min, max, line, los) {
    return { min: min, max: max, line: line === true, los: los !== false, movable: false };
  }

  function injetaClasse() {
    var D = JOGO.DATA;
    if (!D || !D.classes) return;
    var pp2 = GM.paPp();
    D.classes.gm = {
      id: 'gm',
      name: 'Mestre do Fundo',
      role: 'game master',
      description: 'O dono do mundo enterrado, de armadura negra e espadão às costas. Não desce para lutar — desce para conferir.',
      lore: 'Dizem que a Lousa só desceu porque ele deixou.',
      palette: { primary: '#8a1f2d', secondary: '#15161c', accent: '#c9a227' },
      stats: {
        hp: 999, pa: pp2.pa, pp: pp2.pp, initiative: 99, power: 50, dodge: 30, lock: 50,
        resists: { fogo: 50, agua: 50, terra: 50, ar: 50, neutro: 50 }
      },
      baseSpells: [],                  // o grimório manda (Progress.spellsFor)
      // SEM `paths`: é isso que deixa o GM escolher QUALQUER elemento — a
      // validação de caminho só reprova quando a classe declara paths
      startsUnlocked: true,
      cardRarity: 'lendario'
    };
    if (D.cards) {
      D.cards.gm = { unlockCost: 0, dropWeight: 0, minDungeon: 99,
                     starCosts: [5, 15, 35, 65, 110] };   // nunca dropa: peso 0
    }
  }

  function injetaJulgamento() {
    var D = JOGO.DATA;
    if (!D || !D.spells) return;
    D.spells['gm-julgamento'] = {
      id: 'gm-julgamento', name: 'Julgamento do Mestre', element: 'neutro',
      classId: 'gm', unlockLevel: 0,
      paCost: 1, cooldown: 0, castsPerTurn: 1,
      range: rng(0, 99, false, false),
      aoe: { shape: 'circle', size: 99 },
      needsEmptyTile: false, targetSide: 'enemy',
      effects: [{ type: 'damage', element: 'neutro', min: 99999, max: 99999 }],
      description: 'O Mestre fecha o livro. Todos os monstros da sala deixam de existir.',
      flavor: 'Não é um golpe. É uma decisão editorial.',
      fxKey: 'nova'
    };
  }

  /* O SET DO MESTRE: 4 peças à imagem do Cavaleiro Negro (a arte vem dele;
   * ícones por chegar — até lá os itens funcionam com o desenho 2D). */
  function injetaSet() {
    var D = JOGO.DATA;
    if (!D || !D.items) return;
    D.sets = D.sets || {};
    D.sets['gm-set-mestre'] = {
      id: 'gm-set-mestre', name: 'Panóplia do Mestre',
      bonuses: { 2: { power: 30 }, 4: { pa: 2, pp: 2, hp: 300 } }
    };
    function peca(id, name, slot, bonuses, desc) {
      D.items[id] = { id: id, name: name, slot: slot, rarity: 'lendario',
                      element: 'neutro', set: 'gm-set-mestre',
                      bonuses: bonuses, description: desc, noDrop: true };
    }
    peca('gm-espadao', 'Espadão do Veredito', 'punho',
         { pa: 2, power: 60 }, 'A lâmina que dorme atravessada nas costas do Mestre. Nunca precisou de segundo golpe.');
    peca('gm-grevas', 'Grevas da Ronda Eterna', 'passo',
         { pp: 3, dodge: 20, initiative: 30 }, 'Botas que já pisaram todas as salas do fundo — inclusive as que ainda não existem.');
    peca('gm-couraca', 'Couraça da Última Palavra', 'casca',
         { hp: 500, lock: 40 }, 'O aço negro com a caveira no cinto. O mundo discute; ela encerra.');
    peca('gm-elmo', 'Elmo do Olhar Vermelho', 'lume',
         { power: 40, initiative: 20 }, 'A fresta acesa que os monstros veem por último. O penacho é vaidade — o resto é sentença.');
  }

  /* Dá o set e os elementos ao herói GM — chamado pela ficha (uma vez). */
  GM.aparelha = function () {
    if (!GM.ativo()) return false;
    var P = JOGO.Progress;
    if (!P || !P.hero) return false;
    var h = P.hero('gm');
    if (!h) return false;
    ['gm-espadao', 'gm-grevas', 'gm-couraca', 'gm-elmo'].forEach(function (id) {
      var tem = h.items && (h.items.punho === id || h.items.passo === id ||
                            h.items.casca === id || h.items.lume === id);
      var noSaco = P.state.inventory.some(function (e) { return e.itemId === id; });
      if (!tem && !noSaco) P.state.inventory.push({ itemId: id, level: 0, stars: 0 });
    });
    // todos os caminhos, de nascença — o privilégio do dono
    h.element = h.element !== 'neutro' ? h.element : 'fogo';
    h.elements = ['fogo', 'agua', 'terra', 'ar'];
    if (P.save) P.save();
    return true;
  };

  // ------------------------------------------------------ A CAIXA DO MESTRE
  /* 03/09, pedido do dono: "o GM pode abrir uma caixa para pegar qualquer
   * item do jogo pra ele equipar; terá um menu exclusivo para pegar pet ou
   * set para seu inventário". Tudo entra pela mesma porta do aparelha —
   * direto no saco, sem fundo e sem sorteio — e só com a chave virada. */
  function saco() {
    var P = JOGO.Progress;
    return (GM.ativo() && P && P.state && P.state.inventory) ? P.state.inventory : null;
  }
  GM.pegaItem = function (itemId) {
    var inv = saco();
    var def = JOGO.DATA && JOGO.DATA.items && JOGO.DATA.items[itemId];
    if (!inv || !def) return false;
    inv.push({ itemId: itemId, level: 0, stars: 0 });
    if (JOGO.Progress.save) JOGO.Progress.save();
    return true;
  };
  GM.pegaSet = function (setId) {
    var inv = saco();
    var sd = JOGO.DATA && JOGO.DATA.sets && JOGO.DATA.sets[setId];
    if (!inv || !sd || !sd.pieces) return 0;
    var n = 0;
    for (var i = 0; i < sd.pieces.length; i++) {
      if (JOGO.DATA.items[sd.pieces[i]]) { inv.push({ itemId: sd.pieces[i], level: 0, stars: 0 }); n++; }
    }
    if (n && JOGO.Progress.save) JOGO.Progress.save();
    return n;
  };
  /* O bicho entra pelas cartas (as 5 pagas de uma vez); `topo` leva as
   * cartas ao ★3 e o XP ao nível 10 — o Mestre não espera. */
  GM.pegaPet = function (petId, topo) {
    var P = JOGO.Progress;
    if (!GM.ativo() || !P || !P.addPetCards) return false;
    var pd = JOGO.DATA && JOGO.DATA.pets && JOGO.DATA.pets[petId];
    if (!pd) return false;
    var info = P.petCardInfo(petId);
    if (!info.unlocked) P.addPetCards(petId, P.PET_UNLOCK_COST || 5);
    if (topo) {
      var faltam = (P.PET_UNLOCK_COST || 5) + (P.PET_STAR_COSTS ? P.PET_STAR_COSTS[P.PET_STAR_COSTS.length - 1] : 45) - P.petCardInfo(petId).cards;
      if (faltam > 0) P.addPetCards(petId, faltam);
      P.addPetXp(petId, 1000000);
    }
    return true;
  };

  if (GM.ativo()) {
    injetaClasse();
    injetaJulgamento();
    injetaSet();
  }
})();
