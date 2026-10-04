// O Santuário dos Elementos — a regra dos quatro quadrantes (dono: lógica).
var JOGO = (typeof window !== 'undefined')
  ? (window.JOGO = window.JOGO || {})
  : (globalThis.JOGO = globalThis.JOGO || {});

/* O QUE ISTO É
 * ============
 * O calabouço especial 'elementsanctum' (o dado, as salas e o porquê de ele
 * não morar em DATA.dungeons estão em js/core/data/santuario.js). Aqui mora a
 * REGRA de terreno de cada quadrante, em `Sa.regras`, e o motor só a chama
 * (engine.js, sempre por `Sg()` e só com `state.santuario` presente) — o mesmo
 * desenho do chão do Poço (js/core/poco.js). Quem monta uma sala do Santuário
 * tem este arquivo, e o juiz (servidor/juiz/motor.js) também.
 *
 * NADA AQUI SORTEIA. A regra não gasta o rng da sala: a mesma sala com os
 * mesmos lances dá o mesmo fim no cliente e no juiz, e tudo o que muda no mapa
 * sai da RODADA (um relógio que os dois lados leem igual).
 *
 * AS QUATRO REGRAS (uma por quadrante; a sala do Altar tem as quatro, cada uma
 * no seu canto). Todas valem igual para os dois lados, e todas são AVISADAS:
 *
 * FOGO — a Câmara Apagada. As casas da zona escura não são vistas de longe:
 *   quem não enxerga no escuro só MIRA uma casa escura a até 2 casas dele.
 *   Enxerga no escuro quem é do caminho do Fogo no lado do grupo (herói, fusão,
 *   e o bicho ou invocação de Fogo) e, entre os monstros, só quem tem o traço
 *   `veNoEscuro` (o Vigia de Pavio). O BRASEIRO aceso clareia as casas a até 2
 *   dele que ele vê; um golpe de Fogo o acende e um de Água o apaga — o
 *   braseiro é alvo desses golpes, e a área que o cobre também serve. A área
 *   continua pegando quem estiver nela, com ou sem luz.
 *   NA TELA do grupo o monstro numa casa escura que ninguém do grupo vê some
 *   (o mesmo esconder da invisibilidade: o passo que dá nele esbarra, o raio
 *   não salta para ele). Os monstros não ficam cegos para o grupo — conhecem a
 *   casa e ouvem os passos —, mas MIRAM com a mesma régua: o que não é o Vigia
 *   só acerta de longe quem está na luz.
 *
 * ÁGUA — a Galeria Alagada. O passo que ENTRA numa casa alagada custa 2 PP (1
 *   para quem é de Água). No fim de cada rodada a correnteza empurra 1 casa
 *   quem está na água, para onde corre a BICA que está vertendo; a bica troca
 *   a cada 2 rodadas e a tela mostra a direção desde o começo da rodada (e a
 *   troca, uma rodada antes). A PONTE é seca: não custa e não é arrastada.
 *
 * TERRA — o Salão dos Pilares Vivos. Os pilares trocam de posição (o de pé
 *   desce, o baixo sobe) no começo de cada rodada ímpar a partir da 3ª, com
 *   aviso no começo da rodada anterior. NUNCA esmagam: com alguém em cima do
 *   soquete o pilar ESPERA e tenta de novo a cada começo de rodada (escolha
 *   desta frente: deslocar à força tiraria a casa de quem está preso por raiz
 *   ou fixação e cobraria um dano que ninguém escolheu; esperar não fere
 *   ninguém e vira jogada — segurar um soquete mantém a passagem e a linha de
 *   visão abertas). As duas posições deixam todo o chão ligado, e todo soquete
 *   tem chão comum ao lado (tests/santuario_regras.js cobra).
 *
 * AR — o Terraço da Ventania. No fim de cada rodada a rajada empurra 1 casa
 *   todo mundo que está na zona do vento, na direção que o cata-vento mostra;
 *   ela gira (norte → leste → sul → oeste) a cada 2 rodadas, com a virada
 *   avisada uma rodada antes. As quatro casas de lado de um RESPIRO são
 *   calmas. Feitiço de Ar lançado de dentro da zona alcança 1 casa a mais.
 *
 * Empurrão de correnteza e de rajada não fere, não joga em buraco (a casa
 * tem de ser chão livre; senão a unidade fica) e não mexe em quem é imune a
 * empurrão nem em corpo grande. Cada unidade é levada no máximo UMA vez por
 * fim de rodada.
 */
