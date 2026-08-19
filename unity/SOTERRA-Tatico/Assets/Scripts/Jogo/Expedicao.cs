using System;
using System.Collections.Generic;

namespace Soterra.Jogo
{
    // Ver a nota em Partida.cs: apelidos globais contra o CS0234 dos irmãos.
    using Motor = global::Soterra.Motor;
    using Dados = global::Soterra.Dados;
    using Grade = global::Soterra.Grade;
    using Progressao = global::Soterra.Progressao;

    /// <summary>Em que ponto do laço o jogo está — é o que a tela lê para saber
    /// o que desenhar.</summary>
    public enum PassoDaExpedicao
    {
        /// <summary>A batalha da sala está em pé. Nenhuma tela de fluxo por cima.</summary>
        EmSala,

        /// <summary>Um herói do grupo chegou ao nível da escolha e ainda é neutro.</summary>
        EscolhaDeElemento,

        /// <summary>Sala vencida, há sala adiante: a tela de recompensa.</summary>
        Recompensa,

        /// <summary>O chefe caiu.</summary>
        CalaboucoConcluido,

        /// <summary>O grupo tombou.</summary>
        Derrota
    }

    /// <summary>
    /// O regente do CALABOUÇO — o que transforma "uma batalha" em "uma descida".
    ///
    /// A <see cref="Partida"/> rege uma sala; esta classe rege a fila delas:
    /// monta a sala corrente com os heróis da progressão, recolhe a recompensa
    /// quando a batalha acaba, leva o grupo à sala seguinte com a vida
    /// castigada, e guarda no armazém onde a descida parou.
    ///
    /// C# PURO e sem <c>MonoBehaviour</c>, como a Partida e pelo mesmo motivo:
    /// é isto que deixa o calabouço INTEIRO — três salas, duas recompensas e o
    /// chefe — ser descido num teste EditMode, em milissegundos, sem apertar
    /// Play. Quem pendura isto numa cena é <see cref="JogoDeBatalha"/>.
    ///
    /// Nenhuma regra de progressão mora aqui. Quem paga XP, quem sorteia peça,
    /// quem cura entre salas e quem decide que a última sala é a do chefe é a
    /// <c>Progressao.Descida</c>, que já existia e já estava testada — esta
    /// classe só a LIGA à batalha jogável.
    /// </summary>
    public sealed class Expedicao
    {
        /// <summary>
        /// Semente do saque quando ninguém declara uma.
        ///
        /// Fixa de propósito: uma descida que paga peças diferentes a cada
        /// execução é impossível de relatar num defeito ("caiu o quê?"), e o
        /// jogo de verdade passa a sua — <see cref="JogoDeBatalha"/> deriva a
        /// dele do calabouço.
        /// </summary>
        public const string SementePadrao = "soterra-descida";

        readonly Progressao.Progresso _progresso;
        readonly Progressao.IArmazem _armazem;
        readonly string _semente;
        readonly string _calabocoId;
        readonly List<string> _grupo;

        /// <summary>
        /// O sorteio do SAQUE, um só para a descida inteira.
        ///
        /// Separado do da batalha e do da IA de propósito: com um gerador só, o
        /// número de jogadas que o monstro fez mudaria a peça que cai no fim da
        /// sala. Continua determinístico, e continua impossível de explicar.
        /// </summary>
        readonly Motor.Sorte _sorteDoSaque;

        Progressao.Descida _descida;
        Partida _partida;
        Progressao.Recompensa _recompensa;

        /// <summary>O PV com que cada herói entrou na sala corrente. É o que a
        /// marca guarda — ver <see cref="MarcaDaDescida"/>.</summary>
        readonly Dictionary<string, int> _pvDeEntrada = new Dictionary<string, int>();

        /// <summary>Disparado toda vez que uma sala nova é montada. É por aqui
        /// que a cena repovoa palco, elenco e HUD sem recarregar cena.</summary>
        public event Action AoMontarSala;

