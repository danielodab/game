using System;
using System.Collections.Generic;
using UnityEngine;
using Soterra.Dados;

namespace Soterra.Cena
{
    /// <summary>
    /// As unidades EM CIMA do tabuleiro: uma em cena para cada unidade da
    /// batalha, plantada na casa dela, com o lado legível de relance.
    ///
    /// Não é <c>MonoBehaviour</c> de propósito. Ele não tem <c>Update</c>, não
    /// tem estado que o Inspector precise mostrar e não sobrevive a nada — quem
    /// vive é o <see cref="Palco"/>, que hospeda a câmera. Como classe comum,
    /// roda em teste EditMode sem cena, que é onde a escala e o pivô do elenco
    /// definitivo vão ser conferidos.
    ///
    /// O que cada unidade é, hoje:
    /// <code>
    /// Unidade_&lt;uid&gt;      no chão da casa, filha do tabuleiro (gira com ele)
    ///   Selo              disco no chão, AZUL se herói, VERMELHO se monstro
    ///   Corpo             cápsula da altura da classe — ou o modelo definitivo
    ///   Marca             cubo acima da cabeça, na mesma cor do selo
    /// </code>
    ///
    /// O Selo e a Marca NÃO são parte do placeholder: continuam existindo depois
    /// que o elenco definitivo entrar. É neles que mora a resposta de "quem é
    /// meu?", e essa pergunta não pode depender de o jogador reconhecer a
    /// silhueta de seis classes e sessenta e seis bichos.
    /// </summary>
    public sealed class Elenco
    {
        // ================================================================ ALTURA

        /// <summary>
        /// Altura de cada classe, em metros, do CONTRATO_ENTREGA_PERSONAGEM §2.
        ///
        /// Não é enfeite: as seis são diferentes DE PROPÓSITO, e é a proporção
        /// entre elas que faz o papel de cada uma ser lido de longe — o tanque
        /// de 2,30 m e o ladino de 1,65 m se distinguem antes de você ler
        /// qualquer nome. Se o placeholder ignorar isso, a leitura do tabuleiro
        /// muda no dia em que o modelo entrar, e ninguém vai lembrar por quê.
        /// </summary>
        static readonly Dictionary<string, float> AlturaPorClasse = new Dictionary<string, float>
        {
            { "sumo",        2.30f },   // Bárbaro
            { "curandeira",  1.95f },   // Paladina
            { "invocador",   1.85f },   // Xamã
            { "arqueiro",    1.80f },   // Batedor
            { "bruxo",       1.75f },   // Bruxo
            { "espadachim",  1.65f }    // Ladino
        };

        /// <summary>Monstro comum: 1,80 m, de FICHA_GERACAO_ELENCO ("herói e
        /// monstro comum — 1,80 m"). É também o que sobra para id
        /// desconhecido.</summary>
        public const float AlturaComum = 1.80f;

        /// <summary>
        /// Chefe. A ficha mede a faixa de 5,16 a 5,46 m e não fixa por id; aqui
        /// entra o PISO da faixa, porque errar para baixo custa meio metro de
        /// presença e errar para cima faz o chefe atravessar a parede do fundo
        /// numa sala de 21×17. Quem souber a altura exata manda em
        /// <see cref="FichaDeUnidade.Altura"/>, que ganha desta.
        /// </summary>
        public const float AlturaDeChefe = 5.16f;

        /// <summary>
        /// Largura do corpo como fração da altura. O ombro humano fica em torno
        /// de 0,25 da altura; 0,32 dá corpo à cápsula sem chegar perto do teto
        /// de 2,2 células do CONTRATO_ENTREGA_PERSONAGEM §3 — o Bárbaro, o mais
        /// largo dos seis, sai com 0,74 célula.
        /// </summary>
        public const float LarguraPorAltura = 0.32f;

        /// <summary>Teto de largura do §3 do contrato de entrega, em células. É
        /// o número que o modelo definitivo tem de respeitar, e por isso está
        /// aqui e não só no documento: o teste cobra dele.</summary>
        public const float LarguraMaxima = 2.2f;

        // ================================================================= PEÇAS

        // O disco fica ACIMA das três camadas de realce (0,09 / 0,11 / 0,13). Se
        // ficasse embaixo, a placa translúcida do alcance pintaria o disco de
        // azul — e o disco perderia a cor justamente na casa para onde o jogador
        // está olhando. A 16 cm do chão, sob uma figura de 1,65 m ou mais, ele
        // continua lendo como anel no pé.
        const float FolgaSelo = 0.16f;
        const float LadoSelo = 0.90f;

        // A marca acima da cabeça foi medida na foto, não escolhida no escuro: a
        // 0,26 de célula ela dava dez pixels no enquadramento de 1600 px, e dez
        // pixels não são um sinal — são sujeira. A 0,42 ela lê antes do corpo,
        // que é o que se quer de um marcador de lado.
        const float AlturaDaMarca = 0.42f;
        const float FolgaDaMarca = 0.26f;    // espaço entre a cabeça e ela

        const float AlfaSelo = 0.95f;

        // ================================================================ ESTADO

