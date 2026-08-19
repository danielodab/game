using System.Collections.Generic;
using UnityEngine;

namespace Soterra.Jogo
{
    // Ver a nota em Partida.cs: os apelidos globais evitam o CS0234 dos
    // namespaces irmãos.
    using Motor = global::Soterra.Motor;
    using Cena = global::Soterra.Cena;
    using Grade = global::Soterra.Grade;

    /// <summary>
    /// Traduz os EVENTOS do motor nos parâmetros do Animator do elenco
    /// (CONTRATO_ENTREGA_PERSONAGEM §6): movimento vira <c>Velocidade</c>
    /// enquanto a unidade DESLIZA de casa em casa, dano e esquiva viram
    /// <c>Levar</c>, conjuração vira <c>Atacar</c>, morte vira <c>Morrer</c> —
    /// e o corpo fica caído.
    ///
    /// C# puro, sem <c>MonoBehaviour</c>, pela mesma razão da
    /// <see cref="Partida"/>: o deslize e os gatilhos são provados em teste
    /// EditMode, avançando o tempo na mão — que é também como o modo lote
    /// fotografa um quadro do MEIO do walk sem apertar Play.
    ///
    /// A ordem de chamada importa e é o <see cref="JogoDeBatalha"/> quem rege:
    /// <see cref="Reagir"/> ANTES do <c>Elenco.Sincronizar</c> (quem morreu
    /// ainda existe em cena, e é agora que o corpo é adotado),
    /// <see cref="Animar"/> DEPOIS (quem andou já está plantado no destino, e o
    /// deslize o devolve ao ponto de partida para atravessar o caminho com
    /// tempo). <see cref="Avancar"/> a cada quadro.
    /// </summary>
    public sealed class AnimacaoDoElenco
    {
        // ---------------------------------------------------- NOMES DO CONTRATO

        // Os nomes existem UMA vez, aqui, e o gerador do controlador
        // (Soterra.Ferramentas.ControladorDoElenco) os consome: parâmetro
        // renomeado num lado só é animação que nunca dispara, sem erro nenhum.
        public const string ParametroVelocidade = "Velocidade";
        public const string GatilhoAtacar = "Atacar";
        public const string GatilhoLevar = "Levar";
        public const string GatilhoMorrer = "Morrer";

        static readonly int IdVelocidade = Animator.StringToHash(ParametroVelocidade);
        static readonly int IdAtacar = Animator.StringToHash(GatilhoAtacar);
        static readonly int IdLevar = Animator.StringToHash(GatilhoLevar);
        static readonly int IdMorrer = Animator.StringToHash(GatilhoMorrer);

        /// <summary>Valores de <c>Velocidade</c>: 0 é parado, isto é andar…</summary>
        public const float Andando = 1f;

        /// <summary>…e isto é correr — acima do limiar de 1,5 do controlador.</summary>
        public const float Correndo = 2f;

        /// <summary>A partir deste CUSTO em PP o deslocamento é corrida. Cinco
        /// casas é mais do que o passo típico de um turno curto — quem gasta
        /// isso atravessou a sala, e é o "deslocamento longo" do contrato §1.</summary>
        public const int PassosDeCorrida = 5;

        /// <summary>Casas por segundo de quem NÃO tem clipe (a cápsula, o acervo
        /// estático). O deslize vale para todo mundo: mesmo sem walk, ver o
        /// corpo atravessar o caminho lê melhor que o teletransporte de antes.</summary>
        public const float CadenciaPadrao = 2.5f;

        // O tempo por casa sai do CLIPE (um ciclo de walk são dois passos, um
        // passo por casa de 1 m), mas com piso e teto: um walk contemplativo de
        // 2 s não pode fazer o turno do monstro levar dez segundos, e um walk
        // frenético não pode virar teletransporte de novo.
        public const float TempoMinimoPorCasa = 0.20f;
        public const float TempoMaximoPorCasa = 0.55f;
        const float PassosPorCiclo = 2f;

        // ---------------------------------------------------------------- ESTADO

