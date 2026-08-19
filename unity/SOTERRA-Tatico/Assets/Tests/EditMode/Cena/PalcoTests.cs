using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using Soterra.Cena;
using Soterra.Grade;

namespace Soterra.Testes.Cena
{
    /// <summary>
    /// O palco é EditMode inteiro de propósito: se estes testes passam, `Montar`
    /// funciona fora de Play — que é a única forma de o modo lote fotografar
    /// qualquer coisa. Um teste PlayMode aqui não provaria isso.
    /// </summary>
    public class PalcoTests
    {
        // Retângulo NÃO quadrado (7×5) e com os cinco tipos de casa. Não quadrado
        // porque num mapa quadrado uma troca de eixo entre X e Y passa despercebida
        // — e é exatamente esse erro que faz o clique cair na casa errada.
        static readonly string[] Sala =
        {
            "#######",
            "#.=.,.#",
            "#..#..#",
            "#P.~.a#",
            "#######"
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

        // ================================================================ MONTAR

        [Test]
        public void Montar_ForaDePlay_DesenhaUmaPecaPorCasaEDeixaOVazioVazio()
        {
            Assert.IsFalse(Application.isPlaying,
                           "este teste só vale alguma coisa fora de Play — é o modo do lote");

            _palco.Montar(_mapa);

            for (int y = 0; y < _mapa.Altura; y++)
            {
                for (int x = 0; x < _mapa.Largura; x++)
                {
                    var casa = new Vector2Int(x, y);
                    var peca = _palco.ObjetoDa(casa);
                    if (_mapa.Em(casa) == Casa.Vazio)
                        Assert.IsNull(peca, "buraco em " + casa + " ganhou peça: a silhueta da " +
                                            "sala é feita de buraco, tapá-lo apaga o recorte");
                    else
                        Assert.IsNotNull(peca, "casa " + casa + " ficou sem nada desenhado");
                }
            }
        }

        [Test]
        public void Montar_DuasVezes_NaoEmpilhaDoisTabuleiros()
        {
            _palco.Montar(_mapa);
            int primeira = _go.GetComponentsInChildren<Renderer>(true).Length;
            _palco.Montar(_mapa);
            int segunda = _go.GetComponentsInChildren<Renderer>(true).Length;

            Assert.AreEqual(primeira, segunda,
                            "montar de novo duplicou os objetos — fora de Play, Destroy() não " +
                            "faz nada e o empilhamento seria invisível");
        }

        [Test]
        public void Montar_SemMapa_Reclama()
        {
            Assert.Throws<System.ArgumentNullException>(() => _palco.Montar(null));
        }

        [Test]
        public void Camera_EhOrtograficaESempreNoMesmoAngulo()
        {
            _palco.Montar(_mapa);

            Assert.IsNotNull(_palco.Camera);
            Assert.IsTrue(_palco.Camera.orthographic, "a decisão fechada é ortográfica");
            var e = _palco.Camera.transform.rotation.eulerAngles;
            Assert.AreEqual(Palco.Inclinacao, e.x, 0.01f);
            Assert.AreEqual(Palco.Guinada, e.y, 0.01f);
            Assert.AreEqual(0f, Mathf.DeltaAngle(0f, e.z), 0.01f, "câmera torta na tela");
        }

        // =========================================================== MUNDO ↔ CASA

        [Test]
        public void MundoECasa_SaoInversosExatos_EmTodaCasaENasQuatroRotacoes()
        {
            _palco.Montar(_mapa);

            for (int giro = 0; giro < 4; giro++)
            {
                for (int y = 0; y < _mapa.Altura; y++)
                {
                    for (int x = 0; x < _mapa.Largura; x++)
                    {
                        var casa = new Vector2Int(x, y);
                        Assert.AreEqual(casa, _palco.Casa(_palco.Mundo(casa)),
                                        "ida e volta falhou em " + casa + ", giro " + giro);
                        // com altura também: o clique vem de um raio, e o ponto
                        // dele quase nunca está exatamente em y = 0
                        Assert.AreEqual(casa, _palco.Casa(_palco.Mundo(casa, 1.37f)),
                                        "altura mudou a casa em " + casa + ", giro " + giro);
                    }
                }
                _palco.Girar(1);
            }
        }

        [Test]
        public void Casa_QualquerPontoDentroDaCasaVoltaNaPropriaCasa_NasQuatroRotacoes()
        {
            _palco.Montar(_mapa);

            // 0,45 de uma casa: quase na divisa, ainda dentro. É aqui que um
            // arredondamento errado joga o clique na casa vizinha — e o jogador
            // chama isso de azar em vez de defeito.
            var desvios = new[]
            {
                new Vector3(0.45f, 0f, 0.45f), new Vector3(-0.45f, 0f, 0.45f),
                new Vector3(0.45f, 0f, -0.45f), new Vector3(-0.45f, 0f, -0.45f),
                new Vector3(0.49f, 0f, 0f), new Vector3(0f, 0f, -0.49f)
            };

            for (int giro = 0; giro < 4; giro++)
            {
                for (int y = 0; y < _mapa.Altura; y++)
                {
                    for (int x = 0; x < _mapa.Largura; x++)
                    {
                        var casa = new Vector2Int(x, y);
                        var centro = _palco.Mundo(casa);
                        for (int d = 0; d < desvios.Length; d++)
                            Assert.AreEqual(casa, _palco.Casa(centro + desvios[d] * Palco.Passo),
                                            "desvio " + desvios[d] + " em " + casa +
                                            " caiu na casa vizinha (giro " + giro + ")");
                    }
                }
                _palco.Girar(1);
            }
        }

        [Test]
        public void Casa_ForaDoTabuleiro_NaoGrudaNaBorda()
        {
            _palco.Montar(_mapa);

            // Devolver a casa de fora, e não a mais próxima, é o que deixa quem
            // chama distinguir "clicou fora" de "clicou na borda" com Mapa.Dentro.
            var fora = _palco.Casa(_palco.Mundo(new Vector2Int(0, 0)) +
                                   new Vector3(-3f, 0f, 0f) * Palco.Passo);
            Assert.IsFalse(_mapa.Dentro(fora), "ponto fora do tabuleiro virou casa de dentro: " + fora);
        }

        [Test]
        public void Mundo_AlturaDeslocaSoNoEixoY_EmQualquerRotacao()
        {
            _palco.Montar(_mapa);

            for (int giro = 0; giro < 4; giro++)
            {
                var casa = new Vector2Int(2, 1);
                var d = _palco.Mundo(casa, 2.5f) - _palco.Mundo(casa, 0f);
                Assert.AreEqual(0f, d.x, 1e-4f);
                Assert.AreEqual(2.5f, d.y, 1e-4f);
                Assert.AreEqual(0f, d.z, 1e-4f);
                _palco.Girar(1);
            }
        }

        // ================================================================= GIRAR

        [Test]
        public void Girar_QuatroQuartosVoltamParaOMesmoLugar()
        {
            _palco.Montar(_mapa);
            var antes = TodasAsPosicoes();
            _palco.Girar(4);
            var depois = TodasAsPosicoes();

            for (int i = 0; i < antes.Count; i++)
                Assert.Less(Vector3.Distance(antes[i], depois[i]), 1e-3f,
                            "giro de volta inteira mexeu o tabuleiro de lugar");
        }

        [Test]
        public void Girar_MenosUmEhOMesmoQueMaisTres()
        {
            _palco.Montar(_mapa);
            _palco.Girar(-1);

            var outroGo = new GameObject("palco-de-controle");
            try
            {
                var outro = outroGo.AddComponent<Palco>();
                outro.Montar(Mapa.DeTexto(Sala));
                outro.Girar(3);

                for (int y = 0; y < _mapa.Altura; y++)
                    for (int x = 0; x < _mapa.Largura; x++)
                    {
                        var casa = new Vector2Int(x, y);
                        Assert.Less(Vector3.Distance(_palco.Mundo(casa), outro.Mundo(casa)), 1e-3f,
                                    "−1 e +3 pararam em lugares diferentes na casa " + casa);
                    }
            }
            finally { Object.DestroyImmediate(outroGo); }
        }

        // ============================================================ ENQUADRAR

        [Test]
        public void Enquadrar_CabeOMapaInteiroNaImagem_NasQuatroRotacoes()
        {
            // A sala de verdade da foto (21×17), e não a miniatura: o
            // enquadramento só falha quando o mapa é grande.
            var grande = Mapa.DeTexto(FotoDoPalco.SalaDeProva);
            _palco.Montar(grande);
            _palco.Camera.aspect = 1.6f;          // 1600×1000, a proporção da foto

            for (int giro = 0; giro < 4; giro++)
            {
                _palco.Enquadrar();
                for (int y = 0; y < grande.Altura; y++)
                {
                    for (int x = 0; x < grande.Largura; x++)
                    {
                        var casa = new Vector2Int(x, y);
                        // O '~' fica de FORA da conta. Ele não é tabuleiro: é o
                        // escuro em volta, e o enquadramento não desenha nada
                        // ali. Cobrar que ele caiba obrigaria a câmera a
                        // enquadrar as quinas do retângulo — que numa vista a
                        // 45° são as pontas do losango — e um terço da tela de
                        // celular iria para buraco vazio.
                        if (grande.Em(casa) == Casa.Vazio) continue;

                        // o TOPO da casa, não o chão: parede de borda cortada ao
                        // meio é o jeito favorito de este enquadramento falhar
                        var v = _palco.Camera.WorldToViewportPoint(
                            _palco.Mundo(casa, _palco.TopoDe(casa)));
                        Assert.Greater(v.z, 0f, "casa " + casa + " atrás da câmera (giro " + giro + ")");
                        Assert.That(v.x, Is.InRange(0f, 1f), "casa " + casa + " fora da imagem em X (giro " + giro + ")");
                        Assert.That(v.y, Is.InRange(0f, 1f), "casa " + casa + " fora da imagem em Y (giro " + giro + ")");
                    }
                }
                _palco.Girar(1);
            }
        }

        // ========================================================== ALTO ≠ BAIXO

        [Test]
        public void AltoEBaixo_SeSeparamPorAlturaTamanhoECor()
        {
            _palco.Montar(_mapa);

            var alto = new Vector2Int(3, 2);    // '#' do miolo
            var baixo = new Vector2Int(2, 3);   // '=' da linha de cima
            Assert.AreEqual(Casa.ObstaculoAlto, _mapa.Em(alto), "o mapa de teste saiu do lugar");
            Assert.AreEqual(Casa.ObstaculoBaixo, _mapa.Em(baixo), "o mapa de teste saiu do lugar");

            var pAlto = _palco.ObjetoDa(alto);
            var pBaixo = _palco.ObjetoDa(baixo);
            Assert.IsNotNull(pAlto);
            Assert.IsNotNull(pBaixo);

            // 1) ALTURA: o alto tem de ser mais que o dobro. Abaixo disso, na
            // projeção 3/4 os dois viram o mesmo bloco.
            Assert.Greater(_palco.TopoDe(alto), _palco.TopoDe(baixo) * 1.9f,
                           "alto e baixo com alturas parecidas demais");

            // 2) TAMANHO: o alto preenche a casa, o baixo deixa um anel de chão.
            Assert.Greater(pAlto.transform.localScale.x, pBaixo.transform.localScale.x * 1.3f,
                           "o baixo precisa do anel de piso em volta para ler como algo SOBRE o chão");

            // 3) COR: contraste de claro/escuro, que sobrevive em foto pequena e
            // para quem não separa as duas matizes.
            float lAlto = Luz(CorDe(pAlto));
            float lBaixo = Luz(CorDe(pBaixo));
            Assert.Greater(Mathf.Abs(lAlto - lBaixo), 0.25f,
                           "alto e baixo com o mesmo valor de cor: em cubo, sem silhueta " +
                           "própria, a cor é metade da leitura");

            // 4) nenhum dos dois pode sumir dentro do chão
            float lChao = Luz(Palco.CorChao);
            Assert.Greater(Mathf.Abs(lAlto - lChao), 0.05f, "obstáculo alto se confunde com o piso");
            Assert.Greater(Mathf.Abs(lBaixo - lChao), 0.05f, "obstáculo baixo se confunde com o piso");
        }

        // ================================================================ REALCE

        [Test]
        public void Realcar_AcumulaEmVezDeSubstituir()
        {
            _palco.Montar(_mapa);

            _palco.Realcar(new[] { new Vector2Int(1, 1), new Vector2Int(2, 1) }, Palco.CorAlcance);
            Assert.AreEqual(2, _palco.Realcadas.Count);

            // acumular é requisito: o jogo mostra alcance de passo e alcance de
            // feitiço ao mesmo tempo, em cores diferentes
            _palco.Realcar(new[] { new Vector2Int(3, 1) }, Color.red);
            Assert.AreEqual(3, _palco.Realcadas.Count);

            _palco.LimparRealce();
            Assert.AreEqual(0, _palco.Realcadas.Count);
        }

        [Test]
        public void Realcar_IgnoraCasaForaDoMapa()
        {
            _palco.Montar(_mapa);
            _palco.Realcar(new[] { new Vector2Int(-1, 0), new Vector2Int(99, 99) }, Palco.CorAlcance);

            Assert.AreEqual(0, _palco.Realcadas.Count,
                            "placa boiando fora do tabuleiro mente sobre onde a sala acaba");
        }

        [Test]
        public void Realcar_PousaNoTopoDoObstaculoENaoDentroDele()
        {
            _palco.Montar(_mapa);

            var chao = new Vector2Int(1, 1);
            var alto = new Vector2Int(3, 2);
            _palco.Realcar(new[] { chao, alto }, Palco.CorAlcance);

            var placas = PlacasAcesas();
            Assert.AreEqual(2, placas.Count);

            float yChao = placas[0].transform.position.y;
            float yAlto = placas[1].transform.position.y;
            Assert.Greater(yAlto, yChao + _palco.TopoDe(alto) * 0.9f,
                           "realce sobre obstáculo ficou enterrado dentro do bloco: a área do " +
                           "feitiço sumiria justamente onde ela decide a jogada");
        }

        [Test]
        public void LimparRealce_NaoDestroiAsPlacas_SoApaga()
        {
            _palco.Montar(_mapa);
            _palco.Realcar(new[] { new Vector2Int(1, 1) }, Palco.CorAlcance);
            int criadas = TodasAsPlacas().Count;

            _palco.LimparRealce();
            _palco.Realcar(new[] { new Vector2Int(2, 1) }, Palco.CorAlcance);

            Assert.AreEqual(criadas, TodasAsPlacas().Count,
                            "acender e apagar alcance criaria centenas de objetos por partida " +
                            "se as placas não fossem reaproveitadas");
        }

        // ================================================================ APOIO

        List<Vector3> TodasAsPosicoes()
        {
            var saida = new List<Vector3>();
            for (int y = 0; y < _mapa.Altura; y++)
                for (int x = 0; x < _mapa.Largura; x++)
                    saida.Add(_palco.Mundo(new Vector2Int(x, y)));
            return saida;
        }

        // As placas moram num grupo com nome fixo; o teste procura por lá em vez
        // de o Palco abrir mais API só para ser testado.
        List<GameObject> TodasAsPlacas()
        {
            var saida = new List<GameObject>();
            var grupo = _go.transform.Find("Tabuleiro/Realces");
            if (grupo == null) return saida;
            for (int i = 0; i < grupo.childCount; i++) saida.Add(grupo.GetChild(i).gameObject);
            return saida;
        }

        List<GameObject> PlacasAcesas()
        {
            var saida = new List<GameObject>();
            foreach (var placa in TodasAsPlacas())
                if (placa.activeSelf) saida.Add(placa);
            return saida;
        }

        static Color CorDe(GameObject go)
        {
            // A cor mora no MaterialPropertyBlock, não no material — ler o
            // material devolveria a cor de todo mundo igual.
            var bloco = new MaterialPropertyBlock();
            go.GetComponent<Renderer>().GetPropertyBlock(bloco);
            return bloco.GetColor("_BaseColor");
        }

        static float Luz(Color c)
        {
            return 0.2126f * c.r + 0.7152f * c.g + 0.0722f * c.b;
        }
    }
}
