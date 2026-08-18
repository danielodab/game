using NUnit.Framework;
using Soterra.Grade;
using UnityEngine;

namespace Soterra.Testes.Locomocao
{
    public class PassoTests
    {
        [Test]
        public void CORREDOR_EM_L__o_custo_e_o_caminho_e_nao_a_linha_reta()
        {
            // O defeito que este teste existe para pegar: medir alcance de passo
            // por Manhattan puro. A casa abaixo está a DOIS de distância crua e
            // custa DEZ passos — com a régua errada, o jogador andaria através
            // da parede.
            //
            //   . . . . .      origem em (0,2)
            //   # # # # .      a única passagem é pela direita
            //   . . . . .      alvo   em (0,0)
            var m = Desenho.De(
                ".....",
                "####.",
                ".....");

            var origem = new Vector2Int(0, 2);
            var alvo   = new Vector2Int(0, 0);

            Assert.AreEqual(2, Distancia.Manhattan(origem, alvo), "em linha reta seriam 2");

            Assert.IsFalse(Passo.Alcance(m, origem, 2).ContainsKey(alvo),
                           "com a parede no meio, 2 PP não chegam");
            Assert.IsFalse(Passo.Alcance(m, origem, 9).ContainsKey(alvo),
                           "nem 9");
            Assert.AreEqual(10, Passo.Alcance(m, origem, 10)[alvo],
                            "dando a volta, custa 10 — e é esse o número que o jogo cobra");
        }

        [Test]
        public void Um_passo_da_as_quatro_vizinhas_e_nunca_a_diagonal()
        {
            var m = Desenho.Aberto(3, 3);
            var r = Passo.Alcance(m, new Vector2Int(1, 1), 1);

            Assert.AreEqual(4, r.Count);
            Assert.IsFalse(r.ContainsKey(new Vector2Int(1, 1)), "a origem não é destino");
            Assert.IsFalse(r.ContainsKey(new Vector2Int(2, 2)), "a diagonal custa dois, não um");
        }

        [Test]
        public void O_custo_cresce_um_por_casa()
        {
            var m = Desenho.Aberto(9, 9);
            var r = Passo.Alcance(m, new Vector2Int(4, 4), 3);

            Assert.AreEqual(1, r[new Vector2Int(5, 4)]);
            Assert.AreEqual(3, r[new Vector2Int(7, 4)]);
            Assert.AreEqual(2, r[new Vector2Int(5, 5)], "a diagonal vizinha custa dois");
            Assert.IsFalse(r.ContainsKey(new Vector2Int(8, 4)), "4 passos não cabem em 3 PP");

            // Disco de Manhattan de raio 3 = 2·3²+2·3+1 = 25 casas, menos a origem.
            Assert.AreEqual(24, r.Count);
        }

        [Test]
        public void Nem_alto_nem_baixo_nem_buraco_se_atravessa()
        {
            // A coluna do meio é intransponível pelos três motivos diferentes.
            var m = Desenho.De(
                "..#..",
                "..=..",
                "..~..");

            var r = Passo.Alcance(m, new Vector2Int(0, 1), 20);

            Assert.AreEqual(5, r.Count, "só as seis casas da esquerda, menos a origem");
            Assert.IsFalse(r.ContainsKey(new Vector2Int(2, 2)), "'#' não se pisa");
            Assert.IsFalse(r.ContainsKey(new Vector2Int(2, 1)), "'=' também não");
            Assert.IsFalse(r.ContainsKey(new Vector2Int(2, 0)), "'~' também não");
            Assert.IsFalse(r.ContainsKey(new Vector2Int(4, 1)), "e o outro lado fica inalcançável");
        }

        [Test]
        public void Unidade_parada_no_corredor_fecha_a_passagem_como_parede()
        {
            var m = Desenho.De(
                "#####",
                ".....",
                "#####");

            var origem = new Vector2Int(0, 1);
            var fundo  = new Vector2Int(4, 1);
            var ocupada = new Vector2Int(2, 1);

            Assert.IsTrue(Passo.Alcance(m, origem, 4).ContainsKey(fundo),
                          "com o corredor livre, chega");

            var comAlguem = Passo.Alcance(m, origem, 4, new[] { ocupada });
            Assert.IsFalse(comAlguem.ContainsKey(ocupada), "não se para em cima de alguém");
            Assert.IsFalse(comAlguem.ContainsKey(fundo),   "nem se passa por cima");
            Assert.IsTrue (comAlguem.ContainsKey(new Vector2Int(1, 1)), "mas chega até ele");
        }

        [Test]
        public void Estar_na_propria_casa_nao_prende_a_unidade()
        {
            // Quem anda está em cima de si mesmo. Conferir a origem contra
            // `ocupadas` faria toda unidade nascer imóvel — e o chamador não tem
            // por que filtrar a si mesmo da lista.
            var m = Desenho.Aberto(3, 3);
            var origem = new Vector2Int(1, 1);

            Assert.AreEqual(4, Passo.Alcance(m, origem, 1, new[] { origem }).Count);
        }

        [Test]
        public void Sem_PP_nao_ha_destino()
        {
            var m = Desenho.Aberto(5, 5);
            Assert.AreEqual(0, Passo.Alcance(m, new Vector2Int(2, 2), 0).Count);
            Assert.AreEqual(0, Passo.Alcance(m, new Vector2Int(2, 2), -1).Count);
        }

        [Test]
        public void O_Ladino_anda_uma_casa_a_mais_que_todo_mundo()
        {
            // SISTEMAS §3: o Ladino (`espadachim`) tem 4 PP; as outras cinco
            // classes têm 3. Numa sala aberta isso é um disco de Manhattan a
            // mais — 24 casas contra 40, e não 3 contra 4.
            var m = Desenho.Aberto(21, 17);
            var centro = new Vector2Int(10, 8);

            Assert.AreEqual(24, Passo.Alcance(m, centro, 3).Count);
            Assert.AreEqual(40, Passo.Alcance(m, centro, 4).Count);
        }
    }
}
