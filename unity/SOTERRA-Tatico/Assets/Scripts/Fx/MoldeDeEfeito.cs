using System.Collections.Generic;
using UnityEngine;

namespace Soterra.Fx
{
    /// <summary>Onde a camada NASCE. É metade do que separa uma família da
    /// outra: o cone abre no conjurador, o meteoro nasce no céu, a armadilha
    /// planta no chão do alvo.</summary>
    public enum Ancora
    {
        /// <summary>Na casa alvo, no chão.</summary>
        Alvo,

        /// <summary>Na casa alvo, na altura do peito.</summary>
        PeitoDoAlvo,

        /// <summary>Na casa de quem conjura, no chão.</summary>
        Conjurador,

        /// <summary>Na casa de quem conjura, na altura do peito.</summary>
        PeitoDoConjurador,

        /// <summary>No meio do caminho entre os dois.</summary>
        Meio,

        /// <summary>Alto e DE VIÉS sobre o alvo — de onde o meteoro vem.</summary>
        CeuDeVies,

        /// <summary>Alto e a prumo sobre o alvo — de onde a chuva e a maldição caem.</summary>
        CeuAPrumo
    }

    /// <summary>
    /// Como a partícula encara a câmera. É o que o efeito do JS chamava de
    /// "jeito de pôr a placa", e a Unity já entrega os três de graça.
    /// </summary>
    public enum ModoDeDesenho
    {
        /// <summary>De frente para a câmera — estouro, meia-lua, halo.</summary>
        Bilhete,

        /// <summary>Deitada no piso — runa, anel, leque. É a que diz ONDE caiu.</summary>
        Chao,

        /// <summary>Esticada na direção do movimento — feixe, risco, fio do gancho.</summary>
        Trilho
    }

    /// <summary>De que volume as partículas saem.</summary>
    public enum FormaDeEmissao
    {
        Ponto,
        Esfera,

        /// <summary>Disco deitado no chão — o que dá explosão rasante e anel.</summary>
        Disco,

        /// <summary>Leque que ABRE na direção do alvo — o sopro.</summary>
        Leque,

        /// <summary>Caixa: a área quadrada de uma chuva.</summary>
        Caixa,

        /// <summary>Segmento de reta da origem ao alvo — feixe, rastro de investida.</summary>
        Linha,

        /// <summary>Casca de cilindro em volta do alvo — a coluna e o escudo.</summary>
        Coluna
    }

    /// <summary>
    /// Uma camada de um efeito: um <c>ParticleSystem</c> montado por código.
    ///
    /// Uma família tem 2 ou 3 camadas, e a divisão não é enfeite — é a lição
    /// que a linha JS pagou medindo pixel na tela: com partícula pequena só,
    /// 'bola', 'corte' e 'flecha' pintavam o MESMO número de pixels, porque o
    /// que se via nas três era o clarão do impacto e não o desenho. A resposta
    /// é a camada de FORMA: uma partícula GRANDE (3 a 7 m) com o quadro que diz
    /// o nome da família, legível a 40 px, mais a camada de PÓ que dá o
    /// movimento.
    /// </summary>
    public sealed class CamadaDeEfeito
    {
        /// <summary>Nome do quadro no atlas (<c>runa</c>, <c>corte</c>, …).</summary>
        public string Quadro = "ponto";

        public Ancora Onde = Ancora.Alvo;
        public ModoDeDesenho Modo = ModoDeDesenho.Bilhete;
        public FormaDeEmissao Forma = FormaDeEmissao.Ponto;

        /// <summary>Raio (ou meia-largura) do volume de nascimento, em metros.</summary>
        public float Raio = 0.2f;

        /// <summary>Abertura do leque, em graus.</summary>
        public float Abertura = 30f;

        /// <summary>Quantas partículas por disparo.</summary>
        public int Quantidade = 12;

        /// <summary>Segundos até esta camada começar. É o que dá os DOIS TEMPOS
        /// do impacto e o tempo de voo do meteoro.</summary>
        public float Atraso;

        /// <summary>Repetições do disparo — a chuva cai em pingos, não de uma vez.</summary>
        public int Ciclos = 1;

        /// <summary>Segundos entre repetições.</summary>
        public float IntervaloDeCiclo = 0.08f;

