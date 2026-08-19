using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using Soterra.Motor;

namespace Soterra.Testes.Fusao
{
    // `Motor.X` e `Dados.X` dentro de `Soterra.Testes.Fusao` acham os
    // namespaces de teste (`Soterra.Testes.Motor`, `Soterra.Testes.Dados`)
    // antes dos de produção (CS0234). Os apelidos globais travam no lugar certo
    // — a mesma armadilha documentada nos testes do motor.
    using Motor = global::Soterra.Motor;
    using Batalha = global::Soterra.Motor.Batalha;
    using Dados = global::Soterra.Dados;
    using Cenario = global::Soterra.Testes.Motor.Cenario;

    /// <summary>
    /// O `Fundir` do motor: declarar custa 2 PA e resolve no fim do turno; a
    /// fundida É a unidade anfitriã, mutada — uid, casa e vez preservados; o
    /// convidado sai sem morte e sem derrota; e a morte da fundida é morte de
    /// verdade, sem caminho de volta.
    /// </summary>
    public class FundirTests
    {
        static int IndiceNaOrdem(Batalha b, string uid)
        {
            for (int i = 0; i < b.Ordem.Count; i++)
                if (b.Ordem[i].Uid == uid) return i;
            return -1;
        }

        /// <summary>O meio-para-cima do motor, para conferir médias sem copiar a saída.</summary>
        static int Media(int x, int y)
        {
            return (int)System.Math.Floor((x + y) / 2.0 + 0.5);
        }

        [Test]
        public void A_fundida_mantem_uid_casa_e_vez_do_anfitriao_e_a_ficha_soma()
        {
            var mapa = Cenario.Aberta(9, 3);
            var arqueiro = Cenario.Heroi("arqueiro", "h1", 1, 1);
            var bruxo = Cenario.Heroi("bruxo", "h2", 2, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 7, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, arqueiro, bruxo, vergasta);
            Cenario.AteAVezDe(b, "h1");

            // A ficha ANTES, capturada para as somas não saírem de constante.
            var casa = arqueiro.Casa;
            int indice = IndiceNaOrdem(b, "h1");
            int pvMax = arqueiro.PVMax + bruxo.PVMax;
            int pv = arqueiro.PV + bruxo.PV;
            int paMax = System.Math.Max(arqueiro.PAMax, bruxo.PAMax) + Batalha.BonusDePaDaFusao;
            int ppMax = System.Math.Max(arqueiro.PPMax, bruxo.PPMax) + Batalha.BonusDePpDaFusao;
            int iniciativa = System.Math.Max(arqueiro.Iniciativa, bruxo.Iniciativa);
            int poder = System.Math.Max(arqueiro.Poder, bruxo.Poder);
            int esquiva = Media(arqueiro.Esquiva, bruxo.Esquiva);
            int fixacao = Media(arqueiro.Fixacao, bruxo.Fixacao);
            int fogo = Media(arqueiro.Resistencias.Fogo, bruxo.Resistencias.Fogo);
            string nome = arqueiro.Nome + " + " + bruxo.Nome;
            int paAntes = arqueiro.PA;

            var declaracao = b.DeclararFusao("h1", "h2");
            Assert.IsTrue(declaracao.Valido, declaracao.Recusa);
            Assert.AreEqual(paAntes - Batalha.CustoDePaDaFusao, arqueiro.PA,
                "declarar custa " + Batalha.CustoDePaDaFusao + " PA do anfitrião");
            Assert.IsTrue(declaracao.Tem(TipoDeEvento.FusaoDeclarada));
            Assert.IsNotNull(b.FusaoPendente);
            Assert.IsFalse(arqueiro.EFusao, "declarar NÃO funde: a fusão resolve no fim do turno");

            var fim = b.EncerrarTurno();
            Assert.IsTrue(fim.Tem(TipoDeEvento.Fusao), fim.ToString());
            Assert.IsNull(b.FusaoPendente);

            var fundida = b.Acha("h1");
            Assert.IsTrue(fundida.EFusao);
            Assert.AreSame(arqueiro, fundida, "a fundida É a unidade anfitriã, mutada");
            Assert.AreEqual(casa, fundida.Casa, "a casa é a do anfitrião");
            Assert.AreEqual(indice, IndiceNaOrdem(b, "h1"),
                "o lugar na fila de iniciativa não muda — reordenar daria turno duplo");

            Assert.AreEqual(nome, fundida.Nome);
            Assert.AreEqual(pvMax, fundida.PVMax, "vida: SOMA das duas");
            Assert.AreEqual(pv, fundida.PV);
            Assert.AreEqual(paMax, fundida.PAMax, "PA: o melhor corpo, +4 (fusion.js, não os +2 do contrato)");
            Assert.AreEqual(ppMax, fundida.PPMax);
            Assert.AreEqual(iniciativa, fundida.Iniciativa);
            Assert.AreEqual(poder, fundida.Poder);
            Assert.AreEqual(esquiva, fundida.Esquiva, "esquiva: média");
            Assert.AreEqual(fixacao, fundida.Fixacao, "fixação: média");
            Assert.AreEqual(fogo, fundida.Resistencias.Fogo, "resistências: média, elemento a elemento");
            Assert.AreEqual(Batalha.EscudoDaFusao, fundida.Escudo, "o escudo de fusão nasce armado");
            Assert.IsTrue(fim.Tem(TipoDeEvento.Escudo));
            Assert.AreEqual(1, fundida.Nivel, "nível: floor((1+1)/2)");

            // O id vira o DA DUPLA, alfabético — é por ele que a Cena carrega o
            // modelo de Resources/elenco/arqueiro+bruxo/ sem código novo.
            Assert.AreEqual("arqueiro+bruxo", fundida.ClasseOuMonstroId);
            Assert.AreEqual("arqueiro+bruxo", fundida.ParDeClasses);
            Assert.AreEqual("neutro+neutro", fundida.ParDeElementos,
                "heróis de nível 1 não escolheram caminho: a mistura é a do neutro");
        }