        readonly Palco _palco;
        readonly BancoDeDados _banco;
        readonly IFonteDeModelos _modelos;
        readonly Aparencia _aparencia;

        /// <summary>O que já está desenhado, por Uid.</summary>
        readonly Dictionary<string, EmCena> _porUid = new Dictionary<string, EmCena>();
        readonly List<string> _presentes = new List<string>();
        readonly List<string> _saindo = new List<string>();

        Transform _grupo;

        sealed class EmCena
        {
            public GameObject Raiz;
            public string Id;        // a fusão TROCA o id da unidade sem trocar o Uid
            public bool Heroi;
            public float Altura;
        }

        /// <summary>
        /// <paramref name="banco"/> é opcional: sem ele o corpo sai cinza, e o
        /// lado continua legível pelo selo. Serve para o teste de geometria não
        /// precisar do acervo inteiro em disco.
        /// </summary>
        public Elenco(Palco palco, BancoDeDados banco = null, IFonteDeModelos modelos = null,
                      Aparencia aparencia = null)
        {
            if (palco == null) throw new ArgumentNullException("palco");
            _palco = palco;
            _banco = banco;
            _modelos = modelos ?? new ModelosDeResources();
            _aparencia = aparencia ?? Aparencia.Carregar();
        }

        /// <summary>Uids no tabuleiro depois da última sincronização.</summary>
        public IReadOnlyList<string> NoTabuleiro { get { return _presentes; } }

        /// <summary>O objeto desta unidade, ou nulo se ela não está no
        /// tabuleiro. Existe para o teste medir o que está na TELA — altura,
        /// largura, posição e cor de verdade — em vez de reconferir constante
        /// contra ela mesma.</summary>
        public GameObject ObjetoDe(string uid)
        {
            EmCena e;
            return uid != null && _porUid.TryGetValue(uid, out e) ? e.Raiz : null;
        }

        // =========================================================== SINCRONIZAR

        /// <summary>
        /// Põe a cena de acordo com a batalha: cria quem entrou, move quem
        /// andou, tira quem morreu ou saiu.
        ///
        /// Reaproveita por <see cref="FichaDeUnidade.Uid"/> em vez de refazer
        /// tudo. Refazer é mais curto de escrever e destrói o elenco a cada
        /// passo de cada turno — com modelo animado, cada movimento reiniciaria
        /// o `idle` de todo mundo, e o tabuleiro inteiro daria um solavanco a
        /// cada clique.
        ///
        /// Funciona FORA de Play, como o <see cref="Palco.Montar"/>, porque é
        /// assim que o modo lote vê o jogo.
        /// </summary>
        public void Sincronizar(IEnumerable<FichaDeUnidade> fichas)
        {
            var grupo = Grupo;
            _presentes.Clear();
            float maisAlto = 0f;

            if (fichas != null)
            {
                foreach (var ficha in fichas)
                {
                    // Sem Uid não há como reencontrar a unidade no quadro
                    // seguinte, e ela viraria um objeto novo por sincronização —
                    // um vazamento silencioso que só aparece como queda de
                    // quadro depois de uns turnos.
                    if (string.IsNullOrEmpty(ficha.Uid))
                        throw new ArgumentException("ficha de unidade sem Uid: a cena não teria " +
                                                    "como reencontrá-la e criaria uma cópia por turno");

                    if (!ficha.NoTabuleiro) continue;

                    var unidade = Obter(ficha, grupo);
                    Plantar(unidade.Raiz, ficha.Casa);
                    _presentes.Add(ficha.Uid);
                    maisAlto = Mathf.Max(maisAlto, unidade.Altura + FolgaDaMarca + AlturaDaMarca);
                }
            }

            Remover(QuemSaiu());

            // A câmera enquadra o que lhe contam. Sem este aviso ela continuaria
            // achando que o mais alto do tabuleiro é a parede de 1 m, e a
            // Jardineira-Viúva — 5 m de treliça e véu — sairia decapitada.
            _palco.AlturaDeCena = maisAlto;
        }

        /// <summary>
        /// Entrega o objeto desta unidade e PARA de administrá-lo: as
        /// sincronizações seguintes não vão movê-lo, trocá-lo nem destruí-lo.
        ///
        /// Existe por causa da MORTE animada: o espelho do jogo tira o morto da
        /// lista e o Sincronizar destruiria o corpo no mesmo quadro em que o
        /// clipe de queda começa. Soltando ANTES do espelho, o corpo fica caído
        /// no tabuleiro — que é o que o piloto do elenco pede — e o Elenco segue
        /// só com quem está vivo. O objeto continua pendurado no grupo do
        /// tabuleiro, então remontar o palco ainda o leva junto, como tudo.
        /// </summary>
        public GameObject Soltar(string uid)
        {
            EmCena e;
            if (uid == null || !_porUid.TryGetValue(uid, out e)) return null;
            _porUid.Remove(uid);
            return e.Raiz;
        }

        /// <summary>Tira todo mundo do tabuleiro.</summary>
        public void Limpar()
        {
            foreach (var e in _porUid.Values) Descartar(e.Raiz);
            _porUid.Clear();
            _presentes.Clear();
        }

