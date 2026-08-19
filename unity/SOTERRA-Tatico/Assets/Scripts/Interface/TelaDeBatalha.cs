using System;
using System.Text;
using UnityEngine;
using UnityEngine.UIElements;
using Soterra.Dados;

namespace Soterra.Interface
{
    /// <summary>
    /// A tela de batalha: PV/PA/PP de quem joga, a barra de feitiços da classe,
    /// o botão de encerrar turno e a ordem de iniciativa.
    ///
    /// C# PURO, sem <c>MonoBehaviour</c>: assim ela monta, responde a toque e é
    /// medida em teste EditMode, sem cena e sem painel. Quem a pendura numa
    /// tela de verdade é <see cref="HudDeBatalha"/>, e é só isso que ele faz.
    ///
    /// A tela não guarda estado de jogo. Recebe um <see cref="QuadroDaBatalha"/>
    /// por repintura e desenha exatamente o que veio — não tem como discordar do
    /// motor porque não tem opinião sobre nada.
    /// </summary>
    public sealed class TelaDeBatalha
    {
        /// <summary>Caminho em <c>Resources</c> do layout. Sem extensão, como o Unity exige.</summary>
        public const string RecursoDoLayout = "batalha";

        /// <summary>Caminho em <c>Resources</c> da folha de estilo.</summary>
        public const string RecursoDoEstilo = "batalha-estilo";

        /// <summary>
        /// Quantas unidades a faixa de iniciativa mostra. Oito é o que o hud.js
        /// já usava: além disso a faixa toma metade da tela do celular e a
        /// pergunta que ela responde ("quem joga depois de mim?") não precisa
        /// de mais do que isso.
        /// </summary>
        public const int MaximoNaOrdem = 8;

        /// <summary>Raiz clonada do UXML. É o que se pendura no painel.</summary>
        public VisualElement Raiz { get; private set; }

        /// <summary>O <c>hud-batalha</c> de dentro do layout — quem carrega as classes de orientação.</summary>
        public VisualElement Hud { get; private set; }

        /// <summary>Verdadeiro com a tela deitada (16:9). Trocado por <see cref="AplicarOrientacao"/>.</summary>
        public bool EstaDeitada { get; private set; }

        /// <summary>Disparado quando o jogador toca num feitiço que PODE ser lançado.</summary>
        public event Action<string> AoEscolherFeitico;

        /// <summary>Disparado no toque do botão de encerrar turno.</summary>
        public event Action AoEncerrarTurno;

        /// <summary>Disparado no toque de "Fundir" quando há candidato. Quem
        /// escolhe o par e paga os PA é o motor — a tela só avisa.</summary>
        public event Action AoFundir;

        /// <summary>Disparado no toque de "Cancelar fusão" com fusão pendente.
        /// O cancelamento NÃO devolve os PA; o aviso vive na ficha do topo.</summary>
        public event Action AoCancelarFusao;

        readonly Label _rodada, _clima, _nome, _pv, _pa, _pp;
        readonly Label _fichaTitulo, _fichaNumeros, _fichaTexto;
        readonly VisualElement _iniciativa, _feiticos, _pvCheio, _pipsPa, _pipsPp;
        readonly Button _encerrar, _fundir;

        QuadroDaBatalha _quadro = new QuadroDaBatalha();

        /// <summary>
        /// Monta a tela a partir dos arquivos de <c>Assets/UI/Resources/</c>.
        ///
        /// Estoura com o nome do arquivo que faltou em vez de devolver
        /// <c>null</c>: layout ausente vira tela preta e meia hora procurando o
        /// motivo — a exceção diz o motivo na primeira linha.
        /// </summary>
        public static TelaDeBatalha Carregar()
        {
            var layout = Resources.Load<VisualTreeAsset>(RecursoDoLayout);
            if (layout == null)
                throw new InvalidOperationException(
                    "não achei o layout 'Assets/UI/Resources/" + RecursoDoLayout + ".uxml'");

            var estilo = Resources.Load<StyleSheet>(RecursoDoEstilo);
            if (estilo == null)
                throw new InvalidOperationException(
                    "não achei o estilo 'Assets/UI/Resources/" + RecursoDoEstilo + ".uss'");

            return new TelaDeBatalha(layout, estilo);
        }