        [Test]
        public void O_convidado_sai_sem_morte_e_sem_derrota_e_libera_a_casa()
        {
            var mapa = Cenario.Aberta(9, 3);
            var arqueiro = Cenario.Heroi("arqueiro", "h1", 1, 1);
            var bruxo = Cenario.Heroi("bruxo", "h2", 2, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 7, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, arqueiro, bruxo, vergasta);
            Cenario.AteAVezDe(b, "h1");

            b.DeclararFusao("h1", "h2");
            var fim = b.EncerrarTurno();

            Assert.IsTrue(fim.Tem(TipoDeEvento.SaiuDoTabuleiro));
            Assert.IsFalse(fim.Tem(TipoDeEvento.Morte), "sair pela fusão NÃO é morrer");
            Assert.IsFalse(fim.Tem(TipoDeEvento.FimDeBatalha));
            Assert.AreEqual(FaseDaBatalha.EmAndamento, b.Fase);

            Assert.IsTrue(bruxo.ForaDoTabuleiro);
            Assert.IsFalse(bruxo.Viva);
            Assert.AreEqual(0, bruxo.PV);
            Assert.AreEqual("h1", bruxo.FundidaEm);
            Assert.IsNull(b.EmCasa(new Vector2Int(2, 1)), "a casa do convidado fica livre");

            // A fila de iniciativa continua INTEIRA — a interface desenha os
            // caídos apagados; tirar da lista faria a fila pular.
            Assert.AreEqual(3, b.Ordem.Count);
            Assert.AreEqual(1, b.Vivas(Motor.Lado.Heroi).Count);
        }

        /// <summary>
        /// O arsenal composto entra no lugar dos dois antigos e é CONJURÁVEL: o
        /// feitiço só existe no registro da batalha (não no banco), a mira e o
        /// PA funcionam, e o dano chega no inimigo.
        /// </summary>
        [Test]
        public void A_fundida_conjura_o_arsenal_composto()
        {
            var acervo = Cenario.Acervo();
            var mapa = Cenario.Aberta(9, 3);
            var arqueiro = Cenario.Heroi("arqueiro", "h1", 1, 1);
            var bruxo = Cenario.Heroi("bruxo", "h2", 2, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 4, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, arqueiro, bruxo, vergasta);
            Cenario.AteAVezDe(b, "h1");

            b.DeclararFusao("h1", "h2");
            b.EncerrarTurno();
            var fundida = b.Acha("h1");

            // Nível 1 → só o degrau 0 do arsenal (a contagem sai do acervo).
            int esperados = 0;
            foreach (var forma in acervo.FormasDeFusao["arqueiro+bruxo"])
                if (forma.Degrau <= fundida.Nivel) esperados++;
            Assert.AreEqual(esperados, fundida.Feiticos.Count);

            var id = fundida.Feiticos[0];
            StringAssert.StartsWith("fus:arqueiro+bruxo:neutro+neutro:", id);

            // O composto vive no REGISTRO DA BATALHA, não no banco: escrever no
            // banco compartilhado quebraria a contagem do manifesto e vazaria
            // feitiço entre batalhas.
            Assert.IsNull(acervo.AchaFeitico(id), "o banco fica intacto");
            var feitico = b.Feitico(id);
            Assert.IsNotNull(feitico, "a batalha resolve o id composto");

            // O nome composto CONCORDA: forma (substantivo) + afixo (adjetivo),
            // os dois lidos do acervo.
            var forma0 = acervo.FormasDeFusao["arqueiro+bruxo"][0];
            var mistura = acervo.MisturasDeFusao["neutro+neutro"];
            Assert.AreEqual(forma0.NomeDaForma + " " + mistura.Afixo, feitico.Nome);

            // E conjura de verdade, na vez dela.
            Cenario.AteAVezDe(b, "h1");
            Assert.AreEqual(fundida.PAMax, fundida.PA, "o turno da fundida nasce cheio");
            Assert.IsTrue(b.PodeConjurar(id, vergasta.Casa), "a Vergasta está no alcance");

            int pvAntes = vergasta.PV;
            var r = b.Conjurar(id, vergasta.Casa);
            Assert.IsTrue(r.Valido, r.Recusa);
            Assert.Less(vergasta.PV, pvAntes, "o feitiço composto machuca");
            Assert.AreEqual(fundida.PAMax - feitico.CustoDePa, fundida.PA);
        }

