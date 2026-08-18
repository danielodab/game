using System;
using System.Globalization;
using System.Threading;
using NUnit.Framework;
using Soterra.Dados;
using Soterra.Grade;
using UnityEngine;

namespace Soterra.Testes.Dados
{
    /// <summary>
    /// Testa a LEITURA do acervo, não a tela e não o disco.
    ///
    /// Todo teste daqui alimenta o carregador com string, através da fonte
    /// injetada. É isso que faz esta suíte rodar sem cena, sem
    /// <c>Assets/Resources/</c> (que é de outro dono) e em milissegundos.
    /// A conferência contra o acervo de verdade mora em
    /// <c>ManifestoTests</c>, e lá ela é inconclusiva enquanto os JSON não
    /// existirem — nunca verde por ausência.
    /// </summary>
    public class BancoDeDadosTests
    {
        static BancoDeDados Banco(FonteDeMemoria fonte)
        {
            return BancoDeDados.Carregar(fonte);
        }

        // ================================================================
        // Classes
        // ================================================================

        [Test]
        public void Classe_le_a_ficha_inteira_do_barbaro()
        {
            var b = Banco(new FonteDeMemoria().Com("classes", Fixturas.Classes));
            var sumo = b.Classes["sumo"];

            Assert.AreEqual("Bárbaro", sumo.Nome, "o id `sumo` mostra-se como Bárbaro (SISTEMAS §3)");
            Assert.AreEqual("tanque", sumo.Papel);
            Assert.AreEqual(150, sumo.Atributos.Pv);
            Assert.AreEqual(6, sumo.Atributos.Pa);
            Assert.AreEqual(3, sumo.Atributos.Pp);
            Assert.AreEqual(5, sumo.Atributos.Esquiva);
            Assert.AreEqual(40, sumo.Atributos.Fixacao, "`lock` no acervo é a Fixação aqui");
            Assert.IsTrue(sumo.JaLiberada);
        }

        [Test]
        public void Esquiva_e_identidade_de_classe_e_nao_um_numero_igual_para_todos()
        {
            var b = Banco(new FonteDeMemoria().Com("classes", Fixturas.Classes));

            // 5 no tanque contra 30 no assassino: o tanque prende, o assassino
            // escapa. Um carregador que embaralhasse os campos passaria em tudo
            // o que é contagem e reprovaria aqui.
            Assert.AreEqual(5, b.Classes["sumo"].Atributos.Esquiva);
            Assert.AreEqual(30, b.Classes["espadachim"].Atributos.Esquiva);
        }

        [Test]
        public void Ladino_e_a_unica_classe_com_quatro_pp()
        {
            var b = Banco(new FonteDeMemoria().Com("classes", Fixturas.Classes));
            Assert.AreEqual(4, b.Classes["espadachim"].Atributos.Pp);
            Assert.AreEqual(3, b.Classes["sumo"].Atributos.Pp);
        }

        [Test]
        public void Cada_classe_tem_tres_neutros_e_quatro_caminhos_de_seis_degraus()
        {
            var b = Banco(new FonteDeMemoria().Com("classes", Fixturas.Classes));

            foreach (var classe in b.Classes.Values)
            {
                Assert.AreEqual(3, classe.FeiticosBase.Count, classe.Id + ": três neutros");
                Assert.AreEqual(4, classe.Caminhos.Count, classe.Id + ": quatro caminhos elementais");
                foreach (var caminho in classe.Caminhos)
                    Assert.AreEqual(6, caminho.Value.Count,
                        classe.Id + "/" + caminho.Key + ": os quatro caminhos abrem nos MESMOS seis degraus; " +
                        "caminho curto deixaria buraco na árvore de feitiços");
            }
        }

        // ================================================================
        // Feitiços
        // ================================================================

