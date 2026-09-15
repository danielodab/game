// O CAMPO DE PVP — o mapa aberto onde se entra de coroa ligada (dono: dados).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});
JOGO.DATA = JOGO.DATA || {};

/* O QUE ISTO É (14/09, pedido do dono: "vai ter um mapa exclusivo de PvP que vou criar
 * ainda — os muros e obstáculos; esse mapa os jogadores só vão entrar com a coroa ligada
 * e lá não poderá desligar, e lá ao clicar em cima o jogador pode atacar sem aviso
 * prévio, ou seja vai ser um mapa de pvp que é uma 'sala de espera' e ao atacar entra
 * automaticamente em uma batalha")
 * ============
 * O Campo é uma CENA do Acampamento (js/render3d/hub3d.js, Hub.entraCampo), como a
 * antessala: chão sem grade, anda-se clicando, os muros barram o passo. Este arquivo é só
 * o DESENHO do mapa — PROVISÓRIO, até o dono desenhar o dele. A regra (coroa, ataque,
 * batalha) não mora aqui.
 *
 * COMO EDITAR (tudo em metros; o centro do Campo é x = 0, z = 0; o NORTE é z negativo,
 * o SUL é z positivo — a câmera nasce olhando para o norte, com o herói de costas):
 *   · meioLado — metade do lado do quadrado. 30 = um Campo de 60 × 60 m. Ninguém anda
 *     além de 94% dele (a borda de pedra fica logo depois).
 *   · chao — as três cores do chão de terra e pedra: `terra` (o fundo), `pedra` (as lajes
 *     irregulares) e `junta` (as rachaduras entre elas). Hex '#rrggbb'.
 *   · muros — cada muro é uma caixa de pedra: `x`, `z` (o centro), `larg` (o comprimento,
 *     no eixo x antes de girar), `prof` (a espessura), `alt` (a altura) e `rotY` (o giro em
 *     radianos, no sentido do relógio visto de cima; 1,57 = 90°). Muro baixo (alt < 1,6)
 *     é mureta: barra o passo e dá para ver por cima. Um pilar é um muro de larg = prof.
 *     Para tirar um muro, apague a linha; para pôr, copie uma e mude os números.
 *   · tochas — {x, z} de cada tocha de pé (o poste barra o passo num raio de 45 cm).
 *   · saida — onde fica o portal VERMELHO de volta à praça.
 *   · nasce — onde o herói aparece ao entrar.
 * Deixe ~3 m livres em volta de `saida` e de `nasce` (a prova tests/campo_pvp.html cobra
 * que nenhum muro encoste neles). */
JOGO.DATA.campoPvp = {
  meioLado: 30,
  chao: { terra: '#3a322b', pedra: '#51473e', junta: '#211c18' },
  muros: [
    // o muro do meio, que corta a visada de ponta a ponta
    { x: 0,   z: 0,   larg: 8,   prof: 1.2, alt: 3.2, rotY: 0 },
    // os quatro muros de quina, abertos em leque
    { x: -12, z: -10, larg: 6,   prof: 1.2, alt: 3.0, rotY: 0.6 },
    { x: 12,  z: -10, larg: 6,   prof: 1.2, alt: 3.0, rotY: -0.6 },
    { x: -12, z: 10,  larg: 6,   prof: 1.2, alt: 3.0, rotY: -0.6 },
    { x: 12,  z: 10,  larg: 6,   prof: 1.2, alt: 3.0, rotY: 0.6 },
    // os dois muros compridos das laterais
    { x: -21, z: 0,   larg: 1.2, prof: 7,   alt: 2.8, rotY: 0 },
    { x: 21,  z: 0,   larg: 1.2, prof: 7,   alt: 2.8, rotY: 0 },
    // os pilares
    { x: -6,  z: -19, larg: 1.6, prof: 1.6, alt: 3.6, rotY: 0 },
    { x: 6,   z: -19, larg: 1.6, prof: 1.6, alt: 3.6, rotY: 0 },
    { x: 0,   z: -12, larg: 2,   prof: 2,   alt: 3.4, rotY: 0.785 },
    { x: 0,   z: 12,  larg: 2,   prof: 2,   alt: 3.4, rotY: 0.785 },
    // as duas muretas (cobertura baixa)
    { x: -7,  z: 5,   larg: 4,   prof: 0.9, alt: 1.3, rotY: 0 },
    { x: 7,   z: -5,  larg: 4,   prof: 0.9, alt: 1.3, rotY: 0 }
  ],
  tochas: [
    { x: -24, z: -24 }, { x: 24, z: -24 }, { x: -24, z: 24 }, { x: 24, z: 24 },
    { x: 0, z: -26 }, { x: -26, z: 0 }, { x: 26, z: 0 },
    { x: -9, z: 3 }, { x: 9, z: -3 }
  ],
  saida: { x: 7, z: 24 },
  nasce: { x: 0, z: 21 }
};
