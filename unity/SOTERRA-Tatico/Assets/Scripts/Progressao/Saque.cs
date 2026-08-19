using System;
using System.Collections.Generic;
using Soterra.Dados;

namespace Soterra.Progressao
{
    /// <summary>
    /// O que a sala paga: peças, pedras, cartas e bicho.
    ///
    /// Os PESOS saem todos do acervo (<c>items[*].dropWeight</c>,
    /// <c>lootWeights</c>, <c>dungeon.cardDrops</c>, <c>pets[*].dropWeight</c>).
    /// As três CHANCES que não estão em JSON nenhum — carta do chefe e bicho do
    /// chefe — estão isoladas no bloco abaixo e vieram de <c>js/core/progress.js</c>
    /// [D9] e [D12], que é a fonte da verdade enquanto o acervo não as escrever.
    /// Ficam juntas de propósito: quando o dado chegar, é um bloco só para
    /// apagar, não uma caça a números soltos.
    ///
    /// O sorteio é INJETADO (<c>Motor.Sorte</c>), nunca global: com gerador
    /// travado um teste cobra "esta piscina, este sorteio, esta peça", em vez de
    /// afirmar uma faixa que quase tudo satisfaz.
    /// </summary>
    public static class Saque
    {
        /// <summary>Chance de o chefe derrubar carta, solo. (progress.js [D9])</summary>
        public const double ChanceDeCartaSolo = 0.60;

        /// <summary>Chance de o chefe derrubar carta, em dupla. (progress.js [D9])</summary>
        public const double ChanceDeCartaEmDupla = 0.50;

        /// <summary>Chance base de bicho no chefe, antes da Sorte de Saque. (progress.js [D12])</summary>
        public const double ChanceDeBicho = 0.25;

        /// <summary>Teto da chance de bicho depois da Sorte. (progress.js [D12])</summary>
        public const double TetoDaChanceDeBicho = 0.9;

        struct Peso
        {
            public string Id;
            public double Valor;
        }

        /// <summary>
        /// A Sorte de Saque: grupo menor tira mais e melhor.
        ///
        /// É o preço de descer sozinho virar prêmio — sem ela, jogar solo seria
        /// só apanhar mais pelo mesmo saque.
        /// </summary>
        public static double SorteDeSaque(BancoDeDados banco, int tamanhoDoGrupo)
        {
            var pesos = banco.PesosDeSaque;
            if (pesos == null || pesos.Sorte == null) return 1.0;
            return tamanhoDoGrupo <= 1 ? pesos.Sorte.Solo : pesos.Sorte.Dupla;
        }

        static int ExpoenteDaSorte(BancoDeDados banco, string raridade)
        {
            var e = banco.PesosDeSaque == null ? null : banco.PesosDeSaque.ExpoenteDaSorte;
            if (e == null) return 0;
            switch (raridade)
            {
                case "comum": return e.Comum;
                case "raro": return e.Raro;
                case "epico": return e.Epico;
                case "lendario": return e.Lendario;
                default: return 0;
            }
        }

