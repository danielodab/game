/* registro_erros.js — o que quebra no navegador de quem joga chega ao Mestre (02/10).
 *
 * POR QUÊ: até aqui um erro de JavaScript na máquina de um jogador morria no console
 * dele; o dono só sabia quando alguém reclamava (e "travou" não diz onde). Este
 * arquivo pega window.onerror e unhandledrejection, junta, tira os repetidos, limita
 * e manda em lote para POST /api/registro/erros (servidor/registros.py), que agrupa
 * e mostra no painel do Mestre (site/mestre_erros.js).
 *
 * É O PRIMEIRO da lista de scripts do index.html: o erro que derruba a carga de um
 * arquivo lá de baixo também é pego. Não depende de ninguém para ANOTAR; para MANDAR,
 * usa o JOGO.Sessao (sessao.js: a base da API e o token), lido só na hora de mandar.
 *
 * AS REGRAS (a Política de Privacidade promete o que sai daqui):
 *   - em file:// (o jogo aberto do disco) NÃO FAZ NADA: nem escuta, nem manda;
 *   - servido em casa sem API (localhost sem ?api=), anota mas não manda;
 *   - cada erro DISTINTO (tipo + mensagem + onde) vai uma vez por lote, com `vezes`;
 *     no máximo MAX_DISTINTOS por sessão da aba, MAX_POR_MINUTO ocorrências por
 *     minuto e MAX_ENVIOS pedidos por sessão; um 429 ou um 404 do servidor desliga
 *     o registro até a aba recarregar (um erro em laço não vira um laço de pedidos);
 *   - vai a mensagem (cortada), a pilha (8 quadros, sem o domínio nem a consulta da
 *     URL — ?v=, ?api=), a versão do jogo (js/versao.js), a tela e o navegador
 *     RESUMIDO ("Chrome 120 · Windows"; o User-Agent inteiro identifica demais). A
 *     conta NÃO vai no corpo: o servidor a tira do token, se houver. O servidor ainda
 *     limpa e-mail, IP e token que aparecerem no texto;
 *   - erro de extensão do navegador e o "Script error." sem nada (script de outra
 *     origem) ficam de fora: não são do jogo e não dá para consertar.
 *
 * A parte pura (normaliza, navegador, cria) não conhece window: tests/registro_erros.js
 * a prova em Node, e prova o `liga` com uma janela de mentira. */
