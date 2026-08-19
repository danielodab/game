using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.Jogo
{
    // Ver a nota de armadilha de nome em AcervoDoJogo.cs.
    using Motor = global::Soterra.Motor;
    using Grade = global::Soterra.Grade;
    using Jogo = global::Soterra.Jogo;

    /// <summary>
    /// O teste de mesa do jogo inteiro: uma batalha completa, herói contra IA,
    /// jogada pelo MESMO caminho que o dedo usa na cena — <c>EscolherFeitico</c>,
    /// <c>TocarCasa</c>, <c>EncerrarTurno</c>, <c>JogadaDoMonstro</c> — do
    /// primeiro turno até o fim.
    ///
    /// O que ele garante é uma coisa só, e é a mais importante da rodada: a
    /// batalha TERMINA. Vitória, derrota ou fúria — nunca laço infinito. É este
    /// teste que separa "o usuário aperta Play e joga" de "o usuário abre uma
    /// cena que trava", e por isso o herói é jogado por uma política BOBA de
    /// propósito: se até um jogador que só anda para perto e solta o primeiro
    /// feitiço válido chega ao fim, nenhum jogador de verdade fica preso.
    /// </summary>
    public class LacoCompletoTests
    {
        /// <summary>
        /// Teto de chamadas do laço externo. A fúria encerra na rodada 40; com
        /// ~8 unidades e o teto de jogadas por turno do Cérebro, o pior caso
        /// honesto fica na casa dos milhares — 20000 só é alcançável se alguém
        /// deixar de gastar recurso, que é exatamente o defeito a denunciar.
        /// </summary>
        const int TetoDeAcoes = 20000;

        [Test]
        public void UmaBatalhaInteira_HeroiContraIA_Termina()
        {
            var banco = AcervoDoJogo.Banco();
            var batalha = AcervoDoJogo.NovaBatalha();
            // Semente FIXA: uma batalha que só falha "às vezes" não se conserta.
            var partida = new Jogo.Partida(banco, batalha, Motor.Sorte.DeTexto("laco-de-mesa"));

            int acoes = 0;
            while (!partida.Acabou && ++acoes < TetoDeAcoes)
            {
                if (partida.TurnoDoJogador) TurnoBobo(partida);
                else partida.JogadaDoMonstro();
            }

            Assert.IsTrue(partida.Acabou,
                          "a batalha não terminou em " + TetoDeAcoes + " ações (rodada " +
                          batalha.Rodada + ", vez de " + (batalha.Atual != null ? batalha.Atual.Uid : "?") +
                          ") — é o laço infinito que travaria o Play");

            Assert.AreNotEqual(Motor.FaseDaBatalha.EmAndamento, batalha.Fase);
            TestContext.WriteLine("fim: " + batalha.Fase + " na rodada " + batalha.Rodada +
                                  ", em " + acoes + " ações");
        }

        // ======================================================= A POLÍTICA BOBA

        /// <summary>
        /// Um turno inteiro do herói, do jeito mais simples que existe: solta o
        /// primeiro feitiço com alvo válido (preferindo casa com inimigo em
        /// cima), senão anda um passo para perto do inimigo mais próximo, senão
        /// encerra. O teto interno é a rede do próprio teste: um turno de herói
        /// que não acaba é tão travante quanto um de monstro.
        /// </summary>
        static void TurnoBobo(Jogo.Partida p)
        {
            var b = p.Batalha;
            var eu = b.Atual;

            for (int acao = 0; acao < 30; acao++)
            {
                if (!p.TurnoDoJogador || b.Atual != eu) return;

                if (Conjurou(p)) continue;
                if (Andou(p)) continue;

                p.EncerrarTurno();
                return;
            }

            if (p.TurnoDoJogador && b.Atual == eu) p.EncerrarTurno();
        }

        static bool Conjurou(Jogo.Partida p)
        {
            var b = p.Batalha;
            var eu = b.Atual;

            for (int i = 0; i < eu.Feiticos.Count; i++)
            {
                var alvos = b.AlvosDe(eu.Feiticos[i]);
                if (alvos.Count == 0) continue;

                // A casa com inimigo em cima quando há uma — um bobo que mira o
                // chão vazio para sempre nunca mataria ninguém, e a batalha
                // terminaria SEMPRE por fúria: o teste deixaria de cobrir a
                // vitória e a derrota.
                var alvo = alvos[0];
                for (int j = 0; j < alvos.Count; j++)
                {
                    var vitima = b.EmCasa(alvos[j]);
                    if (vitima != null && vitima.Lado == Motor.Lado.Monstro) { alvo = alvos[j]; break; }
                }

                p.EscolherFeitico(eu.Feiticos[i]);
                var r = p.TocarCasa(alvo);
                if (r != null && r.Valido) return true;

                // Recusa num alvo que o motor listou é surpresa; desarma a mão
                // (segundo toque no mesmo feitiço) e deixa o passo tentar.
                p.EscolherFeitico(eu.Feiticos[i]);
                return false;
            }
            return false;
        }

        static bool Andou(Jogo.Partida p)
        {
            var b = p.Batalha;
            var eu = b.Atual;

            int agora = DistanciaAoInimigo(b, eu.Casa);
            Vector2Int melhor = eu.Casa;
            int menor = agora;
            foreach (var par in b.AlcanceDePasso())
            {
                int d = DistanciaAoInimigo(b, par.Key);
                if (d < menor) { menor = d; melhor = par.Key; }
            }

            // Só anda se ENCURTA: um bobo que se reposiciona em círculos gasta
            // PP sem mudar nada e o turno vira ruído.
            if (menor >= agora) return false;

            var r = p.TocarCasa(melhor);
            // O passo pode falhar de verdade (teste de fixação) — e aí o PP já
            // foi; devolve falso e o turno encerra pela mão do chamador.
            return r != null && r.Valido;
        }

        static int DistanciaAoInimigo(Motor.Batalha b, Vector2Int casa)
        {
            int menor = int.MaxValue;
            for (int i = 0; i < b.Unidades.Count; i++)
            {
                var u = b.Unidades[i];
                if (!u.NoTabuleiro || u.Lado != Motor.Lado.Monstro) continue;
                int d = Grade.Distancia.Manhattan(casa, u.Casa);
                if (d < menor) menor = d;
            }
            return menor;
        }
    }
}
