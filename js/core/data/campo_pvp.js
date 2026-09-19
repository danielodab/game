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
 * 19/09 (dono, com foto: "o mapa pvp está muito ruim"): os muros deixaram de ser caixas
 * de tijolo. Cada muro daqui vira uma FILEIRA de módulos de muro do próprio dono (os do
 * jardim ou os da cisterna, esticados como no tabuleiro), com um pilar em cada ponta; a
 * borda é um quadrado de ruína; as tochas são braseiros; e há enfeites e bandeiras. O
 * desenho continua sendo este arquivo — só ganhou campos.
 *
 * COMO EDITAR (tudo em metros; o centro do Campo é x = 0, z = 0; o NORTE é z negativo,
 * o SUL é z positivo — a câmera nasce olhando para o norte, com o herói de costas; um
 * giro `rot`/`rotY` é em radianos, no sentido do relógio visto de cima; 1,57 = 90°):
 *   · meioLado — metade do lado do quadrado. 30 = um Campo de 60 × 60 m. Ninguém anda
 *     além de 94% dele (a borda de ruína fica logo depois).
 *   · tema — o catálogo do dono que veste os muros: 'garden' (os muros de pilastras do
 *     jardim, com musgo), 'cistern' (a pedra da cisterna) ou 'misto' (um muro de cada,
 *     alternando). Um muro sozinho pode dizer `tema: 'cistern'` e fugir da regra.
 *   · chao — as cores das lajotas: `pedra` (o tom-base), `junta` (as juntas e as
 *     rachaduras) e `terra` (o pó que mancha). Hex '#rrggbb'. `arena` é o raio do
 *     círculo de arena marcado no centro (0 = sem círculo).
 *   · borda — `alt` é a altura da ruína da borda (os pilares ficam 0,7 acima).
 *   · muros — cada muro é uma caixa sólida: `x`, `z` (o centro), `larg` (o comprimento,
 *     no eixo x antes de girar — é ao longo dele que os módulos enfileiram), `prof` (a
 *     espessura), `alt` (a altura) e `rotY` (o giro). Muro baixo (alt < 1,6) é MURETA:
 *     barra o passo, dá para ver por cima, e usa o módulo baixo. Um muro de larg ≈ prof
 *     (até 2,3) é um PILAR só. Para tirar um muro, apague a linha; para pôr, copie uma e
 *     mude os números.
 *   · tochas — {x, z} de cada braseiro de pé (barra o passo num raio de 45 cm).
 *   · enfeites — {x, z, chave, rot} de cada peça do catálogo do dono (jd_* do jardim,
 *     cs_* da cisterna; os nomes estão em assets/embedded/cenario-*.js). Em vez de
 *     `chave`, pode-se pedir por `papel` ('sotaque', 'sotaque_alto', 'chao', 'borda') e
 *     o catálogo do tema escolhe. `alt` força a altura. Enfeite de chão (cristal, raiz)
 *     não barra o passo; os outros barram num raio de ~50 cm. No celular os de chão
 *     não entram.
 *   · bandeiras — {x, z, rot} de cada bandeira vermelha (pilar com o pano; rot 0 = o
 *     pano olha para o sul, para a câmera). Sem a lista, duas nascem na entrada e duas
 *     na saída.
 *   · saida — onde fica o portal VERMELHO de volta à praça.
 *   · nasce — onde o herói aparece ao entrar.
 * Deixe ~3 m livres em volta de `saida` e de `nasce` (a prova tests/campo_pvp.html cobra
 * que nenhum muro encoste neles). */
JOGO.DATA.campoPvp = {
  meioLado: 30,
  tema: 'garden',
  chao: { pedra: '#5e5248', junta: '#2a2320', terra: '#4a3a2e', arena: 8.6 },
  borda: { alt: 2.6 },
  muros: [
    // o muro do meio, que corta a arena de ponta a ponta
    { x: 0,   z: 0,   larg: 8,   prof: 1.2, alt: 3.2, rotY: 0 },
    // os quatro muros de quina, abertos em leque
    { x: -12, z: -10, larg: 6,   prof: 1.2, alt: 3.0, rotY: 0.6 },
    { x: 12,  z: -10, larg: 6,   prof: 1.2, alt: 3.0, rotY: -0.6 },
    { x: -12, z: 10,  larg: 6,   prof: 1.2, alt: 3.0, rotY: -0.6 },
    { x: 12,  z: 10,  larg: 6,   prof: 1.2, alt: 3.0, rotY: 0.6 },
    // os dois muros compridos das laterais (correm de norte a sul: larg no eixo x, girados 90°)
    { x: -21, z: 0,   larg: 7,   prof: 1.2, alt: 2.8, rotY: 1.5708 },
    { x: 21,  z: 0,   larg: 7,   prof: 1.2, alt: 2.8, rotY: 1.5708 },
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
  enfeites: [
    // as duas estátuas do jardineiro, de guarda ao muro do meio
    { x: -6.8, z: 2.6,   chave: 'jd_estatua',    rot: 0.9 },
    { x: 6.8,  z: -2.6,  chave: 'jd_estatua',    rot: -2.2 },
    // as luminárias da corte iluminam a arena, uma de cada lado
    { x: -10.2, z: -1.2, chave: 'cs_luminaria',  rot: 0.4 },
    { x: 10.2,  z: 1.2,  chave: 'cs_luminaria',  rot: 3.5 },
    // os estandartes encharcados, à volta do braseiro do norte
    { x: -3.4, z: -25.5, chave: 'cs_estandarte', rot: 0.3 },
    { x: 3.4,  z: -25.5, chave: 'cs_estandarte', rot: -0.3 },
    // barris tombados perto da entrada, e o trono afogado esquecido na quina noroeste
    { x: -5.0, z: 24.2,  chave: 'cs_barril',     rot: 1.2 },
    { x: -6.1, z: 23.3,  chave: 'cs_barril',     rot: 2.6 },
    { x: -19.5, z: -23,  chave: 'cs_trono',      rot: 2.4 },
    // pedra e sal, tronco e vaso — o chão vivido
    { x: 20,   z: 23,    chave: 'cs_sal',        rot: 0.6 },
    { x: -15.5, z: -16.5, chave: 'jd_tronco',    rot: 1.1 },
    { x: 14.5, z: 15,    chave: 'jd_vaso',       rot: 0.2 },
    // enfeites de chão (não barram): cristais e raízes rompendo as lajotas
    { x: -17,  z: 17,    chave: 'jd_cristal_g',  rot: 0.5 },
    { x: 17,   z: -17,   chave: 'jd_cristal_g',  rot: 2.1 },
    { x: -16,  z: -6,    chave: 'jd_raiz',       rot: 0.8 },
    { x: 16,   z: 6,     chave: 'jd_raiz',       rot: 3.9 }
  ],
  bandeiras: [
    // na entrada, uma de cada lado de quem chega
    { x: -3.4, z: 21.6, rot: 0 }, { x: 3.4, z: 21.6, rot: 0 },
    // na saída, ladeando o portal vermelho e olhando para o centro
    { x: 10.3, z: 23.0, rot: -2.86 }, { x: 3.7, z: 25.0, rot: -2.86 }
  ],
  saida: { x: 7, z: 24 },
  nasce: { x: 0, z: 21 }
};
