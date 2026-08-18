using System.Collections.Generic;
using Newtonsoft.Json;
using Soterra.Grade;

namespace Soterra.Dados
{
    /// <summary>
    /// Uma sala: o desenho do chão em texto, o clima e quem nasce onde.
    /// </summary>
    public sealed class Sala
    {
        [JsonProperty("name")] public string Nome { get; set; }
        [JsonProperty("weather")] public string Clima { get; set; }

        /// <summary>Tema visual desta sala; indexa <c>DATA.scenery</c>.</summary>
        [JsonProperty("sceneryTheme")] public string TemaDeCenario { get; set; }

        /// <summary>
        /// O chão desenhado, uma string por linha, a de cima primeiro.
        /// Símbolos em SISTEMAS §2: <c>.</c> <c>,</c> <c>#</c> <c>=</c>
        /// <c>~</c> <c>P</c> e <c>a</c>–<c>z</c>.
        /// </summary>
        [JsonProperty("layout")] public List<string> Desenho { get; set; }

        /// <summary>
        /// Letra do desenho para id de monstro. A MESMA letra aparece em várias
        /// casas do desenho de propósito — é um grupo, não um bicho só.
        /// </summary>
        [JsonProperty("monsters")] public Dictionary<string, string> Monstros { get; set; }

        public Sala()
        {
            Desenho = new List<string>();
            Monstros = new Dictionary<string, string>();
        }

        /// <summary>
        /// Converte o desenho no mapa jogável da camada de grade.
        ///
        /// É aqui que o dado vira regra, e é a única junção entre as duas
        /// camadas: se o desenho vier torto do exportador, o defeito aparece
        /// nesta chamada e não vinte telas adiante.
        /// </summary>
        public Mapa ParaMapa()
        {
            return Mapa.DeTexto(Desenho.ToArray());
        }
    }

    /// <summary>Cores do calabouço, incluindo as dos dois tipos de obstáculo.</summary>
    public sealed class PaletaDeCalabouco
    {
        [JsonProperty("primary")] public string Primaria { get; set; }
        [JsonProperty("secondary")] public string Secundaria { get; set; }
        [JsonProperty("accent")] public string Destaque { get; set; }
        [JsonProperty("floor1")] public string Chao1 { get; set; }
        [JsonProperty("floor2")] public string Chao2 { get; set; }

        /// <summary>Cor do obstáculo ALTO (<c>#</c>).</summary>
        [JsonProperty("wall")] public string Parede { get; set; }

        /// <summary>Cor do obstáculo BAIXO (<c>=</c>) — tem de destoar da alta.</summary>
        [JsonProperty("lowWall")] public string ParedeBaixa { get; set; }

        [JsonProperty("voidColor")] public string Vazio { get; set; }
    }

    /// <summary>Uma linha da tabela de saque do calabouço.</summary>
    public sealed class EntradaDeSaque
    {
        [JsonProperty("itemId")] public string IdDoItem { get; set; }
        [JsonProperty("weight")] public int Peso { get; set; }

        /// <summary>Índice da sala mais rasa em que a peça pode cair (0 = a primeira).</summary>
        [JsonProperty("minRoom")] public int SalaMinima { get; set; }
    }

    /// <summary>Carta de classe que o chefe deste calabouço pode derrubar.</summary>
    public sealed class QuedaDeCarta
    {
        [JsonProperty("classId")] public string IdDaClasse { get; set; }
        [JsonProperty("weight")] public int Peso { get; set; }
    }

