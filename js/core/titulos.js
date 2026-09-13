// Os TÍTULOS da plaquinha — o que se conquista e não se compra (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É (11/09)
 * ====================
 * A linha dourada embaixo do nome, na praça. Ela existia desde 25/08 e vinha
 * das CONQUISTAS do quadro de missões — "vença 5 salas no difícil" e o título
 * caía. O dono cortou essa fonte: título de missão é tarefa cumprida, e
 * tarefa qualquer um cumpre. Título agora é POSIÇÃO ou TEIMOSIA, e só:
 *
 *   PVM     top 1, 2 e 3 do ranking de XP do site ("Top 1 PVM"; e o nome em
 *           ouro, prata e bronze)
 *   PVP     top 1, 2 e 3 do ranking da arena, a Brasa ("Top 1 Pvp")
 *   CHEFE   dez quedas do MESMO chefe, no DIFÍCIL e SOZINHO — um título por
 *           chefe, seis ao todo
 *
 * A diferença entre eles importa: os de ranking são EMPRESTADOS (perdeu a
 * posição, perdeu o título — e quem o estiver usando volta a andar só com o
 * nome), os de chefe são PARA SEMPRE. É a mesma lógica da Coroa X da arena,
 * que é reinado e não número.
 *
 * Este arquivo é só a RÉGUA: o catálogo e a conta de quem ganhou o quê, tudo
 * função pura. Quem conta chefe derrubado é o DB (`chefesVer`), quem sabe a
 * posição no ranking é a HUD (que tem o placar), e quem pendura é o hub3d. */
