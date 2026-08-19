using UnityEngine;
using Soterra.Dados;

namespace Soterra.Cena
{
    /// <summary>
    /// O visual de UM calabouço: quais peças do env-kit a sala usa e com que
    /// tinta cada família é pintada.
    ///
    /// Existe porque a paleta estava CRAVADA no <see cref="Palco"/> — a do tema
    /// <c>garden</c>, marcada como provisória desde a rodada 1 —, e com ela a
    /// Cisterna e a Forja saíam com o verde da Estufa. As cores agora vêm de
    /// <c>dungeons.json</c> (<c>palette</c>) e a escolha de peça vem do tema
    /// (<c>theme</c>), que é o mesmo campo que indexa <c>scenery.json</c>.
    ///
    /// As tintas MULTIPLICAM o atlas do kit — é assim que uma textura só serve
    /// seis calabouços. Por isso elas não são a cor final na tela: a cor final é
    /// tinta × textura × luz. O que a classe garante é a ORDEM de valor, que é o
    /// que se lê de relance:
    ///
    ///     obstáculo alto  &lt;  chão  &lt;  obstáculo baixo
    ///
    /// A parede é a coisa mais pesada da sala, a cobertura é a mais clara. Trocar
    /// essa ordem não quebra teste de regra nenhum e destrói o tabuleiro.
    /// </summary>
    public sealed class TemaDoCenario
    {
        // ============================================================== IDENTIDADE

        /// <summary>Nome do tema já normalizado: garden, cistern, forge,
        /// scaffold, mine, heart.</summary>
        public string Nome { get; private set; }

        // ================================================================= TINTAS

        public Color Chao1 { get; private set; }
        public Color Chao2 { get; private set; }
        public Color ChaoDecorado { get; private set; }

        /// <summary>Obstáculo ALTO (<c>#</c>) — o mais escuro dos três.</summary>
        public Color Alto { get; private set; }

        /// <summary>A lajota escura sob a parede. Sem ela a parede, que é fina,
        /// deixaria um rasgo de fundo aparecendo na casa dela.</summary>
        public Color Fundacao { get; private set; }

        /// <summary>Obstáculo BAIXO (<c>=</c>) — o mais claro dos três.</summary>
        public Color Baixo { get; private set; }

        /// <summary>Cor da tampa translúcida no topo da cobertura. É o quarto
        /// sinal de "dá para ver por cima daqui", e o jogo em JS já o desenha
        /// (<c>capMat</c> em renderer3d_v2.js).</summary>
        public Color Tampa { get; private set; }

        /// <summary>O escuro em volta do tabuleiro, onde está o <c>~</c>.</summary>
        public Color Vazio { get; private set; }

        /// <summary>Tocha de parede: quente e clara em qualquer tema, porque
        /// fogo não muda de cor com o calabouço.</summary>
        public Color Tocha { get; private set; }

        // ================================================================== PEÇAS

        /// <summary>Peça de chão decorado (<c>,</c>).</summary>
        public string PecaDecorada { get; private set; }

        /// <summary>O que fica em cima da casa de obstáculo baixo. Vem de
        /// <c>LOW_PROPS</c> em renderer3d_v2.js.</summary>
        public string[] PecasBaixas { get; private set; }

        // =============================================================== CONSTRUIR

