using System;
using System.Collections.Generic;
using UnityEngine;
using Soterra.Dados;

namespace Soterra.Batalha
{
    /// <summary>
    /// De dado para batalha: lê a sala do calabouço e devolve o tabuleiro
    /// povoado, com a ordem de iniciativa definida.
    ///
    /// É a tradução do <c>Engine.createBattle</c> de <c>js/core/engine.js</c>,
    /// e as mensagens de erro são as mesmas de lá de propósito — a sala que
    /// quebra numa linha tem de quebrar na outra, com o mesmo texto.
    ///
    /// C# puro e estático: montar batalha não precisa de cena, e assim a sala
    /// real de 21×17 se monta e se confere num teste EditMode, em milissegundos.
    /// </summary>
    public static class Montador
    {
        /// <summary>Clima de quem não declarou nada — o mesmo do JS.</summary>
        public const string ClimaSemOpiniao = "calmo";

        /// <summary>
        /// Monta a batalha da sala <paramref name="indiceDaSala"/> do calabouço
        /// <paramref name="calabocoId"/>.
        ///
        /// Os heróis ocupam os PRIMEIROS nascimentos de herói, na ordem em que
        /// as classes chegaram. A sala real desenha SEIS <c>P</c> e o jogo desce
        /// com dois heróis: os outros quatro sobram vazios, e isso é correto —
        /// são posições de partida a mais, não unidades a menos.
        /// </summary>
        public static Motor.Batalha DeSala(BancoDeDados banco, string calabocoId,
                                           int indiceDaSala, IReadOnlyList<string> classesDosHerois)
        {
            if (banco == null) throw new ArgumentNullException("banco");
            if (classesDosHerois == null || classesDosHerois.Count == 0)
                throw new ArgumentException("grupo vazio", "classesDosHerois");

            var calabouco = banco.AchaCalabouco(calabocoId);
            if (calabouco == null)
                throw new ArgumentException("calabouço desconhecido: " + calabocoId, "calabocoId");

            if (indiceDaSala < 0 || indiceDaSala >= calabouco.Salas.Count)
                throw new ArgumentOutOfRangeException("indiceDaSala",
                    "sala inválida: " + indiceDaSala + " — '" + calabocoId + "' tem " +
                    calabouco.Salas.Count + " sala(s)");

            var sala = calabouco.Salas[indiceDaSala];
            var mapa = sala.ParaMapa();

            if (classesDosHerois.Count > mapa.NascimentosHeroi.Count)
                throw new InvalidOperationException(
                    "nascimentos de herói insuficientes em '" + sala.Nome + "': o grupo tem " +
                    classesDosHerois.Count + " e o desenho traz " + mapa.NascimentosHeroi.Count + " 'P'");

            var unidades = new List<Motor.Unidade>();


            for (int i = 0; i < classesDosHerois.Count; i++)
            {
                var idDaClasse = classesDosHerois[i];
                Classe classe = null;
                if (string.IsNullOrEmpty(idDaClasse) ||
                    !banco.Classes.TryGetValue(idDaClasse, out classe) || classe == null)
                    throw new InvalidOperationException("classe desconhecida: " + idDaClasse);
                if (classe.Atributos == null)
                    throw new InvalidOperationException("classe sem atributos: " + idDaClasse);

                // Elemento neutro, sempre: `DeSala` recebe id de CLASSE e mais
                // nada, e o caminho elemental só se escolhe no nível 5. Ler o
                // elemento da classe seria inventar uma escolha que o jogador
                // não fez.
                // Pela FABRICA do Motor, e nao por um construtor local: o
                // Nascer() daqui montava unidade MUDA — sem Feiticos, Poder,
                // Fixacao, Resistencias — e a batalha montada por DeSala nao
                // conjurava nada, de nenhum lado. A fabrica preenche tudo.
                unidades.Add(Motor.Unidade.DeClasse(classe, "u" + (unidades.Count + 1),
                                                    mapa.NascimentosHeroi[i]));
            }

            // Um monstro por NASCIMENTO, não por letra: a letra repete de
            // propósito no desenho — dois `a` são dois bichos do mesmo tipo. Foi
            // agrupando por letra que a sala real perdeu dois monstros calada.
            for (int i = 0; i < mapa.NascimentosMonstro.Count; i++)
            {
                var nascimento = mapa.NascimentosMonstro[i];
                var letra = nascimento.Letra.ToString();

                string idDoMonstro = null;
                if (sala.Monstros == null ||
                    !sala.Monstros.TryGetValue(letra, out idDoMonstro) ||
                    string.IsNullOrEmpty(idDoMonstro))
                    throw new InvalidOperationException(
                        "letra sem monstro: '" + letra + "' está desenhada em '" + sala.Nome +
                        "' e não aparece em `monsters`");

                var monstro = AchaMonstro(banco, idDoMonstro);
                if (monstro == null)
                    throw new InvalidOperationException("monstro desconhecido: " + idDoMonstro);
                if (monstro.Atributos == null)
                    throw new InvalidOperationException("monstro sem atributos: " + idDoMonstro);

                unidades.Add(Motor.Unidade.DeMonstro(monstro, "u" + (unidades.Count + 1),
                                                     nascimento.Casa));
            }

            // A ordem sai pronta do proprio Motor: o construtor dele ordena por
            // iniciativa e ja comeca o turno do primeiro. Ordenar aqui tambem
            // criaria DUAS fontes para a mesma fila, e elas divergiriam no dia
            // em que uma das duas ganhasse um criterio de desempate novo.
            // NAO ordena aqui: o Motor guarda `Unidades` na ordem de
            // NASCIMENTO e monta `Ordem` por iniciativa sozinho. Ordenar
            // antes entregava nascimento ja embaralhado, e o primeiro heroi
            // deixava de ser o primeiro 'P' do desenho.

            // A sala manda no clima; o calabouço só responde por quem não
            // declarou. Ler o clima do calabouço primeiro apagaria a decisão de
            // quem desenhou a sala — o Vestíbulo é `calmo` dentro de uma Estufa
            // que chove.
            var clima = !string.IsNullOrEmpty(sala.Clima) ? sala.Clima
                      : (!string.IsNullOrEmpty(calabouco.ClimaPadrao) ? calabouco.ClimaPadrao
                                                                      : ClimaSemOpiniao);

            // O id do calabouco vai junto porque e dele que saem o ciclo de
            // clima e a taxa de marca de terreno. Sem ele, clima nunca gira e
            // marca nenhuma nasce — as duas coisas so existiriam sob teste.
            return new Motor.Batalha(banco, mapa, unidades, clima,
                                     idDoCalabouco: calabocoId);
        }