        public float Vida = 0.5f;
        public float VidaVariacao;

        /// <summary>Velocidade de saída do volume, em m/s.</summary>
        public float Velocidade;
        public float VelocidadeVariacao;

        /// <summary>
        /// Empuxo constante em espaço do EFEITO, em m/s: +Z é a direção do
        /// alvo, +Y é para cima. É o que faz a coluna subir e a maldição descer
        /// sem precisar de curva.
        /// </summary>
        public Vector3 Empuxo = Vector3.zero;

        /// <summary>Multiplicador de gravidade. Positivo cai, negativo sobe.</summary>
        public float Gravidade;

        public float Tamanho = 0.4f;
        public float TamanhoVariacao;

        /// <summary>Multiplicador do tamanho no fim da vida. Maior que 1 ABRE
        /// (nova, estouro), menor que 1 FECHA (escudo, aura, gancho).</summary>
        public float EscalaFinal = 1f;

        /// <summary>Fração da vida em que a partícula ainda está opaca. Alta na
        /// armadilha, que PLANTA e fica; baixa no estouro, que some.</summary>
        public float Permanencia = 0.15f;

        /// <summary>Giro, em graus por segundo.</summary>
        public float Giro;

        /// <summary>Espalha a rotação inicial — pó de pedra não nasce alinhado.</summary>
        public bool GiroInicialAleatorio;

        /// <summary>Comprimento do rastro no modo <see cref="ModoDeDesenho.Trilho"/>.</summary>
        public float Alongamento = 2f;

        /// <summary>
        /// A camada VIAJA da âncora até o alvo, chegando lá no fim da vida. É o
        /// que faz o meteoro cair, a flecha voar e a onda atravessar.
        /// </summary>
        public bool Viaja;

        /// <summary>Opacidade máxima — a camada de pó cede o palco à de forma.</summary>
        public float Opacidade = 1f;
    }

    /// <summary>
    /// O desenho de uma família: as camadas e o quanto ele sacode a câmera.
    /// </summary>
    public sealed class MoldeDeEfeito
    {
        public string Familia;
        public CamadaDeEfeito[] Camadas;

        /// <summary>Tranco na câmera, em unidades do <c>Palco</c>. Zero em
        /// armadilha e aura de propósito: elas não batem em nada.</summary>
        public float Tranco;

        /// <summary>Segundos até o efeito inteiro terminar — o pool usa isto
        /// para saber quando o sistema volta a estar livre.</summary>
        public float Duracao
        {
            get
            {
                float fim = 0f;
                for (int i = 0; i < Camadas.Length; i++)
                {
                    var c = Camadas[i];
                    float t = c.Atraso + (c.Ciclos - 1) * c.IntervaloDeCiclo + c.Vida + c.VidaVariacao;
                    if (t > fim) fim = t;
                }
                return fim;
            }
        }

        /// <summary>Partículas que este efeito pode ter no ar ao mesmo tempo —
        /// o número que o orçamento de celular soma.</summary>
        public int TetoDeParticulas
        {
            get
            {
                int n = 0;
                for (int i = 0; i < Camadas.Length; i++)
                    n += Camadas[i].Quantidade * Mathf.Max(1, Camadas[i].Ciclos);
                return n;
            }
        }

        // ================================================================ OS 21

