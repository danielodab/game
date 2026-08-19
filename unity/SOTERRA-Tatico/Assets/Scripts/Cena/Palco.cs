using System.Collections.Generic;
using UnityEngine;
using Soterra.Grade;

// O membro Casa(Vector3) desta classe ESCONDE o tipo Soterra.Grade.Casa aqui
// dentro — `Casa.ObstaculoAlto` dentro de um método do Palco não compila. O
// apelido resolve sem renomear nada do que o contrato fixou.
using TipoDeCasa = Soterra.Grade.Casa;

namespace Soterra.Cena
{
    /// <summary>
    /// O palco 3D: desenha um <see cref="Mapa"/> sob câmera ortográfica FIXA em
    /// 3/4 (decisão fechada em PLANO_UNITY.md, fase 3).
    ///
    /// Nesta rodada não há modelo nenhum: chão, os dois obstáculos e os realces
    /// saem de cubo e cor. O que se cobra aqui é a LEITURA do tabuleiro, não o
    /// acabamento — se você não disser num relance qual obstáculo é alto e qual
    /// é baixo, o palco falhou mesmo compilando.
    ///
    /// Quem gira é o TABULEIRO, não a câmera. Duas razões: "câmera fixa" é a
    /// decisão, e com a câmera parada o sol continua vindo da mesma direção da
    /// TELA em qualquer rotação — se a câmera orbitasse, a sombra que separa
    /// alto de baixo mudaria de lado a cada giro e a leitura mudaria junto.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class Palco : MonoBehaviour
    {
        // ================================================================ MEDIDAS

        /// <summary>Lado de uma casa, em unidades de mundo.</summary>
        public const float Passo = 1f;

        /// <summary>
        /// Altura do obstáculo ALTO, em casas. Medida do jogo em JS, não chutada:
        /// `WALL_H = 2.0` com `CELL = 2.0` (js/render3d/models3d.js) = uma casa
        /// inteira, a mesma altura de um herói. É o que faz "atrás do alto
        /// ninguém te vê" ser verdade também na imagem.
        /// </summary>
        public const float AlturaAlto = 1.00f;

        /// <summary>
        /// Altura do obstáculo BAIXO, em casas. Também medida do JS:
        /// `fitHeight(prop, 0.95)` com `CELL = 2.0` — quase metade de um herói,
        /// altura de cintura. Dá para escorar e atirar por cima.
        /// </summary>
        public const float AlturaBaixo = 0.48f;

        // O alto PREENCHE a casa e um fio a mais. Com 1.00 exato sobra um fio de
        // fundo entre dois cubos vizinhos nas quinas, e a parede — que tem de ler
        // como um maciço só — vira uma fileira de blocos soltos.
        const float LadoAlto = 1.01f;

        // O baixo é MENOR que a casa de propósito: o anel de piso em volta diz
        // que ele está SOBRE o chão, e não que ele É o chão. É o terceiro sinal
        // (com altura e cor) que separa alto de baixo sem ler legenda.
        const float LadoBaixo = 0.70f;

        const float LadoChao = 0.96f;       // a junta escura entre lajes desenha a grade
        const float EspessuraChao = 0.14f;  // laje com topo exatamente em y = 0

        // As três camadas de realce do jogo em JS, copiadas de renderer3d_v2.js:
        // passo `ovTile(..., 0.18, 0.09, 0.84)`, alvo `(..., 0.34, 0.11, 0.80)`,
        // área `(..., forca, 0.13, 0.90)` — os dois últimos números de cada uma
        // são altura e lado.
        //
        // O que importa é a ALTURA subir a cada camada: as três se sobrepõem na
        // mesma casa o tempo todo — a área do feitiço cai DENTRO do alcance de
        // passo — e duas placas transparentes na mesma altura brigam de Z,
        // piscando de uma cor para a outra conforme o ângulo. O lado também
        // muda, e é o que faz a sobreposição ler como quadrado dentro de
        // quadrado em vez de virar uma mancha só.
        const float FolgaPasso = 0.09f, LadoPasso = 0.84f;
        const float FolgaAlvo = 0.11f, LadoAlvo = 0.80f;
        const float FolgaArea = 0.13f, LadoArea = 0.90f;

        // O realce sem camada declarada entra como o de passo, que é o mais baixo.
        const float LadoRealce = LadoPasso;
        const float FolgaRealce = FolgaPasso;

        // ================================================================= CÂMERA

        /// <summary>
        /// Inclinação da câmera, em graus acima do horizonte. O jogo em JS usa
        /// `tilt = 0.98` rad a partir do zênite = 34° (renderer3d_v2.js). Aqui
        /// são 38, e a diferença tem motivo: aquela câmera é perspectiva e SEGUE
        /// a ação; esta é ortográfica e precisa enquadrar a sala inteira, e a 34°
        /// a fileira de parede do fundo comia uma casa e meia de chão.
        /// </summary>
        public const float Inclinacao = 38f;

        /// <summary>
        /// Azimute. 45° põe a grade em losango na tela — o mesmo do jogo em JS
        /// (azimute -π/4) — e mostra DUAS faces de cada bloco em vez de uma. De
        /// frente, o obstáculo vira um retângulo chapado e a altura some, que é
        /// justamente a informação que este palco tem de entregar.
        /// </summary>
        public const float Guinada = 45f;

        // O sol acompanha o azimute da câmera com um desvio, como em
        // renderer3d_v2.js ("o sol acompanha o azimute para a sombra nunca cair
        // atrás da câmera"): 0,9 rad = 52°, altura 26 sobre raio 22 = 50°.
        const float SolElevacao = 50f;
        const float SolDesvio = 52f;

        const float FolgaEnquadramento = 1.06f;  // 6% de ar em volta do tabuleiro

        // ================================================================= PALETA
        // Todas as cores saem do jogo em JS. As do obstáculo são as do tema
        // `garden` (models3d.js) com o CONTRASTE ABERTO: lá o alto é uma parede
        // modelada e o baixo é um engradado, e a silhueta já os separa; aqui os
        // dois são cubo, então a diferença precisa caber na cor. `wall` #57452f e
        // `lowWall` #6b5334 lado a lado, em cubo, ficam quase iguais.

        /// <summary>Hex do jogo em JS vira Color. Existe para estas cores se
        /// conferirem LITERALMENTE contra js/render3d/models3d.js, em vez de
        /// virarem três decimais que ninguém consegue comparar.</summary>
        static Color De(int rgb)
        {
            return new Color(((rgb >> 16) & 0xFF) / 255f,
                             ((rgb >> 8) & 0xFF) / 255f,
                             (rgb & 0xFF) / 255f);
        }

        public static readonly Color CorChao = De(0x35513a);          // garden.floor1
        public static readonly Color CorChaoPar = De(0x3d5c41);       // garden.floor2
        public static readonly Color CorChaoDecorado = Color.Lerp(De(0x3d5c41), Color.white, 0.18f);
        public static readonly Color CorAlto = Color.Lerp(De(0x57452f), Color.black, 0.34f);
        public static readonly Color CorBaixo = Color.Lerp(De(0x6b5334), Color.white, 0.42f);
        public static readonly Color CorFundo = De(0x101418);         // scene.background do JS
        static readonly Color CorSol = De(0xfff0c2);                  // lights.sun do JS
        static readonly Color CorCeu = De(0xa8c887);                  // lights.hemi, céu
        static readonly Color CorChaoAmbiente = De(0x2c3c66);         // lights.hemi, chão

        /// <summary>Cor com que o jogo em JS acende as casas alcançáveis
        /// (renderer3d_v2.js). Fica aqui para quem chama <see cref="Realcar"/>
        /// não ter de inventar uma.</summary>
        public static readonly Color CorAlcance = De(0x28c8ff);

        /// <summary>Casa alcançável mas ARRISCADA — o JS troca o azul por este
        /// laranja quando andar até ali entrega o herói.</summary>
        public static readonly Color CorRisco = De(0xff8a24);

        /// <summary>Área de efeito do feitiço (`ovTile(..., '#ff5a28', ...)` no
        /// JS). A cor do ALVO não é constante: é a do elemento do feitiço, e
        /// quem conjura é que sabe qual é.</summary>
        public static readonly Color CorArea = De(0xff5a28);

        /// <summary>
        /// Selo de lado do jogo em JS (`u.side === 'player' ? 0x6fd8ff :
        /// 0xff7a5a`, renderer3d_v2.js). É a leitura de "quem é meu" mais rápida
        /// que o tabuleiro tem, e por isso não é derivada de nada: é literal.
        /// </summary>
        public static readonly Color CorAliado = De(0x6fd8ff);

        /// <summary>Selo de lado do inimigo — ver <see cref="CorAliado"/>.</summary>
        public static readonly Color CorInimigo = De(0xff7a5a);

        // Opacidade de cada camada. O JS usa 0,18 no passo, 0,34 no alvo e um
        // valor variável (~0,5) na área. Aqui elas vão DOBRADAS, e o motivo é
        // que a placa não é a mesma coisa nos dois lugares: lá ela é desenhada
        // sobre um chão mais claro e ainda ganha por cima um anel pulsante que
        // reforça a leitura quadro a quadro; aqui é uma placa unlit sozinha, e
        // parada, sobre o verde escuro da Estufa — nas alfas cruas do JS o
        // alcance simplesmente não aparece na foto.
        /// <summary>Opacidade do realce de alcance de passo.</summary>
        public const float AlfaPasso = 0.36f;
        /// <summary>
        /// Opacidade do realce de casa-alvo. Sobe MENOS que as outras duas de
        /// propósito: o conjunto de alvos é, de longe, o maior dos três — no
        /// primeiro feitiço do Bruxo são 54 casas contra 11 de passo e 5 de
        /// área. Na mesma opacidade das outras, ele repinta meio tabuleiro e
        /// engole o alcance de passo que está por baixo.
        /// </summary>
        public const float AlfaAlvo = 0.45f;
        /// <summary>Opacidade do realce de área de efeito.</summary>
        public const float AlfaArea = 0.85f;

        // ================================================================= ESTADO

        Transform _raiz;          // o tabuleiro: é ELE que gira
        Transform _chao, _obstaculos, _realces;
        Camera _cam;
        Mapa _mapa;
        int _larg = 1, _alt = 1;
        int _quartos;

        Material _fosco, _marcador;
        Mesh _cubo;

        readonly Dictionary<Vector2Int, GameObject> _pecas = new Dictionary<Vector2Int, GameObject>();
        readonly Dictionary<Vector2Int, float> _topo = new Dictionary<Vector2Int, float>();
        readonly List<GameObject> _poolRealce = new List<GameObject>();
        readonly List<Vector2Int> _realcadas = new List<Vector2Int>();

        static readonly int IdCorBase = Shader.PropertyToID("_BaseColor");
        static readonly int IdCorAntiga = Shader.PropertyToID("_Color");

        /// <summary>A câmera do palco. Quem fotografa precisa dela.</summary>
        public Camera Camera { get { return _cam; } }

        /// <summary>O mapa desenhado agora, ou nulo antes do primeiro Montar.</summary>
        public Mapa Mapa { get { return _mapa; } }

        /// <summary>Casas realçadas neste momento, na ordem em que entraram.</summary>
        public IReadOnlyList<Vector2Int> Realcadas { get { return _realcadas; } }

        /// <summary>
        /// Altura do mais alto que está EM CIMA do tabuleiro, em unidades de
        /// mundo. Quem põe unidade avisa aqui (o <see cref="Elenco"/> faz isso
        /// sozinho) para o enquadramento não cortar a cabeça de ninguém: a
        /// parede tem 1 m, mas um chefe tem 5, e a câmera só sabe o que lhe
        /// contam. Zero enquadra pelo tabuleiro nu.
        /// </summary>
        public float AlturaDeCena { get; set; }

        /// <summary>
        /// A raiz que GIRA. Quem põe coisa em cima do tabuleiro — unidade,
        /// adereço, marca de terreno — pendura aqui, e não no Palco: pendurado
        /// no Palco, o objeto ficaria parado enquanto o chão embaixo dele gira,
        /// e a unidade acabaria em outra casa depois do primeiro <see cref="Girar"/>.
        ///
        /// Cuidado que vem junto: <see cref="Montar"/> apaga TODOS os filhos
        /// desta raiz. Quem pendurou tem de repovoar depois de remontar — é o
        /// que o <see cref="Elenco"/> faz ao notar que o próprio grupo morreu.
        /// </summary>
        public Transform Tabuleiro { get { return Raiz; } }

        // ================================================================= MONTAR

        /// <summary>
        /// Desenha o mapa. Funciona FORA de Play — nada aqui depende de Start,
        /// de corrotina ou de física, porque o modo lote (-executeMethod) nunca
        /// aperta Play e é assim que este projeto se vê.
        ///
        /// Montar de novo REDESENHA: os objetos antigos morrem antes. Sem isso,
        /// duas chamadas empilhariam dois tabuleiros no mesmo lugar, brigando por
        /// Z — e fora de Play `Destroy` não faz nada, então o empilhamento seria
        /// silencioso.
        /// </summary>
        public void Montar(Mapa mapa)
        {
            if (mapa == null) throw new System.ArgumentNullException("mapa");

            _mapa = mapa;
            _larg = mapa.Largura;
            _alt = mapa.Altura;

            Limpar();

            _chao = NovoGrupo("Chao", Raiz);
            _obstaculos = NovoGrupo("Obstaculos", Raiz);
            _realces = NovoGrupo("Realces", Raiz);

            for (int y = 0; y < _alt; y++)
            {
                for (int x = 0; x < _larg; x++)
                {
                    var casa = new Vector2Int(x, y);
                    Desenhar(casa, mapa.Em(casa));
                }
            }

            MontarLuz();
            MontarCamera();
            AplicarGiro();
            Enquadrar();
        }

        /// <summary>
        /// Uma casa. O vazio não recebe NADA — nem laje: é buraco, e o jogo em JS
        /// usa o recorte de '~' para a sala ler como plataforma sobre o escuro,
        /// não como caixa. Desenhar chão embaixo do buraco apagaria a silhueta da
        /// sala inteira.
        /// </summary>
        void Desenhar(Vector2Int casa, TipoDeCasa tipo)
        {
            switch (tipo)
            {
                case TipoDeCasa.Vazio:
                    _topo[casa] = 0f;
                    return;

                case TipoDeCasa.ObstaculoAlto:
                    // Sem laje embaixo: o bloco alto desce até abaixo do piso e
                    // fica plantado. Uma laje sob ele só apareceria como um
                    // degrau de 2 cm que ninguém vê e que briga de Z na base.
                    _pecas[casa] = Bloco("alto_" + casa.x + "_" + casa.y, _obstaculos,
                                         Local(casa, (AlturaAlto - EspessuraChao) * 0.5f),
                                         new Vector3(LadoAlto, AlturaAlto + EspessuraChao, LadoAlto),
                                         CorAlto, Fosco, true);
                    _topo[casa] = AlturaAlto;
                    return;

                case TipoDeCasa.ObstaculoBaixo:
                    // O baixo é chão + caixote, como no JS: o piso continua
                    // visível em volta dele, e é essa moldura que diz "isto está
                    // EM CIMA do chão, dá para ver por cima".
                    Laje(casa, CorDoChao(casa));
                    _pecas[casa] = Bloco("baixo_" + casa.x + "_" + casa.y, _obstaculos,
                                         Local(casa, AlturaBaixo * 0.5f),
                                         new Vector3(LadoBaixo, AlturaBaixo, LadoBaixo),
                                         CorBaixo, Fosco, true);
                    _topo[casa] = AlturaBaixo;
                    return;

                default:
                    _pecas[casa] = Laje(casa, tipo == TipoDeCasa.ChaoDecorado
                                              ? CorChaoDecorado : CorDoChao(casa));
                    _topo[casa] = 0f;
                    return;
            }
        }

        GameObject Laje(Vector2Int casa, Color cor)
        {
            // Laje não projeta sombra: ela é rasa e está no chão, então a única
            // sombra que produziria seria em cima da laje vizinha — acne de
            // sombra de graça, sem nada em troca.
            return Bloco("chao_" + casa.x + "_" + casa.y, _chao,
                         Local(casa, -EspessuraChao * 0.5f),
                         new Vector3(LadoChao, EspessuraChao, LadoChao),
                         cor, Fosco, false);
        }

        static Color CorDoChao(Vector2Int casa)
        {
            // Xadrez, como o jogo em JS ((x+y)%2 escolhe floor1/floor2): sem ele
            // o chão vira uma mancha só e a grade — a unidade de medida do jogo
            // inteiro — some da imagem.
            return ((casa.x + casa.y) % 2 == 0) ? CorChao : CorChaoPar;
        }

        // ============================================================== COORDENADAS

        /// <summary>
        /// Centro da casa, em MUNDO, com a altura pedida. Passa pela transformada
        /// da raiz de propósito: é o que faz Mundo e <see cref="Casa"/> serem
        /// inversos exatos em qualquer rotação, em vez de duas contas parecidas
        /// que um dia divergem.
        /// </summary>
        public Vector3 Mundo(Vector2Int casa, float altura = 0f)
        {
            return Raiz.TransformPoint(Local(casa, altura));
        }

        /// <summary>
        /// A casa que contém um ponto do mundo. A altura é ignorada — o ponto
        /// costuma vir de um raio contra o plano do chão.
        ///
        /// Arredonda com floor(v + 0.5) e NÃO com Mathf.RoundToInt: RoundToInt
        /// arredonda meio para o PAR (0,5 → 0 e 1,5 → 2), então casas vizinhas
        /// tratariam a fronteira comum de formas opostas. O clique cairia na casa
        /// do lado em metade das bordas, e o jogador chamaria isso de azar.
        /// </summary>
        public Vector2Int Casa(Vector3 mundo)
        {
            var local = Raiz.InverseTransformPoint(mundo);
            return new Vector2Int(
                Mathf.FloorToInt(local.x / Passo + (_larg - 1) * 0.5f + 0.5f),
                Mathf.FloorToInt(local.z / Passo + (_alt - 1) * 0.5f + 0.5f));
        }

        // O tabuleiro nasce CENTRADO na raiz: girar vira um giro em torno do
        // próprio centro, sem correção de pivô — que é onde o erro de meio passo
        // costuma entrar.
        Vector3 Local(Vector2Int casa, float altura)
        {
            return new Vector3((casa.x - (_larg - 1) * 0.5f) * Passo,
                               altura,
                               (casa.y - (_alt - 1) * 0.5f) * Passo);
        }

        /// <summary>
        /// Gira o tabuleiro em passos de 90°. Aceita qualquer inteiro: -1 é o
        /// mesmo que +3, e +4 volta ao lugar. Normalizar aqui evita que o ângulo
        /// cresça sem fim e vá perdendo precisão de float ao longo da partida.
        /// </summary>
        public void Girar(int quartosDeVolta)
        {
            _quartos = ((_quartos + quartosDeVolta) % 4 + 4) % 4;
            AplicarGiro();
            // Reenquadra porque girar 90° troca largura por altura: sem isto uma
            // sala 27×21 sai com as pontas cortadas depois do primeiro giro.
            Enquadrar();
        }

        void AplicarGiro()
        {
            Raiz.localRotation = Quaternion.Euler(0f, 90f * _quartos, 0f);
        }

        // ================================================================ REALCE

        /// <summary>
        /// Acende casas. ACUMULA de propósito: o jogo precisa mostrar duas coisas
        /// ao mesmo tempo — alcance de passo numa cor e alcance de feitiço em
        /// outra. Quem quiser trocar chama <see cref="LimparRealce"/> antes.
        ///
        /// O realce é uma placa CHAPADA (sem luz, sem sombra) pousada no topo do
        /// que existe na casa. Chapada porque marcador tem de ter sempre a mesma
        /// cor: um realce iluminado ficaria escuro dentro da sombra de uma parede
        /// e o jogador leria duas cores diferentes para a mesma coisa. No topo, e
        /// não no chão, para a área de um feitiço que cobre um obstáculo aparecer
        /// em vez de ficar enterrada dentro do cubo.
        /// </summary>
        public void Realcar(IEnumerable<Vector2Int> casas, Color cor)
        {
            Realcar(casas, cor, FolgaRealce, LadoRealce);
        }

        /// <summary>
        /// Realce numa camada escolhida: <paramref name="folga"/> é a altura
        /// acima do topo da casa e <paramref name="lado"/> o tamanho da placa.
        /// Público porque quem empilha dois realces na mesma casa precisa
        /// separá-los — ver as constantes de camada e
        /// <see cref="RealcarPasso"/>, <see cref="RealcarAlvo"/> e
        /// <see cref="RealcarArea"/>.
        /// </summary>
        public void Realcar(IEnumerable<Vector2Int> casas, Color cor, float folga, float lado)
        {
            if (casas == null || _mapa == null || _realces == null) return;

            foreach (var casa in casas)
            {
                // Casa fora do mapa não ganha placa: uma placa boiando no vazio
                // mentiria sobre onde o tabuleiro acaba.
                if (!_mapa.Dentro(casa)) continue;

                var go = PlacaLivre();
                go.transform.localPosition = Local(casa, TopoDe(casa) + folga);
                // O lado vai aqui e não na criação: a mesma placa volta do bolso
                // servindo ora de passo, ora de área, e uma escala presa ao
                // nascimento faria o tamanho depender de quem pegou a placa antes.
                go.transform.localScale = new Vector3(lado, 0.02f, lado);
                Pintar(go.GetComponent<Renderer>(), cor);
                go.SetActive(true);
                _realcadas.Add(casa);
            }
        }

        /// <summary>Alcance de passo: azul, na camada mais baixa. Passe
        /// <c>arriscadas</c> para trocar o azul pelo laranja de risco.</summary>
        public void RealcarPasso(IEnumerable<Vector2Int> casas, bool arriscadas = false)
        {
            Realcar(casas, Com(arriscadas ? CorRisco : CorAlcance, AlfaPasso),
                    FolgaPasso, LadoPasso);
        }

        /// <summary>
        /// Casas em que o feitiço PODE ser largado. A cor vem de fora porque no
        /// jogo ela é a do elemento do feitiço (`elCol` no JS) — fixar uma aqui
        /// apagaria a única pista de qual feitiço está na mão.
        /// </summary>
        public void RealcarAlvo(IEnumerable<Vector2Int> casas, Color corDoElemento)
        {
            Realcar(casas, Com(corDoElemento, AlfaAlvo), FolgaAlvo, LadoAlvo);
        }

        /// <summary>O que o feitiço PEGA ao cair: a camada mais alta e a mais
        /// opaca, porque é a que decide a jogada.</summary>
        public void RealcarArea(IEnumerable<Vector2Int> casas)
        {
            Realcar(casas, Com(CorArea, AlfaArea), FolgaArea, LadoArea);
        }

        /// <summary>A mesma cor com outra opacidade. Existe para ninguém ter de
        /// reescrever os três canais só para mexer no alfa.</summary>
        public static Color Com(Color cor, float alfa)
        {
            return new Color(cor.r, cor.g, cor.b, alfa);
        }

        /// <summary>Apaga todos os realces.</summary>
        public void LimparRealce()
        {
            for (int i = 0; i < _poolRealce.Count; i++)
                if (_poolRealce[i] != null) _poolRealce[i].SetActive(false);
            _realcadas.Clear();
        }

        /// <summary>Altura do topo do que está na casa: 0 no chão, o alto do
        /// obstáculo onde houver um.</summary>
        public float TopoDe(Vector2Int casa)
        {
            float t;
            return _topo.TryGetValue(casa, out t) ? t : 0f;
        }

        /// <summary>
        /// O objeto desenhado nesta casa — o obstáculo, se houver; senão a laje.
        /// Nulo no vazio. Existe para o teste medir o que está na TELA (altura,
        /// largura e cor de verdade) em vez de reconferir uma constante contra
        /// ela mesma.
        /// </summary>
        public GameObject ObjetoDa(Vector2Int casa)
        {
            GameObject go;
            return _pecas.TryGetValue(casa, out go) ? go : null;
        }

        // Placas são reaproveitadas, como o `ovPool` do renderizador em JS:
        // acender e apagar alcance a cada turno criaria e destruiria centenas de
        // objetos por partida.
        GameObject PlacaLivre()
        {
            for (int i = 0; i < _poolRealce.Count; i++)
                if (_poolRealce[i] != null && !_poolRealce[i].activeSelf) return _poolRealce[i];

            var go = Bloco("realce_" + _poolRealce.Count, _realces, Vector3.zero,
                           new Vector3(LadoRealce, 0.02f, LadoRealce),
                           Color.white, Marcador, false);
            go.GetComponent<Renderer>().receiveShadows = false;
            go.SetActive(false);
            _poolRealce.Add(go);
            return go;
        }

        // ================================================================ CÂMERA

        void MontarCamera()
        {
            if (_cam == null)
            {
                // Procura pelo nome antes de criar: depois de um recarregamento
                // de domínio o campo volta nulo mas o objeto continua na cena, e
                // criar outro deixaria duas câmeras disputando a mesma imagem.
                var t = transform.Find("Camera");
                _cam = t != null ? t.GetComponent<Camera>() : null;
            }
            if (_cam == null)
            {
                var go = new GameObject("Camera");
                go.transform.SetParent(transform, false);
                _cam = go.AddComponent<Camera>();
            }
            _cam.orthographic = true;              // decisão fechada: nada de perspectiva
            _cam.clearFlags = CameraClearFlags.SolidColor;
            _cam.backgroundColor = CorFundo;
            _cam.transform.rotation = Quaternion.Euler(Inclinacao, Guinada, 0f);
        }

        /// <summary>
        /// Ajusta o tamanho ortográfico e a posição para o tabuleiro INTEIRO
        /// caber. Público porque o enquadramento depende da proporção da imagem:
        /// quem renderiza numa RenderTexture de outra proporção precisa mandar
        /// reenquadrar, ou o mapa sai cortado nas laterais.
        /// </summary>
        public void Enquadrar()
        {
            if (_cam == null) return;

            var rot = Quaternion.Euler(Inclinacao, Guinada, 0f);
            _cam.transform.rotation = rot;

            // A medida é feita no espaço da CÂMERA, casa por casa do que está
            // desenhado — e não numa caixa em volta do retângulo do mapa.
            //
            // A diferença é grande e é o recorte: a sala da Estufa é 21×17 mas
            // tem as quatro quinas em '~', e numa câmera a 45° são justamente as
            // quinas do retângulo que definem as pontas do losango na tela.
            // Enquadrando a caixa, mais de um terço da imagem fica gasto com
            // buraco que ninguém desenhou. Num celular esse terço é o que decide
            // se o tabuleiro cabe no polegar.
            //
            // O topo entra na conta: sem ele, a parede da borda do fundo sai
            // cortada pela metade nos mapas grandes — e desde que há UNIDADE em
            // cima do tabuleiro, o que estoura primeiro não é a parede de 1 m e
            // sim o chefe de 5.
            float teto = Mathf.Max(AlturaAlto, AlturaDeCena);
            var inversa = Quaternion.Inverse(rot);

            float minX = 0f, maxX = 0f, minY = 0f, maxY = 0f, minZ = 0f, maxZ = 0f;
            bool algum = false;

            for (int y = 0; y < _alt; y++)
            {
                for (int x = 0; x < _larg; x++)
                {
                    var casa = new Vector2Int(x, y);
                    if (_mapa != null && _mapa.Em(casa) == TipoDeCasa.Vazio) continue;

                    for (int q = 0; q < 8; q++)
                    {
                        var local = Local(casa, (q & 4) == 0 ? -EspessuraChao : teto);
                        local.x += ((q & 1) == 0 ? -0.5f : 0.5f) * Passo;
                        local.z += ((q & 2) == 0 ? -0.5f : 0.5f) * Passo;
                        var p = inversa * Raiz.TransformPoint(local);

                        if (!algum)
                        {
                            minX = maxX = p.x; minY = maxY = p.y; minZ = maxZ = p.z;
                            algum = true;
                        }
                        else
                        {
                            minX = Mathf.Min(minX, p.x); maxX = Mathf.Max(maxX, p.x);
                            minY = Mathf.Min(minY, p.y); maxY = Mathf.Max(maxY, p.y);
                            minZ = Mathf.Min(minZ, p.z); maxZ = Mathf.Max(maxZ, p.z);
                        }
                    }
                }
            }
            if (!algum) return;

            float larguraMeia = (maxX - minX) * 0.5f;
            float alturaMeia = (maxY - minY) * 0.5f;
            float profundidade = (maxZ - minZ) * 0.5f;
            var centro = rot * new Vector3((minX + maxX) * 0.5f,
                                           (minY + maxY) * 0.5f,
                                           (minZ + maxZ) * 0.5f);

            // Proporção inválida acontece de verdade: câmera recém-criada em modo
            // lote pode devolver 0. 1,6 é o 1280×800 que lote.ps1 fotografa.
            float proporcao = (_cam.aspect > 0.01f && !float.IsNaN(_cam.aspect)) ? _cam.aspect : 1.6f;

            _cam.orthographic = true;
            _cam.orthographicSize = Mathf.Max(alturaMeia, larguraMeia / proporcao) * FolgaEnquadramento;

            float distancia = profundidade + 10f;
            _cam.transform.position = centro - (rot * Vector3.forward) * distancia;
            _cam.nearClipPlane = 0.1f;
            // A sombra do URP tem alcance a partir da CÂMERA (50 no PC_RPAsset):
            // afastar mais do que o necessário apagaria as sombras que separam
            // alto de baixo.
            _cam.farClipPlane = distancia + profundidade + 10f;
        }

        void MontarLuz()
        {
            var t = transform.Find("Sol");
            Light sol = t != null ? t.GetComponent<Light>() : null;
            if (sol == null)
            {
                var go = new GameObject("Sol");
                go.transform.SetParent(transform, false);
                sol = go.AddComponent<Light>();
            }
            sol.type = LightType.Directional;
            sol.color = CorSol;
            // O jogo em JS usa 1,12, e na rodada 1 isso bastava: o tabuleiro era
            // cubo e cor chapada, e cubo escuro ainda tem silhueta. Com PESSOAS
            // em cima ele deixou de bastar — um herói de 1,65 m ocupa umas
            // quatro dezenas de pixels num celular, e nessa escala a leitura é
            // toda de valor: rosto, arma e capa somem juntos num vulto só se a
            // cena estiver escura. O chão da Estufa (#35513a) já é dos mais
            // escuros do jogo, e é justamente onde a batalha começa.
            sol.intensity = 1.85f;
            sol.shadows = LightShadows.Soft;
            // A sombra é o quarto sinal que separa alto de baixo: o alto lança uma
            // faixa longa, o baixo um risco curto. Por isso o sol fica baixo (50°)
            // e desviado do eixo da câmera.
            sol.transform.rotation = Quaternion.Euler(SolElevacao, Guinada + SolDesvio, 0f);

            // A hemisférica do jogo em JS vira ambiente de três faixas: sem ela a
            // face virada para longe do sol fica preta e o cubo perde o volume.
            // Subiu junto com o sol, e pelo mesmo motivo: é o ambiente que
            // levanta a face virada para longe da luz, e é justamente essa face
            // que fica voltada para a câmera em metade das unidades.
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = CorCeu * 1.00f;
            RenderSettings.ambientGroundColor = CorChaoAmbiente * 1.00f;
            RenderSettings.ambientEquatorColor = Color.Lerp(CorCeu, CorChaoAmbiente, 0.5f) * 0.78f;
        }

        // ============================================================== MATERIAIS

        /// <summary>
        /// UM material fosco para o tabuleiro inteiro; a cor viaja em
        /// MaterialPropertyBlock (§3 do contrato). Material por objeto criado em
        /// tempo de edição faz o SRP Batcher desenhar tudo com a cor do primeiro,
        /// e `renderer.material` fora de Play devolve uma cópia descartada, então
        /// a pintura nem chega na tela.
        ///
        /// Fosco de propósito: reflexo de ambiente e especular são termos
        /// ADITIVOS e neutros — ligados, lavam a paleta e aproximam as duas cores
        /// de obstáculo, que é exatamente o que este palco não pode deixar
        /// acontecer.
        /// </summary>
        Material Fosco
        {
            get
            {
                if (_fosco != null) return _fosco;
                _fosco = new Material(Shader.Find("Universal Render Pipeline/Lit") ??
                                      Shader.Find("Standard"));
                _fosco.name = "SOTERRA/Palco/Fosco";
                _fosco.SetFloat("_Metallic", 0f);
                _fosco.SetFloat("_Smoothness", 0f);
                _fosco.SetFloat("_SpecularHighlights", 0f);
                _fosco.SetFloat("_EnvironmentReflections", 0f);
                _fosco.EnableKeyword("_SPECULARHIGHLIGHTS_OFF");
                _fosco.EnableKeyword("_ENVIRONMENTREFLECTIONS_OFF");
                // DontSave: material criado por código não é asset. Sem isto ele
                // aparece como vazamento ao trocar de cena e suja o log do lote.
                _fosco.hideFlags = HideFlags.DontSave;
                return _fosco;
            }
        }

        /// <summary>
        /// Material das placas de realce: SEM luz e translúcido. Sem luz porque
        /// marcador que muda de cor conforme a sombra vira dois marcadores aos
        /// olhos do jogador; translúcido porque o realce informa sobre a casa e
        /// tem de deixar a casa aparecer — é o mesmo MeshBasicMaterial com
        /// opacidade que o jogo em JS usa no overlay.
        /// </summary>
        Material Marcador
        {
            get
            {
                if (_marcador != null) return _marcador;
                _marcador = new Material(Shader.Find("Universal Render Pipeline/Unlit") ??
                                         Shader.Find("Unlit/Color"));
                _marcador.name = "SOTERRA/Palco/Marcador";
                _marcador.SetFloat("_Surface", 1f);       // 1 = transparente, no URP
                _marcador.SetFloat("_Blend", 0f);         // mistura alfa
                _marcador.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
                _marcador.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
                _marcador.SetFloat("_ZWrite", 0f);
                _marcador.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                _marcador.DisableKeyword("_ALPHATEST_ON");
                _marcador.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
                _marcador.hideFlags = HideFlags.DontSave;
                return _marcador;
            }
        }

        /// <summary>
        /// O material fosco do palco, para quem desenha EM CIMA do tabuleiro
        /// usar o mesmo. Um material só no projeto inteiro, e a cor por objeto
        /// em <see cref="Pintar"/> — ver §3 do contrato da rodada 1.
        /// </summary>
        public Material MaterialFosco { get { return Fosco; } }

        /// <summary>O material chapado e translúcido dos marcadores — realce,
        /// selo de lado, marca de unidade.</summary>
        public Material MaterialMarcador { get { return Marcador; } }

        // Um bloco só, reaproveitado. `new MaterialPropertyBlock()` por chamada
        // aloca a cada unidade de cada quadro, e o coletor cobra isso na hora
        // errada — no meio de uma animação de passo.
        static MaterialPropertyBlock _blocoCompartilhado;

        /// <summary>
        /// Pinta um renderizador. Estático e público porque quem desenha unidade
        /// em cima do tabuleiro precisa da MESMA disciplina: cor em
        /// <c>MaterialPropertyBlock</c>, nunca em material clonado.
        ///
        /// `renderer.material` fora de Play devolve uma cópia descartada — a
        /// pintura nem chega na tela — e material distinto por objeto criado em
        /// tempo de edição faz o SRP Batcher desenhar tudo com a cor do
        /// primeiro. As duas armadilhas estão na §3 do contrato da rodada 1 e as
        /// duas já custaram uma rodada.
        /// </summary>
        public static void Pintar(Renderer r, Color cor)
        {
            if (r == null) return;
            if (_blocoCompartilhado == null) _blocoCompartilhado = new MaterialPropertyBlock();
            r.GetPropertyBlock(_blocoCompartilhado);
            Cor(cor);
            r.SetPropertyBlock(_blocoCompartilhado);
        }

        /// <summary>
        /// Pinta UM material de um renderizador com vários. Um personagem do
        /// acervo traz corpo, roupa e metal em materiais separados, e pintar o
        /// renderizador inteiro de uma cor só apagaria essa separação.
        /// </summary>
        public static void Pintar(Renderer r, Color cor, int material)
        {
            if (r == null) return;
            if (_blocoCompartilhado == null) _blocoCompartilhado = new MaterialPropertyBlock();
            r.GetPropertyBlock(_blocoCompartilhado, material);
            Cor(cor);
            r.SetPropertyBlock(_blocoCompartilhado, material);
        }

        static void Cor(Color cor)
        {
            _blocoCompartilhado.SetColor(IdCorBase, cor);
            // `_Color` junto: o material que a Unity gera ao importar um FBX nem
            // sempre é URP/Lit — quando cai no shader antigo, a cor mora em
            // `_Color` e só `_BaseColor` não mudaria nada, calado.
            _blocoCompartilhado.SetColor(IdCorAntiga, cor);
        }

        // Uma malha de cubo emprestada de um primitivo descartado na hora. O
        // primitivo pronto viria com BoxCollider junto, e um mapa de 27×23 são
        // 621 colisores que ninguém usa: Casa(Vector3) é conta, não raycast.
        Mesh MalhaCubo()
        {
            if (_cubo != null) return _cubo;
            var molde = GameObject.CreatePrimitive(PrimitiveType.Cube);
            _cubo = molde.GetComponent<MeshFilter>().sharedMesh;
            Descartar(molde);
            return _cubo;
        }

        GameObject Bloco(string nome, Transform pai, Vector3 posicao, Vector3 escala,
                         Color cor, Material material, bool sombra)
        {
            var go = new GameObject(nome);
            go.transform.SetParent(pai, false);
            go.transform.localPosition = posicao;
            go.transform.localScale = escala;
            go.AddComponent<MeshFilter>().sharedMesh = MalhaCubo();
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = material;
            r.shadowCastingMode = sombra
                ? UnityEngine.Rendering.ShadowCastingMode.On
                : UnityEngine.Rendering.ShadowCastingMode.Off;
            Pintar(r, cor);
            return go;
        }

        // ================================================================ FAXINA

        Transform Raiz
        {
            get
            {
                if (_raiz != null) return _raiz;
                var t = transform.Find("Tabuleiro");
                _raiz = t != null ? t : NovoGrupo("Tabuleiro", transform);
                return _raiz;
            }
        }

        static Transform NovoGrupo(string nome, Transform pai)
        {
            var go = new GameObject(nome);
            go.transform.SetParent(pai, false);
            return go.transform;
        }

        void Limpar()
        {
            _pecas.Clear();
            _topo.Clear();
            _poolRealce.Clear();
            _realcadas.Clear();

            var filhos = new List<Transform>();
            for (int i = 0; i < Raiz.childCount; i++) filhos.Add(Raiz.GetChild(i));
            for (int i = 0; i < filhos.Count; i++) Descartar(filhos[i].gameObject);
        }

        /// <summary>
        /// Destrói agora fora de Play, e no fim do quadro em Play. Chamar
        /// `Destroy` fora de Play não faz NADA: os objetos velhos sobreviveriam ao
        /// Montar seguinte e ficariam empilhados, invisivelmente.
        /// </summary>
        static void Descartar(Object alvo)
        {
            if (alvo == null) return;
            if (Application.isPlaying) Object.Destroy(alvo);
            else Object.DestroyImmediate(alvo);
        }

        void OnDestroy()
        {
            Descartar(_fosco);
            Descartar(_marcador);
        }
    }
}
