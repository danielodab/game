using System.Collections.Generic;
using Soterra.Dados;

namespace Soterra.Interface
{
    using Progressao = global::Soterra.Progressao;

    /// <summary>
    /// Traduz a descida para o que as telas de fluxo desenham — o irmão do
    /// <see cref="PonteDoMotor"/>, e pelo mesmo motivo: é o ÚNICO arquivo da
    /// interface que conhece <c>Soterra.Progressao</c>, então é o único que
    /// quebra quando a Recompensa ou a Descida mudarem de forma.
    ///
    /// Nenhum número nasce aqui. XP, níveis, peças, pedras e carta vêm prontos
    /// da <c>Recompensa</c>; nome e cor vêm do acervo. O que esta classe faz é
    /// escolher o que MOSTRAR e como qualificá-lo — e cada escolha dessas está
    /// comentada, porque é onde uma tela começa a mentir sem querer.
    /// </summary>
    public static class PonteDaDescida
    {
        /// <summary>
        /// O quadro da tela de fluxo. <paramref name="heroiDaEscolha"/> só é
        /// lido quando o tipo é <see cref="TipoDeFluxo.EscolhaDeElemento"/>.
        /// </summary>
        public static QuadroDeFluxo Quadro(Progressao.Progresso progresso, Progressao.Descida descida,
                                           Progressao.Recompensa recompensa, TipoDeFluxo tipo,
                                           string heroiDaEscolha = null)
        {
            var q = new QuadroDeFluxo { Tipo = tipo };
            if (tipo == TipoDeFluxo.Nenhum || progresso == null || descida == null) return q;

            var banco = progresso.Banco;
            var calabouco = descida.DadosDoCalabouco;
            var nomeDoCalabouco = calabouco != null && !string.IsNullOrEmpty(calabouco.Nome)
                ? calabouco.Nome : descida.IdDoCalabouco;

            // "Sala 1 de 3" e não "sala 0": o índice é de código, e um jogador
            // que lê "sala 0 de 3" acha que a contagem quebrou.
            var ondeEstou = nomeDoCalabouco + " · sala " + (descida.IndiceDaSala + 1) +
                            " de " + descida.TotalDeSalas;

            switch (tipo)
            {
                case TipoDeFluxo.EscolhaDeElemento:
                    MontarEscolha(q, progresso, heroiDaEscolha);
                    break;

                case TipoDeFluxo.Recompensa:
                    q.Titulo = "Sala vencida";
                    q.Subtitulo = ondeEstou;
                    // O nome da sala vem do acervo com artigo e gênero próprios
                    // ("O Vestíbulo das Heras"): colar um adjetivo nele erra a
                    // concordância em metade das salas, e colar uma preposição
                    // produz "em O Vestíbulo". Por isso ele fica isolado, com o
                    // travessão fazendo o trabalho da frase.
                    q.Texto = descida.SalaAtual != null && !string.IsNullOrEmpty(descida.SalaAtual.Nome)
                        ? descida.SalaAtual.Nome + " — nada mais de pé."
                        : "Nada mais de pé na sala.";
                    q.RotuloDoBotao = "Descer";
                    MontarGanhos(q, progresso, descida, recompensa);
                    MontarPremios(q, banco, recompensa);
                    break;

                case TipoDeFluxo.CalaboucoConcluido:
                    q.Titulo = "Calabouço concluído";
                    q.Subtitulo = nomeDoCalabouco;
                    q.Texto = "O chefe caiu. A descida acabou em vitória.";
                    q.RotuloDoBotao = "Descer de novo";
                    MontarGanhos(q, progresso, descida, recompensa);
                    MontarPremios(q, banco, recompensa);
                    break;

                case TipoDeFluxo.Derrota:
                    q.Titulo = "O grupo tombou";
                    q.Subtitulo = ondeEstou;
                    // O que o jogador precisa saber é que NÃO perdeu o que ganhou
                    // — é a regra da Descida, e sem ela a tela de derrota parece
                    // apagar a descida inteira.
                    q.Texto = "A descida acabou. O que já foi conquistado fica: " +
                              "nível, peças e cartas continuam com você.";
                    q.RotuloDoBotao = "Tentar de novo";
                    break;
            }

            return q;
        }

