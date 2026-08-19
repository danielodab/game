using System.Collections.Generic;
using Soterra.Dados;

namespace Soterra.Progressao
{
    public sealed partial class Progresso
    {
        /// <summary>
        /// Em que nível ESTE feitiço abre.
        ///
        /// A resposta sai do DADO — <c>spells[id].unlockLevel</c> —, e só cai em
        /// <c>unlockTiers[índice]</c> quando o feitiço não declara nada. Esta
        /// ordem é a lição mais cara do <c>progress.js</c>: enquanto a escada
        /// era uma lista cravada no código, o dia em que o acervo acrescentou os
        /// degraus 10 e 15 a lista ficou com buraco — o feitiço existia no
        /// arquivo, o jogador subia de nível e nada aparecia, sem erro nenhum.
        ///
        /// Sem degrau em lugar nenhum, o feitiço NUNCA abre. É o lado seguro:
        /// abrir cedo demais um feitiço de nível 30 estragaria a partida em
        /// silêncio; não abrir aparece na primeira vez que alguém procura.
        /// </summary>
        public int NivelDeDesbloqueio(string feiticoId, int indiceNoCaminho)
        {
            var def = _banco.AchaFeitico(feiticoId);
            if (def != null && def.NivelDeDesbloqueio > 0) return def.NivelDeDesbloqueio;

            var degraus = _banco.DegrausDeDesbloqueio;
            if (degraus != null && indiceNoCaminho >= 0 && indiceNoCaminho < degraus.Count)
                return degraus[indiceNoCaminho];

            return int.MaxValue;
        }

        /// <summary>
        /// Os feitiços que o herói sabe AGORA: os três neutros da classe, os do
        /// caminho já liberados pelo nível, o do Lume e o que um conjunto vestido
        /// conceder.
        ///
        /// É calculado, nunca guardado no save. Guardar viraria cache, e cache de
        /// feitiço envelhece exatamente quando dói: o jogador troca o Lume e a
        /// barra continua com o feitiço antigo.
        /// </summary>
        public IList<string> FeiticosDe(string heroiId)
        {
            var fora = new List<string>();
            var h = Heroi(heroiId);
            if (h == null) return fora;

            var classe = AchaClasse(h.IdDaClasse);
            if (classe != null && classe.FeiticosBase != null)
                foreach (var id in classe.FeiticosBase)
                    if (!string.IsNullOrEmpty(id) && !fora.Contains(id)) fora.Add(id);

            var nivel = NivelPorXp(h.Xp);

            List<string> caminho = null;
            if (classe != null && classe.Caminhos != null && h.Elemento != Dados.Elemento.Neutro)
                classe.Caminhos.TryGetValue(h.Elemento, out caminho);
            if (caminho != null)
            {
                for (int i = 0; i < caminho.Count; i++)
                {
                    if (nivel < NivelDeDesbloqueio(caminho[i], i)) continue;
                    if (!fora.Contains(caminho[i])) fora.Add(caminho[i]);
                }
            }

            // O Lume é o único espaço que concede feitiço (SISTEMAS §8).
            string lume;
            if (h.Itens.TryGetValue(EspacoDoFeitico, out lume))
            {
                var item = AchaItem(lume);
                if (item != null && !string.IsNullOrEmpty(item.ConcedeFeitico) &&
                    !fora.Contains(item.ConcedeFeitico)) fora.Add(item.ConcedeFeitico);
            }

            /* FALTA AQUI, e a falta é conhecida: o CONJUNTO que concede feitiço.
             * `cp-set-heart` traz `bonuses["4"].grantsSpell = "is-heart-whole"`
             * em `sets.json` — quem vestir as quatro peças do Coração deveria
             * ganhar esse feitiço. O campo existe no arquivo e NÃO existe em
             * `Dados.Bonus`, que é de outro dono (`Assets/Scripts/Dados/Item.cs`).
             * Modelar o campo é uma linha lá; enquanto ela não vier, ler o
             * conjunto daqui só devolveria nulo. Está no relatório. */

            return fora;
        }

        /// <summary>
        /// Quantas peças de cada conjunto o herói veste: <c>{idDoConjunto: n}</c>.
        ///
        /// A peça se declara pelo <c>setId</c>; a busca pela lista <c>pieces</c>
        /// do conjunto é só a rede de segurança para acervo antigo, em que o
        /// campo ainda não era derivado no rodapé.
        /// </summary>
        internal Dictionary<string, int> PecasVestidasPorConjunto(FichaDeHeroi h)
        {
            var contas = new Dictionary<string, int>();
            if (h == null) return contas;

            for (int i = 0; i < Espacos.Length; i++)
            {
                string itemId;
                if (!h.Itens.TryGetValue(Espacos[i], out itemId) || string.IsNullOrEmpty(itemId)) continue;
                var conjunto = ConjuntoDe(itemId);
                if (string.IsNullOrEmpty(conjunto)) continue;
                int n;
                contas[conjunto] = contas.TryGetValue(conjunto, out n) ? n + 1 : 1;
            }
            return contas;
        }

        internal string ConjuntoDe(string itemId)
        {
            var item = AchaItem(itemId);
            if (item != null && !string.IsNullOrEmpty(item.IdDoConjunto)) return item.IdDoConjunto;

            var conjuntos = _banco.Conjuntos;
            if (conjuntos == null) return null;
            foreach (var par in conjuntos)
                if (par.Value != null && par.Value.Pecas != null && par.Value.Pecas.Contains(itemId))
                    return par.Key;
            return null;
        }
    }
}
