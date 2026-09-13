// A economia da conta — o que é do servidor, e o hash que os dois lados comparam (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É (13/09, a segurança — docs/SEGURANCA.md §3)
 * ============
 * Com a autoridade ligada, o servidor é o dono do estado econômico da conta:
 * heróis, saco, peças, pedras, cartas, pets, selos, insígnias, pergaminhos,
 * carteira, cofre, mercado, missões, chefes, Poço, loja e Brasa. O cliente
 * aplica na hora (a tela não espera), mas o que vale é o do servidor.
 *
 * Os dois lados precisam saber, barato, se estão iguais. Este arquivo roda NO
 * JOGO e NO JUIZ (servidor/juiz/, o mesmo arquivo): `Economia.hash` é o FNV-1a
 * de 32 bits do JSON canônico (chaves em ordem) da parte do servidor. Hash
 * diferente depois de uma operação = o cliente adota o estado do servidor.
 *
 * Fora do hash ficam os caches que se derivam sozinhos (hero.spells, a fila de
 * nascimentos, as recusadas da loja) e o que é cosmético (nome, avatar,
 * dupla, coroa escondida, placar, históricos). */
(function () {
  'use strict';

  var Ec = {};
  JOGO.Economia = Ec;

  Ec.DB_SERVIDOR = ['carteira', 'banco', 'mercado', 'missoes', 'conquistas', 'chefes', 'poco'];
  Ec.DB_CLIENTE = ['mutados', 'placar', 'pvp', 'trocas'];
  Ec.JOGADOR_CLIENTE = ['id', 'nome', 'avatar', 'dupla', 'coroaOculta', 'criadoEm'];

  function ehObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  /* JSON com as chaves em ordem; undefined some (como no JSON.stringify) */
  function canon(v) {
    if (v === undefined || typeof v === 'function') return 'null';
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'number' && !isFinite(v)) return 'null';
      return JSON.stringify(v);
    }
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    var ks = Object.keys(v).filter(function (k) { return v[k] !== undefined && typeof v[k] !== 'function'; }).sort();
    return '{' + ks.map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }
  Ec.canon = canon;

  /* A parte do estado que é do servidor, já sem os caches. */
  Ec.parteServidor = function (progress, db) {
    var p = {};
    if (ehObj(progress)) {
      Object.keys(progress).forEach(function (k) {
        if (k === 'nascimentos') return;
        if (k === 'heroes' && ehObj(progress.heroes)) {
          var hs = {};
          Object.keys(progress.heroes).forEach(function (hid) {
            var h = progress.heroes[hid], c = {};
            if (!ehObj(h)) { hs[hid] = h; return; }
            Object.keys(h).forEach(function (hk) { if (hk !== 'spells') c[hk] = h[hk]; });
            hs[hid] = c;
          });
          p.heroes = hs;
          return;
        }
        p[k] = progress[k];
      });
    }
    var d = {};
    if (ehObj(db)) {
      Ec.DB_SERVIDOR.forEach(function (k) { d[k] = (db[k] === undefined) ? null : db[k]; });
      d.lojaAplicadas = (ehObj(db.loja) && Array.isArray(db.loja.aplicadas)) ? db.loja.aplicadas : [];
      var j = ehObj(db.jogador) ? db.jogador : {};
      d.brasa = (j.brasa === undefined) ? null : j.brasa;
      d.titulo = (j.titulo === undefined) ? null : j.titulo;
    }
    return { progress: p, db: d };
  };

  /* FNV-1a 32 bits, em 8 dígitos hexadecimais */
  Ec.fnv = function (txt) {
    var h = 0x811c9dc5;
    for (var i = 0; i < txt.length; i++) {
      h ^= txt.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  };

  Ec.hash = function (progress, db) {
    return Ec.fnv(canon(Ec.parteServidor(progress, db)));
  };

  /* O db que resulta de juntar o do servidor (a economia) com o do cliente
   * (o cosmético). Usado pelo servidor no PUT e pelo cliente ao adotar. */
  Ec.junta = function (dbServidor, dbCliente) {
    var s = ehObj(dbServidor) ? JSON.parse(JSON.stringify(dbServidor)) : {};
    var c = ehObj(dbCliente) ? dbCliente : {};
    Ec.DB_CLIENTE.forEach(function (k) { if (c[k] !== undefined) s[k] = JSON.parse(JSON.stringify(c[k])); });
    if (ehObj(c.jogador)) {
      if (!ehObj(s.jogador)) s.jogador = {};
      Ec.JOGADOR_CLIENTE.forEach(function (k) {
        if (c.jogador[k] !== undefined) s.jogador[k] = JSON.parse(JSON.stringify(c.jogador[k]));
      });
    }
    return s;
  };
})();
