using NUnit.Framework;
using Soterra.Motor;

namespace Soterra.Testes.Motor
{
    using Batalha = global::Soterra.Motor.Batalha;

    /// <summary>
    /// De quem é a vez, e quando os recursos voltam.
    /// </summary>
    public class TurnoTests
    {
        /// <summary>
        /// O DEFEITO que este teste existe para pegar: encher PA e PP na virada
        /// da RODADA.
        ///
        /// Numa sala de seis, encher tudo na virada devolveria os recursos de
        /// cinco unidades que ainda não jogaram e apagaria o gasto de quem
        /// acabou de jogar. A assertiva que separa as duas leituras é a última:
        /// a rodada VIRA, e a Vergasta continua com o PA que gastou — só enche
        /// quando a vez dela chega.
        /// </summary>
        [Test]
        public void PA_e_PP_enchem_no_comeco_do_turno_DA_UNIDADE_e_nao_da_rodada()
        {
            var mapa = Cenario.Aberta(9, 3);
            var arqueiro = Cenario.Heroi("arqueiro", "h1", 1, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 5, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, arqueiro, vergasta);

            // Batedor tem iniciativa 70, Vergasta 35 — o Batedor abre.
            Assert.AreSame(arqueiro, b.Atual);
            Assert.AreEqual(6, arqueiro.PA, "o Batedor abre com os 6 PA da ficha");
            Assert.AreEqual(3, arqueiro.PP);

            Assert.IsTrue(b.Andar(Cenario.Ponto(2, 1)).Valido);
            Assert.AreEqual(2, arqueiro.PP, "um passo, um PP");
            Assert.IsTrue(b.Conjurar("arqueiro-neutro-1", vergasta.Casa).Valido);
            Assert.AreEqual(3, arqueiro.PA, "Flecha Anotada custa 3 PA");

            b.EncerrarTurno();
            Assert.AreSame(vergasta, b.Atual);
            Assert.AreEqual(6, vergasta.PA, "quem ENTRA no turno é que enche");
            Assert.AreEqual(1, vergasta.PP, "a Vergasta anda 1 casa por turno, e é a ficha dela");
            Assert.AreEqual(3, arqueiro.PA, "quem já jogou continua gasto");
            Assert.AreEqual(2, arqueiro.PP);

            Assert.IsTrue(b.Conjurar("m-thorn-shot", arqueiro.Casa).Valido);
            Assert.AreEqual(3, vergasta.PA);

            b.EncerrarTurno();
            Assert.AreEqual(2, b.Rodada, "a fila deu a volta");
            Assert.AreSame(arqueiro, b.Atual);
            Assert.AreEqual(6, arqueiro.PA, "o Batedor entrou no turno dele: encheu");
            Assert.AreEqual(3, arqueiro.PP);
            Assert.AreEqual(3, vergasta.PA,
                "A RODADA VIROU E A VERGASTA NÃO ENCHEU. É esta linha que separa " +
                "'enche no turno da unidade' de 'enche na virada da rodada'.");

            b.EncerrarTurno();
            Assert.AreSame(vergasta, b.Atual);
            Assert.AreEqual(6, vergasta.PA, "agora sim, na vez dela");
        }

        [Test]
        public void A_ordem_e_por_iniciativa_e_ela_sai_da_ficha_de_cada_classe()
        {
            // 90 · 70 · 55 · 45 · 35 · 15 — os seis números do acervo, e a ordem
            // é a mesma seja qual for a ordem em que o montador as entregou.
            var mapa = Cenario.Aberta(15, 5);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo,
                Cenario.Heroi("sumo", "u-sumo", 1, 1),
                Cenario.Heroi("bruxo", "u-bruxo", 2, 1),
                Cenario.Heroi("espadachim", "u-ladino", 3, 1),
                Cenario.Heroi("invocador", "u-xama", 4, 1),
                Cenario.Heroi("curandeira", "u-paladina", 5, 1),
                Cenario.Heroi("arqueiro", "u-batedor", 6, 1));

            var esperado = new[] { "u-ladino", "u-batedor", "u-paladina", "u-bruxo", "u-xama", "u-sumo" };
            for (int i = 0; i < esperado.Length; i++)
                Assert.AreEqual(esperado[i], b.Unidades[i].Uid,
                    "posição " + i + " da fila de iniciativa");
        }

        [Test]
        public void Quem_saiu_do_tabuleiro_nao_recebe_turno()
        {
            var mapa = Cenario.Aberta(9, 3);
            var ladino = Cenario.Heroi("espadachim", "h1", 1, 1);
            var barbaro = Cenario.Heroi("sumo", "h2", 2, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 6, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, ladino, barbaro, vergasta);

            // Fila: Ladino 90, Vergasta 35, Bárbaro 15.
            b.SairDoTabuleiro(barbaro);

            b.EncerrarTurno();
            Assert.AreSame(vergasta, b.Atual);
            b.EncerrarTurno();
            Assert.AreSame(ladino, b.Atual, "o Bárbaro fundido foi pulado; a rodada virou");
            Assert.AreEqual(2, b.Rodada);
        }