    /// <summary>
    /// Um dos seis calabouços.
    ///
    /// <c>JOGO.DATA.dungeons</c> é LISTA e não objeto indexado — é a única
    /// chave grande do acervo assim, e ler como dicionário estoura na leitura.
    /// A ordem da lista é a ordem de descida.
    /// </summary>
    public sealed class Calabouco
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("name")] public string Nome { get; set; }

        /// <summary>Tema visual padrão; indexa <c>DATA.scenery</c>.</summary>
        [JsonProperty("theme")] public string Tema { get; set; }

        [JsonProperty("description")] public string Descricao { get; set; }
        [JsonProperty("difficulty")] public int Dificuldade { get; set; }
        [JsonProperty("order")] public int Ordem { get; set; }

        /// <summary>
        /// Faixa em que este calabouço é o conteúdo certo. Acima de
        /// <c>+4</c> a experiência começa a cair — ver <c>Nivelamento.QuedaDeXp</c>.
        /// </summary>
        [JsonProperty("recommendedLevel")] public int NivelRecomendado { get; set; }

        [JsonProperty("palette")] public PaletaDeCalabouco Paleta { get; set; }
        [JsonProperty("defaultWeather")] public string ClimaPadrao { get; set; }

        /// <summary>Rodadas entre trocas de clima. Zero = clima fixo na sala.</summary>
        [JsonProperty("weatherShiftEveryRounds")] public int TrocaDeClimaACadaRodadas { get; set; }

        /// <summary>Fração das casas que ganha marca de evento por rodada.</summary>
        [JsonProperty("tileEventRate")] public double TaxaDeEventos { get; set; }

        [JsonProperty("rooms")] public List<Sala> Salas { get; set; }
        [JsonProperty("lootTable")] public List<EntradaDeSaque> TabelaDeSaque { get; set; }
        [JsonProperty("cardDrops")] public List<QuedaDeCarta> QuedasDeCarta { get; set; }

        public Calabouco()
        {
            Salas = new List<Sala>();
            TabelaDeSaque = new List<EntradaDeSaque>();
            QuedasDeCarta = new List<QuedaDeCarta>();
        }

        /// <summary>A última sala é sempre a do chefe, e sempre a maior do calabouço.</summary>
        public Sala SalaDoChefe
        {
            get { return Salas.Count == 0 ? null : Salas[Salas.Count - 1]; }
        }
    }

    /// <summary>
    /// Nomes visuais que o Designer desenha no lugar de blocos genéricos.
    ///
    /// <c>Altos</c> são coisas que ninguém enxerga por cima (parede, torre,
    /// fornalha); <c>Baixos</c> são coisas em que dá para escorar e atirar por
    /// cima (mureta, vagonete, bigorna). Trocar as duas listas destruiria a
    /// leitura de cobertura sem quebrar nenhum teste de regra.
    /// </summary>
    public sealed class Cenario
    {
        [JsonProperty("high")] public List<string> Altos { get; set; }
        [JsonProperty("low")] public List<string> Baixos { get; set; }
        [JsonProperty("floor")] public List<string> Chaos { get; set; }

        /// <summary>Adereços sem colisão.</summary>
        [JsonProperty("props")] public List<string> Aderecos { get; set; }

        public Cenario()
        {
            Altos = new List<string>();
            Baixos = new List<string>();
            Chaos = new List<string>();
            Aderecos = new List<string>();
        }
    }

    /// <summary>Um resultado possível do evento surpresa, com o seu peso.</summary>
    public sealed class DesfechoDeEvento
    {
        [JsonProperty("weight")] public int Peso { get; set; }
        [JsonProperty("text")] public string Texto { get; set; }
        [JsonProperty("effects")] public List<Efeito> Efeitos { get; set; }

        public DesfechoDeEvento()
        {
            Efeitos = new List<Efeito>();
        }
    }

    /// <summary>
    /// Marca de evento que brota no chão e age sobre quem pisa.
    ///
    /// O <c>ev-mystery</c> é o único com <c>Desfechos</c>: os outros aplicam
    /// <c>Efeitos</c> direto. Um leitor que só olhe <c>Efeitos</c> faz a
    /// surpresa não fazer nada, calada.
    /// </summary>
    public sealed class EventoDeTerreno
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("name")] public string Nome { get; set; }

        /// <summary>buff, mystery, portal, drain, fountain.</summary>
        [JsonProperty("kind")] public string Especie { get; set; }

        [JsonProperty("icon")] public string Icone { get; set; }
        [JsonProperty("weight")] public int Peso { get; set; }

        /// <summary>Rodadas até a marca sumir sozinha.</summary>
        [JsonProperty("duration")] public int Duracao { get; set; }

        [JsonProperty("effects")] public List<Efeito> Efeitos { get; set; }
        [JsonProperty("outcomes")] public List<DesfechoDeEvento> Desfechos { get; set; }
        [JsonProperty("description")] public string Descricao { get; set; }
        [JsonProperty("flavor")] public string Sabor { get; set; }
        [JsonProperty("fxKey")] public string ChaveDeEfeito { get; set; }

        public EventoDeTerreno()
        {
            Efeitos = new List<Efeito>();
            Desfechos = new List<DesfechoDeEvento>();
        }
    }
}
