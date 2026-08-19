using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using Soterra.Grade;

using TipoDeCasa = Soterra.Grade.Casa;

namespace Soterra.Cena
{
    /// <summary>
    /// As famílias em que a sala é costurada. Cada família vira UMA malha e UM
    /// desenho na tela — é essa a diferença entre uma sala de 357 objetos e uma
    /// de oito.
    /// </summary>
    public enum GrupoDeCenario
    {
        Chao1, Chao2, Decorado, Fundacao, Alto, Baixo, Tocha, Tampa
    }

    /// <summary>O que foi desenhado numa casa. Existe para o teste medir o que
    /// está na TELA — peça, giro, altura, pegada e tinta — agora que não há mais
    /// um objeto por casa para interrogar.</summary>
    public struct DesenhoDaCasa
    {
        public string Peca;
        public int Quartos;
        public GrupoDeCenario Grupo;

        /// <summary>Altura do topo do que ocupa a casa, em casas.</summary>
        public float Topo;

        /// <summary>Maior lado horizontal do que ocupa a casa, em casas. É o
        /// terceiro sinal que separa alto de baixo: o alto preenche a casa, o
        /// baixo deixa um anel de piso em volta.</summary>
        public float Pegada;

        public Color Tinta;

        /// <summary>Verdadeiro quando a peça do kit não estava lá e a casa caiu
        /// no cubo. Não é defeito: é o estado antes de alguém rodar
        /// <c>converter_cenario.ps1</c>, e a sala tem de continuar legível.</summary>
        public bool Cubo;
    }

    /// <summary>
    /// Monta a sala com o env-kit KayKit — parede, quina, cruz, coluna, escombro,
    /// tocha, barril —, do jeito que o jogo em JS já monta
    /// (<c>js/render3d/models3d.js</c> e <c>renderer3d_v2.js</c>).
    ///
    /// DUAS COISAS MANDAM AQUI, e as duas vieram de defeito:
    ///
    /// 1. <b>Alto e baixo têm de se separar de relance.</b> Peça bonita que
    ///    apaga a diferença entre "veda a visão" e "dá para atirar por cima"
    ///    piora o jogo — é a informação mais importante do tabuleiro depois das
    ///    unidades. Por isso a cobertura é normalizada em ALTURA (metade da
    ///    parede), tem a PEGADA travada abaixo da casa (sobra um anel de piso),
    ///    recebe a TINTA mais clara da paleta e ganha uma TAMPA translúcida no
    ///    topo — quatro sinais, não um.
    ///
    /// 2. <b>Uma casa não pode custar um objeto.</b> Uma sala de 21×17 são 357
    ///    casas; com malha própria em cada uma, o celular sofre. As 49 peças do
    ///    kit dividem UM material e UM atlas, então a sala inteira é costurada em
    ///    uma malha por TINTA — oito no pior caso, e nenhuma delas depende do
    ///    tamanho do mapa.
    ///
    /// Se a peça não estiver importada, a casa cai no CUBO da rodada 1. Sem esse
    /// desvio, um kit ausente desenharia uma sala vazia — e sala vazia parece
    /// mapa carregado errado, não peça faltando.
    /// </summary>
    public sealed class Cenografia
    {
        // ================================================================ MEDIDAS

        /// <summary>Lado de uma casa. O mesmo <see cref="Palco.Passo"/>; repetido
        /// aqui para o construtor da sala não depender do MonoBehaviour.</summary>
        public const float Passo = Palco.Passo;

        // A peça de parede reta do kit tem exatamente UMA casa de comprimento; é
        // ela a régua de todo o resto, e não a caixa de cada peça — a quina mede
        // 2,5 e a meia-parede mede 2, e normalizar cada uma por si faria as três
        // saírem de tamanhos diferentes na mesma parede.
        const string PecaRegua = "wall_str";

        // Escalas do jogo em JS convertidas para "casas por unidade do kit". Lá a
        // casa mede 2 unidades e a parede sai em `scale 0.5`; aqui a casa mede 1,
        // então o fator é metade do de lá. Coluna 0,6 e poste 0,56 viram estes
        // múltiplos da parede.
        const float ColunaSobreParede = 1.20f;
        const float PosteSobreParede = 1.12f;
        const float TochaSobreParede = 1.70f;

        // Fração de casa que a tocha avança para fora da face da parede, e a
        // altura em que ela é fincada. Os dois de `buildWall` (`dir * 0.3` e
        // `h * 0.62`), divididos pela casa de 2 unidades do JS.
        const float TochaSaliencia = 0.15f;
        const float TochaAltura = 0.62f;

