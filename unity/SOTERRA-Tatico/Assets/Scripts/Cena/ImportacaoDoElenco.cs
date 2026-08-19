#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;

namespace Soterra.Cena
{
    /// <summary>
    /// Como o acervo de <c>Assets/Resources/elenco/</c> tem de ser importado.
    ///
    /// Existe em código, e não como ajuste salvo num <c>.meta</c>, porque
    /// <c>.meta</c> ajustado à mão morre no dia em que alguém reconverte o
    /// acervo: o arquivo novo chega, a Unity gera um <c>.meta</c> novo com os
    /// padrões, e o defeito volta calado. Aqui a regra é reaplicada em toda
    /// importação, para sempre.
    ///
    /// Fica em <c>Assets/Scripts/Cena/</c> sob <c>#if UNITY_EDITOR</c> e não em
    /// <c>Assets/Editor/</c> porque aquela pasta é de outro dono.
    /// </summary>
    public sealed class ImportacaoDoElenco : AssetPostprocessor
    {
        /// <summary>Só mexe no que está aqui dentro.</summary>
        public const string Pasta = "Assets/Resources/" + ModelosDeResources.Pasta + "/";

        /// <summary>
        /// Até este tamanho, a imagem é tratada como PALETA e não como textura.
        ///
        /// Os bichos do Quaternius pintam o corpo inteiro com um atlas de
        /// 32×32 pixels: cada cor do modelo é UM pixel, e a UV de uma peça
        /// inteira aponta para o meio dele. Filtrada e com mipmap — que é o
        /// padrão da Unity —, essa imagem vira a média de tudo, um cinza claro
        /// só, e a Estufa apareceu com um sapo, uma vespa e uma trepadeira
        /// brancos. 128 dá folga larga sobre os 32 reais sem chegar perto de
        /// uma textura de verdade, que aqui tem 1024.
        /// </summary>
        public const int LadoDePaleta = 128;

        void OnPreprocessTexture()
        {
            if (!assetPath.StartsWith(Pasta)) return;

            var importador = (TextureImporter)assetImporter;
            int largura, altura;
            importador.GetSourceTextureWidthAndHeight(out largura, out altura);
            if (Mathf.Max(largura, altura) > LadoDePaleta) return;

            importador.filterMode = FilterMode.Point;
            importador.mipmapEnabled = false;
            // Sem repetição: a UV que cai na borda de um atlas de paleta pega a
            // cor do outro lado da imagem, e o bicho ganha uma listra da cor
            // errada bem na silhueta.
            importador.wrapMode = TextureWrapMode.Clamp;
            // Compressão é média ponderada de blocos 4×4 — em paleta, exatamente
            // o mesmo estrago do mipmap, só que assado no arquivo.
            importador.textureCompression = TextureImporterCompression.Uncompressed;
        }
    }
}
#endif
