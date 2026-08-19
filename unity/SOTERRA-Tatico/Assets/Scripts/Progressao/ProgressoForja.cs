using System;
using System.Collections.Generic;
using Soterra.Dados;

namespace Soterra.Progressao
{
    /// <summary>O que custa subir uma peça um degrau, e se dá para pagar agora.</summary>
    public sealed class InfoDeForja
    {
        public string IdDoItem;
        public int Nivel;

        /// <summary>Comum, Raro, Supremo ou Magnífico — a faixa vem de <c>upgrade.tiers</c>.</summary>
        public string NomeDaFaixa;

        public int Custo;
        public string IdDaPedra;
        public bool TemPedras;

        /// <summary>No <c>+10</c>: não há mais degrau, e o custo é 0.</summary>
        public bool NoMaximo;
    }

    /// <summary>A coleção de uma classe: cartas, desbloqueio e estrelas.</summary>
    public sealed class InfoDeCarta
    {
        public string IdDaClasse;
        public string Nome;
        public int Cartas;
        public bool Liberada;
        public int CustoDeDesbloqueio;
        public int Estrelas;

        /// <summary>Próxima estrela a conquistar, ou 0 quando já está no ★ máximo.</summary>
        public int ProximaEstrela;

        /// <summary>Cartas excedentes que ainda faltam para a próxima estrela.</summary>
        public int CartasQueFaltam;
    }

    public sealed partial class Progresso
    {
        Forja ForjaCfg
        {
            get { return _banco.Forja ?? new Forja(); }
        }

        /// <summary>O <c>+10</c> do acervo. Sem dado nenhum, ninguém forja nada.</summary>
        public int NivelMaximoDeForja()
        {
            var f = ForjaCfg;
            var degraus = f.CustoEmPedras == null ? 0 : f.CustoEmPedras.Count;
            if (f.NivelMaximo > 0) return degraus > 0 ? Math.Min(f.NivelMaximo, degraus) : f.NivelMaximo;
            return degraus;
        }

        internal int LimitaForja(int v)
        {
            return Math.Max(0, Math.Min(NivelMaximoDeForja(), v));
        }

        /// <summary>
        /// O multiplicador dos bônus da peça: <c>1 + bonusPerLevel × nível</c>.
        /// Com o 0,12 do acervo, o <c>+10</c> vale 2,20× o item cru.
        /// </summary>
        public double MultiplicadorDeForja(int nivel)
        {
            return 1.0 + ForjaCfg.BonusPorNivel * Math.Max(0, nivel);
        }

        public string NomeDaFaixaDeForja(int nivel)
        {
            var faixas = ForjaCfg.Faixas;
            if (faixas == null || faixas.Count == 0) return string.Empty;
            for (int i = 0; i < faixas.Count; i++)
                if (nivel >= faixas[i].De && nivel <= faixas[i].Ate) return faixas[i].Nome;
            return faixas[faixas.Count - 1].Nome;
        }

        // ------------------------------------------------------------- pedras

        public bool AdicionarPedras(string pedraId, int quantidade)
        {
            if (string.IsNullOrEmpty(pedraId) || quantidade <= 0) return false;
            int n;
            Estado.Pedras.TryGetValue(pedraId, out n);
            Estado.Pedras[pedraId] = Math.Max(0, n) + quantidade;
            Salvar();
            return true;
        }

        public int ContarPedras(string pedraId)
        {
            int n;
            return (!string.IsNullOrEmpty(pedraId) && Estado.Pedras.TryGetValue(pedraId, out n))
                ? Math.Max(0, n) : 0;
        }

        /// <summary>A pedra do elemento pedido, pelo <c>element</c> de <c>stones.json</c>.</summary>
        public string PedraDoElemento(string elemento)
        {
            var alvo = string.IsNullOrEmpty(elemento) ? Dados.Elemento.Neutro : elemento;
            var pedras = _banco.Pedras;
            if (pedras != null)
                foreach (var par in pedras)
                    if (par.Value != null && par.Value.Elemento == alvo) return par.Key;
            // Sem acervo de pedras o próprio nome do elemento serve de id: é o
            // que permite testar a forja sem carregar `stones.json`.
            return alvo;
        }