(function (raiz) {
  'use strict';
  var JOGO = raiz.JOGO = raiz.JOGO || {};
  var R = JOGO.RegistroErros = JOGO.RegistroErros || {};

  R.ROTA = '/api/registro/erros';
  R.MAX_DISTINTOS = 20;          // erros distintos por sessão da aba
  R.MAX_POR_MINUTO = 10;         // ocorrências aceitas por minuto (o resto só conta em `descartados`)
  R.MAX_ENVIOS = 30;             // pedidos por sessão da aba
  R.LOTE_MAX = 20;               // erros num pedido (o LOTE_MAX do servidor)
  R.ESPERA_MS = 3000;            // junta o que chegar nesse tempo num pedido só
  R.MSG_MAX = 300;
  R.PILHA_LINHAS = 8;
  R.PILHA_MAX = 1500;

  function texto(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

  /* a URL de um quadro da pilha sem o domínio e sem a consulta: a mesma pilha em casa,
   * no ar e em cada deploy (o ?v= muda a cada build e espalharia o mesmo erro) */
  R.limpaUrl = function (s) {
    return texto(s)
      .replace(/\b(https?|file|capacitor):\/\/[^\/\s)]*/g, '')
      .replace(/\?[^\s:)'"]*/g, '');
  };

  /* "Chrome 120 · Windows". Só a família, a versão grande e o sistema. */
  R.navegador = function (ua) {
    ua = texto(ua);
    var nav = '?', m;
    if ((m = /Edg(?:e|A|iOS)?\/(\d+)/.exec(ua))) nav = 'Edge ' + m[1];
    else if ((m = /OPR\/(\d+)/.exec(ua))) nav = 'Opera ' + m[1];
    else if ((m = /SamsungBrowser\/(\d+)/.exec(ua))) nav = 'Samsung ' + m[1];
    else if ((m = /Firefox\/(\d+)/.exec(ua)) || (m = /FxiOS\/(\d+)/.exec(ua))) nav = 'Firefox ' + m[1];
    else if ((m = /CriOS\/(\d+)/.exec(ua)) || (m = /Chrome\/(\d+)/.exec(ua))) nav = 'Chrome ' + m[1];
    else if ((m = /Version\/(\d+)[\d.]* .*Safari\//.exec(ua))) nav = 'Safari ' + m[1];
    var so = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
      : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '?';
    return nav + ' · ' + so;
  };

  /* Um erro bruto ({tipo, mensagem, pilha, arquivo, linha, coluna}) na forma que vai ao
   * servidor, ou null se não é do jogo. */
  R.normaliza = function (b) {
    b = b || {};
    // o "Uncaught " do Chrome não é do erro: sem ele, a mensagem casa com a 1ª linha da pilha
    var mensagem = texto(b.mensagem).replace(/\s+/g, ' ').trim().replace(/^Uncaught\s+/, '').slice(0, R.MSG_MAX);
    var pilhaBruta = texto(b.pilha);
    if (/(chrome|moz|safari(-web)?)-extension:\/\//.test(pilhaBruta + ' ' + texto(b.arquivo))) return null;
    if (!mensagem || (/^Script error\.?$/i.test(mensagem) && !b.arquivo && !pilhaBruta)) return null;
    var linhas = pilhaBruta.split('\n').map(function (l) { return R.limpaUrl(l).trim(); })
      .filter(function (l) { return l && l !== mensagem && l.indexOf(mensagem) !== 0; });
    var pilha = linhas.slice(0, R.PILHA_LINHAS).join('\n').slice(0, R.PILHA_MAX);
    var onde = b.arquivo ? R.limpaUrl(b.arquivo) + (b.linha ? ':' + b.linha + (b.coluna ? ':' + b.coluna : '') : '') : '';
    return { tipo: b.tipo === 'promessa' ? 'promessa' : 'erro', mensagem: mensagem, pilha: pilha, onde: onde.slice(0, 200) };
  };

  function chaveDe(n) {
    return n.tipo + '|' + n.mensagem + '|' + (n.onde || (n.pilha.split('\n')[0] || ''));
  }

  /* O coletor, sem janela: amb = {agora(), agenda(fn, ms), envia(corpo) → Promise de
   * {status, ok}, contexto() → {versao, tela, navegador}}. */
  R.cria = function (amb) {
    var vistos = {}, distintos = 0, pendentes = [], janela = [];
    var envios = 0, descartados = 0, desligado = false, agendado = false;

    function aceitaAgora(t) {
      while (janela.length && janela[0] <= t - 60000) janela.shift();
      if (janela.length >= R.MAX_POR_MINUTO) return false;
      janela.push(t);
      return true;
    }
    function agenda() {
      if (agendado || desligado) return;
      agendado = true;
      amb.agenda(function () { agendado = false; descarrega(); }, R.ESPERA_MS);
    }
    function anota(bruto) {
      try {
        if (desligado) return false;
        var n = R.normaliza(bruto);
        if (!n) return false;
        var k = chaveDe(n);
        var item = vistos[k];
        if (!item && distintos >= R.MAX_DISTINTOS) { descartados++; return false; }
        if (!aceitaAgora(amb.agora())) { descartados++; return false; }
        if (!item) { item = vistos[k] = { n: n, vezes: 0 }; distintos++; }
        if (!item.vezes) pendentes.push(k);
        item.vezes++;
        agenda();
        return true;
      } catch (e) { return false; }       // o registro de erros nunca vira um erro
    }
    function descarrega() {
      if (desligado || !pendentes.length) return Promise.resolve(null);
      if (envios >= R.MAX_ENVIOS) { desligado = true; return Promise.resolve(null); }
      var lote = pendentes.splice(0, R.LOTE_MAX).map(function (k) {
        var it = vistos[k], v = it.vezes;
        it.vezes = 0;
        return { tipo: it.n.tipo, mensagem: it.n.mensagem, pilha: it.n.pilha, onde: it.n.onde, vezes: v };
      });
      if (pendentes.length) agenda();
      envios++;
      var ctx = {};
      try { ctx = amb.contexto() || {}; } catch (e) {}
      var corpo = { erros: lote, versao: texto(ctx.versao).slice(0, 60), tela: texto(ctx.tela).slice(0, 60),
                    navegador: texto(ctx.navegador).slice(0, 60) };
      var p;
      try { p = amb.envia(corpo); } catch (e) { p = null; }
      return Promise.resolve(p).then(function (r) {
        // 429: o servidor pediu calma; 404: o servidor é de antes desta rota. Nos dois, a
        // aba para de mandar até recarregar
        if (r && (r.status === 429 || r.status === 404)) desligado = true;
        return r;
      }, function () { return null; });
    }
    return {
      anota: anota,
      descarrega: descarrega,
      estado: function () {
        return { distintos: distintos, pendentes: pendentes.length, envios: envios, descartados: descartados,
                 desligado: desligado };
      }
    };
  };

  /* Liga o coletor numa janela de verdade (ou de mentira, nas provas). Em file://,
   * nada: devolve null. */
  R.liga = function (win) {
    if (!win || !win.location || win.location.protocol === 'file:' || typeof win.addEventListener !== 'function') return null;
    var J = win.JOGO || JOGO;
    function semApi() {
      var S = J.Sessao;
      if (!S || typeof S.api !== 'function') return true;
      // servido em casa sem ?api= (python -m http.server): não há API do outro lado
      try { return S.ehLocal(win.location.protocol, win.location.hostname) && !S.base(); } catch (e) { return true; }
    }
    var coletor = R.cria({
      agora: function () { return Date.now(); },
      agenda: function (fn, ms) { win.setTimeout(fn, ms); },
      envia: function (corpo) {
        if (semApi()) return Promise.resolve({ ok: false, status: 0 });
        return J.Sessao.api(R.ROTA, { method: 'POST', body: corpo, keepalive: true });
      },
      contexto: function () {
        var V = win.SOTERRA_VERSAO, tela = '';
        try {
          tela = (J.UI && typeof J.UI.telaAtual === 'function' && J.UI.telaAtual()) ||
                 (J.Game && J.Game.screen) || 'abertura';
        } catch (e) { tela = '?'; }
        return { versao: (V && V.versao) || 'dev', tela: tela,
                 navegador: R.navegador(win.navigator && win.navigator.userAgent) };
      }
    });
    win.addEventListener('error', function (ev) {
      // só o erro de script (ErrorEvent): a falha de carga de uma imagem não sobe até aqui
      if (!ev || typeof ev.message !== 'string') return;
      var e = ev.error;
      coletor.anota({ tipo: 'erro', mensagem: ev.message || (e && e.message), pilha: e && e.stack,
                      arquivo: ev.filename, linha: ev.lineno, coluna: ev.colno });
    });
    win.addEventListener('unhandledrejection', function (ev) {
      var m = ev ? ev.reason : null;
      var ehErro = m && typeof m === 'object' && typeof m.message === 'string';
      coletor.anota({ tipo: 'promessa', mensagem: ehErro ? (m.name ? m.name + ': ' : '') + m.message : texto(m).slice(0, R.MSG_MAX),
                      pilha: ehErro ? m.stack : '' });
    });
    // a aba indo embora leva o que estiver na fila (o keepalive deixa o pedido terminar)
    win.addEventListener('pagehide', function () { coletor.descarrega(); });
    return coletor;
  };

  if (typeof window !== 'undefined' && raiz === window && !R.coletor) R.coletor = R.liga(window);
})(typeof window !== 'undefined' ? window : globalThis);
