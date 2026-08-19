using System;
using System.Collections.Generic;
using UnityEngine;
using Soterra.Grade;

namespace Soterra.Motor
{
    /// <summary>
    /// A metade da batalha que lança feitiço: mirar, cobrar PA, aplicar efeito,
    /// contar dano.
    ///
    /// Está em arquivo separado da máquina de turnos porque são duas perguntas
    /// diferentes — "de quem é a vez" e "o que este feitiço faz" — e juntas dão
    /// um arquivo que ninguém lê inteiro.
    /// </summary>
    public sealed partial class Batalha
    {
        // ---- mira ------------------------------------------------------------

        /// <summary>O feitiço, procurado nas cinco tabelas do acervo.</summary>
        public Dados.Feitico Feitico(string feiticoId)
        {
            return _banco.AchaFeitico(feiticoId);
        }

        /// <summary>
        /// O alcance do feitiço como GEOMETRIA da grade.
        ///
        /// Feitiço sem <c>range</c> vale <c>{min:0, max:1}</c>, e não o
        /// <c>default</c> da struct: <c>default</c> daria alcance máximo ZERO —
        /// um corpo a corpo que só acerta a própria casa.
        /// </summary>
        static Alcance GeometriaDe(Dados.Feitico f)
        {
            var r = f.Alcance;
            if (r == null) return Alcance.Padrao;
            return new Alcance(r.Min, r.Max, r.Linha, r.Visao);
        }

        /// <summary>
        /// O feitiço tem área DE VERDADE?
        ///
        /// Forma diferente de <c>Single</c> E tamanho maior que zero. Um
        /// <c>circle</c> de tamanho 0 é um alvo único disfarçado, e tratá-lo como
        /// área deixaria conjurar no vazio um feitiço que não pega nada.
        /// </summary>
        static bool TemArea(Dados.Feitico f)
        {
            return f.Area != null && f.Area.Forma != Forma.Single && f.Area.Tamanho > 0;
        }

        /// <summary>
        /// A unidade pode lançar este feitiço AGORA — sem olhar para onde.
        /// Sabe o feitiço, tem PA, não está em recarga, não estourou o limite
        /// por turno.
        /// </summary>
        bool PodeConjurarAgora(Unidade u, Dados.Feitico f)
        {
            if (u == null || f == null || !u.NoTabuleiro) return false;
            if (!u.Feiticos.Contains(f.Id)) return false;
            if (u.PA < f.CustoDePa) return false;

            int recarga;
            if (u.Recargas.TryGetValue(f.Id, out recarga) && recarga > 0) return false;

            // `castsPerTurn: 0` é ILIMITADO, não "nenhum" — é o que o `engine.js`
            // faz (`sCastsPerTurn(sp) > 0 && …`). Ler zero como proibição
            // silenciaria as cargas de armadilha, que são conjuradas pelo motor.
            if (f.LancamentosPorTurno > 0)
            {
                int jaSaiu;
                u.LancamentosNesteTurno.TryGetValue(f.Id, out jaSaiu);
                if (jaSaiu >= f.LancamentosPorTurno) return false;
            }
            return true;
        }

        /// <summary>
        /// A casa é um alvo legítimo deste feitiço?
        ///
        /// FEITIÇO DE ÁREA MIRA O CHÃO. Quando a forma é diferente de
        /// <c>Single</c> e o tamanho é maior que zero, a casa-alvo passa a ser um
        /// LUGAR: basta estar no alcance, e a área pega quem estiver dentro — ou
        /// ninguém. Sem esta linha, <c>targetSide: enemy</c> exigiria um inimigo
        /// NA PRÓPRIA casa, e aí não daria para largar a explosão ENTRE dois
        /// inimigos nem chutar onde o outro VAI estar. Numa grade tática isso é
        /// meia mecânica de posicionamento jogada fora.
        ///
        /// Só o alvo <c>self</c> continua preso ao conjurador, que é o que ele
        /// significa.
        /// </summary>
        bool CasaValida(Unidade u, Dados.Feitico f, Vector2Int p)
        {
            if (!GeometriaDe(f).Valido(Mapa, u.Casa, p)) return false;

            var ocupante = EmCasa(p);
            if (f.ExigeCasaVazia && ocupante != null) return false;

            if (TemArea(f) && (f.Alvo == Dados.Lado.Enemy || f.Alvo == Dados.Lado.Ally)) return true;

            if (f.Alvo == Dados.Lado.Enemy && (ocupante == null || ocupante.Lado == u.Lado)) return false;
            if (f.Alvo == Dados.Lado.Ally && (ocupante == null || ocupante.Lado != u.Lado)) return false;
            if (f.Alvo == Dados.Lado.Self && p != u.Casa) return false;

            return true;
        }

        /// <summary>
        /// ONDE O FEITIÇO CHEGA — distância, linha e visão —, sem exigir que haja
        /// alguém lá.
        ///
        /// Não é o mesmo que <see cref="AlvosDe"/>, e a diferença tem história:
        /// pintar só as casas com alvo válido faz um ataque de corpo a corpo sem
        /// ninguém ao lado não pintar NADA, e do lado do jogador isso parece
        /// botão quebrado. A interface pinta este conjunto fraco e, por cima,
        /// os alvos fortes.
        /// </summary>
        public IReadOnlyList<Vector2Int> AlcanceDe(string feiticoId)
        {
            var u = Atual;
            var f = Feitico(feiticoId);
            if (u == null || f == null) return new List<Vector2Int>();
            return new List<Vector2Int>(GeometriaDe(f).Casas(Mapa, u.Casa));
        }

