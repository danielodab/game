/* SOTERRA — O CONVITE (15/10): o link que chama um amigo; os dois ganham vinténs na primeira vitória dele.
 *
 * O servidor (servidor/convites.py) dá a cada conta um código e o link do cadastro do site com ele.
 * Aqui: ler (uma vez por sessão), copiar, mandar (navigator.share com o texto e o link; sem ele, a área
 * de transferência) e o texto da ficha. Sem sessão do site (em casa, sem servidor) não há convite. */
(function (raiz) {
  'use strict';
  var JOGO = raiz.JOGO = raiz.JOGO || {};
  var V = JOGO.Convite = JOGO.Convite || {};

  var dados = null, pedindo = null;
  function Tx(s, v) {
    var I = JOGO.I18n;
    if (I && typeof I.tx === 'function') return I.tx(s, v);
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return v && Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m; });
  }
  V.disponivel = function () {
    var S = JOGO.Sessao;
    try { return !!(S && S.ativa && S.ativa() && S.api); } catch (e) { return false; }
  };
  /* Promise de {codigo, link, convidados, pagos, premio, premioConvidado, limiteDia} ou null */
  V.carrega = function (deNovo) {
    if (dados && !deNovo) return Promise.resolve(dados);
    if (pedindo && !deNovo) return pedindo;
    if (!V.disponivel()) return Promise.resolve(null);
    pedindo = JOGO.Sessao.api('/api/convite').then(function (r) {
      pedindo = null;
      if (r && r.ok && typeof r.codigo === 'string') { dados = r; return r; }
      return null;
    }, function () { pedindo = null; return null; });
    return pedindo;
  };
  V.dados = function () { return dados; };
  V.link = function () { return dados ? dados.link : null; };
  V.texto = function () {
    if (!dados) return '';
    return Tx('Vem jogar SOTERRA comigo: um tático de calabouço em que você junta dois heróis e vira outra coisa. Entra por este link e nós dois ganhamos {n} vinténs na sua primeira vitória: {link}',
              { n: dados.premioConvidado || dados.premio || 500, link: dados.link });
  };
  function copia(txt) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt).then(function () { return true; }, function () { return false; }); }
    catch (e) {}
    return Promise.resolve(false);
  }
  V.copia = function () { return copia(V.texto()); };
  /* Promise<'share'|'copiou'|'nada'> */
  V.manda = function () {
    var txt = V.texto();
    if (!txt) return Promise.resolve('nada');
    try {
      if (navigator.share) {
        return navigator.share({ title: 'SOTERRA', text: txt }).then(function () {
          try { JOGO.EventosUso.anota('convite_mandado'); } catch (e) {}
          return 'share';
        }, function () { return copia(txt).then(function (ok) { return ok ? 'copiou' : 'nada'; }); });
      }
    } catch (e) {}
    return copia(txt).then(function (ok) { if (ok) { try { JOGO.EventosUso.anota('convite_copiado'); } catch (e) {} } return ok ? 'copiou' : 'nada'; });
  };
})(typeof window !== 'undefined' ? window : globalThis);
