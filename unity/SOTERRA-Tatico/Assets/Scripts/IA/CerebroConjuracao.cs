using System;
using System.Collections.Generic;
using UnityEngine;
using Soterra.Grade;

namespace Soterra.IA
{
    using Motor = global::Soterra.Motor;

    /// <summary>
    /// A metade da IA que escolhe FEITIÇO: quais casas mirar, se a mira é
    /// legítima, e quanto vale o estrago.
    ///
    /// Está em arquivo separado da escolha de casa pelo mesmo motivo que o
    /// <c>BatalhaConjuracao</c> está separado do <c>Batalha</c>: são duas
    /// perguntas diferentes, e juntas dão um arquivo que ninguém lê inteiro.
    ///
    /// A tabela de notas é a do <c>castValue</c> de <c>js/core/ai.js</c>, efeito
    /// por efeito, com os mesmos pesos. Os OITO tipos que o motor desta rodada
    /// ainda não executa — <c>summon</c>, <c>trap</c>, <c>weatherShift</c>,
    /// <c>chain</c>, <c>reflect</c>, <c>moveTo</c>, <c>teleport</c>,
    /// <c>swap</c> — valem ZERO aqui, e isso é decisão, não esquecimento: o
    /// motor os registra como <c>EfeitoIgnorado</c> e não faz nada. Pontuá-los
    /// faria o Xamã gastar 4 PA numa invocação que não chega, todo turno, para
    /// sempre. Quando o motor os implementar, as notas do <c>ai.js</c> entram
    /// aqui — estão no relatório desta rodada, uma a uma.
    /// </summary>
    public sealed partial class Cerebro
    {
        /// <summary>Uma conjuração possível, já com a nota.</summary>
        sealed class Lance
        {
            public string FeiticoId;
            public Vector2Int Alvo;
            public double Valor;
            public int CustoDePa;
        }

        // ---- escolha do feitiço ---------------------------------------------

        /// <summary>
        /// O melhor lance a partir de <paramref name="deCasa"/>, ou <c>null</c>
        /// se nada valer o PA.
        ///
        /// Um lance por chamada, e não a fila gulosa de oito do <c>ai.js</c>: o
        /// <see cref="JogarTurno"/> chama de novo depois de cada conjuração, e aí
        /// o PA já desceu, o contador de lançamentos já subiu e a recarga já foi
        /// escrita pelo próprio motor. A fila gulosa precisava manter cópias
        /// desses três controles à mão — e uma cópia que se desencontra do motor
        /// é uma IA que planeja o que a regra não deixa fazer.
        /// </summary>
        Lance MelhorConjuracaoDe(Quadro q, Vector2Int deCasa)
        {
            var eu = q.Eu;
            var empatados = new List<Lance>();
            double melhor = MinimoParaConjurar;

            for (int i = 0; i < eu.Feiticos.Count; i++)
            {
                var f = _banco.AchaFeitico(eu.Feiticos[i]);
                if (f == null) continue;
                if (f.CustoDePa > eu.PA) continue;

                int recarga;
                if (eu.Recargas.TryGetValue(f.Id, out recarga) && recarga > 0) continue;

                // `castsPerTurn: 0` é ILIMITADO, não "nenhum" — é o que o motor e
                // o `engine.js` fazem. Ler zero como proibição calaria as cargas
                // de armadilha.
                if (f.LancamentosPorTurno > 0)
                {
                    int jaSaiu;
                    eu.LancamentosNesteTurno.TryGetValue(f.Id, out jaSaiu);
                    if (jaSaiu >= f.LancamentosPorTurno) continue;
                }

                var alvos = AlvosCandidatos(q, f, deCasa);
                for (int c = 0; c < alvos.Count; c++)
                {
                    var alvo = alvos[c];
                    if (!MiraValida(q, f, deCasa, alvo)) continue;

                    double v = ValorDaConjuracao(q, f, deCasa, alvo);
                    if (v <= MinimoParaConjurar) continue;

                    if (v > melhor + Epsilon)
                    {
                        melhor = v;
                        empatados.Clear();
                        empatados.Add(new Lance { FeiticoId = f.Id, Alvo = alvo, Valor = v, CustoDePa = f.CustoDePa });
                    }
                    else if (v >= melhor - Epsilon)
                    {
                        empatados.Add(new Lance { FeiticoId = f.Id, Alvo = alvo, Valor = v, CustoDePa = f.CustoDePa });
                    }
                }
            }

            return Desempatar(empatados);
        }

