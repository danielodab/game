namespace Soterra.Motor
{
    /// <summary>
    /// Quem odeia quem, e o que essa inimizade vale em número.
    ///
    /// O PAR sai de <c>DATA.rivals</c> (<c>Assets/Resources/dados/rivals.json</c>)
    /// e nunca de memória: fogo↔água, terra↔ar, e o neutro sem rival nenhum.
    /// Escrever a tabela em C# criaria uma segunda verdade — e quando o acervo
    /// mudasse, o motor continuaria brigando pelo par antigo, calado.
    ///
    /// Os três NÚMEROS são de <c>elementalDodgeBonus</c>, em
    /// <c>js/core/engine.js</c>. Eles ficam aqui, e não no cálculo da esquiva,
    /// porque são a única coisa que a rivalidade elemental faz mexer no combate:
    /// fugir de quem é o seu rival é mais fácil do que fugir de um estranho, e
    /// fugir de alguém do seu próprio elemento não tem vantagem nenhuma.
    /// </summary>
    public static class Rivalidade
    {
        /// <summary>Fugindo do PRÓPRIO rival: o elemento contrário não segura bem.</summary>
        public const double BonusContraORival = 0.30;

        /// <summary>Elementos sem relação — inclui todo caso que envolve o neutro.</summary>
        public const double BonusSemRelacao = 0.10;

        /// <summary>Mesmo elemento: nenhum dos dois leva jeito com o outro.</summary>
        public const double BonusMesmoElemento = 0.0;

        /// <summary>
        /// O rival de um elemento, ou <c>null</c> quando ele não tem — que é o
        /// caso do neutro, e é por isso que o retorno é texto e não um enum com
        /// um valor "nenhum" inventado.
        /// </summary>
        public static string De(Dados.BancoDeDados banco, string elemento)
        {
            if (banco == null || banco.Rivais == null || string.IsNullOrEmpty(elemento)) return null;
            string rival;
            return banco.Rivais.TryGetValue(elemento, out rival) ? rival : null;
        }

        /// <summary>
        /// A rivalidade é simétrica no acervo, mas isto pergunta só de um lado —
        /// "b é o rival de a?" — porque é assim que o bônus de esquiva a usa:
        /// quem foge é que ganha vantagem sobre o próprio rival.
        /// </summary>
        public static bool EhRivalDe(Dados.BancoDeDados banco, string a, string b)
        {
            var r = De(banco, a);
            return r != null && r == b;
        }

        /// <summary>
        /// Quanto a diferença de elemento acrescenta à chance de escapar de quem
        /// prendeu. Espelha <c>elementalDodgeBonus</c> do <c>engine.js</c>.
        /// </summary>
        public static double BonusDeEsquiva(Dados.BancoDeDados banco, string fugitivo, string fixador)
        {
            if (string.IsNullOrEmpty(fugitivo)) fugitivo = Dados.Elemento.Neutro;
            if (string.IsNullOrEmpty(fixador)) fixador = Dados.Elemento.Neutro;

            if (fugitivo == fixador) return BonusMesmoElemento;
            if (EhRivalDe(banco, fugitivo, fixador)) return BonusContraORival;
            return BonusSemRelacao;
        }
    }
}
