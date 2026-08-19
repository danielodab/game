using NUnit.Framework;
using Soterra.Motor;

namespace Soterra.Testes.Motor
{
    // `Motor.X` dentro de `Soterra.Testes.Motor` acha o PRÓPRIO namespace de
    // teste antes de chegar em `Soterra.Motor`, e some com o tipo. O apelido
    // global trava no lugar certo.
    using Motor = global::Soterra.Motor;

    using Batalha = global::Soterra.Motor.Batalha;

    /// <summary>
    /// Os oito tipos de efeito que faltavam — <c>teleport</c>, <c>swap</c>,
    /// <c>moveTo</c>, <c>summon</c>, <c>trap</c>, <c>weatherShift</c>,
    /// <c>chain</c> e <c>reflect</c> — medidos com feitiço e bicho REAIS.
    ///
    /// Nenhum número aqui é inventado: 25% de reflexo é o <c>pct</c> da Pele em
    /// Brasa, 0,3 de queda é o <c>falloff</c> do Tiro Saltador, e 40 de PV é a
    /// ficha do Familiar.
    /// </summary>
    public class EfeitosTests
    {
        // ---- movimento forçado do próprio conjurador -------------------------

        /// <summary>
        /// O Passo do Bruxo tira o corpo do lugar de verdade — e só aceita casa
        /// VAZIA, que é o que <c>needsEmptyTile</c> quer dizer.
        /// </summary>
        [Test]
        public void Passo_do_Bruxo_teleporta_para_casa_vazia_e_recusa_casa_ocupada()
        {
            var mapa = Cenario.Aberta(8, 3);
            var bruxo = Cenario.Heroi("bruxo", "h1", 1, 1, "ar", 2);   // bruxo-ar-12
            var vespa = Cenario.Monstro("lantern-wasp", "m1", 6, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, bruxo, vespa);
            Cenario.AteAVezDe(b, "h1");

            Assert.IsFalse(b.PodeConjurar("bruxo-ar-12", Cenario.Ponto(6, 1)),
                           "casa com gente em cima não recebe teleporte");

            var destino = Cenario.Ponto(4, 1);
            var r = b.Conjurar("bruxo-ar-12", destino);

            Assert.IsTrue(r.Valido, r.Recusa);
            Assert.AreEqual(destino, bruxo.Casa);
            Assert.AreEqual(1, r.Do(TipoDeEvento.Teleporte).Count);
            Assert.AreEqual(Cenario.Ponto(1, 1), r.Do(TipoDeEvento.Teleporte)[0].De);
            Assert.AreEqual(destino, r.Do(TipoDeEvento.Teleporte)[0].Para);
            Assert.IsNull(b.EmCasa(Cenario.Ponto(1, 1)), "a casa de partida ficou livre");
        }

        /// <summary>
        /// A Troca de Sombras troca os dois corpos de casa.
        ///
        /// E NÃO causa dano, apesar de declarar um efeito <c>damage</c> logo
        /// depois do <c>swap</c>: as casas da área são calculadas UMA vez, antes
        /// do primeiro efeito, e quando o dano chega quem está na casa mirada já
        /// é o próprio conjurador — que efeito ofensivo nunca atinge. É o que o
        /// <c>engine.js</c> faz, letra por letra, e está no relatório como
        /// divergência entre a descrição do feitiço e o motor.
        /// </summary>
        [Test]
        public void Troca_de_Sombras_troca_as_casas_e_o_dano_dela_nao_pega_ninguem()
        {
            var mapa = Cenario.Aberta(8, 3);
            var ladino = Cenario.Heroi("espadachim", "h1", 1, 1, "ar", 4);   // espadachim-ar-20
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 4, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, ladino, vergasta);
            Cenario.AteAVezDe(b, "h1");

            var r = b.Conjurar("espadachim-ar-20", Cenario.Ponto(4, 1));

            Assert.IsTrue(r.Valido, r.Recusa);
            Assert.AreEqual(Cenario.Ponto(4, 1), ladino.Casa, "o Ladino foi para onde a Vergasta estava");
            Assert.AreEqual(Cenario.Ponto(1, 1), vergasta.Casa, "e a Vergasta veio para o lugar dele");
            Assert.AreEqual(2, r.Do(TipoDeEvento.Teleporte).Count, "os dois corpos se mexeram");
            Assert.AreEqual(0, r.PvPerdidoPor("m1"),
                            "o dano do feitiço cai na casa mirada, que agora é a do próprio conjurador");
        }

