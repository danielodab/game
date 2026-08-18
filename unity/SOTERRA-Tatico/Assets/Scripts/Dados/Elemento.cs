using Newtonsoft.Json;

namespace Soterra.Dados
{
    /// <summary>
    /// Os cinco elementos, escritos como o acervo os escreve.
    ///
    /// Constante de texto e não <c>enum</c> porque elemento é CHAVE de
    /// dicionário no acervo inteiro — resistências, caminhos de classe,
    /// conjuntos, pedras, misturas de fusão. Um enum obrigaria a converter em
    /// texto de volta em cada uma dessas voltas, e a primeira conversão
    /// esquecida geraria a chave "Fogo", que não existe em lugar nenhum.
    /// </summary>
    public static class Elemento
    {
        public const string Neutro = "neutro";
        public const string Fogo = "fogo";
        public const string Agua = "agua";
        public const string Terra = "terra";
        public const string Ar = "ar";
    }

    /// <summary>
    /// Apresentação de um elemento: nome visível, cor do número de dano, ícone.
    /// </summary>
    public sealed class InfoDeElemento
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("name")] public string Nome { get; set; }
        [JsonProperty("color")] public string Cor { get; set; }
        [JsonProperty("icon")] public string Icone { get; set; }
        [JsonProperty("description")] public string Descricao { get; set; }
    }

    /// <summary>Paleta que o clima empresta à cena inteira.</summary>
    public sealed class PaletaDeClima
    {
        /// <summary>Filtro geral da cena.</summary>
        [JsonProperty("tint")] public string Tinta { get; set; }

        /// <summary>Luz de fundo.</summary>
        [JsonProperty("ambient")] public string Ambiente { get; set; }

        [JsonProperty("accent")] public string Destaque { get; set; }

        [JsonProperty("particle")] public string Particula { get; set; }
    }

    /// <summary>
    /// Um dos cinco climas, definido POR SALA.
    ///
    /// <c>Favorece</c> e <c>Prejudica</c> são sempre um par de rivais, e no
    /// clima <c>calmo</c> os dois são nulos — a sala sem opinião. Ler o
    /// prejudicado de outro lugar que não a rivalidade é como se inventa um
    /// terceiro par que o jogo nunca teve.
    /// </summary>
    public sealed class Clima
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("name")] public string Nome { get; set; }
        [JsonProperty("favors")] public string Favorece { get; set; }
        [JsonProperty("harms")] public string Prejudica { get; set; }
        [JsonProperty("description")] public string Descricao { get; set; }
        [JsonProperty("flavor")] public string Sabor { get; set; }
        [JsonProperty("fxKey")] public string ChaveDeEfeito { get; set; }
        [JsonProperty("palette")] public PaletaDeClima Paleta { get; set; }
    }
}
