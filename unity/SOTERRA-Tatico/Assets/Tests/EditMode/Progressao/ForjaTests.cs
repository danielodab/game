using NUnit.Framework;
using Soterra.Progressao;

namespace Soterra.Testes.Progressao
{
    /// <summary>
    /// As duas trilhas de poder que existem: a FORJA, que sobe a peça até o
    /// +10, e a ESTRELA DE CLASSE, que troca carta excedente por bônus fixo.
    ///
    /// Não há uma terceira. O SISTEMAS §8 já descreveu uma trilha de estrela de
    /// ITEM — três peças iguais viram ★1, com teto de 2,50× — e ela NÃO EXISTE
    /// em nenhum arquivo de <c>Assets/Resources/dados/</c>: era plano nunca
    /// construído. Não há teste para ela porque não há código para ela.
    ///
    /// O teste que segura o jogo inteiro é
    /// <see cref="Nem_a_forja_nem_a_estrela_inflam_PA_ou_PP_alem_de_mais_1"/>.
    /// PA e PP são o esqueleto do turno: um +1 PA que virasse +2 dá ao herói uma
    /// ação a mais TODO turno, e a conta de dano do jogo deixa de valer.
    /// </summary>
    public class ForjaTests
    {
        [Test]
        public void Forjar_sobe_um_degrau_e_come_a_pedra_do_ELEMENTO_do_item()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var custos = banco.Forja.CustoEmPedras;

            p.AdicionarItem("gh-widow-shears");           // Tesourão da Viúva: terra
            var pedraDeTerra = p.PedraDoElemento("terra");
            p.AdicionarPedras(pedraDeTerra, 100);
            p.AdicionarPedras(p.PedraDoElemento("fogo"), 100);

            var orcamento = p.InfoDeForjaNoSaco(0);
            Assert.AreEqual(pedraDeTerra, orcamento.IdDaPedra, "peça de terra come pedra de terra");
            Assert.AreEqual(custos[0], orcamento.Custo);
            Assert.IsTrue(orcamento.TemPedras);

            Assert.IsTrue(p.Forjar(0));
            Assert.AreEqual(1, p.Estado.Saco[0].NivelDeForja);
            Assert.AreEqual(100 - custos[0], p.ContarPedras(pedraDeTerra));
            Assert.AreEqual(100, p.ContarPedras(p.PedraDoElemento("fogo")),
                "a pedra do elemento errado não é tocada");
        }

