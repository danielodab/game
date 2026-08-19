using System;
using System.Collections.Generic;
using Soterra.Dados;

namespace Soterra.Progressao
{
    /// <summary>Onde a descida está. É o que a tela lê para saber o que desenhar.</summary>
    public enum EstadoDaDescida
    {
        /// <summary>A batalha da sala corrente está em pé.</summary>
        EmSala,

        /// <summary>Sala vencida e ainda há sala adiante — a tela de recompensa.</summary>
        SalaVencida,

        /// <summary>O chefe caiu. A descida acabou em vitória.</summary>
        CalaboucoConcluido,

        /// <summary>O grupo tombou. A descida acabou.</summary>
        Derrota
    }

    /// <summary>Quanto o herói subiu de nível nesta sala.</summary>
    public struct SubidaDeNivel
    {
        public string IdDoHeroi;
        public int Niveis;
        public int NovoNivel;
    }

    /// <summary>O que a sala pagou. É isto que a tela de fim de sala mostra.</summary>
    public sealed class Recompensa
    {
        /// <summary>XP da sala JÁ dividida pelo grupo e ANTES do corte por nível.</summary>
        public int XpDaSala;

        /// <summary>Multiplicador de §9-D aplicado a cada herói.</summary>
        public Dictionary<string, double> MultiplicadorDeXp = new Dictionary<string, double>();

        /// <summary>O que cada herói de fato recebeu.</summary>
        public Dictionary<string, int> XpPorHeroi = new Dictionary<string, int>();

        public List<SubidaDeNivel> Subidas = new List<SubidaDeNivel>();
        public List<string> Itens = new List<string>();
        public Dictionary<string, int> Pedras = new Dictionary<string, int>();

        /// <summary>Carta do chefe, ou <c>null</c>. Uma por sala, no máximo.</summary>
        public InfoDeCarta Carta;

        public string Bicho;

        /// <summary>Heróis que chegaram ao nível da escolha e ainda são neutros.</summary>
        public List<string> EscolhasDeElemento = new List<string>();
    }

    /// <summary>
    /// Uma descida: o calabouço sala a sala, do vestíbulo ao chefe.
    ///
    /// É o laço que faltava. Sem ele joga-se UMA sala e acaba: não há próxima
    /// sala, não há chefe, e a XP que a batalha gerou não vai para lugar nenhum.
    ///
    /// A descida não CONSTRÓI a batalha, de propósito. Quem monta a sala é
    /// <c>Soterra.Batalha.Montador</c>, de outro dono, e o construtor de
    /// <c>Motor.Batalha</c> já ordena a fila e começa o primeiro turno — a ficha
    /// do herói precisa estar pronta ANTES disso (ver
    /// <c>Progresso.NovaUnidade</c>). O que a descida faz é o resto: saber em
    /// que sala se está, quando o chefe chega, quanto a sala pagou e com quanto
    /// de vida cada herói entra na seguinte.
    /// </summary>
    public sealed class Descida
    {
        /// <summary>
        /// Cura entre salas: o herói VIVO recupera metade do que perdeu.
        ///
        /// Não sai de JSON nenhum — é a regra de <c>js/core/game.js</c> [G1], a
        /// fonte da verdade enquanto o acervo não a escrever. Sem cura, a
        /// terceira sala seria decidida na primeira; com cura cheia, apanhar não
        /// custaria nada.
        /// </summary>
        public const double FracaoDeCuraEntreSalas = 0.5;

        /// <summary>
        /// O herói MORTO volta com esta fração da vida cheia (game.js [G1]).
        /// Sem revive, uma morte cedo condenaria a descida inteira e o jogador
        /// reiniciaria em vez de jogar.
        /// </summary>
        public const double FracaoDeReviverEntreSalas = 0.3;

        /// <summary>Grupo de 1 ou 2 heróis (SISTEMAS §9-B / game.js [G8]).</summary>
        public const int TamanhoMaximoDoGrupo = 2;

        readonly Progresso _progresso;
        readonly Calabouco _calabouco;
        readonly List<string> _grupo;

        /// <summary>PV de cada herói ao fim da última sala. 0 = tombou.</summary>
        readonly Dictionary<string, int> _pvAoFim = new Dictionary<string, int>();

