using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
using UnityEditor.SceneManagement;
#endif

namespace Soterra.Fx
{
    // Ver a nota em Partida.cs: os apelidos globais evitam o CS0234 dos
    // namespaces irmãos.
    using Motor = global::Soterra.Motor;
    using Dados = global::Soterra.Dados;
    using Cena = global::Soterra.Cena;
    using Jogo = global::Soterra.Jogo;

    /// <summary>
    /// Fotografa QUATRO famílias bem diferentes no meio do efeito, na sala real
    /// da Estufa, com o elenco em cena.
    ///
    ///   Unity.exe -batchmode -quit -projectPath unity/SOTERRA-Tatico \
    ///     -executeMethod Soterra.Fx.FotoDosEfeitos.Tirar -foto ..\foto-fx.png
    ///
    /// SEM <c>-nographics</c>: sem dispositivo de vídeo o PNG sai preto
    /// (CONTRATO_UNITY_F1 §3, já pago por esta equipe).
    ///
    /// O caminho fotografado é o DE PRODUÇÃO, e não um atalho: monta-se um
    /// <see cref="Motor.Evento"/> de Conjuração com o id de um feitiço REAL do
    /// acervo e entrega-se ao <see cref="Jogo.DespachoDeEfeitos"/>, que resolve
    /// o feitiço na batalha, deduz a família pelo <c>fxKey</c>, tira a cor do
    /// elemento e acende na casa. Uma foto que chamasse o pool direto provaria
    /// que as partículas existem — e não que o feitiço as acende.
    ///
    /// O instante de cada foto é escolhido, não sorteado: é o quadro em que a
    /// assinatura da família está aberta. Fotografar todas em 0,2 s daria quatro
    /// clarões parecidos e não provaria nada.
    /// </summary>
    public static class FotoDosEfeitos
    {
        public const string Calabouco = "greenhouse";
        public const int IndiceDaSala = 0;

        const float Quadro = 1f / 60f;

        sealed class Pose
        {
            public string Familia;

            /// <summary>Segundos até o clique. O meteoro precisa passar dos
            /// 0,45 s da queda, senão a foto pega o céu vazio.</summary>
            public float Instante;

            /// <summary>Casas entre quem conjura e o alvo. Zero mira em si
            /// mesmo — é o que a aura e a cura fazem.</summary>
            public int Distancia;
        }

        static readonly Pose[] Poses =
        {
            // Os instantes não são redondos: cada um é o pico de TAMANHO ×
            // OPACIDADE da forma da família, medido em LegibilidadeTests. A
            // primeira versão desta foto pegou o meteoro em 0,60 s, quando o
            // estouro tinha aberto só metade dos seus 7 m — e a imagem mostrava
            // um punhado de brasas em vez de um impacto.

            // Depois do baque, com a forma quase no tamanho cheio e ainda opaca.
            new Pose { Familia = FamiliaDeEfeito.Meteoro, Instante = 0.72f, Distancia = 5 },

            // O leque já varreu o caminho e a marca no chão está aberta.
            new Pose { Familia = FamiliaDeEfeito.Cone, Instante = 0.40f, Distancia = 5 },

            // Cedo: a coluna já subiu e a estrela ainda está OPACA. Em 0,52 s
            // ela já tinha perdido 60% da opacidade e a foto saía pálida — na
            // cura o pico de tamanho e o de opacidade não coincidem.
            new Pose { Familia = FamiliaDeEfeito.Cura, Instante = 0.30f, Distancia = 0 },

            // 1,25 s: o selo PLANTADO, opaco, girando devagar — dentro dos
            // 1,30 s de permanência. É o instante em que ela mais se parece com
            // o que é e menos com um estouro.
            new Pose { Familia = FamiliaDeEfeito.Armadilha, Instante = 1.25f, Distancia = 3 }
        };

