// O ECO PRIMORDIAL — o chefe supremo da semana (dono: dados).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});
JOGO.DATA = JOGO.DATA || {};

/* O QUE ISTO É (02/10, a lista do dono antes de divulgar o jogo: "um mapa BEM
 * difícil com chefe supremo e placar de quem tirou mais dano")
 * ============
 * O Eco Primordial é a primeira voz do mundo enterrado: uma entidade colossal
 * feita de pedaços dos seis calabouços — cristal, coral, rocha, lava e vento
 * preso em correntes — com um núcleo pulsando no peito. Ele não anda: ocupa
 * 2×2 casas no centro da Câmara do Eco (js/core/data/arenas.js) e a tentativa
 * dura 12 rodadas ou até o grupo cair. O PLACAR é o dano que o grupo tirou dele,
 * refeito pelo juiz do servidor (servidor/juiz/supremo.js) — nunca o número que
 * o navegador mostrou.
 *
 * AS QUATRO FASES. A cada 25% da vida perdida ele troca de elemento, na ordem
 * Fogo → Água → Terra → Ar, e a resistência troca junto pela RODA (DATA.beats,
 * elements.js): resiste ao que o elemento da fase vence e fica FRACO a quem o
 * vence — a mesma convenção do bestiário inteiro. Na troca ele chama dois Ecos
 * Menores do elemento novo e passa a usar os feitiços da fase.
 *
 * O GOLPE GRANDE é AVISADO: no fim de uma vez dele as casas que vão explodir
 * ficam marcadas no chão, e o golpe só cai no começo da vez seguinte dele — o
 * grupo inteiro joga uma rodada sabendo onde não estar. Cada fase tem o seu
 * desenho (o `padrao`, lido pelo motor em engine.js, "O ECO PRIMORDIAL").
 *
 * POR QUE O ELENCO MORA FORA DE DATA.monsters. Tudo que lê o bestiário
 * enxergaria o Eco: o Poço sorteia chefe de DATA.monsters (e largaria um corpo
 * 2×2 numa casa de chefe 1×1), a régua do bestiário cobra seis chefes de
 * calabouço com 300 a 600 de vida, a wiki lista "os chefes" por calabouço. O
 * Eco não é de calabouço nenhum e não cai em sala nenhuma: o motor o acha por
 * Engine.monster, que também olha aqui, e a régua dele é a de
 * tests/validate_world.html (seção do Eco).
 *
 * OS NÚMEROS SÃO PONTO DE PARTIDA, medidos em tests/eco_motor.js (a dupla de
 * nível 30 jogada pela IA tira ~1/3 da vida em 12 rodadas: derrubar exige jogar
 * bem de verdade). O dono troca aqui; o juiz lê o MESMO arquivo, e qualquer
 * mudança daqui sobe Engine.VERSAO_REGRAS (o resultado de uma tentativa refeita
 * muda). */
