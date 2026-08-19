using NUnit.Framework;
using UnityEngine;
using Soterra.Cena;

namespace Soterra.Testes.Cena
{
    /// <summary>
    /// O auto-tiling, medido sem tocar em asset nenhum: a regra é aritmética de
    /// bits e caixas, e testá-la contra o kit importado só a tornaria lenta e
    /// dependente de quem rodou o conversor.
    /// </summary>
    public class AutoParedeTests
    {
        // Caixa de uma peça já normalizada: uma casa de lado. Espessura 0,125,
        // que é a da parede reta do kit (0,5 de 4 unidades).
        static Bounds Caixa(float minX, float maxX, float minZ, float maxZ)
        {
            var b = new Bounds();
            b.SetMinMax(new Vector3(minX, 0f, minZ), new Vector3(maxX, 1f, maxZ));
            return b;
        }

        // As quatro peças de parede do kit, nas medidas que a Unity devolveu
        // (ver MedidaDoKit): note que o X vem ESPELHADO do glTF pela ponte
        // Blender→FBX, e é justamente disso que a medida defende.
        static Bounds Reta { get { return Caixa(-0.5f, 0.5f, -0.125f, 0.125f); } }
        static Bounds Quina { get { return Caixa(-0.125f, 0.5f, -0.125f, 0.5f); } }
        static Bounds Te { get { return Caixa(-0.5f, 0.5f, -0.125f, 0.5f); } }
        static Bounds Meia { get { return Caixa(-0.5f, 0f, -0.125f, 0.125f); } }
        static Bounds Coluna { get { return Caixa(-0.19f, 0.19f, -0.19f, 0.19f); } }

        [Test]
        public void BracosDe_LeOsBracosDeCadaPeca()
        {
            Assert.AreEqual(Lados.Leste | Lados.Oeste, AutoParede.BracosDe(Reta));
            Assert.AreEqual(Lados.Leste | Lados.Sul, AutoParede.BracosDe(Quina));
            Assert.AreEqual(Lados.Leste | Lados.Sul | Lados.Oeste, AutoParede.BracosDe(Te));
            Assert.AreEqual(Lados.Oeste, AutoParede.BracosDe(Meia));
            Assert.AreEqual(Lados.Todos, AutoParede.BracosDe(Caixa(-0.5f, 0.5f, -0.5f, 0.5f)));

            // A coluna não estende braço NENHUM, e é isso que a distingue da
            // parede: se ela contasse como braço, toda casa de parede solta
            // pediria uma peça de encaixe que não existe.
            Assert.AreEqual(Lados.Nenhum, AutoParede.BracosDe(Coluna));
        }

        [Test]
        public void BracosDe_NaoConfundeEspessuraComBraco()
        {
            // A peça mais gorda do kit sem braço é a coluna lavrada, com 0,279 de
            // meia-largura; o braço mais curto avança 0,5. O limiar tem de cair
            // entre os dois — e este teste é o que impede alguém de mexer nele
            // sem perceber que colou num dos lados.
            Assert.Less(0.279f, AutoParede.LimiarDeBraco, "o limiar desceu abaixo da coluna lavrada");
            Assert.Less(AutoParede.LimiarDeBraco, 0.5f, "o limiar subiu acima do braço mais curto");
        }

        [Test]
        public void Girar_UmQuartoLevaSulParaLesteEDaVoltaEmQuatro()
        {
            Assert.AreEqual(Lados.Leste, AutoParede.Girar(Lados.Sul, 1));
            Assert.AreEqual(Lados.Norte, AutoParede.Girar(Lados.Leste, 1));
            Assert.AreEqual(Lados.Oeste, AutoParede.Girar(Lados.Norte, 1));
            Assert.AreEqual(Lados.Sul, AutoParede.Girar(Lados.Oeste, 1));

            var reta = Lados.Leste | Lados.Oeste;
            Assert.AreEqual(reta, AutoParede.Girar(reta, 4), "quatro quartos não voltaram ao lugar");
            Assert.AreEqual(Lados.Norte | Lados.Sul, AutoParede.Girar(reta, 1),
                            "a reta em X tinha de virar reta em Z");
            Assert.AreEqual(AutoParede.Girar(reta, 3), AutoParede.Girar(reta, -1),
                            "−1 e +3 deram resultados diferentes");
        }

