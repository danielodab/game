using UnityEngine;

namespace Soterra.Jogo
{
    // Ver a nota em Partida.cs: os apelidos globais evitam o CS0234 dos
    // namespaces irmãos.
    using Motor = global::Soterra.Motor;
    using Dados = global::Soterra.Dados;
    using Cena = global::Soterra.Cena;
    using Fx = global::Soterra.Fx;

    /// <summary>
    /// Traduz os EVENTOS do motor em efeito visual — o mesmo papel que a
    /// <see cref="AnimacaoDoElenco"/> faz para o Animator, e pela mesma razão:
    /// o motor não desenha, empilha eventos e devolve.
    ///
    /// O DEFEITO QUE ISTO MATA: até aqui, o feitiço acertava em SILÊNCIO. A
    /// unidade gastava PA, o alvo perdia PV, o número mudava na ficha — e no
    /// tabuleiro não acontecia nada. Sem efeito, "conjurei e funcionou" e
    /// "conjurei e o motor recusou" chegam ao jogador com a mesma imagem.
    ///
    /// C# puro, sem <c>MonoBehaviour</c>: o despacho é provado em teste EditMode
    /// avançando o tempo na mão, que é também como o modo lote fotografa o MEIO
    /// de um efeito sem apertar Play.
    /// </summary>
    public sealed class DespachoDeEfeitos
    {
        readonly Cena.Palco _palco;
        readonly Motor.Batalha _batalha;
        readonly Dados.BancoDeDados _banco;
        readonly Fx.BancoDeEfeitos _efeitos;

        public Fx.BancoDeEfeitos Efeitos { get { return _efeitos; } }

        public DespachoDeEfeitos(Cena.Palco palco, Motor.Batalha batalha, Dados.BancoDeDados banco)
        {
            if (palco == null) throw new System.ArgumentNullException("palco");
            if (batalha == null) throw new System.ArgumentNullException("batalha");
            _palco = palco;
            _batalha = batalha;
            _banco = banco;
            // Pendurado no TABULEIRO e não no Palco: pendurado no Palco, a
            // explosão ficaria parada enquanto o chão embaixo dela gira 90°.
            _efeitos = Fx.BancoDeEfeitos.Criar(palco.Tabuleiro);
        }

        /// <summary>
        /// Lê os eventos de uma ação e dispara o que cada um merece. Chamar
        /// ANTES do <c>Elenco.Sincronizar</c>, como a animação: quem morreu
        /// ainda está no tabuleiro e ainda tem casa de onde sair.
        /// </summary>
        public void Reagir(Motor.Resultado r)
        {
            if (r == null || !r.Valido) return;

            for (int i = 0; i < r.Eventos.Count; i++)
            {
                var e = r.Eventos[i];
                switch (e.Tipo)
                {
                    // A CONJURAÇÃO é o evento principal: é o único que carrega o
                    // `fxKey`, e é o `fxKey` que decide a família. O dano NÃO
                    // dispara nada de propósito — o efeito da família já contém a
                    // batida, e disparar nos dois daria efeito duplo em cada
                    // vítima de um feitiço de área.
                    case Motor.TipoDeEvento.Conjuracao:
                        Conjuracao(e);
                        break;

                    case Motor.TipoDeEvento.Cura:
                        // Verde, e não a cor do elemento: o sinal de "ganhei
                        // vida" tem de querer dizer a mesma coisa em qualquer
                        // feitiço. Uma cura de fogo laranja leria como dano.
                        Na(Fx.FamiliaDeEfeito.Cura, e.Uid, Fx.PaletaDeEfeito.Cura);
                        break;

                    case Motor.TipoDeEvento.Escudo:
                        Na(Fx.FamiliaDeEfeito.Escudo, e.Uid, Fx.PaletaDeEfeito.Escudo);
                        break;

                    case Motor.TipoDeEvento.Invocacao:
                        // Pela CASA do evento e não pelo uid: quem nasceu acabou
                        // de entrar na lista, e perguntar a casa a ele daria a
                        // mesma resposta por um caminho mais longo.
                        NaCasa(Fx.FamiliaDeEfeito.Invocacao, e.Para, e.Para,
                               Fx.PaletaDeEfeito.DeElemento(_banco, e.Elemento));
                        break;

                    // ARMADA planta e fica; DISPARADA estoura. São famílias
                    // OPOSTAS de propósito — é a diferença entre "cuidado, tem
                    // algo aqui" e "pisou".
                    case Motor.TipoDeEvento.ArmadilhaArmada:
                        NaCasa(Fx.FamiliaDeEfeito.Armadilha, e.Para, e.Para,
                               CorDoFeitico(e.FeiticoId, e.Elemento));
                        break;

                    case Motor.TipoDeEvento.ArmadilhaDisparada:
                        NaCasa(Fx.FamiliaDeEfeito.Estouro, e.Para, e.Para,
                               CorDoFeitico(e.FeiticoId, e.Elemento));
                        break;

                    case Motor.TipoDeEvento.Teleporte:
                        // Piscar é a única família que precisa das DUAS casas: a
                        // história é sumir de uma e nascer na outra.
                        NaCasa(Fx.FamiliaDeEfeito.Piscar, e.De, e.Para,
                               Fx.PaletaDeEfeito.DeElemento(_banco, e.Elemento));
                        break;

                    case Motor.TipoDeEvento.MarcaDeTerrenoNasceu:
                        NaCasa(Fx.FamiliaDeEfeito.Armadilha, e.Para, e.Para,
                               Fx.PaletaDeEfeito.Padrao);
                        break;

                    case Motor.TipoDeEvento.EventoDeTerreno:
                        Na(Fx.FamiliaDeEfeito.Anel, e.Uid, Fx.PaletaDeEfeito.Padrao);
                        break;

                    case Motor.TipoDeEvento.Morte:
                        Na(Fx.FamiliaDeEfeito.Estouro, e.Uid, Fx.PaletaDeEfeito.Padrao);
                        break;
                }
            }
        }

