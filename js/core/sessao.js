/* sessao.js — quem está logado no cartório (a API de contas, servidor/api.py).
 *
 * A SESSÃO mora em localStorage 'soterra-sessao' = {token, conta:{id, nome, gm}}
 * — a MESMA chave que o site (site/site.js) grava ao entrar. Site e jogo
 * vivem na mesma origem no VPS (o Caddy serve os dois), então logar no site
 * já deixa o jogo logado; em file:// a chave também é uma só por navegador.
 *
 *   Sessao.ativa()             há token?
 *   Sessao.conta()/contaId()   {id, nome, gm} / o id no cartório (ou null)
 *   Sessao.base()              onde mora a API: '' (mesma origem, /api/* pelo
 *                              Caddy), a de `?api=` (lembrada), ou a de casa
 *                              (http://127.0.0.1:8300) quando aberto do disco
 *   Sessao.api(rota, op)       fetch JSON com o token; resolve SEMPRE com
 *                              {status, ok, ...} — rede fora vira status 0
 *   Sessao.entrar(login, senha) / cadastrar(nome, email, senha) / sair()
 *   Sessao.paginaConta()       o endereço da página de conta do site
 *
 * Só biblioteca do navegador. Sem sessão o jogo é o de sempre (local). */
(function () {
  'use strict';
  var JOGO = window.JOGO = window.JOGO || {};
  var S = JOGO.Sessao = {};
  S.CHAVE = 'soterra-sessao';
  S.CHAVE_API = 'soterra-api-base';

  function armazem() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }
  function leLocal(chave) {
    var s = armazem();
    try { return s ? s.getItem(chave) : null; } catch (e) { return null; }
  }
  function gravaLocal(chave, valor) {
    var s = armazem();
    if (!s) return;
    try { if (valor === null) s.removeItem(chave); else s.setItem(chave, valor); } catch (e) {}
  }

  S.base = function () {
    var m = /[?&]api=([^&]+)/.exec(location.search || '');
    if (m) {
      var pedida = decodeURIComponent(m[1]).replace(/\/+$/, '');
      gravaLocal(S.CHAVE_API, pedida);
      return pedida;
    }
    var lembrada = leLocal(S.CHAVE_API);
    if (lembrada) return lembrada;
    if (location.protocol === 'file:') return 'http://127.0.0.1:8300';
    return '';
  };

  S.ler = function () {
    try {
      var s = JSON.parse(leLocal(S.CHAVE) || 'null');
      return (s && typeof s.token === 'string' && s.token && s.conta && typeof s.conta === 'object') ? s : null;
    } catch (e) { return null; }
  };
  S.ativa = function () { return !!S.ler(); };
  S.token = function () { var s = S.ler(); return s ? s.token : null; };
  S.conta = function () { var s = S.ler(); return s ? s.conta : null; };
  S.contaId = function () {
    var c = S.conta();
    return (c && typeof c.id === 'number') ? c.id : null;
  };
  S.guarda = function (s) { gravaLocal(S.CHAVE, JSON.stringify(s)); };
  S.esquece = function () { gravaLocal(S.CHAVE, null); };

  /* Há como falar com o cartório daqui? (`fetch` existe e a origem é http[s]
   * ou há uma API de casa apontada.) */
  S.disponivel = function () {
    return typeof window.fetch === 'function';
  };

  S.api = function (rota, op) {
    op = op || {};
    if (typeof window.fetch !== 'function') {
      return Promise.resolve({ ok: false, status: 0, erro: 'este navegador não tem fetch' });
    }
    var cab = { 'Content-Type': 'application/json' };
    var s = S.ler();
    if (s && op.semToken !== true) cab.Authorization = 'Bearer ' + s.token;
    var pedido = { method: op.method || 'GET', headers: cab };
    if (op.body !== undefined) pedido.body = JSON.stringify(op.body);
    if (op.keepalive) pedido.keepalive = true;
    var fetchFn = (typeof S._fetch === 'function') ? S._fetch : window.fetch.bind(window);
    try {
      return fetchFn(S.base() + rota, pedido).then(function (r) {
        return r.json().catch(function () { return { ok: false, erro: 'resposta que não é JSON' }; })
          .then(function (j) { if (!j || typeof j !== 'object') j = { ok: false }; j.status = r.status; return j; });
      }).catch(function () {
        return { ok: false, status: 0, erro: 'o servidor está fora (não respondeu)' };
      });
    } catch (e) {
      return Promise.resolve({ ok: false, status: 0, erro: 'o servidor está fora (não respondeu)' });
    }
  };

  S.entrar = function (login, senha) {
    return S.api('/api/login', { method: 'POST', semToken: true, body: { login: login, senha: senha } })
      .then(function (r) {
        if (r.ok && r.token && r.conta) S.guarda({ token: r.token, conta: r.conta });
        return r;
      });
  };
  S.cadastrar = function (nome, email, senha) {
    return S.api('/api/cadastro', { method: 'POST', semToken: true, body: { nome: nome, email: email, senha: senha } })
      .then(function (r) {
        if (r.ok && r.token && r.conta) S.guarda({ token: r.token, conta: r.conta });
        return r;
      });
  };
  S.sair = function () {
    var s = S.ler();
    var p = s ? S.api('/api/logout', { method: 'POST', body: {} }) : Promise.resolve({ ok: true, status: 0 });
    S.esquece();                       // o local sai mesmo com o servidor fora
    return p;
  };

  /* A página de conta do site, relativa ao jogo (raiz/site/conta.html). */
  S.paginaConta = function () {
    var raiz = String(location.href || '').split('#')[0].split('?')[0].replace(/[^\/\\]*$/, '');
    return raiz + 'site/conta.html';
  };
})();
