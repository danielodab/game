var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// SOTERRA 2.0 — Elementos, rivalidades e climas
// Dono: Criativo Mundo. Globais: DATA.elements, DATA.rivals, DATA.weathers,
// DATA.elementInfo (extra, só apresentação: nome pt-BR e cor por elemento).
// Arquivo ADITIVO: nunca sobrescreve JOGO.DATA.
//
// LEI (CONTRACT_V2 §2): o clima dá +5 PV no início do turno da unidade cujo
// elemento ele FAVORECE e tira 5 PV da unidade cujo elemento ele PREJUDICA.
// Prejudicado é sempre o RIVAL do favorecido — nunca invente outro par.
// Nomenclatura: pa = Pontos de Ataque, pp = Pontos de Passos.
// ============================================================================

JOGO.DATA = JOGO.DATA || {};
(function (DATA) {
  'use strict';

  DATA.elements = ['neutro', 'fogo', 'agua', 'terra', 'ar'];

  DATA.rivals = { fogo: 'agua', agua: 'fogo', terra: 'ar', ar: 'terra', neutro: null };

  // --------------------------------------------------------------------------
  // A RODA — quem GANHA de quem. Diferente de `rivals`, que é simétrico.
  //
  // `rivals` responde "quem se odeia" e é o que o CLIMA usa: a chuva favorece a
  // água e prejudica o fogo, e os dois lados do par se revezam conforme o
  // tempo. Isso continua igual. A roda responde outra pergunta, que o jogo não
  // sabia responder: "numa briga entre dois elementos, qual leva a melhor?"
  //
  //        fogo  →  ar  →  terra  →  agua  →  fogo
  //
  // Cada seta é uma imagem concreta: o fogo consome o ar, o ar leva a terra
  // embora um grão por vez, a terra bebe a água, a água apaga o fogo. A última
  // é a que o Daniel deu de exemplo ("água ganha de fogo"); as outras três saem
  // dela, porque com quatro elementos o único fecho coerente é um CICLO — um
  // par simétrico deixaria dois elementos sem nada que os vencesse.
  //
  // A lore em `elementInfo` diz que a Terra odeia o Ar "que a leva embora" E
  // que o Ar odeia a Terra "que o prende". Os dois se dizem vencedores; um
  // tinha de ceder. Ficou com o Ar, porque erosão é um processo e prender é um
  // estado — e a roda fala de quem vence a TROCA, não de quem é mais forte.
  //
  // COMO ISSO CHEGA NO DANO: não há conta escondida no motor. A tabela
  // `resists` de cada monstro é que aponta para os elementos certos — ele
  // resiste ao elemento que VENCE e é fraco contra quem o vence, guardando a
  // magnitude autoral de sempre. `tests/validate_data.html` cobra a regra em
  // todos eles, para que nenhum monstro novo nasça fora da roda.
  DATA.beats = { fogo: 'ar', ar: 'terra', terra: 'agua', agua: 'fogo', neutro: null };

  // Quem vence ESTE elemento — o inverso da roda, para não obrigar quem lê a
  // varrer a tabela de trás para frente.
  DATA.beatenBy = { ar: 'fogo', terra: 'ar', agua: 'terra', fogo: 'agua', neutro: null };

  // Apresentação (Designer/HUD): nome visível, cor do número de dano, ícone.
  DATA.elementInfo = {
    neutro: {
      id: 'neutro', name: 'Neutro', color: '#d8dee4', icon: 'circle',
      description: 'A matéria crua do mundo enterrado. Não ama nem odeia ninguém: nenhum clima o ajuda, nenhum clima o fere.'
    },
    fogo: {
      id: 'fogo', name: 'Fogo', color: '#ff8c3a', icon: 'flame',
      description: 'A memória do sol, guardada em brasa. Come depressa e cobra caro. Odeia a Água, que o cala.'
    },
    agua: {
      id: 'agua', name: 'Água', color: '#57c8ec', icon: 'drop',
      description: 'Paciente, pesada, sem pressa nenhuma. Contorna o que não consegue quebrar. Odeia o Fogo, que a rouba.'
    },
    terra: {
      id: 'terra', name: 'Terra', color: '#9bd06a', icon: 'stone',
      description: 'Raiz, pedra e teimosia. Só cede quando alguém cava. Odeia o Ar, que a leva embora um grão por vez.'
    },
    ar: {
      id: 'ar', name: 'Ar', color: '#c8b6ff', icon: 'gust',
      description: 'O que sobrou do céu depois que o céu virou pedra. Nunca está onde você mirou. Odeia a Terra, que o prende.'
    }
  };

  // --------------------------------------------------------------------------
  // CLIMAS — os 5 obrigatórios. favors/harms sempre formam um par rival.
  // palette: o Designer tinge a cena com isso (tint = filtro geral,
  // ambient = luz de fundo, accent = destaque/UI, particle = cor da partícula).
  // --------------------------------------------------------------------------
  DATA.weathers = {

    calmo: {
      id: 'calmo',
      name: 'Calmo',
      favors: null,
      harms: null,
      description: 'O ar parado das salas que ninguém abriu em mil anos. Só a poeira se mexe, e mesmo assim com preguiça. Aqui nenhum elemento leva vantagem: a sala não tem opinião sobre quem deve morrer.',
      flavor: 'Silêncio não é paz. É só o barulho esperando a vez.',
      fxKey: 'weatherCalm',
      palette: { tint: '#d8dee4', ambient: '#1a1f26', accent: '#8ab4d8', particle: '#6b7684' }
    },

    chuva: {
      id: 'chuva',
      name: 'Chuva',
      favors: 'agua',
      harms: 'fogo',
      description: 'A água que a Grande Lousa prendeu lá em cima acha caminho e desce pelas rachaduras a noite inteira. O chão vira espelho, o barulho engole os passos — e tudo que arde começa a chiar.',
      flavor: 'Chove há mil anos. Ninguém teve coragem de contar isso à chuva.',
      fxKey: 'weatherRain',
      palette: { tint: '#57c8ec', ambient: '#12222c', accent: '#7ef0d4', particle: '#a8e4f5' }
    },

    estiagem: {
      id: 'estiagem',
      name: 'Estiagem',
      favors: 'fogo',
      harms: 'agua',
      description: 'O calor sobe das grelhas do piso e fica, sem ter para onde ir. O suor seca antes de escorrer, a pedra estala de sede e cada respiração custa um gole que ninguém tem. Aqui a brasa é rainha.',
      flavor: 'A sala inteira é uma boca aberta esperando alguém dizer "água".',
      fxKey: 'weatherDrought',
      palette: { tint: '#ff8c3a', ambient: '#2a1610', accent: '#ffb347', particle: '#ffd08a' }
    },

    vendaval: {
      id: 'vendaval',
      name: 'Vendaval',
      favors: 'ar',
      harms: 'terra',
      description: 'Os respiradouros do mundo enterrado sopram todos ao mesmo tempo e a sala vira corredor de túnel. Cordas assobiam, tábuas batem, e o que tem raiz sente que está sendo desenterrado a rajadas.',
      flavor: 'O vento aqui não passa: ele mora, e você é que está de visita.',
      fxKey: 'weatherGale',
      palette: { tint: '#c8b6ff', ambient: '#181d2a', accent: '#eef7f5', particle: '#e0dcff' }
    },

    tremor: {
      id: 'tremor',
      name: 'Tremor',
      favors: 'terra',
      harms: 'ar',
      description: 'A Lousa desce mais um palmo e o mundo lembra que é feito de pedra. O chão bate como um coração grande e lento, a poeira sobe em cortinas e o ar fica pesado demais para carregar qualquer coisa leve.',
      flavor: 'Não é a pedra que treme. É você, e a pedra concordando.',
      fxKey: 'weatherQuake',
      palette: { tint: '#9bd06a', ambient: '#211c14', accent: '#c9a227', particle: '#bda06a' }
    }
  };

})(JOGO.DATA);
