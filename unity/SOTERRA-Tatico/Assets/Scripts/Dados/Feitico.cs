using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Soterra.Grade;

namespace Soterra.Dados
{
    /// <summary>
    /// Quem o feitiço aceita como alvo (<c>targetSide</c> no acervo).
    ///
    /// Os nomes são os do JSON — <c>self</c>, <c>ally</c>, <c>enemy</c>,
    /// <c>any</c> — porque o <c>StringEnumConverter</c> casa por NOME, sem
    /// diferenciar maiúscula. Traduzir estes quatro para português quebraria a
    /// leitura em silêncio: enum sem correspondência vira o valor 0, e todo
    /// feitiço do jogo passaria a mirar em si mesmo.
    /// </summary>
    [JsonConverter(typeof(StringEnumConverter))]
    public enum Lado
    {
        Self,
        Ally,
        Enemy,
        Any
    }

    /// <summary>
    /// Até onde o feitiço CHEGA (<c>range</c>). Separado da área de propósito:
    /// alcance é a pergunta "dá para mirar ali?", área é "o que isso pega".
    /// Confundir os dois é o defeito que faz um meteoro de raio 3 só poder ser
    /// lançado a 3 casas.
    ///
    /// Não é <c>Soterra.Grade.Alcance</c> porque aquela struct é a REGRA
    /// (valida casa por casa contra o mapa) e esta aqui é só o DADO lido do
    /// arquivo. A ponte entre as duas é da rodada em que a struct existir.
    /// </summary>
    public sealed class AlcanceDeFeitico
    {
        [JsonProperty("min")] public int Min { get; set; }
        [JsonProperty("max")] public int Max { get; set; }

        /// <summary>Só em linha reta (sem diagonal, sem cotovelo).</summary>
        [JsonProperty("line")] public bool Linha { get; set; }

        /// <summary>Exige linha de visão — quem está atrás de `#` não é alvo.</summary>
        [JsonProperty("los")] public bool Visao { get; set; }

        /// <summary>Alcance que acompanha o conjurador quando ele anda.</summary>
        [JsonProperty("movable")] public bool Movivel { get; set; }
    }

    /// <summary>
    /// O que o feitiço PEGA ao chegar (<c>aoe</c>).
    ///
    /// Com <c>Forma</c> diferente de <c>Single</c> e <c>Tamanho &gt; 0</c> a casa
    /// alvo é um LUGAR: basta estar no alcance e a área pega quem estiver
    /// dentro — ou ninguém (SISTEMAS §2). Só alvo único exige criatura na casa.
    /// </summary>
    public sealed class AreaDeFeitico
    {
        [JsonProperty("shape")] public Forma Forma { get; set; }
        [JsonProperty("size")] public int Tamanho { get; set; }

        /// <summary>
        /// Qualificado como <c>Grade.Forma</c> porque a propriedade se chama
        /// <c>Forma</c> e esconde o nome do tipo dentro desta classe.
        /// </summary>
        public bool ApenasAlvoUnico
        {
            get { return Forma == Grade.Forma.Single || Tamanho <= 0; }
        }
    }

    /// <summary>
    /// Um efeito de feitiço, evento de terreno ou traço.
    ///
    /// É uma classe SÓ, com todos os campos opcionais, e não uma hierarquia por
    /// <c>type</c>: no acervo o mesmo nome de campo muda de sentido conforme o
    /// tipo — em <c>damage</c>, <c>min</c>/<c>max</c> são a faixa de dano; em
    /// <c>mark</c>, <c>max</c> é o teto de PILHAS (5). Uma classe por tipo daria
    /// a impressão de que o motor pode confiar no nome do campo sozinho, e ele
    /// não pode: tem de olhar o <c>Tipo</c> primeiro, sempre.
    /// </summary>
    public sealed class Efeito
    {
        [JsonProperty("type")] public string Tipo { get; set; }

        [JsonProperty("element")] public string Elemento { get; set; }

        /// <summary>Piso da faixa (dano, cura, veneno, regeneração).</summary>
        [JsonProperty("min")] public int? Min { get; set; }

        /// <summary>Teto da faixa — EXCETO em <c>mark</c>, onde é o teto de pilhas.</summary>
        [JsonProperty("max")] public int? Max { get; set; }

        /// <summary>Turnos que o efeito dura.</summary>
        [JsonProperty("duration")] public int? Duracao { get; set; }

