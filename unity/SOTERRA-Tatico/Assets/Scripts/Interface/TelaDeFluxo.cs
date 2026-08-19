using System;
using System.Globalization;
using UnityEngine;
using UnityEngine.UIElements;

namespace Soterra.Interface
{
    /// <summary>
    /// As telas de FLUXO: o que aparece entre uma sala e a seguinte —
    /// recompensa, escolha de caminho elemental, calabouço concluído e derrota.
    ///
    /// C# PURO, sem <c>MonoBehaviour</c>, como a <see cref="TelaDeBatalha"/> e
    /// pelo mesmo motivo: assim ela monta, responde a toque e é medida em teste
    /// EditMode, sem cena e sem painel. Quem a pendura numa tela de verdade é
    /// <see cref="HudDeFluxo"/>.
    ///
    /// Ela também não guarda estado de jogo: recebe um <see cref="QuadroDeFluxo"/>
    /// por repintura e desenha o que veio. Quem decide se a XP subiu, se a carta
    /// liberou classe e se ainda há sala adiante é a Descida — a tela nem tem
    /// como discordar, porque não sabe nada.
    /// </summary>
    public sealed class TelaDeFluxo
    {
        /// <summary>Caminho em <c>Resources</c> do layout. Sem extensão.</summary>
        public const string RecursoDoLayout = "fluxo";

        /// <summary>Caminho em <c>Resources</c> da folha de estilo.</summary>
        public const string RecursoDoEstilo = "fluxo-estilo";

        /// <summary>Raiz clonada do UXML. É o que se pendura no painel.</summary>
        public VisualElement Raiz { get; private set; }

        /// <summary>O <c>fluxo</c> de dentro do layout — quem carrega as classes de orientação.</summary>
        public VisualElement Painel { get; private set; }

        /// <summary>Verdadeiro com a tela deitada (16:9).</summary>
        public bool EstaDeitada { get; private set; }

        /// <summary>O tipo desenhado na última repintura.</summary>
        public TipoDeFluxo Tipo { get { return _quadro.Tipo; } }

        /// <summary>Toque no botão principal: descer, descer de novo, tentar de novo.</summary>
        public event Action AoAvancar;

        /// <summary>Toque num dos caminhos elementais. O id do elemento vai junto.</summary>
        public event Action<string> AoEscolherElemento;

        /// <summary>
        /// A faixa de baixo, onde vive TUDO que se toca. Pública porque é o que
        /// o teste de toque cobra: numa tela de celular, controle acima da
        /// metade da tela é controle que o polegar não alcança sem trocar a mão
        /// de posição.
        /// </summary>
        public VisualElement Acoes { get; private set; }

        readonly Label _titulo, _subtitulo, _texto;
        readonly VisualElement _corpo, _ganhos, _premios, _elementos;
        readonly Button _botao;

        QuadroDeFluxo _quadro = new QuadroDeFluxo();

        /// <summary>
        /// Monta a tela dos arquivos de <c>Assets/UI/Resources/</c>. Estoura com
        /// o nome do arquivo que faltou em vez de devolver <c>null</c>: layout
        /// ausente vira tela preta, e a exceção diz o motivo na primeira linha.
        /// </summary>
        public static TelaDeFluxo Carregar()
        {
            var layout = Resources.Load<VisualTreeAsset>(RecursoDoLayout);
            if (layout == null)
                throw new InvalidOperationException(
                    "não achei o layout 'Assets/UI/Resources/" + RecursoDoLayout + ".uxml'");

            var estilo = Resources.Load<StyleSheet>(RecursoDoEstilo);
            if (estilo == null)
                throw new InvalidOperationException(
                    "não achei o estilo 'Assets/UI/Resources/" + RecursoDoEstilo + ".uss'");

            return new TelaDeFluxo(layout, estilo);
        }

