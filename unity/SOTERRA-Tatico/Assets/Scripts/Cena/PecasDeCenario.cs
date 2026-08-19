using System.Collections.Generic;
using UnityEngine;

namespace Soterra.Cena
{
    /// <summary>
    /// Uma peça do env-kit já medida: as malhas que a compõem, onde cada uma
    /// fica dentro da peça, e a caixa que envolve tudo.
    ///
    /// Guarda MALHA e MATRIZ em vez do <c>GameObject</c> importado porque a sala
    /// não instancia peça nenhuma: ela costura as malhas numa só por tinta (ver
    /// <see cref="Cenografia"/>). Instanciar 357 objetos com malha própria é
    /// exatamente o que o celular não aguenta.
    /// </summary>
    public sealed class PecaDeCenario
    {
        public string Nome { get; private set; }

        /// <summary>As malhas da peça, na ordem em que foram encontradas.</summary>
        public IReadOnlyList<Mesh> Malhas { get { return _malhas; } }

        /// <summary>Onde cada malha fica dentro da peça. Existe porque o FBX que
        /// sai do Blender aninha a malha sob um ou dois transformes com rotação
        /// e escala próprias — ignorá-los deitaria metade do kit no chão.</summary>
        public IReadOnlyList<Matrix4x4> Poses { get { return _poses; } }

        /// <summary>Caixa da peça inteira, no espaço da peça.</summary>
        public Bounds Caixa { get; private set; }

        readonly List<Mesh> _malhas = new List<Mesh>();
        readonly List<Matrix4x4> _poses = new List<Matrix4x4>();

        public PecaDeCenario(string nome, GameObject raiz)
        {
            Nome = nome;
            if (raiz == null) return;

            // `localToWorldMatrix` do jeito que está, SEM descontar a raiz.
            //
            // Descontar a raiz foi a primeira tentativa e saiu errado de um jeito
            // difícil de ver: é justamente no transform da RAIZ que o importador
            // guarda a conversão de eixo do FBX — escala 100 e −90° em X, para
            // levar o Z-cima do Blender ao Y-cima da Unity. Anulando a raiz, a
            // parede chegava deitada e com um centésimo do tamanho, e o sintoma
            // era uma parede de 22 cm de altura sem erro nenhum no caminho.
            var filtros = raiz.GetComponentsInChildren<MeshFilter>(true);
            bool primeira = true;
            var caixa = new Bounds();

            for (int i = 0; i < filtros.Length; i++)
            {
                var malha = filtros[i].sharedMesh;
                if (malha == null) continue;
                var pose = filtros[i].transform.localToWorldMatrix;
                _malhas.Add(malha);
                _poses.Add(pose);

                // A caixa vem dos oito cantos TRANSFORMADOS, e não de
                // `bounds.center` mais `extents`: com a peça girada dentro do
                // FBX, somar extents daria uma caixa girada junto e a medida de
                // braço (que é o que decide qual peça a parede usa) sairia
                // trocada de eixo.
                var b = malha.bounds;
                for (int q = 0; q < 8; q++)
                {
                    var canto = new Vector3(
                        (q & 1) == 0 ? b.min.x : b.max.x,
                        (q & 2) == 0 ? b.min.y : b.max.y,
                        (q & 4) == 0 ? b.min.z : b.max.z);
                    var p = pose.MultiplyPoint3x4(canto);
                    if (primeira) { caixa = new Bounds(p, Vector3.zero); primeira = false; }
                    else caixa.Encapsulate(p);
                }
            }
            Caixa = caixa;
        }

        public bool Vazia { get { return _malhas.Count == 0; } }
    }

