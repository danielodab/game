// O SANTUÁRIO DOS ELEMENTOS — o calabouço especial (dono: dados).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});
JOGO.DATA = JOGO.DATA || {};

/* O QUE ISTO É (03/10, o pedido do dono antes de divulgar o jogo: "um mapa dos
 * elementos; uma parte escura que só consegue ver quem é de inteligência [o
 * caminho do FOGO]; e outras ideias para os outros elementos, algo que mude no
 * mapa relacionado a elementos")
 * ============
 * Cinco salas. As quatro primeiras são um QUADRANTE cada, com UMA regra de
 * terreno e os dois monstros dele; a quinta, "O Altar dos Quatro", junta os
 * quatro quadrantes num mapa só, em volta do altar, com os oito monstros
 * misturados. Não tem chefe (não há arte de chefe, e selo, insígnia, âncora e
 * carta seguem sendo só de chefe) e não tem armadilha de chão (o dono as quis
 * no Poço).
 *
 *   Fogo   A Câmara Apagada           escuridão; braseiros acendem e apagam
 *   Água   A Galeria Alagada          casa alagada custa 2 PP; a correnteza empurra
 *   Terra  O Salão dos Pilares Vivos  pilares sobem e descem a cada 2 rodadas
 *   Ar     O Terraço da Ventania      a rajada empurra; feitiço de Ar alcança +1
 *
 * A REGRA de cada um mora em js/core/santuario.js (Santuario.regras), e o motor
 * só a chama — o mesmo desenho do chão do Poço (js/core/poco.js). O juiz
 * (servidor/juiz/motor.js) carrega os dois arquivos: a sala refeita lá chega ao
 * mesmo hash.
 *
 * POR QUE NÃO MORA EM DATA.dungeons. Tudo que lê aquela lista trata o que acha
 * lá como um dos SEIS portais: a praça ergue um portal, o Poço empresta o
 * palco, o PvP ranqueado sorteia a sala como arena, o Calabouço do Dia a
 * escolhe, a régua do mundo cobra três salas com chefe na última e a escada de
 * cartas. O Santuário não é nada disso — é um calabouço ESPECIAL, com porta
 * própria no cais (como o Eco) e regra própria. Ele mora em DATA.especiais, no
 * MESMO formato de um calabouço, e quem precisa achá-lo pelo id usa
 * DATA.calabouco(id), que olha as duas listas (o motor, o jogo, o juiz, a
 * tela). Quem enumera os seis portais continua enumerando seis.
 *
 * O `mapa` de cada sala é uma MÁSCARA do mesmo tamanho do `layout`: um
 * caractere por casa, dizendo o que a casa é para a REGRA (o layout continua na
 * legenda de sempre, para toda régua e toda ferramenta que lê salas):
 *   B  braseiro ACESO      b  braseiro APAGADO        (a casa do layout é '=')
 *   a  casa ALAGADA        p  PONTE (seca, dentro da água)
 *   N S L O  BICA — a letra é para onde a correnteza DELA corre (a casa é '#')
 *   V  pilar vivo que começa DE PÉ (a casa é '#')
 *   v  pilar vivo que começa BAIXO, no soquete (a casa é chão)
 *   r  RESPIRO de vento (a casa é '='): as quatro casas de lado dele são CALMAS
 *   C  CATA-VENTO (a casa é '#'): gira para onde a rajada sopra
 *   M  o ALTAR dos Quatro (as casas são '#'): só para o desenho
 *   .  nada
 * As ZONAS do escuro e do vento são retângulos [x0, y0, x1, y1] (com as pontas).
 *
 * `regioes` é dado de APARÊNCIA (o motor e o juiz não leem): diz ao desenho de
 * que quadrante é cada casa — [{ x, y, w, h, elemento }], o formato que o
 * renderizador usa para escolher o muro e os enfeites de cada pedra (o basalto
 * do Fogo, a pedra azul da Água, o arenito da Terra, o mármore do Ar; ver
 * `regioes` no catálogo JOGO.CENARIO['santuario']). Na sala de um quadrante só
 * é a sala inteira; no Altar, uma por canto, estendida até a parede de fora
 * para a moldura da sala vestir a pedra do canto dela.
 *
 * OS NÚMEROS (DATA.santuario) são ponto de partida, medidos em
 * tests/santuario_regras.js. O juiz lê este MESMO arquivo: mudar um número
 * daqui muda o fim de uma sala refeita e sobe Engine.VERSAO_REGRAS. */
