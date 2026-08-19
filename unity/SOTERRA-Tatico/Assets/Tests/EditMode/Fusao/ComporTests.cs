using System.Collections.Generic;
using NUnit.Framework;

namespace Soterra.Testes.Fusao
{
    // `Dados.X` dentro de `Soterra.Testes.Fusao` acha `Soterra.Testes.Dados`
    // antes de chegar em `Soterra.Dados` (CS0234). O apelido global trava no
    // lugar certo.
    using Dados = global::Soterra.Dados;
    using Cenario = global::Soterra.Testes.Motor.Cenario;

    /// <summary>
    /// A composição forma × mistura: 105 × 25 = 2.625 feitiços possíveis,
    /// compostos sob demanda e nunca gravados em arquivo. A regra que estes
    /// testes mais vigiam é a divisão de papéis — a FORMA decide a mecânica e o
    /// desenho, a MISTURA decide o sabor —, porque ela já esteve INVERTIDA no
    /// JS e era um defeito grave: 25 misturas cobriam 105 formas e toda fusão
    /// do mesmo par de elementos saía com o mesmo efeito.
    /// </summary>
    public class ComporTests
    {
        static Dados.BancoDeDados Acervo()
        {
            return Cenario.Acervo();
        }

        /// <summary>
        /// A varredura inteira: cada uma das 15 duplas com cada uma das 25
        /// misturas, no nível 30, rende os 7 degraus — 2.625 feitiços, cada um
        /// com id único, nome <c>forma + afixo</c>, MECÂNICA da forma (tipo a
        /// tipo, na ordem), RIDER da mistura no rabo e DESENHO da forma. É o
        /// teste anti-inversão em peso: se a mistura sobrepusesse a forma, a
        /// sequência de tipos deixaria de bater com a mecânica da forma já na
        /// primeira dupla.
        /// </summary>
        [Test]
        public void As_2625_composicoes_forma_manda_na_mecanica_mistura_no_sabor()
        {
            var acervo = Acervo();
            var ids = new HashSet<string>();

            foreach (var dupla in acervo.FormasDeFusao)
            {
                foreach (var mistura in acervo.MisturasDeFusao)
                {
                    var feiticos = Dados.Fusao.Compor(acervo, dupla.Key, mistura.Key, 30);
                    Assert.AreEqual(7, feiticos.Count,
                        dupla.Key + " × " + mistura.Key + " no nível 30 rende os 7 degraus");

                    foreach (var f in feiticos)
                    {
                        Assert.IsTrue(ids.Add(f.Id), "id repetido: " + f.Id);

                        var forma = FormaDoDegrau(dupla.Value, f.NivelDeDesbloqueio);
                        var m = mistura.Value;

                        // O NOME é a soma das duas metades.
                        Assert.AreEqual(forma.NomeDaForma + " " + m.Afixo, f.Nome, f.Id);

                        // A FORMA manda na mecânica: os primeiros efeitos são os
                        // dela, tipo a tipo, na ordem dela.
                        var rider = (forma.ModoDoRider == "support" && m.RiderDeApoio != null)
                            ? m.RiderDeApoio : m.Rider;
                        Assert.AreEqual(forma.Mecanica.Count + rider.Count, f.Efeitos.Count, f.Id);
                        for (int i = 0; i < forma.Mecanica.Count; i++)
                            Assert.AreEqual(forma.Mecanica[i].Tipo, f.Efeitos[i].Tipo,
                                f.Id + ": a mecânica é da FORMA");

                        // A MISTURA manda no sabor: o rider dela fecha a lista.
                        for (int i = 0; i < rider.Count; i++)
                            Assert.AreEqual(rider[i].Tipo,
                                f.Efeitos[forma.Mecanica.Count + i].Tipo,
                                f.Id + ": o rider é da MISTURA");

                        // E o DESENHO é da forma — a linha exata que esteve
                        // invertida no JS.
                        Assert.AreEqual(forma.DesenhoDoEfeito, f.ChaveDeEfeito,
                            f.Id + ": o desenho é da FORMA, não da mistura");

                        // Custos e restrições vêm da forma, não inventados.
                        Assert.AreEqual(forma.CustoDePa, f.CustoDePa, f.Id);
                        Assert.AreEqual(forma.Recarga, f.Recarga, f.Id);
                        Assert.AreEqual(forma.LancamentosPorTurno, f.LancamentosPorTurno, f.Id);
                        Assert.AreEqual(forma.Alvo, f.Alvo, f.Id);
                        Assert.AreEqual(forma.ExigeCasaVazia, f.ExigeCasaVazia, f.Id);
                        Assert.AreSame(forma.Alcance, f.Alcance, f.Id);
                        Assert.AreSame(forma.Area, f.Area, f.Id);

                        // Nenhum token sobra sem resolver.
                        Assert.AreEqual(m.Elementos[0], f.Elemento, f.Id);
                        foreach (var e in f.Efeitos)
                            Assert.IsFalse(e.Elemento != null && e.Elemento.StartsWith("@"),
                                f.Id + " deixou token por resolver: " + e.Elemento);
                    }
                }
            }

            Assert.AreEqual(15 * 25 * 7, ids.Count, "2.625 feitiços, todos distintos");
        }