        public static void Tirar()
        {
#if UNITY_EDITOR
            // Cena vazia primeiro: em modo lote o Editor abre a última cena
            // gravada, e o tabuleiro dela apareceria por baixo deste.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
#endif
            string saida = Argumento("-foto", "foto-fx.png");

            var banco = Dados.BancoDeDados.CarregarDeResources();
            var calabouco = banco.AchaCalabouco(Calabouco);
            if (calabouco == null || calabouco.Salas.Count <= IndiceDaSala)
            {
                Debug.LogError("[SOTERRA/FX] calabouço '" + Calabouco + "' sem a sala " + IndiceDaSala);
                Sair(2);
                return;
            }

            var sala = calabouco.Salas[IndiceDaSala];
            var batalha = global::Soterra.Batalha.Montador.DeSala(
                banco, Calabouco, IndiceDaSala, Jogo.JogoDeBatalha.HeroisPadrao);

            var palco = new GameObject("Palco").AddComponent<Cena.Palco>();
            palco.Montar(batalha.Mapa,
                         Cena.TemaDoCenario.De(sala.TemaDeCenario ?? calabouco.Tema, calabouco.Paleta));
            var elenco = new Cena.Elenco(palco, banco);
            elenco.Sincronizar(Jogo.Fichas.De(batalha, banco));

            if (palco.Camera == null)
            {
                Debug.LogError("[SOTERRA/FX] o palco montou sem câmera");
                Sair(2);
                return;
            }

            var despacho = new Jogo.DespachoDeEfeitos(palco, batalha, banco);
            var conjurador = PrimeiroHeroi(batalha);
            if (conjurador == null)
            {
                Debug.LogError("[SOTERRA/FX] a sala subiu sem herói para conjurar");
                Sair(2);
                return;
            }

            for (int i = 0; i < Poses.Length; i++)
            {
                var pose = Poses[i];
                var feitico = FeiticoDaFamilia(banco, pose.Familia);
                if (feitico == null)
                {
                    Debug.LogError("[SOTERRA/FX] o acervo não tem feitiço da família '" +
                                   pose.Familia + "' — a foto mentiria sobre o caminho real");
                    Sair(2);
                    return;
                }

                var alvo = CasaAlvo(batalha, conjurador.Casa, pose.Distancia);

                // Um efeito por foto: sem isto, o rastro do anterior apareceria
                // na imagem seguinte e a comparação entre famílias não valeria.
                despacho.Limpar();

                var r = new Motor.Resultado();
                r.Eventos.Add(new Motor.Evento
                {
                    Tipo = Motor.TipoDeEvento.Conjuracao,
                    Uid = conjurador.Uid,
                    FeiticoId = feitico.Id,
                    Elemento = feitico.Elemento,
                    De = conjurador.Casa,
                    Para = alvo
                });

                // Um feitiço de cura emite DOIS eventos no motor: a conjuração e
                // a cura de cada alvo. A primeira versão desta foto só mandava a
                // conjuração, e como `warmHand` é de elemento NEUTRO a imagem
                // saiu cinza — sem o verde que é o sinal de "ganhei vida". A
                // foto tem de mostrar o que o jogador vê, e o jogador vê os dois.
                if (pose.Familia == FamiliaDeEfeito.Cura)
                    r.Eventos.Add(new Motor.Evento
                    {
                        Tipo = Motor.TipoDeEvento.Cura,
                        Uid = conjurador.Uid,
                        FeiticoId = feitico.Id,
                        Quantidade = 12
                    });

                despacho.Reagir(r);

                // O tempo anda na mão: fora de Play nada avança sozinho, e é
                // exatamente isso que permite parar no quadro escolhido.
                for (float t = 0f; t < pose.Instante; t += Quadro) despacho.Avancar(Quadro);

                Debug.Log("[SOTERRA/FX] " + pose.Familia + ": feitiço '" + feitico.Id +
                          "' (fxKey '" + feitico.ChaveDeEfeito + "', elemento " +
                          feitico.Elemento + "), de " + conjurador.Casa + " para " + alvo +
                          ", em " + pose.Instante.ToString("0.00") + " s, " +
                          despacho.Efeitos.ParticulasVivas() + " partículas no ar");

                Enquadrar(palco, conjurador.Casa, alvo, 1280f / 800f);
                Renderizar(palco, Sufixo(saida, "-" + pose.Familia), 1280, 800);
            }

            Sair(0);
        }

        // ================================================================ APOIO

        static Motor.Unidade PrimeiroHeroi(Motor.Batalha b)
        {
            for (int i = 0; i < b.Unidades.Count; i++)
                if (b.Unidades[i] != null && b.Unidades[i].NoTabuleiro &&
                    b.Unidades[i].Lado == Motor.Lado.Heroi) return b.Unidades[i];
            return null;
        }

