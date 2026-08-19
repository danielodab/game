using System.Collections.Generic;
using NUnit.Framework;
using Soterra.Progressao;

namespace Soterra.Testes.Progressao
{
    using Motor = global::Soterra.Motor;

    /// <summary>
    /// O laço que faltava: vencer uma sala leva à próxima, até o chefe.
    ///
    /// Antes disto jogava-se UMA sala e acabava — não havia próxima sala, não
    /// havia chefe e a XP da batalha não ia para lugar nenhum.
    /// </summary>
    public class DescidaTests
    {
        static Descida Estufa(Progresso p, params string[] grupo)
        {
            var d = Descida.Comecar(p, "greenhouse", grupo);
            Assert.IsNotNull(d, "a Estufa Soterrada tem de abrir");
            return d;
        }

        [Test]
        public void Vencer_uma_sala_leva_a_proxima_ate_o_chefe()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var d = Estufa(p, "sumo");

            Assert.AreEqual(3, d.TotalDeSalas, "a Estufa tem três salas");
            Assert.AreEqual(0, d.IndiceDaSala);
            Assert.AreEqual(EstadoDaDescida.EmSala, d.Estado);
            Assert.IsFalse(d.EhSalaDoChefe);
            Assert.IsFalse(d.Terminou);

            // ---- sala 0
            var b0 = Bancada.SalaVencida(p, d.Grupo, new[] { 90 }, "pollen-puff");
            Assert.IsNotNull(d.RegistrarVitoria(b0, Motor.Sorte.SempreOMaximo));
            Assert.AreEqual(EstadoDaDescida.SalaVencida, d.Estado);
            Assert.IsTrue(d.ProximaSala());
            Assert.AreEqual(1, d.IndiceDaSala);
            Assert.IsFalse(d.EhSalaDoChefe, "a do meio não é a do chefe");

            // ---- sala 1
            var b1 = Bancada.SalaVencida(p, d.Grupo, new[] { 70 }, "thorn-lasher");
            d.RegistrarVitoria(b1, Motor.Sorte.SempreOMaximo);
            Assert.IsTrue(d.ProximaSala());
            Assert.AreEqual(2, d.IndiceDaSala);
            Assert.IsTrue(d.EhSalaDoChefe, "a última sala do calabouço é sempre a do chefe");

            // ---- o chefe
            var b2 = Bancada.SalaVencida(p, d.Grupo, new[] { 30 }, "boss-gardener");
            d.RegistrarVitoria(b2, Motor.Sorte.SempreOMaximo);
            Assert.AreEqual(EstadoDaDescida.CalaboucoConcluido, d.Estado);
            Assert.IsTrue(d.Terminou);
            Assert.IsFalse(d.ProximaSala(), "depois do chefe não há para onde ir");
            Assert.AreEqual(2, d.IndiceDaSala, "e o índice não pode ter estourado");
        }

        [Test]
        public void Nao_se_avanca_sem_vencer_a_sala()
        {
            var p = Bancada.Novo(Bancada.Real());
            var d = Estufa(p, "sumo");
            Assert.IsFalse(d.ProximaSala(), "a sala em pé não deixa passar");
            Assert.AreEqual(0, d.IndiceDaSala);
        }

        [Test]
        public void A_derrota_encerra_a_descida_e_o_que_foi_ganho_fica()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var d = Estufa(p, "sumo");

            var b = Bancada.SalaVencida(p, d.Grupo, new[] { 50 }, "pollen-puff", "thorn-lasher");
            d.RegistrarVitoria(b, Motor.Sorte.SempreOMaximo);
            var xpGanha = p.Heroi("sumo").Xp;
            Assert.Greater(xpGanha, 0);

            d.ProximaSala();
            d.RegistrarDerrota();

