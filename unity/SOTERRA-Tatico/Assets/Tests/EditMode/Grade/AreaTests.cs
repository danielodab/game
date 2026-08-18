using NUnit.Framework;
using Soterra.Grade;
using UnityEngine;

namespace Soterra.Testes.Locomocao
{
    public class AreaTests
    {
        [Test]
        public void EXPLOSAO_LARGADA_ENTRE_DOIS_INIMIGOS_PEGA_OS_DOIS()
        {
            // Feitiço de área mira o CHÃO. A casa-alvo é um LUGAR: basta estar
            // no alcance, e a área pega quem estiver dentro — ou ninguém.
            //
            // Antes disso, `targetSide:'enemy'` exigia inimigo NA PRÓPRIA casa,
            // então a explosão só podia cair EM CIMA de alguém: não dava para
            // largá-la entre dois inimigos nem chutar onde o outro VAI estar.
            // Era metade da mecânica de posicionamento jogada fora.
            //
            //   C . . I A I .      C conjurador, I inimigos, A o alvo VAZIO
            var m = Desenho.Aberto(7, 3);
            var conjurador = new Vector2Int(0, 1);
            var inimigoA   = new Vector2Int(3, 1);
            var inimigoB   = new Vector2Int(5, 1);
            var chaoVazio  = new Vector2Int(4, 1);

            // 'bruxo-fogo-*': range { min:1, max:4, los:true }, aoe circle 1.
            var alcance = new Alcance(1, 4, false, true);
            Assert.IsTrue(alcance.Valido(m, conjurador, chaoVazio),
                          "a casa sem ninguém em cima é alvo legítimo");

            var pego = Area.Casas(m, conjurador, chaoVazio, Forma.Circle, 1);
            Assert.IsTrue(pego.Contains(inimigoA),  "o inimigo da esquerda entra na explosão");
            Assert.IsTrue(pego.Contains(inimigoB),  "o da direita também");
            Assert.IsTrue(pego.Contains(chaoVazio), "e o chão mirado");

            // O contraste que fecha a regra: o MESMO tiro de alvo único, na
            // MESMA casa, não pega ninguém — é por isso que só ele exige
            // criatura na casa, e a área não.
            var alvoUnico = Area.Casas(m, conjurador, chaoVazio, Forma.Single, 0);
            Assert.AreEqual(1, alvoUnico.Count);
            Assert.IsFalse(alvoUnico.Contains(inimigoA));
            Assert.IsFalse(alvoUnico.Contains(inimigoB));
        }

        [Test]
        public void A_area_nao_pergunta_quem_esta_em_pe_onde()
        {
            // A outra metade da mesma regra: nenhuma sobrecarga de `Area.Casas`
            // recebe ocupação, de propósito. A forma se desenha sobre o CHÃO;
            // quem estiver dentro é problema da camada de combate.
            var m = Desenho.Aberto(7, 7);
            var alvo = new Vector2Int(3, 3);

            var vazia = Area.Casas(m, new Vector2Int(0, 3), alvo, Forma.Circle, 2);
            Assert.AreEqual(13, vazia.Count, "disco de Manhattan de raio 2");
        }

        [Test]
        public void Single_ignora_o_tamanho()
        {
            var m = Desenho.Aberto(9, 9);
            Assert.AreEqual(1, Area.Casas(m, new Vector2Int(0, 4), new Vector2Int(4, 4),
                                          Forma.Single, 3).Count);
        }

        [Test]
        public void Circle_e_disco_de_Manhattan__a_mesma_regua_do_passo()
        {
            var m = Desenho.Aberto(15, 15);
            var o = new Vector2Int(0, 7);
            var alvo = new Vector2Int(7, 7);

            Assert.AreEqual(1,  Area.Casas(m, o, alvo, Forma.Circle, 0).Count);
            Assert.AreEqual(5,  Area.Casas(m, o, alvo, Forma.Circle, 1).Count);
            Assert.AreEqual(13, Area.Casas(m, o, alvo, Forma.Circle, 2).Count);
            Assert.IsFalse(Area.Casas(m, o, alvo, Forma.Circle, 1).Contains(new Vector2Int(8, 8)),
                           "a diagonal está a 2, fora do raio 1");
        }

        [Test]
        public void Cross_e_o_alvo_mais_quatro_bracos()
        {
            var m = Desenho.Aberto(15, 15);
            var pego = Area.Casas(m, new Vector2Int(0, 7), new Vector2Int(7, 7), Forma.Cross, 2);

            Assert.AreEqual(9, pego.Count, "1 + 4×2");
            Assert.IsTrue (pego.Contains(new Vector2Int(9, 7)));
            Assert.IsTrue (pego.Contains(new Vector2Int(7, 5)));
            Assert.IsFalse(pego.Contains(new Vector2Int(8, 8)), "a cruz não tem diagonal");
        }

        [Test]
        public void Ring_deixa_o_meio_de_fora()
        {
            // 'bruxo-terra-20' (Anel de Menires): aoe { shape:'ring', size:2 }.
            // É o meio vazio que faz valer a pena largar o anel em cima de um
            // aliado cercado.
            var m = Desenho.Aberto(15, 15);
            var alvo = new Vector2Int(7, 7);
            var pego = Area.Casas(m, new Vector2Int(0, 7), alvo, Forma.Ring, 2);

            Assert.AreEqual(8, pego.Count, "coroa de Manhattan exatamente 2");
            Assert.IsFalse(pego.Contains(alvo), "o miolo fica de fora");
            Assert.IsFalse(pego.Contains(new Vector2Int(8, 7)), "nem o anel de raio 1");
            Assert.IsTrue (pego.Contains(new Vector2Int(9, 7)));
            Assert.IsTrue (pego.Contains(new Vector2Int(8, 8)), "a diagonal está a 2");
        }