        /// <summary>
        /// Um feitiço REAL do acervo cuja chave cai na família pedida. Procurado
        /// e não cravado: um id cravado apodrece na primeira vez que o Criativo
        /// renomear um feitiço, e a foto passaria a fotografar a família errada
        /// sem avisar.
        /// </summary>
        static Dados.Feitico FeiticoDaFamilia(Dados.BancoDeDados banco, string familia)
        {
            var tabelas = new List<IDictionary<string, Dados.Feitico>>
            {
                banco.Feiticos, banco.FeiticosDeMonstro, banco.FeiticosDeItem
            };
            for (int t = 0; t < tabelas.Count; t++)
            {
                if (tabelas[t] == null) continue;
                foreach (var f in tabelas[t].Values)
                {
                    if (f == null || string.IsNullOrEmpty(f.ChaveDeEfeito)) continue;
                    if (FamiliaDeEfeito.DeChave(f.ChaveDeEfeito) == familia) return f;
                }
            }
            return null;
        }

        /// <summary>Uma casa andável a <paramref name="distancia"/> passos da
        /// origem. Anda em linha e recua se esbarrar — a foto não pode falhar
        /// por causa de uma parede.</summary>
        static Vector2Int CasaAlvo(Motor.Batalha b, Vector2Int origem, int distancia)
        {
            if (distancia <= 0) return origem;

            var direcoes = new[]
            {
                new Vector2Int(1, 0), new Vector2Int(0, 1),
                new Vector2Int(-1, 0), new Vector2Int(0, -1)
            };
            for (int d = 0; d < direcoes.Length; d++)
                for (int passo = distancia; passo >= 1; passo--)
                {
                    var casa = origem + direcoes[d] * passo;
                    if (b.Mapa.Andavel(casa)) return casa;
                }
            return origem;
        }

        /// <summary>
        /// Aproxima a câmera no efeito. O enquadramento do palco mostra a sala
        /// inteira, e numa sala de 21×17 um efeito de 5 m sai com o tamanho de
        /// uma moeda — a foto provaria que aconteceu algo, não O QUÊ.
        /// </summary>
        static void Enquadrar(Cena.Palco palco, Vector2Int origem, Vector2Int alvo, float larguraAlta)
        {
            // A proporção ANTES do enquadramento: o Palco calcula o zoom com o
            // `aspect` que encontrar, e uma câmera recém-criada em modo lote
            // devolve o da janela inexistente.
            var cam = palco.Camera;
            cam.aspect = larguraAlta;
            palco.Enquadrar();
            if (!cam.orthographic) return;

            var a = palco.Mundo(origem, 0f);
            var b = palco.Mundo(alvo, 0f);
            var centro = Vector3.Lerp(a, b, 0.5f) + Vector3.up * 1.4f;

            // Recua pela ROTAÇÃO da câmera, e reabre os planos de corte.
            // Primeira tentativa desta foto: mantive o corte que o Palco tinha
            // deixado (`far = distância + profundidade + 10`, apertado de
            // propósito para não apagar as sombras do URP) e afastei a câmera
            // 40 m — o tabuleiro saiu ATRÁS do plano distante e a foto veio com
            // uma faixa de parede num canto e mais nada. Quem afasta a câmera
            // tem de reabrir o corte junto.
            const float Recuo = 60f;
            cam.orthographicSize = Mathf.Max(4.5f, Vector3.Distance(a, b) * 0.55f + 3.4f);
            cam.transform.position = centro - cam.transform.rotation * Vector3.forward * Recuo;
            cam.nearClipPlane = 0.1f;
            cam.farClipPlane = Recuo * 2.4f;

            var noQuadro = cam.WorldToViewportPoint(centro);
            if (noQuadro.x < 0.2f || noQuadro.x > 0.8f || noQuadro.y < 0.2f || noQuadro.y > 0.8f)
                Debug.LogWarning("[SOTERRA/FX] o efeito caiu em " + noQuadro +
                                 " do quadro — a foto o mostraria na beirada");
        }

        // ---- cópias de FotoDaFusao (dono: Jogo) — duplicadas aqui porque
        // aquele arquivo é de outro papel nesta rodada. sRGB e reenquadre são
        // armadilhas do contrato §3, já pagas.

        static void Renderizar(Cena.Palco palco, string saida, int larg, int alt)
        {
            var cam = palco.Camera;
            cam.aspect = larg / (float)alt;

            // RenderTextureReadWrite.sRGB: o padrão é LINEAR e o ReadPixels não
            // converte — o PNG sairia escuro e lavado (CONTRATO_UNITY_F1 §3).
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
            Debug.Log("[SOTERRA/FX] foto em " + caminho + " (" + larg + "x" + alt + ")");
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