        /// <summary>
        /// Maior iniciativa joga primeiro; empate desempata pela ordem de
        /// nascimento.
        ///
        /// O desempate é explícito porque <c>List.Sort</c> NÃO é estável: com
        /// duas Flores-de-Pólen de iniciativa 55 a fila poderia sair numa ordem
        /// numa máquina e noutra na seguinte, e uma batalha que muda de ordem
        /// sozinha é impossível de reproduzir num relato de defeito.
        /// </summary>
        /// <summary>
        /// Procura nas duas tabelas de bicho, na ordem do <c>Engine.monster</c>
        /// do JS: o bestiário primeiro, as invocações de fusão depois.
        /// </summary>
        static Monstro AchaMonstro(BancoDeDados banco, string id)
        {
            Monstro m;
            if (banco.Monstros != null && banco.Monstros.TryGetValue(id, out m)) return m;
            if (banco.InvocadosDeFusao != null && banco.InvocadosDeFusao.TryGetValue(id, out m)) return m;
            return null;
        }

        /// <summary>
        /// Uma unidade nasce INTEIRA: PV, PA e PP cheios.
        ///
        /// Os números saem da ficha como estão no acervo, sem reescala. Os do
        /// monstro já chegam multiplicados pela profundidade do calabouço — a
        /// fábrica do JS multiplica antes de escrever, e escalar de novo aqui
        /// dobraria a dureza do jogo inteiro.
        /// </summary>
    }
}
