using NUnit.Framework;
using UnityEngine;
using Soterra.Cena;
using Soterra.Grade;

namespace Soterra.Testes.Cena
{
    /// <summary>
    /// A sala tem de caber na tela de um CELULAR, deitado e em pé.
    ///
    /// Estes testes existem separados dos do palco porque cobram outra coisa: lá
    /// se prova que o enquadramento fecha na proporção da foto; aqui se prova
    /// que ele fecha nas DUAS proporções do destino. É fácil acertar uma e
    /// descobrir a outra tarde demais — o mapa sai com as pontas cortadas
    /// exatamente na hora em que alguém vira o aparelho.
    /// </summary>
    public class EnquadramentoDeCelularTests
    {
        /// <summary>16:9 deitado. A proporção mais comum de tela de celular.</summary>
        const float Deitado = 16f / 9f;

        /// <summary>9:16 em pé. É a mesma tela virada, e não uma tela nova — mas
        /// para uma câmera ortográfica é um problema diferente.</summary>
        const float EmPe = 9f / 16f;

        GameObject _go;
        Palco _palco;

        [SetUp]
        public void Antes()
        {
            _go = new GameObject("palco-de-teste");
            _palco = _go.AddComponent<Palco>();
        }

        [TearDown]
        public void Depois()
        {
            if (_go != null) Object.DestroyImmediate(_go);
        }

        [Test]
        public void SalaDe21x17_CabeDeitadaEEmPe_NasQuatroRotacoes()
        {
            // A sala de verdade da Estufa, 21×17. A miniatura não serve: o
            // enquadramento só falha quando o mapa é grande.
            var mapa = Mapa.DeTexto(FotoDoPalco.SalaDeProva);
            Assert.AreEqual(21, mapa.Largura);
            Assert.AreEqual(17, mapa.Altura);

            foreach (var proporcao in new[] { Deitado, EmPe })
            {
                _palco.Montar(mapa);
                _palco.Camera.aspect = proporcao;

                for (int giro = 0; giro < 4; giro++)
                {
                    _palco.Enquadrar();
                    ConfereQueCabe(mapa, proporcao, giro);
                    _palco.Girar(1);
                }
            }
        }

        [Test]
        public void SalaMaiorDoJogo_27x23_TambemCabe()
        {
            // O teto de tamanho de sala do SISTEMAS.md §2. Se o enquadramento
            // aguenta esta, aguenta todas.
            var linhas = new string[23];
            for (int y = 0; y < 23; y++)
            {
                var linha = new char[27];
                for (int x = 0; x < 27; x++)
                    linha[x] = (y == 0 || y == 22 || x == 0 || x == 26) ? '#' : '.';
                linhas[y] = new string(linha);
            }
            var mapa = Mapa.DeTexto(linhas);

            foreach (var proporcao in new[] { Deitado, EmPe })
            {
                _palco.Montar(mapa);
                _palco.Camera.aspect = proporcao;
                _palco.Enquadrar();
                ConfereQueCabe(mapa, proporcao, 0);
            }
        }

        [Test]
        public void EmPe_OTabuleiroUsaQuaseTodaALargura()
        {
            // "Cabe" não basta: em pé, a largura é o lado apertado, e um
            // tabuleiro que só ocupasse metade dela estaria sendo desperdiçado
            // por um enquadramento frouxo, não por geometria.
            //
            // A altura sobra MUITO em pé, e isso é geometria, não defeito: com a
            // câmera em 3/4 a 45° o tabuleiro projeta um losango bem mais largo
            // que alto. O espaço que sobra embaixo é onde a Interface põe o HUD.
            var mapa = Mapa.DeTexto(FotoDoPalco.SalaDeProva);
            _palco.Montar(mapa);
            _palco.Camera.aspect = EmPe;
            _palco.Enquadrar();

            float usada = FracaoUsadaEmX(mapa);
            Assert.Greater(usada, 0.85f,
                           "em pé o tabuleiro ocupa só " + (usada * 100f).ToString("0") +
                           "% da largura — está pequeno demais para o dedo acertar a casa");
        }

        // =============================================================== APOIO

        void ConfereQueCabe(Mapa mapa, float proporcao, int giro)
        {
            var cam = _palco.Camera;
            for (int y = 0; y < mapa.Altura; y++)
            {
                for (int x = 0; x < mapa.Largura; x++)
                {
                    var casa = new Vector2Int(x, y);
                    // O '~' fica de FORA: ele é o escuro em volta da sala, não a
                    // sala. Enquadrá-lo custaria um terço da tela de celular —
                    // ver o comentário gêmeo em PalcoTests.
                    if (mapa.Em(casa) == Soterra.Grade.Casa.Vazio) continue;

                    // O TOPO da casa, não o chão: parede de borda cortada ao
                    // meio é o jeito favorito de este enquadramento falhar.
                    var v = cam.WorldToViewportPoint(_palco.Mundo(casa, _palco.TopoDe(casa)));
                    string onde = "casa " + casa + " (proporção " + proporcao.ToString("0.00") +
                                  ", giro " + giro + ")";
                    Assert.Greater(v.z, 0f, onde + " ficou atrás da câmera");
                    Assert.That(v.x, Is.InRange(0f, 1f), onde + " saiu da imagem em X");
                    Assert.That(v.y, Is.InRange(0f, 1f), onde + " saiu da imagem em Y");
                }
            }
        }

        float FracaoUsadaEmX(Mapa mapa)
        {
            var cam = _palco.Camera;
            float min = 1f, max = 0f;
            for (int y = 0; y < mapa.Altura; y++)
                for (int x = 0; x < mapa.Largura; x++)
                {
                    float vx = cam.WorldToViewportPoint(_palco.Mundo(new Vector2Int(x, y))).x;
                    min = Mathf.Min(min, vx);
                    max = Mathf.Max(max, vx);
                }
            return max - min;
        }
    }
}
