namespace Soterra.Testes.Dados
{
    /// <summary>
    /// Trechos VERDADEIROS do acervo, copiados de <c>js/core/data/*.js</c> e
    /// reescritos como JSON.
    ///
    /// Nenhum número aqui foi inventado: se um destes valores mudar no jogo, o
    /// teste que o cobra tem de mudar junto, de propósito. Fixtura com valor
    /// bonito e falso é o jeito mais rápido de escrever um teste que passa e
    /// não prova nada.
    ///
    /// Campos de texto longo (<c>description</c>, <c>lore</c>, <c>flavor</c>)
    /// foram OMITIDOS em vez de encurtados — encurtar seria inventar. A omissão
    /// tem valor próprio: prova que a leitura tolera campo ausente, que é o que
    /// vai acontecer quando o acervo ganhar campo novo.
    /// </summary>
    public static class Fixturas
    {
        /// <summary>Duas das seis classes: o tanque e o assassino, os extremos da esquiva.</summary>
        public const string Classes = @"{
  ""sumo"": {
    ""id"": ""sumo"", ""name"": ""Bárbaro"", ""role"": ""tanque"",
    ""palette"": { ""primary"": ""#d4553f"", ""secondary"": ""#3a2b26"", ""accent"": ""#ffd08a"" },
    ""stats"": {
      ""hp"": 150, ""pa"": 6, ""pp"": 3, ""initiative"": 15, ""power"": 0, ""dodge"": 5, ""lock"": 40,
      ""resists"": { ""fogo"": 0, ""agua"": 0, ""terra"": 0, ""ar"": 0, ""neutro"": 0 }
    },
    ""baseSpells"": [""sumo-neutro-1"", ""sumo-neutro-2"", ""sumo-neutro-3""],
    ""paths"": {
      ""fogo"": [""sumo-fogo-5"", ""sumo-fogo-10"", ""sumo-fogo-12"", ""sumo-fogo-15"", ""sumo-fogo-20"", ""sumo-fogo-30""],
      ""agua"": [""sumo-agua-5"", ""sumo-agua-10"", ""sumo-agua-12"", ""sumo-agua-15"", ""sumo-agua-20"", ""sumo-agua-30""],
      ""terra"": [""sumo-terra-5"", ""sumo-terra-10"", ""sumo-terra-12"", ""sumo-terra-15"", ""sumo-terra-20"", ""sumo-terra-30""],
      ""ar"": [""sumo-ar-5"", ""sumo-ar-10"", ""sumo-ar-12"", ""sumo-ar-15"", ""sumo-ar-20"", ""sumo-ar-30""]
    },
    ""startsUnlocked"": true, ""cardRarity"": ""comum""
  },
  ""espadachim"": {
    ""id"": ""espadachim"", ""name"": ""Ladino"", ""role"": ""assassino"",
    ""palette"": { ""primary"": ""#2f6f8f"", ""secondary"": ""#1b2733"", ""accent"": ""#9be8ff"" },
    ""stats"": {
      ""hp"": 95, ""pa"": 6, ""pp"": 4, ""initiative"": 90, ""power"": 0, ""dodge"": 30, ""lock"": 10,
      ""resists"": { ""fogo"": 0, ""agua"": 0, ""terra"": 0, ""ar"": 0, ""neutro"": 0 }
    },
    ""baseSpells"": [""espadachim-neutro-1"", ""espadachim-neutro-2"", ""espadachim-neutro-3""],
    ""paths"": {
      ""fogo"": [""espadachim-fogo-5"", ""espadachim-fogo-10"", ""espadachim-fogo-12"", ""espadachim-fogo-15"", ""espadachim-fogo-20"", ""espadachim-fogo-30""],
      ""agua"": [""espadachim-agua-5"", ""espadachim-agua-10"", ""espadachim-agua-12"", ""espadachim-agua-15"", ""espadachim-agua-20"", ""espadachim-agua-30""],
      ""terra"": [""espadachim-terra-5"", ""espadachim-terra-10"", ""espadachim-terra-12"", ""espadachim-terra-15"", ""espadachim-terra-20"", ""espadachim-terra-30""],
      ""ar"": [""espadachim-ar-5"", ""espadachim-ar-10"", ""espadachim-ar-12"", ""espadachim-ar-15"", ""espadachim-ar-20"", ""espadachim-ar-30""]
    },
    ""startsUnlocked"": false, ""cardRarity"": ""epico""
  }
}";

        /// <summary>
        /// Quatro feitiços reais que cobrem os quatro casos que a modelagem
        /// pode errar: alvo único de classe, carga de armadilha (0 lançamento
        /// por turno), efeito com decimal (<c>falloff</c>) e efeito cujo
        /// <c>max</c> NÃO é dano, e sim teto de pilhas.
        /// </summary>
        public const string Feiticos = @"{
  ""sumo-neutro-1"": {
    ""id"": ""sumo-neutro-1"", ""name"": ""Machadada de Ferro"", ""element"": ""neutro"",
    ""classId"": ""sumo"", ""unlockLevel"": 0,
    ""paCost"": 3, ""cooldown"": 0, ""castsPerTurn"": 2,
    ""range"": { ""min"": 1, ""max"": 1, ""line"": false, ""los"": true, ""movable"": false },
    ""aoe"": { ""shape"": ""single"", ""size"": 0 },
    ""needsEmptyTile"": false, ""targetSide"": ""enemy"",
    ""effects"": [
      { ""type"": ""damage"", ""element"": ""neutro"", ""min"": 20, ""max"": 26 },
      { ""type"": ""push"", ""tiles"": 1 }
    ],
    ""fxKey"": ""axeSlam""
  },
  ""trap-fogo-brasa"": {
    ""id"": ""trap-fogo-brasa"", ""name"": ""Armadilha de Brasa (disparo)"", ""element"": ""fogo"",
    ""classId"": ""invocador"", ""unlockLevel"": 0,
    ""paCost"": 0, ""cooldown"": 0, ""castsPerTurn"": 0,
    ""range"": { ""min"": 0, ""max"": 0, ""line"": false, ""los"": false, ""movable"": false },
    ""aoe"": { ""shape"": ""circle"", ""size"": 1 },
    ""needsEmptyTile"": false, ""targetSide"": ""enemy"",
    ""effects"": [
      { ""type"": ""damage"", ""element"": ""fogo"", ""min"": 24, ""max"": 30 },
      { ""type"": ""poison"", ""element"": ""fogo"", ""min"": 6, ""max"": 9, ""duration"": 2 }
    ],
    ""fxKey"": ""emberTrap""
  },
  ""arqueiro-ar-15"": {
    ""id"": ""arqueiro-ar-15"", ""name"": ""Detonar a Corrente"", ""element"": ""ar"",
    ""classId"": ""arqueiro"", ""unlockLevel"": 15,
    ""paCost"": 4, ""cooldown"": 2, ""castsPerTurn"": 1,
    ""range"": { ""min"": 1, ""max"": 8, ""line"": false, ""los"": true, ""movable"": false },
    ""aoe"": { ""shape"": ""single"", ""size"": 0 },
    ""needsEmptyTile"": false, ""targetSide"": ""enemy"",
    ""effects"": [
      { ""type"": ""detonateMarks"", ""mult"": 12 },
      { ""type"": ""chain"", ""jumps"": 3, ""falloff"": 0.25, ""element"": ""ar"", ""min"": 18, ""max"": 24 }
    ],
    ""fxKey"": ""chainCollect""
  },
  ""arqueiro-neutro-1"": {
    ""id"": ""arqueiro-neutro-1"", ""name"": ""Flecha Anotada"", ""element"": ""neutro"",
    ""classId"": ""arqueiro"", ""unlockLevel"": 0,
    ""paCost"": 3, ""cooldown"": 0, ""castsPerTurn"": 2,
    ""range"": { ""min"": 2, ""max"": 7, ""line"": false, ""los"": true, ""movable"": false },
    ""aoe"": { ""shape"": ""single"", ""size"": 0 },
    ""needsEmptyTile"": false, ""targetSide"": ""enemy"",
    ""effects"": [
      { ""type"": ""damage"", ""element"": ""neutro"", ""min"": 18, ""max"": 24 },
      { ""type"": ""mark"", ""value"": 5, ""duration"": 3, ""max"": 5 }
    ],
    ""fxKey"": ""markShot""
  }
}";

