using UnityEngine;

namespace Soterra.Cena
{
    /// <summary>Os quatro lados de uma casa, em bits. <c>Norte</c> é y−1, que o
    /// palco desenha em −Z (ver <c>Palco.Local</c>).</summary>
    [System.Flags]
    public enum Lados
    {
        Nenhum = 0,
        Norte = 1,   // −Z
        Leste = 2,   // +X
        Sul = 4,     // +Z
        Oeste = 8,   // −X
        Todos = 15
    }

    /// <summary>
    /// A escolha da peça de parede pela vizinhança — o auto-tiling.
    ///
    /// A regra é a de <c>js/render3d/models3d.js</c> (<c>M.buildWall</c>), que
    /// já rodava no jogo: quatro vizinhos viram cruz, três viram T, dois opostos
    /// viram reta, dois adjacentes viram quina, um vira meia-parede com poste, e
    /// nenhum vira coluna solta.
    ///
    /// O que MUDA aqui em relação ao JS é de onde sai o GIRO. Lá ele é uma
    /// tabela escrita à mão (<c>if (w &amp;&amp; s) ry = 0; else if …</c>), que só
    /// está certa enquanto a peça chegar na orientação que o autor viu no
    /// three.js. O nosso kit atravessa glTF → Blender → FBX → Unity, e cada
    /// etapa dessa ponte já trocou eixo de sinal em projeto alheio. Então o giro
    /// é MEDIDO: pergunta-se à malha para que lados ela estende braço, e procura-se
    /// o quarto de volta que faz esses braços coincidirem com os vizinhos. Se um
    /// dia a ponte espelhar o X, a sala continua fechando sozinha.
    /// </summary>
    public static class AutoParede
    {
        /// <summary>
        /// Fração de casa que um braço precisa avançar para contar como braço.
        ///
        /// Medido no kit já importado (ver <see cref="MedidaDoKit"/>): braço de
        /// verdade avança 0,50 de casa; a peça mais gorda que NÃO tem braço é a
        /// coluna lavrada, com 0,279. Trinta centésimos cai no meio dessa folga.
        /// </summary>
        public const float LimiarDeBraco = 0.30f;

        /// <summary>
        /// Para que lados esta peça estende braço, medindo a caixa dela já
        /// NORMALIZADA (uma casa = 1). Coluna não estende nenhum, parede reta
        /// estende dois opostos, cruz estende os quatro.
        /// </summary>
        public static Lados BracosDe(Bounds caixaEmCasas)
        {
            var lados = Lados.Nenhum;
            if (caixaEmCasas.min.z < -LimiarDeBraco) lados |= Lados.Norte;
            if (caixaEmCasas.max.x > LimiarDeBraco) lados |= Lados.Leste;
            if (caixaEmCasas.max.z > LimiarDeBraco) lados |= Lados.Sul;
            if (caixaEmCasas.min.x < -LimiarDeBraco) lados |= Lados.Oeste;
            return lados;
        }

        /// <summary>
        /// Gira um conjunto de lados em quartos de volta, no mesmo sentido do
        /// <c>Transform.localRotation</c> da Unity: +90° em Y leva +Z para +X,
        /// ou seja Sul→Leste→Norte→Oeste→Sul.
        /// </summary>
        public static Lados Girar(Lados lados, int quartos)
        {
            quartos = ((quartos % 4) + 4) % 4;
            for (int i = 0; i < quartos; i++)
            {
                var saida = Lados.Nenhum;
                if ((lados & Lados.Sul) != 0) saida |= Lados.Leste;
                if ((lados & Lados.Leste) != 0) saida |= Lados.Norte;
                if ((lados & Lados.Norte) != 0) saida |= Lados.Oeste;
                if ((lados & Lados.Oeste) != 0) saida |= Lados.Sul;
                lados = saida;
            }
            return lados;
        }

        /// <summary>Quantos lados estão marcados.</summary>
        public static int Conta(Lados lados)
        {
            int n = 0;
            for (int b = 1; b <= 8; b <<= 1) if (((int)lados & b) != 0) n++;
            return n;
        }

        /// <summary>
        /// O quarto de volta que faz os braços da peça caírem sobre os vizinhos,
        /// ou <c>-1</c> se nenhum cai. −1 não é acidente a esconder: quem chama
        /// tem de saber que pegou a peça errada, senão a parede fecha torta e
        /// ninguém descobre por que.
        /// </summary>
        public static int QuartosPara(Lados bracosDaPeca, Lados vizinhos)
        {
            for (int q = 0; q < 4; q++)
                if (Girar(bracosDaPeca, q) == vizinhos) return q;
            return -1;
        }

        /// <summary>
        /// Para que lado a peça se PROJETA — o lado do centro da caixa, e não o
        /// dos braços. É como se descobre para onde a tocha de parede aponta:
        /// ela é pequena demais para o limiar de braço a enxergar, mas a caixa
        /// dela é toda de um lado só do eixo.
        /// </summary>
        public static Lados Saliencia(Bounds caixa)
        {
            if (Mathf.Abs(caixa.center.x) >= Mathf.Abs(caixa.center.z))
                return caixa.center.x >= 0f ? Lados.Leste : Lados.Oeste;
            return caixa.center.z >= 0f ? Lados.Sul : Lados.Norte;
        }

        /// <summary>
        /// Dois lados opostos — o caso "parede reta". Vale a pena ter nome
        /// porque é o único caso de dois vizinhos que NÃO é quina, e trocar os
        /// dois faz a sala inteira virar zigue-zague.
        /// </summary>
        public static bool Reta(Lados lados)
        {
            return lados == (Lados.Leste | Lados.Oeste) || lados == (Lados.Norte | Lados.Sul);
        }
    }
}
