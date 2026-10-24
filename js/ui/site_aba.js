// SOTERRA — a ABA DO SITE dentro do jogo (dono: Agente Mobile).
//
// 24/10, o dono: "preciso que meu app não seja o site ao fechar o jogo — seja somente página de login. O site é
// a parte se o usuário quiser navegar: dentro do jogo deve ter um ícone de um globo com nome Site, que leva pro
// site do jogo e abre uma aba do site no próprio jogo."
//
// NO APLICATIVO (JOGO.Mobile.app()) o site abre num QUADRO por cima do jogo: a mesma origem, a mesma sessão, e o
// jogo segue de pé embaixo (o desenho para enquanto a aba cobre a tela, fora da batalha). Todo link do jogo para
// uma página do site cai aqui — o globo, a loja, o calendário, o ranking do Eco, os Termos — por UM ouvinte de
// clique no document, sem mexer em cada link: eles continuam links. Antes, no aplicativo, cada um deles levava
// o WebView inteiro para o site, e o jogo sumia. Voltar ao jogo: o "Voltar ao jogo" do topo da aba, o "Jogar"
// do site, o botão voltar do Android (anda para trás dentro da aba e, na primeira página, fecha) ou o Esc. A
// batalha que começa fecha a aba (js/ui/hud.js, UI.showScreen).
//
// O SITE SABE que está na aba (site/site.js, SITE.naAba): o "Jogar" fecha a aba, link para fora do jogo vai
// para o navegador do aparelho, e a loja compra pela Google Play DESTE quadro, o do jogo, onde a ponte do
// Capacitor é a provada (site/loja.js). FORA da aba o aplicativo não mostra o site: só a entrada
// (SITE.portaDoApp). Os dois lados se falam por postMessage, só da mesma origem e só do quadro da aba.
//
// NA WEB TAMBÉM (24/10, o dono: "onde o usuário consegue abrir a loja dentro do jogo e já comprar ali, pagando pela
// Google ou pelo Mercado Pago"): a mesma aba, sem a marca do aplicativo — o site sabe que está na aba e não no
// aplicativo, e a loja vende pelo Mercado Pago, que abre numa aba NOVA do navegador (site/loja.js; a página do
// Mercado Pago não aceita ser posta num quadro). No aplicativo a loja segue só com a Google Play (a regra da Play).
// Clique com Ctrl, Shift ou o botão do meio continua abrindo o site numa aba do navegador. O botão LOJA (o saco)
// abre a aba direto na loja: é a porta da loja dentro do jogo.
//
// Prova: tests/site_aba.html (a aba de verdade, com as páginas do site dentro) e tests/site_porta.html.

var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

