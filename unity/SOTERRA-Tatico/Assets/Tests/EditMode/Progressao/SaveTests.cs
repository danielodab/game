using NUnit.Framework;
using Soterra.Progressao;

namespace Soterra.Testes.Progressao
{
    /// <summary>
    /// Progresso que não sobrevive a fechar o jogo não é progresso.
    ///
    /// Todo teste daqui fecha e reabre de verdade: grava com um
    /// <see cref="Progresso"/> e carrega com OUTRO, sobre o mesmo armazém.
    /// Reler o objeto que ainda está na memória provaria só que o campo existe.
    /// </summary>
    public class SaveTests
    {
        [Test]
        public void Tudo_o_que_o_jogador_conquistou_volta_depois_de_fechar_o_jogo()
        {
            var banco = Bancada.Real();
            ArmazemDeMemoria armazem;
            var p = Bancada.Novo(banco, out armazem);

            Bancada.LevarAoNivel(p, "sumo", 6);
            Assert.IsTrue(p.EscolherElemento("sumo", "terra"));

            Assert.IsTrue(p.AdicionarItem("gh-widow-shears"));
            Assert.IsTrue(p.AdicionarItem("gh-widow-shears"));
            Assert.IsTrue(p.Equipar("sumo", "gh-widow-shears"));

            // O Tesourão é de terra, então ele come Grão de Rocha-Mãe.
            Assert.IsTrue(p.AdicionarPedras("stone-root", 50));
            var custoDoPrimeiroDegrau = banco.Forja.CustoEmPedras[0];
            Assert.IsTrue(p.Forjar(0), "a cópia que sobrou no saco tinha de subir para o +1");

            p.AdicionarCartas("arqueiro", 25);
            Assert.IsTrue(p.AdicionarBicho("pet-snapvine"));
            Assert.IsTrue(p.EquiparBicho("sumo", "pet-snapvine"));

            Assert.IsTrue(p.Salvar(), "o armazém de memória nunca recusa gravação");

            // ---- fecha o jogo e abre de novo
            var p2 = Progresso.Carregar(banco, armazem);

            Assert.AreEqual(6, p2.NivelDe("sumo"), "o nível voltou");
            Assert.AreEqual("terra", p2.Heroi("sumo").Elemento, "o caminho elemental voltou");

            var vestido = p2.Vestido("sumo", "punho");
            Assert.IsNotNull(vestido, "a peça vestida voltou no espaço dela");
            Assert.AreEqual("gh-widow-shears", vestido.IdDoItem);
            Assert.AreEqual(0, vestido.NivelDeForja, "quem foi forjado foi a cópia do SACO, não a vestida");

            Assert.AreEqual(1, p2.ContarNoSaco("gh-widow-shears"),
                "sobrou uma cópia livre: equipar tirou a outra do saco");
            var pilhas = p2.Pilhas();
            Assert.AreEqual(1, pilhas.Count);
            Assert.AreEqual(1, pilhas[0].NivelDeForja, "a forja da cópia do saco voltou");

            Assert.AreEqual(50 - custoDoPrimeiroDegrau, p2.ContarPedras("stone-root"),
                "as pedras gastas continuam gastas");

            Assert.AreEqual(25, p2.CartasDe("arqueiro"));
            Assert.IsTrue(p2.ClasseLiberada("arqueiro"), "25 cartas pagam as 25 do Batedor");
            Assert.IsNotNull(p2.Heroi("arqueiro"), "classe liberada ganha ficha");

            Assert.AreEqual("pet-snapvine", p2.Heroi("sumo").Bicho);
            Assert.IsFalse(p2.Estado.Bichos.Contains("pet-snapvine"),
                "bicho equipado não fica também na lista de soltos");

            Assert.IsTrue(p2.FeiticosDe("sumo").Contains("sumo-terra-5"),
                "o feitiço do degrau 5 do caminho de terra voltou junto");
        }

        [Test]
        public void Carregar_NUNCA_grava()
        {
            var banco = Bancada.Real();
            ArmazemDeMemoria armazem;
            var p = Bancada.Novo(banco, out armazem);
            p.Salvar();
            var antes = armazem.Gravacoes;

            Progresso.Carregar(banco, armazem);

            // Um jogo que salva ao abrir apaga o progresso de quem abriu com o
            // disco cheio: a carga sobrescreveria o save bom com o estado novo.
            Assert.AreEqual(antes, armazem.Gravacoes, "abrir o jogo não pode gravar nada");
        }

        [Test]
        public void Save_ilegivel_nao_derruba_o_jogo()
        {
            var banco = Bancada.Real();
            var armazem = new ArmazemDeMemoria();
            armazem.Gravar(Progresso.ChaveDeSave, "{ isto aqui não é JSON ");

            var p = Progresso.Carregar(banco, armazem);

            Assert.IsNotNull(p.Estado);
            Assert.IsTrue(p.ClasseLiberada("sumo"), "as classes de `startsUnlocked` voltam sozinhas");
            Assert.IsTrue(p.ClasseLiberada("curandeira"));
            Assert.IsNotNull(p.Heroi("sumo"));
        }

