using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Soterra
{
    /// <summary>
    /// Monta a cena INTEIRA por código: chão, obstáculos, herói, câmera e luz.
    ///
    /// Por que por código e não uma cena montada à mão: cena da Unity é um YAML
    /// grande, e eu não consigo clicar no Editor. Escrevendo a cena em C# você
    /// só precisa de um objeto vazio com este componente — e, de quebra, a cena
    /// fica legível no Git e revisável em diff, coisa que arquivo .unity não é.
    ///
    /// COMO USAR (é tudo o que precisa de mouse):
    ///   1. Instale um Editor pelo Unity Hub (2022 LTS ou mais novo).
    ///   2. Abra esta pasta como projeto.
    ///   3. Cena nova (File > New Scene > Basic/Empty).
    ///   4. GameObject > Create Empty, e arraste este script para ele.
    ///   5. Play. Clique numa casa acesa para andar; PP desconta por passo.
    /// </summary>
    public class Bootstrap : MonoBehaviour
    {
        [Header("Tabuleiro")]
        public int Largura = 12;
        public int Altura = 10;
        public int Obstaculos = 14;
        public int Semente = 7;

        [Header("Herói")]
        public int PPporTurno = 3;

        // A paleta é a MESMA do jogo em JS (DATA.classes), para a comparação ser
        // de engenharia e não de gosto: se a cor mudasse junto, você não saberia
        // o que está julgando.
        static readonly Color CorChao   = new Color(0.16f, 0.20f, 0.25f);
        static readonly Color CorChaoAlt= new Color(0.13f, 0.17f, 0.21f);
        static readonly Color CorBloco  = new Color(0.22f, 0.18f, 0.15f);
        static readonly Color CorHeroi  = new Color(0.83f, 0.33f, 0.25f);   // #d4553f
        static readonly Color CorAlcance= new Color(0.31f, 0.62f, 0.42f);   // #4f9d6a
        static readonly Color CorSobre  = new Color(1.00f, 0.82f, 0.54f);   // #ffd08a

        Tabuleiro _tab;
        Transform _heroi;
        Vector2Int _pos;
        int _pp;
        readonly Dictionary<Vector2Int, Renderer> _marcas = new Dictionary<Vector2Int, Renderer>();
        Dictionary<Vector2Int, int> _alcance = new Dictionary<Vector2Int, int>();
        Camera _cam;
        Vector2Int _sob = new Vector2Int(-99, -99);

        /// <summary>A câmera montada, para quem precisa fotografar a cena de fora.</summary>
        public Camera Cam { get { return _cam; } }

        void Start() { Montar(); }

        /// <summary>
        /// Monta a cena. Separado de Start() porque o modo lote (-executeMethod)
        /// nunca entra em Play: sem este método público, a única forma de ver a
        /// cena seria alguém clicando no Editor — e é justamente isso que o
        /// projeto evita.
        /// </summary>
        public void Montar()
        {
            _tab = gameObject.AddComponent<Tabuleiro>();
            _tab.Largura = Largura;
            _tab.Altura = Altura;

            var rnd = new System.Random(Semente);
            for (int i = 0; i < Obstaculos; i++)
            {
                var p = new Vector2Int(rnd.Next(Largura), rnd.Next(Altura));
                if (p == new Vector2Int(1, 1)) continue;   // não tranca a saída do herói
                _tab.Bloquear(p);
            }

            MontaChao();
            MontaLuz();
            MontaCamera();

            _pos = new Vector2Int(1, 1);
            _pp = PPporTurno;
            _heroi = MontaHeroi();
            Reposiciona();
            RecalculaAlcance();
        }

        static readonly int IdCorBase = Shader.PropertyToID("_BaseColor");
        Material _material;
        MaterialPropertyBlock _bloco;

        /// <summary>
        /// UM material para a grade inteira. A cor de cada casa não mora no
        /// material: viaja em MaterialPropertyBlock.
        ///
        /// Dois defeitos morrem aqui. (1) Material por casa: 120 casas repintadas
        /// a cada turno vazavam 120 materiais — e `renderer.material` fora de Play
        /// devolve uma CÓPIA descartada, então a repintura nem chegava na tela.
        /// (2) Com materiais distintos criados em tempo de edição, o SRP Batcher
        /// agrupava todos no mesmo buffer e desenhava o tabuleiro inteiro com a
        /// cor do primeiro — herói laranja incluído, que saía azul como o chão.
        ///
        /// Fosco de propósito: tabuleiro tático quer leitura de cor, não brilho.
        /// Reflexo de ambiente e especular são termos ADITIVOS e neutros; ligados,
        /// lavam a paleta.
        /// </summary>
        Material MaterialBase()
        {
            if (_material != null) return _material;
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            _material = new Material(shader) { name = "SOTERRA/Fosco" };
            _material.SetFloat("_Metallic", 0f);
            _material.SetFloat("_Smoothness", 0f);
            _material.SetFloat("_SpecularHighlights", 0f);
            _material.SetFloat("_EnvironmentReflections", 0f);
            _material.EnableKeyword("_SPECULARHIGHLIGHTS_OFF");
            _material.EnableKeyword("_ENVIRONMENTREFLECTIONS_OFF");
            return _material;
        }

        /// <summary>Pinta um renderizador sem tocar no material dele.</summary>
        void PintaRenderer(Renderer r, Color cor)
        {
            if (_bloco == null) _bloco = new MaterialPropertyBlock();
            r.GetPropertyBlock(_bloco);
            _bloco.SetColor(IdCorBase, cor);
            r.SetPropertyBlock(_bloco);
        }

        GameObject Cubo(string nome, Vector3 pos, Vector3 escala, Color cor, Transform pai)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = nome;
            go.transform.SetParent(pai, false);
            go.transform.position = pos;
            go.transform.localScale = escala;
            var r = go.GetComponent<Renderer>();
            r.sharedMaterial = MaterialBase();
            PintaRenderer(r, cor);
            return go;
        }

        void MontaChao()
        {
            var raiz = new GameObject("Chao").transform;
            for (int y = 0; y < Altura; y++)
            {
                for (int x = 0; x < Largura; x++)
                {
                    var p = new Vector2Int(x, y);
                    bool bloq = !_tab.Caminhavel(p);
                    var cor = bloq ? CorBloco : (((x + y) % 2 == 0) ? CorChao : CorChaoAlt);
                    var alt = bloq ? 0.9f : 0.2f;
                    var go = Cubo("c" + x + "_" + y, _tab.Mundo(p, alt * 0.5f - 0.1f),
                                  new Vector3(0.96f, alt, 0.96f), cor, raiz);
                    if (!bloq) _marcas[p] = go.GetComponent<Renderer>();
                }
            }
        }

        Transform MontaHeroi()
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            go.name = "Heroi";
            go.transform.localScale = new Vector3(0.55f, 0.55f, 0.55f);
            var r = go.GetComponent<Renderer>();
            r.sharedMaterial = MaterialBase();
            PintaRenderer(r, CorHeroi);
            return go.transform;
        }

        void MontaLuz()
        {
            var sol = new GameObject("Sol").AddComponent<Light>();
            sol.type = LightType.Directional;
            sol.intensity = 1.4f;
            sol.color = new Color(1f, 0.94f, 0.85f);
            sol.transform.rotation = Quaternion.Euler(48f, -35f, 0f);
            sol.shadows = LightShadows.Soft;
            RenderSettings.ambientLight = new Color(0.30f, 0.34f, 0.40f);
        }

        void MontaCamera()
        {
            var go = new GameObject("Camera");
            _cam = go.AddComponent<Camera>();
            _cam.backgroundColor = new Color(0.06f, 0.07f, 0.09f);
            _cam.clearFlags = CameraClearFlags.SolidColor;
            // 3/4 isométrico, o mesmo enquadramento do jogo em JS
            go.transform.position = new Vector3(0f, 11f, -9f);
            go.transform.rotation = Quaternion.Euler(50f, 0f, 0f);
            _cam.fieldOfView = 34f;
        }

        void Reposiciona()
        {
            _heroi.position = _tab.Mundo(_pos, 0.55f);
        }

        void RecalculaAlcance()
        {
            _alcance = _tab.Alcance(_pos, _pp);
            foreach (var kv in _marcas)
            {
                bool dentro = _alcance.ContainsKey(kv.Key);
                var baseCor = ((kv.Key.x + kv.Key.y) % 2 == 0) ? CorChao : CorChaoAlt;
                PintaRenderer(kv.Value, dentro
                    ? Color.Lerp(baseCor, CorAlcance, 0.45f)
                    : baseCor);
            }
        }

        void Update()
        {
            if (_cam == null) return;

            // Sem mouse (modo lote, ou celular antes do primeiro toque) não há
            // cursor para seguir — sair cedo evita exceção de dispositivo nulo.
            var ponteiro = PosicaoDoPonteiro();
            if (!ponteiro.HasValue) return;

            // realce sob o cursor: dá o retorno imediato que a grade tática pede
            var raio = _cam.ScreenPointToRay(ponteiro.Value);
            var plano = new Plane(Vector3.up, Vector3.zero);
            float t;
            if (plano.Raycast(raio, out t))
            {
                var alvo = _tab.DaPosicao(raio.GetPoint(t));
                if (alvo != _sob)
                {
                    Pinta(_sob, false);
                    _sob = alvo;
                    Pinta(_sob, true);
                }
                if (Clicou() && _alcance.ContainsKey(alvo))
                {
                    _pp -= _alcance[alvo];
                    _pos = alvo;
                    Reposiciona();
                    RecalculaAlcance();
                }
            }

            // espaço = novo turno, para dar para brincar sem interface
            if (Keyboard.current != null && Keyboard.current.spaceKey.wasPressedThisFrame)
            {
                _pp = PPporTurno;
                RecalculaAlcance();
            }
        }

        /// <summary>Onde o dedo ou o mouse está. Nulo quando não há nem um nem outro.</summary>
        static Vector2? PosicaoDoPonteiro()
        {
            if (Touchscreen.current != null && Touchscreen.current.primaryTouch.press.isPressed)
                return Touchscreen.current.primaryTouch.position.ReadValue();
            if (Mouse.current != null) return Mouse.current.position.ReadValue();
            return null;
        }

        static bool Clicou()
        {
            if (Touchscreen.current != null &&
                Touchscreen.current.primaryTouch.press.wasPressedThisFrame) return true;
            return Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame;
        }

        void Pinta(Vector2Int p, bool aceso)
        {
            Renderer r;
            if (!_marcas.TryGetValue(p, out r)) return;
            var baseCor = ((p.x + p.y) % 2 == 0) ? CorChao : CorChaoAlt;
            if (_alcance.ContainsKey(p)) baseCor = Color.Lerp(baseCor, CorAlcance, 0.45f);
            PintaRenderer(r, aceso ? Color.Lerp(baseCor, CorSobre, 0.5f) : baseCor);
        }

        void OnGUI()
        {
            var estilo = new GUIStyle(GUI.skin.label) { fontSize = 15 };
            estilo.normal.textColor = Color.white;
            GUI.Label(new Rect(14, 10, 700, 26),
                      "PP " + _pp + "/" + PPporTurno +
                      "   ·  clique numa casa acesa para andar  ·  ESPAÇO encerra o turno",
                      estilo);
        }
    }
}
