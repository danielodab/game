using System;
using System.Collections.Generic;

namespace Soterra.Dados
{
    /// <summary>
    /// O acervo do jogo carregado em memória — um arquivo por chave de
    /// <c>JOGO.DATA</c>, como manda o contrato §4.
    ///
    /// Um arquivo por chave, e não um <c>dados.json</c> gigante, porque 1 MB
    /// numa linha só não se revisa em diff. O preço é que a leitura precisa
    /// saber a lista de chaves — daí <c>ChavesModeladas</c>.
    ///
    /// Chave que falta NÃO derruba a carga: ela entra em <c>ChavesAusentes</c> e
    /// a coleção fica vazia. O acervo é gerado por outro dono e chega em
    /// pedaços; parar tudo na primeira ausência tornaria impossível trabalhar
    /// enquanto a exportação não terminasse. O que não pode acontecer é o
    /// contrário: ausência passar despercebida — por isso a lista existe, e por
    /// isso o teste do manifesto é o juiz final.
    /// </summary>
    public sealed class BancoDeDados
    {
        // ---- chaves de JOGO.DATA que esta rodada modela --------------------
        public const string ChaveElementos = "elements";
        public const string ChaveRivais = "rivals";
        public const string ChaveInfoDeElementos = "elementInfo";
        public const string ChaveClimas = "weathers";
        public const string ChaveClasses = "classes";
        public const string ChaveFeiticos = "spells";
        public const string ChaveFeiticosDeItem = "itemSpells";
        public const string ChaveFeiticosDeMonstro = "monsterSpells";
        public const string ChaveFeiticosDeBicho = "petSpells";
        public const string ChaveFeiticosDeFusao = "fusionSpells";
        public const string ChaveCalabocos = "dungeons";
        public const string ChaveCenarios = "scenery";
        public const string ChaveEventosDeTerreno = "tileEvents";
        public const string ChaveItens = "items";
        public const string ChaveConjuntos = "sets";
        public const string ChavePedras = "stones";
        public const string ChaveForja = "upgrade";
        public const string ChavePesosDeSaque = "lootWeights";
        public const string ChaveDegrausDeDesbloqueio = "unlockTiers";
        public const string ChaveNivelamento = "leveling";
        public const string ChaveCartas = "cards";
        public const string ChaveEstrelas = "stars";
        public const string ChaveMonstros = "monsters";
        public const string ChaveInvocadosDeFusao = "fusionSummons";
        public const string ChaveBichos = "pets";

        public static readonly string[] ChavesModeladas =
        {
            ChaveElementos, ChaveRivais, ChaveInfoDeElementos, ChaveClimas,
            ChaveClasses, ChaveFeiticos, ChaveFeiticosDeItem, ChaveFeiticosDeMonstro,
            ChaveFeiticosDeBicho, ChaveFeiticosDeFusao, ChaveCalabocos, ChaveCenarios,
            ChaveEventosDeTerreno, ChaveItens, ChaveConjuntos, ChavePedras,
            ChaveForja, ChavePesosDeSaque, ChaveDegrausDeDesbloqueio, ChaveNivelamento,
            ChaveCartas, ChaveEstrelas, ChaveMonstros, ChaveInvocadosDeFusao, ChaveBichos
        };

        // ---- o acervo ------------------------------------------------------
        public Manifesto Manifesto { get; private set; }

        public IList<string> Elementos { get; private set; }

        /// <summary>Rival de cada elemento. O valor de <c>neutro</c> é nulo — ele não odeia ninguém.</summary>
        public IDictionary<string, string> Rivais { get; private set; }

        public IDictionary<string, InfoDeElemento> InfoDeElementos { get; private set; }
        public IDictionary<string, Clima> Climas { get; private set; }
        public IDictionary<string, Classe> Classes { get; private set; }

        public IDictionary<string, Feitico> Feiticos { get; private set; }
        public IDictionary<string, Feitico> FeiticosDeItem { get; private set; }
        public IDictionary<string, Feitico> FeiticosDeMonstro { get; private set; }
        public IDictionary<string, Feitico> FeiticosDeBicho { get; private set; }
        public IDictionary<string, Feitico> FeiticosDeFusao { get; private set; }

        public IList<Calabouco> Calabocos { get; private set; }
        public IDictionary<string, Cenario> Cenarios { get; private set; }
        public IDictionary<string, EventoDeTerreno> EventosDeTerreno { get; private set; }

        public IDictionary<string, Item> Itens { get; private set; }
        public IDictionary<string, Conjunto> Conjuntos { get; private set; }
        public IDictionary<string, Pedra> Pedras { get; private set; }
        public Forja Forja { get; private set; }
        public PesosDeSaque PesosDeSaque { get; private set; }

        public IList<int> DegrausDeDesbloqueio { get; private set; }
        public Nivelamento Nivelamento { get; private set; }
        public IDictionary<string, CartaDeClasse> Cartas { get; private set; }
        public Estrelas Estrelas { get; private set; }

