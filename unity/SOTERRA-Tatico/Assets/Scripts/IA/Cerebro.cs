using System;
using System.Collections.Generic;
using UnityEngine;
using Soterra.Grade;

namespace Soterra.IA
{
    // Ver a nota em Papel.cs: `Batalha` solto acha o NAMESPACE `Soterra.Batalha`
    // antes do tipo `Soterra.Motor.Batalha`, e o apelido global trava no certo.
    using Motor = global::Soterra.Motor;

    /// <summary>
    /// Quem joga pelo monstro.
    ///
    /// É o porte de <c>js/core/ai.js</c> — mesmas notas, mesmos papéis, mesmas
    /// regras herdadas (provocador obrigatório, invisível nunca é mirado). C#
    /// puro: nenhum <c>MonoBehaviour</c>, nenhuma cena, nenhum
    /// <c>Resources.Load</c>, porque uma IA que só roda com o jogo aberto não
    /// se testa e não se reproduz num relato de defeito.
    ///
    /// NÃO reescreve o motor. Alcance de passo, alvos, área, chance de esquiva,
    /// poder de conjuração e resistência efetiva são perguntados a
    /// <see cref="Soterra.Motor.Batalha"/>, que já os responde e já é testado.
    /// O que mora aqui é só a ESCOLHA — para onde andar, o que lançar, e quando
    /// parar.
    ///
    /// A IA não decide fusão. No JS a Fusão é decisão do jogador, e trazê-la
    /// para cá tiraria do jogador a mecânica mais própria do jogo.
    /// </summary>
    public sealed partial class Cerebro
    {
        // ---- números do `ai.js`, todos com o nome que têm lá ------------------

        /// <summary>
        /// Distância atribuída a uma casa de onde NÃO se chega ao alvo. É o
        /// <c>fd = 50</c> do <c>ai.js</c>: um número grande o bastante para
        /// perder de qualquer casa alcançável, e finito para não contaminar a
        /// soma com infinito.
        /// </summary>
        public const double DistanciaInalcancavel = 50;

        /// <summary>
        /// Nota mínima para uma conjuração valer o PA (<c>v &gt; 0.5</c> no
        /// <c>ai.js</c>). Abaixo disso a unidade guarda o PA — gastar turno num
        /// feitiço que rende meio ponto é como passar o turno, só que mais lento.
        /// </summary>
        public const double MinimoParaConjurar = 0.5;

        /// <summary>
        /// Teto de jogadas num turno só. O maior PA+PP do acervo é 13 (o
        /// <c>boss-riftheart</c>), e toda jogada aceita gasta pelo menos um dos
        /// dois — o teto nunca é alcançado numa batalha sã. Ele existe para o
        /// dia em que uma jogada recusada não gastar recurso nenhum: passar o
        /// turno é ruim, travar o Editor num laço infinito é pior.
        /// </summary>
        public const int TetoDeJogadas = 24;

        /// <summary>
        /// Quanto duas notas podem diferir e ainda serem "a mesma nota".
        ///
        /// É proteção contra ruído de ponto flutuante, não faixa de tolerância:
        /// duas casas simétricas produzem a MESMA conta por caminhos diferentes,
        /// e a soma em <c>double</c> pode devolver 12,299999999999999 numa e
        /// 12,3 na outra. Alargar isto viraria empate onde há preferência.
        /// </summary>
        public const double Epsilon = 1e-9;

        /// <summary>Não há marca de desempate: empate fica com a primeira opção.</summary>
        public const int SemDesempate = -1;

        readonly Dados.BancoDeDados _banco;
        readonly Motor.Batalha _batalha;
        readonly int _marcaDeDesempate;

        /// <summary>O sorteio DESTA decisão. Ver <see cref="SorteDaDecisao"/>.</summary>
        Motor.Sorte _sorteDaVez;

