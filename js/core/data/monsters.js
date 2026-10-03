var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// SOTERRA 2.0 — Bestiário dos 6 calabouços
// Dono: Criativo Mundo. Globais: DATA.monsters e DATA.monsterSpells.
//
// >>> ATENÇÃO, LÓGICA/ENGINE: os feitiços dos MONSTROS moram em
// >>> `DATA.monsterSpells`, NÃO em `DATA.spells` (que pertence ao Criativo
// >>> Classes, em js/core/data/spells.js). O formato é EXATAMENTE o mesmo do
// >>> contrato §3. A engine deve fazer o merge na leitura, ex.:
// >>>     function spellById(id) {
// >>>       return (DATA.spells && DATA.spells[id]) || (DATA.monsterSpells && DATA.monsterSpells[id]);
// >>>     }
// >>> Nenhum id colide: todo feitiço de monstro começa com 'm-'.
//
// Esquema de monstro (v2 = v1 + element/dodge/lock; passos agora são `pp`):
//   { id, name, family, element, dungeonId, description, flavor,
//     stats: { hp, pa, pp, initiative, power, dodge, lock,
//              resists: { fogo, agua, terra, ar, neutro } },
//     spells: ['m-...'], ai: 'melee'|'ranged'|'support'|'boss',
//     traits: [...], boss: bool, summonOnly: bool, xp,
//     stoneDrop: { chance, min, max } | null }
// dodge/lock vivem DENTRO de `stats` (igual às classes, contrato §3).
// `element` fica no topo porque é o que o tique de clima consulta (contrato §2).
//
// Traços permitidos (vocabulário FECHADO, contrato §3 / v1):
//   explodeOnDeath{element,damage,radius} · split{monsterId,count} ·
//   enrage{hpPct,power} · pushImmune{} · regenAura{value,radius}
//
// >>> PEDRAS DE FORJA (adendo v2.1). Todo monstro que NÃO é invocação derruba
// >>> pedras do PRÓPRIO elemento: o id da pedra sai de `monster.element` cruzado
// >>> com `DATA.stones` (dono: Criativo Fusão). `summonOnly` derruba nada
// >>> (`stoneDrop: null`) — senão o Invocador viraria uma fábrica de pedras.
// >>> A calibragem mora na tabela STONE_* logo abaixo do `mon()`, nunca colada
// >>> monstro a monstro, para nenhuma linha divergir das outras.
//
// >>> PROFUNDIDADE (adendo v2.3). Os `hp` e `xp` escritos em cada monstro são
// >>> RELATIVOS ao calabouço dele; a tabela TIER (logo abaixo) aplica a escala
// >>> absoluta de vida, poder e XP por profundidade. Ler `DATA.monsters[id]`
// >>> devolve sempre o valor JÁ escalado — ninguém precisa saber da tabela.
// ============================================================================

