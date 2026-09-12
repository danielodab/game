/* O BRASÃO DA GUILDA (11/09) — forma, campo, divisão e símbolo.
 *
 * Este arquivo é o DONO do desenho do escudo. Antes o mesmo código vivia
 * copiado em dois lugares (js/ui/hud.js e js/render3d/hub3d.js) e as duas
 * cópias já tinham começado a divergir: a ficha ganhava um símbolo novo e a
 * plaquinha da praça continuava sem ele. Agora há um só desenho, e quem
 * quiser pintar um brasão — a ficha, a praça, o ranking — chama daqui.
 *
 * O CÓDIGO DO BRASÃO é uma string que cabe no campo `emblema` da guilda
 * (o servidor aceita 64 caracteres — ver EMBLEMA_MAX em servidor/guilda.py):
 *
 *     shield | forma | fundo | borda | cor do símbolo | símbolo | divisão | 2ª cor
 *     shield|1|#b40426|#1d1a14|#ffffff|sword|0|#1d3f8a
 *
 * As guildas antigas continuam valendo: quem tem só quatro campos
 * (shield|fundo|símbolo|cor) e quem tem um emoji solto passam por
 * `partes` e saem com a forma clássica. Nada de migração no disco.
 *
 * TUDO É VETOR e tudo pega cor: os símbolos são caminhos SVG numa caixa de
 * 100×100 pintados com a cor escolhida — nenhum emoji, que não deixa pintar
 * (só o fallback das guildas velhas ainda desenha um). */
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {}) : (global.JOGO = global.JOGO || {});

