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
 * O ATALHO DA PRAÇA (06/10, o dono: "um ícone em destaque... uma bolinha de ouro com Prêmio Grátis!"): a
 * moeda no canto da praça é um botão DO JOGO que só abre esta área (P.atalho, no fim do arquivo). Ela não
 * busca a ponte, não liga o SDK e não pergunta nada; só lê do servidor do jogo quantos prêmios restam hoje.
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
  var lidoEm = 0;                                                  // quando o estado do dia foi lido (o atalho da praça)

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
    lidoEm = Date.now();
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
    '.pan-nota{margin:0;font-size:12px;color:#a79c80}' +
    /* o atalho da praça: a moeda fica na coluna da direita, abaixo das pílulas dos eventos e da loja */
    '.pan-atalho{position:absolute;right:calc(var(--sa-r,0px) + 8px);top:calc(var(--sa-t,0px) + 128px);z-index:3;pointer-events:auto;' +
    'display:flex;flex-direction:column;align-items:center;gap:3px;min-width:48px;min-height:48px;margin:0;padding:2px;border:0;background:none;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
    '@media (pointer:coarse){.pan-atalho{top:calc(var(--sa-t,0px) + 156px)}}' +
    '.pan-atalho.is-off{display:none}' +
    '.pan-moeda{position:relative;width:44px;height:44px;border-radius:50%;animation:pan-pulso 2.8s ease-out infinite}' +
    '.pan-moeda svg{display:block;width:44px;height:44px}' +
    '.pan-selo{position:absolute;top:-5px;left:-7px;min-width:19px;height:19px;padding:0 4px;box-sizing:border-box;border-radius:10px;background:#b3261e;border:1px solid #12100b;color:#fff;font:700 11px/17px system-ui,sans-serif;text-align:center}' +
    '.pan-atalho-rot{font:700 11px/1.25 system-ui,sans-serif;color:#ffe9a8;background:rgba(40,30,12,.92);border:1px solid rgba(240,200,110,.6);border-radius:999px;padding:2px 7px;white-space:nowrap}' +
    '@keyframes pan-pulso{0%{box-shadow:0 2px 8px rgba(0,0,0,.5),0 0 0 0 rgba(255,211,106,.6)}60%,100%{box-shadow:0 2px 8px rgba(0,0,0,.5),0 0 0 11px rgba(255,211,106,0)}}' +
    '@media (prefers-reduced-motion:reduce){.pan-moeda{animation:none;box-shadow:0 2px 8px rgba(0,0,0,.5)}}';
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
    atualizaAtalho(true);                              // o selo da moeda da praça acompanha o que foi ganho
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

  /* ---- O ATALHO DA PRAÇA: a moeda de ouro "Prêmio Grátis!" ----
   * Um botão do jogo, só no aplicativo, só para a conta comum conectada. Tocar faz o mesmo que o botão das
   * Configurações (P.abre) e mais nada: daqui não sai ponte, SDK, pergunta de privacidade nem anúncio.
   * O selo é a soma do que ainda resta hoje nos dois prêmios, lida de GET /api/anuncio (o servidor do JOGO):
   * uma leitura ao chegar à praça (no máximo uma a cada REFRESCO), uma ao fechar a área e uma na virada do
   * dia. Acabaram os dois limites: a moeda SOME (a praça fica como era) e volta sozinha quando o dia vira.
   * Quem mexe é só este botão: a praça não é repintada por causa dele. */
  var REFRESCO = 10 * 60 * 1000;
  var MOEDA = '<svg viewBox="0 0 44 44" aria-hidden="true"><defs><radialGradient id="pan-ouro" cx="35%" cy="30%" r="75%">' +
    '<stop offset="0" stop-color="#fff3bf"/><stop offset=".45" stop-color="#f2c94c"/><stop offset="1" stop-color="#a8741a"/></radialGradient></defs>' +
    '<circle cx="22" cy="22" r="21" fill="url(#pan-ouro)" stroke="#6b4a10" stroke-width="2"/>' +
    '<circle cx="22" cy="22" r="15.5" fill="none" stroke="#7a5412" stroke-opacity=".55" stroke-width="1.5"/>' +
    '<path d="M22 11l3.1 6.6 7.2.9-5.3 5 1.4 7.1L22 27.1l-6.4 3.5 1.4-7.1-5.3-5 7.2-.9z" fill="#7a4d08" fill-opacity=".85"/></svg>';
  var atalho = null, atalhoIndo = false, atalhoRelogio = null, atalhoConta = null;
  function contaDaVez() {
    try {
      var S = JOGO.Sessao;
      if (!S || !S.ativa || !S.ativa()) return null;
      if (JOGO.GM && JOGO.GM.ativo && JOGO.GM.ativo()) return null;      // o Mestre não participa
      return String((S.contaId && S.contaId()) || 'conta');
    } catch (e) { return null; }
  }
  function restam() {
    var n = 0;
    TIPOS.forEach(function (t) { var p = st.premios[t]; if (p) n += Math.max(0, Number(p.faltam) || 0); });
    return n;
  }
  function pintaAtalho() {
    if (!atalho) return;
    var conta = contaDaVez();
    var n = (conta && conta === atalhoConta && lidoEm && !st.mestre) ? restam() : 0;
    atalho.className = 'pan-atalho' + (n > 0 ? '' : ' is-off');
    atalho.setAttribute('aria-label', Tx('Prêmio Grátis!') + ' ' + Tx('Restam {a} hoje.', { a: n }));
    atalho.innerHTML = '<span class="pan-moeda">' + MOEDA + '<span class="pan-selo" data-pan-restam>' + n + '</span></span>' +
      '<span class="pan-atalho-rot">' + Tx('Prêmio Grátis!') + '</span>';
  }
  function atualizaAtalho(forca) {
    if (!atalho) return;
    var conta = contaDaVez(), agora = Date.now();
    if (conta !== atalhoConta) { atalhoConta = conta; st.premios = {}; st.mestre = false; lidoEm = 0; }   // outra conta: nada do que foi lido vale
    var virou = st.zeraEm > 0 && agora >= st.zeraEm * 1000;
    if (!conta || atalhoIndo || (!forca && !virou && lidoEm && agora - lidoEm < REFRESCO)) { pintaAtalho(); return; }
    atalhoIndo = true;
    consulta().then(function () {
      atalhoIndo = false;
      pintaAtalho();
      // UM relógio, para a virada do dia; se o botão já saiu da tela (a praça foi desmontada), ele morre aqui
      if (atalhoRelogio) { clearTimeout(atalhoRelogio); atalhoRelogio = null; }
      var falta = st.zeraEm * 1000 - Date.now();
      if (falta > 0 && falta < 2147000000) {
        atalhoRelogio = setTimeout(function () {
          atalhoRelogio = null;
          if (atalho && atalho.isConnected !== false) atualizaAtalho(true);
        }, falta + 5000);
      }
    });
  }
  /* A praça chama isto UMA vez ao ser montada (js/ui/hud.js). Fora do aplicativo: nada, nem elemento. */
  P.atalho = function (onde) {
    if (!P.noApp() || !onde || !onde.appendChild) return null;
    estilo();
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pan-atalho is-off';
    b.addEventListener('click', function () { P.abre(); });
    onde.appendChild(b);
    atalho = b;
    atualizaAtalho(false);
    return b;
  };
})();