        /// <summary>
        /// O teste anti-inversão nomeado: duas formas diferentes com a MESMA
        /// mistura têm mecânicas diferentes. Com a regra invertida (a mistura
        /// sobrepondo a forma), as duas sairiam com o efeito da mistura —
        /// escudo, meteoro e gancho idênticos. As duas formas são ACHADAS no
        /// acervo pela diferença de tipos, não escolhidas pelo nome: o teste
        /// continua valendo se o dado renomear tudo.
        /// </summary>
        [Test]
        public void Duas_formas_diferentes_com_a_mesma_mistura_tem_mecanicas_diferentes()
        {
            var acervo = Acervo();
            var mistura = PrimeiraChave(acervo.MisturasDeFusao.Keys);

            // Duas formas de TIPOS de mecânica diferentes, de qualquer dupla.
            string dupla1 = null, dupla2 = null;
            Dados.FormaDeFusao forma1 = null, forma2 = null;
            foreach (var par in acervo.FormasDeFusao)
            {
                foreach (var forma in par.Value)
                {
                    if (forma1 == null) { dupla1 = par.Key; forma1 = forma; continue; }
                    if (TiposDe(forma.Mecanica) != TiposDe(forma1.Mecanica))
                    {
                        dupla2 = par.Key; forma2 = forma;
                    }
                }
            }
            Assert.IsNotNull(forma2, "o acervo tem 23 tipos de efeito — duas mecânicas diferem");

            var f1 = AchaDegrau(Dados.Fusao.Compor(acervo, dupla1, mistura, 30), forma1.Degrau);
            var f2 = AchaDegrau(Dados.Fusao.Compor(acervo, dupla2, mistura, 30), forma2.Degrau);

            Assert.AreNotEqual(
                TiposDe(f1.Efeitos.GetRange(0, forma1.Mecanica.Count)),
                TiposDe(f2.Efeitos.GetRange(0, forma2.Mecanica.Count)),
                "mesma mistura, formas diferentes: as mecânicas TÊM de diferir — " +
                "igualdade aqui é a inversão que já foi defeito no JS");
            Assert.AreEqual(TiposDe(forma1.Mecanica),
                TiposDe(f1.Efeitos.GetRange(0, forma1.Mecanica.Count)),
                "e cada uma é a mecânica DA SUA forma");
            Assert.AreEqual(TiposDe(forma2.Mecanica),
                TiposDe(f2.Efeitos.GetRange(0, forma2.Mecanica.Count)));
        }

        /// <summary>
        /// <c>@A</c> é o elemento do ANFITRIÃO e <c>@B</c> o do convidado —
        /// qualquer que seja a ordem de declaração. É para isso que as 10
        /// misturas espelhadas existem: <c>fogo+agua</c> e <c>agua+fogo</c> têm
        /// o mesmo afixo e <c>elements</c> invertido.
        /// </summary>
        [Test]
        public void Os_tokens_resolvem_na_ordem_dos_fundidos()
        {
            var acervo = Acervo();

            // Acha no DADO uma forma cuja mecânica usa '@A' — o teste não
            // pressupõe qual é.
            string dupla = null;
            int degrau = -1, indice = -1;
            foreach (var par in acervo.FormasDeFusao)
            {
                foreach (var forma in par.Value)
                    for (int i = 0; i < forma.Mecanica.Count; i++)
                        if (forma.Mecanica[i].Elemento == "@A")
                        {
                            dupla = par.Key; degrau = forma.Degrau; indice = i;
                        }
                if (dupla != null) break;
            }
            Assert.IsNotNull(dupla, "o acervo tem 113 tokens '@A' — algum tinha de aparecer");

            var fogoAgua = AchaDegrau(Dados.Fusao.Compor(acervo, dupla, "fogo+agua", 30), degrau);
            var aguaFogo = AchaDegrau(Dados.Fusao.Compor(acervo, dupla, "agua+fogo", 30), degrau);

            Assert.AreEqual("fogo", fogoAgua.Efeitos[indice].Elemento,
                "declarado por quem é de fogo, '@A' é fogo");
            Assert.AreEqual("agua", aguaFogo.Efeitos[indice].Elemento,
                "declarado por quem é de água, '@A' é água");
            Assert.AreEqual(fogoAgua.Nome, aguaFogo.Nome,
                "o afixo da mistura é o mesmo dos dois lados do espelho");
            Assert.AreNotEqual(fogoAgua.Id, aguaFogo.Id,
                "mas os ids guardam a ordem dos fundidos");
        }

