using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.UIElements;
using Soterra.Dados;
using Soterra.Interface;

namespace Soterra.Testes.Interface
{
    /// <summary>
    /// A tela de batalha montada de verdade: o UXML carrega, os elementos estão
    /// lá pelos nomes, e a barra desenha o que o acervo manda.
    ///
    /// Tudo EditMode, sem cena e sem painel — é o que o modo lote consegue rodar.
    /// O preço é que o clique não pode ser simulado (sem painel o UI Toolkit não
    /// despacha evento nenhum), e por isso os testes de toque chamam os mesmos
    /// métodos públicos que os botões chamam. A ligação botão→método é uma linha
    /// só em <c>TelaDeBatalha</c>, visível em diff.
    /// </summary>
    public class TelaDeBatalhaTests
    {
        BancoDeDados _banco;
        TelaDeBatalha _tela;
        QuadroDaBatalha _quadro;

        [SetUp]
        public void Antes()
        {
            _banco = Cenario.BancoOuInconclusivo();
            _tela = Cenario.Tela();
            _quadro = Cenario.QuadroReal(_banco);
            _tela.Montar(_quadro);
        }

        // ================================================================= layout

        [Test]
        public void OLayoutEAFolhaDeEstiloExistemComoTexto()
        {
            Assert.IsTrue(File.Exists(Cenario.CaminhoDoLayout),
                "o layout tem de ser um arquivo de texto versionado: " + Cenario.CaminhoDoLayout);
            Assert.IsTrue(File.Exists(Cenario.CaminhoDoEstilo),
                "a folha de estilo tem de ser um arquivo de texto versionado: " + Cenario.CaminhoDoEstilo);
        }

        [Test]
        public void OLayoutCarregaDeResourcesSemReferenciaArrastada()
        {
            Assert.IsNotNull(Resources.Load<VisualTreeAsset>(TelaDeBatalha.RecursoDoLayout),
                "sem isto a tela só sobe com o arquivo arrastado no Inspector, " +
                "e aí ela não existe fora do Editor");
            Assert.IsNotNull(Resources.Load<StyleSheet>(TelaDeBatalha.RecursoDoEstilo));
        }

        /// <summary>
        /// Cada nome que o C# procura tem de existir no UXML. É a costura que
        /// se rompe calada: renomear um elemento no layout não quebra
        /// compilação nenhuma — só apaga metade da tela em jogo.
        /// </summary>
        [Test]
        public void TodosOsElementosDaTelaExistemPorNome()
        {
            string[] nomes =
            {
                "hud-batalha", "faixa-superior", "cabecalho", "rotulo-rodada", "rotulo-clima",
                "ordem-de-iniciativa", "ficha", "ficha-titulo", "ficha-numeros", "ficha-texto",
                "vao-do-tabuleiro", "faixa-inferior", "painel-de-recursos", "rotulo-nome",
                "medidor-pv", "medidor-pv-cheio", "rotulo-pv", "linha-de-pontos",
                "rotulo-pa", "pips-pa", "rotulo-pp", "pips-pp",
                "barra-de-feiticos", "acoes", "botao-encerrar-turno"
            };

            for (int i = 0; i < nomes.Length; i++)
                Assert.IsNotNull(_tela.Raiz.Q<VisualElement>(nomes[i]),
                    "o layout não tem elemento chamado '" + nomes[i] + "'");
        }

        /// <summary>
        /// A interface cobre a tela inteira e NÃO pode capturar o toque: o
        /// tabuleiro está atrás dela. Foi o defeito "a interface engolia todo
        /// clique e arrasto do tabuleiro" da linha JS, e ele não custa nada para
        /// voltar.
        /// </summary>
        [Test]
        public void ATelaNaoEngoleOToqueDoTabuleiro()
        {
            Assert.AreEqual(PickingMode.Ignore, _tela.Raiz.pickingMode,
                "a raiz cobre a tela inteira");
            Assert.AreEqual(PickingMode.Ignore, _tela.Raiz.Q<VisualElement>("hud-batalha").pickingMode);
            Assert.AreEqual(PickingMode.Ignore, _tela.Raiz.Q<VisualElement>("vao-do-tabuleiro").pickingMode,
                "o vão do meio é justamente por onde o tabuleiro aparece");
        }

        // ============================================================== recursos

