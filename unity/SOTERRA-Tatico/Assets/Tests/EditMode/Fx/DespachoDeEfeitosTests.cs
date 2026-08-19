using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.Fx
{
    // Ver a nota de armadilha de nome em FamiliasDeEfeitoTests.cs.
    using Fx = global::Soterra.Fx;
    using Motor = global::Soterra.Motor;
    using Cena = global::Soterra.Cena;
    using Jogo = global::Soterra.Jogo;
    using Acervo = global::Soterra.Testes.Jogo.AcervoDoJogo;

    /// <summary>
    /// A LIGAÇÃO: os eventos que o motor devolve viram efeito no tabuleiro.
    ///
    /// É o teste que prova o que dá nome à rodada. Sem ele, tudo o que se sabe é
    /// que existem 21 moldes bonitos — e um molde que ninguém dispara é o mesmo
    /// silêncio de antes, só que mais caro.
    ///
    /// Tudo FORA de Play, com o tempo avançado na mão: é assim que o modo lote
    /// fotografa o meio de um efeito.
    /// </summary>
    public class DespachoDeEfeitosTests
    {
        GameObject _go;
        Cena.Palco _palco;
        Motor.Batalha _batalha;
        Jogo.DespachoDeEfeitos _despacho;

        [SetUp]
        public void Antes()
        {
            var banco = Acervo.Banco();
            _batalha = Acervo.NovaBatalha();

            _go = new GameObject("palco-de-teste");
            _palco = _go.AddComponent<Cena.Palco>();
            _palco.Montar(_batalha.Mapa);

            _despacho = new Jogo.DespachoDeEfeitos(_palco, _batalha, banco);
        }

        [TearDown]
        public void Depois()
        {
            if (_go != null) Object.DestroyImmediate(_go);
        }

        /// <summary>Um feitiço que a unidade da vez consegue lançar agora, com
        /// uma casa válida. Devolve nulo se não houver nenhum.</summary>
        bool AcharConjuracao(out string feiticoId, out Vector2Int alvo)
        {
            feiticoId = null;
            alvo = default;
            var u = _batalha.Atual;
            if (u == null) return false;

            for (int i = 0; i < u.Feiticos.Count; i++)
            {
                var id = u.Feiticos[i];
                var alvos = _batalha.AlvosDe(id);
                for (int a = 0; a < alvos.Count; a++)
                    if (_batalha.PodeConjurar(id, alvos[a]))
                    {
                        feiticoId = id;
                        alvo = alvos[a];
                        return true;
                    }
            }
            return false;
        }

        [Test]
        public void ConjurarNaSalaReal_AcendeUmEfeitoNoTabuleiro()
        {
            Acervo.AteVezDoHeroi(_batalha);

            string id;
            Vector2Int alvo;
            if (!AcharConjuracao(out id, out alvo))
                Assert.Inconclusive("nenhum feitiço do herói tinha alvo válido na abertura");

            Assert.AreEqual(0, _despacho.Efeitos.SistemasOcupados(),
                            "havia efeito no ar antes de alguém conjurar");

            var r = _batalha.Conjurar(id, alvo);
            Assert.IsTrue(r.Valido, "o motor recusou a conjuração: " + r.Recusa);
            Assert.IsTrue(r.Tem(Motor.TipoDeEvento.Conjuracao),
                          "o motor conjurou sem emitir o evento de Conjuração — sem ele o efeito " +
                          "nunca saberia qual feitiço saiu");

            _despacho.Reagir(r);

            Assert.Greater(_despacho.Efeitos.SistemasOcupados(), 0,
                           "o feitiço '" + id + "' saiu e o tabuleiro não mostrou NADA. É o " +
                           "defeito que esta rodada existe para matar: acertar em silêncio");
        }

        [Test]
        public void OFeiticoDecideAFamilia_EAFamiliaDecideODesenho()
        {
            Acervo.AteVezDoHeroi(_batalha);

            string id;
            Vector2Int alvo;
            if (!AcharConjuracao(out id, out alvo))
                Assert.Inconclusive("nenhum feitiço do herói tinha alvo válido na abertura");

            var feitico = _batalha.Feitico(id);
            var esperada = Fx.FamiliaDeEfeito.DeChave(feitico.ChaveDeEfeito);

            var r = _batalha.Conjurar(id, alvo);
            _despacho.Reagir(r);

            // O sistema aceso tem de ser o DA FAMÍLIA do feitiço. Antes desta
            // rodada todos apontavam para o mesmo desenho, e "acendeu alguma
            // coisa" teria passado.
            var acesas = new List<string>();
            var sistemas = _palco.Tabuleiro.GetComponentsInChildren<ParticleSystem>(true);
            for (int i = 0; i < sistemas.Length; i++)
                if (sistemas[i].transform.parent != null &&
                    sistemas[i].transform.parent.gameObject.activeSelf)
                    acesas.Add(sistemas[i].transform.parent.name);

            Assert.Contains("fx-" + esperada, acesas,
                            "o feitiço '" + id + "' declara fxKey '" + feitico.ChaveDeEfeito +
                            "' (família " + esperada + ") e o que acendeu foi: " +
                            string.Join(", ", acesas));
        }

        [Test]
        public void OEfeitoNasceNaCasaCERTA_ENaoNoCentroDoTabuleiro()
        {
            Acervo.AteVezDoHeroi(_batalha);

            string id;
            Vector2Int alvo;
            if (!AcharConjuracao(out id, out alvo))
                Assert.Inconclusive("nenhum feitiço do herói tinha alvo válido na abertura");

            var conjurador = _batalha.Atual.Casa;
            var r = _batalha.Conjurar(id, alvo);
            _despacho.Reagir(r);

            var esperado = _palco.Mundo(alvo, _palco.TopoDe(alvo));
            var origem = _palco.Mundo(conjurador, _palco.TopoDe(conjurador));

            // A âncora de cada família é sua, mas TODAS têm de cair perto de uma
            // das duas casas: o jogador precisa saber ONDE caiu. Um efeito no
            // centro do tabuleiro é pior que efeito nenhum — mente sobre o alvo.
            float maior = Mathf.Max(Vector3.Distance(esperado, origem), 1f);
            bool perto = false;
            var sistemas = _palco.Tabuleiro.GetComponentsInChildren<ParticleSystem>(true);
            for (int i = 0; i < sistemas.Length; i++)
            {
                if (sistemas[i].transform.parent == null ||
                    !sistemas[i].transform.parent.gameObject.activeSelf) continue;
                var p = sistemas[i].transform.position;
                var chao = new Vector3(p.x, 0f, p.z);
                if (Vector3.Distance(chao, new Vector3(esperado.x, 0f, esperado.z)) < maior + 4f ||
                    Vector3.Distance(chao, new Vector3(origem.x, 0f, origem.z)) < maior + 4f)
                    perto = true;
            }
            Assert.IsTrue(perto,
                          "nenhuma camada do efeito nasceu perto da casa do conjurador " +
                          conjurador + " nem da casa alvo " + alvo);
        }

        [Test]
        public void ACuraSaiVerde_EOFogoSaiLaranja()
        {
            // A cor é a segunda metade da informação: SISTEMAS §4 diz que ela vem
            // do elemento. Um efeito que não diz DE QUE elemento é vale metade.
            var banco = Acervo.Banco();
            var fogo = Fx.PaletaDeEfeito.DeElemento(banco, Soterra.Dados.Elemento.Fogo);
            var agua = Fx.PaletaDeEfeito.DeElemento(banco, Soterra.Dados.Elemento.Agua);

            Assert.AreNotEqual(fogo, agua, "fogo e água saem da mesma cor");
            Assert.Greater(fogo.r, fogo.b, "o fogo do acervo (#ff8c3a) não é mais vermelho que azul");
            Assert.Greater(agua.b, agua.r, "a água do acervo (#57c8ec) não é mais azul que vermelha");

            // Verde é o sinal de "ganhei vida" e não muda com o elemento: uma
            // cura de fogo laranja seria lida como dano.
            Assert.Greater(Fx.PaletaDeEfeito.Cura.g, Fx.PaletaDeEfeito.Cura.r);
        }

        [Test]
        public void AFusaoSaiNaCorDaMISTURA_ENaoNaDoElementoA()
        {
            var banco = Acervo.Banco();
            var compostos = Soterra.Dados.Fusao.Compor(banco, "arqueiro+bruxo", "fogo+agua", 30);
            if (compostos.Count == 0)
                Assert.Inconclusive("o acervo não compôs a dupla arqueiro+bruxo");

            var daMistura = Fx.PaletaDeEfeito.De(banco, compostos[0]);
            var doElemento = Fx.PaletaDeEfeito.DeElemento(banco, compostos[0].Elemento);

            // A mistura fogo+agua traz #c96b4a; o elemento A (fogo) traz #ff8c3a.
            // Ler o elemento em vez da mistura apagaria metade da identidade que
            // o jogador pagou 2 PA para ver.
            Assert.AreNotEqual(doElemento, daMistura,
                               "o composto saiu na cor do elemento A e não na da mistura");
        }

        [Test]
        public void ATrocaDeSala_ApagaOQueEstavaNoAr()
        {
            _despacho.Efeitos.Disparar(Fx.FamiliaDeEfeito.Armadilha,
                                       Vector3.zero, Vector3.zero, Color.white);
            Assert.Greater(_despacho.Efeitos.SistemasOcupados(), 0);

            _despacho.Limpar();
            Assert.AreEqual(0, _despacho.Efeitos.SistemasOcupados(),
                            "a armadilha continuou plantada depois de limpar — ela dura 1,8 s e " +
                            "reapareceria por cima da sala seguinte");
        }
    }
}