        /// <summary>Uma tocha a cada tantas paredes de face livre. Densidade
        /// baixa de propósito: tocha em toda parede vira serrilha luminosa e
        /// come a atenção que é do tabuleiro.</summary>
        public const float DensidadeDeTocha = 0.16f;

        // ================================================================= ESTADO

        readonly IFonteDePecas _fonte;
        readonly Dictionary<Vector2Int, DesenhoDaCasa> _desenhos =
            new Dictionary<Vector2Int, DesenhoDaCasa>();
        readonly Dictionary<GrupoDeCenario, List<CombineInstance>> _lotes =
            new Dictionary<GrupoDeCenario, List<CombineInstance>>();
        readonly List<GameObject> _grupos = new List<GameObject>();
        readonly List<Mesh> _costuradas = new List<Mesh>();

        Material _kit;
        float _escalaParede = 0.25f;

        // Onde fica o centro de uma casa, no espaço do tabuleiro. Vem de FORA, do
        // Palco, em vez de ser recalculado aqui: as duas contas seriam idênticas
        // hoje e divergiriam no dia em que alguém mexesse numa só — e o sintoma
        // seria a sala inteira meio passo fora do lugar em que se clica.
        System.Func<Vector2Int, Vector3> _onde;

        public TemaDoCenario Tema { get; private set; }

        /// <summary>Quantos objetos com malha a sala custa. É o número que decide
        /// se ela roda num celular, e por isso é público em vez de comentário.</summary>
        public int Objetos { get { return _grupos.Count; } }

        /// <summary>
        /// Quantas chamadas de desenho a sala custa por quadro: uma por grupo,
        /// mais uma por grupo que lança sombra — o mapa de sombra é um segundo
        /// passe sobre a mesma malha, e esquecê-lo faz a conta parecer metade do
        /// que é. Não conta o realce (só as placas acesas desenham), nem o elenco.
        /// </summary>
        public int ChamadasDeDesenho
        {
            get
            {
                int n = 0;
                foreach (var par in _lotes)
                    if (par.Value.Count > 0) n += Sombreia(par.Key) ? 2 : 1;
                return n;
            }
        }

        /// <summary>Altura do mais alto que a sala desenhou, em casas. A coluna
        /// solta passa da parede (1,2 contra 1,0), e sem esta medida o
        /// enquadramento cortaria o topo dela.</summary>
        public float AlturaMaxima { get; private set; }

        /// <summary>Verdadeiro quando o kit foi encontrado. Falso quer dizer sala
        /// em cubo — estado esperado antes de <c>converter_cenario.ps1</c>.</summary>
        public bool ComKit { get; private set; }

        public Cenografia(IFonteDePecas fonte = null, TemaDoCenario tema = null)
        {
            _fonte = fonte ?? new PecasDeResources();
            Tema = tema ?? TemaDoCenario.Padrao;
        }

        // ================================================================= MONTAR

        /// <summary>
        /// Desenha o mapa inteiro sob <paramref name="pai"/>. Funciona fora de
        /// Play — o modo lote nunca aperta Play.
        ///
        /// <paramref name="fosco"/> é o material de quem NÃO tem o kit (cubo) e
        /// <paramref name="marcador"/> o das tampas translúcidas; os dois vêm do
        /// <see cref="Palco"/> para o projeto inteiro ter um material só por
        /// espécie, como manda a §3 do contrato.
        /// </summary>
        public void Montar(Mapa mapa, Transform pai, Material fosco, Material marcador, Mesh cubo,
                           System.Func<Vector2Int, Vector3> onde)
        {
            if (mapa == null) throw new System.ArgumentNullException("mapa");
            if (pai == null) throw new System.ArgumentNullException("pai");

            Limpar();
            _onde = onde;
            MedirRegua();

            for (int y = 0; y < mapa.Altura; y++)
                for (int x = 0; x < mapa.Largura; x++)
                    Casa(mapa, new Vector2Int(x, y), cubo);

            Costurar(pai, fosco, marcador);
        }

        /// <summary>O que foi desenhado nesta casa, ou nada no vazio.</summary>
        public DesenhoDaCasa? Em(Vector2Int casa)
        {
            DesenhoDaCasa d;
            return _desenhos.TryGetValue(casa, out d) ? (DesenhoDaCasa?)d : null;
        }

        /// <summary>Altura do topo do que está na casa: 0 no chão.</summary>
        public float TopoDe(Vector2Int casa)
        {
            DesenhoDaCasa d;
            return _desenhos.TryGetValue(casa, out d) ? d.Topo : 0f;
        }

        // ============================================================== UMA CASA

