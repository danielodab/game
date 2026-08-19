using System.Collections.Generic;
using NUnit.Framework;

namespace Soterra.Testes.Jogo
{
    // Ver a nota de armadilha de nome em AcervoDoJogo.cs.
    using Motor = global::Soterra.Motor;
    using Jogo = global::Soterra.Jogo;
    using Interface = global::Soterra.Interface;
    using Progressao = global::Soterra.Progressao;
    using Montador = global::Soterra.Batalha.Montador;

    /// <summary>
    /// O teste de mesa do CALABOUÇO: a Estufa Soterrada inteira, as três salas,
    /// jogadas pela <see cref="PoliticaBoba"/> e pelos mesmos métodos que o
    /// dedo usa — vencer, recolher a recompensa, descer, e no fim do chefe
    /// terminar em <c>CalaboucoConcluido</c>.
    ///
    /// É o que faltava para SOTERRA ser um jogo em vez de uma batalha: a
    /// lógica sala-a-sala existia e estava testada na <c>Progressao.Descida</c>,
    /// mas nada a ligava ao tabuleiro — jogava-se UMA sala e acabava. O que
    /// este arquivo prova é a LIGAÇÃO: que a descida atravessa a montagem real
    /// da sala, a IA de verdade e a progressão de verdade, sem nada se perder
    /// no caminho.
    /// </summary>
    public class DescidaDoJogoTests
    {
        const string Calabouco = "greenhouse";
        static readonly string[] Grupo = { "sumo", "curandeira" };

        /// <summary>
        /// O nível com que o grupo desce no teste que atravessa o calabouço
        /// INTEIRO — e só nele.
        ///
        /// Não é enfeite, e foi medido, não chutado. A Estufa recomenda nível 3,
        /// mas a <see cref="PoliticaBoba"/> é ruim de propósito e o desgaste
        /// entre salas se acumula: com nível 14 o grupo vence o vestíbulo
        /// (rodada 7), vence a segunda perdendo a Paladina (rodada 9) e chega à
        /// sala do chefe com 133 e 52 de vida contra cinco criaturas — tomba na
        /// rodada 5. O que este teste prova é o LAÇO (sala → recompensa → sala →
        /// chefe → conclusão), e para isso o grupo precisa chegar lá.
        ///
        /// O preço deste nível é o corte de XP de §9-D: no nível 20 a Estufa
        /// paga o piso de 0,1, e o pouco que ela paga arredonda para baixo até
        /// zero. Por isso o teste de percurso NÃO cobra "a XP cresceu" — ele
        /// cobra que o que a recompensa registrou é exatamente o que a
        /// progressão recebeu. Quem cobra a XP crescendo de verdade são os
        /// testes de grupo CRU, que descem dentro da faixa do calabouço.
        /// </summary>
        const int NivelDoGrupo = 20;

        /// <summary>
        /// O nível mais alto que a Estufa ainda paga por INTEIRO: o
        /// <c>recommendedLevel</c> dela (3) mais os <c>graceLevels</c> (4) da
        /// tabela de nivelamento. É o nível dos testes que precisam ver a XP
        /// crescer de verdade — acima dele o corte de §9-D entra, e uma sala que
        /// paga 3 de XP com multiplicador 0,1 paga ZERO depois do arredondamento.
        ///
        /// Lido do acervo em <see cref="NivelSemCorte"/>, nunca cravado: mexer
        /// na dificuldade da Estufa não pode fazer este teste mentir.
        /// </summary>
        static int NivelSemCorte(Progressao.Progresso p)
        {
            var calabouco = p.Banco.AchaCalabouco(Calabouco);
            var queda = p.Banco.Nivelamento.QuedaDeXp;
            var nivel = calabouco.NivelRecomendado + (queda != null ? queda.NiveisDeGraca : 0);
            Assert.AreEqual(1.0, p.MultiplicadorDeXp(nivel, Calabouco), 0.0001,
                "o nível " + nivel + " já sofre corte de XP na Estufa — a conta de §9-D mudou");
            return nivel;
        }