        // ---- mira ------------------------------------------------------------

        static bool TemArea(Dados.Feitico f)
        {
            // Reusa a propriedade do próprio acervo em vez de repetir a conta:
            // um `circle` de tamanho 0 é alvo único disfarçado, e essa regra tem
            // de ser a MESMA que o motor aplica.
            return f.Area != null && !f.Area.ApenasAlvoUnico;
        }

        static Grade.Alcance GeometriaDe(Dados.Feitico f)
        {
            // Feitiço sem `range` vale {min:0, max:1}. O `default` da struct daria
            // alcance máximo ZERO — um corpo a corpo que só acerta a própria casa.
            if (f.Alcance == null) return Grade.Alcance.Padrao;
            return new Grade.Alcance(f.Alcance.Min, f.Alcance.Max, f.Alcance.Linha, f.Alcance.Visao);
        }

        /// <summary>
        /// Quem estará em pé nesta casa NA HORA da conjuração, contando que a
        /// unidade já terá andado até <paramref name="deCasa"/>.
        ///
        /// A relocação importa: sem ela a IA acha que continua na casa antiga,
        /// não se vê dentro da própria área de efeito e mira uma casa que o
        /// motor vai recusar por estar ocupada.
        /// </summary>
        Motor.Unidade OcupanteVisto(Quadro q, Vector2Int casa, Vector2Int deCasa)
        {
            if (casa == deCasa) return q.Eu;
            Motor.Unidade u;
            if (!q.PorCasa.TryGetValue(casa, out u)) return null;
            return u == q.Eu ? null : u;   // a casa de onde ela saiu fica vazia
        }

        /// <summary>
        /// A casa é alvo legítimo deste feitiço, lançado de
        /// <paramref name="deCasa"/>?
        ///
        /// É a mesma regra do <c>Batalha.CasaValida</c>, que é privado, aplicada
        /// a uma posição HIPOTÉTICA — o motor só sabe validar da casa em que a
        /// unidade está, e a IA precisa saber o que alcançaria depois de andar.
        /// Um teste desta rodada confere casa por casa, no tabuleiro inteiro, que
        /// as duas concordam quando a posição hipotética é a real; se algum dia
        /// divergirem, ele acusa.
        ///
        /// FEITIÇO DE ÁREA MIRA O CHÃO: com forma diferente de <c>single</c> e
        /// tamanho maior que zero, basta a casa estar no alcance. Sem isto,
        /// <c>targetSide: enemy</c> exigiria inimigo NA PRÓPRIA casa e não daria
        /// para largar a explosão entre dois.
        /// </summary>
        bool MiraValida(Quadro q, Dados.Feitico f, Vector2Int deCasa, Vector2Int alvo)
        {
            if (!GeometriaDe(f).Valido(_batalha.Mapa, deCasa, alvo)) return false;

            var ocupante = OcupanteVisto(q, alvo, deCasa);
            if (f.ExigeCasaVazia && ocupante != null) return false;

            if (TemArea(f) && (f.Alvo == Dados.Lado.Enemy || f.Alvo == Dados.Lado.Ally)) return true;

            if (f.Alvo == Dados.Lado.Enemy && (ocupante == null || ocupante.Lado == q.Eu.Lado)) return false;
            if (f.Alvo == Dados.Lado.Ally && (ocupante == null || ocupante.Lado != q.Eu.Lado)) return false;
            if (f.Alvo == Dados.Lado.Self && alvo != deCasa) return false;

            return true;
        }

