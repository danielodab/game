using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using Soterra.Cena;
using Soterra.Grade;

namespace Soterra.Testes.Cena
{
    /// <summary>
    /// O elenco em cima do tabuleiro.
    ///
    /// EditMode inteiro, como o palco: se estes testes passam, plantar unidade
    /// funciona FORA de Play — que é a única forma de o modo lote fotografar
    /// qualquer coisa, e é onde a escala e o pivô do elenco definitivo vão ser
    /// conferidos no dia em que ele chegar.
    ///
    /// A maioria roda com uma fonte de modelos VAZIA, de propósito: aí o corpo é
    /// a cápsula, a geometria é conhecida e o teste mede o encaixe em vez de
    /// medir o acervo. Os que cobram o acervo de verdade estão no fim e dizem
    /// isso no nome.
    /// </summary>
    public class ElencoTests
    {
        // 9×7, não quadrado — troca de eixo entre X e Y passa despercebida em
        // tabuleiro quadrado, e é justamente o erro que planta a unidade na casa
        // errada.
        static readonly string[] SalaDeTeste =
        {
            "#########",
            "#.......#",
            "#..=....#",
            "#P.....a#",
            "#P..#...#",
            "#.......#",
            "#########"
        };

        GameObject _go;
        Palco _palco;
        Mapa _mapa;
        Elenco _elenco;

        [SetUp]
        public void Antes()
        {
            _go = new GameObject("palco-de-teste");
            _palco = _go.AddComponent<Palco>();
            _mapa = Mapa.DeTexto(SalaDeTeste);
            _palco.Montar(_mapa);
            // Sem acervo e sem banco: o que se mede aqui é o encaixe.
            _elenco = new Elenco(_palco, null, new ModelosDeMemoria(), new Aparencia());
        }

        [TearDown]
        public void Depois()
        {
            if (_go != null) Object.DestroyImmediate(_go);
        }

        static FichaDeUnidade Ficha(string uid, string id, bool heroi, int x, int y)
        {
            return new FichaDeUnidade
            {
                Uid = uid, Id = id, Heroi = heroi,
                Casa = new Vector2Int(x, y), Viva = true
            };
        }

        // ============================================================ PRESENÇA

        [Test]
        public void Sincronizar_ForaDePlay_UmaUnidadeEmCenaPorUnidadeDaBatalha()
        {
            Assert.IsFalse(Application.isPlaying,
                           "este teste só vale alguma coisa fora de Play — é o modo do lote");

            _elenco.Sincronizar(new[]
            {
                Ficha("h0", "sumo", true, 1, 3),
                Ficha("h1", "bruxo", true, 1, 4),
                Ficha("m0", "pollen-puff", false, 7, 3)
            });

            Assert.AreEqual(3, _elenco.NoTabuleiro.Count);
            Assert.IsNotNull(_elenco.ObjetoDe("h0"));
            Assert.IsNotNull(_elenco.ObjetoDe("h1"));
            Assert.IsNotNull(_elenco.ObjetoDe("m0"));
        }

        [Test]
        public void Sincronizar_PlantaNaCasaCerta_EOsPesFicamNoChaoDaCasa()
        {
            var casa = new Vector2Int(6, 5);
            _elenco.Sincronizar(new[] { Ficha("h0", "sumo", true, casa.x, casa.y) });

            var go = _elenco.ObjetoDe("h0");
            Assert.AreEqual(casa, _palco.Casa(go.transform.position),
                            "a unidade não caiu na casa que a ficha mandou");

            var corpo = CaixaDoCorpo("h0");
            Assert.AreEqual(_palco.TopoDe(casa), corpo.min.y, 0.02f,
                            "a unidade está afundada no chão ou flutuando: o pivô tem de ficar " +
                            "entre os pés (CONTRATO_ENTREGA_PERSONAGEM §2)");
        }