        /// <summary>
        /// <paramref name="sorte"/> desempata — e só desempata. A nota é sempre
        /// a mesma conta determinística do <c>ai.js</c>; o sorteio só entra
        /// quando duas opções valem EXATAMENTE o mesmo, o que numa sala
        /// simétrica como o Vestíbulo das Heras acontece o tempo todo (dois
        /// Bufos idênticos, duas casas espelhadas). Sem ele o monstro escolhe
        /// sempre o mesmo lado e o jogador decora a sala; com ele varia, e com a
        /// MESMA semente varia igual — que é o que permite reproduzir uma
        /// batalha num relato de defeito.
        ///
        /// Do sorteio injetado sai UM número, aqui, uma vez só: a MARCA. Cada
        /// decisão depois sorteia de uma corrente nova, semeada pela marca mais
        /// a situação (ver <see cref="SorteDaDecisao"/>). Guardar a corrente
        /// aberta seria mais direto e estaria errado: <see cref="Decidir"/>
        /// avalia dezenas de casas e cada empate no meio da avaliação puxaria um
        /// número, então perguntar duas vezes seguidas "o que você faria?"
        /// devolveria respostas diferentes sem que nada no tabuleiro tivesse
        /// mudado — e uma IA assim não se depura.
        ///
        /// <c>null</c> é legítimo e continua determinístico: sem sorteio, empate
        /// fica com a primeira opção em ordem de leitura do tabuleiro.
        /// </summary>
        public Cerebro(Dados.BancoDeDados banco, Motor.Batalha batalha, Motor.Sorte sorte = null)
        {
            if (banco == null) throw new ArgumentNullException("banco");
            if (batalha == null) throw new ArgumentNullException("batalha");
            _banco = banco;
            _batalha = batalha;
            _marcaDeDesempate = sorte == null ? SemDesempate : sorte.Inteiro(0, 999999999);
        }

        /// <summary>
        /// A corrente de sorteio desta decisão: marca + situação.
        ///
        /// A situação entra na semente para que duas decisões diferentes do
        /// MESMO turno (andar e depois conjurar) não desempatem com o mesmo
        /// número — e para que a decisão seja função só do tabuleiro, nunca de
        /// quantas vezes alguém já perguntou.
        /// </summary>
        Motor.Sorte SorteDaDecisao(Motor.Unidade eu)
        {
            if (_marcaDeDesempate == SemDesempate) return null;
            return Motor.Sorte.DeTexto(
                _marcaDeDesempate + "|" + _batalha.Rodada + "|" + eu.Uid + "|" +
                eu.Casa.x + "," + eu.Casa.y + "|" + eu.PA + "|" + eu.PP);
        }

        public Papel PapelDe(Motor.Unidade u) { return Papeis.De(_banco, u); }

        // ---- a decisão -------------------------------------------------------

        /// <summary>
        /// O que a unidade da vez faz agora. NÃO muta nada: chamar duas vezes
        /// seguidas devolve a mesma jogada.
        ///
        /// A ordem é a do <c>ai.js</c>: escolhe a MELHOR casa (contando o que dá
        /// para conjurar de cada uma) e, se não for a de agora, anda até lá
        /// antes de qualquer outra coisa. Conjurar antes de andar prenderia a
        /// unidade a um alvo pior — foi para isso que o JS avaliou casa e
        /// feitiço juntos, e não um depois do outro.
        /// </summary>
        public Jogada Decidir()
        {
            var eu = _batalha.Atual;
            if (_batalha.Fase != Motor.FaseDaBatalha.EmAndamento)
                return Passar(eu, "a batalha já acabou");
            if (eu == null || !eu.NoTabuleiro)
                return Passar(eu, "não há unidade jogando");

            _sorteDaVez = SorteDaDecisao(eu);
            var q = MontarQuadro(eu);

            // Sem inimigo à vista não há o que decidir. Andar "para lugar
            // nenhum" gastaria PP e mexeria a unidade de uma posição escolhida
            // por quem desenhou a sala.
            if (q.Inimigos.Count == 0) return Passar(eu, "nenhum inimigo visível");

            var escolha = EscolherCasa(q);

            if (escolha.Casa != eu.Casa)
            {
                return new Jogada
                {
                    Tipo = TipoDeJogada.Andar,
                    Uid = eu.Uid,
                    Casa = escolha.Casa,
                    Valor = escolha.Nota,
                    Motivo = MotivoDoPasso(q, escolha.Casa)
                };
            }

            var lance = MelhorConjuracaoDe(q, eu.Casa);
            if (lance != null)
            {
                return new Jogada
                {
                    Tipo = TipoDeJogada.Conjurar,
                    Uid = eu.Uid,
                    Casa = lance.Alvo,
                    FeiticoId = lance.FeiticoId,
                    Valor = lance.Valor,
                    Motivo = "melhor lance daqui"
                };
            }

            return Passar(eu, eu.PA <= 0 ? "sem PA" : "nada que valha o PA daqui");
        }