        /// <summary>
        /// O Passo de Corça desliza até quatro casas pelo eixo dominante — e
        /// PARA no primeiro corpo, sem contornar. Contornar faria a investida
        /// virar um andar caro.
        /// </summary>
        [Test]
        public void Passo_de_Corca_desliza_ate_o_alvo_e_para_no_primeiro_corpo()
        {
            var mapa = Cenario.Aberta(10, 3);
            var batedor = Cenario.Heroi("arqueiro", "h1", 1, 1);
            var longe = Cenario.Monstro("lantern-wasp", "m1", 9, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, batedor, longe);
            Cenario.AteAVezDe(b, "h1");

            var r = b.Conjurar("arqueiro-neutro-2", Cenario.Ponto(5, 1));
            Assert.IsTrue(r.Valido, r.Recusa);
            Assert.AreEqual(Cenario.Ponto(5, 1), batedor.Casa, "quatro casas, que é o `maxTiles` do acervo");

            var forcados = r.Do(TipoDeEvento.Movimento);
            Assert.AreEqual(1, forcados.Count);
            Assert.AreEqual("forçado", forcados[0].Detalhe,
                            "a cena anima investida e passo de jeitos diferentes");
            Assert.AreEqual(3, batedor.PP, "investida não gasta Ponto de Passo");

            // Agora com um corpo no caminho.
            var mapa2 = Cenario.Aberta(10, 3);
            var batedor2 = Cenario.Heroi("arqueiro", "h2", 1, 1);
            var barreira = Cenario.Monstro("thorn-lasher", "m2", 3, 1);
            var b2 = Cenario.Montar(mapa2, Sorte.SempreOMinimo, batedor2, barreira);
            Cenario.AteAVezDe(b2, "h2");

            var r2 = b2.Conjurar("arqueiro-neutro-2", Cenario.Ponto(5, 1));
            Assert.IsTrue(r2.Valido, r2.Recusa);
            Assert.AreEqual(Cenario.Ponto(2, 1), batedor2.Casa, "parou colado na Vergasta");
        }

        // ---- o que a conjuração deixa no tabuleiro ---------------------------

        /// <summary>
        /// O Chamado Menor põe o Familiar em campo, do lado do Xamã, e ele joga
        /// LOGO DEPOIS do invocador — não no fim da fila, que daria a ele um
        /// turno antes do inimigo mais lento.
        /// </summary>
        [Test]
        public void Chamado_Menor_poe_o_Familiar_em_campo_logo_atras_do_Xama()
        {
            var mapa = Cenario.Aberta(10, 3);
            var xama = Cenario.Heroi("invocador", "h1", 1, 1);
            var vespa = Cenario.Monstro("lantern-wasp", "m1", 7, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, xama, vespa);
            Cenario.AteAVezDe(b, "h1");

            var casa = Cenario.Ponto(3, 1);
            var r = b.Conjurar("invocador-neutro-1", casa);
            Assert.IsTrue(r.Valido, r.Recusa);

            var familiar = b.EmCasa(casa);
            Assert.IsNotNull(familiar, "nasceu alguém na casa mirada");
            Assert.AreEqual("sum-familiar", familiar.ClasseOuMonstroId);
            Assert.AreEqual(40, familiar.PVMax, "a ficha real do Familiar");
            Assert.AreEqual(Lado.Heroi, familiar.Lado, "a invocação do herói luta pelo herói");
            Assert.IsTrue(familiar.Invocada);
            Assert.AreEqual(1, r.Do(TipoDeEvento.Invocacao).Count);

            b.EncerrarTurno();
            Assert.AreEqual(familiar.Uid, b.Atual.Uid, "a vez passa do Xamã direto para o que ele chamou");
        }

