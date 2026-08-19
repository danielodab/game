using System;
using System.Collections.Generic;
using System.Text;
using NUnit.Framework;
using Soterra.Batalha;
using Soterra.Dados;
using UnityEngine;

namespace Soterra.Testes.Batalha
{
    /// <summary>
    /// A montagem da batalha, medida na sala DE VERDADE.
    ///
    /// A sala é `greenhouse`, índice 0 — "O Vestíbulo das Heras" — e não um
    /// retângulo de brinquedo, porque os dois defeitos que já custaram caro
    /// nesta equipe só aparecem no desenho real: ele traz SEIS nascimentos de
    /// herói para um grupo de dois, e REPETE letra de monstro. Um mapa 5×3
    /// inventado passaria por cima dos dois sem piscar.
    /// </summary>
    public class MontadorTests
    {
        const string Estufa = "greenhouse";
        const int Vestibulo = 0;

        /// <summary>O Bárbaro e o Ladino: os extremos da esquiva e da iniciativa.</summary>
        static readonly string[] Grupo = { "sumo", "espadachim" };

        static Motor.Batalha MontarOVestibulo()
        {
            return Montador.DeSala(Acervo.DaEstufa(), Estufa, Vestibulo, Grupo);
        }

        static Sala SalaDoVestibulo()
        {
            return Acervo.DaEstufa().AchaCalabouco(Estufa).Salas[Vestibulo];
        }

        static Motor.Unidade Em(Motor.Batalha b, int x, int y)
        {
            var casa = new Vector2Int(x, y);
            for (int i = 0; i < b.Unidades.Count; i++)
                if (b.Unidades[i].Casa == casa) return b.Unidades[i];
            return null;
        }

        static List<Motor.Unidade> Todas(Motor.Batalha b, string id)
        {
            var achadas = new List<Motor.Unidade>();
            for (int i = 0; i < b.Unidades.Count; i++)
                if (b.Unidades[i].ClasseOuMonstroId == id) achadas.Add(b.Unidades[i]);
            return achadas;
        }

        static string Fila(Motor.Batalha b)
        {
            var sb = new StringBuilder();
            for (int i = 0; i < b.Ordem.Count; i++)
            {
                if (i > 0) sb.Append(" → ");
                sb.Append(b.Ordem[i].ClasseOuMonstroId).Append(b.Ordem[i].Casa);
            }
            return sb.ToString();
        }

        // ================================================================
        // Os seis P
        // ================================================================

        [Test]
        public void A_sala_real_traz_seis_P_e_o_grupo_de_dois_ocupa_os_dois_primeiros()
        {
            var sala = SalaDoVestibulo();
            Assert.AreEqual(6, Acervo.NascimentosDeHeroiNoDesenho(sala),
                "o desenho do Vestíbulo tem seis 'P' — se este número mudou, o resto deste teste está medindo outra sala");

            var b = MontarOVestibulo();

            // Os dois primeiros 'P' na ordem de leitura do desenho: linha de
            // cima primeiro, esquerda para a direita. É o que quem desenhou a
            // sala espera ver.
            Assert.AreEqual(new Vector2Int(1, 9), b.Unidades[0].Casa, "o primeiro herói vai no primeiro 'P'");
            Assert.AreEqual(new Vector2Int(2, 9), b.Unidades[1].Casa, "o segundo herói vai no segundo 'P'");
            Assert.AreEqual("sumo", b.Unidades[0].ClasseOuMonstroId);
            Assert.AreEqual("espadachim", b.Unidades[1].ClasseOuMonstroId);
        }

        [Test]
        public void Os_quatro_P_que_sobram_ficam_VAZIOS__e_isso_esta_certo()
        {
            // Não é defeito: são posições de partida a mais, não unidades a
            // menos. Um montador que insistisse em encher os seis inventaria
            // quatro heróis que o jogador nunca escolheu.
            var b = MontarOVestibulo();

            Assert.IsNull(Em(b, 1, 8), "terceiro 'P' vazio");
            Assert.IsNull(Em(b, 2, 8), "quarto 'P' vazio");
            Assert.IsNull(Em(b, 1, 7), "quinto 'P' vazio");
            Assert.IsNull(Em(b, 2, 7), "sexto 'P' vazio");
        }