        /// <summary>As casas em que este feitiço pode ser lançado agora.</summary>
        public IReadOnlyList<Vector2Int> AlvosDe(string feiticoId)
        {
            var saida = new List<Vector2Int>();
            var u = Atual;
            var f = Feitico(feiticoId);
            if (u == null || f == null || Fase != FaseDaBatalha.EmAndamento) return saida;
            if (!PodeConjurarAgora(u, f)) return saida;

            for (int y = 0; y < Mapa.Altura; y++)
                for (int x = 0; x < Mapa.Largura; x++)
                {
                    var p = new Vector2Int(x, y);
                    if (CasaValida(u, f, p)) saida.Add(p);
                }
            return saida;
        }

        /// <summary>
        /// As casas que a explosão pega se cair em <paramref name="alvo"/>. É o
        /// que a cena acende antes de o jogador confirmar.
        /// </summary>
        public IReadOnlyList<Vector2Int> AreaDe(string feiticoId, Vector2Int alvo)
        {
            var u = Atual;
            var f = Feitico(feiticoId);
            if (u == null || f == null) return new List<Vector2Int>();
            return CasasDaArea(u.Casa, f, alvo);
        }

        List<Vector2Int> CasasDaArea(Vector2Int origem, Dados.Feitico f, Vector2Int alvo)
        {
            var a = f.Area;
            var forma = a == null ? Forma.Single : a.Forma;
            int tamanho = a == null ? 0 : a.Tamanho;
            return Area.Casas(Mapa, origem, alvo, forma, tamanho);
        }

        public bool PodeConjurar(string feiticoId, Vector2Int alvo)
        {
            var u = Atual;
            var f = Feitico(feiticoId);
            if (u == null || f == null || Fase != FaseDaBatalha.EmAndamento) return false;
            return PodeConjurarAgora(u, f) && CasaValida(u, f, alvo);
        }

        // ---- conjuração ------------------------------------------------------

        public Resultado Conjurar(string feiticoId, Vector2Int alvo)
        {
            _r = new Resultado();
            try
            {
                if (Fase != FaseDaBatalha.EmAndamento) return _r.Nega("a batalha já acabou");

                var u = Atual;
                var f = Feitico(feiticoId);
                if (u == null || !u.NoTabuleiro) return _r.Nega("não há unidade jogando");
                if (f == null) return _r.Nega("feitiço desconhecido: " + feiticoId);
                if (!u.Feiticos.Contains(f.Id)) return _r.Nega(Nome(u) + " não sabe " + f.Nome);
                if (u.PA < f.CustoDePa)
                    return _r.Nega(f.Nome + " custa " + f.CustoDePa + " PA e sobram " + u.PA);

                int recarga;
                if (u.Recargas.TryGetValue(f.Id, out recarga) && recarga > 0)
                    return _r.Nega(f.Nome + " volta em " + recarga + " turno(s)");

                if (!PodeConjurarAgora(u, f))
                    return _r.Nega(f.Nome + " já saiu o máximo de vezes neste turno");

                if (!CasaValida(u, f, alvo)) return _r.Nega("alvo inválido para " + f.Nome);

                u.PA -= f.CustoDePa;
                int jaSaiu;
                u.LancamentosNesteTurno.TryGetValue(f.Id, out jaSaiu);
                u.LancamentosNesteTurno[f.Id] = jaSaiu + 1;

                // Recarga N some por N turnos COMPLETOS do dono: o +1 cobre o
                // resto do turno em que o feitiço foi lançado, que o decremento
                // do fim deste mesmo turno vai comer.
                if (f.Recarga > 0) u.Recargas[f.Id] = f.Recarga + 1;

                Emitir(TipoDeEvento.Conjuracao, u.Uid, feitico: f.Id, elemento: f.Elemento, para: alvo);
                AplicarEfeitos(u, f, alvo);
                return _r;
            }
            finally { _r = null; }
        }

        void AplicarEfeitos(Unidade conjurador, Dados.Feitico f, Vector2Int alvo)
        {
            AplicarEfeitos(conjurador, f, alvo, conjurador.Casa, false);
        }

