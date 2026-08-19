using NUnit.Framework;
using Soterra.Dados;
using Soterra.Interface;

namespace Soterra.Testes.Interface
{
    /// <summary>
    /// O que entra na barra de feitiços, cobrado contra o acervo de verdade.
    ///
    /// Nenhuma contagem esperada está escrita à mão: cada uma é derivada de um
    /// arquivo DIFERENTE do que está sendo medido. A contagem do nível 12, por
    /// exemplo, sai de <c>unlockTiers.json</c> e é cobrada do
    /// <c>unlockLevel</c> de <c>spells.json</c> — se os dois discordarem, o
    /// teste cai. Um número cravado aqui não teria pegado isso; teria só
    /// concordado consigo mesmo.
    /// </summary>
    public class RepertorioTests
    {
        BancoDeDados _banco;

        [SetUp]
        public void Antes()
        {
            _banco = Cenario.BancoOuInconclusivo();
        }

        /// <summary>Quantos degraus do caminho elemental já abriram neste nível.</summary>
        int DegrausAbertos(int nivel)
        {
            int n = 0;
            for (int i = 0; i < _banco.DegrausDeDesbloqueio.Count; i++)
                if (_banco.DegrausDeDesbloqueio[i] <= nivel) n++;
            return n;
        }

        [Test]
        public void NoNivel30ABarraTemOsTresNeutrosMaisOCaminhoInteiro()
        {
            var classe = _banco.Classes["bruxo"];
            var barra = Repertorio.De(_banco, "bruxo", Elemento.Fogo, 30);

            Assert.AreEqual(classe.FeiticosBase.Count + classe.Caminhos[Elemento.Fogo].Count,
                            barra.Count,
                            "o nível 30 abre a escada inteira: os neutros mais os seis degraus");
        }

        [Test]
        public void AntesDoNivelCincoABarraSoTemOsNeutros()
        {
            var classe = _banco.Classes["bruxo"];
            var barra = Repertorio.De(_banco, "bruxo", Elemento.Fogo, 0);

            Assert.AreEqual(classe.FeiticosBase.Count, barra.Count,
                "o caminho elemental só é escolhido no nível 5 (SISTEMAS §4)");
            for (int i = 0; i < barra.Count; i++)
                Assert.AreEqual(0, barra[i].NivelDeDesbloqueio,
                    "feitiço neutro tem unlockLevel 0: " + barra[i].Id);
        }

        [Test]
        public void AEscadaDeDesbloqueioSaiDoAcervoENaoDeUmaListaFixa()
        {
            var classe = _banco.Classes["bruxo"];

            for (int i = 0; i < _banco.DegrausDeDesbloqueio.Count; i++)
            {
                int nivel = _banco.DegrausDeDesbloqueio[i];
                var barra = Repertorio.De(_banco, "bruxo", Elemento.Fogo, nivel);
                Assert.AreEqual(classe.FeiticosBase.Count + DegrausAbertos(nivel), barra.Count,
                    "no nível " + nivel + " a barra do bruxo de fogo saiu do tamanho errado");

                for (int k = 0; k < barra.Count; k++)
                    Assert.LessOrEqual(barra[k].NivelDeDesbloqueio, nivel,
                        "feitiço trancado apareceu na barra: " + barra[k].Id);
            }
        }

        [Test]
        public void OsQuatroCaminhosDeTodasAsClassesAbremNosMesmosDegraus()
        {
            foreach (var par in _banco.Classes)
            {
                var classe = par.Value;
                foreach (var caminho in classe.Caminhos)
                {
                    var barra = Repertorio.De(_banco, classe.Id, caminho.Key, 30);
                    Assert.AreEqual(classe.FeiticosBase.Count + caminho.Value.Count, barra.Count,
                        "classe " + classe.Id + ", caminho " + caminho.Key);
                }
            }
        }

        /// <summary>
        /// As nove cargas de armadilha do Xamã têm <c>castsPerTurn = 0</c> porque
        /// só disparam por um efeito <c>trap</c>: nunca são conjuradas à mão.
        /// Desenhá-las daria ao Xamã botões que não fazem nada.
        /// </summary>
        [Test]
        public void CargaDeArmadilhaNaoEntraNaBarra()
        {
            int cargas = 0;
            foreach (var par in _banco.Feiticos)
            {
                if (par.Value == null || par.Value.LancamentosPorTurno > 0) continue;
                cargas++;
                Assert.IsFalse(Repertorio.PodeAparecerNaBarra(par.Value),
                    par.Key + " tem castsPerTurn 0 e mesmo assim entraria na barra");
            }
            Assert.Greater(cargas, 0,
                "o acervo devia ter cargas de armadilha (castsPerTurn 0) e não tem nenhuma — " +
                "ou o dado mudou, ou o filtro está protegendo contra nada");
        }

        [Test]
        public void MonstroTrazAPropriaListaDeFeiticos()
        {
            foreach (var par in _banco.Monstros)
            {
                var m = par.Value;
                if (m == null || m.Feiticos == null || m.Feiticos.Count == 0) continue;

                var barra = Repertorio.De(_banco, m.Id, m.Elemento, 1);
                Assert.Greater(barra.Count, 0,
                    "o monstro " + m.Id + " tem feitiço no acervo e a barra saiu vazia");
                Assert.LessOrEqual(barra.Count, m.Feiticos.Count);
                return;             // um monstro basta: a regra é a mesma para todos
            }
            Assert.Inconclusive("nenhum monstro do acervo tem feitiço");
        }

        [Test]
        public void CustoERecargaSaemDoAcervoESaoCopiadosSemMexer()
        {
            var barra = Repertorio.De(_banco, "bruxo", Elemento.Fogo, 30);
            Assert.Greater(barra.Count, 0);

            for (int i = 0; i < barra.Count; i++)
            {
                var f = barra[i];
                var naTela = Repertorio.ParaTela(f, 0);
                Assert.AreEqual(f.CustoDePa, naTela.CustoDePa, f.Id + ": custo em PA");
                Assert.AreEqual(f.Recarga, naTela.Recarga, f.Id + ": recarga");
                Assert.AreEqual(f.Nome, naTela.Nome, f.Id + ": nome");
                Assert.Greater(naTela.CustoDePa, 0,
                    f.Id + " custaria 0 PA — é o sintoma de id que não resolveu");
            }
        }

        [Test]
        public void IdDesconhecidoDevolveBarraVaziaEmVezDeEstourar()
        {
            var barra = Repertorio.De(_banco, "nao-existe", Elemento.Fogo, 30);
            Assert.IsNotNull(barra);
            Assert.AreEqual(0, barra.Count);
        }

        [Test]
        public void SemElementoEscolhidoNenhumFeiticoDeCaminhoAparece()
        {
            var classe = _banco.Classes["bruxo"];

            // "neutro" é o que o herói carrega antes do nível 5, e não é chave de
            // `paths` — o caminho não existe até a escolha ser feita.
            var barra = Repertorio.De(_banco, "bruxo", Elemento.Neutro, 30);
            Assert.AreEqual(classe.FeiticosBase.Count, barra.Count);
        }
    }
}
