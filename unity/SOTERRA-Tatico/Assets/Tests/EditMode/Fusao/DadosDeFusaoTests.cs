using System.Collections.Generic;
using NUnit.Framework;

namespace Soterra.Testes.Fusao
{
    // `Dados.X` dentro de `Soterra.Testes.Fusao` acha `Soterra.Testes.Dados`
    // antes de chegar em `Soterra.Dados` (CS0234) — a mesma armadilha do
    // apelido de `Motor` nos testes do motor. O apelido global trava no lugar
    // certo.
    using Dados = global::Soterra.Dados;
    using Cenario = global::Soterra.Testes.Motor.Cenario;

    /// <summary>
    /// As chaves de fusão do acervo REAL: 15 duplas, 7 degraus cada, 25
    /// misturas, 15 identidades. Todo número aqui sai de
    /// <c>Assets/Resources/dados/</c> ou de uma conta sobre ele — nunca de uma
    /// constante bonita digitada no teste.
    /// </summary>
    public class DadosDeFusaoTests
    {
        [Test]
        public void Sao_15_duplas_com_7_degraus_cada()
        {
            var formas = Cenario.Acervo().FormasDeFusao;
            Assert.AreEqual(15, formas.Count,
                "15 duplas = as combinações de 6 classes 2 a 2");

            foreach (var par in formas)
            {
                Assert.AreEqual(7, par.Value.Count,
                    "a dupla " + par.Key + " tem 7 degraus de arsenal");
                foreach (var forma in par.Value)
                {
                    Assert.IsNotNull(forma, par.Key + " tem forma nula");
                    Assert.IsFalse(string.IsNullOrEmpty(forma.NomeDaForma),
                        par.Key + " tem forma sem nome no degrau " + forma.Degrau);
                    Assert.IsNotNull(forma.Mecanica, forma.NomeDaForma + " sem mecânica");
                    Assert.Greater(forma.Mecanica.Count, 0,
                        forma.NomeDaForma + " tem mecânica vazia — a forma É a mecânica");
                }
            }
        }

        /// <summary>
        /// Toda chave de dupla é ALFABÉTICA e formada por duas das seis classes
        /// reais — é o contrato do id: é por ele que a Cena carrega o modelo de
        /// <c>Resources/elenco/arqueiro+bruxo/</c> sem código novo.
        /// </summary>
        [Test]
        public void A_chave_da_dupla_e_alfabetica_e_usa_as_classes_reais()
        {
            var acervo = Cenario.Acervo();
            foreach (var chave in acervo.FormasDeFusao.Keys)
            {
                var partes = chave.Split('+');
                Assert.AreEqual(2, partes.Length, chave);
                Assert.Less(string.CompareOrdinal(partes[0], partes[1]), 0,
                    chave + " não está em ordem alfabética estrita");
                Assert.IsTrue(acervo.Classes.ContainsKey(partes[0]), partes[0] + " não é classe");
                Assert.IsTrue(acervo.Classes.ContainsKey(partes[1]), partes[1] + " não é classe");
            }
        }

        /// <summary>
        /// A escada de degraus é 0 + os seis desbloqueios do acervo
        /// (<c>unlockTiers</c>): 0, 5, 10, 12, 15, 20, 30. O 0 existe porque a
        /// fusão precisa de arsenal mesmo entre dois heróis de nível 1.
        /// </summary>
        [Test]
        public void A_escada_de_degraus_e_0_mais_os_desbloqueios()
        {
            var acervo = Cenario.Acervo();
            var escada = new List<int> { 0 };
            escada.AddRange(acervo.DegrausDeDesbloqueio);

            foreach (var par in acervo.FormasDeFusao)
            {
                var degraus = new List<int>();
                foreach (var forma in par.Value) degraus.Add(forma.Degrau);
                degraus.Sort();
                CollectionAssert.AreEqual(escada, degraus,
                    "a escada de " + par.Key + " diverge da do acervo");
            }
        }

