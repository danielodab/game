using System;
using System.Collections.Generic;
using UnityEngine;
using Soterra.Grade;

namespace Soterra.Motor
{
    /// <summary>Em que pé está a batalha.</summary>
    public enum FaseDaBatalha { EmAndamento, Vitoria, Derrota }

    /// <summary>
    /// A regra do combate. C# puro: nenhum <c>MonoBehaviour</c>, nenhuma cena,
    /// nenhum <c>Resources.Load</c> — é o que deixa a batalha inteira rodar em
    /// teste EditMode, em milissegundos.
    ///
    /// A fonte é <c>js/core/engine.js</c>. Onde o documento discordar do código,
    /// o código está certo; onde ESTA classe discordar do <c>engine.js</c>, está
    /// no relatório da rodada — nada foi decidido em silêncio.
    ///
    /// Não reescreve nada de <see cref="Soterra.Grade"/>: mapa, alcance de passo,
    /// linha de visão, alcance e área já existem e são testados. Aqui mora só o
    /// que a grade não sabe — de quem é a vez, quanto custa, quem está de que
    /// lado e quem morreu.
    ///
    /// Não há <c>using Soterra.Dados</c> de propósito: aquele namespace também
    /// tem um <c>Lado</c> (o alvo do feitiço: self/ally/enemy/any) e o daqui é
    /// outro (herói/monstro). Importar os dois deixaria `Lado` ambíguo em toda
    /// linha; qualificar `Dados.` custa cinco letras e diz de qual se fala.
    /// </summary>
    public sealed partial class Batalha
    {
        /// <summary>PV que um tique de clima dá ou tira (<c>Engine.WEATHER_TICK</c>).</summary>
        public const int TiqueDeClima = 5;

        /// <summary>% de dano recebido a mais por pilha de marca, quando o dado omite.</summary>
        public const int ValorPadraoDaMarca = 5;

        /// <summary>Pilhas máximas de marca, quando o dado omite.</summary>
        public const int MaximoPadraoDeMarcas = 5;

        // ---- estado ---------------------------------------------------------

        public Mapa Mapa { get; private set; }

        /// <summary>
        /// Todo mundo, JÁ NA ORDEM DE INICIATIVA. Inclui morto e quem saiu do
        /// tabuleiro — a interface desenha a fila inteira, com os caídos
        /// apagados, e retirar da lista faria a fila pular de lugar a cada morte.
        /// </summary>
        /// <summary>
        /// As unidades na ordem em que NASCERAM, que e a ordem do desenho da
        /// sala. Quem montou a batalha conta com isso: o primeiro heroi e o
        /// primeiro `P` do texto.
        /// </summary>
        public IReadOnlyList<Unidade> Unidades { get { return _nascimento; } }

        /// <summary>
        /// A fila de iniciativa. Lista SEPARADA de propria: uma so servindo aos
        /// dois papeis obrigava quem monta a batalha a procurar o heroi por
        /// busca, e obrigava a interface a desenhar a fila fora de ordem. Cada
        /// uma responde por uma pergunta.
        /// </summary>
        public IReadOnlyList<Unidade> Ordem { get { return _unidades; } }

        /// <summary>De quem é a vez. <c>null</c> só se a batalha estiver vazia.</summary>
        public Unidade Atual
        {
            get
            {
                if (_unidades.Count == 0) return null;
                return _unidades[Mathf.Clamp(_indice, 0, _unidades.Count - 1)];
            }
        }

        public int Rodada { get; private set; }

        /// <summary>Clima da sala. Indexa <c>DATA.weathers</c>.</summary>
        public string Clima { get; set; }

        public FaseDaBatalha Fase { get; private set; }

        /// <summary>
        /// Os eventos do primeiro turno, que acontecem dentro do construtor.
        ///
        /// Sem isto o tique de clima e o veneno de quem abre a batalha
        /// aconteceriam sem ninguém para narrá-los: um construtor não devolve
        /// <see cref="Resultado"/>, e a interface só entra na conversa na
        /// primeira ação do jogador.
        /// </summary>
        public Resultado Abertura { get; private set; }