        /// <summary>
        /// A conjuração de verdade, com as duas alavancas que só armadilha e
        /// marca de terreno usam.
        ///
        /// <paramref name="origem"/> é de onde a área se abre: numa armadilha o
        /// "conjurador" é o dono, que pode estar do outro lado da sala, mas a
        /// explosão sai da CASA da armadilha.
        ///
        /// <paramref name="oConjuradorTambemApanha"/> inverte a regra de fogo
        /// amigo: quem pisa numa sanguessuga é ao mesmo tempo o conjurador do
        /// efeito e a única vítima possível dele. Sem esta alavanca, o evento de
        /// terreno seria conjurado e não pegaria ninguém.
        /// </summary>
        void AplicarEfeitos(Unidade conjurador, Dados.Feitico f, Vector2Int alvo,
                            Vector2Int origem, bool oConjuradorTambemApanha)
        {
            var casas = CasasDaArea(origem, f, alvo);

            // Calculado UMA vez por conjuração: depende do conjurador e do
            // feitiço, nunca do alvo. Recalcular por alvo faria a segunda vítima
            // de uma explosão receber um número diferente da primeira sem motivo.
            int poder = PoderDeConjuracao(conjurador, f);

            Func<List<Unidade>> Ofendidos = () =>
                oConjuradorTambemApanha ? Todos(casas) : Hostis(conjurador, casas);

            var efeitos = f.Efeitos ?? new List<Dados.Efeito>();
            for (int i = 0; i < efeitos.Count; i++)
            {
                if (Fase != FaseDaBatalha.EmAndamento) break;
                var eff = efeitos[i];
                if (eff == null || string.IsNullOrEmpty(eff.Tipo)) continue;

                switch (eff.Tipo)
                {
                    case "damage":
                        foreach (var alvoU in Ofendidos())
                        {
                            int amt = RolarDano(eff.Min ?? 0, eff.Max ?? 0, poder,
                                                ResistenciaEfetiva(alvoU, eff.Elemento),
                                                MultiplicadorDeMarcas(alvoU));
                            int perda = AplicarDano(alvoU, amt, eff.Elemento, conjurador.Uid);
                            if (eff.RoubaVida && perda > 0 && conjurador.NoTabuleiro)
                                Curar(conjurador, Arredonda(perda / 2.0), conjurador.Uid);
                        }
                        break;

                    case "heal":
                        foreach (var alvoU in Todos(casas))
                            Curar(alvoU, _sorte.Inteiro(eff.Min ?? 0, eff.Max ?? 0), conjurador.Uid);
                        break;

                    case "shield":
                        foreach (var alvoU in Todos(casas))
                        {
                            int v = eff.Valor ?? 0;
                            Aplicar(alvoU, new EfeitoAtivo
                            {
                                Tipo = "shield", Valor = v, Restante = v,
                                Duracao = eff.Duracao ?? 1, UidDaFonte = conjurador.Uid
                            });
                            RecalcularEscudo(alvoU);
                            Emitir(TipoDeEvento.Escudo, alvoU.Uid, fonte: conjurador.Uid, q: v);
                        }
                        break;

                    case "buff":
                        foreach (var alvoU in Todos(casas))
                        {
                            int v = eff.Valor ?? 0;
                            Aplicar(alvoU, new EfeitoAtivo
                            {
                                Tipo = "buff", Atributo = eff.Atributo, Valor = v,
                                Duracao = eff.Duracao ?? 1, UidDaFonte = conjurador.Uid
                            });
                            // Ajuste imediato: um bônus de PA que só valesse no
                            // turno seguinte seria inútil no turno em que se paga
                            // por ele.
                            if (eff.Atributo == "pa") alvoU.PA = Math.Max(0, alvoU.PA + v);
                            if (eff.Atributo == "pp") alvoU.PP = Math.Max(0, alvoU.PP + v);
                            // A iniciativa muda mas NÃO reordena a batalha em
                            // curso: reordenar no meio da rodada daria turno
                            // duplo a quem já jogou.
                            if (eff.Atributo == "initiative") alvoU.Iniciativa += v;
                        }
                        break;

                    case "resist":
                        foreach (var alvoU in Todos(casas))
                            Aplicar(alvoU, new EfeitoAtivo
                            {
                                Tipo = "resist", Elemento = eff.Elemento, Valor = eff.Valor ?? 0,
                                Duracao = eff.Duracao ?? 1, UidDaFonte = conjurador.Uid
                            });
                        break;

                    case "poison":
                        foreach (var alvoU in Ofendidos())
                            Aplicar(alvoU, new EfeitoAtivo
                            {
                                Tipo = "poison", Elemento = eff.Elemento,
                                Min = eff.Min ?? 0, Max = eff.Max ?? 0,
                                Duracao = eff.Duracao ?? 1, UidDaFonte = conjurador.Uid,
                                PoderDaFonte = poder
                            });
                        break;

                    case "regen":
                        foreach (var alvoU in Todos(casas))
                            Aplicar(alvoU, new EfeitoAtivo
                            {
                                Tipo = "regen", Min = eff.Min ?? 0, Max = eff.Max ?? 0,
                                Duracao = eff.Duracao ?? 1, UidDaFonte = conjurador.Uid
                            });
                        break;

                    case "root":
                        foreach (var alvoU in Ofendidos())
                        {
                            Aplicar(alvoU, new EfeitoAtivo
                            {
                                Tipo = "root", Duracao = eff.Duracao ?? 1, UidDaFonte = conjurador.Uid
                            });
                            alvoU.PP = 0;   // prende já neste turno, não só no próximo
                        }
                        break;

                    case "mark":
                        foreach (var alvoU in Ofendidos())
                            AplicarMarca(alvoU, eff, conjurador.Uid);
                        break;

                    case "detonateMarks":
                        foreach (var alvoU in Ofendidos())
                        {
                            int pilhas = ConsumirMarcas(alvoU);
                            if (pilhas <= 0) continue;
                            // Dano LITERAL: sem poder, sem resistência e sem o
                            // multiplicador das marcas — elas acabaram de ser
                            // gastas, contá-las duas vezes é dobrar o efeito.
                            int dano = Arredonda(pilhas * (double)(eff.Multiplicador ?? 0));
                            Emitir(TipoDeEvento.MarcasDetonadas, alvoU.Uid,
                                   fonte: conjurador.Uid, q: pilhas);
                            AplicarDano(alvoU, dano,
                                        eff.Elemento ?? f.Elemento ?? Dados.Elemento.Neutro,
                                        conjurador.Uid);
                        }
                        break;

                    case "push":
                    {
                        // Do mais distante para o mais perto: empurrar primeiro
                        // quem está na frente faria o de trás colidir no vizinho
                        // que ainda nem saiu do lugar.
                        var alvosP = Ofendidos();
                        alvosP.Sort((a, b) => Distancia.Manhattan(origem, b.Casa)
                                     .CompareTo(Distancia.Manhattan(origem, a.Casa)));
                        foreach (var alvoU in alvosP)
                            MovimentoForcado(conjurador, alvoU, eff.Casas ?? 0, true);
                        break;
                    }

                    case "pull":
                    {
                        var alvosP = Ofendidos();
                        alvosP.Sort((a, b) => Distancia.Manhattan(origem, a.Casa)
                                     .CompareTo(Distancia.Manhattan(origem, b.Casa)));
                        foreach (var alvoU in alvosP)
                            MovimentoForcado(conjurador, alvoU, eff.Casas ?? 0, false);
                        break;
                    }

                    case "cleanse":
                        foreach (var alvoU in Todos(casas))
                        {
                            var tipos = eff.Tipos ?? new List<string>();
                            int tirados = 0;
                            for (int k = alvoU.Efeitos.Count - 1; k >= 0; k--)
                                if (tipos.Contains(alvoU.Efeitos[k].Tipo)) { alvoU.Efeitos.RemoveAt(k); tirados++; }
                            RecalcularEscudo(alvoU);
                            if (tirados > 0)
                                Emitir(TipoDeEvento.EfeitoExpirado, alvoU.Uid, q: tirados, detalhe: "cleanse");
                        }
                        break;

                    case "dispelShield":
                        foreach (var alvoU in Ofendidos())
                        {
                            int tinha = alvoU.Escudo;
                            for (int k = alvoU.Efeitos.Count - 1; k >= 0; k--)
                                if (alvoU.Efeitos[k].Tipo == "shield") alvoU.Efeitos.RemoveAt(k);
                            RecalcularEscudo(alvoU);
                            if (tinha > 0)
                                Emitir(TipoDeEvento.Escudo, alvoU.Uid, fonte: conjurador.Uid,
                                       q: 0, detalhe: "dissipado " + tinha);
                        }
                        break;

                    // Estado puro: sem a IA desta rodada eles não mudam nenhuma
                    // decisão, mas a duração corre e a interface já pode mostrar
                    // o ícone — apagá-los faria o feitiço parecer sem efeito.
                    case "taunt":
                    case "invisible":
                        foreach (var alvoU in Todos(casas))
                            Aplicar(alvoU, new EfeitoAtivo
                            {
                                Tipo = eff.Tipo, Duracao = eff.Duracao ?? 1, UidDaFonte = conjurador.Uid
                            });
                        break;

                    // ---- movimento forçado do PRÓPRIO conjurador ----------
                    //
                    // Os três ignoram `pushImmune` de propósito (decisão de
                    // design do `engine.js`): o traço diz "ninguém me tira do
                    // lugar", e aqui quem se tira do lugar é a própria unidade.

                    case "teleport":
                        // Casa ocupada ou não-andável simplesmente não recebe —
                        // sem recusa e sem devolver o PA, como no `engine.js`. A
                        // validação de alvo já barrou o caso normal; isto é a
                        // rede para o alvo que mudou entre mirar e conjurar.
                        if (Mapa.Andavel(alvo) && EmCasa(alvo) == null)
                        {
                            var dePonto = conjurador.Casa;
                            conjurador.Casa = alvo;
                            Emitir(TipoDeEvento.Teleporte, conjurador.Uid, de: dePonto, para: alvo);
                        }
                        break;

                    case "swap":
                    {
                        var outro = EmCasa(alvo);
                        if (outro != null && outro != conjurador)
                        {
                            // A troca não confere se a casa é andável: as duas já
                            // têm gente em pé em cima, logo as duas são andáveis.
                            var dePonto = conjurador.Casa;
                            conjurador.Casa = outro.Casa;
                            outro.Casa = dePonto;
                            Emitir(TipoDeEvento.Teleporte, conjurador.Uid,
                                   de: dePonto, para: conjurador.Casa);
                            Emitir(TipoDeEvento.Teleporte, outro.Uid,
                                   de: conjurador.Casa, para: dePonto);
                        }
                        break;
                    }

                    case "moveTo":
                        Investir(conjurador, alvo, eff.CasasMaximas ?? 0);
                        break;

                    // ---- o que a conjuração deixa NO TABULEIRO -------------

                    case "summon":
                        if (Mapa.Andavel(alvo) && EmCasa(alvo) == null)
                            Invocar(eff.IdDoMonstro, alvo, conjurador);
                        break;

                    case "trap":
                        if (Mapa.Andavel(alvo))
                        {
                            // Arma mesmo com alguém em cima: a carga espera,
                            // e quem já está ali só a pisa quando se mexer. É o
                            // que permite plantar debaixo do inimigo parado.
                            _armadilhas.Add(new Armadilha
                            {
                                Casa = alvo, FeiticoId = eff.IdDaArmadilha,
                                UidDoDono = conjurador.Uid, LadoDoDono = conjurador.Lado,
                                Restante = eff.Duracao ?? 3
                            });
                            Emitir(TipoDeEvento.ArmadilhaArmada, conjurador.Uid,
                                   feitico: eff.IdDaArmadilha, para: alvo);
                        }
                        break;

                    case "weatherShift":
                        TrocarClima(eff.Clima);
                        break;

                    // ---- dano que anda sozinho ----------------------------

                    case "reflect":
                        foreach (var alvoU in Todos(casas))
                            Aplicar(alvoU, new EfeitoAtivo
                            {
                                // `Valor` carrega a PORCENTAGEM devolvida. Um
                                // campo próprio só para este efeito faria toda
                                // outra linha de `EfeitoAtivo` carregar um zero.
                                Tipo = "reflect", Valor = eff.Porcentagem ?? 0,
                                Duracao = eff.Duracao ?? 1, UidDaFonte = conjurador.Uid
                            });
                        break;

                    case "chain":
                        RaioEmCadeia(conjurador, eff, f, alvo, poder);
                        break;

                    default:
                        // A falta APARECE. Ignorar em silêncio um efeito que o
                        // acervo invente e o motor não conheça faria a unidade
                        // gastar PA sem nada acontecer, e o defeito seria lido
                        // como "o feitiço sumiu".
                        Emitir(TipoDeEvento.EfeitoIgnorado, conjurador.Uid,
                               feitico: f.Id, detalhe: eff.Tipo);
                        break;
                }
            }
        }