        public TelaDeBatalha(VisualTreeAsset layout, StyleSheet estilo)
        {
            if (layout == null) throw new ArgumentNullException("layout");

            Raiz = layout.Instantiate();
            Raiz.name = "tela-de-batalha";

            // O `TemplateContainer` que o clone devolve não tem tamanho nenhum:
            // sem isto a HUD inteira colapsa numa faixa de zero altura no topo,
            // e o `space-between` do layout não tem o que distribuir.
            Raiz.style.position = Position.Absolute;
            Raiz.style.left = 0;
            Raiz.style.top = 0;
            Raiz.style.right = 0;
            Raiz.style.bottom = 0;

            // A raiz cobre a tela inteira. Se ela capturasse o toque, o jogador
            // não conseguiria mais tocar em casa nenhuma do tabuleiro — foi o
            // defeito "a interface engolia todo clique e arrasto" da linha JS.
            Raiz.pickingMode = PickingMode.Ignore;

            if (estilo != null) Raiz.styleSheets.Add(estilo);

            Hud = Exigir<VisualElement>("hud-batalha");
            _rodada = Exigir<Label>("rotulo-rodada");
            _clima = Exigir<Label>("rotulo-clima");
            _iniciativa = Exigir<VisualElement>("ordem-de-iniciativa");
            _fichaTitulo = Exigir<Label>("ficha-titulo");
            _fichaNumeros = Exigir<Label>("ficha-numeros");
            _fichaTexto = Exigir<Label>("ficha-texto");
            _nome = Exigir<Label>("rotulo-nome");
            _pvCheio = Exigir<VisualElement>("medidor-pv-cheio");
            _pv = Exigir<Label>("rotulo-pv");
            _pa = Exigir<Label>("rotulo-pa");
            _pp = Exigir<Label>("rotulo-pp");
            _pipsPa = Exigir<VisualElement>("pips-pa");
            _pipsPp = Exigir<VisualElement>("pips-pp");
            _feiticos = Exigir<VisualElement>("barra-de-feiticos");
            _encerrar = Exigir<Button>("botao-encerrar-turno");
            _fundir = Exigir<Button>("botao-fundir");

            _encerrar.clicked += EncerrarTurno;
            _fundir.clicked += TocarFusao;

            // Quem decide retrato ou paisagem é o tamanho real do painel: USS não
            // tem `@media`, então a troca de classe é feita aqui, no primeiro
            // instante em que a tela sabe de que tamanho ela é.
            Raiz.RegisterCallback<GeometryChangedEvent>(
                e => AplicarOrientacao(e.newRect.width, e.newRect.height));

            Montar(new QuadroDaBatalha());
        }

        T Exigir<T>(string nome) where T : VisualElement
        {
            var e = Raiz.Q<T>(nome);
            if (e == null)
                throw new InvalidOperationException(
                    "o layout '" + RecursoDoLayout + ".uxml' não tem um " + typeof(T).Name +
                    " chamado '" + nome + "' — a tela e o layout saíram de sincronia");
            return e;
        }

        // ==================================================================== pintura

        /// <summary>Redesenha a tela inteira a partir do quadro recebido.</summary>
        public void Montar(QuadroDaBatalha quadro)
        {
            _quadro = quadro ?? new QuadroDaBatalha();

            _rodada.text = "Rodada " + _quadro.Rodada;
            _clima.text = _quadro.Clima ?? string.Empty;

            PintarOrdem();
            PintarRecursos();
            PintarFeiticos();
            PintarFusao();
            PintarFichaInicial();
        }

