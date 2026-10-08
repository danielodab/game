// A Brasa — o ranking da arena, e o fogo que cresce na cabeça (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É
 * ============
 * A insígnia da arena, do jeito do SOTERRA: quem luta na
 * arena carrega uma CHAMA acima do nome, e ela cresce e muda de cor com o
 * ranking. Cinco degraus:
 *
 *   Fagulha        < 1150   faísca miúda, laranja
 *   Brasa          < 1350   chamazinha firme, laranja
 *   Chama          < 1550   fogo de verdade, azulado
 *   Labareda       < 1800   grande, azulada
 *   Coroa de Fogo  ≥ 1800   violeta arcano — E SÓ PARA O 1º DO PLACAR
 *
 * DIFÍCIL DE PROPÓSITO (pedido do usuário): a pontuação é Elo — ganhar de
 * quem vale menos paga quase nada, perder devolve o que se subiu — e a
 * Coroa tem um portão DUPLO: os pontos E o topo do placar. Não existe farm
 * até a Coroa: só reinado.
 *
 * O QUE ALIMENTA: duelo contra OUTRA CONTA. O duelo de treino (mesmo
 * teclado, mesma conta) mostra quanto valeria e não aplica — Elo de jogar
 * contra si mesmo é fábrica de fumaça, e fumaça é o contrário de brasa.
 */