        [Test]
        public void Feitico_le_alcance_area_e_efeitos()
        {
            var b = Banco(new FonteDeMemoria().Com("spells", Fixturas.Feiticos));
            var f = b.Feiticos["sumo-neutro-1"];

            Assert.AreEqual(3, f.CustoDePa);
            Assert.AreEqual(2, f.LancamentosPorTurno);
            Assert.AreEqual(1, f.Alcance.Min);
            Assert.AreEqual(1, f.Alcance.Max);
            Assert.IsFalse(f.Alcance.Linha);
            Assert.IsTrue(f.Alcance.Visao);
            Assert.AreEqual(Forma.Single, f.Area.Forma);
            Assert.AreEqual(Lado.Enemy, f.Alvo);

            Assert.AreEqual(2, f.Efeitos.Count);
            Assert.AreEqual("damage", f.Efeitos[0].Tipo);
            Assert.AreEqual(20, f.Efeitos[0].Min);
            Assert.AreEqual(26, f.Efeitos[0].Max);
            Assert.AreEqual("push", f.Efeitos[1].Tipo);
            Assert.AreEqual(1, f.Efeitos[1].Casas);
        }

        [Test]
        public void Carga_de_armadilha_nunca_e_conjurada_a_mao()
        {
            var b = Banco(new FonteDeMemoria().Com("spells", Fixturas.Feiticos));
            var carga = b.Feiticos["trap-fogo-brasa"];

            // paCost 0 E castsPerTurn 0: é o par que a barra de feitiços usa
            // para não mostrar a carga. Ler só um dos dois deixaria as nove
            // cargas do Xamã aparecerem como feitiços grátis.
            Assert.AreEqual(0, carga.CustoDePa);
            Assert.AreEqual(0, carga.LancamentosPorTurno);
            Assert.AreEqual(Forma.Circle, carga.Area.Forma);
            Assert.AreEqual(1, carga.Area.Tamanho);
        }

        [Test]
        public void Em_uma_marca_o_campo_max_e_teto_de_pilhas_e_nao_dano()
        {
            var b = Banco(new FonteDeMemoria().Com("spells", Fixturas.Feiticos));
            var flecha = b.Feiticos["arqueiro-neutro-1"];

            var dano = flecha.Efeitos[0];
            var marca = flecha.Efeitos[1];

            Assert.AreEqual("damage", dano.Tipo);
            Assert.AreEqual(24, dano.Max, "aqui `max` é o teto do dano");

            Assert.AreEqual("mark", marca.Tipo);
            Assert.AreEqual(5, marca.Valor, "5% por pilha");
            Assert.AreEqual(5, marca.Max, "e aqui o MESMO campo é o teto de pilhas");
            Assert.IsNull(marca.Min, "marca não tem piso de faixa nenhum");
        }

        [Test]
        public void As_seis_formas_de_area_viram_o_enum_da_grade()
        {
            var b = Banco(new FonteDeMemoria().Com("spells", Fixturas.FeiticosDeTodasAsFormas));

            Assert.AreEqual(Forma.Single, b.Feiticos["f-single"].Area.Forma);
            Assert.AreEqual(Forma.Circle, b.Feiticos["f-circle"].Area.Forma);
            Assert.AreEqual(Forma.Cross, b.Feiticos["f-cross"].Area.Forma);
            Assert.AreEqual(Forma.Cone, b.Feiticos["f-cone"].Area.Forma);
            Assert.AreEqual(Forma.Line, b.Feiticos["f-line"].Area.Forma);
            Assert.AreEqual(Forma.Ring, b.Feiticos["f-ring"].Area.Forma);
        }

        [Test]
        public void Os_quatro_lados_de_alvo_viram_o_enum()
        {
            var b = Banco(new FonteDeMemoria().Com("spells", Fixturas.FeiticosDeTodasAsFormas));

            Assert.AreEqual(Lado.Enemy, b.Feiticos["f-single"].Alvo);
            Assert.AreEqual(Lado.Ally, b.Feiticos["f-circle"].Alvo);
            Assert.AreEqual(Lado.Self, b.Feiticos["f-cross"].Alvo);
            Assert.AreEqual(Lado.Any, b.Feiticos["f-cone"].Alvo);
        }

