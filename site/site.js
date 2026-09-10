/* site.js — o que as páginas públicas do SOTERRA têm em comum.
 *
 *   SITE.base()            onde mora a API: mesma origem em produção
 *                          (/api/* passa pelo Caddy); em file:// ou com
 *                          `?api=http://127.0.0.1:8300` na URL, aponta lá
 *                          (e lembra em localStorage, como o `?rede=` do jogo).
 *   SITE.api(rota, op)     fetch com JSON nos dois sentidos e o token da
 *                          sessão no header Authorization. Resolve SEMPRE com
 *                          {status, ...json}; erro de rede vira {status:0}.
 *   SITE.sessao()          a sessão em localStorage 'soterra-sessao' =
 *                          {token, conta:{id, nome, gm}} — o jogo lê a mesma
 *                          chave para saber quem está logado.
 *   SITE.guarda(s)/sair()  entra e sai.
 *   SITE.cabecalho()       preenche #sessao no topo: "Olá, nome · sair".
 *   SITE.esc(texto)        escapa HTML (nome de jogador e de guilda vêm do
 *                          servidor, e o servidor guarda o que o cliente mandou).
 *
 * Sem framework e sem CDN, no espírito do jogo (globais JOGO.*). */
(function () {
  'use strict';
  var CHAVE_SESSAO = 'soterra-sessao';
  var CHAVE_API = 'soterra-api-base';
  var SITE = window.SITE = {};

  function leLocal(chave) {
    try { return localStorage.getItem(chave); } catch (e) { return null; }
  }
  function gravaLocal(chave, valor) {
    try {
      if (valor === null) localStorage.removeItem(chave); else localStorage.setItem(chave, valor);
    } catch (e) { /* navegador sem storage: a sessão dura a página */ }
  }

  SITE.base = function () {
    var m = /[?&]api=([^&]+)/.exec(location.search);
    if (m) {
      var pedida = decodeURIComponent(m[1]).replace(/\/+$/, '');
      gravaLocal(CHAVE_API, pedida);
      return pedida;
    }
    var lembrada = leLocal(CHAVE_API);
    if (lembrada) return lembrada;
    // aberto do disco (o dono testando o site sem Caddy): a API de casa
    if (location.protocol === 'file:') return 'http://127.0.0.1:8300';
    return '';
  };

  SITE.sessao = function () {
    try {
      var s = JSON.parse(leLocal(CHAVE_SESSAO) || 'null');
      return (s && s.token && s.conta) ? s : null;
    } catch (e) { return null; }
  };
  SITE.guarda = function (s) { gravaLocal(CHAVE_SESSAO, JSON.stringify(s)); };
  SITE.esquece = function () { gravaLocal(CHAVE_SESSAO, null); };

  SITE.api = function (rota, op) {
    op = op || {};
    var cab = { 'Content-Type': 'application/json' };
    var s = SITE.sessao();
    var token = op.token || (s && op.semToken !== true ? s.token : null);
    if (token) cab.Authorization = 'Bearer ' + token;
    var pedido = { method: op.method || 'GET', headers: cab };
    if (op.body !== undefined) pedido.body = JSON.stringify(op.body);
    return fetch(SITE.base() + rota, pedido).then(function (r) {
      return r.json().catch(function () { return { ok: false, erro: 'resposta que não é JSON' }; })
        .then(function (j) { j.status = r.status; return j; });
    }).catch(function () {
      return { ok: false, status: 0, erro: 'o servidor está fora (não respondeu)' };
    });
  };

  SITE.sair = function () {
    var s = SITE.sessao();
    SITE.esquece();                       // primeiro o local: mesmo sem rede a página sai
    SITE.cabecalho();
    // o token vai explícito: a sessão local já foi apagada e o servidor
    // precisa dele para saber QUAL sessão matar
    if (s) SITE.api('/api/logout', { method: 'POST', body: {}, token: s.token });
  };

  SITE.esc = function (t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  SITE.cabecalho = function () {
    var caixa = document.getElementById('sessao');
    if (!caixa) return;
    var s = SITE.sessao();
    if (!s) {
      caixa.innerHTML = '<a href="conta.html#entrar">Entrar</a>';
      return;
    }
    caixa.innerHTML = 'Olá, <b>' + SITE.esc(s.conta.nome) + '</b>' + (s.conta.gm ? ' <span title="Mestre do Fundo">◆</span>' : '') +
      ' · <button type="button" id="bt-sair">sair</button>';
    document.getElementById('bt-sair').addEventListener('click', SITE.sair);
  };

  /* número com ponto de milhar, do jeito brasileiro */
  SITE.num = function (n) {
    n = Math.round(Number(n) || 0);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  };

  document.addEventListener('DOMContentLoaded', SITE.cabecalho);
})();