        /// <summary>
        /// Um quadro de tempo. Fora de Play é aqui que os sistemas recebem
        /// corda — em Play o motor de quadro os avança sozinho.
        /// </summary>
        public void Avancar(float dt)
        {
            _efeitos.Avancar(dt);
        }

        public void Limpar()
        {
            _efeitos.Limpar();
        }

        // ================================================================ APOIO

        void Conjuracao(Motor.Evento e)
        {
            var conjurador = _batalha.Acha(e.Uid);
            if (conjurador == null) return;

            // Pelo BATALHA e não pelo banco: os compostos da fusão (`fus:…`) só
            // existem no registro dela. Pelo banco, toda fusão viria nula e as
            // 2.625 cairiam na bola — o defeito que a linha JS já teve.
            var feitico = _batalha.Feitico(e.FeiticoId);
            var familia = Fx.FamiliaDeEfeito.DeChave(feitico != null ? feitico.ChaveDeEfeito : null);
            var cor = feitico != null
                ? Fx.PaletaDeEfeito.De(_banco, feitico)
                : Fx.PaletaDeEfeito.DeElemento(_banco, e.Elemento);

            NaCasa(familia, conjurador.Casa, e.Para, cor);
        }

        /// <summary>
        /// A cor: a paleta da mistura quando o feitiço é composto por fusão, a
        /// do elemento no resto. O elemento do evento é a rede — armadilha
        /// disparada e marca de terreno nem sempre trazem feitiço conhecido.
        /// </summary>
        Color CorDoFeitico(string feiticoId, string elemento)
        {
            var f = _batalha.Feitico(feiticoId);
            return f != null
                ? Fx.PaletaDeEfeito.De(_banco, f)
                : Fx.PaletaDeEfeito.DeElemento(_banco, elemento);
        }

        void Na(string familia, string uid, Color cor)
        {
            var u = _batalha.Acha(uid);
            if (u == null) return;
            NaCasa(familia, u.Casa, u.Casa, cor);
        }

        void NaCasa(string familia, Vector2Int origem, Vector2Int destino, Color cor)
        {
            _efeitos.Disparar(familia,
                              _palco.Mundo(origem, _palco.TopoDe(origem)),
                              _palco.Mundo(destino, _palco.TopoDe(destino)),
                              cor);
        }
    }
}
