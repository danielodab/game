// SOTERRA — os ícones redondos dos menus (dono: Designer).
//
// 22/09, pedido do dono: todo menu que lista item (inventário, forja, banco,
// banco da guilda, mercado, troca, caixa do GM) perde o TEXTO das abas e dos
// chips de filtro e ganha botão REDONDO com ícone — "dos itens um ícone
// redondo de um capacete, dos potes de vida uma poção, de pedra pedras, de pet
// algum símbolo; os elementos também por ícone".
//
// Este arquivo só DESENHA. `svg(id)` devolve a string <svg> do ícone e quem
// monta o botão (o hud.js) guarda o nome num <span class="rot-oculto"> ao lado
// dele — o leitor de tela e as provas que casam `button.textContent` continuam
// lendo "Pedras", "Fogo", "Preço ↑". Id que não existe devolve '' e quem chamou
// volta ao texto: um ícone que falta nunca deixa um botão mudo.
//
// AS REGRAS DO TRAÇO (o que faz 40 ícones parecerem UM jogo de ícones):
//   · caixa de 24×24 para todos, o desenho entre 2 e 22 — o botão pinta a 22 px,
//     então 1 unidade da caixa é quase 1 pixel e nenhum detalhe fica abaixo de 1,2;
//   · silhueta CHEIA em currentColor (quem pinta é o botão: apagado, dourado ou
//     na cor do elemento/raridade); o detalhe de segundo plano vai a meia tinta
//     (fill-opacity .45) ou vira FURO (evenodd), que mostra o fundo escuro e
//     segura a leitura em qualquer cor;
//   · luz da esquerda: nas facetas (cristais, gema) a da esquerda é cheia e a
//     da direita é meia tinta — o mesmo lado em todos.
//
// O QUE NÃO PODE ENTRAR (o mesmo ícone aparece dezenas de vezes no DOM, e as
// provas leem o texto dos botões): nada de <title> nem <text> — o textContent
// do svg tem de dar '' —, nada de id=, de <defs>, de gradiente ou de href.
// Tudo é caminho literal: roda no file://, sem dependência, e o brasao.js (de
// onde vieram a chama e a gota, redesenhadas nesta caixa) nem precisa estar
// carregado.
//
// AS ÚNICAS CORES ESCRITAS À MÃO são as dos dois "todos": o anel dos elementos
// leva as cinco tintas do jogo (as --e-* do style.css) e a gema das raridades as
// quatro de Art.rarityColor — é o único jeito de dizer "todos" sem letra.

var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

