using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEngine.UIElements;
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
    using IA = global::Soterra.IA;
    using Interface = global::Soterra.Interface;
    using Progressao = global::Soterra.Progressao;

    /// <summary>
    /// Fotografa o LAÇO: a tela de recompensa com dados de verdade (a XP que a
    /// sala pagou, o nível, o saque que caiu) e a SEGUNDA sala montada com os
    /// heróis vindos da progressão — nível, feitiços liberados e o PV castigado
    /// da sala anterior.
    ///
    ///   Unity.exe -batchmode -quit -projectPath unity/SOTERRA-Tatico \
    ///     -executeMethod Soterra.Jogo.FotoDaDescida.Tirar -foto ..\foto-descida.png
    ///
    /// SEM <c>-nographics</c>: sem dispositivo de vídeo o PNG sai preto
    /// (CONTRATO_UNITY_F1 §3, já pago).
    ///
    /// A sala 0 é jogada por IA DOS DOIS LADOS (o <c>Cerebro.JogarTurno</c> age
    /// sobre a unidade da vez, seja de que lado for). É o mesmo caminho do
    /// <c>DeterminismoTests</c>, e é o que faz a recompensa da foto ser real:
    /// uma recompensa montada à mão fotografaria uma tela bonita que o jogo
    /// nunca produz.
    /// </summary>
    public static class FotoDaDescida
    {
        public const string Calabouco = JogoDeBatalha.CalaboucoPadrao;

        /// <summary>O grupo da foto: as duas classes que o acervo libera de
        /// início — as mesmas com que o jogo abre.</summary>
        public static readonly string[] Grupo = { "sumo", "curandeira" };

        /// <summary>
        /// Quantos pixels da foto vale 1 ponto da interface.
        ///
        /// No aparelho o painel é `ConstantPhysicalSize` e lê o DPI da tela: 1
        /// px do USS vira 1 ponto físico, e os 44 do `.alvo` viram 7 mm de
        /// verdade. Em modo lote isso não funciona — a primeira foto saiu com a
        /// interface encolhida a 60%, e mexer no `fallbackDpi` não mudou nada
        /// (o batchmode informa um DPI, só que o da máquina). A foto então usa
        /// `ConstantPixelSize` com escala fixa: 2,5 é a razão de um celular de
        /// ~400 dpi, e é o tamanho que o dedo vai encontrar.
        ///
        /// Vale SÓ para a foto. O jogo continua em `ConstantPhysicalSize`, que
        /// é o único modo que garante o milímetro em aparelho desconhecido.
        /// </summary>
        public const float EscalaDaFoto = 2.5f;

        /// <summary>
        /// Nível do grupo na foto: o mais alto que a Estufa ainda paga por
        /// INTEIRO (o <c>recommendedLevel</c> dela mais os <c>graceLevels</c>).
        ///
        /// Dois motivos, e os dois são sobre a foto não mentir. É preciso VENCER
        /// a sala para haver recompensa que fotografar, e a IA jogando por
        /// heróis crus tomba; e acima desta faixa o corte de XP de §9-D entra —
        /// a primeira tentativa foi com nível 20 e a tela saiu honesta e inútil,
        /// anunciando "+0 XP" em letras grandes.
        /// </summary>
        static int NivelDoGrupo(Dados.BancoDeDados banco)
        {
            var calabouco = banco.AchaCalabouco(Calabouco);
            var queda = banco.Nivelamento == null ? null : banco.Nivelamento.QuedaDeXp;
            if (calabouco == null) return 1;
            return Mathf.Max(1, calabouco.NivelRecomendado + (queda != null ? queda.NiveisDeGraca : 0));
        }

        /// <summary>Teto de turnos da sala fotografada. Rede contra um laço que
        /// travaria o lote em silêncio.</summary>
        const int TetoDeTurnos = 400;

        /// <summary>
        /// Abre o Editor em PLAY e deixa <see cref="FotoDaDescidaEmPlay"/> tirar
        /// as fotos.
        ///
        /// Play e não o lote de sempre por um motivo medido: fora de Play o UI
        /// Toolkit não roda o laço que repinta os painéis de EXECUÇÃO. O
        /// tabuleiro sai (a câmera desenha quando mandam), mas a tela de fluxo
        /// sai com zero pixels — foi o que a primeira tentativa registrou no
        /// log, "tela de fluxo: 0 de 1440000 pixels desenhados". Em Play o
        /// painel se desenha sozinho no fim do quadro, e aí há o que fotografar.
        ///
        /// Chamar SEM <c>-quit</c>: com ele o Editor sai antes de o Play
        /// começar. Quem encerra o processo é o próprio componente, com o código
        /// de saída certo.
        /// </summary>
        public static void TirarEmPlay()
        {
#if UNITY_EDITOR
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("FotoDaDescida").AddComponent<FotoDaDescidaEmPlay>();
            EditorApplication.EnterPlaymode();
#else
            Debug.LogError("[SOTERRA] TirarEmPlay só existe no Editor");
#endif
        }

        /// <summary>
        /// Tira as fotos SEM Play. Continua servindo ao tabuleiro — a foto da
        /// sala montada é fiel —, mas a tela de fluxo sai vazia; ver
        /// <see cref="TirarEmPlay"/>.
        /// </summary>
        public static void Tirar()
        {
#if UNITY_EDITOR
            // Cena vazia primeiro: em modo lote o Editor abre a última cena
            // gravada, e o tabuleiro dela apareceria por baixo deste.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
#endif
            string saida = Argumento("-foto", "foto-descida.png");

            var banco = Dados.BancoDeDados.CarregarDeResources();
            var armazem = new Progressao.ArmazemDeMemoria();
            var progresso = Progressao.Progresso.DoZero(banco, armazem);

            PrepararGrupo(progresso);

            var expedicao = Expedicao.Comecar(progresso, Calabouco, Grupo, "foto-da-descida", armazem);
            if (expedicao == null)
            {
                Debug.LogError("[SOTERRA] a descida de '" + Calabouco + "' não abriu");
                Sair(2);
                return;
            }

            // ---- sala 0, jogada por IA dos dois lados até acabar
            if (!JogarSala(banco, expedicao.Partida))
            {
                Debug.LogError("[SOTERRA] a sala 0 não terminou em " + TetoDeTurnos + " turnos");
                Sair(2);
                return;
            }
            if (expedicao.Partida.Batalha.Fase != Motor.FaseDaBatalha.Vitoria)
            {
                Debug.LogError("[SOTERRA] o grupo tombou na sala 0 — sem vitória não há " +
                               "recompensa para fotografar");
                Sair(2);
                return;
            }

            expedicao.ConferirFimDaSala();

            // O nível 20 deve a escolha de caminho: ela vem ANTES da recompensa,
            // e a foto documenta as duas telas.
            var palco = new GameObject("Palco").AddComponent<Cena.Palco>();
            MontarPalco(palco, banco, expedicao);
            var elenco = new Cena.Elenco(palco, banco);
            elenco.Sincronizar(Fichas.De(expedicao.Partida.Batalha, banco));

            if (expedicao.Passo == PassoDaExpedicao.EscolhaDeElemento)
            {
                Fotografar(palco, QuadroDe(progresso, expedicao), Sufixo(saida, "-caminho"), 900, 1600);
                while (expedicao.Passo == PassoDaExpedicao.EscolhaDeElemento)
                {
                    var q = QuadroDe(progresso, expedicao);
                    if (q.Elementos.Count == 0) break;
                    expedicao.EscolherElemento(expedicao.HeroiDaEscolha, q.Elementos[0].Id);
                }
            }

            if (expedicao.Passo != PassoDaExpedicao.Recompensa)
            {
                Debug.LogError("[SOTERRA] depois da vitória o passo é " + expedicao.Passo +
                               " e não a recompensa");
                Sair(2);
                return;
            }

            var recompensa = expedicao.Recompensa;
            Debug.Log("[SOTERRA] recompensa da sala 0: XP da sala " + recompensa.XpDaSala +
                      ", " + recompensa.Itens.Count + " peça(s), " + recompensa.Pedras.Count +
                      " tipo(s) de pedra, subidas: " + recompensa.Subidas.Count);

            // ---- FOTO 1: a tela de recompensa, em pé e deitada.
            Fotografar(palco, QuadroDe(progresso, expedicao), Sufixo(saida, "-recompensa"), 900, 1600);
            Fotografar(palco, QuadroDe(progresso, expedicao),
                       Sufixo(saida, "-recompensa-deitada"), 1600, 900);

            // ---- a sala 1, montada pelo mesmo caminho do jogo
            if (!expedicao.Descer())
            {
                Debug.LogError("[SOTERRA] o 'Descer' não levou à sala seguinte");
                Sair(2);
                return;
            }

            var pvs = new List<string>();
            foreach (var par in expedicao.PvDeEntrada) pvs.Add(par.Key + " " + par.Value);
            Debug.Log("[SOTERRA] sala " + expedicao.IndiceDaSala + " montada; PV de entrada: " +
                      string.Join(", ", pvs.ToArray()));
            foreach (var u in expedicao.Partida.Batalha.Unidades)
            {
                if (u.Lado != Motor.Lado.Heroi) continue;
                Debug.Log("[SOTERRA] herói em campo: " + u.ClasseOuMonstroId + " nível " + u.Nivel +
                          ", " + u.PV + "/" + u.PVMax + " PV, elemento " + u.Elemento +
                          ", " + u.Feiticos.Count + " feitiços");
            }

            MontarPalco(palco, banco, expedicao);
            elenco = new Cena.Elenco(palco, banco);
            elenco.Sincronizar(Fichas.De(expedicao.Partida.Batalha, banco));

            // ---- FOTO 2: o tabuleiro da segunda sala, sem tela por cima.
            Fotografar(palco, null, saida, 1600, 900);
            Sair(0);
        }

        // ============================================================= MONTAGEM

        /// <summary>
        /// Leva o grupo ao nível e veste a melhor peça de cada espaço — a peça é
        /// escolhida do ACERVO na hora, nunca por id cravado. Sem isto a IA
        /// jogando por heróis crus perde a sala e não há recompensa nenhuma para
        /// fotografar.
        /// </summary>
        internal static void PrepararGrupo(Progressao.Progresso progresso)
        {
            var nivel = NivelDoGrupo(progresso.Banco);
            var tabela = progresso.Banco.Nivelamento.TabelaDeXp;
            var alvo = tabela != null && tabela.Count >= nivel ? tabela[nivel - 1] : 0;

            for (int i = 0; i < Grupo.Length; i++)
            {
                var h = progresso.Heroi(Grupo[i]);
                if (h != null && alvo > h.Xp) progresso.AdicionarXp(Grupo[i], alvo - h.Xp);
            }

            var espacos = Progressao.Progresso.Espacos;
            for (int s = 0; s < espacos.Length; s++)
            {
                string melhor = null;
                int melhorNota = -1;
                foreach (var par in progresso.Banco.Itens)
                {
                    var item = par.Value;
                    if (item == null || item.Espaco != espacos[s] || item.Bonus == null) continue;
                    var nota = item.Bonus.Pv + item.Bonus.Poder * 10 +
                               item.Bonus.Pa * 50 + item.Bonus.Pp * 30;
                    if (nota > melhorNota) { melhorNota = nota; melhor = par.Key; }
                }
                if (melhor == null) continue;

                for (int h = 0; h < Grupo.Length; h++)
                {
                    progresso.AdicionarItem(melhor);
                    progresso.Equipar(Grupo[h], melhor);
                }
            }
        }

        /// <summary>O palco com o tema da sala corrente — a lição da Cisterna: a
        /// sala pode destoar do calabouço (<c>sceneryTheme</c>).</summary>
        internal static void MontarPalco(Cena.Palco palco, Dados.BancoDeDados banco, Expedicao expedicao)
        {
            var calabouco = expedicao.DadosDoCalabouco;
            var sala = calabouco.Salas[expedicao.IndiceDaSala];
            palco.Montar(expedicao.Partida.Batalha.Mapa,
                         Cena.TemaDoCenario.De(sala.TemaDeCenario ?? calabouco.Tema,
                                               calabouco.Paleta));
        }

        /// <summary>A batalha jogada por IA dos DOIS lados, um turno por vez.</summary>
        internal static bool JogarSala(Dados.BancoDeDados banco, Partida partida)
        {
            var cerebro = new IA.Cerebro(banco, partida.Batalha, Motor.Sorte.DeTexto("foto-ia"));
            for (int i = 0; i < TetoDeTurnos && !partida.Acabou; i++) cerebro.JogarTurno();
            return partida.Acabou;
        }

        internal static Interface.QuadroDeFluxo QuadroDe(Progressao.Progresso progresso, Expedicao e)
        {
            return Interface.PonteDaDescida.Quadro(progresso, e.Descida, e.Recompensa,
                                                   TipoDaTela(e.Passo), e.HeroiDaEscolha);
        }

        internal static Interface.TipoDeFluxo TipoDaTela(PassoDaExpedicao passo)
        {
            switch (passo)
            {
                case PassoDaExpedicao.EscolhaDeElemento: return Interface.TipoDeFluxo.EscolhaDeElemento;
                case PassoDaExpedicao.Recompensa: return Interface.TipoDeFluxo.Recompensa;
                case PassoDaExpedicao.CalaboucoConcluido: return Interface.TipoDeFluxo.CalaboucoConcluido;
                case PassoDaExpedicao.Derrota: return Interface.TipoDeFluxo.Derrota;
                default: return Interface.TipoDeFluxo.Nenhum;
            }
        }

        // ================================================================ FOTO

        /// <summary>
        /// Fotografa a câmera do palco e, quando há quadro, a tela de fluxo por
        /// cima — em DUAS texturas, compostas em CPU pelo alfa.
        ///
        /// Compor à mão em vez de deixar o painel desenhar sobre a mesma
        /// textura: fora de Play o UI Toolkit não roda o laço que repinta os
        /// painéis de execução, e a ordem entre o <c>Camera.Render</c> e o
        /// desenho do painel não é garantida. Com duas leituras e uma mistura
        /// por alfa, o resultado não depende de ordem nenhuma.
        /// </summary>
        static void Fotografar(Cena.Palco palco, Interface.QuadroDeFluxo quadro,
                               string saida, int larg, int alt)
        {
            var fundo = RenderizarPalco(palco, larg, alt);
            var frente = quadro == null ? null : RenderizarFluxo(quadro, larg, alt);
            var final = frente == null ? fundo : Compor(fundo, frente);

            var caminho = Path.GetFullPath(saida);
            var pasta = Path.GetDirectoryName(caminho);
            if (!string.IsNullOrEmpty(pasta)) Directory.CreateDirectory(pasta);
            File.WriteAllBytes(caminho, final.EncodeToPNG());
            Debug.Log("[SOTERRA] Foto em " + caminho + " (" + larg + "x" + alt + ")");
        }

        internal static Texture2D RenderizarPalco(Cena.Palco palco, int larg, int alt)
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

            var tex = Ler(rt, larg, alt, TextureFormat.RGB24);
            rt.Release();
            return tex;
        }

        /// <summary>
        /// A tela de fluxo desenhada numa textura própria, com fundo
        /// TRANSPARENTE — é o alfa dela que a composição usa.
        /// </summary>
        static Texture2D RenderizarFluxo(Interface.QuadroDeFluxo quadro, int larg, int alt)
        {
            var painel = ScriptableObject.CreateInstance<PanelSettings>();
            painel.name = "painel-de-foto";
            painel.themeStyleSheet = Resources.Load<ThemeStyleSheet>(
                Interface.HudDeBatalha.RecursoDoTema);
            painel.scaleMode = PanelScaleMode.ConstantPixelSize;
            painel.scale = EscalaDaFoto;
            painel.clearColor = true;
            painel.colorClearValue = new Color(0f, 0f, 0f, 0f);

            var rt = new RenderTexture(larg, alt, 24, RenderTextureFormat.ARGB32,
                                       RenderTextureReadWrite.sRGB);
            rt.Create();
            painel.targetTexture = rt;

            var go = new GameObject("FluxoDaFoto");
            var doc = go.AddComponent<UIDocument>();
            doc.panelSettings = painel;

            var tela = Interface.TelaDeFluxo.Carregar();
            doc.rootVisualElement.Add(tela.Raiz);
            tela.Montar(quadro);
            tela.AplicarOrientacao(larg, alt);

            // O painel de execução só se repinta dentro do laço do player. Fora
            // de Play ele não roda sozinho — estas chamadas o giram à mão, e as
            // repetições existem porque o primeiro passo só resolve o layout.
            for (int i = 0; i < 6; i++)
            {
                tela.Raiz.MarkDirtyRepaint();
#if UNITY_EDITOR
                EditorApplication.QueuePlayerLoopUpdate();
#endif
            }

            var tex = Ler(rt, larg, alt, TextureFormat.RGBA32);

            painel.targetTexture = null;
            Descartar(go);
            Descartar(painel);
            rt.Release();
            Descartar(rt);

            Debug.Log("[SOTERRA] tela de fluxo: " + Pintados(tex) + " de " + (larg * alt) +
                      " pixels desenhados");
            return tex;
        }

        internal static Texture2D Ler(RenderTexture rt, int larg, int alt, TextureFormat formato)
        {
            var antes = RenderTexture.active;
            RenderTexture.active = rt;
            var tex = new Texture2D(larg, alt, formato, false);
            tex.ReadPixels(new Rect(0, 0, larg, alt), 0, 0);
            tex.Apply();
            RenderTexture.active = antes;
            return tex;
        }

        internal static int Pintados(Texture2D tex)
        {
            var cores = tex.GetPixels32();
            int n = 0;
            for (int i = 0; i < cores.Length; i++) if (cores[i].a > 0) n++;
            return n;
        }

        /// <summary>Mistura a frente sobre o fundo pelo alfa da frente.</summary>
        internal static Texture2D Compor(Texture2D fundo, Texture2D frente)
        {
            var atras = fundo.GetPixels32();
            var cima = frente.GetPixels32();
            var saida = new Color32[atras.Length];

            for (int i = 0; i < atras.Length && i < cima.Length; i++)
            {
                float a = cima[i].a / 255f;
                saida[i] = new Color32(
                    (byte)(cima[i].r * a + atras[i].r * (1f - a)),
                    (byte)(cima[i].g * a + atras[i].g * (1f - a)),
                    (byte)(cima[i].b * a + atras[i].b * (1f - a)),
                    255);
            }

            var tex = new Texture2D(fundo.width, fundo.height, TextureFormat.RGB24, false);
            tex.SetPixels32(saida);
            tex.Apply();
            return tex;
        }

        // =============================================================== APOIO

        internal static void Descartar(UnityEngine.Object alvo)
        {
            if (alvo == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(alvo);
            else UnityEngine.Object.DestroyImmediate(alvo);
        }

        internal static string Sufixo(string caminho, string sufixo)
        {
            var pasta = Path.GetDirectoryName(caminho) ?? "";
            return Path.Combine(pasta,
                Path.GetFileNameWithoutExtension(caminho) + sufixo + Path.GetExtension(caminho));
        }

        internal static string Argumento(string nome, string padrao)
        {
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == nome) return args[i + 1];
            return padrao;
        }

        /// <summary>Código de saída explícito: com -quit sozinho a Unity devolve
        /// 0 sempre, e um erro aqui passaria batido em quem chamou.</summary>
        internal static void Sair(int codigo)
        {
#if UNITY_EDITOR
            if (Application.isBatchMode) EditorApplication.Exit(codigo);
#endif
        }
    }
}
