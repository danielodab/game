using System;
using System.Collections.Generic;
using UnityEngine;
using Soterra.Grade;

namespace Soterra.Motor
{
    /// <summary>
    /// O CHÃO como participante da batalha: armadilha armada, marca de evento
    /// que brota sozinha, clima que gira, e a gente que nasce no meio da luta.
    ///
    /// Arquivo separado das outras duas metades porque a pergunta é outra: não é
    /// "de quem é a vez" nem "o que este feitiço faz", é "o que a SALA faz
    /// enquanto ninguém olha". Junto, o arquivo da conjuração passaria de mil
    /// linhas.
    /// </summary>
    public sealed partial class Batalha
    {
        /// <summary>
        /// Uma carga esperando no chão. Some ao disparar ou quando
        /// <see cref="Restante"/> zera — a conta é em RODADAS, não em turnos:
        /// uma armadilha que durasse turnos viveria seis vezes menos numa sala
        /// cheia do que numa sala vazia.
        /// </summary>
        public sealed class Armadilha
        {
            public Vector2Int Casa;
            public string FeiticoId;
            public string UidDoDono;
            public Lado LadoDoDono;
            public int Restante;
        }

        /// <summary>Uma marca <c>ev-*</c> brotada no chão, à espera de quem pise.</summary>
        public sealed class MarcaDeTerreno
        {
            public Vector2Int Casa;
            public string EventoId;
            public string Especie;
            public int Restante;
        }

        readonly List<Armadilha> _armadilhas = new List<Armadilha>();
        readonly List<MarcaDeTerreno> _marcas = new List<MarcaDeTerreno>();
        int _indiceDoClima;

        public IReadOnlyList<Armadilha> Armadilhas { get { return _armadilhas; } }
        public IReadOnlyList<MarcaDeTerreno> MarcasDeTerreno { get { return _marcas; } }

        public Armadilha ArmadilhaEm(Vector2Int p)
        {
            for (int i = 0; i < _armadilhas.Count; i++)
                if (_armadilhas[i].Casa == p) return _armadilhas[i];
            return null;
        }

        public MarcaDeTerreno MarcaEm(Vector2Int p)
        {
            for (int i = 0; i < _marcas.Count; i++)
                if (_marcas[i].Casa == p) return _marcas[i];
            return null;
        }

        Dados.Calabouco Calabouco()
        {
            return string.IsNullOrEmpty(IdDoCalabouco) ? null : _banco.AchaCalabouco(IdDoCalabouco);
        }

        // ---- clima -----------------------------------------------------------

        /// <summary>
        /// Os cinco climas canônicos, na ordem do ciclo.
        ///
        /// Lista fechada, e NÃO "todas as chaves de <c>weathers</c>": um clima
        /// experimental acrescentado ao acervo entraria sozinho no rodízio de
        /// todas as salas reais, e ninguém ligaria uma coisa à outra.
        /// </summary>
        static readonly string[] CicloCanonico =
        {
            "calmo", "chuva", "estiagem", "vendaval", "tremor"
        };

        List<string> CicloDeClima()
        {
            var saida = new List<string>();
            if (_banco.Climas == null) return saida;
            for (int i = 0; i < CicloCanonico.Length; i++)
                if (_banco.Climas.ContainsKey(CicloCanonico[i])) saida.Add(CicloCanonico[i]);
            if (saida.Count > 0) return saida;

            // Último recurso: o acervo trocou os nomes dos climas. Melhor girar
            // por uma lista estranha do que não girar e o defeito virar "o ciclo
            // parou de funcionar" sem pista nenhuma.
            foreach (var par in _banco.Climas) saida.Add(par.Key);
            return saida;
        }

