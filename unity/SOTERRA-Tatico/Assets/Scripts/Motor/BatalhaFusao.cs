using System;
using System.Collections.Generic;
using Soterra.Grade;

namespace Soterra.Motor
{
    /// <summary>
    /// Uma fusão declarada e ainda não resolvida — o <c>state.pendingFusion</c>
    /// do JS. O anfitrião é quem pagou os 2 PA e quem a fusão preserva (uid,
    /// casa, vez); o convidado é quem sai do tabuleiro.
    /// </summary>
    public sealed class IntencaoDeFusao
    {
        public string UidDoAnfitriao;
        public string UidDoConvidado;
    }

    /// <summary>
    /// A metade da batalha que FUNDE: dois aliados adjacentes viram UMA unidade
    /// com um arsenal inteiro diferente, composto na hora (forma da dupla de
    /// classes × mistura da dupla de elementos — ver <see cref="Dados.Fusao"/>).
    ///
    /// A fonte é <c>js/core/fusion.js</c> (452 linhas), decisão a decisão:
    /// declarar custa 2 PA e resolve no FIM do turno de quem declarou; a
    /// fundida é a PRÓPRIA unidade A, mutada — preserva uid, casa e o lugar na
    /// fila de iniciativa (reordenar no meio da batalha daria turno duplo, a
    /// mesma regra do buff de iniciativa); o convidado sai com
    /// <see cref="Unidade.ForaDoTabuleiro"/>, sem evento de morte e sem contar
    /// derrota; e a morte da fundida É morte — some de vez, ninguém volta.
    /// </summary>
    public sealed partial class Batalha
    {
        /// <summary><c>Fusion.FUSION_PA_COST</c>: declarar custa 2 PA do anfitrião.</summary>
        public const int CustoDePaDaFusao = 2;

        /// <summary>
        /// <c>Fusion.BONUS_PA</c> = 4, e não os 2 do contrato §4 — onde o
        /// documento discorda do código, o código ganha (ver relatório).
        /// </summary>
        public const int BonusDePaDaFusao = 4;

        /// <summary><c>Fusion.BONUS_PP</c>: PP máximo = o maior dos dois, +1.</summary>
        public const int BonusDePpDaFusao = 1;

        /// <summary><c>Fusion.BONUS_SHIELD</c>: escudo permanente que nasce com a fusão.</summary>
        public const int EscudoDaFusao = 50;

        /// <summary>A fusão declarada neste turno, ou nula. Uma por vez na sala inteira.</summary>
        public IntencaoDeFusao FusaoPendente { get; private set; }

        /// <summary>
        /// Os feitiços COMPOSTOS desta batalha, por id — o <c>_genSpells</c> do
        /// JS. Registro da batalha, e não do <see cref="Dados.BancoDeDados"/>:
        /// escrever no banco compartilhado faria a contagem do manifesto
        /// divergir e vazaria feitiço de uma batalha para a outra.
        /// </summary>
        readonly Dictionary<string, Dados.Feitico> _feiticosGerados =
            new Dictionary<string, Dados.Feitico>();

        // ---- consulta --------------------------------------------------------

        /// <summary>Estes dois podem se fundir AGORA? (Sem olhar o PA — isso é da declaração.)</summary>
        public bool PodeFundir(string uidA, string uidB)
        {
            return MotivoParaNaoFundir(uidA, uidB) == null;
        }

        /// <summary>
        /// Com quem <paramref name="uid"/> pode se fundir agora — o
        /// <c>Fusion.candidates</c> do JS, que a interface usa para acender o
        /// botão.
        /// </summary>
        public IReadOnlyList<string> CandidatosAFusao(string uid)
        {
            var saida = new List<string>();
            for (int i = 0; i < _unidades.Count; i++)
            {
                var u = _unidades[i];
                if (u.Uid != uid && PodeFundir(uid, u.Uid)) saida.Add(u.Uid);
            }
            return saida;
        }

