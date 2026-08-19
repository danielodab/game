using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEngine;

namespace Soterra.Fx
{
    /// <summary>Um quadro do atlas, como <c>_mapa.json</c> o descreve.</summary>
    public sealed class QuadroDoAtlas
    {
        [JsonProperty("indice")] public int Indice { get; set; }

        /// <summary>O nome que o código usa: <c>runa</c>, <c>corte</c>, <c>brasa</c>.</summary>
        [JsonProperty("nome")] public string Nome { get; set; }

        /// <summary>O nome de origem no pacote Kenney — a trilha para a arte.</summary>
        [JsonProperty("kenney")] public string Kenney { get; set; }
    }

    /// <summary>O <c>_mapa.json</c> inteiro: a grade e os 16 quadros.</summary>
    public sealed class MapaDoAtlas
    {
        [JsonProperty("cols")] public int Colunas { get; set; }
        [JsonProperty("rows")] public int Linhas { get; set; }
        [JsonProperty("lado")] public int Lado { get; set; }
        [JsonProperty("licenca")] public string Licenca { get; set; }
        [JsonProperty("quadros")] public List<QuadroDoAtlas> Quadros { get; set; }

        public MapaDoAtlas()
        {
            Quadros = new List<QuadroDoAtlas>();
        }
    }

    /// <summary>
    /// O atlas de 16 formas (Kenney Particle Pack, CC0) e o ÚNICO material que
    /// desenha todo efeito do jogo.
    ///
    /// UM material, e não um por família nem um por cor. Duas razões, e as duas
    /// já custaram caro nesta equipe:
    ///
    /// 1. Material distinto criado em tempo de edição faz o SRP Batcher
    ///    desenhar TUDO com a cor do primeiro (CONTRATO_UNITY_F1 §3) — o
    ///    meteoro de fogo pintaria a onda de água de laranja.
    /// 2. Uma textura e um material mantêm o orçamento de celular: as 21
    ///    famílias e as 16 formas convivem num punhado de chamadas de desenho,
    ///    em vez de uma por efeito no ar.
    ///
    /// A COR não mora no material: mora em <c>main.startColor</c> de cada
    /// sistema, que vira cor de vértice. É o que deixa o mesmo material servir
    /// aos cinco elementos e às duas cores de uma fusão.
    /// </summary>
    public sealed class AtlasDeEfeito
    {
        public const string Pasta = "fx";
        public const string CaminhoDaTextura = Pasta + "/atlas";
        public const string CaminhoDoMapa = Pasta + "/_mapa";

        /// <summary>
        /// Os shaders aceitáveis, do melhor para o pior. O primeiro é o de
        /// partícula do URP; os outros são a rede para um projeto que troque de
        /// pipeline. Todos respeitam COR DE VÉRTICE, que é a condição para a
        /// cor do elemento chegar na tela com um material só.
        /// </summary>
        static readonly string[] Shaders =
        {
            "Universal Render Pipeline/Particles/Unlit",
            "Particles/Standard Unlit",
            "Sprites/Default"
        };

        readonly Dictionary<string, int> _porNome = new Dictionary<string, int>();

        public Texture2D Textura { get; private set; }
        public MapaDoAtlas Mapa { get; private set; }
        public Material Material { get; private set; }

        public int Colunas { get { return Mapa != null && Mapa.Colunas > 0 ? Mapa.Colunas : 4; } }
        public int Linhas { get { return Mapa != null && Mapa.Linhas > 0 ? Mapa.Linhas : 4; } }
        public int Quadros { get { return Colunas * Linhas; } }

        /// <summary>Carregou a arte de verdade? Falso quando o PNG não foi
        /// extraído — o efeito ainda sai, em quadrado branco, mas quem
        /// fotografa precisa saber que está vendo a rede e não a arte.</summary>
        public bool Completo { get { return Textura != null && Mapa != null && Mapa.Quadros.Count > 0; } }

        public static AtlasDeEfeito CarregarDeResources()
        {
            var a = new AtlasDeEfeito();
            a.Textura = Resources.Load<Texture2D>(CaminhoDaTextura);

            var texto = Resources.Load<TextAsset>(CaminhoDoMapa);
            a.Mapa = texto != null ? Dados.Json.Objeto<MapaDoAtlas>(texto.text) : null;
            if (a.Mapa == null) a.Mapa = new MapaDoAtlas();

            for (int i = 0; i < a.Mapa.Quadros.Count; i++)
            {
                var q = a.Mapa.Quadros[i];
                if (q != null && !string.IsNullOrEmpty(q.Nome)) a._porNome[q.Nome] = q.Indice;
            }

            a.Material = a.MontarMaterial();
            return a;
        }

        /// <summary>
        /// O índice do quadro pelo nome. Devolve 0 (o ponto macio) quando o
        /// nome não existe: um nome errado num molde tem de desenhar ALGO — o
        /// -1 viraria uma UV fora do atlas e a partícula sumiria em silêncio.
        /// </summary>
        public int Quadro(string nome)
        {
            int i;
            return _porNome.TryGetValue(nome, out i) ? i : 0;
        }

        public bool TemQuadro(string nome)
        {
            return _porNome.ContainsKey(nome);
        }

        Material MontarMaterial()
        {
            Shader s = null;
            for (int i = 0; i < Shaders.Length && s == null; i++) s = Shader.Find(Shaders[i]);
            if (s == null) return null;

            var m = new Material(s) { name = "SOTERRA/Efeitos" };
            // O nome da propriedade de textura mudou entre pipelines: o URP usa
            // _BaseMap e os antigos _MainTex. Escrever nos dois é mais barato
            // que descobrir na foto que o efeito saiu branco chapado — foi
            // assim que o elenco do Meshy chegou fantasma.
            if (Textura != null)
            {
                if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", Textura);
                if (m.HasProperty("_MainTex")) m.SetTexture("_MainTex", Textura);
            }
            // Aditivo: efeito é LUZ, e luz soma. Sem isto o quadrado do sprite
            // aparece como retângulo escuro sobre o chão claro.
            if (m.HasProperty("_Surface")) m.SetFloat("_Surface", 1f);       // transparente
            if (m.HasProperty("_Blend")) m.SetFloat("_Blend", 1f);           // additive
            if (m.HasProperty("_SrcBlend")) m.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            if (m.HasProperty("_DstBlend")) m.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.One);
            if (m.HasProperty("_ZWrite")) m.SetFloat("_ZWrite", 0f);
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", Color.white);
            if (m.HasProperty("_Color")) m.SetColor("_Color", Color.white);
            m.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
            m.EnableKeyword("_ALPHAPREMULTIPLY_ON");
            return m;
        }
    }
}
