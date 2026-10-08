// Os AVISOS do aplicativo (notificações locais) — só dentro da casca Android.
(function () {
  'use strict';
  /* O QUE ISTO É (08/10, o dono: "pode ter o aviso de push do app")
   * ==============================================================
   * Lembretes que o PRÓPRIO APARELHO dispara, sem servidor e sem Firebase
   * (@capacitor/local-notifications). Três avisos, todos locais:
   *   1. todo dia às 10:00 — "o prêmio diário está esperando" (id 1001);
   *   2. toda segunda às 12:00 — "a semana do Eco Primordial abriu" (id 1002);
   *   3. três dias sem abrir o jogo — "o Calabouço do Dia mudou" (id 1003): é marcado
   *      a cada abertura para daqui a 3 dias, então só dispara se o jogador sumir.
   * Nada é mandado de fora: um "push" de verdade (o servidor avisando "sua guilda está
   * em guerra") pede o Firebase do dono — não existe aqui.
   *
   * A ponte do plugin (vendor/capacitor/local-notifications.js) só é carregada no
   * aplicativo, na primeira ligação. A regra de 06/10 vale: NUNCA resolver uma Promise
   * com o objeto do plugin (é um Proxy que responde a `then`); `plugin()` na hora.
   * O jogador desliga tudo nas Configurações (localStorage 'soterra-avisos' = '0'). */
  function Tx(s, v) {
    var I = (typeof JOGO !== 'undefined' && JOGO) ? JOGO.I18n : null;
    if (I && I.t) return I.t(s, v);
    if (!v) return s;
    return String(s).replace(/\{([A-Za-z_]\w*)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m;
    });
  }
  var JOGO = window.JOGO = window.JOGO || {};
  var N = JOGO.Notificacoes = {};

  var CHAVE = 'soterra-avisos';
  var ID = { diario: 1001, eco: 1002, saudade: 1003 };
  var HORA_DIARIO = 10, HORA_ECO = 12, DIAS_SAUDADE = 3;
  N.IDS = ID;

  function nativo() {
    try { var C = window.Capacitor; return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()); }
    catch (e) { return false; }
  }
  function plugin() {
    try { var g = window.capacitorLocalNotifications; return (g && g.LocalNotifications) || null; }
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
  var ponteP = null;
  function ponte() {
    if (plugin() || !nativo()) return Promise.resolve(!!plugin());
    if (ponteP) return ponteP;
    var url = (typeof window.__url === 'function') ? window.__url : function (f) { return f; };
    ponteP = (window.capacitorExports ? Promise.resolve() : carrega(url('vendor/capacitor/capacitor.js')))
      .then(function () { return carrega(url('vendor/capacitor/local-notifications.js')); })
      .then(function () { return !!plugin(); });
    ponteP.then(function (tem) { if (!tem) ponteP = null; });
    return ponteP;
  }

  /* o jogador quer os avisos? (ligados por padrão; desliga nas Configurações) */
  N.ativas = function () {
    try { return localStorage.getItem(CHAVE) !== '0'; } catch (e) { return true; }
  };
  N.disponivel = function () { return nativo(); };
  var st = N._st = { permissao: null, agendadas: [], ligado: false };

  function textos() {
    return {
      diario: { title: Tx('SOTERRA — prêmio diário'), body: Tx('O prêmio de hoje está esperando. Entre e resgate!') },
      eco: { title: Tx('SOTERRA — o Eco Primordial'), body: Tx('A semana do Eco Primordial abriu: a Câmara espera a sua dupla.') },
      saudade: { title: Tx('SOTERRA — o mundo enterrado'), body: Tx('Faz três dias que você não desce. O Calabouço do Dia mudou, e o prêmio diário segue na ordem.') }
    };
  }
  /* as três marcações (puras: a prova as lê) — `agora` em ms */
  N.marcacoes = function (agora) {
    var t = textos();
    var em = new Date((agora || Date.now()) + DIAS_SAUDADE * 86400000);
    em.setHours(19, 0, 0, 0);
    return [
      { id: ID.diario, title: t.diario.title, body: t.diario.body, schedule: { on: { hour: HORA_DIARIO, minute: 0 }, repeats: true, allowWhileIdle: true } },
      { id: ID.eco, title: t.eco.title, body: t.eco.body, schedule: { on: { weekday: 2, hour: HORA_ECO, minute: 0 }, repeats: true, allowWhileIdle: true } },
      { id: ID.saudade, title: t.saudade.title, body: t.saudade.body, schedule: { at: em, allowWhileIdle: true } }
    ];
  };

  function cancelaTudo(pl) {
    return Promise.resolve(pl.cancel({ notifications: [{ id: ID.diario }, { id: ID.eco }, { id: ID.saudade }] })).then(function () {}, function () {});
  }
  /* pede a permissão (uma vez) e marca os três avisos; sem permissão, nada. Devolve o que marcou. */
  N.agenda = function () {
    if (!nativo() || !N.ativas()) return Promise.resolve([]);
    return ponte().then(function (tem) {
      var pl = tem ? plugin() : null;
      if (!pl) return [];
      return Promise.resolve(pl.checkPermissions()).then(function (p) {
        var d = p && p.display;
        if (d === 'granted') return 'granted';
        if (d === 'denied') return 'denied';
        return Promise.resolve(pl.requestPermissions()).then(function (q) { return (q && q.display) || 'denied'; });
      }).then(function (d) {
        st.permissao = d;
        if (d !== 'granted') return [];
        var lista = N.marcacoes(Date.now());
        return cancelaTudo(pl).then(function () { return pl.schedule({ notifications: lista }); }).then(function () {
          st.agendadas = lista.map(function (n) { return n.id; });
          return lista;
        });
      });
    }).catch(function () { return []; });
  };
  /* liga ou desliga (Configurações): desligar cancela o que está marcado */
  N.define = function (ligado) {
    try { localStorage.setItem(CHAVE, ligado ? '1' : '0'); } catch (e) {}
    if (ligado) return N.agenda();
    st.agendadas = [];
    if (!nativo()) return Promise.resolve([]);
    return ponte().then(function (tem) { var pl = tem ? plugin() : null; return pl ? cancelaTudo(pl) : null; }).then(function () { return []; });
  };
  /* ao abrir o jogo no aplicativo: marca (ou remarca — o aviso de saudade anda 3 dias para a frente) */
  N.liga = function () {
    if (st.ligado) return Promise.resolve([]);
    st.ligado = true;
    return N.agenda();
  };
  if (nativo()) {
    try { window.addEventListener('load', function () { setTimeout(function () { N.liga(); }, 4000); }); } catch (e) {}
  }
})();