        /// <summary>
        /// Invocação NÃO segura o lado.
        ///
        /// A Jardineira semeia um Feral, e mesmo com ele de pé a sala se fecha
        /// quando ela cai. Sem esta regra bastaria invocar sem parar para nunca
        /// perder a sala.
        /// </summary>
        [Test]
        public void Bicho_invocado_nao_segura_o_lado_quando_quem_o_chamou_morre()
        {
            var mapa = Cenario.Aberta(10, 3);
            var ladino = Cenario.Heroi("espadachim", "h1", 2, 1);
            var jardineira = Cenario.Monstro("boss-gardener", "m1", 3, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, ladino, jardineira);

            Cenario.AteAVezDe(b, "m1");
            var r = b.Conjurar("m-seed-toss", Cenario.Ponto(5, 1));
            Assert.IsTrue(r.Valido, r.Recusa);

            var feral = b.EmCasa(Cenario.Ponto(5, 1));
            Assert.IsNotNull(feral);
            Assert.AreEqual(Lado.Monstro, feral.Lado);

            // A Jardineira chega à rodada seguinte já quase caída: bater 300 de
            // PV com a Estocada levaria dezesseis turnos e não mediria nada além
            // de paciência.
            jardineira.PV = 30;
            Cenario.AteAVezDe(b, "h1");
            b.Conjurar("espadachim-neutro-1", jardineira.Casa);
            b.Conjurar("espadachim-neutro-1", jardineira.Casa);

            Assert.IsFalse(jardineira.Viva, "duas Estocadas de 20 contra 10 de resistência neutra");
            Assert.IsTrue(feral.NoTabuleiro, "o Feral continua em pé");
            Assert.AreEqual(FaseDaBatalha.Vitoria, b.Fase, "e ainda assim a sala está limpa");
        }

        /// <summary>
        /// A Estaca-Alarme fica no chão e morde quem pisa — do OUTRO lado. Do
        /// lado de quem armou ela é inerte, senão o Xamã minaria o próprio
        /// caminho.
        /// </summary>
        [Test]
        public void Estaca_Alarme_dispara_para_o_inimigo_e_ignora_o_dono()
        {
            var mapa = Cenario.Aberta(10, 3);
            var xama = Cenario.Heroi("invocador", "h1", 1, 1);
            var vespa = Cenario.Monstro("lantern-wasp", "m1", 5, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, xama, vespa);

            Cenario.AteAVezDe(b, "h1");
            var casa = Cenario.Ponto(4, 1);
            var armar = b.Conjurar("invocador-neutro-3", casa);
            Assert.IsTrue(armar.Valido, armar.Recusa);
            Assert.AreEqual(1, armar.Do(TipoDeEvento.ArmadilhaArmada).Count);
            Assert.IsNotNull(b.ArmadilhaEm(casa));

            var antes = vespa.PV;
            Cenario.AteAVezDe(b, "m1");
            var andar = b.Andar(casa);

            Assert.IsTrue(andar.Valido, andar.Recusa);
            Assert.AreEqual(1, andar.Do(TipoDeEvento.ArmadilhaDisparada).Count);
            Assert.AreEqual(22, antes - vespa.PV, "o teto da faixa 16–22 da carga do acervo");
            Assert.IsNull(b.ArmadilhaEm(casa), "a carga é gasta ao disparar");
        }

        [Test]
        public void O_dono_pisa_na_propria_Estaca_Alarme_e_nada_acontece()
        {
            var mapa = Cenario.Aberta(10, 3);
            var xama = Cenario.Heroi("invocador", "h1", 1, 1);
            var vespa = Cenario.Monstro("lantern-wasp", "m1", 8, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, xama, vespa);

            Cenario.AteAVezDe(b, "h1");
            var casa = Cenario.Ponto(4, 1);
            b.Conjurar("invocador-neutro-3", casa);

            var antes = xama.PV;
            var andar = b.Andar(casa);

            Assert.IsTrue(andar.Valido, andar.Recusa);
            Assert.AreEqual(0, andar.Do(TipoDeEvento.ArmadilhaDisparada).Count);
            Assert.AreEqual(antes, xama.PV);
            Assert.IsNotNull(b.ArmadilhaEm(casa), "a carga continua armada esperando o inimigo");
        }

        /// <summary>
        /// A Fúria da Fornalha muda o clima da sala para estiagem — é o
        /// <c>weatherShift</c> do último degrau do caminho de fogo.
        /// </summary>
        [Test]
        public void Furia_da_Fornalha_impoe_estiagem_na_sala()
        {
            var mapa = Cenario.Aberta(12, 3);
            var barbaro = Cenario.Heroi("sumo", "h1", 1, 1, "fogo", 5);   // sumo-fogo-30
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 10, 1);
            var b = Cenario.Montar(mapa, "calmo", Sorte.SempreOMinimo, barbaro, vergasta);
            Cenario.AteAVezDe(b, "h1");

