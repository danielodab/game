using System.Collections.Generic;

namespace Soterra.Jogo
{
    // Ver a nota em Partida.cs: os apelidos globais evitam o CS0234 dos
    // namespaces irmãos (`Motor`, `Batalha`, `Cena` dentro de testes).
    using Motor = global::Soterra.Motor;
    using Dados = global::Soterra.Dados;
    using Cena = global::Soterra.Cena;

    /// <summary>
    /// Traduz o estado do motor para as fichas que o <see cref="Cena.Elenco"/>
    /// desenha. É a costura da lacuna conhecida da VALIDACAO_UNITY §2: quem
    /// nasce no MEIO da batalha (<c>summon</c>, <c>split</c>) entra na lista do
    /// motor e ninguém instanciava o modelo.
    ///
    /// A costura é por ESPELHO, não por evento: a cada mudança, a lista
    /// inteira de <c>Batalha.Unidades</c> vira fichas e o
    /// <c>Elenco.Sincronizar</c> — que já cria quem entrou, move quem andou e
    /// tira quem saiu — faz o resto. Reagir evento a evento (um Invocacao cria,
    /// um Morte destrói) seria uma segunda contabilidade da mesma verdade, e
    /// duas contabilidades divergem na primeira jogada que alguém esquecer de
    /// tratar; o espelho não tem como esquecer ninguém.
    /// </summary>
    public static class Fichas
    {
        /// <summary>
        /// Uma ficha por unidade da batalha, na ordem de nascimento. Os mortos
        /// e os levados pela fusão VÃO na lista — com <c>NoTabuleiro</c> falso —
        /// porque é vendo-os que o <c>Sincronizar</c> sabe quem remover da cena.
        /// </summary>
        public static List<Cena.FichaDeUnidade> De(Motor.Batalha batalha, Dados.BancoDeDados banco)
        {
            var saida = new List<Cena.FichaDeUnidade>();
            if (batalha == null) return saida;

            for (int i = 0; i < batalha.Unidades.Count; i++)
            {
                var u = batalha.Unidades[i];
                if (u == null) continue;
                saida.Add(new Cena.FichaDeUnidade
                {
                    Uid = u.Uid,
                    Id = u.ClasseOuMonstroId,
                    Heroi = u.Lado == Motor.Lado.Heroi,
                    Casa = u.Casa,
                    Viva = u.Viva,
                    ForaDoTabuleiro = u.ForaDoTabuleiro,
                    Altura = AlturaDe(banco, u.ClasseOuMonstroId)
                });
            }
            return saida;
        }

        /// <summary>
        /// A altura que a FICHA manda, quando manda: só o chefe. O contrato de
        /// entrega mede o chefe numa faixa (5,16–5,46 m) sem fixar por id, então
        /// a tabela do Elenco não tem como saber — quem monta a batalha avisa.
        /// Zero para todo o resto quer dizer "usa a tabela do Elenco".
        /// </summary>
        public static float AlturaDe(Dados.BancoDeDados banco, string id)
        {
            if (banco == null || banco.Monstros == null || string.IsNullOrEmpty(id)) return 0f;
            Dados.Monstro m;
            if (banco.Monstros.TryGetValue(id, out m) && m != null && m.Chefe)
                return Cena.Elenco.AlturaDeChefe;
            return 0f;
        }
    }
}
