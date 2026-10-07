// O Mercadinho — a casa de leilões do Acampamento, a alma da economia (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É
 * ============
 * O mercado de itens do Acampamento (item 3 da lista de MMORPG) — a versão
 * local-primeiro de uma casa de leilões: jogador ANUNCIA uma peça com
 * preço, outro COMPRA. As ofertas moram no JOGO.DB; quando o servidor chegar,
 * anunciar/comprar viram endpoints e a validação muda de lado.
 *
 * O MERCADOR-FANTASMA FOI EMBORA (12/09, pedido do dono: "tem uns itens
 * aleatórios que sempre aparecem no mercadinho; não pode — o mercadinho
 * precisa estar sem nada e só aparecer itens quando jogadores publicarem").
 * Ele existia porque um mercado local nasceria vazio e morto; com gente no
 * servidor, banca de mentira só suja o balcão e confunde o preço de verdade.
 * O balcão agora nasce VAZIO e só enche com o que jogador anuncia — e a
 * oferta de jogador NÃO tem prazo: fica até vender ou ser retirada.
 *
 * AS OFERTAS ATRAVESSAM DEPLOY. Elas moram no save (JOGO.DB.mercado), que
 * vive no localStorage e sobe para a nuvem junto com o resto da conta — um
 * deploy novo troca os .js, não o save. Duas defesas explícitas, porque o
 * dono pediu cuidado nisso: a virada do dia NUNCA reconstrói a lista (só
 * carimba a data), e a limpeza da banca velha remove apenas o que é do
 * 'mercador', peça por peça. O saneamento do db.js também deixou de jogar
 * o mercado inteiro fora quando acha um campo torto.
 *
 * A TAXA É O RALO: toda venda de jogador paga 5% (mínimo 1). Economia sem
 * ralo incha até o vintém não valer nada — a taxa é pequena o bastante para
 * não doer e existe para o dia em que a moeda circular entre contas.
 *
 * AS PEDRAS DE FORJA EM LOTE (22/09, pedido do dono: vender pedra no
 * mercado, uma a uma ou em lotes de 10, 50 e 100). O lote é uma oferta como
 * a peça, com `tipo: 'pedra'`, `stoneId` e `qtd` e SEM itemId — quem olha
 * `of.itemId` para achar a peça não confunde pedra com peça. Diferente da
 * peça, quem tira as pedras do estoque é ESTE módulo (anunciarPedras chama o
 * Progress.gastaPedras), porque pedra não tem ficha nem série para o
 * chamador mover. Com o servidor, o lote é uma linha de mercado_anuncios
 * mais uma de mercado_lotes (servidor/mercado.py).
 */
(function () {
  'use strict';
  /* O TEXTO NO IDIOMA DO JOGADOR (docs/IDIOMAS.md): a chave é o próprio português. Sem o JOGO.I18n
   * (o juiz do servidor e as provas em Node não o carregam) volta o português, com as {variáveis}. */
  function Tx(s, v) {
    var I = (typeof JOGO !== 'undefined' && JOGO) ? JOGO.I18n : null;
    if (I && I.t) return I.t(s, v);
    if (!v) return s;
    return String(s).replace(/\{([A-Za-z_]\w*)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m;
    });
  }

  var M = {};
  JOGO.Mercado = M;

  M.TAXA = 0.05;               // 5% sobre a venda do jogador, mínimo 1
  M.POR_DIA = 0;               // 12/09: o mercador-fantasma não pendura mais nada
  M.PRECO_MAX = 9999;          // servidor/mercado.py espelha

  /* A taxa em conta INTEIRA (13/09): 5% para cima, mínimo 1 — a mesma de
   * servidor/mercado.py (taxa_de). `preco * 0.05` em ponto flutuante dá
   * 3.0000000000000004 para 60 e o ceil cobrava 4; com preco*5/100 não. */
  M.taxaDe = function (preco) {
    preco = Math.max(0, Math.floor(Number(preco) || 0));
    return Math.max(1, Math.ceil(preco * 5 / 100));
  };

  // 08/09: "o drop de itens bons seja MUITO difícil" — o preço acompanha:
  // raro vale seis vezes, épico vinte, lendário cinquenta comuns
  var BASE_RARIDADE = { comum: 18, raro: 120, epico: 400, lendario: 900 };

  function DB() { return JOGO.DB || null; }
  function isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function DATA() { return JOGO.DATA || {}; }

  function hoje() {
    var d = new Date();
    var m = d.getMonth() + 1, dia = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dia < 10 ? '0' : '') + dia;
  }
  function hashStr(s2) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s2.length; i++) {
      h ^= s2.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function rngDe(semente) {
    var seed = hashStr(semente);
    return function () {
      seed = (seed + 0x6D2B79F5) >>> 0;
      var t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* O preço que a peça "vale": base pela raridade, +15% por forja, +35% por
   * estrela. É a sugestão do anúncio E o preço do mercador — uma régua só. */
  M.precoSugerido = function (itemId, level, stars) {
    var it = (DATA().items || {})[itemId] || {};
    var base = BASE_RARIDADE[it.rarity] || BASE_RARIDADE.comum;
    var preco = base * (1 + 0.15 * (level || 0) + 0.35 * (stars || 0));
    return Math.max(1, Math.round(preco));
  };

  /* A RÉGUA DA PEDRA (22/09). Os lotes são fixos — 1, 10, 50 e 100 — para o
   * balcão agrupar anúncios iguais e o preço por pedra ser comparável; a
   * mesma lista mora em servidor/mercado.py (LOTES_PEDRA) e no juiz.
   * O preço sugerido por pedra vem do tempo de caça: uma pedra comum sai a
   * ~2-3 vinténs do tempo que se leva para achá-la (estimativa do lote de
   * 22/09, não medida em partida), e o preço fica um pouco acima disso
   * (quem vende quer lucro, quem compra poupa o tempo). Fogo e
   * neutro valem mais porque saem de MENOS monstros (6 e 5 dos 49 que
   * derrubam pedra, contados nos dados em 22/09); a âncora só sai de CHEFE
   * (8% a 30% por chefe, DATA.upgrade.guardDropByDungeon) e é a pedra que
   * segura o nível na forja arriscada — por isso vale dezenas de comuns.
   * Pedra que a régua não conhece vale 4. O sugerido nunca passa do
   * PRECO_MAX (o lote de 100 âncoras bate no teto) nem fica abaixo de 2. */
  M.LOTES_PEDRA = [1, 10, 50, 100];
  M.PEDRA_BASE = {
    'stone-tear': 3, 'stone-root': 3, 'stone-breath': 4,
    'stone-ember': 5, 'stone-slate': 5, 'stone-anchor': 150
  };
  var PEDRA_BASE_PADRAO = 4;
  function temChave(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function pedrasDef() { return DATA().stones || {}; }
  M.precoSugeridoPedra = function (stoneId, qtd) {
    var base = temChave(M.PEDRA_BASE, stoneId) ? M.PEDRA_BASE[stoneId] : PEDRA_BASE_PADRAO;
    var q = Math.max(1, Math.floor(Number(qtd) || 1));
    return Math.min(M.PRECO_MAX, Math.max(2, Math.round(base * q)));
  };
  /* a oferta é um lote de pedras? (a local e a do servidor dizem `tipo`) */
  M.ehLote = function (of) { return !!(of && of.tipo === 'pedra'); };
  M.nomePedra = function (stoneId) {
    var s = pedrasDef();
    var d = temChave(s, stoneId) ? s[stoneId] : null;
    return (d && d.name) || String(stoneId);
  };
  function loteValido(of) {
    return !!(of && of.tipo === 'pedra' && typeof of.stoneId === 'string' && of.stoneId &&
              M.LOTES_PEDRA.indexOf(of.qtd) >= 0);
  }

  /* A BANCA DO MERCADOR (13/09, pedido do dono: "no mercadinho do jogo deve ter poções
   * à venda por vinténs. poções que carregam a vida vão para consumíveis no inventário").
   * O mercador-fantasma saiu do balcão de PEÇAS (12/09) e continua fora: esta banca é
   * outra coisa — só as poções de vida de DATA.consumiveis, estoque infinito, preço fixo e
   * sem taxa (a taxa é o ralo da venda entre jogadores). Paga com os vinténs do SACO, como
   * toda compra do jogo; o banco não conta. Tudo ou nada: sem vinténs não entra poção, e
   * acima do teto por tipo não sai vintém. Com a autoridade ligada a MESMA função roda no
   * juiz (op comprarPocao, servidor/juiz/economia.js) no estado do servidor, com ou sem o
   * mercadinho entre contas. */
  function consumiveis() { return DATA().consumiveis || {}; }
  M.pocoesDaBanca = function () {
    var c = consumiveis(), out = [], k;
    for (k in c) if (c.hasOwnProperty(k) && c[k] && c[k].tipo === 'vida' && c[k].preco > 0) out.push(c[k]);
    out.sort(function (a, b) { return a.preco - b.preco; });
    return out;
  };
  M.comprarPocao = function (pocaoId, qtd) {
    var db = DB(), P = JOGO.Progress;
    if (!db || !P || !P.poeConsumivel) return Promise.resolve({ ok: false, erro: Tx('sem conta') });
    var c = consumiveis();
    var def = (typeof pocaoId === 'string' && c.hasOwnProperty(pocaoId)) ? c[pocaoId] : null;
    if (!def || def.tipo !== 'vida' || !(def.preco > 0)) return Promise.resolve({ ok: false, erro: Tx('o mercador não vende isso') });
    var teto = P.consumivelTeto ? P.consumivelTeto() : 20;
    qtd = Math.floor(Number(qtd));
    if (!isFinite(qtd) || qtd < 1) return Promise.resolve({ ok: false, erro: Tx('quantidade de 1 a {teto}', { teto: teto }) });
    function cabe() { return P.consumivelVer(pocaoId) + qtd <= teto; }
    function cheio() {
      return { ok: false, cheio: true, erro: Tx('Cabem {teto} de cada poção — você já tem {a}.', { teto: teto, a: P.consumivelVer(pocaoId) }) };
    }
    if (!cabe()) return Promise.resolve(cheio());
    var preco = def.preco * qtd;
    return db.gastarMoedas(preco).then(function (pg) {
      if (!pg || !pg.ok) {
        return { ok: false, semVintem: true, erro: Tx('Faltam vinténs no saco: {qtd}× {name} custa {preco}.', { qtd: qtd, name: def.name, preco: preco }) };
      }
      // duas compras juntas: a outra pode ter enchido o frasco enquanto esta pagava — devolve
      if (!cabe() || !P.poeConsumivel(pocaoId, qtd)) {
        return db.ganharMoedas(preco).then(cheio);
      }
      return { ok: true, pocaoId: pocaoId, qtd: qtd, pagou: preco, total: P.consumivelVer(pocaoId) };
    });
  };

  /* O BALCÃO DE VINTÉNS (07/10). O dono: "quero que o jogador comum tenha direito a crescer igual quem
   * paga". O vintém das diárias e das salas comprava pouco: poção, e barras a 80 por 1 — a Reescrita da loja
   * (250 barras) ficava a 20.000 vinténs. O mercador passa a vender, SÓ por vintém, duas coisas que importam:
   *   reescrita   o Pergaminho da Reescrita por 8.000 vinténs, UM a cada 30 dias (a mesma janela da loja:
   *               "um caminho por mês" é regra de desenho, não de preço) — 2,5× mais barato que pela loja,
   *               e ainda assim um mês inteiro de diárias;
   *   pedrasDia   10 pedras do ELEMENTO do Calabouço do Dia (o elemento do chefe dele) por 1.500 vinténs, UM
   *               lote por dia — abaixo do preço da loja (25–40 barras = 2.000–3.200 vinténs) só porque é
   *               um lote, de um elemento, por dia: quem farma chega às pedras; quem paga adianta.
   * As travas moram no Progress (`state.balcao`: `reescritaEm` em segundos do servidor, `pedrasDia` em
   * AAAAMMDD de Brasília) e entram no hash da economia; o relógio é o do SERVIDOR (JOGO.Agenda.agora — no
   * juiz, o instante do pedido). Paga com os vinténs do SACO, tudo ou nada, como a banca das poções; com a
   * autoridade ligada a MESMA função roda no juiz (ops comprarReescrita e comprarPedrasDoDia). */
  M.BALCAO = {
    reescrita: { preco: 8000, diasEntre: 30 },
    pedrasDia: { preco: 1500, qtd: 10 }
  };
  function relogioMs() {
    try { if (JOGO.Agenda && JOGO.Agenda.agora) { var t = +JOGO.Agenda.agora(); if (isFinite(t) && t > 0) return t; } } catch (e) {}
    return Date.now();
  }
  function chaveDoDia(ts) {
    var d = new Date(ts - 3 * 3600 * 1000);
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }
  /* o elemento do portal = o elemento do CHEFE dele (o dado do calabouço não declara elemento) */
  function elementoDoPortal(dungeonId) {
    var ms = DATA().monsters || {}, k;
    for (k in ms) if (ms.hasOwnProperty(k) && ms[k] && ms[k].boss && ms[k].dungeonId === dungeonId && ms[k].element) return ms[k].element;
    return null;
  }
  function pedraDoElemento(el) {
    var ps = DATA().stones || {}, k;
    for (k in ps) if (ps.hasOwnProperty(k) && ps[k] && ps[k].element === el) return k;
    return null;
  }
  /* o que o balcão vende AGORA e por quê não (para a vitrine e para as duas compras) */
  M.balcao = function (ts) {
    var P = JOGO.Progress, Dd = JOGO.Diario;
    var t = (typeof ts === 'number' && isFinite(ts)) ? ts : relogioMs();
    var travas = (P && P.balcao) ? P.balcao() : { reescritaEm: 0, pedrasDia: 0 };
    var cfgR = M.BALCAO.reescrita, cfgP = M.BALCAO.pedrasDia;
    var liberaEm = travas.reescritaEm ? travas.reescritaEm + cfgR.diasEntre * 86400 : 0;
    var reescrita = { preco: cfgR.preco, diasEntre: cfgR.diasEntre, liberaEm: liberaEm,
                      pode: !liberaEm || t / 1000 >= liberaEm };
    var dia = (Dd && Dd.hoje) ? Dd.hoje(t) : null;
    var el = dia ? elementoDoPortal(dia.dungeonId) : null;
    var stoneId = el ? pedraDoElemento(el) : null;
    var hoje = chaveDoDia(t);
    var pedras = { preco: cfgP.preco, qtd: cfgP.qtd, dungeonId: dia ? dia.dungeonId : null, elemento: el, stoneId: stoneId,
                   compradoHoje: travas.pedrasDia === hoje, pode: !!stoneId && travas.pedrasDia !== hoje, dia: hoje };
    return { reescrita: reescrita, pedrasDia: pedras, agoraMs: t };
  };
  M.comprarReescrita = function () {
    var db = DB(), P = JOGO.Progress;
    if (!db || !P || !P.addPergaminho || !P.balcaoMarca) return Promise.resolve({ ok: false, erro: Tx('sem conta') });
    var b = M.balcao();
    if (!b.reescrita.pode) {
      return Promise.resolve({ ok: false, espera: true, liberaEm: b.reescrita.liberaEm,
                               erro: Tx('O mercador vende uma Reescrita a cada {dias} dias — a próxima só depois.', { dias: b.reescrita.diasEntre }) });
    }
    var preco = b.reescrita.preco;
    return db.gastarMoedas(preco).then(function (pg) {
      if (!pg || !pg.ok) return { ok: false, semVintem: true, erro: Tx('Faltam vinténs no saco: a Reescrita custa {preco}.', { preco: preco }) };
      if (!P.addPergaminho('elemento', 1)) {
        return db.ganharMoedas(preco).then(function () { return { ok: false, cheio: true, erro: Tx('Não cabe mais Pergaminho da Reescrita na conta.') }; });
      }
      P.balcaoMarca('reescritaEm', Math.floor(b.agoraMs / 1000));
      return { ok: true, pagou: preco, liberaEm: Math.floor(b.agoraMs / 1000) + b.reescrita.diasEntre * 86400 };
    });
  };
  M.comprarPedrasDoDia = function () {
    var db = DB(), P = JOGO.Progress;
    if (!db || !P || !P.addStones || !P.balcaoMarca) return Promise.resolve({ ok: false, erro: Tx('sem conta') });
    var b = M.balcao(), pd = b.pedrasDia;
    if (!pd.stoneId) return Promise.resolve({ ok: false, erro: Tx('O mercador não tem as pedras do dia hoje.') });
    if (pd.compradoHoje) return Promise.resolve({ ok: false, espera: true, erro: Tx('O lote de pedras do dia é um por dia — volte amanhã.') });
    return db.gastarMoedas(pd.preco).then(function (pg) {
      if (!pg || !pg.ok) return { ok: false, semVintem: true, erro: Tx('Faltam vinténs no saco: o lote custa {preco}.', { preco: pd.preco }) };
      if (!P.addStones(pd.stoneId, pd.qtd)) {
        return db.ganharMoedas(pd.preco).then(function () { return { ok: false, erro: Tx('não deu') }; });
      }
      P.balcaoMarca('pedrasDia', pd.dia);
      return { ok: true, pagou: pd.preco, stoneId: pd.stoneId, qtd: pd.qtd, total: P.stoneCount ? P.stoneCount(pd.stoneId) : null };
    });
  };

  /* Abre o balcão. Ele NÃO se reconstrói: a data é só um carimbo (o resto do
   * jogo ainda a lê), e a lista de ofertas é preservada como está. A única
   * coisa que sai é a banca VELHA do mercador-fantasma, que ficou nos saves
   * de antes de 12/09 — e sai peça por peça, pelo dono da oferta, nunca
   * limpando a lista inteira. Save com forma estranha vira balcão vazio em
   * vez de derrubar o jogo, mas nenhuma oferta de jogador se perde por
   * causa de virada de dia ou de deploy. O lote de pedras (22/09) não tem
   * itemId: fica se for um lote de verdade (tipo, pedra e tamanho da régua). */
  M.abrir = function (dataForcada) {
    var db = DB();
    if (!db) return Promise.resolve(null);
    return db.mercadoLer().then(function (mc) {
      var dia = dataForcada || hoje();
      if (!mc || typeof mc !== 'object' || !isArray(mc.ofertas)) mc = { dia: null, ofertas: [] };
      var antes = mc.ofertas.length;
      var limpas = mc.ofertas.filter(function (o) {
        return o && (o.tipo === 'pedra' ? loteValido(o) : !!o.itemId) && o.vendedor !== 'mercador';
      });
      var mudou = (limpas.length !== antes) || (mc.dia !== dia);
      mc = { dia: dia, ofertas: limpas };
      if (!mudou) return mc;
      return db.mercadoGravar(mc).then(function () { return mc; });
    });
  };

  /* Anuncia UMA peça do jogador. Quem tira a peça do saco é o CHAMADOR (a
   * ficha), como no banco — este módulo só registra a oferta. */
  M.anunciar = function (entrada, preco, dataForcada) {
    var db = DB();
    if (!db) return Promise.resolve({ ok: false, erro: Tx('sem conta') });
    preco = Math.floor(Number(preco));
    if (!entrada || !entrada.itemId) return Promise.resolve({ ok: false, erro: Tx('peça inválida') });
    if (!isFinite(preco) || preco < 1 || preco > M.PRECO_MAX) {
      return Promise.resolve({ ok: false, erro: Tx('preço entre 1 e {PRECO_MAX}', { PRECO_MAX: M.PRECO_MAX }) });
    }
    return M.abrir(dataForcada).then(function (mc) {
      mc.ofertas.push({
        id: 'jg-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36),
        vendedor: 'jogador',
        itemId: entrada.itemId, level: entrada.level || 0, stars: entrada.stars || 0,
        iid: (typeof entrada.iid === 'string' && entrada.iid) ? entrada.iid : null,   // a série (10/09)
        preco: preco
      });
      return db.mercadoGravar(mc).then(function () {
        return { ok: true, total: mc.ofertas.length };
      });
    });
  };

  /* Anuncia um LOTE de pedras de forja (22/09). Aqui, e não no chamador, as
   * pedras saem do estoque (Progress.gastaPedras, tudo ou nada): a oferta só
   * entra no balcão com as pedras já fora, e se a gravação do balcão falhar
   * depois do débito elas voltam (addStones) — pedra não some no meio. */
  M.anunciarPedras = function (stoneId, qtd, preco, dataForcada) {
    var db = DB(), P = JOGO.Progress;
    if (!db || !P || !P.gastaPedras || !P.addStones) return Promise.resolve({ ok: false, erro: Tx('sem conta') });
    if (typeof stoneId !== 'string' || !temChave(pedrasDef(), stoneId)) {
      return Promise.resolve({ ok: false, erro: 'pedra desconhecida' });
    }
    qtd = Number(qtd);
    if (M.LOTES_PEDRA.indexOf(qtd) < 0) {
      return Promise.resolve({ ok: false, erro: Tx('o lote é de {a} pedras', { a: M.LOTES_PEDRA.join(', ') }) });
    }
    preco = Math.floor(Number(preco));
    if (!isFinite(preco) || preco < 1 || preco > M.PRECO_MAX) {
      return Promise.resolve({ ok: false, erro: Tx('preço entre 1 e {PRECO_MAX}', { PRECO_MAX: M.PRECO_MAX }) });
    }
    return M.abrir(dataForcada).then(function (mc) {
      if (!mc) return { ok: false, erro: Tx('sem conta') };
      if (!P.gastaPedras(stoneId, qtd)) {
        return { ok: false, erro: Tx('pedras insuficientes: o lote pede {qtd} e você tem {a}', { qtd: qtd, a: P.stoneCount ? P.stoneCount(stoneId) : 0 }) };
      }
      mc.ofertas.push({
        id: 'jg-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36),
        vendedor: 'jogador', tipo: 'pedra', stoneId: stoneId, qtd: qtd, preco: preco
      });
      function devolve(e) {
        P.addStones(stoneId, qtd);
        return { ok: false, erro: Tx('o balcão não gravou — as pedras voltaram ({a})', { a: (e && e.message) || e || 'erro' }) };
      }
      var gravou;
      try { gravou = db.mercadoGravar(mc); } catch (e) { return devolve(e); }
      return Promise.resolve(gravou).then(function () {
        return { ok: true, total: mc.ofertas.length };
      }, devolve);
    });
  };

  /* Compra uma oferta: debita o comprador, tira a oferta do balcão e — se o
   * vendedor é o jogador — credita o preço MENOS a taxa. A peça comprada
   * volta pelo retorno; quem a põe no saco é o chamador. O LOTE de pedras
   * (22/09) entra direto no estoque (addStones): pedra não ocupa o saco. */
  M.comprar = function (ofertaId, dataForcada) {
    var db = DB();
    if (!db) return Promise.resolve({ ok: false, erro: Tx('sem conta') });
    return M.abrir(dataForcada).then(function (mc) {
      var idx = -1;
      for (var i = 0; i < mc.ofertas.length; i++) {
        if (mc.ofertas[i].id === ofertaId) idx = i;
      }
      if (idx < 0) return { ok: false, erro: Tx('essa oferta já saiu do balcão') };
      var of = mc.ofertas[idx];
      var lote = M.ehLote(of), P = JOGO.Progress;
      // sem o Progress não há onde pôr a pedra: recusa ANTES de cobrar
      if (lote && !(P && P.addStones)) return { ok: false, erro: Tx('sem conta') };
      return db.gastarMoedas(of.preco).then(function (pg) {
        if (!pg.ok) return { ok: false, erro: pg.erro || Tx('vinténs insuficientes') };
        mc.ofertas.splice(idx, 1);
        var repasse = 0;
        var cadeia = db.mercadoGravar(mc);
        if (of.vendedor === 'jogador') {
          var taxa = M.taxaDe(of.preco);
          repasse = of.preco - taxa;
          cadeia = cadeia.then(function () { return db.ganharMoedas(repasse); });
        }
        return cadeia.then(function () {
          if (lote) {
            P.addStones(of.stoneId, of.qtd);
            return { ok: true, pedras: { stoneId: of.stoneId, qtd: of.qtd }, pagou: of.preco, repasse: repasse };
          }
          return { ok: true, item: { itemId: of.itemId, level: of.level, stars: of.stars, iid: of.iid || null },
                   pagou: of.preco, repasse: repasse };
        });
      });
    });
  };

  /* Retira uma oferta do PRÓPRIO jogador — a peça volta pelo retorno; o lote
   * de pedras volta direto ao estoque (addStones), como na compra. */
  M.retirar = function (ofertaId, dataForcada) {
    var db = DB();
    if (!db) return Promise.resolve({ ok: false, erro: Tx('sem conta') });
    return M.abrir(dataForcada).then(function (mc) {
      var idx = -1;
      for (var i = 0; i < mc.ofertas.length; i++) {
        if (mc.ofertas[i].id === ofertaId) idx = i;
      }
      if (idx < 0) return { ok: false, erro: Tx('essa oferta já saiu do balcão') };
      var of = mc.ofertas[idx];
      if (of.vendedor !== 'jogador') return { ok: false, erro: Tx('a banca do mercador não é sua') };
      var lote = M.ehLote(of), P = JOGO.Progress;
      if (lote && !(P && P.addStones)) return { ok: false, erro: Tx('sem conta') };
      mc.ofertas.splice(idx, 1);
      return db.mercadoGravar(mc).then(function () {
        if (lote) {
          P.addStones(of.stoneId, of.qtd);
          return { ok: true, pedras: { stoneId: of.stoneId, qtd: of.qtd } };
        }
        return { ok: true, item: { itemId: of.itemId, level: of.level, stars: of.stars, iid: of.iid || null } };
      });
    });
  };

  /* ====================================================================
   * O MERCADINHO ENTRE CONTAS (13/09, pedido do dono)
   * ====================================================================
   * "se eu coloco um item por valor X outro usuário pode dar a proposta de
   * comprar pelo valor Y (...) ao aceitar a proposta, o jogador que deu a
   * proposta aparece na tela se ele realmente quer".
   *
   * Com sessão e a autoridade ligada, o balcão é do SERVIDOR (servidor/
   * mercado.py): o anúncio de um jogador aparece para todos, a peça fica em
   * custódia lá, e compra, proposta, aceite e confirmação são rotas
   * /api/mercado/*. Tudo o que muda o estado volta com o estado novo da conta,
   * que a Autoridade ADOTA sem recarregar a página. Sem sessão (em casa, as
   * bancadas de teste) vale o balcão local lá de cima, como sempre.
   *
   * O VIGIA DOS AVISOS: a HUD pendura aqui como mostrar (M.servidor.vigia). A
   * cada ~30 s fora de batalha — e logo que o jogador entra na praça — o vigia
   * pergunta /api/mercado/avisos. A proposta que o vendedor aceitou vira a tela
   * "deseja aceitar essa negociação?" SÓ na praça, uma por vez; as notícias
   * (venda feita, proposta recusada, negociação perdida, proposta recebida)
   * viram avisos em fila e são marcadas como vistas. */
  var Srv = M.servidor = {};
  Srv.INTERVALO_MS = 30000;     // entre duas perguntas de avisos fora de batalha
  Srv.TIQUE_MS = 2000;          // o vigia olha a tela a cada tanto (sem rede)
  Srv.ADIA_MS = 5 * 60 * 1000;  // a confirmação fechada sem resposta volta depois disto (ou na volta à praça)
  Srv.AVISOS_UM_A_UM = 3;       // o que passar disto vira um aviso de resumo

  Srv.ligado = function () {
    var A = JOGO.Autoridade;
    try { return !!(A && A.ligada && A.ligada()); } catch (e) { return false; }
  };

  function pede(rota, corpo) {
    var S = JOGO.Sessao, A = JOGO.Autoridade;
    if (!S || !S.api) return Promise.resolve({ ok: false, status: 0, erro: Tx('sem sessão') });
    // as ops na fila sobem ANTES: o servidor anuncia e cobra sobre o estado com elas
    var antes = (corpo && A && A.descarrega) ? A.descarrega() : Promise.resolve(null);
    return antes.then(function () {
      return S.api(rota, corpo ? { method: 'POST', body: corpo } : undefined);
    }, function () {
      return S.api(rota, corpo ? { method: 'POST', body: corpo } : undefined);
    }).then(function (r) {
      if (r && (r.progress || r.db) && A && A.adotaResposta) {
        try { A.adotaResposta(r); } catch (e) {}
      }
      if (r && r.status === 0 && !r.erro) r.erro = Tx('o servidor não respondeu — tente de novo em instantes');
      return r || { ok: false, status: 0, erro: Tx('o servidor não respondeu') };
    });
  }

  Srv.resumo = function () { return pede('/api/mercado/resumo'); };
  Srv.item = function (itemId) { return pede('/api/mercado/item?id=' + encodeURIComponent(itemId)); };
  Srv.meus = function () { return pede('/api/mercado/meus'); };
  Srv.propostas = function () { return pede('/api/mercado/propostas'); };
  Srv.avisos = function () { return pede('/api/mercado/avisos'); };
  /* a peça vai pela série (o índice do saco daqui pode não ser o do servidor) */
  Srv.anunciar = function (entrada, preco, invIndex) {
    var corpo = { preco: Math.floor(Number(preco)) };
    if (entrada && typeof entrada.iid === 'string' && entrada.iid) corpo.iid = entrada.iid;
    else corpo.invIndex = invIndex;
    return pede('/api/mercado/anunciar', corpo);
  };
  /* o LOTE de pedras (22/09): a mesma rota, com `tipo: 'pedra'`. O servidor tira as
   * pedras do estado dele (op interna mercadoTiraPedras) e devolve o estado novo */
  Srv.anunciarPedras = function (stoneId, qtd, preco) {
    return pede('/api/mercado/anunciar', { tipo: 'pedra', stoneId: stoneId,
                                            qtd: Math.floor(Number(qtd)), preco: Math.floor(Number(preco)) });
  };
  Srv.comprar = function (anuncioId) { return pede('/api/mercado/comprar', { anuncioId: anuncioId }); };
  Srv.propor = function (anuncioId, valor) {
    return pede('/api/mercado/propor', { anuncioId: anuncioId, valor: Math.floor(Number(valor)) });
  };
  Srv.cancelar = function (propostaId) { return pede('/api/mercado/cancelar', { propostaId: propostaId }); };
  Srv.responder = function (propostaId, aceitar) {
    return pede('/api/mercado/responder', { propostaId: propostaId, aceitar: !!aceitar });
  };
  Srv.confirmar = function (propostaId, aceitar) {
    return pede('/api/mercado/confirmar', { propostaId: propostaId, aceitar: !!aceitar });
  };
  Srv.retirar = function (anuncioId) { return pede('/api/mercado/retirar', { anuncioId: anuncioId }); };
  Srv.visto = function (marcas) {
    return JOGO.Sessao && JOGO.Sessao.api
      ? JOGO.Sessao.api('/api/mercado/visto', { method: 'POST', body: marcas || {} })
      : Promise.resolve({ ok: false, status: 0 });
  };

  /* ------------------------------------------------------------ os textos dos avisos */
  function nomeDo(itemId) {
    var it = (DATA().items || {})[itemId];
    if (it && it.name) return it.name;
    return temChave(pedrasDef(), itemId) ? M.nomePedra(itemId) : itemId;
  }
  /* o lote (22/09) se lê "50× Brasa Coagulada"; a peça, "Nome +2 ★1" */
  function peca(x) {
    if (M.ehLote(x)) return (x.qtd || 1) + '× ' + M.nomePedra(x.stoneId || x.itemId);
    return nomeDo(x.itemId) + (x.level ? ' +' + x.level : '') + (x.stars ? ' ★' + x.stars : '');
  }
  /* depois de "o", "do", "pelo": "o lote de 50× Brasa Coagulada", "o Ferrão de Vespa +1" */
  function oQue(x) { return (M.ehLote(x) ? Tx('lote de ') : '') + peca(x); }
  Srv.textoVenda = function (v) {
    return (v.viaProposta
      ? Tx('Vendido: {a} para {b} por {valor} vinténs (proposta) — taxa de {taxa}, +{recebeu} no saco.', { a: peca(v), b: v.comprador || Tx('um jogador'), valor: v.valor, taxa: v.taxa, recebeu: v.recebeu })
      : Tx('Vendido: {a} para {b} por {valor} vinténs — taxa de {taxa}, +{recebeu} no saco.', { a: peca(v), b: v.comprador || Tx('um jogador'), valor: v.valor, taxa: v.taxa, recebeu: v.recebeu }));
  };
  Srv.textoDesfecho = function (p) {
    if (p.estado === 'perdida') {
      return Tx('O {a} foi vendido a outro jogador — você perdeu essa negociação ({valor} vinténs).', { a: oQue(p), valor: p.valor });
    }
    if (p.estado === 'recusada') {
      return Tx('{a} recusou sua oferta de {valor} vinténs pelo {b}.', { a: p.vendedor || Tx('O vendedor'), valor: p.valor, b: oQue(p) });
    }
    return Tx('O anúncio do {a} saiu do balcão — sua oferta de {valor} vinténs foi cancelada.', { a: oQue(p), valor: p.valor });
  };
  Srv.textoRecebida = function (p) {
    return Tx('{a} ofereceu {valor} vinténs pelo seu {b} (à venda por {preco}). Responda em Meus anúncios.', { a: p.comprador || Tx('Um jogador'), valor: p.valor, b: oQue(p), preco: p.preco });
  };

  /* ------------------------------------------------------------ o vigia */
  var vigia = { ui: null, timer: null, ultimo: 0, pedindo: false, telaAntes: null,
                confirmar: [], mostrando: null, adiados: {} };
  function telaAtual() {
    try { return (JOGO.UI && JOGO.UI.telaAtual) ? JOGO.UI.telaAtual() : null; } catch (e) { return null; }
  }
  function emBatalha() {
    var G = JOGO.Game;
    return !!(G && G.screen === 'battle');
  }
  function ui(nome) {
    var u = vigia.ui;
    return (u && typeof u[nome] === 'function') ? u[nome] : null;
  }

  /* ui = { confirma(proposta), estaMostrando(), podeMostrar(), avisa([{texto, tipo}]), mudou(resposta) } */
  Srv.vigia = function (u) {
    vigia.ui = u || null;
    if (!vigia.timer && typeof setInterval === 'function' && typeof window !== 'undefined') {
      vigia.timer = setInterval(tique, Srv.TIQUE_MS);
    }
  };
  function tique() {
    if (!vigia.ui || !Srv.ligado()) { vigia.telaAntes = telaAtual(); return; }
    var t = telaAtual();
    var entrou = t === 'hub' && vigia.telaAntes !== 'hub';
    vigia.telaAntes = t;
    // a confirmação que sumiu da tela sem resposta (a ficha fechada no ✕) volta depois
    if (vigia.mostrando && ui('estaMostrando') && !ui('estaMostrando')()) {
      vigia.adiados[vigia.mostrando.id] = Date.now() + Srv.ADIA_MS;
      vigia.mostrando = null;
    }
    if (!emBatalha() && !vigia.pedindo &&
        (entrou || !vigia.ultimo || Date.now() - vigia.ultimo >= Srv.INTERVALO_MS)) {
      busca(entrou);
    } else if (t === 'hub') {
      mostraProximo();
    }
  }
  Srv._tique = tique;              // as provas

  function busca(voltouAPraca) {
    vigia.pedindo = true;
    vigia.ultimo = Date.now();
    if (voltouAPraca) vigia.adiados = {};          // a volta à praça traz de volta o que foi adiado
    return Srv.avisos().then(function (r) {
      vigia.pedindo = false;
      if (!r || !r.ok) return r;
      vigia.confirmar = (r.confirmar || []).slice();
      var textos = [], marcas = { desfechos: [], vendas: [], recebidas: [] };
      (r.vendas || []).forEach(function (v) { textos.push({ texto: Srv.textoVenda(v), tipo: 'good' }); marcas.vendas.push(v.id); });
      (r.desfechos || []).forEach(function (p) { textos.push({ texto: Srv.textoDesfecho(p), tipo: null }); marcas.desfechos.push(p.id); });
      (r.recebidas || []).forEach(function (p) { textos.push({ texto: Srv.textoRecebida(p), tipo: 'good' }); marcas.recebidas.push(p.id); });
      if (textos.length > Srv.AVISOS_UM_A_UM) {
        var resto = textos.length - Srv.AVISOS_UM_A_UM;
        textos = textos.slice(0, Srv.AVISOS_UM_A_UM);
        textos.push({ texto: (resto === 1
          ? Tx('E mais {resto} aviso do Mercadinho — veja em Meus anúncios e Minhas ofertas.', { resto: resto })
          : Tx('E mais {resto} avisos do Mercadinho — veja em Meus anúncios e Minhas ofertas.', { resto: resto })), tipo: null });
      }
      if (marcas.desfechos.length || marcas.vendas.length || marcas.recebidas.length) {
        Srv.visto(marcas);
        if (ui('avisa')) { try { ui('avisa')(textos); } catch (e) {} }
        if (ui('mudou')) { try { ui('mudou')(r); } catch (e2) {} }
      }
      if (telaAtual() === 'hub') mostraProximo();
      return r;
    }, function () { vigia.pedindo = false; });
  }
  Srv.buscaAvisos = function () { return busca(false); };

  function mostraProximo() {
    if (vigia.mostrando || !ui('confirma')) return;
    if (ui('podeMostrar') && !ui('podeMostrar')()) return;
    var agora = Date.now();
    var prox = vigia.confirmar.filter(function (p) { return !(vigia.adiados[p.id] > agora); })[0];
    if (!prox) return;
    vigia.mostrando = prox;
    try { ui('confirma')(prox); } catch (e) { vigia.mostrando = null; }
  }
  /* a HUD conta o que aconteceu com a confirmação mostrada: 'feito' (aceitou, negou,
   * perdeu) tira da fila; 'adiado' (sem saldo, saco cheio, sem rede) volta mais tarde */
  Srv.respondeuConfirmacao = function (proposta, desfecho) {
    if (!proposta) return;
    if (vigia.mostrando && vigia.mostrando.id === proposta.id) vigia.mostrando = null;
    if (desfecho === 'adiado') vigia.adiados[proposta.id] = Date.now() + Srv.ADIA_MS;
    else vigia.confirmar = vigia.confirmar.filter(function (p) { return p.id !== proposta.id; });
    if (typeof setTimeout === 'function') setTimeout(mostraProximo, 700);
  };
  Srv._vigia = function () { return vigia; };      // as provas
})();