        [Test]
        public void MontarEscreveARodadaEOClimaDaSala()
        {
            Assert.AreEqual("Rodada " + _quadro.Rodada,
                            _tela.Raiz.Q<Label>("rotulo-rodada").text);
            Assert.AreEqual(_quadro.Clima, _tela.Raiz.Q<Label>("rotulo-clima").text);
        }

        [Test]
        public void MontarEscrevePvPaEPpDeQuemJoga()
        {
            var u = _quadro.Atual;
            Assert.AreEqual(u.Nome, _tela.Raiz.Q<Label>("rotulo-nome").text);
            Assert.AreEqual(u.Pv + " / " + u.PvMax + " PV", _tela.Raiz.Q<Label>("rotulo-pv").text);
            Assert.AreEqual("PA " + u.Pa + "/" + u.PaMax, _tela.Raiz.Q<Label>("rotulo-pa").text);
            Assert.AreEqual("PP " + u.Pp + "/" + u.PpMax, _tela.Raiz.Q<Label>("rotulo-pp").text);

            Assert.AreEqual(u.PaMax, _tela.Raiz.Q<VisualElement>("pips-pa").childCount,
                "uma bolinha por ponto de ação máximo");
            Assert.AreEqual(u.PpMax, _tela.Raiz.Q<VisualElement>("pips-pp").childCount);
        }

        [Test]
        public void OMedidorDeVidaEncolheJuntoComOsPontosDeVida()
        {
            var cheio = _tela.Raiz.Q<VisualElement>("medidor-pv-cheio");
            Assert.AreEqual(100f, cheio.style.width.value.value, 0.01f, "vida cheia = 100%");

            var meio = Cenario.QuadroReal(_banco);
            meio.Atual.Pv = meio.Atual.PvMax / 2;
            _tela.Montar(meio);
            Assert.AreEqual(50f, cheio.style.width.value.value, 1f, "meia vida = metade da barra");
        }

        // =============================================================== feitiços

        [Test]
        public void ABarraMontaUmBotaoPorFeiticoDaClasse()
        {
            var barra = _tela.Raiz.Q<VisualElement>("barra-de-feiticos");
            var botoes = Cenario.Botoes(barra);

            Assert.Greater(_quadro.Feiticos.Count, 0, "o quadro de teste veio sem feitiço");
            Assert.AreEqual(_quadro.Feiticos.Count, botoes.Count);

            for (int i = 0; i < _quadro.Feiticos.Count; i++)
                Assert.AreEqual("feitico-" + _quadro.Feiticos[i].Id, botoes[i].name,
                    "a barra tem de sair na ordem do acervo");
        }

        /// <summary>
        /// Custo em PA e recarga na cara do botão. Sem isso o jogador só descobre
        /// o preço tocando — e no celular tocar já é escolher.
        /// </summary>
        [Test]
        public void CadaBotaoMostraOCustoEARecargaQueEstaoNoAcervo()
        {
            int comRecarga = 0;
            for (int i = 0; i < _quadro.Feiticos.Count; i++)
            {
                var f = _quadro.Feiticos[i];
                var botao = _tela.Raiz.Q<Button>("feitico-" + f.Id);
                Assert.IsNotNull(botao, "não achei o botão de " + f.Id);

                var custo = Cenario.ComClasse(botao, "feitico__custo") as Label;
                Assert.IsNotNull(custo, f.Id + ": botão sem o custo em PA");
                Assert.AreEqual(f.CustoDePa.ToString(), custo.text);

                var recarga = Cenario.ComClasse(botao, "feitico__recarga") as Label;
                if (f.Recarga > 0)
                {
                    Assert.IsNotNull(recarga, f.Id + ": tem recarga no acervo e não mostra");
                    Assert.AreEqual(f.Recarga.ToString(), recarga.text);
                    comRecarga++;
                }
                else
                {
                    Assert.IsNull(recarga, f.Id + ": não tem recarga e mostra uma");
                }
            }
            Assert.Greater(comRecarga, 0,
                "nenhum feitiço da barra tem recarga — ou o acervo mudou, ou o teste não prova nada");
        }

