using NUnit.Framework;
using Soterra.Progressao;

namespace Soterra.Testes.Progressao
{
    /// <summary>
    /// O saco do grupo e os cinco espaços do herói.
    ///
    /// A regra que quase todo teste daqui persegue é a mesma: EQUIPAR TIRA DO
    /// SACO. Enquanto a peça equipada continuava aparecendo na grade, a tela
    /// mostrava algo que já tinha dono e o jogador "equipava a mesma" no segundo
    /// herói — dois heróis com uma bota só.
    /// </summary>
    public class ItemTests
    {
        [Test]
        public void Os_quatro_espacos_tem_nome_proprio_e_todo_item_do_acervo_cabe_num_deles()
        {
            var banco = Bancada.Real();
            CollectionAssert.AreEqual(new[] { "punho", "passo", "casca", "lume" }, Progresso.Espacos);

            foreach (var par in banco.Itens)
                Assert.Contains(par.Value.Espaco, Progresso.Espacos,
                    par.Key + " está num espaço que o jogo não tem");
        }

        [Test]
        public void O_saco_e_do_GRUPO_e_copias_iguais_empilham_com_um_contador()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);

            p.AdicionarItem("gh-trellis-guard");
            p.AdicionarItem("gh-trellis-guard");
            p.AdicionarItem("gh-trellis-guard");
            p.AdicionarItem("gh-seed-pouch");

            Assert.AreEqual(3, p.ContarNoSaco("gh-trellis-guard"));