        /// <summary>
        /// Recarga N = o feitiço some por N turnos COMPLETOS do dono.
        ///
        /// O Cone de Cinzas tem <c>cooldown: 1</c>: sai numa rodada, fica fora da
        /// seguinte inteira e volta na terceira. Contar a recarga em RODADAS em
        /// vez de em turnos do dono devolveria o feitiço cedo demais numa sala
        /// cheia — e tarde demais numa sala vazia.
        /// </summary>
        [Test]
        public void Recarga_tira_o_feitico_por_um_turno_completo_do_dono()
        {
            var mapa = Cenario.Aberta(9, 3);
            var bruxo = Cenario.Heroi("bruxo", "h1", 1, 1, "fogo", 1);   // caminho de fogo, degrau 10
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 4, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, bruxo, vergasta);

            Assert.IsTrue(bruxo.Feiticos.Contains("bruxo-fogo-10"),
                "o degrau 10 do caminho de fogo do Bruxo é o Cone de Cinzas");

            // Bruxo 45 > Vergasta 35.
            Assert.IsTrue(b.PodeConjurar("bruxo-fogo-10", Cenario.Ponto(3, 1)));
            Assert.IsTrue(b.Conjurar("bruxo-fogo-10", Cenario.Ponto(3, 1)).Valido);
            Assert.IsFalse(b.PodeConjurar("bruxo-fogo-10", Cenario.Ponto(3, 1)),
                           "não sai duas vezes no mesmo turno");

            b.EncerrarTurno();          // fim do turno do Bruxo: a recarga cai
            b.EncerrarTurno();          // fim do turno da Vergasta: rodada 2
            Assert.AreSame(bruxo, b.Atual);
            Assert.IsFalse(b.PodeConjurar("bruxo-fogo-10", Cenario.Ponto(3, 1)),
                           "a rodada seguinte inteira fica sem o Cone");
            Assert.IsFalse(b.Conjurar("bruxo-fogo-10", Cenario.Ponto(3, 1)).Valido);
            Assert.AreEqual(6, bruxo.PA, "feitiço recusado não cobra PA");

            b.EncerrarTurno();
            b.EncerrarTurno();
            Assert.AreEqual(3, b.Rodada);
            Assert.IsTrue(b.PodeConjurar("bruxo-fogo-10", Cenario.Ponto(3, 1)),
                          "e volta na terceira");
        }

        [Test]
        public void O_clima_da_sala_da_e_tira_PV_no_comeco_do_turno_de_quem_ele_toca()
        {
            // Chuva favorece a água e prejudica o fogo — o par sai de
            // `weathers.json`, e ele é o par de RIVAIS.
            var mapa = Cenario.Aberta(9, 3);
            var bruxoDeFogo = Cenario.Heroi("bruxo", "h1", 1, 1, "fogo", 1);
            var aranha = Cenario.Monstro("dew-strider", "m1", 6, 1);   // água
            bruxoDeFogo.PV = 50;
            aranha.PV = 20;

            var b = Cenario.Montar(mapa, "chuva", Sorte.SempreOMinimo, bruxoDeFogo, aranha);

            // Aranha-de-Orvalho tem iniciativa 65, o Bruxo 45: ela abre e se cura.
            Assert.AreSame(aranha, b.Atual);
            Assert.AreEqual(25, aranha.PV, "a chuva favorece a água: +5");

            var r = b.EncerrarTurno();
            Assert.AreSame(bruxoDeFogo, b.Atual);
            Assert.AreEqual(45, bruxoDeFogo.PV, "e prejudica o fogo: −5");
            Assert.IsTrue(r.Tem(TipoDeEvento.TiqueDeClima));
        }

        [Test]
        public void Clima_calmo_nao_gera_evento_nenhum()
        {
            var mapa = Cenario.Aberta(9, 3);
            var bruxo = Cenario.Heroi("bruxo", "h1", 1, 1, "fogo", 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 5, 1);
            var b = Cenario.Montar(mapa, "calmo", Sorte.SempreOMinimo, bruxo, vergasta);

            Assert.IsFalse(b.Abertura.Tem(TipoDeEvento.TiqueDeClima),
                "a sala calma não tem opinião sobre quem deve morrer");
            Assert.IsFalse(b.EncerrarTurno().Tem(TipoDeEvento.TiqueDeClima));
        }
    }
}