        /// <summary>
        /// A pedra que ESTA peça consome: a do elemento dela.
        ///
        /// Peça neutra (ou sem elemento) aceita qualquer pedra e gasta a de MAIOR
        /// estoque — assim o jogador não fica com uma peça travada por não ter
        /// justamente a lasca neutra. O desempate é por ordem alfabética de id
        /// para a escolha ser reproduzível: com a ordem do dicionário, o mesmo
        /// save gastaria pedras diferentes em execuções diferentes.
        /// </summary>
        public string PedraDoItem(Item item)
        {
            var elemento = item == null ? null : item.Elemento;
            if (!string.IsNullOrEmpty(elemento) && elemento != Dados.Elemento.Neutro)
                return PedraDoElemento(elemento);

            var candidatas = new List<string>();
            if (_banco.Pedras != null && _banco.Pedras.Count > 0) candidatas.AddRange(_banco.Pedras.Keys);
            else candidatas.AddRange(Estado.Pedras.Keys);
            if (candidatas.Count == 0) return PedraDoElemento(Dados.Elemento.Neutro);

            candidatas.Sort(StringComparer.Ordinal);
            var melhor = candidatas[0];
            var maior = ContarPedras(melhor);
            for (int i = 1; i < candidatas.Count; i++)
            {
                var n = ContarPedras(candidatas[i]);
                if (n > maior) { maior = n; melhor = candidatas[i]; }
            }
            return melhor;
        }

        // -------------------------------------------------------------- forja

        InfoDeForja Orcamento(string itemId, int nivel)
        {
            var item = AchaItem(itemId);
            if (item == null) return null;

            var pedra = PedraDoItem(item);
            var teto = NivelMaximoDeForja();
            var atual = Math.Max(0, nivel);

            if (atual >= teto)
                return new InfoDeForja
                {
                    IdDoItem = itemId, Nivel = atual, NomeDaFaixa = NomeDaFaixaDeForja(atual),
                    Custo = 0, IdDaPedra = pedra, TemPedras = false, NoMaximo = true
                };

            var custos = ForjaCfg.CustoEmPedras;
            var custo = (custos != null && atual < custos.Count) ? Math.Max(0, custos[atual]) : 0;
            return new InfoDeForja
            {
                IdDoItem = itemId, Nivel = atual, NomeDaFaixa = NomeDaFaixaDeForja(atual),
                Custo = custo, IdDaPedra = pedra,
                TemPedras = ContarPedras(pedra) >= custo, NoMaximo = false
            };
        }

        public InfoDeForja InfoDeForjaNoSaco(int indiceNoSaco)
        {
            if (indiceNoSaco < 0 || indiceNoSaco >= Estado.Saco.Count) return null;
            var c = Estado.Saco[indiceNoSaco];
            return Orcamento(c.IdDoItem, c.NivelDeForja);
        }

        /// <summary>Forjar sem desequipar: a peça em uso também sobe.</summary>
        public InfoDeForja InfoDeForjaVestida(string heroiId, string espaco)
        {
            var v = Vestido(heroiId, espaco);
            return v == null ? null : Orcamento(v.IdDoItem, v.NivelDeForja);
        }

        bool PagarPedras(InfoDeForja info)
        {
            if (info == null || info.NoMaximo || !info.TemPedras) return false;
            Estado.Pedras[info.IdDaPedra] = ContarPedras(info.IdDaPedra) - info.Custo;
            return true;
        }

        /// <summary>
        /// Sobe UM degrau. Determinística: nunca quebra, nunca regride e nunca
        /// consome pedra sem subir. A forja é a trilha do poder bruto, e uma
        /// trilha que pode falhar transformaria o acúmulo de pedras em aposta.
        /// </summary>
        public bool Forjar(int indiceNoSaco)
        {
            var info = InfoDeForjaNoSaco(indiceNoSaco);
            if (!PagarPedras(info)) return false;
            Estado.Saco[indiceNoSaco].NivelDeForja = info.Nivel + 1;
            Salvar();
            return true;
        }

        public bool ForjarVestida(string heroiId, string espaco)
        {
            var h = Heroi(heroiId);
            var info = InfoDeForjaVestida(heroiId, espaco);
            if (h == null || !PagarPedras(info)) return false;
            h.NivelDoItem[espaco] = info.Nivel + 1;
            Salvar();
            return true;
        }

        // =============================================== cartas e estrelas de CLASSE

        /// <summary>
        /// Cartas para liberar a classe. Zero para quem já nasce liberada.
        ///
        /// Classe sem entrada em <c>cards.json</c> devolve <see cref="int.MaxValue"/>:
        /// ela não é liberável por carta nenhuma. Chutar um custo aqui seria
        /// inventar economia — e um custo inventado baixo abriria de graça uma
        /// classe que o acervo ainda nem terminou de descrever.
        /// </summary>
        public int CustoDeDesbloqueio(string classeId)
        {
            var def = AchaClasse(classeId);
            if (def != null && def.JaLiberada) return 0;
            var carta = AchaCarta(classeId);
            if (carta == null) return int.MaxValue;
            return Math.Max(0, carta.CustoDeDesbloqueio);
        }

