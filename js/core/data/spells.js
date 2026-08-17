/* SOTERRA 2.0 — DATA.spells
 * Dono: Criativo Classes. Não editar em outro papel.
 *
 * 162 feitiços jogáveis: 6 classes × (3 neutros iniciais + 4 caminhos × 6 níveis).
 * Ids: `<classe>-<elemento>-<nivelDeDesbloqueio>`; neutros usam 1/2/3 (unlockLevel 0).
 * Mais 9 CARGAS DE ARMADILHA (`trap-*`), que não pertencem a nenhum caminho: existem
 * apenas para serem disparadas por efeitos `trap` (paCost 0, nunca aparecem na barra).
 *
 * Convenções seguidas em todo o arquivo:
 *  - efeitos de área ofensivos (targetSide 'enemy') carregam SÓ efeitos voltados ao inimigo;
 *    bônus próprios moram em feitiços de targetSide 'self'/'ally' (evita ambiguidade no motor);
 *  - `lifesteal: true` = metade do dano causado volta como vida ao conjurador (regra v1);
 *  - `mark` usa value 5 (o cálculo de dano soma 5% por pilha) e no máximo 5 pilhas;
 *  - dano alvo único por PA: ~7 (nível 0) → ~17 (nível 30); área e utilidade custam desconto.
 */
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

JOGO.DATA = JOGO.DATA || {};