        [Test]
        public void Grupo_maior_que_a_quantidade_de_P_e_recusado()
        {
            // A "Sala de um P só" tem um nascimento e o grupo tem dois: sem esta
            // recusa o segundo herói nasceria fora do tabuleiro, ou por cima do
            // primeiro.
            var e = Assert.Throws<InvalidOperationException>(delegate
            {
                Montador.DeSala(Acervo.DoLaboratorio(), "laboratorio", 1, Grupo);
            });
            StringAssert.Contains("nascimentos de herói insuficientes", e.Message);
        }

        // ================================================================
        // A letra que repete
        // ================================================================

        [Test]
        public void Letra_repetida_e_dois_monstros__nao_a_mesma_casa_duas_vezes()
        {
            var sala = SalaDoVestibulo();
            // Cinco letras desenhadas, três ids declarados: `a` e `b` aparecem
            // duas vezes cada. Foi agrupando por letra que a sala perdeu dois
            // monstros calada.
            Assert.AreEqual(5, Acervo.NascimentosDeMonstroNoDesenho(sala), "letras desenhadas");
            Assert.AreEqual(3, sala.Monstros.Count, "ids declarados em `monsters`");

            var b = MontarOVestibulo();

            var bufos = Todas(b, "pollen-puff");
            Assert.AreEqual(2, bufos.Count, "os dois 'a' são dois Bufos-de-Pólen");
            Assert.AreNotEqual(bufos[0].Casa, bufos[1].Casa, "e em casas diferentes");
            Assert.AreNotEqual(bufos[0].Uid, bufos[1].Uid, "com uid próprio cada um");

            Assert.AreEqual(2, Todas(b, "thorn-lasher").Count, "os dois 'b' são duas Vergastas");
            Assert.AreEqual(1, Todas(b, "lantern-wasp").Count, "o 'c' é uma Vespa-Lustre só");
        }

        [Test]
        public void A_contagem_de_unidades_bate_com_o_desenho()
        {
            var sala = SalaDoVestibulo();
            int monstrosDesenhados = Acervo.NascimentosDeMonstroNoDesenho(sala);

            var b = MontarOVestibulo();

            Assert.AreEqual(Grupo.Length + monstrosDesenhados, b.Unidades.Count,
                "toda letra desenhada vira uma criatura, e todo herói do grupo vira uma unidade");
            Assert.AreEqual(7, b.Unidades.Count, "dois heróis e cinco monstros");
            Assert.AreEqual(b.Unidades.Count, b.Ordem.Count, "ninguém fica de fora da fila de iniciativa");
        }

        [Test]
        public void Cada_letra_nasce_na_casa_que_o_desenho_marcou()
        {
            var b = MontarOVestibulo();

            Assert.AreEqual("pollen-puff",  Em(b, 6, 10).ClasseOuMonstroId,  "'a' de cima");
            Assert.AreEqual("thorn-lasher", Em(b, 14, 10).ClasseOuMonstroId, "'b' de cima");
            Assert.AreEqual("lantern-wasp", Em(b, 17, 8).ClasseOuMonstroId,  "'c' do meio");
            Assert.AreEqual("pollen-puff",  Em(b, 6, 6).ClasseOuMonstroId,   "'a' de baixo");
            Assert.AreEqual("thorn-lasher", Em(b, 14, 6).ClasseOuMonstroId,  "'b' de baixo");
        }