        static Progressao.Progresso Progresso(out Progressao.ArmazemDeMemoria armazem)
        {
            armazem = new Progressao.ArmazemDeMemoria();
            return Progressao.Progresso.DoZero(AcervoDoJogo.Banco(), armazem);
        }

        /// <summary>Leva o herói ao nível pedido pela tabela REAL de XP — nunca
        /// por um número digitado, que envelheceria com a curva.</summary>
        static void LevarAoNivel(Progressao.Progresso p, string heroiId, int nivel)
        {
            var tabela = p.Banco.Nivelamento.TabelaDeXp;
            Assert.GreaterOrEqual(tabela.Count, nivel, "a tabela de XP não chega ao nível " + nivel);
            var h = p.Heroi(heroiId);
            Assert.IsNotNull(h, "herói sem ficha: " + heroiId);
            p.AdicionarXp(heroiId, tabela[nivel - 1] - h.Xp);
            Assert.AreEqual(nivel, p.NivelDe(heroiId));
        }

        static void LevarGrupoAoNivel(Progressao.Progresso p, int nivel)
        {
            for (int i = 0; i < Grupo.Length; i++) LevarAoNivel(p, Grupo[i], nivel);
        }

        /// <summary>
        /// Veste cada herói com a melhor peça de cada espaço, escolhida do
        /// ACERVO na hora (a de maior vida e poder somados) e não por id
        /// cravado — um id cravado envelheceria calado no dia em que o acervo
        /// renomeasse uma peça.
        ///
        /// Existe porque o teste que atravessa o calabouço precisa CHEGAR ao
        /// chefe: com o grupo só nivelado, a política boba vence as duas
        /// primeiras salas e tomba na terceira. Um jogador que chegasse lá
        /// estaria equipado — o equipamento é metade da progressão que esta
        /// rodada ligou, e usá-lo aqui exercita justamente esse caminho
        /// (<c>AdicionarItem</c> → <c>Equipar</c> → <c>FichaDeCombate</c> →
        /// unidade no tabuleiro).
        /// </summary>
        static void EquiparOMelhor(Progressao.Progresso p)
        {
            var espacos = Progressao.Progresso.Espacos;
            for (int s = 0; s < espacos.Length; s++)
            {
                string melhor = null;
                int melhorNota = -1;
                foreach (var par in p.Banco.Itens)
                {
                    var item = par.Value;
                    if (item == null || item.Espaco != espacos[s] || item.Bonus == null) continue;
                    var nota = item.Bonus.Pv + item.Bonus.Poder * 10 +
                               item.Bonus.Pa * 50 + item.Bonus.Pp * 30;
                    if (nota > melhorNota) { melhorNota = nota; melhor = par.Key; }
                }
                Assert.IsNotNull(melhor, "o acervo não tem peça nenhuma para o espaço " + espacos[s]);

                for (int h = 0; h < Grupo.Length; h++)
                {
                    Assert.IsTrue(p.AdicionarItem(melhor), "o saco recusou " + melhor);
                    Assert.IsTrue(p.Equipar(Grupo[h], melhor),
                                  Grupo[h] + " não vestiu " + melhor);
                }
            }
        }

        /// <summary>
        /// Resolve as escolhas de elemento pendentes pegando a PRIMEIRA opção
        /// que a própria tela ofereceria — assim o teste também cobra que a
        /// ponte oferece alguma coisa, em vez de cravar "fogo" e passar mesmo
        /// que a tela viesse vazia.
        /// </summary>
        static void ResolverEscolhas(Progressao.Progresso p, Jogo.Expedicao e)
        {
            for (int i = 0; i < 4 && e.Passo == Jogo.PassoDaExpedicao.EscolhaDeElemento; i++)
            {
                var heroi = e.HeroiDaEscolha;
                var q = Interface.PonteDaDescida.Quadro(p, e.Descida, e.Recompensa,
                                                        Interface.TipoDeFluxo.EscolhaDeElemento, heroi);
                Assert.Greater(q.Elementos.Count, 0,
                    "a tela de escolha não ofereceu caminho nenhum para " + heroi +
                    " — o jogador ficaria preso numa tela sem saída");
                Assert.IsTrue(e.EscolherElemento(heroi, q.Elementos[0].Id),
                    "a Progressão recusou a escolha que a tela ofereceu");
            }
            Assert.AreNotEqual(Jogo.PassoDaExpedicao.EscolhaDeElemento, e.Passo,
                "sobrou escolha de elemento pendente depois de quatro tentativas");
        }