        [Test]
        public void Feitico_de_area_mira_o_chao_e_o_de_alvo_unico_nao()
        {
            var b = Banco(new FonteDeMemoria().Com("spells", Fixturas.FeiticosDeTodasAsFormas));

            // A regra de SISTEMAS §2: com forma diferente de `single` e tamanho
            // maior que zero, a casa alvo é um LUGAR. Foi o que permitiu largar
            // a explosão ENTRE dois inimigos.
            Assert.IsTrue(b.Feiticos["f-single"].Area.ApenasAlvoUnico);
            Assert.IsFalse(b.Feiticos["f-circle"].Area.ApenasAlvoUnico);
            Assert.IsFalse(b.Feiticos["f-ring"].Area.ApenasAlvoUnico);
        }

        [Test]
        public void Feitico_e_procurado_nas_cinco_tabelas_sem_mesclar()
        {
            var fonte = new FonteDeMemoria()
                .Com("spells", Fixturas.Feiticos)
                .Com("itemSpells", Fixturas.FeiticosDeTodasAsFormas);
            var b = Banco(fonte);

            Assert.IsNotNull(b.AchaFeitico("sumo-neutro-1"), "tabela das classes");
            Assert.IsNotNull(b.AchaFeitico("f-ring"), "tabela dos itens");
            Assert.IsNull(b.AchaFeitico("nao-existe"));

            // Sem mesclar: as duas tabelas continuam separadas, e um id de item
            // não pode apagar um id de classe em silêncio.
            Assert.AreEqual(4, b.Feiticos.Count);
            Assert.AreEqual(6, b.FeiticosDeItem.Count);
        }

        // ================================================================
        // Calabouços e a ponte com a grade
        // ================================================================

        [Test]
        public void Calabouco_e_lista_no_topo_e_nao_objeto_indexado()
        {
            var b = Banco(new FonteDeMemoria().Com("dungeons", Fixturas.Calabocos));

            Assert.AreEqual(1, b.Calabocos.Count);
            Assert.AreEqual("greenhouse", b.Calabocos[0].Id);
            Assert.AreEqual("A Estufa Soterrada", b.Calabocos[0].Nome);
            Assert.AreEqual("garden", b.Calabocos[0].Tema, "o tema NÃO é o id: 4 dos 6 calabouços diferem");
            Assert.AreEqual(0.15, b.Calabocos[0].TaxaDeEventos, 1e-9);
            Assert.IsNotNull(b.AchaCalabouco("greenhouse"));
        }

        [Test]
        public void A_ultima_sala_e_a_do_chefe()
        {
            var b = Banco(new FonteDeMemoria().Com("dungeons", Fixturas.Calabocos));
            var chefe = b.Calabocos[0].SalaDoChefe;

            Assert.AreEqual("O Coreto da Viúva", chefe.Nome);
            Assert.IsTrue(chefe.Monstros.ContainsKey("z"), "a letra do chefe é `z`");
            Assert.AreEqual("boss-gardener", chefe.Monstros["z"]);
        }

        [Test]
        public void Sala_vira_mapa_da_grade_com_alto_e_baixo_distintos()
        {
            var b = Banco(new FonteDeMemoria().Com("dungeons", Fixturas.Calabocos));
            var mapa = b.Calabocos[0].Salas[0].ParaMapa();

            Assert.AreEqual(21, mapa.Largura);
            Assert.AreEqual(17, mapa.Altura);

            // A linha 0 do desenho é o Y mais ALTO. A moldura de cima é '#'
            // (alto) e a terceira linha traz '=' (baixo) na mesma coluna: os
            // dois bloqueiam passagem, só o alto corta a visão. É essa
            // diferença que faz cobertura existir.
            var alto = new Vector2Int(5, 16);
            var baixo = new Vector2Int(5, 14);

            Assert.AreEqual(Casa.ObstaculoAlto, mapa.Em(alto));
            Assert.AreEqual(Casa.ObstaculoBaixo, mapa.Em(baixo));
            Assert.IsTrue(mapa.BloqueiaVisao(alto));
            Assert.IsFalse(mapa.BloqueiaVisao(baixo), "o obstáculo baixo é cobertura, não parede cega");
            Assert.IsFalse(mapa.Andavel(alto));
            Assert.IsFalse(mapa.Andavel(baixo));
        }