        [Test]
        public void Letra_desenhada_sem_id_declarado_derruba_a_montagem()
        {
            // A "Sala com letra solta" desenha 'b' e declara só 'a'. Ignorar em
            // silêncio deixaria um buraco no tabuleiro, e ninguém veria a sala
            // ficar mais fácil do que foi desenhada.
            var e = Assert.Throws<InvalidOperationException>(delegate
            {
                Montador.DeSala(Acervo.DoLaboratorio(), "laboratorio", 2, new[] { "sumo" });
            });
            StringAssert.Contains("letra sem monstro", e.Message);
            StringAssert.Contains("'b'", e.Message);
        }

        [Test]
        public void Id_declarado_que_nao_existe_no_bestiario_derruba_a_montagem()
        {
            var e = Assert.Throws<InvalidOperationException>(delegate
            {
                Montador.DeSala(Acervo.DoLaboratorio(), "laboratorio", 3, new[] { "sumo" });
            });
            StringAssert.Contains("monstro desconhecido", e.Message);
            StringAssert.Contains("bicho-que-nunca-existiu", e.Message);
        }

        // ================================================================
        // Onde cada um pisa
        // ================================================================

        [Test]
        public void Ninguem_nasce_dentro_de_parede()
        {
            var b = MontarOVestibulo();

            for (int i = 0; i < b.Unidades.Count; i++)
            {
                var u = b.Unidades[i];
                Assert.IsTrue(b.Mapa.Andavel(u.Casa),
                    u.ClasseOuMonstroId + " nasceu em " + u.Casa + ", que é " + b.Mapa.Em(u.Casa));
            }
        }

        [Test]
        public void Ninguem_nasce_em_cima_de_outro()
        {
            var b = MontarOVestibulo();
            var ocupadas = new HashSet<Vector2Int>();

            for (int i = 0; i < b.Unidades.Count; i++)
                Assert.IsTrue(ocupadas.Add(b.Unidades[i].Casa),
                    "duas unidades na mesma casa " + b.Unidades[i].Casa);
        }

        [Test]
        public void A_linha_de_cima_do_desenho_e_o_Y_mais_alto__tambem_na_montagem()
        {
            // O Vestíbulo é SIMÉTRICO na vertical: lido de cabeça para baixo ele
            // devolveria um 'P' em cima de outro 'P' e um 'a' em cima de outro
            // 'a', e o defeito passaria verde. Por isso a prova da inversão
            // acontece numa sala torta de propósito:
            //     "P.#"   ← o herói mora no topo do desenho
            //     ".#."
            //     "#.a"   ← e o canto de baixo é parede
            // Espelhada, o herói cairia dentro do '#'.
            var b = Montador.DeSala(Acervo.DoLaboratorio(), "laboratorio", 0, new[] { "sumo" });

            Assert.AreEqual(new Vector2Int(0, 2), b.Unidades[0].Casa, "o 'P' da linha de cima é o Y mais alto");
            Assert.AreEqual(new Vector2Int(2, 0), b.Unidades[1].Casa, "o 'a' da linha de baixo é o Y zero");
            Assert.IsTrue(b.Mapa.Andavel(b.Unidades[0].Casa));
        }

        // ================================================================
        // A ordem de iniciativa
        // ================================================================

        [Test]
        public void A_fila_e_por_iniciativa__da_maior_para_a_menor()
        {
            // Números do acervo: Ladino 90, Vespa-Lustre 75, Bufo-de-Pólen 55,
            // Vergasta 35, Bárbaro 15.
            var b = MontarOVestibulo();
            var esperado = new[]
            {
                "espadachim", "lantern-wasp", "pollen-puff", "pollen-puff",
                "thorn-lasher", "thorn-lasher", "sumo"
            };

            for (int i = 0; i < esperado.Length; i++)
                Assert.AreEqual(esperado[i], b.Ordem[i].ClasseOuMonstroId,
                    "posição " + i + " da fila. Fila inteira: " + Fila(b));
        }

