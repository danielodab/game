using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace Soterra.Dados
{
    /// <summary>
    /// Uma FORMA de fusão — um degrau do arsenal de uma dupla de classes
    /// (<c>fusionForms</c> no acervo; 15 duplas × 7 degraus = 105 formas).
    ///
    /// A forma decide a MECÂNICA e o DESENHO do feitiço composto. O elemento
    /// dos efeitos de <see cref="Mecanica"/> pode vir como <c>@A</c>/<c>@B</c>:
    /// são resolvidos na composição pela mistura elemental — a forma não sabe,
    /// de propósito, de que elementos a fusão vai ser.
    /// </summary>
    public sealed class FormaDeFusao
    {
        /// <summary>0, 5, 10, 12, 15, 20 ou 30 — o nível da fusão que a libera.</summary>
        [JsonProperty("tier")] public int Degrau { get; set; }

        /// <summary>Substantivo masculino singular ("Disparo"), a primeira metade do nome.</summary>
        [JsonProperty("formName")] public string NomeDaForma { get; set; }

        [JsonProperty("paCost")] public int CustoDePa { get; set; }
        [JsonProperty("cooldown")] public int Recarga { get; set; }
        [JsonProperty("castsPerTurn")] public int LancamentosPorTurno { get; set; }
        [JsonProperty("range")] public AlcanceDeFeitico Alcance { get; set; }
        [JsonProperty("aoe")] public AreaDeFeitico Area { get; set; }
        [JsonProperty("needsEmptyTile")] public bool ExigeCasaVazia { get; set; }
        [JsonProperty("targetSide")] public Lado Alvo { get; set; }

        /// <summary>
        /// <c>offense</c> ou <c>support</c>. Decide QUAL rider da mistura entra:
        /// numa forma de apoio o rider ofensivo cairia sobre o próprio aliado
        /// curado, então a mistura traz um <c>riderSupport</c> separado.
        /// </summary>
        [JsonProperty("riderMode")] public string ModoDoRider { get; set; }

        /// <summary>Os efeitos da forma, com <c>@A</c>/<c>@B</c> por resolver.</summary>
        [JsonProperty("mechanic")] public List<Efeito> Mecanica { get; set; }

        [JsonProperty("description")] public string Descricao { get; set; }

        /// <summary>O desenho do efeito visual. É a FORMA que o decide — ver o teste anti-inversão.</summary>
        [JsonProperty("fxShape")] public string DesenhoDoEfeito { get; set; }

        public FormaDeFusao()
        {
            Mecanica = new List<Efeito>();
        }
    }

    /// <summary>Cores que a mistura empresta ao efeito e à interface.</summary>
    public sealed class PaletaDeFusao
    {
        [JsonProperty("primary")] public string Primaria { get; set; }
        [JsonProperty("secondary")] public string Secundaria { get; set; }
        [JsonProperty("accent")] public string Destaque { get; set; }
    }

    /// <summary>
    /// Uma MISTURA elemental (<c>fusionBlends</c>; 25 = os pares ORDENADOS dos
    /// 5 elementos, <c>neutro</c> incluído — herói abaixo do nível 5 ainda não
    /// escolheu caminho e a fusão precisa funcionar assim mesmo).
    ///
    /// A mistura decide o SABOR: o afixo do nome, o rider e a cor. A chave é a
    /// ordem dos DOIS FUNDIDOS (A,B), nunca alfabética — o acervo traz as 10
    /// espelhadas (com <see cref="Elementos"/> invertido) exatamente para que
    /// <c>@A</c> e <c>@B</c> resolvam no elemento certo em qualquer ordem.
    /// </summary>
    public sealed class MisturaDeFusao
    {
        [JsonProperty("id")] public string Id { get; set; }

        /// <summary>Adjetivo masculino singular ("Salgado"), a segunda metade do nome.</summary>
        [JsonProperty("affix")] public string Afixo { get; set; }

        /// <summary><c>@A</c> vira o [0], <c>@B</c> vira o [1].</summary>
        [JsonProperty("elements")] public List<string> Elementos { get; set; }

        [JsonProperty("description")] public string Descricao { get; set; }

        /// <summary>O efeito extra característico da mistura, somado à mecânica da forma.</summary>
        [JsonProperty("rider")] public List<Efeito> Rider { get; set; }

        /// <summary>O rider das formas de apoio — o ofensivo cairia sobre o aliado curado.</summary>
        [JsonProperty("riderSupport")] public List<Efeito> RiderDeApoio { get; set; }

        [JsonProperty("palette")] public PaletaDeFusao Paleta { get; set; }

        /// <summary>A COR do efeito. Não decide o desenho — isso é da forma.</summary>
        [JsonProperty("fxKey")] public string ChaveDeEfeito { get; set; }

        /// <summary>Nas 10 espelhadas, a chave canônica de que esta é reflexo.</summary>
        [JsonProperty("mirrorOf")] public string EspelhoDe { get; set; }
    }

    /// <summary>
    /// A identidade de uma dupla (<c>fusionIdentities</c>; 15): o nome visível
    /// da forma fundida e a frase que a apresenta. É apresentação, não regra —
    /// a interface a mostra; o motor não a lê.
    /// </summary>
    public sealed class IdentidadeDeFusao
    {
        [JsonProperty("name")] public string Nome { get; set; }
        [JsonProperty("line")] public string Frase { get; set; }
    }

    /// <summary>
    /// A COMPOSIÇÃO dos feitiços de fusão — o retrato de <c>js/core/fusion.js</c>
    /// (<c>Fusion.spellsFor</c> e <c>Fusion.powerFactor</c>).
    ///
    /// 105 formas × 25 misturas = 2.625 feitiços possíveis, compostos SOB
    /// DEMANDA e nunca gravados em arquivo (contrato §4: "gerado em memória").
    /// A divisão de papéis é a regra mais importante do sistema, porque já
    /// esteve invertida no JS e era um defeito grave: a FORMA decide a mecânica
    /// e o desenho; a MISTURA decide só o sabor (afixo, rider, cor). Invertido,
    /// 25 misturas cobriam 105 formas e toda fusão do mesmo par de elementos
    /// saía com o mesmo efeito — escudo, meteoro e gancho idênticos.
    ///
    /// Mora em <c>Soterra.Dados</c> e não no Motor porque é uma função PURA do
    /// acervo: dado o banco, a dupla, a mistura e o nível, o resultado é sempre
    /// o mesmo — testável sem batalha nenhuma.
    /// </summary>
    public static class Fusao
    {
        /// <summary><c>Fusion.POWER_MULT</c> do JS, renormalizado na v2.8 (era 2,30).</summary>
        public const double MultiplicadorDePoder = 1.144;

        /// <summary>
        /// <c>Fusion.PAIR_TUNE</c> do JS, copiado número a número. Depois de
        /// acertar a média com <see cref="MultiplicadorDePoder"/>, sobra
        /// dispersão POR DUPLA — as formas de cada par não valem o mesmo em
        /// relação aos dois kits que substituem. Medido em
        /// <c>tests/equilibrio_fusao.html</c>; cada valor se lê como desvio em
        /// torno de 1,0. Chave em ordem alfabética, a mesma de
        /// <c>fusionForms</c>.
        /// </summary>
        public static readonly IReadOnlyDictionary<string, double> AjustePorDupla =
            new Dictionary<string, double>
            {
                { "arqueiro+bruxo",        1.046 },
                { "arqueiro+curandeira",   0.704 },
                { "arqueiro+espadachim",   1.154 },
                { "arqueiro+invocador",    1.257 },
                { "arqueiro+sumo",         0.716 },
                { "bruxo+curandeira",      1.283 },
                { "bruxo+espadachim",      1.221 },
                { "bruxo+invocador",       1.623 },
                { "bruxo+sumo",            1.229 },
                { "curandeira+espadachim", 0.547 },
                { "curandeira+invocador",  1.281 },
                { "curandeira+sumo",       0.853 },
                { "espadachim+invocador",  1.102 },
                { "espadachim+sumo",       0.505 },
                { "invocador+sumo",        1.259 }
            };

        /// <summary>
        /// A chave de DUPLA: os dois ids em ORDEM ALFABÉTICA, unidos por
        /// <c>+</c> — <c>arqueiro+bruxo</c>, nunca <c>bruxo+arqueiro</c>. Vazio
        /// vira <c>neutro</c>, como o <c>pairKey</c> do JS. É a mesma ordenação
        /// para classes e para a chave alfabética de elementos: assim a
        /// aparência e o ajuste da dupla são um só, independentemente de quem
        /// declarou a fusão.
        /// </summary>
        public static string ChaveDePar(string a, string b)
        {
            var x = string.IsNullOrEmpty(a) ? Elemento.Neutro : a;
            var y = string.IsNullOrEmpty(b) ? Elemento.Neutro : b;
            return string.CompareOrdinal(x, y) <= 0 ? x + "+" + y : y + "+" + x;
        }

        /// <summary>
        /// <c>Fusion.powerFactor</c> do JS, literal:
        /// <c>(100 + nível×1,2 + degrau×1)/100 × POWER_MULT × ajuste</c>.
        /// Os números autorais das formas JÁ crescem com o degrau, então o
        /// degrau entra aqui só como tempero e o peso fica com o nível — é o
        /// que faz uma forma de degrau 0 valer a pena numa fusão de nível 30
        /// sem contar o degrau duas vezes.
        /// </summary>
        public static double FatorDePoder(int degrau, int nivel, string parDeClasses)
        {
            double ajuste;
            if (parDeClasses == null || !AjustePorDupla.TryGetValue(parDeClasses, out ajuste))
                ajuste = 1.0;
            return (100.0 + nivel * 1.2 + degrau * 1.0) / 100.0 * MultiplicadorDePoder * ajuste;
        }

        /// <summary>
        /// Compõe o arsenal de uma fusão: para cada forma da dupla com degrau ≤
        /// nível, um feitiço <c>forma × mistura</c> no MESMO formato de
        /// <c>DATA.spells</c>. Devolve vazio se a dupla ou a mistura não
        /// existirem no acervo — quem chama decide a rede de segurança (o motor
        /// cai na união dos dois arsenais, como o JS).
        /// </summary>
        /// <param name="parDeClasses">Chave alfabética da dupla (<c>arqueiro+bruxo</c>).</param>
        /// <param name="parDeElementos">
        /// Chave na ORDEM DOS FUNDIDOS (<c>fogo+agua</c> ≠ <c>agua+fogo</c>) —
        /// o acervo traz as espelhadas para <c>@A</c>/<c>@B</c> resolverem certo.
        /// </param>
        public static List<Feitico> Compor(BancoDeDados banco, string parDeClasses,
                                           string parDeElementos, int nivel)
        {
            var saida = new List<Feitico>();
            if (banco == null) return saida;

            var formas = AchaFormas(banco, parDeClasses);
            if (formas == null || formas.Count == 0) return saida;

            var partes = (parDeElementos ?? "").Split('+');
            var eA = partes.Length > 0 && !string.IsNullOrEmpty(partes[0]) ? partes[0] : Elemento.Neutro;
            var eB = partes.Length > 1 && !string.IsNullOrEmpty(partes[1]) ? partes[1] : Elemento.Neutro;
            var mistura = AchaMistura(banco, eA, eB);
            if (mistura == null) return saida;

            var elementos = (mistura.Elementos != null && mistura.Elementos.Count > 0)
                ? mistura.Elementos
                : new List<string> { eA, eB };

            var chaveDeClasses = parDeClasses != null && parDeClasses.IndexOf('+') >= 0
                ? ChaveDePar(parDeClasses.Split('+')[0], parDeClasses.Split('+')[1])
                : parDeClasses;
            var chaveDeElementos = eA + "+" + eB;   // ordem dos fundidos, não alfabética

            for (int f = 0; f < formas.Count; f++)
            {
                var forma = formas[f];
                if (forma == null || forma.Degrau > nivel) continue;

                double fator = FatorDePoder(forma.Degrau, nivel, chaveDeClasses);
                var efeitos = new List<Efeito>();

                var mecanica = forma.Mecanica ?? new List<Efeito>();
                for (int i = 0; i < mecanica.Count; i++)
                    efeitos.Add(Composto(mecanica[i], elementos, fator));

                // Formas de apoio usam `riderSupport`: o rider ofensivo da
                // mistura cairia sobre o próprio aliado curado.
                var rider = (forma.ModoDoRider == "support" && mistura.RiderDeApoio != null)
                    ? mistura.RiderDeApoio
                    : (mistura.Rider ?? new List<Efeito>());
                for (int i = 0; i < rider.Count; i++)
                    efeitos.Add(Composto(rider[i], elementos, fator));

                saida.Add(new Feitico
                {
                    Id = "fus:" + chaveDeClasses + ":" + chaveDeElementos + ":" + forma.Degrau,
                    Nome = forma.NomeDaForma + " " + mistura.Afixo,
                    Elemento = elementos.Count > 0 && !string.IsNullOrEmpty(elementos[0])
                        ? elementos[0] : Dados.Elemento.Neutro,
                    IdDaClasse = null,
                    NivelDeDesbloqueio = forma.Degrau,
                    CustoDePa = forma.CustoDePa,
                    Recarga = forma.Recarga,
                    LancamentosPorTurno = forma.LancamentosPorTurno,
                    // As geometrias são COMPARTILHADAS com o acervo, não
                    // copiadas: ninguém as muta, e copiar criaria 2.625 pares
                    // de objetos iguais.
                    Alcance = forma.Alcance,
                    Area = forma.Area,
                    ExigeCasaVazia = forma.ExigeCasaVazia,
                    Alvo = forma.Alvo,
                    Efeitos = efeitos,
                    Descricao = forma.Descricao,
                    // Quem decide o DESENHO é a FORMA; a mistura decide o sabor.
                    // Esteve ao contrário no JS (fxKey da mistura primeiro) e as
                    // 25 misturas cobriam as 105 formas: toda fusão do mesmo par
                    // de elementos saía com o mesmo efeito, fosse escudo,
                    // meteoro ou gancho.
                    ChaveDeEfeito = !string.IsNullOrEmpty(forma.DesenhoDoEfeito)
                        ? forma.DesenhoDoEfeito
                        : (!string.IsNullOrEmpty(mistura.ChaveDeEfeito)
                            ? mistura.ChaveDeEfeito : "slam")
                });
            }
            return saida;
        }

        /// <summary>
        /// As formas da dupla, aceitando a chave nas duas ordens — o mesmo
        /// <c>lookupForms</c> tolerante do JS. No acervo real a chave é sempre
        /// alfabética; a tolerância evita que uma chamada com a ordem invertida
        /// falhe em silêncio.
        /// </summary>
        static List<FormaDeFusao> AchaFormas(BancoDeDados banco, string parDeClasses)
        {
            var formas = banco.FormasDeFusao;
            if (formas == null || string.IsNullOrEmpty(parDeClasses)) return null;

            List<FormaDeFusao> achadas;
            if (formas.TryGetValue(parDeClasses, out achadas)) return achadas;

            var partes = parDeClasses.Split('+');
            if (partes.Length != 2) return null;
            if (formas.TryGetValue(partes[1] + "+" + partes[0], out achadas)) return achadas;
            if (formas.TryGetValue(ChaveDePar(partes[0], partes[1]), out achadas)) return achadas;
            return null;
        }

        /// <summary>
        /// A mistura do par (A,B), com os fallbacks do <c>lookupBlend</c> do JS:
        /// chave exata, invertida, alfabética. No acervo real as 25 chaves
        /// ordenadas existem todas, então a exata sempre acha — os fallbacks
        /// são a rede para um acervo incompleto.
        /// </summary>
        static MisturaDeFusao AchaMistura(BancoDeDados banco, string eA, string eB)
        {
            var misturas = banco.MisturasDeFusao;
            if (misturas == null) return null;

            MisturaDeFusao m;
            if (misturas.TryGetValue(eA + "+" + eB, out m)) return m;
            if (misturas.TryGetValue(eB + "+" + eA, out m)) return m;
            if (misturas.TryGetValue(ChaveDePar(eA, eB), out m)) return m;
            return null;
        }

        // Os tipos cuja faixa min/max escala com o fator — `SCALED_MINMAX` do JS.
        // Marca, empurrão e bônus passam intactos de propósito: escalar pilhas
        // de marca ou casas de empurrão mudaria a MECÂNICA, não o poder.
        static bool EscalaMinMax(string tipo)
        {
            return tipo == "damage" || tipo == "heal" || tipo == "poison" || tipo == "chain";
        }

        /// <summary>
        /// Cópia do efeito com <c>@A</c>/<c>@B</c> resolvidos e a faixa escalada.
        /// CÓPIA, e não mutação: o molde é o objeto do acervo, compartilhado por
        /// todas as fusões — escalar nele faria a segunda fusão escalar em cima
        /// da primeira.
        ///
        /// O JS resolve tokens em qualquer campo de texto; no acervo exportado
        /// eles só existem em <c>element</c> (conferido na exportação de
        /// 18/08/2026: 113 ocorrências, todas em <c>mechanic[].element</c>), e é
        /// só aí que esta cópia resolve.
        /// </summary>
        static Efeito Composto(Efeito molde, List<string> elementos, double fator)
        {
            var e = new Efeito
            {
                Tipo = molde.Tipo,
                Elemento = ResolveElemento(molde.Elemento, elementos),
                Min = molde.Min,
                Max = molde.Max,
                Duracao = molde.Duracao,
                Valor = molde.Valor,
                Atributo = molde.Atributo,
                Casas = molde.Casas,
                RoubaVida = molde.RoubaVida,
                Clima = molde.Clima,
                IdDaArmadilha = molde.IdDaArmadilha,
                Multiplicador = molde.Multiplicador,
                Saltos = molde.Saltos,
                Queda = molde.Queda,
                Tipos = molde.Tipos == null ? null : new List<string>(molde.Tipos),
                IdDoMonstro = molde.IdDoMonstro,
                CasasMaximas = molde.CasasMaximas,
                Porcentagem = molde.Porcentagem
            };

            if (EscalaMinMax(e.Tipo))
            {
                if (e.Min.HasValue) e.Min = Math.Max(1, Arredonda(e.Min.Value * fator));
                if (e.Max.HasValue) e.Max = Math.Max(e.Min ?? 1, Arredonda(e.Max.Value * fator));
            }
            if (e.Tipo == "shield" && e.Valor.HasValue)
                e.Valor = Arredonda(e.Valor.Value * fator);

            return e;
        }

        static string ResolveElemento(string valor, List<string> elementos)
        {
            if (valor == "@A") return elementos.Count > 0 ? elementos[0] : Elemento.Neutro;
            if (valor == "@B") return elementos.Count > 1 ? elementos[1] : Elemento.Neutro;
            return valor;
        }

        /// <summary>
        /// O <c>Math.round</c> do JS: meio para CIMA. É a mesma conta de
        /// <c>Batalha.Arredonda</c>, reescrita aqui porque <c>Soterra.Dados</c>
        /// não enxerga o Motor — e o <c>Math.Round</c> do C# arredonda meio para
        /// o par, o que mudaria a faixa de dano de metade dos feitiços compostos.
        /// </summary>
        static int Arredonda(double v)
        {
            return (int)Math.Floor(v + 0.5);
        }
    }
}