        [Test]
        public void QuartosPara_AchaOGiroDaQuinaNosQuatroCantos()
        {
            // A quina do kit chega com braços a LESTE e SUL. Os quatro cantos de
            // uma sala pedem as quatro combinações adjacentes, e cada uma tem de
            // sair de um quarto de volta — se sobrar uma sem giro, aquele canto
            // da sala fica aberto.
            var quina = AutoParede.BracosDe(Quina);
            var pedidos = new[]
            {
                Lados.Leste | Lados.Sul, Lados.Sul | Lados.Oeste,
                Lados.Oeste | Lados.Norte, Lados.Norte | Lados.Leste
            };
            for (int i = 0; i < pedidos.Length; i++)
            {
                int q = AutoParede.QuartosPara(quina, pedidos[i]);
                Assert.GreaterOrEqual(q, 0, "canto " + pedidos[i] + " ficou sem giro");
                Assert.AreEqual(pedidos[i], AutoParede.Girar(quina, q));
            }
        }

        [Test]
        public void QuartosPara_DevolveMenosUmQuandoAPecaNaoServe()
        {
            // Silenciar isto com um zero faria a parede fechar torta e ninguém
            // descobriria por quê: a peça apareceria, só que virada.
            Assert.AreEqual(-1, AutoParede.QuartosPara(AutoParede.BracosDe(Reta),
                                                       Lados.Leste | Lados.Sul));
        }

        [Test]
        public void Reta_SoEhRetaComDoisLadosOPOSTOS()
        {
            Assert.IsTrue(AutoParede.Reta(Lados.Leste | Lados.Oeste));
            Assert.IsTrue(AutoParede.Reta(Lados.Norte | Lados.Sul));
            // Dois adjacentes são QUINA. Trocar os dois casos faz a sala inteira
            // virar zigue-zague sem quebrar mais nada.
            Assert.IsFalse(AutoParede.Reta(Lados.Norte | Lados.Leste));
            Assert.IsFalse(AutoParede.Reta(Lados.Todos));
            Assert.IsFalse(AutoParede.Reta(Lados.Leste));
        }

        [Test]
        public void Conta_ContaOsLados()
        {
            Assert.AreEqual(0, AutoParede.Conta(Lados.Nenhum));
            Assert.AreEqual(1, AutoParede.Conta(Lados.Sul));
            Assert.AreEqual(2, AutoParede.Conta(Lados.Leste | Lados.Oeste));
            Assert.AreEqual(4, AutoParede.Conta(Lados.Todos));
        }

        [Test]
        public void Saliencia_AchaOLadoParaOndeAPecaSeProjeta()
        {
            // A tocha de parede é pequena demais para o limiar de braço enxergar,
            // mas a caixa dela é toda de um lado do eixo. É assim que se descobre
            // para onde ela aponta sem escrever a direção à mão — e escrever à
            // mão erraria, porque a ponte glTF→FBX espelha o X.
            Assert.AreEqual(Lados.Sul, AutoParede.Saliencia(Caixa(-0.07f, 0.07f, 0f, 0.26f)));
            Assert.AreEqual(Lados.Norte, AutoParede.Saliencia(Caixa(-0.07f, 0.07f, -0.26f, 0f)));
            Assert.AreEqual(Lados.Leste, AutoParede.Saliencia(Caixa(0f, 0.26f, -0.07f, 0.07f)));
            Assert.AreEqual(Lados.Oeste, AutoParede.Saliencia(Caixa(-0.26f, 0f, -0.07f, 0.07f)));
        }
    }
}