        // ---- alvos dentro da área -------------------------------------------

        List<Unidade> Todos(List<Vector2Int> casas)
        {
            var saida = new List<Unidade>();
            for (int i = 0; i < casas.Count; i++)
            {
                var u = EmCasa(casas[i]);
                if (u != null && !saida.Contains(u)) saida.Add(u);
            }
            return saida;
        }

        /// <summary>
        /// Alvos de efeito OFENSIVO: todo mundo dentro da área menos o
        /// conjurador.
        ///
        /// Menos o conjurador, mas NÃO menos os aliados: fogo amigo existe, e é
        /// o que faz posicionamento importar num feitiço de área.
        /// </summary>
        List<Unidade> Hostis(Unidade conjurador, List<Vector2Int> casas)
        {
            var saida = Todos(casas);
            saida.Remove(conjurador);
            return saida;
        }

        /// <summary>
        /// Gruda o efeito no corpo e ANUNCIA. O anúncio é obrigatório: a
        /// interface desenha o ícone a partir do evento, e um efeito aplicado em
        /// silêncio é um efeito que o jogador só descobre quando já o machucou.
        /// </summary>
        void Aplicar(Unidade alvo, EfeitoAtivo e)
        {
            alvo.Efeitos.Add(e);
            Emitir(TipoDeEvento.EfeitoAplicado, alvo.Uid, fonte: e.UidDaFonte,
                   elemento: e.Elemento, q: e.Valor, detalhe: e.Tipo);
        }

