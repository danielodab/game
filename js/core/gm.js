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
    if (v === CHAVE && !noAr()) {      // no ar, a chave (pública) não liga nada
      cfg.ligado = true; gravaConfig(cfg);
      // a chave também REGISTRA a conta do Mestre na lista de Contas (03/09)
      if (JOGO.Contas && JOGO.Contas.criaMestre) JOGO.Contas.criaMestre();
    }
    else if (v === 'off') { cfg.ligado = false; gravaConfig(cfg); }
  })();

  /* A CONTA DO MESTRE liga o modo sozinha (03/09: "uma conta local onde eu
   * seleciono e já vem o GM"): a conta 'mestre' MARCADA no registro — e só a
   * chave (ou o botão com o modo já ligado) marca. */
  /* A MARCA DO SERVIDOR (10/09): no ar, a conta do site marcada com `admin
   * mestre` (contas.gm = 1) É a conta do Mestre: Cavaleiro Negro já escolhido,
   * Panóplia e Caixa, sem chave no endereço. A sessão traz a marca, e a Nuvem
   * a confere com o servidor a cada abertura (nuvem.js, confereConta). */
  function mestreDoServidor() {
    var S = JOGO.Sessao;
    if (!S || !S.ativa || !S.ativa()) return false;
    var c = S.conta();
    return !!(c && c.gm === true);
  }
  function contaMestre() {
    var C = JOGO.Contas;
    var local = !!(C && C.ativa && C.ativa() === C.MESTRE && C.ehMestre && C.ehMestre(C.MESTRE));
    return local || mestreDoServidor();
  }
  GM.contaMestre = contaMestre;
  GM.mestreDoServidor = mestreDoServidor;
  /* NO AR (10/09): a chave mora neste arquivo, que o servidor entrega a todo
   * mundo — então, com sessão do site, o modo Mestre só vale na conta que o
   * servidor marcou (contas.gm = 1, que o login traz na sessão). Quem achar a
   * chave fica sem a Caixa, e o servidor recusa peça de origem 'caixa' de
   * conta sem a marca (api.py). Sem sessão, é o jogo local de sempre. */
  function sessaoPermite() {
    var S = JOGO.Sessao;
    if (!S || !S.ativa || !S.ativa()) return true;
    var c = S.conta();
    return !!(c && c.gm === true);
  }
  GM.sessaoPermite = sessaoPermite;
  /* NO AR (10/09, "a opção teste só deve estar disponível para mim"): servido
   * por um domínio de verdade, a chave deste arquivo é pública. Lá o modo
   * Mestre, e o painel de teste que depende dele, vale SÓ para a conta que o
   * servidor marcou. A chave e a conta local do Mestre ficam para testar em
   * casa (file://, localhost). `GM._noAr` força o modo nas provas. */
  function noAr() {
    if (typeof GM._noAr === 'boolean') return GM._noAr;
    try {
      var S = JOGO.Sessao;
      // o aplicativo é servido de https://localhost, mas é jogo NO AR: a chave de casa não vale lá
      if (S && S.servidorDoApp && S.servidorDoApp()) return true;
      if (S && S.ehLocal && typeof location !== 'undefined') return !S.ehLocal(location.protocol, location.hostname);
    } catch (e) {}
    return false;
  }
  GM.noAr = noAr;
  GM.ativo = function () {
    if (noAr()) return mestreDoServidor();
    return (cfg.ligado === true || contaMestre()) && sessaoPermite();
  };
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
      /* 04/10, o dono: "o ataque do admin eu só consigo usar uma vez; depois que um monstro que invoca quando
       * morre invoca, não consigo usar de novo no mesmo turno. E o ataque mata o pet — jamais isso deve acontecer".
       * Sem teto por turno e sem custo (a ferramenta do Mestre limpa a sala quantas vezes precisar), e
       * `soInimigos`: a área só fere o OUTRO lado — pet, parceiro e invocação do próprio lado ficam de fora. */
      paCost: 0, cooldown: 0, castsPerTurn: 0, soInimigos: true,
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
      if (!tem && !noSaco) P.state.inventory.push(P.novaCopia ? P.novaCopia(id, 'caixa') : { itemId: id, level: 0, stars: 0 });
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
   * direto no saco, sem fundo e sem sorteio — e só com a chave virada.
   *
   * 03/10 (o painel único do Mestre): a mesma entrega vale para o inventário de
   * QUALQUER jogador, pelo servidor (servidor/moderacao.py, POST /api/mestre/dar).
   * Lá o juiz roda no estado da conta do JOGADOR, que não tem a marca de Mestre —
   * por isso a regra de cada entrega mora em GM.cru, SEM perguntar a marca, e é
   * ela que o juiz chama (servidor/juiz/economia.js, ops mestreDar*). Quem pode
   * entregar é decidido fora: aqui, os GM.pega* (a chave virada ou a conta
   * marcada); no servidor, a rota (só a conta com contas.gm = 1). Uma regra só,
   * para o jogo e o juiz chegarem ao mesmo hash. */
  var cru = GM.cru = {};
  function P0() { var P = JOGO.Progress; return (P && P.state) ? P : null; }
  function dado(colecao, id) {
    var D = JOGO.DATA || {};
    var c = D[colecao];
    return (c && typeof id === 'string' && Object.prototype.hasOwnProperty.call(c, id)) ? c[id] : null;
  }
  function inteiro(n) { var q = Math.floor(Number(n)); return (isFinite(q) && q >= 1) ? q : 0; }
  function copia(P, itemId, nivel, estrelas) {
    return P.novaCopia ? P.novaCopia(itemId, 'caixa', nivel, estrelas) : { itemId: itemId, level: nivel || 0, stars: estrelas || 0 };
  }
  // uma peça (com forja e estrelas, que o painel escolhe; sem elas, a peça crua de sempre)
  cru.item = function (itemId, nivel, estrelas) {
    var P = P0();
    if (!P || !P.state.inventory || !dado('items', itemId)) return false;
    P.state.inventory.push(copia(P, itemId, nivel, estrelas));
    if (P.save) P.save();
    return true;
  };
  // as peças que o conjunto tem no dado desta conta (o Set do Mestre só existe na conta dele)
  cru.pecasDoSet = function (setId) {
    var sd = dado('sets', setId);
    if (!sd || !sd.pieces) return [];
    return sd.pieces.filter(function (id) { return !!dado('items', id); });
  };
  cru.set = function (setId) {
    var P = P0();
    var pecas = cru.pecasDoSet(setId);
    if (!P || !P.state.inventory || !pecas.length) return 0;
    pecas.forEach(function (id) { P.state.inventory.push(copia(P, id)); });
    if (P.save) P.save();
    return pecas.length;
  };
  /* O bicho entra pelas cartas (as 5 pagas de uma vez); `topo` leva as
   * cartas ao ★3 e o XP ao nível 10 — o Mestre não espera. */
  cru.pet = function (petId, topo) {
    var P = P0();
    if (!P || !P.addPetCards || !dado('pets', petId)) return false;
    var info = P.petCardInfo(petId);
    if (!info.unlocked) P.addPetCards(petId, P.PET_UNLOCK_COST || 5);
    if (topo) {
      var faltam = (P.PET_UNLOCK_COST || 5) + (P.PET_STAR_COSTS ? P.PET_STAR_COSTS[P.PET_STAR_COSTS.length - 1] : 45) - P.petCardInfo(petId).cards;
      if (faltam > 0) P.addPetCards(petId, faltam);
      P.addPetXp(petId, 1000000);
    }
    return true;
  };
  // as pedras de forja: as cinco dos elementos e a Âncora
  cru.pedras = function (stoneId, n) {
    var P = P0(), q = inteiro(n);
    if (!P || !P.addStones || !dado('stones', stoneId) || !q) return false;
    return P.addStones(stoneId, q) === true;
  };
  // os selos do Colecionador, um por elemento (o addSelo recusa elemento que não existe)
  cru.selos = function (elemento, n) {
    var P = P0(), q = inteiro(n);
    if (!P || !P.addSelo || !q) return false;
    return P.addSelo(elemento, q) === true;
  };
  // as insígnias de fundação (as que fundam guilda)
  cru.insignias = function (n) {
    var P = P0(), q = inteiro(n);
    if (!P || !P.addInsignia || !q) return false;
    return P.addInsignia(q) === true;
  };
  /* as cartas de classe: `n` cartas, ou 'topo' — a classe liberada e no ★5 (o
   * desbloqueio mais os excedentes da última estrela, de DATA.cards). A classe
   * do Mestre não tem carta. */
  cru.cartas = function (classId, n) {
    var P = P0();
    if (!P || !P.addCards || !P.cardInfo || !dado('classes', classId) || classId === 'gm') return false;
    var q;
    if (n === 'topo') {
      var k = (JOGO.DATA.cards || {})[classId] || {};
      var custos = k.starCosts || [];
      var alvo = (Number(k.unlockCost) || 0) + (Number(custos[custos.length - 1]) || 0);
      q = Math.max(0, alvo - (P.cardInfo(classId).cards || 0));
      if (!q) return true;                      // já estava no topo
    } else {
      q = inteiro(n);
      if (!q) return false;
    }
    return !!P.addCards(classId, q);
  };
  /* os pergaminhos da loja — 'xp' (Sabedoria) e 'elemento' (Reescrita) — até o
   * teto de cada um (DATA.pergaminhos.tetoInventario): entra só o que cabe.
   * Devolve QUANTOS entraram (0 = nenhum). */
  cru.tetoPergaminho = function () {
    return Math.floor(Number(((JOGO.DATA || {}).pergaminhos || {}).tetoInventario)) || 99;
  };
  cru.pergaminho = function (tipo, n) {
    var P = P0(), q = inteiro(n);
    if (!P || !P.addPergaminho || !P.pergaminhos || !q) return 0;
    var tem = (P.pergaminhos() || {})[tipo];
    if (typeof tem !== 'number') return 0;      // tipo que não existe
    var cabe = Math.min(q, cru.tetoPergaminho() - tem);
    if (cabe <= 0) return 0;
    return P.addPergaminho(tipo, cabe) ? cabe : 0;
  };
  /* os dias de BÔNUS DE XP (os da loja), contados no relógio da Agenda — o do
   * servidor quando medido. Como na loja, o fator só pesa na sala com esse
   * relógio medido. */
  cru.bonusXp = function (dias) {
    var P = P0(), q = inteiro(dias);
    if (!P || !P.addBonusXpDias || !q) return false;
    var Ag = JOGO.Agenda, t = Date.now();
    try { if (Ag && Ag.agora) t = Ag.agora(); } catch (e) { t = Date.now(); }
    var agoraS = Math.floor(t > 1e11 ? t / 1000 : t);      // a Agenda anda em milissegundos
    var r = P.addBonusXpDias(q, agoraS);
    return !!(r && r.ok);
  };

  /* A CAIXA DO PRÓPRIO MESTRE (as portas de sempre, que a Autoridade embrulha em ops gm*): a mesma regra
   * de cima, só com a chave virada. O "Pegar" da peça é a peça crua (sem forja nem estrela). */
  GM.pegaItem = function (itemId) { return GM.ativo() ? cru.item(itemId) : false; };
  GM.pegaSet = function (setId) { return GM.ativo() ? cru.set(setId) : 0; };
  GM.pegaPet = function (petId, topo) { return GM.ativo() ? cru.pet(petId, topo) : false; };
  /* O RESTO DO INVENTÁRIO (11/09, pedido do dono: "quero liberar pedras e as
   * outras coisas também para o inventário da minha conta GM"). As MESMAS
   * portas do Progress que o saque, a roleta e a loja usam. Quantidade
   * inteira a partir de 1; o resto é recusado. */
  GM.pegaPedras = function (stoneId, n) { return GM.ativo() ? cru.pedras(stoneId, n) : false; };
  GM.pegaSelos = function (elemento, n) { return GM.ativo() ? cru.selos(elemento, n) : false; };
  GM.pegaInsignias = function (n) { return GM.ativo() ? cru.insignias(n) : false; };
  GM.pegaCartas = function (classId, n) { return GM.ativo() ? cru.cartas(classId, n) : false; };
  GM.pegaPergaminho = function (tipo, n) { return GM.ativo() ? cru.pergaminho(tipo, n) : 0; };
  GM.pegaBonusXp = function (dias) { return GM.ativo() ? cru.bonusXp(dias) : false; };

  /* AS FERRAMENTAS DO PAINEL DE TESTE (02/10): liberar classe, cravar o nível e o
   * elemento de um herói. Moravam só no js/ui/debug.js, mexendo direto no save —
   * e, com a sessão do site, o servidor é o dono da economia: a mudança local era
   * desfeita na primeira adoção do estado dele. Agora a regra mora AQUI, a mesma
   * no jogo e no juiz (servidor/juiz/economia.js, ops gmLiberaClasse/gmNivel/
   * gmElemento): a Autoridade embrulha GM.liberaClasse/poeNivel/poeElemento, que
   * rodam na hora e sobem como op do Mestre. As versões `Cru` não pedem a marca:
   * é o painel de teste em casa (file://, localhost), sem Mestre nenhum. */
  var ELEMENTOS_TESTE = ['neutro', 'fogo', 'agua', 'terra', 'ar'];
  GM.nivelCru = function (heroId, nivel) {
    var P = JOGO.Progress, D = JOGO.DATA || {};
    var h = P && P.hero ? P.hero(heroId) : null;
    if (!h) return false;
    var lv = D.leveling || {};
    // `addXp` é a porta oficial, mas exige XP acumulada: aqui o nível é cravado e
    // o XP vai ao piso dele (a tabela), com os feitiços ressincronizados
    h.level = clampa(nivel, 1, lv.maxLevel || 30, h.level || 1);
    var tab = lv.xpTable || [];
    if (tab[h.level - 1] != null) h.xp = tab[h.level - 1];
    h.spells = P.spellsFor(heroId);
    P.save();
    return true;
  };
  GM.elementoCru = function (heroId, elemento) {
    var P = JOGO.Progress;
    var h = P && P.hero ? P.hero(heroId) : null;
    if (!h || ELEMENTOS_TESTE.indexOf(elemento) < 0) return false;
    // `chooseElement` recusa se já houver elemento ou se o nível for baixo — no
    // painel de teste a troca é livre, e os feitiços seguem pela porta oficial
    h.element = elemento;
    h.spells = P.spellsFor(heroId);
    P.save();
    return true;
  };
  GM.liberaClasse = function (classId) {
    var P = JOGO.Progress;
    if (!GM.ativo() || !P || !P.unlockClass) return false;
    return P.unlockClass(classId) === true;
  };
  GM.poeNivel = function (heroId, nivel) { return GM.ativo() ? GM.nivelCru(heroId, nivel) : false; };
  GM.poeElemento = function (heroId, elemento) { return GM.ativo() ? GM.elementoCru(heroId, elemento) : false; };

  /* O MESTRE NO GRUPO (11/09, pedido do dono: "o GM pode fazer parte de um
   * grupo.. mas só ele pode pedir grupo", com o Cavaleiro Negro). Na batalha em
   * dupla os DOIS motores rodam a mesma batalha — e o do parceiro não tem a
   * classe do Mestre nem o Julgamento (sem a chave nada existe). O herói do
   * Mestre viaja com a FICHA (a classe e os feitiços gm-* do grimório); o
   * parceiro só a aceita do Mestre que o relé conferiu (coop.js), empresta
   * para a batalha e devolve depois (a sala seguinte, o grupo desfeito, a
   * volta à praça). Fora disso, nesta página, continua não existindo. */
  GM.fichaDoGrupo = function (spells) {
    var D = JOGO.DATA;
    if (!GM.ativo() || !D || !D.classes || !D.classes.gm) return null;
    var fe = {};
    (spells || []).forEach(function (id) {
      if (typeof id === 'string' && /^gm-/.test(id) && D.spells && D.spells[id]) fe[id] = JSON.parse(JSON.stringify(D.spells[id]));
    });
    return { classe: JSON.parse(JSON.stringify(D.classes.gm)), feiticos: fe };
  };
  var emprestado = null;           // o que ESTA página tomou emprestado: { classe, feiticos: [ids] }
  GM.emprestaFicha = function (ficha) {
    var D = JOGO.DATA;
    if (!D || !D.classes || !D.spells || !ficha || !ficha.classe || ficha.classe.id !== 'gm') return false;
    if (GM.ativo()) return true;                 // o próprio Mestre já tem tudo
    emprestado = emprestado || { classe: false, feiticos: [] };
    if (!D.classes.gm) { D.classes.gm = JSON.parse(JSON.stringify(ficha.classe)); emprestado.classe = true; }
    var fe = ficha.feiticos || {};
    for (var k in fe) {
      if (!Object.prototype.hasOwnProperty.call(fe, k) || !/^gm-/.test(k) || D.spells[k]) continue;
      D.spells[k] = JSON.parse(JSON.stringify(fe[k]));
      emprestado.feiticos.push(k);
    }
    return true;
  };
  GM.devolveFicha = function () {
    var D = JOGO.DATA, tinha = !!emprestado;
    if (emprestado && D) {
      if (emprestado.classe && D.classes) delete D.classes.gm;
      emprestado.feiticos.forEach(function (k) { if (D.spells) delete D.spells[k]; });
    }
    emprestado = null;
    return tinha;
  };
  GM.fichaEmprestada = function () { return !!emprestado; };

  if (GM.ativo()) {
    injetaClasse();
    injetaJulgamento();
    injetaSet();
  }
})();
