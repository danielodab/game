using UnityEngine;

namespace Soterra.Grade
{
    /// <summary>Como se mede distância neste tabuleiro.</summary>
    public static class Distancia
    {
        /// <summary>
        /// Soma das diferenças em X e Y — sem diagonal.
        ///
        /// Não é capricho de fórmula: andar na diagonal custa DOIS passos nesta
        /// grade (o passo é ortogonal). Medir em linha reta faria o alcance do
        /// feitiço discordar do alcance do passo, e o jogador veria uma casa
        /// pintada como "a 3 de distância" que custa 4 para alcançar.
        ///
        /// Espelha `manhattan()` de `js/core/engine.js`.
        /// </summary>
        public static int Manhattan(Vector2Int a, Vector2Int b)
        {
            return Mathf.Abs(b.x - a.x) + Mathf.Abs(b.y - a.y);
        }
    }
}
