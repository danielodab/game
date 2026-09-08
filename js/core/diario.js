// O Calabouço do Dia — o portal marcado que paga mais (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É
 * ============
 * Retenção barata e honesta (pacote 25/08): a cada dia, UM calabouço é o
 * "do dia" e paga +50% de saque. Nada de conteúdo novo — é o conteúdo que
 * já existe, revezando quem está em promoção, e uma razão para abrir o
 * jogo hoje E amanhã.
 *
 * DETERMINÍSTICO PELO DIA LOCAL: todo mundo na mesma máquina vê o mesmo
 * calabouço o dia inteiro; sem sorteio guardado, sem estado — a data é a
 * semente. Quando o servidor chegar, ele passa a mandar o dia (e pode
 * variar o bônus), e este módulo vira o cache da resposta.
 *
 * QUEM APLICA: game.js multiplica o multDrop do rollDrops por BONUS_DROP
 * quando a descida é no calabouço do dia; a HUD marca o painel do portal.
 */
(function () {
  'use strict';

  var Dd = {};
  JOGO.Diario = Dd;

  Dd.BONUS_DROP = 1.5;

  /* Os IDS de verdade ('greenhouse', 'cistern'…), venha a tabela como array
   * ou como objeto — o teste pegou o índice '0' saindo no lugar do id. */
  function lista() {
    var dgs = (JOGO.DATA && JOGO.DATA.dungeons) || {};
    var fora = [];
    Object.keys(dgs).forEach(function (k) {
      var d = dgs[k];
      var id = (d && d.id) ? d.id : k;
      // 08/09: portal fechado não vira Calabouço do Dia
      if (JOGO.DATA.portalFechado && JOGO.DATA.portalFechado(id)) return;
      fora.push(id);
    });
    return fora;
  }

  /* AAAAMMDD do dia LOCAL vira a semente — um hash pequeno e estável. */
  function chaveDoDia(ts) {
    var d = new Date(typeof ts === 'number' && isFinite(ts) ? ts : Date.now());
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  Dd.hoje = function (ts) {
    var ids = lista();
    if (!ids.length) return null;
    var seed = chaveDoDia(ts);
    // xorshift de uma volta: dias vizinhos caem longe um do outro
    var h = seed ^ (seed << 13);
    h = (h ^ (h >>> 7)) >>> 0;
    return { dungeonId: ids[h % ids.length], bonusDrop: Dd.BONUS_DROP };
  };

  Dd.ehHoje = function (dungeonId, ts) {
    var h = Dd.hoje(ts);
    return !!(h && h.dungeonId === dungeonId);
  };
})();
