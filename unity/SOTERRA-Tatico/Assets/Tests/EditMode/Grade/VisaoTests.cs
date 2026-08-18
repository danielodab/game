using NUnit.Framework;
using Soterra.Grade;
using UnityEngine;

namespace Soterra.Testes.Locomocao
{
    public class VisaoTests
    {
        // Os dois mapas do teste principal. São IDÊNTICOS menos por um símbolo:
        // é isso que transforma "resultados opostos" em prova.
        static readonly string[] ComAlto  = { ".....", "..#..", "....." };
        static readonly string[] ComBaixo = { ".....", "..=..", "....." };

        static readonly Vector2Int Esquerda = new Vector2Int(0, 1);
        static readonly Vector2Int Direita  = new Vector2Int(4, 1);
        static readonly Vector2Int Meio     = new Vector2Int(2, 1);

        [Test]
        public void ALTO_bloqueia_a_visao_e_BAIXO_nao__mesma_geometria()
        {
            // A distinção que carrega o jogo inteiro. Atrás do baixo você é
            // atingível mas coberto; atrás do alto ninguém te vê. Bloquear os
            // dois igual apagaria a cobertura e o tabuleiro viraria labirinto.
            var alto  = Desenho.De(ComAlto);
            var baixo = Desenho.De(ComBaixo);

            Assert.AreEqual(Casa.ObstaculoAlto,  alto.Em(Meio));
            Assert.AreEqual(Casa.ObstaculoBaixo, baixo.Em(Meio));

            Assert.IsFalse(Visao.Livre(alto,  Esquerda, Direita), "'#' corta a linha de visão");
            Assert.IsTrue (Visao.Livre(baixo, Esquerda, Direita), "'=' é cobertura: continua visível");
        }

        [Test]
        public void Os_dois_fecham_a_passagem_igual__a_diferenca_e_so_a_visao()
        {
            // A outra metade da prova: se os mapas se comportassem diferente no
            // PASSO, o teste acima poderia estar medindo geometria, não visão.
            var alto  = Desenho.De(ComAlto);
            var baixo = Desenho.De(ComBaixo);

            var porAlto  = Passo.Alcance(alto,  Esquerda, 20);
            var porBaixo = Passo.Alcance(baixo, Esquerda, 20);

            Assert.IsFalse(porAlto.ContainsKey(Meio),  "não se anda por cima do alto");
            Assert.IsFalse(porBaixo.ContainsKey(Meio), "nem por cima do baixo");
            Assert.AreEqual(porAlto.Count, porBaixo.Count, "o mesmo tanto de casas dos dois lados");
            Assert.AreEqual(porAlto[Direita], porBaixo[Direita], "e o mesmo custo para dar a volta");
        }

        [Test]
        public void As_pontas_nao_contam()
        {
            // Só o que está ESTRITAMENTE entre as duas casas bloqueia. Exigir
            // ponta livre faria a unidade empurrada para cima de um obstáculo
            // perder a visão de si mesma.
            var m = Desenho.De("..#");
            var canto = new Vector2Int(0, 0);
            var parede = new Vector2Int(2, 0);

            Assert.IsTrue(Visao.Livre(m, canto, parede), "enxerga a parede que é o alvo");
            Assert.IsTrue(Visao.Livre(m, parede, canto), "e de dentro dela para fora");
            Assert.IsTrue(Visao.Livre(m, parede, parede), "e a si mesma");
        }

        [Test]
        public void Buraco_nao_tapa_a_vista()
        {
            // '~' é chão que falta, não parede: dá para atirar por cima dele.
            var m = Desenho.De("..~..");
            Assert.IsTrue(Visao.Livre(m, new Vector2Int(0, 0), new Vector2Int(4, 0)));
        }

        [Test]
        public void Parede_na_diagonal_tambem_corta()
        {
            //  . . .
            //  . # .     conjurador no canto de baixo, alvo no canto de cima
            //  . . .
            var m = Desenho.De("...", ".#.", "...");
            Assert.IsFalse(Visao.Livre(m, new Vector2Int(0, 0), new Vector2Int(2, 2)));
            Assert.IsTrue (Visao.Livre(m, new Vector2Int(0, 0), new Vector2Int(2, 0)),
                           "pela borda, livre");
        }

        [Test]
        public void Parede_fora_do_caminho_nao_atrapalha()
        {
            var m = Desenho.De(
                "#####",
                ".....",
                "#####");
            Assert.IsTrue(Visao.Livre(m, new Vector2Int(0, 1), new Vector2Int(4, 1)));
        }
    }
}
