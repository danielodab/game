using System;
using System.Collections.Generic;

namespace Soterra.Jogo
{
    // Ver a nota em Partida.cs: apelidos globais contra o CS0234 dos irmãos.
    using Motor = global::Soterra.Motor;
    using Dados = global::Soterra.Dados;
    using Grade = global::Soterra.Grade;
    using Batalha = global::Soterra.Batalha;
    using Progressao = global::Soterra.Progressao;

    /// <summary>
    /// Monta a batalha de uma sala com os heróis vindos da PROGRESSÃO — nível,
    /// feitiços desbloqueados, elemento escolhido, itens vestidos e o PV
    /// castigado da sala anterior.
    ///
    /// Por que não é o <c>Batalha.Montador</c>: ele recebe id de CLASSE e mais
    /// nada, e por isso faz nascer herói de nível 1 cru, sempre — foi o que a
    /// cena jogável fez até aqui. A ficha da progressão TEM de estar pronta
    /// antes do construtor de <c>Motor.Batalha</c>, porque ele ordena a fila de
    /// iniciativa e já começa o primeiro turno; 31 das 90 peças do acervo mexem
    /// em iniciativa, e aplicar a ficha depois deixaria a fila montada com os
    /// números errados (ver <c>Progresso.NovaUnidade</c>). Não há como enfiar a
    /// ficha certa por fora do Montador, e o Montador é de outro dono.
    ///
    /// O que ESTA classe duplica dele é só a leitura dos monstros da sala — as
    /// mesmas letras, as mesmas casas, as mesmas mensagens de erro. A
    /// duplicação é conferida por teste (<c>DescidaDoJogoTests</c> compara os
    /// monstros montados aqui com os do Montador, sala a sala do calabouço
    /// inteiro): se os dois divergirem, o teste denuncia em vez de a sala sair
    /// diferente do jogo antigo em silêncio.
    /// </summary>
    public static class MontagemDaSala
    {
        /// <summary>
        /// A sala montada. <paramref name="pvDeEntrada"/> recebe (id do herói,
        /// PV máximo dele) e devolve com quanto ele entra — é por onde a
        /// <see cref="Expedicao"/> entrega a cura entre salas da Descida, ou o
        /// PV que o save guardou.
        ///
        /// Herói SEM ficha na progressão faz a montagem estourar em vez de cair
        /// na classe crua: descer com um herói que a progressão não conhece
        /// significaria jogar uma sala inteira com nível 1 e nenhum item, e o
        /// jogador só notaria pelo dano fraco.
        /// </summary>
        public static Motor.Batalha DeSala(Progressao.Progresso progresso, string calabocoId,
                                           int indiceDaSala, IList<string> grupo,
                                           Func<string, int, int> pvDeEntrada = null,
                                           Motor.Sorte sorte = null)
        {
            if (progresso == null) throw new ArgumentNullException("progresso");
            if (grupo == null || grupo.Count == 0)
                throw new ArgumentException("grupo vazio", "grupo");

            var banco = progresso.Banco;
            var calabouco = banco.AchaCalabouco(calabocoId);
            if (calabouco == null)
                throw new ArgumentException("calabouço desconhecido: " + calabocoId, "calabocoId");
            if (indiceDaSala < 0 || indiceDaSala >= calabouco.Salas.Count)
                throw new ArgumentOutOfRangeException("indiceDaSala",
                    "sala inválida: " + indiceDaSala + " — '" + calabocoId + "' tem " +
                    calabouco.Salas.Count + " sala(s)");

            var sala = calabouco.Salas[indiceDaSala];
            var mapa = sala.ParaMapa();

            if (grupo.Count > mapa.NascimentosHeroi.Count)
                throw new InvalidOperationException(
                    "nascimentos de herói insuficientes em '" + sala.Nome + "': o grupo tem " +
                    grupo.Count + " e o desenho traz " + mapa.NascimentosHeroi.Count + " 'P'");

            var unidades = new List<Motor.Unidade>();

            for (int i = 0; i < grupo.Count; i++)
            {
                var heroiId = grupo[i];
                var ficha = progresso.FichaDeCombate(heroiId);
                if (ficha == null)
                    throw new InvalidOperationException(
                        "herói sem ficha na progressão: '" + heroiId + "' — descer assim faria a " +
                        "sala inteira ser jogada com nível 1 e nenhum item, calado");

                // O PV cheio da FICHA, não o da classe: é ele que a cura entre
                // salas divide, e é ele que a peça vestida aumenta.
                var pv = pvDeEntrada != null ? pvDeEntrada(heroiId, ficha.Pv) : ficha.Pv;

                var u = progresso.NovaUnidade(heroiId, "u" + (unidades.Count + 1),
                                              mapa.NascimentosHeroi[i], pv);
                if (u == null)
                    throw new InvalidOperationException("não montou a unidade de '" + heroiId + "'");
                unidades.Add(u);
            }

            MontarMonstros(banco, sala, mapa, unidades);

            // A sala manda no clima; o calabouço só responde por quem não
            // declarou — a mesma ordem do Montador, pela mesma razão (o
            // Vestíbulo é `calmo` dentro de uma Estufa que chove).
            var clima = !string.IsNullOrEmpty(sala.Clima) ? sala.Clima
                      : (!string.IsNullOrEmpty(calabouco.ClimaPadrao) ? calabouco.ClimaPadrao
                                                                      : Batalha.Montador.ClimaSemOpiniao);

            return new Motor.Batalha(banco, mapa, unidades, clima, sorte, idDoCalabouco: calabocoId);
        }

        /// <summary>
        /// Um monstro por NASCIMENTO, não por letra — a letra repete de
        /// propósito no desenho. Cópia deliberada do <c>Montador</c>; ver o
        /// resumo da classe.
        /// </summary>
        static void MontarMonstros(Dados.BancoDeDados banco, Dados.Sala sala, Grade.Mapa mapa,
                                   List<Motor.Unidade> unidades)
        {
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
        }

        /// <summary>Bestiário primeiro, invocações de fusão depois — a ordem do
        /// <c>Engine.monster</c> do JS.</summary>
        static Dados.Monstro AchaMonstro(Dados.BancoDeDados banco, string id)
        {
            Dados.Monstro m;
            if (banco.Monstros != null && banco.Monstros.TryGetValue(id, out m)) return m;
            if (banco.InvocadosDeFusao != null && banco.InvocadosDeFusao.TryGetValue(id, out m)) return m;
            return null;
        }
    }
}