        [Test]
        public void Toda_letra_desenhada_na_sala_tem_monstro_declarado()
        {
            var b = Banco(new FonteDeMemoria().Com("dungeons", Fixturas.Calabocos));

            // Letra no chão sem entrada no dicionário é sala com nascimento
            // vazio: o grupo simplesmente não aparece, e a sala fica fácil sem
            // ninguém perceber.
            foreach (var sala in b.Calabocos[0].Salas)
            {
                var mapa = sala.ParaMapa();
                foreach (var nascimento in mapa.NascimentoMonstros)
                {
                    string letra = nascimento.Key.ToString();
                    Assert.IsTrue(sala.Monstros.ContainsKey(letra),
                        sala.Nome + ": a letra '" + letra + "' está desenhada mas não tem monstro declarado");
                }
            }
        }

        [Test]
        public void O_heroi_nasce_numa_casa_marcada_com_P()
        {
            var b = Banco(new FonteDeMemoria().Com("dungeons", Fixturas.Calabocos));
            var sala = b.Calabocos[0].Salas[0];
            var mapa = sala.ParaMapa();
            var p = mapa.NascimentoHeroi;

            // O desenho tem a linha 0 em cima; o mapa põe o Y crescendo para
            // cima. Errar essa inversão espelha a sala inteira e todo teste
            // escrito a olho passaria a mentir.
            int linha = mapa.Altura - 1 - p.y;
            Assert.AreEqual('P', sala.Desenho[linha][p.x]);
            Assert.IsTrue(mapa.Andavel(p), "nascimento é chão, não um tipo de piso especial");
        }

        // ================================================================
        // Itens
        // ================================================================

        [Test]
        public void Resistencia_nao_escrita_vale_zero_e_nao_falta_de_dado()
        {
            var b = Banco(new FonteDeMemoria().Com("items", Fixturas.Itens));
            var guarda = b.Itens["gh-trellis-guard"];

            Assert.AreEqual(15, guarda.Bonus.Pv);
            Assert.AreEqual(5, guarda.Bonus.Resistencias.Terra);
            Assert.AreEqual(0, guarda.Bonus.Resistencias.Fogo, "o acervo só escreve o que muda");
            Assert.AreEqual(0, guarda.Bonus.Pa);
            Assert.AreEqual(0, guarda.Bonus.Pp);
            Assert.AreEqual(5, guarda.Bonus.Resistencias.De("terra"), "e a busca por nome concorda");
        }

        [Test]
        public void Peca_chave_e_a_que_muda_como_se_joga()
        {
            var b = Banco(new FonteDeMemoria().Com("items", Fixturas.Itens));

            // +1 PP e Lume são peças-chave; a casca comum não é. É o campo que
            // faz elas pesarem metade no saque.
            Assert.IsTrue(b.Itens["gh-vine-stirrups"].PecaChave, "+1 PP");
            Assert.IsTrue(b.Itens["gh-seed-pouch"].PecaChave, "Lume");
            Assert.IsFalse(b.Itens["gh-trellis-guard"].PecaChave);

            Assert.AreEqual("is-seed-bomb", b.Itens["gh-seed-pouch"].ConcedeFeitico,
                "só o Lume concede feitiço");
            Assert.IsNull(b.Itens["gh-trellis-guard"].ConcedeFeitico);
        }