        /// <summary>
        /// O botão de fusão tem TRÊS estados, e o terceiro é não existir: fora
        /// do turno do jogador, ou sem candidato e sem pendência, ele some em
        /// vez de apagar. Botão apagado pede explicação ("por que não posso?");
        /// a fusão só é uma pergunta quando há um aliado colado, e aí o botão
        /// aparece já respondendo — com o custo escrito nele.
        /// </summary>
        void PintarFusao()
        {
            bool mostrar = _quadro.ETurnoDoJogador && (_quadro.FusaoPendente || _quadro.PodeFundir);
            _fundir.style.display = mostrar ? DisplayStyle.Flex : DisplayStyle.None;
            if (!mostrar) return;

            // Pendente, o MESMO botão vira o de cancelar — dois botões dariam
            // um par que nunca existe junto e um vão morto no meio das ações.
            _fundir.EnableInClassList("botao--cancelar", _quadro.FusaoPendente);
            _fundir.text = _quadro.FusaoPendente
                ? "Cancelar fusão"
                : "Fundir · " + _quadro.CustoDaFusao + " PA";
        }

        void PintarOrdem()
        {
            _iniciativa.Clear();

            int mostradas = 0;
            for (int i = 0; i < _quadro.Ordem.Count && mostradas < MaximoNaOrdem; i++)
            {
                var u = _quadro.Ordem[i];
                if (u == null || !u.Viva) continue;

                var ficha = Toque.Alvo(new Button());
                ficha.name = "iniciativa-" + u.Uid;
                ficha.AddToClassList("iniciativa__ficha");
                ficha.AddToClassList(u.Lado == LadoNaTela.Heroi
                    ? "iniciativa__ficha--heroi"
                    : "iniciativa__ficha--monstro");
                if (mostradas == 0) ficha.AddToClassList("iniciativa__ficha--agora");

                var sigla = new Label(Encurta(u.Nome));
                sigla.AddToClassList("iniciativa__sigla");
                sigla.pickingMode = PickingMode.Ignore;
                ficha.Add(sigla);

                var trilho = new VisualElement();
                trilho.AddToClassList("iniciativa__pv");
                trilho.pickingMode = PickingMode.Ignore;
                var cheio = new VisualElement();
                cheio.AddToClassList("iniciativa__pv-cheio");
                cheio.style.width = Length.Percent(u.FracaoDePv * 100f);
                trilho.Add(cheio);
                ficha.Add(trilho);

                var uid = u.Uid;                    // a variável do laço não sobrevive ao clique
                ficha.clicked += () => TocarUnidade(uid);

                _iniciativa.Add(ficha);
                mostradas++;
            }
        }

        void PintarRecursos()
        {
            var u = _quadro.Atual;
            if (u == null)
            {
                _nome.text = string.Empty;
                _pv.text = string.Empty;
                _pa.text = string.Empty;
                _pp.text = string.Empty;
                _pvCheio.style.width = Length.Percent(0f);
                _pipsPa.Clear();
                _pipsPp.Clear();
                return;
            }

            _nome.text = u.Nome;
            _pv.text = u.Pv + " / " + u.PvMax + " PV";
            _pvCheio.style.width = Length.Percent(u.FracaoDePv * 100f);
            _pa.text = "PA " + u.Pa + "/" + u.PaMax;
            _pp.text = "PP " + u.Pp + "/" + u.PpMax;
            Pips(_pipsPa, u.Pa, u.PaMax);
            Pips(_pipsPp, u.Pp, u.PpMax);
        }

        /// <summary>
        /// Bolinhas de PA e PP. O número já está escrito ao lado; as bolinhas
        /// existem porque no meio de um turno ninguém lê "4/6" — se conta três
        /// acesas de relance e pronto.
        /// </summary>
        static void Pips(VisualElement caixa, int atual, int maximo)
        {
            caixa.Clear();
            for (int i = 0; i < maximo; i++)
            {
                var p = new VisualElement();
                p.AddToClassList("pip");
                if (i < atual) p.AddToClassList("pip--cheio");
                p.pickingMode = PickingMode.Ignore;
                caixa.Add(p);
            }
        }