        /// <summary>
        /// Impõe um clima. Devolve falso quando não muda nada — repor o clima que
        /// já está no ar não pode gastar o evento, senão a interface anunciaria
        /// "o clima muda" sem nada mudar.
        /// </summary>
        public bool TrocarClima(string climaId)
        {
            if (string.IsNullOrEmpty(climaId) || Clima == climaId) return false;
            Clima = climaId;

            var ciclo = CicloDeClima();
            int i = ciclo.IndexOf(climaId);
            if (i >= 0) _indiceDoClima = i;

            Emitir(TipoDeEvento.MudancaDeClima, null, detalhe: climaId);
            return true;
        }

        /// <summary>
        /// O rodízio automático do calabouço.
        ///
        /// <c>(Rodada − 1) % N == 0</c> a partir da rodada 2: com <c>N = 3</c> o
        /// clima gira na 4ª, na 7ª, na 10ª. A rodada 1 fica de fora de propósito
        /// — a sala tem de começar com o clima que ela declarou, não com o
        /// segundo do ciclo.
        /// </summary>
        void AvancarCicloDeClima()
        {
            var d = Calabouco();
            int cada = d == null ? 0 : d.TrocaDeClimaACadaRodadas;
            if (cada <= 0 || Rodada <= 1 || (Rodada - 1) % cada != 0) return;

            var ciclo = CicloDeClima();
            if (ciclo.Count <= 1) return;

            _indiceDoClima = (_indiceDoClima + 1) % ciclo.Count;
            var proximo = ciclo[_indiceDoClima];

            // Zera antes de trocar para o evento sair MESMO quando o ciclo tem
            // uma volta tão curta que o próximo clima é o atual: sem isto, um
            // ciclo de um item só ficaria mudo para sempre.
            Clima = null;
            TrocarClima(proximo);
        }

        // ---- começo de rodada ------------------------------------------------

        /// <summary>
        /// O que a sala faz sozinha na virada da rodada: gira o clima, gasta uma
        /// rodada de cada armadilha e de cada marca, e semeia marcas novas.
        /// </summary>
        void AoComecarRodadaNoTerreno()
        {
            AvancarCicloDeClima();

            for (int i = _armadilhas.Count - 1; i >= 0; i--)
            {
                _armadilhas[i].Restante--;
                if (_armadilhas[i].Restante > 0) continue;
                Emitir(TipoDeEvento.ArmadilhaExpirada, null, feitico: _armadilhas[i].FeiticoId,
                       para: _armadilhas[i].Casa);
                _armadilhas.RemoveAt(i);
            }

            for (int i = _marcas.Count - 1; i >= 0; i--)
            {
                _marcas[i].Restante--;
                if (_marcas[i].Restante > 0) continue;
                Emitir(TipoDeEvento.MarcaDeTerrenoExpirou, null, detalhe: _marcas[i].EventoId,
                       para: _marcas[i].Casa);
                _marcas.RemoveAt(i);
            }

            BrotarMarcas();
        }

        /// <summary>
        /// Semeia marcas de evento. Uma tentativa por rodada, que só vinga com
        /// probabilidade <c>tileEventRate</c> — o dado não traz
        /// <c>tileEventSpawnPerRound</c> em nenhum dos seis calabouços, e o
        /// <c>engine.js</c> cai em 1 quando ele falta.
        /// </summary>
        void BrotarMarcas()
        {
            var d = Calabouco();
            if (d == null || d.TaxaDeEventos <= 0) return;
            if (_banco.EventosDeTerreno == null || _banco.EventosDeTerreno.Count == 0) return;
            if (_sorte.Proximo() >= d.TaxaDeEventos) return;

            var livres = new List<Vector2Int>();
            for (int y = 0; y < Mapa.Altura; y++)
                for (int x = 0; x < Mapa.Largura; x++)
                {
                    var p = new Vector2Int(x, y);
                    if (!Mapa.Andavel(p)) continue;
                    if (EmCasa(p) != null) continue;
                    if (MarcaEm(p) != null || ArmadilhaEm(p) != null) continue;
                    livres.Add(p);
                }
            if (livres.Count == 0) return;

            var casa = livres[(int)Math.Floor(_sorte.Proximo() * livres.Count)];

            var poco = new List<Dados.EventoDeTerreno>(_banco.EventosDeTerreno.Values);
            var ev = SorteioPonderado(poco, e => e.Peso);
            if (ev == null) return;

            _marcas.Add(new MarcaDeTerreno
            {
                Casa = casa, EventoId = ev.Id, Especie = ev.Especie,
                Restante = ev.Duracao > 0 ? ev.Duracao : 3
            });
            Emitir(TipoDeEvento.MarcaDeTerrenoNasceu, null, detalhe: ev.Id, para: casa);
        }