        [Test]
        public void TocarNumFeiticoEscolheELeOQueEleFazNaFichaDoTopo()
        {
            var f = _quadro.Feiticos[0];
            string escolhido = null;
            _tela.AoEscolherFeitico += id => escolhido = id;

            _tela.TocarFeitico(f.Id);

            Assert.AreEqual(f.Id, escolhido, "o toque tem de avisar quem manda no jogo");
            Assert.AreEqual(f.Nome, _tela.Raiz.Q<Label>("ficha-titulo").text);
            StringAssert.Contains(f.CustoDePa + " PA", _tela.Raiz.Q<Label>("ficha-numeros").text);
            StringAssert.Contains(f.Descricao, _tela.Raiz.Q<Label>("ficha-texto").text);
        }

        /// <summary>
        /// Feitiço caro demais continua tocável, e o toque DIZ o motivo.
        /// Botão morto e mudo é o que faz o jogador tocar de novo, e de novo.
        /// </summary>
        [Test]
        public void FeiticoSemPaNaoEEscolhidoMasExplicaOPorque()
        {
            var semPa = Cenario.QuadroReal(_banco);
            semPa.Atual.Pa = 0;
            _tela.Montar(semPa);

            var f = semPa.Feiticos[0];
            bool escolheu = false;
            _tela.AoEscolherFeitico += id => escolheu = true;

            _tela.TocarFeitico(f.Id);

            Assert.IsFalse(escolheu, "sem PA não se escolhe feitiço");
            StringAssert.Contains("PA insuficiente", _tela.Raiz.Q<Label>("ficha-texto").text);

            var botao = _tela.Raiz.Q<Button>("feitico-" + f.Id);
            Assert.IsTrue(botao.ClassListContains("feitico--indisponivel"));
        }

        [Test]
        public void FeiticoEsfriandoMostraOQueFaltaEmVezDoPreco()
        {
            var q = Cenario.QuadroReal(_banco);
            FeiticoNaTela comRecarga = null;
            for (int i = 0; i < q.Feiticos.Count; i++)
                if (q.Feiticos[i].Recarga > 0) { comRecarga = q.Feiticos[i]; break; }
            if (comRecarga == null) Assert.Inconclusive("nenhum feitiço da barra tem recarga");

            comRecarga.RecargaRestante = 2;
            _tela.Montar(q);

            var botao = _tela.Raiz.Q<Button>("feitico-" + comRecarga.Id);
            var etiqueta = Cenario.ComClasse(botao, "feitico__recarga") as Label;
            Assert.AreEqual("2", etiqueta.text);
            Assert.IsTrue(etiqueta.ClassListContains("feitico__recarga--contando"));

            bool escolheu = false;
            _tela.AoEscolherFeitico += id => escolheu = true;
            _tela.TocarFeitico(comRecarga.Id);
            Assert.IsFalse(escolheu, "feitiço esfriando não pode ser escolhido");
            StringAssert.Contains("Recarregando", _tela.Raiz.Q<Label>("ficha-texto").text);
        }

        [Test]
        public void NoTurnoDoMonstroABarraApagaEOBotaoDeEncerrarDesliga()
        {
            var q = Cenario.QuadroReal(_banco);
            q.ETurnoDoJogador = false;
            _tela.Montar(q);

            var barra = _tela.Raiz.Q<VisualElement>("barra-de-feiticos");
            Assert.AreEqual(0, Cenario.Botoes(barra).Count,
                "no turno de quem não é seu, feitiço nenhum é tocável");
            Assert.IsFalse(_tela.Raiz.Q<Button>("botao-encerrar-turno").enabledSelf);
        }

        // ============================================================= iniciativa

        [Test]
        public void AOrdemDeIniciativaComecaEmQuemJogaAgora()
        {
            var faixa = _tela.Raiz.Q<VisualElement>("ordem-de-iniciativa");
            Assert.Greater(faixa.childCount, 1, "o quadro de teste tem herói e monstros");

            var primeira = faixa[0];
            Assert.AreEqual("iniciativa-" + _quadro.Atual.Uid, primeira.name);
            Assert.IsTrue(primeira.ClassListContains("iniciativa__ficha--agora"),
                "quem joga agora tem de ser distinguível sem contar posição");

            for (int i = 1; i < faixa.childCount; i++)
                Assert.IsFalse(faixa[i].ClassListContains("iniciativa__ficha--agora"),
                    "só uma unidade joga por vez");
        }

