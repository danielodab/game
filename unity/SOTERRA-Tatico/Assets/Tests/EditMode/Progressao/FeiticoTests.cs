using System.Collections.Generic;
using NUnit.Framework;
using Soterra.Progressao;

namespace Soterra.Testes.Progressao
{
    /// <summary>
    /// A escada de feitiços.
    ///
    /// O teste central deste arquivo é
    /// <see cref="A_escada_sai_do_unlockLevel_do_FEITICO_e_nao_de_uma_lista_cravada"/>,
    /// e ele existe por causa de um defeito real: enquanto os degraus eram uma
    /// lista escrita no código, o dia em que o acervo acrescentou os níveis 10 e
    /// 15 a escada ficou com buraco. O feitiço estava no arquivo, o jogador
    /// subia de nível, nada aparecia — e nenhum teste reclamou, porque todos
    /// eles liam a mesma lista errada.
    /// </summary>
    public class FeiticoTests
    {
        [Test]
        public void A_escada_sai_do_unlockLevel_do_FEITICO_e_nao_de_uma_lista_cravada()
        {
            var banco = Bancada.Laboratorio();
            var p = Bancada.Novo(banco);

            // O caminho da Cobaia é, NESTA ORDEM: `tarde` (abre no 8),
            // `cedo` (abre no 6) e `herdado` (não declara nada, então herda o
            // degrau do índice 2 de `unlockTiers`, que é 12).
            Bancada.LevarAoNivel(p, "lab", 6);
            Assert.IsTrue(p.EscolherElemento("lab", "fogo"));

            var noSeis = p.FeiticosDe("lab");
            Assert.IsTrue(noSeis.Contains("lab-fogo-cedo"),
                "o `cedo` declara 6 e tem de estar aqui — a lista de degraus diria 10 e ele faltaria");
            Assert.IsFalse(noSeis.Contains("lab-fogo-tarde"),
                "o `tarde` declara 8 e NÃO pode estar aqui — a lista de degraus diria 5 e ele sobraria");
            Assert.IsFalse(noSeis.Contains("lab-fogo-herdado"));
            Assert.AreEqual(2, noSeis.Count, "o neutro da classe mais um do caminho");

            Bancada.LevarAoNivel(p, "lab", 8);
            var noOito = p.FeiticosDe("lab");
            Assert.IsTrue(noOito.Contains("lab-fogo-tarde"), "no 8 o `tarde` abre");
            Assert.IsFalse(noOito.Contains("lab-fogo-herdado"), "o herdado só abre no 12");

            // E o degrau HERDADO continua valendo: quem não declara nada cai na
            // lista, que é reserva e não a fonte.
            Bancada.LevarAoNivel(p, "lab", 11);
            Assert.IsFalse(p.FeiticosDe("lab").Contains("lab-fogo-herdado"));
            Bancada.LevarAoNivel(p, "lab", 12);
            Assert.IsTrue(p.FeiticosDe("lab").Contains("lab-fogo-herdado"),
                "sem `unlockLevel` próprio, vale `unlockTiers[2]` = 12");
        }

        [Test]
        public void No_acervo_real_os_seis_degraus_do_caminho_sao_5_10_12_15_20_30()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var caminho = banco.Classes["sumo"].Caminhos["fogo"];

            var esperados = new[] { 5, 10, 12, 15, 20, 30 };
            Assert.AreEqual(esperados.Length, caminho.Count, "o caminho elemental tem seis feitiços");
            for (int i = 0; i < caminho.Count; i++)
                Assert.AreEqual(esperados[i], p.NivelDeDesbloqueio(caminho[i], i),
                    "o degrau de " + caminho[i] + " sai do próprio feitiço");
        }

        [Test]
        public void O_heroi_neutro_so_conhece_os_feiticos_base_da_classe()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            Bancada.LevarAoNivel(p, "sumo", 30);

            var feiticos = p.FeiticosDe("sumo");
            Assert.AreEqual(banco.Classes["sumo"].FeiticosBase.Count, feiticos.Count,
                "nível 30 sem escolher elemento não abre feitiço de caminho nenhum");
        }

        [Test]
        public void O_caminho_escolhido_abre_degrau_a_degrau_e_os_outros_tres_ficam_apagados()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var classe = banco.Classes["sumo"];
            var neutros = classe.FeiticosBase.Count;

            Bancada.LevarAoNivel(p, "sumo", 12);
            Assert.IsTrue(p.EscolherElemento("sumo", "fogo"));

            var feiticos = p.FeiticosDe("sumo");
            Assert.AreEqual(neutros + 3, feiticos.Count,
                "no nível 12 abriram os degraus 5, 10 e 12 — três dos seis");

            foreach (var abandonado in classe.Caminhos["agua"])
                Assert.IsFalse(feiticos.Contains(abandonado),
                    "o caminho não escolhido fica apagado para sempre: " + abandonado);
        }

        [Test]
        public void O_Lume_concede_feitico_enquanto_estiver_vestido()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);

            var candeia = banco.Itens["gh-seed-pouch"];
            Assert.AreEqual("lume", candeia.Espaco, "a Candeia de Vagens é um Lume");
            Assert.IsFalse(string.IsNullOrEmpty(candeia.ConcedeFeitico));

            Assert.IsFalse(p.FeiticosDe("sumo").Contains(candeia.ConcedeFeitico));

            p.AdicionarItem("gh-seed-pouch");
            Assert.IsTrue(p.Equipar("sumo", "gh-seed-pouch"));
            Assert.IsTrue(p.FeiticosDe("sumo").Contains(candeia.ConcedeFeitico),
                "o espaço `lume` é o único que concede feitiço");

            Assert.IsTrue(p.Desequipar("sumo", "lume"));
            Assert.IsFalse(p.FeiticosDe("sumo").Contains(candeia.ConcedeFeitico),
                "tirou o Lume, o feitiço vai junto — a lista é calculada, nunca guardada");
        }

        [Test]
        public void Peca_de_outro_espaco_nao_concede_feitico_nem_por_engano()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);

            // Uma varredura no acervo inteiro: só o Lume traz `grantsSpell`. É a
            // regra do §8, e é fácil de furar acrescentando um item.
            foreach (var par in banco.Itens)
            {
                if (par.Value == null || string.IsNullOrEmpty(par.Value.ConcedeFeitico)) continue;
                Assert.AreEqual("lume", par.Value.Espaco,
                    par.Key + " concede feitiço e não é um Lume");
            }
            Assert.IsNotNull(p);
        }
    }
}
