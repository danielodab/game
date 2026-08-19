using UnityEngine;
using UnityEngine.InputSystem;

namespace Soterra.Jogo
{
    /// <summary>
    /// A câmera obedecendo ao jogador, e se reenquadrando sozinha quando a tela
    /// muda de tamanho.
    ///
    /// Existe por causa de dois defeitos que só apareceram com o jogo aberto de
    /// verdade, e que nenhuma foto em lote pega:
    ///
    /// 1. `Palco.Enquadrar()` era chamado UMA vez, na montagem. Em Play a
    ///    proporção da janela ainda não é a final nesse instante — e, pior, ela
    ///    muda quando alguém redimensiona o painel ou troca a resolução do Game.
    ///    O enquadramento certo no quadro zero vira câmera colada no quadro
    ///    seguinte, e não havia nada que a corrigisse.
    ///
    /// 2. A câmera do jogo é FIXA em 3/4 por decisão de projeto — mas fixa em
    ///    ÂNGULO não quer dizer imóvel. Sem afastar, aproximar e arrastar, uma
    ///    sala de 21×17 num celular fica ilegível, e o jogador não tem como
    ///    olhar o canto onde está o monstro que vai matá-lo.
    ///
    /// O ângulo continua travado: o giro é só de 90° em 90°, pelo `Palco`.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class CameraDoJogador : MonoBehaviour
    {
        /// <summary>Quanto o dedo/rolagem aproxima por passo, em fração.</summary>
        public const float PassoDeZoom = 0.12f;

        /// <summary>Limites do afastamento, em múltiplos do enquadramento que
        /// mostra a sala inteira. Abaixo de 1 aproxima; acima, afasta.</summary>
        public const float ZoomMinimo = 0.35f;
        public const float ZoomMaximo = 1.15f;

        Cena.Palco _palco;
        Camera _cam;
        float _zoom = 1f;
        Vector3 _arrasto;
        Vector2Int _telaConhecida;
        float _tamanhoDaSala;

        public void Ligar(Cena.Palco palco)
        {
            _palco = palco;
            _cam = palco != null ? palco.Camera : null;
            _zoom = 1f;
            _arrasto = Vector3.zero;
            _telaConhecida = new Vector2Int(-1, -1);
            Reenquadrar(forcar: true);
        }

        /// <summary>
        /// Refaz o enquadramento quando a tela muda — e guarda o tamanho que o
        /// `Palco` achou para a sala inteira, que é a referência do zoom.
        /// </summary>
        public void Reenquadrar(bool forcar = false)
        {
            if (_palco == null || _cam == null) return;

            var tela = new Vector2Int(Screen.width, Screen.height);
            if (!forcar && tela == _telaConhecida) return;
            _telaConhecida = tela;

            // O aspect precisa ser o da tela ANTES de enquadrar: `Enquadrar` lê
            // `_cam.aspect`, e em Play ele pode estar com o valor do quadro
            // anterior. Escrever aqui deixa os dois em acordo no mesmo quadro.
            if (tela.y > 0) _cam.aspect = tela.x / (float)tela.y;
            _palco.Enquadrar();
            _tamanhoDaSala = _cam.orthographicSize;
            Aplicar();
        }

        void Update()
        {
            Reenquadrar();
            if (_cam == null) return;

            LerZoom();
            LerArrasto();
        }

        void LerZoom()
        {
            float delta = 0f;

            var mouse = Mouse.current;
            if (mouse != null)
            {
                float roda = mouse.scroll.ReadValue().y;
                if (Mathf.Abs(roda) > 0.01f) delta -= Mathf.Sign(roda) * PassoDeZoom;
            }

            // Pinça: a distância entre dois dedos. É o gesto que todo mundo
            // tenta primeiro num tabuleiro de celular, antes de procurar botão.
            var toque = Touchscreen.current;
            if (toque != null)
            {
                var a = toque.touches[0];
                var b = toque.touches[1];
                if (a.press.isPressed && b.press.isPressed)
                {
                    float agora = Vector2.Distance(a.position.ReadValue(), b.position.ReadValue());
                    if (_pincaAnterior > 0f && Mathf.Abs(agora - _pincaAnterior) > 1f)
                        delta -= (agora - _pincaAnterior) / Mathf.Max(1f, Screen.height) * 2.4f;
                    _pincaAnterior = agora;
                }
                else _pincaAnterior = 0f;
            }

            if (Mathf.Abs(delta) < 0.0001f) return;
            _zoom = Mathf.Clamp(_zoom + delta, ZoomMinimo, ZoomMaximo);
            Aplicar();
        }

        float _pincaAnterior;
        Vector2 _arrastoAnterior;
        bool _arrastando;

        void LerArrasto()
        {
            var mouse = Mouse.current;
            var toque = Touchscreen.current;

            bool pressionado = false;
            Vector2 ponto = Vector2.zero;

            // Botão DIREITO no mouse: o esquerdo é do jogo (andar, mirar), e
            // roubar o clique do tabuleiro para arrastar seria trocar um
            // problema por outro.
            if (mouse != null && mouse.rightButton.isPressed)
            {
                pressionado = true;
                ponto = mouse.position.ReadValue();
            }
            else if (toque != null && toque.touches[0].press.isPressed &&
                     !toque.touches[1].press.isPressed && _zoom < 0.99f)
            {
                // No dedo, arrastar só vale APROXIMADO: com a sala inteira na
                // tela não há para onde arrastar, e o gesto roubaria o toque de
                // andar, que é o principal.
                pressionado = true;
                ponto = toque.touches[0].position.ReadValue();
            }

            if (!pressionado) { _arrastando = false; return; }

            if (!_arrastando) { _arrastando = true; _arrastoAnterior = ponto; return; }

            var d = ponto - _arrastoAnterior;
            _arrastoAnterior = ponto;
            if (d.sqrMagnitude < 0.01f) return;

            // Move no PLANO da câmera, para o arrasto acompanhar o dedo em vez
            // de deslizar na diagonal do mundo.
            float escala = _cam.orthographicSize * 2f / Mathf.Max(1, Screen.height);
            _arrasto -= _cam.transform.right * d.x * escala;
            _arrasto -= _cam.transform.up * d.y * escala;
            Aplicar();
        }

        void Aplicar()
        {
            if (_cam == null || _tamanhoDaSala <= 0f) return;
            _cam.orthographicSize = _tamanhoDaSala * _zoom;
            _cam.transform.position = _posicaoDeOrigem + _arrasto;
        }

        Vector3 _posicaoDeOrigem;

        /// <summary>Guarda de onde o `Palco` pôs a câmera, para o arrasto ser
        /// deslocamento a partir dali e o botão de centrar poder voltar.</summary>
        public void MarcarOrigem()
        {
            if (_cam != null) _posicaoDeOrigem = _cam.transform.position;
        }

        /// <summary>Volta ao enquadramento da sala inteira.</summary>
        public void Centrar()
        {
            _zoom = 1f;
            _arrasto = Vector3.zero;
            Aplicar();
        }
    }
}
