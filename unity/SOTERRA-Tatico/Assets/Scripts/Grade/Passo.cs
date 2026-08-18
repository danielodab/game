using System.Collections.Generic;
using UnityEngine;

namespace Soterra.Grade
{
    /// <summary>Para onde a unidade consegue ANDAR.</summary>
    public static class Passo
    {
        /// <summary>
        /// As quatro direções do passo. Não há diagonal: uma casa custa 1 PP e
        /// a diagonal custaria 2, então ela não é um passo — é dois.
        /// </summary>
        static readonly Vector2Int[] Direcoes =
        {
            new Vector2Int(0, 1), new Vector2Int(0, -1),
            new Vector2Int(-1, 0), new Vector2Int(1, 0)
        };

        /// <summary>
        /// Casas alcançáveis gastando até `pp`, com o custo de cada uma.
        ///
        /// É BUSCA EM LARGURA, e não distância crua, porque o caminho é que
        /// custa — não a linha reta. Num corredor em L a casa a 2 de Manhattan
        /// pode custar 6 passos; medindo por Manhattan o jogador andaria
        /// ATRAVÉS da parede, que é o defeito clássico desta função.
        ///
        /// `ocupadas` são casas com unidade em cima: bloqueiam a passagem como
        /// parede. A ORIGEM não é conferida contra `ocupadas` de propósito —
        /// quem anda está em cima de si mesmo, e conferir faria toda unidade
        /// nascer imóvel. Espelha `bfs()`/`Engine.reachable` do
        /// `js/core/engine.js`.
        ///
        /// A origem NÃO entra no resultado (custo 0 não é destino), igual ao
        /// `Engine.reachable`, que descarta `c === 0`: pintar a casa onde a
        /// unidade já está como destino de movimento é mentira de interface.
        /// </summary>
        public static Dictionary<Vector2Int, int> Alcance(
            Mapa m, Vector2Int origem, int pp, IEnumerable<Vector2Int> ocupadas = null)
        {
            var custo = new Dictionary<Vector2Int, int>();
            if (m == null || pp <= 0) return custo;

            var barrada = new HashSet<Vector2Int>();
            if (ocupadas != null)
                foreach (var o in ocupadas) barrada.Add(o);

            var visto = new Dictionary<Vector2Int, int> { { origem, 0 } };
            var fila = new Queue<Vector2Int>();
            fila.Enqueue(origem);

            while (fila.Count > 0)
            {
                var atual = fila.Dequeue();
                int d = visto[atual];
                if (d >= pp) continue;              // acabou o PP nesta frente

                for (int i = 0; i < Direcoes.Length; i++)
                {
                    var viz = atual + Direcoes[i];
                    if (visto.ContainsKey(viz)) continue;
                    if (!m.Andavel(viz)) continue;  // parede, cobertura e buraco
                    if (barrada.Contains(viz)) continue;

                    visto[viz] = d + 1;
                    custo[viz] = d + 1;
                    fila.Enqueue(viz);
                }
            }
            return custo;
        }
    }
}