        readonly Cena.Elenco _elenco;
        readonly Cena.Palco _palco;
        readonly Motor.Batalha _batalha;

        sealed class Deslize
        {
            public GameObject Objeto;
            public Animator Animator;      // nulo na cápsula: desliza sem walk
            public List<Vector3> Pontos;   // mundo, no topo de cada casa do caminho
            public float Duracao;
            public float Tempo;
        }

        readonly List<Deslize> _deslizes = new List<Deslize>();
        readonly List<Motor.Evento> _pendentes = new List<Motor.Evento>();

        // Corpos caídos: soltos do Elenco, mas ainda precisam de corda fora de
        // Play para o clipe de queda terminar de tocar.
        readonly List<Animator> _caidos = new List<Animator>();

        // A frente de importação de cada corpo, para o giro compor por cima em
        // vez de apagar — zerar a rotação deitaria um FBX que chegue com a
        // correção de eixo no nó raiz (a lição do Elenco.Modelo). A chave é a
        // PRÓPRIA referência: GetInstanceID é obsoleto (e erro) nesta versão.
        readonly Dictionary<Transform, Quaternion> _frenteDeOrigem =
            new Dictionary<Transform, Quaternion>();

        public AnimacaoDoElenco(Cena.Elenco elenco, Cena.Palco palco, Motor.Batalha batalha)
        {
            if (elenco == null) throw new System.ArgumentNullException("elenco");
            if (palco == null) throw new System.ArgumentNullException("palco");
            if (batalha == null) throw new System.ArgumentNullException("batalha");
            _elenco = elenco;
            _palco = palco;
            _batalha = batalha;
        }

        /// <summary>Há deslize em andamento? É o que o relógio do turno do
        /// monstro consulta para a próxima jogada não atropelar a anterior.</summary>
        public bool Ocupada { get { return _deslizes.Count > 0; } }

        /// <summary>Quanto do deslize em andamento já passou, de 0 a 1 — e 1
        /// quando não há nenhum. É a régua da foto do meio do walk.</summary>
        public float Progresso
        {
            get
            {
                if (_deslizes.Count == 0) return 1f;
                float menor = 1f;
                for (int i = 0; i < _deslizes.Count; i++)
                {
                    var d = _deslizes[i];
                    float t = d.Duracao <= 0f ? 1f : Mathf.Clamp01(d.Tempo / d.Duracao);
                    if (t < menor) menor = t;
                }
                return menor;
            }
        }

        // ================================================================ REAGIR

        /// <summary>
        /// Lê os eventos de uma ação. Chamar ANTES do <c>Elenco.Sincronizar</c>:
        /// o corpo de quem morreu ainda está em cena, e é agora ou nunca que ele
        /// é adotado em vez de destruído.
        /// </summary>
        public void Reagir(Motor.Resultado r)
        {
            if (r == null) return;

            // Ação nova encerra o deslize anterior JÁ: o espelho vai plantar
            // todo mundo na casa final, e um deslize velho brigando com ele
            // deixaria a unidade a meio caminho de uma casa que não é mais dela.
            Concluir();
            _pendentes.Clear();

            // Quem morre nesta ação não anda nem se encolhe: um gatilho de
            // Levar armado sobreviveria ao Morrer dentro do Animator e o
            // cadáver levantaria agachado um quadro depois de cair.
            var mortos = new HashSet<string>();
            for (int i = 0; i < r.Eventos.Count; i++)
                if (r.Eventos[i].Tipo == Motor.TipoDeEvento.Morte)
                    mortos.Add(r.Eventos[i].Uid);

            for (int i = 0; i < r.Eventos.Count; i++)
            {
                var e = r.Eventos[i];
                switch (e.Tipo)
                {
                    case Motor.TipoDeEvento.Movimento:
                        if (!mortos.Contains(e.Uid)) _pendentes.Add(e);
                        break;

                    // Teleporte fica FORA de propósito: a cena desenha os dois
                    // de formas opostas — o passo desliza, o teleporte pisca —
                    // e piscar é o que o Sincronizar já faz sozinho.

                    // O hit do contrato é um recuo agachado, e é exatamente o
                    // gesto de quem tenta escapar de uma fixação: dano e
                    // esquiva (nas duas sortes) usam o mesmo clipe.
                    case Motor.TipoDeEvento.Dano:
                    case Motor.TipoDeEvento.EsquivaOk:
                    case Motor.TipoDeEvento.EsquivaFalhou:
                        if (!mortos.Contains(e.Uid)) Gatilho(e.Uid, IdLevar);
                        break;

                    case Motor.TipoDeEvento.Conjuracao:
                        Encarar(e.Uid, e.Para);
                        Gatilho(e.Uid, IdAtacar);
                        break;

                    case Motor.TipoDeEvento.Morte:
                        Tombar(e.Uid);
                        break;
                }
            }
        }