        /// <summary>
        /// O degrau vem do NÍVEL da fusão — dois heróis de nível 30 fundem com
        /// o arsenal inteiro, e a mistura é a dos elementos que eles escolheram,
        /// NA ORDEM do anfitrião. Aqui o anfitrião é o BRUXO: a chave de classes
        /// sai alfabética mesmo assim (a aparência é uma só), mas a de elementos
        /// preserva quem declarou.
        /// </summary>
        [Test]
        public void O_nivel_da_fusao_abre_a_escada_e_a_ordem_dos_elementos_e_a_dos_fundidos()
        {
            var acervo = Cenario.Acervo();
            var mapa = Cenario.Aberta(9, 3);
            var arqueiro = Motor.Unidade.DeClasse(acervo.Classes["arqueiro"], "h1",
                new Vector2Int(1, 1), Dados.Elemento.Fogo, null, 30);
            var bruxo = Motor.Unidade.DeClasse(acervo.Classes["bruxo"], "h2",
                new Vector2Int(2, 1), Dados.Elemento.Agua, null, 30);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 7, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, arqueiro, bruxo, vergasta);
            Cenario.AteAVezDe(b, "h2");

            b.DeclararFusao("h2", "h1");   // o bruxo declara
            b.EncerrarTurno();

            var fundida = b.Acha("h2");
            Assert.IsTrue(fundida.EFusao, "a fundida é o BRUXO, que declarou");
            Assert.AreEqual(30, fundida.Nivel, "floor((30+30)/2)");
            Assert.AreEqual("arqueiro+bruxo", fundida.ClasseOuMonstroId,
                "a chave de classes é ALFABÉTICA, independa de quem declarou");
            Assert.AreEqual("agua+fogo", fundida.ParDeElementos,
                "a de elementos preserva a ordem (anfitrião, convidado)");
            Assert.AreEqual(Dados.Elemento.Agua, fundida.Elemento);
            Assert.IsTrue(fundida.TemElemento(Dados.Elemento.Fogo),
                "a fundida É dos dois elementos — clima e poder elemental valem para ambos");

            Assert.AreEqual(acervo.FormasDeFusao["arqueiro+bruxo"].Count, fundida.Feiticos.Count,
                "nível 30 abre a escada inteira");
            foreach (var id in fundida.Feiticos)
                StringAssert.StartsWith("fus:arqueiro+bruxo:agua+fogo:", id);
        }

        [Test]
        public void Declarar_exige_adjacencia_pa_e_uma_fusao_por_vez()
        {
            var mapa = Cenario.Aberta(9, 4);
            var arqueiro = Cenario.Heroi("arqueiro", "h1", 1, 1);
            var bruxo = Cenario.Heroi("bruxo", "h2", 2, 1);
            var curandeira = Cenario.Heroi("curandeira", "h3", 1, 2);
            var espadachim = Cenario.Heroi("espadachim", "h4", 5, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 7, 2);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo,
                                   arqueiro, bruxo, curandeira, espadachim, vergasta);
            Cenario.AteAVezDe(b, "h1");