        List<string> QuemSaiu()
        {
            _saindo.Clear();
            foreach (var uid in _porUid.Keys)
                if (!_presentes.Contains(uid)) _saindo.Add(uid);
            return _saindo;
        }

        void Remover(List<string> uids)
        {
            for (int i = 0; i < uids.Count; i++)
            {
                Descartar(_porUid[uids[i]].Raiz);
                _porUid.Remove(uids[i]);
            }
        }

        EmCena Obter(FichaDeUnidade ficha, Transform grupo)
        {
            float altura = AlturaDe(ficha);

            EmCena e;
            if (_porUid.TryGetValue(ficha.Uid, out e) && e.Raiz != null)
            {
                // A FUSÃO troca a classe da unidade sem trocar o Uid: o
                // anfitrião vira outra coisa, com outra altura e outra cor. Sem
                // esta conferência a unidade fundida continuaria com o corpo
                // antigo até morrer.
                if (e.Id == ficha.Id && e.Heroi == ficha.Heroi && Mathf.Approximately(e.Altura, altura))
                    return e;

                Descartar(e.Raiz);
                _porUid.Remove(ficha.Uid);
            }

            e = new EmCena
            {
                Raiz = Construir(ficha, altura, grupo),
                Id = ficha.Id,
                Heroi = ficha.Heroi,
                Altura = altura
            };
            _porUid[ficha.Uid] = e;
            return e;
        }

        void Plantar(GameObject go, Vector2Int casa)
        {
            // Posição de MUNDO, e não local: o grupo pendura no tabuleiro, que
            // pode estar girado, e Palco.Mundo já leva o giro em conta. Escrever
            // a conta de novo em coordenada local seria uma segunda fórmula que
            // um dia diverge da primeira.
            //
            // No TOPO da casa e não em y = 0: sobre obstáculo baixo a unidade
            // fica em cima dele, não enterrada nele.
            go.transform.position = _palco.Mundo(casa, _palco.TopoDe(casa));
        }

        // ============================================================ CONSTRUÇÃO

        GameObject Construir(FichaDeUnidade ficha, float altura, Transform grupo)
        {
            var raiz = new GameObject("Unidade_" + ficha.Uid);
            raiz.transform.SetParent(grupo, false);

            var corDoLado = ficha.Heroi ? Palco.CorAliado : Palco.CorInimigo;

            Selo(raiz.transform, corDoLado);
            Corpo(raiz.transform, ficha.Id, altura, ficha.Heroi);
            Marca(raiz.transform, corDoLado, altura);

            return raiz;
        }

        /// <summary>O disco de lado. Unlit porque marcador que escurece dentro
        /// da sombra de uma parede vira duas cores diferentes para a mesma
        /// informação.</summary>
        void Selo(Transform pai, Color cor)
        {
            var go = Peca("Selo", pai, PrimitiveType.Cylinder,
                          new Vector3(0f, FolgaSelo, 0f),
                          new Vector3(LadoSelo, 0.012f, LadoSelo),
                          Palco.Com(cor, AlfaSelo), _palco.MaterialMarcador, false);
            go.GetComponent<Renderer>().receiveShadows = false;
        }

        /// <summary>
        /// O corpo: o modelo do acervo se existe um para este id, senão a
        /// cápsula. É este `if` — e só ele — que separa placeholder de elenco.
        ///
        /// A cápsula não é decoração de rascunho: é a REDE. Modelo que não
        /// carregou não pode derrubar a batalha nem deixar uma casa vazia onde
        /// há um monstro, porque uma unidade invisível é pior que uma unidade
        /// feia — o jogador planeja em cima do que vê.
        /// </summary>
        void Corpo(Transform pai, string id, float altura, bool heroi)
        {
            var desenho = _aparencia != null ? _aparencia.De(id) : null;

            // A ESCADA DA TROCA, e a ordem importa:
            //   1. um modelo com o nome do próprio id — é onde o elenco do Meshy
            //      vai cair, e por isso ele ganha de tudo;
            //   2. o modelo que o _aparencia.json manda vestir (o acervo de hoje);
            //   3. cápsula.
            var prefab = _modelos.Modelo(id);

            // O desenho (a lista `show`, degrau 2) descreve as peças do modelo
            // do ACERVO. Aplicá-lo a um modelo do degrau 1 apagaria qualquer
            // peça solta cujo nome não bata com a lista do outro modelo — o
            // bruxo do Meshy entraria sem o que quer que não seja pele.
            if (prefab != null) desenho = null;

            if (prefab == null && desenho != null) prefab = _modelos.Modelo(desenho.Modelo);

            if (prefab != null) { Modelo(pai, prefab, altura, desenho, id, heroi); return; }

            float largura = altura * LarguraPorAltura;
            // A cápsula da Unity nasce com 2 de altura e pivô no MEIO: metade da
            // altura na escala Y, e o centro subido meia altura, põem os pés no
            // chão — que é onde o contrato de entrega manda o pivô do modelo
            // definitivo ficar também.
            Peca("Corpo", pai, PrimitiveType.Capsule,
                 new Vector3(0f, altura * 0.5f, 0f),
                 new Vector3(largura, altura * 0.5f, largura),
                 CorDoCorpo(id), _palco.MaterialFosco, true);
        }

