using NUnit.Framework;
using Soterra.Grade;
using UnityEngine;

namespace Soterra.Testes.Locomocao
{
    public class DistanciaTests
    {
        [Test]
        public void Manhattan_soma_os_eixos_e_nao_encurta_pela_diagonal()
        {
            // Se um dia isto virar distância euclidiana, (2,2) passa a valer
            // 2,83 e o alcance do feitiço deixa de bater com o custo do passo.
            Assert.AreEqual(4, Distancia.Manhattan(new Vector2Int(0, 0), new Vector2Int(2, 2)));
            Assert.AreEqual(3, Distancia.Manhattan(new Vector2Int(0, 0), new Vector2Int(3, 0)));
            Assert.AreEqual(0, Distancia.Manhattan(new Vector2Int(7, 4), new Vector2Int(7, 4)));
        }

        [Test]
        public void Manhattan_nao_depende_do_sinal_nem_da_ordem()
        {
            var a = new Vector2Int(-3, 5);
            var b = new Vector2Int(2, -1);

            Assert.AreEqual(11, Distancia.Manhattan(a, b));
            Assert.AreEqual(Distancia.Manhattan(a, b), Distancia.Manhattan(b, a));
        }
    }
}
