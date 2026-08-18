using System.Collections.Generic;
using UnityEngine;

namespace Soterra.Grade
{
    /// <summary>
    /// Até onde o feitiço CHEGA. Não é o que ele pega — isso é
    /// <see cref="Area"/>. Separar as duas coisas é o que permite um feitiço de
    /// alcance 8 com explosão de raio 1, e é como os dados em
    /// `js/core/data/spells.js` já descrevem todo feitiço (`range` e `aoe`).
    ///
    /// Este tipo é só GEOMETRIA: distância, linha reta e visão. Ele não sabe
    /// quem está em pé onde, e é de propósito — quem exige criatura na casa é a
    /// camada de combate, e só para o feitiço de alvo único.
    /// </summary>
    public struct Alcance
    {
        public int Min, Max;

        /// <summary>Só na mesma linha ou na mesma coluna do conjurador.</summary>
        public bool Linha;

        /// <summary>Precisa de linha de visão livre até o alvo.</summary>
        public bool Visao;

        public Alcance(int min, int max, bool linha = false, bool visao = false)
        {
            Min = min; Max = max; Linha = linha; Visao = visao;
        }

        /// <summary>
        /// O alcance de quem não declarou alcance: a casa e as quatro vizinhas.
        ///
        /// Existe porque `default(Alcance)` dá Max = 0 — corpo a corpo que só
        /// acerta a própria casa —, enquanto o `sRange()` do
        /// `js/core/engine.js` assume `{min:0, max:1}` quando o feitiço não traz
        /// `range`. Sem este atalho a diferença passaria despercebida.
        /// </summary>
        public static Alcance Padrao { get { return new Alcance(0, 1); } }

        /// <summary>
        /// A casa-alvo está no alcance?
        ///
        /// Exige chão andável (`.` ou `,`): não se mira dentro de parede, de
        /// cobertura nem de buraco. Espelha a parte de ALCANCE do
        /// `validTargetCell` do `js/core/engine.js` — o resto daquela função
        /// (lado do alvo, casa vazia, troca de lugar) é da camada de combate e
        /// não desce até a grade.
        /// </summary>
        public bool Valido(Mapa m, Vector2Int origem, Vector2Int alvo)
        {
            if (m == null || !m.Andavel(alvo)) return false;

            int d = Distancia.Manhattan(origem, alvo);
            if (d < Min || d > Max) return false;

            if (Linha && !(alvo.x == origem.x || alvo.y == origem.y)) return false;

            // Qualificado até o namespace porque o campo `Visao` desta struct
            // esconde a classe `Visao` na busca de nomes aqui dentro.
            if (Visao && !Soterra.Grade.Visao.Livre(m, origem, alvo)) return false;

            return true;
        }

        /// <summary>
        /// Todas as casas que o feitiço alcança a partir de `origem`.
        ///
        /// Devolve o alcance INTEIRO, com ou sem alvo em pé nele. É o que o
        /// tabuleiro pinta quando o jogador escolhe o feitiço: mostrar só as
        /// casas com inimigo faria um ataque corpo a corpo sem ninguém ao lado
        /// não pintar NADA, e o jogador leria isso como botão quebrado — foi o
        /// relato de playtest que criou o `Engine.spellRange` no JS.
        /// </summary>
        public IEnumerable<Vector2Int> Casas(Mapa m, Vector2Int origem)
        {
            var saida = new List<Vector2Int>();
            if (m == null) return saida;

            // Varre o tabuleiro inteiro em vez da caixa [origem ± Max]: a sala
            // maior tem 27×23 e a diferença não se mede, mas a caixa erra
            // silenciosamente quando alguém mexer em Min/Max.
            for (int y = 0; y < m.Altura; y++)
                for (int x = 0; x < m.Largura; x++)
                {
                    var p = new Vector2Int(x, y);
                    if (Valido(m, origem, p)) saida.Add(p);
                }
            return saida;
        }
    }
}