        Descida(Progresso progresso, Calabouco calabouco, List<string> grupo)
        {
            _progresso = progresso;
            _calabouco = calabouco;
            _grupo = grupo;
            IndiceDaSala = 0;
            Estado = EstadoDaDescida.EmSala;
        }

        public string IdDoCalabouco { get { return _calabouco.Id; } }

        /// <summary>A ficha do calabouço no acervo — nome, tema, paleta, clima padrão.</summary>
        public Calabouco DadosDoCalabouco { get { return _calabouco; } }

        public int IndiceDaSala { get; private set; }
        public EstadoDaDescida Estado { get; private set; }
        public IList<string> Grupo { get { return _grupo.AsReadOnly(); } }
        public int TotalDeSalas { get { return _calabouco.Salas == null ? 0 : _calabouco.Salas.Count; } }

        public Sala SalaAtual
        {
            get
            {
                if (_calabouco.Salas == null || IndiceDaSala >= _calabouco.Salas.Count) return null;
                return _calabouco.Salas[IndiceDaSala];
            }
        }

        /// <summary>A última sala do calabouço é sempre a do chefe.</summary>
        public bool EhSalaDoChefe { get { return Saque.EhSalaDoChefe(_calabouco, IndiceDaSala); } }

        public bool Terminou
        {
            get
            {
                return Estado == EstadoDaDescida.CalaboucoConcluido ||
                       Estado == EstadoDaDescida.Derrota;
            }
        }

        /// <summary>
        /// Abre uma descida. Devolve <c>null</c> quando o calabouço não existe ou
        /// o grupo não serve — 3 heróis, id repetido ou herói que não tem ficha.
        ///
        /// Recusar aqui e não na montagem da sala é o ponto: um grupo inválido
        /// que chegasse ao <c>Montador</c> só falharia depois de a tela de
        /// batalha já ter aberto.
        /// </summary>
        public static Descida Comecar(Progresso progresso, string calabocoId, IList<string> grupo)
        {
            if (progresso == null) throw new ArgumentNullException("progresso");
            var calabouco = progresso.Banco.AchaCalabouco(calabocoId);
            if (calabouco == null || calabouco.Salas == null || calabouco.Salas.Count == 0) return null;
            if (grupo == null || grupo.Count < 1 || grupo.Count > TamanhoMaximoDoGrupo) return null;

            var limpo = new List<string>();
            foreach (var id in grupo)
            {
                if (string.IsNullOrEmpty(id) || limpo.Contains(id)) return null;
                if (progresso.Heroi(id) == null) return null;
                limpo.Add(id);
            }
            return new Descida(progresso, calabouco, limpo);
        }

        /// <summary>
        /// Com quanto de vida o herói entra na sala corrente.
        ///
        /// Na primeira sala, cheio. Depois disso: quem terminou vivo recupera
        /// metade do que perdeu, e quem tombou volta com uma fração da vida
        /// cheia — nunca com zero, que seria o mesmo que não voltar.
        /// </summary>
        public int PvDeEntrada(string heroiId, int pvMaximo)
        {
            int anterior;
            if (pvMaximo <= 0) return 1;
            if (!_pvAoFim.TryGetValue(heroiId ?? string.Empty, out anterior)) return pvMaximo;

            if (anterior > 0)
            {
                var curado = anterior +
                    Progresso.ArredondaComoNoJs((pvMaximo - anterior) * FracaoDeCuraEntreSalas);
                return Math.Max(1, Math.Min(pvMaximo, curado));
            }
            return Math.Max(1, Progresso.ArredondaComoNoJs(pvMaximo * FracaoDeReviverEntreSalas));
        }