        /// <summary>
        /// 25 misturas, e não 16: são os pares ORDENADOS dos 5 elementos, o
        /// <c>neutro</c> incluso — herói abaixo do nível 5 ainda não escolheu
        /// caminho e a fusão tem de funcionar assim mesmo. O produto cartesiano
        /// é calculado dos elementos REAIS do acervo.
        /// </summary>
        [Test]
        public void Sao_25_misturas_os_pares_ordenados_dos_5_elementos()
        {
            var acervo = Cenario.Acervo();
            var misturas = acervo.MisturasDeFusao;
            Assert.AreEqual(25, misturas.Count);
            Assert.AreEqual(5, acervo.Elementos.Count, "5 elementos, neutro incluso");

            foreach (var a in acervo.Elementos)
                foreach (var b in acervo.Elementos)
                    Assert.IsTrue(misturas.ContainsKey(a + "+" + b),
                        "falta a mistura " + a + "+" + b);
        }

        /// <summary>
        /// As 10 espelhadas existem para <c>@A</c>/<c>@B</c> resolverem no
        /// elemento certo em qualquer ordem de declaração: mesma cara
        /// (afixo), <c>elements</c> INVERTIDO.
        /// </summary>
        [Test]
        public void A_mistura_espelhada_inverte_os_elementos_e_mantem_o_afixo()
        {
            var misturas = Cenario.Acervo().MisturasDeFusao;
            int espelhadas = 0;

            foreach (var par in misturas)
            {
                var m = par.Value;
                if (string.IsNullOrEmpty(m.EspelhoDe)) continue;
                espelhadas++;

                Soterra.Dados.MisturaDeFusao canonica;
                Assert.IsTrue(misturas.TryGetValue(m.EspelhoDe, out canonica),
                    par.Key + " espelha " + m.EspelhoDe + ", que não existe");
                Assert.AreEqual(canonica.Afixo, m.Afixo, "o sabor é o mesmo dos dois lados");
                Assert.AreEqual(canonica.Elementos[0], m.Elementos[1], par.Key);
                Assert.AreEqual(canonica.Elementos[1], m.Elementos[0], par.Key);
            }

            // 25 chaves = 15 canônicas (5 iguais + 10 mistas) + 10 espelhadas.
            Assert.AreEqual(10, espelhadas);
        }

        [Test]
        public void Sao_15_identidades_uma_por_dupla()
        {
            var acervo = Cenario.Acervo();
            Assert.AreEqual(15, acervo.IdentidadesDeFusao.Count);

            foreach (var chave in acervo.FormasDeFusao.Keys)
            {
                Soterra.Dados.IdentidadeDeFusao id;
                Assert.IsTrue(acervo.IdentidadesDeFusao.TryGetValue(chave, out id),
                    "a dupla " + chave + " não tem identidade");
                Assert.IsFalse(string.IsNullOrEmpty(id.Nome), chave + " sem nome");
                Assert.IsFalse(string.IsNullOrEmpty(id.Frase), chave + " sem frase");
            }
        }

        /// <summary>
        /// O ajuste de equilíbrio POR DUPLA (<c>Fusion.PAIR_TUNE</c> do JS)
        /// cobre exatamente as 15 duplas do acervo — nem uma a mais (valor
        /// órfão que ninguém usa), nem uma a menos (dupla medindo com ajuste
        /// padrão em silêncio).
        /// </summary>
        [Test]
        public void O_ajuste_por_dupla_cobre_as_15_duplas_do_acervo()
        {
            var formas = Cenario.Acervo().FormasDeFusao;
            Assert.AreEqual(formas.Count, Dados.Fusao.AjustePorDupla.Count);
            foreach (var chave in formas.Keys)
                Assert.IsTrue(Dados.Fusao.AjustePorDupla.ContainsKey(chave),
                    "a dupla " + chave + " está sem ajuste de equilíbrio");
        }

        [Test]
        public void A_chave_de_par_ordena_alfabeticamente_e_neutraliza_vazio()
        {
            Assert.AreEqual("arqueiro+bruxo", Dados.Fusao.ChaveDePar("bruxo", "arqueiro"));
            Assert.AreEqual("arqueiro+bruxo", Dados.Fusao.ChaveDePar("arqueiro", "bruxo"));
            Assert.AreEqual("fogo+fogo", Dados.Fusao.ChaveDePar("fogo", "fogo"));
            // O `pairKey` do JS troca vazio por 'neutro' — é o que faz herói
            // sem elemento (nível < 5) cair na mistura com neutro.
            Assert.AreEqual("fogo+neutro", Dados.Fusao.ChaveDePar(null, "fogo"));
            Assert.AreEqual("neutro+neutro", Dados.Fusao.ChaveDePar(null, null));
        }
    }
}
