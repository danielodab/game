using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEngine;
using Soterra.Dados;

namespace Soterra.Cena
{
    /// <summary>
    /// Quem veste o quê: o id de uma unidade (<c>sumo</c>, <c>pollen-puff</c>)
    /// para o modelo do acervo, as peças que ficam visíveis e a tinta.
    ///
    /// Uma unidade é <b>uma</b> entrada aqui; um modelo serve <b>várias</b>. O
    /// Bruxo e o Xamã vestem o mesmo <c>mage.glb</c> e só se distinguem pelo que
    /// cada um mostra e pela cor — chapéu pontudo e cajado num, grimório aberto
    /// e varinha no outro. Por isso o filtro de peças mora aqui e não na
    /// conversão do modelo: apagar o chapéu no arquivo tiraria o chapéu dos dois.
    /// </summary>
    public sealed class DesenhoDaUnidade
    {
        /// <summary>Nome do arquivo do acervo, sem pasta e sem extensão:
        /// <c>barbarian</c>, <c>q_frog</c>.</summary>
        [JsonProperty("model")] public string Modelo { get; set; }

        /// <summary>Correção de porte do jogo em JS. NÃO é usada para decidir a
        /// altura — ver <see cref="Elenco.AlturaDe(string)"/>, que segue a tabela
        /// do CONTRATO_ENTREGA_PERSONAGEM. Fica lida porque é dado do acervo e
        /// jogar fora dado que existe é como perdê-lo.</summary>
        [JsonProperty("scale")] public float Escala { get; set; }

        /// <summary>Cor da unidade. Nos heróis é a paleta da classe; nos
        /// monstros vem vazia e quem manda é o elemento.</summary>
        [JsonProperty("tint")] public string Tinta { get; set; }

        [JsonProperty("accent")] public string Destaque { get; set; }

        /// <summary>Arma-assinatura. A fusão empresta esta peça.</summary>
        [JsonProperty("weapon")] public string Arma { get; set; }

        /// <summary>
        /// As peças SOLTAS que ficam visíveis — arma, capa, chapéu. Vazia quer
        /// dizer "mostra tudo", e é o caso dos monstros do Quaternius, que vêm
        /// com um corpo só e nada para escolher.
        ///
        /// O corpo (malha com esqueleto) NUNCA entra nesta conta: ele aparece
        /// sempre. É a mesma regra do jogo em JS — <c>if (!n.isMesh ||
        /// n.isSkinnedMesh) return;</c> — e sem ela o herói ficaria invisível.
        /// </summary>
        [JsonProperty("show")] public List<string> Mostrar { get; set; }

        public DesenhoDaUnidade()
        {
            Escala = 1f;
            Mostrar = new List<string>();
        }
    }

    /// <summary>
    /// O mapa inteiro, lido de <c>Assets/Resources/dados/_aparencia.json</c> —
    /// as 6 classes e os 66 bichos, extraídos de
    /// <c>js/render3d/models3d_v2.js</c> por outro dono.
    ///
    /// <b>É aqui que a troca de elenco acontece.</b> Quando os modelos do Meshy
    /// chegarem, um id passa a apontar para o modelo novo trocando UMA linha
    /// deste JSON — ou nem isso: o <see cref="ModelosDeResources"/> procura
    /// primeiro por um modelo com o nome do PRÓPRIO id, então soltar
    /// <c>elenco/sumo/sumo.fbx</c> já basta para o Bárbaro trocar de corpo sem
    /// que nada mude aqui nem em código.
    /// </summary>
    public sealed class Aparencia
    {
        /// <summary>Chave do arquivo dentro de <c>Resources/dados/</c>.</summary>
        public const string Chave = "_aparencia";

        readonly Dictionary<string, DesenhoDaUnidade> _porId =
            new Dictionary<string, DesenhoDaUnidade>();

        /// <summary>Quantas entradas foram lidas. Zero quer dizer que o arquivo
        /// não estava lá — estado esperado, e o Elenco cai no placeholder.</summary>
        public int Contagem { get { return _porId.Count; } }

        public static Aparencia Carregar(IFonteDeTexto fonte = null)
        {
            var texto = (fonte ?? new FonteDeResources()).Ler(Chave);
            var mapa = new Aparencia();
            if (string.IsNullOrEmpty(texto)) return mapa;

            var raiz = Json.Objeto<RaizDoArquivo>(texto);
            if (raiz == null) return mapa;

            // Classes primeiro e monstros depois, mas a ordem não importa: os
            // dois conjuntos de id são disjuntos no acervo (as seis classes têm
            // nome de ofício, os bichos têm nome com hífen).
            mapa.Absorver(raiz.Classes);
            mapa.Absorver(raiz.Monstros);
            return mapa;
        }

        void Absorver(Dictionary<string, DesenhoDaUnidade> parte)
        {
            if (parte == null) return;
            foreach (var par in parte)
                if (par.Value != null) _porId[par.Key] = par.Value;
        }

        /// <summary>O desenho deste id, ou nulo se o acervo não conhece.</summary>
        public DesenhoDaUnidade De(string id)
        {
            DesenhoDaUnidade d;
            return id != null && _porId.TryGetValue(id, out d) ? d : null;
        }

        sealed class RaizDoArquivo
        {
            [JsonProperty("classes")] public Dictionary<string, DesenhoDaUnidade> Classes { get; set; }
            [JsonProperty("monstros")] public Dictionary<string, DesenhoDaUnidade> Monstros { get; set; }
        }
    }
}
