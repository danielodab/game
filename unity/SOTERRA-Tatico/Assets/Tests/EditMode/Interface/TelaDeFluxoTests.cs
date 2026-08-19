using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.UIElements;
using Soterra.Interface;

namespace Soterra.Testes.Interface
{
    // ARMADILHA DE NOME: daqui de dentro, `Progressao.X` acharia o namespace
    // irmão `Soterra.Testes.Progressao` antes de `Soterra.Progressao` (CS0234).
    // O mesmo para `Motor`. Os apelidos globais travam no alvo certo.
    using Progressao = global::Soterra.Progressao;
    using Motor = global::Soterra.Motor;
    using Bancada = global::Soterra.Testes.Progressao.Bancada;

    /// <summary>
    /// As telas entre salas, montadas a partir do UXML e do USS DE VERDADE, com
    /// uma recompensa DE VERDADE — a mesma disciplina dos outros testes da
    /// interface: nenhum número inventado, porque a coisa medida (quantas
    /// fichas de ganho, quantos prêmios, que rótulo no botão) é o que o acervo
    /// e a Descida produzem.
    /// </summary>
    public class TelaDeFluxoTests
    {
        static string CaminhoDoEstilo
        {
            get { return (Application.dataPath + "/UI/Resources/fluxo-estilo.uss").Replace('\\', '/'); }
        }

        static TelaDeFluxo Tela()
        {
            return TelaDeFluxo.Carregar();
        }

        /// <summary>
        /// Uma sala da Estufa vencida de verdade: a Descida paga XP, pedras e
        /// peças, e o quadro sai da ponte.
        ///
        /// `SempreOMinimo` e NÃO o máximo: a queda de pedra compara
        /// <c>sorte.Proximo() &lt; chance</c>, então é o sorteio no PISO que faz
        /// tudo cair — com o máximo a sala sairia seca e o teste mediria uma
        /// tela vazia achando que media o saque.
        /// </summary>
        static QuadroDeFluxo Recompensa(out Progressao.Progresso progresso,
                                        out Progressao.Descida descida)
        {
            var banco = Bancada.Real();
            progresso = Bancada.Novo(banco);
            descida = Progressao.Descida.Comecar(progresso, "greenhouse", new[] { "sumo" });
            Assert.IsNotNull(descida);

            var batalha = Bancada.SalaVencida(progresso, descida.Grupo, new[] { 80 },
                                              "pollen-puff", "pollen-puff", "thorn-lasher");
            var r = descida.RegistrarVitoria(batalha, Motor.Sorte.SempreOMinimo);
            Assert.IsNotNull(r);
            return PonteDaDescida.Quadro(progresso, descida, r, TipoDeFluxo.Recompensa);
        }

        static QuadroDeFluxo Escolha(out Progressao.Progresso progresso,
                                     out Progressao.Descida descida)
        {
            var banco = Bancada.Real();
            progresso = Bancada.Novo(banco);
            Bancada.LevarAoNivel(progresso, "sumo", progresso.NivelDaEscolhaDeElemento);
            descida = Progressao.Descida.Comecar(progresso, "greenhouse", new[] { "sumo" });
            return PonteDaDescida.Quadro(progresso, descida, null,
                                         TipoDeFluxo.EscolhaDeElemento, "sumo");
        }

        // ============================================================ ESCONDIDA

        [Test]
        public void ComABatalhaEmPe_ATelaDeFluxoNaoExisteNaFrenteDeNinguem()
        {
            var tela = Tela();
            tela.Montar(new QuadroDeFluxo { Tipo = TipoDeFluxo.Nenhum });

            Assert.AreEqual(DisplayStyle.None, tela.Raiz.style.display.value,
                "a tela de fluxo cobre a tela inteira: visível com a batalha em pé, ela " +
                "esconderia o tabuleiro");
            Assert.AreEqual(PickingMode.Ignore, tela.Raiz.pickingMode,
                "escondida, ela ainda pode engolir o toque do tabuleiro — foi o defeito " +
                "'a interface engolia todo clique', já pago uma vez");
        }

        // =========================================================== RECOMPENSA

