using System.Collections.Generic;
using Newtonsoft.Json;

namespace Soterra.Dados
{
    /// <summary>
    /// Resistência por elemento, em porcentagem.
    ///
    /// Classe com cinco campos e não dicionário: o acervo escreve os cinco
    /// sempre nas fichas de classe e monstro, e nos bônus de item escreve só o
    /// que muda. Com campos, o que falta já vale zero — com dicionário, cada
    /// leitor teria de lembrar de tratar a chave ausente, e um esquecimento
    /// vira <c>KeyNotFoundException</c> no meio da batalha.
    /// </summary>
    public sealed class Resistencias
    {
        [JsonProperty("fogo")] public int Fogo { get; set; }
        [JsonProperty("agua")] public int Agua { get; set; }
        [JsonProperty("terra")] public int Terra { get; set; }
        [JsonProperty("ar")] public int Ar { get; set; }
        [JsonProperty("neutro")] public int Neutro { get; set; }

        public int De(string elemento)
        {
            switch (elemento)
            {
                case "fogo": return Fogo;
                case "agua": return Agua;
                case "terra": return Terra;
                case "ar": return Ar;
                case "neutro": return Neutro;
                default: return 0;
            }
        }
    }

    /// <summary>Ficha de combate de uma classe ou de um monstro.</summary>
    public sealed class Atributos
    {
        [JsonProperty("hp")] public int Pv { get; set; }

        /// <summary>Pontos de ação — conjurar feitiço.</summary>
        [JsonProperty("pa")] public int Pa { get; set; }

        /// <summary>Pontos de passo — andar. Uma casa custa 1.</summary>
        [JsonProperty("pp")] public int Pp { get; set; }

        [JsonProperty("initiative")] public int Iniciativa { get; set; }
        [JsonProperty("power")] public int Poder { get; set; }

        /// <summary>Chance de se soltar de quem prendeu. É identidade de classe.</summary>
        [JsonProperty("dodge")] public int Esquiva { get; set; }

        /// <summary>
        /// Fixação: o quanto ESTA unidade prende as outras. <c>lock</c> no
        /// acervo — nome que em C# é palavra reservada, daí a tradução.
        /// </summary>
        [JsonProperty("lock")] public int Fixacao { get; set; }

        [JsonProperty("resists")] public Resistencias Resistencias { get; set; }

        public Atributos()
        {
            Resistencias = new Resistencias();
        }
    }

    /// <summary>Três cores que identificam a classe, o clima ou o calabouço.</summary>
    public sealed class Paleta
    {
        [JsonProperty("primary")] public string Primaria { get; set; }
        [JsonProperty("secondary")] public string Secundaria { get; set; }
        [JsonProperty("accent")] public string Destaque { get; set; }
    }

    /// <summary>
    /// Uma das seis classes jogáveis.
    ///
    /// O <c>Id</c> não bate com o <c>Nome</c> em três delas — <c>sumo</c> é o
    /// Bárbaro, <c>curandeira</c> é a Paladina, <c>espadachim</c> é o Ladino.
    /// É dívida de renomeação antiga (SISTEMAS §3) e o que manda no código é o
    /// id: procurar classe por nome é como o dado é perdido.
    /// </summary>
    public sealed class Classe
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("name")] public string Nome { get; set; }

        /// <summary>tanque, atirador, mago, assassino, suporte, invocador.</summary>
        [JsonProperty("role")] public string Papel { get; set; }

        [JsonProperty("description")] public string Descricao { get; set; }
        [JsonProperty("lore")] public string Lenda { get; set; }
        [JsonProperty("palette")] public Paleta Paleta { get; set; }
        [JsonProperty("stats")] public Atributos Atributos { get; set; }

        /// <summary>Os três feitiços neutros que todo mundo da classe já sabe.</summary>
        [JsonProperty("baseSpells")] public List<string> FeiticosBase { get; set; }

        /// <summary>
        /// Os quatro caminhos elementais, cada um com seis feitiços. Chaves:
        /// fogo, agua, terra, ar. Só UM é escolhido, no nível 5, para sempre.
        /// </summary>
        [JsonProperty("paths")] public Dictionary<string, List<string>> Caminhos { get; set; }

        [JsonProperty("startsUnlocked")] public bool JaLiberada { get; set; }
        [JsonProperty("cardRarity")] public string RaridadeDaCarta { get; set; }

        public Classe()
        {
            FeiticosBase = new List<string>();
            Caminhos = new Dictionary<string, List<string>>();
        }
    }
}
