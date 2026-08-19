using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using Soterra.Cena;
using Soterra.Grade;

namespace Soterra.Testes.Cena
{
    /// <summary>
    /// A sala montada com as peças do env-kit: qual peça cai em qual casa, quanto
    /// a sala custa para desenhar, e o que acontece quando o kit não está lá.
    /// </summary>
    public class CenografiaTests
    {
        /// <summary>
        /// Um mapa que contém os SEIS casos de auto-tiling: anel de borda (reta e
        /// quina), uma travessa que cruza outra parede (cruz e T), uma ponta solta
        /// (meia-parede) e um '#' sozinho no meio do salão (coluna).
        ///
        /// Ter os seis num mapa só importa: a regra é uma escada de contagem, e
        /// um mapa que só exercita reta e quina deixa cruz e T passarem errados
        /// por meses — são justamente eles que só aparecem em sala grande.
        /// </summary>
        static readonly string[] Sala =
        {
            "#########",
            "#.......#",
            "#..#....#",
            "#####...#",
            "#..#....#",
            "#.......#",
            "#...#...#",
            "#.......#",
            "#########"
        };

        GameObject _go;
        Palco _palco;
        Mapa _mapa;

        [SetUp]
        public void Antes()
        {
            _go = new GameObject("palco-de-teste");
            _palco = _go.AddComponent<Palco>();
            _mapa = Mapa.DeTexto(Sala);
        }

        [TearDown]
        public void Depois()
        {
            if (_go != null) Object.DestroyImmediate(_go);
        }

        // ============================================================ AUTO-TILING

        [Test]
        public void Vizinhanca_NaoContaParedeFORADoMapa()
        {
            // O canto de um anel de parede tem DOIS vizinhos, não quatro. Quem
            // trata o lado de fora como parede acha quatro, monta uma cruz no
            // canto, e o erro fica escondido na borda — que é metade do que se vê.
            var canto = new Vector2Int(0, 0);
            Assert.AreEqual(Casa.ObstaculoAlto, _mapa.Em(canto), "o mapa de teste saiu do lugar");

            var vizinhos = Cenografia.Vizinhanca(_mapa, canto);
            Assert.AreEqual(2, AutoParede.Conta(vizinhos),
                            "o canto do mapa achou parede fora do tabuleiro: " + vizinhos);
            Assert.IsFalse(AutoParede.Reta(vizinhos), "o canto tinha de dar dois lados adjacentes");
        }

        [Test]
        public void Vizinhanca_IgnoraOObstaculoBAIXO()
        {
            // Cobertura NÃO é parede, e encostar uma na outra não pode fazer a
            // parede estender braço para dentro do caixote — a peça sairia
            // atravessando a casa vizinha, que é andável.
            var mapa = Mapa.DeTexto(new[] { ".=.", "=#=", ".=." });
            Assert.AreEqual(Lados.Nenhum, Cenografia.Vizinhanca(mapa, new Vector2Int(1, 1)));
        }

