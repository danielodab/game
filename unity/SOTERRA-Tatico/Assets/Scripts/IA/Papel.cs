using System.Collections.Generic;

namespace Soterra.IA
{
    // `Motor.X` escrito solto dentro de `Soterra.IA` acharia primeiro qualquer
    // `Soterra.IA.Motor` que alguém venha a criar; e `Batalha` solto acha o
    // NAMESPACE `Soterra.Batalha` antes do tipo `Soterra.Motor.Batalha`. Os
    // apelidos globais travam nos tipos certos — é a mesma armadilha de nome que
    // já custou uma rodada a esta equipe.
    using Motor = global::Soterra.Motor;

    /// <summary>
    /// Como um bicho joga. É o campo <c>ai</c> de <c>monsters.json</c>, e são
    /// exatamente QUATRO valores no acervo inteiro: <c>melee</c> (39 bichos),
    /// <c>ranged</c> (13), <c>support</c> (9) e <c>boss</c> (6). Não há um
    /// quinto, e inventar um faria a IA cair no ramo errado em silêncio.
    /// </summary>
    public enum Papel
    {
        /// <summary><c>melee</c>: encosta e bate.</summary>
        Corpo,

        /// <summary><c>ranged</c>: mantém a distância do melhor feitiço e recua se colado.</summary>
        Distancia,

        /// <summary><c>support</c>: gruda no aliado mais ferido e cura.</summary>
        Suporte,

        /// <summary><c>boss</c>: avalia tudo, com menos pressa de encostar.</summary>
        Chefe
    }

    /// <summary>
    /// De onde sai o papel de uma unidade.
    ///
    /// Duas portas, na ordem do <c>inferRole</c> de <c>js/core/ai.js</c>: o
    /// acervo manda quando existe (<c>unit.aiRole</c> lá, <c>Monstro.Ia</c>
    /// aqui), e só quando NÃO existe — herói, que não tem campo <c>ai</c> — o
    /// papel é inferido do repertório. Inferir sempre apagaria a decisão de quem
    /// escreveu o bestiário: a Vergasta tem alcance 1 no <c>m-root-grip</c> e
    /// seria lida como corpo a corpo, quando o acervo a declara <c>ranged</c>.
    /// </summary>
    public static class Papeis
    {
        public const string CorpoNoAcervo = "melee";
        public const string DistanciaNoAcervo = "ranged";
        public const string SuporteNoAcervo = "support";
        public const string ChefeNoAcervo = "boss";

        /// <summary>
        /// Alcance a partir do qual um feitiço de dano deixa de ser "de perto".
        /// É o <c>bestDmgRange &lt;= 2</c> do <c>inferRole</c>.
        /// </summary>
        public const int AlcanceDeCorpoACorpo = 2;

        public static Papel DoTexto(string ai)
        {
            switch (ai)
            {
                case DistanciaNoAcervo: return Papel.Distancia;
                case SuporteNoAcervo: return Papel.Suporte;
                case ChefeNoAcervo: return Papel.Chefe;
                // `melee` e qualquer coisa que o acervo passe a escrever caem
                // aqui: corpo a corpo é o comportamento que funciona sem saber
                // nada sobre o bicho — ele anda até o inimigo e bate.
                default: return Papel.Corpo;
            }
        }

        /// <summary>O papel desta unidade: o do acervo, ou o inferido.</summary>
        public static Papel De(Dados.BancoDeDados banco, Motor.Unidade u)
        {
            var m = AchaMonstro(banco, u == null ? null : u.ClasseOuMonstroId);
            if (m != null && !string.IsNullOrEmpty(m.Ia)) return DoTexto(m.Ia);
            return Inferir(banco, u);
        }

        /// <summary>
        /// As duas tabelas de bicho, na ordem do <c>Engine.monster</c> do JS: o
        /// bestiário primeiro, as invocações de fusão depois.
        /// </summary>
        static Dados.Monstro AchaMonstro(Dados.BancoDeDados banco, string id)
        {
            if (banco == null || string.IsNullOrEmpty(id)) return null;
            Dados.Monstro m;
            if (banco.Monstros != null && banco.Monstros.TryGetValue(id, out m)) return m;
            if (banco.InvocadosDeFusao != null && banco.InvocadosDeFusao.TryGetValue(id, out m)) return m;
            return null;
        }

        /// <summary>
        /// O <c>inferRole</c> do <c>ai.js</c>, para quem não traz o campo:
        /// sabe curar ⇒ suporte; senão, o alcance do MELHOR feitiço de dano
        /// decide entre corpo a corpo e distância.
        ///
        /// "Melhor" é pela média da faixa, não pelo teto: um feitiço de 1–40
        /// não deve reposicionar a unidade inteira por causa da ponta boa.
        /// </summary>
        static Papel Inferir(Dados.BancoDeDados banco, Motor.Unidade u)
        {
            if (u == null || banco == null) return Papel.Corpo;

            bool sabeCurar = false;
            double melhorDano = 0;
            int alcanceDoMelhor = 1;

            for (int i = 0; i < u.Feiticos.Count; i++)
            {
                var f = banco.AchaFeitico(u.Feiticos[i]);
                if (f == null || f.Efeitos == null) continue;

                for (int j = 0; j < f.Efeitos.Count; j++)
                {
                    var e = f.Efeitos[j];
                    if (e == null) continue;
                    if (e.Tipo == "heal") sabeCurar = true;
                    if (e.Tipo == "damage" || e.Tipo == "chain")
                    {
                        double media = ((e.Min ?? 0) + (e.Max ?? 0)) / 2.0;
                        if (media > melhorDano)
                        {
                            melhorDano = media;
                            alcanceDoMelhor = f.Alcance == null ? 1 : f.Alcance.Max;
                        }
                    }
                }
            }

            if (sabeCurar) return Papel.Suporte;
            return alcanceDoMelhor <= AlcanceDeCorpoACorpo ? Papel.Corpo : Papel.Distancia;
        }
    }
}
