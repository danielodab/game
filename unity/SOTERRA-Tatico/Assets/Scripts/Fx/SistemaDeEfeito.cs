using UnityEngine;

namespace Soterra.Fx
{
    /// <summary>
    /// Um efeito montado: as camadas de uma família viradas em
    /// <c>ParticleSystem</c> de verdade, prontas para disparar quantas vezes
    /// forem precisas.
    ///
    /// MONTADO POR CÓDIGO, nada arrastado no Inspector. Não é preferência: o
    /// modo lote nunca aperta Play e nunca abre janela, então um prefab com
    /// referência arrastada não teria como ser conferido em teste EditMode nem
    /// fotografado — e efeito que só existe quando alguém clica é efeito que
    /// ninguém prova.
    ///
    /// Todas as camadas dividem UM material (o do <see cref="AtlasDeEfeito"/>) e
    /// usam <c>sharedMaterial</c>: <c>renderer.material</c> fora de Play devolve
    /// uma CÓPIA descartada, e a cópia vaza um material por objeto e ainda faz o
    /// SRP Batcher pintar tudo com a cor do primeiro (CONTRATO_UNITY_F1 §3).
    /// A cor de cada disparo vai em <c>main.startColor</c>, que é cor de
    /// VÉRTICE — o mesmo material serve aos cinco elementos.
    /// </summary>
    public sealed class SistemaDeEfeito
    {
        /// <summary>Altura do peito de uma unidade comum, em metros. Não é
        /// centro de massa: é onde a mão conjura e onde o golpe acerta.</summary>
        public const float AlturaDoPeito = 1.1f;

        /// <summary>De onde o meteoro vem: alto e DE VIÉS. O viés é o que faz o
        /// jogador ver a queda em vez de um ponto crescendo no lugar.</summary>
        public static readonly Vector3 DesvioDoCeuDeVies = new Vector3(2.6f, 9.5f, -3.4f);

        /// <summary>De onde a chuva e a maldição descem: alto e a prumo.</summary>
        public static readonly Vector3 DesvioDoCeuAPrumo = new Vector3(0f, 7.5f, 0f);

        readonly MoldeDeEfeito _molde;
        readonly ParticleSystem[] _sistemas;
        readonly GameObject _raiz;

        float _restante;

        public string Familia { get { return _molde.Familia; } }
        public GameObject Objeto { get { return _raiz; } }

        /// <summary>Ainda desenhando? O pool não reaproveita quem está no ar —
        /// reaproveitar cortaria o efeito anterior no meio.</summary>
        public bool Ocupado { get { return _restante > 0f; } }

        /// <summary>Partículas que este sistema pode ter no ar ao mesmo tempo.</summary>
        public int TetoDeParticulas { get { return _molde.TetoDeParticulas; } }

        SistemaDeEfeito(MoldeDeEfeito molde, GameObject raiz, ParticleSystem[] sistemas)
        {
            _molde = molde;
            _raiz = raiz;
            _sistemas = sistemas;
        }

        // =============================================================== MONTAR

        public static SistemaDeEfeito Montar(MoldeDeEfeito molde, AtlasDeEfeito atlas,
                                             Transform pai, int semente)
        {
            var raiz = new GameObject("fx-" + molde.Familia);
            if (pai != null) raiz.transform.SetParent(pai, false);
            raiz.SetActive(false);

            var sistemas = new ParticleSystem[molde.Camadas.Length];
            for (int i = 0; i < molde.Camadas.Length; i++)
                sistemas[i] = MontarCamada(molde.Camadas[i], atlas, raiz.transform, i, semente + i * 7919);

            return new SistemaDeEfeito(molde, raiz, sistemas);
        }