            Assert.AreEqual("calmo", b.Clima);
            var r = b.Conjurar("sumo-fogo-30", barbaro.Casa);

            Assert.IsTrue(r.Valido, r.Recusa);
            Assert.AreEqual("estiagem", b.Clima);
            Assert.AreEqual(1, r.Do(TipoDeEvento.MudancaDeClima).Count);
            Assert.AreEqual("estiagem", r.Do(TipoDeEvento.MudancaDeClima)[0].Detalhe);
        }

        // ---- dano que anda sozinho -------------------------------------------

        /// <summary>
        /// O Tiro Saltador acerta o alvo e pula duas vezes, perdendo força a cada
        /// salto — e o salto sai da ÚLTIMA vítima, não do atirador.
        ///
        /// Faixa 22–28 de ar, queda 0,3. Contra a Vergasta (resistência 0 a ar) o
        /// teto dá 28, depois 28×0,3 = 8,4 → 8, depois 28×0,09 = 2,52 → 3.
        /// </summary>
        [Test]
        public void Tiro_Saltador_salta_duas_vezes_e_perde_forca_a_cada_salto()
        {
            var mapa = Cenario.Aberta(12, 3);
            var batedor = Cenario.Heroi("arqueiro", "h1", 0, 1, "ar", 1);   // arqueiro-ar-10
            var primeira = Cenario.Monstro("thorn-lasher", "m1", 4, 1);
            var segunda = Cenario.Monstro("thorn-lasher", "m2", 6, 1);
            var terceira = Cenario.Monstro("thorn-lasher", "m3", 8, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, batedor,
                                   primeira, segunda, terceira);
            Cenario.AteAVezDe(b, "h1");

            var r = b.Conjurar("arqueiro-ar-10", Cenario.Ponto(4, 1));
            Assert.IsTrue(r.Valido, r.Recusa);

            var saltos = r.Do(TipoDeEvento.SaltoEmCadeia);
            Assert.AreEqual(3, saltos.Count, "o alvo mais dois saltos (`jumps: 2`)");
            Assert.AreEqual(0, saltos[0].Quantidade);
            Assert.AreEqual(2, saltos[2].Quantidade);

            Assert.AreEqual(28, r.PvPerdidoPor("m1"));
            Assert.AreEqual(8, r.PvPerdidoPor("m2"));
            Assert.AreEqual(3, r.PvPerdidoPor("m3"));
        }

        /// <summary>
        /// O raio não volta para quem já apanhou, e não alcança quem está longe
        /// demais: o salto tem alcance 3, próprio, independente do alcance do
        /// feitiço.
        /// </summary>
        [Test]
        public void O_salto_do_raio_tem_alcance_proprio_e_nao_repete_vitima()
        {
            var mapa = Cenario.Aberta(16, 3);
            var batedor = Cenario.Heroi("arqueiro", "h1", 0, 1, "ar", 1);
            var perto = Cenario.Monstro("thorn-lasher", "m1", 4, 1);
            var longe = Cenario.Monstro("thorn-lasher", "m2", 12, 1);   // 8 casas: fora do salto
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, batedor, perto, longe);
            Cenario.AteAVezDe(b, "h1");

            var r = b.Conjurar("arqueiro-ar-10", Cenario.Ponto(4, 1));

            Assert.AreEqual(1, r.Do(TipoDeEvento.SaltoEmCadeia).Count,
                            "sem ninguém dentro de 3 casas, o raio morre no primeiro alvo");
            Assert.AreEqual(0, r.PvPerdidoPor("m2"));
        }

        /// <summary>
        /// A Pele em Brasa devolve 25% do dano RECEBIDO — e a devolução NÃO volta
        /// a refletir, mesmo quando os dois lados estão espetados.
        ///
        /// É o teste do laço: sem a trava, o Bárbaro devolveria a devolução do
        /// companheiro até a pilha estourar. Aqui os dois vestem a Pele e sai
        /// exatamente UM reflexo.
        /// </summary>
        [Test]
        public void Pele_em_Brasa_devolve_um_quarto_do_dano_e_a_devolucao_nao_reflete_de_volta()
        {
            var mapa = Cenario.Aberta(14, 3);
            var atacante = Cenario.HeroiCom("sumo", "h1", 1, 1, "fogo", "sumo-fogo-5", "sumo-fogo-30");
            var companheiro = Cenario.HeroiCom("sumo", "h2", 2, 1, "fogo", "sumo-fogo-5");
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 12, 1);
            var b = Cenario.Montar(mapa, "calmo", Sorte.SempreOMaximo, atacante, companheiro, vergasta);

            Cenario.AteAVezDe(b, "h1");
            Assert.IsTrue(b.Conjurar("sumo-fogo-5", atacante.Casa).Valido);
            b.EncerrarTurno();

            Cenario.AteAVezDe(b, "h2");
            Assert.IsTrue(b.Conjurar("sumo-fogo-5", companheiro.Casa).Valido);
            b.EncerrarTurno();

            // Fogo amigo: a Fúria da Fornalha é um círculo de raio 2 em volta do
            // próprio Bárbaro, e efeito ofensivo poupa o conjurador mas não o
            // aliado colado nele.
            Cenario.AteAVezDe(b, "h1");
            var pvAtacanteAntes = atacante.PV;
            var r = b.Conjurar("sumo-fogo-30", atacante.Casa);
            Assert.IsTrue(r.Valido, r.Recusa);

            // 84 de teto × (100 − 15 de resistência a fogo da própria Pele) = 71.
            Assert.AreEqual(71, r.PvPerdidoPor("h2"));

            var reflexos = r.Do(TipoDeEvento.Reflexo);
            Assert.AreEqual(1, reflexos.Count, "um reflexo, e não uma escada infinita deles");
            Assert.AreEqual(18, reflexos[0].Quantidade, "25% de 71, arredondado para cima");
            Assert.AreEqual(18, pvAtacanteAntes - atacante.PV,
                            "o dano voltou inteiro para quem bateu, e parou aí");
        }

        // ---- traços ----------------------------------------------------------

        /// <summary>
        /// A Carrapicho-Mãe se parte em dois Carrapichinhos — e eles SEGURAM o
        /// lado.
        ///
        /// Os filhotes são a mãe continuando, não bichos que ela chamou: tratá-los
        /// como invocação declararia a sala limpa no instante exato em que ela se
        /// divide, que é o contrário do que o traço serve para fazer.
        /// </summary>
        [Test]
        public void A_Carrapicho_Mae_se_parte_em_dois_e_a_sala_nao_acaba()
        {
            var mapa = Cenario.Aberta(8, 3);
            var ladino = Cenario.Heroi("espadachim", "h1", 1, 1);
            var mae = Cenario.Monstro("burr-mother", "m1", 2, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, ladino, mae);

            Cenario.AteAVezDe(b, "h1");
            b.Conjurar("espadachim-neutro-1", mae.Casa);
            b.Conjurar("espadachim-neutro-1", mae.Casa);
            Assert.AreEqual(60 - 40, mae.PV, "duas Estocadas de 20 na ficha de 60 PV");

            // O turno tem de ser ENCERRADO à mão: a Estocada sai no máximo duas
            // vezes por turno, e `AteAVezDe` não faz nada quando já é a vez de
            // quem se procura.
            b.EncerrarTurno();
            Cenario.AteAVezDe(b, "h1");
            var r = b.Conjurar("espadachim-neutro-1", mae.Casa);

            Assert.IsFalse(mae.Viva);
            var nascidos = r.Do(TipoDeEvento.Invocacao);
            Assert.AreEqual(2, nascidos.Count, "`count: 2` na ficha dela");

            var acima = b.EmCasa(Cenario.Ponto(2, 2));
            var abaixo = b.EmCasa(Cenario.Ponto(2, 0));
            Assert.IsNotNull(acima);
            Assert.IsNotNull(abaixo);
            Assert.AreEqual("burrlet", acima.ClasseOuMonstroId);
            Assert.AreEqual(22, acima.PVMax, "a ficha real do Carrapichinho");
            Assert.IsFalse(acima.Invocada, "filhote de divisão segura o lado como a mãe segurava");
            Assert.AreEqual(FaseDaBatalha.EmAndamento, b.Fase, "a sala continua");
        }

        /// <summary>
        /// O Bufo-de-Pólen leva o vizinho junto ao cair: 18 de terra em raio 1,
        /// dano FIXO — é a criatura arrebentando, não um feitiço.
        /// </summary>
        [Test]
        public void O_Bufo_de_Polen_explode_ao_morrer_e_pega_quem_esta_colado()
        {
            var mapa = Cenario.Aberta(8, 3);
            var ladino = Cenario.Heroi("espadachim", "h1", 1, 1);
            var bufo = Cenario.Monstro("pollen-puff", "m1", 2, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, ladino, bufo);

            Cenario.AteAVezDe(b, "h1");
            b.Conjurar("espadachim-neutro-1", bufo.Casa);
            b.Conjurar("espadachim-neutro-1", bufo.Casa);
            Assert.AreEqual(45 - 40, bufo.PV);

            b.EncerrarTurno();          // a Estocada só sai duas vezes por turno
            Cenario.AteAVezDe(b, "h1");
            var pvAntes = ladino.PV;
            var r = b.Conjurar("espadachim-neutro-1", bufo.Casa);

            Assert.IsFalse(bufo.Viva);
            Assert.AreEqual(18, pvAntes - ladino.PV,
                            "os 18 de terra da ficha, sem poder e sem faixa");
            Assert.AreEqual(18, r.PvPerdidoPor("h1"));
        }

        /// <summary>
        /// A Jardineira-Viúva se enfurece ABAIXO de 40% da vida, e uma vez só. Se
        /// empilhasse, cada golpe depois do limiar daria mais 30 de poder e o
        /// chefe ferido viraria imbatível.
        /// </summary>
        [Test]
        public void A_Jardineira_se_enfurece_uma_vez_so_abaixo_do_limiar()
        {
            var mapa = Cenario.Aberta(8, 3);
            var ladino = Cenario.Heroi("espadachim", "h1", 1, 1);
            var jardineira = Cenario.Monstro("boss-gardener", "m1", 2, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, ladino, jardineira);

            // Chega ferida: o limiar são 120 PV (40% de 300), e bater 180 de PV
            // com a Estocada levaria dez turnos que não medem nada.
            jardineira.PV = 130;
            var tesoura = b.Feitico("m-shears");
            Assert.AreEqual(0, b.PoderDeConjuracao(jardineira, tesoura), "ainda inteira de cabeça");

            Cenario.AteAVezDe(b, "h1");
            b.Conjurar("espadachim-neutro-1", jardineira.Casa);

            Assert.AreEqual(112, jardineira.PV, "20 de Estocada contra 10 de resistência neutra");
            Assert.IsTrue(jardineira.Enfurecida);
            Assert.AreEqual(30, b.PoderDeConjuracao(jardineira, tesoura), "o `power: 30` da ficha");

            b.Conjurar("espadachim-neutro-1", jardineira.Casa);
            Assert.AreEqual(30, b.PoderDeConjuracao(jardineira, tesoura),
                            "o segundo golpe abaixo do limiar não empilha outro bônus");
        }

        /// <summary>
        /// O Seiveiro cura o aliado FERIDO dentro de duas casas, no começo do
        /// turno dele — e não a si mesmo, senão quatro deles juntos seriam
        /// imortais.
        /// </summary>
        [Test]
        public void O_Seiveiro_cura_o_aliado_ferido_a_duas_casas_no_comeco_do_turno()
        {
            var mapa = Cenario.Aberta(10, 3);
            var ladino = Cenario.Heroi("espadachim", "h1", 1, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 2, 1);
            var seiveiro = Cenario.Monstro("sap-shaman", "m2", 4, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMinimo, ladino, vergasta, seiveiro);

            Cenario.AteAVezDe(b, "h1");
            b.Conjurar("espadachim-neutro-1", vergasta.Casa);
            b.Conjurar("espadachim-neutro-1", vergasta.Casa);
            Assert.AreEqual(50 - 30, vergasta.PV, "duas Estocadas de 15, o piso da faixa");

            var r = b.EncerrarTurno();   // agora é a vez do Seiveiro

            Assert.AreEqual("m2", b.Atual.Uid);
            Assert.AreEqual(28, vergasta.PV, "os 8 do `regenAura` da ficha dele");
            Assert.AreEqual(55, seiveiro.PV, "a aura não cura quem a carrega");

            var curas = r.Do(TipoDeEvento.Cura);
            Assert.AreEqual(1, curas.Count);
            Assert.AreEqual("m1", curas[0].Uid);
            Assert.AreEqual("m2", curas[0].UidDaFonte);
        }
    }
}
