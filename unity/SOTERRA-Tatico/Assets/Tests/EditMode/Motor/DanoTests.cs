using NUnit.Framework;
using Soterra.Motor;

namespace Soterra.Testes.Motor
{
    using Batalha = global::Soterra.Motor.Batalha;

    /// <summary>
    /// Quanto dói. Todo número esperado aqui é uma conta feita com os valores do
    /// acervo — faixa do feitiço, resistência do bicho —, e nunca um número
    /// escolhido porque "parece razoável".
    /// </summary>
    public class DanoTests
    {
        /// <summary>
        /// A faixa do acervo é FECHADA nas duas pontas: 26–33 tem de poder dar
        /// 26 e tem de poder dar 33. Com o sorteio travado, o teste cobra o
        /// número exato em vez de um intervalo que quase tudo satisfaz.
        /// </summary>
        [Test]
        public void Cone_de_Cinzas_da_o_piso_e_o_teto_da_faixa_do_acervo()
        {
            // 26 × 1,20 = 31,2 → 31 ·  33 × 1,20 = 39,6 → 40
            // (o 1,20 é a resistência de −20 a fogo da Vergasta: planta queima)
            Assert.AreEqual(31, ConeDeCinzasEm(Sorte.SempreOMinimo));
            Assert.AreEqual(40, ConeDeCinzasEm(Sorte.SempreOMaximo));
        }

        static int ConeDeCinzasEm(Sorte sorte)
        {
            var mapa = Cenario.Aberta(8, 3);
            var bruxo = Cenario.Heroi("bruxo", "h1", 0, 1, "fogo", 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 4, 1);
            var b = Cenario.Montar(mapa, sorte, bruxo, vergasta);
            Cenario.AteAVezDe(b, "h1");
            return b.Conjurar("bruxo-fogo-10", Cenario.Ponto(3, 1)).PvPerdidoPor("m1");
        }

        /// <summary>
        /// Resistência NEGATIVA é fraqueza, e é metade do bestiário: a Vergasta
        /// tem −20 a fogo e +20 a terra. Um motor com piso em zero apagaria a
        /// primeira metade sem quebrar nenhuma outra conta.
        /// </summary>
        [Test]
        public void Resistencia_negativa_aumenta_o_dano_e_a_positiva_corta()
        {
            var mapaA = Cenario.Aberta(10, 3);
            var bruxo = Cenario.Heroi("bruxo", "h1", 0, 1, "fogo", 1);
            var alvoFogo = Cenario.Monstro("thorn-lasher", "m1", 4, 1);
            var bA = Cenario.Montar(mapaA, Sorte.SempreOMinimo, bruxo, alvoFogo);
            Cenario.AteAVezDe(bA, "h1");
            int fogo = bA.Conjurar("bruxo-fogo-10", Cenario.Ponto(3, 1)).PvPerdidoPor("m1");

            var mapaB = Cenario.Aberta(10, 3);
            var batedor = Cenario.Heroi("arqueiro", "h2", 0, 1, "terra", 2);
            var alvoTerra = Cenario.Monstro("thorn-lasher", "m2", 4, 1);
            var bB = Cenario.Montar(mapaB, Sorte.SempreOMinimo, batedor, alvoTerra);
            Cenario.AteAVezDe(bB, "h2");
            int terra = bB.Conjurar("arqueiro-terra-12", Cenario.Ponto(2, 1)).PvPerdidoPor("m2");

            Assert.AreEqual(-20, alvoFogo.Resistencias.De("fogo"), "a ficha da Vergasta");
            Assert.AreEqual(20, alvoTerra.Resistencias.De("terra"));

            Assert.AreEqual(31, fogo, "26 de piso × 1,20 = 31,2 → 31");
            Assert.AreEqual(24, terra, "30 de piso × 0,80 = 24");
        }