        [Test]
        public void Sincronizar_MortaSaiDoTabuleiro()
        {
            var viva = Ficha("m0", "pollen-puff", false, 7, 3);
            _elenco.Sincronizar(new[] { viva });
            Assert.IsNotNull(_elenco.ObjetoDe("m0"));

            viva.Viva = false;
            _elenco.Sincronizar(new[] { viva });
            Assert.IsNull(_elenco.ObjetoDe("m0"), "monstro morto continuou desenhado");
            Assert.AreEqual(0, _elenco.NoTabuleiro.Count);
        }

        [Test]
        public void Sincronizar_ForaDoTabuleiroTambemSai_EEhOutroCampo()
        {
            // A fusão tira o convidado SEM contar derrota: para a cena o efeito é
            // o mesmo de morrer, e é por isso que o teste existe — os dois campos
            // são distintos no motor e um leitor desatento cobriria só um.
            var ficha = Ficha("h1", "bruxo", true, 1, 4);
            _elenco.Sincronizar(new[] { ficha });

            ficha.ForaDoTabuleiro = true;
            _elenco.Sincronizar(new[] { ficha });

            Assert.IsTrue(ficha.Viva, "a fusão não mata o convidado");
            Assert.IsNull(_elenco.ObjetoDe("h1"), "unidade levada pela fusão continuou no tabuleiro");
        }

        [Test]
        public void Sincronizar_SemUid_Reclama()
        {
            Assert.Throws<System.ArgumentException>(() =>
                _elenco.Sincronizar(new[] { Ficha(null, "sumo", true, 1, 3) }),
                "ficha sem Uid viraria um objeto novo por sincronização — vazamento silencioso");
        }

        // ======================================================== REAPROVEITAR

        [Test]
        public void Sincronizar_AndarReaproveitaOMesmoObjeto()
        {
            var ficha = Ficha("h0", "sumo", true, 1, 3);
            _elenco.Sincronizar(new[] { ficha });
            var antes = _elenco.ObjetoDe("h0");

            ficha.Casa = new Vector2Int(4, 5);
            _elenco.Sincronizar(new[] { ficha });
            var depois = _elenco.ObjetoDe("h0");

            Assert.AreSame(antes, depois,
                           "andar recriou a unidade: com modelo animado, cada passo reiniciaria " +
                           "o `idle` de todo mundo e o tabuleiro daria um solavanco por clique");
            Assert.AreEqual(ficha.Casa, _palco.Casa(depois.transform.position));
        }

        [Test]
        public void Sincronizar_FusaoTrocaOCorpoSemTrocarOUid()
        {
            // O anfitrião vira outra coisa mantendo o Uid. Sem conferir o Id, a
            // unidade fundida continuaria com o corpo (e a altura) da classe
            // antiga até morrer.
            var ficha = Ficha("h0", "espadachim", true, 1, 3);
            _elenco.Sincronizar(new[] { ficha });
            float baixo = CaixaDoCorpo("h0").size.y;

            ficha.Id = "sumo";
            _elenco.Sincronizar(new[] { ficha });
            float alto = CaixaDoCorpo("h0").size.y;

            Assert.Greater(alto, baixo + 0.5f,
                           "trocar de classe não trocou o corpo: o Ladino de 1,65 m continuou " +
                           "no lugar do Bárbaro de 2,30 m");
        }

        // =============================================================== GIRO

        [Test]
        public void Unidade_GiraJuntoComOTabuleiro_ENaoFicaParadaSobreOutraCasa()
        {
            var casa = new Vector2Int(7, 3);
            _elenco.Sincronizar(new[] { Ficha("m0", "pollen-puff", false, casa.x, casa.y) });
            var go = _elenco.ObjetoDe("m0");

            for (int giro = 0; giro < 4; giro++)
            {
                _palco.Girar(1);
                Assert.AreEqual(casa, _palco.Casa(go.transform.position),
                                "depois de girar " + (giro + 1) + " quarto(s) a unidade caiu " +
                                "noutra casa: ela precisa estar pendurada no tabuleiro que gira");
            }
        }