        public IDictionary<string, Monstro> Monstros { get; private set; }
        public IDictionary<string, Monstro> InvocadosDeFusao { get; private set; }
        public IDictionary<string, Bicho> Bichos { get; private set; }

        /// <summary>Chaves modeladas cujo arquivo não veio. Vazia = acervo completo.</summary>
        public IList<string> ChavesAusentes { get; private set; }

        readonly IFonteDeTexto _fonte;
        readonly Dictionary<string, Func<int>> _contagens = new Dictionary<string, Func<int>>();

        BancoDeDados(IFonteDeTexto fonte)
        {
            _fonte = fonte;
            ChavesAusentes = new List<string>();
        }

        /// <summary>Atalho para a fonte de produção (<c>Assets/Resources/dados/</c>).</summary>
        public static BancoDeDados CarregarDeResources()
        {
            return Carregar(new FonteDeResources());
        }

        public static BancoDeDados Carregar(IFonteDeTexto fonte)
        {
            if (fonte == null) throw new ArgumentNullException("fonte");
            var b = new BancoDeDados(fonte);

            // Qualificado: dentro desta classe o nome `Manifesto` já é uma
            // propriedade de instância, e num método estático ele não resolve
            // para o tipo.
            b.Manifesto = Soterra.Dados.Manifesto.DeJson(b.Texto(Soterra.Dados.Manifesto.Chave));

            b.Elementos = b.Lista<string>(ChaveElementos);
            b.Rivais = b.Mapa<string>(ChaveRivais);
            b.InfoDeElementos = b.Mapa<InfoDeElemento>(ChaveInfoDeElementos);
            b.Climas = b.Mapa<Clima>(ChaveClimas);
            b.Classes = b.Mapa<Classe>(ChaveClasses);

            b.Feiticos = b.Mapa<Feitico>(ChaveFeiticos);
            b.FeiticosDeItem = b.Mapa<Feitico>(ChaveFeiticosDeItem);
            b.FeiticosDeMonstro = b.Mapa<Feitico>(ChaveFeiticosDeMonstro);
            b.FeiticosDeBicho = b.Mapa<Feitico>(ChaveFeiticosDeBicho);
            b.FeiticosDeFusao = b.Mapa<Feitico>(ChaveFeiticosDeFusao);

            b.Calabocos = b.Lista<Calabouco>(ChaveCalabocos);
            b.Cenarios = b.Mapa<Cenario>(ChaveCenarios);
            b.EventosDeTerreno = b.Mapa<EventoDeTerreno>(ChaveEventosDeTerreno);

            b.Itens = b.Mapa<Item>(ChaveItens);
            b.Conjuntos = b.Mapa<Conjunto>(ChaveConjuntos);
            b.Pedras = b.Mapa<Pedra>(ChavePedras);
            b.Forja = b.Objeto<Forja>(ChaveForja);
            b.PesosDeSaque = b.Objeto<PesosDeSaque>(ChavePesosDeSaque);

            b.DegrausDeDesbloqueio = b.Lista<int>(ChaveDegrausDeDesbloqueio);
            b.Nivelamento = b.Objeto<Nivelamento>(ChaveNivelamento);
            b.Cartas = b.Mapa<CartaDeClasse>(ChaveCartas);
            b.Estrelas = b.Objeto<Estrelas>(ChaveEstrelas);

            b.Monstros = b.Mapa<Monstro>(ChaveMonstros);
            b.InvocadosDeFusao = b.Mapa<Monstro>(ChaveInvocadosDeFusao);
            b.Bichos = b.Mapa<Bicho>(ChaveBichos);

            return b;
        }

        // ---- leitura -------------------------------------------------------

        string Texto(string chave)
        {
            return _fonte.Ler(chave);
        }

        /// <summary>
        /// Envelopa o erro do Newtonsoft com o nome da chave. Sem isso a
        /// mensagem é "Unexpected character at line 1" e não diz QUAL dos vinte
        /// e cinco arquivos veio quebrado.
        /// </summary>
        static T Protegido<T>(string chave, Func<T> leitura)
        {
            try
            {
                return leitura();
            }
            catch (Exception e)
            {
                throw new FormatException("chave '" + chave + "' não pôde ser lida: " + e.Message, e);
            }
        }

        Dictionary<string, T> Mapa<T>(string chave)
        {
            var txt = Texto(chave);
            if (txt == null)
            {
                ChavesAusentes.Add(chave);
                var vazio = new Dictionary<string, T>();
                _contagens[chave] = () => vazio.Count;
                return vazio;
            }
            var m = Protegido(chave, () => Json.Mapa<T>(txt));
            _contagens[chave] = () => m.Count;
            return m;
        }