(function () {
  'use strict';

  var T = {};
  JOGO.Titulos = T;

  /* Dez quedas, no difícil, sozinho. Dez é muito de propósito: o título tem
   * de custar mais que uma tarde. */
  T.ALVO_CHEFE = 10;

  /* Um título por chefe. O nome do chefe fica aqui como ele é escrito em
   * DATA.monsters — a ficha mostra os dois lado a lado, e um dado que o
   * jogador vê não pode depender de o DATA estar carregado. */
  T.CHEFES = [
    { chefe: 'boss-gardener',   calabouco: 'greenhouse',   nome: 'A Jardineira-Viúva',
      titulo: 'o Podador da Viúva' },
    { chefe: 'boss-baroness',   calabouco: 'cistern',      nome: 'Baronesa Salmoura',
      titulo: 'o Rompe-Salmoura' },
    { chefe: 'boss-heartforge', calabouco: 'emberlock',    nome: 'Magno, o Acendedor',
      titulo: 'o Apaga-Fornalha' },
    { chefe: 'boss-windwright', calabouco: 'windscaffold', nome: 'Cambota, o Mestre-de-Obras',
      titulo: 'o Derruba-Andaime' },
    { chefe: 'boss-deepknock',  calabouco: 'quakemine',    nome: 'Batepedra, o Que Bate Embaixo',
      titulo: 'o Cala-Batida' },
    { chefe: 'boss-riftheart',  calabouco: 'brokenheart',  nome: 'O Coração Partido',
      titulo: 'o Fecho do Coração' }
  ];

  /* Os pódios. As LANTERNAS descem na frente (o ranking de níveis é quem foi
   * mais fundo); a ARENA é punho, lâmina e escudo. Nenhum deles fala "Fundo":
   * Mestre do Fundo é a equipe, e título de jogador não pode se passar por
   * ela — o relé recusaria, e com razão. */
  /* 12/09, pedido do dono: os pódios com o nome da POSIÇÃO — "Top 1 PVM" para
   * o ranking de XP e "Top 1 Pvp" para o da arena. Quem é o top 1, 2 e 3 do
   * ranking de XP ainda anda com o nome em ouro, prata e bronze (MEDALHA_PVM);
   * o do PvP ganha só o título. */
  T.PVM = [
    { pos: 1, titulo: 'Top 1 PVM' },
    { pos: 2, titulo: 'Top 2 PVM' },
    { pos: 3, titulo: 'Top 3 PVM' }
  ];
  T.PVP = [
    { pos: 1, titulo: 'Top 1 Pvp' },
    { pos: 2, titulo: 'Top 2 Pvp' },
    { pos: 3, titulo: 'Top 3 Pvp' }
  ];
  T.MEDALHA_PVM = { 1: 'ouro', 2: 'prata', 3: 'bronze' };

  function num(v) { return (typeof v === 'number' && isFinite(v)) ? Math.floor(v) : 0; }
  function posValida(p) { return p === 1 || p === 2 || p === 3; }

  /* O PÓDIO DE CADA CLASSE (13/09, pedido do dono: "título também de Top 3 de
   * classes — top 1 Xamã, top 1 Bárbaro — mas sem refletir no nome brilhante").
   * O título é "Top N <nome da classe>", com o nome do DATA.classes (o mesmo no
   * jogo e no juiz do servidor). NÃO acende o nome: o brilho é só do ranking
   * geral de XP, que soma a conta inteira. */
  T.tituloDeClasse = function (pos, nomeClasse) { return 'Top ' + pos + ' ' + nomeClasse; };

  /* a cor do nome de quem está na posição `pos` do ranking de XP, ou null */
  T.medalhaDe = function (pos) { return posValida(pos) ? T.MEDALHA_PVM[pos] : null; };
  /* o nome como chave: o ranking do site só publica o nome, sem id */
  T.chaveNome = function (n) { return String(n == null ? '' : n).trim().toLowerCase(); };
  /* { nome em minúsculas: 1|2|3 } a partir de uma lista JÁ ORDENADA do
   * ranking ([{nome}]) — só os três primeiros, e um nome repetido fica com a
   * primeira posição que teve. */
  T.posicoesPorNome = function (lista) {
    var fora = {};
    (lista || []).slice(0, 3).forEach(function (l, i) {
      var k = T.chaveNome(l && l.nome);
      if (k && !fora[k]) fora[k] = i + 1;
    });
    return fora;
  };

  /* O CATÁLOGO INTEIRO com o estado de cada título, na ordem em que a ficha
   * o mostra. `estado` = { chefes: {bossId: quedas}, pvm: posição|null,
   * pvp: posição|null }. Cada linha sai como:
   *
   *   { titulo, fonte: 'pvm'|'pvp'|'chefe', de, ganho, prog, alvo, comoGanhar }
   *
   * `ganho` é o que vale para pendurar; `prog`/`alvo` só existem no chefe (é
   * o único que tem meio caminho). */
  T.catalogo = function (estado) {
    estado = estado || {};
    var chefes = estado.chefes || {};
    var fora = [];
    T.PVM.forEach(function (d) {
      fora.push({ titulo: d.titulo, fonte: 'pvm', de: d.pos + 'º do ranking de XP',
                  ganho: estado.pvm === d.pos, emprestado: true,
                  comoGanhar: 'Seja o ' + d.pos + 'º do ranking de XP (e ande com o nome em ' +
                              T.MEDALHA_PVM[d.pos] + ').' });
    });
    T.PVP.forEach(function (d) {
      fora.push({ titulo: d.titulo, fonte: 'pvp', de: d.pos + 'º do ranking PvP',
                  ganho: estado.pvp === d.pos, emprestado: true,
                  comoGanhar: 'Seja o ' + d.pos + 'º do ranking PvP (pontos de Brasa).' });
    });
    // os pódios de classe: `estado.classeNomes` = {classId: nome}, `estado.porClasse` = {classId: posição}
    var nomesClasse = estado.classeNomes || {}, porClasse = estado.porClasse || {};
    Object.keys(nomesClasse).forEach(function (cid) {
      [1, 2, 3].forEach(function (pos) {
        fora.push({ titulo: T.tituloDeClasse(pos, nomesClasse[cid]), fonte: 'classe', classe: cid, pos: pos,
                    de: pos + 'º do ranking de ' + nomesClasse[cid],
                    ganho: porClasse[cid] === pos, emprestado: true,
                    comoGanhar: 'Seja o ' + pos + 'º do ranking de ' + nomesClasse[cid] + ' (a XP dessa classe).' });
      });
    });
    T.CHEFES.forEach(function (c) {
      var n = Math.max(0, num(chefes[c.chefe]));
      fora.push({ titulo: c.titulo, fonte: 'chefe', de: c.nome, chefe: c.chefe,
                  ganho: n >= T.ALVO_CHEFE, emprestado: false,
                  prog: Math.min(n, T.ALVO_CHEFE), alvo: T.ALVO_CHEFE,
                  comoGanhar: 'Derrube ' + c.nome + ' ' + T.ALVO_CHEFE +
                              ' vezes no DIFÍCIL e SOZINHO.' });
    });
    return fora;
  };

  /* Só os títulos que podem ser pendurados agora. */
  T.ganhos = function (estado) {
    return T.catalogo(estado).filter(function (t) { return t.ganho; })
      .map(function (t) { return t.titulo; });
  };

  /* O título guardado na conta ainda vale? Os de ranking se perdem quando a
   * posição se perde — e aí a plaquinha volta a mostrar só o nome, sem que
   * ninguém precise ir lá tirar. */
  T.valido = function (titulo, estado) {
    if (!titulo) return false;
    return T.ganhos(estado).indexOf(titulo) >= 0;
  };

  /* A posição de uma conta numa lista já ORDENADA de ids (1, 2, 3 ou null). */
  T.posicaoDe = function (ids, id) {
    if (!ids || !id) return null;
    for (var i = 0; i < ids.length && i < 3; i++) {
      if (ids[i] === id) return i + 1;
    }
    return null;
  };
  T._posValida = posValida;
})();
