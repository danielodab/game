using System.Collections.Generic;
using NUnit.Framework;

namespace Soterra.Testes.IA
{
    using Motor = global::Soterra.Motor;
    using Dados = global::Soterra.Dados;
    using Soterra.IA;

    /// <summary>
    /// O papel vem do ACERVO, não da opinião de quem escreveu a IA.
    ///
    /// O campo <c>ai</c> de <c>monsters.json</c> é a decisão de quem montou o
    /// bestiário, e ela precisa chegar inteira até a IA: uma Vergasta que joga
    /// de perto porque alguém achou que ela parecia de perto é um bicho
    /// diferente do que o jogo declara.
    /// </summary>
    public class PapelTests
    {
        /// <summary>
        /// O acervo inteiro só usa QUATRO valores de <c>ai</c>.
        ///
        /// Este teste existe para o dia em que o bestiário ganhar um quinto: sem
        /// ele, um <c>ai: "caster"</c> novo cairia calado no ramo de corpo a
        /// corpo e o bicho jogaria errado sem ninguém notar.
        /// </summary>
        [Test]
        public void OAcervoSoUsaOsQuatroPapeisConhecidos()
        {
            var conhecidos = new HashSet<string>
            {
                Papeis.CorpoNoAcervo, Papeis.DistanciaNoAcervo,
                Papeis.SuporteNoAcervo, Papeis.ChefeNoAcervo
            };

            var vistos = new HashSet<string>();
            foreach (var par in Cenario.Acervo().Monstros)
            {
                var ai = par.Value.Ia;
                Assert.IsNotNull(ai, "monstro sem campo `ai`: " + par.Key);
                Assert.IsTrue(conhecidos.Contains(ai),
                    "papel desconhecido no acervo: '" + ai + "' em " + par.Key +
                    ". A IA não sabe jogá-lo e o trataria como corpo a corpo em silêncio.");
                vistos.Add(ai);
            }

            // Os quatro têm de APARECER: se um sumir do acervo, o ramo da IA que
            // o serve deixa de ser exercitado e apodrece sem aviso.
            CollectionAssert.AreEquivalent(conhecidos, vistos);
        }

        [TestCase("pollen-puff", Papel.Corpo)]
        [TestCase("lantern-wasp", Papel.Corpo)]
        [TestCase("thorn-lasher", Papel.Distancia)]
        [TestCase("sap-shaman", Papel.Suporte)]
        [TestCase("boss-gardener", Papel.Chefe)]
        public void OPapelSaiDoCampoAiDoBicho(string monstroId, Papel esperado)
        {
            var u = Cenario.Monstro(monstroId, "u1", 5, 8);
            var b = Cenario.Montar(Cenario.SorteDoMotor("papel"), u);
            var ia = Cenario.Ia(b);

            Assert.AreEqual(esperado, ia.PapelDe(u),
                monstroId + " declara ai='" + Cenario.Acervo().Monstros[monstroId].Ia + "' no acervo");
        }

        /// <summary>
        /// O Andarilho-de-Orvalho é o caso que prova que o ACERVO manda.
        ///
        /// O melhor feitiço de dano dele — a Picada — alcança UMA casa, então
        /// uma IA que inferisse o papel pelo repertório o leria como corpo a
        /// corpo. O acervo diz <c>ranged</c>, e é o acervo que vale: quem montou
        /// o bestiário quer o bicho prendendo de longe com a Teia e mordendo só
        /// quando não tem jeito.
        ///
        /// Dezessete dos 66 bichos divergem assim entre o campo e a inferência —
        /// não é um caso de canto, é um sexto do bestiário.
        /// </summary>
        [Test]
        public void OAcervoVenceAInferencia()
        {
            const string bicho = "dew-strider";
            Assert.AreEqual(Papeis.DistanciaNoAcervo, Cenario.Acervo().Monstros[bicho].Ia);

            var andarilho = Cenario.Monstro(bicho, "u1", 10, 8);

            // A inferência olharia o alcance do MELHOR feitiço de dano. Se um dia
            // ele passar de 2, o acervo e a inferência voltam a concordar e este
            // teste deixa de provar o que promete — por isso a premissa é medida,
            // não suposta.
            double melhorDano = 0;
            int alcanceDoMelhor = 1;
            foreach (var id in andarilho.Feiticos)
            {
                var f = Cenario.Acervo().AchaFeitico(id);
                if (f == null || f.Efeitos == null) continue;
                for (int i = 0; i < f.Efeitos.Count; i++)
                {
                    var e = f.Efeitos[i];
                    if (e.Tipo != "damage" && e.Tipo != "chain") continue;
                    double media = ((e.Min ?? 0) + (e.Max ?? 0)) / 2.0;
                    if (media <= melhorDano) continue;
                    melhorDano = media;
                    alcanceDoMelhor = f.Alcance == null ? 1 : f.Alcance.Max;
                }
            }
            Assert.LessOrEqual(alcanceDoMelhor, Papeis.AlcanceDeCorpoACorpo,
                "a premissa caiu: o melhor feitiço de dano do " + bicho +
                " já alcança " + alcanceDoMelhor + ", e a inferência o chamaria de `ranged` também");

            var b = Cenario.Montar(Cenario.SorteDoMotor("papel"), andarilho);
            Assert.AreEqual(Papel.Distancia, Cenario.Ia(b).PapelDe(andarilho),
                "o campo `ai` do acervo foi ignorado em favor da inferência");
        }

        /// <summary>
        /// Herói não tem campo <c>ai</c> — e a IA precisa saber jogar por ele de
        /// qualquer forma (é o auto-play de IA contra IA). Aí, e SÓ aí, o papel é
        /// inferido do repertório: quem sabe curar é suporte.
        /// </summary>
        [Test]
        public void HeroiSemCampoAiTemOPapelInferidoDoRepertorio()
        {
            var curandeira = Cenario.Heroi("curandeira", "u1", 1, 9);
            var b = Cenario.Montar(Cenario.SorteDoMotor("papel"), curandeira);
            var papel = Cenario.Ia(b).PapelDe(curandeira);

            bool sabeCurar = false;
            foreach (var id in curandeira.Feiticos)
            {
                var f = Cenario.Acervo().AchaFeitico(id);
                if (f == null || f.Efeitos == null) continue;
                for (int i = 0; i < f.Efeitos.Count; i++)
                    if (f.Efeitos[i].Tipo == "heal") sabeCurar = true;
            }

            Assert.IsTrue(sabeCurar, "a premissa caiu: a Curandeira não tem mais cura entre os feitiços base");
            Assert.AreEqual(Papel.Suporte, papel);
        }
    }
}