        /// <summary>
        /// As casas que vale a pena TENTAR mirar.
        ///
        /// Não é o tabuleiro inteiro de propósito: <c>AlvosDe</c> varre 357 casas
        /// no Vestíbulo, e a IA repete a varredura por feitiço e por casa
        /// alcançável. O <c>ai.js</c> resolve isso mirando só onde há gente (mais
        /// os quatro vizinhos de cada inimigo, quando o feitiço tem área — é onde
        /// a explosão pega dois). Feitiço que exige casa VAZIA é a exceção: ele
        /// nunca cai em cima de ninguém, então precisa do losango inteiro.
        /// </summary>
        List<Vector2Int> AlvosCandidatos(Quadro q, Dados.Feitico f, Vector2Int deCasa)
        {
            var saida = new List<Vector2Int>();
            var vistas = new HashSet<Vector2Int>();

            if (f.ExigeCasaVazia || TemEfeitoDoTipo(f, "trap"))
            {
                int r = f.Alcance == null ? 1 : f.Alcance.Max;
                for (int dy = r; dy >= -r; dy--)
                    for (int dx = -r; dx <= r; dx++)
                        if (Math.Abs(dx) + Math.Abs(dy) <= r)
                            Juntar(saida, vistas, new Vector2Int(deCasa.x + dx, deCasa.y + dy));
                return saida;
            }

            bool temArea = TemArea(f);
            for (int i = 0; i < _batalha.Unidades.Count; i++)
            {
                var u = _batalha.Unidades[i];
                if (!u.NoTabuleiro) continue;
                Juntar(saida, vistas, u.Casa);

                if (temArea && u.Lado != q.Eu.Lado)
                {
                    Juntar(saida, vistas, new Vector2Int(u.Casa.x + 1, u.Casa.y));
                    Juntar(saida, vistas, new Vector2Int(u.Casa.x - 1, u.Casa.y));
                    Juntar(saida, vistas, new Vector2Int(u.Casa.x, u.Casa.y + 1));
                    Juntar(saida, vistas, new Vector2Int(u.Casa.x, u.Casa.y - 1));
                }
            }

            // Auto-alvo: só quando o alcance mínimo é zero. Com mínimo 1 a
            // própria casa está fora do alcance e mirá-la seria pedir recusa.
            if ((f.Alcance == null ? 0 : f.Alcance.Min) == 0) Juntar(saida, vistas, deCasa);

            return saida;
        }

        static void Juntar(List<Vector2Int> saida, HashSet<Vector2Int> vistas, Vector2Int p)
        {
            if (vistas.Add(p)) saida.Add(p);
        }

        static bool TemEfeitoDoTipo(Dados.Feitico f, string tipo)
        {
            if (f.Efeitos == null) return false;
            for (int i = 0; i < f.Efeitos.Count; i++)
                if (f.Efeitos[i] != null && f.Efeitos[i].Tipo == tipo) return true;
            return false;
        }

        /// <summary>
        /// O feitiço machuca? É o conjunto <c>HOSTILE</c> do <c>ai.js</c>, mais
        /// bônus e resistência NEGATIVOS, que são hostis apesar do nome.
        /// </summary>
        static bool EhHostil(Dados.Feitico f)
        {
            if (f.Efeitos == null) return false;
            for (int i = 0; i < f.Efeitos.Count; i++)
            {
                var e = f.Efeitos[i];
                if (e == null) continue;
                switch (e.Tipo)
                {
                    case "damage":
                    case "poison":
                    case "push":
                    case "pull":
                    case "root":
                    case "mark":
                    case "detonateMarks":
                    case "dispelShield":
                    case "chain":
                        return true;
                    case "buff":
                    case "resist":
                        if ((e.Valor ?? 0) < 0) return true;
                        break;
                }
            }
            return false;
        }

        // ---- quanto vale ------------------------------------------------------

        /// <summary>
        /// A nota de lançar <paramref name="f"/> em <paramref name="alvo"/>
        /// estando em <paramref name="deCasa"/>. Zero ou menos quer dizer "não
        /// vale".
        /// </summary>
        double ValorDaConjuracao(Quadro q, Dados.Feitico f, Vector2Int deCasa, Vector2Int alvo)
        {
            var eu = q.Eu;
            var ocupanteDoAlvo = OcupanteVisto(q, alvo, deCasa);

            // PROVOCAÇÃO: havendo provocador vivo, feitiço hostil só pode MIRAR a
            // casa de um provocador. Respingo de área nos outros continua valendo
            // — o que a provocação prende é a mira, não a explosão.
            if (q.Provocadores.Count > 0 && EhHostil(f))
            {
                if (ocupanteDoAlvo == null || !q.UidsDeProvocador.Contains(ocupanteDoAlvo.Uid)) return -1;
            }

            // Invisível nunca é mirado diretamente.
            if (ocupanteDoAlvo != null && ocupanteDoAlvo.Lado != eu.Lado &&
                Motor.Batalha.TemEfeito(ocupanteDoAlvo, "invisible")) return -1;

            var forma = f.Area == null ? Forma.Single : f.Area.Forma;
            int tamanho = f.Area == null ? 0 : f.Area.Tamanho;
            var casas = Area.Casas(_batalha.Mapa, deCasa, alvo, forma, tamanho);

            var atingidos = new List<Motor.Unidade>();
            for (int i = 0; i < casas.Count; i++)
            {
                var u = OcupanteVisto(q, casas[i], deCasa);
                if (u != null && !atingidos.Contains(u)) atingidos.Add(u);
            }

            var efeitos = f.Efeitos;
            if (efeitos == null) return 0;

            double valor = 0;
            for (int e = 0; e < efeitos.Count; e++)
            {
                var eff = efeitos[e];
                if (eff == null || string.IsNullOrEmpty(eff.Tipo)) continue;
                valor += ValorDoEfeito(q, f, eff, deCasa, atingidos);
            }
            return valor;
        }

