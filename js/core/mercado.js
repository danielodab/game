// O Mercadinho — o HDV do Acampamento, a alma da economia (dono: lógica).
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
 */
(function () {
  'use strict';

  var M = {};
  JOGO.Mercado = M;

  M.TAXA = 0.05;               // 5% sobre a venda do jogador, mínimo 1
  M.POR_DIA = 0;               // 12/09: o mercador-fantasma não pendura mais nada
  M.PRECO_MAX = 9999;

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

  /* Abre o balcão. Ele NÃO se reconstrói: a data é só um carimbo (o resto do
   * jogo ainda a lê), e a lista de ofertas é preservada como está. A única
   * coisa que sai é a banca VELHA do mercador-fantasma, que ficou nos saves
   * de antes de 12/09 — e sai peça por peça, pelo dono da oferta, nunca
   * limpando a lista inteira. Save com forma estranha vira balcão vazio em
   * vez de derrubar o jogo, mas nenhuma oferta de jogador se perde por
   * causa de virada de dia ou de deploy. */
  M.abrir = function (dataForcada) {
    var db = DB();
    if (!db) return Promise.resolve(null);
    return db.mercadoLer().then(function (mc) {
      var dia = dataForcada || hoje();
      if (!mc || typeof mc !== 'object' || !isArray(mc.ofertas)) mc = { dia: null, ofertas: [] };
      var antes = mc.ofertas.length;
      var limpas = mc.ofertas.filter(function (o) {
        return o && o.itemId && o.vendedor !== 'mercador';
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
    if (!db) return Promise.resolve({ ok: false, erro: 'sem conta' });
    preco = Math.floor(Number(preco));
    if (!entrada || !entrada.itemId) return Promise.resolve({ ok: false, erro: 'peça inválida' });
    if (!isFinite(preco) || preco < 1 || preco > M.PRECO_MAX) {
      return Promise.resolve({ ok: false, erro: 'preço entre 1 e ' + M.PRECO_MAX });
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

  /* Compra uma oferta: debita o comprador, tira a oferta do balcão e — se o
   * vendedor é o jogador — credita o preço MENOS a taxa. A peça comprada
   * volta pelo retorno; quem a põe no saco é o chamador. */
  M.comprar = function (ofertaId, dataForcada) {
    var db = DB();
    if (!db) return Promise.resolve({ ok: false, erro: 'sem conta' });
    return M.abrir(dataForcada).then(function (mc) {
      var idx = -1;
      for (var i = 0; i < mc.ofertas.length; i++) {
        if (mc.ofertas[i].id === ofertaId) idx = i;
      }
      if (idx < 0) return { ok: false, erro: 'essa oferta já saiu do balcão' };
      var of = mc.ofertas[idx];
      return db.gastarMoedas(of.preco).then(function (pg) {
        if (!pg.ok) return { ok: false, erro: pg.erro || 'vinténs insuficientes' };
        mc.ofertas.splice(idx, 1);
        var repasse = 0;
        var cadeia = db.mercadoGravar(mc);
        if (of.vendedor === 'jogador') {
          var taxa = Math.max(1, Math.ceil(of.preco * M.TAXA));
          repasse = of.preco - taxa;
          cadeia = cadeia.then(function () { return db.ganharMoedas(repasse); });
        }
        return cadeia.then(function () {
          return { ok: true, item: { itemId: of.itemId, level: of.level, stars: of.stars, iid: of.iid || null },
                   pagou: of.preco, repasse: repasse };
        });
      });
    });
  };

  /* Retira uma oferta do PRÓPRIO jogador — a peça volta pelo retorno. */
  M.retirar = function (ofertaId, dataForcada) {
    var db = DB();
    if (!db) return Promise.resolve({ ok: false, erro: 'sem conta' });
    return M.abrir(dataForcada).then(function (mc) {
      var idx = -1;
      for (var i = 0; i < mc.ofertas.length; i++) {
        if (mc.ofertas[i].id === ofertaId) idx = i;
      }
      if (idx < 0) return { ok: false, erro: 'essa oferta já saiu do balcão' };
      var of = mc.ofertas[idx];
      if (of.vendedor !== 'jogador') return { ok: false, erro: 'a banca do mercador não é sua' };
      mc.ofertas.splice(idx, 1);
      return db.mercadoGravar(mc).then(function () {
        return { ok: true, item: { itemId: of.itemId, level: of.level, stars: of.stars, iid: of.iid || null } };
      });
    });
  };
})();