        void PintarFeiticos()
        {
            _feiticos.Clear();

            var u = _quadro.Atual;
            if (u == null || !_quadro.ETurnoDoJogador)
            {
                var espera = new Label(u != null ? "Turno de " + u.Nome + "…" : "Aguarde…");
                espera.AddToClassList("feiticos__espera");
                espera.pickingMode = PickingMode.Ignore;
                _feiticos.Add(espera);
                _encerrar.SetEnabled(false);
                return;
            }

            _encerrar.SetEnabled(true);

            if (_quadro.Feiticos.Count == 0)
            {
                var vazio = new Label("Sem feitiços.");
                vazio.AddToClassList("feiticos__espera");
                vazio.pickingMode = PickingMode.Ignore;
                _feiticos.Add(vazio);
                return;
            }

            for (int i = 0; i < _quadro.Feiticos.Count; i++)
            {
                var f = _quadro.Feiticos[i];
                if (f == null) continue;
                _feiticos.Add(BotaoDeFeitico(f, u));
            }
        }

        Button BotaoDeFeitico(FeiticoNaTela f, UnidadeNaTela dono)
        {
            var b = Toque.Alvo(new Button());
            b.name = "feitico-" + f.Id;
            b.AddToClassList("feitico");

            bool pode = f.PodeLancar(dono.Pa);
            if (!pode) b.AddToClassList("feitico--indisponivel");
            if (f.Id == _quadro.FeiticoEscolhido) b.AddToClassList("feitico--escolhido");

            var cor = CorDoElemento(f.Elemento);
            if (cor.HasValue)
            {
                var c = cor.Value;
                b.style.backgroundColor = new Color(c.r, c.g, c.b, 0.20f);
            }

            var custo = new Label(f.CustoDePa.ToString());
            custo.AddToClassList("feitico__custo");
            custo.pickingMode = PickingMode.Ignore;
            b.Add(custo);

            // A recarga aparece SEMPRE que o feitiço tem uma: apagada quando está
            // pronto (é o preço, e o jogador escolhe o turno sabendo dele) e acesa
            // com o que falta quando está esfriando. Mostrar só o que falta
            // esconde metade da informação justamente na hora de planejar.
            if (f.Recarga > 0 || f.RecargaRestante > 0)
            {
                var contando = f.RecargaRestante > 0;
                var r = new Label(contando ? f.RecargaRestante.ToString() : f.Recarga.ToString());
                r.AddToClassList("feitico__recarga");
                if (contando) r.AddToClassList("feitico__recarga--contando");
                r.pickingMode = PickingMode.Ignore;
                b.Add(r);
            }

            var nome = new Label(f.Nome);
            nome.AddToClassList("feitico__nome");
            nome.pickingMode = PickingMode.Ignore;
            b.Add(nome);

            var id = f.Id;
            b.clicked += () => TocarFeitico(id);

            return b;
        }

        // ================================================================== toque

        /*
         * Os três métodos abaixo são o que os botões CHAMAM, e são públicos de
         * propósito.
         *
         * Teste EditMode não tem painel, e sem painel o UI Toolkit não despacha
         * evento nenhum: `botao.SendEvent(...)` sai calado, e um teste que
         * "clica" assim passa sem ter clicado em nada. Chamar o mesmo método que
         * o botão chama é o mais perto da verdade que dá para chegar sem tela —
         * e deixa a ligação botão→método numa linha só, visível em diff.
         */

        /// <summary>O que o botão de encerrar turno faz.</summary>
        public void EncerrarTurno()
        {
            var f = AoEncerrarTurno;
            if (f != null) f();
        }

