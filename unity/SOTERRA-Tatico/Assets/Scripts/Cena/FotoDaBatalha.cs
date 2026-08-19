using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using Soterra.Dados;
using Soterra.Grade;
#if UNITY_EDITOR
using UnityEditor;
using UnityEditor.SceneManagement;
#endif

namespace Soterra.Cena
{
    /// <summary>
    /// Fotografa a BATALHA montada: a sala real do calabouço, os heróis e os
    /// monstros nas casas de nascimento, e os três realces acesos.
    ///
    ///   Unity.exe -batchmode -quit -projectPath unity/SOTERRA-Tatico \
    ///     -executeMethod Soterra.Cena.FotoDaBatalha.Tirar \
    ///     -foto ..\foto-batalha.png
    ///
    /// SEM <c>-nographics</c>: sem dispositivo de vídeo a câmera não tem o que
    /// renderizar e o PNG sai preto. Já custou uma rodada a esta equipe.
    ///
    /// Tira DUAS fotos numa subida só, deitada e em pé, porque o destino é
    /// celular e a sala tem de caber nas duas — e porque abrir a Unity duas
    /// vezes custa mais que renderizar duas vezes.
    /// </summary>
    public static class FotoDaBatalha
    {
        /// <summary>A Estufa Soterrada. É o primeiro calabouço do jogo e a
        /// primeira sala dele — "O Vestíbulo das Heras", 21×17.</summary>
        public const string Calabouco = "greenhouse";
        public const int IndiceDaSala = 0;

        /// <summary>Os dois heróis que descem. Os mesmos do jogo em JS ao
        /// começar: o tanque e o dano de área.</summary>
        static readonly string[] Herois = { "sumo", "bruxo" };

        public static void Tirar()
        {
            string saida = Argumento("-foto", "foto-batalha.png");

#if UNITY_EDITOR
            // Cena vazia primeiro: em modo lote o Editor abre a última cena
            // gravada, e o tabuleiro do Bootstrap apareceria por baixo do meu.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
#endif

            var banco = BancoDeDados.CarregarDeResources();
            var calabouco = banco.AchaCalabouco(Calabouco);
            if (calabouco == null || calabouco.Salas.Count <= IndiceDaSala)
            {
                Debug.LogError("[SOTERRA] calabouço '" + Calabouco + "' sem a sala " + IndiceDaSala);
                Sair(2);
                return;
            }

            var sala = calabouco.Salas[IndiceDaSala];
            var mapa = sala.ParaMapa();

            var palco = new GameObject("Palco").AddComponent<Palco>();
            palco.Montar(mapa);                       // fora de Play, sem ninguém apertar nada

            var elenco = new Elenco(palco, banco);
            var fichas = Montar(banco, sala, mapa);
            elenco.Sincronizar(fichas);

            Acender(palco, banco, mapa, fichas);

            Debug.Log("[SOTERRA] batalha montada: " + fichas.Count + " unidades, " +
                      palco.Realcadas.Count + " casas realçadas, sala " + sala.Nome);

            var cam = palco.Camera;
            if (cam == null) { Debug.LogError("[SOTERRA] Palco não montou câmera."); Sair(2); return; }

            // As duas proporções de celular do contrato. A sala tem de caber nas
            // duas, e é fácil acertar uma e descobrir a outra tarde demais.
            Renderizar(palco, saida, 1600, 900);
            Renderizar(palco, Sufixo(saida, "-retrato"), 900, 1600);
            Sair(0);
        }

        // ================================================================ MONTAR

        /// <summary>
        /// PROVISÓRIO — isto é trabalho de <c>Soterra.Batalha.Montador.DeSala</c>
        /// (CONTRATO_UNITY_F2), que está sendo escrito por outro dono e ainda não
        /// existe nesta árvore. Fica aqui, e não no <see cref="Elenco"/>, porque
        /// o elenco DESENHA quem lhe mandam; quem decide quem entra é o jogo.
        ///
        /// Quando o Montador chegar, estas linhas viram uma só e a conversão de
        /// <c>Motor.Unidade</c> para <see cref="FichaDeUnidade"/>.
        /// </summary>
        static List<FichaDeUnidade> Montar(BancoDeDados banco, Dados.Sala sala, Mapa mapa)
        {
            var fichas = new List<FichaDeUnidade>();

            // A sala real traz SEIS 'P' e o jogo desce com DOIS heróis: os dois
            // primeiros nascimentos são ocupados e os outros quatro sobram, e
            // isso é correto (CONTRATO_UNITY_F2).
            for (int i = 0; i < Herois.Length && i < mapa.NascimentosHeroi.Count; i++)
                fichas.Add(new FichaDeUnidade
                {
                    Uid = "h" + i,
                    Id = Herois[i],
                    Heroi = true,
                    Casa = mapa.NascimentosHeroi[i],
                    Viva = true
                });

            // NascimentosMonstro é LISTA com repetição: os dois 'a' são dois
            // bichos do mesmo tipo, e um dicionário por letra engoliria o segundo.
            for (int i = 0; i < mapa.NascimentosMonstro.Count; i++)
            {
                var nasc = mapa.NascimentosMonstro[i];
                string id;
                if (sala.Monstros == null || !sala.Monstros.TryGetValue(nasc.Letra.ToString(), out id))
                    continue;

                Monstro bicho;
                bool chefe = banco.Monstros != null && banco.Monstros.TryGetValue(id, out bicho) &&
                             bicho != null && bicho.Chefe;

                fichas.Add(new FichaDeUnidade
                {
                    Uid = "m" + i,
                    Id = id,
                    Heroi = false,
                    Casa = nasc.Casa,
                    Viva = true,
                    Altura = chefe ? Elenco.AlturaDeChefe : 0f
                });
            }

            return fichas;
        }