        [Test]
        public void Sem_pedra_a_forja_nao_acontece_e_nada_e_consumido()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);

            p.AdicionarItem("gh-widow-shears");
            var pedra = p.PedraDoElemento("terra");
            p.AdicionarPedras(pedra, banco.Forja.CustoEmPedras[0] - 1);

            Assert.IsFalse(p.InfoDeForjaNoSaco(0).TemPedras);
            Assert.IsFalse(p.Forjar(0));
            Assert.AreEqual(0, p.Estado.Saco[0].NivelDeForja, "não subiu");
            Assert.AreEqual(banco.Forja.CustoEmPedras[0] - 1, p.ContarPedras(pedra),
                "e não gastou: a forja nunca consome sem subir");
        }

        [Test]
        public void No_mais_10_o_item_vale_2_20_vezes_o_cru_e_ali_ele_para()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var teto = banco.Forja.NivelMaximo;

            p.AdicionarItem("gh-widow-shears");
            p.AdicionarPedras(p.PedraDoElemento("terra"), 9999);
            for (int i = 0; i < teto; i++) Assert.IsTrue(p.Forjar(0), "degrau " + i);

            Assert.AreEqual(teto, p.Estado.Saco[0].NivelDeForja);
            var noTeto = p.InfoDeForjaNoSaco(0);
            Assert.IsTrue(noTeto.NoMaximo);
            Assert.AreEqual(0, noTeto.Custo);
            Assert.IsFalse(p.Forjar(0), "acima do +10 não há degrau, mesmo com pedra sobrando");

            // 1 + 0,12 × 10 = 2,20 — o número sai de `upgrade.bonusPerLevel`.
            var esperado = 1.0 + banco.Forja.BonusPorNivel * teto;
            Assert.AreEqual(esperado, p.MultiplicadorDeForja(teto), 0.0001);
            Assert.AreEqual(2.20, p.MultiplicadorDeForja(teto), 0.0001,
                "é o 2,20× que o SISTEMAS §8 promete");

            p.Equipar("sumo", "gh-widow-shears");
            var poderCru = banco.Itens["gh-widow-shears"].Bonus.Poder;
            Assert.AreEqual(banco.Classes["sumo"].Atributos.Poder +
                            (int)System.Math.Floor(poderCru * esperado + 0.5),
                            p.FichaDeCombate("sumo").Poder,
                "o poder da peça escala com a forja");
        }

        [Test]
        public void Nem_a_forja_nem_a_estrela_inflam_PA_ou_PP_alem_de_mais_1()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var atributos = banco.Classes["sumo"].Atributos;
            var teto = banco.Forja.NivelMaximo;

            // `upgrade.nonScalingKeys` é o que segura isto, e ele vem do DADO.
            CollectionAssert.Contains(banco.Forja.AtributosQueNaoEscalam, "pa");
            CollectionAssert.Contains(banco.Forja.AtributosQueNaoEscalam, "pp");

            p.AdicionarItem("gh-widow-shears");    // +1 PA
            p.AdicionarItem("gh-vine-stirrups");   // +1 PP
            p.AdicionarPedras(p.PedraDoElemento("terra"), 9999);
            for (int i = 0; i < teto; i++) { p.Forjar(0); p.Forjar(1); }
            Assert.AreEqual(teto, p.Estado.Saco[0].NivelDeForja);
            Assert.AreEqual(teto, p.Estado.Saco[1].NivelDeForja);

            p.Equipar("sumo", "gh-widow-shears");
            p.Equipar("sumo", "gh-vine-stirrups");

            var comForja = p.FichaDeCombate("sumo");
            Assert.AreEqual(atributos.Pa + 1, comForja.Pa,
                "o +1 PA do Tesourão continua +1 no +10 — com a forja escalando, 1 × 2,2 viraria 2");
            Assert.AreEqual(atributos.Pp + 1, comForja.Pp, "e o +1 PP dos Estribos idem");

            // A esquiva, que ESCALA, prova que o multiplicador está de fato
            // sendo aplicado — sem ela, o teste passaria com a forja quebrada.
            var esquivaCrua = banco.Itens["gh-vine-stirrups"].Bonus.Esquiva;
            Assert.Greater(comForja.Esquiva, atributos.Esquiva + esquivaCrua,
                "o que escala escalou de verdade");
        }

        [Test]
        public void A_estrela_de_CLASSE_vem_do_excedente_de_cartas_e_o_bonus_e_fixo()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var custos = banco.Cartas["sumo"].CustoDasEstrelas;
            var estrelas = banco.Estrelas;

            CollectionAssert.AreEqual(new[] { 5, 15, 30, 55, 90 }, custos,
                "os custos de estrela do acervo");
            Assert.AreEqual(5, estrelas.Maximo);
            Assert.AreEqual(0, p.InfoDeCarta("sumo").CustoDeDesbloqueio,
                "o Bárbaro já nasce liberado: TODA carta dele é excedente");

            var pvBase = p.FichaDeCombate("sumo").Pv;

            var semEstrela = p.InfoDeCarta("sumo");
            Assert.AreEqual(0, semEstrela.Estrelas);
            Assert.AreEqual(1, semEstrela.ProximaEstrela);
            Assert.AreEqual(custos[0], semEstrela.CartasQueFaltam);

            p.AdicionarCartas("sumo", custos[0]);
            Assert.AreEqual(1, p.InfoDeCarta("sumo").Estrelas);
            Assert.AreEqual(pvBase + estrelas.Bonus[1].Pv, p.FichaDeCombate("sumo").Pv,
                "★1 soma PV direto na ficha — bônus FIXO, não porcentagem");

            p.AdicionarCartas("sumo", custos[4] - custos[0]);
            var noMaximo = p.InfoDeCarta("sumo");
            Assert.AreEqual(5, noMaximo.Estrelas);
            Assert.AreEqual(0, noMaximo.ProximaEstrela, "no ★5 não há próxima");

            // Os cinco degraus são CUMULATIVOS: o ★5 vale ★1+★2+★3+★4+★5.
            var ficha = p.FichaDeCombate("sumo");
            Assert.AreEqual(pvBase + estrelas.Bonus[1].Pv + estrelas.Bonus[4].Pv, ficha.Pv);
            Assert.AreEqual(banco.Classes["sumo"].Atributos.Poder + estrelas.Bonus[2].Poder, ficha.Poder);
        }

        [Test]
        public void A_estrela_3_da_exatamente_um_PP_e_a_estrela_5_exatamente_um_PA()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var atributos = banco.Classes["sumo"].Atributos;
            var custos = banco.Cartas["sumo"].CustoDasEstrelas;

            p.AdicionarCartas("sumo", custos[2]);        // ★3
            Assert.AreEqual(3, p.InfoDeCarta("sumo").Estrelas);
            var no3 = p.FichaDeCombate("sumo");
            Assert.AreEqual(atributos.Pp + 1, no3.Pp, "o ★3 dá UM ponto de passo, e é o que o acervo escreve");
            Assert.AreEqual(atributos.Pa, no3.Pa, "e não toca no PA");

            p.AdicionarCartas("sumo", custos[4] - custos[2]);   // ★5
            var no5 = p.FichaDeCombate("sumo");
            Assert.AreEqual(atributos.Pa + 1, no5.Pa, "o ★5 dá UM ponto de ataque");
            Assert.AreEqual(atributos.Pp + 1, no5.Pp, "e o ★3 continua valendo, sem dobrar");
        }

        [Test]
        public void NENHUMA_fonte_do_acervo_declara_mais_de_um_de_PA_ou_de_PP()
        {
            var banco = Bancada.Real();

            foreach (var par in banco.Itens)
            {
                Assert.LessOrEqual(par.Value.Bonus.Pa, 1, par.Key + " declara mais de +1 PA");
                Assert.LessOrEqual(par.Value.Bonus.Pp, 1, par.Key + " declara mais de +1 PP");
            }
            foreach (var par in banco.Conjuntos)
                foreach (var degrau in par.Value.Bonus)
                {
                    Assert.LessOrEqual(degrau.Value.Pa, 1, par.Key + " [" + degrau.Key + "] passa de +1 PA");
                    Assert.LessOrEqual(degrau.Value.Pp, 1, par.Key + " [" + degrau.Key + "] passa de +1 PP");
                }
            foreach (var par in banco.Bichos)
            {
                Assert.LessOrEqual(par.Value.Bonus.Pa, 1, par.Key + " passa de +1 PA");
                Assert.LessOrEqual(par.Value.Bonus.Pp, 1, par.Key + " passa de +1 PP");
            }
            foreach (var par in banco.Estrelas.Bonus)
            {
                Assert.LessOrEqual(par.Value.Pa, 1, "a estrela " + par.Key + " passa de +1 PA");
                Assert.LessOrEqual(par.Value.Pp, 1, "a estrela " + par.Key + " passa de +1 PP");
            }
        }

        [Test]
        public void Uma_fonte_exagerada_e_APARADA_em_mais_1_pelo_codigo()
        {
            // O acervo hoje se comporta (o teste acima varre os 90 itens), mas
            // o corte não pode depender disso: um item novo com "pa": 3 entraria
            // pelo JSON, sem passar por revisão de código.
            //
            // A cópia é PRÓPRIA: adulterar o acervo compartilhado deixaria o
            // defeito plantado para o próximo teste.
            var banco = Bancada.RealSoParaMim();
            var p = Bancada.Novo(banco);
            var atributos = banco.Classes["sumo"].Atributos;

            banco.Itens["gh-widow-shears"].Bonus.Pa = 5;
            p.AdicionarItem("gh-widow-shears");
            p.Equipar("sumo", "gh-widow-shears");

            Assert.AreEqual(atributos.Pa + Progresso.TetoDePaPorFonte, p.FichaDeCombate("sumo").Pa,
                "um item de +5 PA vale +1: o teto é do código, não da boa vontade do acervo");

            banco.Itens["gh-vine-stirrups"].Bonus.Pp = 4;
            p.AdicionarItem("gh-vine-stirrups");
            p.Equipar("sumo", "gh-vine-stirrups");
            Assert.AreEqual(atributos.Pp + Progresso.TetoDePpPorFonte, p.FichaDeCombate("sumo").Pp,
                "e o mesmo vale para o PP");
        }

        [Test]
        public void A_peca_VESTIDA_tambem_forja_sem_precisar_sair_do_heroi()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);

            p.AdicionarItem("gh-trellis-guard");
            p.Equipar("sumo", "gh-trellis-guard");
            p.AdicionarPedras(p.PedraDoElemento("terra"), 999);

            var pvAntes = p.FichaDeCombate("sumo").Pv;
            Assert.IsNotNull(p.InfoDeForjaVestida("sumo", "casca"));
            Assert.IsTrue(p.ForjarVestida("sumo", "casca"));

            Assert.AreEqual(1, p.Vestido("sumo", "casca").NivelDeForja);
            Assert.Greater(p.FichaDeCombate("sumo").Pv, pvAntes,
                "forjar a peça em uso melhora o herói na hora");
            Assert.AreEqual(0, p.ContarNoSaco("gh-trellis-guard"), "e ela não voltou ao saco para isso");
        }
    }
}
