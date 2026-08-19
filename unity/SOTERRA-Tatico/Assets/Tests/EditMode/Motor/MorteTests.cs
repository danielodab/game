using System.Collections.Generic;
using NUnit.Framework;
using Soterra.Motor;

namespace Soterra.Testes.Motor
{
    using Batalha = global::Soterra.Motor.Batalha;

    /// <summary>
    /// Sair do tabuleiro pela porta da frente (morte) e pela porta dos fundos
    /// (fusão) — e por que as duas não podem ser a mesma coisa.
    /// </summary>
    public class MorteTests
    {
        [Test]
        public void Morte_tira_do_tabuleiro_libera_a_casa_e_fecha_a_sala()
        {
            var mapa = Cenario.Aberta(10, 3);
            var batedor = Cenario.Heroi("arqueiro", "h1", 1, 1);
            var vespa = Cenario.Monstro("lantern-wasp", "m1", 5, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, batedor, vespa);
            Cenario.AteAVezDe(b, "h1");

            Assert.AreEqual(48, vespa.PV, "a ficha da Vespa-Lustre");

            // 24 de teto, e a marca da primeira flecha faz a segunda valer
            // 24 × 1,05 = 25,2 → 25. 24 + 25 = 49, e 48 de PV não seguram.
            b.Conjurar("arqueiro-neutro-1", vespa.Casa);
            Assert.AreEqual(24, vespa.PV);

            var r = b.Conjurar("arqueiro-neutro-1", vespa.Casa);
            Assert.IsTrue(r.Tem(TipoDeEvento.Morte));
            Assert.IsFalse(vespa.Viva);
            Assert.IsFalse(vespa.NoTabuleiro);
            Assert.AreEqual(0, vespa.PV);

            Assert.IsNull(b.EmCasa(Cenario.Ponto(5, 1)), "a casa do morto fica livre");
            Assert.AreEqual(0, b.Vivas(Lado.Monstro).Count);
            Assert.AreEqual(FaseDaBatalha.Vitoria, b.Fase, "era o único monstro da sala");

            // Continua na fila de iniciativa, apagado: tirar da lista faria a
            // fila da interface pular de lugar a cada morte.
            Assert.AreEqual(2, b.Unidades.Count);
        }

        /// <summary>
        /// A FUSÃO tira do tabuleiro SEM contar derrota.
        ///
        /// O convidado some com <c>ForaDoTabuleiro</c>: nenhum evento de morte,
        /// nenhuma checagem de fim de batalha. Tratar a fusão como morte faria a
        /// dupla perder a sala no instante em que se fundisse — que é o exato
        /// oposto do que a fusão é para servir.
        ///
        /// A prova de que as duas portas são diferentes está na última linha: a
        /// batalha inteira tem UM evento de morte, e ele é o do herói que
        /// realmente caiu.
        /// </summary>
        [Test]
        public void A_fusao_tira_sem_evento_de_morte_e_sem_derrota()
        {
            var mapa = Cenario.Aberta(9, 3);
            var ladino = Cenario.Heroi("espadachim", "h1", 1, 1);
            var barbaro = Cenario.Heroi("sumo", "h2", 2, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 5, 1);

            // PV de entrada é ESTADO de batalha, não número de jogo: o Ladino
            // chega ferido da sala anterior. É o que deixa a morte caber em dois
            // golpes de Farpa em vez de em sete turnos de laço.
            ladino.PV = 20;

            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, ladino, barbaro, vergasta);
            var diario = new List<Evento>(b.Abertura.Eventos);

            var saida = b.SairDoTabuleiro(barbaro);
            diario.AddRange(saida.Eventos);

            Assert.IsTrue(saida.Tem(TipoDeEvento.SaiuDoTabuleiro));
            Assert.IsFalse(saida.Tem(TipoDeEvento.Morte), "sair do tabuleiro NÃO é morrer");
            Assert.IsFalse(saida.Tem(TipoDeEvento.FimDeBatalha));
            Assert.AreEqual(FaseDaBatalha.EmAndamento, b.Fase);
            Assert.IsTrue(barbaro.ForaDoTabuleiro);
            Assert.IsNull(b.EmCasa(Cenario.Ponto(2, 1)), "a casa dele fica livre para o anfitrião");
            Assert.AreEqual(1, b.Vivas(Lado.Heroi).Count, "só o Ladino segura o lado agora");

            diario.AddRange(b.EncerrarTurno().Eventos);
            Assert.AreSame(vergasta, b.Atual);

            // Farpa: 12–16 de terra, duas por turno. 16 + 16 passa dos 20.
            diario.AddRange(b.Conjurar("m-thorn-shot", ladino.Casa).Eventos);
            Assert.AreEqual(4, ladino.PV);

            var ultima = b.Conjurar("m-thorn-shot", ladino.Casa);
            diario.AddRange(ultima.Eventos);

            Assert.IsTrue(ultima.Tem(TipoDeEvento.Morte));
            Assert.AreEqual(FaseDaBatalha.Derrota, b.Fase,
                "sem herói de pé, a Descida foi derrotada — e quem saiu por fusão " +
                "não segura o lado nem conta como caído");

            int mortes = 0;
            for (int i = 0; i < diario.Count; i++)
                if (diario[i].Tipo == TipoDeEvento.Morte) mortes++;
            Assert.AreEqual(1, mortes,
                "a batalha inteira tem UMA morte: a do Ladino. O Bárbaro saiu pela " +
                "fusão e nunca virou evento de morte.");
        }

        [Test]
        public void Quem_esta_fora_do_tabuleiro_nao_e_alvo_e_nao_fecha_passagem()
        {
            var mapa = Cenario.Sala("#######", ".......", "#######");
            var ladino = Cenario.Heroi("espadachim", "h1", 1, 1);
            var barbaro = Cenario.Heroi("sumo", "h2", 3, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, ladino, barbaro);

            Assert.IsFalse(b.AlcanceDePasso().ContainsKey(Cenario.Ponto(4, 1)),
                           "com o Bárbaro em pé, o corredor está fechado");

            b.SairDoTabuleiro(barbaro);
            Assert.IsTrue(b.AlcanceDePasso().ContainsKey(Cenario.Ponto(4, 1)),
                          "fundido, ele deixa de ser obstáculo");
        }

        [Test]
        public void Sair_do_tabuleiro_duas_vezes_e_recusado()
        {
            var mapa = Cenario.Aberta(6, 3);
            var ladino = Cenario.Heroi("espadachim", "h1", 1, 1);
            var barbaro = Cenario.Heroi("sumo", "h2", 2, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, ladino, barbaro);

            Assert.IsTrue(b.SairDoTabuleiro(barbaro).Valido);
            var repetido = b.SairDoTabuleiro(barbaro);
            Assert.IsFalse(repetido.Valido);
            Assert.IsFalse(repetido.Tem(TipoDeEvento.SaiuDoTabuleiro),
                           "senão a fila de eventos ganharia uma saída fantasma");
        }
    }
}
