using System.Collections.Generic;
using UnityEngine;

namespace Soterra.Grade
{
    /// <summary>
    /// O que o feitiço PEGA ao chegar. O até-onde-chega é <see cref="Alcance"/>.
    ///
    /// FEITIÇO DE ÁREA MIRA O CHÃO. Nada aqui pergunta quem está em pé onde: a
    /// casa-alvo é um LUGAR, a forma se desenha em volta dela e pega quem
    /// estiver dentro — ou ninguém. Antes disso, no JS, `targetSide:'enemy'`
    /// exigia inimigo NA PRÓPRIA casa, e aí a explosão só podia cair em cima de
    /// alguém: não dava para largá-la ENTRE dois inimigos nem chutar onde o
    /// outro VAI estar. Era meia mecânica de posicionamento jogada fora.
    /// </summary>
    public static class Area
    {
        /// <summary>
        /// As casas atingidas por um feitiço de forma `forma` e tamanho
        /// `tamanho`, lançado de `origem` sobre `alvo`.
        ///
        /// `origem` entra porque três formas dependem dela: `Line` e `Cone` se
        /// abrem no sentido OPOSTO ao conjurador. Sem a origem, o cone
        /// apontaria sempre para o mesmo lado.
        ///
        /// Espelha `Engine.aoeTiles` do `js/core/engine.js`, inclusive nos
        /// tamanhos degenerados (`Line` e `Cone` com tamanho 0 pegam 1 casa).
        /// </summary>
        public static List<Vector2Int> Casas(
            Mapa m, Vector2Int origem, Vector2Int alvo, Forma forma, int tamanho)
        {
            var saida = new List<Vector2Int>();
            if (m == null) return saida;

            switch (forma)
            {
                case Forma.Single:
                    Juntar(saida, m, alvo);
                    break;

                case Forma.Cross:
                    Juntar(saida, m, alvo);
                    for (int s = 1; s <= tamanho; s++)
                    {
                        Juntar(saida, m, new Vector2Int(alvo.x + s, alvo.y));
                        Juntar(saida, m, new Vector2Int(alvo.x - s, alvo.y));
                        Juntar(saida, m, new Vector2Int(alvo.x, alvo.y + s));
                        Juntar(saida, m, new Vector2Int(alvo.x, alvo.y - s));
                    }
                    break;

                case Forma.Circle:
                    // Disco de Manhattan, não círculo de régua: a área tem de
                    // usar a mesma métrica do alcance e do passo, senão o
                    // jogador não consegue prever de cabeça o que pega.
                    for (int dy = -tamanho; dy <= tamanho; dy++)
                        for (int dx = -tamanho; dx <= tamanho; dx++)
                            if (Mathf.Abs(dx) + Mathf.Abs(dy) <= tamanho)
                                Juntar(saida, m, new Vector2Int(alvo.x + dx, alvo.y + dy));
                    break;

                case Forma.Line:
                {
                    var f = Afastando(origem, alvo);
                    for (int i = 0; i < Mathf.Max(1, tamanho); i++)
                        Juntar(saida, m, alvo + f * i);
                    break;
                }

                case Forma.Cone:
                {
                    // Triângulo que PARTE da casa-alvo e abre no sentido oposto
                    // ao conjurador: a linha i tem 2i+1 casas, total = tamanho².
                    var f = Afastando(origem, alvo);
                    var p = new Vector2Int(-f.y, f.x);          // eixo perpendicular
                    for (int i = 0; i < Mathf.Max(1, tamanho); i++)
                        for (int k = -i; k <= i; k++)
                            Juntar(saida, m, alvo + f * i + p * k);
                    break;
                }

                case Forma.Ring:
                    // Coroa de distância Manhattan EXATAMENTE `tamanho`: o meio
                    // fica de fora, e é isso que faz o anel valer a pena
                    // largar em cima de um aliado.
                    if (tamanho <= 0) { Juntar(saida, m, alvo); break; }
                    for (int dy = -tamanho; dy <= tamanho; dy++)
                        for (int dx = -tamanho; dx <= tamanho; dx++)
                            if (Mathf.Abs(dx) + Mathf.Abs(dy) == tamanho)
                                Juntar(saida, m, new Vector2Int(alvo.x + dx, alvo.y + dy));
                    break;
            }
            return saida;
        }

        /// <summary>
        /// Acrescenta a casa se ela existe e não é obstáculo ALTO.
        ///
        /// Só o alto corta a área — cobertura (`=`) e buraco (`~`) entram. Não é
        /// descuido: a explosão passa por cima do murinho e cai no buraco, e o
        /// alcance da área tem de bater com o que o jogador vê. É o mesmo
        /// `type !== 'wall'` do `Engine.aoeTiles`.
        /// </summary>
        static void Juntar(List<Vector2Int> saida, Mapa m, Vector2Int p)
        {
            if (m.Dentro(p) && m.Em(p) != Casa.ObstaculoAlto) saida.Add(p);
        }

        /// <summary>
        /// A direção em que a forma se abre: do conjurador para o alvo,
        /// travada no eixo dominante — não há forma na diagonal.
        ///
        /// Conjurar EM CIMA de si mesmo não tem eixo dominante nenhum; nesse
        /// caso vai para +X, que é o que o JS faz. Devolver o vetor zero faria
        /// a linha inteira empilhar na mesma casa.
        /// </summary>
        static Vector2Int Afastando(Vector2Int origem, Vector2Int alvo)
        {
            int dx = alvo.x - origem.x, dy = alvo.y - origem.y;
            if (Mathf.Abs(dx) >= Mathf.Abs(dy))
                return new Vector2Int(dx == 0 ? 1 : (dx > 0 ? 1 : -1), 0);
            return new Vector2Int(0, dy > 0 ? 1 : -1);
        }
    }
}
