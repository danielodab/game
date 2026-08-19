using System;
using System.Collections.Generic;
using UnityEngine;

namespace Soterra.Jogo
{
    // ARMADILHA DE NOME (CONTRATO_UNITY_F1 §3, já paga): de dentro de
    // `Soterra.Jogo`, escrever `Motor.Batalha` acharia um namespace irmão antes
    // de `Soterra.Motor` e falharia com CS0234. O mesmo vale para `Batalha`
    // (namespace × classe) e, nos testes, para `Interface` e `Cena`. Os
    // apelidos globais travam nos alvos certos.
    using Motor = global::Soterra.Motor;
    using Dados = global::Soterra.Dados;
    using IA = global::Soterra.IA;
    using Interface = global::Soterra.Interface;

    /// <summary>
    /// O regente da batalha jogável: traduz o gesto do jogador (tocar numa
    /// casa, tocar num feitiço, encerrar o turno) em chamadas ao motor, e joga
    /// o turno do monstro pelo <see cref="IA.Cerebro"/>, uma jogada por vez.
    ///
    /// C# PURO, sem <c>MonoBehaviour</c>, de propósito: é o que deixa o laço
    /// inteiro — herói contra IA, do primeiro toque à vitória ou à fúria — ser
    /// provado num teste EditMode, sem cena e sem Play. O teste que garante que
    /// a batalha TERMINA roda em cima desta classe; se o laço morasse no
    /// componente da cena, "o jogo trava?" só se responderia apertando Play.
    ///
    /// A Partida não desenha e não guarda nada que o motor já saiba. O único
    /// estado próprio é o feitiço na mão do jogador e os contadores de rede do
    /// turno do monstro — todo o resto é pergunta repassada.
    /// </summary>
    public sealed class Partida
    {
        readonly Dados.BancoDeDados _banco;
        readonly Motor.Batalha _batalha;
        readonly IA.Cerebro _cerebro;

        string _feiticoEscolhido;

        // A rede do turno do monstro: de quem era a vez na última jogada, em
        // que rodada, quantas jogadas e quantas recusas seguidas. É a mesma
        // disciplina do `Cerebro.JogarTurno`, refeita aqui porque a cena joga o
        // monstro em PARCELAS (uma jogada por pausa, para dar leitura) e o
        // teto de jogadas não pode morar só dentro de um método que joga o
        // turno inteiro de uma vez.
        Motor.Unidade _quemJoga;
        int _rodadaDoTurno;
        int _jogadasDoTurno;
        int _recusasSeguidas;

        public Partida(Dados.BancoDeDados banco, Motor.Batalha batalha, Motor.Sorte sorteDaIa = null)
        {
            if (banco == null) throw new ArgumentNullException("banco");
            if (batalha == null) throw new ArgumentNullException("batalha");
            _banco = banco;
            _batalha = batalha;
            _cerebro = new IA.Cerebro(banco, batalha, sorteDaIa);
        }

        public Motor.Batalha Batalha { get { return _batalha; } }

        /// <summary>O feitiço na mão do jogador, ou nulo. É o único estado de
        /// interface que a Partida guarda.</summary>
        public string FeiticoEscolhido { get { return _feiticoEscolhido; } }

        public bool Acabou { get { return _batalha.Fase != Motor.FaseDaBatalha.EmAndamento; } }

        /// <summary>É a vez de uma unidade que o DEDO comanda?</summary>
        public bool TurnoDoJogador
        {
            get
            {
                if (Acabou) return false;
                var u = _batalha.Atual;
                return u != null && u.NoTabuleiro && u.Lado == Motor.Lado.Heroi;
            }
        }

        // ================================================================ HERÓI

        /// <summary>
        /// O toque numa casa do tabuleiro. Com feitiço na mão, conjura; sem,
        /// anda. Devolve o <see cref="Motor.Resultado"/> do motor — inclusive a
        /// RECUSA, com o motivo em português, porque o silêncio diante de um
        /// clique que não faz nada foi um defeito real da linha JS e o motor
        /// escreveu as mensagens justamente para a tela mostrá-las.
        ///
        /// Nulo quando o toque não é uma jogada: turno do monstro, batalha
        /// encerrada, ou toque na própria casa.
        /// </summary>
        public Motor.Resultado TocarCasa(Vector2Int casa)
        {
            if (!TurnoDoJogador) return null;

            if (_feiticoEscolhido != null)
            {
                var r = _batalha.Conjurar(_feiticoEscolhido, casa);
                // Só o lançamento ACEITO esvazia a mão. Na recusa (fora do
                // alcance, sem visão) o feitiço fica escolhido: um dedo que
                // errou a casa por um ponto não deveria ter de reabrir a barra.
                if (r.Valido) _feiticoEscolhido = null;
                return r;
            }

            // Tocar na própria casa não é jogada — é o jeito natural de o dedo
            // "soltar" sem consequência.
            if (casa == _batalha.Atual.Casa) return null;
            return _batalha.Andar(casa);
        }