        /// <summary>
        /// O que o botão de fusão faz: declara ou cancela, conforme o estado do
        /// quadro. A validade fica com o motor — se faltar PA, a recusa dele
        /// volta em português e vira texto na ficha do topo, o mesmo caminho de
        /// toda jogada recusada.
        /// </summary>
        public void TocarFusao()
        {
            if (!_quadro.ETurnoDoJogador) return;

            if (_quadro.FusaoPendente)
            {
                var c = AoCancelarFusao;
                if (c != null) c();
                return;
            }

            if (!_quadro.PodeFundir) return;
            var f = AoFundir;
            if (f != null) f();
        }

        /// <summary>
        /// O que um botão da barra de feitiços faz.
        ///
        /// O toque SEMPRE explica o feitiço na ficha do topo, inclusive o
        /// indisponível: é ali que o jogador descobre se falta PA ou se a recarga
        /// ainda corre. Botão morto e mudo é o que faz repetir o toque.
        /// A escolha, essa, só sai se o feitiço puder mesmo ser lançado.
        /// </summary>
        public void TocarFeitico(string id)
        {
            var f = AchaFeitico(id);
            if (f == null) return;

            MostrarFichaDoFeitico(f, _quadro.Atual);

            if (_quadro.Atual == null || !f.PodeLancar(_quadro.Atual.Pa)) return;
            var ev = AoEscolherFeitico;
            if (ev != null) ev(f.Id);
        }

        /// <summary>O que uma ficha da faixa de iniciativa faz.</summary>
        public void TocarUnidade(string uid)
        {
            for (int i = 0; i < _quadro.Ordem.Count; i++)
            {
                if (_quadro.Ordem[i] != null && _quadro.Ordem[i].Uid == uid)
                {
                    MostrarFichaDaUnidade(_quadro.Ordem[i]);
                    return;
                }
            }
        }

        // ====================================================================== ficha

        void PintarFichaInicial()
        {
            var escolhido = AchaFeitico(_quadro.FeiticoEscolhido);
            if (escolhido != null && _quadro.Atual != null)
            {
                MostrarFichaDoFeitico(escolhido, _quadro.Atual);
                return;
            }
            if (_quadro.Atual != null)
            {
                MostrarFichaDaUnidade(_quadro.Atual);
                return;
            }
            MostrarFicha(string.Empty, string.Empty, "Toque num feitiço para ver o que ele faz.");
        }

        FeiticoNaTela AchaFeitico(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            for (int i = 0; i < _quadro.Feiticos.Count; i++)
                if (_quadro.Feiticos[i] != null && _quadro.Feiticos[i].Id == id)
                    return _quadro.Feiticos[i];
            return null;
        }

        /// <summary>Escreve à mão na ficha do topo. Público porque o teste mede o que ela diz.</summary>
        public void MostrarFicha(string titulo, string numeros, string texto)
        {
            _fichaTitulo.text = titulo ?? string.Empty;
            _fichaNumeros.text = numeros ?? string.Empty;
            _fichaTexto.text = texto ?? string.Empty;
        }

        /// <summary>
        /// A ficha de um feitiço. É a substituta do balão de <c>hover</c> do
        /// hud.js: no toque não existe "passar por cima", então a explicação não
        /// pode depender de um estado que o dedo não sabe produzir.
        /// </summary>
        public void MostrarFichaDoFeitico(FeiticoNaTela f, UnidadeNaTela dono)
        {
            if (f == null) return;

            var n = new StringBuilder();
            n.Append(f.CustoDePa).Append(" PA");
            if (f.AlcanceMax > 0)
                n.Append(" · alcance ").Append(f.AlcanceMin).Append("–").Append(f.AlcanceMax);
            if (f.Recarga > 0)
                n.Append(" · recarga ").Append(f.Recarga);
            if (!string.IsNullOrEmpty(f.Forma) && f.Forma != "single" && f.TamanhoDaArea > 0)
                n.Append(" · área ").Append(f.Forma).Append(" ").Append(f.TamanhoDaArea);

            var t = new StringBuilder();
            if (dono != null && f.RecargaRestante > 0)
            {
                t.Append("Recarregando: ").Append(f.RecargaRestante)
                 .Append(f.RecargaRestante > 1 ? " rodadas." : " rodada.").Append(" ");
            }
            else if (dono != null && dono.Pa < f.CustoDePa)
            {
                t.Append("PA insuficiente: custa ").Append(f.CustoDePa)
                 .Append(", você tem ").Append(dono.Pa).Append(". ");
            }
            t.Append(f.Descricao ?? string.Empty);

            MostrarFicha(f.Nome, n.ToString(), t.ToString());
        }

