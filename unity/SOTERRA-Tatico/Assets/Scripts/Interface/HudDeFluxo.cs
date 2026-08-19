using System;
using UnityEngine;
using UnityEngine.UIElements;

namespace Soterra.Interface
{
    /// <summary>
    /// Pendura a <see cref="TelaDeFluxo"/> numa tela de verdade — o irmão do
    /// <see cref="HudDeBatalha"/>, com a mesma disciplina: um
    /// <c>MonoBehaviour</c> fino que só cria o painel e repassa o quadro; toda
    /// a montagem e o toque moram na tela pura, testável sem cena.
    ///
    /// Painel PRÓPRIO e não um pedaço do painel da batalha. Dois motivos, e o
    /// segundo é o que decide: (1) a tela de fluxo é modal e cobre a HUD
    /// inteira, e (2) ela precisa ficar POR CIMA — dois documentos no mesmo
    /// painel se ordenam por ordem de inserção, que muda quando alguém
    /// reordena a montagem; <c>sortingOrder</c> é declarado e não depende de
    /// ninguém lembrar da ordem.
    ///
    /// Nenhuma chamada a <c>Input.</c>: o legado LANÇA exceção neste projeto
    /// (<c>activeInputHandler: 1</c>). O toque chega pelos eventos do próprio
    /// UI Toolkit, que já lê o Input System novo.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class HudDeFluxo : MonoBehaviour
    {
        /// <summary>Caminho do tema em <c>Resources</c>. Sem extensão.</summary>
        public const string RecursoDoTema = HudDeBatalha.RecursoDoTema;

        /// <summary>
        /// Acima do painel da batalha. O número é folgado de propósito: uma
        /// camada nova que apareça no meio (um aviso, um menu) ainda cabe
        /// entre os dois sem ninguém precisar renumerar.
        /// </summary>
        public const int OrdemDeSobreposicao = 10;

        /// <summary>A tela montada. Nula antes de <see cref="Montar"/>.</summary>
        public TelaDeFluxo Tela { get; private set; }

        UIDocument _documento;
        PanelSettings _painel;

        void OnEnable()
        {
            Montar();
        }

        void OnDisable()
        {
            // O `PanelSettings` é criado em memória e não pertence a asset
            // nenhum: sem isto ele vaza um objeto por recarga de cena.
            if (_painel != null)
            {
                if (Application.isPlaying) Destroy(_painel);
                else DestroyImmediate(_painel);
                _painel = null;
            }
        }

        /// <summary>Cria o painel e a tela. Idempotente.</summary>
        public void Montar()
        {
            if (Tela != null) return;

            Tela = TelaDeFluxo.Carregar();

            _painel = ScriptableObject.CreateInstance<PanelSettings>();
            _painel.name = "painel-de-fluxo";
            _painel.themeStyleSheet = Resources.Load<ThemeStyleSheet>(RecursoDoTema);
            if (_painel.themeStyleSheet == null)
                throw new InvalidOperationException(
                    "não achei o tema 'Assets/UI/Resources/" + RecursoDoTema +
                    ".tss' — sem ele o painel sobe sem fonte e sem estilo de controle");

            // A mesma escala física da HUD de batalha: com `referenceDpi = 160`,
            // 1 px do USS é 1 ponto de verdade, e os 44 do `.alvo` são 44
            // pontos em qualquer aparelho.
            _painel.scaleMode = PanelScaleMode.ConstantPhysicalSize;
            _painel.referenceDpi = HudDeBatalha.DpiDeReferencia;
            _painel.sortingOrder = OrdemDeSobreposicao;

            _documento = GetComponent<UIDocument>();
            if (_documento == null) _documento = gameObject.AddComponent<UIDocument>();
            _documento.panelSettings = _painel;

            var raiz = _documento.rootVisualElement;
            if (raiz == null)
                throw new InvalidOperationException(
                    "o UIDocument subiu sem raiz — o painel não foi criado");

            // A raiz do documento cobre a tela inteira e fica SEMPRE presente,
            // mesmo com a tela de fluxo escondida. Se ela capturasse toque, o
            // tabuleiro pararia de responder por baixo dela durante a batalha
            // — o defeito "a interface engolia todo clique", já pago uma vez.
            raiz.pickingMode = PickingMode.Ignore;
            raiz.Add(Tela.Raiz);

            Tela.AplicarOrientacao(Screen.width, Screen.height);
        }

        /// <summary>Repinta a tela com o quadro recebido. Tipo <c>Nenhum</c> a esconde.</summary>
        public void Mostrar(QuadroDeFluxo quadro)
        {
            Montar();
            Tela.Montar(quadro);
        }
    }
}