        /// <summary>
        /// Sorteio ponderado determinístico. Peso zero ou negativo NÃO é erro:
        /// é o jeito de o acervo desligar uma entrada sem apagá-la.
        /// </summary>
        T SorteioPonderado<T>(IList<T> lista, Func<T, int> peso) where T : class
        {
            if (lista == null || lista.Count == 0) return null;
            int total = 0;
            for (int i = 0; i < lista.Count; i++) total += Math.Max(0, peso(lista[i]));
            if (total <= 0) return lista[0];

            double r = _sorte.Proximo() * total;
            for (int i = 0; i < lista.Count; i++)
            {
                r -= Math.Max(0, peso(lista[i]));
                if (r < 0) return lista[i];
            }
            return lista[lista.Count - 1];
        }

        // ---- pisar -----------------------------------------------------------

        /// <summary>
        /// Dispara a armadilha desta casa, se houver uma e se ela for do outro
        /// lado. Devolve se disparou.
        ///
        /// A carga é conjurada PELO DONO, a partir da casa da armadilha, e com o
        /// pisante contando como alvo legítimo — ele está exatamente na casa que
        /// explode. Conjurar em nome do pisante faria o veneno da armadilha ser
        /// creditado à vítima.
        /// </summary>
        public bool DispararArmadilha(Unidade u, Vector2Int casa)
        {
            if (u == null || !u.NoTabuleiro || Fase != FaseDaBatalha.EmAndamento) return false;

            for (int i = _armadilhas.Count - 1; i >= 0; i--)
            {
                var a = _armadilhas[i];
                if (a.Casa != casa) continue;
                if (a.LadoDoDono == u.Lado) continue;   // ninguém pisa na própria armadilha

                _armadilhas.RemoveAt(i);
                Emitir(TipoDeEvento.ArmadilhaDisparada, u.Uid, fonte: a.UidDoDono,
                       feitico: a.FeiticoId, para: casa);

                var f = Feitico(a.FeiticoId);
                if (f != null)
                {
                    var dono = Acha(a.UidDoDono);
                    if (dono == null || !dono.NoTabuleiro) dono = u;
                    Emitir(TipoDeEvento.Conjuracao, dono.Uid, feitico: f.Id,
                           elemento: f.Elemento, para: casa);
                    AplicarEfeitos(dono, f, casa, casa, true);
                }
                return true;
            }
            return false;
        }