        /// <summary>
        /// Sorteia as peças da sala e já as põe no saco. Devolve os ids que
        /// caíram (lista vazia é resultado normal, não erro).
        ///
        /// O PESO DE "NADA" (<c>lootWeights.noDrop</c>) entra no mesmo sorteio e
        /// NÃO recebe a Sorte de Saque — é ele que deixa cerca de metade dos
        /// sorteios secos e que faz uma peça já ser um bom saque. Tirá-lo
        /// encheria o saco na primeira descida e mataria a forja junto.
        /// </summary>
        public static IList<string> RolarItens(Progresso progresso, string calabocoId,
                                               int indiceDaSala, int tamanhoDoGrupo, Motor.Sorte sorte)
        {
            var caidos = new List<string>();
            var banco = progresso.Banco;
            var calabouco = banco.AchaCalabouco(calabocoId);
            if (calabouco == null || sorte == null) return caidos;

            var luck = SorteDeSaque(banco, tamanhoDoGrupo);
            var piscina = new List<Peso>();
            var usouItens = false;

            if (banco.Itens != null)
            {
                foreach (var par in banco.Itens)
                {
                    var it = par.Value;
                    if (it == null || it.IdDoCalabouco != calabocoId || it.PesoDeQueda <= 0) continue;
                    usouItens = true;
                    if (indiceDaSala < it.SalaMinima) continue;   // épico e lendário só na sala do chefe
                    var w = it.PesoDeQueda * Math.Pow(luck, ExpoenteDaSorte(banco, it.Raridade));
                    if (w > 0) piscina.Add(new Peso { Id = par.Key, Valor = w });
                }
            }

            if (usouItens)
            {
                int semQueda;
                if (banco.PesosDeSaque != null && banco.PesosDeSaque.SemQueda != null &&
                    banco.PesosDeSaque.SemQueda.TryGetValue(calabocoId, out semQueda) && semQueda > 0)
                    piscina.Add(new Peso { Id = null, Valor = semQueda });
            }
            else
            {
                // Reserva para acervo antigo, em que a piscina morava no
                // calabouço. Sem `noDrop` nessa escala, entra sem o "nada".
                foreach (var linha in calabouco.TabelaDeSaque)
                {
                    if (linha == null) continue;
                    var it = progresso.AchaItem(linha.IdDoItem);
                    var salaMinima = Math.Max(linha.SalaMinima, it == null ? 0 : it.SalaMinima);
                    if (indiceDaSala < salaMinima) continue;
                    var w = Math.Max(0, linha.Peso) *
                            Math.Pow(luck, ExpoenteDaSorte(banco, it == null ? null : it.Raridade));
                    if (w > 0) piscina.Add(new Peso { Id = linha.IdDoItem, Valor = w });
                }
            }

            if (piscina.Count == 0) return caidos;

            // Um sorteio por sala, e um extra na do chefe.
            var sorteios = EhSalaDoChefe(calabouco, indiceDaSala) ? 2 : 1;
            for (int r = 0; r < sorteios; r++)
            {
                var escolhido = Escolher(piscina, sorte);
                if (string.IsNullOrEmpty(escolhido)) continue;   // saiu "nada"
                if (progresso.AdicionarItem(escolhido)) caidos.Add(escolhido);
            }
            return caidos;
        }

        /// <summary>
        /// Pedras dos monstros mortos. Cada bicho com <c>stoneDrop</c> rende
        /// pedras do PRÓPRIO elemento — é o que amarra "onde eu cavo" a "o que
        /// eu consigo forjar".
        /// </summary>
        public static IDictionary<string, int> RolarPedras(Progresso progresso,
                                                           IEnumerable<Monstro> mortos, Motor.Sorte sorte)
        {
            var ganho = new Dictionary<string, int>();
            if (mortos == null || sorte == null) return ganho;

            foreach (var m in mortos)
            {
                var queda = m == null ? null : m.QuedaDePedra;
                if (queda == null) continue;
                if (sorte.Proximo() >= queda.Chance) continue;
                var minimo = Math.Max(0, queda.Min);
                var maximo = Math.Max(minimo, queda.Max);
                var quantos = sorte.Inteiro(minimo, maximo);
                if (quantos <= 0) continue;
                var pedra = progresso.PedraDoElemento(m.Elemento);
                int n;
                ganho[pedra] = ganho.TryGetValue(pedra, out n) ? n + quantos : quantos;
            }

            foreach (var par in ganho) progresso.AdicionarPedras(par.Key, par.Value);
            return ganho;
        }

