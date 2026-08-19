using NUnit.Framework;
using Soterra.Motor;

namespace Soterra.Testes.Motor
{
    using Batalha = global::Soterra.Motor.Batalha;

    /// <summary>
    /// Escapar de quem prendeu — e o que o elemento tem a ver com isso.
    /// </summary>
    public class EsquivaTests
    {
        /// <summary>
        /// Esquiva é IDENTIDADE DE CLASSE, não um número igual para todos.
        ///
        /// Contra o mesmo fixador, o Bárbaro (esquiva 5) e o Ladino (esquiva 30)
        /// têm chances diferentes — 25 pontos de ficha × 0,02 = meia dezena de
        /// pontos percentuais cada. Um motor que usasse um valor único para
        /// todos passaria em qualquer teste de contagem e reprovaria aqui.
        /// </summary>
        [Test]
        public void Esquiva_e_identidade_de_classe__Barbaro_5_contra_Ladino_30()
        {
            var mapa = Cenario.Aberta(9, 3);
            var barbaro = Cenario.Heroi("sumo", "h1", 1, 1);
            var ladino = Cenario.Heroi("espadachim", "h2", 1, 2);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 3, 1);   // fixação 26
            var vespa = Cenario.Monstro("lantern-wasp", "m2", 5, 1);      // fixação 6
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, barbaro, ladino, vergasta, vespa);

            Assert.AreEqual(5, barbaro.Esquiva, "a ficha do Bárbaro (SISTEMAS §3)");
            Assert.AreEqual(30, ladino.Esquiva, "a do Ladino");

            // 0,35 + (esquiva − fixação) × 0,02 + 0,10 (neutro contra terra:
            // elementos sem relação).
            Assert.AreEqual(0.10, b.ChanceDeEsquiva(barbaro, vergasta), 1e-9,
                "0,35 − 0,42 + 0,10 = 0,03, e o piso de 10% segura: o Bárbaro " +
                "praticamente não sai de perto da Vergasta");
            Assert.AreEqual(0.53, b.ChanceDeEsquiva(ladino, vergasta), 1e-9);

            Assert.AreEqual(0.43, b.ChanceDeEsquiva(barbaro, vespa), 1e-9);
            Assert.AreEqual(0.90, b.ChanceDeEsquiva(ladino, vespa), 1e-9,
                "0,93 estourado pelo teto de 90% — ninguém escapa sempre");

