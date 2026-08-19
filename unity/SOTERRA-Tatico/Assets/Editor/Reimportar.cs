using UnityEditor;
using UnityEngine;

namespace Soterra.Ferramentas
{
    /// <summary>
    /// Força a reimportação de um caminho de <c>Assets/</c> pelo modo lote.
    ///
    /// Existe por causa de um caso concreto: o conserto de material do elenco
    /// (textura homônima ao lado do FBX) acontece NO importador — e soltar o
    /// PNG ao lado não suja o FBX, então a Unity não o reimporta e o personagem
    /// continua fantasma. Sem esta porta, o único jeito seria clicar em
    /// Reimport no Editor, e ninguém aqui clica.
    ///
    /// Uso: -executeMethod Soterra.Ferramentas.Reimportar.Caminho -caminho Assets/...
    /// </summary>
    public static class Reimportar
    {
        public static void Caminho()
        {
            string alvo = null;
            var args = System.Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == "-caminho") alvo = args[i + 1];

            if (string.IsNullOrEmpty(alvo))
            {
                Debug.LogError("[SOTERRA] Reimportar: faltou -caminho Assets/...");
                if (Application.isBatchMode) EditorApplication.Exit(2);
                return;
            }

            AssetDatabase.ImportAsset(alvo,
                ImportAssetOptions.ForceUpdate | ImportAssetOptions.ImportRecursive);
            AssetDatabase.Refresh();
            Debug.Log("[SOTERRA] reimportado: " + alvo);
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }
    }
}
