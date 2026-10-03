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
    effects: [ { type: 'damage', element: 'neutro', min: 11, max: 15 }, { type: 'buff', stat: 'pp', value: -1, duration: 1 } ],
    description: 'A estaca salta do chão, fura o pé de quem pisou e apita: 11–15 de dano neutro e −1 PP por 1 turno.',
    flavor: 'Serve mais para avisar do que para matar. Mas avisa doendo.',
    fxKey: 'alarmSnap'
  },
  'trap-fogo-brasa': {
    id: 'trap-fogo-brasa', name: 'Armadilha de Brasa (disparo)', element: 'fogo', classId: 'invocador', unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 17, max: 21 }, { type: 'poison', element: 'fogo', min: 4, max: 6, duration: 2 } ],
    description: 'O carvão enterrado acorda: 17–21 de fogo em raio 1 e queimadura de 4–6 por 2 turnos.',
    flavor: 'Ele enterra brasa como quem planta. Colhe gritos.',
    fxKey: 'emberTrap'
  },
  'trap-fogo-pira': {
    id: 'trap-fogo-pira', name: 'Armadilha-Pira (disparo)', element: 'fogo', classId: 'invocador', unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 39, max: 47 }, { type: 'poison', element: 'fogo', min: 9, max: 12, duration: 2 } ],
    description: 'Uma pira inteira dobrada dentro de uma célula: 39–47 de fogo em raio 1 e queimadura de 9–12 por 2 turnos.',
    flavor: 'A célula lembra de ter sido uma fogueira. Você lembrou tarde.',
    fxKey: 'pyreTrap'
  },
  'trap-agua-redemoinho': {
    id: 'trap-agua-redemoinho', name: 'Armadilha-Redemoinho (disparo)', element: 'agua', classId: 'invocador', unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 14, max: 18 }, { type: 'pull', tiles: 2 } ],
    description: 'O chão vira funil: 14–18 de água e o incauto é puxado 2 células para o centro.',
    flavor: 'Água parada de mil anos guarda uma vontade só: descer.',
    fxKey: 'whirlTrap'
  },
  'trap-agua-sorvedouro': {
    id: 'trap-agua-sorvedouro', name: 'Armadilha-Sorvedouro (disparo)', element: 'agua', classId: 'invocador', unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 35, max: 42 }, { type: 'pull', tiles: 3 } ],
    description: 'Um ralo do mundo antigo se abre: 35–42 de água em raio 1 e sucção de 3 células.',
    flavor: 'Alguém, algum dia, puxou essa tampa. Ninguém nunca a repôs.',
    fxKey: 'maelstromTrap'
  },
  'trap-terra-laco': {
    id: 'trap-terra-laco', name: 'Armadilha-Laço (disparo)', element: 'terra', classId: 'invocador', unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 13, max: 17 }, { type: 'root', duration: 2 } ],
    description: 'Raízes fecham o tornozelo: 13–17 de terra e 0 PP por 2 turnos.',
    flavor: 'O micélio não come depressa. Come com calma, que é para durar.',
    fxKey: 'snareTrap'
  },
  'trap-terra-tremor': {
    id: 'trap-terra-tremor', name: 'Armadilha-Tremor (disparo)', element: 'terra', classId: 'invocador', unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 36, max: 44 }, { type: 'root', duration: 2 } ],
    description: 'A laje cede em raio 1: 36–44 de terra e ninguém sai do lugar por 2 turnos.',
    flavor: 'Não é o buraco que machuca — é o susto de o chão ter opinião.',
    fxKey: 'quakeTrap'
  },
  'trap-ar-rajada': {
    id: 'trap-ar-rajada', name: 'Armadilha-Rajada (disparo)', element: 'ar', classId: 'invocador', unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 13, max: 18 }, { type: 'push', tiles: 3 } ],
    description: 'Um respiradouro guardado estoura: 13–18 de ar e arremesso de 3 células.',
    flavor: 'Ar velho, guardado desde antes da Lousa, e mal-humorado como convém.',
    fxKey: 'gustTrap'
  },
  'trap-ar-vortice': {
    id: 'trap-ar-vortice', name: 'Armadilha-Vórtice (disparo)', element: 'ar', classId: 'invocador', unlockLevel: 0,
    paCost: 0, cooldown: 0, castsPerTurn: 0,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 38, max: 47 }, { type: 'push', tiles: 4 } ],
    description: 'Um nó de vento se desata em raio 1: 38–47 de ar e 4 células de arremesso.',
    flavor: 'Quem projetou os respiradouros nunca imaginou que alguém os fecharia de propósito.',
    fxKey: 'vortexTrap'
  },

  /* ======================================================================
   * BÁRBARO — TANQUE
   * Neutro: ocupar, provocar, prender.
   * Fogo: devolver o dano · Água: absorver e escorregar
   * Terra: escudo colossal e raízes · Ar: investir, girar e arremessar
   * ====================================================================== */

  'sumo-neutro-1': {
    id: 'sumo-neutro-1', name: 'Machadada de Ferro', element: 'neutro', classId: 'sumo', unlockLevel: 0,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'neutro', min: 28, max: 36 }, { type: 'push', tiles: 1 } ],
    description: 'O machado desce no peito do adversário: 28–36 de dano neutro e 1 célula de empurrão. Duas vezes por turno.',
    flavor: 'No portão se aprende cedo: primeiro tira o outro do lugar, depois discute.',
    fxKey: 'axeSlam'
  },
  'sumo-neutro-2': {
    id: 'sumo-neutro-2', name: 'Grito de Guerra', element: 'neutro', classId: 'sumo', unlockLevel: 0,
    paCost: 2, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'taunt', duration: 2 }, { type: 'shield', value: 42, duration: 2 } ],
    description: 'Bate o cabo do machado no chão e ruge: todos os inimigos são obrigados a atacá-lo por 2 turnos, e ele ganha 42 de escudo.',
    flavor: 'O chão do Fecho responde. É a única resposta que sobrou.',
    fxKey: 'warCry'
  },
  'sumo-neutro-3': {
    id: 'sumo-neutro-3', name: 'Pegada de Urso', element: 'neutro', classId: 'sumo', unlockLevel: 0,
    paCost: 2, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'neutro', min: 14, max: 20 }, { type: 'root', duration: 1 } ],
    description: 'Fecha a manopla na garganta do inimigo: 14–20 de dano e 0 PP por 1 turno.',
    flavor: 'Ele não segura para machucar. Segura para conversar.',
    fxKey: 'grappleHold'
  },

  /* --- BÁRBARO · FOGO: quanto mais apanha, mais devolve --- */
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
    id: 'sumo-fogo-10', name: 'Gume Incandescente', element: 'fogo', classId: 'sumo', unlockLevel: 10,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 27, max: 34 }, { type: 'poison', element: 'fogo', min: 6, max: 9, duration: 2 } ],
    description: '27–34 de fogo no fio do machado, e a marca continua queimando 6–9 por 2 turnos.',
    flavor: 'O machado dele deixa assinatura. Em brasa.',
    fxKey: 'emberSlam'
  },
  'sumo-fogo-12': {
    id: 'sumo-fogo-12', name: 'Estouro de Brasa', element: 'fogo', classId: 'sumo', unlockLevel: 12,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'damage', element: 'fogo', min: 26, max: 32 }, { type: 'push', tiles: 1 } ],
    description: 'Explode para fora quando o cercam: 26–32 de fogo em raio 1 e todo mundo 1 célula para trás.',
    flavor: 'Cercá-lo é aquecê-lo. Ninguém foi avisado disso.',
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
    id: 'sumo-fogo-30', name: 'Fúria da Fornalha', element: 'fogo', classId: 'sumo', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'damage', element: 'fogo', min: 65, max: 78 }, { type: 'poison', element: 'fogo', min: 13, max: 17, duration: 3 }, { type: 'push', tiles: 2 }, { type: 'weatherShift', weather: 'estiagem' } ],
    description: 'O corpo inteiro vira forja e arrebenta: 65–78 de fogo em raio 2, queimadura de 13–17 por 3 turnos, 2 células de empurrão — e a sala inteira entra em estiagem.',
    flavor: 'Foi assim que ele descobriu, mil anos atrás, que o Coração do Fecho ainda batia.',
    fxKey: 'furyForge'
  },

  /* --- BÁRBARO · ÁGUA: bebe o golpe, devolve maré --- */
  'sumo-agua-5': {
    id: 'sumo-agua-5', name: 'Gume da Maré', element: 'agua', classId: 'sumo', unlockLevel: 5,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 28, max: 36, lifesteal: true }, { type: 'push', tiles: 1 } ],
    description: '28–36 de água com roubo de vida e 1 célula de empurrão: bate, bebe e afasta.',
    flavor: 'O machado sai molhado. O outro sai mais seco.',
    fxKey: 'tideEdge'
  },
  'sumo-agua-10': {
    id: 'sumo-agua-10', name: 'Passo Escorregadio', element: 'agua', classId: 'sumo', unlockLevel: 10,
    paCost: 2, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'buff', stat: 'dodge', value: 30, duration: 2 }, { type: 'buff', stat: 'pp', value: 1, duration: 2 } ],
    description: 'Molha o chão da sala e desliza nele: +30 de esquiva e +1 PP por 2 turnos.',
    flavor: 'Cento e cinquenta quilos deslizando. É mais elegante do que parece.',
    fxKey: 'slickStep'
  },
  'sumo-agua-12': {
    id: 'sumo-agua-12', name: 'Onda de Ombro', element: 'agua', classId: 'sumo', unlockLevel: 12,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 4, line: true, los: true, movable: false },
    aoe: { shape: 'line', size: 4 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 29, max: 37, lifesteal: true }, { type: 'push', tiles: 2 } ],
    description: 'Um ombro de água atravessa a linha: 29–37 com roubo de vida em todos, e 2 células de empurrão.',
    flavor: 'A cisterna aprendeu a brigar observando pelo ralo.',
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
    id: 'sumo-agua-20', name: 'Maré Bruta', element: 'agua', classId: 'sumo', unlockLevel: 20,
    paCost: 4, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'damage', element: 'agua', min: 36, max: 44, lifesteal: true }, { type: 'push', tiles: 2 } ],
    description: 'Gira e solta a maré: 36–44 de água com roubo de vida em raio 2 e 2 células de empurrão para todos.',
    flavor: 'Meia sala recua. Ele fica mais gordo de vida do que começou.',
    fxKey: 'bruteTide'
  },
  'sumo-agua-30': {
    id: 'sumo-agua-30', name: 'Ressaca Absoluta', element: 'agua', classId: 'sumo', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 3 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'pull', tiles: 3 }, { type: 'damage', element: 'agua', min: 62, max: 73, lifesteal: true }, { type: 'root', duration: 1 } ],
    description: 'Puxa a sala inteira 3 células para dentro do próprio corpo, engole 62–73 de água com roubo de vida e deixa todos sem PP por 1 turno.',
    flavor: 'Quando a cisterna respira fundo, o baile inteiro vai junto.',
    fxKey: 'undertowMaw'
  },

  /* --- BÁRBARO · TERRA: a muralha que provoca e enraíza --- */
  'sumo-terra-5': {
    id: 'sumo-terra-5', name: 'Casco de Pedra', element: 'terra', classId: 'sumo', unlockLevel: 5,
    paCost: 2, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'shield', value: 63, duration: 2 }, { type: 'buff', stat: 'lock', value: 20, duration: 2 } ],
    description: 'Endurece a casca: 63 de escudo e +20 de fixação por 2 turnos — fugir dele fica bem mais caro.',
    flavor: 'Ele não fica mais duro. O mundo é que fica mais mole em comparação.',
    fxKey: 'stoneHusk'
  },
  'sumo-terra-10': {
    id: 'sumo-terra-10', name: 'Pisada Fundadora', element: 'terra', classId: 'sumo', unlockLevel: 10,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'damage', element: 'terra', min: 21, max: 28 }, { type: 'root', duration: 1 } ],
    description: 'Pisa como quem assenta um alicerce: 21–28 de terra em raio 1 e 0 PP por 1 turno.',
    flavor: 'O portão dele tem mil anos e nunca precisou de conserto.',
    fxKey: 'rootQuake'
  },
  'sumo-terra-12': {
    id: 'sumo-terra-12', name: 'Estaca Humana', element: 'terra', classId: 'sumo', unlockLevel: 12,
    paCost: 3, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'taunt', duration: 2 }, { type: 'shield', value: 75, duration: 2 }, { type: 'resist', element: 'terra', value: 20, duration: 2 } ],
    description: 'Finca-se no chão e chama todos: provocação por 2 turnos, 75 de escudo e 20% de resistência a terra.',
    flavor: 'Foi plantado ali. Vai ter que ser desenterrado.',
    fxKey: 'humanStake'
  },
  'sumo-terra-15': {
    id: 'sumo-terra-15', name: 'Raízes de Pedra', element: 'terra', classId: 'sumo', unlockLevel: 15,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 26, max: 33 }, { type: 'root', duration: 2 } ],
    description: 'Manda raízes por baixo do chão até o ponto escolhido: 26–33 de terra em raio 1 e 0 PP por 2 turnos.',
    flavor: 'A sala inteira é dele. Só emprestou o chão para você pisar.',
    fxKey: 'stoneRoots'
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
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'damage', element: 'terra', min: 54, max: 65 }, { type: 'root', duration: 2 }, { type: 'taunt', duration: 3 }, { type: 'weatherShift', weather: 'tremor' } ],
    description: 'Dá um passo e a sala racha: 54–65 de terra em raio 2, ninguém anda por 2 turnos, todos são obrigados a encará-lo por 3 — e a poeira do tremor toma o ar.',
    flavor: 'Não é que a montanha tenha aprendido a andar. É que ele nunca aceitou ficar parado.',
    fxKey: 'walkingMountain'
  },

  /* --- BÁRBARO · AR: agarra, gira e arremessa --- */
  'sumo-ar-5': {
    id: 'sumo-ar-5', name: 'Investida Bruta', element: 'ar', classId: 'sumo', unlockLevel: 5,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 2, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'moveTo', maxTiles: 4 }, { type: 'damage', element: 'ar', min: 28, max: 38 } ],
    description: 'Desliza até 4 células até o alvo e tromba nele: 28–38 de dano de ar. A entrada de graça do tanque.',
    flavor: 'Cento e cinquenta quilos não correm. Chegam.',
    fxKey: 'brutalCharge'
  },
  'sumo-ar-10': {
    id: 'sumo-ar-10', name: 'Arremesso Brutal', element: 'ar', classId: 'sumo', unlockLevel: 10,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 29, max: 38 }, { type: 'push', tiles: 3 } ],
    description: 'Pega pelo peitoral e joga: 29–38 de ar e 3 células de voo (colidir dói mais).',
    flavor: 'Ele mira sempre no obstáculo mais próximo. Por economia de movimento.',
    fxKey: 'brutalThrow'
  },
  'sumo-ar-12': {
    id: 'sumo-ar-12', name: 'Ciclone de Machado', element: 'ar', classId: 'sumo', unlockLevel: 12,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'damage', element: 'ar', min: 31, max: 40 }, { type: 'push', tiles: 2 } ],
    description: 'Roda sobre si mesmo com o machado esticado: 31–40 de ar em raio 1 e 2 células de empurrão em todos.',
    flavor: 'Quem estava perto vira espectador. Bem longe, de preferência.',
    fxKey: 'axeCyclone'
  },
  'sumo-ar-15': {
    id: 'sumo-ar-15', name: 'Puxão e Volta', element: 'ar', classId: 'sumo', unlockLevel: 15,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 2, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'pull', tiles: 4 }, { type: 'damage', element: 'ar', min: 34, max: 43 }, { type: 'root', duration: 1 } ],
    description: 'Um sopro-laço arrasta o alvo 4 células até ele: 34–43 de ar e 0 PP por 1 turno. O atirador inimigo detesta.',
    flavor: 'Ele acha grosseria conversar de longe.',
    fxKey: 'graspAndSlam'
  },
  'sumo-ar-20': {
    id: 'sumo-ar-20', name: 'Tufão de Ferro', element: 'ar', classId: 'sumo', unlockLevel: 20,
    paCost: 5, cooldown: 2, castsPerTurn: 1,
    range: { min: 2, max: 7, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'moveTo', maxTiles: 6 }, { type: 'damage', element: 'ar', min: 65, max: 79 }, { type: 'push', tiles: 3 } ],
    description: 'Atravessa até 6 células em linha reta de fúria: 65–79 de ar e 3 células de arremesso no fim do trajeto.',
    flavor: 'O corredor inteiro ouve o assobio antes de ver o bárbaro.',
    fxKey: 'ironTyphoon'
  },
  'sumo-ar-30': {
    id: 'sumo-ar-30', name: 'Arremesso do Fim do Mundo', element: 'ar', classId: 'sumo', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 1, max: 2, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 94, max: 109 }, { type: 'push', tiles: 6 }, { type: 'root', duration: 2 } ],
    description: 'Agarra, gira três vezes e solta: 94–109 de ar, 6 células de voo e 2 turnos sem conseguir levantar (0 PP).',
    flavor: 'Ele treinou mil anos para o arremesso que finalmente encostasse alguém na Lousa.',
    fxKey: 'worldThrow'
  },

  /* ======================================================================
   * BATEDOR — ATIRADOR
   * Assinatura: `mark` acumula, `detonateMarks` cobra a conta.
   * Fogo: marcas que queimam e explodem · Água: arpões que puxam e alimentam
   * Terra: flechas-menir que prendem · Ar: tiros que saltam de alvo em alvo
   * ====================================================================== */

  'arqueiro-neutro-1': {
    id: 'arqueiro-neutro-1', name: 'Tiro Anotado', element: 'neutro', classId: 'arqueiro', unlockLevel: 0,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 2, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'neutro', min: 14, max: 19 }, { type: 'mark', value: 5, duration: 3, max: 5 } ],
    description: '14–19 de dano neutro e 1 marca no alvo (cada marca aumenta em 5% todo o dano que ele receber). Duas vezes por turno.',
    flavor: 'O tiro não é a cobrança. É só o registro no caderno.',
    fxKey: 'markShot'
  },
  'arqueiro-neutro-2': {
    id: 'arqueiro-neutro-2', name: 'Passo de Corça', element: 'neutro', classId: 'arqueiro', unlockLevel: 0,
    paCost: 2, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'moveTo', maxTiles: 4 } ],
    description: 'Desliza até 4 células até uma célula vazia, sem gastar PP. A distância é a armadura do arqueiro.',
    flavor: 'Ninguém o viu correr. Todo mundo o viu já longe.',
    fxKey: 'doeStep'
  },
  'arqueiro-neutro-3': {
    id: 'arqueiro-neutro-3', name: 'Cobrar a Conta', element: 'neutro', classId: 'arqueiro', unlockLevel: 0,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'detonateMarks', mult: 9 }, { type: 'damage', element: 'neutro', min: 6, max: 10 } ],
    description: 'Consome todas as marcas do alvo: 9 de dano por marca, mais 6–10 de dano neutro do tiro.',
    flavor: 'Caçador nenhum perdoa dívida. No máximo adia o vencimento.',
    fxKey: 'markCollect'
  },

  /* O ID CONTINUA `arqueiro-*` DE PROPOSITO. A classe virou CAÇADOR quando a arte
   mudou, mas o id aparece em save, em tabela de dano e em `baseSpells`, e
   renomeá-lo custaria migração de save para não mudar nada que o jogador veja.
   O que o jogador lê — nome, descrição e sabor — fala de espingarda. */