        void Casa(Mapa mapa, Vector2Int casa, Mesh cubo)
        {
            var tipo = mapa.Em(casa);

            // O vazio não recebe NADA — nem laje. É buraco, e é o recorte dele
            // que faz a sala ler como plataforma sobre o escuro em vez de caixa.
            if (tipo == TipoDeCasa.Vazio) return;

            switch (tipo)
            {
                case TipoDeCasa.ObstaculoAlto: Alto(mapa, casa, cubo); return;
                case TipoDeCasa.ObstaculoBaixo: Baixo(mapa, casa, cubo); return;
                case TipoDeCasa.ChaoDecorado: Decorado(casa, cubo); return;
                default: Chao(casa, cubo, false); return;
            }
        }

        // --------------------------------------------------------------- OBSTÁCULO ALTO

        void Alto(Mapa mapa, Vector2Int casa, Mesh cubo)
        {
            var vizinhos = Vizinhanca(mapa, casa);
            string nome;
            var peca = EscolherParede(vizinhos, casa, Borda(mapa, casa), out nome);

            if (peca == null)
            {
                // Cubo da rodada 1: preenche a casa e um fio a mais, para a
                // parede ler como maciço só em vez de fileira de blocos soltos.
                Cubo(cubo, GrupoDeCenario.Alto, casa,
                     new Vector3(Palco.LadoAlto, Palco.AlturaAlto, Palco.LadoAlto),
                     Palco.AlturaAlto * 0.5f);
                Anotar(casa, "cubo", 0, GrupoDeCenario.Alto, Palco.AlturaAlto, Palco.LadoAlto, Tema.Alto, true);
                return;
            }

            float escala = EscalaDe(nome);
            int quartos = GiroDaParede(peca, escala, vizinhos, casa);

            // A lajota de fundação vai ANTES da peça: a peça de parede é fina
            // (um quarto de casa), e sem a lajota o vão dela mostraria o escuro
            // de fora — um rasgo preto dentro da sala, no meio do tabuleiro.
            Lajota("floor_a", GrupoDeCenario.Fundacao, casa, 0);

            Assentar(peca, GrupoDeCenario.Alto, casa, escala, quartos, 0f);

            // Fim de corrida ganha POSTE. A meia-parede corre do centro da casa
            // até o vizinho e deixa a outra metade nua; sem o poste, a ponta da
            // parede fica cortada no ar como se a malha tivesse faltado.
            if (nome == "wall_half")
            {
                var poste = _fonte.Peca("pillar");
                if (poste != null)
                    Assentar(poste, GrupoDeCenario.Alto, casa,
                             _escalaParede * PosteSobreParede, 0, 0f);
            }

            float topo = peca.Caixa.max.y * escala;
            Anotar(casa, nome, quartos, GrupoDeCenario.Alto, topo,
                   Mathf.Max(peca.Caixa.size.x, peca.Caixa.size.z) * escala, Tema.Alto, false);

            Tocha(mapa, casa);
        }

        /// <summary>
        /// Qual peça de parede a vizinhança pede. É o <c>M.buildWall</c> do JS:
        /// quatro vizinhos = cruz, três = T, dois opostos = reta (com as
        /// variantes que dão ritmo), dois adjacentes = quina, um = meia-parede,
        /// nenhum = coluna solta.
        /// </summary>
        PecaDeCenario EscolherParede(Lados vizinhos, Vector2Int casa, bool borda, out string nome)
        {
            int quantos = AutoParede.Conta(vizinhos);
            if (quantos == 4) nome = "wall_cross";
            else if (quantos == 3) nome = "wall_tsplit";
            else if (quantos == 2 && AutoParede.Reta(vizinhos)) nome = VarianteReta(casa, borda);
            else if (quantos == 2) nome = "wall_corner";
            else if (quantos == 1) nome = "wall_half";
            else nome = Fracao(casa, 9) < 0.34f ? "pillar_deco" : "pillar";

            var peca = _fonte.Peca(nome);
            // Variante ausente cai na reta comum antes de cair no cubo: perder o
            // ritmo é bem menos grave que abrir um buraco na parede.
            if (peca == null && nome != "wall_str" && quantos == 2 && AutoParede.Reta(vizinhos))
            {
                nome = "wall_str";
                peca = _fonte.Peca(nome);
            }
            return peca;
        }

        /// <summary>As variantes de parede reta, com as mesmas faixas do JS. Elas
        /// existem para uma parede longa não virar o mesmo tijolo repetido vinte
        /// vezes, que é o que denuncia cenário montado por máquina.</summary>
        string VarianteReta(Vector2Int casa, bool borda)
        {
            float r = Fracao(casa, 1);
            if (r < 0.16f) return "wall_pil";
            if (r < 0.30f) return "wall_str2";
            if (r < 0.38f) return "wall_str3";
            // Janela só na borda e fora da Estufa, como no JS: janela no meio da
            // sala mostraria o escuro de fora onde há sala dos dois lados.
            if (borda && Tema.Nome != "garden" && r < 0.50f) return "wall_win";
            return "wall_str";
        }