        /// <summary>
        /// O degrau vem do NÍVEL da fusão: só entra forma com degrau ≤ nível.
        /// A contagem esperada é derivada do acervo para cada nível da escada —
        /// inclusive o 0, que é o de dois heróis de nível 1 fundidos (nível
        /// (1+1)/2 = 1, e só o degrau 0 cabe).
        /// </summary>
        [Test]
        public void O_arsenal_cresce_com_o_nivel_da_fusao()
        {
            var acervo = Acervo();
            var dupla = PrimeiraChave(acervo.FormasDeFusao.Keys);
            var mistura = PrimeiraChave(acervo.MisturasDeFusao.Keys);
            var formas = acervo.FormasDeFusao[dupla];

            foreach (var nivel in new[] { 0, 1, 4, 5, 11, 12, 14, 20, 29, 30 })
            {
                int esperado = 0;
                foreach (var f in formas)
                    if (f.Degrau <= nivel) esperado++;

                Assert.AreEqual(esperado,
                    Dados.Fusao.Compor(acervo, dupla, mistura, nivel).Count,
                    "arsenal no nível " + nivel);
            }
        }

        /// <summary>
        /// O fator de poder é o <c>Fusion.powerFactor</c> do JS, literal:
        /// <c>(100 + nível×1,2 + degrau×1)/100 × 1,144 × ajuste</c>. Os pinos
        /// abaixo usam os números do <c>fusion.js</c> (POWER_MULT 1,144;
        /// arqueiro+bruxo 1,046) de propósito: se alguém "arredondar" uma
        /// constante, o teste conta.
        /// </summary>
        [Test]
        public void O_fator_de_poder_e_o_do_fusion_js()
        {
            Assert.AreEqual(1.144, Dados.Fusao.FatorDePoder(0, 0, null), 1e-9,
                "sem dupla conhecida, só o multiplicador global");
            Assert.AreEqual(1.144 * 1.046, Dados.Fusao.FatorDePoder(0, 0, "arqueiro+bruxo"), 1e-9);
            Assert.AreEqual((100 + 30 * 1.2 + 20) / 100.0 * 1.144 * 1.046,
                Dados.Fusao.FatorDePoder(20, 30, "arqueiro+bruxo"), 1e-9,
                "1,2%/nível e 1%/degrau — o peso real fica com o nível");
        }

        /// <summary>
        /// A escala vale para dano/cura/veneno/cadeia (faixa min–max) e para o
        /// valor do escudo — e NÃO vale para marca, empurrão e bônus, que são
        /// mecânica, não poder. O esperado é calculado do dado cru com a conta
        /// do JS (<c>Math.round</c> = meio para cima), não copiado da saída.
        /// </summary>
        [Test]
        public void A_escala_mexe_na_faixa_e_poupa_a_mecanica()
        {
            var acervo = Acervo();

            foreach (var dupla in acervo.FormasDeFusao)
            {
                var mistura = PrimeiraChave(acervo.MisturasDeFusao.Keys);
                var feiticos = Dados.Fusao.Compor(acervo, dupla.Key, mistura, 30);

                foreach (var f in feiticos)
                {
                    var forma = FormaDoDegrau(dupla.Value, f.NivelDeDesbloqueio);
                    double fator = Dados.Fusao.FatorDePoder(forma.Degrau, 30, dupla.Key);

                    for (int i = 0; i < forma.Mecanica.Count; i++)
                    {
                        var cru = forma.Mecanica[i];
                        var composto = f.Efeitos[i];

                        bool escala = cru.Tipo == "damage" || cru.Tipo == "heal" ||
                                      cru.Tipo == "poison" || cru.Tipo == "chain";
                        if (escala && cru.Min.HasValue)
                        {
                            int esperadoMin = System.Math.Max(1, ArredondaComoJs(cru.Min.Value * fator));
                            Assert.AreEqual(esperadoMin, composto.Min, f.Id + " efeito " + i + " (min)");
                        }
                        else if (cru.Tipo == "shield" && cru.Valor.HasValue)
                        {
                            Assert.AreEqual(ArredondaComoJs(cru.Valor.Value * fator),
                                composto.Valor, f.Id + " efeito " + i + " (escudo)");
                        }
                        else if (cru.Tipo == "mark")
                        {
                            // Pilhas de marca escaladas mudariam a MECÂNICA.
                            Assert.AreEqual(cru.Valor, composto.Valor, f.Id + " (marca intacta)");
                            Assert.AreEqual(cru.Max, composto.Max, f.Id + " (teto de pilhas intacto)");
                        }
                        else if (cru.Tipo == "push" || cru.Tipo == "pull")
                        {
                            Assert.AreEqual(cru.Casas, composto.Casas, f.Id + " (casas intactas)");
                        }

                        // A composição NUNCA muta o molde do acervo: a segunda
                        // fusão da mesma dupla escalaria em cima da primeira.
                        Assert.AreNotSame(cru, composto, f.Id);
                    }
                }
            }
        }

