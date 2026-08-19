using System.Collections.Generic;
using Newtonsoft.Json;

namespace Soterra.Progressao
{
    /// <summary>
    /// Uma CÓPIA de item no saco.
    ///
    /// É cópia e não "item com contador" porque duas botas iguais podem estar em
    /// níveis de forja diferentes — uma no +0 e outra no +7 —, e um contador só
    /// obrigaria a escolher qual dos dois níveis mentir. A tela agrupa as cópias
    /// idênticas num espaço com ×N (<see cref="Progresso.Pilhas"/>); o dado
    /// guardado continua sendo uma linha por peça.
    /// </summary>
    public sealed class CopiaDeItem
    {
        [JsonProperty("itemId")] public string IdDoItem { get; set; }

        /// <summary>Nível de forja, de 0 a <c>upgrade.maxLevel</c>.</summary>
        [JsonProperty("level")] public int NivelDeForja { get; set; }

        public CopiaDeItem() { }

        public CopiaDeItem(string idDoItem, int nivelDeForja)
        {
            IdDoItem = idDoItem;
            NivelDeForja = nivelDeForja;
        }
    }

    /// <summary>
    /// A ficha persistida de um herói.
    ///
    /// O NÍVEL não está aqui de propósito: ele é derivado da XP
    /// (<see cref="Progresso.NivelPorXp"/>). Guardar os dois deixaria o save
    /// capaz de afirmar "nível 30 com 0 de XP", e algum dia afirmaria — foi
    /// assim que o save do JS precisou recalcular o nível em toda carga. Com um
    /// campo só, a contradição não tem onde nascer.
    /// </summary>
    public sealed class FichaDeHeroi
    {
        [JsonProperty("classId")] public string IdDaClasse { get; set; }

        /// <summary>Nasce <c>neutro</c>. Escolhido no nível 5 e IRREVERSÍVEL.</summary>
        [JsonProperty("element")] public string Elemento { get; set; }

        [JsonProperty("xp")] public int Xp { get; set; }

        /// <summary>Espaço (punho/passo/casca/lume) para id do item vestido.</summary>
        [JsonProperty("items")] public Dictionary<string, string> Itens { get; set; }

        /// <summary>
        /// Espaço para o nível de forja da CÓPIA vestida. Vive separado de
        /// <see cref="Itens"/> porque equipar TIRA a peça do saco: sem este
        /// carimbo, desequipar devolveria uma cópia crua e a forja evaporaria.
        /// </summary>
        [JsonProperty("itemLevel")] public Dictionary<string, int> NivelDoItem { get; set; }

        [JsonProperty("pet")] public string Bicho { get; set; }

        public FichaDeHeroi()
        {
            Elemento = Dados.Elemento.Neutro;
            Itens = new Dictionary<string, string>();
            NivelDoItem = new Dictionary<string, int>();
        }
    }

    /// <summary>
    /// Tudo o que sobrevive a fechar o jogo.
    ///
    /// O saco (<see cref="Saco"/>), os bichos, as cartas e as pedras são do
    /// GRUPO, não do herói — é o que permite dois pares de botas iguais irem um
    /// em cada herói (SISTEMAS §9).
    /// </summary>
    public sealed class EstadoDeProgresso
    {
        /// <summary>
        /// Versão do FORMATO. Serve para uma carga futura saber o que está
        /// lendo; hoje só existe a 1, porque este é o primeiro save da Unity —
        /// o save do JS mora no <c>localStorage</c> do navegador e não é
        /// alcançável daqui, então não há o que migrar.
        /// </summary>
        public const int VersaoAtual = 1;

        [JsonProperty("version")] public int Versao { get; set; }
        [JsonProperty("unlockedClasses")] public List<string> ClassesLiberadas { get; set; }
        [JsonProperty("heroes")] public Dictionary<string, FichaDeHeroi> Herois { get; set; }

        /// <summary>O saco ÚNICO do grupo, uma linha por cópia.</summary>
        [JsonProperty("inventory")] public List<CopiaDeItem> Saco { get; set; }

        /// <summary>Bichos ainda sem dono. Equipar tira daqui, igual ao item.</summary>
        [JsonProperty("pets")] public List<string> Bichos { get; set; }

        /// <summary>Cartas por classe. NUNCA decresce: o excedente vira estrela.</summary>
        [JsonProperty("cards")] public Dictionary<string, int> Cartas { get; set; }

        [JsonProperty("stones")] public Dictionary<string, int> Pedras { get; set; }

        public EstadoDeProgresso()
        {
            Versao = VersaoAtual;
            ClassesLiberadas = new List<string>();
            Herois = new Dictionary<string, FichaDeHeroi>();
            Saco = new List<CopiaDeItem>();
            Bichos = new List<string>();
            Cartas = new Dictionary<string, int>();
            Pedras = new Dictionary<string, int>();
        }
    }

    /// <summary>Uma pilha da grade: a variante e quantas cópias livres existem dela.</summary>
    public struct Pilha
    {
        public string IdDoItem;
        public int NivelDeForja;
        public int Quantidade;

        /// <summary>Índice da PRIMEIRA cópia no saco — é por ele que a tela equipa e forja.</summary>
        public int Indice;
    }
}
