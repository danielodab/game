var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// SOTERRA 2.0 — ITENS, SEGUNDA LEVA (dono: Criativo Itens)
//
// >>> Arquivo ADITIVO: NUNCA sobrescreve JOGO.DATA. <<<
// Acrescenta chaves novas a `DATA.items`, `DATA.sets` e `DATA.itemSpells` sem
// tocar em nada do que `js/core/data/items.js` já escreveu — nenhum objeto é
// reatribuído, só recebe chaves. Tem de ser carregado LOGO DEPOIS de
// `js/core/data/items.js` (o rodapé daqui depende de `DATA.lootWeights`).
//
// O QUE ENTRA AQUI (o acervo sai de 48 itens / 12 conjuntos para 90 / 18):
//
//  1. UM TERCEIRO CONJUNTO POR CALABOUÇO (6 conjuntos, 4 peças cada = 24 itens).
//     Os dois primeiros conjuntos de cada calabouço já tinham dono no bestiário;
//     este terceiro é sempre a FAMÍLIA QUE SOBRAVA daquela sala — o enxame da
//     estufa, o caranguejo do ralo, o cão que apaga a forja, o novelo pendurado
//     na roldana, o gás azul da galeria, o arauto que é só vento por dentro.
//
//  2. ITENS AVULSOS (18, `setId: null`). Até agora TODO item era peça de
//     coleção, e isso engessava o saque: nada do que caía servia por si só.
//     Estes 18 são o que o jogador usa enquanto não fecha um conjunto — por isso
//     são competitivos sozinhos (o avulso raro bate o comum do conjunto no bruto
//     e perde só quando o conjunto fecha 3 ou 4 peças).
//
//  3. NIVELAMENTO ELEMENTAL. O acervo antigo tinha fogo 8, água 8, ar 8,
//     terra 12 e neutro 12. Os 42 itens novos entram como fogo 10, água 10,
//     ar 10, terra 6 e neutro 6 — o acervo fecha em 18 de cada elemento.
//
// O QUE NÃO ENTRA: nenhuma peça lendária nova. O lendário é UM, é o mais forte
// e mora no calabouço final — decisão do usuário, e `validate_fusion.html`
// cobra (exatamente 4 lendárias, todas do `cp-set-heart`).
//
// EQUILÍBRIO (as três contas que este arquivo teve de fechar):
//   • SAQUE. O peso não é escrito à mão: o rodapé daqui roda o MESMO modelo de
//     `items.js` sobre o acervo INTEIRO (velho + novo). O modelo é normalizado
//     por calabouço, então acrescentar item não afrouxa o saque — as fatias por
//     raridade (≈34% comum, ≈13,5% raro, ≈2,5% épico, ≈50% nada) continuam de pé.
//   • ESQUIVA (§9-H). Toda peça de Passo vende esquiva e o teto por peça é 16.
//     As 10 botas novas ficam entre 8 e 13: NENHUMA encosta no teto, e o topo do
//     jogo continua sendo a Bota de Azougue (16). O maior total de esquiva que um
//     herói consegue montar segue sendo o mesmo de antes — 53 (Traje do Vendaval
//     completo com as botas no +10).
//   • TETO POR ITEM. Nenhuma peça nova concede +1 PA nem +1 PP: as chaves de
//     ação continuam sendo só as 12 peças que já existiam. Isso mantém de pé o
//     teto de `validate_fusion.html` (+1 PA / +1 PP em qualquer nível de forja)
//     sem depender de arredondamento.
// ============================================================================

JOGO.DATA = JOGO.DATA || {};