        readonly Dados.BancoDeDados _banco;
        readonly List<Unidade> _unidades = new List<Unidade>();   // por iniciativa
        readonly List<Unidade> _nascimento = new List<Unidade>(); // como chegaram
        readonly Sorte _sorte;
        int _indice;
        Resultado _r;

        /// <summary>
        /// Monta a batalha e JÁ COMEÇA o turno de quem tem mais iniciativa.
        ///
        /// Começar o turno aqui não é atalho: PA e PP enchem no começo do turno
        /// DA UNIDADE, e se o primeiro turno não começasse, a primeira unidade
        /// jogaria com o que quer que o montador tenha deixado nos campos.
        ///
        /// O construtor não está no contrato — ele declara os campos e os
        /// métodos, não como a batalha nasce. Esta é a forma escolhida; está no
        /// relatório.
        /// </summary>
        public Batalha(Dados.BancoDeDados banco, Mapa mapa, IEnumerable<Unidade> unidades,
                       string clima = null, Sorte sorte = null)
        {
            if (banco == null) throw new ArgumentNullException("banco");
            if (mapa == null) throw new ArgumentNullException("mapa");
            if (unidades == null) throw new ArgumentNullException("unidades");

            _banco = banco;
            Mapa = mapa;
            Clima = string.IsNullOrEmpty(clima) ? "calmo" : clima;
            Rodada = 1;
            Fase = FaseDaBatalha.EmAndamento;

            // A ordem de chegada vira o critério de desempate. É preciso guardá-la
            // antes de ordenar: `List.Sort` não é estável, e sem o desempate
            // explícito duas unidades de mesma iniciativa trocariam de lugar de
            // uma execução para a outra — batalha determinística não sobrevive a
            // isso.
            var chegada = new Dictionary<Unidade, int>();
            foreach (var u in unidades)
            {
                if (u == null) continue;
                chegada[u] = chegada.Count;
                _unidades.Add(u);
                _nascimento.Add(u);
            }
            _unidades.Sort((a, b) =>
            {
                if (a.Iniciativa != b.Iniciativa) return b.Iniciativa.CompareTo(a.Iniciativa);
                return chegada[a].CompareTo(chegada[b]);
            });

            _sorte = sorte ?? Sorte.DeTexto(SementeDe(_unidades));
            _indice = 0;

            _r = new Resultado();
            Abertura = _r;
            Emitir(TipoDeEvento.InicioDeRodada, null, q: Rodada);
            IniciarTurno(0);
            _r = null;
        }

        static string SementeDe(List<Unidade> us)
        {
            var sb = new System.Text.StringBuilder();
            for (int i = 0; i < us.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(us[i].ClasseOuMonstroId).Append(':').Append(us[i].Uid);
            }
            return sb.ToString();
        }

        // ---- consultas simples ---------------------------------------------

        public Unidade Acha(string uid)
        {
            for (int i = 0; i < _unidades.Count; i++)
                if (_unidades[i].Uid == uid) return _unidades[i];
            return null;
        }

        /// <summary>
        /// Quem está em pé nesta casa. Morto e fundido não contam: a casa deles
        /// está livre para andar e para mirar.
        /// </summary>
        public Unidade EmCasa(Vector2Int p)
        {
            for (int i = 0; i < _unidades.Count; i++)
            {
                var u = _unidades[i];
                if (u.NoTabuleiro && u.Casa == p) return u;
            }
            return null;
        }

        /// <summary>As casas que têm gente em cima — o que fecha passagem.</summary>
        public List<Vector2Int> Ocupadas()
        {
            var saida = new List<Vector2Int>();
            for (int i = 0; i < _unidades.Count; i++)
                if (_unidades[i].NoTabuleiro) saida.Add(_unidades[i].Casa);
            return saida;
        }

        public List<Unidade> Vivas(Lado lado)
        {
            var saida = new List<Unidade>();
            for (int i = 0; i < _unidades.Count; i++)
                if (_unidades[i].NoTabuleiro && _unidades[i].Lado == lado) saida.Add(_unidades[i]);
            return saida;
        }

        // ---- passo -----------------------------------------------------------

