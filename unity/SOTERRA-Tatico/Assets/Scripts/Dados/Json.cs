using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace Soterra.Dados
{
    /// <summary>
    /// A leitura de JSON do projeto, num lugar só.
    ///
    /// Newtonsoft e não <c>JsonUtility</c>: o acervo do jogo é, em quase toda
    /// chave, um OBJETO indexado por id (<c>DATA.spells['sumo-neutro-1']</c>) ou
    /// uma LISTA no topo (<c>DATA.dungeons</c>). O <c>JsonUtility</c> da Unity
    /// não lê nem um nem outro — devolve objeto zerado sem reclamar, que é o
    /// pior defeito possível: o jogo sobe com zero feitiços e ninguém vê erro.
    /// </summary>
    public static class Json
    {
        /// <summary>
        /// Campo do JSON que a classe C# não conhece é IGNORADO de propósito:
        /// o acervo é gerado por outro dono e pode ganhar campo novo a qualquer
        /// rodada. Quebrar a leitura inteira por causa de um campo a mais
        /// transformaria toda ampliação de dado numa parada do jogo.
        ///
        /// Newtonsoft converte número sempre em cultura invariante, e é por isso
        /// que ele é usado até para os decimais: `float.Parse("0.3")` numa
        /// máquina pt-BR devolve 3 — o dano de um feitiço multiplicado por dez.
        /// </summary>
        static readonly JsonSerializerSettings Config = new JsonSerializerSettings
        {
            MissingMemberHandling = MissingMemberHandling.Ignore,
            // Data como TEXTO. O `gerado` do manifesto é um carimbo para humano
            // ler; deixar o Newtonsoft convertê-lo em DateTime o reescreveria no
            // fuso da máquina e faria dois computadores discordarem do mesmo
            // arquivo.
            DateParseHandling = DateParseHandling.None
        };

        public static T Objeto<T>(string json) where T : class
        {
            if (string.IsNullOrEmpty(json)) return null;
            return JsonConvert.DeserializeObject<T>(json, Config);
        }

        /// <summary>Chave de id para valor — a forma da maioria de <c>JOGO.DATA</c>.</summary>
        public static Dictionary<string, T> Mapa<T>(string json)
        {
            if (string.IsNullOrEmpty(json)) return new Dictionary<string, T>();
            return JsonConvert.DeserializeObject<Dictionary<string, T>>(json, Config)
                   ?? new Dictionary<string, T>();
        }

        public static List<T> Lista<T>(string json)
        {
            if (string.IsNullOrEmpty(json)) return new List<T>();
            return JsonConvert.DeserializeObject<List<T>>(json, Config) ?? new List<T>();
        }

        /// <summary>
        /// Conta os elementos do topo sem modelar o conteúdo: comprimento se for
        /// lista, número de chaves se for objeto — a mesma regra do
        /// <c>_manifesto.json</c> (contrato §4). Serve para conferir chave que
        /// esta rodada ainda não modelou.
        /// </summary>
        public static int ContaTopo(string json)
        {
            if (string.IsNullOrEmpty(json)) return -1;
            var texto = json.TrimStart();
            if (texto.Length == 0) return -1;

            if (texto[0] == '[')
            {
                var lista = JsonConvert.DeserializeObject<List<object>>(json, Config);
                return lista == null ? -1 : lista.Count;
            }
            if (texto[0] == '{')
            {
                var mapa = JsonConvert.DeserializeObject<Dictionary<string, object>>(json, Config);
                return mapa == null ? -1 : mapa.Count;
            }
            throw new FormatException("topo do JSON não é objeto nem lista");
        }
    }
}
