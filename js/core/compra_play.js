/* ===========================================================================
 * A COMPRA DE BARRAS DE OURO PELA GOOGLE PLAY — só no APLICATIVO de Android (04/10)
 *
 * POR QUE EXISTE: a Play não aceita que um aplicativo venda item digital por
 * outro meio que não a cobrança dela. Na web as barras continuam pelo Mercado
 * Pago (site/loja.js) e este arquivo NEM É PEDIDO: quem o carrega é o
 * index.html e o site/loja.html, e só dentro do aplicativo.
 *
 * Serve às duas páginas (o jogo e a loja do site aberta dentro do aplicativo):
 * não depende de JOGO.UI nem do site — usa JOGO.Sessao.api ou SITE.api, o que
 * houver, e desenha a própria tela.
 *
 * O CAMINHO DE UMA COMPRA (a regra que segura o dinheiro: o SERVIDOR credita, e
 * a compra só é CONSUMIDA na Google depois que ele confirma):
 *   1. prepara(): GET /api/pagamento/play diz os quatro produtos e o código da
 *      conta; o plugin pergunta à Google o PREÇO (na moeda do jogador);
 *   2. compra(id): o plugin abre a tela da Google — SEM consumir e SEM confirmar
 *      (isConsumable:false, autoAcknowledgePurchases:false);
 *   3. entrega(): manda o purchaseToken ao servidor (POST /api/pagamento/play),
 *      que confere na Google e credita UMA vez;
 *   4. só com `consumir: true` na resposta o plugin consome a compra — o que
 *      libera comprar o mesmo pacote de novo.
 * Se o aplicativo fechar entre o 2 e o 4, a compra fica "não consumida" no
 * aparelho: retoma() a acha (getPurchases) e a entrega de novo — ao abrir o
 * aplicativo, ao voltar para ele e ao abrir a tela. O servidor reconhece o token
 * e não credita duas vezes. A compra que ninguém confirma em 3 dias a Google
 * devolve sozinha ao comprador.
 *
 * NUNCA chame restorePurchases() do plugin: ele CONFIRMA as compras sozinho, e
 * a confirmação tem de esperar o servidor.
 *
 * O plugin é o @capgo/native-purchases (vendor/capacitor/native-purchases.js,
 * cópia do node_modules que o tools/empacota_www.py confere). As provas põem um
 * de mentira em window.capacitorNativePurchases (tests/compra_play.html).
 * ========================================================================= */
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
  var P = JOGO.CompraPlay = {};

  var ROTA = '/api/pagamento/play';
  var COMPRADA = '1', PENDENTE = '2';          // Purchase.PurchaseState do Android, como o plugin entrega (texto)
  var RETOMA_A_CADA = 30 * 1000;               // ms: a volta ao aplicativo não repete a retomada antes disto

  var st = P._st = { fase: 'parado', erro: '', pacotes: [], conta: null, teste: false, saldo: null,
                     ocupado: null, recado: null, pendentes: 0 };
  var paineis = [];                            // os elementos em que a tela está desenhada
  var retomando = null, retomadaEm = 0;

  /* ---- onde estou ---- */
  function nativo() {
    try {
      var C = window.Capacitor;
      return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
    } catch (e) { return false; }
  }
  var forcado = false;
  try { forcado = /[?&]app=1(&|$)/.test(String(location.search || '')); } catch (e0) {}
  try { if (!forcado) forcado = window.sessionStorage.getItem('soterra-app') === '1'; } catch (e1) {}
  P.noApp = function () { return forcado || nativo(); };
  // as páginas do site abertas a partir daqui (a loja, a conta) sabem que estão dentro do aplicativo
  try { if (P.noApp()) window.sessionStorage.setItem('soterra-app', '1'); } catch (e2) {}

  function noSite() { return !JOGO.Sessao && !!window.SITE; }
  function api(rota, op) {
    try {
      if (JOGO.Sessao && JOGO.Sessao.api) return JOGO.Sessao.api(rota, op);
      if (window.SITE && window.SITE.api) return window.SITE.api(rota, op);
    } catch (e) {}
    return Promise.resolve({ ok: false, status: 0, erro: Tx('sem servidor') });
  }
  function temSessao() {
    try {
      if (JOGO.Sessao && JOGO.Sessao.token) return !!JOGO.Sessao.token();
      if (window.SITE && window.SITE.sessao) return !!window.SITE.sessao();
    } catch (e) {}
    return false;
  }
  function plugin() {
    try { return (window.capacitorNativePurchases && window.capacitorNativePurchases.NativePurchases) || null; }
    catch (e) { return null; }
  }
  function carrega(src) {
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = s.onerror = function () { resolve(); };
      document.head.appendChild(s);
    });
  }
  /* A ponte do plugin. No JOGO quem a carrega é o js/mobile.js (junto com as outras): aqui só se espera.
   * No SITE (a loja aberta dentro do aplicativo) ninguém a carregou: este arquivo busca as duas. */
  var ponteP = null;
  function ponte() {
    if (plugin() || !nativo()) return Promise.resolve(plugin());
    if (ponteP) return ponteP;
    ponteP = new Promise(function (resolve) {
      if (noSite()) {
        var url = (typeof window.SITE_URL === 'function') ? window.SITE_URL : function (f) { return f; };
        var p = window.capacitorExports ? Promise.resolve() : carrega(url('../vendor/capacitor/capacitor.js'));
        p.then(function () { return carrega(url('../vendor/capacitor/native-purchases.js')); })
          .then(function () { resolve(plugin()); });
        return;
      }
      var voltas = 0;
      var t = setInterval(function () {
        if (plugin() || ++voltas > 40) { clearInterval(t); resolve(plugin()); }    // até 10 s
      }, 250);
    });
    ponteP.then(function (pl) { if (!pl) ponteP = null; });       // não veio: a próxima tentativa busca de novo
    return ponteP;
  }

  function avisa(tipo, dados) {
    try { window.dispatchEvent(new CustomEvent('soterra:barras-play', { detail: { tipo: tipo, dados: dados || {} } })); }
    catch (e) {}
  }
  function milhar(n) { return String(Math.floor(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  /* ---- 1. os produtos ---- */
  P.prepara = function () {
    st.fase = 'carregando'; st.erro = '';
    pinta();
    function fim(fase, erro) { st.fase = fase; st.erro = erro || ''; pinta(); return st; }
    if (!temSessao()) return Promise.resolve(fim('fora'));
    return api(ROTA).then(function (r) {
      if (!r || !r.ok || !Array.isArray(r.pacotes)) {
        if (r && r.status === 401) return fim('fora');
        return fim(r && r.status === 503 ? 'desligado' : 'erro',
                   r && r.status === 0 ? Tx('O servidor não respondeu.') : (r && r.erro) || Tx('Não deu para ler os pacotes.'));
      }
      st.conta = r.conta || null;
      st.teste = r.teste === true;
      if (r.barras && isFinite(Number(r.barras.saldo))) st.saldo = Number(r.barras.saldo);
      st.pacotes = r.pacotes.map(function (p) {
        return { id: p.id, produto: p.produto, nome: p.nome, barras: p.barras, cabe: p.cabe !== false, preco: null };
      });
      return ponte().then(function (pl) {
        if (!pl) return fim('sem-loja');
        return pl.isBillingSupported().then(function (s) {
          if (!s || s.isBillingSupported !== true) return fim('sem-loja');
          return pl.getProducts({ productIdentifiers: st.pacotes.map(function (p) { return p.produto; }),
                                  productType: 'inapp' }).then(function (g) {
            var precos = {};
            ((g && g.products) || []).forEach(function (x) { if (x && x.identifier) precos[x.identifier] = x.priceString || null; });
            st.pacotes.forEach(function (p) { p.preco = precos[p.produto] || null; });
            // a Google não devolveu produto nenhum: os produtos ainda não estão cadastrados (ou ativos) na Play
            if (!st.pacotes.some(function (p) { return p.preco; })) return fim('sem-produtos');
            fim('ok');
            P.retoma();                         // a tela aberta também acha o que ficou pelo caminho
            return st;
          });
        });
      });
    }).catch(function () { return fim('sem-loja'); });
  };

  /* ---- 3 e 4. a entrega ao servidor e, SÓ com a confirmação dele, o consumo ---- */
  function entrega(c, pacoteId) {
    var pl = plugin();
    var token = c && (c.purchaseToken || c.transactionId);
    var qual = (c && c.productIdentifier) || pacoteId;
    if (!token || !qual) return Promise.resolve({ estado: 'recusada' });
    return api(ROTA, { method: 'POST', body: { pacote: qual, token: token } }).then(function (r) {
      r = r || {};
      if (r.barras && isFinite(Number(r.barras.saldo))) st.saldo = Number(r.barras.saldo);
      // `repetido`: o servidor já tinha creditado esta compra antes (o aplicativo fechou antes de consumir)
      var saida = { estado: r.creditado ? 'creditada' : r.repetido ? 'repetida' : (r.estado || (r.status === 0 ? 'sem-rede' : 'erro')),
                    barras: (r.compra && r.compra.barras) || 0, texto: r.erro || '', status: r.status };
      if (r.consumir !== true || !pl) return saida;
      // o servidor confirmou (creditou agora, ou já tinha creditado): agora sim a Google pode liberar o pacote.
      // Se o consumo falhar, a compra continua no aparelho e a próxima retomada a entrega de novo (não credita 2×)
      return pl.consumePurchase({ purchaseToken: token }).then(function () { return saida; },
                                                              function () { saida.semConsumo = true; return saida; });
    }, function () { return { estado: 'sem-rede' }; });
  }

  /* ---- 2. a compra ---- */
  P.compra = function (id) {
    var pl = plugin();
    var p = st.pacotes.filter(function (x) { return x.id === id; })[0];
    if (!pl || !p || st.ocupado) return Promise.resolve({ estado: 'recusada' });
    if (!p.cabe) return Promise.resolve(recado({ estado: 'teto' }));
    st.ocupado = id; st.recado = null;
    pinta();
    return pl.purchaseProduct({ productIdentifier: p.produto, productType: 'inapp', quantity: 1,
                                isConsumable: false, autoAcknowledgePurchases: false,
                                appAccountToken: st.conta || undefined })
      .then(function (c) { return entrega(c, p.id); }, function (e) {
        var s = String((e && e.code) || '') + ' ' + String((e && e.message) || e || '');
        if (/USER_CANCELED/.test(s)) return { estado: 'cancelada' };
        if (/pending/i.test(s)) return { estado: 'pendente' };
        // "você já tem este item": uma compra anterior ficou sem consumir — a retomada a entrega
        if (/ITEM_ALREADY_OWNED/.test(s)) return P.retoma(true).then(function (r) {
          return r.creditadas ? { estado: 'creditada', barras: r.barras } : { estado: r.pendentes ? 'pendente' : 'recusada' };
        });
        if (/BILLING_UNAVAILABLE|SERVICE_|FEATURE_NOT_SUPPORTED/.test(s)) return { estado: 'sem-loja' };
        return { estado: 'recusada' };
      })
      .then(function (r) {
        st.ocupado = null;
        recado(r);
        if (r.estado === 'creditada') { avisa('creditada', { barras: r.barras, saldo: st.saldo }); atualizaCabe(); }
        return r;
      });
  };
  // depois de um crédito o teto de 24 h andou: relê só o que cabe (os preços da Google não mudam)
  function atualizaCabe() {
    api(ROTA).then(function (r) {
      if (!r || !r.ok || !Array.isArray(r.pacotes)) return;
      var cabe = {};
      r.pacotes.forEach(function (p) { cabe[p.id] = p.cabe !== false; });
      st.pacotes.forEach(function (p) { if (cabe.hasOwnProperty(p.id)) p.cabe = cabe[p.id]; });
      pinta();
    });
  }

  /* ---- a retomada: o jogador pagou e o aplicativo fechou (ou o pagamento demorou a ser aprovado) ---- */
  P.retoma = function (forcar) {
    if (retomando) return retomando;
    var vazio = { creditadas: 0, barras: 0, pendentes: 0 };
    if (!P.noApp() || !temSessao()) return Promise.resolve(vazio);
    if (!forcar && Date.now() - retomadaEm < RETOMA_A_CADA) return Promise.resolve(vazio);
    retomadaEm = Date.now();
    retomando = ponte().then(function (pl) {
      if (!pl) return vazio;
      return pl.getPurchases({ productType: 'inapp' }).then(function (g) {
        var lista = ((g && g.purchases) || []).filter(function (c) { return c && (c.purchaseToken || c.transactionId); });
        var saida = { creditadas: 0, barras: 0, pendentes: 0 };
        // uma de cada vez: cada entrega é uma consulta do servidor à Google
        return lista.reduce(function (fila, c) {
          return fila.then(function () {
            if (String(c.purchaseState) === PENDENTE) { saida.pendentes++; return null; }
            if (String(c.purchaseState) !== COMPRADA) return null;
            return entrega(c, null).then(function (r) {
              if (r.estado === 'creditada') { saida.creditadas++; saida.barras += r.barras; }
              else if (r.estado === 'pendente') saida.pendentes++;
            });
          });
        }, Promise.resolve()).then(function () { return saida; });
      });
    }).catch(function () { return vazio; }).then(function (r) {
      retomando = null;
      st.pendentes = r.pendentes;
      if (r.creditadas) {
        recado({ estado: 'creditada', barras: r.barras, retomada: true });
        avisa('creditada', { barras: r.barras, saldo: st.saldo, retomada: true });
        brinde(Tx('Chegaram {a} barras de ouro da sua compra na Google Play.', { a: milhar(r.barras) }));
      }
      pinta();
      return r;
    });
    return retomando;
  };

  /* ---- os textos ---- */
  var FASE = {
    carregando: Tx('Carregando os pacotes…'),
    fora: Tx('Entre na sua conta do jogo para comprar barras de ouro.'),
    desligado: Tx('A compra de barras de ouro pelo aplicativo chega em breve.'),
    'sem-loja': Tx('Não deu para falar com a Google Play neste aparelho. Abra a Play Store, entre com a sua conta Google e tente de novo.'),
    'sem-produtos': Tx('Os pacotes ainda não estão disponíveis na Google Play. Tente de novo mais tarde.')
  };
  function textoDoRecado(r) {
    switch (r.estado) {
      case 'creditada': return { tipo: 'bom', texto: (r.retomada
        ? Tx('Sua compra chegou: {a} barras de ouro entraram na sua conta.', { a: milhar(r.barras) })
        : Tx('Pronto! {a} barras de ouro entraram na sua conta.', { a: milhar(r.barras) })) };
      case 'repetida': return { tipo: 'neutro', texto: Tx('Essa compra já tinha sido creditada na sua conta.') };
      case 'pendente': return { tipo: 'neutro', texto: Tx('A Google ainda espera o pagamento. Assim que ele for aprovado, as barras entram sozinhas — pode fechar esta tela.') };
      case 'cancelada': return { tipo: 'neutro', texto: r.status === 409 ? Tx('Essa compra foi cancelada ou reembolsada. Nada foi creditado.')
                                 : Tx('Compra cancelada. Nada foi cobrado.') };
      case 'teto': return { tipo: 'neutro', texto: r.texto ? Tx('O limite de compras por dia foi atingido: {texto}.', { texto: r.texto })
                            : Tx('O limite de compras por dia foi atingido. Tente de novo amanhã.') };
      case 'sem-loja': return { tipo: 'erro', texto: FASE['sem-loja'] };
      case 'sem-rede': return { tipo: 'erro', texto: Tx('O servidor do jogo não respondeu. Se você pagou, as barras entram sozinhas quando a conexão voltar.') };
      case 'outra-conta': return { tipo: 'erro', texto: Tx('Essa compra foi feita por outra conta do jogo. Entre nela para receber as barras.') };
      case 'recusada': return { tipo: 'erro', texto: Tx('A Google não concluiu a compra. Nada foi creditado.') };
      default: return { tipo: 'erro', texto: Tx('{a}Se você pagou, as barras entram sozinhas em instantes; se não entrarem, a Google devolve o valor.', { a: r.texto ? r.texto.charAt(0).toUpperCase() + r.texto.slice(1) + '. ' : '' }) };
    }
  }
  function recado(r) { st.recado = textoDoRecado(r); pinta(); return r; }
  P._textoDoRecado = textoDoRecado;

  /* ---- a tela ---- */
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var CSS = '.cpl{font:15px/1.4 system-ui,sans-serif;color:#efe6d0}' +
    '.cpl-saldo{margin:0 0 10px;color:#e9c46a}' +
    '.cpl-lista{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 10px}' +
    '.cpl-pacote{background:#1b1710;border:1px solid #5a4a22;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:6px}' +
    '.cpl-pacote h4{margin:0;font-size:14px;color:#efe6d0}.cpl-qtd{margin:0;color:#e9c46a}.cpl-qtd b{font-size:20px}' +
    '.cpl-preco{margin:0;font-weight:700}' +
    '.cpl-bt{min-height:44px;border:0;border-radius:8px;background:#e9c46a;color:#221a06;font:700 15px system-ui,sans-serif;cursor:pointer}' +
    '.cpl-bt[disabled]{background:#4a4334;color:#a79c80;cursor:default}' +
    '.cpl-estado,.cpl-recado{margin:0 0 10px;padding:10px 12px;border-radius:8px;background:#22262c}' +
    '.cpl-recado.bom{background:#16301e;color:#9be7a8}.cpl-recado.erro{background:#3a1717;color:#ffb0b0}' +
    '.cpl-nota{margin:0;font-size:12px;color:#a79c80}' +
    '.cpl-fundo{position:fixed;inset:0;z-index:99990;background:rgba(5,6,8,.82);display:flex;align-items:center;justify-content:center;padding:14px}' +
    '.cpl-caixa{background:#12100b;border:1px solid #5a4a22;border-radius:14px;padding:16px;width:min(680px,100%);max-height:92vh;overflow:auto}' +
    '.cpl-cab{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 10px}.cpl-cab h3{margin:0;color:#e9c46a;font:700 19px system-ui,sans-serif}' +
    '.cpl-fechar{min-width:44px;min-height:44px;border:1px solid #5a4a22;border-radius:8px;background:transparent;color:#efe6d0;font-size:15px;cursor:pointer}' +
    '.cpl-brinde{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99991;background:#16301e;color:#9be7a8;border:1px solid #2f6b3f;border-radius:10px;padding:10px 14px;font:15px system-ui,sans-serif;max-width:92vw}';
  function estilo() {
    if (document.getElementById('cpl-estilo')) return;
    var s = document.createElement('style');
    s.id = 'cpl-estilo';
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  function html() {
    var h = '';
    if (st.saldo != null) h += '<p class="cpl-saldo">' + Tx('Você tem <b data-cpl-saldo>{a}</b> barras de ouro.', { a: milhar(st.saldo) }) + '</p>';
    if (st.recado) h += '<p class="cpl-recado ' + st.recado.tipo + '" role="status" data-cpl-recado>' + esc(st.recado.texto) + '</p>';
    else if (st.pendentes) h += '<p class="cpl-recado neutro" role="status" data-cpl-recado>' + esc(textoDoRecado({ estado: 'pendente' }).texto) + '</p>';
    if (st.fase !== 'ok') {
      h += '<p class="cpl-estado" data-cpl-fase="' + esc(st.fase) + '">' + esc(FASE[st.fase] || st.erro || Tx('Não deu para abrir a compra.')) + '</p>';
      if (st.fase !== 'carregando' && st.fase !== 'desligado') h += Tx('<button type="button" class="cpl-bt" data-cpl-de-novo style="padding:0 16px">Tentar de novo</button>');
      return h;
    }
    h += '<div class="cpl-lista">' + st.pacotes.map(function (p) {
      var ocupado = !!st.ocupado, rotulo = st.ocupado === p.id ? Tx('Abrindo a Google Play…')
        : !p.preco ? Tx('Indisponível') : !p.cabe ? Tx('Limite do dia atingido') : Tx('Comprar');
      return '<article class="cpl-pacote" data-cpl-pacote="' +
        esc(p.id) +
        '">' +
        Tx('<h4>{b}</h4><p class="cpl-qtd"><b>{c}</b> barras de ouro</p><p class="cpl-preco">{d}</p><button type="button" class="cpl-bt" data-cpl-comprar="{a}"{e}>{rotulo}</button>', { b: esc(p.nome), c: milhar(p.barras), d: esc(p.preco || '—'), a: esc(p.id), e: ocupado || !p.preco || !p.cabe ? ' disabled' : '', rotulo: rotulo }) +
        '</article>';
    }).join('') + '</div>';
    h += (st.teste
      ? '<p class="cpl-nota">' +
      Tx('A cobrança é feita pela Google Play, na forma de pagamento da sua conta Google. As barras de ouro ficam na sua conta do jogo · servidor em modo de teste.') +
      '</p>'
      : '<p class="cpl-nota">' +
      Tx('A cobrança é feita pela Google Play, na forma de pagamento da sua conta Google. As barras de ouro ficam na sua conta do jogo.') +
      '</p>');
    return h;
  }
  function pinta() {
    paineis = paineis.filter(function (e) { return e && e.isConnected; });
    paineis.forEach(function (e) { e.innerHTML = html(); });
  }
  /* Desenha a tela dentro de `alvo` (a loja do site usa isto) e começa a carregar. */
  P.painel = function (alvo) {
    if (!alvo) return;
    estilo();
    alvo.classList.add('cpl');
    if (!alvo._cpl) {
      alvo._cpl = true;
      alvo.addEventListener('click', function (ev) {
        var t = ev.target;
        var bt = t && t.closest ? t.closest('[data-cpl-comprar]') : null;
        if (bt && !bt.disabled) { P.compra(bt.getAttribute('data-cpl-comprar')); return; }
        if (t && t.closest && t.closest('[data-cpl-de-novo]')) P.prepara();
      });
    }
    if (paineis.indexOf(alvo) < 0) paineis.push(alvo);
    pinta();
    if (st.fase !== 'carregando' && !st.ocupado) P.prepara();
  };
  /* A tela por cima do jogo (o botão dos Ajustes e os atalhos da loja). */
  var fundo = null;
  P.aberto = function () { return !!fundo; };
  P.fecha = function () {
    if (!fundo) return false;
    if (fundo.parentNode) fundo.parentNode.removeChild(fundo);
    fundo = null;
    return true;
  };
  P.abre = function () {
    if (!P.noApp() || fundo) return;
    estilo();
    st.recado = null;
    fundo = document.createElement('div');
    fundo.className = 'cpl-fundo';
    fundo.setAttribute('role', 'dialog');
    fundo.setAttribute('aria-modal', 'true');
    fundo.setAttribute('aria-label', Tx('Comprar barras de ouro'));
    fundo.innerHTML = '<div class="cpl-caixa">' +
      Tx('<div class="cpl-cab"><h3>Barras de ouro</h3><button type="button" class="cpl-fechar" data-cpl-fechar>Fechar</button></div><div data-cpl-corpo></div>') +
      '</div>';
    fundo.addEventListener('click', function (ev) {
      if (ev.target === fundo || (ev.target.closest && ev.target.closest('[data-cpl-fechar]'))) P.fecha();
    });
    document.body.appendChild(fundo);
    P.painel(fundo.querySelector('[data-cpl-corpo]'));
  };
  function brinde(texto) {
    try {
      estilo();
      var b = document.createElement('div');
      b.className = 'cpl-brinde';
      b.setAttribute('role', 'status');
      b.textContent = texto;
      document.body.appendChild(b);
      setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 7000);
    } catch (e) {}
  }

  /* ---- ao abrir o aplicativo e ao voltar para ele: o que ficou pelo caminho ---- */
  function liga() {
    if (!P.noApp() || typeof document === 'undefined') return;
    setTimeout(function () { P.retoma(); }, 1500);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) P.retoma(); });
  }
  liga();
})();
