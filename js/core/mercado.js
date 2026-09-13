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
          var taxa = M.taxaDe(of.preco);
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
    if (!S || !S.api) return Promise.resolve({ ok: false, status: 0, erro: 'sem sessão' });
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
      if (r && r.status === 0 && !r.erro) r.erro = 'o servidor não respondeu — tente de novo em instantes';
      return r || { ok: false, status: 0, erro: 'o servidor não respondeu' };
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
    return (it && it.name) || itemId;
  }
  function peca(x) {
    return nomeDo(x.itemId) + (x.level ? ' +' + x.level : '') + (x.stars ? ' ★' + x.stars : '');
  }
  Srv.textoVenda = function (v) {
    return 'Vendido: ' + peca(v) + ' para ' + (v.comprador || 'um jogador') + ' por ' + v.valor + ' vinténs' +
      (v.viaProposta ? ' (proposta)' : '') + ' — taxa de ' + v.taxa + ', +' + v.recebeu + ' no saco.';
  };
  Srv.textoDesfecho = function (p) {
    if (p.estado === 'perdida') {
      return 'O ' + peca(p) + ' foi vendido a outro jogador — você perdeu essa negociação (' + p.valor + ' vinténs).';
    }
    if (p.estado === 'recusada') {
      return (p.vendedor || 'O vendedor') + ' recusou sua oferta de ' + p.valor + ' vinténs pelo ' + peca(p) + '.';
    }
    return 'O anúncio do ' + peca(p) + ' saiu do balcão — sua oferta de ' + p.valor + ' vinténs foi cancelada.';
  };
  Srv.textoRecebida = function (p) {
    return (p.comprador || 'Um jogador') + ' ofereceu ' + p.valor + ' vinténs pelo seu ' + peca(p) +
      ' (à venda por ' + p.preco + '). Responda em Meus anúncios.';
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
        textos.push({ texto: 'E mais ' + resto + (resto === 1 ? ' aviso' : ' avisos') +
          ' do Mercadinho — veja em Meus anúncios e Minhas ofertas.', tipo: null });
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
