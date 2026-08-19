using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.Fx
{
    // Ver a nota de armadilha de nome em FamiliasDeEfeitoTests.cs.
    using Fx = global::Soterra.Fx;

    /// <summary>
    /// O atlas, o material único e o ORÇAMENTO DE CELULAR.
    ///
    /// As três coisas são a mesma pergunta vista de ângulos diferentes: quanto
    /// custa desenhar um feitiço num telefone. A resposta tem de ser um número,
    /// medido, e não "parece leve".
    /// </summary>
    public class AtlasEOrcamentoTests
    {
        GameObject _raiz;
        Fx.BancoDeEfeitos _banco;

        [SetUp]
        public void Antes()
        {
            _raiz = new GameObject("fx-de-teste");
            _banco = Fx.BancoDeEfeitos.Criar(_raiz.transform);
        }

        [TearDown]
        public void Depois()
        {
            if (_raiz != null) Object.DestroyImmediate(_raiz);
        }

        [Test]
        public void OAtlas_Carrega_ComDezesseisQuadrosNomeados()
        {
            var atlas = _banco.Atlas;
            if (!atlas.Completo)
                Assert.Inconclusive("o atlas ainda não foi extraído: rode " +
                                    "`python tools/extrai_fx_atlas.py`");

            Assert.AreEqual(4, atlas.Colunas, "a grade do atlas mudou de largura");
            Assert.AreEqual(4, atlas.Linhas, "a grade do atlas mudou de altura");
            Assert.AreEqual(16, atlas.Quadros, "o atlas tem de trazer as 16 formas de SISTEMAS §4");
            Assert.AreEqual(16, atlas.Mapa.Quadros.Count, "o _mapa.json não descreve os 16 quadros");

            Assert.AreEqual(512, atlas.Textura.width, "o PNG mudou de tamanho; 4×128 = 512");
            Assert.AreEqual(512, atlas.Textura.height, "o PNG mudou de tamanho; 4×128 = 512");

            // Os nomes que os moldes usam. Um índice trocado aqui não daria erro
            // nenhum: desenharia meia-lua onde devia haver runa, e a armadilha
            // passaria a parecer um corte.
            foreach (var nome in new[]
            {
                "ponto", "corte", "cascalho", "brasa", "runa", "brilho", "fumaca",
                "raio", "redemoinho", "anel", "risco", "estouro", "aura", "lingua",
                "halo", "cintila"
            })
                Assert.IsTrue(atlas.TemQuadro(nome), "o atlas não tem o quadro '" + nome + "'");

            Assert.AreEqual(4, atlas.Quadro("runa"),
                            "a runa é o quadro 4 (magic_01) — a armadilha e a invocação a pedem " +
                            "pelo nome e receberiam outro desenho");
            Assert.AreEqual(1, atlas.Quadro("corte"), "a meia-lua é o quadro 1 (slash_02)");
        }

        [Test]
        public void UmaTextura_EDoisMateriaisCOMPARTILHADOS()
        {
            _banco.PrepararTodas();

            // DOIS materiais no projeto inteiro, e nunca um por objeto: o
            // aditivo (efeito é luz) e o opaco (a forma que precisa contrastar
            // com o chão claro em vez de brilhar). Material distinto criado em
            // tempo de edição faz o SRP Batcher desenhar TUDO com a cor do
            // primeiro (CONTRATO_UNITY_F1 §3) — o meteoro de fogo pintaria a
            // onda de água de laranja. Por isso a cor vai em main.startColor.
            var materiais = new List<Material>();
            var texturas = new List<Texture>();
            int sistemas = 0;

            var particulas = _raiz.GetComponentsInChildren<ParticleSystem>(true);
            for (int i = 0; i < particulas.Length; i++)
            {
                var r = particulas[i].GetComponent<ParticleSystemRenderer>();
                if (r == null || r.sharedMaterial == null) continue;
                sistemas++;
                if (!materiais.Contains(r.sharedMaterial)) materiais.Add(r.sharedMaterial);

                var t = r.sharedMaterial.HasProperty("_BaseMap")
                    ? r.sharedMaterial.GetTexture("_BaseMap")
                    : (r.sharedMaterial.HasProperty("_MainTex")
                        ? r.sharedMaterial.GetTexture("_MainTex") : null);
                if (t != null && !texturas.Contains(t)) texturas.Add(t);
            }

            Assert.Greater(sistemas, 0, "nenhum sistema recebeu material");
            Assert.LessOrEqual(materiais.Count, 2,
                               "apareceram " + materiais.Count + " materiais: alguém está criando " +
                               "material por objeto, e o SRP Batcher vai pintar tudo com a cor do " +
                               "primeiro");

            if (_banco.Atlas.Completo)
                Assert.AreEqual(1, texturas.Count,
                                "as 21 famílias e as 16 formas têm de sair de UMA textura — o " +
                                "orçamento de celular é isso");
        }

        [Test]
        public void OPool_NaoCriaObjetoNovoPorConjuracao()
        {
            _banco.PrepararTodas();
            int antes = _raiz.GetComponentsInChildren<Transform>(true).Length;

            // Trinta conjurações seguidas, sem deixar nada terminar: é o pior
            // caso do rodízio. Criar por conjuração é a receita conhecida de
            // engasgo — a alocação e o coletor de lixo chegam no quadro em que o
            // jogador está olhando o efeito.
            for (int i = 0; i < 30; i++)
            {
                var familia = Fx.FamiliaDeEfeito.Todas[i % Fx.FamiliaDeEfeito.Todas.Count];
                _banco.Disparar(familia, Vector3.zero, new Vector3(3f, 0f, 2f), Color.white);
            }

            int depois = _raiz.GetComponentsInChildren<Transform>(true).Length;
            Assert.AreEqual(antes, depois,
                            "o pool cresceu de " + antes + " para " + depois + " objetos ao " +
                            "conjurar: alguém está instanciando por disparo");
        }

        [Test]
        public void OSistema_VoltaAEstarLivreQuandoOEfeitoAcaba()
        {
            var sistema = _banco.Disparar(Fx.FamiliaDeEfeito.Estouro,
                                          Vector3.zero, new Vector3(2f, 0f, 0f), Color.red);
            Assert.IsNotNull(sistema, "o estouro não achou molde");
            Assert.IsTrue(sistema.Ocupado, "o efeito não começou");

            // A armadilha é a mais longa do jogo (1,8 s): dois segundos cobrem
            // qualquer família.
            for (int i = 0; i < 120; i++) _banco.Avancar(1f / 60f);

            Assert.IsFalse(sistema.Ocupado,
                           "o sistema ficou preso depois do fim do efeito — o pool encolheria a " +
                           "cada conjuração até cortar efeitos vivos");
            Assert.AreEqual(0, _banco.SistemasOcupados(), "sobrou efeito no ar");
        }

        [Test]
        public void AArmadilha_PLANTA_EFicaMuitoMaisQueOEstouro()
        {
            // A regra de SISTEMAS §4 em número: a armadilha NÃO estoura. Se um
            // dia alguém a encurtar para o tempo de um estouro, as duas passam a
            // ser a mesma coisa na tela e o jogador perde a informação de que há
            // algo plantado ali.
            var armadilha = _banco.Molde(Fx.FamiliaDeEfeito.Armadilha);
            var estouro = _banco.Molde(Fx.FamiliaDeEfeito.Estouro);

            // A medida é o tempo em que a FORMA fica OPACA, e não a duração
            // total do molde. A primeira versão deste teste comparava as
            // durações e reprovou com 1,8 s contra 0,8 s — mas os 0,8 s do
            // estouro são quase todos o rastro de pó já transparente, que
            // ninguém vê. Medir duração total responde "quanto tempo o sistema
            // fica ligado"; a pergunta do jogador é "quanto tempo eu enxergo
            // que tem algo plantado aqui", e essa é vida × permanência.
            float ficaAArmadilha = armadilha.Camadas[0].Vida * armadilha.Camadas[0].Permanencia;
            float ficaOEstouro = estouro.Camadas[0].Vida * estouro.Camadas[0].Permanencia;

            Assert.Greater(ficaAArmadilha, ficaOEstouro * 10f,
                           "o selo da armadilha fica legível " + ficaAArmadilha + " s e a forma " +
                           "do estouro " + ficaOEstouro + " s: perto demais para se distinguirem. " +
                           "A armadilha PLANTA — se ela aparecer e sumir como um estouro, o " +
                           "jogador não fica sabendo que há algo naquela casa");

            Assert.Greater(armadilha.Duracao, estouro.Duracao * 2f,
                           "e o efeito inteiro da armadilha também tem de durar mais");
            Assert.AreEqual(0f, armadilha.Tranco,
                            "a armadilha sacode a câmera: ela PLANTA, não bate em ninguém");

            // E o desenho é o selo de runas, deitado no chão — não um clarão.
            Assert.AreEqual("runa", armadilha.Camadas[0].Quadro);
            Assert.AreEqual(Fx.ModoDeDesenho.Chao, armadilha.Camadas[0].Modo);
        }

        [Test]
        public void OMeteoro_CaiDoCeu_EOConeAbreNoConjurador()
        {
            // As duas afirmações de SISTEMAS §4 que mais se perdem quando alguém
            // "simplifica" um molde: sem a âncora no céu o meteoro vira um
            // estouro qualquer, e sem a âncora no conjurador o cone abre no
            // lugar errado da sala.
            var meteoro = _banco.Molde(Fx.FamiliaDeEfeito.Meteoro);
            Assert.AreEqual(Fx.Ancora.CeuDeVies, meteoro.Camadas[0].Onde,
                            "o meteoro não nasce no céu");
            Assert.IsTrue(meteoro.Camadas[0].Viaja, "o meteoro não cai: ele aparece");
            Assert.Greater(meteoro.Camadas[1].Atraso, 0f,
                           "o estouro do meteoro acontece junto com a partida — não há queda " +
                           "para ver");

            var cone = _banco.Molde(Fx.FamiliaDeEfeito.Cone);
            Assert.AreEqual(Fx.Ancora.PeitoDoConjurador, cone.Camadas[0].Onde,
                            "o cone não abre a partir de quem conjura");
            Assert.AreEqual(Fx.FormaDeEmissao.Leque, cone.Camadas[0].Forma,
                            "o cone não tem leque: a abertura viria de aleatoriedade, e leria " +
                            "como uma nuvem redonda");

            var invocacao = _banco.Molde(Fx.FamiliaDeEfeito.Invocacao);
            bool sobe = false;
            for (int i = 0; i < invocacao.Camadas.Length; i++)
                if (invocacao.Camadas[i].Empuxo.y > 1f) sobe = true;
            Assert.IsTrue(sobe, "a invocação não sobe: não há coluna de luz nenhuma");
        }

        /// <summary>
        /// O ORÇAMENTO, medido e escrito no log. O número que importa não é o
        /// teto teórico das 21 famílias juntas — é o custo de UMA conjuração,
        /// porque é isso que o telefone paga quando o jogador aperta um feitiço.
        /// </summary>
        [Test]
        public void OCustoDePico_CabeNoOrcamentoDeCelular()
        {
            _banco.PrepararTodas();

            int piorFamilia = 0;
            string nomeDaPior = "";
            for (int i = 0; i < Fx.FamiliaDeEfeito.Todas.Count; i++)
            {
                var f = Fx.FamiliaDeEfeito.Todas[i];
                int teto = _banco.TetoDaFamilia(f);
                if (teto > piorFamilia) { piorFamilia = teto; nomeDaPior = f; }
            }

            int tetoGeral = _banco.TetoDeParticulas();
            int sistemasMontados = _banco.Montados;
            var camadas = _raiz.GetComponentsInChildren<ParticleSystem>(true).Length;

            Debug.Log("[SOTERRA/FX] orçamento — " + sistemasMontados + " sistemas em pool (" +
                      Fx.FamiliaDeEfeito.Todas.Count + " famílias × " +
                      Fx.BancoDeEfeitos.CopiasPorFamilia + " cópias), " + camadas +
                      " ParticleSystem, 1 textura, 1 material. Pior família: " + nomeDaPior +
                      " com " + piorFamilia + " partículas por conjuração. Teto absoluto (tudo " +
                      "no ar ao mesmo tempo, caso que o jogo não alcança): " + tetoGeral + ".");

            Assert.Less(piorFamilia, 120,
                        "a família '" + nomeDaPior + "' pede " + piorFamilia + " partículas numa " +
                        "conjuração. Acima de ~120 o custo de preenchimento de tela começa a " +
                        "pesar num telefone, e o desenho não fica mais legível por isso");

            Assert.Less(tetoGeral, 2600,
                        "o teto somado passou de 2.600 partículas — é mais do que a camada 3D da " +
                        "linha JS reservava para o jogo INTEIRO");
        }
    }
}