        [Test]
        public void Montar_EscolheAPecaQueAVizinhancaPedeEmTODAAsala()
        {
            _palco.Montar(_mapa);
            if (!ComKit()) Assert.Ignore("env-kit não importado: rode converter_cenario.ps1");

            var vistos = new HashSet<int>();

            for (int y = 0; y < _mapa.Altura; y++)
                for (int x = 0; x < _mapa.Largura; x++)
                {
                    var casa = new Vector2Int(x, y);
                    if (_mapa.Em(casa) != Casa.ObstaculoAlto) continue;

                    var vizinhos = Cenografia.Vizinhanca(_mapa, casa);
                    int quantos = AutoParede.Conta(vizinhos);
                    var peca = _palco.DesenhoDa(casa).Value.Peca;
                    string onde = casa + " (" + vizinhos + ")";
                    vistos.Add(quantos == 2 && AutoParede.Reta(vizinhos) ? 5 : quantos);

                    switch (quantos)
                    {
                        case 4:
                            Assert.AreEqual("wall_cross", peca, onde + " pedia cruz");
                            break;
                        case 3:
                            Assert.AreEqual("wall_tsplit", peca, onde + " pedia T");
                            break;
                        case 2 when AutoParede.Reta(vizinhos):
                            // A reta tem VARIANTES — pilar embutido, rachada,
                            // janela — para uma parede longa não virar o mesmo
                            // tijolo vinte vezes. O que não pode é virar quina.
                            StringAssert.StartsWith("wall_", peca, onde + " pedia trecho reto");
                            Assert.AreNotEqual("wall_corner", peca, onde + " virou quina");
                            Assert.AreNotEqual("wall_half", peca, onde + " virou meia-parede");
                            break;
                        case 2:
                            Assert.AreEqual("wall_corner", peca, onde + " pedia quina");
                            break;
                        case 1:
                            Assert.AreEqual("wall_half", peca, onde + " pedia meia-parede");
                            break;
                        default:
                            StringAssert.StartsWith("pillar", peca, onde + " pedia coluna solta");
                            break;
                    }
                }

            // O mapa tem de exercitar os seis casos, senão o teste acima passa
            // sem ter olhado para cruz nem para T.
            CollectionAssert.AreEquivalent(new[] { 0, 1, 2, 3, 4, 5 }, vistos,
                                           "o mapa de teste deixou de cobrir algum caso");
        }

        [Test]
        public void Montar_GiraAPecaAteOsBracosBateremComOsVizinhos()
        {
            _palco.Montar(_mapa);
            if (!ComKit()) Assert.Ignore("env-kit não importado: rode converter_cenario.ps1");

            // A prova de que o giro está certo não é um número: é que os braços da
            // peça, girados, caiam exatamente sobre os vizinhos de parede. É a
            // mesma conta que fecha a sala, e é ela que sobrevive ao dia em que a
            // ponte glTF→FBX trocar um eixo de sinal — e ela JÁ espelha o X.
            var pecas = new PecasDeResources();
            float escala = Palco.Passo / pecas.Peca("wall_str").Caixa.size.x;

            for (int y = 0; y < _mapa.Altura; y++)
                for (int x = 0; x < _mapa.Largura; x++)
                {
                    var casa = new Vector2Int(x, y);
                    if (_mapa.Em(casa) != Casa.ObstaculoAlto) continue;

                    var vizinhos = Cenografia.Vizinhanca(_mapa, casa);
                    if (vizinhos == Lados.Nenhum) continue;      // coluna gira à toa

                    var desenho = _palco.DesenhoDa(casa).Value;
                    var peca = pecas.Peca(desenho.Peca);
                    Assert.IsNotNull(peca, "peça " + desenho.Peca + " sumiu do kit");

                    var bracos = AutoParede.BracosDe(new Bounds(peca.Caixa.center * escala,
                                                                peca.Caixa.size * escala));
                    Assert.AreEqual(vizinhos, AutoParede.Girar(bracos, desenho.Quartos),
                                    "a parede em " + casa + " (" + desenho.Peca +
                                    ", giro " + desenho.Quartos + ") não encaixa nos vizinhos");
                }
        }

        [Test]
        public void Montar_DuasVezesEscolheAsMesmasPecas()
        {
            // A sala tem de sair IGUAL toda vez. Sem isso o teste mede uma coisa,
            // a foto mostra outra, e "a parede mudou sozinha" vira um fantasma.
            _palco.Montar(_mapa);
            var primeira = Retrato();
            _palco.Montar(_mapa);
            CollectionAssert.AreEqual(primeira, Retrato(),
                                      "a sala mudou de peça entre duas montagens");
        }

        List<string> Retrato()
        {
            var saida = new List<string>();
            for (int y = 0; y < _mapa.Altura; y++)
                for (int x = 0; x < _mapa.Largura; x++)
                {
                    var d = _palco.DesenhoDa(new Vector2Int(x, y));
                    saida.Add(d.HasValue ? d.Value.Peca + "/" + d.Value.Quartos : "-");
                }
            return saida;
        }

        // =========================================================== ORÇAMENTO

