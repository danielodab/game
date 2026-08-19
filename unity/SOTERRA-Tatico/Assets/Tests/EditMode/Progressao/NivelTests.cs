using NUnit.Framework;
using Soterra.Progressao;

namespace Soterra.Testes.Progressao
{
    /// <summary>
    /// A escada de XP e o que cada degrau paga.
    ///
    /// Todo número sai de <c>leveling.json</c>. A tabela está congelada por
    /// coordenação com o <c>xp</c> dos monstros — os dois descrevem a mesma
    /// economia por pontas opostas —, então um teste que digitasse "125" para o
    /// nível 5 pararia de falar do nível 5 no dia em que a curva mudasse.
    /// </summary>
    public class NivelTests
    {
        [Test]
        public void A_tabela_de_XP_tem_30_degraus_e_o_nivel_sai_dela()
        {
            var banco = Bancada.Real();
            var tabela = banco.Nivelamento.TabelaDeXp;
            Assert.AreEqual(30, tabela.Count, "a curva do jogo é de 30 níveis");
            Assert.AreEqual(30, banco.Nivelamento.NivelMaximo);
            Assert.AreEqual(0, tabela[0], "o índice 0 é o nível 1, e ele custa zero");

            var p = Bancada.Novo(banco);
            Assert.AreEqual(1, p.NivelPorXp(0));
            Assert.AreEqual(1, p.NivelPorXp(tabela[1] - 1), "um ponto abaixo do degrau ainda é o nível de baixo");
            Assert.AreEqual(2, p.NivelPorXp(tabela[1]), "a tabela é ACUMULADA: bater no valor já é o nível");
            Assert.AreEqual(5, p.NivelPorXp(tabela[4]));
            Assert.AreEqual(30, p.NivelPorXp(tabela[29]));
        }

        [Test]
        public void A_XP_para_no_ultimo_degrau_e_nao_acumula_alem_dele()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var teto = banco.Nivelamento.TabelaDeXp[29];

            p.AdicionarXp("sumo", teto * 10);

            Assert.AreEqual(30, p.NivelDe("sumo"));
            Assert.AreEqual(teto, p.Heroi("sumo").Xp, "XP guardada acima do teto viraria nível fantasma");
            Assert.AreEqual(0, p.AdicionarXp("sumo", 1000), "no nível 30 não se sobe mais");

            var info = p.XpDe("sumo");
            Assert.AreEqual(-1, info.XpDoProximo, "não há próximo degrau");
            Assert.AreEqual(1.0, info.Fracao, 0.0001);
        }

        [Test]
        public void AdicionarXp_devolve_QUANTOS_niveis_a_sala_valeu()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var tabela = banco.Nivelamento.TabelaDeXp;

            // Uma tacada que atravessa quatro degraus de uma vez: a tela precisa
            // saber que foram quatro, não que "subiu".
            Assert.AreEqual(4, p.AdicionarXp("sumo", tabela[4]));
            Assert.AreEqual(5, p.NivelDe("sumo"));
            Assert.AreEqual(0, p.AdicionarXp("sumo", 0), "XP zero não move nada");
            Assert.AreEqual(0, p.AdicionarXp("sumo", -100), "XP negativa não rouba nível");
        }

        [Test]
        public void Cada_nivel_paga_PV_e_o_poder_vira_ELEMENTAL_depois_da_escolha()
        {
            var banco = Bancada.Real();
            var n = banco.Nivelamento;
            var basePv = banco.Classes["sumo"].Atributos.Pv;

            var p = Bancada.Novo(banco);
            Bancada.LevarAoNivel(p, "sumo", 5);

            // 4 subidas até o nível 5: as 3 primeiras (`elementChoiceLevel - 2`)
            // são genéricas e a quarta já é do trecho elemental.
            var antes = p.FichaDeCombate("sumo");
            Assert.AreEqual(basePv + n.PorNivel.Pv * 3 + n.PorNivelComElemento.Pv * 1, antes.Pv);
            Assert.AreEqual(n.PorNivel.Poder * 4, antes.Poder,
                "sem elemento escolhido, TODA subida ainda paga poder genérico");
            Assert.AreEqual(0, antes.PoderElemental);

            Assert.IsTrue(p.EscolherElemento("sumo", "terra"));
            var depois = p.FichaDeCombate("sumo");

            Assert.AreEqual(antes.Pv, depois.Pv, "escolher elemento não mexe em PV");
            Assert.AreEqual(n.PorNivel.Poder * 3, depois.Poder,
                "as subidas do trecho elemental deixam de pagar poder genérico");
            Assert.AreEqual(n.PorNivelComElemento.PoderElemental * 1, depois.PoderElemental,
                "e passam a pagar poder do elemento escolhido");
        }

        [Test]
        public void Esquiva_e_fixacao_sobem_no_ritmo_do_PAPEL_ate_o_nivel_maximo()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);

            var baseDoBarbaro = banco.Classes["sumo"].Atributos;
            var alvoDoTanque = banco.Nivelamento.DefesaPorPapel["tanque"];

            var nivel1 = p.DefesaNoNivel("sumo", 1);
            Assert.AreEqual(baseDoBarbaro.Esquiva, nivel1.Esquiva, "no nível 1 a curva não deu nada ainda");
            Assert.AreEqual(baseDoBarbaro.Fixacao, nivel1.Fixacao);

            var nivel30 = p.DefesaNoNivel("sumo", 30);
            Assert.AreEqual(alvoDoTanque.Esquiva, nivel30.Esquiva, "no nível máximo chega exatamente no alvo do papel");
            Assert.AreEqual(alvoDoTanque.Fixacao, nivel30.Fixacao);

            // Meio da curva: reta, então o ganho é proporcional aos degraus.
            var nivel15 = p.DefesaNoNivel("sumo", 15);
            Assert.Greater(nivel15.Fixacao, nivel1.Fixacao);
            Assert.Less(nivel15.Fixacao, nivel30.Fixacao);
        }

        [Test]
        public void Calabouco_facil_demais_paga_menos_XP_e_nunca_zero()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);

            var estufa = banco.AchaCalabouco("greenhouse");
            var queda = banco.Nivelamento.QuedaDeXp;
            var ondeAindaVale = estufa.NivelRecomendado + queda.NiveisDeGraca;

            Assert.AreEqual(1.0, p.MultiplicadorDeXp(ondeAindaVale, "greenhouse"), 0.0001,
                "dentro da faixa de graça a XP é cheia");
            Assert.AreEqual(queda.FatorPorNivel, p.MultiplicadorDeXp(ondeAindaVale + 1, "greenhouse"), 0.0001,
                "um nível acima já cobra o fator");
            Assert.AreEqual(queda.Piso, p.MultiplicadorDeXp(30, "greenhouse"), 0.0001,
                "no nível 30 a Estufa paga o piso — pouco, mas nunca nada");

            Assert.AreEqual(1.0, p.MultiplicadorDeXp(30, "calabouco-que-nao-existe"), 0.0001,
                "sem dado do calabouço não se corta nada: cortar por arquivo ausente é castigar o jogador");
        }
    }
}
