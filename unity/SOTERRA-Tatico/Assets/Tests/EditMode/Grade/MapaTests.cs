using NUnit.Framework;
using Soterra.Grade;
using UnityEngine;

namespace Soterra.Testes.Locomocao
{
    /// <summary>
    /// A leitura do desenho. Se estes testes caem, todos os outros mentem —
    /// eles medem geometria sobre um mapa que não é o que foi desenhado.
    /// </summary>
    public class MapaTests
    {
        [Test]
        public void Linha_de_cima_do_desenho_vira_o_Y_mais_alto()
        {
            // Sem esta inversão o mapa sai espelhado na vertical em relação ao
            // que a pessoa desenhou, e todo teste escrito a olho mentiria.
            var m = Desenho.De(
                "###",
                "...",
                "===");

            Assert.AreEqual(3, m.Largura);
            Assert.AreEqual(3, m.Altura);
            Assert.AreEqual(Casa.ObstaculoAlto,  m.Em(new Vector2Int(0, 2)), "topo do desenho");
            Assert.AreEqual(Casa.Chao,           m.Em(new Vector2Int(0, 1)), "meio");
            Assert.AreEqual(Casa.ObstaculoBaixo, m.Em(new Vector2Int(0, 0)), "base do desenho");
        }

        [Test]
        public void Cada_simbolo_vira_a_casa_que_SISTEMAS_manda()
        {
            var m = Desenho.De(".,#=~");

            Assert.AreEqual(Casa.Chao,           m.Em(new Vector2Int(0, 0)));
            Assert.AreEqual(Casa.ChaoDecorado,   m.Em(new Vector2Int(1, 0)));
            Assert.AreEqual(Casa.ObstaculoAlto,  m.Em(new Vector2Int(2, 0)));
            Assert.AreEqual(Casa.ObstaculoBaixo, m.Em(new Vector2Int(3, 0)));
            Assert.AreEqual(Casa.Vazio,          m.Em(new Vector2Int(4, 0)));
        }

        [Test]
        public void Alto_baixo_e_buraco_fecham_a_passagem__so_o_alto_fecha_a_visao()
        {
            var m = Desenho.De(".,#=~");

            Assert.IsTrue (m.Andavel(new Vector2Int(0, 0)), "'.' anda");
            Assert.IsTrue (m.Andavel(new Vector2Int(1, 0)), "',' também é chão");
            Assert.IsFalse(m.Andavel(new Vector2Int(2, 0)), "'#' não anda");
            Assert.IsFalse(m.Andavel(new Vector2Int(3, 0)), "'=' não anda");
            Assert.IsFalse(m.Andavel(new Vector2Int(4, 0)), "'~' não anda");

            Assert.IsTrue (m.BloqueiaVisao(new Vector2Int(2, 0)), "só o alto corta a visão");
            Assert.IsFalse(m.BloqueiaVisao(new Vector2Int(3, 0)), "'=' é cobertura");
            Assert.IsFalse(m.BloqueiaVisao(new Vector2Int(4, 0)), "buraco não tapa nada");
        }

        [Test]
        public void Nascimento_e_chao__e_nao_um_tipo_de_piso()
        {
            // Tratar nascimento como casa especial faria a unidade nascer presa
            // dentro de si mesma.
            var m = Desenho.De("P.a");

            Assert.IsTrue(m.Andavel(new Vector2Int(0, 0)), "o herói nasce em chão andável");
            Assert.IsTrue(m.Andavel(new Vector2Int(2, 0)), "o monstro também");
            Assert.AreEqual(new Vector2Int(0, 0), m.NascimentoHeroi);
            Assert.AreEqual(new Vector2Int(2, 0), m.NascimentoMonstros['a']);
        }

        [Test]
        public void Linha_curta_completa_com_vazio_em_vez_de_dar_erro()
        {
            // Desenho feito à mão quase sempre perde o espaço do fim da linha;
            // recusar o mapa por isso só treina a pessoa a encher de espaço
            // invisível.
            var m = Desenho.De(
                "....",
                "..");

            Assert.AreEqual(4, m.Largura, "a largura é a da linha mais longa");
            Assert.AreEqual(Casa.Vazio, m.Em(new Vector2Int(3, 0)), "o que faltou virou vazio");
            Assert.IsFalse(m.Andavel(new Vector2Int(3, 0)));
        }

        [Test]
        public void Fora_do_mapa_nao_esta_dentro_e_nunca_e_andavel()
        {
            var m = Desenho.Aberto(4, 3);

            Assert.IsFalse(m.Dentro(new Vector2Int(-1, 0)));
            Assert.IsFalse(m.Dentro(new Vector2Int(4, 0)));
            Assert.IsFalse(m.Dentro(new Vector2Int(0, 3)));
            Assert.IsTrue (m.Dentro(new Vector2Int(3, 2)));

            Assert.IsFalse(m.Andavel(new Vector2Int(-1, 0)));
            Assert.AreEqual(Casa.Vazio, m.Em(new Vector2Int(99, 99)), "fora do mapa lê como vazio");
        }

        [Test]
        public void Sala_de_verdade_cabe_na_faixa_de_tamanho_de_SISTEMAS()
        {
            var m = Desenho.De(Desenho.Vestibulo);

            Assert.AreEqual(21, m.Largura);
            Assert.AreEqual(17, m.Altura);
            Assert.IsTrue(m.Largura >= 21 && m.Largura <= 27, "SISTEMAS §2: de 21×17 a 27×23");
            Assert.IsTrue(m.Altura  >= 17 && m.Altura  <= 23);
            Assert.IsTrue(m.Andavel(m.NascimentoHeroi), "o herói não nasce dentro de parede");
        }

        [Test]
        public void DEFEITO_CONHECIDO_a_sala_traz_seis_nascimentos_de_heroi_e_a_API_guarda_um()
        {
            // O contrato §5 declara `NascimentoHeroi` como UM Vector2Int e
            // `NascimentoMonstros` como um dicionário por letra. A sala real tem
            // SEIS casas 'P' — o jogo desce com DOIS heróis (SISTEMAS §1) e não
            // há onde pôr o segundo — e repete as letras 'a' e 'b', que ali
            // significam dois monstros do mesmo tipo.
            //
            // Este teste NÃO abençoa a perda: ele deixa o buraco medido e
            // visível. Quando a assinatura for corrigida para listas, ele falha
            // de propósito e a correção passa por aqui.
            var m = Desenho.De(Desenho.Vestibulo);

            Assert.AreEqual(6, Desenho.Contar(Desenho.Vestibulo, 'P'), "o desenho tem seis 'P'");
            Assert.AreEqual(2, Desenho.Contar(Desenho.Vestibulo, 'a'), "e dois 'a'");

            Assert.AreEqual(3, m.NascimentoMonstros.Count,
                            "cinco monstros desenhados, três guardados: 'a' e 'b' repetem");
            Assert.AreEqual(new Vector2Int(2, 7), m.NascimentoHeroi,
                            "sobra o ÚLTIMO 'P' lido; os outros cinco somem");
        }
    }
}
