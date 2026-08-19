using System;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace Soterra.Ferramentas
{
    // Apelidos globais contra o CS0234 dos namespaces irmãos — a mesma
    // armadilha paga em Partida.cs.
    using Cena = global::Soterra.Cena;
    using Jogo = global::Soterra.Jogo;

    /// <summary>
    /// Gera o AnimatorController COMPARTILHADO do elenco
    /// (CONTRATO_ENTREGA_PERSONAGEM §6): seis estados com os nomes dos clipes do
    /// contrato, o parâmetro <c>Velocidade</c> (parado → andando → correndo) e
    /// os gatilhos <c>Atacar</c>, <c>Levar</c>, <c>Morrer</c>.
    ///
    /// Os estados tocam clipes VAZIOS com os nomes do contrato; quem põe a
    /// animação de verdade é o <see cref="Cena.Elenco"/>, por
    /// <c>AnimatorOverrideController</c>, trocando cada clipe pelo homônimo do
    /// FBX do personagem. É o que deixa UM controlador servir aos 21 personagens
    /// que ainda vêm — cada FBX chega com os mesmos seis nomes, e nomes iguais é
    /// tudo que a troca pede.
    ///
    /// O asset mora em <c>Assets/Resources/elenco/_controlador.controller</c>:
    /// dentro de <c>Resources</c> porque a cena o carrega por caminho (como tudo
    /// aqui — ninguém arrasta nada no Inspector), na pasta do elenco porque é
    /// dele, e com <c>_</c> na frente porque a pasta reserva esse prefixo para o
    /// que não é personagem (<c>_anims.fbx</c>, <c>_aparencia</c>) — um id de
    /// classe nunca começa com <c>_</c>, então não há colisão possível.
    ///
    ///   Unity.exe -batchmode -quit -nographics -projectPath unity/SOTERRA-Tatico \
    ///     -executeMethod Soterra.Ferramentas.ControladorDoElenco.Gerar
    /// </summary>
    public static class ControladorDoElenco
    {
        /// <summary>Onde o asset é gravado — o par em Assets do caminho de
        /// Resources que a cena usa (<see cref="Cena.Elenco.CaminhoDoControlador"/>).</summary>
        public const string Caminho = "Assets/Resources/" +
                                      Cena.Elenco.CaminhoDoControlador + ".controller";

        /// <summary>Acima disto anda (o contrato manda 0 = idle, &gt;0 = walk).
        /// Não é zero exato para um resto de interpolação não segurar o walk.</summary>
        public const float LimiarDeAndar = 0.1f;

        /// <summary>Acima disto corre — entre <see cref="Jogo.AnimacaoDoElenco.Andando"/>
        /// e <see cref="Jogo.AnimacaoDoElenco.Correndo"/>, que são quem escreve o parâmetro.</summary>
        public const float LimiarDeCorrer = 1.5f;

        public static void Gerar()
        {
            try
            {
                GerarSemSair();
            }
            catch (Exception e)
            {
                // Em -batchmode uma exceção viraria linha perdida no log e o
                // -quit sairia com 0 — o chamador leria sucesso onde houve falha.
                Debug.LogError("[SOTERRA] ControladorDoElenco.Gerar falhou: " + e);
                Sair(2);
                return;
            }
            Debug.Log("[SOTERRA] Controlador do elenco gravado em " + Caminho);
            Sair(0);
        }

        /// <summary>Gera (ou REgera — a geração é o dono do asset, editar o
        /// grafo à mão não sobrevive) e devolve o controlador.</summary>
        public static AnimatorController GerarSemSair()
        {
            AssetDatabase.DeleteAsset(Caminho);
            var controlador = AnimatorController.CreateAnimatorControllerAtPath(Caminho);

            controlador.AddParameter(Jogo.AnimacaoDoElenco.ParametroVelocidade,
                                     AnimatorControllerParameterType.Float);
            controlador.AddParameter(Jogo.AnimacaoDoElenco.GatilhoAtacar,
                                     AnimatorControllerParameterType.Trigger);
            controlador.AddParameter(Jogo.AnimacaoDoElenco.GatilhoLevar,
                                     AnimatorControllerParameterType.Trigger);
            controlador.AddParameter(Jogo.AnimacaoDoElenco.GatilhoMorrer,
                                     AnimatorControllerParameterType.Trigger);

            var maquina = controlador.layers[0].stateMachine;

            var idle   = Estado(controlador, maquina, "idle",   new Vector3(0f, 120f));
            var walk   = Estado(controlador, maquina, "walk",   new Vector3(280f, 120f));
            var run    = Estado(controlador, maquina, "run",    new Vector3(560f, 120f));
            var attack = Estado(controlador, maquina, "attack", new Vector3(280f, -80f));
            var hit    = Estado(controlador, maquina, "hit",    new Vector3(280f, 320f));
            var death  = Estado(controlador, maquina, "death",  new Vector3(560f, 320f));
            maquina.defaultState = idle;

            // A escada da velocidade. Ida e volta passam pelo walk de propósito:
            // correr → parar atravessa um respiro de passo em vez de congelar
            // no meio da passada.
            Velocidade(idle, walk, subindo: true,  LimiarDeAndar);
            Velocidade(walk, idle, subindo: false, LimiarDeAndar);
            Velocidade(walk, run,  subindo: true,  LimiarDeCorrer);
            Velocidade(run,  walk, subindo: false, LimiarDeCorrer);

            // Gatilhos de qualquer estado. Morrer PRIMEIRO: as transições do
            // AnyState avaliam em ordem, e a morte tem de ganhar de um Levar
            // armado no mesmo golpe.
            Gatilho(maquina, death,  Jogo.AnimacaoDoElenco.GatilhoMorrer);
            Gatilho(maquina, hit,    Jogo.AnimacaoDoElenco.GatilhoLevar);
            Gatilho(maquina, attack, Jogo.AnimacaoDoElenco.GatilhoAtacar);

            // attack e hit voltam sozinhos ao idle no fim do clipe. death NÃO
            // tem saída nenhuma: clipe sem laço segura o último quadro, e é
            // assim que o corpo "termina caído" (contrato §1).
            Volta(attack, idle);
            Volta(hit, idle);

            AssetDatabase.SaveAssets();
            return controlador;
        }

        /// <summary>
        /// Um estado com um clipe VAZIO homônimo, gravado como sub-asset do
        /// controlador. O clipe vazio não é enfeite: é a CHAVE do override — o
        /// <c>AnimatorOverrideController</c> troca clipe por clipe, e sem um
        /// clipe-base com o nome do contrato não haveria o que trocar.
        /// </summary>
        static AnimatorState Estado(AnimatorController controlador,
                                    AnimatorStateMachine maquina, string nome, Vector3 posicao)
        {
            var estado = maquina.AddState(nome, posicao);

            var clipe = new AnimationClip { name = nome };
            var ajustes = AnimationUtility.GetAnimationClipSettings(clipe);
            ajustes.loopTime = ImportacaoDoElencoDefinitivo.DaLaco(nome);
            AnimationUtility.SetAnimationClipSettings(clipe, ajustes);
            AssetDatabase.AddObjectToAsset(clipe, controlador);

            estado.motion = clipe;
            return estado;
        }

        static void Velocidade(AnimatorState de, AnimatorState para, bool subindo, float limiar)
        {
            var t = de.AddTransition(para);
            t.hasExitTime = false;         // velocidade não espera o clipe acabar
            t.hasFixedDuration = true;
            t.duration = 0.15f;
            t.AddCondition(subindo ? AnimatorConditionMode.Greater : AnimatorConditionMode.Less,
                           limiar, Jogo.AnimacaoDoElenco.ParametroVelocidade);
        }

        static void Gatilho(AnimatorStateMachine maquina, AnimatorState para, string gatilho)
        {
            var t = maquina.AddAnyStateTransition(para);
            t.hasExitTime = false;
            t.hasFixedDuration = true;
            t.duration = 0.08f;
            // Sem revoada para si mesmo: um segundo Levar no meio do hit
            // reiniciaria o recuo do zero a cada golpe de área.
            t.canTransitionToSelf = false;
            t.AddCondition(AnimatorConditionMode.If, 0f, gatilho);
        }

        static void Volta(AnimatorState de, AnimatorState idle)
        {
            var t = de.AddTransition(idle);
            t.hasExitTime = true;
            t.exitTime = 1f;               // o clipe inteiro toca antes de voltar
            t.hasFixedDuration = true;
            t.duration = 0.12f;
        }

        /// <summary>Código de saída explícito — com -quit sozinho a Unity devolve
        /// 0 sempre (a lição do LoteJogo).</summary>
        static void Sair(int codigo)
        {
            if (Application.isBatchMode) EditorApplication.Exit(codigo);
        }
    }
}
