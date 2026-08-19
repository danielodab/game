using System.IO;
using NUnit.Framework;
using Soterra.Dados;
using Soterra.Testes.Dados;
using UnityEngine;

namespace Soterra.Testes.Batalha
{
    /// <summary>
    /// De onde os testes de montagem tiram o acervo.
    ///
    /// São duas portas, e as duas são necessárias:
    ///
    /// - <see cref="DaEstufa"/> monta um banco em memória com o Vestíbulo das
    ///   Heras REAL (reaproveitando <c>Fixturas.Calabocos</c> e
    ///   <c>Fixturas.Classes</c>, que são cópias literais do acervo). Roda sem
    ///   disco, em milissegundos, e não depende de arquivo de outro dono.
    /// - <see cref="DeVerdadeOuInconclusivo"/> abre o acervo exportado. É o
    ///   único que prova que os SEIS calabouços de verdade montam — mas termina
    ///   inconclusivo, e nunca verde, se os JSON ainda não existirem.
    /// </summary>
    public static class Acervo
    {
        /// <summary>
        /// Os três bichos do Vestíbulo, copiados de
        /// <c>Assets/Resources/dados/monsters.json</c>.
        ///
        /// <c>description</c> e <c>flavor</c> foram OMITIDOS, e não encurtados —
        /// encurtar seria inventar, e a omissão ainda prova que a leitura
        /// tolera campo ausente.
        ///
        /// Os três juntos cobrem o que a ordem de iniciativa tem de acertar:
        /// a Vespa (75) passa na frente dos dois Bufos (55, empatados entre si),
        /// que passam na frente das duas Vergastas (35).
        /// </summary>
        public const string MonstrosDaEstufa = @"{
  ""pollen-puff"": {
    ""id"": ""pollen-puff"", ""name"": ""Bufo-de-Pólen"", ""family"": ""Flora Voraz"",
    ""element"": ""terra"", ""dungeonId"": ""greenhouse"",
    ""stats"": {
      ""hp"": 45, ""pa"": 3, ""pp"": 3, ""initiative"": 55, ""power"": 0, ""dodge"": 8, ""lock"": 8,
      ""resists"": { ""fogo"": -30, ""agua"": 0, ""terra"": 10, ""ar"": 0, ""neutro"": 0 }
    },
    ""spells"": [""m-pollen-bite""], ""ai"": ""melee"",
    ""traits"": [{ ""type"": ""explodeOnDeath"", ""element"": ""terra"", ""damage"": 18, ""radius"": 1 }],
    ""boss"": false, ""summonOnly"": false, ""xp"": 0.9,
    ""stoneDrop"": { ""chance"": 0.3, ""min"": 1, ""max"": 2 }
  },
  ""thorn-lasher"": {
    ""id"": ""thorn-lasher"", ""name"": ""Vergasta"", ""family"": ""Flora Voraz"",
    ""element"": ""terra"", ""dungeonId"": ""greenhouse"",
    ""stats"": {
      ""hp"": 50, ""pa"": 6, ""pp"": 1, ""initiative"": 35, ""power"": 0, ""dodge"": 4, ""lock"": 26,
      ""resists"": { ""fogo"": -20, ""agua"": 0, ""terra"": 20, ""ar"": 0, ""neutro"": 0 }
    },
    ""spells"": [""m-thorn-shot"", ""m-root-grip""], ""ai"": ""ranged"",
    ""traits"": [{ ""type"": ""pushImmune"" }],
    ""boss"": false, ""summonOnly"": false, ""xp"": 1.1,
    ""stoneDrop"": { ""chance"": 0.3, ""min"": 1, ""max"": 2 }
  },
  ""lantern-wasp"": {
    ""id"": ""lantern-wasp"", ""name"": ""Vespa-Lustre"", ""family"": ""Enxame da Estufa"",
    ""element"": ""ar"", ""dungeonId"": ""greenhouse"",
    ""stats"": {
      ""hp"": 48, ""pa"": 3, ""pp"": 4, ""initiative"": 75, ""power"": 0, ""dodge"": 30, ""lock"": 6,
      ""resists"": { ""fogo"": 0, ""agua"": 0, ""terra"": -10, ""ar"": 20, ""neutro"": 0 }
    },
    ""spells"": [""m-wasp-sting""], ""ai"": ""melee"", ""traits"": [],
    ""boss"": false, ""summonOnly"": false, ""xp"": 1,
    ""stoneDrop"": { ""chance"": 0.3, ""min"": 1, ""max"": 2 }
  }
}";

