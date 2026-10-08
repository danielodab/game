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
//             ADENDO v2.7 (§9-H): TODA peça de Passo concede ESQUIVA — é o único
//             espaço que concede, e é onde o jogador compra a chance de se soltar
//             de quem o prendeu. A escada: 8/10 na Estufa, 10/12 na Cisterna,
//             12/14 nos Andaimes e no Fecho, 12 na Mina, 10/16 no Coração —
//             cresce com a PROFUNDIDADE e, dentro do mesmo calabouço, o mais raro
//             leva +2. Exceção: as três peças que também carregam FIXAÇÃO
//             (Grilhões de Forja, Grevas de Minério, Tornozeleiras de Cinza)
//             ficam um degrau abaixo em esquiva — pagaram o preço no outro lado.
//             Teto de 16 por peça: acima disso o chefe deixa de segurar.
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
// RARIDADE NÃO É PODER: cada calabouço tem 4 comuns / 3 raros / 1 épico (o
// troféu do chefe), e o Coração Partido tem 2 comuns / 1 raro / 1 épico / 4
// LENDÁRIAS. Um item comum do Coração Partido é melhor que um raro da Estufa —
// o que cresce com a ordem do calabouço é o PODER; a raridade diz só o quanto
// custa achar. As peças que mudam COMO se joga (+1 PA, +1 PP e os Lumes) são as
// mais raras de cada faixa.
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

    // Feitiço EXCLUSIVO do conjunto lendário (4 peças do Traje do Coração).
    // Não pertence a nenhum item: é concedido por DATA.sets['cp-set-heart'].
    'is-heart-whole': itemSpell({
      id: 'is-heart-whole', name: 'Coração Inteiro', element: 'neutro',
      paCost: 4, cooldown: 5, range: rng(0, 0, false, false), targetSide: 'self',
      effects: [
        { type: 'cleanse', kinds: ['poison', 'root'] },
        { type: 'heal', min: 34, max: 44 },
        { type: 'shield', value: 50, duration: 2 },
        { type: 'reflect', pct: 30, duration: 2 },
        { type: 'weatherShift', weather: 'calmo' }
      ],
      description: 'Com as quatro peças fechadas, o Coração Partido volta a bater inteiro por um instante: o veneno sai, a ferida fecha, a casca engrossa, o golpe volta pelo mesmo caminho — e a sala inteira se aquieta.',
      flavor: 'Mil anos rachado. Um instante inteiro. Faça valer.',
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
    dungeonId: 'greenhouse', bonuses: { pa: 1, power: 14 },
    description: 'O tesourão de poda da Jardineira-Viúva, mais alto que uma criança e ainda pegajoso de seiva. +1 PA, +14 de poder.',
    flavor: 'Ela podava o jardim. Agora você poda o mundo.',
    iconKey: 'great-shears' });

  item({ id: 'gh-moss-treads', name: 'Solados de Musgo', slot: 'passo', rarity: 'comum',
    dungeonId: 'greenhouse', bonuses: { dodge: 8, initiative: 4 },
    description: 'Sandálias forradas com musgo vivo que agarra o piso molhado e não faz barulho. +8 de esquiva, +4 de iniciativa.',
    flavor: 'O musgo cresce de volta toda noite. Não pergunte do quê.',
    iconKey: 'moss-boots' });

  item({ id: 'gh-vine-stirrups', name: 'Estribos de Hera', slot: 'passo', rarity: 'raro',
    dungeonId: 'greenhouse', bonuses: { pp: 1, dodge: 10 },
    description: 'Duas heras vivas enroladas nas canelas que empurram o passo seguinte antes de você pedir. +1 PP, +10 de esquiva.',
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
    dungeonId: 'cistern', bonuses: { pp: 1, hp: 15, initiative: 8, dodge: 12 },
    description: 'Os sapatos de baile da Baronesa Salmoura, com fivelas de pérola de lodo e sola que não encosta no fundo. A água abre caminho na frente deles. +1 PP, +15 PV, +8 de iniciativa, +12 de esquiva.',
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
    dungeonId: 'emberlock', bonuses: { pp: 1, initiative: 6, dodge: 14 },
    description: 'Solas de escória fria que não queimam no piso da forja e ainda dão um empurrão em cada passada. +1 PP, +6 de iniciativa, +14 de esquiva.',
    flavor: 'Andar sobre brasa é questão de sola, dizem eles.',
    iconKey: 'slag-boots' });

  item({ id: 'em-chain-harness', name: 'Grilhões de Forja', slot: 'passo', rarity: 'comum',
    dungeonId: 'emberlock', bonuses: { dodge: 12, lock: 8 },
    description: 'Correntes do teto da forja fechadas nos tornozelos: dão balanço de pêndulo para desviar e peso de âncora para segurar quem tentar fugir. +12 de esquiva, +8 de fixação.',
    flavor: 'Prendiam alguma coisa antes. Agora andam com você — de boa vontade.',
    iconKey: 'forge-shackles' });

  item({ id: 'em-riveted-plate', name: 'Chapa Rebitada', slot: 'casca', rarity: 'comum',
    dungeonId: 'emberlock', bonuses: { hp: 25, resists: { fogo: 8 } },
    description: 'Placa retangular arrancada do portão da forja, com quatro rebites nos cantos. +25 PV, +8% fogo.',
    flavor: 'O portão não sente falta. Provavelmente.',
    iconKey: 'riveted-plate' });

  item({ id: 'em-soot-mantle', name: 'Manto de Fuligem', slot: 'casca', rarity: 'comum',
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
  item({ id: 'av-kite-crest', name: 'Garra de Vareta', slot: 'punho', rarity: 'comum',
    dungeonId: 'windscaffold', bonuses: { initiative: 14, power: 8 },
    description: 'Cinco varetas de papagaio amarradas aos dedos com pano esticado entre elas: a mão vira asa e o golpe vem com a corrente junto. +14 de iniciativa, +8 de poder.',
    flavor: 'Puxa para cima o tempo todo. Você se acostuma a inclinar.',
    iconKey: 'kite-claw' });

  item({ id: 'av-plank-gauntlet', name: 'Manopla de Tábua', slot: 'punho', rarity: 'comum',
    dungeonId: 'windscaffold', bonuses: { power: 14, lock: 6 },
    description: 'Tábua de andaime amarrada ao antebraço com corda alcatroada: bate como remo e segura como corrimão. +14 de poder, +6 de fixação.',
    flavor: 'Já foi piso. Prefere ser argumento.',
    iconKey: 'plank-gauntlet' });

  item({ id: 'av-glider-cloak', name: 'Esporas de Vão', slot: 'passo', rarity: 'raro',
    dungeonId: 'windscaffold', bonuses: { pp: 1, dodge: 12 },
    description: 'Esporas de vareta e pano que abrem como leque a cada passada e pegam a corrente que sobe do vão: transformam a queda em passo. +1 PP, +12 de esquiva.',
    flavor: 'Nos Andaimes, cair é só uma forma lenta de andar.',
    iconKey: 'gale-spurs' });

  item({ id: 'av-updraft-boots', name: 'Botas de Respiradouro', slot: 'passo', rarity: 'epico',
    dungeonId: 'windscaffold', bonuses: { pp: 1, initiative: 12, dodge: 14 },
    description: 'Botas com grelhas nos solados que aspiram o ar dos respiradouros e devolvem por baixo a cada passada. +1 PP, +12 de iniciativa, +14 de esquiva.',
    flavor: 'Elas dão o passo. Você só decide a direção.',
    iconKey: 'updraft-boots' });

  item({ id: 'av-rope-vest', name: 'Colete de Cordame', slot: 'casca', rarity: 'comum',
    dungeonId: 'windscaffold', bonuses: { hp: 30, resists: { ar: 8 } },
    description: 'Colete trançado com o cordame dos andaimes, apertado no peito por nós de marinheiro. +30 PV, +8% ar.',
    flavor: 'Cada nó tem nome. Aprenda dois, pelo menos.',
    iconKey: 'rope-vest' });

  item({ id: 'av-storm-harness', name: 'Arnês de Tormenta', slot: 'casca', rarity: 'comum',
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
  item({ id: 'mt-drill-bit', name: 'Broca de Veio', slot: 'punho', rarity: 'comum',
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
    dungeonId: 'quakemine', bonuses: { pp: 1, lock: 10, dodge: 8 },
    description: 'Caneleiras de minério que acham sozinhas a pedra firme no meio do desabamento. +1 PP, +10 de fixação, +8 de esquiva.',
    flavor: 'Sabem onde o chão ainda existe. Confie nelas.',
    iconKey: 'ore-greaves' });

  item({ id: 'mt-cart-wheels', name: 'Rodas de Vagoneta', slot: 'passo', rarity: 'comum',
    dungeonId: 'quakemine', bonuses: { initiative: 14, dodge: 12 },
    description: 'Duas rodinhas de vagoneta adaptadas aos calcanhares, boas em trilho e péssimas em escada. +14 de iniciativa, +12 de esquiva.',
    flavor: 'Descer é rápido. Descer é sempre rápido.',
    iconKey: 'cart-wheels' });

  item({ id: 'mt-slate-plate', name: 'Peitoral de Ardósia', slot: 'casca', rarity: 'comum',
    dungeonId: 'quakemine', bonuses: { hp: 45, resists: { terra: 12, agua: 6 } },
    description: 'Lascas de ardósia sobrepostas como escamas, amarradas com fio de cobre. +45 PV, +12% terra, +6% água.',
    flavor: 'Racha uma lasca por golpe. Vieram muitas lascas.',
    iconKey: 'slate-plate' });

  item({ id: 'mt-bedrock-carapace', name: 'Carapaça de Rocha-Mãe', slot: 'casca', rarity: 'comum',
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
  item({ id: 'cp-heart-crown', name: 'Punho do Coração', slot: 'punho', rarity: 'lendario',
    dungeonId: 'brokenheart', bonuses: { pa: 1, power: 22, initiative: 10 },
    description: 'Manopla montada com as quatro lascas maiores do Coração Partido, uma de cada elemento, girando devagar em volta dos dedos sem nunca se tocarem. +1 PA, +22 de poder, +10 de iniciativa.',
    flavor: 'Quatro elementos discutindo dentro da sua mão. Vença a discussão.',
    iconKey: 'heart-fist' });

  item({ id: 'cp-shard-ring', name: 'Soqueira de Estilhaço', slot: 'punho', rarity: 'comum',
    dungeonId: 'brokenheart', bonuses: { power: 20, initiative: 8 },
    description: 'Barra de metal para os quatro dedos com cacos do Coração cravados nas cristas, que esquentam quando o dono decide bater. +20 de poder, +8 de iniciativa.',
    flavor: 'Aperta os dedos antes do golpe. É o jeito dela de concordar.',
    iconKey: 'shard-knuckles' });

  item({ id: 'cp-quicksilver-boots', name: 'Botas de Azougue', slot: 'passo', rarity: 'lendario',
    dungeonId: 'brokenheart', bonuses: { pp: 1, dodge: 16, initiative: 12 },
    description: 'Botas com sola de metal líquido que se refaz a cada passo e nunca esfria. +1 PP, +16 de esquiva, +12 de iniciativa.',
    flavor: 'Chegam meio passo antes de você resolver ir.',
    iconKey: 'quicksilver-boots' });

  item({ id: 'cp-ashen-anklets', name: 'Tornozeleiras de Cinza', slot: 'passo', rarity: 'raro',
    dungeonId: 'brokenheart', bonuses: { pp: 1, dodge: 10, lock: 8 },
    description: 'Duas argolas de cinza prensada que deixam um rastro curto no chão e confundem quem tenta segui-lo. +1 PP, +10 de esquiva, +8 de fixação.',
    flavor: 'O rastro apaga sozinho. Sempre um pouco tarde demais.',
    iconKey: 'ashen-anklets' });

  item({ id: 'cp-scar-plate', name: 'Peitoral de Cicatriz', slot: 'casca', rarity: 'comum',
    dungeonId: 'brokenheart', bonuses: { hp: 50, resists: { neutro: 15, fogo: 6, agua: 6 } },
    description: 'Placa remendada com grampos grossos sobre uma rachadura que atravessa o metal de lado a lado. +50 PV, +15% neutro, +6% fogo, +6% água.',
    flavor: 'Já falhou uma vez. Não pretende repetir.',
    iconKey: 'scar-plate' });

  item({ id: 'cp-worldshell', name: 'Casco do Mundo', slot: 'casca', rarity: 'lendario',
    dungeonId: 'brokenheart', bonuses: { hp: 60, resists: { fogo: 12, agua: 12, terra: 12, ar: 12, neutro: 12 } },
    description: 'Um pedaço da própria Grande Lousa, fino como telha e frio como o céu que virou pedra. +60 PV e +12% de resistência a todos os elementos.',
    flavor: 'O céu desceu sobre o mundo. Um naco dele agora desce sobre você — do lado certo.',
    iconKey: 'worldshell' });

  item({ id: 'cp-heart-horn', name: 'Corno de Brasa', slot: 'lume', rarity: 'lendario',
    dungeonId: 'brokenheart', bonuses: { power: 16 }, grantsSpell: 'is-heart-call',
    description: 'Trompa curta talhada num caco oco do Coração, com um carvão vivo alojado no bocal: soprar acende o carvão, e a nota que sai é vermelha o bastante para a sala inteira enxergar de onde veio. +16 de poder. Concede o feitiço Chamado do Coração.',
    flavor: 'Chama todo mundo. Todo mundo vem. Esse é o problema e a graça.',
    iconKey: 'ember-horn' });

  item({ id: 'cp-eclipse-lens', name: 'Lente de Eclipse', slot: 'lume', rarity: 'epico',
    dungeonId: 'brokenheart', bonuses: { power: 12 }, grantsSpell: 'is-heart-eclipse',
    description: 'Disco de vidro fumê talhado no Coração Partido — o único Lume que, em vez de dar luz, a recolhe: olhando por ele, o clima da sala vira uma sugestão. Concede o feitiço Eclipse.',
    flavor: 'Todo Lume acende. Este é o que apaga — e por isso vale dois.',
    iconKey: 'eclipse-lens' });

  // =========================================================================
  // PESOS DE SAQUE — o saque é DURO, e o troféu é um evento.
  //
  // O peso de cada peça está em `DATA.items[id].dropWeight` (é ele que vai na
  // lootTable do Criativo Mundo). Os números abaixo são o MODELO que o gera, e
  // o rodapé deste arquivo normaliza tudo por calabouço para bater estas metas
  // POR SORTEIO (já com a Sorte de Saque: raro ×LUCK, épico e lendário ×LUCK²;
  // LUCK = 2,4 solo e 1,6 em dupla):
  //
  //            | solo            | dupla
  //   vazio    | ~50%            | ~53%     ⇒ 4 sorteios por descida ≈ 2 itens
  //   comum    | ~34%            | ~36%     ⇒ a maioria do que cai é comum
  //   raro     | ~13,5%          | ~9,5%
  //   épico    | ~2,5%           | ~1,2%    ⇒ ~10% / ~5% de sair 1 por descida
  //   lendário | ~3,0% (só no CP)| ~1,4%    ⇒ ~70 / ~145 descidas pelo Traje
  //
  // `emptyRatio` é a entrada virtual de "NADA" do sorteio: LÓGICA, some
  // `DATA.lootWeights.noDrop[dungeonId]` à lootTable como resultado "sem item".
  // É ela que faz sair de uma descida com 1 peça útil já ser um bom resultado.
  // `keyFactor`: peça-CHAVE (+1 PA, +1 PP ou Lume, que muda como se joga) pesa
  // metade das irmãs de mesma raridade — são as mais difíceis de todas.
  // =========================================================================
  DATA.lootWeights = {
    comum: 1000,            // peso de referência de uma comum não-chave
    // 08/09, pedido do dono: "preciso que o drop de itens bons seja MUITO
    // difícil". As três fatias boas caíram para menos de um terço (raro
    // 16,5% → 5%, épico 1,28% → 0,25%, lendário 2,2% → 0,6% do peso das
    // comuns). Medido em tests/prob_saque.html, sozinho, por sorteio do
    // chefe: raro ~3%, épico ~0,35%, lendário ~0,8% — um raro a cada ~17
    // descidas, um épico a cada ~140, o traje lendário inteiro em ~250.
    rareRatio: 0.05,        // peso total dos raros    =  5,00% do peso total dos comuns
    epicRatio: 0.0025,      // peso total dos épicos   =  0,25% do peso total dos comuns
    legendRatio: 0.006,     // peso total dos lendários=  0,60% do peso total dos comuns
                            // (4 peças dividindo essa fatia ⇒ cada uma é mais
                            //  rara que o épico; fechar as 4 leva ~250 descidas)
    // 03/09, pedido do dono: "o drop de itens geral deve ficar mais difícil,
    // não deve ser tão fácil". O "nada" dobrou: de 147% para 300% do peso das
    // comuns — medido em tests/prob_saque.html: sala comum 40% → 25% de sair
    // peça, chefe (por sorteio, sozinho) 50% → 33%, dupla 47% → 30%.
    emptyRatio: 3.0,        // peso do "nada"          = 300% do peso total dos comuns
    keyFactor: 0.5,
    luck: { solo: 2.4, dupla: 1.6 },
    // expoente da Sorte de Saque por raridade. O lendário divide o expoente do
    // épico de propósito: com ×LUCK³ o solo trivializaria o troféu.
    luckExponent: { comum: 0, raro: 1, epico: 2, lendario: 2 },
    noDrop: {}              // preenchido no rodapé, por calabouço
  };

  // =========================================================================
  // O SACO TEM FUNDO (pedido do usuário, 25/08): limite de UNIDADES no
  // inventário, crescendo com as classes liberadas:
  //     limite = base + perClass × classes liberadas
  // Duas classes de início → 80; as seis → 160. O transbordo é o cofre do
  // banco — o limite existe para dar valor à viagem até ele.
  // =========================================================================
  DATA.bag = { base: 40, perClass: 20 };

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
    // ***** O CONJUNTO LENDÁRIO — o mais forte e o mais raro do jogo *****
    // Único conjunto que CONCEDE UM FEITIÇO ao fechar as 4 peças (nenhum outro
    // faz isso): `bonuses[4].grantsSpell`. A Lógica deve somá-lo em
    // `Progress.spellsFor` do mesmo jeito que já soma o `grantsSpell` do Lume.
    'cp-set-heart': {
      id: 'cp-set-heart', name: 'Traje do Coração', element: 'neutro', dungeonId: 'brokenheart',
      legendary: true,
      description: 'As quatro peças lendárias do último Fecho, montadas em cima de um caco da própria Grande Lousa. Só caem no Coração Partido, e caem pouco: completar isto é o fim do jogo — e o começo do jogo de verdade.',
      pieces: ['cp-heart-crown', 'cp-quicksilver-boots', 'cp-worldshell', 'cp-heart-horn'],
      bonuses: {
        2: { hp: 30, power: 12 },
        3: { hp: 48, power: 20, initiative: 14, resists: { neutro: 15 } },
        4: { hp: 70, power: 32, initiative: 20, dodge: 16, lock: 16,
             resists: { fogo: 10, agua: 10, terra: 10, ar: 10, neutro: 20 },
             grantsSpell: 'is-heart-whole' }
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
    },
    // A ÂNCORA: não forja nada sozinha — vai JUNTO da pedra do elemento e
    // segura o nível quando a batida falha. `element: 'forja'` de propósito:
    // fora do mapa elemento→pedra, nenhum item a consome como pedra comum.
    'stone-anchor': {
      id: 'stone-anchor', name: 'Âncora de Forja', element: 'forja',
      description: 'Um dente de bigorna arrancado inteiro, pesado como culpa. Preso à peça durante a batida, não deixa o nível escorregar para trás — só os chefes mais fundos carregam um.',
      iconKey: 'stone-anchor'
    },
    // 08/10: A GEMA ENTERRADA (dono: "uma pedra rara que ao levar na forja com um item dá um bônus a
    // mais: +1 PA, +1 PM, vida ou dano"). `element: 'gema'` a tira do mapa elemento→pedra, como a
    // Âncora: nenhuma peça a gasta como pedra de forjar. Os FRAGMENTOS ('fragmento') caem nos seis
    // portais, vêm da loja do site e do anúncio premiado, e viram gema de 100 em 100 (DATA.gema).
    'stone-gem': {
      id: 'stone-gem', name: 'Gema Enterrada', element: 'gema',
      description: 'Cem fragmentos apertados até voltarem a ser uma pedra só. Engastada numa peça, dá a ela um bônus que a forja comum não dá — e cada peça só aceita uma.',
      iconKey: 'stone-gem'
    },
    'stone-gem-frag': {
      id: 'stone-gem-frag', name: 'Fragmento de Gema', element: 'fragmento',
      description: 'Um caco de gema que ainda lembra o brilho inteiro. Sozinho não serve para nada; cem deles, apertados, voltam a ser a Gema Enterrada.',
      iconKey: 'stone-gem-frag'
    }
  };

  // =========================================================================
  // A GEMA ENTERRADA (08/10) — o BÔNUS ESPECIAL da peça. Uma gema engastada na
  // forja dá à cópia UM bônus a mais, sorteado (no servidor, com sessão) do mais
  // difícil ao mais fácil, como o dono pediu: PA, PP, dano, vida. Cada peça
  // aceita uma gema só; o bônus não escala com a forja nem com as estrelas e
  // fica preso à CÓPIA (viaja com ela ao vestir, ao cofre, à quebra — e some
  // na quebra). A peça engastada não vai ao mercadinho, à troca nem ao banco da
  // guilda (o anúncio deles não guarda o bônus). Os FRAGMENTOS caem de monstro
  // nos seis portais (chefe sempre; elite um a mais), e 100 viram 1 gema.
  // ATENÇÃO: `gemaCfg()` do progress.js lê campo a campo, com padrão — todo
  // campo novo precisa entrar lá, senão some sem erro nenhum.
  // =========================================================================
  DATA.gema = {
    id: 'stone-gem',
    fragmento: 'stone-gem-frag',
    porGema: 100,
    pesos: { pa: 1, pp: 2, dano: 3, vida: 4 },
    bonus: { pa: { pa: 1 }, pp: { pp: 1 }, dano: { power: 10 }, vida: { hp: 30 } },
    drop: { chance: 0.08, min: 1, max: 1, chefeMin: 2, chefeMax: 4 }
  };

  // =========================================================================
  // FORJA — até o +5 é o degrau seguro de sempre (determinístico). DALI EM
  // DIANTE a batida pode FALHAR e o nível REGRIDE um degrau (+5 falhado vira
  // +4) — pedido do usuário: "a forja não pode ser tão fácil". A ÂNCORA DE
  // FORJA (stone-anchor), posta JUNTO das pedras, segura a queda: falhou,
  // ficou onde estava. Ela só dropa de CHEFE, e os mais fundos pagam mais.
  // Cada nível soma 12% dos bônus BASE do item: +10 = 1 + 0,12*10 = 2,2× o item.
  // Custo total do +0 ao +10: 107 pedras (sem contar as batidas perdidas).
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
    nonScalingKeys: ['pa', 'pp'],
    // o RISCO: a partir deste nível a batida rola o dado (chance por nível
    // ATUAL); falhou, desce um. A âncora segura.
    riskFrom: 5,
    // recalibrada pelo usuário (24/08): o topo é um muro — 5% na última batida
    chances: { 5: 0.60, 6: 0.50, 7: 0.30, 8: 0.15, 9: 0.05 },
    guardStone: 'stone-anchor',
    // quanto cada CHEFE paga de âncora ao cair (só chefes; mais fundo, mais)
    guardDropByDungeon: {
      greenhouse: 0.08, cistern: 0.12, emberlock: 0.16,
      windscaffold: 0.20, quakemine: 0.24, brokenheart: 0.30
    }
  };

  // =========================================================================
  // NÍVEL DE USO (10/09, pedido do dono: "esses itens de cada mapa precisam
  // ter seu nível para uso… os itens mais fortes são níveis mais altos; o set
  // especial da roleta é nível 30 em todas as peças; pets a partir do 10").
  //
  // A régua é POR CALABOUÇO E RARIDADE e mora aqui, para o dono calibrar com
  // um número só. O degrau de cada mapa é o nível recomendado dele
  // (dungeons.js: 3 · 7 · 11 · 16 · 22 · 28); dentro do mapa, a peça mais
  // rara pede 2 níveis a mais — e no Coração Partido a escada desce um degrau
  // (26/28/30) para as três raridades não colidirem no teto 30. Lendária é
  // sempre 30 (o Traje do Coração e o do Colecionador); pet é sempre 10
  // (Selinho inclusive — e ele só vem com o Colecionador fechado, no 30).
  // Um `nivelUso` explícito na peça vence a régua.
  //
  // Quem cobra é o Progress (equip / equipPet; o Mestre não paga) e quem
  // mostra é a ficha. Peça acima do nível ainda cai, fica no saco, é trocada
  // e vendida — só não entra no herói. A régua vale também para as peças
  // avulsas (a avulsa rara é a mais forte do mapa no bruto: paga o degrau).
  // =========================================================================
  DATA.nivelUso = {
    porCalabouco: {
      greenhouse:   { comum: 3,  raro: 5,  epico: 7 },
      cistern:      { comum: 7,  raro: 9,  epico: 11 },
      emberlock:    { comum: 11, raro: 13, epico: 15 },
      windscaffold: { comum: 16, raro: 18, epico: 20 },
      quakemine:    { comum: 22, raro: 24, epico: 26 },
      brokenheart:  { comum: 26, raro: 28, epico: 30 }
    },
    lendario: 30,        // toda peça lendária, venha de onde vier
    colecionador: 30,    // as 4 peças do Traje do Colecionador (roleta dos Selos)
    pet: 10,             // todo pet
    teto: 30             // o nível máximo do herói (progression.js maxLevel)
  };
  /* O nível que uma peça (ou um pet) pede. 0 = sem exigência: dado que a
   * régua não conhece nunca tranca por engano. Aceita a definição (DATA.items
   * / DATA.pets) — a ficha e o Progress chamam com ela. */
  DATA.nivelUsoDe = function (def) {
    var T = DATA.nivelUso;
    if (!def || !T) return 0;
    if (typeof def.nivelUso === 'number' && isFinite(def.nivelUso)) {
      return Math.max(0, Math.round(def.nivelUso));
    }
    var n;
    if (def.slot === undefined && def.behavior !== undefined) n = T.pet;          // é pet
    else if (def.rarity === 'lendario') n = T.lendario;
    else {
      var faixa = T.porCalabouco && T.porCalabouco[def.dungeonId];
      n = faixa ? faixa[def.rarity] : 0;
    }
    if (typeof n !== 'number' || !isFinite(n)) return 0;
    return Math.min(T.teto || 30, Math.max(0, Math.round(n)));
  };

  // =========================================================================
  // A QUEBRA (22/09, pedido do dono: "na forja o jogador poderá quebrar os
  // itens, que darão pedras daquele elemento; a depender do nível do item e
  // poder dá mais pedras").
  //
  // Quebrar desfaz a peça do saco em pedras do ELEMENTO dela (neutra dá Lasca
  // da Lousa; a Âncora nunca sai daqui). A conta tem três andares e mora
  // inteira nesta tabela — o Progress só multiplica (`quebraInfoDe`):
  //
  //   pedras = max(minimo, floor(base[raridade] × T × porEstrela^★)
  //                        + floor(reembolsoForja × custo NOMINAL até o +N))
  //   T = teto(nívelDeUso / degrauNivel) → 1 · 2 · 3   (o "nível do item")
  //
  // POR QUE NÃO VIRA MÁQUINA DE PEDRA (as três portas que um laço usaria):
  //   • FORJA. O reembolso é METADE do custo NOMINAL (a tabela de stoneCost
  //     acima, 107 no +10). Do +5 em diante a batida falha e regride, então o
  //     custo REAL é bem maior que o nominal — forjar e quebrar sempre perde.
  //   • ESTRELA. `porEstrela` = 3 são as 3 cópias que a fusão consumiu:
  //     quebrar um ★1 dá o mesmo que quebrar as três cópias soltas, nunca mais.
  //     E a fusão sai no nível da MÉDIA arredondada para baixo, com o reembolso
  //     contado uma vez só — fundir antes de quebrar só pode perder.
  //   • A PEÇA EM SI. Ninguém fabrica peça: ela cai (~1 por descida) e some
  //     ao quebrar. A descida já paga ~15 pedras (Estufa) a ~85 (Coração
  //     Partido); a quebra de uma comum soma 1 a 3, a épica do fundo 24.
  //
  // EXEMPLOS (nominal: +3 = 9 · +5 = 23 · +7 = 46 · +10 = 107):
  //   peça                         nv  T  ★  forja   conta              pedras
  //   comum da Estufa              3   1  0  +0      1×1×1              1
  //   rara da Estufa               5   1  0  +0      3×1×1              3
  //   comum do Fecho de Brasa      11  2  0  +0      1×2×1              2
  //   épica da Cisterna            11  2  0  +0      8×2×1              16
  //   épica do Coração Partido     30  3  0  +0      8×3×1              24
  //   lendária (qualquer)          30  3  0  +0      15×3×1             45
  //   rara dos Andaimes ★1 +5      18  2  1  +5      3×2×3 + 11         29
  //   comum da Estufa ★3           3   1  3  +0      1×1×27             27
  //   lendária +10                 30  3  0  +10     45 + 53            98
  //
  // A Panóplia do Mestre (ids 'gm-*', noDrop) não se quebra: é o privilégio
  // do dono, não matéria de forja. Campo novo aqui precisa entrar também no
  // `quebraCfg()` do progress.js (ele lê campo a campo, com padrão).
  // =========================================================================
  DATA.quebra = {
    base: { comum: 1, raro: 3, epico: 8, lendario: 15 },  // pedras por raridade
    degrauNivel: 10,       // T = teto(nivelUso / degrauNivel) → 1..3 (o "nível do item")
    porEstrela: 3,         // ×3 por estrela: as 3 cópias que a fusão consumiu
    reembolsoForja: 0.5,   // metade das pedras NOMINAIS gastas até o nível de forja atual
    minimo: 1              // nenhuma quebra devolve zero
  };

  // =========================================================================
  // RODAPÉ — deriva `element`, `setId`, `dropWeight` e `nivelUso` de cada item a partir do
  // conjunto a que ele pertence e da raridade. Nenhum item pode ficar fora de
  // um conjunto: a validação acusa (element/setId nulos).
  // =========================================================================
  (function bindSetsAndLoot() {
    var LW = DATA.lootWeights;
    var RANK = { comum: 0, raro: 1, epico: 2, lendario: 3 };

    // 1. conjunto → elemento e setId de cada peça; raridade do conjunto = a maior das peças
    Object.keys(DATA.sets).forEach(function (sid) {
      var set = DATA.sets[sid], top = 'comum';
      set.pieces.forEach(function (iid) {
        var it = I[iid];
        if (!it) return;                       // acusado por tests/validate_fusion.html
        it.setId = sid;
        it.element = set.element;
        if (RANK[it.rarity] > RANK[top]) top = it.rarity;
      });
      set.rarity = top;
    });

    // 2. peça-chave (muda COMO se joga) e sala mínima sugerida para a lootTable
    Object.keys(I).forEach(function (id) {
      var it = I[id];
      it.keyPiece = !!(it.bonuses.pa || it.bonuses.pp || it.slot === 'lume');
      it.minRoom = (it.rarity === 'epico' || it.rarity === 'lendario') ? 2
                 : (it.rarity === 'raro' ? 1 : 0);
      it.nivelUso = DATA.nivelUsoDe(it);                                  // 10/09
    });

    // 3. pesos de saque, normalizados por calabouço para bater as metas do modelo
    var byDungeon = {};
    Object.keys(I).forEach(function (id) {
      var it = I[id];
      (byDungeon[it.dungeonId] = byDungeon[it.dungeonId] || []).push(it);
    });
    Object.keys(byDungeon).forEach(function (dg) {
      var list = byDungeon[dg];
      function units(r) {
        var u = 0;
        list.forEach(function (it) { if (it.rarity === r) u += (it.keyPiece ? LW.keyFactor : 1); });
        return u;
      }
      var uC = units('comum'), uR = units('raro'), uE = units('epico'), uL = units('lendario');
      var totalComum = LW.comum * uC;
      var perR = uR > 0 ? totalComum * LW.rareRatio / uR : 0;
      var perE = uE > 0 ? totalComum * LW.epicRatio / uE : 0;
      var perL = uL > 0 ? totalComum * LW.legendRatio / uL : 0;
      list.forEach(function (it) {
        var f = it.keyPiece ? LW.keyFactor : 1;
        var w = it.rarity === 'comum' ? LW.comum * f
              : it.rarity === 'raro' ? perR * f
              : it.rarity === 'epico' ? perE * f
              : perL * f;
        it.dropWeight = Math.max(1, Math.round(w));
      });
      LW.noDrop[dg] = Math.round(totalComum * LW.emptyRatio);
    });

    // 4. nível de uso dos pets — pets.js carrega ANTES deste arquivo, por isso
    //    o carimbo deles é daqui (o Selinho, que nasce em items_selos.js, se
    //    carimba sozinho).
    Object.keys(DATA.pets || {}).forEach(function (pid) {
      var p = DATA.pets[pid];
      if (p) p.nivelUso = DATA.nivelUsoDe(p);
    });
  })();

})();
