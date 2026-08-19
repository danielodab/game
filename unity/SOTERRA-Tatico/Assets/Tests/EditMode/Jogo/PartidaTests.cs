using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.Jogo
{
    // Ver a nota de armadilha de nome em AcervoDoJogo.cs.
    using Motor = global::Soterra.Motor;
    using Jogo = global::Soterra.Jogo;

    /// <summary>
    /// O toque virando jogada. É a metade do laço que o dedo comanda: cada um
    /// destes testes é um gesto que o jogador VAI fazer na cena, reproduzido
    /// sem tela — se algum falhar, o defeito apareceria como "toquei e nada
    /// aconteceu", que é o pior tipo de defeito para se caçar em Play.
    /// </summary>
    public class PartidaTests
    {
        Motor.Batalha _batalha;
        Jogo.Partida _partida;

        [SetUp]
        public void Antes()
        {
            _batalha = AcervoDoJogo.NovaBatalha();
            _partida = new Jogo.Partida(AcervoDoJogo.Banco(), _batalha);
        }

        // ================================================================ ANDAR

        [Test]
        public void TocarCasaAlcancavel_SemFeiticoNaMao_Anda()
        {
            AcervoDoJogo.AteVezDoHeroi(_batalha);
            var heroi = _batalha.Atual;

            Vector2Int destino = default(Vector2Int);
            bool achou = false;
            foreach (var par in _batalha.AlcanceDePasso()) { destino = par.Key; achou = true; break; }
            Assert.IsTrue(achou, "o herói recém-chegado não alcança casa nenhuma — PP zerado?");

            var r = _partida.TocarCasa(destino);

            Assert.IsNotNull(r, "o toque numa casa alcançável tem de virar jogada");
            Assert.IsTrue(r.Valido, "o passo foi recusado: " + r.Recusa);
            Assert.AreEqual(destino, heroi.Casa, "a unidade não chegou onde o toque mandou");
            Assert.IsTrue(r.Tem(Motor.TipoDeEvento.Movimento),
                          "andar sem evento de movimento deixa a cena sem saber que animar");
        }

        [Test]
        public void TocarAPropriaCasa_NaoEJogada()
        {
            AcervoDoJogo.AteVezDoHeroi(_batalha);
            var r = _partida.TocarCasa(_batalha.Atual.Casa);
            Assert.IsNull(r, "tocar em si mesmo não pode gastar nada nem recusar nada");
        }

        // ============================================================= CONJURAR

        [Test]
        public void EscolherFeiticoETocarNumAlvo_Conjura_EEsvaziaAMao()
        {
            string feitico;
            var alvos = AteHeroiComAlvo(out feitico);

            _partida.EscolherFeitico(feitico);
            Assert.AreEqual(feitico, _partida.FeiticoEscolhido);

            var r = _partida.TocarCasa(alvos[0]);

            Assert.IsNotNull(r);
            Assert.IsTrue(r.Valido, "o lançamento num alvo que o próprio motor listou foi " +
                                    "recusado: " + r.Recusa);
            Assert.IsTrue(r.Tem(Motor.TipoDeEvento.Conjuracao));
            Assert.IsNull(_partida.FeiticoEscolhido,
                          "a mão tem de esvaziar depois do lançamento aceito — senão o toque " +
                          "seguinte conjura de novo em vez de andar");
        }

        [Test]
        public void ToqueForaDoAlcance_RecusaSemEsvaziarAMao()
        {
            string feitico;
            var alvos = AteHeroiComAlvo(out feitico);
            var proibida = CasaForaDe(alvos);

            _partida.EscolherFeitico(feitico);
            var r = _partida.TocarCasa(proibida);

            Assert.IsNotNull(r, "a recusa tem de chegar à tela com motivo — o silêncio diante " +
                                "do clique foi o defeito da linha JS");
            Assert.IsFalse(r.Valido);
            Assert.IsFalse(string.IsNullOrEmpty(r.Recusa), "recusa sem motivo não explica nada");
            Assert.AreEqual(feitico, _partida.FeiticoEscolhido,
                            "um dedo que errou a casa por um ponto não deveria ter de reabrir a barra");
        }

        [Test]
        public void EscolherOMesmoFeiticoDeNovo_Desarma()
        {
            string feitico;
            AteHeroiComAlvo(out feitico);

            _partida.EscolherFeitico(feitico);
            _partida.EscolherFeitico(feitico);

            Assert.IsNull(_partida.FeiticoEscolhido, "o segundo toque no mesmo botão é o jeito " +
                                                     "de cancelar sem mouse — não pode reescolher");
        }

        // =============================================================== TURNOS

        [Test]
        public void NoTurnoDoMonstro_OToqueNaoFazNada()
        {
            AcervoDoJogo.AteVezDoMonstro(_batalha);

            Assert.IsFalse(_partida.TurnoDoJogador);
            Assert.IsNull(_partida.TocarCasa(new Vector2Int(1, 1)));
            Assert.IsNull(_partida.EncerrarTurno(),
                          "o botão de encerrar não pode passar o turno DO MONSTRO");
        }

        [Test]
        public void EncerrarTurno_LimpaAMaoEPassaAVez()
        {
            string feitico;
            AteHeroiComAlvo(out feitico);
            var quemJogava = _batalha.Atual;

            _partida.EscolherFeitico(feitico);
            var r = _partida.EncerrarTurno();

            Assert.IsNotNull(r);
            Assert.IsNull(_partida.FeiticoEscolhido,
                          "o feitiço escolhido era da unidade que jogava, não da próxima");
            Assert.AreNotSame(quemJogava, _batalha.Atual, "a vez não passou");
        }

        [Test]
        public void JogadaDoMonstro_NoTurnoDoHeroi_ENula()
        {
            AcervoDoJogo.AteVezDoHeroi(_batalha);
            Assert.IsNull(_partida.JogadaDoMonstro());
        }

        [Test]
        public void JogadasDoMonstroEmParcelas_SempreTerminamOTurno()
        {
            AcervoDoJogo.AteVezDoMonstro(_batalha);
            var monstro = _batalha.Atual;

            // O teto do Cerebro mais a folga da rede: se depois disso a vez
            // ainda for do mesmo bicho, a cena penduraria no turno inimigo.
            int teto = global::Soterra.IA.Cerebro.TetoDeJogadas + 4;
            for (int i = 0; i < teto; i++)
            {
                if (_batalha.Fase != Motor.FaseDaBatalha.EmAndamento) return;
                if (_batalha.Atual != monstro) return;
                _partida.JogadaDoMonstro();
            }
            Assert.Fail("o turno de " + monstro.Uid + " não terminou em " + teto +
                        " jogadas — é o laço infinito que travaria o Play");
        }

        // ================================================================ APOIO

        /// <summary>
        /// Avança até um herói que tenha ALGUM feitiço com alvo listado pelo
        /// motor. O bruxo mira o chão, então isso sempre acontece na primeira
        /// rodada — a guarda só protege a suíte de um acervo mudado.
        /// </summary>
        List<Vector2Int> AteHeroiComAlvo(out string feitico)
        {
            for (int volta = 0; volta < 30; volta++)
            {
                AcervoDoJogo.AteVezDoHeroi(_batalha);
                var eu = _batalha.Atual;
                for (int i = 0; i < eu.Feiticos.Count; i++)
                {
                    var alvos = _batalha.AlvosDe(eu.Feiticos[i]);
                    if (alvos.Count > 0)
                    {
                        feitico = eu.Feiticos[i];
                        return new List<Vector2Int>(alvos);
                    }
                }
                _batalha.EncerrarTurno();
            }
            feitico = null;
            Assert.Fail("nenhum herói teve feitiço com alvo em 30 turnos — o acervo mudou?");
            return null;
        }

        Vector2Int CasaForaDe(List<Vector2Int> alvos)
        {
            var mapa = _batalha.Mapa;
            var dentro = new HashSet<Vector2Int>(alvos);
            for (int y = 0; y < mapa.Altura; y++)
                for (int x = 0; x < mapa.Largura; x++)
                {
                    var casa = new Vector2Int(x, y);
                    if (!dentro.Contains(casa) && casa != _batalha.Atual.Casa) return casa;
                }
            Assert.Fail("o feitiço alcança o mapa inteiro — não dá para testar a recusa com ele");
            return default(Vector2Int);
        }
    }
}