(function () {
  'use strict';

  var Sa = {};
  JOGO.Santuario = Sa;

  Sa.ID = 'elementsanctum';

  function D() { return JOGO.DATA || {}; }
  function E() { return JOGO.Engine; }
  function cfg() { return D().santuario || {}; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  var VETOR = { n: [0, -1], s: [0, 1], l: [1, 0], o: [-1, 0] };
  var NOME_DIR = { n: 'norte', s: 'sul', l: 'leste', o: 'oeste' };
  var BICA = { N: 'n', S: 's', L: 'l', O: 'o' };
  var DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  Sa.VETOR = VETOR;
  Sa.NOME_DIR = NOME_DIR;

  // ================================================================ A PLANTA
  /* A PLANTA de uma sala: o que o `santuario` do dado diz, já lido casa a
   * casa. É ESTÁTICA (sai só do dado) e por isso não mora no estado: a foto
   * da batalha e o juiz a refazem do mesmo arquivo. */
  var plantas = [];             // [{ de: room.santuario, planta }]
  function dentro(rets, x, y) {
    for (var i = 0; rets && i < rets.length; i++) {
      var r = rets[i];
      if (x >= r[0] && y >= r[1] && x <= r[2] && y <= r[3]) return true;
    }
    return false;
  }
  function leSala(room) {
    var S = room && room.santuario;
    if (!S) return null;
    for (var c = 0; c < plantas.length; c++) if (plantas[c].de === S) return plantas[c].planta;
    var lay = room.layout || [], mapa = S.mapa || [];
    var h = lay.length, w = h ? lay[0].length : 0;
    var p = {
      w: w, h: h, regra: S.regra || null,
      escuro: (S.escuro || []).slice(), vento: (S.vento || []).slice(),
      ventoInicial: S.ventoInicial || 'n', quadrantes: S.quadrantes || null,
      braseiros: [], agua: {}, pontes: {}, bicas: [], pilares: [],
      respiros: [], calmas: {}, cataVentos: [], altar: [],
      temAgua: false
    };
    var x, y, ch;
    for (y = 0; y < h; y++) {
      var row = mapa[y] || '';
      for (x = 0; x < w; x++) {
        ch = row.charAt(x);
        if (!ch || ch === '.' || ch === ' ') continue;
        if (ch === 'B' || ch === 'b') p.braseiros.push({ x: x, y: y, aceso: ch === 'B' });
        else if (ch === 'a') { p.agua[x + ',' + y] = true; p.temAgua = true; }
        else if (ch === 'p') p.pontes[x + ',' + y] = true;
        else if (BICA[ch]) p.bicas.push({ x: x, y: y, dir: BICA[ch] });
        else if (ch === 'V' || ch === 'v') p.pilares.push({ x: x, y: y, alto: ch === 'V' });
        else if (ch === 'r') p.respiros.push({ x: x, y: y });
        else if (ch === 'C') p.cataVentos.push({ x: x, y: y });
        else if (ch === 'M') p.altar.push({ x: x, y: y });
      }
    }
    p.respiros.forEach(function (r) {
      for (var i = 0; i < DIRS.length; i++) p.calmas[(r.x + DIRS[i][0]) + ',' + (r.y + DIRS[i][1])] = true;
    });
    // as regras que esta sala tem de fato (a do Altar tem as quatro)
    p.regras = [];
    if (p.escuro.length) p.regras.push('fogo');
    if (p.temAgua) p.regras.push('agua');
    if (p.pilares.length) p.regras.push('terra');
    if (p.vento.length) p.regras.push('ar');
    plantas.push({ de: S, planta: p });
    if (plantas.length > 24) plantas.shift();
    return p;
  }
  Sa.leSala = leSala;

  function salaDe(state) {
    var en = E();
    var dg = (en && en.calabouco) ? en.calabouco(state.dungeonId) : (D().calabouco ? D().calabouco(state.dungeonId) : null);
    return (dg && dg.rooms) ? dg.rooms[state.roomIndex] : null;
  }
  function plantaDe(state) {
    if (!state || !state.santuario) return null;
    return leSala(salaDe(state));
  }
  Sa.planta = plantaDe;

  /* O quadrante de uma casa ('fogo' | 'agua' | 'terra' | 'ar' | null): na sala
   * de um quadrante só, a sala inteira; no Altar, o retângulo de cada um. Só
   * para o desenho (que muro veste a casa) — a regra lê as zonas. */
  Sa.quadranteDe = function (room, x, y) {
    var p = leSala(room);
    if (!p) return null;
    if (p.quadrantes) {
      for (var q in p.quadrantes) if (own(p.quadrantes, q) && dentro([p.quadrantes[q]], x, y)) return q;
      return null;
    }
    return (p.regra === 'fogo' || p.regra === 'agua' || p.regra === 'terra' || p.regra === 'ar') ? p.regra : null;
  };

  // ============================================================== O RELÓGIO
  /* Tudo o que muda no Santuário muda no começo de uma rodada ÍMPAR (3, 5, 7…):
   * um compasso só para o jogador aprender. `ciclo` conta quantas viradas já
   * houve até a rodada `r`. */
  function ciclo(r, periodo) { return Math.floor((Math.max(1, r) - 1) / Math.max(1, periodo)); }
  function ventoNa(p, r) {
    var c = cfg().vento || {}, ordem = c.ordem || ['n', 'l', 's', 'o'];
    var i0 = Math.max(0, ordem.indexOf(p.ventoInicial));
    return ordem[(i0 + ciclo(r, c.giraACada || 2)) % ordem.length];
  }
  function bicaNa(p, r) {
    if (!p.bicas.length) return -1;
    return ciclo(r, (cfg().agua || {}).trocaACada || 2) % p.bicas.length;
  }
  function correntezaNa(p, r) {
    var i = bicaNa(p, r);
    return i < 0 ? null : p.bicas[i].dir;
  }
  // o pilar `i` está de pé na rodada `r`? (a posição que o relógio PEDE)
  function querDePe(p, i, r) {
    var virou = ciclo(r, (cfg().pilares || {}).periodo || 2) % 2 === 1;
    return virou ? !p.pilares[i].alto : p.pilares[i].alto;
  }
  Sa.ventoNa = function (state, r) { var p = plantaDe(state); return (p && p.vento.length) ? ventoNa(p, r) : null; };
  Sa.correntezaNa = function (state, r) { var p = plantaDe(state); return p ? correntezaNa(p, r) : null; };

  // ================================================================ A REGRA
  var R = {};
  Sa.regras = R;

  function elementosDe(u) { return E().unitElements ? E().unitElements(u) : [u.element || 'neutro']; }
  function ehDe(u, el) { return elementosDe(u).indexOf(el) >= 0; }
  function vivos(state) {
    return state.units.filter(function (u) { return u.alive && !u.offBoard; });
  }
  function md(ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); }

  /* MONTAR: o que muda durante a luta entra no estado — só isso. `br` e `pl`
   * seguem a ordem da planta (a mesma leitura do mapa nos dois lados):
   *   br  braseiro aceso (1) ou apagado (0)
   *   pl  pilar de pé (1) ou baixo (0)
   *   es  pilar que quis subir e achou alguém em cima: espera (1)
   *   av  a rodada da próxima troca dos pilares já avisada (0 = nenhuma) */
  R.monta = function (state, room, I) {
    var p = leSala(room);
    if (!p) return;
    state.santuario = {
      br: p.braseiros.map(function (b) { return b.aceso ? 1 : 0; }),
      pl: p.pilares.map(function (q) { return q.alto ? 1 : 0; }),
      es: p.pilares.map(function () { return 0; }),
      av: 0
    };
    // a casa do pilar é marcada: o desenho a trata como chão com soquete e
    // desenha o bloco por fora (senão a sala inteira seria refeita a cada troca)
    p.pilares.forEach(function (q) {
      var t = I.tileAt(state, q.x, q.y);
      if (!t) return;
      t.pilar = true;
      t.type = q.alto ? 'wall' : 'floor';
      t.deco = false;
    });
    var falas = {
      fogo: 'Câmara escura: quem não é de Fogo só mira a 2 casas no breu. Braseiro aceso clareia; Fogo acende, Água apaga.',
      agua: 'Galeria alagada: entrar na água custa 2 PP (1 para quem é de Água) e a correnteza empurra 1 casa no fim da rodada.',
      terra: 'Pilares vivos: sobem e descem a cada 2 rodadas, com aviso uma rodada antes. Quem está em cima do soquete segura o pilar.',
      ar: 'Ventania: a rajada empurra 1 casa no fim da rodada e gira a cada 2 rodadas. Feitiço de Ar alcança 1 casa a mais.'
    };
    p.regras.forEach(function (r) { E().log(falas[r]); });
    anuncia(state, p, I, 1);
  };

  /* Os avisos de direção do começo de uma rodada: para onde a correnteza e a
   * rajada vão no FIM dela — e, quando a próxima rodada vira, para onde. */
  function anuncia(state, p, I, r) {
    if (p.temAgua && p.bicas.length) {
      var dc = correntezaNa(p, r), pc = correntezaNa(p, r + 1), ac = r > 1 ? correntezaNa(p, r - 1) : dc;
      I.emit({ type: 'santuarioCorrenteza', rodada: r, dir: dc, proxima: pc, bica: bicaNa(p, r) });
      if (ac !== dc) E().log('A outra bica começa a verter: a correnteza agora corre para o ' + NOME_DIR[dc] + '.');
      if (pc !== dc) E().log('A correnteza vira na próxima rodada: vai correr para o ' + NOME_DIR[pc] + '.');
    }
    if (p.vento.length) {
      var dv = ventoNa(p, r), pv = ventoNa(p, r + 1), av = r > 1 ? ventoNa(p, r - 1) : dv;
      I.emit({ type: 'santuarioVento', rodada: r, dir: dv, proxima: pv });
      if (av !== dv) E().log('O cata-vento girou: a rajada agora sopra para o ' + NOME_DIR[dv] + '.');
      if (pv !== dv) E().log('O vento vira na próxima rodada: vai soprar para o ' + NOME_DIR[pv] + '.');
    }
  }

  // ---------------------------------------------------------------- FOGO
  function naZonaEscura(p, x, y) { return dentro(p.escuro, x, y); }
  function iluminada(state, p, x, y) {
    var S = state.santuario, raio = (cfg().escuro || {}).raio || 2;
    for (var i = 0; i < p.braseiros.length; i++) {
      if (!S.br[i]) continue;
      var b = p.braseiros[i];
      if (md(b.x, b.y, x, y) > raio) continue;
      if ((b.x === x && b.y === y) || E().los(state, b.x, b.y, x, y)) return true;
    }
    return false;
  }
  function escura(state, p, x, y) {
    return naZonaEscura(p, x, y) && !iluminada(state, p, x, y);
  }
  /* quem enxerga no escuro: do lado do grupo, quem é do caminho do Fogo; entre
   * os monstros, só o traço (o Vigia de Pavio) */
  function veNoEscuro(u) {
    if (!u) return false;
    if (E().unitHasTrait(u, 'veNoEscuro')) return true;
    return u.side === 'player' && ehDe(u, 'fogo');
  }
  R.veNoEscuro = veNoEscuro;
  R.escura = function (state, x, y) {
    var p = plantaDe(state);
    return !!(p && p.escuro.length && escura(state, p, x, y));
  };
  R.iluminada = function (state, x, y) {
    var p = plantaDe(state);
    return !!(p && naZonaEscura(p, x, y) && iluminada(state, p, x, y));
  };
  /* MIRAR: `unit`, conjurando da casa (ox, oy), pode mirar a casa (tx, ty)? */
  R.podeMirar = function (state, unit, ox, oy, tx, ty) {
    var p = plantaDe(state);
    if (!p || !p.escuro.length) return true;
    if (!escura(state, p, tx, ty)) return true;
    if (veNoEscuro(unit)) return true;
    return md(ox, oy, tx, ty) <= ((cfg().escuro || {}).visao || 2);
  };
  /* ESCONDER: o monstro `o` some para o lado do grupo quando está numa casa
   * escura e ninguém do grupo o vê (quem enxerga no escuro, ou quem está a 2
   * casas). Só nesse sentido: os monstros conhecem a casa e sabem onde o grupo
   * anda — o limite deles é o de mirar (podeMirar). */
  function ocultoDoLado(state, lado, o) {
    if (!o || lado !== 'player' || o.side === 'player') return false;
    var p = plantaDe(state);
    if (!p || !p.escuro.length || !escura(state, p, o.x, o.y)) return false;
    var visao = (cfg().escuro || {}).visao || 2;
    for (var i = 0; i < state.units.length; i++) {
      var v = state.units[i];
      if (!v.alive || v.offBoard || v.side !== lado) continue;
      if (veNoEscuro(v) || md(v.x, v.y, o.x, o.y) <= visao) return false;
    }
    return true;
  }
  R.ocultoDoLado = ocultoDoLado;
  R.oculto = function (state, quem, o) { return !!quem && ocultoDoLado(state, quem.side, o); };

  // o que o golpe faz a um braseiro: 'fogo' acende, 'agua' apaga (o último efeito de dano manda)
  function golpeNoBraseiro(spell, aceso) {
    var efs = (spell && spell.effects) || [];
    for (var i = 0; i < efs.length; i++) {
      var ef = efs[i];
      if (!ef || (ef.type !== 'damage' && ef.type !== 'chain')) continue;
      var el = ef.element || spell.element;
      if (el === 'fogo') aceso = true;
      else if (el === 'agua') aceso = false;
    }
    return aceso;
  }
  function braseiroEm(p, x, y) {
    for (var i = 0; i < p.braseiros.length; i++) if (p.braseiros[i].x === x && p.braseiros[i].y === y) return i;
    return -1;
  }
  /* O BRASEIRO COMO ALVO: a casa dele não é chão, mas o golpe de Fogo (que o
   * acende) e o de Água (que o apaga) podem mirá-la — só quando o golpe MUDA
   * o braseiro (mirar um aceso com Fogo seria PA jogado fora). */
  R.alvoFixo = function (state, spell, tx, ty) {
    var p = plantaDe(state);
    if (!p) return false;
    var i = braseiroEm(p, tx, ty);
    if (i < 0) return false;
    var agora = !!state.santuario.br[i];
    return golpeNoBraseiro(spell, agora) !== agora;
  };
  /* DEPOIS DO LANCE: todo braseiro dentro da área do golpe acende ou apaga. */
  R.aposLance = function (state, caster, spell, cx, cy, x, y, I) {
    var p = plantaDe(state);
    if (!p || !p.braseiros.length) return;
    if (golpeNoBraseiro(spell, true) === true && golpeNoBraseiro(spell, false) === false) return;   // não é de Fogo nem de Água
    var tiles = E().aoeTiles(state, spell, cx, cy, x, y), S = state.santuario;
    for (var t = 0; t < tiles.length; t++) {
      var i = braseiroEm(p, tiles[t].x, tiles[t].y);
      if (i < 0) continue;
      var antes = !!S.br[i], depois = golpeNoBraseiro(spell, antes);
      if (antes === depois) continue;
      S.br[i] = depois ? 1 : 0;
      I.emit({ type: 'santuarioBraseiro', x: tiles[t].x, y: tiles[t].y, aceso: depois, uid: caster ? caster.uid : null });
      E().log(depois ? 'O braseiro acende: a luz abre o escuro em volta.' : 'O braseiro apaga: o escuro fecha em volta.');
    }
  };

  // ---------------------------------------------------------------- ÁGUA
  function alagada(p, x, y) { var k = x + ',' + y; return !!p.agua[k] && !p.pontes[k]; }
  R.alagada = function (state, x, y) { var p = plantaDe(state); return !!(p && alagada(p, x, y)); };
  /* O PASSO QUE CUSTA: devolve a conta do custo de ENTRAR em cada casa para
   * quem anda, ou null quando a sala não tem água (o motor segue na busca de
   * sempre). */
  R.custoPasso = function (state, mover) {
    var p = plantaDe(state);
    if (!p || !p.temAgua) return null;
    var c = cfg().agua || {};
    var naAgua = (mover && ehDe(mover, 'agua')) ? (c.custoAgua || 1) : (c.custo || 2);
    return function (x, y) { return alagada(p, x, y) ? naAgua : 1; };
  };

  // ---------------------------------------------------------------- TERRA
  function casaDoPilarLivre(state, q, I) {
    if (E().unitAt(state, q.x, q.y)) return false;
    var t = I.tileAt(state, q.x, q.y);
    // o muro invocado (o escudo do Minotauro) em cima do soquete também segura o pilar
    return !!t && t.type === 'floor';
  }
  function sobe(state, q, I) {
    var t = I.tileAt(state, q.x, q.y);
    t.type = 'wall'; t.deco = false;
    // o que estava no chão da casa some debaixo do bloco
    state.traps = state.traps.filter(function (a) { return a.x !== q.x || a.y !== q.y; });
    state.tileEventsActive = state.tileEventsActive.filter(function (a) { return a.x !== q.x || a.y !== q.y; });
  }
  function desce(state, q, I) {
    var t = I.tileAt(state, q.x, q.y);
    t.type = 'floor'; t.deco = false;
  }
  function trocaPilares(state, p, I) {
    var S = state.santuario, r = state.round;
    var sobem = [], descem = [], esperam = [];
    for (var i = 0; i < p.pilares.length; i++) {
      var q = p.pilares[i], quer = querDePe(p, i, r), esta = !!S.pl[i];
      if (quer === esta) { S.es[i] = 0; continue; }
      if (quer) {
        if (!casaDoPilarLivre(state, q, I)) {
          if (!S.es[i]) esperam.push({ x: q.x, y: q.y });
          S.es[i] = 1;
          continue;
        }
        sobe(state, q, I);
        S.pl[i] = 1; S.es[i] = 0;
        sobem.push({ x: q.x, y: q.y });
      } else {
        desce(state, q, I);
        S.pl[i] = 0; S.es[i] = 0;
        descem.push({ x: q.x, y: q.y });
      }
    }
    if (sobem.length || descem.length || esperam.length) {
      I.emit({ type: 'santuarioPilares', rodada: r, sobem: sobem, descem: descem, esperam: esperam });
      if (sobem.length || descem.length) E().log('Os pilares vivos trocam de lugar: ' + sobem.length + ' de pé, ' + descem.length + ' no chão.');
      if (esperam.length) E().log(esperam.length === 1 ? 'Um pilar espera: há alguém em cima do soquete.'
                                                         : esperam.length + ' pilares esperam: há alguém em cima dos soquetes.');
    }
  }
  function avisaPilares(state, p, I) {
    var S = state.santuario, r = state.round, sobem = [], descem = [];
    for (var i = 0; i < p.pilares.length; i++) {
      var agora = querDePe(p, i, r), depois = querDePe(p, i, r + 1);
      if (agora === depois) continue;
      (depois ? sobem : descem).push({ x: p.pilares[i].x, y: p.pilares[i].y });
    }
    if (!sobem.length && !descem.length) { if (S.av <= r) S.av = 0; return; }
    S.av = r + 1;
    I.emit({ type: 'santuarioAviso', regra: 'terra', rodada: r + 1, sobem: sobem, descem: descem });
    E().log('Os pilares vivos tremem: trocam de lugar no começo da próxima rodada.');
  }

  // ---------------------------------------------------------- AR E CORRENTEZA
  function naZonaDoVento(p, x, y) { return dentro(p.vento, x, y); }
  function calma(p, x, y) { return !!p.calmas[x + ',' + y]; }
  R.noVento = function (state, x, y) {
    var p = plantaDe(state);
    return !!(p && p.vento.length && naZonaDoVento(p, x, y));
  };
  R.calma = function (state, x, y) { var p = plantaDe(state); return !!(p && calma(p, x, y)); };
  /* O ALCANCE do feitiço de Ar lançado de DENTRO da zona do vento (de qualquer
   * casa dela, calma ou não): +1 no máximo. Alcance 0 (o feitiço em si mesmo)
   * não ganha nada. `rg` é o alcance do dado; devolve o mesmo objeto ou um novo. */
  R.alcance = function (state, unit, spell, rg, ox, oy) {
    var p = plantaDe(state);
    if (!p || !p.vento.length || !spell || spell.element !== 'ar') return rg;
    var max = rg.max != null ? rg.max : 1;
    if (max < 1 || !naZonaDoVento(p, ox, oy)) return rg;
    return { min: rg.min || 0, max: max + ((cfg().vento || {}).alcance || 1), line: !!rg.line, los: !!rg.los,
             movable: !!rg.movable };
  };
  function semArrasto(u) {
    return E().unitHasTrait(u, 'pushImmune') || E().porteDe(u) > 1;
  }
  /* O FIM DA RODADA: a correnteza leva quem está na água, a rajada leva quem
   * está no vento. A lista é fechada ANTES de alguém se mexer (ninguém é
   * levado duas vezes) e anda da frente para trás, para a fila inteira andar. */
  R.fimDaRodada = function (state, I) {
    var p = plantaDe(state);
    if (!p) return;
    var r = state.round;
    var dc = (p.temAgua && p.bicas.length) ? correntezaNa(p, r) : null;
    var dv = p.vento.length ? ventoNa(p, r) : null;
    if (!dc && !dv) return;
    var leva = [];
    vivos(state).forEach(function (u) {
      if (semArrasto(u)) return;
      if (dc && alagada(p, u.x, u.y)) leva.push({ u: u, dir: dc, causa: 'correnteza' });
      else if (dv && naZonaDoVento(p, u.x, u.y) && !calma(p, u.x, u.y)) leva.push({ u: u, dir: dv, causa: 'rajada' });
    });
    leva.sort(function (a, b) {
      var va = VETOR[a.dir], vb = VETOR[b.dir];
      var fa = a.u.x * va[0] + a.u.y * va[1], fb = b.u.x * vb[0] + b.u.y * vb[1];
      return (fb - fa) || (a.u.y - b.u.y) || (a.u.x - b.u.x) || ((a.u._birth || 0) - (b.u._birth || 0));
    });
    var idos = { correnteza: [], rajada: [] };
    for (var i = 0; i < leva.length; i++) {
      var it = leva[i], u = it.u, v = VETOR[it.dir];
      var nx = u.x + v[0], ny = u.y + v[1];
      if (!I.isWalkable(state, nx, ny)) continue;        // parede, mureta, buraco ou gente: fica onde está
      var fx = u.x, fy = u.y;
      u.x = nx; u.y = ny;
      I.emit({ type: 'pushed', uid: u.uid, fromX: fx, fromY: fy, toX: nx, toY: ny, collision: 0, causa: it.causa });
      idos[it.causa].push(u.uid);
    }
    if (dc) {
      I.emit({ type: 'santuarioMare', rodada: r, dir: dc, movidos: idos.correnteza });
      E().log('A correnteza corre para o ' + NOME_DIR[dc] + (idos.correnteza.length ? ' e arrasta quem está na água.' : '.'));
    }
    if (dv) {
      I.emit({ type: 'santuarioRajada', rodada: r, dir: dv, movidos: idos.rajada });
      E().log('A rajada sopra para o ' + NOME_DIR[dv] + (idos.rajada.length ? ' e empurra quem está no terraço.' : '.'));
    }
  };

  /* O COMEÇO DA RODADA (da 2ª em diante): os pilares que o relógio manda
   * trocam, o que vai mudar na próxima é avisado AGORA — antes de qualquer um
   * agir, então todo mundo joga a rodada inteira sabendo —, e a correnteza e
   * a rajada dizem para onde vão no fim desta. */
  R.inicioRodada = function (state, I) {
    var p = plantaDe(state);
    if (!p) return;
    if (p.pilares.length) {
      trocaPilares(state, p, I);
      avisaPilares(state, p, I);
    }
    anuncia(state, p, I, state.round);
  };

  // ------------------------------------------------------------- PARA A IA
  /* O peso de TERMINAR a vez em cada casa. A água atrasa e arrasta quem não é
   * dela; a casa calma do respiro segura quem atira de longe no lugar. Peso
   * pequeno de propósito: a regra do Santuário desloca, não fere. */
  R.pesoCasas = function (state, unit) {
    var p = plantaDe(state), m = {};
    if (!p) return m;
    var k;
    if (p.temAgua && unit && !ehDe(unit, 'agua') && !semArrasto(unit)) {
      for (k in p.agua) if (own(p.agua, k) && !p.pontes[k]) m[k] = (m[k] || 0) - 3;
    }
    if (p.vento.length && unit && !semArrasto(unit)) {
      for (k in p.calmas) if (own(p.calmas, k)) m[k] = (m[k] || 0) + 1.5;
    }
    return m;
  };
  /* AS CASAS QUE NÃO SÃO CAMINHO CERTO: todas as dos pilares vivos, de pé ou
   * baixos. A IA mede a rota até o alvo sem contar com elas — a passagem que
   * abre e fecha a cada 2 rodadas fazia o monstro lento andar até um vão,
   * achá-lo fechado e voltar, para sempre. Só vale porque toda sala continua
   * ligada com TODOS os pilares de pé (tests/santuario_regras.js cobra). */
  R.casasInstaveis = function (state) {
    var p = plantaDe(state);
    if (!p || !p.pilares.length) return null;
    var m = {};
    for (var i = 0; i < p.pilares.length; i++) m[p.pilares[i].x + ',' + p.pilares[i].y] = true;
    return m;
  };
  /* A distância de que a IA de distância quer ficar do alvo: quem não enxerga
   * no escuro e tem o alvo numa casa escura precisa chegar a 2 casas — de
   * longe o golpe dela é recusado, e parada no alcance de sempre ela nunca
   * atiraria. */
  R.alcanceIdeal = function (state, unit, ideal, alvo) {
    var p = plantaDe(state);
    if (!p || !p.escuro.length || !alvo || veNoEscuro(unit)) return ideal;
    if (!escura(state, p, alvo.x, alvo.y)) return ideal;
    return Math.min(ideal, (cfg().escuro || {}).visao || 2);
  };

  // ------------------------------------------------- PARA A TELA E AS PROVAS
  /* O retrato das regras AGORA: o que a HUD escreve e o que o tabuleiro
   * desenha. Só leitura. */
  Sa.info = function (state) {
    var p = plantaDe(state);
    if (!p) return null;
    var S = state.santuario, r = state.round || 1, c = cfg();
    var out = { regra: p.regra, regras: p.regras.slice(), rodada: r };
    // a próxima rodada em que o relógio vira (a ímpar seguinte)
    function proximaVirada(periodo) { return (ciclo(r, periodo) + 1) * periodo + 1; }
    if (p.escuro.length) {
      out.escuro = {
        zona: p.escuro.slice(), visao: (c.escuro || {}).visao || 2, raio: (c.escuro || {}).raio || 2,
        braseiros: p.braseiros.map(function (b, i) { return { x: b.x, y: b.y, aceso: !!S.br[i] }; })
      };
    }
    if (p.temAgua) {
      var bi = bicaNa(p, r);
      out.agua = {
        casas: Object.keys(p.agua).filter(function (k) { return !p.pontes[k]; }).map(xy),
        pontes: Object.keys(p.pontes).map(xy),
        bicas: p.bicas.map(function (b, i) { return { x: b.x, y: b.y, dir: b.dir, verte: i === bi }; }),
        dir: correntezaNa(p, r), proxima: correntezaNa(p, r + 1),
        viraNa: p.bicas.length > 1 ? proximaVirada((c.agua || {}).trocaACada || 2) : 0,
        custo: (c.agua || {}).custo || 2, custoAgua: (c.agua || {}).custoAgua || 1
      };
    }
    if (p.pilares.length) {
      out.pilares = {
        lista: p.pilares.map(function (q, i) {
          var agora = !!S.pl[i], depois = querDePe(p, i, r + 1);
          return { x: q.x, y: q.y, alto: agora, espera: !!S.es[i],
                   vai: (S.av === r + 1 && depois !== querDePe(p, i, r)) ? (depois ? 'sobe' : 'desce') : null };
        }),
        aviso: S.av || 0,
        trocaNa: proximaVirada((c.pilares || {}).periodo || 2)
      };
    }
    if (p.vento.length) {
      out.vento = {
        zona: p.vento.slice(), dir: ventoNa(p, r), proxima: ventoNa(p, r + 1),
        giraNa: proximaVirada((c.vento || {}).giraACada || 2),
        respiros: p.respiros.slice(), calmas: Object.keys(p.calmas).map(xy),
        cataVentos: p.cataVentos.slice(), alcance: (c.vento || {}).alcance || 1
      };
    }
    if (p.altar.length) out.altar = p.altar.slice();
    return out;
  };
  function xy(k) { var a = k.split(','); return { x: parseInt(a[0], 10), y: parseInt(a[1], 10) }; }

  /* As duas posições dos pilares de uma sala (para a prova do caminho): a
   * grade de 'chão'/'muro' com os pilares como estariam em cada uma. */
  Sa.posicoesDosPilares = function (room) {
    var p = leSala(room);
    if (!p) return null;
    return [0, 1].map(function (virada) {
      var alto = {};
      p.pilares.forEach(function (q) { alto[q.x + ',' + q.y] = virada ? !q.alto : q.alto; });
      return alto;
    });
  };
})();
