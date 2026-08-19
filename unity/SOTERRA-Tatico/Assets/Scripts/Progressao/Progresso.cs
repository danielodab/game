using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Soterra.Dados;

namespace Soterra.Progressao
{
    /// <summary>
    /// O laço do jogo fora da batalha: XP, nível, caminho elemental, feitiços,
    /// saco do grupo, equipamento, forja e estrelas de classe.
    ///
    /// É a tradução de <c>js/core/progress.js</c> (1.665 linhas). C# puro e sem
    /// <c>MonoBehaviour</c> de propósito: subir de nível, equipar e forjar são
    /// contas, não comportamento de cena — assim tudo isto se cobra num teste
    /// EditMode, em milissegundos, sem abrir o Editor.
    ///
    /// TODO número sai de <c>Assets/Resources/dados/</c>. A tabela de XP, os
    /// degraus dos feitiços, o custo das estrelas, o multiplicador da forja e a
    /// lista de atributos que a forja não escala são LIDOS, nunca escritos aqui:
    /// foi listando degraus na mão que a escada de feitiço do JS ficou com
    /// buraco quando o acervo ganhou os níveis 10 e 15.
    ///
    /// O que NÃO existe nesta classe, e a ausência é decisão: a trilha de
    /// estrela de ITEM (3 iguais = ★1) descrita numa versão antiga do
    /// SISTEMAS §8. Ela não está em nenhum JSON do acervo — era plano nunca
    /// construído, e implementá-la seria inventar economia. A estrela que existe
    /// é de CLASSE, vem de carta excedente e mora em <c>stars.json</c>.
    /// </summary>
    public sealed partial class Progresso
    {
        /// <summary>
        /// Chave do save. A mesma do JS por continuidade de nome — no WebGL o
        /// <c>PlayerPrefs</c> É o <c>localStorage</c>, e ver as duas versões com
        /// nomes diferentes na mesma origem confundiria quem depura.
        /// </summary>
        public const string ChaveDeSave = "soterra-save-v2";

        /// <summary>
        /// Os quatro espaços, com os nomes próprios do jogo (SISTEMAS §8).
        /// A ORDEM importa: é a ordem em que a ficha soma os itens e em que a
        /// tela os desenha.
        /// </summary>
        public static readonly string[] Espacos = { "punho", "passo", "casca", "lume" };

        /// <summary>O único espaço que concede feitiço.</summary>
        public const string EspacoDoFeitico = "lume";

        /// <summary>
        /// Teto de contribuição de UMA fonte em PA e PP.
        ///
        /// PA e PP são o esqueleto do turno: com +2 PA um herói lança um feitiço
        /// a mais por turno todo turno, e a conta de dano do jogo inteiro deixa
        /// de valer. Nem a forja nem a estrela furam este teto — a forja porque
        /// <c>upgrade.nonScalingKeys</c> a proíbe de escalar pa/pp, e a estrela
        /// porque o bônus dela é FIXO e vale exatamente +1 no ★3 e no ★5.
        /// </summary>
        public const int TetoDePaPorFonte = 1;
        public const int TetoDePpPorFonte = 1;

        /// <summary>Nível da escolha de elemento quando o acervo não o traz (o padrão do JS).</summary>
        const int NivelDeEscolhaPadrao = 5;

        static readonly string[] AtributosDeFicha =
            { "hp", "pa", "pp", "power", "initiative", "dodge", "lock" };

        readonly BancoDeDados _banco;
        readonly IArmazem _armazem;

        /// <summary>O acervo de onde toda regra é lida.</summary>
        public BancoDeDados Banco { get { return _banco; } }

        /// <summary>O estado persistido. Nunca é nulo depois do construtor.</summary>
        public EstadoDeProgresso Estado { get; private set; }

        Progresso(BancoDeDados banco, IArmazem armazem)
        {
            if (banco == null) throw new ArgumentNullException("banco");
            _banco = banco;
            _armazem = armazem ?? new ArmazemSurdo();
        }

        // =================================================== carregar e salvar

        /// <summary>
        /// Lê o save. Save ausente, ilegível ou com lixo dentro NUNCA derruba o
        /// jogo: o que der para aproveitar é aproveitado e o resto vira estado
        /// novo. É a mesma lei do <c>[D2]</c> do JS, e existe porque o save é o
        /// único arquivo do jogo que um humano pode editar à mão.
        ///
        /// <see cref="Carregar"/> NÃO grava. Um jogo que salva ao abrir apaga o
        /// progresso de quem abriu com o disco cheio.
        /// </summary>
        public static Progresso Carregar(BancoDeDados banco, IArmazem armazem)
        {
            var p = new Progresso(banco, armazem);
            EstadoDeProgresso cru = null;
            var texto = p._armazem.Ler(ChaveDeSave);
            if (!string.IsNullOrEmpty(texto))
            {
                try { cru = JsonConvert.DeserializeObject<EstadoDeProgresso>(texto); }
                catch (Exception) { cru = null; }   // save corrompido = save ausente
            }
            p.Estado = p.Sanear(cru);
            return p;
        }

