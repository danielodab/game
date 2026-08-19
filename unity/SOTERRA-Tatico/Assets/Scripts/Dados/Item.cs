using System.Collections.Generic;
using Newtonsoft.Json;

namespace Soterra.Dados
{
    /// <summary>
    /// O que uma peça de equipamento (ou um bônus de conjunto) soma.
    ///
    /// Todo campo que o JSON não traz vale ZERO — é assim que o acervo escreve,
    /// só o que muda. Por isso os campos são <c>int</c> e não <c>int?</c>: um
    /// bônus ausente não é "desconhecido", é "não soma nada".
    /// </summary>
    public sealed class Bonus
    {
        [JsonProperty("hp")] public int Pv { get; set; }

        /// <summary>Teto de +1 em todo o jogo, e forja nunca escala este campo.</summary>
        [JsonProperty("pa")] public int Pa { get; set; }

        /// <summary>Teto de +1 em todo o jogo, e forja nunca escala este campo.</summary>
        [JsonProperty("pp")] public int Pp { get; set; }

        [JsonProperty("power")] public int Poder { get; set; }
        [JsonProperty("initiative")] public int Iniciativa { get; set; }
        [JsonProperty("dodge")] public int Esquiva { get; set; }
        [JsonProperty("lock")] public int Fixacao { get; set; }
        [JsonProperty("resists")] public Resistencias Resistencias { get; set; }

        /// <summary>
        /// Feitiço que o BÔNUS concede. Só o degrau de 4 peças do Coração
        /// Partido usa (`cp-set-heart.bonuses["4"].grantsSpell`); sem este
        /// campo, quem vestisse o conjunto inteiro não ganhava o feitiço.
        /// </summary>
        [JsonProperty("grantsSpell")] public string ConcedeFeitico { get; set; }

        public Bonus()
        {
            Resistencias = new Resistencias();
        }
    }