        static ParticleSystem MontarCamada(CamadaDeEfeito c, AtlasDeEfeito atlas,
                                           Transform pai, int indice, int semente)
        {
            var go = new GameObject("camada" + indice);
            go.transform.SetParent(pai, false);
            var ps = go.AddComponent<ParticleSystem>();

            // Semente FIXA: o modo lote fotografa o mesmo quadro do mesmo efeito
            // duas vezes e espera a mesma imagem. Com semente automática, duas
            // fotos do mesmo estado sairiam diferentes e nenhuma comparação de
            // imagem valeria nada.
            ps.useAutoRandomSeed = false;
            ps.randomSeed = (uint)Mathf.Abs(semente) + 1u;

            float ultimoTiro = c.Atraso + Mathf.Max(0, c.Ciclos - 1) * c.IntervaloDeCiclo;

            var main = ps.main;
            main.duration = Mathf.Max(0.05f, ultimoTiro + 0.02f);
            main.loop = false;
            main.playOnAwake = false;
            main.simulationSpace = ParticleSystemSimulationSpace.Local;
            main.startLifetime = new ParticleSystem.MinMaxCurve(c.Vida, c.Vida + c.VidaVariacao);
            main.startSpeed = new ParticleSystem.MinMaxCurve(c.Velocidade, c.Velocidade + c.VelocidadeVariacao);
            main.startSize = new ParticleSystem.MinMaxCurve(c.Tamanho, c.Tamanho + c.TamanhoVariacao);
            main.gravityModifier = c.Gravidade;
            main.maxParticles = Mathf.Max(4, c.Quantidade * Mathf.Max(1, c.Ciclos) + 4);
            // A rotação da API é em RADIANOS, embora o Inspector mostre graus.
            // Escrever graus aqui daria 57 voltas por segundo e a forma viraria
            // um borrão — que é justamente o que este sistema existe para evitar.
            main.startRotation = c.GiroInicialAleatorio
                ? new ParticleSystem.MinMaxCurve(0f, Mathf.PI * 2f)
                : new ParticleSystem.MinMaxCurve(0f);
            main.startColor = Color.white;

            var emission = ps.emission;
            emission.enabled = true;
            emission.rateOverTime = 0f;      // só bursts: efeito tem hora para acontecer
            emission.SetBursts(new[]
            {
                new ParticleSystem.Burst(c.Atraso, (short)Mathf.Max(1, c.Quantidade),
                                         Mathf.Max(1, c.Ciclos), Mathf.Max(0.01f, c.IntervaloDeCiclo))
            });

            AjustarForma(ps.shape, c);

            var vel = ps.velocityOverLifetime;
            bool temEmpuxo = c.Empuxo != Vector3.zero || c.Viaja;
            vel.enabled = temEmpuxo;
            if (temEmpuxo)
            {
                // Espaço LOCAL: +Z é a direção do alvo e +Y é para cima. É o que
                // deixa "sobe", "desce" e "vai até lá" caberem num Vector3 sem
                // curva nenhuma.
                vel.space = ParticleSystemSimulationSpace.Local;
                vel.x = new ParticleSystem.MinMaxCurve(c.Empuxo.x);
                vel.y = new ParticleSystem.MinMaxCurve(c.Empuxo.y);
                // O Z de quem VIAJA é escrito no disparo: depende da distância
                // até o alvo, que só existe quando alguém conjura.
                vel.z = new ParticleSystem.MinMaxCurve(c.Empuxo.z);
            }

            if (!Mathf.Approximately(c.EscalaFinal, 1f))
            {
                var tam = ps.sizeOverLifetime;
                tam.enabled = true;
                tam.size = new ParticleSystem.MinMaxCurve(
                    1f, AnimationCurve.EaseInOut(0f, 1f, 1f, Mathf.Max(0.01f, c.EscalaFinal)));
            }

            if (!Mathf.Approximately(c.Giro, 0f))
            {
                var rot = ps.rotationOverLifetime;
                rot.enabled = true;
                rot.z = new ParticleSystem.MinMaxCurve(c.Giro * Mathf.Deg2Rad);
            }

            var cor = ps.colorOverLifetime;
            cor.enabled = true;
            cor.color = new ParticleSystem.MinMaxGradient(Desvanecimento(c.Permanencia));

            AjustarDesenho(ps, c, atlas, indice);
            return ps;
        }

