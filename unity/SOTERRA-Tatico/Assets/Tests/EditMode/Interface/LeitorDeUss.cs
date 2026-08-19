using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Soterra.Testes.Interface
{
    /// <summary>Uma regra de USS já quebrada em seletores e declarações.</summary>
    public sealed class RegraDeUss
    {
        /// <summary>Posição no arquivo. Empate de especificidade se resolve por ela.</summary>
        public int Ordem;

        public List<string> Seletores = new List<string>();
        public Dictionary<string, string> Declaracoes = new Dictionary<string, string>();
    }

    /// <summary>
    /// Um leitor mínimo de USS, só para o teste de alvo de toque.
    ///
    /// Por que ler o ARQUIVO e não medir o elemento na tela: medir exige um
    /// painel, e painel exige modo Play com vídeo. O lote roda
    /// <c>-batchmode -nographics</c>, onde <c>resolvedStyle</c> nunca é
    /// calculado — o teste de tamanho passaria lendo zero em tudo e afirmando
    /// que está tudo grande o bastante. Lendo a folha de estilo de verdade, o
    /// número medido é o número que vai para o aparelho.
    ///
    /// NÃO é um interpretador de CSS: não faz cascata, não resolve
    /// especificidade e trata seletor descendente como se sempre casasse. Todas
    /// as três simplificações erram para o lado PESSIMISTA — uma regra que na
    /// prática não se aplica ainda assim é cobrada. Num teste que procura o alvo
    /// pequeno, errar para mais é a direção certa.
    /// </summary>
    public static class LeitorDeUss
    {
        public static List<RegraDeUss> Ler(string texto)
        {
            var regras = new List<RegraDeUss>();
            if (string.IsNullOrEmpty(texto)) return regras;

            // Comentário some antes de tudo: `/* width: 10px */` dentro de um
            // bloco viraria uma declaração de verdade para um leitor ingênuo.
            var limpo = Regex.Replace(texto, @"/\*.*?\*/", " ", RegexOptions.Singleline);

            int i = 0;
            while (true)
            {
                int abre = limpo.IndexOf('{', i);
                if (abre < 0) break;
                int fecha = limpo.IndexOf('}', abre);
                if (fecha < 0) break;

                var cabeca = limpo.Substring(i, abre - i);

                // `@import url(...);` não tem bloco e gruda no seletor seguinte.
                int pontoEVirgula = cabeca.LastIndexOf(';');
                if (pontoEVirgula >= 0) cabeca = cabeca.Substring(pontoEVirgula + 1);

                var corpo = limpo.Substring(abre + 1, fecha - abre - 1);
                var sel = cabeca.Trim();

                if (sel.Length > 0 && !sel.StartsWith("@"))
                {
                    var r = new RegraDeUss { Ordem = regras.Count };
                    foreach (var s in sel.Split(','))
                    {
                        var t = s.Trim();
                        if (t.Length > 0) r.Seletores.Add(t);
                    }
                    foreach (var d in corpo.Split(';'))
                    {
                        var t = d.Trim();
                        if (t.Length == 0) continue;
                        int dp = t.IndexOf(':');
                        if (dp <= 0) continue;
                        r.Declaracoes[t.Substring(0, dp).Trim()] = t.Substring(dp + 1).Trim();
                    }
                    if (r.Seletores.Count > 0) regras.Add(r);
                }

                i = fecha + 1;
            }

            return regras;
        }

        /// <summary>
        /// Se o seletor pega este elemento.
        ///
        /// Olha só o ÚLTIMO seletor simples da cadeia — o sujeito, que em CSS é
        /// quem recebe as declarações. O que vier antes é ancestral e aqui é
        /// ignorado de propósito (ver a nota de pessimismo na classe).
        /// </summary>
        public static bool Aplica(string seletor, string nome, ICollection<string> classes, Type tipo)
        {
            if (string.IsNullOrEmpty(seletor)) return false;

            var partes = seletor.Split(new[] { ' ', '>', '\t', '\n', '\r' },
                                       StringSplitOptions.RemoveEmptyEntries);
            if (partes.Length == 0) return false;
            var sujeito = partes[partes.Length - 1];

            // Pseudo-classe (`:active`, `:disabled`) não muda de quem é a regra.
            int pc = sujeito.IndexOf(':');
            if (pc >= 0) sujeito = sujeito.Substring(0, pc);
            if (sujeito.Length == 0 || sujeito == "*") return true;

            foreach (Match m in Regex.Matches(sujeito, @"[.#]?[A-Za-z_][A-Za-z0-9_\-]*"))
            {
                var t = m.Value;
                if (t[0] == '.')
                {
                    if (classes == null || !classes.Contains(t.Substring(1))) return false;
                }
                else if (t[0] == '#')
                {
                    if (nome != t.Substring(1)) return false;
                }
                else
                {
                    if (!EhDoTipo(tipo, t)) return false;
                }
            }
            return true;
        }

        static bool EhDoTipo(Type tipo, string nome)
        {
            for (var t = tipo; t != null; t = t.BaseType)
                if (t.Name == nome) return true;
            return false;
        }

        /// <summary>
        /// Converte um valor de USS em pixels. Devolve falso para o que não é
        /// medida absoluta (<c>auto</c>, <c>100%</c>, <c>initial</c>) — nesses
        /// casos não há número para comparar, e chutar um seria pior que nada.
        /// </summary>
        public static bool TentaPixels(string valor, out float px)
        {
            px = 0f;
            if (string.IsNullOrEmpty(valor)) return false;
            var v = valor.Trim();
            if (v.EndsWith("%")) return false;
            if (v.EndsWith("px")) v = v.Substring(0, v.Length - 2).Trim();
            return float.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out px);
        }
    }
}
