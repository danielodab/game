using UnityEngine;

namespace Soterra.Cena
{
    /// <summary>
    /// O que a CENA precisa saber de uma unidade para plantá-la no tabuleiro.
    ///
    /// É um espelho reduzido de <c>Soterra.Motor.Unidade</c> (CONTRATO_UNITY_F2
    /// §"API do motor"), com os mesmos nomes de campo, e existe por dois
    /// motivos:
    ///
    /// 1. O <c>Motor</c> está sendo escrito em paralelo, por outro dono, e ainda
    ///    não existe nesta árvore. Declarar <c>Soterra.Motor.Unidade</c> aqui
    ///    dentro para me destravar plantaria um tipo duplicado que só explodiria
    ///    na hora de juntar os dois ramos — e explodiria em quem juntasse, não
    ///    em mim.
    /// 2. A cena não tem o que fazer com PV, PA, esquiva nem elemento. Recebendo
    ///    a unidade inteira, qualquer mudança de regra passaria a mexer no
    ///    desenho; recebendo estes seis campos, não passa.
    ///
    /// A ponte, quando o motor chegar, é mecânica e cabe numa linha por campo:
    /// <code>
    /// new FichaDeUnidade {
    ///     Uid = u.Uid, Id = u.ClasseOuMonstroId,
    ///     Heroi = u.Lado == Motor.Lado.Heroi, Casa = u.Casa,
    ///     Viva = u.Viva, ForaDoTabuleiro = u.ForaDoTabuleiro }
    /// </code>
    /// </summary>
    public struct FichaDeUnidade
    {
        /// <summary>Identidade estável da unidade na batalha. É por ela que a
        /// cena reencontra o objeto já criado em vez de fazer outro — sem isso,
        /// cada sincronização recriaria o elenco inteiro e qualquer animação em
        /// curso voltaria ao começo.</summary>
        public string Uid;

        /// <summary>
        /// <c>ClasseOuMonstroId</c> do motor: <c>sumo</c>, <c>arqueiro</c>,
        /// <c>bruxo</c>, <c>espadachim</c>, <c>curandeira</c>, <c>invocador</c>
        /// ou o id de um bicho do bestiário (<c>pollen-puff</c>…).
        ///
        /// É a chave de TUDO que a cena decide sobre esta unidade: o modelo, a
        /// altura e a cor. Trocar o placeholder pelo elenco definitivo é soltar
        /// o prefab na pasta deste id — ver <see cref="ModelosDeResources"/>.
        /// </summary>
        public string Id;

        /// <summary>Lado. <c>bool</c> e não um enum próprio porque um
        /// <c>Soterra.Cena.Lado</c> ao lado de <c>Soterra.Motor.Lado</c> e de
        /// <c>Soterra.Dados.Lado</c> (que já existe, e quer dizer outra coisa:
        /// quem o feitiço aceita como alvo) seria o terceiro tipo com o mesmo
        /// nome e três sentidos.</summary>
        public bool Heroi;

        /// <summary>Onde ela está agora, em casas.</summary>
        public Vector2Int Casa;

        /// <summary>Morta sai do tabuleiro.</summary>
        public bool Viva;

        /// <summary>A fusão tira o convidado do tabuleiro SEM contar derrota
        /// (CONTRATO_UNITY_F2). Para a cena o efeito é o mesmo de morrer — some
        /// —, mas os dois campos vêm separados porque quem soma derrotas precisa
        /// distinguir, e a cena não pode ser a razão de eles virarem um só.</summary>
        public bool ForaDoTabuleiro;

        /// <summary>
        /// Altura em metros, quando quem monta a batalha sabe uma que a tabela
        /// da cena não sabe — o caso real é o CHEFE, que o
        /// CONTRATO_ENTREGA_PERSONAGEM põe entre 5,16 e 5,46 m sem fixar por id.
        /// Zero (o padrão) quer dizer "usa a tabela", que é o certo para as seis
        /// classes e para o monstro comum.
        /// </summary>
        public float Altura;

        /// <summary>Está no tabuleiro? Morta ou levada pela fusão, não está.</summary>
        public bool NoTabuleiro { get { return Viva && !ForaDoTabuleiro; } }
    }
}
