using System.Collections.Generic;
using UnityEngine;

namespace Soterra.Motor
{
    /// <summary>
    /// O que aconteceu. É o vocabulário que a cena anima e a interface narra.
    ///
    /// O motor não desenha e não escreve na tela: ele empilha eventos e devolve.
    /// É o que permite testar a regra sem cena — e é o que permite a animação
    /// chegar depois, no ritmo dela, sem que o estado do combate espere por ela.
    /// </summary>
    public enum TipoDeEvento
    {
        InicioDeRodada,
        InicioDeTurno,
        Movimento,

        /// <summary>Escapou de quem prendeu — o passo sai.</summary>
        EsquivaOk,

        /// <summary>Não escapou: o passo é CANCELADO e o PP restante se perde.</summary>
        EsquivaFalhou,

        Conjuracao,
        Dano,
        Cura,
        Escudo,
        Empurrao,
        MarcasDetonadas,
        EfeitoAplicado,
        EfeitoExpirado,

        /// <summary>Tique de clima: PV direto, sem passar por escudo nem resistência.</summary>
        TiqueDeClima,

        Morte,

        /// <summary>Saiu do tabuleiro pela fusão — NÃO é morte e não conta derrota.</summary>
        SaiuDoTabuleiro,

        FimDeBatalha,

        /// <summary>
        /// O feitiço trouxe um efeito que esta rodada do motor não implementa.
        ///
        /// Existe para que a falta APAREÇA. Ignorar em silêncio um
        /// <c>summon</c> faria o Xamã conjurar, gastar PA e não invocar nada —
        /// e o defeito seria lido como "a invocação sumiu", não como "isto não
        /// foi escrito ainda".
        /// </summary>
        EfeitoIgnorado
    }

    /// <summary>
    /// Uma coisa que aconteceu, com tudo que quem for desenhá-la precisa saber.
    ///
    /// Um tipo só, com campos opcionais, e não uma classe por evento: a fila é
    /// heterogênea por natureza e quem a consome faz um <c>switch</c> no
    /// <see cref="Tipo"/> de qualquer jeito. Quinze classes só acrescentariam
    /// quinze <c>as</c> no caminho.
    /// </summary>
    public sealed class Evento
    {
        public TipoDeEvento Tipo;

        /// <summary>De quem é o evento: quem sofreu o dano, quem morreu, quem anda.</summary>
        public string Uid;

        /// <summary>Quem causou. Nulo quando não há culpado (clima, expiração).</summary>
        public string UidDaFonte;

        public string FeiticoId;
        public string Elemento;

        /// <summary>Dano, cura, escudo, PV do tique de clima, rodada.</summary>
        public int Quantidade;

        /// <summary>Quanto do dano o escudo comeu antes do PV.</summary>
        public int Absorvido;

        public Vector2Int De, Para;

        /// <summary>Tipo do efeito, motivo do fim de batalha, nome do fixador.</summary>
        public string Detalhe;

        public override string ToString()
        {
            return Tipo + (Uid == null ? "" : " " + Uid) +
                   (Quantidade != 0 ? " " + Quantidade : "") +
                   (Detalhe == null ? "" : " [" + Detalhe + "]");
        }
    }

    /// <summary>
    /// O que uma ação produziu.
    ///
    /// <see cref="Valido"/> e <see cref="Recusa"/> vão além do contrato de
    /// propósito: sem eles, "conjurei e nada aconteceu" e "o motor recusou
    /// porque falta PA" chegam à interface como a mesma lista vazia — e foi
    /// exatamente esse silêncio que, no motor em JS, fez o jogador clicar no
    /// chão a batalha inteira sem entender por que o passo não saía.
    /// </summary>
    public sealed class Resultado
    {
        public List<Evento> Eventos = new List<Evento>();

        /// <summary>A ação foi aceita? Falso quando o motor recusou.</summary>
        public bool Valido = true;

        /// <summary>Por que foi recusada, em português, para a interface mostrar.</summary>
        public string Recusa;

        internal Evento Registra(Evento e)
        {
            Eventos.Add(e);
            return e;
        }

        internal Resultado Nega(string motivo)
        {
            Valido = false;
            Recusa = motivo;
            return this;
        }

        /// <summary>Todos os eventos de um tipo, na ordem em que aconteceram.</summary>
        public List<Evento> Do(TipoDeEvento tipo)
        {
            var saida = new List<Evento>();
            for (int i = 0; i < Eventos.Count; i++)
                if (Eventos[i].Tipo == tipo) saida.Add(Eventos[i]);
            return saida;
        }

        public bool Tem(TipoDeEvento tipo)
        {
            for (int i = 0; i < Eventos.Count; i++)
                if (Eventos[i].Tipo == tipo) return true;
            return false;
        }

        /// <summary>
        /// PV que <paramref name="uid"/> perdeu nesta ação — o dano JÁ descontado
        /// do escudo. É a pergunta que o teste faz, e somar
        /// <see cref="Evento.Quantidade"/> daria o dano BRUTO, que não é o que
        /// saiu da vida de ninguém.
        /// </summary>
        public int PvPerdidoPor(string uid)
        {
            int total = 0;
            for (int i = 0; i < Eventos.Count; i++)
            {
                var e = Eventos[i];
                if (e.Tipo == TipoDeEvento.Dano && e.Uid == uid) total += e.Quantidade - e.Absorvido;
                if (e.Tipo == TipoDeEvento.TiqueDeClima && e.Uid == uid && e.Quantidade < 0) total -= e.Quantidade;
            }
            return total;
        }

        public override string ToString()
        {
            var sb = new System.Text.StringBuilder();
            if (!Valido) sb.Append("RECUSADO: ").Append(Recusa).Append('\n');
            for (int i = 0; i < Eventos.Count; i++) sb.Append(Eventos[i]).Append('\n');
            return sb.ToString();
        }
    }
}