        static void AjustarForma(ParticleSystem.ShapeModule shape, CamadaDeEfeito c)
        {
            shape.enabled = true;
            shape.rotation = Vector3.zero;
            shape.scale = Vector3.one;
            shape.radiusThickness = 1f;
            shape.arc = 360f;

            switch (c.Forma)
            {
                case FormaDeEmissao.Ponto:
                    shape.shapeType = ParticleSystemShapeType.Sphere;
                    shape.radius = 0.0001f;
                    break;

                case FormaDeEmissao.Esfera:
                    shape.shapeType = ParticleSystemShapeType.Sphere;
                    shape.radius = c.Raio;
                    break;

                case FormaDeEmissao.Disco:
                    // O círculo da Unity fica no plano XY; deitá-lo em XZ é o que
                    // faz a explosão correr RENTE ao chão em vez de subir como
                    // fogo de artifício.
                    shape.shapeType = ParticleSystemShapeType.Circle;
                    shape.radius = c.Raio;
                    shape.rotation = new Vector3(90f, 0f, 0f);
                    break;

                case FormaDeEmissao.Coluna:
                    // Mesmo círculo deitado, mas só a CASCA: as partículas nascem
                    // num anel em volta dos pés e sobem. É a coluna de luz.
                    shape.shapeType = ParticleSystemShapeType.Circle;
                    shape.radius = c.Raio;
                    shape.radiusThickness = 0.25f;
                    shape.rotation = new Vector3(90f, 0f, 0f);
                    break;

                case FormaDeEmissao.Leque:
                    // O cone emite ao longo do +Z local, que é para onde o efeito
                    // inteiro foi virado: o sopro ABRE na direção do alvo, e a
                    // abertura vem do volume, não de aleatoriedade.
                    shape.shapeType = ParticleSystemShapeType.Cone;
                    shape.angle = c.Abertura;
                    shape.radius = c.Raio;
                    break;

                case FormaDeEmissao.Caixa:
                    shape.shapeType = ParticleSystemShapeType.Box;
                    shape.scale = new Vector3(c.Raio * 2f, 0.2f, c.Raio * 2f);
                    break;

                case FormaDeEmissao.Linha:
                    // A aresta nasce ao longo do X local; girada 90° em Y, ela
                    // deita ao longo do caminho até o alvo. O comprimento é
                    // escrito no disparo, quando a distância existe.
                    shape.shapeType = ParticleSystemShapeType.SingleSidedEdge;
                    shape.radius = 1f;
                    shape.rotation = new Vector3(0f, 90f, 0f);
                    break;
            }
        }

        static void AjustarDesenho(ParticleSystem ps, CamadaDeEfeito c,
                                   AtlasDeEfeito atlas, int indice)
        {
            var r = ps.GetComponent<ParticleSystemRenderer>();

            switch (c.Modo)
            {
                case ModoDeDesenho.Chao:
                    r.renderMode = ParticleSystemRenderMode.HorizontalBillboard;
                    break;
                case ModoDeDesenho.Trilho:
                    r.renderMode = ParticleSystemRenderMode.Stretch;
                    r.lengthScale = c.Alongamento;
                    r.velocityScale = 0f;
                    r.cameraVelocityScale = 0f;
                    break;
                default:
                    r.renderMode = ParticleSystemRenderMode.Billboard;
                    r.alignment = ParticleSystemRenderSpace.View;
                    break;
            }

            // sharedMaterial, NUNCA material: fora de Play a segunda devolve uma
            // cópia descartada — a pintura não chega na tela e vaza um material
            // por objeto (CONTRATO_UNITY_F1 §3).
            if (atlas != null && atlas.Material != null) r.sharedMaterial = atlas.Material;

            // As camadas mais tardias desenham por cima: a forma grande tem de
            // ficar acima do pó, senão o pó a apaga.
            r.sortingOrder = 50 + indice;

            if (atlas != null && atlas.Textura != null)
            {
                var folha = ps.textureSheetAnimation;
                folha.enabled = true;
                folha.mode = ParticleSystemAnimationMode.Grid;
                folha.numTilesX = atlas.Colunas;
                folha.numTilesY = atlas.Linhas;
                folha.animation = ParticleSystemAnimationType.WholeSheet;
                folha.cycleCount = 1;
                // O quadro é TRAVADO no meio da fatia: `indice/total` cai
                // exatamente na fronteira entre dois quadros, e o arredondamento
                // do shader escorregaria para o vizinho — meia-lua onde devia
                // haver runa, sem erro nenhum para avisar.
                float t = (atlas.Quadro(c.Quadro) + 0.5f) / Mathf.Max(1, atlas.Quadros);
                folha.frameOverTime = new ParticleSystem.MinMaxCurve(t);
                folha.startFrame = new ParticleSystem.MinMaxCurve(0f);
            }
        }