        /// <summary>
        /// O escudo come primeiro, e o que sobra é que sai do PV. Somar o número
        /// do evento de dano daria o dano BRUTO — e é por isso que o resultado
        /// devolve os dois, bruto e absorvido.
        /// </summary>
        [Test]
        public void Escudo_absorve_antes_do_PV_e_acaba_no_meio_do_segundo_golpe()
        {
            var mapa = Cenario.Aberta(9, 3);
            var barbaro = Cenario.Heroi("sumo", "h1", 1, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 4, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, barbaro, vergasta);

            Cenario.AteAVezDe(b, "h1");
            Assert.IsTrue(b.Conjurar("sumo-neutro-2", barbaro.Casa).Valido,
                          "Grito de Guerra é `targetSide: self` — cai na própria casa");
            Assert.AreEqual(30, barbaro.Escudo, "o escudo do acervo vale 30");
            Assert.AreEqual(150, barbaro.PV);

            b.EncerrarTurno();
            Assert.AreSame(vergasta, b.Atual);

            // Farpa: 12–16 de terra, e o Bárbaro não resiste a terra.
            var primeira = b.Conjurar("m-thorn-shot", barbaro.Casa);
            Assert.AreEqual(0, primeira.PvPerdidoPor("h1"), "16 de dano, 16 absorvidos");
            Assert.AreEqual(14, barbaro.Escudo);
            Assert.AreEqual(150, barbaro.PV);

            var segunda = b.Conjurar("m-thorn-shot", barbaro.Casa);
            Assert.AreEqual(2, segunda.PvPerdidoPor("h1"), "16 de dano, 14 absorvidos, 2 no couro");
            Assert.AreEqual(0, barbaro.Escudo);
            Assert.AreEqual(148, barbaro.PV);
        }

        /// <summary>
        /// Marca não machuca sozinha: ela faz o PRÓXIMO golpe doer mais.
        /// <c>1 + Σ(valor)/100</c>, e com o <c>value: 5</c> canônico isso é
        /// exatamente +5% por pilha.
        /// </summary>
        [Test]
        public void Marca_faz_o_corpo_marcado_apanhar_mais_no_golpe_seguinte()
        {
            var mapa = Cenario.Aberta(10, 3);
            var batedor = Cenario.Heroi("arqueiro", "h1", 1, 1);
            var vespa = Cenario.Monstro("lantern-wasp", "m1", 5, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, batedor, vespa);
            Cenario.AteAVezDe(b, "h1");

            var primeira = b.Conjurar("arqueiro-neutro-1", vespa.Casa);
            Assert.AreEqual(18, primeira.PvPerdidoPor("m1"), "sem marca nenhuma, o piso da faixa");

            var segunda = b.Conjurar("arqueiro-neutro-1", vespa.Casa);
            Assert.AreEqual(19, segunda.PvPerdidoPor("m1"), "18 × 1,05 = 18,9 → 19");
            Assert.AreEqual(48 - 18 - 19, vespa.PV);
        }

        /// <summary>
        /// Detonar é dano LITERAL: pilhas × multiplicador, sem poder, sem
        /// resistência e sem o multiplicador das próprias marcas — elas acabaram
        /// de ser gastas, e contá-las de novo dobraria o efeito.
        /// </summary>
        [Test]
        public void Marcas_detonadas_sao_dano_literal_e_somem_do_corpo()
        {
            var mapa = Cenario.Aberta(10, 3);
            var batedor = Cenario.Heroi("arqueiro", "h1", 1, 1);
            var vespa = Cenario.Monstro("lantern-wasp", "m1", 5, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, batedor, vespa);
            Cenario.AteAVezDe(b, "h1");

            b.Conjurar("arqueiro-neutro-1", vespa.Casa);          // 18 e uma marca
            Assert.AreEqual(30, vespa.PV);

            // Cobrar a Conta: detona as marcas (×9) e depois bate 8–12.
            var r = b.Conjurar("arqueiro-neutro-3", vespa.Casa);
            Assert.IsTrue(r.Valido, r.Recusa);

            var detonou = r.Do(TipoDeEvento.MarcasDetonadas);
            Assert.AreEqual(1, detonou.Count);
            Assert.AreEqual(1, detonou[0].Quantidade, "uma pilha");

            Assert.AreEqual(1 * 9 + 8, r.PvPerdidoPor("m1"), "9 de detonação e 8 do piso da faixa");
            Assert.AreEqual(13, vespa.PV);
            Assert.AreEqual(1.0, b.MultiplicadorDeMarcas(vespa), 1e-9, "as marcas se foram");
        }

