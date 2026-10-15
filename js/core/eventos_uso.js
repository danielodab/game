/* SOTERRA — O REGISTRO DE EVENTOS DE USO (15/10): o funil, sem nome e sem rastro.
 *
 * O dono, olhando o jogo contra o mercado: "pode implantar todas as melhorias". A primeira da lista
 * era enxergar o funil — o servidor registrava erros (js/core/registro_erros.js) e o cadastro/login
 * (a tabela `eventos`, por conta), mas ninguém sabia quantos chegavam à primeira luta, quantos
 * venciam, quantos voltavam no dia seguinte. Aqui vai o mínimo que responde isso:
 *
 *   boot                 a aba abriu (uma vez por sessão da aba)
 *   retorno_1d … _30d    quantos dias desde o boot anterior NESTE aparelho (em faixas: 1, 2–3, 4–7,
 *                        8–30, 30+) — é a retenção, medida sem conta
 *   tela:<nome>          a PRIMEIRA vez que a sessão chega a cada tela (heroSelect, hub, antessala,
 *                        battle, roomClear, defeat…): é o funil, lido do UI.showScreen, sem mexer no jogo
 *   o que mais alguém anotar com JOGO.EventosUso.anota('nome')
 *
 * O que NÃO vai: conta, nome, e-mail, endereço, identificador do aparelho. O servidor
 * (servidor/eventos_uso.py) só SOMA por dia × nome × versão × plataforma — não há linha por
 * jogador, então não há dado pessoal e nada para apagar junto com a conta. O token da sessão vai no
 * pedido só para o freio por conta (o mesmo do registro de erros); o servidor não o grava.
 *
 * O mesmo desenho do registro de erros: um coletor puro (`cria(amb)`) que as provas testam sem
 * janela (tests/eventos_uso.js), e o `liga(win)` que o pendura na página. Em file:// e em casa sem
 * ?api= não manda nada. Um 404 ou 429 desliga a aba até recarregar. */