        /// <summary>
        /// O quarto de volta que encaixa a peça na vizinhança, MEDINDO os braços
        /// dela — ver <see cref="AutoParede"/>. Peça sem braço nenhum (a coluna)
        /// gira por sorteio: ela é simétrica e travá-la em zero deixaria todas as
        /// colunas da sala olhando para o mesmo lado.
        /// </summary>
        int GiroDaParede(PecaDeCenario peca, float escala, Lados vizinhos, Vector2Int casa)
        {
            // Parede sem vizinho nenhum é coluna solta, e coluna não tem lado
            // certo: travá-la em zero deixaria todas as colunas da sala olhando
            // para a mesma direção, que é o jeito mais rápido de um cenário
            // parecer carimbado.
            if (vizinhos == Lados.Nenhum) return Mathf.FloorToInt(Fracao(casa, 3) * 4f) & 3;

            var bracos = AutoParede.BracosDe(EmCasas(peca.Caixa, escala));
            int quartos = AutoParede.QuartosPara(bracos, vizinhos);
            return quartos < 0 ? 0 : quartos;
        }

        void Tocha(Mapa mapa, Vector2Int casa)
        {
            var peca = _fonte.Peca("torch_wall");
            if (peca == null) return;
            if (Fracao(casa, 5) >= DensidadeDeTocha) return;

            // Só em face que dá para chão andável: tocha virada para dentro de
            // outra parede fica enterrada, e virada para o vazio ilumina o nada.
            var lado = PrimeiraFaceLivre(mapa, casa);
            if (lado == Lados.Nenhum) return;

            float escala = _escalaParede * TochaSobreParede;
            // Para que lado a peça sai, MEDE-SE. A ponte glTF→Blender→FBX→Unity
            // espelha o eixo X — foi medido, não suposto (ver MedidaDoKit) —, e
            // com a direção escrita à mão a tocha entraria dentro da parede.
            int quartos = AutoParede.QuartosPara(AutoParede.Saliencia(peca.Caixa), lado);
            if (quartos < 0) quartos = 0;

            var passo = Passos(lado);
            Assentar(peca, GrupoDeCenario.Tocha, casa, escala, quartos, TochaAltura,
                     new Vector3(passo.x * TochaSaliencia, 0f, passo.y * TochaSaliencia), false);
        }

        Lados PrimeiraFaceLivre(Mapa mapa, Vector2Int casa)
        {
            for (int b = 1; b <= 8; b <<= 1)
            {
                var lado = (Lados)b;
                var vizinho = casa + Passos(lado);
                if (mapa.Dentro(vizinho) && mapa.Andavel(vizinho)) return lado;
            }
            return Lados.Nenhum;
        }

        // --------------------------------------------------------------- OBSTÁCULO BAIXO

        void Baixo(Mapa mapa, Vector2Int casa, Mesh cubo)
        {
            // Chão primeiro, e o traste EM CIMA dele: é a moldura de piso em
            // volta que diz "isto está sobre o chão, dá para ver por cima".
            Chao(casa, cubo, true);

            var nomes = Tema.PecasBaixas;
            string nome = nomes[Mathf.Abs((int)(Fracao(casa, 2) * nomes.Length)) % nomes.Length];
            var peca = _fonte.Peca(nome);

            if (peca == null)
            {
                Cubo(cubo, GrupoDeCenario.Baixo, casa,
                     new Vector3(Palco.LadoBaixo, Palco.AlturaBaixo, Palco.LadoBaixo), Palco.AlturaBaixo * 0.5f);
                Anotar(casa, "cubo", 0, GrupoDeCenario.Baixo, Palco.AlturaBaixo, Palco.LadoBaixo, Tema.Baixo, true);
                Tampa(cubo, casa, Palco.LadoBaixo);
                return;
            }

            // NORMALIZA a altura, sempre: o kit vem em escalas variadas e um
            // engradado cru tem 2,14 de altura contra 1,02 de um barril. Sem
            // isto, a mesma cobertura leria ora como cobertura ora como parede,
            // dependendo do sorteio.
            var caixa = peca.Caixa;
            float ey = caixa.size.y > 1e-4f ? Palco.AlturaBaixo / caixa.size.y : _escalaParede;
            float maiorLado = Mathf.Max(caixa.size.x, caixa.size.z);
            // A pegada é travada abaixo da casa para SEMPRE sobrar anel de piso.
            // A mesa da Cisterna, normalizada só pela altura, cobria a casa
            // inteira e virava uma laje — indistinguível de chão.
            float exz = maiorLado > 1e-4f ? Mathf.Min(ey, Palco.LadoBaixo * Passo / maiorLado) : ey;

            int quartos = Mathf.FloorToInt(Fracao(casa, 4) * 4f) & 3;
            // CENTRA no meio da casa. O escombro da Mina tem a origem numa quina
            // (caixa x de −4 a 0), e sem esta correção ele nasceria meia casa
            // fora do lugar — em cima da casa vizinha, que pode ser chão livre.
            Assentar(peca, GrupoDeCenario.Baixo, casa, new Vector3(exz, ey, exz), quartos,
                     -caixa.min.y * ey, Centragem(caixa, exz, quartos), false);

            Anotar(casa, nome, quartos, GrupoDeCenario.Baixo, Palco.AlturaBaixo,
                   maiorLado * exz, Tema.Baixo, false);
            Tampa(cubo, casa, maiorLado * exz);
        }

