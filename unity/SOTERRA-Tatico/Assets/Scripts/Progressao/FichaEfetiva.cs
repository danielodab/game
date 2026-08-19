using Soterra.Dados;

namespace Soterra.Progressao
{
    /// <summary>
    /// O herói como ele entra em campo: base da classe + ganho por nível +
    /// itens (com forja) + conjuntos + bicho + estrelas de classe.
    ///
    /// Não é <c>Dados.Atributos</c> porque aquilo é o DADO lido do arquivo e
    /// esta é a CONTA — reusar o tipo faria uma ficha calculada passar por ficha
    /// de acervo em qualquer assinatura, e ninguém veria a troca. Além disso
    /// falta lá o <see cref="PoderElemental"/>, que só existe depois que o herói
    /// escolhe um caminho.
    /// </summary>
    public sealed class FichaEfetiva
    {
        public int Pv;

        /// <summary>Pontos de Ataque. Nenhuma fonte isolada soma mais de +1 aqui.</summary>
        public int Pa;

        /// <summary>Pontos de Passos. Mesmo teto de +1 do <see cref="Pa"/>.</summary>
        public int Pp;

        /// <summary>Poder genérico — vale em qualquer feitiço.</summary>
        public int Poder;

        /// <summary>
        /// Poder que só conta em feitiço do elemento escolhido. Fica em 0
        /// enquanto o herói for neutro: as subidas de nível continuam pagando
        /// poder genérico até a escolha acontecer.
        /// </summary>
        public int PoderElemental;

        public int Iniciativa;
        public int Esquiva;
        public int Fixacao;

        public string Elemento = Dados.Elemento.Neutro;
        public Resistencias Resistencias = new Resistencias();

        /// <summary>Nível do herói no momento do cálculo — a UI mostra junto com a ficha.</summary>
        public int Nivel = 1;
    }
}
