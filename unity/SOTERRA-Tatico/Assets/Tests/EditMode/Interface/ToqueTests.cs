using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using UnityEngine.UIElements;
using Soterra.Interface;

namespace Soterra.Testes.Interface
{
    /// <summary>
    /// O teste que mais se perde de vista: nenhum alvo de dedo abaixo de 44
    /// pontos.
    ///
    /// Ele existe porque o defeito é invisível na tela do computador. No mouse
    /// um botão de 20 px é confortável; no polegar ele é uma aposta, e quem erra
    /// não culpa o próprio dedo, culpa o jogo. Só um teste pega isso — revisão
    /// visual, não.
    ///
    /// A medida sai da folha de estilo REAL, lida do disco, porque no lote
    /// (<c>-batchmode -nographics</c>) não existe painel e portanto não existe
    /// <c>resolvedStyle</c>: medir o elemento devolveria zero em tudo e o teste
    /// ficaria verde afirmando o contrário do que mede.
    /// </summary>
    public class ToqueTests
    {
        TelaDeBatalha _tela;
        List<RegraDeUss> _regras;

        [SetUp]
        public void Antes()
        {
            var banco = Cenario.BancoOuInconclusivo();
            _tela = Cenario.Tela();
            _tela.Montar(Cenario.QuadroReal(banco));

            Assert.IsTrue(File.Exists(Cenario.CaminhoDoEstilo),
                          "não achei a folha de estilo em " + Cenario.CaminhoDoEstilo);
            _regras = LeitorDeUss.Ler(File.ReadAllText(Cenario.CaminhoDoEstilo));
            Assert.IsNotEmpty(_regras, "a folha de estilo foi lida vazia");
        }

        static IEnumerable<VisualElement> Todos(VisualElement raiz)
        {
            return Cenario.Todos(raiz);
        }

        List<VisualElement> Alvos()
        {
            var saida = new List<VisualElement>();
            foreach (var e in Todos(_tela.Raiz))
                if (Toque.EhAlvo(e)) saida.Add(e);
            return saida;
        }

        static string Descreve(VisualElement e)
        {
            return Cenario.Descreve(e);
        }

        [Test]
        public void NenhumAlvoDeToqueFicaAbaixoDe44Pontos()
        {
            var alvos = Alvos();
            Assert.Greater(alvos.Count, 3,
                "a tela montada tem de ter pelo menos os feitiços, as fichas de iniciativa " +
                "e o botão de encerrar turno marcados como alvo de dedo");

            float menor = float.MaxValue;
            string menorQuem = null;

            foreach (var alvo in alvos)
            {
                var classes = new List<string>(alvo.GetClasses());
                float? minLargura = null, minAltura = null;
                float larguraFixa = 0f, alturaFixa = 0f;

                foreach (var regra in _regras)
                {
                    if (!Casa(regra, alvo, classes)) continue;

                    float v;
                    if (regra.Declaracoes.ContainsKey("min-width") &&
                        LeitorDeUss.TentaPixels(regra.Declaracoes["min-width"], out v)) minLargura = v;
                    if (regra.Declaracoes.ContainsKey("min-height") &&
                        LeitorDeUss.TentaPixels(regra.Declaracoes["min-height"], out v)) minAltura = v;
                    if (regra.Declaracoes.ContainsKey("width") &&
                        LeitorDeUss.TentaPixels(regra.Declaracoes["width"], out v)) larguraFixa = v;
                    if (regra.Declaracoes.ContainsKey("height") &&
                        LeitorDeUss.TentaPixels(regra.Declaracoes["height"], out v)) alturaFixa = v;

                    // Um teto abaixo do piso desfaz a garantia sem tocar no piso —
                    // é o jeito silencioso de encolher um alvo.
                    ConfereTeto(regra, "max-width", alvo);
                    ConfereTeto(regra, "max-height", alvo);
                }

                Assert.IsTrue(minLargura.HasValue,
                    Descreve(alvo) + " é alvo de dedo e nenhuma regra do USS lhe dá 'min-width'");
                Assert.IsTrue(minAltura.HasValue,
                    Descreve(alvo) + " é alvo de dedo e nenhuma regra do USS lhe dá 'min-height'");

                // O que o aparelho garante é o MAIOR entre o piso e a medida fixa.
                var largura = UnityEngine.Mathf.Max(minLargura.Value, larguraFixa);
                var altura = UnityEngine.Mathf.Max(minAltura.Value, alturaFixa);

                Assert.GreaterOrEqual(largura, Toque.MinimoEmPontos,
                    Descreve(alvo) + " tem " + largura + " pontos de largura");
                Assert.GreaterOrEqual(altura, Toque.MinimoEmPontos,
                    Descreve(alvo) + " tem " + altura + " pontos de altura");

                var lado = UnityEngine.Mathf.Min(largura, altura);
                if (lado < menor) { menor = lado; menorQuem = Descreve(alvo); }
            }

            UnityEngine.Debug.Log("menor alvo de toque da tela: " + menor + " pontos (" + menorQuem +
                                  "), em " + alvos.Count + " alvos");
        }

