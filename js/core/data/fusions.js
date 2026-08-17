var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// SOTERRA 2.0 — FUSÃO (dono: Criativo Fusão)
// Globais: DATA.fusionForms, DATA.fusionBlends
// Extras deste arquivo (aditivos, ver rodapé): DATA.fusionIdentities,
//   DATA.fusionSpells (payloads de armadilha + feitiços dos invocados),
//   DATA.fusionSummons (criaturas invocadas por formas de fusão).
//
// COMO SE COMPÕE UM FEITIÇO DE FUSÃO (CONTRACT_V2 §4):
//   nome    = form.formName + ' ' + blend.affix        ("Furacão" + "Salgado")
//   efeitos = form.mechanic (com '@A'/'@B' trocados por blend.elements) + blend.rider
//   id      = 'fus:' + classPair + ':' + elemPair + ':' + tier
//
// REGRAS DE AUTORIA SEGUIDAS AQUI:
//   • Todo formName é um SUBSTANTIVO MASCULINO SINGULAR e todo affix é um
//     ADJETIVO MASCULINO SINGULAR — a concatenação sempre concorda em gênero.
//   • '@A' e '@B' só aparecem dentro de `mechanic`. Riders usam elemento concreto.
//   • Formas de apoio (alvo aliado/próprio) trazem `riderMode:'support'`: nelas a
//     Lógica deve usar `blend.riderSupport` no lugar de `blend.rider` (senão um
//     rider ofensivo cairia sobre o próprio aliado curado). Toda mistura traz os dois.
//   • As 15 duplas de classe são mecanicamente distintas (ver DATA.fusionIdentities).
//
// PARA A LÓGICA: mesclar `DATA.fusionSpells` em `DATA.spells` e
// `DATA.fusionSummons` em `DATA.monsters` no boot (Object.assign), pois efeitos
// `trap{trapId}` e `summon{monsterId}` das formas apontam para esses ids.
// ============================================================================

JOGO.DATA = JOGO.DATA || {};

