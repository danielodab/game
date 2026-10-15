/* SOTERRA — A PALETA DOS ELEMENTOS, com o modo para daltônicos (15/10).
 *
 * Os quatro elementos são lidos pela COR em todo lugar: a tinta do feitiço no tabuleiro, o filme,
 * o ícone, a luz. Para quem não separa vermelho de verde (o daltonismo mais comum, ~8% dos homens),
 * o laranja do fogo e o verde da terra viram a mesma coisa; o ciano da água e o lilás do ar também
 * se aproximam. O "modo daltônico" das Configurações troca a paleta inteira por uma de cores que
 * essas pessoas separam (a de Okabe–Ito: vermelhão, azul, amarelo, púrpura), e o jogo inteiro a lê
 * daqui — o renderer, o FX, o Art e o DATA.elementInfo pedem `JOGO.PALETA.elementos()` ao carregar.
 *
 * Vale ao RECARREGAR, como a qualidade gráfica: metade dos materiais já teria a cor de antes.
 * A escolha mora em localStorage 'soterra-pref-ui'.daltonico (a mesma ficha do "menos movimento").
 * Este arquivo carrega ANTES dos dados e dos renderizadores (a ordem do index.html); quem carrega
 * sem ele (as provas antigas) cai na paleta de sempre, escrita no próprio módulo. */
(function (raiz) {
  'use strict';
  var JOGO = raiz.JOGO = raiz.JOGO || {};
  var P = JOGO.PALETA = JOGO.PALETA || {};

  P.NORMAL = {
    neutro: { c: '#d8dee4', deep: '#8b93a0', glow: '#f4f8ff' },
    fogo:   { c: '#ff8c3a', deep: '#c3341a', glow: '#ffd98a' },
    agua:   { c: '#57c8ec', deep: '#1f6bb0', glow: '#b9f2ff' },
    terra:  { c: '#9bd06a', deep: '#5c7a2a', glow: '#e2f0a8' },
    ar:     { c: '#c8b6ff', deep: '#7a63c8', glow: '#f0eaff' }
  };
  /* Okabe–Ito: cada par continua separável para protanopia, deuteranopia e tritanopia */
  P.DALTONICO = {
    neutro: { c: '#d8dee4', deep: '#8b93a0', glow: '#f4f8ff' },
    fogo:   { c: '#e5601c', deep: '#9c3a0a', glow: '#ffb27a' },   // vermelhão
    agua:   { c: '#3a8fd8', deep: '#0b4f8a', glow: '#a9d4ff' },   // azul
    terra:  { c: '#f2d94a', deep: '#9a8a12', glow: '#fff3a8' },   // amarelo
    ar:     { c: '#d088c4', deep: '#8a4a85', glow: '#f3d6ee' }    // púrpura
  };

  P.CHAVE_PREF = 'soterra-pref-ui';
  P.ligado = function () {
    try {
      if (/[?&]daltonico=1/.test(String(raiz.location && raiz.location.search || ''))) return true;
      var p = JSON.parse(raiz.localStorage.getItem(P.CHAVE_PREF) || '{}') || {};
      return !!p.daltonico;
    } catch (e) { return false; }
  };
  var escolhida = null;
  P.tabela = function () {
    if (!escolhida) escolhida = P.ligado() ? P.DALTONICO : P.NORMAL;   // fixo até recarregar
    return escolhida;
  };
  /* { neutro: '#…', fogo: '#…', … } — o que o renderer, o FX e o DATA pedem */
  P.elementos = function () {
    var t = P.tabela(), out = {};
    for (var k in t) if (t.hasOwnProperty(k)) out[k] = t[k].c;
    return out;
  };
  /* a tabela do Art (c, deep, glow) por elemento */
  P.arte = function () {
    var t = P.tabela(), out = {};
    for (var k in t) if (t.hasOwnProperty(k)) out[k] = { c: t[k].c, deep: t[k].deep, glow: t[k].glow };
    return out;
  };
  P.cor = function (el) { var t = P.tabela(); return (t[el] || t.neutro).c; };
})(typeof window !== 'undefined' ? window : globalThis);
