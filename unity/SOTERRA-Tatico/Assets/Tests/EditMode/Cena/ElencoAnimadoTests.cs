using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using UnityEditor.Animations;
using Soterra.Cena;
using Soterra.Grade;

namespace Soterra.Testes.Cena
{
    // ARMADILHA DE NOME (CONTRATO_UNITY_F1 §3, já paga): dentro de
    // `Soterra.Testes.Cena`, `Jogo.X` acharia o namespace irmão
    // `Soterra.Testes.Jogo` antes de `Soterra.Jogo`. O apelido global trava.
    using Jogo = global::Soterra.Jogo;

    /// <summary>
    /// O piloto do elenco definitivo: o bruxo do Meshy, primeiro personagem
    /// GERADO a atravessar o pipeline do CONTRATO_ENTREGA_PERSONAGEM.
    ///
    /// O que se prova aqui é a PROMESSA do contrato, não este arquivo: se estes
    /// testes passam, os próximos vinte personagens entram soltando o FBX na
    /// pasta do id e rodando a suíte — sem abrir o Editor, sem clicar em nada.
    /// </summary>
    public class ElencoAnimadoTests
    {
        static readonly string[] SalaDeTeste =
        {
            "#########",
            "#.......#",
            "#P.....a#",
            "#.......#",
            "#########"
        };

        GameObject _go;
        Palco _palco;
        Elenco _elenco;

        [SetUp]
        public void Antes()
        {
            _go = new GameObject("palco-animado-de-teste");
            _palco = _go.AddComponent<Palco>();
            _palco.Montar(Mapa.DeTexto(SalaDeTeste));
            // Fontes PADRÃO de propósito: é o acervo de verdade — Resources,
            // FBX, controlador — que este arquivo cobra.
            _elenco = new Elenco(_palco, null);
        }

        [TearDown]
        public void Depois()
        {
            if (_go != null) Object.DestroyImmediate(_go);
        }

        static FichaDeUnidade Ficha(string uid, string id, int x, int y)
        {
            return new FichaDeUnidade
            {
                Uid = uid, Id = id, Heroi = true,
                Casa = new Vector2Int(x, y), Viva = true
            };
        }

        // ================================================================= FBX

        [Test]
        public void Fbx_DoBruxo_TrazOsSeisClipesDoContrato_ComOLacoDaTabela()
        {
            // Nome diferente = animação que NUNCA toca (contrato §1); laço
            // errado = idle que congela ou morte que ressuscita. Os dois
            // defeitos são mudos — só este teste e a foto os denunciam.
            var clipes = Elenco.ClipesDe("bruxo");
            Assert.AreEqual(Elenco.NomesDeClipe.Count, clipes.Length,
                            "o FBX do bruxo não importou com exatamente seis clipes");

            foreach (var nome in Elenco.NomesDeClipe)
            {
                AnimationClip achado = null;
                for (int i = 0; i < clipes.Length; i++)
                    if (clipes[i].name == nome) achado = clipes[i];
                Assert.IsNotNull(achado, "falta o clipe '" + nome + "' — nome fora do contrato §1");

                bool laco = false;
                for (int i = 0; i < Elenco.ClipesEmLaco.Count; i++)
                    if (Elenco.ClipesEmLaco[i] == nome) laco = true;
                Assert.AreEqual(laco, achado.isLooping,
                                "o clipe '" + nome + "' " + (laco ? "tinha de repetir" :
                                "não pode repetir — attack/hit tocam uma vez e death termina caído"));
                Assert.Greater(achado.length, 0.01f, "o clipe '" + nome + "' está vazio");
            }
        }

        // ========================================================= CONTROLADOR

        [Test]
        public void Controlador_Compartilhado_TemOsSeisEstadosEOsQuatroParametros()
        {
            var controlador = UnityEditor.AssetDatabase.LoadAssetAtPath<AnimatorController>(
                "Assets/Resources/" + Elenco.CaminhoDoControlador + ".controller");
            Assert.IsNotNull(controlador,
                             "não há controlador gravado — rode " +
                             "Soterra.Ferramentas.ControladorDoElenco.Gerar");

            var maquina = controlador.layers[0].stateMachine;
            var estados = new HashSet<string>();
            foreach (var e in maquina.states) estados.Add(e.state.name);
            foreach (var nome in Elenco.NomesDeClipe)
                Assert.IsTrue(estados.Contains(nome), "falta o estado '" + nome + "'");
            Assert.AreEqual(Elenco.NomesDeClipe.Count, estados.Count, "há estado a mais");

            // idle é o estado de nascimento: é a pose em que o personagem passa
            // a maior parte da batalha (contrato §1).
            Assert.AreEqual("idle", maquina.defaultState.name);

            var parametros = new Dictionary<string, AnimatorControllerParameterType>();
            foreach (var p in controlador.parameters) parametros[p.name] = p.type;
            Assert.AreEqual(AnimatorControllerParameterType.Float,
                            parametros[Jogo.AnimacaoDoElenco.ParametroVelocidade]);
            Assert.AreEqual(AnimatorControllerParameterType.Trigger,
                            parametros[Jogo.AnimacaoDoElenco.GatilhoAtacar]);
            Assert.AreEqual(AnimatorControllerParameterType.Trigger,
                            parametros[Jogo.AnimacaoDoElenco.GatilhoLevar]);
            Assert.AreEqual(AnimatorControllerParameterType.Trigger,
                            parametros[Jogo.AnimacaoDoElenco.GatilhoMorrer]);
        }