        /// <summary>
        /// Onde quem está jogando consegue chegar a pé, e por quanto.
        ///
        /// Delega em <see cref="Passo.Alcance"/> — busca em largura, que é o
        /// único jeito de o corredor em L custar o que custa. O que se acrescenta
        /// aqui é o que a grade não sabe: quem está preso ao chão não anda, e
        /// gente em pé fecha passagem como parede.
        /// </summary>
        public IReadOnlyDictionary<Vector2Int, int> AlcanceDePasso()
        {
            var u = Atual;
            if (u == null || !u.NoTabuleiro || Fase != FaseDaBatalha.EmAndamento)
                return new Dictionary<Vector2Int, int>();
            if (TemEfeito(u, "root")) return new Dictionary<Vector2Int, int>();
            return Passo.Alcance(Mapa, u.Casa, u.PP, Ocupadas());
        }

        public bool PodeAndar(Vector2Int destino)
        {
            return AlcanceDePasso().ContainsKey(destino);
        }

        /// <summary>
        /// A casa cobra teste de fixação para ser alcançada?
        ///
        /// A interface pinta estas em outra cor. O critério é o mesmo que o
        /// <see cref="Andar"/> usa — se divergissem, o jogador veria uma casa
        /// segura e levaria o teste ao pisar nela, que é o pior tipo de mentira
        /// de tabuleiro.
        /// </summary>
        public bool Arriscada(Vector2Int destino)
        {
            var u = Atual;
            if (u == null || !u.NoTabuleiro) return false;
            var fixadores = FixadoresDe(u, u.Casa);
            for (int i = 0; i < fixadores.Count; i++)
                if (Distancia.Manhattan(destino, fixadores[i].Casa) != 1) return true;
            return false;
        }

        /// <summary>
        /// Anda até a casa, descontando 1 PP por passo do caminho.
        ///
        /// Devolve <see cref="Resultado"/> e não <c>void</c> como no contrato: o
        /// passo PODE falhar depois de aceito — o teste de fixação é sorteado
        /// dentro daqui, e quem falha perde todo o PP restante sem sair do lugar.
        /// Com retorno vazio, a interface não teria como saber que o clique não
        /// virou movimento. Trocar <c>void</c> por um retorno não quebra nenhum
        /// chamador; está no relatório.
        /// </summary>
        public Resultado Andar(Vector2Int destino)
        {
            _r = new Resultado();
            try
            {
                if (Fase != FaseDaBatalha.EmAndamento) return _r.Nega("a batalha já acabou");

                var u = Atual;
                if (u == null || !u.NoTabuleiro) return _r.Nega("não há unidade jogando");
                if (TemEfeito(u, "root")) return _r.Nega(Nome(u) + " está preso ao chão");

                var alcance = Passo.Alcance(Mapa, u.Casa, u.PP, Ocupadas());
                int custo;
                if (!alcance.TryGetValue(destino, out custo))
                {
                    // O motor em JS recusava em SILÊNCIO, e esse é justamente o
                    // estado em que o jogador mais precisa de explicação: uma
                    // fixação fracassada leva TODO o PP restante sem tirar a
                    // unidade do lugar, e a partir daí cada clique no chão não
                    // fazia nada e não dizia nada.
                    if (u.PP <= 0) return _r.Nega(Nome(u) + " não tem mais Pontos de Passos neste turno");
                    return _r.Nega("não dá para chegar aí com " + u.PP + " PP");
                }

                // Teste de fixação: UMA vez por chamada, contra o inimigo colado
                // na casa de PARTIDA que deixa de estar colado na de DESTINO — e,
                // havendo vários, contra o PIOR deles. É o que mantém
                // `Arriscada` e `Andar` em acordo perfeito.
                var fixador = PiorFixador(u, destino);
                if (fixador != null)
                {
                    double chance = ChanceDeEsquiva(u, fixador);
                    if (_sorte.Proximo() < chance)
                    {
                        Emitir(TipoDeEvento.EsquivaOk, u.Uid, fonte: fixador.Uid, detalhe: Nome(fixador));
                    }
                    else
                    {
                        // Perde o PP restante E não sai do lugar. "Perder o PP e
                        // ainda assim andar" seria contraditório — é isso que dá
                        // dentes à Fixação.
                        u.PP = 0;

                        // Segundo sorteio, com a fórmula literal do contrato: o
                        // primeiro já é ≥ chance quando falha, então reusá-lo
                        // tornaria a falha crítica impossível.
                        bool critica = _sorte.Proximo() < chance / 3.0;
                        if (critica) u.PA = Math.Max(0, u.PA - 1);

                        Emitir(TipoDeEvento.EsquivaFalhou, u.Uid, fonte: fixador.Uid,
                               detalhe: critica ? "falha crítica" : null);
                        return _r.Nega(Nome(u) + " não escapa de " + Nome(fixador));
                    }
                }

                var partida = u.Casa;
                u.PP -= custo;
                u.Casa = destino;
                Emitir(TipoDeEvento.Movimento, u.Uid, q: custo, de: partida, para: destino);
                return _r;
            }
            finally { _r = null; }
        }