        public int CartasDe(string classeId)
        {
            int n;
            return (!string.IsNullOrEmpty(classeId) && Estado.Cartas.TryGetValue(classeId, out n))
                ? Math.Max(0, n) : 0;
        }

        int MaximoDeEstrelas()
        {
            var e = _banco.Estrelas;
            return (e != null && e.Maximo > 0) ? e.Maximo : 0;
        }

        /// <summary>
        /// A coleção de uma classe. As cartas EXCEDENTES ao custo de desbloqueio
        /// compram estrelas — é por isso que carta repetida nunca é lixo.
        /// </summary>
        public InfoDeCarta InfoDeCarta(string classeId)
        {
            var def = AchaClasse(classeId);
            var carta = AchaCarta(classeId);
            var custo = CustoDeDesbloqueio(classeId);
            var tem = CartasDe(classeId);
            var custos = (carta != null && carta.CustoDasEstrelas != null)
                       ? carta.CustoDasEstrelas : new List<int>();
            var teto = Math.Min(MaximoDeEstrelas(), custos.Count);

            var excedente = custo == int.MaxValue ? 0 : Math.Max(0, tem - custo);
            int estrelas = 0;
            for (int i = 0; i < teto; i++)
                if (excedente >= custos[i]) estrelas = i + 1;

            var info = new InfoDeCarta
            {
                IdDaClasse = classeId,
                Nome = def != null && !string.IsNullOrEmpty(def.Nome) ? def.Nome : classeId,
                Cartas = tem,
                Liberada = ClasseLiberada(classeId),
                CustoDeDesbloqueio = custo,
                Estrelas = estrelas,
                ProximaEstrela = 0,
                CartasQueFaltam = 0
            };
            if (estrelas < teto)
            {
                info.ProximaEstrela = estrelas + 1;
                info.CartasQueFaltam = Math.Max(0, custos[estrelas] - excedente);
            }
            return info;
        }

        /// <summary>Soma dos bônus FIXOS das estrelas já conquistadas.</summary>
        internal List<Bonus> BonusDeEstrelas(string classeId)
        {
            var fora = new List<Bonus>();
            var cfg = _banco.Estrelas;
            if (cfg == null || cfg.Bonus == null) return fora;
            var estrelas = InfoDeCarta(classeId).Estrelas;
            for (int s = 1; s <= estrelas; s++)
            {
                Bonus b;
                if (cfg.Bonus.TryGetValue(s, out b) && b != null) fora.Add(b);
            }
            return fora;
        }

        public bool LiberarClasse(string classeId)
        {
            if (!LiberarClasseSemSalvar(classeId)) return false;
            Salvar();
            return true;
        }

        bool LiberarClasseSemSalvar(string classeId)
        {
            if (string.IsNullOrEmpty(classeId)) return false;
            if (_banco.Classes != null && _banco.Classes.Count > 0 && AchaClasse(classeId) == null)
                return false;
            if (Estado.ClassesLiberadas.Contains(classeId)) return false;
            Estado.ClassesLiberadas.Add(classeId);
            if (!Estado.Herois.ContainsKey(classeId)) Estado.Herois[classeId] = NovaFicha(classeId);
            return true;
        }

        /// <summary>
        /// Soma cartas e libera a classe ao atingir o custo. O total NUNCA
        /// decresce: gastar carta para subir estrela apagaria o desbloqueio de
        /// quem já pagou por ele.
        /// </summary>
        public InfoDeCarta AdicionarCartas(string classeId, int quantidade)
        {
            if (string.IsNullOrEmpty(classeId)) return null;
            if (_banco.Classes != null && _banco.Classes.Count > 0 && AchaClasse(classeId) == null)
                return null;
            if (quantidade > 0)
            {
                Estado.Cartas[classeId] = CartasDe(classeId) + quantidade;
                if (Estado.Cartas[classeId] >= CustoDeDesbloqueio(classeId))
                    LiberarClasseSemSalvar(classeId);
                Salvar();
            }
            return InfoDeCarta(classeId);
        }

        /// <summary>
        /// Ao carregar, cartas suficientes já valem como classe liberada.
        ///
        /// Sem isto, um save antigo com 25 cartas do Batedor mostraria a classe
        /// trancada — o jogador pagou e não recebeu, e o único jeito de reparar
        /// seria derrubar mais uma carta.
        /// </summary>
        void SincronizarLiberacoesPorCarta(EstadoDeProgresso st)
        {
            foreach (var par in st.Cartas)
                if (par.Value >= CustoDeDesbloqueio(par.Key)) LiberarClasseSemSalvar(par.Key);
        }
    }
}