        Expedicao(Progressao.Progresso progresso, Progressao.Descida descida, string calabocoId,
                  IList<string> grupo, string semente, Progressao.IArmazem armazem)
        {
            _progresso = progresso;
            _descida = descida;
            _calabocoId = calabocoId;
            _grupo = new List<string>(grupo);
            _semente = string.IsNullOrEmpty(semente) ? SementePadrao : semente;
            _sorteDoSaque = Motor.Sorte.DeTexto(_semente + ":saque:" + calabocoId);
            _armazem = armazem;
        }

        // ============================================================== ABERTURA

        /// <summary>
        /// Abre uma descida nova e monta a sala de partida. Devolve <c>null</c>
        /// pelos mesmos motivos que <c>Descida.Comecar</c> — calabouço que não
        /// existe, grupo de três, id repetido, herói sem ficha.
        ///
        /// <paramref name="indiceInicial"/> serve a quem quer abrir o jogo já
        /// numa sala do meio: o Inspector da cena e as fotos do lote. Não paga
        /// nada pelas salas puladas — ver <see cref="AvancarAte"/>.
        /// </summary>
        public static Expedicao Comecar(Progressao.Progresso progresso, string calabocoId,
                                        IList<string> grupo, string semente = null,
                                        Progressao.IArmazem armazem = null, int indiceInicial = 0)
        {
            if (progresso == null) throw new ArgumentNullException("progresso");
            var descida = Progressao.Descida.Comecar(progresso, calabocoId, grupo);
            if (descida == null) return null;
            if (indiceInicial < 0 || indiceInicial >= descida.TotalDeSalas) return null;
            if (!AvancarAte(progresso, descida, indiceInicial)) return null;

            var e = new Expedicao(progresso, descida, calabocoId, grupo, semente, armazem);
            e.MontarSala(null);
            return e;
        }

        /// <summary>
        /// Retoma a descida que o armazém guardou, na SALA em que ela parou e
        /// com a vida com que o grupo entrou nela. Devolve <c>null</c> quando
        /// não há marca, quando ela não bate mais com o acervo (calabouço que
        /// saiu do jogo, herói sem ficha) ou quando a sala salva não existe
        /// mais — e aí abrir uma descida nova é decisão de quem chamou, não
        /// desta classe.
        /// </summary>
        public static Expedicao Retomar(Progressao.Progresso progresso, string semente = null,
                                        Progressao.IArmazem armazem = null)
        {
            if (progresso == null) throw new ArgumentNullException("progresso");
            var marca = MarcaDaDescida.Ler(armazem);
            if (marca == null) return null;

            var descida = Progressao.Descida.Comecar(progresso, marca.Calabouco, marca.Grupo);
            if (descida == null) return null;
            if (marca.IndiceDaSala >= descida.TotalDeSalas) return null;
            if (!AvancarAte(progresso, descida, marca.IndiceDaSala)) return null;

            var e = new Expedicao(progresso, descida, marca.Calabouco, marca.Grupo, semente, armazem);
            e.MontarSala(marca.PvDeEntrada);
            return e;
        }

        /// <summary>
        /// Põe a descida na sala <paramref name="indice"/> com VITÓRIAS SECAS:
        /// batalha sem unidade nenhuma e sorte nula.
        ///
        /// É feio e é o único caminho — e por isso está escrito aqui, num lugar
        /// só, em vez de espalhado. <c>Descida.IndiceDaSala</c> tem escrita
        /// privada e só avança por <c>ProximaSala</c>, que por sua vez só
        /// funciona logo depois de um <c>RegistrarVitoria</c>; a Descida é de
        /// outro dono e esta rodada não a altera. O que torna a vitória SECA:
        /// sem monstro morto não há XP nem pedra (a soma percorre a lista de
        /// unidades, que está vazia), e com <c>sorte</c> nula o
        /// <c>RegistrarVitoria</c> pula item, carta e bicho inteiros. O teste
        /// <c>RetomarNaoPagaNadaDeNovo</c> cobra exatamente isso.
        ///
        /// O PV também é zerado pela vitória seca — e é por isso que a retomada
        /// monta a sala com o PV da MARCA, e não com o que a Descida diria.
        /// </summary>
        static bool AvancarAte(Progressao.Progresso progresso, Progressao.Descida descida, int indice)
        {
            var vazia = Grade.Mapa.DeTexto(new[] { "." });
            for (int i = 0; i < indice; i++)
            {
                var seca = new Motor.Batalha(progresso.Banco, vazia, new List<Motor.Unidade>());
                if (descida.RegistrarVitoria(seca, null) == null) return false;
                if (!descida.ProximaSala()) return false;
            }
            return true;
        }