        /// <summary>
        /// Empurrar contra parede cobra 10 por casa que faltou percorrer. Dano
        /// FIXO, sem poder e sem resistência: quem machuca é o muro.
        /// </summary>
        [Test]
        public void Empurrao_contra_parede_cobra_dez_e_o_alvo_nao_sai_do_lugar()
        {
            //  y=1  . B a # .    a Vespa está encostada na parede
            var mapa = Cenario.Sala(".....", "...#.", ".....");
            var barbaro = Cenario.Heroi("sumo", "h1", 1, 1);
            var vespa = Cenario.Monstro("lantern-wasp", "m1", 2, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, barbaro, vespa);
            Cenario.AteAVezDe(b, "h1");

            var r = b.Conjurar("sumo-neutro-1", vespa.Casa);
            Assert.IsTrue(r.Valido, r.Recusa);

            var empurrao = r.Do(TipoDeEvento.Empurrao);
            Assert.AreEqual(1, empurrao.Count);
            Assert.AreEqual(10, empurrao[0].Quantidade, "uma casa que não deu para andar");
            Assert.AreEqual(Cenario.Ponto(2, 1), vespa.Casa, "não saiu do lugar");
            Assert.AreEqual(48 - 20 - 10, vespa.PV, "20 de machadada e 10 de parede");
        }

        [Test]
        public void A_Vergasta_nao_se_move_um_palmo()
        {
            var mapa = Cenario.Aberta(6, 3);
            var barbaro = Cenario.Heroi("sumo", "h1", 1, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 2, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, barbaro, vergasta);
            Cenario.AteAVezDe(b, "h1");

            Assert.IsTrue(vergasta.ImuneAEmpurrao, "o traço `pushImmune` da ficha dela");

            var r = b.Conjurar("sumo-neutro-1", vergasta.Casa);
            Assert.IsFalse(r.Tem(TipoDeEvento.Empurrao));
            Assert.AreEqual(Cenario.Ponto(2, 1), vergasta.Casa);
            Assert.AreEqual(50 - 20, vergasta.PV, "só a machadada, sem colisão");
        }

        /// <summary>
        /// O que este motor ainda NÃO faz, ele DIZ.
        ///
        /// O Passo de Corça é um <c>moveTo</c>, e <c>moveTo</c> ficou fora desta
        /// rodada (relatório). Ignorar em silêncio faria o Batedor gastar 2 PA e
        /// não sair do lugar, e o defeito seria lido como "o passo sumiu".
        /// </summary>
        [Test]
        public void Efeito_ainda_nao_implementado_e_anunciado_e_nao_engolido()
        {
            var mapa = Cenario.Aberta(10, 3);
            var batedor = Cenario.Heroi("arqueiro", "h1", 1, 1);
            var vespa = Cenario.Monstro("lantern-wasp", "m1", 6, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, batedor, vespa);
            Cenario.AteAVezDe(b, "h1");

            var r = b.Conjurar("arqueiro-neutro-2", Cenario.Ponto(3, 1));
            Assert.IsTrue(r.Valido);

            var ignorados = r.Do(TipoDeEvento.EfeitoIgnorado);
            Assert.AreEqual(1, ignorados.Count);
            Assert.AreEqual("moveTo", ignorados[0].Detalhe);
        }
    }
}
