using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.Jogo
{
    // ARMADILHA DE NOME, já paga por esta equipe: dentro de `Soterra.Testes.Jogo`,
    // `Motor.X` acha o namespace irmão `Soterra.Testes.Motor` antes de
    // `Soterra.Motor` (CS0234). O mesmo para `Dados`, `Cena`, `Interface`, `IA`
    // e para `Batalha` (namespace × classe). Apelidos globais travam no certo.
    using Motor = global::Soterra.Motor;
    using Dados = global::Soterra.Dados;
    using Montador = global::Soterra.Batalha.Montador;

    /// <summary>
    /// O acervo e a batalha REAIS para os testes do laço de jogo. A mesma
    /// disciplina do cenário da IA: sem o acervo exportado os testes terminam
    /// INCONCLUSIVOS, não verdes — um teste que passa porque o arquivo não
    /// existe afirma que está tudo certo justamente quando não há o que conferir.
    /// </summary>
    static class AcervoDoJogo
    {
        public const string Calabouco = "greenhouse";
        public const int Sala = 0;
        public static readonly string[] Herois = { "sumo", "bruxo" };

        static Dados.BancoDeDados _banco;

        public static Dados.BancoDeDados Banco()
        {
            if (_banco != null) return _banco;

            var caminho = (Application.dataPath + "/Resources/dados/" +
                           Dados.Manifesto.Chave + ".json").Replace('\\', '/');
            if (!File.Exists(caminho))
                Assert.Inconclusive("o acervo ainda não foi exportado: falta " + caminho);

            _banco = Dados.BancoDeDados.CarregarDeResources();
            Assert.IsNotNull(_banco.Manifesto, "o manifesto existe em disco mas o Load não o achou");
            return _banco;
        }

        /// <summary>A batalha que o jogo abre: o Vestíbulo das Heras, com o
        /// tanque e o dano de área — exatamente o que o Play monta.</summary>
        public static Motor.Batalha NovaBatalha()
        {
            return Montador.DeSala(Banco(), Calabouco, Sala, Herois);
        }

        /// <summary>
        /// Passa turnos até a vez de um herói. Encerrar o turno do monstro sem
        /// jogada não mexe no tabuleiro, então o estado continua o de abertura.
        /// A guarda existe porque um laço sem teto num teste que falha trava a
        /// suíte inteira em silêncio.
        /// </summary>
        public static void AteVezDoHeroi(Motor.Batalha b)
        {
            for (int i = 0; i < 50; i++)
            {
                if (b.Fase != Motor.FaseDaBatalha.EmAndamento) break;
                if (b.Atual != null && b.Atual.Lado == Motor.Lado.Heroi) return;
                b.EncerrarTurno();
            }
            Assert.Fail("nenhum herói chegou a jogar em 50 turnos — a fila está quebrada");
        }

        /// <summary>Passa turnos até a vez de um monstro. Ver <see cref="AteVezDoHeroi"/>.</summary>
        public static void AteVezDoMonstro(Motor.Batalha b)
        {
            for (int i = 0; i < 50; i++)
            {
                if (b.Fase != Motor.FaseDaBatalha.EmAndamento) break;
                if (b.Atual != null && b.Atual.Lado == Motor.Lado.Monstro) return;
                b.EncerrarTurno();
            }
            Assert.Fail("nenhum monstro chegou a jogar em 50 turnos — a fila está quebrada");
        }
    }
}
