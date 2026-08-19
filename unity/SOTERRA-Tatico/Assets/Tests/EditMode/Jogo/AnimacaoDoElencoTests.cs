using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace Soterra.Testes.Jogo
{
    // ARMADILHA DE NOME, já paga: apelidos globais contra o CS0234 dos irmãos.
    using Motor = global::Soterra.Motor;
    using Dados = global::Soterra.Dados;
    using Cena = global::Soterra.Cena;
    using Jogo = global::Soterra.Jogo;

    /// <summary>
    /// O espelho de ANIMAÇÃO do piloto: movimento vira deslize com
    /// <c>Velocidade</c>, dano e esquiva armam <c>Levar</c>, conjuração arma
    /// <c>Atacar</c>, e a morte deixa o corpo CAÍDO — tudo em EditMode, com o
    /// tempo avançado na mão, que é como o lote fotografa o meio do walk.
    ///
    /// A batalha é a REAL da Estufa (AcervoDoJogo), porque o que se prova é o
    /// bruxo de verdade — FBX, clipes e controlador — reagindo aos eventos de
    /// verdade do motor.
    /// </summary>
    public class AnimacaoDoElencoTests
    {
        GameObject _go;
        Cena.Palco _palco;
        Cena.Elenco _elenco;
        Motor.Batalha _batalha;
        Dados.BancoDeDados _banco;
        Jogo.AnimacaoDoElenco _animacao;

        const float Quadro = 1f / 30f;

        [SetUp]
        public void Antes()
        {
            _banco = AcervoDoJogo.Banco();
            _batalha = AcervoDoJogo.NovaBatalha();

            _go = new GameObject("palco-de-animacao");
            _palco = _go.AddComponent<Cena.Palco>();
            _palco.Montar(_batalha.Mapa);

            _elenco = new Cena.Elenco(_palco, _banco);
            _animacao = new Jogo.AnimacaoDoElenco(_elenco, _palco, _batalha);
            Espelhar(_batalha.Abertura);
        }

        [TearDown]
        public void Depois()
        {
            if (_go != null) Object.DestroyImmediate(_go);
        }

        /// <summary>O funil do JogoDeBatalha.AposAcao, na mesma ordem: reagir
        /// ANTES do espelho (o morto ainda existe), animar DEPOIS (o andarilho
        /// já está plantado no destino).</summary>
        void Espelhar(Motor.Resultado r)
        {
            _animacao.Reagir(r);
            _elenco.Sincronizar(Soterra.Jogo.Fichas.De(_batalha, _banco));
            _animacao.Animar();
        }

        Motor.Unidade AteVezDoBruxo()
        {
            for (int i = 0; i < 200; i++)
            {
                var u = _batalha.Atual;
                if (u != null && u.NoTabuleiro && u.Lado == Motor.Lado.Heroi &&
                    u.ClasseOuMonstroId == "bruxo") return u;
                _batalha.EncerrarTurno();
            }
            Assert.Fail("o bruxo nunca chegou a jogar — a fila está quebrada");
            return null;
        }

        Animator AnimatorDe(string uid)
        {
            var raiz = _elenco.ObjetoDe(uid);
            Assert.IsNotNull(raiz, "não há unidade " + uid + " em cena");
            var a = raiz.GetComponentInChildren<Animator>(true);
            Assert.IsNotNull(a, "a unidade " + uid + " está sem Animator");
            Assert.IsNotNull(a.runtimeAnimatorController, uid + " está sem controlador");
            return a;
        }

        static Motor.Resultado Acao(params Motor.Evento[] eventos)
        {
            var r = new Motor.Resultado();
            for (int i = 0; i < eventos.Length; i++) r.Eventos.Add(eventos[i]);
            return r;
        }

        // ============================================================ MOVIMENTO

        [Test]
        public void Movimento_ViraDeslize_DaOrigemAoDestino_ComVelocidadeNoAnimator()
        {
            var bruxo = AteVezDoBruxo();
            Espelhar(null);
            var origem = bruxo.Casa;

            // Um destino com custo ≥ 2, para o meio do caminho EXISTIR.
            Vector2Int? destino = null;
            foreach (var par in _batalha.AlcanceDePasso())
                if (par.Value >= 2) { destino = par.Key; break; }
            Assert.IsTrue(destino.HasValue, "o bruxo não alcança nem duas casas");

            var r = _batalha.Andar(destino.Value);
            Assert.IsTrue(r.Valido, "o motor recusou o passo: " + r.Recusa);
            Espelhar(r);

            var raiz = _elenco.ObjetoDe(bruxo.Uid);
            var animator = AnimatorDe(bruxo.Uid);

            // Logo após o espelho: de volta à ORIGEM (o Sincronizar tinha
            // plantado no destino — sem o deslize devolver, o walk não existe).
            Assert.IsTrue(_animacao.Ocupada, "o movimento não virou deslize");
            Assert.AreEqual(origem, _palco.Casa(raiz.transform.position),
                            "o deslize não começou na casa de partida");
            Assert.Greater(animator.GetFloat(Jogo.AnimacaoDoElenco.ParametroVelocidade), 0f,
                           "andando sem Velocidade — o walk nunca tocaria");

            // No meio: nem na origem, nem no destino — é o quadro da foto.
            var mundoOrigem = raiz.transform.position;
            for (int i = 0; i < 600 && _animacao.Progresso < 0.5f; i++)
                _animacao.Avancar(Quadro);
            Assert.Greater(Vector3.Distance(raiz.transform.position, mundoOrigem), 0.3f,
                           "no meio do deslize o corpo não saiu do lugar");
            Assert.AreNotEqual(destino.Value, _palco.Casa(raiz.transform.position),
                               "no meio do deslize o corpo já estava plantado no destino");

            // No fim: exatamente na casa do motor, e a Velocidade zera — o
            // Animator volta ao idle sozinho pela escada do controlador.
            for (int i = 0; i < 900 && _animacao.Ocupada; i++)
                _animacao.Avancar(Quadro);
            Assert.IsFalse(_animacao.Ocupada, "o deslize nunca terminou");
            Assert.AreEqual(destino.Value, _palco.Casa(raiz.transform.position),
                            "o deslize terminou fora da casa que o motor mandou");
            Assert.AreEqual(0f, animator.GetFloat(Jogo.AnimacaoDoElenco.ParametroVelocidade),
                            1e-4f, "a Velocidade não zerou no fim do deslize");
        }

        // ============================================================= GATILHOS

        [Test]
        public void Dano_Esquiva_EConjuracao_ArmamOsGatilhosDoContrato()
        {
            var bruxo = AteVezDoBruxo();
            Espelhar(null);
            var animator = AnimatorDe(bruxo.Uid);

            _animacao.Reagir(Acao(new Motor.Evento
            {
                Tipo = Motor.TipoDeEvento.Dano, Uid = bruxo.Uid, Quantidade = 3
            }));
            Assert.IsTrue(animator.GetBool(Jogo.AnimacaoDoElenco.GatilhoLevar),
                          "Dano no alvo não armou Levar");
            animator.ResetTrigger(Jogo.AnimacaoDoElenco.GatilhoLevar);

            // A esquiva usa o MESMO clipe: o hit do contrato é um recuo
            // agachado, que é o gesto de quem tenta escapar da fixação.
            _animacao.Reagir(Acao(new Motor.Evento
            {
                Tipo = Motor.TipoDeEvento.EsquivaFalhou, Uid = bruxo.Uid
            }));
            Assert.IsTrue(animator.GetBool(Jogo.AnimacaoDoElenco.GatilhoLevar),
                          "EsquivaFalhou no alvo não armou Levar");
            animator.ResetTrigger(Jogo.AnimacaoDoElenco.GatilhoLevar);

            _animacao.Reagir(Acao(new Motor.Evento
            {
                Tipo = Motor.TipoDeEvento.Conjuracao, Uid = bruxo.Uid,
                Para = bruxo.Casa + Vector2Int.right
            }));
            Assert.IsTrue(animator.GetBool(Jogo.AnimacaoDoElenco.GatilhoAtacar),
                          "Conjuracao não armou Atacar no conjurador");
        }

        // ================================================================ MORTE

        [Test]
        public void Morte_DoAnimado_DeixaOCorpoCaido_SemSeloNemMarca()
        {
            var bruxo = AteVezDoBruxo();
            Espelhar(null);
            var raiz = _elenco.ObjetoDe(bruxo.Uid);
            var animator = AnimatorDe(bruxo.Uid);

            _animacao.Reagir(Acao(new Motor.Evento
            {
                Tipo = Motor.TipoDeEvento.Morte, Uid = bruxo.Uid
            }));

            // Solto do Elenco ANTES do espelho — é o que impede a destruição.
            Assert.IsNull(_elenco.ObjetoDe(bruxo.Uid), "o morto continua administrado");
            Assert.IsTrue(animator.GetBool(Jogo.AnimacaoDoElenco.GatilhoMorrer),
                          "a morte não armou Morrer");

            // Cadáver não é informação tática: sem selo e sem marca, o corpo
            // caído não lê como unidade viva.
            Assert.IsTrue(raiz.transform.Find("Selo") == null, "o cadáver ficou com selo");
            Assert.IsTrue(raiz.transform.Find("Marca") == null, "o cadáver ficou com marca");

            // O espelho seguinte — com o bruxo fora do tabuleiro, como o motor
            // o listaria — NÃO destrói o corpo.
            var fichas = Soterra.Jogo.Fichas.De(_batalha, _banco);
            for (int i = 0; i < fichas.Count; i++)
                if (fichas[i].Uid == bruxo.Uid)
                {
                    var f = fichas[i];
                    f.Viva = false;
                    fichas[i] = f;
                }
            _elenco.Sincronizar(fichas);

            Assert.IsTrue(raiz != null,
                          "o Sincronizar destruiu o corpo caído no mesmo quadro da queda");
        }

        [Test]
        public void MortoNoMesmoGolpe_NaoLevaGatilhoDeLevar()
        {
            // Dano e Morte chegam na MESMA ação. Um Levar armado sobreviveria
            // ao Morrer dentro do Animator e o cadáver levantaria agachado um
            // quadro depois de cair.
            var bruxo = AteVezDoBruxo();
            Espelhar(null);
            var animator = AnimatorDe(bruxo.Uid);

            _animacao.Reagir(Acao(
                new Motor.Evento { Tipo = Motor.TipoDeEvento.Dano, Uid = bruxo.Uid, Quantidade = 99 },
                new Motor.Evento { Tipo = Motor.TipoDeEvento.Morte, Uid = bruxo.Uid }));

            Assert.IsTrue(animator.GetBool(Jogo.AnimacaoDoElenco.GatilhoMorrer));
            Assert.IsFalse(animator.GetBool(Jogo.AnimacaoDoElenco.GatilhoLevar),
                           "o golpe fatal deixou Levar armado junto com Morrer");
        }

        [Test]
        public void Morte_DaCapsula_SomeComoSempre_NadaQuebraParaQuemNaoTemClipe()
        {
            // A rede dos outros 20 personagens (e do bestiário inteiro): sem
            // Animator, a morte segue o caminho de sempre — some no espelho.
            // Uma cápsula "caída" continuaria de pé, ocupando uma casa livre.
            Motor.Unidade monstro = null;
            for (int i = 0; i < _batalha.Unidades.Count; i++)
                if (_batalha.Unidades[i].Lado == Motor.Lado.Monstro)
                { monstro = _batalha.Unidades[i]; break; }
            Assert.IsNotNull(monstro, "a sala real veio sem monstro");

            _animacao.Reagir(Acao(new Motor.Evento
            {
                Tipo = Motor.TipoDeEvento.Morte, Uid = monstro.Uid
            }));

            // Sem Animator com controlador, ninguém adota: continua administrado…
            Assert.IsNotNull(_elenco.ObjetoDe(monstro.Uid));

            // …e o espelho com a ficha morta o remove, como antes do piloto.
            var fichas = Soterra.Jogo.Fichas.De(_batalha, _banco);
            for (int i = 0; i < fichas.Count; i++)
                if (fichas[i].Uid == monstro.Uid)
                {
                    var f = fichas[i];
                    f.Viva = false;
                    fichas[i] = f;
                }
            _elenco.Sincronizar(fichas);
            Assert.IsNull(_elenco.ObjetoDe(monstro.Uid), "o monstro morto continuou desenhado");
        }
    }
}