        // ================================================== O CALABOUÇO INTEIRO

        [Test]
        public void ADescidaInteira_TresSalas_RecompensasEntreElas_EOChefeNoFim()
        {
            Progressao.ArmazemDeMemoria armazem;
            var p = Progresso(out armazem);
            LevarGrupoAoNivel(p, NivelDoGrupo);
            EquiparOMelhor(p);

            var e = Jogo.Expedicao.Comecar(p, Calabouco, Grupo, "mesa-da-descida", armazem);
            Assert.IsNotNull(e, "a Estufa tem de abrir para a dupla liberada");
            Assert.AreEqual(3, e.TotalDeSalas, "a Estufa Soterrada tem três salas");

            var xpAntes = p.Heroi(Grupo[0]).Xp;
            var xpPaga = 0;
            var salasQuePagaram = 0;

            for (int sala = 0; sala < 3; sala++)
            {
                Assert.AreEqual(sala, e.IndiceDaSala);
                Assert.AreEqual(Jogo.PassoDaExpedicao.EmSala, e.Passo,
                                "a sala " + sala + " abriu com uma tela de fluxo por cima");
                Assert.AreEqual(sala == 2, e.EhSalaDoChefe,
                                "só a última sala é a do chefe");

                PoliticaBoba.JogarAteAcabar(e.Partida);
                TestContext.WriteLine("sala " + sala + ": " + e.Partida.Batalha.Fase +
                                      " na rodada " + e.Partida.Batalha.Rodada + " — " +
                                      Vivos(e.Partida.Batalha));
                Assert.AreEqual(Motor.FaseDaBatalha.Vitoria, e.Partida.Batalha.Fase,
                    "o grupo tombou na sala " + sala + " — este teste é sobre o LAÇO, e sem " +
                    "vitória ele não chega ao chefe (o caminho da derrota tem teste próprio)");

                Assert.IsTrue(e.ConferirFimDaSala(), "o fim da sala tinha de ser registrado");
                Assert.IsNotNull(e.Recompensa, "sala vencida sem recompensa");
                Assert.Greater(e.Recompensa.XpDaSala, 0,
                    "a sala " + sala + " não contou XP nenhuma: os monstros mortos não " +
                    "chegaram à recompensa");
                xpPaga += e.Recompensa.XpPorHeroi[Grupo[0]];
                salasQuePagaram++;

                ResolverEscolhas(p, e);

                if (sala < 2)
                {
                    Assert.AreEqual(Jogo.PassoDaExpedicao.Recompensa, e.Passo);
                    Assert.IsTrue(e.Descer(), "o botão 'Descer' tinha de levar à sala seguinte");
                }
                else
                {
                    Assert.AreEqual(Jogo.PassoDaExpedicao.CalaboucoConcluido, e.Passo,
                        "vencer o chefe tem de concluir o calabouço, não abrir uma quarta sala");
                    Assert.IsFalse(e.Descer(), "depois do chefe não há para onde descer");
                }
            }

            Assert.AreEqual(3, salasQuePagaram);
            Assert.AreEqual(xpAntes + xpPaga, p.Heroi(Grupo[0]).Xp,
                "o que a recompensa registrou não é o que a progressão recebeu — a tela " +
                "mostraria um número e a ficha guardaria outro");
            TestContext.WriteLine("Estufa descida: XP do " + Grupo[0] + " foi de " + xpAntes +
                                  " para " + p.Heroi(Grupo[0]).Xp + " (nível " + p.NivelDe(Grupo[0]) + ")");
        }

