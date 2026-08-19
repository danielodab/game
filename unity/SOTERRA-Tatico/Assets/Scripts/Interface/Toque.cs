using UnityEngine.UIElements;

namespace Soterra.Interface
{
    /// <summary>
    /// O vocabulário de toque da interface.
    ///
    /// Existe como um lugar só porque o piso de 44 pontos não é uma opinião de
    /// estilo: é a diferença entre o jogador acertar o feitiço e culpar o jogo.
    /// Espalhado por vinte chamadas de <c>AddToClassList("alvo")</c> ele some no
    /// primeiro elemento novo que alguém acrescentar com pressa — concentrado
    /// aqui, o teste consegue percorrer a árvore inteira e cobrar peça por peça.
    ///
    /// O NÚMERO em pixels mora no USS (<c>.alvo</c>), não aqui. Aqui mora a
    /// EXIGÊNCIA. <c>ToqueTests</c> lê a folha de estilo de verdade e confere
    /// que o que ela declara não desce abaixo deste mínimo — assim a folha
    /// continua sendo a única fonte do tamanho, e mesmo assim ninguém consegue
    /// baixá-lo sem quebrar teste.
    /// </summary>
    public static class Toque
    {
        /// <summary>
        /// Piso do alvo de dedo, em pontos. 44 é a medida das duas guias de
        /// celular (iOS 44 pt, Android 48 dp) e é o que o hud.js já cobrava na
        /// linha JS. Com o painel em <c>ConstantPhysicalSize</c> e
        /// <c>referenceDpi = 160</c>, 1 px de USS é 1 ponto: 44 px ≈ 7 mm.
        /// </summary>
        public const float MinimoEmPontos = 44f;

        /// <summary>Classe USS que carrega o mínimo. Todo elemento tocável tem.</summary>
        public const string ClasseDeAlvo = "alvo";

        /// <summary>
        /// Marca o elemento como alvo de dedo e devolve o próprio elemento, para
        /// encadear na construção.
        /// </summary>
        public static T Alvo<T>(T elemento) where T : VisualElement
        {
            if (elemento != null) elemento.AddToClassList(ClasseDeAlvo);
            return elemento;
        }

        /// <summary>Se o elemento está marcado como alvo de dedo.</summary>
        public static bool EhAlvo(VisualElement elemento)
        {
            return elemento != null && elemento.ClassListContains(ClasseDeAlvo);
        }
    }
}