        [Test]
        public void Controlador_MorteNaoTemSaida_EGanhaDeQualquerOutroGatilho()
        {
            var controlador = UnityEditor.AssetDatabase.LoadAssetAtPath<AnimatorController>(
                "Assets/Resources/" + Elenco.CaminhoDoControlador + ".controller");
            Assert.IsNotNull(controlador);
            var maquina = controlador.layers[0].stateMachine;

            foreach (var e in maquina.states)
                if (e.state.name == "death")
                    Assert.AreEqual(0, e.state.transitions.Length,
                                    "death tem transição de saída: o corpo levantaria em vez de " +
                                    "segurar o último quadro caído");

            // As transições do AnyState avaliam EM ORDEM: se Morrer não vier
            // primeiro, um Levar armado no golpe fatal ganharia da morte.
            Assert.AreEqual(3, maquina.anyStateTransitions.Length);
            Assert.AreEqual("death", maquina.anyStateTransitions[0].destinationState.name,
                            "Morrer tem de ser a primeira transição do AnyState");
        }

        // ============================================================== ANEXO

        [Test]
        public void Elenco_AnexaOAnimator_ComOControladorCompartilhado_QuandoHaClipes()
        {
            _elenco.Sincronizar(new[] { Ficha("h1", "bruxo", 1, 2) });

            var raiz = _elenco.ObjetoDe("h1");
            var animator = raiz.GetComponentInChildren<Animator>(true);
            Assert.IsNotNull(animator, "o bruxo tem seis clipes e entrou sem Animator");

            var sobre = animator.runtimeAnimatorController as AnimatorOverrideController;
            Assert.IsNotNull(sobre, "o Animator não recebeu o AnimatorOverrideController");

            var compartilhado = Resources.Load<RuntimeAnimatorController>(
                Elenco.CaminhoDoControlador);
            Assert.AreSame(compartilhado, sobre.runtimeAnimatorController,
                           "o override não embrulha o controlador COMPARTILHADO do contrato §6");

            // E cada estado toca o clipe do PRÓPRIO FBX, casado pelo nome.
            foreach (var nome in Elenco.NomesDeClipe)
            {
                var clipe = sobre[nome];
                Assert.IsNotNull(clipe, "o estado '" + nome + "' ficou sem clipe no override");
                Assert.AreEqual(nome, clipe.name);
            }
        }

        [Test]
        public void Elenco_OModeloDoIdGanhaDoAcervo_EEhOEsqueletoDoMeshy()
        {
            // A escada da troca promete: o FBX na pasta do id ganha de tudo.
            // O esqueleto do Meshy usa nomes Mixamo (`Hips`); o mage da KayKit
            // que o bruxo vestia até ontem usa `hips` minúsculo de Blender.
            _elenco.Sincronizar(new[] { Ficha("h1", "bruxo", 1, 2) });

            var corpo = _elenco.ObjetoDe("h1").transform.Find("Corpo");
            Transform hips = null;
            foreach (var t in corpo.GetComponentsInChildren<Transform>(true))
                if (t.name == "Hips") hips = t;
            Assert.IsNotNull(hips,
                             "não há osso 'Hips': o bruxo ainda veste o modelo do acervo, e o " +
                             "FBX de Resources/elenco/bruxo/bruxo não foi carregado");
        }