        /// <summary>Atalho de produção: o save mora em <c>PlayerPrefs</c>.</summary>
        public static Progresso Carregar(BancoDeDados banco)
        {
            return Carregar(banco, new ArmazemDePlayerPrefs());
        }

        /// <summary>Estado novo em folha, sem ler o que estiver gravado.</summary>
        public static Progresso DoZero(BancoDeDados banco, IArmazem armazem)
        {
            var p = new Progresso(banco, armazem);
            p.Estado = p.Sanear(null);
            return p;
        }

        /// <summary>
        /// Grava. Devolve <c>false</c> quando o armazém recusou — quem quiser
        /// avisar o jogador olha o retorno; ninguém precisa proteger a chamada.
        /// </summary>
        public bool Salvar()
        {
            string texto;
            try { texto = JsonConvert.SerializeObject(Estado); }
            catch (Exception) { return false; }
            return _armazem.Gravar(ChaveDeSave, texto);
        }

        /// <summary>Apaga o progresso e grava o estado novo por cima.</summary>
        public EstadoDeProgresso Recomecar()
        {
            Estado = Sanear(null);
            Salvar();
            return Estado;
        }

        // ---------------------------------------------------------- saneamento

        /// <summary>
        /// Reconstrói o estado campo a campo. Nada do save entra sem passar por
        /// aqui.
        ///
        /// A regra é: o que não bate com o ACERVO é descartado em silêncio, não
        /// corrigido por adivinhação. Classe que não existe mais, item que saiu
        /// do jogo, peça no espaço errado, elemento fora dos cinco, forja acima
        /// do teto — tudo isso é lixo, e lixo aceito vira defeito três telas
        /// adiante, longe da causa.
        /// </summary>
        EstadoDeProgresso Sanear(EstadoDeProgresso cru)
        {
            var st = new EstadoDeProgresso();
            var classes = _banco.Classes ?? new Dictionary<string, Classe>();
            var conhecidas = classes.Count > 0;

            Func<string, bool> classeOk = cid =>
                !string.IsNullOrEmpty(cid) && (!conhecidas || classes.ContainsKey(cid));

            // ---- classes liberadas
            var vistas = new HashSet<string>();
            if (cru != null && cru.ClassesLiberadas != null)
            {
                foreach (var cid in cru.ClassesLiberadas)
                    if (classeOk(cid) && vistas.Add(cid)) st.ClassesLiberadas.Add(cid);
            }
            // O DADO manda quem já nasce liberada: `startsUnlocked`. Fixar as duas
            // classes iniciais no código faria uma terceira classe grátis exigir
            // recompilar o jogo.
            foreach (var par in classes)
            {
                if (par.Value != null && par.Value.JaLiberada && vistas.Add(par.Key))
                    st.ClassesLiberadas.Add(par.Key);
            }

            // ---- saco
            if (cru != null && cru.Saco != null)
            {
                foreach (var c in cru.Saco)
                {
                    if (c == null || AchaItem(c.IdDoItem) == null) continue;
                    st.Saco.Add(new CopiaDeItem(c.IdDoItem, LimitaForja(c.NivelDeForja)));
                }
            }

            // ---- heróis
            if (cru != null && cru.Herois != null)
            {
                foreach (var par in cru.Herois)
                {
                    var origem = par.Value;
                    if (origem == null) continue;

                    // O id do herói é o id da classe por padrão; um save antigo
                    // pode trazer a classe só na chave.
                    var classeId = classeOk(origem.IdDaClasse) ? origem.IdDaClasse
                                 : (classeOk(par.Key) ? par.Key : null);
                    if (classeId == null) continue;

                    var h = NovaFicha(classeId);
                    h.Xp = Math.Max(0, origem.Xp);
                    var teto = XpMaxima();
                    if (teto > 0) h.Xp = Math.Min(h.Xp, teto);

                    SaneiaElemento(h, origem.Elemento, classes);
                    SaneiaEquipamento(h, origem);

                    if (!string.IsNullOrEmpty(origem.Bicho) && AchaBicho(origem.Bicho) != null)
                        h.Bicho = origem.Bicho;

                    st.Herois[par.Key] = h;
                    if (vistas.Add(classeId)) st.ClassesLiberadas.Add(classeId);
                }
            }
            // Classe liberada sem ficha ganha uma: é a ficha padrão do [D3].
            foreach (var cid in st.ClassesLiberadas)
                if (!st.Herois.ContainsKey(cid)) st.Herois[cid] = NovaFicha(cid);

            // ---- bichos soltos (um bicho serve a um herói por vez)
            var comDono = new HashSet<string>();
            foreach (var h in st.Herois.Values)
                if (!string.IsNullOrEmpty(h.Bicho)) comDono.Add(h.Bicho);
            if (cru != null && cru.Bichos != null)
            {
                foreach (var pid in cru.Bichos)
                {
                    if (string.IsNullOrEmpty(pid) || AchaBicho(pid) == null) continue;
                    if (comDono.Contains(pid) || st.Bichos.Contains(pid)) continue;
                    st.Bichos.Add(pid);
                }
            }

            // ---- cartas
            if (cru != null && cru.Cartas != null)
            {
                foreach (var par in cru.Cartas)
                    if (classeOk(par.Key) && par.Value > 0) st.Cartas[par.Key] = par.Value;
            }

            // ---- pedras
            if (cru != null && cru.Pedras != null)
            {
                var pedras = _banco.Pedras ?? new Dictionary<string, Pedra>();
                foreach (var par in cru.Pedras)
                {
                    if (par.Value <= 0) continue;
                    if (pedras.Count > 0 && !pedras.ContainsKey(par.Key)) continue;
                    st.Pedras[par.Key] = par.Value;
                }
            }

            Estado = st;              // as consultas abaixo dependem do estado montado
            SincronizarLiberacoesPorCarta(st);
            return st;
        }