        // ---- marcas ----------------------------------------------------------

        void AplicarMarca(Unidade alvo, Dados.Efeito eff, string uidFonte)
        {
            // Em `mark`, `max` é o teto de PILHAS — não o teto de uma faixa de
            // dano. É o campo do acervo que mais engana quem lê só o nome.
            int teto = eff.Max ?? MaximoPadraoDeMarcas;
            int valor = eff.Valor ?? ValorPadraoDaMarca;
            int pilhas = ContaEfeitos(alvo, "mark");

            if (pilhas >= teto)
            {
                // Estourado o teto, uma marca nova RENOVA a mais antiga em vez de
                // empilhar: senão bastaria marcar sem parar para eternizar o
                // multiplicador.
                for (int i = 0; i < alvo.Efeitos.Count; i++)
                    if (alvo.Efeitos[i].Tipo == "mark")
                    {
                        alvo.Efeitos[i].Duracao = Math.Max(alvo.Efeitos[i].Duracao, eff.Duracao ?? 1);
                        break;
                    }
            }
            else
            {
                // Sem passar por `Aplicar`: a marca anuncia o número de PILHAS,
                // não o valor de uma pilha. Duas mensagens para o mesmo efeito
                // fariam a interface desenhar o ícone duas vezes.
                alvo.Efeitos.Add(new EfeitoAtivo
                {
                    Tipo = "mark", Valor = valor, Max = teto,
                    Duracao = eff.Duracao ?? 1, UidDaFonte = uidFonte
                });
                pilhas++;
            }
            Emitir(TipoDeEvento.EfeitoAplicado, alvo.Uid, fonte: uidFonte, q: pilhas, detalhe: "mark");
        }