            Assert.AreEqual(EstadoDaDescida.Derrota, d.Estado);
            Assert.IsTrue(d.Terminou);
            Assert.IsFalse(d.ProximaSala());
            Assert.AreEqual(xpGanha, p.Heroi("sumo").Xp,
                "perder a descida não desfaz o que já tinha sido conquistado");
        }

        [Test]
        public void Grupo_de_tres_ou_com_heroi_que_nao_existe_e_recusado_na_porta()
        {
            var p = Bancada.Novo(Bancada.Real());

            Assert.IsNull(Descida.Comecar(p, "greenhouse", new[] { "sumo", "curandeira", "sumo#2" }),
                "o grupo é de 1 ou 2 — três quebraria a fusão e a economia do saque");
            Assert.IsNull(Descida.Comecar(p, "greenhouse", new[] { "sumo", "sumo" }),
                "o mesmo herói duas vezes não é uma dupla");
            Assert.IsNull(Descida.Comecar(p, "greenhouse", new string[0]));
            Assert.IsNull(Descida.Comecar(p, "greenhouse", new[] { "arqueiro" }),
                "classe ainda trancada não tem ficha para descer");
            Assert.IsNull(Descida.Comecar(p, "calabouco-que-nao-existe", new[] { "sumo" }));
        }

        [Test]
        public void Entre_salas_o_vivo_cura_metade_do_que_perdeu_e_o_morto_volta_de_pe()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var d = Estufa(p, "sumo", "curandeira");
            var pvMaximo = 150;

            Assert.AreEqual(pvMaximo, d.PvDeEntrada("sumo", pvMaximo),
                "na primeira sala todo mundo entra cheio");

            // O Bárbaro termina com 40 de 150; a Paladina tomba.
            var b = Bancada.SalaVencida(p, d.Grupo, new[] { 40, 0 }, "pollen-puff");
            d.RegistrarVitoria(b, Motor.Sorte.SempreOMaximo);

            Assert.AreEqual(40 + (150 - 40) / 2, d.PvDeEntrada("sumo", pvMaximo),
                "quem sobreviveu recupera metade do que perdeu — nem tudo, nem nada");
            Assert.AreEqual(45, d.PvDeEntrada("curandeira", pvMaximo),
                "quem tombou volta com 30% da vida cheia: sem revive, uma morte cedo condena a descida");
            Assert.Greater(d.PvDeEntrada("curandeira", pvMaximo), 0, "nunca volta com zero");
        }

        [Test]
        public void A_sala_paga_a_XP_dos_monstros_mortos_dividida_pelo_grupo()
        {
            var banco = Bancada.Real();

            // 0,9 + 0,9 + 1,1 = 2,9. O `xp` do monstro é fracionário de
            // propósito: a soma da SALA é que vira inteiro.
            var xpDaSala = 2 * banco.Monstros["pollen-puff"].Xp + banco.Monstros["thorn-lasher"].Xp;

            var solo = Bancada.Novo(banco);
            var dSolo = Estufa(solo, "sumo");
            var rSolo = dSolo.RegistrarVitoria(
                Bancada.SalaVencida(solo, dSolo.Grupo, new[] { 100 },
                                    "pollen-puff", "pollen-puff", "thorn-lasher"),
                Motor.Sorte.SempreOMaximo);
            Assert.AreEqual((int)System.Math.Floor(xpDaSala), rSolo.XpDaSala);
            Assert.AreEqual(rSolo.XpDaSala, solo.Heroi("sumo").Xp);

            var dupla = Bancada.Novo(banco);
            var dDupla = Estufa(dupla, "sumo", "curandeira");
            var rDupla = dDupla.RegistrarVitoria(
                Bancada.SalaVencida(dupla, dDupla.Grupo, new[] { 100, 100 },
                                    "pollen-puff", "pollen-puff", "thorn-lasher"),
                Motor.Sorte.SempreOMaximo);
            Assert.AreEqual((int)System.Math.Floor(xpDaSala / 2), rDupla.XpDaSala,
                "a mesma sala paga metade para cada um quando são dois");
            Assert.AreEqual(rDupla.XpDaSala, dupla.Heroi("sumo").Xp);
            Assert.AreEqual(rDupla.XpDaSala, dupla.Heroi("curandeira").Xp,
                "os dois recebem, vivos ou mortos");
        }

        [Test]
        public void Subir_de_nivel_na_sala_aparece_na_recompensa()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var d = Estufa(p, "sumo");

            // A Jardineira-Viúva paga 19,2 de XP; o nível 2 custa 15.
            var b = Bancada.SalaVencida(p, d.Grupo, new[] { 10 }, "boss-gardener");
            var r = d.RegistrarVitoria(b, Motor.Sorte.SempreOMaximo);

            Assert.AreEqual(1, r.Subidas.Count);
            Assert.AreEqual("sumo", r.Subidas[0].IdDoHeroi);
            Assert.AreEqual(p.NivelDe("sumo"), r.Subidas[0].NovoNivel);
            Assert.AreEqual(1.0, r.MultiplicadorDeXp["sumo"], 0.0001,
                "nível 1 na Estufa está dentro da faixa: XP cheia");
        }

        [Test]
        public void So_o_chefe_derruba_carta_e_bicho()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var d = Estufa(p, "sumo");

            // `SempreOMinimo` faz todo sorteio cair no primeiro resultado — se a
            // carta pudesse sair numa sala comum, ela sairia aqui.
            var r0 = d.RegistrarVitoria(
                Bancada.SalaVencida(p, d.Grupo, new[] { 100 }, "pollen-puff"),
                Motor.Sorte.SempreOMinimo);
            Assert.IsNull(r0.Carta, "sala comum não paga carta");
            Assert.IsNull(r0.Bicho, "nem bicho");

            d.ProximaSala();
            d.RegistrarVitoria(Bancada.SalaVencida(p, d.Grupo, new[] { 100 }, "pollen-puff"),
                               Motor.Sorte.SempreOMaximo);
            d.ProximaSala();
            Assert.IsTrue(d.EhSalaDoChefe);

            var r2 = d.RegistrarVitoria(
                Bancada.SalaVencida(p, d.Grupo, new[] { 100 }, "boss-gardener"),
                Motor.Sorte.SempreOMinimo);

            Assert.IsNotNull(r2.Carta, "o chefe paga carta");
            Assert.AreEqual("sumo", r2.Carta.IdDaClasse, "a primeira da piscina da Estufa");
            Assert.AreEqual("pet-snapvine", r2.Bicho, "e o bicho da Estufa é o Trepadeira");
            Assert.AreEqual("pet-snapvine", p.Estado.Bichos[0], "que já entra na coleção");
        }

        [Test]
        public void As_pedras_saem_do_ELEMENTO_do_monstro_morto()
        {
            var banco = Bancada.Real();
            var p = Bancada.Novo(banco);
            var d = Estufa(p, "sumo");
            var jardineira = banco.Monstros["boss-gardener"];

            var r = d.RegistrarVitoria(
                Bancada.SalaVencida(p, d.Grupo, new[] { 100 }, "boss-gardener"),
                Motor.Sorte.SempreOMinimo);

            var pedraDeTerra = p.PedraDoElemento(jardineira.Elemento);
            Assert.IsTrue(r.Pedras.ContainsKey(pedraDeTerra),
                "a Jardineira é de terra e paga Grão de Rocha-Mãe");
            Assert.AreEqual(jardineira.QuedaDePedra.Min, r.Pedras[pedraDeTerra],
                "com o sorteio no piso, cai o mínimo declarado no acervo");
            Assert.AreEqual(r.Pedras[pedraDeTerra], p.ContarPedras(pedraDeTerra),
                "e elas entram no estoque do grupo");
        }

        [Test]
        public void A_descida_sobrevive_a_fechar_o_jogo_pelo_progresso_que_ela_gravou()
        {
            var banco = Bancada.Real();
            ArmazemDeMemoria armazem;
            var p = Bancada.Novo(banco, out armazem);
            var d = Estufa(p, "sumo");

            d.RegistrarVitoria(
                Bancada.SalaVencida(p, d.Grupo, new[] { 100 }, "boss-gardener"),
                Motor.Sorte.SempreOMaximo);

            var p2 = Progresso.Carregar(banco, armazem);
            Assert.AreEqual(p.Heroi("sumo").Xp, p2.Heroi("sumo").Xp,
                "a XP da sala foi gravada sem ninguém precisar pedir");
        }
    }
}