        [Test]
        public void Remontar_OPalcoNaoDeixaUnidadeFantasma()
        {
            _elenco.Sincronizar(new[] { Ficha("h0", "sumo", true, 1, 3) });

            // Montar apaga todos os filhos da raiz, e o grupo do elenco vai
            // junto. Fora de Play o objeto destruído não é nulo de verdade, e um
            // índice desatualizado devolveria casca.
            _palco.Montar(_mapa);
            _elenco.Sincronizar(new[] { Ficha("h0", "sumo", true, 1, 3) });

            var vivos = _go.transform.Find("Tabuleiro/Elenco");
            Assert.IsNotNull(vivos);
            Assert.AreEqual(1, vivos.childCount, "sobrou unidade fantasma depois de remontar");
            Assert.IsNotNull(_elenco.ObjetoDe("h0"));
        }

        // ============================================================== ALTURA

        [Test]
        public void Altura_DasSeisClasses_EhADoContratoDeEntrega()
        {
            // Os números do CONTRATO_ENTREGA_PERSONAGEM §2, escritos à mão aqui
            // de propósito: cobrar a tabela do Elenco contra a própria tabela do
            // Elenco não provaria nada.
            var contrato = new Dictionary<string, float>
            {
                { "sumo", 2.30f }, { "curandeira", 1.95f }, { "invocador", 1.85f },
                { "arqueiro", 1.80f }, { "bruxo", 1.75f }, { "espadachim", 1.65f }
            };

            foreach (var par in contrato)
            {
                _elenco.Limpar();
                _elenco.Sincronizar(new[] { Ficha("u", par.Key, true, 4, 1) });
                Assert.AreEqual(par.Value, CaixaDoCorpo("u").size.y, 0.03f,
                                "a classe " + par.Key + " não tem a altura do contrato");
            }
        }

        [Test]
        public void Altura_AOrdemEntreAsClassesEhOQueCarregaALeituraDePapel()
        {
            // A ORDEM importa mais que os valores: é ela que faz o tanque e o
            // ladino se distinguirem antes de o jogador ler qualquer nome. Se
            // alguém um dia mexer nos números, este teste cobra que a escada
            // continue de pé.
            var daMaisAltaParaAMaisBaixa = Elenco.Classes;
            for (int i = 1; i < daMaisAltaParaAMaisBaixa.Count; i++)
                Assert.Greater(Elenco.AlturaDaClasse(daMaisAltaParaAMaisBaixa[i - 1]),
                               Elenco.AlturaDaClasse(daMaisAltaParaAMaisBaixa[i]),
                               daMaisAltaParaAMaisBaixa[i - 1] + " deixou de ser mais alto que " +
                               daMaisAltaParaAMaisBaixa[i]);
        }

        [Test]
        public void Altura_DaFichaGanhaDaTabela_EhAssimQueOChefeEntra()
        {
            var ficha = Ficha("chefe", "widow-gardener", false, 4, 1);
            ficha.Altura = Elenco.AlturaDeChefe;
            _elenco.Sincronizar(new[] { ficha });

            Assert.AreEqual(Elenco.AlturaDeChefe, CaixaDoCorpo("chefe").size.y, 0.05f,
                            "o chefe entrou com a altura de monstro comum: a tabela por id não " +
                            "conhece chefe, e é a ficha que sabe");
        }

        [Test]
        public void Altura_IdDesconhecido_ViraMonstroComum()
        {
            _elenco.Sincronizar(new[] { Ficha("x", "bicho-que-nao-existe", false, 4, 1) });
            Assert.AreEqual(Elenco.AlturaComum, CaixaDoCorpo("x").size.y, 0.03f);
        }

