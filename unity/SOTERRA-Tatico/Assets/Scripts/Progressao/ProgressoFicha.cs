using System;
using System.Collections.Generic;
using UnityEngine;
using Soterra.Dados;

namespace Soterra.Progressao
{
    public sealed partial class Progresso
    {
        static readonly string[] ElementosDeResistencia =
            { Dados.Elemento.Fogo, Dados.Elemento.Agua, Dados.Elemento.Terra,
              Dados.Elemento.Ar, Dados.Elemento.Neutro };

        /// <summary>
        /// Esquiva e fixação também sobem com o nível, no ritmo do PAPEL da
        /// classe — a tabela é <c>leveling.defenseByRole</c>, chaveada pelo
        /// <c>role</c> e não pelo id: uma sétima classe herda o ritmo do papel
        /// que escolher, sem uma linha de código nova.
        ///
        /// A curva é reta, da base da classe no nível 1 até o alvo do papel no
        /// nível máximo. Alvo ABAIXO da base vale 0: significa "esta classe não
        /// cresce nisto", nunca "encolha o Bárbaro".
        /// </summary>
        public int GanhoDeDefesa(string classeId, int nivel, string atributo, int baseDaClasse)
        {
            var tabela = Niv.DefesaPorPapel;
            var classe = AchaClasse(classeId);
            if (tabela == null || classe == null || string.IsNullOrEmpty(classe.Papel)) return 0;

            DefesaDePapel linha;
            if (!tabela.TryGetValue(classe.Papel, out linha) || linha == null) return 0;

            var alvo = atributo == "dodge" ? linha.Esquiva
                     : atributo == "lock" ? linha.Fixacao
                     : 0;
            var vao = alvo - baseDaClasse;
            if (vao <= 0) return 0;

            var topo = Math.Max(2, NivelMaximo());
            var degraus = Math.Max(0, Math.Min(nivel, topo) - 1);
            return ArredondaComoNoJs(vao * (double)degraus / (topo - 1));
        }

        /// <summary>A curva de defesa exposta sem montar herói — para a tela e para os testes.</summary>
        public DefesaDePapel DefesaNoNivel(string classeId, int nivel)
        {
            var classe = AchaClasse(classeId);
            var atrib = classe != null && classe.Atributos != null ? classe.Atributos : new Atributos();
            return new DefesaDePapel
            {
                Esquiva = atrib.Esquiva + GanhoDeDefesa(classeId, nivel, "dodge", atrib.Esquiva),
                Fixacao = atrib.Fixacao + GanhoDeDefesa(classeId, nivel, "lock", atrib.Fixacao)
            };
        }

        /// <summary>
        /// O herói como ele entra em campo.
        ///
        /// A ordem é a do <c>progress.js</c> e não é arbitrária: base da classe,
        /// defesa por nível, ganho por nível, itens (COM a forja), conjuntos,
        /// bicho e estrelas de classe. Conjunto e estrela entram DEPOIS e sem
        /// multiplicador — são fontes distintas do item, e passá-las pela forja
        /// faria uma peça +10 inflar o bônus de um conjunto que ela nem completa.
        ///
        /// Devolve <c>null</c> para herói ou classe desconhecidos, e não uma
        /// ficha zerada: quem chama precisa distinguir "herói sem itens" de
        /// "herói que não existe".
        /// </summary>
        public FichaEfetiva FichaDeCombate(string heroiId)
        {
            var h = Heroi(heroiId);
            if (h == null) return null;
            var classe = AchaClasse(h.IdDaClasse);
            if (classe == null || classe.Atributos == null) return null;

            var b = classe.Atributos;
            var nivel = NivelPorXp(h.Xp);
            var ficha = new FichaEfetiva
            {
                Pv = b.Pv, Pa = b.Pa, Pp = b.Pp, Poder = b.Poder,
                Iniciativa = b.Iniciativa, Esquiva = b.Esquiva, Fixacao = b.Fixacao,
                PoderElemental = 0,
                Elemento = string.IsNullOrEmpty(h.Elemento) ? Dados.Elemento.Neutro : h.Elemento,
                Nivel = nivel,
                Resistencias = Copia(b.Resistencias)
            };

            ficha.Esquiva += GanhoDeDefesa(h.IdDaClasse, nivel, "dodge", b.Esquiva);
            ficha.Fixacao += GanhoDeDefesa(h.IdDaClasse, nivel, "lock", b.Fixacao);

            AplicarGanhoDeNivel(ficha, h, nivel);

            // ---- itens vestidos, cada um com a forja da SUA cópia
            for (int i = 0; i < Espacos.Length; i++)
            {
                var vestido = Vestido(heroiId, Espacos[i]);
                if (vestido == null) continue;
                var item = AchaItem(vestido.IdDoItem);
                if (item == null) continue;
                AplicarBonus(ficha, item.Bonus, true, MultiplicadorDeForja(vestido.NivelDeForja));
            }

            // ---- conjuntos: progressivo e cumulativo (4 peças valem 2+3+4)
            var conjuntos = _banco.Conjuntos;
            if (conjuntos != null)
            {
                foreach (var par in PecasVestidasPorConjunto(h))
                {
                    Conjunto def;
                    if (!conjuntos.TryGetValue(par.Key, out def) || def == null || def.Bonus == null)
                        continue;
                    for (int n = 2; n <= par.Value; n++)
                    {
                        Bonus bonus;
                        if (def.Bonus.TryGetValue(n, out bonus)) AplicarBonus(ficha, bonus, false, 1.0);
                    }
                }
            }

            // ---- bicho
            if (!string.IsNullOrEmpty(h.Bicho))
            {
                var bicho = AchaBicho(h.Bicho);
                if (bicho != null) AplicarBonus(ficha, bicho.Bonus, true, 1.0);
            }

            // ---- estrelas de CLASSE: bônus fixo, permanente, sem multiplicador
            foreach (var bonus in BonusDeEstrelas(h.IdDaClasse)) AplicarBonus(ficha, bonus, false, 1.0);

            ficha.Pv = Math.Max(1, ficha.Pv);
            ficha.Pa = Math.Max(0, ficha.Pa);
            ficha.Pp = Math.Max(0, ficha.Pp);
            ficha.PoderElemental = Math.Max(0, ficha.PoderElemental);
            ficha.Esquiva = Math.Max(0, ficha.Esquiva);
            ficha.Fixacao = Math.Max(0, ficha.Fixacao);
            return ficha;
        }

