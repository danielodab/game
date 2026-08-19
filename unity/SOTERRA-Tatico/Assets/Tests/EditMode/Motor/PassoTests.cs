using NUnit.Framework;
using Soterra.Motor;

namespace Soterra.Testes.Motor
{
    using Batalha = global::Soterra.Motor.Batalha;

    /// <summary>
    /// Andar: quanto custa, o que barra e o que prende.
    ///
    /// A busca em largura em si é da camada de grade e já tem os testes dela.
    /// Aqui só se cobra o que o motor acrescenta: PP, ocupação e raiz.
    /// </summary>
    public class PassoTests
    {
        [Test]
        public void O_Ladino_gasta_um_PP_por_casa_e_para_quando_acaba()
        {
            // 21×17 é o tamanho da sala mais apertada do jogo (SISTEMAS §2), e
            // aqui serve para o disco de passo caber inteiro sem encostar na
            // borda — encostado, a contagem mediria a moldura e não o PP.
            var mapa = Cenario.Aberta(21, 17);
            var ladino = Cenario.Heroi("espadachim", "h1", 10, 8);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, ladino);

            Assert.AreEqual(4, ladino.PP, "o Ladino é a única classe com 4 PP");
            Assert.AreEqual(40, b.AlcanceDePasso().Count,
                "disco de Manhattan de raio 4 numa sala aberta, menos a origem");

            Assert.IsTrue(b.Andar(Cenario.Ponto(13, 8)).Valido, "três casas em linha");
            Assert.AreEqual(1, ladino.PP);
            Assert.AreEqual(Cenario.Ponto(13, 8), ladino.Casa);

            var longe = b.Andar(Cenario.Ponto(16, 8));
            Assert.IsFalse(longe.Valido, "3 casas não cabem em 1 PP");
            Assert.IsNotNull(longe.Recusa, "e o motor DIZ por quê — recusar calado " +
                                           "faz o jogador clicar no chão a batalha inteira");
            Assert.AreEqual(Cenario.Ponto(13, 8), ladino.Casa, "recusa não move ninguém");
        }

        [Test]
        public void Unidade_em_pe_fecha_a_passagem_como_parede()
        {
            //  #####
            //  .....   corredor de uma casa só
            //  #####
            var mapa = Cenario.Sala("#######", ".......", "#######");
            var ladino = Cenario.Heroi("espadachim", "h1", 1, 1);
            var vespa = Cenario.Monstro("lantern-wasp", "m1", 3, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, ladino, vespa);

            var alcance = b.AlcanceDePasso();
            Assert.IsFalse(alcance.ContainsKey(Cenario.Ponto(3, 1)), "não se para em cima de alguém");
            Assert.IsFalse(alcance.ContainsKey(Cenario.Ponto(4, 1)), "nem se passa por cima");
            Assert.IsTrue(alcance.ContainsKey(Cenario.Ponto(2, 1)), "mas chega até ele");
        }

        /// <summary>
        /// Raiz-Trava prende no MESMO turno e no seguinte.
        ///
        /// O `root` zera o PP na hora de propósito: se só valesse a partir do
        /// próximo começo de turno, a vítima ainda daria os passos que já tinha
        /// no bolso e a raiz seria decorativa no turno em que foi lançada.
        /// </summary>
        [Test]
        public void Preso_ao_chao_nao_anda_e_comeca_o_turno_com_zero_PP()
        {
            var mapa = Cenario.Aberta(9, 3);
            var barbaro = Cenario.Heroi("sumo", "h1", 1, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 4, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, barbaro, vergasta);

            // Vergasta 35 > Bárbaro 15: ela abre e planta a raiz.
            Assert.AreSame(vergasta, b.Atual);
            Assert.IsTrue(b.Conjurar("m-root-grip", barbaro.Casa).Valido);
            Assert.IsTrue(Batalha.TemEfeito(barbaro, "root"));
            Assert.AreEqual(0, barbaro.PP, "prende já, sem esperar o próximo turno");

            b.EncerrarTurno();
            Assert.AreSame(barbaro, b.Atual);
            Assert.AreEqual(0, barbaro.PP, "e o turno dele começa sem passo nenhum");
            Assert.AreEqual(0, b.AlcanceDePasso().Count);

            var r = b.Andar(Cenario.Ponto(2, 1));
            Assert.IsFalse(r.Valido);
            StringAssert.Contains("preso", r.Recusa);

            Assert.AreEqual(6, barbaro.PA, "preso ao chão ainda conjura: só o passo some");
        }

        [Test]
        public void Sem_ser_a_vez_da_unidade_nao_ha_alcance_de_passo()
        {
            var mapa = Cenario.Aberta(9, 3);
            var ladino = Cenario.Heroi("espadachim", "h1", 1, 1);
            var vespa = Cenario.Monstro("lantern-wasp", "m1", 6, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, ladino, vespa);

            // Vespa-Lustre tem iniciativa 75 e o Ladino 90 — o Ladino abre, e o
            // alcance desenhado é sempre o de QUEM ESTÁ JOGANDO.
            Assert.AreSame(ladino, b.Atual);
            b.EncerrarTurno();
            Assert.AreSame(vespa, b.Atual);
            Assert.IsTrue(b.AlcanceDePasso().ContainsKey(Cenario.Ponto(6, 2)),
                          "agora o alcance é o da Vespa");
        }
    }
}
