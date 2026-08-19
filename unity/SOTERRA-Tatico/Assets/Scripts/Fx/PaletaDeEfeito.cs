using UnityEngine;

namespace Soterra.Fx
{
    /// <summary>
    /// De que cor o efeito sai.
    ///
    /// A regra é curta e vem de SISTEMAS §4/§5: a COR vem do ELEMENTO
    /// (<c>elementInfo</c>) — e, quando o feitiço é composto por fusão, da
    /// MISTURA (<c>fusionBlends[].palette</c>). A FORMA nunca decide cor, do
    /// mesmo jeito que a mistura nunca decide desenho: inverter os dois papéis
    /// já foi defeito grave no JS, e a inversão de cor teria o mesmo sintoma —
    /// escudo, meteoro e gancho da mesma dupla saindo iguais.
    /// </summary>
    public static class PaletaDeEfeito
    {
        /// <summary>O prefixo do id dos compostos que a fusão gera em memória:
        /// <c>fus:arqueiro+bruxo:fogo+agua:12</c>.</summary>
        public const string PrefixoDeFusao = "fus:";

        /// <summary>A cor de quem não tem elemento nem mistura — o neutro do
        /// acervo. Existe como constante porque efeito sem cor é efeito
        /// INVISÍVEL, e um preto por engano seria lido como "não saiu".</summary>
        public static readonly Color Padrao = new Color(0.85f, 0.87f, 0.89f, 1f);

        /// <summary>
        /// A cor de um feitiço. Composto de fusão vai pela paleta da mistura;
        /// todo o resto, pela cor do elemento.
        /// </summary>
        public static Color De(Dados.BancoDeDados banco, Dados.Feitico feitico)
        {
            if (feitico == null) return Padrao;

            if (feitico.Id != null && feitico.Id.StartsWith(PrefixoDeFusao))
            {
                var daMistura = DaMistura(banco, feitico.Id);
                if (daMistura.HasValue) return daMistura.Value;
            }
            return DeElemento(banco, feitico.Elemento);
        }

        public static Color DeElemento(Dados.BancoDeDados banco, string elemento)
        {
            if (banco == null || banco.InfoDeElementos == null || string.IsNullOrEmpty(elemento))
                return Padrao;

            Dados.InfoDeElemento info;
            Color cor;
            if (banco.InfoDeElementos.TryGetValue(elemento, out info) && info != null &&
                ColorUtility.TryParseHtmlString(info.Cor, out cor))
                return cor;
            return Padrao;
        }

        /// <summary>
        /// A cor da MISTURA de um id composto. O id carrega o par de elementos
        /// na ordem dos fundidos (<c>fus:dupla:fogo+agua:12</c>), que é a chave
        /// de <c>fusionBlends</c> — ler o elemento do feitiço em vez da mistura
        /// daria só a cor de A e apagaria B, e a fusão perderia metade da
        /// identidade que o jogador pagou 2 PA para ver.
        /// </summary>
        public static Color? DaMistura(Dados.BancoDeDados banco, string idDoFeitico)
        {
            if (banco == null || banco.MisturasDeFusao == null || idDoFeitico == null) return null;

            var partes = idDoFeitico.Split(':');
            if (partes.Length < 3) return null;

            Dados.MisturaDeFusao mistura;
            if (!banco.MisturasDeFusao.TryGetValue(partes[2], out mistura) ||
                mistura == null || mistura.Paleta == null) return null;

            Color cor;
            if (!string.IsNullOrEmpty(mistura.Paleta.Primaria) &&
                ColorUtility.TryParseHtmlString(mistura.Paleta.Primaria, out cor))
                return cor;
            return null;
        }

        /// <summary>
        /// O verde da cura e da regeneração. É a única cor do jogo que NÃO vem
        /// do elemento, e por um motivo de leitura: o número que sobe verde
        /// quer dizer "ganhei vida" em qualquer feitiço, e pintá-lo do elemento
        /// faria uma cura de fogo parecer dano de fogo.
        /// </summary>
        public static readonly Color Cura = new Color(0.49f, 0.91f, 0.63f, 1f);

        /// <summary>O azul do escudo, pela mesma razão da cura.</summary>
        public static readonly Color Escudo = new Color(0.54f, 0.83f, 0.94f, 1f);
    }
}