        /// <summary>
        /// Todo nível dá PV; o poder vira ELEMENTAL depois do degrau da escolha.
        ///
        /// Quem passou do nível 5 sem escolher NÃO perde progressão: as subidas
        /// continuam pagando poder genérico e passam a valer como elementais no
        /// instante em que a escolha acontece. Punir quem adiou seria transformar
        /// uma decisão de identidade numa corrida.
        /// </summary>
        void AplicarGanhoDeNivel(FichaEfetiva ficha, FichaDeHeroi h, int nivel)
        {
            var por = Niv.PorNivel;
            var porElemento = Niv.PorNivelComElemento;
            if (por == null && porElemento == null) return;

            var subidas = Math.Max(0, nivel - 1);
            // As subidas ANTES do degrau da escolha: com `elementChoiceLevel` 5
            // são as três de 1→2, 2→3 e 3→4.
            var genericas = Math.Min(subidas, Math.Max(0, NivelDaEscolhaDeElemento - 2));
            var elementais = subidas - genericas;
            var temElemento = ficha.Elemento != Dados.Elemento.Neutro;

            var pvGenerico = por != null ? por.Pv : 0;
            var pvElemental = porElemento != null ? porElemento.Pv : pvGenerico;
            ficha.Pv += pvGenerico * genericas + pvElemental * elementais;

            var poder = por != null ? por.Poder : 0;
            ficha.Poder += poder * genericas;

            if (temElemento && porElemento != null)
                ficha.PoderElemental += porElemento.PoderElemental * elementais;
            else
                ficha.Poder += poder * elementais;
        }

        /// <summary>
        /// Soma um bloco de bônus.
        ///
        /// Duas regras vivem aqui, e as duas seguram a economia do turno:
        ///
        /// 1. <paramref name="multiplicador"/> (a forja) NÃO toca nos atributos
        ///    de <c>upgrade.nonScalingKeys</c> — hoje <c>pa</c> e <c>pp</c>. Sem
        ///    essa exceção, um épico de +1 PA viraria +2 PA já no +5 (1 × 1,6
        ///    arredonda para 2) e o teto de uma ação extra deixaria de existir.
        ///    A lista vem do DADO: mudar o que escala é editar o JSON.
        /// 2. <paramref name="tetoDePaPp"/> corta a contribuição desta FONTE em
        ///    +1 de PA e +1 de PP. Vale para item e bicho; conjunto e estrela de
        ///    classe passam sem corte porque os valores deles já são fixos e o
        ///    acervo escreve exatamente 1 no ★3 (PP) e no ★5 (PA).
        /// </summary>
        void AplicarBonus(FichaEfetiva ficha, Bonus bonus, bool tetoDePaPp, double multiplicador)
        {
            if (bonus == null) return;
            var naoEscalam = ForjaCfg.AtributosQueNaoEscalam;

            for (int i = 0; i < AtributosDeFicha.Length; i++)
            {
                var chave = AtributosDeFicha[i];
                var cru = ValorDe(bonus, chave);
                if (cru == 0) continue;

                var escala = naoEscalam != null && naoEscalam.Contains(chave) ? 1.0 : multiplicador;
                var valor = ArredondaComoNoJs(cru * escala);

                if (tetoDePaPp && chave == "pa") valor = Math.Min(valor, TetoDePaPorFonte);
                if (tetoDePaPp && chave == "pp") valor = Math.Min(valor, TetoDePpPorFonte);
                Somar(ficha, chave, valor);
            }

            if (bonus.Resistencias == null) return;
            var escalaResist = naoEscalam != null && naoEscalam.Contains("resists") ? 1.0 : multiplicador;
            for (int i = 0; i < ElementosDeResistencia.Length; i++)
            {
                var e = ElementosDeResistencia[i];
                var cru = bonus.Resistencias.De(e);
                if (cru == 0) continue;
                SomarResistencia(ficha.Resistencias, e, ArredondaComoNoJs(cru * escalaResist));
            }
        }

