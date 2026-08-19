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

            // A iniciativa mora fora da Unidade porque a API do contrato não tem
            // campo para ela. Lista paralela, na ordem de nascimento, para o
            // desempate abaixo continuar sendo pela ordem de nascimento.
            var iniciativas = new List<int>();

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
                unidades.Add(Nascer(unidades.Count, idDaClasse, Motor.Lado.Heroi,
                                    mapa.NascimentosHeroi[i], classe.Atributos, Dados.Elemento.Neutro));
                iniciativas.Add(classe.Atributos.Iniciativa);
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

                unidades.Add(Nascer(unidades.Count, idDoMonstro, Motor.Lado.Monstro,
                                    nascimento.Casa, monstro.Atributos, monstro.Elemento));
                iniciativas.Add(monstro.Atributos.Iniciativa);
            }

            var ordem = PorIniciativa(unidades, iniciativas);

            // A sala manda no clima; o calabouço só responde por quem não
            // declarou. Ler o clima do calabouço primeiro apagaria a decisão de
            // quem desenhou a sala — o Vestíbulo é `calmo` dentro de uma Estufa
            // que chove.
            var clima = !string.IsNullOrEmpty(sala.Clima) ? sala.Clima
                      : (!string.IsNullOrEmpty(calabouco.ClimaPadrao) ? calabouco.ClimaPadrao
                                                                      : ClimaSemOpiniao);

            return new Motor.Batalha(mapa, unidades, ordem, clima);
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
        static List<Motor.Unidade> PorIniciativa(List<Motor.Unidade> unidades, List<int> iniciativas)
        {
            var indices = new List<int>(unidades.Count);
            for (int i = 0; i < unidades.Count; i++) indices.Add(i);

            indices.Sort(delegate (int a, int b)
            {
                if (iniciativas[a] != iniciativas[b]) return iniciativas[b].CompareTo(iniciativas[a]);
                return a.CompareTo(b);
            });

            var ordem = new List<Motor.Unidade>(unidades.Count);
            for (int i = 0; i < indices.Count; i++) ordem.Add(unidades[indices[i]]);
            return ordem;
        }

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
        static Motor.Unidade Nascer(int nascimento, string id, Motor.Lado lado,
                                    Vector2Int casa, Atributos ficha, string elemento)
        {
            return new Motor.Unidade
            {
                // `u1`, `u2`, ... na ordem de nascimento, igual ao
                // `state._uidCounter` do JS: é por este id que a interface e a
                // cena vão achar a unidade, e ele não pode depender da ordem de
                // iniciativa — ela muda quando alguém morre.
                Uid = "u" + (nascimento + 1),
                ClasseOuMonstroId = id,
                Lado = lado,
                Casa = casa,
                PV = ficha.Pv,
                PVMax = ficha.Pv,
                PA = ficha.Pa,
                PAMax = ficha.Pa,
                PP = ficha.Pp,
                PPMax = ficha.Pp,
                // Esquiva é identidade de classe — 5 no Bárbaro, 30 no Ladino.
                // Zerar aqui achataria as seis classes numa só.
                Esquiva = ficha.Esquiva,
                // Nível 1: `DeSala` recebe id de classe e nada de progressão.
                // Quem tiver herói de nível maior monta por outra porta.
                Nivel = 1,
                Elemento = string.IsNullOrEmpty(elemento) ? Dados.Elemento.Neutro : elemento,
                Viva = true,
                ForaDoTabuleiro = false
            };
        }
    }
}
