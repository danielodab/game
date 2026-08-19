using NUnit.Framework;
using Soterra.Motor;

namespace Soterra.Testes.Motor
{
    // `Motor.X` dentro de `Soterra.Testes.Motor` acha o PROPRIO namespace de
    // teste antes de chegar em `Soterra.Motor`, e some com o tipo. O apelido
    // global trava no lugar certo — mesma armadilha do apelido de `Batalha`.
    using Motor = global::Soterra.Motor;

    using Batalha = global::Soterra.Motor.Batalha;

    /// <summary>
    /// Mirar e lançar: alcance, alvo, PA.
    /// </summary>
    public class ConjurarTests
    {
        /// <summary>
        /// FEITIÇO DE ÁREA MIRA O CHÃO.
        ///
        /// O Cone de Cinzas do Bruxo (<c>targetSide: enemy</c>, cone de
        /// tamanho 3) é largado numa casa VAZIA e ainda assim pega os dois
        /// inimigos que estão dentro do cone. Sem esta regra,
        /// <c>targetSide: enemy</c> exigiria um inimigo na própria casa: não
        /// daria para largar a explosão ENTRE dois nem chutar onde o outro vai
        /// estar — meia mecânica de posicionamento jogada fora.
        /// </summary>
        [Test]
        public void Feitico_de_area_mira_o_chao_e_pega_dois_sem_ninguem_no_alvo()
        {
            //  y=2  . . . . a . . .      'a' e 'b' são as duas Vergastas
            //  y=1  B . . X . . . .      X é a casa-alvo, VAZIA
            //  y=0  . . . . b . . .
            var mapa = Cenario.Aberta(8, 3);
            var bruxo = Cenario.Heroi("bruxo", "h1", 0, 1, "fogo", 1);
            var cima = Cenario.Monstro("thorn-lasher", "m1", 4, 2);
            var baixo = Cenario.Monstro("thorn-lasher", "m2", 4, 0);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, bruxo, cima, baixo);

            var alvo = Cenario.Ponto(3, 1);
            Assert.IsNull(b.EmCasa(alvo), "a casa-alvo está vazia");

            var area = b.AreaDe("bruxo-fogo-10", alvo);
            Assert.IsTrue(Cenario.Contem(area, Cenario.Ponto(4, 2)), "o cone abre para cima");
            Assert.IsTrue(Cenario.Contem(area, Cenario.Ponto(4, 0)), "e para baixo");

            Assert.IsTrue(b.PodeConjurar("bruxo-fogo-10", alvo),
                "com área de verdade, a casa-alvo é um LUGAR: basta estar no alcance");
            var r = b.Conjurar("bruxo-fogo-10", alvo);

            Assert.IsTrue(r.Valido);
            Assert.Greater(r.PvPerdidoPor("m1"), 0, "a de cima apanhou");
            Assert.Greater(r.PvPerdidoPor("m2"), 0, "a de baixo também");
        }

        /// <summary>
        /// E o contrário: alvo ÚNICO exige criatura na casa. É o que impede
        /// gastar 3 PA batendo no chão.
        /// </summary>
        [Test]
        public void Alvo_unico_exige_criatura_na_casa()
        {
            var mapa = Cenario.Aberta(8, 3);
            var barbaro = Cenario.Heroi("sumo", "h1", 1, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 2, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, barbaro, vergasta);

            Cenario.AteAVezDe(b, "h1");

            // Machadada de Ferro: alcance 1..1, alvo único, `targetSide: enemy`.
            Assert.IsFalse(b.PodeConjurar("sumo-neutro-1", Cenario.Ponto(1, 0)),
                           "casa vizinha vazia não é alvo");
            Assert.IsFalse(b.PodeConjurar("sumo-neutro-1", Cenario.Ponto(1, 1)),
                           "nem a própria casa");
            Assert.IsTrue(b.PodeConjurar("sumo-neutro-1", Cenario.Ponto(2, 1)),
                          "a Vergasta, sim");

            var alvos = b.AlvosDe("sumo-neutro-1");
            Assert.AreEqual(1, alvos.Count, "há exatamente um alvo legítimo em campo");
            Assert.AreEqual(Cenario.Ponto(2, 1), alvos[0]);

            // O ALCANCE é outra pergunta: ele existe mesmo sem alvo nenhum, e é
            // o que a interface pinta ao escolher o feitiço. Pintar só os alvos
            // faria um corpo a corpo sem ninguém ao lado não pintar NADA, e o
            // jogador leria isso como botão quebrado.
            Assert.AreEqual(4, b.AlcanceDe("sumo-neutro-1").Count,
                            "as quatro casas vizinhas, com ou sem gente em cima");
        }

        /// <summary>
        /// O Tiro Perfurante é `line` de tamanho 7: atravessa a fila inteira a
        /// partir da casa-alvo, afastando-se do atirador.
        /// </summary>
        [Test]
        public void Tiro_perfurante_pega_a_fila_inteira_a_partir_do_chao_mirado()
        {
            var mapa = Cenario.Aberta(10, 3);
            var batedor = Cenario.Heroi("arqueiro", "h1", 0, 1, "terra", 2);
            var perto = Cenario.Monstro("thorn-lasher", "m1", 3, 1);
            var longe = Cenario.Monstro("thorn-lasher", "m2", 6, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, batedor, perto, longe);

            Assert.IsTrue(batedor.Feiticos.Contains("arqueiro-terra-12"));
            Cenario.AteAVezDe(b, "h1");

            var alvo = Cenario.Ponto(2, 1);
            Assert.IsNull(b.EmCasa(alvo));

            var r = b.Conjurar("arqueiro-terra-12", alvo);
            Assert.IsTrue(r.Valido, r.Recusa);
            Assert.Greater(r.PvPerdidoPor("m1"), 0);
            Assert.Greater(r.PvPerdidoPor("m2"), 0, "sete casas de linha alcançam a segunda fila");
        }