        static int ValorDe(Bonus b, string chave)
        {
            switch (chave)
            {
                case "hp": return b.Pv;
                case "pa": return b.Pa;
                case "pp": return b.Pp;
                case "power": return b.Poder;
                case "initiative": return b.Iniciativa;
                case "dodge": return b.Esquiva;
                case "lock": return b.Fixacao;
                default: return 0;
            }
        }

        static void Somar(FichaEfetiva f, string chave, int v)
        {
            switch (chave)
            {
                case "hp": f.Pv += v; break;
                case "pa": f.Pa += v; break;
                case "pp": f.Pp += v; break;
                case "power": f.Poder += v; break;
                case "initiative": f.Iniciativa += v; break;
                case "dodge": f.Esquiva += v; break;
                case "lock": f.Fixacao += v; break;
            }
        }

        static void SomarResistencia(Resistencias r, string elemento, int v)
        {
            switch (elemento)
            {
                case Dados.Elemento.Fogo: r.Fogo += v; break;
                case Dados.Elemento.Agua: r.Agua += v; break;
                case Dados.Elemento.Terra: r.Terra += v; break;
                case Dados.Elemento.Ar: r.Ar += v; break;
                case Dados.Elemento.Neutro: r.Neutro += v; break;
            }
        }

        static Resistencias Copia(Resistencias r)
        {
            if (r == null) return new Resistencias();
            return new Resistencias
            {
                Fogo = r.Fogo, Agua = r.Agua, Terra = r.Terra, Ar = r.Ar, Neutro = r.Neutro
            };
        }

        // ============================================== do progresso para o tabuleiro

        /// <summary>
        /// O herói pronto para nascer numa sala: ficha de combate, elemento,
        /// feitiços liberados e nível.
        ///
        /// Tem de ser chamado ANTES de construir a <c>Motor.Batalha</c>. O
        /// construtor dela ordena a fila por iniciativa e já começa o primeiro
        /// turno; 31 das 90 peças do acervo mexem em iniciativa, então aplicar a
        /// ficha depois deixaria a fila montada com os números errados — e uma
        /// fila errada não parece defeito, parece azar.
        /// </summary>
        public Motor.Unidade NovaUnidade(string heroiId, string uid, Vector2Int casa, int pvInicial)
        {
            var h = Heroi(heroiId);
            if (h == null) return null;
            var classe = AchaClasse(h.IdDaClasse);
            if (classe == null) return null;
            var ficha = FichaDeCombate(heroiId);
            if (ficha == null) return null;

            var u = Motor.Unidade.DeClasse(classe, uid, casa, ficha.Elemento,
                                           new List<string>(FeiticosDe(heroiId)), ficha.Nivel);
            u.PVMax = ficha.Pv;
            u.PV = pvInicial > 0 ? Math.Min(pvInicial, ficha.Pv) : ficha.Pv;
            u.PAMax = ficha.Pa; u.PA = ficha.Pa;
            u.PPMax = ficha.Pp; u.PP = ficha.Pp;
            u.Iniciativa = ficha.Iniciativa;
            u.Poder = ficha.Poder;
            u.PoderElemental = ficha.PoderElemental;
            u.Esquiva = ficha.Esquiva;
            u.Fixacao = ficha.Fixacao;
            u.Resistencias = ficha.Resistencias;
            return u;
        }

        public Motor.Unidade NovaUnidade(string heroiId, string uid, Vector2Int casa)
        {
            return NovaUnidade(heroiId, uid, casa, -1);
        }
    }
}
