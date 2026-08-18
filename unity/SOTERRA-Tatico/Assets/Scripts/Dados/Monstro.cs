using System.Collections.Generic;
using Newtonsoft.Json;

namespace Soterra.Dados
{
    /// <summary>
    /// Traço passivo de uma criatura.
    ///
    /// Mesma escolha do <c>Efeito</c>: uma classe com campos opcionais, porque
    /// o sentido de cada campo depende do <c>Tipo</c>. Em <c>enrage</c>,
    /// <c>Poder</c> é o quanto ele ganha ao ficar ferido; em <c>explodeOnDeath</c>
    /// quem manda é <c>Dano</c>.
    /// </summary>
    public sealed class Traco
    {
        /// <summary>pushImmune, enrage, explodeOnDeath, regenAura, split.</summary>
        [JsonProperty("type")] public string Tipo { get; set; }

        [JsonProperty("element")] public string Elemento { get; set; }
        [JsonProperty("damage")] public int? Dano { get; set; }
        [JsonProperty("radius")] public int? Raio { get; set; }

        /// <summary>Fração de vida que dispara o <c>enrage</c>.</summary>
        [JsonProperty("hpPct")] public double? FracaoDePv { get; set; }

        [JsonProperty("power")] public int? Poder { get; set; }
        [JsonProperty("value")] public int? Valor { get; set; }

        /// <summary>Em quem o <c>split</c> se parte.</summary>
        [JsonProperty("monsterId")] public string IdDoMonstro { get; set; }

        [JsonProperty("count")] public int? Quantidade { get; set; }
    }

    /// <summary>
    /// Pedra que o monstro pode derrubar. <c>null</c> nas invocações — invocação
    /// não vira minério.
    /// </summary>
    public sealed class QuedaDePedra
    {
        [JsonProperty("chance")] public double Chance { get; set; }
        [JsonProperty("min")] public int Min { get; set; }
        [JsonProperty("max")] public int Max { get; set; }
    }

    /// <summary>
    /// Um bicho do bestiário.
    ///
    /// Serve a <c>DATA.monsters</c> e a <c>DATA.fusionSummons</c>: as duas
    /// tabelas têm a mesma forma, e o próprio acervo manda mesclar a segunda na
    /// primeira no boot.
    ///
    /// Os números de <c>Atributos</c> e <c>Xp</c> chegam JÁ escalados pela
    /// profundidade do calabouço — a fábrica do JS multiplica antes de escrever.
    /// Reaplicar a escala aqui dobraria a dureza do jogo inteiro.
    /// </summary>
    public sealed class Monstro
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("name")] public string Nome { get; set; }
        [JsonProperty("family")] public string Familia { get; set; }
        [JsonProperty("element")] public string Elemento { get; set; }

        /// <summary><c>null</c> nas invocações, que não moram em calabouço nenhum.</summary>
        [JsonProperty("dungeonId")] public string IdDoCalabouco { get; set; }

        [JsonProperty("description")] public string Descricao { get; set; }
        [JsonProperty("flavor")] public string Sabor { get; set; }
        [JsonProperty("stats")] public Atributos Atributos { get; set; }
        [JsonProperty("spells")] public List<string> Feiticos { get; set; }

        /// <summary>melee, ranged, support ou boss.</summary>
        [JsonProperty("ai")] public string Ia { get; set; }

        [JsonProperty("traits")] public List<Traco> Tracos { get; set; }
        [JsonProperty("boss")] public bool Chefe { get; set; }

        /// <summary>Só entra em campo por invocação — nunca nasce numa sala.</summary>
        [JsonProperty("summonOnly")] public bool SoInvocado { get; set; }

        /// <summary>
        /// Fracionária de propósito, com UMA casa. Arredondar para inteiro
        /// faria todo bicho do calabouço 1 valer "1 XP" e apagaria o peso
        /// relativo entre eles. A soma da sala é que vira inteiro.
        /// </summary>
        [JsonProperty("xp")] public double Xp { get; set; }

        [JsonProperty("stoneDrop")] public QuedaDePedra QuedaDePedra { get; set; }

        public Monstro()
        {
            Atributos = new Atributos();
            Feiticos = new List<string>();
            Tracos = new List<Traco>();
        }
    }

    /// <summary>
    /// Bicho de estimação: ocupa o quinto espaço do herói e age depois do dono.
    /// </summary>
    public sealed class Bicho
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("name")] public string Nome { get; set; }
        [JsonProperty("element")] public string Elemento { get; set; }
        [JsonProperty("description")] public string Descricao { get; set; }
        [JsonProperty("bonuses")] public Bonus Bonus { get; set; }

        /// <summary>attack, guard ou support.</summary>
        [JsonProperty("behavior")] public string Comportamento { get; set; }

        [JsonProperty("range")] public int Alcance { get; set; }

        /// <summary>Casas que ele mantém do dono antes de voltar a colar nele.</summary>
        [JsonProperty("followDistance")] public int DistanciaDeSeguir { get; set; }

        [JsonProperty("spells")] public List<string> Feiticos { get; set; }
        [JsonProperty("dropDungeon")] public string CalaboucoDeQueda { get; set; }
        [JsonProperty("dropWeight")] public int PesoDeQueda { get; set; }

        public Bicho()
        {
            Bonus = new Bonus();
            Feiticos = new List<string>();
        }
    }
}