        /// <summary>
        /// Dispara a marca de evento desta casa. A marca é CONSUMIDA antes de
        /// agir: o <c>ev-portal</c> pode tirar o pisante do lugar, e uma marca
        /// ainda no chão nessa hora dispararia de novo no passo seguinte.
        /// </summary>
        public bool DispararMarcaDeTerreno(Unidade u, Vector2Int casa)
        {
            if (u == null || !u.NoTabuleiro || Fase != FaseDaBatalha.EmAndamento) return false;

            for (int i = 0; i < _marcas.Count; i++)
            {
                var m = _marcas[i];
                if (m.Casa != casa) continue;
                _marcas.RemoveAt(i);

                Dados.EventoDeTerreno def;
                _banco.EventosDeTerreno.TryGetValue(m.EventoId ?? "", out def);

                List<Dados.Efeito> efeitos = null;
                string texto = null;
                if (def != null)
                {
                    // Só o `ev-mystery` tem `outcomes`, e é ele o motivo de este
                    // ramo existir: quem lesse apenas `effects` faria a surpresa
                    // não fazer nada, calada.
                    if (def.Desfechos != null && def.Desfechos.Count > 0)
                    {
                        var d = SorteioPonderado(def.Desfechos, o => o.Peso);
                        if (d != null) { efeitos = d.Efeitos; texto = d.Texto ?? def.Nome; }
                    }
                    else
                    {
                        efeitos = def.Efeitos;
                        texto = def.Nome;
                    }
                }

                Emitir(TipoDeEvento.EventoDeTerreno, u.Uid, feitico: m.EventoId,
                       para: casa, detalhe: texto);

                if (efeitos != null && efeitos.Count > 0)
                {
                    // O pisante é o "conjurador" E alvo legítimo: quem pisa numa
                    // sanguessuga apanha da própria pisada. Como o poder da
                    // conjuração sai do conjurador, quem é mais forte apanha mais
                    // da própria marca — é o que o `engine.js` faz, e está no
                    // relatório.
                    var molde = new Dados.Feitico
                    {
                        Id = "tileEvent:" + m.EventoId,
                        Nome = texto ?? m.EventoId,
                        Elemento = Dados.Elemento.Neutro,
                        Efeitos = efeitos
                    };
                    AplicarEfeitos(u, molde, casa, casa, true);
                }
                return true;
            }
            return false;
        }

        /// <summary>
        /// O caminho que o passo percorre, casa a casa, SEM a de partida.
        ///
        /// Existe aqui e não em <see cref="Passo"/> porque aquele arquivo é de
        /// outro dono e a função dele devolve o CUSTO de cada casa, não de onde
        /// cada uma foi alcançada — e sem o "de onde" não há caminho a
        /// reconstruir. A ordem das direções é a mesma de lá, para os dois
        /// concordarem sobre qual dos caminhos empatados é o escolhido.
        /// </summary>
        List<Vector2Int> Caminho(Vector2Int origem, Vector2Int destino)
        {
            var passos = new List<Vector2Int>();
            if (origem == destino) return passos;

            var direcoes = new[]
            {
                new Vector2Int(0, 1), new Vector2Int(0, -1),
                new Vector2Int(-1, 0), new Vector2Int(1, 0)
            };

            var ocupadas = new HashSet<Vector2Int>(Ocupadas());
            var veioDe = new Dictionary<Vector2Int, Vector2Int>();
            var visto = new HashSet<Vector2Int> { origem };
            var fila = new Queue<Vector2Int>();
            fila.Enqueue(origem);

            bool achou = false;
            while (fila.Count > 0 && !achou)
            {
                var atual = fila.Dequeue();
                for (int i = 0; i < direcoes.Length; i++)
                {
                    var viz = atual + direcoes[i];
                    if (visto.Contains(viz)) continue;
                    if (!Mapa.Andavel(viz)) continue;
                    if (ocupadas.Contains(viz)) continue;

                    visto.Add(viz);
                    veioDe[viz] = atual;
                    if (viz == destino) { achou = true; break; }
                    fila.Enqueue(viz);
                }
            }
            if (!achou) return passos;

            var p = destino;
            while (p != origem) { passos.Add(p); p = veioDe[p]; }
            passos.Reverse();
            return passos;
        }

