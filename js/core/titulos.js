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
 *   ECO     (02/10) o pódio (1º ao 3º) de uma semana do Eco Primordial — o
 *           chefe supremo, placar de dano conferido pelo servidor
 *   ARENA   (10/10) o Torneio da Arena (docs/TORNEIO.md): cada torneio de PvP
 *           vencido com chave de 4 ou mais é uma CONQUISTA, e a escada sobe
 *           com elas (1, 2, 3, 5, 10); o representante da guilda campeã leva
 *           "Campeão das Guildas". Para sempre, como os de chefe
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
  /* O TÍTULO DO ECO PRIMORDIAL (02/10): o pódio de UMA semana leva — e é para
   * sempre, como o de chefe (a semana passou, o feito fica). Quem dá é o
   * servidor, no fechamento da semana, pela fila de entregas da loja
   * (servidor/supremo.py, TITULO_ECO — o mesmo texto, que a prova confere); a
   * conta guarda em Progress.titulosEco(). Não se compra. */
  T.ECO = [
    { titulo: 'Voz do Eco', de: 'o pódio de uma semana do Eco Primordial' }
  ];

  /* OS TÍTULOS DO TORNEIO DA ARENA (10/10, docs/TORNEIO.md §1 e §3). "Ganhar de novo continua valendo": a
   * escada sobe com as CONQUISTAS de PvP (um torneio vencido com chave de 4 ou mais) e os degraus de baixo
   * seguem disponíveis. Quem conta é o SERVIDOR (servidor/torneio.py, torneio_conquistas): a régua recebe
   * `estado.arena = {pvp, guilda}` — no jogo, do GET /api/torneio/meu; no juiz, do contexto que a API monta
   * do banco. Para sempre, como os de chefe. O maior tem 19 letras (o teto da plaquinha é 23). */
  T.ARENA = [
    { n: 1,  titulo: 'Campeão da Arena' },
    { n: 2,  titulo: 'Bicampeão da Arena' },
    { n: 3,  titulo: 'Tricampeão da Arena' },
    { n: 5,  titulo: 'Lenda da Arena' },
    { n: 10, titulo: 'Imortal da Arena' }
  ];
  /* o do representante da guilda campeã do torneio de guilda (conquistas.guilda >= 1) */
  T.ARENA_GUILDA = 'Campeão das Guildas';
  /* A MOLDURA "Campeão da Arena" (da conta para sempre desde a primeira conquista em chave de 8 ou 16): o grau
   * (1 = I, 2 = II, 3 = III; 0 sem conquista) e as marcas (uma por conquista, até 5) saem das conquistas de PvP */
  T.ARENA_MARCAS_MAX = 5;
  T.grauDaArena = function (n) { n = num(n); return n >= 5 ? 3 : (n >= 3 ? 2 : (n >= 1 ? 1 : 0)); };
  T.marcasDaArena = function (n) { return Math.max(0, Math.min(T.ARENA_MARCAS_MAX, num(n))); };

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
   * pvp: posição|null, eco: [títulos do Eco já ganhos], arena: {pvp, guilda} (as
   * conquistas do Torneio da Arena) }. Cada linha sai como:
   *
   *   { titulo, fonte: 'pvm'|'pvp'|'classe'|'eco'|'arena'|'chefe', de, ganho, prog, alvo, comoGanhar }
   *
   * `ganho` é o que vale para pendurar; `prog`/`alvo` existem no chefe e na
   * arena (os que têm meio caminho). */
  T.catalogo = function (estado) {
    estado = estado || {};
    var chefes = estado.chefes || {};
    var fora = [];
    T.PVM.forEach(function (d) {
      fora.push({ titulo: d.titulo, fonte: 'pvm', de: Tx('{pos}º do ranking de XP', { pos: d.pos }),
                  ganho: estado.pvm === d.pos, emprestado: true,
                  comoGanhar: Tx('Seja o {pos}º do ranking de XP (e ande com o nome em {medalha}).',
                                 { pos: d.pos, medalha: Tx(T.MEDALHA_PVM[d.pos]) }) });
    });
    T.PVP.forEach(function (d) {
      fora.push({ titulo: d.titulo, fonte: 'pvp', de: Tx('{pos}º do ranking PvP', { pos: d.pos }),
                  ganho: estado.pvp === d.pos, emprestado: true,
                  comoGanhar: Tx('Seja o {pos}º do ranking PvP (pontos de Brasa).', { pos: d.pos }) });
    });
    // os pódios de classe: `estado.classeNomes` = {classId: nome}, `estado.porClasse` = {classId: posição}
    var nomesClasse = estado.classeNomes || {}, porClasse = estado.porClasse || {};
    // o nome da classe NO IDIOMA do jogador, só para a explicação (o título leva o português)
    var nomesVista = estado.classeNomesVista || nomesClasse;
    Object.keys(nomesClasse).forEach(function (cid) {
      [1, 2, 3].forEach(function (pos) {
        fora.push({ titulo: T.tituloDeClasse(pos, nomesClasse[cid]), fonte: 'classe', classe: cid, pos: pos,
                    de: Tx('{pos}º do ranking de {classe}', { pos: pos, classe: nomesVista[cid] || nomesClasse[cid] }),
                    ganho: porClasse[cid] === pos, emprestado: true,
                    comoGanhar: Tx('Seja o {pos}º do ranking de {classe} (a XP dessa classe).',
                                   { pos: pos, classe: nomesVista[cid] || nomesClasse[cid] }) });
      });
    });
    // 02/10: o do Eco — `estado.eco` = os títulos que a conta já ganhou (Progress.titulosEco)
    var ecoGanhos = Object.prototype.toString.call(estado.eco) === '[object Array]' ? estado.eco : [];
    T.ECO.forEach(function (d) {
      fora.push({ titulo: d.titulo, fonte: 'eco', de: Tx(d.de), ganho: ecoGanhos.indexOf(d.titulo) >= 0,
                  emprestado: false,
                  comoGanhar: Tx('Fique entre os 3 primeiros do ranking de dano de uma semana do Eco Primordial.') });
    });
    // 10/10: os do Torneio da Arena — `estado.arena` = {pvp, guilda}, as conquistas contadas pelo servidor
    var arena = (estado.arena && typeof estado.arena === 'object') ? estado.arena : {};
    var conqPvp = Math.max(0, num(arena.pvp)), conqGuilda = Math.max(0, num(arena.guilda));
    T.ARENA.forEach(function (d) {
      fora.push({ titulo: d.titulo, fonte: 'arena', de: Tx('o Torneio da Arena'), ganho: conqPvp >= d.n,
                  emprestado: false, prog: Math.min(conqPvp, d.n), alvo: d.n,
                  comoGanhar: d.n === 1
                    ? Tx('Vença um torneio de PvP da Arena com chave de 4 ou mais.')
                    : Tx('Vença {vezes} torneios de PvP da Arena com chave de 4 ou mais.', { vezes: d.n }) });
    });
    fora.push({ titulo: T.ARENA_GUILDA, fonte: 'arena', de: Tx('o Torneio das Guildas'), ganho: conqGuilda >= 1,
                emprestado: false, prog: Math.min(conqGuilda, 1), alvo: 1,
                comoGanhar: Tx('Represente a sua guilda e vença o torneio de guilda com chave de 4 ou mais.') });
    T.CHEFES.forEach(function (c) {
      var n = Math.max(0, num(chefes[c.chefe]));
      fora.push({ titulo: c.titulo, fonte: 'chefe', de: Tx(c.nome), chefe: c.chefe,
                  ganho: n >= T.ALVO_CHEFE, emprestado: false,
                  prog: Math.min(n, T.ALVO_CHEFE), alvo: T.ALVO_CHEFE,
                  comoGanhar: Tx('Derrube {nome} {vezes} vezes no DIFÍCIL e SOZINHO.', { nome: Tx(c.nome), vezes: T.ALVO_CHEFE }) });
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
    // 08/10 à noite (o dono: "o Mestre pode escolher o título que ele quiser"): a conta do Mestre leva
    // qualquer título curto (até 23 letras — o maior do catálogo); os outros, só o que a régua dá
    if (estado && estado.mestre === true) {
      var t = String(titulo).trim();
      return t.length > 0 && t.length <= 23 && t.indexOf('\n') < 0;
    }
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
