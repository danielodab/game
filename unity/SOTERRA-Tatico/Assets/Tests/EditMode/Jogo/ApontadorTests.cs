using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.Jogo
{
    // Ver a nota de armadilha de nome em AcervoDoJogo.cs.
    using Cena = global::Soterra.Cena;
    using Jogo = global::Soterra.Jogo;
    using Grade = global::Soterra.Grade;

    /// <summary>
    /// Raio no chão → casa. É a metade testável do toque: se isto erra por meio
    /// passo, o clique cai na casa vizinha e o jogador chama de azar — o pior
    /// defeito de tabuleiro, porque nunca é reproduzível na hora.
    /// </summary>
    public class ApontadorTests
    {
        // Retângulo NÃO quadrado, como nos testes do Palco: num mapa quadrado
        // uma troca de eixo entre X e Y passa despercebida.
        static readonly string[] Sala =
        {
            "#######",
            "#.....#",
            "#..#..#",
            "#P..~a#",
            "#######"
        };

        GameObject _go;
        Cena.Palco _palco;

        [SetUp]
        public void Antes()
        {
            _go = new GameObject("palco-do-apontador");
            _palco = _go.AddComponent<Cena.Palco>();
            _palco.Pecas = new Cena.SemPecas();
            _palco.Montar(Grade.Mapa.DeTexto(Sala));
        }

        [TearDown]
        public void Depois()
        {
            if (_go != null) Object.DestroyImmediate(_go);
        }

        /// <summary>Um raio vertical caindo no centro da casa — o caso do dedo.</summary>
        static Ray DeCima(Vector3 alvo)
        {
            return new Ray(alvo + Vector3.up * 5f, Vector3.down);
        }

        [Test]
        public void RaioNoCentroDeCadaCasa_DevolveACasaExata()
        {
            for (int y = 0; y < 5; y++)
                for (int x = 0; x < 7; x++)
                {
                    var casa = new Vector2Int(x, y);
                    var achada = Jogo.Apontador.CasaDoRaio(_palco, DeCima(_palco.Mundo(casa)));
                    Assert.AreEqual(casa, achada, "o raio no centro de " + casa + " caiu em " + achada);
                }
        }

        [Test]
        public void RaioInclinado_ComoODaCamera_TambemAcerta()
        {
            // A câmera do palco olha a 38° de inclinação e 45° de guinada; o
            // raio do toque chega assim, nunca de cima. A conta do plano não
            // pode depender do ângulo.
            var direcao = Quaternion.Euler(Cena.Palco.Inclinacao, Cena.Palco.Guinada, 0f) *
                          Vector3.forward;
            var casa = new Vector2Int(3, 1);
            var origem = _palco.Mundo(casa) - direcao * 20f;

            Assert.AreEqual(casa, Jogo.Apontador.CasaDoRaio(_palco, new Ray(origem, direcao)));
        }

        [Test]
        public void DepoisDeGirarOTabuleiro_OMesmoPontoDoMundoAindaResolve()
        {
            var casa = new Vector2Int(5, 3);
            _palco.Girar(1);

            // Mundo() já leva o giro; o raio cai no ponto girado e Casa() tem de
            // desfazer o giro sozinha — é o par exato que o contrato da rodada 1
            // cobra de Mundo/Casa, agora atravessando o toque.
            var achada = Jogo.Apontador.CasaDoRaio(_palco, DeCima(_palco.Mundo(casa)));
            Assert.AreEqual(casa, achada);
        }

        [Test]
        public void RaioQueNaoTocaOChao_ENulo()
        {
            var paralelo = new Ray(new Vector3(0f, 2f, 0f), Vector3.forward);
            Assert.IsNull(Jogo.Apontador.CasaDoRaio(_palco, paralelo),
                          "raio paralelo ao chão não tem casa — devolver uma inventaria um toque");

            var paraCima = new Ray(new Vector3(0f, 2f, 0f), Vector3.up);
            Assert.IsNull(Jogo.Apontador.CasaDoRaio(_palco, paraCima));
        }

        [Test]
        public void RaioForaDoMapa_ENulo()
        {
            // O chão matemático é infinito; o mapa não. Sem este corte, tocar o
            // escuro em volta da sala mandaria ao motor uma casa que não existe.
            var fora = _palco.Mundo(new Vector2Int(0, 0)) + new Vector3(-10f, 0f, 0f);
            Assert.IsNull(Jogo.Apontador.CasaDoRaio(_palco, DeCima(fora)));
        }
    }
}