        [Test]
        public void Conjunto_indexa_o_bonus_pelo_numero_de_pecas_vestidas()
        {
            var b = Banco(new FonteDeMemoria().Com("sets", Fixturas.Conjuntos));
            var flora = b.Conjuntos["gh-set-flora"];

            // A chave numérica em JSON só existe como TEXTO. Se a conversão de
            // volta falhar, o dicionário fica vazio e nenhum conjunto do jogo
            // dá bônus nenhum — calado.
            Assert.AreEqual(3, flora.Bonus.Count);
            Assert.AreEqual(12, flora.Bonus[2].Pv);
            Assert.AreEqual(8, flora.Bonus[3].Fixacao);
            Assert.AreEqual(10, flora.Bonus[4].Resistencias.Terra);
            Assert.AreEqual(4, flora.Pecas.Count, "quatro peças, uma por espaço");
        }

        [Test]
        public void A_forja_nunca_escala_pa_nem_pp()
        {
            var b = Banco(new FonteDeMemoria().Com("upgrade", Fixturas.Forja));

            Assert.AreEqual(10, b.Forja.NivelMaximo);
            Assert.AreEqual(0.12, b.Forja.BonusPorNivel, 1e-9);
            Assert.AreEqual(10, b.Forja.CustoEmPedras.Count, "um custo por degrau, do +0 ao +10");
            Assert.Contains("pa", (System.Collections.ICollection)b.Forja.AtributosQueNaoEscalam);
            Assert.Contains("pp", (System.Collections.ICollection)b.Forja.AtributosQueNaoEscalam);
        }

        // ================================================================
        // Elementos, climas e progressão
        // ================================================================

        [Test]
        public void O_neutro_nao_tem_rival()
        {
            var fonte = new FonteDeMemoria()
                .Com("elements", Fixturas.Elementos)
                .Com("rivals", Fixturas.Rivais);
            var b = Banco(fonte);

            Assert.AreEqual(5, b.Elementos.Count);
            Assert.AreEqual("agua", b.Rivais["fogo"]);
            Assert.AreEqual("ar", b.Rivais["terra"]);
            Assert.IsNull(b.Rivais["neutro"], "nenhum clima ajuda ou fere o neutro");
        }

        [Test]
        public void O_clima_calmo_nao_favorece_nem_prejudica_ninguem()
        {
            var b = Banco(new FonteDeMemoria().Com("weathers", Fixturas.Climas));

            Assert.IsNull(b.Climas["calmo"].Favorece);
            Assert.IsNull(b.Climas["calmo"].Prejudica);
            Assert.AreEqual("agua", b.Climas["chuva"].Favorece);
            Assert.AreEqual("fogo", b.Climas["chuva"].Prejudica,
                "o prejudicado é sempre o RIVAL do favorecido");
        }

        [Test]
        public void O_evento_surpresa_e_o_unico_que_sorteia_desfecho()
        {
            var b = Banco(new FonteDeMemoria().Com("tileEvents", Fixturas.EventosDeTerreno));

            var bravura = b.EventosDeTerreno["ev-might"];
            Assert.AreEqual(1, bravura.Efeitos.Count);
            Assert.AreEqual(0, bravura.Desfechos.Count);

            // Um leitor que só olhasse `Efeitos` faria a surpresa não fazer
            // nada, e ela é o evento de maior peso do jogo.
            var surpresa = b.EventosDeTerreno["ev-mystery"];
            Assert.AreEqual(0, surpresa.Efeitos.Count);
            Assert.AreEqual(2, surpresa.Desfechos.Count);
            Assert.AreEqual("heal", surpresa.Desfechos[0].Efeitos[0].Tipo);
        }

        [Test]
        public void A_tabela_de_xp_e_acumulada_e_comeca_em_zero()
        {
            var b = Banco(new FonteDeMemoria().Com("leveling", Fixturas.Nivelamento));

            Assert.AreEqual(30, b.Nivelamento.NivelMaximo);
            Assert.AreEqual(30, b.Nivelamento.TabelaDeXp.Count, "um degrau por nível, do 1 ao 30");
            Assert.AreEqual(0, b.Nivelamento.TabelaDeXp[0], "o índice 0 é o nível 1, e custa zero");
            Assert.AreEqual(28180, b.Nivelamento.TabelaDeXp[29], "o índice 29 é o nível 30");
            Assert.AreEqual(5, b.Nivelamento.NivelDaEscolhaDeElemento);
            Assert.AreEqual(70, b.Nivelamento.DefesaPorPapel["tanque"].Fixacao);
            Assert.AreEqual(40, b.Nivelamento.DefesaPorPapel["assassino"].Esquiva);
        }

