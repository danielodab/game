using System.Collections.Generic;
using NUnit.Framework;
using Soterra.Motor;

namespace Soterra.Testes.Motor
{
    // `Motor.X` dentro de `Soterra.Testes.Motor` acha o PRÓPRIO namespace de
    // teste antes de chegar em `Soterra.Motor`. O apelido global trava no lugar.
    using Motor = global::Soterra.Motor;

    using Batalha = global::Soterra.Motor.Batalha;

    /// <summary>
    /// O CHÃO como participante: as nove marcas <c>ev-*</c> que brotam sozinhas e
    /// agem sobre quem pisa, e o rodízio automático de clima do calabouço.
    ///
    /// Os dois dependem de a batalha saber em que calabouço está — daí
    /// <see cref="Cenario.MontarEm"/>. Sem o id, os dois ficam desligados de
    /// propósito: sala montada à mão não tem ciclo de clima para seguir.
    /// </summary>
    public class TerrenoTests
    {
        // ---- ciclo automático de clima ---------------------------------------

        /// <summary>
        /// O Coração Partido é o único calabouço com
        /// <c>weatherShiftEveryRounds</c> maior que zero — 3 — e o clima gira na
        /// 4ª rodada, não na 1ª: a sala tem de começar com o clima que declarou.
        /// </summary>
        [Test]
        public void No_Coracao_Partido_o_clima_gira_de_tres_em_tres_rodadas()
        {
            var mapa = Cenario.Aberta(8, 3);
            var ladino = Cenario.Heroi("espadachim", "h1", 1, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 6, 1);
            var b = Cenario.MontarEm("brokenheart", mapa, "calmo",
                                     Sorte.SempreOMaximo, ladino, vergasta);

            Assert.AreEqual("calmo", b.Clima, "o clima declarado abre a sala");

            Cenario.AteARodada(b, 3);
            Assert.AreEqual("calmo", b.Clima, "duas viradas ainda não completam o passo de 3");

            var diario = Cenario.AteARodada(b, 4);
            Assert.AreEqual("chuva", b.Clima, "o passo seguinte do ciclo canônico");

            var mudancas = new List<Evento>();
            for (int i = 0; i < diario.Count; i++)
                if (diario[i].Tipo == TipoDeEvento.MudancaDeClima) mudancas.Add(diario[i]);
            Assert.AreEqual(1, mudancas.Count, "a interface precisa do aviso para pintar a sala");

            Cenario.AteARodada(b, 7);
            Assert.AreEqual("estiagem", b.Clima, "e continua girando de três em três");
        }

        /// <summary>
        /// A Estufa tem <c>weatherShiftEveryRounds: 0</c>: o clima dela não muda
        /// sozinho nunca. Zero é clima FIXO, não "gira a cada rodada".
        /// </summary>
        [Test]
        public void Na_Estufa_o_clima_nao_gira_sozinho()
        {
            var mapa = Cenario.Aberta(8, 3);
            var ladino = Cenario.Heroi("espadachim", "h1", 1, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 6, 1);
            var b = Cenario.MontarEm("greenhouse", mapa, "calmo",
                                     Sorte.SempreOMaximo, ladino, vergasta);

            Cenario.AteARodada(b, 8);
            Assert.AreEqual("calmo", b.Clima);
        }

        // ---- marcas de evento ------------------------------------------------

        /// <summary>
        /// O pool de eventos NA ORDEM em que o motor o monta. O teste sorteia
        /// contra esta mesma lista em vez de contra ids escritos à mão: assim
        /// continua apontando para o evento certo se o acervo reordenar o
        /// arquivo.
        /// </summary>
        static List<global::Soterra.Dados.EventoDeTerreno> Poco()
        {
            return new List<global::Soterra.Dados.EventoDeTerreno>(Cenario.Acervo().EventosDeTerreno.Values);
        }

        /// <summary>
        /// A fração de sorteio que cai no MEIO da fatia de <paramref name="id"/>.
        /// Meio da fatia, e não a borda, para o teste não depender de qual lado
        /// do intervalo o sorteio considera fechado.
        /// </summary>
        static double FatiaDe(string id)
        {
            var poco = Poco();
            int total = 0;
            for (int i = 0; i < poco.Count; i++) total += poco[i].Peso;

            int antes = 0;
            for (int i = 0; i < poco.Count; i++)
            {
                if (poco[i].Id == id) return (antes + poco[i].Peso / 2.0) / total;
                antes += poco[i].Peso;
            }
            Assert.Fail("o acervo não tem o evento de terreno '" + id + "'");
            return 0;
        }

        /// <summary>
        /// Monta uma batalha na Estufa em que a marca <paramref name="eventoId"/>
        /// brota na casa (0,0) na virada para a rodada 2, e devolve a batalha
        /// pronta na vez do Ladino — que está a exatamente 4 passos dela.
        ///
        /// Os três primeiros sorteios do roteiro são, na ordem: se a marca brota
        /// (tem de ficar abaixo da taxa do calabouço), em qual casa livre, e
        /// qual dos nove eventos.
        ///
        /// Acabado o roteiro, todo sorteio vira <c>0,9</c> — acima da taxa da
        /// Estufa, o que impede uma marca nova de brotar a cada rodada e deixa o
        /// teste medir UMA marca em vez de um tapete delas.
        /// </summary>
        static Batalha ComMarcaEm00(string eventoId, params double[] depoisDaSemeadura)
        {
            var roteiro = new List<double> { 0.0, 0.0, FatiaDe(eventoId) };
            roteiro.AddRange(depoisDaSemeadura);

            var mapa = Cenario.Aberta(6, 3);
            var ladino = Cenario.Heroi("espadachim", "h1", 3, 1);
            var vespa = Cenario.Monstro("lantern-wasp", "m1", 5, 1);
            var b = Cenario.MontarEm("greenhouse", mapa, "calmo",
                                     new SorteRoteirizada(0.9, roteiro.ToArray()),
                                     ladino, vespa);

            Cenario.AteARodada(b, 2);
            Assert.AreEqual("h1", b.Atual.Uid, "a rodada 2 abre na vez do Ladino");
            return b;
        }

