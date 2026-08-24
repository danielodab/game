// A Brasa — o ranking da arena, e o fogo que cresce na cabeça (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É
 * ============
 * O lugar das asas de nação do Dofus, do jeito do SOTERRA: quem luta na
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

  var B = {};
  JOGO.Brasa = B;

  B.INICIAL = 1000;
  B.PISO = 800;
  B.K = 24;

  /* paleta = a folha de chama que o hub acende; tam = escala do fogo. */
  /* CADA degrau com cara propria — "so tem 1 efeito" foi o veredito da
   * primeira versao, em que dois degraus dividiam a paleta azulada e a Coroa
   * presa no portao caia na Labareda. Agora: laranja -> azulada -> violeta ->
   * e a Coroa e uma COROA literal: tres fogos em arco sobre a cabeca. */
  B.TIERS = [
    { id: 'fagulha',  nome: 'Fagulha',       min: 0,    paleta: 'fire',          tam: 0.45 },
    { id: 'brasa',    nome: 'Brasa',         min: 1150, paleta: 'fire',          tam: 0.75 },
    { id: 'chama',    nome: 'Chama',         min: 1350, paleta: 'blueish_flame', tam: 1.00 },
    { id: 'labareda', nome: 'Labareda',      min: 1550, paleta: 'magic',         tam: 1.30 },
    { id: 'coroa',    nome: 'Coroa de Fogo', min: 1800, paleta: 'magic',         tam: 1.55,
      coroa: true, exigeTopo: true }
  ];

  /* O degrau dos pontos. `ehTopo` = este jogador é o 1º do placar da arena;
   * sem o topo, quem tem pontos de Coroa fica em Labareda — a Coroa não é
   * um número, é um REINADO. */
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