        [Test]
        public void O_molde_do_acervo_sai_intacto_da_composicao()
        {
            var acervo = Acervo();
            var dupla = PrimeiraChave(acervo.FormasDeFusao.Keys);
            var forma = acervo.FormasDeFusao[dupla][0];
            var minAntes = forma.Mecanica[0].Min;
            var elementoAntes = forma.Mecanica[0].Elemento;

            Dados.Fusao.Compor(acervo, dupla, "fogo+agua", 30);
            Dados.Fusao.Compor(acervo, dupla, "fogo+agua", 30);

            Assert.AreEqual(minAntes, forma.Mecanica[0].Min,
                "compor duas vezes não pode escalar o acervo em cima de si mesmo");
            Assert.AreEqual(elementoAntes, forma.Mecanica[0].Elemento,
                "nem resolver o token no molde");
        }

        /// <summary>
        /// O nome composto CONCORDA: toda forma é substantivo masculino
        /// singular e todo afixo, adjetivo masculino singular. Gramática não se
        /// testa por completo em código, mas o risco real — um afixo flexionado
        /// no feminino ("Salgada"), que desconcordaria com as 105 formas — se
        /// testa: adjetivo masculino em português não termina em <c>a</c>.
        /// (Do lado do substantivo o 'a' final é legítimo: "Anátema" e
        /// "Estigma" são masculinos.)
        /// </summary>
        [Test]
        public void O_afixo_e_adjetivo_masculino_para_concordar_com_toda_forma()
        {
            foreach (var par in Acervo().MisturasDeFusao)
            {
                var afixo = par.Value.Afixo;
                Assert.IsFalse(string.IsNullOrEmpty(afixo), par.Key + " sem afixo");
                Assert.IsTrue(char.IsUpper(afixo[0]), par.Key + ": o afixo entra no nome próprio");
                Assert.IsFalse(afixo.EndsWith("a"),
                    par.Key + ": '" + afixo + "' parece flexão feminina e desconcordaria " +
                    "com as formas, que são todas substantivos masculinos");
            }
        }

        [Test]
        public void Dupla_ou_mistura_fora_do_acervo_compoe_vazio()
        {
            var acervo = Acervo();
            Assert.IsEmpty(Dados.Fusao.Compor(acervo, "gnomo+troll", "fogo+agua", 30),
                "dupla desconhecida: vazio — a rede de segurança (união dos arsenais) é do motor");
            Assert.IsEmpty(Dados.Fusao.Compor(acervo,
                PrimeiraChave(acervo.FormasDeFusao.Keys), "eter+eter", 30),
                "mistura desconhecida: idem");
        }

        // ---- apoios ----------------------------------------------------------

        static Dados.FormaDeFusao FormaDoDegrau(List<Dados.FormaDeFusao> formas, int degrau)
        {
            foreach (var f in formas)
                if (f.Degrau == degrau) return f;
            Assert.Fail("não há forma no degrau " + degrau);
            return null;
        }

        static Dados.Feitico AchaDegrau(List<Dados.Feitico> feiticos, int degrau)
        {
            foreach (var f in feiticos)
                if (f.NivelDeDesbloqueio == degrau) return f;
            Assert.Fail("não compôs o degrau " + degrau);
            return null;
        }

        static string TiposDe(List<Dados.Efeito> efeitos)
        {
            var sb = new System.Text.StringBuilder();
            foreach (var e in efeitos) sb.Append(e.Tipo).Append('|');
            return sb.ToString();
        }

        static string PrimeiraChave(IEnumerable<string> chaves)
        {
            string menor = null;
            foreach (var c in chaves)
                if (menor == null || string.CompareOrdinal(c, menor) < 0) menor = c;
            Assert.IsNotNull(menor);
            return menor;
        }

        /// <summary>O <c>Math.round</c> do JS: meio para CIMA, como <c>Batalha.Arredonda</c>.</summary>
        static int ArredondaComoJs(double v)
        {
            return (int)System.Math.Floor(v + 0.5);
        }
    }
}
