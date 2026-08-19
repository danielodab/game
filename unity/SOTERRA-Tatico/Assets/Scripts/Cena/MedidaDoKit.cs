using System.Text;
using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Soterra.Cena
{
    /// <summary>
    /// Mede o env-kit como a Unity o importou: caixa de cada peça, escala que a
    /// sala vai aplicar e para que lados a peça estende braço.
    ///
    ///   Unity.exe -batchmode -quit -nographics -projectPath unity/SOTERRA-Tatico \
    ///     -executeMethod Soterra.Cena.MedidaDoKit.Imprimir
    ///
    /// Existe porque as peças atravessam glTF → Blender → FBX → Unity, e cada
    /// etapa dessa ponte pode girar, espelhar ou reescalar o que passa. O
    /// <see cref="Cenografia"/> se defende disso medindo em vez de supor, e este
    /// atalho é como se CONFERE o que ele mediu — sem ele, "a parede saiu baixa"
    /// vira meia hora de adivinhação.
    /// </summary>
    public static class MedidaDoKit
    {
        static readonly string[] Interessantes =
        {
            "wall_str", "wall_str2", "wall_str3", "wall_pil", "wall_win",
            "wall_corner", "wall_cross", "wall_tsplit", "wall_half",
            "pillar", "pillar_deco",
            "floor_a", "floor_b", "floor_c", "floor_deco", "floor_grate", "floor_weeds",
            "crates", "barrel", "chest", "keg", "box_big", "coins", "table", "rubble",
            "torch_wall"
        };

        public static void Imprimir()
        {
            var fonte = new PecasDeResources();
            var regua = fonte.Peca("wall_str");
            float escala = (regua != null && regua.Caixa.size.x > 1e-4f)
                ? Palco.Passo / regua.Caixa.size.x : 0f;

            var texto = new StringBuilder();
            texto.AppendLine("[SOTERRA] atlas: " + (fonte.Atlas != null ? fonte.Atlas.name : "AUSENTE"));
            texto.AppendLine("[SOTERRA] escala de parede (casas por unidade do kit): " + escala);

            for (int i = 0; i < Interessantes.Length; i++)
            {
                var nome = Interessantes[i];
                var peca = fonte.Peca(nome);
                if (peca == null) { texto.AppendLine(nome.PadRight(13) + " AUSENTE"); continue; }

                var c = peca.Caixa;
                var bracos = escala > 0f
                    ? AutoParede.BracosDe(new Bounds(c.center * escala, c.size * escala))
                    : Lados.Nenhum;
                texto.AppendLine(string.Format(
                    "{0} malhas {1}  x[{2:F3} {3:F3}] y[{4:F3} {5:F3}] z[{6:F3} {7:F3}]  bracos {8}",
                    nome.PadRight(13), peca.Malhas.Count,
                    c.min.x, c.max.x, c.min.y, c.max.y, c.min.z, c.max.z, bracos));
            }

            Debug.Log(texto.ToString());
#if UNITY_EDITOR
            if (Application.isBatchMode) EditorApplication.Exit(0);
#endif
        }
    }
}