        /// <summary>
        /// TABELA DE CONVERSÃO, não acervo: os ids aqui são inventados de
        /// propósito, porque o que se testa é o mapeamento texto → enum, e
        /// nenhum feitiço real usa as seis formas ao mesmo tempo.
        ///
        /// Enum que não casa vira ZERO em silêncio — todo feitiço do jogo
        /// viraria alvo único mirando em si mesmo, sem uma linha de erro. É o
        /// defeito que estas seis linhas existem para pegar.
        /// </summary>
        public const string FeiticosDeTodasAsFormas = @"{
  ""f-single"": { ""id"": ""f-single"", ""aoe"": { ""shape"": ""single"", ""size"": 0 }, ""targetSide"": ""enemy"", ""effects"": [] },
  ""f-circle"": { ""id"": ""f-circle"", ""aoe"": { ""shape"": ""circle"", ""size"": 2 }, ""targetSide"": ""ally"", ""effects"": [] },
  ""f-cross"":  { ""id"": ""f-cross"",  ""aoe"": { ""shape"": ""cross"",  ""size"": 2 }, ""targetSide"": ""self"", ""effects"": [] },
  ""f-cone"":   { ""id"": ""f-cone"",   ""aoe"": { ""shape"": ""cone"",   ""size"": 3 }, ""targetSide"": ""any"",  ""effects"": [] },
  ""f-line"":   { ""id"": ""f-line"",   ""aoe"": { ""shape"": ""line"",   ""size"": 4 }, ""targetSide"": ""enemy"", ""effects"": [] },
  ""f-ring"":   { ""id"": ""f-ring"",   ""aoe"": { ""shape"": ""ring"",   ""size"": 2 }, ""targetSide"": ""enemy"", ""effects"": [] }
}";