        /// <summary>
        /// A tampa translúcida no topo da cobertura — o mesmo <c>capMat</c> do
        /// renderer3d_v2.js. É o sinal que sobrevive quando o traste está atrás
        /// de uma unidade: o topo continua marcado, e continua se lendo "daqui eu
        /// vejo por cima".
        /// </summary>
        void Tampa(Mesh cubo, Vector2Int casa, float pegada)
        {
            if (cubo == null) return;
            // COLADA no topo do traste e do tamanho DELE, não da casa.
            //
            // Na primeira foto ela tinha o lado da CASA e boiava seis centímetros
            // acima. Numa vista a 3/4, seis centímetros de altura deslocam a placa
            // meia casa na tela: ela aparecia AO LADO do barril em vez de em cima
            // dele, e maior que ele — lia como terreno especial, não como "daqui
            // eu vejo por cima". Colada e do tamanho do traste, ela vira o que
            // devia ser: a tampa dele.
            float lado = Mathf.Clamp(pegada, 0.35f, Palco.LadoBaixo);
            Cubo(cubo, GrupoDeCenario.Tampa, casa,
                 new Vector3(lado, 0.02f, lado), Palco.AlturaBaixo + 0.02f);
        }

        // ------------------------------------------------------------------- CHÃO

        void Chao(Vector2Int casa, Mesh cubo, bool soLaje)
        {
            bool par = ((casa.x + casa.y) % 2) == 0;
            var grupo = par ? GrupoDeCenario.Chao1 : GrupoDeCenario.Chao2;
            var cor = par ? Tema.Chao1 : Tema.Chao2;

            // Xadrez, como o jogo em JS: sem ele o chão vira uma mancha só e a
            // grade — a unidade de medida do jogo inteiro — some da imagem.
            float r = Fracao(casa, 0);
            string nome = r < 0.125f ? "floor_b" : r < 0.25f ? "floor_c" : "floor_a";

            if (!Lajota(nome, grupo, casa, Mathf.FloorToInt(Fracao(casa, 6) * 4f) & 3))
            {
                // A laje-cubo da rodada 1: 0,96 de lado, para a junta escura
                // entre lajes desenhar a grade.
                Cubo(cubo, grupo, casa, new Vector3(Palco.LadoChao, Palco.EspessuraChao, Palco.LadoChao),
                     -Palco.EspessuraChao * 0.5f);
                if (!soLaje) Anotar(casa, "cubo", 0, grupo, 0f, Palco.LadoChao, cor, true);
                return;
            }
            if (!soLaje) Anotar(casa, nome, 0, grupo, 0f, Passo, cor, false);
        }

        void Decorado(Vector2Int casa, Mesh cubo)
        {
            if (!Lajota(Tema.PecaDecorada, GrupoDeCenario.Decorado, casa, 0))
            {
                Cubo(cubo, GrupoDeCenario.Decorado, casa, new Vector3(Palco.LadoChao, Palco.EspessuraChao, Palco.LadoChao),
                     -Palco.EspessuraChao * 0.5f);
                Anotar(casa, "cubo", 0, GrupoDeCenario.Decorado, 0f, Palco.LadoChao, Tema.ChaoDecorado, true);
                return;
            }
            Anotar(casa, Tema.PecaDecorada, 0, GrupoDeCenario.Decorado, 0f, Passo,
                   Tema.ChaoDecorado, false);
        }

