// Os afixos de sala — a regra que muda a sala de hoje (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É (07/10)
 * ====================
 * O dono: "tô achando meio repetitivo". As dezoito salas dos seis portais são
 * desenhadas à mão e não mudam — na terceira visita o jogador já sabe a jogada
 * ótima de cada uma. Um AFIXO é uma regra a mais, posta POR CIMA da sala que já
 * existe, sem mexer em mapa, elenco nem chefe: hoje os monstros são Ferozes,
 * amanhã o chão é Traiçoeiro. A sala é a mesma; a solução, não.
 *
 * ONDE ELE ENTRA: no Calabouço do Dia (diario.js). O portal em promoção ganha,
 * além do +50% de saque, o afixo do dia — e a sala com afixo paga +25% de XP
 * e de saque, como o desafio de sala. Os outros cinco portais continuam o jogo
 * de sempre, previsível e aprendível, de propósito: quem está subindo de nível
 * tem um lugar fixo, e quem já bateu o teto tem o lugar que muda.
 *
 * DETERMINÍSTICO PELO DIA DE BRASÍLIA, como o Calabouço do Dia: todo mundo vê
 * o mesmo afixo o dia inteiro, e o servidor sabe qual é sem perguntar a
 * ninguém (o juiz responde GET /dia, e a API guarda o afixo NO BILHETE — a
 * sala aberta às 23:59 fecha com o afixo com que abriu).
 *
 * QUEM APLICA: o motor (engine.js, Engine.createBattle com `opts.afixo`) —
 * sempre por `Ax()`, e só quando a sala nasce com o campo. Uma sala sem afixo
 * não passa por nada daqui. O juiz carrega este arquivo (motor.js) e refaz a
 * sala com o mesmo afixo do bilhete: o que é regra mora aqui, e nada aqui
 * sorteia fora do gerador semeado (o Chão Traiçoeiro nasce de uma semente
 * própria, derivada da semente da sala — não gasta o rng dela).
 *
 * A LISTA é o que a tela mostra e o que o servidor aceita (GET /regras
 * anuncia os ids). Para acrescentar um afixo basta uma entrada aqui e, se
 * a regra for nova, um gancho no motor; os de número (vida, dano, passo,
 * esquiva) não precisam de gancho nenhum. */
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

  var Af = {};
  JOGO.Afixos = Af;

  /* +25% de XP e de saque na sala com afixo — a mesma régua do desafio de
   * sala (Engine.DESAFIO_BONUS), de propósito: o jogador já conhece o número. */
  Af.BONUS = 0.25;
  /* o Chão Traiçoeiro usa o gerador de perigos do Poço com a densidade deste
   * "andar": 3 perigos, com os quatro tipos abertos (poco.js, Po.TIPOS) */
  Af.ANDAR_DO_CHAO = 6;

  /* A LISTA. Cada afixo tem o que a tela diz (nome, ícone, texto) e UMA regra:
   *   vida      multiplica o PV máximo de quem nasce do lado inimigo;
   *   dano      multiplica o dano de quem é do lado inimigo (dealDamage);
   *   pp        soma ao PP de quem nasce do lado inimigo;
   *   esquiva   soma à esquiva de quem nasce do lado inimigo;
   *   clima     a sala abre com OUTRO clima da roda dela, sorteado pela semente,
   *             e ele fica preso a luta inteira (o motor pula a virada) — hoje
   *             só o Coração Partido gira clima, então sem o sorteio o afixo
   *             seria um nada em cinco portais;
   *   perigos   os perigos do chão do Poço nascem na sala (Po.regras). */
  Af.LISTA = [
    { id: 'ferozes', nome: Tx('Ferozes'), icone: '🔥',
      texto: Tx('Os monstros ferem 20% a mais.'), dano: 1.2 },
    { id: 'couracados', nome: Tx('Couraçados'), icone: '🛡',
      texto: Tx('Os monstros nascem com 30% a mais de vida.'), vida: 1.3 },
    { id: 'ligeiros', nome: Tx('Ligeiros'), icone: '💨',
      texto: Tx('Os monstros andam uma casa a mais por vez.'), pp: 1 },
    { id: 'esquivos', nome: Tx('Esquivos'), icone: '🌀',
      texto: Tx('Os monstros desviam 15 a mais.'), esquiva: 15 },
    { id: 'clima_virado', nome: Tx('Clima Virado'), icone: '⛈',
      texto: Tx('A sala abre com outro clima, sorteado, e ele não muda a luta inteira.'), clima: true },
    { id: 'chao_traicoeiro', nome: Tx('Chão Traiçoeiro'), icone: '⚠',
      texto: Tx('Os perigos do Poço brotam na sala: placas de setas, runas, jatos e chão rachado.'), perigos: true }
  ];

  Af.porId = function (id) {
    for (var i = 0; i < Af.LISTA.length; i++) if (Af.LISTA[i].id === id) return Af.LISTA[i];
    return null;
  };
  Af.ids = function () { return Af.LISTA.map(function (a) { return a.id; }); };

  /* AAAAMMDD do dia DE BRASÍLIA (UTC−3 fixo, sem horário de verão desde 2019)
   * — a mesma régua do Calabouço do Dia (diario.js) e das missões. */
  function chaveDoDia(ts) {
    var t = (typeof ts === 'number' && isFinite(ts)) ? ts : Date.now();
    var d = new Date(t - 3 * 3600 * 1000);
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }
  Af.chaveDoDia = chaveDoDia;

  /* FNV-1a do texto: a mesma família de hash do motor e do Poço, cópia local
   * de propósito — este módulo abre o painel do portal antes do Engine. */
  function hashStr(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* O AFIXO DO DIA: um hash do dia com um sal próprio ('afixo:'), para não
   * andar colado ao sorteio do Calabouço do Dia — dois sorteios do mesmo
   * número dariam sempre o mesmo par portal/afixo. Determinístico e sem
   * estado: o servidor e a página chegam ao mesmo id. */
  Af.doDia = function (ts) {
    if (!Af.LISTA.length) return null;
    var h = hashStr('afixo:' + chaveDoDia(ts));
    h ^= h << 13; h = (h ^ (h >>> 7)) >>> 0;
    return Af.LISTA[h % Af.LISTA.length].id;
  };

  /* o mulberry32 semeado por texto (o mesmo do Poço e das missões) */
  function gerador(txt) {
    var a = hashStr(String(txt));
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* APLICAR, na sala recém-nascida (Engine.createBattle chama, depois de os
   * monstros existirem e antes da colocação). `I` é o INTERNO do motor; `room`
   * é a sala do dado; `chave` é o texto que semeia o chão (a semente da sala).
   * Devolve o afixo aplicado ou lança: um id que o catálogo não conhece é
   * erro de entrada — o servidor só aceita ids da lista, e o juiz recusa a
   * sala antes de refazê-la ('a sala não existe nestas regras'). */
  Af.aplica = function (state, id, room, chave, I) {
    var a = Af.porId(id);
    if (!a) throw new Error('Afixos.aplica: afixo desconhecido: ' + String(id));
    state.afixo = { id: a.id, nome: a.nome, texto: a.texto, icone: a.icone };
    if (a.dano) state.afixo.dano = a.dano;
    if (a.clima) {
      state.afixo.climaPreso = true;
      var roda = (I && I.weatherCycle) ? I.weatherCycle(state) : [];
      var outros = roda.filter(function (w) { return w !== state.weather; });
      if (outros.length && I && I.setWeather) {
        var rc = gerador('afixo-clima:' + String(chave));
        I.setWeather(state, outros[Math.floor(rc() * outros.length)], true);   // em silêncio: a sala já abre assim
      }
    }
    var i, u;
    for (i = 0; i < state.units.length; i++) {
      u = state.units[i];
      if (u.side !== 'enemy') continue;
      if (a.vida) { u.hpMax = Math.round(u.hpMax * a.vida); u.hp = u.hpMax; }
      if (a.pp) { u.ppMax += a.pp; u.pp = u.ppMax; }
      if (a.esquiva) u.dodge = (u.dodge || 0) + a.esquiva;
    }
    if (a.perigos) {
      var Po = JOGO.Poco;
      if (Po && Po.geraPerigos && Po.regras && room && room.layout) {
        var grade = room.layout.map(function (row) { return row.split(''); });
        var lista = Po.geraPerigos(Af.ANDAR_DO_CHAO, grade, gerador('afixo-chao:' + String(chave)));
        if (lista.length) Po.regras.monta(state, { perigos: lista }, I);
      }
    }
    return state.afixo;
  };
})();
