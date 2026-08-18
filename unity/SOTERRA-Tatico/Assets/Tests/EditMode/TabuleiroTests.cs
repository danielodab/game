using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes
{
    /// <summary>
    /// Testa a regra, não a tela. Roda em modo lote, sem Editor aberto:
    ///   Unity.exe -batchmode -runTests -testPlatform EditMode -testResults r.xml
    ///
    /// O que estes testes protegem é o defeito que aparece quando alguém troca
    /// busca em largura por distância crua: o alcance vaza pela parede e o
    /// jogador anda para onde não dá.
    /// </summary>
    public class TabuleiroTests
    {
        static Tabuleiro Novo(int largura = 12, int altura = 10)
        {
            var tab = new GameObject("tab-teste").AddComponent<Tabuleiro>();
            tab.Largura = largura;
            tab.Altura = altura;
            return tab;
        }

        [Test]
        public void Manhattan_ignora_diagonal()
        {
            Assert.AreEqual(4, Tabuleiro.Manhattan(new Vector2Int(0, 0), new Vector2Int(2, 2)));
        }

        [Test]
        public void Alcance_de_um_passo_da_as_quatro_vizinhas()
        {
            var tab = Novo();
            var r = tab.Alcance(new Vector2Int(5, 5), 1);
            Assert.AreEqual(4, r.Count);
            Assert.IsFalse(r.ContainsKey(new Vector2Int(5, 5)), "a origem não é destino");
            Assert.IsFalse(r.ContainsKey(new Vector2Int(6, 6)), "diagonal não é um passo");
        }

        [Test]
        public void Alcance_nao_atravessa_bloqueio()
        {
            var tab = Novo();
            for (int y = 0; y < 10; y++) tab.Bloquear(new Vector2Int(3, y));   // parede inteira
            var r = tab.Alcance(new Vector2Int(1, 5), 6);
            Assert.IsFalse(r.ContainsKey(new Vector2Int(4, 5)),
                           "com a coluna 3 fechada, o outro lado é inalcançável");
            Assert.IsFalse(r.ContainsKey(new Vector2Int(3, 5)), "casa bloqueada não entra");
        }

        [Test]
        public void Corredor_em_L_custa_o_caminho_andavel_e_nao_a_linha_reta()
        {
            var tab = Novo();
            // Fecha o atalho reto: só sobra dar a volta por baixo.
            for (int x = 1; x <= 4; x++) tab.Bloquear(new Vector2Int(x, 5));
            var origem = new Vector2Int(1, 4);
            var alvo   = new Vector2Int(1, 6);

            Assert.AreEqual(2, Tabuleiro.Manhattan(origem, alvo), "em linha reta seriam 2");
            Assert.IsFalse(tab.Alcance(origem, 2).ContainsKey(alvo),
                           "mas com a parede no meio 2 passos não chegam");
            Assert.IsTrue(tab.Alcance(origem, 12).ContainsKey(alvo),
                          "dando a volta, chega");
        }

        [Test]
        public void Mundo_e_DaPosicao_sao_inversos()
        {
            var tab = Novo();
            for (int x = 0; x < tab.Largura; x++)
                for (int y = 0; y < tab.Altura; y++)
                {
                    var p = new Vector2Int(x, y);
                    Assert.AreEqual(p, tab.DaPosicao(tab.Mundo(p)));
                }
        }

        [Test]
        public void Fora_do_tabuleiro_nao_e_caminhavel()
        {
            var tab = Novo();
            Assert.IsFalse(tab.Caminhavel(new Vector2Int(-1, 0)));
            Assert.IsFalse(tab.Caminhavel(new Vector2Int(12, 0)));
            Assert.IsTrue(tab.Caminhavel(new Vector2Int(11, 9)));
        }
    }
}