        [Test]
        public void As_estrelas_de_classe_vao_ate_cinco_e_so_duas_dao_acao()
        {
            var b = Banco(new FonteDeMemoria().Com("stars", Fixturas.Estrelas));

            Assert.AreEqual(5, b.Estrelas.Maximo);
            Assert.AreEqual(5, b.Estrelas.Bonus.Count);
            Assert.AreEqual(1, b.Estrelas.Bonus[3].Pp, "★3 é o degrau de +1 PP");
            Assert.AreEqual(1, b.Estrelas.Bonus[5].Pa, "★5 é o degrau de +1 PA");
            Assert.AreEqual(0, b.Estrelas.Bonus[1].Pa, "os outros três não mexem em ação nenhuma");
        }

        // ================================================================
        // Comportamento do carregador
        // ================================================================

        [Test]
        public void Decimal_nao_depende_da_cultura_da_maquina()
        {
            // O defeito: numa máquina pt-BR, `float.Parse("0.25")` devolve 25 —
            // a queda por salto da corrente viraria um multiplicador de 25×.
            // O Newtonsoft lê número sempre em cultura invariante; este teste
            // troca a cultura da linha de execução justamente para provar isso.
            var antes = Thread.CurrentThread.CurrentCulture;
            try
            {
                Thread.CurrentThread.CurrentCulture = new CultureInfo("pt-BR");

                var fonte = new FonteDeMemoria()
                    .Com("spells", Fixturas.Feiticos)
                    .Com("dungeons", Fixturas.Calabocos);
                var b = Banco(fonte);

                var cadeia = b.Feiticos["arqueiro-ar-15"].Efeitos[1];
                Assert.AreEqual("chain", cadeia.Tipo);
                Assert.AreEqual(0.25, cadeia.Queda.Value, 1e-9);
                Assert.AreEqual(0.15, b.Calabocos[0].TaxaDeEventos, 1e-9);
            }
            finally
            {
                Thread.CurrentThread.CurrentCulture = antes;
            }
        }

        [Test]
        public void Chave_ausente_nao_derruba_a_carga_mas_fica_registrada()
        {
            // O acervo chega em pedaços enquanto está sendo exportado. Parar na
            // primeira ausência impediria qualquer trabalho; o que não pode é
            // a ausência passar despercebida.
            var b = Banco(new FonteDeMemoria().Com("classes", Fixturas.Classes));

            Assert.AreEqual(2, b.Classes.Count);
            Assert.AreEqual(0, b.Feiticos.Count);
            Assert.Contains("spells", (System.Collections.ICollection)b.ChavesAusentes);
            Assert.IsFalse(b.ChavesAusentes.Contains("classes"));
        }

        [Test]
        public void Json_quebrado_diz_qual_das_chaves_quebrou()
        {
            // Sem o nome da chave, a mensagem do Newtonsoft é "Unexpected
            // character at line 1" e não diz qual dos vinte e cinco arquivos
            // veio pela metade.
            var fonte = new FonteDeMemoria().Com("classes", "{ \"sumo\": ");
            var erro = Assert.Throws<FormatException>(() => BancoDeDados.Carregar(fonte));
            StringAssert.Contains("classes", erro.Message);
        }

        [Test]
        public void Carregar_sem_fonte_e_erro_de_programacao_e_nao_acervo_vazio()
        {
            Assert.Throws<ArgumentNullException>(() => BancoDeDados.Carregar(null));
        }

