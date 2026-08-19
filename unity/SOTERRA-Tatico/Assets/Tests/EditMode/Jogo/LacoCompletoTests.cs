using NUnit.Framework;

namespace Soterra.Testes.Jogo
{
    // Ver a nota de armadilha de nome em AcervoDoJogo.cs.
    using Motor = global::Soterra.Motor;
    using Jogo = global::Soterra.Jogo;

    /// <summary>
    /// O teste de mesa do jogo inteiro: uma batalha completa, herói contra IA,
    /// jogada pelo MESMO caminho que o dedo usa na cena — <c>EscolherFeitico</c>,
    /// <c>TocarCasa</c>, <c>EncerrarTurno</c>, <c>JogadaDoMonstro</c> — do
    /// primeiro turno até o fim.
    ///
    /// O que ele garante é uma coisa só, e é a mais importante: a batalha
    /// TERMINA. Vitória, derrota ou fúria — nunca laço infinito. É este teste
    /// que separa "o usuário aperta Play e joga" de "o usuário abre uma cena
    /// que trava", e por isso o herói é jogado pela <see cref="PoliticaBoba"/>:
    /// se até um jogador que só anda para perto e solta o primeiro feitiço
    /// válido chega ao fim, nenhum jogador de verdade fica preso.
    /// </summary>
    public class LacoCompletoTests
    {
        [Test]
        public void UmaBatalhaInteira_HeroiContraIA_Termina()
        {
            var banco = AcervoDoJogo.Banco();
            var batalha = AcervoDoJogo.NovaBatalha();
            // Semente FIXA: uma batalha que só falha "às vezes" não se conserta.
            var partida = new Jogo.Partida(banco, batalha, Motor.Sorte.DeTexto("laco-de-mesa"));

            var acoes = PoliticaBoba.JogarAteAcabar(partida);

            Assert.AreNotEqual(Motor.FaseDaBatalha.EmAndamento, batalha.Fase);
            TestContext.WriteLine("fim: " + batalha.Fase + " na rodada " + batalha.Rodada +
                                  ", em " + acoes + " ações");
        }
    }
}
