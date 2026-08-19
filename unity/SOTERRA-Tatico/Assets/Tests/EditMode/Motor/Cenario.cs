using System.Collections.Generic;
using System.IO;
using System.Text;
using NUnit.Framework;
using UnityEngine;
using Soterra.Dados;
using Soterra.Grade;
using Soterra.Motor;

namespace Soterra.Testes.Motor
{
    // `Batalha` sem apelido apontaria para o NAMESPACE `Soterra.Batalha` (dono:
    // papel Batalha) assim que ele existir, e o teste pararia de compilar sem
    // nenhuma mudança neste arquivo. O apelido trava no tipo certo.
    using Batalha = global::Soterra.Motor.Batalha;

    /// <summary>
    /// Monta batalhas com o acervo DE VERDADE.
    ///
    /// Todo número destes testes — 150 de PV do Bárbaro, 30 de esquiva do
    /// Ladino, 26–33 do Cone de Cinzas, −20 de fogo da Vergasta — sai de
    /// <c>Assets/Resources/dados/</c>, nunca de uma constante escrita aqui.
    /// Fixtura com valor bonito e falso é o jeito mais rápido de escrever um
    /// teste que passa e não prova nada sobre ESTE jogo.
    ///
    /// Enquanto o acervo não existir, os testes terminam INCONCLUSIVOS, não
    /// verdes: um teste que passa porque o arquivo não existe afirma que está
    /// tudo certo justamente quando não há nada para conferir.
    /// </summary>
    static class Cenario
    {
        static BancoDeDados _acervo;

        public static BancoDeDados Acervo()
        {
            if (_acervo != null) return _acervo;

            var caminho = (Application.dataPath + "/Resources/dados/" +
                           Manifesto.Chave + ".json").Replace('\\', '/');
            if (!File.Exists(caminho))
            {
                Assert.Inconclusive(
                    "o acervo ainda não foi exportado: falta " + caminho + ". " +
                    "Ele é gerado pelo papel Criativo/Dados. Este teste NÃO passa " +
                    "por ausência — volta a rodar sozinho quando o arquivo chegar.");
            }

            var b = BancoDeDados.CarregarDeResources();
            Assert.IsNotNull(b.Manifesto,
                "o manifesto existe em disco mas o Resources.Load não o achou");
            _acervo = b;
            return _acervo;
        }

        // ---- mapas ----------------------------------------------------------

        public static Mapa Sala(params string[] linhas)
        {
            return Mapa.DeTexto(linhas);
        }

        /// <summary>Sala sem nada dentro, para medir só a regra e não a geometria.</summary>
        public static Mapa Aberta(int largura, int altura)
        {
            var sb = new StringBuilder(largura);
            for (int x = 0; x < largura; x++) sb.Append('.');
            var linhas = new string[altura];
            for (int y = 0; y < altura; y++) linhas[y] = sb.ToString();
            return Mapa.DeTexto(linhas);
        }

        /// <summary>
        /// 'O Vestíbulo das Heras' — a primeira sala da Estufa Soterrada, letra
        /// por letra, com os SEIS nascimentos de herói e as letras de monstro
        /// repetidas que só a sala real tem.
        /// </summary>
        public static Mapa Vestibulo()
        {
            return Acervo().AchaCalabouco("greenhouse").Salas[0].ParaMapa();
        }

        // ---- unidades -------------------------------------------------------

        /// <summary>
        /// Um herói com a ficha real da classe.
        ///
        /// <paramref name="degrauDoCaminho"/> é o índice do feitiço no caminho
        /// elemental da classe — 0 é o de nível 5, 1 o de nível 10, 2 o de 12.
        /// Sai do acervo em vez de ser digitado: assim o teste continua falando
        /// do feitiço certo se o acervo renomear os ids.
        /// </summary>
        public static Unidade Heroi(string classeId, string uid, int x, int y,
                                    string elemento = null, int degrauDoCaminho = -1)
        {
            var cls = Acervo().Classes[classeId];
            var feiticos = new List<string>(cls.FeiticosBase);
            if (degrauDoCaminho >= 0) feiticos.Add(cls.Caminhos[elemento][degrauDoCaminho]);
            return Unidade.DeClasse(cls, uid, new Vector2Int(x, y), elemento, feiticos);
        }

        public static Unidade Monstro(string monstroId, string uid, int x, int y)
        {
            return Unidade.DeMonstro(Acervo().Monstros[monstroId], uid, new Vector2Int(x, y));
        }

        // ---- batalha --------------------------------------------------------

        public static Batalha Montar(Mapa mapa, Sorte sorte, params Unidade[] unidades)
        {
            return new Batalha(Acervo(), mapa, unidades, null, sorte);
        }

        public static Batalha Montar(Mapa mapa, string clima, Sorte sorte, params Unidade[] unidades)
        {
            return new Batalha(Acervo(), mapa, unidades, clima, sorte);
        }

        /// <summary>Atalho para não escrever <c>new Vector2Int</c> cinquenta vezes.</summary>
        public static Vector2Int Ponto(int x, int y)
        {
            return new Vector2Int(x, y);
        }

        /// <summary>
        /// <c>IReadOnlyList</c> não tem <c>Contains</c>, e o <c>Assert.Contains</c>
        /// do NUnit compara por <c>object</c> — que, com struct, passa por caixa e
        /// esconde o motivo quando falha.
        /// </summary>
        public static bool Contem(IReadOnlyList<Vector2Int> casas, Vector2Int p)
        {
            for (int i = 0; i < casas.Count; i++) if (casas[i] == p) return true;
            return false;
        }

        /// <summary>
        /// Encerra turnos até chegar a vez de <paramref name="uid"/>, guardando
        /// tudo o que aconteceu no caminho. Um laço à mão em cada teste esconderia
        /// os eventos do meio — que são justamente onde o veneno mata.
        /// </summary>
        public static List<Evento> AteAVezDe(Batalha b, string uid, int tetoDeTurnos = 30)
        {
            var diario = new List<Evento>(b.Abertura.Eventos);
            int voltas = 0;
            while (b.Atual != null && b.Atual.Uid != uid && voltas++ < tetoDeTurnos)
                diario.AddRange(b.EncerrarTurno().Eventos);

            Assert.AreEqual(uid, b.Atual == null ? null : b.Atual.Uid,
                "não chegou a vez de " + uid + " em " + tetoDeTurnos + " turnos");
            return diario;
        }
    }
}