        /// <summary>
        /// SALAS DE LABORATÓRIO, não acervo: os ids aqui são inventados de
        /// propósito, porque o que se mede é o caminho de erro e a geometria —
        /// e nenhuma sala de verdade tem letra sem dono nem um <c>P</c> só.
        ///
        /// A "Sala Torta" existe por um motivo específico: o Vestíbulo real é
        /// simétrico na vertical, então ele NÃO acusaria um mapa lido de cabeça
        /// para baixo — o <c>P</c> espelhado cai em cima de outro <c>P</c>. A
        /// Torta não é simétrica: espelhada, o herói nasce dentro de parede.
        /// </summary>
        public const string SalasDeLaboratorio = @"[
  {
    ""id"": ""laboratorio"", ""name"": ""Calabouço de Laboratório"",
    ""theme"": ""garden"", ""difficulty"": 1, ""order"": 99, ""recommendedLevel"": 1,
    ""defaultWeather"": ""vendaval"", ""weatherShiftEveryRounds"": 0, ""tileEventRate"": 0,
    ""rooms"": [
      { ""name"": ""Sala Torta"", ""weather"": ""chuva"",
        ""layout"": [""P.#"", "".#."", ""#.a""],
        ""monsters"": { ""a"": ""bicho-de-laboratorio"" } },
      { ""name"": ""Sala de um P só"",
        ""layout"": [""P.a""],
        ""monsters"": { ""a"": ""bicho-de-laboratorio"" } },
      { ""name"": ""Sala com letra solta"",
        ""layout"": [""P.a.b""],
        ""monsters"": { ""a"": ""bicho-de-laboratorio"" } },
      { ""name"": ""Sala com id errado"",
        ""layout"": [""P.a""],
        ""monsters"": { ""a"": ""bicho-que-nunca-existiu"" } },
      { ""name"": ""Sala sem clima próprio"",
        ""layout"": [""PP.a""],
        ""monsters"": { ""a"": ""bicho-de-laboratorio"" } }
    ],
    ""lootTable"": [], ""cardDrops"": []
  }
]";

        /// <summary>Iniciativa 99: ele passa na frente até do Ladino (90).</summary>
        public const string BichoDeLaboratorio = @"{
  ""bicho-de-laboratorio"": {
    ""id"": ""bicho-de-laboratorio"", ""name"": ""Bicho de Laboratório"", ""element"": ""fogo"",
    ""stats"": {
      ""hp"": 10, ""pa"": 1, ""pp"": 1, ""initiative"": 99, ""power"": 0, ""dodge"": 0, ""lock"": 0,
      ""resists"": { ""fogo"": 0, ""agua"": 0, ""terra"": 0, ""ar"": 0, ""neutro"": 0 }
    },
    ""spells"": [], ""ai"": ""melee"", ""traits"": [],
    ""boss"": false, ""summonOnly"": false, ""xp"": 0
  }
}";

        /// <summary>A Estufa Soterrada com o Vestíbulo real, o Bárbaro e o Ladino.</summary>
        public static BancoDeDados DaEstufa()
        {
            return BancoDeDados.Carregar(new FonteDeMemoria()
                .Com(BancoDeDados.ChaveCalabocos, Fixturas.Calabocos)
                .Com(BancoDeDados.ChaveClasses, Fixturas.Classes)
                .Com(BancoDeDados.ChaveMonstros, MonstrosDaEstufa));
        }

        /// <summary>As salas de laboratório, com as mesmas duas classes reais.</summary>
        public static BancoDeDados DoLaboratorio()
        {
            return BancoDeDados.Carregar(new FonteDeMemoria()
                .Com(BancoDeDados.ChaveCalabocos, SalasDeLaboratorio)
                .Com(BancoDeDados.ChaveClasses, Fixturas.Classes)
                .Com(BancoDeDados.ChaveMonstros, BichoDeLaboratorio));
        }

        /// <summary>
        /// O acervo exportado de verdade, ou o teste termina INCONCLUSIVO.
        ///
        /// Inconclusivo e não verde: um teste que passa porque o arquivo não
        /// existe afirma que está tudo certo justamente quando não há nada para
        /// conferir. Mesma regra do <c>ManifestoTests</c>.
        /// </summary>
        public static BancoDeDados DeVerdadeOuInconclusivo()
        {
            var caminho = (Application.dataPath + "/Resources/dados/" +
                           BancoDeDados.ChaveCalabocos + ".json").Replace('\\', '/');

            if (!File.Exists(caminho))
                Assert.Inconclusive(
                    "o acervo ainda não foi exportado: falta " + caminho +
                    ". Ele é gerado pelo papel Criativo/Dados (CONTRATO_UNITY_F1 §4). " +
                    "Este teste NÃO passa por ausência — volta a rodar sozinho quando o arquivo chegar.");

            var banco = BancoDeDados.CarregarDeResources();

            // O arquivo está em disco mas o Resources.Load não o achou: isso é
            // defeito de empacotamento, não ausência de dado.
            Assert.IsNotNull(banco.Calabocos, "Resources.Load não devolveu os calabouços");
            Assert.Greater(banco.Calabocos.Count, 0,
                "o arquivo existe em " + caminho + " e a leitura rendeu zero calabouço");

            return banco;
        }

        /// <summary>
        /// Conta um símbolo direto no DESENHO da sala, sem passar pelo
        /// <c>Mapa</c>.
        ///
        /// Contar pelo texto cru é o ponto: se o Montador e o Mapa errassem
        /// juntos, comparar um com o outro concordaria em silêncio. O desenho
        /// é a única testemunha que não participa da leitura.
        /// </summary>
        public static int NoDesenho(Sala sala, System.Func<char, bool> escolhe)
        {
            int n = 0;
            for (int i = 0; i < sala.Desenho.Count; i++)
            {
                var linha = sala.Desenho[i];
                for (int x = 0; x < linha.Length; x++)
                    if (escolhe(linha[x])) n++;
            }
            return n;
        }

        public static int NascimentosDeMonstroNoDesenho(Sala sala)
        {
            return NoDesenho(sala, delegate (char c) { return c >= 'a' && c <= 'z'; });
        }

        public static int NascimentosDeHeroiNoDesenho(Sala sala)
        {
            return NoDesenho(sala, delegate (char c) { return c == 'P'; });
        }
    }
}
