using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using Soterra.Grade;
#if UNITY_EDITOR
using UnityEditor;
using UnityEditor.SceneManagement;
#endif

namespace Soterra.Cena
{
    /// <summary>
    /// Fotografa o palco pela linha de comando. É o único jeito de VER o que
    /// este palco desenha: ninguém neste projeto clica no Editor, e
    /// `lote.ps1 foto` fotografa a cena do Bootstrap, que é outra.
    ///
    ///   Unity.exe -batchmode -quit -projectPath unity/SOTERRA-Tatico \
    ///     -executeMethod Soterra.Cena.FotoDoPalco.Tirar \
    ///     -foto ..\foto-palco.png -largura 1600 -altura 1000 [-giros 1]
    ///
    /// SEM -nographics: sem dispositivo de vídeo a câmera não tem o que
    /// renderizar e o PNG sai preto. Já custou uma rodada a esta equipe.
    /// </summary>
    public static class FotoDoPalco
    {
        /// <summary>
        /// "O Vestíbulo das Heras", a primeira sala da Estufa, copiada letra por
        /// letra de js/core/data/dungeons.js. Mapa de verdade e não desenho meu:
        /// 21×17 com parede alta em anel, cobertura baixa encostada na parede
        /// (`##===`, os dois tipos LADO A LADO, que é o caso difícil), buraco no
        /// recorte da borda, chão decorado e os nascimentos.
        /// </summary>
        public static readonly string[] SalaDeProva =
        {
            "~~~~~###########~~~~~",
            "~~~~#,.........,#~~~~",
            "~~~##===.....===##~~~",
            "~~#.##.........##.#~~",
            "~#.,..##.....##..,.#~",
            "#...=====...=====...#",
            "#.....a...#...b.....#",
            "#PP..##.......##....#",
            "#PP..............c..#",
            "#PP..##.......##....#",
            "#.....a...#...b.....#",
            "#...=====...=====...#",
            "~#.,..##.....##..,.#~",
            "~~#.##.........##.#~~",
            "~~~##===.....===##~~~",
            "~~~~#,.........,#~~~~",
            "~~~~~###########~~~~~"
        };

        // Cor de "casa em risco" do jogo em JS (renderer3d_v2.js). Entra na foto
        // como SEGUNDA cor de realce: prova que Realcar acumula em vez de
        // substituir, que é o que o jogo precisa para mostrar passo e feitiço ao
        // mesmo tempo.
        static readonly Color CorRisco = new Color(1f, 0.541f, 0.141f);   // #ff8a24

        public static void Tirar()
        {
            string saida = Argumento("-foto", "foto-palco.png");
            int larg = int.Parse(Argumento("-largura", "1600"));
            int alt = int.Parse(Argumento("-altura", "1000"));
            int giros = int.Parse(Argumento("-giros", "0"));

#if UNITY_EDITOR
            // Cena vazia primeiro: em modo lote o Editor abre a última cena
            // gravada, e o tabuleiro do Bootstrap apareceria por baixo do meu.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
#endif

            var palco = new GameObject("Palco").AddComponent<Palco>();
            var mapa = Mapa.DeTexto(SalaDeProva);
            palco.Montar(mapa);                       // fora de Play, sem ninguém apertar nada
            if (giros != 0) palco.Girar(giros);

            var cam = palco.Camera;
            if (cam == null) { Debug.LogError("[SOTERRA] Palco não montou câmera."); Sair(2); return; }

            // A proporção do PNG não é a da janela: sem reenquadrar com ela, o
            // mapa sai com as pontas cortadas.
            cam.aspect = larg / (float)alt;
            palco.Enquadrar();

            // Alcance de passo a partir do nascimento do herói, na cor que o jogo
            // em JS usa para casa alcançável.
            palco.Realcar(Alcance(mapa, mapa.NascimentosHeroi[0], 6), Comalfa(Palco.CorAlcance, 0.55f));
            // E os nascimentos de monstro numa segunda cor, por cima.
            var inimigos = new List<Vector2Int>();
            foreach (var n in mapa.NascimentosMonstro) inimigos.Add(n.Casa);
            palco.Realcar(inimigos, Comalfa(CorRisco, 0.65f));

            // RenderTextureReadWrite.sRGB e não o padrão: o projeto é Linear, uma
            // textura linear guarda o valor sem a curva de exibição e ReadPixels
            // não converte nada — o PNG sairia escuro e lavado.
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
            Directory.CreateDirectory(Path.GetDirectoryName(caminho));
            File.WriteAllBytes(caminho, tex.EncodeToPNG());
            Debug.Log("[SOTERRA] Foto do palco em " + caminho + " (" + larg + "x" + alt +
                      ", giros " + giros + ")");
            Sair(0);
        }

        static Color Comalfa(Color c, float a) { return new Color(c.r, c.g, c.b, a); }

        /// <summary>
        /// Busca em largura pelas casas andáveis a até `pp` passos. É andaime da
        /// FOTO, não a API de passo — essa é da Locomoção (§5 do contrato) e
        /// ainda não existe nesta árvore. Fica aqui, e não no Palco, porque o
        /// palco desenha; quem decide o que acender é o jogo.
        /// </summary>
        static List<Vector2Int> Alcance(Mapa m, Vector2Int origem, int pp)
        {
            var visto = new Dictionary<Vector2Int, int> { { origem, 0 } };
            var fila = new Queue<Vector2Int>();
            fila.Enqueue(origem);
            var saida = new List<Vector2Int>();
            var lados = new[] { Vector2Int.up, Vector2Int.down, Vector2Int.left, Vector2Int.right };

            while (fila.Count > 0)
            {
                var atual = fila.Dequeue();
                int custo = visto[atual];
                if (custo > 0) saida.Add(atual);
                if (custo == pp) continue;
                for (int i = 0; i < lados.Length; i++)
                {
                    var vizinho = atual + lados[i];
                    if (visto.ContainsKey(vizinho) || !m.Andavel(vizinho)) continue;
                    visto[vizinho] = custo + 1;
                    fila.Enqueue(vizinho);
                }
            }
            return saida;
        }

        static string Argumento(string nome, string padrao)
        {
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == nome) return args[i + 1];
            return padrao;
        }

        /// <summary>Código de saída explícito: com -quit sozinho o Unity devolve
        /// 0 sempre, e um erro aqui dentro passaria batido em quem chamou.</summary>
        static void Sair(int codigo)
        {
#if UNITY_EDITOR
            if (Application.isBatchMode) EditorApplication.Exit(codigo);
#endif
        }
    }
}