        void ConfereTeto(RegraDeUss regra, string propriedade, VisualElement alvo)
        {
            if (!regra.Declaracoes.ContainsKey(propriedade)) return;
            float v;
            if (!LeitorDeUss.TentaPixels(regra.Declaracoes[propriedade], out v)) return;
            Assert.GreaterOrEqual(v, Toque.MinimoEmPontos,
                Descreve(alvo) + ": a regra '" + string.Join(", ", regra.Seletores.ToArray()) +
                "' põe " + propriedade + ": " + v + "px, abaixo do piso de dedo");
        }

        bool Casa(RegraDeUss regra, VisualElement alvo, List<string> classes)
        {
            for (int i = 0; i < regra.Seletores.Count; i++)
                if (LeitorDeUss.Aplica(regra.Seletores[i], alvo.name, classes, alvo.GetType()))
                    return true;
            return false;
        }

        /// <summary>
        /// Tudo o que responde a toque nesta tela é <c>Button</c>, e todo
        /// <c>Button</c> carrega a classe <c>alvo</c>.
        ///
        /// É a metade que falta da garantia: o teste de cima mede quem está
        /// marcado, este cobra que ninguém escape da marcação. Elemento clicável
        /// registrado à mão com <c>RegisterCallback&lt;ClickEvent&gt;</c> passaria
        /// invisível pelos dois, e por isso a interface não usa esse caminho.
        /// </summary>
        [Test]
        public void TodoBotaoDaTelaEAlvoDeToque()
        {
            int botoes = 0;
            foreach (var e in Todos(_tela.Raiz))
            {
                if (!(e is Button)) continue;
                botoes++;
                Assert.IsTrue(Toque.EhAlvo(e),
                    Descreve(e) + " é um Button e não tem a classe '" + Toque.ClasseDeAlvo +
                    "' — ele vai para o aparelho do tamanho que o texto pedir");
            }
            Assert.Greater(botoes, 0, "a tela montada não tem botão nenhum");
        }

        /// <summary>
        /// Estilo em linha vence qualquer regra do USS. Se o C# encolher um alvo
        /// direto no <c>style</c>, a folha de estilo continua declarando 44 e
        /// mentindo — este teste é o que impede.
        /// </summary>
        [Test]
        public void NenhumEstiloEmLinhaEncolheUmAlvoAbaixoDe44()
        {
            foreach (var alvo in Alvos())
            {
                ConfereEmLinha(alvo, alvo.style.width, "width");
                ConfereEmLinha(alvo, alvo.style.height, "height");
                ConfereEmLinha(alvo, alvo.style.minWidth, "min-width");
                ConfereEmLinha(alvo, alvo.style.minHeight, "min-height");
                ConfereEmLinha(alvo, alvo.style.maxWidth, "max-width");
                ConfereEmLinha(alvo, alvo.style.maxHeight, "max-height");
            }
        }

        static void ConfereEmLinha(VisualElement alvo, StyleLength valor, string propriedade)
        {
            // `Null` é "não foi mexido em linha"; só o valor explícito interessa.
            if (valor.keyword != StyleKeyword.Undefined) return;
            if (valor.value.unit != LengthUnit.Pixel) return;
            Assert.GreaterOrEqual(valor.value.value, Toque.MinimoEmPontos,
                Descreve(alvo) + ": estilo em linha põe " + propriedade + " em " +
                valor.value.value + " pontos");
        }

        /// <summary>
        /// Nenhum <c>:hover</c> na folha de estilo.
        ///
        /// No toque não existe "passar por cima": o dedo toca ou não toca. Estado
        /// que só nasce no <c>hover</c> é estado que no celular nunca acontece —
        /// e informação pendurada nele é informação que o jogador nunca vê.
        /// </summary>
        [Test]
        public void AInterfaceNaoDependeDeHover()
        {
            // Cobrado nos SELETORES já lidos, e não no texto cru do arquivo: os
            // comentários deste projeto explicam por que o hover está proibido, e
            // um teste que procura a palavra no texto quebraria por causa da
            // própria explicação.
            foreach (var regra in _regras)
            {
                for (int i = 0; i < regra.Seletores.Count; i++)
                {
                    Assert.IsFalse(regra.Seletores[i].Contains(":hover"),
                        "a regra '" + regra.Seletores[i] + "' depende de ':hover', " +
                        "que no celular nunca dispara");
                }
            }
        }
    }
}