        /// <summary>
        /// Monta o tema a partir do nome e da paleta do calabouço. A paleta pode
        /// vir nula — calabouço sem paleta no dado existe — e aí valem as cores
        /// da Estufa, que é onde o jogo começa.
        /// </summary>
        public static TemaDoCenario De(string tema, PaletaDeCalabouco paleta)
        {
            var t = new TemaDoCenario();
            t.Nome = Normalizar(tema);

            Color chao1 = Ler(paleta == null ? null : paleta.Chao1, PadraoChao1);
            Color chao2 = Ler(paleta == null ? null : paleta.Chao2, PadraoChao2);
            Color parede = Ler(paleta == null ? null : paleta.Parede, PadraoParede);
            Color baixa = Ler(paleta == null ? null : paleta.ParedeBaixa, PadraoParedeBaixa);
            Color destaque = Ler(paleta == null ? null : paleta.Destaque, PadraoDestaque);
            Color vazio = Ler(paleta == null ? null : paleta.Vazio, PadraoVazio);

            // A MATIZ é do calabouço; o VALOR é do jogo.
            //
            // A primeira tentativa multiplicava a paleta por um fator fixo, como
            // faz `buildTile` em models3d.js (`shade(pal.floor1, 1.8)`). Funciona
            // na Estufa e falha na Forja, e a foto mostrou por quê: `wall` da
            // Estufa é #57452f e o da Forja é #241512, quase preto. Multiplicado,
            // o preto continua preto — a Forja saiu com parede, chão e fundo na
            // mesma escuridão, e a sala inteira virou um borrão marrom.
            //
            // Então o alvo aqui é LUMINÂNCIA, não fator: cada família é levada ao
            // seu degrau, e o que sobrevive da paleta é a cor. É o que garante,
            // nos seis calabouços e não só onde deu certo, o degrau que carrega a
            // regra do jogo:
            //
            //     alto 0,30  &lt;  chão 0,46 / 0,52  &lt;  cobertura 0,74
            t.Chao1 = ComLuz(chao1, 0.46f);
            t.Chao2 = ComLuz(chao2, 0.52f);
            t.ChaoDecorado = ComLuz(Color.Lerp(chao2, destaque, 0.22f), 0.58f);

            t.Alto = ComLuz(parede, 0.30f);
            // A fundação some quase toda na sombra da parede, e é isso que se
            // quer: ela existe para tapar o rasgo sob a peça, não para ser vista.
            t.Fundacao = ComLuz(parede, 0.12f);
            t.Baixo = ComLuz(baixa, 0.74f);

            t.Tampa = destaque;
            t.Vazio = vazio;
            t.Tocha = new Color(1f, 0.86f, 0.58f);

            t.PecaDecorada = DecoradaDe(t.Nome);
            t.PecasBaixas = BaixasDe(t.Nome);
            return t;
        }

        /// <summary>Tema de um calabouço lido do dado.</summary>
        public static TemaDoCenario De(Calabouco calabouco)
        {
            if (calabouco == null) return Padrao;
            return De(calabouco.Tema ?? calabouco.Id, calabouco.Paleta);
        }

        /// <summary>
        /// A Estufa, que é onde o jogo começa e a única sala que este projeto
        /// fotografa sem pedir dado. As cores repetem <c>greenhouse.palette</c>
        /// de <c>dungeons.json</c> — quando o banco está carregado, prefira
        /// <see cref="De(Calabouco)"/>, que lê o dado de verdade.
        /// </summary>
        public static TemaDoCenario Padrao { get { return De("garden", null); } }

        // ================================================================= PALETA

        // Copiadas de Resources/dados/dungeons.json, entrada `greenhouse`.
        static readonly string PadraoChao1 = "#35513a";
        static readonly string PadraoChao2 = "#3d5c41";
        static readonly string PadraoParede = "#57452f";
        static readonly string PadraoParedeBaixa = "#6b5334";
        static readonly string PadraoDestaque = "#ffd76b";
        static readonly string PadraoVazio = "#1b2a1e";

        /// <summary>
        /// O <c>normTheme</c> de models3d.js, mais os três calabouços que o JS
        /// nunca precisou normalizar. Aceita id de calabouço e nome de tema
        /// porque as duas coisas circulam com o mesmo nome no jogo.
        /// </summary>
        public static string Normalizar(string tema)
        {
            switch (tema)
            {
                case "greenhouse": return "garden";
                case "emberlock": return "forge";
                case "windscaffold": return "scaffold";
                case "quakemine": return "mine";
                case "brokenheart": return "heart";
                case null:
                case "": return "garden";
                default: return tema;
            }
        }