        // ============================================================== ESCOLHA

        /// <summary>
        /// Os caminhos que ESTA classe abre, do acervo. Não os quatro fixos: uma
        /// classe que só tivesse três caminhos ofereceria um botão que a
        /// Progressão recusaria depois, e o jogador levaria a recusa como
        /// defeito.
        /// </summary>
        static void MontarEscolha(QuadroDeFluxo q, Progressao.Progresso progresso, string heroiId)
        {
            var banco = progresso.Banco;
            var ficha = progresso.Heroi(heroiId);
            var classe = ficha == null ? null : Acha(banco.Classes, ficha.IdDaClasse);
            var nome = classe != null && !string.IsNullOrEmpty(classe.Nome) ? classe.Nome : heroiId;

            q.HeroiDaEscolha = heroiId;
            q.Titulo = "O caminho de " + nome;
            q.Subtitulo = "nível " + progresso.NivelDe(heroiId);
            // O aviso da permanência vai no TEXTO e não num rodapé pequeno: a
            // Progressão recusa a segunda escolha para sempre, e uma decisão
            // irreversível anunciada em letra miúda é uma armadilha.
            q.Texto = "Escolha é para sempre: os feitiços dos outros três caminhos " +
                      "ficam fechados pelo resto da partida.";
            q.RotuloDoBotao = null;

            var permitidos = classe != null && classe.Caminhos != null && classe.Caminhos.Count > 0
                ? new List<string>(classe.Caminhos.Keys)
                : null;

            var elementos = banco.Elementos;
            if (elementos == null) return;

            for (int i = 0; i < elementos.Count; i++)
            {
                var id = elementos[i];
                if (string.IsNullOrEmpty(id) || id == Elemento.Neutro) continue;
                if (permitidos != null && !permitidos.Contains(id)) continue;

                InfoDeElemento info = null;
                if (banco.InfoDeElementos != null) banco.InfoDeElementos.TryGetValue(id, out info);
                q.Elementos.Add(new OpcaoDeElemento
                {
                    Id = id,
                    Nome = info != null && !string.IsNullOrEmpty(info.Nome) ? info.Nome : id,
                    Cor = info != null ? info.Cor : null,
                    Descricao = info != null ? info.Descricao : null
                });
            }
        }

        // =============================================================== GANHOS

        static void MontarGanhos(QuadroDeFluxo q, Progressao.Progresso progresso,
                                 Progressao.Descida descida, Progressao.Recompensa recompensa)
        {
            if (recompensa == null) return;
            var banco = progresso.Banco;

            foreach (var heroiId in descida.Grupo)
            {
                var ficha = progresso.Heroi(heroiId);
                var classe = ficha == null ? null : Acha(banco.Classes, ficha.IdDaClasse);
                var xp = progresso.XpDe(heroiId);

                int ganho;
                if (!recompensa.XpPorHeroi.TryGetValue(heroiId, out ganho)) ganho = 0;

                double mult;
                if (!recompensa.MultiplicadorDeXp.TryGetValue(heroiId, out mult)) mult = 1.0;

                q.Ganhos.Add(new GanhoNaTela
                {
                    HeroiId = heroiId,
                    Nome = classe != null && !string.IsNullOrEmpty(classe.Nome) ? classe.Nome : heroiId,
                    Xp = ganho,
                    Nivel = xp != null ? xp.Nivel : progresso.NivelDe(heroiId),
                    NiveisSubidos = Subidas(recompensa, heroiId),
                    Fracao = xp != null ? xp.Fracao : 0.0,
                    Multiplicador = mult
                });
            }
        }

