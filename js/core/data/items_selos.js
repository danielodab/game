// Os Selos do Colecionador — a moeda dos chefes e o traje da roleta (dono: criativo).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É (pedido do usuário, 25/08)
 * ========================================
 * "quero criar uma moeda personalizada que só ganha conforme for passando os
 *  chefes. uma moeda de cada elemento. ao juntar 10x de cada terá um npc que
 *  trocará essas moedas por um giro em uma roleta que dará um item de um set
 *  super raro e forte.. o drop da moeda nao pode ser tao facil nem impossivel"
 * + "esse item dará uma aura no chao do personagem.. um fogo quase
 *  transparente e branco quando completar o set. o set terá um pet exclusivo"
 *
 * OS SELOS: uma moeda POR ELEMENTO (fogo/água/terra/ar/neutro). SÓ chefe
 * derruba — e derruba o selo do PRÓPRIO elemento (os seis chefes cobrem os
 * cinco elementos; no Poço, os chefes revezam). A chance mora aqui
 * (DATA.selos.chance) para o usuário calibrar com um número só.
 *
 * O COLECIONADOR: o NPC mora no Mercadinho. 10 selos de CADA elemento = um
 * giro na roleta = UMA peça do Traje do Colecionador (sorteio uniforme entre
 * as 4). Peça repetida é matéria de estrela — fundir 3 iguais, como tudo.
 *
 * O TRAJE: lendário, pentaelemental, irmão de força do Traje do Coração —
 * mais poder bruto, sem feitiço de conjunto (o feitiço de 4/4 segue
 * exclusivo do Coração; aqui o Lume da roleta traz o próprio feitiço, como
 * todo Lume). Fechar as 4 peças acende a AURA (fogo branco quase
 * transparente, chão e corpo — hub3d) e concede o PET exclusivo, uma vez.
 *
 * ARTE: os 4 ícones chegaram em 03/09 (pasta icones itens/raro — cavaleiro
 * BRANCO e OURO; os ids ficaram, os nomes que o jogador lê mudaram para
 * casar com a arte). O corpo do pet 'pet-colecionador' chegou em 03/09 —
 * ícone procedural e corpo no fallback composto.
 *
 * FORA DOS POOLS DE SAQUE: dungeonId null e dropWeight 0 — estas peças só
 * saem da roleta; o pet só do traje fechado.
 */