        /// <summary>
        /// Chance de escapar de quem prendeu, de 10% a 90%.
        ///
        /// <c>0.35 + (esquiva − fixação) × 0.02 + bônus elemental</c>, de
        /// <c>Engine.dodgeChance</c>. É AQUI que a esquiva deixa de ser um número
        /// na ficha e vira identidade de classe: com o mesmo fixador, o Bárbaro
        /// (esquiva 5) e o Ladino (esquiva 30) têm chances diferentes por 25
        /// pontos × 0,02 = meia dezena de pontos percentuais cada.
        ///
        /// O arredondamento a 4 casas não é enfeite: sem ele a soma de decimais
        /// em ponto flutuante produz 0,6499999999999999, e a interface mostra
        /// esse número como porcentagem.
        /// </summary>
        public double ChanceDeEsquiva(Unidade fugitivo, Unidade fixador)
        {
            if (fugitivo == null || fixador == null) return 1.0;
            double bruta = 0.35
                         + (EsquivaEfetiva(fugitivo) - FixacaoEfetiva(fixador)) * 0.02
                         + Rivalidade.BonusDeEsquiva(_banco, fugitivo.Elemento, fixador.Elemento);
            double presa = Math.Min(0.90, Math.Max(0.10, bruta));
            return Math.Round(presa * 10000.0) / 10000.0;
        }

        public int EsquivaEfetiva(Unidade u) { return u.Esquiva + SomaDeBonus(u, "dodge"); }
        public int FixacaoEfetiva(Unidade u) { return u.Fixacao + SomaDeBonus(u, "lock"); }

        /// <summary>Inimigos vivos colados em <paramref name="casa"/>.</summary>
        List<Unidade> FixadoresDe(Unidade u, Vector2Int casa)
        {
            var saida = new List<Unidade>();
            for (int i = 0; i < _unidades.Count; i++)
            {
                var e = _unidades[i];
                if (!e.NoTabuleiro || e == u || e.Lado == u.Lado) continue;
                if (Distancia.Manhattan(casa, e.Casa) == 1) saida.Add(e);
            }
            return saida;
        }

        /// <summary>
        /// Entre os que prendem, o que dá MENOS chance de escapar. Quem continua
        /// colado no destino não entra: não se testa fuga de quem você não
        /// largou.
        /// </summary>
        Unidade PiorFixador(Unidade u, Vector2Int destino)
        {
            Unidade pior = null;
            double menor = 2.0;
            var cand = FixadoresDe(u, u.Casa);
            for (int i = 0; i < cand.Count; i++)
            {
                if (Distancia.Manhattan(destino, cand[i].Casa) == 1) continue;
                double c = ChanceDeEsquiva(u, cand[i]);
                if (c < menor) { menor = c; pior = cand[i]; }
            }
            return pior;
        }

        // ---- turnos ----------------------------------------------------------

        /// <summary>
        /// Passa a vez. Devolve <see cref="Resultado"/> e não <c>void</c> como no
        /// contrato porque o começo do turno seguinte MACHUCA: clima, veneno e
        /// regeneração acontecem aqui, e podem matar. Com retorno vazio, a morte
        /// pelo veneno chegaria à tela sem nenhum evento que a explicasse.
        /// </summary>
        public Resultado EncerrarTurno()
        {
            _r = new Resultado();
            try
            {
                if (Fase != FaseDaBatalha.EmAndamento) return _r.Nega("a batalha já acabou");

                var u = Atual;
                if (u != null) DecrementarDuracoes(u);
                if (Fase != FaseDaBatalha.EmAndamento) return _r;

                Avancar(0);
                return _r;
            }
            finally { _r = null; }
        }

