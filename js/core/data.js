var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

// ============================================================================
// SOTERRA — Ecos do Mundo Enterrado
// Dados do jogo (dono: Agente Criativo). Ver docs/GDD.md para o design completo.
// O objeto abaixo é JSON puro (validável por tests/validate_data.html).
// NÃO editar sem rodar a validação.
// ============================================================================

JOGO.DATA = {
  "gameTitle": "SOTERRA",
  "gameSubtitle": "Ecos do Mundo Enterrado",

  "races": [
    {
      "id": "bellborn",
      "name": "Sineiros",
      "description": "Gente de bronze fundido nos primeiros Fechos. Corpo pesado e abaulado, cabeça em forma de sino sem rosto: falam, riem e choram em badaladas. Veias de azinhavre verde correm pelo metal como hera.",
      "lore": "Foram fundidos pelos construtores dos Fechos para segurar os portões quando a Grande Lousa desceu. Os construtores se foram; os Sineiros ficaram, tocando as horas de um tempo que ninguém mais conta. Cada cicatriz no bronze é um dobre que eles se recusam a esquecer.",
      "palette": { "primary": "#b08543", "secondary": "#3f8f7a", "accent": "#ffd98a" },
      "trait": "Liga Paciente — o bronze dos Sineiros não racha: eles atravessam a frente de batalha como um portão ambulante, feitos para apanhar no lugar dos outros."
    },
    {
      "id": "waxkin",
      "name": "Pávios",
      "description": "Povo de cera morna com uma chama viva acesa no alto da cabeça. Silhueta fina e escorrida, dedos longos que pingam; remodelam o próprio corpo como quem ajeita o cabelo. Quando a chama baixa, o Pávio some no escuro.",
      "lore": "Nasceram das velas votivas acesas nos funerais do mundo antigo. Cada Pávio é a sua própria chama: emprestá-la é intimidade, apagá-la é o silêncio absoluto — e os Pávios aprenderam a usar esse silêncio como faca. Vivem depressa, derretem devagar.",
      "palette": { "primary": "#e8d5a8", "secondary": "#8a5a44", "accent": "#ff8c3a" },
      "trait": "Pavio Curto — um Pávio nunca está onde a chama indica: escorrem entre as frestas, somem no breu e reaparecem atrás do inimigo com a lâmina já quente."
    },
    {
      "id": "sporeborn",
      "name": "Miceles",
      "description": "Povo-fungo de chapéu largo como um guarda-chuva carnudo, véu de lamelas cobrindo o rosto e filamentos pálidos no lugar dos pés. Brilham em turquesa no escuro. Sob o véu, ninguém sabe o que há — e os Miceles gostam assim.",
      "lore": "Enquanto todos cavavam para baixo, os Miceles cresceram POR DENTRO das paredes. Sua memória é coletiva: o micélio que corre pelos Fechos é um só corpo sonhando em milhares de chapéus. Um Micele nunca está sozinho; carrega os esporos de todos os seus mortos.",
      "palette": { "primary": "#7a5fa0", "secondary": "#33453f", "accent": "#6fe0c8" },
      "trait": "Bolor Fecundo — onde um Micele pisa, algo brota: crias de esporo, nuvens pútridas e um veneno doce que trabalha enquanto o dono descansa."
    },
    {
      "id": "glassborn",
      "name": "Vitrélios",
      "description": "Seres de vitral vivo: placas de vidro colorido articuladas por um esqueleto de chumbo dourado, com um núcleo de luz pulsando no peito. Cada Vitrélio retrata em seu próprio corpo uma cena do céu perdido.",
      "lore": "Quando o céu virou pedra, os artesãos gravaram sua lembrança nas rosáceas dos templos — e a lembrança acordou. Os Vitrélios são janelas que andam: a última luz do sol antigo mora dentro deles, e eles a repartem com quem sangra no escuro.",
      "palette": { "primary": "#6d7fd3", "secondary": "#2e2a4a", "accent": "#ffd166" },
      "trait": "Última Claridade — a luz que atravessa um Vitrélio sai maior do que entrou: fecha feridas, endurece a pele dos aliados e lembra ao escuro quem chegou primeiro."
    },
    {
      "id": "bellowsborn",
      "name": "Fôlegos",
      "description": "Povo-fole: torso sanfonado de couro e madeira clara que infla e desinfla, braços como tubos flexíveis e uma boca-válvula que assobia ao falar. Leves demais, andam como se o chão fosse opcional.",
      "lore": "Um mundo enterrado sufoca — alguém precisa respirar por ele. Os Fôlegos mantêm vivos os respiradouros dos Fechos, bombeando o ar antigo de sala em sala. Dizem que o último suspiro de cada criatura passa pelos foles de um Fôlego, que o guarda e o devolve a quem precisa.",
      "palette": { "primary": "#7fb6b0", "secondary": "#4a5a66", "accent": "#eef7f5" },
      "trait": "Sopro Emprestado — para um Fôlego, posição é opinião: eles empurram, sugam e trocam corpos de lugar como quem reorganiza os móveis da sala."
    }
  ],

  "heroes": [
    {
      "id": "hero-toll",
      "raceId": "bellborn",
      "name": "Repique",
      "title": "o Dobre-Guardião",
      "description": "Último porteiro do Fecho Setentrional. Fala pouco, e cada palavra soa como hora grave. Acredita que proteger é a única música que importa. Tanque: escudos, provocação e controle de linha de frente.",
      "stats": { "hp": 140, "pa": 6, "pm": 3, "initiative": 20, "power": 0, "resists": { "fire": 0, "water": 0, "earth": 0, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["bell-strike", "curfew-toll", "bronze-wall", "funeral-knell", "bell-call"]
    },
    {
      "id": "hero-wick",
      "raceId": "waxkin",
      "name": "Estopim",
      "title": "a Chama que Some",
      "description": "Ladra de relíquias que jura estar aposentada desde sempre. Ri no escuro, some no meio da frase. Assassina: teleporte, invisibilidade e execuções à queima-roupa.",
      "stats": { "hp": 95, "pa": 6, "pm": 3, "initiative": 85, "power": 0, "resists": { "fire": 0, "water": 0, "earth": 0, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["wick-jump", "snuff-out", "molten-blade", "spark-spit", "fan-flame"]
    },
    {
      "id": "hero-morel",
      "raceId": "sporeborn",
      "name": "Morela",
      "title": "a Pastora de Esporos",
      "description": "Carrega os mortos da sua colônia em esporos sob o véu — e os semeia na batalha. Doce, paciente e absolutamente implacável. Invocadora: crias de esporo e veneno que corrói turno após turno.",
      "stats": { "hp": 105, "pa": 6, "pm": 3, "initiative": 45, "power": 0, "resists": { "fire": 0, "water": 0, "earth": 0, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["sporeling-call", "mold-dart", "spore-cloud", "mycelial-snare", "putrid-feast"]
    },
    {
      "id": "hero-rose",
      "raceId": "glassborn",
      "name": "Rosácea",
      "title": "a Janela do Amanhã",
      "description": "Retrata no próprio corpo o nascer do sol que ninguém viu. Otimista de uma teimosia geológica: se o céu voltar um dia, será porque ela não deixou ninguém desistir. Suporte: cura, escudos e bênçãos de poder.",
      "stats": { "hp": 110, "pa": 6, "pm": 3, "initiative": 60, "power": 0, "resists": { "fire": 0, "water": 0, "earth": 0, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["light-shard", "vital-refraction", "prism-dome", "radiant-hymn", "sun-memory"]
    },
    {
      "id": "hero-whistle",
      "raceId": "bellowsborn",
      "name": "Sibilo",
      "title": "o Vento Emprestado",
      "description": "Zelador de respiradouros que decorou a planta de cada Fecho pelo assobio do ar. Trata a batalha como um problema de ventilação: tudo no lugar errado. Controlador: empurrões, sucções e trocas de posição.",
      "stats": { "hp": 100, "pa": 6, "pm": 3, "initiative": 70, "power": 0, "resists": { "fire": 0, "water": 0, "earth": 0, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["gale-push", "bellows-suction", "air-swap", "wind-lash", "second-wind"]
    }
  ],

  "spells": {

    "bell-strike": {
      "id": "bell-strike", "name": "Badalada", "element": "earth", "paCost": 3, "cooldown": 0, "castsPerTurn": 2,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "earth", "min": 21, "max": 27 }, { "type": "push", "tiles": 1 } ],
      "description": "Repique gira o corpo e golpeia com o próprio badalo: o eco atravessa o peito do inimigo e o empurra 1 célula.",
      "fxKey": "slam"
    },
    "curfew-toll": {
      "id": "curfew-toll", "name": "Toque de Recolher", "element": "neutral", "paCost": 3, "cooldown": 3, "castsPerTurn": 1,
      "range": { "min": 0, "max": 0, "line": false, "los": false },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "taunt", "duration": 2 }, { "type": "shield", "value": 25, "duration": 2 } ],
      "description": "Um dobre grave que nenhuma criatura consegue ignorar: todos os inimigos são forçados a atacar Repique por 2 turnos, e ele ganha 25 de escudo.",
      "fxKey": "shieldFx"
    },
    "bronze-wall": {
      "id": "bronze-wall", "name": "Muralha de Bronze", "element": "earth", "paCost": 3, "cooldown": 2, "castsPerTurn": 1,
      "range": { "min": 0, "max": 4, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "shield", "value": 35, "duration": 2 } ],
      "description": "Repique verte parte do próprio bronze sobre um aliado, moldando um escudo de 35 pontos por 2 turnos.",
      "fxKey": "shieldFx"
    },
    "funeral-knell": {
      "id": "funeral-knell", "name": "Dobre Fúnebre", "element": "earth", "paCost": 4, "cooldown": 2, "castsPerTurn": 1,
      "range": { "min": 0, "max": 0, "line": false, "los": false },
      "aoe": { "shape": "cross", "size": 2 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "earth", "min": 16, "max": 21 } ],
      "description": "O sino toca por quem vai morrer: uma onda de choque em cruz castiga tudo ao redor de Repique.",
      "fxKey": "nova"
    },
    "bell-call": {
      "id": "bell-call", "name": "Chamado do Sino", "element": "neutral", "paCost": 2, "cooldown": 1, "castsPerTurn": 1,
      "range": { "min": 2, "max": 5, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "pull", "tiles": 3 }, { "type": "damage", "element": "neutral", "min": 7, "max": 10 } ],
      "description": "O sino chama — e o corpo obedece. Puxa o alvo 3 células em direção a Repique, sacudindo-o no caminho.",
      "fxKey": "hook"
    },

    "wick-jump": {
      "id": "wick-jump", "name": "Salto de Pavio", "element": "fire", "paCost": 2, "cooldown": 2, "castsPerTurn": 1,
      "range": { "min": 1, "max": 4, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": true,
      "effects": [ { "type": "teleport" } ],
      "description": "A chama de Estopim salta como se pulasse de um pavio a outro — e o corpo de cera escorre atrás, reaparecendo na célula escolhida.",
      "fxKey": "blink"
    },
    "snuff-out": {
      "id": "snuff-out", "name": "Apagar-se", "element": "shadow", "paCost": 2, "cooldown": 4, "castsPerTurn": 1,
      "range": { "min": 0, "max": 0, "line": false, "los": false },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "invisible", "duration": 2 } ],
      "description": "Estopim aperta a própria chama entre os dedos. O escuro a engole por 2 turnos — nenhum inimigo consegue mirá-la.",
      "fxKey": "veil"
    },
    "molten-blade": {
      "id": "molten-blade", "name": "Lâmina Escaldante", "element": "fire", "paCost": 4, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "fire", "min": 38, "max": 46 } ],
      "description": "Uma adaga de cera fervente cravada onde mais dói. O golpe favorito de quem ataca pelas costas.",
      "fxKey": "slam"
    },
    "spark-spit": {
      "id": "spark-spit", "name": "Cuspe de Fagulha", "element": "fire", "paCost": 2, "cooldown": 0, "castsPerTurn": 2,
      "range": { "min": 2, "max": 5, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "fire", "min": 16, "max": 21 } ],
      "description": "Estopim sopra uma fagulha da própria chama, que cruza a sala assobiando e morde o alvo.",
      "fxKey": "bolt"
    },
    "fan-flame": {
      "id": "fan-flame", "name": "Avivar a Chama", "element": "fire", "paCost": 2, "cooldown": 3, "castsPerTurn": 1,
      "range": { "min": 0, "max": 0, "line": false, "los": false },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "buff", "stat": "power", "value": 25, "duration": 2 } ],
      "description": "Estopim abana a própria chama até ela rugir: +25 de poder por 2 turnos. Cera derretida pinga no chão.",
      "fxKey": "buff"
    },

    "sporeling-call": {
      "id": "sporeling-call", "name": "Brotar Esporinho", "element": "earth", "paCost": 3, "cooldown": 2, "castsPerTurn": 1,
      "range": { "min": 1, "max": 3, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": true,
      "effects": [ { "type": "summon", "monsterId": "sporeling" } ],
      "description": "Morela sacode o véu e um esporo cai, brota e abre os olhinhos: um Esporinho leal que morde — e estoura em nuvem tóxica ao morrer.",
      "fxKey": "summonFx"
    },
    "mold-dart": {
      "id": "mold-dart", "name": "Dardo de Bolor", "element": "earth", "paCost": 3, "cooldown": 0, "castsPerTurn": 2,
      "range": { "min": 1, "max": 5, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "earth", "min": 13, "max": 17 }, { "type": "poison", "element": "earth", "min": 5, "max": 8, "duration": 2 } ],
      "description": "Um dardo felpudo que se enterra na carne e floresce: dano imediato e veneno que trabalha por 2 turnos.",
      "fxKey": "bolt"
    },
    "spore-cloud": {
      "id": "spore-cloud", "name": "Véu de Esporos", "element": "earth", "paCost": 3, "cooldown": 2, "castsPerTurn": 1,
      "range": { "min": 1, "max": 4, "line": false, "los": true },
      "aoe": { "shape": "circle", "size": 1 }, "needsEmptyTile": false,
      "effects": [ { "type": "poison", "element": "earth", "min": 8, "max": 11, "duration": 2 } ],
      "description": "Morela ergue o véu por um instante. A nuvem que escapa envenena todos na área por 2 turnos.",
      "fxKey": "poisonCloud"
    },
    "mycelial-snare": {
      "id": "mycelial-snare", "name": "Laço Micelial", "element": "earth", "paCost": 2, "cooldown": 1, "castsPerTurn": 1,
      "range": { "min": 1, "max": 4, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "buff", "stat": "pm", "value": -2, "duration": 1 }, { "type": "damage", "element": "earth", "min": 6, "max": 9 } ],
      "description": "Filamentos pálidos irrompem do chão e amarram os tornozelos do alvo: -2 PM no próximo turno dele.",
      "fxKey": "debuff"
    },
    "putrid-feast": {
      "id": "putrid-feast", "name": "Banquete Pútrido", "element": "shadow", "paCost": 3, "cooldown": 1, "castsPerTurn": 1,
      "range": { "min": 1, "max": 2, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "shadow", "min": 22, "max": 28, "lifesteal": true } ],
      "description": "O micélio devora o alvo por dentro e devolve a Morela metade do que colheu. Nada se desperdiça.",
      "fxKey": "burst"
    },

    "light-shard": {
      "id": "light-shard", "name": "Estilhaço Radiante", "element": "light", "paCost": 3, "cooldown": 0, "castsPerTurn": 2,
      "range": { "min": 1, "max": 6, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "light", "min": 22, "max": 28 } ],
      "description": "Rosácea desprende uma placa do próprio corpo e a arremessa: um caco de sol antigo, afiado como culpa.",
      "fxKey": "bolt"
    },
    "vital-refraction": {
      "id": "vital-refraction", "name": "Refração Vital", "element": "light", "paCost": 3, "cooldown": 0, "castsPerTurn": 2,
      "range": { "min": 0, "max": 5, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "heal", "min": 24, "max": 30 } ],
      "description": "A luz do núcleo de Rosácea atravessa seus vitrais e sai curativa: fecha feridas como quem emenda vidro quebrado.",
      "fxKey": "heal"
    },
    "prism-dome": {
      "id": "prism-dome", "name": "Redoma Prismática", "element": "light", "paCost": 3, "cooldown": 2, "castsPerTurn": 1,
      "range": { "min": 0, "max": 4, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "shield", "value": 22, "duration": 2 }, { "type": "regen", "min": 6, "max": 9, "duration": 2 } ],
      "description": "Uma cúpula de vitral se fecha sobre o aliado: 22 de escudo e cura contínua por 2 turnos.",
      "fxKey": "shieldFx"
    },
    "radiant-hymn": {
      "id": "radiant-hymn", "name": "Hino Radiante", "element": "light", "paCost": 2, "cooldown": 2, "castsPerTurn": 1,
      "range": { "min": 0, "max": 4, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "buff", "stat": "power", "value": 20, "duration": 2 } ],
      "description": "Rosácea vibra como um órgão de catedral. O aliado banhado no acorde ganha +20 de poder por 2 turnos.",
      "fxKey": "buff"
    },
    "sun-memory": {
      "id": "sun-memory", "name": "Memória do Sol", "element": "light", "paCost": 4, "cooldown": 2, "castsPerTurn": 1,
      "range": { "min": 0, "max": 4, "line": false, "los": true },
      "aoe": { "shape": "circle", "size": 1 }, "needsEmptyTile": false,
      "effects": [ { "type": "heal", "min": 14, "max": 18 } ],
      "description": "Por um instante, Rosácea projeta o amanhecer gravado em seu peito. Todos na área lembram do calor — e saram.",
      "fxKey": "nova"
    },

    "gale-push": {
      "id": "gale-push", "name": "Rajada de Fole", "element": "air", "paCost": 3, "cooldown": 0, "castsPerTurn": 2,
      "range": { "min": 1, "max": 4, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "air", "min": 13, "max": 17 }, { "type": "push", "tiles": 2 } ],
      "description": "Sibilo comprime o torso-sanfona e dispara um soco de ar que arremessa o alvo 2 células para trás.",
      "fxKey": "gust"
    },
    "bellows-suction": {
      "id": "bellows-suction", "name": "Sucção", "element": "air", "paCost": 2, "cooldown": 1, "castsPerTurn": 1,
      "range": { "min": 2, "max": 5, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "pull", "tiles": 3 }, { "type": "damage", "element": "air", "min": 6, "max": 9 } ],
      "description": "Sibilo abre as válvulas e inspira fundo: o vácuo arrasta o alvo 3 células na sua direção.",
      "fxKey": "hook"
    },
    "air-swap": {
      "id": "air-swap", "name": "Permuta de Ar", "element": "air", "paCost": 2, "cooldown": 3, "castsPerTurn": 1,
      "range": { "min": 1, "max": 5, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "swap" } ],
      "description": "Dois corpos, um sopro: Sibilo troca de lugar com o alvo — aliado em apuros ou inimigo em posição boa demais.",
      "fxKey": "blink"
    },
    "wind-lash": {
      "id": "wind-lash", "name": "Chicote de Corrente", "element": "air", "paCost": 3, "cooldown": 0, "castsPerTurn": 2,
      "range": { "min": 1, "max": 3, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "air", "min": 26, "max": 32 } ],
      "description": "Uma corrente de ar afiada como lâmina de barbear, estalada com precisão de zelador irritado.",
      "fxKey": "beam"
    },
    "second-wind": {
      "id": "second-wind", "name": "Fôlego Emprestado", "element": "air", "paCost": 2, "cooldown": 3, "castsPerTurn": 1,
      "range": { "min": 0, "max": 4, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "buff", "stat": "pm", "value": 2, "duration": 1 } ],
      "description": "Sibilo empresta um suspiro guardado: o aliado ganha +2 PM neste turno. Ele sempre cobra de volta, depois.",
      "fxKey": "buff"
    },

    "m-thorn-shot": {
      "id": "m-thorn-shot", "name": "Farpa", "element": "earth", "paCost": 3, "cooldown": 0, "castsPerTurn": 2,
      "range": { "min": 2, "max": 6, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "earth", "min": 12, "max": 16 } ],
      "description": "A vergasta chicoteia e dispara um espinho farpado.",
      "fxKey": "bolt"
    },
    "m-root-grip": {
      "id": "m-root-grip", "name": "Raiz-Trava", "element": "earth", "paCost": 3, "cooldown": 2, "castsPerTurn": 1,
      "range": { "min": 1, "max": 4, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "buff", "stat": "pm", "value": -1, "duration": 1 }, { "type": "damage", "element": "earth", "min": 6, "max": 9 } ],
      "description": "Raízes agarram o tornozelo do alvo: -1 PM no próximo turno.",
      "fxKey": "debuff"
    },
    "m-pollen-bite": {
      "id": "m-pollen-bite", "name": "Mordiscada", "element": "earth", "paCost": 3, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "earth", "min": 8, "max": 12 } ],
      "description": "Uma mordida fofa de dentinhos de pólen. O perigo de verdade vem depois.",
      "fxKey": "slam"
    },
    "m-burr-hug": {
      "id": "m-burr-hug", "name": "Abraço Farpado", "element": "earth", "paCost": 3, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "earth", "min": 10, "max": 14 } ],
      "description": "O carrapicho se atira no alvo e gruda, farpas para dentro.",
      "fxKey": "slam"
    },
    "m-wasp-sting": {
      "id": "m-wasp-sting", "name": "Ferrão Lustroso", "element": "air", "paCost": 3, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "air", "min": 9, "max": 13 }, { "type": "poison", "element": "air", "min": 4, "max": 6, "duration": 2 } ],
      "description": "O ferrão da vespa injeta um veneno que arde por 2 turnos.",
      "fxKey": "bolt"
    },
    "m-sap-mend": {
      "id": "m-sap-mend", "name": "Seiva Doce", "element": "water", "paCost": 3, "cooldown": 0, "castsPerTurn": 2,
      "range": { "min": 0, "max": 4, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "heal", "min": 12, "max": 16 } ],
      "description": "O seiveiro verte seiva dourada sobre as feridas de um aliado.",
      "fxKey": "heal"
    },
    "m-sap-sugar": {
      "id": "m-sap-sugar", "name": "Açúcar Bruto", "element": "earth", "paCost": 2, "cooldown": 2, "castsPerTurn": 1,
      "range": { "min": 0, "max": 4, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "buff", "stat": "power", "value": 15, "duration": 2 } ],
      "description": "Uma dose de açúcar cru deixa o aliado frenético: +15 de poder.",
      "fxKey": "buff"
    },
    "m-shears": {
      "id": "m-shears", "name": "Tesourada", "element": "earth", "paCost": 4, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 2, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "earth", "min": 24, "max": 30 } ],
      "description": "A tesoura de poda da Jardineira fecha com um estalo úmido.",
      "fxKey": "slam"
    },
    "m-vine-hook": {
      "id": "m-vine-hook", "name": "Cipó-Fisga", "element": "earth", "paCost": 3, "cooldown": 1, "castsPerTurn": 1,
      "range": { "min": 2, "max": 6, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "pull", "tiles": 3 }, { "type": "damage", "element": "earth", "min": 8, "max": 12 } ],
      "description": "Um cipó farpado fisga o alvo e o arrasta 3 células até a tesoura.",
      "fxKey": "hook"
    },
    "m-seed-toss": {
      "id": "m-seed-toss", "name": "Semeadura", "element": "earth", "paCost": 3, "cooldown": 2, "castsPerTurn": 1,
      "range": { "min": 1, "max": 4, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": true,
      "effects": [ { "type": "summon", "monsterId": "sprout-feral" } ],
      "description": "A Jardineira planta uma semente que germina na hora, faminta.",
      "fxKey": "summonFx"
    },
    "m-sprout-bite": {
      "id": "m-sprout-bite", "name": "Dentinhos", "element": "earth", "paCost": 3, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "earth", "min": 7, "max": 10 } ],
      "description": "O brotinho morde com todas as suas fileiras de dentes de semente.",
      "fxKey": "slam"
    },
    "m-burr-nip": {
      "id": "m-burr-nip", "name": "Farpinha", "element": "earth", "paCost": 3, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "earth", "min": 5, "max": 8 } ],
      "description": "Pequeno, grudento e irritante.",
      "fxKey": "slam"
    },
    "m-spore-nip": {
      "id": "m-spore-nip", "name": "Mordidinha Pútrida", "element": "earth", "paCost": 3, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "earth", "min": 6, "max": 9 }, { "type": "poison", "element": "earth", "min": 3, "max": 5, "duration": 1 } ],
      "description": "O esporinho morde e deixa bolor na ferida.",
      "fxKey": "slam"
    },

    "m-drowned-bite": {
      "id": "m-drowned-bite", "name": "Bocanhada", "element": "water", "paCost": 3, "cooldown": 0, "castsPerTurn": 2,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "water", "min": 12, "max": 16, "lifesteal": true } ],
      "description": "O afogadiço morde e bebe: rouba a vida que lhe falta.",
      "fxKey": "slam"
    },
    "m-eel-beam": {
      "id": "m-eel-beam", "name": "Descarga Abissal", "element": "water", "paCost": 3, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 2, "max": 6, "line": true, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "water", "min": 11, "max": 15 } ],
      "description": "A moreia sopra uma nota grave pela flauta do próprio crânio: um jato d'água em linha reta.",
      "fxKey": "beam"
    },
    "m-eel-hook": {
      "id": "m-eel-hook", "name": "Língua-Fisga", "element": "water", "paCost": 2, "cooldown": 1, "castsPerTurn": 1,
      "range": { "min": 2, "max": 5, "line": true, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "pull", "tiles": 2 }, { "type": "damage", "element": "water", "min": 5, "max": 8 } ],
      "description": "Uma língua-arpão dispara em linha reta e arrasta a presa para perto da água.",
      "fxKey": "hook"
    },
    "m-jelly-mend": {
      "id": "m-jelly-mend", "name": "Pulso Salino", "element": "water", "paCost": 3, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 0, "max": 4, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "heal", "min": 14, "max": 18 } ],
      "description": "A água-viva pulsa e banha um aliado em salmoura restauradora.",
      "fxKey": "heal"
    },
    "m-jelly-ward": {
      "id": "m-jelly-ward", "name": "Membrana", "element": "water", "paCost": 2, "cooldown": 1, "castsPerTurn": 1,
      "range": { "min": 0, "max": 4, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "shield", "value": 15, "duration": 2 } ],
      "description": "Uma película gelatinosa envolve o aliado, absorvendo golpes.",
      "fxKey": "shieldFx"
    },
    "m-brine-fist": {
      "id": "m-brine-fist", "name": "Punho de Salmoura", "element": "water", "paCost": 4, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "water", "min": 16, "max": 22 } ],
      "description": "Um punho de sal compactado desce como um aríete.",
      "fxKey": "slam"
    },
    "m-drop-slam": {
      "id": "m-drop-slam", "name": "Chuaque", "element": "water", "paCost": 3, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "water", "min": 11, "max": 15 } ],
      "description": "A gota se joga inteira em cima do alvo. É exatamente o som que você imagina.",
      "fxKey": "slam"
    },
    "m-droplet-splash": {
      "id": "m-droplet-splash", "name": "Pingo", "element": "water", "paCost": 3, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "water", "min": 5, "max": 8 } ],
      "description": "Plic.",
      "fxKey": "slam"
    },
    "m-tide-pull": {
      "id": "m-tide-pull", "name": "Maré Faminta", "element": "water", "paCost": 3, "cooldown": 2, "castsPerTurn": 1,
      "range": { "min": 0, "max": 0, "line": false, "los": false },
      "aoe": { "shape": "circle", "size": 3 }, "needsEmptyTile": false,
      "effects": [ { "type": "pull", "tiles": 3 } ],
      "description": "A Baronesa inspira — e a sala inteira vira maré: tudo num raio de 3 células é arrastado até ela.",
      "fxKey": "nova"
    },
    "m-bitter-gulp": {
      "id": "m-bitter-gulp", "name": "Gole Amargo", "element": "water", "paCost": 4, "cooldown": 1, "castsPerTurn": 1,
      "range": { "min": 0, "max": 0, "line": false, "los": false },
      "aoe": { "shape": "cross", "size": 2 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "water", "min": 20, "max": 26 }, { "type": "poison", "element": "water", "min": 6, "max": 9, "duration": 2 } ],
      "description": "A Baronesa engole tudo ao redor num só trago de salmoura ácida, que continua corroendo por 2 turnos.",
      "fxKey": "nova"
    },
    "m-salt-lance": {
      "id": "m-salt-lance", "name": "Lança de Sal", "element": "water", "paCost": 3, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 5, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "water", "min": 16, "max": 22 } ],
      "description": "Um cristal de sal afiado cruza a sala girando.",
      "fxKey": "bolt"
    },
    "m-brine-spawn": {
      "id": "m-brine-spawn", "name": "Verter", "element": "water", "paCost": 2, "cooldown": 1, "castsPerTurn": 1,
      "range": { "min": 1, "max": 3, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": true,
      "effects": [ { "type": "summon", "monsterId": "droplet" } ],
      "description": "A Baronesa transborda, e o que escorre ganha vontade própria.",
      "fxKey": "summonFx"
    },

    "m-ember-claw": {
      "id": "m-ember-claw", "name": "Garra Acesa", "element": "fire", "paCost": 3, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "fire", "min": 13, "max": 17 } ],
      "description": "O tição rasga com garras em brasa viva.",
      "fxKey": "slam"
    },
    "m-anvil-crush": {
      "id": "m-anvil-crush", "name": "Esmagamento", "element": "earth", "paCost": 4, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "earth", "min": 20, "max": 26 } ],
      "description": "A bigorna simplesmente cai por cima. Física básica, resultados excelentes.",
      "fxKey": "slam"
    },
    "m-ash-bolt": {
      "id": "m-ash-bolt", "name": "Seta de Cinza", "element": "shadow", "paCost": 3, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 2, "max": 6, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "shadow", "min": 13, "max": 17 } ],
      "description": "O cinzento aponta o dedo e a fuligem obedece, voando em seta.",
      "fxKey": "bolt"
    },
    "m-ash-veil": {
      "id": "m-ash-veil", "name": "Sudário de Cinza", "element": "shadow", "paCost": 2, "cooldown": 3, "castsPerTurn": 1,
      "range": { "min": 0, "max": 0, "line": false, "los": false },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "invisible", "duration": 1 } ],
      "description": "O cinzento se desfaz em fuligem suspensa por 1 turno: impossível de mirar.",
      "fxKey": "veil"
    },
    "m-slag-slam": {
      "id": "m-slag-slam", "name": "Peso Morto", "element": "fire", "paCost": 4, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "fire", "min": 15, "max": 20 } ],
      "description": "O monte de escória desaba sobre o alvo em câmera lenta, fervendo.",
      "fxKey": "slam"
    },
    "m-smith-hammer": {
      "id": "m-smith-hammer", "name": "Marretada", "element": "earth", "paCost": 3, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "earth", "min": 12, "max": 16 } ],
      "description": "O ferreiro trata o alvo como peça mal forjada.",
      "fxKey": "slam"
    },
    "m-forge-temper": {
      "id": "m-forge-temper", "name": "Têmpera", "element": "fire", "paCost": 2, "cooldown": 1, "castsPerTurn": 1,
      "range": { "min": 0, "max": 5, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "buff", "stat": "power", "value": 20, "duration": 2 } ],
      "description": "O ferreiro martela o aliado como quem afia uma arma: +20 de poder.",
      "fxKey": "buff"
    },
    "m-smith-plate": {
      "id": "m-smith-plate", "name": "Chapa Quente", "element": "fire", "paCost": 2, "cooldown": 1, "castsPerTurn": 1,
      "range": { "min": 0, "max": 4, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "shield", "value": 20, "duration": 2 } ],
      "description": "Uma placa de metal ainda rubro é soldada no aliado: 20 de escudo.",
      "fxKey": "shieldFx"
    },
    "m-doom-hammer": {
      "id": "m-doom-hammer", "name": "Martelo do Fim", "element": "fire", "paCost": 5, "cooldown": 2, "castsPerTurn": 1,
      "range": { "min": 1, "max": 2, "line": false, "los": true },
      "aoe": { "shape": "cross", "size": 1 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "fire", "min": 30, "max": 38 } ],
      "description": "Magno ergue o martelo com que se forjou o primeiro Fecho — e o mundo range quando ele desce.",
      "fxKey": "nova"
    },
    "m-bellows-blast": {
      "id": "m-bellows-blast", "name": "Sopro de Fornalha", "element": "fire", "paCost": 3, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 6, "line": true, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "fire", "min": 14, "max": 18 }, { "type": "push", "tiles": 3 } ],
      "description": "O peito-fornalha de Magno expele um vendaval incandescente que arremessa o alvo 3 células.",
      "fxKey": "gust"
    },
    "m-spark-call": {
      "id": "m-spark-call", "name": "Chamar Fagulhas", "element": "fire", "paCost": 3, "cooldown": 1, "castsPerTurn": 1,
      "range": { "min": 1, "max": 4, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": true,
      "effects": [ { "type": "summon", "monsterId": "spark-whelp" } ],
      "description": "Magno estala os dedos e uma fagulha ganha pernas — e péssimas intenções.",
      "fxKey": "summonFx"
    },
    "m-stoke": {
      "id": "m-stoke", "name": "Atiçar-se", "element": "fire", "paCost": 2, "cooldown": 3, "castsPerTurn": 1,
      "range": { "min": 0, "max": 0, "line": false, "los": false },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "buff", "stat": "power", "value": 25, "duration": 2 } ],
      "description": "Magno abre a grelha do próprio peito e sopra as brasas: +25 de poder.",
      "fxKey": "buff"
    },
    "m-spark-tap": {
      "id": "m-spark-tap", "name": "Estalo", "element": "fire", "paCost": 3, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "fire", "min": 6, "max": 9 } ],
      "description": "A fagulha encosta e estala. Dói mais do que parece.",
      "fxKey": "slam"
    },
    "m-slag-drip": {
      "id": "m-slag-drip", "name": "Respingo", "element": "fire", "paCost": 3, "cooldown": 0, "castsPerTurn": 1,
      "range": { "min": 1, "max": 1, "line": false, "los": true },
      "aoe": { "shape": "single", "size": 0 }, "needsEmptyTile": false,
      "effects": [ { "type": "damage", "element": "fire", "min": 5, "max": 8 } ],
      "description": "Um respingo de escória fervente.",
      "fxKey": "slam"
    }
  },

  "monsters": {

    "thorn-lasher": {
      "id": "thorn-lasher", "name": "Vergasta", "family": "Flora Voraz",
      "description": "Um chicote vegetal enraizado num vaso rachado, coberto de farpas e flores mortas. Não sai do lugar — não precisa.",
      "stats": { "hp": 50, "pa": 6, "pm": 1, "initiative": 35, "power": 0, "resists": { "fire": -20, "water": 0, "earth": 20, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-thorn-shot", "m-root-grip"],
      "ai": "ranged", "traits": [ { "type": "pushImmune" } ], "boss": false, "summonOnly": false, "xp": 25
    },
    "pollen-puff": {
      "id": "pollen-puff", "name": "Bufo-de-Pólen", "family": "Flora Voraz",
      "description": "Uma bola de pólen amarelo com perninhas de graveto e um sorriso costurado. Anda na sua direção balançando. Isso deveria ser um aviso.",
      "stats": { "hp": 45, "pa": 3, "pm": 3, "initiative": 55, "power": 0, "resists": { "fire": -30, "water": 0, "earth": 10, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-pollen-bite"],
      "ai": "melee", "traits": [ { "type": "explodeOnDeath", "element": "earth", "damage": 18, "radius": 1 } ], "boss": false, "summonOnly": false, "xp": 22
    },
    "burr-mother": {
      "id": "burr-mother", "name": "Carrapicho-Mãe", "family": "Flora Voraz",
      "description": "Um novelo de farpas do tamanho de um cão, com dezenas de olhinhos pretos entre os espinhos. Ao morrer, desfia-se em dois novelos menores e igualmente rancorosos.",
      "stats": { "hp": 60, "pa": 3, "pm": 3, "initiative": 25, "power": 0, "resists": { "fire": -15, "water": 0, "earth": 15, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-burr-hug"],
      "ai": "melee", "traits": [ { "type": "split", "monsterId": "burrlet", "count": 2 } ], "boss": false, "summonOnly": false, "xp": 30
    },
    "lantern-wasp": {
      "id": "lantern-wasp", "name": "Vespa-Lustre", "family": "Enxame da Estufa",
      "description": "Uma vespa do tamanho de um gato cujo abdômen é uma lanterna de vidro com uma luz presa dentro. Rápida, brilhante, venenosa: chega primeiro e vai embora antes da resposta.",
      "stats": { "hp": 48, "pa": 3, "pm": 4, "initiative": 75, "power": 0, "resists": { "fire": 0, "water": 0, "earth": -10, "air": 20, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-wasp-sting"],
      "ai": "melee", "traits": [], "boss": false, "summonOnly": false, "xp": 24
    },
    "sap-shaman": {
      "id": "sap-shaman", "name": "Seiveiro", "family": "Flora Voraz",
      "description": "Um toco de árvore corcunda com um rosto entalhado a canivete e um caldeirão de seiva borbulhando no colo. Rega os aliados como quem cuida de um jardim — e o jardim morde.",
      "stats": { "hp": 55, "pa": 6, "pm": 2, "initiative": 45, "power": 0, "resists": { "fire": -20, "water": 10, "earth": 15, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-sap-mend", "m-sap-sugar"],
      "ai": "support", "traits": [ { "type": "regenAura", "value": 8, "radius": 2 } ], "boss": false, "summonOnly": false, "xp": 28
    },
    "boss-gardener": {
      "id": "boss-gardener", "name": "A Jardineira-Viúva", "family": "Flora Voraz",
      "description": "A guardiã da Estufa: um vulto de três metros feito de treliça, luvas de couro e véu de viúva, com uma tesoura de poda enferrujada no lugar das mãos. Ainda cuida do jardim. Você é a erva daninha.",
      "stats": { "hp": 280, "pa": 7, "pm": 3, "initiative": 50, "power": 0, "resists": { "fire": -20, "water": 0, "earth": 30, "air": 0, "light": 0, "shadow": 10, "neutral": 0 } },
      "spells": ["m-shears", "m-vine-hook", "m-seed-toss"],
      "ai": "boss", "traits": [ { "type": "pushImmune" }, { "type": "enrage", "hpPct": 0.4, "power": 30 } ], "boss": true, "summonOnly": false, "xp": 420
    },
    "sprout-feral": {
      "id": "sprout-feral", "name": "Brotinho-Voraz", "family": "Flora Voraz",
      "description": "Uma muda recém-germinada que é só folhas, pressa e dentes. A Jardineira os planta; eles fazem o resto.",
      "stats": { "hp": 30, "pa": 3, "pm": 4, "initiative": 60, "power": 0, "resists": { "fire": -20, "water": 0, "earth": 10, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-sprout-bite"],
      "ai": "melee", "traits": [], "boss": false, "summonOnly": true, "xp": 5
    },
    "burrlet": {
      "id": "burrlet", "name": "Carrapichinho", "family": "Flora Voraz",
      "description": "Metade do rancor, o dobro da velocidade. Gruda e não solta.",
      "stats": { "hp": 22, "pa": 3, "pm": 3, "initiative": 30, "power": 0, "resists": { "fire": -15, "water": 0, "earth": 10, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-burr-nip"],
      "ai": "melee", "traits": [], "boss": false, "summonOnly": true, "xp": 4
    },

    "drowned-porter": {
      "id": "drowned-porter", "name": "Afogadiço", "family": "Corte Afogada",
      "description": "Um carregador da cisterna que nunca soltou seu lampião. Pele cinza-esverdeada, inchada de água, algas no lugar do cabelo. Morde para beber o calor que perdeu.",
      "stats": { "hp": 75, "pa": 6, "pm": 3, "initiative": 40, "power": 0, "resists": { "fire": 0, "water": 25, "earth": 0, "air": 0, "light": -20, "shadow": 15, "neutral": 0 } },
      "spells": ["m-drowned-bite"],
      "ai": "melee", "traits": [], "boss": false, "summonOnly": false, "xp": 38
    },
    "moray-piper": {
      "id": "moray-piper", "name": "Moreia-Flauta", "family": "Corte Afogada",
      "description": "Uma enguia de dois metros cujo crânio perfurado assobia quando ela respira. Ergue-se da água como um ponto de interrogação, cospe jatos em linha reta e fisga presas com a língua-arpão.",
      "stats": { "hp": 65, "pa": 5, "pm": 3, "initiative": 60, "power": 0, "resists": { "fire": 0, "water": 20, "earth": 0, "air": -15, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-eel-beam", "m-eel-hook"],
      "ai": "ranged", "traits": [], "boss": false, "summonOnly": false, "xp": 33
    },
    "lantern-jelly": {
      "id": "lantern-jelly", "name": "Água-Viva-Lustre", "family": "Corte Afogada",
      "description": "Uma água-viva do tamanho de um lustre, flutuando a um palmo do chão, tentáculos como franjas de cristal. Sua luz cura os afogados — apague-a primeiro.",
      "stats": { "hp": 60, "pa": 5, "pm": 2, "initiative": 30, "power": 0, "resists": { "fire": 0, "water": 25, "earth": -15, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-jelly-mend", "m-jelly-ward"],
      "ai": "support", "traits": [ { "type": "regenAura", "value": 8, "radius": 2 } ], "boss": false, "summonOnly": false, "xp": 30
    },
    "brine-golem": {
      "id": "brine-golem", "name": "Salmourão", "family": "Corte Afogada",
      "description": "Um colosso de sal cristalizado em camadas, com um coração de água escura visível no peito. Lento como maré baixa, imparável como maré alta. Quanto mais quebra, mais afiado fica.",
      "stats": { "hp": 105, "pa": 4, "pm": 2, "initiative": 15, "power": 0, "resists": { "fire": -15, "water": 30, "earth": 20, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-brine-fist"],
      "ai": "melee", "traits": [ { "type": "pushImmune" }, { "type": "enrage", "hpPct": 0.5, "power": 25 } ], "boss": false, "summonOnly": false, "xp": 55
    },
    "fat-drop": {
      "id": "fat-drop", "name": "Gota-Gorda", "family": "Corte Afogada",
      "description": "Uma gota d'água do tamanho de um barril, com um rosto sonolento boiando dentro. Estoure-a e ela vira duas gotas menores e bem mais acordadas.",
      "stats": { "hp": 70, "pa": 3, "pm": 3, "initiative": 35, "power": 0, "resists": { "fire": -10, "water": 30, "earth": 0, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-drop-slam"],
      "ai": "melee", "traits": [ { "type": "split", "monsterId": "droplet", "count": 2 } ], "boss": false, "summonOnly": false, "xp": 35
    },
    "droplet": {
      "id": "droplet", "name": "Gotinha", "family": "Corte Afogada",
      "description": "Pequena, redonda, indignada.",
      "stats": { "hp": 25, "pa": 3, "pm": 3, "initiative": 45, "power": 0, "resists": { "fire": -10, "water": 20, "earth": 0, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-droplet-splash"],
      "ai": "melee", "traits": [], "boss": false, "summonOnly": true, "xp": 5
    },
    "boss-baroness": {
      "id": "boss-baroness", "name": "Baronesa Salmoura", "family": "Corte Afogada",
      "description": "A dona da cisterna: um vestido de baile do século passado preenchido por água escura e viva, com um colar de pérolas boiando onde deveria haver um pescoço. Recebe visitas puxando-as para perto — e engolindo a sala inteira.",
      "stats": { "hp": 340, "pa": 8, "pm": 3, "initiative": 55, "power": 0, "resists": { "fire": -10, "water": 40, "earth": 0, "air": 0, "light": -15, "shadow": 15, "neutral": 0 } },
      "spells": ["m-tide-pull", "m-bitter-gulp", "m-salt-lance", "m-brine-spawn"],
      "ai": "boss", "traits": [ { "type": "pushImmune" }, { "type": "enrage", "hpPct": 0.35, "power": 30 } ], "boss": true, "summonOnly": false, "xp": 510
    },

    "ember-imp": {
      "id": "ember-imp", "name": "Tição", "family": "Prole da Fornalha",
      "description": "Um carvão em brasa com braços finos e um sorriso rachado de luz alaranjada. Corre até você rindo. A risada é o estopim.",
      "stats": { "hp": 60, "pa": 3, "pm": 4, "initiative": 75, "power": 0, "resists": { "fire": 30, "water": -25, "earth": 0, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-ember-claw"],
      "ai": "melee", "traits": [ { "type": "explodeOnDeath", "element": "fire", "damage": 22, "radius": 1 } ], "boss": false, "summonOnly": false, "xp": 30
    },
    "walking-anvil": {
      "id": "walking-anvil", "name": "Bigorna Ambulante", "family": "Prole da Fornalha",
      "description": "Uma bigorna centenária que criou pernas atarracadas e um rancor proporcional ao número de marteladas que levou. Impossível de empurrar; péssima ideia de deixar chegar perto.",
      "stats": { "hp": 110, "pa": 4, "pm": 2, "initiative": 10, "power": 0, "resists": { "fire": 20, "water": -20, "earth": 30, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-anvil-crush"],
      "ai": "melee", "traits": [ { "type": "pushImmune" }, { "type": "enrage", "hpPct": 0.5, "power": 30 } ], "boss": false, "summonOnly": false, "xp": 55
    },
    "ash-wraith": {
      "id": "ash-wraith", "name": "Cinzento", "family": "Prole da Fornalha",
      "description": "O contorno de um ferreiro antigo desenhado em fuligem suspensa, com dois pontos de brasa no lugar dos olhos. Atira setas de cinza e se desmancha no ar quando ameaçado.",
      "stats": { "hp": 70, "pa": 5, "pm": 3, "initiative": 65, "power": 0, "resists": { "fire": 15, "water": 0, "earth": 0, "air": 0, "light": -25, "shadow": 25, "neutral": 0 } },
      "spells": ["m-ash-bolt", "m-ash-veil"],
      "ai": "ranged", "traits": [], "boss": false, "summonOnly": false, "xp": 35
    },
    "slag-mound": {
      "id": "slag-mound", "name": "Monte de Escória", "family": "Prole da Fornalha",
      "description": "Uma pilha de refugo de forja que aprendeu a se arrastar, deixando um rastro vitrificado. Quebre-a e ela desmorona em duas escorinhas incandescentes — que explodem.",
      "stats": { "hp": 95, "pa": 4, "pm": 2, "initiative": 20, "power": 0, "resists": { "fire": 30, "water": -30, "earth": 15, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-slag-slam"],
      "ai": "melee", "traits": [ { "type": "split", "monsterId": "slag-bit", "count": 2 } ], "boss": false, "summonOnly": false, "xp": 48
    },
    "faceless-smith": {
      "id": "faceless-smith", "name": "Ferreiro Sem-Rosto", "family": "Prole da Fornalha",
      "description": "Um avental de couro e dois braços musculosos pendurados em nada: onde deveria haver um corpo, só calor tremulando. Tempera os aliados como lâminas e os cobre de chapas ardentes.",
      "stats": { "hp": 80, "pa": 6, "pm": 3, "initiative": 45, "power": 0, "resists": { "fire": 25, "water": -15, "earth": 10, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-smith-hammer", "m-forge-temper", "m-smith-plate"],
      "ai": "support", "traits": [], "boss": false, "summonOnly": false, "xp": 40
    },
    "boss-heartforge": {
      "id": "boss-heartforge", "name": "Magno, o Acendedor", "family": "Prole da Fornalha",
      "description": "O coração do último Fecho em forma de titã: um forno a lenha de quatro metros com grelha no peito, martelo-chaminé ao ombro e a primeira chama do mundo queimando lá dentro. Ele não guarda o portão. Ele É o portão.",
      "stats": { "hp": 420, "pa": 9, "pm": 3, "initiative": 60, "power": 0, "resists": { "fire": 40, "water": -25, "earth": 20, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-doom-hammer", "m-bellows-blast", "m-spark-call", "m-stoke"],
      "ai": "boss", "traits": [ { "type": "pushImmune" }, { "type": "enrage", "hpPct": 0.5, "power": 40 } ], "boss": true, "summonOnly": false, "xp": 630
    },
    "spark-whelp": {
      "id": "spark-whelp", "name": "Fagulha", "family": "Prole da Fornalha",
      "description": "Uma faísca com pernas e opinião. Vive pouco, termina alto.",
      "stats": { "hp": 28, "pa": 3, "pm": 4, "initiative": 80, "power": 0, "resists": { "fire": 25, "water": -25, "earth": 0, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-spark-tap"],
      "ai": "melee", "traits": [ { "type": "explodeOnDeath", "element": "fire", "damage": 15, "radius": 1 } ], "boss": false, "summonOnly": true, "xp": 4
    },
    "slag-bit": {
      "id": "slag-bit", "name": "Escorinha", "family": "Prole da Fornalha",
      "description": "Um caco de escória ainda rubro, rastejando com propósito.",
      "stats": { "hp": 30, "pa": 3, "pm": 2, "initiative": 25, "power": 0, "resists": { "fire": 20, "water": -20, "earth": 10, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-slag-drip"],
      "ai": "melee", "traits": [ { "type": "explodeOnDeath", "element": "fire", "damage": 12, "radius": 1 } ], "boss": false, "summonOnly": true, "xp": 4
    },

    "sporeling": {
      "id": "sporeling", "name": "Esporinho", "family": "Rebanho de Morela",
      "description": "Um cogumelo-bebê com olhos grandes demais e lealdade maior ainda. Morde, envenena e, ao cair, estoura numa nuvem de esporos vingativa.",
      "stats": { "hp": 35, "pa": 3, "pm": 3, "initiative": 50, "power": 0, "resists": { "fire": -10, "water": 0, "earth": 10, "air": 0, "light": 0, "shadow": 0, "neutral": 0 } },
      "spells": ["m-spore-nip"],
      "ai": "melee", "traits": [ { "type": "explodeOnDeath", "element": "earth", "damage": 10, "radius": 1 } ], "boss": false, "summonOnly": true, "xp": 0
    }
  },

  "items": {

    "gh-pruning-shears": {
      "id": "gh-pruning-shears", "name": "Tesoura de Poda", "slot": "weapon", "rarity": "common", "dungeonId": "greenhouse",
      "bonuses": { "power": 4 },
      "description": "Tesoura de jardinagem do mundo antigo, afiada por séculos de uso paciente. +4 de poder.",
      "flavor": "O jardim inteiro estremece quando ela se abre.",
      "iconKey": "shears"
    },
    "gh-thorn-whip": {
      "id": "gh-thorn-whip", "name": "Chicote de Vergasta", "slot": "weapon", "rarity": "rare", "dungeonId": "greenhouse",
      "bonuses": { "power": 9, "resists": { "earth": 10 } },
      "description": "Uma Vergasta jovem, domada e trançada em chicote farpado. +9 de poder, +10% de resistência a terra.",
      "flavor": "Ainda tenta chicotear de volta. Faz parte do charme.",
      "iconKey": "vine-whip"
    },
    "gh-trellis-shield": {
      "id": "gh-trellis-shield", "name": "Escudo de Treliça", "slot": "armor", "rarity": "common", "dungeonId": "greenhouse",
      "bonuses": { "hp": 10 },
      "description": "Um pedaço de treliça arrancado da parede da Estufa, com a hera ainda viva. +10 de HP.",
      "flavor": "A hera que o cobre aperta o seu braço com carinho.",
      "iconKey": "trellis-shield"
    },
    "gh-garden-apron": {
      "id": "gh-garden-apron", "name": "Avental da Estufa", "slot": "armor", "rarity": "rare", "dungeonId": "greenhouse",
      "bonuses": { "hp": 20, "resists": { "earth": 10 } },
      "description": "Avental de couro dos jardineiros reais, remendado com folhas duras como escamas. +20 de HP, +10% de resistência a terra.",
      "flavor": "Os bolsos ainda têm sementes. Não plante nenhuma.",
      "iconKey": "apron"
    },
    "gh-firefly-dome": {
      "id": "gh-firefly-dome", "name": "Redoma de Vagalumes", "slot": "trinket", "rarity": "common", "dungeonId": "greenhouse",
      "bonuses": { "initiative": 8 },
      "description": "Uma redoma de vidro rachado com três vagalumes ancestrais dentro. +8 de iniciativa.",
      "flavor": "Eles acordam meio segundo antes do perigo. Copie-os.",
      "iconKey": "firefly-jar"
    },
    "gh-amber-sap": {
      "id": "gh-amber-sap", "name": "Âmbar de Seiva", "slot": "trinket", "rarity": "rare", "dungeonId": "greenhouse",
      "bonuses": { "hp": 12, "power": 5 },
      "description": "Uma gota de seiva de Seiveiro endurecida em âmbar dourado, morna ao toque. +12 de HP, +5 de poder.",
      "flavor": "Doce por fora, faminta por dentro. Como tudo aqui.",
      "iconKey": "amber"
    },
    "gh-widow-shears": {
      "id": "gh-widow-shears", "name": "Tesourão da Viúva", "slot": "weapon", "rarity": "epic", "dungeonId": "greenhouse",
      "bonuses": { "pa": 1, "power": 14 },
      "description": "A tesoura de poda da Jardineira-Viúva: enferrujada, enorme, impaciente. +1 PA, +14 de poder.",
      "flavor": "Ela podava o jardim. Agora você poda o mundo.",
      "iconKey": "great-shears"
    },

    "ci-salt-rapier": {
      "id": "ci-salt-rapier", "name": "Florete de Sal", "slot": "weapon", "rarity": "common", "dungeonId": "cistern",
      "bonuses": { "power": 5 },
      "description": "Um florete de baile cristalizado em sal, leve e amargo. +5 de poder.",
      "flavor": "A corte afogada duelava por educação. Você não precisa.",
      "iconKey": "rapier"
    },
    "ci-moray-flute": {
      "id": "ci-moray-flute", "name": "Flauta-Arpão", "slot": "weapon", "rarity": "rare", "dungeonId": "cistern",
      "bonuses": { "power": 10, "initiative": 5 },
      "description": "O crânio perfurado de uma Moreia-Flauta montado num cabo de coral. +10 de poder, +5 de iniciativa.",
      "flavor": "Assobia a mesma nota grave a cada golpe: 'desça'.",
      "iconKey": "flute"
    },
    "ci-porter-coat": {
      "id": "ci-porter-coat", "name": "Casaca do Carregador", "slot": "armor", "rarity": "common", "dungeonId": "cistern",
      "bonuses": { "hp": 12 },
      "description": "A casaca de gala de um Afogadiço, pesada de uma água que nunca seca. +12 de HP.",
      "flavor": "Quem a veste nunca larga o que carrega. Cuidado com o que carrega.",
      "iconKey": "coat"
    },
    "ci-brine-cuirass": {
      "id": "ci-brine-cuirass", "name": "Couraça de Salmoura", "slot": "armor", "rarity": "rare", "dungeonId": "cistern",
      "bonuses": { "hp": 18, "resists": { "water": 15 } },
      "description": "Placas de sal desprendidas de um Salmourão, montadas em couraça. +18 de HP, +15% de resistência a água.",
      "flavor": "Quanto mais quebra, mais afiada fica. Igual ao dono anterior.",
      "iconKey": "salt-plate"
    },
    "ci-sunken-lantern": {
      "id": "ci-sunken-lantern", "name": "Lampião Submerso", "slot": "trinket", "rarity": "common", "dungeonId": "cistern",
      "bonuses": { "initiative": 7 },
      "description": "Um lampião da cisterna que continua aceso debaixo d'água. +7 de iniciativa.",
      "flavor": "A chama não sabe que afogou. Ninguém teve coragem de contar.",
      "iconKey": "oil-lantern"
    },
    "ci-tide-flask": {
      "id": "ci-tide-flask", "name": "Frasco de Maré Viva", "slot": "trinket", "rarity": "rare", "dungeonId": "cistern",
      "bonuses": { "hp": 15, "resists": { "water": 10 } },
      "description": "Um frasco selado com um dedo de maré que sobe e desce sozinha. +15 de HP, +10% de resistência a água.",
      "flavor": "Duas vezes por dia, o frasco puxa. Ninguém sabe para onde.",
      "iconKey": "tide-flask"
    },
    "ci-pearl-choker": {
      "id": "ci-pearl-choker", "name": "Colar da Baronesa", "slot": "trinket", "rarity": "epic", "dungeonId": "cistern",
      "bonuses": { "pm": 1, "hp": 15, "resists": { "water": 10 } },
      "description": "As pérolas que boiavam onde a Baronesa deveria ter um pescoço. +1 PM, +15 de HP, +10% de resistência a água.",
      "flavor": "A maré abre caminho para quem o veste. Por respeito — ou por medo.",
      "iconKey": "pearl"
    },

    "em-bench-hammer": {
      "id": "em-bench-hammer", "name": "Martelo de Bancada", "slot": "weapon", "rarity": "common", "dungeonId": "emberlock",
      "bonuses": { "power": 5 },
      "description": "Um martelo honesto de ferreiro, cabo polido por mil turnos de forja. +5 de poder.",
      "flavor": "Não forjou o mundo, mas consertou boa parte dele.",
      "iconKey": "anvil-hammer"
    },
    "em-slag-saber": {
      "id": "em-slag-saber", "name": "Sabre de Escória", "slot": "weapon", "rarity": "rare", "dungeonId": "emberlock",
      "bonuses": { "power": 10, "resists": { "fire": 10 } },
      "description": "Uma lâmina vertida de escória incandescente, temperada às pressas. +10 de poder, +10% de resistência a fogo.",
      "flavor": "Nunca esfriou de verdade. Guarda rancor da bigorna.",
      "iconKey": "slag-saber"
    },
    "em-riveted-plate": {
      "id": "em-riveted-plate", "name": "Chapa Rebitada", "slot": "armor", "rarity": "common", "dungeonId": "emberlock",
      "bonuses": { "hp": 12 },
      "description": "Uma chapa do próprio portão do Fecho, vestida como peitoral. +12 de HP.",
      "flavor": "O portão não sente falta. Provavelmente.",
      "iconKey": "riveted-plate"
    },
    "em-soot-mantle": {
      "id": "em-soot-mantle", "name": "Manto de Fuligem", "slot": "armor", "rarity": "rare", "dungeonId": "emberlock",
      "bonuses": { "hp": 18, "resists": { "fire": 15 } },
      "description": "Fuligem de Cinzento tecida em manto, leve como um suspiro queimado. +18 de HP, +15% de resistência a fogo.",
      "flavor": "Às vezes ele lembra que já foi alguém — e te abraça.",
      "iconKey": "soot-cloak"
    },
    "em-bellows-valve": {
      "id": "em-bellows-valve", "name": "Válvula de Fole", "slot": "trinket", "rarity": "common", "dungeonId": "emberlock",
      "bonuses": { "initiative": 8 },
      "description": "Uma válvula de latão dos foles da fornalha, que assobia antes do perigo. +8 de iniciativa.",
      "flavor": "O assobio é meio segundo de vantagem. Nos Fechos, é uma vida.",
      "iconKey": "valve"
    },
    "em-ember-heart": {
      "id": "em-ember-heart", "name": "Brasa Perpétua", "slot": "trinket", "rarity": "rare", "dungeonId": "emberlock",
      "bonuses": { "power": 8, "resists": { "fire": 10 } },
      "description": "Um carvão tirado da grelha de Magno que se recusa a apagar. +8 de poder, +10% de resistência a fogo.",
      "flavor": "Aquece o bolso, o peito e as más ideias.",
      "iconKey": "ember"
    },
    "em-first-grate": {
      "id": "em-first-grate", "name": "Grelha do Primeiro Fogo", "slot": "armor", "rarity": "epic", "dungeonId": "emberlock",
      "bonuses": { "pa": 1, "hp": 20, "resists": { "fire": 15 } },
      "description": "A grelha do peito de Magno, ainda morna, forjada ao redor da primeira chama do mundo. +1 PA, +20 de HP, +15% de resistência a fogo.",
      "flavor": "O primeiro fogo do mundo agora bate atrás das suas costelas.",
      "iconKey": "furnace-grate"
    }
  },

  "dungeons": [
    {
      "id": "greenhouse",
      "name": "A Estufa Soterrada",
      "theme": "garden",
      "description": "A estufa real do mundo antigo, selada com o jardim ainda vivo dentro. Séculos no escuro ensinaram as plantas a caçar. Vagalumes presos fazem as vezes de sol.",
      "palette": { "primary": "#5a8f4d", "secondary": "#8a6b3e", "accent": "#ffd76b", "floor1": "#35513a", "floor2": "#3d5c41", "wall": "#57452f" },
      "rooms": [
        {
          "name": "O Vestíbulo das Heras",
          "layout": [
            "#############",
            "#P,.....~~..#",
            "#P,..##.~~.a#",
            "#P,..##.....#",
            "#....##..b..#",
            "#....##.....#",
            "#..........a#",
            "#....##.....#",
            "#....##..c..#",
            "#....##.....#",
            "#############"
          ],
          "monsters": { "a": "pollen-puff", "b": "thorn-lasher", "c": "lantern-wasp" }
        },
        {
          "name": "Os Canteiros Afundados",
          "layout": [
            "#############",
            "#..a......a.#",
            "#.~~~.,,.~~~#",
            "#.~~~....~~~#",
            "#.....s.....#",
            "#,,.......,,#",
            "#.....b.....#",
            "#,,.......,,#",
            "#.....c.....#",
            "#.~~~....~~~#",
            "#.~~~.,,.~~~#",
            "#P.P.P......#",
            "#############"
          ],
          "monsters": { "a": "thorn-lasher", "s": "sap-shaman", "b": "burr-mother", "c": "lantern-wasp" }
        },
        {
          "name": "O Coreto da Viúva",
          "layout": [
            "#############",
            "#.....z.....#",
            "#....,,,....#",
            "#.a.......a.#",
            "#..#.....#..#",
            "#..#..,..#..#",
            "#.....,.....#",
            "#..#..,..#..#",
            "#..#.....#..#",
            "#...~...~...#",
            "#....P.P....#",
            "#.....P.....#",
            "#############"
          ],
          "monsters": { "z": "boss-gardener", "a": "sap-shaman" }
        }
      ],
      "lootTable": [
        { "itemId": "gh-pruning-shears", "weight": 30, "minRoom": 0 },
        { "itemId": "gh-trellis-shield", "weight": 30, "minRoom": 0 },
        { "itemId": "gh-firefly-dome", "weight": 30, "minRoom": 0 },
        { "itemId": "gh-thorn-whip", "weight": 12, "minRoom": 0 },
        { "itemId": "gh-garden-apron", "weight": 12, "minRoom": 0 },
        { "itemId": "gh-amber-sap", "weight": 12, "minRoom": 0 },
        { "itemId": "gh-widow-shears", "weight": 4, "minRoom": 2 }
      ]
    },
    {
      "id": "cistern",
      "name": "A Cisterna dos Afogados",
      "theme": "cistern",
      "description": "O reservatório que matou a sede do mundo antigo — e depois bebeu seus donos. A corte afogada ainda dá bailes na água parada, sob lustres de águas-vivas.",
      "palette": { "primary": "#2e6e8e", "secondary": "#1d3a4d", "accent": "#7ef0d4", "floor1": "#24404f", "floor2": "#2a4a5a", "wall": "#16222c" },
      "rooms": [
        {
          "name": "A Galeria das Goteiras",
          "layout": [
            "#############",
            "#P...~.~...a#",
            "#P...~.~....#",
            "#P...~.~..a.#",
            "#....~.~....#",
            "#..,.....,..#",
            "#....~.~....#",
            "#....~.~..b.#",
            "#....~.~....#",
            "#....~.~...b#",
            "#############"
          ],
          "monsters": { "a": "drowned-porter", "b": "moray-piper" }
        },
        {
          "name": "O Salão das Colunas de Sal",
          "layout": [
            "###############",
            "#P.....a......#",
            "#P..#..,..#...#",
            "#P.....,......#",
            "#...#.....#.e.#",
            "#.....###.....#",
            "#...b.#~#..c..#",
            "#.....###.....#",
            "#...#.....#...#",
            "#......,....d.#",
            "#...#..,..#...#",
            "#......,......#",
            "###############"
          ],
          "monsters": { "a": "drowned-porter", "b": "moray-piper", "c": "brine-golem", "d": "lantern-jelly", "e": "fat-drop" }
        },
        {
          "name": "O Trono da Salmoura",
          "layout": [
            "#############",
            "#####...#####",
            "#....,z,....#",
            "#.~.......~.#",
            "#...#...#...#",
            "#.b.......d.#",
            "#....~.~....#",
            "#...........#",
            "#..#..,..#..#",
            "#.....,.....#",
            "#...P.P.P...#",
            "#...........#",
            "#############"
          ],
          "monsters": { "z": "boss-baroness", "b": "moray-piper", "d": "lantern-jelly" }
        }
      ],
      "lootTable": [
        { "itemId": "ci-salt-rapier", "weight": 30, "minRoom": 0 },
        { "itemId": "ci-porter-coat", "weight": 30, "minRoom": 0 },
        { "itemId": "ci-sunken-lantern", "weight": 30, "minRoom": 0 },
        { "itemId": "ci-moray-flute", "weight": 12, "minRoom": 0 },
        { "itemId": "ci-brine-cuirass", "weight": 12, "minRoom": 0 },
        { "itemId": "ci-tide-flask", "weight": 12, "minRoom": 0 },
        { "itemId": "ci-pearl-choker", "weight": 4, "minRoom": 2 }
      ]
    },
    {
      "id": "emberlock",
      "name": "O Fecho de Brasa",
      "theme": "forge",
      "description": "O último Fecho, forjado ao redor da primeira chama do mundo. Aqui o mundo antigo fabricava portões — e o maior deles acordou com ciúme do próprio fogo.",
      "palette": { "primary": "#c4502e", "secondary": "#4a2a26", "accent": "#ffb347", "floor1": "#3a2422", "floor2": "#452a25", "wall": "#241512" },
      "rooms": [
        {
          "name": "O Corredor de Brasas",
          "layout": [
            "#############",
            "#P.,......a.#",
            "#P.,..##....#",
            "#P.,..##..b.#",
            "#.....##....#",
            "#.~~......a.#",
            "#.~~..##....#",
            "#.....##..c.#",
            "#.....##....#",
            "#.,,......,,#",
            "#############"
          ],
          "monsters": { "a": "ember-imp", "b": "ash-wraith", "c": "walking-anvil" }
        },
        {
          "name": "A Nave dos Malhos",
          "layout": [
            "###############",
            "#P....#.#....a#",
            "#P....#.#.....#",
            "#P....#.#..b..#",
            "#.....,.,.....#",
            "#~~...#.#...~~#",
            "#.....#.#..c..#",
            "#~~...#.#...~~#",
            "#.....,.,.....#",
            "#.....#.#..d..#",
            "#.....#.#.....#",
            "#....e#.#.....#",
            "###############"
          ],
          "monsters": { "a": "ember-imp", "b": "ash-wraith", "c": "walking-anvil", "d": "slag-mound", "e": "faceless-smith" }
        },
        {
          "name": "A Câmara do Coração",
          "layout": [
            "###############",
            "#......z......#",
            "#....,,,,,....#",
            "#..a.......a..#",
            "#...##...##...#",
            "#...#~...~#...#",
            "#......e......#",
            "#..~~.....~~..#",
            "#.....,,,.....#",
            "#....P.P.P....#",
            "#.............#",
            "#,....,.,....,#",
            "###############"
          ],
          "monsters": { "z": "boss-heartforge", "a": "ember-imp", "e": "faceless-smith" }
        }
      ],
      "lootTable": [
        { "itemId": "em-bench-hammer", "weight": 30, "minRoom": 0 },
        { "itemId": "em-riveted-plate", "weight": 30, "minRoom": 0 },
        { "itemId": "em-bellows-valve", "weight": 30, "minRoom": 0 },
        { "itemId": "em-slag-saber", "weight": 12, "minRoom": 0 },
        { "itemId": "em-soot-mantle", "weight": 12, "minRoom": 0 },
        { "itemId": "em-ember-heart", "weight": 12, "minRoom": 0 },
        { "itemId": "em-first-grate", "weight": 4, "minRoom": 2 }
      ]
    }
  ],

  "leveling": {
    "maxLevel": 20,
    "xpTable": [0, 60, 145, 265, 435, 675, 1005, 1455, 2055, 2835, 3825, 5055, 6555, 8355, 10485, 12975, 15855, 19155, 22905, 27135],
    "perLevel": { "hp": 6, "power": 3 }
  }
};