        /// <summary>
        /// Assenta uma lajota com o TOPO exatamente em y = 0, e esticada para
        /// cobrir a casa nos dois eixos. Esticar por eixo, e não uniforme, existe
        /// por causa da grelha da Forja: ela é uma peça 4×2 do kit, e uniforme
        /// ela cobriria duas casas em X e deixaria meia casa a descoberto em Z.
        /// </summary>
        bool Lajota(string nome, GrupoDeCenario grupo, Vector2Int casa, int quartos)
        {
            var peca = _fonte.Peca(nome);
            if (peca == null) return false;

            var caixa = peca.Caixa;
            // O giro é aplicado ANTES da medida na hora de escolher os fatores:
            // com um quarto de volta, o que cobre X passa a cobrir Z.
            bool deitada = (quartos & 1) == 1;
            float ladoX = deitada ? caixa.size.z : caixa.size.x;
            float ladoZ = deitada ? caixa.size.x : caixa.size.z;
            float ex = ladoX > 1e-4f ? Passo / ladoX : 0.5f;
            float ez = ladoZ > 1e-4f ? Passo / ladoZ : 0.5f;
            float ey = Mathf.Min(ex, ez);

            var escala = deitada ? new Vector3(ez, ey, ex) : new Vector3(ex, ey, ez);
            Assentar(peca, grupo, casa, escala, quartos, -caixa.max.y * ey,
                     Centragem(caixa, escala.x, quartos), false);
            return true;
        }

        // ============================================================== COSTURA

        void Assentar(PecaDeCenario peca, GrupoDeCenario grupo, Vector2Int casa,
                      float escala, int quartos, float alturaExtra)
        {
            Assentar(peca, grupo, casa, new Vector3(escala, escala, escala), quartos,
                     alturaExtra, Vector3.zero, true);
        }

        void Assentar(PecaDeCenario peca, GrupoDeCenario grupo, Vector2Int casa,
                      float escala, int quartos, float alturaExtra, Vector3 desvio, bool aoChao)
        {
            Assentar(peca, grupo, casa, new Vector3(escala, escala, escala), quartos,
                     alturaExtra, desvio, aoChao);
        }

        void Assentar(PecaDeCenario peca, GrupoDeCenario grupo, Vector2Int casa,
                      Vector3 escala, int quartos, float alturaExtra, Vector3 desvio, bool aoChao)
        {
            // `aoChao` desce a peça até o pé dela encostar no piso. As peças de
            // parede do kit já nascem com o pé em y = 0, mas nem todas — e uma
            // peça flutuando dois centímetros lança sombra solta, que é o defeito
            // mais difícil de achar olhando a foto.
            float baseY = aoChao ? -peca.Caixa.min.y * escala.y : 0f;
            var pos = Local(casa) + new Vector3(desvio.x, baseY + alturaExtra, desvio.z);
            var matriz = Matrix4x4.TRS(pos, Quaternion.Euler(0f, 90f * quartos, 0f), escala);

            var lote = Lote(grupo);
            for (int i = 0; i < peca.Malhas.Count; i++)
            {
                var malha = peca.Malhas[i];
                // Uma entrada por SUBMALHA, e não uma por malha: submalha que
                // fica de fora some da tela sem erro nenhum. As 49 peças do kit
                // têm uma só hoje, e é justamente por isso que o dia em que
                // aparecer a segunda ninguém desconfiaria.
                for (int s = 0; s < malha.subMeshCount; s++)
                    lote.Add(new CombineInstance
                    {
                        mesh = malha,
                        transform = matriz * peca.Poses[i],
                        subMeshIndex = s
                    });
            }

            AlturaMaxima = Mathf.Max(AlturaMaxima, alturaExtra + peca.Caixa.max.y * escala.y +
                                                   (aoChao ? -peca.Caixa.min.y * escala.y : 0f));
        }

        void Cubo(Mesh cubo, GrupoDeCenario grupo, Vector2Int casa, Vector3 escala, float altura)
        {
            if (cubo == null) return;
            Lote(grupo).Add(new CombineInstance
            {
                mesh = cubo,
                transform = Matrix4x4.TRS(Local(casa) + Vector3.up * altura, Quaternion.identity, escala),
                subMeshIndex = 0
            });
            AlturaMaxima = Mathf.Max(AlturaMaxima, altura + escala.y * 0.5f);
        }

        List<CombineInstance> Lote(GrupoDeCenario grupo)
        {
            List<CombineInstance> lote;
            if (!_lotes.TryGetValue(grupo, out lote))
            {
                lote = new List<CombineInstance>();
                _lotes[grupo] = lote;
            }
            return lote;
        }