        // ============================================================= CONSULTAS

        public Progressao.Descida Descida { get { return _descida; } }

        /// <summary>O regente da sala corrente. Nunca nulo depois da abertura.</summary>
        public Partida Partida { get { return _partida; } }

        public Motor.Batalha Batalha { get { return _partida == null ? null : _partida.Batalha; } }

        /// <summary>A recompensa da última sala vencida, ou <c>null</c>.</summary>
        public Progressao.Recompensa Recompensa { get { return _recompensa; } }

        public string IdDoCalabouco { get { return _calabocoId; } }
        public Dados.Calabouco DadosDoCalabouco { get { return _descida.DadosDoCalabouco; } }
        public int IndiceDaSala { get { return _descida.IndiceDaSala; } }
        public int TotalDeSalas { get { return _descida.TotalDeSalas; } }
        public bool EhSalaDoChefe { get { return _descida.EhSalaDoChefe; } }
        public IList<string> Grupo { get { return _grupo.AsReadOnly(); } }

        /// <summary>O PV com que cada herói entrou na sala corrente.</summary>
        public IDictionary<string, int> PvDeEntrada
        {
            get { return new Dictionary<string, int>(_pvDeEntrada); }
        }

        /// <summary>
        /// Que tela desenhar agora.
        ///
        /// A escolha de elemento vem ANTES da recompensa de propósito: ela é
        /// PERMANENTE (a Progressão recusa a segunda), e uma decisão dessas não
        /// pode dividir espaço com um botão "Descer" que só quer ser apertado.
        /// </summary>
        public PassoDaExpedicao Passo
        {
            get
            {
                if (_descida.Estado == Progressao.EstadoDaDescida.EmSala) return PassoDaExpedicao.EmSala;
                if (HeroiDaEscolha != null) return PassoDaExpedicao.EscolhaDeElemento;
                if (_descida.Estado == Progressao.EstadoDaDescida.Derrota) return PassoDaExpedicao.Derrota;
                if (_descida.Estado == Progressao.EstadoDaDescida.CalaboucoConcluido)
                    return PassoDaExpedicao.CalaboucoConcluido;
                return PassoDaExpedicao.Recompensa;
            }
        }

        /// <summary>
        /// O primeiro herói do grupo que ainda deve uma escolha de elemento, ou
        /// <c>null</c>. Perguntado à PROGRESSÃO na hora e não guardado da
        /// recompensa: escolher tira o herói desta lista, e uma lista guardada
        /// mostraria a mesma tela duas vezes.
        /// </summary>
        public string HeroiDaEscolha
        {
            get
            {
                var pendentes = _progresso.EscolhasDeElementoPendentes(_grupo);
                return pendentes.Count > 0 ? pendentes[0] : null;
            }
        }

        // ================================================================== LAÇO

        /// <summary>
        /// A batalha da sala acabou? Então registra: vitória recolhe a
        /// recompensa, derrota encerra a descida. Devolve <c>true</c> quando o
        /// estado mudou — é o gatilho da tela de fluxo.
        ///
        /// Idempotente: chamar de novo com a mesma batalha encerrada não paga a
        /// recompensa duas vezes, porque a própria Descida recusa registrar
        /// fora do estado <c>EmSala</c>.
        /// </summary>
        public bool ConferirFimDaSala()
        {
            if (_partida == null || !_partida.Acabou) return false;
            if (_descida.Estado != Progressao.EstadoDaDescida.EmSala) return false;

            if (_partida.Batalha.Fase == Motor.FaseDaBatalha.Vitoria)
            {
                _recompensa = _descida.RegistrarVitoria(_partida.Batalha, _sorteDoSaque);
            }
            else
            {
                _recompensa = null;
                _descida.RegistrarDerrota();
            }

            // A descida acabou (chefe ou tombo): a marca sai do armazém. Deixá-la
            // faria o jogo reabrir numa sala de um calabouço que já foi concluído.
            if (_descida.Terminou) MarcaDaDescida.Apagar(_armazem);
            return true;
        }