        [Test]
        public void O_saneador_descarta_campo_a_campo_o_que_nao_bate_com_o_acervo()
        {
            var banco = Bancada.Real();
            var armazem = new ArmazemDeMemoria();

            /* Um save adulterado à mão, com um defeito de cada espécie:
             *  - classe que não existe, na lista e numa ficha;
             *  - XP negativa;
             *  - elemento gravado por quem não tem nível para escolher;
             *  - peça no espaço ERRADO (a Guarda de Treliça é casca, não punho);
             *  - espaço que o jogo não tem ('bolso');
             *  - nível de forja acima do teto;
             *  - item, bicho, carta e pedra que não existem no acervo;
             *  - bicho repetido na lista de soltos. */
            armazem.Gravar(Progresso.ChaveDeSave, @"{
              ""version"": 1,
              ""unlockedClasses"": [""sumo"", ""classe-que-nunca-existiu""],
              ""heroes"": {
                ""sumo"": {
                  ""classId"": ""sumo"", ""element"": ""fogo"", ""xp"": -50,
                  ""items"": { ""punho"": ""gh-trellis-guard"", ""casca"": ""gh-trellis-guard"",
                               ""bolso"": ""gh-seed-pouch"" },
                  ""itemLevel"": { ""casca"": 99 },
                  ""pet"": ""pet-que-nao-existe""
                },
                ""fantasma"": { ""classId"": ""nao-existe"", ""xp"": 999999 }
              },
              ""inventory"": [ { ""itemId"": ""gh-seed-pouch"", ""level"": 3 },
                               { ""itemId"": ""item-fantasma"", ""level"": 0 } ],
              ""pets"": [""pet-emberling"", ""pet-emberling"", ""pet-fantasma""],
              ""cards"": { ""arqueiro"": 3, ""classe-fantasma"": 99 },
              ""stones"": { ""stone-root"": 5, ""pedra-fantasma"": 7 }
            }");

            var p = Progresso.Carregar(banco, armazem);

            Assert.IsFalse(p.ClasseLiberada("classe-que-nunca-existiu"));
            Assert.IsNull(p.Heroi("fantasma"), "ficha de classe inexistente é lixo");

            var sumo = p.Heroi("sumo");
            Assert.AreEqual(0, sumo.Xp, "XP negativa vira zero");
            Assert.AreEqual(1, p.NivelDe("sumo"));
            Assert.AreEqual(Soterra.Dados.Elemento.Neutro, sumo.Elemento,
                "elemento sem o nível da escolha é save adulterado — o nível manda");

            Assert.IsNull(p.Vestido("sumo", "punho"), "casca no punho não entra");
            Assert.IsNotNull(p.Vestido("sumo", "casca"));
            Assert.AreEqual(banco.Forja.NivelMaximo, p.Vestido("sumo", "casca").NivelDeForja,
                "forja acima do teto é aparada no teto, não aceita");
            Assert.IsNull(sumo.Bicho, "bicho que não existe no acervo não entra");

            Assert.AreEqual(1, p.ContarNoSaco("gh-seed-pouch"));
            Assert.AreEqual(0, p.ContarNoSaco("item-fantasma"));

            Assert.AreEqual(1, p.Estado.Bichos.Count, "bicho repetido entra uma vez só");
            Assert.AreEqual("pet-emberling", p.Estado.Bichos[0]);

            Assert.AreEqual(3, p.CartasDe("arqueiro"));
            Assert.IsFalse(p.ClasseLiberada("arqueiro"), "3 das 25 cartas não liberam nada");
            Assert.AreEqual(0, p.CartasDe("classe-fantasma"));

            Assert.AreEqual(5, p.ContarPedras("stone-root"));
            Assert.AreEqual(0, p.ContarPedras("pedra-fantasma"));
        }

        [Test]
        public void O_nivel_NAO_e_um_campo_do_save_e_sim_a_XP_lida_de_volta()
        {
            var banco = Bancada.Real();
            var armazem = new ArmazemDeMemoria();

            // Um save que se declara nível 30 com zero de XP. Guardar os dois
            // campos deixaria esta contradição entrar; guardar só a XP não tem
            // onde escondê-la.
            armazem.Gravar(Progresso.ChaveDeSave,
                @"{ ""heroes"": { ""sumo"": { ""classId"": ""sumo"", ""xp"": 0, ""level"": 30 } } }");

            var p = Progresso.Carregar(banco, armazem);
            Assert.AreEqual(1, p.NivelDe("sumo"), "o nível vem da XP, não do que o arquivo declara");
        }

        [Test]
        public void Sem_armazem_o_jogo_roda_inteiro_e_nenhuma_chamada_estoura()
        {
            var banco = Bancada.Real();
            var p = Progresso.Carregar(banco, new ArmazemSurdo());

            Assert.IsFalse(p.Salvar(), "o armazém surdo recusa, e o retorno diz isso");

            // O resto tem de continuar funcionando: sem persistência o jogo é
            // pior, mas ainda é jogo.
            Bancada.LevarAoNivel(p, "sumo", 5);
            Assert.IsTrue(p.EscolherElemento("sumo", "fogo"));
            Assert.IsTrue(p.AdicionarItem("gh-widow-shears"));
            Assert.IsTrue(p.Equipar("sumo", "gh-widow-shears"));
            Assert.AreEqual(5, p.NivelDe("sumo"));
            Assert.IsNotNull(p.FichaDeCombate("sumo"));
        }
    }
}
