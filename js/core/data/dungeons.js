var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// SOTERRA 2.0 — Os 6 calabouços, o cenário e os eventos de terreno
// Dono: Criativo Mundo. Globais: DATA.dungeons, DATA.scenery, DATA.tileEvents.
//
// LEGENDA DE LAYOUT (contrato §6). Cada sala é um retângulo de TEXTO de 21×17
// a 27×23 (largura = comprimento da string, altura = número de linhas):
//   '.'  chão            ','  chão decorado
//   '#'  obstáculo ALTO  — bloqueia passagem E visão
//   '='  obstáculo BAIXO — bloqueia passagem, NÃO bloqueia visão (cobertura)
//   '~'  vazio/buraco (empurre alguém para cá)
//   'P'  spawn de herói   ·   a–z  spawn de monstro (ver `monsters`)
//
// GRUPO DE 1 OU 2 (adendo v2.1): o time desceu de 3 para 2 heróis, então cada
// sala precisa de ≥ 2 spawns 'P'. Os layouts trazem de 6 a 10 de propósito —
// spawn sobrando é ignorado pela engine e dá margem para o pet e para a
// unidade fundida, que ocupa uma célula só.
//
// SALAS GRANDES (pedido do usuário: "achei os mapas pequenos"). A faixa subiu
// de 13×11–17×15 para 17×15–23×19 e, na reforma seguinte ("é pequena demais"),
// para 21×17–27×23, crescendo com a profundidade, e a sala do chefe é sempre a
// maior do seu calabouço — arena, não corredor. Três regras aprendidas ao
// ampliar, porque mapa grande vazio é PIOR que mapa pequeno:
//
//   1. DIVISÓRIA COM TEMA, não bloco solto. O '#' e o '=' desenham a mesma
//      coisa que o cenário do tema promete: fileiras de canteiro e treliça na
//      Estufa, parapeitos de canal e comportas na Cisterna, fornalhas e
//      trilhos no Fecho, torres de andaime e vãos nos Andaimes, escoras e
//      vagonetes na Mina, pilares partidos e fendas no Coração. Cada sala tem
//      corredor, salão, gargalo e pelo menos uma rota alternativa.
//   2. DENSIDADE ENTRE 12% E 30% do interior (sem contar o anel de parede).
//      Abaixo disso vira campo aberto; acima vira labirinto e o corpo a corpo
//      não alcança ninguém.
//   3. RITMO ANTES DE ESPAÇO. Com 3 a 4 PP, mapa grande viraria duas rodadas
//      de caminhada. Por isso os 'P' ficam no miolo da borda esquerda (nunca
//      num canto), o primeiro grupo de monstros fica a 4–7 células, e o resto
//      vem em 2 ou 3 grupos separados — o mapa grande é a decisão de PARA QUAL
//      grupo ir primeiro, não tempo morto andando.
//   4. SILHUETA PRÓPRIA POR CALABOUÇO (pedido do usuário: "o mapa é quadrado").
//      A sala continua sendo um retângulo de TEXTO — todas as linhas com o
//      mesmo comprimento —, mas o CONTORNO é recortado com '~': o renderizador
//      3D desenha '~' como fosso com profundidade sobre o plano escuro, então
//      o que sobra lê-se como uma plataforma flutuando no vazio, não como uma
//      caixa. Cada calabouço tem a sua assinatura de recorte:
//        Estufa ....... octógono de canteiro, cantos arredondados em degrau
//        Cisterna ..... ombros retos de comporta e bocas de canal mordendo a borda
//        Fecho ........ blocos retos arrancados e chaminés de fornalha no topo/base
//        Andaimes ..... torres separadas por vãos abertos, sem canto nenhum
//        Mina ......... contorno serrilhado, galerias irregulares que avançam e recuam
//        Coração ...... fendas longas rachando a borda e partindo a sala em quartos
//      REGRA DURA DO RECORTE: todo 'P' e todo spawn de monstro tem de continuar
//      alcançável a pé a partir dos outros. Ilha separada por '~' sem ponte é o
//      erro fácil aqui — `tests/test_engine_v2.html` (auto-play IA×IA nas 18
//      salas) é quem cobra. Recortar também exige ESTRUTURA: o validador cobra
//      mais '#' do que o anel nominal de parede (2·L + 2·A − 4), ou seja, cada
//      célula de borda virada em vazio precisa de uma parede interna em troca.
//
// O '=' é a novidade tática da v2: gargalos e coberturas onde o atirador
// continua vendo o alvo mas ninguém consegue passar. Use as diagonais.
// Nomenclatura: pa = Pontos de Ataque, pp = Pontos de Passos.
// ============================================================================

