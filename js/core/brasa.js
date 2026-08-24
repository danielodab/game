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

  /* A ESCADA SÃO AS DEZ COROAS DO USUÁRIO (24/08): arte própria por nível
   * (assets_ok/ranking_pvp, embutida em coroas-pvp.js), pendurada acima da
   * cabeça NO LUGAR das chamas. O Elo continua o mesmo; o degrau de cima
   * continua REINADO: os pontos E o 1º do placar. `nivel` é a chave da arte
   * (COROAS_PVP['n'+nivel]); `tam` é a escala do bilhete na praça. */
  B.TIERS = [
    { id: 'n1',  nivel: 1,  nome: 'Coroa I',    min: 0,    tam: 0.52 },
    { id: 'n2',  nivel: 2,  nome: 'Coroa II',   min: 1100, tam: 0.56 },
    { id: 'n3',  nivel: 3,  nome: 'Coroa III',  min: 1200, tam: 0.60 },
    { id: 'n4',  nivel: 4,  nome: 'Coroa IV',   min: 1300, tam: 0.64 },
    { id: 'n5',  nivel: 5,  nome: 'Coroa V',    min: 1400, tam: 0.68 },
    { id: 'n6',  nivel: 6,  nome: 'Coroa VI',   min: 1500, tam: 0.74 },
    { id: 'n7',  nivel: 7,  nome: 'Coroa VII',  min: 1600, tam: 0.80 },
    { id: 'n8',  nivel: 8,  nome: 'Coroa VIII', min: 1700, tam: 0.86 },
    { id: 'n9',  nivel: 9,  nome: 'Coroa IX',   min: 1800, tam: 0.94 },
    { id: 'n10', nivel: 10, nome: 'Coroa X',    min: 1900, tam: 1.05, exigeTopo: true }
  ];

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
