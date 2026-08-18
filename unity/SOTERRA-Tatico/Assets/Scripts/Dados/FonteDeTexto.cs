using System;
using System.Collections.Generic;
using UnityEngine;

namespace Soterra.Dados
{
    /// <summary>
    /// De onde o carregador tira o texto de cada chave de <c>JOGO.DATA</c>.
    ///
    /// Existe como interface, e não como chamada direta a <c>Resources.Load</c>,
    /// porque senão TODO teste da camada de dados precisaria de arquivo em
    /// <c>Assets/Resources/</c> — que é de outro dono e pode nem ter sido gerado
    /// ainda. Com a fonte injetada, o teste alimenta string e o carregador roda
    /// sem cena, sem disco e em milissegundos.
    /// </summary>
    public interface IFonteDeTexto
    {
        /// <summary>
        /// Devolve o JSON da chave, ou <c>null</c> se ela não existe.
        ///
        /// <c>null</c> e não exceção: chave que falta é estado esperado enquanto
        /// o acervo está sendo exportado, e o carregador precisa distinguir
        /// "ainda não veio" de "veio quebrado" — só o segundo é defeito.
        /// </summary>
        string Ler(string chave);
    }

    /// <summary>
    /// A fonte de produção: <c>Assets/Resources/dados/&lt;chave&gt;.json</c>.
    ///
    /// <c>Resources</c> e não <c>StreamingAssets</c> porque
    /// <c>Resources.Load&lt;TextAsset&gt;</c> funciona igual no Editor, no player e
    /// no WebGL, sem <c>UnityWebRequest</c> e sem referência arrastada no
    /// Inspector (contrato §4).
    /// </summary>
    public sealed class FonteDeResources : IFonteDeTexto
    {
        public const string Pasta = "dados";

        readonly string _pasta;

        public FonteDeResources() : this(Pasta) { }

        public FonteDeResources(string pasta)
        {
            _pasta = pasta;
        }

        public string Ler(string chave)
        {
            // Sem extensão: `Resources.Load` recusa o caminho se o ".json"
            // estiver escrito, e devolve null calado — o erro mais fácil aqui.
            var ativo = Resources.Load<TextAsset>(_pasta + "/" + chave);
            return ativo == null ? null : ativo.text;
        }
    }

    /// <summary>
    /// Fonte de teste: um dicionário de chave para JSON, montado à mão.
    /// </summary>
    public sealed class FonteDeMemoria : IFonteDeTexto
    {
        readonly Dictionary<string, string> _textos = new Dictionary<string, string>();

        public FonteDeMemoria Com(string chave, string json)
        {
            _textos[chave] = json;
            return this;
        }

        public string Ler(string chave)
        {
            string t;
            return _textos.TryGetValue(chave, out t) ? t : null;
        }
    }

    /// <summary>
    /// Adaptador para quem prefere entregar a fonte como <c>Func</c>.
    /// </summary>
    public sealed class FonteDeFuncao : IFonteDeTexto
    {
        readonly Func<string, string> _f;

        public FonteDeFuncao(Func<string, string> f)
        {
            if (f == null) throw new ArgumentNullException("f");
            _f = f;
        }

        public string Ler(string chave)
        {
            return _f(chave);
        }
    }
}
