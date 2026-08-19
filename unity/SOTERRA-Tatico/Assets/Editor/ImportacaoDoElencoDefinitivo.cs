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