        [Test]
        public void EntreSalas_OHeroiCarregaOPvCastigadoDaSalaAnterior()
        {
            Progressao.ArmazemDeMemoria armazem;
            var p = Progresso(out armazem);
            LevarGrupoAoNivel(p, NivelSemCorte(p));

            var e = Jogo.Expedicao.Comecar(p, Calabouco, Grupo, "mesa-do-pv", armazem);

            // Na PRIMEIRA sala todo mundo entra cheio — a progressão está no
            // começo da descida e não há nada para curar.
            foreach (var heroiId in Grupo)
                Assert.AreEqual(p.FichaDeCombate(heroiId).Pv, e.PvDeEntrada[heroiId],
                                heroiId + " não entrou cheio na primeira sala");

            PoliticaBoba.JogarAteAcabar(e.Partida);
            Assert.AreEqual(Motor.FaseDaBatalha.Vitoria, e.Partida.Batalha.Fase);

            var pvAoFim = new Dictionary<string, int>();
            var unidades = e.Partida.Batalha.Unidades;
            int i = 0;
            for (int u = 0; u < unidades.Count; u++)
            {
                if (unidades[u].Lado != Motor.Lado.Heroi) continue;
                pvAoFim[Grupo[i++]] = unidades[u].Viva ? unidades[u].PV : 0;
            }

            e.ConferirFimDaSala();
            ResolverEscolhas(p, e);
            Assert.IsTrue(e.Descer());

            foreach (var heroiId in Grupo)
            {
                var pvMaximo = p.FichaDeCombate(heroiId).Pv;
                var entrada = e.PvDeEntrada[heroiId];

                Assert.AreEqual(e.Descida.PvDeEntrada(heroiId, pvMaximo), entrada,
                    heroiId + " entrou na segunda sala com um PV que a Descida não mandou");
                Assert.Greater(entrada, 0, "ninguém entra numa sala com zero de vida");
                Assert.LessOrEqual(entrada, pvMaximo);

                if (pvAoFim[heroiId] > 0 && pvAoFim[heroiId] < pvMaximo)
                    Assert.Greater(entrada, pvAoFim[heroiId],
                        heroiId + " terminou ferido e entrou na sala seguinte sem cura nenhuma");
            }

            // E a UNIDADE no tabuleiro nasce com esse PV — o teste acima mede a
            // conta; este mede o corpo que o jogador vê.
            var novas = e.Partida.Batalha.Unidades;
            int k = 0;
            for (int u = 0; u < novas.Count; u++)
            {
                if (novas[u].Lado != Motor.Lado.Heroi) continue;
                Assert.AreEqual(e.PvDeEntrada[Grupo[k]], novas[u].PV,
                    Grupo[k] + " nasceu na segunda sala com PV diferente do que a descida calculou");
                k++;
            }
        }

        // ======================================================= A DERROTA

        [Test]
        public void ADerrota_EncerraADescidaEOBotaoRecomecaOCalabouco()
        {
            Progressao.ArmazemDeMemoria armazem;
            var p = Progresso(out armazem);

            // Grupo CRU contra o chefe: é o caminho da derrota, e ele precisa
            // acontecer de verdade — matar os heróis na marra provaria a tela,
            // não o laço.
            var e = Jogo.Expedicao.Comecar(p, Calabouco, Grupo, "mesa-da-derrota", armazem,
                                           indiceInicial: 2);
            Assert.IsNotNull(e);
            Assert.IsTrue(e.EhSalaDoChefe, "a sala 2 da Estufa é a do chefe");

            PoliticaBoba.JogarAteAcabar(e.Partida);
            Assert.AreNotEqual(Motor.FaseDaBatalha.Vitoria, e.Partida.Batalha.Fase,
                "a dupla de nível 1 venceu a Jardineira-Viúva jogando bobo — o acervo " +
                "afrouxou, e este teste precisa de outra forma de perder");

            Assert.IsTrue(e.ConferirFimDaSala());
            Assert.AreEqual(Jogo.PassoDaExpedicao.Derrota, e.Passo);
            Assert.IsNull(e.Recompensa, "a derrota não paga recompensa");
            Assert.IsTrue(e.Descida.Terminou);

            // A marca sai do armazém: reabrir o jogo não pode cair numa descida
            // que já acabou.
            Assert.IsNull(Jogo.MarcaDaDescida.Ler(armazem),
                "a descida terminou e a marca continuou gravada");

            Assert.IsTrue(e.Recomecar(), "a tela de derrota tem de conseguir recomeçar");
            Assert.AreEqual(0, e.IndiceDaSala, "recomeçar volta ao começo do calabouço");
            Assert.AreEqual(Jogo.PassoDaExpedicao.EmSala, e.Passo);
        }