        /// <summary>
        /// PA e PP enchem AQUI — no começo do turno DA UNIDADE, não no começo da
        /// rodada.
        ///
        /// É a diferença inteira: numa batalha de seis, encher tudo na virada da
        /// rodada devolveria os recursos de cinco unidades que ainda não jogaram
        /// e apagaria o gasto de quem acabou de jogar. Quem gastou continua
        /// gasto até a sua vez voltar.
        /// </summary>
        void IniciarTurno(int guarda)
        {
            if (Fase != FaseDaBatalha.EmAndamento) return;
            if (guarda > _unidades.Count + 2) return;

            var u = Atual;
            if (u == null || !u.NoTabuleiro) { Avancar(guarda + 1); return; }

            u.PA = Math.Max(0, u.PAMax + SomaDeBonus(u, "pa"));
            u.PP = Math.Max(0, u.PPMax + SomaDeBonus(u, "pp"));
            if (TemEfeito(u, "root")) u.PP = 0;
            u.LancamentosNesteTurno.Clear();

            Emitir(TipoDeEvento.InicioDeTurno, u.Uid);
            TiquesDeInicio(u);

            if (!u.NoTabuleiro) Avancar(guarda + 1);
        }

        void Avancar(int guarda)
        {
            if (Fase != FaseDaBatalha.EmAndamento) return;
            if (guarda > _unidades.Count + 2) return;
            if (_unidades.Count == 0) return;

            int passos = 0, teto = _unidades.Count * 2 + 2;
            while (true)
            {
                _indice++;
                if (_indice >= _unidades.Count)
                {
                    _indice = 0;
                    Rodada++;
                    Emitir(TipoDeEvento.InicioDeRodada, null, q: Rodada);
                    AoComecarRodada();
                    if (Fase != FaseDaBatalha.EmAndamento) return;
                }
                passos++;
                // Ninguém de pé. O fim de batalha já deveria ter disparado; sair
                // aqui é a rede que impede o laço infinito de travar o Editor.
                if (passos > teto) return;
                if (_unidades[_indice].NoTabuleiro) break;
            }
            IniciarTurno(guarda);
        }

        /// <summary>
        /// A sala esquenta. Empate por sustentação — um lado cura mais do que o
        /// outro machuca — é beco sem saída: o jogador não perde e não ganha. A
        /// fúria é DERIVADA da rodada, nunca acumulada em campo, então não há
        /// contabilidade para dessincronizar.
        /// </summary>
        void AoComecarRodada()
        {
            var cfg = ConfiguracaoDaFuria();
            if (cfg.RodadasMaximas > 0 && Rodada >= cfg.RodadasMaximas)
            {
                Fase = FaseDaBatalha.Derrota;
                Emitir(TipoDeEvento.FimDeBatalha, null, detalhe: "fúria: a sala cobra a demora");
            }
        }

        Dados.FuriaDaSala ConfiguracaoDaFuria()
        {
            var n = _banco.Nivelamento;
            if (n != null && n.FuriaDaSala != null) return n.FuriaDaSala;
            // Padrão de `Engine.ROOM_FURY`, usado só se o acervo não trouxer a
            // chave — números medidos numa varredura de 108 batalhas, não chutados.
            return new Dados.FuriaDaSala
            {
                AposRodada = 20, PoderPorRodada = 10, CorteDeCuraPorRodada = 0.15, RodadasMaximas = 40
            };
        }

        int RodadasDeFuria()
        {
            var cfg = ConfiguracaoDaFuria();
            return Math.Max(0, Rodada - cfg.AposRodada);
        }

        /// <summary>O poder da fúria é do lado INIMIGO: é a sala reagindo aos invasores.</summary>
        int PoderDaFuria(Unidade u)
        {
            if (u == null || u.Lado != Lado.Monstro) return 0;
            return Arredonda(ConfiguracaoDaFuria().PoderPorRodada * (double)RodadasDeFuria());
        }

