using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
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
    using Grade = global::Soterra.Grade;

    /// <summary>
    /// Fotografa o PILOTO do elenco definitivo em jogo: a sala real da Estufa,
    /// o grupo do jogo (<c>sumo</c> + <c>bruxo</c>), e o bruxo — o primeiro
    /// personagem gerado — ANDANDO e CONJURANDO pela <see cref="Partida"/>, o
    /// mesmo caminho do dedo. Saem três quadros do meio do walk, uma tira de
    /// oito quadros do ciclo, e um quadro do attack.
    ///
    ///   Unity.exe -batchmode -quit -projectPath unity/SOTERRA-Tatico \
    ///     -executeMethod Soterra.Jogo.FotoDaAnimacao.Tirar -foto ..\foto-bruxo.png
    ///
    /// SEM <c>-nographics</c>: sem dispositivo de vídeo o PNG sai preto
    /// (CONTRATO_UNITY_F1 §3, já pago). O tempo anda por
    /// <see cref="AnimacaoDoElenco.Avancar"/> na mão, fora de Play — exatamente
    /// como os testes provam o deslize; a foto prova que os OSSOS acompanham.
    /// </summary>
    public static class FotoDaAnimacao
    {
        /// <summary>O quadro do lote: 30 por segundo, como um vídeo.</summary>
        const float QuadroDeTempo = 1f / 30f;

        public static void Tirar()
        {
#if UNITY_EDITOR
            // Cena vazia primeiro: em modo lote o Editor abre a última cena
            // gravada, e o tabuleiro dela apareceria por baixo deste.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
#endif
            string saida = Argumento("-foto", "foto-bruxo.png");

            var banco = Dados.BancoDeDados.CarregarDeResources();
            var calabouco = banco.AchaCalabouco(JogoDeBatalha.CalaboucoPadrao);
            if (calabouco == null || calabouco.Salas.Count <= JogoDeBatalha.IndiceDaSalaPadrao)
            {
                Falhar("calabouço '" + JogoDeBatalha.CalaboucoPadrao + "' sem a sala " +
                       JogoDeBatalha.IndiceDaSalaPadrao);
                return;
            }
            var sala = calabouco.Salas[JogoDeBatalha.IndiceDaSalaPadrao];

            // A batalha REAL do jogo, montada como o Play monta.
            var batalha = global::Soterra.Batalha.Montador.DeSala(
                banco, JogoDeBatalha.CalaboucoPadrao, JogoDeBatalha.IndiceDaSalaPadrao, JogoDeBatalha.HeroisPadrao);
            var partida = new Partida(banco, batalha, Motor.Sorte.DeTexto("soterra-foto-animacao"));

            var palco = new GameObject("Palco").AddComponent<Cena.Palco>();
            palco.Montar(batalha.Mapa,
                         Cena.TemaDoCenario.De(sala.TemaDeCenario ?? calabouco.Tema,
                                               calabouco.Paleta));
            var elenco = new Cena.Elenco(palco, banco);
            var animacao = new AnimacaoDoElenco(elenco, palco, batalha);

            if (palco.Camera == null) { Falhar("o palco montou sem câmera"); return; }

            Espelhar(animacao, elenco, banco, batalha, batalha.Abertura);

            // ---- a vez do bruxo. Os outros turnos passam por EncerrarTurno
            // cru, como na FotoDaFusao: sem IA, ninguém mexe no tabuleiro.
            if (!AteVezDe(batalha, "bruxo")) { Falhar("o bruxo nunca chegou a jogar"); return; }
            var bruxo = batalha.Atual;
            Espelhar(animacao, elenco, banco, batalha, null);

            var raiz = elenco.ObjetoDe(bruxo.Uid);
            var animator = raiz != null ? raiz.GetComponentInChildren<Animator>(true) : null;
            if (animator == null || animator.runtimeAnimatorController == null)
            {
                Falhar("o bruxo entrou SEM Animator — o modelo de Resources/elenco/bruxo " +
                       "não carregou ou está sem clipes");
                return;
            }

            // A medida CRUA do FBX vai para o log: é o que o usuário precisa
            // saber sobre a exportação do Meshy antes de gerar os outros vinte.
            var cru = Resources.Load<GameObject>(
                Cena.ModelosDeResources.Pasta + "/bruxo/bruxo");
            if (cru != null)
            {
                var pele = cru.GetComponentInChildren<SkinnedMeshRenderer>(true);
                Debug.Log("[SOTERRA] bruxo.fbx cru: escala da raiz " +
                          cru.transform.localScale.ToString("0.###") + ", rotação " +
                          cru.transform.localRotation.eulerAngles.ToString("0.#") +
                          (pele != null && pele.sharedMesh != null
                               ? ", caixa da malha " + pele.sharedMesh.bounds.size.ToString("0.##") +
                                 " m, pé em y=" + pele.sharedMesh.bounds.min.y.ToString("0.###")
                               : ""));
            }

            // ---- o passeio: a casa alcançável mais perto do monstro mais
            // próximo (desempate: caminho mais longo, que rende mais quadros).
            var destino = DestinoDePasseio(batalha);
            if (!destino.HasValue) { Falhar("o bruxo não tem para onde andar"); return; }
            var passo = partida.TocarCasa(destino.Value);
            if (passo == null || !passo.Valido)
            {
                Falhar("o passo foi recusado: " + (passo == null ? "não era jogada" : passo.Recusa));
                return;
            }
            Espelhar(animacao, elenco, banco, batalha, passo);
            if (!animacao.Ocupada) { Falhar("o movimento não virou deslize"); return; }

            // O meio do caminho, para a câmera das fotos paradas.
            var mov = passo.Do(Motor.TipoDeEvento.Movimento)[0];
            var meio = (Mundo(palco, mov.De) + Mundo(palco, mov.Para)) * 0.5f + Vector3.up * 0.9f;

            // ---- bombeia o tempo e fotografa o MEIO do walk: três quadros
            // parados (0,35 / 0,50 / 0,65) e oito quadros para a tira.
            var aindaParado = new[] { 0.35f, 0.50f, 0.65f };
            int fotoParada = 0, quadroDaTira = 0;
            var tira = new List<Texture2D>();
            for (int i = 0; i < 900 && animacao.Ocupada; i++)
            {
                animacao.Avancar(QuadroDeTempo);
                float p = animacao.Progresso;

                if (quadroDaTira < 8 && p >= (quadroDaTira + 1) / 9f)
                {
                    // A tira segue o bruxo de perto: é o ciclo da perna que ela
                    // documenta, não o percurso.
                    Mirar(palco, raiz.transform.position + Vector3.up * 0.9f, 1.6f, 380 / 640f);
                    tira.Add(Fotografar(palco.Camera, 380, 640));
                    quadroDaTira++;
                }

                if (fotoParada < 3 && p >= aindaParado[fotoParada])
                {
                    // As paradas miram o meio do percurso, fixas: mostram o
                    // corpo ATRAVESSANDO o quadro — o deslize é parte da prova.
                    Mirar(palco, meio, 3.6f, 1280 / 800f);
                    Salvar(Fotografar(palco.Camera, 1280, 800),
                           Sufixo(saida, "-walk-" + (fotoParada + 1)));
                    fotoParada++;
                }
            }
            if (fotoParada < 3) { Falhar("o deslize acabou antes das três fotos do walk"); return; }

            if (tira.Count == 8)
                Salvar(Colar(tira), Sufixo(saida, "-walk-tira"));

            // Um respiro para as transições walk→idle assentarem.
            for (int i = 0; i < 20; i++) animacao.Avancar(QuadroDeTempo);

            // ---- a conjuração. Se daqui não há alvo, avança rodadas (os
            // monstros continuam parados) reaproximando, até dar linha.
            string feitico = null;
            Vector2Int alvo = default(Vector2Int);
            for (int rodada = 0; rodada < 8 && feitico == null; rodada++)
            {
                if (rodada > 0)
                {
                    batalha.EncerrarTurno();
                    if (!AteVezDe(batalha, "bruxo")) break;
                    Espelhar(animacao, elenco, banco, batalha, null);
                    var aproximar = DestinoDePasseio(batalha);
                    if (aproximar.HasValue)
                    {
                        Espelhar(animacao, elenco, banco, batalha,
                                 partida.TocarCasa(aproximar.Value));
                        while (animacao.Ocupada) animacao.Avancar(QuadroDeTempo);
                    }
                }
                EscolherFeitico(batalha, bruxo, out feitico, out alvo);
            }
            if (feitico == null)
            {
                Falhar("nenhum feitiço do bruxo achou alvo em 8 rodadas — sem foto de attack");
                return;
            }

            partida.EscolherFeitico(feitico);
            var conjuracao = partida.TocarCasa(alvo);
            if (conjuracao == null || !conjuracao.Valido)
            {
                Falhar("a conjuração foi recusada: " +
                       (conjuracao == null ? "não era jogada" : conjuracao.Recusa));
                return;
            }
            Espelhar(animacao, elenco, banco, batalha, conjuracao);

            // Bombeia até o MEIO do clipe de attack — o braço erguido, não a
            // antecipação nem o retorno.
            bool atacou = false;
            for (int i = 0; i < 240 && !atacou; i++)
            {
                animacao.Avancar(QuadroDeTempo);
                var estado = animator.GetCurrentAnimatorStateInfo(0);
                atacou = estado.IsName("attack") && estado.normalizedTime >= 0.35f;
            }
            if (!atacou) { Falhar("o estado attack nunca chegou ao meio do clipe"); return; }

            Mirar(palco, raiz.transform.position + Vector3.up * 0.9f, 2.8f, 1280 / 800f);
            Salvar(Fotografar(palco.Camera, 1280, 800), Sufixo(saida, "-attack"));

            Debug.Log("[SOTERRA] Fotos do piloto de animação gravadas ao lado de " +
                      Path.GetFullPath(saida) + " (feitiço fotografado: " + feitico + ")");
            Sair(0);
        }

        // ============================================================== JOGADAS

        /// <summary>O mesmo funil do <see cref="JogoDeBatalha.AposAcao"/>, na
        /// MESMA ordem: reagir, espelhar, animar. A foto usa o caminho do jogo,
        /// não um atalho próprio.</summary>
        static void Espelhar(AnimacaoDoElenco animacao, Cena.Elenco elenco,
                             Dados.BancoDeDados banco, Motor.Batalha batalha, Motor.Resultado r)
        {
            animacao.Reagir(r);
            elenco.Sincronizar(Fichas.De(batalha, banco));
            animacao.Animar();
        }

        static bool AteVezDe(Motor.Batalha batalha, string classe)
        {
            for (int i = 0; i < 200; i++)
            {
                var u = batalha.Atual;
                if (u != null && u.NoTabuleiro && u.Lado == Motor.Lado.Heroi &&
                    u.ClasseOuMonstroId == classe) return true;
                batalha.EncerrarTurno();
            }
            return false;
        }

        /// <summary>A casa alcançável que mais aproxima do monstro vivo mais
        /// próximo; empate vai para o CAMINHO mais caro — mais casas, mais
        /// quadros de walk para fotografar.</summary>
        static Vector2Int? DestinoDePasseio(Motor.Batalha batalha)
        {
            Vector2Int? melhor = null;
            int melhorDistancia = int.MaxValue, melhorCusto = -1;
            foreach (var par in batalha.AlcanceDePasso())
            {
                if (par.Value <= 0) continue;
                int d = DistanciaAoMonstro(batalha, par.Key);
                if (d < melhorDistancia ||
                    (d == melhorDistancia && par.Value > melhorCusto))
                {
                    melhor = par.Key;
                    melhorDistancia = d;
                    melhorCusto = par.Value;
                }
            }
            return melhor;
        }

        static int DistanciaAoMonstro(Motor.Batalha batalha, Vector2Int casa)
        {
            int menor = int.MaxValue;
            for (int i = 0; i < batalha.Unidades.Count; i++)
            {
                var u = batalha.Unidades[i];
                if (u == null || !u.NoTabuleiro || u.Lado != Motor.Lado.Monstro) continue;
                int d = Grade.Distancia.Manhattan(casa, u.Casa);
                if (d < menor) menor = d;
            }
            return menor;
        }

        /// <summary>O primeiro feitiço do bruxo com alvo lançável de onde ele
        /// está — preferindo uma casa COM monstro, para a foto contar a jogada
        /// inteira e não um tiro no chão.</summary>
        static void EscolherFeitico(Motor.Batalha batalha, Motor.Unidade bruxo,
                                    out string feitico, out Vector2Int alvo)
        {
            feitico = null;
            alvo = default(Vector2Int);
            for (int f = 0; f < bruxo.Feiticos.Count; f++)
            {
                var id = bruxo.Feiticos[f];
                var casas = batalha.AlvosDe(id);
                Vector2Int? qualquer = null;
                for (int c = 0; c < casas.Count; c++)
                {
                    if (!batalha.PodeConjurar(id, casas[c])) continue;
                    if (!qualquer.HasValue) qualquer = casas[c];
                    if (DistanciaAoMonstro(batalha, casas[c]) == 0)
                    {
                        feitico = id;
                        alvo = casas[c];
                        return;
                    }
                }
                if (feitico == null && qualquer.HasValue)
                {
                    feitico = id;
                    alvo = qualquer.Value;
                    // segue procurando um com monstro na casa
                }
            }
        }

        // ================================================================ FOTO

        static Vector3 Mundo(Cena.Palco palco, Vector2Int casa)
        {
            return palco.Mundo(casa, palco.TopoDe(casa));
        }

        /// <summary>Aponta a câmera ortográfica do palco para um alvo, com o
        /// enquadre pedido. A direção 3/4 é a do jogo e não muda — só o centro
        /// e o tamanho.</summary>
        static void Mirar(Cena.Palco palco, Vector3 alvo, float tamanho, float aspecto)
        {
            var cam = palco.Camera;
            cam.aspect = aspecto;
            cam.orthographicSize = tamanho;
            cam.transform.position = alvo - cam.transform.forward * 30f;
        }

        // sRGB e reenquadre: as armadilhas do CONTRATO_UNITY_F1 §3, já pagas —
        // cópias locais como nas outras fotos do Jogo, porque o original mora
        // em arquivo de outro dono.
        static Texture2D Fotografar(Camera cam, int larg, int alt)
        {
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
            rt.Release();
            return tex;
        }

        /// <summary>Oito quadros lado a lado numa imagem só — a tira do ciclo
        /// de walk que o relatório do piloto pede.</summary>
        static Texture2D Colar(List<Texture2D> quadros)
        {
            int larg = quadros[0].width, alt = quadros[0].height;
            var tira = new Texture2D(larg * quadros.Count, alt, TextureFormat.RGB24, false);
            for (int i = 0; i < quadros.Count; i++)
                tira.SetPixels(i * larg, 0, larg, alt, quadros[i].GetPixels());
            tira.Apply();
            return tira;
        }

        static void Salvar(Texture2D tex, string caminho)
        {
            var completo = Path.GetFullPath(caminho);
            var pasta = Path.GetDirectoryName(completo);
            if (!string.IsNullOrEmpty(pasta)) Directory.CreateDirectory(pasta);
            File.WriteAllBytes(completo, tex.EncodeToPNG());
            Debug.Log("[SOTERRA] Foto em " + completo + " (" + tex.width + "x" + tex.height + ")");
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

        static void Falhar(string motivo)
        {
            Debug.LogError("[SOTERRA] FotoDaAnimacao: " + motivo);
            Sair(2);
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