(function () {
  'use strict';
  /* O TEXTO NO IDIOMA DO JOGADOR (docs/IDIOMAS.md): a chave é o próprio português. Sem o JOGO.I18n
   * (as provas que não o carregam) volta o português, com as {variáveis}. */
  function Tx(s, v) {
    var I = (typeof JOGO !== 'undefined' && JOGO) ? JOGO.I18n : null;
    if (I && I.t) return I.t(s, v);
    if (!v) return s;
    return String(s).replace(/\{([A-Za-z_]\w*)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m;
    });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var SA = {};
  JOGO.SiteAba = SA;
  SA.MARCA = 'site-aba';            // o `soterra` das mensagens do quadro (site/site.js manda o mesmo)

  var capa = null, quadro = null, titEl = null, voltaEl = null, cargaEl = null;
  var pilha = [];                   // os endereços abertos no quadro, o de agora por último (o voltar do Android)
  var substituindo = false;         // o próximo `load` é o do voltar: não empilha
  var tokenAoAbrir = null;          // a sessão de quando a aba abriu (o site pode sair ou trocar de conta)
  var pausou = false;

  function noApp() {
    try { return !!(JOGO.Mobile && typeof JOGO.Mobile.app === 'function' && JOGO.Mobile.app()); } catch (e) { return false; }
  }
  SA.noApp = noApp;

  /* ---- os endereços ---- */
  /* a pasta do jogo (onde mora o index.html), com a barra no fim — a mesma conta do js/core/sessao.js */
  SA._raiz = null;                  // as provas, que moram em tests/, apontam aqui a pasta do jogo
  function raiz() { return SA._raiz || String(location.href || '').split('#')[0].split('?')[0].replace(/[^\/\\]*$/, ''); }
  SA.endereco = function (pagina) { return raiz() + 'site/' + (pagina || 'index.html'); };
  function url(u) { try { return new URL(String(u), location.href); } catch (e) { return null; } }
  /* `u` é uma página do site deste jogo? Devolve o endereço inteiro; senão, null. Só http(s) da mesma origem,
   * dentro da pasta site/ do jogo. */
  SA.doSite = function (u) {
    var x = u ? url(u) : null;
    if (!x || (x.protocol !== 'http:' && x.protocol !== 'https:') || x.origin !== location.origin) return null;
    var pasta = url(raiz() + 'site/');
    if (!pasta || x.pathname.indexOf(pasta.pathname) !== 0) return null;
    return x.href;
  };
  /* o endereço é o do próprio jogo (esta página)? */
  function ehOJogo(u) {
    var x = url(u);
    return !!(x && x.origin === location.origin && x.pathname === location.pathname);
  }
  function semHash(u) { return String(u || '').split('#')[0]; }
  /* a primeira página do quadro leva `app=1`: é como o site sabe que está no aplicativo mesmo sem o Capacitor
   * no quadro (SITE.noApp guarda a marca na sessão da aba, e ela segue para as páginas seguintes) */
  function comMarca(u) {
    var x = url(u);
    if (!x) return u;
    if (!/(^|&)app=1(&|$)/.test(x.search.slice(1))) x.search = x.search ? x.search + '&app=1' : '?app=1';
    return x.href;
  }
  function lerToken() {
    try {
      var s = JSON.parse(window.localStorage.getItem('soterra-sessao') || 'null');
      return (s && typeof s.token === 'string' && s.token) || null;
    } catch (e) { return null; }
  }
  function emBatalha() { try { var G = JOGO.Game; return !!(G && G.screen === 'battle'); } catch (e) { return false; } }

  /* ---- os ícones ---- */
  var RESERVA = { globo: '🌐', loja: '🛍' };
  function icone(id) {
    var s = '';
    try { s = (JOGO.IconesUI && JOGO.IconesUI.svg) ? JOGO.IconesUI.svg(id) : ''; } catch (e) {}
    return s || '<span class="bt-site-ic" aria-hidden="true">' + (RESERVA[id] || '') + '</span>';
  }
  function globo() { return icone('globo'); }
  /* Um botão do jogo para uma página do site: um LINK (com target=_blank, para o Ctrl+clique e para quem não tem
   * este arquivo ligado), que o ouvinte de clique daqui abre na aba de dentro do jogo. Sem `op`, é o "Site" com o
   * globo, na capa do site; {pagina, icone, titulo} fazem os outros — a "Loja" com o saco abre na loja. O
   * textContent é só o rótulo. */
  SA.botao = function (cls, rotulo, op) {
    op = op || {};
    var a = document.createElement('a');
    a.className = 'btn bt-site' + (cls ? ' ' + cls : '');
    a.href = SA.endereco(op.pagina || 'index.html');
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = op.titulo || Tx('O site do SOTERRA: eventos, ranking, wiki, loja e a sua conta');
    a.innerHTML = icone(op.icone || 'globo') + '<span class="bt-site-rot">' + esc(rotulo || Tx('Site')) + '</span>';
    return a;
  };

  /* ---- a aba ---- */
  function botao(cls, html, rotulo, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.innerHTML = html;
    if (rotulo) { b.setAttribute('aria-label', rotulo); b.title = rotulo; }
    b.addEventListener('click', function (ev) { ev.preventDefault(); fn(); });
    return b;
  }
  function monta() {
    capa = document.createElement('div');
    capa.className = 'site-aba';
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-modal', 'true');
    capa.setAttribute('aria-label', Tx('Site do SOTERRA'));
    var cab = document.createElement('div');
    cab.className = 'site-aba-cab';
    voltaEl = botao('site-aba-volta', '&#8249;', Tx('Voltar uma página'), function () { SA.voltar(); });
    voltaEl.hidden = true;
    cab.appendChild(voltaEl);
    var marca = document.createElement('span');
    marca.className = 'site-aba-marca';
    marca.innerHTML = globo() + '<b>' + esc(Tx('Site')) + '</b>';
    titEl = document.createElement('span');
    titEl.className = 'site-aba-tit';
    marca.appendChild(titEl);
    cab.appendChild(marca);
    cab.appendChild(botao('site-aba-fecha', '<span aria-hidden="true">&#10005;</span> ' + esc(Tx('Voltar ao jogo')), null,
      function () { SA.fecha(); }));
    capa.appendChild(cab);
    cargaEl = document.createElement('p');
    cargaEl.className = 'site-aba-carga';
    cargaEl.textContent = Tx('abrindo o site…');
    capa.appendChild(cargaEl);
    quadro = document.createElement('iframe');
    quadro.className = 'site-aba-quadro';
    quadro.title = Tx('Site do SOTERRA');
    quadro.addEventListener('load', carregou);
    capa.appendChild(quadro);
    document.body.appendChild(capa);
  }

  /* tocar no site é jogar: o relógio dos 15 minutos (js/core/sessao.js) só ouve esta página, e o toque dentro do
   * quadro não sobe até ela — sem isto, quem lê a wiki por 15 minutos perderia a sessão (e o site junto) */
  function toque() { try { if (JOGO.Sessao && JOGO.Sessao.tocou) JOGO.Sessao.tocou(); } catch (e) {} }

  function carregou() {
    if (!quadro) return;
    var w = quadro.contentWindow, href = null;
    try { href = w.location.href; } catch (e) { href = null; }       // outra origem: não se lê
    if (href === 'about:blank') return;
    // o quadro chegou ao JOGO (um caminho que escapou do site): o jogo já está aqui fora
    if (href && ehOJogo(href)) { SA.fecha(); voltouAoJogo(); return; }
    if (cargaEl) cargaEl.hidden = true;
    if (href) {
      if (substituindo) substituindo = false;
      else if (!pilha.length || semHash(pilha[pilha.length - 1]) !== semHash(href)) pilha.push(href);
    }
    if (voltaEl) voltaEl.hidden = pilha.length < 2;
    try { titEl.textContent = String(w.document.title || '').replace(/\s*[—–-]\s*SOTERRA\s*$/, ''); } catch (e2) {}
    try {
      var doc = w.document;
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (t) { doc.addEventListener(t, toque, true); });
    } catch (e3) {}
    toque();
    SA._cargas++;
  }

  /* De volta ao jogo depois do site: se a conta deste aparelho mudou lá dentro (saiu dela, entrou em outra), o
   * jogo aberto aqui é o da conta velha — o mesmo caminho da capa "Entrar de novo" (js/core/sessao.js): token
   * novo recarrega; sem token, a tela de entrar. */
  function voltouAoJogo() {
    if (lerToken() === tokenAoAbrir) return;
    var S = JOGO.Sessao;
    try { if (S && S.entrarDeNovo) { S.entrarDeNovo(); return; } } catch (e) {}
    try { location.reload(); } catch (e2) {}
  }

  /* o desenho do jogo para com a aba por cima (a bateria e o calor do telefone) — fora da batalha, que corre */
  function pausa(liga) {
    var M = JOGO.Mobile;
    if (!M) return;
    if (liga && !emBatalha()) { M.desenhoPausado = true; pausou = true; }
    else if (!liga && pausou) { M.desenhoPausado = false; pausou = false; }
  }

  /* as teclas do jogo (I, M, o Esc das fichas) não passam por baixo da aba; o Esc fecha a aba */
  function tecla(ev) {
    if (!capa) return;
    if (String(ev.key || '') === 'Escape') { ev.preventDefault(); SA.fecha(); }
    ev.stopPropagation();
  }

  /* Abre a aba na página `u` do site (a capa, sem `u`). Devolve false se `u` não é do site. */
  SA.abre = function (u) {
    var href = SA.doSite(u || SA.endereco('index.html'));
    if (!href) return false;
    if (!capa) {
      tokenAoAbrir = lerToken();
      monta();
      window.addEventListener('keydown', tecla, true);
      pausa(true);
    }
    pilha = [];
    substituindo = false;
    if (cargaEl) cargaEl.hidden = false;
    quadro.src = noApp() ? comMarca(href) : href;          // a marca do aplicativo, só no aplicativo
    try { capa.querySelector('.site-aba-fecha').focus({ preventScroll: true }); } catch (e2) {}
    return true;
  };
  SA.fecha = function () {
    if (!capa) return false;
    window.removeEventListener('keydown', tecla, true);
    if (capa.parentNode) capa.parentNode.removeChild(capa);     // o quadro sai junto, e a página dele com ele
    capa = quadro = titEl = voltaEl = cargaEl = null;
    pilha = [];
    substituindo = false;
    pausa(false);
    return true;
  };
  SA.aberta = function () { return !!capa; };
  /* O botão voltar do Android com a aba aberta: uma página para trás dentro dela; na primeira, fecha. Anda pela
   * PRÓPRIA pilha (location.replace) e nunca pelo history.back(): o histórico é um só para a página e o quadro, e
   * um passo a mais levaria o jogo inteiro para trás. Devolve true (a aba cuidou), ou false se não estava aberta. */
  SA.voltar = function () {
    if (!capa) return false;
    if (pilha.length > 1) {
      pilha.pop();
      substituindo = true;
      try { quadro.contentWindow.location.replace(pilha[pilha.length - 1]); if (voltaEl) voltaEl.hidden = pilha.length < 2; return true; }
      catch (e) { substituindo = false; }
    }
    SA.fecha();
    return true;
  };
  SA._cargas = 0;                   // as provas esperam por aqui: quantas páginas o quadro já terminou de abrir
  SA._pilha = function () { return pilha.slice(); };
  SA._quadro = function () { return quadro; };

  /* ---- os ouvintes (no aplicativo e, desde 24/10, na web) ---- */
  /* todo link do jogo para uma página do site abre na aba. O "Sair do jogo" fica de fora: no aplicativo é da casca
   * (js/mobile.js: pergunta e fecha o aplicativo); na web é a saída para o site. Clique com tecla ou botão do meio
   * fica com o navegador. Não se para a propagação: quem escuta o próprio link (o sino que fecha o painel) segue
   * escutando. */
  function clique(ev) {
    if (ev.defaultPrevented || (ev.button !== undefined && ev.button !== 0)) return;
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
    var a = null;
    try { a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null; } catch (e) {}
    if (!a || (a.classList && a.classList.contains('menu-sair')) || (capa && capa.contains(a))) return;
    var href = SA.doSite(a.href);
    if (!href) return;
    ev.preventDefault();
    SA.abre(href);
  }
  /* o que o site manda de dentro do quadro: 'jogo' = o "Jogar", ou a entrada que terminou lá dentro */
  function mensagem(ev) {
    if (!capa || !quadro || ev.source !== quadro.contentWindow) return;
    if (location.protocol !== 'file:' && ev.origin !== location.origin) return;
    var d = ev.data;
    if (!d || d.soterra !== SA.MARCA) return;
    if (d.acao === 'jogo') { SA.fecha(); voltouAoJogo(); }
  }
  SA.ligado = false;
  function liga() {
    if (SA.ligado || typeof document === 'undefined' || !document.addEventListener) return;
    SA.ligado = true;
    document.addEventListener('click', clique, true);
    window.addEventListener('message', mensagem);
  }
  liga();
})();