        [Test]
        public void ADerrota_NaoDesfazOQueJaFoiConquistado()
        {
            Progressao.ArmazemDeMemoria armazem;
            var p = Progresso(out armazem);
            LevarGrupoAoNivel(p, NivelSemCorte(p));

            var e = Jogo.Expedicao.Comecar(p, Calabouco, Grupo, "mesa-do-que-fica", armazem);
            PoliticaBoba.JogarAteAcabar(e.Partida);
            e.ConferirFimDaSala();
            ResolverEscolhas(p, e);

            var xpDepoisDaPrimeira = p.Heroi(Grupo[0]).Xp;
            Assert.Greater(xpDepoisDaPrimeira, 0);

            e.Descer();
            e.Descida.RegistrarDerrota();

            Assert.AreEqual(xpDepoisDaPrimeira, p.Heroi(Grupo[0]).Xp,
                "perder a descida não pode desfazer o que já tinha sido conquistado");
        }

        // ========================================================== O SAVE

        [Test]
        public void FecharEReabrir_ContinuaNoCalabolcoENaSalaSalvos()
        {
            Progressao.ArmazemDeMemoria armazem;
            var p = Progresso(out armazem);
            LevarGrupoAoNivel(p, NivelSemCorte(p));

            var e = Jogo.Expedicao.Comecar(p, Calabouco, Grupo, "mesa-do-save", armazem);
            PoliticaBoba.JogarAteAcabar(e.Partida);
            e.ConferirFimDaSala();
            ResolverEscolhas(p, e);
            Assert.IsTrue(e.Descer());
            Assert.AreEqual(1, e.IndiceDaSala);

            var pvGravado = new Dictionary<string, int>(e.PvDeEntrada);

            // ---- fecha o jogo: progresso e marca são relidos do MESMO armazém,
            // por objetos novos, como aconteceria numa segunda abertura.
            var p2 = Progressao.Progresso.Carregar(AcervoDoJogo.Banco(), armazem);
            var e2 = Jogo.Expedicao.Retomar(p2, "mesa-do-save", armazem);

            Assert.IsNotNull(e2, "o jogo reabriu sem achar a descida gravada");
            Assert.AreEqual(Calabouco, e2.IdDoCalabouco);
            Assert.AreEqual(1, e2.IndiceDaSala, "reabriu no vestíbulo em vez da sala salva");
            Assert.AreEqual(Grupo.Length, e2.Grupo.Count);

            foreach (var heroiId in Grupo)
            {
                Assert.AreEqual(p.Heroi(heroiId).Xp, p2.Heroi(heroiId).Xp,
                                "a XP não sobreviveu a fechar o jogo");
                Assert.AreEqual(pvGravado[heroiId], e2.PvDeEntrada[heroiId],
                                heroiId + " reabriu com outra vida — a marca guarda o PV de entrada");
            }
        }