        /// <summary>
        /// As regras do <c>Fusion.canFuse</c>, uma a uma, devolvendo o PORQUÊ
        /// da recusa — o motor em C# explica o "não", que é o que a interface
        /// mostra ao jogador.
        /// </summary>
        string MotivoParaNaoFundir(string uidA, string uidB)
        {
            if (Fase != FaseDaBatalha.EmAndamento) return "a batalha já acabou";
            if (string.IsNullOrEmpty(uidA) || string.IsNullOrEmpty(uidB) || uidA == uidB)
                return "a fusão pede duas unidades diferentes";

            var a = Acha(uidA);
            var b = Acha(uidB);
            var travaA = TravaDeFusao(a);
            if (travaA != null) return travaA;
            var travaB = TravaDeFusao(b);
            if (travaB != null) return travaB;

            if (a.Lado != b.Lado) return "só aliados se fundem";
            if (Distancia.Manhattan(a.Casa, b.Casa) != 1)
                return Nome(a) + " e " + Nome(b) + " não estão colados";
            if (FusaoPendente != null) return "já há uma fusão declarada nesta sala";
            return null;
        }

        /// <summary>
        /// O <c>isFusable</c> do JS: viva, no tabuleiro, e nem invocada nem já
        /// fundida. (O JS também barra <c>pet</c>; este motor ainda não os tem.)
        /// </summary>
        static string TravaDeFusao(Unidade u)
        {
            if (u == null || !u.NoTabuleiro) return "não há unidade de pé para fundir";
            if (u.Invocada) return Nome(u) + " é invocada: invocação não se funde";
            if (u.EFusao) return Nome(u) + " já é uma fusão";
            return null;
        }

        // ---- declaração ------------------------------------------------------

        /// <summary>
        /// Declara a fusão: gasta <see cref="CustoDePaDaFusao"/> PA do
        /// anfitrião e marca a intenção. Ela só RESOLVE no fim do turno dele —
        /// e falha se, até lá, os dois se afastarem ou um deles cair. É a
        /// janela de reação do inimigo: fundir não é de graça nem instantâneo.
        /// </summary>
        public Resultado DeclararFusao(string uidDoAnfitriao, string uidDoConvidado)
        {
            _r = new Resultado();
            try
            {
                var motivo = MotivoParaNaoFundir(uidDoAnfitriao, uidDoConvidado);
                if (motivo != null) return _r.Nega(motivo);

                var a = Acha(uidDoAnfitriao);
                if (a.PA < CustoDePaDaFusao)
                    return _r.Nega("declarar a fusão custa " + CustoDePaDaFusao +
                                   " PA e " + Nome(a) + " tem " + a.PA);

                a.PA -= CustoDePaDaFusao;
                FusaoPendente = new IntencaoDeFusao
                {
                    UidDoAnfitriao = uidDoAnfitriao,
                    UidDoConvidado = uidDoConvidado
                };
                Emitir(TipoDeEvento.FusaoDeclarada, uidDoAnfitriao, fonte: uidDoConvidado);
                return _r;
            }
            finally { _r = null; }
        }

        /// <summary>
        /// Desiste da fusão declarada. Os 2 PA NÃO voltam — é o
        /// <c>Fusion.cancel</c> do JS, literal: a preparação já foi gasta.
        /// </summary>
        public Resultado CancelarFusao(string motivo = null)
        {
            _r = new Resultado();
            try
            {
                if (FusaoPendente == null) return _r.Nega("não há fusão declarada");
                var p = FusaoPendente;
                FusaoPendente = null;
                Emitir(TipoDeEvento.FusaoFalhou, p.UidDoAnfitriao, fonte: p.UidDoConvidado,
                       detalhe: motivo ?? "cancelada");
                return _r;
            }
            finally { _r = null; }
        }

        // ---- resolução (fim do turno do anfitrião) ---------------------------

