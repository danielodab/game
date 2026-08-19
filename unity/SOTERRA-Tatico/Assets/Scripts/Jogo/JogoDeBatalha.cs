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

    /// <summary>
    /// O componente que faz de SOTERRA um jogo: aperta-se Play e JOGA-SE uma
    /// sala. Liga o que já existe — <c>Montador.DeSala</c> monta, o Motor manda,
    /// o Cérebro joga pelo bicho, o Palco e o Elenco desenham, o HUD conversa —
    /// e não reescreve nada de nenhum deles.
    ///
    /// O componente é FINO de propósito: o laço mora na <see cref="Partida"/>,
    /// que é C# puro e testada sem Play. Aqui só fica o que precisa de quadro e
    /// de aparelho — ler o dedo, dar ritmo ao turno do monstro e repassar cada
    /// resultado para a cena e para o HUD.
    ///
    /// Toque, não só mouse: o destino é celular. E NENHUMA linha de
    /// <c>Input.</c> legado — neste projeto ele LANÇA exceção
    /// (<c>activeInputHandler: 1</c>, CONTRATO_UNITY_F1 §3).
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class JogoDeBatalha : MonoBehaviour
    {
        /// <summary>A sala que o jogo abre e o grupo que desce nela.
        ///
        /// Campos SERIALIZADOS, e não constantes, desde que o elenco definitivo
        /// começou a chegar: o usuário testa cada personagem novo trocando o id
        /// no Inspector — sem esperar código. Ids válidos: sumo, arqueiro,
        /// bruxo, espadachim, curandeira, invocador. Id sem modelo em
        /// Resources/elenco cai no acervo antigo, e sem nada vira cápsula.</summary>
        public const string CalaboucoPadrao = "greenhouse";
        public const int IndiceDaSalaPadrao = 0;
        public string Calabouco = CalaboucoPadrao;
        public int IndiceDaSala = IndiceDaSalaPadrao;
        public string Heroi1 = "sumo";
        public string Heroi2 = "bruxo";

        /// <summary>O grupo padrao, para quem fotografa fora da cena.</summary>
        public static readonly string[] HeroisPadrao = { "sumo", "bruxo" };

        public string[] Herois { get { return new[] { Heroi1, Heroi2 }; } }

        /// <summary>
        /// Pausa entre as jogadas do monstro, em segundos. Sem ela o turno
        /// inimigo inteiro acontece num quadro só e o jogador vê o tabuleiro
        /// "teleportar" — meio segundo por jogada é o que dá leitura sem dar
        /// tédio.
        /// </summary>
        public const float PausaEntreJogadas = 0.55f;

        Dados.BancoDeDados _banco;
        Partida _partida;
        Cena.Palco _palco;
        Cena.Elenco _elenco;
        AnimacaoDoElenco _animacao;
        Interface.HudDeBatalha _hud;

        float _espera;
        bool _fimAnunciado;
        string _motivoDoFim;
        Vector2Int? _casaSobPonteiro;

        /// <summary>O regente. Nulo antes de <see cref="Montar"/>.</summary>
        public Partida Partida { get { return _partida; } }
        public Cena.Palco Palco { get { return _palco; } }
        public Cena.Elenco Elenco { get { return _elenco; } }
        public AnimacaoDoElenco Animacao { get { return _animacao; } }
        public Interface.HudDeBatalha Hud { get { return _hud; } }

        /// <summary>A câmera do palco — é ela que o modo lote fotografa.</summary>
        public Camera Camera { get { return _palco != null ? _palco.Camera : null; } }

        void Start()
        {
            Montar();
        }

        /// <summary>
        /// Monta o jogo inteiro: banco, batalha real da sala, palco com o tema
        /// do calabouço, elenco, HUD e o regente. Público e utilizável FORA de
        /// Play porque o modo lote (-executeMethod) nunca aperta Play — é assim
        /// que a cena `Batalha.unity` é gerada e fotografada.
        ///
        /// Idempotente: o Start chama de novo na cena já salva, e remontar
        /// destruiria o que o Palco acabou de desenhar.
        /// </summary>
        public void Montar()
        {
            if (_partida != null) return;

            _banco = Dados.BancoDeDados.CarregarDeResources();
            var batalha = Batalha.Montador.DeSala(_banco, Calabouco, IndiceDaSala, Herois);

            // O tema vem do calabouço — e a sala pode destoar dele
            // (`sceneryTheme`). Sem isto a Cisterna sairia com o verde da
            // Estufa, o defeito que a rodada da Cena já pagou.
            var calabouco = _banco.AchaCalabouco(Calabouco);
            var sala = calabouco.Salas[IndiceDaSala];
            _palco = AcharOuCriarPalco();
            _palco.Montar(batalha.Mapa,
                          Cena.TemaDoCenario.De(sala.TemaDeCenario ?? calabouco.Tema,
                                                calabouco.Paleta));

            _elenco = new Cena.Elenco(_palco, _banco);
            _animacao = new AnimacaoDoElenco(_elenco, _palco, batalha);
            _partida = new Partida(_banco, batalha, Motor.Sorte.DeTexto("soterra-jogo"));

            _hud = AcharOuCriarHud();
            _hud.Montar();
            _hud.Tela.AoEscolherFeitico += AoEscolherFeitico;
            _hud.Tela.AoEncerrarTurno += AoEncerrarTurno;
            _hud.Tela.AoFundir += AoFundir;
            _hud.Tela.AoCancelarFusao += AoCancelarFusao;

            // A abertura já aconteceu dentro do construtor da batalha (tique de
            // clima, veneno de quem abre) — repassar os eventos dela é o que
            // impede a primeira imagem de discordar do primeiro estado.
            AposAcao(batalha.Abertura);
        }

        // ================================================================ LAÇO

        void Update()
        {
            if (_partida == null) return;

            // O tempo dos deslizes anda SEMPRE — inclusive depois do fim, para
            // o último corpo terminar de cair em vez de congelar no ar.
            _animacao.Avancar(Time.deltaTime);

            if (_partida.Acabou) return;

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
            // Sincronizar o objeto já teria sido destruído.
            _animacao.Reagir(r);
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
    }
}
