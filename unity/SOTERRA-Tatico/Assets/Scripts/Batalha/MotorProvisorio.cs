using System.Collections.Generic;
using UnityEngine;

// ===========================================================================
//  ARQUIVO PROVISÓRIO — APAGUE-O INTEIRO NO MERGE.
//
//  O dono de `Soterra.Motor` é o papel Motor, em `Assets/Scripts/Motor/**`.
//  Essa pasta ainda não existe nesta árvore, e sem os tipos dela o Montador
//  não tem o que devolver — nem compila, nem se testa.
//
//  Então aqui está o MÍNIMO da API fixada em `docs/CONTRATO_UNITY_F2.md`
//  (seção "API do motor"), e só o mínimo: os tipos que o Montador preenche,
//  mais a passagem de turno, que é a única regra necessária para provar que a
//  ordem de iniciativa montada é a ordem certa.
//
//  Está DENTRO de `Assets/Scripts/Batalha/` de propósito, e não em
//  `Assets/Scripts/Motor/`: escrever na pasta do outro dono criaria conflito de
//  conteúdo no mesmo caminho. Assim o conflito é a duplicação de tipo, que o
//  compilador aponta na hora e se resolve apagando ESTE arquivo, um só.
//
//  O que NÃO está aqui, porque o Montador não precisa e inventar a forma seria
//  pior que faltar: `AlvosDe`, `PodeConjurar`, `Conjurar`, `Resultado` e
//  `Evento` — o contrato cita `Resultado.Eventos` mas nunca diz o que um
//  `Evento` tem dentro.
// ===========================================================================

namespace Soterra.Motor
{
    public enum Lado { Heroi, Monstro }

    /// <summary>
    /// Uma criatura no tabuleiro. Campos públicos, e não propriedades, porque é
    /// assim que o contrato os escreve.
    ///
    /// FALTA AQUI, e o Montador sente na hora: não há campo de INICIATIVA. Sem
    /// ele a ordem de turno só existe como a lista que o Montador entregou, e
    /// ninguém consegue recalculá-la depois — nem a interface consegue mostrar
    /// por que fulano joga antes de sicrano. Idem `Poder`, `Fixacao`,
    /// `Resistencias` e a lista de feitiços, sem os quais não há o que conjurar.
    /// Está no relatório.
    /// </summary>
    public sealed class Unidade
    {
        public string Uid;

        /// <summary>Id de classe (herói) ou id de monstro. Nunca o NOME visível.</summary>
        public string ClasseOuMonstroId;

        public Lado Lado;
        public Vector2Int Casa;
        public int PV, PVMax, PA, PAMax, PP, PPMax, Esquiva, Nivel;
        public string Elemento;
        public bool Viva;

        /// <summary>A fusão tira o convidado do tabuleiro sem contar derrota.</summary>
        public bool ForaDoTabuleiro;

        /// <summary>Quem ainda pode receber um turno.</summary>
        public bool NoJogo { get { return Viva && !ForaDoTabuleiro; } }
    }

    /// <summary>
    /// A batalha montada. PROVISÓRIA — ver o cabeçalho do arquivo.
    /// </summary>
    public sealed class Batalha
    {
        public Grade.Mapa Mapa;

        /// <summary>Ordem de NASCIMENTO, espelhando `state.units` do `js/core/engine.js`.</summary>
        public IReadOnlyList<Unidade> Unidades;

        /// <summary>
        /// Ordem de INICIATIVA, que é coisa diferente da de nascimento.
        ///
        /// O contrato não previu este campo, e a batalha não fecha sem ele: o
        /// `Atual` sozinho diz de quem é a vez agora e some com o resto, e a
        /// interface tem de desenhar a fila inteira (contrato, seção Interface).
        /// Espelha `state.order` do JS.
        /// </summary>
        public IReadOnlyList<Unidade> Ordem;

        public Unidade Atual;
        public int Rodada;
        public string Clima;

        readonly List<Unidade> _ordem;
        int _indice;

        public Batalha(Grade.Mapa mapa, IList<Unidade> unidades,
                       IList<Unidade> ordemDeIniciativa, string clima)
        {
            Mapa = mapa;
            Unidades = new List<Unidade>(unidades);
            _ordem = new List<Unidade>(ordemDeIniciativa);
            Ordem = _ordem;
            Clima = clima;
            Rodada = 1;
            _indice = 0;
            Atual = _ordem.Count > 0 ? _ordem[0] : null;
            if (Atual != null) EncherRecursos(Atual);
        }

        /// <summary>
        /// Passa a vez. A rodada só vira quando a fila dá a volta.
        /// </summary>
        public void EncerrarTurno()
        {
            if (_ordem.Count == 0) return;

            for (int passos = 0; passos < _ordem.Count; passos++)
            {
                _indice++;
                if (_indice >= _ordem.Count) { _indice = 0; Rodada++; }

                var proxima = _ordem[_indice];
                if (!proxima.NoJogo) continue;   // morto e fundido não recebem turno

                Atual = proxima;
                EncherRecursos(proxima);
                return;
            }

            Atual = null;   // não sobrou ninguém que possa jogar
        }

        /// <summary>
        /// PA e PP enchem no começo do turno DA UNIDADE, não no começo da
        /// rodada. Encher por rodada daria ação de graça a quem joga por último
        /// e é o defeito que o `startTurn` do JS existe para evitar.
        /// </summary>
        static void EncherRecursos(Unidade u)
        {
            u.PA = u.PAMax;
            u.PP = u.PPMax;
        }
    }
}