        static int Subidas(Progressao.Recompensa r, string heroiId)
        {
            for (int i = 0; i < r.Subidas.Count; i++)
                if (r.Subidas[i].IdDoHeroi == heroiId) return r.Subidas[i].Niveis;
            return 0;
        }

        // ============================================================== PRÊMIOS

        static void MontarPremios(QuadroDeFluxo q, BancoDeDados banco, Progressao.Recompensa r)
        {
            if (r == null) return;

            // Peças iguais viram UMA linha com ×N. Duas linhas idênticas na tela
            // de recompensa fazem o jogador procurar a diferença que não existe.
            var contagem = new List<string>();
            var quantos = new Dictionary<string, int>();
            for (int i = 0; i < r.Itens.Count; i++)
            {
                var id = r.Itens[i];
                if (string.IsNullOrEmpty(id)) continue;
                if (!quantos.ContainsKey(id)) { quantos[id] = 0; contagem.Add(id); }
                quantos[id]++;
            }

            for (int i = 0; i < contagem.Count; i++)
            {
                var id = contagem[i];
                var item = Acha(banco.Itens, id);
                q.Premios.Add(new PremioNaTela
                {
                    Id = id,
                    Especie = "item",
                    Nome = item != null && !string.IsNullOrEmpty(item.Nome) ? item.Nome : id,
                    Detalhe = Qualifica(item, quantos[id]),
                    Cor = CorDoElemento(banco, item != null ? item.Elemento : null)
                });
            }

            foreach (var par in r.Pedras)
            {
                if (par.Value <= 0) continue;
                var pedra = Acha(banco.Pedras, par.Key);
                q.Premios.Add(new PremioNaTela
                {
                    Id = par.Key,
                    Especie = "pedra",
                    Nome = pedra != null && !string.IsNullOrEmpty(pedra.Nome) ? pedra.Nome : par.Key,
                    Detalhe = "×" + par.Value,
                    Cor = CorDoElemento(banco, pedra != null ? pedra.Elemento : null)
                });
            }

            if (r.Carta != null)
            {
                // A carta vale duas coisas MUITO diferentes: a primeira LIBERA a
                // classe, as seguintes viram estrela. Dizer só "carta" esconde a
                // única parte que muda o jogo do jogador.
                q.Premios.Add(new PremioNaTela
                {
                    Id = r.Carta.IdDaClasse,
                    Especie = "carta",
                    Nome = string.IsNullOrEmpty(r.Carta.Nome) ? r.Carta.IdDaClasse : r.Carta.Nome,
                    Detalhe = r.Carta.Liberada ? "classe liberada" : "carta de classe",
                    Cor = null
                });
            }

            if (!string.IsNullOrEmpty(r.Bicho))
            {
                var bicho = Acha(banco.Bichos, r.Bicho);
                q.Premios.Add(new PremioNaTela
                {
                    Id = r.Bicho,
                    Especie = "bicho",
                    Nome = bicho != null && !string.IsNullOrEmpty(bicho.Nome) ? bicho.Nome : r.Bicho,
                    Detalhe = "bicho novo",
                    Cor = null
                });
            }
        }

        static string Qualifica(Item item, int quantidade)
        {
            var raridade = item != null && !string.IsNullOrEmpty(item.Raridade) ? item.Raridade : "peça";
            return quantidade > 1 ? raridade + " ×" + quantidade : raridade;
        }

        static string CorDoElemento(BancoDeDados banco, string elemento)
        {
            if (string.IsNullOrEmpty(elemento) || banco.InfoDeElementos == null) return null;
            InfoDeElemento info;
            return banco.InfoDeElementos.TryGetValue(elemento, out info) && info != null
                ? info.Cor : null;
        }

        static T Acha<T>(IDictionary<string, T> tabela, string id) where T : class
        {
            T achado;
            return tabela != null && !string.IsNullOrEmpty(id) && tabela.TryGetValue(id, out achado)
                ? achado : null;
        }
    }
}