        /// <summary>Manda a jogada para o motor. É o ÚNICO ponto que muta a batalha.</summary>
        public Motor.Resultado Executar(Jogada j)
        {
            if (j == null) throw new ArgumentNullException("j");
            switch (j.Tipo)
            {
                case TipoDeJogada.Andar: return _batalha.Andar(j.Casa);
                case TipoDeJogada.Conjurar: return _batalha.Conjurar(j.FeiticoId, j.Casa);
                default: return _batalha.EncerrarTurno();
            }
        }

        /// <summary>Decide e executa UMA jogada.</summary>
        public Motor.Resultado Jogar()
        {
            return Executar(Decidir());
        }

        /// <summary>
        /// Joga o turno inteiro da unidade da vez, terminando SEMPRE em
        /// <see cref="TipoDeJogada.Passar"/> — quer dizer, em
        /// <c>EncerrarTurno</c>. Uma IA que às vezes não passa a vez trava a
        /// batalha, e o sintoma aparece longe daqui.
        /// </summary>
        public Motor.Resultado JogarTurno()
        {
            var tudo = new Motor.Resultado();
            if (_batalha.Fase != Motor.FaseDaBatalha.EmAndamento) return tudo;

            var quem = _batalha.Atual;
            int recusasSeguidas = 0;

            for (int i = 0; i < TetoDeJogadas; i++)
            {
                // A unidade pode sair do tabuleiro no meio do próprio turno (o
                // clima mata no começo do turno seguinte, um reflexo mataria
                // aqui). Continuar decidindo por ela produziria jogada de morto.
                if (_batalha.Fase != Motor.FaseDaBatalha.EmAndamento) return tudo;
                if (_batalha.Atual != quem) return tudo;

                var j = Decidir();
                var r = Executar(j);
                tudo.Eventos.AddRange(r.Eventos);

                if (j.Tipo == TipoDeJogada.Passar) return tudo;

                if (r.Valido) { recusasSeguidas = 0; continue; }

                // Uma recusa é normal e esperada: o teste de fixação do motor
                // cancela o passo e zera o PP. Duas seguidas não são — significam
                // que a IA está propondo algo que o motor não aceita, e insistir
                // esconderia o defeito atrás de um turno perdido.
                tudo.Valido = false;
                tudo.Recusa = r.Recusa;
                if (++recusasSeguidas >= 2) break;
            }

            if (_batalha.Fase == Motor.FaseDaBatalha.EmAndamento && _batalha.Atual == quem)
                tudo.Eventos.AddRange(_batalha.EncerrarTurno().Eventos);
            return tudo;
        }

        static Jogada Passar(Motor.Unidade eu, string motivo)
        {
            return new Jogada
            {
                Tipo = TipoDeJogada.Passar,
                Uid = eu == null ? null : eu.Uid,
                Motivo = motivo
            };
        }

        // ---- escolha de casa -------------------------------------------------