        [Test]
        public void Line_parte_DO_alvo_e_se_afasta_do_conjurador()
        {
            // 'arqueiro-terra-12' (Tiro Perfurante): aoe { shape:'line', size:7 }.
            var m = Desenho.Aberto(15, 3);
            var alvo = new Vector2Int(5, 1);
            var pego = Area.Casas(m, new Vector2Int(1, 1), alvo, Forma.Line, 4);

            Assert.AreEqual(4, pego.Count);
            Assert.AreEqual(alvo, pego[0], "a linha começa NO alvo, não no conjurador");
            Assert.IsTrue (pego.Contains(new Vector2Int(8, 1)), "e segue se afastando");
            Assert.IsFalse(pego.Contains(new Vector2Int(4, 1)), "nunca volta para trás");
        }

        [Test]
        public void Line_do_outro_lado_aponta_ao_contrario()
        {
            var m = Desenho.Aberto(15, 3);
            var alvo = new Vector2Int(5, 1);
            var pego = Area.Casas(m, new Vector2Int(9, 1), alvo, Forma.Line, 4);

            Assert.IsTrue (pego.Contains(new Vector2Int(2, 1)), "agora se afasta para a esquerda");
            Assert.IsFalse(pego.Contains(new Vector2Int(8, 1)));
        }

        [Test]
        public void Cone_abre_no_sentido_oposto_ao_conjurador()
        {
            // 'bruxo-fogo-10' (Cone de Cinzas): aoe { shape:'cone', size:3 }.
            // Linha i tem 2i+1 casas: 1 + 3 + 5 = 9 = size².
            var m = Desenho.Aberto(15, 15);
            var alvo = new Vector2Int(5, 7);
            var pego = Area.Casas(m, new Vector2Int(1, 7), alvo, Forma.Cone, 3);

            Assert.AreEqual(9, pego.Count);
            Assert.IsTrue (pego.Contains(alvo), "a ponta do cone é o alvo");
            Assert.IsTrue (pego.Contains(new Vector2Int(7, 5)), "e a boca abre para os lados");
            Assert.IsTrue (pego.Contains(new Vector2Int(7, 9)));
            Assert.IsFalse(pego.Contains(new Vector2Int(4, 7)), "nada atrás do alvo");
        }

        [Test]
        public void Cone_sobe_quando_o_alvo_esta_acima_do_conjurador()
        {
            // O eixo dominante decide sozinho: não existe cone na diagonal.
            var m = Desenho.Aberto(15, 15);
            var pego = Area.Casas(m, new Vector2Int(7, 1), new Vector2Int(7, 5), Forma.Cone, 3);

            Assert.AreEqual(9, pego.Count);
            Assert.IsTrue (pego.Contains(new Vector2Int(5, 7)));
            Assert.IsTrue (pego.Contains(new Vector2Int(9, 7)));
            Assert.IsFalse(pego.Contains(new Vector2Int(7, 4)), "nada para baixo");
        }

        [Test]
        public void Area_pula_o_obstaculo_ALTO_e_entra_na_cobertura_e_no_buraco()
        {
            // Só `#` fica de fora. A explosão passa por cima do murinho e cai no
            // buraco — é o mesmo `type !== 'wall'` do `Engine.aoeTiles`.
            var m = Desenho.De(
                ".....",
                ".#.=.",
                "..~..");

            var pego = Area.Casas(m, new Vector2Int(0, 1), new Vector2Int(2, 1), Forma.Circle, 1);

            Assert.AreEqual(4, pego.Count);
            Assert.IsFalse(pego.Contains(new Vector2Int(1, 1)), "'#' não entra");
            Assert.IsTrue (pego.Contains(new Vector2Int(3, 1)), "'=' entra: passa por cima");
            Assert.IsTrue (pego.Contains(new Vector2Int(2, 0)), "'~' entra: cai dentro");
        }

        [Test]
        public void O_braco_da_cruz_nao_para_na_parede__ele_pula_e_continua()
        {
            // Comportamento do `Engine.aoeTiles`, documentado aqui porque
            // surpreende: a área é uma FORMA desenhada sobre o mapa, não um
            // feixe que colide. A casa de parede sai do resultado, mas o braço
            // reaparece do outro lado. Se um dia isso mudar, muda no JS junto.
            var m = Desenho.De("..#..");
            var pego = Area.Casas(m, new Vector2Int(0, 0), new Vector2Int(0, 0), Forma.Cross, 4);

            Assert.AreEqual(4, pego.Count);
            Assert.IsFalse(pego.Contains(new Vector2Int(2, 0)), "a parede em si não entra");
            Assert.IsTrue (pego.Contains(new Vector2Int(4, 0)), "mas o braço continua do outro lado");
        }

        [Test]
        public void A_area_nao_transborda_do_mapa()
        {
            var m = Desenho.Aberto(5, 5);
            var pego = Area.Casas(m, new Vector2Int(2, 2), new Vector2Int(0, 0), Forma.Circle, 2);

            foreach (var p in pego)
                Assert.IsTrue(m.Dentro(p), p + " caiu fora do mapa");

            // Canto de um mapa 5×5: sobra um quarto de disco de raio 2 = 6 casas.
            Assert.AreEqual(6, pego.Count);
        }
    }
}