(function () {
  'use strict';

  var DATA = JOGO.DATA;

  DATA.items = DATA.items || {};
  DATA.sets = DATA.sets || {};
  DATA.itemSpells = DATA.itemSpells || {};

  var I = DATA.items;

  function rng(min, max, line, los) {
    return { min: min, max: max, line: line === true, los: los !== false, movable: false };
  }
  function aoe(shape, size) { return { shape: shape, size: size || 0 }; }

  function itemSpell(o) {
    DATA.itemSpells[o.id] = {
      id: o.id, name: o.name, element: o.element, classId: null, unlockLevel: 0,
      paCost: o.paCost, cooldown: o.cooldown, castsPerTurn: o.castsPerTurn || 1,
      range: o.range, aoe: o.aoe || aoe('single', 0),
      needsEmptyTile: o.needsEmptyTile === true, targetSide: o.targetSide,
      effects: o.effects, description: o.description, flavor: o.flavor, fxKey: o.fxKey
    };
  }

  // Peça de CONJUNTO: `element` e `setId` são preenchidos no rodapé a partir do
  // conjunto (nunca à mão, para item e conjunto não poderem divergir).
  function item(o) {
    I[o.id] = {
      id: o.id, name: o.name, slot: o.slot, rarity: o.rarity, dungeonId: o.dungeonId,
      element: null, setId: null, dropWeight: 0,
      bonuses: o.bonuses || {}, grantsSpell: o.grantsSpell || null,
      description: o.description, flavor: o.flavor, iconKey: o.iconKey
    };
  }

  // Peça AVULSA: não tem conjunto, então declara o próprio elemento e fica com
  // `setId: null` para sempre. É o que o rodapé usa para reconhecê-la.
  function loose(o) {
    I[o.id] = {
      id: o.id, name: o.name, slot: o.slot, rarity: o.rarity, dungeonId: o.dungeonId,
      element: o.element, setId: null, dropWeight: 0,
      bonuses: o.bonuses || {}, grantsSpell: o.grantsSpell || null,
      description: o.description, flavor: o.flavor, iconKey: o.iconKey
    };
  }

  // =========================================================================
  // FEITIÇOS NOVOS DE LUME — um por Lume novo (6 de conjunto + 3 avulsos).
  // =========================================================================

  itemSpell({
    id: 'is-swarm-sting', name: 'Ferroada em Enxame', element: 'ar',
    paCost: 3, cooldown: 2, range: rng(1, 5), targetSide: 'enemy',
    effects: [
      { type: 'chain', jumps: 2, falloff: 0.6, element: 'ar', min: 13, max: 18 },
      { type: 'poison', element: 'ar', min: 4, max: 7, duration: 2 }
    ],
    description: 'Abre a portinhola do favo e solta três vespas de uma vez: elas pulam de inimigo em inimigo perdendo fôlego a cada salto e deixam a picada trabalhando por dois turnos.',
    flavor: 'Voltam sozinhas. Contam certo quem faltou.',
    fxKey: 'beam'
  });

  itemSpell({
    id: 'is-silt-grip', name: 'Agarrão de Lodo', element: 'terra',
    paCost: 3, cooldown: 3, range: rng(1, 4), aoe: aoe('circle', 1), targetSide: 'enemy',
    effects: [
      { type: 'damage', element: 'terra', min: 15, max: 20 },
      { type: 'root', duration: 1 }
    ],
    description: 'O lodo do ralo sobe em pinça e fecha em volta dos pés de todo mundo na roda: machuca ao apertar e não deixa ninguém sair de onde estava.',
    flavor: 'O ralo é propriedade privada. Você foi avisado.',
    fxKey: 'slam'
  });

  itemSpell({
    id: 'is-quench-hiss', name: 'Chiado de Têmpera', element: 'agua',
    paCost: 3, cooldown: 3, range: rng(1, 5), aoe: aoe('circle', 1), targetSide: 'enemy',
    effects: [
      { type: 'damage', element: 'agua', min: 16, max: 21 },
      { type: 'dispelShield' }
    ],
    description: 'Despeja no alvo a água do fosso de têmpera: a nuvem de vapor queima por dentro e apaga qualquer casca mágica que ele tenha acendido.',
    flavor: 'Foi assim que se temperou tudo aqui. Inclusive as pessoas.',
    fxKey: 'burst'
  });

  itemSpell({
    id: 'is-noose-drag', name: 'Laço de Roldana', element: 'neutro',
    paCost: 4, cooldown: 3, range: rng(2, 6), targetSide: 'enemy',
    effects: [
      { type: 'damage', element: 'neutro', min: 13, max: 18 },
      { type: 'pull', tiles: 3 },
      { type: 'root', duration: 1 }
    ],
    description: 'Lança um laço de corda de obra e recolhe: arrasta o alvo três células para perto e deixa o nó apertado no tornozelo por um turno.',
    flavor: 'Material que chega na plataforma não volta.',
    fxKey: 'hook'
  });

  itemSpell({
    id: 'is-firedamp-blast', name: 'Estouro de Grisu', element: 'fogo',
    paCost: 4, cooldown: 3, range: rng(2, 6), aoe: aoe('circle', 2), targetSide: 'enemy',
    effects: [
      { type: 'damage', element: 'fogo', min: 19, max: 26 },
      { type: 'push', tiles: 1 }
    ],
    description: 'Abre a tela da lamparina de propósito e deixa o gás da galeria encontrar a chama: o bolsão inteiro estoura duas células adiante e o sopro afasta quem estava perto.',
    flavor: 'A tela existe para isso não acontecer. Você a abriu.',
    fxKey: 'nova'
  });

  itemSpell({
    id: 'is-gale-cut', name: 'Corte do Arauto', element: 'ar',
    paCost: 4, cooldown: 2, range: rng(1, 6, true), aoe: aoe('line', 3), targetSide: 'enemy',
    effects: [
      { type: 'damage', element: 'ar', min: 18, max: 24 },
      { type: 'push', tiles: 2 }
    ],
    description: 'O vento preso no farol sai numa lâmina só e atravessa a fila inteira em linha reta, empurrando dois passos cada corpo que cortou.',
    flavor: 'Chega, corta e já está em outro lugar. Copie.',
    fxKey: 'slash'
  });

  itemSpell({
    id: 'is-bone-toll', name: 'Dobre de Ossos', element: 'neutro',
    paCost: 3, cooldown: 3, range: rng(0, 0, false, false), aoe: aoe('circle', 2), targetSide: 'enemy',
    effects: [
      { type: 'damage', element: 'neutro', min: 12, max: 17 },
      { type: 'taunt', duration: 2 }
    ],
    description: 'A candeia bate uma nota funda que a corte afogada reconhece: quem está a duas células apanha e passa dois turnos sem conseguir olhar para outra pessoa.',
    flavor: 'Eles ainda respondem à chamada. Sempre respondem.',
    fxKey: 'nova'
  });

  itemSpell({
    id: 'is-long-wick', name: 'Pavio Longo', element: 'fogo',
    paCost: 3, cooldown: 2, range: rng(1, 5), targetSide: 'enemy',
    effects: [
      { type: 'damage', element: 'fogo', min: 12, max: 16 },
      { type: 'poison', element: 'fogo', min: 8, max: 12, duration: 3 }
    ],
    description: 'Enfia no alvo um pavio de mina aceso: a queimadura inicial é pequena, mas o pavio continua descendo por dentro dele durante três turnos.',
    flavor: 'Pavio longo é para quem tem tempo de sair andando.',
    fxKey: 'debuff'
  });

  itemSpell({
    id: 'is-cinder-wake', name: 'Rastro de Brasa', element: 'fogo',
    paCost: 4, cooldown: 3, range: rng(0, 0, false, false), aoe: aoe('ring', 2), targetSide: 'enemy',
    effects: [
      { type: 'damage', element: 'fogo', min: 20, max: 27 },
      { type: 'poison', element: 'fogo', min: 8, max: 12, duration: 2 }
    ],
    description: 'O turíbulo é girado uma volta inteira e larga um anel de brasa a duas células do corpo: pega quem estava se aproximando, e não quem já chegou.',
    flavor: 'Queima o círculo de fora. O de dentro é problema seu.',
    fxKey: 'nova'
  });

  // =========================================================================
  // 1. A ESTUFA SOTERRADA (greenhouse) — gh-
  //    Conjunto novo: TRAJE DO ENXAME (ar) — Vespa-Lustre e o que zumbe no vidro.
  //    Avulsos: presa de Aranha-de-Orvalho (água), casca de calha (água),
  //             espora de Vergasta (terra).
  // =========================================================================

  item({ id: 'gh-wasp-sting', name: 'Ferrão de Vespa-Lustre', slot: 'punho', rarity: 'comum',
    dungeonId: 'greenhouse', bonuses: { initiative: 9, power: 4 },
    description: 'O ferrão de uma Vespa-Lustre montado num cabo de bambu, com um resto da lanterna do abdômen ainda preso na base. Chega antes da mão. +9 de iniciativa, +4 de poder.',
    flavor: 'Ainda pisca. Ninguém teve coragem de perguntar por quê.',
    iconKey: 'wasp-sting' });

  item({ id: 'gh-pollen-slippers', name: 'Chinelas de Pólen', slot: 'passo', rarity: 'comum',
    dungeonId: 'greenhouse', bonuses: { dodge: 9, initiative: 6 },
    description: 'Solas cobertas de pólen prensado que levantam uma nuvenzinha amarela a cada passada e borram o contorno de quem anda. +9 de esquiva, +6 de iniciativa.',
    flavor: 'Espirrar entrega a posição. Segure.',
    iconKey: 'pollen-slippers' });

  item({ id: 'gh-chitin-vest', name: 'Colete de Quitina', slot: 'casca', rarity: 'comum',
    dungeonId: 'greenhouse', bonuses: { hp: 18, resists: { ar: 8 } },
    description: 'Placas do dorso do enxame costuradas em telha, leves como papel e duras como unha. O vento passa por elas sem encontrar nada para empurrar. +18 PV, +8% de resistência a ar.',
    flavor: 'Pesa menos que a camisa que você está usando.',
    iconKey: 'chitin-vest' });

  item({ id: 'gh-hive-lantern', name: 'Lanterna de Favo', slot: 'lume', rarity: 'raro',
    dungeonId: 'greenhouse', bonuses: { initiative: 8 }, grantsSpell: 'is-swarm-sting',
    description: 'Um naco de favo com três vespas-lustre vivas presas nas células, brilhando amarelo através da cera. Abrir a portinhola solta as três. Concede o feitiço Ferroada em Enxame.',
    flavor: 'A luz é o aluguel. Elas cobram o resto na hora.',
    iconKey: 'hive-lantern' });

  loose({ id: 'gh-dew-fang', name: 'Presa de Orvalho', slot: 'punho', rarity: 'comum',
    dungeonId: 'greenhouse', element: 'agua', bonuses: { power: 11, initiative: 2 },
    description: 'A quelícera de uma Aranha-de-Orvalho amarrada ao punho com fio de teia endurecida, sempre com uma gota pendurada na ponta que não cai nunca. +11 de poder, +2 de iniciativa.',
    flavor: 'A gota pesa menos que o ar. A presa, não.',
    iconKey: 'dew-fang' });

  loose({ id: 'gh-gutter-shell', name: 'Casca de Calha', slot: 'casca', rarity: 'raro',
    dungeonId: 'greenhouse', element: 'agua', bonuses: { hp: 32, resists: { agua: 12, ar: 5 } },
    description: 'Meia calha de cobre da estufa dobrada em concha sobre o peito, com mil anos de limo verde por dentro servindo de forro. A chuva escorre por ela como sempre escorreu. +32 PV, +12% água, +5% ar.',
    flavor: 'Cuida da água há mil anos. Não vai parar por sua causa.',
    iconKey: 'gutter-shell' });

  loose({ id: 'gh-root-spur', name: 'Esporas de Vergasta', slot: 'passo', rarity: 'raro',
    dungeonId: 'greenhouse', element: 'terra', bonuses: { dodge: 11, lock: 8 },
    description: 'Dois pedaços de Vergasta ainda vivos amarrados aos calcanhares: puxam o pé para longe do golpe e, quando o dono planta os calcanhares, criam raiz em cima de quem tentar fugir. +11 de esquiva, +8 de fixação.',
    flavor: 'Podadas do coreto, e ainda de mau humor.',
    iconKey: 'root-spur' });

  // =========================================================================
  // 2. A CISTERNA DOS AFOGADOS (cistern) — ci-
  //    Conjunto novo: TRAJE DO SUMIDOURO (terra) — o Caranguejo do ralo.
  //    Avulsos: presa de Moreia-Flauta (água), malha de pérola (água),
  //             candeia de osso da corte (neutro).
  // =========================================================================

  item({ id: 'ci-crab-claw', name: 'Pinça de Sumidouro', slot: 'punho', rarity: 'comum',
    dungeonId: 'cistern', bonuses: { power: 14, lock: 10 },
    description: 'A pinça grande do Caranguejo de Sumidouro, encaixada no antebraço com correias de couro molhado. Fecha uma vez e não abre por decisão de ninguém. +14 de poder, +10 de fixação.',
    flavor: 'Ele arrastava essa coisa pelo chão. Você também vai.',
    iconKey: 'crab-claw' });

  item({ id: 'ci-silt-boots', name: 'Botas de Assoreamento', slot: 'passo', rarity: 'comum',
    dungeonId: 'cistern', bonuses: { dodge: 8, lock: 8 },
    description: 'Botas de cano curto entupidas de lodo compactado até virarem lastro: escorregam para fora do golpe e depois afundam no lugar, arrastando junto quem estiver colado. +8 de esquiva, +8 de fixação.',
    flavor: 'O ralo entope de baixo para cima. Aprenda com ele.',
    iconKey: 'silt-boots' });

  item({ id: 'ci-crust-carapace', name: 'Carapaça de Crosta', slot: 'casca', rarity: 'raro',
    dungeonId: 'cistern', bonuses: { hp: 32, resists: { terra: 12, agua: 6 } },
    description: 'O dorso do caranguejo inteiro, com a crosta de sal e pedra que ele levou uma vida acumulando ainda grudada nas bordas. Pesa como uma mesa. +32 PV, +12% terra, +6% água.',
    flavor: 'Cada camada é um ano em que ninguém conseguiu tirá-lo do ralo.',
    iconKey: 'crust-carapace' });

  item({ id: 'ci-sump-lamp', name: 'Lamparina de Sumidouro', slot: 'lume', rarity: 'raro',
    dungeonId: 'cistern', bonuses: { hp: 14 }, grantsSpell: 'is-silt-grip',
    description: 'Lamparina de latão que ficou décadas presa na grade do ralo, com a chama enlodada de verde e o vidro riscado por dentro. Onde a luz dela bate no chão, o lodo obedece. Concede o feitiço Agarrão de Lodo.',
    flavor: 'Acesa embaixo d\'água, e nenhum afogado achou isso estranho.',
    iconKey: 'sump-lamp' });

  loose({ id: 'ci-piper-fang', name: 'Presa de Moreia-Flauta', slot: 'punho', rarity: 'raro',
    dungeonId: 'cistern', element: 'agua', bonuses: { power: 18, initiative: 6 },
    description: 'A mandíbula inferior de uma Moreia-Flauta, com os dentes virados para dentro e um furo de flauta em cada lado que assobia grave quando o braço desce. +18 de poder, +6 de iniciativa.',
    flavor: 'O assobio chega antes. É só o que ela te dá.',
    iconKey: 'piper-fang' });

  loose({ id: 'ci-pearl-mail', name: 'Malha de Pérola de Lodo', slot: 'casca', rarity: 'comum',
    dungeonId: 'cistern', element: 'agua', bonuses: { hp: 24, resists: { agua: 10 } },
    description: 'Milhares de pérolas calcificadas do fundo da cisterna furadas e costuradas em malha. Cada uma se formou em volta de um grão de sujeira da corte. +24 PV, +10% de resistência a água.',
    flavor: 'Bonita de longe. De perto, é uma lista de nomes.',
    iconKey: 'pearl-mail' });

  loose({ id: 'ci-bone-lamp', name: 'Candeia de Ossos', slot: 'lume', rarity: 'comum',
    dungeonId: 'cistern', element: 'neutro', grantsSpell: 'is-bone-toll',
    bonuses: { power: 6 },
    description: 'Uma gaiola de costelas polidas com um caroço de luz fria pendurado dentro. Bater no osso maior com o nó do dedo faz a cisterna inteira responder. Concede o feitiço Dobre de Ossos.',
    flavor: 'A corte era grande. Sempre sobra quem responda.',
    iconKey: 'bone-lamp' });

  // =========================================================================
  // 3. O FECHO DE BRASA (emberlock) — em-
  //    Conjunto novo: TRAJE DA TÊMPERA (água) — o Cão-de-Têmpera e os fossos.
  //    A única água do Fecho vira o único conjunto que não queima junto.
  //    Avulsos: manopla de Tição (fogo), placa de escória quente (fogo),
  //             correntes do Puxa-Corrente (neutro).
  // =========================================================================

  item({ id: 'em-quench-fang', name: 'Presa de Têmpera', slot: 'punho', rarity: 'comum',
    dungeonId: 'emberlock', bonuses: { power: 14, initiative: 4 },
    description: 'A mandíbula do Cão-de-Têmpera, ainda gotejando o vapor condensado que a formou. Cada mordida chia como lâmina entrando no fosso. +14 de poder, +4 de iniciativa.',
    flavor: 'A água do Fecho tem dente. Agora é o seu dente.',
    iconKey: 'quench-fang' });

  item({ id: 'em-quench-treads', name: 'Solados de Fosso', slot: 'passo', rarity: 'comum',
    dungeonId: 'emberlock', bonuses: { dodge: 13, initiative: 6 },
    description: 'Solas encharcadas na água dos fossos de têmpera que nunca secam: pisam na grelha em brasa sem chiar e deixam uma pegada fria por onde passam. +13 de esquiva, +6 de iniciativa.',
    flavor: 'A brasa recua um passo. Sempre o mesmo passo.',
    iconKey: 'quench-treads' });

  item({ id: 'em-quench-vest', name: 'Peitoral de Vapor', slot: 'casca', rarity: 'raro',
    dungeonId: 'emberlock', bonuses: { hp: 36, resists: { agua: 12, fogo: 8 } },
    description: 'Duas chapas com um dedo de água presa entre elas, que vira vapor quando o calor aperta e engrossa a defesa exatamente quando ela é necessária. +36 PV, +12% água, +8% fogo.',
    flavor: 'Chia antes de você sentir. É o aviso incluso.',
    iconKey: 'quench-vest' });

  item({ id: 'em-quench-lamp', name: 'Lampião de Têmpera', slot: 'lume', rarity: 'raro',
    dungeonId: 'emberlock', bonuses: { hp: 12 }, grantsSpell: 'is-quench-hiss',
    description: 'Lampião de vidro grosso cheio até a boca com a água dos fossos, aceso por dentro num azul frio que não vem de chama nenhuma. Inclinar derrama. Concede o feitiço Chiado de Têmpera.',
    flavor: 'A única coisa acesa aqui que não é fogo.',
    iconKey: 'quench-lamp' });

  loose({ id: 'em-imp-gauntlet', name: 'Manopla de Tição', slot: 'punho', rarity: 'raro',
    dungeonId: 'emberlock', element: 'fogo', bonuses: { power: 15, resists: { fogo: 6 } },
    description: 'Um Tição inteiro endurecido em molde de areia e vazado por dentro para caber a mão. Continua quente e continua de mau humor. +15 de poder, +6% de resistência a fogo.',
    flavor: 'Magno fabricava esses sem olhar. Um sobrou inteiro.',
    iconKey: 'imp-gauntlet' });

  loose({ id: 'em-cinder-plate', name: 'Placa de Escória Viva', slot: 'casca', rarity: 'comum',
    dungeonId: 'emberlock', element: 'fogo', bonuses: { hp: 28, resists: { fogo: 14 } },
    description: 'Placa de escória arrancada do Monte antes de esfriar, com veios laranja ainda correndo por dentro do cinza. Aquece as costas do dono a noite inteira. +28 PV, +14% de resistência a fogo.',
    flavor: 'Esfria em mil anos. Faltam novecentos.',
    iconKey: 'cinder-plate' });

  loose({ id: 'em-hauler-links', name: 'Correntes de Arrasto', slot: 'passo', rarity: 'comum',
    dungeonId: 'emberlock', element: 'neutro', bonuses: { dodge: 11, lock: 12 },
    description: 'Três elos do carretel do Puxa-Corrente arrastados atrás dos calcanhares: dão contrapeso para girar fora do golpe e enroscam no tornozelo de quem tentar se soltar. +11 de esquiva, +12 de fixação.',
    flavor: 'Ele não perseguia ninguém. Trazia todo mundo.',
    iconKey: 'hauler-links' });

  // =========================================================================
  // 4. OS ANDAIMES DO VENTO (windscaffold) — av-
  //    Conjunto novo: TRAJE DO ENFORCA-CORDA (neutro) — o novelo da roldana.
  //    Nos Andaimes tudo é ar; o terceiro conjunto é a exceção sem elemento —
  //    corda, nó e roldana, que o vendaval não ajuda nem atrapalha.
  //    Avulsos: garra de Picanço (ar), faixa de Serpe-Pipa (ar),
  //             grevas do Golem de Lastro (terra).
  // =========================================================================

  item({ id: 'av-noose-grip', name: 'Punho de Nó Cego', slot: 'punho', rarity: 'comum',
    dungeonId: 'windscaffold', bonuses: { power: 16, lock: 10 },
    description: 'Um nó de corda de obra do tamanho de um punho, endurecido de alcatrão e impossível de desfazer, com meia braça de cabo sobrando para laçar. +16 de poder, +10 de fixação.',
    flavor: 'Ninguém desfez esse nó. Ninguém vai.',
    iconKey: 'noose-grip' });

  item({ id: 'av-hemp-boots', name: 'Botas de Cânhamo', slot: 'passo', rarity: 'comum',
    dungeonId: 'windscaffold', bonuses: { dodge: 10, initiative: 8 },
    description: 'Botas com a sola enfaixada em cânhamo trançado que morde a tábua molhada e não deixa o pé escorregar para o vão. +10 de esquiva, +8 de iniciativa.',
    flavor: 'Nos Andaimes, a diferença entre andar e cair é o atrito.',
    iconKey: 'hemp-boots' });

  item({ id: 'av-knot-jerkin', name: 'Gibão de Nós', slot: 'casca', rarity: 'raro',
    dungeonId: 'windscaffold', bonuses: { hp: 40, resists: { neutro: 14, ar: 5 } },
    description: 'Gibão trançado inteiro em nós de marinheiro sobrepostos, tão apertado que o vento não encontra folga nenhuma para levantar. +40 PV, +14% neutro, +5% ar.',
    flavor: 'Cada nó tem nome. Este aqui tem quarenta.',
    iconKey: 'knot-jerkin' });

  item({ id: 'av-hangman-lamp', name: 'Farolete de Roldana', slot: 'lume', rarity: 'raro',
    dungeonId: 'windscaffold', bonuses: { hp: 14 }, grantsSpell: 'is-noose-drag',
    description: 'Farolete de sinaleiro pendurado num gancho de roldana, com um carretel de cabo enrolado na base e a chama sempre virada para o vão. Puxar o cabo traz de volta o que o laço pegou. Concede o feitiço Laço de Roldana.',
    flavor: 'Serve para içar material. Você é material.',
    iconKey: 'hangman-lamp' });

  loose({ id: 'av-shrike-talon', name: 'Garra de Picanço', slot: 'punho', rarity: 'comum',
    dungeonId: 'windscaffold', element: 'ar', bonuses: { initiative: 18, power: 8 },
    description: 'A garra de um Picanço-de-Tábua calçada como soqueira, com os ossinhos que ele espetava nos pregos ainda pendurados por um fio. +18 de iniciativa, +8 de poder.',
    flavor: 'O ninho dele era um mostruário. Você levou uma peça.',
    iconKey: 'shrike-talon' });

  loose({ id: 'av-serpent-sash', name: 'Faixa de Serpe-Pipa', slot: 'casca', rarity: 'raro',
    dungeonId: 'windscaffold', element: 'ar', bonuses: { hp: 34, resists: { ar: 16 } },
    description: 'A cauda de fitas de uma Serpe-Pipa enrolada duas voltas no peito, com o vidro moído ainda colado no encerado. Sobe com a corrente e leva o corpo meio palmo junto. +34 PV, +16% de resistência a ar.',
    flavor: 'Uma pipa que aprendeu a puxar a própria linha. Você segura a linha agora.',
    iconKey: 'serpent-sash' });

  loose({ id: 'av-ballast-greaves', name: 'Grevas de Lastro', slot: 'passo', rarity: 'comum',
    dungeonId: 'windscaffold', element: 'terra', bonuses: { dodge: 11, lock: 12 },
    description: 'Dois sacos de brita do Golem de Lastro amarrados às canelas: dão inércia para desviar sem sair da tábua e peso de âncora contra quem quiser passar. +11 de esquiva, +12 de fixação.',
    flavor: 'Segurou o andaime por mil anos. Agora segura você — e quem chegar perto.',
    iconKey: 'ballast-greaves' });

  // =========================================================================
  // 5. A MINA TRÊMULA (quakemine) — mt-
  //    Conjunto novo: TRAJE DO GRISU (fogo) — a chama azul das galerias.
  //    Numa mina de terra, o fogo é o que ninguém quer encontrar; por isso o
  //    terceiro conjunto daqui é o único que ataca em vez de aguentar.
  //    Avulsos: soqueira de detonação (fogo), pavio de mina (fogo),
  //             peitoral da Escorrência (água).
  // =========================================================================

  item({ id: 'mt-firedamp-fist', name: 'Punho de Grisu', slot: 'punho', rarity: 'comum',
    dungeonId: 'quakemine', bonuses: { power: 20, initiative: 6 },
    description: 'Uma bolsa de couro cheia do gás azul da galeria, costurada em volta da mão e lacrada com breu. Cada soco arrota um pouco de chama pelas costuras. +20 de poder, +6 de iniciativa.',
    flavor: 'Vaza um pouco. Sempre vaza um pouco.',
    iconKey: 'firedamp-fist' });

  item({ id: 'mt-wisp-treads', name: 'Solados de Fogaréu', slot: 'passo', rarity: 'comum',
    dungeonId: 'quakemine', bonuses: { dodge: 13, initiative: 7 },
    description: 'Solados que boiam um dedo acima do cascalho, do mesmo jeito que o Fogaréu de Grisu boia à altura do peito. Não fazem barulho e não pisam em armadilha. +13 de esquiva, +7 de iniciativa.',
    flavor: 'A poeira não sobe. É como a mina sabe que você chegou.',
    iconKey: 'wisp-treads' });

  item({ id: 'mt-damp-mantle', name: 'Manto de Chama Azul', slot: 'casca', rarity: 'raro',
    dungeonId: 'quakemine', bonuses: { hp: 44, resists: { fogo: 16, terra: 6 } },
    description: 'Um manto de lona de mineiro com uma película de gás aceso correndo por fora do tecido, azul e sem calor. O que vem quente encontra fogo antes de encontrar pano. +44 PV, +16% fogo, +6% terra.',
    flavor: 'Frio ao toque. Mentira das boas.',
    iconKey: 'damp-mantle' });

  item({ id: 'mt-firedamp-lamp', name: 'Lamparina de Segurança', slot: 'lume', rarity: 'raro',
    dungeonId: 'quakemine', bonuses: { power: 10 }, grantsSpell: 'is-firedamp-blast',
    description: 'A lamparina de tela de arame que avisava o mineiro do grisu: a chama cresce e fica azul quando o gás chega. A tela abre — e foi para isso que você a pegou. Concede o feitiço Estouro de Grisu.',
    flavor: 'Inventada para salvar vidas. Depende do lado da tela.',
    iconKey: 'firedamp-lamp' });

  loose({ id: 'mt-blast-knuckles', name: 'Soqueira de Detonação', slot: 'punho', rarity: 'raro',
    dungeonId: 'quakemine', element: 'fogo', bonuses: { power: 21, resists: { fogo: 8 } },
    description: 'Quatro cápsulas de dinamite úmida engastadas numa barra de ferro, uma por dedo. Nenhuma explodiu ainda; todas ouviram o convite. +21 de poder, +8% de resistência a fogo.',
    flavor: 'A caixa dizia "úmida". A caixa mentia sobre muita coisa.',
    iconKey: 'blast-knuckles' });

  loose({ id: 'mt-seep-plate', name: 'Peitoral de Escorrência', slot: 'casca', rarity: 'comum',
    dungeonId: 'quakemine', element: 'agua', bonuses: { hp: 42, resists: { agua: 14, terra: 6 } },
    description: 'Uma placa de mineral depositado camada por camada pela água que escorre parede acima, lisa de um lado e áspera do outro. Escudo que a própria mina fabricou sozinha. +42 PV, +14% água, +6% terra.',
    flavor: 'Água de mina não mata a sede. Serve para outra coisa.',
    iconKey: 'seep-plate' });

  loose({ id: 'mt-grisu-wick', name: 'Pavio de Grisu', slot: 'lume', rarity: 'comum',
    dungeonId: 'quakemine', element: 'fogo', grantsSpell: 'is-long-wick',
    bonuses: { power: 7 },
    description: 'Um rolo de pavio de mina embebido em gás azul, com uma ponta sempre acesa numa chama do tamanho de uma unha. Queima devagar e não apaga com vento. +7 de poder. Concede o feitiço Pavio Longo.',
    flavor: 'Acende num canto da galeria e cobra no outro.',
    iconKey: 'grisu-wick' });

  // =========================================================================
  // 6. O CORAÇÃO PARTIDO (brokenheart) — cp-
    //  Conjunto novo: TRAJE DO VENDAVAL PARTIDO (ar) — o quarto de ar do
    //  Coração, o Arauto de Vendaval e o Mote do Tempo. NÃO é lendário: o
    //  lendário continua sendo um só, o Traje do Coração.
    //  Avulsos: manopla do Arauto de Brasa (fogo), turíbulo (fogo),
    //           tornozeleiras do Arauto de Maré (água).
  // =========================================================================

  item({ id: 'cp-gale-fist', name: 'Manopla de Vendaval', slot: 'punho', rarity: 'comum',
    dungeonId: 'brokenheart', bonuses: { power: 18, initiative: 11 },
    description: 'A manopla vazia do Arauto de Vendaval, mantida em forma de mão só pelo vento que continua correndo dentro dela. Fecha sozinha meio instante antes do golpe. +18 de poder, +11 de iniciativa.',
    flavor: 'Não tem nada aí dentro. Continua doendo.',
    iconKey: 'gale-fist' });

  item({ id: 'cp-gale-steps', name: 'Grevas de Vendaval', slot: 'passo', rarity: 'comum',
    dungeonId: 'brokenheart', bonuses: { dodge: 12, initiative: 12 },
    description: 'Duas grevas ocas da mesma armadura, com o vento entrando pelo joelho e saindo pelo calcanhar a cada passada. Chegam onde miraram e não onde o inimigo esperou. +12 de esquiva, +12 de iniciativa.',
    flavor: 'Difícil de prender, pior de acertar. Era o lema dele.',
    iconKey: 'gale-steps' });

  item({ id: 'cp-gale-plate', name: 'Couraça Oca', slot: 'casca', rarity: 'comum',
    dungeonId: 'brokenheart', bonuses: { hp: 48, resists: { ar: 16, neutro: 6 } },
    description: 'O tronco da armadura do Arauto, sem forro, sem dono e sem peso: por dentro é só corrente de ar girando. O golpe entra e não encontra em que bater. +48 PV, +16% ar, +6% neutro.',
    flavor: 'Vazia de verdade. Confirme batendo — soa como sino.',
    iconKey: 'gale-plate' });

  item({ id: 'cp-gale-lamp', name: 'Farol de Vendaval', slot: 'lume', rarity: 'raro',
    dungeonId: 'brokenheart', bonuses: { initiative: 10 }, grantsSpell: 'is-gale-cut',
    description: 'O elmo do Arauto virado de boca para cima e usado como farol, com o vento dele preso lá dentro empurrando uma chama branca deitada. Soltar o vento corta em linha reta. Concede o feitiço Corte do Arauto.',
    flavor: 'A chama nunca fica em pé. Nunca apaga também.',
    iconKey: 'gale-lamp' });

  loose({ id: 'cp-herald-ember', name: 'Manopla do Arauto de Brasa', slot: 'punho', rarity: 'raro',
    dungeonId: 'brokenheart', element: 'fogo', bonuses: { power: 21, resists: { fogo: 10 } },
    description: 'A manopla do quarto de brasa do Coração, cheia até o pulso de carvão que não termina de queimar. Marca a palma de quem a veste no primeiro dia e não marca mais. +21 de poder, +10% de resistência a fogo.',
    flavor: 'A marca é o contrato. Você já assinou.',
    iconKey: 'herald-ember' });

  loose({ id: 'cp-ember-censer', name: 'Turíbulo de Brasa', slot: 'lume', rarity: 'raro',
    dungeonId: 'brokenheart', element: 'fogo', grantsSpell: 'is-cinder-wake',
    bonuses: { power: 11 },
    description: 'Um incensário de corrente curta com um caco do quarto de brasa alojado no fundo, aceso e soltando fumaça vermelha. Girado uma volta inteira, larga um anel de fogo no chão. +11 de poder. Concede o feitiço Rastro de Brasa.',
    flavor: 'Alguém rezava com isto. Não terminou a reza.',
    iconKey: 'ember-censer' });

  loose({ id: 'cp-tide-anklets', name: 'Tornozeleiras de Maré', slot: 'passo', rarity: 'comum',
    dungeonId: 'brokenheart', element: 'agua', bonuses: { dodge: 13, initiative: 10 },
    description: 'Duas argolas cheias da água escura do Arauto de Maré, sempre em movimento por dentro do metal. Puxam o pé para o lado certo meio tempo antes do golpe chegar. +13 de esquiva, +10 de iniciativa.',
    flavor: 'A água decide primeiro. Você só não discorda.',
    iconKey: 'tide-anklets' });

  // =========================================================================
  // OS 6 CONJUNTOS NOVOS — o terceiro de cada calabouço.
  // Mesmas regras dos 12 antigos: 4 peças (uma por espaço), bônus progressivos
  // em 2/3/4 e resistência ao PRÓPRIO elemento no fecho. Nenhum deles concede
  // feitiço ao fechar: essa continua sendo a identidade exclusiva do lendário.
  // Os totais de 4 peças ficam DE PROPÓSITO abaixo dos dois conjuntos irmãos de
  // cada calabouço quando o irmão é o do chefe — o terceiro conjunto é o mais
  // fácil de fechar (4 peças comuns e raras, sem épico no meio), então paga
  // menos. E nenhum deles vende esquiva de conjunto acima de 14: o topo segue
  // sendo o Traje do Cordame, com 24.
  // =========================================================================

  DATA.sets['gh-set-swarm'] = {
    id: 'gh-set-swarm', name: 'Traje do Enxame', element: 'ar', dungeonId: 'greenhouse',
    description: 'Quitina, pólen e três vespas presas num favo. O que zumbe na estufa não briga: chega primeiro, resolve e some antes de a planta perceber que perdeu alguém.',
    pieces: ['gh-wasp-sting', 'gh-pollen-slippers', 'gh-chitin-vest', 'gh-hive-lantern'],
    bonuses: {
      2: { initiative: 10, dodge: 4 },
      3: { initiative: 16, dodge: 7, resists: { ar: 6 } },
      4: { initiative: 24, dodge: 10, power: 8, resists: { ar: 12 } }
    }
  };

  DATA.sets['ci-set-sump'] = {
    id: 'ci-set-sump', name: 'Traje do Sumidouro', element: 'terra', dungeonId: 'cistern',
    description: 'Pedra, sal e lodo compactado — o que se acumulou no ralo por onde a cisterna esvazia. Não flutua, não desvia e não sai do lugar que escolheu.',
    pieces: ['ci-crab-claw', 'ci-silt-boots', 'ci-crust-carapace', 'ci-sump-lamp'],
    bonuses: {
      2: { hp: 16, lock: 6 },
      3: { hp: 26, lock: 10, resists: { terra: 8 } },
      4: { hp: 38, lock: 16, power: 8, resists: { terra: 14 } }
    }
  };

  DATA.sets['em-set-quench'] = {
    id: 'em-set-quench', name: 'Traje da Têmpera', element: 'agua', dungeonId: 'emberlock',
    description: 'A única água do Fecho, vestida. Foi feita para apagar lâmina em brasa, e não desaprendeu: onde este traje passa, o fogo da casa recua um passo e fica olhando.',
    pieces: ['em-quench-fang', 'em-quench-treads', 'em-quench-vest', 'em-quench-lamp'],
    bonuses: {
      2: { hp: 18, power: 6 },
      3: { hp: 28, power: 10, resists: { agua: 10 } },
      4: { hp: 42, power: 16, initiative: 10, resists: { agua: 18, fogo: 8 } }
    }
  };

  DATA.sets['av-set-noose'] = {
    id: 'av-set-noose', name: 'Traje do Enforca-Corda', element: 'neutro', dungeonId: 'windscaffold',
    description: 'Corda, nó e roldana: o material de obra que sobreviveu aos obreiros. Não tem elemento nenhum, então o vendaval não ajuda e também não atrapalha — e nos Andaimes isso é uma vantagem inteira.',
    pieces: ['av-noose-grip', 'av-hemp-boots', 'av-knot-jerkin', 'av-hangman-lamp'],
    bonuses: {
      2: { hp: 18, lock: 8 },
      3: { hp: 30, lock: 14, resists: { neutro: 10 } },
      4: { hp: 44, lock: 22, power: 12, resists: { neutro: 18 } }
    }
  };

  DATA.sets['mt-set-firedamp'] = {
    id: 'mt-set-firedamp', name: 'Traje do Grisu', element: 'fogo', dungeonId: 'quakemine',
    description: 'O gás azul que o turno da noite aprendeu a temer, costurado em roupa. Numa mina inteira de pedra e paciência, é a única coisa que resolve rápido — e resolve para os dois lados.',
    pieces: ['mt-firedamp-fist', 'mt-wisp-treads', 'mt-damp-mantle', 'mt-firedamp-lamp'],
    bonuses: {
      2: { power: 12, initiative: 8 },
      3: { power: 20, initiative: 12, resists: { fogo: 12 } },
      4: { power: 30, initiative: 18, hp: 24, resists: { fogo: 20 } }
    }
  };

  DATA.sets['cp-set-gale'] = {
    id: 'cp-set-gale', name: 'Traje do Vendaval Partido', element: 'ar', dungeonId: 'brokenheart',
    description: 'O quarto de ar do Coração, desmontado peça por peça do Arauto que o guardava. Por dentro é oco: quem o veste anda meio passo à frente do próprio corpo e chega antes de ser esperado.',
    pieces: ['cp-gale-fist', 'cp-gale-steps', 'cp-gale-plate', 'cp-gale-lamp'],
    bonuses: {
      2: { initiative: 14, dodge: 6 },
      3: { initiative: 22, dodge: 10, resists: { ar: 12 } },
      4: { initiative: 32, dodge: 14, power: 16, resists: { ar: 20, neutro: 8 } }
    }
  };

  // =========================================================================
  // RODAPÉ — REBIND DO ACERVO INTEIRO (velho + novo).
  //
  // Roda o MESMO modelo do rodapé de `items.js`, mas agora sobre `DATA.items`
  // completo. Tem de ser assim: os pesos são NORMALIZADOS por calabouço a
  // partir do peso total dos comuns daquele calabouço, então acrescentar peças
  // sem refazer a conta deixaria os itens antigos com peso defasado (raros
  // raros demais, "nada" barato demais) e o saque sairia do modelo.
  //
  // Refazer a conta é seguro porque o modelo é auto-normalizante: as fatias por
  // raridade (comum : raro : épico : lendário : nada) são razões fixas do peso
  // total dos comuns, então o acervo pode crescer que a chance POR SORTEIO de
  // cada raridade não muda. O que muda é só de quantos itens diferentes aquela
  // fatia é dividida — ou seja, item bom continua igualmente difícil, mas há
  // mais coisa diferente para achar.
  //
  // Nenhum objeto é reatribuído: só `element`/`setId` (das peças de conjunto),
  // `keyPiece`, `minRoom` e `dropWeight` de cada item são reescritos, e eles já
  // eram derivados. Peça AVULSA nunca tem o `element` tocado — ela declarou o
  // dela na criação e `setId` continua null.
  // =========================================================================
  (function rebindSetsAndLoot() {
    var LW = DATA.lootWeights;
    if (!LW || !LW.comum) { return; }           // items.js não carregou: não invente
    var RANK = { comum: 0, raro: 1, epico: 2, lendario: 3 };

    // 1. conjunto → elemento e setId de cada peça; raridade do conjunto = a maior
    Object.keys(DATA.sets).forEach(function (sid) {
      var set = DATA.sets[sid], top = 'comum';
      if (!set || !set.pieces) { return; }
      set.pieces.forEach(function (iid) {
        var it = I[iid];
        if (!it) { return; }                    // acusado por tests/validate_fusion.html
        it.setId = sid;
        it.element = set.element;
        if (RANK[it.rarity] > RANK[top]) { top = it.rarity; }
      });
      set.rarity = top;
    });

    // 2. peça-CHAVE (+1 PA, +1 PP ou Lume: muda COMO se joga) e sala mínima
    Object.keys(I).forEach(function (id) {
      var it = I[id];
      it.keyPiece = !!(it.bonuses.pa || it.bonuses.pp || it.slot === 'lume');
      it.minRoom = (it.rarity === 'epico' || it.rarity === 'lendario') ? 2
                 : (it.rarity === 'raro' ? 1 : 0);
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
        list.forEach(function (it) { if (it.rarity === r) { u += (it.keyPiece ? LW.keyFactor : 1); } });
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
  })();

})();