        /// <summary>
        /// Começa os deslizes da ação lida. Chamar DEPOIS do Sincronizar: o
        /// espelho plantou quem andou no destino; aqui a unidade volta ao ponto
        /// de partida e atravessa o caminho com tempo — sem isto o walk não
        /// aparece, porque não há deslocamento nenhum a animar.
        /// </summary>
        public void Animar()
        {
            for (int i = 0; i < _pendentes.Count; i++)
            {
                var e = _pendentes[i];
                var raiz = _elenco.ObjetoDe(e.Uid);
                if (raiz == null) continue;

                var pontos = Trajeto(e);
                if (pontos.Count < 2) continue;

                raiz.transform.position = pontos[0];

                var animator = AnimadorDe(raiz);
                float valor = e.Quantidade >= PassosDeCorrida ? Correndo : Andando;
                if (animator != null) animator.SetFloat(IdVelocidade, valor);

                _deslizes.Add(new Deslize
                {
                    Objeto = raiz,
                    Animator = animator,
                    Pontos = pontos,
                    Duracao = (pontos.Count - 1) * TempoPorCasa(animator, valor)
                });
            }
            _pendentes.Clear();
        }

        // =============================================================== AVANÇAR

        /// <summary>
        /// Um quadro de tempo: move os deslizes e, FORA de Play, dá corda nos
        /// Animators — em Play o próprio motor de quadro faz isso, e dar corda
        /// duas vezes tocaria tudo em velocidade dobrada.
        /// </summary>
        public void Avancar(float dt)
        {
            if (dt < 0f) dt = 0f;

            for (int i = _deslizes.Count - 1; i >= 0; i--)
            {
                var d = _deslizes[i];
                d.Tempo += dt;
                float t = d.Duracao <= 0f ? 1f : Mathf.Clamp01(d.Tempo / d.Duracao);
                Pousar(d, t);
                if (t >= 1f)
                {
                    if (d.Animator != null) d.Animator.SetFloat(IdVelocidade, 0f);
                    _deslizes.RemoveAt(i);
                }
            }

            if (!Application.isPlaying) Bombear(dt);
        }

        /// <summary>Termina os deslizes em andamento JÁ, cada um no seu ponto
        /// final. É o que uma ação nova faz com a anterior: melhor um salto
        /// curto até a casa certa do que duas verdades sobre onde a unidade está.</summary>
        public void Concluir()
        {
            for (int i = 0; i < _deslizes.Count; i++)
            {
                Pousar(_deslizes[i], 1f);
                if (_deslizes[i].Animator != null)
                    _deslizes[i].Animator.SetFloat(IdVelocidade, 0f);
            }
            _deslizes.Clear();
        }

        void Pousar(Deslize d, float t)
        {
            if (d.Objeto == null) return;
            // Amostragem por índice fracionário: as casas são equidistantes no
            // plano, então t linear percorre o caminho em ritmo constante — e o
            // degrau de altura de um obstáculo baixo entra de graça na conta.
            float s = t * (d.Pontos.Count - 1);
            int i = Mathf.Min(Mathf.FloorToInt(s), d.Pontos.Count - 2);
            var a = d.Pontos[i];
            var b = d.Pontos[i + 1];
            d.Objeto.transform.position = Vector3.Lerp(a, b, s - i);
            Virar(d.Objeto, b - a);
        }

