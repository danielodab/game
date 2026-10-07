// As crônicas do mundo enterrado — o que está aberto e o que acabou de abrir (dono: lógica).
/* 07/10 (o dono: "crônicas curtas, uma por feito da coleção e por chefe derrubado, custam texto e dão
 * motivo para completar"). O dado mora em js/core/data/cronicas.js; aqui mora a leitura dos GANCHOS:
 *   - 'prologo'   aberta sempre;
 *   - 'bestiario' o feito do bestiário daquele portal (Progress.feitos);
 *   - 'chefe'     o chefe no bestiário da conta (Progress.bestiarioConta > 0: ele caiu ao menos uma vez);
 *   - 'fusoes'    o feito das 21 fusões.
 * Nada daqui entra na economia: a conta é a mesma do servidor (os contadores do Progress), e o que a página
 * guarda é só quais crônicas o jogador JÁ ABRIU (localStorage, por aparelho) — para avisar a nova. */
(function () {
  'use strict';
  var JOGO = window.JOGO = window.JOGO || {};
  var C = JOGO.Cronicas = JOGO.Cronicas || {};
  var CHAVE = 'soterra-cronicas-vistas';

  function D() { return JOGO.DATA || {}; }
  function P() { return JOGO.Progress || null; }
  function lista() { return Array.isArray(D().cronicas) ? D().cronicas : []; }
  function vistas() {
    try {
      var v = JSON.parse(localStorage.getItem(CHAVE) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function guardaVistas(v) { try { localStorage.setItem(CHAVE, JSON.stringify(v)); } catch (e) {} }

  /* o gancho está cumprido? */
  function aberta(cr, feitos) {
    var g = cr && cr.gancho;
    if (!g) return false;
    if (g.tipo === 'prologo') return true;
    var P0 = P();
    if (!P0) return false;
    if (g.tipo === 'chefe') {
      try { return (P0.bestiarioConta ? P0.bestiarioConta(g.chefe) : 0) > 0; } catch (e) { return false; }
    }
    var fs = feitos || [];
    for (var i = 0; i < fs.length; i++) {
      var f = fs[i];
      if (g.tipo === 'bestiario' && f.tipo === 'bestiario' && f.calabouco === g.calabouco) return !!f.feito;
      if (g.tipo === 'fusoes' && f.tipo === 'fusoes') return !!f.feito;
    }
    return false;
  }
  /* o que falta para abrir, em palavras (a Coleção mostra nas fechadas) */
  function como(cr) {
    var g = cr.gancho || {}, ms = D().monsters || {};
    if (g.tipo === 'bestiario') {
      var nome = g.calabouco;
      (D().dungeons || []).forEach(function (d) { if (d && d.id === g.calabouco) nome = d.name || nome; });
      return { tipo: 'bestiario', nome: nome };
    }
    if (g.tipo === 'chefe') return { tipo: 'chefe', nome: (ms[g.chefe] && ms[g.chefe].name) || g.chefe };
    if (g.tipo === 'fusoes') return { tipo: 'fusoes' };
    return null;
  }

  /* todas, na ordem do dado: { id, titulo, texto, aberta, nova, como, gancho } */
  C.lista = function () {
    var fs = [];
    try { fs = (P() && P().feitos) ? P().feitos() : []; } catch (e) { fs = []; }
    var vs = vistas();
    return lista().map(function (cr) {
      var ab = aberta(cr, fs);
      return { id: cr.id, titulo: cr.titulo, texto: cr.texto, gancho: cr.gancho, aberta: ab,
               nova: ab && cr.gancho.tipo !== 'prologo' && vs.indexOf(cr.id) < 0, como: como(cr) };
    });
  };
  C.abertas = function () { return C.lista().filter(function (c) { return c.aberta; }); };
  /* as abertas que o jogador ainda não leu (a recompensa avisa) */
  C.novas = function () { return C.lista().filter(function (c) { return c.nova; }); };
  C.marcaVista = function (id) {
    var v = vistas();
    if (v.indexOf(id) < 0) { v.push(id); guardaVistas(v); }
    return true;
  };
  C.marcaTodasVistas = function () {
    guardaVistas(C.abertas().map(function (c) { return c.id; }));
    return true;
  };
  C.porId = function (id) {
    var l = C.lista();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  };
  C._CHAVE = CHAVE;             // provas
})();
