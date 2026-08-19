using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Soterra.Jogo
{
    // Ver a nota em Partida.cs: apelidos globais contra o CS0234 dos irmãos.
    using Motor = global::Soterra.Motor;
    using Dados = global::Soterra.Dados;
    using Cena = global::Soterra.Cena;
    using Interface = global::Soterra.Interface;
    using Progressao = global::Soterra.Progressao;

    /// <summary>
    /// Tira as fotos do laço DENTRO do Play — é a metade da
    /// <see cref="FotoDaDescida"/> que não podia rodar em modo lote comum.
    ///
    /// A razão é uma só e foi medida: fora de Play o UI Toolkit não roda o laço
    /// que repinta os painéis de execução, e a tela de fluxo sai com ZERO pixel
    /// desenhado. Dentro de Play o painel se desenha sozinho no fim do quadro,
    /// e basta esperar alguns quadros antes de ler a textura.
    ///
    /// É um <c>MonoBehaviour</c> porque só um consegue esperar quadros. Toda a
    /// preparação — progresso, grupo, descida, batalha — continua na
    /// <see cref="FotoDaDescida"/>, que é onde ela se lê junto do resto.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class FotoDaDescidaEmPlay : MonoBehaviour
    {
        /// <summary>
        /// Quadros de espera entre montar o painel e ler a textura dele. O
        /// primeiro resolve o layout, o segundo desenha, o resto é folga — ler
        /// cedo demais devolve uma textura em branco, que é o mesmo sintoma de
        /// "não funcionou" e custa uma rodada inteira para distinguir.
        /// </summary>
        public const int QuadrosDeEspera = 6;

        IEnumerator Start()
        {
            var saida = FotoDaDescida.Argumento("-foto", "foto-descida.png");

            var banco = Dados.BancoDeDados.CarregarDeResources();
            var armazem = new Progressao.ArmazemDeMemoria();
            var progresso = Progressao.Progresso.DoZero(banco, armazem);
            FotoDaDescida.PrepararGrupo(progresso);

            var expedicao = Expedicao.Comecar(progresso, FotoDaDescida.Calabouco,
                                              FotoDaDescida.Grupo, "foto-da-descida", armazem);
            if (expedicao == null)
            {
                Debug.LogError("[SOTERRA] a descida não abriu");
                Encerrar(2);
                yield break;
            }

            if (!FotoDaDescida.JogarSala(banco, expedicao.Partida) ||
                expedicao.Partida.Batalha.Fase != Motor.FaseDaBatalha.Vitoria)
            {
                Debug.LogError("[SOTERRA] a sala 0 não terminou em vitória — sem ela não há " +
                               "recompensa para fotografar");
                Encerrar(2);
                yield break;
            }
            expedicao.ConferirFimDaSala();

            var palco = new GameObject("Palco").AddComponent<Cena.Palco>();
            FotoDaDescida.MontarPalco(palco, banco, expedicao);
            var elenco = new Cena.Elenco(palco, banco);
            elenco.Sincronizar(Fichas.De(expedicao.Partida.Batalha, banco));

            // ---- a escolha de caminho, que vem ANTES da recompensa
            if (expedicao.Passo == PassoDaExpedicao.EscolhaDeElemento)
            {
                yield return Fotografar(palco, FotoDaDescida.QuadroDe(progresso, expedicao),
                                        FotoDaDescida.Sufixo(saida, "-caminho"), 900, 1600);

                while (expedicao.Passo == PassoDaExpedicao.EscolhaDeElemento)
                {
                    var q = FotoDaDescida.QuadroDe(progresso, expedicao);
                    if (q.Elementos.Count == 0) break;
                    expedicao.EscolherElemento(expedicao.HeroiDaEscolha, q.Elementos[0].Id);
                }
            }

            if (expedicao.Passo != PassoDaExpedicao.Recompensa)
            {
                Debug.LogError("[SOTERRA] depois da vitória o passo é " + expedicao.Passo);
                Encerrar(2);
                yield break;
            }

            var r = expedicao.Recompensa;
            Debug.Log("[SOTERRA] recompensa da sala 0: XP da sala " + r.XpDaSala + ", " +
                      r.Itens.Count + " peça(s), " + r.Pedras.Count + " tipo(s) de pedra, " +
                      r.Subidas.Count + " subida(s) de nível");

            // ---- FOTO: a tela de recompensa, em pé e deitada
            yield return Fotografar(palco, FotoDaDescida.QuadroDe(progresso, expedicao),
                                    FotoDaDescida.Sufixo(saida, "-recompensa"), 900, 1600);
            yield return Fotografar(palco, FotoDaDescida.QuadroDe(progresso, expedicao),
                                    FotoDaDescida.Sufixo(saida, "-recompensa-deitada"), 1600, 900);

            // ---- a sala 1, montada pelo mesmo caminho do jogo
            if (!expedicao.Descer())
            {
                Debug.LogError("[SOTERRA] o 'Descer' não levou à sala seguinte");
                Encerrar(2);
                yield break;
            }

            Relatar(expedicao);

            FotoDaDescida.MontarPalco(palco, banco, expedicao);
            elenco = new Cena.Elenco(palco, banco);
            elenco.Sincronizar(Fichas.De(expedicao.Partida.Batalha, banco));

            yield return Fotografar(palco, null, saida, 1600, 900);
            Encerrar(0);
        }

        static void Relatar(Expedicao expedicao)
        {
            var pvs = new List<string>();
            foreach (var par in expedicao.PvDeEntrada) pvs.Add(par.Key + " " + par.Value);
            Debug.Log("[SOTERRA] sala " + expedicao.IndiceDaSala + " montada; PV de entrada: " +
                      string.Join(", ", pvs.ToArray()));

            foreach (var u in expedicao.Partida.Batalha.Unidades)
            {
                if (u.Lado != Motor.Lado.Heroi) continue;
                Debug.Log("[SOTERRA] herói em campo: " + u.ClasseOuMonstroId + " nível " + u.Nivel +
                          ", " + u.PV + "/" + u.PVMax + " PV, elemento " + u.Elemento + ", " +
                          u.Feiticos.Count + " feitiços");
            }
        }

        /// <summary>
        /// Fotografa o tabuleiro e, quando há quadro, a tela por cima — em DUAS
        /// texturas, compostas pelo alfa. Compor à mão em vez de deixar o painel
        /// desenhar sobre a mesma textura porque a ordem entre o
        /// <c>Camera.Render</c> manual e o desenho do painel não é garantida;
        /// com duas leituras, o resultado não depende de ordem nenhuma.
        /// </summary>
        IEnumerator Fotografar(Cena.Palco palco, Interface.QuadroDeFluxo quadro,
                               string saida, int larg, int alt)
        {
            Texture2D frente = null;

            if (quadro != null)
            {
                var painel = ScriptableObject.CreateInstance<PanelSettings>();
                painel.name = "painel-de-foto";
                painel.themeStyleSheet = Resources.Load<ThemeStyleSheet>(
                    Interface.HudDeBatalha.RecursoDoTema);
                // `ConstantPixelSize` SÓ na foto: em modo lote o DPI informado é
                // o da máquina e não o de um celular, e a interface sairia
                // encolhida a 60%. Ver a nota em FotoDaDescida.EscalaDaFoto.
                painel.scaleMode = PanelScaleMode.ConstantPixelSize;
                painel.scale = FotoDaDescida.EscalaDaFoto;
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

                // `yield return null` e NÃO `WaitForEndOfFrame`: em
                // `-batchmode` o fim de quadro não é sinalizado, e a corrotina
                // que o espera fica pendurada para sempre — foi o que travou a
                // primeira tentativa (o processo passou de dez minutos sem
                // escrever uma linha). Um `null` por quadro avança o laço do
                // player, que é justamente quem repinta os painéis de execução.
                for (int i = 0; i < QuadrosDeEspera; i++) yield return null;

                frente = FotoDaDescida.Ler(rt, larg, alt, TextureFormat.RGBA32);
                Debug.Log("[SOTERRA] tela de fluxo: " + FotoDaDescida.Pintados(frente) + " de " +
                          (larg * alt) + " pixels desenhados");

                painel.targetTexture = null;
                FotoDaDescida.Descartar(go);
                FotoDaDescida.Descartar(painel);
                rt.Release();
                FotoDaDescida.Descartar(rt);
            }

            var fundo = FotoDaDescida.RenderizarPalco(palco, larg, alt);
            var final = frente == null ? fundo : FotoDaDescida.Compor(fundo, frente);

            var caminho = System.IO.Path.GetFullPath(saida);
            var pasta = System.IO.Path.GetDirectoryName(caminho);
            if (!string.IsNullOrEmpty(pasta)) System.IO.Directory.CreateDirectory(pasta);
            System.IO.File.WriteAllBytes(caminho, final.EncodeToPNG());
            Debug.Log("[SOTERRA] Foto em " + caminho + " (" + larg + "x" + alt + ")");
        }

        /// <summary>Sai do processo com o código certo. Com <c>-quit</c> não dá
        /// para chegar aqui (o Editor sairia antes do Play), então é este método
        /// que encerra o lote.</summary>
        static void Encerrar(int codigo)
        {
#if UNITY_EDITOR
            if (Application.isBatchMode) EditorApplication.Exit(codigo);
            else EditorApplication.isPlaying = false;
#endif
        }
    }
}