            Assert.Less(b.ChanceDeEsquiva(barbaro, vespa), b.ChanceDeEsquiva(ladino, vespa),
                "o tanque prende, o assassino escapa");
        }

        /// <summary>
        /// A rivalidade elemental é lida do ACERVO, não da memória do motor.
        ///
        /// A segunda metade do teste troca a tabela por uma inventada e mostra
        /// que a conta ANDA JUNTO: se os pares estivessem escritos em C#, o
        /// resultado não mudaria e este teste seria a única coisa a falhar no
        /// dia em que o acervo mudasse de opinião.
        /// </summary>
        [Test]
        public void Rivalidade_sai_de_rivals_json_e_nao_da_memoria_do_motor()
        {
            var acervo = Cenario.Acervo();

            Assert.AreEqual("agua", Soterra.Motor.Rivalidade.De(acervo, "fogo"));
            Assert.AreEqual("fogo", Soterra.Motor.Rivalidade.De(acervo, "agua"));
            Assert.AreEqual("ar", Soterra.Motor.Rivalidade.De(acervo, "terra"));
            Assert.AreEqual("terra", Soterra.Motor.Rivalidade.De(acervo, "ar"));
            Assert.IsNull(Soterra.Motor.Rivalidade.De(acervo, "neutro"),
                "o neutro não odeia ninguém — e é por isso que o rival é texto " +
                "que pode ser nulo, e não um enum com um 'nenhum' inventado");

            // Os cinco elementos com ficha de apresentação são exatamente os
            // cinco com linha na tabela de rivais. Divergir aqui seria um
            // elemento que existe na tela e não existe na regra.
            Assert.AreEqual(5, acervo.InfoDeElementos.Count);
            foreach (var par in acervo.InfoDeElementos)
                Assert.IsTrue(acervo.Rivais.ContainsKey(par.Key),
                    "elemento '" + par.Key + "' aparece em elementInfo e some de rivals");

            var inventado = Soterra.Dados.BancoDeDados.Carregar(
                new Soterra.Dados.FonteDeMemoria().Com("rivals",
                    @"{ ""fogo"": ""terra"", ""terra"": ""fogo"", ""agua"": null, ""ar"": null, ""neutro"": null }"));

            Assert.AreEqual(0.30, Soterra.Motor.Rivalidade.BonusDeEsquiva(inventado, "fogo", "terra"), 1e-9,
                "com esta tabela, terra é o rival do fogo — e a conta obedece ao arquivo");
            Assert.AreEqual(0.10, Soterra.Motor.Rivalidade.BonusDeEsquiva(inventado, "fogo", "agua"), 1e-9,
                "e a água virou estranha");
        }

        [Test]
        public void Os_tres_numeros_da_rivalidade_no_teste_de_esquiva()
        {
            var acervo = Cenario.Acervo();

            Assert.AreEqual(0.00, Soterra.Motor.Rivalidade.BonusDeEsquiva(acervo, "fogo", "fogo"), 1e-9,
                "mesmo elemento: nenhum leva jeito com o outro");
            Assert.AreEqual(0.30, Soterra.Motor.Rivalidade.BonusDeEsquiva(acervo, "fogo", "agua"), 1e-9,
                "fugindo do próprio rival");
            Assert.AreEqual(0.10, Soterra.Motor.Rivalidade.BonusDeEsquiva(acervo, "fogo", "terra"), 1e-9,
                "sem relação");
            Assert.AreEqual(0.10, Soterra.Motor.Rivalidade.BonusDeEsquiva(acervo, "neutro", "fogo"), 1e-9,
                "o neutro nunca tem rival, então nunca ganha os 30%");
            Assert.AreEqual(0.00, Soterra.Motor.Rivalidade.BonusDeEsquiva(acervo, "neutro", "neutro"), 1e-9);
        }

        /// <summary>
        /// O mesmo Bruxo escapa MAIS do inimigo que prende MELHOR, quando esse
        /// inimigo é o rival dele. É o que a rivalidade compra em combate.
        /// </summary>
        [Test]
        public void Fugir_do_proprio_rival_e_mais_facil_do_que_fugir_de_um_estranho()
        {
            var mapa = Cenario.Aberta(9, 3);
            var bruxoDeFogo = Cenario.Heroi("bruxo", "h1", 1, 1, "fogo", 0);
            var seiveiro = Cenario.Monstro("sap-shaman", "m1", 3, 1);    // água, fixação 12
            var bufo = Cenario.Monstro("pollen-puff", "m2", 5, 1);       // terra, fixação 8
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, bruxoDeFogo, seiveiro, bufo);

            Assert.AreEqual(0.71, b.ChanceDeEsquiva(bruxoDeFogo, seiveiro), 1e-9,
                "0,35 + (15 − 12) × 0,02 + 0,30 do rival");
            Assert.AreEqual(0.59, b.ChanceDeEsquiva(bruxoDeFogo, bufo), 1e-9,
                "0,35 + (15 − 8) × 0,02 + 0,10 de estranho");

            Assert.Greater(b.ChanceDeEsquiva(bruxoDeFogo, seiveiro),
                           b.ChanceDeEsquiva(bruxoDeFogo, bufo),
                "o Seiveiro prende MELHOR (12 contra 8) e ainda assim segura MENOS: " +
                "é a rivalidade fogo↔água pagando");
        }

        /// <summary>
        /// Falhar no teste cancela o passo E leva todo o PP restante.
        ///
        /// "Perder o PP e ainda assim andar" seria contraditório — é isso que dá
        /// dentes à Fixação. O sorteio travado no teto força a falha; travado no
        /// piso, força o sucesso. Os dois lados no mesmo teste, porque um sem o
        /// outro não distingue "falhou" de "nunca testou".
        /// </summary>
        [Test]
        public void Falhar_na_fixacao_cancela_o_passo_e_zera_o_PP()
        {
            var mapa = Cenario.Aberta(9, 3);
            var ladino = Cenario.Heroi("espadachim", "h1", 1, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 2, 1);
            var b = Cenario.Montar(mapa, Sorte.Fixa(0.9999), ladino, vergasta);

            Assert.AreSame(ladino, b.Atual);
            Assert.IsTrue(b.Arriscada(Cenario.Ponto(1, 0)), "sair de perto dela cobra teste");
            Assert.IsFalse(b.Arriscada(Cenario.Ponto(2, 0)), "continuar colado nela, não");

            var r = b.Andar(Cenario.Ponto(1, 0));
            Assert.IsFalse(r.Valido);
            Assert.IsTrue(r.Tem(TipoDeEvento.EsquivaFalhou));
            Assert.AreEqual(Cenario.Ponto(1, 1), ladino.Casa, "não saiu do lugar");
            Assert.AreEqual(0, ladino.PP, "e perdeu os 4 PP");
            Assert.AreEqual(0, b.AlcanceDePasso().Count, "o turno acabou para o passo");
        }

        [Test]
        public void Passando_no_teste_o_passo_sai_normalmente()
        {
            var mapa = Cenario.Aberta(9, 3);
            var ladino = Cenario.Heroi("espadachim", "h1", 1, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 2, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, ladino, vergasta);

            var r = b.Andar(Cenario.Ponto(1, 0));
            Assert.IsTrue(r.Valido);
            Assert.IsTrue(r.Tem(TipoDeEvento.EsquivaOk));
            Assert.AreEqual(Cenario.Ponto(1, 0), ladino.Casa);
            Assert.AreEqual(3, ladino.PP, "custou o passo, e só");
        }

        [Test]
        public void Andar_sem_largar_ninguem_nao_cobra_teste()
        {
            var mapa = Cenario.Aberta(9, 3);
            var ladino = Cenario.Heroi("espadachim", "h1", 1, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 2, 1);
            var b = Cenario.Montar(mapa, Sorte.Fixa(0.9999), ladino, vergasta);

            // Rodeia a Vergasta sem nunca deixar de estar colado nela: mesmo com
            // o sorteio travado na falha, não há teste para falhar.
            var r = b.Andar(Cenario.Ponto(2, 0));
            Assert.IsTrue(r.Valido);
            Assert.IsFalse(r.Tem(TipoDeEvento.EsquivaFalhou));
            Assert.AreEqual(2, ladino.PP, "duas casas contornando");
        }
    }
}
