using System;
using System.Collections.Generic;
using Soterra.Dados;

namespace Soterra.Progressao
{
    public sealed partial class Progresso
    {
        // ======================================================= o saco do GRUPO

        /// <summary>
        /// Uma peça entra no saco. Repetida vira outra CÓPIA, não some.
        ///
        /// O saco é do grupo e não do herói (SISTEMAS §9): é o que permite dois
        /// pares de botas iguais irem um em cada herói.
        /// </summary>
        public bool AdicionarItem(string itemId)
        {
            if (AchaItem(itemId) == null) return false;
            Estado.Saco.Add(new CopiaDeItem(itemId, 0));
            Salvar();
            return true;
        }

        /// <summary>Cópias LIVRES no saco — é o ×N que a grade mostra.</summary>
        public int ContarNoSaco(string itemId)
        {
            int n = 0;
            for (int i = 0; i < Estado.Saco.Count; i++)
                if (Estado.Saco[i].IdDoItem == itemId) n++;
            return n;
        }

        /// <summary>Cópias que o grupo tem no mundo: as do saco mais as vestidas.</summary>
        public int ContarPossuido(string itemId)
        {
            return ContarNoSaco(itemId) + QuemVeste(itemId).Count;
        }

        /// <summary>
        /// O saco agrupado para a tela: uma pilha por variante, com o contador.
        ///
        /// Duas cópias do mesmo item em níveis de forja diferentes são DUAS
        /// pilhas — juntá-las obrigaria a tela a escolher qual dos dois níveis
        /// mostrar, e ela mostraria o errado na metade das vezes.
        /// </summary>
        public IList<Pilha> Pilhas()
        {
            var fora = new List<Pilha>();
            var indicePorChave = new Dictionary<string, int>();

            for (int i = 0; i < Estado.Saco.Count; i++)
            {
                var c = Estado.Saco[i];
                var chave = c.IdDoItem + "|" + c.NivelDeForja;
                int pos;
                if (indicePorChave.TryGetValue(chave, out pos))
                {
                    var p = fora[pos];
                    p.Quantidade++;
                    fora[pos] = p;
                    continue;
                }
                indicePorChave[chave] = fora.Count;
                fora.Add(new Pilha
                {
                    IdDoItem = c.IdDoItem,
                    NivelDeForja = c.NivelDeForja,
                    Quantidade = 1,
                    Indice = i
                });
            }
            return fora;
        }

        /// <summary>A cópia que está num espaço do herói, ou <c>null</c>.</summary>
        public CopiaDeItem Vestido(string heroiId, string espaco)
        {
            var h = Heroi(heroiId);
            if (h == null || Array.IndexOf(Espacos, espaco) < 0) return null;
            string itemId;
            if (!h.Itens.TryGetValue(espaco, out itemId) || string.IsNullOrEmpty(itemId)) return null;
            int nivel;
            h.NivelDoItem.TryGetValue(espaco, out nivel);
            return new CopiaDeItem(itemId, nivel);
        }

        /// <summary>Todos os heróis usando uma cópia deste item (com 2 cópias, podem ser 2).</summary>
        public IList<string> QuemVeste(string itemId)
        {
            var fora = new List<string>();
            foreach (var par in Estado.Herois)
            {
                for (int i = 0; i < Espacos.Length; i++)
                {
                    string vestido;
                    if (par.Value.Itens.TryGetValue(Espacos[i], out vestido) && vestido == itemId)
                    {
                        fora.Add(par.Key);
                        break;
                    }
                }
            }
            return fora;
        }

