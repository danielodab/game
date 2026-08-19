using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.Jogo
{
    // Ver a nota de armadilha de nome em AcervoDoJogo.cs.
    using Motor = global::Soterra.Motor;
    using Grade = global::Soterra.Grade;
    using Jogo = global::Soterra.Jogo;

    /// <summary>
    /// O jogador de mesa: solta o primeiro feitiço com alvo válido (preferindo
    /// casa com inimigo em cima), senão anda um passo para perto do inimigo
    /// mais próximo, senão encerra o turno.
    ///
    /// Boba DE PROPÓSITO. Se até um jogador que só faz isso chega ao fim da
    /// batalha, nenhum jogador de verdade fica preso — é essa a garantia que os
    /// testes de mesa compram, e ela só vale se a política for ruim.
    ///
    /// Mora num arquivo próprio porque DOIS testes de mesa a usam: o laço de
    /// uma batalha (<c>LacoCompletoTests</c>) e a descida do calabouço inteiro
    /// (<c>DescidaDoJogoTests</c>). Duas cópias divergiriam, e a que
    /// envelhecesse continuaria passando — provando outra coisa.
    ///
    /// Tudo passa pelos MESMOS métodos que o dedo usa na cena
    /// (<c>EscolherFeitico</c>, <c>TocarCasa</c>, <c>EncerrarTurno</c>,
    /// <c>JogadaDoMonstro</c>): um teste que chamasse o motor direto provaria o
    /// motor, que já está provado, e não o caminho jogável.
    /// </summary>
    static class PoliticaBoba
    {
        /// <summary>
        /// Teto de chamadas do laço externo. A fúria encerra na rodada 40; com
        /// ~8 unidades e o teto de jogadas por turno do Cérebro, o pior caso
        /// honesto fica na casa dos milhares — 20000 só é alcançável se alguém
        /// deixar de gastar recurso, que é exatamente o defeito a denunciar.
        /// </summary>
        public const int TetoDeAcoes = 20000;

        /// <summary>
        /// Joga a batalha inteira até ela acabar. Devolve quantas ações levou;
        /// falha o teste se o teto estourar — é o laço infinito que travaria o
        /// Play.
        /// </summary>
        public static int JogarAteAcabar(Jogo.Partida partida)
        {
            int acoes = 0;
            while (!partida.Acabou && ++acoes < TetoDeAcoes)
            {
                if (partida.TurnoDoJogador) Turno(partida);
                else partida.JogadaDoMonstro();
            }

            var b = partida.Batalha;
            Assert.IsTrue(partida.Acabou,
                          "a batalha não terminou em " + TetoDeAcoes + " ações (rodada " +
                          b.Rodada + ", vez de " + (b.Atual != null ? b.Atual.Uid : "?") +
                          ") — é o laço infinito que travaria o Play");
            return acoes;
        }

        /// <summary>
        /// Um turno inteiro do herói. O teto interno é a rede do próprio teste:
        /// um turno de herói que não acaba é tão travante quanto um de monstro.
        /// </summary>
        public static void Turno(Jogo.Partida p)
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

        /// <summary>
        /// Solta um feitiço. DUAS passadas, e a ordem delas é a diferença entre
        /// um teste que prova alguma coisa e um que não prova nada:
        ///
        /// 1. o primeiro feitiço que alcança um INIMIGO;
        /// 2. só na falta desse, o primeiro com qualquer alvo válido.
        ///
        /// Sem a passada 1, um herói de suporte gasta o turno inteiro se curando
        /// — a lista de feitiços dele começa pela cura, e a cura sempre tem alvo
        /// válido. A batalha então nunca termina por vitória: vai até a fúria da
        /// rodada 40, que o motor conta como DERROTA. Foi exatamente o que
        /// aconteceu quando a Paladina entrou no grupo, e o sintoma era "a dupla
        /// de nível 14 perde o vestíbulo".
        ///
        /// Continua boba: não escolhe o melhor feitiço, não poupa PA, não pensa
        /// em área. Só deixou de ser SUICIDA.
        /// </summary>
        static bool Conjurou(Jogo.Partida p)
        {
            if (Tentou(p, true)) return true;
            return Tentou(p, false);
        }

        static bool Tentou(Jogo.Partida p, bool exigeInimigo)
        {
            var b = p.Batalha;
            var eu = b.Atual;

            for (int i = 0; i < eu.Feiticos.Count; i++)
            {
                var alvos = b.AlvosDe(eu.Feiticos[i]);
                if (alvos.Count == 0) continue;

                // A casa com inimigo em cima quando há uma — um bobo que mira o
                // chão vazio para sempre nunca mataria ninguém.
                var alvo = alvos[0];
                bool achouInimigo = false;
                for (int j = 0; j < alvos.Count; j++)
                {
                    var vitima = b.EmCasa(alvos[j]);
                    if (vitima != null && vitima.Lado == Motor.Lado.Monstro)
                    {
                        alvo = alvos[j];
                        achouInimigo = true;
                        break;
                    }
                }
                if (exigeInimigo && !achouInimigo) continue;

                p.EscolherFeitico(eu.Feiticos[i]);
                var r = p.TocarCasa(alvo);
                if (r != null && r.Valido) return true;

                // Recusado: desarma a mão (segundo toque no mesmo feitiço) e
                // tenta o PRÓXIMO feitiço, em vez de desistir do turno.
                // `AlvosDe` responde por alcance e visão, não por PA nem por
                // recarga — a recusa mais comum aqui é "não tem PA para ESTE",
                // e abandonar o turno por causa dela deixaria PA de sobra na
                // mão em todo turno de todo herói.
                p.EscolherFeitico(eu.Feiticos[i]);
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