        /// <summary>
        /// Encaixa um modelo do acervo: esconde as peças que esta unidade não
        /// veste, tinge, escala até a altura da classe e apoia os pés no chão.
        ///
        /// A escala e o apoio são medidos, não confiados: ficam em 1 e em 0
        /// quando o modelo chega no padrão do CONTRATO_ENTREGA_PERSONAGEM §2
        /// (metro, pivô entre os pés) e salvam a cena quando ele chega em
        /// centímetro ou com pivô no umbigo — que é como todo exportador erra
        /// pelo menos uma vez. O teste mede o resultado, não a intenção.
        /// </summary>
        void Modelo(Transform pai, GameObject prefab, float altura,
                    DesenhoDaUnidade desenho, string id, bool heroi)
        {
            var go = UnityEngine.Object.Instantiate(prefab, pai);
            go.name = "Corpo";

            // A rotação e a escala com que o modelo foi IMPORTADO ficam.
            // Zerá-las parece limpeza e é destruição: o FBX vindo do Blender
            // chega com a correção de eixo no próprio nó raiz, e sem ela o
            // personagem deita no chão. Deitado ele ainda passa no teste de
            // altura — a normalização mede a caixa e a estica até 2,30 m —, e o
            // que aparece na tela é uma cabeça do tamanho de quatro casas.
            var rotacao = go.transform.localRotation;
            var escalaDeOrigem = go.transform.localScale;
            go.transform.localPosition = Vector3.zero;

            Vestir(go, desenho);
            Tingir(go, id, heroi);

            // A caixa de um SkinnedMeshRenderer só acompanha a pose quando
            // alguém pede: sem isto a unidade pode ser cortada da tela por uma
            // caixa que não é mais a dela.
            var peles = go.GetComponentsInChildren<SkinnedMeshRenderer>(true);
            for (int i = 0; i < peles.Length; i++) peles[i].updateWhenOffscreen = true;

            // Medir DEPOIS de vestir: o cajado do mago passa da cabeça e o
            // machado do bárbaro se ergue acima dela. Com as peças na conta, o
            // corpo encolheria para a arma caber na altura da classe.
            var caixa = CaixaDoCorpo(go);
            if (caixa.size.y > 1e-4f)
            {
                float escala = altura / caixa.size.y;

                // A ALTURA manda na escala, mas a LARGURA tem teto. Sem o teto,
                // o Bufo-de-Pólen — que é uma bola achatada de 1,50 de alto por
                // 3,50 de largo — esticado para 1,80 m de altura ficaria com
                // 4,2 células de largura e apagaria quatro casas do tabuleiro.
                // É o defeito que o CONTRATO_ENTREGA_PERSONAGEM §3 descreve nas
                // asas do Paladino, e a regra de lá é a que vale: até ~2,2
                // células. Quem é largo demais entra mais baixo.
                float largura = Mathf.Max(caixa.size.x, caixa.size.z) * escala / Palco.Passo;
                if (largura > LarguraMaxima) escala *= LarguraMaxima / largura;

                go.transform.localScale = escalaDeOrigem * escala;
                // Depois de escalar, o ponto mais baixo do modelo está em
                // caixa.min.y * escala. Descer por esse tanto põe os pés em
                // y = 0 seja qual for o pivô com que ele veio.
                go.transform.localPosition = new Vector3(0f, -caixa.min.y * escala, 0f);
            }

            // Modelo mais largo que alto costuma ser modelo DEITADO — eixo
            // trocado na exportação. Vale um aviso porque o defeito é mudo: a
            // normalização estica a espessura dele até a altura da classe, todo
            // teste de altura continua verde, e só a foto denuncia.
            //
            // Aviso e não exceção: bicho achatado existe de verdade (o
            // Bufo-de-Pólen é uma bola com perninhas), e derrubar a batalha por
            // causa dele seria pior que desenhá-lo.
            if (caixa.size.y < Mathf.Max(caixa.size.x, caixa.size.z) * 0.55f)
                Debug.LogWarning("[SOTERRA] o modelo de " + id + " é bem mais largo que alto (" +
                                 caixa.size.ToString("0.00") + ", rotação de origem " +
                                 rotacao.eulerAngles.ToString("0") + "): confira se ele não " +
                                 "chegou deitado.");

            Animar(go, id);
        }

        // ============================================================ ANIMAÇÃO

        /// <summary>
        /// Caminho, dentro de <c>Resources</c>, do AnimatorController
        /// compartilhado do elenco — o do CONTRATO_ENTREGA_PERSONAGEM §6, gerado
        /// por <c>Soterra.Ferramentas.ControladorDoElenco</c>. O <c>_</c> na
        /// frente é o prefixo que a pasta reserva para o que não é personagem;
        /// id de classe nunca começa com ele.
        /// </summary>
        public const string CaminhoDoControlador = ModelosDeResources.Pasta + "/_controlador";

