using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Soterra.Ferramentas
{
    /// <summary>
    /// As portas de entrada do modo lote (-executeMethod). Existem porque
    /// ninguém aqui clica no Editor: cena, foto e verificação precisam caber
    /// numa linha de comando, do mesmo jeito que o resto do projeto cabe.
    ///
    /// Uso:
    ///   Unity.exe -batchmode -quit -projectPath ... -executeMethod Soterra.Ferramentas.Lote.Verificar
    ///   Unity.exe -batchmode -quit -projectPath ... -executeMethod Soterra.Ferramentas.Lote.MontarCena
    ///   Unity.exe -batchmode -quit -projectPath ... -executeMethod Soterra.Ferramentas.Lote.Foto -foto saida.png
    ///
    /// Foto NÃO pode usar -nographics: sem dispositivo de vídeo a câmera não
    /// tem o que renderizar e o PNG sai preto.
    /// </summary>
    public static class Lote
    {
        const string CenaPrincipal = "Assets/Scenes/Tatico.unity";

        /// <summary>Só compila e sai. Serve de "o código ainda fecha?" no CLI.</summary>
        public static void Verificar()
        {
            Debug.Log("[SOTERRA] Compilou. Unity " + Application.unityVersion +
                      ", pipeline " + (GraphicsSettings.defaultRenderPipeline != null
                                       ? GraphicsSettings.defaultRenderPipeline.name : "Built-in"));
            Sair(0);
        }

        /// <summary>
        /// Grava Assets/Scenes/Tatico.unity com a cena já montada.
        ///
        /// Por que gravar, se o Bootstrap monta tudo em Play: para você abrir o
        /// Editor e ver o jogo sem montar nada com o mouse — e para o build ter
        /// uma cena inicial.
        /// </summary>
        public static void MontarCena()
        {
            MontarCenaSemSair();
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(CenaPrincipal, true) };
            AssetDatabase.SaveAssets();
            Debug.Log("[SOTERRA] Cena gravada em " + CenaPrincipal);
            Sair(0);
        }

        /// <summary>
        /// Monta a cena e fotografa. É o equivalente do Chrome headless que o
        /// jogo em JS usa: sem isto eu não teria como VER o que mudei.
        /// </summary>
        public static void Foto()
        {
            string saida = Argumento("-foto", "foto.png");
            int larg = int.Parse(Argumento("-largura", "1280"));
            int alt  = int.Parse(Argumento("-altura", "800"));

            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var go = new GameObject("SOTERRA");
            var boot = go.AddComponent<Bootstrap>();
            boot.Montar();

            var cam = boot.Cam;
            if (cam == null) { Debug.LogError("[SOTERRA] Bootstrap não montou câmera."); Sair(2); return; }

            // RenderTextureReadWrite.sRGB e não o padrão: o projeto é Linear, e uma
            // textura linear guarda o valor sem a curva de exibição. ReadPixels não
            // converte nada, então o PNG saía escuro e lavado — a cor certa no
            // material, errada no arquivo. Foi assim que o herói laranja virou cinza.
            var rt = new RenderTexture(larg, alt, 24, RenderTextureFormat.ARGB32,
                                       RenderTextureReadWrite.sRGB) { antiAliasing = 4 };
            Renderizar(cam, rt);

            var antigo = RenderTexture.active;
            RenderTexture.active = rt;
            var tex = new Texture2D(larg, alt, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, larg, alt), 0, 0);
            tex.Apply();
            RenderTexture.active = antigo;

            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(saida)));
            File.WriteAllBytes(saida, tex.EncodeToPNG());
            Debug.Log("[SOTERRA] Foto em " + Path.GetFullPath(saida) + " (" + larg + "x" + alt + ")");
            Sair(0);
        }

        /// <summary>
        /// Player Windows em unity/Build/. Monta a cena antes: um build sem
        /// cena abre uma janela preta, e o erro só aparece no fim, depois de
        /// minutos de compilação.
        /// </summary>
        public static void BuildWindows()
        {
            if (!File.Exists(CenaPrincipal)) MontarCenaSemSair();

            var destino = Path.GetFullPath(Path.Combine(Application.dataPath, "../../Build/SOTERRA.exe"));
            Directory.CreateDirectory(Path.GetDirectoryName(destino));

            var opcoes = new BuildPlayerOptions
            {
                scenes = new[] { CenaPrincipal },
                locationPathName = destino,
                target = BuildTarget.StandaloneWindows64,
                options = BuildOptions.None
            };
            var relatorio = BuildPipeline.BuildPlayer(opcoes);
            bool ok = relatorio.summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded;
            Debug.Log("[SOTERRA] Build " + (ok ? "ok" : "FALHOU") + " em " + destino);
            Sair(ok ? 0 : 3);
        }

        static void MontarCenaSemSair()
        {
            var cena = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("SOTERRA").AddComponent<Bootstrap>();
            Directory.CreateDirectory(Path.Combine(Application.dataPath, "Scenes"));
            EditorSceneManager.SaveScene(cena, CenaPrincipal);
            AssetDatabase.SaveAssets();
        }

        /// <summary>
        /// Desenha a câmera numa textura.
        ///
        /// Camera.Render() e não SubmitRenderRequest: a API de pedido de render
        /// não aparece na superfície pública de Camera nesta versão do Editor
        /// (erro CS1061 ao compilar), e para uma foto avulsa o caminho antigo
        /// resolve — a URP atende Render() normalmente fora do laço de quadro.
        /// </summary>
        static void Renderizar(Camera cam, RenderTexture destino)
        {
            var antes = cam.targetTexture;
            cam.targetTexture = destino;
            cam.Render();
            cam.targetTexture = antes;
        }

        static string Argumento(string nome, string padrao)
        {
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == nome) return args[i + 1];
            return padrao;
        }

        /// <summary>
        /// Sai com código explícito. Sem isto o -quit sempre devolve 0 e um erro
        /// dentro do método passaria despercebido no script que chamou.
        /// </summary>
        static void Sair(int codigo)
        {
            if (Application.isBatchMode) EditorApplication.Exit(codigo);
        }
    }
}