        int ConsumirMarcas(Unidade alvo)
        {
            int n = 0;
            for (int i = alvo.Efeitos.Count - 1; i >= 0; i--)
                if (alvo.Efeitos[i].Tipo == "mark") { alvo.Efeitos.RemoveAt(i); n++; }
            return n;
        }

        static int ContaEfeitos(Unidade u, string tipo)
        {
            int n = 0;
            for (int i = 0; i < u.Efeitos.Count; i++) if (u.Efeitos[i].Tipo == tipo) n++;
            return n;
        }

        /// <summary>
        /// Quanto dano a mais o corpo marcado recebe: <c>1 + Σ(valor)/100</c>.
        /// Com o <c>value: 5</c> canônico do acervo isso é exatamente
        /// <c>1 + marcas × 0,05</c>.
        /// </summary>
        public double MultiplicadorDeMarcas(Unidade u)
        {
            double pct = 0;
            for (int i = 0; i < u.Efeitos.Count; i++)
                if (u.Efeitos[i].Tipo == "mark") pct += u.Efeitos[i].Valor;
            return 1.0 + pct / 100.0;
        }

        // ---- empurrão --------------------------------------------------------

        /// <summary>
        /// Empurra ou puxa. Direção travada no eixo dominante — não há empurrão
        /// na diagonal, do mesmo jeito que não há passo na diagonal.
        ///
        /// Bater em parede custa 10 de dano por casa que faltou percorrer. Dano
        /// FIXO, sem poder e sem resistência: quem machuca é o muro.
        /// </summary>
        void MovimentoForcado(Unidade conjurador, Unidade alvo, int casas, bool empurrar)
        {
            if (alvo == null || !alvo.NoTabuleiro || casas <= 0) return;
            if (alvo.ImuneAEmpurrao) return;

            var partida = alvo.Casa;
            int andou = 0, colisao = 0;

            if (empurrar)
            {
                int ddx = alvo.Casa.x - conjurador.Casa.x, ddy = alvo.Casa.y - conjurador.Casa.y;
                if (ddx == 0 && ddy == 0) return;
                int sx, sy;
                if (Math.Abs(ddx) >= Math.Abs(ddy)) { sx = ddx >= 0 ? 1 : -1; sy = 0; }
                else { sx = 0; sy = ddy > 0 ? 1 : -1; }

                for (int i = 0; i < casas; i++)
                {
                    var n = new Vector2Int(alvo.Casa.x + sx, alvo.Casa.y + sy);
                    if (!Livre(n)) { colisao = 10 * (casas - andou); break; }
                    alvo.Casa = n; andou++;
                }
            }
            else
            {
                int pretendido = Math.Min(casas,
                    Math.Max(0, Distancia.Manhattan(conjurador.Casa, alvo.Casa) - 1));
                for (int i = 0; i < casas; i++)
                {
                    int dx = conjurador.Casa.x - alvo.Casa.x, dy = conjurador.Casa.y - alvo.Casa.y;
                    if (Math.Abs(dx) + Math.Abs(dy) <= 1) break;   // colado: fim natural, sem colisão
                    int sx, sy;
                    if (Math.Abs(dx) >= Math.Abs(dy)) { sx = dx > 0 ? 1 : -1; sy = 0; }
                    else { sx = 0; sy = dy > 0 ? 1 : -1; }

                    var n = new Vector2Int(alvo.Casa.x + sx, alvo.Casa.y + sy);
                    if (!Livre(n))
                    {
                        // Contorna pelo outro eixo antes de desistir: puxar
                        // alguém para trás de uma quina é comum, e travar na
                        // primeira parede faria o gancho falhar quase sempre.
                        var porY = new Vector2Int(alvo.Casa.x, alvo.Casa.y + (dy > 0 ? 1 : -1));
                        var porX = new Vector2Int(alvo.Casa.x + (dx > 0 ? 1 : -1), alvo.Casa.y);
                        if (sy == 0 && dy != 0 && Livre(porY)) n = porY;
                        else if (sx == 0 && dx != 0 && Livre(porX)) n = porX;
                        else { colisao = 10 * (pretendido - andou); break; }
                    }
                    alvo.Casa = n; andou++;
                }
            }

            if (andou > 0 || colisao > 0)
            {
                Emitir(TipoDeEvento.Empurrao, alvo.Uid, fonte: conjurador.Uid,
                       q: colisao, de: partida, para: alvo.Casa);
                if (colisao > 0)
                    AplicarDano(alvo, colisao, Dados.Elemento.Neutro, conjurador.Uid);
            }
        }

        bool Livre(Vector2Int p)
        {
            return Mapa.Andavel(p) && EmCasa(p) == null;
        }

        // ---- investida e raio em cadeia --------------------------------------