            var pilhas = p.Pilhas();
            Assert.AreEqual(2, pilhas.Count, "duas variantes, não quatro espaços");
            Assert.AreEqual("gh-trellis-guard", pilhas[0].IdDoItem);
            Assert.AreEqual(3, pilhas[0].Quantidade, "é o ×N que a grade desenha");
            Assert.AreEqual(1, pilhas[1].Quantidade);
        }

        [Test]
        public void Equipar_tira_do_saco_e_desequipar_devolve_A_MESMA_copia()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);

            p.AdicionarItem("gh-trellis-guard");
            p.AdicionarPedras(p.PedraDoElemento("terra"), 999);
            Assert.IsTrue(p.Forjar(0));
            Assert.IsTrue(p.Forjar(0));
            Assert.AreEqual(2, p.Estado.Saco[0].NivelDeForja);

            Assert.IsTrue(p.Equipar("sumo", "gh-trellis-guard"));
            Assert.AreEqual(0, p.ContarNoSaco("gh-trellis-guard"), "saiu do saco ao ser vestida");
            Assert.AreEqual(2, p.Vestido("sumo", "casca").NivelDeForja, "e levou a forja consigo");

            Assert.IsTrue(p.Desequipar("sumo", "casca"));
            Assert.AreEqual(1, p.ContarNoSaco("gh-trellis-guard"));
            Assert.AreEqual(2, p.Estado.Saco[0].NivelDeForja,
                "voltou a MESMA cópia: sem o carimbo de forja, o trabalho evaporaria");
        }

        [Test]
        public void Duas_copias_iguais_vao_uma_em_cada_heroi()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);

            p.AdicionarItem("gh-vine-stirrups");
            p.AdicionarItem("gh-vine-stirrups");

            Assert.IsTrue(p.Equipar("sumo", "gh-vine-stirrups"));
            Assert.IsTrue(p.Equipar("curandeira", "gh-vine-stirrups"));

            Assert.AreEqual(2, p.QuemVeste("gh-vine-stirrups").Count);
            Assert.AreEqual(0, p.ContarNoSaco("gh-vine-stirrups"));
            Assert.AreEqual(2, p.ContarPossuido("gh-vine-stirrups"));

            // A terceira tentativa não tem de onde tirar cópia.
            Assert.IsFalse(p.Equipar("arqueiro", "gh-vine-stirrups"),
                "sem cópia livre no saco não se equipa nada");
        }

        [Test]
        public void Trocar_a_peca_de_um_espaco_devolve_a_anterior_ao_saco()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);

            p.AdicionarItem("gh-widow-shears");
            p.AdicionarItem("em-forge-grate");     // outro punho
            Assert.IsTrue(p.Equipar("sumo", "gh-widow-shears"));
            Assert.IsTrue(p.Equipar("sumo", "em-forge-grate"));

            Assert.AreEqual("em-forge-grate", p.Vestido("sumo", "punho").IdDoItem);
            Assert.AreEqual(1, p.ContarNoSaco("gh-widow-shears"),
                "o punho anterior volta a ficar livre na hora");
        }

        [Test]
        public void O_bonus_de_conjunto_e_progressivo_e_cumulativo()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var conjunto = banco.Conjuntos["gh-set-flora"];

            // A Fixação mede bem porque NENHUMA das quatro peças da Flora dá
            // fixação: tudo o que aparecer aqui veio do conjunto.
            var baseFixacao = banco.Classes["sumo"].Atributos.Fixacao;

            foreach (var peca in conjunto.Pecas) p.AdicionarItem(peca);

            Assert.IsTrue(p.Equipar("sumo", "gh-trellis-guard"));
            Assert.AreEqual(baseFixacao, p.FichaDeCombate("sumo").Fixacao,
                "uma peça não é conjunto");

            Assert.IsTrue(p.Equipar("sumo", "gh-vine-stirrups"));
            Assert.AreEqual(baseFixacao + conjunto.Bonus[2].Fixacao,
                p.FichaDeCombate("sumo").Fixacao);

            Assert.IsTrue(p.Equipar("sumo", "gh-seed-pouch"));
            Assert.AreEqual(baseFixacao + conjunto.Bonus[2].Fixacao + conjunto.Bonus[3].Fixacao,
                p.FichaDeCombate("sumo").Fixacao, "com três peças valem os bônus de 2 E de 3");

            Assert.IsTrue(p.Equipar("sumo", "gh-widow-shears"));
            Assert.AreEqual(baseFixacao + conjunto.Bonus[2].Fixacao + conjunto.Bonus[3].Fixacao +
                            conjunto.Bonus[4].Fixacao,
                p.FichaDeCombate("sumo").Fixacao, "com quatro valem os três degraus somados");
        }

        [Test]
        public void O_bicho_e_o_quinto_espaco_e_serve_a_um_heroi_por_vez()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);

            Assert.IsTrue(p.AdicionarBicho("pet-emberling"));
            Assert.IsFalse(p.AdicionarBicho("pet-emberling"), "o mesmo bicho não entra duas vezes");

            Assert.IsTrue(p.EquiparBicho("sumo", "pet-emberling"));
            Assert.AreEqual(0, p.Estado.Bichos.Count, "equipar tira da lista de soltos");

            var comBicho = p.FichaDeCombate("sumo");
            Assert.AreEqual(banco.Classes["sumo"].Atributos.Poder + banco.Bichos["pet-emberling"].Bonus.Poder,
                comBicho.Poder, "o bônus do bicho entra na ficha");

            Assert.IsTrue(p.EquiparBicho("curandeira", "pet-emberling"),
                "pôr no outro herói TRANSFERE — recusar exigiria dois toques para uma decisão só");
            Assert.IsNull(p.Heroi("sumo").Bicho);
            Assert.AreEqual("pet-emberling", p.Heroi("curandeira").Bicho);

            Assert.IsTrue(p.DesequiparBicho("curandeira"));
            Assert.AreEqual(1, p.Estado.Bichos.Count);
        }

        [Test]
        public void Item_que_nao_existe_no_acervo_nao_entra_no_saco()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);

            Assert.IsFalse(p.AdicionarItem("item-que-nunca-existiu"));
            Assert.IsFalse(p.AdicionarItem(null));
            Assert.AreEqual(0, p.Estado.Saco.Count);
            Assert.IsFalse(p.Equipar("sumo", "item-que-nunca-existiu"));
        }
    }
}
