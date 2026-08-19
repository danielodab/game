using NUnit.Framework;
using Soterra.Progressao;

namespace Soterra.Testes.Progressao
{
    /// <summary>
    /// A escolha do caminho elemental — a única decisão sem volta do jogo.
    ///
    /// Se ela puder ser desfeita, deixa de ser decisão: o jogador troca de
    /// elemento antes de cada chefe e os quatro caminhos viram um só, com
    /// vinte e quatro feitiços. É por isso que a permanência é testada de três
    /// ângulos — pela API, pelo elemento repetido e pelo save adulterado.
    /// </summary>
    public class ElementoTests
    {
        [Test]
        public void Antes_do_degrau_da_escolha_ninguem_escolhe()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var degrau = banco.Nivelamento.NivelDaEscolhaDeElemento;

            Bancada.LevarAoNivel(p, "sumo", degrau - 1);
            Assert.IsFalse(p.EscolhaDeElementoPendente("sumo"));
            Assert.IsFalse(p.EscolherElemento("sumo", "fogo"),
                "um nível abaixo do degrau ainda não escolhe");
            Assert.AreEqual(Soterra.Dados.Elemento.Neutro, p.Heroi("sumo").Elemento);

            Bancada.LevarAoNivel(p, "sumo", degrau);
            Assert.IsTrue(p.EscolhaDeElementoPendente("sumo"),
                "chegou ao degrau e ainda é neutro: a tela tem de perguntar");
            Assert.IsTrue(p.EscolherElemento("sumo", "fogo"));
        }

        [Test]
        public void A_escolha_e_PARA_SEMPRE()
        {
            var banco = Bancada.Real();
            ArmazemDeMemoria armazem;
            var p = Bancada.Novo(banco, out armazem);

            Bancada.LevarAoNivel(p, "sumo", 30);
            Assert.IsTrue(p.EscolherElemento("sumo", "fogo"));

            Assert.IsFalse(p.EscolherElemento("sumo", "agua"), "não se troca de caminho");
            Assert.IsFalse(p.EscolherElemento("sumo", "terra"));
            Assert.IsFalse(p.EscolherElemento("sumo", "ar"));
            Assert.IsFalse(p.EscolherElemento("sumo", "fogo"),
                "nem 'trocar para o mesmo' passa — aceitar convidaria a tela a chamar em laço");
            Assert.IsFalse(p.EscolherElemento("sumo", Soterra.Dados.Elemento.Neutro),
                "e não se volta a ser neutro");

            Assert.AreEqual("fogo", p.Heroi("sumo").Elemento);
            Assert.IsFalse(p.EscolhaDeElementoPendente("sumo"), "quem já escolheu não pende mais");

            // E a permanência sobrevive a fechar o jogo.
            p.Salvar();
            var p2 = Progresso.Carregar(banco, armazem);
            Assert.AreEqual("fogo", p2.Heroi("sumo").Elemento);
            Assert.IsFalse(p2.EscolherElemento("sumo", "agua"),
                "reabrir o jogo não devolve a escolha");
        }

        [Test]
        public void Elemento_que_a_classe_nao_tem_caminho_e_recusado()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            Bancada.LevarAoNivel(p, "sumo", 30);

            Assert.IsFalse(p.EscolherElemento("sumo", "trevas"), "elemento fora dos cinco");
            Assert.IsFalse(p.EscolherElemento("sumo", ""), "texto vazio");
            Assert.IsFalse(p.EscolherElemento("sumo", null));
            Assert.IsFalse(p.EscolherElemento("heroi-que-nao-existe", "fogo"));
            Assert.AreEqual(Soterra.Dados.Elemento.Neutro, p.Heroi("sumo").Elemento,
                "nenhuma recusa pode ter mexido no herói");
        }

        [Test]
        public void A_tela_sabe_quem_ainda_precisa_escolher()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);

            Bancada.LevarAoNivel(p, "sumo", 5);
            Bancada.LevarAoNivel(p, "curandeira", 4);

            var pendentes = p.EscolhasDeElementoPendentes(new[] { "sumo", "curandeira" });
            Assert.AreEqual(1, pendentes.Count);
            Assert.AreEqual("sumo", pendentes[0]);

            p.EscolherElemento("sumo", "terra");
            Assert.AreEqual(0, p.EscolhasDeElementoPendentes(new[] { "sumo", "curandeira" }).Count);
        }
    }
}
