using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UIElements;

namespace Soterra.Jogo
{
    // Ver a nota em Partida.cs: apelidos globais contra o CS0234 dos irmãos.
    using Motor = global::Soterra.Motor;
    using Dados = global::Soterra.Dados;
    using Cena = global::Soterra.Cena;
    using Interface = global::Soterra.Interface;
    using Batalha = global::Soterra.Batalha;
    using Progressao = global::Soterra.Progressao;

    /// <summary>
    /// O componente que faz de SOTERRA um jogo: aperta-se Play e DESCE-SE um
    /// calabouço. Liga o que já existe — a <see cref="Expedicao"/> rege a fila
    /// de salas em cima da <c>Progressao.Descida</c>, a <see cref="Partida"/>
    /// rege a sala, o Motor manda, o Cérebro joga pelo bicho, o Palco e o
    /// Elenco desenham, os dois HUDs conversam — e não reescreve nada de
    /// nenhum deles.
    ///
    /// O componente é FINO de propósito: o laço de uma sala mora na
    /// <see cref="Partida"/> e o laço do calabouço na <see cref="Expedicao"/>,
    /// as duas C# puro e testadas sem Play. Aqui só fica o que precisa de
    /// quadro e de aparelho — ler o dedo, dar ritmo ao turno do monstro,
    /// repovoar a cena entre salas e repassar cada resultado.
    ///
    /// Entre salas a cena NÃO recarrega: o palco remonta com o mapa novo e o
    /// elenco renasce em cima dele. Recarregar a cena mataria o painel do UI
    /// Toolkit, o progresso em memória e o próprio componente no meio de um
    /// evento de clique.
    ///
    /// Toque, não só mouse: o destino é celular. E NENHUMA linha de
    /// <c>Input.</c> legado — neste projeto ele LANÇA exceção
    /// (<c>activeInputHandler: 1</c>, CONTRATO_UNITY_F1 §3).
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class JogoDeBatalha : MonoBehaviour
    {
        /// <summary>O calabouço que o jogo abre e o grupo que desce nele.
        ///
        /// Campos SERIALIZADOS, e não constantes, desde que o elenco definitivo
        /// começou a chegar: o usuário testa cada personagem novo trocando o id
        /// no Inspector — sem esperar código. Ids válidos: sumo, arqueiro,
        /// bruxo, espadachim, curandeira, invocador. Id sem modelo em
        /// Resources/elenco cai no acervo antigo, e sem nada vira cápsula.
        ///
        /// A dupla padrão é sumo + curandeira porque são as DUAS classes que o
        /// acervo declara `startsUnlocked` — o grupo agora nasce da progressão,
        /// e um herói de classe trancada não tem ficha para descer. Trocar o id
        /// aqui por uma classe trancada faz a montagem estourar dizendo isso,
        /// em vez de o jogo abrir com um herói cru.
        ///
        /// <c>IndiceDaSala</c> é a sala de PARTIDA da descida — dali em diante
        /// quem manda é a Descida, e um save em curso a ignora (retomar vence).
        /// </summary>
        public const string CalaboucoPadrao = "greenhouse";
        public const int IndiceDaSalaPadrao = 0;
        public string Calabouco = CalaboucoPadrao;
        public int IndiceDaSala = IndiceDaSalaPadrao;
        public string Heroi1 = "sumo";
        public string Heroi2 = "bruxo";

        /// <summary>
        /// Libera as seis classes antes de abrir a descida.
        ///
        /// O jogo de verdade tranca quatro delas (`startsUnlocked: false`) e
        /// elas entram por carta — regra que a Progressao cobra e que a Descida
        /// respeita, recusando grupo com heroi trancado. Mas esta cena existe
        /// para VER, e o painel de teste do jogo em JS fazia exatamente isso:
        /// liberava as seis para ninguem ter de jogar ate o nivel 30 so para
        /// olhar um personagem. Desligue para sentir a progressao de verdade.
        /// </summary>
        public bool LiberarTodasAsClasses = true;

        /// <summary>
        /// A dupla das FOTOS de elenco (<c>FotoDaFusao</c>, <c>FotoDaAnimacao</c>).
        ///
        /// Continua sumo + bruxo, e não acompanha o grupo jogável de propósito:
        /// essas fotos documentam os modelos do Meshy que existem em
        /// <c>Resources/elenco/</c>, e montam a batalha pela CLASSE, sem passar
        /// pela progressão — nada ali depende de a classe estar liberada.
        /// </summary>
        public static readonly string[] HeroisPadrao = { "sumo", "bruxo" };

        public string[] Herois { get { return new[] { Heroi1, Heroi2 }; } }

        /// <summary>
        /// Semente do sorteio da descida (saque, IA, esquiva). Fixa: uma
        /// descida que se comporta diferente a cada Play é impossível de
        /// relatar num defeito.
        /// </summary>
        public string Semente = "soterra-jogo";

        /// <summary>
        /// Onde o save mora. Nulo = <c>PlayerPrefs</c>, que é o do jogo de
        /// verdade. O teste troca por um armazém de memória: gravar no
        /// PlayerPrefs da máquina passaria o resultado de uma execução do lote
        /// para a seguinte, e dois testes que se contaminam não provam nada.
        /// </summary>
        public Progressao.IArmazem Armazem { get; set; }

        /// <summary>
        /// Pausa entre as jogadas do monstro, em segundos. Sem ela o turno
        /// inimigo inteiro acontece num quadro só e o jogador vê o tabuleiro
        /// "teleportar" — meio segundo por jogada é o que dá leitura sem dar
        /// tédio.
        /// </summary>
        public const float PausaEntreJogadas = 0.55f;

        Dados.BancoDeDados _banco;
        Progressao.Progresso _progresso;
        Expedicao _expedicao;
        Partida _partida;
        Cena.Palco _palco;
        Cena.Elenco _elenco;
        AnimacaoDoElenco _animacao;
        DespachoDeEfeitos _efeitos;
        Interface.HudDeBatalha _hud;
        Interface.HudDeFluxo _fluxo;

        float _espera;
        bool _fimAnunciado;
        bool _fimDaSalaTratado;
        string _motivoDoFim;
        Vector2Int? _casaSobPonteiro;

        /// <summary>O regente da sala. Nulo antes de <see cref="Montar"/>.</summary>
        public Partida Partida { get { return _partida; } }

        /// <summary>O regente do calabouço. Nulo antes de <see cref="Montar"/>.</summary>
        public Expedicao Expedicao { get { return _expedicao; } }

        /// <summary>O progresso do jogador — nível, saco, cartas.</summary>
        public Progressao.Progresso Progresso { get { return _progresso; } }

        public Cena.Palco Palco { get { return _palco; } }
        public Cena.Elenco Elenco { get { return _elenco; } }
        public AnimacaoDoElenco Animacao { get { return _animacao; } }
        public DespachoDeEfeitos Efeitos { get { return _efeitos; } }
        public Interface.HudDeBatalha Hud { get { return _hud; } }

        /// <summary>As telas entre salas: recompensa, caminho, conclusão, derrota.</summary>
        public Interface.HudDeFluxo Fluxo { get { return _fluxo; } }

        /// <summary>A câmera do palco — é ela que o modo lote fotografa.</summary>
        public Camera Camera { get { return _palco != null ? _palco.Camera : null; } }

        void Start()
        {
            Montar();
        }

        /// <summary>
        /// Monta o jogo inteiro: banco, progresso, a descida (retomada do save
        /// ou nova), palco com o tema do calabouço, elenco e os dois HUDs.
        /// Público e utilizável FORA de Play porque o modo lote
        /// (-executeMethod) nunca aperta Play — é assim que a cena
        /// `Batalha.unity` é gerada e fotografada.
        ///
        /// Idempotente: o Start chama de novo na cena já salva, e remontar
        /// destruiria o que o Palco acabou de desenhar.
        /// </summary>
        public void Montar()
        {
            if (_expedicao != null) return;

            _banco = Dados.BancoDeDados.CarregarDeResources();

            var armazem = Armazem ?? new Progressao.ArmazemDePlayerPrefs();
            _progresso = Progressao.Progresso.Carregar(_banco, armazem);

            if (LiberarTodasAsClasses && _banco.Classes != null)
                foreach (var id in _banco.Classes.Keys) _progresso.LiberarClasse(id);

            _palco = AcharOuCriarPalco();

            // A camera passa a obedecer ao jogador E a se reenquadrar quando a
            // tela muda. Enquadrar so na montagem era o defeito que deixava a
            // camera colada em Play: a proporcao da janela ainda nao e a final
            // no quadro em que a sala e montada.
            var cameraDoJogador = gameObject.GetComponent<CameraDoJogador>();
            if (cameraDoJogador == null) cameraDoJogador = gameObject.AddComponent<CameraDoJogador>();
            cameraDoJogador.MarcarOrigem();
            cameraDoJogador.Ligar(_palco);

            _hud = AcharOuCriarHud();
            _hud.Montar();
            _hud.Tela.AoEscolherFeitico += AoEscolherFeitico;
            _hud.Tela.AoEncerrarTurno += AoEncerrarTurno;
            _hud.Tela.AoFundir += AoFundir;
            _hud.Tela.AoCancelarFusao += AoCancelarFusao;

            _fluxo = AcharOuCriarFluxo();
            _fluxo.Montar();
            _fluxo.Tela.AoAvancar += AoAvancarNoFluxo;
            _fluxo.Tela.AoEscolherElemento += AoEscolherElementoNoFluxo;

            // O save VENCE o Inspector: fechar o jogo na sala do meio e reabrir
            // tem de continuar dali, e não do vestíbulo. Sem descida gravada,
            // abre-se uma nova com o que o Inspector diz.
            var expedicao = Expedicao.Retomar(_progresso, Semente, armazem);
            if (expedicao == null)
                expedicao = Expedicao.Comecar(_progresso, Calabouco, Herois, Semente, armazem,
                                              IndiceDaSala);

            if (expedicao == null)
                throw new InvalidOperationException(
                    "não abriu a descida de '" + Calabouco + "' com [" + string.Join(", ", Herois) +
                    "] — calabouço desconhecido, grupo com id repetido, ou herói de classe " +
                    "ainda trancada (só as `startsUnlocked` têm ficha antes da primeira carta)");

            // A PRIMEIRA sala já foi montada dentro da fábrica, antes de haver
            // quem escutasse — por isso o repovoamento inicial é chamado à mão.
            // Da segunda em diante quem avisa é o evento.
            expedicao.AoMontarSala += RepovoarSala;
            _expedicao = expedicao;
            RepovoarSala();
        }

        /// <summary>
        /// Põe a cena de acordo com a sala corrente da descida: palco com o
        /// mapa e o tema novos, elenco renascido, animação zerada, HUD repintado.
        ///
        /// O tema vem do calabouço — e a sala pode destoar dele
        /// (`sceneryTheme`). Sem isto a Cisterna sairia com o verde da Estufa,
        /// o defeito que a rodada da Cena já pagou.
        ///
        /// O Elenco e a Animação são NOVOS a cada sala, e não reaproveitados:
        /// o <c>Palco.Montar</c> destrói os filhos do tabuleiro, inclusive o
        /// grupo "Elenco" inteiro. Um elenco reaproveitado ficaria segurando
        /// referências a objetos destruídos — que em Unity não são nulos e
        /// também não são nada.
        /// </summary>
        void RepovoarSala()
        {
            _partida = _expedicao.Partida;
            var batalha = _partida.Batalha;

            var calabouco = _expedicao.DadosDoCalabouco;
            var sala = calabouco.Salas[_expedicao.IndiceDaSala];

            _palco.Montar(batalha.Mapa,
                          Cena.TemaDoCenario.De(sala.TemaDeCenario ?? calabouco.Tema,
                                                calabouco.Paleta));

            _elenco = new Cena.Elenco(_palco, _banco);
            _animacao = new AnimacaoDoElenco(_elenco, _palco, batalha);
            _efeitos = new DespachoDeEfeitos(_palco, batalha, _banco);

            _fimAnunciado = false;
            _fimDaSalaTratado = false;
            _motivoDoFim = null;
            _espera = 0f;
            _casaSobPonteiro = null;

            // A abertura já aconteceu dentro do construtor da batalha (tique de
            // clima, veneno de quem abre) — repassar os eventos dela é o que
            // impede a primeira imagem de discordar do primeiro estado.
            AposAcao(batalha.Abertura);
            MostrarFluxo();
        }

        // ================================================================ LAÇO

        void Update()
        {
            if (_partida == null) return;

            // O tempo dos deslizes anda SEMPRE — inclusive depois do fim, para
            // o último corpo terminar de cair em vez de congelar no ar. O mesmo
            // vale para os efeitos: cortá-los no fim da batalha deixaria a
            // última explosão pendurada no ar.
            _animacao.Avancar(Time.deltaTime);
            _efeitos.Avancar(Time.deltaTime);

            // Tela de fluxo aberta: a batalha não anda e o dedo é dela. Quem a
            // fecha é o botão, não o relógio.
            if (_expedicao.Passo != PassoDaExpedicao.EmSala) return;

            if (_partida.Acabou)
            {
                // O fim da sala só é REGISTRADO depois de o último corpo cair.
                // Registrar no mesmo quadro faria a tela de recompensa subir por
                // cima de um monstro ainda de pé no ar.
                if (!_animacao.Ocupada) ConferirFimDaSala();
                return;
            }

            if (_partida.TurnoDoJogador)
            {
                _espera = 0f;
                LerToque();
                PreverAreaSobOMouse();
            }
            else
            {
                // Enquanto um deslize anda, o relógio da próxima jogada não
                // conta: sem isto o monstro seguinte agiria com o anterior
                // ainda no meio do caminho, e o deslize morreria cortado.
                if (_animacao.Ocupada)
                {
                    _espera = 0f;
                    return;
                }

                // O monstro joga em parcelas com pausa — a decisão continua do
                // Cérebro; aqui só mora o relógio.
                _espera += Time.deltaTime;
                if (_espera >= PausaEntreJogadas)
                {
                    _espera = 0f;
                    AposAcao(_partida.JogadaDoMonstro());
                }
            }
        }

        /// <summary>
        /// Todo caminho de mudança desagua aqui: sincroniza o elenco com a
        /// lista REAL do motor (o que cria quem nasceu por summon/split e tira
        /// quem caiu), reacende o realce, repinta o HUD e, quando for o caso,
        /// anuncia o fim. Um funil só, para a cena nunca ficar meio-atualizada.
        /// </summary>
        void AposAcao(Motor.Resultado r)
        {
            var batalha = _partida.Batalha;

            // ANTES do espelho: quem morreu ainda existe em cena, e é agora que
            // o corpo é adotado (fica caído) e os gatilhos disparam — depois do
            // Sincronizar o objeto já teria sido destruído. O efeito visual lê
            // os mesmos eventos no mesmo ponto, e pela mesma razão: quem morreu
            // ainda tem casa de onde o estouro sair.
            _animacao.Reagir(r);
            _efeitos.Reagir(r);
            _elenco.Sincronizar(Fichas.De(batalha, _banco));
            // DEPOIS do espelho: quem andou já está plantado no destino; o
            // deslize o devolve ao ponto de partida e atravessa o caminho com
            // tempo — é o deslocamento que faz o walk aparecer.
            _animacao.Animar();

            _casaSobPonteiro = null;
            AtualizarRealce();
            _hud.Mostrar(_partida.Quadro());

            if (r != null)
            {
                // O motivo do fim viaja num evento; guardado aqui porque o
                // anúncio pode sair de OUTRA chamada (a fúria encerra no começo
                // de rodada, dentro de um EncerrarTurno qualquer).
                for (int i = 0; i < r.Eventos.Count; i++)
                    if (r.Eventos[i].Tipo == Motor.TipoDeEvento.FimDeBatalha)
                        _motivoDoFim = r.Eventos[i].Detalhe;

                // A recusa vira texto na ficha do topo. Foi para isto que o
                // motor escreveu os motivos em português — o silêncio diante do
                // clique era o defeito da linha JS.
                if (!r.Valido && !string.IsNullOrEmpty(r.Recusa) && !_partida.Acabou)
                    _hud.Tela.MostrarFicha("Jogada recusada", string.Empty, r.Recusa);

                // A fusão também fala pela ficha: declarar, falhar e acontecer
                // são invisíveis no tabuleiro até o corpo trocar — sem texto o
                // jogador paga 2 PA e não vê NADA mudar até o fim do turno.
                if (r.Valido) NarrarFusao(r);
            }

            AnunciarFim();
        }

        /// <summary>Vitória e derrota viram mensagem simples na ficha do topo —
        /// a tela bonita de fim é de outra rodada.</summary>
        void AnunciarFim()
        {
            if (_fimAnunciado || !_partida.Acabou) return;
            _fimAnunciado = true;

            _palco.LimparRealce();
            if (_partida.Batalha.Fase == Motor.FaseDaBatalha.Vitoria)
                _hud.Tela.MostrarFicha("Vitória!", "rodada " + _partida.Batalha.Rodada,
                                       "A sala está limpa.");
            else
                _hud.Tela.MostrarFicha("Derrota", "rodada " + _partida.Batalha.Rodada,
                                       string.IsNullOrEmpty(_motivoDoFim)
                                           ? "O grupo caiu." : _motivoDoFim);
        }

        // =============================================================== FLUXO

        /// <summary>
        /// A batalha acabou e os corpos já caíram: registra o fim na descida
        /// (vitória recolhe a recompensa, derrota encerra) e abre a tela.
        ///
        /// A trava é local e não da Descida: ela também recusa registrar duas
        /// vezes, mas o <c>Update</c> chamaria isto sessenta vezes por segundo
        /// até o jogador tocar no botão, e sessenta chamadas por segundo que
        /// "não fazem nada" são sessenta oportunidades de alguma delas fazer.
        /// </summary>
        public void ConferirFimDaSala()
        {
            if (_fimDaSalaTratado) return;
            _fimDaSalaTratado = true;

            _palco.LimparRealce();
            _expedicao.ConferirFimDaSala();
            MostrarFluxo();
        }

        /// <summary>Repinta a tela de fluxo com o passo em que a descida está.
        /// Fora de sala vencida ela desenha <c>Nenhum</c> — e some.</summary>
        void MostrarFluxo()
        {
            if (_fluxo == null) return;
            _fluxo.Mostrar(Interface.PonteDaDescida.Quadro(
                _progresso, _expedicao.Descida, _expedicao.Recompensa,
                TipoDaTela(_expedicao.Passo), _expedicao.HeroiDaEscolha));
        }

        static Interface.TipoDeFluxo TipoDaTela(PassoDaExpedicao passo)
        {
            switch (passo)
            {
                case PassoDaExpedicao.EscolhaDeElemento:
                    return Interface.TipoDeFluxo.EscolhaDeElemento;
                case PassoDaExpedicao.Recompensa:
                    return Interface.TipoDeFluxo.Recompensa;
                case PassoDaExpedicao.CalaboucoConcluido:
                    return Interface.TipoDeFluxo.CalaboucoConcluido;
                case PassoDaExpedicao.Derrota:
                    return Interface.TipoDeFluxo.Derrota;
                default:
                    return Interface.TipoDeFluxo.Nenhum;
            }
        }

        /// <summary>
        /// O botão principal da tela de fluxo. Depois da recompensa ele DESCE;
        /// depois do chefe e depois da derrota ele recomeça o calabouço — o
        /// progresso ganho fica nos dois casos, que é a regra da Descida.
        /// </summary>
        void AoAvancarNoFluxo()
        {
            if (_expedicao == null) return;

            switch (_expedicao.Passo)
            {
                case PassoDaExpedicao.Recompensa:
                    _expedicao.Descer();
                    break;
                case PassoDaExpedicao.CalaboucoConcluido:
                case PassoDaExpedicao.Derrota:
                    _expedicao.Recomecar();
                    break;
            }

            // O Descer e o Recomecar já repovoaram a cena pelo evento — este
            // Mostrar é para o caso de nenhum dos dois ter acontecido (o botão
            // apertado num passo que não avança), e a tela não pode ficar
            // mostrando um estado que já mudou.
            MostrarFluxo();
        }

        /// <summary>
        /// O toque num dos quatro caminhos elementais. A escolha é PERMANENTE —
        /// a Progressão recusa a segunda —, e depois dela a tela reavalia: se
        /// o outro herói também deve uma escolha, ela aparece; senão, a
        /// recompensa.
        /// </summary>
        void AoEscolherElementoNoFluxo(string elementoId)
        {
            if (_expedicao == null) return;
            var heroi = _expedicao.HeroiDaEscolha;
            if (heroi != null) _expedicao.EscolherElemento(heroi, elementoId);
            MostrarFluxo();
        }

        /// <summary>
        /// Os três momentos da fusão viram texto na ficha do topo. Os textos
        /// nascem dos EVENTOS do motor (e o nome e a frase da dupla, do acervo)
        /// — a interface narra o que aconteceu, nunca decide o que acontece.
        /// </summary>
        void NarrarFusao(Motor.Resultado r)
        {
            for (int i = 0; i < r.Eventos.Count; i++)
            {
                var e = r.Eventos[i];
                switch (e.Tipo)
                {
                    case Motor.TipoDeEvento.FusaoDeclarada:
                        // O aviso do não-reembolso entra AQUI, na declaração:
                        // na hora de cancelar já é tarde para avisar.
                        _hud.Tela.MostrarFicha("Fusão declarada",
                            Motor.Batalha.CustoDePaDaFusao + " PA",
                            "Resolve no fim do turno, se os dois seguirem colados " +
                            "e de pé. Cancelar não devolve os PA.");
                        break;

                    case Motor.TipoDeEvento.FusaoFalhou:
                        _hud.Tela.MostrarFicha(
                            e.Detalhe == "cancelada" ? "Fusão cancelada" : "A fusão falhou",
                            string.Empty,
                            MotivoDaFalha(e.Detalhe));
                        break;

                    case Motor.TipoDeEvento.Fusao:
                        var idf = IdentidadeDe(e.Uid);
                        _hud.Tela.MostrarFicha(
                            idf != null && !string.IsNullOrEmpty(idf.Nome) ? idf.Nome : "Fusão!",
                            "nível " + e.Quantidade,
                            idf != null && !string.IsNullOrEmpty(idf.Frase)
                                ? idf.Frase : "Dois viraram um.");
                        break;
                }
            }
        }

        /// <summary>O `Detalhe` do motor (morte/afastamento/cancelada) numa
        /// frase que explica os PA perdidos — a pergunta que o jogador faz.</summary>
        static string MotivoDaFalha(string detalhe)
        {
            if (detalhe == "morte") return "Um dos dois caiu antes do fim do turno. " +
                                           "A preparação foi gasta: os PA não voltam.";
            if (detalhe == "afastamento") return "Os dois se afastaram antes do fim do turno. " +
                                                 "A preparação foi gasta: os PA não voltam.";
            return "A preparação já foi gasta: os " +
                   Motor.Batalha.CustoDePaDaFusao + " PA não voltam.";
        }

        /// <summary>Nome e frase da dupla, de <c>fusionIdentities</c> — a chave
        /// é o <c>ClasseOuMonstroId</c> da fundida, que JÁ é o id da dupla.</summary>
        Dados.IdentidadeDeFusao IdentidadeDe(string uid)
        {
            var u = _partida.Batalha.Acha(uid);
            Dados.IdentidadeDeFusao idf;
            if (u != null && _banco.IdentidadesDeFusao != null &&
                _banco.IdentidadesDeFusao.TryGetValue(u.ClasseOuMonstroId, out idf))
                return idf;
            return null;
        }

        // =============================================================== TOQUE

        void AoEscolherFeitico(string id)
        {
            _partida.EscolherFeitico(id);
            AposAcao(null);
        }

        void AoEncerrarTurno()
        {
            AposAcao(_partida.EncerrarTurno());
        }

        void AoFundir()
        {
            AposAcao(_partida.DeclararFusao());
        }

        void AoCancelarFusao()
        {
            AposAcao(_partida.CancelarFusao());
        }

        void LerToque()
        {
            var toque = ToqueDesteQuadro();
            if (!toque.HasValue) return;

            // O HUD cobre as faixas de cima e de baixo; o que cai nelas é dos
            // botões, não do chão. Sem esta pergunta, tocar num feitiço da
            // barra também "clicaria" na casa atrás dele.
            if (SobreAInterface(toque.Value)) return;

            var casa = Apontador.CasaSobPonteiro(Camera, _palco, toque.Value);
            if (!casa.HasValue) return;

            AposAcao(_partida.TocarCasa(casa.Value));
        }

        /// <summary>Onde o dedo ou o botão do mouse DESCEU neste quadro. Toque
        /// primeiro: no celular há Touchscreen e pode não haver Mouse.</summary>
        static Vector2? ToqueDesteQuadro()
        {
            var tela = Touchscreen.current;
            if (tela != null && tela.primaryTouch.press.wasPressedThisFrame)
                return tela.primaryTouch.position.ReadValue();

            var mouse = Mouse.current;
            if (mouse != null && mouse.leftButton.wasPressedThisFrame)
                return mouse.position.ReadValue();

            return null;
        }

        /// <summary>
        /// O ponto de tela cai em cima de algo tocável do HUD? Pergunta feita ao
        /// próprio painel (<c>Pick</c>), que já respeita os `picking-mode` do
        /// layout — o vão do tabuleiro é `Ignore` e devolve nulo. A conversão
        /// inverte o Y porque o Input System mede da borda de BAIXO e o painel
        /// mede da de cima.
        /// </summary>
        bool SobreAInterface(Vector2 ponto)
        {
            if (_hud == null || _hud.Tela == null) return false;
            var raiz = _hud.Tela.Raiz;
            if (raiz == null || raiz.panel == null) return false;

            var noPainel = RuntimePanelUtils.ScreenToPanel(
                raiz.panel, new Vector2(ponto.x, Screen.height - ponto.y));
            return raiz.panel.Pick(noPainel) != null;
        }

        /// <summary>
        /// Com feitiço na mão e um MOUSE presente, a área do feitiço acompanha o
        /// ponteiro — é o que deixa o jogador ver o que a explosão pega antes de
        /// soltar. Só mouse: no toque não existe "pairar", e a área aparece de
        /// qualquer forma no realce da casa válida tocada.
        /// </summary>
        void PreverAreaSobOMouse()
        {
            if (_partida.FeiticoEscolhido == null || Mouse.current == null) return;

            var casa = Apontador.CasaSobPonteiro(
                Camera, _palco, Mouse.current.position.ReadValue());
            if (casa == _casaSobPonteiro) return;

            _casaSobPonteiro = casa;
            AtualizarRealce();
        }

        // ============================================================== REALCE

        /// <summary>
        /// O realce diz sempre a mesma coisa que o motor: sem feitiço na mão,
        /// onde dá para pisar (e onde pisar é arriscado); com feitiço, onde ele
        /// pode cair — e, sob o mouse, o que ele pega. Tudo perguntado ao motor
        /// na hora, nunca guardado: realce guardado é realce que mente um turno
        /// depois.
        /// </summary>
        void AtualizarRealce()
        {
            _palco.LimparRealce();
            if (!_partida.TurnoDoJogador) return;

            var batalha = _partida.Batalha;
            var feitico = _partida.FeiticoEscolhido;

            if (feitico == null)
            {
                var seguras = new List<Vector2Int>();
                var arriscadas = new List<Vector2Int>();
                foreach (var par in batalha.AlcanceDePasso())
                    (batalha.Arriscada(par.Key) ? arriscadas : seguras).Add(par.Key);
                _palco.RealcarPasso(seguras);
                _palco.RealcarPasso(arriscadas, true);
                return;
            }

            _palco.RealcarAlvo(batalha.AlvosDe(feitico), CorDoFeitico(feitico));

            if (_casaSobPonteiro.HasValue && batalha.PodeConjurar(feitico, _casaSobPonteiro.Value))
                _palco.RealcarArea(batalha.AreaDe(feitico, _casaSobPonteiro.Value));
        }

        /// <summary>A cor do alvo é a do ELEMENTO do feitiço, do acervo — é a
        /// única pista visual de qual feitiço está na mão. Perguntada à BATALHA
        /// e não ao banco: os compostos da fusão (<c>fus:...</c>) só existem no
        /// registro dela, e pelo banco o realce da fundida sairia sempre na cor
        /// padrão — <c>Batalha.Feitico</c> cai no banco para todos os outros.</summary>
        Color CorDoFeitico(string feiticoId)
        {
            var f = _partida.Batalha.Feitico(feiticoId);
            Dados.InfoDeElemento info;
            Color cor;
            if (f != null && f.Elemento != null && _banco.InfoDeElementos != null &&
                _banco.InfoDeElementos.TryGetValue(f.Elemento, out info) && info != null &&
                ColorUtility.TryParseHtmlString(info.Cor, out cor))
                return cor;
            return Cena.Palco.CorAlcance;
        }

        // ============================================================ MONTAGEM

        /// <summary>
        /// Acha por nome antes de criar: a cena `Batalha.unity` é SALVA com o
        /// palco e o HUD dentro, e o Start remonta em cima dela — criar de novo
        /// deixaria dois palcos disputando a mesma câmera.
        /// </summary>
        Cena.Palco AcharOuCriarPalco()
        {
            var t = transform.Find("Palco");
            if (t != null)
            {
                var pronto = t.GetComponent<Cena.Palco>();
                if (pronto != null) return pronto;
            }
            var go = new GameObject("Palco");
            go.transform.SetParent(transform, false);
            return go.AddComponent<Cena.Palco>();
        }

        Interface.HudDeBatalha AcharOuCriarHud()
        {
            var t = transform.Find("Hud");
            if (t != null)
            {
                var pronto = t.GetComponent<Interface.HudDeBatalha>();
                if (pronto != null) return pronto;
            }
            var go = new GameObject("Hud");
            go.transform.SetParent(transform, false);
            return go.AddComponent<Interface.HudDeBatalha>();
        }

        /// <summary>
        /// O HUD de fluxo mora num objeto SEPARADO do de batalha: cada
        /// <c>UIDocument</c> exige o seu <c>PanelSettings</c>, e dois
        /// componentes de documento no mesmo objeto brigariam pelo mesmo painel.
        /// </summary>
        Interface.HudDeFluxo AcharOuCriarFluxo()
        {
            var t = transform.Find("Fluxo");
            if (t != null)
            {
                var pronto = t.GetComponent<Interface.HudDeFluxo>();
                if (pronto != null) return pronto;
            }
            var go = new GameObject("Fluxo");
            go.transform.SetParent(transform, false);
            return go.AddComponent<Interface.HudDeFluxo>();
        }
    }
}
