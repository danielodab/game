using UnityEditor;
using UnityEngine;

namespace Soterra.Ferramentas
{
    /// <summary>
    /// Como o ELENCO DEFINITIVO — os FBX por id em
    /// <c>Assets/Resources/elenco/&lt;id&gt;/</c> — tem de ser importado
    /// (CONTRATO_ENTREGA_PERSONAGEM §1 e §6).
    ///
    /// Só as SUBPASTAS de <c>elenco/</c>: os arquivos soltos na raiz são o
    /// acervo CC0 (KayKit/Quaternius), com <c>.meta</c> já calibrado e conversor
    /// próprio — aplicar esta regra a eles reimportaria o acervo inteiro sob uma
    /// convenção que não foi pensada para ele, e o defeito só apareceria na foto.
    ///
    /// Em código, e não em <c>.meta</c> ajustado à mão, pelo mesmo motivo de
    /// <c>ImportacaoDoElenco</c>: o personagem vai ser REENTREGUE (o idle do
    /// bruxo já foi trocado uma vez), o arquivo novo chega, a Unity gera um
    /// <c>.meta</c> padrão e o ajuste manual morre calado. Aqui a regra volta a
    /// valer em toda importação, para os 20 personagens que ainda vêm.
    /// </summary>
    public sealed class ImportacaoDoElencoDefinitivo : AssetPostprocessor
    {
        /// <summary>Raiz do elenco em Assets. A regra vale um nível ABAIXO dela.</summary>
        public const string Raiz = "Assets/Resources/elenco/";

        /// <summary>Versão da REGRA de importação. Sem ela, mudar este arquivo
        /// não reimporta nada: a Unity só reprocessa um asset quando o número
        /// muda, e o ajuste novo ficaria esperando uma reentrega por acaso.</summary>
        public override uint GetVersion() { return 3; }

        static bool DoElencoDefinitivo(string caminho)
        {
            if (!caminho.StartsWith(Raiz)) return false;
            // Tem de haver mais uma barra depois da raiz: elenco/<id>/arquivo.
            // O que está NA raiz é o acervo antigo e fica como está.
            return caminho.IndexOf('/', Raiz.Length) >= 0;
        }

        void OnPreprocessModel()
        {
            if (!DoElencoDefinitivo(assetPath)) return;
            var importador = (ModelImporter)assetImporter;

            // Generic, e não Humanoid: o esqueleto do Meshy tem 24 ossos e os
            // clipes chegam FEITOS para ele — não há retarget a fazer, e o
            // Humanoid cobraria o preço do remapeamento por quadro à toa.
            importador.animationType = ModelImporterAnimationType.Generic;
            importador.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
            importador.importAnimation = true;
        }

        /// <summary>
        /// Dois remendos medidos no PILOTO (o bruxo), que valem para a série:
        ///
        /// 1. A Unity IGNOROU a textura embutida do FBX do Blender — o material
        ///    importa com <c>_BaseMap</c> nulo e o personagem rende branco
        ///    chapado. A textura entra pelo caminho que o contrato §2 já previa
        ///    ("ao lado, com o mesmo nome"): um <c>&lt;nome&gt;_texture.png</c>
        ///    na pasta do id é ligado a todo material que veio sem mapa.
        ///
        /// 2. O FBX trouxe um PEDESTAL (um Icosphere de cena do Meshy) como
        ///    filho direto da raiz. Ele rende como uma pedra de uma célula
        ///    colada no personagem. Sai na importação: peça ESTÁTICA pendurada
        ///    DIRETO na raiz de um modelo com pele não é arma (arma vem presa à
        ///    MÃO, fundo da hierarquia de ossos — contrato §4) nem corpo; é
        ///    resto de cena.
        /// </summary>
        void OnPostprocessModel(GameObject raiz)
        {
            if (!DoElencoDefinitivo(assetPath)) return;

            var peles = raiz.GetComponentsInChildren<SkinnedMeshRenderer>(true);
            if (peles.Length > 0) RemoverPedestais(raiz);

            LigarTexturaAoLado(raiz);
        }

        void RemoverPedestais(GameObject raiz)
        {
            var soltas = raiz.GetComponentsInChildren<MeshRenderer>(true);
            for (int i = 0; i < soltas.Length; i++)
            {
                var go = soltas[i].gameObject;
                if (go.transform.parent != raiz.transform) continue;
                Debug.Log("[SOTERRA] " + assetPath + ": removido a peça estática '" + go.name +
                          "' da raiz — pedestal/resto de cena não é parte do personagem.");
                UnityEngine.Object.DestroyImmediate(go);
            }
        }

