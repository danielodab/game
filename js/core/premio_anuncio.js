/* ===========================================================================
 * GANHAR PRÊMIOS — o anúncio premiado, só no APLICATIVO de Android (06/10)
 *
 * A REGRA DO DONO: "as propagandas só devem aparecer SOMENTE se o usuário for
 * nessa área; não quero que meu jogo fique cheio de propagandas atrapalhando o
 * jogo; tem que ser de livre e espontânea vontade."
 *
 * Então, nesta ordem e nunca antes:
 *   · na WEB este arquivo NEM É PEDIDO (quem o carrega é o index.html, e só
 *     dentro do aplicativo) e, pedido por engano, não faz nada;
 *   · no aplicativo, carregar este arquivo NÃO carrega nada de anúncio: nem a
 *     ponte do plugin, nem o SDK, nem a pergunta de privacidade;
 *   · ENTRAR na área (P.abre, o botão das Configurações) é que busca a ponte
 *     (vendor/capacitor/admob.js), faz a pergunta de privacidade da Google se ela
 *     for exigida e liga o SDK. Ainda nenhum anúncio é pedido;
 *   · o anúncio só é pedido e mostrado depois do TOQUE em "Assistir anúncio".
 * Não há banner, intersticial, anúncio de abertura nem pré-carregamento.
 *
 * DOIS PRÊMIOS, com contador próprio: vinténs e barra de ouro. O jogador escolhe
 * ANTES de assistir. Quem dá o prêmio é o SERVIDOR (servidor/anuncio.py), e só
 * quando a Google o avisa com a assinatura dela:
 *   1. POST /api/anuncio/bilhete {tipo} → o bilhete de uso único;
 *   2. o anúncio leva o bilhete (custom_data) e o código da conta (user_id);
 *   3. a Google chama o servidor; a tela CONSULTA o estado até o contador andar —
 *      sem prometer o que o servidor ainda não deu.
 * Fechou antes do fim: nada ganho, nada perdido.
 *
 * Na compilação de DEPURAÇÃO (window.Capacitor.DEBUG) o bloco é o de TESTE da
 * Google, nunca o do dono: clicar no próprio anúncio de verdade suspende a conta
 * do AdMob. O bloco de teste não avisa o servidor: ali o prêmio não chega.
 *
 * O plugin é o @capacitor-community/admob (a cópia em vendor/capacitor/admob.js
 * que o tools/empacota_www.py confere). As provas põem um de mentira.
 * ========================================================================= */
