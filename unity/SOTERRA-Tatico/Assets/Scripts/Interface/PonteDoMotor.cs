using System.Collections.Generic;
using Soterra.Dados;

namespace Soterra.Interface
{
    /// <summary>
    /// Traduz o estado do motor para o que a tela desenha.
    ///
    /// É o ÚNICO arquivo da interface que conhece <c>Soterra.Motor</c>. Foi
    /// isolado assim de propósito: o motor está sendo escrito em paralelo, e
    /// quando a assinatura dele mudar quem quebra é este arquivo — não a tela,
    /// não a barra de feitiços, não os testes.
    ///
    /// O caminho é de mão única. A tela nunca escreve no motor: ela avisa por
    /// evento (<c>AoEscolherFeitico</c>, <c>AoEncerrarTurno</c>) e quem manda no
    /// jogo decide o que fazer. Interface que altera estado de batalha é como se
    /// inventa uma segunda regra do jogo, escondida.
    /// </summary>
    public static class PonteDoMotor
    {
        /// <summary>
        /// Monta o quadro de uma repintura.
        ///
        /// <paramref name="recargasRestantes"/> vem de fora porque o contrato do
        /// motor NÃO expõe recarga corrente: <c>Motor.Unidade</c> tem PV, PA, PP
        /// e nível, e nada sobre há quantas rodadas um feitiço foi lançado. Sem
        /// esse mapa a barra mostra a recarga DECLARADA (o preço) e nunca o que
        /// falta — está pedido no relatório desta rodada.
        /// </summary>
        public static QuadroDaBatalha Quadro(Motor.Batalha batalha, BancoDeDados banco,
                                             string feiticoEscolhido = null,
                                             IDictionary<string, int> recargasRestantes = null)
        {
            var q = new QuadroDaBatalha();
            if (batalha == null) return q;

            q.Rodada = batalha.Rodada;
            q.FeiticoEscolhido = feiticoEscolhido;
            q.Elementos = banco != null ? banco.InfoDeElementos : null;
            q.Clima = NomeDoClima(banco, batalha.Clima);

            var unidades = batalha.Ordem;   // a fila da tela e por iniciativa
            if (unidades != null && unidades.Count > 0)
            {
                // A ordem é GIRADA para começar em quem joga agora. A pergunta que
                // a faixa responde é "quem vem depois de mim", e uma lista que
                // começa sempre no mesmo lugar não responde isso — obriga o
                // jogador a achar a si mesmo antes de contar.
                int inicio = 0;
                for (int i = 0; i < unidades.Count; i++)
                {
                    if (batalha.Atual != null && ReferenceEquals(unidades[i], batalha.Atual))
                    {
                        inicio = i;
                        break;
                    }
                }

                for (int k = 0; k < unidades.Count; k++)
                {
                    var u = unidades[(inicio + k) % unidades.Count];
                    if (u == null || !u.Viva) continue;

                    // Fora do tabuleiro NÃO é morte: é o convidado que a fusão
                    // recolheu. Ele não joga e não aparece na ordem, mas também
                    // não é derrota — quem mistura os dois conta perda a mais.
                    if (u.ForaDoTabuleiro) continue;

                    q.Ordem.Add(ParaTela(u, banco));
                }
            }

            if (batalha.Atual != null)
            {
                q.Atual = AchaNaOrdem(q, batalha.Atual.Uid) ?? ParaTela(batalha.Atual, banco);

                // Só o herói é comandado pelo dedo. No turno do monstro a barra
                // fica apagada e o botão de encerrar desliga.
                q.ETurnoDoJogador = batalha.Atual.Lado == Motor.Lado.Heroi;

                var lista = Repertorio.De(banco, batalha.Atual.ClasseOuMonstroId,
                                          batalha.Atual.Elemento, batalha.Atual.Nivel);
                for (int i = 0; i < lista.Count; i++)
                {
                    var f = lista[i];
                    q.Feiticos.Add(Repertorio.ParaTela(f, Restante(recargasRestantes, f.Id)));
                }
            }

            return q;
        }

        static UnidadeNaTela AchaNaOrdem(QuadroDaBatalha q, string uid)
        {
            for (int i = 0; i < q.Ordem.Count; i++)
                if (q.Ordem[i].Uid == uid) return q.Ordem[i];
            return null;
        }

        static int Restante(IDictionary<string, int> mapa, string id)
        {
            int v;
            return mapa != null && id != null && mapa.TryGetValue(id, out v) ? v : 0;
        }

        /// <summary>
        /// Nome visível da unidade, do acervo. Nunca o id cru: <c>sumo</c> é o
        /// Bárbaro e <c>curandeira</c> é a Paladina — mostrar o id na tela é a
        /// dívida de renomeação antiga (SISTEMAS §3) vazando para o jogador.
        /// </summary>
        static UnidadeNaTela ParaTela(Motor.Unidade u, BancoDeDados banco)
        {
            return new UnidadeNaTela
            {
                Uid = u.Uid,
                Nome = Nome(banco, u.ClasseOuMonstroId),
                Lado = u.Lado == Motor.Lado.Heroi ? LadoNaTela.Heroi : LadoNaTela.Monstro,
                Pv = u.PV,
                PvMax = u.PVMax,
                Pa = u.PA,
                PaMax = u.PAMax,
                Pp = u.PP,
                PpMax = u.PPMax,
                Elemento = u.Elemento,
                Viva = u.Viva
            };
        }

        static string Nome(BancoDeDados banco, string id)
        {
            if (string.IsNullOrEmpty(id)) return "?";
            if (banco == null) return id;

            Classe c;
            if (banco.Classes.TryGetValue(id, out c) && c != null && !string.IsNullOrEmpty(c.Nome))
                return c.Nome;

            Monstro m;
            if (banco.Monstros.TryGetValue(id, out m) && m != null && !string.IsNullOrEmpty(m.Nome))
                return m.Nome;

            return id;
        }

        static string NomeDoClima(BancoDeDados banco, string id)
        {
            if (string.IsNullOrEmpty(id)) return string.Empty;
            if (banco == null) return id;
            Clima c;
            return banco.Climas.TryGetValue(id, out c) && c != null && !string.IsNullOrEmpty(c.Nome)
                ? c.Nome
                : id;
        }
    }
}