    /// <summary>
    /// De onde a sala tira uma peça do env-kit, dado o nome do arquivo.
    ///
    /// Interface e não chamada direta a <c>Resources.Load</c> pelo mesmo motivo
    /// de <see cref="IFonteDeModelos"/>: o teste precisa provar a regra de
    /// auto-tiling e a costura das malhas SEM depender de 49 FBX estarem
    /// importados — importação é lenta e não é o que se está medindo.
    /// </summary>
    public interface IFonteDePecas
    {
        /// <summary>A peça de nome <paramref name="nome"/>, ou <c>null</c>.
        /// <c>null</c> é estado esperado: sem o kit, a sala cai no cubo.</summary>
        PecaDeCenario Peca(string nome);

        /// <summary>O atlas do kit — UMA textura para as 49 peças. Nulo se o kit
        /// não está importado.</summary>
        Texture Atlas { get; }
    }

    /// <summary>
    /// A fonte de produção: <c>Assets/Resources/cenario/*.fbx</c>, gerado de
    /// <c>Assets/Modelos/cenario/*.glb</c> por
    /// <c>Ferramentas/converter_cenario.ps1</c>.
    ///
    /// O `.glb` está no repositório mas a Unity 6 não o lê sem
    /// <c>com.unity.cloud.gltfast</c>, e <c>Packages/</c> não é deste dono — a
    /// ponte é o Blender, igual à do elenco. No dia em que o pacote entrar, esta
    /// pasta some e o caminho passa a apontar para o `.glb` sem mais nada mudar.
    /// </summary>
    public sealed class PecasDeResources : IFonteDePecas
    {
        public const string Pasta = "cenario";

        /// <summary>As 49 peças dividem UM material e UM atlas — conferido no
        /// bloco JSON dos glb. É esse fato que deixa a sala inteira caber em meia
        /// dúzia de chamadas de desenho.</summary>
        public const string NomeDoAtlas = "dungeon_texture";

        readonly string _pasta;
        // Lembra também o que NÃO achou: sem isto, cada nome ausente bateria em
        // Resources.Load a cada montagem de sala.
        readonly Dictionary<string, PecaDeCenario> _cache = new Dictionary<string, PecaDeCenario>();
        Texture _atlas;
        bool _atlasProcurado;

        public PecasDeResources() : this(Pasta) { }
        public PecasDeResources(string pasta) { _pasta = pasta; }

        public PecaDeCenario Peca(string nome)
        {
            if (string.IsNullOrEmpty(nome)) return null;

            PecaDeCenario achada;
            if (_cache.TryGetValue(nome, out achada)) return achada;

            // Sem extensão: `Resources.Load` recusa o caminho com ".fbx" escrito
            // e devolve null calado.
            var go = Resources.Load<GameObject>(_pasta + "/" + nome);
            achada = go != null ? new PecaDeCenario(nome, go) : null;
            if (achada != null && achada.Vazia) achada = null;
            _cache[nome] = achada;
            return achada;
        }

        public Texture Atlas
        {
            get
            {
                if (_atlasProcurado) return _atlas;
                _atlasProcurado = true;
                _atlas = Resources.Load<Texture2D>(_pasta + "/" + NomeDoAtlas);
                return _atlas;
            }
        }
    }

    /// <summary>
    /// Fonte de teste: peças montadas à mão. Mesma forma de
    /// <see cref="ModelosDeMemoria"/>.
    /// </summary>
    public sealed class PecasDeMemoria : IFonteDePecas
    {
        readonly Dictionary<string, PecaDeCenario> _pecas = new Dictionary<string, PecaDeCenario>();

        public Texture Atlas { get; set; }

        public PecasDeMemoria Com(string nome, PecaDeCenario peca)
        {
            _pecas[nome] = peca;
            return this;
        }

        public PecaDeCenario Peca(string nome)
        {
            PecaDeCenario p;
            return nome != null && _pecas.TryGetValue(nome, out p) ? p : null;
        }
    }

    /// <summary>Fonte vazia: nada existe. É o que força a sala a desenhar em
    /// cubo, e é assim que o teste do cubo continua medindo o cubo.</summary>
    public sealed class SemPecas : IFonteDePecas
    {
        public PecaDeCenario Peca(string nome) { return null; }
        public Texture Atlas { get { return null; } }
    }
}
