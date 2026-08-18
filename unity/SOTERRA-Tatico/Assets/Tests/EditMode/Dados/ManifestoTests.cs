using System.IO;
using System.Text;
using NUnit.Framework;
using Soterra.Dados;
using UnityEngine;

namespace Soterra.Testes.Dados
{
    /// <summary>
    /// Confere a leitura contra o acervo DE VERDADE, o que está em
    /// <c>Assets/Resources/dados/</c>.
    ///
    /// Enquanto o exportador (dono: Criativo/Dados) não tiver gerado os JSON,
    /// estes testes terminam INCONCLUSIVOS, com o caminho que faltou escrito na
    /// mensagem. Nunca verdes: um teste que passa porque o arquivo não existe é
    /// pior que não ter teste — ele afirma que está tudo certo justamente
    /// quando não há nada para conferir.
    /// </summary>
    public class ManifestoTests
    {
        /// <summary>
        /// Caminho em disco de um arquivo do acervo.
        ///
        /// As barras são normalizadas para a frente porque
        /// <c>Application.dataPath</c> já vem assim e o <c>Path.Combine</c> do
        /// Windows emenda com a contrária — o caminho da mensagem de erro sairia
        /// misturado, e quem lê teria de adivinhar se é um caminho de verdade.
        /// </summary>
        static string Caminho(string arquivo)
        {
            return (Application.dataPath + "/Resources/dados/" + arquivo).Replace('\\', '/');
        }

        static string CaminhoDoManifesto
        {
            get { return Caminho(Manifesto.Chave + ".json"); }
        }

        /// <summary>
        /// Termina o teste como inconclusivo quando o acervo ainda não existe.
        /// Devolve o banco carregado quando existe.
        /// </summary>
        static BancoDeDados AcervoOuInconclusivo()
        {
            if (!File.Exists(CaminhoDoManifesto))
            {
                Assert.Inconclusive(
                    "o acervo ainda não foi exportado: falta " + CaminhoDoManifesto + ". " +
                    "Ele é gerado pelo papel Criativo/Dados (contrato §4), executando os " +
                    "scripts de js/core/data na ordem de v2.html e serializando JOGO.DATA. " +
                    "Este teste NÃO passa por ausência — volta a rodar sozinho quando o arquivo chegar.");
            }

            var banco = BancoDeDados.CarregarDeResources();

            // O arquivo existe em disco mas o Resources.Load não o achou: isso é
            // DEFEITO, não ausência. Acontece quando o acervo é escrito fora de
            // uma pasta chamada exatamente `Resources`, ou com a extensão no
            // nome passado ao Load.
            Assert.IsNotNull(banco.Manifesto,
                "o manifesto existe em " + CaminhoDoManifesto +
                ", mas Resources.Load<TextAsset>(\"dados/" + Manifesto.Chave + "\") devolveu nada");

            return banco;
        }

        [Test]
        public void O_acervo_de_verdade_bate_com_o_manifesto()
        {
            var banco = AcervoOuInconclusivo();
            var problemas = banco.ConfereContraManifesto();

            if (problemas.Count == 0) return;

            var texto = new StringBuilder("o acervo diverge do manifesto:");
            foreach (var p in problemas) texto.Append("\n  - ").Append(p);
            Assert.Fail(texto.ToString());
        }

        [Test]
        public void Toda_chave_modelada_existe_no_acervo()
        {
            var banco = AcervoOuInconclusivo();

            // Pega os dois lados do mesmo erro: chave que o exportador esqueceu
            // de escrever, e chave cujo NOME eu digitei errado nas constantes
            // de BancoDeDados — as duas somem exatamente do mesmo jeito.
            var semArquivo = banco.ChavesAusentes;

            // E o terceiro caso, que a conferência contra o manifesto não vê
            // porque ela só percorre o que o manifesto lista.
            var foraDoManifesto = banco.ChavesModeladasForaDoManifesto();

            if (semArquivo.Count == 0 && foraDoManifesto.Count == 0) return;

            var texto = new StringBuilder("o acervo existe, mas está incompleto:");
            foreach (var c in semArquivo)
                texto.Append("\n  - sem arquivo: ").Append(Caminho(c + ".json"));
            foreach (var c in foraDoManifesto)
                texto.Append("\n  - fora do manifesto: ").Append(c);
            Assert.Fail(texto.ToString());
        }

        [Test]
        public void As_ancoras_do_contrato_batem_com_o_manifesto()
        {
            var banco = AcervoOuInconclusivo();

            // Só as âncoras do §4 que eu conferi UMA A UMA contra
            // js/core/data/*.js. As outras duas do contrato ficam de fora de
            // propósito, porque o contrato está errado e o dado ganha:
            //
            //   `fusionForms: 105` — DATA.fusionForms é um OBJETO indexado por
            //     DUPLA DE CLASSE ('arqueiro+bruxo'), com 15 chaves de 7 formas
            //     cada. Pela regra do próprio §4 o manifesto tem de dizer 15;
            //     105 é o total de formas, que é outra conta.
            //
            //   `fusionBlends: 16` — o arquivo declara 15 misturas e o rodapé
            //     espelha as 10 mistas, fechando 25 chaves em tempo de execução.
            //     Nem 15 nem 25 é 16 — e 16 não é sequer o número de pares
            //     possíveis de 5 elementos, que é 15.
            Confere(banco, "spells", 171);
            Confere(banco, "classes", 6);
            Confere(banco, "dungeons", 6);
            Confere(banco, "elements", 5);
            Confere(banco, "weathers", 5);
        }

        static void Confere(BancoDeDados banco, string chave, int esperado)
        {
            int declarado = banco.Manifesto.Conta(chave);
            Assert.AreNotEqual(-1, declarado, "o manifesto não declara a chave '" + chave + "'");
            Assert.AreEqual(esperado, declarado,
                "âncora do contrato §4 para '" + chave + "'. Se o DADO mudou, o dado ganha: " +
                "corrija a âncora no contrato e relate, não force o número.");
        }
    }
}