        [Test]
        public void Alcance_minimo_existe_e_o_alvo_colado_fica_de_fora()
        {
            // Flecha Anotada: alcance 2..7. Inimigo colado NÃO é alvo — é o que
            // separa um atirador de um espadachim.
            var mapa = Cenario.Aberta(12, 3);
            var batedor = Cenario.Heroi("arqueiro", "h1", 1, 1);
            var colada = Cenario.Monstro("thorn-lasher", "m1", 2, 1);
            var longe = Cenario.Monstro("thorn-lasher", "m2", 6, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, batedor, colada, longe);

            Cenario.AteAVezDe(b, "h1");

            Assert.IsFalse(b.PodeConjurar("arqueiro-neutro-1", Cenario.Ponto(2, 1)),
                           "distância 1 é menor que o mínimo 2");
            Assert.IsTrue(b.PodeConjurar("arqueiro-neutro-1", Cenario.Ponto(6, 1)),
                          "distância 5 cabe em 2..7");
        }

        [Test]
        public void Sem_PA_o_feitico_nao_sai_e_a_recusa_diz_por_que()
        {
            var mapa = Cenario.Aberta(10, 3);
            var batedor = Cenario.Heroi("arqueiro", "h1", 1, 1);
            var vespa = Cenario.Monstro("lantern-wasp", "m1", 5, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, batedor, vespa);

            Cenario.AteAVezDe(b, "h1");
            Assert.AreEqual(6, batedor.PA);

            // Flecha Anotada custa 3 PA e sai no máximo 2× por turno: 6 PA
            // dão exatamente as duas.
            Assert.IsTrue(b.Conjurar("arqueiro-neutro-1", vespa.Casa).Valido);
            Assert.IsTrue(b.Conjurar("arqueiro-neutro-1", vespa.Casa).Valido);
            Assert.AreEqual(0, batedor.PA);

            var r = b.Conjurar("arqueiro-neutro-1", vespa.Casa);
            Assert.IsFalse(r.Valido);
            StringAssert.Contains("PA", r.Recusa);
            Assert.AreEqual(0, b.AlvosDe("arqueiro-neutro-1").Count,
                            "sem PA não há alvo para pintar");
        }

        [Test]
        public void Feitico_que_a_unidade_nao_sabe_nao_sai()
        {
            var mapa = Cenario.Aberta(10, 3);
            var batedor = Cenario.Heroi("arqueiro", "h1", 1, 1);   // só os três neutros
            var vespa = Cenario.Monstro("lantern-wasp", "m1", 4, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, batedor, vespa);

            Cenario.AteAVezDe(b, "h1");

            var r = b.Conjurar("arqueiro-terra-12", vespa.Casa);
            Assert.IsFalse(r.Valido, "o Tiro Perfurante abre no nível 12 do caminho de terra");
            Assert.AreEqual(6, batedor.PA, "recusa não cobra PA");

            var desconhecido = b.Conjurar("nao-existe", vespa.Casa);
            Assert.IsFalse(desconhecido.Valido);
            StringAssert.Contains("desconhecido", desconhecido.Recusa);
        }

        /// <summary>
        /// O obstáculo ALTO corta a linha de visão; o BAIXO não. É o que faz
        /// cobertura existir, e todo feitiço com <c>los: true</c> depende disso.
        /// </summary>
        [Test]
        public void Parede_alta_tira_o_alvo_e_a_mureta_nao()
        {
            // Mesma geometria nas duas salas, um símbolo de diferença:
            //   . . . . .        . . . . .
            //   B # a . .        B = a . .
            //   . . . . .        . . . . .
            var comAlto = Cenario.Sala(".....", ".#...", ".....");
            var batedor = Cenario.Heroi("arqueiro", "h1", 0, 1);
            var vespa = Cenario.Monstro("lantern-wasp", "m1", 2, 1);
            var b1 = Cenario.Montar(comAlto, Sorte.SempreOMinimo, batedor, vespa);
            Cenario.AteAVezDe(b1, "h1");
            Assert.IsFalse(b1.PodeConjurar("arqueiro-neutro-1", Cenario.Ponto(2, 1)),
                           "'#' bloqueia a visão: sem alvo");

            var comBaixo = Cenario.Sala(".....", ".=...", ".....");
            var batedor2 = Cenario.Heroi("arqueiro", "h2", 0, 1);
            var vespa2 = Cenario.Monstro("lantern-wasp", "m2", 2, 1);
            var b2 = Cenario.Montar(comBaixo, Sorte.SempreOMinimo, batedor2, vespa2);
            Cenario.AteAVezDe(b2, "h2");
            Assert.IsTrue(b2.PodeConjurar("arqueiro-neutro-1", Cenario.Ponto(2, 1)),
                          "'=' é cobertura, não parede: o tiro passa por cima");
        }
    }
}
