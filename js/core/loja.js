/* loja.js — a loja de vinténs do site entregando no jogo (Fase C, 10/09).
 *
 * O jogador compra no site (site/loja.html → POST /api/loja/comprar) e o
 * pedido fica PENDENTE no cartório, com a entrega congelada. O jogo, aberto
 * logado na conta local Principal, RETIRA os pedidos (POST /api/loja/retirar:
 * o pendente vira retirado), aplica cada um no save local e anota o id em
 * `db.loja` (DB.lojaAplica / lojaRecusa). A anotação sobe no PUT /api/save de
 * sempre, e o SERVIDOR fecha o pedido (entregue/estornado) no mesmo BEGIN
 * IMMEDIATE que grava o save: a entrega nunca se separa da versão do save que
 * a contém — um 409 de outra máquina descarta as duas juntas e o pedido volta
 * na próxima retirada. Por isso não há rota de confirmação, e a nuvem.js não
 * muda: as gravações de sempre agendam a subida.
 *
 * QUANDO BUSCA — só com sessão, na conta local Principal, com a Nuvem ligada
 * e sem `parada`, e só na aba visível (dentro de navigator.locks, se houver):
 *   · a 1ª vez depois do 1º aviso `soterra:nuvem` de tipo emdia ou subiu
 *     (antes disso o save local ainda pode ser trocado pelo do servidor);
 *   · quando a aba volta para a frente (no máximo 1 a cada 30 s);
 *   · a cada 5 minutos;
 *   · quando o site avisa que comprou (BroadcastChannel 'soterra-loja').
 * Um aviso de que a página vai recarregar (puxou, desatualizado, limpou,
 * conta) CONGELA tudo: nada se aplica num save que está para ser trocado.
 *
 * APLICAR, na ordem:
 *   1. id já anotado: pula;
 *   2. tipo desconhecido: pula SEM anotar (uma versão nova do jogo aplica);
 *   3. checagem de leitura: pedra fora de DATA.stones ou a Âncora, classe
 *      inexistente/que nasce liberada/gm, quantidade torta, bônus sem o
 *      `agora` do servidor → 'item-invalido'; classe já liberada →
 *      'classe-ja-liberada' (estorno; nunca vira carta de estrela);
 *   4. DB.lojaAplica decide e grava por dentro (sem saldo → 'sem-saldo') —
 *      ou, no CRÉDITO de vinténs, DB.lojaCredita (soma e anota; nada a entregar);
 *   5. no .then IMEDIATO, sem rede no meio, a entrega pelo Progress; se ela
 *      lançar, DB.lojaDesfaz devolve os vinténs ('erro-local');
 *   6. window 'soterra:loja' {tipo:'entregue'|'recusado', pedido, motivo,
 *      origem[, ate]}.
 *
 * AS ENTREGAS DA LOJA 2 (10/09) — a mesma fila, três tipos a mais:
 *   bonus-xp  {alvo:'xp', qtd: dias 1..366, agora}: o bônus de XP por TEMPO.
 *             `agora` é o relógio do SERVIDOR (epoch em segundos) no instante
 *             da retirada: o prazo corre a partir da ENTREGA, e comprar de novo
 *             SOMA dias (Progress.addBonusXpDias). Sem `agora`, 'item-invalido'.
 *   insignias {alvo:'fundacao', qtd 1..999}: Progress.addInsignia.
 *   vintens   {alvo:'carteira', qtd 1..10.000.000}: um CRÉDITO de preço 0 (um
 *             pacote pago no site, ou um presente do Mestre). Não passa pelo
 *             lojaAplica: DB.lojaCredita decide, soma no bolso e anota num
 *             gravar só. O retirar vem em ORDEM DE ID e o crédito nasce antes
 *             de qualquer compra feita com ele: na mesma busca ele entra antes.
 *   barras    {alvo:'conta', qtd 1..1.000.000} (13/09): a troca de VINTÉNS por
 *             barras de ouro. As barras moram na conta do SITE (o jogo não as
 *             conhece): aqui só se pagam os vinténs do `preco` pelo lojaAplica,
 *             e a entrega não mexe em mais nada. O servidor credita as barras
 *             quando o pedido fecha 'entregue'.
 * O PRÊMIO DO ECO PRIMORDIAL (02/10, servidor/supremo.py): no fechamento da
 * semana o servidor põe na fila, para cada conta do ranking, os vinténs da
 * faixa ({tipo:'vintens'}, o crédito de sempre) e, quando há, um pedido
 *   premio-eco {alvo:'eco', qtd:1, semana, posicao, selos:{fogo,agua,terra,ar},
 *               titulo: 'Voz do Eco'|null}
 * de preço 0: os selos entram por Progress.addSelo e o título por
 * Progress.addTituloEco (só os do catálogo JOGO.Titulos.ECO). Origem 'eco'.
 * AS NOVIDADES DE 04/10 (servidor/loja.py):
 *   pacote    {alvo:'boas-vindas', qtd:1, itens:[{tipo:'pedras'|'classe', …}], aura}: o
 *             Pacote de Boas-Vindas. TODOS os itens são conferidos antes de qualquer
 *             entrega — a classe já liberada recusa o pacote INTEIRO (as barras voltam
 *             no servidor) —, e só então entram um a um. A aura não mora no save: a
 *             posse é do servidor (o pedido), e a ficha do Personagem a lê de lá.
 *   aura      {alvo: cor, qtd:1}: a aura presenteada pelo Mestre (a comprada já nasce
 *             entregue e nem passa por aqui). Nada a pôr no save: só o aviso.
 *   origem 'amigo' (com `pedido.de`, o nome de quem mandou): o presente de um amigo.
 *   peca      {alvo: itemId, qtd 1..20[, nivel, estrelas]}: uma PEÇA de equipamento. Vai sempre
 *             para o BANCO (o cofre do Acampamento), nunca para o saco: o saco cheio recusaria
 *             a entrega, e o que foi comprado não pode sumir. Cada cópia nasce com série própria.
 * A COMPRA VALE NA HORA (04/10, o dono: "comprei barras de ouro com vinténs e as barras não
 * entraram na minha conta.. precisa ser na hora"). Com a autoridade ligada o SERVIDOR entrega
 * dentro da própria compra (servidor/loja.py, _loja_na_hora) — este arquivo roda lá, no juiz —, e
 * o jogo aberto fica sabendo pelo /api/eu de 30 s ('soterra:entregas': o js/ui/moderacao.js adota
 * o estado sem apagar o que o jogador fez e avisa "Chegou da loja: …"). Sem a autoridade (em
 * casa) a fila continua, mas o /api/eu conta os pedidos que esperam (`lojaAbertos`) e o jogo
 * busca em até 30 s ('soterra:loja-abertos'), em vez de esperar os 5 minutos.
 * AS ORIGENS: o pedido pode trazer `origem` — 'presente' (o Mestre deu, pelo
 * painel dele: preço 0, o MESMO caminho, nenhuma regra à parte) ou 'pagamento'
 * (os vinténs de um pacote pago). Sem ela, ou com outra coisa, é compra da
 * loja. O aviso leva `detail.origem` ('loja' | 'presente' | 'pagamento') — a
 * HUD escreve "Presente do Mestre: …" ou "Chegaram N vinténs do seu pacote" —
 * e, no bônus entregue, `detail.ate` (o fim do prazo, em segundos do servidor).
 *
 * JOGO.Loja: buscar(), aplicar(pedido) → Promise<{ok, motivo, origem}>, estado().
 * Ganchos de teste: `_semRede` (uma função (rota, op) → resposta, no lugar do
 * cartório), `_semTrava` (sem a trava entre abas) e `_reinicia()` (o módulo
 * volta ao estado de página nova). */
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
  var JOGO = window.JOGO = window.JOGO || {};
  var L = JOGO.Loja = {};
  L.INTERVALO_MS = 5 * 60 * 1000;   // a busca de fundo
  L.VISIVEL_MS = 30 * 1000;         // a aba voltando para a frente busca no máximo 1 vez nisto
  L.CANAL = 'soterra-loja';         // o nome do BroadcastChannel e da trava
  L._semRede = null;
  /* teste: pula a trava entre abas. O Chrome sem cabeça com tempo virtual só
   * concede a trava do navigator.locks muito depois (a resposta vem de fora
   * da página), e a prova travava esperando; no navegador de verdade ela sai
   * na hora. */
  L._semTrava = false;

  // as entregas que esta versão sabe aplicar (a tabela 4.6 do plano da loja 2)
  var TIPOS = { pedras: 1, classe: 1, pergaminho: 1, 'bonus-xp': 1, insignias: 1, vintens: 1, barras: 1,
                'premio-eco': 1,     // 02/10: o prêmio da semana do Eco Primordial
                pacote: 1, aura: 1,     // 04/10: o Pacote de Boas-Vindas e a aura da praça
                moldura: 1,             // 08/10: a moldura premium da plaquinha
                guilda: 1,              // 08/10 à noite: os pergaminhos da guilda (posse = pedido; o líder gasta na ficha)
                peca: 1 };              // 04/10: a peça de equipamento, que vai para o banco
  var TETO_PECAS = 20;            // cópias de uma peça numa entrega
  var AURAS = ['fogo', 'agua', 'terra', 'ar', 'neutra', 'sombra', 'gelo', 'ouro'];   // o gêmeo de loja.AURAS (servidor); 08/10: + três
  var MOLDURAS = ['ouro', 'rubi', 'esmeralda', 'obsidiana'];   // 08/10: o gêmeo de loja.MOLDURAS_LOJA
  var MOLDURAS_DA_FICHA = MOLDURAS.concat(['mestre']);           // a do Mestre chega na vitrine da conta dele
  // 04/10: a 'mestre' (Chama do Mestre) não é entrega da loja — só a conta do Mestre a tem, pelo servidor
  // ...mas CHEGA na vitrine dessa conta: a ficha aceita as da loja e as do Mestre (o filtro só com AURAS a jogava fora)
  var AURAS_DA_FICHA = AURAS.concat(['mestre']);
  var ITENS_DO_PACOTE = { pedras: 1, classe: 1 };          // o que um pacote pode trazer dentro
  var TETO_ITENS_PACOTE = 12;
  var ELEMENTOS_SELO = ['fogo', 'agua', 'terra', 'ar'];
  var TETO_SELOS = 999;           // selos de um elemento numa entrega do Eco
  var TETO_DIAS = 366;            // bônus de XP: dias numa entrega
  var TETO_VINTENS = 10000000;    // crédito de vinténs: por pedido
  var TETO_BARRAS = 1000000;      // 13/09: barras de ouro compradas com vinténs, por pedido
  var TETO_EPOCH_S = 4e9;         // o `agora` do servidor, em segundos (o mesmo teto do Progress)
  var liberada = false, congelada = false, buscando = null, ultima = 0, erro = null;
  var compraPendente = false, timer = null, historico = [];

  function S() { return JOGO.Sessao || null; }
  function N() { return JOGO.Nuvem || null; }
  function P() { return JOGO.Progress || null; }
  function DB() { return JOGO.DB || null; }
  function D() { return JOGO.DATA || {}; }
  function oculta() { try { return !!(typeof document !== 'undefined' && document.hidden); } catch (e) { return false; } }
  function inteiroPos(v, teto) {
    return typeof v === 'number' && isFinite(v) && v > 0 && Math.floor(v) === v && v <= teto;
  }
  function copia(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } }
  function autoridadeLigada() {
    try { return !!(JOGO.Autoridade && JOGO.Autoridade.ligada && JOGO.Autoridade.ligada()); } catch (e) { return false; }
  }

  /* Por que NÃO buscar agora (null = pode). */
  function porQueNao() {
    if (congelada) return Tx('a página vai recarregar');
    var s = S(), n = N();
    if (!s || !s.ativa || !s.ativa()) return Tx('sem sessão');
    if (!n || !n.estado) return 'sem a nuvem';
    var e = n.estado();
    if (!e.principal) return 'conta local';
    if (!e.ligada) return Tx('a nuvem está desligada');
    if (e.parada) return Tx('a nuvem está parada');
    if (!liberada) return 'esperando a nuvem';
    if (!DB() || !DB().lojaAplica || !P()) return 'sem o jogo';
    if (oculta()) return 'aba escondida';
    return null;
  }

  L.estado = function () {
    var nao = porQueNao();
    return { liberada: liberada, congelada: congelada, buscando: !!buscando, ultimaBusca: ultima,
             erro: erro, pode: !nao, porQueNao: nao, historico: historico.slice() };
  };

  function pede(rota, op) {
    if (typeof L._semRede === 'function') {
      try { return Promise.resolve(L._semRede(rota, op)); }
      catch (e) { return Promise.resolve({ ok: false, status: 0, erro: String(e && e.message || e) }); }
    }
    return S().api(rota, op);
  }

  /* A trava entre abas do mesmo navegador: quem não pega, não busca (a outra
   * aba já está buscando). Sem Web Locks — ou se o navegador recusar a trava
   * nesta origem —, segue sem ela: a aba visível é uma só. */
  function comTrava(fn) {
    var lk = null;
    if (L._semTrava) return fn();
    try { lk = (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) ? navigator.locks : null; }
    catch (e) { lk = null; }
    if (!lk) return fn();
    var rodou = false, p;
    try {
      p = lk.request(L.CANAL, { ifAvailable: true }, function (trava) {
        rodou = true;
        if (!trava) return { ok: false, erro: Tx('outra aba está buscando') };
        return fn();
      });
    } catch (e2) { return fn(); }
    return Promise.resolve(p).then(null, function (e3) { if (!rodou) return fn(); throw e3; });
  }

  L.buscar = function () {
    var nao = porQueNao();
    if (nao) return Promise.resolve({ ok: false, erro: nao });
    if (buscando) return buscando;
    buscando = comTrava(function () {
      var nao2 = porQueNao();                      // de novo, dentro da trava
      if (nao2) return { ok: false, erro: nao2 };
      return pede('/api/loja/retirar', { method: 'POST', body: {} }).then(function (r) {
        ultima = Date.now();
        if (!r || !r.ok) {
          erro = (r && r.erro) || ('HTTP ' + (r ? r.status : '?'));
          return { ok: false, erro: erro, status: r ? r.status : 0 };
        }
        erro = null;
        var lista = Array.isArray(r.pedidos) ? r.pedidos : [];
        /* A SEGURANÇA (13/09): com a autoridade ligada o servidor JÁ entregou
         * (o juiz rodou a entrega no estado da conta) e mandou o estado novo.
         * Aqui só se adota e se avisa a tela — aplicar de novo daria em dobro. */
        var Aut = JOGO.Autoridade;
        if ((r.progress || r.db) && Aut && Aut.adota) {
          Aut.adota(r.progress, r.db);
          lista.forEach(function (ped) { avisa('entregue', ped, null); });
          return { ok: true, pedidos: lista.length, peloServidor: true };
        }
        return emFila(lista).then(function (res) { return { ok: true, pedidos: lista.length, resultados: res }; });
      });
    }).then(function (x) { buscando = null; return x; }, function (e) {
      buscando = null;
      erro = String(e && e.message || e);
      return { ok: false, erro: erro };
    });
    return buscando;
  };

  // um pedido de cada vez: cada um vê o saldo que o anterior deixou
  function emFila(lista) {
    var res = [];
    return lista.reduce(function (p, ped) {
      return p.then(function () { return L.aplicar(ped).then(function (r) { res.push(r); }); });
    }, Promise.resolve()).then(function () { return res; });
  }

  /* de onde veio o pedido: 'presente' (o Mestre deu), 'pagamento' (os vinténs
   * de um pacote pago) ou 'loja' (a compra de sempre — e qualquer outra coisa) */
  function origemDe(p) {
    var o = (p && typeof p === 'object') ? p.origem : null;
    // 02/10: 'eco', o prêmio da semana; 04/10: 'amigo', o presente de outro jogador; 07/10: 'trilha', o degrau resgatado
    return (o === 'presente' || o === 'pagamento' || o === 'eco' || o === 'amigo' || o === 'trilha') ? o : 'loja';
  }
  function registra(p, tipo, motivo) {
    historico.push({ id: p && p.id, sku: (p && p.sku) || null, nome: (p && p.nome) || null,
                     tipo: tipo, motivo: motivo || null, origem: origemDe(p), em: Date.now() });
    if (historico.length > 50) historico.shift();
  }
  // `extra` (opcional) entra no detail: o bônus de XP entregue leva `ate`
  function avisa(tipo, p, motivo, extra) {
    registra(p, tipo, motivo);
    var det = { tipo: tipo, pedido: copia(p), motivo: motivo || null, origem: origemDe(p) };
    if (extra && typeof extra === 'object') {
      for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) det[k] = extra[k];
    }
    try {
      window.dispatchEvent(new CustomEvent('soterra:loja', { detail: det }));
    } catch (e) {}
    // 04/10: chegou uma aura (ou o Pacote que traz uma): a ficha do Personagem e a chamada leem de novo
    var te = (p && p.entrega && typeof p.entrega === 'object') ? p.entrega.tipo : null;
    if (tipo === 'entregue' && (te === 'aura' || te === 'pacote' || te === 'moldura')) { try { L.vitrine(true); } catch (e2) {} }
  }

  /* ------------------------------------------------ A VITRINE E A AURA (04/10)
   * GET /api/loja/vitrine traz, num pedido só, o que o jogo mostra da loja sem repetir número
   * nenhum: as ofertas da semana com o `fim` (a contagem regressiva, no relógio do SERVIDOR), se o
   * Pacote de Boas-Vindas ainda está disponível para esta conta, e as auras — as que a conta TEM e
   * a que ela veste. Só precisa de sessão (não da Nuvem: nada aqui mexe no save). A resposta fica
   * guardada por VITRINE_MS; quem muda alguma coisa (a aura escolhida, uma entrega) pede de novo.
   * Cada leitura nova dispara window 'soterra:vitrine' — a HUD acende a aura na praça, reanuncia o
   * perfil na Rede e repinta a chamada. */
  L.VITRINE_MS = 5 * 60 * 1000;
  var vit = null, vitEm = 0, vitBusca = null;
  function lista(v) { return Object.prototype.toString.call(v) === '[object Array]' ? v : []; }
  function comSessao() {
    if (typeof L._semRede === 'function') return true;
    var s = S();
    return !!(s && s.ativa && s.ativa() && s.api);
  }
  function guardaVitrine(r) {
    var a = (r.auras && typeof r.auras === 'object') ? r.auras : {};
    var tem = lista(a.tem).filter(function (c) { return AURAS_DA_FICHA.indexOf(c) >= 0; });
    var todas = lista(a.todas).filter(function (x) { return x && AURAS_DA_FICHA.indexOf(x.cor) >= 0; })
      .map(function (x) { return { cor: x.cor, nome: String(x.nome || x.cor) }; });
    // 08/10: as molduras premium, no molde das auras
    var mo = (r.molduras && typeof r.molduras === 'object') ? r.molduras : {};
    var temM = lista(mo.tem).filter(function (c) { return MOLDURAS_DA_FICHA.indexOf(c) >= 0; });
    var todasM = lista(mo.todas).filter(function (x) { return x && MOLDURAS_DA_FICHA.indexOf(x.id) >= 0; })
      .map(function (x) { return { id: x.id, nome: String(x.nome || x.id) }; });
    var of = (r.ofertas && typeof r.ofertas === 'object') ? r.ofertas : {};
    var bv = (r.boasVindas && typeof r.boasVindas === 'object') ? r.boasVindas : {};
    vit = { agora: Number(r.agora) || 0,
            auras: { tem: tem, escolhida: tem.indexOf(a.escolhida) >= 0 ? a.escolhida : null, todas: todas },
            molduras: { tem: temM, escolhida: temM.indexOf(mo.escolhida) >= 0 ? mo.escolhida : null, todas: todasM },
            ofertas: { desconto: Number(of.desconto) || 0, fim: Number(of.fim) || 0,
                       itens: lista(of.itens).map(function (i) {
                         return { nome: String((i && i.nome) || ''), preco: Number(i && i.preco) || 0,
                                  precoCheio: Number(i && i.precoCheio) || 0 };
                       }) },
            boasVindas: { disponivel: bv.disponivel === true, preco: Number(bv.preco) || 0,
                          precoCheio: Number(bv.precoCheio) || 0 } };
    vitEm = Date.now();
    try { window.dispatchEvent(new CustomEvent('soterra:vitrine', { detail: copia(vit) })); } catch (e) {}
    return vit;
  }
  L.vitrine = function (forca) {
    if (!comSessao()) return Promise.resolve(null);
    if (vitBusca) return vitBusca;
    if (!forca && vit && Date.now() - vitEm < L.VITRINE_MS) return Promise.resolve(vit);
    vitBusca = Promise.resolve(pede('/api/loja/vitrine', { method: 'GET' })).then(function (r) {
      vitBusca = null;
      return (r && r.ok) ? guardaVitrine(r) : vit;
    }, function () { vitBusca = null; return vit; });
    return vitBusca;
  };
  L.vitrineAtual = function () { return vit; };
  /* os segundos do SERVIDOR agora (o da última leitura mais o que passou aqui): a contagem
   * regressiva das ofertas não depende do relógio do aparelho estar certo */
  L.agoraServidor = function () { return vit ? vit.agora + Math.floor((Date.now() - vitEm) / 1000) : 0; };
  L.auraEscolhida = function () { return (vit && vit.auras.escolhida) || null; };
  L.molduraEscolhida = function () { return (vit && vit.molduras && vit.molduras.escolhida) || null; };   // 08/10
  /* 08/10: a moldura premium da plaquinha — uma das que a conta tem, ou null ('auto', a do título) */
  L.escolheMoldura = function (id) {
    if (id !== null && MOLDURAS_DA_FICHA.indexOf(id) < 0) return Promise.resolve({ ok: false, erro: 'moldura desconhecida' });
    if (!comSessao()) return Promise.resolve({ ok: false, erro: Tx('sem sessão') });
    return Promise.resolve(pede('/api/loja/moldura', { method: 'POST', body: { moldura: id } })).then(function (r) {
      if (!r || !r.ok) return { ok: false, erro: (r && r.erro) || Tx('não deu para trocar a moldura agora') };
      if (vit && r.molduras) {
        guardaVitrine({ agora: L.agoraServidor(), auras: vit.auras, molduras: r.molduras, ofertas: vit.ofertas, boasVindas: vit.boasVindas });
      }
      return { ok: true, escolhida: L.molduraEscolhida() };
    }, function (e) { return { ok: false, erro: String(e && e.message || e) }; });
  };
  /* liga, troca ou desliga (null) a aura da praça: o SERVIDOR confere a posse e guarda a escolha */
  L.escolheAura = function (cor) {
    if (cor !== null && AURAS_DA_FICHA.indexOf(cor) < 0) return Promise.resolve({ ok: false, erro: 'aura desconhecida' });
    if (!comSessao()) return Promise.resolve({ ok: false, erro: Tx('sem sessão') });
    return Promise.resolve(pede('/api/loja/aura', { method: 'POST', body: { aura: cor } })).then(function (r) {
      if (!r || !r.ok) return { ok: false, erro: (r && r.erro) || Tx('não deu para trocar a aura agora') };
      if (vit && r.auras) {
        guardaVitrine({ agora: L.agoraServidor(), auras: r.auras, molduras: vit.molduras, ofertas: vit.ofertas, boasVindas: vit.boasVindas });
      }
      return { ok: true, escolhida: L.auraEscolhida() };
    }, function (e) { return { ok: false, erro: String(e && e.message || e) }; });
  };

  function ancora() {
    var up = D().upgrade || {};
    return up.guardStone || 'stone-anchor';
  }
  /* 3. a checagem SÓ DE LEITURA: nada grava aqui */
  L._confere = function (ent) { return confere(ent); };   // prova (tests/gema.js)
  function confere(ent) {
    var prog = P();
    if (ent.tipo === 'pedras') {
      var sd = (typeof ent.alvo === 'string') ? (D().stones || {})[ent.alvo] : null;
      // 08/10: o Fragmento de Gema se vende (e vem do anúncio); a Gema inteira, como a Âncora, não
      if (!sd || ent.alvo === ancora() || sd.element === 'forja' || sd.element === 'gema') return 'item-invalido';
      if (!inteiroPos(ent.qtd, 999)) return 'item-invalido';
      return null;
    }
    if (ent.tipo === 'classe') {
      var cd = (typeof ent.alvo === 'string') ? (D().classes || {})[ent.alvo] : null;
      if (!cd || ent.alvo === 'gm') return 'item-invalido';     // 08/10: as comuns também se vendem (iniciais livres)
      if (prog.isClassUnlocked(ent.alvo)) return 'classe-ja-liberada';
      return null;
    }
    if (ent.tipo === 'pergaminho') {
      if (ent.alvo !== 'xp' && ent.alvo !== 'elemento') return 'item-invalido';
      if (!inteiroPos(ent.qtd, 99)) return 'item-invalido';
      return null;
    }
    // loja 2: o bônus de XP por tempo só entra com o relógio do SERVIDOR
    if (ent.tipo === 'bonus-xp') {
      if (ent.alvo !== 'xp' || !inteiroPos(ent.qtd, TETO_DIAS)) return 'item-invalido';
      if (!(typeof ent.agora === 'number' && isFinite(ent.agora) && ent.agora > 0 && ent.agora < TETO_EPOCH_S)) {
        return 'item-invalido';
      }
      return null;
    }
    if (ent.tipo === 'insignias') {
      if (ent.alvo !== 'fundacao' || !inteiroPos(ent.qtd, 999)) return 'item-invalido';
      return null;
    }
    if (ent.tipo === 'vintens') {
      if (ent.alvo !== 'carteira' || !inteiroPos(ent.qtd, TETO_VINTENS)) return 'item-invalido';
      return null;
    }
    // 13/09: vinténs → barras de ouro (as barras entram na conta do site; aqui só se pagam os vinténs)
    if (ent.tipo === 'barras') {
      if (ent.alvo !== 'conta' || !inteiroPos(ent.qtd, TETO_BARRAS)) return 'item-invalido';
      return null;
    }
    // 02/10: o prêmio do Eco — selos dos quatro elementos e o título do catálogo, pelo menos um dos dois
    if (ent.tipo === 'premio-eco') {
      if (ent.alvo !== 'eco' || ent.qtd !== 1) return 'item-invalido';
      var sl = ent.selos, algum = false;
      if (sl != null && (typeof sl !== 'object' || Object.prototype.toString.call(sl) === '[object Array]')) return 'item-invalido';
      for (var el in (sl || {})) {
        if (!Object.prototype.hasOwnProperty.call(sl, el)) continue;
        if (ELEMENTOS_SELO.indexOf(el) < 0 || !inteiroPos(sl[el], TETO_SELOS)) return 'item-invalido';
        algum = true;
      }
      if (ent.titulo != null) {
        var T = JOGO.Titulos, ok = false;
        ((T && T.ECO) || []).forEach(function (d) { if (d && d.titulo === ent.titulo) ok = true; });
        if (!ok || !prog.addTituloEco) return 'item-invalido';
        algum = true;
      }
      return algum ? null : 'item-invalido';
    }
    // 04/10: a peça que vai para o banco — só a que existe no jogo, com nível e estrelas dentro da régua
    if (ent.tipo === 'peca') {
      if (typeof ent.alvo !== 'string' || !(D().items || {})[ent.alvo] || !inteiroPos(ent.qtd, TETO_PECAS)) return 'item-invalido';
      if (ent.nivel != null && ent.nivel !== 0 && !inteiroPos(ent.nivel, 30)) return 'item-invalido';
      if (ent.estrelas != null && ent.estrelas !== 0 && !inteiroPos(ent.estrelas, 10)) return 'item-invalido';
      if (!prog.novaCopia || !DB().depositarItem) return 'item-invalido';
      return null;
    }
    // 04/10: a aura (só a cor conhecida; nada entra no save)
    if (ent.tipo === 'aura') {
      return (AURAS.indexOf(ent.alvo) >= 0 && ent.qtd === 1) ? null : 'item-invalido';
    }
    // 08/10: a moldura premium (só a id conhecida; nada entra no save)
    if (ent.tipo === 'moldura') {
      return (MOLDURAS.indexOf(ent.alvo) >= 0 && ent.qtd === 1) ? null : 'item-invalido';
    }
    /* 04/10: o Pacote de Boas-Vindas. Cada item passa pela MESMA checagem de quando é vendido
     * avulso, e todos antes de qualquer entrega: o primeiro que não puder entrar recusa o pacote
     * inteiro com o motivo dele (a classe já liberada devolve as barras, nunca vira pedra solta). */
    if (ent.tipo === 'pacote') {
      var its = ent.itens;
      if (ent.alvo !== 'boas-vindas' || ent.qtd !== 1 || AURAS.indexOf(ent.aura) < 0) return 'item-invalido';
      if (Object.prototype.toString.call(its) !== '[object Array]' || !its.length || its.length > TETO_ITENS_PACOTE) {
        return 'item-invalido';
      }
      for (var pi = 0; pi < its.length; pi++) {
        var it = its[pi];
        if (!it || typeof it !== 'object' || ITENS_DO_PACOTE[it.tipo] !== 1) return 'item-invalido';
        var ruimI = confere(it);
        if (ruimI) return ruimI;
      }
      return null;
    }
    return 'item-invalido';
  }
  /* 5. a entrega — lança se o Progress não aceitar (o chamador desfaz); o
   * bônus de XP devolve {ate}, para o aviso dizer até quando ele vale */
  function entrega(ent) {
    var prog = P();
    if (ent.tipo === 'pedras') {
      if (!prog.addStones(ent.alvo, ent.qtd)) throw new Error('as pedras não entraram');
      return;
    }
    if (ent.tipo === 'classe') {
      // nunca só unlockClass: as cartas vão até o custo, e o excedente fica
      // em ZERO — as próximas cartas que caírem já contam para estrela
      var info = prog.cardInfo(ent.alvo) || {};
      var falta = Math.max(0, Math.floor(Number(info.unlockCost) || 0) - Math.floor(Number(info.cards) || 0));
      if (falta > 0) prog.addCards(ent.alvo, falta);
      if (!prog.isClassUnlocked(ent.alvo)) prog.unlockClass(ent.alvo);
      if (!prog.isClassUnlocked(ent.alvo)) throw new Error('a classe não liberou');
      return;
    }
    if (ent.tipo === 'pergaminho') {
      if (!prog.addPergaminho || !prog.addPergaminho(ent.alvo, ent.qtd)) throw new Error('o pergaminho não entrou');
      return;
    }
    if (ent.tipo === 'bonus-xp') {
      var rb = prog.addBonusXpDias ? prog.addBonusXpDias(ent.qtd, ent.agora) : null;
      if (!rb || !rb.ok) throw new Error('o bônus de XP não entrou');
      return { ate: rb.ate };
    }
    if (ent.tipo === 'insignias') {
      if (!prog.addInsignia || !prog.addInsignia(ent.qtd)) throw new Error('as insígnias não entraram');
      return;
    }
    if (ent.tipo === 'barras') return;   // os vinténs já saíram no lojaAplica; as barras, o servidor credita
    if (ent.tipo === 'peca') {
      /* SEMPRE no banco, nunca no saco: o saco tem limite e a compra não pode ser recusada (nem
       * sumir) por falta de vaga. As cópias são cunhadas todas antes de a primeira entrar — se
       * uma falhar, nenhuma entrou e o chamador desfaz o pagamento. */
      var copias = [];
      for (var ci = 0; ci < ent.qtd; ci++) {
        var nova = prog.novaCopia(ent.alvo, 'loja', ent.nivel || 0, ent.estrelas || 0);
        if (!nova) throw new Error('a peça não entrou');
        copias.push(nova);
      }
      copias.forEach(function (c) { DB().depositarItem(c); });
      prog.save();
      return;
    }
    if (ent.tipo === 'aura') return;     // 04/10: a posse da aura é do servidor; aqui só sai o aviso
    if (ent.tipo === 'moldura') return;  // 08/10: idem a moldura premium
    if (ent.tipo === 'pacote') {         // 04/10: o Pacote de Boas-Vindas, item a item (já conferidos todos)
      for (var qi = 0; qi < ent.itens.length; qi++) entrega(ent.itens[qi]);
      return;
    }
    if (ent.tipo === 'premio-eco') {     // 02/10: os selos e o título do pódio da semana do Eco
      var sl2 = ent.selos || {};
      for (var e2 = 0; e2 < ELEMENTOS_SELO.length; e2++) {
        var q2 = sl2[ELEMENTOS_SELO[e2]];
        if (q2 && !prog.addSelo(ELEMENTOS_SELO[e2], q2)) throw new Error('os selos não entraram');
      }
      if (ent.titulo != null && !prog.addTituloEco(ent.titulo)) throw new Error('o título não entrou');
      return;
    }
    throw new Error('tipo sem entrega');
  }
  function recusa(p, id, motivo) {
    return DB().lojaRecusa(id, motivo).then(function (r) {
      if (r && r.ja) return { ok: false, motivo: 'ja' };
      if (!r || !r.ok) return { ok: false, motivo: 'erro-local' };
      avisa('recusado', p, motivo);
      return { ok: false, motivo: motivo };
    });
  }

  /* o resultado de cada pedido leva o id e a origem dele (a busca devolve a lista) */
  L.aplicar = function (p) {
    var id = (p && typeof p === 'object') ? p.id : null;
    return aplicaUm(p).then(function (r) {
      if (r && typeof r === 'object') { r.id = id; r.origem = origemDe(p); }
      return r;
    });
  };
  function aplicaUm(p) {
    var db = DB(), prog = P();
    if (!db || !db.lojaAplica || !prog) return Promise.resolve({ ok: false, motivo: 'sem-jogo' });
    if (congelada) return Promise.resolve({ ok: false, motivo: 'recarregando' });
    var id = (p && inteiroPos(p.id, 9007199254740991)) ? p.id : 0;
    if (!id) return Promise.resolve({ ok: false, motivo: 'pedido-invalido' });
    var ent = (p.entrega && typeof p.entrega === 'object') ? p.entrega : {};
    var preco = Math.max(0, Math.floor(Number(p.preco) || 0));
    return db.lojaVer().then(function (anot) {
      // 1. já tratado aqui
      if (anot.aplicadas.indexOf(id) >= 0 || anot.recusadas.some(function (r) { return r.id === id; })) {
        return { ok: false, motivo: 'ja' };
      }
      // 2. tipo que esta versão não conhece: fica para uma versão nova
      if (TIPOS[ent.tipo] !== 1 || (ent.tipo === 'vintens' && !db.lojaCredita)) {
        registra(p, 'ignorado', 'tipo-desconhecido');
        return { ok: false, motivo: 'tipo-desconhecido' };
      }
      // 3. a checagem de leitura
      var ruim = confere(ent);
      if (ruim) return recusa(p, id, ruim);
      // 4b. o CRÉDITO de vinténs (pacote pago, presente do Mestre) não passa
      // pelo lojaAplica: o DB decide, soma no bolso e anota num gravar só. Com
      // a página recarregando nada se escreve (o crédito volta na próxima)
      if (ent.tipo === 'vintens') {
        if (congelada) return { ok: false, motivo: 'recarregando' };
        return db.lojaCredita(id, ent.qtd).then(function (rc) {
          if (rc && rc.ja) return { ok: false, motivo: 'ja' };
          if (!rc || !rc.ok) return { ok: false, motivo: 'erro-local' };
          avisa('entregue', p, null);
          return { ok: true, motivo: null, moedas: rc.moedas };
        });
      }
      // 4. decide e grava por dentro
      return db.lojaAplica(id, preco).then(function (r) {
        if (r && r.ja) return { ok: false, motivo: 'ja' };
        if (r && r.semSaldo) return recusa(p, id, 'sem-saldo');
        if (!r || !r.ok) return { ok: false, motivo: 'erro-local' };
        // 5. a entrega, neste mesmo tique. Se a página começou a recarregar
        // no meio (outra máquina mandou o save dela), não se escreve mais
        // nada: o save de lá já está no disco, e este débito morre com a página
        if (congelada) return { ok: false, motivo: 'recarregando' };
        var fim = null;
        try {
          fim = entrega(ent);
        } catch (e) {
          return db.lojaDesfaz(id, preco, 'erro-local').then(function () {
            avisa('recusado', p, 'erro-local');
            return { ok: false, motivo: 'erro-local', erro: String(e && e.message || e) };
          });
        }
        var extra = (fim && typeof fim.ate === 'number') ? { ate: fim.ate } : null;
        avisa('entregue', p, null, extra);
        var feito = { ok: true, motivo: null, moedas: r.moedas };
        if (extra) feito.ate = extra.ate;
        return feito;
      });
    });
  }

  // ------------------------------------------------------------- os gatilhos
  function ouveNuvem(det) {
    if (!det || typeof det !== 'object') return;
    var t = det.tipo, n = N();
    if ((t === 'puxou' || t === 'desatualizado' || t === 'limpou' || t === 'conta') && !(n && n.semRecarga)) {
      congelada = true;
      return;
    }
    if ((t === 'emdia' || t === 'subiu') && !liberada) {
      liberada = true;
      if (!timer) timer = setInterval(function () { if (!oculta()) L.buscar(); }, L.INTERVALO_MS);
      L.buscar();
    }
  }
  try { window.addEventListener('soterra:nuvem', function (ev) { ouveNuvem(ev && ev.detail); }); } catch (e) {}
  try {
    document.addEventListener('visibilitychange', function () {
      if (oculta() || !liberada) return;
      if (compraPendente || Date.now() - ultima >= L.VISIVEL_MS) {
        compraPendente = false;
        L.buscar();
      }
    });
  } catch (e2) {}
  try {
    if (typeof BroadcastChannel === 'function') {
      var canal = new BroadcastChannel(L.CANAL);
      canal.onmessage = function (ev) {
        var m = ev && ev.data;
        if (!m || m.tipo !== 'comprou') return;
        if (oculta()) { compraPendente = true; return; }   // busca quando a aba voltar
        /* 04/10: com a autoridade a compra JÁ entrou no servidor — não há fila a buscar. O que falta
         * é esta página adotar o estado novo, pelo caminho que não apaga o que o jogador fez. */
        if (autoridadeLigada()) {
          try { window.dispatchEvent(new CustomEvent('soterra:entregas', { detail: { n: 1 } })); } catch (e5) {}
          return;
        }
        L.buscar();
      };
    }
  } catch (e3) {}
  /* 04/10: o /api/eu de 30 s (sessao.js) disse que há pedido esperando o jogo: busca já, em vez de
   * esperar o ciclo de 5 minutos. Na batalha espera — adotar um estado no meio dela é o que o
   * resto do jogo evita —, e o /api/eu seguinte pergunta de novo. */
  try {
    window.addEventListener('soterra:loja-abertos', function () {
      var emBatalha = false;
      try { emBatalha = !!(JOGO.Game && JOGO.Game.screen === 'battle'); } catch (e6) {}
      if (!emBatalha && liberada) L.buscar();
    });
  } catch (e7) {}
  // a Nuvem pode ter falado antes deste arquivo carregar: o histórico dela conta
  try {
    var hN = (N() && N().historico) ? N().historico() : [];
    for (var i = 0; i < hN.length; i++) ouveNuvem(hN[i]);
  } catch (e4) {}

  /* só páginas de teste: o módulo volta ao estado de página recém-aberta */
  L._reinicia = function () {
    if (timer) { clearInterval(timer); timer = null; }
    liberada = false; congelada = false; buscando = null; ultima = 0; erro = null;
    compraPendente = false; historico = [];
    vit = null; vitEm = 0; vitBusca = null;
  };
})();