(function (DATA) {
  'use strict';

  DATA.monsterSpells = DATA.monsterSpells || {};

  /* a mesma fábrica de js/core/data/monsters.js (sp): o formato do contrato §3,
   * com los:true por padrão — feitiço com alcance > 0 sem visão é proibido */
  function sp(o, id) {
    var r = o.range || [1, 1];
    return {
      id: id, name: o.name, element: o.element, classId: null, unlockLevel: 0,
      paCost: o.paCost, cooldown: o.cooldown || 0,
      castsPerTurn: (o.castsPerTurn === undefined) ? 1 : o.castsPerTurn,
      range: { min: r[0], max: r[1], line: !!o.line, los: (o.los === false ? false : true), movable: false },
      aoe: { shape: o.shape || 'single', size: o.size || 0 },
      needsEmptyTile: !!o.needsEmptyTile, targetSide: o.targetSide || 'enemy',
      effects: o.effects, description: o.description, flavor: o.flavor || '', fxKey: o.fxKey || 'slam'
    };
  }
  var FEITICOS = {
    // ---- o Eco: um golpe neutro de sempre + dois por fase
    'm-eco-pulso': {
      name: 'Pulso do Núcleo', element: 'neutro', paCost: 3, range: [1, 7],
      effects: [{ type: 'damage', element: 'neutro', min: 16, max: 22 }],
      description: 'O núcleo no peito do Eco bate uma vez e a batida atravessa a câmara até quem ele escolheu.',
      flavor: 'O primeiro som do mundo enterrado. Ainda ecoa.', fxKey: 'beam'
    },
    'm-eco-brasa': {
      name: 'Lava Primeira', element: 'fogo', paCost: 4, cooldown: 1, range: [1, 6],
      shape: 'circle', size: 1,
      effects: [{ type: 'damage', element: 'fogo', min: 22, max: 28 }],
      description: 'Uma das fendas de lava do Eco se abre e cospe um círculo de 1 casa em brasa.',
      flavor: 'A lava do Fecho veio daqui.', fxKey: 'nova'
    },
    'm-eco-centelha': {
      name: 'Centelha Antiga', element: 'fogo', paCost: 2, castsPerTurn: 2, range: [2, 7],
      effects: [{ type: 'damage', element: 'fogo', min: 12, max: 16 }],
      description: 'Uma fagulha velha como o fundo salta do peito do Eco direto num herói.',
      flavor: 'Quente ainda, depois de tudo.', fxKey: 'bolt'
    },
    'm-eco-mare': {
      name: 'Maré Primeira', element: 'agua', paCost: 4, cooldown: 1, range: [1, 5],
      shape: 'line', size: 4,
      effects: [{ type: 'damage', element: 'agua', min: 20, max: 26 }],
      description: 'O coral do Eco racha e uma linha de 4 casas de água escura corre pelo chão.',
      flavor: 'A Cisterna é só o que sobrou desta maré.', fxKey: 'gust'
    },
    'm-eco-gota': {
      name: 'Gota de Coral', element: 'agua', paCost: 2, castsPerTurn: 2, range: [2, 7],
      effects: [{ type: 'damage', element: 'agua', min: 12, max: 16 }],
      description: 'Um caco de coral cheio d\'água estoura no herói que o Eco escolheu.',
      flavor: 'Afiado como o sal.', fxKey: 'bolt'
    },
    'm-eco-rocha': {
      name: 'Rocha Primeira', element: 'terra', paCost: 4, cooldown: 1, range: [1, 5],
      shape: 'cross', size: 1,
      effects: [{ type: 'damage', element: 'terra', min: 24, max: 30 }],
      description: 'Um punho de rocha do Eco desce sobre uma cruz de 1 casa.',
      flavor: 'O alicerce do mundo tem dono.', fxKey: 'nova'
    },
    'm-eco-lasca': {
      name: 'Lasca de Cristal', element: 'terra', paCost: 2, castsPerTurn: 2, range: [2, 7],
      effects: [{ type: 'damage', element: 'terra', min: 12, max: 16 }],
      description: 'Um cristal do ombro do Eco se solta e voa reto num herói.',
      flavor: 'Cada lasca dele é uma mina inteira.', fxKey: 'bolt'
    },
    'm-eco-vento': {
      name: 'Corrente Solta', element: 'ar', paCost: 4, cooldown: 1, range: [1, 6],
      effects: [{ type: 'chain', jumps: 2, falloff: 0.7, element: 'ar', min: 18, max: 22 }],
      description: 'Uma das correntes que prendem o vento ao Eco se solta e salta de herói em herói, 2 saltos.',
      flavor: 'O vento preso quer sair. Sai por você.', fxKey: 'beam'
    },
    'm-eco-corte': {
      name: 'Corte de Corrente', element: 'ar', paCost: 2, castsPerTurn: 2, range: [1, 3],
      effects: [{ type: 'damage', element: 'ar', min: 11, max: 15 }, { type: 'push', tiles: 1 }],
      description: 'Uma lâmina de vento corta o herói e o empurra uma casa para longe do Eco.',
      flavor: 'Ele não quer ninguém perto do núcleo.', fxKey: 'gust'
    },
    // ---- os Ecos Menores: um golpe cada, do elemento deles
    'm-eco-menor-brasa': {
      name: 'Faísca Menor', element: 'fogo', paCost: 3, castsPerTurn: 2, range: [2, 5],
      effects: [{ type: 'damage', element: 'fogo', min: 12, max: 16 }],
      description: 'O Eco Menor de brasa atira um pedaço da própria lava.',
      flavor: 'Ele repete o maior, mais baixo.', fxKey: 'bolt'
    },
    'm-eco-menor-mare': {
      name: 'Respingo Menor', element: 'agua', paCost: 3, castsPerTurn: 2, range: [1, 4],
      effects: [{ type: 'damage', element: 'agua', min: 11, max: 15 }],
      description: 'O Eco Menor de coral espirra água salgada no herói mais perto.',
      flavor: 'Um respingo da maré de antes.', fxKey: 'bolt'
    },
    'm-eco-menor-rocha': {
      name: 'Batida Menor', element: 'terra', paCost: 4, range: [1, 1],
      effects: [{ type: 'damage', element: 'terra', min: 20, max: 26 }],
      description: 'O Eco Menor de rocha bate com o corpo inteiro em quem estiver colado.',
      flavor: 'Pouco, mas pesado.', fxKey: 'slam'
    },
    'm-eco-menor-vento': {
      name: 'Rajada Menor', element: 'ar', paCost: 3, castsPerTurn: 2, range: [1, 2],
      effects: [{ type: 'damage', element: 'ar', min: 10, max: 14 }, { type: 'push', tiles: 1 }],
      description: 'O Eco Menor de vento sopra forte: corta e empurra uma casa.',
      flavor: 'Um fio do vento que o maior prende.', fxKey: 'gust'
    }
  };
  for (var fid in FEITICOS) {
    if (Object.prototype.hasOwnProperty.call(FEITICOS, fid)) DATA.monsterSpells[fid] = sp(FEITICOS[fid], fid);
  }

  /* o formato NORMALIZADO de DATA.monsters (o `mon()` de monsters.js já
   * escrito): resistências com as cinco chaves, pedras nulas (o Eco paga pelo
   * placar, não por saque) e xp 0 */
  function res(o) {
    var r = { fogo: 0, agua: 0, terra: 0, ar: 0, neutro: 0 };
    for (var k in o) if (Object.prototype.hasOwnProperty.call(r, k)) r[k] = o[k];
    return r;
  }
  function menor(id, nome, el, desc, st, feitico, ai, resists) {
    return {
      id: id, name: nome, family: 'Ecos do Fundo', element: el, dungeonId: null,
      description: desc, flavor: 'Chamado na troca de fase do Eco Primordial.',
      stats: { hp: st[0], pa: st[1], pp: st[2], initiative: st[3], power: st[4], dodge: st[5], lock: st[6],
               resists: res(resists) },
      spells: [feitico], ai: ai, traits: [], boss: false, summonOnly: true, xp: 0, stoneDrop: null
    };
  }

  DATA.ecoMonstros = {
    eco_primordial: {
      id: 'eco_primordial', name: 'O Eco Primordial', family: 'Ecos do Fundo', element: 'fogo', dungeonId: null,
      description: 'A primeira voz do mundo enterrado. Um colosso montado com pedaços dos seis calabouços — cristal, ' +
                   'coral, rocha, lava e vento preso em correntes — e um núcleo que pulsa no peito. Não anda: o mundo ' +
                   'é que gira em volta dele.',
      flavor: 'Cada 25% de vida perdida, um elemento novo; cada golpe grande, avisado no chão uma rodada antes.',
      // `porte`: o lado do quadrado que ele ocupa (2×2). O motor lê isto (engine.js, porteDe).
      porte: 2,
      stats: { hp: 6000, pa: 8, pp: 0, initiative: 40, power: 40, dodge: 0, lock: 35,
               // a da fase entra por cima (engine.js, aplicaFaseEco); o neutro fica
               resists: res({ neutro: 10 }) },
      spells: ['m-eco-pulso'], ai: 'boss',
      // pushImmune por escrito, além da regra do motor (corpo grande não é empurrado):
      // a IA lê o traço para não valorizar empurrão nele
      traits: [{ type: 'pushImmune' }],
      boss: true, supremo: true, summonOnly: false, xp: 0, stoneDrop: null
    },
    eco_menor_fogo: menor('eco_menor_fogo', 'Eco Menor de Brasa', 'fogo',
      'Um pedaço de lava que se soltou do Eco e ganhou pernas. Fica longe e atira o que é dele.',
      [170, 6, 3, 50, 30, 10, 10], 'm-eco-menor-brasa', 'ranged', { ar: 30, agua: -30 }),
    eco_menor_agua: menor('eco_menor_agua', 'Eco Menor de Coral', 'agua',
      'Um galho de coral do Eco, cheio de água que não escorre. Respinga em quem chega perto.',
      [170, 6, 3, 45, 30, 10, 12], 'm-eco-menor-mare', 'ranged', { fogo: 30, terra: -30 }),
    eco_menor_terra: menor('eco_menor_terra', 'Eco Menor de Rocha', 'terra',
      'Um bloco do ombro do Eco que caiu e levantou. Lento, pesado, e não sai da frente.',
      [230, 5, 2, 25, 30, 2, 40], 'm-eco-menor-rocha', 'melee', { agua: 30, ar: -30 }),
    eco_menor_ar: menor('eco_menor_ar', 'Eco Menor de Vento', 'ar',
      'Um fio do vento preso nas correntes do Eco, solto por um instante. Rápido e difícil de prender.',
      [150, 6, 4, 70, 30, 30, 8], 'm-eco-menor-vento', 'melee', { terra: 30, fogo: -30 })
  };

  DATA.eco = {
    chefe: 'eco_primordial',
    arena: 'camara_eco',              // DATA.arenas (js/core/data/arenas.js)
    rodadas: 12,                      // a tentativa: 12 rodadas ou até o grupo cair
    fases: ['fogo', 'agua', 'terra', 'ar'],   // uma a cada 25% da vida perdida
    // a resistência da fase, pela roda: resiste ao que o elemento vence, fraco a quem o vence
    resisteFase: 30,
    fracoFase: -30,
    comuns: ['m-eco-pulso'],
    feiticosFase: {
      fogo: ['m-eco-brasa', 'm-eco-centelha'],
      agua: ['m-eco-mare', 'm-eco-gota'],
      terra: ['m-eco-rocha', 'm-eco-lasca'],
      ar: ['m-eco-vento', 'm-eco-corte']
    },
    menores: { fogo: 'eco_menor_fogo', agua: 'eco_menor_agua', terra: 'eco_menor_terra', ar: 'eco_menor_ar' },
    menoresPorTroca: 2,
    /* O GOLPE GRANDE DE CADA FASE. `padrao` (engine.js, casasDoGolpe):
     *   alvos — um círculo de `raio` em volta de cada herói que o Eco VÊ na hora do aviso
     *           (invisível não é marcado): sair da marca basta;
     *   onda  — toda casa a `de`..`ate` passos do corpo dele com visão do núcleo: o pilar abriga,
     *           e colar nele ou ir para a borda também;
     *   cruz  — as duas faixas de 2 casas que saem do corpo nos quatro sentidos, até o primeiro
     *           muro: sair do eixo basta;
     *   anel  — toda casa a `de`..`ate` passos, com visão: quem está colado nele se afasta.
     * `min`..`max` é o dano cru, do elemento da fase, com o poder dele, e pega QUALQUER UM nas casas marcadas
     * menos ele mesmo — o chão não escolhe lado, e atrair um Eco Menor para a marca é jogada. */
    golpes: {
      fogo: { id: 'eco-golpe-fogo', nome: 'Chuva do Núcleo', padrao: 'alvos', raio: 1, min: 26, max: 34 },
      agua: { id: 'eco-golpe-agua', nome: 'Maré Funda', padrao: 'onda', de: 3, ate: 6, min: 24, max: 32 },
      terra: { id: 'eco-golpe-terra', nome: 'Rachadura', padrao: 'cruz', min: 28, max: 36 },
      ar: { id: 'eco-golpe-ar', nome: 'Correntes Rompidas', padrao: 'anel', de: 1, ate: 2, min: 30, max: 38 }
    },
    golpeACada: 2,                    // o aviso sai na 1ª, 3ª, 5ª… vez dele; o golpe cai na seguinte
    bonusDerrubada: 0.25,             // derrubá-lo soma 25% da vida máxima aos pontos
    tentativasPorDia: 3               // ESPELHO de servidor/supremo.py (quem conta é o servidor)
  };
})(JOGO.DATA);