(function () {
  'use strict';
  /* O TEXTO NO IDIOMA DO JOGADOR (docs/IDIOMAS.md): a chave é o próprio português. */
  function Tx(s, v) {
    var I = (typeof JOGO !== 'undefined' && JOGO) ? JOGO.I18n : null;
    if (I && I.t) return I.t(s, v);
    if (!v) return s;
    return String(s).replace(/\{([A-Za-z_]\w*)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m;
    });
  }
  var JOGO = window.JOGO = window.JOGO || {};
  var P = JOGO.PremioAnuncio = {};

  var ROTA = '/api/anuncio';
  var BLOCO_DE_TESTE = 'ca-app-pub-3940256099942544/5224354917';   // o premiado de teste oficial da Google
  var CONSULTA_A_CADA = 2000, CONSULTAS = 15;                      // ms e vezes: até ~30 s esperando a Google
  var TIPOS = ['vintens', 'barras'];

  var st = P._st = { fase: 'parado', erro: '', premios: {}, zeraEm: 0, bloco: null, aparelhos: [], mestre: false,
                     ocupado: null, passo: '', recado: null, sdk: false };
  var fundo = null, ouvindo = false, emCena = null;

  /* ---- onde estou ---- */
  function nativo() {
    try {
      var C = window.Capacitor;
      return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
    } catch (e) { return false; }
  }
  var forcado = false;
  try { forcado = /[?&]app=1(&|$)/.test(String(location.search || '')); } catch (e0) {}
  P.noApp = function () { return forcado || nativo(); };
  function depuracao() { try { return !!(window.Capacitor && window.Capacitor.DEBUG === true); } catch (e) { return false; } }

  function api(rota, op) {
    try { if (JOGO.Sessao && JOGO.Sessao.api) return JOGO.Sessao.api(rota, op); } catch (e) {}
    return Promise.resolve({ ok: false, status: 0 });
  }
  function plugin() {
    try {
      // o pacote publica o global com este nome (um resto do molde dele); o segundo é o que seria o certo
      var g = window.capacitorStripe || window.capacitorAdMob;
      return (g && g.AdMob) || null;
    } catch (e) { return null; }
  }
  function carrega(src) {
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = s.onerror = function () { resolve(); };
      document.head.appendChild(s);
    });
  }
  /* A ponte do plugin: só é buscada AQUI, ao entrar na área. O js/mobile.js não a põe na lista dele. */
  var ponteP = null;
  function ponte() {
    if (plugin() || !nativo()) return Promise.resolve(plugin());
    if (ponteP) return ponteP;
    var url = (typeof window.__url === 'function') ? window.__url : function (f) { return f; };
    ponteP = (window.capacitorExports ? Promise.resolve() : carrega(url('vendor/capacitor/capacitor.js')))
      .then(function () { return carrega(url('vendor/capacitor/admob.js')); })
      .then(function () { return plugin(); });
    ponteP.then(function (pl) { if (!pl) ponteP = null; });
    return ponteP;
  }

  /* ---- o SDK: a pergunta de privacidade (se a Google a exigir) e a partida. Só ao ENTRAR na área ---- */
  function ligaSdk(pl) {
    if (st.sdk) return Promise.resolve(true);
    var pode = true;
    return Promise.resolve()
      .then(function () { return pl.requestConsentInfo({}); })
      .then(function (info) {
        if (info && info.isConsentFormAvailable && info.status === 'REQUIRED') return pl.showConsentForm();
        return info;
      })
      .then(function (info) { if (info && info.canRequestAds === false) pode = false; },
            function () { /* a pergunta falhou (sem rede, sem formulário): o SDK decide o que pode pedir */ })
      .then(function () {
        if (!pode) return false;
        var op = { maxAdContentRating: 'Teen' };
        if (st.aparelhos.length) { op.initializeForTesting = true; op.testingDevices = st.aparelhos.slice(); }
        return pl.initialize(op).then(function () {
          if (!ouvindo) {
            ouvindo = true;
            pl.addListener('onRewardedVideoAdReward', function () { if (emCena) emCena.viu = true; });
            pl.addListener('onRewardedVideoAdDismissed', function () { if (emCena) emCena.fim('fechou'); });
            pl.addListener('onRewardedVideoAdFailedToShow', function () { if (emCena) emCena.fim('falhou'); });
          }
          st.sdk = true;
          return true;
        });
      });
  }

  function leEstado(r) {
    if (!r || !r.ok || !Array.isArray(r.premios)) return false;
    r.premios.forEach(function (p) { if (p && TIPOS.indexOf(p.tipo) >= 0) st.premios[p.tipo] = p; });
    st.zeraEm = Number(r.zeraEm) || 0;
    if (r.bloco) st.bloco = String(r.bloco);
    if (Array.isArray(r.aparelhosTeste)) st.aparelhos = r.aparelhosTeste.map(String);
    if (r.mestre != null) st.mestre = r.mestre === true;
    return true;
  }
  function consulta() { return api(ROTA).then(function (r) { return leEstado(r) ? r : null; }, function () { return null; }); }

  /* ---- entrar na área ---- */
  function entra() {
    st.fase = 'carregando'; st.erro = ''; st.recado = null;
    pinta();
    function fim(fase, erro) { st.fase = fase; st.erro = erro || ''; pinta(); return st; }
    return api(ROTA).then(function (r) {
      if (!leEstado(r)) {
        if (r && r.status === 401) return fim('fora');
        if (r && r.status === 503) return fim('desligado');
        return fim(r && r.status === 0 ? 'sem-rede' : 'erro', (r && r.erro) || '');
      }
      return ponte().then(function (pl) {
        if (!pl) return fim('sem-app');
        return ligaSdk(pl).then(function (pode) { return fim(pode ? 'ok' : 'sem-consentimento'); });
      });
    }).catch(function () { return fim('sem-app'); });
  }

  /* ---- o toque em "Assistir anúncio" ---- */
  function assiste(tipo) {
    var pl = plugin();
    if (!pl || st.fase !== 'ok' || st.ocupado || TIPOS.indexOf(tipo) < 0 || st.mestre) return Promise.resolve('recusado');
    var antes = (st.premios[tipo] && st.premios[tipo].hoje) || 0;
    st.ocupado = tipo; st.passo = 'bilhete'; st.recado = null;
    pinta();
    function fim(estado, extra) {
      st.ocupado = null; st.passo = ''; emCena = null;
      st.recado = recado(estado, tipo, extra);
      pinta();
      return estado;
    }
    return api(ROTA + '/bilhete', { method: 'POST', body: { tipo: tipo } }).then(function (b) {
      if (!b || !b.ok || !b.bilhete) {
        if (b && b.limite) { if (Array.isArray(b.premios)) leEstado({ ok: true, premios: b.premios, zeraEm: b.zeraEm }); return fim('limite'); }
        if (b && b.mestre) { st.mestre = true; return fim('mestre'); }
        if (b && b.status === 0) return fim('sem-rede');
        return fim('erro', b && b.erro);
      }
      st.passo = 'anuncio';
      pinta();
      var teste = depuracao();
      return pl.prepareRewardVideoAd({ adId: teste ? BLOCO_DE_TESTE : (b.bloco || st.bloco), isTesting: teste,
                                       immersiveMode: true, ssv: { userId: b.conta, customData: b.bilhete } })
        .then(function () {
          return new Promise(function (resolve) {
            var cena = emCena = { viu: false, fim: function (como) {
              if (emCena !== cena) return;
              emCena = null;
              resolve({ como: como, viu: cena.viu });
            } };
            st.passo = 'assistindo';
            pinta();
            // nos aparelhos em que o plugin só responde no fim, a resposta dele também conta
            Promise.resolve(pl.showRewardVideoAd()).then(function () { cena.viu = true; },
                                                         function () { cena.fim('falhou'); });
          });
        }, function () { return { como: 'sem-anuncio', viu: false }; })
        .then(function (x) {
          if (x.como === 'sem-anuncio' || x.como === 'falhou') return fim('sem-anuncio');
          if (!x.viu) return fim('fechou');
          // visto até o fim: agora é a Google avisar o servidor. A tela pergunta até o contador andar
          st.passo = 'confirmando';
          pinta();
          var voltas = 0;
          return new Promise(function (resolve) {
            (function pergunta() {
              consulta().then(function () {
                var agora = (st.premios[tipo] && st.premios[tipo].hoje) || 0;
                if (agora > antes) return resolve(true);
                if (++voltas >= CONSULTAS) return resolve(false);
                setTimeout(pergunta, CONSULTA_A_CADA);
              });
            })();
          }).then(function (chegou) {
            if (chegou && tipo === 'vintens') { try { if (JOGO.Loja && JOGO.Loja.buscar) JOGO.Loja.buscar(); } catch (e) {} }
            return fim(chegou ? 'creditado' : 'demora');
          });
        });
    }, function () { return fim('sem-rede'); });
  }
  P._assiste = assiste;
  P._entra = entra;

  /* ---- os textos ---- */
  function milhar(n) { return String(Math.floor(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function nomeDoPremio(tipo) {
    var p = st.premios[tipo] || {};
    if (tipo === 'vintens') return Tx('{a} vinténs', { a: milhar(p.qtd) });
    return Number(p.qtd) === 1 ? Tx('1 barra de ouro') : Tx('{a} barras de ouro', { a: milhar(p.qtd) });
  }
  function horaDaVolta() {
    try {
      var d = new Date(st.zeraEm * 1000);
      var z = function (n) { return (n < 10 ? '0' : '') + n; };
      return z(d.getHours()) + ':' + z(d.getMinutes());
    } catch (e) { return ''; }
  }
  var FASE = {
    carregando: Tx('Carregando…'),
    fora: Tx('Entre na sua conta do jogo para ganhar prêmios.'),
    desligado: Tx('Os anúncios premiados não estão disponíveis agora.'),
    'sem-rede': Tx('Sem conexão com o servidor do jogo. Confira a internet e tente de novo.'),
    'sem-app': Tx('Não deu para preparar os anúncios neste aparelho. Atualize o aplicativo pela Play Store e tente de novo.'),
    'sem-consentimento': Tx('Sem a sua resposta sobre privacidade a Google não deixa mostrar anúncios. Toque em "Tentar de novo" para responder.')
  };
  var PASSO = {
    bilhete: Tx('Preparando…'),
    anuncio: Tx('Carregando o anúncio…'),
    assistindo: Tx('Anúncio na tela…'),
    confirmando: Tx('Anúncio visto! Esperando a confirmação: o prêmio entra em instantes…')
  };
  function recado(estado, tipo, extra) {
    switch (estado) {
      case 'creditado': return { tipo: 'bom', texto: Tx('Pronto! {a} na sua conta.', { a: nomeDoPremio(tipo) }) };
      case 'demora': return { tipo: 'neutro', texto: Tx('A confirmação ainda não chegou. Se o anúncio foi visto até o fim, o prêmio entra sozinho em instantes — pode fechar esta tela.') };
      case 'fechou': return { tipo: 'neutro', texto: Tx('Você fechou o anúncio antes do fim: nada foi ganho e nada foi perdido.') };
      case 'sem-anuncio': return { tipo: 'neutro', texto: Tx('Não há anúncio disponível agora. Tente de novo daqui a pouco.') };
      case 'limite': return { tipo: 'neutro', texto: Tx('O limite de hoje desse prêmio já foi atingido. Volta às {a}.', { a: horaDaVolta() }) };
      case 'mestre': return { tipo: 'neutro', texto: Tx('A conta do Mestre não assiste a anúncios.') };
      case 'sem-rede': return { tipo: 'erro', texto: FASE['sem-rede'] };
      default: return { tipo: 'erro', texto: extra ? String(extra) : Tx('Não deu para abrir o anúncio. Tente de novo.') };
    }
  }
  P._recado = recado;

  /* ---- a tela ---- */
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var CSS = '.pan{font:15px/1.4 system-ui,sans-serif;color:#efe6d0}' +
    '.pan-fundo{position:fixed;inset:0;z-index:99990;background:rgba(5,6,8,.82);display:flex;align-items:center;justify-content:center;padding:14px}' +
    '.pan-caixa{background:#12100b;border:1px solid #5a4a22;border-radius:14px;padding:16px;width:min(560px,100%);max-height:92vh;overflow:auto}' +
    '.pan-cab{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 10px}.pan-cab h3{margin:0;color:#e9c46a;font:700 19px system-ui,sans-serif}' +
    '.pan-fechar{min-width:44px;min-height:44px;border:1px solid #5a4a22;border-radius:8px;background:transparent;color:#efe6d0;font-size:15px;cursor:pointer}' +
    '.pan-intro{margin:0 0 12px}' +
    '.pan-lista{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:0 0 10px}' +
    '.pan-cartao{background:#1b1710;border:1px solid #5a4a22;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:6px}' +
    '.pan-cartao h4{margin:0;font-size:17px;color:#e9c46a}.pan-cartao p{margin:0}.pan-conta{font-weight:700}' +
    '.pan-bt{min-height:44px;border:0;border-radius:8px;background:#e9c46a;color:#221a06;font:700 15px system-ui,sans-serif;cursor:pointer;padding:0 14px}' +
    '.pan-bt[disabled]{background:#4a4334;color:#a79c80;cursor:default}' +
    '.pan-estado,.pan-recado{margin:0 0 10px;padding:10px 12px;border-radius:8px;background:#22262c}' +
    '.pan-recado.bom{background:#16301e;color:#9be7a8}.pan-recado.erro{background:#3a1717;color:#ffb0b0}' +
    '.pan-nota{margin:0;font-size:12px;color:#a79c80}';
  function estilo() {
    if (document.getElementById('pan-estilo')) return;
    var s = document.createElement('style');
    s.id = 'pan-estilo';
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  function html() {
    var h = '<p class="pan-intro">' + Tx('Assista a um anúncio até o fim e ganhe um prêmio. Você escolhe qual, e só aparece anúncio quando você toca no botão.') + '</p>';
    if (st.ocupado) h += '<p class="pan-recado" role="status" data-pan-passo="' + esc(st.passo) + '">' + esc(PASSO[st.passo] || PASSO.bilhete) + '</p>';
    else if (st.recado) h += '<p class="pan-recado ' + st.recado.tipo + '" role="status" data-pan-recado>' + esc(st.recado.texto) + '</p>';
    if (st.fase !== 'ok') {
      h += '<p class="pan-estado" data-pan-fase="' + esc(st.fase) + '">' + esc(FASE[st.fase] || st.erro || Tx('Não deu para abrir esta área.')) + '</p>';
      if (st.fase !== 'carregando' && st.fase !== 'desligado') h += '<button type="button" class="pan-bt" data-pan-de-novo>' + Tx('Tentar de novo') + '</button>';
      return h;
    }
    if (st.mestre) h += '<p class="pan-estado" data-pan-mestre>' + esc(recado('mestre').texto) + '</p>';
    h += '<div class="pan-lista">' + TIPOS.map(function (tipo) {
      var p = st.premios[tipo];
      if (!p) return '';
      var cheio = p.faltam <= 0;
      var rotulo = st.ocupado === tipo ? Tx('Aguarde…') : cheio ? Tx('Volta às {a}', { a: horaDaVolta() }) : Tx('Assistir anúncio');
      return '<article class="pan-cartao" data-pan-premio="' + tipo + '">' +
        '<h4>' + esc(nomeDoPremio(tipo)) + '</h4>' +
        '<p>' + Tx('Por anúncio assistido. Até {a} por dia.', { a: p.limite }) + '</p>' +
        '<p class="pan-conta" data-pan-conta>' + Tx('{a} de {b} hoje', { a: p.hoje, b: p.limite }) + '</p>' +
        (cheio ? '<p class="pan-nota">' + Tx('Limite de hoje atingido.') + '</p>' : '') +
        '<button type="button" class="pan-bt" data-pan-assistir="' + tipo + '"' +
        (st.ocupado || cheio || st.mestre ? ' disabled' : '') + '>' + esc(rotulo) + '</button></article>';
    }).join('') + '</div>';
    h += '<p class="pan-nota">' + Tx('Quem entrega o prêmio é o servidor do jogo, quando a Google confirma que o anúncio foi visto até o fim: pode levar alguns segundos. Fechar o anúncio antes do fim não dá prêmio e não tira nada.') +
      (depuracao() ? ' · ' + Tx('Aplicativo de teste: o anúncio é de teste e não dá prêmio.') : '') + '</p>';
    return h;
  }
  function pinta() {
    if (!fundo) return;
    var corpo = fundo.querySelector('[data-pan-corpo]');
    if (corpo) corpo.innerHTML = html();
  }
  P.aberto = function () { return !!fundo; };
  P.fecha = function () {
    if (!fundo) return false;
    if (st.passo === 'assistindo') return true;        // com o anúncio na tela, o voltar é dele
    if (fundo.parentNode) fundo.parentNode.removeChild(fundo);
    fundo = null;
    return true;
  };
  /* ENTRAR NA ÁREA: o único lugar de onde sai qualquer coisa de anúncio. Fora do aplicativo, nada. */
  P.abre = function () {
    if (!P.noApp() || fundo) return;
    estilo();
    fundo = document.createElement('div');
    fundo.className = 'pan pan-fundo';
    fundo.setAttribute('role', 'dialog');
    fundo.setAttribute('aria-modal', 'true');
    fundo.setAttribute('aria-label', Tx('Ganhar prêmios'));
    fundo.innerHTML = '<div class="pan-caixa"><div class="pan-cab"><h3>' + Tx('Ganhar prêmios') +
      '</h3><button type="button" class="pan-fechar" data-pan-fechar>' + Tx('Fechar') + '</button></div><div data-pan-corpo></div></div>';
    fundo.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t === fundo || (t && t.closest && t.closest('[data-pan-fechar]'))) { P.fecha(); return; }
      var bt = t && t.closest ? t.closest('[data-pan-assistir]') : null;
      if (bt && !bt.disabled) { assiste(bt.getAttribute('data-pan-assistir')); return; }
      if (t && t.closest && t.closest('[data-pan-de-novo]')) entra();
    });
    document.body.appendChild(fundo);
    entra();
  };
})();