        [Test]
        public void Empate_de_iniciativa_desempata_pela_ordem_de_nascimento()
        {
            // Os dois Bufos empatam em 55 e as duas Vergastas em 35. `List.Sort`
            // não é estável: sem desempate explícito a fila poderia sair numa
            // ordem hoje e noutra amanhã, e uma batalha que muda de ordem
            // sozinha é impossível de reproduzir num relato de defeito.
            var b = MontarOVestibulo();

            Assert.AreEqual(new Vector2Int(6, 10), b.Ordem[2].Casa, "o Bufo de cima nasceu antes");
            Assert.AreEqual(new Vector2Int(6, 6),  b.Ordem[3].Casa, "o de baixo vem depois");
            Assert.AreEqual(new Vector2Int(14, 10), b.Ordem[4].Casa, "mesma regra para as Vergastas");
            Assert.AreEqual(new Vector2Int(14, 6),  b.Ordem[5].Casa);
        }

        [Test]
        public void Quem_abre_a_batalha_e_o_primeiro_da_fila()
        {
            var b = MontarOVestibulo();

            Assert.AreSame(b.Ordem[0], b.Atual, "`Atual` é o topo da fila de iniciativa");
            Assert.AreEqual("espadachim", b.Atual.ClasseOuMonstroId, "o Ladino tem a maior iniciativa em campo");
            Assert.AreEqual(1, b.Rodada, "a batalha começa na rodada 1");
        }

        [Test]
        public void O_uid_segue_a_ordem_de_NASCIMENTO__nao_a_de_iniciativa()
        {
            // A fila muda quando alguém morre; o uid não pode mudar junto, senão
            // a interface e a cena perdem a unidade que estavam desenhando.
            var b = MontarOVestibulo();

            for (int i = 0; i < b.Unidades.Count; i++)
                Assert.AreEqual("u" + (i + 1), b.Unidades[i].Uid);

            Assert.AreEqual("u2", b.Atual.Uid, "o Ladino nasceu em segundo e joga em primeiro");
        }

        // ================================================================
        // As fichas
        // ================================================================

        [Test]
        public void A_ficha_do_heroi_vem_da_classe__com_a_esquiva_dela()
        {
            var b = MontarOVestibulo();
            var barbaro = b.Unidades[0];
            var ladino = b.Unidades[1];

            Assert.AreEqual(150, barbaro.PVMax);
            Assert.AreEqual(6, barbaro.PAMax);
            Assert.AreEqual(3, barbaro.PPMax);
            Assert.AreEqual(95, ladino.PVMax);
            Assert.AreEqual(6, ladino.PAMax);
            Assert.AreEqual(4, ladino.PPMax, "o Ladino é o único com 4 PP");

            // Esquiva é identidade de classe, não um número igual para todos.
            Assert.AreEqual(5, barbaro.Esquiva, "o tanque prende");
            Assert.AreEqual(30, ladino.Esquiva, "o assassino escapa");
        }

        [Test]
        public void Heroi_montado_so_por_id_de_classe_e_nivel_1_e_neutro()
        {
            // `DeSala` recebe id de classe e nada de progressão. Ler elemento da
            // classe seria inventar uma escolha de caminho que o jogador não
            // fez — ela só acontece no nível 5, e para sempre.
            var b = MontarOVestibulo();

            Assert.AreEqual(1, b.Unidades[0].Nivel);
            Assert.AreEqual(Elemento.Neutro, b.Unidades[0].Elemento);
            Assert.AreEqual(Elemento.Neutro, b.Unidades[1].Elemento);
        }

        [Test]
        public void A_ficha_do_monstro_vem_do_bestiario_sem_reescala()
        {
            // Os números do monstro já chegam multiplicados pela profundidade do
            // calabouço — a fábrica do JS multiplica antes de escrever. Escalar
            // de novo aqui dobraria a dureza do jogo inteiro.
            var b = MontarOVestibulo();
            var bufo = Todas(b, "pollen-puff")[0];
            var vespa = Todas(b, "lantern-wasp")[0];

            Assert.AreEqual(45, bufo.PVMax);
            Assert.AreEqual(3, bufo.PAMax);
            Assert.AreEqual(3, bufo.PPMax);
            Assert.AreEqual(8, bufo.Esquiva);
            Assert.AreEqual(Elemento.Terra, bufo.Elemento);

            Assert.AreEqual(48, vespa.PVMax);
            Assert.AreEqual(4, vespa.PPMax);
            Assert.AreEqual(30, vespa.Esquiva);
            Assert.AreEqual(Elemento.Ar, vespa.Elemento, "a Vespa é a única de ar na sala");
        }