        /// <summary>
        /// Costura cada família numa malha só e pendura uma delas por objeto. É
        /// aqui que 357 casas viram meia dúzia de desenhos na tela.
        /// </summary>
        void Costurar(Transform pai, Material fosco, Material marcador)
        {
            var kit = MaterialDoKit(fosco);

            foreach (var par in _lotes)
            {
                if (par.Value.Count == 0) continue;

                var malha = new Mesh();
                malha.name = "SOTERRA/Cenario/" + par.Key;
                // UInt32 antes de costurar: com 16 bits o índice estoura em 65.535
                // vértices, e o chão de uma sala grande passa disso sozinho — a
                // Unity trunca a malha e some com metade do tabuleiro, calada.
                malha.indexFormat = IndexFormat.UInt32;
                malha.CombineMeshes(par.Value.ToArray(), true, true);
                malha.hideFlags = HideFlags.DontSave;
                _costuradas.Add(malha);

                bool tampa = par.Key == GrupoDeCenario.Tampa;
                var go = new GameObject(par.Key.ToString());
                go.transform.SetParent(pai, false);
                go.AddComponent<MeshFilter>().sharedMesh = malha;
                var r = go.AddComponent<MeshRenderer>();
                r.sharedMaterial = tampa ? marcador : kit;
                // Chão e tampa não lançam sombra: rasos como são, a única sombra
                // que produziriam seria em cima de si mesmos — acne de sombra de
                // graça. A parede e a cobertura lançam, e é a sombra delas o
                // quarto sinal que separa alto de baixo.
                r.shadowCastingMode = Sombreia(par.Key) ? ShadowCastingMode.On : ShadowCastingMode.Off;
                r.receiveShadows = !tampa;
                Palco.Pintar(r, TintaDe(par.Key));
                _grupos.Add(go);
            }
        }

        static bool Sombreia(GrupoDeCenario grupo)
        {
            return grupo == GrupoDeCenario.Alto || grupo == GrupoDeCenario.Baixo ||
                   grupo == GrupoDeCenario.Tocha;
        }

        Color TintaDe(GrupoDeCenario grupo)
        {
            switch (grupo)
            {
                case GrupoDeCenario.Chao1: return Tema.Chao1;
                case GrupoDeCenario.Chao2: return Tema.Chao2;
                case GrupoDeCenario.Decorado: return Tema.ChaoDecorado;
                case GrupoDeCenario.Fundacao: return Tema.Fundacao;
                case GrupoDeCenario.Alto: return Tema.Alto;
                case GrupoDeCenario.Baixo: return Tema.Baixo;
                case GrupoDeCenario.Tocha: return Tema.Tocha;
                // A tampa é informação, não objeto: fica translúcida para a
                // cobertura continuar aparecendo debaixo dela.
                default: return new Color(Tema.Tampa.r, Tema.Tampa.g, Tema.Tampa.b, 0.22f);
            }
        }

        /// <summary>
        /// UM material para as 49 peças, com o atlas do kit. Um por peça faria o
        /// SRP Batcher desenhar tudo com a cor do primeiro (§3 do contrato) — e
        /// aqui seria pior ainda, porque a cor de cada família é justamente o que
        /// separa parede de cobertura.
        /// </summary>
        Material MaterialDoKit(Material fosco)
        {
            var atlas = _fonte.Atlas;
            ComKit = atlas != null;
            if (atlas == null) return fosco;      // sem kit, tudo cai no cubo fosco
            if (_kit != null) return _kit;

            _kit = new Material(Shader.Find("Universal Render Pipeline/Lit") ??
                                Shader.Find("Standard"));
            _kit.name = "SOTERRA/Cenario/Kit";
            _kit.SetTexture("_BaseMap", atlas);
            _kit.SetTexture("_MainTex", atlas);   // o nome antigo, se o URP não estiver lá
            _kit.SetFloat("_Metallic", 0f);
            _kit.SetFloat("_Smoothness", 0f);
            _kit.SetFloat("_SpecularHighlights", 0f);
            _kit.SetFloat("_EnvironmentReflections", 0f);
            _kit.EnableKeyword("_SPECULARHIGHLIGHTS_OFF");
            _kit.EnableKeyword("_ENVIRONMENTREFLECTIONS_OFF");
            _kit.hideFlags = HideFlags.DontSave;
            return _kit;
        }

        // ================================================================= APOIO

        void MedirRegua()
        {
            var regua = _fonte.Peca(PecaRegua);
            if (regua == null || regua.Caixa.size.x < 1e-4f) return;
            _escalaParede = Passo / regua.Caixa.size.x;
        }

        float EscalaDe(string nome)
        {
            if (nome == "pillar" || nome == "pillar_deco") return _escalaParede * ColunaSobreParede;
            if (nome == "column") return _escalaParede * PosteSobreParede;
            return _escalaParede;
        }