        public TelaDeFluxo(VisualTreeAsset layout, StyleSheet estilo)
        {
            if (layout == null) throw new ArgumentNullException("layout");

            Raiz = layout.Instantiate();
            Raiz.name = "tela-de-fluxo";

            // O `TemplateContainer` do clone não tem tamanho nenhum: sem isto a
            // tela colapsa numa faixa de zero altura no topo.
            Raiz.style.position = Position.Absolute;
            Raiz.style.left = 0;
            Raiz.style.top = 0;
            Raiz.style.right = 0;
            Raiz.style.bottom = 0;

            if (estilo != null) Raiz.styleSheets.Add(estilo);

            Painel = Exigir<VisualElement>("fluxo");
            _titulo = Exigir<Label>("fluxo-titulo");
            _subtitulo = Exigir<Label>("fluxo-subtitulo");
            _texto = Exigir<Label>("fluxo-texto");
            _corpo = Exigir<VisualElement>("fluxo-corpo");
            _ganhos = Exigir<VisualElement>("fluxo-ganhos");
            _premios = Exigir<VisualElement>("fluxo-premios");
            Acoes = Exigir<VisualElement>("fluxo-acoes");
            _elementos = Exigir<VisualElement>("fluxo-elementos");
            _botao = Exigir<Button>("fluxo-botao");

            _botao.clicked += Avancar;

            Raiz.RegisterCallback<GeometryChangedEvent>(
                e => AplicarOrientacao(e.newRect.width, e.newRect.height));

            Montar(new QuadroDeFluxo());
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

        // =================================================================== pintura

        /// <summary>Redesenha a tela inteira. Tipo <c>Nenhum</c> a esconde.</summary>
        public void Montar(QuadroDeFluxo quadro)
        {
            _quadro = quadro ?? new QuadroDeFluxo();

            var visivel = _quadro.Tipo != TipoDeFluxo.Nenhum;
            Raiz.style.display = visivel ? DisplayStyle.Flex : DisplayStyle.None;

            // Escondida, ela também PARA de receber toque. `display: none` já
            // tira do picking, mas o `Ignore` explícito é o que garante que um
            // painel por cima do tabuleiro nunca engula o dedo — é o defeito
            // "a interface engolia todo clique" que este projeto já pagou uma vez.
            Raiz.pickingMode = visivel ? PickingMode.Position : PickingMode.Ignore;

            _titulo.text = _quadro.Titulo ?? string.Empty;
            _subtitulo.text = _quadro.Subtitulo ?? string.Empty;
            _texto.text = _quadro.Texto ?? string.Empty;

            PintarGanhos();
            PintarPremios();
            PintarElementos();
            PintarBotao();

            // Sem nada no meio, o miolo some em vez de deixar um vão: numa tela
            // de derrota (que não tem ganho nem prêmio) o vazio empurraria o
            // texto para o alto da tela, longe do que ele explica.
            var temCorpo = _quadro.Ganhos.Count > 0 || _quadro.Premios.Count > 0;
            _corpo.style.display = temCorpo ? DisplayStyle.Flex : DisplayStyle.None;
        }

        void PintarGanhos()
        {
            _ganhos.Clear();
            for (int i = 0; i < _quadro.Ganhos.Count; i++)
            {
                var g = _quadro.Ganhos[i];
                if (g == null) continue;

                var caixa = new VisualElement();
                caixa.name = "ganho-" + g.HeroiId;
                caixa.AddToClassList("ganho");
                caixa.pickingMode = PickingMode.Ignore;

                var linha = new VisualElement();
                linha.AddToClassList("ganho__linha");
                linha.pickingMode = PickingMode.Ignore;

                var nome = new Label(g.Nome);
                nome.AddToClassList("ganho__nome");
                nome.pickingMode = PickingMode.Ignore;
                linha.Add(nome);

                var xp = new Label("+" + g.Xp + " XP");
                xp.name = "ganho-xp-" + g.HeroiId;
                xp.AddToClassList("ganho__xp");
                xp.pickingMode = PickingMode.Ignore;
                linha.Add(xp);
                caixa.Add(linha);

                if (g.NiveisSubidos > 0)
                {
                    var subiu = new Label(g.NiveisSubidos > 1
                        ? "Subiu " + g.NiveisSubidos + " níveis — agora nível " + g.Nivel
                        : "Subiu de nível — agora nível " + g.Nivel);
                    subiu.name = "ganho-subiu-" + g.HeroiId;
                    subiu.AddToClassList("ganho__subiu");
                    subiu.pickingMode = PickingMode.Ignore;
                    caixa.Add(subiu);
                }
                else
                {
                    var nivel = new Label("nível " + g.Nivel);
                    nivel.AddToClassList("ganho__nivel");
                    nivel.pickingMode = PickingMode.Ignore;
                    caixa.Add(nivel);
                }

                // O corte por nível só aparece quando existe. "×1" em toda sala
                // seria ruído; "×0,6" numa sala é a explicação de por que a XP
                // veio pequena — e sem ela o jogador acha que o jogo errou.
                if (g.Multiplicador < 0.999)
                {
                    var corte = new Label("calabouço fácil demais: XP ×" +
                        g.Multiplicador.ToString("0.##", CultureInfo.InvariantCulture));
                    corte.AddToClassList("ganho__corte");
                    corte.pickingMode = PickingMode.Ignore;
                    caixa.Add(corte);
                }

                var trilho = new VisualElement();
                trilho.AddToClassList("ganho__trilho");
                trilho.pickingMode = PickingMode.Ignore;
                var cheio = new VisualElement();
                cheio.AddToClassList("ganho__cheio");
                cheio.style.width = Length.Percent(Mathf.Clamp01((float)g.Fracao) * 100f);
                cheio.pickingMode = PickingMode.Ignore;
                trilho.Add(cheio);
                caixa.Add(trilho);

                _ganhos.Add(caixa);
            }
        }

        void PintarPremios()
        {
            _premios.Clear();
            if (_quadro.Tipo != TipoDeFluxo.Recompensa &&
                _quadro.Tipo != TipoDeFluxo.CalaboucoConcluido) return;

            if (_quadro.Premios.Count == 0)
            {
                // Saque vazio é resultado NORMAL (o peso de "nada" existe no
                // acervo justamente para isso). Dizê-lo é melhor do que deixar
                // um espaço em branco que parece falha de carregamento.
                var vazio = new Label("Nenhum despojo desta vez.");
                vazio.name = "premios-vazio";
                vazio.AddToClassList("premios__vazio");
                vazio.pickingMode = PickingMode.Ignore;
                _premios.Add(vazio);
                return;
            }

            for (int i = 0; i < _quadro.Premios.Count; i++)
            {
                var p = _quadro.Premios[i];
                if (p == null) continue;

                var linha = new VisualElement();
                linha.name = "premio-" + p.Id;
                linha.AddToClassList("premio");
                if (!string.IsNullOrEmpty(p.Especie)) linha.AddToClassList("premio--" + p.Especie);
                linha.pickingMode = PickingMode.Ignore;

                Color cor;
                if (!string.IsNullOrEmpty(p.Cor) && ColorUtility.TryParseHtmlString(p.Cor, out cor))
                    linha.style.borderLeftColor = cor;

                var nome = new Label(p.Nome);
                nome.AddToClassList("premio__nome");
                nome.pickingMode = PickingMode.Ignore;
                linha.Add(nome);

                var detalhe = new Label(p.Detalhe ?? string.Empty);
                detalhe.AddToClassList("premio__detalhe");
                detalhe.pickingMode = PickingMode.Ignore;
                linha.Add(detalhe);

                _premios.Add(linha);
            }
        }

        void PintarElementos()
        {
            _elementos.Clear();
            var escolhendo = _quadro.Tipo == TipoDeFluxo.EscolhaDeElemento;
            _elementos.style.display = escolhendo ? DisplayStyle.Flex : DisplayStyle.None;
            if (!escolhendo) return;

            for (int i = 0; i < _quadro.Elementos.Count; i++)
            {
                var op = _quadro.Elementos[i];
                if (op == null) continue;

                var b = Toque.Alvo(new Button());
                b.name = "elemento-" + op.Id;
                b.AddToClassList("elemento");
                b.text = op.Nome;

                Color cor;
                if (!string.IsNullOrEmpty(op.Cor) && ColorUtility.TryParseHtmlString(op.Cor, out cor))
                {
                    b.style.backgroundColor = new Color(cor.r, cor.g, cor.b, 0.24f);
                    b.style.borderLeftColor = cor;
                    b.style.borderRightColor = cor;
                    b.style.borderTopColor = cor;
                    b.style.borderBottomColor = cor;
                }

                var id = op.Id;                  // a variável do laço não sobrevive ao clique
                b.clicked += () => EscolherElemento(id);
                _elementos.Add(b);
            }
        }

        void PintarBotao()
        {
            // Na escolha de elemento NÃO há botão de avançar, e é de propósito:
            // com um "Descer" ao lado dos quatro caminhos, o jogador pularia a
            // escolha sem perceber — e ela é permanente. Sair da tela é escolher.
            var mostrar = _quadro.Tipo != TipoDeFluxo.Nenhum &&
                          _quadro.Tipo != TipoDeFluxo.EscolhaDeElemento &&
                          !string.IsNullOrEmpty(_quadro.RotuloDoBotao);

            _botao.style.display = mostrar ? DisplayStyle.Flex : DisplayStyle.None;
            if (!mostrar) return;

            _botao.text = _quadro.RotuloDoBotao;
            _botao.EnableInClassList("botao--reiniciar", _quadro.Tipo == TipoDeFluxo.Derrota);
        }

        // ===================================================================== toque

        /*
         * Os dois métodos abaixo são o que os botões CHAMAM, e são públicos pela
         * mesma razão que os da tela de batalha: teste EditMode não tem painel, e
         * sem painel `botao.SendEvent(...)` sai calado — um teste que "clica"
         * assim passa sem ter clicado em nada.
         */

        /// <summary>O que o botão principal faz.</summary>
        public void Avancar()
        {
            if (_quadro.Tipo == TipoDeFluxo.Nenhum) return;
            var f = AoAvancar;
            if (f != null) f();
        }

        /// <summary>O que um dos botões de caminho elemental faz.</summary>
        public void EscolherElemento(string elementoId)
        {
            if (_quadro.Tipo != TipoDeFluxo.EscolhaDeElemento || string.IsNullOrEmpty(elementoId)) return;
            var f = AoEscolherElemento;
            if (f != null) f(elementoId);
        }

        // ================================================================ orientação

        /// <summary>
        /// Troca o arranjo entre em pé (9:16) e deitado (16:9). Recebe as
        /// medidas em vez de ler <c>Screen</c> para o teste conseguir cobrar as
        /// duas orientações sem tela nenhuma.
        /// </summary>
        public void AplicarOrientacao(float largura, float altura)
        {
            EstaDeitada = largura >= altura;
            Painel.EnableInClassList("fluxo--paisagem", EstaDeitada);
            Painel.EnableInClassList("fluxo--retrato", !EstaDeitada);
        }
    }
}