        [Test]
        public void Montar_UmaSalaDeVerdadeCabeEmPunhadoDeObjetos()
        {
            // 21×17 são 357 casas. Com malha própria em cada uma seriam 357
            // objetos e outras tantas chamadas de desenho, e é isso que derruba um
            // celular. A sala é costurada por TINTA, e o custo dela não cresce com
            // o tamanho do mapa — que é o que este teste cobra ao comparar a sala
            // grande com a pequena.
            var grande = Mapa.DeTexto(FotoDoPalco.SalaDeProva);
            Assert.AreEqual(357, grande.Largura * grande.Altura, "a sala de prova mudou de tamanho");

            _palco.Montar(grande);
            int custoGrande = _palco.Cenografia.Objetos;
            Assert.LessOrEqual(custoGrande, 8,
                               "a sala passou de oito objetos: o custo voltou a crescer com o mapa");

            _palco.Montar(_mapa);
            Assert.LessOrEqual(_palco.Cenografia.Objetos, custoGrande,
                               "a sala pequena custou mais objetos que a grande");
        }

        [Test]
        public void Montar_NaoEmpilhaUmSegundoTabuleiro()
        {
            // As malhas da sala são criadas por código e não são asset: sem
            // destruí-las, cada remontagem deixaria uma malha do tamanho do
            // tabuleiro na memória, e ninguém veria isso na tela.
            _palco.Montar(_mapa);
            int primeira = _go.GetComponentsInChildren<MeshFilter>(true).Length;
            _palco.Montar(_mapa);
            Assert.AreEqual(primeira, _go.GetComponentsInChildren<MeshFilter>(true).Length,
                            "montar de novo empilhou um segundo tabuleiro");
        }

        // ============================================================== RESERVA

        [Test]
        public void SemOKit_ASalaCaiNoCuboEContinuaLegivel()
        {
            // Sala vazia parece mapa carregado errado, não peça faltando. O cubo
            // da rodada 1 continua sendo a reserva, e a leitura de alto contra
            // baixo tem de sobreviver a ela.
            var comCobertura = Mapa.DeTexto(new[] { "###", "#=#", "###" });
            _palco.Pecas = new SemPecas();
            _palco.Montar(comCobertura);

            Assert.IsFalse(_palco.Cenografia.ComKit);

            var alto = _palco.DesenhoDa(new Vector2Int(1, 0)).Value;
            var baixo = _palco.DesenhoDa(new Vector2Int(1, 1)).Value;
            Assert.IsTrue(alto.Cubo, "sem kit, a parede tinha de cair no cubo");
            Assert.IsTrue(baixo.Cubo, "sem kit, a cobertura tinha de cair no cubo");
            Assert.Greater(alto.Topo, baixo.Topo * 1.9f, "o cubo perdeu a diferença de altura");
            Assert.Greater(alto.Pegada, baixo.Pegada * 1.3f, "o cubo perdeu o anel de piso");

            Assert.LessOrEqual(_palco.Cenografia.Objetos, 8);
        }

        [Test]
        public void OVazio_NaoRecebeNadaNemComKitNemSemEle()
        {
            var comRecorte = Mapa.DeTexto(new[] { "~#~", "#.#", "~#~" });

            foreach (var fonte in new IFonteDePecas[] { new PecasDeResources(), new SemPecas() })
            {
                _palco.Pecas = fonte;
                _palco.Montar(comRecorte);
                // A silhueta da sala é feita de buraco; tapá-lo apagaria o recorte
                // e a sala voltaria a ser uma caixa retangular.
                Assert.IsNull(_palco.DesenhoDa(new Vector2Int(0, 0)),
                              "o vazio ganhou peça com a fonte " + fonte.GetType().Name);
                Assert.IsNotNull(_palco.DesenhoDa(new Vector2Int(1, 1)));
            }
        }

        [Test]
        public void DesenhoDa_ForaDoMapaNaoDevolveNada()
        {
            _palco.Montar(_mapa);
            Assert.IsNull(_palco.DesenhoDa(new Vector2Int(-1, 0)));
            Assert.IsNull(_palco.DesenhoDa(new Vector2Int(999, 999)));
        }

        bool ComKit()
        {
            return _palco.Cenografia != null && _palco.Cenografia.ComKit;
        }
    }
}
