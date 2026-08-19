using NUnit.Framework;
using UnityEngine.UIElements;
using Soterra.Interface;

namespace Soterra.Testes.Interface
{
    // Ver a nota de armadilha de nome nos testes do Motor: `Motor.X` daqui de
    // dentro acharia `Soterra.Testes.Motor` antes de `Soterra.Motor` (CS0234).
    using Motor = global::Soterra.Motor;

    /// <summary>
    /// O botão de fusão na tela: três estados (ausente, "Fundir · N PA",
    /// "Cancelar fusão") e o toque disparando o evento CERTO em cada um.
    ///
    /// O custo do rótulo vem do quadro, e o quadro o copia do motor
    /// (<c>Batalha.CustoDePaDaFusao</c>) — o teste compara contra a MESMA
    /// constante para pegar o dia em que alguém escrever "2" na tela à mão.
    /// </summary>
    public class FusaoNaTelaTests
    {
        TelaDeBatalha _tela;
        QuadroDaBatalha _quadro;

        [SetUp]
        public void Antes()
        {
            var banco = Cenario.BancoOuInconclusivo();
            _tela = Cenario.Tela();
            _quadro = Cenario.QuadroReal(banco);
        }

        Button Botao()
        {
            return _tela.Raiz.Q<Button>("botao-fundir");
        }

        [Test]
        public void SemCandidatoESemPendencia_OBotaoNaoExiste()
        {
            // O QuadroReal nasce sem fusão nenhuma — é o estado comum da sala.
            _tela.Montar(_quadro);

            Assert.AreEqual(DisplayStyle.None, Botao().style.display.value,
                "sem aliado colado não há pergunta a fazer: o botão some, não apaga");
        }

        [Test]
        public void ComCandidato_OBotaoAcendeComOCusto()
        {
            _quadro.PodeFundir = true;
            _quadro.CustoDaFusao = Motor.Batalha.CustoDePaDaFusao;
            _tela.Montar(_quadro);

            var b = Botao();
            Assert.AreEqual(DisplayStyle.Flex, b.style.display.value);
            StringAssert.Contains("Fundir", b.text);
            StringAssert.Contains(Motor.Batalha.CustoDePaDaFusao + " PA", b.text,
                "o custo é a metade da decisão — escondê-lo faria o jogador " +
                "descobrir os 2 PA a menos depois de tocar");
            Assert.IsFalse(b.ClassListContains("botao--cancelar"));
        }

        [Test]
        public void ComPendencia_OBotaoViraCancelar()
        {
            _quadro.FusaoPendente = true;
            _tela.Montar(_quadro);

            var b = Botao();
            Assert.AreEqual(DisplayStyle.Flex, b.style.display.value);
            StringAssert.Contains("Cancelar", b.text);
            Assert.IsTrue(b.ClassListContains("botao--cancelar"),
                "a classe é o que troca a cor para a de consequência — cancelar " +
                "não devolve os PA e o botão não pode parecer inofensivo");
        }

        [Test]
        public void NoTurnoDoMonstro_OBotaoSomeMesmoComCandidato()
        {
            // Monstros adjacentes SÃO candidatos para o motor; o dedo é que não
            // comanda o turno deles.
            _quadro.PodeFundir = true;
            _quadro.ETurnoDoJogador = false;
            _tela.Montar(_quadro);

            Assert.AreEqual(DisplayStyle.None, Botao().style.display.value);
        }

        // ================================================================ toque

        [Test]
        public void TocarComCandidato_DisparaAoFundir_ENaoOCancelamento()
        {
            _quadro.PodeFundir = true;
            _quadro.CustoDaFusao = Motor.Batalha.CustoDePaDaFusao;
            _tela.Montar(_quadro);

            int fundir = 0, cancelar = 0;
            _tela.AoFundir += () => fundir++;
            _tela.AoCancelarFusao += () => cancelar++;

            _tela.TocarFusao();

            Assert.AreEqual(1, fundir);
            Assert.AreEqual(0, cancelar);
        }

        [Test]
        public void TocarComPendencia_DisparaOCancelamento()
        {
            _quadro.FusaoPendente = true;
            _tela.Montar(_quadro);

            int fundir = 0, cancelar = 0;
            _tela.AoFundir += () => fundir++;
            _tela.AoCancelarFusao += () => cancelar++;

            _tela.TocarFusao();

            Assert.AreEqual(0, fundir);
            Assert.AreEqual(1, cancelar);
        }

        [Test]
        public void TocarSemPoder_NaoDisparaNada()
        {
            _tela.Montar(_quadro);   // sem candidato, sem pendência

            int eventos = 0;
            _tela.AoFundir += () => eventos++;
            _tela.AoCancelarFusao += () => eventos++;

            _tela.TocarFusao();

            _quadro.PodeFundir = true;
            _quadro.ETurnoDoJogador = false;   // e nem no turno do monstro
            _tela.Montar(_quadro);
            _tela.TocarFusao();

            Assert.AreEqual(0, eventos,
                "toque em estado inválido não pode virar jogada — a tela não " +
                "tem autoridade para inventar uma");
        }
    }
}