(function (DATA) {
  'use strict';

  DATA.santuario = {
    id: 'elementsanctum',
    // FOGO — quem não enxerga no escuro só vê (e só mira) o que está numa casa
    // escura a até `visao` casas; o braseiro aceso clareia `raio` casas em volta
    escuro: { visao: 2, raio: 2 },
    // ÁGUA — o passo que ENTRA numa casa alagada custa `custo` PP (`custoAgua`
    // para quem é de Água); a correnteza empurra 1 casa no fim da rodada e
    // troca de bica a cada `trocaACada` rodadas
    agua: { custo: 2, custoAgua: 1, trocaACada: 2 },
    // TERRA — os pilares trocam de posição no começo de cada rodada ímpar a
    // partir da 3ª (a cada `periodo` rodadas), avisados no começo da anterior
    pilares: { periodo: 2 },
    // AR — a rajada empurra 1 casa no fim da rodada e gira (norte → leste →
    // sul → oeste) a cada `giraACada` rodadas; feitiço de Ar lançado de dentro
    // da zona ganha `alcance` casas
    vento: { giraACada: 2, alcance: 1, ordem: ['n', 'l', 's', 'o'] }
  };

  DATA.especiais = DATA.especiais || [];
  DATA.especiais.push({
    id: 'elementsanctum',
    name: 'O Santuário dos Elementos',
    especial: true,
    theme: 'santuario',
    // enquanto o kit de arte do Santuário (JOGO.CENARIO['santuario']) não
    // estiver embutido, a sala veste o do Coração Partido: é o cenário que já
    // fala de quatro elementos (coluna dos quatro, bacia elemental)
    temaReserva: 'heart',
    description: 'Antes de o mundo ser enterrado, os quatro elementos eram ensinados aqui, cada um na sua sala: a ' +
      'câmara onde só a brasa enxerga, a galeria que a maré enche e esvazia, o salão dos pilares que andam e o ' +
      'terraço onde o vento não para. O santuário continua dando a mesma aula — agora a quem desce, e sem perguntar ' +
      'se a pessoa quer aprender.',
    // o fim de jogo: assume o herói no teto (30), item evoluído e conjunto fechado
    recommendedLevel: 30,
    difficulty: 7,
    palette: {
      primary: '#c9a25a', secondary: '#2b2a33', accent: '#ffd98a',
      floor1: '#34333c', floor2: '#3d3b46', wall: '#22212a', lowWall: '#575260', voidColor: '#0a090e'
    },
    defaultWeather: 'calmo',
    weatherCycle: ['calmo'],       // o clima aqui é a regra da sala: nada de chuva sorteada por cima
    weatherShiftEveryRounds: 0,
    tileEventRate: 0,              // sem evento de chão ao acaso: o chão do Santuário já tem dono
    // sem chefe não há carta (lista vazia = decisão, não dado faltando: Progress.rollCards)
    cardDrops: [],
    // O SAQUE é o do Coração Partido (as mesmas peças, com o mesmo peso de
    // "nada"): o Santuário é o outro calabouço do fim do jogo, não uma faixa
    // nova de item. As quatro salas de quadrante sorteiam como sala comum do
    // Coração; o Altar, como a do chefe (dois sorteios, épico e lendário). O
    // que ele paga A MAIS é pedra do elemento de cada quadrante (monsters.js).
    saqueDe: 'brokenheart',
    rooms: [
      // ------------------------------------------------------------------ FOGO
      {
        name: 'A Câmara Apagada',
        weather: 'calmo',
        sceneryTheme: 'santuario',
        layout: [
          '~~~~###############~~~~',
          '~~~#.......#.......#~~~',
          '~~#....=...#........#~~',
          '~#.......=......=....#~',
          '#..................a..#',
          '#......##...##...##...#',
          '#...=.............=...#',
          '#.....b.....=..#......#',
          '#PP.......#.........#.#',
          '#PP...=....b..=b.a..=a#',
          '#PP.......#.........#.#',
          '#.....b.....=..#......#',
          '#...=.............=...#',
          '#......##...##...##...#',
          '#..................a..#',
          '~#.......=......=....#~',
          '~~#....=...#........#~~',
          '~~~#.......#.......#~~~',
          '~~~~###############~~~~'
        ],
        monsters: { a: 'el_fogo_1', b: 'el_fogo_2' },
        regioes: [{ x: 0, y: 0, w: 23, h: 19, elemento: 'fogo' }],
        santuario: {
          regra: 'fogo',
          // a entrada (as cinco primeiras colunas) tem luz; dali para dentro é breu. Três braseiros
          // já nascem acesos: os dois da entrada e o do MEIO da câmara — é ele que ensina, de longe,
          // o que a luz faz (a poça clara no escuro, e o monstro que aparece nela)
          escuro: [[6, 0, 22, 18]],
          mapa: [
            '.......................',
            '.......................',
            '.......................',
            '.........b.............',
            '.......................',
            '.......................',
            '....B.............b....',
            '.......................',
            '.......................',
            '..............B........',
            '.......................',
            '.......................',
            '....B.............b....',
            '.......................',
            '.......................',
            '.........b.............',
            '.......................',
            '.......................',
            '.......................'
          ]
        }
      },
      // ------------------------------------------------------------------ ÁGUA
      {
        name: 'A Galeria Alagada',
        weather: 'calmo',
        sceneryTheme: 'santuario',
        layout: [
          '~~~~#################~~~~',
          '~~~#.................#~~~',
          '~~#....=.........=....#~~',
          '~#.....=.........=.....#~',
          '#......#....#....=......#',
          '#..#...=..#...#..=b.#...#',
          '#...................#...#',
          '#........#...........b..#',
          '#PP..=......=.........#.#',
          '#PP...a.....a...a..=..b.#',
          '#PP..=......=.........#.#',
          '#..............#.....b..#',
          '#...................#...#',
          '#..#...=..#...#..=b.#...#',
          '#......=....#....#......#',
          '~#.....=.........=.....#~',
          '~~#....=.........=....#~~',
          '~~~#.................#~~~',
          '~~~~#################~~~~'
        ],
        monsters: { a: 'el_agua_1', b: 'el_agua_2' },
        regioes: [{ x: 0, y: 0, w: 25, h: 19, elemento: 'agua' }],
        santuario: {
          regra: 'agua',
          mapa: [
            '.........................',
            '.........................',
            '........aaaaaaaaa........',
            '........aaaaaaaaa........',
            '.......Laaaa.aaaa........',
            '........aa.aaa.aa........',
            '........aaaaaaaaa........',
            '........a.aaaaaaa........',
            '........aaa...aaa........',
            '........ppp...ppp........',
            '........aaa...aaa........',
            '........aaaaaaa.a........',
            '........aaaaaaaaa........',
            '........aa.aaa.aa........',
            '........aaaa.aaaaO.......',
            '........aaaaaaaaa........',
            '........aaaaaaaaa........',
            '.........................',
            '.........................'
          ]
        }
      },
      // ----------------------------------------------------------------- TERRA
      {
        name: 'O Salão dos Pilares Vivos',
        weather: 'calmo',
        sceneryTheme: 'santuario',
        layout: [
          '~~~~#################~~~~',
          '~~~#.....#.....#.....#~~~',
          '~~#......#.....#......#~~',
          '~#.......#.....#.......#~',
          '#........#.b............#',
          '#..=.#...#..............#',
          '#....#...#.........=....#',
          '#........#.....#...#....#',
          '#.....b..#.....#...#....#',
          '#PP......=..a..=........#',
          '#PP...=.....=....b=..a..#',
          '#PP......=..a..=........#',
          '#.....b..#..#..#........#',
          '#........#..#..#........#',
          '#..............#...=....#',
          '#..=...........#........#',
          '#..........b...#........#',
          '~#.......#.....#.......#~',
          '~~#......#.....#......#~~',
          '~~~#.....#.....#.....#~~~',
          '~~~~#################~~~~'
        ],
        monsters: { a: 'el_terra_1', b: 'el_terra_2' },
        regioes: [{ x: 0, y: 0, w: 25, h: 21, elemento: 'terra' }],
        santuario: {
          regra: 'terra',
          mapa: [
            '.........................',
            '.........................',
            '.........................',
            '.........................',
            '.........V.....v.........',
            '.....V...V.....v.........',
            '.....V...V.....v.........',
            '............v......V.....',
            '............v......V.....',
            '.........................',
            '.........................',
            '.........................',
            '............V......v.....',
            '............V......v.....',
            '.....v...v.....V.........',
            '.....v...v.....V.........',
            '.........v.....V.........',
            '.........................',
            '.........................',
            '.........................',
            '.........................'
          ]
        }
      },
      // -------------------------------------------------------------------- AR
      {
        name: 'O Terraço da Ventania',
        weather: 'calmo',
        sceneryTheme: 'santuario',
        layout: [
          '~~~~###################~~~~',
          '~~~#...................#~~~',
          '~~#.......#.....#.......#~~',
          '~#.........=====.........#~',
          '#.....##............##....#',
          '#............#..b.........#',
          '#.......=a........=a......#',
          '#....=....................#',
          '#....=....#.....#....#....#',
          '#PP...b..............#....#',
          '#PP.....#...###...##......#',
          '#PP...b..............#....#',
          '#....=....#.....#....#....#',
          '#....=....................#',
          '#.......=a........=a......#',
          '#............#..b.........#',
          '#.....##............##....#',
          '~#.........=====.........#~',
          '~~#.......#.....#.......#~~',
          '~~~#...................#~~~',
          '~~~~###################~~~~'
        ],
        monsters: { a: 'el_ar_1', b: 'el_ar_2' },
        regioes: [{ x: 0, y: 0, w: 27, h: 21, elemento: 'ar' }],
        santuario: {
          regra: 'ar',
          // o pórtico da entrada (as quatro primeiras colunas) fica ao abrigo; o resto é terraço
          vento: [[5, 0, 26, 20]],
          ventoInicial: 'l',
          mapa: [
            '...........................',
            '...........................',
            '...........................',
            '...........................',
            '...........................',
            '...........................',
            '........r.........r........',
            '...........................',
            '...........................',
            '...........................',
            '.............C.............',
            '...........................',
            '...........................',
            '...........................',
            '........r.........r........',
            '...........................',
            '...........................',
            '...........................',
            '...........................',
            '...........................',
            '...........................'
          ]
        }
      },
      // ----------------------------------------------------------------- ALTAR
      {
        name: 'O Altar dos Quatro',
        weather: 'calmo',
        sceneryTheme: 'santuario',
        layout: [
          '~~~~###################~~~~',
          '~~~#.................#.#~~~',
          '~~#...#..b..............#~~',
          '~#....#....#...#.........#~',
          '#....a.....#...#..#.c.....#',
          '#...=.....................#',
          '#..........=...=......#..##',
          '#..#f......=...=..........#',
          '#.......=..........h....d.#',
          '#...##..==.......==..##...#',
          '#PP.........###...........#',
          '#PP.........###...........#',
          '#PP.........###...........#',
          '#...##..==.......==..##...#',
          '#..b...............d......#',
          '#..........=...=..=.......#',
          '#...###.e..=...=......#...#',
          '#...................#.....#',
          '#..........#...#..#....g..#',
          '~#.........#...#.....=...#~',
          '~~#.....................#~~',
          '~~~#...................#~~~',
          '~~~~###################~~~~'
        ],
        monsters: {
          a: 'el_fogo_1', b: 'el_fogo_2', c: 'el_agua_1', d: 'el_agua_2',
          e: 'el_terra_1', f: 'el_terra_2', g: 'el_ar_1', h: 'el_ar_2'
        },
        // cada canto veste a pedra dele até a parede de fora; a cruz do meio (a coluna 13 e a
        // linha 11, o corredor do altar) fica sem região: lá não há muro para vestir
        regioes: [
          { x: 0, y: 0, w: 13, h: 11, elemento: 'fogo' }, { x: 14, y: 0, w: 13, h: 11, elemento: 'agua' },
          { x: 0, y: 12, w: 13, h: 11, elemento: 'terra' }, { x: 14, y: 12, w: 13, h: 11, elemento: 'ar' }
        ],
        santuario: {
          regra: 'altar',
          // os quatro quadrantes em volta do cruzeiro do altar: Fogo a noroeste,
          // Água a nordeste, Terra a sudoeste, Ar a sudeste
          quadrantes: { fogo: [1, 1, 11, 9], agua: [15, 1, 25, 9], terra: [1, 13, 11, 21], ar: [15, 13, 25, 21] },
          escuro: [[1, 1, 11, 9]],
          vento: [[15, 13, 25, 21]],
          ventoInicial: 'n',
          mapa: [
            '...........................',
            '.....................S.....',
            '.................aaapaaa...',
            '.................aaapaaaa..',
            '.................a.apaaaa..',
            '....b............aaapaaaa..',
            '.................aaapa.aaO.',
            '.................aaapaaaa..',
            '........B..................',
            '...........................',
            '............MMM............',
            '............MMM............',
            '............MMM............',
            '...........................',
            '...........................',
            '..................r........',
            '....VVV....................',
            '....................C......',
            '.......vvv.................',
            '.....................r.....',
            '...........................',
            '...........................',
            '...........................'
          ]
        }
      }
    ]
  });

  /* OS NOMES VISUAIS do tema (DATA.scenery, como os dos seis calabouços em dungeons.js): o que
   * a sala mostra no lugar de "parede" e "mureta", para quem escreve sobre ela (a wiki, a régua
   * do mundo). As peças de verdade estão no catálogo JOGO.CENARIO['santuario']. */
  DATA.scenery = DATA.scenery || {};
  DATA.scenery.santuario = {
    high: ['muro de basalto com o símbolo da chama', 'muro de pedra azul com o símbolo da onda',
           'muro de arenito com musgo e raiz', 'muro de mármore claro com respiros',
           'pilar vivo de granito', 'estátua vendada com a lanterna fria'],
    low: ['mureta de basalto', 'mureta de pedra azul molhada', 'mureta de arenito', 'mureta de mármore',
          'braseiro de tripé', 'respiro de vento', 'degrau do altar'],
    floor: ['laje de santuário', 'casa alagada', 'ponte de laje sobre a água', 'soquete do pilar vivo'],
    props: ['bica de carranca', 'cata-vento de bronze', 'coluna da maré', 'menir com cristais', 'coluna de mármore gasta pelo vento']
  };

  /* o calabouço especial pelo id (null se não existe) */
  DATA.especial = function (id) {
    var l = DATA.especiais || [];
    for (var i = 0; i < l.length; i++) if (l[i] && l[i].id === id) return l[i];
    return null;
  };
  /* QUALQUER calabouço em que se desce pelo id: um dos seis portais (o Poço
   * incluído, quando já foi montado) ou um especial. Quem só quer os seis
   * continua lendo DATA.dungeons. */
  DATA.calabouco = function (id) {
    var ds = DATA.dungeons || [];
    for (var i = 0; i < ds.length; i++) if (ds[i] && ds[i].id === id) return ds[i];
    return DATA.especial(id);
  };
})(JOGO.DATA);
