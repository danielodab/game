using System.Collections.Generic;
using UnityEngine;

namespace Soterra.Motor
{
    /// <summary>
    /// De que lado a unidade luta. São dois e não uma cor livre: o motor precisa
    /// responder "acabou?" toda vez que alguém morre, e isso é uma pergunta
    /// sobre dois times.
    /// </summary>
    public enum Lado { Heroi, Monstro }

    /// <summary>
    /// Um efeito em curso no corpo de alguém — escudo, veneno, marca, bônus.
    ///
    /// É classe própria e não <see cref="Dados.Efeito"/> porque o do acervo é o
    /// MOLDE (o que o feitiço promete) e este é o ESTADO (o que sobrou dele
    /// neste corpo, neste turno). Guardar o molde do acervo dentro da unidade
    /// faria dois venenos da mesma fonte compartilharem a duração — e o segundo
    /// apagaria o primeiro sem que ninguém visse.
    /// </summary>
    public sealed class EfeitoAtivo
    {
        /// <summary>Vocabulário fechado do acervo, em inglês: shield, poison, mark…</summary>
        public string Tipo;

        public string Elemento;

        /// <summary>Atributo mexido pelo <c>buff</c>: pa, pp, power, dodge, lock, initiative.</summary>
        public string Atributo;

        public int Valor;

        /// <summary>Quanto ainda resta ABSORVER. Só o escudo usa.</summary>
        public int Restante;

        public int Min, Max;

        /// <summary>Turnos que ainda faltam. Cai no FIM do turno de quem o carrega.</summary>
        public int Duracao;

        /// <summary>
        /// O poder do conjurador CONGELADO na hora do lançamento. O veneno é a
        /// única coisa que causa dano fora do turno de quem o lançou; ler o
        /// poder no tique faria a força do lançador continuar valendo depois de
        /// ele morrer, ou depois de perder o bônus que o deu.
        /// </summary>
        public int PoderDaFonte;

        public string UidDaFonte;
    }

    /// <summary>
    /// Quem está em pé no tabuleiro.
    ///
    /// Herói e monstro são o MESMO tipo, com <see cref="Lado"/> diferente: no
    /// combate tudo que os separa é de que lado contam para o fim da batalha.
    /// Duas classes fariam toda regra ser escrita duas vezes, e a segunda cópia
    /// é a que envelhece.
    /// </summary>
    public sealed class Unidade
    {
        // ---- o que o contrato §"API do motor" declara ----------------------
        public string Uid;

        /// <summary>Id de classe (<c>sumo</c>, <c>arqueiro</c>) ou de monstro.</summary>
        public string ClasseOuMonstroId;

        public Lado Lado;
        public Vector2Int Casa;
        public int PV, PVMax, PA, PAMax, PP, PPMax, Esquiva, Nivel;
        public string Elemento = Dados.Elemento.Neutro;
        public bool Viva = true;

        /// <summary>
        /// Saiu do tabuleiro sem morrer — é o convidado de uma fusão.
        ///
        /// Existe separado de <see cref="Viva"/> porque a diferença entre os dois
        /// é justamente o que a fusão precisa: some do tabuleiro, mas o
        /// desaparecimento NÃO é uma morte, não emite evento de morte e não
        /// entra na conta de derrota.
        /// </summary>
        public bool ForaDoTabuleiro;

        // ---- além do contrato: sem isto a regra não fecha (ver relatório) ---

        /// <summary>Nome visível. O contrato não pede, mas todo evento fica ilegível sem.</summary>
        public string Nome;

        /// <summary>Ordena o turno. Sem ela não existe "de quem é a vez".</summary>
        public int Iniciativa;

        /// <summary>O quanto ESTA unidade prende as outras (<c>lock</c> no acervo).</summary>
        public int Fixacao;

        /// <summary>Poder genérico: entra em todo dano conjurado.</summary>
        public int Poder;

        /// <summary>Poder que só conta quando o feitiço é do elemento da unidade.</summary>
        public int PoderElemental;

        /// <summary>Traço <c>pushImmune</c>: empurrão e puxão não a tiram do lugar.</summary>
        public bool ImuneAEmpurrao;

        public Dados.Resistencias Resistencias = new Dados.Resistencias();

        /// <summary>Os ids que ela sabe conjurar. Feitiço fora desta lista não sai.</summary>
        public List<string> Feiticos = new List<string>();

        public List<EfeitoAtivo> Efeitos = new List<EfeitoAtivo>();

        /// <summary>Turnos que faltam para cada feitiço voltar. Zero ou ausente = pronto.</summary>
        public Dictionary<string, int> Recargas = new Dictionary<string, int>();