        /// <summary>Valor cru: escudo, resistência, bônus de atributo, marca.</summary>
        [JsonProperty("value")] public int? Valor { get; set; }

        /// <summary>Atributo que o <c>buff</c> mexe: pa, pp, power, dodge, lock, initiative.</summary>
        [JsonProperty("stat")] public string Atributo { get; set; }

        /// <summary>Casas de empurrão ou puxão.</summary>
        [JsonProperty("tiles")] public int? Casas { get; set; }

        /// <summary>Metade do dano causado volta como vida ao conjurador.</summary>
        [JsonProperty("lifesteal")] public bool RoubaVida { get; set; }

        /// <summary>Clima que o <c>weatherShift</c> impõe na sala.</summary>
        [JsonProperty("weather")] public string Clima { get; set; }

        /// <summary>Carga de armadilha plantada (id em <c>DATA.spells</c>).</summary>
        [JsonProperty("trapId")] public string IdDaArmadilha { get; set; }

        /// <summary>Multiplicador do <c>detonateMarks</c>.</summary>
        [JsonProperty("mult")] public int? Multiplicador { get; set; }

        /// <summary>Saltos do raio em cadeia.</summary>
        [JsonProperty("jumps")] public int? Saltos { get; set; }

        /// <summary>Fração perdida a cada salto da cadeia.</summary>
        [JsonProperty("falloff")] public double? Queda { get; set; }

        /// <summary>O que o <c>cleanse</c> tira: poison, root…</summary>
        [JsonProperty("kinds")] public List<string> Tipos { get; set; }

        /// <summary>Criatura que o <c>summon</c> põe no tabuleiro.</summary>
        [JsonProperty("monsterId")] public string IdDoMonstro { get; set; }

        /// <summary>Casas que o <c>moveTo</c> pode percorrer.</summary>
        [JsonProperty("maxTiles")] public int? CasasMaximas { get; set; }

        /// <summary>Porcentagem devolvida pelo <c>reflect</c>.</summary>
        [JsonProperty("pct")] public int? Porcentagem { get; set; }
    }

    /// <summary>
    /// Um feitiço do acervo.
    ///
    /// Esta classe serve às CINCO tabelas de feitiço do jogo — <c>spells</c>,
    /// <c>itemSpells</c>, <c>monsterSpells</c>, <c>petSpells</c> e
    /// <c>fusionSpells</c> — porque todas as fábricas do JS montam exatamente
    /// os mesmos campos. O motor procura o id nas cinco, sem mesclar: mesclar
    /// deixaria um id de item apagar um id de classe sem aviso.
    /// </summary>
    public sealed class Feitico
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("name")] public string Nome { get; set; }
        [JsonProperty("element")] public string Elemento { get; set; }

        /// <summary>Classe dona. <c>null</c> em feitiço de item, monstro, bicho e fusão.</summary>
        [JsonProperty("classId")] public string IdDaClasse { get; set; }

        /// <summary>0 nos três neutros; 5, 10, 12, 15, 20 ou 30 no caminho elemental.</summary>
        [JsonProperty("unlockLevel")] public int NivelDeDesbloqueio { get; set; }

        [JsonProperty("paCost")] public int CustoDePa { get; set; }
        [JsonProperty("cooldown")] public int Recarga { get; set; }

        /// <summary>
        /// Lançamentos por turno. Zero nas cargas de armadilha: elas nunca são
        /// conjuradas à mão, só disparadas por um efeito <c>trap</c>, e por isso
        /// não podem aparecer na barra.
        /// </summary>
        [JsonProperty("castsPerTurn")] public int LancamentosPorTurno { get; set; }

        [JsonProperty("range")] public AlcanceDeFeitico Alcance { get; set; }
        [JsonProperty("aoe")] public AreaDeFeitico Area { get; set; }

        /// <summary>Exige casa vazia (invocação, teleporte).</summary>
        [JsonProperty("needsEmptyTile")] public bool ExigeCasaVazia { get; set; }

        [JsonProperty("targetSide")] public Lado Alvo { get; set; }
        [JsonProperty("effects")] public List<Efeito> Efeitos { get; set; }
        [JsonProperty("description")] public string Descricao { get; set; }
        [JsonProperty("flavor")] public string Sabor { get; set; }

        /// <summary>Chave do efeito visual; o nome decide a família de desenho.</summary>
        [JsonProperty("fxKey")] public string ChaveDeEfeito { get; set; }

        public Feitico()
        {
            Efeitos = new List<Efeito>();
        }
    }
}
