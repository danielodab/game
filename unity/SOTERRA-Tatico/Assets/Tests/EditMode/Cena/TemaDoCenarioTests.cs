using NUnit.Framework;
using UnityEngine;
using Soterra.Cena;
using Soterra.Dados;

namespace Soterra.Testes.Cena
{
    /// <summary>
    /// O tema por calabouço. O teste que importa aqui é o da ORDEM DE VALOR nos
    /// SEIS calabouços de verdade, lidos de <c>dungeons.json</c>: a paleta da
    /// Estufa é clara e a da Forja é quase preta, e uma regra de cor afinada só
    /// na Estufa passa despercebida até alguém descer ao terceiro calabouço.
    /// </summary>
    public class TemaDoCenarioTests
    {
        [Test]
        public void OsSeisCalaboucos_MantemAOrdemDeValorDoTabuleiro()
        {
            var banco = BancoDeDados.CarregarDeResources();
            Assert.AreEqual(6, banco.Calabocos.Count, "o dado dos calabouços mudou de tamanho");

            foreach (var calabouco in banco.Calabocos)
            {
                var tema = TemaDoCenario.De(calabouco);
                float alto = TemaDoCenario.Luz(tema.Alto);
                float chao = TemaDoCenario.Luz(tema.Chao1);
                float chao2 = TemaDoCenario.Luz(tema.Chao2);
                float baixo = TemaDoCenario.Luz(tema.Baixo);
                string onde = calabouco.Id + " (" + tema.Nome + ")";

                // Parede mais pesada que o chão, cobertura mais clara. É a leitura
                // de "veda a visão" contra "atiro por cima", e ela não pode
                // depender de qual calabouço o jogador alcançou.
                Assert.Less(alto, chao, onde + ": a parede ficou mais clara que o chão");
                Assert.Greater(baixo, chao2, onde + ": a cobertura ficou mais escura que o chão");

                Assert.Greater(baixo - alto, 0.30f,
                               onde + ": alto e baixo perto demais em valor");
                Assert.Greater(chao - alto, 0.08f, onde + ": a parede some no piso");
                Assert.Greater(baixo - chao2, 0.15f, onde + ": a cobertura some no piso");
            }
        }

        [Test]
        public void OsSeisCalaboucos_NaoSaemTodosComAMesmaCor()
        {
            // O defeito que esta rodada veio consertar: a paleta era a da Estufa
            // cravada no código, e os seis calabouços saíam verdes. Igualar o
            // VALOR (o teste acima) não pode significar igualar a COR.
            var banco = BancoDeDados.CarregarDeResources();
            var vistas = new System.Collections.Generic.HashSet<string>();
            foreach (var calabouco in banco.Calabocos)
                vistas.Add(ChaveDeCor(TemaDoCenario.De(calabouco).Chao1));

            Assert.AreEqual(banco.Calabocos.Count, vistas.Count,
                            "dois calabouços saíram com o mesmo chão: o tema não está chegando");
        }

        static string ChaveDeCor(Color c)
        {
            return Mathf.RoundToInt(c.r * 255) + "," + Mathf.RoundToInt(c.g * 255) + "," +
                   Mathf.RoundToInt(c.b * 255);
        }

        [Test]
        public void ComLuz_LevaAMatizAoValorPedidoSemTrocarDeCor()
        {
            // Quase preta: é o caso da Forja (#241512). Multiplicar por um fator
            // fixo não a tirava do breu; o alvo de luminância tira.
            var escura = new Color(0.141f, 0.082f, 0.071f);
            var clara = TemaDoCenario.ComLuz(escura, 0.30f);
            Assert.AreEqual(0.30f, TemaDoCenario.Luz(clara), 0.01f);
            Assert.Greater(clara.r, clara.g, "a matiz quente da Forja se perdeu");
            Assert.Greater(clara.g, clara.b, "a matiz quente da Forja se perdeu");
        }

        [Test]
        public void ComLuz_CorSemLuzNenhumaNaoSomeNemDivideporZero()
        {
            var cinza = TemaDoCenario.ComLuz(Color.black, 0.4f);
            Assert.AreEqual(0.4f, TemaDoCenario.Luz(cinza), 0.02f,
                            "preto puro sumiu em vez de virar cinza");
        }

        [Test]
        public void Normalizar_AceitaIdDeCalaboucoENomeDeTema()
        {
            // As duas coisas circulam com o mesmo nome no jogo, e é o `normTheme`
            // de models3d.js que já resolvia isso lá.
            Assert.AreEqual("garden", TemaDoCenario.Normalizar("greenhouse"));
            Assert.AreEqual("garden", TemaDoCenario.Normalizar("garden"));
            Assert.AreEqual("forge", TemaDoCenario.Normalizar("emberlock"));
            Assert.AreEqual("scaffold", TemaDoCenario.Normalizar("windscaffold"));
            Assert.AreEqual("mine", TemaDoCenario.Normalizar("quakemine"));
            Assert.AreEqual("heart", TemaDoCenario.Normalizar("brokenheart"));
            // Sem tema é a Estufa, que é onde o jogo começa.
            Assert.AreEqual("garden", TemaDoCenario.Normalizar(null));
        }

        [Test]
        public void CadaTema_TemPecaDeChaoDecoradoEPelomenosUmTrasteDeCobertura()
        {
            var banco = BancoDeDados.CarregarDeResources();
            foreach (var calabouco in banco.Calabocos)
            {
                var tema = TemaDoCenario.De(calabouco);
                Assert.IsFalse(string.IsNullOrEmpty(tema.PecaDecorada),
                               calabouco.Id + " ficou sem peça de chão decorado");
                Assert.Greater(tema.PecasBaixas.Length, 0,
                               calabouco.Id + " ficou sem traste de cobertura");
            }
        }

        [Test]
        public void Padrao_EhAEstufaEBateComODado()
        {
            // A única paleta escrita em código. Se o dado mudar e ela ficar para
            // trás, é aqui que se descobre — e não numa foto meses depois.
            var banco = BancoDeDados.CarregarDeResources();
            var estufa = TemaDoCenario.De(banco.AchaCalabouco("greenhouse"));
            var padrao = TemaDoCenario.Padrao;

            Assert.AreEqual("garden", padrao.Nome);
            Assert.AreEqual(ChaveDeCor(estufa.Chao1), ChaveDeCor(padrao.Chao1));
            Assert.AreEqual(ChaveDeCor(estufa.Alto), ChaveDeCor(padrao.Alto));
            Assert.AreEqual(ChaveDeCor(estufa.Baixo), ChaveDeCor(padrao.Baixo));
        }
    }
}
