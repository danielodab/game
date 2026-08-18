using System.Collections.Generic;
using Newtonsoft.Json;

namespace Soterra.Dados
{
    /// <summary>
    /// Rendimento decrescente ao repetir calabouço raso. Só vale para XP —
    /// item, pedra e carta não caem por causa disto.
    /// </summary>
    public sealed class QuedaDeXp
    {
        /// <summary>Níveis de graça acima do recomendado antes de começar a cair.</summary>
        [JsonProperty("graceLevels")] public int NiveisDeGraca { get; set; }

        [JsonProperty("factorPerLevel")] public double FatorPorNivel { get; set; }

        /// <summary>Piso do multiplicador — a XP nunca zera.</summary>
        [JsonProperty("floor")] public double Piso { get; set; }
    }

    /// <summary>
    /// Ganho por nível. <c>Poder</c> é genérico (vale para tudo);
    /// <c>PoderElemental</c> só conta em feitiço do elemento escolhido.
    /// </summary>
    public sealed class GanhoPorNivel
    {
        [JsonProperty("hp")] public int Pv { get; set; }
        [JsonProperty("power")] public int Poder { get; set; }
        [JsonProperty("elemPower")] public int PoderElemental { get; set; }
    }

    /// <summary>Alvo de esquiva e fixação no nível máximo, por papel de classe.</summary>
    public sealed class DefesaDePapel
    {
        [JsonProperty("dodge")] public int Esquiva { get; set; }
        [JsonProperty("lock")] public int Fixacao { get; set; }
    }

    /// <summary>
    /// Fúria da sala: o antídoto contra empate por sustentação.
    ///
    /// Uma dupla que cura mais do que apanha nunca resolveria a luta. A partir
    /// de <c>AposRodada</c> os inimigos ganham poder e a cura dos DOIS lados
    /// encolhe; em <c>RodadasMaximas</c> a batalha encerra como derrota.
    /// </summary>
    public sealed class FuriaDaSala
    {
        [JsonProperty("afterRound")] public int AposRodada { get; set; }
        [JsonProperty("powerPerRound")] public int PoderPorRodada { get; set; }
        [JsonProperty("healCutPerRound")] public double CorteDeCuraPorRodada { get; set; }
        [JsonProperty("maxRounds")] public int RodadasMaximas { get; set; }
    }

    /// <summary>
    /// A curva de nível.
    ///
    /// A <c>TabelaDeXp</c> está CONGELADA por coordenação: ela e o <c>xp</c> dos
    /// monstros descrevem a mesma economia por pontas opostas, e mexer num lado
    /// sem o outro derruba a validação — já aconteceu três vezes numa noite.
    /// </summary>
    public sealed class Nivelamento
    {
        [JsonProperty("maxLevel")] public int NivelMaximo { get; set; }

        /// <summary>
        /// XP ACUMULADA para atingir cada nível: índice 0 é o nível 1 (zero),
        /// índice 29 é o nível 30. Ler como "XP do próximo nível" desloca a
        /// curva inteira em um degrau.
        /// </summary>
        [JsonProperty("xpTable")] public List<int> TabelaDeXp { get; set; }

        [JsonProperty("xpFalloff")] public QuedaDeXp QuedaDeXp { get; set; }

        /// <summary>Vale nos níveis 2 a 5 — antes de o elemento ser escolhido.</summary>
        [JsonProperty("perLevel")] public GanhoPorNivel PorNivel { get; set; }

        /// <summary>Vale do nível 6 em diante, depois da escolha do elemento.</summary>
        [JsonProperty("perLevelElement")] public GanhoPorNivel PorNivelComElemento { get; set; }

        /// <summary>
        /// Chaveado pelo <c>role</c> da classe, não pelo id: uma sétima classe
        /// herdaria o ritmo do papel que escolhesse.
        /// </summary>
        [JsonProperty("defenseByRole")] public Dictionary<string, DefesaDePapel> DefesaPorPapel { get; set; }

        [JsonProperty("elementChoiceLevel")] public int NivelDaEscolhaDeElemento { get; set; }
        [JsonProperty("roomFury")] public FuriaDaSala FuriaDaSala { get; set; }

        public Nivelamento()
        {
            TabelaDeXp = new List<int>();
            DefesaPorPapel = new Dictionary<string, DefesaDePapel>();
        }
    }

    /// <summary>
    /// Carta de classe. Repetida NÃO é lixo: o excedente ao custo de
    /// desbloqueio compra estrelas, então nunca existe carta inútil.
    /// </summary>
    public sealed class CartaDeClasse
    {
        /// <summary>Cartas para liberar a classe. Zero = já nasce liberada.</summary>
        [JsonProperty("unlockCost")] public int CustoDeDesbloqueio { get; set; }

        [JsonProperty("dropWeight")] public int PesoDeQueda { get; set; }

        /// <summary>Índice do calabouço mais raso em que a carta pode cair (0 = o primeiro).</summary>
        [JsonProperty("minDungeon")] public int CalaboucoMinimo { get; set; }

        /// <summary>Cartas EXCEDENTES acumuladas por estrela, de ★1 a ★5.</summary>
        [JsonProperty("starCosts")] public List<int> CustoDasEstrelas { get; set; }

        public CartaDeClasse()
        {
            CustoDasEstrelas = new List<int>();
        }
    }

    /// <summary>
    /// Estrelas de CLASSE — bônus fixos e permanentes por cartas excedentes.
    ///
    /// Não confundir com a trilha de estrela de ITEM descrita no SISTEMAS §8:
    /// esta aqui vai até ★5 e soma atributos crus; aquela é outra coisa e não
    /// existe em <c>js/core/data/</c>.
    /// </summary>
    public sealed class Estrelas
    {
        [JsonProperty("max")] public int Maximo { get; set; }

        /// <summary>Chave = número de estrelas (1 a 5).</summary>
        [JsonProperty("bonuses")] public Dictionary<int, Bonus> Bonus { get; set; }

        public Estrelas()
        {
            Bonus = new Dictionary<int, Bonus>();
        }
    }
}
