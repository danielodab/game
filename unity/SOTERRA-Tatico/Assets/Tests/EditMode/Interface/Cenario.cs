using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.UIElements;
using Soterra.Dados;
using Soterra.Interface;

namespace Soterra.Testes.Interface
{
    /// <summary>
    /// O cenário que os testes da interface compartilham.
    ///
    /// Tudo montado a partir do acervo DE VERDADE
    /// (<c>Assets/Resources/dados/</c>): nenhum feitiço inventado, nenhum custo
    /// arredondado, nenhum PV bonito. Fixtura com número falso é o jeito mais
    /// rápido de escrever um teste que passa e não prova nada — e aqui a coisa
    /// medida (quantos botões a barra monta) É o número do acervo.
    /// </summary>
    public static class Cenario
    {
        public static string CaminhoDoEstilo
        {
            get { return (Application.dataPath + "/UI/Resources/batalha-estilo.uss").Replace('\\', '/'); }
        }

        public static string CaminhoDoLayout
        {
            get { return (Application.dataPath + "/UI/Resources/batalha.uxml").Replace('\\', '/'); }
        }

        static string CaminhoDoManifesto
        {
            get { return (Application.dataPath + "/Resources/dados/_manifesto.json").Replace('\\', '/'); }
        }

        /// <summary>
        /// O acervo, ou um teste inconclusivo com o caminho que faltou.
        ///
        /// Inconclusivo e não verde: teste que passa porque o arquivo não existe
        /// afirma que está tudo certo justamente quando não há nada para
        /// conferir (mesmo critério de <c>ManifestoTests</c>).
        /// </summary>
        public static BancoDeDados BancoOuInconclusivo()
        {
            if (!File.Exists(CaminhoDoManifesto))
            {
                Assert.Inconclusive(
                    "o acervo ainda não foi exportado: falta " + CaminhoDoManifesto +
                    ". Sem ele não há feitiço real para a barra montar.");
            }
            return BancoDeDados.CarregarDeResources();
        }

        /// <summary>A tela montada a partir do UXML e do USS de verdade.</summary>
        public static TelaDeBatalha Tela()
        {
            return TelaDeBatalha.Carregar();
        }

        /// <summary>
        /// Um quadro montado do acervo: o herói da classe pedida, no nível
        /// pedido, contra a primeira criatura do bestiário.
        ///
        /// Nível 30 por padrão porque é o único que abre a barra INTEIRA — os
        /// 3 neutros mais os 6 degraus do caminho. Uma barra pela metade
        /// esconderia justamente o botão que só existe no fim da escada.
        /// </summary>
        public static QuadroDaBatalha QuadroReal(BancoDeDados banco, string classeId = "bruxo",
                                                 string elemento = Elemento.Fogo, int nivel = 30)
        {
            var classe = banco.Classes[classeId];
            var heroi = DaFicha(classe.Id, classe.Nome, LadoNaTela.Heroi, classe.Atributos, elemento);

            var q = new QuadroDaBatalha
            {
                Rodada = 1,
                Atual = heroi,
                ETurnoDoJogador = true,
                Elementos = banco.InfoDeElementos,
                Clima = NomeDoPrimeiroClima(banco)
            };

            q.Ordem.Add(heroi);
            foreach (var m in PrimeirosMonstros(banco, 3))
                q.Ordem.Add(DaFicha(m.Id, m.Nome, LadoNaTela.Monstro, m.Atributos, m.Elemento));

            var lista = Repertorio.De(banco, classeId, elemento, nivel);
            for (int i = 0; i < lista.Count; i++)
                q.Feiticos.Add(Repertorio.ParaTela(lista[i], 0));

            return q;
        }

        /// <summary>
        /// A árvore inteira, raiz inclusive.
        ///
        /// Percorrida à mão em vez de <c>UQuery</c> porque estes testes rodam sem
        /// painel, e o que se quer aqui é o conteúdo cru da árvore montada — sem
        /// nenhuma esperteza de consulta no meio do caminho.
        /// </summary>
        public static IEnumerable<VisualElement> Todos(VisualElement raiz)
        {
            if (raiz == null) yield break;
            yield return raiz;
            for (int i = 0; i < raiz.childCount; i++)
                foreach (var filho in Todos(raiz[i]))
                    yield return filho;
        }

        /// <summary>Descrição curta de um elemento, para a mensagem de falha.</summary>
        public static string Descreve(VisualElement e)
        {
            if (e == null) return "(nulo)";
            return e.GetType().Name + " '" + (string.IsNullOrEmpty(e.name) ? "(sem nome)" : e.name) + "'";
        }

        /// <summary>Os filhos diretos que são botões.</summary>
        public static List<Button> Botoes(VisualElement caixa)
        {
            var saida = new List<Button>();
            foreach (var e in Todos(caixa))
            {
                var b = e as Button;
                if (b != null) saida.Add(b);
            }
            return saida;
        }

        /// <summary>Primeiro descendente com a classe pedida.</summary>
        public static VisualElement ComClasse(VisualElement caixa, string classe)
        {
            foreach (var e in Todos(caixa))
                if (e.ClassListContains(classe)) return e;
            return null;
        }

        static UnidadeNaTela DaFicha(string id, string nome, LadoNaTela lado,
                                     Atributos a, string elemento)
        {
            return new UnidadeNaTela
            {
                Uid = "u-" + id,
                Nome = nome,
                Lado = lado,
                Pv = a.Pv,
                PvMax = a.Pv,
                Pa = a.Pa,
                PaMax = a.Pa,
                Pp = a.Pp,
                PpMax = a.Pp,
                Elemento = elemento,
                Viva = true
            };
        }

        static IEnumerable<Monstro> PrimeirosMonstros(BancoDeDados banco, int quantos)
        {
            int n = 0;
            foreach (var par in banco.Monstros)
            {
                if (n++ >= quantos) yield break;
                yield return par.Value;
            }
        }

        static string NomeDoPrimeiroClima(BancoDeDados banco)
        {
            foreach (var par in banco.Climas)
                if (par.Value != null && !string.IsNullOrEmpty(par.Value.Nome))
                    return par.Value.Nome;
            return string.Empty;
        }
    }
}