        /// <summary>Os seis nomes de clipe do CONTRATO_ENTREGA_PERSONAGEM §1.
        /// O jogo chama a animação pelo nome: nome diferente é animação que
        /// nunca toca — e é por isso que os nomes moram numa constante e não
        /// espalhados em texto.</summary>
        public static readonly IReadOnlyList<string> NomesDeClipe =
            new[] { "idle", "walk", "run", "attack", "hit", "death" };

        /// <summary>Os que repetem, da tabela do §1. <c>death</c> fica de fora
        /// DE PROPÓSITO: clipe sem laço segura o último quadro, e é isso que
        /// deixa o corpo caído em vez de ressuscitar em pé.</summary>
        public static readonly IReadOnlyList<string> ClipesEmLaco =
            new[] { "idle", "walk", "run" };

        // Estáticos como o cache de malhas: o controlador e os clipes são
        // assets, um só de cada por processo, e recarregá-los por unidade
        // custaria um Load por monstro por batalha.
        static RuntimeAnimatorController _controlador;
        static bool _controladorProcurado;
        static readonly Dictionary<string, AnimationClip[]> _clipesPorId =
            new Dictionary<string, AnimationClip[]>();

        /// <summary>
        /// Os clipes que o acervo tem para este id — os sub-assets de animação
        /// da PASTA do id (<c>elenco/&lt;id&gt;/</c>). Vazio é o estado normal
        /// de quem ainda não tem modelo definitivo, não um defeito.
        ///
        /// A pasta inteira, e não só o FBX homônimo, porque o contrato §1 aceita
        /// a entrega em um arquivo por animação quando o exportador não deixa
        /// renomear takes — e aí os clipes chegam espalhados em seis arquivos.
        /// </summary>
        public static AnimationClip[] ClipesDe(string id)
        {
            if (string.IsNullOrEmpty(id)) return new AnimationClip[0];

            AnimationClip[] achados;
            if (_clipesPorId.TryGetValue(id, out achados)) return achados;

            var brutos = Resources.LoadAll<AnimationClip>(ModelosDeResources.Pasta + "/" + id);
            // Os clipes de pré-visualização do importador não são animação de
            // ninguém — se algum vazar no Load, entraria no override por nome.
            achados = Array.FindAll(brutos, c => c != null && !c.name.StartsWith("__preview__"));
            _clipesPorId[id] = achados;
            return achados;
        }

        /// <summary>
        /// Anexa o Animator do CONTRATO_ENTREGA_PERSONAGEM §6 quando este id tem
        /// clipes no acervo. Sem clipes — todo o elenco CC0 estático de hoje —
        /// NADA acontece, e é essa a rede: um personagem que ainda não chegou
        /// não pode quebrar os que já estão em cena.
        ///
        /// O controlador é um só, compartilhado; a animação de verdade entra por
        /// <c>AnimatorOverrideController</c>, clipe a clipe, casado pelo NOME —
        /// os seis nomes do contrato §1. Clipe que faltar fica com o vazio do
        /// controlador: o estado existe, só não desenha nada.
        /// </summary>
        void Animar(GameObject go, string id)
        {
            var clipes = ClipesDe(id);
            if (clipes.Length == 0) return;

            var controlador = Controlador();
            if (controlador == null) return;

            // O FBX importado com rig já traz o Animator (e o Avatar) na raiz;
            // o AddComponent é só para um acervo empacotado de outro jeito.
            var animator = go.GetComponentInChildren<Animator>(true);
            if (animator == null) animator = go.AddComponent<Animator>();

            var sobre = new AnimatorOverrideController(controlador) { name = id };
            var pares = new List<KeyValuePair<AnimationClip, AnimationClip>>();
            sobre.GetOverrides(pares);
            for (int i = 0; i < pares.Count; i++)
            {
                var alvo = Clipe(clipes, pares[i].Key.name);
                if (alvo != null)
                    pares[i] = new KeyValuePair<AnimationClip, AnimationClip>(pares[i].Key, alvo);
            }
            sobre.ApplyOverrides(pares);

            animator.runtimeAnimatorController = sobre;
            // A câmera é fixa e o tabuleiro gira: um corpo que congela porque a
            // caixa dele saiu do enquadre por um quadro é defeito invisível de
            // reproduzir. O elenco de uma sala cabe no orçamento de animar sempre.
            animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;

            // Fora de Play ninguém dá corda no Animator, e o modelo ficaria na
            // pose de amarração do FBX em toda foto do lote. Um passo de zero
            // segundos liga o grafo e pousa o corpo no primeiro quadro do idle.
            if (!Application.isPlaying) animator.Update(0f);
        }

        static AnimationClip Clipe(AnimationClip[] clipes, string nome)
        {
            for (int i = 0; i < clipes.Length; i++)
                if (clipes[i] != null && clipes[i].name == nome) return clipes[i];
            return null;
        }