        /// <summary>
        /// O <c>Fusion.resolve</c> do JS, chamado por <see cref="EncerrarTurno"/>
        /// DEPOIS das durações caírem — a mesma ordem do <c>Engine.endTurn</c>.
        /// Só resolve se o turno que acabou é o do anfitrião; falha por morte ou
        /// afastamento, e a falha CONSOME a intenção (os PA não voltam).
        /// </summary>
        void ResolverFusaoPendente(Unidade quemEncerrou)
        {
            var p = FusaoPendente;
            if (p == null || quemEncerrou == null || p.UidDoAnfitriao != quemEncerrou.Uid) return;
            FusaoPendente = null;

            var a = Acha(p.UidDoAnfitriao);
            var b = Acha(p.UidDoConvidado);
            if (a == null || !a.NoTabuleiro || b == null || !b.NoTabuleiro)
            {
                Emitir(TipoDeEvento.FusaoFalhou, p.UidDoAnfitriao, fonte: p.UidDoConvidado,
                       detalhe: "morte");
                return;
            }
            if (Distancia.Manhattan(a.Casa, b.Casa) != 1)
            {
                Emitir(TipoDeEvento.FusaoFalhou, p.UidDoAnfitriao, fonte: p.UidDoConvidado,
                       detalhe: "afastamento");
                return;
            }
            Fundir(a, b);
        }

        /// <summary>O <c>doFuse</c> do JS — a mutação inteira, campo a campo.</summary>
        void Fundir(Unidade a, Unidade b)
        {
            var parDeClasses = Dados.Fusao.ChaveDePar(a.ClasseOuMonstroId, b.ClasseOuMonstroId);
            var elemA = string.IsNullOrEmpty(a.Elemento) ? Dados.Elemento.Neutro : a.Elemento;
            var elemB = string.IsNullOrEmpty(b.Elemento) ? Dados.Elemento.Neutro : b.Elemento;
            var parDeElementos = elemA + "+" + elemB;   // ordem A,B: as espelhadas existem para isto

            // `Math.floor(((a.level||1)+(b.level||1))/2)`: o `||1` do JS cobre
            // nível zerado, e a divisão inteira de C# já é o floor de positivos.
            int nivelA = a.Nivel > 0 ? a.Nivel : 1;
            int nivelB = b.Nivel > 0 ? b.Nivel : 1;
            int nivel = (nivelA + nivelB) / 2;

            // ---- o arsenal composto (o degrau vem do NÍVEL da fusão)
            var compostos = Dados.Fusao.Compor(_banco, parDeClasses, parDeElementos, nivel);
            var ids = new List<string>();
            for (int i = 0; i < compostos.Count; i++)
            {
                _feiticosGerados[compostos[i].Id] = compostos[i];
                if (!ids.Contains(compostos[i].Id)) ids.Add(compostos[i].Id);
            }
            if (ids.Count == 0)
            {
                // Rede de segurança do JS: se o acervo não cobrir a dupla, a
                // fusão AINDA acontece, com a UNIÃO dos dois arsenais — nunca
                // com um kit vazio.
                ids.AddRange(a.Feiticos);
                for (int i = 0; i < b.Feiticos.Count; i++)
                    if (!ids.Contains(b.Feiticos[i])) ids.Add(b.Feiticos[i]);
            }

            // ---- a ficha (fusion.js, doFuse, linha a linha)
            var uidsDeOrigem = new List<string> { a.Uid, b.Uid };
            a.PVMax = a.PVMax + b.PVMax;                       // vida: SOMA
            a.PV = Math.Min(a.PV + b.PV, a.PVMax);
            a.PAMax = Math.Max(a.PAMax, b.PAMax) + BonusDePaDaFusao;   // o melhor corpo, e mais
            a.PPMax = Math.Max(a.PPMax, b.PPMax) + BonusDePpDaFusao;
            a.Iniciativa = Math.Max(a.Iniciativa, b.Iniciativa);   // muda mas NÃO reordena
            a.Poder = Math.Max(a.Poder, b.Poder);
            a.PoderElemental = Arredonda((a.PoderElemental + b.PoderElemental) / 2.0);
            a.Esquiva = Arredonda((a.Esquiva + b.Esquiva) / 2.0);
            a.Fixacao = Arredonda((a.Fixacao + b.Fixacao) / 2.0);
            a.Resistencias = MediaDeResistencias(a.Resistencias, b.Resistencias);
            a.Nivel = nivel;

            // O id vira o DA DUPLA, no formato do dado (`arqueiro+bruxo`) — e
            // não o `fus:`+dupla do defId do JS. É decisão do CONTRATO DE
            // ENTREGA §5: cada dupla tem modelo próprio em
            // `Resources/elenco/<id>/`, e é por este id que a Cena o carrega
            // sem uma linha de código nova. A ordem alfabética garante que a
            // aparência é UMA, independentemente de quem declarou.
            a.ClasseOuMonstroId = parDeClasses;
            a.Nome = a.Nome + " + " + b.Nome;
            a.ParDeClasses = parDeClasses;
            a.ParDeElementos = parDeElementos;
            a.Elementos = new List<string> { elemA, elemB };   // clima e poder elemental valem para os DOIS
            a.Elemento = elemA;
            a.Feiticos = ids;
            a.Recargas.Clear();
            a.LancamentosNesteTurno.Clear();
            a.FundidaDe = uidsDeOrigem;

            // ---- escudo de fusão: permanente (9999 = o "para sempre" do motor)
            a.Efeitos.Add(new EfeitoAtivo
            {
                Tipo = "shield", Valor = EscudoDaFusao, Restante = EscudoDaFusao,
                Duracao = 9999, UidDaFonte = a.Uid
            });
            RecalcularEscudo(a);

            // ---- o convidado sai: NÃO é morte, não conta derrota.
            // Não passa por `SairDoTabuleiro` porque aquele método abre um
            // `Resultado` próprio e descartaria o que este turno já registrou.
            b.Viva = false;
            b.ForaDoTabuleiro = true;
            b.PV = 0;
            b.FundidaEm = a.Uid;
            Emitir(TipoDeEvento.SaiuDoTabuleiro, b.Uid);

            Emitir(TipoDeEvento.Fusao, a.Uid, fonte: b.Uid, q: nivel,
                   detalhe: parDeClasses + ":" + parDeElementos);
            Emitir(TipoDeEvento.Escudo, a.Uid, fonte: a.Uid, q: EscudoDaFusao);
        }