(function () {
  'use strict';

  /* ---------------------------------------------------------------- FORMAS
   * Cada forma só abre o CAMINHO (sem pintar): quem desenha usa o mesmo
   * caminho três vezes — para o campo, para recortar a divisão e para o
   * filete da borda. `cx/cy` é onde o símbolo se assenta (o centro óptico da
   * forma, que quase nunca é o centro da caixa) e `esc` é a fatia da largura
   * que a caixa de 100 do símbolo ocupa. */
  var FORMAS = [
    { id: '1', nome: 'Clássico', cx: 0.50, cy: 0.46, esc: 0.52, caminho: function (g, w, h) {
        g.moveTo(w * 0.10, h * 0.08);
        g.lineTo(w * 0.90, h * 0.08);
        g.lineTo(w * 0.90, h * 0.50);
        g.bezierCurveTo(w * 0.90, h * 0.80, w * 0.50, h * 0.95, w * 0.50, h * 0.95);
        g.bezierCurveTo(w * 0.50, h * 0.95, w * 0.10, h * 0.80, w * 0.10, h * 0.50);
      } },
    { id: '2', nome: 'Espanhol', cx: 0.50, cy: 0.44, esc: 0.56, caminho: function (g, w, h) {
        g.moveTo(w * 0.10, h * 0.08);
        g.lineTo(w * 0.90, h * 0.08);
        g.lineTo(w * 0.90, h * 0.58);
        g.arc(w * 0.50, h * 0.58, w * 0.40, 0, Math.PI);
      } },
    { id: '3', nome: 'Redondo', cx: 0.50, cy: 0.50, esc: 0.58, caminho: function (g, w, h) {
        g.arc(w * 0.50, h * 0.50, w * 0.45, 0, Math.PI * 2);
      } },
    { id: '4', nome: 'Ogival', cx: 0.50, cy: 0.44, esc: 0.50, caminho: function (g, w, h) {
        g.moveTo(w * 0.12, h * 0.07);
        g.lineTo(w * 0.88, h * 0.07);
        g.bezierCurveTo(w * 0.88, h * 0.52, w * 0.74, h * 0.82, w * 0.50, h * 0.97);
        g.bezierCurveTo(w * 0.26, h * 0.82, w * 0.12, h * 0.52, w * 0.12, h * 0.07);
      } },
    { id: '5', nome: 'Losango', cx: 0.50, cy: 0.50, esc: 0.42, caminho: function (g, w, h) {
        g.moveTo(w * 0.50, h * 0.04);
        g.lineTo(w * 0.93, h * 0.50);
        g.lineTo(w * 0.50, h * 0.96);
        g.lineTo(w * 0.07, h * 0.50);
      } },
    // a BOCA no canto de cima: o encaixe da lança do torneio, a marca do
    // escudo alemão — é o que faz esta forma não ser mais uma clássica
    { id: '6', nome: 'Alemão', cx: 0.50, cy: 0.52, esc: 0.50, caminho: function (g, w, h) {
        g.moveTo(w * 0.10, h * 0.08);
        g.lineTo(w * 0.56, h * 0.08);
        g.lineTo(w * 0.56, h * 0.18);
        g.lineTo(w * 0.72, h * 0.18);
        g.lineTo(w * 0.72, h * 0.08);
        g.lineTo(w * 0.90, h * 0.08);
        g.bezierCurveTo(w * 0.94, h * 0.55, w * 0.78, h * 0.84, w * 0.50, h * 0.96);
        g.bezierCurveTo(w * 0.22, h * 0.84, w * 0.06, h * 0.55, w * 0.10, h * 0.08);
      } },
    { id: '7', nome: 'Oval', cx: 0.50, cy: 0.50, esc: 0.50, caminho: function (g, w, h) {
        g.ellipse(w * 0.50, h * 0.50, w * 0.39, h * 0.46, 0, 0, Math.PI * 2);
      } },
    { id: '8', nome: 'Flâmula', cx: 0.50, cy: 0.40, esc: 0.52, caminho: function (g, w, h) {
        g.moveTo(w * 0.13, h * 0.06);
        g.lineTo(w * 0.87, h * 0.06);
        g.lineTo(w * 0.87, h * 0.94);
        g.lineTo(w * 0.50, h * 0.72);
        g.lineTo(w * 0.13, h * 0.94);
      } },
    { id: '9', nome: 'Chanfrado', cx: 0.50, cy: 0.50, esc: 0.56, caminho: function (g, w, h) {
        g.moveTo(w * 0.28, h * 0.06);
        g.lineTo(w * 0.72, h * 0.06);
        g.lineTo(w * 0.94, h * 0.28);
        g.lineTo(w * 0.94, h * 0.72);
        g.lineTo(w * 0.72, h * 0.94);
        g.lineTo(w * 0.28, h * 0.94);
        g.lineTo(w * 0.06, h * 0.72);
        g.lineTo(w * 0.06, h * 0.28);
      } }
  ];

  /* -------------------------------------------------------------- DIVISÕES
   * O campo partido: a 2ª cor entra recortada pelo caminho da forma, então
   * cada divisão é só um retângulo (ou um triângulo) pintado por cima. */
  var DIVISOES = [
    { id: '0', nome: 'Liso',       pinta: null },
    { id: '1', nome: 'Partido',    pinta: function (g, w, h) { g.fillRect(w * 0.5, 0, w * 0.5, h); } },
    { id: '2', nome: 'Cortado',    pinta: function (g, w, h) { g.fillRect(0, h * 0.5, w, h * 0.5); } },
    { id: '3', nome: 'Quartelado', pinta: function (g, w, h) {
        g.fillRect(w * 0.5, 0, w * 0.5, h * 0.5);
        g.fillRect(0, h * 0.5, w * 0.5, h * 0.5);
      } },
    { id: '4', nome: 'Enviesado',  pinta: function (g, w, h) {
        g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(0, h); g.closePath(); g.fill();
      } },
    { id: '5', nome: 'Chefe',      pinta: function (g, w, h) { g.fillRect(0, 0, w, h * 0.30); } },
    { id: '6', nome: 'Faixa',      pinta: function (g, w, h) { g.fillRect(0, h * 0.40, w, h * 0.22); } },
    { id: '7', nome: 'Pala',       pinta: function (g, w, h) { g.fillRect(w * 0.39, 0, w * 0.22, h); } },
    // a BORDADURA é o filete grosso por dentro: o traço vale o dobro porque
    // metade dele cai fora do recorte e se perde
    { id: '8', nome: 'Bordadura',  pinta: function (g, w, h, fm) {
        g.beginPath(); fm.caminho(g, w, h); g.closePath();
        g.lineWidth = w * 0.20; g.strokeStyle = g.fillStyle; g.stroke();
      } }
  ];

  /* -------------------------------------------------------------- SÍMBOLOS
   * Caminhos SVG numa caixa de 100×100. `e: 1` pinta com a regra par-ímpar,
   * que é como os buracos aparecem (a fresta do elmo, as órbitas da caveira,
   * o olho da chave) sem depender do sentido em que o traço foi escrito. */
  var SIMBOLOS = [
    { id: 'sword',  nome: 'Espada',    d: 'M45 10 L55 10 L55 70 L65 70 L65 80 L55 80 L55 95 L45 95 L45 80 L35 80 L35 70 L45 70 Z' },
    { id: 'spear',  nome: 'Lança',     d: 'M50 2 L62 26 L55 26 L55 94 L45 94 L45 26 L38 26 Z' },
    { id: 'axe',    nome: 'Machado',   d: 'M47 6 L53 6 L53 96 L47 96 Z M53 20 L74 20 C86 24 90 32 90 40 C86 52 74 60 53 62 Z M47 20 L26 20 C14 24 10 32 10 40 C14 52 26 60 47 62 Z' },
    { id: 'hammer', nome: 'Martelo',   d: 'M22 12 L78 12 L86 26 L78 40 L22 40 L14 26 Z M44 40 L56 40 L56 94 L44 94 Z' },
    { id: 'anvil',  nome: 'Bigorna',   d: 'M18 30 L70 30 C82 32 88 36 92 42 L70 46 L58 46 L62 72 L76 80 L76 90 L24 90 L24 80 L38 72 L42 46 L18 46 Z' },
    { id: 'crown',  nome: 'Coroa',     d: 'M15 80 L85 80 L95 30 L70 50 L50 15 L30 50 L5 30 Z' },
    { id: 'cross',  nome: 'Cruz',      d: 'M35 15 L65 15 L65 35 L85 35 L85 65 L65 65 L65 95 L35 95 L35 65 L15 65 L15 35 L35 35 Z' },
    { id: 'star',   nome: 'Estrela',   d: 'M50 10 L61 39 L92 39 L66 57 L76 88 L50 69 L24 88 L34 57 L8 39 L39 39 Z' },
    { id: 'sun',    nome: 'Sol',       d: 'M26 50 A24 24 0 1 1 74 50 A24 24 0 1 1 26 50 Z M44 22 L56 22 L50 2 Z M44 78 L56 78 L50 98 Z M22 44 L22 56 L2 50 Z M78 44 L78 56 L98 50 Z M66 28 L72 34 L86 14 Z M34 28 L28 34 L14 14 Z M66 72 L72 66 L86 86 Z M34 72 L28 66 L14 86 Z', e: 1 },
    { id: 'moon',   nome: 'Lua',       d: 'M72.5 11 A45 45 0 1 0 72.5 89 A39 39 0 0 1 72.5 11 Z' },
    { id: 'bolt',   nome: 'Raio',      d: 'M58 4 L24 54 L46 54 L36 96 L78 42 L54 42 Z' },
    { id: 'flame',  nome: 'Chama',     d: 'M50 2 C64 22 86 40 86 60 C86 80 70 96 50 96 C30 96 14 80 14 60 C14 46 26 36 34 26 C34 42 40 52 46 55 C53 50 55 24 50 2 Z' },
    { id: 'drop',   nome: 'Gota',      d: 'M50 6 C50 6 84 46 84 64 A34 34 0 1 1 16 64 C16 46 50 6 50 6 Z' },
    { id: 'tower',  nome: 'Torre',     d: 'M25 90 L75 90 L75 40 L85 40 L85 20 L75 20 L75 30 L65 30 L65 20 L55 20 L55 30 L45 30 L45 20 L35 20 L35 30 L25 30 L25 20 L15 20 L15 40 L25 40 Z' },
    { id: 'mount',  nome: 'Montanha',  d: 'M4 88 L34 30 L52 60 L64 42 L96 88 Z' },
    { id: 'tree',   nome: 'Árvore',    d: 'M50 6 L72 36 L60 36 L78 62 L62 62 L74 84 L56 84 L56 96 L44 96 L44 84 L26 84 L38 62 L22 62 L40 36 L28 36 Z' },
    { id: 'leaf',   nome: 'Folha',     d: 'M88 8 C88 56 56 90 10 92 C10 44 42 10 88 8 Z' },
    { id: 'lily',   nome: 'Flor-de-lis', d: 'M50 4 C42 18 44 36 46 52 L54 52 C56 36 58 18 50 4 Z M44 52 C44 40 34 28 22 32 C8 37 8 52 22 52 Z M56 52 C56 40 66 28 78 32 C92 37 92 52 78 52 Z M30 52 L70 52 L70 62 L30 62 Z M42 62 L58 62 C58 78 54 88 50 96 C46 88 42 78 42 62 Z', e: 1 },
    { id: 'helm',   nome: 'Elmo',      d: 'M50 6 C72 6 82 22 82 42 L82 78 C82 88 72 94 50 94 C28 94 18 88 18 78 L18 42 C18 22 28 6 50 6 Z M25 38 L75 38 L75 47 L25 47 Z M47 53 L53 53 L53 84 L47 84 Z', e: 1 },
    { id: 'shield', nome: 'Escudo',    d: 'M50 6 L88 18 C88 58 72 84 50 96 C28 84 12 58 12 18 Z' },
    { id: 'skull',  nome: 'Caveira',   d: 'M50 6 C76 6 90 24 90 46 C90 62 82 72 74 77 L74 94 L26 94 L26 77 C18 72 10 62 10 46 C10 24 24 6 50 6 Z M24 44 A11 11 0 1 0 46 44 A11 11 0 1 0 24 44 Z M54 44 A11 11 0 1 0 76 44 A11 11 0 1 0 54 44 Z M44 62 L56 62 L50 74 Z', e: 1 },
    { id: 'claw',   nome: 'Garra',     d: 'M20 8 C36 32 34 64 26 92 C16 66 12 32 20 8 Z M50 4 C66 30 64 64 54 94 C44 64 42 30 50 4 Z M80 8 C88 32 84 66 74 92 C68 62 68 32 80 8 Z' },
    { id: 'wing',   nome: 'Asa',       d: 'M4 26 C30 22 54 32 68 46 C76 54 86 60 96 62 C86 70 72 72 60 68 C66 76 74 82 84 86 C68 90 48 84 34 72 C18 58 8 42 4 26 Z' },
    { id: 'fish',   nome: 'Peixe',     d: 'M6 50 C22 26 46 20 62 28 C74 34 80 44 82 50 C80 56 74 66 62 72 C46 80 22 74 6 50 Z M82 50 L96 32 L96 68 Z M28 42 A5 5 0 1 0 38 42 A5 5 0 1 0 28 42 Z', e: 1 },
    { id: 'eye',    nome: 'Olho',      d: 'M6 50 C28 20 72 20 94 50 C72 80 28 80 6 50 Z M36 50 A14 14 0 1 0 64 50 A14 14 0 1 0 36 50 Z', e: 1 },
    { id: 'heart',  nome: 'Coração',   d: 'M50 92 C14 66 4 48 4 32 C4 16 18 6 32 6 C42 6 49 13 50 21 C51 13 58 6 68 6 C82 6 96 16 96 32 C96 48 86 66 50 92 Z' },
    { id: 'key',    nome: 'Chave',     d: 'M30 24 A20 20 0 1 1 70 24 A20 20 0 1 1 30 24 Z M41 24 A9 9 0 1 1 59 24 A9 9 0 1 1 41 24 Z M45 44 L55 44 L55 94 L45 94 Z M55 62 L72 62 L72 71 L55 71 Z M55 78 L69 78 L69 87 L55 87 Z', e: 1 },
    { id: 'anchor', nome: 'Âncora',    d: 'M40 14 A10 10 0 1 1 60 14 A10 10 0 1 1 40 14 Z M45 14 A5 5 0 1 1 55 14 A5 5 0 1 1 45 14 Z M45 24 L55 24 L55 36 L76 36 L76 46 L55 46 L55 86 L45 86 L45 46 L24 46 L24 36 L45 36 Z M10 56 C10 84 28 96 50 96 C72 96 90 84 90 56 L79 56 C79 76 66 86 50 86 C34 86 21 76 21 56 Z', e: 1 },
    { id: 'cup',    nome: 'Cálice',    d: 'M20 10 L80 10 C80 40 64 54 56 58 L56 80 L76 80 L76 90 L24 90 L24 80 L44 80 L44 58 C36 54 20 40 20 10 Z' },
    { id: 'book',   nome: 'Livro',     d: 'M8 18 C26 10 42 12 50 22 L50 90 C42 80 26 78 8 86 Z M92 18 C74 10 58 12 50 22 L50 90 C58 80 74 78 92 86 Z' },
    { id: 'hourgl', nome: 'Ampulheta', d: 'M18 8 L82 8 L82 20 L58 50 L82 80 L82 92 L18 92 L18 80 L42 50 L18 20 Z' }
  ];

  /* ---------------------------------------------------------------- PALETA
   * As cores que o painel oferece com um toque. São 40: os esmaltes da
   * heráldica (goles, azur, sinopla, púrpura, sable, prata, ouro) e as cores
   * do mundo enterrado — salmoura, brasa, lousa. Quem quiser outra move os
   * três cursores e chega em qualquer uma. */
  var PALETA = [
    '#ffffff', '#d9d2c0', '#9aa0a6', '#5c636a', '#2b2f36', '#1d1a14', '#0b0d10', '#000000',
    '#f5d76e', '#e6b53c', '#c9a227', '#a3781a', '#7a5312', '#5a3a0c', '#3d2708', '#241705',
    '#ff6b5e', '#e04a3c', '#b40426', '#8a0f24', '#5e0a18', '#ff9f68', '#e8742c', '#a34d13',
    '#8fe08a', '#4fae53', '#2d7a3a', '#17532a', '#0c3320', '#7fe0d8', '#3aa8a0', '#1d6f6b',
    '#8ec5ff', '#4a87d6', '#1d3f8a', '#122557', '#c9a7ff', '#8a5fd6', '#5a2f9a', '#c94f6d'
  ];

  var PADRAO = 'shield|1|#b40426|#1d1a14|#ffffff|sword|0|#1d3f8a';

  function acha(lista, id) {
    for (var i = 0; i < lista.length; i++) if (lista[i].id === id) return lista[i];
    return null;
  }
  function forma(id) { return acha(FORMAS, id) || FORMAS[0]; }
  function divisao(id) { return acha(DIVISOES, id) || DIVISOES[0]; }
  function simbolo(id) { return acha(SIMBOLOS, id); }

  function ehCodigo(cod) {
    return typeof cod === 'string' && cod.indexOf('shield|') === 0;
  }

  /* Toda leitura passa por aqui: o brasão de hoje, o de quatro campos e o
   * emoji solto saem os três como uma lista de oito partes. */
  function partes(cod) {
    var p = String(cod == null ? '' : cod).split('|');
    if (p[0] !== 'shield') return PADRAO.split('|');
    if (p.length === 4) p = ['shield', '1', p[1], '#1d1a14', p[2], p[3]];  // o formato de 30/08
    var d = PADRAO.split('|');
    for (var i = 1; i < 8; i++) if (!p[i]) p[i] = d[i];
    return p.slice(0, 8);
  }
  function normaliza(cod) { return ehCodigo(cod) ? partes(cod).join('|') : cod; }

  /* O nome da guilda para uma LINHA DE TEXTO: com brasão, o código não tem o
   * que fazer no meio da frase — quem mostra desenho chama `canvas`. */
  function nomeComEmblema(emblema, nome) {
    if (!emblema || ehCodigo(emblema)) return String(nome == null ? '' : nome);
    return emblema + ' ' + String(nome == null ? '' : nome);
  }

  function desenha(g, x, y, tam, cod) {
    var p = partes(cod);
    var fm = forma(p[1]), w = tam, h = tam;
    var dv = divisao(p[6]);
    g.save();
    g.translate(x, y);

    function caminho() { g.beginPath(); fm.caminho(g, w, h); g.closePath(); }

    caminho();
    g.fillStyle = p[2];
    g.fill();

    if (dv.pinta) {
      g.save();
      caminho(); g.clip();
      g.fillStyle = p[7];
      dv.pinta(g, w, h, fm);
      g.restore();
    }

    caminho();
    g.lineWidth = w * 0.06;
    g.strokeStyle = p[3];
    g.stroke();

    var sb = simbolo(p[5]);
    if (sb) {
      g.save();
      g.translate(w * fm.cx, h * fm.cy);
      g.scale(w * fm.esc / 100, h * fm.esc / 100);
      g.translate(-50, -50);
      g.fillStyle = p[4];
      g.fill(new Path2D(sb.d), sb.e ? 'evenodd' : 'nonzero');
      g.restore();
    } else if (p[5] && p[5] !== '-') {
      // guilda velha: o emoji que o jogador escolheu antes dos vetores
      g.fillStyle = p[4];
      g.font = Math.floor(h * 0.5) + 'px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(p[5], w * 0.5, h * 0.48);
    }
    g.restore();
  }

  /* O brasão como um <canvas> pronto para pendurar na interface. Nítido em
   * tela de celular: o bitmap vai no dobro (ou no que o aparelho pedir) e o
   * CSS o encolhe de volta. */
  function canvas(cod, tam) {
    var cv = document.createElement('canvas');
    var dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    cv.width = Math.round(tam * dpr);
    cv.height = Math.round(tam * dpr);
    cv.style.width = tam + 'px';
    cv.style.height = tam + 'px';
    var g = cv.getContext('2d');
    g.scale(dpr, dpr);
    desenha(g, 0, 0, tam, cod);
    return cv;
  }

  /* Só o SÍMBOLO, sem escudo em volta: serve à grade de escolha e a qualquer
   * lugar que queira o desenho solto. */
  function iconeSimbolo(id, tam, cor) {
    var sb = simbolo(id);
    var cv = document.createElement('canvas');
    var dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    cv.width = Math.round(tam * dpr); cv.height = Math.round(tam * dpr);
    cv.style.width = tam + 'px'; cv.style.height = tam + 'px';
    if (!sb) return cv;
    var g = cv.getContext('2d');
    g.scale(dpr * tam / 100, dpr * tam / 100);
    g.fillStyle = cor || '#ffffff';
    g.fill(new Path2D(sb.d), sb.e ? 'evenodd' : 'nonzero');
    return cv;
  }

  /* ------------------------------------------------------------------ CORES
   * O painel de cor é nosso (o <input type="color"> não abria em todo lugar),
   * então as contas de matiz/saturação/brilho moram aqui. */
  function doisDig(n) {
    var s = Math.max(0, Math.min(255, Math.round(n))).toString(16);
    return s.length < 2 ? '0' + s : s;
  }
  function hslParaHex(hh, ss, ll) {
    hh = ((hh % 360) + 360) % 360;
    ss = Math.max(0, Math.min(1, ss));
    ll = Math.max(0, Math.min(1, ll));
    var c = (1 - Math.abs(2 * ll - 1)) * ss, x = c * (1 - Math.abs((hh / 60) % 2 - 1)), m = ll - c / 2;
    var r = 0, g = 0, b = 0;
    if (hh < 60) { r = c; g = x; } else if (hh < 120) { r = x; g = c; }
    else if (hh < 180) { g = c; b = x; } else if (hh < 240) { g = x; b = c; }
    else if (hh < 300) { r = x; b = c; } else { r = c; b = x; }
    return '#' + doisDig((r + m) * 255) + doisDig((g + m) * 255) + doisDig((b + m) * 255);
  }
  function hexParaHsl(cor) {
    var s = String(cor == null ? '' : cor).replace('#', '');
    if (s.length === 3) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return { h: 0, s: 0, l: 0.5 };
    var r = parseInt(s.slice(0, 2), 16) / 255,
        g = parseInt(s.slice(2, 4), 16) / 255,
        b = parseInt(s.slice(4, 6), 16) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    var l = (mx + mn) / 2, hh = 0, ss = 0;
    if (d) {
      ss = d / (1 - Math.abs(2 * l - 1));
      if (mx === r) hh = 60 * (((g - b) / d) % 6);
      else if (mx === g) hh = 60 * ((b - r) / d + 2);
      else hh = 60 * ((r - g) / d + 4);
    }
    return { h: ((hh % 360) + 360) % 360, s: ss, l: l };
  }

  /* AS CORES DA PLACA (11/09, pedido do dono: "as cores do retângulo — fundo
   * e borda — pegam as cores do logo; só tem que tomar cuidado para guilda
   * com logo todo preto, para aparecer o nome").
   *
   * A placa da praça deixa de ser sempre marrom-dourada e veste o brasão:
   * o FUNDO é o campo do escudo e a BORDA é o filete dele. Mas a placa
   * também tem de deixar LER um nome, e um jogador pode escolher preto no
   * preto — então nada é copiado cru:
   *
   *   FUNDO   mantém matiz e saturação, mas a luminosidade é espremida numa
   *           faixa escura (12% a 24%). Campo branco não vira placa branca,
   *           campo preto não vira buraco: fica um tom escuro do brasão.
   *   BORDA   nunca abaixo de 45% de luz, e nunca perto demais do fundo (se
   *           a diferença cair abaixo de 25 pontos, ela clareia até abrir).
   *           É o que salva o brasão todo preto: a moldura aparece.
   *   TEXTO   claro sobre placa escura, escuro sobre placa clara — decidido
   *           pela luminosidade que a placa REALMENTE ficou, não pela que o
   *           jogador escolheu.
   *
   * Devolve { fundo, borda, texto } — o `fundo` já vem com alfa, que é como
   * a placa sempre foi desenhada. */
  var PLACA_FUNDO_MIN = 0.12, PLACA_FUNDO_MAX = 0.24;
  var PLACA_BORDA_MIN = 0.45, PLACA_DIF_MIN = 0.25;
  function coresDaPlaca(cod) {
    var p = partes(cod);
    var f = hexParaHsl(p[2]), b = hexParaHsl(p[3]);
    var lf = Math.max(PLACA_FUNDO_MIN, Math.min(PLACA_FUNDO_MAX, f.l));
    // campo muito lavado (branco, prata) perde saturação ao escurecer: um
    // pouco de cor a mais devolve a identidade do brasão à placa
    var sf = f.s < 0.12 ? f.s : Math.min(1, f.s * 1.15);
    var lb = Math.max(PLACA_BORDA_MIN, b.l);
    if (lb - lf < PLACA_DIF_MIN) lb = Math.min(0.82, lf + PLACA_DIF_MIN);
    return {
      fundo: 'rgba(' + rgbDe(hslParaHex(f.h, sf, lf)).join(',') + ',0.92)',
      borda: hslParaHex(b.h, b.s, lb),
      texto: lf > 0.45 ? '#1a1409' : '#fff3d6'
    };
  }
  function rgbDe(hex7) {
    var s = String(hex7).replace('#', '');
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  JOGO.Brasao = {
    FORMAS: FORMAS, DIVISOES: DIVISOES, SIMBOLOS: SIMBOLOS, PALETA: PALETA, PADRAO: PADRAO,
    ehCodigo: ehCodigo, partes: partes, normaliza: normaliza, nomeComEmblema: nomeComEmblema,
    forma: forma, divisao: divisao, simbolo: simbolo,
    desenha: desenha, canvas: canvas, iconeSimbolo: iconeSimbolo,
    hslParaHex: hslParaHex, hexParaHsl: hexParaHsl, coresDaPlaca: coresDaPlaca
  };
})();