        // =============================================================== REALCE

        /// <summary>
        /// Acende as três camadas, com os dados reais: o alcance de passo do
        /// tanque, as casas em que o feitiço do bruxo pode cair, e a área que ele
        /// pega na casa mirada.
        /// </summary>
        static void Acender(Palco palco, BancoDeDados banco, Mapa mapa, List<FichaDeUnidade> fichas)
        {
            var ocupadas = new List<Vector2Int>();
            foreach (var f in fichas) ocupadas.Add(f.Casa);

            // ---- PASSO: o tanque, com o PP da ficha da classe, não com um
            // número escolhido aqui.
            var tanque = fichas[0];
            Classe classe;
            int pp = banco.Classes != null && banco.Classes.TryGetValue(tanque.Id, out classe) &&
                     classe != null && classe.Atributos != null ? classe.Atributos.Pp : 3;
            var passo = Passo.Alcance(mapa, tanque.Casa, pp, ocupadas);
            palco.RealcarPasso(passo.Keys);

            // ---- ALVO: o feitiço-base do bruxo, com o alcance que está no
            // acervo. As paredes recortam o conjunto sozinhas, porque `los` é
            // verdadeiro — e é isso que faz a cobertura aparecer na foto.
            var conjurador = fichas.Count > 1 ? fichas[1] : fichas[0];
            var feitico = FeiticoDe(banco, conjurador.Id);
            if (feitico == null) return;

            var alcance = new Alcance(feitico.Alcance.Min, feitico.Alcance.Max,
                                      feitico.Alcance.Linha, feitico.Alcance.Visao);
            var alvos = new List<Vector2Int>(alcance.Casas(mapa, conjurador.Casa));
            var cor = CorDoElemento(banco, feitico.Elemento);
            palco.RealcarAlvo(alvos, cor);

            // ---- ÁREA: sobre a casa mirada. A mira é a casa VÁLIDA mais perto
            // de um monstro — escolher uma casa à mão daria uma foto bonita e
            // mentirosa, com a explosão fora do alcance do conjurador.
            var mira = MaisPertoDeUmMonstro(alvos, fichas);
            if (mira.HasValue && feitico.Area != null && !feitico.Area.ApenasAlvoUnico)
                palco.RealcarArea(Area.Casas(mapa, conjurador.Casa, mira.Value,
                                             feitico.Area.Forma, feitico.Area.Tamanho));
        }

        /// <summary>O primeiro feitiço de área da lista básica da classe — é o
        /// que mostra as três camadas de uma vez. Nulo se a classe só tem alvo
        /// único, e aí a foto sai com duas camadas em vez de três.</summary>
        static Feitico FeiticoDe(BancoDeDados banco, string idDaClasse)
        {
            Classe classe;
            if (banco.Classes == null || !banco.Classes.TryGetValue(idDaClasse, out classe) ||
                classe == null || classe.FeiticosBase == null) return null;

            Feitico primeiro = null;
            foreach (var idDoFeitico in classe.FeiticosBase)
            {
                var f = banco.AchaFeitico(idDoFeitico);
                if (f == null || f.Alcance == null) continue;
                if (primeiro == null) primeiro = f;
                if (f.Area != null && !f.Area.ApenasAlvoUnico) return f;
            }
            return primeiro;
        }

        static Vector2Int? MaisPertoDeUmMonstro(List<Vector2Int> alvos, List<FichaDeUnidade> fichas)
        {
            Vector2Int? melhor = null;
            int menor = int.MaxValue;
            foreach (var alvo in alvos)
                foreach (var f in fichas)
                {
                    if (f.Heroi) continue;
                    int d = Distancia.Manhattan(alvo, f.Casa);
                    if (d >= menor) continue;
                    menor = d;
                    melhor = alvo;
                }
            return melhor;
        }

        static Color CorDoElemento(BancoDeDados banco, string elemento)
        {
            InfoDeElemento info;
            Color c;
            if (banco.InfoDeElementos != null && elemento != null &&
                banco.InfoDeElementos.TryGetValue(elemento, out info) && info != null &&
                ColorUtility.TryParseHtmlString(info.Cor, out c))
                return c;
            return Palco.CorAlcance;
        }

        // =========================================================== RENDERIZAR

        static void Renderizar(Palco palco, string saida, int larg, int alt)
        {
            var cam = palco.Camera;

            // A proporção do PNG não é a da janela: sem reenquadrar com ela, o
            // mapa sai com as pontas cortadas.
            cam.aspect = larg / (float)alt;
            palco.Enquadrar();

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
            var pasta = Path.GetDirectoryName(caminho);
            if (!string.IsNullOrEmpty(pasta)) Directory.CreateDirectory(pasta);
            File.WriteAllBytes(caminho, tex.EncodeToPNG());
            Debug.Log("[SOTERRA] Foto da batalha em " + caminho + " (" + larg + "x" + alt + ")");
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
