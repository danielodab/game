// Os MAPAS DE LUTA ENTRE JOGADORES que não são calabouço (dono: dados).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});
JOGO.DATA = JOGO.DATA || {};

/* O QUE ISTO É (14/09, pedido do dono: "o desafio é apenas um duelo simples, isso
 * acontece em um mapa na praça mesmo — o mapa da praça tático, com a árvore central,
 * os portais e barracas como obstáculos"; e depois: "o duelo deve ocorrer no mapa da
 * praça; mapas aleatórios é para pvp de inscrição na arena ou pvp comum no mapa pvp")
 * ============
 * Mesmo formato de um calabouço (js/core/data/dungeons.js: legenda, `rooms[].layout`),
 * mas numa lista SEPARADA: nada daqui vira portal na praça, entra no sorteio das arenas
 * do PvP ranqueado (Coop.sorteiaArena só olha DATA.dungeons) ou aparece na wiki como
 * calabouço. O motor procura aqui quando o id não é de calabouço (engine.js getDungeon).
 *
 * A PRAÇA em grade (27×23) segue a praça 3D de verdade (js/render3d/hub3d.js, PRACA e
 * montaPortais), com o norte no alto: a Árvore-Mundo 3×3 no centro (bloqueia visão),
 * raízes como cobertura baixa nas diagonais, os seis portais no arco norte com mureta dos
 * dois lados, a Arena a oeste e a Sede a leste (2×4, altas), o Poço e o Banco altos, e as
 * barracas (Forja, Loteria, Mercadinho) e os bancos da calçada como cobertura baixa.
 * 12,8% de obstáculo. `P` = lado A (oeste), `a` = lado B (leste) — quatro de cada, para a
 * guerra de guilda 2×2 com as duplas.
 *
 * `pecas` diz ao tabuleiro 3D o que cada bloco É (a árvore, o portal de ordem i, a arena…)
 * para vestir com a arte da praça em vez de muro de calabouço. O motor não lê `pecas`. */