        List<T> Lista<T>(string chave)
        {
            var txt = Texto(chave);
            if (txt == null)
            {
                ChavesAusentes.Add(chave);
                var vazia = new List<T>();
                _contagens[chave] = () => vazia.Count;
                return vazia;
            }
            var l = Protegido(chave, () => Json.Lista<T>(txt));
            _contagens[chave] = () => l.Count;
            return l;
        }

        /// <summary>
        /// Chave que é um objeto SÓ (<c>upgrade</c>, <c>leveling</c>,
        /// <c>lootWeights</c>, <c>stars</c>). No manifesto ela conta como número
        /// de campos do objeto, não como "1" — é a mesma regra do §4 aplicada
        /// sem exceção.
        /// </summary>
        T Objeto<T>(string chave) where T : class, new()
        {
            var txt = Texto(chave);
            if (txt == null)
            {
                ChavesAusentes.Add(chave);
                _contagens[chave] = () => 0;
                return new T();
            }
            var o = Protegido(chave, () => Json.Objeto<T>(txt)) ?? new T();
            int campos = Protegido(chave, () => Json.ContaTopo(txt));
            _contagens[chave] = () => campos;
            return o;
        }

        // ---- consultas -----------------------------------------------------

        /// <summary>
        /// Procura o feitiço nas cinco tabelas, na ordem em que o motor JS
        /// procura. As tabelas NÃO são mescladas de propósito: mesclar deixaria
        /// um id de item apagar um id de classe em silêncio.
        /// </summary>
        public Feitico AchaFeitico(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            Feitico f;
            if (Feiticos.TryGetValue(id, out f)) return f;
            if (FeiticosDeMonstro.TryGetValue(id, out f)) return f;
            if (FeiticosDeBicho.TryGetValue(id, out f)) return f;
            if (FeiticosDeItem.TryGetValue(id, out f)) return f;
            if (FeiticosDeFusao.TryGetValue(id, out f)) return f;
            return null;
        }

        public Calabouco AchaCalabouco(string id)
        {
            for (int i = 0; i < Calabocos.Count; i++)
                if (Calabocos[i].Id == id) return Calabocos[i];
            return null;
        }

        /// <summary>Quantos itens a chave rendeu depois de lida. −1 se a chave é desconhecida.</summary>
        public int Conta(string chave)
        {
            Func<int> f;
            return _contagens.TryGetValue(chave, out f) ? f() : -1;
        }

        // ---- conferência ---------------------------------------------------

        /// <summary>
        /// Confere TODA chave declarada no manifesto — inclusive as que esta
        /// rodada não modelou, contando o topo do JSON cru.
        ///
        /// São duas contas por chave modelada, de propósito: o topo do JSON
        /// pega arquivo truncado, e a coleção já lida pega perda na modelagem
        /// (id repetido que colapsa no dicionário, por exemplo). Conferir só uma
        /// deixa metade dos defeitos passar.
        ///
        /// Devolve a lista de divergências em português. Vazia = acervo íntegro.
        /// </summary>
        public IList<string> ConfereContraManifesto()
        {
            var problemas = new List<string>();
            if (Manifesto == null)
            {
                problemas.Add("não há manifesto para conferir");
                return problemas;
            }

            foreach (var par in Manifesto.Chaves)
            {
                string chave = par.Key;
                int declarado = par.Value;

                var txt = Texto(chave);
                if (txt == null)
                {
                    problemas.Add("chave '" + chave + "': o manifesto declara " + declarado +
                                  ", mas o arquivo não existe");
                    continue;
                }

                int cru = Protegido(chave, () => Json.ContaTopo(txt));
                if (cru != declarado)
                {
                    problemas.Add("chave '" + chave + "': o manifesto declara " + declarado +
                                  ", o arquivo tem " + cru);
                    continue;
                }

                int lido = Conta(chave);
                if (lido >= 0 && lido != declarado)
                {
                    problemas.Add("chave '" + chave + "': o arquivo tem " + declarado +
                                  ", mas a leitura em C# rendeu " + lido +
                                  " — a modelagem está perdendo entrada");
                }
            }

            return problemas;
        }

        /// <summary>
        /// Chaves que esta camada modela e que o manifesto NÃO declara.
        ///
        /// É o buraco que <see cref="ConfereContraManifesto"/> não vê: aquele
        /// método só confere o que o manifesto lista, então uma chave que o
        /// exportador esqueceu de escrever passaria sem uma linha de aviso —
        /// justamente o caso em que a coleção fica vazia e o jogo sobe sem ela.
        /// </summary>
        public IList<string> ChavesModeladasForaDoManifesto()
        {
            var fora = new List<string>();
            if (Manifesto == null) return fora;

            for (int i = 0; i < ChavesModeladas.Length; i++)
                if (!Manifesto.Chaves.ContainsKey(ChavesModeladas[i]))
                    fora.Add(ChavesModeladas[i]);

            return fora;
        }
    }
}