        struct EscolhaDeCasa
        {
            public Vector2Int Casa;
            public double Nota;
        }

        /// <summary>
        /// A melhor casa para terminar o movimento, contando o que dá para
        /// conjurar DE LÁ.
        ///
        /// Avaliar casa e feitiço juntos é o miolo do <c>ai.js</c>: uma casa
        /// dois passos mais longe do inimigo pode valer mais do que a colada, se
        /// só dela o feitiço bom alcança. Escolher a casa primeiro e o feitiço
        /// depois faria o arqueiro correr até o corpo a corpo para atirar.
        /// </summary>
        EscolhaDeCasa EscolherCasa(Quadro q)
        {
            var eu = q.Eu;
            var candidatas = CasasCandidatas(eu);

            var empatadas = new List<Vector2Int>();
            double melhor = double.NegativeInfinity;

            for (int i = 0; i < candidatas.Count; i++)
            {
                var casa = candidatas[i].Casa;
                double nota = NotaDaCasa(q, casa, candidatas[i].Custo);

                if (nota > melhor + Epsilon)
                {
                    melhor = nota;
                    empatadas.Clear();
                    empatadas.Add(casa);
                }
                else if (nota >= melhor - Epsilon)
                {
                    empatadas.Add(casa);
                }
            }

            return new EscolhaDeCasa { Casa = Desempatar(empatadas), Nota = melhor };
        }

        struct Candidata
        {
            public Vector2Int Casa;
            public int Custo;
        }

        /// <summary>
        /// A casa de agora mais tudo que o PP alcança, em ordem de LEITURA do
        /// tabuleiro.
        ///
        /// A ordenação não é enfeite: <c>AlcanceDePasso</c> devolve um
        /// <c>Dictionary</c>, e a ordem de percurso de um dicionário é detalhe de
        /// implementação. Sem ordenar, dois empates perfeitos poderiam ser
        /// desempatados de um jeito hoje e de outro depois de uma atualização do
        /// runtime — e a batalha deixaria de reproduzir.
        /// </summary>
        List<Candidata> CasasCandidatas(Motor.Unidade eu)
        {
            var saida = new List<Candidata>();
            saida.Add(new Candidata { Casa = eu.Casa, Custo = 0 });

            foreach (var par in _batalha.AlcanceDePasso())
                saida.Add(new Candidata { Casa = par.Key, Custo = par.Value });

            saida.Sort((a, b) => OrdemDeLeitura(a.Casa, b.Casa));
            return saida;
        }

        /// <summary>Y maior primeiro (linha de cima), depois X menor — como o desenho se lê.</summary>
        static int OrdemDeLeitura(Vector2Int a, Vector2Int b)
        {
            if (a.y != b.y) return b.y.CompareTo(a.y);
            return a.x.CompareTo(b.x);
        }

        double NotaDaCasa(Quadro q, Vector2Int casa, int custo)
        {
            var eu = q.Eu;

            var lance = MelhorConjuracaoDe(q, casa);
            double nota = lance != null ? lance.Valor : 0;

            int perto = DistanciaAoInimigoMaisPerto(q, casa);
            double aoAlvo = DistanciaNoCampo(q, casa);

            switch (q.Papel)
            {
                case Papel.Corpo:
                    nota += -1.2 * aoAlvo;
                    break;

                case Papel.Distancia:
                    // Distância IDEAL, não máxima: colar perde o alcance e ficar
                    // longe demais perde o alvo. O −6 de colado é o que faz o
                    // atirador recuar em vez de trocar sopapo.
                    nota += -1.5 * Math.Abs(perto - q.AlcanceIdeal);
                    if (perto <= 1) nota -= 6;
                    break;

                case Papel.Suporte:
                    var ancora = q.Ferido ?? (q.Aliados.Count > 0 ? q.Aliados[0] : null);
                    if (ancora != null) nota += -0.8 * Distancia.Manhattan(casa, ancora.Casa);
                    else nota += -0.4 * aoAlvo;
                    if (perto <= 1) nota -= 4;
                    break;

                default: // Chefe
                    nota += -0.8 * aoAlvo;
                    break;
            }

            // Andar de graça não existe: o PP gasto agora é o PP que falta para
            // reagir depois. O peso é pequeno de propósito — desempata, não manda.
            nota += -0.05 * custo;

            // Ficar parado ganha um fio de vantagem, senão a unidade troca de
            // casa por diferença de arredondamento e o tabuleiro fica nervoso
            // sem que nada mude no jogo.
            if (casa == eu.Casa) nota += 0.1;

            // Sair de perto de quem prende cobra teste de esquiva, e a falha leva
            // TODO o PP restante sem tirar a unidade do lugar. A penalidade é
            // proporcional ao risco REAL, medido pela chance do próprio motor.
            if (casa != eu.Casa && _batalha.Arriscada(casa)) nota -= 18 * q.RiscoDeEsquiva;

            return nota;
        }

