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
          '=..........................',
          '#....P.....=...=.....a.....',
          '=.......=...###...=........',
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
          // 19/09: o portão do Campo de PvP, na coluna da borda oeste, entre o portal 0 e a
          // Arena — a ordem norte→sul que a praça 3D tem (portal 0 → portão → Arena → Poço →
          // Forja). As muretas no MESMO x: o arco gira 90° e encara o leste (o meio), como o
          // portão 3D encara a Árvore. A grade é um ESQUEMA e não cresceu com a praça (58 m):
          // mudar a grade mudaria as distâncias do duelo e o enquadramento provado.
          { papel: 'portal_campo', x: 0, y: 9, w: 1, h: 1, ordem: 'campo' },
          { papel: 'portal_mureta', x: 0, y: 8, w: 1, h: 1, ordem: 'campo' }, { papel: 'portal_mureta', x: 0, y: 10, w: 1, h: 1, ordem: 'campo' },
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
     * sede de guild"). 04/10, o dono, vendo o salão com a arte dele: "como é um salão de guild acho que os pilares
     * deviam ficar mais organizados". O desenho de 19/09 ("A Arena do Trono") espalhava 42 pilares para que
     * nenhuma reta de visão passasse de 9 casas; cumpria a régua e lia como pilar jogado no chão. Este é um SALÃO:
     *   · duas COLUNATAS de oito pilares, em y=4 e y=14, de parede a parede, abertas no tapete (x 11..13);
     *   · duas colunatas laterais em x=7 e x=17 (y 4..14, uma casa sim, uma não), que fecham cada ala — em x=6/x=18
     *     o pilar de (18,12) tapava da câmera os pés de (20,11), o primeiro passo de quem nasce em (21,11);
     *   · a mesa do conselho 3×3 no centro com um pilar em cada quina, alinhado aos pilares de x=9/x=15;
     *   · o que é mobília encosta na parede: cavaletes de armas e estátuas ao norte, bancos nas galerias,
     *     lareira, banco e baús na ala de cada guilda, as duas armaduras guardando a porta, os troféus no sul.
     * O QUE SE PAGOU: a régua "reta de visão ≤ 9" saiu — entre duas colunatas a galeria é uma reta de 23. O que
     * ela protegia continua medido por tests/prova_sede_tatica.html e passa neste desenho: nenhum dos 16 pares de
     * nascimento se vê, 5+ caminhos disjuntos entre os lados, 14–24% de obstáculo, espelho oeste/leste, cobertura
     * baixa a 2 casas de cada nascimento e a robustez a muro invocado (nenhuma conjuração abaixo do nível 30
     * derruba o fluxo abaixo de 3; nenhum par de nível ≤ 10 sela um lado). Reta comprida além do alcance dos
     * feitiços não dá tiro a ninguém; dá leitura de salão.
     * NASCIMENTOS, como antes: duplas verticais em (3,7)/(3,8) e (3,10)/(3,11), e o espelho em x=21. */
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
        name: 'A Arena do Trono',
        weather: 'calmo',
        sceneryTheme: 'sede',
        layout: [
          '#########################',
          '#=.#...#...###...#...#.=#',
          '#....=..#.......#..=....#',
          '#.......................#',
          '#..#.#.#.#.....#.#.#.#..#',
          '#.......................#',
          '#......#.........#......#',
          '#=.P.....#.....#.....a.=#',
          '##.P...#...===...#...a.##',
          '##=........===........=##',
          '##.P...#...===...#...a.##',
          '#=.P.....#.....#.....a.=#',
          '#......#.........#......#',
          '#.......................#',
          '#..#.#.#.#.....#.#.#.#..#',
          '#.......................#',
          '#....=....#...#....=....#',
          '#=.....................=#',
          '###########~~~###########'
        ],
        monsters: {},
        pecas: [
          // 04/10: tirado do desenho acima — colunatas em y=4/y=14 e x=7/x=17, mobília na parede
          {papel: 'parede_salao', x: 0, y: 0, w: 25, h: 19}, {papel: 'trono', x: 11, y: 1, w: 3, h: 1}, {papel: 'mesa', x: 11, y: 8, w: 3, h: 3},
          {papel: 'lareira', x: 1, y: 8, w: 1, h: 3}, {papel: 'lareira', x: 23, y: 8, w: 1, h: 3}, {papel: 'estatua', x: 1, y: 1, w: 1, h: 1},
          {papel: 'pilar', x: 3, y: 1, w: 1, h: 1, arte: 'rack_armas'}, {papel: 'estandarte', x: 7, y: 1, w: 1, h: 1}, {papel: 'estandarte', x: 17, y: 1, w: 1, h: 1},
          {papel: 'pilar', x: 21, y: 1, w: 1, h: 1, arte: 'rack_armas'}, {papel: 'estatua', x: 23, y: 1, w: 1, h: 1}, {papel: 'banco_salao', x: 5, y: 2, w: 1, h: 1},
          {papel: 'estandarte', x: 8, y: 2, w: 1, h: 1}, {papel: 'estandarte', x: 16, y: 2, w: 1, h: 1}, {papel: 'banco_salao', x: 19, y: 2, w: 1, h: 1},
          {papel: 'pilar', x: 3, y: 4, w: 1, h: 1}, {papel: 'pilar', x: 5, y: 4, w: 1, h: 1}, {papel: 'pilar', x: 7, y: 4, w: 1, h: 1},
          {papel: 'pilar', x: 9, y: 4, w: 1, h: 1}, {papel: 'pilar', x: 15, y: 4, w: 1, h: 1}, {papel: 'pilar', x: 17, y: 4, w: 1, h: 1},
          {papel: 'pilar', x: 19, y: 4, w: 1, h: 1}, {papel: 'pilar', x: 21, y: 4, w: 1, h: 1}, {papel: 'pilar', x: 7, y: 6, w: 1, h: 1},
          {papel: 'pilar', x: 17, y: 6, w: 1, h: 1}, {papel: 'bau', x: 1, y: 7, w: 1, h: 1}, {papel: 'pilar', x: 9, y: 7, w: 1, h: 1},
          {papel: 'pilar', x: 15, y: 7, w: 1, h: 1}, {papel: 'bau', x: 23, y: 7, w: 1, h: 1}, {papel: 'pilar', x: 7, y: 8, w: 1, h: 1},
          {papel: 'pilar', x: 17, y: 8, w: 1, h: 1}, {papel: 'banco_salao', x: 2, y: 9, w: 1, h: 1}, {papel: 'banco_salao', x: 22, y: 9, w: 1, h: 1},
          {papel: 'pilar', x: 7, y: 10, w: 1, h: 1}, {papel: 'pilar', x: 17, y: 10, w: 1, h: 1}, {papel: 'bau', x: 1, y: 11, w: 1, h: 1},
          {papel: 'pilar', x: 9, y: 11, w: 1, h: 1}, {papel: 'pilar', x: 15, y: 11, w: 1, h: 1}, {papel: 'bau', x: 23, y: 11, w: 1, h: 1},
          {papel: 'pilar', x: 7, y: 12, w: 1, h: 1}, {papel: 'pilar', x: 17, y: 12, w: 1, h: 1}, {papel: 'pilar', x: 3, y: 14, w: 1, h: 1},
          {papel: 'pilar', x: 5, y: 14, w: 1, h: 1}, {papel: 'pilar', x: 7, y: 14, w: 1, h: 1}, {papel: 'pilar', x: 9, y: 14, w: 1, h: 1},
          {papel: 'pilar', x: 15, y: 14, w: 1, h: 1}, {papel: 'pilar', x: 17, y: 14, w: 1, h: 1}, {papel: 'pilar', x: 19, y: 14, w: 1, h: 1},
          {papel: 'pilar', x: 21, y: 14, w: 1, h: 1}, {papel: 'banco_salao', x: 5, y: 16, w: 1, h: 1}, {papel: 'armadura', x: 10, y: 16, w: 1, h: 1},
          {papel: 'armadura', x: 14, y: 16, w: 1, h: 1}, {papel: 'banco_salao', x: 19, y: 16, w: 1, h: 1}, {papel: 'bau', x: 1, y: 17, w: 1, h: 1, arte: 'trofeu'},
          {papel: 'bau', x: 23, y: 17, w: 1, h: 1, arte: 'trofeu'}
        ]
      }
    ]
  }
];