        void SaneiaElemento(FichaDeHeroi h, string elemento, IDictionary<string, Classe> classes)
        {
            if (string.IsNullOrEmpty(elemento) || elemento == Dados.Elemento.Neutro) return;

            var elementos = _banco.Elementos;
            if (elementos != null && elementos.Count > 0 && !elementos.Contains(elemento)) return;

            Classe def;
            if (classes.TryGetValue(h.IdDaClasse, out def) && def != null && def.Caminhos != null &&
                def.Caminhos.Count > 0 && !def.Caminhos.ContainsKey(elemento)) return;

            // Elemento gravado por quem ainda não tinha nível para escolher é
            // save adulterado — o nível manda, não o texto.
            if (NivelPorXp(h.Xp) < NivelDaEscolhaDeElemento) return;

            h.Elemento = elemento;
        }

        void SaneiaEquipamento(FichaDeHeroi h, FichaDeHeroi origem)
        {
            if (origem.Itens == null) return;
            foreach (var par in origem.Itens)
            {
                var espaco = par.Key;
                if (Array.IndexOf(Espacos, espaco) < 0) continue;

                var item = AchaItem(par.Value);
                // Peça no espaço errado é descartada em vez de remanejada: um
                // punho que virasse casca somaria bônus de arma na armadura.
                if (item == null || item.Espaco != espaco) continue;

                int nivel = 0;
                if (origem.NivelDoItem != null) origem.NivelDoItem.TryGetValue(espaco, out nivel);
                h.Itens[espaco] = par.Value;
                h.NivelDoItem[espaco] = LimitaForja(nivel);
            }
        }

        FichaDeHeroi NovaFicha(string classeId)
        {
            return new FichaDeHeroi { IdDaClasse = classeId, Elemento = Dados.Elemento.Neutro, Xp = 0 };
        }

        // ============================================================ consultas

        public FichaDeHeroi Heroi(string heroiId)
        {
            if (string.IsNullOrEmpty(heroiId)) return null;
            FichaDeHeroi h;
            return Estado.Herois.TryGetValue(heroiId, out h) ? h : null;
        }

        public IList<string> IdsDeHeroi()
        {
            return new List<string>(Estado.Herois.Keys);
        }

        public bool ClasseLiberada(string classeId)
        {
            return !string.IsNullOrEmpty(classeId) && Estado.ClassesLiberadas.Contains(classeId);
        }

        /// <summary>A ficha, criada sob demanda se o id for de uma classe conhecida.</summary>
        FichaDeHeroi GarantirHeroi(string heroiId)
        {
            var h = Heroi(heroiId);
            if (h != null) return h;
            if (AchaClasse(heroiId) == null) return null;
            h = NovaFicha(heroiId);
            Estado.Herois[heroiId] = h;
            return h;
        }

