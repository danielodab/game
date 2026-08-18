using System.Collections.Generic;
using UnityEngine;

namespace Soterra
{
    /// <summary>
    /// A grade tática: o chão, o que é caminhável e a distância entre casas.
    ///
    /// É o mesmo modelo do jogo em JS — grade retangular, distância de Manhattan,
    /// sem diagonal — escrito aqui para você comparar as duas engenharias com a
    /// MESMA regra, e não com duas regras diferentes.
    ///
    /// Distância de Manhattan e não euclidiana porque o movimento é ortogonal:
    /// andar na diagonal custaria dois passos de qualquer jeito, então medir em
    /// linha reta mentiria sobre o custo.
    /// </summary>
    public class Tabuleiro : MonoBehaviour
    {
        public int Largura = 12;
        public int Altura = 10;
        public float Celula = 1f;

        // Casas bloqueadas: obstáculo, parede, buraco. Guardadas em conjunto e
        // não em matriz porque são poucas e a pergunta que se faz é sempre
        // "esta casa está livre?", nunca "me dê a linha inteira".
        private readonly HashSet<Vector2Int> _bloqueadas = new HashSet<Vector2Int>();

        public bool DentroDoTabuleiro(Vector2Int p)
        {
            return p.x >= 0 && p.y >= 0 && p.x < Largura && p.y < Altura;
        }

        public bool Caminhavel(Vector2Int p)
        {
            return DentroDoTabuleiro(p) && !_bloqueadas.Contains(p);
        }

        public void Bloquear(Vector2Int p) { _bloqueadas.Add(p); }
        public IEnumerable<Vector2Int> Bloqueadas { get { return _bloqueadas; } }

        public static int Manhattan(Vector2Int a, Vector2Int b)
        {
            return Mathf.Abs(a.x - b.x) + Mathf.Abs(a.y - b.y);
        }

        /// <summary>Centro da casa em coordenada de mundo.</summary>
        public Vector3 Mundo(Vector2Int p, float y = 0f)
        {
            return new Vector3((p.x - (Largura - 1) * 0.5f) * Celula,
                               y,
                               (p.y - (Altura - 1) * 0.5f) * Celula);
        }

        /// <summary>Casa correspondente a um ponto do mundo (inverso de Mundo).</summary>
        public Vector2Int DaPosicao(Vector3 w)
        {
            return new Vector2Int(
                Mathf.RoundToInt(w.x / Celula + (Largura - 1) * 0.5f),
                Mathf.RoundToInt(w.z / Celula + (Altura - 1) * 0.5f));
        }

        /// <summary>
        /// Casas alcançáveis gastando até `passos`, respeitando bloqueio.
        ///
        /// Busca em largura, não distância crua: um corredor em L custa mais do
        /// que a linha reta sugere, e é o caminho ANDÁVEL que importa. Medir por
        /// Manhattan puro deixaria o jogador clicar do outro lado da parede.
        /// </summary>
        public Dictionary<Vector2Int, int> Alcance(Vector2Int origem, int passos)
        {
            var custo = new Dictionary<Vector2Int, int> { { origem, 0 } };
            var fila = new Queue<Vector2Int>();
            fila.Enqueue(origem);

            var vizinhos = new[] { Vector2Int.up, Vector2Int.down, Vector2Int.left, Vector2Int.right };
            while (fila.Count > 0)
            {
                var atual = fila.Dequeue();
                int c = custo[atual];
                if (c >= passos) continue;
                foreach (var d in vizinhos)
                {
                    var p = atual + d;
                    if (!Caminhavel(p) || custo.ContainsKey(p)) continue;
                    custo[p] = c + 1;
                    fila.Enqueue(p);
                }
            }
            custo.Remove(origem);
            return custo;
        }
    }
}
