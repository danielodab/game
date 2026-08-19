using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Soterra.Ferramentas
{
    /// <summary>
    /// As portas de lote do JOGO — arquivo NOVO, separado do <c>Lote.cs</c>
    /// porque aquele é de outro dono e monta a cena legada do Bootstrap.
    ///
    /// Uso:
    ///   Unity.exe -batchmode -quit -projectPath unity/SOTERRA-Tatico \
    ///     -executeMethod Soterra.Ferramentas.LoteJogo.MontarCenaDeBatalha
    ///   Unity.exe -batchmode -quit -projectPath unity/SOTERRA-Tatico \
    ///     -executeMethod Soterra.Ferramentas.LoteJogo.Foto -foto ..\foto-jogo.png
    ///
    /// A FOTO não pode usar -nographics: sem dispositivo de vídeo a câmera não
    /// tem o que renderizar e o PNG sai preto (§3 do contrato, já pago).
    /// </summary>
    public static class LoteJogo
    {
        /// <summary>A cena jogável. Vira a cena 0 do build.</summary>
        public const string Cena = "Assets/Scenes/Batalha.unity";

        /// <summary>A cena da rodada 1. LEGADA e mantida no build, atrás da
        /// nova: apagá-la apagaria a única cena que mostra o Bootstrap.</summary>
        public const string CenaLegada = "Assets/Scenes/Tatico.unity";

        /// <summary>
        /// Grava <c>Assets/Scenes/Batalha.unity</c> já montada — o objeto do
        /// jogo, o palco com a sala real, o elenco nas casas, o HUD e a câmera —
        /// e a põe como cena 0 do build.
        ///
        /// Por que gravar, se o Start remonta em Play: para abrir o Editor e
        /// VER o jogo sem apertar nada, e para o build ter cena inicial. O
        /// Montar é idempotente, então o Play em cima da cena salva não duplica
        /// nada — remonta por cima.
        /// </summary>
        public static void MontarCenaDeBatalha()
        {
            try
            {
                MontarSemSair();
            }
            catch (Exception e)
            {
                // Em -batchmode uma exceção aqui viraria só uma linha perdida no
                // log e o -quit sairia com 0 — o chamador leria sucesso onde
                // houve falha.
                Debug.LogError("[SOTERRA] MontarCenaDeBatalha falhou: " + e);
                Sair(2);
                return;
            }
            Debug.Log("[SOTERRA] Cena jogável gravada em " + Cena + " (cena 0 do build; " +
                      CenaLegada + " mantida como legada)");
            Sair(0);
        }

        /// <summary>
        /// Monta a cena do jogo e fotografa a câmera do palco, nas duas
        /// proporções de celular. É a prova visual de que a cena que o usuário
        /// abre existe e desenha — o teste prova a regra, a foto prova o jogo.
        /// </summary>
        public static void Foto()
        {
            string saida = Argumento("-foto", "foto-jogo.png");

            JogoDeBatalhaMontado jogo;
            try
            {
                jogo = Montar();
            }
            catch (Exception e)
            {
                Debug.LogError("[SOTERRA] Foto: a montagem falhou: " + e);
                Sair(2);
                return;
            }

            var palco = jogo.Componente.Palco;
            if (palco == null || palco.Camera == null)
            {
                Debug.LogError("[SOTERRA] Foto: o jogo montou sem câmera.");
                Sair(2);
                return;
            }

            Renderizar(palco, saida, 1600, 900);
            Renderizar(palco, Sufixo(saida, "-retrato"), 900, 1600);
            Sair(0);
        }

        // ============================================================= MONTAGEM

        struct JogoDeBatalhaMontado
        {
            public Soterra.Jogo.JogoDeBatalha Componente;
        }

        static JogoDeBatalhaMontado Montar()
        {
            // Cena vazia primeiro: em modo lote o Editor abre a última cena
            // gravada, e o tabuleiro dela apareceria por baixo do novo.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var go = new GameObject("Jogo");
            var jogo = go.AddComponent<Soterra.Jogo.JogoDeBatalha>();
            jogo.Montar();
            return new JogoDeBatalhaMontado { Componente = jogo };
        }

        static void MontarSemSair()
        {
            var montado = Montar();
            var cena = montado.Componente.gameObject.scene;

            Directory.CreateDirectory(Path.Combine(Application.dataPath, "Scenes"));
            EditorSceneManager.SaveScene(cena, Cena);

            // A nova é a cena 0 — é ela que o Play do build abre. A legada fica
            // atrás, mantida: contrato desta rodada.
            EditorBuildSettings.scenes = new[]
            {
                new EditorBuildSettingsScene(Cena, true),
                new EditorBuildSettingsScene(CenaLegada, true)
            };
            AssetDatabase.SaveAssets();
        }

        // ================================================================ FOTO

        static void Renderizar(Soterra.Cena.Palco palco, string saida, int larg, int alt)
        {
            var cam = palco.Camera;

            // A proporção do PNG não é a da janela do lote: sem reenquadrar, o
            // mapa sai com as pontas cortadas.
            cam.aspect = larg / (float)alt;
            palco.Enquadrar();

            // sRGB e não o padrão: o projeto é Linear, textura linear guarda o
            // valor sem a curva de exibição e ReadPixels não converte — o PNG
            // sairia escuro e lavado (§3 do contrato, já pago).
            var rt = new RenderTexture(larg, alt, 24, RenderTextureFormat.ARGB32,
                                       RenderTextureReadWrite.sRGB) { antiAliasing = 4 };
            var antesTex = cam.targetTexture;
            cam.targetTexture = rt;
            cam.Render();
            cam.targetTexture = antesTex;

            var antesRT = RenderTexture.active;
            RenderTexture.active = rt;
            var tex = new Texture2D(larg, alt, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, larg, alt), 0, 0);
            tex.Apply();
            RenderTexture.active = antesRT;

            var caminho = Path.GetFullPath(saida);
            var pasta = Path.GetDirectoryName(caminho);
            if (!string.IsNullOrEmpty(pasta)) Directory.CreateDirectory(pasta);
            File.WriteAllBytes(caminho, tex.EncodeToPNG());
            Debug.Log("[SOTERRA] Foto do jogo em " + caminho + " (" + larg + "x" + alt + ")");
        }

        static string Sufixo(string caminho, string sufixo)
        {
            var pasta = Path.GetDirectoryName(caminho) ?? "";
            return Path.Combine(pasta,
                Path.GetFileNameWithoutExtension(caminho) + sufixo + Path.GetExtension(caminho));
        }

        static string Argumento(string nome, string padrao)
        {
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == nome) return args[i + 1];
            return padrao;
        }

        /// <summary>Código de saída explícito: com -quit sozinho a Unity devolve
        /// 0 sempre, e um erro aqui dentro passaria batido em quem chamou.</summary>
        static void Sair(int codigo)
        {
            if (Application.isBatchMode) EditorApplication.Exit(codigo);
        }
    }
}
