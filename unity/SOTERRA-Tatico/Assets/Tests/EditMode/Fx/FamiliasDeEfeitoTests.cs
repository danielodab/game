using System.Collections.Generic;
using System.IO;
using System.Text;
using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.Fx
{
    // ARMADILHA DE NOME, já paga por esta equipe: dentro de `Soterra.Testes.Fx`,
    // `Fx.X` acharia o namespace irmão antes de `Soterra.Fx` (CS0234). Apelidos
    // globais travam no certo.
    using Fx = global::Soterra.Fx;
    using Dados = global::Soterra.Dados;

    /// <summary>
    /// As 21 famílias e a varredura do ACERVO REAL.
    ///
    /// Este é o teste que a rodada existe para escrever. O defeito que ele
    /// tranca é conhecido e tem nome: na linha JS, o despacho conhecia nove
    /// nomes genéricos, o acervo declarava 187 chaves autorais, NENHUMA batia, e
    /// todo feitiço do jogo virava a mesma bolinha. Nada disso dava erro — só
    /// dava um jogo em que "entre todos os que testei o efeito foi o mesmo".
    ///
    /// Por isso a varredura passa por TODAS as chaves de TODAS as tabelas, e não
    /// por uma amostra: uma amostra teria passado no jogo quebrado.
    /// </summary>
    public class FamiliasDeEfeitoTests
    {
        static Dados.BancoDeDados _banco;

        static Dados.BancoDeDados Banco()
        {
            if (_banco != null) return _banco;
            var caminho = (Application.dataPath + "/Resources/dados/" +
                           Dados.Manifesto.Chave + ".json").Replace('\\', '/');
            if (!File.Exists(caminho))
                Assert.Inconclusive("o acervo ainda não foi exportado: falta " + caminho);
            _banco = Dados.BancoDeDados.CarregarDeResources();
            return _banco;
        }

        /// <summary>
        /// Toda chave de efeito que o jogo pode chegar a desenhar: as cinco
        /// tabelas de feitiço MAIS o <c>fxShape</c> das 105 formas de fusão, que
        /// usa outro vocabulário e é por onde os 2.625 compostos entram.
        /// Esquecer as formas deixaria a fusão inteira fora da varredura.
        /// </summary>
        static List<string> ChavesDoAcervo()
        {
            var b = Banco();
            var chaves = new List<string>();

            void Colher(IDictionary<string, Dados.Feitico> tabela)
            {
                if (tabela == null) return;
                foreach (var f in tabela.Values)
                    if (f != null && !string.IsNullOrEmpty(f.ChaveDeEfeito)) chaves.Add(f.ChaveDeEfeito);
            }

            Colher(b.Feiticos);
            Colher(b.FeiticosDeMonstro);
            Colher(b.FeiticosDeBicho);
            Colher(b.FeiticosDeItem);
            Colher(b.FeiticosDeFusao);

            if (b.FormasDeFusao != null)
                foreach (var lista in b.FormasDeFusao.Values)
                {
                    if (lista == null) continue;
                    for (int i = 0; i < lista.Count; i++)
                        if (lista[i] != null && !string.IsNullOrEmpty(lista[i].DesenhoDoEfeito))
                            chaves.Add(lista[i].DesenhoDoEfeito);
                }

            return chaves;
        }

        [Test]
        public void AsVinteEUmaFamilias_ExistemPorNome_ESemRepetir()
        {
            Assert.AreEqual(21, Fx.FamiliaDeEfeito.Todas.Count,
                            "SISTEMAS §4 fecha em 21 famílias; a lista tem outro tamanho");

            var vistas = new HashSet<string>();
            for (int i = 0; i < Fx.FamiliaDeEfeito.Todas.Count; i++)
            {
                var nome = Fx.FamiliaDeEfeito.Todas[i];
                Assert.IsFalse(string.IsNullOrEmpty(nome), "família sem nome na posição " + i);
                Assert.IsTrue(vistas.Add(nome), "a família '" + nome + "' está listada duas vezes");
            }

            // Os nomes de SISTEMAS §4, um a um. Renomear qualquer um deles em
            // silêncio faria os moldes e o despacho pararem de se encontrar.
            foreach (var esperada in new[]
            {
                "meteoro", "chuva", "cone", "cruz", "anel", "terremoto", "onda",
                "investida", "corte", "armadilha", "invocacao", "aura", "cura",
                "feixe", "flecha", "estouro", "escudo", "piscar", "gancho",
                "maldicao", "bola"
            })
                Assert.IsTrue(vistas.Contains(esperada),
                              "SISTEMAS §4 lista a família '" + esperada + "' e ela não existe");
        }

        [Test]
        public void CadaFamilia_TemMolde_ComCamadaEQuadroDoAtlas()
        {
            var moldes = Fx.MoldeDeEfeito.Todos();
            var atlas = Fx.AtlasDeEfeito.CarregarDeResources();

            for (int i = 0; i < Fx.FamiliaDeEfeito.Todas.Count; i++)
            {
                var familia = Fx.FamiliaDeEfeito.Todas[i];
                Fx.MoldeDeEfeito molde;
                Assert.IsTrue(moldes.TryGetValue(familia, out molde),
                              "a família '" + familia + "' não tem desenho — ela cairia no vazio " +
                              "e o feitiço acertaria em silêncio, que é o defeito desta rodada");

                Assert.Greater(molde.Camadas.Length, 0, familia + " sem camada nenhuma");
                Assert.Greater(molde.Duracao, 0f, familia + " dura zero segundo");

                for (int c = 0; c < molde.Camadas.Length; c++)
                {
                    var camada = molde.Camadas[c];
                    Assert.Greater(camada.Quantidade, 0,
                                   familia + " camada " + c + " não emite partícula nenhuma");
                    Assert.Greater(camada.Vida, 0f, familia + " camada " + c + " com vida zero");

                    if (atlas.Completo)
                        Assert.IsTrue(atlas.TemQuadro(camada.Quadro),
                                      familia + " camada " + c + " pede o quadro '" + camada.Quadro +
                                      "', que não existe em Resources/fx/_mapa.json — a partícula " +
                                      "sairia no quadro 0 sem erro nenhum");
                }
            }
        }

        [Test]
        public void TodoFxKeyDoAcervo_CaiNumaFamiliaConhecida()
        {
            var chaves = ChavesDoAcervo();
            Assert.Greater(chaves.Count, 150,
                           "o acervo devolveu " + chaves.Count + " chaves de efeito; a exportação " +
                           "de hoje traz mais de 300 (com repetição) — a varredura está cega");

            var orfas = new List<string>();
            foreach (var chave in chaves)
            {
                var familia = Fx.FamiliaDeEfeito.DeChave(chave);
                if (!Fx.FamiliaDeEfeito.Existe(familia)) orfas.Add(chave + " → '" + familia + "'");
            }

            Assert.IsEmpty(orfas,
                           "estas chaves não caíram em nenhuma das 21 famílias: " +
                           string.Join(", ", orfas));
        }

        /// <summary>
        /// As chaves que caem na bola, NOMEADAS uma a uma.
        ///
        /// Não é um teto percentual: teto percentual passa enquanto o acervo
        /// cresce e some com o dia em que alguém acrescenta vinte chaves novas
        /// sem regra. Cravada a lista, chave nova sem dono FALHA e se apresenta
        /// pelo nome — que é a única forma de a falta aparecer.
        ///
        /// A bola continua sendo o último recurso, como no JS: 8 de 187 chaves
        /// distintas, 4,3%.
        /// </summary>
        [Test]
        public void ABola_EOUltimoRecurso_ESoParaEstasChaves()
        {
            var conhecidas = new HashSet<string>
            {
                "chainCollect", "dissolution", "emberBurst", "foldedPyre",
                "poisonCloud", "sealedGarden", "shortShadow", "warCry"
            };

            var distintas = new HashSet<string>(ChavesDoAcervo());
            var naBola = new SortedSet<string>();
            foreach (var chave in distintas)
                if (Fx.FamiliaDeEfeito.DeChave(chave) == Fx.FamiliaDeEfeito.Bola) naBola.Add(chave);

            var novas = new List<string>();
            foreach (var chave in naBola) if (!conhecidas.Contains(chave)) novas.Add(chave);

            var sumiram = new List<string>();
            foreach (var chave in conhecidas) if (!naBola.Contains(chave)) sumiram.Add(chave);

            var erro = new StringBuilder();
            if (novas.Count > 0)
                erro.Append("chaves NOVAS sem família própria (falta uma regra em ")
                    .Append("FamiliaDeEfeito): ").Append(string.Join(", ", novas)).Append(". ");
            if (sumiram.Count > 0)
                erro.Append("chaves que deixaram de cair na bola — ótimo, mas atualize a lista ")
                    .Append("deste teste: ").Append(string.Join(", ", sumiram)).Append(". ");

            Assert.IsEmpty(erro.ToString(), erro.ToString());

            Assert.Less(naBola.Count * 100 / Mathf.Max(1, distintas.Count), 10,
                        "a bola virou o caminho comum outra vez: " + naBola.Count + " de " +
                        distintas.Count + " chaves distintas. Era assim que o jogo inteiro saía " +
                        "com o mesmo efeito");
        }

        /// <summary>
        /// Os casos em que a ORDEM das regras decide, e que erram sozinhos se
        /// alguém reordenar a tabela. Cada linha aqui é uma armadilha real do
        /// vocabulário do acervo.
        /// </summary>
        [Test]
        public void AOrdemDasRegras_PoeOEspecificoAntesDoGenerico()
        {
            // 'stoneSentinelCall' tem 'stone' (terremoto) E termina em 'call'
            // (invocação). É uma INVOCAÇÃO: quem chega é a sentinela, não a pedra.
            Assert.AreEqual(Fx.FamiliaDeEfeito.Invocacao,
                            Fx.FamiliaDeEfeito.DeChave("stoneSentinelCall"));

            // 'emberRain' é CHUVA, não brasa: o que se vê é a queda, não o fogo.
            Assert.AreEqual(Fx.FamiliaDeEfeito.Chuva, Fx.FamiliaDeEfeito.DeChave("emberRain"));

            // 'emberTrap' tem 'trap' e a armadilha vem antes de tudo que é fogo:
            // ela PLANTA, e plantar não se parece com estourar.
            Assert.AreEqual(Fx.FamiliaDeEfeito.Armadilha, Fx.FamiliaDeEfeito.DeChave("emberTrap"));

            // 'maelstromTrap' tem 'maelstrom' (anel) e 'trap': armadilha ganha.
            Assert.AreEqual(Fx.FamiliaDeEfeito.Armadilha,
                            Fx.FamiliaDeEfeito.DeChave("maelstromTrap"));

            // 'lesserMeteor' cai do céu, e meteoro é a primeira regra de todas.
            Assert.AreEqual(Fx.FamiliaDeEfeito.Meteoro, Fx.FamiliaDeEfeito.DeChave("lesserMeteor"));

            // 'ashCone' ABRE a partir do conjurador.
            Assert.AreEqual(Fx.FamiliaDeEfeito.Cone, Fx.FamiliaDeEfeito.DeChave("ashCone"));

            // 'forgeBreath' tem 'forge' (aura) e 'breath' (cone) — cone vem
            // antes, e é o que o feitiço FAZ: um sopro.
            Assert.AreEqual(Fx.FamiliaDeEfeito.Cone, Fx.FamiliaDeEfeito.DeChave("forgeBreath"));

            // Os genéricos antigos do `fxShape` das formas de fusão continuam
            // valendo, e não pelo acaso de uma expressão: 'nova' cairia na bola.
            Assert.AreEqual(Fx.FamiliaDeEfeito.Anel, Fx.FamiliaDeEfeito.DeChave("nova"));
            Assert.AreEqual(Fx.FamiliaDeEfeito.Cura, Fx.FamiliaDeEfeito.DeChave("heal"));
            Assert.AreEqual(Fx.FamiliaDeEfeito.Investida, Fx.FamiliaDeEfeito.DeChave("slam"));
            Assert.AreEqual(Fx.FamiliaDeEfeito.Feixe, Fx.FamiliaDeEfeito.DeChave("beam"));
            Assert.AreEqual(Fx.FamiliaDeEfeito.Escudo, Fx.FamiliaDeEfeito.DeChave("shieldFx"));
            Assert.AreEqual(Fx.FamiliaDeEfeito.Invocacao, Fx.FamiliaDeEfeito.DeChave("summonFx"));
            Assert.AreEqual(Fx.FamiliaDeEfeito.Estouro, Fx.FamiliaDeEfeito.DeChave("burst"));
        }

        [Test]
        public void ChaveVaziaOuDesconhecida_NaoDeixaOFeiticoSemDesenho()
        {
            // Nulo devolve BOLA, e não nulo: um feitiço sem fxKey ainda tem de
            // aparecer na tela. Foi o silêncio que trouxe esta rodada.
            Assert.AreEqual(Fx.FamiliaDeEfeito.Bola, Fx.FamiliaDeEfeito.DeChave(null));
            Assert.AreEqual(Fx.FamiliaDeEfeito.Bola, Fx.FamiliaDeEfeito.DeChave(""));
            Assert.AreEqual(Fx.FamiliaDeEfeito.Bola, Fx.FamiliaDeEfeito.DeChave("xyzzy-inexistente"));
        }
    }
}
