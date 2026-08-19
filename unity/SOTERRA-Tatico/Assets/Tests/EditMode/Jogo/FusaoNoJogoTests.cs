using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.Jogo
{
    // Ver a nota de armadilha de nome em AcervoDoJogo.cs.
    using Motor = global::Soterra.Motor;
    using Cena = global::Soterra.Cena;
    using Jogo = global::Soterra.Jogo;
    using CenarioDoMotor = global::Soterra.Testes.Motor.Cenario;

    /// <summary>
    /// O teste de MESA da fusão: a partida inteira pelo caminho da cena — o
    /// jogador declara pela <c>Partida</c>, encerra o turno pela
    /// <c>Partida</c>, o monstro joga pelo <c>JogadaDoMonstro</c>, e no fim a
    /// fundida existe com o arsenal composto, o convidado está FORA DE CENA (o
    /// espelho <c>Fichas</c> + <c>Elenco.Sincronizar</c>, sem uma linha nova) e
    /// um composto é conjurado com sucesso.
    ///
    /// O motor já provou tudo isso em <c>FundirTests</c>; o que ESTE arquivo
    /// prova é que o caminho jogável não perde nada no meio — que era
    /// exatamente onde a linha JS perdia (a barra lia uma tabela e o motor lia
    /// cinco).
    /// </summary>
    public class FusaoNoJogoTests
    {
        /// <summary>Modelos sempre nulos, como em FichasTests: mede-se a
        /// EXISTÊNCIA e a TROCA do corpo, não o encaixe do acervo.</summary>
        sealed class SemModelos : Cena.IFonteDeModelos
        {
            public GameObject Modelo(string id) { return null; }
        }

        /// <summary>Arqueiro e bruxo colados, Vergasta a 6 casas — perto o
        /// bastante para a fundida conjurar nela, longe demais para a IA
        /// desmontar a dupla (a Vergasta bate e enraíza; não empurra).</summary>
        static Motor.Batalha BatalhaComDupla()
        {
            var mapa = CenarioDoMotor.Aberta(9, 3);
            return CenarioDoMotor.Montar(mapa, Motor.Sorte.SempreOMaximo,
                CenarioDoMotor.Heroi("arqueiro", "h1", 1, 1),
                CenarioDoMotor.Heroi("bruxo", "h2", 2, 1),
                CenarioDoMotor.Monstro("thorn-lasher", "m1", 7, 1));
        }

        /// <summary>Joga o monstro em parcelas, como a cena faz, até a vez de
        /// um herói. O teto protege a suíte de um laço que a cena não teria.</summary>
        static void AteJogador(Jogo.Partida partida)
        {
            for (int i = 0; i < 200; i++)
            {
                if (partida.Acabou) Assert.Fail("a batalha acabou antes da hora");
                if (partida.TurnoDoJogador) return;
                partida.JogadaDoMonstro();
            }
            Assert.Fail("nenhum herói chegou a jogar em 200 jogadas de monstro");
        }

        [Test]
        public void DaDeclaracaoAoGolpe_TudoPeloCaminhoDaCena()
        {
            var banco = CenarioDoMotor.Acervo();
            var batalha = BatalhaComDupla();
            var partida = new Jogo.Partida(banco, batalha, Motor.Sorte.DeTexto("teste-fusao"));

            var go = new GameObject("palco-do-teste-de-fusao");
            try
            {
                var palco = go.AddComponent<Cena.Palco>();
                palco.Pecas = new Cena.SemPecas();
                palco.Montar(batalha.Mapa);
                var elenco = new Cena.Elenco(palco, null, new SemModelos(), new Cena.Aparencia());

                // ---- abertura: os três corpos em cena, como o AposAcao faria.
                elenco.Sincronizar(Jogo.Fichas.De(batalha, banco));
                AteJogador(partida);

                var anfitriao = batalha.Atual;
                var convidadoUid = anfitriao.Uid == "h1" ? "h2" : "h1";
                var corpoDoAnfitriaoAntes = elenco.ObjetoDe(anfitriao.Uid);
                Assert.IsNotNull(corpoDoAnfitriaoAntes);
                Assert.IsNotNull(elenco.ObjetoDe(convidadoUid));

                // ---- DECLARAR, pelo mesmo método que o botão chama.
                int paAntes = anfitriao.PA;
                var declaracao = partida.DeclararFusao();
                Assert.IsNotNull(declaracao, "com aliado colado o toque é jogada");
                Assert.IsTrue(declaracao.Valido, declaracao.Recusa);
                Assert.IsTrue(declaracao.Tem(Motor.TipoDeEvento.FusaoDeclarada));
                Assert.AreEqual(paAntes - Motor.Batalha.CustoDePaDaFusao, anfitriao.PA);

                // O quadro que o HUD pintaria agora: pendência acesa.
                Assert.IsTrue(partida.Quadro().FusaoPendente);
                Assert.IsFalse(partida.Quadro().PodeFundir);

                // ---- ENCERRAR: é aqui que o motor resolve, sem a interface
                // pedir nada além do fim do turno.
                var fim = partida.EncerrarTurno();
                Assert.IsNotNull(fim);
                Assert.IsTrue(fim.Tem(Motor.TipoDeEvento.Fusao), fim.ToString());

                var fundida = batalha.Acha(anfitriao.Uid);
                Assert.IsTrue(fundida.EFusao);
                Assert.AreEqual("arqueiro+bruxo", fundida.ClasseOuMonstroId);

                // ---- a CENA reage pelo espelho: o mesmo Sincronizar de sempre.
                elenco.Sincronizar(Jogo.Fichas.De(batalha, banco));

                Assert.IsNull(elenco.ObjetoDe(convidadoUid),
                    "o convidado saiu do tabuleiro e tem de sair de cena — um " +
                    "corpo sem dono ocupa uma casa que o motor diz livre");
                var corpoDaFundida = elenco.ObjetoDe(fundida.Uid);
                Assert.IsNotNull(corpoDaFundida, "a fundida sumiu da cena");
                Assert.IsTrue(corpoDoAnfitriaoAntes == null,
                    "o corpo antigo tinha de ser destruído: o id da unidade " +
                    "mudou e o Elenco troca o corpo inteiro (Obter confere o Id)");
                Assert.IsFalse(ReferenceEquals(corpoDoAnfitriaoAntes, corpoDaFundida),
                    "o corpo da fundida é um corpo NOVO, não o do anfitrião");

                // ---- na vez da fundida, a barra é o arsenal composto.
                AteJogador(partida);
                Assert.AreSame(fundida, batalha.Atual, "quem joga é a fundida — " +
                    "a fusão preserva o lugar na fila");

                var quadro = partida.Quadro();
                Assert.Greater(quadro.Feiticos.Count, 0, "a barra da fundida saiu vazia");
                for (int i = 0; i < quadro.Feiticos.Count; i++)
                    StringAssert.StartsWith("fus:", quadro.Feiticos[i].Id,
                        "na barra da fundida só vive o arsenal composto");
                Assert.IsFalse(quadro.PodeFundir, "fusão não se funde de novo");

                // ---- e um composto SAI: escolher na barra, tocar na casa.
                string escolhido = null;
                for (int i = 0; i < quadro.Feiticos.Count; i++)
                    if (batalha.PodeConjurar(quadro.Feiticos[i].Id, batalha.Acha("m1").Casa))
                    {
                        escolhido = quadro.Feiticos[i].Id;
                        break;
                    }
                Assert.IsNotNull(escolhido, "nenhum composto alcança a Vergasta — o palco mudou?");

                partida.EscolherFeitico(escolhido);
                Assert.AreEqual(escolhido, partida.FeiticoEscolhido);

                var vergasta = batalha.Acha("m1");
                int pvAntes = vergasta.PV;
                var golpe = partida.TocarCasa(vergasta.Casa);

                Assert.IsNotNull(golpe);
                Assert.IsTrue(golpe.Valido, golpe.Recusa);
                Assert.IsTrue(golpe.Tem(Motor.TipoDeEvento.Conjuracao));
                Assert.Less(vergasta.PV, pvAntes, "o composto tem de machucar");
                Assert.IsNull(partida.FeiticoEscolhido, "a mão esvazia no lançamento aceito");
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }

        [Test]
        public void CancelarPelaPartida_ConsomeAIntencao_SemDevolverOsPa()
        {
            var banco = CenarioDoMotor.Acervo();
            var batalha = BatalhaComDupla();
            var partida = new Jogo.Partida(banco, batalha, Motor.Sorte.DeTexto("teste-fusao"));
            AteJogador(partida);

            var anfitriao = batalha.Atual;
            partida.DeclararFusao();
            int paDepoisDeDeclarar = anfitriao.PA;

            var r = partida.CancelarFusao();
            Assert.IsNotNull(r);
            Assert.IsTrue(r.Valido, r.Recusa);
            Assert.AreEqual("cancelada", r.Do(Motor.TipoDeEvento.FusaoFalhou)[0].Detalhe);
            Assert.IsNull(batalha.FusaoPendente);
            Assert.AreEqual(paDepoisDeDeclarar, anfitriao.PA,
                "cancelar não reembolsa — é a regra do motor, e o caminho da " +
                "cena não pode suavizá-la");

            var fim = partida.EncerrarTurno();
            Assert.IsFalse(fim.Tem(Motor.TipoDeEvento.Fusao), "cancelada, nada resolve");
        }

        [Test]
        public void SemCandidato_DeclararNaoEJogada()
        {
            var banco = CenarioDoMotor.Acervo();
            var mapa = CenarioDoMotor.Aberta(9, 3);

            // Heróis SEPARADOS: ninguém colado, nada a declarar.
            var batalha = CenarioDoMotor.Montar(mapa, Motor.Sorte.SempreOMaximo,
                CenarioDoMotor.Heroi("arqueiro", "h1", 1, 1),
                CenarioDoMotor.Heroi("bruxo", "h2", 5, 1),
                CenarioDoMotor.Monstro("thorn-lasher", "m1", 7, 1));
            var partida = new Jogo.Partida(banco, batalha, Motor.Sorte.DeTexto("teste-fusao"));
            AteJogador(partida);

            Assert.IsNull(partida.DeclararFusao(),
                "sem candidato o toque não é jogada — como tocar na própria casa");
            Assert.IsNull(batalha.FusaoPendente);
        }

        // ============================================================== ALTURA

        [Test]
        public void AFichaDaFundida_MandaAAlturaDoPaiMaisAlto()
        {
            var banco = CenarioDoMotor.Acervo();

            // O piso da faixa do CONTRATO_ENTREGA_PERSONAGEM §5: o pai mais
            // alto. Sem isto o id de dupla cairia no 1,80 m do monstro comum e
            // a fusão ENCOLHERIA na tela — o Bárbaro tem 2,30.
            Assert.AreEqual(Cena.Elenco.AlturaDaClasse("sumo"),
                Jogo.Fichas.AlturaDe(banco, "bruxo+sumo"));
            Assert.AreEqual(Cena.Elenco.AlturaDaClasse("arqueiro"),
                Jogo.Fichas.AlturaDe(banco, "arqueiro+bruxo"));

            // E só a DUPLA DE CLASSES ganha essa altura: um `+` qualquer não.
            Assert.AreEqual(0f, Jogo.Fichas.AlturaDe(banco, "arqueiro+coisa"));
            Assert.AreEqual(0f, Jogo.Fichas.AlturaDe(banco, "sumo"),
                "classe sozinha continua medindo pela tabela do Elenco");
        }
    }
}