(function () {
  'use strict';

  var DATA = JOGO.DATA = JOGO.DATA || {};
  DATA.items = DATA.items || {};
  DATA.sets = DATA.sets || {};
  DATA.itemSpells = DATA.itemSpells || {};
  DATA.pets = DATA.pets || {};
  DATA.petSpells = DATA.petSpells || {};

  // ------------------------------------------------------------- a calibragem
  DATA.selos = {
    chance: 0.5,                    // por chefe morto — "nem fácil nem impossível"
    porGiro: 10,                    // 10 de CADA elemento por giro
    setId: 'sl-set-colecionador'
  };

  /* A INSÍGNIA DE FUNDAÇÃO (30/08): a moeda que cria GUILDAS. Só chefe
   * derruba (o mesmo funil dos selos em game.js) e 10 pagam a fundação —
   * pedido do dono: "para criar guild tem que dropar moeda especial que só
   * caem dos boss, precisa juntar 10". A chance é a mesma dos selos: ~20
   * chefes por guilda — bem mais leve que a roleta (10 de CADA elemento),
   * porque fundar é o COMEÇO da vida de guilda, não o prêmio dela. */
  DATA.insignias = {
    chance: 0.5,
    porGuilda: 10
  };

  function rng(min, max, line, los) {
    return { min: min, max: max, line: line === true, los: los !== false, movable: false };
  }
  function aoe(shape, size) { return { shape: shape, size: size || 0 }; }

  // ------------------------------------------- o feitiço do Lume do Colecionador
  DATA.itemSpells['is-cinco-selos'] = {
    id: 'is-cinco-selos', name: 'Os Cinco Selos', element: 'neutro',
    classId: null, unlockLevel: 0,
    paCost: 3, cooldown: 3, castsPerTurn: 1,
    range: rng(1, 4), aoe: aoe('circle', 1),
    needsEmptyTile: false, targetSide: 'enemy',
    effects: [
      { type: 'damage', element: 'neutro', min: 17, max: 23 },
      { type: 'poison', element: 'neutro', min: 4, max: 6, duration: 2 }
    ],
    description: 'Carimba no chão os cinco selos de uma vez: a marca queima quem estava na roda e continua queimando por dois turnos — nenhum elemento a apaga, porque ela é de todos.',
    flavor: 'O Colecionador não vende. Ele devolve.',
    fxKey: 'burst'
  };

  // --------------------------------------------------- as 4 peças (roleta only)
  function peca(o) {
    DATA.items[o.id] = {
      id: o.id, name: o.name, slot: o.slot, rarity: 'lendario', dungeonId: null,
      element: null, setId: null, dropWeight: 0,
      bonuses: o.bonuses, grantsSpell: o.grantsSpell || null,
      description: o.description, flavor: o.flavor, iconKey: o.id
    };
  }

  peca({
    id: 'sl-cetro', name: 'Lâmina Alva', slot: 'punho',
    bonuses: { pa: 1, power: 24 },
    description: 'Uma espada longa de aço branco-perolado, com um fio de luz dourada correndo pelo centro e a guarda em asas de ouro. Pesa exatamente o que a mão precisar que pese.',
    flavor: 'Já cobrou dívidas de coisas maiores que você.'
  });
  peca({
    id: 'sl-botas', name: 'Grevas de Marfim', slot: 'passo',
    bonuses: { pp: 1, dodge: 14, initiative: 12 },
    description: 'Placas de aço branco com joelheiras de ouro em filigrana e solas forradas de moedas fora de circulação. Quem as veste chega antes do preço subir.',
    flavor: 'O primeiro passo é sempre o lucro.'
  });
  peca({
    id: 'sl-cofre', name: 'Couraça do Cavaleiro Branco', slot: 'casca',
    bonuses: { hp: 60, lock: 12, resists: { neutro: 10 } },
    description: 'Peitoral de aço branco-perolado com ombreiras de ouro em asas e o brasão das cinco chamas no peito. Por dentro ainda é um cofre: a fechadura funciona e ninguém nunca achou a chave.',
    flavor: 'O que ela guarda agora é você.'
  });
  peca({
    id: 'sl-selo-primeiro', name: 'Selo Primeiro', slot: 'lume',
    grantsSpell: 'is-cinco-selos',
    bonuses: { power: 14, hp: 24, initiative: 10 },
    description: 'Um medalhão de ouro maciço, cravejado de cristais brancos, com um halo que gira devagar. É a moeda que pagou a primeira dívida do mundo enterrado: não tem cara nem coroa, tem os cinco elementos, um em cada borda, e o silêncio no meio.',
    flavor: 'Toda moeda desce. Esta desceu primeiro.'
  });

  // ------------------------------------------------------------------ o traje
  DATA.sets[DATA.selos.setId] = {
    id: DATA.selos.setId, name: 'Traje do Colecionador', element: 'neutro',
    dungeonId: null, legendary: true,
    aura: 'fogo-branco',            // 4/4 vestidas acende a aura (hub3d)
    pet: 'pet-colecionador',        // 4/4 vestidas concede o pet, uma vez
    description: 'Pago em selos, um giro de cada vez, ao único NPC que não regateia. Quem fecha as quatro peças anda com um fogo branco que não queima nada — só lembra.',
    pieces: ['sl-cetro', 'sl-botas', 'sl-cofre', 'sl-selo-primeiro'],
    bonuses: {
      2: { power: 16, hp: 26 },
      3: { power: 26, hp: 42, initiative: 16,
           resists: { fogo: 8, agua: 8, terra: 8, ar: 8, neutro: 8 } },
      4: { power: 40, hp: 64, initiative: 24, dodge: 14, lock: 14,
           resists: { fogo: 14, agua: 14, terra: 14, ar: 14, neutro: 14 } }
    }
  };

  // ------------------------------------------------------- o pet exclusivo
  DATA.petSpells['pet-selo-clarao'] = {
    id: 'pet-selo-clarao', name: 'Clarão do Selo', element: 'neutro',
    classId: null, unlockLevel: 0,
    paCost: 3, cooldown: 0, castsPerTurn: 1,
    range: rng(1, 3), aoe: aoe('single', 0),
    needsEmptyTile: false, targetSide: 'enemy',
    effects: [
      { type: 'damage', element: 'neutro', min: 12, max: 16 },
      { type: 'push', tiles: 1 }
    ],
    description: 'O bichinho ergue o selo que carrega e o vira contra o inimigo: o clarão branco empurra um passo e cobra o resto.',
    flavor: 'Ele não morde. Ele executa a dívida.',
    fxKey: 'burst'
  };

  DATA.pets['pet-colecionador'] = {
    id: 'pet-colecionador', name: 'Selinho', element: 'neutro',
    description: 'Um filhote de leão branco de juba dourada que anda em pé, com um medalhão de ouro no pescoço — o Selo Primeiro em miniatura. Quando está feliz, vira o medalhão para "mostrar a outra face". Não morde: cobra.',
    bonuses: { power: 6, hp: 15, initiative: 6, resists: { neutro: 8 } },
    behavior: 'attack', range: 3, followDistance: 2,
    spells: ['pet-selo-clarao'],
    dropDungeon: null, dropWeight: 0     // EXCLUSIVO: só o Traje fechado concede
  };

  // ------------------------------------------------------------------ rodapé
  /* O mesmo contrato dos outros arquivos de item: peça de conjunto herda
   * element/setId DO CONJUNTO (nunca à mão) — e a validação acusa se o traje
   * não tiver exatamente uma peça por espaço. */
  (function rodape() {
    var sd = DATA.sets[DATA.selos.setId];
    var slots = {};
    for (var i = 0; i < sd.pieces.length; i++) {
      var it = DATA.items[sd.pieces[i]];
      if (!it) throw new Error('items_selos: peça sumida: ' + sd.pieces[i]);
      it.element = sd.element;
      it.setId = sd.id;
      if (slots[it.slot]) throw new Error('items_selos: dois no espaço ' + it.slot);
      slots[it.slot] = true;
    }
    ['punho', 'passo', 'casca', 'lume'].forEach(function (s) {
      if (!slots[s]) throw new Error('items_selos: espaço vazio no traje: ' + s);
    });
  })();
})();
