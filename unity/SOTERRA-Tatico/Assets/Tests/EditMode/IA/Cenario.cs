using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.IA
{
    // ARMADILHA DE NOME, já paga por esta equipe: dentro de `Soterra.Testes.IA`,
    // escrever `Motor.X` acha o namespace irmão `Soterra.Testes.Motor` antes de
    // `Soterra.Motor` e falha com CS0234. O mesmo vale para `Dados.` (existe
    // `Soterra.Testes.Dados`) e para `Batalha` (existe o NAMESPACE
    // `Soterra.Batalha`). Os apelidos globais travam nos alvos certos.
    using Motor = global::Soterra.Motor;
    using Dados = global::Soterra.Dados;
    using Batalha = global::Soterra.Motor.Batalha;
    using Soterra.Grade;
    using Soterra.IA;

    /// <summary>
    /// Monta batalhas com o acervo DE VERDADE, a sala DE VERDADE e os bichos DE
    /// VERDADE.
    ///
    /// Nada de tabuleiro de laboratório aqui: uma IA só prova alguma coisa no
    /// terreno em que vai jogar. O Vestíbulo das Heras tem parede que corta
    /// visão (<c>#</c>), cobertura que não corta (<c>=</c>) e um corredor central
    /// aberto — e é justamente o corredor que separa "aproximou-se" de
    /// "atravessou a parede".
    ///
    /// Sem o acervo exportado os testes terminam INCONCLUSIVOS, não verdes: um
    /// teste que passa porque o arquivo não existe afirma que está tudo certo
    /// justamente quando não há nada para conferir.
    /// </summary>
    static class Cenario
    {
        static Dados.BancoDeDados _acervo;

        public static Dados.BancoDeDados Acervo()
        {
            if (_acervo != null) return _acervo;

            var caminho = (Application.dataPath + "/Resources/dados/" +
                           Dados.Manifesto.Chave + ".json").Replace('\\', '/');
            if (!File.Exists(caminho))
            {
                Assert.Inconclusive(
                    "o acervo ainda não foi exportado: falta " + caminho + ". " +
                    "Este teste NÃO passa por ausência — volta a rodar sozinho quando o arquivo chegar.");
            }

            var b = Dados.BancoDeDados.CarregarDeResources();
            Assert.IsNotNull(b.Manifesto, "o manifesto existe em disco mas o Resources.Load não o achou");
            _acervo = b;
            return _acervo;
        }

        // ---- a sala real -----------------------------------------------------

        public const string CalaboucoDaEstufa = "greenhouse";
        public const int VestibuloDasHeras = 0;

        public static Dados.Sala SalaDoVestibulo()
        {
            return Acervo().AchaCalabouco(CalaboucoDaEstufa).Salas[VestibuloDasHeras];
        }

        public static Mapa Vestibulo() { return SalaDoVestibulo().ParaMapa(); }

        /// <summary>
        /// O clima que a SALA declara. Ler o do calabouço apagaria a decisão de
        /// quem desenhou a sala — o Vestíbulo é `calmo` dentro de uma Estufa que
        /// chove, e o clima muda a nota que a IA dá a cada alvo.
        /// </summary>
        public static string ClimaDoVestibulo()
        {
            var sala = SalaDoVestibulo();
            return string.IsNullOrEmpty(sala.Clima) ? "calmo" : sala.Clima;
        }

        public static Vector2Int Ponto(int x, int y) { return new Vector2Int(x, y); }

        // ---- unidades reais --------------------------------------------------

        public static Motor.Unidade Heroi(string classeId, string uid, int x, int y)
        {
            return Motor.Unidade.DeClasse(Acervo().Classes[classeId], uid, Ponto(x, y));
        }

        public static Motor.Unidade Monstro(string monstroId, string uid, int x, int y)
        {
            return Motor.Unidade.DeMonstro(Acervo().Monstros[monstroId], uid, Ponto(x, y));
        }

        // ---- batalha ---------------------------------------------------------

        /// <summary>
        /// Semente do MOTOR. Fixa e por nome, não por relógio: a batalha destes
        /// testes tem de ser a mesma batalha amanhã.
        /// </summary>
        public static Motor.Sorte SorteDoMotor(string semente)
        {
            return Motor.Sorte.DeTexto("motor:" + semente);
        }

        /// <summary>Semente do DESEMPATE da IA, separada da do motor de propósito.</summary>
        public static Motor.Sorte SorteDaIa(string semente)
        {
            return Motor.Sorte.DeTexto("ia:" + semente);
        }

        public static Batalha Montar(Motor.Sorte sorte, params Motor.Unidade[] unidades)
        {
            return new Batalha(Acervo(), Vestibulo(), unidades, ClimaDoVestibulo(), sorte);
        }

        public static Cerebro Ia(Batalha b, string semente = null)
        {
            return new Cerebro(Acervo(), b, semente == null ? null : SorteDaIa(semente));
        }

        // ---- condução --------------------------------------------------------

        /// <summary>
        /// Conduz a batalha com a IA jogando por TODO MUNDO, conferindo cada
        /// jogada CONTRA O MOTOR antes de executá-la.
        ///
        /// A conferência é o coração desta rodada: não basta a IA jogar, ela tem
        /// de jogar dentro da regra. Toda jogada de passo passa por
        /// <c>PodeAndar</c> e toda conjuração por <c>PodeConjurar</c> ANTES de
        /// virar ação — se a IA propuser andar através de parede, conjurar sem PA
        /// ou mirar fora do alcance, o teste morre na jogada exata, e não trinta
        /// turnos depois com o tabuleiro irreconhecível.
        /// </summary>
        public static List<Jogada> Conduzir(Batalha b, Cerebro ia, int tetoDeTurnos)
        {
            var feitas = new List<Jogada>();
            for (int turno = 0; turno < tetoDeTurnos; turno++)
            {
                if (b.Fase != Motor.FaseDaBatalha.EmAndamento || b.Atual == null) break;
                UmTurnoConferindo(b, ia, feitas, null);
            }
            return feitas;
        }

        /// <summary>
        /// Conduz <paramref name="turnos"/> turnos SÓ de <paramref name="uid"/>;
        /// todo o resto apenas passa a vez.
        ///
        /// Serve aos testes de comportamento: com os heróis jogando também, o
        /// bicho medido morre no meio da medição e o teste passa a falar de
        /// outra coisa. Devolve TODAS as casas em que a unidade esteve, que é o
        /// que prova que ela contornou a parede em vez de atravessá-la.
        /// </summary>
        public static List<Vector2Int> CasasVisitadasPor(Batalha b, Cerebro ia, string uid, int turnos)
        {
            var casas = new List<Vector2Int>();
            int jogados = 0, guarda = 0;

            while (jogados < turnos && guarda++ < turnos * 8 + 16)
            {
                if (b.Fase != Motor.FaseDaBatalha.EmAndamento || b.Atual == null) break;
                if (b.Atual.Uid != uid) { b.EncerrarTurno(); continue; }
                UmTurnoConferindo(b, ia, null, casas);
                jogados++;
            }
            return casas;
        }

        static void UmTurnoConferindo(Batalha b, Cerebro ia, List<Jogada> feitas, List<Vector2Int> casas)
        {
            var quem = b.Atual;
            bool passou = false;

            for (int i = 0; i < Cerebro.TetoDeJogadas && !passou; i++)
            {
                if (casas != null && quem.NoTabuleiro) casas.Add(quem.Casa);

                var j = ia.Decidir();
                ConferirContraOMotor(b, j);
                if (feitas != null) feitas.Add(j);
                ia.Executar(j);

                passou = j.Tipo == TipoDeJogada.Passar;
                if (b.Fase != Motor.FaseDaBatalha.EmAndamento) return;
                if (b.Atual != quem) return;   // saiu do tabuleiro no próprio turno
            }

            Assert.IsTrue(passou,
                "o turno de " + quem + " não terminou em " + Cerebro.TetoDeJogadas + " jogadas");
        }

        /// <summary>
        /// A jogada é legítima AGORA, na opinião do motor?
        ///
        /// O alcance é conferido duas vezes de propósito: <c>PodeConjurar</c>
        /// responde sim/não, e a distância explícita diz POR QUÊ quando a
        /// resposta for não — sem ela, a falha seria "PodeConjurar deu falso" e
        /// alguém teria de reconstruir o tabuleiro na mão para descobrir se foi
        /// alcance, visão, PA ou recarga.
        /// </summary>
        public static void ConferirContraOMotor(Batalha b, Jogada j)
        {
            var u = b.Atual;
            Assert.AreEqual(u.Uid, j.Uid, "a IA decidiu pela unidade errada: " + j);

            if (j.Tipo == TipoDeJogada.Andar)
            {
                Assert.IsTrue(b.Mapa.Andavel(j.Casa), "passo para casa não andável: " + j);
                Assert.IsTrue(b.PodeAndar(j.Casa),
                    "o motor não aceita este passo (PP=" + u.PP + "): " + j);
                return;
            }

            if (j.Tipo != TipoDeJogada.Conjurar) return;

            var f = b.Feitico(j.FeiticoId);
            Assert.IsNotNull(f, "feitiço desconhecido: " + j);
            Assert.IsTrue(u.Feiticos.Contains(f.Id), u + " não sabe " + f.Id);
            Assert.GreaterOrEqual(u.PA, f.CustoDePa,
                f.Id + " custa " + f.CustoDePa + " PA e sobram " + u.PA + ": " + j);

            int d = Distancia.Manhattan(u.Casa, j.Casa);
            int min = f.Alcance == null ? 0 : f.Alcance.Min;
            int max = f.Alcance == null ? 1 : f.Alcance.Max;
            Assert.IsTrue(d >= min && d <= max,
                "mira fora do alcance: " + f.Id + " alcança " + min + "–" + max +
                " e o alvo está a " + d + ". " + j);

            Assert.IsTrue(b.PodeConjurar(j.FeiticoId, j.Casa),
                "o motor não aceita esta conjuração: " + j);
        }

        /// <summary>Distância entre duas unidades, que é o que quase todo teste daqui pergunta.</summary>
        public static int Entre(Motor.Unidade a, Motor.Unidade b)
        {
            return Distancia.Manhattan(a.Casa, b.Casa);
        }

        /// <summary>
        /// <c>IReadOnlyList</c> não tem <c>Contains</c>, e o <c>Assert.Contains</c>
        /// do NUnit compara por <c>object</c> — que, com struct, passa por caixa e
        /// esconde o motivo quando falha.
        /// </summary>
        public static bool Contem(IReadOnlyList<Vector2Int> casas, Vector2Int p)
        {
            for (int i = 0; i < casas.Count; i++) if (casas[i] == p) return true;
            return false;
        }
    }
}