        void Bombear(float dt)
        {
            var uids = _elenco.NoTabuleiro;
            for (int i = 0; i < uids.Count; i++)
            {
                var a = AnimadorDe(_elenco.ObjetoDe(uids[i]));
                if (a != null) a.Update(dt);
            }
            for (int i = _caidos.Count - 1; i >= 0; i--)
            {
                if (_caidos[i] == null) { _caidos.RemoveAt(i); continue; }
                _caidos[i].Update(dt);
            }
        }

        // =============================================================== MORTE

        /// <summary>
        /// A morte de quem tem Animator: o corpo sai da administração do Elenco
        /// ANTES do espelho — é isso que o impede de ser destruído — e cai onde
        /// o motor diz que caiu. Cápsula e acervo estático seguem o caminho de
        /// sempre: somem no Sincronizar, porque uma cápsula "caída" continuaria
        /// de pé, ocupando visualmente uma casa que está livre.
        /// </summary>
        void Tombar(string uid)
        {
            var raiz = _elenco.ObjetoDe(uid);
            var animator = AnimadorDe(raiz);
            if (animator == null) return;

            _elenco.Soltar(uid);

            // Cadáver não é informação tática. O selo e a marca respondem
            // "quem é meu?", e um caído com a marca acesa leria como vivo.
            Apagar(raiz.transform.Find("Selo"));
            Apagar(raiz.transform.Find("Marca"));

            // Onde o motor diz que ela morreu — o espelho não vai mais plantá-la.
            var u = _batalha.Acha(uid);
            if (u != null)
                raiz.transform.position = _palco.Mundo(u.Casa, _palco.TopoDe(u.Casa));

            // Gatilhos armados ANTES da morte disparariam DEPOIS dela: o
            // Animator segura trigger não consumido, e o cadáver atacaria.
            animator.ResetTrigger(IdAtacar);
            animator.ResetTrigger(IdLevar);
            animator.SetFloat(IdVelocidade, 0f);
            animator.SetTrigger(IdMorrer);
            _caidos.Add(animator);
        }

        // ================================================================ APOIO

        void Gatilho(string uid, int gatilho)
        {
            var animator = AnimadorDe(_elenco.ObjetoDe(uid));
            if (animator != null) animator.SetTrigger(gatilho);
        }

        /// <summary>O Animator COM controlador desta unidade, ou nulo. Sem
        /// controlador não há parâmetro que receber — é o elenco estático.</summary>
        static Animator AnimadorDe(GameObject raiz)
        {
            if (raiz == null) return null;
            var a = raiz.GetComponentInChildren<Animator>(true);
            return a != null && a.runtimeAnimatorController != null ? a : null;
        }

        static void Apagar(Transform t)
        {
            if (t == null) return;
            if (Application.isPlaying) Object.Destroy(t.gameObject);
            else Object.DestroyImmediate(t.gameObject);
        }

        // ------------------------------------------------------------- CAMINHO

        List<Vector3> Trajeto(Motor.Evento e)
        {
            var casas = CasasDoCaminho(e.De, e.Para, e.Quantidade);
            var pontos = new List<Vector3>(casas.Count);
            for (int i = 0; i < casas.Count; i++)
                pontos.Add(_palco.Mundo(casas[i], _palco.TopoDe(casas[i])));
            return pontos;
        }

