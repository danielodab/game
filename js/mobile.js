// SOTERRA — o que este aparelho é (dono: Agente Mobile).
//
// Um só lugar responde três perguntas que o resto do jogo faz o tempo todo, e
// que antes ninguém respondia:
//
//   toque()      — o dedo é o ponteiro principal? Se for, PASSAR POR CIMA não
//                  existe, e a prévia de área de feitiço precisa de outra porta
//                  (ver `renderer3d_v2.js`: toque-para-mirar, 2º toque confirma).
//   celular()    — a tela é estreita/retrato? A HUD desenhada para 1280 px não
//                  cabe em 390 px sem encolher.
//   economico()  — vale cortar brilho e traço? GPU de celular paga caro em
//                  preenchimento de tela, e o bloom são 5 desfoques por quadro.
//
// Nada aqui adivinha por marca de aparelho: `navigator.userAgent` mente e muda.
// Medimos o que importa — ponteiro grosso, ausência de hover, tamanho da tela.
//
// Manda por cima de tudo: `?mobile=1` liga, `?mobile=0` desliga. É como se testa
// o modo celular numa máquina de mesa (e é como `tests/perf.html` mede os dois).

var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

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
  JOGO.Mobile = M;

  var busca = (typeof location !== 'undefined' && location.search) || '';
  var forcado = /[?&]mobile=1/.test(busca) ? true
              : /[?&]mobile=0/.test(busca) ? false
              : null;
  M.forcado = forcado;

  /* O APLICATIVO (04/10, o dono: "não pode afetar o jogo da web, pois lá joga o pessoal de computador").
   * Tudo o que é só do aplicativo de Android pergunta aqui antes. `nativo()` é a casca de verdade: o
   * Capacitor põe `window.Capacitor` na página ANTES do primeiro script, e fora dele isso não existe.
   * `?app=1` finge a casca no navegador — é como as provas exercitam o botão voltar e o segundo plano
   * sem aparelho. Sem um nem outro, `app()` é falso e nada abaixo liga: a web segue igual. */
  var appForcado = /[?&]app=1(&|$)/.test(busca);
  M.nativo = function () {
    try {
      var C = (typeof window !== 'undefined') ? window.Capacitor : null;
      return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
    } catch (e) { return false; }
  };
  M.app = function () { return appForcado || M.nativo(); };

  function media(q) {
    try { return !!(window.matchMedia && window.matchMedia(q).matches); }
    catch (e) { return false; }
  }

  function temToque() {
    if (typeof window === 'undefined') return false;
    if (navigator.maxTouchPoints > 0) return true;
    if ('ontouchstart' in window) return true;
    return media('(pointer: coarse)');
  }

  // "Sem hover" é o teste que importa para a prévia de feitiço: um híbrido
  // (notebook com tela sensível) TEM mouse, e ali passar por cima funciona.
  var toque = (forcado !== null) ? forcado : (temToque() && media('(hover: none)'));

  function larguraCurta() {
    var w = (window.innerWidth || 1280);
    var h = (window.innerHeight || 800);
    return Math.min(w, h) <= 520 || w <= 820;
  }
  /* Tela de aparelho, não janela pequena. A distinção importa: `larguraCurta`
   * dá verdadeiro numa janela de navegador de 800 px numa máquina de mesa — e
   * foi exatamente isso que apagou o brilho e o traço na medição de desktop,
   * fingindo um ganho que não existia. Aqui o corte é o formato de telefone:
   * um lado curto DE VERDADE e nenhum lado grande. */
  function telaDeAparelho() {
    var w = (window.innerWidth || 1280);
    var h = (window.innerHeight || 800);
    return Math.min(w, h) <= 480 && Math.max(w, h) <= 1024;
  }

  M.toque = function () { return toque; };
  M.celular = function () {
    if (forcado !== null) return forcado;
    return toque && larguraCurta();
  };
  M.retrato = function () { return (window.innerHeight || 0) >= (window.innerWidth || 1); };
  // Economia de GPU: vale para qualquer aparelho de toque, e para tela de
  // telefone — nunca por uma janela de desktop estar estreita.
  M.economico = function () {
    if (forcado !== null) return forcado;
    return toque || telaDeAparelho();
  };

  /* A QUALIDADE GRÁFICA (04/10, o dono: "teria como um usuário conseguir definir a resolução? assim para pc ou
   * celular mais fraco ele consiga jogar"). Três níveis, escolhidos nas Configurações e guardados no aparelho
   * (a mesma chave soterra-pref-ui das outras preferências). Cada um diz: `escala` (quanto da resolução da tela
   * o 3D desenha — a HUD é DOM e segue nítida), `cor`/`dado` (o teto, em pixels, da textura de cor e das de
   * relevo/brilho ao ABRIR um modelo; 0 = como veio) e `bloom`. A textura é o que enche a memória da aba: no
   * nível baixo cada modelo abre com um quarto dela ou menos. Vale ao recarregar, porque modelo aberto não reabre. */
  var GRAFICOS = {
    alta:  { escala: 1,    cor: 0,   dado: 0,   bloom: true },
    media: { escala: 0.75, cor: 0,   dado: 256, bloom: true },
    baixa: { escala: 0.5,  cor: 512, dado: 256, bloom: false }
  };
  var nivelGrafico = null;
  /* O nível de quem AINDA NÃO ESCOLHEU. Na web é 'alta', como sempre foi. No aplicativo é 'media' — o
   * telefone desenha a tela inteira com GPU de bolso —, e 'baixa' no aparelho fraco: até 2 GB de memória
   * (navigator.deviceMemory, que o WebView do Android informa) ou tela de lado curto até 360 px. A
   * escolha gravada nas Configurações (e o ?graficos=) continua mandando por cima, em qualquer lugar. */
  M.aparelhoFraco = function () {
    try {
      var mem = Number(navigator.deviceMemory);
      if (mem > 0 && mem <= 2) return true;
      var t = window.screen || {};
      var curto = Math.min(t.width || window.innerWidth || 9999, t.height || window.innerHeight || 9999);
      return curto <= 360;
    } catch (e) { return false; }
  };
  M.padraoGrafico = function () {
    /* 04/10, o dono: "a conta superadmin, quando vou entrar pelo celular, abre o jogo e cai e fica carregando".
     * No navegador do TELEFONE o padrão era 'alta', como no computador: a conta com tudo liberado abria a
     * praça com ~700 MB de textura e a aba morria por falta de memória. Telefone (no navegador ou no app)
     * começa em 'baixa' — a tela pequena não mostra a diferença; o computador segue em 'alta', e a escolha
     * das Configurações continua vencendo. */
    var telefone = false;
    try { telefone = telaDeAparelho() || M.celular(); } catch (e) {}
    if (!M.app() && !telefone) return 'alta';
    return (telefone || M.aparelhoFraco()) ? 'baixa' : 'media';
  };
  M.qualidade = function () {
    if (nivelGrafico) return nivelGrafico;
    var n = M.padraoGrafico();
    try {
      var m = /[?&]graficos=(alta|media|baixa)/.exec(String(location.search || ''));
      if (m) n = m[1];
      else { var p = JSON.parse(localStorage.getItem('soterra-pref-ui') || '{}') || {}; if (GRAFICOS[p.graficos]) n = p.graficos; }
    } catch (e) {}
    nivelGrafico = n;                 // fixo até recarregar: metade dos modelos numa qualidade e metade noutra não
    return n;
  };
  M.grafico = function () { return GRAFICOS[M.qualidade()]; };
  M.NIVEIS_GRAFICOS = ['alta', 'media', 'baixa'];

  // Classes no <html> para o CSS que a consulta de mídia não alcança sozinha
  // (ex.: alvo de 44 px só quando o ponteiro é o dedo).
  function marca() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    var c = document.documentElement.classList;
    if (!c) return;
    c.toggle('toque', M.toque());
    c.toggle('celular', M.celular());
    c.toggle('retrato', M.retrato());
    if (M.app()) c.add('app');          // só entra dentro do aplicativo: na web a classe nunca existe
  }
  M.remarca = marca;
  marca();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', marca);
    window.addEventListener('orientationchange', function () { setTimeout(marca, 80); });
  }

  // =================================================== SÓ DENTRO DO APLICATIVO
  //
  // Daqui para baixo nada roda na web: `ligaApp` sai na primeira linha quando `app()` é falso.
  //
  //   VOLTAR (o botão do Android) — fecha o que estiver aberto (JOGO.UI.voltar: a ficha, o painel);
  //     sem nada aberto, PERGUNTA antes de sair. Na batalha a pergunta avisa que a luta segue sem
  //     ele. Voltar de novo com a pergunta na tela a fecha: é o "não" de quem apertou sem querer.
  //   SEGUNDO PLANO — o som cala (JOGO.Audio.pausa) e volta ao retornar. O laço de desenho NÃO é
  //     parado à mão: o WebView escondido para o requestAnimationFrame sozinho, igual à aba
  //     escondida da web, e o jogo já sabe viver isso (o coop.js acerta o turno pelo tempo que
  //     passou; sessao.js e rede.js religam). Parar por conta própria criaria um segundo jeito
  //     de pausar, diferente do que a web prova todo dia.
  //   TELA ACESA — só durante a batalha (o turno do outro pode levar 30 s sem um toque).
  var App = null, Vigilia = null;      // os plugins @capacitor/app e keep-awake, quando há casca
  var perguntaEl = null;
  var acordado = false;

  function emBatalha() {
    try { var G = JOGO.Game; return !!(G && G.screen === 'battle' && G.state); } catch (e) { return false; }
  }
  function fechaPergunta() {
    if (perguntaEl && perguntaEl.parentNode) perguntaEl.parentNode.removeChild(perguntaEl);
    perguntaEl = null;
  }
  function sai() {
    fechaPergunta();
    M.saiu = true;                     // as provas leem isto: no navegador não há o que fechar
    try { if (App && App.exitApp) App.exitApp(); } catch (e) {}
  }
  function pergunta(texto) {
    fechaPergunta();
    var capa = document.createElement('div');
    capa.id = 'app-sair';
    capa.setAttribute('role', 'dialog');
    capa.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,.72);padding:24px;font:16px/1.5 "Segoe UI",sans-serif;color:#e8e0d0';
    var cx = document.createElement('div');
    cx.style.cssText = 'max-width:340px;background:#171b21;border:1px solid #5a4a2a;border-radius:10px;padding:20px;text-align:center';
    var p = document.createElement('p');
    p.textContent = texto;
    p.style.cssText = 'margin:0 0 16px';
    cx.appendChild(p);
    function botao(id, rotulo, cor, fn) {
      var b = document.createElement('button');
      b.type = 'button';
      b.id = id;
      b.textContent = rotulo;
      b.style.cssText = 'min-width:110px;min-height:44px;margin:0 6px;border-radius:8px;border:1px solid #5a4a2a;' +
        'font:inherit;color:#e8e0d0;background:' + cor;
      b.addEventListener('click', fn);
      cx.appendChild(b);
    }
    botao('app-sair-nao', Tx('Ficar'), '#2a3038', fechaPergunta);
    botao('app-sair-sim', Tx('Sair'), '#7a2f25', sai);
    capa.appendChild(cx);
    document.body.appendChild(capa);
    perguntaEl = capa;
  }
  /* O botão voltar. Devolve o que fez ('pergunta-fechada', 'fechou', 'perguntou') — as provas conferem. */
  M.voltar = function () {
    if (!M.app()) return null;
    if (perguntaEl) { fechaPergunta(); return 'pergunta-fechada'; }
    var fechou = false;
    try { fechou = !!(JOGO.UI && JOGO.UI.voltar && JOGO.UI.voltar()); } catch (e) {}
    if (fechou) return 'fechou';
    pergunta(emBatalha()
      ? Tx('Sair no meio da batalha? Ela continua sem você.')
      : Tx('Sair do SOTERRA?'));
    return 'perguntou';
  };
  /* Segundo plano: `fora` verdadeiro ao sair da frente, falso ao voltar. */
  M.segundoPlano = function (fora) {
    if (!M.app()) return;
    fora = !!fora;
    if (!!M.fora === fora) return;
    M.fora = fora;
    try { if (JOGO.Audio && JOGO.Audio.pausa) JOGO.Audio.pausa(fora); } catch (e) {}
    vigia();
  };
  function vigia() {
    var quer = emBatalha() && !M.fora;
    if (quer === acordado) return;
    acordado = quer;
    M.telaAcesa = quer;
    try { if (Vigilia) Vigilia[quer ? 'keepAwake' : 'allowSleep'](); } catch (e) {}
  }
  M._vigia = vigia;
  function carrega(lista, fim) {
    if (!lista.length) return fim();
    var s = document.createElement('script');
    s.src = lista[0];
    s.onload = function () { carrega(lista.slice(1), fim); };
    s.onerror = function () { carrega(lista.slice(1), fim); };   // sem o arquivo, o resto segue: o jogo abre
    document.head.appendChild(s);
  }
  function ligaApp() {
    if (!M.app() || typeof document === 'undefined' || !document.addEventListener) return;
    // o WebView avisa por visibilitychange quando o aplicativo sai da frente; o plugin App repete o
    // aviso (appStateChange) nos aparelhos em que a página não o recebe. Os dois caem no mesmo lugar.
    document.addEventListener('visibilitychange', function () { M.segundoPlano(!!document.hidden); });
    setInterval(vigia, 3000);
    if (!M.nativo()) return;            // `?app=1` no navegador: não há casca para ligar
    // Os plugins vêm de vendor/capacitor/, cópia do node_modules que o empacota_www.py confere. O aplicativo abre o
    // jogo do SERVIDOR (04/10), então é ele que os entrega — mas só a quem está na casca. O `__url` põe o
    // hash do build no endereço, como em todo arquivo do jogo: o WebView não fica preso a versão velha.
    var url = (typeof window.__url === 'function') ? window.__url : function (f) { return f; };
    // Entram por aqui e não pela lista do index.html, que é a da web: lá ninguém os pede.
    var arquivos = window.capacitorApp ? []     // já na página (as provas põem um de mentira): nada a buscar
      : [url('vendor/capacitor/capacitor.js'), url('vendor/capacitor/app.js'), url('vendor/capacitor/keep-awake.js'),
         url('vendor/capacitor/native-purchases.js')];   // a compra pela Google Play (js/core/compra_play.js)
    carrega(arquivos, function () {
      try { App = window.capacitorApp && window.capacitorApp.App; } catch (e) {}
      try { Vigilia = window.capacitorKeepAwake && window.capacitorKeepAwake.KeepAwake; } catch (e2) {}
      if (!App) return;
      // com um ouvinte de backButton o Capacitor deixa de fechar o aplicativo sozinho
      App.addListener('backButton', function () { M.voltar(); });
      App.addListener('appStateChange', function (st) { M.segundoPlano(!(st && st.isActive)); });
    });
  }
  ligaApp();
})();
