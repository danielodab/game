using UnityEngine;

namespace Soterra.IA
{
    /// <summary>O que a IA resolveu fazer AGORA. São três, e não há um quarto.</summary>
    public enum TipoDeJogada
    {
        Andar,
        Conjurar,

        /// <summary>Encerrar o turno. É jogada e não ausência de jogada — ver <see cref="Jogada"/>.</summary>
        Passar
    }

    /// <summary>
    /// UMA decisão de UM turno.
    ///
    /// Uma jogada por vez, e não o plano inteiro do <c>AI.planTurn</c> do
    /// <c>js/core/ai.js</c>: lá o plano sai pronto (<c>move</c>, <c>cast</c>,
    /// <c>cast</c>, <c>end</c>) e o Game o executa em fila. O problema é que o
    /// plano é escrito ANTES do primeiro passo, e o primeiro passo pode falhar —
    /// o teste de fixação do motor cancela o movimento e zera o PP. Dali para
    /// frente o plano do JS conjura a partir de uma casa em que a unidade nunca
    /// chegou, e a engine recusa cada conjuração em silêncio: o monstro perde o
    /// turno inteiro sem que nada no log diga por quê.
    ///
    /// Decidindo uma jogada de cada vez, cada recusa é reavaliada com o
    /// tabuleiro como ele ficou. Custa reavaliar; paga em não mentir.
    ///
    /// <see cref="TipoDeJogada.Passar"/> é uma jogada de verdade e não
    /// <c>null</c>: quem consome isto precisa distinguir "a IA resolveu parar"
    /// de "a IA não respondeu", e <c>null</c> mistura as duas.
    /// </summary>
    public sealed class Jogada
    {
        public TipoDeJogada Tipo;

        /// <summary>De quem é a jogada. Sempre o <c>Atual</c> da batalha.</summary>
        public string Uid;

        /// <summary>Destino do passo, ou casa-alvo do feitiço. Ignorado em <c>Passar</c>.</summary>
        public Vector2Int Casa;

        /// <summary>Só em <c>Conjurar</c>.</summary>
        public string FeiticoId;

        /// <summary>
        /// A nota que ganhou a escolha.
        ///
        /// Existe para o relato de defeito: "por que o Bufo andou para trás?" só
        /// tem resposta se a nota da casa escolhida puder ser comparada com a das
        /// outras. Sem isto, toda discussão sobre a IA vira opinião.
        /// </summary>
        public double Valor;

        /// <summary>Por que, em português — é o que entra no log da batalha.</summary>
        public string Motivo;

        public override string ToString()
        {
            switch (Tipo)
            {
                case TipoDeJogada.Andar:
                    return Uid + " anda para " + Casa + " (" + Motivo + ")";
                case TipoDeJogada.Conjurar:
                    return Uid + " conjura " + FeiticoId + " em " + Casa + " (" + Motivo + ")";
                default:
                    return Uid + " passa o turno (" + Motivo + ")";
            }
        }
    }
}
