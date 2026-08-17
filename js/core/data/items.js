var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// SOTERRA 2.0 — ITENS (dono: Criativo Fusão)
// Globais: DATA.items  ·  extra aditivo: DATA.itemSpells (mesclar em DATA.spells)
//
// Os quatro espaços (CONTRACT_V2 §8 + §9-C), cada um com ficção própria:
//   'punho' — PUNHO: o que golpeia (manopla, garra, empunhadura, malho).
//             Carrega PA: +1 PA SOMENTE em item épico; os demais pagam em
//             iniciativa/poder/fixação.
//   'passo' — PASSO: o que anda (botas, esporas, grevas, grilhões).
//             Carrega PP: no máximo +1 PP.
//   'casca' — CASCA: o que protege (couraça, carapaça, manto, casco).
//             De +10 a +60 PV e resistências.
//   'lume'  — LUME: a relíquia ACESA que se carrega no escuro (lanterna, candeia,
//             braseiro, ferro em brasa). Concede um feitiço novo (grantsSpell) e
//             NENHUM bônus de PA/PP. Todo Lume tem luz própria — a única exceção
//             é a Lente de Eclipse, o Lume que apaga.
// O espaço de PET continua separado destes quatro.
//
// Prefixo do id = calabouço (o Criativo Mundo referencia estes ids nas lootTables):
//   gh- Estufa Soterrada (greenhouse) · ci- Cisterna dos Afogados (cistern)
//   em- Fecho de Brasa (emberlock)    · av- Andaimes do Vento (windscaffold)
//   mt- Mina Trêmula (quakemine)      · cp- Coração Partido (brokenheart)
//
// Um item ÉPICO por calabouço é o troféu do chefe (dois no Coração Partido, que
// é o desafio final). Poder e raridade crescem com a ordem do calabouço.
//
// --- ADENDO v2.1 (CONTRACT_V2 §9-B) -----------------------------------------
// CONJUNTOS (DATA.sets): 2 conjuntos por calabouço, 4 peças cada (uma por
//   espaço: pa/pp/vida/especial) = 12 conjuntos cobrindo os 48 itens. O
//   `element` do conjunto é o elemento dos MONSTROS que derrubam as peças, e
//   cada item herda esse elemento (ver rodapé: os campos `element`, `setId` e
//   `dropWeight` de cada item são preenchidos a partir do conjunto, para que
//   item e conjunto nunca possam divergir).
// FORJA (DATA.stones + DATA.upgrade): 5 pedras, uma por elemento. Melhorar um
//   item consome pedras DO ELEMENTO DO ITEM (item neutro aceita qualquer pedra).
// SAQUE (DATA.lootWeights): peso por raridade — raro e épico são MUITO mais
//   difíceis que comum (30 / 7 / 2, antes de aplicar a Sorte de Saque).
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
  // Feitiços concedidos pelos itens do espaço 'especial'
  // -------------------------------------------------------------------------
  function itemSpell(o) {
    return {
      id: o.id, name: o.name, element: o.element, classId: null, unlockLevel: 0,
      paCost: o.paCost, cooldown: o.cooldown, castsPerTurn: o.castsPerTurn || 1,
      range: o.range, aoe: o.aoe || aoe('single', 0),
      needsEmptyTile: o.needsEmptyTile === true, targetSide: o.targetSide,
      effects: o.effects, description: o.description, flavor: o.flavor, fxKey: o.fxKey
    };
  }

  DATA.itemSpells = {

    'is-seed-bomb': itemSpell({
      id: 'is-seed-bomb', name: 'Bomba de Sementes', element: 'terra',
      paCost: 3, cooldown: 3, range: rng(1, 4), aoe: aoe('circle', 1), targetSide: 'enemy',
      effects: [
        { type: 'damage', element: 'terra', min: 18, max: 24 },
        { type: 'poison', element: 'terra', min: 5, max: 8, duration: 2 }
      ],
      description: 'Arremessa um punhado de sementes de vagem estourante: elas abrem no ar e brotam dentro de quem estiver na roda.',
      flavor: 'A estufa continua semeando. Você só escolhe onde.',
      fxKey: 'burst'
    }),

    'is-thorn-ward': itemSpell({
      id: 'is-thorn-ward', name: 'Redoma de Espinhos', element: 'terra',
      paCost: 2, cooldown: 4, range: rng(0, 0, false, false), targetSide: 'self',
      effects: [
        { type: 'shield', value: 30, duration: 2 },
        { type: 'reflect', pct: 20, duration: 2 }
      ],
      description: 'Escudo de emergência: uma sebe de espinhos fecha em volta do corpo e devolve parte do que bater nela.',
      flavor: 'Cresce rápido demais para ser educada.',
      fxKey: 'shieldFx'
    }),

    'is-undertow': itemSpell({
      id: 'is-undertow', name: 'Ressaca', element: 'agua',
      paCost: 3, cooldown: 2, range: rng(2, 6), targetSide: 'enemy',
      effects: [
        { type: 'damage', element: 'agua', min: 14, max: 19 },
        { type: 'pull', tiles: 3 }
      ],
      description: 'Abre no chão uma correnteza curta que arrasta o alvo três células na sua direção.',
      flavor: 'A cisterna nunca devolveu nada de graça — mas devolve.',
      fxKey: 'hook'
    }),

    'is-tide-mend': itemSpell({
      id: 'is-tide-mend', name: 'Maré Mansa', element: 'agua',
      paCost: 3, cooldown: 3, range: rng(0, 4), targetSide: 'ally',
      effects: [
        { type: 'heal', min: 22, max: 29 },
        { type: 'cleanse', kinds: ['poison', 'root'] }
      ],
      description: 'Uma onda baixa passa pelo aliado, fecha o que estava aberto e leva embora veneno e raízes.',
      flavor: 'Água parada há mil anos ainda sabe subir quando pedem.',
      fxKey: 'heal'
    }),

    'is-cinder-leap': itemSpell({
      id: 'is-cinder-leap', name: 'Salto de Brasa', element: 'fogo',
      paCost: 2, cooldown: 3, range: rng(1, 5), aoe: aoe('circle', 1),
      needsEmptyTile: true, targetSide: 'any',
      effects: [
        { type: 'teleport' },
        { type: 'damage', element: 'fogo', min: 12, max: 17 }
      ],
      description: 'O corpo vira fagulha, atravessa o ar e se remonta na célula escolhida — o estouro da chegada queima a vizinhança.',
      flavor: 'Chegar é fácil. O difícil é avisar.',
      fxKey: 'blink'
    }),

    'is-forge-brand': itemSpell({
      id: 'is-forge-brand', name: 'Ferro de Marcar', element: 'fogo',
      paCost: 3, cooldown: 2, range: rng(1, 5), targetSide: 'enemy',
      effects: [
        { type: 'damage', element: 'fogo', min: 16, max: 21 },
        { type: 'mark', value: 8, duration: 3, max: 4 }
      ],
      description: 'Grava no inimigo a marca da forja: tudo o que o atingir depois disso dói mais.',
      flavor: 'O Fecho marca o gado dele. Agora você também.',
      fxKey: 'debuff'
    }),

    'is-updraft': itemSpell({
      id: 'is-updraft', name: 'Lufada', element: 'ar',
      paCost: 2, cooldown: 2, range: rng(1, 4), targetSide: 'enemy',
      effects: [
        { type: 'damage', element: 'ar', min: 12, max: 17 },
        { type: 'push', tiles: 3 }
      ],
      description: 'Uma coluna de ar sobe debaixo do inimigo e o joga três células para trás — em andaime, isso costuma resolver a discussão.',
      flavor: 'O vento dos Andaimes não empurra: publica opinião.',
      fxKey: 'gust'
    }),

    'is-storm-chain': itemSpell({
      id: 'is-storm-chain', name: 'Corrente de Tormenta', element: 'ar',
      paCost: 4, cooldown: 3, range: rng(1, 6), targetSide: 'enemy',
      effects: [
        { type: 'chain', jumps: 3, falloff: 0.65, element: 'ar', min: 16, max: 22 }
      ],
      description: 'Corrente elemental: o raio pula de inimigo em inimigo até três vezes, perdendo força a cada salto.',
      flavor: 'Conta os corpos sozinha. Sempre conta certo.',
      fxKey: 'beam'
    }),

    'is-quake-nail': itemSpell({
      id: 'is-quake-nail', name: 'Prego de Tremor', element: 'terra',
      paCost: 3, cooldown: 3, range: rng(1, 4), targetSide: 'enemy',
      effects: [
        { type: 'damage', element: 'terra', min: 15, max: 20 },
        { type: 'root', duration: 2 }
      ],
      description: 'Um prego de minério é cravado no chão sob o alvo: ele fica dois turnos exatamente onde está.',
      flavor: 'A mina prega tudo o que se mexe demais.',
      fxKey: 'slam'
    }),

    'is-ore-bulwark': itemSpell({
      id: 'is-ore-bulwark', name: 'Escora de Minério', element: 'terra',
      paCost: 3, cooldown: 4, range: rng(0, 3), targetSide: 'ally',
      effects: [
        { type: 'shield', value: 45, duration: 2 },
        { type: 'buff', stat: 'lock', value: 15, duration: 2 }
      ],
      description: 'Sobe do chão uma escora de minério bruto na frente do aliado: escudo grosso e ninguém escapa de perto dele.',
      flavor: 'Escoraram o teto com isso por mil anos. O teto continua lá.',
      fxKey: 'shieldFx'
    }),

    'is-heart-call': itemSpell({
      id: 'is-heart-call', name: 'Chamado do Coração', element: 'neutro',
      paCost: 4, cooldown: 3, range: rng(0, 0, false, false), aoe: aoe('circle', 3), targetSide: 'enemy',
      effects: [
        { type: 'pull', tiles: 3 },
        { type: 'damage', element: 'neutro', min: 14, max: 19 }
      ],
      description: 'O caco toca uma nota que o Coração Partido reconhece: tudo que é hostil num raio de três células é arrastado para perto de você.',
      flavor: 'Chamar todo mundo de uma vez é uma decisão. Boa sorte.',
      fxKey: 'nova'
    }),

    'is-heart-eclipse': itemSpell({
      id: 'is-heart-eclipse', name: 'Eclipse', element: 'neutro',
      paCost: 5, cooldown: 4, range: rng(1, 6), aoe: aoe('circle', 2), targetSide: 'enemy',
      effects: [
        { type: 'weatherShift', weather: 'calmo' },
        { type: 'damage', element: 'neutro', min: 24, max: 32 },
        { type: 'dispelShield' }
      ],
      description: 'A lente apaga o clima da sala por um instante e o que sobra cai em cima do inimigo sem escudo e sem elemento para se apoiar.',
      flavor: 'Por um segundo, ninguém tem vantagem nenhuma. Use o segundo.',
      fxKey: 'nova'
    })
  };

  // -------------------------------------------------------------------------
  // Os itens
  // -------------------------------------------------------------------------
  DATA.items = {};
  var I = DATA.items;

  // `element`, `setId` e `dropWeight` são preenchidos no rodapé a partir de
  // DATA.sets / DATA.lootWeights — nunca à mão, para não divergirem.
  function item(o) {
    I[o.id] = {
      id: o.id, name: o.name, slot: o.slot, rarity: o.rarity, dungeonId: o.dungeonId,
      element: null, setId: null, dropWeight: 0,
      bonuses: o.bonuses || {}, grantsSpell: o.grantsSpell || null,
      description: o.description, flavor: o.flavor, iconKey: o.iconKey
    };
  }

  // ===== 1. A ESTUFA SOTERRADA (greenhouse) — gh- ==========================
  item({ id: 'gh-firefly-crown', name: 'Garra de Vagalumes', slot: 'punho', rarity: 'comum',
    dungeonId: 'greenhouse', bonuses: { initiative: 8, power: 3 },
    description: 'Luva de arame com três redomas minúsculas nos nós dos dedos, cada uma com um vagalume da goteira vivo dentro da própria poça. +8 de iniciativa, +3 de poder.',
    flavor: 'Acendem meio segundo antes do soco. Aprenda com eles.',
    iconKey: 'firefly-claw' });

  item({ id: 'gh-widow-shears', name: 'Tesourão da Viúva', slot: 'punho', rarity: 'epico',
    dungeonId: 'greenhouse', bonuses: { pa: 1, power: 10 },
    description: 'O tesourão de poda da Jardineira-Viúva, mais alto que uma criança e ainda pegajoso de seiva. +1 PA, +10 de poder.',
    flavor: 'Ela podava o jardim. Agora você poda o mundo.',
    iconKey: 'great-shears' });

  item({ id: 'gh-moss-treads', name: 'Solados de Musgo', slot: 'passo', rarity: 'comum',
    dungeonId: 'greenhouse', bonuses: { dodge: 8, initiative: 4 },
    description: 'Sandálias forradas com musgo vivo que agarra o piso molhado e não faz barulho. +8 de esquiva, +4 de iniciativa.',
    flavor: 'O musgo cresce de volta toda noite. Não pergunte do quê.',
    iconKey: 'moss-boots' });

  item({ id: 'gh-vine-stirrups', name: 'Estribos de Hera', slot: 'passo', rarity: 'raro',
    dungeonId: 'greenhouse', bonuses: { pp: 1, dodge: 5 },
    description: 'Duas heras vivas enroladas nas canelas que empurram o passo seguinte antes de você pedir. +1 PP, +5 de esquiva.',
    flavor: 'Elas sabem para onde você vai. Discordam pouco.',
    iconKey: 'vine-stirrup' });

  item({ id: 'gh-trellis-guard', name: 'Guarda de Treliça', slot: 'casca', rarity: 'comum',
    dungeonId: 'greenhouse', bonuses: { hp: 15, resists: { terra: 5 } },
    description: 'Placa de treliça de madeira coberta de hera, amarrada ao peito com corda de estufa. +15 PV, +5% de resistência a terra.',
    flavor: 'A hera que o cobre aperta o seu braço com carinho.',
    iconKey: 'trellis-shield' });

  item({ id: 'gh-sap-apron', name: 'Avental de Seiva', slot: 'casca', rarity: 'raro',
    dungeonId: 'greenhouse', bonuses: { hp: 30, resists: { terra: 10, agua: 5 } },
    description: 'Avental de jardineiro encharcado de seiva endurecida, duro como couro cozido. +30 PV, +10% terra, +5% água.',
    flavor: 'Os bolsos ainda têm sementes. Não plante nenhuma.',
    iconKey: 'apron' });

  item({ id: 'gh-seed-pouch', name: 'Candeia de Vagens', slot: 'lume', rarity: 'comum',
    dungeonId: 'greenhouse', bonuses: { power: 3 }, grantsSpell: 'is-seed-bomb',
    description: 'Candeia de vidro cujo combustível são vagens estourantes colhidas verdes: elas brilham verde enquanto fermentam e vão junto quando o vidro se abre. Concede o feitiço Bomba de Sementes.',
    flavor: 'Chacoalhar é desaconselhado. Todo mundo chacoalha.',
    iconKey: 'seed-lamp' });

  item({ id: 'gh-briar-charm', name: 'Fogaréu de Sarça', slot: 'lume', rarity: 'raro',
    dungeonId: 'greenhouse', bonuses: { hp: 10 }, grantsSpell: 'is-thorn-ward',
    description: 'Um nó de sarça da calha que arde sem se consumir, preso numa gaiola de arame. Quando o dono se assusta, a chama sobe e os espinhos fecham em volta dele. Concede o feitiço Redoma de Espinhos.',
    flavor: 'Queima há mil anos e continua verde por dentro. Ninguém explicou.',
    iconKey: 'briar-brazier' });

  // ===== 2. A CISTERNA DOS AFOGADOS (cistern) — ci- ========================
  item({ id: 'ci-lantern-fob', name: 'Garra do Afogadiço', slot: 'punho', rarity: 'comum',
    dungeonId: 'cistern', bonuses: { initiative: 10 },
    description: 'A mão inchada de um carregador da corte, endurecida em salmoura e calçada como luva. Continua agarrando primeiro e perguntando depois. +10 de iniciativa.',
    flavor: 'Ela pega antes de você decidir pegar. Deixe.',
    iconKey: 'drowned-claw' });

  item({ id: 'ci-harpoon-flute', name: 'Flauta-Arpão', slot: 'punho', rarity: 'raro',
    dungeonId: 'cistern', bonuses: { power: 10, initiative: 5 },
    description: 'Osso longo com três furos de flauta e uma ponta farpada; assobia grave quando corta o ar. +10 de poder, +5 de iniciativa.',
    flavor: 'Assobia a mesma nota grave a cada golpe: desça.',
    iconKey: 'flute' });

  item({ id: 'ci-current-fins', name: 'Membranas de Correnteza', slot: 'passo', rarity: 'comum',
    dungeonId: 'cistern', bonuses: { dodge: 10, initiative: 4 },
    description: 'Membranas finas esticadas entre os dedos dos pés e presas ao tornozelo: cada passada empurra a água parada como se ela concordasse. +10 de esquiva, +4 de iniciativa.',
    flavor: 'Servem em terra firme. Ninguém entende como.',
    iconKey: 'fins' });

  item({ id: 'ci-baroness-collar', name: 'Escarpins da Baronesa', slot: 'passo', rarity: 'epico',
    dungeonId: 'cistern', bonuses: { pp: 1, hp: 15, initiative: 8 },
    description: 'Os sapatos de baile da Baronesa Salmoura, com fivelas de pérola de lodo e sola que não encosta no fundo. A água abre caminho na frente deles. +1 PP, +15 PV, +8 de iniciativa.',
    flavor: 'A maré abre caminho para quem os calça. Por respeito — ou por medo.',
    iconKey: 'pearl-shoes' });

  item({ id: 'ci-brine-cuirass', name: 'Couraça de Salmoura', slot: 'casca', rarity: 'comum',
    dungeonId: 'cistern', bonuses: { hp: 20, resists: { agua: 8 } },
    description: 'Peitoral de placas de sal cristalizado, leve e cortante nas bordas. +20 PV, +8% de resistência a água.',
    flavor: 'Quanto mais quebra, mais afiada fica. Igual ao dono anterior.',
    iconKey: 'salt-plate' });

  item({ id: 'ci-drowned-coat', name: 'Casaca do Carregador', slot: 'casca', rarity: 'raro',
    dungeonId: 'cistern', bonuses: { hp: 35, resists: { agua: 12, fogo: 5 } },
    description: 'Casaca de gola alta que escorre água para sempre e pesa como um abraço. +35 PV, +12% água, +5% fogo.',
    flavor: 'Quem a veste nunca larga o que carrega. Cuidado com o que carrega.',
    iconKey: 'coat' });

  item({ id: 'ci-tide-flask', name: 'Lanterna de Maré', slot: 'lume', rarity: 'comum',
    dungeonId: 'cistern', bonuses: { power: 4 }, grantsSpell: 'is-undertow',
    description: 'Lampião submerso cuja chama nunca soube que afogou. A linha d’água dentro do vidro fica sempre inclinada — e a água de fora inclina junto. Concede o feitiço Ressaca.',
    flavor: 'Duas vezes por dia a lanterna puxa. Ninguém sabe para onde.',
    iconKey: 'tide-lantern' });

  item({ id: 'ci-jelly-vial', name: 'Ampola de Água-Viva', slot: 'lume', rarity: 'raro',
    dungeonId: 'cistern', bonuses: { hp: 12 }, grantsSpell: 'is-tide-mend',
    description: 'Ampola morna com uma água-viva-lustre viva lá dentro, pulsando devagar e iluminando três células de corredor a cada pulso. Concede o feitiço Maré Mansa.',
    flavor: 'Ela ilumina e cura porque acha que você é o aquário.',
    iconKey: 'jelly-vial' });

  // ===== 3. O FECHO DE BRASA (emberlock) — em- =============================
  item({ id: 'em-bellows-valve', name: 'Manopla de Fole', slot: 'punho', rarity: 'comum',
    dungeonId: 'emberlock', bonuses: { initiative: 12 },
    description: 'Manopla de latão com um fole sanfonado no antebraço: o punho fecha, a válvula abre e o ar comprimido chega antes da mão. +12 de iniciativa.',
    flavor: 'O assobio é meio segundo de vantagem. Nos Fechos, é uma vida.',
    iconKey: 'bellows-gauntlet' });

  item({ id: 'em-forge-grate', name: 'Malho do Primeiro Fogo', slot: 'punho', rarity: 'epico',
    dungeonId: 'emberlock', bonuses: { pa: 1, power: 12, resists: { fogo: 10 } },
    description: 'O malho de Magno, com a cabeça vazada em grelha e brasa viva presa entre as barras. Cada golpe respira. +1 PA, +12 de poder, +10% fogo.',
    flavor: 'Bateu o primeiro fogo do mundo. Não impressiona fácil.',
    iconKey: 'forge-maul' });

  item({ id: 'em-cinder-treads', name: 'Solados de Escória', slot: 'passo', rarity: 'raro',
    dungeonId: 'emberlock', bonuses: { pp: 1, initiative: 6 },
    description: 'Solas de escória fria que não queimam no piso da forja e ainda dão um empurrão em cada passada. +1 PP, +6 de iniciativa.',
    flavor: 'Andar sobre brasa é questão de sola, dizem eles.',
    iconKey: 'slag-boots' });

  item({ id: 'em-chain-harness', name: 'Grilhões de Forja', slot: 'passo', rarity: 'raro',
    dungeonId: 'emberlock', bonuses: { dodge: 12, lock: 8 },
    description: 'Correntes do teto da forja fechadas nos tornozelos: dão balanço de pêndulo para desviar e peso de âncora para segurar quem tentar fugir. +12 de esquiva, +8 de fixação.',
    flavor: 'Prendiam alguma coisa antes. Agora andam com você — de boa vontade.',
    iconKey: 'forge-shackles' });

  item({ id: 'em-riveted-plate', name: 'Chapa Rebitada', slot: 'casca', rarity: 'comum',
    dungeonId: 'emberlock', bonuses: { hp: 25, resists: { fogo: 8 } },
    description: 'Placa retangular arrancada do portão da forja, com quatro rebites nos cantos. +25 PV, +8% fogo.',
    flavor: 'O portão não sente falta. Provavelmente.',
    iconKey: 'riveted-plate' });

  item({ id: 'em-soot-mantle', name: 'Manto de Fuligem', slot: 'casca', rarity: 'raro',
    dungeonId: 'emberlock', bonuses: { hp: 40, resists: { fogo: 15, ar: 5 } },
    description: 'Manto que esfarela em partículas na barra e se refaz sozinho enquanto houver fumaça na sala. +40 PV, +15% fogo, +5% ar.',
    flavor: 'Às vezes ele lembra que já foi alguém — e te abraça.',
    iconKey: 'soot-cloak' });

  item({ id: 'em-ember-flask', name: 'Lampião de Fagulha', slot: 'lume', rarity: 'raro',
    dungeonId: 'emberlock', bonuses: { initiative: 6 }, grantsSpell: 'is-cinder-leap',
    description: 'Lampião de vidro grosso com uma fagulha inquieta batendo nas paredes por dentro. Ela sempre sabe o caminho de volta ao dono — e às vezes vai na frente. Concede o feitiço Salto de Brasa.',
    flavor: 'Ela vai primeiro. Você vai junto. Combinem antes.',
    iconKey: 'spark-lantern' });

  item({ id: 'em-brand-iron', name: 'Ferro em Brasa', slot: 'lume', rarity: 'raro',
    dungeonId: 'emberlock', bonuses: { power: 8 }, grantsSpell: 'is-forge-brand',
    description: 'Ferro de marcar com o timbre do Fecho na ponta, vermelho-vivo há mil anos sem forja nenhuma por perto. Ilumina o corredor de laranja e cheira a metal quente. Concede o feitiço Ferro de Marcar.',
    flavor: 'O Ferreiro Sem-Rosto marcava tudo. Inclusive a si mesmo.',
    iconKey: 'brand-iron' });

  // ===== 4. OS ANDAIMES DO VENTO (windscaffold) — av- ======================
  item({ id: 'av-kite-crest', name: 'Garra de Vareta', slot: 'punho', rarity: 'raro',
    dungeonId: 'windscaffold', bonuses: { initiative: 14, power: 8 },
    description: 'Cinco varetas de papagaio amarradas aos dedos com pano esticado entre elas: a mão vira asa e o golpe vem com a corrente junto. +14 de iniciativa, +8 de poder.',
    flavor: 'Puxa para cima o tempo todo. Você se acostuma a inclinar.',
    iconKey: 'kite-claw' });

  item({ id: 'av-plank-gauntlet', name: 'Manopla de Tábua', slot: 'punho', rarity: 'raro',
    dungeonId: 'windscaffold', bonuses: { power: 14, lock: 6 },
    description: 'Tábua de andaime amarrada ao antebraço com corda alcatroada: bate como remo e segura como corrimão. +14 de poder, +6 de fixação.',
    flavor: 'Já foi piso. Prefere ser argumento.',
    iconKey: 'plank-gauntlet' });

  item({ id: 'av-glider-cloak', name: 'Esporas de Vão', slot: 'passo', rarity: 'raro',
    dungeonId: 'windscaffold', bonuses: { pp: 1, dodge: 10 },
    description: 'Esporas de vareta e pano que abrem como leque a cada passada e pegam a corrente que sobe do vão: transformam a queda em passo. +1 PP, +10 de esquiva.',
    flavor: 'Nos Andaimes, cair é só uma forma lenta de andar.',
    iconKey: 'gale-spurs' });

  item({ id: 'av-updraft-boots', name: 'Botas de Respiradouro', slot: 'passo', rarity: 'epico',
    dungeonId: 'windscaffold', bonuses: { pp: 1, initiative: 12, dodge: 8 },
    description: 'Botas com grelhas nos solados que aspiram o ar dos respiradouros e devolvem por baixo a cada passada. +1 PP, +12 de iniciativa, +8 de esquiva.',
    flavor: 'Elas dão o passo. Você só decide a direção.',
    iconKey: 'updraft-boots' });

  item({ id: 'av-rope-vest', name: 'Colete de Cordame', slot: 'casca', rarity: 'comum',
    dungeonId: 'windscaffold', bonuses: { hp: 30, resists: { ar: 8 } },
    description: 'Colete trançado com o cordame dos andaimes, apertado no peito por nós de marinheiro. +30 PV, +8% ar.',
    flavor: 'Cada nó tem nome. Aprenda dois, pelo menos.',
    iconKey: 'rope-vest' });

  item({ id: 'av-storm-harness', name: 'Arnês de Tormenta', slot: 'casca', rarity: 'raro',
    dungeonId: 'windscaffold', bonuses: { hp: 45, resists: { ar: 15, terra: 6 } },
    description: 'Arnês de couro com anéis de latão que zunem no vendaval e mantêm o corpo colado à passarela. +45 PV, +15% ar, +6% terra.',
    flavor: 'Segura o corpo. A coragem é problema seu.',
    iconKey: 'storm-harness' });

  item({ id: 'av-wind-whistle', name: 'Farolete de Vão', slot: 'lume', rarity: 'raro',
    dungeonId: 'windscaffold', bonuses: { initiative: 8 }, grantsSpell: 'is-updraft',
    description: 'Farolete de sinalização das passarelas: a chama dentro dele deita na direção da corrente antes de a corrente chegar — e, se você soprar o vidro, a corrente vem. Concede o feitiço Lufada.',
    flavor: 'Os Fôlegos o usavam para achar o respiradouro. Você usa para limpar a passarela.',
    iconKey: 'gap-beacon' });

  item({ id: 'av-lightning-coil', name: 'Espiral de Raio', slot: 'lume', rarity: 'raro',
    dungeonId: 'windscaffold', bonuses: { power: 10 }, grantsSpell: 'is-storm-chain',
    description: 'Bobina de arame fino enrolada num prego de cobre, sempre eriçada e acesa por dentro num azul de tempestade que estala baixinho. Concede o feitiço Corrente de Tormenta.',
    flavor: 'Arrepia o braço inteiro antes de decidir por você.',
    iconKey: 'coil' });

  // ===== 5. A MINA TRÊMULA (quakemine) — mt- ===============================
  item({ id: 'mt-drill-bit', name: 'Broca de Veio', slot: 'punho', rarity: 'raro',
    dungeonId: 'quakemine', bonuses: { power: 16, lock: 8 },
    description: 'Broca helicoidal de minério bruto, pesada demais para uma mão só e afiada por atrito. +16 de poder, +8 de fixação.',
    flavor: 'Cavou fundo demais. É por isso que a mina treme.',
    iconKey: 'drill-bit' });

  item({ id: 'mt-quake-crown', name: 'Punho de Falha', slot: 'punho', rarity: 'epico',
    dungeonId: 'quakemine', bonuses: { pa: 1, hp: 20, resists: { terra: 10 } },
    description: 'Um bloco de rocha rachada moldado em volta da mão, que treme baixinho no ritmo da mina e para de tremer no instante do impacto. +1 PA, +20 PV, +10% terra.',
    flavor: 'O tremor não vem mais do chão. Vem de você.',
    iconKey: 'quake-fist' });

  item({ id: 'mt-ore-greaves', name: 'Grevas de Minério', slot: 'passo', rarity: 'raro',
    dungeonId: 'quakemine', bonuses: { pp: 1, lock: 10 },
    description: 'Caneleiras de minério que acham sozinhas a pedra firme no meio do desabamento. +1 PP, +10 de fixação.',
    flavor: 'Sabem onde o chão ainda existe. Confie nelas.',
    iconKey: 'ore-greaves' });

  item({ id: 'mt-cart-wheels', name: 'Rodas de Vagoneta', slot: 'passo', rarity: 'raro',
    dungeonId: 'quakemine', bonuses: { initiative: 14, dodge: 10 },
    description: 'Duas rodinhas de vagoneta adaptadas aos calcanhares, boas em trilho e péssimas em escada. +14 de iniciativa, +10 de esquiva.',
    flavor: 'Descer é rápido. Descer é sempre rápido.',
    iconKey: 'cart-wheels' });

  item({ id: 'mt-slate-plate', name: 'Peitoral de Ardósia', slot: 'casca', rarity: 'raro',
    dungeonId: 'quakemine', bonuses: { hp: 45, resists: { terra: 12, agua: 6 } },
    description: 'Lascas de ardósia sobrepostas como escamas, amarradas com fio de cobre. +45 PV, +12% terra, +6% água.',
    flavor: 'Racha uma lasca por golpe. Vieram muitas lascas.',
    iconKey: 'slate-plate' });

  item({ id: 'mt-bedrock-carapace', name: 'Carapaça de Rocha-Mãe', slot: 'casca', rarity: 'raro',
    dungeonId: 'quakemine', bonuses: { hp: 55, resists: { terra: 18, ar: 6 } },
    description: 'Bloco escavado da rocha-mãe da mina, moldado às costas do dono e pesado como uma promessa. +55 PV, +18% terra, +6% ar.',
    flavor: 'A mina emprestou. A mina cobra depois.',
    iconKey: 'bedrock-carapace' });

  item({ id: 'mt-quake-nail', name: 'Candeia de Prumo', slot: 'lume', rarity: 'raro',
    dungeonId: 'quakemine', bonuses: { power: 8 }, grantsSpell: 'is-quake-nail',
    description: 'Candeia pendurada num fio de prumo: aponta sempre para baixo, mesmo quando a galeria inteira está torta — e onde a luz dela bate no chão, o prego desce. Concede o feitiço Prego de Tremor.',
    flavor: 'A mina mente sobre onde é embaixo. A candeia não.',
    iconKey: 'plumb-lamp' });

  item({ id: 'mt-shoring-charm', name: 'Lamparina do Escorador', slot: 'lume', rarity: 'raro',
    dungeonId: 'quakemine', bonuses: { hp: 15 }, grantsSpell: 'is-ore-bulwark',
    description: 'A lamparina de quem escorava o teto: chama baixa, vidro riscado e uma viga entalhada em miniatura soldada na alça. Onde ela é pousada, o minério lembra que sabia ficar de pé. Concede o feitiço Escora de Minério.',
    flavor: 'Quem descia sem uma delas não subia com histórias.',
    iconKey: 'shoring-lamp' });

  // ===== 6. O CORAÇÃO PARTIDO (brokenheart) — cp- ==========================
  item({ id: 'cp-heart-crown', name: 'Punho do Coração', slot: 'punho', rarity: 'epico',
    dungeonId: 'brokenheart', bonuses: { pa: 1, power: 18, initiative: 10 },
    description: 'Manopla montada com as quatro lascas maiores do Coração Partido, uma de cada elemento, girando devagar em volta dos dedos sem nunca se tocarem. +1 PA, +18 de poder, +10 de iniciativa.',
    flavor: 'Quatro elementos discutindo dentro da sua mão. Vença a discussão.',
    iconKey: 'heart-fist' });

  item({ id: 'cp-shard-ring', name: 'Soqueira de Estilhaço', slot: 'punho', rarity: 'raro',
    dungeonId: 'brokenheart', bonuses: { power: 20, initiative: 8 },
    description: 'Barra de metal para os quatro dedos com cacos do Coração cravados nas cristas, que esquentam quando o dono decide bater. +20 de poder, +8 de iniciativa.',
    flavor: 'Aperta os dedos antes do golpe. É o jeito dela de concordar.',
    iconKey: 'shard-knuckles' });

  item({ id: 'cp-quicksilver-boots', name: 'Botas de Azougue', slot: 'passo', rarity: 'epico',
    dungeonId: 'brokenheart', bonuses: { pp: 1, dodge: 14, initiative: 12 },
    description: 'Botas com sola de metal líquido que se refaz a cada passo e nunca esfria. +1 PP, +14 de esquiva, +12 de iniciativa.',
    flavor: 'Chegam meio passo antes de você resolver ir.',
    iconKey: 'quicksilver-boots' });

  item({ id: 'cp-ashen-anklets', name: 'Tornozeleiras de Cinza', slot: 'passo', rarity: 'raro',
    dungeonId: 'brokenheart', bonuses: { pp: 1, dodge: 8, lock: 8 },
    description: 'Duas argolas de cinza prensada que deixam um rastro curto no chão e confundem quem tenta segui-lo. +1 PP, +8 de esquiva, +8 de fixação.',
    flavor: 'O rastro apaga sozinho. Sempre um pouco tarde demais.',
    iconKey: 'ashen-anklets' });

  item({ id: 'cp-scar-plate', name: 'Peitoral de Cicatriz', slot: 'casca', rarity: 'raro',
    dungeonId: 'brokenheart', bonuses: { hp: 50, resists: { neutro: 15, fogo: 6, agua: 6 } },
    description: 'Placa remendada com grampos grossos sobre uma rachadura que atravessa o metal de lado a lado. +50 PV, +15% neutro, +6% fogo, +6% água.',
    flavor: 'Já falhou uma vez. Não pretende repetir.',
    iconKey: 'scar-plate' });

  item({ id: 'cp-worldshell', name: 'Casco do Mundo', slot: 'casca', rarity: 'epico',
    dungeonId: 'brokenheart', bonuses: { hp: 60, resists: { fogo: 12, agua: 12, terra: 12, ar: 12, neutro: 12 } },
    description: 'Um pedaço da própria Grande Lousa, fino como telha e frio como o céu que virou pedra. +60 PV e +12% de resistência a todos os elementos.',
    flavor: 'O céu desceu sobre o mundo. Um naco dele agora desce sobre você — do lado certo.',
    iconKey: 'worldshell' });

  item({ id: 'cp-heart-horn', name: 'Corno de Brasa', slot: 'lume', rarity: 'epico',
    dungeonId: 'brokenheart', bonuses: { power: 10 }, grantsSpell: 'is-heart-call',
    description: 'Trompa curta talhada num caco oco do Coração, com um carvão vivo alojado no bocal: soprar acende o carvão, e a nota que sai é vermelha o bastante para a sala inteira enxergar de onde veio. Concede o feitiço Chamado do Coração.',
    flavor: 'Chama todo mundo. Todo mundo vem. Esse é o problema e a graça.',
    iconKey: 'ember-horn' });

  item({ id: 'cp-eclipse-lens', name: 'Lente de Eclipse', slot: 'lume', rarity: 'epico',
    dungeonId: 'brokenheart', bonuses: { power: 12 }, grantsSpell: 'is-heart-eclipse',
    description: 'Disco de vidro fumê talhado no Coração Partido — o único Lume que, em vez de dar luz, a recolhe: olhando por ele, o clima da sala vira uma sugestão. Concede o feitiço Eclipse.',
    flavor: 'Todo Lume acende. Este é o que apaga — e por isso vale dois.',
    iconKey: 'eclipse-lens' });

  // =========================================================================
  // PESOS DE SAQUE — raro e épico são DIFÍCEIS.
  // O sorteio ainda multiplica por LUCK (raro ×LUCK, épico ×LUCK²), com
  // LUCK = 1.6 (dupla) e 2.4 (solo): mesmo solo, um épico continua raro.
  // =========================================================================
  DATA.lootWeights = { comum: 30, raro: 7, epico: 2 };

  // =========================================================================
  // CONJUNTOS ELEMENTAIS — 2 por calabouço, 4 peças (pa/pp/vida/especial).
  // O elemento é o dos monstros que derrubam as peças.
  // Bônus progressivos (2/3/4 peças) que premiam o elemento e crescem com a
  // ordem do calabouço:
  //   fogo  → poder e resistência a fogo (agressão pura)
  //   agua  → vida, esquiva e resistência a água (durar mais)
  //   terra → vida e fixação (ninguém passa, ninguém escapa)
  //   ar    → iniciativa e esquiva (agir antes, apanhar menos)
  //   neutro→ perfil misto (poder + iniciativa), sem fraqueza elemental
  // =========================================================================
  DATA.sets = {

    // ---- 1. A ESTUFA SOTERRADA ------------------------------------------
    'gh-set-flora': {
      id: 'gh-set-flora', name: 'Traje da Flora Voraz', element: 'terra', dungeonId: 'greenhouse',
      description: 'Arrancado peça por peça das plantas que aprenderam a caçar no escuro. Quem o veste cria raiz no lugar onde decidiu ficar.',
      pieces: ['gh-widow-shears', 'gh-vine-stirrups', 'gh-trellis-guard', 'gh-seed-pouch'],
      bonuses: {
        2: { hp: 12, lock: 5 },
        3: { hp: 20, lock: 8, resists: { terra: 5 } },
        4: { hp: 30, lock: 12, power: 6, resists: { terra: 10 } }
      }
    },
    'gh-set-dew': {
      id: 'gh-set-dew', name: 'Traje da Goteira', element: 'agua', dungeonId: 'greenhouse',
      description: 'A estufa chove por dentro há mil anos. O que vive nas calhas é feito de água parada — e escorre entre os dedos de quem tenta segurar.',
      pieces: ['gh-firefly-crown', 'gh-moss-treads', 'gh-sap-apron', 'gh-briar-charm'],
      bonuses: {
        2: { hp: 10, dodge: 5 },
        3: { hp: 16, dodge: 8, resists: { agua: 5 } },
        4: { hp: 24, dodge: 12, power: 6, resists: { agua: 10 } }
      }
    },

    // ---- 2. A CISTERNA DOS AFOGADOS -------------------------------------
    'ci-set-drowned': {
      id: 'ci-set-drowned', name: 'Traje da Corte Afogada', element: 'agua', dungeonId: 'cistern',
      description: 'As roupas de baile da corte que a cisterna bebeu. Ainda escorrem, ainda pesam, ainda sabem dançar.',
      pieces: ['ci-lantern-fob', 'ci-current-fins', 'ci-drowned-coat', 'ci-tide-flask'],
      bonuses: {
        2: { hp: 14, power: 4 },
        3: { hp: 22, power: 7, resists: { agua: 8 } },
        4: { hp: 34, power: 12, dodge: 10, resists: { agua: 15 } }
      }
    },
    'ci-set-brine': {
      id: 'ci-set-brine', name: 'Traje de Sal e Osso', element: 'neutro', dungeonId: 'cistern',
      description: 'Sal cristalizado, osso polido e luz de água-viva: as criaturas que largaram estas peças não tinham elemento nenhum — só paciência.',
      pieces: ['ci-harpoon-flute', 'ci-baroness-collar', 'ci-brine-cuirass', 'ci-jelly-vial'],
      bonuses: {
        2: { power: 5, initiative: 6 },
        3: { power: 9, initiative: 10, resists: { neutro: 8 } },
        4: { power: 14, initiative: 14, hp: 20, resists: { neutro: 15 } }
      }
    },

    // ---- 3. O FECHO DE BRASA ---------------------------------------------
    'em-set-forge': {
      id: 'em-set-forge', name: 'Traje da Prole da Fornalha', element: 'fogo', dungeonId: 'emberlock',
      description: 'Feito do que a primeira chama do mundo cuspiu fora. Não protege do fogo: convence o fogo de que você é da casa.',
      pieces: ['em-forge-grate', 'em-cinder-treads', 'em-soot-mantle', 'em-ember-flask'],
      bonuses: {
        2: { power: 8 },
        3: { power: 14, resists: { fogo: 10 } },
        4: { power: 22, initiative: 10, resists: { fogo: 18 } }
      }
    },
    'em-set-slag': {
      id: 'em-set-slag', name: 'Traje de Escória', element: 'terra', dungeonId: 'emberlock',
      description: 'Ferro frio, escória e corrente: o refugo da forja, endurecido por mil anos de nada acontecer. Pesa como um argumento definitivo.',
      pieces: ['em-bellows-valve', 'em-chain-harness', 'em-riveted-plate', 'em-brand-iron'],
      bonuses: {
        2: { hp: 20, lock: 8 },
        3: { hp: 32, lock: 12, resists: { terra: 10 } },
        4: { hp: 48, lock: 18, power: 10, resists: { terra: 18 } }
      }
    },

    // ---- 4. OS ANDAIMES DO VENTO -----------------------------------------
    'av-set-gale': {
      id: 'av-set-gale', name: 'Traje do Vendaval', element: 'ar', dungeonId: 'windscaffold',
      description: 'Tudo o que vive nos vãos abertos é feito de pressa. Estas peças cantam na corrente e chegam meio passo antes do dono.',
      pieces: ['av-kite-crest', 'av-updraft-boots', 'av-storm-harness', 'av-wind-whistle'],
      bonuses: {
        2: { initiative: 12, dodge: 8 },
        3: { initiative: 18, dodge: 14, resists: { ar: 12 } },
        4: { initiative: 26, dodge: 22, power: 12, resists: { ar: 20 } }
      }
    },
    'av-set-rigging': {
      id: 'av-set-rigging', name: 'Traje do Cordame', element: 'ar', dungeonId: 'windscaffold',
      description: 'Tábua, corda e arame — o que sobrou dos que construíram as passarelas e continuaram andando nelas depois de mortos.',
      pieces: ['av-plank-gauntlet', 'av-glider-cloak', 'av-rope-vest', 'av-lightning-coil'],
      bonuses: {
        2: { dodge: 10, hp: 16 },
        3: { dodge: 16, hp: 26, resists: { ar: 12 } },
        4: { dodge: 24, hp: 38, lock: 14, resists: { ar: 20 } }
      }
    },

    // ---- 5. A MINA TRÊMULA ------------------------------------------------
    'mt-set-bedrock': {
      id: 'mt-set-bedrock', name: 'Traje da Rocha-Mãe', element: 'terra', dungeonId: 'quakemine',
      description: 'Talhado no osso da montanha pelas coisas que moram embaixo dela. Enquanto a mina treme, isto aqui não.',
      pieces: ['mt-quake-crown', 'mt-ore-greaves', 'mt-bedrock-carapace', 'mt-shoring-charm'],
      bonuses: {
        2: { hp: 26, lock: 10 },
        3: { hp: 42, lock: 16, resists: { terra: 14 } },
        4: { hp: 60, lock: 24, power: 14, resists: { terra: 22 } }
      }
    },
    'mt-set-tools': {
      id: 'mt-set-tools', name: 'Traje do Mineiro', element: 'neutro', dungeonId: 'quakemine',
      description: 'Broca, roda, ardósia e prego: ferramenta de gente, sem elemento nenhum. Continuou trabalhando muito depois de a gente ter parado.',
      pieces: ['mt-drill-bit', 'mt-cart-wheels', 'mt-slate-plate', 'mt-quake-nail'],
      bonuses: {
        2: { power: 10, initiative: 10 },
        3: { power: 16, initiative: 16, resists: { neutro: 12 } },
        4: { power: 24, initiative: 24, dodge: 14, resists: { neutro: 20 } }
      }
    },

    // ---- 6. O CORAÇÃO PARTIDO --------------------------------------------
    'cp-set-heart': {
      id: 'cp-set-heart', name: 'Traje do Coração', element: 'neutro', dungeonId: 'brokenheart',
      description: 'As quatro peças épicas do último Fecho, montadas em cima de um caco da própria Grande Lousa. Completar isto é o fim do jogo — e o começo do jogo de verdade.',
      pieces: ['cp-heart-crown', 'cp-quicksilver-boots', 'cp-worldshell', 'cp-heart-horn'],
      bonuses: {
        2: { hp: 30, power: 12 },
        3: { hp: 48, power: 20, initiative: 14, resists: { neutro: 15 } },
        4: { hp: 70, power: 32, initiative: 20, dodge: 16, lock: 16,
             resists: { fogo: 10, agua: 10, terra: 10, ar: 10, neutro: 20 } }
      }
    },
    'cp-set-cinder': {
      id: 'cp-set-cinder', name: 'Traje da Brasa Partida', element: 'fogo', dungeonId: 'brokenheart',
      description: 'A metade do Coração que ainda queima. Não aquece nada: só quer terminar o que estava fazendo quando rachou.',
      pieces: ['cp-shard-ring', 'cp-ashen-anklets', 'cp-scar-plate', 'cp-eclipse-lens'],
      bonuses: {
        2: { power: 14 },
        3: { power: 24, initiative: 12, resists: { fogo: 15 } },
        4: { power: 38, initiative: 20, hp: 30, resists: { fogo: 25 } }
      }
    }
  };

  // =========================================================================
  // PEDRAS DE FORJA — uma por elemento. Monstros derrubam pedras do próprio
  // elemento; melhorar um item consome pedras do elemento DO ITEM (item
  // neutro aceita qualquer pedra).
  // =========================================================================
  DATA.stones = {
    'stone-ember': {
      id: 'stone-ember', name: 'Brasa Coagulada', element: 'fogo',
      description: 'Um pingo de fogo que esfriou por fora e desistiu de esfriar por dentro. Fica morno na mão e mais quente perto da bigorna.',
      iconKey: 'stone-ember'
    },
    'stone-tear': {
      id: 'stone-tear', name: 'Lágrima de Cisterna', element: 'agua',
      description: 'Gota de água parada que endureceu sem virar gelo. Ainda tem uma ondinha presa girando lá dentro, devagar.',
      iconKey: 'stone-tear'
    },
    'stone-root': {
      id: 'stone-root', name: 'Grão de Rocha-Mãe', element: 'terra',
      description: 'Uma semente de pedra do fundo da mina, com veios claros correndo por dentro como raízes. Pesa mais do que deveria.',
      iconKey: 'stone-root'
    },
    'stone-breath': {
      id: 'stone-breath', name: 'Sopro Engarrafado', element: 'ar',
      description: 'Uma bolha de vento comprimido até virar mineral. Assobia baixinho quando alguém passa correndo do lado.',
      iconKey: 'stone-breath'
    },
    'stone-slate': {
      id: 'stone-slate', name: 'Lasca da Lousa', element: 'neutro',
      description: 'Um caco do céu que virou pedra. Não é de elemento nenhum porque é de tudo ao mesmo tempo — serve em qualquer forja.',
      iconKey: 'stone-slate'
    }
  };

  // =========================================================================
  // FORJA — evolução determinística até +10 (nunca quebra, nunca regride).
  // Cada nível soma 12% dos bônus BASE do item: +10 = 1 + 0,12*10 = 2,2× o item.
  // Custo total do +0 ao +10: 107 pedras.
  //
  // ATENÇÃO, LÓGICA: `nonScalingKeys` — os bônus de PA e PP NUNCA escalam com o
  // nível de forja. São pontos de ação inteiros e o teto do §8 continua valendo
  // (+1 PA no máximo, +1 PP no máximo); sem essa exceção, um épico de +1 PA
  // viraria +2 PA já no +5 (round(1 × 1,6)) e quebraria a economia de ações.
  // Tudo o mais (PV, poder, iniciativa, esquiva, fixação, resistências) escala.
  // =========================================================================
  DATA.upgrade = {
    maxLevel: 10,
    tiers: [
      { from: 0,  to: 2,  name: 'Comum' },
      { from: 3,  to: 5,  name: 'Raro' },
      { from: 6,  to: 9,  name: 'Supremo' },
      { from: 10, to: 10, name: 'Magnífico' }
    ],
    bonusPerLevel: 0.12,
    stoneCost: [2, 3, 4, 6, 8, 10, 13, 16, 20, 25],
    nonScalingKeys: ['pa', 'pp']
  };

  // =========================================================================
  // RODAPÉ — deriva `element`, `setId` e `dropWeight` de cada item a partir do
  // conjunto a que ele pertence e da raridade. Nenhum item pode ficar fora de
  // um conjunto: a validação acusa (element/setId nulos).
  // =========================================================================
  (function bindSets() {
    Object.keys(DATA.sets).forEach(function (sid) {
      var set = DATA.sets[sid];
      set.pieces.forEach(function (iid) {
        var it = I[iid];
        if (!it) return;                       // acusado por tests/validate_fusion.html
        it.setId = sid;
        it.element = set.element;
        it.dropWeight = DATA.lootWeights[it.rarity] || 0;
      });
    });
  })();

})();