/* A CÂMARA DO ECO (02/10) — o único mapa daqui que NÃO é entre jogadores: a arena do chefe supremo
 * da semana (js/core/data/eco.js). Mora nesta lista pelo mesmo motivo da Praça: não é calabouço — não
 * vira portal, não empresta palco ao Poço, não entra no Calabouço do Dia nem no sorteio do PvP — e o
 * motor já procura aqui (engine.js getDungeon). `modo: 'eco'` separa dos mapas de duelo quem precisa
 * (o enquadramento de duelo do tabuleiro 3D, a wiki); a letra `e` É monstro aqui, não o lado B.
 *
 * ANATOMIA (18×18; o centro do círculo fica entre as casas 8 e 9, e o Eco ocupa 8..9 × 8..9 — a letra
 * marca o canto noroeste do corpo 2×2, as outras três casas dele são chão). Câmara CIRCULAR (raio 8,4
 * a partir do centro) sobre o vazio (`~`), com PILARES QUEBRADOS de cobertura:
 *   · quatro pares altos nos pontos cardeais a 5 passos do corpo dele — (8,3)(9,3), (3,8)(3,9),
 *     (14,8)(14,9) — e o do sul trocado por entulho BAIXO (8,14)(9,14): o lado de quem chega vê o Eco
 *     por cima da mureta e leva o −25% da cobertura, mas não fica cego;
 *   · quatro pilares altos nas diagonais a 4 passos — (6,6), (11,6), (6,11), (11,11) — que abrigam da
 *     Maré Funda (a onda de 3 a 6 passos só pega quem o núcleo VÊ);
 *   · entulho baixo na borda — (6,2)(11,2), (2,6)(15,6), (2,11)(15,11) — para quem recua.
 * Os quatro `P` ficam ao sul, a 6 ou mais passos do corpo: a preparação (30 s) escolhe entre casas
 * a 3 ou mais dele. Tudo isso passa pela régua de tests/visao_mapas.js (simetria, muro reto, fresta
 * de canto) como as outras salas. */
