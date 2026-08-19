using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace Soterra.Jogo
{
    using Progressao = global::Soterra.Progressao;

    /// <summary>
    /// Onde a descida parou: o calabouço, a SALA e com quanto de vida o grupo
    /// entrou nela.
    ///
    /// Existe porque o save da progressão não guarda nada disto, e não deveria:
    /// <c>EstadoDeProgresso</c> é o que o jogador CONQUISTOU (XP, saco, cartas,
    /// pedras) e sobrevive a qualquer descida; onde ele está agora é estado de
    /// uma partida em curso. Fossem o mesmo arquivo, abandonar uma descida no
    /// meio exigiria limpar campos do save de progresso um a um — e o campo
    /// esquecido viraria um jogador preso numa sala que ele não escolheu.
    ///
    /// Chave própria pelo mesmo motivo, e no MESMO armazém: no WebGL o
    /// <c>PlayerPrefs</c> é o <c>localStorage</c>, e duas chaves na mesma origem
    /// são duas linhas — uma some sem levar a outra.
    ///
    /// O PV vai gravado em número ABSOLUTO, já calculado. Guardar "o PV do fim
    /// da sala anterior" obrigaria a reaplicar a cura entre salas na hora de
    /// ler, e a conta seria feita duas vezes: uma ao montar, outra ao retomar —
    /// duas contas do mesmo número é a definição de divergirem um dia.
    /// </summary>
    public sealed class MarcaDaDescida
    {
        /// <summary>Chave no armazém. A versão está no nome: um formato novo é
        /// uma chave nova, e a antiga simplesmente deixa de ser lida.</summary>
        public const string Chave = "soterra-descida-v1";

        [JsonProperty("dungeonId")] public string Calabouco { get; set; }
        [JsonProperty("room")] public int IndiceDaSala { get; set; }
        [JsonProperty("party")] public List<string> Grupo { get; set; }

        /// <summary>Id do herói para o PV com que ele ENTROU na sala corrente.</summary>
        [JsonProperty("hp")] public Dictionary<string, int> PvDeEntrada { get; set; }

        public MarcaDaDescida()
        {
            Grupo = new List<string>();
            PvDeEntrada = new Dictionary<string, int>();
        }

        /// <summary>
        /// A marca gravada, ou <c>null</c> — ausente, ilegível ou sem calabouço
        /// e sem grupo dá no mesmo: não há descida para retomar. Save quebrado
        /// NUNCA derruba o jogo, a mesma lei do <c>Progresso.Carregar</c>.
        /// </summary>
        public static MarcaDaDescida Ler(Progressao.IArmazem armazem)
        {
            if (armazem == null) return null;
            var texto = armazem.Ler(Chave);
            if (string.IsNullOrEmpty(texto)) return null;

            MarcaDaDescida m = null;
            try { m = JsonConvert.DeserializeObject<MarcaDaDescida>(texto); }
            catch (Exception) { return null; }

            if (m == null || string.IsNullOrEmpty(m.Calabouco)) return null;
            if (m.Grupo == null || m.Grupo.Count == 0) return null;
            if (m.PvDeEntrada == null) m.PvDeEntrada = new Dictionary<string, int>();
            if (m.IndiceDaSala < 0) m.IndiceDaSala = 0;
            return m;
        }

        /// <summary>Grava. Devolve <c>false</c> se o armazém recusou — e o jogo
        /// segue jogável em memória, como manda o <c>IArmazem</c>.</summary>
        public bool Gravar(Progressao.IArmazem armazem)
        {
            if (armazem == null) return false;
            string texto;
            try { texto = JsonConvert.SerializeObject(this); }
            catch (Exception) { return false; }
            return armazem.Gravar(Chave, texto);
        }

        /// <summary>
        /// Apaga a marca. Gravar texto vazio e não uma chave removida porque
        /// <c>IArmazem</c> não tem "apagar" — e vazio é exatamente o que
        /// <see cref="Ler"/> trata como "não há descida".
        /// </summary>
        public static void Apagar(Progressao.IArmazem armazem)
        {
            if (armazem != null) armazem.Gravar(Chave, string.Empty);
        }
    }
}