        [Test]
        public void Largura_NaoPassaDoTetoDoContrato_NemNaClasseMaisLarga()
        {
            // §3 do contrato de entrega: até ~2,2 células para herói e monstro
            // comum. O Paladino já estourou isso uma vez, com 3,32 células de
            // asa aberta, e apagou o tabuleiro.
            foreach (var id in Elenco.Classes)
            {
                _elenco.Limpar();
                _elenco.Sincronizar(new[] { Ficha("u", id, true, 4, 1) });
                var caixa = CaixaDoCorpo("u");
                float largura = Mathf.Max(caixa.size.x, caixa.size.z) / Palco.Passo;
                Assert.LessOrEqual(largura, Elenco.LarguraMaxima,
                                   id + " ocupa " + largura.ToString("0.00") + " células");
            }
        }

        // ========================================================= HERÓI ≠ MONSTRO

        [Test]
        public void Lado_HeroiEMonstroSeSeparamPorCor_EmDoisLugaresDoCorpo()
        {
            _elenco.Sincronizar(new[]
            {
                Ficha("h0", "sumo", true, 1, 3),
                Ficha("m0", "pollen-puff", false, 7, 3)
            });

            var selos = new[] { Cor("h0", "Selo"), Cor("m0", "Selo") };
            var marcas = new[] { Cor("h0", "Marca"), Cor("m0", "Marca") };

            // Distância de cor generosa: se herói e monstro estiverem perto no
            // espaço RGB, a foto pequena de um celular junta os dois.
            Assert.Greater(Distancia(selos[0], selos[1]), 0.5f,
                           "o selo de aliado e o de inimigo estão perto demais no espaço de cor");
            Assert.Greater(Distancia(marcas[0], marcas[1]), 0.5f,
                           "a marca acima da cabeça não separa os lados");

            // Redundância deliberada: o selo some atrás de uma parede alta, a
            // marca não. Um sinal só não basta numa câmera fixa em 3/4.
            Assert.AreEqual(selos[0].r, marcas[0].r, 0.01f, "selo e marca do herói discordam de cor");
            Assert.AreEqual(selos[1].r, marcas[1].r, 0.01f, "selo e marca do monstro discordam de cor");
        }

        [Test]
        public void Lado_OSeloFicaAcimaDasTresCamadasDeRealce()
        {
            // Se o selo ficasse embaixo, a placa translúcida do alcance o
            // pintaria de azul — e o lado se perderia justamente na casa para
            // onde o jogador está olhando.
            var casa = new Vector2Int(4, 1);
            _elenco.Sincronizar(new[] { Ficha("m0", "pollen-puff", false, casa.x, casa.y) });
            _palco.RealcarArea(new[] { casa });

            var selo = _elenco.ObjetoDe("m0").transform.Find("Selo");
            var placa = MaisAltaEmRealce();
            Assert.IsNotNull(placa);
            Assert.Greater(selo.position.y, placa.position.y,
                           "o realce cobre o selo de lado");
        }

        // ======================================================= MODELO DE VERDADE

        [Test]
        public void Modelo_QuandoExiste_EscalaAteAAlturaDaClasseEApoiaOsPesNoChao()
        {
            // Um "modelo" fora de escala e com o pivô no lugar errado — 4 m de
            // altura e enterrado 1 m —, que é como todo exportador erra pelo
            // menos uma vez. O encaixe tem de consertar os dois sem ninguém
            // olhar.
            var torto = new GameObject("modelo-torto");
            try
            {
                var malha = GameObject.CreatePrimitive(PrimitiveType.Cube);
                malha.transform.SetParent(torto.transform, false);
                malha.transform.localScale = new Vector3(1f, 4f, 1f);
                malha.transform.localPosition = new Vector3(0f, 1f, 0f);
                Object.DestroyImmediate(malha.GetComponent<BoxCollider>());

                var elenco = new Elenco(_palco, null,
                                        new ModelosDeMemoria().Com("sumo", torto),
                                        new Aparencia());
                var casa = new Vector2Int(4, 1);
                elenco.Sincronizar(new[] { Ficha("h0", "sumo", true, casa.x, casa.y) });

                var caixa = CaixaDoCorpo(elenco, "h0");
                Assert.AreEqual(Elenco.AlturaDaClasse("sumo"), caixa.size.y, 0.02f,
                                "o modelo entrou com a altura dele em vez da altura da classe");
                Assert.AreEqual(_palco.TopoDe(casa), caixa.min.y, 0.02f,
                                "o modelo entrou enterrado: o apoio dos pés não corrigiu o pivô");
            }
            finally { Object.DestroyImmediate(torto); }
        }