        /// <summary>A ficha de uma criatura, aberta pelo toque na faixa de iniciativa.</summary>
        public void MostrarFichaDaUnidade(UnidadeNaTela u)
        {
            if (u == null) return;

            var n = new StringBuilder();
            n.Append(u.Pv).Append(" / ").Append(u.PvMax).Append(" PV");
            n.Append(" · ").Append(u.Pa).Append("/").Append(u.PaMax).Append(" PA");
            n.Append(" · ").Append(u.Pp).Append("/").Append(u.PpMax).Append(" PP");

            var t = new StringBuilder();
            t.Append(u.Lado == LadoNaTela.Heroi ? "Herói" : "Monstro");
            var elemento = NomeDoElemento(u.Elemento);
            if (!string.IsNullOrEmpty(elemento) && u.Elemento != Elemento.Neutro)
                t.Append(" · ").Append(elemento);

            MostrarFicha(u.Nome, n.ToString(), t.ToString());
        }

        // ================================================================ orientação

        /// <summary>
        /// Troca o arranjo entre em pé (9:16) e deitado (16:9).
        ///
        /// Recebe as medidas em vez de ler <c>Screen</c> porque assim o teste
        /// consegue cobrar as duas orientações sem tela nenhuma — e porque o
        /// painel pode não ocupar a tela inteira.
        /// </summary>
        public void AplicarOrientacao(float largura, float altura)
        {
            EstaDeitada = largura >= altura;
            Hud.EnableInClassList("hud--paisagem", EstaDeitada);
            Hud.EnableInClassList("hud--retrato", !EstaDeitada);
        }

        // ==================================================================== apoio

        /// <summary>
        /// Nome do elemento como o acervo o escreve ("Fogo", "Água"). Devolve o
        /// id cru quando o quadro não trouxe a tabela — nunca uma tradução
        /// inventada aqui dentro.
        /// </summary>
        string NomeDoElemento(string id)
        {
            if (string.IsNullOrEmpty(id)) return string.Empty;
            if (_quadro.Elementos == null) return id;
            InfoDeElemento info;
            return _quadro.Elementos.TryGetValue(id, out info) && info != null && !string.IsNullOrEmpty(info.Nome)
                ? info.Nome
                : id;
        }

        Color? CorDoElemento(string id)
        {
            if (string.IsNullOrEmpty(id) || id == Elemento.Neutro) return null;
            if (_quadro.Elementos == null) return null;
            InfoDeElemento info;
            if (!_quadro.Elementos.TryGetValue(id, out info) || info == null || string.IsNullOrEmpty(info.Cor))
                return null;
            Color c;
            return ColorUtility.TryParseHtmlString(info.Cor, out c) ? c : (Color?)null;
        }

        /// <summary>
        /// Nome curto para a ficha de 52 pontos da faixa de iniciativa. Cortar é
        /// aceitável porque o nome inteiro está a um toque de distância, na ficha
        /// do topo — o que não é aceitável é a ficha crescer e comer o tabuleiro.
        /// </summary>
        static string Encurta(string nome)
        {
            if (string.IsNullOrEmpty(nome)) return "?";
            var corte = nome.IndexOf(' ');
            var palavra = corte > 0 ? nome.Substring(0, corte) : nome;
            return palavra.Length <= 8 ? palavra : palavra.Substring(0, 7) + "…";
        }
    }
}
