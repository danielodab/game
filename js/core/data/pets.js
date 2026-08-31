var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// SOTERRA 2.0 — PETS (dono: Criativo Fusão)
// Globais: DATA.pets  ·  extra aditivo: DATA.petSpells (mesclar em DATA.spells)
//
// O pet entra na batalha junto do dono (kind:'pet', side do dono), não conta
// para vitória/derrota, não recebe XP e age sozinho logo depois que o dono
// encerra o turno (Engine.runPetTurn), sempre voltando para <= followDistance
// do dono. Bônus do pet são FIXOS e valem enquanto ele estiver equipado.
//
// dropDungeon usa os ids de calabouço de DATA.dungeons (Criativo Mundo):
//   greenhouse (Estufa) · cistern (Cisterna) · emberlock (Fecho de Brasa)
//   windscaffold (Andaimes do Vento) · quakemine (Mina Trêmula)
//   brokenheart (Coração Partido)
// ============================================================================

JOGO.DATA = JOGO.DATA || {};

(function () {
  'use strict';

  var DATA = JOGO.DATA;

  function rng(min, max, line, los) {
    return { min: min, max: max, line: line === true, los: los !== false, movable: false };
  }
  function aoe(shape, size) { return { shape: shape, size: size || 0 }; }

  // -------------------------------------------------------------------------
  // Feitiços próprios dos pets (mesmo formato de DATA.spells)
  // -------------------------------------------------------------------------
  function petSpell(o) {
    return {
      id: o.id, name: o.name, element: o.element, classId: null, unlockLevel: 0,
      paCost: o.paCost, cooldown: o.cooldown || 0, castsPerTurn: o.castsPerTurn || 1,
      range: o.range, aoe: o.aoe || aoe('single', 0),
      needsEmptyTile: false, targetSide: o.targetSide,
      effects: o.effects, description: o.description, flavor: o.flavor, fxKey: o.fxKey
    };
  }

  DATA.petSpells = {

    'pet-ember-breath': petSpell({
      id: 'pet-ember-breath', name: 'Bafo de Brasa', element: 'fogo',
      paCost: 3, cooldown: 0, castsPerTurn: 1, range: rng(1, 3), targetSide: 'enemy',
      effects: [
        { type: 'damage', element: 'fogo', min: 12, max: 17 },
        { type: 'poison', element: 'fogo', min: 3, max: 5, duration: 2 }
      ],
      description: 'O dragãozinho enche o peito, fecha os olhos com força e solta um jato curto de brasa que continua queimando depois.',
      flavor: 'Ele acha que fez muito barulho. Fez mesmo.',
      fxKey: 'bolt'
    }),

    'pet-vine-chomp': petSpell({
      id: 'pet-vine-chomp', name: 'Bocada', element: 'terra',
      paCost: 3, cooldown: 0, castsPerTurn: 1, range: rng(1, 1), targetSide: 'enemy',
      effects: [
        { type: 'damage', element: 'terra', min: 14, max: 19 },
        { type: 'root', duration: 1 }
      ],
      description: 'A planta carnívora fecha a boca no tornozelo do inimigo e não solta: quem foi mordido não sai do lugar neste turno.',
      flavor: 'Mastiga devagar. Está aproveitando.',
      fxKey: 'hook'
    }),

    'pet-gale-buffet': petSpell({
      id: 'pet-gale-buffet', name: 'Vergastada de Asa', element: 'ar',
      paCost: 3, cooldown: 0, castsPerTurn: 1, range: rng(1, 4), targetSide: 'enemy',
      effects: [
        { type: 'damage', element: 'ar', min: 10, max: 15 },
        { type: 'push', tiles: 2 }
      ],
      description: 'A águia mergulha, bate as asas uma vez a um palmo do rosto do inimigo e o empurra duas células para trás.',
      flavor: 'O vento dela tem opinião sobre onde você deveria estar.',
      fxKey: 'gust'
    }),

    'pet-dew-mend': petSpell({
      id: 'pet-dew-mend', name: 'Borrifo', element: 'agua',
      paCost: 3, cooldown: 0, castsPerTurn: 1, range: rng(0, 4), targetSide: 'ally',
      effects: [
        { type: 'heal', min: 14, max: 19 },
        { type: 'regen', min: 4, max: 6, duration: 2 }
      ],
      description: 'A criaturinha de água se aperta como uma esponja e borrifa água limpa no aliado mais machucado.',
      flavor: 'Fica menorzinha depois. Enche de novo sozinha.',
      fxKey: 'heal'
    }),

    'pet-dew-rinse': petSpell({
      id: 'pet-dew-rinse', name: 'Enxágue', element: 'agua',
      paCost: 2, cooldown: 3, castsPerTurn: 1, range: rng(0, 3), targetSide: 'ally',
      effects: [
        { type: 'cleanse', kinds: ['poison', 'root'] },
        { type: 'resist', element: 'agua', value: 15, duration: 2 }
      ],
      description: 'Se despeja inteira sobre o aliado e leva embora o veneno e as raízes que o prendiam.',
      flavor: 'Não pergunte para onde vai o que ela lava.',
      fxKey: 'heal'
    }),

    'pet-guide-hum': petSpell({
      id: 'pet-guide-hum', name: 'Zumbido-Guia', element: 'neutro',
      paCost: 3, cooldown: 1, castsPerTurn: 1, range: rng(0, 4), targetSide: 'ally',
      effects: [
        { type: 'buff', stat: 'power', value: 15, duration: 2 },
        { type: 'buff', stat: 'initiative', value: 10, duration: 2 }
      ],
      description: 'A pedrinha-guia zumbe numa nota que só o aliado escuta: os golpes dele saem mais certeiros e mais cedo.',
      flavor: 'Aponta sempre para o perigo. É o defeito dela.',
      fxKey: 'buff'
    }),

    'pet-shard-ward': petSpell({
      id: 'pet-shard-ward', name: 'Lasca-Escudo', element: 'neutro',
      paCost: 3, cooldown: 1, castsPerTurn: 1, range: rng(0, 4), targetSide: 'ally',
      effects: [
        { type: 'shield', value: 22, duration: 2 },
        { type: 'cleanse', kinds: ['poison'] }
      ],
      description: 'O caco vivo se estilhaça de propósito e as lascas orbitam o aliado como uma redoma curta.',
      flavor: 'Ele se remonta no turno seguinte. Reclamando.',
      fxKey: 'shieldFx'
    }),

    'pet-shard-echo': petSpell({
      id: 'pet-shard-echo', name: 'Eco Partido', element: 'neutro',
      paCost: 3, cooldown: 2, castsPerTurn: 1, range: rng(1, 4), targetSide: 'enemy',
      effects: [
        { type: 'damage', element: 'neutro', min: 13, max: 18 },
        { type: 'mark', value: 5, duration: 2, max: 3 }
      ],
      description: 'Solta um eco do Coração Partido que bate no inimigo e deixa uma trinca luminosa por onde tudo dói mais.',
      flavor: 'O som é o de uma sala muito maior do que esta.',
      fxKey: 'burst'
    })
  };

  // -------------------------------------------------------------------------
  // Os pets
  // -------------------------------------------------------------------------
  DATA.pets = {

    'pet-emberling': {
      id: 'pet-emberling', name: 'Brasinha', element: 'fogo',
      description: 'Dragãozinho do tamanho de um gato gordo, escamas cor de carvão aceso com as bordas alaranjadas pulsando conforme respira. Asas curtas demais para voar direito — ele mais dá pulos longos e planeia. Chifrinhos ainda moles, barriga clara, e uma fumacinha permanente saindo de uma narina só. Quando ataca, infla o peito inteiro e o brilho interno vaza pelas frestas das escamas; quando está parado, se enrosca ao lado do dono como um braseiro vivo.',
      bonuses: { power: 8, hp: 10, resists: { fogo: 10, agua: -5 } },
      behavior: 'attack', range: 3, followDistance: 2,
      spells: ['pet-ember-breath'],
      dropDungeon: 'emberlock', dropWeight: 10
    },

    'pet-snapvine': {
      id: 'pet-snapvine', name: 'Bocarra', element: 'terra',
      description: 'Planta carnívora num vaso de barro rachado que ela carrega andando com duas raízes-pernas. Cabeça-boca enorme, lábios verdes com manchas amareladas, dentes brancos triangulares grandes demais para o corpo e uma língua vermelha comprida que fica de fora quando está feliz. Duas folhas na base do talo funcionam como sobrancelhas e denunciam o humor. Ataca esticando o talo num bote e mordendo o tornozelo — depois fica de boca fechada, mastigando, com as folhas erguidas de orgulho.',
      bonuses: { hp: 25, lock: 10, resists: { terra: 10, ar: -5 } },
      behavior: 'guard', range: 1, followDistance: 1,
      spells: ['pet-vine-chomp'],
      dropDungeon: 'greenhouse', dropWeight: 12
    },

    'pet-galehawk': {
      id: 'pet-galehawk', name: 'Rasga-Ar', element: 'ar',
      description: 'Águia magra de penas cinza-claro com as pontas quase transparentes, como se o ar estivesse comendo as bordas dela. Envergadura maior que a altura de um herói, peito branco, olhos amarelos sem pálpebra aparente. Voa sempre um pouco acima da linha das cabeças e deixa um risco fino de vento atrás. No ataque, dobra as asas, mergulha e abre tudo de uma vez a um palmo do alvo: o estouro de ar é o golpe, as garras são só o susto.',
      bonuses: { initiative: 15, pp: 1, dodge: 10, resists: { ar: 10, terra: -5 } },
      behavior: 'attack', range: 4, followDistance: 3,
      spells: ['pet-gale-buffet'],
      dropDungeon: 'windscaffold', dropWeight: 9
    },

    'pet-dewling': {
      id: 'pet-dewling', name: 'Borbulha', element: 'agua',
      description: 'Uma gota de água do tamanho de um cão sentado, com pele-tensão que faz ondinhas quando ela anda. Por dentro flutuam três folhinhas e uma pedrinha lisa que ela nunca explica. Não tem boca: os olhos são duas bolhas mais escuras que sobem e descem. Anda saltitando com um plop. Para curar, se aperta como esponja e borrifa; para limpar, se despeja inteira sobre o aliado e se remonta no chão logo depois, um pouco mais baixinha.',
      bonuses: { hp: 20, power: 4, resists: { agua: 10, fogo: -5 } },
      behavior: 'support', range: 4, followDistance: 2,
      spells: ['pet-dew-mend', 'pet-dew-rinse'],
      dropDungeon: 'cistern', dropWeight: 11
    },

    'pet-lodestone': {
      id: 'pet-lodestone', name: 'Pedrinha-Guia', element: 'neutro',
      description: 'Um filhote de golem do tamanho de um gato atarracado, de pedra lisa com musgo nas juntas e olhos de cristal branco cheios de lealdade. No peito, um sulco em espiral com pó de ferro gira como uma bússola viva, apontando o perigo antes de todo mundo. Três pedrinhas orbitam ao redor dele como filhotinhos. Senta como cachorro esperando ordem, e quando abençoa alguém a espiral pulsa em luz branca.',
      bonuses: { power: 10, initiative: 10, resists: { neutro: 10 } },
      behavior: 'support', range: 3, followDistance: 2,
      spells: ['pet-guide-hum'],
      dropDungeon: 'quakemine', dropWeight: 8
    },

    'pet-heartshard': {
      id: 'pet-heartshard', name: 'Caco Vivo', element: 'neutro',
      description: 'Uma raposinha de vidro fumê do tamanho de um gato, com um coração de brasa multicolorida pulsando visível no peito — um estilhaço do próprio Coração Partido, que criou corpo e criou apego. A cauda termina em lascas de cristal soltas, e seis lasquinhas orbitam ao redor dela em ritmos diferentes, como um cortejo. O coração muda de cor com o clima da sala; quando protege alguém, as seis lasquinhas disparam e formam uma redoma curta, depois voltam uma a uma.',
      bonuses: { hp: 15, power: 6, resists: { fogo: 5, agua: 5, terra: 5, ar: 5, neutro: 5 } },
      behavior: 'support', range: 4, followDistance: 2,
      spells: ['pet-shard-ward', 'pet-shard-echo'],
      dropDungeon: 'brokenheart', dropWeight: 6
    }
  };

})();
