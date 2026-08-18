using System.Collections.Generic;
using NUnit.Framework;
using Soterra.Grade;
using UnityEngine;

namespace Soterra.Testes.Locomocao
{
    public class AlcanceTests
    {
        static List<Vector2Int> Lista(Alcance a, Mapa m, Vector2Int origem)
        {
            return new List<Vector2Int>(a.Casas(m, origem));
        }

        [Test]
        public void Min_afasta_o_mago_do_corpo_a_corpo()
        {
            // 'bruxo-terra-20' (Anel de Menires): range { min: 2, max: 8 }.
            // O `min` existe para o mago não acertar quem já está colado nele.
            var m = Desenho.Aberto(21, 17);
            var o = new Vector2Int(10, 8);
            var a = new Alcance(2, 8);

            Assert.IsFalse(a.Valido(m, o, o), "a própria casa está aquém do mínimo");
            Assert.IsFalse(a.Valido(m, o, new Vector2Int(11, 8)), "colado, não");
            Assert.IsTrue (a.Valido(m, o, new Vector2Int(12, 8)), "a 2, sim");
            Assert.IsTrue (a.Valido(m, o, new Vector2Int(18, 8)), "a 8, ainda");
            Assert.IsFalse(a.Valido(m, o, new Vector2Int(19, 8)), "a 9, não");
        }

        [Test]
        public void Default_da_struct_nao_e_o_alcance_padrao_do_jogo()
        {
            // `default(Alcance)` tem Max = 0: só a própria casa. O `sRange()` do
            // engine.js assume { min:0, max:1 } quando o feitiço não traz
            // `range`. Confundir os dois faria todo feitiço sem alcance
            // declarado virar um feitiço só sobre si mesmo.
            var m = Desenho.Aberto(5, 5);
            var o = new Vector2Int(2, 2);

            Assert.AreEqual(1, Lista(default(Alcance), m, o).Count, "default: só a própria casa");
            Assert.AreEqual(5, Lista(Alcance.Padrao,   m, o).Count, "padrão: ela e as quatro vizinhas");
            Assert.IsTrue(Lista(Alcance.Padrao, m, o).Contains(o), "min 0 inclui a própria casa");
        }

        [Test]
        public void Linha_trava_em_cruz_e_recusa_a_diagonal()
        {
            // 'sumo-agua-12' (Onda de Ombro): range { min:1, max:4, line:true }.
            var m = Desenho.Aberto(11, 11);
            var o = new Vector2Int(5, 5);
            var a = new Alcance(1, 4, true, false);

            Assert.IsTrue (a.Valido(m, o, new Vector2Int(9, 5)), "mesma linha");
            Assert.IsTrue (a.Valido(m, o, new Vector2Int(5, 9)), "mesma coluna");
            Assert.IsFalse(a.Valido(m, o, new Vector2Int(6, 6)), "diagonal não está em linha");
            Assert.AreEqual(16, Lista(a, m, o).Count, "quatro braços de quatro casas");
        }

        [Test]
        public void Visao_true_recusa_o_alvo_atras_do_ALTO_e_aceita_atras_do_BAIXO()
        {
            // A mesma prova de cobertura do VisaoTests, agora pela porta que a
            // interface usa: é aqui que o alvo some da tela quando há parede.
            var alto  = Desenho.De(".....", "..#..", ".....");
            var baixo = Desenho.De(".....", "..=..", ".....");
            var o = new Vector2Int(0, 1);
            var alvo = new Vector2Int(4, 1);
            var a = new Alcance(1, 6, false, true);

            Assert.IsFalse(a.Valido(alto,  o, alvo));
            Assert.IsTrue (a.Valido(baixo, o, alvo));
        }

        [Test]
        public void Sem_Visao_a_parede_nao_estorva()
        {
            // Nem todo feitiço pede visão; sem `los`, o alcance é só distância.
            var m = Desenho.De(".....", "..#..", ".....");
            var a = new Alcance(1, 6, false, false);

            Assert.IsTrue(a.Valido(m, new Vector2Int(0, 1), new Vector2Int(4, 1)));
        }

        [Test]
        public void Nao_se_mira_dentro_de_parede_de_cobertura_nem_de_buraco()
        {
            var m = Desenho.De(".#=~.");
            var o = new Vector2Int(0, 0);
            var a = new Alcance(0, 6);

            Assert.IsFalse(a.Valido(m, o, new Vector2Int(1, 0)), "'#' não é lugar");
            Assert.IsFalse(a.Valido(m, o, new Vector2Int(2, 0)), "'=' também não");
            Assert.IsFalse(a.Valido(m, o, new Vector2Int(3, 0)), "'~' também não");
            Assert.IsTrue (a.Valido(m, o, new Vector2Int(4, 0)), "chão do outro lado, sim");
        }

        [Test]
        public void Fora_do_mapa_nunca_e_alvo()
        {
            var m = Desenho.Aberto(5, 5);
            var a = new Alcance(0, 9);

            Assert.IsFalse(a.Valido(m, new Vector2Int(2, 2), new Vector2Int(-1, 2)));
            Assert.IsFalse(a.Valido(m, new Vector2Int(2, 2), new Vector2Int(5, 2)));
        }

        [Test]
        public void Casas_devolve_exatamente_o_que_Valido_aceita()
        {
            // As duas têm de concordar sempre: `Casas` é o que a tela pinta e
            // `Valido` é o que o clique aceita. Divergindo, o jogador clica numa
            // casa pintada e o feitiço não sai.
            var m = Desenho.De(Desenho.Vestibulo);
            var o = new Vector2Int(3, 8);
            var a = new Alcance(1, 6, false, true);

            var pintadas = new HashSet<Vector2Int>(a.Casas(m, o));
            int conferidas = 0;

            for (int y = 0; y < m.Altura; y++)
                for (int x = 0; x < m.Largura; x++)
                {
                    var p = new Vector2Int(x, y);
                    Assert.AreEqual(a.Valido(m, o, p), pintadas.Contains(p),
                                    "divergiram em " + p);
                    if (pintadas.Contains(p)) conferidas++;
                }

            Assert.Greater(conferidas, 0, "a sala real tem de dar alcance a alguma coisa");
        }
    }
}