/* --- CAÇADOR · FOGO: a marca queima; a conta explode --- */
  'arqueiro-fogo-5': {
    id: 'arqueiro-fogo-5', name: 'Carga Incendiária', element: 'fogo', classId: 'arqueiro', unlockLevel: 5,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 2, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 14, max: 19 }, { type: 'poison', element: 'fogo', min: 4, max: 5, duration: 2 }, { type: 'mark', value: 5, duration: 3, max: 5 } ],
    description: '14–19 de fogo, queimadura de 4–5 por 2 turnos e 1 marca.',
    flavor: 'O cartucho é socado com a resina que sobrou da Estufa. Cheira a fim de tarde.',
    fxKey: 'emberArrow'
  },
  'arqueiro-fogo-10': {
    id: 'arqueiro-fogo-10', name: 'Salva de Fagulhas', element: 'fogo', classId: 'arqueiro', unlockLevel: 10,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 3, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 16, max: 21 }, { type: 'mark', value: 5, duration: 3, max: 5 } ],
    description: 'Três tiros em leque: 16–21 de fogo em raio 1 e 1 marca em cada atingido. Marcar o grupo todo é o plano.',
    flavor: 'Contabilidade em massa.',
    fxKey: 'markVolley'
  },
  'arqueiro-fogo-12': {
    id: 'arqueiro-fogo-12', name: 'Ferro em Brasa', element: 'fogo', classId: 'arqueiro', unlockLevel: 12,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 19, max: 23 }, { type: 'mark', value: 5, duration: 4, max: 5 } ],
    description: '19–23 de fogo e 1 marca que dura 4 turnos — a ponta vermelha demora a esfriar.',
    flavor: 'Marca gado, marca inimigo. A técnica é a mesma; a paciência também.',
    fxKey: 'brandShot'
  },
  'arqueiro-fogo-15': {
    id: 'arqueiro-fogo-15', name: 'Detonar as Brasas', element: 'fogo', classId: 'arqueiro', unlockLevel: 15,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'detonateMarks', mult: 12 }, { type: 'damage', element: 'fogo', min: 17, max: 23 } ],
    description: 'Acende todas as marcas em raio 1: 12 de dano por marca de cada alvo, mais 17–23 de fogo na área.',
    flavor: 'Ele acende o caderno inteiro de uma vez. É mais rápido do que somar.',
    fxKey: 'markBlast'
  },
  'arqueiro-fogo-20': {
    id: 'arqueiro-fogo-20', name: 'Chuva de Brasas', element: 'fogo', classId: 'arqueiro', unlockLevel: 20,
    paCost: 5, cooldown: 2, castsPerTurn: 1,
    range: { min: 3, max: 7, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 34, max: 41 }, { type: 'poison', element: 'fogo', min: 9, max: 12, duration: 2 }, { type: 'mark', value: 5, duration: 3, max: 5 } ],
    description: 'Dezenas de bagos em brasa caem em raio 2: 34–41 de fogo, queimadura de 9–12 por 2 turnos e 1 marca em todos.',
    flavor: 'Chove fogo num mundo que não vê chuva há mil anos. Justiça poética duvidosa.',
    fxKey: 'emberRain'
  },
  'arqueiro-fogo-30': {
    id: 'arqueiro-fogo-30', name: 'Cartucheira do Sol Morto', element: 'fogo', classId: 'arqueiro', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 2, max: 7, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 39, max: 47 }, { type: 'detonateMarks', mult: 20 }, { type: 'poison', element: 'fogo', min: 10, max: 13, duration: 3 } ],
    description: 'Esvazia a cartucheira inteira em raio 2: 39–47 de fogo, 20 de dano por marca acumulada em cada alvo e queimadura de 10–13 por 3 turnos.',
    flavor: 'Guardava um cartucho do tempo em que ainda havia sol. Guardou até agora.',
    fxKey: 'deadSunQuiver'
  },

  /* --- CAÇADOR · ÁGUA: arpoa, puxa e se alimenta --- */
  'arqueiro-agua-5': {
    id: 'arqueiro-agua-5', name: 'Tiro-Arpão', element: 'agua', classId: 'arqueiro', unlockLevel: 5,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 2, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 14, max: 19, lifesteal: true }, { type: 'pull', tiles: 2 }, { type: 'mark', value: 5, duration: 3, max: 5 } ],
    description: '14–19 de água com roubo de vida, puxa 2 células e deixa 1 marca. Reposiciona o alvo para onde convém.',
    flavor: 'A corda é fina. A vontade do outro lado é que é grossa.',
    fxKey: 'harpoonArrow'
  },
  'arqueiro-agua-10': {
    id: 'arqueiro-agua-10', name: 'Tiro da Nascente', element: 'agua', classId: 'arqueiro', unlockLevel: 10,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 2, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 19, max: 24, lifesteal: true }, { type: 'mark', value: 5, duration: 3, max: 5 } ],
    description: '19–24 de água com roubo de vida e 1 marca: cada tiro devolve fôlego ao atirador.',
    flavor: 'Bebe da distância. É o único jeito de um arqueiro beber.',
    fxKey: 'springShot'
  },
  'arqueiro-agua-12': {
    id: 'arqueiro-agua-12', name: 'Linha de Correnteza', element: 'agua', classId: 'arqueiro', unlockLevel: 12,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 4, line: true, los: true, movable: false },
    aoe: { shape: 'line', size: 6 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 20, max: 25 }, { type: 'push', tiles: 2 }, { type: 'mark', value: 5, duration: 3, max: 5 } ],
    description: 'Uma correnteza atravessa a linha: 20–25 de água, 2 células de empurrão e 1 marca em cada alvo da fila.',
    flavor: 'Ele mira no corredor, não em quem está nele.',
    fxKey: 'currentLine'
  },
  'arqueiro-agua-15': {
    id: 'arqueiro-agua-15', name: 'Detonar a Maré', element: 'agua', classId: 'arqueiro', unlockLevel: 15,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'detonateMarks', mult: 14 }, { type: 'damage', element: 'agua', min: 23, max: 29, lifesteal: true } ],
    description: 'Estoura as marcas do alvo em água: 14 por marca, mais 23–29 com roubo de vida. Cobrar a conta cura.',
    flavor: 'A dívida vira bebida.',
    fxKey: 'tideCollect'
  },
  'arqueiro-agua-20': {
    id: 'arqueiro-agua-20', name: 'Chuva Fria', element: 'agua', classId: 'arqueiro', unlockLevel: 20,
    paCost: 5, cooldown: 2, castsPerTurn: 1,
    range: { min: 3, max: 7, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 36, max: 44, lifesteal: true }, { type: 'pull', tiles: 2 }, { type: 'mark', value: 5, duration: 3, max: 5 } ],
    description: 'Uma nuvem de chumbo gelado em raio 2: 36–44 com roubo de vida, puxa 2 células e marca todos os atingidos.',
    flavor: 'Junta o rebanho antes de cobrar. Sempre foi mais eficiente.',
    fxKey: 'coldRain'
  },
  'arqueiro-agua-30': {
    id: 'arqueiro-agua-30', name: 'Maré Marcada', element: 'agua', classId: 'arqueiro', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 2, max: 7, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 3 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'pull', tiles: 3 }, { type: 'damage', element: 'agua', min: 41, max: 49, lifesteal: true }, { type: 'detonateMarks', mult: 18 } ],
    description: 'A maré obedece à corda: puxa tudo em raio 3 por 3 células, causa 41–49 de água com roubo de vida e detona as marcas a 18 por pilha.',
    flavor: 'Ele apontou para a cisterna e disse "venham". Vieram todos, inclusive a água.',
    fxKey: 'markedTide'
  },

  /* --- CAÇADOR · TERRA: bala-menir, peso e raiz --- */
  'arqueiro-terra-5': {
    id: 'arqueiro-terra-5', name: 'Chumbo de Sílex', element: 'terra', classId: 'arqueiro', unlockLevel: 5,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 2, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 18, max: 22 }, { type: 'mark', value: 5, duration: 4, max: 5 } ],
    description: '18–22 de terra e 1 marca de 4 turnos: a pedra fica cravada muito depois do tiro.',
    flavor: 'Sílex lascado à mão, como se fazia antes do céu virar teto.',
    fxKey: 'flintArrow'
  },
  'arqueiro-terra-10': {
    id: 'arqueiro-terra-10', name: 'Estaca no Pé', element: 'terra', classId: 'arqueiro', unlockLevel: 10,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 2, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 17, max: 21 }, { type: 'root', duration: 1 }, { type: 'mark', value: 5, duration: 4, max: 5 } ],
    description: 'Prega o alvo no chão: 17–21 de terra, 0 PP por 1 turno e 1 marca.',
    flavor: 'Regra do caçador: quem não anda, não erra a conta.',
    fxKey: 'pinShot'
  },
  'arqueiro-terra-12': {
    id: 'arqueiro-terra-12', name: 'Tiro Perfurante', element: 'terra', classId: 'arqueiro', unlockLevel: 12,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 5, line: true, los: true, movable: false },
    aoe: { shape: 'line', size: 7 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 23, max: 29 }, { type: 'mark', value: 5, duration: 4, max: 5 } ],
    description: 'A bala atravessa a fila inteira: 23–29 de terra e 1 marca em cada corpo do caminho.',
    flavor: 'Cano de dois palmos, coronha de raiz seca. Não pede licença.',
    fxKey: 'piercingShot'
  },
  'arqueiro-terra-15': {
    id: 'arqueiro-terra-15', name: 'Detonar o Pedregulho', element: 'terra', classId: 'arqueiro', unlockLevel: 15,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'detonateMarks', mult: 13 }, { type: 'damage', element: 'terra', min: 21, max: 27 }, { type: 'root', duration: 2 } ],
    description: 'As marcas viram pedra e desabam: 13 por marca, 21–27 de terra e 0 PP por 2 turnos.',
    flavor: 'Cobrar dívida com pedregulho é grosseiro. É também definitivo.',
    fxKey: 'boulderCollect'
  },
  'arqueiro-terra-20': {
    id: 'arqueiro-terra-20', name: 'Salva de Menires', element: 'terra', classId: 'arqueiro', unlockLevel: 20,
    paCost: 5, cooldown: 2, castsPerTurn: 1,
    range: { min: 2, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 34, max: 42 }, { type: 'root', duration: 2 }, { type: 'mark', value: 5, duration: 4, max: 5 } ],
    description: 'Menires do tamanho de postes caem em raio 2: 34–42 de terra, 0 PP por 2 turnos e 1 marca em todos.',
    flavor: 'Ninguém entende como ele carrega essas coisas na cartucheira. Ninguém pergunta.',
    fxKey: 'menhirVolley'
  },
  'arqueiro-terra-30': {
    id: 'arqueiro-terra-30', name: 'Bala-Menir', element: 'terra', classId: 'arqueiro', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 2, max: 7, line: true, los: true, movable: false },
    aoe: { shape: 'line', size: 9 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 62, max: 73 }, { type: 'detonateMarks', mult: 22 }, { type: 'root', duration: 3 } ],
    description: 'Uma coluna inteira lançada em linha reta: 62–73 de terra em toda a fila, 22 por marca detonada e 3 turnos sem PP.',
    flavor: 'Os construtores fincavam menires para segurar o mundo. Ele descobriu outro uso.',
    fxKey: 'menhirShot'
  },

  /* --- CAÇADOR · AR: o tiro que salta --- */
  'arqueiro-ar-5': {
    id: 'arqueiro-ar-5', name: 'Carga de Vento', element: 'ar', classId: 'arqueiro', unlockLevel: 5,
    paCost: 2, cooldown: 0, castsPerTurn: 2,
    range: { min: 2, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 13, max: 17 }, { type: 'mark', value: 5, duration: 3, max: 5 } ],
    description: 'Barata e rápida: 13–17 de ar e 1 marca por apenas 2 PA. O jeito mais eficiente de encher o alvo de marcas.',
    flavor: 'Sem ponta de metal: só ar comprimido e má intenção.',
    fxKey: 'windArrow'
  },
  'arqueiro-ar-10': {
    id: 'arqueiro-ar-10', name: 'Tiro Saltador', element: 'ar', classId: 'arqueiro', unlockLevel: 10,
    paCost: 3, cooldown: 0, castsPerTurn: 1,
    range: { min: 2, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'chain', jumps: 2, falloff: 0.3, element: 'ar', min: 20, max: 24 }, { type: 'mark', value: 5, duration: 3, max: 5 } ],
    description: '20–24 de ar que saltam para mais 2 inimigos próximos (−30% a cada salto) e marcam o primeiro alvo.',
    flavor: 'O chumbo ricocheteia no teto de pedra. O teto, pelo menos, serve para isso.',
    fxKey: 'skipShot'
  },
  'arqueiro-ar-12': {
    id: 'arqueiro-ar-12', name: 'Chumbo Rodopiante', element: 'ar', classId: 'arqueiro', unlockLevel: 12,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 2, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 23, max: 29 }, { type: 'push', tiles: 2 }, { type: 'mark', value: 5, duration: 3, max: 5 } ],
    description: '23–29 de ar, 2 células de empurrão e 1 marca: mantém o corpo a corpo sempre a um passo de distância.',
    flavor: 'Gira tanto que assobia. O assobio já é meio metro de recuo.',
    fxKey: 'spinArrow'
  },
  'arqueiro-ar-15': {
    id: 'arqueiro-ar-15', name: 'Detonar a Corrente', element: 'ar', classId: 'arqueiro', unlockLevel: 15,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'detonateMarks', mult: 12 }, { type: 'chain', jumps: 3, falloff: 0.25, element: 'ar', min: 20, max: 26 } ],
    description: 'Detona as marcas (12 por pilha) e a descarga salta para mais 3 inimigos, perdendo 25% a cada salto.',
    flavor: 'A conta de um vira a notícia de todos.',
    fxKey: 'chainCollect'
  },
  'arqueiro-ar-20': {
    id: 'arqueiro-ar-20', name: 'Vendaval de Chumbo', element: 'ar', classId: 'arqueiro', unlockLevel: 20,
    paCost: 5, cooldown: 2, castsPerTurn: 1,
    range: { min: 3, max: 7, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 39, max: 48 }, { type: 'push', tiles: 3 }, { type: 'mark', value: 5, duration: 3, max: 5 } ],
    description: 'Um vendaval de chumbo em raio 2: 39–48 de ar, 3 células de arremesso e 1 marca em cada alvo.',
    flavor: 'Metade do chumbo erra de propósito, só para fazer vento.',
    fxKey: 'arrowGale'
  },
  'arqueiro-ar-30': {
    id: 'arqueiro-ar-30', name: 'Tempestade Marcada', element: 'ar', classId: 'arqueiro', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 2, max: 8, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'detonateMarks', mult: 20 }, { type: 'chain', jumps: 5, falloff: 0.2, element: 'ar', min: 33, max: 41 }, { type: 'weatherShift', weather: 'vendaval' } ],
    description: 'Detona as marcas a 20 por pilha e solta uma descarga de 33–41 que salta por até 5 inimigos (−20% por salto). O ar da sala vira vendaval.',
    flavor: 'Ele soltou a corda e o Fecho inteiro passou a dever alguma coisa.',
    fxKey: 'markedStorm'
  },

  /* ======================================================================
   * BRUXO — MAGO
   * Áreas de média/longa distância, maldições e controle de terreno.
   * Fogo: apagar salas · Água: dissolver e sugar
   * Terra: prender e negar chão · Ar: raio em cadeia e reposicionamento
   * Único caminho em que TODOS os feitiços de nível 30 viram o clima da sala.
   * ====================================================================== */

  'bruxo-neutro-1': {
    id: 'bruxo-neutro-1', name: 'Verruma Arcana', element: 'neutro', classId: 'bruxo', unlockLevel: 0,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 2, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'neutro', min: 17, max: 22 } ],
    description: 'Um furo limpo de energia crua: 17–22 de dano neutro a até 5 células. Duas vezes por turno.',
    flavor: 'A primeira lição da escola: o mundo tem buracos. Faça mais.',
    fxKey: 'arcaneBore'
  },
  'bruxo-neutro-2': {
    id: 'bruxo-neutro-2', name: 'Praga Sussurrada', element: 'neutro', classId: 'bruxo', unlockLevel: 0,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 2, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'poison', element: 'neutro', min: 7, max: 9, duration: 2 }, { type: 'buff', stat: 'power', value: -15, duration: 2 } ],
    description: 'Maldição em raio 1: 7–9 de dano por turno durante 2 turnos e −15 de poder nos amaldiçoados.',
    flavor: 'Ele nunca grita a praga. A pedra já é surda o bastante.',
    fxKey: 'whisperCurse'
  },
  'bruxo-neutro-3': {
    id: 'bruxo-neutro-3', name: 'Círculo de Chumbo', element: 'neutro', classId: 'bruxo', unlockLevel: 0,
    paCost: 2, cooldown: 2, castsPerTurn: 1,
    range: { min: 2, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'neutro', min: 5, max: 8 }, { type: 'buff', stat: 'pp', value: -2, duration: 1 } ],
    description: 'Desenha um círculo pesado no chão: 5–8 de dano e −2 PP por 1 turno em raio 1.',
    flavor: 'Chumbo é o metal preferido de quem gosta que as coisas fiquem onde estão.',
    fxKey: 'leadCircle'
  },

  /* --- BRUXO · FOGO: apagar a sala --- */
  'bruxo-fogo-5': {
    id: 'bruxo-fogo-5', name: 'Fagulha Gêmea', element: 'fogo', classId: 'bruxo', unlockLevel: 5,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 2, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 17, max: 22 }, { type: 'poison', element: 'fogo', min: 3, max: 5, duration: 2 } ],
    description: '17–22 de fogo e queimadura de 3–5 por 2 turnos. O básico que nunca sai do caderno.',
    flavor: 'Duas fagulhas: uma para acertar, outra para lembrar.',
    fxKey: 'twinSpark'
  },
  'bruxo-fogo-10': {
    id: 'bruxo-fogo-10', name: 'Cone de Cinzas', element: 'fogo', classId: 'bruxo', unlockLevel: 10,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 2, line: false, los: true, movable: false },
    aoe: { shape: 'cone', size: 3 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 26, max: 32 }, { type: 'poison', element: 'fogo', min: 6, max: 9, duration: 2 } ],
    description: 'Um leque de cinzas quentes: 26–32 de fogo em cone e queimadura de 6–9 por 2 turnos.',
    flavor: 'Cinza é fogo com memória.',
    fxKey: 'ashCone'
  },
  'bruxo-fogo-12': {
    id: 'bruxo-fogo-12', name: 'Meteoro Menor', element: 'fogo', classId: 'bruxo', unlockLevel: 12,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 3, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 33, max: 41 } ],
    description: 'Arranca um pedaço do teto de pedra e o derruba aceso: 33–41 de fogo em raio 1.',
    flavor: 'A Lousa devolve o que empresta. Com juros e temperatura.',
    fxKey: 'lesserMeteor'
  },
  'bruxo-fogo-15': {
    id: 'bruxo-fogo-15', name: 'Braseiro Proibido', element: 'fogo', classId: 'bruxo', unlockLevel: 15,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 2, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 12, max: 14 }, { type: 'poison', element: 'fogo', min: 10, max: 13, duration: 3 } ],
    description: 'Acende o chão em raio 2: 12–14 na hora e 10–13 por turno durante 3 turnos. Área que se paga com paciência.',
    flavor: 'Escrito na porta da escola: "não acender braseiro em recinto fechado". O mundo inteiro é recinto fechado.',
    fxKey: 'forbiddenBrazier'
  },
  'bruxo-fogo-20': {
    id: 'bruxo-fogo-20', name: 'Pira Dobrada', element: 'fogo', classId: 'bruxo', unlockLevel: 20,
    paCost: 5, cooldown: 2, castsPerTurn: 1,
    range: { min: 3, max: 7, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 27, max: 33 }, { type: 'poison', element: 'fogo', min: 7, max: 10, duration: 2 } ],
    description: 'Duas piras dentro da mesma área: 27–33 de fogo em raio 2 e queimadura de 7–10 por 2 turnos.',
    flavor: 'Dobrar uma pira é fácil. O difícil é desdobrar depois.',
    fxKey: 'foldedPyre'
  },
  'bruxo-fogo-30': {
    id: 'bruxo-fogo-30', name: 'Meteoro do Fecho', element: 'fogo', classId: 'bruxo', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 3, max: 8, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 3 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 40, max: 48 }, { type: 'poison', element: 'fogo', min: 11, max: 14, duration: 3 }, { type: 'weatherShift', weather: 'estiagem' } ],
    description: 'Derruba um pedaço inteiro da Lousa em chamas: 40–48 de fogo em raio 3, queimadura de 11–14 por 3 turnos e a sala entra em estiagem.',
    flavor: 'Ele leu a pedra até o fim. Na última página havia uma instrução: "puxe aqui".',
    fxKey: 'lockMeteor'
  },

  /* --- BRUXO · ÁGUA: dissolver, sugar, arrastar --- */
  'bruxo-agua-5': {
    id: 'bruxo-agua-5', name: "Lança d'Água", element: 'agua', classId: 'bruxo', unlockLevel: 5,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 2, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 17, max: 22, lifesteal: true } ],
    description: '17–22 de água com roubo de vida: o bruxo bebe metade do que derrama.',
    flavor: 'Água da cisterna, temperada com mil anos de más companhias.',
    fxKey: 'waterLance'
  },
  'bruxo-agua-10': {
    id: 'bruxo-agua-10', name: 'Sifão', element: 'agua', classId: 'bruxo', unlockLevel: 10,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 3, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'pull', tiles: 3 }, { type: 'damage', element: 'agua', min: 26, max: 33 }, { type: 'dispelShield' } ],
    description: 'Puxa o alvo 3 células, causa 26–33 de água e dissolve o escudo dele por completo.',
    flavor: 'Escudo é só uma coisa seca que ainda não foi molhada.',
    fxKey: 'siphon'
  },
  'bruxo-agua-12': {
    id: 'bruxo-agua-12', name: 'Maremoto', element: 'agua', classId: 'bruxo', unlockLevel: 12,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 4, line: true, los: true, movable: false },
    aoe: { shape: 'line', size: 6 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 33, max: 42 }, { type: 'push', tiles: 3 } ],
    description: 'Uma onda percorre a linha: 33–42 de água e 3 células de empurrão em toda a fila.',
    flavor: 'Limpa o corredor. Literalmente.',
    fxKey: 'tidalWave'
  },
  'bruxo-agua-15': {
    id: 'bruxo-agua-15', name: 'Poça Faminta', element: 'agua', classId: 'bruxo', unlockLevel: 15,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 2, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 18, max: 23, lifesteal: true }, { type: 'pull', tiles: 2 } ],
    description: 'Abre uma poça faminta em raio 2: 18–23 de água com roubo de vida e todos puxados 2 células para o centro.',
    flavor: 'Não é fundo. É só insistente.',
    fxKey: 'hungryPool'
  },
  'bruxo-agua-20': {
    id: 'bruxo-agua-20', name: 'Dissolução', element: 'agua', classId: 'bruxo', unlockLevel: 20,
    paCost: 5, cooldown: 2, castsPerTurn: 1,
    range: { min: 2, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'dispelShield' }, { type: 'damage', element: 'agua', min: 30, max: 37, lifesteal: true }, { type: 'poison', element: 'agua', min: 7, max: 10, duration: 2 } ],
    description: 'Dissolve todos os escudos em raio 2, causa 30–37 de água com roubo de vida e deixa 7–10 por turno durante 2 turnos.',
    flavor: 'A cisterna nunca quebrou uma armadura. Só esperou.',
    fxKey: 'dissolution'
  },
  'bruxo-agua-30': {
    id: 'bruxo-agua-30', name: 'A Cisterna Lembra', element: 'agua', classId: 'bruxo', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 2, max: 7, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 3 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'dispelShield' }, { type: 'pull', tiles: 3 }, { type: 'damage', element: 'agua', min: 41, max: 50, lifesteal: true }, { type: 'weatherShift', weather: 'chuva' } ],
    description: 'Chama de volta a água que afogou a corte: dissolve escudos, puxa 3 células, causa 41–50 com roubo de vida em raio 3 e faz chover na sala.',
    flavor: 'Ele só perguntou onde estavam os donos da cisterna. Ela respondeu mostrando.',
    fxKey: 'cisternRemembers'
  },

  /* --- BRUXO · TERRA: negar o chão --- */
  'bruxo-terra-5': {
    id: 'bruxo-terra-5', name: 'Espinho de Laje', element: 'terra', classId: 'bruxo', unlockLevel: 5,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 2, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 19, max: 24 } ],
    description: 'Uma lasca de laje sobe do chão sob os pés do alvo: 19–24 de terra.',
    flavor: 'O piso do Fecho colabora. Sempre colaborou; ninguém tinha pedido.',
    fxKey: 'slabSpike'
  },
  'bruxo-terra-10': {
    id: 'bruxo-terra-10', name: 'Grilhão de Raiz', element: 'terra', classId: 'bruxo', unlockLevel: 10,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 2, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'root', duration: 2 }, { type: 'damage', element: 'terra', min: 20, max: 26 } ],
    description: 'Raízes fecham o tornozelo do alvo: 0 PP por 2 turnos e 20–26 de terra.',
    flavor: 'A Estufa manda lembranças pelo subsolo.',
    fxKey: 'rootShackle'
  },
  'bruxo-terra-12': {
    id: 'bruxo-terra-12', name: 'Fenda', element: 'terra', classId: 'bruxo', unlockLevel: 12,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 4, line: true, los: true, movable: false },
    aoe: { shape: 'line', size: 6 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 35, max: 44 }, { type: 'root', duration: 1 } ],
    description: 'Racha o chão numa linha reta: 35–44 de terra e 0 PP por 1 turno em todos os que estiverem nela.',
    flavor: 'Depois ele fecha. Quase sempre.',
    fxKey: 'fissure'
  },
  'bruxo-terra-15': {
    id: 'bruxo-terra-15', name: 'Campo de Estacas', element: 'terra', classId: 'bruxo', unlockLevel: 15,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 2, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 19, max: 23 }, { type: 'poison', element: 'terra', min: 5, max: 8, duration: 3 } ],
    description: 'Enche a área de estacas de pedra: 19–23 de terra em raio 2 e 5–8 por turno durante 3 turnos para quem ficar.',
    flavor: 'A área continua lá. O bom senso é que costuma sair primeiro.',
    fxKey: 'spikeField'
  },
  'bruxo-terra-20': {
    id: 'bruxo-terra-20', name: 'Anel de Menires', element: 'terra', classId: 'bruxo', unlockLevel: 20,
    paCost: 5, cooldown: 2, castsPerTurn: 1,
    range: { min: 2, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'ring', size: 2 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 32, max: 38 }, { type: 'root', duration: 2 } ],
    description: 'Um anel de pedras sobe a 2 células do centro: 32–38 de terra e 0 PP por 2 turnos em quem estiver no anel.',
    flavor: 'Quem projetou os círculos de pedra não os projetou para ficar do lado de dentro.',
    fxKey: 'menhirRing'
  },
  'bruxo-terra-30': {
    id: 'bruxo-terra-30', name: 'A Lousa Desce', element: 'terra', classId: 'bruxo', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 2, max: 7, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 3 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 47, max: 56 }, { type: 'root', duration: 3 }, { type: 'weatherShift', weather: 'tremor' } ],
    description: 'Chama um palmo do céu de pedra para baixo: 47–56 de terra em raio 3, 3 turnos sem PP e a sala inteira em tremor.',
    flavor: 'É o feitiço mais proibido da escola: repete, em miniatura, o dia em que tudo acabou.',
    fxKey: 'slateDescends'
  },

  /* --- BRUXO · AR: o raio que escolhe caminho --- */
  'bruxo-ar-5': {
    id: 'bruxo-ar-5', name: 'Estalo', element: 'ar', classId: 'bruxo', unlockLevel: 5,
    paCost: 2, cooldown: 0, castsPerTurn: 2,
    range: { min: 2, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 14, max: 19 } ],
    description: 'Um estalo seco de pressão: 14–19 de ar por apenas 2 PA, a até 6 células.',
    flavor: 'Estala os dedos. O ar do outro lado da sala estala junto.',
    fxKey: 'snapBolt'
  },
  'bruxo-ar-10': {
    id: 'bruxo-ar-10', name: 'Faísca Saltitante', element: 'ar', classId: 'bruxo', unlockLevel: 10,
    paCost: 3, cooldown: 0, castsPerTurn: 1,
    range: { min: 2, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'chain', jumps: 2, falloff: 0.3, element: 'ar', min: 29, max: 36 } ],
    description: '29–36 de ar que saltam para mais 2 inimigos próximos, perdendo 30% da força a cada salto.',
    flavor: 'Ela procura companhia. Sempre acha.',
    fxKey: 'hopSpark'
  },
  'bruxo-ar-12': {
    id: 'bruxo-ar-12', name: 'Passo do Bruxo', element: 'ar', classId: 'bruxo', unlockLevel: 12,
    paCost: 2, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'teleport' } ],
    description: 'Teleporta-se para uma célula vazia a até 5 de distância. O mago frágil precisa de uma saída.',
    flavor: 'Não é magia elegante. É a magia de quem não quer apanhar.',
    fxKey: 'warlockStep'
  },
  'bruxo-ar-15': {
    id: 'bruxo-ar-15', name: 'Cone de Vendaval', element: 'ar', classId: 'bruxo', unlockLevel: 15,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 3, line: false, los: true, movable: false },
    aoe: { shape: 'cone', size: 3 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 23, max: 29 }, { type: 'push', tiles: 3 } ],
    description: 'Um leque de vento comprimido: 23–29 de ar e 3 células de arremesso em tudo que estiver no cone.',
    flavor: 'Os respiradouros do Fecho gemem quando ele faz isso. Ele acha bonito.',
    fxKey: 'galeCone'
  },
  'bruxo-ar-20': {
    id: 'bruxo-ar-20', name: 'Trovoada', element: 'ar', classId: 'bruxo', unlockLevel: 20,
    paCost: 5, cooldown: 2, castsPerTurn: 1,
    range: { min: 3, max: 7, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'chain', jumps: 4, falloff: 0.25, element: 'ar', min: 32, max: 39 } ],
    description: '32–39 de ar que percorrem até 5 corpos (4 saltos), perdendo 25% a cada salto. A sala inteira em um só gesto.',
    flavor: 'Nunca houve trovão sob a Lousa. Ele acha que faz falta.',
    fxKey: 'thunderRun'
  },
  'bruxo-ar-30': {
    id: 'bruxo-ar-30', name: 'Olho da Tempestade', element: 'ar', classId: 'bruxo', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 2, max: 7, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 3 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 41, max: 50 }, { type: 'push', tiles: 4 }, { type: 'chain', jumps: 4, falloff: 0.2, element: 'ar', min: 21, max: 27 }, { type: 'weatherShift', weather: 'vendaval' } ],
    description: 'Abre um olho de tempestade em raio 3: 41–50 de ar, 4 células de arremesso, descargas de 21–27 saltando por mais 4 corpos — e vendaval na sala.',
    flavor: 'Ninguém sob a Lousa tinha visto uma tempestade. Agora todos já viram uma. Uma só.',
    fxKey: 'stormEye'
  },

  /* ======================================================================
   * LADINO — ASSASSINO
   * Entrar, cortar duas vezes, sumir. Vive de escolher a hora.
   * Fogo: queimar o próprio sangue por dano bruto · Água: beber o que corta
   * Terra: apodrecer e prender · Ar: velocidade, teleporte e cortes em cadeia
   * ====================================================================== */

  'espadachim-neutro-1': {
    id: 'espadachim-neutro-1', name: 'Estocada Rápida', element: 'neutro', classId: 'espadachim', unlockLevel: 0,
    paCost: 2, cooldown: 0, castsPerTurn: 2,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'neutro', min: 21, max: 28 } ],
    description: '21–28 de dano neutro por 2 PA, duas vezes por turno. Barato, rápido, sem drama.',
    flavor: 'A lâmina entra pelo vão entre a armadura e a distração.',
    fxKey: 'quickThrust'
  },
  'espadachim-neutro-2': {
    id: 'espadachim-neutro-2', name: 'Sombra Curta', element: 'neutro', classId: 'espadachim', unlockLevel: 0,
    paCost: 2, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'invisible', duration: 2 }, { type: 'buff', stat: 'dodge', value: 20, duration: 2 } ],
    description: 'Some no intervalo entre duas lanternas: invisível por 2 turnos inteiros e +20 de esquiva por 2.',
    flavor: 'Num mundo sem céu, a sombra é o único lugar com espaço sobrando.',
    fxKey: 'shortShadow'
  },
  'espadachim-neutro-3': {
    id: 'espadachim-neutro-3', name: 'Passo Lateral', element: 'neutro', classId: 'espadachim', unlockLevel: 0,
    paCost: 2, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'moveTo', maxTiles: 4 } ],
    description: 'Desliza até 4 células sem gastar PP — normalmente para as costas de alguém.',
    flavor: 'Ele não anda em volta do inimigo. O inimigo é que fica virado para o lado errado.',
    fxKey: 'sideStep'
  },

  /* --- ESPADACHIM · FOGO: ferver o próprio sangue --- */
  'espadachim-fogo-5': {
    id: 'espadachim-fogo-5', name: 'Lâmina de Brasa', element: 'fogo', classId: 'espadachim', unlockLevel: 5,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 31, max: 39 }, { type: 'poison', element: 'fogo', min: 7, max: 11, duration: 2 } ],
    description: '31–39 de fogo e queimadura de 7–11 por 2 turnos. Duas vezes por turno.',
    flavor: 'A lâmina fica vermelha sozinha desde que ele passou a dormir com ela.',
    fxKey: 'emberBlade'
  },
  'espadachim-fogo-10': {
    id: 'espadachim-fogo-10', name: 'Corte Duplo Ardente', element: 'fogo', classId: 'espadachim', unlockLevel: 10,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 50, max: 62 }, { type: 'poison', element: 'fogo', min: 8, max: 13, duration: 2 } ],
    description: 'Dois cortes em X: 50–62 de fogo e 8–13 de queimadura por 2 turnos.',
    flavor: 'O segundo corte serve só para o primeiro não esfriar.',
    fxKey: 'burningCross'
  },
  'espadachim-fogo-12': {
    id: 'espadachim-fogo-12', name: 'Veias em Chamas', element: 'fogo', classId: 'espadachim', unlockLevel: 12,
    paCost: 2, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'buff', stat: 'power', value: 40, duration: 2 }, { type: 'poison', element: 'fogo', min: 8, max: 11, duration: 2 } ],
    description: 'Aquece o próprio sangue: +40 de poder por 2 turnos, ao preço de 8–11 de queimadura própria por turno.',
    flavor: 'Aposta velha: dói agora, mata primeiro.',
    fxKey: 'boilingVeins'
  },
  'espadachim-fogo-15': {
    id: 'espadachim-fogo-15', name: 'Dança das Fagulhas', element: 'fogo', classId: 'espadachim', unlockLevel: 15,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'damage', element: 'fogo', min: 42, max: 53 }, { type: 'poison', element: 'fogo', min: 11, max: 15, duration: 2 } ],
    description: 'Gira com as duas lâminas acesas: 42–53 de fogo em raio 1 e queimadura de 11–15 por 2 turnos.',
    flavor: 'Quem o cercou paga a entrada do espetáculo.',
    fxKey: 'sparkDance'
  },
  'espadachim-fogo-20': {
    id: 'espadachim-fogo-20', name: 'Estocada Escaldante', element: 'fogo', classId: 'espadachim', unlockLevel: 20,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 78, max: 92 }, { type: 'poison', element: 'fogo', min: 17, max: 22, duration: 2 } ],
    description: 'A lâmina entra em brasa branca: 78–92 de fogo e 17–22 de queimadura por 2 turnos.',
    flavor: 'Cauteriza no caminho de volta. É quase um favor.',
    fxKey: 'scaldingThrust'
  },
  'espadachim-fogo-30': {
    id: 'espadachim-fogo-30', name: 'Sete Cortes de Chama', element: 'fogo', classId: 'espadachim', unlockLevel: 30,
    paCost: 6, cooldown: 3, castsPerTurn: 1,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 106, max: 124 }, { type: 'poison', element: 'fogo', min: 23, max: 30, duration: 3 }, { type: 'dispelShield' } ],
    description: 'Sete cortes numa respiração só: dissolve o escudo do alvo, 106–124 de fogo e queimadura de 23–30 por 3 turnos.',
    flavor: 'Conta-se que o sétimo corte é dado depois de o alvo já ter caído. Por capricho.',
    fxKey: 'sevenFlameCuts'
  },

  /* --- ESPADACHIM · ÁGUA: beber o que corta --- */
  'espadachim-agua-5': {
    id: 'espadachim-agua-5', name: 'Lâmina Sedenta', element: 'agua', classId: 'espadachim', unlockLevel: 5,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 31, max: 39, lifesteal: true } ],
    description: '31–39 de água com roubo de vida, duas vezes por turno: o assassino que se sustenta sozinho.',
    flavor: 'A lâmina não está molhada. Está com sede.',
    fxKey: 'thirstyBlade'
  },
  'espadachim-agua-10': {
    id: 'espadachim-agua-10', name: 'Névoa Salgada', element: 'agua', classId: 'espadachim', unlockLevel: 10,
    paCost: 2, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'invisible', duration: 2 }, { type: 'cleanse', kinds: ['poison', 'root'] } ],
    description: 'Some numa névoa de sal por 2 turnos e lava venenos e raízes de cima do corpo.',
    flavor: 'Sal cura, sal esconde, sal conserva. Ele usa os três sentidos.',
    fxKey: 'brineMist'
  },
  'espadachim-agua-12': {
    id: 'espadachim-agua-12', name: 'Corte da Correnteza', element: 'agua', classId: 'espadachim', unlockLevel: 12,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 1, max: 2, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 39, max: 49 }, { type: 'push', tiles: 2 } ],
    description: '39–49 de água a até 2 células e 2 de empurrão: corta e afasta antes da resposta.',
    flavor: 'Ele corta na ida e a correnteza faz o resto do serviço.',
    fxKey: 'currentSlash'
  },
  'espadachim-agua-15': {
    id: 'espadachim-agua-15', name: 'Passo de Lodo', element: 'agua', classId: 'espadachim', unlockLevel: 15,
    paCost: 2, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'moveTo', maxTiles: 5 } ],
    description: 'Escorrega até 5 células por qualquer superfície molhada, sem gastar PP.',
    flavor: 'Aprendeu com os afogadiços. Só não aprendeu a parte de afundar.',
    fxKey: 'slimeStep'
  },
  'espadachim-agua-20': {
    id: 'espadachim-agua-20', name: 'Sanguessuga', element: 'agua', classId: 'espadachim', unlockLevel: 20,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 73, max: 87, lifesteal: true }, { type: 'poison', element: 'agua', min: 14, max: 20, duration: 2 } ],
    description: '73–87 de água com roubo de vida e 14–20 de veneno por 2 turnos. Um golpe que paga a própria conta.',
    flavor: 'Não é crueldade. É logística.',
    fxKey: 'leechCut'
  },
  'espadachim-agua-30': {
    id: 'espadachim-agua-30', name: 'Afogar em Sangue', element: 'agua', classId: 'espadachim', unlockLevel: 30,
    paCost: 6, cooldown: 3, castsPerTurn: 1,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 103, max: 122, lifesteal: true }, { type: 'poison', element: 'agua', min: 16, max: 21, duration: 3 }, { type: 'root', duration: 1 } ],
    description: '103–122 de água com roubo de vida — metade volta como vida —, veneno de 16–21 por 3 turnos e 1 turno sem PP.',
    flavor: 'A corte afogada aplaudiu. Foi a primeira vez em mil anos que alguém dançou direito.',
    fxKey: 'drownInBlood'
  },

  /* --- ESPADACHIM · TERRA: apodrecer devagar --- */
  'espadachim-terra-5': {
    id: 'espadachim-terra-5', name: 'Lâmina Enferrujada', element: 'terra', classId: 'espadachim', unlockLevel: 5,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 25, max: 32 }, { type: 'poison', element: 'terra', min: 7, max: 12, duration: 3 } ],
    description: '25–32 de terra e 7–12 de infecção por 3 turnos. O veneno do espadachim é paciente.',
    flavor: 'Ele não afia a lâmina. Só a deixa suja o suficiente.',
    fxKey: 'rustBlade'
  },
  'espadachim-terra-10': {
    id: 'espadachim-terra-10', name: 'Corte do Tornozelo', element: 'terra', classId: 'espadachim', unlockLevel: 10,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 31, max: 38 }, { type: 'root', duration: 2 } ],
    description: '31–38 de terra e 0 PP por 2 turnos: quem não anda não escapa do próximo golpe.',
    flavor: 'Regra da faca: primeiro tire a fuga, depois tire o resto.',
    fxKey: 'hamstring'
  },
  'espadachim-terra-12': {
    id: 'espadachim-terra-12', name: 'Pele de Casca', element: 'terra', classId: 'espadachim', unlockLevel: 12,
    paCost: 2, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'shield', value: 70, duration: 2 }, { type: 'resist', element: 'terra', value: 20, duration: 2 } ],
    description: 'Cobre-se de casca seca: 70 de escudo e 20% de resistência a terra por 2 turnos. O assassino também precisa sobreviver ao contra-ataque.',
    flavor: 'Casca de árvore que morreu no dia da Lousa e nunca aceitou apodrecer.',
    fxKey: 'barkSkin'
  },
  'espadachim-terra-15': {
    id: 'espadachim-terra-15', name: 'Punhal de Sílex', element: 'terra', classId: 'espadachim', unlockLevel: 15,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 58, max: 70 }, { type: 'poison', element: 'terra', min: 10, max: 15, duration: 3 } ],
    description: '58–70 de terra e 10–15 de infecção por 3 turnos. A lasca fica dentro.',
    flavor: 'Pedra lascada não enferruja nem perdoa.',
    fxKey: 'flintDagger'
  },
  'espadachim-terra-20': {
    id: 'espadachim-terra-20', name: 'Emboscada Enterrada', element: 'terra', classId: 'espadachim', unlockLevel: 20,
    paCost: 4, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'invisible', duration: 2 }, { type: 'buff', stat: 'power', value: 45, duration: 2 }, { type: 'buff', stat: 'lock', value: 20, duration: 2 } ],
    description: 'Enterra-se no pó e espera: invisível por 2 turnos, +45 de poder e +20 de fixação. O golpe seguinte é outro golpe.',
    flavor: 'Paciência é uma arma que não faz barulho ao ser sacada.',
    fxKey: 'buriedAmbush'
  },
  'espadachim-terra-30': {
    id: 'espadachim-terra-30', name: 'Estocada do Menir', element: 'terra', classId: 'espadachim', unlockLevel: 30,
    paCost: 6, cooldown: 3, castsPerTurn: 1,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 99, max: 118 }, { type: 'root', duration: 3 }, { type: 'poison', element: 'terra', min: 14, max: 19, duration: 3 } ],
    description: 'Crava a lâmina como quem finca um menir: 99–118 de terra, 3 turnos sem PP e 14–19 de infecção por turno.',
    flavor: 'Fica de pé por educação. O corpo já entendeu que acabou.',
    fxKey: 'menhirThrust'
  },

  /* --- ESPADACHIM · AR: rápido demais para ser respondido --- */
  'espadachim-ar-5': {
    id: 'espadachim-ar-5', name: 'Corte de Vento', element: 'ar', classId: 'espadachim', unlockLevel: 5,
    paCost: 2, cooldown: 0, castsPerTurn: 2,
    range: { min: 1, max: 2, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 26, max: 35 } ],
    description: '26–35 de ar a até 2 células por 2 PA, duas vezes por turno. Corta antes de encostar.',
    flavor: 'O corte chega meio passo antes da lâmina. Ninguém sabe explicar; ele também não.',
    fxKey: 'windCut'
  },
  'espadachim-ar-10': {
    id: 'espadachim-ar-10', name: 'Passo do Vento', element: 'ar', classId: 'espadachim', unlockLevel: 10,
    paCost: 2, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'teleport' } ],
    description: 'Teleporta-se para qualquer célula vazia a até 6 de distância. Entrada, saída, ou as duas coisas.',
    flavor: 'O ar do Fecho o deve por algum favor antigo.',
    fxKey: 'windStep'
  },
  'espadachim-ar-12': {
    id: 'espadachim-ar-12', name: 'Fôlego Roubado', element: 'ar', classId: 'espadachim', unlockLevel: 12,
    paCost: 2, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'buff', stat: 'pp', value: 2, duration: 2 }, { type: 'buff', stat: 'dodge', value: 25, duration: 2 } ],
    description: '+2 PP e +25 de esquiva por 2 turnos: atravessa a sala e escapa de qualquer fixação.',
    flavor: 'Rouba fôlego dos respiradouros. Devolve em forma de problema.',
    fxKey: 'stolenBreath'
  },
  'espadachim-ar-15': {
    id: 'espadachim-ar-15', name: 'Corte em Cadeia', element: 'ar', classId: 'espadachim', unlockLevel: 15,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'chain', jumps: 3, falloff: 0.25, element: 'ar', min: 56, max: 70 } ],
    description: '56–70 de ar que saltam para mais 3 inimigos próximos, perdendo 25% a cada salto.',
    flavor: 'Um corte só. A repetição é problema do vento.',
    fxKey: 'chainSlash'
  },
  'espadachim-ar-20': {
    id: 'espadachim-ar-20', name: 'Troca de Sombras', element: 'ar', classId: 'espadachim', unlockLevel: 20,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'any',
    effects: [ { type: 'swap' }, { type: 'damage', element: 'ar', min: 53, max: 66 } ],
    description: 'Troca de lugar com qualquer unidade e corta ao chegar: 53–66 de ar. Resgata um aliado ou entrega um inimigo.',
    flavor: 'Ele acha que o tabuleiro está sempre um pouco errado.',
    fxKey: 'shadowSwap'
  },
  'espadachim-ar-30': {
    id: 'espadachim-ar-30', name: 'Mil Cortes de Vento', element: 'ar', classId: 'espadachim', unlockLevel: 30,
    paCost: 6, cooldown: 3, castsPerTurn: 1,
    range: { min: 1, max: 2, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'chain', jumps: 5, falloff: 0.15, element: 'ar', min: 89, max: 106 }, { type: 'push', tiles: 2 } ],
    description: '89–106 de ar que percorrem até 6 corpos (5 saltos, apenas −15% cada) e empurram todos 2 células.',
    flavor: 'Ele saca uma vez. O som chega depois, e em várias partes da sala.',
    fxKey: 'thousandWindCuts'
  },

  /* ======================================================================
   * PALADINA — SUPORTE
   * Cura, escuda, abençoa — e bate de espada quando ninguém precisa dela.
   * Fogo: cura agressiva e poder · Água: cura pura e limpeza
   * Terra: escudos e raízes protetoras · Ar: mobilidade e resgate
   * ====================================================================== */

  'curandeiro-neutro-1': {
    id: 'curandeiro-neutro-1', name: 'Imposição das Mãos', element: 'neutro', classId: 'curandeiro', unlockLevel: 0,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 0, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'heal', min: 21, max: 26 } ],
    description: 'Cura 21–26 de vida de um aliado (ou de si mesma), duas vezes por turno.',
    flavor: 'Ela cospe na mão antes. Diz que ajuda. Ninguém tem coragem de discordar.',
    fxKey: 'warmHand'
  },
  'curandeiro-neutro-2': {
    id: 'curandeiro-neutro-2', name: 'Espada Teimosa', element: 'neutro', classId: 'curandeiro', unlockLevel: 0,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'neutro', min: 18, max: 23 } ],
    description: '18–23 de dano neutro. A paladina também ataca — e a espada pesa como o dever.',
    flavor: 'Era da avó. A avó também batia com ela.',
    fxKey: 'stubbornBlade'
  },
  'curandeiro-neutro-3': {
    id: 'curandeiro-neutro-3', name: 'Bênção Breve', element: 'neutro', classId: 'curandeiro', unlockLevel: 0,
    paCost: 2, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'buff', stat: 'power', value: 20, duration: 2 } ],
    description: '+20 de poder num aliado por 2 turnos. Curta — e faz uma diferença enorme.',
    flavor: 'Ergue o escudo diante do bárbaro antes de cada investida. Ele espera, por respeito.',
    fxKey: 'briefBlessing'
  },

  /* --- CURANDEIRA · FOGO: curar com raiva --- */
  'curandeiro-fogo-5': {
    id: 'curandeiro-fogo-5', name: 'Compressa Escaldante', element: 'fogo', classId: 'curandeiro', unlockLevel: 5,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 0, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'heal', min: 20, max: 24 }, { type: 'resist', element: 'fogo', value: 15, duration: 2 } ],
    description: 'Cura 20–24 e deixa 15% de resistência a fogo por 2 turnos. Arde, mas fecha.',
    flavor: '"Vai queimar um pouquinho." Sempre queima muito.',
    fxKey: 'searingPoultice'
  },
  'curandeiro-fogo-10': {
    id: 'curandeiro-fogo-10', name: 'Brasa Curativa', element: 'fogo', classId: 'curandeiro', unlockLevel: 10,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 1, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 19, max: 24, lifesteal: true } ],
    description: '19–24 de fogo num inimigo, e metade volta como vida para ela. Curar atacando é o caminho do fogo.',
    flavor: 'A avó chamava isso de "reciclagem".',
    fxKey: 'healingEmber'
  },
  'curandeiro-fogo-12': {
    id: 'curandeiro-fogo-12', name: 'Fôlego de Forja', element: 'fogo', classId: 'curandeiro', unlockLevel: 12,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'buff', stat: 'power', value: 35, duration: 2 }, { type: 'regen', min: 11, max: 14, duration: 2 } ],
    description: '+35 de poder e regeneração de 11–14 por 2 turnos num aliado. Acende quem já estava quente.',
    flavor: 'Ela sopra no aliado como quem sopra brasa de forja. Funciona igual.',
    fxKey: 'forgeBreath'
  },
  'curandeiro-fogo-15': {
    id: 'curandeiro-fogo-15', name: 'Anel de Cinzas', element: 'fogo', classId: 'curandeiro', unlockLevel: 15,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 26, max: 33 }, { type: 'poison', element: 'fogo', min: 6, max: 9, duration: 2 } ],
    description: 'Bate o escudo no chão e solta um anel de cinzas: 26–33 de fogo em raio 1 e 6–9 de queimadura por 2 turnos.',
    flavor: 'Armadura clara, e um barulho que chega ao teto.',
    fxKey: 'ashRing'
  },
  'curandeiro-fogo-20': {
    id: 'curandeiro-fogo-20', name: 'Coração de Brasa', element: 'fogo', classId: 'curandeiro', unlockLevel: 20,
    paCost: 4, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'heal', min: 53, max: 65 }, { type: 'buff', stat: 'power', value: 30, duration: 2 } ],
    description: 'Cura 53–65 e dá +30 de poder por 2 turnos a todos os aliados em raio 2.',
    flavor: 'Ela empresta o próprio coração de brasa. Devolve-se em vitória.',
    fxKey: 'emberHeart'
  },
  'curandeiro-fogo-30': {
    id: 'curandeiro-fogo-30', name: 'A Chama que Cuida', element: 'fogo', classId: 'curandeiro', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 0, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'heal', min: 88, max: 104 }, { type: 'regen', min: 25, max: 32, duration: 3 }, { type: 'buff', stat: 'power', value: 45, duration: 3 }, { type: 'cleanse', kinds: ['poison', 'root'] } ],
    description: 'Cura 88–104 em raio 2, regenera 25–32 por 3 turnos, dá +45 de poder e limpa venenos e raízes de todos os aliados.',
    flavor: 'A lanterna da avó tinha um vagalume só. Ela descobriu como acender a sala inteira com ele.',
    fxKey: 'tendingFlame'
  },

  /* --- CURANDEIRA · ÁGUA: a cura sem truques --- */
  'curandeiro-agua-5': {
    id: 'curandeiro-agua-5', name: 'Gota Boa', element: 'agua', classId: 'curandeiro', unlockLevel: 5,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 0, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'heal', min: 24, max: 29 } ],
    description: 'Cura 24–29 a até 6 células, duas vezes por turno. A cura mais eficiente do jogo.',
    flavor: 'Uma gota. Ela promete que é só uma gota.',
    fxKey: 'goodDrop'
  },
  'curandeiro-agua-10': {
    id: 'curandeiro-agua-10', name: 'Fonte Serena', element: 'agua', classId: 'curandeiro', unlockLevel: 10,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 0, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'regen', min: 14, max: 19, duration: 3 }, { type: 'cleanse', kinds: ['poison'] } ],
    description: 'Regeneração de 14–19 por 3 turnos e limpeza de todos os venenos do aliado.',
    flavor: 'Ela encosta a manopla no chão e sai água. Nunca explicou.',
    fxKey: 'calmSpring'
  },
  'curandeiro-agua-12': {
    id: 'curandeiro-agua-12', name: 'Puxão de Maré', element: 'agua', classId: 'curandeiro', unlockLevel: 12,
    paCost: 2, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'any',
    effects: [ { type: 'pull', tiles: 3 } ],
    description: 'Puxa qualquer unidade 3 células: resgata o aliado ferido ou arranca o inimigo da linha de tiro dele.',
    flavor: '"Vem cá." E vem.',
    fxKey: 'tideTug'
  },
  'curandeiro-agua-15': {
    id: 'curandeiro-agua-15', name: 'Onda Boa', element: 'agua', classId: 'curandeiro', unlockLevel: 15,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'heal', min: 48, max: 58 } ],
    description: 'Cura 48–58 em todos os aliados em raio 2.',
    flavor: 'A maré que sobe levanta todos os barcos, inclusive os furados.',
    fxKey: 'goodWave'
  },
  'curandeiro-agua-20': {
    id: 'curandeiro-agua-20', name: 'Corrente Sanadora', element: 'agua', classId: 'curandeiro', unlockLevel: 20,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'heal', min: 59, max: 69 }, { type: 'regen', min: 14, max: 19, duration: 2 } ],
    description: 'Cura 59–69 imediatamente e mais 14–19 por turno durante 2 turnos. O botão de "não morra".',
    flavor: 'Água corrente não junta poeira. Nem luto.',
    fxKey: 'healingCurrent'
  },
  'curandeiro-agua-30': {
    id: 'curandeiro-agua-30', name: 'A Cisterna Boa', element: 'agua', classId: 'curandeiro', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 0, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 3 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'heal', min: 88, max: 104 }, { type: 'regen', min: 27, max: 36, duration: 3 }, { type: 'cleanse', kinds: ['poison', 'root'] }, { type: 'weatherShift', weather: 'chuva' } ],
    description: 'Cura 88–104 em raio 3, regenera 27–36 por 3 turnos, limpa venenos e raízes — e faz chover dentro do Fecho.',
    flavor: 'Existe uma cisterna que matou uma corte inteira. Ela pediu emprestada a mesma água, com melhores modos.',
    fxKey: 'goodCistern'
  },

  /* --- CURANDEIRA · TERRA: guardar o grupo atrás de casca --- */
  'curandeiro-terra-5': {
    id: 'curandeiro-terra-5', name: 'Casca Amiga', element: 'terra', classId: 'curandeiro', unlockLevel: 5,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 0, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'shield', value: 32, duration: 2 } ],
    description: '32 de escudo num aliado por 2 turnos, duas vezes por turno. Escudo é cura que chega antes.',
    flavor: 'Ela pede licença à árvore morta e a árvore empresta a casca.',
    fxKey: 'friendlyBark'
  },
  'curandeiro-terra-10': {
    id: 'curandeiro-terra-10', name: 'Emplastro de Barro', element: 'terra', classId: 'curandeiro', unlockLevel: 10,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 0, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'heal', min: 28, max: 33 }, { type: 'resist', element: 'terra', value: 20, duration: 2 } ],
    description: 'Cura 28–33 e dá 20% de resistência a terra por 2 turnos.',
    flavor: 'Barro do canteiro fundo. Cheira mal, cura bem.',
    fxKey: 'mudPoultice'
  },
  'curandeiro-terra-12': {
    id: 'curandeiro-terra-12', name: 'Raiz Zelosa', element: 'terra', classId: 'curandeiro', unlockLevel: 12,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'root', duration: 2 }, { type: 'damage', element: 'terra', min: 17, max: 22 } ],
    description: 'Raízes prendem quem está incomodando: 0 PP por 2 turnos e 17–22 de terra em raio 1.',
    flavor: '"Fica quietinho aí que eu já volto." Ninguém fica quietinho por vontade própria.',
    fxKey: 'zealousRoot'
  },
  'curandeiro-terra-15': {
    id: 'curandeiro-terra-15', name: 'Redoma de Raízes', element: 'terra', classId: 'curandeiro', unlockLevel: 15,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'shield', value: 78, duration: 2 }, { type: 'regen', min: 12, max: 17, duration: 2 } ],
    description: '78 de escudo e regeneração de 12–17 por 2 turnos em todos os aliados em raio 2.',
    flavor: 'Uma estufa portátil, feita às pressas, com o que havia no bolso.',
    fxKey: 'rootDome'
  },
  'curandeiro-terra-20': {
    id: 'curandeiro-terra-20', name: 'Pedra Amparo', element: 'terra', classId: 'curandeiro', unlockLevel: 20,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'heal', min: 58, max: 69 }, { type: 'shield', value: 75, duration: 2 }, { type: 'cleanse', kinds: ['root'] } ],
    description: 'Cura 58–69, veste 75 de escudo por 2 turnos e arranca as raízes que prendiam o aliado.',
    flavor: 'Ela chega, empurra a pedra e o mundo para de escorregar por um instante.',
    fxKey: 'stoneSuccor'
  },
  'curandeiro-terra-30': {
    id: 'curandeiro-terra-30', name: 'Jardim Fechado', element: 'terra', classId: 'curandeiro', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 0, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 3 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'heal', min: 84, max: 100 }, { type: 'shield', value: 176, duration: 3 }, { type: 'resist', element: 'terra', value: 25, duration: 3 }, { type: 'regen', min: 22, max: 27, duration: 3 } ],
    description: 'Fecha um jardim inteiro em volta do grupo: cura 84–100, 176 de escudo, 25% de resistência a terra e 22–27 de regeneração por 3 turnos, em raio 3.',
    flavor: 'Foi assim que os construtores fizeram os Fechos. Ela só copiou a ideia, em tamanho de bolso.',
    fxKey: 'sealedGarden'
  },

  /* --- CURANDEIRA · AR: chegar a tempo --- */
  'curandeiro-ar-5': {
    id: 'curandeiro-ar-5', name: 'Sopro Doce', element: 'ar', classId: 'curandeiro', unlockLevel: 5,
    paCost: 2, cooldown: 0, castsPerTurn: 2,
    range: { min: 0, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'heal', min: 15, max: 20 } ],
    description: 'Cura 15–20 por apenas 2 PA, duas vezes por turno. Cura pouco, cura sempre, sobra PA.',
    flavor: 'Sopra no machucado. Cientificamente indefensável; funciona.',
    fxKey: 'sweetBreath'
  },
  'curandeiro-ar-10': {
    id: 'curandeiro-ar-10', name: 'Fôlego Emprestado', element: 'ar', classId: 'curandeiro', unlockLevel: 10,
    paCost: 2, cooldown: 1, castsPerTurn: 1,
    range: { min: 0, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'buff', stat: 'pp', value: 2, duration: 1 }, { type: 'buff', stat: 'initiative', value: 20, duration: 2 } ],
    description: '+2 PP por 1 turno e +20 de iniciativa por 2 num aliado: alcances que não existiam passam a existir.',
    flavor: 'Guarda suspiros num vidrinho. Diz que são de gente que não precisava mais deles.',
    fxKey: 'lentBreath'
  },
  'curandeiro-ar-12': {
    id: 'curandeiro-ar-12', name: 'Troca de Lugar', element: 'ar', classId: 'curandeiro', unlockLevel: 12,
    paCost: 2, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'any',
    effects: [ { type: 'swap' } ],
    description: 'Troca de posição com qualquer unidade a até 6 células. Tira o aliado do cerco — e assume o lugar dele.',
    flavor: 'Nunca foi de fugir. Só de trocar de lugar com quem precisava mais.',
    fxKey: 'placeSwap'
  },
  'curandeiro-ar-15': {
    id: 'curandeiro-ar-15', name: 'Rajada Amiga', element: 'ar', classId: 'curandeiro', unlockLevel: 15,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'cone', size: 2 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 33, max: 41 }, { type: 'push', tiles: 3 } ],
    description: 'Um sopro em leque: 33–41 de ar e 3 células de empurrão. Abre espaço em volta de quem está caindo.',
    flavor: '"Licença!" — e meia sala recua.',
    fxKey: 'friendlyGust'
  },
  'curandeiro-ar-20': {
    id: 'curandeiro-ar-20', name: 'Brisa Restauradora', element: 'ar', classId: 'curandeiro', unlockLevel: 20,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'heal', min: 51, max: 61 }, { type: 'buff', stat: 'pp', value: 1, duration: 2 } ],
    description: 'Cura 51–61 e dá +1 PP por 2 turnos a todos os aliados em raio 2.',
    flavor: 'Cura andando. O grupo inteiro aprende a andar junto.',
    fxKey: 'restoringBreeze'
  },
  'curandeiro-ar-30': {
    id: 'curandeiro-ar-30', name: 'Respiração do Fecho', element: 'ar', classId: 'curandeiro', unlockLevel: 30,
    paCost: 6, cooldown: 4, castsPerTurn: 1,
    range: { min: 0, max: 7, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 3 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'heal', min: 84, max: 100 }, { type: 'buff', stat: 'pp', value: 2, duration: 3 }, { type: 'buff', stat: 'initiative', value: 40, duration: 3 }, { type: 'cleanse', kinds: ['poison', 'root'] } ],
    description: 'Abre todos os respiradouros da sala: cura 84–100 em raio 3, +2 PP e +40 de iniciativa por 3 turnos, e limpa venenos e raízes.',
    flavor: 'Por três turnos, o Fecho inteiro respira no ritmo dela. Depois volta a sufocar, como sempre.',
    fxKey: 'lockBreath'
  },

  /* ======================================================================
   * XAMÃ — INVOCADOR
   * Enche o tabuleiro: criaturas, armadilhas (`trap`) e pactos que fortalecem.
   * Fogo: matilha explosiva e brasa enterrada · Água: ninfa que cura e sucção
   * Terra: paredes vivas e laços · Ar: bicho veloz, rajadas e vórtices
   * Criaturas usadas (devem existir em DATA.monsters, dono Criativo Mundo):
   *   sum-familiar · sum-ember-hound · sum-magma-colossus · sum-tide-nymph
   *   sum-stone-sentinel · sum-mountain-golem · sum-storm-falcon
   * ====================================================================== */

  'invocador-neutro-1': {
    id: 'invocador-neutro-1', name: 'Chamado Menor', element: 'neutro', classId: 'invocador', unlockLevel: 0,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'summon', monsterId: 'sum-familiar' } ],
    description: 'Invoca um Familiar numa célula vazia: um corpo a mais para morder, tancar e negar passagem.',
    flavor: 'Ele nunca diz o nome do bicho. Diz que nome é compromisso.',
    fxKey: 'lesserCall'
  },
  'invocador-neutro-2': {
    id: 'invocador-neutro-2', name: 'Verbo do Pacto', element: 'neutro', classId: 'invocador', unlockLevel: 0,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'neutro', min: 13, max: 18 } ],
    description: '13–18 de dano neutro a até 5 células. Ele também ataca, quando o rebanho está ocupado.',
    flavor: 'A página foi escrita por alguém que também chamava coisas. Ninguém sabe com o quê.',
    fxKey: 'pactWord'
  },
  'invocador-neutro-3': {
    id: 'invocador-neutro-3', name: 'Estaca-Alarme', element: 'neutro', classId: 'invocador', unlockLevel: 0,
    paCost: 2, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'trap', trapId: 'trap-neutro-alarme', duration: 3 } ],
    description: 'Arma uma estaca na célula escolhida por 3 rodadas: quem pisar leva 16–22 de dano e perde 1 PP.',
    flavor: 'O mundo enterrado é cheio de corredores. Corredor é lugar de armadilha.',
    fxKey: 'alarmStake'
  },

  /* --- INVOCADOR · FOGO: matilha e brasa enterrada --- */
  'invocador-fogo-5': {
    id: 'invocador-fogo-5', name: 'Armadilha de Brasa', element: 'fogo', classId: 'invocador', unlockLevel: 5,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'trap', trapId: 'trap-fogo-brasa', duration: 3 } ],
    description: 'Enterra carvão vivo por 3 rodadas: quem pisar sofre 24–30 de fogo em raio 1 e queima por 2 turnos.',
    flavor: 'Planta brasa em fila, como quem semeia cebola.',
    fxKey: 'emberTrapSet'
  },
  'invocador-fogo-10': {
    id: 'invocador-fogo-10', name: 'Cão de Brasa', element: 'fogo', classId: 'invocador', unlockLevel: 10,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'summon', monsterId: 'sum-ember-hound' } ],
    description: 'Invoca um Cão de Brasa: rápido, mordida quente e explode ao morrer. Serve tanto vivo quanto morto.',
    flavor: 'Abana o rabo. O rabo acende o chão.',
    fxKey: 'emberHoundCall'
  },
  'invocador-fogo-12': {
    id: 'invocador-fogo-12', name: 'Pacto Ardente', element: 'fogo', classId: 'invocador', unlockLevel: 12,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'buff', stat: 'power', value: 35, duration: 2 }, { type: 'resist', element: 'fogo', value: 15, duration: 2 } ],
    description: '+35 de poder e 15% de resistência a fogo por 2 turnos — vale para aliados e para as próprias criaturas.',
    flavor: 'Pacto não é bondade. É contrato com cláusula de desempenho.',
    fxKey: 'burningPact'
  },
  'invocador-fogo-15': {
    id: 'invocador-fogo-15', name: 'Sopro do Pacto', element: 'fogo', classId: 'invocador', unlockLevel: 15,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 24, max: 30 }, { type: 'poison', element: 'fogo', min: 6, max: 8, duration: 2 } ],
    description: 'Alguma coisa sopra do outro lado do pacto: 24–30 de fogo em raio 1 e queimadura de 6–8 por 2 turnos.',
    flavor: 'O sopro vem sempre da mesma direção. Ninguém quer saber qual.',
    fxKey: 'pactBreath'
  },
  'invocador-fogo-20': {
    id: 'invocador-fogo-20', name: 'Armadilha-Pira', element: 'fogo', classId: 'invocador', unlockLevel: 20,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'trap', trapId: 'trap-fogo-pira', duration: 3 } ],
    description: 'Dobra uma pira inteira dentro de uma célula por 3 rodadas: 52–62 de fogo em raio 1 e queimadura de 12–16 em quem pisar.',
    flavor: 'Ele avisa os aliados por onde não andar. Uma vez. Baixinho.',
    fxKey: 'pyreTrapSet'
  },
  'invocador-fogo-30': {
    id: 'invocador-fogo-30', name: 'Colosso de Magma', element: 'fogo', classId: 'invocador', unlockLevel: 30,
    paCost: 6, cooldown: 5, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'summon', monsterId: 'sum-magma-colossus' }, { type: 'weatherShift', weather: 'estiagem' } ],
    description: 'Abre o chão e chama um Colosso de Magma para o campo — e o calor dele coloca a sala inteira em estiagem.',
    flavor: 'O Coração do Fecho de Brasa tem um irmão mais velho. Ninguém o convidava desde a Lousa.',
    fxKey: 'magmaColossusCall'
  },

  /* --- INVOCADOR · ÁGUA: quem cuida do rebanho e quem o traga --- */
  'invocador-agua-5': {
    id: 'invocador-agua-5', name: 'Armadilha-Redemoinho', element: 'agua', classId: 'invocador', unlockLevel: 5,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'trap', trapId: 'trap-agua-redemoinho', duration: 3 } ],
    description: 'Abre um funil de água por 3 rodadas: 20–26 de dano e 2 células de sucção em quem pisar.',
    flavor: 'Um ralo com opinião própria sobre por onde as pessoas deviam andar.',
    fxKey: 'whirlTrapSet'
  },
  'invocador-agua-10': {
    id: 'invocador-agua-10', name: 'Ninfa da Maré', element: 'agua', classId: 'invocador', unlockLevel: 10,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'summon', monsterId: 'sum-tide-nymph' } ],
    description: 'Invoca uma Ninfa da Maré: cura os aliados por conta própria enquanto o invocador cuida do resto.',
    flavor: 'Ela nunca fala. Só olha para quem está sangrando e resolve.',
    fxKey: 'tideNymphCall'
  },
  'invocador-agua-12': {
    id: 'invocador-agua-12', name: 'Pacto da Fonte', element: 'agua', classId: 'invocador', unlockLevel: 12,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'regen', min: 10, max: 13, duration: 3 }, { type: 'cleanse', kinds: ['poison'] } ],
    description: 'Regeneração de 10–13 por 3 turnos e limpeza de venenos num aliado ou numa criatura invocada.',
    flavor: 'Assinado com água. É o tipo de contrato que se pode beber depois.',
    fxKey: 'springPact'
  },
  'invocador-agua-15': {
    id: 'invocador-agua-15', name: 'Chamado da Ressaca', element: 'agua', classId: 'invocador', unlockLevel: 15,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 23, max: 29, lifesteal: true }, { type: 'pull', tiles: 2 } ],
    description: '23–29 de água com roubo de vida em raio 1 e 2 células de sucção: arrasta o inimigo para o meio do rebanho.',
    flavor: 'Chama a ressaca do jeito que se chama um cachorro grande: com cuidado.',
    fxKey: 'undertowCall'
  },
  'invocador-agua-20': {
    id: 'invocador-agua-20', name: 'Armadilha-Sorvedouro', element: 'agua', classId: 'invocador', unlockLevel: 20,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'trap', trapId: 'trap-agua-sorvedouro', duration: 3 } ],
    description: 'Um ralo do mundo antigo, armado por 3 rodadas: 46–56 de água em raio 1 e 3 células de sucção.',
    flavor: 'Ele destampou uma coisa que os construtores tinham tampado de propósito.',
    fxKey: 'maelstromTrapSet'
  },
  'invocador-agua-30': {
    id: 'invocador-agua-30', name: 'Afogado da Cisterna', element: 'agua', classId: 'invocador', unlockLevel: 30,
    paCost: 6, cooldown: 5, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'summon', monsterId: 'sum-drowned-cistern' }, { type: 'weatherShift', weather: 'chuva' } ],
    description: 'Abre a tampa e deixa subir o que estava embaixo — e a chuva vem junto com ele.',
    flavor: 'A cisterna devolve o que engoliu. Nunca um de cada vez.',
    fxKey: 'theMaelstrom'
  },

  /* --- INVOCADOR · TERRA: paredes que respiram --- */
  'invocador-terra-5': {
    id: 'invocador-terra-5', name: 'Armadilha-Laço', element: 'terra', classId: 'invocador', unlockLevel: 5,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'trap', trapId: 'trap-terra-laco', duration: 3 } ],
    description: 'Esconde um laço de raízes por 3 rodadas: 18–24 de terra e 0 PP por 2 turnos em quem pisar.',
    flavor: 'O micélio adora um pedido desses. Faz de graça.',
    fxKey: 'snareTrapSet'
  },
  'invocador-terra-10': {
    id: 'invocador-terra-10', name: 'Sentinela de Pedra', element: 'terra', classId: 'invocador', unlockLevel: 10,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'summon', monsterId: 'sum-stone-sentinel' } ],
    description: 'Invoca uma Sentinela de Pedra: lenta, dura e teimosa — o tampão de corredor do invocador.',
    flavor: 'Fica onde foi posta. É a coisa mais confiável do mundo enterrado.',
    fxKey: 'stoneSentinelCall'
  },
  'invocador-terra-12': {
    id: 'invocador-terra-12', name: 'Pacto de Casca', element: 'terra', classId: 'invocador', unlockLevel: 12,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'shield', value: 41, duration: 2 }, { type: 'resist', element: 'terra', value: 20, duration: 2 } ],
    description: '41 de escudo e 20% de resistência a terra por 2 turnos num aliado ou numa criatura invocada.',
    flavor: 'Casca emprestada da própria parede do Fecho. A parede não reclamou.',
    fxKey: 'barkPact'
  },
  'invocador-terra-15': {
    id: 'invocador-terra-15', name: 'Estacas do Pacto', element: 'terra', classId: 'invocador', unlockLevel: 15,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'terra', min: 23, max: 29 }, { type: 'root', duration: 2 } ],
    description: 'Estacas sobem do chão em raio 1: 23–29 de terra e 0 PP por 2 turnos. Prepara a célula para a armadilha seguinte.',
    flavor: 'Primeiro prende, depois arma, depois espera. Sempre nessa ordem.',
    fxKey: 'pactStakes'
  },
  'invocador-terra-20': {
    id: 'invocador-terra-20', name: 'Armadilha-Tremor', element: 'terra', classId: 'invocador', unlockLevel: 20,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'trap', trapId: 'trap-terra-tremor', duration: 3 } ],
    description: 'Enfraquece a laje por 3 rodadas: quem pisar sofre 48–58 de terra em raio 1 e fica 2 turnos sem PP.',
    flavor: 'A mina trêmula ensinou: nem todo chão é obrigado a continuar sendo chão.',
    fxKey: 'quakeTrapSet'
  },
  'invocador-terra-30': {
    id: 'invocador-terra-30', name: 'Golem da Montanha', element: 'terra', classId: 'invocador', unlockLevel: 30,
    paCost: 6, cooldown: 5, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'summon', monsterId: 'sum-mountain-golem' } ],
    description: 'Levanta um Golem da Montanha: a criatura mais dura que o mundo enterrado consegue emprestar. Um segundo tanque, de graça, todo turno.',
    flavor: 'Ele não invocou a montanha. Só perguntou se ela topava dar uns passos.',
    fxKey: 'mountainGolemCall'
  },

  /* --- INVOCADOR · AR: bicho veloz e vento armado --- */
  'invocador-ar-5': {
    id: 'invocador-ar-5', name: 'Armadilha-Rajada', element: 'ar', classId: 'invocador', unlockLevel: 5,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'trap', trapId: 'trap-ar-rajada', duration: 3 } ],
    description: 'Tampa um respiradouro por 3 rodadas: quem pisar leva 16–22 de ar e voa 3 células.',
    flavor: 'Ar velho, guardado com raiva. Vale por um chute.',
    fxKey: 'gustTrapSet'
  },
  'invocador-ar-10': {
    id: 'invocador-ar-10', name: 'Falcão da Tormenta', element: 'ar', classId: 'invocador', unlockLevel: 10,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'summon', monsterId: 'sum-storm-falcon' } ],
    description: 'Invoca um Falcão da Tormenta: muitos PP, iniciativa alta e um bico que empurra. Chega antes de todo mundo.',
    flavor: 'Não existe céu para ele voar. Voa assim mesmo, de raiva.',
    fxKey: 'stormFalconCall'
  },
  'invocador-ar-12': {
    id: 'invocador-ar-12', name: 'Pacto do Vento', element: 'ar', classId: 'invocador', unlockLevel: 12,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'buff', stat: 'pp', value: 2, duration: 2 }, { type: 'buff', stat: 'initiative', value: 25, duration: 2 } ],
    description: '+2 PP e +25 de iniciativa por 2 turnos num aliado ou criatura: o rebanho inteiro chega mais cedo.',
    flavor: 'Contrato curto, assinado no ar, sem testemunhas.',
    fxKey: 'windPact'
  },
  'invocador-ar-15': {
    id: 'invocador-ar-15', name: 'Sopro Cortante', element: 'ar', classId: 'invocador', unlockLevel: 15,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'cone', size: 3 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 28, max: 35 }, { type: 'push', tiles: 3 } ],
    description: 'Um leque de vento afiado: 28–35 de ar e 3 células de empurrão — direto para cima das armadilhas.',
    flavor: 'Ele não empurra para longe. Empurra para onde já está armado.',
    fxKey: 'cuttingBreath'
  },
  'invocador-ar-20': {
    id: 'invocador-ar-20', name: 'Armadilha-Vórtice', element: 'ar', classId: 'invocador', unlockLevel: 20,
    paCost: 4, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'trap', trapId: 'trap-ar-vortice', duration: 3 } ],
    description: 'Ata um nó de vento na célula por 3 rodadas: 42–52 de ar em raio 1 e 4 células de arremesso em quem pisar.',
    flavor: 'Desatar é fácil: basta pisar. É sempre fácil, do lado errado.',
    fxKey: 'vortexTrapSet'
  },
  'invocador-ar-30': {
    id: 'invocador-ar-30', name: 'Olho da Tormenta', element: 'ar', classId: 'invocador', unlockLevel: 30,
    paCost: 6, cooldown: 5, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'summon', monsterId: 'sum-storm-eye' }, { type: 'weatherShift', weather: 'vendaval' } ],
    description: 'Planta o miolo parado da tempestade no campo, e o vendaval se instala em volta dele.',
    flavor: 'No meio da tempestade há um lugar parado. É onde ele mora.',
    fxKey: 'falconSwarm'
  },


  /* ======================================================================
   * MINOTAURO — o verbo BARRAR (docs/CLASSES_V3.md)
   *
   * Escudo em quem precisa, MURO no chao para estragar o caminho de quem vem.
   * O dano dele e baixo DE PROPOSITO: se o Minotauro bater bem, ele vira um
   * Sumo melhor e as duas classes viram uma so. Ele nao mata — ele decide por
   * onde o outro pode andar.
   *
   * Como os quatro caminhos se separam, para nao virarem o mesmo feitico
   * pintado de outra cor:
   *   fogo  — o muro QUEIMA quem encosta; escudo que devolve dano
   *   agua  — o muro ESCORREGA (empurra quem passa perto); escudo que regenera
   *   terra — o muro DURA mais e e mais largo; escudo grosso, o mais puro
   *   ar    — o muro se MOVE junto com voce; escudo leve que da PP
   * ====================================================================== */

  'minotauro-neutro-1': {
    id: 'minotauro-neutro-1', name: 'Marrada', element: 'neutro', classId: 'minotauro', unlockLevel: 0,
    paCost: 3, cooldown: 0, castsPerTurn: 2,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'neutro', min: 16, max: 22 }, { type: 'push', tiles: 1 } ],
    description: 'Abaixa a cabeça e empurra: 16–22 de dano neutro e 1 célula de empurrão.',
    flavor: 'Ele não persegue. Ele decide onde você não vai passar.',
    fxKey: 'shoulderCharge'
  },
  'minotauro-neutro-2': {
    id: 'minotauro-neutro-2', name: 'Escudo de Ombro', element: 'neutro', classId: 'minotauro', unlockLevel: 0,
    paCost: 2, cooldown: 1, castsPerTurn: 1,
    range: { min: 0, max: 3, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'shield', value: 80, duration: 2 } ],
    description: 'Põe o próprio escudo na frente de um aliado: 80 de escudo por 2 turnos.',
    flavor: 'O escudo é dele. A vida que ele guarda é sua.',
    fxKey: 'guardWard'
  },
  'minotauro-neutro-3': {
    id: 'minotauro-neutro-3', name: 'Primeira Pedra', element: 'neutro', classId: 'minotauro', unlockLevel: 0,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'wall', duration: 2, element: 'neutro' } ],
    description: 'Ergue um muro numa célula vazia por 2 turnos — bloqueia passagem e visão.',
    flavor: 'Não é para proteger ninguém. É para o outro ter de dar a volta.',
    fxKey: 'stoneWall'
  },

  'minotauro-fogo-5': {
    id: 'minotauro-fogo-5', name: 'Muro em Brasa', element: 'fogo', classId: 'minotauro', unlockLevel: 5,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'wall', duration: 2, element: 'fogo' },
               { type: 'trap', trapId: 'trap-fogo-brasa', duration: 2 } ],
    description: 'Muro de 2 turnos que deixa brasa acesa em volta: quem encostar se queima.',
    flavor: 'A pedra esfria. A brasa embaixo dela, não.',
    fxKey: 'emberWall'
  },
  'minotauro-fogo-10': {
    id: 'minotauro-fogo-10', name: 'Couro Fervente', element: 'fogo', classId: 'minotauro', unlockLevel: 10,
    paCost: 2, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'shield', value: 110, duration: 2 },
               { type: 'reflect', pct: 25, duration: 2 } ],
    description: '110 de escudo e devolve 25% do dano recebido por 2 turnos.',
    flavor: 'Bate nele e a sua mão volta doendo.',
    fxKey: 'boilingHide'
  },
  'minotauro-fogo-12': {
    id: 'minotauro-fogo-12', name: 'Chifrada Acesa', element: 'fogo', classId: 'minotauro', unlockLevel: 12,
    paCost: 4, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 1, line: false, los: true, movable: false },
    aoe: { shape: 'cone', size: 2 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'fogo', min: 25, max: 33 }, { type: 'push', tiles: 1 } ],
    description: '25–33 de fogo num leque à frente e 1 célula de empurrão em todos.',
    flavor: 'Ele não corre atrás. Ele abre espaço.',
    fxKey: 'burningHorn'
  },
  'minotauro-fogo-15': {
    id: 'minotauro-fogo-15', name: 'Cerca de Fogo', element: 'fogo', classId: 'minotauro', unlockLevel: 15,
    paCost: 4, cooldown: 3, castsPerTurn: 1,
    range: { min: 1, max: 3, line: true, los: true, movable: false },
    aoe: { shape: 'line', size: 3 }, needsEmptyTile: false, targetSide: 'any',
    effects: [ { type: 'wall', duration: 2, element: 'fogo' },
               { type: 'damage', element: 'fogo', min: 16, max: 22 } ],
    description: 'Levanta uma linha de 3 muros e queima 16–22 em quem estava no caminho.',
    flavor: 'Três pedras, uma decisão: por aqui, não.',
    fxKey: 'fireFence'
  },
  'minotauro-fogo-20': {
    id: 'minotauro-fogo-20', name: 'Bigorna Viva', element: 'fogo', classId: 'minotauro', unlockLevel: 20,
    paCost: 3, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 3, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'shield', value: 160, duration: 3 },
               { type: 'reflect', pct: 35, duration: 3 } ],
    description: '160 de escudo e 35% de dano devolvido, por 3 turnos, num aliado.',
    flavor: 'Quem bate na bigorna aprende sobre a bigorna.',
    fxKey: 'livingAnvil'
  },
  'minotauro-fogo-30': {
    id: 'minotauro-fogo-30', name: 'A Forja Fechada', element: 'fogo', classId: 'minotauro', unlockLevel: 30,
    paCost: 5, cooldown: 5, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'ring', size: 2 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'wall', duration: 3, element: 'fogo' },
               { type: 'shield', value: 180, duration: 3 } ],
    description: 'Fecha um anel de muros em raio 2 à sua volta e ganha 180 de escudo por 3 turnos.',
    flavor: 'A forja não tem porta. Quem entrou, fica.',
    fxKey: 'sealedForge'
  },

  'minotauro-agua-5': {
    id: 'minotauro-agua-5', name: 'Muro Escorregadio', element: 'agua', classId: 'minotauro', unlockLevel: 5,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'wall', duration: 2, element: 'agua' },
               { type: 'trap', trapId: 'trap-agua-redemoinho', duration: 2 } ],
    description: 'Muro de 2 turnos com o chão molhado em volta: quem chega perto escorrega.',
    flavor: 'A pedra para o corpo. A poça decide o resto.',
    fxKey: 'slickWall'
  },
  'minotauro-agua-10': {
    id: 'minotauro-agua-10', name: 'Casco de Maré', element: 'agua', classId: 'minotauro', unlockLevel: 10,
    paCost: 2, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 3, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'shield', value: 90, duration: 3 },
               { type: 'regen', min: 16, max: 24, duration: 3 } ],
    description: '90 de escudo e 16–24 de vida por turno, durante 3 turnos.',
    flavor: 'A maré bate e devolve. Sempre devolve.',
    fxKey: 'tideHusk'
  },
  'minotauro-agua-12': {
    id: 'minotauro-agua-12', name: 'Empurrão de Onda', element: 'agua', classId: 'minotauro', unlockLevel: 12,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 2, line: false, los: true, movable: false },
    aoe: { shape: 'cone', size: 2 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'agua', min: 19, max: 26 }, { type: 'push', tiles: 2 } ],
    description: '19–26 de água num leque e 2 células de empurrão.',
    flavor: 'Ninguém segura água. Ela é que segura você.',
    fxKey: 'waveShove'
  },
  'minotauro-agua-15': {
    id: 'minotauro-agua-15', name: 'Dique', element: 'agua', classId: 'minotauro', unlockLevel: 15,
    paCost: 4, cooldown: 3, castsPerTurn: 1,
    range: { min: 1, max: 3, line: true, los: true, movable: false },
    aoe: { shape: 'line', size: 3 }, needsEmptyTile: false, targetSide: 'any',
    effects: [ { type: 'wall', duration: 3, element: 'agua' }, { type: 'push', tiles: 1 } ],
    description: 'Uma linha de 3 muros por 3 turnos, empurrando 1 célula quem estava ali.',
    flavor: 'O rio não discute com o dique. Só faz a volta.',
    fxKey: 'dike'
  },
  'minotauro-agua-20': {
    id: 'minotauro-agua-20', name: 'Cisterna Guardada', element: 'agua', classId: 'minotauro', unlockLevel: 20,
    paCost: 4, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 2 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'shield', value: 120, duration: 3 },
               { type: 'regen', min: 20, max: 28, duration: 3 } ],
    description: '120 de escudo e 20–28 de regeneração por turno, para você e quem estiver em raio 2.',
    flavor: 'Ele guarda a água. A água guarda todo mundo.',
    fxKey: 'guardedCistern'
  },
  'minotauro-agua-30': {
    id: 'minotauro-agua-30', name: 'O Cerco de Água', element: 'agua', classId: 'minotauro', unlockLevel: 30,
    paCost: 5, cooldown: 5, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'ring', size: 2 }, needsEmptyTile: false, targetSide: 'any',
    effects: [ { type: 'wall', duration: 3, element: 'agua' },
               { type: 'damage', element: 'agua', min: 22, max: 30 },
               { type: 'push', tiles: 1 } ],
    description: 'Anel de muros em raio 2 no alvo: 22–30 de água e 1 de empurrão em quem ficou dentro.',
    flavor: 'Cercar não é prender. É escolher a saída por ele.',
    fxKey: 'waterSiege'
  },

  'minotauro-terra-5': {
    id: 'minotauro-terra-5', name: 'Menir', element: 'terra', classId: 'minotauro', unlockLevel: 5,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'wall', duration: 4, element: 'terra' } ],
    description: 'Ergue um muro que dura 4 turnos — o mais teimoso dos quatro caminhos.',
    flavor: 'Puseram ali antes de haver estrada. A estrada é que deu a volta.',
    fxKey: 'menhir'
  },
  'minotauro-terra-10': {
    id: 'minotauro-terra-10', name: 'Casca de Pedra', element: 'terra', classId: 'minotauro', unlockLevel: 10,
    paCost: 2, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 3, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'shield', value: 140, duration: 2 },
               { type: 'resist', element: 'terra', value: 20, duration: 2 } ],
    description: '140 de escudo — o mais grosso do jogo — e +20% de resistência a terra por 2 turnos.',
    flavor: 'Não é armadura. É o chão dizendo que hoje não.',
    fxKey: 'stoneBark'
  },
  'minotauro-terra-12': {
    id: 'minotauro-terra-12', name: 'Baque de Casco', element: 'terra', classId: 'minotauro', unlockLevel: 12,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 0, line: false, los: false, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'self',
    effects: [ { type: 'damage', element: 'terra', min: 20, max: 27 }, { type: 'root', duration: 1 } ],
    description: '20–27 de terra em raio 1 e 0 PP por 1 turno em quem estiver perto.',
    flavor: 'O chão treme uma vez. Quem estava em pé aprende.',
    fxKey: 'hoofQuake'
  },
  'minotauro-terra-15': {
    id: 'minotauro-terra-15', name: 'Muralha', element: 'terra', classId: 'minotauro', unlockLevel: 15,
    paCost: 4, cooldown: 3, castsPerTurn: 1,
    range: { min: 1, max: 3, line: true, los: true, movable: false },
    aoe: { shape: 'line', size: 3 }, needsEmptyTile: false, targetSide: 'any',
    effects: [ { type: 'wall', duration: 4, element: 'terra' } ],
    description: 'Três muros em linha, de pé por 4 turnos. Corta a sala em duas.',
    flavor: 'Toda muralha é uma frase curta: não.',
    fxKey: 'rampart'
  },
  'minotauro-terra-20': {
    id: 'minotauro-terra-20', name: 'Fundação', element: 'terra', classId: 'minotauro', unlockLevel: 20,
    paCost: 3, cooldown: 4, castsPerTurn: 1,
    range: { min: 0, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'circle', size: 1 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'shield', value: 190, duration: 3 },
               { type: 'resist', element: 'neutro', value: 15, duration: 3 } ],
    description: '190 de escudo e +15% de resistência para você e os aliados em raio 1, por 3 turnos.',
    flavor: 'Ele não levanta parede. Ele levanta o chão.',
    fxKey: 'foundation'
  },
  'minotauro-terra-30': {
    id: 'minotauro-terra-30', name: 'O Labirinto', element: 'terra', classId: 'minotauro', unlockLevel: 30,
    paCost: 5, cooldown: 5, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'cross', size: 2 }, needsEmptyTile: false, targetSide: 'any',
    effects: [ { type: 'wall', duration: 4, element: 'terra' },
               { type: 'root', duration: 1 } ],
    description: 'Cruz de muros de 4 turnos em torno do alvo, e 0 PP por 1 turno em quem ficou dentro.',
    flavor: 'O labirinto é dele. Vocês só estão passando.',
    fxKey: 'labyrinth'
  },

  'minotauro-ar-5': {
    id: 'minotauro-ar-5', name: 'Parede de Sopro', element: 'ar', classId: 'minotauro', unlockLevel: 5,
    paCost: 3, cooldown: 2, castsPerTurn: 1,
    range: { min: 1, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: true, targetSide: 'any',
    effects: [ { type: 'wall', duration: 1, element: 'ar' },
               { type: 'trap', trapId: 'trap-ar-rajada', duration: 2 } ],
    description: 'Muro de 1 turno, mas erguido de longe — e deixa uma rajada armada em volta.',
    flavor: 'Dura um instante. O instante era o que faltava.',
    fxKey: 'gustWall'
  },
  'minotauro-ar-10': {
    id: 'minotauro-ar-10', name: 'Escudo Leve', element: 'ar', classId: 'minotauro', unlockLevel: 10,
    paCost: 2, cooldown: 2, castsPerTurn: 1,
    range: { min: 0, max: 4, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'shield', value: 70, duration: 2 },
               { type: 'buff', stat: 'pp', value: 1, duration: 2 } ],
    description: '70 de escudo e +1 PP por 2 turnos — o escudo que não pesa.',
    flavor: 'Proteger não é prender no lugar.',
    fxKey: 'lightWard'
  },
  'minotauro-ar-12': {
    id: 'minotauro-ar-12', name: 'Chifre de Vento', element: 'ar', classId: 'minotauro', unlockLevel: 12,
    paCost: 3, cooldown: 1, castsPerTurn: 1,
    range: { min: 1, max: 3, line: true, los: true, movable: false },
    aoe: { shape: 'line', size: 3 }, needsEmptyTile: false, targetSide: 'enemy',
    effects: [ { type: 'damage', element: 'ar', min: 21, max: 29 }, { type: 'push', tiles: 2 } ],
    description: '21–29 de ar numa linha de 3 e 2 células de empurrão.',
    flavor: 'A investida passa. O vento dela continua.',
    fxKey: 'windHorn'
  },
  'minotauro-ar-15': {
    id: 'minotauro-ar-15', name: 'Cerca Volante', element: 'ar', classId: 'minotauro', unlockLevel: 15,
    paCost: 3, cooldown: 3, castsPerTurn: 1,
    range: { min: 1, max: 6, line: true, los: true, movable: false },
    aoe: { shape: 'line', size: 3 }, needsEmptyTile: false, targetSide: 'any',
    effects: [ { type: 'wall', duration: 2, element: 'ar' } ],
    description: 'Três muros em linha, erguidos a 6 células de distância — o maior alcance da classe.',
    flavor: 'Ele fecha a porta do outro lado da sala.',
    fxKey: 'flyingFence'
  },
  'minotauro-ar-20': {
    id: 'minotauro-ar-20', name: 'Guarda Errante', element: 'ar', classId: 'minotauro', unlockLevel: 20,
    paCost: 3, cooldown: 3, castsPerTurn: 1,
    range: { min: 0, max: 5, line: false, los: true, movable: false },
    aoe: { shape: 'single', size: 0 }, needsEmptyTile: false, targetSide: 'ally',
    effects: [ { type: 'shield', value: 130, duration: 3 },
               { type: 'buff', stat: 'pp', value: 2, duration: 3 } ],
    description: '130 de escudo e +2 PP por 3 turnos. Protege quem precisa correr.',
    flavor: 'A guarda dele anda com você.',
    fxKey: 'wanderingGuard'
  },
  'minotauro-ar-30': {
    id: 'minotauro-ar-30', name: 'O Curral de Vento', element: 'ar', classId: 'minotauro', unlockLevel: 30,
    paCost: 5, cooldown: 5, castsPerTurn: 1,
    range: { min: 1, max: 6, line: false, los: true, movable: false },
    aoe: { shape: 'ring', size: 2 }, needsEmptyTile: false, targetSide: 'any',
    effects: [ { type: 'wall', duration: 2, element: 'ar' },
               { type: 'push', tiles: 2 },
               { type: 'damage', element: 'ar', min: 22, max: 30 } ],
    description: 'Anel de muros a até 6 células: empurra 2, causa 22–30 de ar e fecha o cerco.',
    flavor: 'Curral não precisa ser grande. Precisa ser fechado.',
    fxKey: 'windPen'
  },

};