JOGO.DATA.spells = {

  /* ======================================================================
   * CARGAS DE ARMADILHA — disparadas por `trap`, nunca conjuradas à mão.
   * ====================================================================== */

  'trap-neutro-alarme': {
    id: 'trap-neutro-alarme', name: 'Estaca-Alarme (disparo)', element: 'neutro', classId: 'invocador', unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'neutro', min: 16, max: 22 }, { type: 'buff', stat: 'pp', value: -1, duration: 1 } ],
    description: 'A estaca salta do chão, fura o pé de quem pisou e apita: 16–22 de dano neutro e −1 PP por 1 turno.',
    flavor: 'Serve mais para avisar do que para matar. Mas avisa doendo.',
    fxKey: 'alarmSnap'
  },
  'trap-fogo-brasa': {
    id: 'trap-fogo-brasa', name: 'Armadilha de Brasa (disparo)', element: 'fogo', classId: 'invocador', unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 24, max: 30 }, { type: 'poison', element: 'fogo', min: 6, max: 9, duration: 2 } ],
    description: 'O carvão enterrado acorda: 24–30 de fogo em raio 1 e queimadura de 6–9 por 2 turnos.',
    flavor: 'Ele enterra brasa como quem planta. Colhe gritos.',
    fxKey: 'emberTrap'
  },
  'trap-fogo-pira': {
    id: 'trap-fogo-pira', name: 'Armadilha-Pira (disparo)', element: 'fogo', classId: 'invocador', unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 52, max: 62 }, { type: 'poison', element: 'fogo', min: 12, max: 16, duration: 2 } ],
    description: 'Uma pira inteira dobrada dentro de uma célula: 52–62 de fogo em raio 1 e queimadura de 12–16 por 2 turnos.',
    flavor: 'A célula lembra de ter sido uma fogueira. Você lembrou tarde.',
    fxKey: 'pyreTrap'
  },
  'trap-agua-redemoinho': {
    id: 'trap-agua-redemoinho', name: 'Armadilha-Redemoinho (disparo)', element: 'agua', classId: 'invocador', unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 20, max: 26 }, { type: 'pull', tiles: 2 } ],
    description: 'O chão vira funil: 20–26 de água e o incauto é puxado 2 células para o centro.',
    flavor: 'Água parada de mil anos guarda uma vontade só: descer.',
    fxKey: 'whirlTrap'
  },
  'trap-agua-sorvedouro': {
    id: 'trap-agua-sorvedouro', name: 'Armadilha-Sorvedouro (disparo)', element: 'agua', classId: 'invocador', unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 46, max: 56 }, { type: 'pull', tiles: 3 } ],
    description: 'Um ralo do mundo antigo se abre: 46–56 de água em raio 1 e sucção de 3 células.',
    flavor: 'Alguém, algum dia, puxou essa tampa. Ninguém nunca a repôs.',
    fxKey: 'maelstromTrap'
  },
  'trap-terra-laco': {
    id: 'trap-terra-laco', name: 'Armadilha-Laço (disparo)', element: 'terra', classId: 'invocador', unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 18, max: 24 }, { type: 'root', duration: 2 } ],
    description: 'Raízes fecham o tornozelo: 18–24 de terra e 0 PP por 2 turnos.',
    flavor: 'O micélio não come depressa. Come com calma, que é para durar.',
    fxKey: 'snareTrap'
  },
  'trap-terra-tremor': {
    id: 'trap-terra-tremor', name: 'Armadilha-Tremor (disparo)', element: 'terra', classId: 'invocador', unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 48, max: 58 }, { type: 'root', duration: 2 } ],
    description: 'A laje cede em raio 1: 48–58 de terra e ninguém sai do lugar por 2 turnos.',
    flavor: 'Não é o buraco que machuca — é o susto de o chão ter opinião.',
    fxKey: 'quakeTrap'
  },
  'trap-ar-rajada': {
    id: 'trap-ar-rajada', name: 'Armadilha-Rajada (disparo)', element: 'ar', classId: 'invocador', unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 16, max: 22 }, { type: 'push', tiles: 3 } ],
    description: 'Um respiradouro guardado estoura: 16–22 de ar e arremesso de 3 células.',
    flavor: 'Ar velho, guardado desde antes da Lousa, e mal-humorado como convém.',
    fxKey: 'gustTrap'
  },
  'trap-ar-vortice': {
    id: 'trap-ar-vortice', name: 'Armadilha-Vórtice (disparo)', element: 'ar', classId: 'invocador', unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 42, max: 52 }, { type: 'push', tiles: 4 } ],
    description: 'Um nó de vento se desata em raio 1: 42–52 de ar e 4 células de arremesso.',
    flavor: 'Quem projetou os respiradouros nunca imaginou que alguém os fecharia de propósito.',
    fxKey: 'vortexTrap'
  },

  /* ======================================================================
   * SUMÔ — TANQUE
   * Neutro: ocupar, provocar, prender.
   * Fogo: devolver o dano · Água: absorver e escorregar
   * Terra: escudo colossal e raízes · Ar: investir, girar e arremessar
   * ====================================================================== */

  'sumo-neutro-1': {
    id: 'sumo-neutro-1', name: 'Palma de Ferro', element: 'neutro', classId: 'sumo', unlockLevel: 0,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'neutro', min: 20, max: 26 }, { type: 'push', tiles: 1 } ],
    description: 'Palma aberta no peito do adversário: 20–26 de dano neutro e 1 célula de empurrão. Duas vezes por turno.',
    flavor: 'No dohyo se aprende cedo: primeiro tira o outro do lugar, depois discute.',
    fxKey: 'palmSlam'
  },
  'sumo-neutro-2': {
    id: 'sumo-neutro-2', name: 'Grito do Dohyo', element: 'neutro', classId: 'sumo', unlockLevel: 0,
    paCost: 2, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'taunt', duration: 2 }, { type: 'shield', value: 30, duration: 2 } ],
    description: 'Bate o pé e ruge: todos os inimigos são obrigados a atacá-lo por 2 turnos, e ele ganha 30 de escudo.',
    flavor: 'O chão do Fecho responde. É a única plateia que sobrou.',
    fxKey: 'dohyoRoar'
  },
  'sumo-neutro-3': {
    id: 'sumo-neutro-3', name: 'Agarrão do Mawashi', element: 'neutro', classId: 'sumo', unlockLevel: 0,
    paCost: 2, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'neutro', min: 10, max: 14 }, { type: 'root', duration: 1 } ],
    description: 'Fecha a mão no cinto do inimigo: 10–14 de dano e 0 PP por 1 turno.',
    flavor: 'Ele não segura para machucar. Segura para conversar.',
    fxKey: 'grappleHold'
  },

  /* --- SUMÔ · FOGO: quanto mais apanha, mais devolve --- */
  'sumo-fogo-5': {
    id: 'sumo-fogo-5', name: 'Pele em Brasa', element: 'fogo', classId: 'sumo', unlockLevel: 5,
    paCost: 2, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'reflect', pct: 25, duration: 2 }, { type: 'resist', element: 'fogo', value: 15, duration: 2 } ],
    description: 'A pele esquenta até rachar: devolve 25% do dano recebido ao agressor por 2 turnos e resiste 15% a fogo.',
    flavor: 'Bater nele é encostar na chapa. Todo mundo encosta uma vez.',
    fxKey: 'emberSkin'
  },
  'sumo-fogo-10': {
    id: 'sumo-fogo-10', name: 'Bofetada Incandescente', element: 'fogo', classId: 'sumo', unlockLevel: 10,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 25, max: 32 }, { type: 'poison', element: 'fogo', min: 6, max: 9, duration: 2 } ],
    description: '25–32 de fogo na palma aberta, e a marca continua queimando 6–9 por 2 turnos.',
    flavor: 'A mão dele deixa impressão digital. Em brasa.',
    fxKey: 'emberSlam'
  },
  'sumo-fogo-12': {
    id: 'sumo-fogo-12', name: 'Estouro do Dohyo', element: 'fogo', classId: 'sumo', unlockLevel: 12,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 24, max: 30 }, { type: 'push', tiles: 1 } ],
    description: 'Explode para fora quando o cercam: 24–30 de fogo em raio 1 e todo mundo 1 célula para trás.',
    flavor: 'Cercar o campeão é aquecer o campeão. Ninguém leu o regulamento.',
    fxKey: 'emberBurst'
  },
  'sumo-fogo-15': {
    id: 'sumo-fogo-15', name: 'Sangue Fervente', element: 'fogo', classId: 'sumo', unlockLevel: 15,
    paCost: 3, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'buff', stat: 'power', value: 35, duration: 2 }, { type: 'poison', element: 'fogo', min: 6, max: 8, duration: 2 } ],
    description: 'Ferve o próprio sangue: +35 de poder por 2 turnos, ao preço de 6–8 de queimadura própria por turno.',
    flavor: 'Dizem que ele cospe vapor quando está satisfeito com a luta.',
    fxKey: 'boilingBlood'
  },
  'sumo-fogo-20': {
    id: 'sumo-fogo-20', name: 'Represália Vulcânica', element: 'fogo', classId: 'sumo', unlockLevel: 20,
    paCost: 4, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'reflect', pct: 50, duration: 2 }, { type: 'shield', value: 70, duration: 2 }, { type: 'taunt', duration: 2 } ],
    description: 'Provoca a sala inteira, veste 70 de escudo e devolve 50% de tudo que receber por 2 turnos.',
    flavor: 'A pergunta não é se vão bater. É quantos vão continuar em pé depois de bater.',
    fxKey: 'volcanicRetort'
  },
  'sumo-fogo-30': {
    id: 'sumo-fogo-30', name: 'Fornalha do Campeão', element: 'fogo', classId: 'sumo', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 70, max: 84 }, { type: 'poison', element: 'fogo', min: 14, max: 18, duration: 3 }, { type: 'push', tiles: 2 }, { type: 'weatherShift', weather: 'estiagem' } ],
    description: 'O corpo inteiro vira forja e arrebenta: 70–84 de fogo em raio 2, queimadura de 14–18 por 3 turnos, 2 células de empurrão — e a sala inteira entra em estiagem.',
    flavor: 'Foi assim que ele descobriu, mil anos atrás, que o Coração do Fecho ainda batia.',
    fxKey: 'championForge'
  },

  /* --- SUMÔ · ÁGUA: bebe o golpe, devolve maré --- */
  'sumo-agua-5': {
    id: 'sumo-agua-5', name: 'Palma da Maré', element: 'agua', classId: 'sumo', unlockLevel: 5,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 20, max: 26, lifesteal: true }, { type: 'push', tiles: 1 } ],
    description: '20–26 de água com roubo de vida e 1 célula de empurrão: bate, bebe e afasta.',
    flavor: 'A palma sai molhada. O outro sai mais seco.',
    fxKey: 'tidePalm'
  },
  'sumo-agua-10': {
    id: 'sumo-agua-10', name: 'Passo Escorregadio', element: 'agua', classId: 'sumo', unlockLevel: 10,
    paCost: 2, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'buff', stat: 'dodge', value: 30, duration: 2 }, { type: 'buff', stat: 'pp', value: 1, duration: 2 } ],
    description: 'Molha o dohyo e desliza nele: +30 de esquiva e +1 PP por 2 turnos.',
    flavor: 'Cento e cinquenta quilos deslizando. É mais elegante do que parece.',
    fxKey: 'slickStep'
  },
  'sumo-agua-12': {
    id: 'sumo-agua-12', name: 'Onda de Ombro', element: 'agua', classId: 'sumo', unlockLevel: 12,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 4, line: true, los: true, movable: false },
    aoe: { shape: 'line', size: 4 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 28, max: 35, lifesteal: true }, { type: 'push', tiles: 2 } ],
    description: 'Um ombro de água atravessa a linha: 28–35 com roubo de vida em todos, e 2 células de empurrão.',
    flavor: 'A cisterna aprendeu a lutar sumô observando pelo ralo.',
    fxKey: 'shoulderWave'
  },
  'sumo-agua-15': {
    id: 'sumo-agua-15', name: 'Bebedor de Golpes', element: 'agua', classId: 'sumo', unlockLevel: 15,
    paCost: 3, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'shield', value: 60, duration: 2 }, { type: 'regen', min: 14, max: 18, duration: 2 }, { type: 'cleanse', kinds: ['poison', 'root'] } ],
    description: 'Absorve o que vier: 60 de escudo, regeneração de 14–18 por 2 turnos e limpa venenos e raízes.',
    flavor: 'Ele não cura. Ele engole e digere depois.',
    fxKey: 'tideDrink'
  },
  'sumo-agua-20': {
    id: 'sumo-agua-20', name: 'Maré do Campeão', element: 'agua', classId: 'sumo', unlockLevel: 20,
    paCost: 4, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 36, max: 44, lifesteal: true }, { type: 'push', tiles: 2 } ],
    description: 'Gira e solta a maré: 36–44 de água com roubo de vida em raio 2 e 2 células de empurrão para todos.',
    flavor: 'Meia sala recua. Ele fica mais gordo de vida do que começou.',
    fxKey: 'championTide'
  },
  'sumo-agua-30': {
    id: 'sumo-agua-30', name: 'Ressaca Absoluta', element: 'agua', classId: 'sumo', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 3 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'pull', tiles: 3 }, { type: 'damage', element: 'agua', min: 66, max: 78, lifesteal: true }, { type: 'root', duration: 1 } ],
    description: 'Puxa a sala inteira 3 células para dentro do próprio corpo, engole 66–78 de água com roubo de vida e deixa todos sem PP por 1 turno.',
    flavor: 'Quando a cisterna respira fundo, o baile inteiro vai junto.',
    fxKey: 'undertowMaw'
  },

  /* --- SUMÔ · TERRA: a muralha que provoca e enraíza --- */
  'sumo-terra-5': {
    id: 'sumo-terra-5', name: 'Casco de Pedra', element: 'terra', classId: 'sumo', unlockLevel: 5,
    paCost: 2, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'shield', value: 45, duration: 2 }, { type: 'buff', stat: 'lock', value: 20, duration: 2 } ],
    description: 'Endurece a casca: 45 de escudo e +20 de fixação por 2 turnos — fugir dele fica bem mais caro.',
    flavor: 'Ele não fica mais duro. O mundo é que fica mais mole em comparação.',
    fxKey: 'stoneHusk'
  },
  'sumo-terra-10': {
    id: 'sumo-terra-10', name: 'Pisada Fundadora', element: 'terra', classId: 'sumo', unlockLevel: 10,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 20, max: 26 }, { type: 'root', duration: 1 } ],
    description: 'Pisa como quem assenta um alicerce: 20–26 de terra em raio 1 e 0 PP por 1 turno.',
    flavor: 'O dohyo dele tem mil anos e nunca precisou de conserto.',
    fxKey: 'rootQuake'
  },
  'sumo-terra-12': {
    id: 'sumo-terra-12', name: 'Estaca Humana', element: 'terra', classId: 'sumo', unlockLevel: 12,
    paCost: 3, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'taunt', duration: 2 }, { type: 'shield', value: 70, duration: 2 }, { type: 'resist', element: 'terra', value: 20, duration: 2 } ],
    description: 'Finca-se no chão e chama todos: provocação por 2 turnos, 70 de escudo e 20% de resistência a terra.',
    flavor: 'Foi plantado ali. Vai ter que ser desenterrado.',
    fxKey: 'humanStake'
  },
  'sumo-terra-15': {
    id: 'sumo-terra-15', name: 'Raízes do Dohyo', element: 'terra', classId: 'sumo', unlockLevel: 15,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 26, max: 33 }, { type: 'root', duration: 2 } ],
    description: 'Manda raízes por baixo do chão até o ponto escolhido: 26–33 de terra em raio 1 e 0 PP por 2 turnos.',
    flavor: 'A arena inteira é dele. Só emprestou o chão para você pisar.',
    fxKey: 'dohyoRoots'
  },
  'sumo-terra-20': {
    id: 'sumo-terra-20', name: 'Muralha Viva', element: 'terra', classId: 'sumo', unlockLevel: 20,
    paCost: 4, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'shield', value: 120, duration: 3 }, { type: 'resist', element: 'terra', value: 25, duration: 3 }, { type: 'buff', stat: 'lock', value: 30, duration: 3 } ],
    description: 'Vira parede de carne e pedra: 120 de escudo, 25% de resistência a terra e +30 de fixação por 3 turnos.',
    flavor: 'Os construtores selavam Fechos com portões. Ele dispensa o portão.',
    fxKey: 'livingWall'
  },
  'sumo-terra-30': {
    id: 'sumo-terra-30', name: 'Montanha que Anda', element: 'terra', classId: 'sumo', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 58, max: 70 }, { type: 'root', duration: 2 }, { type: 'taunt', duration: 3 }, { type: 'weatherShift', weather: 'tremor' } ],
    description: 'Dá um passo e a sala racha: 58–70 de terra em raio 2, ninguém anda por 2 turnos, todos são obrigados a encará-lo por 3 — e a poeira do tremor toma o ar.',
    flavor: 'Não é que a montanha tenha aprendido a andar. É que ele nunca aceitou ficar parado.',
    fxKey: 'walkingMountain'
  },

  /* --- SUMÔ · AR: agarra, gira e arremessa --- */
  'sumo-ar-5': {
    id: 'sumo-ar-5', name: 'Investida do Dohyo', element: 'ar', classId: 'sumo', unlockLevel: 5,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 2, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'moveTo', maxTiles: 4 }, { type: 'damage', element: 'ar', min: 18, max: 24 } ],
    description: 'Desliza até 4 células até o alvo e trombra nele: 18–24 de dano de ar. A entrada de graça do tanque.',
    flavor: 'Cento e cinquenta quilos não correm. Chegam.',
    fxKey: 'dohyoCharge'
  },
  'sumo-ar-10': {
    id: 'sumo-ar-10', name: 'Arremesso do Mawashi', element: 'ar', classId: 'sumo', unlockLevel: 10,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 25, max: 32 }, { type: 'push', tiles: 3 } ],
    description: 'Pega pelo cinto e joga: 25–32 de ar e 3 células de voo (colidir dói mais).',
    flavor: 'Ele mira sempre no obstáculo mais próximo. Por economia de movimento.',
    fxKey: 'mawashiThrow'
  },
  'sumo-ar-12': {
    id: 'sumo-ar-12', name: 'Giro de Cem Braços', element: 'ar', classId: 'sumo', unlockLevel: 12,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 26, max: 33 }, { type: 'push', tiles: 2 } ],
    description: 'Roda sobre si mesmo com os braços abertos: 26–33 de ar em raio 1 e 2 células de empurrão em todos.',
    flavor: 'Quem estava perto vira plateia. Bem longe, de preferência.',
    fxKey: 'hundredArmSpin'
  },
  'sumo-ar-15': {
    id: 'sumo-ar-15', name: 'Puxão e Volta', element: 'ar', classId: 'sumo', unlockLevel: 15,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 2, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'pull', tiles: 4 }, { type: 'damage', element: 'ar', min: 30, max: 38 }, { type: 'root', duration: 1 } ],
    description: 'Um sopro-laço arrasta o alvo 4 células até ele: 30–38 de ar e 0 PP por 1 turno. O atirador inimigo detesta.',
    flavor: 'Ele acha grosseria conversar de longe.',
    fxKey: 'graspAndSlam'
  },
  'sumo-ar-20': {
    id: 'sumo-ar-20', name: 'Tufão de Carne', element: 'ar', classId: 'sumo', unlockLevel: 20,
    paCost: 5, cooldown: 2, castsPerTurn: 1,
    range: { min: 2, max: 7, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'moveTo', maxTiles: 6 }, { type: 'damage', element: 'ar', min: 58, max: 70 }, { type: 'push', tiles: 3 } ],
    description: 'Atravessa até 6 células em linha reta de fúria: 58–70 de ar e 3 células de arremesso no fim do trajeto.',
    flavor: 'O corredor inteiro ouve o assobio antes de ver o campeão.',
    fxKey: 'fleshTyphoon'
  },
  'sumo-ar-30': {
    id: 'sumo-ar-30', name: 'Arremesso do Fim do Mundo', element: 'ar', classId: 'sumo', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 1, max: 2, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 96, max: 112 }, { type: 'push', tiles: 6 }, { type: 'root', duration: 2 } ],
    description: 'Agarra, gira três vezes e solta: 96–112 de ar, 6 células de voo e 2 turnos sem conseguir levantar (0 PP).',
    flavor: 'Ele treinou mil anos para o arremesso que finalmente encostasse alguém na Lousa.',
    fxKey: 'worldThrow'
  },

  /*__NEXT__*/

};