            Assert.IsFalse(b.DeclararFusao("h1", "h4").Valido, "longe demais");
            Assert.IsFalse(b.DeclararFusao("h1", "h1").Valido, "ninguém funde consigo");
            Assert.IsFalse(b.DeclararFusao("h1", "m1").Valido, "só aliados se fundem");

            // Os candidatos são exatamente os aliados COLADOS.
            var candidatos = b.CandidatosAFusao("h1");
            Assert.AreEqual(2, candidatos.Count);
            CollectionAssert.Contains(candidatos, "h2");
            CollectionAssert.Contains(candidatos, "h3");

            int pa = arqueiro.PA;
            arqueiro.PA = Batalha.CustoDePaDaFusao - 1;
            Assert.IsFalse(b.DeclararFusao("h1", "h2").Valido, "sem PA não há declaração");
            Assert.IsNull(b.FusaoPendente);
            arqueiro.PA = pa;

            Assert.IsTrue(b.DeclararFusao("h1", "h2").Valido);
            Assert.IsFalse(b.DeclararFusao("h1", "h3").Valido,
                "uma fusão declarada por vez na sala inteira");
            Assert.AreEqual(0, b.CandidatosAFusao("h3").Count,
                "a pendência trava os candidatos de todo mundo");
        }

        [Test]
        public void A_fusao_falha_se_os_dois_se_afastam_e_o_pa_nao_volta()
        {
            var mapa = Cenario.Aberta(9, 4);
            var arqueiro = Cenario.Heroi("arqueiro", "h1", 1, 1);
            var bruxo = Cenario.Heroi("bruxo", "h2", 2, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 7, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, arqueiro, bruxo, vergasta);
            Cenario.AteAVezDe(b, "h1");

            b.DeclararFusao("h1", "h2");
            int paDepoisDeDeclarar = arqueiro.PA;

            // O anfitrião muda de ideia com os pés: 2 casas para longe.
            var passo = b.Andar(new Vector2Int(1, 3));
            Assert.IsTrue(passo.Valido, passo.Recusa);

            var fim = b.EncerrarTurno();
            Assert.IsTrue(fim.Tem(TipoDeEvento.FusaoFalhou));
            Assert.AreEqual("afastamento", fim.Do(TipoDeEvento.FusaoFalhou)[0].Detalhe);
            Assert.IsFalse(fim.Tem(TipoDeEvento.Fusao));

            Assert.IsFalse(arqueiro.EFusao);
            Assert.IsTrue(bruxo.NoTabuleiro, "ninguém saiu do tabuleiro");
            Assert.IsNull(b.FusaoPendente);
            Assert.AreEqual(paDepoisDeDeclarar, arqueiro.PA,
                "a preparação foi gasta: falhar não devolve os 2 PA (fusion.js)");
        }

        [Test]
        public void A_fusao_falha_se_o_convidado_cai_antes_do_fim_do_turno()
        {
            var mapa = Cenario.Aberta(9, 3);
            var arqueiro = Cenario.Heroi("arqueiro", "h1", 1, 1);
            var bruxo = Cenario.Heroi("bruxo", "h2", 2, 1);
            var curandeira = Cenario.Heroi("curandeira", "h3", 1, 2);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 7, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, arqueiro, bruxo, curandeira, vergasta);
            Cenario.AteAVezDe(b, "h1");

            b.DeclararFusao("h1", "h2");
            // O convidado some por OUTRA porta antes do fim do turno — a mesma
            // pela qual a fusão o tiraria.
            b.SairDoTabuleiro(bruxo);

            var fim = b.EncerrarTurno();
            Assert.IsTrue(fim.Tem(TipoDeEvento.FusaoFalhou));
            Assert.AreEqual("morte", fim.Do(TipoDeEvento.FusaoFalhou)[0].Detalhe);
            Assert.IsFalse(arqueiro.EFusao);
        }

        [Test]
        public void Cancelar_consome_a_intencao_sem_devolver_o_pa()
        {
            var mapa = Cenario.Aberta(9, 3);
            var arqueiro = Cenario.Heroi("arqueiro", "h1", 1, 1);
            var bruxo = Cenario.Heroi("bruxo", "h2", 2, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 7, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, arqueiro, bruxo, vergasta);
            Cenario.AteAVezDe(b, "h1");

            Assert.IsFalse(b.CancelarFusao().Valido, "não há o que cancelar ainda");

            int paAntes = arqueiro.PA;
            b.DeclararFusao("h1", "h2");
            var r = b.CancelarFusao();
            Assert.IsTrue(r.Valido);
            Assert.AreEqual("cancelada", r.Do(TipoDeEvento.FusaoFalhou)[0].Detalhe);
            Assert.IsNull(b.FusaoPendente);
            Assert.AreEqual(paAntes - Batalha.CustoDePaDaFusao, arqueiro.PA,
                "cancelar não reembolsa: o Fusion.cancel do JS também não");

            var fim = b.EncerrarTurno();
            Assert.IsFalse(fim.Tem(TipoDeEvento.Fusao), "cancelada, nada resolve");
            Assert.IsFalse(arqueiro.EFusao);
        }

        /// <summary>
        /// Matar a fundida É derrota se não sobrar herói — e NÃO HÁ CAMINHO DE
        /// VOLTA: o <c>fusion.js</c> não desfaz fusão em circunstância nenhuma
        /// (o <c>split</c> de lá, apesar do nome, só apaga as origens), e este
        /// teste prova o mesmo daqui: a morte da fundida não devolve ninguém, e
        /// a batalha inteira tem UMA morte.
        /// </summary>
        [Test]
        public void Matar_a_fundida_e_derrota_e_ninguem_volta()
        {
            var mapa = Cenario.Aberta(9, 3);
            var arqueiro = Cenario.Heroi("arqueiro", "h1", 1, 1);
            var bruxo = Cenario.Heroi("bruxo", "h2", 2, 1);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 4, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, arqueiro, bruxo, vergasta);
            Cenario.AteAVezDe(b, "h1");

            b.DeclararFusao("h1", "h2");
            var diario = new List<Evento>(b.EncerrarTurno().Eventos);
            var fundida = b.Acha("h1");
            Assert.IsTrue(fundida.EFusao);

            // PV de entrada é estado de batalha: a fundida chega ao teste quase
            // caída, para a morte caber em poucos golpes de Farpa em vez de em
            // vinte turnos de laço (o escudo de 50 ainda tem de ser comido).
            fundida.PV = 20;

            int voltas = 0;
            while (b.Fase == FaseDaBatalha.EmAndamento && voltas++ < 60)
            {
                if (b.Atual == vergasta && b.PodeConjurar("m-thorn-shot", fundida.Casa))
                    diario.AddRange(b.Conjurar("m-thorn-shot", fundida.Casa).Eventos);
                else
                    diario.AddRange(b.EncerrarTurno().Eventos);
            }

            Assert.AreEqual(FaseDaBatalha.Derrota, b.Fase,
                "sem a fundida não sobra herói: a fusão que cai É a derrota");

            // Ninguém volta: nem o anfitrião (morto de vez), nem o convidado.
            Assert.IsFalse(fundida.Viva);
            Assert.IsFalse(bruxo.Viva);
            Assert.IsTrue(bruxo.ForaDoTabuleiro);

            int mortes = 0, desfeitas = 0;
            foreach (var e in diario)
            {
                if (e.Tipo == TipoDeEvento.Morte) mortes++;
                if (e.Tipo == TipoDeEvento.FusaoDesfeita) desfeitas++;
            }
            Assert.AreEqual(1, mortes,
                "a batalha inteira tem UMA morte — a da fundida; o convidado nunca morre");
            Assert.AreEqual(1, desfeitas, "e a fusão anuncia o próprio fim");

            Assert.IsFalse(b.CancelarFusao().Valido,
                "não há intenção pendente para cancelar: fusão resolvida não tem volta");
        }

        [Test]
        public void Fusao_nao_funde_de_novo()
        {
            var mapa = Cenario.Aberta(9, 4);
            var arqueiro = Cenario.Heroi("arqueiro", "h1", 1, 1);
            var bruxo = Cenario.Heroi("bruxo", "h2", 2, 1);
            var curandeira = Cenario.Heroi("curandeira", "h3", 1, 2);
            var vergasta = Cenario.Monstro("thorn-lasher", "m1", 7, 1);
            var b = Cenario.Montar(mapa, Sorte.SempreOMaximo, arqueiro, bruxo, curandeira, vergasta);
            Cenario.AteAVezDe(b, "h1");

            b.DeclararFusao("h1", "h2");
            b.EncerrarTurno();
            Assert.IsTrue(b.Acha("h1").EFusao);

            // A curandeira continua colada no anfitrião — e mesmo assim não há
            // segunda rodada: fusão não se funde (isFusable do JS).
            Assert.IsFalse(b.PodeFundir("h1", "h3"));
            Assert.IsFalse(b.PodeFundir("h3", "h1"));
            Assert.IsFalse(b.DeclararFusao("h3", "h1").Valido);
        }
    }
}