        [Test]
        public void Toda_unidade_nasce_inteira_viva_e_no_tabuleiro()
        {
            var b = MontarOVestibulo();

            for (int i = 0; i < b.Unidades.Count; i++)
            {
                var u = b.Unidades[i];
                Assert.AreEqual(u.PVMax, u.PV, u.Uid + " nasce com o PV cheio");
                Assert.AreEqual(u.PAMax, u.PA, u.Uid + " nasce com o PA cheio");
                Assert.AreEqual(u.PPMax, u.PP, u.Uid + " nasce com o PP cheio");
                Assert.IsTrue(u.Viva, u.Uid + " nasce viva");
                Assert.IsFalse(u.ForaDoTabuleiro, u.Uid + " nasce no tabuleiro");
            }
        }

        [Test]
        public void Os_dois_lados_sao_marcados_pelo_que_a_unidade_e()
        {
            var b = MontarOVestibulo();

            Assert.AreEqual(Motor.Lado.Heroi, b.Unidades[0].Lado);
            Assert.AreEqual(Motor.Lado.Heroi, b.Unidades[1].Lado);
            for (int i = Grupo.Length; i < b.Unidades.Count; i++)
                Assert.AreEqual(Motor.Lado.Monstro, b.Unidades[i].Lado, b.Unidades[i].Uid);
        }

        // ================================================================
        // Clima
        // ================================================================

        [Test]
        public void O_clima_da_SALA_ganha_do_padrao_do_calabouco()
        {
            // O Vestíbulo é `calmo` dentro de uma Estufa cujo padrão é `chuva`.
            // Ler o padrão primeiro apagaria a decisão de quem desenhou a sala.
            var b = MontarOVestibulo();

            Assert.AreEqual("chuva", Acervo.DaEstufa().AchaCalabouco(Estufa).ClimaPadrao,
                "o padrão da Estufa");
            Assert.AreEqual("calmo", b.Clima, "mas a sala declarou o dela");
        }

        [Test]
        public void Sala_sem_clima_proprio_cai_no_padrao_do_calabouco()
        {
            var b = Montador.DeSala(Acervo.DoLaboratorio(), "laboratorio", 4, Grupo);

            Assert.AreEqual("vendaval", b.Clima);
        }

        // ================================================================
        // Recusas de entrada
        // ================================================================

        [Test]
        public void Calabouco_desconhecido_e_recusado_pelo_id()
        {
            // `forge` é o THEME do Fecho de Brasa, não o id de calabouço nenhum
            // (SISTEMAS §6). Quem escrever o tema aqui merece a mensagem certa.
            var e = Assert.Throws<ArgumentException>(delegate
            {
                Montador.DeSala(Acervo.DaEstufa(), "forge", 0, Grupo);
            });
            StringAssert.Contains("calabouço desconhecido", e.Message);
        }

        [Test]
        public void Indice_de_sala_fora_da_lista_e_recusado()
        {
            var e = Assert.Throws<ArgumentOutOfRangeException>(delegate
            {
                Montador.DeSala(Acervo.DaEstufa(), Estufa, 99, Grupo);
            });
            StringAssert.Contains("sala inválida", e.Message);
        }

        [Test]
        public void Grupo_vazio_e_recusado()
        {
            Assert.Throws<ArgumentException>(delegate
            {
                Montador.DeSala(Acervo.DaEstufa(), Estufa, Vestibulo, new string[0]);
            });
            Assert.Throws<ArgumentException>(delegate
            {
                Montador.DeSala(Acervo.DaEstufa(), Estufa, Vestibulo, null);
            });
        }

