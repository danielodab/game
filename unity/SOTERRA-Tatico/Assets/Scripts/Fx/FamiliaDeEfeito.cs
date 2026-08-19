using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Soterra.Fx
{
    /// <summary>
    /// As 21 famílias de desenho, e a regra que diz a que família um
    /// <c>fxKey</c> pertence (SISTEMAS §4).
    ///
    /// O ACERVO tem 187 chaves distintas — <c>lesserMeteor</c>, <c>ashCone</c>,
    /// <c>emberRain</c>… Escrever 187 efeitos à mão é o que ninguém vai fazer;
    /// o despacho antigo da linha JS conhecia nove nomes genéricos, NENHUM
    /// deles batia, e todo feitiço caía no mesmo <c>else</c> e virava a mesma
    /// bolinha. Era a queixa "entre todos os que testei o efeito foi o mesmo":
    /// o meteoro não caía do céu, o cone não abria, a armadilha não plantava
    /// nada.
    ///
    /// A saída é o NOME decidir a família. Feitiço novo entra sozinho na
    /// família certa, e quem não encaixa em nenhuma cai na <see cref="Bola"/> —
    /// que volta a ser o último recurso em vez do único.
    ///
    /// Porte literal de <c>familiaDe</c> em <c>js/render3d/fx3d_v2.js</c>. As
    /// expressões são as MESMAS, na MESMA ordem: mudá-las aqui faria a Unity e
    /// a linha JS discordarem sobre o que é um <c>stoneSentinelCall</c>.
    /// </summary>
    public static class FamiliaDeEfeito
    {
        public const string Meteoro = "meteoro";
        public const string Chuva = "chuva";
        public const string Cone = "cone";
        public const string Cruz = "cruz";
        public const string Anel = "anel";
        public const string Terremoto = "terremoto";
        public const string Onda = "onda";
        public const string Investida = "investida";
        public const string Corte = "corte";
        public const string Armadilha = "armadilha";
        public const string Invocacao = "invocacao";
        public const string Aura = "aura";
        public const string Cura = "cura";
        public const string Feixe = "feixe";
        public const string Flecha = "flecha";
        public const string Estouro = "estouro";
        public const string Escudo = "escudo";
        public const string Piscar = "piscar";
        public const string Gancho = "gancho";
        public const string Maldicao = "maldicao";

        /// <summary>O último recurso — 4% das chaves do acervo real caem aqui,
        /// e é assim que tem de ser. Se esta fatia crescer, alguém acrescentou
        /// vocabulário novo ao acervo e falta uma regra.</summary>
        public const string Bola = "bola";

        /// <summary>As 21, na ordem em que SISTEMAS §4 as lista.</summary>
        public static readonly IReadOnlyList<string> Todas = new[]
        {
            Meteoro, Chuva, Cone, Cruz, Anel, Terremoto, Onda, Investida, Corte,
            Armadilha, Invocacao, Aura, Cura, Feixe, Flecha, Estouro, Escudo,
            Piscar, Gancho, Maldicao, Bola
        };

        // A ORDEM importa e é o que faz o despacho acertar: 'stoneSentinelCall'
        // é INVOCAÇÃO, não pedra; 'emberRain' é CHUVA, não brasa. O específico
        // vem antes do genérico, sempre.
        //
        // RegexOptions.Compiled porque isto roda uma vez por conjuração, e a
        // varredura do teste passa 187 chaves por aqui de uma vez.
        static readonly (string Familia, Regex Regra)[] Regras =
        {
            (Meteoro,   new Regex("meteor", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Chuva,     new Regex("rain|quiver|swarm|volley", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Invocacao, new Regex("call$|summon|sentinel|golem|nymph|falcon|hound", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Armadilha, new Regex("trap|stake|snare|alarm|ambush", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Cone,      new Regex("cone|breath|gale|mist|typhoon", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Cruz,      new Regex("cross", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Anel,      new Regex("ring|circle|cyclone|maelstrom|whirl|vortex|dome|nova|storm|eye", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Terremoto, new Regex("quake|fissure|root|menhir|boulder|slab|spike|stone|mountain|wall|husk|bark", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Onda,      new Regex("wave|tide|pool|current|undertow|drown|brine|spring|cistern|siphon|maw", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Cura,      new Regex("heal|poultice|blessing|succor|tending|warm|sweet|restoring|calm|good", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Aura,      new Regex("pact|skin|veins|blood|fury|forge|heart|dance|word|curse|bore|brazier|retort", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Investida, new Regex("step|swap|walk|run|charge|descend|throw|slam|hop|skip", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Flecha,    new Regex("arrow|shot|bolt|spark|lance|harpoon|pin|brand|mark", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Corte,     new Regex("blade|cut|slash|thrust|edge|dagger|hamstring|leech|scald|rust|flint|quick", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Feixe,     new Regex("beam|line|ray", RegexOptions.IgnoreCase | RegexOptions.Compiled)),

            // Daqui para baixo vem o vocabulário do `fxShape` das FORMAS de
            // fusão, que é outro: as 105 formas não usam os nomes autorais dos
            // 171 feitiços de classe.
            (Estouro,   new Regex("^burst$|explod", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Escudo,    new Regex("shield|veil|guard", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Piscar,    new Regex("blink|teleport|phase", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Gancho,    new Regex("hook|grapple|pull|drag", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Maldicao,  new Regex("debuff|hex|rot|wither", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Aura,      new Regex("^buff$", RegexOptions.IgnoreCase | RegexOptions.Compiled)),
            (Cone,      new Regex("gust|wind", RegexOptions.IgnoreCase | RegexOptions.Compiled))
        };

        /// <summary>
        /// A família de uma chave de efeito. Nunca devolve nulo: chave vazia ou
        /// desconhecida vira <see cref="Bola"/>, porque efeito nenhum é pior do
        /// que efeito genérico — o feitiço acertaria em silêncio.
        /// </summary>
        public static string DeChave(string fxKey)
        {
            if (string.IsNullOrEmpty(fxKey)) return Bola;

            // Os nomes genéricos ANTIGOS continuam valendo: o acervo ainda traz
            // 'slam', 'beam', 'nova' crus no `fxShape` das formas de fusão, e
            // deixá-los para as expressões daria outra família — 'slam' bate em
            // /slam/ de investida por acaso, mas 'nova' cairia na bola.
            switch (fxKey)
            {
                case "melee": return Corte;
                case "slam": return Investida;
                case "beam":
                case "line": return Feixe;
                case "nova":
                case "ring":
                case "circle": return Anel;
                case "heal": return Cura;
                case "arrow": return Flecha;
            }

            for (int i = 0; i < Regras.Length; i++)
                if (Regras[i].Regra.IsMatch(fxKey)) return Regras[i].Familia;

            return Bola;
        }

        /// <summary>O nome é de uma das 21? É o que o pool pergunta antes de
        /// procurar molde — família inventada devolveria pool vazio e o efeito
        /// sumiria sem erro nenhum.</summary>
        public static bool Existe(string familia)
        {
            for (int i = 0; i < Todas.Count; i++)
                if (Todas[i] == familia) return true;
            return false;
        }
    }
}