        [Test]
        public void ATelaDeRecompensa_MostraOQueASalaPagou()
        {
            Progressao.Progresso p;
            Progressao.Descida d;
            var q = Recompensa(out p, out d);

            var tela = Tela();
            tela.Montar(q);

            Assert.AreEqual(DisplayStyle.Flex, tela.Raiz.style.display.value);
            Assert.AreEqual(TipoDeFluxo.Recompensa, tela.Tipo);

            var titulo = tela.Raiz.Q<Label>("fluxo-titulo");
            Assert.IsNotEmpty(titulo.text, "a tela de recompensa subiu sem título");

            var subtitulo = tela.Raiz.Q<Label>("fluxo-subtitulo");
            StringAssert.Contains("sala 1 de 3", subtitulo.text,
                "a tela tem de dizer ONDE o grupo está — o índice do código é base zero, " +
                "e 'sala 0 de 3' parece contagem quebrada");

            // ---- o ganho de cada herói, com o número que a Descida pagou
            var ganho = tela.Raiz.Q<Label>("ganho-xp-sumo");
            Assert.IsNotNull(ganho, "a ficha de ganho do herói não foi desenhada");
            StringAssert.Contains(q.Ganhos[0].Xp.ToString(), ganho.text,
                "a XP na tela tem de ser a que a recompensa pagou");
            Assert.Greater(q.Ganhos[0].Xp, 0, "a sala não pagou XP nenhuma — o cenário mudou?");

            // ---- o saque
            Assert.Greater(q.Premios.Count, 0,
                "com o sorteio no máximo a sala tinha de pagar alguma coisa");
            var premios = tela.Raiz.Q<VisualElement>("fluxo-premios");
            Assert.AreEqual(q.Premios.Count, premios.childCount,
                "uma linha por prêmio: linhas a menos escondem saque que o jogador ganhou");

            var botao = tela.Raiz.Q<Button>("fluxo-botao");
            Assert.AreEqual(DisplayStyle.Flex, botao.style.display.value);
            Assert.AreEqual("Descer", botao.text);
        }

        [Test]
        public void SubirDeNivel_ApareceNaFichaDoHeroi()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var d = Progressao.Descida.Comecar(p, "greenhouse", new[] { "sumo" });

            // A Jardineira-Viúva paga XP bastante para o nível 2 — é o mesmo
            // cenário que a DescidaTests usa para cobrar a subida.
            var b = Bancada.SalaVencida(p, d.Grupo, new[] { 10 }, "boss-gardener");
            var r = d.RegistrarVitoria(b, Motor.Sorte.SempreOMinimo);
            Assert.AreEqual(1, r.Subidas.Count, "o cenário mudou: ninguém subiu de nível");

            var q = PonteDaDescida.Quadro(p, d, r, TipoDeFluxo.CalaboucoConcluido);
            var tela = Tela();
            tela.Montar(q);

            var subiu = tela.Raiz.Q<Label>("ganho-subiu-sumo");
            Assert.IsNotNull(subiu,
                "subir de nível é a única coisa desta tela que muda a ficha para sempre — " +
                "sem uma linha própria ela passa despercebida");
            StringAssert.Contains(p.NivelDe("sumo").ToString(), subiu.text);
        }

        [Test]
        public void SaqueVazio_ATelaDizQueEstaVazioEmVezDeMostrarUmVao()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var d = Progressao.Descida.Comecar(p, "greenhouse", new[] { "sumo" });

            // Sem sorte NÃO há sorteio nenhum: é o caminho em que a recompensa
            // vem só com XP, e é resultado normal.
            var r = d.RegistrarVitoria(Bancada.SalaVencida(p, d.Grupo, new[] { 100 }, "pollen-puff"),
                                       null);
            var q = PonteDaDescida.Quadro(p, d, r, TipoDeFluxo.Recompensa);
            Assert.AreEqual(0, q.Premios.Count);