        /// <summary>
        /// A Estufa Soterrada com a primeira sala inteira — o desenho é o real,
        /// letra por letra, incluindo a moldura de vazio que recorta a
        /// plataforma.
        /// </summary>
        public const string Calabocos = @"[
  {
    ""id"": ""greenhouse"", ""name"": ""A Estufa Soterrada"", ""theme"": ""garden"",
    ""difficulty"": 1, ""order"": 1, ""recommendedLevel"": 3,
    ""palette"": {
      ""primary"": ""#5a8f4d"", ""secondary"": ""#8a6b3e"", ""accent"": ""#ffd76b"",
      ""floor1"": ""#35513a"", ""floor2"": ""#3d5c41"", ""wall"": ""#57452f"",
      ""lowWall"": ""#6b5334"", ""voidColor"": ""#1b2a1e""
    },
    ""defaultWeather"": ""chuva"", ""weatherShiftEveryRounds"": 0, ""tileEventRate"": 0.15,
    ""rooms"": [
      {
        ""name"": ""O Vestíbulo das Heras"", ""weather"": ""calmo"", ""sceneryTheme"": ""garden"",
        ""layout"": [
          ""~~~~~###########~~~~~"",
          ""~~~~#,.........,#~~~~"",
          ""~~~##===.....===##~~~"",
          ""~~#.##.........##.#~~"",
          ""~#.,..##.....##..,.#~"",
          ""#...=====...=====...#"",
          ""#.....a...#...b.....#"",
          ""#PP..##.......##....#"",
          ""#PP..............c..#"",
          ""#PP..##.......##....#"",
          ""#.....a...#...b.....#"",
          ""#...=====...=====...#"",
          ""~#.,..##.....##..,.#~"",
          ""~~#.##.........##.#~~"",
          ""~~~##===.....===##~~~"",
          ""~~~~#,.........,#~~~~"",
          ""~~~~~###########~~~~~""
        ],
        ""monsters"": { ""a"": ""pollen-puff"", ""b"": ""thorn-lasher"", ""c"": ""lantern-wasp"" }
      },
      {
        ""name"": ""O Coreto da Viúva"", ""weather"": ""chuva"", ""sceneryTheme"": ""garden"",
        ""layout"": [
          ""~~~~~~###########~~~~~~"",
          ""~~~~~#,.........,#~~~~~"",
          ""~~~~#..=#####=....#~~~~"",
          ""~~~#..##.......##..#~~~"",
          ""~~#..==..a..==......#~~"",
          ""~#..==.........==....#~"",
          ""#..==...#=#=#=#..==...#"",
          ""#PP...d.#.....#.......#"",
          ""#PP........z.....d....#"",
          ""#PP...d.#.....#.......#"",
          ""#..==...#=#=#=#..==...#"",
          ""~#..==.........==....#~"",
          ""~~#..==..a..==......#~~"",
          ""~~~#..##.......##..#~~~"",
          ""~~~~#..=#####=....#~~~~"",
          ""~~~~~#,.........,#~~~~~"",
          ""~~~~~~###########~~~~~~""
        ],
        ""monsters"": { ""z"": ""boss-gardener"", ""a"": ""sap-shaman"", ""d"": ""dew-strider"" }
      }
    ],
    ""lootTable"": [
      { ""itemId"": ""gh-trellis-guard"", ""weight"": 30, ""minRoom"": 0 },
      { ""itemId"": ""gh-widow-shears"", ""weight"": 4, ""minRoom"": 2 }
    ],
    ""cardDrops"": [
      { ""classId"": ""sumo"", ""weight"": 50 },
      { ""classId"": ""curandeira"", ""weight"": 50 }
    ]
  }
]";

        /// <summary>
        /// Três peças reais da Estufa: uma que só dá resistência PARCIAL (a
        /// terra escrita, as outras quatro ausentes), uma peça-chave de +1 PP e
        /// um Lume, que é o único espaço que concede feitiço.
        /// </summary>
        public const string Itens = @"{
  ""gh-trellis-guard"": {
    ""id"": ""gh-trellis-guard"", ""name"": ""Guarda de Treliça"", ""slot"": ""casca"",
    ""rarity"": ""comum"", ""dungeonId"": ""greenhouse"",
    ""element"": ""terra"", ""setId"": ""gh-set-flora"", ""dropWeight"": 1000,
    ""bonuses"": { ""hp"": 15, ""resists"": { ""terra"": 5 } },
    ""grantsSpell"": null, ""iconKey"": ""trellis-shield"",
    ""keyPiece"": false, ""minRoom"": 0
  },
  ""gh-vine-stirrups"": {
    ""id"": ""gh-vine-stirrups"", ""name"": ""Estribos de Hera"", ""slot"": ""passo"",
    ""rarity"": ""raro"", ""dungeonId"": ""greenhouse"",
    ""element"": ""terra"", ""setId"": ""gh-set-flora"", ""dropWeight"": 165,
    ""bonuses"": { ""pp"": 1, ""dodge"": 10 },
    ""grantsSpell"": null, ""iconKey"": ""vine-stirrup"",
    ""keyPiece"": true, ""minRoom"": 1
  },
  ""gh-seed-pouch"": {
    ""id"": ""gh-seed-pouch"", ""name"": ""Candeia de Vagens"", ""slot"": ""lume"",
    ""rarity"": ""comum"", ""dungeonId"": ""greenhouse"",
    ""element"": ""terra"", ""setId"": ""gh-set-flora"", ""dropWeight"": 500,
    ""bonuses"": { ""power"": 3 },
    ""grantsSpell"": ""is-seed-bomb"", ""iconKey"": ""seed-lamp"",
    ""keyPiece"": true, ""minRoom"": 0
  }
}";

        /// <summary>O Traje da Flora Voraz, com os bônus de 2, 3 e 4 peças.</summary>
        public const string Conjuntos = @"{
  ""gh-set-flora"": {
    ""id"": ""gh-set-flora"", ""name"": ""Traje da Flora Voraz"", ""element"": ""terra"",
    ""dungeonId"": ""greenhouse"",
    ""pieces"": [""gh-widow-shears"", ""gh-vine-stirrups"", ""gh-trellis-guard"", ""gh-seed-pouch""],
    ""bonuses"": {
      ""2"": { ""hp"": 12, ""lock"": 5 },
      ""3"": { ""hp"": 20, ""lock"": 8, ""resists"": { ""terra"": 5 } },
      ""4"": { ""hp"": 30, ""lock"": 12, ""power"": 6, ""resists"": { ""terra"": 10 } }
    },
    ""rarity"": ""epico""
  }
}";

        /// <summary>A tabela congelada, inteira, e o resto de <c>DATA.leveling</c>.</summary>
        public const string Nivelamento = @"{
  ""maxLevel"": 30,
  ""xpTable"": [
    0, 15, 40, 75, 125,
    195, 295, 435, 615, 845,
    1145, 1525, 1965, 2485, 3095,
    3805, 4635, 5555, 6580, 7705,
    8955, 10355, 11905, 13605, 15480,
    17555, 19830, 22355, 25130, 28180
  ],
  ""xpFalloff"": { ""graceLevels"": 4, ""factorPerLevel"": 0.75, ""floor"": 0.10 },
  ""perLevel"": { ""hp"": 5, ""power"": 3 },
  ""perLevelElement"": { ""hp"": 5, ""elemPower"": 3 },
  ""defenseByRole"": {
    ""tanque"":    { ""dodge"": 10, ""lock"": 70 },
    ""atirador"":  { ""dodge"": 38, ""lock"": 16 },
    ""assassino"": { ""dodge"": 40, ""lock"": 16 },
    ""mago"":      { ""dodge"": 24, ""lock"": 10 },
    ""suporte"":   { ""dodge"": 28, ""lock"": 12 },
    ""invocador"": { ""dodge"": 20, ""lock"": 30 }
  },
  ""elementChoiceLevel"": 5,
  ""roomFury"": { ""afterRound"": 20, ""powerPerRound"": 10, ""healCutPerRound"": 0.15, ""maxRounds"": 40 }
}";

        public const string Elementos = @"[""neutro"", ""fogo"", ""agua"", ""terra"", ""ar""]";

        public const string Rivais =
            @"{ ""fogo"": ""agua"", ""agua"": ""fogo"", ""terra"": ""ar"", ""ar"": ""terra"", ""neutro"": null }";

        /// <summary>Os dois extremos: o clima sem opinião e um com par de rivais.</summary>
        public const string Climas = @"{
  ""calmo"": {
    ""id"": ""calmo"", ""name"": ""Calmo"", ""favors"": null, ""harms"": null,
    ""fxKey"": ""weatherCalm"",
    ""palette"": { ""tint"": ""#d8dee4"", ""ambient"": ""#1a1f26"", ""accent"": ""#8ab4d8"", ""particle"": ""#6b7684"" }
  },
  ""chuva"": {
    ""id"": ""chuva"", ""name"": ""Chuva"", ""favors"": ""agua"", ""harms"": ""fogo"",
    ""fxKey"": ""weatherRain"",
    ""palette"": { ""tint"": ""#57c8ec"", ""ambient"": ""#12222c"", ""accent"": ""#7ef0d4"", ""particle"": ""#a8e4f5"" }
  }
}";

        /// <summary>O evento surpresa, o único com desfechos sorteados.</summary>
        public const string EventosDeTerreno = @"{
  ""ev-might"": {
    ""id"": ""ev-might"", ""name"": ""Fôlego de Bravura"", ""kind"": ""buff"", ""icon"": ""⚡"",
    ""weight"": 22, ""duration"": 4,
    ""effects"": [{ ""type"": ""buff"", ""stat"": ""power"", ""value"": 25, ""duration"": 2 }],
    ""fxKey"": ""buff""
  },
  ""ev-mystery"": {
    ""id"": ""ev-mystery"", ""name"": ""Surpresa"", ""kind"": ""mystery"", ""icon"": ""❓"",
    ""weight"": 24, ""duration"": 4, ""fxKey"": ""burst"",
    ""outcomes"": [
      { ""weight"": 22, ""text"": ""Cura profunda!"", ""effects"": [{ ""type"": ""heal"", ""min"": 30, ""max"": 40 }] },
      { ""weight"": 20, ""text"": ""Alguma coisa embaixo morde."", ""effects"": [{ ""type"": ""damage"", ""element"": ""neutro"", ""min"": 22, ""max"": 30 }] }
    ]
  }
}";

        /// <summary>Estrelas de CLASSE: cinco degraus, e só o ★3 e o ★5 mexem em PP e PA.</summary>
        public const string Estrelas = @"{
  ""max"": 5,
  ""bonuses"": {
    ""1"": { ""hp"": 15 },
    ""2"": { ""power"": 8 },
    ""3"": { ""pp"": 1 },
    ""4"": { ""hp"": 25, ""dodge"": 10 },
    ""5"": { ""pa"": 1 }
  }
}";

        /// <summary>A forja, com a exceção que segura a economia de ações.</summary>
        public const string Forja = @"{
  ""maxLevel"": 10,
  ""tiers"": [
    { ""from"": 0, ""to"": 2, ""name"": ""Comum"" },
    { ""from"": 3, ""to"": 5, ""name"": ""Raro"" },
    { ""from"": 6, ""to"": 9, ""name"": ""Supremo"" },
    { ""from"": 10, ""to"": 10, ""name"": ""Magnífico"" }
  ],
  ""bonusPerLevel"": 0.12,
  ""stoneCost"": [2, 3, 4, 6, 8, 10, 13, 16, 20, 25],
  ""nonScalingKeys"": [""pa"", ""pp""]
}";
    }
}