        /// <summary>
        /// A sala foi vencida: recolhe a recompensa, registra a vida para a
        /// próxima e move o estado.
        ///
        /// Os heróis da batalha são casados com o grupo pela ORDEM DE NASCIMENTO
        /// — o <c>Montador</c> faz nascer os heróis primeiro, na ordem em que as
        /// classes chegaram. Casar pelo <c>ClasseOuMonstroId</c> pareceria mais
        /// seguro e não é: dois heróis da mesma classe (o segundo Bárbaro) têm o
        /// mesmo id de classe e fichas diferentes.
        /// </summary>
        public Recompensa RegistrarVitoria(Motor.Batalha batalha, Motor.Sorte sorte)
        {
            if (batalha == null) throw new ArgumentNullException("batalha");
            if (Estado != EstadoDaDescida.EmSala) return null;

            var recompensa = new Recompensa();
            var mortos = new List<Monstro>();
            var pvDosHerois = new List<int>();

            foreach (var u in batalha.Unidades)
            {
                if (u == null) continue;
                if (u.Lado == Motor.Lado.Heroi)
                {
                    pvDosHerois.Add(u.Viva ? Math.Max(0, u.PV) : 0);
                    continue;
                }
                if (u.Viva) continue;
                var m = AchaMonstro(u.ClasseOuMonstroId);
                if (m != null) mortos.Add(m);
            }

            _pvAoFim.Clear();
            for (int i = 0; i < _grupo.Count && i < pvDosHerois.Count; i++)
                _pvAoFim[_grupo[i]] = pvDosHerois[i];

            // ---- XP: a soma da sala vira inteiro, e só depois se divide.
            // O `xp` do monstro é fracionário de propósito (uma casa); somar já
            // arredondado faria todo bicho do calabouço 1 valer o mesmo.
            double xpTotal = 0;
            for (int i = 0; i < mortos.Count; i++) xpTotal += mortos[i].Xp;
            recompensa.XpDaSala = (int)Math.Floor(xpTotal / Math.Max(1, _grupo.Count));

            foreach (var heroiId in _grupo)
            {
                var mult = _progresso.MultiplicadorDeXp(_progresso.NivelDe(heroiId), IdDoCalabouco);
                var xp = (int)Math.Floor(recompensa.XpDaSala * mult);
                recompensa.MultiplicadorDeXp[heroiId] = mult;
                recompensa.XpPorHeroi[heroiId] = xp;

                var subiu = _progresso.AdicionarXp(heroiId, xp);
                if (subiu > 0)
                    recompensa.Subidas.Add(new SubidaDeNivel
                    {
                        IdDoHeroi = heroiId, Niveis = subiu, NovoNivel = _progresso.NivelDe(heroiId)
                    });
            }

            if (sorte != null)
            {
                recompensa.Pedras = new Dictionary<string, int>(
                    Saque.RolarPedras(_progresso, mortos, sorte));
                recompensa.Itens.AddRange(
                    Saque.RolarItens(_progresso, IdDoCalabouco, IndiceDaSala, _grupo.Count, sorte));
                recompensa.Carta =
                    Saque.RolarCarta(_progresso, IdDoCalabouco, IndiceDaSala, _grupo.Count, sorte);
                recompensa.Bicho =
                    Saque.RolarBicho(_progresso, IdDoCalabouco, IndiceDaSala, _grupo.Count, sorte);
            }

            recompensa.EscolhasDeElemento =
                new List<string>(_progresso.EscolhasDeElementoPendentes(_grupo));

            Estado = EhSalaDoChefe ? EstadoDaDescida.CalaboucoConcluido : EstadoDaDescida.SalaVencida;
            _progresso.Salvar();
            return recompensa;
        }

        /// <summary>O grupo tombou. A descida acabou — o progresso ganho fica.</summary>
        public void RegistrarDerrota()
        {
            if (Estado != EstadoDaDescida.EmSala) return;
            Estado = EstadoDaDescida.Derrota;
            _pvAoFim.Clear();
            _progresso.Salvar();
        }

        /// <summary>
        /// Avança para a próxima sala. Só funciona logo depois de uma vitória
        /// que não era a do chefe — depois do chefe não há para onde ir, e
        /// deixar avançar estouraria o índice na montagem.
        /// </summary>
        public bool ProximaSala()
        {
            if (Estado != EstadoDaDescida.SalaVencida) return false;
            if (IndiceDaSala + 1 >= TotalDeSalas) return false;
            IndiceDaSala++;
            Estado = EstadoDaDescida.EmSala;
            return true;
        }

        Monstro AchaMonstro(string id)
        {
            var banco = _progresso.Banco;
            Monstro m;
            if (banco.Monstros != null && banco.Monstros.TryGetValue(id, out m)) return m;
            if (banco.InvocadosDeFusao != null && banco.InvocadosDeFusao.TryGetValue(id, out m)) return m;
            return null;
        }
    }
}