        /// <summary>
        /// Equipar TIRA a cópia do saco.
        ///
        /// Foi troca de modelo em relação à v2.0, em que o item equipado
        /// continuava aparecendo na grade: com ele no saco, a tela mostrava uma
        /// peça que já tinha dono e o jogador equipava "a mesma" no segundo
        /// herói. Tirando do saco, o que a grade mostra é exatamente o que ainda
        /// está livre — e <see cref="Desequipar"/> devolve A MESMA cópia, com a
        /// forja dela intacta.
        ///
        /// <paramref name="indiceNoSaco"/> escolhe QUAL cópia (a grade manda o
        /// índice do espaço tocado). Sem ele vai a mais forjada — nunca a
        /// primeira da lista, que seria arbitrária e costuma ser a pior.
        /// </summary>
        public bool Equipar(string heroiId, string itemId, int indiceNoSaco)
        {
            var item = AchaItem(itemId);
            if (item == null || Array.IndexOf(Espacos, item.Espaco) < 0) return false;
            var h = GarantirHeroi(heroiId);
            if (h == null) return false;

            int indice = -1;
            if (indiceNoSaco >= 0 && indiceNoSaco < Estado.Saco.Count &&
                Estado.Saco[indiceNoSaco].IdDoItem == itemId) indice = indiceNoSaco;
            else indice = MelhorCopiaLivre(itemId);
            if (indice < 0) return false;                   // nenhuma cópia livre

            var copia = Estado.Saco[indice];
            Estado.Saco.RemoveAt(indice);
            DevolverAoSaco(h, item.Espaco);                 // o anterior fica livre na hora
            h.Itens[item.Espaco] = itemId;
            h.NivelDoItem[item.Espaco] = copia.NivelDeForja;
            Salvar();
            return true;
        }

        public bool Equipar(string heroiId, string itemId)
        {
            return Equipar(heroiId, itemId, -1);
        }

        public bool Desequipar(string heroiId, string espaco)
        {
            var h = Heroi(heroiId);
            if (h == null || Array.IndexOf(Espacos, espaco) < 0) return false;
            if (!DevolverAoSaco(h, espaco)) return false;
            Salvar();
            return true;
        }

        /// <summary>Índice da melhor cópia livre: a mais forjada.</summary>
        int MelhorCopiaLivre(string itemId)
        {
            int melhor = -1;
            for (int i = 0; i < Estado.Saco.Count; i++)
            {
                if (Estado.Saco[i].IdDoItem != itemId) continue;
                if (melhor < 0 || Estado.Saco[i].NivelDeForja > Estado.Saco[melhor].NivelDeForja)
                    melhor = i;
            }
            return melhor;
        }

        /// <summary>Devolve a cópia de um espaço ao saco. Não grava — quem chama grava.</summary>
        bool DevolverAoSaco(FichaDeHeroi h, string espaco)
        {
            string itemId;
            if (!h.Itens.TryGetValue(espaco, out itemId) || string.IsNullOrEmpty(itemId)) return false;
            int nivel;
            h.NivelDoItem.TryGetValue(espaco, out nivel);
            Estado.Saco.Add(new CopiaDeItem(itemId, nivel));
            h.Itens.Remove(espaco);
            h.NivelDoItem.Remove(espaco);
            return true;
        }

        // ================================================== o quinto espaço: bicho

        /// <summary>Um bicho só existe uma vez no grupo — nem no saco nem em dois donos.</summary>
        public bool AdicionarBicho(string bichoId)
        {
            if (AchaBicho(bichoId) == null) return false;
            if (Estado.Bichos.Contains(bichoId)) return false;
            foreach (var h in Estado.Herois.Values) if (h.Bicho == bichoId) return false;
            Estado.Bichos.Add(bichoId);
            Salvar();
            return true;
        }

        /// <summary>
        /// Põe o bicho no herói. Se ele já servia a outro, TRANSFERE — um bicho
        /// serve a um herói por vez, e recusar a transferência obrigaria a tela a
        /// dois toques para uma decisão só.
        /// </summary>
        public bool EquiparBicho(string heroiId, string bichoId)
        {
            if (AchaBicho(bichoId) == null) return false;
            var h = GarantirHeroi(heroiId);
            if (h == null) return false;

            var solto = Estado.Bichos.IndexOf(bichoId);
            if (solto >= 0) Estado.Bichos.RemoveAt(solto);
            else
            {
                string dono = null;
                foreach (var par in Estado.Herois) if (par.Value.Bicho == bichoId) { dono = par.Key; break; }
                if (dono == null) return false;              // não é do grupo
                if (dono == heroiId) return true;
                Estado.Herois[dono].Bicho = null;
            }

            if (!string.IsNullOrEmpty(h.Bicho)) Estado.Bichos.Add(h.Bicho);
            h.Bicho = bichoId;
            Salvar();
            return true;
        }

        public bool DesequiparBicho(string heroiId)
        {
            var h = Heroi(heroiId);
            if (h == null || string.IsNullOrEmpty(h.Bicho)) return false;
            Estado.Bichos.Add(h.Bicho);
            h.Bicho = null;
            Salvar();
            return true;
        }
    }
}