        [Test]
        public void Retomar_NaoPagaNadaDeNovo()
        {
            Progressao.ArmazemDeMemoria armazem;
            var p = Progresso(out armazem);
            LevarGrupoAoNivel(p, NivelSemCorte(p));

            var e = Jogo.Expedicao.Comecar(p, Calabouco, Grupo, "mesa-sem-dobro", armazem);
            PoliticaBoba.JogarAteAcabar(e.Partida);
            e.ConferirFimDaSala();
            ResolverEscolhas(p, e);
            e.Descer();

            var p2 = Progressao.Progresso.Carregar(AcervoDoJogo.Banco(), armazem);
            var xpAntes = p2.Heroi(Grupo[0]).Xp;
            var pecasAntes = p2.Estado.Saco.Count;
            var cartasAntes = p2.Estado.Cartas.Count;

            Assert.IsNotNull(Jogo.Expedicao.Retomar(p2, "mesa-sem-dobro", armazem));

            // A retomada avança o índice com "vitórias secas" — batalha vazia e
            // sorte nula. Se elas pagassem, reabrir o jogo viraria uma máquina
            // de XP e de peças: bastaria fechar e abrir na última sala.
            Assert.AreEqual(xpAntes, p2.Heroi(Grupo[0]).Xp, "retomar pagou XP de novo");
            Assert.AreEqual(pecasAntes, p2.Estado.Saco.Count, "retomar pagou peça de novo");
            Assert.AreEqual(cartasAntes, p2.Estado.Cartas.Count, "retomar pagou carta de novo");
        }

        [Test]
        public void SemMarcaGravada_NaoHaOQueRetomar()
        {
            Progressao.ArmazemDeMemoria armazem;
            var p = Progresso(out armazem);
            Assert.IsNull(Jogo.Expedicao.Retomar(p, "mesa-vazia", armazem),
                "sem descida gravada a retomada tem de devolver nulo — abrir uma nova é " +
                "decisão de quem chamou");
        }

        // ================================================== SALA × MONTADOR

        /// <summary>
        /// A montagem da sala com heróis da progressão põe os MESMOS monstros,
        /// nas mesmas casas e na mesma ordem, que o <c>Batalha.Montador</c>.
        ///
        /// Ela precisa existir separada dele (ver o resumo de
        /// <c>MontagemDaSala</c>: a ficha da progressão tem de estar pronta
        /// ANTES do construtor da batalha, e o Montador só recebe id de classe).
        /// O preço é uma cópia da leitura dos monstros, e este teste é o que
        /// impede a cópia de envelhecer em silêncio — varre o calabouço INTEIRO,
        /// sala por sala.
        /// </summary>
        [Test]
        public void OsMonstrosDaSalaSaoOsMesmosQueOMontadorPoria()
        {
            Progressao.ArmazemDeMemoria armazem;
            var p = Progresso(out armazem);
            var banco = p.Banco;
            var calabouco = banco.AchaCalabouco(Calabouco);

            for (int sala = 0; sala < calabouco.Salas.Count; sala++)
            {
                var minha = Jogo.MontagemDaSala.DeSala(p, Calabouco, sala, Grupo);
                var dele = Montador.DeSala(banco, Calabouco, sala, Grupo);

                var meus = Monstros(minha);
                var dele2 = Monstros(dele);
                Assert.AreEqual(dele2.Count, meus.Count,
                                "sala " + sala + ": número de monstros diferente do Montador");

                for (int i = 0; i < meus.Count; i++)
                {
                    Assert.AreEqual(dele2[i].ClasseOuMonstroId, meus[i].ClasseOuMonstroId,
                                    "sala " + sala + ", monstro " + i + ": id diferente");
                    Assert.AreEqual(dele2[i].Casa, meus[i].Casa,
                                    "sala " + sala + ", monstro " + i + ": casa diferente");
                    Assert.AreEqual(dele2[i].Uid, meus[i].Uid,
                                    "sala " + sala + ", monstro " + i + ": uid diferente");
                }

                Assert.AreEqual(dele.Clima, minha.Clima, "sala " + sala + ": clima diferente");
            }
        }

        /// <summary>Quem sobrou de pé, com o PV — a legenda da linha de log que
        /// diz por que a sala terminou como terminou.</summary>
        static string Vivos(Motor.Batalha b)
        {
            var texto = new System.Text.StringBuilder();
            for (int i = 0; i < b.Unidades.Count; i++)
            {
                var u = b.Unidades[i];
                if (!u.NoTabuleiro) continue;
                if (texto.Length > 0) texto.Append(", ");
                texto.Append(u.ClasseOuMonstroId).Append(' ').Append(u.PV).Append('/').Append(u.PVMax);
            }
            return texto.Length == 0 ? "ninguém de pé" : texto.ToString();
        }

