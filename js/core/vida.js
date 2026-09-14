// A vida única de cada herói da conta — contínua entre praça, salas, Poço, grupo e duelo (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É (14/09, pedido do dono: "hoje nas salas de espera a vida vai recuperando aos
 * poucos até encher ou o jogador usa pote; isso vale para quando terminar calabouço (na
 * praça), depois de um pvp e assim por diante; e se o jogador estiver com a vida na metade e
 * começar uma batalha sendo pvp, poço, desafio ou outro calabouço, a vida vai começar onde
 * estava, na metade")
 * ============
 * Até 13/09 a vida só atravessava DENTRO de uma descida (game.js, a sala de espera) e a
 * descida seguinte nascia cheia. Agora cada herói tem UMA vida, que vale em toda parte:
 *
 *     PV agora = min(máximo, PV do fim + curas + floor((agora − desde) / msPorPv))
 *
 * `desde` é o instante em que a última luta dele acabou (vitória ou derrota; quem caiu fica a
 * 0 e volta a subir), `curas` as poções bebidas desde então e `msPorPv` o de
 * DATA.vidaEntreSalas (2 s). Herói sem registro — ou que já encheu — está CHEIO: sai de
 * toda lista e de todo carry, e o motor dá a ele o PV máximo de agora (que pode ter subido
 * com o nível ou com a peça nova). Herói a 0 não entra em batalha nenhuma.
 *
 * O registro mora no localStorage por conta ('soterra-vida-v1' + Contas.sufixo()), FORA do
 * save e do DB de propósito: a vida muda sozinha com o relógio, e dentro do Progress ela
 * mexeria no hash da economia a cada segundo (o servidor compara esse hash). Com a sessão do
 * site o dono é o SERVIDOR (GET /api/vida): `sincroniza` troca o registro daqui pelo de lá;
 * entre uma resposta e outra, a conta daqui só mostra a barra subindo.
 *
 * Sem este módulo (as páginas de prova antigas e o juiz do servidor) o game.js trata todo
 * herói como cheio, sem erro. */
