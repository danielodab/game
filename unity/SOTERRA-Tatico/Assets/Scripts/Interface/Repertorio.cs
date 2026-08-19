using System.Collections.Generic;
using Soterra.Dados;

namespace Soterra.Interface
{
    /// <summary>
    /// Quais feitiços entram na barra de uma unidade.
    ///
    /// Mora na Interface e não no Motor porque isto é uma pergunta de TELA
    /// ("o que o jogador vê para tocar"), não de regra: o motor decide se um
    /// lançamento é válido, a barra decide o que aparece. As duas perguntas
    /// ficaram juntas no hud.js e foi por isso que a unidade fundida saía com
    /// id cru na tela — a barra lia uma tabela e o motor lia cinco.
    ///
    /// Nenhum número aqui: a lista de neutros, os caminhos elementais e o nível
    /// de cada degrau saem todos do acervo. Uma escada cravada em código
    /// ("5, 10, 12, 15, 20, 30") ficaria com buraco no dia em que a escada
    /// mudasse — que é exatamente o que já aconteceu uma vez (SISTEMAS §9).
    /// </summary>
    public static class Repertorio
    {
        /// <summary>
        /// A barra da unidade, por id de classe OU de monstro — que é como o
        /// motor identifica quem está jogando (<c>ClasseOuMonstroId</c>).
        ///
        /// Classe: os 3 neutros mais o caminho de <paramref name="elemento"/>,
        /// cortado no <paramref name="nivel"/>. Monstro: a lista dele, inteira.
        /// Id desconhecido devolve lista vazia em vez de estourar: unidade nova
        /// no acervo não pode derrubar a tela no meio de um turno.
        /// </summary>
        public static List<Feitico> De(BancoDeDados banco, string idDeClasseOuMonstro,
                                       string elemento, int nivel)
        {
            var saida = new List<Feitico>();
            if (banco == null || string.IsNullOrEmpty(idDeClasseOuMonstro)) return saida;

            Classe classe;
            if (banco.Classes.TryGetValue(idDeClasseOuMonstro, out classe) && classe != null)
            {
                Acrescenta(banco, saida, classe.FeiticosBase, nivel);

                // Caminho só existe depois da escolha do elemento (nível 5). Antes
                // disso `Elemento` é "neutro" ou vazio, e a chave não está em
                // `paths` — procurar assim mesmo devolveria vazio calado, que é o
                // comportamento certo, mas o `TryGetValue` deixa isso explícito.
                List<string> caminho;
                if (!string.IsNullOrEmpty(elemento) && classe.Caminhos != null &&
                    classe.Caminhos.TryGetValue(elemento, out caminho))
                {
                    Acrescenta(banco, saida, caminho, nivel);
                }
                return saida;
            }

            Monstro monstro;
            if (banco.Monstros.TryGetValue(idDeClasseOuMonstro, out monstro) && monstro != null)
            {
                // Monstro não tem escada de nível: o acervo já entrega a lista
                // dele pronta e escalada pela profundidade do calabouço.
                Acrescenta(banco, saida, monstro.Feiticos, int.MaxValue);
            }
            return saida;
        }

        static void Acrescenta(BancoDeDados banco, List<Feitico> saida,
                               IList<string> ids, int nivel)
        {
            if (ids == null) return;
            for (int i = 0; i < ids.Count; i++)
            {
                var f = banco.AchaFeitico(ids[i]);

                // Id que não resolve é pulado, não desenhado. Botão com id cru e
                // custo zero foi um defeito real da linha JS, e é pior que a
                // ausência: o jogador toca, gasta o turno e não entende nada.
                if (f == null) continue;

                if (f.NivelDeDesbloqueio > nivel) continue;
                if (!PodeAparecerNaBarra(f)) continue;

                saida.Add(f);
            }
        }

        /// <summary>
        /// Feitiço que o jogador nunca conjura à mão não entra na barra.
        ///
        /// São as nove cargas de armadilha do Xamã: elas têm
        /// <c>castsPerTurn = 0</c> porque só disparam por um efeito <c>trap</c>
        /// de outro feitiço. Desenhá-las daria ao Xamã uma barra com nove botões
        /// que não fazem nada.
        /// </summary>
        public static bool PodeAparecerNaBarra(Feitico f)
        {
            return f != null && f.LancamentosPorTurno > 0;
        }

        /// <summary>
        /// Traduz um feitiço do acervo para o que a barra desenha.
        ///
        /// <paramref name="recargaRestante"/> vem de fora porque é estado de
        /// batalha, não de acervo — o motor é quem sabe há quantas rodadas o
        /// feitiço foi lançado.
        /// </summary>
        public static FeiticoNaTela ParaTela(Feitico f, int recargaRestante)
        {
            if (f == null) return null;
            return new FeiticoNaTela
            {
                Id = f.Id,
                Nome = f.Nome,
                CustoDePa = f.CustoDePa,
                Recarga = f.Recarga,
                RecargaRestante = recargaRestante,
                Elemento = f.Elemento,
                Descricao = f.Descricao,
                AlcanceMin = f.Alcance != null ? f.Alcance.Min : 0,
                AlcanceMax = f.Alcance != null ? f.Alcance.Max : 0,
                Forma = f.Area != null ? f.Area.Forma.ToString().ToLowerInvariant() : "single",
                TamanhoDaArea = f.Area != null ? f.Area.Tamanho : 0
            };
        }
    }
}