        /// <summary>
        /// Quanto deslocar a peça para o centro da caixa dela cair no centro da
        /// casa. Vale para chão e traste, e NÃO para parede: a meia-parede é
        /// descentrada de propósito — ela corre do meio da casa até o vizinho.
        /// </summary>
        static Vector3 Centragem(Bounds caixa, float escala, int quartos)
        {
            var d = new Vector2(-caixa.center.x * escala, -caixa.center.z * escala);
            // O deslocamento é medido ANTES do giro e aplicado DEPOIS: sem girá-lo
            // junto, a peça de quarto de volta sairia corrigida para o eixo errado.
            for (int i = 0; i < (((quartos % 4) + 4) % 4); i++) d = new Vector2(d.y, -d.x);
            return new Vector3(d.x, 0f, d.y);
        }

        static Bounds EmCasas(Bounds caixa, float escala)
        {
            return new Bounds(caixa.center * escala, caixa.size * escala);
        }

        /// <summary>Deslocamento de uma casa na direção do lado. Norte é y−1
        /// porque a linha 0 do desenho é a de cima.</summary>
        public static Vector2Int Passos(Lados lado)
        {
            switch (lado)
            {
                case Lados.Norte: return new Vector2Int(0, -1);
                case Lados.Leste: return new Vector2Int(1, 0);
                case Lados.Sul: return new Vector2Int(0, 1);
                case Lados.Oeste: return new Vector2Int(-1, 0);
                default: return Vector2Int.zero;
            }
        }

        /// <summary>
        /// Que lados desta casa também são obstáculo alto. Fora do mapa NÃO conta
        /// como parede — é o mesmo `isWall` do JS. Contasse, cada parede de borda
        /// acharia que tem vizinho do lado de fora e a sala inteira fecharia com
        /// a peça errada.
        /// </summary>
        public static Lados Vizinhanca(Mapa mapa, Vector2Int casa)
        {
            var lados = Lados.Nenhum;
            for (int b = 1; b <= 8; b <<= 1)
            {
                var lado = (Lados)b;
                var vizinho = casa + Passos(lado);
                if (mapa.Dentro(vizinho) && mapa.Em(vizinho) == TipoDeCasa.ObstaculoAlto)
                    lados |= lado;
            }
            return lados;
        }

        static bool Borda(Mapa mapa, Vector2Int casa)
        {
            return casa.x == 0 || casa.y == 0 ||
                   casa.x == mapa.Largura - 1 || casa.y == mapa.Altura - 1;
        }

        Vector3 Local(Vector2Int casa)
        {
            return _onde != null
                ? _onde(casa)
                : new Vector3(casa.x * Passo, 0f, casa.y * Passo);
        }

        void Anotar(Vector2Int casa, string peca, int quartos, GrupoDeCenario grupo,
                    float topo, float pegada, Color tinta, bool cubo)
        {
            _desenhos[casa] = new DesenhoDaCasa
            {
                Peca = peca, Quartos = quartos, Grupo = grupo,
                Topo = topo, Pegada = pegada, Tinta = tinta, Cubo = cubo
            };
        }

        // Ruído determinístico: a MESMA sala tem de sair igual toda vez que for
        // montada, ou o teste mede uma coisa e a foto mostra outra. As constantes
        // são as de `hashXY` em renderer3d_v2.js.
        static uint Semente(int x, int y)
        {
            unchecked { return (uint)((x * 73856093) ^ (y * 19349663)); }
        }

        static float Fracao(Vector2Int casa, int sal)
        {
            return Fracao((int)Semente(casa.x, casa.y), sal);
        }

        static float Fracao(int semente, int sal)
        {
            unchecked
            {
                uint s = (uint)semente ^ (uint)(sal * 2654435761u);
                s ^= s >> 13; s *= 2246822519u; s ^= s >> 16;
                return (s & 0xFFFFFF) / (float)0x1000000;
            }
        }

        // ================================================================ FAXINA

        /// <summary>Apaga a sala. As malhas costuradas são criadas por código e
        /// não são asset: sem destruí-las, cada remontagem deixaria uma malha do
        /// tamanho do tabuleiro na memória.</summary>
        public void Limpar()
        {
            for (int i = 0; i < _grupos.Count; i++) Descartar(_grupos[i]);
            for (int i = 0; i < _costuradas.Count; i++) Descartar(_costuradas[i]);
            _grupos.Clear();
            _costuradas.Clear();
            _lotes.Clear();
            _desenhos.Clear();
            AlturaMaxima = 0f;
        }

        /// <summary>Solta também o material. Chamado pelo <see cref="Palco"/> ao
        /// morrer.</summary>
        public void Soltar()
        {
            Limpar();
            Descartar(_kit);
            _kit = null;
        }

        static void Descartar(Object alvo)
        {
            if (alvo == null) return;
            if (Application.isPlaying) Object.Destroy(alvo);
            else Object.DestroyImmediate(alvo);
        }
    }
}
