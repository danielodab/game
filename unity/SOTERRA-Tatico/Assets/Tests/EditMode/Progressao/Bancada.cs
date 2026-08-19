using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using UnityEngine;
using Soterra.Dados;
using Soterra.Progressao;

namespace Soterra.Testes.Progressao
{
    // ARMADILHA DE NOME: daqui de dentro, `Motor.X` acha `Soterra.Testes.Motor`
    // antes de chegar em `Soterra.Motor`, e o tipo some com um CS0234 que não
    // explica nada. O apelido global trava no lugar certo — mesma armadilha dos
    // testes do Motor e do Batalha.
    using Motor = global::Soterra.Motor;

    // Mesma armadilha: `Grade.Mapa` acharia `Soterra.Testes.Grade` primeiro.
    using Grade = global::Soterra.Grade;

    /// <summary>
    /// A bancada dos testes de progressão: de onde vêm o acervo, o save e as
    /// batalhas de mentira.
    ///
    /// São duas portas, e as duas são necessárias:
    ///
    /// - <see cref="Real"/> abre o acervo exportado. É ele que prova os números
    ///   DESTE jogo — 90 itens, 18 conjuntos, 30 degraus de XP. Termina
    ///   INCONCLUSIVO, nunca verde, se os JSON não existirem: um teste que passa
    ///   por ausência de arquivo afirma que está tudo certo justamente quando não
    ///   há nada para conferir.
    /// - <see cref="Laboratorio"/> monta um acervo de mentira com UMA classe
    ///   cujos feitiços declaram degraus que NÃO coincidem com
    ///   <c>unlockTiers</c>. Ele existe para uma pergunta só, e o acervo real não
    ///   consegue respondê-la: a escada de feitiço sai do dado ou de uma lista
    ///   cravada no código? No acervo real as duas fontes concordam, e uma
    ///   implementação errada passaria despercebida.
    /// </summary>
    static class Bancada
    {
        static BancoDeDados _real;

        public static BancoDeDados Real()
        {
            if (_real != null) return _real;

            var caminho = (Application.dataPath + "/Resources/dados/" +
                           Manifesto.Chave + ".json").Replace('\\', '/');
            if (!File.Exists(caminho))
                Assert.Inconclusive(
                    "o acervo ainda não foi exportado: falta " + caminho +
                    ". Este teste NÃO passa por ausência — volta a rodar sozinho " +
                    "quando o arquivo chegar.");

            var b = BancoDeDados.CarregarDeResources();
            Assert.IsNotNull(b.Manifesto, "o manifesto existe em disco e o Resources.Load não o achou");
            _real = b;
            return _real;
        }

        /// <summary>
        /// Uma cópia PRÓPRIA do acervo, fora do cache de <see cref="Real"/>.
        ///
        /// Serve ao teste que precisa adulterar um item para provar que o teto
        /// de PA é do código e não da boa vontade do arquivo. Mexer no acervo
        /// compartilhado deixaria o defeito plantado para o próximo teste, e a
        /// falha apareceria longe de quem a causou.
        /// </summary>
        public static BancoDeDados RealSoParaMim()
        {
            Real();      // garante que os arquivos existem (ou termina inconclusivo)
            return BancoDeDados.CarregarDeResources();
        }

        // ---- o acervo de laboratório ---------------------------------------

        /// <summary>
        /// UMA classe, UM caminho, TRÊS feitiços — e os degraus deles escolhidos
        /// para brigar com <c>unlockTiers</c>:
        ///
        /// | feitiço | <c>unlockLevel</c> | o que os degraus diriam |
        /// |---|---|---|
        /// | <c>lab-fogo-tarde</c>  | 8 | 5 (índice 0)  |
        /// | <c>lab-fogo-cedo</c>   | 6 | 10 (índice 1) |
        /// | <c>lab-fogo-herdado</c>| 0 | 12 (índice 2) — e aqui o degrau VALE |
        ///
        /// No nível 6 a resposta certa é "só o <c>cedo</c>". Quem lesse a lista
        /// de degraus daria "só o <c>tarde</c>" — resposta errada nos dois
        /// feitiços ao mesmo tempo, que é o que torna o teste decisivo.
        /// </summary>
        public const string ClassesDeLaboratorio = @"{
  ""lab"": {
    ""id"": ""lab"", ""name"": ""Cobaia"", ""role"": ""tanque"",
    ""stats"": {
      ""hp"": 100, ""pa"": 6, ""pp"": 3, ""initiative"": 10, ""power"": 0, ""dodge"": 5, ""lock"": 10,
      ""resists"": { ""fogo"": 0, ""agua"": 0, ""terra"": 0, ""ar"": 0, ""neutro"": 0 }
    },
    ""baseSpells"": [""lab-neutro""],
    ""paths"": {
      ""fogo"": [""lab-fogo-tarde"", ""lab-fogo-cedo"", ""lab-fogo-herdado""]
    },
    ""startsUnlocked"": true, ""cardRarity"": ""comum""
  }
}";