(function () {
  'use strict';

  var DATA = JOGO.DATA;

  // ---- atalhos de autoria (produzem objetos novos a cada chamada) ----------
  function rng(min, max, line, los) {
    return { min: min, max: max, line: line === true, los: los !== false, movable: false };
  }
  function aoe(shape, size) { return { shape: shape, size: size || 0 }; }

  function d(el, min, max) { return { type: 'damage', element: el, min: min, max: max }; }
  function dl(el, min, max) { return { type: 'damage', element: el, min: min, max: max, lifesteal: true }; }
  function pz(el, min, max, dur) { return { type: 'poison', element: el, min: min, max: max, duration: dur }; }
  function hl(min, max) { return { type: 'heal', min: min, max: max }; }
  function rg(min, max, dur) { return { type: 'regen', min: min, max: max, duration: dur }; }
  function sh(v, dur) { return { type: 'shield', value: v, duration: dur }; }
  function bf(stat, v, dur) { return { type: 'buff', stat: stat, value: v, duration: dur }; }
  function rs(el, v, dur) { return { type: 'resist', element: el, value: v, duration: dur }; }
  function ps(n) { return { type: 'push', tiles: n }; }
  function pl(n) { return { type: 'pull', tiles: n }; }
  function rt(dur) { return { type: 'root', duration: dur }; }
  function mk(v, dur, max) { return { type: 'mark', value: v, duration: dur, max: max }; }
  function dm(mult) { return { type: 'detonateMarks', mult: mult }; }
  function tp() { return { type: 'teleport' }; }
  function mv(n) { return { type: 'moveTo', maxTiles: n }; }
  function ch(jumps, falloff, el, min, max) {
    return { type: 'chain', jumps: jumps, falloff: falloff, element: el, min: min, max: max };
  }
  function sm(id) { return { type: 'summon', monsterId: id }; }
  function tr(id, dur) { return { type: 'trap', trapId: id, duration: dur }; }
  function tn(dur) { return { type: 'taunt', duration: dur }; }
  function iv(dur) { return { type: 'invisible', duration: dur }; }
  function rf(pct, dur) { return { type: 'reflect', pct: pct, duration: dur }; }
  function dsh() { return { type: 'dispelShield' }; }
  function cl(kinds) { return { type: 'cleanse', kinds: kinds }; }
  function ws(w) { return { type: 'weatherShift', weather: w }; }

  // =========================================================================
  // 1. IDENTIDADE DAS 15 DUPLAS — o que a soma das duas classes faz de único
  // =========================================================================
  DATA.fusionIdentities = {
    'arqueiro+bruxo':      { name: 'Artilharia Arcana',   line: 'Magia de longuíssimo alcance: marca o campo inteiro de longe e detona as marcas em área.' },
    'arqueiro+curandeira': { name: 'Arco Votivo',          line: 'Flechas que atravessam a fila em linha reta e devolvem ao corpo fundido cada gota que tiram.' },
    'arqueiro+espadachim': { name: 'Caçador de Sombras',   line: 'Atira do breu, salta para cima do alvo marcado e executa: invisibilidade + reposicionamento + marcas.' },
    'arqueiro+invocador':  { name: 'Torreta Viva',         line: 'Planta torres de aljava e cravos-armadilha; os tiros saltam entre os presos.' },
    'arqueiro+sumo':       { name: 'Balista de Carne',     line: 'Cerco: projéteis pesados que empurram, arpéus que puxam e uma âncora que ninguém tira do lugar.' },
    'bruxo+curandeira':    { name: 'Praga Piedosa',        line: 'Transfusão: tudo que tira do inimigo vira vida própria; benção de um lado, apodrecimento do outro.' },
    'bruxo+espadachim':    { name: 'Lâmina Rúnica',        line: 'Pisca pelo campo deixando explosões nas partidas e chegadas, com veneno arcano na lâmina.' },
    'bruxo+invocador':     { name: 'Sabá das Armadilhas',  line: 'Ritual: selos armados no chão, efígies que amaldiçoam e o clima da sala virado à força.' },
    'bruxo+sumo':          { name: 'Colosso Arcano',       line: 'A magia não é lançada, é irradiada: tudo ao redor do corpo apanha, prende e devolve o golpe.' },
    'curandeira+espadachim': { name: 'Bisturi Dançante',   line: 'Cortes rápidos com roubo de vida, cura de emergência entre um passo e outro, e some no meio do turno.' },
    'curandeira+invocador':{ name: 'Jardim Sagrado',       line: 'Semeia guardiões que curam, cercados que prendem e campos de regeneração que crescem sozinhos.' },
    'curandeira+sumo':     { name: 'Baluarte Compassivo',  line: 'Muralha que puxa o aliado para trás de si, provoca todo mundo e reparte escudo com quem sangra.' },
    'espadachim+invocador':{ name: 'Sombra Multiplicada',  line: 'Fabrica gêmeos de breu e espinhos escondidos: veneno vindo de três lugares ao mesmo tempo.' },
    'espadachim+sumo':     { name: 'Investida Titânica',   line: 'Peso em movimento: investe de longe, agarra, gira e arremessa — e o chão fica marcado.' },
    'invocador+sumo':      { name: 'Fortaleza Viva',       line: 'Tanque que invoca: provoca a sala inteira, ergue ídolos de escora e cobre todos de escudo.' }
  };

  // =========================================================================
  // 2. MISTURAS ELEMENTAIS — 15 duplas (chaves em ordem alfabética)
  //    '@A' vira elements[0]; '@B' vira elements[1].
  //    As duplas espelhadas (ex.: 'ar+agua') são geradas no rodapé.
  // =========================================================================
  DATA.fusionBlends = {

    'agua+agua': {
      id: 'agua+agua', affix: 'Abissal', elements: ['agua', 'agua'],
      description: 'Duas águas somadas viram profundidade: a sala inteira fica pesada, escura e molhada. Elemento puro, dano puro.',
      rider: [d('agua', 8, 12), ws('chuva')],
      riderSupport: [rg(6, 9, 2), ws('chuva')],
      palette: { primary: '#2e6e8e', secondary: '#102a3a', accent: '#7ef0d4' },
      fxKey: 'blend-abissal'
    },
    'agua+ar': {
      id: 'agua+ar', affix: 'Salgado', elements: ['agua', 'ar'],
      description: 'A ventania puxa a água para dentro de si: cada golpe chega encharcado de sal e empurra quem apanha mais um passo para trás.',
      rider: [d('agua', 6, 10), ps(1)],
      riderSupport: [bf('pp', 1, 2), cl(['poison'])],
      palette: { primary: '#4fa8b8', secondary: '#1b3f4d', accent: '#d8fff2' },
      fxKey: 'blend-salgado'
    },
    'agua+fogo': {
      id: 'agua+fogo', affix: 'Escaldante', elements: ['agua', 'fogo'],
      description: 'Rivais fundidos não se anulam: viram vapor sob pressão. Queima na hora e continua queimando depois.',
      rider: [d('agua', 5, 8), pz('fogo', 5, 8, 2)],
      riderSupport: [cl(['poison', 'root']), rs('fogo', 12, 2)],
      palette: { primary: '#c96b4a', secondary: '#3a4d58', accent: '#ffe6cf' },
      fxKey: 'blend-escaldante'
    },
    'agua+neutro': {
      id: 'agua+neutro', affix: 'Turvo', elements: ['agua', 'neutro'],
      description: 'Metade do corpo ainda não escolheu elemento: a água carrega o golpe sem cor, e a lama que sobra desmancha escudos.',
      rider: [d('neutro', 4, 7), dsh()],
      riderSupport: [rg(4, 6, 2)],
      palette: { primary: '#527d8c', secondary: '#232f36', accent: '#c9dde4' },
      fxKey: 'blend-turvo'
    },
    'agua+terra': {
      id: 'agua+terra', affix: 'Lamacento', elements: ['agua', 'terra'],
      description: 'Água e terra dão lama: pesa nos pés de quem apanha e cola o inimigo no chão por um instante.',
      rider: [d('terra', 6, 9), rt(1)],
      riderSupport: [sh(14, 2)],
      palette: { primary: '#6d6a3f', secondary: '#2c2a1c', accent: '#b8c48a' },
      fxKey: 'blend-lamacento'
    },
    'ar+ar': {
      id: 'ar+ar', affix: 'Ciclônico', elements: ['ar', 'ar'],
      description: 'Dois ares somados não sopram: giram. O vendaval passa a ser a regra da sala.',
      rider: [d('ar', 8, 12), ws('vendaval')],
      riderSupport: [bf('pp', 1, 2), ws('vendaval')],
      palette: { primary: '#9fd8e8', secondary: '#2b3f4a', accent: '#ffffff' },
      fxKey: 'blend-ciclonico'
    },
    'ar+fogo': {
      id: 'ar+fogo', affix: 'Incendiário', elements: ['ar', 'fogo'],
      description: 'Fogo com vento embaixo vira sopro de forja: a labareda alonga o alcance e o estouro joga o alvo para longe.',
      rider: [d('fogo', 7, 11), ps(1)],
      riderSupport: [bf('power', 12, 2)],
      palette: { primary: '#ff8c3a', secondary: '#4a2418', accent: '#ffe08a' },
      fxKey: 'blend-incendiario'
    },
    'ar+neutro': {
      id: 'ar+neutro', affix: 'Ligeiro', elements: ['ar', 'neutro'],
      description: 'Sem elemento definido do outro lado, sobra pressa: o golpe é leve, mas chega antes e desarruma a formação.',
      rider: [d('neutro', 4, 7), ps(1)],
      riderSupport: [bf('pp', 1, 1)],
      palette: { primary: '#b9c9d0', secondary: '#39424a', accent: '#f2fbff' },
      fxKey: 'blend-ligeiro'
    },
    'ar+terra': {
      id: 'ar+terra', affix: 'Arenoso', elements: ['ar', 'terra'],
      description: 'Rivais fundidos viram tempestade de areia: o grão entra na ferida e faz doer tudo o que vier depois.',
      rider: [d('ar', 5, 8), mk(5, 2, 3)],
      riderSupport: [rs('ar', 10, 2), rs('terra', 10, 2)],
      palette: { primary: '#c9ac6b', secondary: '#463a24', accent: '#f2e3bd' },
      fxKey: 'blend-arenoso'
    },
    'fogo+fogo': {
      id: 'fogo+fogo', affix: 'Infernal', elements: ['fogo', 'fogo'],
      description: 'Duas chamas somadas não se dividem: viram uma só, maior, e secam o ar da sala inteira.',
      rider: [d('fogo', 9, 13), ws('estiagem')],
      riderSupport: [bf('power', 14, 2), ws('estiagem')],
      palette: { primary: '#c4502e', secondary: '#2a0f0b', accent: '#ffb347' },
      fxKey: 'blend-infernal'
    },
    'fogo+neutro': {
      id: 'fogo+neutro', affix: 'Chamuscado', elements: ['fogo', 'neutro'],
      description: 'Uma metade arde, a outra ainda é só força bruta: o golpe sai sem cor, mas sai quente e sem economia.',
      rider: [d('neutro', 5, 9)],
      riderSupport: [bf('power', 10, 2)],
      palette: { primary: '#a06a4a', secondary: '#332018', accent: '#ffd0a0' },
      fxKey: 'blend-chamuscado'
    },
    'fogo+terra': {
      id: 'fogo+terra', affix: 'Vulcânico', elements: ['fogo', 'terra'],
      description: 'Pedra derretida: bate como rocha e continua cozinhando por baixo da armadura.',
      rider: [d('terra', 6, 9), pz('fogo', 5, 8, 2)],
      riderSupport: [sh(16, 2)],
      palette: { primary: '#8a3a22', secondary: '#241512', accent: '#ff7a2f' },
      fxKey: 'blend-vulcanico'
    },
    'neutro+neutro': {
      id: 'neutro+neutro', affix: 'Cru', elements: ['neutro', 'neutro'],
      description: 'Nenhum dos dois escolheu elemento ainda: a fusão sai crua — só as duas classes, sem cor, e o clima se aquieta em volta.',
      rider: [d('neutro', 6, 10), ws('calmo')],
      riderSupport: [hl(8, 12)],
      palette: { primary: '#9aa4ac', secondary: '#22282d', accent: '#e6edf2' },
      fxKey: 'blend-cru'
    },
    'neutro+terra': {
      id: 'neutro+terra', affix: 'Bruto', elements: ['neutro', 'terra'],
      description: 'Metade pedra, metade nada: o que falta em elemento sobra em peso — quem apanha fica onde está.',
      rider: [d('neutro', 4, 7), rt(1)],
      riderSupport: [sh(12, 2)],
      palette: { primary: '#8a7a5c', secondary: '#2b2519', accent: '#d8cba8' },
      fxKey: 'blend-bruto'
    },
    'terra+terra': {
      id: 'terra+terra', affix: 'Telúrico', elements: ['terra', 'terra'],
      description: 'Duas terras somadas viram falha geológica: o chão trabalha junto com a fusão e não para de tremer.',
      rider: [d('terra', 9, 13), ws('tremor')],
      riderSupport: [sh(22, 2), ws('tremor')],
      palette: { primary: '#6b8f3d', secondary: '#2c3320', accent: '#e0c86a' },
      fxKey: 'blend-telurico'
    }
  };

  // =========================================================================
  // 3. FORMAS POR DUPLA DE CLASSE — 15 duplas × 5 tiers (0, 5, 12, 20, 30)
  //    Chave: os dois ids de classe em ORDEM ALFABÉTICA, separados por '+'.
  // =========================================================================
  DATA.fusionForms = {};
  var F = DATA.fusionForms;

  // --- ARQUEIRO + BRUXO — Artilharia Arcana -------------------------------
  // Assinatura: alcance absurdo + acúmulo de marcas + detonação em área.
  F['arqueiro+bruxo'] = [
    { tier: 0, formName: 'Disparo', paCost: 3, cooldown: 0, castsPerTurn: 2,
      range: rng(1, 8), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 14, 19), mk(5, 3, 5)],
      description: 'O arco encantado dispara do outro lado da sala e deixa no alvo um sinal que a magia sabe encontrar depois.',
      fxShape: 'bolt' },
    { tier: 5, formName: 'Sigilo', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(2, 7), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@B', 12, 17), mk(5, 3, 5)],
      description: 'A flecha estoura no ar e pinta um sigilo em todos os que estavam perto demais dela.',
      fxShape: 'burst' },
    { tier: 12, formName: 'Estilhaço', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(2, 9), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [ch(2, 0.6, '@B', 15, 20), mk(6, 3, 5)],
      description: 'Um estilhaço de vidro encantado pula de inimigo em inimigo, perdendo força e ganhando ódio.',
      fxShape: 'beam' },
    { tier: 20, formName: 'Juízo', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 9), aoe: aoe('circle', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 18, 25), dm(9)],
      description: 'A fusão fecha os dois olhos ao mesmo tempo: cada sinal deixado antes cobra a conta de uma vez.',
      fxShape: 'nova' },
    { tier: 30, formName: 'Cataclismo', paCost: 5, cooldown: 4, castsPerTurn: 1,
      range: rng(1, 10), aoe: aoe('circle', 3), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 26, 35), d('@B', 20, 28), dm(12), mk(6, 3, 5)],
      description: 'O horizonte inteiro da sala vira alvo: cai, detona tudo o que estava marcado e já marca de novo o que sobrou.',
      fxShape: 'nova' }
  ];

  // --- ARQUEIRO + CURANDEIRA — Arco Votivo --------------------------------
  // Assinatura: tiros em LINHA que atravessam a fila + roubo de vida + cuidado.
  F['arqueiro+curandeira'] = [
    { tier: 0, formName: 'Dardo', paCost: 3, cooldown: 0, castsPerTurn: 2,
      range: rng(1, 7, true), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [dl('@A', 13, 18)],
      description: 'Um dardo votivo em linha reta: o que ele tira do inimigo volta quente para o corpo fundido.',
      fxShape: 'bolt' },
    { tier: 5, formName: 'Bálsamo', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(0, 6), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [hl(20, 27), rg(6, 9, 2)],
      description: 'A fusão lança um frasco lacrado com a ponta do arco: o bálsamo se abre no aliado e continua trabalhando.',
      fxShape: 'heal' },
    { tier: 12, formName: 'Fio', paCost: 4, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 6, true), aoe: aoe('line', 5), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [dl('@B', 16, 22)],
      description: 'Um fio de luz esticado de ponta a ponta da fila inimiga: cada corpo atravessado devolve um gole de vida.',
      fxShape: 'beam' },
    { tier: 20, formName: 'Cálice', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(0, 5), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [hl(26, 34), sh(25, 2), cl(['poison', 'root'])],
      description: 'O cálice é erguido no meio do grupo: fecha feridas, endurece a pele e lava o que estava apodrecendo por dentro.',
      fxShape: 'heal' },
    { tier: 30, formName: 'Sacramento', paCost: 5, cooldown: 4, castsPerTurn: 1,
      range: rng(1, 8, true), aoe: aoe('line', 8), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [dl('@A', 28, 37), dl('@B', 20, 27)],
      description: 'Uma flecha só, sacramentada, atravessa a sala inteira em linha: tudo que ela fura vira vida do outro lado.',
      fxShape: 'beam' }
  ];

  // --- ARQUEIRO + ESPADACHIM — Caçador de Sombras -------------------------
  // Assinatura: invisibilidade + salto até o alvo + execução de marcas.
  F['arqueiro+espadachim'] = [
    { tier: 0, formName: 'Bote', paCost: 3, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [mv(4), d('@A', 16, 21)],
      description: 'A fusão fecha a distância num salto só e chega junto antes de o inimigo virar a cabeça.',
      fxShape: 'blink' },
    { tier: 5, formName: 'Véu', paCost: 2, cooldown: 4, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [iv(2), bf('dodge', 15, 2)],
      description: 'As duas silhuetas se dobram uma dentro da outra e somem: ninguém mira o que não consegue contar.',
      fxShape: 'veil' },
    { tier: 12, formName: 'Talho', paCost: 4, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 2), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@B', 20, 27), mk(6, 2, 4)],
      description: 'Corte na altura da guarda: abre o alvo e deixa a abertura aberta para o próximo tiro.',
      fxShape: 'slam' },
    { tier: 20, formName: 'Rasgo', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 6, true), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [ch(3, 0.7, '@A', 18, 24), dm(8)],
      description: 'A lâmina é atirada e volta rasgando de alvo em alvo, cobrando toda abertura que tiver deixado antes.',
      fxShape: 'beam' },
    { tier: 30, formName: 'Epílogo', paCost: 5, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 7), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [mv(6), d('@A', 30, 41), dm(14), iv(1)],
      description: 'A caçada acaba num parágrafo: aparece colado no alvo, cobra tudo o que estava marcado e some de novo no mesmo movimento.',
      fxShape: 'blink' }
  ];

  // --- ARQUEIRO + INVOCADOR — Torreta Viva --------------------------------
  // Assinatura: nega o terreno — torres, cravos-armadilha e tiros que saltam.
  F['arqueiro+invocador'] = [
    { tier: 0, formName: 'Espeto', paCost: 3, cooldown: 0, castsPerTurn: 2,
      range: rng(1, 6), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 14, 19), rt(1)],
      description: 'Uma flecha grossa como estaca prega o inimigo no chão pelo pé — ele ainda ataca, mas não sai dali.',
      fxShape: 'bolt' },
    { tier: 5, formName: 'Ninho', paCost: 3, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('single', 0), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [sm('fus-arrow-turret')],
      description: 'A fusão finca um feixe de flechas no chão e sopra: o feixe abre os olhos e vira torre.',
      fxShape: 'summonFx' },
    { tier: 12, formName: 'Cravo', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('single', 0), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [tr('fus-trap-arrow', 4)],
      description: 'Um cravo de aljava enterrado com a ponta para cima, esperando o passo errado.',
      fxShape: 'summonFx' },
    { tier: 20, formName: 'Enxame', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(2, 8), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 18, 25), ch(2, 0.6, '@B', 14, 19)],
      description: 'Não é uma flecha, é um enxame: cai em cima do grupo e pula para quem tentar se afastar.',
      fxShape: 'burst' },
    { tier: 30, formName: 'Arsenal', paCost: 5, cooldown: 4, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('circle', 1), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'offense',
      mechanic: [sm('fus-arrow-turret'), tr('fus-trap-arrow', 5), d('@B', 18, 25)],
      description: 'A fusão despeja um arsenal inteiro numa célula só: sobe torre, some cravo no chão e o estouro da entrega já castiga a vizinhança.',
      fxShape: 'summonFx' }
  ];

  // --- ARQUEIRO + SUMO — Balista de Carne ---------------------------------
  // Assinatura: cerco — projétil pesado que empurra, arpéu que puxa, âncora.
  F['arqueiro+sumo'] = [
    { tier: 0, formName: 'Arremesso', paCost: 3, cooldown: 0, castsPerTurn: 2,
      range: rng(1, 5), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 15, 21), ps(2)],
      description: 'A fusão arremessa o que tiver na mão com peso de sumô: o alvo vai dois passos para trás junto com a ideia dele.',
      fxShape: 'slam' },
    { tier: 5, formName: 'Arpéu', paCost: 3, cooldown: 1, castsPerTurn: 1,
      range: rng(3, 7), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@B', 12, 17), pl(3)],
      description: 'Flecha com corda: fisga o atirador escondido lá atrás e o traz para dentro do alcance do corpo a corpo.',
      fxShape: 'hook' },
    { tier: 12, formName: 'Aríete', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 6, true), aoe: aoe('line', 5), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 18, 25), ps(2), rt(1)],
      description: 'Uma tora de cerco disparada em linha: varre a fila, empurra todo mundo junto e deixa os pés presos onde pararam.',
      fxShape: 'beam' },
    { tier: 20, formName: 'Bastião', paCost: 3, cooldown: 3, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [sh(45, 2), bf('lock', 20, 2), tn(2)],
      description: 'A fusão crava os pés, abre os braços e vira construção: quem quiser passar vai ter que atirar nela primeiro.',
      fxShape: 'shieldFx' },
    { tier: 30, formName: 'Trabuco', paCost: 5, cooldown: 3, castsPerTurn: 1,
      range: rng(2, 9), aoe: aoe('circle', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 28, 37), d('@B', 20, 27), ps(3), rt(1)],
      description: 'O corpo inteiro vira máquina de cerco e despeja um bloco na outra ponta da sala: o que não morre sai voando e cai preso.',
      fxShape: 'nova' }
  ];

  // --- BRUXO + CURANDEIRA — Praga Piedosa ---------------------------------
  // Assinatura: transfusão — tudo drena e vira vida; benção de um lado, praga do outro.
  F['bruxo+curandeira'] = [
    { tier: 0, formName: 'Dreno', paCost: 3, cooldown: 0, castsPerTurn: 2,
      range: rng(1, 5), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [dl('@A', 14, 19)],
      description: 'A mão aberta puxa um fio morno de dentro do inimigo e enfia no próprio peito.',
      fxShape: 'beam' },
    { tier: 5, formName: 'Voto', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(0, 5), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [hl(22, 29), rs('@A', 20, 2)],
      description: 'Uma promessa dita em duas vozes: fecha o corte e deixa o aliado difícil de ferir pelo mesmo elemento.',
      fxShape: 'heal' },
    { tier: 12, formName: 'Estigma', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 6), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [pz('@B', 9, 13, 3), dsh()],
      description: 'Um estigma aberto na pele de todos ao redor do alvo: come escudo primeiro, carne depois, sem pressa.',
      fxShape: 'debuff' },
    { tier: 20, formName: 'Ofertório', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 6), aoe: aoe('circle', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [dl('@A', 20, 27), dl('@B', 14, 19)],
      description: 'A fusão passa o cesto: cada inimigo da roda contribui com um pouco de vida, e ela toda vai para o mesmo lugar.',
      fxShape: 'nova' },
    { tier: 30, formName: 'Anátema', paCost: 5, cooldown: 4, castsPerTurn: 1,
      range: rng(1, 7), aoe: aoe('circle', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [dl('@A', 22, 30), pz('@A', 12, 17, 3), pz('@B', 10, 15, 3), dsh()],
      description: 'A excomunhão em duas línguas ao mesmo tempo: arranca o escudo, envenena duas vezes e engorda a fusão com o que tirou.',
      fxShape: 'nova' }
  ];

  // --- BRUXO + ESPADACHIM — Lâmina Rúnica ---------------------------------
  // Assinatura: pisca pelo campo deixando estouro na chegada + veneno arcano.
  F['bruxo+espadachim'] = [
    { tier: 0, formName: 'Corte', paCost: 3, cooldown: 0, castsPerTurn: 2,
      range: rng(1, 2), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 15, 20), pz('@B', 4, 7, 2)],
      description: 'A lâmina tem runas gravadas até o cabo: o corte fecha, o que ela escreveu por dentro não.',
      fxShape: 'slam' },
    { tier: 5, formName: 'Salto', paCost: 2, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('circle', 1), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'offense',
      mechanic: [tp(), d('@A', 10, 15)],
      description: 'Desaparece de um ponto e reaparece em outro; o ar fechando no lugar da chegada queima quem estava perto.',
      fxShape: 'blink' },
    { tier: 12, formName: 'Estilete', paCost: 4, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 3), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@B', 22, 29), pz('@A', 7, 11, 3)],
      description: 'Um estilete fino demais para ser visto, molhado num feitiço que não tem antídoto conhecido.',
      fxShape: 'slam' },
    { tier: 20, formName: 'Manto', paCost: 3, cooldown: 4, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [iv(2), bf('power', 25, 2)],
      description: 'O manto rúnico se fecha sobre as duas silhuetas: some do mapa e volta batendo muito mais forte.',
      fxShape: 'veil' },
    { tier: 30, formName: 'Pesadelo', paCost: 5, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 6), aoe: aoe('circle', 2), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'offense',
      mechanic: [tp(), d('@A', 24, 33), pz('@B', 12, 17, 3), iv(1)],
      description: 'Aparece no meio do grupo inimigo como coisa de sonho ruim, desmonta a roda com veneno e some antes de acordarem.',
      fxShape: 'blink' }
  ];

  // --- BRUXO + INVOCADOR — Sabá das Armadilhas ----------------------------
  // Assinatura: ritual de terreno — selos, efígies e o clima virado à força.
  F['bruxo+invocador'] = [
    { tier: 0, formName: 'Selo', paCost: 3, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('single', 0), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [tr('fus-trap-hex', 4)],
      description: 'Um selo desenhado no chão com giz e cinza: quem pisar assina o que estiver escrito.',
      fxShape: 'summonFx' },
    { tier: 5, formName: 'Círculo', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 14, 19), rt(1)],
      description: 'O círculo se fecha em volta dos pés dos inimigos e aperta: eles ficam, o feitiço passa.',
      fxShape: 'burst' },
    { tier: 12, formName: 'Coro', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('single', 0), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [sm('fus-hex-effigy')],
      description: 'A fusão modela uma efígie de cera com as duas caras dela e manda a boneca rezar junto.',
      fxShape: 'summonFx' },
    { tier: 20, formName: 'Prenúncio', paCost: 4, cooldown: 4, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [ws('calmo'), bf('power', 20, 3)],
      description: 'O ritual acalma o clima da sala à força — ninguém mais tem vantagem de tempo — e a fusão fica com toda a atenção do ar.',
      fxShape: 'nova' },
    { tier: 30, formName: 'Sabá', paCost: 5, cooldown: 4, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('circle', 2), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'offense',
      mechanic: [sm('fus-hex-effigy'), tr('fus-trap-hex', 5), d('@B', 22, 31), pz('@A', 10, 15, 3)],
      description: 'O sabá completo numa célula: efígie de pé, selo aceso embaixo e uma praga aberta em roda para inaugurar a festa.',
      fxShape: 'nova' }
  ];

  // --- BRUXO + SUMO — Colosso Arcano --------------------------------------
  // Assinatura: nada é lançado, tudo é IRRADIADO do próprio corpo; devolve golpe.
  F['bruxo+sumo'] = [
    { tier: 0, formName: 'Baque', paCost: 3, cooldown: 0, castsPerTurn: 2,
      range: rng(1, 1), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 18, 25), ps(1)],
      description: 'O braço desce com peso de sumô e estala feitiço no contato: o baque abre espaço na marra.',
      fxShape: 'slam' },
    { tier: 5, formName: 'Halo', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'offense',
      mechanic: [d('@A', 14, 19), rt(1)],
      description: 'Um halo de energia abre em volta do corpo e cola no chão os pés de quem estava colado demais.',
      fxShape: 'nova' },
    { tier: 12, formName: 'Espelho', paCost: 3, cooldown: 4, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [rf(30, 2), sh(30, 2)],
      description: 'A pele vira espelho encantado: parte do que bate nela volta pelo mesmo caminho, com juros.',
      fxShape: 'shieldFx' },
    { tier: 20, formName: 'Cerco', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('circle', 2), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'offense',
      mechanic: [d('@B', 20, 27), pl(2), dsh()],
      description: 'O colosso inspira e a sala vem junto: todo mundo é puxado para perto, sem escudo e já apanhando.',
      fxShape: 'nova' },
    { tier: 30, formName: 'Colosso', paCost: 5, cooldown: 4, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('circle', 3), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'offense',
      mechanic: [d('@A', 26, 35), d('@B', 20, 27), rt(2), dsh()],
      description: 'A fusão para de conjurar e simplesmente ACONTECE: três células de raio de puro impacto arcano, sem escudo e sem saída.',
      fxShape: 'nova' }
  ];

  // --- CURANDEIRA + ESPADACHIM — Bisturi Dançante -------------------------
  // Assinatura: velocidade + roubo de vida + limpeza; barato e sem parar.
  F['curandeira+espadachim'] = [
    { tier: 0, formName: 'Lanho', paCost: 2, cooldown: 0, castsPerTurn: 2,
      range: rng(1, 1), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [dl('@A', 12, 17)],
      description: 'Um lanho raso e exato, do jeito que quem sabe costurar também sabe abrir. Barato: dá para repetir.',
      fxShape: 'slam' },
    { tier: 5, formName: 'Pulso', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(0, 4), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [hl(20, 27), cl(['poison', 'root'])],
      description: 'Dois dedos no pulso do aliado: descobre o que está errado e arranca aquilo no mesmo movimento.',
      fxShape: 'heal' },
    { tier: 12, formName: 'Bisturi', paCost: 4, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 2), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [dl('@B', 22, 29), pz('@A', 6, 10, 2)],
      description: 'Corte cirúrgico entre duas costelas: tira vida, entrega veneno e devolve saúde para quem cortou.',
      fxShape: 'slam' },
    { tier: 20, formName: 'Fôlego', paCost: 3, cooldown: 4, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [bf('pa', 1, 1), bf('pp', 2, 2), iv(1)],
      description: 'A fusão respira fundo uma vez só e ganha um turno inteiro de vantagem — e some enquanto o faz.',
      fxShape: 'buff' },
    { tier: 30, formName: 'Carrossel', paCost: 5, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 3), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [mv(5), dl('@A', 26, 35), dl('@B', 18, 25), iv(1)],
      description: 'Entra girando no meio do grupo, abre todo mundo em roda, bebe o que abriu e sai pelo outro lado sem ser vista.',
      fxShape: 'blink' }
  ];

  // --- CURANDEIRA + INVOCADOR — Jardim Sagrado ----------------------------
  // Assinatura: planta coisas que cuidam sozinhas — guardiões, cercados, campos.
  F['curandeira+invocador'] = [
    { tier: 0, formName: 'Broto', paCost: 3, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('single', 0), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [sm('fus-bloom-warden')],
      description: 'A fusão enterra uma semente na palma da mão e a entrega ao chão: em um instante o broto já sabe cuidar.',
      fxShape: 'summonFx' },
    { tier: 5, formName: 'Orvalho', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(0, 5), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [hl(18, 25), rg(7, 10, 3)],
      description: 'Cai um orvalho morno sobre o grupo: cura pouco de uma vez e muito ao longo do tempo.',
      fxShape: 'heal' },
    { tier: 12, formName: 'Cercado', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('single', 0), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [tr('fus-trap-bloom', 4)],
      description: 'Um cercado de gavinhas enrolado embaixo da terra, pronto para fechar em quem passar por cima.',
      fxShape: 'summonFx' },
    { tier: 20, formName: 'Santuário', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('circle', 2), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [hl(24, 33), sh(25, 2), cl(['poison', 'root'])],
      description: 'O jardim inteiro floresce ao redor da fusão: quem estiver dentro do santuário sara, endurece e se limpa.',
      fxShape: 'heal' },
    { tier: 30, formName: 'Pomar', paCost: 5, cooldown: 4, castsPerTurn: 1,
      range: rng(0, 5), aoe: aoe('circle', 2), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [hl(30, 41), rg(12, 17, 3), sh(30, 2), sm('fus-bloom-warden')],
      description: 'Não é um feitiço, é uma estação: o pomar abre em cima do grupo, cura, blinda, continua curando e ainda deixa um guarda plantado.',
      fxShape: 'summonFx' }
  ];

  // --- CURANDEIRA + SUMO — Baluarte Compassivo ----------------------------
  // Assinatura: escudo grande + provocar + PUXAR O ALIADO para trás da muralha.
  F['curandeira+sumo'] = [
    { tier: 0, formName: 'Amparo', paCost: 2, cooldown: 1, castsPerTurn: 2,
      range: rng(0, 5), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [sh(25, 2)],
      description: 'A fusão bate no próprio peito e a casca sobra para o aliado: escudo barato e imediato.',
      fxShape: 'shieldFx' },
    { tier: 5, formName: 'Chamado', paCost: 2, cooldown: 2, castsPerTurn: 1,
      range: rng(2, 6), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [pl(3), sh(15, 2)],
      description: 'Grita o nome do aliado e o puxa três células para trás da muralha — resgate no meio do cerco.',
      fxShape: 'hook' },
    { tier: 12, formName: 'Muro', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'offense',
      mechanic: [d('@A', 18, 25), ps(2)],
      description: 'O muro avança um palmo e todo mundo em volta descobre que estava perto demais.',
      fxShape: 'nova' },
    { tier: 20, formName: 'Juramento', paCost: 4, cooldown: 4, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [tn(2), sh(55, 2), rf(25, 2), rg(8, 12, 3)],
      description: 'O juramento é simples: hoje ninguém passa. Provoca a sala inteira, veste escudo grosso e devolve parte de cada golpe.',
      fxShape: 'shieldFx' },
    { tier: 30, formName: 'Sacrário', paCost: 5, cooldown: 4, castsPerTurn: 1,
      range: rng(0, 5), aoe: aoe('circle', 2), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [hl(30, 41), sh(45, 3), cl(['poison', 'root']), rs('@A', 25, 2)],
      description: 'A fusão abre os braços e o grupo inteiro cabe dentro: cura funda, escudo grosso, limpeza e couro contra o elemento que mais dói.',
      fxShape: 'shieldFx' }
  ];

  // --- ESPADACHIM + INVOCADOR — Sombra Multiplicada -----------------------
  // Assinatura: gêmeos de breu + espinhos escondidos; veneno vindo de todo lado.
  F['espadachim+invocador'] = [
    { tier: 0, formName: 'Vulto', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('single', 0), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [sm('fus-shade-twin')],
      description: 'A fusão descola a própria sombra do chão e a manda trabalhar sozinha.',
      fxShape: 'summonFx' },
    { tier: 5, formName: 'Espinho', paCost: 3, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('single', 0), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [tr('fus-trap-venom', 4)],
      description: 'Um espinho fino largado onde a luz não bate, com veneno guardado na ponta.',
      fxShape: 'summonFx' },
    { tier: 12, formName: 'Golpe', paCost: 4, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 2), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 20, 27), pz('@B', 8, 12, 3)],
      description: 'O golpe verdadeiro vem de onde ninguém contou corpo — e deixa veneno para lembrar disso.',
      fxShape: 'slam' },
    { tier: 20, formName: 'Breu', paCost: 4, cooldown: 4, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [iv(2), bf('dodge', 20, 2), sm('fus-shade-twin')],
      description: 'A fusão apaga a si mesma e acende um gêmeo no lugar: agora o inimigo tem que adivinhar qual dos dois vai doer.',
      fxShape: 'veil' },
    { tier: 30, formName: 'Cortejo', paCost: 5, cooldown: 4, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [sm('fus-shade-twin'), d('@A', 24, 33), pz('@B', 12, 17, 3), tr('fus-trap-venom', 4)],
      description: 'O cortejo chega junto: gêmeo pela frente, veneno pelos lados e um espinho deixado no chão para o caminho de volta.',
      fxShape: 'burst' }
  ];

  // --- ESPADACHIM + SUMO — Investida Titânica -----------------------------
  // Assinatura: peso em movimento — investe de longe, agarra, gira e arremessa.
  F['espadachim+sumo'] = [
    { tier: 0, formName: 'Encontrão', paCost: 3, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [mv(3), d('@A', 15, 21)],
      description: 'A fusão simplesmente vem: atravessa a distância correndo e o ombro chega antes do resto.',
      fxShape: 'slam' },
    { tier: 5, formName: 'Agarrão', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 3), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [pl(2), rt(1), d('@B', 12, 17)],
      description: 'Agarra pela roupa, traz para perto e planta os pés do infeliz no chão: agora a conversa é aqui.',
      fxShape: 'hook' },
    { tier: 12, formName: 'Arranco', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 2), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 24, 31), ps(3)],
      description: 'Levanta o inimigo pelo tronco e o arremessa três células — de preferência contra a quina de alguma coisa.',
      fxShape: 'gust' },
    { tier: 20, formName: 'Rodopio', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'offense',
      mechanic: [d('@A', 22, 29), ps(3)],
      description: 'A fusão gira uma vez só com os braços abertos e a roda inteira sai voando junto.',
      fxShape: 'nova' },
    { tier: 30, formName: 'Impacto', paCost: 5, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 6), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [mv(6), d('@A', 30, 41), d('@B', 18, 25), ps(2), rt(2)],
      description: 'Seis células de corrida e uma tonelada de chegada: o chão afunda, o alvo apaga e a vizinhança fica presa nos escombros.',
      fxShape: 'slam' }
  ];

  // --- INVOCADOR + SUMO — Fortaleza Viva ----------------------------------
  // Assinatura: o "tanque que invoca" — provoca, ergue ídolos e reparte escudo.
  F['invocador+sumo'] = [
    { tier: 0, formName: 'Guardião', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 3), aoe: aoe('single', 0), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [sm('fus-bulwark-idol')],
      description: 'A fusão arranca um pedaço da própria couraça e o finca no chão: vira ídolo, e o ídolo tem opinião sobre quem passa.',
      fxShape: 'summonFx' },
    { tier: 5, formName: 'Brado', paCost: 2, cooldown: 3, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [tn(2), sh(35, 2)],
      description: 'Duas gargantas gritando a mesma coisa: a sala inteira vira a cara para a fusão, que já está de escudo vestido.',
      fxShape: 'shieldFx' },
    { tier: 12, formName: 'Baluarte', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(0, 4), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [sh(40, 2), rs('@A', 20, 2)],
      description: 'Ergue um baluarte em volta do aliado: casca grossa e couro contra o elemento que está doendo mais.',
      fxShape: 'shieldFx' },
    { tier: 20, formName: 'Anel', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('circle', 2), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'offense',
      mechanic: [d('@A', 20, 27), pl(2), rt(1)],
      description: 'A fortaleza fecha o anel: puxa todo mundo para dentro do alcance e prega os pés no lugar onde caíram.',
      fxShape: 'nova' },
    { tier: 30, formName: 'Alicerce', paCost: 5, cooldown: 4, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [sm('fus-bulwark-idol'), tn(2), sh(70, 3), rf(35, 2)],
      description: 'A fusão vira alicerce de construção: um ídolo novo de pé ao lado, a sala inteira obrigada a bater nela e cada golpe voltando pela metade.',
      fxShape: 'shieldFx' }
  ];

  // ---- fim dos blocos de formas ----

  // =========================================================================
  // 4. PAYLOADS: armadilhas e feitiços dos invocados de fusão
  //    (mesclar em DATA.spells — element sempre 'neutro', pois a forma é
  //     independente da mistura elemental)
  // =========================================================================
  function payload(id, name, effects, description, fxKey) {
    return {
      id: id, name: name, element: 'neutro', classId: null, unlockLevel: 0,
      paCost: 0, cooldown: 0, castsPerTurn: 0,
      range: rng(0, 1), aoe: aoe('single', 0), needsEmptyTile: false,
      targetSide: 'enemy', effects: effects, description: description,
      flavor: 'Obra de um corpo que era dois.', fxKey: fxKey
    };
  }

  DATA.fusionSpells = {
    'fus-trap-arrow': payload('fus-trap-arrow', 'Cravo de Aljava',
      [d('neutro', 16, 22), rt(1)],
      'A armadilha de aljava dispara de baixo para cima e prega o pé de quem pisou.', 'burst'),
    'fus-trap-hex': payload('fus-trap-hex', 'Selo Rúnico',
      [d('neutro', 14, 19), pz('neutro', 6, 9, 2)],
      'O selo desenhado no chão acende ao ser pisado e continua roendo depois.', 'debuff'),
    'fus-trap-bloom': payload('fus-trap-bloom', 'Cercado Vivo',
      [rt(2), d('neutro', 10, 14)],
      'Gavinhas fecham o cercado em volta do tornozelo do intruso.', 'hook'),
    'fus-trap-venom': payload('fus-trap-venom', 'Espinho de Breu',
      [pz('neutro', 8, 12, 3), d('neutro', 8, 12)],
      'Um espinho invisível deixado na sombra: entra fácil e demora a sair.', 'poisonCloud'),

    'fus-turret-shot': (function () {
      var s = payload('fus-turret-shot', 'Tiro de Torre', [d('neutro', 12, 16)],
        'A torre de aljava dispara sozinha em quem entrar no alcance.', 'bolt');
      s.paCost = 3; s.castsPerTurn = 2; s.range = rng(1, 6);
      return s;
    })(),
    'fus-effigy-hex': (function () {
      var s = payload('fus-effigy-hex', 'Praga da Efígie', [d('neutro', 10, 14), mk(5, 2, 3)],
        'A efígie aponta o dedo de cera e marca o alvo para a fusão.', 'debuff');
      s.paCost = 3; s.castsPerTurn = 1; s.range = rng(1, 5);
      return s;
    })(),
    'fus-warden-mend': (function () {
      var s = payload('fus-warden-mend', 'Rega do Guarda-Flor', [hl(14, 18), rg(5, 8, 2)],
        'O guarda-flor entorna seiva morna sobre o aliado mais machucado.', 'heal');
      s.paCost = 3; s.castsPerTurn = 1; s.range = rng(0, 4); s.targetSide = 'ally';
      return s;
    })(),
    'fus-shade-cut': (function () {
      var s = payload('fus-shade-cut', 'Corte do Gêmeo', [d('neutro', 11, 15), pz('neutro', 4, 6, 2)],
        'O gêmeo de breu corta de lado e some antes da resposta.', 'slam');
      s.paCost = 3; s.castsPerTurn = 2; s.range = rng(1, 1);
      return s;
    })(),
    'fus-idol-slam': (function () {
      var s = payload('fus-idol-slam', 'Escora do Ídolo', [d('neutro', 14, 19), ps(1)],
        'O ídolo-escora despenca o braço de pedra e abre espaço.', 'slam');
      s.paCost = 3; s.castsPerTurn = 1; s.range = rng(1, 1);
      return s;
    })()
  };

  // =========================================================================
  // 5. INVOCADOS DE FUSÃO (mesclar em DATA.monsters)
  // =========================================================================
  function summonDef(id, name, hp, pa, pp, ini, ai, spells, traits, description) {
    return {
      id: id, name: name, family: 'Obra de Fusão', description: description,
      stats: { hp: hp, pa: pa, pp: pp, initiative: ini, power: 0,
               resists: { fogo: 0, agua: 0, terra: 0, ar: 0, neutro: 0 } },
      spells: spells, ai: ai, traits: traits || [],
      boss: false, summonOnly: true, xp: 0
    };
  }

  DATA.fusionSummons = {
    'fus-arrow-turret': summonDef('fus-arrow-turret', 'Torre de Aljava', 40, 6, 0, 30, 'ranged',
      ['fus-turret-shot'], [{ type: 'pushImmune' }],
      'Um tripé de flechas espetadas no chão que criou vontade própria: gira devagar, mira sempre e não anda.'),
    'fus-hex-effigy': summonDef('fus-hex-effigy', 'Efígie Rúnica', 45, 6, 2, 40, 'ranged',
      ['fus-effigy-hex'], [],
      'Boneco de cera e giz com runas escritas de trás para frente. Aponta o dedo e o alvo sente o dedo.'),
    'fus-bloom-warden': summonDef('fus-bloom-warden', 'Guarda-Flor', 50, 6, 2, 45, 'support',
      ['fus-warden-mend'], [{ type: 'regenAura', value: 6, radius: 2 }],
      'Um botão de flor do tamanho de um cão, com pétalas em forma de mão em concha. Rega quem sangra.'),
    'fus-shade-twin': summonDef('fus-shade-twin', 'Gêmeo de Breu', 35, 6, 4, 70, 'melee',
      ['fus-shade-cut'], [],
      'A sombra da fusão descolada do chão, com meia lâmina e nenhum rosto. Anda meio passo à frente do original.'),
    'fus-bulwark-idol': summonDef('fus-bulwark-idol', 'Ídolo-Escora', 75, 6, 1, 15, 'melee',
      ['fus-idol-slam'], [{ type: 'pushImmune' }],
      'Meio pilar entalhado com a cara das duas classes fundidas. Fica no caminho — é o trabalho inteiro dele.')
  };

  // =========================================================================
  // 6. ESPELHAMENTO DAS MISTURAS
  //    A engine pode montar a chave na ordem dos dois fundidos (A, B). Para que
  //    '@A'/'@B' resolvam sempre no elemento certo, cada mistura mista ganha a
  //    chave invertida com `elements` também invertido.
  // =========================================================================
  function cloneEffects(list) {
    var out = [], i, k, src, cp;
    for (i = 0; i < list.length; i++) {
      src = list[i]; cp = {};
      for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) {
        cp[k] = (Object.prototype.toString.call(src[k]) === '[object Array]') ? src[k].slice() : src[k];
      }
      out.push(cp);
    }
    return out;
  }

  (function mirrorBlends() {
    var keys = Object.keys(DATA.fusionBlends), i, k, parts, rk, b;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      parts = k.split('+');
      if (parts[0] === parts[1]) continue;
      rk = parts[1] + '+' + parts[0];
      if (DATA.fusionBlends[rk]) continue;
      b = DATA.fusionBlends[k];
      DATA.fusionBlends[rk] = {
        id: rk, affix: b.affix, elements: [b.elements[1], b.elements[0]],
        description: b.description,
        rider: cloneEffects(b.rider), riderSupport: cloneEffects(b.riderSupport),
        palette: { primary: b.palette.primary, secondary: b.palette.secondary, accent: b.palette.accent },
        fxKey: b.fxKey, mirrorOf: k
      };
    }
  })();

})();
