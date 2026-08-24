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
  function wl(dur) { return { type: 'wall', duration: dur }; }   // v3: verbo BARRAR
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
    'arqueiro+curandeiro': { name: 'Arco Votivo',          line: 'Flechas que atravessam a fila em linha reta e devolvem ao corpo fundido cada gota que tiram.' },
    'arqueiro+espadachim': { name: 'Caçador de Sombras',   line: 'Atira do breu, salta para cima do alvo marcado e executa: invisibilidade + reposicionamento + marcas.' },
    'arqueiro+invocador':  { name: 'Torreta Viva',         line: 'Planta totens atiradores e cravos-armadilha; os tiros saltam entre os presos.' },
    'arqueiro+sumo':       { name: 'Balista de Carne',     line: 'Cerco: projéteis pesados que empurram, arpéus que puxam e uma âncora que ninguém tira do lugar.' },
    'bruxo+curandeiro':    { name: 'Praga Piedosa',        line: 'Transfusão: tudo que tira do inimigo vira vida própria; benção de um lado, apodrecimento do outro.' },
    'bruxo+espadachim':    { name: 'Lâmina Rúnica',        line: 'Pisca pelo campo deixando explosões nas partidas e chegadas, com veneno arcano na lâmina.' },
    'bruxo+invocador':     { name: 'Sabá das Armadilhas',  line: 'Ritual: selos acesos sob os pés do inimigo, círculos deixados de emboscada, efígies que amaldiçoam e o clima virado à força.' },
    'bruxo+sumo':          { name: 'Colosso Arcano',       line: 'A magia não é lançada, é irradiada: tudo ao redor do corpo apanha, prende e devolve o golpe.' },
    'curandeiro+espadachim': { name: 'Bisturi Dançante',   line: 'Cortes rápidos com roubo de vida, cura de emergência entre um passo e outro, e some no meio do turno.' },
    'curandeiro+invocador':{ name: 'Jardim Sagrado',       line: 'Planta a semente DENTRO do inimigo e o jardim cobra depois: espinheiro em volta, cercado de emboscada, e guardiões que curam o que sobrou.' },
    'curandeiro+sumo':     { name: 'Baluarte Compassivo',  line: 'Muralha que se cura batendo: arrasta o inimigo para dentro do alcance, bebe o que arranca e reparte o excedente com quem sangra.' },
    'espadachim+invocador':{ name: 'Sombra Multiplicada',  line: 'A própria sombra corta primeiro; depois vêm os espinhos escondidos e os gêmeos de breu — veneno de três lugares ao mesmo tempo.' },
    'espadachim+sumo':     { name: 'Investida Titânica',   line: 'Peso em movimento: investe de longe, agarra, gira e arremessa — e o chão fica marcado.' },
    'invocador+sumo':      { name: 'Fortaleza Viva',       line: 'Tanque que invoca: o brado machuca e provoca a sala inteira, os ídolos de escora caem batendo e o resto do grupo vai coberto de escudo.' }
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
      rider: [d('agua', 4, 6), d('ar', 3, 5), ps(1)],
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
      rider: [d('agua', 3, 5), d('neutro', 2, 3), dsh()],
      riderSupport: [rg(4, 6, 2)],
      palette: { primary: '#527d8c', secondary: '#232f36', accent: '#c9dde4' },
      fxKey: 'blend-turvo'
    },
    'agua+terra': {
      id: 'agua+terra', affix: 'Lamacento', elements: ['agua', 'terra'],
      description: 'Água e terra dão lama: pesa nos pés de quem apanha e cola o inimigo no chão por um instante.',
      rider: [d('terra', 4, 6), d('agua', 3, 4), rt(1)],
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
      rider: [d('fogo', 5, 7), d('ar', 3, 5), ps(1)],
      riderSupport: [bf('power', 12, 2)],
      palette: { primary: '#ff8c3a', secondary: '#4a2418', accent: '#ffe08a' },
      fxKey: 'blend-incendiario'
    },
    'ar+neutro': {
      id: 'ar+neutro', affix: 'Ligeiro', elements: ['ar', 'neutro'],
      description: 'Sem elemento definido do outro lado, sobra pressa: o golpe é leve, mas chega antes e desarruma a formação.',
      rider: [d('ar', 3, 5), d('neutro', 2, 3), ps(1)],
      riderSupport: [bf('pp', 1, 1)],
      palette: { primary: '#b9c9d0', secondary: '#39424a', accent: '#f2fbff' },
      fxKey: 'blend-ligeiro'
    },
    'ar+terra': {
      id: 'ar+terra', affix: 'Arenoso', elements: ['ar', 'terra'],
      description: 'Rivais fundidos viram tempestade de areia: o grão entra na ferida e faz doer tudo o que vier depois.',
      rider: [d('ar', 3, 5), d('terra', 3, 4), mk(5, 2, 3)],
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
      rider: [d('fogo', 4, 6), d('neutro', 2, 4)],
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
      rider: [d('terra', 3, 5), d('neutro', 2, 3), rt(1)],
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
  // 3. FORMAS POR DUPLA DE CLASSE — 15 duplas × 7 tiers (0, 5, 10, 12, 15, 20, 30)
//    Os degraus 10 e 15 entraram depois: sem eles a dupla fundida passava do nível 12
//    ao 19 sem ganhar nada, enquanto cada classe ganhava feitiço em 10 e em 15.
//    São os únicos que usam as áreas cross/cone/ring do motor.
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
    { tier: 10, formName: 'Virote', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 8, true), aoe: aoe('line', 3), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@B', 15, 20), mk(5, 3, 5)],
      description: 'Um virote encantado atravessa a fila inteira e deixa o mesmo sinal em cada um que furou.',
      fxShape: 'beam' },
    { tier: 12, formName: 'Estilhaço', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(2, 9), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [ch(2, 0.6, '@B', 15, 20), mk(6, 3, 5)],
      description: 'Um estilhaço de vidro encantado pula de inimigo em inimigo, perdendo força e ganhando ódio.',
      fxShape: 'beam' },
    { tier: 15, formName: 'Estampido', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 6), aoe: aoe('cone', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 17, 23), dm(6)],
      description: 'O ar racha num leque a partir do alvo e parte dos sinais deixados antes estoura junto.',
      fxShape: 'burst' },
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
  F['arqueiro+curandeiro'] = [
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
    { tier: 10, formName: 'Terço', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 7, true), aoe: aoe('line', 3), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [dl('@B', 15, 20), rg(5, 8, 2)],
      description: 'Uma conta do terço por inimigo na fila: o que cada uma cobra volta pingando no corpo fundido.',
      fxShape: 'beam' },
    { tier: 12, formName: 'Fio', paCost: 4, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 6, true), aoe: aoe('line', 5), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [dl('@B', 16, 22)],
      description: 'Um fio de luz esticado de ponta a ponta da fila inimiga: cada corpo atravessado devolve um gole de vida.',
      fxShape: 'beam' },
    { tier: 15, formName: 'Círio', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 6), aoe: aoe('ring', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [dl('@A', 18, 24), hl(14, 19)],
      description: 'Acende um círio no chão: a coroa de luz queima quem está na borda e o calor volta como cura.',
      fxShape: 'nova' },
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
    { tier: 10, formName: 'Recuo', paCost: 3, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 3), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 17, 23), mv(3), bf('dodge', 12, 1)],
      description: 'Acerta e já não está mais lá: o corpo fundido desliza para trás antes de o troco chegar.',
      fxShape: 'slash' },
    { tier: 12, formName: 'Talho', paCost: 4, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 2), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@B', 20, 27), mk(6, 2, 4)],
      description: 'Corte na altura da guarda: abre o alvo e deixa a abertura aberta para o próximo tiro.',
      fxShape: 'slam' },
    { tier: 15, formName: 'Rastro', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 6), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@B', 19, 26), mk(6, 3, 5), bf('pp', 1, 1)],
      description: 'Fareja o rastro do alvo, marca onde ele vai pisar e ganha fôlego para chegar antes.',
      fxShape: 'beam' },
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
      description: 'A fusão finca o totem no chão e sopra: o olho abre e os dois canos procuram alvo.',
      fxShape: 'summonFx' },
    { tier: 10, formName: 'Piquete', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 6), aoe: aoe('cross', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 15, 21), rt(1)],
      description: 'Quatro fileiras de estaca sobem em cruz do chão e fecham as saídas de quem estava no meio.',
      fxShape: 'burst' },
    { tier: 12, formName: 'Cravo', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('circle', 1), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'offense',
      mechanic: [tr('fus-trap-arrow', 4), d('@B', 12, 17)],
      description: 'Um cravo de caça enterrado com a ponta para cima, esperando o passo errado — e a martelada que o enterra já espalha lascas na vizinhança.',
      fxShape: 'summonFx' },
    { tier: 15, formName: 'Fosso', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('circle', 1), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'offense',
      mechanic: [tr('fus-trap-arrow', 5), d('@B', 12, 17), pl(2)],
      description: 'Cava um fosso eriçado e assobia: quem ouve vem ver de perto, e vê por dentro.',
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
      description: 'A fusão despeja um arsenal inteiro numa célula só: sobe o totem, some cravo no chão e o estouro da entrega já castiga a vizinhança.',
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
    { tier: 10, formName: 'Rojão', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(2, 8), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 16, 22), ps(1)],
      description: 'Um rojão gordo sobe em arco e desce onde ninguém queria: o estouro afasta todo mundo um passo.',
      fxShape: 'burst' },
    { tier: 12, formName: 'Aríete', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 6, true), aoe: aoe('line', 5), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 18, 25), ps(2), rt(1)],
      description: 'Uma tora de cerco disparada em linha: varre a fila, empurra todo mundo junto e deixa os pés presos onde pararam.',
      fxShape: 'beam' },
    { tier: 15, formName: 'Contrapeso', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 3), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@B', 18, 24), sh(25, 2), bf('lock', 15, 2)],
      description: 'A fusão joga o peso do corpo para a frente e planta os pés: quem está perto apanha e ninguém mais escapa.',
      fxShape: 'slam' },
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
  F['bruxo+curandeiro'] = [
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
    { tier: 10, formName: 'Cilício', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 6), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [dl('@B', 16, 22), pz('@A', 6, 9, 2)],
      description: 'Aperta o cilício à distância: o que o alvo perde de sangue a fusão ganha, e a ferida continua trabalhando.',
      fxShape: 'bolt' },
    { tier: 12, formName: 'Estigma', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 6), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [pz('@B', 9, 13, 3), dsh()],
      description: 'Um estigma aberto na pele de todos ao redor do alvo: come escudo primeiro, carne depois, sem pressa.',
      fxShape: 'debuff' },
    { tier: 15, formName: 'Legado', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [dl('@A', 18, 24), rg(6, 9, 2)],
      description: 'Cobra de todos em volta de uma vez e reparte o que arrancou como se fosse herança.',
      fxShape: 'nova' },
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
    { tier: 10, formName: 'Risco', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 5, true), aoe: aoe('line', 3), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 16, 22), pz('@B', 6, 9, 2)],
      description: 'Um risco de runa cortando a fila inteira, e a tinta que fica na ferida não para de arder.',
      fxShape: 'slash' },
    { tier: 12, formName: 'Estilete', paCost: 4, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 3), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@B', 22, 29), pz('@A', 7, 11, 3)],
      description: 'Um estilete fino demais para ser visto, molhado num feitiço que não tem antídoto conhecido.',
      fxShape: 'slam' },
    { tier: 15, formName: 'Sulco', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('cone', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@B', 18, 25), pz('@A', 7, 11, 3)],
      description: 'A lâmina abre um sulco em leque no chão e o veneno escorre por ele até encontrar pé descalço.',
      fxShape: 'burst' },
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
    { tier: 0, formName: 'Selo', paCost: 3, cooldown: 0, castsPerTurn: 2,
      range: rng(1, 5), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 15, 20), rt(1)],
      description: 'O selo não é desenhado no chão: é desenhado SOB o inimigo, e acende no mesmo instante. Quem assina não sai mais de onde assinou.',
      fxShape: 'burst' },
    { tier: 5, formName: 'Círculo', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('single', 0), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [tr('fus-trap-hex', 4)],
      description: 'Um círculo de giz e cinza deixado fechado no chão, esperando um pé descuidado para se abrir.',
      fxShape: 'summonFx' },
    { tier: 10, formName: 'Terreiro', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('ring', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 16, 22), rt(1)],
      description: 'Risca um terreiro fechado no chão: quem está na linha não sai dela até o ritual acabar.',
      fxShape: 'nova' },
    { tier: 12, formName: 'Coro', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('circle', 1), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'offense',
      mechanic: [sm('fus-hex-effigy'), d('@B', 14, 19)],
      description: 'A fusão modela uma efígie de cera com as duas caras dela; a primeira nota do coro sai da boneca e racha o ar em volta.',
      fxShape: 'summonFx' },
    { tier: 15, formName: 'Enterro', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('circle', 1), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'offense',
      mechanic: [tr('fus-trap-hex', 5), pz('@B', 8, 12, 3)],
      description: 'Enterra a segunda armadilha ao lado da primeira e cospe na cova: o chão em volta já começa a apodrecer.',
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
    { tier: 10, formName: 'Estrondo', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('cross', 3), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'offense',
      mechanic: [d('@A', 17, 23), ps(1)],
      description: 'Quatro ondas de choque saem do corpo em cruz e varrem a sala até a parede, empurrando o que encontram.',
      fxShape: 'nova' },
    { tier: 12, formName: 'Espelho', paCost: 3, cooldown: 4, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [rf(30, 2), sh(30, 2)],
      description: 'A pele vira espelho encantado: parte do que bate nela volta pelo mesmo caminho, com juros.',
      fxShape: 'shieldFx' },
    { tier: 15, formName: 'Bramido', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('cone', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@B', 19, 26), dsh()],
      description: 'Um bramido em leque que arranca a casca mágica de todos que pegou pela frente.',
      fxShape: 'burst' },
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
  F['curandeiro+espadachim'] = [
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
    { tier: 10, formName: 'Retalho', paCost: 3, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 2), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [dl('@B', 17, 23), bf('pp', 1, 1)],
      description: 'Corta, costura o próprio corte e já está um passo adiante do sangue que caiu.',
      fxShape: 'slash' },
    { tier: 12, formName: 'Bisturi', paCost: 4, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 2), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [dl('@B', 22, 29), pz('@A', 6, 10, 2)],
      description: 'Corte cirúrgico entre duas costelas: tira vida, entrega veneno e devolve saúde para quem cortou.',
      fxShape: 'slam' },
    { tier: 15, formName: 'Compasso', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 3), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [mv(3), dl('@A', 18, 24), dl('@B', 12, 17)],
      description: 'Fecha o compasso em cima do alvo e abre duas vezes: os dois elementos cobram na mesma volta.',
      fxShape: 'slash' },
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
  F['curandeiro+invocador'] = [
    { tier: 0, formName: 'Broto', paCost: 3, cooldown: 0, castsPerTurn: 2,
      range: rng(1, 4), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 14, 19), pz('@B', 5, 8, 2)],
      description: 'A semente não é plantada no chão: é plantada no inimigo. Brota por dentro dele e continua crescendo depois do golpe.',
      fxShape: 'burst' },
    { tier: 5, formName: 'Orvalho', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(0, 5), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [hl(18, 25), rg(7, 10, 3)],
      description: 'Cai um orvalho morno sobre o grupo: cura pouco de uma vez e muito ao longo do tempo.',
      fxShape: 'heal' },
    { tier: 10, formName: 'Viveiro', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('cross', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 16, 21), pz('@B', 7, 10, 3)],
      description: 'Quatro canteiros brotam em cruz de uma vez, e o que cresce neles não é para comer.',
      fxShape: 'burst' },
    { tier: 12, formName: 'Cercado', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('circle', 1), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'offense',
      mechanic: [tr('fus-trap-bloom', 4), d('@B', 13, 18)],
      description: 'O cercado de gavinhas irrompe do chão para ficar de emboscada — e a irrupção já pega quem estava perto demais da terra revolvida.',
      fxShape: 'summonFx' },
    { tier: 15, formName: 'Enxerto', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(0, 4), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [hl(26, 34), sh(28, 2)],
      description: 'Um enxerto vivo preso na ferida do aliado: fecha o rombo e ainda cria casca por cima.',
      fxShape: 'shieldFx' },
    { tier: 20, formName: 'Espinheiro', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('circle', 2), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'offense',
      mechanic: [d('@A', 20, 27), pz('@B', 8, 12, 3), rt(1)],
      description: 'O jardim inteiro fecha em espinheiro ao redor da fusão: duas células de raio de sarça viva que fura, envenena e segura pelo tornozelo.',
      fxShape: 'nova' },
    { tier: 30, formName: 'Pomar', paCost: 5, cooldown: 4, castsPerTurn: 1,
      range: rng(0, 5), aoe: aoe('circle', 2), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [hl(30, 41), rg(12, 17, 3), sh(30, 2), sm('fus-bloom-warden')],
      description: 'Não é um feitiço, é uma estação: o pomar abre em cima do grupo, cura, blinda, continua curando e ainda deixa um guarda plantado.',
      fxShape: 'summonFx' }
  ];

  // --- CURANDEIRA + SUMO — Baluarte Compassivo ----------------------------
  // Assinatura: escudo grande + provocar + PUXAR O ALIADO para trás da muralha.
  F['curandeiro+sumo'] = [
    { tier: 0, formName: 'Anteparo', paCost: 3, cooldown: 0, castsPerTurn: 2,
      range: rng(1, 1), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [dl('@A', 16, 22)],
      description: 'O mesmo braço que ampara o aliado desce como anteparo no inimigo: o que ele arranca volta em fôlego para o corpo fundido.',
      fxShape: 'slam' },
    { tier: 5, formName: 'Chamado', paCost: 3, cooldown: 1, castsPerTurn: 1,
      range: rng(2, 6), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [pl(2), dl('@B', 14, 19)],
      description: 'A muralha chama pelo nome e o inimigo obedece: é arrastado duas células para dentro do alcance e paga a viagem em vida.',
      fxShape: 'hook' },
    { tier: 10, formName: 'Esteio', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(0, 3), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [sh(35, 2), rg(6, 9, 2)],
      description: 'Encosta o ombro no aliado e vira esteio dele: enquanto a fusão aguentar, ele não cai.',
      fxShape: 'shieldFx' },
    { tier: 12, formName: 'Muro', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(0, 0, false, false), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'offense',
      mechanic: [d('@A', 18, 25), ps(2)],
      description: 'O muro avança um palmo e todo mundo em volta descobre que estava perto demais.',
      fxShape: 'nova' },
    { tier: 15, formName: 'Redil', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('ring', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 18, 24), pl(2)],
      description: 'Fecha o redil: todos que estavam soltos na borda vêm para dentro, apanhando no caminho.',
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
    { tier: 0, formName: 'Vulto', paCost: 3, cooldown: 0, castsPerTurn: 2,
      range: rng(1, 3), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 15, 20), pz('@B', 5, 8, 2)],
      description: 'A sombra da fusão se descola do chão, passa cortando pelo lado do inimigo e volta antes de alguém contar quantos corpos havia ali.',
      fxShape: 'slam' },
    { tier: 5, formName: 'Espinho', paCost: 3, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('single', 0), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [tr('fus-trap-venom', 4)],
      description: 'Um espinho fino largado onde a luz não bate, com veneno guardado na ponta.',
      fxShape: 'summonFx' },
    { tier: 10, formName: 'Ferrão', paCost: 3, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 3), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 17, 23), pz('@B', 7, 10, 3)],
      description: 'O ferrão entra rápido e sai mais rápido ainda; o que ele deixou dentro é que demora.',
      fxShape: 'slash' },
    { tier: 12, formName: 'Golpe', paCost: 4, cooldown: 1, castsPerTurn: 1,
      range: rng(1, 2), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 20, 27), pz('@B', 8, 12, 3)],
      description: 'O golpe verdadeiro vem de onde ninguém contou corpo — e deixa veneno para lembrar disso.',
      fxShape: 'slam' },
    { tier: 15, formName: 'Espectro', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@B', 18, 25), pz('@A', 7, 11, 2), iv(1)],
      description: 'Ataca com a cara do espectro e some junto com ele: quem sobrou não sabe de onde veio nem para onde foi.',
      fxShape: 'burst' },
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
    { tier: 10, formName: 'Tranco', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [mv(4), d('@B', 17, 23), ps(1)],
      description: 'Atravessa a sala num tranco só e entrega o ombro inteiro na chegada.',
      fxShape: 'slam' },
    { tier: 12, formName: 'Arranco', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 2), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 24, 31), ps(3)],
      description: 'Levanta o inimigo pelo tronco e o arremessa três células — de preferência contra a quina de alguma coisa.',
      fxShape: 'gust' },
    { tier: 15, formName: 'Ricochete', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 2), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 20, 27), ps(2), ch(2, 0.5, '@B', 10, 14)],
      description: 'Usa o inimigo como projétil: ele voa, bate nos outros e o estrago se reparte pelo caminho.',
      fxShape: 'slam' },
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
    { tier: 0, formName: 'Brado', paCost: 3, cooldown: 0, castsPerTurn: 2,
      range: rng(0, 0, false, false), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'offense',
      mechanic: [d('@A', 15, 20), tn(2)],
      description: 'Duas gargantas gritando a mesma coisa a um palmo da cara de todo mundo: o brado machuca quem está em volta e obriga a sala inteira a encarar a fusão.',
      fxShape: 'nova' },
    { tier: 5, formName: 'Guardião', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 3), aoe: aoe('circle', 1), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'offense',
      mechanic: [sm('fus-bulwark-idol'), d('@B', 12, 17)],
      description: 'A fusão arranca um pedaço da própria couraça e o crava no chão: vira ídolo, e a cravada abre o chão de quem estava do lado.',
      fxShape: 'summonFx' },
    { tier: 10, formName: 'Estandarte', paCost: 3, cooldown: 3, castsPerTurn: 1,
      range: rng(0, 3), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [sh(30, 2), bf('power', 15, 2)],
      description: 'Finca o estandarte da fusão: quem luta na sombra do pano bate mais forte e apanha menos.',
      fxShape: 'shieldFx' },
    { tier: 12, formName: 'Baluarte', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(0, 4), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [sh(40, 2), rs('@A', 20, 2)],
      description: 'Ergue um baluarte em volta do aliado: casca grossa e couro contra o elemento que está doendo mais.',
      fxShape: 'shieldFx' },
    { tier: 15, formName: 'Pilar', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('cross', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@B', 19, 26), rt(1)],
      description: 'Um pilar desce do teto e racha o chão em cruz; os pés de quem estava na racha ficam presos nela.',
      fxShape: 'burst' },
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
  // --- ARQUEIRO + MINOTAURO — A Seteira ----------------------------------
  // ACUMULAR + BARRAR: ele atira e continua coberto. O muro nao e obstaculo
  // para quem o ergueu — e a janela por onde ele mira.
  F['arqueiro+minotauro'] = [
    { tier: 0, formName: 'Postigo', paCost: 3, cooldown: 0, castsPerTurn: 2,
      range: rng(2, 7), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 13, 18), mk(5, 3, 5)],
      description: 'Um tiro pela fresta: marca o alvo e volta para trás da pedra antes que ele veja de onde veio.',
      fxShape: 'bolt' },
    { tier: 5, formName: 'Parapeito', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('circle', 1), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [wl(2), d('@B', 14, 19), sh(45, 2)],
      description: 'Ergue a pedra à frente e se encosta nela: sobe empurrando quem estava colado, segura o que vem e o escudo segura o resto.',
      fxShape: 'shieldFx' },
    { tier: 10, formName: 'Enfiada', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(2, 8, true), aoe: aoe('line', 3), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@B', 17, 23), mk(5, 3, 5)],
      description: 'A flecha atravessa a linha inteira e deixa a mesma marca em cada um que estava nela.',
      fxShape: 'beam' },
    { tier: 12, formName: 'Ameia', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('cross', 1), needsEmptyTile: false, targetSide: 'any',
      riderMode: 'support',
      mechanic: [wl(3), bf('power', 20, 2)],
      description: 'Fecha uma cruz de pedra em volta do ponto escolhido e mira dali de cima, com calma.',
      fxShape: 'shieldFx' },
    { tier: 15, formName: 'Rebate', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(2, 7), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 20, 27), dm(1.6)],
      description: 'Detona de longe tudo o que foi marcado, e a pedra em volta devolve o estouro para dentro.',
      fxShape: 'burst' },
    { tier: 20, formName: 'Bastiao', paCost: 5, cooldown: 4, castsPerTurn: 1,
      range: rng(1, 6), aoe: aoe('ring', 2), needsEmptyTile: false, targetSide: 'any',
      riderMode: 'support',
      mechanic: [wl(3), sh(85, 3), bf('power', 25, 3)],
      description: 'Um anel de pedra à distância, e você no meio: ninguém chega, e todo tiro seu sai mais fundo.',
      fxShape: 'shieldFx' },
    { tier: 30, formName: 'Assedio', paCost: 5, cooldown: 5, castsPerTurn: 1,
      range: rng(2, 8), aoe: aoe('ring', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [wl(3), d('@B', 26, 34), dm(2.0), mk(5, 3, 5)],
      description: 'Fecha o anel em volta deles, detona cada marca de uma vez e marca de novo o que sobrou de pé.',
      fxShape: 'nova' }
  ];

  // --- BRUXO + MINOTAURO — A Cratera ------------------------------------
  // ESTOURAR + BARRAR: a explosao deixa borda. O que sobra da area vira parede.
  F['bruxo+minotauro'] = [
    { tier: 0, formName: 'Rebentacao', paCost: 3, cooldown: 0, castsPerTurn: 2,
      range: rng(1, 5), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 15, 20), ps(1)],
      description: 'Estoura o chão em raio curto e empurra para fora quem estava perto demais.',
      fxShape: 'burst' },
    { tier: 5, formName: 'Borda', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('ring', 1), needsEmptyTile: false, targetSide: 'any',
      riderMode: 'support',
      mechanic: [wl(2)],
      description: 'A explosão não abre buraco: levanta a beirada. Um anel de pedra onde antes era caminho.',
      fxShape: 'nova' },
    { tier: 10, formName: 'Fornalha', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('circle', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@B', 19, 26), pz('@B', 6, 9, 2)],
      description: 'Um raio inteiro de calor que fica no chão queimando quem insistir em passar.',
      fxShape: 'burst' },
    { tier: 12, formName: 'Redoma', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(0, 0), aoe: aoe('ring', 2), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [wl(3), sh(70, 3)],
      description: 'Fecha a pedra num anel largo à sua volta e se guarda dentro dela para conjurar em paz.',
      fxShape: 'shieldFx' },
    { tier: 15, formName: 'Desmoronamento', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 6), aoe: aoe('cross', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 23, 30), rt(1)],
      description: 'A pedra vem abaixo em cruz: 0 PP em quem estava embaixo, e poeira no lugar do caminho.',
      fxShape: 'slam' },
    { tier: 20, formName: 'Anfiteatro', paCost: 5, cooldown: 4, castsPerTurn: 1,
      range: rng(1, 6), aoe: aoe('ring', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [wl(3), d('@B', 24, 32), rt(1)],
      description: 'Levanta a arquibancada em volta deles e derruba o teto dentro: presos, e sem plateia.',
      fxShape: 'nova' },
    { tier: 30, formName: 'Vulcao', paCost: 5, cooldown: 5, castsPerTurn: 1,
      range: rng(1, 6), aoe: aoe('circle', 3), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 30, 40), pz('@B', 9, 13, 3), wl(2), ps(2)],
      description: 'Abre a boca do vulcão em raio 3, empurra tudo para longe e fecha a borda com a própria lava fria.',
      fxShape: 'nova' }
  ];

  // --- CURANDEIRO + MINOTAURO — O Abrigo --------------------------------
  // RESTAURAR + BARRAR: o muro cura quem se encosta. Guardar e cuidar viram a
  // mesma coisa — e esta e a dupla mais defensiva do jogo.
  F['curandeiro+minotauro'] = [
    { tier: 0, formName: 'Amparo', paCost: 3, cooldown: 0, castsPerTurn: 2,
      range: rng(0, 4), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [d('@A', 14, 19), hl(16, 22)],
      description: 'Bate com o escudo em quem chegou perto e usa o mesmo gesto para fechar a ferida de quem estava atrás.',
      fxShape: 'heal' },
    { tier: 5, formName: 'Alpendre', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('single', 0), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [wl(2), d('@B', 15, 20), rg(9, 13, 2)],
      description: 'A pedra sobe empurrando quem estava no caminho, e a sombra embaixo dela recupera quem chegar primeiro.',
      fxShape: 'shieldFx' },
    { tier: 10, formName: 'Botica', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(0, 4), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [d('@A', 18, 24), hl(20, 27), cl(['poison'])],
      description: 'O clarão queima quem não devia estar ali e cura quem devia, no mesmo raio.',
      fxShape: 'heal' },
    { tier: 12, formName: 'Claustro', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(0, 0), aoe: aoe('ring', 1), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [wl(3), sh(65, 3), rg(11, 15, 3)],
      description: 'Fecha o claustro à sua volta: pedra por fora, cura por dentro, três turnos de silêncio.',
      fxShape: 'shieldFx' },
    { tier: 15, formName: 'Enfermaria', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('line', 3), needsEmptyTile: false, targetSide: 'any',
      riderMode: 'support',
      mechanic: [wl(3), d('@B', 19, 26), hl(18, 24)],
      description: 'Três pedras sobem na linha: fere quem estava nela e devolve fôlego a quem estava atrás.',
      fxShape: 'heal' },
    { tier: 20, formName: 'Hospicio', paCost: 5, cooldown: 4, castsPerTurn: 1,
      range: rng(0, 5), aoe: aoe('circle', 2), needsEmptyTile: false, targetSide: 'ally',
      riderMode: 'support',
      mechanic: [d('@A', 24, 32), hl(28, 37), sh(80, 3)],
      description: 'A onda sai de dentro do abrigo: machuca quem cercava e cura e escuda quem estava dentro.',
      fxShape: 'heal' },
    { tier: 30, formName: 'Santuario', paCost: 5, cooldown: 5, castsPerTurn: 1,
      range: rng(0, 0), aoe: aoe('ring', 2), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [wl(4), hl(36, 48), sh(110, 4), rg(14, 19, 4), cl(['poison', 'root'])],
      description: 'O santuário se fecha: quatro turnos de pedra, cura cheia, escudo, regeneração e nada mais entra.',
      fxShape: 'shieldFx' }
  ];

  // --- ESPADACHIM + MINOTAURO — A Emboscada ------------------------------
  // SUMIR + BARRAR: some e deixa muro no lugar onde estava. O inimigo bate na
  // pedra procurando o que ja nao esta la.
  F['espadachim+minotauro'] = [
    { tier: 0, formName: 'Finta', paCost: 3, cooldown: 0, castsPerTurn: 2,
      range: rng(1, 1), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 16, 21), ps(1)],
      description: 'Corta e recua um passo, deixando o outro golpeando o vazio.',
      fxShape: 'slash' },
    { tier: 5, formName: 'Troca', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'any',
      riderMode: 'support',
      mechanic: [mv(4), wl(2)],
      description: 'Sai de onde estava e deixa uma pedra ocupando o próprio lugar. Quem vinha, chega tarde.',
      fxShape: 'blink' },
    { tier: 10, formName: 'Beco', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('line', 3), needsEmptyTile: false, targetSide: 'any',
      riderMode: 'support',
      mechanic: [wl(2), d('@A', 17, 23), iv(1)],
      description: 'Fecha o corredor com três pedras, esmaga quem estava nele e some atrás delas.',
      fxShape: 'veil' },
    { tier: 12, formName: 'Punhalada', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 1), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@B', 28, 37), rt(1)],
      description: 'O golpe que só quem estava escondido consegue dar: fundo, e o alvo não sai do lugar.',
      fxShape: 'slash' },
    { tier: 15, formName: 'Ratoeira', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('ring', 1), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [wl(3), d('@A', 21, 28), rt(1)],
      description: 'Fecha o anel em volta do alvo e corta enquanto ele procura a saída.',
      fxShape: 'nova' },
    { tier: 20, formName: 'Umbral', paCost: 4, cooldown: 4, castsPerTurn: 1,
      range: rng(0, 0), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [iv(2), sh(70, 2), bf('power', 30, 2)],
      description: 'Some por dois turnos, com a pedra guardando as costas e a lâmina pesando mais.',
      fxShape: 'veil' },
    { tier: 30, formName: 'Dedalo', paCost: 5, cooldown: 5, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('cross', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [wl(3), iv(1), d('@B', 32, 42), rt(1)],
      description: 'Ergue a cruz de pedra, some dentro dela e sai de dentro do inimigo. Ele nunca viu por onde.',
      fxShape: 'slash' }
  ];

  // --- INVOCADOR + MINOTAURO — O Muro Vivo -------------------------------
  // INVOCAR + BARRAR: a pedra tem alguem dentro. Barra E ataca.
  F['invocador+minotauro'] = [
    { tier: 0, formName: 'Sentinela', paCost: 3, cooldown: 0, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('single', 0), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [sm('fus-wall-watcher'), d('@A', 13, 18)],
      description: 'Crava o ídolo onde o caminho precisa de dono, e a cravada abre o chão de quem estava do lado.',
      fxShape: 'summonFx' },
    { tier: 5, formName: 'Guarita', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('single', 0), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [wl(2), d('@B', 15, 20), tr('fus-trap-venom', 2)],
      description: 'A pedra sobe rachando o chão e deixa o laço armado ao pé: quem der a volta pisa no que ficou escondido.',
      fxShape: 'shieldFx' },
    { tier: 10, formName: 'Vigia', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('single', 0), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [sm('fus-wall-watcher'), d('@A', 18, 24), sh(50, 2)],
      description: 'O ídolo sobe do chão já escudado, e o solavanco da subida derruba quem estava em cima.',
      fxShape: 'summonFx' },
    { tier: 12, formName: 'Paliçada', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('line', 3), needsEmptyTile: false, targetSide: 'any',
      riderMode: 'support',
      mechanic: [wl(3), d('@B', 20, 27), tn(2)],
      description: 'Três pedras sobem na linha, machucam quem estava nela, e o rugido diz o resto: têm de vir por aqui.',
      fxShape: 'shieldFx' },
    { tier: 15, formName: 'Sebe', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('cross', 1), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [wl(2), d('@A', 20, 27), rt(1)],
      description: 'A cerca cresce em cruz e morde: quem estava dentro fica, e sangra.',
      fxShape: 'summonFx' },
    { tier: 20, formName: 'Guarnição', paCost: 5, cooldown: 4, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('single', 0), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [sm('fus-wall-watcher'), wl(3), d('@A', 22, 29), sh(75, 3)],
      description: 'Ídolo, muro e escudo de uma vez, e o chão racha embaixo de quem estava na passagem.',
      fxShape: 'summonFx' },
    { tier: 30, formName: 'Fortaleza', paCost: 5, cooldown: 5, castsPerTurn: 1,
      range: rng(0, 0), aoe: aoe('ring', 2), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [wl(4), sm('fus-wall-watcher'), d('@B', 28, 37), sh(100, 4)],
      description: 'Fecha o anel, crava o ídolo dentro dele e derruba a muralha sobre quem ficou fora: a fortaleza tem guarnição, muro e portão.',
      fxShape: 'summonFx' }
  ];

  // --- MINOTAURO + SUMO — O Portão ---------------------------------------
  // BARRAR + PRENDER: os dois no mesmo lugar, e ninguem sai. A dupla que
  // decide onde a luta acontece.
  F['minotauro+sumo'] = [
    { tier: 0, formName: 'Trombada', paCost: 3, cooldown: 0, castsPerTurn: 2,
      range: rng(1, 1), aoe: aoe('single', 0), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 18, 24), rt(1)],
      description: 'Duas toneladas chegando ao mesmo tempo: 0 PP em quem levou.',
      fxShape: 'slam' },
    { tier: 5, formName: 'Tranca', paCost: 3, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 4), aoe: aoe('single', 0), needsEmptyTile: true, targetSide: 'any',
      riderMode: 'support',
      mechanic: [wl(3), tn(2)],
      description: 'Tranca a passagem com pedra e chama a briga para si: só há um caminho, e ele está em pé nele.',
      fxShape: 'shieldFx' },
    { tier: 10, formName: 'Escora', paCost: 4, cooldown: 2, castsPerTurn: 1,
      range: rng(1, 3, true), aoe: aoe('line', 3), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@B', 22, 29), pl(2)],
      description: 'Atravessa a linha empurrando com o ombro e traz todos dois passos para perto.',
      fxShape: 'slam' },
    { tier: 12, formName: 'Curral', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('ring', 1), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [wl(3), d('@A', 16, 22), rt(2)],
      description: 'Fecha o curral em volta deles, machuca quem bate na pedra e cola o chão nos pés por dois turnos.',
      fxShape: 'nova' },
    { tier: 15, formName: 'Marrada', paCost: 4, cooldown: 3, castsPerTurn: 1,
      range: rng(1, 2), aoe: aoe('cone', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [d('@A', 26, 34), ps(2), rt(1)],
      description: 'O leque de chifres joga todos para trás e prega no chão quem sobrou de pé.',
      fxShape: 'slam' },
    { tier: 20, formName: 'Reduto', paCost: 5, cooldown: 4, castsPerTurn: 1,
      range: rng(0, 0), aoe: aoe('circle', 1), needsEmptyTile: false, targetSide: 'self',
      riderMode: 'support',
      mechanic: [sh(110, 3), tn(3), rf(30, 3)],
      description: 'Planta os dois pés, chama todo mundo e devolve parte do que levar por três turnos.',
      fxShape: 'shieldFx' },
    { tier: 30, formName: 'Ferrolho', paCost: 5, cooldown: 5, castsPerTurn: 1,
      range: rng(1, 5), aoe: aoe('ring', 2), needsEmptyTile: false, targetSide: 'enemy',
      riderMode: 'offense',
      mechanic: [wl(4), d('@B', 30, 40), rt(2), tn(2)],
      description: 'O anel de pedra se fecha, o chão cola nos pés e o rugido diz o resto: daqui ninguém passa.',
      fxShape: 'nova' }
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
      'A armadilha de caça dispara de baixo para cima e prega o pé de quem pisou.', 'burst'),
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
      var s = payload('fus-turret-shot', 'Chumbo do Totem', [d('neutro', 12, 16)],
        'O totem dispara os dois canos sozinho em quem entrar no alcance.', 'bolt');
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
    'fus-arrow-turret': summonDef('fus-arrow-turret', 'Totem-Espoleta', 40, 6, 0, 30, 'ranged',
      ['fus-turret-shot'], [{ type: 'pushImmune' }],
      'Um totem de caça com um olho acordado e dois canos saindo da boca: gira devagar, mira sempre e não anda.'),
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
      'Meio pilar entalhado com a cara das duas classes fundidas. Fica no caminho — é o trabalho inteiro dele.'),
    /* O MURO-VIGIA é do MURO VIVO (Invocador + Minotauro), e existe porque o
     * Ídolo-Escora passou a ser exclusivo da dupla do Bárbaro. Os números são
     * IGUAIS aos dele de propósito: esta rodada troca identidade, não
     * equilíbrio — misturar as duas coisas faria qualquer defeito que
     * aparecesse depois ter dois suspeitos em vez de um. */
    'fus-wall-watcher': summonDef('fus-wall-watcher', 'Muro-Vigia', 75, 6, 1, 15, 'melee',
      ['fus-idol-slam'], [{ type: 'pushImmune' }],
      'Um naco de muralha em pé, com uma fenda vertical de onde dois olhos observam. Fechado é parede; aberto, é dono da passagem.')
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