            var tela = Tela();
            tela.Montar(q);
            Assert.IsNotNull(tela.Raiz.Q<Label>("premios-vazio"),
                "saque vazio sem aviso parece falha de carregamento");
        }

        // =============================================== ESCOLHA DE ELEMENTO

        [Test]
        public void ATelaDeEscolha_OferecemOsQuatroCaminhosESemBotaoDePular()
        {
            Progressao.Progresso p;
            Progressao.Descida d;
            var q = Escolha(out p, out d);

            var tela = Tela();
            tela.Montar(q);

            var elementos = tela.Raiz.Q<VisualElement>("fluxo-elementos");
            Assert.AreEqual(DisplayStyle.Flex, elementos.style.display.value);
            Assert.AreEqual(4, elementos.childCount, "são quatro caminhos elementais");

            var botao = tela.Raiz.Q<Button>("fluxo-botao");
            Assert.AreEqual(DisplayStyle.None, botao.style.display.value,
                "com um botão de avançar ao lado, o jogador pularia sem perceber uma " +
                "escolha que é PERMANENTE");

            StringAssert.Contains("sempre", tela.Raiz.Q<Label>("fluxo-texto").text,
                "a permanência tem de estar escrita na tela, não só na regra");
        }

        [Test]
        public void OToqueNumCaminho_EmiteOIdDoElemento()
        {
            Progressao.Progresso p;
            Progressao.Descida d;
            var q = Escolha(out p, out d);

            var tela = Tela();
            string escolhido = null;
            tela.AoEscolherElemento += id => escolhido = id;
            tela.Montar(q);

            tela.EscolherElemento(q.Elementos[2].Id);
            Assert.AreEqual(q.Elementos[2].Id, escolhido);

            // Fora da tela de escolha o mesmo toque não emite nada: um evento
            // solto aqui gravaria um caminho permanente sem o jogador ter visto
            // a tela que explica a permanência.
            escolhido = null;
            tela.Montar(new QuadroDeFluxo { Tipo = TipoDeFluxo.Nenhum });
            tela.EscolherElemento(q.Elementos[0].Id);
            Assert.IsNull(escolhido);
        }

        // ================================================= CONCLUSÃO E DERROTA

        [Test]
        public void ADerrota_DizQueOProgressoFicaEOferecemRecomecar()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var d = Progressao.Descida.Comecar(p, "greenhouse", new[] { "sumo" });
            d.RegistrarDerrota();

            var q = PonteDaDescida.Quadro(p, d, null, TipoDeFluxo.Derrota);
            var tela = Tela();
            tela.Montar(q);

            var botao = tela.Raiz.Q<Button>("fluxo-botao");
            Assert.AreEqual(DisplayStyle.Flex, botao.style.display.value);
            Assert.IsTrue(botao.ClassListContains("botao--reiniciar"),
                "o botão da derrota reinicia o calabouço; parecido com o 'Descer' ele " +
                "seria apertado sem leitura");

            StringAssert.Contains("conquistado", tela.Raiz.Q<Label>("fluxo-texto").text,
                "a derrota NÃO desfaz o progresso, e a tela precisa dizer isso — senão " +
                "parece que a descida inteira foi apagada");

            Assert.AreEqual(0, tela.Raiz.Q<VisualElement>("fluxo-ganhos").childCount,
                "derrota não paga recompensa: uma ficha de ganho aqui seria mentira");
        }

        [Test]
        public void OBotaoPrincipal_SoEmiteComTelaAberta()
        {
            var tela = Tela();
            int toques = 0;
            tela.AoAvancar += () => toques++;

            tela.Montar(new QuadroDeFluxo { Tipo = TipoDeFluxo.Nenhum });
            tela.Avancar();
            Assert.AreEqual(0, toques, "tela escondida não pode avançar a descida");

            tela.Montar(new QuadroDeFluxo { Tipo = TipoDeFluxo.Derrota, RotuloDoBotao = "Tentar de novo" });
            tela.Avancar();
            Assert.AreEqual(1, toques);
        }

        // ========================================================== ORIENTAÇÃO

        [Test]
        public void ATelaServeDeitadaEEmPe()
        {
            var tela = Tela();
            tela.Montar(new QuadroDeFluxo { Tipo = TipoDeFluxo.Derrota, RotuloDoBotao = "x" });

            tela.AplicarOrientacao(1600f, 900f);
            Assert.IsTrue(tela.EstaDeitada);
            Assert.IsTrue(tela.Painel.ClassListContains("fluxo--paisagem"));
            Assert.IsFalse(tela.Painel.ClassListContains("fluxo--retrato"));

            tela.AplicarOrientacao(900f, 1600f);
            Assert.IsFalse(tela.EstaDeitada);
            Assert.IsTrue(tela.Painel.ClassListContains("fluxo--retrato"));
            Assert.IsFalse(tela.Painel.ClassListContains("fluxo--paisagem"));
        }

        // =============================================================== TOQUE

        /// <summary>
        /// Todo controle da tela de fluxo vive na faixa de BAIXO.
        ///
        /// A regra do celular não é gosto: a mão que segura o telefone alcança o
        /// terço de baixo sem trocar de posição. Um botão de "Descer" no alto da
        /// tela obriga a segunda mão — e a tela de recompensa é a mais tocada
        /// fora da batalha.
        /// </summary>
        [Test]
        public void TodoControleFicaNaFaixaDeBaixo()
        {
            Progressao.Progresso p;
            Progressao.Descida d;
            var tela = Tela();
            tela.Montar(Escolha(out p, out d));

            int botoes = 0;
            foreach (var e in Cenario.Todos(tela.Raiz))
            {
                var b = e as Button;
                if (b == null) continue;
                botoes++;
                Assert.IsTrue(EhDescendente(tela.Acoes, b),
                    Cenario.Descreve(b) + " é tocável e não está na faixa de ações");
                Assert.IsTrue(Toque.EhAlvo(b),
                    Cenario.Descreve(b) + " é um Button e não tem a classe '" +
                    Toque.ClasseDeAlvo + "' — vai para o aparelho do tamanho do texto");
            }
            Assert.Greater(botoes, 1, "a tela de escolha montou sem botões");
        }

        [Test]
        public void NenhumAlvoDeToqueDoFluxoFicaAbaixoDe44Pontos()
        {
            Assert.IsTrue(File.Exists(CaminhoDoEstilo), "não achei " + CaminhoDoEstilo);
            var regras = LeitorDeUss.Ler(File.ReadAllText(CaminhoDoEstilo));
            Assert.IsNotEmpty(regras, "a folha de estilo do fluxo foi lida vazia");

            Progressao.Progresso p;
            Progressao.Descida d;
            var tela = Tela();
            tela.Montar(Escolha(out p, out d));

            int alvos = 0;
            foreach (var e in Cenario.Todos(tela.Raiz))
            {
                if (!Toque.EhAlvo(e)) continue;
                alvos++;

                var classes = new List<string>(e.GetClasses());
                float? minLargura = null, minAltura = null;
                float larguraFixa = 0f, alturaFixa = 0f;

                foreach (var regra in regras)
                {
                    if (!Casa(regra, e, classes)) continue;

                    float v;
                    if (regra.Declaracoes.ContainsKey("min-width") &&
                        LeitorDeUss.TentaPixels(regra.Declaracoes["min-width"], out v)) minLargura = v;
                    if (regra.Declaracoes.ContainsKey("min-height") &&
                        LeitorDeUss.TentaPixels(regra.Declaracoes["min-height"], out v)) minAltura = v;
                    if (regra.Declaracoes.ContainsKey("width") &&
                        LeitorDeUss.TentaPixels(regra.Declaracoes["width"], out v)) larguraFixa = v;
                    if (regra.Declaracoes.ContainsKey("height") &&
                        LeitorDeUss.TentaPixels(regra.Declaracoes["height"], out v)) alturaFixa = v;

                    ConfereTeto(regra, "max-width", e);
                    ConfereTeto(regra, "max-height", e);
                }

                Assert.IsTrue(minLargura.HasValue,
                    Cenario.Descreve(e) + " é alvo de dedo e nenhuma regra do USS do fluxo " +
                    "lhe dá 'min-width'");
                Assert.IsTrue(minAltura.HasValue,
                    Cenario.Descreve(e) + " é alvo de dedo e nenhuma regra do USS do fluxo " +
                    "lhe dá 'min-height'");

                Assert.GreaterOrEqual(Mathf.Max(minLargura.Value, larguraFixa), Toque.MinimoEmPontos,
                    Cenario.Descreve(e) + " é estreito demais para um dedo");
                Assert.GreaterOrEqual(Mathf.Max(minAltura.Value, alturaFixa), Toque.MinimoEmPontos,
                    Cenario.Descreve(e) + " é baixo demais para um dedo");
            }

            Assert.Greater(alvos, 0, "a tela de fluxo montou sem alvo de toque nenhum");
        }

        [Test]
        public void AFolhaDoFluxoNaoDependeDeHover()
        {
            var regras = LeitorDeUss.Ler(File.ReadAllText(CaminhoDoEstilo));
            foreach (var regra in regras)
                for (int i = 0; i < regra.Seletores.Count; i++)
                    Assert.IsFalse(regra.Seletores[i].Contains(":hover"),
                        "a regra '" + regra.Seletores[i] + "' depende de ':hover', que no " +
                        "celular nunca dispara");
        }

        // ================================================================ apoio

        static void ConfereTeto(RegraDeUss regra, string propriedade, VisualElement alvo)
        {
            if (!regra.Declaracoes.ContainsKey(propriedade)) return;
            float v;
            if (!LeitorDeUss.TentaPixels(regra.Declaracoes[propriedade], out v)) return;
            Assert.GreaterOrEqual(v, Toque.MinimoEmPontos,
                Cenario.Descreve(alvo) + ": a regra '" + string.Join(", ", regra.Seletores.ToArray()) +
                "' põe " + propriedade + ": " + v + "px, abaixo do piso de dedo");
        }

        static bool Casa(RegraDeUss regra, VisualElement alvo, List<string> classes)
        {
            for (int i = 0; i < regra.Seletores.Count; i++)
                if (LeitorDeUss.Aplica(regra.Seletores[i], alvo.name, classes, alvo.GetType()))
                    return true;
            return false;
        }

        static bool EhDescendente(VisualElement pai, VisualElement filho)
        {
            for (var e = filho; e != null; e = e.parent)
                if (e == pai) return true;
            return false;
        }
    }
}
