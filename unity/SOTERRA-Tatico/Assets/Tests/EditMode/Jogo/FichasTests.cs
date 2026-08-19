using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.Jogo
{
    // Ver a nota de armadilha de nome em AcervoDoJogo.cs.
    using Motor = global::Soterra.Motor;
    using Cena = global::Soterra.Cena;
    using Jogo = global::Soterra.Jogo;

    /// <summary>
    /// O espelho motor→cena, com a lacuna conhecida no centro: a VALIDACAO_UNITY
    /// §2 registra que <c>summon</c> e <c>split</c> punham a unidade na lista do
    /// motor e NINGUÉM instanciava o modelo. Estes testes provam que o espelho
    /// fecha a lacuna — quem nasce no meio da batalha ganha ficha, e a ficha
    /// vira corpo em cena.
    /// </summary>
    public class FichasTests
    {
        /// <summary>Modelos sempre nulos: o que se mede aqui é a EXISTÊNCIA do
        /// corpo em cena, não o encaixe do acervo — a cápsula basta e é rápida.</summary>
        sealed class SemModelos : Cena.IFonteDeModelos
        {
            public GameObject Modelo(string id) { return null; }
        }

        [Test]
        public void FichaEspelhaAUnidade_CampoACampo()
        {
            var batalha = AcervoDoJogo.NovaBatalha();
            var fichas = Jogo.Fichas.De(batalha, AcervoDoJogo.Banco());

            Assert.AreEqual(batalha.Unidades.Count, fichas.Count,
                            "toda unidade do motor precisa de ficha — é vendo as ausentes que " +
                            "a cena sabe quem remover");

            for (int i = 0; i < fichas.Count; i++)
            {
                var u = batalha.Unidades[i];
                var f = fichas[i];
                Assert.AreEqual(u.Uid, f.Uid);
                Assert.AreEqual(u.ClasseOuMonstroId, f.Id);
                Assert.AreEqual(u.Lado == Motor.Lado.Heroi, f.Heroi);
                Assert.AreEqual(u.Casa, f.Casa);
                Assert.AreEqual(u.NoTabuleiro, f.NoTabuleiro);
            }
        }

        [Test]
        public void QuemNasceNoMeioDaBatalha_GanhaFicha()
        {
            var batalha = AcervoDoJogo.NovaBatalha();
            int antes = batalha.Unidades.Count;

            var nascido = Invocar(batalha);

            var fichas = Jogo.Fichas.De(batalha, AcervoDoJogo.Banco());
            Assert.AreEqual(antes + 1, fichas.Count, "a invocação não virou ficha");

            bool achou = false;
            for (int i = 0; i < fichas.Count; i++)
                if (fichas[i].Uid == nascido.Uid) { achou = true; break; }
            Assert.IsTrue(achou, "a ficha do invocado (" + nascido.Uid + ") não está na lista");
        }

        [Test]
        public void QuemNasceNoMeioDaBatalha_GanhaCorpoEmCena()
        {
            var go = new GameObject("palco-do-teste-de-fichas");
            try
            {
                var batalha = AcervoDoJogo.NovaBatalha();

                var palco = go.AddComponent<Cena.Palco>();
                palco.Pecas = new Cena.SemPecas();
                palco.Montar(batalha.Mapa);
                var elenco = new Cena.Elenco(palco, null, new SemModelos(), new Cena.Aparencia());

                elenco.Sincronizar(Jogo.Fichas.De(batalha, AcervoDoJogo.Banco()));
                int corposAntes = elenco.NoTabuleiro.Count;

                var nascido = Invocar(batalha);
                elenco.Sincronizar(Jogo.Fichas.De(batalha, AcervoDoJogo.Banco()));

                // ESTA é a lacuna da VALIDACAO_UNITY §2: o motor punha na lista
                // e ninguém instanciava. O corpo tem de existir.
                Assert.AreEqual(corposAntes + 1, elenco.NoTabuleiro.Count);
                Assert.IsNotNull(elenco.ObjetoDe(nascido.Uid),
                                 "o invocado está na batalha e não está na cena — o jogador " +
                                 "planejaria em cima de uma casa 'vazia' que devolve golpe");

                // E quem morre sai: o mesmo espelho nos dois sentidos.
                var vitima = PrimeiroMonstro(batalha);
                vitima.PV = 0;
                vitima.Viva = false;
                elenco.Sincronizar(Jogo.Fichas.De(batalha, AcervoDoJogo.Banco()));
                Assert.IsNull(elenco.ObjetoDe(vitima.Uid),
                              "o morto continuou em cena — um corpo sem dono no tabuleiro");
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }

        [Test]
        public void SoOChefeCarregaAlturaNaFicha()
        {
            var banco = AcervoDoJogo.Banco();

            string idDeChefe = null, idComum = null;
            foreach (var par in banco.Monstros)
            {
                if (par.Value == null) continue;
                if (par.Value.Chefe) { if (idDeChefe == null) idDeChefe = par.Key; }
                else { if (idComum == null) idComum = par.Key; }
            }
            Assert.IsNotNull(idDeChefe, "o bestiário está sem chefe — o acervo mudou?");
            Assert.IsNotNull(idComum, "o bestiário está sem monstro comum — o acervo mudou?");

            Assert.AreEqual(Cena.Elenco.AlturaDeChefe, Jogo.Fichas.AlturaDe(banco, idDeChefe),
                            "sem a altura na ficha o chefe de 5 m nasceria com 1,80 — e a " +
                            "presença dele é metade da sala");
            Assert.AreEqual(0f, Jogo.Fichas.AlturaDe(banco, idComum),
                            "zero quer dizer 'usa a tabela do Elenco', que é o certo para o comum");
            Assert.AreEqual(0f, Jogo.Fichas.AlturaDe(banco, "sumo"),
                            "classe mede pela tabela do contrato, nunca pela ficha");
        }

        // ================================================================ APOIO

        /// <summary>Invoca um bicho do próprio acervo numa casa livre —
        /// exatamente o que um feitiço de <c>summon</c> faz por dentro.</summary>
        static Motor.Unidade Invocar(Motor.Batalha batalha)
        {
            var invocador = PrimeiroMonstro(batalha);
            var casa = CasaLivre(batalha);
            var nascido = batalha.Invocar(invocador.ClasseOuMonstroId, casa, invocador);
            Assert.IsNotNull(nascido, "o motor recusou a invocação numa casa livre e andável");
            return nascido;
        }

        static Motor.Unidade PrimeiroMonstro(Motor.Batalha batalha)
        {
            for (int i = 0; i < batalha.Unidades.Count; i++)
                if (batalha.Unidades[i].Lado == Motor.Lado.Monstro &&
                    batalha.Unidades[i].NoTabuleiro)
                    return batalha.Unidades[i];
            Assert.Fail("a sala montou sem monstro nenhum");
            return null;
        }

        static Vector2Int CasaLivre(Motor.Batalha batalha)
        {
            for (int y = 0; y < batalha.Mapa.Altura; y++)
                for (int x = 0; x < batalha.Mapa.Largura; x++)
                {
                    var casa = new Vector2Int(x, y);
                    if (batalha.Mapa.Andavel(casa) && batalha.EmCasa(casa) == null) return casa;
                }
            Assert.Fail("não há casa livre na sala — o desenho mudou?");
            return default(Vector2Int);
        }
    }
}