        RuntimeAnimatorController Controlador()
        {
            if (_controladorProcurado) return _controlador;
            _controladorProcurado = true;
            _controlador = Resources.Load<RuntimeAnimatorController>(CaminhoDoControlador);
            if (_controlador == null)
                // Aviso e não exceção: sem controlador o modelo entra parado,
                // que é como o elenco inteiro vivia até ontem — pior seria a
                // batalha cair por causa de um asset de animação.
                Debug.LogWarning("[SOTERRA] não há controlador em Resources/" +
                                 CaminhoDoControlador + " — o elenco entra sem animação. " +
                                 "Gere com Soterra.Ferramentas.ControladorDoElenco.Gerar.");
            return _controlador;
        }

        /// <summary>
        /// Liga só as peças soltas que esta unidade veste. Sem isto o Xamã
        /// aparece de chapéu pontudo e o Bárbaro carrega o machado de duas mãos,
        /// a caneca e o escudo ao mesmo tempo — cada GLB da KayKit traz o
        /// guarda-roupa inteiro do personagem numa cena só.
        ///
        /// O corpo (<c>SkinnedMeshRenderer</c>) fica SEMPRE ligado, e é por isso
        /// que a regra olha o tipo do renderizador e não o nome: é a mesma linha
        /// do jogo em JS (<c>if (!n.isMesh || n.isSkinnedMesh) return;</c>), e
        /// sem ela uma lista `show` incompleta apagaria o personagem.
        ///
        /// Lista vazia quer dizer "mostra tudo": é o caso dos bichos do
        /// Quaternius, que vêm num corpo só, sem nada para escolher.
        /// </summary>
        static void Vestir(GameObject go, DesenhoDaUnidade desenho)
        {
            if (desenho == null || desenho.Mostrar == null || desenho.Mostrar.Count == 0) return;

            var visiveis = new HashSet<string>(desenho.Mostrar);
            var soltas = go.GetComponentsInChildren<MeshRenderer>(true);
            for (int i = 0; i < soltas.Length; i++)
                // Desliga o OBJETO e não só o renderizador: assim a peça também
                // some da medição da caixa, e um machado erguido acima da cabeça
                // deixa de encolher o dono.
                soltas[i].gameObject.SetActive(visiveis.Contains(soltas[i].gameObject.name));
        }

        /// <summary>
        /// Verniz de cor por cima da textura do acervo.
        ///
        /// A conta é a do jogo em JS: <c>color.lerp(tinta, força)</c> com força
        /// 0,30 no herói e 0,52 no monstro. A diferença tem motivo declarado lá:
        /// "o material do KayKit não tem baseColorFactor, TODA a cor vem do
        /// atlas — tingir forte multiplica o atlas por uma cor chapada e lava o
        /// desenho. Herói recebe só um verniz; monstro recebe mais, porque a
        /// leitura do ELEMENTO é tática."
        ///
        /// Vai em <c>MaterialPropertyBlock</c>, nunca em material clonado: o
        /// material do FBX é compartilhado por todo mundo que usa aquele arquivo,
        /// e os cinco monstros que vestem o mesmo sapo sairiam todos da cor do
        /// último a ser pintado.
        /// </summary>
        void Tingir(GameObject go, string id, bool heroi)
        {
            var tinta = CorDoCorpo(id);
            float forca = heroi ? 0.30f : 0.52f;

            var rs = go.GetComponentsInChildren<Renderer>(true);
            for (int i = 0; i < rs.Length; i++)
            {
                var materiais = rs[i].sharedMaterials;
                for (int m = 0; m < materiais.Length; m++)
                {
                    // Parte da cor que o MATERIAL já tem, e não do branco. Onde
                    // a cor vem da textura o material é branco e dá no mesmo;
                    // onde ela vem do próprio material — e é assim que metade
                    // do acervo pinta o corpo — partir do branco APAGARIA a cor
                    // do modelo e devolveria um boneco de uma cor só.
                    var propria = materiais[m] != null && materiais[m].HasProperty(IdCorDoMaterial)
                                  ? materiais[m].GetColor(IdCorDoMaterial) : Color.white;
                    Palco.Pintar(rs[i], Color.Lerp(propria, tinta, forca), m);
                }
            }
        }

        static readonly int IdCorDoMaterial = Shader.PropertyToID("_BaseColor");

        /// <summary>
        /// Caixa do CORPO, no espaço do próprio objeto.
        ///
        /// Só as malhas com esqueleto quando existe alguma — é o
        /// <c>visibleBodyBox</c> do jogo em JS. Medir com a arma junto faria a
        /// altura do personagem depender de quanto o cajado passa da cabeça, e
        /// o mago viraria um anão de cajado alto ao lado do ladino de adaga.
        ///
        /// <c>Renderer.bounds</c> é de MUNDO e já viria com a posição da casa
        /// somada; daí a conversão de volta para o espaço local.
        /// </summary>
        static Bounds CaixaDoCorpo(GameObject go)
        {
            var caixa = new Bounds(Vector3.zero, Vector3.zero);
            if (Somar(go, go.GetComponentsInChildren<SkinnedMeshRenderer>(false), ref caixa))
                return caixa;

            // Sem malha com esqueleto (um adereço, um modelo estático), vale o
            // que houver — melhor uma medida com a arma do que medida nenhuma.
            Somar(go, go.GetComponentsInChildren<Renderer>(false), ref caixa);
            return caixa;
        }

