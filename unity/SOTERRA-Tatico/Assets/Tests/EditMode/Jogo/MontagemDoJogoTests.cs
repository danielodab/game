using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.Jogo
{
    // Ver a nota de armadilha de nome em AcervoDoJogo.cs.
    using Motor = global::Soterra.Motor;
    using Jogo = global::Soterra.Jogo;
    using Progressao = global::Soterra.Progressao;

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

            // Armazém de MEMÓRIA: o jogo agora carrega e grava progresso ao
            // montar, e o padrão é o PlayerPrefs. Sem esta linha o lote sujaria
            // o registro da máquina e passaria o save de uma execução para a
            // seguinte — dois testes que se contaminam não provam nada.
            _jogo.Armazem = new Progressao.ArmazemDeMemoria();
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
            Assert.IsNotNull(_jogo.Fluxo, "sem HUD de fluxo não há tela de recompensa entre salas");
            Assert.IsNotNull(_jogo.Fluxo.Tela, "o HUD de fluxo subiu sem tela montada");
            Assert.AreEqual(global::Soterra.Interface.TipoDeFluxo.Nenhum, _jogo.Fluxo.Tela.Tipo,
                            "com a batalha em pé a tela de fluxo tem de estar escondida — " +
                            "ela cobre o tabuleiro inteiro");

            Assert.IsNotNull(_jogo.Expedicao, "sem expedição não há calabouço, só uma sala");
            Assert.IsNotNull(_jogo.Progresso, "o jogo montou sem progresso: os heróis nasceriam crus");

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
            Assert.AreEqual(1, _go.GetComponentsInChildren<global::Soterra.Interface.HudDeFluxo>(true).Length);
        }

        /// <summary>
        /// O grupo nasce da PROGRESSÃO, não da classe crua.
        ///
        /// É a diferença desta rodada: até aqui o Montador recebia id de classe
        /// e fazia nascer herói de nível 1 sem item nenhum, sempre. Agora a
        /// unidade em campo tem o nível da ficha e os feitiços que a progressão
        /// liberou — na primeira sala, com a progressão zerada, isso dá
        /// exatamente a ficha crua, e é por isso que o teste compara com ela em
        /// vez de cravar números.
        /// </summary>
        [Test]
        public void OsHeroisNascemPelaProgressao()
        {
            var progresso = _jogo.Progresso;
            var grupo = _jogo.Expedicao.Grupo;
            Assert.AreEqual(2, grupo.Count, "o grupo do jogo é uma dupla");

            var herois = new System.Collections.Generic.List<Motor.Unidade>();
            var unidades = _jogo.Partida.Batalha.Unidades;
            for (int i = 0; i < unidades.Count; i++)
                if (unidades[i].Lado == Motor.Lado.Heroi) herois.Add(unidades[i]);

            Assert.AreEqual(grupo.Count, herois.Count,
                            "o tabuleiro tem de ter um corpo por herói do grupo");

            for (int i = 0; i < grupo.Count; i++)
            {
                var ficha = progresso.FichaDeCombate(grupo[i]);
                Assert.IsNotNull(ficha, grupo[i] + " não tem ficha de combate — a classe está " +
                                        "trancada e não deveria estar no grupo padrão");
                Assert.AreEqual(ficha.Pv, herois[i].PVMax,
                    grupo[i] + " nasceu com o PV da CLASSE e não o da ficha da progressão");
                Assert.AreEqual(ficha.Nivel, herois[i].Nivel);
                Assert.AreEqual(progresso.FeiticosDe(grupo[i]).Count, herois[i].Feiticos.Count,
                    grupo[i] + " nasceu com a lista de feitiços da classe em vez da liberada " +
                    "pelo nível");
            }
        }
    }
}
