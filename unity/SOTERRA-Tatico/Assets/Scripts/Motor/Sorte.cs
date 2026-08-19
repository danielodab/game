using System;

namespace Soterra.Motor
{
    /// <summary>
    /// O sorteio do combate — determinístico, semeado por texto.
    ///
    /// É o `mulberry32` do <c>js/core/engine.js</c>, bit a bit. Não é capricho de
    /// portabilidade: a mesma batalha, com as mesmas ações, tem de dar os mesmos
    /// números nos dois motores, senão nenhuma diferença entre eles é
    /// diagnosticável — toda divergência viraria "deve ser o dado".
    ///
    /// O sorteio é INJETADO na batalha em vez de global. Com o gerador global do
    /// JS, um teste que quisesse cobrar "dano mínimo do Cone de Cinzas" só podia
    /// afirmar uma faixa; com o gerador injetável, <see cref="Fixa"/> trava o
    /// sorteio no piso ou no teto e o teste cobra o NÚMERO do acervo.
    /// </summary>
    public class Sorte
    {
        uint _estado;

        public Sorte(uint semente)
        {
            _estado = semente;
        }

        /// <summary>Semente a partir de texto, pelo FNV-1a de 32 bits do JS.</summary>
        public static Sorte DeTexto(string semente)
        {
            return new Sorte(Hash(semente ?? string.Empty));
        }

        /// <summary>
        /// Sorteio travado. <c>0.0</c> devolve sempre o piso da faixa e
        /// <c>0.999…</c> sempre o teto — é assim que um teste cobra o dano exato
        /// que o acervo escreve, em vez de um intervalo que quase tudo satisfaz.
        /// </summary>
        public static Sorte Fixa(double valor)
        {
            return new SorteTravada(valor);
        }

        /// <summary>Piso da faixa em todo sorteio.</summary>
        public static Sorte SempreOMinimo { get { return Fixa(0.0); } }

        /// <summary>Teto da faixa em todo sorteio. Não é 1.0: o gerador devolve [0,1).</summary>
        public static Sorte SempreOMaximo { get { return Fixa(0.9999999); } }

        static uint Hash(string s)
        {
            unchecked
            {
                uint h = 2166136261u;
                for (int i = 0; i < s.Length; i++)
                {
                    h ^= s[i];
                    h = h * 16777619u;
                }
                return h;
            }
        }

        /// <summary>
        /// O <c>Math.imul</c> do JS: multiplicação de 32 bits COM transbordo
        /// descartado. Multiplicar em 64 bits e truncar depois daria outra
        /// sequência, e a semente deixaria de reproduzir a batalha do JS.
        /// </summary>
        static uint Imul(uint a, uint b)
        {
            unchecked { return (uint)((int)a * (int)b); }
        }

        /// <summary>Próximo sorteio em [0,1).</summary>
        public virtual double Proximo()
        {
            unchecked
            {
                _estado = _estado + 0x6D2B79F5u;
                uint t = _estado;
                t = Imul(t ^ (t >> 15), t | 1u);
                t ^= t + Imul(t ^ (t >> 7), t | 61u);
                return (t ^ (t >> 14)) / 4294967296.0;
            }
        }

        /// <summary>
        /// Inteiro em [min,max], os dois inclusive — a faixa de dano do acervo é
        /// fechada nas duas pontas (<c>min: 26, max: 33</c> tem de poder dar 33).
        /// </summary>
        public int Inteiro(int min, int max)
        {
            if (max <= min) return min;
            return min + (int)Math.Floor(Proximo() * (max - min + 1));
        }

        sealed class SorteTravada : Sorte
        {
            readonly double _valor;

            public SorteTravada(double valor) : base(0u)
            {
                _valor = valor;
            }

            public override double Proximo()
            {
                return _valor;
            }
        }
    }
}