        static bool Somar(GameObject raiz, Renderer[] rs, ref Bounds caixa)
        {
            bool algum = false;
            var paraLocal = raiz.transform.worldToLocalMatrix;
            for (int i = 0; i < rs.Length; i++)
            {
                if (!rs[i].enabled || !rs[i].gameObject.activeInHierarchy) continue;

                var malha = MalhaDe(rs[i]);
                if (malha == null) continue;

                var local = malha.bounds;
                var paraCa = paraLocal * rs[i].transform.localToWorldMatrix;

                // As oito quinas, e não centro-mais-tamanho: a caixa está
                // alinhada aos eixos DELA, e transformar só o centro deixaria o
                // tamanho no sistema errado.
                for (int q = 0; q < 8; q++)
                {
                    var p = paraCa.MultiplyPoint3x4(new Vector3(
                        (q & 1) == 0 ? local.min.x : local.max.x,
                        (q & 2) == 0 ? local.min.y : local.max.y,
                        (q & 4) == 0 ? local.min.z : local.max.z));
                    if (!algum) { caixa = new Bounds(p, Vector3.zero); algum = true; }
                    else caixa.Encapsulate(p);
                }
            }
            return algum;
        }

        /// <summary>
        /// A malha de um renderizador, seja ele de pele ou não.
        ///
        /// A medida sai da MALHA e não de <c>Renderer.bounds</c>, e isso custou
        /// uma foto: fora de Play a caixa de um <c>SkinnedMeshRenderer</c> pode
        /// nunca ter sido calculada — o sapo da Estufa media 4 cm. Como o
        /// encaixe normaliza dividindo por essa medida, 4 cm viraram um fator de
        /// 45 e o bicho ocupou meia sala. A caixa da malha é do ASSET: existe
        /// antes de qualquer quadro e não depende de nada ter sido desenhado.
        /// </summary>
        static Mesh MalhaDe(Renderer r)
        {
            var pele = r as SkinnedMeshRenderer;
            if (pele != null) return pele.sharedMesh;
            var mf = r.GetComponent<MeshFilter>();
            return mf != null ? mf.sharedMesh : null;
        }

        /// <summary>
        /// O cubinho de lado acima da cabeça. Segundo sinal do mesmo dado, e
        /// deliberadamente redundante com o selo: o selo some atrás de uma
        /// parede alta, a marca não.
        ///
        /// Desenhada sem escrever profundidade, pelo mesmo motivo que a barra de
        /// vida do jogo em JS usa `depthTest:false` — "legível de qualquer
        /// ângulo". Numa câmera fixa em 3/4 há sempre alguma unidade atrás de
        /// alguma parede, e uma unidade que some do tabuleiro some do
        /// planejamento do jogador.
        /// </summary>
        void Marca(Transform pai, Color cor, float altura)
        {
            var go = Peca("Marca", pai, PrimitiveType.Cube,
                          new Vector3(0f, altura + FolgaDaMarca, 0f),
                          Vector3.one * AlturaDaMarca,
                          Palco.Com(cor, 1f), _palco.MaterialMarcador, false);
            go.GetComponent<Renderer>().receiveShadows = false;
        }

        // ==================================================================== COR

        /// <summary>
        /// Cor do corpo. Sai do acervo, nunca de escolha minha: da paleta da
        /// classe se for herói (`palette.primary`), da cor do elemento se for
        /// bicho (`elementInfo[e].color`). Sem banco de dados, cinza — e o lado
        /// continua legível pelo selo e pela marca.
        /// </summary>
        public Color CorDoCorpo(string id)
        {
            var cinza = new Color(0.62f, 0.62f, 0.64f);
            if (_banco == null || string.IsNullOrEmpty(id)) return cinza;

            Classe classe;
            if (_banco.Classes != null && _banco.Classes.TryGetValue(id, out classe) &&
                classe != null && classe.Paleta != null)
                return Hex(classe.Paleta.Primaria, cinza);

            Monstro monstro;
            if (_banco.Monstros != null && _banco.Monstros.TryGetValue(id, out monstro) && monstro != null)
                return CorDoElemento(monstro.Elemento, cinza);

            return cinza;
        }

        /// <summary>Cor de um elemento, de <c>elementInfo</c>.</summary>
        public Color CorDoElemento(string elemento, Color padrao)
        {
            InfoDeElemento info;
            if (_banco != null && _banco.InfoDeElementos != null && elemento != null &&
                _banco.InfoDeElementos.TryGetValue(elemento, out info) && info != null)
                return Hex(info.Cor, padrao);
            return padrao;
        }

        static Color Hex(string texto, Color padrao)
        {
            Color c;
            return !string.IsNullOrEmpty(texto) && ColorUtility.TryParseHtmlString(texto, out c)
                   ? c : padrao;
        }

        // ================================================================= ALTURA