        double ValorDoEfeito(Quadro q, Dados.Feitico f, Dados.Efeito eff,
                             Vector2Int deCasa, List<Motor.Unidade> atingidos)
        {
            var eu = q.Eu;
            double valor = 0;
            int t;

            switch (eff.Tipo)
            {
                case "damage":
                    for (t = 0; t < atingidos.Count; t++)
                    {
                        var u = atingidos[t];
                        if (u == eu) continue;   // o motor exclui o conjurador do dano
                        double dano = DanoEsperado(q, u, f, eff);
                        if (u.Lado != eu.Lado)
                        {
                            if (Motor.Batalha.TemEfeito(u, "invisible")) continue;
                            valor += dano;
                            if (dano >= u.PV + u.Escudo) valor += 40;              // abate
                            if (u.PVMax > 0) valor += (1 - (double)u.PV / u.PVMax) * 8;  // prefere feridos
                            valor -= ViesDoClima(q, u) * 2;                        // o clima já o castiga
                            if (eff.RoubaVida)
                                valor += Math.Min((dano / 2) * q.EscalaDeCura, eu.PVMax - eu.PV) * 0.6;
                        }
                        else
                        {
                            valor -= dano * 1.6;   // fogo amigo custa mais do que o dano rende
                        }
                    }
                    break;

                case "poison":
                    for (t = 0; t < atingidos.Count; t++)
                    {
                        var u = atingidos[t];
                        if (u == eu) continue;
                        double dano = DanoEsperado(q, u, f, eff) * (eff.Duracao ?? 1);
                        if (u.Lado != eu.Lado)
                        {
                            if (!Motor.Batalha.TemEfeito(u, "invisible")) valor += dano * 0.8;
                        }
                        else valor -= dano * 1.2;
                    }
                    break;

                case "heal":
                    for (t = 0; t < atingidos.Count; t++)
                    {
                        var u = atingidos[t];
                        double curado = Math.Min(Media(eff) * q.EscalaDeCura, u.PVMax - u.PV);
                        if (u.Lado == eu.Lado) valor += curado * (q.Papel == Papel.Suporte ? 1.3 : 0.9);
                        else valor -= curado;
                    }
                    break;

                case "regen":
                    for (t = 0; t < atingidos.Count; t++)
                    {
                        var u = atingidos[t];
                        if (u.Lado != eu.Lado) continue;
                        valor += Math.Min(Media(eff) * (eff.Duracao ?? 1) * q.EscalaDeCura,
                                          u.PVMax - u.PV) * 0.6;
                    }
                    break;

                case "shield":
                    for (t = 0; t < atingidos.Count; t++)
                    {
                        var u = atingidos[t];
                        if (u.Lado != eu.Lado) continue;
                        // Escudo em quem ninguém está ameaçando é PA jogado fora:
                        // o 0,05 mantém a opção viva sem deixá-la ganhar de nada.
                        bool engajado = DistanciaAoInimigoMaisPerto(q, u.Casa) <= 3;
                        valor += (eff.Valor ?? 0) * ((engajado || u.PV < u.PVMax) ? 0.6 : 0.05);
                    }
                    break;

                case "buff":
                    for (t = 0; t < atingidos.Count; t++)
                    {
                        var u = atingidos[t];
                        if ((eff.Valor ?? 0) >= 0)
                        {
                            if (u.Lado != eu.Lado) { valor -= 10; continue; }   // buffar inimigo
                            valor += (eff.Atributo == "power") ? 10 : 5;
                        }
                        else
                        {
                            if (u.Lado == eu.Lado) { valor -= 10; continue; }
                            if (Motor.Batalha.TemEfeito(u, "invisible")) continue;
                            valor += 5 + Math.Abs(eff.Valor ?? 0) * 2;
                        }
                    }
                    break;

                case "resist":
                    for (t = 0; t < atingidos.Count; t++)
                    {
                        var u = atingidos[t];
                        if ((eff.Valor ?? 0) >= 0) valor += (u.Lado == eu.Lado) ? 4 : -4;
                        else valor += (u.Lado != eu.Lado && !Motor.Batalha.TemEfeito(u, "invisible")) ? 5 : -4;
                    }
                    break;

                case "root":
                    for (t = 0; t < atingidos.Count; t++)
                    {
                        var u = atingidos[t];
                        if (u == eu) continue;
                        if (u.Lado == eu.Lado) { valor -= 14; continue; }
                        if (Motor.Batalha.TemEfeito(u, "invisible")) continue;
                        if (Motor.Batalha.TemEfeito(u, "root")) { valor += 1; continue; }  // só renova
                        // Prender vale mais contra quem depende de chegar perto,
                        // e mais ainda quando quem prende joga de longe.
                        valor += 9 + Math.Min(6, u.PPMax) * (q.Papel == Papel.Distancia ? 2.0 : 1.0);
                    }
                    break;

                case "mark":
                    for (t = 0; t < atingidos.Count; t++)
                    {
                        var u = atingidos[t];
                        if (u == eu || u.Lado == eu.Lado || Motor.Batalha.TemEfeito(u, "invisible")) continue;
                        int teto = eff.Max ?? Motor.Batalha.MaximoPadraoDeMarcas;
                        if (ContaMarcas(u) >= teto) { valor += 1; continue; }   // no teto, só renova
                        valor += 6 + (eff.Valor ?? Motor.Batalha.ValorPadraoDaMarca) * 0.8;
                    }
                    break;

                case "detonateMarks":
                    for (t = 0; t < atingidos.Count; t++)
                    {
                        var u = atingidos[t];
                        if (u == eu || u.Lado == eu.Lado || Motor.Batalha.TemEfeito(u, "invisible")) continue;
                        int pilhas = ContaMarcas(u);
                        if (pilhas <= 0) continue;   // sem marcas não vale o PA
                        double estouro = pilhas * (eff.Multiplicador ?? 0);
                        valor += estouro;
                        if (estouro >= u.PV + u.Escudo) valor += 40;
                    }
                    break;

                case "push":
                    for (t = 0; t < atingidos.Count; t++)
                    {
                        var u = atingidos[t];
                        if (u == eu || u.Lado == eu.Lado || Motor.Batalha.TemEfeito(u, "invisible")) continue;
                        if (u.ImuneAEmpurrao) continue;
                        valor += 3 + ColisaoDoEmpurrao(q, deCasa, u, eff.Casas ?? 0);
                    }
                    break;

                case "pull":
                    for (t = 0; t < atingidos.Count; t++)
                    {
                        var u = atingidos[t];
                        if (u == eu || u.Lado == eu.Lado || Motor.Batalha.TemEfeito(u, "invisible")) continue;
                        if (u.ImuneAEmpurrao) continue;
                        int ganho = Math.Min(eff.Casas ?? 0,
                                             Math.Max(0, Distancia.Manhattan(deCasa, u.Casa) - 1));
                        valor += 2 + ganho * ((q.Papel == Papel.Chefe || q.Papel == Papel.Corpo) ? 2.5 : 1);
                    }
                    break;

                case "cleanse":
                    for (t = 0; t < atingidos.Count; t++)
                    {
                        var u = atingidos[t];
                        if (u.Lado != eu.Lado) continue;
                        var tipos = eff.Tipos;
                        if (tipos == null) continue;
                        int n = 0;
                        for (int k = 0; k < u.Efeitos.Count; k++)
                            if (tipos.Contains(u.Efeitos[k].Tipo)) n++;
                        valor += n * 7;
                    }
                    break;

                case "dispelShield":
                    for (t = 0; t < atingidos.Count; t++)
                    {
                        var u = atingidos[t];
                        if (u == eu || u.Lado == eu.Lado || Motor.Batalha.TemEfeito(u, "invisible")) continue;
                        valor += u.Escudo * 0.8;
                    }
                    break;

                case "taunt":
                    // A nota olha para o CONJURADOR, não para os atingidos: o que
                    // a provocação compra é o próximo turno dos inimigos que já
                    // estão por perto. Provocar de longe não puxa ninguém.
                    if (!Motor.Batalha.TemEfeito(eu, "taunt"))
                    {
                        int perto = 0;
                        for (t = 0; t < q.Inimigos.Count; t++)
                            if (Distancia.Manhattan(deCasa, q.Inimigos[t].Casa) <= 4) perto++;
                        valor += 6 + perto * 4;
                    }
                    break;

                case "invisible":
                    if (!Motor.Batalha.TemEfeito(eu, "invisible"))
                        valor += (eu.PVMax > 0 && (double)eu.PV / eu.PVMax < 0.6) ? 8 : 1;
                    break;

                // `summon`, `trap`, `weatherShift`, `chain`, `reflect`, `moveTo`,
                // `teleport` e `swap` caem aqui e valem ZERO. O motor desta
                // rodada os registra como `EfeitoIgnorado` e não faz nada; dar
                // nota a eles faria a IA pagar PA por um efeito que não sai. Ver
                // o cabeçalho deste arquivo e o relatório da rodada.
                default:
                    break;
            }

            return valor;
        }

