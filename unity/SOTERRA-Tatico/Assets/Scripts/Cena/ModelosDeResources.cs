using System.Collections.Generic;
using UnityEngine;

namespace Soterra.Cena
{
    /// <summary>
    /// De onde a cena tira o modelo de uma unidade, dado o id dela.
    ///
    /// Interface e não chamada direta a <c>Resources.Load</c> pelo mesmo motivo
    /// que <c>Soterra.Dados.IFonteDeTexto</c>: assim o teste consegue provar que
    /// a troca de placeholder por modelo definitivo funciona — escala, pivô e
    /// tudo — SEM que exista um único FBX no repositório. Testar isso só depois
    /// que o elenco chegar seria testar tarde demais.
    /// </summary>
    public interface IFonteDeModelos
    {
        /// <summary>O modelo deste id, ou <c>null</c> se ainda não há um.
        /// <c>null</c> é estado esperado, não defeito: enquanto o elenco não
        /// chega, TODO id devolve nulo e a cena cai no placeholder.</summary>
        GameObject Modelo(string id);
    }

    /// <summary>
    /// A fonte de produção: uma pasta por id dentro de
    /// <c>Assets/Resources/elenco/</c>.
    ///
    /// É este o encaixe que o CONTRATO_ENTREGA_PERSONAGEM §6 promete — "o
    /// prefab carregado por id de classe, para trocar o modelo sem tocar em
    /// código". Trocar o Bárbaro é soltar o prefab em
    /// <c>Assets/Resources/elenco/sumo/sumo.prefab</c> e rodar o teste. Nada
    /// aqui muda, nada em <see cref="Elenco"/> muda.
    ///
    /// Dois caminhos são tentados, nesta ordem:
    /// <list type="number">
    ///   <item><c>elenco/&lt;id&gt;/&lt;id&gt;</c> — pasta por id, prefab com o
    ///   mesmo nome. É a forma pedida: o FBX chega com textura e clipes ao lado,
    ///   e cada um precisa de um lugar só seu.</item>
    ///   <item><c>elenco/&lt;id&gt;</c> — prefab solto. Aceito porque enquanto
    ///   se experimenta um modelo só, criar pasta é atrito à toa.</item>
    /// </list>
    ///
    /// <c>Resources</c> e não <c>StreamingAssets</c> pelo mesmo motivo do §4 do
    /// contrato da rodada 1: funciona igual no Editor, no player e no WebGL, sem
    /// <c>UnityWebRequest</c> e sem referência arrastada no Inspector.
    ///
    /// A pasta ainda NÃO existe, e é assim mesmo: <c>Resources.Load</c> de
    /// caminho inexistente devolve nulo, calado, e o placeholder assume.
    /// </summary>
    public sealed class ModelosDeResources : IFonteDeModelos
    {
        /// <summary>Pasta-raiz do elenco dentro de <c>Resources</c>.</summary>
        public const string Pasta = "elenco";

        readonly string _pasta;

        // Lembra também o que NÃO achou. Sem isto, cada id sem modelo bateria em
        // Resources.Load a cada sincronização — e sincronizar acontece a cada
        // passo de cada unidade de cada turno.
        readonly Dictionary<string, GameObject> _cache = new Dictionary<string, GameObject>();

        public ModelosDeResources() : this(Pasta) { }

        public ModelosDeResources(string pasta)
        {
            _pasta = pasta;
        }

        /// <summary>Os caminhos tentados, na ordem. Público para o teste cobrar
        /// a CONVENÇÃO — que é a promessa feita a quem vai entregar o modelo —
        /// em vez de cobrar só o resultado de um Load que hoje sempre falha.</summary>
        public IList<string> CaminhosDe(string id)
        {
            return new[] { _pasta + "/" + id + "/" + id, _pasta + "/" + id };
        }

        public GameObject Modelo(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;

            GameObject achado;
            if (_cache.TryGetValue(id, out achado)) return achado;

            foreach (var caminho in CaminhosDe(id))
            {
                // Sem extensão: `Resources.Load` recusa o caminho se o ".prefab"
                // estiver escrito, e devolve null calado.
                achado = Resources.Load<GameObject>(caminho);
                if (achado != null) break;
            }

            _cache[id] = achado;
            return achado;
        }
    }

    /// <summary>
    /// Fonte de teste: um dicionário de id para modelo, montado à mão. Mesma
    /// forma de <c>Soterra.Dados.FonteDeMemoria</c>.
    /// </summary>
    public sealed class ModelosDeMemoria : IFonteDeModelos
    {
        readonly Dictionary<string, GameObject> _modelos = new Dictionary<string, GameObject>();

        public ModelosDeMemoria Com(string id, GameObject modelo)
        {
            _modelos[id] = modelo;
            return this;
        }

        public GameObject Modelo(string id)
        {
            GameObject m;
            return id != null && _modelos.TryGetValue(id, out m) ? m : null;
        }
    }
}