JOGO.DATA = JOGO.DATA || {};
(function (DATA) {
  'use strict';

  DATA.monsterSpells = DATA.monsterSpells || {};
  DATA.monsters = DATA.monsters || {};

  // --- fábricas: preenchem os campos obrigatórios do contrato com padrões ----
  function sp(o, id) {
    var r = o.range || [1, 1];
    return {
      id: id,
      name: o.name,
      element: o.element,
      classId: null,
      unlockLevel: 0,
      paCost: o.paCost,
      cooldown: o.cooldown || 0,
      castsPerTurn: (o.castsPerTurn === undefined) ? 1 : o.castsPerTurn,
      range: { min: r[0], max: r[1], line: !!o.line, los: (o.los === false ? false : true), movable: false },
      aoe: { shape: o.shape || 'single', size: o.size || 0 },
      needsEmptyTile: !!o.needsEmptyTile,
      targetSide: o.targetSide || 'enemy',
      effects: o.effects,
      description: o.description,
      flavor: o.flavor || '',
      fxKey: o.fxKey || 'slam'
    };
  }
  function addSpells(map) {
    for (var id in map) { if (map.hasOwnProperty(id)) { DATA.monsterSpells[id] = sp(map[id], id); } }
  }

  // ==========================================================================
  // PROFUNDIDADE (adendo v2.3) — o andar do mundo define dureza, ameaça e XP.
  //
  // Os campos `hp` e `xp` escritos monstro a monstro lá embaixo são o desenho
  // RELATIVO dentro do próprio calabouço (quem é o tanque, quem é o bicho de
  // XP). A escala ABSOLUTA por profundidade mora nesta tabela e só aqui — é o
  // único lugar a mexer quando o balanceamento pedir mais ou menos dificuldade.
  //
  //   hp     multiplica a vida dos COMUNS. Chefe não entra: a vida dele é
  //          fixada à mão (300→600) e o contrato §10 limita o teto em 600.
  //          Referência: o herói ganha +3 de dano elemental por nível, ou seja
  //          ~+75% de dano do nível 3 ao 28 — a vida dos comuns acompanha.
  //   power  soma de poder de TODOS os bichos do andar (fórmula de dano do
  //          contrato §3: (100+power)/100). É por aqui que a ameaça cresce sem
  //          alongar a luta: bicho fundo machuca mais, não demora mais.
  //          Referência: o herói ganha +5 PV por nível (~+110% do 3 ao 28).
  //   xp     escala a recompensa. Calibrada contra DATA.leveling.xpTable para
  //          que UMA descida completa, no `recommendedLevel` do calabouço,
  //          renda ~1 nível no começo e ~1/3 de nível do nível 25 em diante.
  //          Fração de nível alvo por descida, do 1º ao 6º calabouço:
  //          1,00 · 0,75 · 0,55 · 0,45 · 0,38 · 0,34 — cai sempre, porque a
  //          exigência da xpTable sobe mais rápido que a recompensa. Em XP
  //          absoluta isso dá ~65 · 200 · 420 · 750 · 1200 · 1850, ou seja
  //          cerca de 1,6× a 3× a cada andar e ~28× do primeiro ao último.
  //          Antes do adendo, a Estufa rendia 785 XP com degrau de 65 no
  //          nível 3 — DOZE níveis numa descida. Era esse o buraco.
  //
  // >>> ATENÇÃO: a escala de XP depende de DATA.leveling.xpTable (dono:
  // >>> Criativo Classes). tests/validate_world.html confere a razão viva
  // >>> entre as duas e ACUSA se a tabela de níveis mudar sem esta tabela.
  // >>> O crescimento da XP tem teto: se a fração de nível precisa CAIR com a
  // >>> profundidade, a XP só pode crescer até a razão entre os degraus dos
  // >>> níveis recomendados (hoje 65 → 5450, ou 84×). A calibragem usa ~75% a
  // >>> 90% desse teto — o resto fica para o `xpFalloff` do adendo, que é
  // >>> quem realmente pune moer conteúdo raso (×0,10 no piso).
  // ==========================================================================
  // >>> TAMANHO DO GRUPO (game.js): `xpGanho = floor(xpTotal / partySize)`.
  // >>> Quem joga SOLO leva a descida inteira; a dupla parte ao meio. Logo a
  // >>> calibragem é feita no caso SOLO, que é o teto — se o solo cabe na
  // >>> faixa, a dupla cabe por construção (metade). Calibrar pela dupla foi
  // >>> o erro que deixou o solo render 1,89 nível na Estufa.
  //
  // NOTA: a coluna `xp` já foi reapertada duas vezes — uma quando as salas
  // cresceram (mais spawns por descida) e outra quando o Criativo Classes
  // recalibrou a `xpTable` e os degraus caíram quase à metade. O total por
  // descida é o que manda: nem o número de bichos, nem o tamanho do mapa.
  var TIER = {
    greenhouse:   { hp: 1.00, power:   0, xp: 0.0427 },
    cistern:      { hp: 1.00, power:  12, xp: 0.0906 },
    emberlock:    { hp: 1.15, power:  28, xp: 0.1525 },
    windscaffold: { hp: 1.55, power:  48, xp: 0.2553 },
    quakemine:    { hp: 1.80, power:  75, xp: 0.3354 },
    brokenheart:  { hp: 2.00, power: 105, xp: 0.4160 }
  };
  var NO_TIER = { hp: 1, power: 0, xp: 1 };   // invocações do jogador: intocadas
  function tierOf(o) { return TIER[o.dungeonId] || NO_TIER; }

  // --- PEDRAS: quanto cada andar do mundo enterrado rende -------------------
  // Referência de economia (contrato §9-B): levar UM item até +10 custa 107
  // pedras do elemento dele (soma de DATA.upgrade.stoneCost). Uma descida
  // completa rende, por elemento, algo entre ~12 (Estufa) e ~15 (Coração) —
  // ou seja, um +10 é objetivo de 7 a 9 descidas, e as fundas pagam melhor.
  var STONE_COMMON = {
    greenhouse:   { chance: 0.30, min: 1, max: 2 },
    cistern:      { chance: 0.35, min: 1, max: 2 },
    emberlock:    { chance: 0.40, min: 1, max: 3 },
    windscaffold: { chance: 0.45, min: 1, max: 3 },
    quakemine:    { chance: 0.50, min: 2, max: 4 },
    brokenheart:  { chance: 0.55, min: 2, max: 5 }
  };
  // Chefe: cai SEMPRE e cai grosso — é o motivo de refazer o calabouço.
  var STONE_BOSS = {
    greenhouse:   { chance: 1, min: 6, max: 10 },
    cistern:      { chance: 1, min: 8, max: 13 },
    emberlock:    { chance: 1, min: 10, max: 16 },
    windscaffold: { chance: 1, min: 12, max: 19 },
    quakemine:    { chance: 1, min: 15, max: 24 },
    brokenheart:  { chance: 1, min: 20, max: 32 }
  };

  function stoneDropFor(o) {
    if (o.summonOnly) { return null; }          // invocação não vira minério
    var table = o.boss ? STONE_BOSS : STONE_COMMON;
    var t = table[o.dungeonId] || STONE_COMMON.greenhouse;
    var chance = t.chance, min = t.min, max = t.max;
    // bicho graúdo (≥ 90 PV) dá trabalho e paga por isso
    if (!o.boss && o.hp >= 90) { chance = Math.round((chance + 0.05) * 100) / 100; max += 1; }
    if (o.stone) { chance = o.stone[0]; min = o.stone[1]; max = o.stone[2]; }
    if (chance > 1) { chance = 1; }
    return { chance: chance, min: min, max: max };
  }

  function mon(o, id) {
    var res = { fogo: 0, agua: 0, terra: 0, ar: 0, neutro: 0 };
    if (o.resists) { for (var k in o.resists) { if (res.hasOwnProperty(k)) { res[k] = o.resists[k]; } } }
    return {
      id: id,
      name: o.name,
      family: o.family,
      element: o.element,
      dungeonId: (o.dungeonId === undefined) ? null : o.dungeonId,
      description: o.description,
      flavor: o.flavor || '',
      stats: {
        // chefe mantém a vida escrita à mão (teto de 600 do contrato); o comum
        // engorda conforme a profundidade. Poder sobe para todos do andar.
        hp: o.boss ? o.hp : Math.round(o.hp * tierOf(o).hp),
        pa: o.pa, pp: o.pp, initiative: o.initiative, power: tierOf(o).power,
        dodge: o.dodge, lock: o.lock, resists: res
      },
      spells: o.spells,
      ai: o.ai,
      traits: o.traits || [],
      boss: !!o.boss,
      summonOnly: !!o.summonOnly,
      // UMA CASA DECIMAL, de propósito. Com a xpTable atual o nível 3 custa 35
      // XP e a Estufa inteira vale isso — arredondando para inteiro, TODO
      // bicho do calabouço 1 viraria "1 XP" e o peso relativo entre eles
      // (a mãe-carrapicho vale mais que o puff de pólen) sumiria. `game.js`
      // soma os `xp` da sala e só então faz `floor(total / partySize)`, então
      // fração aqui é segura e nunca chega fracionada ao jogador.
      xp: Math.round(o.xp * tierOf(o).xp * 10) / 10,
      stoneDrop: stoneDropFor(o)
    };
  }
  function addMonsters(map) {
    for (var id in map) { if (map.hasOwnProperty(id)) { DATA.monsters[id] = mon(map[id], id); } }
  }

  // ==========================================================================
  // 1) A ESTUFA SOTERRADA — Flora Voraz / Enxame da Estufa
  //    Terra manda; a Água (seiva, orvalho) prospera na chuva; o Ar zune.
  // ==========================================================================
  addSpells({
    'm-thorn-shot': {
      name: 'Farpa', element: 'terra', paCost: 3, castsPerTurn: 2, range: [2, 6],
      effects: [{ type: 'damage', element: 'terra', min: 12, max: 16 }],
      description: 'A vergasta chicoteia o ar e dispara um espinho farpado que assobia até acertar.',
      flavor: 'Ela não corre atrás de ninguém. Ninguém precisa.', fxKey: 'bolt'
    },
    'm-root-grip': {
      name: 'Raiz-Trava', element: 'terra', paCost: 3, cooldown: 2, range: [1, 4],
      effects: [{ type: 'root', duration: 1 }, { type: 'damage', element: 'terra', min: 6, max: 9 }],
      description: 'Raízes irrompem do piso e agarram os tornozelos do alvo: preso por 1 turno.',
      flavor: 'A estufa acha que você é adubo em movimento.', fxKey: 'debuff'
    },
    'm-pollen-bite': {
      name: 'Mordiscada', element: 'terra', paCost: 3,
      effects: [{ type: 'damage', element: 'terra', min: 8, max: 12 }],
      description: 'Uma mordida fofa de dentinhos de pólen. O perigo de verdade vem depois.',
      flavor: 'Ele sorri o tempo todo. Costurado, mas sorri.'
    },
    'm-burr-hug': {
      name: 'Abraço Farpado', element: 'terra', paCost: 3,
      effects: [{ type: 'damage', element: 'terra', min: 10, max: 14 }],
      description: 'O carrapicho se atira no alvo e gruda, farpas para dentro.',
      flavor: 'Carinho de novelo: dói e não sai.'
    },
    'm-wasp-sting': {
      name: 'Ferrão Lustroso', element: 'ar', paCost: 3,
      effects: [
        { type: 'damage', element: 'ar', min: 9, max: 13 },
        { type: 'poison', element: 'ar', min: 4, max: 6, duration: 2 }
      ],
      description: 'O ferrão da vespa injeta um veneno luminoso que arde por 2 turnos.',
      flavor: 'A luz do abdômen é o último aviso amigável do jardim.', fxKey: 'bolt'
    },
    'm-sap-mend': {
      // idem 'm-jelly-mend': duas curas por turno sustentavam a estufa inteira.
      name: 'Seiva Doce', element: 'agua', paCost: 3, cooldown: 1, range: [0, 4], targetSide: 'ally',
      effects: [{ type: 'heal', min: 12, max: 16 }],
      description: 'O seiveiro verte seiva dourada sobre as feridas de um aliado.',
      flavor: 'Rega tudo com o mesmo carinho. Inclusive o que devia morrer.', fxKey: 'heal'
    },
    'm-sap-sugar': {
      name: 'Açúcar Bruto', element: 'agua', paCost: 2, cooldown: 2, range: [0, 4], targetSide: 'ally',
      effects: [{ type: 'buff', stat: 'power', value: 15, duration: 2 }],
      description: 'Uma dose de açúcar cru deixa o aliado frenético: +15 de poder por 2 turnos.',
      flavor: 'Nenhuma planta desta sala sabe o que é moderação.', fxKey: 'buff'
    },
    'm-dew-web': {
      name: 'Teia de Orvalho', element: 'agua', paCost: 3, cooldown: 1, range: [2, 5],
      effects: [{ type: 'root', duration: 1 }, { type: 'damage', element: 'agua', min: 5, max: 8 }],
      description: 'Fios pesados de orvalho se fecham sobre os pés do alvo e endurecem: preso por 1 turno.',
      flavor: 'Cada gota da teia é uma lupa. Ela gosta de ver de perto.', fxKey: 'debuff'
    },
    'm-dew-bite': {
      name: 'Picada de Orvalho', element: 'agua', paCost: 3,
      effects: [
        { type: 'damage', element: 'agua', min: 10, max: 14 },
        { type: 'poison', element: 'agua', min: 3, max: 5, duration: 2 }
      ],
      description: 'As quelíceras injetam uma gota de água velha e parada, que apodrece por dentro.',
      flavor: 'Água de estufa: nunca ferveu, nunca secou, nunca perdoou.'
    },
    'm-shears': {
      name: 'Tesourada', element: 'terra', paCost: 4, range: [1, 2],
      effects: [{ type: 'damage', element: 'terra', min: 24, max: 30 }],
      description: 'A tesoura de poda da Jardineira fecha com um estalo úmido.',
      flavor: 'Ela não mata. Ela apara.'
    },
    'm-vine-hook': {
      name: 'Cipó-Fisga', element: 'terra', paCost: 3, cooldown: 1, range: [2, 6],
      effects: [{ type: 'pull', tiles: 3 }, { type: 'damage', element: 'terra', min: 8, max: 12 }],
      description: 'Um cipó farpado fisga o alvo e o arrasta 3 células até a tesoura.',
      flavor: 'Erva daninha não decide onde é arrancada.', fxKey: 'hook'
    },
    'm-seed-toss': {
      name: 'Semeadura', element: 'terra', paCost: 3, cooldown: 2, range: [1, 4],
      needsEmptyTile: true, targetSide: 'any',
      effects: [{ type: 'summon', monsterId: 'sprout-feral' }],
      description: 'A Jardineira planta uma semente que germina na hora, faminta.',
      flavor: 'O jardim dela nunca teve estação morta.', fxKey: 'summonFx'
    },
    'm-thorn-crown': {
      name: 'Coroa de Espinhos', element: 'terra', paCost: 4, cooldown: 2, range: [0, 0], los: false,
      shape: 'ring', size: 2, targetSide: 'any',
      effects: [{ type: 'damage', element: 'terra', min: 14, max: 18 }, { type: 'root', duration: 1 }],
      description: 'Um anel de espinhos brota a 2 células da Jardineira e se fecha: dano e prisão em quem estava na volta — mas não em quem está colado nela.',
      flavor: 'Perto demais para a coroa. É o único lugar seguro do coreto.', fxKey: 'nova'
    },
    'm-sprout-bite': {
      name: 'Dentinhos', element: 'terra', paCost: 3,
      effects: [{ type: 'damage', element: 'terra', min: 7, max: 10 }],
      description: 'O brotinho morde com todas as suas fileiras de dentes de semente.',
      flavor: 'Nasceu há dez segundos e já tem inimigos.'
    },
    'm-burr-nip': {
      name: 'Farpinha', element: 'terra', paCost: 3,
      effects: [{ type: 'damage', element: 'terra', min: 5, max: 8 }],
      description: 'Pequeno, grudento e irritante.',
      flavor: 'Metade do rancor, o dobro da velocidade.'
    },
    'm-spore-nip': {
      name: 'Mordidinha Pútrida', element: 'terra', paCost: 3,
      effects: [
        { type: 'damage', element: 'terra', min: 6, max: 9 },
        { type: 'poison', element: 'terra', min: 3, max: 5, duration: 1 }
      ],
      description: 'O esporinho morde e deixa bolor na ferida.',
      flavor: 'Olhos grandes demais, lealdade maior ainda.'
    }
  });

  addMonsters({
    'thorn-lasher': {
      name: 'Vergasta', family: 'Flora Voraz', element: 'terra', dungeonId: 'greenhouse',
      description: 'Um chicote vegetal enraizado num vaso rachado, coberto de farpas e flores mortas. Não sai do lugar — não precisa.',
      flavor: 'Torreta com pétalas.',
      hp: 50, pa: 6, pp: 1, initiative: 35, dodge: 4, lock: 26,
      resists: { fogo: -20, agua: 20, ar: -15 },
      spells: ['m-thorn-shot', 'm-root-grip'], ai: 'ranged',
      traits: [{ type: 'pushImmune' }], xp: 25
    },
    'pollen-puff': {
      name: 'Bufo-de-Pólen', family: 'Flora Voraz', element: 'terra', dungeonId: 'greenhouse',
      description: 'Uma bola de pólen amarelo com perninhas de graveto e um sorriso costurado. Anda na sua direção balançando. Isso deveria ser um aviso.',
      flavor: 'Mate-o longe. Por favor, mate-o longe.',
      hp: 45, pa: 3, pp: 3, initiative: 55, dodge: 8, lock: 8,
      resists: { fogo: -30, agua: 10, ar: -15 },
      spells: ['m-pollen-bite'], ai: 'melee',
      traits: [{ type: 'explodeOnDeath', element: 'terra', damage: 18, radius: 1 }], xp: 22
    },
    'burr-mother': {
      name: 'Carrapicho-Mãe', family: 'Flora Voraz', element: 'terra', dungeonId: 'greenhouse',
      description: 'Um novelo de farpas do tamanho de um cão, com dezenas de olhinhos pretos entre os espinhos. Ao morrer, desfia-se em dois novelos menores e igualmente rancorosos.',
      flavor: 'Um corpo, três problemas de posicionamento.',
      hp: 60, pa: 3, pp: 3, initiative: 25, dodge: 6, lock: 16,
      resists: { fogo: -15, agua: 15, ar: -15 },
      spells: ['m-burr-hug'], ai: 'melee',
      traits: [{ type: 'split', monsterId: 'burrlet', count: 2 }], xp: 30
    },
    'lantern-wasp': {
      name: 'Vespa-Lustre', family: 'Enxame da Estufa', element: 'ar', dungeonId: 'greenhouse',
      description: 'Uma vespa do tamanho de um gato cujo abdômen é uma lanterna de vidro com uma luz presa dentro. Rápida, brilhante, venenosa: chega primeiro e vai embora antes da resposta.',
      flavor: 'A luz que ela carrega já foi de alguém.',
      hp: 48, pa: 3, pp: 4, initiative: 75, dodge: 30, lock: 6,
      resists: { fogo: -10, terra: 20 },
      spells: ['m-wasp-sting'], ai: 'melee', traits: [], xp: 24
    },
    'sap-shaman': {
      name: 'Seiveiro', family: 'Flora Voraz', element: 'agua', dungeonId: 'greenhouse',
      description: 'Um toco de árvore corcunda com um rosto entalhado a canivete e um caldeirão de seiva borbulhando no colo. Rega os aliados como quem cuida de um jardim — e o jardim morde.',
      flavor: 'Na chuva ele canta. Mate-o antes do refrão.',
      hp: 55, pa: 6, pp: 2, initiative: 45, dodge: 8, lock: 12,
      resists: { fogo: 15, terra: -20 },
      spells: ['m-sap-mend', 'm-sap-sugar'], ai: 'support',
      traits: [{ type: 'regenAura', value: 8, radius: 2 }], xp: 28
    },
    'dew-strider': {
      name: 'Aranha-de-Orvalho', family: 'Enxame da Estufa', element: 'agua', dungeonId: 'greenhouse',
      description: 'Uma aranha de pernas finíssimas que anda sobre a água acumulada nas folhas sem afundar um milímetro. Tece com orvalho: as teias brilham, pesam e endurecem.',
      flavor: 'Ela pesa menos que a gota em que pisa.',
      hp: 52, pa: 5, pp: 4, initiative: 65, dodge: 26, lock: 14,
      resists: { fogo: 20, terra: -10, ar: -10 },
      spells: ['m-dew-web', 'm-dew-bite'], ai: 'ranged', traits: [], xp: 26
    },
    'sprout-feral': {
      name: 'Brotinho-Voraz', family: 'Flora Voraz', element: 'terra', dungeonId: 'greenhouse',
      description: 'Uma muda recém-germinada que é só folhas, pressa e dentes. A Jardineira os planta; eles fazem o resto.',
      flavor: 'Cresce rápido porque não pretende durar.',
      hp: 30, pa: 3, pp: 4, initiative: 60, dodge: 14, lock: 6,
      resists: { fogo: -20, agua: 10, ar: -15 },
      spells: ['m-sprout-bite'], ai: 'melee', traits: [], summonOnly: true, xp: 5
    },
    'burrlet': {
      name: 'Carrapichinho', family: 'Flora Voraz', element: 'terra', dungeonId: 'greenhouse',
      description: 'Metade do rancor, o dobro da velocidade. Gruda e não solta.',
      flavor: 'Você vai encontrar um deles no bolso semanas depois.',
      hp: 22, pa: 3, pp: 3, initiative: 30, dodge: 12, lock: 10,
      resists: { fogo: -15, agua: 10, ar: -15 },
      spells: ['m-burr-nip'], ai: 'melee', traits: [], summonOnly: true, xp: 4
    },
    'boss-gardener': {
      name: 'A Jardineira-Viúva', family: 'Flora Voraz', element: 'terra', dungeonId: 'greenhouse',
      description: 'A guardiã da Estufa: um vulto de três metros feito de treliça, luvas de couro e véu de viúva, com uma tesoura de poda enferrujada no lugar das mãos. Ainda cuida do jardim. Você é a erva daninha.',
      flavor: 'GIMMICK — A PODA: o cipó puxa você para dentro do coreto, a tesoura apara, a semeadura repõe o mato. A Coroa de Espinhos castiga o anel a 2 células: o lugar mais seguro do mundo é colado nela.',
      hp: 300, pa: 7, pp: 3, initiative: 50, dodge: 10, lock: 42,
      resists: { fogo: -20, agua: 30, ar: -15, neutro: 10 },
      spells: ['m-shears', 'm-vine-hook', 'm-seed-toss', 'm-thorn-crown'], ai: 'boss',
      traits: [{ type: 'pushImmune' }, { type: 'enrage', hpPct: 0.4, power: 30 }],
      boss: true, xp: 450
    }
  });

  // ==========================================================================
  // 2) A CISTERNA DOS AFOGADOS — Corte Afogada
  //    Água em maioria; um caranguejo de Terra e uma cantarola de Ar quebram
  //    a monotonia elemental (e sofrem/aproveitam climas diferentes).
  // ==========================================================================
  addSpells({
    'm-drowned-bite': {
      name: 'Bocanhada', element: 'agua', paCost: 3, castsPerTurn: 2,
      effects: [{ type: 'damage', element: 'agua', min: 12, max: 16, lifesteal: true }],
      description: 'O afogadiço morde e bebe: rouba a vida que lhe falta.',
      flavor: 'Ele não tem fome. Tem frio.'
    },
    'm-eel-beam': {
      name: 'Nota Grave', element: 'agua', paCost: 3, castsPerTurn: 2, range: [2, 6], line: true,
      effects: [{ type: 'damage', element: 'agua', min: 11, max: 15 }],
      description: 'A moreia sopra uma nota pela flauta do próprio crânio: um jato d\'água em linha reta.',
      flavor: 'Saia da linha. Ela recoloca você nela.', fxKey: 'beam'
    },
    'm-eel-hook': {
      name: 'Língua-Fisga', element: 'agua', paCost: 2, cooldown: 1, range: [2, 5], line: true,
      effects: [{ type: 'pull', tiles: 2 }, { type: 'damage', element: 'agua', min: 5, max: 8 }],
      description: 'Uma língua-arpão dispara em linha reta e arrasta a presa para perto da água.',
      flavor: 'Convite formal da corte afogada.', fxKey: 'hook'
    },
    'm-jelly-mend': {
      // cooldown 2: com as salas ampliadas cabem mais monstros por sala, e um
      // curandeiro que cura TODO turno passou a sustentar o grupo inteiro além
      // do que uma dupla de nível 1 consegue furar — a luta empatava para
      // sempre. A água-viva continua sendo o alvo a focar, só não é eterna.
      name: 'Pulso Salino', element: 'agua', paCost: 3, cooldown: 2, range: [0, 4], targetSide: 'ally',
      effects: [{ type: 'heal', min: 14, max: 18 }],
      description: 'A água-viva pulsa e banha um aliado em salmoura restauradora.',
      flavor: 'Apague o lustre antes de discutir com os convidados.', fxKey: 'heal'
    },
    'm-jelly-ward': {
      name: 'Membrana', element: 'agua', paCost: 2, cooldown: 1, range: [0, 4], targetSide: 'ally',
      effects: [{ type: 'shield', value: 15, duration: 2 }],
      description: 'Uma película gelatinosa envolve o aliado, absorvendo golpes.',
      flavor: 'Translúcida, morna, profundamente desagradável.', fxKey: 'shieldFx'
    },
    'm-brine-fist': {
      name: 'Punho de Salmoura', element: 'agua', paCost: 4,
      effects: [{ type: 'damage', element: 'agua', min: 16, max: 22 }],
      description: 'Um punho de sal compactado desce como um aríete.',
      flavor: 'Maré baixa para andar, maré alta para bater.'
    },
    'm-drop-slam': {
      name: 'Chuaque', element: 'agua', paCost: 3,
      effects: [{ type: 'damage', element: 'agua', min: 11, max: 15 }],
      description: 'A gota se joga inteira em cima do alvo. É exatamente o som que você imagina.',
      flavor: 'Chuaque.'
    },
    'm-droplet-splash': {
      name: 'Pingo', element: 'agua', paCost: 3,
      effects: [{ type: 'damage', element: 'agua', min: 5, max: 8 }],
      description: 'A gotinha se atira contra a canela do alvo com toda a indignação de que dispõe. Plic.',
      flavor: 'Pequena, redonda, indignada.'
    },
    'm-crab-pinch': {
      name: 'Pinça de Sumidouro', element: 'terra', paCost: 3,
      effects: [{ type: 'damage', element: 'terra', min: 14, max: 18 }, { type: 'push', tiles: 1 }],
      description: 'A pinça fecha com um estalo de pedra e devolve o alvo uma célula para trás.',
      flavor: 'Ele mora no ralo. O ralo é dele.'
    },
    'm-crab-guard': {
      name: 'Casco Fechado', element: 'terra', paCost: 2, cooldown: 2, range: [0, 0], los: false, targetSide: 'self',
      effects: [
        { type: 'shield', value: 25, duration: 2 },
        { type: 'resist', element: 'agua', value: 20, duration: 2 }
      ],
      description: 'O caranguejo se fecha inteiro: 25 de escudo e +20% de resistência a água por 2 turnos.',
      flavor: 'Mil anos debaixo d\'água ensinam a fechar a porta.', fxKey: 'shieldFx'
    },
    'm-mist-song': {
      name: 'Cantiga de Névoa', element: 'ar', paCost: 2, cooldown: 1, range: [0, 4], targetSide: 'ally',
      effects: [{ type: 'buff', stat: 'dodge', value: 12, duration: 2 }],
      description: 'Um assobio fino e desafinado deixa o aliado escorregadio: +12 de esquiva por 2 turnos.',
      flavor: 'A nota certa é a que ninguém consegue segurar.', fxKey: 'buff'
    },
    'm-mist-shove': {
      name: 'Sopro de Névoa', element: 'ar', paCost: 3, castsPerTurn: 2, range: [2, 5],
      effects: [{ type: 'damage', element: 'ar', min: 8, max: 11 }, { type: 'push', tiles: 2 }],
      description: 'Uma lufada úmida empurra o alvo 2 células — de preferência para dentro do canal.',
      flavor: 'A cisterna tem muitos buracos e nenhuma paciência.', fxKey: 'gust'
    },
    'm-tide-pull': {
      name: 'Maré Faminta', element: 'agua', paCost: 3, cooldown: 2, range: [0, 0], los: false,
      shape: 'circle', size: 3, targetSide: 'any',
      effects: [{ type: 'pull', tiles: 3 }],
      description: 'A Baronesa inspira — e a sala inteira vira maré: tudo num raio de 3 células é arrastado até ela.',
      flavor: 'Ela recebe. Ninguém recusa convite de anfitriã.', fxKey: 'nova'
    },
    'm-bitter-gulp': {
      name: 'Gole Amargo', element: 'agua', paCost: 4, cooldown: 1, range: [0, 0], los: false,
      shape: 'cross', size: 2, targetSide: 'any',
      effects: [
        { type: 'damage', element: 'agua', min: 20, max: 26 },
        { type: 'poison', element: 'agua', min: 6, max: 9, duration: 2 }
      ],
      description: 'A Baronesa engole tudo ao redor num só trago de salmoura ácida, que continua corroendo por 2 turnos.',
      flavor: 'Puxa num turno, bebe no outro. Saia entre um e outro.', fxKey: 'nova'
    },
    'm-salt-lance': {
      name: 'Lança de Sal', element: 'agua', paCost: 3, range: [1, 5],
      effects: [{ type: 'damage', element: 'agua', min: 16, max: 22 }],
      description: 'Um cristal de sal afiado cruza a sala girando.',
      flavor: 'Talheres da corte.', fxKey: 'bolt'
    },
    'm-brine-spawn': {
      name: 'Verter', element: 'agua', paCost: 2, cooldown: 1, range: [1, 3],
      needsEmptyTile: true, targetSide: 'any',
      effects: [{ type: 'summon', monsterId: 'droplet' }],
      description: 'A Baronesa transborda, e o que escorre ganha vontade própria.',
      flavor: 'Todo baile tem convidados que ninguém chamou.', fxKey: 'summonFx'
    }
  });

  addMonsters({
    'drowned-porter': {
      name: 'Afogadiço', family: 'Corte Afogada', element: 'agua', dungeonId: 'cistern',
      description: 'Um carregador da cisterna que nunca soltou seu lampião. Pele cinza-esverdeada, inchada de água, algas no lugar do cabelo. Morde para beber o calor que perdeu.',
      flavor: 'Duelar com ele é alimentá-lo.',
      hp: 75, pa: 6, pp: 3, initiative: 40, dodge: 10, lock: 20,
      resists: { fogo: 25, terra: -15, neutro: 5 },
      spells: ['m-drowned-bite'], ai: 'melee', traits: [], xp: 38
    },
    'moray-piper': {
      name: 'Moreia-Flauta', family: 'Corte Afogada', element: 'agua', dungeonId: 'cistern',
      description: 'Uma enguia de dois metros cujo crânio perfurado assobia quando ela respira. Ergue-se da água como um ponto de interrogação, cospe jatos em linha reta e fisga presas com a língua-arpão.',
      flavor: 'Toca uma nota só, e é sobre você.',
      hp: 65, pa: 5, pp: 3, initiative: 60, dodge: 18, lock: 12,
      resists: { fogo: 20, terra: -15, ar: -15 },
      spells: ['m-eel-beam', 'm-eel-hook'], ai: 'ranged', traits: [], xp: 33
    },
    'lantern-jelly': {
      name: 'Água-Viva-Lustre', family: 'Corte Afogada', element: 'agua', dungeonId: 'cistern',
      description: 'Uma água-viva do tamanho de um lustre, flutuando a um palmo do chão, tentáculos como franjas de cristal. Sua luz cura os afogados — apague-a primeiro.',
      flavor: 'Transforma afogadiços em esponjas.',
      hp: 60, pa: 5, pp: 2, initiative: 30, dodge: 14, lock: 6,
      resists: { fogo: 25, terra: -15 },
      spells: ['m-jelly-mend', 'm-jelly-ward'], ai: 'support',
      traits: [{ type: 'regenAura', value: 8, radius: 2 }], xp: 30
    },
    'brine-golem': {
      name: 'Salmourão', family: 'Corte Afogada', element: 'agua', dungeonId: 'cistern',
      description: 'Um colosso de sal cristalizado em camadas, com um coração de água escura visível no peito. Lento como maré baixa, imparável como maré alta. Quanto mais quebra, mais afiado fica.',
      flavor: 'Ignorá-lo é um cronômetro.',
      hp: 105, pa: 4, pp: 2, initiative: 15, dodge: 2, lock: 34,
      resists: { fogo: 30, terra: -15 },
      spells: ['m-brine-fist'], ai: 'melee',
      traits: [{ type: 'pushImmune' }, { type: 'enrage', hpPct: 0.5, power: 25 }], xp: 55
    },
    'fat-drop': {
      name: 'Gota-Gorda', family: 'Corte Afogada', element: 'agua', dungeonId: 'cistern',
      description: 'Uma gota d\'água do tamanho de um barril, com um rosto sonolento boiando dentro. Estoure-a e ela vira duas gotas menores e bem mais acordadas.',
      flavor: 'Cada gota nova entope um vão a mais.',
      hp: 70, pa: 3, pp: 3, initiative: 35, dodge: 10, lock: 14,
      resists: { fogo: 30, terra: -10 },
      spells: ['m-drop-slam'], ai: 'melee',
      traits: [{ type: 'split', monsterId: 'droplet', count: 2 }], xp: 35
    },
    'droplet': {
      name: 'Gotinha', family: 'Corte Afogada', element: 'agua', dungeonId: 'cistern',
      description: 'Pequena, redonda, indignada.',
      flavor: 'Tem opiniões fortes sobre o seu tornozelo.',
      hp: 25, pa: 3, pp: 3, initiative: 45, dodge: 14, lock: 8,
      resists: { fogo: 20, terra: -10 },
      spells: ['m-droplet-splash'], ai: 'melee', traits: [], summonOnly: true, xp: 5
    },
    'sump-crab': {
      name: 'Caranguejo de Sumidouro', family: 'Corte Afogada', element: 'terra', dungeonId: 'cistern',
      description: 'Um caranguejo do tamanho de uma mesa, com carapaça de pedra encrostada de sal e uma pinça desproporcional que ele arrasta pelo chão. Vive no ralo por onde a cisterna esvazia — e considera aquilo propriedade privada.',
      flavor: 'Impossível de empurrar. Ele já escolheu o lugar dele.',
      hp: 85, pa: 5, pp: 2, initiative: 20, dodge: 4, lock: 32,
      resists: { agua: 30, ar: -15 },
      spells: ['m-crab-pinch', 'm-crab-guard'], ai: 'melee',
      traits: [{ type: 'pushImmune' }], xp: 44
    },
    'mist-warbler': {
      name: 'Cantarola-de-Névoa', family: 'Corte Afogada', element: 'ar', dungeonId: 'cistern',
      description: 'Um pássaro sem penas, feito do vapor que sobe da água parada, com um bico longo por onde a cisterna assobia. Canta para os afogados e sopra os vivos para dentro dos canais.',
      flavor: 'O eco dela chega antes dela.',
      hp: 55, pa: 5, pp: 4, initiative: 68, dodge: 28, lock: 6,
      resists: { fogo: -15, terra: 25 },
      spells: ['m-mist-shove', 'm-mist-song'], ai: 'support', traits: [], xp: 30
    },
    'boss-baroness': {
      name: 'Baronesa Salmoura', family: 'Corte Afogada', element: 'agua', dungeonId: 'cistern',
      description: 'A dona da cisterna: um vestido de baile do século passado preenchido por água escura e viva, com um colar de pérolas boiando onde deveria haver um pescoço. Recebe visitas puxando-as para perto — e engolindo a sala inteira.',
      flavor: 'GIMMICK — O BAILE: Maré Faminta arrasta a sala inteira até ela; no turno seguinte, o Gole Amargo devora quem ficou perto. Espalhar-se, ser puxado, sair antes do gole.',
      hp: 360, pa: 7, pp: 3, initiative: 55, dodge: 12, lock: 46,
      resists: { fogo: 40, terra: -10, neutro: 10 },
      spells: ['m-tide-pull', 'm-bitter-gulp', 'm-salt-lance', 'm-brine-spawn'], ai: 'boss',
      traits: [{ type: 'pushImmune' }, { type: 'enrage', hpPct: 0.35, power: 30 }],
      boss: true, xp: 540
    }
  });

  // ==========================================================================
  // 3) O FECHO DE BRASA — Prole da Fornalha
  //    Fogo domina; a Bigorna é Terra, o Cinzento virou Ar (fuligem suspensa)
  //    e o Cão-de-Têmpera é Água — na sala alagada, a hierarquia se inverte.
  // ==========================================================================
  addSpells({
    'm-ember-claw': {
      name: 'Garra Acesa', element: 'fogo', paCost: 3,
      effects: [{ type: 'damage', element: 'fogo', min: 13, max: 17 }],
      description: 'O tição rasga com garras em brasa viva.',
      flavor: 'A risada é o estopim.'
    },
    'm-anvil-crush': {
      name: 'Esmagamento', element: 'terra', paCost: 4,
      effects: [{ type: 'damage', element: 'terra', min: 20, max: 26 }],
      description: 'A bigorna simplesmente cai por cima. Física básica, resultados excelentes.',
      flavor: 'Cite-a por último, mas cite-a.'
    },
    'm-ash-bolt': {
      name: 'Seta de Cinza', element: 'ar', paCost: 3, castsPerTurn: 2, range: [2, 6],
      effects: [{ type: 'damage', element: 'ar', min: 13, max: 17 }],
      description: 'O cinzento aponta o dedo e a fuligem obedece, voando em seta.',
      flavor: 'Fuligem é só fogo que aprendeu a flutuar.', fxKey: 'bolt'
    },
    'm-ash-veil': {
      name: 'Sudário de Cinza', element: 'ar', paCost: 2, cooldown: 3, range: [0, 0], los: false, targetSide: 'self',
      effects: [{ type: 'invisible', duration: 1 }],
      description: 'O cinzento se desfaz em fuligem suspensa por 1 turno: impossível de mirar.',
      flavor: 'Troque de alvo — ou adivinhe.', fxKey: 'veil'
    },
    'm-slag-slam': {
      name: 'Peso Morto', element: 'fogo', paCost: 4,
      effects: [{ type: 'damage', element: 'fogo', min: 15, max: 20 }],
      description: 'O monte de escória desaba sobre o alvo em câmera lenta, fervendo.',
      flavor: 'Uma morte em três atos começa aqui.'
    },
    'm-smith-hammer': {
      name: 'Marretada', element: 'terra', paCost: 3,
      effects: [{ type: 'damage', element: 'terra', min: 12, max: 16 }],
      description: 'O ferreiro trata o alvo como peça mal forjada.',
      flavor: 'Sem rosto, sem pressa, sem erro.'
    },
    'm-forge-temper': {
      name: 'Têmpera', element: 'fogo', paCost: 2, cooldown: 1, range: [0, 5], targetSide: 'ally',
      effects: [{ type: 'buff', stat: 'power', value: 20, duration: 2 }],
      description: 'O ferreiro martela o aliado como quem afia uma arma: +20 de poder por 2 turnos.',
      flavor: 'Uma Bigorna temperada desmonta um herói.', fxKey: 'buff'
    },
    'm-smith-plate': {
      name: 'Chapa Quente', element: 'fogo', paCost: 2, cooldown: 1, range: [0, 4], targetSide: 'ally',
      effects: [{ type: 'shield', value: 20, duration: 2 }],
      description: 'Uma placa de metal ainda rubro é soldada no aliado: 20 de escudo.',
      flavor: 'Dói nos dois. Só um se importa.', fxKey: 'shieldFx'
    },
    'm-quench-lunge': {
      name: 'Bote de Têmpera', element: 'agua', paCost: 4, cooldown: 1, range: [1, 4],
      effects: [{ type: 'moveTo', maxTiles: 4 }, { type: 'damage', element: 'agua', min: 12, max: 16 }],
      description: 'O cão salta do fosso de têmpera até 4 células e morde ainda pingando.',
      flavor: 'Nasceu da água que apaga espadas.', fxKey: 'gust'
    },
    'm-quench-hiss': {
      name: 'Chiado', element: 'agua', paCost: 3, castsPerTurn: 2,
      effects: [{ type: 'dispelShield' }, { type: 'damage', element: 'agua', min: 9, max: 12 }],
      description: 'Um jato de vapor fervente descola o escudo do alvo antes de queimá-lo.',
      flavor: 'O barulho que uma proteção faz ao desistir.', fxKey: 'burst'
    },
    'm-chain-yank': {
      name: 'Puxão de Corrente', element: 'neutro', paCost: 3, cooldown: 1, range: [2, 6], line: true,
      effects: [{ type: 'pull', tiles: 3 }, { type: 'root', duration: 1 }],
      description: 'A corrente do teto laça o alvo, arrasta 3 células e o prende ao gancho por 1 turno.',
      flavor: 'A forja sempre precisou de carne pendurada.', fxKey: 'hook'
    },
    'm-chain-lash': {
      name: 'Correntada', element: 'neutro', paCost: 3,
      effects: [{ type: 'damage', element: 'neutro', min: 13, max: 17 }],
      description: 'Elos grossos giram e batem de chapa.',
      flavor: 'Nada de elegante. Muito de eficaz.'
    },
    'm-doom-hammer': {
      name: 'Martelo do Fim', element: 'fogo', paCost: 5, cooldown: 2, range: [1, 2],
      shape: 'cross', size: 1,
      effects: [{ type: 'damage', element: 'fogo', min: 30, max: 38 }],
      description: 'Magno ergue o martelo com que se forjou o primeiro Fecho — e o mundo range quando ele desce.',
      flavor: 'A cruz inteira paga pelo alvo que ele escolheu.', fxKey: 'nova'
    },
    'm-bellows-blast': {
      name: 'Sopro de Fornalha', element: 'fogo', paCost: 3, range: [1, 6], line: true,
      effects: [{ type: 'damage', element: 'fogo', min: 14, max: 18 }, { type: 'push', tiles: 3 }],
      description: 'O peito-fornalha de Magno expele um vendaval incandescente que arremessa o alvo 3 células.',
      flavor: 'De costas para o fosso, isso é uma sentença.', fxKey: 'gust'
    },
    'm-spark-call': {
      name: 'Chamar Fagulhas', element: 'fogo', paCost: 3, cooldown: 1, range: [1, 4],
      needsEmptyTile: true, targetSide: 'any',
      effects: [{ type: 'summon', monsterId: 'spark-whelp' }],
      description: 'Magno estala os dedos e uma fagulha ganha pernas — e péssimas intenções.',
      flavor: 'Ele fabrica o próprio exército descartável.', fxKey: 'summonFx'
    },
    'm-heart-brand': {
      name: 'Marca do Acendedor', element: 'fogo', paCost: 2, cooldown: 1, range: [1, 5],
      effects: [{ type: 'mark', value: 5, duration: 3, max: 5 }],
      description: 'Magno encosta a chama no alvo e deixa uma marca em brasa: +5% de dano recebido por pilha, até 5 pilhas.',
      flavor: 'Ele marca a peça antes de bater nela.', fxKey: 'debuff'
    },
    'm-anvil-verdict': {
      name: 'Veredito da Bigorna', element: 'fogo', paCost: 4, cooldown: 2, range: [1, 2],
      effects: [{ type: 'detonateMarks', mult: 9 }],
      description: 'Magno consome todas as marcas do alvo de uma vez: 9 de dano por pilha acumulada.',
      flavor: 'A peça marcada volta para a bigorna. Sempre.', fxKey: 'burst'
    },
    'm-stoke': {
      name: 'Atiçar-se', element: 'fogo', paCost: 2, cooldown: 3, range: [0, 0], los: false, targetSide: 'self',
      effects: [{ type: 'buff', stat: 'power', value: 25, duration: 2 }],
      description: 'Magno abre a grelha do próprio peito e sopra as brasas: +25 de poder.',
      flavor: 'A fornalha respira. A segunda metade da luta é outra luta.', fxKey: 'buff'
    },
    'm-spark-tap': {
      name: 'Estalo', element: 'fogo', paCost: 3,
      effects: [{ type: 'damage', element: 'fogo', min: 6, max: 9 }],
      description: 'A fagulha encosta e estala. Dói mais do que parece.',
      flavor: 'Vive pouco, termina alto.'
    },
    'm-slag-drip': {
      name: 'Respingo', element: 'fogo', paCost: 3,
      effects: [{ type: 'damage', element: 'fogo', min: 5, max: 8 }],
      description: 'Um respingo de escória fervente.',
      flavor: 'Um caco ainda rubro, rastejando com propósito.'
    }
  });

  addMonsters({
    'ember-imp': {
      name: 'Tição', family: 'Prole da Fornalha', element: 'fogo', dungeonId: 'emberlock',
      description: 'Um carvão em brasa com braços finos e um sorriso rachado de luz alaranjada. Corre até você rindo. A risada é o estopim.',
      flavor: 'Onde ele morre importa mais do que quando.',
      hp: 60, pa: 3, pp: 4, initiative: 75, dodge: 22, lock: 8,
      resists: { agua: -25, ar: 30 },
      spells: ['m-ember-claw'], ai: 'melee',
      traits: [{ type: 'explodeOnDeath', element: 'fogo', damage: 22, radius: 1 }], xp: 30
    },
    'walking-anvil': {
      name: 'Bigorna Ambulante', family: 'Prole da Fornalha', element: 'terra', dungeonId: 'emberlock',
      description: 'Uma bigorna centenária que criou pernas atarracadas e um rancor proporcional ao número de marteladas que levou. Impossível de empurrar; péssima ideia de deixar chegar perto.',
      flavor: 'Lenta como culpa antiga.',
      hp: 110, pa: 4, pp: 2, initiative: 10, dodge: 0, lock: 38,
      resists: { fogo: 20, agua: 30, ar: -15 },
      spells: ['m-anvil-crush'], ai: 'melee',
      traits: [{ type: 'pushImmune' }, { type: 'enrage', hpPct: 0.5, power: 30 }], xp: 55
    },
    'ash-wraith': {
      name: 'Cinzento', family: 'Prole da Fornalha', element: 'ar', dungeonId: 'emberlock',
      description: 'O contorno de um ferreiro antigo desenhado em fuligem suspensa, com dois pontos de brasa no lugar dos olhos. Atira setas de cinza e se desmancha no ar quando ameaçado.',
      flavor: 'Some no vendaval e volta na sua nuca.',
      hp: 70, pa: 5, pp: 3, initiative: 65, dodge: 26, lock: 8,
      resists: { fogo: -15, terra: 25 },
      spells: ['m-ash-bolt', 'm-ash-veil'], ai: 'ranged', traits: [], xp: 35
    },
    'slag-mound': {
      name: 'Monte de Escória', family: 'Prole da Fornalha', element: 'fogo', dungeonId: 'emberlock',
      description: 'Uma pilha de refugo de forja que aprendeu a se arrastar, deixando um rastro vitrificado. Quebre-a e ela desmorona em duas escorinhas incandescentes — que explodem.',
      flavor: 'A pior coisa para matar em espaço apertado.',
      hp: 95, pa: 4, pp: 2, initiative: 20, dodge: 2, lock: 26,
      resists: { agua: -30, terra: 15, ar: 30 },
      spells: ['m-slag-slam'], ai: 'melee',
      traits: [{ type: 'split', monsterId: 'slag-bit', count: 2 }], xp: 48
    },
    'faceless-smith': {
      name: 'Ferreiro Sem-Rosto', family: 'Prole da Fornalha', element: 'fogo', dungeonId: 'emberlock',
      description: 'Um avental de couro e dois braços musculosos pendurados em nada: onde deveria haver um corpo, só calor tremulando. Tempera os aliados como lâminas e os cobre de chapas ardentes.',
      flavor: 'O suporte que transforma lacaio em problema.',
      hp: 80, pa: 6, pp: 3, initiative: 45, dodge: 12, lock: 16,
      resists: { agua: -15, terra: 10, ar: 25 },
      spells: ['m-smith-hammer', 'm-forge-temper', 'm-smith-plate'], ai: 'support', traits: [], xp: 40
    },
    'quench-hound': {
      name: 'Cão-de-Têmpera', family: 'Prole da Fornalha', element: 'agua', dungeonId: 'emberlock',
      description: 'Um cão de vapor condensado que nasceu no fosso onde as lâminas eram mergulhadas ainda vermelhas. O pelo goteja, a mordida chia, e onde ele passa a brasa apaga — inclusive a dos donos da casa.',
      flavor: 'A única água do Fecho, e ela morde.',
      hp: 72, pa: 5, pp: 4, initiative: 70, dodge: 24, lock: 14,
      resists: { fogo: 30, terra: -10 },
      spells: ['m-quench-lunge', 'm-quench-hiss'], ai: 'melee', traits: [], xp: 38
    },
    'chain-hauler': {
      name: 'Puxa-Corrente', family: 'Prole da Fornalha', element: 'neutro', dungeonId: 'emberlock',
      description: 'Um guindaste de forja que criou vontade: um carretel de ferro pendurado no trilho do teto, com três correntes que ele lança como anzóis. Não persegue ninguém — traz todo mundo até ele.',
      flavor: 'Ancorado ao trilho: empurrar não resolve.',
      hp: 78, pa: 6, pp: 1, initiative: 30, dodge: 2, lock: 30,
      resists: { fogo: 15, terra: 15, neutro: 10 },
      spells: ['m-chain-yank', 'm-chain-lash'], ai: 'ranged',
      traits: [{ type: 'pushImmune' }], xp: 42
    },
    'spark-whelp': {
      name: 'Fagulha', family: 'Prole da Fornalha', element: 'fogo', dungeonId: 'emberlock',
      description: 'Uma faísca com pernas e opinião. Vive pouco, termina alto.',
      flavor: 'Magno as fabrica sem olhar.',
      hp: 28, pa: 3, pp: 4, initiative: 80, dodge: 24, lock: 4,
      resists: { agua: -25, ar: 25 },
      spells: ['m-spark-tap'], ai: 'melee',
      traits: [{ type: 'explodeOnDeath', element: 'fogo', damage: 15, radius: 1 }],
      summonOnly: true, xp: 4
    },
    'slag-bit': {
      name: 'Escorinha', family: 'Prole da Fornalha', element: 'fogo', dungeonId: 'emberlock',
      description: 'Um caco de escória ainda rubro, rastejando com propósito.',
      flavor: 'Ato dois de três.',
      hp: 30, pa: 3, pp: 2, initiative: 25, dodge: 6, lock: 12,
      resists: { agua: -20, terra: 10, ar: 20 },
      spells: ['m-slag-drip'], ai: 'melee',
      traits: [{ type: 'explodeOnDeath', element: 'fogo', damage: 12, radius: 1 }],
      summonOnly: true, xp: 4
    },
    'boss-heartforge': {
      name: 'Magno, o Acendedor', family: 'Prole da Fornalha', element: 'fogo', dungeonId: 'emberlock',
      description: 'O coração do último Fecho em forma de titã: um forno a lenha de quatro metros com grelha no peito, martelo-chaminé ao ombro e a primeira chama do mundo queimando lá dentro. Ele não guarda o portão. Ele É o portão.',
      flavor: 'GIMMICK — A PEÇA MARCADA: ele marca você com a brasa (até 5 pilhas), sopra você para longe com a fornalha e cobra tudo de uma vez no Veredito da Bigorna. Limpe a marca ou morra pelo total.',
      hp: 420, pa: 8, pp: 3, initiative: 60, dodge: 10, lock: 50,
      resists: { agua: -25, terra: 20, ar: 40 },
      spells: ['m-doom-hammer', 'm-bellows-blast', 'm-heart-brand', 'm-anvil-verdict', 'm-spark-call', 'm-stoke'],
      ai: 'boss',
      traits: [{ type: 'pushImmune' }, { type: 'enrage', hpPct: 0.5, power: 40 }],
      boss: true, xp: 630
    }
  });

  // ==========================================================================
  // 4) OS ANDAIMES DO VENTO — Coro dos Andaimes
  //    Ar em maioria. O Golem de Lastro (Terra) apanha do próprio vendaval:
  //    é o inimigo que o clima está matando junto com você.
  // ==========================================================================
  addSpells({
    'm-shrike-dive': {
      name: 'Rasante', element: 'ar', paCost: 4, cooldown: 1, range: [1, 5],
      effects: [{ type: 'moveTo', maxTiles: 5 }, { type: 'damage', element: 'ar', min: 14, max: 18 }],
      description: 'O picanço desce a prumo pelo vão do andaime e acerta no fim da queda.',
      flavor: 'Ele usa a altura como se ela fosse arma. É.', fxKey: 'gust'
    },
    'm-shrike-peck': {
      name: 'Bicada de Tábua', element: 'ar', paCost: 3, castsPerTurn: 2,
      effects: [{ type: 'damage', element: 'ar', min: 10, max: 14 }, { type: 'push', tiles: 1 }],
      description: 'Uma bicada seca que empurra o alvo uma célula para trás — e no andaime, uma célula é muita coisa.',
      flavor: 'Ele empala o que sobra nos pregos.'
    },
    'm-gremlin-shove': {
      name: 'Encontrão', element: 'ar', paCost: 3, castsPerTurn: 2,
      effects: [{ type: 'damage', element: 'ar', min: 9, max: 12 }, { type: 'push', tiles: 2 }],
      description: 'O gremlin dá um ombro entusiasmado e manda o alvo 2 células para onde não há chão.',
      flavor: 'Ele acha isso hilário. Todos os dias.', fxKey: 'gust'
    },
    'm-gremlin-swap': {
      name: 'Troca-Tábua', element: 'ar', paCost: 2, cooldown: 3, range: [1, 5], targetSide: 'any',
      effects: [{ type: 'swap' }],
      description: 'O gremlin troca de lugar com a vítima — quase sempre para colocá-la na beirada.',
      flavor: 'Ele nunca fica com a pior tábua.', fxKey: 'blink'
    },
    'm-rope-noose': {
      name: 'Laço de Obra', element: 'neutro', paCost: 3, cooldown: 1, range: [2, 6], line: true,
      effects: [{ type: 'pull', tiles: 3 }, { type: 'root', duration: 1 }],
      description: 'A corda vem em linha reta, laça e recolhe 3 células — e o nó segura por 1 turno.',
      flavor: 'A obra recolhe o material.', fxKey: 'hook'
    },
    'm-rope-cinch': {
      name: 'Aperto de Nó', element: 'neutro', paCost: 3,
      effects: [
        { type: 'damage', element: 'neutro', min: 12, max: 16 },
        { type: 'mark', value: 4, duration: 2, max: 4 }
      ],
      description: 'O nó aperta e deixa a marca da corda na carne: +4% de dano recebido por pilha.',
      flavor: 'Cada volta da corda é uma promessa.', fxKey: 'debuff'
    },
    'm-kite-arc': {
      name: 'Arco de Pipa', element: 'ar', paCost: 4, cooldown: 1, range: [2, 6],
      effects: [{ type: 'chain', jumps: 2, falloff: 0.65, element: 'ar', min: 11, max: 15 }],
      description: 'A linha da serpe-pipa risca o ar carregado e salta para até 2 inimigos vizinhos, enfraquecendo a cada salto.',
      flavor: 'No vendaval, tudo aqui é para-raios.', fxKey: 'beam'
    },
    'm-kite-whip': {
      name: 'Chicote de Linha', element: 'ar', paCost: 3, castsPerTurn: 2, range: [2, 5],
      effects: [{ type: 'damage', element: 'ar', min: 13, max: 17 }],
      description: 'A cauda de fita corta com o fio de vidro moído que a reveste.',
      flavor: 'Linha de pipa cega corta pescoço de dono.', fxKey: 'bolt'
    },
    'm-ballast-drop': {
      name: 'Queda de Lastro', element: 'terra', paCost: 4,
      effects: [{ type: 'damage', element: 'terra', min: 22, max: 28 }, { type: 'push', tiles: 1 }],
      description: 'O golem despeja um saco de pedras do próprio tronco em cima do alvo.',
      flavor: 'Ele é o único aqui que pesa. Faz questão de provar.'
    },
    'm-ballast-anchor': {
      name: 'Ancorar', element: 'terra', paCost: 3, cooldown: 3, range: [0, 0], los: false, targetSide: 'self',
      effects: [{ type: 'shield', value: 30, duration: 2 }, { type: 'taunt', duration: 2 }],
      description: 'O golem crava os pés nas juntas do andaime: 30 de escudo e provocação por 2 turnos.',
      flavor: 'Enquanto ele segura o vento, o vento o consome.', fxKey: 'shieldFx'
    },
    'm-choir-hymn': {
      name: 'Assobio Coral', element: 'ar', paCost: 3, cooldown: 1, range: [0, 5], targetSide: 'ally',
      effects: [
        { type: 'heal', min: 10, max: 14 },
        { type: 'buff', stat: 'dodge', value: 10, duration: 2 }
      ],
      description: 'Os tubos do coro afinam no mesmo tom: o aliado se recompõe e fica mais escorregadio.',
      flavor: 'Quando eles cantam juntos, a obra inteira vibra.', fxKey: 'heal'
    },
    'm-choir-clear': {
      name: 'Sopro Limpo', element: 'ar', paCost: 2, cooldown: 2, range: [0, 5], targetSide: 'ally',
      effects: [
        { type: 'cleanse', kinds: ['poison', 'root', 'mark'] },
        { type: 'regen', min: 5, max: 8, duration: 2 }
      ],
      description: 'Uma lufada limpa veneno, nós e marcas do aliado, e deixa uma corrente morna regenerando.',
      flavor: 'Ventilar é a religião local.', fxKey: 'buff'
    },
    'm-mote-buzz': {
      name: 'Zumbido', element: 'ar', paCost: 3, castsPerTurn: 2,
      effects: [{ type: 'damage', element: 'ar', min: 8, max: 11 }],
      description: 'O enxame passa raspando e leva um pedaço junto.',
      flavor: 'Mil bichinhos, uma opinião.'
    },
    'm-mote-nip': {
      name: 'Ferroada de Mote', element: 'ar', paCost: 3,
      effects: [{ type: 'damage', element: 'ar', min: 5, max: 8 }],
      description: 'Um mote solitário faz o que pode.',
      flavor: 'Sozinho é cômico. Em dois, nem tanto.'
    },
    'm-nail-jab': {
      name: 'Espetada', element: 'ar', paCost: 3,
      effects: [{ type: 'damage', element: 'ar', min: 6, max: 9 }],
      description: 'Um prego vivo pula e se enterra onde encontra.',
      flavor: 'A obra ainda tem pregos sobrando.'
    },
    'm-scaffold-collapse': {
      name: 'Desabar a Ala', element: 'ar', paCost: 4, cooldown: 1, range: [1, 6], line: true,
      effects: [{ type: 'damage', element: 'ar', min: 18, max: 24 }, { type: 'push', tiles: 3 }],
      description: 'Cambota chuta a viga mestra e a linha inteira cede: dano e arremesso de 3 células.',
      flavor: 'Ele derruba a própria obra sem hesitar. Reconstrói depois.', fxKey: 'gust'
    },
    'm-rivet-volley': {
      name: 'Salva de Rebites', element: 'ar', paCost: 4, cooldown: 1, range: [1, 5],
      shape: 'cone', size: 3,
      effects: [
        { type: 'damage', element: 'ar', min: 14, max: 18 },
        { type: 'mark', value: 5, duration: 3, max: 5 }
      ],
      description: 'Um leque de rebites em brasa cravado num cone de 3 células: cada rebite é uma marca aberta.',
      flavor: 'Ele te transforma em parte da estrutura.', fxKey: 'burst'
    },
    'm-raise-frame': {
      name: 'Levantar Prumo', element: 'neutro', paCost: 3, cooldown: 1, range: [1, 4],
      needsEmptyTile: true, targetSide: 'any',
      effects: [{ type: 'summon', monsterId: 'nail-sprite' }],
      description: 'Cambota finca uma armação nova e um pregolim sai andando dela.',
      flavor: 'A obra nunca para. É esse o problema.', fxKey: 'summonFx'
    },
    'm-headwind': {
      name: 'Vento de Proa', element: 'ar', paCost: 3, cooldown: 3, range: [0, 0], los: false, targetSide: 'self',
      effects: [
        { type: 'weatherShift', weather: 'vendaval' },
        { type: 'buff', stat: 'dodge', value: 15, duration: 2 }
      ],
      description: 'Cambota abre todas as comportas do poço: o vendaval volta a soprar e ele fica impossível de segurar.',
      flavor: 'A sala é ferramenta dele. Você é que está de visita.', fxKey: 'nova'
    }
  });

  addMonsters({
    'plank-shrike': {
      name: 'Picanço-de-Tábua', family: 'Coro dos Andaimes', element: 'ar', dungeonId: 'windscaffold',
      description: 'Um pássaro cinzento de bico curvo que empala o que caça nos pregos expostos das tábuas. Vive nos vãos, desce em queda livre e some antes de você virar a cabeça.',
      flavor: 'A despensa dele é o corrimão.',
      hp: 62, pa: 6, pp: 5, initiative: 80, dodge: 34, lock: 8,
      resists: { fogo: -15, terra: 25 },
      spells: ['m-shrike-dive', 'm-shrike-peck'], ai: 'melee', traits: [], xp: 34
    },
    'gust-gremlin': {
      name: 'Gremlin de Rajada', family: 'Coro dos Andaimes', element: 'ar', dungeonId: 'windscaffold',
      description: 'Um bichinho de orelhas enormes que usa as próprias orelhas como velas. Não bate para matar: bate para ver a pessoa cair. Tem um senso de humor documentadamente ruim.',
      flavor: 'Ele conta as quedas. Em voz alta.',
      hp: 55, pa: 5, pp: 5, initiative: 72, dodge: 32, lock: 10,
      resists: { fogo: -10, terra: 25 },
      spells: ['m-gremlin-shove', 'm-gremlin-swap'], ai: 'melee', traits: [], xp: 30
    },
    'rope-hanger': {
      name: 'Enforca-Corda', family: 'Coro dos Andaimes', element: 'neutro', dungeonId: 'windscaffold',
      description: 'Um novelo de cordas de obra amarrado num nó que ninguém consegue desfazer, pendurado na roldana mestra. Não desce nunca. Lança laços e recolhe o que pegou como quem puxa material.',
      flavor: 'Preso à roldana: empurrão não move nó.',
      hp: 70, pa: 6, pp: 1, initiative: 28, dodge: 4, lock: 30,
      resists: { ar: 10, neutro: 15 },
      spells: ['m-rope-noose', 'm-rope-cinch'], ai: 'ranged',
      traits: [{ type: 'pushImmune' }], xp: 38
    },
    'kite-serpent': {
      name: 'Serpe-Pipa', family: 'Coro dos Andaimes', element: 'ar', dungeonId: 'windscaffold',
      description: 'Uma serpente chata e comprida feita de papel encerado e ripas, com uma cauda de fitas revestida de vidro moído. Sobe nas correntes de ar e desce riscando.',
      flavor: 'Uma pipa que aprendeu a puxar a própria linha.',
      hp: 66, pa: 6, pp: 3, initiative: 62, dodge: 24, lock: 10,
      resists: { fogo: -10, terra: 30 },
      spells: ['m-kite-arc', 'm-kite-whip'], ai: 'ranged', traits: [], xp: 36
    },
    'ballast-golem': {
      name: 'Golem de Lastro', family: 'Coro dos Andaimes', element: 'terra', dungeonId: 'windscaffold',
      description: 'Uma armação de vigas cheia de sacos de brita, feita para segurar o andaime no lugar quando o poço sopra. Segurou por mil anos. Agora anda — devagar, e sempre contra o vento.',
      flavor: 'O vendaval o mata 5 PV por turno. Não tenha pressa com ele.',
      hp: 120, pa: 4, pp: 2, initiative: 12, dodge: 0, lock: 40,
      resists: { agua: 30, ar: -20 },
      spells: ['m-ballast-drop', 'm-ballast-anchor'], ai: 'melee',
      traits: [{ type: 'pushImmune' }, { type: 'enrage', hpPct: 0.5, power: 25 }], xp: 62
    },
    'whistle-choir': {
      name: 'Coro-Assobio', family: 'Coro dos Andaimes', element: 'ar', dungeonId: 'windscaffold',
      description: 'Um feixe de tubos de respiradouro amarrado com arame, flutuando de lado. Cada tubo assobia uma nota; juntos, remendam os companheiros e limpam deles tudo o que gruda.',
      flavor: 'Apague a música antes de discutir com a banda.',
      hp: 58, pa: 6, pp: 3, initiative: 50, dodge: 20, lock: 6,
      resists: { fogo: -10, terra: 25 },
      spells: ['m-choir-hymn', 'm-choir-clear'], ai: 'support',
      traits: [{ type: 'regenAura', value: 7, radius: 2 }], xp: 34
    },
    'mote-swarm': {
      name: 'Enxame de Motes', family: 'Coro dos Andaimes', element: 'ar', dungeonId: 'windscaffold',
      description: 'Uma nuvem compacta de bichinhos de poeira luminosa que se move como um corpo só. Bata forte o bastante e ela deixa de ser um corpo — vira dois.',
      flavor: 'Você não mata uma nuvem. Você a divide.',
      hp: 74, pa: 4, pp: 4, initiative: 58, dodge: 28, lock: 8,
      resists: { fogo: -15, terra: 25 },
      spells: ['m-mote-buzz'], ai: 'melee',
      traits: [{ type: 'split', monsterId: 'mote-bit', count: 2 }], xp: 40
    },
    'mote-bit': {
      name: 'Motinho', family: 'Coro dos Andaimes', element: 'ar', dungeonId: 'windscaffold',
      description: 'Metade de uma nuvem, com o dobro da pressa. Quando se desfaz, o pó pega fogo por um instante.',
      flavor: 'Poeira também explode. Pergunte a qualquer mineiro.',
      hp: 26, pa: 3, pp: 4, initiative: 66, dodge: 26, lock: 4,
      resists: { fogo: -15, terra: 20 },
      spells: ['m-mote-nip'], ai: 'melee',
      traits: [{ type: 'explodeOnDeath', element: 'ar', damage: 12, radius: 1 }],
      summonOnly: true, xp: 4
    },
    'nail-sprite': {
      name: 'Pregolim', family: 'Coro dos Andaimes', element: 'ar', dungeonId: 'windscaffold',
      description: 'Um prego de quinze centímetros com dois olhinhos e muita convicção. Cambota os finca na armação e eles saem andando.',
      flavor: 'Nasce torto, entra reto.',
      hp: 24, pa: 3, pp: 4, initiative: 70, dodge: 22, lock: 6,
      resists: { fogo: -15, terra: 15 },
      spells: ['m-nail-jab'], ai: 'melee', traits: [], summonOnly: true, xp: 4
    },
    'boss-windwright': {
      name: 'Cambota, o Mestre-de-Obras', family: 'Coro dos Andaimes', element: 'ar', dungeonId: 'windscaffold',
      description: 'O capataz que jamais entregou a obra: um esqueleto de vigas e cordame com uma roldana no lugar da cabeça e um prumo eterno balançando do braço. Constrói o andaime enquanto luta em cima dele — e derruba a ala inteira se isso resolver mais rápido.',
      flavor: 'GIMMICK — A OBRA CONTINUA: rebites marcam você (até 5 pilhas), o Vento de Proa devolve o vendaval quando o clima esfria, e Desabar a Ala manda quem estiver marcado 3 células para dentro do vazio. Ele não precisa te matar: precisa te empurrar.',
      hp: 470, pa: 8, pp: 4, initiative: 66, dodge: 24, lock: 44,
      resists: { fogo: -15, terra: 40, neutro: 10 },
      spells: ['m-scaffold-collapse', 'm-rivet-volley', 'm-raise-frame', 'm-headwind', 'm-rope-cinch'],
      ai: 'boss',
      traits: [{ type: 'pushImmune' }, { type: 'enrage', hpPct: 0.4, power: 35 }],
      boss: true, xp: 705
    }
  });

  // ==========================================================================
  // 5) A MINA TRÊMULA — Turno da Noite
  //    Terra em maioria (o tremor cura os donos da casa). O Morcego-de-Poço
  //    (Ar) apanha do clima e o Fogaréu de Grisu (Fogo) explode alto.
  // ==========================================================================
  addSpells({
    'm-pick-swing': {
      name: 'Picaretada', element: 'terra', paCost: 3, castsPerTurn: 2,
      effects: [
        { type: 'damage', element: 'terra', min: 16, max: 21 },
        { type: 'mark', value: 5, duration: 2, max: 4 }
      ],
      description: 'A picareta abre uma fissura na armadura e deixa a marca do veio: +5% de dano recebido por pilha.',
      flavor: 'Ele lê você como lê rocha: procurando onde racha.'
    },
    'm-pick-verdict': {
      name: 'Golpe de Veio', element: 'terra', paCost: 4, cooldown: 2,
      effects: [{ type: 'detonateMarks', mult: 7 }],
      description: 'O assombro bate exatamente onde marcou e a rocha cede: 7 de dano por pilha acumulada.',
      flavor: 'Toda pedra tem um golpe só. Ele decorou o seu.', fxKey: 'burst'
    },
    'm-firedamp-flare': {
      name: 'Labareda de Grisu', element: 'fogo', paCost: 3, castsPerTurn: 2, range: [2, 5],
      effects: [{ type: 'damage', element: 'fogo', min: 12, max: 16 }],
      description: 'O fogaréu cospe uma língua azul de gás aceso pela galeria.',
      flavor: 'O gás não tem cheiro. O aviso é a luz.', fxKey: 'bolt'
    },
    'm-firedamp-cloud': {
      name: 'Bolsão de Gás', element: 'fogo', paCost: 3, cooldown: 2, range: [1, 5],
      shape: 'circle', size: 1,
      effects: [{ type: 'poison', element: 'fogo', min: 6, max: 9, duration: 2 }],
      description: 'Um bolsão invisível se rompe e queima os pulmões de quem está na área por 2 turnos.',
      flavor: 'Os mineiros levavam pássaros. Você levou heróis.', fxKey: 'poisonCloud'
    },
    'm-cave-bite': {
      name: 'Bocarrada', element: 'terra', paCost: 4,
      effects: [{ type: 'damage', element: 'terra', min: 20, max: 26 }],
      description: 'A galeria se fecha nos dentes de pedra da Bocarra.',
      flavor: 'Você achou que era um túnel.'
    },
    'm-cave-roar': {
      name: 'Rugido de Galeria', element: 'terra', paCost: 3, cooldown: 2, range: [0, 0], los: false,
      shape: 'cross', size: 2, targetSide: 'any',
      effects: [{ type: 'damage', element: 'terra', min: 10, max: 14 }, { type: 'taunt', duration: 2 }],
      description: 'O rugido percorre a cruz de galerias e obriga todo mundo a olhar para ela por 2 turnos.',
      flavor: 'Uma bocarra que exige plateia.', fxKey: 'nova'
    },
    'm-crystal-chant': {
      name: 'Canto de Cristal', element: 'terra', paCost: 3, castsPerTurn: 2, range: [0, 5], targetSide: 'ally',
      effects: [{ type: 'heal', min: 14, max: 18 }],
      description: 'O cristal ressoa na frequência da pedra viva e recompõe o aliado.',
      flavor: 'A mina canta de volta para quem cava direito.', fxKey: 'heal'
    },
    'm-crystal-facet': {
      name: 'Faceta Espelhada', element: 'terra', paCost: 3, cooldown: 2, range: [0, 4], targetSide: 'ally',
      effects: [
        { type: 'shield', value: 22, duration: 2 },
        { type: 'reflect', pct: 20, duration: 2 }
      ],
      description: 'Uma casca de quartzo cobre o aliado: 22 de escudo e 20% do dano recebido volta para quem bateu.',
      flavor: 'Bater nele é bater em você mesmo, com atraso.', fxKey: 'shieldFx'
    },
    'm-worm-drag': {
      name: 'Arrasto de Abatimento', element: 'terra', paCost: 3, cooldown: 1, range: [2, 6], line: true,
      effects: [{ type: 'pull', tiles: 3 }, { type: 'root', duration: 1 }],
      description: 'O chão desmorona em funil e o alvo escorrega 3 células até a boca do verme, preso na areia.',
      flavor: 'O piso é opinião. Ele discorda.', fxKey: 'hook'
    },
    'm-worm-spit': {
      name: 'Cuspe de Cascalho', element: 'terra', paCost: 3, castsPerTurn: 2, range: [2, 6],
      effects: [{ type: 'damage', element: 'terra', min: 13, max: 17 }],
      description: 'Uma rajada de cascalho triturado, quente do atrito.',
      flavor: 'Ele mastiga a mina e devolve a parte inútil.', fxKey: 'bolt'
    },
    'm-tumbler-roll': {
      name: 'Rolagem', element: 'terra', paCost: 4, cooldown: 1, range: [1, 4],
      effects: [
        { type: 'moveTo', maxTiles: 4 },
        { type: 'damage', element: 'terra', min: 15, max: 20 },
        { type: 'push', tiles: 1 }
      ],
      description: 'O rolo de minério ganha embalo por até 4 células e atropela o que estiver no fim do trilho.',
      flavor: 'A mina inteira é uma ladeira, se você for redondo.', fxKey: 'gust'
    },
    'm-ore-chip-hit': {
      name: 'Lascada', element: 'terra', paCost: 3,
      effects: [{ type: 'damage', element: 'terra', min: 7, max: 10 }],
      description: 'Uma lasca de minério se atira contra a canela do alvo.',
      flavor: 'O troco do rolo.'
    },
    'm-bat-screech': {
      name: 'Guincho de Poço', element: 'ar', paCost: 3, castsPerTurn: 2, range: [1, 3],
      effects: [{ type: 'damage', element: 'ar', min: 9, max: 12 }, { type: 'push', tiles: 1 }],
      description: 'Um guincho tão agudo que empurra o ar — e o alvo junto.',
      flavor: 'Ele enxerga com isso. Você só sente.', fxKey: 'burst'
    },
    'm-bat-swoop': {
      name: 'Voo Rasante', element: 'ar', paCost: 4, cooldown: 1, range: [1, 5],
      effects: [{ type: 'moveTo', maxTiles: 5 }, { type: 'damage', element: 'ar', min: 11, max: 15 }],
      description: 'O morcego atravessa o poço na diagonal e passa raspando com as garras.',
      flavor: 'No tremor ele perde 5 PV por turno. Ainda assim insiste.', fxKey: 'gust'
    },
    'm-seep-drip': {
      name: 'Gotejo Ácido', element: 'agua', paCost: 3, castsPerTurn: 2, range: [2, 5],
      effects: [
        { type: 'damage', element: 'agua', min: 10, max: 14 },
        { type: 'poison', element: 'agua', min: 5, max: 8, duration: 2 }
      ],
      description: 'A escorrência lança água de mina — mineral, velha e corrosiva — que continua comendo por 2 turnos.',
      flavor: 'Mil anos filtrando veneno da rocha.', fxKey: 'bolt'
    },
    'm-seep-solvent': {
      name: 'Solvente', element: 'agua', paCost: 3, cooldown: 1, range: [1, 5],
      effects: [{ type: 'dispelShield' }, { type: 'damage', element: 'agua', min: 8, max: 11 }],
      description: 'Um esguicho dissolve o escudo do alvo como se fosse sal.',
      flavor: 'Nada aqui embaixo fica protegido para sempre.', fxKey: 'burst'
    },
    'm-deep-knock': {
      name: 'A Batida', element: 'terra', paCost: 4, cooldown: 1, range: [0, 0], los: false,
      shape: 'ring', size: 2, targetSide: 'any',
      effects: [{ type: 'damage', element: 'terra', min: 20, max: 26 }, { type: 'root', duration: 1 }],
      description: 'Batepedra bate uma vez no chão e o anel a 2 células ao redor dele racha: dano e pés presos por 1 turno.',
      flavor: 'Os mineiros contavam as batidas. Quem chegava a três não voltava.', fxKey: 'nova'
    },
    'm-rockfall': {
      name: 'Desabamento', element: 'terra', paCost: 4, cooldown: 1, range: [1, 6],
      shape: 'circle', size: 1,
      effects: [{ type: 'damage', element: 'terra', min: 22, max: 28 }, { type: 'push', tiles: 2 }],
      description: 'Ele aponta para o teto e o teto obedece: pedra em área, e o que sobra é jogado 2 células.',
      flavor: 'A mina desaba com pontaria.', fxKey: 'nova'
    },
    'm-vein-call': {
      name: 'Chamar o Veio', element: 'terra', paCost: 3, cooldown: 1, range: [1, 4],
      needsEmptyTile: true, targetSide: 'any',
      effects: [{ type: 'summon', monsterId: 'ore-chip' }],
      description: 'Batepedra arranca um punhado do veio e o punhado começa a andar.',
      flavor: 'Minério é gente também, aqui embaixo.', fxKey: 'summonFx'
    },
    'm-quake-stance': {
      name: 'Postura de Tremor', element: 'terra', paCost: 3, cooldown: 3, range: [0, 0], los: false, targetSide: 'self',
      effects: [
        { type: 'weatherShift', weather: 'tremor' },
        { type: 'shield', value: 40, duration: 2 },
        { type: 'reflect', pct: 25, duration: 2 }
      ],
      description: 'Ele senta no próprio peso e a mina inteira treme junto: volta o tremor, 40 de escudo e 25% do dano devolvido.',
      flavor: 'O clima é a arma dele. Tirá-lo do tremor é metade da luta.', fxKey: 'nova'
    }
  });

  addMonsters({
    'pick-revenant': {
      name: 'Assombro de Picareta', family: 'Turno da Noite', element: 'terra', dungeonId: 'quakemine',
      description: 'O turno da noite nunca subiu. Restou o gesto: um mineiro de poeira compactada que ainda bate na mesma parede, no mesmo ritmo, há mil anos. Bate em você com a mesma técnica — procurando onde racha.',
      flavor: 'Marca primeiro. Cobra depois.',
      hp: 90, pa: 6, pp: 3, initiative: 42, dodge: 10, lock: 24,
      resists: { agua: 25, ar: -15, neutro: 10 },
      spells: ['m-pick-swing', 'm-pick-verdict'], ai: 'melee', traits: [], xp: 46
    },
    'firedamp-wisp': {
      name: 'Fogaréu de Grisu', family: 'Turno da Noite', element: 'fogo', dungeonId: 'quakemine',
      description: 'Uma chama azul e silenciosa boiando à altura do peito, do tamanho de uma cabeça. É o gás da mina que ganhou vontade. Não persegue: espera você entrar na galeria errada.',
      flavor: 'Mate-o longe. Depois lembre disso de novo.',
      hp: 58, pa: 5, pp: 3, initiative: 58, dodge: 22, lock: 6,
      resists: { agua: -30, terra: -10, ar: 30 },
      spells: ['m-firedamp-flare', 'm-firedamp-cloud'], ai: 'ranged',
      traits: [{ type: 'explodeOnDeath', element: 'fogo', damage: 26, radius: 1 }], xp: 36
    },
    'cave-jaw': {
      name: 'Bocarra', family: 'Turno da Noite', element: 'terra', dungeonId: 'quakemine',
      description: 'Um trecho de galeria que virou bicho: dez metros de túnel com dentes de estalactite e um gosto adquirido por carne com capacete. Fica parada até você achar que é caminho.',
      flavor: 'O tanque da mina. E também a porta.',
      hp: 130, pa: 4, pp: 2, initiative: 14, dodge: 0, lock: 44,
      resists: { fogo: 10, agua: 35, ar: -20 },
      spells: ['m-cave-bite', 'm-cave-roar'], ai: 'melee',
      traits: [{ type: 'pushImmune' }, { type: 'enrage', hpPct: 0.5, power: 30 }], xp: 68
    },
    'crystal-chanter': {
      name: 'Cantor de Cristal', family: 'Turno da Noite', element: 'terra', dungeonId: 'quakemine',
      description: 'Um aglomerado de quartzo do tamanho de um homem, crescido dentro de um capacete abandonado. Vibra numa nota baixa e constante que costura a pedra dos companheiros de volta.',
      flavor: 'Bater nele é bater em você mesmo, com atraso.',
      hp: 76, pa: 6, pp: 2, initiative: 38, dodge: 6, lock: 14,
      resists: { fogo: 10, agua: 30, ar: -15 },
      spells: ['m-crystal-chant', 'm-crystal-facet'], ai: 'support',
      traits: [{ type: 'regenAura', value: 9, radius: 2 }], xp: 42
    },
    'sinkhole-worm': {
      name: 'Verme de Abatimento', family: 'Turno da Noite', element: 'terra', dungeonId: 'quakemine',
      description: 'Uma boca circular de anéis que vive sob o piso solto e só mostra o funil. Não anda: reorganiza o chão até que você chegue por gravidade.',
      flavor: 'Ancorado na rocha-mãe: nada o empurra.',
      hp: 84, pa: 6, pp: 1, initiative: 32, dodge: 4, lock: 34,
      resists: { agua: 30, ar: -10 },
      spells: ['m-worm-drag', 'm-worm-spit'], ai: 'ranged',
      traits: [{ type: 'pushImmune' }], xp: 44
    },
    'ore-tumbler': {
      name: 'Rolo de Minério', family: 'Turno da Noite', element: 'terra', dungeonId: 'quakemine',
      description: 'Uma bola de minério bruto do tamanho de um vagonete, lisa de tanto rolar pelos trilhos. Ganha embalo em linha reta e não tem nenhum plano para depois disso.',
      flavor: 'Quebre-o e ele vira duas ladeiras.',
      hp: 100, pa: 4, pp: 3, initiative: 24, dodge: 4, lock: 22,
      resists: { fogo: 10, agua: 30, ar: -15 },
      spells: ['m-tumbler-roll'], ai: 'melee',
      traits: [{ type: 'split', monsterId: 'ore-chip', count: 2 }], xp: 52
    },
    'ore-chip': {
      name: 'Lasca de Veio', family: 'Turno da Noite', element: 'terra', dungeonId: 'quakemine',
      description: 'Um caco de minério com uma veia de metal brilhando no meio, rolando com propósito.',
      flavor: 'Pequeno, denso e sem freio.',
      hp: 32, pa: 3, pp: 3, initiative: 30, dodge: 8, lock: 12,
      resists: { agua: 20, ar: -10 },
      spells: ['m-ore-chip-hit'], ai: 'melee', traits: [], summonOnly: true, xp: 5
    },
    'shaft-bat': {
      name: 'Morcego-de-Poço', family: 'Turno da Noite', element: 'ar', dungeonId: 'quakemine',
      description: 'Asas de couro fino esticadas em ossos longos demais, com um guincho que faz a poeira desenhar o formato do túnel. Mora no poço vertical e desce em espiral.',
      flavor: 'O único aqui que o tremor prejudica. Ele não entendeu isso ainda.',
      hp: 54, pa: 5, pp: 5, initiative: 78, dodge: 34, lock: 4,
      resists: { fogo: -20, terra: 30 },
      spells: ['m-bat-screech', 'm-bat-swoop'], ai: 'melee', traits: [], xp: 30
    },
    'damp-seeper': {
      name: 'Escorrência', family: 'Turno da Noite', element: 'agua', dungeonId: 'quakemine',
      description: 'Uma poça vertical que escorre pela parede contra a gravidade, carregada de mineral dissolvido. Dissolve escudos como dissolveu a rocha que atravessou.',
      flavor: 'Água de mina não mata a sede de ninguém.',
      hp: 68, pa: 5, pp: 3, initiative: 46, dodge: 16, lock: 16,
      resists: { fogo: 30, terra: -15 },
      spells: ['m-seep-drip', 'm-seep-solvent'], ai: 'ranged', traits: [], xp: 38
    },
    'boss-deepknock': {
      name: 'Batepedra, o Que Bate Embaixo', family: 'Turno da Noite', element: 'terra', dungeonId: 'quakemine',
      description: 'A coisa que os mineiros ouviam batendo do outro lado da parede e fingiam ser eco. É maior que a galeria em que está: um torso de rocha-mãe com dois punhos de estéril e nenhum rosto onde procurar intenção. Bate. O mundo responde.',
      flavor: 'GIMMICK — AS TRÊS BATIDAS: A Batida castiga o anel a 2 células (colado nele é seguro), o Desabamento pune quem se afasta, e a Postura de Tremor devolve o clima que o cura. Ou você o tira do tremor, ou aprende a lutar em cima dele.',
      hp: 530, pa: 9, pp: 2, initiative: 40, dodge: 6, lock: 52,
      resists: { fogo: 15, agua: 45, ar: -20 },
      spells: ['m-deep-knock', 'm-rockfall', 'm-vein-call', 'm-quake-stance', 'm-cave-bite'],
      ai: 'boss',
      traits: [{ type: 'pushImmune' }, { type: 'enrage', hpPct: 0.45, power: 40 }],
      boss: true, xp: 795
    }
  });

  // ==========================================================================
  // 6) O CORAÇÃO PARTIDO — Guarda do Coração
  //    Um monstro de cada elemento, mais neutros que anulam. O Mote do Tempo
  //    VIRA O CLIMA sozinho: aqui nenhuma escolha elemental fica confortável.
  // ==========================================================================
  addSpells({
    'm-cinder-lash': {
      name: 'Açoite de Brasa', element: 'fogo', paCost: 3, castsPerTurn: 2, range: [2, 6],
      effects: [{ type: 'damage', element: 'fogo', min: 15, max: 20 }],
      description: 'O arauto estala um chicote de brasa que atravessa a sala partida.',
      flavor: 'Um quarto do Coração ainda arde.', fxKey: 'bolt'
    },
    'm-cinder-brand': {
      name: 'Semear Brasa', element: 'fogo', paCost: 3, cooldown: 2, range: [1, 5],
      needsEmptyTile: true, targetSide: 'any',
      effects: [{ type: 'trap', trapId: 'm-cinder-trap', duration: 3 }],
      description: 'O arauto enterra uma brasa viva na célula: quem pisar nela nos próximos 3 turnos acorda a armadilha.',
      flavor: 'O chão desta sala tem memória e rancor.', fxKey: 'summonFx'
    },
    'm-cinder-trap': {
      name: 'Brasa Acordada', element: 'fogo', paCost: 0, range: [0, 0], los: false,
      shape: 'circle', size: 1, targetSide: 'any',
      effects: [{ type: 'damage', element: 'fogo', min: 22, max: 28 }],
      description: 'A brasa enterrada estoura sob o pé e cospe fogo num círculo de 1 célula. (Armadilha: dispara ao ser pisada, não é conjurada.)',
      flavor: 'Você achou o lugar onde ele plantou.', fxKey: 'nova'
    },
    'm-tide-hymn': {
      name: 'Hino da Maré', element: 'agua', paCost: 3, cooldown: 1, range: [0, 5], targetSide: 'ally',
      effects: [
        { type: 'heal', min: 18, max: 24 },
        { type: 'cleanse', kinds: ['poison', 'root', 'mark'] }
      ],
      description: 'A maré lava o aliado: cura funda e leva embora veneno, raízes e marcas.',
      flavor: 'A água não perdoa: ela só desfaz.', fxKey: 'heal'
    },
    'm-tide-drag': {
      name: 'Ressaca', element: 'agua', paCost: 3, cooldown: 2, range: [0, 0], los: false,
      shape: 'circle', size: 2, targetSide: 'any',
      effects: [{ type: 'pull', tiles: 2 }],
      description: 'A ressaca arrasta 2 células tudo o que estiver num raio de 2 — de volta para o meio da sala partida.',
      flavor: 'Ninguém escolhe onde a maré o deixa.', fxKey: 'nova'
    },
    'm-stone-fist': {
      name: 'Punho de Alicerce', element: 'terra', paCost: 4,
      effects: [{ type: 'damage', element: 'terra', min: 24, max: 30 }],
      description: 'Um punho de fundação desce com o peso de tudo o que ele sustenta.',
      flavor: 'Ele segura o teto. Ele te lembra disso.'
    },
    'm-stone-bulwark': {
      name: 'Baluarte', element: 'terra', paCost: 3, cooldown: 3, range: [0, 0], los: false, targetSide: 'self',
      effects: [{ type: 'shield', value: 35, duration: 2 }, { type: 'taunt', duration: 2 }],
      description: 'O arauto planta os pés e vira parede: 35 de escudo e provocação por 2 turnos.',
      flavor: 'A única porta é ele.', fxKey: 'shieldFx'
    },
    'm-gale-step': {
      name: 'Passo de Vendaval', element: 'ar', paCost: 4, cooldown: 1, range: [1, 5],
      effects: [{ type: 'moveTo', maxTiles: 5 }, { type: 'damage', element: 'ar', min: 16, max: 21 }],
      description: 'O arauto atravessa 5 células como corrente de ar e materializa o corte na chegada.',
      flavor: 'Ele já estava lá quando você decidiu recuar.', fxKey: 'gust'
    },
    'm-gale-cut': {
      name: 'Corte de Corrente', element: 'ar', paCost: 3, castsPerTurn: 2,
      effects: [{ type: 'damage', element: 'ar', min: 14, max: 19 }, { type: 'push', tiles: 2 }],
      description: 'Uma lâmina de ar comprimido corta e devolve o alvo 2 células.',
      flavor: 'A sala partida tem muitas beiradas.'
    },
    'm-null-hush': {
      name: 'Silêncio Zelador', element: 'neutro', paCost: 3, cooldown: 1, range: [1, 6],
      effects: [{ type: 'dispelShield' }, { type: 'damage', element: 'neutro', min: 12, max: 16 }],
      description: 'O zelador apaga a proteção do alvo com um gesto de quem fecha uma janela — e cobra a passagem.',
      flavor: 'Ele não odeia ninguém. Só organiza.', fxKey: 'burst'
    },
    'm-null-mend': {
      name: 'Remendo Zelador', element: 'neutro', paCost: 3, cooldown: 1, range: [0, 5], targetSide: 'ally',
      effects: [
        { type: 'cleanse', kinds: ['poison', 'root', 'mark'] },
        { type: 'regen', min: 8, max: 12, duration: 2 }
      ],
      description: 'Limpa o aliado de tudo o que grudou e deixa um remendo que fecha sozinho por 2 turnos.',
      flavor: 'Zelar é tirar o que não pertence.', fxKey: 'heal'
    },
    'm-mirror-cut': {
      name: 'Corte Espelhado', element: 'neutro', paCost: 4,
      effects: [{ type: 'damage', element: 'neutro', min: 18, max: 24 }],
      description: 'O gêmeo repete o seu último golpe, com a mão trocada.',
      flavor: 'Ele aprendeu isso vendo você.'
    },
    'm-mirror-guard': {
      name: 'Guarda de Espelho', element: 'neutro', paCost: 3, cooldown: 2, range: [0, 0], los: false, targetSide: 'self',
      effects: [{ type: 'shield', value: 20, duration: 2 }, { type: 'reflect', pct: 30, duration: 2 }],
      description: '20 de escudo e 30% do dano recebido volta para o agressor por 2 turnos.',
      flavor: 'Machuque-o depressa ou machuque-se devagar.', fxKey: 'shieldFx'
    },
    'm-sliver-shard': {
      name: 'Estilha', element: 'neutro', paCost: 3,
      effects: [{ type: 'damage', element: 'neutro', min: 9, max: 13 }],
      description: 'Um caco do gêmeo se atira sozinho.',
      flavor: 'Todo espelho quebrado continua olhando.'
    },
    'm-turn-rain': {
      name: 'Virar para a Chuva', element: 'agua', paCost: 3, cooldown: 1, range: [1, 5],
      effects: [
        { type: 'weatherShift', weather: 'chuva' },
        { type: 'damage', element: 'agua', min: 8, max: 11 }
      ],
      description: 'O mote inclina a sala para a água: começa a chover, e ele aproveita para molhar quem estava seco.',
      flavor: 'Ele muda o tempo por diversão. Só isso.', fxKey: 'nova'
    },
    'm-turn-drought': {
      name: 'Virar para a Estiagem', element: 'fogo', paCost: 3, cooldown: 1, range: [1, 5],
      effects: [
        { type: 'weatherShift', weather: 'estiagem' },
        { type: 'damage', element: 'fogo', min: 8, max: 11 }
      ],
      description: 'O mote seca o ar da sala num piscar: estiagem — e uma lambida de calor no alvo.',
      flavor: 'Quem escolheu Água acabou de piorar de vida.', fxKey: 'nova'
    },
    'm-turn-gale': {
      name: 'Virar para o Vendaval', element: 'ar', paCost: 3, cooldown: 1, range: [1, 5],
      effects: [
        { type: 'weatherShift', weather: 'vendaval' },
        { type: 'damage', element: 'ar', min: 8, max: 11 }
      ],
      description: 'O mote abre as fendas do Coração e o vendaval entra rasgando.',
      flavor: 'Três climas, uma criatura, nenhuma vergonha.', fxKey: 'nova'
    },
    'm-heartroot-lash': {
      name: 'Açoite de Raiz', element: 'terra', paCost: 3, castsPerTurn: 2, range: [2, 6],
      effects: [{ type: 'damage', element: 'terra', min: 14, max: 18 }, { type: 'root', duration: 1 }],
      description: 'A raiz-do-coração chicoteia e enterra a ponta no pé do alvo: preso por 1 turno.',
      flavor: 'Ela ainda tenta segurar o Coração inteiro.', fxKey: 'debuff'
    },
    'm-heartroot-grasp': {
      name: 'Agarrar', element: 'terra', paCost: 3, cooldown: 1, range: [2, 5],
      effects: [{ type: 'pull', tiles: 2 }, { type: 'damage', element: 'terra', min: 10, max: 14 }],
      description: 'A raiz enrola o tornozelo e recolhe 2 células.',
      flavor: 'Ela guarda tudo o que consegue puxar.', fxKey: 'hook'
    },
    'm-season-ember': {
      name: 'Estação de Brasa', element: 'fogo', paCost: 4, cooldown: 1, range: [1, 6],
      shape: 'circle', size: 1,
      effects: [
        { type: 'weatherShift', weather: 'estiagem' },
        { type: 'damage', element: 'fogo', min: 20, max: 26 }
      ],
      description: 'O quarto de brasa do Coração bate: a sala seca inteira e um círculo de 1 célula pega fogo.',
      flavor: 'Uma das quatro estações que ele carrega. Nunca a mesma duas vezes seguidas.', fxKey: 'nova'
    },
    'm-season-tide': {
      name: 'Estação de Maré', element: 'agua', paCost: 4, cooldown: 1, range: [1, 6],
      shape: 'circle', size: 1,
      effects: [
        { type: 'weatherShift', weather: 'chuva' },
        { type: 'damage', element: 'agua', min: 20, max: 26 }
      ],
      description: 'O quarto d\'água bate: começa a chover dentro da sala e a área alaga com força de arrebentação.',
      flavor: 'Se você escolheu Fogo, este é o turno de recuar.', fxKey: 'nova'
    },
    'm-season-gale': {
      name: 'Estação de Vendaval', element: 'ar', paCost: 4, cooldown: 1, range: [1, 6], line: true,
      effects: [
        { type: 'weatherShift', weather: 'vendaval' },
        { type: 'damage', element: 'ar', min: 18, max: 24 },
        { type: 'push', tiles: 3 }
      ],
      description: 'O quarto de ar bate: vendaval na sala e uma lâmina reta que arremessa 3 células.',
      flavor: 'A rachadura do Coração é uma boca soprando.', fxKey: 'gust'
    },
    'm-season-quake': {
      name: 'Estação de Tremor', element: 'terra', paCost: 4, cooldown: 1, range: [0, 0], los: false,
      shape: 'ring', size: 2, targetSide: 'any',
      effects: [
        { type: 'weatherShift', weather: 'tremor' },
        { type: 'damage', element: 'terra', min: 22, max: 28 },
        { type: 'root', duration: 1 }
      ],
      description: 'O quarto de pedra bate: a mina do mundo inteiro treme e o anel a 2 células racha e prende.',
      flavor: 'A Lousa desce mais um palmo a cada batida dessas.', fxKey: 'nova'
    },
    'm-shard-storm': {
      name: 'Tempestade de Cacos', element: 'neutro', paCost: 4, cooldown: 2, range: [1, 6],
      effects: [{ type: 'chain', jumps: 3, falloff: 0.7, element: 'neutro', min: 14, max: 18 }],
      description: 'Cacos do próprio Coração saltam de inimigo em inimigo, até 3 saltos, perdendo força a cada um.',
      flavor: 'Ele se despedaça um pouco a cada vez. Não parece se importar.', fxKey: 'beam'
    },
    'm-mend-rift': {
      name: 'Cerzir a Fenda', element: 'neutro', paCost: 3, cooldown: 3, range: [0, 0], los: false, targetSide: 'self',
      effects: [{ type: 'heal', min: 30, max: 40 }, { type: 'shield', value: 40, duration: 2 }],
      description: 'O Coração puxa as próprias bordas e se costura: cura funda e 40 de escudo.',
      flavor: 'Mil anos rachando e ele ainda tenta.', fxKey: 'heal'
    },
    'm-splinter-call': {
      name: 'Chamar Estilhas', element: 'neutro', paCost: 3, cooldown: 1, range: [1, 4],
      needsEmptyTile: true, targetSide: 'any',
      effects: [{ type: 'summon', monsterId: 'mirror-sliver' }],
      description: 'Um caco se desprende do Coração e cai de pé, já com raiva.',
      flavor: 'Cada estilha lembra de ter sido inteira.', fxKey: 'summonFx'
    },
    'm-sum-familiar-bite': {
      name: 'Dentada do Familiar', element: 'neutro', paCost: 3,
      effects: [{ type: 'damage', element: 'neutro', min: 7, max: 10 }],
      description: 'O familiar morde com a convicção de quem não tem nome a zelar.',
      flavor: 'Nome é compromisso. Ele só tem dentes.'
    },
    'm-sum-hound-bite': {
      name: 'Mordida Quente', element: 'fogo', paCost: 3, castsPerTurn: 2,
      effects: [{ type: 'damage', element: 'fogo', min: 9, max: 12 }],
      description: 'O cão de brasa morde e deixa a marca do ferro em brasa.',
      flavor: 'Abana o rabo. O rabo acende o chão.'
    },
    'm-sum-colossus-smash': {
      name: 'Malho de Magma', element: 'fogo', paCost: 4,
      effects: [{ type: 'damage', element: 'fogo', min: 22, max: 29 }],
      description: 'O colosso desce o braço fundido como quem fecha um portão.',
      flavor: 'Ninguém o convidava desde a Lousa.'
    },
    'm-sum-colossus-eruption': {
      name: 'Erupção', element: 'fogo', paCost: 4, cooldown: 2, range: [1, 4],
      shape: 'circle', size: 1,
      effects: [
        { type: 'damage', element: 'fogo', min: 15, max: 20 },
        { type: 'poison', element: 'fogo', min: 4, max: 7, duration: 2 }
      ],
      description: 'O chão abre num círculo de 1 célula e cospe magma que continua queimando.',
      flavor: 'O calor dele é que muda o clima da sala.', fxKey: 'nova'
    },
    'm-sum-nymph-mend': {
      name: 'Mão de Maré', element: 'agua', paCost: 3, castsPerTurn: 2, range: [0, 4], targetSide: 'ally',
      effects: [{ type: 'heal', min: 10, max: 13 }],
      description: 'A ninfa toca a ferida do aliado e a água decide fechá-la.',
      flavor: 'Ela nunca fala. Só olha para quem está sangrando e resolve.', fxKey: 'heal'
    },
    'm-sum-nymph-veil': {
      name: 'Véu de Água', element: 'agua', paCost: 2, cooldown: 1, range: [0, 4], targetSide: 'ally',
      effects: [{ type: 'shield', value: 13, duration: 2 }],
      description: 'Uma película de água parada envolve o aliado: 13 de escudo por 2 turnos.',
      flavor: 'Água parada aguenta mais do que água brava.', fxKey: 'shieldFx'
    },
    'm-sum-sentinel-slam': {
      name: 'Pancada de Sentinela', element: 'terra', paCost: 3,
      effects: [{ type: 'damage', element: 'terra', min: 10, max: 13 }],
      description: 'A sentinela bate uma vez, com o peso todo, sem sair do lugar.',
      flavor: 'Fica onde foi posta.'
    },
    'm-sum-sentinel-guard': {
      name: 'Postar-se', element: 'terra', paCost: 2, cooldown: 2, range: [0, 0], los: false, targetSide: 'self',
      effects: [{ type: 'shield', value: 18, duration: 2 }, { type: 'taunt', duration: 2 }],
      description: 'A sentinela crava os pés e chama o corredor inteiro para si: 18 de escudo e provocação.',
      flavor: 'O tampão de corredor do invocador.', fxKey: 'shieldFx'
    },
    'm-sum-golem-fist': {
      name: 'Punho da Montanha', element: 'terra', paCost: 4,
      effects: [{ type: 'damage', element: 'terra', min: 24, max: 31 }],
      description: 'Um punho do tamanho de uma porta desce com a paciência de uma encosta.',
      flavor: 'Ele só perguntou se a montanha topava dar uns passos.'
    },
    'm-sum-golem-quake': {
      name: 'Passo de Montanha', element: 'terra', paCost: 4, cooldown: 2, range: [1, 2],
      shape: 'cross', size: 1,
      effects: [{ type: 'damage', element: 'terra', min: 17, max: 22 }, { type: 'root', duration: 1 }],
      description: 'Um passo só, e a cruz ao redor racha: dano em área e pés presos por 1 turno.',
      flavor: 'A montanha não corre. A montanha chega.', fxKey: 'nova'
    },
    'm-sum-drowned-drag': {
      name: 'Braçada Funda', element: 'agua', paCost: 3, castsPerTurn: 1, range: [1, 4],
      effects: [{ type: 'damage', element: 'agua', min: 17, max: 23 }, { type: 'pull', tiles: 2 }],
      description: 'O braço pesado alcança longe e traz o alvo 2 células para perto.',
      flavor: 'Não puxa para matar. Puxa para não ficar sozinho.'
    },
    'm-sum-drowned-weight': {
      name: 'Peso de Água', element: 'agua', paCost: 4, castsPerTurn: 1, range: [1, 1],
      effects: [{ type: 'damage', element: 'agua', min: 22, max: 29 }, { type: 'root', duration: 1 }],
      description: 'Despeja o próprio corpo sobre quem está colado: dói e prende no chão por um turno.',
      flavor: 'Afogar é uma questão de paciência.'
    },
    'm-sum-eye-gale': {
      name: 'Ventania Curta', element: 'ar', paCost: 3, castsPerTurn: 1, range: [1, 3],
      aoe: { shape: 'circle', size: 2 },
      effects: [{ type: 'damage', element: 'ar', min: 17, max: 23 }, { type: 'push', tiles: 2 }],
      description: 'Abre os braços e o que estiver em volta volta 2 células, machucado.',
      flavor: 'Ele não expulsa por raiva. Expulsa por hábito.'
    },
    'm-sum-eye-calm': {
      name: 'Miolo Parado', element: 'ar', paCost: 4, castsPerTurn: 1, range: [0, 2], targetSide: 'ally',
      effects: [{ type: 'shield', value: 34, duration: 2 }],
      description: 'Dentro da espiral o vento não bate: quem estiver perto ganha 34 de escudo por 2 turnos.',
      flavor: 'No meio da tempestade há um lugar parado.'
    },
    'm-sum-falcon-strike': {
      name: 'Bicada de Tormenta', element: 'ar', paCost: 3, castsPerTurn: 2,
      effects: [{ type: 'damage', element: 'ar', min: 10, max: 13 }, { type: 'push', tiles: 2 }],
      description: 'O bico acerta com o vento junto e devolve o alvo 2 células.',
      flavor: 'Não existe céu para ele voar. Voa assim mesmo, de raiva.'
    },
    'm-sum-falcon-dive': {
      name: 'Mergulho', element: 'ar', paCost: 4, cooldown: 1, range: [1, 5],
      effects: [{ type: 'moveTo', maxTiles: 5 }, { type: 'damage', element: 'ar', min: 8, max: 12 }],
      description: 'O falcão fecha as asas, atravessa até 5 células e abre as garras no fim.',
      flavor: 'Chega antes de todo mundo, inclusive do plano.', fxKey: 'gust'
    }
  });

  addMonsters({
    'cinder-herald': {
      name: 'Arauto de Brasa', family: 'Guarda do Coração', element: 'fogo', dungeonId: 'brokenheart',
      description: 'Um dos quatro pedaços do Coração que ganharam corpo. Este é uma armadura vazia com uma fresta acesa no peito, que semeia brasas no chão como quem prepara a casa para visitas.',
      flavor: 'Ele não persegue. Ele prepara o terreno.',
      hp: 95, pa: 6, pp: 3, initiative: 55, dodge: 16, lock: 20,
      resists: { agua: -25, ar: 40, neutro: 10 },
      spells: ['m-cinder-lash', 'm-cinder-brand'], ai: 'ranged', traits: [], xp: 50
    },
    'tide-herald': {
      name: 'Arauto de Maré', family: 'Guarda do Coração', element: 'agua', dungeonId: 'brokenheart',
      description: 'A mesma armadura, cheia de água escura em movimento. Cura os irmãos e reorganiza o campo com ressacas curtas e certeiras.',
      flavor: 'Enquanto ela viver, os outros três não morrem direito.',
      hp: 95, pa: 6, pp: 3, initiative: 48, dodge: 16, lock: 18,
      resists: { fogo: 40, terra: -20, neutro: 10 },
      spells: ['m-tide-hymn', 'm-tide-drag', 'm-salt-lance'], ai: 'support',
      traits: [{ type: 'regenAura', value: 9, radius: 2 }], xp: 52
    },
    'stone-herald': {
      name: 'Arauto de Alicerce', family: 'Guarda do Coração', element: 'terra', dungeonId: 'brokenheart',
      description: 'A armadura preenchida por fundação: pedra, cal e uma teimosia de mil anos. Fica entre você e o resto da sala e considera isso um trabalho honesto.',
      flavor: 'Provoca, aguenta e não sai do lugar.',
      hp: 140, pa: 5, pp: 2, initiative: 22, dodge: 2, lock: 46,
      resists: { fogo: 10, agua: 40, ar: -25 },
      spells: ['m-stone-fist', 'm-stone-bulwark'], ai: 'melee',
      traits: [{ type: 'pushImmune' }, { type: 'enrage', hpPct: 0.5, power: 30 }], xp: 70
    },
    'gale-herald': {
      name: 'Arauto de Vendaval', family: 'Guarda do Coração', element: 'ar', dungeonId: 'brokenheart',
      description: 'A armadura vazia de verdade — só o vento dentro dela é que a mantém de pé, e o vento tem pressa. Chega, corta e já está em outro lugar.',
      flavor: 'Difícil de prender, pior de acertar.',
      hp: 90, pa: 6, pp: 5, initiative: 82, dodge: 36, lock: 12,
      resists: { fogo: -20, terra: 40 },
      spells: ['m-gale-step', 'm-gale-cut'], ai: 'melee', traits: [], xp: 50
    },
    'null-warden': {
      name: 'Zelador Nulo', family: 'Guarda do Coração', element: 'neutro', dungeonId: 'brokenheart',
      description: 'O funcionário que sobrou: um vulto cinzento de avental, sem elemento nenhum, que apaga proteções alheias e remenda as dos irmãos. Nenhum clima o ajuda; nenhum clima o atrapalha.',
      flavor: 'A resposta do Coração para quem se escondeu atrás de escudos.',
      hp: 100, pa: 6, pp: 3, initiative: 44, dodge: 14, lock: 22,
      resists: { neutro: 25 },
      spells: ['m-null-hush', 'm-null-mend'], ai: 'support', traits: [], xp: 54
    },
    'mirror-twin': {
      name: 'Gêmeo-Espelho', family: 'Guarda do Coração', element: 'neutro', dungeonId: 'brokenheart',
      description: 'Um caco de espelho do tamanho de uma pessoa que anda de lado e mostra, com um turno de atraso, a sua própria silhueta batendo em você. Quebrá-lo só cria mais superfícies refletoras.',
      flavor: 'Bater com força é a pior ideia disponível.',
      hp: 110, pa: 5, pp: 3, initiative: 40, dodge: 18, lock: 20,
      resists: { neutro: 20 },
      spells: ['m-mirror-cut', 'm-mirror-guard'], ai: 'melee',
      traits: [{ type: 'split', monsterId: 'mirror-sliver', count: 2 }], xp: 58
    },
    'mirror-sliver': {
      name: 'Estilha-Espelho', family: 'Guarda do Coração', element: 'neutro', dungeonId: 'brokenheart',
      description: 'Um caco menor, mais afiado, com metade do seu rosto ainda preso na superfície.',
      flavor: 'Ao se despedaçar, corta quem está perto.',
      hp: 36, pa: 3, pp: 3, initiative: 52, dodge: 16, lock: 10,
      resists: { neutro: 15 },
      spells: ['m-sliver-shard'], ai: 'melee',
      traits: [{ type: 'explodeOnDeath', element: 'neutro', damage: 14, radius: 1 }],
      summonOnly: true, xp: 5
    },
    'weather-mote': {
      name: 'Mote do Tempo', family: 'Guarda do Coração', element: 'ar', dungeonId: 'brokenheart',
      description: 'Uma bolinha de ar comprimido do tamanho de um punho, girando devagar, com um pedacinho de céu velho preso dentro. É o que sobrou do clima do mundo antigo — e ele brinca com isso.',
      flavor: 'GIMMICK: ele muda o clima da sala sozinho. Sua escolha elemental vira sorteio.',
      hp: 70, pa: 6, pp: 4, initiative: 74, dodge: 32, lock: 6,
      resists: { fogo: -15, terra: 30, neutro: 10 },
      spells: ['m-turn-rain', 'm-turn-drought', 'm-turn-gale'], ai: 'ranged', traits: [], xp: 46
    },
    'heartroot': {
      name: 'Raiz-do-Coração', family: 'Guarda do Coração', element: 'terra', dungeonId: 'brokenheart',
      description: 'Uma raiz grossa que saiu da parede e atravessou o salão para abraçar o Coração e mantê-lo colado. Falhou. Continua tentando, e agarra qualquer coisa que passe perto.',
      flavor: 'Enraizada de verdade: não empurre, corte.',
      hp: 88, pa: 6, pp: 1, initiative: 26, dodge: 2, lock: 36,
      resists: { fogo: -20, agua: 35, ar: -10 },
      spells: ['m-heartroot-lash', 'm-heartroot-grasp'], ai: 'ranged',
      traits: [{ type: 'pushImmune' }], xp: 46
    },
    'boss-riftheart': {
      name: 'O Coração Partido', family: 'Guarda do Coração', element: 'neutro', dungeonId: 'brokenheart',
      description: 'O último Coração do mundo enterrado, rachado em quatro quartos que ainda batem fora de compasso — um de brasa, um d\'água, um de pedra, um de ar. Cada batida joga a sala inteira para um clima diferente. Ele não guarda o Fecho: ele É o que sobrou do céu, e está morrendo alto.',
      flavor: 'GIMMICK — AS QUATRO ESTAÇÕES: cada turno ele bate um quarto diferente e TROCA O CLIMA junto com o golpe. O elemento que te curava passa a te matar de 5 em 5 PV. Vencer é jogar com o clima do inimigo — e cerzir a fenda dele antes que ele cerza.',
      hp: 600, pa: 10, pp: 3, initiative: 70, dodge: 18, lock: 55,
      resists: { fogo: 15, agua: 15, terra: 15, ar: 15, neutro: 30 },
      spells: ['m-season-ember', 'm-season-tide', 'm-season-gale', 'm-season-quake',
               'm-shard-storm', 'm-mend-rift', 'm-splinter-call'],
      ai: 'boss',
      traits: [{ type: 'pushImmune' }, { type: 'enrage', hpPct: 0.5, power: 45 }],
      boss: true, xp: 900
    }
  });

  // ==========================================================================
  // 7) REBANHOS INVOCÁVEIS (sem calabouço) — disponíveis para efeitos
  //    `summon` de feitiços de CLASSE (Invocador etc.). Não nascem em sala.
  //    Criativo Classes: use estes ids em { type:'summon', monsterId:'...' }.
  // ==========================================================================
  addMonsters({
    'sporeling': {
      name: 'Esporinho', family: 'Rebanho do Invocador', element: 'terra', dungeonId: null,
      description: 'Um cogumelo-bebê com olhos grandes demais e lealdade maior ainda. Morde, envenena e, ao cair, estoura numa nuvem de esporos vingativa.',
      flavor: 'Corpo, dano retardado e negação de célula num pacote só.',
      hp: 35, pa: 3, pp: 3, initiative: 50, dodge: 14, lock: 10,
      resists: { fogo: -10, agua: 10, ar: -15 },
      spells: ['m-spore-nip'], ai: 'melee',
      traits: [{ type: 'explodeOnDeath', element: 'terra', damage: 10, radius: 1 }],
      summonOnly: true, xp: 0
    },
    // --- Invocações do INVOCADOR (ids fixados pelo Criativo Classes) --------
    'sum-familiar': {
      name: 'Familiar', family: 'Rebanho do Invocador', element: 'neutro', dungeonId: null,
      description: 'Um bicho pequeno e sem nome que o invocador chama desde o primeiro dia: quatro patas, dentes tortos e uma lealdade que ninguém pediu. Corpo a mais para morder, tancar e negar passagem.',
      flavor: 'Ele nunca diz o nome do bicho. Diz que nome é compromisso.',
      hp: 40, pa: 3, pp: 3, initiative: 50, dodge: 14, lock: 14,
      resists: { neutro: 10 },
      spells: ['m-sum-familiar-bite'], ai: 'melee', traits: [], summonOnly: true, xp: 0
    },
    'sum-ember-hound': {
      name: 'Cão de Brasa', family: 'Rebanho do Invocador', element: 'fogo', dungeonId: null,
      description: 'Um cão de carvão aceso, magro e rápido, com uma costura de fogo correndo do focinho ao rabo. Morde quente e, quando cai, devolve a última brasa em quem estiver por perto.',
      flavor: 'Abana o rabo. O rabo acende o chão.',
      hp: 48, pa: 4, pp: 5, initiative: 72, dodge: 24, lock: 10,
      resists: { agua: -25, ar: 30 },
      spells: ['m-sum-hound-bite'], ai: 'melee',
      traits: [{ type: 'explodeOnDeath', element: 'fogo', damage: 20, radius: 1 }],
      summonOnly: true, xp: 0
    },
    'sum-magma-colossus': {
      name: 'Colosso de Magma', family: 'Rebanho do Invocador', element: 'fogo', dungeonId: null,
      description: 'Quatro metros de rocha derretida presa numa forma que lembra vagamente um corpo. Anda devagar porque cada passo abre uma fissura, e o calor que ele emana seca a sala inteira.',
      flavor: 'O Coração do Fecho de Brasa tem um irmão mais velho. (Invocação de nível 30.)',
      hp: 160, pa: 5, pp: 2, initiative: 30, dodge: 0, lock: 44,
      resists: { agua: -30, terra: 20, ar: 45 },
      spells: ['m-sum-colossus-smash', 'm-sum-colossus-eruption'], ai: 'melee',
      traits: [{ type: 'pushImmune' }, { type: 'enrage', hpPct: 0.4, power: 30 }],
      summonOnly: true, xp: 0
    },
    'sum-tide-nymph': {
      name: 'Ninfa da Maré', family: 'Rebanho do Invocador', element: 'agua', dungeonId: null,
      description: 'Uma silhueta de água limpa, do tamanho de uma criança, que flutua um palmo acima do chão e vai direto até quem está sangrando. Não ataca nunca; não é para isso que foi chamada.',
      flavor: 'Ela nunca fala. Só olha para quem está sangrando e resolve.',
      hp: 44, pa: 5, pp: 3, initiative: 56, dodge: 20, lock: 6,
      resists: { fogo: 30, terra: -15 },
      spells: ['m-sum-nymph-mend', 'm-sum-nymph-veil'], ai: 'support', traits: [], summonOnly: true, xp: 0
    },
    'sum-stone-sentinel': {
      name: 'Sentinela de Pedra', family: 'Rebanho do Invocador', element: 'terra', dungeonId: null,
      description: 'Um bloco de rocha vertical com dois sulcos por olhos, plantado onde o invocador mandar. Lenta, dura e teimosa: existe para que um corredor deixe de ser corredor.',
      flavor: 'Fica onde foi posta. É a coisa mais confiável do mundo enterrado.',
      hp: 90, pa: 3, pp: 1, initiative: 16, dodge: 0, lock: 38,
      resists: { fogo: 10, agua: 35, ar: -15 },
      spells: ['m-sum-sentinel-slam', 'm-sum-sentinel-guard'], ai: 'melee',
      traits: [{ type: 'pushImmune' }], summonOnly: true, xp: 0
    },
    'sum-mountain-golem': {
      name: 'Golem da Montanha', family: 'Rebanho do Invocador', element: 'terra', dungeonId: null,
      description: 'Uma encosta inteira que concordou em levantar e dar uns passos. Tem árvores mortas nas costas e um veio de água correndo pelo ombro. Nada no mundo enterrado é mais duro do que ele.',
      flavor: 'Ele não invocou a montanha. Só perguntou se ela topava. (Invocação de nível 30.)',
      hp: 220, pa: 5, pp: 2, initiative: 20, dodge: 0, lock: 50,
      resists: { fogo: 20, agua: 50, ar: -15 },
      spells: ['m-sum-golem-fist', 'm-sum-golem-quake'], ai: 'melee',
      traits: [{ type: 'pushImmune' }, { type: 'enrage', hpPct: 0.4, power: 30 }],
      summonOnly: true, xp: 0
    },
    // AS DUAS DE NIVEL 30 QUE FALTAVAM (v3), com arte do usuario.
    'sum-drowned-cistern': {
      name: 'Afogado da Cisterna', family: 'Rebanho do Invocador', element: 'agua', dungeonId: null,
      description: 'Um corpo alto e encharcado, de ombros caídos, feito de água escura que não escorre. Onde devia haver rosto há um vazio, e dentro do tronco adivinham-se outros: mãos, ombros, meio rosto pressionados contra a superfície por dentro. Ninguém conseguiu contar quantos são.',
      flavor: 'A cisterna devolve o que engoliu. Nunca um de cada vez.',
      hp: 150, pa: 5, pp: 2, initiative: 26, dodge: 4, lock: 40,
      resists: { fogo: 30, terra: -15 },
      spells: ['m-sum-drowned-drag', 'm-sum-drowned-weight'], ai: 'melee', traits: [], summonOnly: true, xp: 0
    },
    'sum-storm-eye': {
      name: 'Olho da Tormenta', family: 'Rebanho do Invocador', element: 'ar', dungeonId: null,
      description: 'Uma figura de pé, de braços abertos, envolta numa espiral de vento que sobe do chão e se alarga acima da cabeça. O rosto é sereno e olha para baixo. Os pés ficam onde foram postos: ele não anda, e tudo o que chega perto volta.',
      flavor: 'No meio da tempestade há um lugar parado. É onde ele mora.',
      hp: 120, pa: 5, pp: 0, initiative: 34, dodge: 8, lock: 30,
      resists: { terra: 30, fogo: -15 },
      spells: ['m-sum-eye-gale', 'm-sum-eye-calm'], ai: 'ranged', traits: [{ type: 'pushImmune' }], summonOnly: true, xp: 0
    },
    'sum-storm-falcon': {
      name: 'Falcão da Tormenta', family: 'Rebanho do Invocador', element: 'ar', dungeonId: null,
      description: 'Um falcão de penas cinzentas com relâmpago velho preso entre elas. Voa em círculos apertados sobre a batalha e desce quando decide, não quando mandam.',
      flavor: 'Não existe céu para ele voar. Voa assim mesmo, de raiva.',
      hp: 40, pa: 4, pp: 6, initiative: 88, dodge: 34, lock: 6,
      resists: { fogo: -15, terra: 30 },
      spells: ['m-sum-falcon-strike', 'm-sum-falcon-dive'], ai: 'melee', traits: [], summonOnly: true, xp: 0
    }
  });

// __FIM_DOS_BLOCOS__ (novos blocos entram acima desta linha)
})(JOGO.DATA);