        /// <summary>
        /// Refaz o caminho que o motor andou. O evento só traz as pontas e o
        /// custo; a busca é a MESMA do alcance (<c>Grade.Passo</c>), com descida
        /// gulosa do custo a partir do destino — qualquer caminho mínimo válido
        /// serve, porque o que não pode acontecer é o corpo deslizar através de
        /// uma parede em linha reta.
        ///
        /// Se a ocupação de agora já não fecha o caminho (alguém saiu do lugar
        /// entre o passo e a animação), vale a reta: é rede, não regra — melhor
        /// cortar um canto do que uma unidade que nunca chega.
        /// </summary>
        List<Vector2Int> CasasDoCaminho(Vector2Int de, Vector2Int para, int custo)
        {
            var reta = new List<Vector2Int> { de, para };
            if (de == para || custo < 1) return reta;

            var ocupadas = new List<Vector2Int>();
            for (int i = 0; i < _batalha.Unidades.Count; i++)
            {
                var u = _batalha.Unidades[i];
                if (u == null || !u.NoTabuleiro) continue;
                if (u.Casa == de || u.Casa == para) continue;
                ocupadas.Add(u.Casa);
            }

            var custos = Grade.Passo.Alcance(_batalha.Mapa, de, custo, ocupadas);
            int c;
            if (!custos.TryGetValue(para, out c)) return reta;

            var caminho = new List<Vector2Int> { para };
            var atual = para;
            var direcoes = new[]
            {
                new Vector2Int(1, 0), new Vector2Int(-1, 0),
                new Vector2Int(0, 1), new Vector2Int(0, -1)
            };
            while (c > 0)
            {
                bool desceu = false;
                for (int i = 0; i < direcoes.Length; i++)
                {
                    var v = atual + direcoes[i];
                    int cv;
                    if (custos.TryGetValue(v, out cv) && cv == c - 1)
                    {
                        atual = v;
                        c = cv;
                        caminho.Add(v);
                        desceu = true;
                        break;
                    }
                }
                if (!desceu) return reta; // custo sem vizinho menor: mapa mudou por baixo
            }
            caminho.Reverse();
            return caminho;
        }

        /// <summary>
        /// Tempo por casa, guiado pelo CLIPE: um ciclo de walk são dois passos e
        /// cada casa tem 1 m — é o que casa o pé com o chão em vez de deslizar
        /// de patins. Sem clipe, a cadência padrão da cápsula.
        /// </summary>
        static float TempoPorCasa(Animator animator, float valor)
        {
            float duracao = DuracaoDoClipe(animator, valor >= Correndo ? "run" : "walk");
            float t = duracao > 0f ? duracao / PassosPorCiclo : 1f / CadenciaPadrao;
            return Mathf.Clamp(t, TempoMinimoPorCasa, TempoMaximoPorCasa);
        }

        static float DuracaoDoClipe(Animator animator, string nome)
        {
            if (animator == null || animator.runtimeAnimatorController == null) return 0f;
            var clipes = animator.runtimeAnimatorController.animationClips;
            for (int i = 0; i < clipes.Length; i++)
                if (clipes[i] != null && clipes[i].name == nome) return clipes[i].length;
            return 0f;
        }

        // ---------------------------------------------------------------- GIRO

        void Encarar(string uid, Vector2Int casa)
        {
            var raiz = _elenco.ObjetoDe(uid);
            if (raiz == null) return;
            Virar(raiz, _palco.Mundo(casa, 0f) - raiz.transform.position);
        }

        /// <summary>
        /// Vira SÓ o corpo para onde ele anda ou mira — a raiz carrega o selo e
        /// a marca, que são sinais de leitura e não podem girar com o gesto. A
        /// rotação de importação fica composta POR BAIXO do giro: zerá-la
        /// deitaria um FBX que chegue com correção de eixo no nó raiz.
        /// </summary>
        void Virar(GameObject raiz, Vector3 direcaoMundo)
        {
            direcaoMundo.y = 0f;
            if (direcaoMundo.sqrMagnitude < 1e-6f) return;

            var corpo = raiz.transform.Find("Corpo");
            if (corpo == null) return;

            Quaternion origem;
            if (!_frenteDeOrigem.TryGetValue(corpo, out origem))
            {
                origem = corpo.localRotation;
                _frenteDeOrigem[corpo] = origem;
            }

            var local = raiz.transform.InverseTransformDirection(direcaoMundo);
            float giro = Mathf.Atan2(local.x, local.z) * Mathf.Rad2Deg;
            corpo.localRotation = Quaternion.Euler(0f, giro, 0f) * origem;
        }
    }
}
