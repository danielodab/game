using System.Collections.Generic;
using UnityEngine;

namespace Soterra.Grade
{
    /// <summary>O que existe numa casa do tabuleiro.</summary>
    public enum Casa
    {
        Chao,
        ChaoDecorado,
        /// <summary>Bloqueia passagem E visão.</summary>
        ObstaculoAlto,
        /// <summary>Bloqueia passagem, mas NÃO bloqueia visão: é cobertura.</summary>
        ObstaculoBaixo,
        /// <summary>Buraco. Não se anda, e dá para empurrar alguém para dentro.</summary>
        Vazio
    }

    /// <summary>Forma de área de um feitiço ao chegar no alvo.</summary>
    public enum Forma { Single, Circle, Cross, Cone, Line, Ring }

    /// <summary>
    /// Onde um monstro nasce, e de que letra ele veio.
    ///
    /// Carrega a letra junto porque o desenho REPETE letra de propósito: dois
    /// `a` são dois monstros do mesmo tipo, e perder a repetição esvazia a sala.
    /// </summary>
    public struct Nascimento
    {
        public char Letra;
        public Vector2Int Casa;
        public Nascimento(char letra, Vector2Int casa) { Letra = letra; Casa = casa; }
    }

    /// <summary>
    /// O chão de uma sala, lido do desenho em texto.
    ///
    /// O mapa é texto e não estrutura porque é assim que ele existe hoje no jogo
    /// em JS, e porque um retângulo de 27×23 desenhado com `.` e `#` se revisa a
    /// olho nu num diff — coisa que uma matriz de inteiros não permite.
    ///
    /// A distinção que carrega o jogo inteiro está aqui: `#` bloqueia passagem e
    /// visão; `=` bloqueia só passagem. É o que faz posicionamento importar —
    /// atrás do baixo você é atingível mas coberto, atrás do alto ninguém te vê.
    /// </summary>
    public sealed class Mapa
    {
        public int Largura { get; private set; }
        public int Altura { get; private set; }

        readonly Casa[] _casas;
        readonly List<Vector2Int> _heroi = new List<Vector2Int>();
        readonly List<Nascimento> _monstros = new List<Nascimento>();

        /// <summary>
        /// TODAS as casas `P`, em ordem de leitura.
        ///
        /// Lista e não casa única: a sala real traz SEIS `P`, e o jogo desce com
        /// dois heróis. Guardando um só, o segundo herói não teria onde nascer —
        /// e o defeito só apareceria na hora de montar a batalha, longe daqui.
        /// </summary>
        public IReadOnlyList<Vector2Int> NascimentosHeroi { get { return _heroi; } }

        /// <summary>Todas as casas `a`–`z`, em ordem de leitura, com repetição.</summary>
        public IReadOnlyList<Nascimento> NascimentosMonstro { get { return _monstros; } }

        Mapa(int largura, int altura)
        {
            Largura = largura;
            Altura = altura;
            _casas = new Casa[largura * altura];
        }

        /// <summary>
        /// Lê o desenho. A linha 0 do texto é a linha de CIMA do desenho, e vira
        /// o Y mais ALTO — senão o mapa sai espelhado na vertical em relação ao
        /// que a pessoa desenhou, e todo teste escrito a olho mentiria.
        ///
        /// Linhas curtas são completadas com vazio em vez de dar erro: desenho
        /// feito à mão quase sempre perde o espaço do fim da linha, e recusar o
        /// mapa por isso só treina a pessoa a encher de espaço invisível.
        /// </summary>
        public static Mapa DeTexto(string[] linhas)
        {
            if (linhas == null || linhas.Length == 0)
                throw new System.ArgumentException("mapa vazio", "linhas");

            int altura = linhas.Length;
            int largura = 0;
            for (int i = 0; i < altura; i++)
                if (linhas[i] != null && linhas[i].Length > largura) largura = linhas[i].Length;
            if (largura == 0) throw new System.ArgumentException("mapa sem colunas", "linhas");

            var m = new Mapa(largura, altura);
            for (int i = 0; i < altura; i++)
            {
                var linha = linhas[i] ?? string.Empty;
                int y = altura - 1 - i;
                for (int x = 0; x < largura; x++)
                {
                    char c = x < linha.Length ? linha[x] : '~';
                    m._casas[y * largura + x] = DoSimbolo(c);

                    if (c == 'P') m._heroi.Add(new Vector2Int(x, y));
                    else if (c >= 'a' && c <= 'z') m._monstros.Add(new Nascimento(c, new Vector2Int(x, y)));
                }
            }
            // Ordem de leitura do DESENHO (de cima para baixo, esquerda para a
            // direita), e não a ordem em que o laço encheu a lista: quem escreve
            // a sala espera que o primeiro `P` do texto seja o primeiro herói.
            m._heroi.Sort(PorLeitura);
            m._monstros.Sort((a, b) => PorLeitura(a.Casa, b.Casa));
            return m;
        }

        static int PorLeitura(Vector2Int a, Vector2Int b)
        {
            if (a.y != b.y) return b.y.CompareTo(a.y);   // Y maior = linha de cima
            return a.x.CompareTo(b.x);
        }

        /// <summary>
        /// Símbolo → casa. Nascimentos (`P` e `a`–`z`) são CHÃO: são onde alguém
        /// aparece, não um tipo de piso. Tratar nascimento como casa especial
        /// faria a unidade nascer presa dentro de si mesma.
        /// </summary>
        static Casa DoSimbolo(char c)
        {
            switch (c)
            {
                case '#': return Casa.ObstaculoAlto;
                case '=': return Casa.ObstaculoBaixo;
                case '~': return Casa.Vazio;
                case ',': return Casa.ChaoDecorado;
                default:  return Casa.Chao;
            }
        }

        public bool Dentro(Vector2Int p)
        {
            return p.x >= 0 && p.y >= 0 && p.x < Largura && p.y < Altura;
        }

        public Casa Em(Vector2Int p)
        {
            if (!Dentro(p)) return Casa.Vazio;
            return _casas[p.y * Largura + p.x];
        }

        public bool Andavel(Vector2Int p)
        {
            var c = Em(p);
            return Dentro(p) && (c == Casa.Chao || c == Casa.ChaoDecorado);
        }

        /// <summary>Só o obstáculo ALTO corta a linha de visão.</summary>
        public bool BloqueiaVisao(Vector2Int p)
        {
            return Em(p) == Casa.ObstaculoAlto;
        }
    }
}