        [Test]
        public void AFaixaDeIniciativaNaoPassaDoTetoDeUnidades()
        {
            var q = Cenario.QuadroReal(_banco);
            var modelo = q.Ordem[q.Ordem.Count - 1];

            // A sala real REPETE letra de monstro, então repetir a mesma criatura
            // aqui é o caso de verdade, não uma invenção do teste.
            for (int i = 0; i < TelaDeBatalha.MaximoNaOrdem + 5; i++)
            {
                q.Ordem.Add(new UnidadeNaTela
                {
                    Uid = modelo.Uid + "-" + i,
                    Nome = modelo.Nome,
                    Lado = modelo.Lado,
                    Pv = modelo.Pv, PvMax = modelo.PvMax,
                    Pa = modelo.Pa, PaMax = modelo.PaMax,
                    Pp = modelo.Pp, PpMax = modelo.PpMax,
                    Elemento = modelo.Elemento,
                    Viva = true
                });
            }
            _tela.Montar(q);

            Assert.AreEqual(TelaDeBatalha.MaximoNaOrdem,
                            _tela.Raiz.Q<VisualElement>("ordem-de-iniciativa").childCount);
        }

        [Test]
        public void MortoNaoOcupaLugarNaOrdemDeIniciativa()
        {
            var q = Cenario.QuadroReal(_banco);
            int vivas = q.Ordem.Count;
            q.Ordem[q.Ordem.Count - 1].Viva = false;
            _tela.Montar(q);

            Assert.AreEqual(vivas - 1,
                            _tela.Raiz.Q<VisualElement>("ordem-de-iniciativa").childCount);
        }

        /// <summary>
        /// Tocar numa ficha da iniciativa abre a criatura na ficha do topo. É o
        /// caminho que substitui o balão de <c>hover</c> do hud.js — no dedo não
        /// existe passar por cima.
        /// </summary>
        [Test]
        public void TocarNumaUnidadeDaOrdemAbreAFichaDela()
        {
            var outra = _quadro.Ordem[_quadro.Ordem.Count - 1];
            _tela.TocarUnidade(outra.Uid);

            Assert.AreEqual(outra.Nome, _tela.Raiz.Q<Label>("ficha-titulo").text);
            StringAssert.Contains(outra.Pv + " / " + outra.PvMax + " PV",
                                  _tela.Raiz.Q<Label>("ficha-numeros").text);
        }

        // ================================================================== ações

        [Test]
        public void EncerrarTurnoAvisaQuemMandaNoJogo()
        {
            int vezes = 0;
            _tela.AoEncerrarTurno += () => vezes++;

            _tela.EncerrarTurno();

            Assert.AreEqual(1, vezes);
        }

        // ============================================================ orientação

        [Test]
        public void ATelaTrocaDeArranjoEntreEmPeEDeitado()
        {
            var hud = _tela.Raiz.Q<VisualElement>("hud-batalha");

            // 9:16 em pé
            _tela.AplicarOrientacao(1080f, 1920f);
            Assert.IsFalse(_tela.EstaDeitada);
            Assert.IsTrue(hud.ClassListContains("hud--retrato"));
            Assert.IsFalse(hud.ClassListContains("hud--paisagem"));

            // 16:9 deitado
            _tela.AplicarOrientacao(1920f, 1080f);
            Assert.IsTrue(_tela.EstaDeitada);
            Assert.IsTrue(hud.ClassListContains("hud--paisagem"));
            Assert.IsFalse(hud.ClassListContains("hud--retrato"));
        }

        /// <summary>
        /// As duas orientações têm de montar a MESMA tela. O arranjo muda; o
        /// conteúdo, não — botão que só existe deitado é botão que metade dos
        /// jogadores nunca vê.
        /// </summary>
        [Test]
        public void AsDuasOrientacoesMontamOsMesmosBotoes()
        {
            _tela.AplicarOrientacao(1080f, 1920f);
            _tela.Montar(_quadro);
            var emPe = NomesDeBotao();

            _tela.AplicarOrientacao(1920f, 1080f);
            _tela.Montar(_quadro);
            var deitado = NomesDeBotao();

            CollectionAssert.AreEqual(emPe, deitado);
        }

        List<string> NomesDeBotao()
        {
            var nomes = new List<string>();
            var botoes = Cenario.Botoes(_tela.Raiz);
            for (int i = 0; i < botoes.Count; i++) nomes.Add(botoes[i].name);
            return nomes;
        }
    }
}
