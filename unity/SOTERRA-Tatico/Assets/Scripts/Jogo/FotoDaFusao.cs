using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using Soterra.Grade;
#if UNITY_EDITOR
using UnityEditor;
using UnityEditor.SceneManagement;
#endif

namespace Soterra.Jogo
{
    // Ver a nota em Partida.cs: os apelidos globais evitam o CS0234 dos
    // namespaces irmãos.
    using Motor = global::Soterra.Motor;
    using Dados = global::Soterra.Dados;
    using Cena = global::Soterra.Cena;

    /// <summary>
    /// Fotografa a FUSÃO em cena: a sala real da Estufa, os dois heróis
    /// colados, e — depois de declarar e encerrar o turno pela
    /// <see cref="Partida"/>, o mesmo caminho do dedo — a fundida sozinha no
    /// campo, com o convidado fora. Duas fotos, antes e depois, porque a prova
    /// visual da fusão É a diferença: dois corpos que viram um.
    ///
    ///   Unity.exe -batchmode -quit -projectPath unity/SOTERRA-Tatico \
    ///     -executeMethod Soterra.Jogo.FotoDaFusao.Tirar -foto ..\foto-fusao.png
    ///
    /// SEM <c>-nographics</c>: sem dispositivo de vídeo o PNG sai preto
    /// (CONTRATO_UNITY_F1 §3, já pago). O modelo da dupla ainda não existe em
    /// <c>Resources/elenco/&lt;dupla&gt;/</c>, então o carregador cai na
    /// cápsula — o que a foto prova é a TROCA (um corpo novo, o convidado
    /// fora), não o visual final.
    /// </summary>
    public static class FotoDaFusao
    {
        /// <summary>A mesma sala e a mesma dupla que o jogo abre — ver
        /// <see cref="JogoDeBatalha"/>.</summary>
        public const string Calabouco = JogoDeBatalha.CalaboucoPadrao;
        public const int IndiceDaSala = JogoDeBatalha.IndiceDaSalaPadrao;