(function () {
  'use strict';
  /* O TEXTO NO IDIOMA DO JOGADOR (docs/IDIOMAS.md): a chave é o próprio português. Sem o JOGO.I18n
   * (o juiz do servidor e as provas em Node não o carregam) volta o português, com as {variáveis}. */
  function Tx(s, v) {
    var I = (typeof JOGO !== 'undefined' && JOGO) ? JOGO.I18n : null;
    if (I && I.t) return I.t(s, v);
    if (!v) return s;
    return String(s).replace(/\{([A-Za-z_]\w*)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(v, k) ? String(v[k]) : m;
    });
  }

  var B = {};
  JOGO.Brasa = B;

  B.INICIAL = 1000;
  B.PISO = 800;
  B.K = 24;

  /* TEMPORADAS (pedido 25/08): a cada 6 semanas o Elo COMPRIME de volta ao
   * meio (não zera — quem subiu continua na frente, mas a escada volta a
   * valer), e a coroa da temporada que fechou vai para a GALERIA da conta,
   * permanente. A época 1 começa no dia em que a Brasa nasceu. */
  B.TEMPORADA_DIAS = 42;
  B.EPOCA = Date.UTC(2026, 7, 24);            // 24/08/2026
  B.temporadaDe = function (ts) {
    ts = (typeof ts === 'number' && isFinite(ts)) ? ts : Date.now();
    return 1 + Math.max(0, Math.floor((ts - B.EPOCA) / (86400000 * B.TEMPORADA_DIAS)));
  };
  B.viraEmDias = function (ts) {
    ts = (typeof ts === 'number' && isFinite(ts)) ? ts : Date.now();
    var fim = B.EPOCA + B.temporadaDe(ts) * 86400000 * B.TEMPORADA_DIAS;
    return Math.max(0, Math.ceil((fim - ts) / 86400000));
  };
  B.comprime = function (pts) {
    pts = (typeof pts === 'number' && isFinite(pts)) ? pts : B.INICIAL;
    return Math.max(B.PISO, B.INICIAL + Math.round((pts - B.INICIAL) * 0.5));
  };

  /* A ESCADA SÃO AS DEZ COROAS DO USUÁRIO (24/08): arte própria por nível
   * (assets_ok/ranking_pvp, embutida em coroas-pvp.js), pendurada acima da
   * cabeça NO LUGAR das chamas. O Elo continua o mesmo; o degrau de cima
   * continua REINADO: os pontos E o 1º do placar. `nivel` é a chave da arte
   * (COROAS_PVP['n'+nivel]); `tam` é a escala do bilhete na praça. */
  /* 11/09 — a coroa CRESCEU (um terço a mais: de longe ela era um ponto) e,
   * do quinto degrau para cima, ACENDE. `brilho` (0 a 1) é a força do halo
   * que a praça pendura atrás dela: nasce fraco na Coroa V e chega inteiro
   * na X. `cor` é a cor desse halo — ouro até a VIII, brasa branca na IX e o
   * violeta arcano do reinado na X. Quem desenha é o hub3d; aqui só a régua. */
  B.BRILHO_DESDE = 5;                    // o degrau em que a coroa começa a acender
  B.TIERS = [
    { id: 'n1',  nivel: 1,  nome: Tx('Coroa I'),    min: 0,    tam: 0.70, brilho: 0 },
    { id: 'n2',  nivel: 2,  nome: Tx('Coroa II'),   min: 1100, tam: 0.76, brilho: 0 },
    { id: 'n3',  nivel: 3,  nome: Tx('Coroa III'),  min: 1200, tam: 0.81, brilho: 0 },
    { id: 'n4',  nivel: 4,  nome: Tx('Coroa IV'),   min: 1300, tam: 0.86, brilho: 0 },
    { id: 'n5',  nivel: 5,  nome: Tx('Coroa V'),    min: 1400, tam: 0.92, brilho: 0.17, cor: '#ffd36a' },
    { id: 'n6',  nivel: 6,  nome: Tx('Coroa VI'),   min: 1500, tam: 1.00, brilho: 0.33, cor: '#ffd36a' },
    { id: 'n7',  nivel: 7,  nome: Tx('Coroa VII'),  min: 1600, tam: 1.08, brilho: 0.50, cor: '#ffca4d' },
    { id: 'n8',  nivel: 8,  nome: Tx('Coroa VIII'), min: 1700, tam: 1.16, brilho: 0.67, cor: '#ffc23a' },
    { id: 'n9',  nivel: 9,  nome: Tx('Coroa IX'),   min: 1800, tam: 1.27, brilho: 0.83, cor: '#fff0c0' },
    { id: 'n10', nivel: 10, nome: Tx('Coroa X'),    min: 1900, tam: 1.42, brilho: 1.00, cor: '#c8a6ff',
      exigeTopo: true }
  ];
  /* O brilho de um degrau, para quem tem só o número na mão (a ficha 2D). */
  B.brilhoDe = function (nivel) {
    for (var i = 0; i < B.TIERS.length; i++) {
      if (B.TIERS[i].nivel === nivel) return B.TIERS[i].brilho || 0;
    }
    return 0;
  };

  /* O degrau dos pontos. `ehTopo` = este jogador é o 1º do placar da arena;
   * sem o topo, quem tem pontos de Coroa X fica na IX — o topo não é um
   * número, é um REINADO. */
  B.tierDe = function (pts, ehTopo) {
    pts = (typeof pts === 'number' && isFinite(pts)) ? pts : B.INICIAL;
    var melhor = B.TIERS[0];
    for (var i = 0; i < B.TIERS.length; i++) {
      var t = B.TIERS[i];
      if (pts < t.min) break;
      if (t.exigeTopo && !ehTopo) continue;
      melhor = t;
    }
    return melhor;
  };

  /* A COROA QUE A CONTA CARREGA ACIMA DA CABEÇA (04/10). O dono: "tenho uma conta sem nada de
   * ponto na coroa e não aparece ela quando eu clico para mostrar.. em todos os níveis deve
   * aparecer". Até aqui quem nunca tinha jogado a Arena (1000 pontos, 0 partidas) ficava sem
   * coroa nenhuma, mesmo com o "Mostrar a coroa acima da cabeça" ligado — o botão não fazia nada
   * numa conta nova. Agora a escada vale desde o primeiro degrau: sem partida, é a Coroa I. Só
   * quem ESCONDEU a coroa na ficha (`oculta`) fica sem ela. `partidas` fica na assinatura para
   * quem chama dizer o que sabe — a regra não o usa mais. É a régua única do herói, dos
   * fantasmas da praça, da ficha, do perfil e do placar. */
  B.coroaDe = function (pts, partidas, ehTopo, oculta, mestre) {
    if (oculta === true) return null;
    if (mestre === true) return B.MESTRE;
    return B.tierDe(pts, ehTopo === true);
  };
  /* A COROA DO MESTRE (08/10 à noite). O dono: "fiz a arte da coroa do GM que deve ser liberada
   * somente para ele.. e o brilho no meio deve ser vermelho". Até aqui o Mestre escolhia no
   * painel qual das DEZ do ranking carregava (05/10) — ele não joga a Arena, então a de verdade
   * parava na I para sempre. Agora ele tem a dele: um degrau FORA da escada (não está em TIERS,
   * ninguém chega nela por pontos), fixo, que só a conta carimbada `mestre` pelo Relé pendura —
   * o próprio cliente pelo JOGO.GM.ativo(), os outros pelo `mestre: true` do perfil que o
   * servidor/rele_ident.py carimba. É SÓ A ARTE acima da cabeça: pontos, partidas, placar e
   * temporada não sabem disto, e o "esconder a coroa" continua por cima. `modelo` é a chave do
   * .glb (coroas-pvp-3d.js, tools/embute_coroa_gm.py); `nivel` fica 'gm' porque a praça só
   * pendura coroa com nivel verdadeiro e o bilhete PNG (COROAS_PVP['n'+nivel]) não existe
   * para ela — sem o 3D aberto, a plaquinha espera a coroa descer (Bundle.pede) em vez de
   * mostrar um bilhete de outra patente. O brilho é o halo da praça, na força da Coroa X e
   * VERMELHO; `tam` é o diâmetro, o mesmo da X. */
  B.MESTRE = { id: 'gm', nivel: 'gm', nome: Tx('Coroa do Mestre'), min: 0, tam: 1.42, brilho: 1.00,
               cor: '#ff2f2f', modelo: 'coroa_gm', mestre: true };

  /* Elo clássico: o esperado vem da diferença, o K é fixo, o piso segura o
   * fundo. Devolve { pts, delta } — quem aplica no DB é o chamador. */
  B.elo = function (meusPts, ptsDele, venci) {
    meusPts = (typeof meusPts === 'number' && isFinite(meusPts)) ? meusPts : B.INICIAL;
    ptsDele = (typeof ptsDele === 'number' && isFinite(ptsDele)) ? ptsDele : B.INICIAL;
    var esperado = 1 / (1 + Math.pow(10, (ptsDele - meusPts) / 400));
    var delta = Math.round(B.K * ((venci ? 1 : 0) - esperado));
    var pts = Math.max(B.PISO, meusPts + delta);
    return { pts: pts, delta: pts - meusPts };
  };
})();
