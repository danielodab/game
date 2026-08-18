using UnityEngine;

namespace Soterra.Grade
{
    /// <summary>Linha de visão entre duas casas.</summary>
    public static class Visao
    {
        /// <summary>
        /// Verdadeiro se nada ALTO está estritamente entre `a` e `b`.
        ///
        /// Três decisões que este método carrega, todas defeitos conhecidos:
        ///
        /// 1. Só `#` (<see cref="Casa.ObstaculoAlto"/>) corta a linha. `=` é
        ///    cobertura: você continua visível atrás dele, e é exatamente isso
        ///    que faz posicionamento importar. Bloquear os dois igual apagaria
        ///    a diferença entre os dois obstáculos e o tabuleiro viraria um
        ///    labirinto sem tática.
        ///
        /// 2. As PONTAS não contam. Quem conjura pode estar em cima de um
        ///    evento de terreno, e o alvo pode estar numa casa que só ele
        ///    ocupa; exigir que as pontas fossem livres faria toda unidade
        ///    perder visão de si mesma quando um dia alguém pisar num tile
        ///    alto por empurrão.
        ///
        /// 3. Bresenham inteiro, o MESMO do `Engine.los` em
        ///    `js/core/engine.js` — inclusive o passo diagonal quando as duas
        ///    condições valem no mesmo laço. Reescrever "mais bonito" mudaria
        ///    quais casas a reta visita nos empates, e aí o mesmo tiro que
        ///    acerta no JS erra na Unity.
        /// </summary>
        public static bool Livre(Mapa m, Vector2Int a, Vector2Int b)
        {
            int dx = Mathf.Abs(b.x - a.x), sx = a.x < b.x ? 1 : -1;
            int dy = -Mathf.Abs(b.y - a.y), sy = a.y < b.y ? 1 : -1;
            int err = dx + dy;
            int x = a.x, y = a.y;

            for (;;)
            {
                bool ponta = (x == a.x && y == a.y) || (x == b.x && y == b.y);
                if (!ponta && m.BloqueiaVisao(new Vector2Int(x, y))) return false;
                if (x == b.x && y == b.y) break;

                int e2 = 2 * err;
                if (e2 >= dy) { err += dy; x += sx; }
                if (e2 <= dx) { err += dx; y += sy; }
            }
            return true;
        }
    }
}