        string MotivoDoPasso(Quadro q, Vector2Int destino)
        {
            int antes = DistanciaAoInimigoMaisPerto(q, q.Eu.Casa);
            int depois = DistanciaAoInimigoMaisPerto(q, destino);
            if (depois < antes) return "aproxima-se do alvo";
            if (depois > antes) return "abre distância";
            return "reposiciona-se";
        }

        // ---- desempate -------------------------------------------------------

        /// <summary>
        /// Escolhe entre opções de nota IDÊNTICA. Com sorteio injetado, sorteia;
        /// sem ele, fica com a primeira em ordem de leitura. Os dois caminhos são
        /// determinísticos — o que muda é se a mesma sala sempre produz a mesma
        /// batalha ou uma batalha por semente.
        /// </summary>
        Vector2Int Desempatar(List<Vector2Int> empatadas)
        {
            if (empatadas.Count == 0) return _batalha.Atual.Casa;
            if (empatadas.Count == 1 || _sorteDaVez == null) return empatadas[0];
            return empatadas[_sorteDaVez.Inteiro(0, empatadas.Count - 1)];
        }

        Lance Desempatar(List<Lance> empatados)
        {
            if (empatados.Count == 0) return null;
            if (empatados.Count == 1 || _sorteDaVez == null) return empatados[0];
            return empatados[_sorteDaVez.Inteiro(0, empatados.Count - 1)];
        }

        // ---- o que a IA vê deste turno ---------------------------------------

        /// <summary>
        /// A leitura do tabuleiro que vale por UMA decisão.
        ///
        /// Montada de uma vez e passada adiante em vez de reconsultada: a nota de
        /// cada casa percorre todos os inimigos e todos os feitiços, e refazer a
        /// varredura por casa multiplicaria o custo pelo número de casas
        /// alcançáveis. Espelha o objeto `ctx` do <c>ai.js</c>.
        /// </summary>
        sealed class Quadro
        {
            public Motor.Unidade Eu;
            public Papel Papel;
            public List<Motor.Unidade> Inimigos = new List<Motor.Unidade>();
            public List<Motor.Unidade> Aliados = new List<Motor.Unidade>();
            public List<Motor.Unidade> Provocadores = new List<Motor.Unidade>();
            public HashSet<string> UidsDeProvocador = new HashSet<string>();
            public Dictionary<Vector2Int, Motor.Unidade> PorCasa = new Dictionary<Vector2Int, Motor.Unidade>();

            /// <summary>Passos até o alvo primário, atravessando unidades (ver <see cref="CampoDeDistancia"/>).</summary>
            public Dictionary<Vector2Int, int> Campo;

            public Vector2Int CasaDoAlvo;
            public Motor.Unidade Ferido;
            public int AlcanceIdeal = 1;
            public double RiscoDeEsquiva;
            public double EscalaDeCura = 1.0;
            public Dados.Clima Clima;
        }