        [Test]
        public void Um_delegate_serve_de_fonte_igual_a_interface()
        {
            var b = BancoDeDados.Carregar(new FonteDeFuncao(
                chave => chave == "classes" ? Fixturas.Classes : null));

            Assert.AreEqual(2, b.Classes.Count);
            Assert.Contains("spells", (System.Collections.ICollection)b.ChavesAusentes);
        }

        // ================================================================
        // Conferência contra o manifesto
        // ================================================================

        [Test]
        public void Manifesto_confere_e_aprova_o_acervo_integro()
        {
            var fonte = new FonteDeMemoria()
                .Com("_manifesto", @"{ ""gerado"": ""2026-08-18T21:00:00Z"", ""fonte"": ""v2.html"",
                                       ""chaves"": { ""classes"": 2, ""spells"": 4 } }")
                .Com("classes", Fixturas.Classes)
                .Com("spells", Fixturas.Feiticos);

            var b = Banco(fonte);
            Assert.AreEqual("v2.html", b.Manifesto.Fonte);
            CollectionAssert.IsEmpty(b.ConfereContraManifesto());
        }

        [Test]
        public void Manifesto_acusa_arquivo_que_veio_pela_metade()
        {
            // É o defeito que o manifesto existe para pegar: o arquivo é JSON
            // válido, carrega sem uma linha de erro, e traz 2 feitiços onde
            // deveria haver 171. Sem esta conferência, o jogo só estranharia
            // horas depois, na árvore de feitiços de alguma classe.
            var fonte = new FonteDeMemoria()
                .Com("_manifesto", @"{ ""chaves"": { ""spells"": 171 } }")
                .Com("spells", Fixturas.Feiticos);

            var problemas = Banco(fonte).ConfereContraManifesto();

            Assert.AreEqual(1, problemas.Count);
            StringAssert.Contains("spells", problemas[0]);
            StringAssert.Contains("171", problemas[0]);
            StringAssert.Contains("4", problemas[0]);
        }

        [Test]
        public void Manifesto_acusa_chave_declarada_sem_arquivo()
        {
            var fonte = new FonteDeMemoria()
                .Com("_manifesto", @"{ ""chaves"": { ""dungeons"": 6 } }");

            var problemas = Banco(fonte).ConfereContraManifesto();

            Assert.AreEqual(1, problemas.Count);
            StringAssert.Contains("dungeons", problemas[0]);
            StringAssert.Contains("não existe", problemas[0]);
        }

        [Test]
        public void Chave_modelada_que_o_manifesto_esquece_tambem_e_acusada()
        {
            // A conferência normal só percorre o que o manifesto LISTA, então
            // uma chave que o exportador esqueceu de escrever passaria calada —
            // e é exatamente o caso em que a coleção fica vazia no jogo.
            var fonte = new FonteDeMemoria()
                .Com("_manifesto", @"{ ""chaves"": { ""classes"": 2 } }")
                .Com("classes", Fixturas.Classes);

            var b = Banco(fonte);

            CollectionAssert.IsEmpty(b.ConfereContraManifesto(), "o que está declarado bate");

            var fora = b.ChavesModeladasForaDoManifesto();
            Assert.Contains("spells", (System.Collections.ICollection)fora);
            Assert.Contains("dungeons", (System.Collections.ICollection)fora);
            Assert.IsFalse(fora.Contains("classes"));
        }

        [Test]
        public void Manifesto_confere_ate_chave_que_esta_rodada_nao_modelou()
        {
            // `fusionForms` não tem classe C# nenhuma nesta rodada, e mesmo
            // assim a contagem tem de ser conferida — senão a chave não
            // modelada é exatamente a que ninguém protege.
            var fonte = new FonteDeMemoria()
                .Com("_manifesto", @"{ ""chaves"": { ""fusionForms"": 15 } }")
                .Com("fusionForms", @"{ ""arqueiro+bruxo"": [], ""arqueiro+sumo"": [] }");

            var problemas = Banco(fonte).ConfereContraManifesto();

            Assert.AreEqual(1, problemas.Count);
            StringAssert.Contains("fusionForms", problemas[0]);
        }
    }
}