        [Test]
        public void Modelo_ProcuraPeloIdAntesDeQualquerOutraCoisa()
        {
            // É a promessa do CONTRATO_ENTREGA_PERSONAGEM §6: trocar um
            // personagem é soltar o arquivo na pasta do id. Por isso o caminho
            // com o id vem primeiro na lista, e não depois.
            var fonte = new ModelosDeResources();
            var caminhos = fonte.CaminhosDe("sumo");

            Assert.AreEqual(ModelosDeResources.Pasta + "/sumo/sumo", caminhos[0]);
            Assert.AreEqual(ModelosDeResources.Pasta + "/sumo", caminhos[1]);
        }

        [Test]
        public void Acervo_AsSeisClassesTemModeloEEleEntraNaAlturaDoContrato()
        {
            // Este é o único que toca o acervo de verdade — Resources, FBX,
            // textura e tudo. Se ele quebra, quebrou a ponte para o acervo, e
            // não a lógica do encaixe.
            var aparencia = Aparencia.Carregar();
            Assert.Greater(aparencia.Contagem, 0,
                           "_aparencia.json não foi lido: sem ele ninguém sabe quem veste o quê");

            var elenco = new Elenco(_palco, null);
            foreach (var id in Elenco.Classes)
            {
                Assert.IsNotNull(aparencia.De(id), "a classe " + id + " não está no _aparencia.json");

                elenco.Limpar();
                elenco.Sincronizar(new[] { Ficha("u", id, true, 4, 1) });

                var corpo = elenco.ObjetoDe("u").transform.Find("Corpo");
                Assert.IsNotNull(corpo, "a classe " + id + " ficou sem corpo");
                Assert.Greater(corpo.GetComponentsInChildren<SkinnedMeshRenderer>(false).Length, 0,
                               "a classe " + id + " caiu na cápsula: o modelo do acervo não " +
                               "carregou de Resources/" + ModelosDeResources.Pasta);

                var caixa = CaixaDoCorpo(elenco, "u");
                float larguraEmCasas = Mathf.Max(caixa.size.x, caixa.size.z) / Palco.Passo;
                Assert.LessOrEqual(larguraEmCasas, Elenco.LarguraMaxima + 0.01f,
                                   "o modelo de " + id + " passa do teto de largura do §3");
                // A ALTURA da classe e o alvo, mas a LARGURA tem teto e ganha
                // (contrato §3): corpo largo demais e encolhido pelo teto e sai
                // ABAIXO da altura da classe DE PROPOSITO. O sumo do Meshy foi o
                // primeiro a exercer a regra: 2,26 casas de largura a 2,30 m,
                // segurado em 2,2 casas e 2,24 m. Entao ou a altura bate, ou a
                // largura esta cravada no teto — nunca os dois soltos.
                bool alturaBate = Mathf.Abs(caixa.size.y - Elenco.AlturaDaClasse(id)) <= 0.03f;
                bool presoNoTeto = larguraEmCasas >= Elenco.LarguraMaxima - 0.03f &&
                                   caixa.size.y <= Elenco.AlturaDaClasse(id) + 0.03f;
                Assert.IsTrue(alturaBate || presoNoTeto,
                              "o modelo de " + id + " nem bate a altura da classe (" +
                              Elenco.AlturaDaClasse(id) + ") nem esta preso no teto de largura: " +
                              "altura=" + caixa.size.y + " largura=" + larguraEmCasas + " casas");
            }
        }