        [Test]
        public void Elenco_SemClipes_NaoGanhaControlador_ENadaQuebraParaOAcervo()
        {
            // O elenco CC0 de hoje — e os 20 personagens que ainda não chegaram.
            // A rede do piloto: quem não tem clipe segue EXATAMENTE como está.
            var cubo = new GameObject("modelo-sem-clipe");
            try
            {
                var malha = GameObject.CreatePrimitive(PrimitiveType.Cube);
                malha.transform.SetParent(cubo.transform, false);
                Object.DestroyImmediate(malha.GetComponent<BoxCollider>());

                var elenco = new Elenco(_palco, null,
                                        new ModelosDeMemoria().Com("sumo", cubo),
                                        new Aparencia());
                elenco.Sincronizar(new[] { Ficha("h0", "sumo", 1, 1) });

                Assert.IsNull(elenco.ObjetoDe("h0").GetComponentInChildren<Animator>(true),
                              "modelo sem clipe ganhou Animator — o anexo tinha de ser condicional");
            }
            finally { Object.DestroyImmediate(cubo); }

            // E a classe que ainda veste o acervo não ganha CONTROLADOR: pode
            // haver Animator (o FBX com rig traz um), mas sem estado nenhum.
            _elenco.Sincronizar(new[] { Ficha("h2", "espadachim", 2, 1) });
            var animator = _elenco.ObjetoDe("h2").GetComponentInChildren<Animator>(true);
            if (animator != null)
                Assert.IsNull(animator.runtimeAnimatorController,
                              "o espadachim do acervo (sem clipes) recebeu controlador");
        }

        // ============================================================== ESCALA

        [Test]
        public void Fbx_DoBruxo_EntraA1m75_ComOsPesNoChaoDaCasa()
        {
            // O número do piloto: 1,75 m é a linha do bruxo na tabela do
            // contrato §2, escrita à mão aqui para não conferir o Elenco contra
            // ele mesmo. Se o Meshy mudar a escala de exportação nos próximos
            // vinte, é este teste que acusa.
            var casa = new Vector2Int(4, 2);
            _elenco.Sincronizar(new[] { Ficha("h1", "bruxo", casa.x, casa.y) });

            var caixa = CaixaDoCorpo("h1");
            Assert.AreEqual(1.75f, caixa.size.y, 0.03f,
                            "o bruxo não foi normalizado para 1,75 m");
            Assert.AreEqual(_palco.TopoDe(casa), caixa.min.y, 0.02f,
                            "o bruxo está enterrado ou flutuando: pivô fora dos pés (§2)");
            Assert.LessOrEqual(Mathf.Max(caixa.size.x, caixa.size.z) / Palco.Passo,
                               Elenco.LarguraMaxima,
                               "o bruxo passa do teto de largura do §3");
        }

        // ============================================================== SOLTAR

        [Test]
        public void Soltar_TiraDaAdministracao_SemDestruirOCorpo()
        {
            // É o mecanismo do corpo caído: a morte solta o objeto ANTES do
            // espelho, e a sincronização seguinte não pode nem movê-lo nem
            // destruí-lo.
            _elenco.Sincronizar(new[] { Ficha("h1", "bruxo", 1, 2) });
            var raiz = _elenco.ObjetoDe("h1");

            var solto = _elenco.Soltar("h1");
            Assert.AreSame(raiz, solto);
            Assert.IsNull(_elenco.ObjetoDe("h1"), "solto continua administrado");

            _elenco.Sincronizar(new FichaDeUnidade[0]);
            // Em Unity, objeto destruído compara como nulo — é o teste certo.
            Assert.IsTrue(solto != null,
                          "a sincronização destruiu o corpo solto: o cadáver sumiria no mesmo " +
                          "quadro em que o clipe de queda começa");
        }

        // =============================================================== APOIO

        /// <summary>Vértice a vértice, em mundo — a mesma medida (e o mesmo
        /// motivo) do ElencoTests: medir o que está na TELA.</summary>
        Bounds CaixaDoCorpo(string uid)
        {
            var go = _elenco.ObjetoDe(uid);
            Assert.IsNotNull(go);
            var corpo = go.transform.Find("Corpo");
            Assert.IsNotNull(corpo);

            var peles = corpo.GetComponentsInChildren<SkinnedMeshRenderer>(false);
            Assert.Greater(peles.Length, 0, "o bruxo caiu na cápsula: o FBX não carregou");

            var caixa = new Bounds();
            bool primeiro = true;
            for (int i = 0; i < peles.Length; i++)
            {
                var malha = peles[i].sharedMesh;
                if (malha == null) continue;
                var vertices = malha.vertices;
                var paraMundo = peles[i].transform.localToWorldMatrix;
                for (int v = 0; v < vertices.Length; v++)
                {
                    var p = paraMundo.MultiplyPoint3x4(vertices[v]);
                    if (primeiro) { caixa = new Bounds(p, Vector3.zero); primeiro = false; }
                    else caixa.Encapsulate(p);
                }
            }
            Assert.IsFalse(primeiro, "não havia pele para medir");
            return caixa;
        }
    }
}