(function () {
  'use strict';

  var Vida = {};
  JOGO.Vida = Vida;

  Vida.CHAVE = 'soterra-vida-v1';
  Vida._relogio = null;        // provas: () => ms (o relógio da vida)

  var cache = null, cacheChave = null;
  var ouvintes = [];
  var puxando = null, puxarDeNovo = false;

  function num(v, def) { return (typeof v === 'number' && isFinite(v)) ? v : def; }

  Vida.msPorPv = function () {
    var v = (JOGO.DATA && JOGO.DATA.vidaEntreSalas) || {};
    return (typeof v.msPorPv === 'number' && isFinite(v.msPorPv) && v.msPorPv > 0) ? v.msPorPv : 2000;
  };
  function agora() {
    if (typeof Vida._relogio === 'function') {
      try { var t = Vida._relogio(); if (typeof t === 'number' && isFinite(t)) return t; } catch (e) {}
    }
    return Date.now();
  }
  Vida.agoraMs = agora;

  /* ------------------------------------------------------------ o registro */
  function chave() {
    var C = JOGO.Contas, suf = '';
    try { suf = (C && C.sufixo) ? C.sufixo() : ''; } catch (e) { suf = ''; }
    return Vida.CHAVE + (suf || '');
  }
  function armazem() {
    try { return (typeof window !== 'undefined' && window.localStorage) ? window.localStorage : null; } catch (e) { return null; }
  }
  // o registro sadio: só heróis com hp inteiro 0..max, max ≥ 1, desde e cura números
  function saneia(bruto) {
    var out = {};
    var hs = (bruto && typeof bruto === 'object' && bruto.herois && typeof bruto.herois === 'object') ? bruto.herois : {};
    Object.keys(hs).forEach(function (hid) {
      var h = hs[hid];
      if (!h || typeof h !== 'object' || !hid || hid.length > 80) return;
      var max = Math.floor(num(h.max, 0));
      if (max < 1 || max > 100000) return;
      var hp = Math.max(0, Math.min(max, Math.floor(num(h.hp, max))));
      out[hid] = { hp: hp, max: max, desde: num(h.desde, 0), cura: Math.max(0, Math.floor(num(h.cura, 0))) };
    });
    return out;
  }
  function registro() {
    var k = chave();
    if (cache && cacheChave === k) return cache;
    cacheChave = k;
    cache = {};
    var ls = armazem();
    if (ls) {
      try { var s = ls.getItem(k); if (s) cache = saneia(JSON.parse(s)); } catch (e) { cache = {}; }
    }
    return cache;
  }
  function grava() {
    var ls = armazem();
    if (!ls || !cache) return;
    try {
      if (Object.keys(cache).length) ls.setItem(cacheChave, JSON.stringify({ v: 1, herois: cache }));
      else ls.removeItem(cacheChave);
    } catch (e) {}
  }
  function avisa() {
    ouvintes.slice().forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  /* outra aba da mesma conta bebeu ou lutou: o registro daqui relê na próxima pergunta */
  try {
    window.addEventListener('storage', function (ev) {
      if (!ev || ev.key !== cacheChave) return;
      cache = null;
      avisa();
    });
  } catch (e) {}

  /* a conta de um registro num instante: {hp, max, cheioEmMs, ate1Ms} */
  function conta(h, t) {
    var ms = Vida.msPorPv();
    var passou = Math.max(0, t - h.desde);
    var hp = Math.min(h.max, h.hp + h.cura + Math.floor(passou / ms));
    var resto = ms - (passou % ms);
    return { hp: hp, max: h.max,
             cheioEmMs: hp < h.max ? (h.max - hp - 1) * ms + resto : 0,
             ate1Ms: hp < 1 ? resto : 0 };
  }

  /* ------------------------------------------------------------ as perguntas */
  /* {hp, max, cheioEmMs, ate1Ms} de agora, ou null: cheio ou sem registro. O registro que
   * encheu sai aqui mesmo (o próximo carry já não o leva). */
  Vida.agora = function (heroId) {
    var reg = registro();
    if (typeof heroId !== 'string' || !Object.prototype.hasOwnProperty.call(reg, heroId)) return null;
    var v = conta(reg[heroId], agora());
    if (v.hp >= v.max) {
      delete reg[heroId];
      grava();
      return null;
    }
    return v;
  };
  function ids(heroIds) {
    var out = [];
    (Object.prototype.toString.call(heroIds) === '[object Array]' ? heroIds : []).forEach(function (h) {
      if (typeof h === 'string' && h && out.indexOf(h) < 0) out.push(h);
    });
    return out;
  }
  /* [{heroId, hp, max, cheioEmMs, ate1Ms}] dos que NÃO estão cheios, na ordem pedida */
  Vida.lista = function (heroIds) {
    var out = [];
    ids(heroIds).forEach(function (hid) {
      var v = Vida.agora(hid);
      if (v) out.push({ heroId: hid, hp: v.hp, max: v.max, cheioEmMs: v.cheioEmMs, ate1Ms: v.ate1Ms });
    });
    return out;
  };
  /* {heroId: PV agora} dos não cheios — o que a batalha recebe —, ou null (todos cheios) */
  Vida.carry = function (heroIds) {
    var out = null;
    Vida.lista(heroIds).forEach(function (v) { (out = out || {})[v.heroId] = v.hp; });
    return out;
  };
  /* {heroId, esperaS} do primeiro herói a 0 PV, ou null */
  Vida.zerado = function (heroIds) {
    var l = Vida.lista(heroIds);
    for (var i = 0; i < l.length; i++) {
      if (l[i].hp < 1) return { heroId: l[i].heroId, esperaS: Math.max(1, Math.ceil(l[i].ate1Ms / 1000)) };
    }
    return null;
  };

  /* ------------------------------------------------------------ o que muda */
  /* O FIM DE UMA LUTA: {heroId: PV do fim} e {heroId: PV máximo}. Quem terminou cheio sai do
   * registro; o resto recomeça a subir de agora, sem as curas de antes (já estão no PV). */
  Vida.fim = function (mapaPv, mapaMax) {
    if (!mapaPv || typeof mapaPv !== 'object') return false;
    var reg = registro(), t = agora(), mudou = false;
    Object.keys(mapaPv).forEach(function (hid) {
      var pv = mapaPv[hid];
      if (!hid || typeof pv !== 'number' || !isFinite(pv)) return;
      var velho = reg[hid];
      var mx = Math.floor(num(mapaMax && mapaMax[hid], velho ? velho.max : 0));
      if (mx < 1) return;
      var hp = Math.max(0, Math.min(mx, Math.floor(pv)));
      if (hp >= mx) { if (velho) { delete reg[hid]; mudou = true; } return; }
      reg[hid] = { hp: hp, max: mx, desde: t, cura: 0 };
      mudou = true;
    });
    if (mudou) { grava(); avisa(); }
    return mudou;
  };
  /* A POÇÃO: soma `n` PV ao herói (sem passar do máximo: quem enche sai) */
  Vida.cura = function (heroId, n) {
    var reg = registro();
    n = Math.floor(num(n, 0));
    if (typeof heroId !== 'string' || !reg[heroId] || n <= 0) return null;
    reg[heroId].cura += n;
    var v = Vida.agora(heroId);          // encheu? sai aqui
    grava();
    avisa();
    return v;
  };
  /* O PV que o servidor disse (o gole respondido): o herói fica com `hp` agora, mantendo o
   * passo do relógio em que já estava — a barra não volta meio PV. `hp ≥ max` = cheio. */
  Vida.poe = function (heroId, hp, max) {
    if (typeof heroId !== 'string' || !heroId) return null;
    var reg = registro(), h = reg[heroId], t = agora(), ms = Vida.msPorPv();
    var mx = Math.floor(num(max, h ? h.max : 0));
    hp = Math.floor(num(hp, -1));
    if (mx < 1 || hp < 0) return null;
    if (hp >= mx) { if (h) { delete reg[heroId]; grava(); avisa(); } return null; }
    var fase = h ? Math.max(0, t - h.desde) % ms : 0;
    reg[heroId] = { hp: hp, max: mx, desde: t - fase, cura: 0 };
    grava();
    avisa();
    return Vida.agora(heroId);
  };

  /* A RESPOSTA DO GET /api/vida: {ok, agoraMs, msPorPv, herois: {heroId: {hp, max, cheioEmMs,
   * ate1Ms}}} — só os não cheios. SUBSTITUI o registro daqui (quem não veio está cheio). O
   * `cheioEmMs` diz em que ponto do PV seguinte o relógio de lá estava; o `desde` daqui é
   * recuado o mesmo tanto, para as duas barras subirem juntas. */
  Vida.adotaServidor = function (r) {
    if (!r || r.ok !== true || !r.herois || typeof r.herois !== 'object') return false;
    registro();
    var t = agora(), ms = Vida.msPorPv(), novo = {};
    Object.keys(r.herois).forEach(function (hid) {
      var h = r.herois[hid];
      if (!h || typeof h !== 'object' || !hid || hid.length > 80) return;
      var mx = Math.floor(num(h.max, 0)), hp = Math.floor(num(h.hp, -1));
      if (mx < 1 || mx > 100000 || hp < 0 || hp >= mx) return;
      var resto = ms;
      if (typeof h.cheioEmMs === 'number' && isFinite(h.cheioEmMs)) resto = h.cheioEmMs - (mx - hp - 1) * ms;
      else if (typeof h.ate1Ms === 'number' && isFinite(h.ate1Ms) && h.ate1Ms > 0) resto = h.ate1Ms;
      resto = Math.max(1, Math.min(ms, resto));
      novo[hid] = { hp: hp, max: mx, desde: t - (ms - resto), cura: 0 };
    });
    cache = novo;
    cacheChave = chave();
    grava();
    avisa();
    return true;
  };

  /* PERGUNTA AO SERVIDOR (com a sessão do site): na praça, depois de fechar sala, grupo e
   * duelo e depois de beber. Um pedido de cada vez; quem chama no meio ganha mais um no fim.
   * Resolve com a resposta (ou null sem servidor). */
  Vida.sincroniza = function () {
    var A = JOGO.Autoridade;
    if (!A || !A.ligada || !A.ligada() || !A.puxaVida) return Promise.resolve(null);
    if (puxando) { puxarDeNovo = true; return puxando; }
    puxando = A.puxaVida().then(function (r) {
      puxando = null;
      if (r && r.ok) Vida.adotaServidor(r);
      if (puxarDeNovo) { puxarDeNovo = false; return Vida.sincroniza(); }
      return r;
    }, function () { puxando = null; return null; });
    return puxando;
  };

  Vida.aoMudar = function (fn) {
    if (typeof fn !== 'function') return function () {};
    ouvintes.push(fn);
    return function () { ouvintes = ouvintes.filter(function (f) { return f !== fn; }); };
  };

  // provas: o registro cru e o esquecimento
  Vida._registro = function () { return JSON.parse(JSON.stringify(registro())); };
  Vida._zera = function () { cache = {}; cacheChave = chave(); grava(); avisa(); };
})();
