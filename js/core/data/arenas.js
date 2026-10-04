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
     * sede de guild, isso dá pontos de experiência para guild"). 19/09, o dono: "melhore o mapa e deixe bem
     * estratégico" — este é o desenho "A Arena do Trono", escolhido por unanimidade por três juízes (tática,
     * jogabilidade, arte) entre três propostas, com os enxertos deles que passaram na régua. O mapa de antes
     * (duas fileiras de pilares) tinha os 16 pares de nascimento com visão direta, retas de 23 casas e 11,8% de
     * obstáculo; este tem 0 pares, nenhuma reta acima de 9 e 21%. Tudo abaixo foi MEDIDO no motor do juiz
     * (Engine.createDuelSala + Engine.los) e tests/prova_sede_tatica.html refaz as contas dentro da página.
     *
     * ANATOMIA (x,y; 0,0 no canto noroeste; 25×19, porta ao sul, trono ao norte). Simetria por ESPELHO oeste/leste
     * — com porta e trono nos extremos, girar 180° é impossível, então o lado A (oeste, `P`) tem casa a casa o que
     * o lado B (leste, `a`) tem. Três faixas:
     *   · NORTE, a sala do trono (x 9..15, y 2..4) entre os umbrais (8,2)/(16,2) — os ESTANDARTES com a cor de
     *     cada guilda (o tabuleiro pinta pelo lado: cx < centro é a guilda do oeste) — e os pilares (8,3)/(16,3);
     *     o pilar do tapete (12,4) e, logo abaixo, o NICHO DO EIXO (12,5) fechado por (11,5)/(13,5): o "rei da
     *     colina", equidistante dos dois lados (11-15 casas a pé), coberto por três lados, enxerga a mesa a 3.
     *     Nas galerias dos cantos, a estátua do fundador (1,1)/(23,1) e o banco (7,3)/(17,3).
     *   · CENTRO, a arena: a mesa do conselho 3×3 (11..13, 8..10) com quatro pilares nas quinas diagonais
     *     (10,7) (14,7) (10,11) (14,11) e um CHEVRON de três pilares de cada lado — (8,8) (9,9) (8,10) e o
     *     espelho — que fecha a mesa para oeste e para leste. A mesa fica exposta só por norte e sul: as faixas
     *     y=6 e y=12 (x 8..16) são as únicas retas de 9 casas do mapa, o "miolo perigoso". Entre o chevron e a
     *     mesa, um BOLSO (9..10, 8..10) com entrada de 1 casa ao norte (9,7) e ao sul (9,11), e a passagem de
     *     1 casa (10,9) entre o chevron e a mesa; atrás do chevron, o NINHO (8,9) vira as costas para a arena e
     *     só bate em quem entra pela boca da própria ala — a âncora de recuo.
     *   · SUL, o átrio da porta, espelho da sala do trono: umbrais (8,15)/(16,15) e armaduras (8,16)/(16,16),
     *     bancos (7,15)/(17,15), a guarda da porta (10,17)/(14,17) e os baús nos cantos (1,17)/(23,17).
     *   · AS ALAS: cada guilda nasce junto à parede (x 1..4, y 6..12) com a lareira (1, 8..10) e o banco
     *     diante do fogo (2,9); colunatas de três peças em y=5 e y=13 fecham a ala para as galerias
     *     (colunata encostada é '#' contínuo — não se passa nem se vê): a do norte é pilar, ARMADURA, pilar
     *     (a armadura do meio, (3,5)/(21,5), é o enxerto do juiz de arte para a fileira não ler como vão
     *     entre pilares) e a do sul são três pilares — a armadura em (3,13) tapava da câmera os pés de (4,11),
     *     o primeiro passo do nascimento (3,11). Sobram o PORTÃO de 1 casa colado à parede, (1,5) e (1,13), e
     *     a BOCA de 4 casas para a sala do trono (5..8, 5); a boca para a arena (x=5, y 6..12) tem o pilar
     *     (6,9) no meio; os pilares (5,4) e (5,14) guardam as esquinas norte e sul da boca.
     *
     * NASCIMENTOS. Duplas VERTICAIS: o jogador 1 de A em (3,7)/(3,8), o 2 em (3,10)/(3,11) — adjacentes, a
     * fusão sai já no turno 1; as quatro casas de B empatam na distância, então o desempate do createDuelSala
     * (y, depois x) mantém as duplas de B juntas também: (21,7)/(21,8) e (21,10)/(21,11). Os baús (1,7)/(1,11) e
     * o banco (2,9) ficam a EXATAMENTE 2 casas de cada nascimento: seguram a carga do corpo a corpo sem prender
     * ninguém e sem tapar a mira. Nenhum nascimento enxerga nenhum nascimento inimigo (0 dos 16 pares, medido
     * nos dois sentidos do Engine.los, que é Bresenham e não é simétrico). 18 de Manhattan e 20 a pé entre
     * inimigos: contato no fim da 2ª rodada, na arena.
     *
     * TRÊS ROTAS entre as alas, cada uma com gargalo: (1) NORTE, pela sala do trono — portão (1,5) ou boca
     * (5..8,5), entrada (8,4)/(8,5), saída sul por (9..10,5) — a rota de quem quer o nicho do eixo e flanquear a
     * mesa por cima; (2) MEIO, pela arena — a boca da ala, a faixa y=6 ou y=12 entre as quinas (7,6)/(17,6), e o
     * bolso pelos portões de 1 casa; (3) SUL, pelo átrio, espelho da norte. Gargalos de 1 casa: (1,5) (23,5)
     * (1,13) (23,13) (10,9) (14,9) (8,17) (16,17). Seis caminhos disjuntos entre os lados (fluxo 6): uma dupla
     * não fecha o mapa sozinha.
     *
     * ROBUSTEZ A MURO INVOCADO, medida com TODOS os muros do jogo — os 13 feitiços de classe (DATA.spells com
     * efeito 'wall', o Minotauro) E os 24 de FUSÃO (Fusion.spellsFor por dupla de DATA.fusionForms: as seis
     * duplas com Minotauro, verbo BARRAR — a rodada anterior lia só a classe e afirmava mais do que valia), as
     * casas pelo Engine.aoeTiles no estado da sala (a linha para no muro; anel, cruz e círculo só onde o centro
     * enxerga). Nove formas: 1 casa (nível 0), círculo r1 (5, Parapeito Abissal), anel r1 (5, Borda Abissal),
     * 3 em linha (10, Beco Abissal; 15 na classe), anel r2 (12, Redoma Abissal — em si mesmo; 20 Bastião e
     * Anfiteatro; 30 na classe), cruz 1 (12, Ameia Abissal), cruz 2 (30, O Labirinto e Dédalo Abissal) e
     * círculo r3 (30, Vulcão Abissal, 15-18 casas). 2353 conjurações distintas fora dos nascimentos; o fluxo
     * depois de UMA: 0 ×2, 2 ×8, 3 ×110, 4 ×429, 5 ×1047, 6 ×757. NENHUMA conjuração de nível < 30 derruba o
     * fluxo abaixo de 3 (a pior: o anel r1 em (9,5), a saída sul da sala do trono, deixa 3). Só o círculo r3
     * de nível 30 (Vulcão Abissal, bruxo+minotauro, 2 turnos) sela SOZINHO, centrado no meio do berço, (3,9)
     * ou (21,9): 15 muros em volta das quatro casas de nascimento (a 1 casa do centro deixa 2). Isso é do jogo,
     * não do mapa — 15 muros fecham qualquer berço de fluxo 6. PARES, varridos por inteiro (2,77 milhões; a
     * poda k — um muro de k casas tira no máximo k do fluxo — e o filtro dos caminhos disjuntos do próprio
     * fluxo, que é condição necessária, deixam 2.618 para o BFS): NENHUM par de nível ≤ 10 sela; 2142 selam e
     * TODO um deles leva um anel r2, uma cruz 2 ou um círculo r3. Dos 2142, 114 não têm ninguém de nível 30 —
     * todos com a Redoma Abissal (bruxo+minotauro nível 12, anel r2 em si mesmo, 3 turnos) no átrio, (9..10,14)
     * ou o espelho, mais, na saída sul da sala do trono, a Borda (anel r1 nível 5) ou o Parapeito (círculo r1
     * nível 5) em (9,5), ou o Beco (3 em linha nível 10) em (9,4)-(9,6), 8 pares cada; ou duas Redomas (90:
     * uma no átrio e a outra na boca da ala ou dentro do berço). Esse selo dura 2 turnos (a Borda, o Parapeito
     * e o Beco caem antes da Redoma) ou 3 (duas Redomas) e exige dois fundidos do mesmo lado — um deles preso
     * no próprio anel. Os 2028 restantes levam um nível 30: círculo r3 + qualquer coisa (1852), cruz 2 + anel
     * r2 (112), cruz 2 + cruz 2 (40), cruz 2 + Borda/Parapeito/Beco (24). Na classe (Minotauro sozinho) vale o
     * de antes: nenhum par de nível ≤ 15 sela; o mais barato é Muralha/Dique/Cerca (nível 15) em (9,4)-(9,6) —
     * conjurada de (9,1..3) mirando (9,4), ou de (9,7)/(9,8) mirando (9,6) — mais anel r2 (nível 30) em (10,14).
     * É a jogada do invocador, aceita: 12 variantes de peça medidas para desfazer o selo abriam reta > 9 ou
     * visão entre nascimentos. tests/prova_sede_tatica.html refaz a varredura inteira (classe + fusão) a cada
     * rodada; se um muro novo entrar em DATA.spells ou nas formas de fusão, ela o varre sem edição.
     *
     * O QUE CADA PEÇA FAZ. Alto ('#'): pilar corta reta e visão; armadura e estandarte são pilares com cara
     * de salão; lareira encostada na parede (a chaminé segue o recorte da parede do lado da câmera). Baixo
     * ('='): mesa, banco, estátua e baú quebram a carga sem tapar a mira — o bolso e as alas têm cobertura a 2
     * casas, a galeria tem a estátua e o átrio o baú.
     * AS ALTURAS E A CÂMERA. A câmera padrão olha do SUDOESTE (ang −π/4), então a SOMBRA de uma peça cai a
     * NORDESTE dela — não ao norte, como a versão anterior deste cabeçalho dizia. Medido com o raio da câmera
     * a todo o chão: o estandarte (4,74 m) em (x,y) tapa até a cabeça a casa (x+1,y−2) e o topo de (x+1,y−1);
     * a armadura (3,98 m) tapa até a cabeça (x+1,y−1) e o peito de (x+1,y−3) e (x+2,y−1); o pilar (2,64 m, o
     * que a prova de 15/09 mediu para não esconder nascimento) tapa no máximo pés e peito da casa vizinha a
     * nordeste, nunca a cabeça. Por isso os estandartes ficam onde a sombra cai na parede norte — (7,1)/(17,1)
     * e os umbrais (8,2)/(16,2) — e o resto do umbral (8,3)/(16,3) e as esquinas (5,4)/(19,4) são pilares (o
     * estandarte em (8,3) tapava (9,1) inteira e o topo de (17,2) no espelho; a armadura em (19,4), (20,3)
     * inteira). As quatro armaduras que ficam: (3,5)/(21,5), o meio da colunata norte, cuja sombra cai no chão
     * da galeria e não tapa casa nenhuma; e (8,16)/(16,16), os umbrais do átrio, com o umbral (8,15)/(16,15) ao
     * norte — a ponta da alabarda de (16,16) tapa o peito de (18,15), canto da galeria, aceito. A prova raia
     * TODO o chão em três alturas (pés 0,3 m, peito 1,3 m, cabeça 2,0 m) da câmera padrão e cobra: nenhuma
     * casa com a cabeça tapada, os oito nascimentos e o primeiro passo de cada um (as casas vizinhas) inteiros
     * à vista; as casas com o peito tapado (19, por pilar ou pela alabarda de (16,16)) ficam listadas.
     *
     * ENXERTOS DOS JUÍZES (19/09): entraram (a) os estandartes da guilda nos umbrais — em (8,2)/(16,2), a casa
     * de cima do umbral, e não em (8,3)/(16,3) como o juiz propôs, pela sombra a nordeste acima —, (c) o banco
     * diante da lareira, (d) a estátua e o baú nos cantos (1,1)/(1,17), que tapam quatro becos sem tocar rota
     * nenhuma, e a alternativa do juiz de arte para as colunatas — o pilar do meio vira ARMADURA, sem custo de
     * métrica (continua '#'), para a fileira não ler como vão transponível — só na colunata NORTE (3,5)/(21,5):
     * na do sul, (3,13) tapava da câmera os pés de (4,11), o primeiro passo de quem nasce em (3,11), e voltou a
     * pilar. Ficaram de fora, medidos: (b) o banco-janela no meio das colunatas (3,5)/(3,13) abre a coluna x=3 numa
     * reta de visão de 17 casas — a galeria enxergaria o berço inteiro; (e) os bancos (11,6)/(13,6) diante do
     * nicho do eixo isolam dez casas (o nicho e a cabeceira da mesa viram ilha) e derrubam o fluxo a 4; (f) o
     * banco no lugar do pilar central do chevron (9,9)/(15,9) abre a coluna x=9 em 17 casas e dá visão direta
     * entre (3,8) e (21,10). */
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
          '#=.....#...###...#.....=#',   //  1 estátua (1,1) · estandarte (7,1) · trono 11..13 — e o espelho
          '#.......#.......#.......#',   //  2 umbrais: o ESTANDARTE da guilda (8,2)/(16,2)
          '#......=#.......#=......#',   //  3 banco (7,3) · pilar do umbral (8,3)
          '#....#......#......#....#',   //  4 pilar da esquina (5,4) · pilar do tapete (12,4)
          '#.###......#.#......###.#',   //  5 colunata (2..4,5): pilar, armadura, pilar · portão (1,5) · boca (5..8,5) · nicho (12,5) entre (11,5)/(13,5)
          '#......#.........#......#',   //  6 quina (7,6) · a faixa y=6 (8..16), reta de 9
          '#=.P......#...#......a.=#',   //  7 baú (1,7) · nascimento (3,7) · quina da mesa (10,7) · portão do bolso (9,7)
          '##.P....#..===..#....a.##',   //  8 lareira (1,8..10) · nascimento (3,8) · chevron (8,8) · mesa 11..13 × 8..10
          '##=...#..#.===.#..#...=##',   //  9 banco diante do fogo (2,9) · pilar da boca (6,9) · ninho (8,9) · chevron (9,9) · passagem (10,9)
          '##.P....#..===..#....a.##',   // 10 nascimento (3,10) · chevron (8,10)
          '#=.P......#...#......a.=#',   // 11 baú (1,11) · nascimento (3,11) · quina (10,11) · portão do bolso (9,11)
          '#......#.........#......#',   // 12 quina (7,12) · a faixa y=12
          '#.###......#.#......###.#',   // 13 colunata (2..4,13): três pilares · portão (1,13) · nicho (12,13)
          '#....#......#......#....#',   // 14 pilar (5,14) · pilar (12,14)
          '#......=#.......#=......#',   // 15 banco (7,15) · umbral (8,15)
          '#.......#.......#.......#',   // 16 armadura (8,16)
          '#=........#...#........=#',   // 17 baú (1,17) · guarda da porta (10,17)/(14,17)
          '###########~~~###########'    // 18 a porta, 11..13
        ],
        monsters: {},
        pecas: [
          {papel: 'parede_salao', x: 0, y: 0, w: 25, h: 19},
          // NORTE: o trono, as bandeiras do fundo e da guilda, os umbrais, as galerias
          {papel: 'trono', x: 11, y: 1, w: 3, h: 1},
          {papel: 'estandarte', x: 7, y: 1, w: 1, h: 1}, {papel: 'estandarte', x: 17, y: 1, w: 1, h: 1},
          {papel: 'estandarte', x: 8, y: 2, w: 1, h: 1}, {papel: 'estandarte', x: 16, y: 2, w: 1, h: 1},
          {papel: 'estatua', x: 1, y: 1, w: 1, h: 1}, {papel: 'estatua', x: 23, y: 1, w: 1, h: 1},
          {papel: 'pilar', x: 8, y: 3, w: 1, h: 1}, {papel: 'pilar', x: 16, y: 3, w: 1, h: 1},
          {papel: 'banco_salao', x: 7, y: 3, w: 1, h: 1}, {papel: 'banco_salao', x: 17, y: 3, w: 1, h: 1},
          {papel: 'pilar', x: 5, y: 4, w: 1, h: 1}, {papel: 'pilar', x: 19, y: 4, w: 1, h: 1},
          {papel: 'pilar', x: 12, y: 4, w: 1, h: 1},
          {papel: 'pilar', x: 11, y: 5, w: 1, h: 1}, {papel: 'pilar', x: 13, y: 5, w: 1, h: 1},
          // AS ALAS: colunatas (a do norte pilar, armadura, pilar; a do sul três pilares — a armadura ali tapava os pés de (4,11)),
          // quinas da arena, o pilar da boca, a lareira com o banco e os baús a 2 dos nascimentos
          // 03/10 (a arte do dono): `arte` troca SÓ a roupa da peça, nunca o papel nem a casa. Os dois pilares que
          // ladeiam a armadura da colunata norte viram CAVALETE DE ARMAS (a colunata vira a armaria do salão) e os dois
          // baús dos cantos do sul viram PEDESTAL DE TROFÉU. Cada um entra na altura do que substitui (cavalete ≤ pilar,
          // troféu ≤ 1,2 m), então a régua tática não se mexe; sem a arte carregada a peça sai como pilar e como baú.
          {papel: 'pilar', x: 2, y: 5, w: 1, h: 1, arte: 'rack_armas'}, {papel: 'armadura', x: 3, y: 5, w: 1, h: 1}, {papel: 'pilar', x: 4, y: 5, w: 1, h: 1, arte: 'rack_armas'},
          {papel: 'pilar', x: 20, y: 5, w: 1, h: 1, arte: 'rack_armas'}, {papel: 'armadura', x: 21, y: 5, w: 1, h: 1}, {papel: 'pilar', x: 22, y: 5, w: 1, h: 1, arte: 'rack_armas'},
          {papel: 'pilar', x: 7, y: 6, w: 1, h: 1}, {papel: 'pilar', x: 17, y: 6, w: 1, h: 1},
          {papel: 'bau', x: 1, y: 7, w: 1, h: 1}, {papel: 'bau', x: 23, y: 7, w: 1, h: 1},
          {papel: 'lareira', x: 1, y: 8, w: 1, h: 3}, {papel: 'lareira', x: 23, y: 8, w: 1, h: 3},
          {papel: 'banco_salao', x: 2, y: 9, w: 1, h: 1}, {papel: 'banco_salao', x: 22, y: 9, w: 1, h: 1},
          {papel: 'pilar', x: 6, y: 9, w: 1, h: 1}, {papel: 'pilar', x: 18, y: 9, w: 1, h: 1},
          {papel: 'bau', x: 1, y: 11, w: 1, h: 1}, {papel: 'bau', x: 23, y: 11, w: 1, h: 1},
          {papel: 'pilar', x: 7, y: 12, w: 1, h: 1}, {papel: 'pilar', x: 17, y: 12, w: 1, h: 1},
          {papel: 'pilar', x: 2, y: 13, w: 1, h: 1}, {papel: 'pilar', x: 3, y: 13, w: 1, h: 1}, {papel: 'pilar', x: 4, y: 13, w: 1, h: 1},
          {papel: 'pilar', x: 20, y: 13, w: 1, h: 1}, {papel: 'pilar', x: 21, y: 13, w: 1, h: 1}, {papel: 'pilar', x: 22, y: 13, w: 1, h: 1},
          // A ARENA: a mesa do conselho, as quatro quinas e os dois chevrons
          {papel: 'mesa', x: 11, y: 8, w: 3, h: 3},
          {papel: 'pilar', x: 10, y: 7, w: 1, h: 1}, {papel: 'pilar', x: 14, y: 7, w: 1, h: 1},
          {papel: 'pilar', x: 10, y: 11, w: 1, h: 1}, {papel: 'pilar', x: 14, y: 11, w: 1, h: 1},
          {papel: 'pilar', x: 8, y: 8, w: 1, h: 1}, {papel: 'pilar', x: 9, y: 9, w: 1, h: 1}, {papel: 'pilar', x: 8, y: 10, w: 1, h: 1},
          {papel: 'pilar', x: 16, y: 8, w: 1, h: 1}, {papel: 'pilar', x: 15, y: 9, w: 1, h: 1}, {papel: 'pilar', x: 16, y: 10, w: 1, h: 1},
          // SUL: o átrio da porta, espelho da sala do trono
          {papel: 'pilar', x: 11, y: 13, w: 1, h: 1}, {papel: 'pilar', x: 13, y: 13, w: 1, h: 1},
          {papel: 'pilar', x: 5, y: 14, w: 1, h: 1}, {papel: 'pilar', x: 19, y: 14, w: 1, h: 1},
          {papel: 'pilar', x: 12, y: 14, w: 1, h: 1},
          {papel: 'banco_salao', x: 7, y: 15, w: 1, h: 1}, {papel: 'banco_salao', x: 17, y: 15, w: 1, h: 1},
          {papel: 'pilar', x: 8, y: 15, w: 1, h: 1}, {papel: 'pilar', x: 16, y: 15, w: 1, h: 1},
          {papel: 'armadura', x: 8, y: 16, w: 1, h: 1}, {papel: 'armadura', x: 16, y: 16, w: 1, h: 1},
          {papel: 'bau', x: 1, y: 17, w: 1, h: 1, arte: 'trofeu'}, {papel: 'bau', x: 23, y: 17, w: 1, h: 1, arte: 'trofeu'},
          {papel: 'pilar', x: 10, y: 17, w: 1, h: 1}, {papel: 'pilar', x: 14, y: 17, w: 1, h: 1}
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