        // ---- contas auxiliares -----------------------------------------------

        static double Media(Dados.Efeito eff)
        {
            return ((eff.Min ?? 0) + (eff.Max ?? 0)) / 2.0;
        }

        /// <summary>
        /// O dano que se espera desta vítima — pela MÉDIA da faixa, e com os
        /// números do próprio motor.
        ///
        /// Poder, resistência e multiplicador de marcas são perguntados a
        /// <see cref="Soterra.Motor.Batalha"/> em vez de recalculados: o poder
        /// já traz o ganho elemental e a fúria da sala, e a resistência já traz
        /// os efeitos ativos. Refazer essas três contas aqui seria a maneira mais
        /// certa de a IA achar que mata e o motor não matar.
        /// </summary>
        double DanoEsperado(Quadro q, Motor.Unidade vitima, Dados.Feitico f, Dados.Efeito eff)
        {
            double media = Media(eff);
            int poder = _batalha.PoderDeConjuracao(q.Eu, f);
            int resistencia = _batalha.ResistenciaEfetiva(vitima, eff.Elemento);
            double marcas = _batalha.MultiplicadorDeMarcas(vitima);
            double v = media * (100.0 + poder) / 100.0 * (100.0 - resistencia) / 100.0 * marcas;
            return Math.Max(0, v);
        }

