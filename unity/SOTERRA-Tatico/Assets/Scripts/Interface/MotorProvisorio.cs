using System.Collections.Generic;
using UnityEngine;

// ============================================================================
//  ARQUIVO PROVISÓRIO — APAGUE-O quando `Assets/Scripts/Motor/` existir.
//
//  `Soterra.Motor` está sendo escrito EM PARALELO por outro agente, noutra
//  árvore. A Interface precisa compilar hoje contra as assinaturas do contrato
//  (CONTRATO_UNITY_F2, "API do motor"), e o único jeito de fazer isso sem o
//  motor na árvore é declarar aqui o mínimo que a ponte lê.
//
//  QUANDO OS DOIS RAMOS SE ENCONTRAREM este arquivo vai colidir com o motor de
//  verdade (CS0101, tipo declarado duas vezes). A correção é UMA: apagar este
//  arquivo. `PonteDoMotor.cs` continua compilando, porque foi escrito contra o
//  contrato e não contra esta imitação.
//
//  Por isso os tipos estão todos aqui, num arquivo só, e não espalhados: apagar
//  tem de ser uma operação, não uma caçada.
// ============================================================================

namespace Soterra.Motor
{
    /// <summary>PROVISÓRIO — ver o cabeçalho do arquivo.</summary>
    public enum Lado
    {
        Heroi,
        Monstro
    }

    /// <summary>PROVISÓRIO — ver o cabeçalho do arquivo.</summary>
    public sealed class Unidade
    {
        public string Uid;
        public string ClasseOuMonstroId;
        public Lado Lado;
        public Vector2Int Casa;
        public int PV, PVMax, PA, PAMax, PP, PPMax, Esquiva, Nivel;
        public string Elemento;
        public bool Viva;

        /// <summary>A fusão tira o convidado do tabuleiro sem contar derrota.</summary>
        public bool ForaDoTabuleiro;
    }

    /// <summary>
    /// PROVISÓRIO — ver o cabeçalho do arquivo.
    ///
    /// Só os campos que a interface LÊ. Nada de <c>Andar</c>, <c>Conjurar</c> ou
    /// <c>EncerrarTurno</c>: imitação de regra é pior que regra ausente, porque
    /// passa em teste e mente em jogo.
    /// </summary>
    public sealed class Batalha
    {
        public Grade.Mapa Mapa;
        public IReadOnlyList<Unidade> Unidades;
        public Unidade Atual;
        public int Rodada;
        public string Clima;
    }
}
