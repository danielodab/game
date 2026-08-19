using System.Collections.Generic;
using NUnit.Framework;
using Soterra.Interface;

namespace Soterra.Testes.Interface
{
    // Ver a nota de armadilha de nome nos testes do Motor. Aqui há uma a mais:
    // `Cenario` sem apelido é o DESTA pasta (Soterra.Testes.Interface.Cenario);
    // o que monta batalha de verdade é o do Motor, e precisa de nome próprio.
    using Motor = global::Soterra.Motor;
    using CenarioDoMotor = global::Soterra.Testes.Motor.Cenario;

    /// <summary>
    /// A ponte motor→tela na parte da fusão, contra uma batalha DE VERDADE: o
    /// quadro acende o botão quando o motor lista candidato, marca a pendência
    /// depois de declarar, e — o principal — a barra da FUNDIDA sai do registro
    /// da batalha, não do banco. Era o buraco desta rodada: o id da fundida
    /// (`arqueiro+bruxo`) não é classe nem monstro, e o caminho antigo
    /// (<c>Repertorio.De</c>) devolvia barra VAZIA no exato turno em que o
    /// jogador pagou 2 PA por um arsenal novo.
    /// </summary>
    public class PonteDaFusaoTests
    {
        /// <summary>Arqueiro e bruxo COLADOS, Vergasta longe — o mesmo palco dos
        /// testes do motor, para os números daqui não poderem divergir dos de lá.</summary>
        static Motor.Batalha BatalhaComDupla()
        {
            var mapa = CenarioDoMotor.Aberta(9, 3);
            var b = CenarioDoMotor.Montar(mapa, Motor.Sorte.SempreOMaximo,
                CenarioDoMotor.Heroi("arqueiro", "h1", 1, 1),
                CenarioDoMotor.Heroi("bruxo", "h2", 2, 1),
                CenarioDoMotor.Monstro("thorn-lasher", "m1", 7, 1));
            CenarioDoMotor.AteAVezDe(b, "h1");
            return b;
        }

        [Test]
        public void ComAliadoColado_OQuadroAcendeAFusao()
        {
            var banco = Cenario.BancoOuInconclusivo();
            var b = BatalhaComDupla();

            var q = PonteDoMotor.Quadro(b, banco);

            Assert.IsTrue(q.PodeFundir, "o motor lista h2 como candidato de h1");
            Assert.IsFalse(q.FusaoPendente);
            Assert.AreEqual(Motor.Batalha.CustoDePaDaFusao, q.CustoDaFusao,
                "o custo do rótulo vem do motor — um '2' cravado na interface " +
                "mentiria no dia em que o motor mudasse");
        }

        [Test]
        public void ComFusaoDeclarada_OQuadroMarcaAPendencia()
        {
            var banco = Cenario.BancoOuInconclusivo();
            var b = BatalhaComDupla();
            Assert.IsTrue(b.DeclararFusao("h1", "h2").Valido);

            var q = PonteDoMotor.Quadro(b, banco);

            Assert.IsTrue(q.FusaoPendente, "é a pendência que vira 'Cancelar fusão'");
            Assert.IsFalse(q.PodeFundir,
                "uma fusão por vez na sala: pendente, ninguém mais é candidato");
        }

        [Test]
        public void ABarraDaFundida_SaiDoRegistroDaBatalha_NaoDoBanco()
        {
            var banco = Cenario.BancoOuInconclusivo();
            var b = BatalhaComDupla();
            b.DeclararFusao("h1", "h2");
            b.EncerrarTurno();

            var fundida = b.Acha("h1");
            Assert.IsTrue(fundida.EFusao, "a fusão não resolveu — o teste não mede nada");
            CenarioDoMotor.AteAVezDe(b, "h1");

            var q = PonteDoMotor.Quadro(b, banco);

            // O nome visível vem de `fusionIdentities` — id cru na tela foi o
            // defeito da linha JS que o Repertorio documenta.
            Assert.AreEqual(banco.IdentidadesDeFusao[fundida.ClasseOuMonstroId].Nome,
                q.Atual.Nome);
            Assert.AreNotEqual(fundida.ClasseOuMonstroId, q.Atual.Nome);

            // A barra: um botão por composto que se conjura à mão, com os
            // números do PRÓPRIO feitiço registrado na batalha.
            int esperados = 0;
            for (int i = 0; i < fundida.Feiticos.Count; i++)
            {
                var f = b.Feitico(fundida.Feiticos[i]);
                Assert.IsNotNull(f, "a batalha não resolve " + fundida.Feiticos[i]);
                if (Repertorio.PodeAparecerNaBarra(f)) esperados++;
            }
            Assert.Greater(esperados, 0, "a fundida ficou sem arsenal conjurável");
            Assert.AreEqual(esperados, q.Feiticos.Count,
                "a barra da fundida tem de mostrar o arsenal composto inteiro");

            for (int i = 0; i < q.Feiticos.Count; i++)
            {
                var na = q.Feiticos[i];
                StringAssert.StartsWith("fus:", na.Id);
                var f = b.Feitico(na.Id);
                Assert.AreEqual(f.CustoDePa, na.CustoDePa, na.Id + ": custo errado");
                Assert.AreEqual(f.Recarga, na.Recarga, na.Id + ": recarga errada");
                Assert.AreEqual(f.Nome, na.Nome);
            }

            // E o banco segue sem saber deles — é o que impede um composto de
            // vazar de uma batalha para a outra.
            Assert.IsNull(banco.AchaFeitico(q.Feiticos[0].Id));
        }

        [Test]
        public void ARecargaRestante_ChegaNaBarraPeloIdComposto()
        {
            var banco = Cenario.BancoOuInconclusivo();
            var b = BatalhaComDupla();
            b.DeclararFusao("h1", "h2");
            b.EncerrarTurno();
            CenarioDoMotor.AteAVezDe(b, "h1");

            var fundida = b.Acha("h1");
            var id = fundida.Feiticos[0];

            // O mapa é o MESMO que a Partida passa (`Unidade.Recargas`): a
            // chave é o id composto, e a barra tem de reencontrá-lo por ele.
            var recargas = new Dictionary<string, int> { { id, 1 } };
            var q = PonteDoMotor.Quadro(b, banco, null, recargas);

            FeiticoNaTela na = null;
            for (int i = 0; i < q.Feiticos.Count; i++)
                if (q.Feiticos[i].Id == id) na = q.Feiticos[i];

            Assert.IsNotNull(na, "o composto sumiu da barra");
            Assert.AreEqual(1, na.RecargaRestante,
                "a recarga corrente é estado de batalha e viaja pelo id — se o " +
                "id da barra e o do motor divergirem, o botão nunca esfria");
        }
    }
}
