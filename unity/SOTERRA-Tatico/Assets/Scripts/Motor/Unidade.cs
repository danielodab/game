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

        /// <summary>
        /// Os traços passivos da ficha, como o acervo os escreveu.
        ///
        /// A lista inteira, e não um campo booleano por traço: quatro dos cinco
        /// carregam NÚMEROS (<c>radius</c>, <c>damage</c>, <c>hpPct</c>,
        /// <c>count</c>) e um booleano os jogaria fora. <c>ImuneAEmpurrao</c>
        /// continua existindo porque o empurrão é o único que só precisa do
        /// sim/não e é consultado a cada casa de deslocamento.
        /// </summary>
        public List<Dados.Traco> Tracos = new List<Dados.Traco>();

        /// <summary>
        /// O <c>enrage</c> já disparou? Uma vez só na batalha inteira: sem esta
        /// trava, cada golpe abaixo do limiar empilharia outro bônus de poder e
        /// um chefe ferido viraria imbatível em três golpes.
        /// </summary>
        public bool Enfurecida;

        /// <summary>
        /// Entrou em campo por invocação (<c>summon</c> ou <c>split</c>).
        ///
        /// Não sustenta o lado: matar o Xamã acaba a sala mesmo com os bichos
        /// dele de pé, senão bastaria invocar sem parar para empatar a batalha.
        /// </summary>
        public bool Invocada;

        /// <summary>Quem a invocou. Define onde ela entra na fila de iniciativa.</summary>
        public string UidDoInvocador;

        public Dados.Resistencias Resistencias = new Dados.Resistencias();

        // ---- fusão (ver BatalhaFusao.cs) -----------------------------------

        /// <summary>
        /// A chave alfabética da dupla (<c>arqueiro+bruxo</c>) quando esta
        /// unidade É uma fusão; nula no resto do elenco. É também o marcador de
        /// "é fusão" — o <c>kind: 'fusion'</c> do JS —, e não um booleano à
        /// parte, porque toda pergunta que começa com "é fusão?" continua com
        /// "de qual dupla?".
        /// </summary>
        public string ParDeClasses;

        /// <summary>A chave da mistura NA ORDEM DOS FUNDIDOS (<c>fogo+agua</c> ≠ <c>agua+fogo</c>).</summary>
        public string ParDeElementos;

        /// <summary>
        /// Os DOIS elementos da fusão, na ordem (anfitrião, convidado). Nulo em
        /// quem tem um elemento só — <see cref="TemElemento"/> esconde a
        /// diferença de quem pergunta.
        /// </summary>
        public List<string> Elementos;

        /// <summary>Os uids que a formaram (anfitrião primeiro). Nulo fora da fusão.</summary>
        public List<string> FundidaDe;

        /// <summary>No CONVIDADO que saiu do tabuleiro: o uid da fusão em que ele virou.</summary>
        public string FundidaEm;

        public bool EFusao
        {
            get { return ParDeClasses != null; }
        }

        /// <summary>
        /// A unidade É deste elemento? A fusão carrega DOIS — o clima e o poder
        /// elemental valem para os dois lados da mistura (contrato §9-C), e é
        /// esta pergunta, não a igualdade crua com <see cref="Elemento"/>, que
        /// o motor tem de fazer.
        /// </summary>
        public bool TemElemento(string elemento)
        {
            if (string.IsNullOrEmpty(elemento)) return false;
            if (Elementos != null && Elementos.Count > 0) return Elementos.Contains(elemento);
            return Elemento == elemento;
        }

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

            for (int i = 0; monstro.Tracos != null && i < monstro.Tracos.Count; i++)
            {
                var t = monstro.Tracos[i];
                if (t == null || string.IsNullOrEmpty(t.Tipo)) continue;
                u.Tracos.Add(t);
                if (t.Tipo == "pushImmune") u.ImuneAEmpurrao = true;
            }

            return u;
        }

        /// <summary>
        /// O traço deste tipo, ou <c>null</c>. Devolve o traço INTEIRO e não um
        /// booleano porque quem pergunta quase sempre quer o número que vem
        /// junto — o raio da explosão, a fração de vida do <c>enrage</c>.
        /// </summary>
        public Dados.Traco Traco(string tipo)
        {
            for (int i = 0; i < Tracos.Count; i++)
                if (Tracos[i] != null && Tracos[i].Tipo == tipo) return Tracos[i];
            return null;
        }

        public override string ToString()
        {
            return (Nome ?? ClasseOuMonstroId ?? Uid) + " (" + Uid + ")";
        }
    }
}
