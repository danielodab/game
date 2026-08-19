using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.IA
{
    using Motor = global::Soterra.Motor;
    using Soterra.Grade;
    using Soterra.IA;

    /// <summary>
    /// O bicho joga como o acervo diz que ele joga.
    ///
    /// Todas as cenas acontecem no CORREDOR CENTRAL do Vestíbulo das Heras (a
    /// linha y=8, aberta de x=1 a x=19), porque é lá que dá para variar a
    /// distância sem que parede ou cobertura mudem a conta pelas costas — e uma
    /// cena montada num tabuleiro liso inventado não provaria nada sobre a sala
    /// em que o jogo acontece.
    /// </summary>
    public class ComportamentoTests
    {
        // ---- sem alvo, aproxima-se; com alvo, ataca --------------------------

        /// <summary>
        /// Bufo-de-Pólen (<c>ai: melee</c>) a três casas: a Mordiscada alcança
        /// UMA casa, então não há alvo alcançável. Ele anda.
        /// </summary>
        [Test]
        public void SemAlvoAlcancavelOCorpoACorpoSeAproxima()
        {
            var heroi = Cenario.Heroi("sumo", "u1", 4, 8);
            var bufo = Cenario.Monstro("pollen-puff", "u2", 7, 8);
            var b = Cenario.Montar(Cenario.SorteDoMotor("aproxima"), heroi, bufo);

            Assert.AreSame(bufo, b.Atual, "o Bufo (iniciativa 55) joga antes do Sumo (15)");
            Assert.AreEqual(0, b.AlvosDe("m-pollen-bite").Count,
                "a premissa caiu: a Mordiscada já alcança alguém daqui");

            int antes = Cenario.Entre(bufo, heroi);
            var j = Cenario.Ia(b, "aproxima").Decidir();
            Cenario.ConferirContraOMotor(b, j);

            Assert.AreEqual(TipoDeJogada.Andar, j.Tipo, "o monstro passou o turno parado: " + j);
            Assert.Less(Distancia.Manhattan(j.Casa, heroi.Casa), antes,
                "andou, mas não para perto do herói: " + j);
        }

        /// <summary>Colado no herói, o mesmo Bufo bate em vez de andar.</summary>
        [Test]
        public void ComAlvoAlcancavelOCorpoACorpoAtaca()
        {
            var heroi = Cenario.Heroi("sumo", "u1", 4, 8);
            var bufo = Cenario.Monstro("pollen-puff", "u2", 5, 8);
            var b = Cenario.Montar(Cenario.SorteDoMotor("ataca"), heroi, bufo);

            var j = Cenario.Ia(b, "ataca").Decidir();
            Cenario.ConferirContraOMotor(b, j);

            Assert.AreEqual(TipoDeJogada.Conjurar, j.Tipo, "tinha alvo colado e não atacou: " + j);
            Assert.AreEqual("m-pollen-bite", j.FeiticoId);
            Assert.AreEqual(heroi.Casa, j.Casa);
        }

        /// <summary>
        /// O turno inteiro do Bufo: anda até colar e morde. É a prova de que o
        /// buraco fechou — antes desta rodada ele passava o turno parado.
        /// </summary>
        [Test]
        public void OTurnoInteiroDoCorpoACorpoTerminaEmDanoNoHeroi()
        {
            var heroi = Cenario.Heroi("sumo", "u1", 4, 8);
            var bufo = Cenario.Monstro("pollen-puff", "u2", 7, 8);
            var b = Cenario.Montar(Cenario.SorteDoMotor("turno"), heroi, bufo);

            Cenario.CasasVisitadasPor(b, Cenario.Ia(b, "turno"), bufo.Uid, 1);

            Assert.AreEqual(1, Cenario.Entre(bufo, heroi), "não chegou a colar no herói");
            Assert.Less(heroi.PV, heroi.PVMax, "colou no herói e não bateu");
        }

        // ---- o papel muda o jogo ---------------------------------------------

        /// <summary>
        /// A MESMA cena, o MESMO herói, a MESMA distância — e o comportamento
        /// oposto, porque o campo <c>ai</c> do acervo é outro.
        ///
        /// O Bufo (<c>melee</c>) fecha a distância; a Vergasta (<c>ranged</c>)
        /// não fecha: ela quer a distância do próprio tiro, que alcança 6.
        /// </summary>
        [Test]
        public void ODeLongeNaoCorreParaOCorpoACorpo()
        {
            var heroi = Cenario.Heroi("sumo", "u1", 4, 8);
            var vergasta = Cenario.Monstro("thorn-lasher", "u2", 7, 8);
            var b = Cenario.Montar(Cenario.SorteDoMotor("longe"), heroi, vergasta);

            Assert.AreSame(vergasta, b.Atual, "a Vergasta (iniciativa 35) joga antes do Sumo (15)");
            int antes = Cenario.Entre(vergasta, heroi);

            Cenario.CasasVisitadasPor(b, Cenario.Ia(b, "longe"), vergasta.Uid, 1);

            Assert.GreaterOrEqual(Cenario.Entre(vergasta, heroi), antes,
                "a Vergasta é `ranged` no acervo e mesmo assim colou no herói");
            Assert.Less(heroi.PV, heroi.PVMax, "ficou longe e também não atacou");
        }

        /// <summary>
        /// Na distância IDEAL — 6, o alcance da Farpa — a Vergasta não se mexe:
        /// atira e pronto. É o outro lado do teste acima; sem ele, "não se
        /// aproximou" também seria satisfeito por uma IA que fugisse para sempre.
        /// </summary>
        [Test]
        public void NaDistanciaIdealODeLongeAtiraSemAndar()
        {
            var heroi = Cenario.Heroi("sumo", "u1", 4, 8);
            var vergasta = Cenario.Monstro("thorn-lasher", "u2", 10, 8);
            var b = Cenario.Montar(Cenario.SorteDoMotor("ideal"), heroi, vergasta);

            Assert.AreEqual(6, Cenario.Entre(vergasta, heroi),
                "a cena depende de a distância ser exatamente o alcance da Farpa");

            var j = Cenario.Ia(b, "ideal").Decidir();
            Cenario.ConferirContraOMotor(b, j);

            Assert.AreEqual(TipoDeJogada.Conjurar, j.Tipo, "estava na distância boa e andou: " + j);
            Assert.AreEqual("m-thorn-shot", j.FeiticoId);
            Assert.AreEqual(heroi.Casa, j.Casa);
        }

        /// <summary>
        /// O Xamã-de-Seiva (<c>ai: support</c>) cura o aliado ferido em vez de
        /// atacar o herói. Ele TEM alcance para nada mais: o que prova o papel é
        /// ele escolher a Seiva Doce no aliado, e não o Açúcar Bruto nem a si
        /// mesmo — o Xamã está inteiro, e curar quem está inteiro cura zero.
        /// </summary>
        [Test]
        public void OSuporteCuraOAliadoMaisFerido()
        {
            var heroi = Cenario.Heroi("sumo", "u1", 2, 8);
            var xama = Cenario.Monstro("sap-shaman", "u2", 10, 8);
            var ferida = Cenario.Monstro("burr-mother", "u3", 11, 8);
            // Metade da vida, derivada da própria ficha: um número escrito à mão
            // aqui envelheceria sozinho no dia em que o acervo mudasse o PV dela.
            ferida.PV = ferida.PVMax / 2;

            var b = Cenario.Montar(Cenario.SorteDoMotor("suporte"), heroi, xama, ferida);
            Assert.AreSame(xama, b.Atual, "o Xamã (45) joga antes da Carrapicho-Mãe (25) e do Sumo (15)");

            var j = Cenario.Ia(b, "suporte").Decidir();
            Cenario.ConferirContraOMotor(b, j);

            Assert.AreEqual(TipoDeJogada.Conjurar, j.Tipo, "o suporte não curou: " + j);
            Assert.AreEqual("m-sap-mend", j.FeiticoId);
            Assert.AreEqual(ferida.Casa, j.Casa, "curou a si mesmo, que está inteiro");
        }

        /// <summary>
        /// O Jardineiro (<c>ai: boss</c>) começa longe demais para qualquer
        /// feitiço dele e anda para dentro do alcance do Gancho de Cipó.
        /// </summary>
        [Test]
        public void OChefeSeAproximaQuandoNadaAlcanca()
        {
            var heroi = Cenario.Heroi("sumo", "u1", 4, 8);
            var chefe = Cenario.Monstro("boss-gardener", "u2", 12, 8);
            var b = Cenario.Montar(Cenario.SorteDoMotor("chefe"), heroi, chefe);

            Assert.AreSame(chefe, b.Atual, "o Jardineiro (50) joga antes do Sumo (15)");
            int antes = Cenario.Entre(chefe, heroi);

            var j = Cenario.Ia(b, "chefe").Decidir();
            Cenario.ConferirContraOMotor(b, j);

            Assert.AreEqual(TipoDeJogada.Andar, j.Tipo, "o chefe passou o turno parado: " + j);
            Assert.Less(Distancia.Manhattan(j.Casa, heroi.Casa), antes);
        }

        // ---- a Vespa, que é o terceiro bicho da sala -------------------------

        /// <summary>
        /// A Vespa-Lustre é <c>melee</c> com 4 PP — o bicho mais móvel da sala.
        /// Ela atravessa cinco casas de corredor num turno e ferroa.
        /// </summary>
        [Test]
        public void AVespaAtravessaOCorredorEFerroaNoMesmoTurno()
        {
            var heroi = Cenario.Heroi("sumo", "u1", 4, 8);
            var vespa = Cenario.Monstro("lantern-wasp", "u2", 9, 8);
            var b = Cenario.Montar(Cenario.SorteDoMotor("vespa"), heroi, vespa);

            Assert.AreSame(vespa, b.Atual, "a Vespa (iniciativa 75) joga antes do Sumo (15)");

            Cenario.CasasVisitadasPor(b, Cenario.Ia(b, "vespa"), vespa.Uid, 1);

            Assert.AreEqual(1, Cenario.Entre(vespa, heroi), "a Vespa tem 4 PP e não chegou");
            Assert.Less(heroi.PV, heroi.PVMax, "chegou e não ferroou");
        }
    }
}