        static List<Motor.Unidade> Monstros(Motor.Batalha b)
        {
            var saida = new List<Motor.Unidade>();
            for (int i = 0; i < b.Unidades.Count; i++)
                if (b.Unidades[i].Lado == Motor.Lado.Monstro) saida.Add(b.Unidades[i]);
            return saida;
        }

        // ======================================== A ESCOLHA DE ELEMENTO

        [Test]
        public void NoNivelDaEscolha_ODescerEsperaOCaminhoSerEscolhido()
        {
            Progressao.ArmazemDeMemoria armazem;
            var p = Progresso(out armazem);
            LevarGrupoAoNivel(p, p.NivelDaEscolhaDeElemento);

            var e = Jogo.Expedicao.Comecar(p, Calabouco, Grupo, "mesa-do-caminho", armazem);
            PoliticaBoba.JogarAteAcabar(e.Partida);
            Assert.AreEqual(Motor.FaseDaBatalha.Vitoria, e.Partida.Batalha.Fase,
                "o grupo no nível da escolha tinha de vencer o vestíbulo");
            e.ConferirFimDaSala();

            Assert.AreEqual(Jogo.PassoDaExpedicao.EscolhaDeElemento, e.Passo,
                "com escolha pendente a tela de recompensa não pode aparecer primeiro: " +
                "um botão 'Descer' ao lado faria o jogador pular uma decisão permanente");
            Assert.IsNotNull(e.HeroiDaEscolha);

            var heroi = e.HeroiDaEscolha;
            var q = Interface.PonteDaDescida.Quadro(p, e.Descida, e.Recompensa,
                                                    Interface.TipoDeFluxo.EscolhaDeElemento, heroi);
            Assert.AreEqual(4, q.Elementos.Count, "são quatro caminhos elementais");
            Assert.IsNull(q.RotuloDoBotao, "a tela de escolha não tem botão de pular");

            var escolhido = q.Elementos[0].Id;
            Assert.IsTrue(e.EscolherElemento(heroi, escolhido));
            Assert.AreEqual(escolhido, p.Heroi(heroi).Elemento);

            // PERMANENTE: a segunda escolha é recusada, e a Progressão já cobra
            // isso em teste próprio — aqui o que se prova é que o caminho da
            // TELA não abre uma porta que a regra fechou.
            Assert.IsFalse(e.EscolherElemento(heroi, q.Elementos[1].Id));
            Assert.AreEqual(escolhido, p.Heroi(heroi).Elemento);

            // O outro herói também deve uma; só depois dele a recompensa aparece.
            Assert.AreEqual(Jogo.PassoDaExpedicao.EscolhaDeElemento, e.Passo);
            ResolverEscolhas(p, e);
            Assert.AreEqual(Jogo.PassoDaExpedicao.Recompensa, e.Passo);
        }

        // ============================================== GRUPO QUE NÃO SERVE

        [Test]
        public void GrupoInvalido_NaoAbreDescida()
        {
            Progressao.ArmazemDeMemoria armazem;
            var p = Progresso(out armazem);

            Assert.IsNull(Jogo.Expedicao.Comecar(p, Calabouco, new[] { "sumo", "bruxo" },
                                                 "x", armazem),
                "o Bruxo começa TRANCADO no acervo: sem carta não há ficha para descer");
            Assert.IsNull(Jogo.Expedicao.Comecar(p, "calabouco-que-nao-existe", Grupo, "x", armazem));
            Assert.IsNull(Jogo.Expedicao.Comecar(p, Calabouco, new[] { "sumo", "sumo" }, "x", armazem),
                "o mesmo herói duas vezes não é uma dupla");
            Assert.IsNull(Jogo.Expedicao.Comecar(p, Calabouco, Grupo, "x", armazem, indiceInicial: 9),
                "sala de partida que não existe não pode abrir descida nenhuma");
        }
    }
}