        /// <summary>
        /// Carta de classe — SÓ do chefe, e sorteada.
        ///
        /// A quantidade cresce com a profundidade (<c>1 + índice/2</c>): é o que
        /// compensa o custo alto das classes que só caem lá embaixo. E a
        /// profundidade é o ÍNDICE 0-based da lista de calabouços, nunca o
        /// <c>order</c>, que é 1-based — comparar com o <c>order</c> faria a
        /// carta cara vazar um andar acima do previsto.
        /// </summary>
        public static InfoDeCarta RolarCarta(Progresso progresso, string calabocoId,
                                             int indiceDaSala, int tamanhoDoGrupo, Motor.Sorte sorte)
        {
            var banco = progresso.Banco;
            var calabouco = banco.AchaCalabouco(calabocoId);
            if (calabouco == null || sorte == null) return null;
            if (!EhSalaDoChefe(calabouco, indiceDaSala)) return null;

            var profundidade = IndiceDoCalabouco(banco, calabocoId);
            var piscina = new List<Peso>();
            foreach (var queda in calabouco.QuedasDeCarta)
            {
                if (queda == null) continue;
                var carta = progresso.AchaCarta(queda.IdDaClasse);
                if (carta == null || carta.PesoDeQueda <= 0) continue;
                if (profundidade < carta.CalaboucoMinimo) continue;
                var w = Math.Max(0, queda.Peso) * carta.PesoDeQueda;
                if (w > 0) piscina.Add(new Peso { Id = queda.IdDaClasse, Valor = w });
            }
            if (piscina.Count == 0) return null;

            var chance = tamanhoDoGrupo <= 1 ? ChanceDeCartaSolo : ChanceDeCartaEmDupla;
            if (sorte.Proximo() >= chance) return null;

            var escolhida = Escolher(piscina, sorte);
            if (string.IsNullOrEmpty(escolhida)) return null;
            var quantas = 1 + Math.Max(0, profundidade) / 2;
            return progresso.AdicionarCartas(escolhida, quantas);
        }

        /// <summary>Bicho — só do chefe, e só um que o grupo ainda não tenha.</summary>
        public static string RolarBicho(Progresso progresso, string calabocoId,
                                        int indiceDaSala, int tamanhoDoGrupo, Motor.Sorte sorte)
        {
            var banco = progresso.Banco;
            var calabouco = banco.AchaCalabouco(calabocoId);
            if (calabouco == null || sorte == null || banco.Bichos == null) return null;
            if (!EhSalaDoChefe(calabouco, indiceDaSala)) return null;

            var jaTem = new HashSet<string>(progresso.Estado.Bichos);
            foreach (var h in progresso.Estado.Herois.Values)
                if (!string.IsNullOrEmpty(h.Bicho)) jaTem.Add(h.Bicho);

            var piscina = new List<Peso>();
            foreach (var par in banco.Bichos)
            {
                var b = par.Value;
                if (b == null || b.PesoDeQueda <= 0 || jaTem.Contains(par.Key)) continue;
                if (!string.IsNullOrEmpty(b.CalaboucoDeQueda) && b.CalaboucoDeQueda != calabocoId) continue;
                piscina.Add(new Peso { Id = par.Key, Valor = b.PesoDeQueda });
            }
            if (piscina.Count == 0) return null;

            var chance = Math.Min(TetoDaChanceDeBicho,
                                  ChanceDeBicho * SorteDeSaque(banco, tamanhoDoGrupo));
            if (sorte.Proximo() >= chance) return null;

            var escolhido = Escolher(piscina, sorte);
            if (string.IsNullOrEmpty(escolhido)) return null;
            return progresso.AdicionarBicho(escolhido) ? escolhido : null;
        }

        // ------------------------------------------------------------ utilidades

        internal static bool EhSalaDoChefe(Calabouco calabouco, int indiceDaSala)
        {
            if (calabouco == null || calabouco.Salas == null || calabouco.Salas.Count == 0) return false;
            return indiceDaSala >= calabouco.Salas.Count - 1;
        }

        internal static int IndiceDoCalabouco(BancoDeDados banco, string calabocoId)
        {
            if (banco.Calabocos == null) return 0;
            for (int i = 0; i < banco.Calabocos.Count; i++)
                if (banco.Calabocos[i] != null && banco.Calabocos[i].Id == calabocoId) return i;
            return 0;
        }

        /// <summary>
        /// Sorteio por peso. Devolve o <c>Id</c> do escolhido — que pode ser
        /// <c>null</c> quando o escolhido é a entrada de "nada".
        /// </summary>
        static string Escolher(List<Peso> piscina, Motor.Sorte sorte)
        {
            double total = 0;
            for (int i = 0; i < piscina.Count; i++) total += piscina[i].Valor;
            if (total <= 0) return null;

            var alvo = sorte.Proximo() * total;
            double acumulado = 0;
            for (int i = 0; i < piscina.Count; i++)
            {
                acumulado += piscina[i].Valor;
                if (alvo < acumulado) return piscina[i].Id;
            }
            return piscina[piscina.Count - 1].Id;
        }
    }
}