        /// <summary>
        /// O corte de cura vale para os DOIS lados de propósito: cortar só de um
        /// transferiria o empate em vez de encerrá-lo.
        /// </summary>
        double EscalaDeCura()
        {
            return Math.Max(0.0, 1.0 - ConfiguracaoDaFuria().CorteDeCuraPorRodada * RodadasDeFuria());
        }

        // ---- tiques de começo e fim de turno ---------------------------------

        void TiquesDeInicio(Unidade u)
        {
            TiqueDeClimaEm(u);
            if (!u.NoTabuleiro) return;

            // Cópia da lista: veneno mata, morte pode mexer no estado, e
            // percorrer a lista original enquanto ela muda é o defeito clássico.
            var efeitos = u.Efeitos.ToArray();
            for (int i = 0; i < efeitos.Length; i++)
            {
                if (!u.NoTabuleiro) break;
                var e = efeitos[i];
                if (!u.Efeitos.Contains(e)) continue;

                if (e.Tipo == "poison")
                {
                    int dano = RolarDano(e.Min, e.Max, e.PoderDaFonte,
                                         ResistenciaEfetiva(u, e.Elemento), MultiplicadorDeMarcas(u));
                    AplicarDano(u, dano, e.Elemento, e.UidDaFonte);
                }
                else if (e.Tipo == "regen")
                {
                    Curar(u, _sorte.Inteiro(e.Min, e.Max), e.UidDaFonte);
                }
            }
        }

        /// <summary>
        /// O clima dá ou tira 5 PV direto, no começo do turno da unidade.
        ///
        /// Ignora escudo e resistência de propósito: é ambiente, não ataque. E
        /// pode matar — a sala é um bicho a mais.
        /// </summary>
        void TiqueDeClimaEm(Unidade u)
        {
            if (!u.NoTabuleiro) return;
            Dados.Clima def;
            if (_banco.Climas == null || !_banco.Climas.TryGetValue(Clima ?? "", out def) || def == null) return;

            int saldo = 0;
            if (!string.IsNullOrEmpty(def.Favorece) && def.Favorece == u.Elemento) saldo += TiqueDeClima;
            if (!string.IsNullOrEmpty(def.Prejudica) && def.Prejudica == u.Elemento) saldo -= TiqueDeClima;
            if (saldo == 0) return;    // clima indiferente: sem evento nenhum

            if (saldo > 0)
            {
                int ganho = Math.Min(saldo, u.PVMax - u.PV);
                u.PV += ganho;
                Emitir(TipoDeEvento.TiqueDeClima, u.Uid, q: ganho, detalhe: Clima);
            }
            else
            {
                u.PV = Math.Max(0, u.PV + saldo);
                Emitir(TipoDeEvento.TiqueDeClima, u.Uid, q: saldo, detalhe: Clima);
                if (u.PV <= 0) Morrer(u);
            }
        }

        /// <summary>
        /// Fim do turno: durações e recargas caem UM.
        ///
        /// No fim do turno de quem carrega o efeito, e não no fim da rodada:
        /// "dura 2 turnos" tem de significar dois turnos DA VÍTIMA, senão o
        /// mesmo veneno dura o dobro numa sala cheia e a metade numa sala vazia.
        /// </summary>
        void DecrementarDuracoes(Unidade u)
        {
            for (int i = u.Efeitos.Count - 1; i >= 0; i--)
            {
                var e = u.Efeitos[i];
                e.Duracao--;
                if (e.Duracao <= 0)
                {
                    u.Efeitos.RemoveAt(i);
                    Emitir(TipoDeEvento.EfeitoExpirado, u.Uid, detalhe: e.Tipo);
                }
            }
            RecalcularEscudo(u);

            var ids = new List<string>(u.Recargas.Keys);
            for (int i = 0; i < ids.Count; i++)
                if (u.Recargas[ids[i]] > 0) u.Recargas[ids[i]] = u.Recargas[ids[i]] - 1;
        }

        // ---- morte e fim -----------------------------------------------------

        void Morrer(Unidade u)
        {
            if (!u.Viva) return;
            u.Viva = false;
            u.PV = 0;
            Emitir(TipoDeEvento.Morte, u.Uid);
            ConfereFimDeBatalha();
        }

