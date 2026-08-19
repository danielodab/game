using System.Collections.Generic;
using NUnit.Framework;
using Soterra.Progressao;

namespace Soterra.Testes.Progressao
{
    /// <summary>
    /// Os NÚMEROS deste jogo, cobrados contra o acervo exportado.
    ///
    /// Não é teste de leitura de JSON — disso cuida o <c>ManifestoTests</c>. É
    /// teste de FORMA: 90 itens espalhados em 18 conjuntos de quatro peças, 18
    /// salas em 6 calabouços, 30 degraus de XP, seis escadas de feitiço iguais.
    /// Quando uma dessas contas mudar, ela tem de mudar aqui também — de
    /// propósito. Um número que muda calado é um número que ninguém escolheu.
    /// </summary>
    public class AcervoDeProgressaoTests
    {
        [Test]
        public void O_acervo_tem_90_itens_em_18_conjuntos_de_quatro_pecas()
        {
            var banco = Bancada.Real();
            Assert.AreEqual(90, banco.Itens.Count);
            Assert.AreEqual(18, banco.Conjuntos.Count);

            foreach (var par in banco.Conjuntos)
            {
                Assert.AreEqual(4, par.Value.Pecas.Count, par.Key + " não tem quatro peças");

                var espacos = new List<string>();
                foreach (var peca in par.Value.Pecas)
                {
                    Assert.IsTrue(banco.Itens.ContainsKey(peca),
                        par.Key + " lista uma peça que não existe: " + peca);
                    var espaco = banco.Itens[peca].Espaco;
                    Assert.IsFalse(espacos.Contains(espaco),
                        par.Key + " tem duas peças no espaço " + espaco);
                    espacos.Add(espaco);
                }
                Assert.AreEqual(4, espacos.Count, par.Key + " não cobre os quatro espaços");
            }
        }

        [Test]
        public void Os_seis_calaboucos_somam_18_salas_e_cada_um_termina_num_chefe()
        {
            var banco = Bancada.Real();
            Assert.AreEqual(6, banco.Calabocos.Count);

            var salas = 0;
            foreach (var calabouco in banco.Calabocos)
            {
                salas += calabouco.Salas.Count;
                var ultima = calabouco.SalaDoChefe;
                Assert.IsNotNull(ultima, calabouco.Id + " não tem sala nenhuma");

                var temChefe = false;
                foreach (var par in ultima.Monstros)
                {
                    Soterra.Dados.Monstro m;
                    if (banco.Monstros.TryGetValue(par.Value, out m) && m.Chefe) temChefe = true;
                }
                Assert.IsTrue(temChefe, "a última sala de " + calabouco.Id + " não tem chefe dentro");
            }
            Assert.AreEqual(18, salas, "18 salas no total — três por calabouço");
        }

        [Test]
        public void As_seis_classes_pagam_estrela_com_5_15_30_55_e_90_cartas()
        {
            var banco = Bancada.Real();
            Assert.AreEqual(6, banco.Cartas.Count);

            var esperado = new[] { 5, 15, 30, 55, 90 };
            foreach (var par in banco.Cartas)
                CollectionAssert.AreEqual(esperado, par.Value.CustoDasEstrelas,
                    "os custos de estrela de " + par.Key + " saíram da régua");

            Assert.AreEqual(esperado.Length, banco.Estrelas.Maximo,
                "há um degrau de custo para cada estrela, e não sobra nem falta");
        }

        [Test]
        public void As_seis_classes_tem_quatro_caminhos_de_seis_feiticos_com_os_mesmos_degraus()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var degrausEsperados = new[] { 5, 10, 12, 15, 20, 30 };

            Assert.AreEqual(6, banco.Classes.Count);
            CollectionAssert.AreEqual(degrausEsperados, banco.DegrausDeDesbloqueio,
                "`unlockTiers` é a reserva, e ela descreve a mesma escada");

            foreach (var classe in banco.Classes)
            {
                Assert.AreEqual(4, classe.Value.Caminhos.Count, classe.Key + " não tem quatro caminhos");
                foreach (var caminho in classe.Value.Caminhos)
                {
                    Assert.AreEqual(6, caminho.Value.Count,
                        classe.Key + "/" + caminho.Key + " não tem seis feitiços");
                    for (int i = 0; i < caminho.Value.Count; i++)
                        Assert.AreEqual(degrausEsperados[i], p.NivelDeDesbloqueio(caminho.Value[i], i),
                            caminho.Value[i] + " abre num degrau que não é o da escada");
                }
            }
        }

        [Test]
        public void A_forja_vai_ao_mais_10_e_o_saque_conhece_os_seis_calaboucos()
        {
            var banco = Bancada.Real();

            Assert.AreEqual(10, banco.Forja.NivelMaximo);
            Assert.AreEqual(10, banco.Forja.CustoEmPedras.Count, "um custo por degrau, do +0 ao +9");
            Assert.AreEqual(5, banco.Pedras.Count, "uma pedra por elemento");

            foreach (var calabouco in banco.Calabocos)
                Assert.IsTrue(banco.PesosDeSaque.SemQueda.ContainsKey(calabouco.Id),
                    calabouco.Id + " não tem peso de 'nada' — o saque dele viria solto");
        }

        [Test]
        public void Cada_item_do_acervo_cai_num_calabouco_que_existe()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);

            foreach (var par in banco.Itens)
            {
                var it = par.Value;
                if (string.IsNullOrEmpty(it.IdDoCalabouco)) continue;
                Assert.IsNotNull(banco.AchaCalabouco(it.IdDoCalabouco),
                    par.Key + " cai num calabouço que não existe: " + it.IdDoCalabouco);

                // E a pedra que ele consome na forja tem de ser uma das cinco.
                Assert.IsTrue(banco.Pedras.ContainsKey(p.PedraDoItem(it)),
                    par.Key + " comeria uma pedra que não existe no acervo");
            }
        }
    }
}
