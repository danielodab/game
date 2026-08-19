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
        /// O feitiço trouxe um efeito que o motor não conhece.
        ///
        /// Os 24 tipos do contrato entraram todos; isto agora é a rede para um
        /// tipo que o acervo invente. Continua existindo porque a falta tem de
        /// APARECER: ignorar em silêncio faria a unidade gastar PA e nada
        /// acontecer, e o defeito seria lido como "o feitiço sumiu" em vez de
        /// "este tipo não foi escrito".
        /// </summary>
        EfeitoIgnorado,

        /// <summary>
        /// Alguém trocou de casa sem andar — <c>teleport</c>, <c>swap</c>.
        ///
        /// Separado de <see cref="Movimento"/> porque a cena desenha os dois de
        /// formas opostas: o passo desliza casa a casa e o teleporte pisca. Usar
        /// o mesmo evento faria o corpo atravessar a parede deslizando.
        /// </summary>
        Teleporte,

        /// <summary>Nasceu gente no meio da batalha: <c>summon</c> ou <c>split</c>.</summary>
        Invocacao,

        ArmadilhaArmada,
        ArmadilhaDisparada,
        ArmadilhaExpirada,

        /// <summary>Brotou uma marca <c>ev-*</c> no chão.</summary>
        MarcaDeTerrenoNasceu,

        /// <summary>Alguém pisou na marca e ela agiu. <c>Detalhe</c> traz o texto.</summary>
        EventoDeTerreno,

        /// <summary>A marca apagou sozinha, sem ninguém pisar.</summary>
        MarcaDeTerrenoExpirou,

        /// <summary>O clima da sala mudou — por feitiço ou pelo ciclo do calabouço.</summary>
        MudancaDeClima,

        /// <summary>Parte do dano recebido voltou para quem bateu.</summary>
        Reflexo,

        /// <summary>Um salto do raio em cadeia. <c>Quantidade</c> é o número do salto.</summary>
        SaltoEmCadeia,

        /// <summary>
        /// Fusão declarada (2 PA pagos). <c>Uid</c> é o anfitrião,
        /// <c>UidDaFonte</c> o convidado. Resolve no fim do turno do anfitrião.
        /// </summary>
        FusaoDeclarada,

        /// <summary>A fusão declarada não aconteceu. <c>Detalhe</c>: morte, afastamento, cancelada.</summary>
        FusaoFalhou,

        /// <summary>
        /// A fusão ACONTECEU. <c>Uid</c> é a fundida (o uid do anfitrião,
        /// preservado), <c>UidDaFonte</c> o convidado que saiu,
        /// <c>Quantidade</c> o nível, <c>Detalhe</c> = "dupla:mistura". É este
        /// evento que manda a cena trocar o corpo — o
        /// <see cref="Unidade.ClasseOuMonstroId"/> já é o id da dupla.
        /// </summary>
        Fusao,

        /// <summary>
        /// A fundida morreu e a fusão sumiu DE VEZ — ninguém volta. Acompanha o
        /// evento de <see cref="Morte"/> normal, que é quem conta a derrota.
        /// </summary>
        FusaoDesfeita
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