        /// <summary>
        /// Escolhe (ou desarma, no segundo toque) o feitiço da barra. A
        /// validade fica com o motor na hora do lançamento: a barra já só emite
        /// feitiço lançável, e revalidar aqui criaria uma segunda regra.
        /// </summary>
        public void EscolherFeitico(string id)
        {
            if (!TurnoDoJogador || string.IsNullOrEmpty(id)) return;
            _feiticoEscolhido = id == _feiticoEscolhido ? null : id;
        }

        /// <summary>Encerra o turno do herói. Limpa a mão: o feitiço escolhido
        /// era da unidade que jogava, não da próxima.</summary>
        public Motor.Resultado EncerrarTurno()
        {
            if (!TurnoDoJogador) return null;
            _feiticoEscolhido = null;
            return _batalha.EncerrarTurno();
        }

        /// <summary>
        /// O toque em "Fundir": declara a fusão da unidade da vez com o
        /// PRIMEIRO candidato que o motor lista. O grupo desce com DOIS heróis,
        /// então há no máximo um candidato — quando o grupo crescer, escolher o
        /// par vai precisar de tela própria, e aí esta linha é o lugar que
        /// quebra. Nulo quando não é jogada (turno do monstro, ninguém colado);
        /// a RECUSA do motor (sem PA, pendência já declarada) volta inteira,
        /// com o motivo em português para a ficha do topo.
        /// </summary>
        public Motor.Resultado DeclararFusao()
        {
            if (!TurnoDoJogador) return null;
            var candidatos = _batalha.CandidatosAFusao(_batalha.Atual.Uid);
            if (candidatos.Count == 0) return null;
            return _batalha.DeclararFusao(_batalha.Atual.Uid, candidatos[0]);
        }

        /// <summary>
        /// O toque em "Cancelar fusão". Os 2 PA NÃO voltam — regra do motor
        /// (<c>Fusion.cancel</c> do JS), não desta classe; o aviso é da tela.
        /// </summary>
        public Motor.Resultado CancelarFusao()
        {
            if (!TurnoDoJogador) return null;
            return _batalha.CancelarFusao();
        }

        // ============================================================== MONSTRO

        /// <summary>
        /// UMA jogada do monstro da vez — a cena chama isto com uma pausa entre
        /// chamadas para o jogador conseguir ler o turno inimigo. Nulo fora do
        /// turno do monstro.
        ///
        /// A rede de segurança é dupla e explícita: duas recusas seguidas do
        /// motor, ou o teto de jogadas do <see cref="IA.Cerebro"/>, encerram o
        /// turno à força. Sem ela, uma IA que propusesse jogada inválida para
        /// sempre penduraria a batalha — e o sintoma seria "o jogo travou no
        /// turno do bicho", longe da causa.
        /// </summary>
        public Motor.Resultado JogadaDoMonstro()
        {
            if (Acabou) return null;
            var eu = _batalha.Atual;
            if (eu == null || eu.Lado != Motor.Lado.Monstro) return null;

            if (eu != _quemJoga || _rodadaDoTurno != _batalha.Rodada)
            {
                _quemJoga = eu;
                _rodadaDoTurno = _batalha.Rodada;
                _jogadasDoTurno = 0;
                _recusasSeguidas = 0;
            }

            _jogadasDoTurno++;
            if (_jogadasDoTurno > IA.Cerebro.TetoDeJogadas || _recusasSeguidas >= 2)
                return _batalha.EncerrarTurno();

            var jogada = _cerebro.Decidir();
            var r = _cerebro.Executar(jogada);

            // A recusa de um passo é normal (o teste de fixação cancela e zera
            // o PP); duas seguidas significam que a IA insiste no que o motor
            // não aceita — e aí a rede acima corta na próxima chamada.
            if (jogada.Tipo != IA.TipoDeJogada.Passar)
                _recusasSeguidas = r.Valido ? 0 : _recusasSeguidas + 1;

            return r;
        }

        // ================================================================= TELA

        /// <summary>O quadro que o HUD desenha agora. As recargas vêm da
        /// própria unidade da vez — o motor as guarda por feitiço.</summary>
        public Interface.QuadroDaBatalha Quadro()
        {
            var atual = _batalha.Atual;
            return Interface.PonteDoMotor.Quadro(_batalha, _banco, _feiticoEscolhido,
                                                 atual != null ? atual.Recargas : null);
        }
    }
}