(function (raiz) {
  'use strict';
  var JOGO = raiz.JOGO = raiz.JOGO || {};
  var U = JOGO.EventosUso = JOGO.EventosUso || {};

  U.ROTA = '/api/registro/eventos';
  U.LOTE_MAX = 30;               // eventos distintos num pedido (o LOTE_MAX do servidor)
  U.MAX_ENVIOS = 40;             // pedidos por sessão da aba
  U.ESPERA_MS = 5000;            // junta o que chegar nesse tempo num pedido só
  U.POR_SESSAO = 300;            // anotações aceitas por sessão da aba (o resto cai)
  U.NOME = /^[a-z0-9_:.-]{1,40}$/i;
  U.CHAVE_ULTIMO_BOOT = 'soterra-ultimo-boot';

  function texto(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

  /* a faixa do retorno: dias inteiros desde o boot anterior → nome do evento (null = mesmo dia ou sem anterior) */
  U.faixaRetorno = function (diasDesde) {
    if (!(diasDesde >= 1)) return null;
    if (diasDesde < 2) return 'retorno_1d';
    if (diasDesde < 4) return 'retorno_2_3d';
    if (diasDesde < 8) return 'retorno_4_7d';
    if (diasDesde < 31) return 'retorno_8_30d';
    return 'retorno_30d';
  };

  /* "app" (o aplicativo de Android), "celular" (navegador num telefone) ou "pc" */
  U.plataforma = function (win) {
    try {
      var C = win.Capacitor;
      if (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()) return 'app';
      var M = (win.JOGO || {}).Mobile;
      if (M && typeof M.telefone === 'function' && M.telefone()) return 'celular';
      if (/Android|iPhone|iPad|Mobile/i.test(texto(win.navigator && win.navigator.userAgent))) return 'celular';
    } catch (e) {}
    return 'pc';
  };

  /* O coletor, sem janela: amb = {agora(), agenda(fn, ms), envia(corpo) → Promise de {status, ok},
   * contexto() → {versao, plataforma, tela}}. */
  U.cria = function (amb) {
    var pendentes = {}, ordem = [], envios = 0, aceitas = 0, descartadas = 0, desligado = false, agendado = false;
    function agenda() {
      if (agendado || desligado) return;
      agendado = true;
      amb.agenda(function () { agendado = false; descarrega(); }, U.ESPERA_MS);
    }
    function anota(nome, n) {
      try {
        if (desligado) return false;
        nome = texto(nome);
        if (!U.NOME.test(nome)) { descartadas++; return false; }
        if (aceitas >= U.POR_SESSAO) { descartadas++; return false; }
        n = (typeof n === 'number' && n >= 1) ? Math.min(50, Math.floor(n)) : 1;
        if (!pendentes[nome]) { pendentes[nome] = 0; ordem.push(nome); }
        pendentes[nome] += n;
        aceitas++;
        agenda();
        return true;
      } catch (e) { return false; }       // o registro nunca vira um erro
    }
    function descarrega() {
      if (desligado || !ordem.length) return Promise.resolve(null);
      if (envios >= U.MAX_ENVIOS) { desligado = true; return Promise.resolve(null); }
      var lote = ordem.splice(0, U.LOTE_MAX).map(function (k) {
        var n = pendentes[k]; delete pendentes[k];
        return { nome: k, n: Math.min(50, n) };
      });
      if (ordem.length) agenda();
      envios++;
      var ctx = {};
      try { ctx = amb.contexto() || {}; } catch (e) {}
      var corpo = { eventos: lote, versao: texto(ctx.versao).slice(0, 40), plataforma: texto(ctx.plataforma).slice(0, 12),
                    tela: texto(ctx.tela).slice(0, 40) };
      var p;
      try { p = amb.envia(corpo); } catch (e) { p = null; }
      return Promise.resolve(p).then(function (r) {
        if (r && (r.status === 429 || r.status === 404)) desligado = true;
        return r;
      }, function () { return null; });
    }
    return {
      anota: anota,
      descarrega: descarrega,
      estado: function () {
        return { pendentes: ordem.length, envios: envios, aceitas: aceitas, descartadas: descartadas, desligado: desligado };
      }
    };
  };

  /* Liga o coletor numa janela de verdade. Em file://, nada: devolve null. */
  U.liga = function (win) {
    if (!win || !win.location || win.location.protocol === 'file:' || typeof win.addEventListener !== 'function') return null;
    var J = win.JOGO || JOGO;
    function semApi() {
      var S = J.Sessao;
      if (!S || typeof S.api !== 'function') return true;
      try { return S.ehLocal(win.location.protocol, win.location.hostname) && !S.base(); } catch (e) { return true; }
    }
    var plataforma = U.plataforma(win);
    var coletor = U.cria({
      agora: function () { return Date.now(); },
      agenda: function (fn, ms) { win.setTimeout(fn, ms); },
      envia: function (corpo) {
        if (semApi()) return Promise.resolve({ ok: false, status: 0 });
        return J.Sessao.api(U.ROTA, { method: 'POST', body: corpo, keepalive: true });
      },
      contexto: function () {
        var V = win.SOTERRA_VERSAO, tela = '';
        try {
          tela = (J.UI && typeof J.UI.telaAtual === 'function' && J.UI.telaAtual()) || (J.Game && J.Game.screen) || '';
        } catch (e) { tela = ''; }
        return { versao: (V && V.versao) || 'dev', plataforma: plataforma, tela: tela };
      }
    });
    // o boot e o retorno (os dias desde o boot anterior neste aparelho — sem conta)
    coletor.anota('boot');
    try {
      var antes = parseInt(win.localStorage.getItem(U.CHAVE_ULTIMO_BOOT) || '0', 10);
      if (antes > 0) {
        var faixa = U.faixaRetorno((Date.now() - antes) / 86400000);
        if (faixa) coletor.anota(faixa);
      }
      win.localStorage.setItem(U.CHAVE_ULTIMO_BOOT, String(Date.now()));
    } catch (e) {}
    // o funil pelas telas: a PRIMEIRA chegada da sessão a cada tela. O UI.showScreen nasce depois
    // deste arquivo (a ordem do index.html), então o embrulho espera por ele
    var vistas = {}, tentativas = 0;
    function embrulha() {
      var UI = J.UI;
      if (!UI || typeof UI.showScreen !== 'function') {
        if (++tentativas < 60) win.setTimeout(embrulha, 500);
        return;
      }
      if (UI.showScreen.__eventosUso) return;
      var original = UI.showScreen;
      var novo = function (nome) {
        try { if (nome && !vistas[nome]) { vistas[nome] = true; coletor.anota('tela:' + texto(nome).slice(0, 30)); } } catch (e) {}
        return original.apply(this, arguments);
      };
      novo.__eventosUso = true;
      UI.showScreen = novo;
    }
    embrulha();
    win.addEventListener('pagehide', function () { coletor.descarrega(); });
    return coletor;
  };

  /* JOGO.EventosUso.anota('nome') de qualquer lugar do jogo (sem coletor, não faz nada) */
  U.anota = function (nome, n) { return !!(U.coletor && U.coletor.anota(nome, n)); };

  if (typeof window !== 'undefined' && raiz === window && !U.coletor) U.coletor = U.liga(window);
})(typeof window !== 'undefined' ? window : globalThis);