        Quadro MontarQuadro(Motor.Unidade eu)
        {
            var q = new Quadro { Eu = eu, Papel = PapelDe(eu) };

            for (int i = 0; i < _batalha.Unidades.Count; i++)
            {
                var u = _batalha.Unidades[i];
                if (!u.NoTabuleiro) continue;
                q.PorCasa[u.Casa] = u;
                if (u == eu) continue;

                if (u.Lado == eu.Lado) { q.Aliados.Add(u); continue; }

                // Invisível não entra na lista de inimigos: no `ai.js` ele não é
                // mirado NEM contado na área. Tratá-lo como alvo faria a IA
                // gastar o turno mirando alguém que a regra manda ignorar.
                if (Motor.Batalha.TemEfeito(u, "invisible")) continue;

                q.Inimigos.Add(u);
                if (Motor.Batalha.TemEfeito(u, "taunt"))
                {
                    q.Provocadores.Add(u);
                    q.UidsDeProvocador.Add(u.Uid);
                }
            }

            if (q.Inimigos.Count == 0) return q;

            // Alvo primário: provocador quando há um, senão o mais perto e mais
            // ferido. O peso 2 na distância contra 10 na fração de vida é do
            // `ai.js` — duas casas a mais valem o mesmo que 20% de vida a menos.
            var lista = q.Provocadores.Count > 0 ? q.Provocadores : q.Inimigos;
            var alvo = lista[0];
            double melhorChave = double.PositiveInfinity;
            for (int i = 0; i < lista.Count; i++)
            {
                var u = lista[i];
                double chave = Distancia.Manhattan(eu.Casa, u.Casa) * 2
                             + (u.PVMax > 0 ? (double)u.PV / u.PVMax : 0) * 10;
                if (chave < melhorChave) { melhorChave = chave; alvo = u; }
            }
            q.CasaDoAlvo = alvo.Casa;
            q.Campo = CampoDeDistancia(alvo.Casa);

            double pior = 1.0;
            for (int i = 0; i < q.Aliados.Count; i++)
            {
                var a = q.Aliados[i];
                double frac = a.PVMax > 0 ? (double)a.PV / a.PVMax : 1.0;
                if (frac < pior) { pior = frac; q.Ferido = a; }
            }

            q.AlcanceIdeal = AlcanceIdealDe(eu);
            q.RiscoDeEsquiva = RiscoDeSairDaCasa(eu, q.Inimigos);
            q.EscalaDeCura = EscalaDeCura();

            Dados.Clima clima;
            if (_banco.Climas != null && _batalha.Clima != null &&
                _banco.Climas.TryGetValue(_batalha.Clima, out clima)) q.Clima = clima;

            return q;
        }

        /// <summary>
        /// Passos até o alvo, ATRAVESSANDO as unidades.
        ///
        /// Unidades passáveis é decisão do <c>ai.js</c> ("evita impasses de
        /// pathing"): contando corpo como parede, dois monstros num corredor
        /// leem o corredor como fechado, param os dois e a batalha empaca. O
        /// campo serve para escolher a DIREÇÃO; quem cobra passagem de verdade é
        /// o <c>AlcanceDePasso</c> do motor, e esse já conta corpo como parede.
        ///
        /// Reusa o <see cref="Passo.Alcance"/> da grade com um teto de PP maior
        /// que o tabuleiro inteiro, em vez de uma busca em largura nova aqui:
        /// duas buscas em largura para a mesma pergunta divergiriam no dia em que
        /// alguém mudasse o que é chão.
        /// </summary>
        Dictionary<Vector2Int, int> CampoDeDistancia(Vector2Int alvo)
        {
            var mapa = _batalha.Mapa;
            var campo = Passo.Alcance(mapa, alvo, mapa.Largura * mapa.Altura, null);
            // A origem NÃO sai do `Passo.Alcance` (custo 0 não é destino de
            // movimento). Aqui ela é a distância zero, e sem esta linha a casa do
            // próprio alvo pareceria inalcançável.
            campo[alvo] = 0;
            return campo;
        }

