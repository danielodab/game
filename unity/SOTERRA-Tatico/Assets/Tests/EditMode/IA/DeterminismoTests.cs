using System.Collections.Generic;
using System.Text;
using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.IA
{
    using Motor = global::Soterra.Motor;
    using Batalha = global::Soterra.Motor.Batalha;
    using Soterra.Grade;
    using Soterra.IA;

    /// <summary>
    /// A mesma batalha, a mesma semente, a mesma jogada.
    ///
    /// Não é capricho: uma IA que sorteia sem semente não se testa e não se
    /// reproduz num relato de defeito. "O Bufo andou para trás na rodada 4" só
    /// vira conserto se a rodada 4 puder ser vista de novo — e para isso a
    /// batalha inteira tem de ser função da semente e de mais nada.
    /// </summary>
    public class DeterminismoTests
    {
        /// <summary>
        /// Duas batalhas idênticas, semeadas igual, jogadas pela IA: a lista de
        /// jogadas e o estado final têm de bater linha por linha.
        ///
        /// Compara o TEXTO das jogadas e não só o resultado: se as duas partidas
        /// divergirem no meio e voltarem a coincidir no fim, comparar só o placar
        /// não veria nada.
        /// </summary>
        [Test]
        public void AMesmaSementeDaAMesmaBatalha()
        {
            var primeira = Rodar("igual");
            var segunda = Rodar("igual");
            Assert.AreEqual(primeira, segunda, "a mesma semente rendeu duas batalhas diferentes");
        }

        /// <summary>
        /// Trocar a semente da IA muda a batalha. Sem isto, o teste acima
        /// passaria com uma IA que ignorasse a semente por completo — e passaria
        /// pelo motivo errado.
        /// </summary>
        [Test]
        public void SementesDiferentesRendemBatalhasDiferentes()
        {
            var mesma = Rodar("um");
            var outra = Rodar("dois");
            Assert.AreNotEqual(mesma, outra,
                "duas sementes de IA diferentes rederam a MESMA batalha: o desempate não olha a semente");
        }

        /// <summary>
        /// Perguntar duas vezes "o que você faria?" com o tabuleiro parado tem de
        /// dar a mesma resposta.
        ///
        /// Parece óbvio e não é: se o desempate consumisse uma corrente de
        /// sorteio guardada no cérebro, cada pergunta gastaria números e a
        /// segunda resposta viria diferente — e aí nenhuma ferramenta de
        /// depuração poderia mostrar a decisão sem alterá-la.
        /// </summary>
        [Test]
        public void DecidirNaoMudaAResposta()
        {
            var b = Simetrica();
            var ia = Cenario.Ia(b, "idempotente");

            var primeira = ia.Decidir().ToString();
            for (int i = 0; i < 5; i++)
                Assert.AreEqual(primeira, ia.Decidir().ToString(),
                    "a " + (i + 2) + "ª pergunta deu outra resposta sem nada ter mudado");
        }

        /// <summary>
        /// Empate PERFEITO: a Vergasta em (12,8), dois Sumos idênticos em (7,7) e
        /// (7,9) — mesmo alcance, mesma vida, mesma resistência, mesma nota. Não
        /// há critério que separe os dois, e é exatamente aí que a semente tem de
        /// aparecer.
        ///
        /// O teste roda cinquenta sementes FIXAS. Não é sorteio: a resposta de
        /// cada semente é sempre a mesma, e o que se afirma é que ao longo das
        /// cinquenta os DOIS alvos saem — quer dizer, a semente é consultada de
        /// verdade e não decora um lado.
        /// </summary>
        [Test]
        public void OEmpateEDesfeitoPelaSemente()
        {
            var alto = Cenario.Ponto(7, 9);
            var baixo = Cenario.Ponto(7, 7);
            int vezesAlto = 0, vezesBaixo = 0;

            for (int s = 0; s < 50; s++)
            {
                var b = Simetrica();
                var j = Cenario.Ia(b, "empate-" + s).Decidir();
                Cenario.ConferirContraOMotor(b, j);

                Assert.AreEqual(TipoDeJogada.Conjurar, j.Tipo,
                    "a cena depende de a Vergasta atirar sem andar: " + j);
                Assert.AreEqual("m-thorn-shot", j.FeiticoId);

                if (j.Casa == alto) vezesAlto++;
                else if (j.Casa == baixo) vezesBaixo++;
                else Assert.Fail("mirou fora dos dois Sumos: " + j);
            }

            Assert.Greater(vezesAlto, 0, "as cinquenta sementes escolheram sempre o mesmo Sumo");
            Assert.Greater(vezesBaixo, 0, "as cinquenta sementes escolheram sempre o mesmo Sumo");
            Assert.AreEqual(50, vezesAlto + vezesBaixo);
        }

        /// <summary>Cada semente responde SEMPRE a mesma coisa — é o outro lado do teste acima.</summary>
        [Test]
        public void CadaSementeRespondeSempreOMesmo()
        {
            for (int s = 0; s < 6; s++)
            {
                var esperado = Cenario.Ia(Simetrica(), "estavel-" + s).Decidir().ToString();
                for (int repeticao = 0; repeticao < 3; repeticao++)
                    Assert.AreEqual(esperado, Cenario.Ia(Simetrica(), "estavel-" + s).Decidir().ToString(),
                        "a semente 'estavel-" + s + "' mudou de ideia entre duas montagens iguais");
            }
        }

        /// <summary>
        /// Sem semente nenhuma a IA continua determinística: o empate fica com a
        /// PRIMEIRA opção gerada — as casas na ordem de leitura do tabuleiro, os
        /// alvos na ordem de nascimento das unidades. É a configuração para quem
        /// quiser a mesma sala jogada sempre igual.
        /// </summary>
        [Test]
        public void SemSementeOEmpateFicaComOPrimeiro()
        {
            var esperado = Cenario.Ia(Simetrica()).Decidir().ToString();
            for (int i = 0; i < 5; i++)
                Assert.AreEqual(esperado, Cenario.Ia(Simetrica()).Decidir().ToString());

            var b = Simetrica();
            var j = Cenario.Ia(b).Decidir();
            Assert.AreEqual(TipoDeJogada.Conjurar, j.Tipo);
            Assert.AreEqual(b.Unidades[0].Casa, j.Casa,
                "sem semente, o alvo empatado tem de ser o da primeira unidade a nascer");
        }

        // ---- cenas -----------------------------------------------------------

        /// <summary>
        /// Dois Sumos gêmeos, simétricos em torno do corredor central, e a
        /// Vergasta a SEIS casas dos dois — exatamente o alcance da Farpa, para
        /// que ficar parado seja a melhor casa e a única decisão que sobre seja
        /// "em qual dos dois atirar".
        /// </summary>
        static Batalha Simetrica()
        {
            var a = Cenario.Heroi("sumo", "u1", 7, 9);
            var c = Cenario.Heroi("sumo", "u2", 7, 7);
            var vergasta = Cenario.Monstro("thorn-lasher", "u3", 12, 8);
            var b = Cenario.Montar(Cenario.SorteDoMotor("simetrica"), a, c, vergasta);

            Assert.AreSame(vergasta, b.Atual, "a Vergasta (35) joga antes dos Sumos (15)");
            Assert.AreEqual(6, Distancia.Manhattan(vergasta.Casa, a.Casa));
            Assert.AreEqual(6, Distancia.Manhattan(vergasta.Casa, c.Casa));
            Assert.IsTrue(Cenario.Contem(b.AlvosDe("m-thorn-shot"), a.Casa), "a Farpa não alcança o Sumo de cima");
            Assert.IsTrue(Cenario.Contem(b.AlvosDe("m-thorn-shot"), c.Casa), "a Farpa não alcança o Sumo de baixo");
            return b;
        }

        /// <summary>
        /// Uma batalha inteira reduzida a TEXTO: cada jogada e cada evento, em
        /// ordem. É o que se compara — comparar objetos diria "diferentes" sem
        /// dizer onde.
        /// </summary>
        static string Rodar(string semente)
        {
            var heroi = Cenario.Heroi("sumo", "u1", 4, 8);
            var arqueiro = Cenario.Heroi("arqueiro", "u2", 3, 8);
            var bufoA = Cenario.Monstro("pollen-puff", "u3", 9, 8);
            var bufoB = Cenario.Monstro("pollen-puff", "u4", 10, 8);
            var vergasta = Cenario.Monstro("thorn-lasher", "u5", 13, 8);

            // A semente do MOTOR é fixa nas duas partidas de propósito: o que se
            // quer isolar é a semente da IA. Variando as duas juntas, uma
            // diferença no fim não diria qual das duas a causou.
            var b = Cenario.Montar(Cenario.SorteDoMotor("fixa"), heroi, arqueiro, bufoA, bufoB, vergasta);
            var feitas = Cenario.Conduzir(b, Cenario.Ia(b, semente), 20);

            var sb = new StringBuilder();
            for (int i = 0; i < feitas.Count; i++) sb.Append(feitas[i]).Append('\n');
            sb.Append("--- fim: ").Append(b.Fase).Append(" rodada ").Append(b.Rodada).Append('\n');
            for (int i = 0; i < b.Unidades.Count; i++)
            {
                var u = b.Unidades[i];
                sb.Append(u.Uid).Append(' ').Append(u.Casa).Append(" PV=").Append(u.PV)
                  .Append(" viva=").Append(u.Viva).Append('\n');
            }
            return sb.ToString();
        }
    }
}
