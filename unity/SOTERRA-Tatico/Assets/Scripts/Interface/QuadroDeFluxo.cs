using System.Collections.Generic;

namespace Soterra.Interface
{
    /// <summary>Qual das telas de fluxo desenhar. <c>Nenhum</c> esconde tudo — é
    /// o estado normal, com a batalha em pé.</summary>
    public enum TipoDeFluxo
    {
        Nenhum,
        Recompensa,
        EscolhaDeElemento,
        CalaboucoConcluido,
        Derrota
    }

    /// <summary>O que um herói levou da sala. Todo número vem da
    /// <c>Progressao.Recompensa</c> — a tela não calcula XP.</summary>
    public sealed class GanhoNaTela
    {
        public string HeroiId;
        public string Nome;

        /// <summary>XP que ESTE herói recebeu, já com o corte por nível.</summary>
        public int Xp;

        public int Nivel;

        /// <summary>Quantos níveis subiu nesta sala. Zero na maioria delas.</summary>
        public int NiveisSubidos;

        /// <summary>Fração do degrau atual, de 0 a 1, para a barra.</summary>
        public double Fracao;

        /// <summary>
        /// O multiplicador de §9-D. Só aparece na tela quando é MENOR que 1 —
        /// "você está alto demais para este calabouço" é informação; "×1" é
        /// ruído em toda sala do jogo.
        /// </summary>
        public double Multiplicador;
    }

    /// <summary>Uma linha do saque: peça, pedra, carta ou bicho.</summary>
    public sealed class PremioNaTela
    {
        public string Id;
        public string Nome;

        /// <summary>item, pedra, carta ou bicho — vira a classe USS da linha.</summary>
        public string Especie;

        /// <summary>"×3", "épico", "nova classe" — o que qualifica o prêmio.</summary>
        public string Detalhe;

        /// <summary>Cor em hex do acervo, ou vazio. Nunca inventada aqui.</summary>
        public string Cor;
    }

    /// <summary>Um dos caminhos elementais oferecidos no nível da escolha.</summary>
    public sealed class OpcaoDeElemento
    {
        public string Id;
        public string Nome;
        public string Cor;
        public string Descricao;
    }

    /// <summary>
    /// Tudo o que a tela de fluxo desenha, num objeto sem comportamento — a
    /// mesma disciplina do <see cref="QuadroDaBatalha"/>: a tela recebe um
    /// quadro por repintura e desenha o que veio, sem opinião própria sobre
    /// regra nenhuma.
    /// </summary>
    public sealed class QuadroDeFluxo
    {
        public TipoDeFluxo Tipo;

        public string Titulo;
        public string Subtitulo;
        public string Texto;

        /// <summary>Texto do botão que fecha a tela ("Descer", "Tentar de novo").</summary>
        public string RotuloDoBotao;

        public List<GanhoNaTela> Ganhos;
        public List<PremioNaTela> Premios;

        /// <summary>Herói que deve a escolha de elemento. Nulo fora dessa tela.</summary>
        public string HeroiDaEscolha;

        public List<OpcaoDeElemento> Elementos;

        public QuadroDeFluxo()
        {
            Ganhos = new List<GanhoNaTela>();
            Premios = new List<PremioNaTela>();
            Elementos = new List<OpcaoDeElemento>();
        }
    }
}