        [Test]
        public void Acervo_NenhumBichoDaEstufaPassaDoTetoDeLargura()
        {
            // Defeito real, achado na foto: o Bufo-de-Pólen do acervo é uma bola
            // de 1,50 de alto por 3,50 de largo. Esticado até os 1,80 m de
            // monstro comum, ele ficava com 4,2 células de largura e apagava
            // quatro casas do tabuleiro. É o mesmo estrago das asas do Paladino
            // que o CONTRATO_ENTREGA_PERSONAGEM §3 descreve, e a regra de lá é a
            // que vale: a ALTURA manda na escala, mas a LARGURA tem teto.
            var elenco = new Elenco(_palco, Soterra.Dados.BancoDeDados.CarregarDeResources());
            foreach (var id in new[] { "pollen-puff", "thorn-lasher", "lantern-wasp" })
            {
                elenco.Limpar();
                elenco.Sincronizar(new[] { Ficha("u", id, false, 4, 1) });

                var caixa = CaixaDoCorpo(elenco, "u");
                float largura = Mathf.Max(caixa.size.x, caixa.size.z) / Palco.Passo;
                Assert.LessOrEqual(largura, Elenco.LarguraMaxima + 0.01f,
                                   id + " ocupa " + largura.ToString("0.00") + " células");
                Assert.Greater(caixa.size.y, 0.5f, id + " entrou rasteiro demais para ser visto");
            }
        }

        [Test]
        public void Acervo_OsHumanoidesNaoChegamMaisEmTPose()
        {
            // Os nove humanoides da KayKit vêm de braços abertos no `.glb`: é a
            // pose de amarração do esqueleto, e o CONTRATO_ENTREGA_PERSONAGEM §1
            // avisa que um herói parado em T faz o jogo inteiro parecer
            // quebrado. Quem desfaz isso é a conversão para FBX
            // (Ferramentas/glb_para_fbx.py --pose), e este teste é o que cobra
            // que ela foi rodada — sem ele, alguém reconverte sem a opção um dia
            // e o elenco volta a abrir os braços sem nenhum teste vermelho.
            var elenco = new Elenco(_palco, null);
            // O exemplo era o sumo, e envelheceu quando o sumo do Meshy chegou —
            // o esqueleto novo tem outros nomes e ja vem com bracos baixos por
            // construcao. A curandeira (knight) continua no acervo KayKit.
            elenco.Sincronizar(new[] { Ficha("u", "curandeira", true, 4, 1) });

            var corpo = elenco.ObjetoDe("u").transform.Find("Corpo");
            Transform ombro = null, mao = null;
            foreach (var t in corpo.GetComponentsInChildren<Transform>(true))
            {
                if (t.name == "upperarm.l") ombro = t;
                else if (t.name == "hand.l") mao = t;
            }
            Assert.IsNotNull(ombro, "o esqueleto da KayKit mudou de nomes");
            Assert.IsNotNull(mao, "o esqueleto da KayKit mudou de nomes");

            // Em T a mão fica na ALTURA do ombro, esticada para o lado. Parado,
            // ela desce. Comparar as duas alturas é a medida mais direta, e não
            // depende de convenção de eixo de osso nenhuma.
            float queda = ombro.position.y - mao.position.y;
            Assert.Greater(queda, 0.15f,
                           "a mão está na altura do ombro: o elenco continua em T-pose");
        }

        // =============================================================== APOIO

        Bounds CaixaDoCorpo(string uid) { return CaixaDoCorpo(_elenco, uid); }

