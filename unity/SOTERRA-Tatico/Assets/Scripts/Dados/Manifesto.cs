using System.Collections.Generic;
using Newtonsoft.Json;

namespace Soterra.Dados
{
    /// <summary>
    /// O <c>_manifesto.json</c> gerado junto com o acervo (contrato §4).
    ///
    /// Ele existe para uma coisa só: provar que o que a Unity leu é o que o
    /// exportador escreveu. Sem ele, um arquivo truncado pela metade carregaria
    /// 80 feitiços em vez de 171 e o jogo só ia estranhar horas depois, na
    /// árvore de feitiços de uma classe qualquer.
    /// </summary>
    public sealed class Manifesto
    {
        public const string Chave = "_manifesto";

        /// <summary>Carimbo de quando o acervo foi exportado, como texto.</summary>
        [JsonProperty("gerado")] public string Gerado { get; set; }

        /// <summary>Página que foi executada para gerar (hoje, <c>v2.html</c>).</summary>
        [JsonProperty("fonte")] public string Fonte { get; set; }

        /// <summary>
        /// Contagem por chave: comprimento se a chave for lista, número de
        /// chaves se for objeto.
        /// </summary>
        [JsonProperty("chaves")] public Dictionary<string, int> Chaves { get; set; }

        public Manifesto()
        {
            Chaves = new Dictionary<string, int>();
        }

        public static Manifesto DeJson(string json)
        {
            var m = Json.Objeto<Manifesto>(json);
            if (m == null) return null;
            if (m.Chaves == null) m.Chaves = new Dictionary<string, int>();
            return m;
        }

        /// <summary>Contagem declarada para a chave, ou −1 se ela não consta.</summary>
        public int Conta(string chave)
        {
            int n;
            return Chaves.TryGetValue(chave, out n) ? n : -1;
        }
    }
}