        /// <summary>
        /// Ficha extra da mesma classe (o segundo Bárbaro). O id sai
        /// <c>classe#2</c>, <c>classe#3</c>… quando o padrão já está ocupado.
        /// </summary>
        public string CriarHeroi(string classeId)
        {
            if (AchaClasse(classeId) == null || !ClasseLiberada(classeId)) return null;
            var id = classeId;
            int n = 2;
            while (Estado.Herois.ContainsKey(id)) id = classeId + "#" + (n++);
            Estado.Herois[id] = NovaFicha(classeId);
            Salvar();
            return id;
        }

        // ========================================================= XP e níveis

        Nivelamento Niv
        {
            get { return _banco.Nivelamento ?? new Nivelamento(); }
        }

        /// <summary>Último nível alcançável: o menor entre o declarado e o tamanho da tabela.</summary>
        public int NivelMaximo()
        {
            var n = Niv;
            var linhas = n.TabelaDeXp == null ? 0 : n.TabelaDeXp.Count;
            if (linhas <= 0) return 1;
            return n.NivelMaximo > 0 ? Math.Min(n.NivelMaximo, linhas) : linhas;
        }

        /// <summary>XP do último degrau. Acima disso a XP não acumula.</summary>
        public int XpMaxima()
        {
            var n = Niv;
            var topo = NivelMaximo();
            if (n.TabelaDeXp == null || n.TabelaDeXp.Count < topo) return 0;
            return n.TabelaDeXp[topo - 1];
        }

        /// <summary>
        /// A tabela é ACUMULADA: o índice 0 é o nível 1 (zero de XP) e o índice
        /// 29 é o nível 30. Ler como "XP do próximo nível" desloca a curva
        /// inteira em um degrau — e ninguém percebe até o nível 30 chegar cedo
        /// demais.
        /// </summary>
        public int NivelPorXp(int xp)
        {
            var tabela = Niv.TabelaDeXp;
            if (tabela == null || tabela.Count == 0) return 1;
            var topo = NivelMaximo();
            for (int i = topo - 1; i >= 0; i--)
                if (xp >= tabela[i]) return i + 1;
            return 1;
        }

        public int NivelDe(string heroiId)
        {
            var h = Heroi(heroiId);
            return h == null ? 0 : NivelPorXp(h.Xp);
        }

        /// <summary>Devolve quantos NÍVEIS o herói subiu com esta XP (0 se nenhum).</summary>
        public int AdicionarXp(string heroiId, int quantidade)
        {
            var h = GarantirHeroi(heroiId);
            if (h == null || quantidade <= 0) return 0;
            var antes = NivelPorXp(h.Xp);
            var teto = XpMaxima();
            h.Xp = teto > 0 ? Math.Min(h.Xp + quantidade, teto) : h.Xp + quantidade;
            var depois = NivelPorXp(h.Xp);
            Salvar();
            return depois - antes;
        }

        /// <summary>Quanto falta para o próximo degrau, para a barra da tela.</summary>
        public InfoDeXp XpDe(string heroiId)
        {
            var h = Heroi(heroiId);
            if (h == null) return null;
            var tabela = Niv.TabelaDeXp;
            var nivel = NivelPorXp(h.Xp);
            var topo = NivelMaximo();
            if (nivel >= topo || tabela == null || tabela.Count <= nivel)
                return new InfoDeXp { Nivel = nivel, Xp = h.Xp, XpDoProximo = -1, Fracao = 1.0 };

            var atual = tabela[nivel - 1];
            var proximo = tabela[nivel];
            var fracao = proximo > atual ? (h.Xp - atual) / (double)(proximo - atual) : 1.0;
            return new InfoDeXp
            {
                Nivel = nivel,
                Xp = h.Xp,
                XpDoProximo = proximo,
                Fracao = Math.Max(0.0, Math.Min(1.0, fracao))
            };
        }

        /// <summary>
        /// Rendimento decrescente em calabouço fácil demais.
        ///
        /// Vale SÓ para XP: item, pedra e carta seguem a raridade deles. Faltando
        /// <c>recommendedLevel</c> ou <c>xpFalloff</c> no acervo devolve 1 —
        /// nunca corta por engano, porque cortar por dado ausente é castigar o
        /// jogador por um arquivo que ainda não chegou.
        /// </summary>
        public double MultiplicadorDeXp(int nivel, string calabocoId)
        {
            var calabouco = _banco.AchaCalabouco(calabocoId);
            var queda = Niv.QuedaDeXp;
            if (calabouco == null || queda == null || calabouco.NivelRecomendado <= 0) return 1.0;

            var acima = nivel - (calabouco.NivelRecomendado + queda.NiveisDeGraca);
            if (acima <= 0) return 1.0;
            var m = Math.Pow(queda.FatorPorNivel, acima);
            return Math.Max(queda.Piso, m);
        }