        /// <summary>
        /// Resistências da fundida: MÉDIA aritmética arredondada, elemento a
        /// elemento — nem o melhor nem a soma, para a fusão não virar um corpo
        /// imune por empilhar duas fichas.
        /// </summary>
        static Dados.Resistencias MediaDeResistencias(Dados.Resistencias a, Dados.Resistencias b)
        {
            var x = a ?? new Dados.Resistencias();
            var y = b ?? new Dados.Resistencias();
            return new Dados.Resistencias
            {
                Fogo = Arredonda((x.Fogo + y.Fogo) / 2.0),
                Agua = Arredonda((x.Agua + y.Agua) / 2.0),
                Terra = Arredonda((x.Terra + y.Terra) / 2.0),
                Ar = Arredonda((x.Ar + y.Ar) / 2.0),
                Neutro = Arredonda((x.Neutro + y.Neutro) / 2.0)
            };
        }

        // ---- morte da fusão --------------------------------------------------

        /// <summary>
        /// O <c>Fusion.split</c> do JS, que apesar do nome NÃO desfaz nada: a
        /// fusão que morre some DE VEZ e os dois fundidos não voltam. Garante
        /// que as origens continuam fora do tabuleiro e anuncia o fim — a morte
        /// em si (evento, explosão, contagem de derrota) segue o caminho normal
        /// de <see cref="Morrer"/>, porque matar a fundida É derrota se não
        /// sobrar herói.
        /// </summary>
        void DesfazerFusaoNaMorte(Unidade fundida)
        {
            var origens = fundida.FundidaDe;
            for (int i = 0; origens != null && i < origens.Count; i++)
            {
                var origem = Acha(origens[i]);
                if (origem == null || origem == fundida) continue;
                origem.Viva = false;
                origem.ForaDoTabuleiro = true;
                origem.PV = 0;
            }
            Emitir(TipoDeEvento.FusaoDesfeita, fundida.Uid);
        }
    }
}