        /// <summary>
        /// <c>moveTo</c>: desliza pelo eixo dominante até <paramref name="teto"/>
        /// casas, parando na PRIMEIRA casa bloqueada.
        ///
        /// Parar em vez de contornar é o que separa a investida do passo: o
        /// Passo de Corça é um pulo em linha, e um pulo que faz a curva em volta
        /// da parede seria só um andar caro. Não gasta PP e não paga teste de
        /// fixação — quem investe não está "largando" ninguém, está atropelando.
        /// </summary>
        void Investir(Unidade u, Vector2Int destino, int teto)
        {
            if (u == null || !u.NoTabuleiro || teto <= 0) return;

            var partida = u.Casa;
            int andou = 0;
            while (andou < teto && u.Casa != destino)
            {
                int dx = destino.x - u.Casa.x, dy = destino.y - u.Casa.y;
                int sx = 0, sy = 0;
                if (Math.Abs(dx) >= Math.Abs(dy)) sx = dx > 0 ? 1 : -1;
                else sy = dy > 0 ? 1 : -1;

                var n = new Vector2Int(u.Casa.x + sx, u.Casa.y + sy);
                if (!Livre(n)) break;
                u.Casa = n;
                andou++;
            }

            if (andou > 0)
                Emitir(TipoDeEvento.Movimento, u.Uid, q: andou,
                       de: partida, para: u.Casa, detalhe: "forçado");
        }

        /// <summary>Alcance de CADA salto da cadeia (<c>Engine.CHAIN_JUMP_RANGE</c>).</summary>
        public const int AlcanceDoSaltoEmCadeia = 3;

        /// <summary>
        /// <c>chain</c>: acerta o alvo e pula para o inimigo vivo mais próximo
        /// que ainda não apanhou, dentro de <see cref="AlcanceDoSaltoEmCadeia"/>.
        ///
        /// O alcance do SALTO é próprio e não tem nada a ver com o alcance do
        /// feitiço: o raio parte da última vítima, não do conjurador — é isso que
        /// faz um grupo apertado ser um erro de posicionamento.
        ///
        /// Cada salto multiplica o dano por <c>falloff</c>. A lista de já
        /// atingidos é obrigatória: sem ela dois inimigos colados jogariam o raio
        /// de um para o outro até acabarem os saltos.
        /// </summary>
        void RaioEmCadeia(Unidade conjurador, Dados.Efeito eff, Dados.Feitico f,
                          Vector2Int alvo, int poder)
        {
            var atual = EmCasa(alvo);
            if (atual == null || atual.Lado == conjurador.Lado) return;

            var jaAtingidos = new HashSet<string>();
            double mult = 1.0;
            double queda = eff.Queda ?? 0.7;
            int saltos = eff.Saltos ?? 0;
            string elemento = eff.Elemento ?? (f == null ? null : f.Elemento) ?? Dados.Elemento.Neutro;

            for (int j = 0; j <= saltos; j++)
            {
                if (atual == null || !atual.NoTabuleiro) break;
                jaAtingidos.Add(atual.Uid);

                int amt = RolarDano(eff.Min ?? 0, eff.Max ?? 0, poder,
                                    ResistenciaEfetiva(atual, elemento),
                                    MultiplicadorDeMarcas(atual) * mult);
                Emitir(TipoDeEvento.SaltoEmCadeia, atual.Uid, fonte: conjurador.Uid, q: j);
                AplicarDano(atual, amt, elemento, conjurador.Uid);
                if (Fase != FaseDaBatalha.EmAndamento) break;

                mult *= queda;

                Unidade proxima = null;
                int menorDistancia = int.MaxValue;
                for (int i = 0; i < _unidades.Count; i++)
                {
                    var u = _unidades[i];
                    if (!u.NoTabuleiro || jaAtingidos.Contains(u.Uid)) continue;
                    if (u.Lado == conjurador.Lado) continue;
                    int d = Distancia.Manhattan(atual.Casa, u.Casa);
                    if (d <= AlcanceDoSaltoEmCadeia && d < menorDistancia)
                    {
                        menorDistancia = d;
                        proxima = u;
                    }
                }
                atual = proxima;
            }
        }

        // ---- dano e cura -----------------------------------------------------

        /// <summary>
        /// Poder efetivo de UMA conjuração: o poder do corpo, mais os bônus
        /// ativos, mais o ganho elemental e mais a fúria da sala.
        /// </summary>
        public int PoderDeConjuracao(Unidade conjurador, Dados.Feitico f)
        {
            return conjurador.Poder + SomaDeBonus(conjurador, "power")
                 + BonusElemental(conjurador, f)
                 + PoderDaFuria(conjurador);
        }

        /// <summary>
        /// O ganho elemental só conta quando o feitiço é do elemento de quem o
        /// lança. O gatilho é o elemento do FEITIÇO, não o de cada efeito — é
        /// isso que faz um feitiço premiar a escolha de caminho inteira, e não
        /// efeito por efeito.
        /// </summary>
        static int BonusElemental(Unidade u, Dados.Feitico f)
        {
            if (u.PoderElemental == 0 || f == null || string.IsNullOrEmpty(f.Elemento)) return 0;
            return f.Elemento == u.Elemento ? u.PoderElemental : 0;
        }

        /// <summary>
        /// Resistência a um elemento, com teto de 100%.
        ///
        /// Sem PISO: resistência NEGATIVA é fraqueza e faz o alvo apanhar mais —
        /// a Vergasta tem −20 a fogo, e é assim que se lê "planta queima". Pôr um
        /// piso em zero apagaria essa metade do bestiário.
        /// </summary>
        public int ResistenciaEfetiva(Unidade u, string elemento)
        {
            int r = u.Resistencias == null ? 0 : u.Resistencias.De(elemento);
            for (int i = 0; i < u.Efeitos.Count; i++)
            {
                var e = u.Efeitos[i];
                if (e.Tipo == "resist" && e.Elemento == elemento) r += e.Valor;
            }
            return Math.Min(100, r);
        }