        // =================================================== caminho elemental

        public int NivelDaEscolhaDeElemento
        {
            get
            {
                var n = Niv.NivelDaEscolhaDeElemento;
                return n > 0 ? n : NivelDeEscolhaPadrao;
            }
        }

        /// <summary>O herói chegou ao nível da escolha e ainda é neutro.</summary>
        public bool EscolhaDeElementoPendente(string heroiId)
        {
            var h = Heroi(heroiId);
            if (h == null) return false;
            return h.Elemento == Dados.Elemento.Neutro && NivelPorXp(h.Xp) >= NivelDaEscolhaDeElemento;
        }

        public IList<string> EscolhasDeElementoPendentes(IEnumerable<string> heroiIds)
        {
            var fonte = heroiIds ?? IdsDeHeroi();
            var fora = new List<string>();
            foreach (var id in fonte) if (EscolhaDeElementoPendente(id)) fora.Add(id);
            return fora;
        }

        /// <summary>
        /// Escolhe o caminho elemental. É PARA SEMPRE.
        ///
        /// A permanência é a regra, não um detalhe de tela: os feitiços dos
        /// outros três caminhos ficam apagados para o resto da partida, e é o
        /// que dá peso à decisão. Um segundo <c>EscolherElemento</c> devolve
        /// <c>false</c> e não muda nada — nem para o mesmo elemento, porque
        /// aceitar "trocar para o que já é" convidaria a tela a chamar em laço.
        /// </summary>
        public bool EscolherElemento(string heroiId, string elemento)
        {
            var h = Heroi(heroiId);
            if (h == null) return false;
            if (h.Elemento != Dados.Elemento.Neutro) return false;          // já escolheu: acabou
            if (NivelPorXp(h.Xp) < NivelDaEscolhaDeElemento) return false;
            if (string.IsNullOrEmpty(elemento) || elemento == Dados.Elemento.Neutro) return false;

            var elementos = _banco.Elementos;
            if (elementos != null && elementos.Count > 0 && !elementos.Contains(elemento)) return false;

            var def = AchaClasse(h.IdDaClasse);
            if (def != null && def.Caminhos != null && def.Caminhos.Count > 0 &&
                !def.Caminhos.ContainsKey(elemento)) return false;

            h.Elemento = elemento;
            Salvar();
            return true;
        }

        // ============================================================= acervo

        internal Classe AchaClasse(string id)
        {
            Classe c;
            return (!string.IsNullOrEmpty(id) && _banco.Classes != null &&
                    _banco.Classes.TryGetValue(id, out c)) ? c : null;
        }

        internal Item AchaItem(string id)
        {
            Item it;
            return (!string.IsNullOrEmpty(id) && _banco.Itens != null &&
                    _banco.Itens.TryGetValue(id, out it)) ? it : null;
        }

        internal Bicho AchaBicho(string id)
        {
            Bicho b;
            return (!string.IsNullOrEmpty(id) && _banco.Bichos != null &&
                    _banco.Bichos.TryGetValue(id, out b)) ? b : null;
        }

        internal CartaDeClasse AchaCarta(string classeId)
        {
            CartaDeClasse c;
            return (!string.IsNullOrEmpty(classeId) && _banco.Cartas != null &&
                    _banco.Cartas.TryGetValue(classeId, out c)) ? c : null;
        }

        /// <summary>
        /// O arredondamento do JS, e não o do C#.
        ///
        /// <c>Math.Round</c> da biblioteca padrão arredonda ao PAR (2,5 vira 2);
        /// o <c>Math.round</c> do JS arredonda para cima (2,5 vira 3). Usar o do
        /// C# faria a mesma peça forjada valer um ponto a menos aqui do que no
        /// jogo em JS, em toda casa que caísse na metade exata — divergência
        /// pequena, constante, e impossível de rastrear meses depois.
        /// </summary>
        internal static int ArredondaComoNoJs(double v)
        {
            return (int)Math.Floor(v + 0.5);
        }
    }

    /// <summary>Onde o herói está na curva de XP.</summary>
    public sealed class InfoDeXp
    {
        public int Nivel;
        public int Xp;

        /// <summary>XP acumulada do próximo degrau, ou <c>-1</c> no nível máximo.</summary>
        public int XpDoProximo;

        /// <summary>Fração do degrau atual, de 0 a 1. Vale 1 no nível máximo.</summary>
        public double Fracao;
    }
}