        /// <summary>
        /// O botão "Descer": vai para a sala seguinte e a monta na mesma cena.
        /// Devolve <c>false</c> quando não há para onde ir — depois do chefe, ou
        /// com a sala corrente ainda em pé.
        /// </summary>
        public bool Descer()
        {
            if (!_descida.ProximaSala()) return false;
            _recompensa = null;
            MontarSala(null);
            return true;
        }

        /// <summary>
        /// Recomeça o calabouço do zero — é o que a tela de derrota oferece, e
        /// também o que a de conclusão usa para descer de novo.
        ///
        /// O PROGRESSO fica: XP, níveis, peças e cartas conquistadas são do
        /// jogador, não da descida (é a regra que <c>RegistrarDerrota</c> já
        /// cobra em teste). O que recomeça é a fila de salas e a vida cheia.
        /// </summary>
        public bool Recomecar()
        {
            var nova = Progressao.Descida.Comecar(_progresso, _calabocoId, _grupo);
            if (nova == null) return false;
            _descida = nova;
            _recompensa = null;
            MontarSala(null);
            return true;
        }

        /// <summary>
        /// Grava o caminho elemental do herói. É PARA SEMPRE — a permanência é
        /// regra da Progressão, não desta tela, e a segunda chamada devolve
        /// <c>false</c> sem mudar nada.
        /// </summary>
        public bool EscolherElemento(string heroiId, string elemento)
        {
            return _progresso.EscolherElemento(heroiId, elemento);
        }

        // ============================================================== MONTAGEM

        /// <summary>
        /// Monta a batalha da sala corrente e grava a marca.
        ///
        /// <paramref name="pvSalvo"/> só chega na RETOMADA: no fluxo normal quem
        /// diz com quanto de vida cada um entra é a Descida — vivo cura metade
        /// do que perdeu, morto volta com uma fração da vida cheia.
        /// </summary>
        void MontarSala(IDictionary<string, int> pvSalvo)
        {
            _pvDeEntrada.Clear();

            Func<string, int, int> pv = (heroiId, pvMaximo) =>
            {
                int salvo;
                var valor = pvSalvo != null && pvSalvo.TryGetValue(heroiId, out salvo) && salvo > 0
                    ? Math.Min(salvo, pvMaximo)
                    : _descida.PvDeEntrada(heroiId, pvMaximo);
                _pvDeEntrada[heroiId] = valor;
                return valor;
            };

            // Sementes DERIVADAS da sala: a mesma sala rejogada sorteia igual, e
            // salas diferentes não herdam o gerador uma da outra. O saque tem a
            // sua, que atravessa a descida inteira.
            var daSala = _semente + ":sala" + _descida.IndiceDaSala + ":" + _calabocoId;
            var batalha = MontagemDaSala.DeSala(_progresso, _calabocoId, _descida.IndiceDaSala,
                                                _grupo, pv, Motor.Sorte.DeTexto(daSala));
            _partida = new Partida(_progresso.Banco, batalha, Motor.Sorte.DeTexto(daSala + ":ia"));

            Gravar();

            var aviso = AoMontarSala;
            if (aviso != null) aviso();
        }

        void Gravar()
        {
            var marca = new MarcaDaDescida
            {
                Calabouco = _calabocoId,
                IndiceDaSala = _descida.IndiceDaSala,
                Grupo = new List<string>(_grupo),
                PvDeEntrada = new Dictionary<string, int>(_pvDeEntrada)
            };
            marca.Gravar(_armazem);
        }
    }
}
