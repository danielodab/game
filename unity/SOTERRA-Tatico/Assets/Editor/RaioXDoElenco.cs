using System;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace Soterra.Ferramentas
{
    /// <summary>
    /// Raio-X de um FBX do elenco definitivo: lista nós, renderizadores,
    /// materiais (com shader e texturas) e sub-assets do arquivo importado.
    ///
    /// Existe porque o defeito de importação é MUDO: um material que perde a
    /// textura embutida rende branco, todo teste de geometria continua verde, e
    /// só a foto denuncia — tarde. Com vinte personagens por chegar, "por que
    /// este veio branco?" precisa de resposta em um comando, não numa sessão de
    /// Editor.
    ///
    ///   Unity.exe -batchmode -quit -nographics -projectPath unity/SOTERRA-Tatico \
    ///     -executeMethod Soterra.Ferramentas.RaioXDoElenco.Examinar -id bruxo
    /// </summary>
    public static class RaioXDoElenco
    {
        public static void Examinar()
        {
            try
            {
                var id = Argumento("-id", "bruxo");
                var caminho = "Assets/Resources/elenco/" + id + "/" + id + ".fbx";
                var sb = new StringBuilder("[SOTERRA] raio-x de " + caminho + "\n");

                var principal = AssetDatabase.LoadAssetAtPath<GameObject>(caminho);
                if (principal == null)
                {
                    Debug.LogError("[SOTERRA] não há FBX em " + caminho);
                    Sair(2);
                    return;
                }

                sb.Append("--- nós ---\n");
                foreach (var t in principal.GetComponentsInChildren<Transform>(true))
                    sb.Append("  ").Append(Caminho(t, principal.transform))
                      .Append("  rot ").Append(t.localRotation.eulerAngles.ToString("0.#"))
                      .Append("  esc ").Append(t.localScale.ToString("0.###")).Append('\n');

                sb.Append("--- renderizadores ---\n");
                foreach (var r in principal.GetComponentsInChildren<Renderer>(true))
                {
                    sb.Append("  ").Append(r.GetType().Name).Append(" em ").Append(r.name).Append('\n');
                    foreach (var m in r.sharedMaterials)
                    {
                        if (m == null) { sb.Append("    (material nulo)\n"); continue; }
                        sb.Append("    material '").Append(m.name)
                          .Append("' shader '").Append(m.shader != null ? m.shader.name : "?")
                          .Append("' _BaseMap=").Append(Textura(m, "_BaseMap"))
                          .Append(" _MainTex=").Append(Textura(m, "_MainTex"))
                          .Append(" _BaseColor=").Append(m.HasProperty("_BaseColor")
                                                         ? m.GetColor("_BaseColor").ToString("0.##") : "-")
                          .Append(" _EMISSION=").Append(m.IsKeywordEnabled("_EMISSION"))
                          .Append(" _EmissionColor=").Append(m.HasProperty("_EmissionColor")
                                                             ? m.GetColor("_EmissionColor").ToString("0.##") : "-")
                          .Append(" _EmissionMap=").Append(Textura(m, "_EmissionMap"))
                          .Append('\n');
                    }
                }

                sb.Append("--- sub-assets ---\n");
                foreach (var a in AssetDatabase.LoadAllAssetRepresentationsAtPath(caminho))
                    if (a != null)
                        sb.Append("  ").Append(a.GetType().Name).Append(" '").Append(a.name)
                          .Append(a is Texture2D
                                  ? "' " + ((Texture2D)a).width + "x" + ((Texture2D)a).height
                                  : "'").Append('\n');

                // Que NÓS cada clipe anima? Se um take tocar no nó raiz da
                // armadura — o que carrega a correção de eixo —, a animação
                // deita o modelo que o teste de geometria vê de pé.
                sb.Append("--- curvas por clipe (nós de primeiro nível) ---\n");
                foreach (var a in AssetDatabase.LoadAllAssetRepresentationsAtPath(caminho))
                {
                    var clipe = a as AnimationClip;
                    if (clipe == null || clipe.name.StartsWith("__preview__")) continue;
                    var niveis = new System.Collections.Generic.SortedSet<string>();
                    foreach (var b in AnimationUtility.GetCurveBindings(clipe))
                    {
                        var corte = b.path.IndexOf('/');
                        niveis.Add(corte < 0 ? (b.path == "" ? "(raiz)" : b.path)
                                             : b.path.Substring(0, corte) + "/…");
                        // O ponto quente: uma curva NO próprio nó Armature.
                        if (b.path == "Armature" && b.propertyName == "m_LocalRotation.x")
                        {
                            var curva = AnimationUtility.GetEditorCurve(clipe, b);
                            if (curva != null && curva.length > 0)
                                niveis.Add("Armature ROT ANIMADA (x0=" +
                                           curva.keys[0].value.ToString("0.###") + ")");
                        }
                    }
                    sb.Append("  ").Append(clipe.name).Append(": ")
                      .Append(string.Join(", ", niveis)).Append('\n');
                }

                // A prova dos nove: a pose RENDERIZADA. O desenho da pele segue
                // os OSSOS (o transform do renderizador é ignorado pelo
                // skinning), então medir nó parado não basta — é preciso tocar
                // o idle e olhar onde a cabeça e os pés PARAM em mundo.
                sb.Append("--- ossos em mundo (repouso vs idle) ---\n");
                var instancia = UnityEngine.Object.Instantiate(principal);
                try
                {
                    Ossos(sb, instancia, "repouso");
                    var controlador = AssetDatabase.LoadAssetAtPath<RuntimeAnimatorController>(
                        ControladorDoElenco.Caminho);
                    var animator = instancia.GetComponentInChildren<Animator>(true);
                    if (controlador != null && animator != null)
                    {
                        var sobre = new AnimatorOverrideController(controlador);
                        var pares = new System.Collections.Generic.List<
                            System.Collections.Generic.KeyValuePair<AnimationClip, AnimationClip>>();
                        sobre.GetOverrides(pares);
                        foreach (var rep in AssetDatabase.LoadAllAssetRepresentationsAtPath(caminho))
                        {
                            var c = rep as AnimationClip;
                            if (c == null) continue;
                            for (int i = 0; i < pares.Count; i++)
                                if (pares[i].Key.name == c.name)
                                    pares[i] = new System.Collections.Generic.KeyValuePair<
                                        AnimationClip, AnimationClip>(pares[i].Key, c);
                        }
                        sobre.ApplyOverrides(pares);
                        animator.runtimeAnimatorController = sobre;
                        animator.Update(0f);
                        animator.Update(0.4f);
                        Ossos(sb, instancia, "idle t=0,4s");
                    }
                }
                finally { UnityEngine.Object.DestroyImmediate(instancia); }

                Debug.Log(sb.ToString());
                Sair(0);
            }
            catch (Exception e)
            {
                Debug.LogError("[SOTERRA] RaioXDoElenco falhou: " + e);
                Sair(2);
            }
        }

        static void Ossos(StringBuilder sb, GameObject raiz, string momento)
        {
            sb.Append("  [").Append(momento).Append("]\n");
            foreach (var t in raiz.GetComponentsInChildren<Transform>(true))
                if (t.name == "Hips" || t.name == "Head" || t.name == "LeftFoot" ||
                    t.name == "RightHand")
                    sb.Append("    ").Append(t.name).Append(" mundo ")
                      .Append(t.position.ToString("0.###")).Append('\n');
        }

        static string Textura(Material m, string propriedade)
        {
            if (!m.HasProperty(propriedade)) return "-";
            var t = m.GetTexture(propriedade);
            return t == null ? "nulo" : t.name;
        }

        static string Caminho(Transform t, Transform raiz)
        {
            if (t == raiz) return t.name;
            var partes = t.name;
            while (t.parent != null && t.parent != raiz)
            {
                t = t.parent;
                partes = t.name + "/" + partes;
            }
            return partes;
        }

        static string Argumento(string nome, string padrao)
        {
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == nome) return args[i + 1];
            return padrao;
        }

        static void Sair(int codigo)
        {
            if (Application.isBatchMode) EditorApplication.Exit(codigo);
        }
    }
}