        void LigarTexturaAoLado(GameObject raiz)
        {
            int corte = assetPath.LastIndexOf('/');
            var pasta = assetPath.Substring(0, corte);
            var nome = System.IO.Path.GetFileNameWithoutExtension(assetPath);
            var caminhoDaTextura = pasta + "/" + nome + "_texture.png";

            var textura = AssetDatabase.LoadAssetAtPath<Texture2D>(caminhoDaTextura);
            if (textura == null) return;

            // Reimportar o modelo quando a textura mudar — sem isto, trocar o
            // PNG deixaria o material apontando para a versão velha até alguém
            // reimportar na mão.
            context.DependsOnArtifact(caminhoDaTextura);

            foreach (var r in raiz.GetComponentsInChildren<Renderer>(true))
                foreach (var m in r.sharedMaterials)
                {
                    if (m == null) continue;
                    if (m.HasProperty("_BaseMap") && m.GetTexture("_BaseMap") == null)
                        m.SetTexture("_BaseMap", textura);
                    if (m.HasProperty("_MainTex") && m.GetTexture("_MainTex") == null)
                        m.SetTexture("_MainTex", textura);
                    ApagarEmissaoChapada(m);
                }
        }

        /// <summary>
        /// Terceiro remendo medido no piloto: o material do Blender chegou com
        /// <c>_EMISSION</c> LIGADO, cor branca e SEM mapa — emissão branca
        /// chapada SOMADA por cima da textura, e o personagem rende como um
        /// fantasma sem um pixel de sombra. Emissão de verdade vem com mapa ou
        /// com cor própria; branco puro sem mapa é lixo de exportação e sai.
        /// </summary>
        static void ApagarEmissaoChapada(Material m)
        {
            if (!m.IsKeywordEnabled("_EMISSION")) return;
            if (m.HasProperty("_EmissionMap") && m.GetTexture("_EmissionMap") != null) return;

            var cor = m.HasProperty("_EmissionColor") ? m.GetColor("_EmissionColor") : Color.black;
            // Só o caso patológico (perto do branco): uma cor saturada pode ser
            // brilho de olho ou runa que algum modelo futuro queira de verdade.
            if (cor.maxColorComponent < 0.9f || cor.maxColorComponent - Mathf.Min(cor.r, Mathf.Min(cor.g, cor.b)) > 0.1f)
                return;

            m.SetColor("_EmissionColor", Color.black);
            m.DisableKeyword("_EMISSION");
        }

        void OnPreprocessAnimation()
        {
            if (!DoElencoDefinitivo(assetPath)) return;
            var importador = (ModelImporter)assetImporter;

            // Um clipe por take, com o NOME do take — que é o nome do contrato
            // §1 — e o laço da tabela de lá. `defaultClipAnimations` pode vir
            // vazio na primeira importação (a Unity ainda não leu os takes);
            // nesse caso quem garante o laço é o OnPostprocessAnimation abaixo,
            // e esta lista entra no .meta na importação seguinte.
            var clipes = importador.defaultClipAnimations;
            if (clipes == null || clipes.Length == 0) return;

            for (int i = 0; i < clipes.Length; i++)
                clipes[i].loopTime = DaLaco(clipes[i].name);
            importador.clipAnimations = clipes;
        }

        /// <summary>
        /// A rede que não depende do momento da importação: ajusta o laço no
        /// PRÓPRIO clipe importado, take a take. Sem ela, a primeira importação
        /// de um FBX recém-entregue sairia com todos os clipes sem laço — e o
        /// idle congelaria no último quadro no primeiro Play de quem testasse.
        ///
        /// O `death` fica SEM laço de propósito, e é assim que ele "termina
        /// caído": clipe que não repete segura a pose final, e o estado dele no
        /// controlador não tem transição de saída.
        /// </summary>
        void OnPostprocessAnimation(GameObject raiz, AnimationClip clipe)
        {
            if (!DoElencoDefinitivo(assetPath)) return;

            var ajustes = AnimationUtility.GetAnimationClipSettings(clipe);
            bool laco = DaLaco(clipe.name);
            if (ajustes.loopTime == laco) return;
            ajustes.loopTime = laco;
            AnimationUtility.SetAnimationClipSettings(clipe, ajustes);
        }

        /// <summary>A tabela do contrato §1: idle, walk e run repetem; attack,
        /// hit e death tocam uma vez.</summary>
        public static bool DaLaco(string nomeDoClipe)
        {
            var laco = global::Soterra.Cena.Elenco.ClipesEmLaco;
            for (int i = 0; i < laco.Count; i++)
                if (laco[i] == nomeDoClipe) return true;
            return false;
        }
    }
}