JOGO.DATA = JOGO.DATA || {};
(function (DATA) {
  'use strict';

  DATA.dungeons = DATA.dungeons || [];
  DATA.scenery = DATA.scenery || {};
  DATA.tileEvents = DATA.tileEvents || {};

  function addDungeon(d) { DATA.dungeons.push(d); }

  // ==========================================================================
  // CENÁRIO — nomes visuais que o Designer desenha no lugar de blocos genéricos.
  // high = obstáculo alto ('#') · low = cobertura baixa ('=')
  // floor = variações de piso ('.' e ',') · props = adereços sem colisão.
  //
  // Com as salas ampliadas (até 23×19) um mapa chega a ter mais de 50 células
  // de obstáculo: com 4 variantes altas a repetição ficava óbvia a olho nu.
  // Cada tema agora tem 6 altas e 7 baixas, e as novas seguem a mesma regra
  // das antigas — a ALTA é algo que ninguém enxerga por cima (parede, torre,
  // fornalha), a BAIXA é algo em que dá para escorar e atirar por cima
  // (mureta, vagonete, bigorna). O Designer sorteia dentro do tema.
  // ==========================================================================
  DATA.scenery = {
    garden: {
      high: ['treliça de madeira podre', 'sebe alta e emaranhada', 'estufa de vidro rachado', 'tutor de bambu cerrado', 'palmeira de estufa tombada de través', 'painel de vidro embaçado de mofo'],
      low: ['canteiro de alvenaria', 'muretinha de tijolo com musgo', 'carrinho de jardinagem tombado', 'fileira de vasos quebrados', 'tora caída coberta de hera', 'floreira comprida de pedra', 'cerca-viva podada até a altura do peito'],
      floor: ['ladrilho hexagonal com musgo', 'terra batida com raízes à mostra', 'grama irrompendo entre lajotas', 'poça de clorofila'],
      props: ['redoma de vagalumes', 'regador de cobre azinhavrado', 'espantalho de palha mofada', 'placa de nome de planta ilegível', 'esporos suspensos']
    },
    cistern: {
      high: ['coluna de pedra negra', 'comporta de ferro emperrada', 'arcada submersa até o meio', 'pilha de barris apodrecidos', 'coluna de sal grossa como um carvalho', 'tela de eclusa entupida de limo'],
      low: ['parapeito de canal', 'degrau de sal cristalizado', 'banco de baile emborcado', 'cano rompido escorrendo', 'amontoado de pérolas calcificadas', 'mureta de comporta na altura da cintura', 'passarela de tábua encalhada de lado'],
      floor: ['mosaico espelhado por um dedo d\'água', 'lodo turquesa', 'lajota rachada com raiz de sal', 'ripple de água parada'],
      props: ['lustre de águas-vivas', 'lampião submerso ainda aceso', 'partitura boiando', 'sapato de baile solitário', 'corrente de âncora']
    },
    forge: {
      high: ['bloco de ferro rebitado', 'chaminé de tijolo refratário', 'portão de fundição', 'pilha de lingotes empilhados', 'fornalha apagada do tamanho de uma casa', 'prensa de forja emperrada no alto'],
      low: ['bigorna abandonada', 'mureta de contenção de escória', 'fosso de têmpera com borda', 'carrinho de carvão', 'molde de areia rachado', 'trilho elevado de vagoneta de lingote', 'bloco de têmpera com a água já seca'],
      floor: ['grelha de forja com brasa embaixo', 'chapa de ferro chamuscada', 'piso de areia de fundição', 'poça de metal solidificado'],
      props: ['corrente do teto balançando', 'martelo cravado na bancada', 'fole gigante murcho', 'avental pendurado', 'fagulhas subindo']
    },
    scaffold: {
      high: ['torre de andaime fechada', 'guindaste travado', 'tapume de tábuas pregadas', 'chaminé de ventilação', 'elevador de obra parado entre andares', 'lona de proteção inflada pelo vento'],
      low: ['guarda-corpo de corda e tábua', 'pilha de vigas amarradas', 'caixa de ferramentas', 'saco de brita de lastro', 'roldana caída de lado', 'estrado de tábua empilhado', 'rolo de cabo de aço na altura do joelho'],
      floor: ['tábua corrida rangendo', 'grade metálica vazada', 'chapa de compensado com prego exposto', 'passarela de corda'],
      props: ['prumo balançando', 'bandeirola de obra', 'balde pendurado', 'ninho de picanço com ossinhos', 'redemoinho de serragem']
    },
    mine: {
      high: ['escoramento de galeria', 'veio de rocha bruta', 'desabamento antigo', 'silo de minério', 'pilar de rocha deixado de pé para segurar o teto', 'porta de galeria pregada e lacrada'],
      low: ['vagonete emborcado', 'trilho elevado', 'pilha de estéril', 'caixa de dinamite úmida', 'vira-cavalete de escoramento', 'viga de escoramento caída atravessada', 'bancada de britagem quebrada'],
      floor: ['piso de cascalho socado', 'trilho de vagonete', 'lama mineral', 'rocha polida por botas'],
      props: ['lampião de carbureto apagado', 'gaiola de pássaro vazia', 'capacete no chão', 'cristal aflorando da parede', 'poeira em suspensão']
    },
    heart: {
      high: ['costela de pedra do Coração', 'lasca de céu petrificado', 'muro de espelho fosco', 'coluna dos quatro elementos', 'pilar partido ao meio que não caiu', 'lasca de mundo suspensa e imóvel'],
      low: ['degrau de basalto rachado', 'caco de espelho encravado', 'bacia elemental transbordando', 'raiz-do-coração grossa', 'anel de cinza compactada', 'soleira de mármore partida', 'banco de pedra das quatro estações'],
      floor: ['mosaico das quatro estações', 'piso que muda de cor com o clima', 'lajota partida ao meio', 'veio de luz antiga'],
      props: ['relógio de estações parado', 'estilhaço flutuando parado no ar', 'chuva que cai para cima', 'quatro lampiões, um por elemento', 'batida distante']
    }
  };

  // ==========================================================================
  // EVENTOS DE TERRENO — marcadores que brotam no chão a cada rodada.
  // kind: 'buff' | 'mystery' | 'portal' | 'drain' | 'fountain'
  // `duration` = rodadas até o marcador sumir sozinho.
  // ==========================================================================
  DATA.tileEvents = {
    'ev-might': {
      id: 'ev-might', name: 'Fôlego de Bravura', kind: 'buff', icon: '⚡', weight: 22, duration: 4,
      effects: [{ type: 'buff', stat: 'power', value: 25, duration: 2 }],
      description: 'Uma faísca de coragem antiga presa no piso: +25 de poder por 2 turnos.',
      flavor: 'Alguém morreu bravo bem aqui. Sobrou um pouco.', fxKey: 'buff'
    },
    'ev-haste': {
      id: 'ev-haste', name: 'Corrente de Passo', kind: 'buff', icon: '💨', weight: 20, duration: 4,
      effects: [{ type: 'buff', stat: 'pp', value: 1, duration: 2 }],
      description: 'Um sopro dos respiradouros empurra pelas costas: +1 PP por 2 turnos.',
      flavor: 'O mundo enterrado ainda respira, de vez em quando a favor.', fxKey: 'buff'
    },
    'ev-focus': {
      id: 'ev-focus', name: 'Segundo de Clareza', kind: 'buff', icon: '✦', weight: 12, duration: 3,
      effects: [{ type: 'buff', stat: 'pa', value: 1, duration: 1 }],
      description: 'O tempo abre uma fresta: +1 PA neste turno.',
      flavor: 'Raro, curto e caro. Use já.', fxKey: 'buff'
    },
    'ev-guard': {
      id: 'ev-guard', name: 'Restos de Redoma', kind: 'buff', icon: '🛡', weight: 16, duration: 4,
      effects: [{ type: 'shield', value: 25, duration: 2 }],
      description: 'Um caco de proteção antiga se fecha em volta de quem pisa: 25 de escudo.',
      flavor: 'Protegeu alguém por mil anos. Agora é sua vez.', fxKey: 'shieldFx'
    },
    'ev-slip': {
      id: 'ev-slip', name: 'Piso Escorregadio', kind: 'buff', icon: '👟', weight: 14, duration: 3,
      effects: [{ type: 'buff', stat: 'dodge', value: 15, duration: 2 }],
      description: 'Musgo, sal ou serragem: dá para escapulir de qualquer fixação. +15 de esquiva por 2 turnos.',
      flavor: 'Escorregar na hora certa é uma escola inteira.', fxKey: 'buff'
    },
    'ev-mystery': {
      id: 'ev-mystery', name: 'Surpresa', kind: 'mystery', icon: '❓', weight: 24, duration: 4,
      description: 'Ninguém sabe o que o mundo enterrado guardou nessa célula. Pise e descubra — pode ser presente, pode ser conta antiga.',
      flavor: 'A casa sempre cobra. Às vezes paga.', fxKey: 'burst',
      outcomes: [
        { weight: 22, text: 'Um respiro do mundo antigo enche o peito. Cura profunda!',
          effects: [{ type: 'heal', min: 30, max: 40 }] },
        { weight: 20, text: 'A célula cede e alguma coisa embaixo morde. Muito.',
          effects: [{ type: 'damage', element: 'neutro', min: 22, max: 30 }] },
        { weight: 18, text: 'O tempo abre uma fresta: uma ação a mais neste turno.',
          effects: [{ type: 'buff', stat: 'pa', value: 1, duration: 1 }] },
        { weight: 18, text: 'Um bolsão de ar podre estoura no rosto. Isso vai arder por um tempo.',
          effects: [{ type: 'poison', element: 'neutro', min: 6, max: 9, duration: 3 }] },
        { weight: 14, text: 'Uma lembrança de força alheia sobe pelas pernas: +40 de poder!',
          effects: [{ type: 'buff', stat: 'power', value: 40, duration: 2 }] },
        { weight: 12, text: 'Raízes velhas se fecham nos tornozelos e não pedem licença.',
          effects: [{ type: 'root', duration: 1 }, { type: 'damage', element: 'neutro', min: 10, max: 14 }] },
        { weight: 10, text: 'Uma redoma esquecida acorda inteira: escudo e regeneração.',
          effects: [{ type: 'shield', value: 40, duration: 3 }, { type: 'regen', min: 8, max: 12, duration: 3 }] }
      ]
    },
    'ev-portal': {
      id: 'ev-portal', name: 'Boca de Respiradouro', kind: 'portal', icon: '🌀', weight: 14, duration: 5,
      effects: [{ type: 'teleport' }],
      description: 'Uma boca de respiradouro suga quem pisa e cospe em outro ponto do mapa.',
      flavor: 'Os Fôlegos usavam isso como escada. Você vai usar como fuga.', fxKey: 'blink'
    },
    'ev-drain': {
      id: 'ev-drain', name: 'Sanguessuga do Piso', kind: 'drain', icon: '🩸', weight: 16, duration: 4,
      effects: [
        { type: 'damage', element: 'neutro', min: 10, max: 16 },
        { type: 'poison', element: 'neutro', min: 4, max: 6, duration: 2 }
      ],
      description: 'O piso está com fome: morde o tornozelo e continua bebendo por 2 turnos.',
      flavor: 'Mil anos sem visita fazem qualquer chão ficar assim.', fxKey: 'debuff'
    },
    'ev-fountain': {
      id: 'ev-fountain', name: 'Fonte Teimosa', kind: 'fountain', icon: '💧', weight: 18, duration: 4,
      effects: [{ type: 'heal', min: 22, max: 30 }],
      description: 'Uma nascente que nunca soube que o mundo acabou. Bebe-se de joelhos.',
      flavor: 'Ainda está limpa. Não pergunte por quê.', fxKey: 'heal'
    }
  };

  // ==========================================================================
  // 1) A ESTUFA SOTERRADA — introdutório · chuva
  // ==========================================================================
  addDungeon({
    id: 'greenhouse',
    name: 'A Estufa Soterrada',
    theme: 'garden',
    description: 'A estufa real do mundo antigo, selada com o jardim ainda vivo lá dentro. Séculos no escuro ensinaram as plantas a caçar; vagalumes presos em redomas fazem as vezes de sol. A água que a Grande Lousa prendeu lá em cima pinga pelas rachaduras do vidro a noite inteira — e o jardim adora.',
    difficulty: 1,
    order: 1,
    // Faixa em que este calabouço é o conteúdo "certo" (adendo v2.3). A Lógica
    // usa isto no `xpFalloff`: acima de recommendedLevel+4 a XP começa a cair
    // ×0,75 por nível. Moer a Estufa no nível 20 continua possível — só deixa
    // de compensar. Aqui o herói ainda nem escolheu elemento (nível 5).
    recommendedLevel: 3,
    palette: {
      primary: '#5a8f4d', secondary: '#8a6b3e', accent: '#ffd76b',
      floor1: '#35513a', floor2: '#3d5c41', wall: '#57452f', lowWall: '#6b5334', voidColor: '#1b2a1e'
    },
    defaultWeather: 'chuva',
    weatherShiftEveryRounds: 0,
    tileEventRate: 0.15,
    rooms: [
      {
        name: 'O Vestíbulo das Heras',
        weather: 'calmo',
        sceneryTheme: 'garden',
        layout: [
          '~~~~~###########~~~~~',
          '~~~~#,.........,#~~~~',
          '~~~##===.....===##~~~',
          '~~#.##.........##.#~~',
          '~#.,..##.....##..,.#~',
          '#...=====...=====...#',
          '#.....a...#...b.....#',
          '#PP..##.......##....#',
          '#PP..............c..#',
          '#PP..##.......##....#',
          '#.....a...#...b.....#',
          '#...=====...=====...#',
          '~#.,..##.....##..,.#~',
          '~~#.##.........##.#~~',
          '~~~##===.....===##~~~',
          '~~~~#,.........,#~~~~',
          '~~~~~###########~~~~~'
        ],
        monsters: { a: 'pollen-puff', b: 'thorn-lasher', c: 'lantern-wasp' }
      },
      {
        name: 'Os Canteiros Afundados',
        weather: 'chuva',
        sceneryTheme: 'garden',
        layout: [
          '~~~~#############~~~~',
          '~~~,.............,~~~',
          '~~..=##=...=##=....~~',
          '~..~~~..a...~~~.....~',
          '#..~~~#....#~~~.....#',
          '#..=##=....=##=.....#',
          '#..##..s.....##.....#',
          '#PP...b.........##..#',
          '#PP......##.....#...#',
          '#PP..............c..#',
          '#..##..a.....##.....#',
          '#..=##=....=##=.....#',
          '#..~~~#....#~~~.....#',
          '~..~~~......~~~.....~',
          '~~..=##=...=##=....~~',
          '~~~,.............,~~~',
          '~~~~#############~~~~'
        ],
        monsters: { a: 'thorn-lasher', s: 'sap-shaman', b: 'burr-mother', c: 'dew-strider' }
      },
      {
        name: 'O Coreto da Viúva',
        weather: 'chuva',
        sceneryTheme: 'garden',
        layout: [
          '~~~~~~###########~~~~~~',
          '~~~~~#,.........,#~~~~~',
          '~~~~#..=#####=....#~~~~',
          '~~~#..##.......##..#~~~',
          '~~#..==..a..==......#~~',
          '~#..==.........==....#~',
          '#..==...#=#=#=#..==...#',
          '#PP...d.#.....#.......#',
          '#PP........z.....d....#',
          '#PP...d.#.....#.......#',
          '#..==...#=#=#=#..==...#',
          '~#..==.........==....#~',
          '~~#..==..a..==......#~~',
          '~~~#..##.......##..#~~~',
          '~~~~#..=#####=....#~~~~',
          '~~~~~#,.........,#~~~~~',
          '~~~~~~###########~~~~~~'
        ],
        monsters: { z: 'boss-gardener', a: 'sap-shaman', d: 'dew-strider' }
      }
    ],
    lootTable: [
      { itemId: 'gh-trellis-guard', weight: 30, minRoom: 0 },
      { itemId: 'gh-moss-treads', weight: 30, minRoom: 0 },
      { itemId: 'gh-firefly-crown', weight: 30, minRoom: 0 },
      { itemId: 'gh-seed-pouch', weight: 30, minRoom: 0 },
      { itemId: 'gh-sap-apron', weight: 12, minRoom: 0 },
      { itemId: 'gh-vine-stirrups', weight: 12, minRoom: 1 },
      { itemId: 'gh-briar-charm', weight: 12, minRoom: 1 },
      { itemId: 'gh-widow-shears', weight: 4, minRoom: 2 },
      { itemId: 'gh-wasp-sting', weight: 30, minRoom: 0 },
      { itemId: 'gh-pollen-slippers', weight: 30, minRoom: 0 },
      { itemId: 'gh-chitin-vest', weight: 30, minRoom: 0 },
      { itemId: 'gh-dew-fang', weight: 30, minRoom: 0 },
      { itemId: 'gh-hive-lantern', weight: 12, minRoom: 1 },
      { itemId: 'gh-gutter-shell', weight: 12, minRoom: 1 },
      { itemId: 'gh-root-spur', weight: 12, minRoom: 1 }
    ],
    // CARTAS (adendo v2.1). Só o chefe derruba, e derruba ao acaso; carta
    // repetida NÃO é lixo: o excedente ao custo de desbloqueio vira estrela.
    // Uma entrada só é legítima se a classe existe, tem `dropWeight > 0` e o
    // `minDungeon` dela (índice 0-based, DATA.cards) alcança este calabouço —
    // aqui, `minDungeon 0`. Os pesos de cada calabouço somam 100 e leem-se
    // como porcentagem.
    //
    // Escada da coleção: sumo/curandeiro (já liberados) só rendem estrela e
    // dominam o raso; invocador (10) abre na Cisterna; bruxo (10) no Fecho;
    // espadachim (20) nos Andaimes; arqueiro (25), o troféu, só na Mina e no
    // Coração — as duas descidas que o jogador vai repetir de verdade.
    cardDrops: [
      { classId: 'sumo', weight: 50 },
      { classId: 'curandeiro', weight: 50 }
    ]
  });

  // ==========================================================================
  // 2) A CISTERNA DOS AFOGADOS — água · chuva/calmo
  // ==========================================================================
  addDungeon({
    id: 'cistern',
    name: 'A Cisterna dos Afogados',
    theme: 'cistern',
    description: 'O reservatório que matou a sede do mundo antigo — e depois bebeu seus donos. A corte afogada ainda dá bailes na água parada: pérolas no lodo, lampiões submersos ainda acesos, lustres de águas-vivas. Tudo reflete, e o reflexo às vezes se mexe primeiro.',
    difficulty: 2,
    order: 2,
    // O elemento já foi escolhido (nível 5) e a Cisterna cobra por isso: quase
    // tudo aqui é água, então quem escolheu fogo sente o primeiro tranco.
    recommendedLevel: 7,
    palette: {
      primary: '#2e6e8e', secondary: '#1d3a4d', accent: '#7ef0d4',
      floor1: '#24404f', floor2: '#2a4a5a', wall: '#16222c', lowWall: '#2b4756', voidColor: '#0d1a22'
    },
    defaultWeather: 'chuva',
    weatherShiftEveryRounds: 0,
    tileEventRate: 0.2,
    // AS TRÊS SALAS FORAM REDESENHADAS quando o cenário próprio chegou (30/08).
    // Regras do Daniel: pouco enfeite ("não polua muito as salas"), o aquário
    // UMA vez por sala (papel `marco`, o renderizador trava), e um desenho
    // tático DIFERENTE por sala. As identidades:
    //   1. GALERIA  — dois canais de água cortam a sala, pontes desalinhadas:
    //      a rota vira um S e a Moreia castiga quem atravessa em fila.
    //   2. SALÃO    — colunas isoladas quebram a linha de visão: a água-viva
    //      cura escondida atrás delas, e o jogador dança de coluna em coluna.
    //   3. TRONO    — arena ABERTA para o gimmick do BAILE: espaço para se
    //      espalhar, abrigo raro, água nos cantos apertando a pista.
    rooms: [
      {
        name: 'A Galeria das Goteiras',
        weather: 'chuva',
        sceneryTheme: 'cistern',
        layout: [
          '#####################',
          '#PP...b....,........#',
          '#PP.....#.....#.....#',
          '#...=====.....=====.#',
          '#~~~~~~~~..~~~~~~~~~#',
          '#....a..............#',
          '#..#===..,..===#....#',
          '#............b......#',
          '#...=....###....=...#',
          '#...................#',
          '#..#===..,..===#....#',
          '#..............a....#',
          '#~~~~~~~~~..~~~~~~~~#',
          '#...=====.....=====.#',
          '#.......#.....#.....#',
          '#..........,........#',
          '#####################'
        ],
        monsters: { a: 'moray-piper', b: 'drowned-porter' }
      },
      {
        name: 'O Salão das Colunas de Sal',
        weather: 'calmo',
        sceneryTheme: 'cistern',
        layout: [
          '#####################',
          '#PP....a............#',
          '#PP..#.....#....#...#',
          '#....,.....==.......#',
          '#..=====......==....#',
          '#.....d....c........#',
          '#..#.....#.....#....#',
          '#....a.....===....e.#',
          '#..==...,......#....#',
          '#......===..........#',
          '#..#.....#.....#....#',
          '#....b.......b......#',
          '#..=====......==....#',
          '#....,......==......#',
          '#....#.....#....#...#',
          '#...................#',
          '#####################'
        ],
        monsters: { a: 'fat-drop', b: 'sump-crab', c: 'brine-golem', d: 'lantern-jelly', e: 'mist-warbler' }
      },
      {
        name: 'O Trono da Salmoura',
        weather: 'chuva',
        sceneryTheme: 'cistern',
        layout: [
          '#######################',
          '#~~.....,.......,...~~#',
          '#~..====.........===.~#',
          '#.....#...........#...#',
          '#...=....b...b....=...#',
          '#.....=========.......#',
          '#..=..=.......=..=....#',
          '#PP.#.............#...#',
          '#PP.......z...........#',
          '#PP...e...c...........#',
          '#...#.............#...#',
          '#..=..=.......=..=....#',
          '#.....=========.......#',
          '#...=....d...d....=...#',
          '#.....#...........#...#',
          '#~..====.........===.~#',
          '#~~.....,.......,...~~#',
          '#######################'
        ],
        monsters: { z: 'boss-baroness', c: 'sump-crab', b: 'moray-piper', d: 'mist-warbler', e: 'fat-drop' }
      }
    ],
    lootTable: [
      { itemId: 'ci-brine-cuirass', weight: 30, minRoom: 0 },
      { itemId: 'ci-current-fins', weight: 30, minRoom: 0 },
      { itemId: 'ci-lantern-fob', weight: 30, minRoom: 0 },
      { itemId: 'ci-tide-flask', weight: 30, minRoom: 0 },
      { itemId: 'ci-drowned-coat', weight: 12, minRoom: 0 },
      { itemId: 'ci-harpoon-flute', weight: 12, minRoom: 1 },
      { itemId: 'ci-jelly-vial', weight: 12, minRoom: 1 },
      { itemId: 'ci-baroness-collar', weight: 4, minRoom: 2 },
      { itemId: 'ci-crab-claw', weight: 30, minRoom: 0 },
      { itemId: 'ci-silt-boots', weight: 30, minRoom: 0 },
      { itemId: 'ci-pearl-mail', weight: 30, minRoom: 0 },
      { itemId: 'ci-bone-lamp', weight: 30, minRoom: 0 },
      { itemId: 'ci-crust-carapace', weight: 12, minRoom: 1 },
      { itemId: 'ci-sump-lamp', weight: 12, minRoom: 1 },
      { itemId: 'ci-piper-fang', weight: 12, minRoom: 1 }
    ],
    // A Baronesa é a primeira carta que LIBERA alguém: o invocador (10 cartas)
    // leva o peso maior, e o resto vira estrela para a dupla inicial.
    cardDrops: [
      { classId: 'invocador', weight: 40 },
      { classId: 'sumo', weight: 30 },
      { classId: 'curandeiro', weight: 30 }
    ]
  });

  // ==========================================================================
  // 3) O FECHO DE BRASA — fogo · estiagem (com uma sala alagada no meio)
  // ==========================================================================
  addDungeon({
    id: 'emberlock',
    name: 'O Fecho de Brasa',
    theme: 'forge',
    description: 'O último Fecho, forjado ao redor da primeira chama do mundo. Corredores de bigornas frias, correntes penduradas do teto, luz que vem de baixo — das grelhas do piso. O calor sobe e fica: aqui a estiagem não é clima, é arquitetura. O maior portão já construído acordou com ciúme do próprio fogo.',
    difficulty: 3,
    order: 3,
    // Segundo feitiço de caminho (nível 10) recém-liberado. É onde a curva
    // começa a subir de verdade: os comuns ganham vida e poder de andar.
    recommendedLevel: 11,
    palette: {
      primary: '#c4502e', secondary: '#4a2a26', accent: '#ffb347',
      floor1: '#3a2422', floor2: '#452a25', wall: '#241512', lowWall: '#5a3128', voidColor: '#180b08'
    },
    defaultWeather: 'estiagem',
    weatherShiftEveryRounds: 0,
    tileEventRate: 0.25,
    rooms: [
      {
        name: 'O Corredor de Brasas',
        weather: 'estiagem',
        sceneryTheme: 'forge',
        layout: [
          '~~~~######~~~######~~~~',
          '~~~~#..,.......,..#~~~~',
          '~~~~#.###.....###.#~~~~',
          '~~~~#.#.........#.#~~~~',
          '#...==...a...==......##',
          '#...#####...#####.....#',
          '#....b................#',
          '#PP.................c.#',
          '#PP...................#',
          '#PP...................#',
          '#.....................#',
          '#...#####...#####.....#',
          '#...==...a...==......##',
          '~~~~#.#.........#.#~~~~',
          '~~~~#.###.....###.#~~~~',
          '~~~~#..,.......,..#~~~~',
          '~~~~######~~~######~~~~'
        ],
        monsters: { a: 'ember-imp', b: 'ash-wraith', c: 'walking-anvil' }
      },
      {
        // A sala alagada: os fossos de têmpera romperam e a CHUVA inverte a
        // hierarquia — os monstros de fogo perdem 5 PV por turno aqui.
        name: 'A Nave dos Malhos',
        weather: 'chuva',
        sceneryTheme: 'forge',
        layout: [
          '~~~~~####~~~~~####~~~~~',
          '~~~~~#..#~~~~~#..#~~~~~',
          '~~~~~#..,.....,..#~~~~~',
          '#####.==#####==..#~~~~~',
          '#...a...........a..~~~~',
          '#..#####..~..#####..###',
          '#..#...#.....#...#....#',
          '#..#...#..d..#...#....#',
          '#PP.....==...==.......#',
          '#PP....b.......c.....e#',
          '#PP.....==...==.......#',
          '#..#...#..d..#...#....#',
          '#..#...#.....#...#....#',
          '#..#####..~..#####..###',
          '#................#~~~~~',
          '#####.==#####==..#~~~~~',
          '~~~~~#..,.....,..#~~~~~',
          '~~~~~#...........#~~~~~',
          '~~~~~#############~~~~~'
        ],
        monsters: {
          a: 'ember-imp', b: 'slag-mound', c: 'walking-anvil',
          d: 'quench-hound', e: 'faceless-smith'
        }
      },
      {
        name: 'A Câmara do Coração',
        weather: 'estiagem',
        sceneryTheme: 'forge',
        layout: [
          '~~~~~######~~~######~~~~~',
          '~~~~~#....#~~~#....#~~~~~',
          '~~~~~#..,.......,..#~~~~~',
          '~~~~~#.===#####===.#~~~~~',
          '#....==...a....==.......#',
          '#....b.........b........#',
          '#..###.......###........#',
          '#..#...........#........#',
          '#PP....b.....b..........#',
          '#PP.........z...........#',
          '#PP....b.....b..........#',
          '#..#...........#........#',
          '#..###.......###........#',
          '#..............a........#',
          '#....==........==.......#',
          '~~~~~#.===#####===.#~~~~~',
          '~~~~~#..,.......,..#~~~~~',
          '~~~~~#....#~~~#....#~~~~~',
          '~~~~~######~~~######~~~~~'
        ],
        monsters: { z: 'boss-heartforge', a: 'ember-imp', b: 'chain-hauler' }
      }
    ],
    lootTable: [
      { itemId: 'em-riveted-plate', weight: 30, minRoom: 0 },
      { itemId: 'em-bellows-valve', weight: 30, minRoom: 0 },
      { itemId: 'em-soot-mantle', weight: 12, minRoom: 0 },
      { itemId: 'em-cinder-treads', weight: 12, minRoom: 0 },
      { itemId: 'em-chain-harness', weight: 12, minRoom: 1 },
      { itemId: 'em-ember-flask', weight: 12, minRoom: 1 },
      { itemId: 'em-brand-iron', weight: 12, minRoom: 1 },
      { itemId: 'em-forge-grate', weight: 4, minRoom: 2 },
      { itemId: 'em-quench-fang', weight: 30, minRoom: 0 },
      { itemId: 'em-quench-treads', weight: 30, minRoom: 0 },
      { itemId: 'em-cinder-plate', weight: 30, minRoom: 0 },
      { itemId: 'em-hauler-links', weight: 30, minRoom: 0 },
      { itemId: 'em-quench-vest', weight: 12, minRoom: 1 },
      { itemId: 'em-quench-lamp', weight: 12, minRoom: 1 },
      { itemId: 'em-imp-gauntlet', weight: 12, minRoom: 1 }
    ],
    // O bruxo (10 cartas, minDungeon 2) entra aqui; o invocador ainda domina,
    // então quem parou no meio do caminho termina a coleção dele de passagem.
    cardDrops: [
      { classId: 'invocador', weight: 34 },
      { classId: 'bruxo', weight: 30 },
      { classId: 'sumo', weight: 18 },
      { classId: 'curandeiro', weight: 18 }
    ]
  });

  // ==========================================================================
  // 4) OS ANDAIMES DO VENTO — ar · vendaval · plataformas e vazios
  // ==========================================================================
  addDungeon({
    id: 'windscaffold',
    name: 'Os Andaimes do Vento',
    theme: 'scaffold',
    description: 'O poço de manutenção que os construtores nunca terminaram: quinze andares de andaime amarrado com corda, pendurados sobre um vazio que ninguém mediu. Os respiradouros do mundo enterrado desembocam todos aqui, e o vento sobe pelo poço a noite inteira fazendo as tábuas cantarem. Cair não é derrota tática. É o chão da sala não existir.',
    difficulty: 4,
    order: 4,
    // Aqui o jogo deixa de perdoar: vazios por toda parte, tudo empurra, e os
    // comuns saltam de ~93 para ~112 PV médios. Sem fusão ou pet, dói.
    recommendedLevel: 16,
    palette: {
      primary: '#8f97b8', secondary: '#4a4636', accent: '#eef7f5',
      floor1: '#3a3a44', floor2: '#45444f', wall: '#26262f', lowWall: '#5b5344', voidColor: '#0a0a10'
    },
    defaultWeather: 'vendaval',
    weatherShiftEveryRounds: 0,
    tileEventRate: 0.3,
    rooms: [
      {
        name: 'A Passarela dos Guindastes',
        weather: 'vendaval',
        sceneryTheme: 'scaffold',
        layout: [
          '~~~~#####~~~~~#####~~~~',
          '~~~~#...#~~~~~#...#~~~~',
          '~~~~#...#~~~~~#...#~~~~',
          '~~~~#...#~~~~~#...#~~~~',
          '~~~~#..===...===..#~~~~',
          '##...a.......a......###',
          '#..##...=====...##....#',
          '#PP##...........##....#',
          '#PP....b.....b......c~~',
          '#PP..................~~',
          '#PP....b.....b.......~~',
          '#..##...........##....#',
          '#..##...=====...##....#',
          '##..................###',
          '~~~~#..===...===..#~~~~',
          '~~~~#...#~~~~~#...#~~~~',
          '~~~~#...#~~~~~#...#~~~~',
          '~~~~#...#~~~~~#...#~~~~',
          '~~~~#####~~~~~#####~~~~'
        ],
        monsters: { a: 'plank-shrike', b: 'gust-gremlin', c: 'rope-hanger' }
      },
      {
        // O sotavento: atrás do tapume o vento não entra (clima calmo) e o
        // Golem de Lastro deixa de apanhar do próprio calabouço.
        name: 'O Poço de Serviço',
        weather: 'calmo',
        sceneryTheme: 'scaffold',
        layout: [
          '~~~~~######~~~######~~~~~',
          '~~~~~#....#~~~#....#~~~~~',
          '~~~~~#....#~~~#....#~~~~~',
          '~~~~~#..,.......,..#~~~~~',
          '#####.==#####==.....#####',
          '#...a...........a.......#',
          '#..###.......###........#',
          '#PP.#.........#..d......#',
          '#PP.=.........=.........#',
          '#PP...b.......c.........#',
          '#PP.=.........=.........#',
          '#PP.#.........#..d......#',
          '#..###.......###........#',
          '#.......................#',
          '#####.==#####==.....#####',
          '~~~~~#..,.......,..#~~~~~',
          '~~~~~#....#~~~#....#~~~~~',
          '~~~~~#....#~~~#....#~~~~~',
          '~~~~~######~~~######~~~~~'
        ],
        monsters: { a: 'kite-serpent', b: 'whistle-choir', c: 'ballast-golem', d: 'mote-swarm' }
      },
      {
        name: 'A Ponte do Mestre-de-Obras',
        weather: 'vendaval',
        sceneryTheme: 'scaffold',
        layout: [
          '~~~~~#####~~~~~#####~~~~~',
          '~~~~~#...#~~~~~#...#~~~~~',
          '~~~~~#...#~~~~~#...#~~~~~',
          '~~~~~#...#~~~~~#...#~~~~~',
          '~~~~~#...#~~~~~#...#~~~~~',
          '~~~~~#..,.......,..#~~~~~',
          '#...===.......===...#...#',
          '#...a...........a....#..#',
          '#..##...=====...##......#',
          '#PP##....b.b....##......~',
          '#PP.......z.............~',
          '#PP##....b......##......~',
          '#..##...=====...##..#...#',
          '#...c...........c....#..#',
          '#...a...................#',
          '~~~~~#..,.......,..#~~~~~',
          '~~~~~#...#~~~~~#...#~~~~~',
          '~~~~~#...#~~~~~#...#~~~~~',
          '~~~~~#...#~~~~~#...#~~~~~',
          '~~~~~#...#~~~~~#...#~~~~~',
          '~~~~~#####~~~~~#####~~~~~'
        ],
        monsters: { z: 'boss-windwright', a: 'plank-shrike', b: 'kite-serpent', c: 'rope-hanger' }
      }
    ],
    lootTable: [
      { itemId: 'av-rope-vest', weight: 30, minRoom: 0 },
      { itemId: 'av-kite-crest', weight: 12, minRoom: 0 },
      { itemId: 'av-glider-cloak', weight: 12, minRoom: 0 },
      { itemId: 'av-plank-gauntlet', weight: 12, minRoom: 1 },
      { itemId: 'av-storm-harness', weight: 12, minRoom: 1 },
      { itemId: 'av-wind-whistle', weight: 12, minRoom: 1 },
      { itemId: 'av-lightning-coil', weight: 12, minRoom: 1 },
      { itemId: 'av-updraft-boots', weight: 4, minRoom: 2 },
      { itemId: 'av-noose-grip', weight: 30, minRoom: 0 },
      { itemId: 'av-hemp-boots', weight: 30, minRoom: 0 },
      { itemId: 'av-shrike-talon', weight: 30, minRoom: 0 },
      { itemId: 'av-ballast-greaves', weight: 30, minRoom: 0 },
      { itemId: 'av-knot-jerkin', weight: 12, minRoom: 1 },
      { itemId: 'av-hangman-lamp', weight: 12, minRoom: 1 },
      { itemId: 'av-serpent-sash', weight: 12, minRoom: 1 }
    ],
    // Espadachim (20 cartas) estreia no Mestre-de-Obras: daqui para baixo a
    // coleção deixa de ser souvenir e vira motivo para repetir o calabouço.
    cardDrops: [
      { classId: 'espadachim', weight: 30 },
      { classId: 'bruxo', weight: 26 },
      { classId: 'invocador', weight: 24 },
      { classId: 'sumo', weight: 10 },
      { classId: 'curandeiro', weight: 10 }
    ]
  });

  // ==========================================================================
  // 5) A MINA TRÊMULA — terra · tremor · desabamentos
  // ==========================================================================
  addDungeon({
    id: 'quakemine',
    name: 'A Mina Trêmula',
    theme: 'mine',
    description: 'A mina que cavava para cima, tentando furar a Grande Lousa por baixo. Parou quando o turno da noite não subiu. Desde então a rocha bate sozinha, de tempos em tempos, e a poeira desce em cortinas: é a Lousa se acomodando mais um palmo. Os mineiros continuam trabalhando. Ninguém teve coragem de dizer a eles que o turno acabou.',
    difficulty: 5,
    order: 5,
    // Conteúdo de fim de jogo normal (nível 20 = último tier de feitiço antes
    // do 30). Bocarrada com mais de 200 PV é bicho COMUM nesta mina.
    recommendedLevel: 22,
    palette: {
      primary: '#8a7043', secondary: '#3b3228', accent: '#c9a227',
      floor1: '#37302a', floor2: '#413931', wall: '#211c17', lowWall: '#4e4133', voidColor: '#120e0a'
    },
    defaultWeather: 'tremor',
    weatherShiftEveryRounds: 0,
    tileEventRate: 0.35,
    rooms: [
      {
        name: 'A Galeria do Turno da Noite',
        weather: 'tremor',
        sceneryTheme: 'mine',
        layout: [
          '~~~~~#######~~~#####~~~~~',
          '~~~##......#~~~#....##~~~',
          '~~#...===....===......#~~',
          '~#...###.......###.....#~',
          '#....a...........a......#',
          '#..##...==...==...##....#',
          '#..##...........c.##....#',
          '#PP...b.........b.......#',
          '#PP.....................#',
          '#PP...b.....c...b.......#',
          '#..##...........#.##....#',
          '#..##...==...==...##....#',
          '#.......................#',
          '#...###.......###.......#',
          '~#...===....===........#~',
          '~~#..==......==.......#~~',
          '~~~#......###........#~~~',
          '~~~~##...#~~~#.....##~~~~',
          '~~~~~~####~~~######~~~~~~'
        ],
        monsters: { a: 'pick-revenant', b: 'firedamp-wisp', c: 'ore-tumbler' }
      },
      {
        // O respiradouro principal: aqui sopra VENDAVAL, e é a Terra da casa
        // que perde 5 PV por turno. A sala vira aliada de quem escolheu Ar.
        name: 'O Respiradouro',
        weather: 'vendaval',
        sceneryTheme: 'mine',
        layout: [
          '~~~~~~######~~#####~~~~~~',
          '~~~~##.....#~~#....##~~~~',
          '~~##.......#~~#......##~~',
          '~#....,.........,......#~',
          '#...===.......===.......#',
          '#...###.......###.......#',
          '#...#...........#.......#',
          '#....a.........a........#',
          '#..##.........##........#',
          '#PP##....b....##..c.....#',
          '#PP.....................#',
          '#PP##....b....##..c.....#',
          '#..##.........##........#',
          '#....a..................#',
          '#...#...........#.......#',
          '#...###.......###.......#',
          '~#..===.......===......#~',
          '~~#..,.........,.....##~~',
          '~~~~#...............#~~~~',
          '~~~~~##...........##~~~~~',
          '~~~~~~~###########~~~~~~~'
        ],
        monsters: { a: 'shaft-bat', b: 'damp-seeper', c: 'cave-jaw' }
      },
      {
        name: 'A Face de Batepedra',
        weather: 'tremor',
        sceneryTheme: 'mine',
        layout: [
          '~~~~~~#######~~######~~~~~~',
          '~~~~##......#~~#.....##~~~~',
          '~~##........#~~#.......##~~',
          '~#...,.............,.....#~',
          '#...===.........===.......#',
          '#...###....a....###.......#',
          '#...#...........#.........#',
          '#....c.........c..........#',
          '#..##...##.##...##........#',
          '#PP##..#~...~#..##..b.....#',
          '#PP.....~.z.~......b......#',
          '#PP##..#~...~#..##..b.....#',
          '#..##...##.##...##........#',
          '#....c.........c..........#',
          '#...#...........#.........#',
          '#...###.........###.......#',
          '~#...===.........===.....#~',
          '~~#..,.............,....#~~',
          '~~~##......#~~#.......##~~~',
          '~~~~~##....#~~#.....##~~~~~',
          '~~~~~~~#####~~######~~~~~~~'
        ],
        monsters: { z: 'boss-deepknock', a: 'crystal-chanter', b: 'sinkhole-worm', c: 'firedamp-wisp' }
      }
    ],
    lootTable: [
      { itemId: 'mt-slate-plate', weight: 14, minRoom: 0 },
      { itemId: 'mt-ore-greaves', weight: 12, minRoom: 0 },
      { itemId: 'mt-drill-bit', weight: 12, minRoom: 0 },
      { itemId: 'mt-cart-wheels', weight: 12, minRoom: 1 },
      { itemId: 'mt-bedrock-carapace', weight: 12, minRoom: 1 },
      { itemId: 'mt-quake-nail', weight: 12, minRoom: 1 },
      { itemId: 'mt-shoring-charm', weight: 12, minRoom: 1 },
      { itemId: 'mt-quake-crown', weight: 4, minRoom: 2 },
      { itemId: 'mt-firedamp-fist', weight: 14, minRoom: 0 },
      { itemId: 'mt-wisp-treads', weight: 14, minRoom: 0 },
      { itemId: 'mt-seep-plate', weight: 14, minRoom: 0 },
      { itemId: 'mt-grisu-wick', weight: 14, minRoom: 0 },
      { itemId: 'mt-damp-mantle', weight: 12, minRoom: 1 },
      { itemId: 'mt-firedamp-lamp', weight: 12, minRoom: 1 },
      { itemId: 'mt-blast-knuckles', weight: 12, minRoom: 1 }
    ],
    // Batepedra é o primeiro chefe que solta carta de ARQUEIRO (25 cartas, o
    // desbloqueio mais caro do jogo). Espadachim empata em peso: as duas
    // classes caras saem daqui e do Coração, e de mais lugar nenhum.
    cardDrops: [
      { classId: 'arqueiro', weight: 28 },
      { classId: 'espadachim', weight: 28 },
      { classId: 'bruxo', weight: 20 },
      { classId: 'invocador', weight: 14 },
      { classId: 'sumo', weight: 5 },
      { classId: 'curandeiro', weight: 5 }
    ]
  });

  // ==========================================================================
  // 6) O CORAÇÃO PARTIDO — todos os elementos · CLIMA MUDA A CADA 3 RODADAS
  // ==========================================================================
  addDungeon({
    id: 'brokenheart',
    name: 'O Coração Partido',
    theme: 'heart',
    description: 'O Coração que sustentava o mundo inteiro, e não só um Fecho. Rachou em quatro quartos que batem fora de compasso — um de brasa, um d\'água, um de pedra, um de ar — e cada batida joga a sala para um clima diferente. Aqui não existe elemento seguro: o que curava você há três rodadas está te matando agora. É o fim da Descida, e a Lousa está ouvindo.',
    difficulty: 6,
    order: 6,
    // O troféu. Nível 28 assume item evoluído, conjunto fechado e estrelas na
    // classe. É o único andar onde o clima vira contra o jogador sozinho.
    recommendedLevel: 28,
    palette: {
      primary: '#8f6ad0', secondary: '#2a2440', accent: '#ffd166',
      floor1: '#2d2a3d', floor2: '#373248', wall: '#1a1726', lowWall: '#4a4160', voidColor: '#0b0812'
    },
    defaultWeather: 'calmo',
    weatherShiftEveryRounds: 3,
    tileEventRate: 0.45,
    rooms: [
      {
        name: 'O Átrio das Quatro Estações',
        weather: 'chuva',
        sceneryTheme: 'heart',
        layout: [
          '~~####~~~~~~~~~~~~~####~~',
          '~~#..#~~#~~~~~~~~~~#..#~~',
          '~~#..#~~==#####==~~#..#~~',
          '##...#..a...b..#..~#...##',
          '#....#.........#..~#....#',
          '#...==.......==.........#',
          '#....c.........d........#',
          '#..###.........###....###',
          '#PP#.............#....~~~',
          '~...............=....#~~~',
          '~~~....,......,......#~~~',
          '~...............=.....###',
          '#PP#.............#......#',
          '#..###.........###......#',
          '#....c.........d........#',
          '#...==.......==.........#',
          '#....#.........#..~#....#',
          '##...#..b...a..#..~#...##',
          '~~#..#~~==#####==~~#..#~~',
          '~~#..#~~#~~~~~~~~~~#..#~~',
          '~~####~~~~~~~~~~~~~####~~'
        ],
        monsters: { a: 'cinder-herald', b: 'tide-herald', c: 'gale-herald', d: 'stone-herald' }
      },
      {
        name: 'A Sala dos Espelhos',
        weather: 'estiagem',
        sceneryTheme: 'heart',
        layout: [
          '#####~~#####~~~#####~~#####',
          '#...#~~#...#~~~#...#~~#...#',
          '#...#~~#...#~~~#...#~~#...#',
          '#...#~~#...#~~~#...#~~#...#',
          '#...#~~#..,.....,..#~~#...#',
          '#...#~~.=#######=..#~~#...#',
          '#...a...........a.........#',
          '#..###...###...###........#',
          '#..#=#...#=#...#=#.......##',
          '#PP..#...#.#...#........#~~',
          '#PP...c...d.c...d.......#~~',
          '#PP..#...#.#...#........#~~',
          '#..#=#...#=#...#=#.......##',
          '#..###...###...###........#',
          '#...b...........b.........#',
          '#...#~~.=#######=..#~~#...#',
          '#...#~~#..,.....,..#~~#...#',
          '#...#~~#...#~~~#...#~~#...#',
          '#...#~~#...#~~~#...#~~#...#',
          '#...#~~#...#~~~#...#~~#...#',
          '#####~~#####~~~#####~~#####'
        ],
        monsters: { a: 'mirror-twin', b: 'weather-mote', c: 'null-warden', d: 'heartroot' }
      },
      {
        name: 'O Coração Partido',
        weather: 'calmo',
        sceneryTheme: 'heart',
        layout: [
          '######~~~~~~~~~~~~~~~######',
          '#....#~~~~~~~~~~~~~~~#....#',
          '#....#~~#~~~~~~~~~~~~#....#',
          '#....#~~=#######=~~~~#....#',
          '#....##.........##~~~#....#',
          '#....#....a....#..#~~#....#',
          '#....==.......==..........#',
          '#....d.........e..........#',
          '#..###....~....###........#',
          '#PP#..~~~~~~~~~..#......###',
          '~.....e..~~~....d......#~~~',
          '~PP....~..z..~.........#~~~',
          '~.....d..~~~....e......#~~~',
          '#PP#..~~~~~~~~~..#......###',
          '#..###....~....###........#',
          '#....e.........d..........#',
          '#....==.......==..........#',
          '#....#....b....#..#~~#....#',
          '#....##.........##~~~#....#',
          '#....#~~=#######=~~~~#....#',
          '#....#~~#~~~~~~~~~~~~#....#',
          '#....#~~~~~~~~~~~~~~~#....#',
          '######~~~~~~~~~~~~~~~######'
        ],
        monsters: {
          z: 'boss-riftheart', a: 'stone-herald', b: 'gale-herald',
          d: 'null-warden', e: 'weather-mote'
        }
      }
    ],
    lootTable: [
      { itemId: 'cp-scar-plate', weight: 14, minRoom: 0 },
      { itemId: 'cp-ashen-anklets', weight: 12, minRoom: 0 },
      { itemId: 'cp-shard-ring', weight: 12, minRoom: 0 },
      { itemId: 'cp-worldshell', weight: 4, minRoom: 2 },
      { itemId: 'cp-quicksilver-boots', weight: 4, minRoom: 2 },
      { itemId: 'cp-heart-crown', weight: 4, minRoom: 2 },
      { itemId: 'cp-heart-horn', weight: 4, minRoom: 2 },
      { itemId: 'cp-eclipse-lens', weight: 4, minRoom: 2 },
      { itemId: 'cp-gale-fist', weight: 14, minRoom: 0 },
      { itemId: 'cp-gale-steps', weight: 14, minRoom: 0 },
      { itemId: 'cp-gale-plate', weight: 14, minRoom: 0 },
      { itemId: 'cp-tide-anklets', weight: 14, minRoom: 0 },
      { itemId: 'cp-gale-lamp', weight: 12, minRoom: 1 },
      { itemId: 'cp-herald-ember', weight: 12, minRoom: 1 },
      { itemId: 'cp-ember-censer', weight: 12, minRoom: 1 }
    ],
    // O fundo do mundo espelha exatamente os `dropWeight` de DATA.cards:
    // arqueiro 32 · espadachim 24 · bruxo 16 · invocador 16 · sumo 6 ·
    // curandeiro 6. Farmar aqui é sempre o caminho mais curto para qualquer
    // carta — inclusive para as 5 estrelas de quem já liberou tudo.
    cardDrops: [
      { classId: 'arqueiro', weight: 32 },
      { classId: 'espadachim', weight: 24 },
      { classId: 'bruxo', weight: 16 },
      { classId: 'invocador', weight: 16 },
      { classId: 'sumo', weight: 6 },
      { classId: 'curandeiro', weight: 6 }
    ]
  });

// __FIM_DOS_CALABOUCOS__ (novos calabouços entram acima desta linha)
})(JOGO.DATA);

/* OS PORTAIS FECHADOS (08/09, pedido do dono): "colocar nos 3 portais que
 * ainda não tenho os itens e monstros criados para ficarem fechados — eles
 * existirem, mas com um X vermelho no meio, impedindo o acesso". Enquanto a
 * arte de um calabouço não chega, o portal fica na praça, trancado: sem
 * descida, fora do Calabouço do Dia e fora dos palcos do Poço — e as PEÇAS
 * dele VAZAM para os calabouços abertos (Progress.lootPool), para o saque não
 * ficar só nos dois temas prontos. Abrir é tirar o id desta lista. */
JOGO.DATA.portaisFechados = ['windscaffold', 'quakemine', 'brokenheart'];
JOGO.DATA.portalFechado = function (id) {
  return (JOGO.DATA.portaisFechados || []).indexOf(id) >= 0;
};