        /// <summary>
        /// Os moldes das 21 famílias. Cada um é fiel ao MOVIMENTO que
        /// <c>js/render3d/fx3d_v2.js</c> descreve, na medida do palco da Unity:
        /// a casa tem 1 m e a unidade comum, 1,80 m.
        ///
        /// Onde o JS foi ambíguo, o critério foi um só: LEGÍVEL A 40 PX. O
        /// jogador precisa saber ONDE caiu e DE QUE elemento é; o resto é
        /// enfeite. É por isso que toda família tem uma forma grande de 3 a 7 m
        /// no chão ou de frente — 40 px de partícula não desenham meia-lua
        /// nenhuma.
        /// </summary>
        public static IDictionary<string, MoldeDeEfeito> Todos()
        {
            var m = new Dictionary<string, MoldeDeEfeito>();
            void Por(string familia, float tranco, params CamadaDeEfeito[] camadas)
            {
                m[familia] = new MoldeDeEfeito { Familia = familia, Camadas = camadas, Tranco = tranco };
            }

            // CAI DO CÉU DE VIÉS e arrebenta. A queda tem de ser VISÍVEL antes
            // do estouro, senão o meteoro vira um estouro qualquer: a língua de
            // fogo viaja 0,45 s do céu até a casa, e só então o chão recebe.
            Por(FamiliaDeEfeito.Meteoro, 1.0f,
                new CamadaDeEfeito
                {
                    Quadro = "brasa", Onde = Ancora.CeuDeVies, Modo = ModoDeDesenho.Trilho,
                    Forma = FormaDeEmissao.Esfera, Raio = 0.35f, Quantidade = 10,
                    Vida = 0.45f, Tamanho = 1.5f, TamanhoVariacao = 0.5f, EscalaFinal = 1.3f,
                    Alongamento = 3f, Viaja = true, Permanencia = 0.7f
                },
                new CamadaDeEfeito
                {
                    Quadro = "estouro", Onde = Ancora.PeitoDoAlvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Atraso = 0.45f,
                    Vida = 0.5f, Tamanho = 2.2f, EscalaFinal = 3.2f, Permanencia = 0.1f
                },
                new CamadaDeEfeito
                {
                    Quadro = "brasa", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Disco, Raio = 0.4f, Quantidade = 26, Atraso = 0.45f,
                    Vida = 0.55f, VidaVariacao = 0.25f, Velocidade = 5.5f, VelocidadeVariacao = 3f,
                    Gravidade = 1.1f, Tamanho = 0.5f, TamanhoVariacao = 0.3f, EscalaFinal = 0.2f,
                    GiroInicialAleatorio = true, Opacidade = 0.9f
                });

            // Vários corpos pequenos caindo sobre a ÁREA, um a um. O anel no
            // chão entra junto porque sem ele o jogador vê pingos soltos e não
            // entende ONDE a chuva cai.
            Por(FamiliaDeEfeito.Chuva, 0.5f,
                new CamadaDeEfeito
                {
                    Quadro = "brasa", Onde = Ancora.CeuAPrumo, Modo = ModoDeDesenho.Trilho,
                    Forma = FormaDeEmissao.Caixa, Raio = 1.4f, Quantidade = 3, Ciclos = 7,
                    IntervaloDeCiclo = 0.085f, Vida = 0.45f, Empuxo = new Vector3(0f, -14f, 0f),
                    Tamanho = 0.7f, TamanhoVariacao = 0.25f, Alongamento = 2.6f, Permanencia = 0.6f
                },
                new CamadaDeEfeito
                {
                    Quadro = "anel", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Chao,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.95f,
                    Tamanho = 2.4f, EscalaFinal = 2.3f, Permanencia = 0.35f, Opacidade = 0.7f
                });

            // ABRE a partir do conjurador na direção do alvo. O leque é o shape:
            // a abertura vem do volume de nascimento, não de aleatoriedade.
            Por(FamiliaDeEfeito.Cone, 0.6f,
                new CamadaDeEfeito
                {
                    Quadro = "fumaca", Onde = Ancora.PeitoDoConjurador, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Leque, Abertura = 32f, Raio = 0.3f, Quantidade = 12,
                    Ciclos = 4, IntervaloDeCiclo = 0.06f, Vida = 0.5f, VidaVariacao = 0.2f,
                    Velocidade = 7f, VelocidadeVariacao = 2.5f, Tamanho = 0.9f, TamanhoVariacao = 0.4f,
                    EscalaFinal = 2.2f, GiroInicialAleatorio = true, Opacidade = 0.85f
                },
                new CamadaDeEfeito
                {
                    Quadro = "lingua", Onde = Ancora.Meio, Modo = ModoDeDesenho.Chao,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.55f,
                    Tamanho = 3.4f, EscalaFinal = 1.6f, Permanencia = 0.25f
                });

            // Quatro braços saindo do alvo. O quadro `aura` do Kenney É uma
            // estrela de quatro braços: uma partícula grande deitada no chão diz
            // "cruz" antes de qualquer pó.
            Por(FamiliaDeEfeito.Cruz, 0.8f,
                new CamadaDeEfeito
                {
                    Quadro = "aura", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Chao,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.6f,
                    Tamanho = 2.6f, EscalaFinal = 2.4f, Giro = 40f, Permanencia = 0.2f
                },
                new CamadaDeEfeito
                {
                    Quadro = "lingua", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Disco, Raio = 0.3f, Quantidade = 20,
                    Vida = 0.45f, Velocidade = 6f, VelocidadeVariacao = 2f,
                    Tamanho = 0.55f, EscalaFinal = 0.3f, Opacidade = 0.9f
                });

            // A nova: o anel que ABRE no chão.
            Por(FamiliaDeEfeito.Anel, 1.1f,
                new CamadaDeEfeito
                {
                    Quadro = "anel", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Chao,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.66f,
                    Tamanho = 1.2f, EscalaFinal = 5.5f, Permanencia = 0.1f
                },
                new CamadaDeEfeito
                {
                    Quadro = "halo", Onde = Ancora.PeitoDoAlvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.52f,
                    Tamanho = 1.6f, EscalaFinal = 3.4f, Permanencia = 0.1f, Opacidade = 0.85f
                },
                new CamadaDeEfeito
                {
                    Quadro = "ponto", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Disco, Raio = 0.3f, Quantidade = 34,
                    Vida = 0.6f, VidaVariacao = 0.25f, Velocidade = 9f, VelocidadeVariacao = 3f,
                    Tamanho = 0.5f, EscalaFinal = 0.25f, Opacidade = 0.8f
                });

            // O CHÃO ERGUE: cascalho sobe e volta a cair (gravidade positiva
            // depois do empuxo). O tranco é o maior do jogo depois da fusão.
            Por(FamiliaDeEfeito.Terremoto, 1.4f,
                new CamadaDeEfeito
                {
                    Quadro = "cascalho", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Disco, Raio = 0.8f, Quantidade = 34,
                    Vida = 0.75f, VidaVariacao = 0.3f, Velocidade = 2.4f, VelocidadeVariacao = 1.5f,
                    Empuxo = new Vector3(0f, 6.5f, 0f), Gravidade = 2.2f,
                    Tamanho = 0.6f, TamanhoVariacao = 0.35f, GiroInicialAleatorio = true, Giro = 90f
                },
                new CamadaDeEfeito
                {
                    Quadro = "cascalho", Onde = Ancora.PeitoDoAlvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.7f,
                    Tamanho = 2.4f, EscalaFinal = 2.6f, Permanencia = 0.25f, Opacidade = 0.9f
                },
                new CamadaDeEfeito
                {
                    Quadro = "anel", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Chao,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.6f,
                    Tamanho = 1.0f, EscalaFinal = 4.6f, Permanencia = 0.1f, Opacidade = 0.85f
                });

            // A parede que ATRAVESSA: o redemoinho anda do conjurador ao alvo,
            // rente ao chão. É o único jeito de ler "passou por aqui".
            Por(FamiliaDeEfeito.Onda, 0.9f,
                new CamadaDeEfeito
                {
                    Quadro = "redemoinho", Onde = Ancora.PeitoDoConjurador, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.5f,
                    Tamanho = 3.0f, EscalaFinal = 1.5f, Giro = 150f, Viaja = true, Permanencia = 0.5f
                },
                new CamadaDeEfeito
                {
                    Quadro = "redemoinho", Onde = Ancora.Conjurador, Modo = ModoDeDesenho.Chao,
                    Forma = FormaDeEmissao.Linha, Quantidade = 22, Vida = 0.5f, VidaVariacao = 0.2f,
                    Velocidade = 1.6f, Empuxo = new Vector3(0f, 0.6f, 0f),
                    Tamanho = 0.8f, TamanhoVariacao = 0.4f, EscalaFinal = 1.6f,
                    GiroInicialAleatorio = true, Opacidade = 0.8f
                });

            // O rastro da corrida cobre o caminho inteiro, e as garras chegam no
            // tempo da pancada.
            Por(FamiliaDeEfeito.Investida, 1.1f,
                new CamadaDeEfeito
                {
                    // O empuxo em Z não é enfeite: o modo Trilho estica a
                    // partícula na direção da VELOCIDADE, e partícula parada não
                    // tem direção para esticar — o rastro viraria um borrão.
                    Quadro = "risco", Onde = Ancora.PeitoDoConjurador, Modo = ModoDeDesenho.Trilho,
                    Forma = FormaDeEmissao.Linha, Quantidade = 18, Vida = 0.36f,
                    Empuxo = new Vector3(0f, 0.3f, 4f),
                    Tamanho = 0.7f, TamanhoVariacao = 0.3f, Alongamento = 3.5f, Opacidade = 0.85f
                },
                new CamadaDeEfeito
                {
                    Quadro = "corte", Onde = Ancora.PeitoDoAlvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Atraso = 0.18f,
                    Vida = 0.44f, Tamanho = 2.4f, EscalaFinal = 2.0f, Giro = -220f, Permanencia = 0.1f
                },
                new CamadaDeEfeito
                {
                    Quadro = "ponto", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Disco, Raio = 0.3f, Quantidade = 18, Atraso = 0.18f,
                    Vida = 0.4f, Velocidade = 5.5f, VelocidadeVariacao = 2f,
                    Tamanho = 0.45f, EscalaFinal = 0.2f, Opacidade = 0.8f
                });

            // A MEIA-LUA que gira: a diferença entre "cortou" e "aconteceu
            // alguma coisa laranja".
            Por(FamiliaDeEfeito.Corte, 0.7f,
                new CamadaDeEfeito
                {
                    Quadro = "corte", Onde = Ancora.PeitoDoAlvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.42f,
                    Tamanho = 2.6f, EscalaFinal = 1.7f, Giro = 300f, Permanencia = 0.12f
                },
                new CamadaDeEfeito
                {
                    Quadro = "corte", Onde = Ancora.PeitoDoAlvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Disco, Raio = 0.5f, Quantidade = 14,
                    Vida = 0.32f, Velocidade = 5f, VelocidadeVariacao = 2f,
                    Tamanho = 0.6f, EscalaFinal = 0.25f, GiroInicialAleatorio = true, Opacidade = 0.85f
                });

            // PLANTA, não estoura. O selo roda devagar e demora a apagar — o
            // oposto exato do estouro, e é isso que "armadilha" tem de dizer.
            // Sem tranco: não bate em ninguém agora.
            Por(FamiliaDeEfeito.Armadilha, 0f,
                new CamadaDeEfeito
                {
                    Quadro = "runa", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Chao,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 1.8f,
                    Tamanho = 1.0f, EscalaFinal = 2.6f, Giro = 26f, Permanencia = 0.72f
                },
                new CamadaDeEfeito
                {
                    Quadro = "runa", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Chao,
                    Forma = FormaDeEmissao.Disco, Raio = 1.1f, Quantidade = 10,
                    Vida = 0.9f, VidaVariacao = 0.4f, Empuxo = new Vector3(0f, 0.5f, 0f),
                    Tamanho = 0.5f, EscalaFinal = 0.4f, Giro = 40f, Permanencia = 0.5f, Opacidade = 0.8f
                });

            // COLUNA DE LUZ subindo onde a criatura vai aparecer, e o círculo
            // girando ao CONTRÁRIO da armadilha — é o que separa as duas de
            // relance, já que as duas desenham runa no chão.
            Por(FamiliaDeEfeito.Invocacao, 0.5f,
                new CamadaDeEfeito
                {
                    Quadro = "runa", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Chao,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.95f,
                    Tamanho = 1.0f, EscalaFinal = 3.0f, Giro = -100f, Permanencia = 0.35f
                },
                new CamadaDeEfeito
                {
                    Quadro = "brilho", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Coluna, Raio = 0.55f, Quantidade = 10, Ciclos = 4,
                    IntervaloDeCiclo = 0.07f, Vida = 0.7f, Empuxo = new Vector3(0f, 4.2f, 0f),
                    Gravidade = -0.5f, Tamanho = 0.55f, TamanhoVariacao = 0.25f, EscalaFinal = 0.4f
                },
                new CamadaDeEfeito
                {
                    Quadro = "halo", Onde = Ancora.PeitoDoAlvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Atraso = 0.12f, Vida = 0.85f,
                    Tamanho = 1.8f, EscalaFinal = 1.8f, Permanencia = 0.3f, Opacidade = 0.8f
                });

            // No PRÓPRIO corpo. Era a que sumia por completo — a bola genérica
            // precisa de um destino e estes feitiços apontam para si mesmos.
            Por(FamiliaDeEfeito.Aura, 0f,
                new CamadaDeEfeito
                {
                    Quadro = "aura", Onde = Ancora.PeitoDoConjurador, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.8f,
                    Tamanho = 1.6f, EscalaFinal = 2.0f, Giro = 65f, Permanencia = 0.3f, Opacidade = 0.85f
                },
                new CamadaDeEfeito
                {
                    // O anel FECHA nos pés: aura recolhe, não espalha.
                    Quadro = "anel", Onde = Ancora.Conjurador, Modo = ModoDeDesenho.Chao,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.75f,
                    Tamanho = 3.2f, EscalaFinal = 0.4f, Permanencia = 0.25f
                },
                new CamadaDeEfeito
                {
                    Quadro = "aura", Onde = Ancora.Conjurador, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Coluna, Raio = 0.5f, Quantidade = 10, Ciclos = 3,
                    IntervaloDeCiclo = 0.09f, Vida = 0.75f, Empuxo = new Vector3(0f, 2.4f, 0f),
                    Tamanho = 0.5f, EscalaFinal = 0.3f, Giro = 120f, Opacidade = 0.8f
                });

            // Sobe do chão em volta de quem recebe. A estrela grande no peito é
            // o que se lê a 40 px; as fagulhas são o movimento.
            Por(FamiliaDeEfeito.Cura, 0f,
                new CamadaDeEfeito
                {
                    Quadro = "brilho", Onde = Ancora.PeitoDoAlvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.72f,
                    Tamanho = 1.6f, EscalaFinal = 2.2f, Giro = 45f, Permanencia = 0.25f
                },
                new CamadaDeEfeito
                {
                    Quadro = "brilho", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Coluna, Raio = 0.65f, Quantidade = 22,
                    Vida = 0.85f, VidaVariacao = 0.3f, Empuxo = new Vector3(0f, 3.4f, 0f),
                    Gravidade = -0.3f, Tamanho = 0.5f, TamanhoVariacao = 0.2f, EscalaFinal = 0.3f,
                    Giro = 100f
                },
                new CamadaDeEfeito
                {
                    // O anel também FECHA: cura recolhe para dentro do corpo.
                    Quadro = "anel", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Chao,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.62f,
                    Tamanho = 2.6f, EscalaFinal = 0.45f, Permanencia = 0.2f, Opacidade = 0.75f
                });

            // Uma peça DO TAMANHO DO TIRO. No JS o feixe eram 26 pontinhos em
            // fila — uma pontilhada, não um feixe.
            Por(FamiliaDeEfeito.Feixe, 0.8f,
                new CamadaDeEfeito
                {
                    // Atravessa o caminho inteiro em 0,46 s, esticada 9×: é uma
                    // peça DO TAMANHO DO TIRO, e é o Viaja que lhe dá a direção
                    // em que o modo Trilho estica.
                    Quadro = "raio", Onde = Ancora.PeitoDoConjurador, Modo = ModoDeDesenho.Trilho,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.46f,
                    Tamanho = 1.4f, EscalaFinal = 1.4f, Alongamento = 9f, Viaja = true,
                    Permanencia = 0.3f
                },
                new CamadaDeEfeito
                {
                    Quadro = "raio", Onde = Ancora.Conjurador, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Linha, Quantidade = 22, Vida = 0.42f, VidaVariacao = 0.15f,
                    Velocidade = 1.2f, Tamanho = 0.7f, TamanhoVariacao = 0.3f, EscalaFinal = 0.3f,
                    GiroInicialAleatorio = true, Opacidade = 0.9f
                });

            // A haste de uma flecha tem meio pixel de largura: o RISCO é o que
            // faz o tiro existir na tela, e é ele que separa a flecha da bola.
            Por(FamiliaDeEfeito.Flecha, 0.6f,
                new CamadaDeEfeito
                {
                    Quadro = "risco", Onde = Ancora.PeitoDoConjurador, Modo = ModoDeDesenho.Trilho,
                    Forma = FormaDeEmissao.Esfera, Raio = 0.12f, Quantidade = 6,
                    Vida = 0.3f, Tamanho = 0.8f, Alongamento = 5f, Viaja = true, Permanencia = 0.55f
                },
                new CamadaDeEfeito
                {
                    Quadro = "estouro", Onde = Ancora.PeitoDoAlvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Atraso = 0.3f,
                    Vida = 0.36f, Tamanho = 1.4f, EscalaFinal = 2.4f, Permanencia = 0.1f
                },
                new CamadaDeEfeito
                {
                    Quadro = "ponto", Onde = Ancora.PeitoDoAlvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Esfera, Raio = 0.25f, Quantidade = 14, Atraso = 0.3f,
                    Vida = 0.35f, Velocidade = 4.5f, VelocidadeVariacao = 2f,
                    Tamanho = 0.4f, EscalaFinal = 0.2f, Opacidade = 0.85f
                });

            // Seco no alvo: a coisa já acontece lá, sem projétil nenhum.
            Por(FamiliaDeEfeito.Estouro, 1.2f,
                new CamadaDeEfeito
                {
                    Quadro = "estouro", Onde = Ancora.PeitoDoAlvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.5f,
                    Tamanho = 1.8f, EscalaFinal = 3.6f, Permanencia = 0.1f
                },
                new CamadaDeEfeito
                {
                    Quadro = "anel", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Chao,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.56f,
                    Tamanho = 1.2f, EscalaFinal = 4.2f, Permanencia = 0.1f, Opacidade = 0.85f
                },
                new CamadaDeEfeito
                {
                    Quadro = "estouro", Onde = Ancora.PeitoDoAlvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Esfera, Raio = 0.35f, Quantidade = 34,
                    Vida = 0.55f, VidaVariacao = 0.25f, Velocidade = 7.5f, VelocidadeVariacao = 3f,
                    Gravidade = 0.6f, Tamanho = 0.55f, TamanhoVariacao = 0.3f, EscalaFinal = 0.25f,
                    GiroInicialAleatorio = true, Opacidade = 0.9f
                });

            // A casca que FECHA em volta de quem recebe — cresce ao contrário do
            // estouro, e é isso que se lê sem legenda.
            Por(FamiliaDeEfeito.Escudo, 0f,
                new CamadaDeEfeito
                {
                    Quadro = "halo", Onde = Ancora.PeitoDoAlvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.75f,
                    Tamanho = 3.4f, EscalaFinal = 0.55f, Permanencia = 0.3f
                },
                new CamadaDeEfeito
                {
                    Quadro = "anel", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Chao,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.62f,
                    Tamanho = 3.0f, EscalaFinal = 0.5f, Permanencia = 0.25f, Opacidade = 0.8f
                },
                new CamadaDeEfeito
                {
                    Quadro = "halo", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Coluna, Raio = 1.0f, Quantidade = 12, Ciclos = 3,
                    IntervaloDeCiclo = 0.09f, Vida = 0.65f, Empuxo = new Vector3(0f, 2.6f, 0f),
                    Tamanho = 0.55f, EscalaFinal = 0.4f, Opacidade = 0.85f
                });

            // Some de um lugar e aparece no outro, sem NADA no caminho — o
            // crescimento invertido das duas cintilações conta a história.
            Por(FamiliaDeEfeito.Piscar, 0.4f,
                new CamadaDeEfeito
                {
                    Quadro = "cintila", Onde = Ancora.PeitoDoConjurador, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.32f,
                    Tamanho = 2.6f, EscalaFinal = 0.2f, Giro = 120f, Permanencia = 0.2f
                },
                new CamadaDeEfeito
                {
                    Quadro = "cintila", Onde = Ancora.PeitoDoAlvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Atraso = 0.14f, Vida = 0.44f,
                    Tamanho = 0.4f, EscalaFinal = 7f, Giro = -120f, Permanencia = 0.15f
                },
                new CamadaDeEfeito
                {
                    Quadro = "cintila", Onde = Ancora.PeitoDoAlvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Esfera, Raio = 0.3f, Quantidade = 18, Atraso = 0.14f,
                    Vida = 0.4f, Velocidade = 4f, VelocidadeVariacao = 2f, Gravidade = -0.4f,
                    Tamanho = 0.45f, EscalaFinal = 0.2f, Opacidade = 0.85f
                });

            // O fio ESTICADO que ENCOLHE enquanto puxa, e o pó correndo DO ALVO
            // DE VOLTA para quem puxou.
            Por(FamiliaDeEfeito.Gancho, 0.7f,
                new CamadaDeEfeito
                {
                    // Empuxo NEGATIVO em Z: o fio corre DO ALVO de volta para
                    // quem puxou, e é esse sentido — não o desenho — que diz
                    // "gancho" em vez de "tiro".
                    Quadro = "risco", Onde = Ancora.PeitoDoAlvo, Modo = ModoDeDesenho.Trilho,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.55f,
                    Empuxo = new Vector3(0f, 0.2f, -5f),
                    Tamanho = 0.9f, EscalaFinal = 0.45f, Alongamento = 8f, Permanencia = 0.35f
                },
                new CamadaDeEfeito
                {
                    // Empuxo NEGATIVO em Z: o pó vem do alvo para o conjurador.
                    Quadro = "risco", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Trilho,
                    Forma = FormaDeEmissao.Linha, Quantidade = 14, Atraso = 0.1f,
                    Vida = 0.4f, Empuxo = new Vector3(0f, 0.4f, -5f),
                    Tamanho = 0.55f, Alongamento = 3f, Opacidade = 0.85f
                });

            // Cai DE CIMA sobre o alvo, devagar, e ASSENTA. Nada explode: é o
            // avesso do estouro, e o selo que desce fecha a leitura.
            Por(FamiliaDeEfeito.Maldicao, 0f,
                new CamadaDeEfeito
                {
                    Quadro = "fumaca", Onde = Ancora.CeuAPrumo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Vida = 0.9f,
                    Tamanho = 1.6f, EscalaFinal = 2.6f, Viaja = true, Permanencia = 0.4f, Opacidade = 0.85f
                },
                new CamadaDeEfeito
                {
                    Quadro = "fumaca", Onde = Ancora.CeuAPrumo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Esfera, Raio = 0.7f, Quantidade = 12, Ciclos = 3,
                    IntervaloDeCiclo = 0.11f, Vida = 0.9f, VidaVariacao = 0.3f,
                    Empuxo = new Vector3(0f, -2.6f, 0f), Gravidade = 0.3f,
                    Tamanho = 0.7f, TamanhoVariacao = 0.3f, EscalaFinal = 1.4f,
                    GiroInicialAleatorio = true, Opacidade = 0.7f
                },
                new CamadaDeEfeito
                {
                    Quadro = "runa", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Chao,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Atraso = 0.22f, Vida = 0.9f,
                    Tamanho = 2.8f, EscalaFinal = 0.55f, Giro = -52f, Permanencia = 0.4f, Opacidade = 0.8f
                });

            // O ÚLTIMO RECURSO — 4% das chaves do acervo. Mesmo ela deixa marca
            // no chão: efeito genérico ainda tem de dizer ONDE caiu.
            Por(FamiliaDeEfeito.Bola, 0.7f,
                new CamadaDeEfeito
                {
                    Quadro = "ponto", Onde = Ancora.PeitoDoConjurador, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Esfera, Raio = 0.15f, Quantidade = 6,
                    Vida = 0.34f, Tamanho = 1.0f, Viaja = true, Permanencia = 0.55f
                },
                new CamadaDeEfeito
                {
                    Quadro = "estouro", Onde = Ancora.PeitoDoAlvo, Modo = ModoDeDesenho.Bilhete,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Atraso = 0.34f,
                    Vida = 0.4f, Tamanho = 1.6f, EscalaFinal = 2.6f, Permanencia = 0.1f
                },
                new CamadaDeEfeito
                {
                    Quadro = "anel", Onde = Ancora.Alvo, Modo = ModoDeDesenho.Chao,
                    Forma = FormaDeEmissao.Ponto, Quantidade = 1, Atraso = 0.34f,
                    Vida = 0.48f, Tamanho = 0.8f, EscalaFinal = 3.4f, Permanencia = 0.1f, Opacidade = 0.8f
                });

            return m;
        }
    }
}
