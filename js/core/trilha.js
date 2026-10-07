// A trilha da temporada — o cliente de servidor/trilha.py (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É (07/10)
 * ====================
 * A trilha GRATUITA de recompensas por jogar, presa às temporadas de 42 dias da
 * Brasa (js/core/brasa.js). Os pontos nascem no SERVIDOR, onde ele já confere o
 * que aconteceu (a sala vencida, o duelo ranqueado, a tentativa do Eco, a missão
 * reivindicada): este módulo só LÊ (GET /api/trilha) e RESGATA um degrau
 * (POST /api/trilha/resgatar) — o prêmio entra pela fila da loja, na hora, e o
 * jogo o adota pelo mesmo caminho das entregas ('soterra:entregas').
 *
 * Sem sessão do site (em casa, file://) não há trilha: `ler()` resolve null e a
 * ficha das Missões não mostra o bloco. */
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

  var T = {};
  JOGO.Trilha = T;

  var cache = null;       // a última resposta boa
  var lidaEm = 0;
  T.CACHE_MS = 30 * 1000;

  function sessao() {
    var S = JOGO.Sessao;
    try { return (S && S.ativa && S.ativa() && S.api) ? S : null; } catch (e) { return null; }
  }
  function api(rota, op) {
    var S = sessao();
    if (!S) return Promise.resolve({ ok: false, status: 0, erro: Tx('sem sessão') });
    var p;
    try { p = S.api(rota, op); } catch (e) { p = null; }
    return Promise.resolve(p).then(function (r) { return r || { ok: false, status: 0 }; });
  }

  /* a trilha de agora (do cache, se jovem; `forca` lê de novo) → Promise<trilha|null> */
  T.ler = function (forca) {
    if (!forca && cache && Date.now() - lidaEm < T.CACHE_MS) return Promise.resolve(cache);
    if (!sessao()) return Promise.resolve(null);
    return api('/api/trilha').then(function (r) {
      if (!r || !r.ok || !Array.isArray(r.degraus)) return cache;
      cache = r; lidaEm = Date.now();
      return cache;
    });
  };
  T.ultima = function () { return cache; };
  /* provas e fotos: uma resposta do servidor posta à mão (o `ler` passa a devolvê-la enquanto for jovem) */
  T._injeta = function (r) { cache = r || null; lidaEm = Date.now(); };

  /* o pontos ganhos numa sala (a resposta do fechar traz `trilha`): a HUD avisa e o cache anda */
  T.anota = function (t) {
    if (!t || typeof t !== 'object' || typeof t.pontos !== 'number') return;
    if (cache && cache.temporada === t.temporada) {
      cache.pontos = t.pontos;
      cache.degraus.forEach(function (d) { d.alcancado = cache.pontos >= d.pontos; });
    }
    try { window.dispatchEvent(new CustomEvent('soterra:trilha', { detail: t })); } catch (e) {}
  };

  /* resgata o degrau n → Promise<{ok, erro?, trilha?}>; a entrega vem pela fila da loja */
  T.resgatar = function (n) {
    return api('/api/trilha/resgatar', { method: 'POST', body: { degrau: n } }).then(function (r) {
      if (r && r.ok && Array.isArray(r.degraus)) { cache = r; lidaEm = Date.now(); }
      if (r && r.ok) {
        // o prêmio já entrou no estado do servidor: o jogo o adota pelo caminho das entregas
        try { window.dispatchEvent(new CustomEvent('soterra:entregas', { detail: { n: 1, origem: 'trilha' } })); } catch (e) {}
      }
      return r;
    });
  };

  /* o texto de um prêmio da fila ({tipo, alvo, qtd}) para a tela */
  T.nomeDoPremio = function (p) {
    if (!p) return '';
    var D = JOGO.DATA || {};
    if (p.tipo === 'vintens') return Tx('{a} vinténs', { a: p.qtd });
    if (p.tipo === 'pedras') {
      var sd = (D.stones || {})[p.alvo];
      return Tx('{a}× {b}', { a: p.qtd, b: (sd && sd.name) || p.alvo });
    }
    if (p.tipo === 'pergaminho') return p.alvo === 'elemento' ? Tx('Pergaminho da Reescrita') : Tx('Pergaminho da Sabedoria');
    if (p.tipo === 'insignias') return Tx('{a}× Insígnia de Fundação', { a: p.qtd });
    return p.tipo;
  };
})();
