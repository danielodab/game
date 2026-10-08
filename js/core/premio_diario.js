// O prêmio diário de resgate — o cliente de servidor/premio_diario.py (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É (08/10)
 * ====================
 * O dono: "prêmios diários de resgate para quem entra todos os dias: vinténs, 10 dias seguidos
 * barra de ouro". Um resgate por dia de Brasília, à vontade do jogador, com a SEQUÊNCIA de dias
 * seguidos (pulou um, volta ao dia 1) num ciclo de 30 dias. Quem decide tudo é o SERVIDOR: este
 * módulo só LÊ (GET /api/diario) e RESGATA (POST /api/diario/resgatar) — o prêmio entra pela fila
 * da loja, na hora, e o jogo o adota pelo caminho das entregas ('soterra:entregas').
 *
 * Sem sessão do site (em casa, file://) não há prêmio diário: `ler()` resolve null. */
(function () {
  'use strict';
  function Tx(s, v) {
    var I = (typeof JOGO !== 'undefined' && JOGO) ? JOGO.I18n : null;
    if (I && I.t) return I.t(s, v);
    if (!v) return s;
    return String(s).replace(/\{([A-Za-z_]\w*)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m;
    });
  }

  var D = {};
  JOGO.Diario = D;

  var cache = null, lidaEm = 0;
  D.CACHE_MS = 60 * 1000;

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
  function boa(r) { return !!(r && r.ok && r.hoje && Array.isArray(r.calendario)); }

  /* o estado de hoje (do cache, se jovem e o dia não virou; `forca` lê de novo) → Promise<estado|null> */
  D.ler = function (forca) {
    var virou = cache && cache.zeraEm && Date.now() / 1000 >= cache.zeraEm;
    if (!forca && !virou && cache && Date.now() - lidaEm < D.CACHE_MS) return Promise.resolve(cache);
    if (!sessao()) return Promise.resolve(null);
    return api('/api/diario').then(function (r) {
      if (!boa(r)) return cache;
      cache = r; lidaEm = Date.now();
      return cache;
    });
  };
  D.ultima = function () { return cache; };
  D._injeta = function (r) { cache = r || null; lidaEm = Date.now(); };
  /* o prêmio de hoje está esperando? (do cache; null = não se sabe) */
  D.pronto = function () { return cache ? !cache.hoje.resgatado : null; };

  /* resgata o prêmio de hoje → Promise<{ok, erro?, motivo?, resgatou?, premios?}> */
  D.resgatar = function () {
    return api('/api/diario/resgatar', { method: 'POST', body: {} }).then(function (r) {
      if (boa(r)) { cache = r; lidaEm = Date.now(); }
      else if (r && r.motivo === 'ja-resgatado' && cache) { cache.hoje.resgatado = true; }
      if (r && r.ok) {
        try { window.dispatchEvent(new CustomEvent('soterra:entregas', { detail: { n: 1, origem: 'diario' } })); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('soterra:diario', { detail: r })); } catch (e2) {}
      }
      return r;
    });
  };

  /* o texto de um prêmio ({tipo, alvo, qtd}) para a tela */
  D.nomeDoPremio = function (p) {
    if (!p) return '';
    if (p.tipo === 'barras') return Number(p.qtd) === 1 ? Tx('1 barra de ouro') : Tx('{a} barras de ouro', { a: p.qtd });
    if (p.tipo === 'vintens') return Tx('{a} vinténs', { a: p.qtd });
    if (p.tipo === 'pedras') {
      var sd = ((JOGO.DATA || {}).stones || {})[p.alvo];
      return Tx('{a}× {b}', { a: p.qtd, b: (sd && sd.name) || p.alvo });
    }
    return p.tipo;
  };
  D.nomesDoDia = function (dia) {
    return (dia && dia.premios ? dia.premios : []).map(D.nomeDoPremio).join(' + ');
  };
})();
