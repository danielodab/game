using System;
using UnityEngine;
using UnityEngine.UIElements;

namespace Soterra.Interface
{
    /// <summary>
    /// Pendura a <see cref="TelaDeBatalha"/> numa tela de verdade.
    ///
    /// É o ÚNICO <c>MonoBehaviour</c> da interface, e faz uma coisa só: criar o
    /// painel e repassar o quadro. Toda a montagem, o toque e a orientação estão
    /// na tela pura, que roda em teste sem cena — se a lógica morasse aqui,
    /// nada disso seria testável fora de Play.
    ///
    /// Nada é arrastado no Inspector: o <c>UIDocument</c>, o <c>PanelSettings</c>
    /// e o tema são criados e carregados em código. É o mesmo motivo do resto do
    /// projeto — referência arrastada não se revisa em diff.
    ///
    /// Nenhuma chamada a <c>Input.</c> aqui nem na tela: o legado LANÇA exceção
    /// neste projeto (<c>activeInputHandler: 1</c>). O toque chega aos botões
    /// pelo sistema de eventos do próprio UI Toolkit, que já lê o Input System
    /// novo — o jeito certo de não escrever leitura de toque à mão.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class HudDeBatalha : MonoBehaviour
    {
        /// <summary>Caminho do tema em <c>Resources</c>. Sem extensão.</summary>
        public const string RecursoDoTema = "soterra-tema";

        /// <summary>
        /// DPI de referência do painel. 160 e não 96 de propósito: com
        /// <c>ConstantPhysicalSize</c> a conta é <c>escala = dpi da tela / esta</c>,
        /// e 160 é a densidade em que 1 dp vale 1 px. Assim os 44 px do
        /// <c>.alvo</c> no USS são 44 pontos DE VERDADE em qualquer aparelho —
        /// com 96 o mesmo botão sairia 1,7× maior e a tela do celular acabaria.
        /// </summary>
        public const float DpiDeReferencia = 160f;

        /// <summary>A tela montada. Nula antes de <see cref="Montar"/>.</summary>
        public TelaDeBatalha Tela { get; private set; }

        UIDocument _documento;
        PanelSettings _painel;

        void OnEnable()
        {
            Montar();
        }

        void OnDisable()
        {
            // O `PanelSettings` é criado em memória e não pertence a asset
            // nenhum: sem isto ele vaza um objeto por vez que a cena recarrega.
            if (_painel != null)
            {
                if (Application.isPlaying) Destroy(_painel);
                else DestroyImmediate(_painel);
                _painel = null;
            }
        }

        /// <summary>
        /// Cria o painel e a tela. Idempotente — chamar de novo não remonta.
        /// </summary>
        public void Montar()
        {
            if (Tela != null) return;

            Tela = TelaDeBatalha.Carregar();

            _painel = ScriptableObject.CreateInstance<PanelSettings>();
            _painel.name = "painel-de-batalha";
            _painel.themeStyleSheet = Resources.Load<ThemeStyleSheet>(RecursoDoTema);
            if (_painel.themeStyleSheet == null)
                throw new InvalidOperationException(
                    "não achei o tema 'Assets/UI/Resources/" + RecursoDoTema +
                    ".tss' — sem ele o painel sobe sem fonte e sem estilo de controle");

            _painel.scaleMode = PanelScaleMode.ConstantPhysicalSize;
            _painel.referenceDpi = DpiDeReferencia;

            _documento = GetComponent<UIDocument>();
            if (_documento == null) _documento = gameObject.AddComponent<UIDocument>();
            _documento.panelSettings = _painel;

            var raiz = _documento.rootVisualElement;
            if (raiz == null)
                throw new InvalidOperationException(
                    "o UIDocument subiu sem raiz — o painel não foi criado");

            // A raiz do documento cobre a tela inteira. Se ela capturasse toque,
            // o tabuleiro pararia de responder debaixo dela.
            raiz.pickingMode = PickingMode.Ignore;
            raiz.Add(Tela.Raiz);

            // Primeira orientação pelo tamanho da janela. Depois disso quem manda
            // é o `GeometryChangedEvent` que a própria tela escuta — girar o
            // aparelho não passa por aqui.
            Tela.AplicarOrientacao(Screen.width, Screen.height);
        }

        /// <summary>Repinta a tela com o quadro recebido.</summary>
        public void Mostrar(QuadroDaBatalha quadro)
        {
            Montar();
            Tela.Montar(quadro);
        }
    }
}