        static string DecoradaDe(string tema)
        {
            switch (tema)
            {
                case "garden": return "floor_weeds";
                case "forge": return "floor_grate";   // com brasa embaixo, no JS
                case "mine": return "floor_dirt";
                // O JS manda todo tema que não é garden nem cistern para a grelha
                // da Forja (`buildTile`, ramo `else`). Sob o Andaime e o Coração
                // isso desenharia brasa de fundição onde não há fundição
                // nenhuma — é lacuna do JS, não regra, e aqui vira o ladrilho
                // decorado neutro.
                default: return "floor_deco";
            }
        }

        static string[] BaixasDe(string tema)
        {
            // LOW_PROPS de renderer3d_v2.js, literal.
            switch (tema)
            {
                case "cistern": return new[] { "chest", "table", "coins" };
                case "forge": return new[] { "keg", "box_big", "crates" };
                case "mine": return new[] { "crates", "barrel", "rubble" };
                case "heart": return new[] { "chest", "crates", "barrel" };
                default: return new[] { "crates", "barrel", "chest" };
            }
        }

        // ==================================================================== COR

        /// <summary>O <c>shade</c> de models3d.js: multiplica cada canal e trava
        /// em 1. Multiplicar, e não interpolar para o branco, é o que preserva a
        /// matiz — interpolar lavaria o verde da Estufa até o cinza.</summary>
        public static Color Aclarar(Color c, float k)
        {
            return new Color(Mathf.Min(1f, c.r * k), Mathf.Min(1f, c.g * k),
                             Mathf.Min(1f, c.b * k), c.a);
        }

        /// <summary>Hex de <c>dungeons.json</c> vira Color. Aceita com e sem
        /// <c>#</c>; hex torto cai no padrão em vez de virar magenta calado.</summary>
        public static Color Hex(string hex, Color padrao)
        {
            if (string.IsNullOrEmpty(hex)) return padrao;
            var limpo = hex[0] == '#' ? hex.Substring(1) : hex;
            if (limpo.Length != 6) return padrao;
            int valor;
            if (!int.TryParse(limpo, System.Globalization.NumberStyles.HexNumber,
                              System.Globalization.CultureInfo.InvariantCulture, out valor))
                return padrao;
            return new Color(((valor >> 16) & 0xFF) / 255f,
                             ((valor >> 8) & 0xFF) / 255f,
                             (valor & 0xFF) / 255f);
        }

        static Color Ler(string hex, string padrao)
        {
            return Hex(hex, Hex(padrao, Color.magenta));
        }

        /// <summary>
        /// A mesma cor, levada à luminância pedida. Multiplica enquanto dá — é o
        /// que preserva a matiz — e só recorre ao branco quando algum canal já
        /// saturou e a luz ainda falta.
        ///
        /// Cor sem luz nenhuma não tem matiz a preservar e viraria divisão por
        /// zero: nesse caso vale o cinza, que ao menos deixa a peça visível em
        /// vez de a fazer sumir calada.
        /// </summary>
        public static Color ComLuz(Color cor, float alvo)
        {
            if (Luz(cor) < 0.01f) cor = new Color(0.5f, 0.5f, 0.5f, cor.a);

            var clara = Aclarar(cor, Mathf.Clamp(alvo / Luz(cor), 0f, 12f));
            float luz = Luz(clara);
            if (luz >= alvo - 1e-4f) return clara;

            return Color.Lerp(clara, Color.white,
                              Mathf.Clamp01((alvo - luz) / Mathf.Max(1e-4f, 1f - luz)));
        }

        /// <summary>Luminância percebida. Fica aqui, e não só no teste, porque é
        /// a régua da ordem de valor que esta classe promete.</summary>
        public static float Luz(Color c)
        {
            return 0.2126f * c.r + 0.7152f * c.g + 0.0722f * c.b;
        }
    }
}