        /// <summary>Altura desta unidade, em metros.</summary>
        public float AlturaDe(FichaDeUnidade ficha)
        {
            // O que veio na ficha ganha: quem monta a batalha pode saber de um
            // caso que a tabela por id não sabe — o chefe, hoje.
            if (ficha.Altura > 0f) return ficha.Altura;
            return AlturaDe(ficha.Id);
        }

        /// <summary>
        /// Altura por id: a tabela do contrato para as seis classes, chefe pelo
        /// bestiário, e para o resto 1,80 m corrigido pelo porte do acervo.
        ///
        /// A correção (<c>scale</c> do <c>_aparencia.json</c>) vale para BICHO e
        /// não para classe, e a fronteira tem motivo: no acervo ela é um
        /// multiplicador sobre a altura do monstro comum, e é o único lugar em
        /// que a Vespa-Lustre fica menor que a Vergasta. Nas seis classes quem
        /// manda é a tabela do CONTRATO_ENTREGA_PERSONAGEM §2, que já embute a
        /// mesma informação — multiplicar de novo faria o Bárbaro passar de 2,30
        /// para 2,67 m e a escada de porte inteira sair do contrato.
        /// </summary>
        public float AlturaDe(string id)
        {
            float h;
            if (id != null && AlturaPorClasse.TryGetValue(id, out h)) return h;

            Monstro monstro;
            if (_banco != null && _banco.Monstros != null && id != null &&
                _banco.Monstros.TryGetValue(id, out monstro) && monstro != null && monstro.Chefe)
                return AlturaDeChefe;

            var desenho = _aparencia != null ? _aparencia.De(id) : null;
            float porte = desenho != null && desenho.Escala > 0f ? desenho.Escala : 1f;
            return AlturaComum * porte;
        }

        /// <summary>Altura da classe, sem depender de instância nem de acervo.
        /// Devolve 0 se o id não é uma das seis — quem chama distingue "não é
        /// classe" de "é classe baixa".</summary>
        public static float AlturaDaClasse(string id)
        {
            float h;
            return id != null && AlturaPorClasse.TryGetValue(id, out h) ? h : 0f;
        }

        /// <summary>As seis, da mais alta para a mais baixa. A ORDEM é o que
        /// carrega a leitura de papel — ver <see cref="AlturaPorClasse"/>.</summary>
        public static IReadOnlyList<string> Classes
        {
            get { return new[] { "sumo", "curandeira", "invocador", "arqueiro", "bruxo", "espadachim" }; }
        }

        // ================================================================= APOIO

        /// <summary>O grupo das unidades, pendurado no tabuleiro para girar com
        /// ele. Recriado quando <see cref="Palco.Montar"/> apaga os filhos da
        /// raiz — e, quando isso acontece, o que estava desenhado morreu junto,
        /// então o índice também zera.</summary>
        Transform Grupo
        {
            get
            {
                if (_grupo != null) return _grupo;

                // Tudo que estava pendurado no grupo velho foi destruído com
                // ele. Segurar as referências faria ObjetoDe devolver objeto
                // morto, que em Unity não é nulo mas também não é nada.
                _porUid.Clear();

                var achado = _palco.Tabuleiro.Find("Elenco");
                if (achado != null) { _grupo = achado; return _grupo; }

                var go = new GameObject("Elenco");
                go.transform.SetParent(_palco.Tabuleiro, false);
                _grupo = go.transform;
                return _grupo;
            }
        }

        GameObject Peca(string nome, Transform pai, PrimitiveType tipo, Vector3 posicao,
                        Vector3 escala, Color cor, Material material, bool sombra)
        {
            var go = new GameObject(nome);
            go.transform.SetParent(pai, false);
            go.transform.localPosition = posicao;
            go.transform.localScale = escala;
            go.AddComponent<MeshFilter>().sharedMesh = Malha(tipo);
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = material;
            r.shadowCastingMode = sombra
                ? UnityEngine.Rendering.ShadowCastingMode.On
                : UnityEngine.Rendering.ShadowCastingMode.Off;
            Palco.Pintar(r, cor);
            return go;
        }

        // Malha emprestada de um primitivo descartado na hora, como no Palco: o
        // primitivo pronto viria com colisor junto, e ninguém aqui usa física —
        // clique vira casa por conta, não por raycast.
        static readonly Dictionary<PrimitiveType, Mesh> _malhas = new Dictionary<PrimitiveType, Mesh>();

        static Mesh Malha(PrimitiveType tipo)
        {
            Mesh m;
            if (_malhas.TryGetValue(tipo, out m) && m != null) return m;

            var molde = GameObject.CreatePrimitive(tipo);
            m = molde.GetComponent<MeshFilter>().sharedMesh;
            Descartar(molde);
            _malhas[tipo] = m;
            return m;
        }

        /// <summary>Destrói agora fora de Play, e no fim do quadro em Play.
        /// `Destroy` fora de Play não faz NADA, e o objeto velho sobreviveria à
        /// sincronização seguinte, empilhado e invisível.</summary>
        static void Descartar(UnityEngine.Object alvo)
        {
            if (alvo == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(alvo);
            else UnityEngine.Object.DestroyImmediate(alvo);
        }
    }
}