        public static void Tirar()
        {
#if UNITY_EDITOR
            // Cena vazia primeiro: em modo lote o Editor abre a última cena
            // gravada, e o tabuleiro dela apareceria por baixo deste.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
#endif
            string saida = Argumento("-foto", "foto-fusao.png");

            var banco = Dados.BancoDeDados.CarregarDeResources();
            var calabouco = banco.AchaCalabouco(Calabouco);
            if (calabouco == null || calabouco.Salas.Count <= IndiceDaSala)
            {
                Debug.LogError("[SOTERRA] calabouço '" + Calabouco + "' sem a sala " + IndiceDaSala);
                Sair(2);
                return;
            }
            var sala = calabouco.Salas[IndiceDaSala];
            var mapa = sala.ParaMapa();

            // ---- a batalha: a dupla do jogo, COLADA de nascença. O jogo real
            // pede que o jogador ande até o aliado; a foto pula a caminhada
            // porque o que ela documenta é a fusão, não o passeio.
            var unidades = new List<Motor.Unidade>();
            var casaA = mapa.NascimentosHeroi[0];
            var casaB = VizinhaLivre(mapa, casaA);
            if (!casaB.HasValue)
            {
                Debug.LogError("[SOTERRA] o nascimento " + casaA + " não tem vizinha livre");
                Sair(2);
                return;
            }
            unidades.Add(Motor.Unidade.DeClasse(banco.Classes[JogoDeBatalha.HeroisPadrao[0]], "h1", casaA));
            unidades.Add(Motor.Unidade.DeClasse(banco.Classes[JogoDeBatalha.HeroisPadrao[1]], "h2", casaB.Value));

            for (int i = 0; i < mapa.NascimentosMonstro.Count; i++)
            {
                var nasc = mapa.NascimentosMonstro[i];
                string id;
                Dados.Monstro bicho;
                if (sala.Monstros != null && sala.Monstros.TryGetValue(nasc.Letra.ToString(), out id) &&
                    banco.Monstros.TryGetValue(id, out bicho) && bicho != null)
                    unidades.Add(Motor.Unidade.DeMonstro(bicho, "m" + i, nasc.Casa));
            }

            var batalha = new Motor.Batalha(banco, mapa, unidades, null,
                                            Motor.Sorte.DeTexto("soterra-foto-fusao"));
            var partida = new Partida(banco, batalha);

            // ---- o palco, com o tema certo da sala (a lição da Cisterna).
            var palco = new GameObject("Palco").AddComponent<Cena.Palco>();
            palco.Montar(mapa, Cena.TemaDoCenario.De(sala.TemaDeCenario ?? calabouco.Tema,
                                                     calabouco.Paleta));
            var elenco = new Cena.Elenco(palco, banco);
            elenco.Sincronizar(Fichas.De(batalha, banco));

            if (palco.Camera == null)
            {
                Debug.LogError("[SOTERRA] o palco montou sem câmera");
                Sair(2);
                return;
            }

            // ---- ANTES: a dupla colada, dois corpos.
            Renderizar(palco, Sufixo(saida, "-antes"), 1600, 900);

            // ---- a fusão, pelo caminho do dedo: turnos até um herói, o toque
            // de declarar, o toque de encerrar. Os turnos de monstro passam por
            // EncerrarTurno cru — sem IA a foto é a mesma em toda subida.
            for (int i = 0; i < 50 && !partida.TurnoDoJogador; i++) batalha.EncerrarTurno();
            var declaracao = partida.DeclararFusao();
            if (declaracao == null || !declaracao.Valido)
            {
                Debug.LogError("[SOTERRA] a declaração falhou: " +
                               (declaracao == null ? "não era jogada" : declaracao.Recusa));
                Sair(2);
                return;
            }
            partida.EncerrarTurno();

            var fundida = batalha.Acha(declaracao.Eventos[0].Uid);
            if (fundida == null || !fundida.EFusao)
            {
                Debug.LogError("[SOTERRA] a fusão não resolveu — a foto mentiria");
                Sair(2);
                return;
            }

            // O espelho de sempre: é ELE que troca o corpo e recolhe o convidado.
            elenco.Sincronizar(Fichas.De(batalha, banco));

            // O arsenal composto vai para o log — é a legenda da foto.
            var linhas = "[SOTERRA] fundida " + fundida.ClasseOuMonstroId +
                         " (uid " + fundida.Uid + ", nível " + fundida.Nivel + "), arsenal:";
            for (int i = 0; i < fundida.Feiticos.Count; i++)
            {
                var f = batalha.Feitico(fundida.Feiticos[i]);
                linhas += "\n  " + fundida.Feiticos[i] + " → " +
                          (f == null ? "(?)" : f.Nome + ", " + f.CustoDePa + " PA");
            }
            Debug.Log(linhas);

            // ---- DEPOIS: um corpo só, a casa do convidado livre.
            Renderizar(palco, saida, 1600, 900);
            Sair(0);
        }

        /// <summary>A primeira casa andável colada em <paramref name="casa"/> que
        /// nenhum nascimento de monstro ocupa.</summary>
        static Vector2Int? VizinhaLivre(Mapa mapa, Vector2Int casa)
        {
            var passos = new[]
            {
                new Vector2Int(1, 0), new Vector2Int(-1, 0),
                new Vector2Int(0, 1), new Vector2Int(0, -1)
            };
            for (int i = 0; i < passos.Length; i++)
            {
                var v = casa + passos[i];
                if (!mapa.Andavel(v)) continue;

                bool ocupada = false;
                for (int m = 0; m < mapa.NascimentosMonstro.Count; m++)
                    if (mapa.NascimentosMonstro[m].Casa == v) ocupada = true;
                if (!ocupada) return v;
            }
            return null;
        }

        // ---- cópias de FotoDaBatalha (dono: Designer/Cena) — duplicadas aqui
        // porque aquele arquivo é de outro dono, a mesma razão de LoteJogo ter
        // as suas. sRGB e reenquadre: armadilhas do contrato §3, já pagas.

        static void Renderizar(Cena.Palco palco, string saida, int larg, int alt)
        {
            var cam = palco.Camera;
            cam.aspect = larg / (float)alt;
            palco.Enquadrar();

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
            Debug.Log("[SOTERRA] Foto da fusão em " + caminho + " (" + larg + "x" + alt + ")");
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
        /// 0 sempre, e um erro aqui passaria batido em quem chamou.</summary>
        static void Sair(int codigo)
        {
#if UNITY_EDITOR
            if (Application.isBatchMode) EditorApplication.Exit(codigo);
#endif
        }
    }
}
