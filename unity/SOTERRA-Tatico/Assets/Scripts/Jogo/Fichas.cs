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
        /// A altura que a FICHA manda, quando manda: o chefe e a FUNDIDA. O
        /// contrato de entrega mede o chefe numa faixa (5,16–5,46 m) sem fixar
        /// por id, então a tabela do Elenco não tem como saber — quem monta a
        /// batalha avisa. Zero para todo o resto quer dizer "usa a tabela".
        /// </summary>
        public static float AlturaDe(Dados.BancoDeDados banco, string id)
        {
            // A FUNDIDA: o id dela é o da dupla (`bruxo+sumo`), que não está em
            // tabela nenhuma — sem esta linha ela cairia no 1,80 m do monstro
            // comum e a fusão ENCOLHERIA na tela (o Bárbaro tem 2,30). O
            // CONTRATO_ENTREGA_PERSONAGEM §5 põe o modelo definitivo entre o
            // pai mais alto e ~4,76 m; a cápsula fica no PISO dessa faixa — o
            // pai mais alto — porque qualquer coisa acima seria um número
            // inventado, e o piso já garante que fundir nunca apequena ninguém.
            float fusao = AlturaDeFusao(id);
            if (fusao > 0f) return fusao;

            if (banco == null || banco.Monstros == null || string.IsNullOrEmpty(id)) return 0f;
            Dados.Monstro m;
            if (banco.Monstros.TryGetValue(id, out m) && m != null && m.Chefe)
                return Cena.Elenco.AlturaDeChefe;
            return 0f;
        }

        /// <summary>A altura de um id de dupla (<c>classe+classe</c>), ou zero
        /// se o id não é uma dupla de classes conhecidas.</summary>
        public static float AlturaDeFusao(string id)
        {
            if (string.IsNullOrEmpty(id)) return 0f;
            int corte = id.IndexOf('+');
            if (corte <= 0 || corte >= id.Length - 1) return 0f;

            float a = Cena.Elenco.AlturaDaClasse(id.Substring(0, corte));
            float b = Cena.Elenco.AlturaDaClasse(id.Substring(corte + 1));

            // As DUAS metades têm de ser classe: um `+` num id qualquer do
            // bestiário não pode virar altura de herói por acidente.
            return a > 0f && b > 0f ? System.Math.Max(a, b) : 0f;
        }
    }
}
