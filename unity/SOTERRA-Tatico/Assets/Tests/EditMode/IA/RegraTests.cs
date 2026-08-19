using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.IA
{
    using Motor = global::Soterra.Motor;
    using Batalha = global::Soterra.Motor.Batalha;
    using Soterra.Grade;
    using Soterra.IA;

    /// <summary>
    /// A IA joga DENTRO da regra — não a contorna.
    ///
    /// Uma IA que muta o estado por fora joga um jogo diferente do que o jogador
    /// joga, e todo balanceamento medido contra ela é medido contra outra coisa.
    /// Por isso nada aqui confere "a IA acertou": confere que o MOTOR aceitaria
    /// cada jogada antes de ela virar ação.
    /// </summary>
    public class RegraTests
    {
        // ---- a sala inteira, os dois lados jogados pela IA -------------------

        /// <summary>
        /// O Vestíbulo das Heras completo: os dois heróis nos primeiros <c>P</c>,
        /// os CINCO monstros nos nascimentos que o desenho traz (dois Bufos, duas
        /// Vergastas e uma Vespa — a letra repete de propósito), a IA jogando
        /// pelos dois lados por trinta turnos.
        ///
        /// É o teste que cobre o que nenhum caso montado à mão cobre: centenas de
        /// decisões, com parede, cobertura, provocação, veneno e raiz em cima do
        /// tabuleiro ao mesmo tempo. Cada uma passa por <c>PodeAndar</c> ou
        /// <c>PodeConjurar</c> ANTES de ser executada.
        /// </summary>
        [Test]
        public void NaSalaRealTodaJogadaDaIaEAceitaPeloMotor()
        {
            var b = SalaCheia("regra");
            var feitas = Cenario.Conduzir(b, Cenario.Ia(b, "regra"), 30);

            // Não se cobra número de jogadas: a batalha pode ACABAR antes dos
            // trinta turnos, e cobrar um total transformaria "os heróis morreram
            // depressa" em falha de teste. O que se cobra é que houve batalha.
            Assert.Greater(feitas.Count, 10, "a batalha rendeu quase nenhuma jogada");

            int andou = 0, conjurou = 0;
            for (int i = 0; i < feitas.Count; i++)
            {
                if (feitas[i].Tipo == TipoDeJogada.Andar) andou++;
                if (feitas[i].Tipo == TipoDeJogada.Conjurar) conjurou++;
            }
            Assert.Greater(andou, 0, "ninguém andou a batalha inteira");
            Assert.Greater(conjurou, 0, "ninguém conjurou a batalha inteira");
        }

        /// <summary>
        /// O buraco que esta rodada fecha, dito como sintoma: antes, o monstro
        /// passava o turno parado. Aqui os monstros andam, conjuram e tiram vida
        /// dos heróis.
        /// </summary>
        [Test]
        public void OsMonstrosDaSalaRealJogamEMachucamOsHerois()
        {
            var b = SalaCheia("monstros");
            var feitas = Cenario.Conduzir(b, Cenario.Ia(b, "monstros"), 24);

            int passosDeMonstro = 0, feiticosDeMonstro = 0;
            for (int i = 0; i < feitas.Count; i++)
            {
                var u = b.Acha(feitas[i].Uid);
                if (u == null || u.Lado != Motor.Lado.Monstro) continue;
                if (feitas[i].Tipo == TipoDeJogada.Andar) passosDeMonstro++;
                if (feitas[i].Tipo == TipoDeJogada.Conjurar) feiticosDeMonstro++;
            }

            Assert.Greater(passosDeMonstro, 0, "nenhum monstro andou");
            Assert.Greater(feiticosDeMonstro, 0, "nenhum monstro conjurou");

            int machucados = 0;
            var herois = b.Vivas(Motor.Lado.Heroi);
            for (int i = 0; i < herois.Count; i++) if (herois[i].PV < herois[i].PVMax) machucados++;
            Assert.Greater(machucados + (b.Fase == Motor.FaseDaBatalha.Derrota ? 1 : 0), 0,
                "os monstros jogaram e nenhum herói perdeu um ponto de vida");
        }

        /// <summary>
        /// Ninguém termina fora do chão. É a rede final contra a IA "andar"
        /// atravessando parede, cobertura ou buraco: qualquer atalho por fora do
        /// <c>Andar</c> do motor apareceria como uma unidade em cima de um
        /// <c>#</c>.
        /// </summary>
        [Test]
        public void NinguemParaEmCasaQueNaoEChao()
        {
            var b = SalaCheia("chao");
            Cenario.Conduzir(b, Cenario.Ia(b, "chao"), 24);

            for (int i = 0; i < b.Unidades.Count; i++)
            {
                var u = b.Unidades[i];
                if (!u.NoTabuleiro) continue;
                Assert.IsTrue(b.Mapa.Andavel(u.Casa), u + " terminou em " + u.Casa + ", que não é chão");
            }
        }

        // ---- parede ----------------------------------------------------------

        /// <summary>
        /// O Bufo em (7,7) e o herói em (4,7): entre eles, DUAS casas de
        /// <c>#</c> em (5,7) e (6,7). O caminho existe, mas desce ao corredor
        /// central e volta.
        ///
        /// A prova é a lista de casas visitadas: ela não pode conter as duas
        /// paredes, e a distância no fim tem de ser 1 — quer dizer, ele contornou
        /// em vez de desistir.
        /// </summary>
        [Test]
        public void OMonstroContornaAParedeEmVezDeAtravessala()
        {
            var mapa = Cenario.Vestibulo();
            Assert.IsFalse(mapa.Andavel(Cenario.Ponto(5, 7)), "a premissa caiu: (5,7) deixou de ser parede");
            Assert.IsFalse(mapa.Andavel(Cenario.Ponto(6, 7)), "a premissa caiu: (6,7) deixou de ser parede");

            var heroi = Cenario.Heroi("sumo", "u1", 4, 7);
            var bufo = Cenario.Monstro("pollen-puff", "u2", 7, 7);
            var b = Cenario.Montar(Cenario.SorteDoMotor("parede"), heroi, bufo);

            var visitadas = Cenario.CasasVisitadasPor(b, Cenario.Ia(b, "parede"), bufo.Uid, 4);

            for (int i = 0; i < visitadas.Count; i++)
                Assert.IsTrue(b.Mapa.Andavel(visitadas[i]),
                    "o Bufo pisou em " + visitadas[i] + ", que não é chão");

            Assert.AreEqual(1, Cenario.Entre(bufo, heroi),
                "havia caminho pelo corredor e ele não chegou: " + string.Join(" ", visitadas));
        }

        // ---- PA e PP ---------------------------------------------------------

        /// <summary>Sem PA a IA não propõe conjuração. Ela para, e passar é a jogada certa.</summary>
        [Test]
        public void SemPaAIaNaoConjura()
        {
            var heroi = Cenario.Heroi("sumo", "u1", 4, 8);
            var bufo = Cenario.Monstro("pollen-puff", "u2", 5, 8);
            var b = Cenario.Montar(Cenario.SorteDoMotor("sempa"), heroi, bufo);
            var ia = Cenario.Ia(b, "sempa");

            ia.Jogar();   // a Mordiscada custa 3 PA e o Bufo tem 3
            Assert.AreEqual(0, bufo.PA, "a premissa caiu: sobrou PA depois da Mordiscada");

            var j = ia.Decidir();
            Assert.AreNotEqual(TipoDeJogada.Conjurar, j.Tipo, "conjurou com zero PA: " + j);
            Cenario.ConferirContraOMotor(b, j);
        }

        /// <summary>Sem PP a IA não propõe passo — nem para a casa vizinha.</summary>
        [Test]
        public void SemPpAIaNaoAnda()
        {
            var heroi = Cenario.Heroi("sumo", "u1", 4, 8);
            var vergasta = Cenario.Monstro("thorn-lasher", "u2", 7, 8);
            var b = Cenario.Montar(Cenario.SorteDoMotor("seppp"), heroi, vergasta);
            var ia = Cenario.Ia(b, "seppp");

            var passo = ia.Decidir();
            Assert.AreEqual(TipoDeJogada.Andar, passo.Tipo, "a cena depende de a Vergasta querer se reposicionar");
            ia.Executar(passo);

            Assert.AreEqual(0, vergasta.PP, "a Vergasta tem 1 PP e ele não foi todo gasto");
            Assert.AreEqual(0, b.AlcanceDePasso().Count, "sem PP o motor não oferece casa nenhuma");

            for (int i = 0; i < 4; i++)
            {
                var j = ia.Decidir();
                Assert.AreNotEqual(TipoDeJogada.Andar, j.Tipo, "andou com zero PP: " + j);
                Cenario.ConferirContraOMotor(b, j);
                if (j.Tipo == TipoDeJogada.Passar) break;
                ia.Executar(j);
            }
        }

        /// <summary>
        /// Presa ao chão, a unidade não anda — mesmo com PP na ficha. É a
        /// Raiz-Trava da Vergasta aplicada num herói, e o herói jogado pela IA
        /// tem de aceitar a prisão em vez de tentar sair.
        /// </summary>
        [Test]
        public void PresaAoChaoAIaNaoTentaAndar()
        {
            var heroi = Cenario.Heroi("sumo", "u1", 4, 8);
            var vergasta = Cenario.Monstro("thorn-lasher", "u2", 6, 8);
            var b = Cenario.Montar(Cenario.SorteDoMotor("raiz"), heroi, vergasta);

            var r = b.Conjurar("m-root-grip", heroi.Casa);
            Assert.IsTrue(r.Valido, "a Raiz-Trava foi recusada: " + r.Recusa);
            Assert.IsTrue(Batalha.TemEfeito(heroi, "root"), "a Raiz-Trava não prendeu o herói");

            b.EncerrarTurno();
            Assert.AreSame(heroi, b.Atual, "só há dois em campo: a vez tem de ser do herói");

            var ia = Cenario.Ia(b, "raiz");
            for (int i = 0; i < 4; i++)
            {
                var j = ia.Decidir();
                Assert.AreNotEqual(TipoDeJogada.Andar, j.Tipo, "andou preso ao chão: " + j);
                Cenario.ConferirContraOMotor(b, j);
                if (j.Tipo == TipoDeJogada.Passar) break;
                ia.Executar(j);
            }
        }

        // ---- alcance ----------------------------------------------------------

        /// <summary>
        /// A Farpa alcança de 2 a 6 casas: colada no herói, ela NÃO sai. A IA tem
        /// de escolher outra coisa — no acervo, a Raiz-Trava, que alcança de 1 a
        /// 4 — ou andar até a distância do tiro.
        /// </summary>
        [Test]
        public void NaoMiraFeiticoForaDoAlcanceMinimo()
        {
            var heroi = Cenario.Heroi("sumo", "u1", 4, 8);
            var vergasta = Cenario.Monstro("thorn-lasher", "u2", 5, 8);
            var b = Cenario.Montar(Cenario.SorteDoMotor("minimo"), heroi, vergasta);

            var farpa = b.Feitico("m-thorn-shot");
            Assert.AreEqual(2, farpa.Alcance.Min, "a premissa caiu: a Farpa não tem mais alcance mínimo 2");
            Assert.IsFalse(Cenario.Contem(b.AlvosDe("m-thorn-shot"), heroi.Casa),
                "o motor ainda aceita a Farpa a uma casa; não há o que provar");

            var ia = Cenario.Ia(b, "minimo");
            for (int i = 0; i < Cerebro.TetoDeJogadas; i++)
            {
                var j = ia.Decidir();
                Cenario.ConferirContraOMotor(b, j);   // é aqui que o alcance é cobrado
                if (j.Tipo == TipoDeJogada.Conjurar && j.FeiticoId == "m-thorn-shot")
                    Assert.GreaterOrEqual(Distancia.Manhattan(vergasta.Casa, j.Casa), 2,
                        "mirou a Farpa dentro do alcance mínimo: " + j);
                if (j.Tipo == TipoDeJogada.Passar) break;
                ia.Executar(j);
                if (b.Atual != vergasta) break;
            }
        }

        /// <summary>
        /// Provocação: havendo um provocador vivo, feitiço hostil só pode MIRAR a
        /// casa dele. O Sumo provoca com o próprio feitiço base, e a partir daí
        /// nenhum monstro pode escolher o Arqueiro como casa-alvo.
        /// </summary>
        [Test]
        public void ComProvocadorEmCampoOsHostisSoMiramOProvocador()
        {
            // O Bufo fica ENTRE os dois, colado nos dois: sem a provocação ele
            // teria dois alvos igualmente legítimos, e a cena não provaria nada.
            var sumo = Cenario.Heroi("sumo", "u1", 8, 8);
            var arqueiro = Cenario.Heroi("arqueiro", "u2", 10, 8);
            var bufo = Cenario.Monstro("pollen-puff", "u3", 9, 8);
            var b = Cenario.Montar(Cenario.SorteDoMotor("taunt"), sumo, arqueiro, bufo);

            // O Sumo provoca em si mesmo (`sumo-neutro-2`: taunt + escudo).
            while (b.Atual != sumo) b.EncerrarTurno();
            var r = b.Conjurar("sumo-neutro-2", sumo.Casa);
            Assert.IsTrue(r.Valido, "a provocação foi recusada: " + r.Recusa);
            Assert.IsTrue(Batalha.TemEfeito(sumo, "taunt"), "o Sumo não ficou com `taunt`");

            while (b.Atual != bufo) b.EncerrarTurno();

            var ia = Cenario.Ia(b, "taunt");
            bool conjurou = false;
            for (int i = 0; i < Cerebro.TetoDeJogadas; i++)
            {
                var j = ia.Decidir();
                Cenario.ConferirContraOMotor(b, j);
                if (j.Tipo == TipoDeJogada.Conjurar)
                {
                    conjurou = true;
                    Assert.AreEqual(sumo.Casa, j.Casa,
                        "havia provocador e o Bufo mirou outra casa: " + j);
                }
                if (j.Tipo == TipoDeJogada.Passar) break;
                ia.Executar(j);
                if (b.Atual != bufo) break;
            }
            Assert.IsTrue(conjurou, "o Bufo estava colado nos dois heróis e não atacou ninguém");
        }

        // ---- a sala real, montada como o desenho manda ------------------------

        /// <summary>
        /// Monta o Vestíbulo com a composição REAL: os monstros saem de
        /// <c>sala.Monstros</c> letra por letra, e a letra REPETE — dois <c>a</c>
        /// são dois Bufos, não um. Agrupar por letra esvaziaria a sala.
        /// </summary>
        static Batalha SalaCheia(string semente)
        {
            var sala = Cenario.SalaDoVestibulo();
            var mapa = Cenario.Vestibulo();
            var unidades = new List<Motor.Unidade>();

            var classes = new[] { "sumo", "arqueiro" };
            for (int i = 0; i < classes.Length; i++)
                unidades.Add(Motor.Unidade.DeClasse(Cenario.Acervo().Classes[classes[i]],
                                                    "u" + (unidades.Count + 1),
                                                    mapa.NascimentosHeroi[i]));

            for (int i = 0; i < mapa.NascimentosMonstro.Count; i++)
            {
                var n = mapa.NascimentosMonstro[i];
                var id = sala.Monstros[n.Letra.ToString()];
                unidades.Add(Motor.Unidade.DeMonstro(Cenario.Acervo().Monstros[id],
                                                     "u" + (unidades.Count + 1), n.Casa));
            }

            Assert.AreEqual(5, mapa.NascimentosMonstro.Count,
                "o Vestíbulo tem cinco nascimentos de monstro no desenho");

            return new Batalha(Cenario.Acervo(), mapa, unidades,
                               Cenario.ClimaDoVestibulo(), Cenario.SorteDoMotor(semente));
        }
    }
}