    /// <summary>
    /// Uma peça de equipamento.
    ///
    /// <c>Elemento</c>, <c>IdDoConjunto</c>, <c>PesoDeQueda</c>, <c>PecaChave</c>
    /// e <c>SalaMinima</c> NÃO são escritos à mão no acervo: o rodapé de
    /// <c>items.js</c> os deriva do conjunto e da raridade, justamente para que
    /// peça e conjunto não possam divergir. Chegam prontos no JSON, e reescrevê-los
    /// aqui reintroduziria a divergência que o rodapé existe para impedir.
    /// </summary>
    public sealed class Item
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("name")] public string Nome { get; set; }

        /// <summary>punho (PA), passo (PP), casca (vida) ou lume (concede feitiço).</summary>
        [JsonProperty("slot")] public string Espaco { get; set; }

        /// <summary>comum, raro, epico, lendario.</summary>
        [JsonProperty("rarity")] public string Raridade { get; set; }

        [JsonProperty("dungeonId")] public string IdDoCalabouco { get; set; }

        /// <summary>Herdado do conjunto. <c>null</c> nas peças avulsas com elemento próprio.</summary>
        [JsonProperty("element")] public string Elemento { get; set; }

        /// <summary><c>null</c> na peça avulsa — e é assim que ela se reconhece.</summary>
        [JsonProperty("setId")] public string IdDoConjunto { get; set; }

        [JsonProperty("dropWeight")] public int PesoDeQueda { get; set; }
        [JsonProperty("bonuses")] public Bonus Bonus { get; set; }

        /// <summary>Feitiço que a peça concede. Só os Lumes têm.</summary>
        [JsonProperty("grantsSpell")] public string ConcedeFeitico { get; set; }

        [JsonProperty("description")] public string Descricao { get; set; }
        [JsonProperty("flavor")] public string Sabor { get; set; }
        [JsonProperty("iconKey")] public string ChaveDeIcone { get; set; }

        /// <summary>
        /// Peça que muda COMO se joga (+1 PA, +1 PP ou Lume). Pesa metade das
        /// irmãs de mesma raridade — são as mais difíceis do jogo.
        /// </summary>
        [JsonProperty("keyPiece")] public bool PecaChave { get; set; }

        [JsonProperty("minRoom")] public int SalaMinima { get; set; }

        public Item()
        {
            Bonus = new Bonus();
        }
    }

    /// <summary>
    /// Um conjunto: quatro peças, uma por espaço, com bônus por 2, 3 ou 4
    /// vestidas. O elemento é o dos MONSTROS que derrubam as peças.
    /// </summary>
    public sealed class Conjunto
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("name")] public string Nome { get; set; }
        [JsonProperty("element")] public string Elemento { get; set; }
        [JsonProperty("dungeonId")] public string IdDoCalabouco { get; set; }
        [JsonProperty("description")] public string Descricao { get; set; }
        [JsonProperty("pieces")] public List<string> Pecas { get; set; }

        /// <summary>
        /// Chave = quantas peças vestidas (2, 3 ou 4). Chave de dicionário
        /// numérica em JSON só existe como TEXTO — o Newtonsoft converte de
        /// volta, e é por isso que este campo não pode virar lista indexada.
        /// </summary>
        [JsonProperty("bonuses")] public Dictionary<int, Bonus> Bonus { get; set; }

        /// <summary>Derivada no rodapé: a maior raridade entre as peças.</summary>
        [JsonProperty("rarity")] public string Raridade { get; set; }

        public Conjunto()
        {
            Pecas = new List<string>();
            Bonus = new Dictionary<int, Bonus>();
        }
    }

    /// <summary>
    /// Pedra de forja — uma por elemento. Melhorar consome pedras do elemento
    /// DO ITEM; item neutro aceita qualquer uma.
    /// </summary>
    public sealed class Pedra
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("name")] public string Nome { get; set; }
        [JsonProperty("element")] public string Elemento { get; set; }
        [JsonProperty("description")] public string Descricao { get; set; }
        [JsonProperty("iconKey")] public string ChaveDeIcone { get; set; }
    }

    /// <summary>Faixa de nomes da forja (Comum, Raro, Supremo, Magnífico).</summary>
    public sealed class FaixaDeForja
    {
        [JsonProperty("from")] public int De { get; set; }
        [JsonProperty("to")] public int Ate { get; set; }
        [JsonProperty("name")] public string Nome { get; set; }
    }

    /// <summary>
    /// A forja: determinística, até +10, nunca quebra e nunca regride.
    ///
    /// <c>AtributosQueNaoEscalam</c> é a regra que segura a economia inteira:
    /// PA e PP nunca crescem com o nível de forja. Sem essa exceção, um épico
    /// de +1 PA viraria +2 PA já no +5 (arredondando 1 × 1,6) e o teto de uma
    /// ação extra por herói deixaria de existir.
    /// </summary>
    public sealed class Forja
    {
        [JsonProperty("maxLevel")] public int NivelMaximo { get; set; }
        [JsonProperty("tiers")] public List<FaixaDeForja> Faixas { get; set; }

        /// <summary>Fração dos bônus BASE somada por nível (0,12 ⇒ 2,20× no +10).</summary>
        [JsonProperty("bonusPerLevel")] public double BonusPorNivel { get; set; }

        /// <summary>Pedras de cada degrau, do +0 ao +10.</summary>
        [JsonProperty("stoneCost")] public List<int> CustoEmPedras { get; set; }

        [JsonProperty("nonScalingKeys")] public List<string> AtributosQueNaoEscalam { get; set; }

        public Forja()
        {
            Faixas = new List<FaixaDeForja>();
            CustoEmPedras = new List<int>();
            AtributosQueNaoEscalam = new List<string>();
        }
    }

    /// <summary>Multiplicador de sorte de saque por tamanho do grupo.</summary>
    public sealed class SorteDeSaque
    {
        [JsonProperty("solo")] public double Solo { get; set; }
        [JsonProperty("dupla")] public double Dupla { get; set; }
    }

    /// <summary>Expoente da sorte de saque por raridade.</summary>
    public sealed class ExpoenteDeSorte
    {
        [JsonProperty("comum")] public int Comum { get; set; }
        [JsonProperty("raro")] public int Raro { get; set; }
        [JsonProperty("epico")] public int Epico { get; set; }
        [JsonProperty("lendario")] public int Lendario { get; set; }
    }

    /// <summary>
    /// O modelo de saque. As razões são frações do peso total dos comuns —
    /// não pesos absolutos —, então acrescentar item ao acervo não afrouxa o
    /// saque: o rodapé renormaliza por calabouço.
    /// </summary>
    public sealed class PesosDeSaque
    {
        [JsonProperty("comum")] public int Comum { get; set; }
        [JsonProperty("rareRatio")] public double RazaoRaro { get; set; }
        [JsonProperty("epicRatio")] public double RazaoEpico { get; set; }
        [JsonProperty("legendRatio")] public double RazaoLendario { get; set; }

        /// <summary>Peso do resultado "nada" — é ele que faz uma peça já ser um bom saque.</summary>
        [JsonProperty("emptyRatio")] public double RazaoVazio { get; set; }

        /// <summary>Peça-chave pesa metade das irmãs de mesma raridade.</summary>
        [JsonProperty("keyFactor")] public double FatorDePecaChave { get; set; }

        [JsonProperty("luck")] public SorteDeSaque Sorte { get; set; }
        [JsonProperty("luckExponent")] public ExpoenteDeSorte ExpoenteDaSorte { get; set; }

        /// <summary>Peso do "sem item" por calabouço, preenchido no rodapé.</summary>
        [JsonProperty("noDrop")] public Dictionary<string, int> SemQueda { get; set; }

        public PesosDeSaque()
        {
            SemQueda = new Dictionary<string, int>();
        }
    }
}