        /// <summary>
        /// A curva de opacidade: sobe depressa, FICA enquanto a permanência
        /// mandar e some. É o que separa a armadilha (que planta e demora) do
        /// estouro (que aparece e vai embora).
        /// </summary>
        static Gradient Desvanecimento(float permanencia)
        {
            float fica = Mathf.Clamp(permanencia, 0.02f, 0.9f);
            const float sobe = 0.06f;
            if (fica <= sobe) fica = sobe + 0.02f;

            var g = new Gradient();
            g.SetKeys(
                new[] { new GradientColorKey(Color.white, 0f), new GradientColorKey(Color.white, 1f) },
                new[]
                {
                    new GradientAlphaKey(0f, 0f),
                    new GradientAlphaKey(1f, sobe),
                    new GradientAlphaKey(1f, fica),
                    new GradientAlphaKey(0f, 1f)
                });
            return g;
        }

        // ============================================================= DISPARAR

        /// <summary>
        /// Põe o efeito na casa certa, na cor certa, e o toca.
        ///
        /// <paramref name="origem"/> é o chão de quem conjura e
        /// <paramref name="destino"/> o chão do alvo. Os dois são precisos:
        /// família nenhuma inventa posição — quem sabe onde a coisa cai é o
        /// motor, e o efeito só obedece.
        /// </summary>
        public void Disparar(Vector3 origem, Vector3 destino, Color cor)
        {
            _raiz.SetActive(true);
            _restante = _molde.Duracao;

            var caminho = destino - origem;
            var horizontal = new Vector3(caminho.x, 0f, caminho.z);
            // Sem direção (o feitiço aponta para si mesmo) a rotação é a
            // identidade: LookRotation de vetor nulo emite um aviso por
            // conjuração e devolve lixo.
            var giroDoEfeito = horizontal.sqrMagnitude > 1e-6f
                ? Quaternion.LookRotation(horizontal.normalized, Vector3.up)
                : Quaternion.identity;

            _raiz.transform.position = origem;
            _raiz.transform.rotation = giroDoEfeito;

            for (int i = 0; i < _sistemas.Length; i++)
            {
                var ps = _sistemas[i];
                if (ps == null) continue;
                var c = _molde.Camadas[i];

                var nasce = PontoDe(c.Onde, origem, destino);
                var alvo = destino + Vector3.up * (c.Onde == Ancora.Alvo ? 0.06f : AlturaDoPeito);
                var rumo = alvo - nasce;

                // A camada que VIAJA aponta para o alvo de verdade — o meteoro
                // desce inclinado, a flecha vai reta. As outras herdam o rumo
                // horizontal do efeito, para que +Y local continue sendo o +Y do
                // mundo e "sobe" queira dizer sobe.
                var giro = c.Viaja && rumo.sqrMagnitude > 1e-6f
                    ? Quaternion.LookRotation(rumo.normalized, Vector3.up)
                    : giroDoEfeito;

                ps.transform.SetPositionAndRotation(nasce, giro);

                if (c.Viaja)
                {
                    // Chega no fim da vida, não antes: é o tempo de voo que faz o
                    // meteoro parecer cair de longe em vez de piscar no lugar.
                    var vel = ps.velocityOverLifetime;
                    vel.z = new ParticleSystem.MinMaxCurve(rumo.magnitude / Mathf.Max(0.05f, c.Vida));
                }

                if (c.Forma == FormaDeEmissao.Linha)
                {
                    // A aresta cobre o caminho INTEIRO: o raio é a metade dele,
                    // porque a aresta da Unity nasce centrada.
                    var shape = ps.shape;
                    shape.radius = Mathf.Max(0.3f, horizontal.magnitude * 0.5f);
                    ps.transform.position = nasce + horizontal * 0.5f;
                }

                var main = ps.main;
                var pintada = cor;
                pintada.a = Mathf.Clamp01(cor.a * c.Opacidade);
                main.startColor = pintada;

                if (Application.isPlaying) ps.Play(false);
                else
                {
                    // Fora de Play nada anda sozinho: o sistema é rebobinado aqui
                    // e avança por Simulate em <see cref="Avancar"/>. É a mesma
                    // corda que o Animator do elenco precisa no modo lote.
                    ps.Clear(false);
                    ps.Simulate(0f, false, true, true);
                }
            }
        }

