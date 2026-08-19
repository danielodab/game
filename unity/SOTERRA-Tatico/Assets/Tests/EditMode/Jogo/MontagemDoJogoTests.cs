using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.Jogo
{
    // Ver a nota de armadilha de nome em AcervoDoJogo.cs.
    using Motor = global::Soterra.Motor;
    using Jogo = global::Soterra.Jogo;

    /// <summary>
    /// A montagem que o <c>LoteJogo.MontarCenaDeBatalha</c> grava e que o Play
    /// remonta — provada FORA de Play, porque é fora de Play que o lote a
    /// executa. O LoteJogo em si mora no assembly de Editor, que os testes não
    /// alcançam; por isso ele é fino de propósito e TUDO que ele faz de
    /// verdade está em <c>JogoDeBatalha.Montar()</c>, que se prova aqui.
    /// </summary>
    public class MontagemDoJogoTests
    {
        GameObject _go;
        Jogo.JogoDeBatalha _jogo;

        [SetUp]
        public void Antes()
        {
            AcervoDoJogo.Banco();   // inconclusivo, e não vermelho, sem o acervo

            _go = new GameObject("jogo-de-teste");
            _jogo = _go.AddComponent<Jogo.JogoDeBatalha>();
            _jogo.Montar();
        }

        [TearDown]
        public void Depois()
        {
            if (_go != null) Object.DestroyImmediate(_go);
        }

        [Test]
        public void Montar_ForaDePlay_LigaTodasAsPecas()
        {
            Assert.IsFalse(Application.isPlaying,
                           "este teste só vale fora de Play — é o modo do lote");

            Assert.IsNotNull(_jogo.Partida, "sem regente não há jogo");
            Assert.IsNotNull(_jogo.Palco, "sem palco não há tabuleiro");
            Assert.IsNotNull(_jogo.Palco.Mapa, "o palco montou sem sala");
            Assert.IsNotNull(_jogo.Camera, "sem câmera não há foto nem toque — o raio do dedo " +
                                           "nasce nela");
            Assert.IsNotNull(_jogo.Hud, "sem HUD não há barra de feitiços nem botão de encerrar");
            Assert.IsNotNull(_jogo.Hud.Tela, "o HUD subiu sem tela montada");

            Assert.AreSame(_jogo.Partida.Batalha.Mapa, _jogo.Palco.Mapa,
                           "o palco desenhou UM mapa e o motor joga em OUTRO — o toque cairia " +
                           "em casas que não existem");
        }

        [Test]
        public void OElencoNasceCompleto_UmCorpoPorUnidadeViva()
        {
            int vivos = 0;
            var unidades = _jogo.Partida.Batalha.Unidades;
            for (int i = 0; i < unidades.Count; i++)
                if (unidades[i].NoTabuleiro) vivos++;

            Assert.Greater(vivos, 2, "a sala montou sem monstros — o acervo mudou?");
            Assert.AreEqual(vivos, _jogo.Elenco.NoTabuleiro.Count,
                            "unidade do motor sem corpo em cena: o jogador planejaria em cima " +
                            "de casas 'vazias' que devolvem golpe");

            for (int i = 0; i < unidades.Count; i++)
                if (unidades[i].NoTabuleiro)
                    Assert.IsNotNull(_jogo.Elenco.ObjetoDe(unidades[i].Uid),
                                     unidades[i].Uid + " está na batalha e não na cena");
        }

        [Test]
        public void ORealceDizDeQuemEAVez()
        {
            // O realce nasce junto com a cena: no turno do herói o alcance de
            // passo tem de estar aceso ANTES do primeiro toque — é ele que diz
            // "você joga agora". No turno do monstro, tabuleiro limpo.
            if (_jogo.Partida.TurnoDoJogador)
                Assert.Greater(_jogo.Palco.Realcadas.Count, 0,
                               "turno do herói sem alcance aceso: o jogador não sabe que é a vez dele");
            else
                Assert.AreEqual(0, _jogo.Palco.Realcadas.Count,
                                "realce aceso no turno do monstro mente sobre de quem é a vez");
        }

        [Test]
        public void MontarDeNovo_NaoDuplicaNada()
        {
            // O Start chama Montar sobre a cena já salva pelo LoteJogo. Se a
            // segunda chamada criasse outro palco ou outro HUD, o Play abriria
            // com duas câmeras brigando pela mesma imagem.
            _jogo.Montar();

            Assert.AreEqual(1, _go.GetComponentsInChildren<global::Soterra.Cena.Palco>(true).Length);
            Assert.AreEqual(1, _go.GetComponentsInChildren<global::Soterra.Interface.HudDeBatalha>(true).Length);
        }
    }
}