        /// <summary>
        /// A caixa do corpo, medida a partir dos renderizadores de verdade e em
        /// MUNDO. Mede o que está na tela, e não o que o Elenco acha que pôs
        /// lá — repetir a conta do código de produção não provaria nada.
        /// </summary>
        static Bounds CaixaDoCorpo(Elenco elenco, string uid)
        {
            var go = elenco.ObjetoDe(uid);
            Assert.IsNotNull(go, "não há unidade " + uid + " no tabuleiro");
            var corpo = go.transform.Find("Corpo");
            Assert.IsNotNull(corpo, "a unidade " + uid + " está sem corpo");

            // Com esqueleto, só a pele: é o corpo, e não o cajado que passa da
            // cabeça, que define a altura do personagem (visibleBodyBox no JS).
            var peles = corpo.GetComponentsInChildren<SkinnedMeshRenderer>(false);
            if (peles.Length > 0) return Caixa(peles);

            return Caixa(corpo.GetComponentsInChildren<Renderer>(false));
        }

        /// <summary>
        /// Caixa medida VÉRTICE A VÉRTICE, em mundo.
        ///
        /// Não usa <c>Renderer.bounds</c>, e o motivo é um defeito que só a foto
        /// pegou: fora de Play a caixa de um <c>SkinnedMeshRenderer</c> pode
        /// nunca ter sido calculada — o sapo da Estufa devolvia 4 cm de altura.
        /// Um teste que medisse por ali diria que está tudo certo enquanto o
        /// bicho ocupa meia sala na tela.
        ///
        /// Vértice a vértice, e não pela caixa da malha: assim a medida enxerga
        /// a forma, e não uma caixa que alguém pode ter deixado desatualizada.
        /// </summary>
        static Bounds Caixa(Renderer[] rs)
        {
            var caixa = new Bounds();
            bool primeiro = true;

            for (int i = 0; i < rs.Length; i++)
            {
                if (!rs[i].enabled || !rs[i].gameObject.activeInHierarchy) continue;

                var pele = rs[i] as SkinnedMeshRenderer;
                Mesh malha;
                if (pele != null) malha = pele.sharedMesh;
                else
                {
                    var mf = rs[i].GetComponent<MeshFilter>();
                    malha = mf != null ? mf.sharedMesh : null;
                }
                if (malha == null) continue;

                var vertices = malha.vertices;
                var paraMundo = rs[i].transform.localToWorldMatrix;
                for (int v = 0; v < vertices.Length; v++)
                {
                    var p = paraMundo.MultiplyPoint3x4(vertices[v]);
                    if (primeiro) { caixa = new Bounds(p, Vector3.zero); primeiro = false; }
                    else caixa.Encapsulate(p);
                }
            }

            Assert.IsFalse(primeiro, "não havia renderizador nenhum para medir");
            return caixa;
        }

        Color Cor(string uid, string peca)
        {
            var t = _elenco.ObjetoDe(uid).transform.Find(peca);
            Assert.IsNotNull(t, "a unidade " + uid + " está sem " + peca);
            // A cor mora no MaterialPropertyBlock, não no material — ler o
            // material devolveria a cor de todo mundo igual.
            var bloco = new MaterialPropertyBlock();
            t.GetComponent<Renderer>().GetPropertyBlock(bloco);
            return bloco.GetColor("_BaseColor");
        }

        static float Distancia(Color a, Color b)
        {
            return Mathf.Sqrt((a.r - b.r) * (a.r - b.r) +
                              (a.g - b.g) * (a.g - b.g) +
                              (a.b - b.b) * (a.b - b.b));
        }

        Transform MaisAltaEmRealce()
        {
            var grupo = _go.transform.Find("Tabuleiro/Realces");
            if (grupo == null) return null;
            Transform maior = null;
            for (int i = 0; i < grupo.childCount; i++)
            {
                var t = grupo.GetChild(i);
                if (!t.gameObject.activeSelf) continue;
                if (maior == null || t.position.y > maior.position.y) maior = t;
            }
            return maior;
        }
    }
}