(function () {
  'use strict';

  var IU = {};
  JOGO.IconesUI = IU;

  var MEIA = '.45';                         // a meia tinta do detalhe de segundo plano

  /* ------------------------------------------------------------ o lápis
   * Cinco traços bastam: caminho cheio, caminho com furo, risco, disco e
   * retângulo. Os números saem com no máximo duas casas — a string vai
   * inteira para o innerHTML de cada botão. */
  function n(v) { return String(Math.round(v * 100) / 100); }
  function op(o) { return o == null ? '' : ' fill-opacity="' + o + '"'; }
  function cheio(d, o) { return '<path d="' + d + '"' + op(o) + '/>'; }
  function furado(d, o) { return '<path fill-rule="evenodd" d="' + d + '"' + op(o) + '/>'; }
  function risco(d, w, o) {
    return '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="' + (w || 2) +
      '" stroke-linecap="round" stroke-linejoin="round"' +
      (o == null ? '' : ' stroke-opacity="' + o + '"') + '/>';
  }
  function disco(cx, cy, r, o) {
    return '<circle cx="' + n(cx) + '" cy="' + n(cy) + '" r="' + n(r) + '"' + op(o) + '/>';
  }
  function ret(x, y, w, h, r, o) {
    return '<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) +
      '" rx="' + n(r || 0) + '"' + op(o) + '/>';
  }
  function grupo(transf, dentro) { return '<g transform="' + transf + '">' + dentro + '</g>'; }
  // um círculo como SUBCAMINHO — para furar (evenodd) o que está por baixo
  function roda(cx, cy, r) {
    return 'M' + n(cx - r) + ' ' + n(cy) + 'a' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(2 * r) + ' 0' +
      'a' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(-2 * r) + ' 0Z';
  }
  // retângulo arredondado como subcaminho (as cartas furadas)
  function caixa(x, y, w, h, r) {
    return 'M' + n(x + r) + ' ' + n(y) + 'H' + n(x + w - r) + 'A' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(x + w) + ' ' + n(y + r) +
      'V' + n(y + h - r) + 'A' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(x + w - r) + ' ' + n(y + h) +
      'H' + n(x + r) + 'A' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(x) + ' ' + n(y + h - r) +
      'V' + n(y + r) + 'A' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(x + r) + ' ' + n(y) + 'Z';
  }
  // estrela de `pontas` pontas (o selo); a primeira ponta aponta para cima
  function estrela(cx, cy, R, r, pontas) {
    var d = '', i, a, raio;
    for (i = 0; i < pontas * 2; i++) {
      a = -Math.PI / 2 + i * Math.PI / pontas;
      raio = i % 2 ? r : R;
      d += (i ? 'L' : 'M') + n(cx + Math.cos(a) * raio) + ' ' + n(cy + Math.sin(a) * raio);
    }
    return d + 'Z';
  }

  /* ------------------------------------------------------ as peças-base
   * Os desenhos que mais de um ícone usa: o elmo é "Equipamentos" e "Itens"
   * do GM, os cristais são "Pedras" nos dois lugares, o frasco é o
   * "Consumíveis" e a banca de "Poções", a pata é "Pets" e "Bichos". */

  // ELMO fechado de frente: a fenda em T é o que faz um capacete ser capacete
  // a 22 px; os dois respiros do queixo e o friso do alto ficam de apoio
  var ELMO =
    furado('M12 3.1C16.8 3.1 19.7 6.3 19.7 10.8V17.4C19.7 20 16.6 22 12 22C7.4 22 4.3 20 4.3 17.4V10.8C4.3 6.3 7.2 3.1 12 3.1Z' +
           'M6.5 10.6H17.5V12.8H13.1V19.2H10.9V12.8H6.5Z' + roda(7.9, 16, 0.95) + roda(16.1, 16, 0.95)) +
    cheio('M10.9 3.2C11 1.9 11.4 1.3 12 1.3C12.6 1.3 13 1.9 13.1 3.2Z', MEIA);

  // CRISTAIS de forja: um alto no meio e dois menores abrindo para os lados,
  // cada um com a faceta da esquerda cheia e a da direita a meia tinta, no chão
  var CRISTAIS =
    cheio('M3.6 8.6L2.3 12.4L4.3 20.1H6Z') + cheio('M3.6 8.6L6 20.1H7.7L6.8 10.9Z', MEIA) +
    cheio('M20.4 8.6L17.2 10.9L16.3 20.1H18Z') + cheio('M20.4 8.6L18 20.1H19.7L21.7 12.4Z', MEIA) +
    cheio('M12 1.8L8.6 6.2V20.1H12Z') + cheio('M12 1.8L15.4 6.2V20.1H12Z', MEIA) +
    ret(2.2, 20.9, 19.6, 1.8, 0.9);

  // FRASCO de poção: rolha, gargalo, e o bojo redondo de vidro (meia tinta)
  // com o líquido ondulado cheio por dentro e uma bolha subindo
  var FRASCO =
    ret(9.6, 1.4, 4.8, 2.9, 0.9) + ret(8.6, 4.2, 6.8, 1.8, 0.9) +
    cheio('M10 6H14V8.3A7 7 0 1 1 10 8.3Z', MEIA) +
    cheio('M5.26 13.1C7.6 12.1 9.7 14.1 12 13.1C14.3 12.1 16.4 14.1 18.74 13.1A7 7 0 1 1 5.26 13.1Z') +
    disco(10.3, 10.6, 1.05) + disco(13.5, 9.3, 0.7);

  // PATA: a almofada e quatro dedos em leque
  var PATA =
    cheio('M12 11.4C14.9 11.4 17.9 15 17.9 17.8C17.9 20.1 16.2 21.3 14.5 21.3C13.4 21.3 12.8 20.6 12 20.6C11.2 20.6 10.6 21.3 9.5 21.3C7.8 21.3 6.1 20.1 6.1 17.8C6.1 15 9.1 11.4 12 11.4Z') +
    '<ellipse cx="4.4" cy="10.7" rx="1.95" ry="2.55" transform="rotate(-28 4.4 10.7)"/>' +
    '<ellipse cx="8.7" cy="5.9" rx="2.15" ry="2.8" transform="rotate(-10 8.7 5.9)"/>' +
    '<ellipse cx="15.3" cy="5.9" rx="2.15" ry="2.8" transform="rotate(10 15.3 5.9)"/>' +
    '<ellipse cx="19.6" cy="10.7" rx="1.95" ry="2.55" transform="rotate(28 19.6 10.7)"/>';

  // COURAÇA de frente: o peito cheio, a cinta de lâminas a meia tinta e a
  // aba da cintura — as frestas entre as três é que dizem "armadura"
  var COURACA =
    cheio('M3.5 5L7.5 3C9 4.3 10.4 5 12 5C13.6 5 15 4.3 16.5 3L20.5 5C19.6 7.2 19.3 9 19.5 11.2L12 13.2L4.5 11.2C4.7 9 4.4 7.2 3.5 5Z') +
    cheio('M4.6 12.6L12 14.6L19.4 12.6C19.4 14.2 19.2 15.6 18.9 16.8L12 18.6L5.1 16.8C4.8 15.6 4.6 14.2 4.6 12.6Z', MEIA) +
    cheio('M5.5 18.2L12 20L18.5 18.2C18.2 19 17.9 19.7 17.5 20.4C15.8 21.4 14 22 12 22C10 22 8.2 21.4 6.5 20.4C6.1 19.7 5.8 19 5.5 18.2Z');

  // GEMA lapidada (coroa em cima, pavilhão em baixo), facetas alternando cheio
  // e meia tinta. Desenhada entre y 2,5 e 16,4 para deixar a linha de baixo às
  // pedrinhas da raridade.
  var GEMA =
    cheio('M7.6 2.5L3.2 7.2H8.8Z', MEIA) + cheio('M7.6 2.5H16.4L15.2 7.2H8.8Z') +
    cheio('M16.4 2.5L20.8 7.2H15.2Z', MEIA) +
    cheio('M3.2 7.2H8.8L12 16.4Z') + cheio('M8.8 7.2H15.2L12 16.4Z', MEIA) + cheio('M15.2 7.2H20.8L12 16.4Z');
  // a gema posta em outro lugar da caixa: (x0, y0) é onde cai o canto de cima
  // à esquerda do contorno (3,2 ; 2,5) e `s` a escala
  function gemaEm(x0, y0, s, dentro) {
    return grupo('translate(' + n(x0 - 3.2 * s) + ' ' + n(y0 - 2.5 * s) + ') scale(' + s + ')', dentro || GEMA);
  }

  // MOEDA com aro: disco, o anel furado e o miolo de volta
  function moeda(cx, cy, r) {
    return furado(roda(cx, cy, r) + roda(cx, cy, r * 0.72)) + disco(cx, cy, r * 0.5);
  }

  // as setas de ordenar: a haste em pé e a ponta, à direita da caixa
  var SETA_SOBE = risco('M18.8 20V4.4M15.6 7.6L18.8 4.4L22 7.6', 2.1);
  var SETA_DESCE = risco('M18.8 4V19.6M15.6 16.4L18.8 19.6L22 16.4', 2.1);

  // AS PEDRINHAS DA RARIDADE — as mesmas "1 · 2 · 3 · 4" que o art.js desenha
  // no pé de cada ícone de item: comum uma, lendária quatro
  function pedrinhas(qtd) {
    var s = '', i;
    for (i = 0; i < qtd; i++) s += disco(12 + (i - (qtd - 1) / 2) * 3.7, 20.3, 1.35);
    return s;
  }

  // "TODOS OS ELEMENTOS": um anel em cinco arcos, um por elemento, fogo em
  // cima e o resto no sentido do relógio. As cores são as do style.css (--e-*).
  var TINTAS = ['#ff8c3a', '#57c8ec', '#9bd06a', '#c8b6ff', '#d8dee4'];
  function anelDosElementos() {
    var s = '', i, a0, a1, r = 7.6, meio = 56 * Math.PI / 180;
    for (i = 0; i < 5; i++) {
      a0 = -Math.PI / 2 + i * 2 * Math.PI / 5 - meio / 2;
      a1 = a0 + meio;
      s += '<path d="M' + n(12 + Math.cos(a0) * r) + ' ' + n(12 + Math.sin(a0) * r) +
        'A' + r + ' ' + r + ' 0 0 1 ' + n(12 + Math.cos(a1) * r) + ' ' + n(12 + Math.sin(a1) * r) +
        '" fill="none" stroke="' + TINTAS[i] + '" stroke-width="3.3"/>';
    }
    return s;
  }

  // "TODAS AS RARIDADES" pela mesma lógica: a gema em quatro gomos, da comum à
  // lendária da esquerda para a direita (as cores de Art.rarityColor), a coroa a
  // meia tinta e o pavilhão cheio
  var RARAS = ['#9aa4ae', '#54a8e8', '#ffc44d', '#ffe9a8'];
  function gemaDasRaridades() {
    var s = '', i, t0, t1, g0, g1;
    for (i = 0; i < 4; i++) {
      t0 = 7.6 + i * 2.2; t1 = t0 + 2.2;
      g0 = 3.2 + i * 4.4; g1 = g0 + 4.4;
      s += '<path d="M' + n(t0) + ' 2.5H' + n(t1) + 'L' + n(g1) + ' 7.2H' + n(g0) + 'Z" fill="' + RARAS[i] + '" fill-opacity=".6"/>' +
           '<path d="M' + n(g0) + ' 7.2H' + n(g1) + 'L12 16.4Z" fill="' + RARAS[i] + '"/>';
    }
    return s;
  }

  /* ------------------------------------------------------------ o catálogo
   * A ORDEM daqui é a de `ids()` — por grupo, como os menus mostram. */
  var DESENHO = {};
  var ORDEM = [];
  function poe(id, dentro) { DESENHO[id] = dentro; ORDEM.push(id); }

  // --- as quatro categorias do inventário
  poe('cat-equip', ELMO);
  poe('cat-pedras', CRISTAIS);
  poe('cat-cons', FRASCO);
  poe('cat-pets', PATA);

  // --- os espaços do equipamento ("Tudo" e os quatro)
  poe('slot-todos', ret(3.3, 3.3, 7.6, 7.6, 2.1) + ret(13.1, 3.3, 7.6, 7.6, 2.1) +
                    ret(3.3, 13.1, 7.6, 7.6, 2.1) + ret(13.1, 13.1, 7.6, 7.6, 2.1));
  // manopla fechada: quatro dedos de placa, o dorso e o punho alargado
  poe('slot-punho',
    ret(4.3, 4.4, 3.25, 6.6, 1.6) + ret(8.35, 3.2, 3.25, 7.8, 1.6) +
    ret(12.4, 3.5, 3.25, 7.5, 1.6) + ret(16.45, 4.9, 3.25, 6.1, 1.6) +
    cheio('M4.3 11.9H19.7V14.4C19.7 16.3 18.4 17.6 16.5 17.6H7.5C5.6 17.6 4.3 16.3 4.3 14.4Z') +
    cheio('M6.4 18.5H17.6L19.1 22H4.9Z', MEIA));
  // bota de perfil: o cano com a dobra, o peito do pé e a sola solta
  poe('slot-passo',
    ret(5, 2.2, 8.8, 3, 1) +
    cheio('M5.6 6.1H13.2V11.2C13.2 12.4 14 13.2 15.3 13.5L18.8 14.3C20.6 14.7 21.6 16 21.6 17.6V18H4.3V13C4.3 11.6 5 10.5 5.6 9.8Z') +
    cheio('M3.8 19.1H21.6V20.3C21.6 21 21.1 21.5 20.4 21.5H3.8Z', MEIA));
  poe('slot-casca', COURACA);
  // lanterna: alça, chapéu, as duas hastes, o vidro a meia tinta com a chama
  // dentro, e o pé
  poe('slot-lume',
    risco('M9.3 5V4.3C9.3 2.8 10.5 1.7 12 1.7C13.5 1.7 14.7 2.8 14.7 4.3V5', 1.5) +
    cheio('M8.2 5H15.8L17.6 7.6H6.4Z') +
    ret(7.8, 8.2, 8.4, 10.4, 0, MEIA) +
    ret(6.4, 7.6, 1.8, 11.6, 0.6) + ret(15.8, 7.6, 1.8, 11.6, 0.6) +
    cheio('M12 10.2C13.5 12 14.4 13.4 14.4 14.9C14.4 16.3 13.3 17.3 12 17.3C10.7 17.3 9.6 16.3 9.6 14.9C9.6 13.4 10.5 12 12 10.2Z') +
    cheio('M5.6 19H18.4V20.6C18.4 21.3 17.9 21.8 17.2 21.8H6.8C6.1 21.8 5.6 21.3 5.6 20.6Z'));

  // --- os elementos
  poe('el-todos', anelDosElementos());
  // a chama do brasão, com a língua de dentro vazada e a meia tinta
  var CHAMA_DENTRO = 'M12.2 13.9C13.9 15.3 15.2 16.4 15.2 17.8C15.2 19.2 13.8 19.9 12 19.9C10.2 19.9 8.8 19.2 8.8 17.8C8.8 16.3 10.4 15.4 12.2 13.9Z';
  poe('el-fogo',
    furado('M12 2.4C14.8 6.4 19.2 10 19.2 14C19.2 18 16 21.2 12 21.2C8 21.2 4.8 18 4.8 14C4.8 11.2 7.2 9.2 8.8 7.2C8.8 10.4 10 12.4 11.2 13C12.6 12 13 6.8 12 2.4Z' + CHAMA_DENTRO) +
    cheio(CHAMA_DENTRO, MEIA));
  // a gota do brasão, com o brilho vazado em crescente
  poe('el-agua',
    furado('M12 3C12 3 18.8 11.1 18.8 14.8A6.8 6.8 0 1 1 5.2 14.8C5.2 11.1 12 3 12 3Z' +
           'M7.9 14.6C7.9 17.1 9.2 18.9 11.4 19.4C10 18.3 9.4 16.7 9.5 14.6Z'));
  // a pedra em duas facetas e o broto saindo dela: terra é chão E o que nasce
  poe('el-terra',
    cheio('M2.8 20.9L4.7 15.2L9.1 12.3L12.4 12.5L14.1 20.9Z') +
    cheio('M12.4 12.5L15.8 12.7L20.3 15.8L21.2 20.9H14.1Z', MEIA) +
    risco('M12 12.4V7.4', 1.5) +
    cheio('M11.5 9C11.3 6.3 9.4 4.7 6.2 4.9C6.4 7.9 8.5 9.4 11.5 9Z') +
    cheio('M12.5 7.8C12.7 4.7 14.7 2.9 18.2 3.1C18 6.6 15.8 8 12.5 7.8Z'));
  // três rajadas de vento com a ponta enrolada; a de baixo a meia tinta
  poe('el-ar',
    risco('M3 8.2H13.2C15.2 8.2 16.6 6.9 16.6 5.2C16.6 3.7 15.5 2.6 14.1 2.6C12.8 2.6 11.8 3.6 11.8 4.8', 2.1) +
    risco('M3 12.4H18C20 12.4 21.4 13.8 21.4 15.6C21.4 17.3 20.1 18.5 18.6 18.5C17.3 18.5 16.2 17.5 16.2 16.2', 2.1) +
    risco('M5.2 16.6H10.3C11.9 16.6 13.1 17.8 13.1 19.3C13.1 20.6 12.1 21.6 10.8 21.6C9.7 21.6 8.8 20.8 8.8 19.8', 2.1, MEIA));
  // o equilíbrio: um anel e o ponto no centro
  poe('el-neutro',
    '<circle cx="12" cy="12" r="7.9" fill="none" stroke="currentColor" stroke-width="2.4"/>' +
    disco(12, 12, 3.3));

  // --- as raridades: a mesma gema, e o que muda são as pedrinhas
  // "Todas": a gema dos quatro gomos, sem pedrinha — como o anel dos elementos,
  // é a cor que diz "todas"
  poe('rar-todas', grupo('translate(0 2.6)', gemaDasRaridades()));
  poe('rar-comum', GEMA + pedrinhas(1));
  poe('rar-raro', GEMA + pedrinhas(2));
  poe('rar-epico', GEMA + pedrinhas(3));
  poe('rar-lendario', GEMA + pedrinhas(4));

  // --- a ordem da lista do mercado
  poe('ord-preco-asc', moeda(8.2, 12, 6.3) + SETA_SOBE);
  poe('ord-preco-desc', moeda(8.2, 12, 6.3) + SETA_DESCE);
  // A em cima de Z (as letras são riscos — texto não pode) e a seta descendo
  poe('ord-nome',
    risco('M3.2 10.8L6.6 3L10 10.8M4.6 8H8.6', 2) +
    risco('M3.6 13.6H9.6L3.6 20.8H9.6', 2) +
    SETA_DESCE);
  // a raridade ordena da mais rara para a comum: a gema e a seta descendo
  poe('ord-raridade', gemaEm(1, 6.4, 0.78) + SETA_DESCE);

  // --- as abas do mercado
  // a cesta com a moeda caindo por baixo da alça
  poe('mc-comprar',
    risco('M6.4 10.2C6.4 5.6 8.9 3 12 3C15.1 3 17.6 5.6 17.6 10.2', 1.9) +
    disco(12, 7.3, 2.4) +
    ret(2.6, 10.2, 18.8, 2.6, 1.3) +
    furado('M4.2 13.6H19.8L18.5 20.3C18.3 21.3 17.6 22 16.6 22H7.4C6.4 22 5.7 21.3 5.5 20.3Z' +
           'M8.2 15.2h1.5v5h-1.5zM11.25 15.2h1.5v5h-1.5zM14.3 15.2h1.5v5h-1.5z'));
  // a etiqueta de preço, com o furo do barbante e dois riscos de "valor"
  poe('mc-vender',
    furado('M2.8 12.1V4.6C2.8 3.6 3.6 2.8 4.6 2.8H12.1L21.1 11.8C21.8 12.5 21.8 13.6 21.1 14.3L14.3 21.1C13.6 21.8 12.5 21.8 11.8 21.1Z' +
           roda(7.4, 7.4, 1.9) + 'M10.2 14.9L14.9 10.2L16 11.3L11.3 16Z'));
  // a barraca: o toldo listrado de bico (é ele que diz "loja" a 22 px), as
  // duas hastes e o balcão — embaixo fica vazio, que é o que separa de um baú
  poe('mc-meus', (function () {
    var s = ret(3.3, 8, 1.7, 14, 0.7) + ret(19, 8, 1.7, 14, 0.7), i, t0, t1, b0, b1;
    for (i = 0; i < 4; i++) {
      t0 = 4.4 + i * 3.8; t1 = t0 + 3.8;
      b0 = 2 + i * 5; b1 = b0 + 5;
      s += cheio('M' + n(t0) + ' 2.4H' + n(t1) + 'L' + n(b1) + ' 8.4A2.5 2.5 0 0 1 ' + n(b0) + ' 8.4Z',
                 i % 2 ? MEIA : null);
    }
    return s + ret(2.2, 14.8, 19.6, 3, 1.1);
  })());
  // o balão da proposta com a moeda dentro
  poe('mc-ofertas',
    furado('M4.2 3.2H19.8C21 3.2 22 4.2 22 5.4V14.6C22 15.8 21 16.8 19.8 16.8H11.2L6.2 21V16.8H4.2C3 16.8 2 15.8 2 14.6V5.4C2 4.2 3 3.2 4.2 3.2Z' +
           roda(12, 10, 4.4)) +
    disco(12, 10, 2.9));
  poe('mc-pocoes', FRASCO);

  // --- os dois modos da forja
  // o martelo inclinado em cima da bigorna, e duas fagulhas
  poe('fg-forjar',
    grupo('translate(9.4 5.4) rotate(-42)',
      ret(-4.6, -2.3, 9.2, 4.6, 1) + ret(-1, 2.3, 2, 6.6, 0.8)) +
    cheio('M3.4 12.6H17C19.2 12.6 20.9 13.5 22 15L17 16H15.6L16 18.6L18.2 19.9V21.8H5.8V19.9L8 18.6L8.4 16H5.4C4.3 16 3.4 15.1 3.4 14Z') +
    risco('M17.2 8.6L19.4 7.2M17.8 11L20.4 10.8', 1.4, '.6'));
  // a peça rachada ao meio: as duas metades do escudo abrindo em V pelo pé,
  // e as lascas saltando da fresta — tem de ler "desfazer em pedaços"
  var RACHA = 'L12.9 17.4L10.9 13.8L13 10.4L10.6 7Z';
  poe('fg-quebrar',
    grupo('rotate(-10 12 21.6) translate(-.5 0)', cheio('M12 2.8L4 5.4C4 12.8 6.9 18.4 12 21.6' + RACHA)) +
    grupo('rotate(10 12 21.6) translate(.5 0)', cheio('M12 2.8L20 5.4C20 12.8 17.1 18.4 12 21.6' + RACHA)) +
    cheio('M11 3.3L12.9 2.4L12.5 4.8Z') + cheio('M13.4 0.6L15.3 1.2L14 2.6Z', MEIA) +
    cheio('M9.3 0.9L10.9 1.1L10 2.4Z', MEIA));

  // --- as abas da caixa do GM
  poe('gm-itens', ELMO);
  // o conjunto é a armadura INTEIRA: o elmo em cima da couraça, como no
  // cabide — o elmo sozinho já é "Itens"
  poe('gm-sets',
    furado('M12 1C15.3 1 17 3.2 17 6V8.4C17 9.7 15 10.6 12 10.6C9 10.6 7 9.7 7 8.4V6C7 3.2 8.7 1 12 1Z' +
           'M8.7 5.4H15.3V6.9H12.75V9.3H11.25V6.9H8.7Z') +
    grupo('translate(2.4 9.44) scale(.8 .58)', COURACA));
  poe('gm-bichos', PATA);
  poe('gm-pedras', CRISTAIS);
  // a medalha: as duas fitas atrás a meia tinta e o disco com a estrela vazada
  poe('gm-selos',
    cheio('M7.8 12L5.2 21L8.3 19.7L10.2 22.2L12 14.8Z', MEIA) +
    cheio('M16.2 12L18.8 21L15.7 19.7L13.8 22.2L12 14.8Z', MEIA) +
    furado(roda(12, 8.6, 6.8) + estrela(12, 8.9, 3.9, 1.6, 5)));
  // duas cartas em leque: a de trás a meia tinta, a da frente com a moldura
  // vazada e o losango no meio
  poe('gm-cartas',
    grupo('rotate(-13 8.6 12.4)', ret(3.3, 4.6, 10.6, 15.6, 1.8, MEIA)) +
    grupo('rotate(9 14.6 12)',
      furado(caixa(9.1, 4, 11, 16, 1.8) + caixa(10.9, 5.8, 7.4, 12.4, 0.9)) +
      cheio('M14.6 8.3L17.1 12L14.6 15.7L12.1 12Z')));
  // o pergaminho: dois rolos cheios e o papel a meia tinta com as linhas
  var PERGAMINHO =
    ret(6, 5.4, 12, 13.2, 0, MEIA) +
    ret(8.4, 8.3, 7.2, 1.4, 0.7) + ret(8.4, 11.2, 7.2, 1.4, 0.7) + ret(8.4, 14.1, 4.8, 1.4, 0.7) +
    ret(3.6, 2.2, 16.8, 3.4, 1.7) + ret(3.6, 18.4, 16.8, 3.4, 1.7);
  poe('gm-pergaminhos', PERGAMINHO);

  /* --- AS FICHAS (02/10, a frente dos menus): o medalhão do cabeçalho de
   * cada ficha e as portas do cais. O cais era de EMOJI — cada sistema
   * desenha o seu (a mochila rosa do Windows, a azul do Android), com cor
   * própria que brigava com o ouro da moldura e sem traço comum com os
   * ícones das abas. Aqui é o mesmo lápis: silhueta cheia, meia tinta, furo.
   * Quem já tem desenho no catálogo reaproveita (forja, cartas, barraca). */
  // o busto: a cabeça e os ombros — "eu", a conta
  var BUSTO = disco(12, 7.4, 4.3) + cheio('M3.4 21.8C3.4 16.4 7.2 13 12 13C16.8 13 20.6 16.4 20.6 21.8Z');
  poe('fc-personagem', BUSTO);
  // a mochila: a alça de mão, o corpo com o rasgo da aba e o bolso a meia tinta
  poe('fc-inventario',
    risco('M9.2 5.4V4.4C9.2 3 10.4 2 12 2C13.6 2 14.8 3 14.8 4.4V5.4', 1.7) +
    furado(caixa(4.2, 5, 15.6, 17, 3.6) + 'M4.4 10.4H19.6V11.7H4.4Z' + caixa(7.6, 14, 8.8, 5.4, 1.2)) +
    ret(7.6, 14, 8.8, 5.4, 1.2, MEIA) + disco(12, 11.05, 1.5));
  // o grimório fechado: a capa com a runa vazada e o miolo das folhas ao lado
  poe('fc-feiticos',
    furado(caixa(4, 2.2, 14, 19.6, 1.8) + estrela(11, 11.6, 5, 1.9, 4)) +
    ret(18.8, 3.6, 2, 16.8, 0.7, MEIA));
  poe('fc-missoes', PERGAMINHO);
  // o escudo de brasão com a asna vazada — o mesmo gesto do estandarte da Sede
  poe('fc-guilda',
    furado('M12 2L20.2 4.8V11.4C20.2 16.4 16.8 20.2 12 22C7.2 20.2 3.8 16.4 3.8 11.4V4.8Z' +
           'M6.8 12.8L12 8.6L17.2 12.8V15.4L12 11.2L6.8 15.4Z'));
  // dois bustos: o de trás a meia tinta
  poe('fc-amigos',
    disco(16.2, 7, 3.3, MEIA) + cheio('M10.8 19.6C10.8 15.2 13.2 12.4 16.2 12.4C19.4 12.4 22 15.2 22 19.6Z', MEIA) +
    disco(8.8, 8.6, 3.9) + cheio('M2 21.8C2 16.8 5 13.8 8.8 13.8C12.6 13.8 15.6 16.8 15.6 21.8Z'));
  poe('fc-forja', DESENHO['fg-forjar']);
  poe('fc-colecao', DESENHO['gm-cartas']);
  // o baú do cofre: a tampa abaulada e o corpo com o buraco da fechadura
  poe('fc-banco',
    cheio('M3 9.4V7.6C3 4.8 5.2 3 8 3H16C18.8 3 21 4.8 21 7.6V9.4Z') +
    ret(6.2, 3.4, 1.8, 6, 0, MEIA) + ret(16, 3.4, 1.8, 6, 0, MEIA) +
    furado('M3 10.8H21V20C21 21.1 20.1 22 19 22H5C3.9 22 3 21.1 3 20Z' +
           roda(12, 14.6, 1.8) + 'M11.2 15.6H12.8L13.3 19H10.7Z'));
  poe('fc-mercado', DESENHO['mc-meus']);
  // a roleta: o aro, o miolo a meia tinta riscado pelos raios, e o ponteiro em cima
  poe('fc-loteria',
    furado(roda(12, 13.2, 8.8) + roda(12, 13.2, 6.7)) +
    disco(12, 13.2, 6.7, MEIA) +
    risco('M12 6.9V19.5M5.7 13.2H18.3M7.55 8.75L16.45 17.65M16.45 8.75L7.55 17.65', 1.4) +
    disco(12, 13.2, 1.9) + cheio('M9.4 1.6H14.6L12 5.8Z'));
  // a taça: as alças em risco, a haste e a base em dois degraus
  poe('fc-placar',
    cheio('M6.6 2.4H17.4V8.6C17.4 12 15 14.4 12 14.4C9 14.4 6.6 12 6.6 8.6Z') +
    risco('M6.6 4.8H3.8V6.6C3.8 8.9 5.4 10.6 7.6 10.8M17.4 4.8H20.2V6.6C20.2 8.9 18.6 10.6 16.4 10.8', 1.6) +
    ret(10.9, 14, 2.2, 3.4, 0.4) + ret(8.2, 17.2, 7.6, 2.4, 0.6, MEIA) + ret(6.2, 19.4, 11.6, 2.4, 1.1));
  // o retrato no medalhão: o perfil de outro jogador
  poe('fc-perfil',
    furado(roda(12, 12, 10) + roda(12, 12, 8.2)) + disco(12, 9.6, 3.1) +
    cheio('M6.3 18.3C6.8 15.4 9.1 13.6 12 13.6C14.9 13.6 17.2 15.4 17.7 18.3C16.3 19.8 14.3 20.6 12 20.6C9.7 20.6 7.7 19.8 6.3 18.3Z'));
  // as duas setas que se cruzam: vai uma, volta a outra (a de volta a meia tinta)
  poe('fc-troca',
    risco('M3.4 8H18.6M15 4.4L18.6 8L15 11.6', 2.2) +
    risco('M20.6 16H5.4M9 12.4L5.4 16L9 19.6', 2.2, MEIA));
  // a chave: o anel vazado, a haste e os dois dentes
  poe('fc-contas',
    furado(roda(7.4, 12, 5.4) + roda(7.4, 12, 2.2)) +
    ret(12.2, 10.9, 9.8, 2.2, 0.6) + ret(17.2, 12.9, 1.9, 3.8, 0.4) + ret(20.1, 12.9, 1.9, 2.8, 0.4));
  // duas espadas cruzadas: o duelo, a arena, o quadro
  var ESPADA = cheio('M11 2.6L12 1.3L13 2.6V14.4H11Z') + ret(8.3, 14.4, 7.4, 1.8, 0.9) +
               ret(11.1, 16.2, 1.8, 3.6, 0.5) + disco(12, 20.6, 1.35);
  poe('fc-duelo', grupo('rotate(45 12 12)', ESPADA) + grupo('rotate(-45 12 12)', ESPADA));
  // o balão da conversa com as três reticências vazadas
  poe('fc-mensagem',
    furado('M4.4 3.4H19.6C20.9 3.4 22 4.5 22 5.8V14.2C22 15.5 20.9 16.6 19.6 16.6H10.6L5.8 20.8V16.6H4.4C3.1 16.6 2 15.5 2 14.2V5.8C2 4.5 3.1 3.4 4.4 3.4Z' +
           roda(7.6, 10, 1.45) + roda(12, 10, 1.45) + roda(16.4, 10, 1.45)));
  // a pausa: o disco com as duas barras vazadas
  poe('fc-pausa', furado(roda(12, 12, 10) + 'M8.5 7.2H10.9V16.8H8.5ZM13.1 7.2H15.5V16.8H13.1Z'));
  // a engrenagem de oito dentes com o eixo vazado
  poe('fc-config', (function () {
    var d = '', k, a, pts = [], R1 = 7.7, R2 = 10.2;
    function p(r, g) { var rad = g * Math.PI / 180; pts.push(n(12 + Math.cos(rad) * r) + ' ' + n(12 + Math.sin(rad) * r)); }
    for (k = 0; k < 8; k++) { a = k * 45; p(R1, a - 16); p(R2, a - 9); p(R2, a + 9); p(R1, a + 16); }
    d = 'M' + pts.join('L') + 'Z';
    return furado(d + roda(12, 12, 3.3));
  })());
  // a coroa de três pontas: o Mestre
  poe('fc-mestre',
    cheio('M2.6 7.6L7.4 12L12 4.6L16.6 12L21.4 7.6L19.6 18H4.4Z') +
    disco(2.8, 6.6, 1.5) + disco(12, 3.4, 1.6) + disco(21.2, 6.6, 1.5) +
    ret(4.4, 19.2, 15.2, 2.6, 1));
  // o triângulo de aviso com a exclamação vazada: a pergunta que confirma
  poe('fc-alerta',
    furado('M10.6 3.3C11.2 2.2 12.8 2.2 13.4 3.3L22.1 18.9C22.7 20 21.9 21.3 20.7 21.3H3.3C2.1 21.3 1.3 20 1.9 18.9Z' +
           'M10.85 8.4H13.15L12.75 14.8H11.25Z' + roda(12, 17.6, 1.3)));
  // o poço: o telhadinho, as duas colunas, o balde na corda e a mureta de pedra
  poe('fc-poco',
    cheio('M2.8 7L12 2.2L21.2 7V8.6H2.8Z') +
    ret(4.8, 8.6, 1.8, 6, 0.5) + ret(17.4, 8.6, 1.8, 6, 0.5) +
    risco('M12 8.6V11.4', 1.2) + ret(10.3, 11.2, 3.4, 2.6, 0.6, MEIA) +
    furado('M3.2 14.6H20.8V20C20.8 21.1 19.9 22 18.8 22H5.2C4.1 22 3.2 21.1 3.2 20Z' +
           'M3.2 17.7H20.8V18.7H3.2ZM11.5 14.6H12.5V17.7H11.5ZM7.4 18.7H8.4V22H7.4ZM15.6 18.7H16.6V22H15.6Z'));

  /* --------------------------------------------------------------- a API */
  function tem(id) { return Object.prototype.hasOwnProperty.call(DESENHO, id); }

  // svg('cat-pedras') -> '<svg class="ico-svg ico-cat-pedras" viewBox="0 0 24 24" ...>...</svg>'
  // id desconhecido -> '' (quem chamou volta ao texto)
  IU.svg = function (id) {
    if (!tem(id)) return '';
    return '<svg class="ico-svg ico-' + id + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"' +
      ' xmlns="http://www.w3.org/2000/svg" fill="currentColor">' + DESENHO[id] + '</svg>';
  };
  IU.tem = tem;
  IU.ids = function () { return ORDEM.slice(); };

  // O MIOLO PRONTO de um botão: o ícone e o nome no span escondido — o
  // textContent do botão sai igual ao rótulo, letra por letra. Sem ícone para
  // o id, sai só o rótulo, visível: o botão nunca fica mudo.
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  IU.rotulado = function (id, rotulo) {
    var s = IU.svg(id);
    return s ? s + '<span class="rot-oculto">' + esc(rotulo) + '</span>' : esc(rotulo);
  };
})();
