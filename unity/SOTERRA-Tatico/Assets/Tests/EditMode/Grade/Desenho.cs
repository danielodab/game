using System.Text;
using Soterra.Grade;

namespace Soterra.Testes.Locomocao
{
    /// <summary>
    /// Os mapas dos testes, desenhados em texto.
    ///
    /// Desenho e não matriz de inteiros de propósito: um teste de grade que
    /// falha só se explica olhando o mapa, e `"..#.."` se lê num relatório de
    /// falha — `new[]{0,0,2,0,0}` não.
    /// </summary>
    static class Desenho
    {
        public static Mapa De(params string[] linhas)
        {
            return Mapa.DeTexto(linhas);
        }

        /// <summary>Sala sem nada dentro, para medir só a geometria.</summary>
        public static Mapa Aberto(int largura, int altura)
        {
            var linhas = new string[altura];
            var sb = new StringBuilder(largura);
            for (int x = 0; x < largura; x++) sb.Append('.');
            for (int y = 0; y < altura; y++) linhas[y] = sb.ToString();
            return Mapa.DeTexto(linhas);
        }

        /// <summary>
        /// 'O Vestíbulo das Heras' — primeira sala de `greenhouse`, copiada
        /// literal de `js/core/data/dungeons.js`.
        ///
        /// Sala de verdade e não inventada: é ela que mostra que o desenho real
        /// tem SEIS nascimentos de herói e letras de monstro REPETIDAS, coisa
        /// que nenhum mapa de brinquedo de 5×3 revelaria.
        /// </summary>
        public static readonly string[] Vestibulo =
        {
            "~~~~~###########~~~~~",
            "~~~~#,.........,#~~~~",
            "~~~##===.....===##~~~",
            "~~#.##.........##.#~~",
            "~#.,..##.....##..,.#~",
            "#...=====...=====...#",
            "#.....a...#...b.....#",
            "#PP..##.......##....#",
            "#PP..............c..#",
            "#PP..##.......##....#",
            "#.....a...#...b.....#",
            "#...=====...=====...#",
            "~#.,..##.....##..,.#~",
            "~~#.##.........##.#~~",
            "~~~##===.....===##~~~",
            "~~~~#,.........,#~~~~",
            "~~~~~###########~~~~~"
        };

        public static int Contar(string[] linhas, char simbolo)
        {
            int n = 0;
            for (int i = 0; i < linhas.Length; i++)
                for (int x = 0; x < linhas[i].Length; x++)
                    if (linhas[i][x] == simbolo) n++;
            return n;
        }
    }
}