        [Test]
        public void A_marca_brota_no_chao_na_virada_da_rodada_e_some_ao_ser_pisada()
        {
            var b = ComMarcaEm00("ev-might");

            Assert.AreEqual(1, b.MarcasDeTerreno.Count, "brotou uma marca");
            var marca = b.MarcaEm(Cenario.Ponto(0, 0));
            Assert.IsNotNull(marca);
            Assert.AreEqual("ev-might", marca.EventoId);

            var ladino = b.Atual;
            var r = b.Andar(Cenario.Ponto(0, 0));

            Assert.IsTrue(r.Valido, r.Recusa);
            Assert.AreEqual(1, r.Do(TipoDeEvento.EventoDeTerreno).Count);
            Assert.AreEqual("ev-might", r.Do(TipoDeEvento.EventoDeTerreno)[0].FeiticoId);
            Assert.AreEqual(0, b.MarcasDeTerreno.Count, "a marca é gasta por quem pisa");

            // Fôlego de Bravura: `buff power 25`. O poder entra na conta de todo
            // dano conjurado, e é por lá que se prova que o efeito grudou.
            Assert.AreEqual(25, b.PoderDeConjuracao(ladino, b.Feitico("espadachim-neutro-1")));
        }

        /// <summary>
        /// Os NOVE eventos agem. Nenhum deles cai no <c>default</c> do motor —
        /// que é justamente o estado em que a marca some do chão e não faz nada,
        /// e o jogador lê como "pisei e não aconteceu".
        /// </summary>
        [Test]
        public void Os_nove_eventos_de_terreno_agem_e_nenhum_cai_no_ignorado()
        {
            var poco = Poco();
            Assert.AreEqual(9, poco.Count, "o acervo declara nove marcas `ev-*`");

            for (int i = 0; i < poco.Count; i++)
            {
                var id = poco[i].Id;
                var b = ComMarcaEm00(id);
                var r = b.Andar(Cenario.Ponto(0, 0));

                Assert.IsTrue(r.Valido, id + ": " + r.Recusa);
                Assert.AreEqual(1, r.Do(TipoDeEvento.EventoDeTerreno).Count,
                                id + ": a marca tem de anunciar que agiu");
                Assert.AreEqual(0, r.Do(TipoDeEvento.EfeitoIgnorado).Count,
                                id + ": todo efeito dela é conhecido pelo motor");
                Assert.AreEqual(0, b.MarcasDeTerreno.Count, id + ": e a marca some");
            }
        }

        /// <summary>
        /// A Surpresa é a única com <c>outcomes</c>: os efeitos dela são
        /// sorteados na hora de pisar. Quem lesse só <c>effects</c> faria o
        /// evento mais caro do acervo não fazer nada, calado.
        /// </summary>
        [Test]
        public void A_Surpresa_sorteia_um_desfecho_e_aplica_os_efeitos_dele()
        {
            // O quarto sorteio é o do desfecho; 0.0 cai no primeiro da lista.
            var b = ComMarcaEm00("ev-mystery", 0.0);
            var ladino = b.Atual;
            ladino.PV = ladino.PVMax - 40;   // ferido, para a cura do desfecho ter onde entrar

            var desfecho = Cenario.Acervo().EventosDeTerreno["ev-mystery"].Desfechos[0];
            var r = b.Andar(Cenario.Ponto(0, 0));

            Assert.IsTrue(r.Valido, r.Recusa);
            var anuncios = r.Do(TipoDeEvento.EventoDeTerreno);
            Assert.AreEqual(1, anuncios.Count);
            Assert.AreEqual(desfecho.Texto, anuncios[0].Detalhe,
                            "o texto do desfecho é o que a interface narra");
            Assert.AreEqual(1, r.Do(TipoDeEvento.Cura).Count,
                            "o primeiro desfecho do acervo é uma cura");
        }

        /// <summary>
        /// Marca não pisada apaga sozinha quando a duração dela acaba — em
        /// RODADAS. Sem isso o chão de uma sala longa viraria um tapete de
        /// marcas.
        /// </summary>
        [Test]
        public void Marca_que_ninguem_pisa_apaga_sozinha_quando_a_duracao_acaba()
        {
            var b = ComMarcaEm00("ev-focus");
            var duracao = Cenario.Acervo().EventosDeTerreno["ev-focus"].Duracao;
            Assert.Greater(duracao, 0);
            Assert.AreEqual(1, b.MarcasDeTerreno.Count);

            Cenario.AteARodada(b, 2 + duracao);
            Assert.IsNull(b.MarcaEm(Cenario.Ponto(0, 0)),
                          "a marca brotada na rodada 2 apaga " + duracao + " rodadas depois");
            Assert.AreEqual(0, b.MarcasDeTerreno.Count);
        }
    }
}