        public const string FeiticosDeLaboratorio = @"{
  ""lab-neutro"":       { ""id"": ""lab-neutro"",       ""unlockLevel"": 0, ""targetSide"": ""enemy"", ""effects"": [] },
  ""lab-fogo-tarde"":   { ""id"": ""lab-fogo-tarde"",   ""unlockLevel"": 8, ""targetSide"": ""enemy"", ""effects"": [] },
  ""lab-fogo-cedo"":    { ""id"": ""lab-fogo-cedo"",    ""unlockLevel"": 6, ""targetSide"": ""enemy"", ""effects"": [] },
  ""lab-fogo-herdado"": { ""id"": ""lab-fogo-herdado"", ""unlockLevel"": 0, ""targetSide"": ""enemy"", ""effects"": [] }
}";

        /// <summary>Os degraus REAIS do acervo — é contra eles que a escada de laboratório briga.</summary>
        public const string DegrausReais = @"[5, 10, 12, 15, 20, 30]";

        public static BancoDeDados Laboratorio()
        {
            return BancoDeDados.Carregar(new FonteDeMemoria()
                .Com(BancoDeDados.ChaveClasses, ClassesDeLaboratorio)
                .Com(BancoDeDados.ChaveFeiticos, FeiticosDeLaboratorio)
                .Com(BancoDeDados.ChaveDegrausDeDesbloqueio, DegrausReais)
                .Com(BancoDeDados.ChaveNivelamento, Testes.Dados.Fixturas.Nivelamento)
                .Com(BancoDeDados.ChaveElementos, Testes.Dados.Fixturas.Elementos)
                .Com(BancoDeDados.ChaveEstrelas, Testes.Dados.Fixturas.Estrelas)
                .Com(BancoDeDados.ChaveForja, Testes.Dados.Fixturas.Forja));
        }

        // ---- progresso ------------------------------------------------------

        /// <summary>Um progresso do zero sobre um armazém de memória novo.</summary>
        public static Progresso Novo(BancoDeDados banco, out ArmazemDeMemoria armazem)
        {
            armazem = new ArmazemDeMemoria();
            return Progresso.DoZero(banco, armazem);
        }

        public static Progresso Novo(BancoDeDados banco)
        {
            ArmazemDeMemoria ignorado;
            return Novo(banco, out ignorado);
        }

        /// <summary>
        /// Leva o herói EXATAMENTE ao nível pedido, pela tabela de XP do acervo.
        ///
        /// Nunca por um número digitado: a tabela está congelada por coordenação
        /// com o <c>xp</c> dos monstros, e um teste que escrevesse "125" pararia
        /// de falar do nível 5 no dia em que a curva mudasse.
        /// </summary>
        public static void LevarAoNivel(Progresso p, string heroiId, int nivel)
        {
            var tabela = p.Banco.Nivelamento.TabelaDeXp;
            Assert.GreaterOrEqual(tabela.Count, nivel, "a tabela de XP não chega ao nível " + nivel);
            var alvo = tabela[nivel - 1];
            var h = p.Heroi(heroiId);
            Assert.IsNotNull(h, "herói inexistente: " + heroiId);
            p.AdicionarXp(heroiId, alvo - h.Xp);
            Assert.AreEqual(nivel, p.NivelDe(heroiId), "não chegou ao nível " + nivel);
        }

        // ---- batalhas de mentira -------------------------------------------

        /// <summary>Uma sala vazia, só para a batalha ter geometria.</summary>
        public static Grade.Mapa Aberta(int largura, int altura)
        {
            var linhas = new string[altura];
            for (int y = 0; y < altura; y++) linhas[y] = new string('.', largura);
            return Grade.Mapa.DeTexto(linhas);
        }

        /// <summary>
        /// Uma batalha com os monstros pedidos JÁ MORTOS e os heróis com a vida
        /// que se quer testar.
        ///
        /// Os monstros nascem vivos e são derrubados depois de a batalha existir:
        /// entregá-los mortos ao construtor faria a fila de iniciativa nascer
        /// diferente da de uma luta de verdade.
        /// </summary>
        public static Motor.Batalha SalaVencida(Progresso p, IList<string> grupo,
                                                IList<int> pvDosHerois, params string[] monstrosMortos)
        {
            var banco = p.Banco;
            var unidades = new List<Motor.Unidade>();
            for (int i = 0; i < grupo.Count; i++)
            {
                var u = p.NovaUnidade(grupo[i], "h" + (i + 1), new Vector2Int(1 + i, 1));
                Assert.IsNotNull(u, "não montou a unidade de " + grupo[i]);
                unidades.Add(u);
            }
            for (int i = 0; i < monstrosMortos.Length; i++)
            {
                unidades.Add(Motor.Unidade.DeMonstro(banco.Monstros[monstrosMortos[i]],
                                                     "m" + (i + 1), new Vector2Int(5 + i, 5)));
            }

            var b = new Motor.Batalha(banco, Aberta(12, 8), unidades, "calmo", Motor.Sorte.SempreOMinimo);

            for (int i = 0; i < unidades.Count; i++)
            {
                var u = unidades[i];
                if (u.Lado == Motor.Lado.Monstro) { u.PV = 0; u.Viva = false; continue; }
                var indice = i;
                if (pvDosHerois != null && indice < pvDosHerois.Count)
                {
                    u.PV = pvDosHerois[indice];
                    u.Viva = u.PV > 0;
                }
            }
            return b;
        }
    }
}