JOGO.DATA.arenas.push({
  id: 'camara_eco',
  name: 'A Câmara do Eco',
  modo: 'eco',
  /* 03/10: o tema era 'heart' — a Câmara vestia o kit do Coração Partido emprestado. Com a
   * arte do dono (assets/embedded/cenario-eco.js) ela tem o tema dela: a colunata partida nos
   * `#`, o entulho nos `=` e a beira do abismo em volta. SÓ a roupa mudou: a grade abaixo é a
   * mesma, casa por casa, e o tema não entra no Engine.hash (o juiz refaz a luta igual). */
  theme: 'eco',
  palette: {
    primary: '#9a7ad8', secondary: '#241f38', accent: '#ffcf6b',
    floor1: '#2b2838', floor2: '#332f44', wall: '#191624', lowWall: '#4a4160', voidColor: '#07050d'
  },
  defaultWeather: 'calmo',
  weatherCycle: ['calmo'],
  weatherShiftEveryRounds: 0,
  tileEventRate: 0,
  rooms: [
    {
      name: 'A Câmara do Eco',
      weather: 'calmo',
      sceneryTheme: 'eco',
      layout: [
        '~~~~~~~~~~~~~~~~~~',
        '~~~~~........~~~~~',
        '~~~~..=....=..~~~~',
        '~~~.....##.....~~~',
        '~~..............~~',
        '~................~',
        '~.=...#....#...=.~',
        '~................~',
        '~..#....e.....#..~',
        '~..#..........#..~',
        '~................~',
        '~.=...#....#...=.~',
        '~................~',
        '~~..............~~',
        '~~~.....==.....~~~',
        '~~~~..P....P..~~~~',
        '~~~~~..P..P..~~~~~',
        '~~~~~~~~~~~~~~~~~~'
      ],
      monsters: { e: 'eco_primordial' }
    }
  ]
});

/* o mapa de luta pelo id (null se não existe) */
JOGO.DATA.arena = function (id) {
  var l = JOGO.DATA.arenas || [];
  for (var i = 0; i < l.length; i++) if (l[i] && l[i].id === id) return l[i];
  return null;
};