        /// <summary>Quantas vezes cada feitiço já saiu NESTE turno.</summary>
        public Dictionary<string, int> LancamentosNesteTurno = new Dictionary<string, int>();

        /// <summary>Soma do que os escudos ainda absorvem. Derivado dos efeitos.</summary>
        public int Escudo;

        /// <summary>
        /// Está de pé numa casa? Morte e fusão tiram do tabuleiro por caminhos
        /// diferentes, e quase todo laço do motor quer as duas de uma vez —
        /// perguntar só por <see cref="Viva"/> deixaria o convidado da fusão
        /// bloqueando passagem e sendo alvo de feitiço.
        /// </summary>
        public bool NoTabuleiro
        {
            get { return Viva && !ForaDoTabuleiro; }
        }

        /// <summary>
        /// Monta a unidade a partir da ficha REAL da classe.
        ///
        /// Existe para que nem o montador nem o teste precisem digitar 150, 6, 3
        /// e 5 à mão: esquiva é identidade de classe (5 no Bárbaro, 30 no
        /// Ladino), e número copiado à mão é número que envelhece sozinho.
        ///
        /// Nível 1: a escala por nível é de <c>Progress.battleParty</c>, que não
        /// existe nesta camada. Passar <paramref name="nivel"/> só registra o
        /// nível — não mexe em atributo (ver relatório).
        /// </summary>
        public static Unidade DeClasse(Dados.Classe classe, string uid, Vector2Int casa,
                                       string elemento = null, IList<string> feiticos = null,
                                       int nivel = 1)
        {
            if (classe == null) throw new System.ArgumentNullException("classe");
            var a = classe.Atributos ?? new Dados.Atributos();

            var u = new Unidade
            {
                Uid = uid,
                Nome = classe.Nome,
                ClasseOuMonstroId = classe.Id,
                Lado = Soterra.Motor.Lado.Heroi,
                Casa = casa,
                PV = a.Pv, PVMax = a.Pv,
                PA = a.Pa, PAMax = a.Pa,
                PP = a.Pp, PPMax = a.Pp,
                Iniciativa = a.Iniciativa,
                Poder = a.Poder,
                Esquiva = a.Esquiva,
                Fixacao = a.Fixacao,
                Resistencias = a.Resistencias ?? new Dados.Resistencias(),
                Elemento = string.IsNullOrEmpty(elemento) ? Dados.Elemento.Neutro : elemento,
                Nivel = nivel
            };

            u.Feiticos.AddRange(feiticos ?? (IList<string>)classe.FeiticosBase);
            return u;
        }

        /// <summary>
        /// Monta a unidade a partir da ficha REAL do monstro.
        ///
        /// Os atributos do acervo já vêm escalados pela profundidade do
        /// calabouço — a fábrica do JS multiplica antes de escrever. Reaplicar a
        /// escala aqui dobraria a dureza do jogo inteiro.
        /// </summary>
        public static Unidade DeMonstro(Dados.Monstro monstro, string uid, Vector2Int casa)
        {
            if (monstro == null) throw new System.ArgumentNullException("monstro");
            var a = monstro.Atributos ?? new Dados.Atributos();

            var u = new Unidade
            {
                Uid = uid,
                Nome = monstro.Nome,
                ClasseOuMonstroId = monstro.Id,
                Lado = Soterra.Motor.Lado.Monstro,
                Casa = casa,
                PV = a.Pv, PVMax = a.Pv,
                PA = a.Pa, PAMax = a.Pa,
                PP = a.Pp, PPMax = a.Pp,
                Iniciativa = a.Iniciativa,
                Poder = a.Poder,
                Esquiva = a.Esquiva,
                Fixacao = a.Fixacao,
                Resistencias = a.Resistencias ?? new Dados.Resistencias(),
                Elemento = string.IsNullOrEmpty(monstro.Elemento) ? Dados.Elemento.Neutro : monstro.Elemento,
                Nivel = 1
            };

            u.Feiticos.AddRange(monstro.Feiticos);

            // Dos cinco traços do acervo só este muda o resultado de um efeito
            // já implementado; os outros quatro (enrage, explodeOnDeath, split,
            // regenAura) ficaram de fora desta rodada e estão no relatório.
            for (int i = 0; monstro.Tracos != null && i < monstro.Tracos.Count; i++)
                if (monstro.Tracos[i] != null && monstro.Tracos[i].Tipo == "pushImmune")
                    u.ImuneAEmpurrao = true;

            return u;
        }

        public override string ToString()
        {
            return (Nome ?? ClasseOuMonstroId ?? Uid) + " (" + Uid + ")";
        }
    }
}