        int RolarDano(int min, int max, int poder, int resistencia, double multiplicador)
        {
            int rolagem = _sorte.Inteiro(min, max);
            double v = rolagem * (100.0 + poder) / 100.0
                                * (100.0 - resistencia) / 100.0
                                * multiplicador;
            return Math.Max(0, Arredonda(v));
        }

        /// <summary>
        /// Aplica dano JÁ calculado. Devolve o que saiu do PV — que não é o mesmo
        /// que o dano, porque o escudo come primeiro.
        /// </summary>
        /// <param name="semReflexo">
        /// O dano JÁ é uma devolução de <c>reflect</c> e não pode ser refletido
        /// outra vez. É a ÚNICA coisa que trava o laço: dois corpos refletindo
        /// ao mesmo tempo devolveriam a devolução um do outro até a pilha
        /// estourar — o <c>engine.js</c> paga com a mesma bandeira.
        /// </param>
        int AplicarDano(Unidade alvo, int quantia, string elemento, string uidFonte,
                        bool semReflexo = false)
        {
            if (alvo == null) return 0;
            if (!alvo.NoTabuleiro || quantia <= 0)
            {
                // Dano zero ainda vira evento: a interface precisa mostrar o "0"
                // sobre a cabeça: sem ele, resistência total parece feitiço que
                // não saiu.
                if (alvo.NoTabuleiro)
                    Emitir(TipoDeEvento.Dano, alvo.Uid, fonte: uidFonte, elemento: elemento, q: 0);
                return 0;
            }

            int absorvido = 0;
            if (alvo.Escudo > 0)
            {
                int resta = quantia;
                for (int i = 0; i < alvo.Efeitos.Count && resta > 0; i++)
                {
                    var e = alvo.Efeitos[i];
                    if (e.Tipo != "shield" || e.Restante <= 0) continue;
                    int pega = Math.Min(e.Restante, resta);
                    e.Restante -= pega; absorvido += pega; resta -= pega;
                }
                for (int i = alvo.Efeitos.Count - 1; i >= 0; i--)
                    if (alvo.Efeitos[i].Tipo == "shield" && alvo.Efeitos[i].Restante <= 0)
                        alvo.Efeitos.RemoveAt(i);
                RecalcularEscudo(alvo);
            }

            int perda = quantia - absorvido;
            alvo.PV = Math.Max(0, alvo.PV - perda);
            Emitir(TipoDeEvento.Dano, alvo.Uid, fonte: uidFonte, elemento: elemento,
                   q: quantia, absorvido: absorvido);

            Refletir(alvo, quantia, uidFonte, semReflexo);
            ConfereEnfurecer(alvo);
            if (alvo.PV <= 0) Morrer(alvo);
            return perda;
        }

        /// <summary>
        /// Devolve ao agressor a porcentagem que os efeitos <c>reflect</c> do
        /// alvo somarem.
        ///
        /// Sobre o dano BRUTO, antes do escudo: o espinho está na pele, e o
        /// escudo protege quem o veste, não quem bate nele. Devolver só o que
        /// passou faria a Redoma de Espinhos parar de espetar justamente quando
        /// o escudo está de pé — as duas metades do feitiço se anulariam.
        ///
        /// A devolução é dano NEUTRO e fixo: não passa por poder, resistência
        /// nem marcas, porque não é uma conjuração — é o golpe do outro voltando.
        /// Acontece ANTES da morte do alvo: quem morre espetado ainda espeta.
        /// </summary>
        void Refletir(Unidade alvo, int quantiaBruta, string uidFonte, bool semReflexo)
        {
            if (semReflexo || string.IsNullOrEmpty(uidFonte) || uidFonte == alvo.Uid) return;

            int pct = 0;
            for (int i = 0; i < alvo.Efeitos.Count; i++)
                if (alvo.Efeitos[i].Tipo == "reflect") pct += alvo.Efeitos[i].Valor;
            if (pct <= 0) return;

            var agressor = Acha(uidFonte);
            if (agressor == null || !agressor.NoTabuleiro) return;

            int volta = Arredonda(quantiaBruta * pct / 100.0);
            if (volta <= 0) return;

            Emitir(TipoDeEvento.Reflexo, alvo.Uid, fonte: agressor.Uid, q: volta);
            AplicarDano(agressor, volta, Dados.Elemento.Neutro, alvo.Uid, true);
        }

        /// <summary>
        /// TODA cura passa por aqui — efeito, regeneração e roubo de vida —,
        /// então é o único ponto em que a fúria da sala precisa cortar.
        /// </summary>
        int Curar(Unidade alvo, int quantia, string uidFonte)
        {
            if (alvo == null || !alvo.NoTabuleiro || quantia <= 0) return 0;
            quantia = Arredonda(quantia * EscalaDeCura());
            if (quantia <= 0) return 0;

            int curado = Math.Min(quantia, alvo.PVMax - alvo.PV);
            alvo.PV += curado;
            Emitir(TipoDeEvento.Cura, alvo.Uid, fonte: uidFonte, q: curado);
            return curado;
        }
    }
}
