using System.Text;
using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.Fx
{
    // Ver a nota de armadilha de nome em FamiliasDeEfeitoTests.cs.
    using Fx = global::Soterra.Fx;

    /// <summary>
    /// LEGÍVEL A 40 PX — o critério que decide todo empate desta rodada.
    ///
    /// A casa do tabuleiro tem 1 m e, no quadro de celular, cerca de 40 px. O
    /// jogador precisa saber ONDE caiu e DE QUE elemento é; o resto é enfeite.
    /// A linha JS mediu isto na tela e o resultado foi duro: 'bola', 'corte' e
    /// 'flecha' pintavam o MESMO número de pixels, porque o que se via nas três
    /// era o clarão do impacto — o desenho ficava abaixo do limiar de detecção.
    ///
    /// Aqui a medida é feita no simulador, sem tela: dispara-se cada família,
    /// avança-se até o meio do efeito e mede-se a MAIOR partícula viva. Se a
    /// forma da família não chega a dois metros, ela não existe a 40 px.
    /// </summary>
    public class LegibilidadeTests
    {
        /// <summary>Metros. Duas casas de tabuleiro — abaixo disso a forma
        /// compete com o cascalho do chão e perde.</summary>
        public const float FormaMinima = 2f;

        GameObject _raiz;
        Fx.BancoDeEfeitos _banco;

        [SetUp]
        public void Antes()
        {
            _raiz = new GameObject("fx-de-teste");
            _banco = Fx.BancoDeEfeitos.Criar(_raiz.transform);
        }

        [TearDown]
        public void Depois()
        {
            if (_raiz != null) Object.DestroyImmediate(_raiz);
        }

        /// <summary>A maior partícula viva do sistema, em metros de mundo.</summary>
        static float MaiorParticula(Fx.SistemaDeEfeito s, out int vivas)
        {
            float maior = 0f;
            vivas = 0;
            for (int c = 0; c < s.Camadas; c++)
            {
                var ps = s.Camada(c);
                if (ps == null) continue;
                int n = ps.particleCount;
                if (n <= 0) continue;
                var buffer = new ParticleSystem.Particle[n];
                n = ps.GetParticles(buffer);
                vivas += n;

                // O modo Trilho estica a partícula ao longo do movimento: um
                // risco de 0,9 m com alongamento 8 cobre 7,2 m de tela. Medir só
                // `GetCurrentSize` reprovaria o feixe e o gancho por serem
                // finos — e é justamente o COMPRIMENTO deles que se lê.
                var r = ps.GetComponent<ParticleSystemRenderer>();
                float estica = r != null && r.renderMode == ParticleSystemRenderMode.Stretch
                    ? Mathf.Max(1f, r.lengthScale) : 1f;

                for (int i = 0; i < n; i++)
                {
                    float t = buffer[i].GetCurrentSize(ps) * estica;
                    if (t > maior) maior = t;
                }
            }
            return maior;
        }

        [Test]
        public void CadaFamilia_PoeUmaFormaDeAoMenosDoisMetrosNoAr()
        {
            var relato = new StringBuilder();
            var magras = new StringBuilder();

            for (int f = 0; f < Fx.FamiliaDeEfeito.Todas.Count; f++)
            {
                var familia = Fx.FamiliaDeEfeito.Todas[f];
                var molde = _banco.Molde(familia);

                var sistema = _banco.Disparar(familia, Vector3.zero, new Vector3(5f, 0f, 0f),
                                              Color.white);
                Assert.IsNotNull(sistema, familia + " não tem molde");

                // Percorre o efeito inteiro e guarda o melhor instante: cada
                // família abre a sua forma numa hora diferente, e medir todas no
                // mesmo instante reprovaria o meteoro por estar no meio da queda.
                float melhor = 0f;
                int vivasNoMelhor = 0;
                int passos = Mathf.CeilToInt(molde.Duracao * 60f);
                for (int p = 0; p < passos; p++)
                {
                    _banco.Avancar(1f / 60f);
                    int vivas;
                    float tamanho = MaiorParticula(sistema, out vivas);
                    if (tamanho > melhor) { melhor = tamanho; vivasNoMelhor = vivas; }
                }

                relato.Append(familia).Append(' ').Append(melhor.ToString("0.00"))
                      .Append(" m / ").Append(vivasNoMelhor).Append(" part.; ");
                if (melhor < FormaMinima)
                    magras.Append(familia).Append(" (").Append(melhor.ToString("0.00"))
                          .Append(" m) ");

                _banco.Limpar();
            }

            Debug.Log("[SOTERRA/FX] maior forma por família — " + relato);
            Assert.IsEmpty(magras.ToString(),
                           "estas famílias não põem forma nenhuma acima de " + FormaMinima +
                           " m no ar: " + magras + "— a 40 px por casa elas chegam como o mesmo " +
                           "pontinho colorido, e só a cor as separa. Era exatamente esse o " +
                           "defeito que a linha JS mediu na tela");
        }
    }
}
