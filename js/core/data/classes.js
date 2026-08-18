/* SOTERRA 2.0 — DATA.classes
 * Dono: Criativo Classes. Não editar em outro papel.
 * Seis classes jogáveis do mundo enterrado. Cada uma começa com 3 feitiços neutros
 * (identidade tática) e, a partir do nível 5, segue UM dos quatro caminhos elementais.
 * Ids dos feitiços: `<classe>-<elemento>-<nivelDeDesbloqueio>` (neutros usam 1/2/3).
 */
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

JOGO.DATA = JOGO.DATA || {};

JOGO.DATA.classes = {

  /* ---------------------------------------------------------------- TANQUE */
  sumo: {
    id: 'sumo',
    name: 'Bárbaro',
    role: 'tanque',
    description: 'Corpanzil, capa surrada e um machado de duas mãos: ocupa o gargalo e não sai dele. Provoca, prende, empurra e cobra caro cada célula do tabuleiro. Pouca pressa, muita presença.',
    lore: 'Quando a Lousa desceu, os construtores selaram os Fechos — e alguém teve de segurar o portão pelo lado de dentro. Ele segurou, com o machado do pai e as costas contra a pedra. Mil anos depois ainda bate o cabo no chão a cada manhã imaginária: enquanto o chão responder, o mundo ainda está de pé.',
    palette: { primary: '#d4553f', secondary: '#3a2b26', accent: '#ffd08a' },
    stats: {
      hp: 150, pa: 6, pp: 3, initiative: 15, power: 0, dodge: 5, lock: 40,
      resists: { fogo: 0, agua: 0, terra: 0, ar: 0, neutro: 0 }
    },
    baseSpells: ['sumo-neutro-1', 'sumo-neutro-2', 'sumo-neutro-3'],
    paths: {
      fogo: ['sumo-fogo-5', 'sumo-fogo-10', 'sumo-fogo-12', 'sumo-fogo-15', 'sumo-fogo-20', 'sumo-fogo-30'],
      agua: ['sumo-agua-5', 'sumo-agua-10', 'sumo-agua-12', 'sumo-agua-15', 'sumo-agua-20', 'sumo-agua-30'],
      terra: ['sumo-terra-5', 'sumo-terra-10', 'sumo-terra-12', 'sumo-terra-15', 'sumo-terra-20', 'sumo-terra-30'],
      ar: ['sumo-ar-5', 'sumo-ar-10', 'sumo-ar-12', 'sumo-ar-15', 'sumo-ar-20', 'sumo-ar-30']
    },
    startsUnlocked: true,
    cardRarity: 'comum'
  },

  /* -------------------------------------------------------------- ATIRADOR */
  arqueiro: {
    id: 'arqueiro',
    name: 'Batedor',
    role: 'atirador',
    description: 'Capuz fundo e besta de duas mãos. Dano à distância que se acumula: cada tiro deixa uma marca no alvo, e quem tem marcas demais recebe a conta toda de uma vez. Fraco de perto, letal de longe.',
    lore: 'Foram os batedores que mediram o teto de pedra dos Fechos e concluíram que ainda cabia um tiro entre ele e o chão. Desde então marcam tudo o que se move: as marcas são um caderno de contas, e nenhum Fecho jamais viu um batedor perdoar uma dívida.',
    palette: { primary: '#4f9d6a', secondary: '#26402f', accent: '#d8f0a0' },
    stats: {
      hp: 100, pa: 6, pp: 3, initiative: 70, power: 0, dodge: 25, lock: 10,
      resists: { fogo: 0, agua: 0, terra: 0, ar: 0, neutro: 0 }
    },
    baseSpells: ['arqueiro-neutro-1', 'arqueiro-neutro-2', 'arqueiro-neutro-3'],
    paths: {
      fogo: ['arqueiro-fogo-5', 'arqueiro-fogo-10', 'arqueiro-fogo-12', 'arqueiro-fogo-15', 'arqueiro-fogo-20', 'arqueiro-fogo-30'],
      agua: ['arqueiro-agua-5', 'arqueiro-agua-10', 'arqueiro-agua-12', 'arqueiro-agua-15', 'arqueiro-agua-20', 'arqueiro-agua-30'],
      terra: ['arqueiro-terra-5', 'arqueiro-terra-10', 'arqueiro-terra-12', 'arqueiro-terra-15', 'arqueiro-terra-20', 'arqueiro-terra-30'],
      ar: ['arqueiro-ar-5', 'arqueiro-ar-10', 'arqueiro-ar-12', 'arqueiro-ar-15', 'arqueiro-ar-20', 'arqueiro-ar-30']
    },
    startsUnlocked: false,
    cardRarity: 'epico'
  },

  /* ------------------------------------------------------------------ MAGO */
  bruxo: {
    id: 'bruxo',
    name: 'Bruxo',
    role: 'mago',
    description: 'Áreas de média e longa distância, maldições que trabalham sozinhas e controle do terreno. Apaga salas inteiras — desde que sobreviva ao tempo de conjuração.',
    lore: 'Quando o céu coagulou, houve quem tentasse ler a Lousa por dentro. Os que voltaram vieram com a caligrafia da pedra grudada nas mãos: agora escrevem no ar o que a Lousa escreveu no mundo, e o ar obedece do mesmo jeito. O chapéu pontudo é praxe da escola: aponta para o céu que não existe mais.',
    palette: { primary: '#7a5fa0', secondary: '#241c33', accent: '#b98cff' },
    stats: {
      hp: 95, pa: 6, pp: 3, initiative: 45, power: 0, dodge: 15, lock: 5,
      resists: { fogo: 0, agua: 0, terra: 0, ar: 0, neutro: 0 }
    },
    baseSpells: ['bruxo-neutro-1', 'bruxo-neutro-2', 'bruxo-neutro-3'],
    paths: {
      fogo: ['bruxo-fogo-5', 'bruxo-fogo-10', 'bruxo-fogo-12', 'bruxo-fogo-15', 'bruxo-fogo-20', 'bruxo-fogo-30'],
      agua: ['bruxo-agua-5', 'bruxo-agua-10', 'bruxo-agua-12', 'bruxo-agua-15', 'bruxo-agua-20', 'bruxo-agua-30'],
      terra: ['bruxo-terra-5', 'bruxo-terra-10', 'bruxo-terra-12', 'bruxo-terra-15', 'bruxo-terra-20', 'bruxo-terra-30'],
      ar: ['bruxo-ar-5', 'bruxo-ar-10', 'bruxo-ar-12', 'bruxo-ar-15', 'bruxo-ar-20', 'bruxo-ar-30']
    },
    startsUnlocked: false,
    cardRarity: 'raro'
  },

  /* ------------------------------------------------------------- ASSASSINO */
  espadachim: {
    id: 'espadachim',
    name: 'Ladino',
    role: 'assassino',
    description: 'Duas adagas, velocidade, invisibilidade e veneno. Vive de escolher a hora: entra pelo flanco, corta duas vezes e some antes da resposta. Morre depressa se errar a janela.',
    lore: 'Não existe noite num mundo sem céu — existe o breu entre duas lanternas, e é ali que ele mora. Aprendeu a andar no intervalo das luzes e a devolver, na ponta das duas adagas, a mesma escuridão que a Lousa entregou a todo mundo.',
    palette: { primary: '#2f6f8f', secondary: '#1b2733', accent: '#9be8ff' },
    stats: {
      hp: 95, pa: 6, pp: 4, initiative: 90, power: 0, dodge: 40, lock: 10,
      resists: { fogo: 0, agua: 0, terra: 0, ar: 0, neutro: 0 }
    },
    baseSpells: ['espadachim-neutro-1', 'espadachim-neutro-2', 'espadachim-neutro-3'],
    paths: {
      fogo: ['espadachim-fogo-5', 'espadachim-fogo-10', 'espadachim-fogo-12', 'espadachim-fogo-15', 'espadachim-fogo-20', 'espadachim-fogo-30'],
      agua: ['espadachim-agua-5', 'espadachim-agua-10', 'espadachim-agua-12', 'espadachim-agua-15', 'espadachim-agua-20', 'espadachim-agua-30'],
      terra: ['espadachim-terra-5', 'espadachim-terra-10', 'espadachim-terra-12', 'espadachim-terra-15', 'espadachim-terra-20', 'espadachim-terra-30'],
      ar: ['espadachim-ar-5', 'espadachim-ar-10', 'espadachim-ar-12', 'espadachim-ar-15', 'espadachim-ar-20', 'espadachim-ar-30']
    },
    startsUnlocked: false,
    cardRarity: 'epico'
  },

  /* --------------------------------------------------------------- SUPORTE */
  curandeira: {
    id: 'curandeira',
    name: 'Paladina',
    role: 'suporte',
    description: 'Cura, escuda e abençoa o grupo — e bate com o martelo quando ninguém precisa dela. Armadura clara, escudo de brasão e sempre a um passo de quem está sangrando.',
    lore: 'Herdou da avó a lanterna de vagalumes e a regra da casa: no mundo enterrado, quem apaga primeiro é quem parou de cuidar dos outros. Mandou polir a armadura até ficar clara de propósito — num Fecho escuro, quem cai precisa saber para onde correr. Ela não pretende apagar tão cedo.',
    palette: { primary: '#f0c05a', secondary: '#6b4a2f', accent: '#fff2c2' },
    stats: {
      hp: 110, pa: 6, pp: 3, initiative: 55, power: 0, dodge: 20, lock: 5,
      resists: { fogo: 0, agua: 0, terra: 0, ar: 0, neutro: 0 }
    },
    baseSpells: ['curandeira-neutro-1', 'curandeira-neutro-2', 'curandeira-neutro-3'],
    paths: {
      fogo: ['curandeira-fogo-5', 'curandeira-fogo-10', 'curandeira-fogo-12', 'curandeira-fogo-15', 'curandeira-fogo-20', 'curandeira-fogo-30'],
      agua: ['curandeira-agua-5', 'curandeira-agua-10', 'curandeira-agua-12', 'curandeira-agua-15', 'curandeira-agua-20', 'curandeira-agua-30'],
      terra: ['curandeira-terra-5', 'curandeira-terra-10', 'curandeira-terra-12', 'curandeira-terra-15', 'curandeira-terra-20', 'curandeira-terra-30'],
      ar: ['curandeira-ar-5', 'curandeira-ar-10', 'curandeira-ar-12', 'curandeira-ar-15', 'curandeira-ar-20', 'curandeira-ar-30']
    },
    startsUnlocked: true,
    cardRarity: 'comum'
  },

  /* ------------------------------------------------------------- INVOCADOR */
  invocador: {
    id: 'invocador',
    name: 'Xamã',
    role: 'invocador',
    description: 'Enche o tabuleiro com o grimório aberto numa das mãos: invoca criaturas que tancam e mordem, arma armadilhas nas células de passagem e fortalece quem estiver por perto. Sozinho é frágil; nunca está sozinho.',
    lore: 'Passou a vida ouvindo o micélio dos Fechos contar quem morreu onde. Um dia respondeu — e alguma coisa do outro lado achou graça. Hoje ele não invoca nada: apenas pede licença, e o mundo enterrado empresta um pedaço de si. Cada empréstimo vai anotado no grimório: dívida esquecida é a única que cobra juros.',
    palette: { primary: '#3f8f8a', secondary: '#1e3330', accent: '#8ff0d8' },
    stats: {
      hp: 105, pa: 6, pp: 3, initiative: 35, power: 0, dodge: 12, lock: 15,
      resists: { fogo: 0, agua: 0, terra: 0, ar: 0, neutro: 0 }
    },
    baseSpells: ['invocador-neutro-1', 'invocador-neutro-2', 'invocador-neutro-3'],
    paths: {
      fogo: ['invocador-fogo-5', 'invocador-fogo-10', 'invocador-fogo-12', 'invocador-fogo-15', 'invocador-fogo-20', 'invocador-fogo-30'],
      agua: ['invocador-agua-5', 'invocador-agua-10', 'invocador-agua-12', 'invocador-agua-15', 'invocador-agua-20', 'invocador-agua-30'],
      terra: ['invocador-terra-5', 'invocador-terra-10', 'invocador-terra-12', 'invocador-terra-15', 'invocador-terra-20', 'invocador-terra-30'],
      ar: ['invocador-ar-5', 'invocador-ar-10', 'invocador-ar-12', 'invocador-ar-15', 'invocador-ar-20', 'invocador-ar-30']
    },
    startsUnlocked: false,
    cardRarity: 'raro'
  }

};
