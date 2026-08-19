using System.Collections.Generic;

namespace Soterra.Interface
{
    /// <summary>Lado a que a unidade pertence, do ponto de vista da tela.</summary>
    public enum LadoNaTela
    {
        Heroi,
        Monstro
    }

    /// <summary>
    /// O que a tela precisa saber de uma unidade. NADA além disso.
    ///
    /// Existe em vez de a interface ler <c>Soterra.Motor.Unidade</c> direto
    /// porque a tela tem de poder ser montada e testada sem o motor existir —
    /// e nesta rodada o motor está sendo escrito em paralelo, noutra árvore.
    /// A tradução mora num arquivo só (<c>PonteDoMotor</c>), que é o único que
    /// quebra quando a assinatura do motor mudar.
    /// </summary>
    public sealed class UnidadeNaTela
    {
        public string Uid;

        /// <summary>Nome visível — "Bárbaro", "Flora Voraz". Nunca o id cru.</summary>
        public string Nome;

        public LadoNaTela Lado;
        public int Pv, PvMax, Pa, PaMax, Pp, PpMax;
        public string Elemento;
        public bool Viva;

        /// <summary>Fração de vida, de 0 a 1. Blindada contra <c>PvMax</c> zero.</summary>
        public float FracaoDePv
        {
            get { return PvMax > 0 ? UnityEngine.Mathf.Clamp01((float)Pv / PvMax) : 0f; }
        }
    }

    /// <summary>
    /// Um feitiço como a barra o desenha. Todo número aqui vem do acervo
    /// (<c>Assets/Resources/dados/spells.json</c>) — nenhum é calculado pela
    /// interface, que não tem autoridade nenhuma sobre regra de jogo.
    /// </summary>
    public sealed class FeiticoNaTela
    {
        public string Id;
        public string Nome;

        /// <summary><c>paCost</c> no acervo.</summary>
        public int CustoDePa;

        /// <summary><c>cooldown</c> no acervo: as rodadas que ele fica frio DEPOIS de lançado.</summary>
        public int Recarga;

        /// <summary>
        /// Rodadas que ainda faltam para poder lançar de novo. Separado de
        /// <see cref="Recarga"/> de propósito: o jogador precisa dos dois na
        /// tela — "custa 4 rodadas" e "faltam 2" são perguntas diferentes, e
        /// mostrar só a segunda esconde o preço do feitiço.
        /// </summary>
        public int RecargaRestante;

        public string Elemento;
        public string Descricao;
        public int AlcanceMin, AlcanceMax;

        /// <summary>Forma da área, como o acervo escreve: single, circle, cross…</summary>
        public string Forma;
        public int TamanhoDaArea;

        /// <summary>Dá para lançar agora, com o PA que a unidade tem na mão.</summary>
        public bool PodeLancar(int paDisponivel)
        {
            return RecargaRestante <= 0 && paDisponivel >= CustoDePa;
        }
    }

    /// <summary>
    /// Tudo o que a tela de batalha desenha, num objeto só e sem comportamento.
    ///
    /// Um quadro por repintura, montado de fora: a tela não guarda estado de
    /// jogo, e por isso não tem como discordar do motor. Foi assim que o hud.js
    /// resolveu o mesmo problema (repintura por assinatura, [U2] lá).
    /// </summary>
    public sealed class QuadroDaBatalha
    {
        public int Rodada;

        /// <summary>Nome visível do clima da sala. Vazio quando não há clima.</summary>
        public string Clima;

        /// <summary>De quem é o turno. <c>null</c> antes de a batalha começar.</summary>
        public UnidadeNaTela Atual;

        /// <summary>
        /// Ordem de iniciativa JÁ girada: a primeira da lista é quem joga agora.
        /// Girada aqui e não na tela porque quem sabe onde a volta começa é o
        /// motor, não o desenho.
        /// </summary>
        public List<UnidadeNaTela> Ordem;

        /// <summary>A barra de feitiços da unidade atual, na ordem do acervo.</summary>
        public List<FeiticoNaTela> Feiticos;

        /// <summary>Id do feitiço escolhido, ou <c>null</c>.</summary>
        public string FeiticoEscolhido;

        /// <summary>
        /// Se o jogador comanda a unidade atual. Com <c>false</c> a barra
        /// aparece apagada e o botão de encerrar turno desliga — sem isso o
        /// jogador toca no turno do monstro e não entende por que nada acontece.
        /// </summary>
        public bool ETurnoDoJogador;

        /// <summary>
        /// Nome e cor de cada elemento, direto de <c>elementInfo.json</c>.
        ///
        /// Vem no quadro em vez de a tela consultar o acervo porque tradução e
        /// paleta são DADO, e uma tabela "fogo → Fogo, laranja" escrita dentro
        /// da interface é a definição de número inventado. Nulo é tolerado: sem
        /// a tabela a tela mostra o id cru, que é feio mas não é mentira.
        /// </summary>
        public IDictionary<string, Soterra.Dados.InfoDeElemento> Elementos;

        public QuadroDaBatalha()
        {
            Ordem = new List<UnidadeNaTela>();
            Feiticos = new List<FeiticoNaTela>();
        }
    }
}