        double DistanciaNoCampo(Quadro q, Vector2Int casa)
        {
            int d;
            if (q.Campo != null && q.Campo.TryGetValue(casa, out d)) return d;
            return DistanciaInalcancavel;
        }

        static int DistanciaAoInimigoMaisPerto(Quadro q, Vector2Int casa)
        {
            int menor = 999;
            for (int i = 0; i < q.Inimigos.Count; i++)
            {
                int d = Distancia.Manhattan(casa, q.Inimigos[i].Casa);
                if (d < menor) menor = d;
            }
            return menor;
        }

        /// <summary>
        /// O maior alcance entre os feitiços de DANO que a unidade sabe — é a
        /// distância que o papel <c>ranged</c> tenta manter.
        ///
        /// Só dano, e não todo feitiço: contar o alcance de uma cura ou de um
        /// escudo faria o atirador se plantar longe demais para atacar.
        /// </summary>
        int AlcanceIdealDe(Motor.Unidade u)
        {
            int ideal = 1;
            for (int i = 0; i < u.Feiticos.Count; i++)
            {
                var f = _banco.AchaFeitico(u.Feiticos[i]);
                if (f == null || f.Efeitos == null || f.Alcance == null) continue;
                for (int j = 0; j < f.Efeitos.Count; j++)
                {
                    var e = f.Efeitos[j];
                    // `chain` está no `ai.js` junto com `damage`, e ficou de fora
                    // aqui: o motor desta rodada ignora `chain` (evento
                    // `EfeitoIgnorado`). Contar o alcance de um feitiço que não
                    // faz nada plantaria o atirador longe esperando um tiro que
                    // não sai.
                    if (e != null && e.Tipo == "damage" && f.Alcance.Max > ideal) ideal = f.Alcance.Max;
                }
            }
            return ideal;
        }

        /// <summary>
        /// O risco de sair da casa de agora: <c>1 − a MENOR chance de escapar</c>
        /// entre os inimigos colados. O pior fixador manda, que é exatamente o
        /// critério que o <c>Batalha.Andar</c> usa na hora de sortear.
        /// </summary>
        double RiscoDeSairDaCasa(Motor.Unidade eu, List<Motor.Unidade> inimigos)
        {
            double menorChance = 1.0;
            for (int i = 0; i < inimigos.Count; i++)
            {
                if (Distancia.Manhattan(eu.Casa, inimigos[i].Casa) != 1) continue;
                double c = _batalha.ChanceDeEsquiva(eu, inimigos[i]);
                if (c < menorChance) menorChance = c;
            }
            return 1.0 - menorChance;
        }

        /// <summary>
        /// O quanto a fúria da sala já encolheu a cura.
        ///
        /// Sem isto a IA continuaria gastando turno numa cura que a sala já
        /// zerou. É cópia de <c>Batalha.EscalaDeCura</c>, que é PRIVADO — está no
        /// relatório como pedido ao dono do Motor. Enquanto for cópia, os dois
        /// leem a MESMA chave do acervo, então divergem só se um dos dois for
        /// alterado sozinho.
        /// </summary>
        double EscalaDeCura()
        {
            var n = _banco.Nivelamento;
            var cfg = n != null ? n.FuriaDaSala : null;
            // Sem a chave no acervo, o motor cai no padrão de `Engine.ROOM_FURY`;
            // repetir o padrão aqui é o que mantém os dois no mesmo número.
            int aposRodada = cfg != null ? cfg.AposRodada : 20;
            double cortePorRodada = cfg != null ? cfg.CorteDeCuraPorRodada : 0.15;

            int rodadasDeFuria = Math.Max(0, _batalha.Rodada - aposRodada);
            return Math.Max(0.0, 1.0 - cortePorRodada * rodadasDeFuria);
        }
    }
}