        static int ContaMarcas(Motor.Unidade u)
        {
            int n = 0;
            for (int i = 0; i < u.Efeitos.Count; i++) if (u.Efeitos[i].Tipo == "mark") n++;
            return n;
        }

        /// <summary>
        /// Quanto machuca o empurrão: 10 por casa que a vítima NÃO conseguiu
        /// percorrer. É a mesma conta do <c>MovimentoForcado</c> do motor —
        /// direção travada no eixo dominante, sem diagonal.
        /// </summary>
        double ColisaoDoEmpurrao(Quadro q, Vector2Int deCasa, Motor.Unidade vitima, int casas)
        {
            int ddx = vitima.Casa.x - deCasa.x, ddy = vitima.Casa.y - deCasa.y;
            if (ddx == 0 && ddy == 0) return 0;

            int sx = 0, sy = 0;
            if (Math.Abs(ddx) >= Math.Abs(ddy)) sx = ddx >= 0 ? 1 : -1;
            else sy = ddy > 0 ? 1 : -1;

            var p = vitima.Casa;
            int andou = 0;
            for (int i = 0; i < casas; i++)
            {
                var n = new Vector2Int(p.x + sx, p.y + sy);
                if (!_batalha.Mapa.Andavel(n) || OcupanteVisto(q, n, deCasa) != null) break;
                p = n;
                andou++;
            }
            return 10 * (casas - andou);
        }

        /// <summary>
        /// O clima favorece (+1) ou castiga (−1) esta unidade?
        ///
        /// Serve para descontar da nota o inimigo que o clima já vai matando: 5
        /// PV por turno saem dele de graça, e gastar o feitiço bom nele é
        /// desperdiçar o que a sala faria sozinha.
        /// </summary>
        static int ViesDoClima(Quadro q, Motor.Unidade u)
        {
            if (q.Clima == null) return 0;
            int v = 0;
            if (!string.IsNullOrEmpty(q.Clima.Favorece) && q.Clima.Favorece == u.Elemento) v += 1;
            if (!string.IsNullOrEmpty(q.Clima.Prejudica) && q.Clima.Prejudica == u.Elemento) v -= 1;
            return v;
        }
    }
}