        /// <summary>
        /// Pisa nas casas do caminho, na ordem, disparando armadilha e marca.
        ///
        /// Só o passo DELIBERADO pisa: empurrão, puxão, teleporte e investida
        /// não disparam nada. Sem essa separação, uma armadilha que empurrasse a
        /// vítima para cima de outra armadilha entraria em recursão — e o
        /// <c>engine.js</c> paga essa conta pelo mesmo motivo.
        /// </summary>
        void PisarNoCaminho(Unidade u, List<Vector2Int> passos)
        {
            for (int i = 0; i < passos.Count; i++)
            {
                if (!u.NoTabuleiro || Fase != FaseDaBatalha.EmAndamento) break;
                DispararArmadilha(u, passos[i]);
                if (!u.NoTabuleiro || Fase != FaseDaBatalha.EmAndamento) break;
                DispararMarcaDeTerreno(u, passos[i]);
            }
        }

        // ---- nascer no meio da luta ------------------------------------------

        /// <summary>
        /// Põe uma criatura no tabuleiro AGORA, do lado de quem a chamou.
        ///
        /// Ela entra na fila logo DEPOIS do invocador, e não no fim: a fila é por
        /// iniciativa e a invocada não tem lugar próprio nela — pôr no fim daria
        /// à invocação do Xamã um turno antes do inimigo mais lento, e no começo
        /// daria dois turnos na mesma rodada.
        /// </summary>
        /// <param name="comoInvocacao">
        /// Falso faz a criatura SEGURAR o lado como qualquer outra. É o caso do
        /// traço <c>split</c>: os dois Carrapichinhos são a Carrapicho-Mãe
        /// continuando, não bichos que ela chamou. Marcá-los como invocação
        /// declararia a sala limpa no instante em que a mãe se parte — o
        /// contrário exato do que o traço serve para fazer.
        /// </param>
        public Unidade Invocar(string idDoMonstro, Vector2Int casa, Unidade invocador,
                               bool comoInvocacao = true)
        {
            if (invocador == null || string.IsNullOrEmpty(idDoMonstro)) return null;
            if (!Mapa.Andavel(casa) || EmCasa(casa) != null) return null;

            Dados.Monstro def = null;
            if (_banco.Monstros == null || !_banco.Monstros.TryGetValue(idDoMonstro, out def))
                def = null;
            if (def == null && _banco.InvocadosDeFusao != null)
                _banco.InvocadosDeFusao.TryGetValue(idDoMonstro, out def);
            if (def == null) return null;

            var u = Unidade.DeMonstro(def, ProximoUid(idDoMonstro), casa);
            u.Lado = invocador.Lado;          // a invocação do herói luta PELO herói
            u.Invocada = comoInvocacao;
            u.UidDoInvocador = invocador.Uid;

            _nascimento.Add(u);
            InserirNaFilaDepoisDe(invocador.Uid, u);
            Emitir(TipoDeEvento.Invocacao, u.Uid, fonte: invocador.Uid,
                   para: casa, detalhe: idDoMonstro);
            return u;
        }

        /// <summary>
        /// Um uid que ninguém mais usa. Conta em cima do que já existe em vez de
        /// sortear: uid sorteado quebra a reprodutibilidade da batalha, e uid
        /// repetido faz <see cref="Acha"/> devolver a criatura errada em silêncio.
        /// </summary>
        string ProximoUid(string idDoMonstro)
        {
            string baseUid = "inv" + (_nascimento.Count + 1) + "-" + idDoMonstro;
            if (Acha(baseUid) == null) return baseUid;
            for (int n = 2; ; n++)
            {
                var tentativa = baseUid + "#" + n;
                if (Acha(tentativa) == null) return tentativa;
            }
        }

        void InserirNaFilaDepoisDe(string uidAnterior, Unidade nova)
        {
            int i = -1;
            for (int k = 0; k < _unidades.Count; k++)
                if (_unidades[k].Uid == uidAnterior) { i = k; break; }

            if (i < 0) { _unidades.Add(nova); return; }

            _unidades.Insert(i + 1, nova);
            // O ponteiro da vez anda junto: sem isto, inserir antes dele faria a
            // batalha repetir o turno de quem já jogou.
            if (i + 1 <= _indice) _indice++;
        }
    }
}