        Vector3 PontoDe(Ancora onde, Vector3 origem, Vector3 destino)
        {
            switch (onde)
            {
                case Ancora.Alvo: return destino + Vector3.up * 0.06f;
                case Ancora.PeitoDoAlvo: return destino + Vector3.up * AlturaDoPeito;
                case Ancora.Conjurador: return origem + Vector3.up * 0.06f;
                case Ancora.PeitoDoConjurador: return origem + Vector3.up * AlturaDoPeito;
                case Ancora.Meio: return Vector3.Lerp(origem, destino, 0.5f) + Vector3.up * AlturaDoPeito;
                case Ancora.CeuDeVies: return destino + DesvioDoCeuDeVies;
                case Ancora.CeuAPrumo: return destino + DesvioDoCeuAPrumo;
            }
            return destino;
        }

        // ============================================================== AVANÇAR

        /// <summary>
        /// Um quadro de tempo. FORA de Play dá corda nos sistemas na mão — em
        /// Play o motor de quadro já os avança, e avançar de novo tocaria tudo
        /// em velocidade dobrada (a mesma armadilha do Animator do elenco).
        /// </summary>
        public void Avancar(float dt)
        {
            if (_restante <= 0f) return;
            if (dt < 0f) dt = 0f;

            _restante -= dt;

            if (!Application.isPlaying)
                for (int i = 0; i < _sistemas.Length; i++)
                    if (_sistemas[i] != null) _sistemas[i].Simulate(dt, false, false, true);

            if (_restante <= 0f)
            {
                _restante = 0f;
                _raiz.SetActive(false);
            }
        }

        /// <summary>Apaga JÁ — o que a troca de sala e o fim de batalha fazem.</summary>
        public void Parar()
        {
            _restante = 0f;
            for (int i = 0; i < _sistemas.Length; i++)
                if (_sistemas[i] != null)
                    _sistemas[i].Stop(false, ParticleSystemStopBehavior.StopEmittingAndClear);
            if (_raiz != null) _raiz.SetActive(false);
        }

        /// <summary>Partículas VIVAS agora — a medida honesta do custo de pico,
        /// e a única pergunta que um teste sem tela consegue fazer.</summary>
        public int ParticulasVivas()
        {
            int n = 0;
            for (int i = 0; i < _sistemas.Length; i++)
                if (_sistemas[i] != null) n += _sistemas[i].particleCount;
            return n;
        }

        /// <summary>Os sistemas montados — o teste confere quadro, modo e forma
        /// sem precisar de tela.</summary>
        public ParticleSystem Camada(int i)
        {
            return i >= 0 && i < _sistemas.Length ? _sistemas[i] : null;
        }

        public int Camadas { get { return _sistemas.Length; } }
    }
}
