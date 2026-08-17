var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// SOTERRA 2.0 — Os 6 calabouços, o cenário e os eventos de terreno
// Dono: Criativo Mundo. Globais: DATA.dungeons, DATA.scenery, DATA.tileEvents.
//
// LEGENDA DE LAYOUT (contrato §6). Cada sala é um retângulo de 13×11 a 17×15
// (largura = comprimento da string, altura = número de linhas):
//   '.'  chão            ','  chão decorado
//   '#'  obstáculo ALTO  — bloqueia passagem E visão
//   '='  obstáculo BAIXO — bloqueia passagem, NÃO bloqueia visão (cobertura)
//   '~'  vazio/buraco (empurre alguém para cá)
//   'P'  spawn de herói (sempre ≥ 3)   ·   a–z  spawn de monstro (ver `monsters`)
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
  // ==========================================================================
  DATA.scenery = {
    garden: {
      high: ['treliça de madeira podre', 'sebe alta e emaranhada', 'estufa de vidro rachado', 'tutor de bambu cerrado'],
      low: ['canteiro de alvenaria', 'muretinha de tijolo com musgo', 'carrinho de jardinagem tombado', 'fileira de vasos quebrados', 'tora caída coberta de hera'],
      floor: ['ladrilho hexagonal com musgo', 'terra batida com raízes à mostra', 'grama irrompendo entre lajotas', 'poça de clorofila'],
      props: ['redoma de vagalumes', 'regador de cobre azinhavrado', 'espantalho de palha mofada', 'placa de nome de planta ilegível', 'esporos suspensos']
    },
    cistern: {
      high: ['coluna de pedra negra', 'comporta de ferro emperrada', 'arcada submersa até o meio', 'pilha de barris apodrecidos'],
      low: ['parapeito de canal', 'degrau de sal cristalizado', 'banco de baile emborcado', 'cano rompido escorrendo', 'amontoado de pérolas calcificadas'],
      floor: ['mosaico espelhado por um dedo d\'água', 'lodo turquesa', 'lajota rachada com raiz de sal', 'ripple de água parada'],
      props: ['lustre de águas-vivas', 'lampião submerso ainda aceso', 'partitura boiando', 'sapato de baile solitário', 'corrente de âncora']
    },
    forge: {
      high: ['bloco de ferro rebitado', 'chaminé de tijolo refratário', 'portão de fundição', 'pilha de lingotes empilhados'],
      low: ['bigorna abandonada', 'mureta de contenção de escória', 'fosso de têmpera com borda', 'carrinho de carvão', 'molde de areia rachado'],
      floor: ['grelha de forja com brasa embaixo', 'chapa de ferro chamuscada', 'piso de areia de fundição', 'poça de metal solidificado'],
      props: ['corrente do teto balançando', 'martelo cravado na bancada', 'fole gigante murcho', 'avental pendurado', 'fagulhas subindo']
    },
    scaffold: {
      high: ['torre de andaime fechada', 'guindaste travado', 'tapume de tábuas pregadas', 'chaminé de ventilação'],
      low: ['guarda-corpo de corda e tábua', 'pilha de vigas amarradas', 'caixa de ferramentas', 'saco de brita de lastro', 'roldana caída de lado'],
      floor: ['tábua corrida rangendo', 'grade metálica vazada', 'chapa de compensado com prego exposto', 'passarela de corda'],
      props: ['prumo balançando', 'bandeirola de obra', 'balde pendurado', 'ninho de picanço com ossinhos', 'redemoinho de serragem']
    },
    mine: {
      high: ['escoramento de galeria', 'veio de rocha bruta', 'desabamento antigo', 'silo de minério'],
      low: ['vagonete emborcado', 'trilho elevado', 'pilha de estéril', 'caixa de dinamite úmida', 'vira-cavalete de escoramento'],
      floor: ['piso de cascalho socado', 'trilho de vagonete', 'lama mineral', 'rocha polida por botas'],
      props: ['lampião de carbureto apagado', 'gaiola de pássaro vazia', 'capacete no chão', 'cristal aflorando da parede', 'poeira em suspensão']
    },
    heart: {
      high: ['costela de pedra do Coração', 'lasca de céu petrificado', 'muro de espelho fosco', 'coluna dos quatro elementos'],
      low: ['degrau de basalto rachado', 'caco de espelho encravado', 'bacia elemental transbordando', 'raiz-do-coração grossa', 'anel de cinza compactada'],
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
          '#############',
          '#P,....=....#',
          '#P,.==.=.a..#',
          '#P.....=..,.#',
          '#...=......b#',
          '#..~~..=....#',
          '#...=.....a.#',
          '#.....=..,..#',
          '#P..==.=..c.#',
          '#..........,#',
          '#############'
        ],
        monsters: { a: 'pollen-puff', b: 'thorn-lasher', c: 'lantern-wasp' }
      },
      {
        name: 'Os Canteiros Afundados',
        weather: 'chuva',
        sceneryTheme: 'garden',
        layout: [
          '#############',
          '#..a......a.#',
          '#.~~~=,,=~~~#',
          '#.~~~....~~~#',
          '#..=..s..=..#',
          '#,,.......,,#',
          '#..=..b..=..#',
          '#,,.......,,#',
          '#..=..c..=..#',
          '#.~~~....~~~#',
          '#.~~~=,,=~~~#',
          '#P.P.P....P.#',
          '#############'
        ],
        monsters: { a: 'thorn-lasher', s: 'sap-shaman', b: 'burr-mother', c: 'dew-strider' }
      },
      {
        name: 'O Coreto da Viúva',
        weather: 'chuva',
        sceneryTheme: 'garden',
        layout: [
          '#############',
          '#.....z.....#',
          '#...=,,,=...#',
          '#.a.......a.#',
          '#..#==.==#..#',
          '#..#..,..#..#',
          '#....=,=....#',
          '#..#..,..#..#',
          '#..#==.==#..#',
          '#...~...~...#',
          '#..d.....d..#',
          '#.P.P...P.P.#',
          '#############'
        ],
        monsters: { z: 'boss-gardener', a: 'sap-shaman', d: 'dew-strider' }
      }
    ],
    lootTable: [
      { itemId: 'gh-trellis-shield', weight: 30, minRoom: 0 },
      { itemId: 'gh-firefly-dome', weight: 30, minRoom: 0 },
      { itemId: 'gh-pruning-shears', weight: 30, minRoom: 0 },
      { itemId: 'gh-garden-apron', weight: 12, minRoom: 0 },
      { itemId: 'gh-thorn-whip', weight: 12, minRoom: 1 },
      { itemId: 'gh-amber-sap', weight: 12, minRoom: 1 },
      { itemId: 'gh-widow-shears', weight: 4, minRoom: 2 }
    ],
    cardDrops: [
      { classId: 'sumo', weight: 24 },
      { classId: 'arqueiro', weight: 24 },
      { classId: 'curandeira', weight: 12 }
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
    palette: {
      primary: '#2e6e8e', secondary: '#1d3a4d', accent: '#7ef0d4',
      floor1: '#24404f', floor2: '#2a4a5a', wall: '#16222c', lowWall: '#2b4756', voidColor: '#0d1a22'
    },
    defaultWeather: 'chuva',
    weatherShiftEveryRounds: 0,
    tileEventRate: 0.2,
    rooms: [
      {
        name: 'A Galeria das Goteiras',
        weather: 'chuva',
        sceneryTheme: 'cistern',
        layout: [
          '#############',
          '#P...~.~...a#',
          '#P..=~.~=...#',
          '#P...~.~..a.#',
          '#....~.~.=..#',
          '#..,.....,..#',
          '#..=.~.~....#',
          '#....~.~..b.#',
          '#P..=~.~=...#',
          '#....~.~...b#',
          '#############'
        ],
        monsters: { a: 'drowned-porter', b: 'moray-piper' }
      },
      {
        name: 'O Salão das Colunas de Sal',
        weather: 'calmo',
        sceneryTheme: 'cistern',
        layout: [
          '###############',
          '#P.....a......#',
          '#P..#==,==#...#',
          '#P.....,......#',
          '#..=#.....#=e.#',
          '#.....#=#.....#',
          '#...b.#~#..c..#',
          '#.....#=#.....#',
          '#..=#.....#=..#',
          '#......,....d.#',
          '#P..#==,==#...#',
          '#......,......#',
          '###############'
        ],
        monsters: { a: 'drowned-porter', b: 'moray-piper', c: 'brine-golem', d: 'lantern-jelly', e: 'fat-drop' }
      },
      {
        name: 'O Trono da Salmoura',
        weather: 'chuva',
        sceneryTheme: 'cistern',
        layout: [
          '#############',
          '#....,z,....#',
          '#...==.==...#',
          '#.b.......d.#',
          '#..~..=..~..#',
          '#..~.....~..#',
          '#=..,...,..=#',
          '#..~.....~..#',
          '#..~..=..~..#',
          '#.c.......b.#',
          '#...==.==...#',
          '#.P.P...P.P.#',
          '#############'
        ],
        monsters: { z: 'boss-baroness', b: 'moray-piper', d: 'lantern-jelly', c: 'sump-crab' }
      }
    ],
    lootTable: [
      { itemId: 'ci-porter-coat', weight: 30, minRoom: 0 },
      { itemId: 'ci-sunken-lantern', weight: 30, minRoom: 0 },
      { itemId: 'ci-salt-rapier', weight: 30, minRoom: 0 },
      { itemId: 'ci-brine-cuirass', weight: 12, minRoom: 0 },
      { itemId: 'ci-moray-flute', weight: 12, minRoom: 1 },
      { itemId: 'ci-tide-flask', weight: 12, minRoom: 1 },
      { itemId: 'ci-pearl-choker', weight: 4, minRoom: 2 }
    ],
    cardDrops: [
      { classId: 'arqueiro', weight: 18 },
      { classId: 'curandeira', weight: 20 },
      { classId: 'sumo', weight: 12 },
      { classId: 'espadachim', weight: 10 }
    ]
  });

// __FIM_DOS_CALABOUCOS__ (novos calabouços entram acima desta linha)
})(JOGO.DATA);