        [Test]
        public void Classe_desconhecida_e_recusada()
        {
            // `Bárbaro` é o NOME na tela; o id é `sumo`. Procurar classe por
            // nome é como o dado é perdido (SISTEMAS §3).
            var e = Assert.Throws<InvalidOperationException>(delegate
            {
                Montador.DeSala(Acervo.DaEstufa(), Estufa, Vestibulo, new[] { "Bárbaro" });
            });
            StringAssert.Contains("classe desconhecida", e.Message);
        }

        // ================================================================
        // O acervo exportado, os seis calabouços
        // ================================================================

        [Test]
        public void O_Vestibulo_exportado_monta_igual_ao_da_fixtura()
        {
            var b = Montador.DeSala(Acervo.DeVerdadeOuInconclusivo(), Estufa, Vestibulo, Grupo);

            Assert.AreEqual(7, b.Unidades.Count, "dois heróis e cinco monstros");
            Assert.AreEqual(new Vector2Int(1, 9), b.Unidades[0].Casa);
            Assert.AreEqual("pollen-puff", Em(b, 6, 10).ClasseOuMonstroId);
            Assert.AreEqual("lantern-wasp", Em(b, 17, 8).ClasseOuMonstroId);
            Assert.AreEqual("calmo", b.Clima);
            Assert.AreEqual("espadachim", b.Atual.ClasseOuMonstroId);
        }

        [Test]
        public void Toda_sala_dos_seis_calaboucos_monta__e_ninguem_se_perde_no_caminho()
        {
            // O varredor existe porque um defeito de montagem quase nunca
            // aparece na primeira sala: ele mora na sala do chefe do quinto
            // calabouço, que ninguém abre à mão.
            var banco = Acervo.DeVerdadeOuInconclusivo();
            var queixas = new StringBuilder();
            int salas = 0;

            for (int c = 0; c < banco.Calabocos.Count; c++)
            {
                var calabouco = banco.Calabocos[c];
                for (int s = 0; s < calabouco.Salas.Count; s++)
                {
                    var sala = calabouco.Salas[s];
                    var onde = calabouco.Id + "[" + s + "] '" + sala.Nome + "'";
                    salas++;

                    Motor.Batalha b;
                    try
                    {
                        b = Montador.DeSala(banco, calabouco.Id, s, Grupo);
                    }
                    catch (Exception e)
                    {
                        queixas.Append("\n  - ").Append(onde).Append(": ").Append(e.Message);
                        continue;
                    }

                    int esperado = Grupo.Length + Acervo.NascimentosDeMonstroNoDesenho(sala);
                    if (b.Unidades.Count != esperado)
                        queixas.Append("\n  - ").Append(onde).Append(": o desenho pede ")
                               .Append(esperado).Append(" unidades e a montagem fez ")
                               .Append(b.Unidades.Count);

                    var ocupadas = new HashSet<Vector2Int>();
                    for (int u = 0; u < b.Unidades.Count; u++)
                    {
                        var unidade = b.Unidades[u];
                        if (!b.Mapa.Andavel(unidade.Casa))
                            queixas.Append("\n  - ").Append(onde).Append(": ")
                                   .Append(unidade.ClasseOuMonstroId).Append(" nasceu em ")
                                   .Append(unidade.Casa).Append(", que é ").Append(b.Mapa.Em(unidade.Casa));
                        if (!ocupadas.Add(unidade.Casa))
                            queixas.Append("\n  - ").Append(onde).Append(": duas unidades em ")
                                   .Append(unidade.Casa);
                    }
                }
            }

            Assert.AreEqual(6, banco.Calabocos.Count, "são seis calabouços (SISTEMAS §6)");
            Assert.Greater(salas, 0, "nenhum calabouço trouxe sala");
            if (queixas.Length > 0) Assert.Fail("salas que não montam:" + queixas);
        }
    }
}