JOGO.DATA.arenas = [
  {
    id: 'praca',
    name: 'A Praça',
    theme: 'praca',
    palette: {
      primary: '#8a8478', secondary: '#5c574d', accent: '#ffd76b',
      floor1: '#6f6b63', floor2: '#77736a', wall: '#4f4a40', lowWall: '#6b6456', voidColor: '#2a3326'
    },
    defaultWeather: 'calmo',
    weatherShiftEveryRounds: 0,
    tileEventRate: 0,
    rooms: [
      {
        name: 'A Praça da Árvore-Mundo',
        weather: 'calmo',
        sceneryTheme: 'praca',
        layout: [
          '~~~~~~~~~.........~~~~~~~~~',
          '~~~~~~~.............~~~~~~~',
          '~~~~~....=#=...=#=....~~~~~',
          '~~~~...................~~~~',
          '~~~..=#=...........=#=..~~~',
          '~~.......................~~',
          '~............=............~',
          '~=#=...................=#=~',
          '...........................',
          '.....P.....=...=.....a.....',
          '........=...###...=........',
          '..##.PP.....###.....aa.##..',
          '..##....=...###...=....##..',
          '..##.P.....=...=.....a.##..',
          '..##...................##..',
          '~.........................~',
          '~............=............~',
          '~~....#.............#....~~',
          '~~~.................#...~~~',
          '~~~~.....==.....==.....~~~~',
          '~~~~~.......===.......~~~~~',
          '~~~~~~~.............~~~~~~~',
          '~~~~~~~~~.........~~~~~~~~~'
        ],
        monsters: {},
        pecas: [
          { papel: 'arvore', x: 12, y: 10, w: 3, h: 3 },
          { papel: 'raiz', x: 11, y: 9, w: 1, h: 1 }, { papel: 'raiz', x: 15, y: 9, w: 1, h: 1 },
          { papel: 'raiz', x: 11, y: 13, w: 1, h: 1 }, { papel: 'raiz', x: 15, y: 13, w: 1, h: 1 },
          { papel: 'portal', x: 2, y: 7, w: 1, h: 1, ordem: 0 },
          { papel: 'portal_mureta', x: 1, y: 7, w: 1, h: 1, ordem: 0 }, { papel: 'portal_mureta', x: 3, y: 7, w: 1, h: 1, ordem: 0 },
          { papel: 'portal', x: 6, y: 4, w: 1, h: 1, ordem: 1 },
          { papel: 'portal_mureta', x: 5, y: 4, w: 1, h: 1, ordem: 1 }, { papel: 'portal_mureta', x: 7, y: 4, w: 1, h: 1, ordem: 1 },
          { papel: 'portal', x: 10, y: 2, w: 1, h: 1, ordem: 2 },
          { papel: 'portal_mureta', x: 9, y: 2, w: 1, h: 1, ordem: 2 }, { papel: 'portal_mureta', x: 11, y: 2, w: 1, h: 1, ordem: 2 },
          { papel: 'portal', x: 16, y: 2, w: 1, h: 1, ordem: 3 },
          { papel: 'portal_mureta', x: 15, y: 2, w: 1, h: 1, ordem: 3 }, { papel: 'portal_mureta', x: 17, y: 2, w: 1, h: 1, ordem: 3 },
          { papel: 'portal', x: 20, y: 4, w: 1, h: 1, ordem: 4 },
          { papel: 'portal_mureta', x: 19, y: 4, w: 1, h: 1, ordem: 4 }, { papel: 'portal_mureta', x: 21, y: 4, w: 1, h: 1, ordem: 4 },
          { papel: 'portal', x: 24, y: 7, w: 1, h: 1, ordem: 5 },
          { papel: 'portal_mureta', x: 23, y: 7, w: 1, h: 1, ordem: 5 }, { papel: 'portal_mureta', x: 25, y: 7, w: 1, h: 1, ordem: 5 },
          { papel: 'arena', x: 2, y: 11, w: 2, h: 4 },
          { papel: 'sede', x: 23, y: 11, w: 2, h: 4 },
          { papel: 'poco', x: 6, y: 17, w: 1, h: 1 },
          { papel: 'forja', x: 9, y: 19, w: 2, h: 1 },
          { papel: 'loteria', x: 12, y: 20, w: 3, h: 1 },
          { papel: 'mercado', x: 16, y: 19, w: 2, h: 1 },
          { papel: 'banco', x: 20, y: 17, w: 1, h: 2 },
          { papel: 'banco_praca', x: 8, y: 10, w: 1, h: 1 }, { papel: 'banco_praca', x: 8, y: 12, w: 1, h: 1 },
          { papel: 'banco_praca', x: 18, y: 10, w: 1, h: 1 }, { papel: 'banco_praca', x: 18, y: 12, w: 1, h: 1 },
          { papel: 'banco_praca', x: 13, y: 6, w: 1, h: 1 }, { papel: 'banco_praca', x: 13, y: 16, w: 1, h: 1 }
        ]
      }
    ]
  },
  {
    /* O SALÃO DA SEDE (14/09, a guerra de guilda 2×2 do dono: "a guerra de guild que é 2x2 de cada guild é na
     * sede de guild, isso dá pontos de experiência para guild"). 25×19 fechado por paredes, porta ao sul, trono e
     * estandartes ao norte, duas fileiras de pilares e as armaduras (altos), a mesa do conselho, bancos, estátuas
     * e baús (baixos), lareiras nas paredes. Simétrico pelo centro: a guilda A nasce a oeste, a B a leste, 4 casas
     * de cada (dois jogadores com a dupla). */
    id: 'sede',
    name: 'O Salão da Sede',
    theme: 'sede',
    palette: {
      primary: '#7a5a3a', secondary: '#4a3526', accent: '#ffd76b',
      floor1: '#5b4633', floor2: '#634c37', wall: '#3e2f22', lowWall: '#6b5238', voidColor: '#1e1712'
    },
    defaultWeather: 'calmo',
    weatherShiftEveryRounds: 0,
    tileEventRate: 0,
    rooms: [
      {
        name: 'O Salão do Conselho',
        weather: 'calmo',
        sceneryTheme: 'sede',
        layout: [
          '#########################',
          '#......#...###...#......#',
          '#..=........=........=..#',
          '#.......................#',
          '#....#......#......#....#',
          '#........=.....=........#',
          '#.P...................a.#',
          '#......=................#',
          '##.P......=====......a.##',
          '##...#....=====....#...##',
          '##.P......=====......a.##',
          '#................=......#',
          '#.P...................a.#',
          '#........=.....=........#',
          '#....#......#......#....#',
          '#.......................#',
          '#..=........=........=..#',
          '#.......................#',
          '###########~~~###########'
        ],
        monsters: {},
        pecas: [
          {papel: 'parede_salao', x: 0, y: 0, w: 25, h: 19},
          {papel: 'trono', x: 11, y: 1, w: 3, h: 1},
          {papel: 'estandarte', x: 7, y: 1, w: 1, h: 1},
          {papel: 'estandarte', x: 17, y: 1, w: 1, h: 1},
          {papel: 'pilar', x: 5, y: 4, w: 1, h: 1},
          {papel: 'pilar', x: 5, y: 9, w: 1, h: 1},
          {papel: 'pilar', x: 5, y: 14, w: 1, h: 1},
          {papel: 'pilar', x: 19, y: 4, w: 1, h: 1},
          {papel: 'pilar', x: 19, y: 9, w: 1, h: 1},
          {papel: 'pilar', x: 19, y: 14, w: 1, h: 1},
          {papel: 'mesa', x: 10, y: 8, w: 5, h: 3},
          {papel: 'banco_salao', x: 9, y: 5, w: 1, h: 1},
          {papel: 'banco_salao', x: 15, y: 5, w: 1, h: 1},
          {papel: 'banco_salao', x: 9, y: 13, w: 1, h: 1},
          {papel: 'banco_salao', x: 15, y: 13, w: 1, h: 1},
          {papel: 'lareira', x: 1, y: 8, w: 1, h: 3},
          {papel: 'lareira', x: 23, y: 8, w: 1, h: 3},
          {papel: 'bau', x: 3, y: 16, w: 1, h: 1},
          {papel: 'bau', x: 21, y: 16, w: 1, h: 1},
          {papel: 'bau', x: 3, y: 2, w: 1, h: 1},
          {papel: 'bau', x: 21, y: 2, w: 1, h: 1},
          {papel: 'armadura', x: 12, y: 4, w: 1, h: 1},
          {papel: 'armadura', x: 12, y: 14, w: 1, h: 1},
          {papel: 'estatua', x: 7, y: 7, w: 1, h: 1},
          {papel: 'estatua', x: 17, y: 11, w: 1, h: 1},
          {papel: 'bau', x: 12, y: 2, w: 1, h: 1},
          {papel: 'bau', x: 12, y: 16, w: 1, h: 1}
        ]
      }
    ]
  }
];

/* o mapa de luta pelo id (null se não existe) */
JOGO.DATA.arena = function (id) {
  var l = JOGO.DATA.arenas || [];
  for (var i = 0; i < l.length; i++) if (l[i] && l[i].id === id) return l[i];
  return null;
};