        /// <summary>
        /// Tira do tabuleiro SEM contar derrota — é o convidado de uma fusão.
        ///
        /// A diferença para <see cref="Morrer"/> é o ponto inteiro do campo
        /// <see cref="Unidade.ForaDoTabuleiro"/>: nenhum evento de morte, e
        /// nenhuma checagem de fim de batalha. Tratar a fusão como morte faria
        /// uma dupla que se funde perder a batalha no instante em que o anfitrião
        /// caísse — ou pior, no instante da própria fusão.
        /// </summary>
        public Resultado SairDoTabuleiro(Unidade u)
        {
            _r = new Resultado();
            try
            {
                if (u == null) return _r.Nega("não há unidade");
                if (u.ForaDoTabuleiro) return _r.Nega(Nome(u) + " já saiu do tabuleiro");

                u.ForaDoTabuleiro = true;
                u.Viva = false;   // como no `engine.js`: `alive:false, offBoard:true`
                Emitir(TipoDeEvento.SaiuDoTabuleiro, u.Uid);

                // Se era a vez dele, a vez passa: ninguém joga fora do tabuleiro.
                if (Atual == u && Fase == FaseDaBatalha.EmAndamento) Avancar(0);
                return _r;
            }
            finally { _r = null; }
        }

        void ConfereFimDeBatalha()
        {
            if (Fase != FaseDaBatalha.EmAndamento) return;
            bool herois = Vivas(Lado.Heroi).Count > 0;
            bool monstros = Vivas(Lado.Monstro).Count > 0;

            if (!herois)
            {
                Fase = FaseDaBatalha.Derrota;
                Emitir(TipoDeEvento.FimDeBatalha, null, detalhe: "derrota");
            }
            else if (!monstros)
            {
                Fase = FaseDaBatalha.Vitoria;
                Emitir(TipoDeEvento.FimDeBatalha, null, detalhe: "vitória");
            }
        }

        // ---- utilidades ------------------------------------------------------

        /// <summary>A unidade carrega este efeito? O nome do tipo é o do acervo, em inglês.</summary>
        public static bool TemEfeito(Unidade u, string tipo)
        {
            for (int i = 0; i < u.Efeitos.Count; i++)
                if (u.Efeitos[i].Tipo == tipo) return true;
            return false;
        }

        static int SomaDeBonus(Unidade u, string atributo)
        {
            int s = 0;
            for (int i = 0; i < u.Efeitos.Count; i++)
            {
                var e = u.Efeitos[i];
                if (e.Tipo == "buff" && e.Atributo == atributo) s += e.Valor;
            }
            return s;
        }

        static void RecalcularEscudo(Unidade u)
        {
            int s = 0;
            for (int i = 0; i < u.Efeitos.Count; i++)
                if (u.Efeitos[i].Tipo == "shield") s += u.Efeitos[i].Restante;
            u.Escudo = s;
        }

        static string Nome(Unidade u)
        {
            return u == null ? "?" : (u.Nome ?? u.ClasseOuMonstroId ?? u.Uid);
        }

        /// <summary>
        /// O <c>Math.round</c> do JS: meio para CIMA.
        ///
        /// O <c>Math.Round</c> do C# arredonda meio para o PAR, então 18,5 daria
        /// 18 aqui e 19 lá. Numa faixa de dano isso é um ponto de vida de
        /// diferença por golpe — invisível num teste e visível numa batalha
        /// inteira.
        /// </summary>
        internal static int Arredonda(double v)
        {
            return (int)Math.Floor(v + 0.5);
        }

        Evento Emitir(TipoDeEvento tipo, string uid, string fonte = null, string feitico = null,
                      string elemento = null, int q = 0, int absorvido = 0,
                      Vector2Int de = default(Vector2Int), Vector2Int para = default(Vector2Int),
                      string detalhe = null)
        {
            var e = new Evento
            {
                Tipo = tipo, Uid = uid, UidDaFonte = fonte, FeiticoId = feitico,
                Elemento = elemento, Quantidade = q, Absorvido = absorvido,
                De = de, Para = para, Detalhe = detalhe
            };
            if (_r != null) _r.Registra(e);
            return e;
        }
    }
}
